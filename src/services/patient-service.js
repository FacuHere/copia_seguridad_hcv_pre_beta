const database = require('../config/database');
const patientRepository = require('../repositories/patient-repository');
const { parseId, optionalText, requiredText, optionalDate, positiveInteger } = require('../utils/validation');
const { ApplicationError } = require('../utils/application-error');
const { readFileStorageConfig } = require('../config/file-storage');
const { patientFolderKey } = require('./document-storage');
const { prepareRenameInTransaction, assertRenameDoesNotAffectDocuments, completeRename } = require('./document-operations');
const { blockStorage } = require('./storage-readiness');
const { logInternalError } = require('../utils/errors');

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

async function rollback(connection) {
  if (connection) await connection.rollback().catch(() => {});
}

async function list({ query, userId, clientIp }) {
  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search.length > 120) throw new ApplicationError(400, 'INVALID_SEARCH', 'El criterio de búsqueda es demasiado largo.');
  const page = positiveInteger(query.page || '1');
  const pageSize = Math.min(100, positiveInteger(query.pageSize || '50') || 0);
  if (!page || page > 1000000 || !pageSize) throw new ApplicationError(400, 'INVALID_PAGINATION', 'La página o su tamaño no son válidos.');

  let connection;
  try {
    connection = await database.getPool().getConnection();
    const term = `%${search}%`;
    const rows = await patientRepository.list(connection, { search, term, pageSize, offset: (page - 1) * pageSize });
    await patientRepository.audit(connection, userId, 'patient.list', null, clientIp);
    return { data: rows.map(row => ({ ...row, id: String(row.id) })), pagination: { page, pageSize } };
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
    const patient = await patientRepository.findById(connection, id);
    if (!patient) throw new ApplicationError(404, 'PATIENT_NOT_FOUND', 'No se encontró el paciente.');
    await patientRepository.audit(connection, userId, 'patient.read', id, clientIp);
    return { data: { ...patient, id: String(patient.id) } };
  } catch (error) {
    await rollback(connection);
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function create(body, { userId, clientIp }) {
  const validated = validatePatient(body);
  if (validated.error) throw new ApplicationError(400, 'INVALID_PATIENT', validated.error);
  let connection;
  try {
    connection = await database.getPool().getConnection();
    await connection.beginTransaction();
    const result = await patientRepository.create(connection, validated.value, userId);
    await patientRepository.audit(connection, userId, 'patient.create', result.insertId, clientIp);
    await connection.commit();
    return { status: 201, data: { id: String(result.insertId), ...validated.value, version: 1 } };
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
  const validated = validatePatient(body);
  if (!id) throw new ApplicationError(400, 'INVALID_ID', 'El identificador no es válido.');
  if (!version) throw new ApplicationError(400, 'VERSION_REQUIRED', 'Indique la versión del registro que editó.');
  if (validated.error) throw new ApplicationError(400, 'INVALID_PATIENT', validated.error);

  let connection;
  let renameOperation = null;
  const storage = readFileStorageConfig();
  try {
    connection = await database.getPool().getConnection();
    await connection.beginTransaction();
    const patient = validated.value;
    const oldPatient = await patientRepository.findForUpdate(connection, id);
    if (!oldPatient) throw new ApplicationError(404, 'PATIENT_NOT_FOUND', 'No se encontró el paciente.');
    if (Number(oldPatient.version) !== version) {
      throw new ApplicationError(409, 'VERSION_CONFLICT', 'El paciente fue modificado por otra persona. Recargue la ficha antes de guardar.');
    }
    if (oldPatient.fullName !== patient.fullName || (oldPatient.dni || null) !== (patient.dni || null)) {
      const oldPrefix = patientFolderKey({ patientId: id, patientDni: oldPatient.dni, patientName: oldPatient.fullName });
      const newPrefix = patientFolderKey({ patientId: id, patientDni: patient.dni, patientName: patient.fullName });
      if (storage.root) {
        renameOperation = await prepareRenameInTransaction(connection, { type: 'rename_patient', patientId: id, oldPrefix, newPrefix, actorUserId: userId });
      } else {
        await assertRenameDoesNotAffectDocuments(connection, { type: 'rename_patient', scopeId: id });
      }
    }
    const result = await patientRepository.update(connection, patient, userId, id, version);
    if (!result.affectedRows) {
      const exists = await patientRepository.exists(connection, id);
      throw new ApplicationError(exists ? 409 : 404, exists ? 'VERSION_CONFLICT' : 'PATIENT_NOT_FOUND', exists
        ? 'El paciente fue modificado por otra persona. Recargue la ficha antes de guardar.'
        : 'No se encontró el paciente.');
    }
    await patientRepository.audit(connection, userId, 'patient.update', id, clientIp);
    await connection.commit();

    let storageMovePending = false;
    if (renameOperation) {
      try {
        await completeRename(database.getPool(), storage.root, renameOperation);
      } catch (error) {
        storageMovePending = true;
        blockStorage(error?.code, renameOperation.operation_id);
        logInternalError(error, { requestId }, 'documents.rename_patient_storage');
      }
    }
    return { data: { id, ...patient, version: version + 1, ...(storageMovePending ? { storageMovePending: true } : {}) } };
  } catch (error) {
    await rollback(connection);
    if (error?.code === 'STORAGE_RECOVERY_REQUIRED') {
      throw new ApplicationError(503, error.code, 'No se puede cambiar la carpeta del paciente hasta resolver la recuperación del almacenamiento.');
    }
    if (error?.code === 'FILE_STORAGE_NOT_CONFIGURED_FOR_RENAME') {
      throw new ApplicationError(503, error.code, 'No se puede cambiar el nombre o DNI mientras haya documentos y el almacenamiento no esté configurado.');
    }
    if (['DOCUMENT_RENAME_IN_PROGRESS', 'DOCUMENT_RENAME_SOURCE_MISMATCH'].includes(error?.code)) {
      throw new ApplicationError(409, error.code, 'No se puede cambiar la etiqueta mientras los documentos asociados requieren revisión.');
    }
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

module.exports = { list, get, create, update, validatePatient };
