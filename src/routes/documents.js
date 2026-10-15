const { Router } = require('express');
const { randomUUID, createHash } = require('node:crypto');
const database = require('../config/database');
const { readFileStorageConfig } = require('../config/file-storage');
const { optionalAuth, requireAuth } = require('../middleware/require-auth');
const requirePermission = require('../middleware/require-permission');
const { parseId } = require('../utils/validation');
const { sendDatabaseError } = require('../utils/errors');
const {
  DocumentInputError, relativeDocumentKey, ensurePrivateRoot,
  openRegularFile, receiveSingleFile, moveKey, unlinkKey,
} = require('../services/document-storage');
const { fileInfo, finishUpload, finishReplacement, finishDelete, setFilesystemApplied } = require('../services/document-operations');
const { blockStorage, requireStorageReady } = require('../services/storage-readiness');

const router = Router();
const imageMimes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const inlineMimes = new Set(['application/pdf', ...imageMimes]);

function normalizeId(value) { return value === null || value === undefined ? null : String(value); }

function inputResponse(res, req, error) {
  const status = error.code === 'FILE_TOO_LARGE' ? 413
    : ['UNSUPPORTED_FILE_TYPE', 'MIME_MISMATCH', 'INVALID_FILE_CONTENT', 'INVALID_DICOM_FILE'].includes(error.code) ? 415
      : ['INVALID_MULTIPART'].includes(error.code) ? 400 : 400;
  res.status(status).json({ error: { code: error.code || 'INVALID_FILE', message: error.message, requestId: req.requestId } });
}

function sendFileHeaders(res, document, disposition) {
  const asciiName = document.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_') || 'documento';
  const encodedName = encodeURIComponent(document.original_name).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  res.setHeader('Content-Type', document.mime_type);
  res.setHeader('Content-Length', String(document.size_bytes));
  res.setHeader('Content-Disposition', `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
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

async function studyForUpload(connection, studyId, { lock = false } = {}) {
  const rows = await connection.query(
    `SELECT s.id AS studyId, s.patient_id AS patientId, s.study_date AS studyDate, s.study_type AS studyType,
            p.dni AS patientDni, p.full_name AS patientName
     FROM studies s JOIN patients p ON p.id = s.patient_id
     WHERE s.id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [studyId],
  );
  return rows[0] || null;
}

