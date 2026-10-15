const state = { status: 'not_configured', message: 'FILE_STORAGE_ROOT no está configurado.', operations: [] };

function requireStorageReady(req, res, next) {
  if (state.status === 'blocked' || state.status === 'recovering') {
    return res.status(503).json({ error: {
      code: 'STORAGE_RECOVERY_REQUIRED',
      message: 'El almacenamiento requiere recuperación antes de acceder a los archivos.',
      requestId: req.requestId,
    } });
  }
  return next();
}

function blockStorage(errorCode, operationId = null, message = 'Una operación de almacenamiento requiere recuperación. Revise el journal y el repositorio antes de continuar.') {
  state.status = 'blocked';
  state.message = message;
  const safeCode = /^[A-Z0-9_]{1,64}$/.test(String(errorCode || '')) ? errorCode : 'RECOVERY_FAILED';
  if (!state.operations.some(item => (operationId && item.operationId === operationId) || (!operationId && item.errorCode === safeCode))) {
    state.operations = [...state.operations, { ...(operationId ? { operationId } : {}), errorCode: safeCode }].slice(-100);
  }
}

module.exports = { state, blockStorage, requireStorageReady };
