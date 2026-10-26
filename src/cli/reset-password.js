const readline = require('node:readline');
const { createInterface } = require('node:readline/promises');

class ResetPasswordError extends Error {}

function promptHidden(label) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== 'function') {
      reject(new ResetPasswordError('Se requiere una terminal interactiva para ingresar la contraseña de forma oculta.'));
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
      const submitted = value;
      value = '';
      if (error) reject(error);
      else resolve(submitted);
    };
    const onKeypress = (character, key = {}) => {
      if (key.ctrl && ['c', 'd', 'z'].includes(key.name)) return finish(new ResetPasswordError('Operación cancelada.'));
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

async function collectInput() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new ResetPasswordError('Ejecute este comando directamente desde una terminal interactiva.');
  }

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let username;
  try {
    username = validateUsername(await terminal.question('Usuario cuya contraseña desea cambiar: '));
  } finally {
    terminal.close();
  }
  if (!username) throw new ResetPasswordError('El nombre de usuario no cumple el formato permitido.');

  let password = await promptHidden('Nueva contraseña (mínimo 12 caracteres): ');
  let confirmation = await promptHidden('Repita la nueva contraseña: ');
  if (Array.from(password).length < 12 || password.length > 1024) {
    password = '';
    confirmation = '';
    throw new ResetPasswordError('La contraseña debe tener al menos 12 caracteres y no superar el límite permitido.');
  }
  if (password !== confirmation) {
    password = '';
    confirmation = '';
    throw new ResetPasswordError('Las contraseñas no coinciden. No se modificó ninguna cuenta.');
  }
  confirmation = '';
  return { username, password };
}

async function main() {
  if (process.argv.length !== 2) {
    throw new ResetPasswordError('El comando no acepta argumentos. Ingrese la contraseña únicamente en los prompts ocultos.');
  }

  const { hashPassword } = require('../utils/passwords');
  const { createRecoveryPool } = require('../config/recovery-database');
  const authRepository = require('../repositories/auth-repository');
  const input = await collectInput();
  let passwordHash;
  try {
    passwordHash = await hashPassword(input.password);
  } finally {
    input.password = '';
  }

  let pool;
  let connection;
  let transactionStarted = false;
  try {
    pool = createRecoveryPool();
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const users = await connection.query(
      'SELECT id FROM app_users WHERE username = ? LIMIT 1 FOR UPDATE',
      [input.username],
    );
    if (!users.length) {
      throw new ResetPasswordError('No existe ese usuario. No se modificó ninguna cuenta.');
    }

    const userId = users[0].id;
    const update = await connection.query(
      'UPDATE app_users SET password_hash = ? WHERE id = ?',
      [passwordHash, userId],
    );
    passwordHash = '';
    if (!update.affectedRows) {
      throw new ResetPasswordError('No se pudo actualizar la contraseña. No se registró ningún cambio.');
    }

    await authRepository.deleteSessionsForUser(connection, userId);
    await connection.query(
      `INSERT INTO audit_events (user_id, action_code, entity_type, entity_id)
       VALUES (NULL, ?, ?, ?)` ,
      ['system.password_reset', 'user', String(userId)],
    );
    await connection.commit();
    transactionStarted = false;
    process.stdout.write(`Contraseña actualizada para el usuario ${input.username}.\n`);
  } finally {
    passwordHash = '';
    if (connection) {
      if (transactionStarted) await connection.rollback().catch(() => {});
      connection.release();
    }
    if (pool) await pool.end().catch(() => {});
  }
}

main().catch((error) => {
  const message = error instanceof ResetPasswordError
    ? error.message
    : 'No se pudo completar el cambio. Revise la configuración y los permisos MariaDB sin compartir secretos.';
  process.stderr.write(`Cambio de contraseña abortado: ${message}\n`);
  process.exitCode = 1;
});
