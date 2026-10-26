function scopeColumn(operationType) {
  if (operationType === 'rename_patient') return 'patient_id';
  if (operationType === 'rename_study') return 'study_id';
  throw new Error('INVALID_RENAME_OPERATION');
}

async function markFilesystemApplied(pool, operationId) {
  const result = await pool.query(
    "UPDATE document_file_operations SET operation_state = 'filesystem_applied' WHERE operation_id = ? AND operation_state = 'prepared'",
    [operationId],
  );
  if (result?.affectedRows === 1) return true;
  const rows = await pool.query('SELECT operation_state FROM document_file_operations WHERE operation_id = ? LIMIT 1', [operationId]);
  return rows[0]?.operation_state === 'filesystem_applied';
}

async function activatePendingDocument(connection, documentId) {
  return connection.query("UPDATE documents SET file_status = 'active' WHERE id = ? AND file_status = 'pending'", [documentId]);
}

async function updateReplacement(connection, operation) {
  return connection.query(
    `UPDATE documents SET storage_key = ?, original_name = ?, mime_type = ?, size_bytes = ?, sha256 = ?,
                          updated_by = ?, file_status = 'active'
     WHERE id = ? AND file_status = 'replacing'`,
    [operation.new_storage_key, operation.original_name, operation.mime_type, operation.size_bytes, operation.sha256, operation.actor_user_id, operation.document_id],
  );
}

async function deleteDeletingDocument(connection, documentId) {
  return connection.query('DELETE FROM documents WHERE id = ? AND file_status = \'deleting\'', [documentId]);
}

async function deletePendingDocument(connection, documentId) {
  return connection.query("DELETE FROM documents WHERE id = ? AND file_status = 'pending'", [documentId]);
}

async function markOperationFailed(connection, operationId, reasonCode) {
  return connection.query("UPDATE document_file_operations SET operation_state = 'failed', failure_code = ? WHERE operation_id = ?", [reasonCode, operationId]);
}

async function markReplacementRestored(connection, operationId, documentId) {
  await connection.query("UPDATE documents SET file_status = 'active' WHERE id = ? AND file_status = 'replacing'", [documentId]);
  return connection.query("UPDATE document_file_operations SET operation_state = 'failed', failure_code = 'RECOVERY_REPLACEMENT_ROLLED_BACK' WHERE operation_id = ?", [operationId]);
}

async function insertAudit(connection, { userId, action, entityType, entityId, details }) {
  return connection.query(
    'INSERT INTO audit_events (user_id, action_code, entity_type, entity_id, details_json) VALUES (?, ?, ?, ?, ?)',
    [userId, action, entityType, String(entityId), JSON.stringify(details)],
  );
}

async function completeOperation(connection, operationId, allowedStates = ['prepared', 'filesystem_applied']) {
  const allowedStateClause = allowedStates.map(() => '?').join(', ');
  return connection.query(
    `UPDATE document_file_operations SET operation_state = 'completed' WHERE operation_id = ? AND operation_state IN (${allowedStateClause})`,
    [operationId, ...allowedStates],
  );
}

async function limpiarReferenciasTemporalesCompletadas(conexion, operacionId) {
  const resultado = await conexion.query(
    "UPDATE document_file_operations SET staging_key = NULL, backup_key = NULL WHERE operation_id = ? AND operation_state = 'completed'",
    [operacionId],
  );
  if (resultado.affectedRows === 1) return true;
  const filas = await conexion.query(
    'SELECT operation_state, staging_key, backup_key FROM document_file_operations WHERE operation_id = ? LIMIT 1',
    [operacionId],
  );
  return filas[0]?.operation_state === 'completed' && filas[0].staging_key === null && filas[0].backup_key === null;
}

async function findDocumentInProgress(connection, documentId) {
  const rows = await connection.query('SELECT storage_key, size_bytes, sha256 FROM documents WHERE id = ? AND file_status = \'moving\' LIMIT 1', [documentId]);
  return rows[0] || null;
}

async function moveDocumentKey(connection, nextKey, documentId) {
  return connection.query("UPDATE documents SET storage_key = ?, file_status = 'moving' WHERE id = ? AND file_status = 'active'", [nextKey, documentId]);
}

async function activateMovingDocument(connection, documentId) {
  return connection.query("UPDATE documents SET file_status = 'active' WHERE id = ? AND file_status = 'moving'", [documentId]);
}

async function findDocumentsForLabelMove(connection, operationType, scopeId) {
  return connection.query(
    `SELECT id, storage_key, file_status FROM documents WHERE ${scopeColumn(operationType)} = ? FOR UPDATE`,
    [scopeId],
  );
}

async function findScopedDocumentIds(connection, operationType, scopeId) {
  return connection.query(`SELECT id FROM documents WHERE ${scopeColumn(operationType)} = ? LIMIT 1`, [scopeId]);
}

async function createRenameOperation(connection, operation) {
  return connection.query(
    `INSERT INTO document_file_operations
     (operation_id, operation_type, operation_state, patient_id, study_id, old_prefix, new_prefix, actor_user_id)
     VALUES (?, ?, 'prepared', ?, ?, ?, ?, ?)`,
    [operation.operation_id, operation.operation_type, operation.patient_id, operation.study_id, operation.old_prefix, operation.new_prefix, operation.actor_user_id],
  );
}

async function findOperationsToRecover(pool) {
  return pool.query("SELECT * FROM document_file_operations WHERE operation_state IN ('prepared', 'filesystem_applied') OR (operation_state = 'completed' AND backup_key IS NOT NULL) ORDER BY CASE WHEN operation_type IN ('rename_patient', 'rename_study') THEN 1 ELSE 0 END, created_at, operation_id");
}

async function findActiveStagingKeys(pool) {
  return pool.query("SELECT staging_key, backup_key FROM document_file_operations WHERE operation_state IN ('prepared', 'filesystem_applied')");
}

async function hasOperationJournal(pool) {
  const rows = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'document_file_operations' LIMIT 1",
  );
  return rows.length > 0;
}

async function findPendingOperations(pool) {
  return pool.query(
    "SELECT operation_id, operation_type FROM document_file_operations WHERE operation_state IN ('prepared', 'filesystem_applied') OR (operation_state = 'completed' AND backup_key IS NOT NULL)",
  );
}

module.exports = {
  markFilesystemApplied, activatePendingDocument, updateReplacement, deleteDeletingDocument,
  deletePendingDocument, markOperationFailed, markReplacementRestored, insertAudit,
  completeOperation, findDocumentInProgress, moveDocumentKey,
  limpiarReferenciasTemporalesCompletadas,
  activateMovingDocument, findDocumentsForLabelMove, findScopedDocumentIds,
  createRenameOperation, findOperationsToRecover, findActiveStagingKeys,
  hasOperationJournal, findPendingOperations,
};
