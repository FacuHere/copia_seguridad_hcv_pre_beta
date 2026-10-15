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
const { readFileStorageConfig } = require('./config/file-storage');
const { recoverOperations, cleanupOrphanStaging } = require('./services/document-operations');
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
app.get('/api/health/database', async (req, res) => {
  let connection;
  try {
    connection = await database.getPool().getConnection();
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    logInternalError(error, req, 'database.health');
    res.status(503).json({ status: 'unavailable', database: 'disconnected' });
  } finally {
    if (connection) connection.release();
  }
});
app.get('/api/health/storage', (_req, res) => {
  const ready = storageReadiness.status === 'ready';
  res.status(ready ? 200 : 503).json({
    status: storageReadiness.status,
    message: storageReadiness.message,
    operations: storageReadiness.operations,
  });
});
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
  storageReadiness.status = 'recovering';
  try {
    const pool = getPool();
    const storage = configuredStorageConfig || readFileStorageConfig();
    if (!storage.root) {
      const table = await pool.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'document_file_operations' LIMIT 1",
      );
      if (table.length) {
        const pending = await pool.query(
          "SELECT operation_id, operation_type FROM document_file_operations WHERE operation_state IN ('prepared', 'filesystem_applied') OR (operation_state = 'completed' AND backup_key IS NOT NULL)",
        );
        if (pending.length) {
          storageReadiness.status = 'blocked';
          storageReadiness.message = 'Hay operaciones de archivos pendientes y FILE_STORAGE_ROOT no está configurado; configure la raíz correcta y reinicie para recuperarlas.';
          storageReadiness.operations = pending.map(row => ({ operationId: row.operation_id, operationType: row.operation_type }));
        } else {
          storageReadiness.status = 'not_configured';
          storageReadiness.message = 'FILE_STORAGE_ROOT no está configurado; cargas y acceso a archivos no están disponibles.';
        }
      } else {
        storageReadiness.status = 'not_configured';
        storageReadiness.message = 'FILE_STORAGE_ROOT no está configurado; cargas y acceso a archivos no están disponibles.';
      }
    } else {
      const outcomes = await recoverOperations(pool, storage.root);
      const unresolved = outcomes.filter(outcome => outcome.outcome === 'needs_attention');
      for (const outcome of unresolved) {
        console.error(JSON.stringify({ level: 'error', event: 'document_operation_recovery_required', operationId: outcome.operationId, errorCode: outcome.errorCode }));
      }
      storageReadiness.operations = unresolved.map(({ operationId, errorCode }) => ({ operationId, errorCode }));
      if (unresolved.length) {
        storageReadiness.status = 'blocked';
        storageReadiness.message = 'Hay operaciones de archivos sin recuperar. Revise las operaciones indicadas y el repositorio antes de habilitar la API.';
      } else {
        const cleanup = await cleanupOrphanStaging(pool, storage.root, {
          log: outcome => console.log(JSON.stringify({ level: outcome.outcome === 'needs_attention' ? 'error' : 'info', event: 'document_staging_cleanup', ...outcome })),
        });
        const cleanupIssues = cleanup.filter(outcome => outcome.outcome === 'needs_attention');
        storageReadiness.operations = cleanupIssues;
        storageReadiness.status = cleanupIssues.length ? 'blocked' : 'ready';
        storageReadiness.message = cleanupIssues.length
          ? 'Hay entradas desconocidas en staging que requieren inspección manual.'
          : 'La recuperación terminó correctamente.';
      }
    }
  } catch (error) {
    storageReadiness.status = 'blocked';
    storageReadiness.message = 'No se pudo completar la recuperación del almacenamiento. Revise los logs del servidor antes de habilitar operaciones clínicas.';
    storageReadiness.operations = [{ errorCode: typeof error?.code === 'string' ? error.code : 'RECOVERY_FAILED' }];
    logInternalError(error, null, 'documents.recovery_startup');
  }
  server = app.listen(listenPort, listenHost, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : listenPort;
    console.log(`Historial Clínico Visual disponible en http://${listenHost}:${actualPort}`);
  });
  server.on('close', () => {
    if (sessionCleanupTimer) clearInterval(sessionCleanupTimer);
  });
  sessionCleanupTimer = setInterval(async () => {
    try {
      await getPool().query('DELETE FROM app_sessions WHERE expires_at <= UTC_TIMESTAMP()');
    } catch (error) {
      logInternalError(error, null, 'auth.session_cleanup');
    }
  }, 15 * 60 * 1000);
  sessionCleanupTimer.unref();
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
