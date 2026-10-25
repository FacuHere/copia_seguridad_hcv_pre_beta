const database = require('../config/database');
const healthRepository = require('../repositories/health-repository');
const { state: storageReadiness } = require('./storage-readiness');

async function databaseStatus() {
  await healthRepository.checkDatabase(database.getPool());
  return { status: 'ok', database: 'connected' };
}

function storageStatus() {
  return {
    status: storageReadiness.status,
    message: storageReadiness.message,
    operations: storageReadiness.operations,
  };
}

module.exports = { databaseStatus, storageStatus };
