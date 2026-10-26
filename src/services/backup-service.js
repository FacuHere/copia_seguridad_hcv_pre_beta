const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const database = require('../config/database');
const repositorio = require('../repositories/backup-repository');
const { ApplicationError } = require('../utils/application-error');
const { readFileStorageConfig } = require('../config/file-storage');
const { DocumentInputError, receiveSingleFile, relativeDocumentKey, sanitizeSegment, moveKey, unlinkKey, resolveStoragePath, assertNoLinks, ensurePrivateRoot } = require('./document-storage');
const { fileInfo } = require('./document-operations');

const FORMATO_RESPALDO = 'hcv-respaldo-clinico';
const VERSION_RESPALDO = 1;
const TIPOS_REGISTRO = new Set(['pacientes', 'estudios', 'documentos']);
const MAPA_TIPOS = { pacientes: 'patient', estudios: 'study', documentos: 'document' };

function normalizarId(valor) {
  return valor === null || valor === undefined ? null : String(valor);
}

function validarId(valor) {
  const texto = String(valor ?? '');
  if (!/^[1-9]\d{0,19}$/.test(texto)) return false;
  try { return BigInt(texto) <= 18446744073709551615n; }
  catch { return false; }
}

function validarFecha(valor, permitirNulo = false) {
  if (permitirNulo && valor === null) return true;
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)
    && !Number.isNaN(Date.parse(`${valor}T00:00:00Z`))
    && new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) === valor;
}

function validarMarcaDeTiempo(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(valor);
}

function esTexto(valor, maximo, permitirNulo = false) {
  return permitirNulo && valor === null || typeof valor === 'string' && valor.length <= maximo;
}

