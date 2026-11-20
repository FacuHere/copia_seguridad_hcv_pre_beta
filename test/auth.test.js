const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const express = require('express');
const database = require('../src/config/database');
const repositorio = require('../src/repositories/auth-repository');
const servicio = require('../src/services/auth-service');
const { hashPassword } = require('../src/utils/passwords');

const contrasena = 'Contraseña sintética para pruebas';
const promesaHash = hashPassword(contrasena);

async function preparar(t) {
  const eventos = [];
  const auditorias = [];
  const sesiones = [];
  const hash = await promesaHash;
  const usuarios = [
    { id: 1, username: 'prueba_uno', display_name: 'Prueba uno', password_hash: hash, is_active: 1 },
    { id: 2, username: 'prueba_dos', display_name: 'Prueba dos', password_hash: hash, is_active: 1 },
    { id: 3, username: 'inactivo', display_name: 'Prueba inactiva', password_hash: hash, is_active: 0 },
  ];
  const conexion = {
    async beginTransaction() { eventos.push('inicio'); },
    async commit() { eventos.push('confirmación'); },
    async rollback() { eventos.push('reversión'); },
    release() { eventos.push('liberación'); },
    // No hay acceso al contador heredado, aunque exista o contenga un bloqueo vigente.
    async query() { assert.fail('El login no debe consultar ni modificar contadores de intentos.'); },
  };
  t.mock.method(database, 'getPool', () => ({ getConnection: async () => conexion }));
  t.mock.method(repositorio, 'deleteExpiredSessions', async () => {});
  t.mock.method(repositorio, 'findUserByUsername', async (_conexion, nombre) => usuarios.find(usuario => usuario.username === nombre) || null);
  t.mock.method(repositorio, 'findUserRoles', async () => [{ code: 'visualizador' }]);
  t.mock.method(repositorio, 'createSession', async (_conexion, id, hashToken, duracion) => {
    sesiones.push({ id, hashToken, duracion });
  });
  t.mock.method(repositorio, 'recordAudit', async (_conexion, id, accion, ip) => {
    auditorias.push({ id, accion, ip });
  });
  return { eventos, auditorias, sesiones };
}

async function iniciarServidor(t) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('../src/routes/auth'));
  const servidor = await new Promise(resolve => {
    const instancia = app.listen(0, '127.0.0.1', () => resolve(instancia));
  });
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  return datos => fetch(`http://127.0.0.1:${servidor.address().port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
}

test('más de diez fallos desde una misma IP permiten ingresar inmediatamente con la misma cuenta y con otra', async t => {
  const { auditorias, sesiones } = await preparar(t);
  const ingresar = await iniciarServidor(t);
  // Todos los pedidos llegan desde la misma IP, como en una PC compartida o detrás de un proxy.
  for (let intento = 0; intento < 12; intento++) {
    const respuesta = await ingresar({ username: 'prueba_uno', password: 'Contraseña incorrecta' });
    assert.equal(respuesta.status, 401);
    assert.equal((await respuesta.json()).error.code, 'INVALID_LOGIN');
    assert.equal(respuesta.headers.get('retry-after'), null);
    assert.equal(respuesta.headers.get('set-cookie'), null);
  }
  assert.equal(sesiones.length, 0);
  assert.equal(auditorias.length, 12);
  assert.ok(auditorias.every(evento => evento.accion === 'auth.login_failed' && evento.id === null && evento.ip === '127.0.0.1'));

  for (const [indice, nombre] of ['prueba_uno', 'prueba_dos'].entries()) {
    const respuesta = await ingresar({ username: nombre, password: contrasena });
    assert.equal(respuesta.status, 200);
    assert.equal(respuesta.headers.get('retry-after'), null);
    assert.deepEqual(await respuesta.json(), {
      user: { id: indice + 1, username: nombre, displayName: indice ? 'Prueba dos' : 'Prueba uno', roles: ['visualizador'] },
    });
    const cookie = respuesta.headers.get('set-cookie');
    assert.match(cookie, /hcv_session=[A-Za-z0-9_-]{43}; Path=\/api; HttpOnly; SameSite=Strict; Max-Age=28800/);
    const token = cookie.match(/^hcv_session=([^;]+)/)[1];
    assert.deepEqual(sesiones[indice], {
      id: indice + 1,
      hashToken: createHash('sha256').update(token).digest('hex'),
      duracion: 28800,
    });
  }
  assert.deepEqual(auditorias.slice(12).map(evento => evento.accion), ['auth.login', 'auth.login']);
});

test('los fallos de distintas cuentas o cuentas inexistentes no impiden ingresar desde la IP compartida', async t => {
  const { auditorias, sesiones } = await preparar(t);
  const ingresar = await iniciarServidor(t);
  const nombres = ['prueba_uno', 'prueba_dos', 'inexistente', 'inactivo'];
  for (let intento = 0; intento < 12; intento++) {
    const respuesta = await ingresar({ username: nombres[intento % nombres.length], password: contrasena + ' incorrecta' });
    assert.equal(respuesta.status, 401);
    assert.equal((await respuesta.json()).error.code, 'INVALID_LOGIN');
  }
  const inactivo = await ingresar({ username: 'inactivo', password: contrasena });
  assert.equal(inactivo.status, 401);
  assert.equal((await inactivo.json()).error.code, 'INVALID_LOGIN');
  assert.equal(sesiones.length, 0);
  assert.equal(auditorias.length, 13);
  const respuesta = await ingresar({ username: 'prueba_dos', password: contrasena });
  assert.equal(respuesta.status, 200);
  assert.equal((await respuesta.json()).user.username, 'prueba_dos');
  assert.equal(sesiones.length, 1);
});

test('el login conserva la validación de formato sin acceder a MariaDB ni crear sesiones', async t => {
  const { auditorias, sesiones } = await preparar(t);
  for (const datos of [{}, { username: '', password: contrasena }, { username: 'prueba_uno', password: 123 }]) {
    await assert.rejects(servicio.login(datos), { status: 400, code: 'INVALID_CREDENTIALS_FORMAT' });
  }
  assert.equal(database.getPool.mock.callCount(), 0);
  assert.equal(auditorias.length, 0);
  assert.equal(sesiones.length, 0);
});

test('un fallo de auditoría revierte la transacción y libera la conexión', async t => {
  const { eventos } = await preparar(t);
  t.mock.method(repositorio, 'recordAudit', async () => { throw new Error('Fallo sintético de auditoría'); });
  await assert.rejects(servicio.login({ username: 'prueba_uno', password: 'Incorrecta', clientIp: '127.0.0.1' }), /Fallo sintético de auditoría/);
  assert.deepEqual(eventos, ['inicio', 'reversión', 'liberación']);
});
