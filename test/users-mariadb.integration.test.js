const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const express = require('express');
const database = require('../src/config/database');
const { hashPassword, verifyPassword } = require('../src/utils/passwords');
const { tokenHash } = require('../src/middleware/require-auth');

test('Gestión de usuarios: HTTP, SQL real, restricciones y rollback con datos sintéticos', {
  skip: process.env.HCV_MARIADB_USERS_INTEGRATION !== '1' && 'Requiere autorización y configuración explícita de MariaDB de pruebas; no lee .env.',
}, async t => {
  // No crea bases ni roles ni ejecuta migraciones. Todo queda dentro de un rollback exterior.
  const esperado = {
    base: process.env.HCV_MARIADB_TEST_DATABASE,
    puerto: Number(process.env.HCV_MARIADB_TEST_PORT),
    usuario: process.env.HCV_MARIADB_TEST_USER,
    directorio: process.env.HCV_MARIADB_TEST_DATADIR,
  };
  assert.ok(esperado.base && esperado.puerto && esperado.usuario && esperado.directorio, 'Confirme base, puerto, usuario y datadir de pruebas.');
  const pool = database.getPool();
  let conexion;
  let servidor;
  try {
    conexion = await pool.getConnection();
    const [identidad] = await conexion.query('SELECT DATABASE() AS db, @@port AS port, @@datadir AS datadir, CURRENT_USER() AS account');
    const normalizar = ruta => ruta.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    assert.equal(identidad.db, esperado.base);
    assert.equal(Number(identidad.port), esperado.puerto);
    assert.equal(identidad.account, esperado.usuario);
    assert.equal(normalizar(identidad.datadir), normalizar(esperado.directorio));
    const roles = await conexion.query("SELECT id, code FROM roles WHERE code IN ('administrador','medico','secretario','visualizador')");
    assert.equal(roles.length, 4, 'Requiere revisar/aplicar 007 previamente; la prueba no lo hace.');
    await conexion.beginTransaction();
    let numero = 0;
    const poolPrueba = {
      query: (sql, parametros) => conexion.query(sql, parametros),
      async getConnection() {
        let savepoint;
        return {
          query: (sql, parametros) => conexion.query(sql, parametros),
          async beginTransaction() { savepoint = `usuarios_${++numero}`; await conexion.query(`SAVEPOINT ${savepoint}`); },
          async commit() { await conexion.query(`RELEASE SAVEPOINT ${savepoint}`); },
          async rollback() { await conexion.query(`ROLLBACK TO SAVEPOINT ${savepoint}`); },
          release() {},
        };
      },
    };
    t.mock.method(database, 'getPool', () => poolPrueba);
    const sufijo = randomUUID().replace(/-/g, '');
    const contrasena = randomBytes(24).toString('base64url');
    const hash = await hashPassword(contrasena);
    const actor = await conexion.query('INSERT INTO app_users (username, display_name, password_hash) VALUES (?, ?, ?)', [`it_actor_${sufijo}`, 'Prueba sintética', hash]);
    await conexion.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [actor.insertId, roles.find(rol => rol.code === 'administrador').id]);
    const tokenActor = randomBytes(32).toString('base64url');
    await conexion.query('INSERT INTO app_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))', [actor.insertId, tokenHash(tokenActor)]);
    const app = express();
    app.use(express.json());
    app.use('/api/usuarios', require('../src/routes/users'));
    app.use('/api/auth', require('../src/routes/auth'));
    servidor = await new Promise(resolve => { const instancia = app.listen(0, '127.0.0.1', () => resolve(instancia)); });
    const base = `http://127.0.0.1:${servidor.address().port}`;
    const headers = { cookie: `hcv_session=${tokenActor}`, 'content-type': 'application/json' };
    const datos = { username: `it_user_${sufijo}`, displayName: 'Prueba sintética', role: 'medico', password: contrasena, passwordConfirmation: contrasena };
    const crear = () => fetch(`${base}/api/usuarios`, { method: 'POST', headers, body: JSON.stringify(datos) });
    const respuesta = await crear();
    assert.equal(respuesta.status, 201);
    const usuario = (await respuesta.json()).data;
    assert.deepEqual(usuario.roles, ['medico']);
    assert.equal((await crear()).status, 409, 'La restricción UNIQUE debe impedir duplicados.');
    const tokenUsuario = randomBytes(32).toString('base64url');
    await conexion.query('INSERT INTO app_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))', [usuario.id, tokenHash(tokenUsuario)]);
    const cookieUsuario = { cookie: `hcv_session=${tokenUsuario}` };
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: cookieUsuario })).status, 200);
    assert.equal((await fetch(`${base}/api/usuarios`, { headers: cookieUsuario })).status, 403);
    const nueva = randomBytes(24).toString('base64url');
    const cambio = await fetch(`${base}/api/usuarios/${usuario.id}/password`, { method: 'PUT', headers, body: JSON.stringify({ password: nueva, passwordConfirmation: nueva }) });
    assert.equal(cambio.status, 204);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: cookieUsuario })).status, 401);
    const [fila] = await conexion.query('SELECT password_hash FROM app_users WHERE id = ?', [usuario.id]);
    assert.equal(await verifyPassword(nueva, fila.password_hash), true);
    assert.equal(await verifyPassword(contrasena, fila.password_hash), false);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers })).status, 200, 'No revocar la sesión de otra cuenta.');
    const servicio = require('../src/services/user-service');
    await conexion.query('INSERT INTO app_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))', [usuario.id, tokenHash(tokenUsuario)]);
    // Duplicado real de PK al insertar auditoría: obliga a revertir contraseña y sesiones.
    const repositorio = require('../src/repositories/user-repository');
    const [evento] = await conexion.query('SELECT id FROM audit_events WHERE entity_id = ? AND action_code = ?', [usuario.id, 'users.password_reset']);
    t.mock.method(repositorio, 'auditar', async transaccion => transaccion.query('INSERT INTO audit_events (id, action_code) VALUES (?, ?)', [evento.id, 'synthetic.failure']));
    await assert.rejects(servicio.cambiarContrasena(usuario.id, { password: contrasena, passwordConfirmation: contrasena }, { userId: String(actor.insertId) }), { code: 'ER_DUP_ENTRY' });
    const [despues] = await conexion.query('SELECT password_hash FROM app_users WHERE id = ?', [usuario.id]);
    assert.equal(await verifyPassword(nueva, despues.password_hash), true);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: cookieUsuario })).status, 200, 'El rollback restaura también la sesión eliminada.');
  } finally {
    if (servidor) await new Promise(resolve => servidor.close(resolve));
    if (conexion) { await conexion.rollback(); conexion.release(); }
    await pool.end();
  }
});
