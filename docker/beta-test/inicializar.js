// Aprovisionamiento explícito de una instalación Docker beta NUEVA, nunca del servidor Windows.
const fs = require('node:fs/promises');
const path = require('node:path');
const mariadb = require('mariadb');
const { hashPassword, verifyPassword } = require('../src/utils/passwords');

const BASE_PRUEBAS = 'hcv_docker_beta_test';
const CUENTA_APLICACION = "'hcv_beta_app'@'%'";
const MIGRACIONES = [
  '001_initial_schema.sql', '002_auth_sessions.sql', '003_security_scope_and_bootstrap.sql',
  '004_functional_roles_permissions.sql', '005_seed_general_service.sql',
  '006_documents_storage_lifecycle.sql', '007_user_management_roles.sql', '008_backup_restore.sql',
];
const PRIVILEGIOS = {
  app_users: ['SELECT', 'INSERT', 'UPDATE'],
  app_sessions: ['SELECT', 'INSERT', 'DELETE'],
  auth_login_attempts: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  user_roles: ['SELECT', 'INSERT', 'DELETE'],
  roles: ['SELECT'], role_permissions: ['SELECT'], permissions: ['SELECT'], services: ['SELECT'],
  patients: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  studies: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  documents: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  audit_events: ['INSERT'],
  document_file_operations: ['SELECT', 'INSERT', 'UPDATE'],
  backup_restore_operations: ['SELECT', 'INSERT', 'UPDATE'],
  backup_restore_records: ['SELECT', 'INSERT', 'DELETE'],
  backup_restore_files: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
};

function leerConfiguracion() {
  if (process.env.HCV_DOCKER_BETA_SETUP !== '1' || process.env.DB_HOST !== 'db'
    || process.env.DB_PORT !== '3306' || process.env.DB_NAME !== BASE_PRUEBAS) {
    throw new Error('Este comando solo admite el servicio inicializar del Compose Docker beta.');
  }
  for (const nombre of ['MARIADB_ROOT_PASSWORD', 'MARIADB_APP_PASSWORD', 'HCV_TEST_ADMIN_PASSWORD']) {
    const valor = process.env[nombre];
    if (!valor || valor.startsWith('REEMPLAZAR_') || Array.from(valor).length < 12 || valor.length > 1024) {
      throw new Error(`Complete ${nombre} con una contraseña de prueba de al menos 12 caracteres.`);
    }
  }
  const usuario = process.env.HCV_TEST_ADMIN_USERNAME;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/.test(usuario || '')) throw new Error('El usuario web de prueba no es válido.');
  const limite = process.env.MAX_FILE_SIZE_BYTES;
  if (!/^\d+$/.test(limite || '') || !Number.isSafeInteger(Number(limite)) || Number(limite) <= 0) {
    throw new Error('MAX_FILE_SIZE_BYTES debe contener un entero positivo seguro.');
  }
  return { usuario, host: 'db', port: 3306, database: BASE_PRUEBAS, charset: 'utf8mb4' };
}

