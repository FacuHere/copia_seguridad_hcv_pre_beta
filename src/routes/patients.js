const { Router } = require('express');
const database = require('../config/database');
const { optionalAuth, requireAuth } = require('../middleware/require-auth');
const requirePermission = require('../middleware/require-permission');
const { parseId, optionalText, requiredText, optionalDate, positiveInteger } = require('../utils/validation');
const { sendDatabaseError, logInternalError } = require('../utils/errors');
const { readFileStorageConfig } = require('../config/file-storage');
const { patientFolderKey } = require('../services/document-storage');
const { prepareRenameInTransaction, assertRenameDoesNotAffectDocuments, completeRename } = require('../services/document-operations');
const { blockStorage } = require('../services/storage-readiness');

const router = Router();

function validatePatient(body) {
  const fullName = requiredText(body?.fullName, 240, 'Apellido y nombre');
  const dni = optionalText(body?.dni, 32, 'DNI');
  const birthDate = optionalDate(body?.birthDate, 'Fecha de nacimiento');
  const phone = optionalText(body?.phone, 80, 'Teléfono');
  const address = optionalText(body?.address, 500, 'Dirección');
  const notes = optionalText(body?.notes, 10000, 'Observaciones');
  const error = [fullName, dni, birthDate, phone, address, notes].find(field => field.error)?.error;
  if (error) return { error };
  return { value: { fullName: fullName.value, dni: dni.value, birthDate: birthDate.value, phone: phone.value, address: address.value, notes: notes.value } };
}

async function audit(connection, req, action, entityId = null) {
  await connection.query(
    'INSERT INTO audit_events (user_id, action_code, entity_type, entity_id, client_ip) VALUES (?, ?, ?, ?, ?)',
    [req.auth.user.id, action, 'patient', entityId === null ? null : String(entityId), req.ip || null],
  );
}

async function rollback(connection) {
  if (connection) await connection.rollback().catch(() => {});
}

router.get('/', optionalAuth, requireAuth, requirePermission('patients.read'), async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (search.length > 120) return res.status(400).json({ error: { code: 'INVALID_SEARCH', message: 'El criterio de búsqueda es demasiado largo.' } });
  const page = positiveInteger(req.query.page || '1');
  const pageSize = Math.min(100, positiveInteger(req.query.pageSize || '50') || 0);
  if (!page || page > 1000000 || !pageSize) return res.status(400).json({ error: { code: 'INVALID_PAGINATION', message: 'La página o su tamaño no son válidos.' } });

  let connection;
  try {
    connection = await database.getPool().getConnection();
    const term = `%${search}%`;
    const rows = await connection.query(
      `SELECT id, full_name AS fullName, dni
       FROM patients
       WHERE (? = '' OR full_name LIKE ? OR dni LIKE ?)
       ORDER BY full_name, id LIMIT ? OFFSET ?`,
      [search, term, term, pageSize, (page - 1) * pageSize],
    );
    await audit(connection, req, 'patient.list');
    res.json({ data: rows.map(row => ({ ...row, id: String(row.id) })), pagination: { page, pageSize } });
  } catch (error) {
    await rollback(connection);
    sendDatabaseError(res, req, error, 'patients.list', 'No se pudieron consultar los pacientes.');
  } finally {
    if (connection) connection.release();
  }
});

