const { logger, logHelpers } = require('./logger');

// Custom application error class
class AppError extends Error {
  constructor(message, statusCode = 500, errorCode = null, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// Validation error class
class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.field = field;
  }
}

// Authentication error class
class AuthError extends AppError {
  constructor(message, errorCode = 'AUTH_ERROR') {
    super(message, 401, errorCode);
  }
}

// Authorization error class
class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

// Not found error class
class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND_ERROR');
  }
}

// Rate limit error class
class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_ERROR');
  }
}

// Database error class
class DatabaseError extends AppError {
  constructor(message, originalError = null) {
    super(message, 500, 'DATABASE_ERROR');
    this.originalError = originalError;
  }
}

// Async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Global error handler middleware
const globalErrorHandler = (err, req, res, next) => {
  // Default values
  let error = { ...err };
  error.message = err.message;

  // Log error details
  const errorContext = {
    error: {
      message: error.message,
      statusCode: error.statusCode || 500,
      errorCode: error.errorCode,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      isOperational: error.isOperational
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || 'anonymous',
      body: req.body ? sanitizeRequestBody(req.body) : undefined,
      params: req.params,
      query: req.query
    },
    timestamp: new Date().toISOString()
  };

  // Log based on error severity
  if (error.statusCode >= 500) {
    logHelpers.api('Server Error', { ...errorContext, severity: 'error' });
  } else if (error.statusCode >= 400) {
    logHelpers.api('Client Error', { ...errorContext, severity: 'warning' });
  }

  // Handle specific mongoose errors
  if (err.name === 'CastError') {
    const message = 'Invalid resource ID format';
    error = new ValidationError(message, 'id');
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`;
    error = new ValidationError(message, field);
  }

  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(val => val.message);
    error = new ValidationError(messages.join(', '));
  }

  if (err.name === 'JsonWebTokenError') {
    error = new AuthError('Invalid token');
  }

  if (err.name === 'TokenExpiredError') {
    error = new AuthError('Token expired', 'TOKEN_EXPIRED');
  }

  // Handle MongoDB connection errors
  if (err.name === 'MongoNetworkError' || err.name === 'MongoTimeoutError') {
    error = new DatabaseError('Database connection failed', err);
  }

  // Send error response
  res.status(error.statusCode || 500).json({
    success: false,
    error: {
      message: error.message || 'Internal server error',
      code: error.errorCode || 'UNKNOWN_ERROR',
      timestamp: error.timestamp || new Date().toISOString(),
      ...(process.env.NODE_ENV === 'development' && {
        stack: error.stack,
        originalError: error.originalError?.message
      })
    }
  });
};

// 404 handler for undefined routes
const notFoundHandler = (req, res, next) => {
  const message = `Route ${req.originalUrl} not found`;
  next(new NotFoundError(message));
};

// Sanitize request body for logging
const sanitizeRequestBody = (body) => {
  const sensitive = ['password', 'token', 'secret', 'key', 'auth'];
  const sanitized = {};
  
  for (const [key, value] of Object.entries(body)) {
    if (sensitive.some(field => key.toLowerCase().includes(field))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
};

// Validation helper
const validateRequired = (fields, data) => {
  const missing = fields.filter(field => !data[field]);
  if (missing.length > 0) {
    throw new ValidationError(`Missing required fields: ${missing.join(', ')}`);
  }
};

// Success response helper
const sendSuccess = (res, data = null, message = 'Success', statusCode = 200, meta = {}) => {
  res.status(statusCode).json({
    success: true,
    message,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta
    }
  });
};

// Paginated response helper
const sendPaginated = (res, data, pagination, message = 'Success') => {
  res.json({
    success: true,
    message,
    data,
    pagination: {
      page: parseInt(pagination.page) || 1,
      limit: parseInt(pagination.limit) || 20,
      total: pagination.total || 0,
      pages: Math.ceil((pagination.total || 0) / (pagination.limit || 20)),
      hasNext: (pagination.page * pagination.limit) < pagination.total,
      hasPrev: pagination.page > 1
    },
    meta: {
      timestamp: new Date().toISOString()
    }
  });
};

// Error response helper
const sendError = (res, message, statusCode = 500, errorCode = null, details = null) => {
  res.status(statusCode).json({
    success: false,
    error: {
      message,
      code: errorCode || 'UNKNOWN_ERROR',
      details,
      timestamp: new Date().toISOString()
    }
  });
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logHelpers.api('Unhandled Promise Rejection', {
    error: err.message,
    stack: err.stack,
    severity: 'critical'
  });
  
  // Close server gracefully
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logHelpers.api('Uncaught Exception', {
    error: err.message,
    stack: err.stack,
    severity: 'critical'
  });
  
  process.exit(1);
});

module.exports = {
  AppError,
  ValidationError,
  AuthError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  DatabaseError,
  asyncHandler,
  globalErrorHandler,
  notFoundHandler,
  validateRequired,
  sendSuccess,
  sendPaginated,
  sendError
};