async function getActiveDocument(connection, id) {
  const rows = await connection.query(
    `SELECT d.id, d.patient_id, d.study_id, d.original_name, d.storage_key, d.mime_type,
            d.size_bytes, d.sha256, d.uploaded_by, d.created_at, d.updated_at, d.updated_by,
            s.study_date, s.study_type, p.dni AS patient_dni, p.full_name AS patient_name
     FROM documents d JOIN studies s ON s.id = d.study_id JOIN patients p ON p.id = d.patient_id
     WHERE d.id = ? AND d.file_status = 'active' LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

async function writeOperation(pool, operation) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO document_file_operations
       (operation_id, operation_type, operation_state, document_id, patient_id, study_id, staging_key,
        backup_key, old_storage_key, new_storage_key, original_name, mime_type, size_bytes, sha256,
        old_sha256, actor_user_id)
       VALUES (?, ?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [operation.operationId, operation.type, operation.documentId, operation.patientId, operation.studyId,
        operation.stagingKey, operation.backupKey, operation.oldKey, operation.newKey,
        operation.originalName, operation.mimeType, operation.sizeBytes, operation.sha256,
        operation.oldSha256, operation.actorId],
    );
    if (operation.type === 'replace') {
      await connection.query("UPDATE documents SET file_status = 'replacing' WHERE id = ? AND file_status = 'active'", [operation.documentId]);
    } else if (operation.type === 'delete') {
      await connection.query("UPDATE documents SET file_status = 'deleting' WHERE id = ? AND file_status = 'active'", [operation.documentId]);
    }
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
}

router.get('/estudios/:studyId/documentos', optionalAuth, requireAuth, requirePermission('documents.read'), async (req, res) => {
  const studyId = parseId(req.params.studyId);
  if (!studyId) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'El identificador del estudio no es válido.', requestId: req.requestId } });
  let connection;
  try {
    connection = await database.getPool().getConnection();
    const rows = await connection.query(
      `SELECT id, study_id AS studyId, original_name AS originalName, mime_type AS mimeType,
              size_bytes AS sizeBytes, sha256, uploaded_by AS uploadedBy, created_at AS createdAt,
              updated_at AS updatedAt, updated_by AS updatedBy
       FROM documents WHERE study_id = ? AND file_status = 'active' ORDER BY id`,
      [studyId],
    );
    const data = rows.map(row => ({ ...row, id: String(row.id), studyId: String(row.studyId), uploadedBy: String(row.uploadedBy), updatedBy: normalizeId(row.updatedBy), sizeBytes: String(row.sizeBytes) }));
    await connection.query(
      'INSERT INTO audit_events (user_id, action_code, entity_type, entity_id, details_json, client_ip) VALUES (?, ?, ?, ?, ?, ?)',
      [req.auth.user.id, 'document.list', 'study', String(studyId), JSON.stringify({ count: data.length }), req.ip || null],
    );
    res.json({ data });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    sendDatabaseError(res, req, error, 'documents.list', 'No se pudieron consultar los documentos.');
  } finally { if (connection) connection.release(); }
});

router.post('/estudios/:studyId/documentos', optionalAuth, requireAuth, requirePermission('documents.upload'), requireStorageReady, async (req, res) => {
  const studyId = parseId(req.params.studyId);
  if (!studyId) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'El identificador del estudio no es válido.', requestId: req.requestId } });
  const config = readFileStorageConfig();
  if (!config.root || !config.maxFileSizeBytes) return res.status(503).json({ error: { code: 'FILE_UPLOAD_NOT_CONFIGURED', message: 'Configure FILE_STORAGE_ROOT y MAX_FILE_SIZE_BYTES para habilitar cargas.', requestId: req.requestId } });
  const pool = database.getPool();
  let stagedFile;
  let journalCommitted = false;
  let operationId;
  try {
    await ensurePrivateRoot(config.root);
    const connection = await pool.getConnection();
    let study;
    try { study = await studyForUpload(connection, studyId); }
    finally { connection.release(); }
    if (!study) return res.status(404).json({ error: { code: 'STUDY_NOT_FOUND', message: 'No se encontró el estudio.', requestId: req.requestId } });

    stagedFile = await receiveSingleFile(req, config.root, config.maxFileSizeBytes);
    operationId = randomUUID();
    const transaction = await pool.getConnection();
    let documentId;
    let targetKey;
    try {
      await transaction.beginTransaction();
      // Re-read and lock the study/patient after streaming. Their labels may
      // have changed while the client was uploading; the locked current values
      // keep the target key in the same namespace as the committed metadata.
      const currentStudy = await studyForUpload(transaction, studyId, { lock: true });
      if (!currentStudy) throw new DocumentInputError('STUDY_NOT_FOUND', 'No se encontró el estudio.');
      const placeholderKey = `.staging/pending-${operationId}.pending`;
      const inserted = await transaction.query(
        `INSERT INTO documents (patient_id, study_id, original_name, storage_key, mime_type, size_bytes, sha256, uploaded_by, file_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [currentStudy.patientId, studyId, stagedFile.originalName, placeholderKey, stagedFile.mimeType, stagedFile.sizeBytes, stagedFile.sha256, req.auth.user.id],
      );
      documentId = String(inserted.insertId);
      targetKey = relativeDocumentKey({ patientId: currentStudy.patientId, patientDni: currentStudy.patientDni, patientName: currentStudy.patientName, studyId, studyDate: currentStudy.studyDate, studyType: currentStudy.studyType, documentId, originalName: stagedFile.originalName });
      await transaction.query('UPDATE documents SET storage_key = ? WHERE id = ?', [targetKey, inserted.insertId]);
      await transaction.query(
        `INSERT INTO document_file_operations
         (operation_id, operation_type, operation_state, document_id, patient_id, study_id, staging_key, new_storage_key,
          original_name, mime_type, size_bytes, sha256, actor_user_id)
         VALUES (?, 'upload', 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [operationId, inserted.insertId, currentStudy.patientId, studyId, stagedFile.stagingKey, targetKey, stagedFile.originalName, stagedFile.mimeType, stagedFile.sizeBytes, stagedFile.sha256, req.auth.user.id],
      );
      await transaction.commit();
      journalCommitted = true;
    } catch (error) { await transaction.rollback().catch(() => {}); throw error; }
    finally { transaction.release(); }

    await moveKey(config.root, stagedFile.stagingKey, targetKey);
    const storedFile = await fileInfo(config.root, targetKey);
    if (!storedFile || storedFile.size !== stagedFile.sizeBytes || storedFile.sha256 !== stagedFile.sha256) throw new Error('DOCUMENT_UPLOAD_FINAL_FILE_MISMATCH');
    await setFilesystemApplied(pool, operationId);
    const finalizer = await pool.getConnection();
    try {
      await finalizer.beginTransaction();
      const activated = await finalizer.query("UPDATE documents SET file_status = 'active' WHERE id = ? AND file_status = 'pending'", [documentId]);
      if (activated.affectedRows !== 1) throw new Error('DOCUMENT_UPLOAD_ROW_MISMATCH');
      await finalizer.query(
        'INSERT INTO audit_events (user_id, action_code, entity_type, entity_id, details_json, client_ip) VALUES (?, ?, ?, ?, ?, ?)',
        [req.auth.user.id, 'document.upload', 'document', documentId, JSON.stringify({ patientId: String(study.patientId), studyId: String(studyId), sizeBytes: stagedFile.sizeBytes, sha256: stagedFile.sha256, result: 'success' }), req.ip || null],
      );
      const completed = await finalizer.query("UPDATE document_file_operations SET operation_state = 'completed' WHERE operation_id = ? AND operation_state = 'filesystem_applied'", [operationId]);
      if (completed.affectedRows !== 1) throw new Error('DOCUMENT_UPLOAD_JOURNAL_MISMATCH');
      await finalizer.commit();
    } catch (error) { await finalizer.rollback().catch(() => {}); throw error; }
    finally { finalizer.release(); }

    return res.status(201).json({ data: { id: documentId, patientId: String(study.patientId), studyId: String(studyId), originalName: stagedFile.originalName, mimeType: stagedFile.mimeType, sizeBytes: stagedFile.sizeBytes, sha256: stagedFile.sha256, uploadedBy: String(req.auth.user.id) } });
  } catch (error) {
    if (journalCommitted) blockStorage(error?.code, operationId);
    if (stagedFile && !journalCommitted) await unlinkKey(config.root, stagedFile.stagingKey).catch(() => {});
    if (error instanceof DocumentInputError) return inputResponse(res, req, error);
    sendDatabaseError(res, req, error, 'documents.upload', 'No se pudo cargar el archivo.');
  }
});

async function streamDocument(req, res, disposition) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'El identificador no es válido.', requestId: req.requestId } });
  const config = readFileStorageConfig();
  if (!config.root) return res.status(503).json({ error: { code: 'FILE_STORAGE_NOT_CONFIGURED', message: 'El almacenamiento de archivos no está configurado.', requestId: req.requestId } });
  const pool = database.getPool();
  const connection = await pool.getConnection();
  let document;
  let fileHandle;
  try {
    document = await getActiveDocument(connection, id);
    if (!document) return res.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'No se encontró el documento.', requestId: req.requestId } });
    if (disposition === 'inline' && !inlineMimes.has(document.mime_type)) return res.status(415).json({ error: { code: 'INLINE_NOT_SUPPORTED', message: 'Este formato debe descargarse; no tiene visor integrado.', requestId: req.requestId } });
    if (disposition === 'inline' && imageMimes.has(document.mime_type)) {
      const permission = await pool.query(
        `SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ? AND p.code = 'images.read' LIMIT 1`,
        [req.auth.user.id],
      );
      if (!permission.length) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'No tiene permiso para visualizar imágenes.', requestId: req.requestId } });
    }
    fileHandle = await openRegularFile(config.root, document.storage_key);
    if (!await verifyOpenFile(fileHandle, document.size_bytes, document.sha256)) {
      const integrityError = Object.assign(new Error('DOCUMENT_INTEGRITY_MISMATCH'), { code: 'DOCUMENT_INTEGRITY_MISMATCH' });
      blockStorage(integrityError.code, null, 'Se detectó un archivo que no coincide con su SHA-256 registrado. Revise el documento y el repositorio antes de continuar.');
      console.error(JSON.stringify({ level: 'error', event: 'document_integrity_mismatch', requestId: req.requestId, documentId: String(document.id) }));
      throw integrityError;
    }
    await connection.query(
      'INSERT INTO audit_events (user_id, action_code, entity_type, entity_id, details_json, client_ip) VALUES (?, ?, ?, ?, ?, ?)',
      [req.auth.user.id, disposition === 'inline' ? 'document.view' : 'document.download', 'document', String(document.id), JSON.stringify({ studyId: String(document.study_id), patientId: String(document.patient_id), result: 'success' }), req.ip || null],
    );
  } catch (error) {
    if (fileHandle) await fileHandle.close().catch(() => {});
    if (error.code === 'DOCUMENT_INTEGRITY_MISMATCH') {
      return res.status(409).json({ error: { code: 'DOCUMENT_INTEGRITY_MISMATCH', message: 'El archivo no coincide con su metadata de integridad. Se requiere revisión técnica.', requestId: req.requestId } });
    }
    if (error instanceof DocumentInputError || error.code === 'ENOENT') {
      return res.status(404).json({ error: { code: 'DOCUMENT_FILE_MISSING', message: 'El contenido del documento no está disponible.', requestId: req.requestId } });
    }
    return sendDatabaseError(res, req, error, 'documents.stream', 'No se pudo acceder al documento.');
  } finally { connection.release(); }

  sendFileHeaders(res, document, disposition);
  const stream = fileHandle.createReadStream({ autoClose: true });
  res.on('close', () => { if (!res.writableFinished) stream.destroy(); });
  stream.on('error', error => {
    if (!res.headersSent) sendDatabaseError(res, req, error, 'documents.stream', 'No se pudo transmitir el documento.');
    else res.destroy(error);
  });
  stream.pipe(res);
}

router.get('/documentos/:id/download', optionalAuth, requireAuth, requirePermission('documents.download'), requireStorageReady, (req, res) => streamDocument(req, res, 'attachment'));
router.get('/documentos/:id/content', optionalAuth, requireAuth, requirePermission('documents.read'), requireStorageReady, (req, res) => streamDocument(req, res, 'inline'));

router.put('/documentos/:id', optionalAuth, requireAuth, requirePermission('documents.replace'), requireStorageReady, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'El identificador no es válido.', requestId: req.requestId } });
  const config = readFileStorageConfig();
  if (!config.root || !config.maxFileSizeBytes) return res.status(503).json({ error: { code: 'FILE_UPLOAD_NOT_CONFIGURED', message: 'Configure FILE_STORAGE_ROOT y MAX_FILE_SIZE_BYTES para habilitar cargas.', requestId: req.requestId } });
  let stagedFile;
  let journalCommitted = false;
  let operation;
  const pool = database.getPool();
  try {
    stagedFile = await receiveSingleFile(req, config.root, config.maxFileSizeBytes);
    const connection = await pool.getConnection();
    let document;
    try {
      await connection.beginTransaction();
      const rows = await connection.query(
        `SELECT d.id, d.patient_id, d.study_id, d.storage_key, d.sha256, d.size_bytes, d.file_status, s.study_date, s.study_type,
                p.dni AS patient_dni, p.full_name AS patient_name
         FROM documents d JOIN studies s ON s.id = d.study_id JOIN patients p ON p.id = d.patient_id
         WHERE d.id = ? FOR UPDATE`, [id],
      );
      document = rows[0];
      if (!document || document.file_status !== 'active') throw new DocumentInputError('DOCUMENT_NOT_FOUND', 'No se encontró el documento activo.');
      const newKey = relativeDocumentKey({ patientId: document.patient_id, patientDni: document.patient_dni, patientName: document.patient_name, studyId: document.study_id, studyDate: document.study_date, studyType: document.study_type, documentId: document.id, originalName: stagedFile.originalName });
      const oldFile = await fileInfo(config.root, document.storage_key);
      if (!oldFile || oldFile.sha256 !== document.sha256 || oldFile.size !== Number(document.size_bytes)) throw new DocumentInputError('DOCUMENT_FILE_INCONSISTENT', 'El archivo actual no coincide con sus metadatos; se requiere revisión técnica.');
      operation = { operationId: randomUUID(), type: 'replace', documentId: String(document.id), patientId: String(document.patient_id), studyId: String(document.study_id), stagingKey: stagedFile.stagingKey, backupKey: `.staging/${randomUUID()}.old`, oldKey: document.storage_key, newKey, oldSha256: document.sha256, ...stagedFile, actorId: req.auth.user.id };
      await connection.query(
        `INSERT INTO document_file_operations
         (operation_id, operation_type, operation_state, document_id, patient_id, study_id, staging_key, backup_key,
          old_storage_key, new_storage_key, original_name, mime_type, size_bytes, sha256, old_sha256, actor_user_id)
         VALUES (?, 'replace', 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [operation.operationId, operation.documentId, operation.patientId, operation.studyId, operation.stagingKey, operation.backupKey, operation.oldKey, operation.newKey, operation.originalName, operation.mimeType, operation.sizeBytes, operation.sha256, operation.oldSha256, operation.actorId],
      );
      await connection.query("UPDATE documents SET file_status = 'replacing' WHERE id = ?", [id]);
      await connection.commit();
      journalCommitted = true;
    } catch (error) { await connection.rollback().catch(() => {}); throw error; }
    finally { connection.release(); }

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
      const updated = await finalize.query(
        `UPDATE documents SET storage_key = ?, original_name = ?, mime_type = ?, size_bytes = ?, sha256 = ?,
                              updated_by = ?, file_status = 'active'
         WHERE id = ? AND file_status = 'replacing'`,
        [operation.newKey, operation.originalName, operation.mimeType, operation.sizeBytes, operation.sha256, operation.actorId, operation.documentId],
      );
      if (updated.affectedRows !== 1) throw new Error('DOCUMENT_REPLACEMENT_ROW_MISMATCH');
      await finalize.query(
        'INSERT INTO audit_events (user_id, action_code, entity_type, entity_id, details_json, client_ip) VALUES (?, ?, ?, ?, ?, ?)',
        [operation.actorId, 'document.replace', 'document', operation.documentId, JSON.stringify({ patientId: operation.patientId, studyId: operation.studyId, previousSha256: operation.oldSha256, sha256: operation.sha256, sizeBytes: operation.sizeBytes, result: 'success' }), req.ip || null],
      );
      const completed = await finalize.query("UPDATE document_file_operations SET operation_state = 'completed' WHERE operation_id = ? AND operation_state = 'filesystem_applied'", [operation.operationId]);
      if (completed.affectedRows !== 1) throw new Error('DOCUMENT_REPLACEMENT_JOURNAL_MISMATCH');
      await finalize.commit();
    } catch (error) { await finalize.rollback().catch(() => {}); throw error; }
    finally { finalize.release(); }
    await unlinkKey(config.root, operation.backupKey);
    return res.json({ data: { id: String(document.id), patientId: String(document.patient_id), studyId: String(document.study_id), originalName: stagedFile.originalName, mimeType: stagedFile.mimeType, sizeBytes: stagedFile.sizeBytes, sha256: stagedFile.sha256, updatedBy: String(req.auth.user.id) } });
  } catch (error) {
    if (journalCommitted) blockStorage(error?.code, operation?.operationId);
    if (stagedFile && !journalCommitted) await unlinkKey(config.root, stagedFile.stagingKey).catch(() => {});
    if (error instanceof DocumentInputError) return inputResponse(res, req, error);
    sendDatabaseError(res, req, error, 'documents.replace', 'No se pudo reemplazar el archivo.');
  }
});

