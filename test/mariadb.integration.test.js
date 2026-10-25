const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const habilitada = process.env.HCV_MARIADB_INTEGRATION === '1';

function crearPoolConSavepoints(connection, seguimiento) {
  let contadorSavepoints = 0;

  async function consultar(sql, parametros = []) {
    const resultado = await connection.query(sql, parametros);
    if (/^\s*INSERT\s+INTO\s+audit_events\b/i.test(sql)) seguimiento.auditorias++;
    if (/^\s*INSERT\s+INTO\s+document_file_operations\b/i.test(sql)) {
      seguimiento.operaciones.push(String(parametros[0]));
    }
    return resultado;
  }

  return {
    query: consultar,
    async getConnection() {
      let savepoint = null;
      return {
        query: consultar,
        async beginTransaction() {
          assert.equal(savepoint, null, 'La conexión de prueba ya tiene un savepoint activo.');
          savepoint = `hcv_it_${++contadorSavepoints}`;
          await connection.query(`SAVEPOINT ${savepoint}`);
        },
        async commit() {
          assert.notEqual(savepoint, null, 'No se puede cerrar un savepoint inexistente.');
          await connection.query(`RELEASE SAVEPOINT ${savepoint}`);
          savepoint = null;
        },
        async rollback() {
          if (savepoint === null) return;
          await connection.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await connection.query(`RELEASE SAVEPOINT ${savepoint}`);
          savepoint = null;
        },
        release() {},
      };
    },
  };
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function crearFormulario(bytes, nombre, mimeType) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mimeType }), nombre);
  return form;
}

