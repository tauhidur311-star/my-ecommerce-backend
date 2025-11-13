const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Add colors to winston
winston.addColors(colors);

// Custom format for development
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize(),
  winston.format.printf((info) => {
    const { timestamp, level, message, stack, ...extra } = info;
    const extraStr = Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${stack || ''} ${extraStr}`;
  })
);

// Production format (JSON)
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create transports array
const transports = [];

// Console transport
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      format: devFormat,
      level: 'debug'
    })
  );
} else {
  transports.push(
    new winston.transports.Console({
      format: prodFormat,
      level: 'info'
    })
  );
}

// File transports
transports.push(
  // Error log file
  new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    format: prodFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 10,
  }),
  
  // Combined log file
  new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    format: prodFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 10,
  }),
  
  // HTTP requests log
  new winston.transports.File({
    filename: path.join(logsDir, 'http.log'),
    level: 'http',
    format: prodFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  })
);

// Create logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  levels,
  format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports,
  exitOnError: false,
});

// Enhanced logging methods
const structuredLogger = {
  // Basic logging methods
  error: (message, meta = {}) => logger.error(message, meta),
  warn: (message, meta = {}) => logger.warn(message, meta),
  info: (message, meta = {}) => logger.info(message, meta),
  http: (message, meta = {}) => logger.http(message, meta),
  debug: (message, meta = {}) => logger.debug(message, meta),

  // Specialized logging methods
  logStartup: (data) => {
    logger.info('🚀 Server Starting', {
      ...data,
      event: 'server_startup',
      timestamp: new Date().toISOString()
    });
  },

  logShutdown: (signal) => {
    logger.info('📴 Server Shutting Down', {
      signal,
      event: 'server_shutdown',
      timestamp: new Date().toISOString()
    });
  },

  logRequest: (req, res, responseTime) => {
    const logData = {
      event: 'http_request',
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress,
      userId: req.user?.userId || null,
      requestId: req.id || null
    };
    
    if (res.statusCode >= 400) {
      logger.warn('HTTP Request Failed', logData);
    } else if (responseTime > 1000) {
      logger.warn('Slow HTTP Request', logData);
    } else {
      logger.http('HTTP Request', logData);
    }
  },

  logError: (error, context = {}) => {
    logger.error('Application Error', {
      event: 'application_error',
      message: error.message,
      stack: error.stack,
      name: error.name,
      timestamp: new Date().toISOString(),
      ...context
    });
  },

  logSecurity: (event, data = {}) => {
    logger.warn('Security Event', {
      event: 'security_alert',
      type: event,
      timestamp: new Date().toISOString(),
      ...data
    });
  },

  logPerformance: (operation, duration, metadata = {}) => {
    const logData = {
      event: 'performance_metric',
      operation,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      ...metadata
    };

    if (duration > 5000) {
      logger.warn('Slow Operation', logData);
    } else {
      logger.info('Performance Metric', logData);
    }
  },

  logBusinessEvent: (event, data = {}) => {
    logger.info('Business Event', {
      event: 'business_event',
      type: event,
      timestamp: new Date().toISOString(),
      ...data
    });
  },

  logDatabase: (operation, duration, metadata = {}) => {
    logger.debug('Database Operation', {
      event: 'database_operation',
      operation,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      ...metadata
    });
  },

  logAuth: (event, userId, metadata = {}) => {
    logger.info('Authentication Event', {
      event: 'auth_event',
      type: event,
      userId,
      timestamp: new Date().toISOString(),
      ...metadata
    });
  },

  logCache: (operation, key, hit = null) => {
    logger.debug('Cache Operation', {
      event: 'cache_operation',
      operation,
      key,
      hit,
      timestamp: new Date().toISOString()
    });
  },

  // Stream for Morgan HTTP logging
  stream: {
    write: (message) => logger.http(message.trim())
  }
};

module.exports = structuredLogger;