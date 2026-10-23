require('dotenv').config();

const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const database = require('./config/database');
const { readPort, readHost } = require('./config/environment');
const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const studyRoutes = require('./routes/studies');
const documentRoutes = require('./routes/documents');
const healthRoutes = require('./routes/health');
const { prepareStorageRecovery, startExpiredSessionCleanup } = require('./services/application-lifecycle');
const { state: storageReadiness } = require('./services/storage-readiness');
const { logInternalError } = require('./utils/errors');

const app = express();
const publicDirectory = path.join(__dirname, '..', 'public');
const port = readPort('PORT', 3000);
const host = readHost();

app.disable('x-powered-by');
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});
app.use(express.json({ limit: '256kb' }));
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/pacientes', patientRoutes);
app.use('/api', studyRoutes);
app.use('/api', documentRoutes);
app.use('/api', (req, res) => {
  res.status(404).json({ error: { code: 'API_ROUTE_NOT_FOUND', message: 'No se encontró la ruta solicitada.' } });
});
app.use(express.static(publicDirectory, { index: false }));
app.get('/', (_req, res) => res.sendFile(path.join(publicDirectory, 'index.html')));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'REQUEST_TOO_LARGE', message: 'La solicitud supera el tamaño permitido.' } });
  }
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'El cuerpo JSON no es válido.' } });
  }
  logInternalError(error, req, 'express.unhandled');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error interno.', requestId: req.requestId } });
});

let server;
let sessionCleanupTimer;

async function start({ pool: configuredPool, storageConfig: configuredStorageConfig, listenPort = port, listenHost = host } = {}) {
  const getPool = () => configuredPool || database.getPool();
  await prepareStorageRecovery(getPool(), configuredStorageConfig);
  server = app.listen(listenPort, listenHost, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : listenPort;
    console.log(`Historial Clínico Visual disponible en http://${listenHost}:${actualPort}`);
  });
  server.on('close', () => {
    if (sessionCleanupTimer) clearInterval(sessionCleanupTimer);
  });
  sessionCleanupTimer = startExpiredSessionCleanup(getPool);
  return server;
}

async function shutdown() {
  if (sessionCleanupTimer) clearInterval(sessionCleanupTimer);
  if (!server) return;
  server.close(async () => {
    await database.end();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (require.main === module) {
  start().catch(error => {
    logInternalError(error, null, 'server.startup');
    process.exitCode = 1;
  });
}

module.exports = { app, start, storageReadiness };
