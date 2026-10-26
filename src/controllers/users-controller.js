const servicio = require('../services/user-service');
const { respondWithApplicationError } = require('../utils/application-error');

function contexto(req) {
  return { userId: req.auth.user.id, clientIp: req.ip };
}

async function listar(req, res) {
  try { res.json(await servicio.listar(req.query)); }
  catch (error) { respondWithApplicationError(res, req, error, 'users.list', 'No se pudieron consultar los usuarios.'); }
}

async function crear(req, res) {
  try { res.status(201).json(await servicio.crear(req.body, contexto(req))); }
  catch (error) { respondWithApplicationError(res, req, error, 'users.create', 'No se pudo crear el usuario.'); }
}

async function actualizar(req, res) {
  try { res.json(await servicio.actualizar(req.params.id, req.body, contexto(req))); }
  catch (error) { respondWithApplicationError(res, req, error, 'users.update', 'No se pudo actualizar el usuario.'); }
}

async function cambiarContrasena(req, res) {
  try {
    await servicio.cambiarContrasena(req.params.id, req.body, contexto(req));
    res.status(204).end();
  } catch (error) { respondWithApplicationError(res, req, error, 'users.password_reset', 'No se pudo cambiar la contraseña.'); }
}

async function permisos(req, res) {
  try { res.json(await servicio.permisosActuales(req.auth.user.id)); }
  catch (error) { respondWithApplicationError(res, req, error, 'auth.permissions', 'No se pudieron consultar los permisos.'); }
}

module.exports = { listar, crear, actualizar, cambiarContrasena, permisos };
