class ApplicationError extends Error {
  constructor(status, code, message, options = {}) {
    super(message);
    this.name = 'ApplicationError';
    this.status = status;
    this.code = code;
    this.includeRequestId = options.includeRequestId === true;
    this.headers = options.headers || {};
  }
}

function respondWithApplicationError(res, req, error, context, fallbackMessage) {
  if (error instanceof ApplicationError) {
    for (const [name, value] of Object.entries(error.headers)) res.setHeader(name, value);
    const body = { error: { code: error.code, message: error.message } };
    if (error.includeRequestId && req.requestId) body.error.requestId = req.requestId;
    return res.status(error.status).json(body);
  }
  const { sendDatabaseError } = require('./errors');
  return sendDatabaseError(res, req, error, context, fallbackMessage);
}

module.exports = { ApplicationError, respondWithApplicationError };
