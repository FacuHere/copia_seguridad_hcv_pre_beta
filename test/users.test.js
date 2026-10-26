const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const database = require('../src/config/database');
const repositorio = require('../src/repositories/user-repository');
const servicio = require('../src/services/user-service');
const authRepository = require('../src/repositories/auth-repository');
const permissionRepository = require('../src/repositories/permission-repository');
const { verifyPassword } = require('../src/utils/passwords');

// Dobles de las fronteras del servicio, sin simular el motor SQL ni abrir conexiones.
function preparar(t, cambios = {}) {
  const eventos = [];
  const conexion = {
    async beginTransaction() { eventos.push('begin'); },
    async commit() { eventos.push('commit'); },
    async rollback() { eventos.push('rollback'); },
    release() { eventos.push('release'); },
  };
  t.mock.method(database, 'getPool', () => ({ getConnection: async () => conexion }));
  const metodos = {
    bloquearAdministracion: async () => ({ id: 1n }),
    obtenerPermisos: async () => ['users.manage', 'roles.manage'],
    obtener: async () => ({ id: 2n, username: 'synthetic', display_name: 'Prueba', is_active: 1 }),
    obtenerRoles: async () => ['visualizador'],
    obtenerRol: async () => ({ id: 3n }),
    contarAdministradoresActivos: async () => 2,
    crear: async () => { eventos.push('create'); return '2'; },
    asignarRol: async () => { eventos.push('role'); },
    reemplazarRol: async () => { eventos.push('replace-role'); },
    actualizar: async () => { eventos.push('update'); },
    cambiarContrasena: async () => { eventos.push('password'); return { affectedRows: 1 }; },
    cerrarSesiones: async (_conexion, id) => { eventos.push(`sessions:${id}`); },
    auditar: async (_conexion, _contexto, accion) => { eventos.push(accion); },
    ...cambios,
  };
  for (const [nombre, funcion] of Object.entries(metodos)) t.mock.method(repositorio, nombre, funcion);
  return eventos;
}

const contexto = { userId: '1', clientIp: '127.0.0.1' };
const credenciales = { password: 'Contrasena sintetica de prueba', passwordConfirmation: 'Contrasena sintetica de prueba' };

test('crear usuario aplica hashPassword, un solo rol y auditoría en la misma transacción', async t => {
  let hash;
  const eventos = preparar(t, { crear: async (_conexion, datos, valor) => {
    assert.deepEqual(datos, { username: 'prueba', displayName: 'Prueba' }); hash = valor; return '2';
  } });
  const resultado = await servicio.crear({ username: 'prueba', displayName: 'Prueba', role: 'medico', ...credenciales }, contexto);
  assert.equal(await verifyPassword(credenciales.password, hash), true);
  assert.deepEqual(resultado.data.roles, ['medico']);
  assert.equal(resultado.data.id, '2');
  assert.doesNotMatch(JSON.stringify(resultado), /password|scrypt/);
  assert.deepEqual(eventos, ['begin', 'role', 'users.create', 'commit', 'release']);
});

test('contraseña, cierre selectivo de sesiones y auditoría son transaccionales', async t => {
  const eventos = preparar(t);
  await servicio.cambiarContrasena('2', credenciales, contexto);
  assert.deepEqual(eventos, ['begin', 'password', 'sessions:2', 'users.password_reset', 'commit', 'release']);
});

test('un fallo de auditoría o de borrado de sesiones provoca rollback, nunca commit', async t => {
  for (const metodo of ['auditar', 'cerrarSesiones']) {
    await t.test(metodo, async subt => {
      const eventos = preparar(subt, { [metodo]: async () => { throw new Error('SYNTHETIC_FAILURE'); } });
      await assert.rejects(servicio.cambiarContrasena('2', credenciales, contexto), /SYNTHETIC_FAILURE/);
      assert.ok(eventos.includes('rollback'));
      assert.ok(!eventos.includes('commit'));
      assert.equal(eventos.at(-1), 'release');
    });
  }
});

