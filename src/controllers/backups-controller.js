const backupService = require('../services/backup-service');
const { respondWithApplicationError } = require('../utils/application-error');

function contexto(req) {
  return { userId: req.auth.user.id, clientIp: req.ip, requestId: req.requestId };
}

function responderError(res, req, error, contextoError, mensaje) {
  if (backupService.isInputError(error)) {
    const estado = error.code === 'FILE_TOO_LARGE' ? 413
      : ['UNSUPPORTED_FILE_TYPE', 'MIME_MISMATCH', 'INVALID_FILE_CONTENT', 'INVALID_DICOM_FILE'].includes(error.code) ? 415 : 400;
    return res.status(estado).json({ error: { code: error.code, message: error.message, requestId: req.requestId } });
  }
  return respondWithApplicationError(res, req, error, contextoError, mensaje);
}

async function exportar(req, res) {
  try {
    const data = await backupService.crearRespaldo({
      incluirReferenciasUsuarios: req.body?.incluirReferenciasUsuarios ?? false,
      ...contexto(req),
    });
    return res.status(201).json({ data });
  } catch (error) {
    return responderError(res, req, error, 'backup.export', 'No se pudo preparar el respaldo clínico.');
  }
}

async function resumen(req, res) {
  try { return res.json({ data: await backupService.obtenerResumen() }); }
  catch (error) { return responderError(res, req, error, 'backup.summary', 'No se pudo consultar el alcance de la restauración.'); }
}

async function completar(req, res) {
  try { return res.json({ data: await backupService.completarRespaldo(req.params.operationId, contexto(req)) }); }
  catch (error) { return responderError(res, req, error, 'backup.complete', 'No se pudo registrar el respaldo completado.'); }
}

async function iniciarRestauracion(req, res) {
  try {
    const data = await backupService.iniciarRestauracion({
      formato: req.body?.formato,
      version: req.body?.version,
      modo: req.body?.modo,
      conteos: req.body?.conteos,
      ...contexto(req),
    });
    return res.status(201).json({ data });
  } catch (error) { return responderError(res, req, error, 'backup.restore_start', 'No se pudo iniciar la restauración.'); }
}

async function guardarLote(req, res) {
  try {
    const data = await backupService.guardarLote(req.params.operationId, req.body?.tipo, req.body?.registros, req.auth.user.id);
    return res.status(201).json({ data });
  } catch (error) { return responderError(res, req, error, 'backup.restore_records', 'No se pudieron preparar los registros del respaldo.'); }
}

async function cargarArchivo(req, res) {
  try {
    const data = await backupService.cargarArchivoRestauracion(req.params.operationId, req.params.documentId, req, req.auth.user.id);
    return res.status(201).json({ data });
  } catch (error) { return responderError(res, req, error, 'backup.restore_file', 'No se pudo preparar un archivo del respaldo.'); }
}

async function confirmarRestauracion(req, res) {
  try { return res.json({ data: await backupService.finalizarRestauracion(req.params.operationId, contexto(req)) }); }
  catch (error) { return responderError(res, req, error, 'backup.restore', 'No se pudo completar la restauración.'); }
}

async function cancelar(req, res) {
  try { return res.json({ data: await backupService.cancelarOperacion(req.params.operationId, contexto(req)) }); }
  catch (error) { return responderError(res, req, error, 'backup.cancel', 'No se pudo cancelar la operación.'); }
}

module.exports = { exportar, resumen, completar, iniciarRestauracion, guardarLote, cargarArchivo, confirmarRestauracion, cancelar };
