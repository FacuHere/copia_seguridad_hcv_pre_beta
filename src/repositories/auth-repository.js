const database = require('../config/database');

async function findSession(hashedToken) {
  const rows = await database.getPool().query(
    `SELECT s.id AS session_id, u.id, u.username, u.display_name
     FROM app_sessions s
     JOIN app_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND u.is_active = TRUE
     LIMIT 1`,
    [hashedToken],
  );
  return rows[0] || null;
}

async function deleteExpiredSessions(connection) {
  return connection.query('DELETE FROM app_sessions WHERE expires_at <= UTC_TIMESTAMP()');
}

async function deleteOldLoginAttempts(connection) {
  return connection.query(
    'DELETE FROM auth_login_attempts WHERE window_started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)',
  );
}

async function ensureLoginAttempt(connection, clientIp) {
  return connection.query(
    `INSERT INTO auth_login_attempts (client_ip, window_started_at, failure_count)
     VALUES (?, UTC_TIMESTAMP(), 0)
     ON DUPLICATE KEY UPDATE client_ip = VALUES(client_ip)`,
    [clientIp],
  );
}

async function findLoginAttempt(connection, clientIp, windowMinutes = 15) {
  const rows = await connection.query(
    `SELECT failure_count,
            window_started_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${windowMinutes} MINUTE) AS window_expired,
            blocked_until > UTC_TIMESTAMP() AS is_blocked,
            GREATEST(1, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), blocked_until)) AS retry_after
     FROM auth_login_attempts WHERE client_ip = ? FOR UPDATE`,
    [clientIp],
  );
  return rows[0];
}

async function resetLoginAttemptWindow(connection, clientIp) {
  await connection.query(
    'UPDATE auth_login_attempts SET window_started_at = UTC_TIMESTAMP(), failure_count = 0, blocked_until = NULL WHERE client_ip = ?',
    [clientIp],
  );
  const rows = await connection.query(
    `SELECT failure_count, 0 AS window_expired, blocked_until > UTC_TIMESTAMP() AS is_blocked,
            GREATEST(1, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), blocked_until)) AS retry_after
     FROM auth_login_attempts WHERE client_ip = ? FOR UPDATE`,
    [clientIp],
  );
  return rows[0];
}

async function findUserByUsername(connection, username) {
  const rows = await connection.query(
    'SELECT id, username, display_name, password_hash, is_active FROM app_users WHERE username = ? LIMIT 1',
    [username],
  );
  return rows[0] || null;
}

async function findUserRoles(connection, userId) {
  return connection.query(
    `SELECT r.code FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? ORDER BY r.code`,
    [userId],
  );
}

async function recordFailedLogin(connection, maxFailures, blockMinutes, clientIp) {
  return connection.query(
    `UPDATE auth_login_attempts
     SET failure_count = failure_count + 1,
         blocked_until = CASE
           WHEN failure_count + 1 >= ? THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${blockMinutes} MINUTE)
           ELSE blocked_until
         END
     WHERE client_ip = ?`,
    [maxFailures, clientIp],
  );
}

async function clearLoginAttempts(connection, clientIp) {
  return connection.query('DELETE FROM auth_login_attempts WHERE client_ip = ?', [clientIp]);
}

async function createSession(connection, userId, hashedToken, sessionSeconds) {
  return connection.query(
    'INSERT INTO app_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))',
    [userId, hashedToken, sessionSeconds],
  );
}

async function deleteSession(connection, sessionId) {
  return connection.query('DELETE FROM app_sessions WHERE id = ?', [sessionId]);
}

async function recordAudit(connection, userId, action, clientIp) {
  return connection.query(
    'INSERT INTO audit_events (user_id, action_code, client_ip) VALUES (?, ?, ?)',
    [userId, action, clientIp || null],
  );
}

module.exports = {
  findSession,
  deleteExpiredSessions,
  deleteOldLoginAttempts,
  ensureLoginAttempt,
  findLoginAttempt,
  resetLoginAttemptWindow,
  findUserByUsername,
  findUserRoles,
  recordFailedLogin,
  clearLoginAttempts,
  createSession,
  deleteSession,
  recordAudit,
};
