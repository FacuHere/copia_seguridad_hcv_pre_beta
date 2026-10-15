const { Router } = require('express');
const database = require('../config/database');
const { optionalAuth, requireAuth } = require('../middleware/require-auth');
const requirePermission = require('../middleware/require-permission');
const { parseId, optionalText, requiredText, optionalDate, positiveInteger } = require('../utils/validation');
const { sendDatabaseError } = require('../utils/errors');
const { logInternalError } = require('../utils/errors');
const { readFileStorageConfig } = require('../config/file-storage');
const { studyFolderKey } = require('../services/document-storage');
const { prepareRenameInTransaction, assertRenameDoesNotAffectDocuments, completeRename } = require('../services/document-operations');
const { blockStorage } = require('../services/storage-readiness');

const router = Router();

function validateStudy(body) {
  const patientId = parseId(String(body?.patientId ?? ''));
  const type = requiredText(body?.type, 160, 'Tipo de estudio');
  const date = optionalDate(body?.date, 'Fecha del estudio', true);
  const professional = optionalText(body?.professional, 200, 'Profesional');
  const diagnosis = optionalText(body?.diagnosis, 10000, 'Diagnóstico');
  const procedure = optionalText(body?.procedure, 10000, 'Procedimiento');
  const description = optionalText(body?.description, 10000, 'Descripción');
  const conclusions = optionalText(body?.conclusions, 10000, 'Conclusiones');
  const error = !patientId ? 'Paciente no válido.'
    : [type, date, professional, diagnosis, procedure, description, conclusions].find(field => field.error)?.error;
  if (error) return { error };
  return { value: { patientId, type: type.value, date: date.value, professional: professional.value, diagnosis: diagnosis.value, procedure: procedure.value, description: description.value, conclusions: conclusions.value } };
}

async function audit(connection, req, action, entityId) {
  await connection.query(
    'INSERT INTO audit_events (user_id, action_code, entity_type, entity_id, client_ip) VALUES (?, ?, ?, ?, ?)',
    [req.auth.user.id, action, 'study', String(entityId), req.ip || null],
  );
}

async function rollback(connection) {
  if (connection) await connection.rollback().catch(() => {});
}

async function getGeneralServiceId(connection) {
  const rows = await connection.query(
    'SELECT id FROM services WHERE code = ? AND is_active = TRUE LIMIT 1',
    ['GENERAL'],
  );
  return rows[0]?.id ?? null;
}

function serializeStudy(row) {
  return {
    ...row,
    id: String(row.id),
    patientId: String(row.patientId),
    serviceId: String(row.serviceId),
  };
}

const selectStudy = `SELECT id, patient_id AS patientId, service_id AS serviceId, study_type AS type,
                            DATE_FORMAT(study_date, '%Y-%m-%d') AS date, professional, diagnosis,
                            procedure_description AS \`procedure\`, description, conclusions, version,
                            created_at AS createdAt, updated_at AS updatedAt
                     FROM studies`;

router.get('/pacientes/:patientId/estudios', optionalAuth, requireAuth, requirePermission('studies.read'), async (req, res) => {
  const patientId = parseId(req.params.patientId);
  if (!patientId) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'El identificador del paciente no es válido.' } });
  let connection;
  try {
    connection = await database.getPool().getConnection();
    const rows = await connection.query(`${selectStudy} WHERE patient_id = ? ORDER BY study_date DESC, id DESC`, [patientId]);
    if (!rows.length) {
      const patients = await connection.query('SELECT id FROM patients WHERE id = ? LIMIT 1', [patientId]);
      if (!patients.length) return res.status(404).json({ error: { code: 'PATIENT_NOT_FOUND', message: 'No se encontró el paciente.' } });
    }
    await connection.query(
      'INSERT INTO audit_events (user_id, action_code, entity_type, entity_id, client_ip) VALUES (?, ?, ?, ?, ?)',
      [req.auth.user.id, 'study.list', 'patient', patientId, req.ip || null],
    );
    res.json({ data: rows.map(serializeStudy) });
  } catch (error) {
    await rollback(connection);
    sendDatabaseError(res, req, error, 'studies.list', 'No se pudieron consultar los estudios.');
  } finally {
    if (connection) connection.release();
  }
});