function dentroDe(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function restaurarVariable(nombre, valor) {
  if (valor === undefined) delete process.env[nombre];
  else process.env[nombre] = valor;
}

test('flujos HTTP de pacientes, estudios y documentos usan MariaDB real y revierten sus datos sintéticos', {
  skip: !habilitada && 'Defina HCV_MARIADB_INTEGRATION=1 para habilitar la prueba contra MariaDB configurada.',
}, async () => {
  // server.js carga la configuración local sin imprimir sus valores.
  const servidorAplicacion = require('../src/server');
  const database = require('../src/config/database');
  const authRepository = require('../src/repositories/auth-repository');
  const { tokenHash } = require('../src/middleware/require-auth');
  const { state: estadoAlmacenamiento } = require('../src/services/storage-readiness');

  const baseDatosEsperada = process.env.HCV_MARIADB_TEST_DATABASE;
  const puertoEsperado = Number(process.env.HCV_MARIADB_TEST_PORT);
  const usuarioEsperado = process.env.HCV_MARIADB_TEST_USER;
  const datadirEsperado = process.env.HCV_MARIADB_TEST_DATADIR;
  assert.ok(baseDatosEsperada, 'Indique HCV_MARIADB_TEST_DATABASE como confirmación del destino de pruebas.');
  assert.ok(Number.isInteger(puertoEsperado) && puertoEsperado > 0, 'Indique HCV_MARIADB_TEST_PORT como confirmación del destino de pruebas.');
  assert.ok(usuarioEsperado, 'Indique HCV_MARIADB_TEST_USER como confirmación del usuario de aplicación esperado.');
  assert.ok(datadirEsperado, 'Indique HCV_MARIADB_TEST_DATADIR como confirmación del destino de pruebas.');

  const poolOriginal = database.getPool;
  const estadoOriginalAlmacenamiento = { ...estadoAlmacenamiento };
  const variablesAnteriores = {
    FILE_STORAGE_ROOT: process.env.FILE_STORAGE_ROOT,
    MAX_FILE_SIZE_BYTES: process.env.MAX_FILE_SIZE_BYTES,
  };

  let poolReal;
  let conexion;
  let poolTransaccional;
  let servidor;
  let raizTemporal;
  let token;
  let tokenHashGuardado;
  let transaccionExternaIniciada = false;
  let errorDeLimpieza = null;
  const huella = randomUUID();
  const documentoOriginal = Buffer.from([0x08, 0x00, 0x16, 0x00, 0x55, 0x49, 0x00, 0x00]);
  const documentoReemplazo = Buffer.from('%PDF-1.7\nInforme sintético para prueba MariaDB.');
  const seguimiento = { auditorias: 0, operaciones: [] };
  const dniSintetico = `HCV-IT-${huella.slice(0, 12)}`;
  const dniParaRollback = `HCV-RB-${huella.slice(0, 12)}`;
  let idPaciente;
  let idSegundoPaciente;
  let idEstudio;
  let idDocumento;
  let claveOriginal;
  let claveReemplazo;
  let identidad;

  try {
    poolReal = poolOriginal();
    conexion = await poolReal.getConnection();

    const filasIdentidad = await conexion.query(
      'SELECT VERSION() AS version, DATABASE() AS databaseName, @@port AS port, @@datadir AS datadir, @@global.read_only AS readOnly, CURRENT_USER() AS currentUser',
    );
    identidad = filasIdentidad[0];
    assert.equal(identidad.databaseName, baseDatosEsperada, 'La base conectada no coincide con la base de pruebas confirmada.');
    assert.equal(Number(identidad.port), puertoEsperado, 'El puerto conectado no coincide con el puerto de pruebas confirmado.');
    const normalizarRutaWindows = value => path.win32.resolve(String(value).replaceAll('/', '\\')).replace(/[\\]+$/, '').toLowerCase();
    assert.equal(normalizarRutaWindows(identidad.datadir), normalizarRutaWindows(datadirEsperado), 'El datadir no coincide con la instancia de pruebas confirmada.');
    assert.match(identidad.version, /MariaDB/i, 'La conexión no corresponde a MariaDB.');
    assert.equal(String(identidad.readOnly).toUpperCase(), 'OFF', 'La instancia actual es de solo lectura y no permite esta prueba.');
    assert.notEqual((process.env.DB_USER || '').trim().toLowerCase(), 'root', 'La aplicación no debe conectarse como root.');
    assert.ok(['127.0.0.1', 'localhost', '::1'].includes((process.env.DB_HOST || '').trim().toLowerCase()), 'La conexión debe permanecer en loopback.');
    assert.equal(String(identidad.currentUser).split('@')[0], usuarioEsperado, 'La conexión no usa la cuenta de aplicación esperada.');

    const tablas = await conexion.query('SHOW TABLES');
    const nombresTablas = new Set(tablas.map(row => Object.values(row)[0]));
    for (const tabla of ['app_users', 'app_sessions', 'audit_events', 'patients', 'studies', 'services', 'documents', 'document_file_operations']) {
      assert.ok(nombresTablas.has(tabla), `Falta la tabla requerida ${tabla}.`);
    }

    const candidatosRecuperacion = await conexion.query(
      "SELECT COUNT(*) AS total FROM document_file_operations WHERE operation_state IN ('prepared', 'filesystem_applied') OR (operation_state = 'completed' AND backup_key IS NOT NULL)",
    );
    assert.equal(Number(candidatosRecuperacion[0].total), 0, 'Hay operaciones de archivos pendientes; no se iniciará el servidor de prueba.');

    const usuario = await conexion.query(
      `SELECT u.id
       FROM app_users u
       WHERE u.is_active = TRUE
         AND EXISTS (
           SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
           WHERE ur.user_id = u.id AND r.code = 'administrador'
         )
         AND (
           SELECT COUNT(DISTINCT p.code)
           FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id
           WHERE ur.user_id = u.id
             AND p.code IN ('patients.create', 'patients.read', 'studies.create', 'studies.read', 'studies.update',
                            'documents.read', 'documents.download', 'documents.upload', 'documents.replace', 'documents.delete')
         ) = 10
       ORDER BY u.id LIMIT 1`,
    );
    assert.ok(usuario.length, 'No hay un usuario administrador activo con los permisos requeridos para la prueba.');
    const idUsuario = String(usuario[0].id);

    await conexion.beginTransaction();
    transaccionExternaIniciada = true;
    poolTransaccional = crearPoolConSavepoints(conexion, seguimiento);
    database.getPool = () => poolTransaccional;

    raizTemporal = await fs.mkdtemp(path.join(os.tmpdir(), 'hcv-mariadb-integration-'));
    process.env.FILE_STORAGE_ROOT = raizTemporal;
    process.env.MAX_FILE_SIZE_BYTES = '1048576';

    token = randomBytes(32).toString('base64url');
    tokenHashGuardado = tokenHash(token);
    await authRepository.createSession(conexion, idUsuario, tokenHashGuardado, 3600);

    const listener = await servidorAplicacion.start({
      pool: poolTransaccional,
      storageConfig: require('../src/config/file-storage').readFileStorageConfig(),
      listenPort: 0,
      listenHost: '127.0.0.1',
    });
    servidor = listener;
    if (!listener.listening) await once(listener, 'listening');
    const baseUrl = `http://127.0.0.1:${listener.address().port}`;
    const cookie = `hcv_session=${token}`;

    const sinSesion = await fetch(`${baseUrl}/api/pacientes`);
    assert.equal(sinSesion.status, 401, 'La ruta de pacientes debe rechazar una petición sin sesión.');

    const salud = await fetch(`${baseUrl}/api/health/database`);
    assert.equal(salud.status, 200, 'El endpoint de salud debe consultar la MariaDB actual.');

    const respuestaPaciente = await fetch(`${baseUrl}/api/pacientes`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: `Prueba HCV ${huella}`, dni: dniSintetico }),
    });
    assert.equal(respuestaPaciente.status, 201, 'La API debe crear el paciente sintético en MariaDB.');
    const paciente = (await respuestaPaciente.json()).data;
    idPaciente = String(paciente.id);
    assert.ok(idPaciente);

    const respuestaSegundoPaciente = await fetch(`${baseUrl}/api/pacientes`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: `Segundo paciente HCV ${huella}`, dni: `HCV-2-${huella.slice(0, 12)}` }),
    });
    assert.equal(respuestaSegundoPaciente.status, 201);
    idSegundoPaciente = String((await respuestaSegundoPaciente.json()).data.id);

    const servicioPaciente = require('../src/services/patient-service');
    await assert.rejects(
      servicioPaciente.create(
        { fullName: `Rollback HCV ${huella}`, dni: dniParaRollback },
        { userId: idUsuario, clientIp: 'x'.repeat(100) },
      ),
      error => error.errno === 1406,
      'MariaDB debe rechazar el valor demasiado largo y el servicio debe revertir el paciente previo a la auditoría.',
    );
    const pacienteRevertido = await conexion.query('SELECT COUNT(*) AS total FROM patients WHERE dni = ?', [dniParaRollback]);
    assert.equal(Number(pacienteRevertido[0].total), 0, 'El fallo de auditoría no debe dejar un paciente parcial.');

    const respuestaEstudio = await fetch(`${baseUrl}/api/estudios`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ patientId: idPaciente, type: 'Integración MariaDB', date: '2026-10-24', professional: 'Profesional sintético' }),
    });
    assert.equal(respuestaEstudio.status, 201, 'La API debe persistir el estudio en MariaDB.');
    const estudio = (await respuestaEstudio.json()).data;
    idEstudio = String(estudio.id);
    assert.equal(String(estudio.patientId), idPaciente);

    const listaEstudios = await fetch(`${baseUrl}/api/pacientes/${idPaciente}/estudios`, { headers: { cookie } });
    assert.equal(listaEstudios.status, 200);
    const estudios = (await listaEstudios.json()).data;
    assert.ok(estudios.some(item => String(item.id) === idEstudio));

    const fechaInmutable = await fetch(`${baseUrl}/api/estudios/${idEstudio}`, {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ ...estudio, date: '2026-10-25', version: estudio.version }),
    });
    assert.equal(fechaInmutable.status, 422, 'La API debe impedir modificar la fecha del estudio.');
    const filaEstudio = await conexion.query('SELECT DATE_FORMAT(study_date, \'%Y-%m-%d\') AS studyDate FROM studies WHERE id = ?', [idEstudio]);
    assert.equal(filaEstudio[0]?.studyDate, '2026-10-24');

    const falloFk = await assert.rejects(
      conexion.query(
        `INSERT INTO documents (patient_id, study_id, original_name, storage_key, mime_type, size_bytes, sha256, uploaded_by, file_status)
         VALUES (?, ?, ?, ?, 'application/dicom', 1, ?, ?, 'pending')`,
        [idSegundoPaciente, idEstudio, `asociacion-invalida-${huella}.dcm`, `integration/${huella}-invalid.dcm`, 'a'.repeat(64), idUsuario],
      ),
      error => error.errno === 1452,
      'La FK compuesta debe rechazar un documento que combine paciente y estudio distintos.',
    );
    assert.equal(falloFk, undefined);

    const respuestaCarga = await fetch(`${baseUrl}/api/estudios/${idEstudio}/documentos`, {
      method: 'POST', headers: { cookie }, body: crearFormulario(documentoOriginal, `synthetic-${huella}.dcm`, 'application/dicom'),
    });
    assert.equal(respuestaCarga.status, 201, 'La API debe aceptar un DICOM sintético sin prefijo Part 10 y persistirlo.');
    const cargado = (await respuestaCarga.json()).data;
    idDocumento = String(cargado.id);
    assert.equal(cargado.sha256, hash(documentoOriginal));
    assert.equal(String(cargado.patientId), idPaciente);
    assert.equal(String(cargado.studyId), idEstudio);

    const filaDocumento = await conexion.query(
      'SELECT id, storage_key, sha256, file_status FROM documents WHERE id = ?', [idDocumento],
    );
    assert.equal(filaDocumento.length, 1);
    assert.equal(filaDocumento[0].sha256, hash(documentoOriginal));
    assert.equal(filaDocumento[0].file_status, 'active');
    claveOriginal = filaDocumento[0].storage_key;
    const rutaOriginal = path.resolve(raizTemporal, ...claveOriginal.split('/'));
    const publicRoot = path.resolve(__dirname, '..', 'public');
    assert.equal(dentroDe(raizTemporal, rutaOriginal), true);
    assert.equal(dentroDe(publicRoot, rutaOriginal), false, 'El archivo debe quedar fuera de public/.');
    assert.deepEqual(await fs.readFile(rutaOriginal), documentoOriginal);
    assert.equal(hash(await fs.readFile(rutaOriginal)), filaDocumento[0].sha256);

    const listaDocumentos = await fetch(`${baseUrl}/api/estudios/${idEstudio}/documentos`, { headers: { cookie } });
    assert.equal(listaDocumentos.status, 200);
    assert.ok((await listaDocumentos.json()).data.some(item => String(item.id) === idDocumento));

    const descargaOriginal = await fetch(`${baseUrl}/api/documentos/${idDocumento}/download`, { headers: { cookie } });
    assert.equal(descargaOriginal.status, 200);
    assert.deepEqual(Buffer.from(await descargaOriginal.arrayBuffer()), documentoOriginal);

    const rutaPublica = await fetch(`${baseUrl}/${claveOriginal.split('/').map(encodeURIComponent).join('/')}`);
    assert.equal(rutaPublica.status, 404, 'El repositorio privado no debe exponerse como ruta estática.');

    const respuestaReemplazo = await fetch(`${baseUrl}/api/documentos/${idDocumento}`, {
      method: 'PUT', headers: { cookie }, body: crearFormulario(documentoReemplazo, `synthetic-${huella}.pdf`, 'application/pdf'),
    });
    assert.equal(respuestaReemplazo.status, 200, 'La API debe reemplazar el archivo manteniendo su identidad.');
    const reemplazado = (await respuestaReemplazo.json()).data;
    assert.equal(String(reemplazado.id), idDocumento);
    assert.equal(reemplazado.sha256, hash(documentoReemplazo));

    const filaReemplazada = await conexion.query('SELECT storage_key, sha256, file_status FROM documents WHERE id = ?', [idDocumento]);
    claveReemplazo = filaReemplazada[0].storage_key;
    assert.equal(filaReemplazada[0].sha256, hash(documentoReemplazo));
    assert.equal(filaReemplazada[0].file_status, 'active');
    const rutaReemplazo = path.resolve(raizTemporal, ...claveReemplazo.split('/'));
    assert.deepEqual(await fs.readFile(rutaReemplazo), documentoReemplazo);
    await assert.rejects(fs.access(rutaOriginal), { code: 'ENOENT' });

    const descargaReemplazo = await fetch(`${baseUrl}/api/documentos/${idDocumento}/download`, { headers: { cookie } });
    assert.equal(descargaReemplazo.status, 200);
    assert.deepEqual(Buffer.from(await descargaReemplazo.arrayBuffer()), documentoReemplazo);

    const respuestaEliminacion = await fetch(`${baseUrl}/api/documentos/${idDocumento}`, { method: 'DELETE', headers: { cookie } });
    assert.equal(respuestaEliminacion.status, 204, 'La API debe eliminar físicamente el archivo y su fila.');
    const filaEliminada = await conexion.query('SELECT id FROM documents WHERE id = ?', [idDocumento]);
    assert.equal(filaEliminada.length, 0);
    await assert.rejects(fs.access(rutaReemplazo), { code: 'ENOENT' });

    const operaciones = await conexion.query(
      'SELECT operation_type AS type, operation_state AS state FROM document_file_operations WHERE document_id = ? ORDER BY created_at, operation_type',
      [idDocumento],
    );
    assert.deepEqual(new Set(operaciones.map(row => row.type)), new Set(['upload', 'replace', 'delete']));
    assert.ok(operaciones.every(row => row.state === 'completed'));
    assert.ok(seguimiento.auditorias >= 8, 'Las rutas de pacientes, estudios y documentos deben insertar auditoría real.');
  } finally {
    try {
      if (servidor) await new Promise(resolve => servidor.close(resolve));
    } catch (error) { errorDeLimpieza = error; }
    try {
      if (conexion) {
        if (transaccionExternaIniciada) {
          await conexion.rollback();
          transaccionExternaIniciada = false;
        }
        if (tokenHashGuardado) {
          const sesiones = await conexion.query('SELECT COUNT(*) AS total FROM app_sessions WHERE token_hash = ?', [tokenHashGuardado]);
          assert.equal(Number(sesiones[0].total), 0, 'La sesión sintética debe desaparecer al revertir la transacción.');
        }
        if (idPaciente || idSegundoPaciente || idEstudio || idDocumento) {
          const dniValores = [dniSintetico, `HCV-2-${huella.slice(0, 12)}`, dniParaRollback];
          const pacientes = await conexion.query('SELECT COUNT(*) AS total FROM patients WHERE dni IN (?, ?, ?)', dniValores);
          assert.equal(Number(pacientes[0].total), 0, 'No deben quedar pacientes sintéticos al terminar la prueba.');
        }
        if (idEstudio) {
          const estudios = await conexion.query('SELECT COUNT(*) AS total FROM studies WHERE id = ?', [idEstudio]);
          assert.equal(Number(estudios[0].total), 0, 'No debe quedar el estudio sintético al terminar la prueba.');
        }
        if (idDocumento) {
          const documentos = await conexion.query('SELECT COUNT(*) AS total FROM documents WHERE id = ?', [idDocumento]);
          assert.equal(Number(documentos[0].total), 0, 'No debe quedar el documento sintético al terminar la prueba.');
          for (const operationId of seguimiento.operaciones) {
            const operaciones = await conexion.query('SELECT COUNT(*) AS total FROM document_file_operations WHERE operation_id = ?', [operationId]);
            assert.equal(Number(operaciones[0].total), 0, 'No debe quedar una operación sintética en el journal.');
          }
        }
      }
    } catch (error) { errorDeLimpieza ||= error; }
    try {
      database.getPool = poolOriginal;
      restaurarVariable('FILE_STORAGE_ROOT', variablesAnteriores.FILE_STORAGE_ROOT);
      restaurarVariable('MAX_FILE_SIZE_BYTES', variablesAnteriores.MAX_FILE_SIZE_BYTES);
      Object.assign(estadoAlmacenamiento, estadoOriginalAlmacenamiento);
      if (conexion) conexion.release();
      if (poolReal) await poolReal.end();
    } catch (error) { errorDeLimpieza ||= error; }
    try {
      if (raizTemporal) await fs.rm(raizTemporal, { recursive: true, force: true });
    } catch (error) { errorDeLimpieza ||= error; }
    if (errorDeLimpieza) throw errorDeLimpieza;
  }
});