function validarArchivoRelativo(ruta) {
  if (typeof ruta !== 'string' || ruta.includes('\\') || ruta.startsWith('/') || /^[A-Za-z]:/.test(ruta)) return false;
  const partes = ruta.split('/');
  return partes.length === 2 && partes[0] === 'documentos'
    && partes[1] !== '' && partes[1] !== '.' && partes[1] !== '..'
    && !partes[1].includes('..') && !/[<>:"|?*\u0000-\u001f]/.test(partes[1]);
}

async function limpiarDirectorioTemporalDeOperacion(root, operationId) {
  const claveDirectorio = `.backup-staging/${operationId}`;
  const directorio = resolveStoragePath(root, claveDirectorio);
  await assertNoLinks(root, directorio, true);
  let entradas;
  try { entradas = await fs.promises.readdir(directorio, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entrada of entradas) {
    if (!entrada.isFile() || !/^\d+-[0-9a-f-]{36}\.part$/i.test(entrada.name)) {
      throw Object.assign(new Error('BACKUP_STAGING_UNRECOGNIZED_ENTRY'), { code: 'BACKUP_STAGING_UNRECOGNIZED_ENTRY' });
    }
    await unlinkKey(root, `${claveDirectorio}/${entrada.name}`);
  }
  await fs.promises.rmdir(directorio).catch(error => { if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error; });
}

function crearErrorValidacion(codigo, mensaje, estado = 422) {
  return new ApplicationError(estado, codigo, mensaje, { includeRequestId: true });
}

function validarDatosClinicos(datos) {
  if (!datos || typeof datos !== 'object' || !Array.isArray(datos.pacientes)
    || !Array.isArray(datos.estudios) || !Array.isArray(datos.documentos)) {
    throw crearErrorValidacion('BACKUP_DATA_INVALID', 'La carpeta no contiene los datos clínicos esperados.');
  }

  const ids = { pacientes: new Set(), estudios: new Set(), documentos: new Set() };
  const pacientes = new Map();
  const estudios = new Map();
  const documentos = new Map();

  for (const paciente of datos.pacientes) {
    if (!validarId(paciente?.id) || ids.pacientes.has(String(paciente.id))
      || !esTexto(paciente.fullName, 240) || !paciente.fullName.trim()
      || !esTexto(paciente.dni, 32, true) || !validarFecha(paciente.birthDate, true)
      || !esTexto(paciente.phone, 80, true) || !esTexto(paciente.address, 500, true)
      || !esTexto(paciente.notes, 65535, true) || !Number.isInteger(Number(paciente.version)) || Number(paciente.version) < 1
      || !esTexto(paciente.createdByUsername, 100) || !esTexto(paciente.updatedByUsername, 100)
      || !validarMarcaDeTiempo(paciente.createdAt) || !validarMarcaDeTiempo(paciente.updatedAt)) {
      throw crearErrorValidacion('BACKUP_PATIENT_INVALID', 'Un registro de paciente del respaldo no es válido.');
    }
    ids.pacientes.add(String(paciente.id));
    pacientes.set(String(paciente.id), paciente);
  }

  for (const estudio of datos.estudios) {
    if (!validarId(estudio?.id) || ids.estudios.has(String(estudio.id)) || !validarId(estudio.patientId)
      || !esTexto(estudio.serviceCode, 64) || !esTexto(estudio.type, 160) || !estudio.type.trim()
      || !validarFecha(estudio.date) || !esTexto(estudio.professional, 200, true)
      || !esTexto(estudio.diagnosis, 10000, true) || !esTexto(estudio.procedure, 10000, true)
      || !esTexto(estudio.description, 10000, true) || !esTexto(estudio.conclusions, 10000, true)
      || !Number.isInteger(Number(estudio.version)) || Number(estudio.version) < 1
      || !esTexto(estudio.createdByUsername, 100) || !esTexto(estudio.updatedByUsername, 100)
      || !validarMarcaDeTiempo(estudio.createdAt) || !validarMarcaDeTiempo(estudio.updatedAt)) {
      throw crearErrorValidacion('BACKUP_STUDY_INVALID', 'Un registro de estudio del respaldo no es válido.');
    }
    ids.estudios.add(String(estudio.id));
    estudios.set(String(estudio.id), estudio);
  }

  for (const documento of datos.documentos) {
    const tamanoValido = /^(0|[1-9]\d{0,19})$/.test(String(documento?.sizeBytes ?? ''));
    if (!validarId(documento?.id) || ids.documentos.has(String(documento.id))
      || !validarId(documento.patientId) || !validarId(documento.studyId)
      || !esTexto(documento.originalName, 255) || !documento.originalName
      || !esTexto(documento.mimeType, 160) || !tamanoValido
      || !/^[a-f0-9]{64}$/i.test(String(documento.sha256 || ''))
      || !esTexto(documento.uploadedByUsername, 100) || !esTexto(documento.updatedByUsername, 100, true)
      || !validarMarcaDeTiempo(documento.createdAt) || !validarMarcaDeTiempo(documento.updatedAt)
      || !validarArchivoRelativo(documento.archivePath)
      || !(documento.derivedFromDocumentId === null || validarId(documento.derivedFromDocumentId))) {
      throw crearErrorValidacion('BACKUP_DOCUMENT_INVALID', 'Un registro de documento del respaldo no es válido.');
    }
    ids.documentos.add(String(documento.id));
    documentos.set(String(documento.id), documento);
  }

  const rutasArchivo = datos.documentos.map(documento => documento.archivePath.toLocaleLowerCase('es'));
  if (new Set(rutasArchivo).size !== rutasArchivo.length) throw crearErrorValidacion('BACKUP_PATH_DUPLICATE', 'Dos documentos usan la misma ruta dentro del respaldo.');

  for (const estudio of estudios.values()) {
    if (!pacientes.has(String(estudio.patientId))) throw crearErrorValidacion('BACKUP_RELATION_INVALID', 'Un estudio referencia a un paciente ausente del respaldo.');
  }
  for (const documento of documentos.values()) {
    const estudio = estudios.get(String(documento.studyId));
    if (!estudio || String(estudio.patientId) !== String(documento.patientId)) {
      throw crearErrorValidacion('BACKUP_RELATION_INVALID', 'Un documento no coincide con la relación estudio-paciente del respaldo.');
    }
    if (documento.derivedFromDocumentId !== null && !documentos.has(String(documento.derivedFromDocumentId))) {
      throw crearErrorValidacion('BACKUP_RELATION_INVALID', 'Un documento derivado referencia a un documento ausente.');
    }
  }

  return { pacientes, estudios, documentos };
}

function normalizarPaciente(fila) {
  return { ...fila, id: normalizarId(fila.id), version: Number(fila.version) };
}

function normalizarEstudio(fila) {
  return { ...fila, id: normalizarId(fila.id), patientId: normalizarId(fila.patientId), version: Number(fila.version) };
}

function normalizarDocumento(fila) {
  const extension = path.posix.extname(fila.originalName).toLowerCase();
  const base = sanitizeSegment(path.posix.basename(fila.originalName, extension), 72);
  return {
    ...fila,
    id: normalizarId(fila.id),
    patientId: normalizarId(fila.patientId),
    studyId: normalizarId(fila.studyId),
    derivedFromDocumentId: normalizarId(fila.derivedFromDocumentId),
    sizeBytes: String(fila.sizeBytes),
    archivePath: `documentos/D-${fila.id} - ${base}${extension}`,
  };
}

async function crearRespaldo({ incluirReferenciasUsuarios = false, userId, clientIp }) {
  if (typeof incluirReferenciasUsuarios !== 'boolean') throw crearErrorValidacion('INVALID_BACKUP_OPTIONS', 'La opción de referencias de usuarios no es válida.', 400);
  const pool = database.getPool();
  const connection = await pool.getConnection();
  try {
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.beginTransaction();
    const pendientes = await repositorio.listarOperacionesDocumentalesPendientes(connection);
    if (pendientes.length) throw crearErrorValidacion('DOCUMENT_OPERATIONS_PENDING', 'Hay operaciones de archivos pendientes. Resuélvalas antes de crear el respaldo.', 409);
    const documentosPendientes = await repositorio.contarDocumentosNoActivos(connection);
    if (documentosPendientes) throw crearErrorValidacion('DOCUMENTS_NOT_READY', 'Hay documentos en proceso o pendientes que no pueden incluirse en un respaldo completo.', 409);

    const pacientes = (await repositorio.cargarPacientes(connection)).map(normalizarPaciente);
    const estudios = (await repositorio.cargarEstudios(connection)).map(normalizarEstudio);
    const documentos = (await repositorio.cargarDocumentos(connection)).map(normalizarDocumento);
    const referenciasUsuarios = incluirReferenciasUsuarios ? await repositorio.cargarReferenciasUsuarios(connection) : undefined;
    const operationId = randomUUID();
    const creadoEn = new Date().toISOString();
    const datos = { pacientes, estudios, documentos, ...(referenciasUsuarios ? { referenciasUsuarios } : {}) };
    await repositorio.crearOperacion(connection, {
      operationId, mode: 'backup', actorId: userId,
      expectedPatients: pacientes.length, expectedStudies: estudios.length, expectedDocuments: documentos.length,
    });
    await connection.commit();
    return {
      operationId,
      formato: FORMATO_RESPALDO,
      version: VERSION_RESPALDO,
      creadoEn,
      conteos: { pacientes: pacientes.length, estudios: estudios.length, documentos: documentos.length },
      datos,
    };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}

async function obtenerResumen() {
  const connection = await database.getPool().getConnection();
  try { return await repositorio.resumenClinico(connection); }
  finally { connection.release(); }
}

async function obtenerOperacion(operationId, userId) {
  const operacion = await repositorio.buscarOperacion(database.getPool(), operationId);
  if (!operacion) throw crearErrorValidacion('BACKUP_OPERATION_NOT_FOUND', 'No se encontró la operación solicitada.', 404);
  if (String(operacion.actor_user_id) !== String(userId)) throw crearErrorValidacion('FORBIDDEN', 'La operación pertenece a otra cuenta.', 403);
  return operacion;
}

async function completarRespaldo(operationId, { userId, clientIp }) {
  const pool = database.getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const operacion = await repositorio.buscarOperacionParaActualizar(connection, operationId);
    if (!operacion) throw crearErrorValidacion('BACKUP_OPERATION_NOT_FOUND', 'No se encontró la operación solicitada.', 404);
    if (String(operacion.actor_user_id) !== String(userId)) throw crearErrorValidacion('FORBIDDEN', 'La operación pertenece a otra cuenta.', 403);
    if (operacion.operation_mode !== 'backup' || operacion.operation_state !== 'recibiendo') {
      throw crearErrorValidacion('BACKUP_OPERATION_STATE', 'El respaldo ya fue cerrado o no se puede completar.', 409);
    }
    await repositorio.insertarAuditoria(connection, {
      userId, action: 'backup.create', entityId: operationId,
      details: { patients: Number(operacion.expected_patients), studies: Number(operacion.expected_studies), documents: Number(operacion.expected_documents), result: 'success' }, clientIp,
    });
    const cambio = await repositorio.cambiarEstado(connection, operationId, 'recibiendo', 'completado');
    if (cambio.affectedRows !== 1) throw crearErrorValidacion('BACKUP_OPERATION_STATE', 'La operación cambió antes de completarse.', 409);
    await connection.commit();
    return { operationId, completado: true };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}

async function iniciarRestauracion({ formato, version, modo, conteos, userId }) {
  if (formato !== FORMATO_RESPALDO || version !== VERSION_RESPALDO || !['agregar', 'reemplazar'].includes(modo)
    || !conteos || !['pacientes', 'estudios', 'documentos'].every(tipo => Number.isSafeInteger(conteos[tipo]) && conteos[tipo] >= 0 && conteos[tipo] <= 2147483647)) {
    throw crearErrorValidacion('INVALID_RESTORE_OPTIONS', 'El modo o los conteos del respaldo no son válidos.', 400);
  }
  const operationId = randomUUID();
  const connection = await database.getPool().getConnection();
  try {
    await connection.beginTransaction();
    await repositorio.crearOperacion(connection, {
      operationId, mode: modo, actorId: userId,
      expectedPatients: conteos.pacientes, expectedStudies: conteos.estudios, expectedDocuments: conteos.documentos,
    });
    await connection.commit();
    return { operationId, modo, estado: 'recibiendo' };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}

async function guardarLote(operationId, tipoVisible, registros, userId) {
  const tipo = MAPA_TIPOS[tipoVisible];
  if (!TIPOS_REGISTRO.has(tipoVisible) || !Array.isArray(registros) || registros.length < 1 || registros.length > 10
    || registros.some(registro => !validarId(registro?.id))) {
    throw crearErrorValidacion('INVALID_RESTORE_BATCH', 'El lote de registros del respaldo no es válido.', 400);
  }
  const connection = await database.getPool().getConnection();
  try {
    await connection.beginTransaction();
    const operacion = await repositorio.buscarOperacionParaActualizar(connection, operationId);
    if (!operacion) throw crearErrorValidacion('BACKUP_OPERATION_NOT_FOUND', 'No se encontró la operación solicitada.', 404);
    if (String(operacion.actor_user_id) !== String(userId)) throw crearErrorValidacion('FORBIDDEN', 'La operación pertenece a otra cuenta.', 403);
    if (!['agregar', 'reemplazar'].includes(operacion.operation_mode) || operacion.operation_state !== 'recibiendo') {
      throw crearErrorValidacion('BACKUP_OPERATION_STATE', 'La restauración ya no acepta registros.', 409);
    }
    await repositorio.guardarRegistros(connection, operationId, tipo, registros);
    await connection.commit();
    return { recibidos: registros.length };
  } catch (error) {
    await connection.rollback().catch(() => {});
    if (error.code === 'ER_DUP_ENTRY') throw crearErrorValidacion('DUPLICATE_BACKUP_RECORD', 'El respaldo contiene identificadores repetidos.', 409);
    throw error;
  } finally { connection.release(); }
}

async function cargarArchivoRestauracion(operationId, documentId, request, userId) {
  const operacion = await obtenerOperacion(operationId, userId);
  if (!['agregar', 'reemplazar'].includes(operacion.operation_mode) || operacion.operation_state !== 'recibiendo') {
    throw crearErrorValidacion('BACKUP_OPERATION_STATE', 'La restauración ya no acepta archivos.', 409);
  }
  if (!validarId(documentId)) throw crearErrorValidacion('INVALID_ID', 'El identificador del documento no es válido.', 400);
  const pool = database.getPool();
  const datosDocumento = await repositorio.buscarRegistro(pool, operationId, 'document', documentId);
  if (!datosDocumento) throw crearErrorValidacion('BACKUP_DOCUMENT_NOT_FOUND', 'El documento no forma parte de los datos recibidos.', 404);
  const previo = await repositorio.cargarArchivos(pool, operationId, 'entrante');
  if (previo.some(fila => String(fila.source_document_id) === String(documentId))) {
    throw crearErrorValidacion('BACKUP_DOCUMENT_DUPLICATE', 'El archivo de este documento ya fue recibido.', 409);
  }
  const config = readFileStorageConfig();
  if (!config.root || !config.maxFileSizeBytes) throw crearErrorValidacion('FILE_UPLOAD_NOT_CONFIGURED', 'Configure FILE_STORAGE_ROOT y MAX_FILE_SIZE_BYTES antes de restaurar archivos.', 503);

  let recibido;
  let clavePrivada;
  try {
    recibido = await receiveSingleFile(request, config.root, config.maxFileSizeBytes);
    if (recibido.originalName !== datosDocumento.originalName || recibido.mimeType !== datosDocumento.mimeType
      || BigInt(recibido.sizeBytes) !== BigInt(datosDocumento.sizeBytes) || recibido.sha256 !== datosDocumento.sha256) {
      throw crearErrorValidacion('BACKUP_DOCUMENT_INTEGRITY_MISMATCH', 'El archivo no coincide con el tamaño, nombre o SHA-256 del respaldo.');
    }
    clavePrivada = `.backup-staging/${operationId}/${documentId}-${randomUUID()}.part`;
    await moveKey(config.root, recibido.stagingKey, clavePrivada);
    const info = await fileInfo(config.root, clavePrivada);
    if (!info || info.size !== recibido.sizeBytes || info.sha256 !== recibido.sha256) throw new Error('BACKUP_STAGING_FILE_MISMATCH');
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const operacionActual = await repositorio.buscarOperacionParaActualizar(connection, operationId);
      if (!operacionActual || String(operacionActual.actor_user_id) !== String(userId) || operacionActual.operation_state !== 'recibiendo') {
        throw crearErrorValidacion('BACKUP_OPERATION_STATE', 'La restauración ya no acepta archivos.', 409);
      }
      const recibidos = await repositorio.cargarArchivos(connection, operationId, 'entrante');
      if (recibidos.some(fila => String(fila.source_document_id) === String(documentId))) {
        throw crearErrorValidacion('BACKUP_DOCUMENT_DUPLICATE', 'El archivo de este documento ya fue recibido.', 409);
      }
      await repositorio.guardarArchivo(connection, {
        operationId, role: 'entrante', sourceDocumentId: documentId, fileKey: clavePrivada,
        originalName: recibido.originalName, mimeType: recibido.mimeType,
        sizeBytes: recibido.sizeBytes, sha256: recibido.sha256,
      });
      await connection.commit();
    } catch (error) { await connection.rollback().catch(() => {}); throw error; }
    finally { connection.release(); }
    return { documentoId: String(documentId), recibido: true };
  } catch (error) {
    if (recibido?.stagingKey) await unlinkKey(config.root, recibido.stagingKey).catch(() => {});
    if (clavePrivada) await unlinkKey(config.root, clavePrivada).catch(() => {});
    throw error;
  }
}

async function validarOperacionParaRestaurar(pool, operacion) {
  const cantidades = await repositorio.contarRegistros(pool, operacion.operation_id);
  const esperadas = {
    patient: Number(operacion.expected_patients),
    study: Number(operacion.expected_studies),
    document: Number(operacion.expected_documents),
  };
  for (const tipo of Object.keys(esperadas)) {
    if ((cantidades[tipo] || 0) !== esperadas[tipo]) throw crearErrorValidacion('BACKUP_RECORD_COUNT_MISMATCH', 'No se recibieron todos los registros del respaldo.');
  }
  const [pacientes, estudios, documentos, archivos] = await Promise.all([
    repositorio.cargarRegistros(pool, operacion.operation_id, 'patient'),
    repositorio.cargarRegistros(pool, operacion.operation_id, 'study'),
    repositorio.cargarRegistros(pool, operacion.operation_id, 'document'),
    repositorio.cargarArchivos(pool, operacion.operation_id, 'entrante'),
  ]);
  const datos = {
    pacientes: pacientes.map(item => item.value),
    estudios: estudios.map(item => item.value),
    documentos: documentos.map(item => item.value),
  };
  const relaciones = validarDatosClinicos(datos);
  if (archivos.length !== datos.documentos.length) throw crearErrorValidacion('BACKUP_FILE_COUNT_MISMATCH', 'Faltan archivos o hay archivos duplicados en el respaldo.');
  const archivosPorDocumento = new Map(archivos.map(archivo => [String(archivo.source_document_id), archivo]));
  const config = readFileStorageConfig();
  if (datos.documentos.length && !config.root) throw crearErrorValidacion('FILE_STORAGE_NOT_CONFIGURED', 'Configure FILE_STORAGE_ROOT para restaurar los documentos.', 503);
  for (const documento of datos.documentos) {
    const archivo = archivosPorDocumento.get(String(documento.id));
    if (!archivo || archivo.sha256 !== documento.sha256 || archivo.original_name !== documento.originalName
      || archivo.mime_type !== documento.mimeType || BigInt(archivo.size_bytes) !== BigInt(documento.sizeBytes)) {
      throw crearErrorValidacion('BACKUP_FILE_METADATA_MISMATCH', 'Los archivos cargados no corresponden a los metadatos del respaldo.');
    }
    if (!validarArchivoRelativo(documento.archivePath)) throw crearErrorValidacion('BACKUP_PATH_INVALID', 'El respaldo contiene una ruta de archivo no válida.');
    const info = await fileInfo(config.root, archivo.file_key);
    if (!info || info.sha256 !== documento.sha256 || BigInt(info.size) !== BigInt(documento.sizeBytes)) {
      throw crearErrorValidacion('BACKUP_DOCUMENT_INTEGRITY_MISMATCH', 'Un archivo cargado no coincide con su SHA-256 o tamaño.');
    }
  }
  const autores = [];
  for (const paciente of datos.pacientes) autores.push(paciente.createdByUsername, paciente.updatedByUsername);
  for (const estudio of datos.estudios) autores.push(estudio.createdByUsername, estudio.updatedByUsername);
  for (const documento of datos.documentos) autores.push(documento.uploadedByUsername, documento.updatedByUsername);
  const codigosServicio = datos.estudios.map(estudio => estudio.serviceCode);
  return { datos, relaciones, archivosPorDocumento, autores: [...new Set(autores.filter(Boolean))], codigosServicio: [...new Set(codigosServicio)] };
}

async function insertarDatosEnTransaccion(connection, pool, operacion, preparados, userId, clientIp, root) {
  const mapasUsuarios = await repositorio.buscarUsuarios(connection, preparados.autores);
  const faltanUsuarios = preparados.autores.filter(nombre => !mapasUsuarios.has(nombre));
  if (faltanUsuarios.length) throw crearErrorValidacion('BACKUP_AUTHOR_NOT_FOUND', `No existen estas cuentas de autor en el sistema: ${faltanUsuarios.slice(0, 5).join(', ')}${faltanUsuarios.length > 5 ? '…' : ''}.`, 409);
  const mapasServicios = await repositorio.buscarServicios(connection, preparados.codigosServicio);
  const faltanServicios = preparados.codigosServicio.filter(codigo => !mapasServicios.has(codigo));
  if (faltanServicios.length) throw crearErrorValidacion('BACKUP_SERVICE_NOT_FOUND', `No están disponibles los servicios requeridos por el respaldo: ${faltanServicios.join(', ')}.`, 409);

  if (operacion.operation_mode === 'reemplazar') {
    const pendientes = await repositorio.listarOperacionesDocumentalesPendientes(connection);
    if (pendientes.length) throw crearErrorValidacion('DOCUMENT_OPERATIONS_PENDING', 'Hay operaciones de documentos pendientes; no se reemplazaron los datos.', 409);
    const actuales = await repositorio.listarDocumentosActuales(connection);
    if (actuales.length && !root) throw crearErrorValidacion('FILE_STORAGE_NOT_CONFIGURED', 'Configure FILE_STORAGE_ROOT antes de reemplazar documentos actuales.', 503);
    if (actuales.some(documento => documento.status !== 'active')) throw crearErrorValidacion('DOCUMENTS_NOT_READY', 'Hay documentos en proceso. No se reemplazaron los datos.', 409);
    for (const documento of actuales) {
      await repositorio.guardarArchivo(connection, {
        operationId: operacion.operation_id, role: 'anterior', sourceDocumentId: documento.id,
        fileKey: documento.storageKey, state: 'pendiente_limpieza',
      });
    }
    await repositorio.eliminarDatosClinicos(connection);
  }

  const mapaPacientes = new Map();
  const pacientesPorId = new Map();
  for (const paciente of preparados.datos.pacientes) {
    const insertado = await repositorio.insertarPaciente(connection, paciente, {
      createdBy: mapasUsuarios.get(paciente.createdByUsername), updatedBy: mapasUsuarios.get(paciente.updatedByUsername),
    });
    const id = String(insertado.insertId);
    mapaPacientes.set(String(paciente.id), id);
    pacientesPorId.set(String(paciente.id), { ...paciente, targetId: id });
  }

  const mapaEstudios = new Map();
  const estudiosPorId = new Map();
  for (const estudio of preparados.datos.estudios) {
    const patientId = mapaPacientes.get(String(estudio.patientId));
    if (!patientId) throw crearErrorValidacion('BACKUP_RELATION_INVALID', 'Un estudio quedó sin paciente durante la restauración.');
    const insertado = await repositorio.insertarEstudio(connection, estudio, patientId, mapasServicios.get(estudio.serviceCode), {
      createdBy: mapasUsuarios.get(estudio.createdByUsername), updatedBy: mapasUsuarios.get(estudio.updatedByUsername),
    });
    const id = String(insertado.insertId);
    mapaEstudios.set(String(estudio.id), id);
    estudiosPorId.set(String(estudio.id), { ...estudio, targetId: id, patientId });
  }

  const mapaDocumentos = new Map();
  for (const documento of preparados.datos.documentos) {
    const patientId = mapaPacientes.get(String(documento.patientId));
    const studyId = mapaEstudios.get(String(documento.studyId));
    const paciente = pacientesPorId.get(String(documento.patientId));
    const estudio = estudiosPorId.get(String(documento.studyId));
    const archivo = preparados.archivosPorDocumento.get(String(documento.id));
    if (!patientId || !studyId || !paciente || !estudio || !archivo) throw crearErrorValidacion('BACKUP_RELATION_INVALID', 'Un documento quedó sin paciente, estudio o archivo durante la restauración.');
    const provisional = `.backup-staging/${operacion.operation_id}/pendiente-${documento.id}`;
    const insertado = await repositorio.insertarDocumento(connection, { ...documento, storageKey: provisional }, patientId, studyId,
      mapasUsuarios.get(documento.uploadedByUsername), documento.updatedByUsername ? mapasUsuarios.get(documento.updatedByUsername) : null);
    const id = String(insertado.insertId);
    const claveFinal = relativeDocumentKey({
      patientId, patientDni: paciente.dni, patientName: paciente.fullName,
      studyId, studyDate: estudio.date, studyType: estudio.type,
      documentId: id, originalName: documento.originalName,
    });
    await repositorio.actualizarClaveDocumento(connection, insertado.insertId, claveFinal);
    const guardado = await repositorio.actualizarArchivo(pool, operacion.operation_id, 'entrante', documento.id, { targetKey: claveFinal });
    if (guardado.affectedRows !== 1) throw new Error('BACKUP_RESTORE_FILE_JOURNAL_MISMATCH');
    await moveKey(root, archivo.file_key, claveFinal);
    const archivoFinal = await fileInfo(root, claveFinal);
    if (!archivoFinal || archivoFinal.sha256 !== documento.sha256 || BigInt(archivoFinal.size) !== BigInt(documento.sizeBytes)) {
      throw new Error('BACKUP_RESTORE_FINAL_FILE_MISMATCH');
    }
    await repositorio.actualizarArchivo(pool, operacion.operation_id, 'entrante', documento.id, { state: 'instalado' });
    mapaDocumentos.set(String(documento.id), id);
  }

  for (const documento of preparados.datos.documentos) {
    if (documento.derivedFromDocumentId !== null) {
      const id = mapaDocumentos.get(String(documento.id));
      const idPadre = mapaDocumentos.get(String(documento.derivedFromDocumentId));
      if (!id || !idPadre) throw crearErrorValidacion('BACKUP_RELATION_INVALID', 'La relación de un documento derivado no se pudo reconstruir.');
      await repositorio.vincularDocumentoDerivado(connection, id, idPadre);
    }
  }

  await repositorio.insertarAuditoria(connection, {
    userId, action: `backup.restore.${operacion.operation_mode}`, entityId: operacion.operation_id,
    details: {
      patients: preparados.datos.pacientes.length,
      studies: preparados.datos.estudios.length,
      documents: preparados.datos.documentos.length,
      result: 'committed',
    }, clientIp,
  });
  const cambio = await repositorio.cambiarEstado(connection, operacion.operation_id, 'aplicando', 'limpieza_pendiente');
  if (cambio.affectedRows !== 1) throw new Error('BACKUP_RESTORE_OPERATION_STATE_MISMATCH');
  return { pacientes: mapaPacientes.size, estudios: mapaEstudios.size, documentos: mapaDocumentos.size };
}

function restauracionConfirmada(operacion) {
  return operacion?.operation_state === 'limpieza_pendiente' || operacion?.operation_state === 'completado'
    || operacion?.operation_state === 'requiere_atencion' && operacion.failure_code === 'RESTORE_FILE_CLEANUP_FAILED';
}

function cancelacionPendiente(operacion) {
  return ['OPERATION_CANCELLED', 'CANCEL_CLEANUP_FAILED'].includes(operacion?.failure_code);
}

async function limpiarOperacionConfirmada(pool, root, operationId) {
  const operacion = await repositorio.buscarOperacion(pool, operationId);
  if (!restauracionConfirmada(operacion)) throw new Error('BACKUP_RESTORE_COMMIT_NOT_CONFIRMED');
  const archivosAnteriores = await repositorio.cargarArchivos(pool, operationId, 'anterior');
  const entrantes = await repositorio.cargarArchivos(pool, operationId, 'entrante');
  if (!root && (archivosAnteriores.length || entrantes.some(archivo => archivo.file_key))) {
    throw Object.assign(new Error('FILE_STORAGE_NOT_CONFIGURED'), { code: 'FILE_STORAGE_NOT_CONFIGURED' });
  }
  for (const archivo of archivosAnteriores) {
    const referenciadas = await repositorio.clavesReferenciadas(pool, [archivo.file_key]);
    if (!referenciadas.has(archivo.file_key)) await unlinkKey(root, archivo.file_key);
  }
  for (const archivo of entrantes) {
    if (archivo.file_key.startsWith('.backup-staging/')) await unlinkKey(root, archivo.file_key);
  }
  if (root) await limpiarDirectorioTemporalDeOperacion(root, operationId);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const actual = await repositorio.buscarOperacionParaActualizar(connection, operationId);
    if (!restauracionConfirmada(actual)) throw new Error('BACKUP_RESTORE_COMMIT_NOT_CONFIRMED');
    if (actual.operation_state !== 'completado') {
      const cambio = await repositorio.cambiarEstado(connection, operationId, actual.operation_state, 'completado');
      if (cambio.affectedRows !== 1) throw new Error('BACKUP_RESTORE_OPERATION_STATE_MISMATCH');
    }
    await repositorio.eliminarDetallesOperacion(connection, operationId);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}

async function limpiarOperacionFallida(pool, root, operationId, { clientIp } = {}) {
  const operacion = await repositorio.buscarOperacion(pool, operationId);
  if (restauracionConfirmada(operacion)) {
    throw Object.assign(new Error('BACKUP_RESTORE_ALREADY_COMMITTED'), { code: 'BACKUP_RESTORE_ALREADY_COMMITTED' });
  }
  const entrantes = await repositorio.cargarArchivos(pool, operationId, 'entrante');
  if (!root && operacion?.operation_mode !== 'backup'
    && (Number(operacion?.expected_documents) > 0 || entrantes.some(archivo => archivo.file_key || archivo.target_key))) {
    throw Object.assign(new Error('FILE_STORAGE_NOT_CONFIGURED'), { code: 'FILE_STORAGE_NOT_CONFIGURED' });
  }
  for (const archivo of entrantes) {
    if (archivo.file_key) await unlinkKey(root, archivo.file_key);
    if (archivo.target_key) {
      const referenciadas = await repositorio.clavesReferenciadas(pool, [archivo.target_key]);
      if (!referenciadas.has(archivo.target_key)) await unlinkKey(root, archivo.target_key);
      else throw new Error('BACKUP_RESTORE_TARGET_STILL_REFERENCED');
    }
  }
  if (root) await limpiarDirectorioTemporalDeOperacion(root, operationId);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const actual = await repositorio.buscarOperacionParaActualizar(connection, operationId);
    if (restauracionConfirmada(actual)) {
      throw Object.assign(new Error('BACKUP_RESTORE_ALREADY_COMMITTED'), { code: 'BACKUP_RESTORE_ALREADY_COMMITTED' });
    }
    if (cancelacionPendiente(actual)) {
      await repositorio.insertarAuditoria(connection, {
        userId: actual.actor_user_id, action: 'backup.cancel', entityId: operationId,
        details: { mode: actual.operation_mode, result: 'cancelled' }, clientIp,
      });
    }
    if (actual && ['aplicando', 'recibiendo', 'requiere_atencion', 'fallido'].includes(actual.operation_state)) {
      const motivo = cancelacionPendiente(actual) ? 'OPERATION_CANCELLED' : 'RESTORE_NOT_COMMITTED';
      await repositorio.cambiarEstado(connection, operationId, actual.operation_state, 'fallido', motivo);
    }
    await repositorio.eliminarDetallesOperacion(connection, operationId);
    await connection.commit();
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally { connection.release(); }
}

async function finalizarRestauracion(operationId, { userId, clientIp }) {
  const pool = database.getPool();
  const operacion = await obtenerOperacion(operationId, userId);
  if (!['agregar', 'reemplazar'].includes(operacion.operation_mode) || operacion.operation_state !== 'recibiendo') {
    throw crearErrorValidacion('BACKUP_OPERATION_STATE', 'La restauración no está lista para confirmarse.', 409);
  }
  const preparados = await validarOperacionParaRestaurar(pool, operacion);
  const config = readFileStorageConfig();
  if (preparados.datos.documentos.length && !config.root) throw crearErrorValidacion('FILE_STORAGE_NOT_CONFIGURED', 'Configure FILE_STORAGE_ROOT para restaurar los documentos.', 503);
  const iniciado = await pool.query(
    "UPDATE backup_restore_operations SET operation_state = 'aplicando', failure_code = NULL WHERE operation_id = ? AND operation_state = 'recibiendo'",
    [operationId],
  );
  if (iniciado.affectedRows !== 1) throw crearErrorValidacion('BACKUP_OPERATION_STATE', 'La restauración ya fue confirmada o cancelada.', 409);

  let conexion;
  let confirmado = false;
  try {
    conexion = await pool.getConnection();
    await conexion.beginTransaction();
    const resultado = await insertarDatosEnTransaccion(conexion, pool, operacion, preparados, userId, clientIp, config.root);
    await conexion.commit();
    confirmado = true;
    let limpiezaPendiente = false;
    try { await limpiarOperacionConfirmada(pool, config.root, operationId); }
    catch (error) {
      limpiezaPendiente = true;
      // limpieza_pendiente demuestra que el COMMIT clínico ya ocurrió, incluso si falla el reintento.
      await repositorio.cambiarEstado(pool, operationId, 'limpieza_pendiente', 'limpieza_pendiente', 'RESTORE_FILE_CLEANUP_FAILED').catch(() => {});
      console.error(JSON.stringify({ level: 'error', event: 'backup_restore_cleanup_required', operationId, errorCode: error.code || 'CLEANUP_FAILED' }));
    }
    return { operationId, modo: operacion.operation_mode, conteos: resultado, completado: true, limpiezaPendiente };
  } catch (error) {
    await conexion?.rollback().catch(() => {});
    const actual = await repositorio.buscarOperacion(pool, operationId).catch(() => null);
    if (confirmado || restauracionConfirmada(actual)) {
      try {
        await limpiarOperacionConfirmada(pool, config.root, operationId);
        return { operationId, modo: operacion.operation_mode, conteos: { pacientes: preparados.datos.pacientes.length, estudios: preparados.datos.estudios.length, documentos: preparados.datos.documentos.length }, completado: true, limpiezaPendiente: false };
      } catch (errorLimpieza) {
        console.error(JSON.stringify({ level: 'error', event: 'backup_restore_cleanup_required', operationId, errorCode: errorLimpieza.code || 'CLEANUP_FAILED' }));
        return { operationId, modo: operacion.operation_mode, completado: true, limpiezaPendiente: true };
      }
    }
    try { await limpiarOperacionFallida(pool, config.root, operationId); }
    catch (errorLimpieza) {
      if (errorLimpieza.code === 'BACKUP_RESTORE_ALREADY_COMMITTED') {
        return { operationId, modo: operacion.operation_mode, completado: true, limpiezaPendiente: true };
      }
      await pool.query("UPDATE backup_restore_operations SET operation_state = 'requiere_atencion', failure_code = 'RESTORE_ROLLBACK_CLEANUP_FAILED' WHERE operation_id = ? AND operation_state = 'aplicando'", [operationId]).catch(() => {});
      console.error(JSON.stringify({ level: 'error', event: 'backup_restore_rollback_cleanup_required', operationId, errorCode: errorLimpieza.code || 'CLEANUP_FAILED' }));
    }
    throw error;
  } finally { if (conexion) conexion.release(); }
}

async function cancelarOperacion(operationId, { userId, clientIp }) {
  const pool = database.getPool();
  const operacion = await obtenerOperacion(operationId, userId);
  if (operacion.operation_state !== 'recibiendo') throw crearErrorValidacion('BACKUP_OPERATION_STATE', 'La operación ya se está aplicando y no puede cancelarse.', 409);
  const cancelada = await repositorio.cambiarEstado(pool, operationId, 'recibiendo', 'requiere_atencion', 'OPERATION_CANCELLED');
  if (cancelada.affectedRows !== 1) throw crearErrorValidacion('BACKUP_OPERATION_STATE', 'La operación cambió y ya no puede cancelarse.', 409);
  const config = readFileStorageConfig();
  try { await limpiarOperacionFallida(pool, config.root, operationId, { clientIp }); }
  catch (error) {
    await repositorio.cambiarEstado(pool, operationId, 'requiere_atencion', 'requiere_atencion', 'CANCEL_CLEANUP_FAILED').catch(() => {});
    throw error;
  }
  return { operationId, cancelada: true };
}

async function recuperarOperaciones(pool, root) {
  try {
    if (!await repositorio.existeJournal(pool)) return [];
    if (root === undefined) root = readFileStorageConfig().root;
    if (root) await ensurePrivateRoot(root);
    const pendientes = await repositorio.listarOperacionesPendientes(pool);
    if (!root && pendientes.some(operacion => operacion.operation_mode !== 'backup' && Number(operacion.expected_documents) > 0)) {
      console.warn(JSON.stringify({ level: 'warn', event: 'backup_restore_recovery_skipped', reason: 'FILE_STORAGE_ROOT_NOT_CONFIGURED' }));
    }
    const resultados = [];
    for (const operacion of pendientes) {
      try {
        if (operacion.operation_mode === 'backup' && operacion.operation_state === 'recibiendo') {
          const connection = await pool.getConnection();
          try { await repositorio.cambiarEstado(connection, operacion.operation_id, 'recibiendo', 'fallido', 'BACKUP_INTERRUPTED'); }
          finally { connection.release(); }
        } else if (restauracionConfirmada(operacion)) {
          if (operacion.operation_mode === 'backup') {
            const connection = await pool.getConnection();
            try { await repositorio.cambiarEstado(connection, operacion.operation_id, operacion.operation_state, 'completado'); }
            finally { connection.release(); }
          } else {
            await limpiarOperacionConfirmada(pool, root, operacion.operation_id);
          }
        } else {
          await limpiarOperacionFallida(pool, root, operacion.operation_id);
        }
        resultados.push({ operationId: operacion.operation_id, outcome: 'reconciled' });
      } catch (error) {
        const resultadoConfirmado = restauracionConfirmada(operacion);
        const codigo = resultadoConfirmado ? 'RESTORE_FILE_CLEANUP_FAILED'
          : cancelacionPendiente(operacion) ? 'CANCEL_CLEANUP_FAILED'
            : typeof error.code === 'string' ? error.code.slice(0, 64) : 'RECOVERY_FAILED';
        await repositorio.cambiarEstado(pool, operacion.operation_id, operacion.operation_state,
          resultadoConfirmado ? 'limpieza_pendiente' : 'requiere_atencion', codigo).catch(() => {});
        const resultado = { operationId: operacion.operation_id, outcome: 'needs_attention', errorCode: error.code || 'RECOVERY_FAILED' };
        resultados.push(resultado);
        console.error(JSON.stringify({ level: 'error', event: 'backup_restore_recovery_required', ...resultado }));
      }
    }
    return resultados;
  } catch (error) {
    // Un fallo del journal de respaldos se informa, pero nunca impide iniciar la API clínica.
    console.error(JSON.stringify({ level: 'error', event: 'backup_restore_recovery_skipped', errorCode: error.code || 'RECOVERY_FAILED' }));
    return [];
  }
}

function isInputError(error) { return error instanceof DocumentInputError; }

module.exports = {
  FORMATO_RESPALDO, VERSION_RESPALDO, validarDatosClinicos, validarArchivoRelativo,
  crearRespaldo, obtenerResumen, completarRespaldo, iniciarRestauracion, guardarLote,
  cargarArchivoRestauracion, finalizarRestauracion, cancelarOperacion, recuperarOperaciones, isInputError,
};
