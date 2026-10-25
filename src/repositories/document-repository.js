async function findStudyForUpload(connection, studyId, lock = false) {
  const rows = await connection.query(
    `SELECT s.id AS studyId, s.patient_id AS patientId, s.study_date AS studyDate, s.study_type AS studyType,
            p.dni AS patientDni, p.full_name AS patientName
     FROM studies s JOIN patients p ON p.id = s.patient_id
     WHERE s.id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [studyId],
  );
  return rows[0] || null;
}

async function listActiveByStudy(connection, studyId) {
  return connection.query(
    `SELECT id, study_id AS studyId, original_name AS originalName, mime_type AS mimeType,
            size_bytes AS sizeBytes, sha256, uploaded_by AS uploadedBy, created_at AS createdAt,
            updated_at AS updatedAt, updated_by AS updatedBy
     FROM documents WHERE study_id = ? AND file_status = 'active' ORDER BY id`,
    [studyId],
  );
}

async function findActiveById(connection, id) {
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

async function canReadImages(pool, userId) {
  const rows = await pool.query(
    `SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id WHERE ur.user_id = ? AND p.code = 'images.read' LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

async function insertPending(connection, document) {
  return connection.query(
    `INSERT INTO documents (patient_id, study_id, original_name, storage_key, mime_type, size_bytes, sha256, uploaded_by, file_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [document.patientId, document.studyId, document.originalName, document.storageKey, document.mimeType, document.sizeBytes, document.sha256, document.uploadedBy],
  );
}

async function setStorageKey(connection, storageKey, id) {
  return connection.query('UPDATE documents SET storage_key = ? WHERE id = ?', [storageKey, id]);
}

async function createReplacementOperation(connection, operation) {
  return connection.query(
    `INSERT INTO document_file_operations
     (operation_id, operation_type, operation_state, document_id, patient_id, study_id, staging_key, backup_key,
      old_storage_key, new_storage_key, original_name, mime_type, size_bytes, sha256, old_sha256, actor_user_id)
     VALUES (?, ?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [operation.operationId, operation.type, operation.documentId, operation.patientId, operation.studyId,
      operation.stagingKey, operation.backupKey, operation.oldKey, operation.newKey,
      operation.originalName, operation.mimeType, operation.sizeBytes, operation.sha256,
      operation.oldSha256, operation.actorId],
  );
}

async function createUploadOperation(connection, operation) {
  return connection.query(
    `INSERT INTO document_file_operations
     (operation_id, operation_type, operation_state, document_id, patient_id, study_id, staging_key, new_storage_key,
      original_name, mime_type, size_bytes, sha256, actor_user_id)
     VALUES (?, 'upload', 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [operation.operationId, operation.documentId, operation.patientId, operation.studyId, operation.stagingKey,
      operation.newKey, operation.originalName, operation.mimeType, operation.sizeBytes, operation.sha256, operation.actorId],
  );
}

async function createDeleteOperation(connection, operation) {
  return connection.query(
    `INSERT INTO document_file_operations
     (operation_id, operation_type, operation_state, document_id, patient_id, study_id, backup_key, old_storage_key, old_sha256, actor_user_id)
     VALUES (?, 'delete', 'prepared', ?, ?, ?, ?, ?, ?, ?)`,
    [operation.operationId, operation.documentId, operation.patientId, operation.studyId, operation.backupKey, operation.oldKey, operation.oldSha256, operation.actorId],
  );
}

async function activatePending(connection, id) {
  return connection.query("UPDATE documents SET file_status = 'active' WHERE id = ? AND file_status = 'pending'", [id]);
}

async function markReplacing(connection, id) {
  return connection.query("UPDATE documents SET file_status = 'replacing' WHERE id = ?", [id]);
}

async function markDeleting(connection, id) {
  return connection.query("UPDATE documents SET file_status = 'deleting' WHERE id = ?", [id]);
}

async function updateReplacement(connection, operation) {
  return connection.query(
    `UPDATE documents SET storage_key = ?, original_name = ?, mime_type = ?, size_bytes = ?, sha256 = ?,
                          updated_by = ?, file_status = 'active'
     WHERE id = ? AND file_status = 'replacing'`,
    [operation.newKey, operation.originalName, operation.mimeType, operation.sizeBytes, operation.sha256, operation.actorId, operation.documentId],
  );
}

async function findForReplacement(connection, id) {
  const rows = await connection.query(
    `SELECT d.id, d.patient_id, d.study_id, d.storage_key, d.sha256, d.size_bytes, d.file_status, s.study_date, s.study_type,
            p.dni AS patient_dni, p.full_name AS patient_name
     FROM documents d JOIN studies s ON s.id = d.study_id JOIN patients p ON p.id = d.patient_id
     WHERE d.id = ? FOR UPDATE`, [id],
  );
  return rows[0] || null;
}

async function findForDeletion(connection, id) {
  const rows = await connection.query(
    'SELECT id, patient_id, study_id, storage_key, sha256, file_status FROM documents WHERE id = ? FOR UPDATE', [id],
  );
  return rows[0] || null;
}

async function insertAudit(connection, { userId, action, entityType, entityId, details, clientIp }) {
  return connection.query(
    'INSERT INTO audit_events (user_id, action_code, entity_type, entity_id, details_json, client_ip) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, action, entityType, String(entityId), JSON.stringify(details), clientIp || null],
  );
}

async function completePreparedOperation(connection, operationId) {
  return connection.query("UPDATE document_file_operations SET operation_state = 'completed' WHERE operation_id = ? AND operation_state = 'filesystem_applied'", [operationId]);
}

async function completeUploadOperation(connection, operationId) {
  return connection.query("UPDATE document_file_operations SET operation_state = 'completed' WHERE operation_id = ? AND operation_state = 'filesystem_applied'", [operationId]);
}

module.exports = {
  findStudyForUpload, listActiveByStudy, findActiveById, canReadImages, insertPending, setStorageKey,
  createReplacementOperation, createDeleteOperation, createUploadOperation, activatePending,
  markReplacing, markDeleting, updateReplacement, findForReplacement, findForDeletion, insertAudit,
  completePreparedOperation, completeUploadOperation,
};
