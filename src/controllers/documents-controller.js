const documentService = require('../services/document-service');
const { sendDatabaseError } = require('../utils/errors');
const { respondWithApplicationError } = require('../utils/application-error');

function contexto(req) {
  return { userId: req.auth.user.id, clientIp: req.ip, requestId: req.requestId };
}

function inputResponse(res, req, error) {
  const status = error.code === 'FILE_TOO_LARGE' ? 413
    : ['UNSUPPORTED_FILE_TYPE', 'MIME_MISMATCH', 'INVALID_FILE_CONTENT', 'INVALID_DICOM_FILE'].includes(error.code) ? 415 : 400;
  return res.status(status).json({ error: { code: error.code || 'INVALID_FILE', message: error.message, requestId: req.requestId } });
}

function sendFileHeaders(res, document, disposition) {
  const asciiName = document.original_name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_') || 'documento';
  const encodedName = encodeURIComponent(document.original_name).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  res.setHeader('Content-Type', document.mime_type);
  res.setHeader('Content-Length', String(document.size_bytes));
  res.setHeader('Content-Disposition', `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
}

async function listarPorEstudio(req, res) {
  try {
    return res.json(await documentService.listByStudy(req.params.studyId, contexto(req)));
  } catch (error) {
    return respondWithApplicationError(res, req, error, 'documents.list', 'No se pudieron consultar los documentos.');
  }
}

async function cargar(req, res) {
  try {
    const data = await documentService.upload(req.params.studyId, req, contexto(req));
    return res.status(201).json({ data });
  } catch (error) {
    if (documentService.isInputError(error)) return inputResponse(res, req, error);
    return respondWithApplicationError(res, req, error, 'documents.upload', 'No se pudo cargar el archivo.');
  }
}

async function transmitir(req, res, disposition) {
  let resultado;
  try {
    resultado = await documentService.prepareStream(req.params.id, disposition, contexto(req));
  } catch (error) {
    return respondWithApplicationError(res, req, error, 'documents.stream', 'No se pudo acceder al documento.');
  }

  const { document, fileHandle } = resultado;
  sendFileHeaders(res, document, disposition);
  const stream = fileHandle.createReadStream({ autoClose: true });
  res.on('close', () => { if (!res.writableFinished) stream.destroy(); });
  stream.on('error', error => {
    if (!res.headersSent) sendDatabaseError(res, req, error, 'documents.stream', 'No se pudo transmitir el documento.');
    else res.destroy(error);
  });
  stream.pipe(res);
}

function descargar(req, res) { return transmitir(req, res, 'attachment'); }
function visualizar(req, res) { return transmitir(req, res, 'inline'); }

async function reemplazar(req, res) {
  try {
    return res.json({ data: await documentService.replace(req.params.id, req, contexto(req)) });
  } catch (error) {
    if (documentService.isInputError(error)) return inputResponse(res, req, error);
    return respondWithApplicationError(res, req, error, 'documents.replace', 'No se pudo reemplazar el archivo.');
  }
}

async function eliminar(req, res) {
  try {
    await documentService.remove(req.params.id, contexto(req));
    return res.status(204).end();
  } catch (error) {
    if (documentService.isInputError(error)) return inputResponse(res, req, error);
    return respondWithApplicationError(res, req, error, 'documents.delete', 'No se pudo eliminar el archivo.');
  }
}

module.exports = { listarPorEstudio, cargar, descargar, visualizar, reemplazar, eliminar };