test('rechaza contraseña corta, confirmación diferente, id inválido y campos no previstos', async t => {
  preparar(t);
  for (const [id, datos, codigo] of [
    ['2', { password: 'corta', passwordConfirmation: 'corta' }, 'INVALID_PASSWORD'],
    ['2', { ...credenciales, passwordConfirmation: 'otra' }, 'PASSWORD_MISMATCH'],
    ['0', credenciales, 'INVALID_ID'],
    ['2', { ...credenciales, isActive: true }, 'INVALID_USER'],
  ]) await assert.rejects(servicio.cambiarContrasena(id, datos, contexto), { code: codigo });
  assert.equal(database.getPool.mock.callCount(), 0);
});

test('prohíbe desactivarse o quitarse administrador', async t => {
  const eventos = preparar(t, { obtenerRoles: async () => ['administrador'] });
  for (const datos of [{ isActive: false }, { role: 'medico' }]) {
    await assert.rejects(servicio.actualizar('2', datos, { userId: '2' }), { code: 'SELF_ADMIN_PROTECTION' });
  }
  assert.ok(!eventos.includes('update'));
});

test('protege al último administrador activo aunque el actor sea técnico', async t => {
  preparar(t, { obtenerRoles: async () => ['administrador'], contarAdministradoresActivos: async () => 1 });
  await assert.rejects(servicio.actualizar('2', { isActive: false }, contexto), { code: 'LAST_ADMIN_PROTECTION' });
  await assert.rejects(servicio.actualizar('2', { role: 'visualizador' }, contexto), { code: 'LAST_ADMIN_PROTECTION' });
});

test('los roles técnicos/múltiples se conservan y system_admin no es asignable', async t => {
  const eventos = preparar(t, { obtenerRoles: async () => ['system_admin', 'administrador'] });
  await assert.rejects(servicio.actualizar('2', { role: 'medico' }, contexto), { code: 'ROLE_ASSIGNMENT_UNSUPPORTED' });
  await assert.rejects(servicio.actualizar('2', { role: 'system_admin' }, contexto), { code: 'INVALID_ROLE' });
  const resultado = await servicio.actualizar('2', { displayName: 'Nuevo nombre' }, contexto);
  assert.deepEqual(resultado.data.roles, ['system_admin', 'administrador']);
  assert.ok(!eventos.includes('replace-role'));
});

test('roles.manage se exige para crear/asignar roles, users.manage permite editar nombre', async t => {
  preparar(t, { obtenerPermisos: async () => ['users.manage'] });
  await assert.rejects(servicio.crear({ username: 'prueba', displayName: 'Prueba', role: 'medico', ...credenciales }, contexto), { status: 403 });
  await assert.rejects(servicio.actualizar('2', { role: 'medico' }, contexto), { status: 403 });
  assert.equal((await servicio.actualizar('2', { displayName: 'Nombre' }, contexto)).data.displayName, 'Nombre');
});

test('revoca sesiones al desactivar o cambiar perfil y permite reactivar sin resucitarlas', async t => {
  const eventos = preparar(t);
  await servicio.actualizar('2', { role: 'medico' }, contexto);
  await servicio.actualizar('2', { isActive: false }, contexto);
  await servicio.actualizar('2', { isActive: true }, contexto);
  assert.equal(eventos.filter(evento => evento === 'sessions:2').length, 2);
});

test('no confirma contraseña si no se actualizó exactamente una cuenta', async t => {
  const eventos = preparar(t, { cambiarContrasena: async () => ({ affectedRows: 0 }) });
  await assert.rejects(servicio.cambiarContrasena('2', credenciales, contexto), /USER_PASSWORD_UPDATE_FAILED/);
  assert.ok(eventos.includes('rollback'));
  assert.ok(!eventos.includes('sessions:2'));
});

