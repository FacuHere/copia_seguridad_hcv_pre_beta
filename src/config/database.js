const mariadb = require('mariadb');
const { readPort } = require('./environment');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta configurar ${name} en el entorno.`);
  return value;
}

let pool;

function getPool() {
  if (pool) return pool;

  const port = readPort('DB_PORT', 3306);
  const user = requiredEnv('DB_USER');
  if (user.trim().toLowerCase() === 'root') {
    throw new Error('DB_USER no puede ser root; configure una cuenta de aplicación no administrativa.');
  }

  pool = mariadb.createPool({
    host: requiredEnv('DB_HOST'),
    port,
    user,
    password: requiredEnv('DB_PASSWORD'),
    database: requiredEnv('DB_NAME'),
    connectionLimit: 5,
    charset: 'utf8mb4',
  });
  return pool;
}

async function end() {
  if (pool) await pool.end();
}

module.exports = { getPool, end };
