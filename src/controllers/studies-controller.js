const studyService = require('../services/study-service');
const { respondWithApplicationError } = require('../utils/application-error');

function contexto(req) {
  return { userId: req.auth.user.id, clientIp: req.ip, requestId: req.requestId };
}

async function listarPorPaciente(req, res) {
  try {
    return res.json(await studyService.list(req.params.patientId, contexto(req)));
  } catch (error) {
    return respondWithApplicationError(res, req, error, 'studies.list', 'No se pudieron consultar los estudios.');
  }
}

async function crear(req, res) {
  try {
    const resultado = await studyService.create(req.body, contexto(req));
    return res.status(resultado.status).json({ data: resultado.data });
  } catch (error) {
    return respondWithApplicationError(res, req, error, 'studies.create', 'No se pudo crear el estudio.');
  }
}

async function obtener(req, res) {
  try {
    return res.json(await studyService.get(req.params.id, contexto(req)));
  } catch (error) {
    return respondWithApplicationError(res, req, error, 'studies.read', 'No se pudo consultar el estudio.');
  }
}

async function actualizar(req, res) {
  try {
    return res.json(await studyService.update(req.params.id, req.body, contexto(req)));
  } catch (error) {
    return respondWithApplicationError(res, req, error, 'studies.update', 'No se pudo actualizar el estudio.');
  }
}

module.exports = { listarPorPaciente, crear, obtener, actualizar };
