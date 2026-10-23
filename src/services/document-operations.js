const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { resolveStoragePath, assertNoLinks, ensurePrivateRoot, moveKey, unlinkKey, mergeDirectoryPrefix } = require('./document-storage');
const { state: storageReadiness } = require('./storage-readiness');
const documentOperationRepository = require('../repositories/document-operation-repository');

function affected(result, operation) {
  if (!result || result.affectedRows !== 1) {
    const errorCode = `DOCUMENT_OPERATION_ROW_MISMATCH_${String(operation).toUpperCase()}`;
    const error = new Error(errorCode);
    error.code = errorCode;
    throw error;
  }
}

async function setFilesystemApplied(pool, operationId) {
  const updated = await documentOperationRepository.markFilesystemApplied(pool, operationId);
  if (!updated) affected(null, 'journal_filesystem_applied');
}

async function fileInfo(root, key) {
  if (!key) return null;
  const target = resolveStoragePath(root, key);
  await assertNoLinks(root, target, true);
  try {
    const stat = await fs.promises.stat(target);
    if (!stat.isFile()) return null;
    const sha256 = await new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = fs.createReadStream(target);
      let digest;
      stream.on('data', chunk => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => { digest = hash.digest('hex'); });
      stream.on('close', () => digest ? resolve(digest) : reject(new Error('DOCUMENT_HASH_STREAM_INCOMPLETE')));
    });
    return { size: stat.size, sha256 };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function finishUpload(pool, root, operation) {
  const target = await fileInfo(root, operation.new_storage_key);
  if (!target || target.size !== Number(operation.size_bytes) || target.sha256 !== operation.sha256) {
    throw new Error('DOCUMENT_OPERATION_FILE_MISMATCH');
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    affected(await documentOperationRepository.activatePendingDocument(connection, operation.document_id), 'activate_upload');
    await documentOperationRepository.insertAudit(connection, {
      userId: operation.actor_user_id, action: 'document.upload', entityType: 'document', entityId: operation.document_id,
      details: { studyId: String(operation.study_id), patientId: String(operation.patient_id), sizeBytes: Number(operation.size_bytes), sha256: operation.sha256, result: 'success' },
    });
    affected(await documentOperationRepository.completeOperation(connection, operation.operation_id), 'complete_upload');
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}

async function finishReplacement(pool, root, operation) {
  const target = await fileInfo(root, operation.new_storage_key);
  if (!target || target.size !== Number(operation.size_bytes) || target.sha256 !== operation.sha256) {
    throw new Error('DOCUMENT_OPERATION_FILE_MISMATCH');
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    affected(await documentOperationRepository.updateReplacement(connection, operation), 'finalize_replacement');
    await documentOperationRepository.insertAudit(connection, {
      userId: operation.actor_user_id, action: 'document.replace', entityType: 'document', entityId: operation.document_id,
      details: { studyId: String(operation.study_id), patientId: String(operation.patient_id), previousSha256: operation.old_sha256 || null, sha256: operation.sha256, sizeBytes: Number(operation.size_bytes), result: 'success' },
    });
    affected(await documentOperationRepository.completeOperation(connection, operation.operation_id), 'complete_replacement');
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
  if (operation.backup_key) await unlinkKey(root, operation.backup_key);
}

async function finishDelete(pool, root, operation) {
  const operationId = operation.operation_id ?? operation.operationId;
  const documentId = operation.document_id ?? operation.documentId;
  const patientId = operation.patient_id ?? operation.patientId;
  const studyId = operation.study_id ?? operation.studyId;
  const actorId = operation.actor_user_id ?? operation.actorId;
  const expectedHash = operation.sha256 || operation.old_sha256 || operation.oldSha256 || null;
  // A prepared deletion may only be finalized after the old file has been moved
  // to its journaled staging key. An already absent backup is accepted only
  // after filesystem_applied was durably recorded (unlink completed).
  const backup = await fileInfo(root, operation.backup_key);
  const old = await fileInfo(root, operation.old_storage_key);
  if (backup) {
    if (expectedHash && backup.sha256 !== expectedHash) throw new Error('DOCUMENT_DELETE_BACKUP_MISMATCH');
    await setFilesystemApplied(pool, operationId);
    await unlinkKey(root, operation.backup_key);
  } else if (old) {
    if (expectedHash && old.sha256 !== expectedHash) throw new Error('DOCUMENT_DELETE_SOURCE_MISMATCH');
    await moveKey(root, operation.old_storage_key, operation.backup_key);
    const moved = await fileInfo(root, operation.backup_key);
    if (!moved || (expectedHash && moved.sha256 !== expectedHash)) throw new Error('DOCUMENT_DELETE_MOVE_MISMATCH');
    await setFilesystemApplied(pool, operationId);
    await unlinkKey(root, operation.backup_key);
  } else if (operation.operation_state !== 'filesystem_applied') {
    throw new Error('DOCUMENT_DELETE_FILE_MISSING_BEFORE_DELETE');
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    affected(await documentOperationRepository.deleteDeletingDocument(connection, documentId), 'delete_document');
    await documentOperationRepository.insertAudit(connection, {
      userId: actorId, action: 'document.delete', entityType: 'document', entityId: documentId,
      details: { studyId: String(studyId), patientId: String(patientId), sha256: expectedHash, result: 'success' },
    });
    affected(await documentOperationRepository.completeOperation(connection, operationId, ['filesystem_applied']), 'complete_delete');
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}

async function failUpload(pool, operation, reasonCode) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await documentOperationRepository.deletePendingDocument(connection, operation.document_id);
    await documentOperationRepository.markOperationFailed(connection, operation.operation_id, reasonCode);
    await documentOperationRepository.insertAudit(connection, {
      userId: operation.actor_user_id, action: 'document.upload_failed', entityType: 'document', entityId: operation.document_id,
      details: { studyId: String(operation.study_id), patientId: String(operation.patient_id), result: 'failed', reasonCode },
    });
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
}

async function completeRename(pool, root, operation) {
  const connection = await pool.getConnection();
  let movingRows = [];
  try {
    await connection.beginTransaction();
    const scopeId = operation.operation_type === 'rename_patient' ? operation.patient_id : operation.study_id;
    const rows = await documentOperationRepository.findDocumentsForLabelMove(connection, operation.operation_type, scopeId);
    if (rows.some(row => !['active', 'moving'].includes(row.file_status))) {
      const error = new Error('DOCUMENT_OPERATION_IN_PROGRESS'); error.code = 'DOCUMENT_OPERATION_IN_PROGRESS'; throw error;
    }
    for (const row of rows) {
      if (row.file_status === 'moving') {
        if (!row.storage_key.startsWith(`${operation.new_prefix}/`)) throw new Error('DOCUMENT_RENAME_KEY_MISMATCH');
        movingRows.push(row.id);
      } else if (row.storage_key.startsWith(`${operation.old_prefix}/`)) {
        const nextKey = `${operation.new_prefix}${row.storage_key.slice(operation.old_prefix.length)}`;
        await documentOperationRepository.moveDocumentKey(connection, nextKey, row.id);
        movingRows.push(row.id);
      }
    }
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }

  await mergeDirectoryPrefix(root, operation.old_prefix, operation.new_prefix);
  for (const id of movingRows) {
    const connection = await pool.getConnection();
    try {
      const row = await documentOperationRepository.findDocumentInProgress(connection, id);
      if (!row || !row.storage_key.startsWith(`${operation.new_prefix}/`)) throw new Error('DOCUMENT_RENAME_KEY_MISMATCH');
      const info = await fileInfo(root, row.storage_key);
      if (!info || info.size !== Number(row.size_bytes) || info.sha256 !== row.sha256) throw new Error('DOCUMENT_RENAME_FILE_MISMATCH');
    } finally { connection.release(); }
  }

  const finalize = await pool.getConnection();
  try {
    await finalize.beginTransaction();
    for (const id of movingRows) affected(await documentOperationRepository.activateMovingDocument(finalize, id), 'activate_moved_document');
    affected(await documentOperationRepository.completeOperation(finalize, operation.operation_id), 'complete_rename');
    await documentOperationRepository.insertAudit(finalize, {
      userId: operation.actor_user_id, action: 'document.folder_rename',
      entityType: operation.operation_type === 'rename_patient' ? 'patient' : 'study',
      entityId: operation.operation_type === 'rename_patient' ? operation.patient_id : operation.study_id,
      details: { patientId: String(operation.patient_id), studyId: operation.study_id ? String(operation.study_id) : null, result: 'success' },
    });
    await finalize.commit();
  } catch (error) { await finalize.rollback().catch(() => {}); throw error; }
  finally { finalize.release(); }
}

function operationError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function assertRenameDoesNotAffectDocuments(connection, { type, scopeId }) {
  const rows = await documentOperationRepository.findScopedDocumentIds(connection, type, scopeId);
  if (rows.length) throw operationError('FILE_STORAGE_NOT_CONFIGURED_FOR_RENAME');
}

// Called inside the same MariaDB transaction as the patient/study label update.
// The journal and document keys/statuses therefore commit atomically with the
// labels that recovery will use after a process interruption.
async function prepareRenameInTransaction(connection, { type, patientId, studyId = null, oldPrefix, newPrefix, actorUserId }) {
  if (!['rename_patient', 'rename_study'].includes(type)) throw operationError('INVALID_RENAME_OPERATION');
  if (oldPrefix === newPrefix) return null;
  const scopeId = type === 'rename_patient' ? patientId : studyId;
  const rows = await documentOperationRepository.findDocumentsForLabelMove(connection, type, scopeId);
  if (!rows.length) return null;
  if (['blocked', 'recovering'].includes(storageReadiness.status)) throw operationError('STORAGE_RECOVERY_REQUIRED');
  if (rows.some(row => row.file_status !== 'active')) throw operationError('DOCUMENT_RENAME_IN_PROGRESS');
  if (rows.some(row => !row.storage_key.startsWith(`${oldPrefix}/`))) throw operationError('DOCUMENT_RENAME_SOURCE_MISMATCH');

  const { randomUUID } = require('node:crypto');
  const operation = {
    operation_id: randomUUID(), operation_type: type, operation_state: 'prepared',
    patient_id: patientId, study_id: studyId, actor_user_id: actorUserId,
    old_prefix: oldPrefix, new_prefix: newPrefix,
  };
  await documentOperationRepository.createRenameOperation(connection, operation);
  for (const row of rows) {
    const nextKey = `${newPrefix}${row.storage_key.slice(oldPrefix.length)}`;
    affected(await documentOperationRepository.moveDocumentKey(connection, nextKey, row.id), 'prepare_rename_document');
  }
  return operation;
}

async function renameStoragePrefix(pool, root, { type, patientId, studyId = null, oldPrefix, newPrefix, actorUserId }) {
  if (!['rename_patient', 'rename_study'].includes(type)) throw new Error('INVALID_RENAME_OPERATION');
  if (oldPrefix === newPrefix) return { moved: false };
  const connection = await pool.getConnection();
  let operation;
  try {
    await connection.beginTransaction();
    const scopeId = type === 'rename_patient' ? patientId : studyId;
    const rows = await documentOperationRepository.findDocumentsForLabelMove(connection, type, scopeId);
    const pendingOperation = rows.some(row => row.file_status !== 'active');
    const movingRows = rows.filter(row => row.storage_key.startsWith(`${oldPrefix}/`));
    if (!movingRows.length && !pendingOperation) { await connection.rollback(); return { moved: false }; }
    const { randomUUID } = require('node:crypto');
    const operationId = randomUUID();
    operation = { operation_id: operationId, operation_type: type, patient_id: patientId, study_id: studyId, actor_user_id: actorUserId, old_prefix: oldPrefix, new_prefix: newPrefix };
    await documentOperationRepository.createRenameOperation(connection, operation);
    if (!pendingOperation) {
      for (const row of movingRows) {
        const nextKey = `${newPrefix}${row.storage_key.slice(oldPrefix.length)}`;
        await documentOperationRepository.moveDocumentKey(connection, nextKey, row.id);
      }
    }
    await connection.commit();
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
  finally { connection.release(); }
  if (pendingOperation) return { moved: false, pending: true };
  await completeRename(pool, root, operation);
  return { moved: true };
}

async function recoverOperations(pool, root) {
  const operations = await documentOperationRepository.findOperationsToRecover(pool);
  const outcomes = [];
  for (const operation of operations) {
    try {
      if (operation.operation_state === 'completed') {
        if (operation.backup_key) await unlinkKey(root, operation.backup_key);
        if (operation.staging_key) await unlinkKey(root, operation.staging_key);
        outcomes.push({ operationId: operation.operation_id, outcome: 'cleanup_completed' });
      } else if (operation.operation_type === 'upload') {
        const staged = await fileInfo(root, operation.staging_key);
        const target = await fileInfo(root, operation.new_storage_key);
        if (!target && staged) await moveKey(root, operation.staging_key, operation.new_storage_key);
        const finalInfo = await fileInfo(root, operation.new_storage_key);
        if (finalInfo && finalInfo.size === Number(operation.size_bytes) && finalInfo.sha256 === operation.sha256) {
          await finishUpload(pool, root, operation);
          await unlinkKey(root, operation.staging_key);
          outcomes.push({ operationId: operation.operation_id, outcome: 'completed' });
        } else {
          await unlinkKey(root, operation.staging_key);
          await unlinkKey(root, operation.new_storage_key);
          await failUpload(pool, operation, 'RECOVERY_FILE_MISSING_OR_INVALID');
          outcomes.push({ operationId: operation.operation_id, outcome: 'failed' });
        }
      } else if (operation.operation_type === 'replace') {
        const staged = await fileInfo(root, operation.staging_key);
        const old = await fileInfo(root, operation.old_storage_key);
        const backup = await fileInfo(root, operation.backup_key);
        if (backup && operation.old_sha256 && backup.sha256 !== operation.old_sha256) throw new Error('DOCUMENT_REPLACEMENT_BACKUP_MISMATCH');
        if (!backup && old) {
          if (operation.old_sha256 && old.sha256 !== operation.old_sha256) throw new Error('DOCUMENT_REPLACEMENT_SOURCE_MISMATCH');
          await moveKey(root, operation.old_storage_key, operation.backup_key);
          const movedOld = await fileInfo(root, operation.backup_key);
          if (!movedOld || (operation.old_sha256 && movedOld.sha256 !== operation.old_sha256)) throw new Error('DOCUMENT_REPLACEMENT_BACKUP_MISMATCH');
        }
        if (!backup && !old) throw new Error('DOCUMENT_REPLACEMENT_OLD_FILE_MISSING');
        if (staged) await moveKey(root, operation.staging_key, operation.new_storage_key);
        const finalInfo = await fileInfo(root, operation.new_storage_key);
        if (finalInfo && finalInfo.size === Number(operation.size_bytes) && finalInfo.sha256 === operation.sha256) {
          await finishReplacement(pool, root, operation);
          await unlinkKey(root, operation.staging_key);
          outcomes.push({ operationId: operation.operation_id, outcome: 'completed' });
        } else {
          const backupNow = await fileInfo(root, operation.backup_key);
          if (backupNow) {
            await unlinkKey(root, operation.new_storage_key);
            await moveKey(root, operation.backup_key, operation.old_storage_key);
            const restored = await fileInfo(root, operation.old_storage_key);
            if (!restored || (operation.old_sha256 && restored.sha256 !== operation.old_sha256)) throw new Error('DOCUMENT_REPLACEMENT_RESTORE_FAILED');
          } else {
            const oldNow = await fileInfo(root, operation.old_storage_key);
            if (!oldNow || (operation.old_sha256 && oldNow.sha256 !== operation.old_sha256)) throw new Error('DOCUMENT_REPLACEMENT_OLD_FILE_MISSING');
          }
          await unlinkKey(root, operation.staging_key);
          const connection = await pool.getConnection();
          try {
            await documentOperationRepository.markReplacementRestored(connection, operation.operation_id, operation.document_id);
          } finally { connection.release(); }
          outcomes.push({ operationId: operation.operation_id, outcome: 'rolled_back' });
        }
      } else if (operation.operation_type === 'delete') {
        await finishDelete(pool, root, operation);
        outcomes.push({ operationId: operation.operation_id, outcome: 'completed' });
      } else if (['rename_patient', 'rename_study'].includes(operation.operation_type)) {
        await completeRename(pool, root, operation);
        outcomes.push({ operationId: operation.operation_id, outcome: 'completed' });
      }
    } catch (error) {
      outcomes.push({ operationId: operation.operation_id, outcome: 'needs_attention', errorCode: typeof error?.code === 'string' ? error.code : 'RECOVERY_FAILED' });
    }
  }
  return outcomes;
}

async function cleanupOrphanStaging(pool, root, { log = () => {} } = {}) {
  await ensurePrivateRoot(root);
  const stagingRoot = resolveStoragePath(root, '.staging');
  await assertNoLinks(root, stagingRoot, true);
  const active = await documentOperationRepository.findActiveStagingKeys(pool);
  const activeKeys = new Set(active.flatMap(row => [row.staging_key, row.backup_key]).filter(Boolean));
  const entries = await fs.promises.readdir(stagingRoot, { withFileTypes: true });
  const outcomes = [];
  for (const entry of entries) {
    // Legacy marker from versions that used a global storage lease. Ignore it
    // without opening or interpreting its contents; it is not an operation.
    if (entry.name === '.service.lock') continue;
    const key = `.staging/${entry.name}`;
    if (!entry.isFile() || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:part|old|deleted)$/i.test(entry.name)) {
      const outcome = { outcome: 'needs_attention', reason: 'UNRECOGNIZED_STAGING_ENTRY', key };
      outcomes.push(outcome);
      log(outcome);
      continue;
    }
    if (activeKeys.has(key)) {
      outcomes.push({ outcome: 'preserved_active', key });
      continue;
    }
    const target = resolveStoragePath(root, key);
    await assertNoLinks(root, target, true);
    await unlinkKey(root, key);
    const outcome = { outcome: 'orphan_removed', key };
    outcomes.push(outcome);
    log(outcome);
  }
  return outcomes;
}

module.exports = {
  fileInfo, finishUpload, finishReplacement, finishDelete, failUpload, renameStoragePrefix,
  prepareRenameInTransaction, assertRenameDoesNotAffectDocuments, completeRename,
  recoverOperations, setFilesystemApplied, cleanupOrphanStaging,
};
