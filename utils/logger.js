const winston = require('winston');
const path = require('path');

// Ensure logs directory exists
const fs = require('fs');
const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Custom format for production logs
const productionFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    // Sanitize sensitive data from logs
    const sanitized = sanitizeLogData(meta);
    return JSON.stringify({
      timestamp,
      level,
      message,
      ...sanitized
    });
  })
);

// Development format with colors
const developmentFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const sanitized = sanitizeLogData(meta);
    return `${timestamp} [${level}]: ${message} ${Object.keys(sanitized).length ? JSON.stringify(sanitized, null, 2) : ''}`;
  })
);

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
  defaultMeta: { 
    service: 'ecommerce-api',
    environment: process.env.NODE_ENV || 'development'
  },
  transports: [
    // Error logs
    new winston.transports.File({ 
      filename: path.join(logDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Combined logs
    new winston.transports.File({ 
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Security logs
    new winston.transports.File({ 
      filename: path.join(logDir, 'security.log'),
      level: 'warn',
      maxsize: 5242880, // 5MB
      maxFiles: 10,
      tailable: true
    })
  ],
  
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'exceptions.log'),
      maxsize: 5242880,
      maxFiles: 3
    })
  ],
  
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({ 
      filename: path.join(logDir, 'rejections.log'),
      maxsize: 5242880,
      maxFiles: 3
    })
  ]
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: developmentFormat,
    level: 'debug'
  }));
}

// Sanitize sensitive data from logs
function sanitizeLogData(data) {
  if (!data || typeof data !== 'object') return data;
  
  const sensitiveFields = [
    'password', 'token', 'secret', 'key', 'auth', 'authorization',
    'cookie', 'session', 'jwt', 'apikey', 'api_key', 'credentials',
    'ssn', 'social_security', 'credit_card', 'creditcard', 'cvv',
    'pin', 'otp', 'email', 'phone', 'address'
  ];
  
  const sanitized = {};
  
  for (const [key, value] of Object.entries(data)) {
    const lowKey = key.toLowerCase();
    const isSensitive = sensitiveFields.some(field => lowKey.includes(field));
    
    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      sanitized[key] = sanitizeLogData(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

// Helper functions for different log levels
const logHelpers = {
  security: (message, meta = {}) => {
    logger.warn(message, { 
      ...meta, 
      category: 'SECURITY',
      timestamp: new Date().toISOString()
    });
  },
  
  performance: (message, meta = {}) => {
    logger.info(message, { 
      ...meta, 
      category: 'PERFORMANCE',
      timestamp: new Date().toISOString()
    });
  },
  
  database: (message, meta = {}) => {
    logger.info(message, { 
      ...meta, 
      category: 'DATABASE',
      timestamp: new Date().toISOString()
    });
  },
  
  api: (message, meta = {}) => {
    logger.info(message, { 
      ...meta, 
      category: 'API',
      timestamp: new Date().toISOString()
    });
  },
  
  auth: (message, meta = {}) => {
    logger.warn(message, { 
      ...meta, 
      category: 'AUTHENTICATION',
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = { logger, logHelpers, sanitizeLogData };