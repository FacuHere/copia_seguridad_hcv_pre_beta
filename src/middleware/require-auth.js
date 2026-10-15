const { createHash } = require('node:crypto');
const database = require('../config/database');
const { logInternalError } = require('../utils/errors');

const COOKIE_NAME = 'hcv_session';

function getSessionToken(req) {
  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== COOKIE_NAME) continue;
    const token = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{40,60}$/.test(token) ? token : null;
  }
  return null;
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function optionalAuth(req, res, next) {
  const token = getSessionToken(req);
  if (!token) return next();

  try {
    const rows = await database.getPool().query(
      `SELECT s.id AS session_id, u.id, u.username, u.display_name
       FROM app_sessions s
       JOIN app_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND u.is_active = TRUE
       LIMIT 1`,
      [tokenHash(token)],
    );
    if (rows.length) {
      req.auth = {
        sessionId: rows[0].session_id,
        user: { id: rows[0].id, username: rows[0].username, displayName: rows[0].display_name },
      };
    }
    next();
  } catch (error) {
    logInternalError(error, req, 'auth.session');
    req.authUnavailable = true;
    next();
  }
}

function requireAuth(req, res, next) {
  if (req.authUnavailable) {
    return res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'No se pudo validar la sesión.' } });
  }
  if (!req.auth) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Debe iniciar sesión.' } });
  }
  next();
}

module.exports = { COOKIE_NAME, getSessionToken, tokenHash, optionalAuth, requireAuth };