router.post('/estudios', optionalAuth, requireAuth, requirePermission('studies.create'), async (req, res) => {
  const validated = validateStudy(req.body);
  if (validated.error) return res.status(400).json({ error: { code: 'INVALID_STUDY', message: validated.error } });
  let connection;
  try {
    connection = await database.getPool().getConnection();
    await connection.beginTransaction();
    const s = validated.value;
    const patients = await connection.query('SELECT id FROM patients WHERE id = ? LIMIT 1', [s.patientId]);
    if (!patients.length) {
      await rollback(connection);
      return res.status(404).json({ error: { code: 'PATIENT_NOT_FOUND', message: 'No se encontró el paciente.' } });
    }
    const serviceId = await getGeneralServiceId(connection);
    if (serviceId === null) {
      await rollback(connection);
      return res.status(503).json({ error: { code: 'GENERAL_SERVICE_NOT_CONFIGURED', message: 'El servicio general no está configurado. Contacte al administrador técnico.' } });
    }
    const result = await connection.query(
      `INSERT INTO studies (patient_id, service_id, study_type, study_date, professional, diagnosis,
                           procedure_description, description, conclusions, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.patientId, serviceId, s.type, s.date, s.professional, s.diagnosis, s.procedure, s.description, s.conclusions, req.auth.user.id, req.auth.user.id],
    );
    await audit(connection, req, 'study.create', result.insertId);
    await connection.commit();
    res.status(201).json({ data: { id: String(result.insertId), ...s, patientId: String(s.patientId), serviceId: String(serviceId), version: 1 } });
  } catch (error) {
    await rollback(connection);
    sendDatabaseError(res, req, error, 'studies.create', 'No se pudo crear el estudio.');
  } finally {
    if (connection) connection.release();
  }
});

router.get('/estudios/:id', optionalAuth, requireAuth, requirePermission('studies.read'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'El identificador no es válido.' } });
  let connection;
  try {
    connection = await database.getPool().getConnection();
    const rows = await connection.query(`${selectStudy} WHERE id = ? LIMIT 1`, [id]);
    if (!rows.length) return res.status(404).json({ error: { code: 'STUDY_NOT_FOUND', message: 'No se encontró el estudio.' } });
    await audit(connection, req, 'study.read', id);
    res.json({ data: serializeStudy(rows[0]) });
  } catch (error) {
    await rollback(connection);
    sendDatabaseError(res, req, error, 'studies.read', 'No se pudo consultar el estudio.');
  } finally {
    if (connection) connection.release();
  }
});

router.put('/estudios/:id', optionalAuth, requireAuth, requirePermission('studies.update'), async (req, res) => {
  const id = parseId(req.params.id);
  const version = positiveInteger(req.body?.version);
  const validated = validateStudy(req.body);
  if (!id) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'El identificador no es válido.' } });
  if (!version) return res.status(400).json({ error: { code: 'VERSION_REQUIRED', message: 'Indique la versión del registro que editó.' } });
  if (validated.error) return res.status(400).json({ error: { code: 'INVALID_STUDY', message: validated.error } });

  let connection;
  let renameOperation = null;
  const storage = readFileStorageConfig();
  try {
    connection = await database.getPool().getConnection();
    await connection.beginTransaction();
    const s = validated.value;
    const currentRows = await connection.query(
      `SELECT s.patient_id AS patientId, DATE_FORMAT(s.study_date, '%Y-%m-%d') AS date, s.study_type AS studyType,
              p.dni AS patientDni, p.full_name AS patientName, s.version
       FROM studies s JOIN patients p ON p.id = s.patient_id WHERE s.id = ? FOR UPDATE`,
      [id],
    );
    if (!currentRows.length) {
      await rollback(connection);
      return res.status(404).json({ error: { code: 'STUDY_NOT_FOUND', message: 'No se encontró el estudio.' } });
    }
    if (Number(currentRows[0].version) !== version) {
      await rollback(connection);
      return res.status(409).json({ error: { code: 'VERSION_CONFLICT', message: 'El estudio fue modificado por otra persona. Recargue antes de guardar.' } });
    }
    if (String(currentRows[0].patientId) !== s.patientId) {
      await rollback(connection);
      return res.status(422).json({ error: { code: 'PATIENT_REASSIGNMENT_NOT_ALLOWED', message: 'No se permite cambiar el paciente asociado al estudio.' } });
    }
    if (String(currentRows[0].date).slice(0, 10) !== s.date) {
      await rollback(connection);
      return res.status(422).json({ error: { code: 'STUDY_DATE_IMMUTABLE', message: 'La fecha del estudio no se puede modificar.' } });
    }
    const serviceId = await getGeneralServiceId(connection);
    if (serviceId === null) {
      await rollback(connection);
      return res.status(503).json({ error: { code: 'GENERAL_SERVICE_NOT_CONFIGURED', message: 'El servicio general no está configurado. Contacte al administrador técnico.' } });
    }
    const patients = await connection.query('SELECT id FROM patients WHERE id = ? LIMIT 1', [s.patientId]);
    if (!patients.length) {
      await rollback(connection);
      return res.status(404).json({ error: { code: 'PATIENT_NOT_FOUND', message: 'No se encontró el paciente.' } });
    }
    if (currentRows[0].studyType !== s.type) {
      const oldPrefix = studyFolderKey({ patientId: s.patientId, patientDni: currentRows[0].patientDni, patientName: currentRows[0].patientName, studyId: id, studyDate: currentRows[0].date, studyType: currentRows[0].studyType });
      const newPrefix = studyFolderKey({ patientId: s.patientId, patientDni: currentRows[0].patientDni, patientName: currentRows[0].patientName, studyId: id, studyDate: currentRows[0].date, studyType: s.type });
      if (storage.root) {
        renameOperation = await prepareRenameInTransaction(connection, {
          type: 'rename_study', patientId: s.patientId, studyId: id, oldPrefix, newPrefix, actorUserId: req.auth.user.id,
        });
      } else {
        await assertRenameDoesNotAffectDocuments(connection, { type: 'rename_study', scopeId: id });
      }
    }
    const result = await connection.query(
      `UPDATE studies SET patient_id = ?, service_id = ?, study_type = ?, professional = ?,
                          diagnosis = ?, procedure_description = ?, description = ?, conclusions = ?,
                          version = version + 1, updated_by = ?
       WHERE id = ? AND version = ?`,
      [s.patientId, serviceId, s.type, s.professional, s.diagnosis, s.procedure, s.description, s.conclusions, req.auth.user.id, id, version],
    );
    if (!result.affectedRows) {
      await rollback(connection);
      return res.status(409).json({ error: { code: 'VERSION_CONFLICT', message: 'El estudio cambió durante la actualización. Recargue antes de guardar.' } });
    }
    await audit(connection, req, 'study.update', id);
    await connection.commit();
    let storageMovePending = false;
    if (renameOperation) {
      try {
        await completeRename(database.getPool(), storage.root, renameOperation);
      } catch (error) { storageMovePending = true; blockStorage(error?.code, renameOperation.operation_id); logInternalError(error, req, 'documents.rename_study_storage'); }
    }
    res.json({ data: { id: String(id), ...s, patientId: String(s.patientId), serviceId: String(serviceId), version: version + 1, ...(storageMovePending ? { storageMovePending: true } : {}) } });
  } catch (error) {
    await rollback(connection);
    if (error?.code === 'STORAGE_RECOVERY_REQUIRED') {
      return res.status(503).json({ error: { code: error.code, message: 'No se puede cambiar la carpeta del estudio hasta resolver la recuperación del almacenamiento.' } });
    }
    if (error?.code === 'FILE_STORAGE_NOT_CONFIGURED_FOR_RENAME') {
      return res.status(503).json({ error: { code: error.code, message: 'No se puede cambiar el tipo mientras haya documentos y el almacenamiento no esté configurado.' } });
    }
    if (['DOCUMENT_RENAME_IN_PROGRESS', 'DOCUMENT_RENAME_SOURCE_MISMATCH'].includes(error?.code)) {
      return res.status(409).json({ error: { code: error.code, message: 'No se puede cambiar la etiqueta mientras los documentos asociados requieren revisión.' } });
    }
    sendDatabaseError(res, req, error, 'studies.update', 'No se pudo actualizar el estudio.');
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
module.exports.serializeStudy = serializeStudy;
