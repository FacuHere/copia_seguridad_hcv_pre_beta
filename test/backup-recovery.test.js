const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const database = require('../src/config/database');
const repositorio = require('../src/repositories/backup-repository');
const { recuperarOperaciones, cancelarOperacion } = require('../src/services/backup-service');

async function prepararEscenario(t, estado, codigo = null) {
  const raiz = await fs.mkdtemp(path.join(os.tmpdir(), 'hcv-backup-recovery-'));
  const entornoAnterior = { root: process.env.FILE_STORAGE_ROOT, limit: process.env.MAX_FILE_SIZE_BYTES };
  process.env.FILE_STORAGE_ROOT = raiz;
  process.env.MAX_FILE_SIZE_BYTES = '1048576';
  t.after(async () => {
    if (entornoAnterior.root === undefined) delete process.env.FILE_STORAGE_ROOT; else process.env.FILE_STORAGE_ROOT = entornoAnterior.root;
    if (entornoAnterior.limit === undefined) delete process.env.MAX_FILE_SIZE_BYTES; else process.env.MAX_FILE_SIZE_BYTES = entornoAnterior.limit;
    await fs.rm(raiz, { recursive: true, force: true });
  });

  const operacion = { operation_id: randomUUID(), operation_mode: 'reemplazar', operation_state: estado,
    failure_code: codigo, actor_user_id: '9', expected_documents: 1 };
  const archivos = [];
  const registros = [{ id: '1' }];
  const referenciadas = new Set();
  const auditoria = [];
  const conexion = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
  const pool = { getConnection: async () => conexion };
  const cambiarEstado = async (_conexion, id, previo, siguiente, motivo = null) => {
    if (id !== operacion.operation_id || previo !== operacion.operation_state) return { affectedRows: 0 };
    operacion.operation_state = siguiente;
    operacion.failure_code = motivo;
    return { affectedRows: 1 };
  };
  t.mock.method(database, 'getPool', () => pool);
  t.mock.method(repositorio, 'existeJournal', async () => true);
  t.mock.method(repositorio, 'buscarOperacion', async () => ({ ...operacion }));
  t.mock.method(repositorio, 'buscarOperacionParaActualizar', async () => ({ ...operacion }));
  t.mock.method(repositorio, 'listarOperacionesPendientes', async () => {
    const pendiente = ['recibiendo', 'aplicando', 'limpieza_pendiente', 'requiere_atencion'].includes(operacion.operation_state)
      || operacion.operation_state === 'fallido' && (archivos.length || registros.length);
    return pendiente ? [{ ...operacion }] : [];
  });
  t.mock.method(repositorio, 'cargarArchivos', async (_conexion, _id, rol) => archivos.filter(archivo => !rol || archivo.file_role === rol).map(archivo => ({ ...archivo })));
  t.mock.method(repositorio, 'clavesReferenciadas', async (_conexion, claves) => new Set(claves.filter(clave => referenciadas.has(clave))));
  t.mock.method(repositorio, 'cambiarEstado', cambiarEstado);
  t.mock.method(repositorio, 'cambiarEstadoActual', async (_conexion, id, siguiente, motivo) => cambiarEstado(_conexion, id, operacion.operation_state, siguiente, motivo));
  t.mock.method(repositorio, 'eliminarDetallesOperacion', async () => { archivos.length = 0; registros.length = 0; });
  t.mock.method(repositorio, 'insertarAuditoria', async (_conexion, evento) => { auditoria.push(evento); });
  const escribir = async (clave, bytes) => {
    const destino = path.join(raiz, ...clave.split('/'));
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, bytes);
    return destino;
  };
  return { raiz, operacion, archivos, registros, referenciadas, auditoria, pool, escribir };
}

