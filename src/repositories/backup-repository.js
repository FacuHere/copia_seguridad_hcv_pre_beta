async function cargarPacientes(connection) {
  return connection.query(
    `SELECT p.id, p.full_name AS fullName, p.dni, DATE_FORMAT(p.birth_date, '%Y-%m-%d') AS birthDate,
            p.phone, p.address, p.notes, p.version, uc.username AS createdByUsername,
            uu.username AS updatedByUsername, DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
            DATE_FORMAT(p.updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt
     FROM patients p
     JOIN app_users uc ON uc.id = p.created_by
     JOIN app_users uu ON uu.id = p.updated_by
     ORDER BY p.id`,
  );
}

async function cargarEstudios(connection) {
  return connection.query(
    `SELECT s.id, s.patient_id AS patientId, sv.code AS serviceCode, s.study_type AS type,
            DATE_FORMAT(s.study_date, '%Y-%m-%d') AS date, s.professional, s.diagnosis,
            s.procedure_description AS \`procedure\`, s.description, s.conclusions, s.version,
            uc.username AS createdByUsername, uu.username AS updatedByUsername,
            DATE_FORMAT(s.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
            DATE_FORMAT(s.updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt
     FROM studies s
     JOIN services sv ON sv.id = s.service_id
     JOIN app_users uc ON uc.id = s.created_by
     JOIN app_users uu ON uu.id = s.updated_by
     ORDER BY s.id`,
  );
}

async function cargarDocumentos(connection) {
  return connection.query(
    `SELECT d.id, d.patient_id AS patientId, d.study_id AS studyId, d.original_name AS originalName,
            d.mime_type AS mimeType, d.size_bytes AS sizeBytes, d.sha256,
            uc.username AS uploadedByUsername, uu.username AS updatedByUsername,
            DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS createdAt,
            DATE_FORMAT(d.updated_at, '%Y-%m-%d %H:%i:%s') AS updatedAt,
            d.derived_from_document_id AS derivedFromDocumentId
     FROM documents d
     JOIN app_users uc ON uc.id = d.uploaded_by
     LEFT JOIN app_users uu ON uu.id = d.updated_by
     WHERE d.file_status = 'active'
     ORDER BY d.id`,
  );
}

async function contarDocumentosNoActivos(connection) {
  const filas = await connection.query("SELECT COUNT(*) AS total FROM documents WHERE file_status <> 'active'");
  return Number(filas[0]?.total || 0);
}

async function cargarReferenciasUsuarios(connection) {
  const filas = await connection.query(
    `SELECT u.username, u.display_name AS displayName, u.is_active AS isActive,
            r.code AS roleCode, p.code AS permissionCode
     FROM app_users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     ORDER BY u.username, r.code, p.code`,
  );
  const usuarios = new Map();
  for (const fila of filas) {
    if (!usuarios.has(fila.username)) usuarios.set(fila.username, {
      username: fila.username,
      displayName: fila.displayName,
      isActive: Boolean(fila.isActive),
      roles: new Map(),
    });
    if (fila.roleCode) {
      const usuario = usuarios.get(fila.username);
      if (!usuario.roles.has(fila.roleCode)) usuario.roles.set(fila.roleCode, new Set());
      if (fila.permissionCode) usuario.roles.get(fila.roleCode).add(fila.permissionCode);
    }
  }
  return [...usuarios.values()].map(usuario => ({
    ...usuario,
    roles: [...usuario.roles.entries()].map(([codigo, permisos]) => ({ codigo, permisos: [...permisos] })),
  }));
}

async function insertarAuditoria(connection, { userId, action, entityId, details, clientIp }) {
  return connection.query(
    `INSERT INTO audit_events (user_id, action_code, entity_type, entity_id, details_json, client_ip)
     VALUES (?, ?, 'backup_restore', ?, ?, ?)`,
    [userId, action, String(entityId), JSON.stringify(details), clientIp || null],
  );
}

async function crearOperacion(connection, operacion) {
  return connection.query(
    `INSERT INTO backup_restore_operations
     (operation_id, operation_mode, operation_state, actor_user_id, expected_patients, expected_studies, expected_documents)
     VALUES (?, ?, 'recibiendo', ?, ?, ?, ?)`,
    [operacion.operationId, operacion.mode, operacion.actorId, operacion.expectedPatients, operacion.expectedStudies, operacion.expectedDocuments],
  );
}

async function buscarOperacion(connection, operationId) {
  const filas = await connection.query('SELECT * FROM backup_restore_operations WHERE operation_id = ? LIMIT 1', [operationId]);
  return filas[0] || null;
}

async function buscarOperacionParaActualizar(connection, operationId) {
  const filas = await connection.query('SELECT * FROM backup_restore_operations WHERE operation_id = ? LIMIT 1 FOR UPDATE', [operationId]);
  return filas[0] || null;
}

