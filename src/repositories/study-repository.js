const selectStudy = `SELECT id, patient_id AS patientId, service_id AS serviceId, study_type AS type,
                            DATE_FORMAT(study_date, '%Y-%m-%d') AS date, professional, diagnosis,
                            procedure_description AS \`procedure\`, description, conclusions, version,
                            created_at AS createdAt, updated_at AS updatedAt
                     FROM studies`;

async function listForPatient(connection, patientId) {
  return connection.query(`${selectStudy} WHERE patient_id = ? ORDER BY study_date DESC, id DESC`, [patientId]);
}

async function patientExists(connection, patientId) {
  const rows = await connection.query('SELECT id FROM patients WHERE id = ? LIMIT 1', [patientId]);
  return rows.length > 0;
}

async function audit(connection, userId, action, entityType, entityId, clientIp) {
  return connection.query(
    'INSERT INTO audit_events (user_id, action_code, entity_type, entity_id, client_ip) VALUES (?, ?, ?, ?, ?)',
    [userId, action, entityType, String(entityId), clientIp || null],
  );
}

async function findGeneralServiceId(connection) {
  const rows = await connection.query('SELECT id FROM services WHERE code = ? AND is_active = TRUE LIMIT 1', ['GENERAL']);
  return rows[0]?.id ?? null;
}

async function create(connection, study, serviceId, userId) {
  return connection.query(
    `INSERT INTO studies (patient_id, service_id, study_type, study_date, professional, diagnosis,
                         procedure_description, description, conclusions, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [study.patientId, serviceId, study.type, study.date, study.professional, study.diagnosis, study.procedure, study.description, study.conclusions, userId, userId],
  );
}

async function findById(connection, id) {
  const rows = await connection.query(`${selectStudy} WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function findForUpdate(connection, id) {
  const rows = await connection.query(
    `SELECT s.patient_id AS patientId, DATE_FORMAT(s.study_date, '%Y-%m-%d') AS date, s.study_type AS studyType,
            p.dni AS patientDni, p.full_name AS patientName, s.version
     FROM studies s JOIN patients p ON p.id = s.patient_id WHERE s.id = ? FOR UPDATE`,
    [id],
  );
  return rows[0] || null;
}

async function update(connection, study, serviceId, userId, id, version) {
  return connection.query(
    `UPDATE studies SET patient_id = ?, service_id = ?, study_type = ?, professional = ?,
                        diagnosis = ?, procedure_description = ?, description = ?, conclusions = ?,
                        version = version + 1, updated_by = ?
     WHERE id = ? AND version = ?`,
    [study.patientId, serviceId, study.type, study.professional, study.diagnosis, study.procedure, study.description, study.conclusions, userId, id, version],
  );
}

module.exports = { selectStudy, listForPatient, patientExists, audit, findGeneralServiceId, create, findById, findForUpdate, update };
