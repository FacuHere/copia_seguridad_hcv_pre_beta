const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const mariadb = require('mariadb');

const projectRoot = path.resolve(__dirname, '../..');
const credentialsPath = path.join(projectRoot, '.env.password-reset');
const placeholderPassword = 'REEMPLAZAR_POR_UN_SECRETO_LOCAL';

function loadRecoveryConfig() {
  if (!fs.existsSync(credentialsPath)) {
    throw new Error('Falta .env.password-reset. Copie la plantilla local y configure la conexión de recuperación.');
  }

  const values = dotenv.parse(fs.readFileSync(credentialsPath));
  const host = values.DB_HOST?.trim();
  const portValue = values.DB_PORT?.trim();
  const database = values.DB_NAME?.trim();
  const user = values.DB_USER?.trim();
  const password = values.DB_PASSWORD;

  if (!host || !portValue || !database || !user || !password || password === placeholderPassword) {
    throw new Error('.env.password-reset debe configurar DB_HOST, DB_PORT, DB_NAME, DB_USER y DB_PASSWORD.');
  }
  if (!['127.0.0.1', 'localhost'].includes(host.toLowerCase())) {
    throw new Error('La recuperación de contraseña solo permite conexiones MariaDB locales.');
  }
  if (!/^\d+$/.test(portValue)) {
    throw new Error('DB_PORT en .env.password-reset debe ser un puerto válido.');
  }
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT en .env.password-reset debe ser un puerto válido.');
  }

  return { host, port, database, user, password };
}

function createRecoveryPool() {
  return mariadb.createPool({
    ...loadRecoveryConfig(),
    connectionLimit: 1,
    charset: 'utf8mb4',
  });
}

module.exports = { createRecoveryPool, loadRecoveryConfig };
