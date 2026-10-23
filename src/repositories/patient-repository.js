async function list(connection, { search, term, pageSize, offset }) {
  return connection.query(
    `SELECT id, full_name AS fullName, dni
     FROM patients
     WHERE (? = '' OR full_name LIKE ? OR dni LIKE ?)
     ORDER BY full_name, id LIMIT ? OFFSET ?`,
    [search, term, term, pageSize, offset],
  );
}

async function findById(connection, id) {
  const rows = await connection.query(
    `SELECT id, full_name AS fullName, dni, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birthDate, phone, address, notes,
            version, created_at AS createdAt, updated_at AS updatedAt
     FROM patients WHERE id = ? LIMIT 1`, [id],
  );
  return rows[0] || null;
}

async function create(connection, patient, userId) {
  return connection.query(
    `INSERT INTO patients (full_name, dni, birth_date, phone, address, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [patient.fullName, patient.dni, patient.birthDate, patient.phone, patient.address, patient.notes, userId, userId],
  );
}

async function findForUpdate(connection, id) {
  const rows = await connection.query('SELECT id, full_name AS fullName, dni, version FROM patients WHERE id = ? FOR UPDATE', [id]);
  return rows[0] || null;
}

async function update(connection, patient, userId, id, version) {
  return connection.query(
    `UPDATE patients SET full_name = ?, dni = ?, birth_date = ?, phone = ?, address = ?, notes = ?,
                         version = version + 1, updated_by = ?
     WHERE id = ? AND version = ?`,
    [patient.fullName, patient.dni, patient.birthDate, patient.phone, patient.address, patient.notes, userId, id, version],
  );
}

async function exists(connection, id) {
  const rows = await connection.query('SELECT id FROM patients WHERE id = ? LIMIT 1', [id]);
  return rows.length > 0;
}

async function audit(connection, userId, action, entityId, clientIp) {
  return connection.query(
    'INSERT INTO audit_events (user_id, action_code, entity_type, entity_id, client_ip) VALUES (?, ?, ?, ?, ?)',
    [userId, action, 'patient', entityId === null ? null : String(entityId), clientIp || null],
  );
}

module.exports = { list, findById, create, findForUpdate, update, exists, audit };
