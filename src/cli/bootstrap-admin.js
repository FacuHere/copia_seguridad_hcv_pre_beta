const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { createInterface } = require('node:readline/promises');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(projectRoot, '.env') });

class BootstrapError extends Error {}

function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new BootstrapError('Se requiere una terminal interactiva para ingresar la contraseña de forma oculta.'));
      return;
    }

    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    process.stdout.write(label);
    let value = '';
    const finish = (error) => {
      input.off('keypress', onKeypress);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onKeypress = (character, key = {}) => {
      if (key.ctrl && ['c', 'd', 'z'].includes(key.name)) return finish(new BootstrapError('Operación cancelada.'));
      if (key.name === 'return' || character === '\r' || character === '\n') return finish();
      if (key.name === 'backspace') {
        value = Array.from(value).slice(0, -1).join('');
      } else if (character && !key.ctrl && !key.meta && !/[\u0000-\u001f\u007f]/.test(character)) {
        if (value.length + character.length <= 1024) value += character;
      }
    };
    input.on('keypress', onKeypress);
  });
}

function validateUsername(value) {
  const username = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$/.test(username) ? username : null;
}

function validateDisplayName(value) {
  const displayName = value.trim();
  return displayName.length > 0 && displayName.length <= 200 && !/[\u0000-\u001f\u007f]/.test(displayName)
    ? displayName
    : null;
}

async function collectAccountInput() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new BootstrapError('Ejecute este comando directamente desde una terminal interactiva del servidor.');
  }
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let username;
  let displayName;
  try {
    username = validateUsername(await terminal.question('Nombre de usuario (3 a 100 caracteres): '));
    displayName = validateDisplayName(await terminal.question('Nombre visible (máximo 200 caracteres): '));
  } finally {
    terminal.close();
  }
  if (!username) throw new BootstrapError('El nombre de usuario no cumple el formato permitido.');
  if (!displayName) throw new BootstrapError('El nombre visible no es válido.');

  const password = await promptHidden('Contraseña (mínimo 12 caracteres): ');
  const confirmation = await promptHidden('Repita la contraseña: ');
  if (Array.from(password).length < 12 || password.length > 1024) {
    throw new BootstrapError('La contraseña debe tener al menos 12 caracteres y no superar el límite permitido.');
  }
  if (password !== confirmation) throw new BootstrapError('Las contraseñas no coinciden.');
  return { username, displayName, password };
}

function loadBootstrapCredentials() {
  const credentialsPath = path.join(projectRoot, '.env.bootstrap');
  if (!fs.existsSync(credentialsPath)) {
    throw new BootstrapError('Falta .env.bootstrap. Copie .env.bootstrap.example y configure una cuenta MariaDB temporal con privilegios mínimos.');
  }
  const values = dotenv.parse(fs.readFileSync(credentialsPath));
  if (!values.DB_USER?.trim() || !values.DB_PASSWORD || values.DB_PASSWORD === 'REEMPLAZAR_POR_UN_SECRETO_TEMPORAL') {
    throw new BootstrapError('.env.bootstrap debe contener DB_USER y DB_PASSWORD reales para la cuenta temporal.');
  }
  if (values.DB_USER.trim().toLowerCase() === 'root') {
    throw new BootstrapError('No use root; configure una cuenta temporal con privilegios mínimos para el bootstrap.');
  }
  process.env.DB_USER = values.DB_USER;
  process.env.DB_PASSWORD = values.DB_PASSWORD;
}

async function main() {
  if (process.argv.length !== 2) throw new BootstrapError('El comando no acepta argumentos. Ingrese la contraseña únicamente en el prompt oculto.');
  loadBootstrapCredentials();

  const { hashPassword } = require('../utils/passwords');
  const input = await collectAccountInput();
  const passwordHash = await hashPassword(input.password);
  input.password = '';

  const database = require('../config/database');
  let connection;
  let lockAcquired = false;
  let transactionStarted = false;
  try {
    connection = await database.getPool().getConnection();
    const lockRows = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', ['hcv:first-admin-bootstrap']);
    lockAcquired = Number(lockRows[0]?.acquired) === 1;
    if (!lockAcquired) throw new BootstrapError('No se pudo obtener el bloqueo de bootstrap; espere y vuelva a intentarlo.');

    let existingUsers;
    let roleRows;
    let rolePermissionRows;
    let scopedPermissionRows;
    try {
      existingUsers = await connection.query('SELECT id FROM app_users LIMIT 1');
      roleRows = await connection.query('SELECT id FROM roles WHERE code = ? LIMIT 1', ['system_admin']);
      if (roleRows.length) {
        rolePermissionRows = await connection.query(
          `SELECT p.code FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
           WHERE rp.role_id = ? ORDER BY p.code`,
          [roleRows[0].id],
        );
        scopedPermissionRows = await connection.query(
          'SELECT permission_id FROM role_service_permissions WHERE role_id = ? LIMIT 1',
          [roleRows[0].id],
        );
      }
    } catch {
      throw new BootstrapError('No se pudieron verificar las migraciones. Aplique y revise las migraciones 001–003 en una base preparada.');
    }

    if (existingUsers.length) throw new BootstrapError('Ya existe al menos un usuario; el bootstrap inicial solo funciona con una base sin usuarios.');
    if (!roleRows.length) throw new BootstrapError('No existe el rol system_admin sembrado por la migración 003.');
    const roleCodes = rolePermissionRows.map(row => row.code).sort();
    if (roleCodes.join(',') !== 'roles.manage,users.manage' || scopedPermissionRows.length) {
      throw new BootstrapError('El rol system_admin no tiene exactamente los permisos técnicos aprobados por la migración 003.');
    }

    await connection.beginTransaction();
    transactionStarted = true;
    const recheckUsers = await connection.query('SELECT id FROM app_users LIMIT 1');
    if (recheckUsers.length) {
      await connection.rollback();
      transactionStarted = false;
      throw new BootstrapError('Ya existe un usuario; no se creó ninguna cuenta.');
    }
    const result = await connection.query(
      'INSERT INTO app_users (username, password_hash, display_name) VALUES (?, ?, ?)',
      [input.username, passwordHash, input.displayName],
    );
    await connection.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [result.insertId, roleRows[0].id]);
    await connection.query(
      'INSERT INTO audit_events (user_id, action_code, entity_type, entity_id) VALUES (?, ?, ?, ?)',
      [result.insertId, 'system.bootstrap_admin', 'user', String(result.insertId)],
    );
    await connection.commit();
    transactionStarted = false;
    process.stdout.write(`Administrador técnico inicial creado para ${input.username}.\n`);
  } finally {
    if (connection) {
      if (transactionStarted) await connection.rollback().catch(() => {});
      if (lockAcquired) await connection.query('SELECT RELEASE_LOCK(?)', ['hcv:first-admin-bootstrap']).catch(() => {});
      connection.release();
    }
    await database.end().catch(() => {});
  }
}

main().catch((error) => {
  const message = error instanceof BootstrapError
    ? error.message
    : 'El bootstrap falló. Revise la configuración y los permisos MariaDB sin compartir secretos.';
  process.stderr.write(`Bootstrap abortado: ${message}\n`);
  process.exitCode = 1;
});
