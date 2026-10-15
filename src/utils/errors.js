function safeCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : undefined;
}

function logInternalError(error, req, context) {
  const entry = {
    level: 'error',
    event: 'internal_error',
    requestId: req?.requestId || null,
    context,
    errorType: typeof error?.name === 'string' ? error.name : 'Error',
  };
  const code = safeCode(error);
  if (code) entry.errorCode = code;
  console.error(JSON.stringify(entry));
}

function sendDatabaseError(res, req, error, context, operationMessage) {
  logInternalError(error, req, context);
  const code = safeCode(error);
  let status = 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = operationMessage;

  if (code === 'ER_DUP_ENTRY') {
    status = 409;
    errorCode = 'CONFLICT';
    message = 'El registro entra en conflicto con información existente.';
  } else if (['ER_NO_REFERENCED_ROW', 'ER_NO_REFERENCED_ROW_2', 'ER_DATA_TOO_LONG', 'ER_TRUNCATED_WRONG_VALUE'].includes(code)) {
    status = 422;
    errorCode = 'INVALID_DATA';
    message = 'Los datos no cumplen las restricciones del sistema.';
  } else if (code === 'ER_ROW_IS_REFERENCED_2') {
    status = 409;
    errorCode = 'RESOURCE_IN_USE';
    message = 'El registro está relacionado con otros datos.';
  } else if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ER_GET_CONNECTION_TIMEOUT', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR'].includes(code)) {
    status = 503;
    errorCode = 'DATABASE_UNAVAILABLE';
    message = 'La base de datos no está disponible.';
  }

  const body = { error: { code: errorCode, message } };
  if (status === 500 && req?.requestId) body.error.requestId = req.requestId;
  res.status(status).json(body);
}

module.exports = { logInternalError, sendDatabaseError };
