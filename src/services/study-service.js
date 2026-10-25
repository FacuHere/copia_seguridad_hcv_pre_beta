const database = require('../config/database');
const studyRepository = require('../repositories/study-repository');
const { parseId, optionalText, requiredText, optionalDate, positiveInteger } = require('../utils/validation');
const { ApplicationError } = require('../utils/application-error');
const { readFileStorageConfig } = require('../config/file-storage');
const { studyFolderKey } = require('./document-storage');
const { prepareRenameInTransaction, assertRenameDoesNotAffectDocuments, completeRename } = require('./document-operations');
const { blockStorage } = require('./storage-readiness');
const { logInternalError } = require('../utils/errors');

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

function serializeStudy(row) {
  return { ...row, id: String(row.id), patientId: String(row.patientId), serviceId: String(row.serviceId) };
}

async function rollback(connection) {
  if (connection) await connection.rollback().catch(() => {});
}

async function list(patientIdValue, { userId, clientIp }) {
  const patientId = parseId(patientIdValue);
  if (!patientId) throw new ApplicationError(400, 'INVALID_ID', 'El identificador del paciente no es válido.');
  let connection;
  try {
    connection = await database.getPool().getConnection();
    const rows = await studyRepository.listForPatient(connection, patientId);
    if (!rows.length && !await studyRepository.patientExists(connection, patientId)) {
      throw new ApplicationError(404, 'PATIENT_NOT_FOUND', 'No se encontró el paciente.');
    }
    await studyRepository.audit(connection, userId, 'study.list', 'patient', patientId, clientIp);
    return { data: rows.map(serializeStudy) };
  } catch (error) {
    await rollback(connection);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function create(body, { userId, clientIp }) {
  const validated = validateStudy(body);
  if (validated.error) throw new ApplicationError(400, 'INVALID_STUDY', validated.error);
  let connection;
  try {
    connection = await database.getPool().getConnection();
    await connection.beginTransaction();
    const study = validated.value;
    if (!await studyRepository.patientExists(connection, study.patientId)) {
      throw new ApplicationError(404, 'PATIENT_NOT_FOUND', 'No se encontró el paciente.');
    }
    const serviceId = await studyRepository.findGeneralServiceId(connection);
    if (serviceId === null) throw new ApplicationError(503, 'GENERAL_SERVICE_NOT_CONFIGURED', 'El servicio general no está configurado. Contacte al administrador técnico.');
    const result = await studyRepository.create(connection, study, serviceId, userId);
    await studyRepository.audit(connection, userId, 'study.create', 'study', result.insertId, clientIp);
    await connection.commit();
    return { status: 201, data: { id: String(result.insertId), ...study, patientId: String(study.patientId), serviceId: String(serviceId), version: 1 } };
  } catch (error) {
    await rollback(connection);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function get(idValue, { userId, clientIp }) {
  const id = parseId(idValue);
  if (!id) throw new ApplicationError(400, 'INVALID_ID', 'El identificador no es válido.');
  let connection;
  try {
    connection = await database.getPool().getConnection();
    const row = await studyRepository.findById(connection, id);
    if (!row) throw new ApplicationError(404, 'STUDY_NOT_FOUND', 'No se encontró el estudio.');
    await studyRepository.audit(connection, userId, 'study.read', 'study', id, clientIp);
    return { data: serializeStudy(row) };
  } catch (error) {
    await rollback(connection);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function update(idValue, body, { userId, clientIp, requestId }) {
  const id = parseId(idValue);
  const version = positiveInteger(body?.version);
  const validated = validateStudy(body);
  if (!id) throw new ApplicationError(400, 'INVALID_ID', 'El identificador no es válido.');
  if (!version) throw new ApplicationError(400, 'VERSION_REQUIRED', 'Indique la versión del registro que editó.');
  if (validated.error) throw new ApplicationError(400, 'INVALID_STUDY', validated.error);

  let connection;
  let renameOperation = null;
  const storage = readFileStorageConfig();
  try {
    connection = await database.getPool().getConnection();
    await connection.beginTransaction();
    const study = validated.value;
    const current = await studyRepository.findForUpdate(connection, id);
    if (!current) throw new ApplicationError(404, 'STUDY_NOT_FOUND', 'No se encontró el estudio.');
    if (Number(current.version) !== version) throw new ApplicationError(409, 'VERSION_CONFLICT', 'El estudio fue modificado por otra persona. Recargue antes de guardar.');
    if (String(current.patientId) !== study.patientId) throw new ApplicationError(422, 'PATIENT_REASSIGNMENT_NOT_ALLOWED', 'No se permite cambiar el paciente asociado al estudio.');
    if (String(current.date).slice(0, 10) !== study.date) throw new ApplicationError(422, 'STUDY_DATE_IMMUTABLE', 'La fecha del estudio no se puede modificar.');
    const serviceId = await studyRepository.findGeneralServiceId(connection);
    if (serviceId === null) throw new ApplicationError(503, 'GENERAL_SERVICE_NOT_CONFIGURED', 'El servicio general no está configurado. Contacte al administrador técnico.');
    if (!await studyRepository.patientExists(connection, study.patientId)) throw new ApplicationError(404, 'PATIENT_NOT_FOUND', 'No se encontró el paciente.');

    if (current.studyType !== study.type) {
      const oldPrefix = studyFolderKey({ patientId: study.patientId, patientDni: current.patientDni, patientName: current.patientName, studyId: id, studyDate: current.date, studyType: current.studyType });
      const newPrefix = studyFolderKey({ patientId: study.patientId, patientDni: current.patientDni, patientName: current.patientName, studyId: id, studyDate: current.date, studyType: study.type });
      if (storage.root) {
        renameOperation = await prepareRenameInTransaction(connection, { type: 'rename_study', patientId: study.patientId, studyId: id, oldPrefix, newPrefix, actorUserId: userId });
      } else {
        await assertRenameDoesNotAffectDocuments(connection, { type: 'rename_study', scopeId: id });
      }
    }
    const result = await studyRepository.update(connection, study, serviceId, userId, id, version);
    if (!result.affectedRows) throw new ApplicationError(409, 'VERSION_CONFLICT', 'El estudio cambió durante la actualización. Recargue antes de guardar.');
    await studyRepository.audit(connection, userId, 'study.update', 'study', id, clientIp);
    await connection.commit();

    let storageMovePending = false;
    if (renameOperation) {
      try {
        await completeRename(database.getPool(), storage.root, renameOperation);
      } catch (error) {
        storageMovePending = true;
        blockStorage(error?.code, renameOperation.operation_id);
        logInternalError(error, { requestId }, 'documents.rename_study_storage');
      }
    }
    return { data: { id: String(id), ...study, patientId: String(study.patientId), serviceId: String(serviceId), version: version + 1, ...(storageMovePending ? { storageMovePending: true } : {}) } };
  } catch (error) {
    await rollback(connection);
    if (error?.code === 'STORAGE_RECOVERY_REQUIRED') throw new ApplicationError(503, error.code, 'No se puede cambiar la carpeta del estudio hasta resolver la recuperación del almacenamiento.');
    if (error?.code === 'FILE_STORAGE_NOT_CONFIGURED_FOR_RENAME') throw new ApplicationError(503, error.code, 'No se puede cambiar el tipo mientras haya documentos y el almacenamiento no esté configurado.');
    if (['DOCUMENT_RENAME_IN_PROGRESS', 'DOCUMENT_RENAME_SOURCE_MISMATCH'].includes(error?.code)) throw new ApplicationError(409, error.code, 'No se puede cambiar la etiqueta mientras los documentos asociados requieren revisión.');
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

module.exports = { list, create, get, update, validateStudy, serializeStudy };
