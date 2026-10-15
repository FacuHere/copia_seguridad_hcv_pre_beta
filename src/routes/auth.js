const { Router } = require('express');
const { createHash, randomBytes } = require('node:crypto');
const database = require('../config/database');
const { verifyPassword } = require('../utils/passwords');
const { COOKIE_NAME, getSessionToken, tokenHash, optionalAuth, requireAuth } = require('../middleware/require-auth');
const { sendDatabaseError } = require('../utils/errors');

const router = Router();
const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_MAX_FAILURES = 10;
const LOGIN_BLOCK_MINUTES = 15;

function cookieOptions() {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  return `Path=/api; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`;
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; ${cookieOptions().replace(`Max-Age=${SESSION_SECONDS}`, 'Max-Age=0')}`);
}

async function recordAudit(connection, userId, action, req) {
  await connection.query(
    'INSERT INTO audit_events (user_id, action_code, client_ip) VALUES (?, ?, ?)',
    [userId, action, req.ip || null],
  );
}

router.post('/login', async (req, res) => {
  const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!username || username.length > 100 || !password || password.length > 1024) {
    return res.status(400).json({ error: { code: 'INVALID_CREDENTIALS_FORMAT', message: 'Ingrese usuario y contraseña válidos.' } });
  }

  let connection;
  try {
    const pool = database.getPool();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const clientIp = req.ip || 'unknown';

    await connection.query('DELETE FROM app_sessions WHERE expires_at <= UTC_TIMESTAMP()');

    // Periodically remove old per-IP counters; the indexed predicate bounds cleanup work.
    await connection.query(
      'DELETE FROM auth_login_attempts WHERE window_started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)',
    );
    await connection.query(
      `INSERT INTO auth_login_attempts (client_ip, window_started_at, failure_count)
       VALUES (?, UTC_TIMESTAMP(), 0)
       ON DUPLICATE KEY UPDATE client_ip = VALUES(client_ip)`,
      [clientIp],
    );
    let attemptRows = await connection.query(
      `SELECT failure_count,
              window_started_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${LOGIN_WINDOW_MINUTES} MINUTE) AS window_expired,
              blocked_until > UTC_TIMESTAMP() AS is_blocked,
              GREATEST(1, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), blocked_until)) AS retry_after
       FROM auth_login_attempts WHERE client_ip = ? FOR UPDATE`,
      [clientIp],
    );
    if (Number(attemptRows[0].is_blocked)) {
      await connection.rollback();
      res.setHeader('Retry-After', String(attemptRows[0].retry_after));
      return res.status(429).json({ error: { code: 'LOGIN_RATE_LIMITED', message: 'Se alcanzó el límite temporal de intentos. Intente más tarde.' } });
    }
    if (Number(attemptRows[0].window_expired)) {
      await connection.query(
        'UPDATE auth_login_attempts SET window_started_at = UTC_TIMESTAMP(), failure_count = 0, blocked_until = NULL WHERE client_ip = ?',
        [clientIp],
      );
      attemptRows = await connection.query(
        `SELECT failure_count, 0 AS window_expired, blocked_until > UTC_TIMESTAMP() AS is_blocked,
                GREATEST(1, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), blocked_until)) AS retry_after
         FROM auth_login_attempts WHERE client_ip = ? FOR UPDATE`,
        [clientIp],
      );
    }

    const users = await connection.query(
      'SELECT id, username, display_name, password_hash, is_active FROM app_users WHERE username = ? LIMIT 1',
      [username],
    );
    const user = users[0];
    const passwordMatches = await verifyPassword(password, user?.password_hash);
    if (!user || !user.is_active || !passwordMatches) {
      await connection.query(
        `UPDATE auth_login_attempts
         SET failure_count = failure_count + 1,
             blocked_until = CASE
               WHEN failure_count + 1 >= ? THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${LOGIN_BLOCK_MINUTES} MINUTE)
               ELSE blocked_until
             END
         WHERE client_ip = ?`,
        [LOGIN_MAX_FAILURES, clientIp],
      );
      await recordAudit(connection, null, 'auth.login_failed', req);
      await connection.commit();
      return res.status(401).json({ error: { code: 'INVALID_LOGIN', message: 'Usuario o contraseña incorrectos.' } });
    }

    const roles = await connection.query(
      `SELECT r.code FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ? ORDER BY r.code`,
       [user.id],
    );
    await connection.query('DELETE FROM auth_login_attempts WHERE client_ip = ?', [clientIp]);
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');

    await connection.query(
      'INSERT INTO app_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))',
      [user.id, hash, SESSION_SECONDS],
    );
    await recordAudit(connection, user.id, 'auth.login', req);
    await connection.commit();

    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; ${cookieOptions()}`);
    res.status(200).json({
      user: { id: Number(user.id), username: user.username, displayName: user.display_name, roles: roles.map(role => role.code) },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    sendDatabaseError(res, req, error, 'auth.login', 'El servicio de autenticación no está disponible.');
  } finally {
    if (connection) connection.release();
  }
});

router.get('/me', optionalAuth, requireAuth, async (req, res) => {
  try {
    const roles = await database.getPool().query(
      `SELECT r.code FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ? ORDER BY r.code`,
      [req.auth.user.id],
    );
    res.json({ user: { ...req.auth.user, id: Number(req.auth.user.id), roles: roles.map(role => role.code) } });
  } catch (error) {
    sendDatabaseError(res, req, error, 'auth.me', 'No se pudo consultar la sesión.');
  }
});

router.post('/logout', optionalAuth, async (req, res) => {
  if (req.authUnavailable) {
    clearCookie(res);
    return res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'No se pudo invalidar la sesión en el servidor.' } });
  }
  const token = getSessionToken(req);
  if (token && req.auth) {
    let connection;
    try {
      connection = await database.getPool().getConnection();
      await connection.beginTransaction();
      await connection.query('DELETE FROM app_sessions WHERE id = ?', [req.auth.sessionId]);
      await recordAudit(connection, req.auth.user.id, 'auth.logout', req);
      await connection.commit();
    } catch (error) {
      if (connection) await connection.rollback().catch(() => {});
      clearCookie(res);
      return sendDatabaseError(res, req, error, 'auth.logout', 'No se pudo cerrar la sesión.');
    } finally {
      if (connection) connection.release();
    }
  }
  clearCookie(res);
  res.status(204).end();
});

module.exports = router;
