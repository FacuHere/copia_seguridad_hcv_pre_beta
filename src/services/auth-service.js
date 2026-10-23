const { createHash, randomBytes } = require('node:crypto');
const database = require('../config/database');
const authRepository = require('../repositories/auth-repository');
const { verifyPassword } = require('../utils/passwords');
const { ApplicationError } = require('../utils/application-error');

const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES = 10;
const LOGIN_BLOCK_MINUTES = 15;

async function login({ username, password, clientIp }) {
  if (typeof username !== 'string' || typeof password !== 'string') {
    throw new ApplicationError(400, 'INVALID_CREDENTIALS_FORMAT', 'Ingrese usuario y contraseña válidos.');
  }
  const nombreUsuario = username.trim();
  if (!nombreUsuario || nombreUsuario.length > 100 || !password || password.length > 1024) {
    throw new ApplicationError(400, 'INVALID_CREDENTIALS_FORMAT', 'Ingrese usuario y contraseña válidos.');
  }

  let connection;
  try {
    connection = await database.getPool().getConnection();
    await connection.beginTransaction();
    const ipCliente = clientIp || 'unknown';

    await authRepository.deleteExpiredSessions(connection);
    await authRepository.deleteOldLoginAttempts(connection);
    await authRepository.ensureLoginAttempt(connection, ipCliente);
    let intento = await authRepository.findLoginAttempt(connection, ipCliente, LOGIN_WINDOW_MINUTES);
    if (Number(intento.is_blocked)) {
      await connection.rollback();
      throw new ApplicationError(429, 'LOGIN_RATE_LIMITED', 'Se alcanzó el límite temporal de intentos. Intente más tarde.', {
        headers: { 'Retry-After': String(intento.retry_after) },
      });
    }
    if (Number(intento.window_expired)) {
      intento = await authRepository.resetLoginAttemptWindow(connection, ipCliente);
    }

    const usuario = await authRepository.findUserByUsername(connection, nombreUsuario);
    const contrasenaValida = await verifyPassword(password, usuario?.password_hash);
    if (!usuario || !usuario.is_active || !contrasenaValida) {
      await authRepository.recordFailedLogin(connection, LOGIN_MAX_FAILURES, LOGIN_BLOCK_MINUTES, ipCliente);
      await authRepository.recordAudit(connection, null, 'auth.login_failed', clientIp);
      await connection.commit();
      throw new ApplicationError(401, 'INVALID_LOGIN', 'Usuario o contraseña incorrectos.');
    }

    const roles = await authRepository.findUserRoles(connection, usuario.id);
    await authRepository.clearLoginAttempts(connection, ipCliente);
    const token = randomBytes(32).toString('base64url');
    const hashToken = createHash('sha256').update(token).digest('hex');
    await authRepository.createSession(connection, usuario.id, hashToken, SESSION_SECONDS);
    await authRepository.recordAudit(connection, usuario.id, 'auth.login', clientIp);
    await connection.commit();

    return {
      token,
      user: { id: Number(usuario.id), username: usuario.username, displayName: usuario.display_name, roles: roles.map(rol => rol.code) },
    };
  } catch (error) {
    if (connection && error instanceof ApplicationError) throw error;
    if (connection) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

async function currentUserRoles(userId) {
  return authRepository.findUserRoles(database.getPool(), userId);
}

async function logout(sessionId, clientIp, userId) {
  let connection;
  try {
    connection = await database.getPool().getConnection();
    await connection.beginTransaction();
    await authRepository.deleteSession(connection, sessionId);
    await authRepository.recordAudit(connection, userId, 'auth.logout', clientIp);
    await connection.commit();
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

module.exports = { login, currentUserRoles, logout, SESSION_SECONDS };