async function cambiarEstado(connection, operationId, previousState, nextState, failureCode = null) {
  return connection.query(
    'UPDATE backup_restore_operations SET operation_state = ?, failure_code = ? WHERE operation_id = ? AND operation_state = ?',
    [nextState, failureCode, operationId, previousState],
  );
}

async function cambiarEstadoActual(connection, operationId, nextState, failureCode = null) {
  return connection.query(
    'UPDATE backup_restore_operations SET operation_state = ?, failure_code = ? WHERE operation_id = ?',
    [nextState, failureCode, operationId],
  );
}

async function guardarRegistros(connection, operationId, tipo, registros) {
  for (const registro of registros) {
    await connection.query(
      'INSERT INTO backup_restore_records (operation_id, record_type, source_id, record_json) VALUES (?, ?, ?, ?)',
      [operationId, tipo, String(registro.id), JSON.stringify(registro)],
    );
  }
}

async function cargarRegistros(connection, operationId, tipo) {
  const filas = await connection.query(
    'SELECT source_id AS sourceId, record_json AS recordJson FROM backup_restore_records WHERE operation_id = ? AND record_type = ? ORDER BY source_id',
    [operationId, tipo],
  );
  return filas.map(fila => ({ sourceId: fila.sourceId, value: JSON.parse(fila.recordJson) }));
}

async function contarRegistros(connection, operationId) {
  const filas = await connection.query(
    'SELECT record_type AS type, COUNT(*) AS total FROM backup_restore_records WHERE operation_id = ? GROUP BY record_type',
    [operationId],
  );
  return Object.fromEntries(filas.map(fila => [fila.type, Number(fila.total)]));
}

async function buscarRegistro(connection, operationId, tipo, sourceId) {
  const filas = await connection.query(
    'SELECT record_json AS recordJson FROM backup_restore_records WHERE operation_id = ? AND record_type = ? AND source_id = ? LIMIT 1',
    [operationId, tipo, String(sourceId)],
  );
  return filas[0] ? JSON.parse(filas[0].recordJson) : null;
}

