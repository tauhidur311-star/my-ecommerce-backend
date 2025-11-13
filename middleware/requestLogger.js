const morgan = require('morgan');
const logger = require('../utils/logger');

// Custom Morgan format for structured logging
const morganFormat = ':method :url :status :res[content-length] - :response-time ms';

// Custom token for user ID
morgan.token('user-id', (req) => {
  return req.user ? req.user.userId : 'anonymous';
});

// Custom token for request ID (if available)
morgan.token('request-id', (req) => {
  return req.id || 'no-id';
});

// Enhanced format with user context
const enhancedFormat = ':method :url :status :res[content-length] - :response-time ms - User: :user-id - ID: :request-id';

// Create different loggers for different environments
const developmentLogger = morgan(enhancedFormat, {
  stream: {
    write: (message) => {
      logger.http(message.trim());
    }
  }
});

const productionLogger = morgan('combined', {
  stream: {
    write: (message) => {
      logger.http(message.trim());
    }
  },
  skip: (req, res) => {
    // Skip logging for health checks and static assets
    return req.originalUrl === '/health' || 
           req.originalUrl.startsWith('/static') ||
           req.originalUrl.startsWith('/favicon');
  }
});

// Error logger for failed requests
const errorLogger = morgan('combined', {
  stream: {
    write: (message) => {
      logger.error(message.trim());
    }
  },
  skip: (req, res) => {
    // Only log errors (4xx and 5xx)
    return res.statusCode < 400;
  }
});

// Request middleware that adds timing and request ID
const requestTracker = (req, res, next) => {
  // Add request ID for tracking
  req.id = Math.random().toString(36).substring(7);
  req.startTime = Date.now();
  
  // Log request start for important operations
  if (req.method !== 'GET' || req.originalUrl.includes('/admin/')) {
    logger.info('Request started', {
      requestId: req.id,
      method: req.method,
      url: req.originalUrl,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      userId: req.user?.userId || 'anonymous'
    });
  }
  
  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(data) {
    const responseTime = Date.now() - req.startTime;
    
    // Log response for important operations
    if (req.method !== 'GET' || req.originalUrl.includes('/admin/') || res.statusCode >= 400) {
      logger.info('Request completed', {
        requestId: req.id,
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        responseTime: `${responseTime}ms`,
        userId: req.user?.userId || 'anonymous'
      });
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

module.exports = {
  developmentLogger,
  productionLogger,
  errorLogger,
  requestTracker
};