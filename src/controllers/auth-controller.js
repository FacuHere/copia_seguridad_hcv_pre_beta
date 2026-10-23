const { COOKIE_NAME, getSessionToken } = require('../middleware/require-auth');
const { sendDatabaseError } = require('../utils/errors');
const { respondWithApplicationError } = require('../utils/application-error');
const authService = require('../services/auth-service');

function cookieOptions() {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  return `Path=/api; HttpOnly; SameSite=Strict; Max-Age=${authService.SESSION_SECONDS}${secure}`;
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${cookieOptions().replace(`Max-Age=${authService.SESSION_SECONDS}`, 'Max-Age=0')}`);
}

async function iniciarSesion(req, res) {
  try {
    const resultado = await authService.login({
      username: req.body?.username,
      password: req.body?.password,
      clientIp: req.ip,
    });
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${resultado.token}; ${cookieOptions()}`);
    return res.status(200).json({ user: resultado.user });
  } catch (error) {
    return respondWithApplicationError(res, req, error, 'auth.login', 'El servicio de autenticación no está disponible.');
  }
}

async function obtenerSesion(req, res) {
  try {
    const roles = await authService.currentUserRoles(req.auth.user.id);
    return res.json({ user: { ...req.auth.user, id: Number(req.auth.user.id), roles: roles.map(rol => rol.code) } });
  } catch (error) {
    return sendDatabaseError(res, req, error, 'auth.me', 'No se pudo consultar la sesión.');
  }
}

async function cerrarSesion(req, res) {
  if (req.authUnavailable) {
    clearCookie(res);
    return res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'No se pudo invalidar la sesión en el servidor.' } });
  }
  const token = getSessionToken(req);
  if (token && req.auth) {
    try {
      await authService.logout(req.auth.sessionId, req.ip, req.auth.user.id);
    } catch (error) {
      clearCookie(res);
      return sendDatabaseError(res, req, error, 'auth.logout', 'No se pudo cerrar la sesión.');
    }
  }
  clearCookie(res);
  return res.status(204).end();
}

module.exports = { iniciarSesion, obtenerSesion, cerrarSesion };
