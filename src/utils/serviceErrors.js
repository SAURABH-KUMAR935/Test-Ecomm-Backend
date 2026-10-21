const mongoose = require('mongoose');

const DATABASE_ERROR_NAMES = new Set([
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongoTopologyClosedError',
  'MongoNotConnectedError',
  'MongoPoolClearedError',
  'MongoWaitQueueTimeoutError',
  'MongooseServerSelectionError',
]);

const SERVICE_MESSAGES = {
  database: 'Database connection failed. Please check that the database is available and try again.',
  image: 'Image storage service is unavailable. Please try again later.',
  email: 'Email service is unavailable. Please try again later.',
  verification: 'Bot verification service is unavailable. Please try again later.',
};

const isDatabaseConnectionError = (error) => (
  mongoose.connection.readyState !== 1
  || DATABASE_ERROR_NAMES.has(error?.name)
  || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH'].includes(error?.code)
);

const markServiceError = (error, service) => {
  if (error && typeof error === 'object') {
    error.service = service;
  }
  return error;
};

const sendServiceError = (res, error, fallbackMessage) => {
  if (res.headersSent) return;

  if (isDatabaseConnectionError(error)) {
    return res.status(503).json({ message: SERVICE_MESSAGES.database });
  }

  const serviceMessage = SERVICE_MESSAGES[error?.service];
  if (serviceMessage) {
    return res.status(503).json({ message: serviceMessage });
  }

  return res.status(500).json({ message: fallbackMessage });
};

module.exports = { markServiceError, sendServiceError };