async function principal() {
  let configuracion;
  try { configuracion = leerConfiguracion(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  if (process.argv.slice(2).join(' ') === '--validar-configuracion') {
    console.log('Configuración beta válida; no se abrió ninguna conexión SQL.');
    return;
  }
  if (process.argv.length !== 2) throw new Error('Argumentos no admitidos.');

  let conexion;
  let conexionAplicacion;
  let transaccion = false;
  let paso = 'conectar_instancia_beta';
  try {
    const { usuario, ...destino } = configuracion;
    conexion = await mariadb.createConnection({ ...destino, user: 'root', password: process.env.MARIADB_ROOT_PASSWORD, multipleStatements: true });
    const [identidad] = await conexion.query('SELECT DATABASE() AS base, @@port AS puerto, VERSION() AS version');
    if (identidad.base !== BASE_PRUEBAS || Number(identidad.puerto) !== 3306 || !/^12\.2\.2(?:-|$)/.test(identidad.version)) {
      throw Object.assign(new Error(), { code: 'INSTANCIA_BETA_INCORRECTA' });
    }
    paso = 'comprobar_base_vacia';
    const [tablas] = await conexion.query('SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ?', [BASE_PRUEBAS]);
    const cuentas = await conexion.query("SELECT User FROM mysql.user WHERE User = 'hcv_beta_app'");
    if (Number(tablas.total) !== 0 || cuentas.length) {
      throw Object.assign(new Error(), { code: 'BASE_O_CUENTA_BETA_YA_EXISTENTE' });
    }
    // Leer todos los scripts antes de comenzar: evita DDL parcial por un archivo faltante.
    const scripts = await Promise.all(MIGRACIONES.map(async nombre => ({ nombre, sql: await fs.readFile(path.join('/migrations', nombre), 'utf8') })));
    for (const script of scripts) {
      paso = script.nombre;
      await conexion.query(script.sql);
      console.log(`Migración completada: ${script.nombre}`);
    }
    paso = 'crear_cuenta_sql_aplicacion';
    await conexion.query(`CREATE USER ${CUENTA_APLICACION} IDENTIFIED BY ?`, [process.env.MARIADB_APP_PASSWORD]);
    for (const [tabla, permisos] of Object.entries(PRIVILEGIOS)) {
      paso = `permisos_${tabla}`;
      await conexion.query(`GRANT ${permisos.join(', ')} ON \`${BASE_PRUEBAS}\`.\`${tabla}\` TO ${CUENTA_APLICACION}`);
    }

    paso = 'crear_administrador_web';
    const roles = await conexion.query("SELECT id FROM roles WHERE code = 'administrador'");
    if (roles.length !== 1) throw new Error('No existe exactamente un rol administrador.');
    const hash = await hashPassword(process.env.HCV_TEST_ADMIN_PASSWORD);
    if (!await verifyPassword(process.env.HCV_TEST_ADMIN_PASSWORD, hash)) throw new Error('No se pudo comprobar el hash del usuario de prueba.');
    await conexion.beginTransaction();
    transaccion = true;
    const resultado = await conexion.query('INSERT INTO app_users (username, password_hash, display_name, is_active) VALUES (?, ?, ?, 1)',
      [usuario, hash, 'Administrador de pruebas Docker']);
    await conexion.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [resultado.insertId, roles[0].id]);
    await conexion.query('INSERT INTO audit_events (user_id, action_code, entity_type, entity_id) VALUES (?, ?, ?, ?)',
      [resultado.insertId, 'system.bootstrap_admin', 'user', String(resultado.insertId)]);
    await conexion.commit();
    transaccion = false;

    paso = 'verificar_cuenta_aplicacion';
    conexionAplicacion = await mariadb.createConnection({ ...destino, user: 'hcv_beta_app', password: process.env.MARIADB_APP_PASSWORD });
    const [cuenta] = await conexionAplicacion.query('SELECT CURRENT_USER() AS cuenta, DATABASE() AS base');
    if (cuenta.cuenta !== 'hcv_beta_app@%' || cuenta.base !== BASE_PRUEBAS) throw new Error('La cuenta de aplicación no coincide.');
    // SHOW GRANTS puede incluir material de autenticación: comprobarlo sin imprimir sus filas.
    const concesiones = await conexionAplicacion.query('SHOW GRANTS');
    const tablasVerificadas = new Set();
    for (const fila of concesiones) {
      const concesion = Object.values(fila)[0];
      if (concesion.startsWith('GRANT USAGE ON *.* TO ')) continue;
      const coincidencia = concesion.match(/^GRANT ([A-Z, ]+) ON `hcv_docker_beta_test`\.`([a-z_]+)` TO /);
      if (!coincidencia || !PRIVILEGIOS[coincidencia[2]]
        || coincidencia[1].split(',').map(valor => valor.trim()).sort().join(',') !== [...PRIVILEGIOS[coincidencia[2]]].sort().join(',')) {
        throw Object.assign(new Error(), { code: 'PRIVILEGIOS_BETA_INESPERADOS' });
      }
      tablasVerificadas.add(coincidencia[2]);
    }
    if (tablasVerificadas.size !== Object.keys(PRIVILEGIOS).length) throw Object.assign(new Error(), { code: 'PRIVILEGIOS_BETA_INCOMPLETOS' });
    for (const tabla of Object.keys(PRIVILEGIOS).filter(nombre => PRIVILEGIOS[nombre].includes('SELECT'))) {
      await conexionAplicacion.query(`SELECT 1 FROM \`${tabla}\` LIMIT 1`);
    }
    const [clinicos] = await conexionAplicacion.query('SELECT (SELECT COUNT(*) FROM patients) + (SELECT COUNT(*) FROM studies) + (SELECT COUNT(*) FROM documents) AS total');
    if (Number(clinicos.total) !== 0) throw new Error('Se esperaban tablas clínicas vacías.');
    console.log(`Instalación nueva preparada: ${BASE_PRUEBAS}; MariaDB ${identidad.version}; cuenta SQL ${cuenta.cuenta}; usuario web ${usuario}.`);
    console.log('Privilegios por tabla comprobados, sin DDL ni privilegios globales para la API.');
    console.log('Sin datos clínicos. Las contraseñas y hashes no se imprimieron. No repita este aprovisionamiento.');
  } catch (error) {
    if (transaccion) await conexion.rollback().catch(() => {});
    // Los mensajes/stack SQL pueden incluir parámetros secretos: registrar solo el paso y el código.
    console.error(JSON.stringify({ evento: 'inicializacion_beta_fallida', paso, codigo: error.code || 'PREFLIGHT_O_VERIFICACION', numero: error.errno || null }));
    console.error('Deténgase e inspeccione el paso indicado. DDL y GRANT pueden haber quedado aplicados; no reejecute ni elimine el volumen automáticamente.');
    process.exitCode = 1;
  } finally {
    if (conexionAplicacion) await conexionAplicacion.end().catch(() => {});
    if (conexion) await conexion.end().catch(() => {});
  }
}

principal().catch(() => { console.error('No se pudo iniciar la preparación beta.'); process.exitCode = 1; });
