const { readFileStorageConfig } = require('../config/file-storage');
const authRepository = require('../repositories/auth-repository');
const documentOperationRepository = require('../repositories/document-operation-repository');
const { recoverOperations, cleanupOrphanStaging } = require('./document-operations');
const { state: storageReadiness } = require('./storage-readiness');
const { logInternalError } = require('../utils/errors');

async function prepareStorageRecovery(pool, configuredStorageConfig) {
  storageReadiness.status = 'recovering';
  try {
    const storage = configuredStorageConfig || readFileStorageConfig();
    if (!storage.root) {
      const journalExists = await documentOperationRepository.hasOperationJournal(pool);
      if (journalExists) {
        const pending = await documentOperationRepository.findPendingOperations(pool);
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
      return;
    }

    const outcomes = await recoverOperations(pool, storage.root);
    const unresolved = outcomes.filter(outcome => outcome.outcome === 'needs_attention');
    for (const outcome of unresolved) {
      console.error(JSON.stringify({ level: 'error', event: 'document_operation_recovery_required', operationId: outcome.operationId, errorCode: outcome.errorCode }));
    }
    storageReadiness.operations = unresolved.map(({ operationId, errorCode }) => ({ operationId, errorCode }));
    if (unresolved.length) {
      storageReadiness.status = 'blocked';
      storageReadiness.message = 'Hay operaciones de archivos sin recuperar. Revise las operaciones indicadas y el repositorio antes de habilitar la API.';
      return;
    }

    const cleanup = await cleanupOrphanStaging(pool, storage.root, {
      log: outcome => console.log(JSON.stringify({ level: outcome.outcome === 'needs_attention' ? 'error' : 'info', event: 'document_staging_cleanup', ...outcome })),
    });
    const cleanupIssues = cleanup.filter(outcome => outcome.outcome === 'needs_attention');
    storageReadiness.operations = cleanupIssues;
    storageReadiness.status = cleanupIssues.length ? 'blocked' : 'ready';
    storageReadiness.message = cleanupIssues.length
      ? 'Hay entradas desconocidas en staging que requieren inspección manual.'
      : 'La recuperación terminó correctamente.';
  } catch (error) {
    storageReadiness.status = 'blocked';
    storageReadiness.message = 'No se pudo completar la recuperación del almacenamiento. Revise los logs del servidor antes de habilitar operaciones clínicas.';
    storageReadiness.operations = [{ errorCode: typeof error?.code === 'string' ? error.code : 'RECOVERY_FAILED' }];
    logInternalError(error, null, 'documents.recovery_startup');
  }
}

function startExpiredSessionCleanup(getPool, intervalMilliseconds = 15 * 60 * 1000) {
  const timer = setInterval(async () => {
    try {
      await authRepository.deleteExpiredSessions(getPool());
    } catch (error) {
      logInternalError(error, null, 'auth.session_cleanup');
    }
  }, intervalMilliseconds);
  timer.unref();
  return timer;
}

module.exports = { prepareStorageRecovery, startExpiredSessionCleanup };
