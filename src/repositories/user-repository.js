const database = require('../config/database');

async function listar(busqueda, limite, desplazamiento) {
  const filtro = `%${busqueda.replace(/[!%_]/g, caracter => `!${caracter}`)}%`;
  return database.getPool().query(
    `SELECT u.id, u.username, u.display_name, u.is_active, r.code AS role_code
     FROM (SELECT id, username, display_name, is_active FROM app_users
           WHERE username LIKE ? ESCAPE '!' OR display_name LIKE ? ESCAPE '!'
           ORDER BY username, id LIMIT ? OFFSET ?) u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id ORDER BY u.username, u.id, r.code`,
    [filtro, filtro, limite, desplazamiento],
  );
}

async function obtenerPermisos(conexion, idUsuario) {
  const filas = await conexion.query(
    `SELECT DISTINCT p.code FROM app_users u
     JOIN user_roles ur ON ur.user_id = u.id
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE u.id = ? AND u.is_active = TRUE ORDER BY p.code`, [idUsuario],
  );
  return filas.map(fila => fila.code);
}

async function bloquearAdministracion(conexion) {
  // Todas las escrituras de este módulo toman el mismo bloqueo antes de leer usuarios.
  const filas = await conexion.query("SELECT id FROM roles WHERE code = 'administrador' FOR UPDATE");
  return filas[0] || null;
}

async function obtener(conexion, idUsuario) {
  const filas = await conexion.query(
    'SELECT id, username, display_name, is_active FROM app_users WHERE id = ? FOR UPDATE', [idUsuario],
  );
  return filas[0] || null;
}

async function obtenerRoles(conexion, idUsuario) {
  const filas = await conexion.query(
    `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? ORDER BY r.code`, [idUsuario],
  );
  return filas.map(fila => fila.code);
}

async function obtenerRol(conexion, codigo) {
  const filas = await conexion.query('SELECT id FROM roles WHERE code = ?', [codigo]);
  return filas[0] || null;
}

async function contarAdministradoresActivos(conexion) {
  const filas = await conexion.query(
    `SELECT COUNT(*) AS total FROM app_users u JOIN user_roles ur ON ur.user_id = u.id
     JOIN roles r ON r.id = ur.role_id WHERE u.is_active = TRUE AND r.code = 'administrador'`,
  );
  return Number(filas[0].total);
}

async function crear(conexion, datos, hash) {
  const resultado = await conexion.query(
    'INSERT INTO app_users (username, display_name, password_hash, is_active) VALUES (?, ?, ?, TRUE)',
    [datos.username, datos.displayName, hash],
  );
  return String(resultado.insertId);
}

async function asignarRol(conexion, idUsuario, idRol) {
  return conexion.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [idUsuario, idRol]);
}

async function reemplazarRol(conexion, idUsuario, idRol) {
  await conexion.query('DELETE FROM user_roles WHERE user_id = ?', [idUsuario]);
  await asignarRol(conexion, idUsuario, idRol);
}

async function actualizar(conexion, idUsuario, nombre, activo) {
  return conexion.query('UPDATE app_users SET display_name = ?, is_active = ? WHERE id = ?', [nombre, activo, idUsuario]);
}

async function cambiarContrasena(conexion, idUsuario, hash) {
  return conexion.query('UPDATE app_users SET password_hash = ? WHERE id = ?', [hash, idUsuario]);
}

async function cerrarSesiones(conexion, idUsuario) {
  return conexion.query('DELETE FROM app_sessions WHERE user_id = ?', [idUsuario]);
}

async function auditar(conexion, contexto, accion, idUsuario) {
  return conexion.query(
    `INSERT INTO audit_events (user_id, action_code, entity_type, entity_id, client_ip)
     VALUES (?, ?, 'user', ?, ?)`, [contexto.userId, accion, String(idUsuario), contexto.clientIp || null],
  );
}

module.exports = {
  listar, obtenerPermisos, bloquearAdministracion, obtener, obtenerRoles, obtenerRol,
  contarAdministradoresActivos, crear, asignarRol, reemplazarRol, actualizar,
  cambiarContrasena, cerrarSesiones, auditar,
};
