const logger = require('../utils/structuredLogger');
const ErrorResponse = require('../utils/ErrorResponse');
const alertingSystem = require('../utils/alertingSystem');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error with context
  const errorContext = {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.userId,
    body: req.method !== 'GET' ? req.body : undefined,
    params: req.params,
    query: req.query,
    headers: {
      authorization: req.get('Authorization') ? '[REDACTED]' : undefined,
      'content-type': req.get('Content-Type'),
      'user-agent': req.get('User-Agent'),
      'x-forwarded-for': req.get('X-Forwarded-For')
    }
  };

  logger.logError(err, errorContext);

  // Send alerts for critical errors
  if (err.statusCode >= 500 || !err.statusCode) {
    alertingSystem.handleSecurityEvent('server_error', {
      severity: 'high',
      error: err.message,
      stack: err.stack,
      ...errorContext
    }).catch(alertErr => {
      logger.error('Failed to send error alert', { alertError: alertErr.message });
    });
  }

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = new ErrorResponse(message, 404, 'RESOURCE_NOT_FOUND');
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `Duplicate field value: ${field}`;
    error = new ErrorResponse(message, 400, 'DUPLICATE_FIELD');
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = new ErrorResponse(message, 400, 'VALIDATION_ERROR');
  }

  // JWT error
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = new ErrorResponse(message, 401, 'INVALID_TOKEN');
  }

  // JWT expired error
  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = new ErrorResponse(message, 401, 'TOKEN_EXPIRED');
  }

  // Multer error (file upload)
  if (err.code === 'LIMIT_FILE_SIZE') {
    const message = 'File too large';
    error = new ErrorResponse(message, 400, 'FILE_TOO_LARGE');
  }

  // Rate limit error
  if (err.status === 429) {
    const message = 'Too many requests, please try again later';
    error = new ErrorResponse(message, 429, 'RATE_LIMIT_EXCEEDED');
  }

  // CORS error
  if (err.message && err.message.includes('CORS')) {
    const message = 'Cross-origin request not allowed';
    error = new ErrorResponse(message, 403, 'CORS_ERROR');
  }

  // Security violations
  if (err.code === 'EBADCSRFTOKEN') {
    const message = 'Invalid CSRF token';
    error = new ErrorResponse(message, 403, 'INVALID_CSRF');
    
    // Log security event
    alertingSystem.handleSecurityEvent('csrf_violation', {
      severity: 'high',
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.originalUrl
    }).catch(alertErr => {
      logger.error('Failed to send CSRF alert', { alertError: alertErr.message });
    });
  }

  // Database connection error
  if (err.name === 'MongoNetworkError' || err.name === 'MongoTimeoutError') {
    const message = 'Database connection error';
    error = new ErrorResponse(message, 500, 'DATABASE_ERROR');
    
    // Alert for database issues
    alertingSystem.handleSecurityEvent('database_error', {
      severity: 'critical',
      error: err.name,
      message: err.message
    }).catch(alertErr => {
      logger.error('Failed to send database alert', { alertError: alertErr.message });
    });
  }

  // Prepare response
  const response = {
    success: false,
    error: error.message || 'Server Error',
    code: error.code || 'INTERNAL_ERROR',
    timestamp: new Date().toISOString()
  };

  // Add stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  // Add request ID if available
  if (req.id) {
    response.requestId = req.id;
  }

  res.status(error.statusCode || 500).json(response);
};

module.exports = errorHandler;