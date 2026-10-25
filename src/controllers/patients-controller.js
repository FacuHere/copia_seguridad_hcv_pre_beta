const patientService = require('../services/patient-service');
const { respondWithApplicationError } = require('../utils/application-error');

function contexto(req) {
  return { userId: req.auth.user.id, clientIp: req.ip, requestId: req.requestId };
}

async function listar(req, res) {
  try {
    return res.json(await patientService.list({ query: req.query, ...contexto(req) }));
  } catch (error) {
    return respondWithApplicationError(res, req, error, 'patients.list', 'No se pudieron consultar los pacientes.');
  }
}

async function obtener(req, res) {
  try {
    return res.json(await patientService.get(req.params.id, contexto(req)));
  } catch (error) {
    return respondWithApplicationError(res, req, error, 'patients.read', 'No se pudo consultar el paciente.');
  }
}

async function crear(req, res) {
  try {
    const resultado = await patientService.create(req.body, contexto(req));
    return res.status(resultado.status).json({ data: resultado.data });
  } catch (error) {
    return respondWithApplicationError(res, req, error, 'patients.create', 'No se pudo crear el paciente.');
  }
}

async function actualizar(req, res) {
  try {
    return res.json(await patientService.update(req.params.id, req.body, contexto(req)));
  } catch (error) {
    return respondWithApplicationError(res, req, error, 'patients.update', 'No se pudo actualizar el paciente.');
  }
}

module.exports = { listar, obtener, crear, actualizar };