router.delete('/documentos/:id', optionalAuth, requireAuth, requirePermission('documents.delete'), requireStorageReady, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'El identificador no es válido.', requestId: req.requestId } });
  const config = readFileStorageConfig();
  if (!config.root) return res.status(503).json({ error: { code: 'FILE_STORAGE_NOT_CONFIGURED', message: 'El almacenamiento de archivos no está configurado.', requestId: req.requestId } });
  const pool = database.getPool();
  let operation;
  let document;
  let journalCommitted = false;
  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const rows = await connection.query(
        `SELECT id, patient_id, study_id, storage_key, sha256, file_status FROM documents WHERE id = ? FOR UPDATE`, [id],
      );
      document = rows[0];
      if (!document || document.file_status !== 'active') {
        await connection.rollback();
        return res.status(404).json({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'No se encontró el documento activo.', requestId: req.requestId } });
      }
      const existingFile = await fileInfo(config.root, document.storage_key);
      if (!existingFile || existingFile.sha256 !== document.sha256) throw new DocumentInputError('DOCUMENT_FILE_INCONSISTENT', 'El archivo no coincide con sus metadatos; se requiere revisión técnica.');
      operation = { operationId: randomUUID(), documentId: String(document.id), patientId: String(document.patient_id), studyId: String(document.study_id), oldKey: document.storage_key, backupKey: `.staging/${randomUUID()}.deleted`, oldSha256: document.sha256, actorId: req.auth.user.id };
      await connection.query(
        `INSERT INTO document_file_operations
         (operation_id, operation_type, operation_state, document_id, patient_id, study_id, backup_key, old_storage_key, old_sha256, actor_user_id)
         VALUES (?, 'delete', 'prepared', ?, ?, ?, ?, ?, ?, ?)`,
        [operation.operationId, operation.documentId, operation.patientId, operation.studyId, operation.backupKey, operation.oldKey, operation.oldSha256, operation.actorId],
      );
      await connection.query("UPDATE documents SET file_status = 'deleting' WHERE id = ?", [id]);
      await connection.commit();
      journalCommitted = true;
    } catch (error) { await connection.rollback().catch(() => {}); throw error; }
    finally { connection.release(); }

    await moveKey(config.root, operation.oldKey, operation.backupKey);
    const movedFile = await fileInfo(config.root, operation.backupKey);
    if (!movedFile || movedFile.sha256 !== operation.oldSha256) throw new Error('DOCUMENT_DELETE_MOVE_MISMATCH');
    await setFilesystemApplied(pool, operation.operationId);
    await finishDelete(pool, config.root, { ...operation, operation_state: 'filesystem_applied' });
    return res.status(204).end();
  } catch (error) {
    if (journalCommitted) blockStorage(error?.code, operation?.operationId);
    if (error instanceof DocumentInputError) return inputResponse(res, req, error);
    sendDatabaseError(res, req, error, 'documents.delete', 'No se pudo eliminar el archivo.');
  }
});

module.exports = router;
