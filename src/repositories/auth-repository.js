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

async function findUserByUsername(connection, username) {
  const rows = await connection.query(
    // Coordinar el login con cambios de contraseña/estado: no crear una sesión con credenciales revocadas.
    'SELECT id, username, display_name, password_hash, is_active FROM app_users WHERE username = ? LIMIT 1 FOR UPDATE',
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

async function createSession(connection, userId, hashedToken, sessionSeconds) {
  return connection.query(
    'INSERT INTO app_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))',
    [userId, hashedToken, sessionSeconds],
  );
}

async function deleteSession(connection, sessionId) {
  return connection.query('DELETE FROM app_sessions WHERE id = ?', [sessionId]);
}

async function deleteSessionsForUser(connection, userId) {
  return connection.query('DELETE FROM app_sessions WHERE user_id = ?', [userId]);
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
  findUserByUsername,
  findUserRoles,
  createSession,
  deleteSession,
  deleteSessionsForUser,
  recordAudit,
};