async function guardarArchivo(connection, archivo) {
  return connection.query(
    `INSERT INTO backup_restore_files
     (operation_id, file_role, source_document_id, file_key, target_key, original_name, mime_type, size_bytes, sha256, file_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [archivo.operationId, archivo.role, String(archivo.sourceDocumentId), archivo.fileKey, archivo.targetKey || null,
      archivo.originalName || null, archivo.mimeType || null, archivo.sizeBytes ?? null, archivo.sha256 || null, archivo.state || 'preparado'],
  );
}

async function actualizarArchivo(connection, operationId, role, sourceDocumentId, changes) {
  const assignments = [];
  const values = [];
  for (const [property, column] of [['fileKey', 'file_key'], ['targetKey', 'target_key'], ['state', 'file_state']]) {
    if (Object.hasOwn(changes, property)) { assignments.push(`${column} = ?`); values.push(changes[property]); }
  }
  if (!assignments.length) return { affectedRows: 0 };
  return connection.query(
    `UPDATE backup_restore_files SET ${assignments.join(', ')} WHERE operation_id = ? AND file_role = ? AND source_document_id = ?`,
    [...values, operationId, role, String(sourceDocumentId)],
  );
}

async function cargarArchivos(connection, operationId, role = null) {
  if (role) return connection.query('SELECT * FROM backup_restore_files WHERE operation_id = ? AND file_role = ? ORDER BY source_document_id', [operationId, role]);
  return connection.query('SELECT * FROM backup_restore_files WHERE operation_id = ? ORDER BY file_role, source_document_id', [operationId]);
}

async function listarOperacionesPendientes(pool) {
  return pool.query(
    `SELECT * FROM backup_restore_operations o
     WHERE operation_state IN ('recibiendo', 'aplicando', 'limpieza_pendiente', 'requiere_atencion')
        OR (operation_state = 'fallido' AND (
          EXISTS (SELECT 1 FROM backup_restore_files f WHERE f.operation_id = o.operation_id)
          OR EXISTS (SELECT 1 FROM backup_restore_records r WHERE r.operation_id = o.operation_id)
        ))
     ORDER BY created_at, operation_id`,
  );
}

async function existeJournal(pool) {
  const filas = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'backup_restore_operations' LIMIT 1",
  );
  return filas.length > 0;
}

async function resumenClinico(connection) {
  const conteos = await connection.query(
    `SELECT (SELECT COUNT(*) FROM patients) AS patients,
            (SELECT COUNT(*) FROM studies) AS studies,
            (SELECT COUNT(*) FROM documents) AS documents`,
  );
  const pacientes = await connection.query('SELECT id, full_name AS fullName, dni FROM patients ORDER BY id LIMIT 25');
  return {
    pacientes: Number(conteos[0]?.patients || 0),
    estudios: Number(conteos[0]?.studies || 0),
    documentos: Number(conteos[0]?.documents || 0),
    muestraPacientes: pacientes.map(fila => ({ id: String(fila.id), nombre: fila.fullName, dni: fila.dni })),
    hayMasPacientes: Number(conteos[0]?.patients || 0) > pacientes.length,
  };
}

async function eliminarDetallesOperacion(connection, operationId) {
  await connection.query('DELETE FROM backup_restore_files WHERE operation_id = ?', [operationId]);
  await connection.query('DELETE FROM backup_restore_records WHERE operation_id = ?', [operationId]);
}

async function listarDocumentosActuales(connection) {
  return connection.query('SELECT id, storage_key AS storageKey, file_status AS status FROM documents ORDER BY id FOR UPDATE');
}

async function actualizarClaveDocumento(connection, documentId, storageKey) {
  return connection.query('UPDATE documents SET storage_key = ? WHERE id = ?', [storageKey, documentId]);
}

async function listarOperacionesDocumentalesPendientes(connection) {
  return connection.query(
    `SELECT operation_id FROM document_file_operations
     WHERE operation_state IN ('prepared', 'filesystem_applied')
     FOR UPDATE`,
  );
}

async function clavesReferenciadas(connection, keys) {
  if (!keys.length) return new Set();
  const marks = keys.map(() => '?').join(', ');
  const filas = await connection.query(`SELECT storage_key FROM documents WHERE storage_key IN (${marks})`, keys);
  return new Set(filas.map(fila => fila.storage_key));
}

async function buscarUsuarios(connection, usernames) {
  const unique = [...new Set(usernames.filter(Boolean))];
  if (!unique.length) return new Map();
  const marks = unique.map(() => '?').join(', ');
  const filas = await connection.query(`SELECT id, username FROM app_users WHERE username IN (${marks})`, unique);
  return new Map(filas.map(fila => [fila.username, String(fila.id)]));
}

async function buscarServicios(connection, codes) {
  const unique = [...new Set(codes.filter(Boolean))];
  if (!unique.length) return new Map();
  const marks = unique.map(() => '?').join(', ');
  const filas = await connection.query(`SELECT id, code FROM services WHERE code IN (${marks})`, unique);
  return new Map(filas.map(fila => [fila.code, String(fila.id)]));
}

async function insertarPaciente(connection, paciente, authors) {
  return connection.query(
    `INSERT INTO patients (full_name, dni, birth_date, phone, address, notes, version, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [paciente.fullName, paciente.dni, paciente.birthDate, paciente.phone, paciente.address, paciente.notes,
      paciente.version, authors.createdBy, authors.updatedBy, paciente.createdAt, paciente.updatedAt],
  );
}

async function insertarEstudio(connection, estudio, patientId, serviceId, authors) {
  return connection.query(
    `INSERT INTO studies (patient_id, service_id, study_type, study_date, professional, diagnosis,
                          procedure_description, description, conclusions, version, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [patientId, serviceId, estudio.type, estudio.date, estudio.professional, estudio.diagnosis,
      estudio.procedure, estudio.description, estudio.conclusions, estudio.version,
      authors.createdBy, authors.updatedBy, estudio.createdAt, estudio.updatedAt],
  );
}

async function insertarDocumento(connection, documento, patientId, studyId, uploadedBy, updatedBy) {
  return connection.query(
    `INSERT INTO documents
     (patient_id, study_id, original_name, storage_key, mime_type, size_bytes, sha256, uploaded_by,
      created_at, updated_at, updated_by, derived_from_document_id, file_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'active')`,
    [patientId, studyId, documento.originalName, documento.storageKey, documento.mimeType,
      documento.sizeBytes, documento.sha256, uploadedBy, documento.createdAt, documento.updatedAt, updatedBy],
  );
}

async function vincularDocumentoDerivado(connection, documentId, parentId) {
  return connection.query('UPDATE documents SET derived_from_document_id = ? WHERE id = ?', [parentId, documentId]);
}

async function eliminarDatosClinicos(connection) {
  await connection.query('UPDATE documents SET derived_from_document_id = NULL WHERE derived_from_document_id IS NOT NULL');
  await connection.query('DELETE FROM documents');
  await connection.query('DELETE FROM studies');
  await connection.query('DELETE FROM patients');
}

module.exports = {
  cargarPacientes, cargarEstudios, cargarDocumentos, contarDocumentosNoActivos, cargarReferenciasUsuarios, insertarAuditoria,
  crearOperacion, buscarOperacion, buscarOperacionParaActualizar, cambiarEstado, cambiarEstadoActual, guardarRegistros, cargarRegistros, contarRegistros, buscarRegistro,
  guardarArchivo, actualizarArchivo, cargarArchivos, listarOperacionesPendientes, existeJournal, resumenClinico, eliminarDetallesOperacion,
  listarDocumentosActuales, listarOperacionesDocumentalesPendientes, clavesReferenciadas,
  buscarUsuarios, buscarServicios, insertarPaciente, insertarEstudio, insertarDocumento,
  vincularDocumentoDerivado, eliminarDatosClinicos, actualizarClaveDocumento,
};
