const { randomUUID, createHash } = require('node:crypto');
const database = require('../config/database');
const documentRepository = require('../repositories/document-repository');
const { parseId } = require('../utils/validation');
const { ApplicationError } = require('../utils/application-error');
const { readFileStorageConfig } = require('../config/file-storage');
const {
  DocumentInputError, relativeDocumentKey, ensurePrivateRoot,
  openRegularFile, receiveSingleFile, moveKey, unlinkKey,
} = require('./document-storage');
const { fileInfo, completarLimpiezaDocumental, finishDelete, setFilesystemApplied } = require('./document-operations');
const { blockStorage } = require('./storage-readiness');
const { logInternalError } = require('../utils/errors');

const imageMimes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const inlineMimes = new Set(['application/pdf', ...imageMimes]);

function normalizeId(value) { return value === null || value === undefined ? null : String(value); }

async function rollback(connection) {
  if (connection) await connection.rollback().catch(() => {});
}

async function listByStudy(studyIdValue, { userId, clientIp, requestId }) {
  const studyId = parseId(studyIdValue);
  if (!studyId) throw new ApplicationError(400, 'INVALID_ID', 'El identificador del estudio no es válido.', { includeRequestId: true });
  let connection;
  try {
    connection = await database.getPool().getConnection();
    const rows = await documentRepository.listActiveByStudy(connection, studyId);
    const data = rows.map(row => ({ ...row, id: String(row.id), studyId: String(row.studyId), uploadedBy: String(row.uploadedBy), updatedBy: normalizeId(row.updatedBy), sizeBytes: String(row.sizeBytes) }));
    await documentRepository.insertAudit(connection, { userId, action: 'document.list', entityType: 'study', entityId: studyId, details: { count: data.length }, clientIp });
    return { data };
  } catch (error) {
    await rollback(connection);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function upload(studyIdValue, requestStream, { userId, requestId }) {
  const studyId = parseId(studyIdValue);
  if (!studyId) throw new ApplicationError(400, 'INVALID_ID', 'El identificador del estudio no es válido.', { includeRequestId: true });
  const config = readFileStorageConfig();
  if (!config.root || !config.maxFileSizeBytes) {
    throw new ApplicationError(503, 'FILE_UPLOAD_NOT_CONFIGURED', 'Configure FILE_STORAGE_ROOT y MAX_FILE_SIZE_BYTES para habilitar cargas.', { includeRequestId: true });
  }
  const pool = database.getPool();
  let stagedFile;
  let journalCommitted = false;
  let operationId;
  try {
    await ensurePrivateRoot(config.root);
    const lookup = await pool.getConnection();
    let study;
    try { study = await documentRepository.findStudyForUpload(lookup, studyId); }
    finally { lookup.release(); }
    if (!study) throw new ApplicationError(404, 'STUDY_NOT_FOUND', 'No se encontró el estudio.', { includeRequestId: true });

    stagedFile = await receiveSingleFile(requestStream, config.root, config.maxFileSizeBytes);
    operationId = randomUUID();
    const transaction = await pool.getConnection();
    let documentId;
    let targetKey;
    try {
      await transaction.beginTransaction();
      const currentStudy = await documentRepository.findStudyForUpload(transaction, studyId, true);
      if (!currentStudy) throw new DocumentInputError('STUDY_NOT_FOUND', 'No se encontró el estudio.');
      const placeholderKey = `.staging/pending-${operationId}.pending`;
      const inserted = await documentRepository.insertPending(transaction, {
        patientId: currentStudy.patientId, studyId, originalName: stagedFile.originalName,
        storageKey: placeholderKey, mimeType: stagedFile.mimeType, sizeBytes: stagedFile.sizeBytes,
        sha256: stagedFile.sha256, uploadedBy: userId,
      });
      documentId = String(inserted.insertId);
      targetKey = relativeDocumentKey({ patientId: currentStudy.patientId, patientDni: currentStudy.patientDni, patientName: currentStudy.patientName, studyId, studyDate: currentStudy.studyDate, studyType: currentStudy.studyType, documentId, originalName: stagedFile.originalName });
      await documentRepository.setStorageKey(transaction, targetKey, inserted.insertId);
      await documentRepository.createUploadOperation(transaction, {
        operationId, documentId: inserted.insertId, patientId: currentStudy.patientId, studyId,
        stagingKey: stagedFile.stagingKey, newKey: targetKey, originalName: stagedFile.originalName,
        mimeType: stagedFile.mimeType, sizeBytes: stagedFile.sizeBytes, sha256: stagedFile.sha256, actorId: userId,
      });
      await transaction.commit();
      journalCommitted = true;
    } catch (error) {
      await transaction.rollback().catch(() => {});
      throw error;
    } finally { transaction.release(); }

    await moveKey(config.root, stagedFile.stagingKey, targetKey);
    const storedFile = await fileInfo(config.root, targetKey);
    if (!storedFile || storedFile.size !== stagedFile.sizeBytes || storedFile.sha256 !== stagedFile.sha256) throw new Error('DOCUMENT_UPLOAD_FINAL_FILE_MISMATCH');
    await setFilesystemApplied(pool, operationId);
    const finalizer = await pool.getConnection();
    try {
      await finalizer.beginTransaction();
      const activated = await documentRepository.activatePending(finalizer, documentId);
      if (activated.affectedRows !== 1) throw new Error('DOCUMENT_UPLOAD_ROW_MISMATCH');
      await documentRepository.insertAudit(finalizer, {
        userId, action: 'document.upload', entityType: 'document', entityId: documentId,
        details: { patientId: String(study.patientId), studyId: String(studyId), sizeBytes: stagedFile.sizeBytes, sha256: stagedFile.sha256, result: 'success' },
        clientIp: requestStream.ip,
      });
      const completed = await documentRepository.completeUploadOperation(finalizer, operationId);
      if (completed.affectedRows !== 1) throw new Error('DOCUMENT_UPLOAD_JOURNAL_MISMATCH');
      await finalizer.commit();
    } catch (error) {
      await finalizer.rollback().catch(() => {});
      throw error;
    } finally { finalizer.release(); }

    return { id: documentId, patientId: String(study.patientId), studyId: String(studyId), originalName: stagedFile.originalName, mimeType: stagedFile.mimeType, sizeBytes: stagedFile.sizeBytes, sha256: stagedFile.sha256, uploadedBy: String(userId) };
  } catch (error) {
    if (journalCommitted) blockStorage(error?.code, operationId);
    if (stagedFile && !journalCommitted) await unlinkKey(config.root, stagedFile.stagingKey).catch(() => {});
    throw error;
  }
}

async function verifyOpenFile(fileHandle, expectedSize, expectedSha256) {
  const before = await fileHandle.stat();
  if (!before.isFile() || before.size !== Number(expectedSize)) return false;
  const hash = createHash('sha256');
  const stream = fileHandle.createReadStream({ start: 0, autoClose: false });
  for await (const chunk of stream) hash.update(chunk);
  const after = await fileHandle.stat();
  return after.isFile() && after.size === before.size && hash.digest('hex') === expectedSha256;
}

async function prepareStream(idValue, disposition, { userId, clientIp, requestId }, { blockOnIntegrityMismatch = true, auditAction = null } = {}) {
  const id = parseId(idValue);
  if (!id) throw new ApplicationError(400, 'INVALID_ID', 'El identificador no es válido.', { includeRequestId: true });
  const config = readFileStorageConfig();
  if (!config.root) throw new ApplicationError(503, 'FILE_STORAGE_NOT_CONFIGURED', 'El almacenamiento de archivos no está configurado.', { includeRequestId: true });
  const pool = database.getPool();
  const connection = await pool.getConnection();
  let document;
  let fileHandle;
  try {
    document = await documentRepository.findActiveById(connection, id);
    if (!document) throw new ApplicationError(404, 'DOCUMENT_NOT_FOUND', 'No se encontró el documento.', { includeRequestId: true });
    if (disposition === 'inline' && !inlineMimes.has(document.mime_type)) {
      throw new ApplicationError(415, 'INLINE_NOT_SUPPORTED', 'Este formato debe descargarse; no tiene visor integrado.', { includeRequestId: true });
    }
    if (disposition === 'inline' && imageMimes.has(document.mime_type) && !await documentRepository.canReadImages(pool, userId)) {
      throw new ApplicationError(403, 'FORBIDDEN', 'No tiene permiso para visualizar imágenes.', { includeRequestId: true });
    }
    fileHandle = await openRegularFile(config.root, document.storage_key);
    if (!await verifyOpenFile(fileHandle, document.size_bytes, document.sha256)) {
      const integrityError = Object.assign(new Error('DOCUMENT_INTEGRITY_MISMATCH'), { code: 'DOCUMENT_INTEGRITY_MISMATCH' });
      if (blockOnIntegrityMismatch) {
        blockStorage(integrityError.code, null, 'Se detectó un archivo que no coincide con su SHA-256 registrado. Revise el documento y el repositorio antes de continuar.');
      }
      console.error(JSON.stringify({ level: 'error', event: auditAction ? 'backup_document_integrity_mismatch' : 'document_integrity_mismatch', requestId, documentId: String(document.id) }));
      throw integrityError;
    }
    await documentRepository.insertAudit(connection, {
      userId, action: auditAction || (disposition === 'inline' ? 'document.view' : 'document.download'),
      entityType: 'document', entityId: String(document.id),
      details: { studyId: String(document.study_id), patientId: String(document.patient_id), result: 'success' }, clientIp,
    });
    return { document, fileHandle };
  } catch (error) {
    if (fileHandle) await fileHandle.close().catch(() => {});
    if (error.code === 'DOCUMENT_INTEGRITY_MISMATCH') throw new ApplicationError(409, error.code, 'El archivo no coincide con su metadata de integridad. Se requiere revisión técnica.', { includeRequestId: true });
    if (error instanceof DocumentInputError || error.code === 'ENOENT') throw new ApplicationError(404, 'DOCUMENT_FILE_MISSING', 'El contenido del documento no está disponible.', { includeRequestId: true });
    throw error;
  } finally {
    connection.release();
  }
}

async function replace(idValue, requestStream, { userId, clientIp }) {
  const id = parseId(idValue);
  if (!id) throw new ApplicationError(400, 'INVALID_ID', 'El identificador no es válido.', { includeRequestId: true });
  const config = readFileStorageConfig();
  if (!config.root || !config.maxFileSizeBytes) throw new ApplicationError(503, 'FILE_UPLOAD_NOT_CONFIGURED', 'Configure FILE_STORAGE_ROOT y MAX_FILE_SIZE_BYTES para habilitar cargas.', { includeRequestId: true });
  let stagedFile;
  let journalCommitted = false;
  let operation;
  const pool = database.getPool();
  try {
    stagedFile = await receiveSingleFile(requestStream, config.root, config.maxFileSizeBytes);
    const connection = await pool.getConnection();
    let document;
    try {
      await connection.beginTransaction();
      document = await documentRepository.findForReplacement(connection, id);
      if (!document || document.file_status !== 'active') throw new DocumentInputError('DOCUMENT_NOT_FOUND', 'No se encontró el documento activo.');
      const newKey = relativeDocumentKey({ patientId: document.patient_id, patientDni: document.patient_dni, patientName: document.patient_name, studyId: document.study_id, studyDate: document.study_date, studyType: document.study_type, documentId: document.id, originalName: stagedFile.originalName });
      const oldFile = await fileInfo(config.root, document.storage_key);
      if (!oldFile || oldFile.sha256 !== document.sha256 || oldFile.size !== Number(document.size_bytes)) throw new DocumentInputError('DOCUMENT_FILE_INCONSISTENT', 'El archivo actual no coincide con sus metadatos; se requiere revisión técnica.');
      operation = { operationId: randomUUID(), type: 'replace', documentId: String(document.id), patientId: String(document.patient_id), studyId: String(document.study_id), stagingKey: stagedFile.stagingKey, backupKey: `.staging/${randomUUID()}.old`, oldKey: document.storage_key, newKey, oldSha256: document.sha256, ...stagedFile, actorId: userId };
      await documentRepository.createReplacementOperation(connection, operation);
      await documentRepository.markReplacing(connection, id);
      await connection.commit();
      journalCommitted = true;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally { connection.release(); }

    await moveKey(config.root, operation.oldKey, operation.backupKey);
    const backupFile = await fileInfo(config.root, operation.backupKey);
    if (!backupFile || backupFile.sha256 !== operation.oldSha256) throw new Error('DOCUMENT_REPLACEMENT_BACKUP_MISMATCH');
    await setFilesystemApplied(pool, operation.operationId);
    await moveKey(config.root, stagedFile.stagingKey, operation.newKey);
    const installedFile = await fileInfo(config.root, operation.newKey);
    if (!installedFile || installedFile.size !== stagedFile.sizeBytes || installedFile.sha256 !== stagedFile.sha256) throw new Error('DOCUMENT_REPLACEMENT_FINAL_FILE_MISMATCH');
    const finalize = await pool.getConnection();
    try {
      await finalize.beginTransaction();
      const updated = await documentRepository.updateReplacement(finalize, operation);
      if (updated.affectedRows !== 1) throw new Error('DOCUMENT_REPLACEMENT_ROW_MISMATCH');
      await documentRepository.insertAudit(finalize, {
        userId, action: 'document.replace', entityType: 'document', entityId: operation.documentId,
        details: { patientId: operation.patientId, studyId: operation.studyId, previousSha256: operation.oldSha256, sha256: operation.sha256, sizeBytes: operation.sizeBytes, result: 'success' }, clientIp,
      });
      const completed = await documentRepository.completePreparedOperation(finalize, operation.operationId);
      if (completed.affectedRows !== 1) throw new Error('DOCUMENT_REPLACEMENT_JOURNAL_MISMATCH');
      await finalize.commit();
    } catch (error) {
      await finalize.rollback().catch(() => {});
      throw error;
    } finally { finalize.release(); }
    await completarLimpiezaDocumental(pool, config.root, operation);
    return { id: String(document.id), patientId: String(document.patient_id), studyId: String(document.study_id), originalName: stagedFile.originalName, mimeType: stagedFile.mimeType, sizeBytes: stagedFile.sizeBytes, sha256: stagedFile.sha256, updatedBy: String(userId) };
  } catch (error) {
    if (journalCommitted) blockStorage(error?.code, operation?.operationId);
    if (stagedFile && !journalCommitted) await unlinkKey(config.root, stagedFile.stagingKey).catch(() => {});
    throw error;
  }
}

async function remove(idValue, { userId, requestId }) {
  const id = parseId(idValue);
  if (!id) throw new ApplicationError(400, 'INVALID_ID', 'El identificador no es válido.', { includeRequestId: true });
  const config = readFileStorageConfig();
  if (!config.root) throw new ApplicationError(503, 'FILE_STORAGE_NOT_CONFIGURED', 'El almacenamiento de archivos no está configurado.', { includeRequestId: true });
  const pool = database.getPool();
  let operation;
  let journalCommitted = false;
  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const document = await documentRepository.findForDeletion(connection, id);
      if (!document || document.file_status !== 'active') throw new ApplicationError(404, 'DOCUMENT_NOT_FOUND', 'No se encontró el documento activo.', { includeRequestId: true });
      const existingFile = await fileInfo(config.root, document.storage_key);
      if (!existingFile || existingFile.sha256 !== document.sha256) throw new DocumentInputError('DOCUMENT_FILE_INCONSISTENT', 'El archivo no coincide con sus metadatos; se requiere revisión técnica.');
      operation = { operationId: randomUUID(), documentId: String(document.id), patientId: String(document.patient_id), studyId: String(document.study_id), oldKey: document.storage_key, backupKey: `.staging/${randomUUID()}.deleted`, oldSha256: document.sha256, actorId: userId };
      await documentRepository.createDeleteOperation(connection, operation);
      await documentRepository.markDeleting(connection, id);
      await connection.commit();
      journalCommitted = true;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally { connection.release(); }

    await moveKey(config.root, operation.oldKey, operation.backupKey);
    const movedFile = await fileInfo(config.root, operation.backupKey);
    if (!movedFile || movedFile.sha256 !== operation.oldSha256) throw new Error('DOCUMENT_DELETE_MOVE_MISMATCH');
    await setFilesystemApplied(pool, operation.operationId);
    await finishDelete(pool, config.root, { ...operation, operation_state: 'filesystem_applied' });
  } catch (error) {
    if (journalCommitted) blockStorage(error?.code, operation?.operationId);
    throw error;
  }
}

function isInputError(error) { return error instanceof DocumentInputError; }

module.exports = { listByStudy, upload, prepareStream, replace, remove, isInputError };