router.post('/', optionalAuth, requireAuth, requirePermission('patients.create'), async (req, res) => {
  const validated = validatePatient(req.body);
  if (validated.error) return res.status(400).json({ error: { code: 'INVALID_PATIENT', message: validated.error } });
  let connection;
  try {
    connection = await database.getPool().getConnection();
    await connection.beginTransaction();
    const p = validated.value;
    const result = await connection.query(
      `INSERT INTO patients (full_name, dni, birth_date, phone, address, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.fullName, p.dni, p.birthDate, p.phone, p.address, p.notes, req.auth.user.id, req.auth.user.id],
    );
    await audit(connection, req, 'patient.create', result.insertId);
    await connection.commit();
    res.status(201).json({ data: { id: String(result.insertId), ...p, version: 1 } });
  } catch (error) {
    await rollback(connection);
    sendDatabaseError(res, req, error, 'patients.create', 'No se pudo crear el paciente.');
  } finally {
    if (connection) connection.release();
  }
});

router.get('/:id', optionalAuth, requireAuth, requirePermission('patients.read'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'El identificador no es válido.' } });
  let connection;
  try {
    connection = await database.getPool().getConnection();
    const rows = await connection.query(
      `SELECT id, full_name AS fullName, dni, DATE_FORMAT(birth_date, '%Y-%m-%d') AS birthDate, phone, address, notes,
              version, created_at AS createdAt, updated_at AS updatedAt
       FROM patients WHERE id = ? LIMIT 1`, [id],
    );
    if (!rows.length) return res.status(404).json({ error: { code: 'PATIENT_NOT_FOUND', message: 'No se encontró el paciente.' } });
    await audit(connection, req, 'patient.read', id);
    res.json({ data: { ...rows[0], id: String(rows[0].id) } });
  } catch (error) {
    await rollback(connection);
    sendDatabaseError(res, req, error, 'patients.read', 'No se pudo consultar el paciente.');
  } finally {
    if (connection) connection.release();
  }
});

router.put('/:id', optionalAuth, requireAuth, requirePermission('patients.update'), async (req, res) => {
  const id = parseId(req.params.id);
  const version = positiveInteger(req.body?.version);
  const validated = validatePatient(req.body);
  if (!id) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'El identificador no es válido.' } });
  if (!version) return res.status(400).json({ error: { code: 'VERSION_REQUIRED', message: 'Indique la versión del registro que editó.' } });
  if (validated.error) return res.status(400).json({ error: { code: 'INVALID_PATIENT', message: validated.error } });

  let connection;
  let oldPatient;
  let renameOperation = null;
  const storage = readFileStorageConfig();
  try {
    connection = await database.getPool().getConnection();
    await connection.beginTransaction();
    const p = validated.value;
    const currentRows = await connection.query('SELECT id, full_name AS fullName, dni, version FROM patients WHERE id = ? FOR UPDATE', [id]);
    oldPatient = currentRows[0];
    if (!oldPatient) {
      await rollback(connection);
      return res.status(404).json({ error: { code: 'PATIENT_NOT_FOUND', message: 'No se encontró el paciente.' } });
    }
    if (Number(oldPatient.version) !== version) {
      await rollback(connection);
      return res.status(409).json({ error: { code: 'VERSION_CONFLICT', message: 'El paciente fue modificado por otra persona. Recargue la ficha antes de guardar.' } });
    }
    if (oldPatient.fullName !== validated.value.fullName || (oldPatient.dni || null) !== (validated.value.dni || null)) {
      const oldPrefix = patientFolderKey({ patientId: id, patientDni: oldPatient.dni, patientName: oldPatient.fullName });
      const newPrefix = patientFolderKey({ patientId: id, patientDni: validated.value.dni, patientName: validated.value.fullName });
      if (storage.root) {
        renameOperation = await prepareRenameInTransaction(connection, {
          type: 'rename_patient', patientId: id, oldPrefix, newPrefix, actorUserId: req.auth.user.id,
        });
      } else {
        await assertRenameDoesNotAffectDocuments(connection, { type: 'rename_patient', scopeId: id });
      }
    }
    const result = await connection.query(
      `UPDATE patients SET full_name = ?, dni = ?, birth_date = ?, phone = ?, address = ?, notes = ?,
                           version = version + 1, updated_by = ?
       WHERE id = ? AND version = ?`,
      [p.fullName, p.dni, p.birthDate, p.phone, p.address, p.notes, req.auth.user.id, id, version],
    );
    if (!result.affectedRows) {
      const existing = await connection.query('SELECT id FROM patients WHERE id = ? LIMIT 1', [id]);
      await rollback(connection);
      return res.status(existing.length ? 409 : 404).json({
        error: existing.length
          ? { code: 'VERSION_CONFLICT', message: 'El paciente fue modificado por otra persona. Recargue la ficha antes de guardar.' }
          : { code: 'PATIENT_NOT_FOUND', message: 'No se encontró el paciente.' },
      });
    }
    await audit(connection, req, 'patient.update', id);
    await connection.commit();
    let storageMovePending = false;
    if (renameOperation) {
      try {
        await completeRename(database.getPool(), storage.root, renameOperation);
      } catch (error) { storageMovePending = true; blockStorage(error?.code, renameOperation.operation_id); logInternalError(error, req, 'documents.rename_patient_storage'); }
    }
    res.json({ data: { id, ...p, version: version + 1, ...(storageMovePending ? { storageMovePending: true } : {}) } });
  } catch (error) {
    await rollback(connection);
    if (error?.code === 'STORAGE_RECOVERY_REQUIRED') {
      return res.status(503).json({ error: { code: error.code, message: 'No se puede cambiar la carpeta del paciente hasta resolver la recuperación del almacenamiento.' } });
    }
    if (error?.code === 'FILE_STORAGE_NOT_CONFIGURED_FOR_RENAME') {
      return res.status(503).json({ error: { code: error.code, message: 'No se puede cambiar el nombre o DNI mientras haya documentos y el almacenamiento no esté configurado.' } });
    }
    if (['DOCUMENT_RENAME_IN_PROGRESS', 'DOCUMENT_RENAME_SOURCE_MISMATCH'].includes(error?.code)) {
      return res.status(409).json({ error: { code: error.code, message: 'No se puede cambiar la etiqueta mientras los documentos asociados requieren revisión.' } });
    }
    sendDatabaseError(res, req, error, 'patients.update', 'No se pudo actualizar el paciente.');
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