test('recupera una limpieza postcommit histórica sin borrar el archivo restaurado ni reclasificarla como fallida', async t => {
  const escenario = await prepararEscenario(t, 'requiere_atencion', 'RESTORE_FILE_CLEANUP_FAILED');
  const { operacion, archivos, escribir, raiz, pool } = escenario;
  const claveTemporal = `.backup-staging/${operacion.operation_id}/1-${randomUUID()}.part`;
  const claveFinal = 'Pacientes/P-1/Estudios/E-2/D-3 - informe.pdf';
  const anterior = await escribir('Pacientes/P-4/Estudios/E-5/anterior.pdf', 'anterior sintetico');
  const temporal = await escribir(claveTemporal, 'nuevo sintetico');
  const final = await escribir(claveFinal, 'nuevo sintetico');
  escenario.referenciadas.add(claveFinal);
  archivos.push({ file_role: 'anterior', file_key: 'Pacientes/P-4/Estudios/E-5/anterior.pdf' },
    { file_role: 'entrante', file_key: claveTemporal, target_key: claveFinal });

  assert.equal((await recuperarOperaciones(pool, raiz))[0].outcome, 'reconciled');
  assert.equal(operacion.operation_state, 'completado');
  assert.equal(operacion.failure_code, null);
  assert.deepEqual(await fs.readFile(final), Buffer.from('nuevo sintetico'));
  await assert.rejects(fs.stat(anterior), { code: 'ENOENT' });
  await assert.rejects(fs.stat(temporal), { code: 'ENOENT' });
  assert.equal(archivos.length, 0);
  assert.deepEqual(await recuperarOperaciones(pool, raiz), []);
});

test('varios fallos de limpieza conservan el COMMIT confirmado incluso cuando la restauración no tiene documentos', async t => {
  const { operacion, raiz, pool, escribir } = await prepararEscenario(t, 'requiere_atencion', 'RESTORE_FILE_CLEANUP_FAILED');
  operacion.expected_documents = 0;
  const desconocido = await escribir(`.backup-staging/${operacion.operation_id}/no-borrar.tmp`, 'requiere revision');
  for (let intento = 0; intento < 2; intento++) {
    assert.equal((await recuperarOperaciones(pool, raiz))[0].outcome, 'needs_attention');
    assert.equal(operacion.operation_state, 'limpieza_pendiente');
    assert.equal(operacion.failure_code, 'RESTORE_FILE_CLEANUP_FAILED');
    await fs.access(desconocido);
  }
  await fs.unlink(desconocido);
  assert.equal((await recuperarOperaciones(pool, raiz))[0].outcome, 'reconciled');
  assert.equal(operacion.operation_state, 'completado');
});

test('recupera una cancelación histórica fallida que todavía conserva archivos y registros', async t => {
  const { operacion, archivos, registros, auditoria, raiz, pool, escribir } = await prepararEscenario(t, 'fallido', 'OPERATION_CANCELLED');
  const clave = `.backup-staging/${operacion.operation_id}/1-${randomUUID()}.part`;
  const temporal = await escribir(clave, 'archivo sintetico cancelado');
  archivos.push({ file_role: 'entrante', file_key: clave, target_key: null });

  assert.equal((await recuperarOperaciones(pool, raiz))[0].outcome, 'reconciled');
  await assert.rejects(fs.stat(temporal), { code: 'ENOENT' });
  assert.equal(operacion.operation_state, 'fallido');
  assert.equal(operacion.failure_code, 'OPERATION_CANCELLED');
  assert.equal(archivos.length, 0);
  assert.equal(registros.length, 0);
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].action, 'backup.cancel');
  assert.deepEqual(await recuperarOperaciones(pool, raiz), []);
  assert.equal(auditoria.length, 1);
});

test('una cancelación con limpieza interrumpida sigue recuperable y se audita al completarse', async t => {
  const { operacion, archivos, auditoria, raiz, pool, escribir } = await prepararEscenario(t, 'recibiendo');
  const clave = `.backup-staging/${operacion.operation_id}/1-${randomUUID()}.part`;
  await escribir(clave, 'archivo sintetico para cancelar');
  archivos.push({ file_role: 'entrante', file_key: clave, target_key: null });
  const desconocido = await escribir(`.backup-staging/${operacion.operation_id}/no-borrar.tmp`, 'requiere revision');

  await assert.rejects(cancelarOperacion(operacion.operation_id, { userId: '9', clientIp: '127.0.0.1' }), { code: 'BACKUP_STAGING_UNRECOGNIZED_ENTRY' });
  assert.equal(operacion.operation_state, 'requiere_atencion');
  assert.equal(operacion.failure_code, 'CANCEL_CLEANUP_FAILED');
  assert.equal(archivos.length, 1);
  assert.equal(auditoria.length, 0);
  await fs.access(desconocido);
  await fs.unlink(desconocido);

  assert.equal((await recuperarOperaciones(pool, raiz))[0].outcome, 'reconciled');
  assert.equal(operacion.operation_state, 'fallido');
  assert.equal(operacion.failure_code, 'OPERATION_CANCELLED');
  assert.equal(archivos.length, 0);
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].action, 'backup.cancel');
});