test('revalida permisos del actor antes de escribir y rechaza usuarios ausentes', async t => {
  await t.test('permiso revocado', async subt => {
    const eventos = preparar(subt, { obtenerPermisos: async () => [] });
    await assert.rejects(servicio.actualizar('2', { displayName: 'Prueba' }, contexto), { status: 403 });
    assert.ok(!eventos.includes('update'));
    assert.ok(eventos.includes('rollback'));
  });
  await t.test('cuenta inexistente', async subt => {
    preparar(subt, { obtener: async () => null });
    await assert.rejects(servicio.cambiarContrasena('2', credenciales, contexto), { code: 'USER_NOT_FOUND' });
  });
});

test('login pide el bloqueo de la cuenta antes de validar y crear su sesión', async () => {
  let consulta;
  await authRepository.findUserByUsername({ query: async (sql, parametros) => {
    consulta = sql;
    assert.deepEqual(parametros, ['sintetico']);
    return [];
  } }, 'sintetico');
  assert.match(consulta, /WHERE username = \? LIMIT 1 FOR UPDATE$/);
});

test('listado agrupa roles, convierte BIGINT y no expone secretos', async t => {
  t.mock.method(repositorio, 'listar', async () => [
    { id: 2n, username: 'prueba', display_name: 'Prueba', is_active: 1, role_code: 'administrador' },
    { id: 2n, username: 'prueba', display_name: 'Prueba', is_active: 1, role_code: 'system_admin' },
  ]);
  const resultado = await servicio.listar({});
  assert.equal(resultado.data.length, 1);
  assert.equal(resultado.data[0].id, '2');
  assert.doesNotThrow(() => JSON.stringify(resultado));
});

test('rutas HTTP exigen sesión y permisos efectivos antes de llamar al servicio', async t => {
  t.mock.method(authRepository, 'findSession', async () => ({ session_id: 1n, id: 1n, username: 'prueba', display_name: 'Prueba' }));
  let permisos = new Set();
  t.mock.method(permissionRepository, 'userHasPermission', async (_id, permiso) => permisos.has(permiso));
  t.mock.method(servicio, 'listar', async () => ({ data: [], page: 1, pageSize: 50 }));
  t.mock.method(servicio, 'crear', async datos => ({ data: { id: '2', username: datos.username } }));
  t.mock.method(servicio, 'actualizar', async id => ({ data: { id } }));
  t.mock.method(servicio, 'cambiarContrasena', async () => {});
  const app = express();
  app.use(express.json());
  app.use('/api/usuarios', require('../src/routes/users'));
  const servidor = await new Promise(resolve => { const instancia = app.listen(0, '127.0.0.1', () => resolve(instancia)); });
  t.after(() => new Promise(resolve => servidor.close(resolve)));
  const base = `http://127.0.0.1:${servidor.address().port}/api/usuarios`;
  const headers = { cookie: `hcv_session=${'a'.repeat(43)}`, 'content-type': 'application/json' };
  assert.equal((await fetch(base)).status, 401);
  for (const [metodo, ruta] of [['GET', ''], ['POST', ''], ['PUT', '/2'], ['PUT', '/2/password']]) {
    assert.equal((await fetch(base + ruta, { method: metodo, headers })).status, 403);
  }
  permisos = new Set(['users.manage']);
  assert.equal((await fetch(base, { headers })).status, 200);
  assert.equal((await fetch(base, { method: 'POST', headers })).status, 403);
  permisos.add('roles.manage');
  assert.equal((await fetch(base, { method: 'POST', headers, body: JSON.stringify({ username: 'sintetico' }) })).status, 201);
  assert.equal((await fetch(base + '/2', { method: 'PUT', headers, body: '{}' })).status, 200);
  const respuestaContrasena = await fetch(base + '/2/password', { method: 'PUT', headers, body: '{}' });
  assert.equal(respuestaContrasena.status, 204);
  assert.equal(await respuestaContrasena.text(), '');
});
