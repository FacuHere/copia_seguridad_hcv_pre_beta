const healthService = require('../services/health-service');
const { logInternalError } = require('../utils/errors');

async function database(req, res) {
  try {
    return res.json(await healthService.databaseStatus());
  } catch (error) {
    logInternalError(error, req, 'database.health');
    return res.status(503).json({ status: 'unavailable', database: 'disconnected' });
  }
}

function storage(_req, res) {
  const result = healthService.storageStatus();
  const statusCode = result.status === 'ready' ? 200 : 503;
  return res.status(statusCode).json(result);
}

module.exports = { database, storage };
