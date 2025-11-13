const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
const winston = require('winston');
const User = require('../models/User');
const SecurityLog = require('../models/SecurityLog');
const TokenBlacklist = require('../models/TokenBlacklist');

// Enhanced rate limiting with different tiers
const createRateLimit = (windowMs, max, message, skipSuccessfulRequests = false) => {
  return rateLimit({
    windowMs,
    max,
    message: { 
      success: false, 
      message: message || 'Too many requests, please try again later.',
      retryAfter: Math.ceil(windowMs / 1000)
    },
    skipSuccessfulRequests,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      // Log rate limit violations
      logSecurityEvent({
        type: 'RATE_LIMIT_EXCEEDED',
        userId: req.user?.id || null,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl,
        severity: 'medium'
      });
      
      res.status(429).json({
        success: false,
        message: message || 'Too many requests, please try again later.',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
  });
};

// Different rate limits for different operations
const rateLimits = {
  // Authentication endpoints
  auth: createRateLimit(15 * 60 * 1000, 5, 'Too many authentication attempts'), // 5 attempts per 15 minutes
  
  // Admin operations
  adminGeneral: createRateLimit(60 * 1000, 100), // 100 requests per minute
  adminCritical: createRateLimit(60 * 1000, 20), // 20 critical operations per minute
  
  // API endpoints
  apiGeneral: createRateLimit(60 * 1000, 200), // 200 requests per minute
  apiHeavy: createRateLimit(60 * 1000, 10), // 10 heavy operations per minute
  
  // Public endpoints
  public: createRateLimit(60 * 1000, 300) // 300 requests per minute
};

// Enhanced security headers
const enhancedHelmet = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: []
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: {
    policy: "strict-origin-when-cross-origin"
  }
});

// IP Whitelisting middleware
const ipWhitelist = (allowedIPs = []) => {
  return (req, res, next) => {
    if (allowedIPs.length === 0) return next();
    
    const clientIP = req.ip || req.connection.remoteAddress;
    const isAllowed = allowedIPs.some(ip => {
      if (ip.includes('/')) {
        // CIDR notation support
        return isIPInCIDR(clientIP, ip);
      }
      return ip === clientIP;
    });
    
    if (!isAllowed) {
      logSecurityEvent({
        type: 'IP_ACCESS_DENIED',
        ip: clientIP,
        userAgent: req.get('User-Agent'),
        endpoint: req.originalUrl,
        severity: 'high'
      });
      
      return res.status(403).json({
        success: false,
        message: 'Access denied from this IP address'
      });
    }
    
    next();
  };
};

// Brute force protection
const bruteForceProtection = async (req, res, next) => {
  try {
    const identifier = req.body.email || req.ip;
    const now = new Date();
    const windowStart = new Date(now.getTime() - 15 * 60 * 1000); // 15 minutes

    // Count failed attempts in the last 15 minutes
    const recentAttempts = await SecurityLog.countDocuments({
      type: 'LOGIN_FAILED',
      $or: [
        { 'details.email': identifier },
        { ip: req.ip }
      ],
      createdAt: { $gte: windowStart }
    });

    if (recentAttempts >= 5) {
      await logSecurityEvent({
        type: 'BRUTE_FORCE_DETECTED',
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        details: { identifier, attempts: recentAttempts },
        severity: 'high'
      });

      return res.status(429).json({
        success: false,
        message: 'Account temporarily locked due to multiple failed attempts. Try again in 15 minutes.'
      });
    }

    next();
  } catch (error) {
    console.error('Brute force protection error:', error);
    next();
  }
};

// Session validation middleware
const validateSession = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) return next();

    // Check if token is blacklisted
    const isBlacklisted = await TokenBlacklist.findOne({ token });
    if (isBlacklisted) {
      return res.status(401).json({
        success: false,
        message: 'Token has been invalidated'
      });
    }

    next();
  } catch (error) {
    console.error('Session validation error:', error);
    next();
  }
};

// Device tracking middleware
const deviceTracking = async (req, res, next) => {
  if (!req.user) return next();

  try {
    const deviceFingerprint = generateDeviceFingerprint(req);
    
    // Check if this is a new device
    const user = await User.findById(req.user.id);
    if (user && user.knownDevices) {
      const isKnownDevice = user.knownDevices.some(device => 
        device.fingerprint === deviceFingerprint
      );

      if (!isKnownDevice) {
        // Add new device
        user.knownDevices.push({
          fingerprint: deviceFingerprint,
          userAgent: req.get('User-Agent'),
          ip: req.ip,
          firstSeen: new Date(),
          lastSeen: new Date()
        });

        await user.save();

        // Log new device access
        await logSecurityEvent({
          type: 'NEW_DEVICE_ACCESS',
          userId: req.user.id,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          details: { deviceFingerprint },
          severity: 'medium'
        });
      } else {
        // Update last seen for known device
        const deviceIndex = user.knownDevices.findIndex(device => 
          device.fingerprint === deviceFingerprint
        );
        if (deviceIndex !== -1) {
          user.knownDevices[deviceIndex].lastSeen = new Date();
          await user.save();
        }
      }
    }

    next();
  } catch (error) {
    console.error('Device tracking error:', error);
    next();
  }
};

// Audit logging middleware
const auditLogger = (action) => {
  return async (req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      // Log the action after response
      setTimeout(async () => {
        try {
          const success = res.statusCode < 400;
          
          await logSecurityEvent({
            type: 'ADMIN_ACTION',
            userId: req.user?.id,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            action,
            endpoint: req.originalUrl,
            method: req.method,
            success,
            details: {
              statusCode: res.statusCode,
              requestBody: sanitizeLogData(req.body),
              params: req.params,
              query: req.query
            },
            severity: 'low'
          });
        } catch (error) {
          console.error('Audit logging error:', error);
        }
      }, 0);
      
      return originalSend.call(this, data);
    };
    
    next();
  };
};

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      // Remove potential XSS patterns
      return obj
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    }
    
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    
    if (obj && typeof obj === 'object') {
      const sanitized = {};
      for (const key in obj) {
        sanitized[key] = sanitize(obj[key]);
      }
      return sanitized;
    }
    
    return obj;
  };

  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  if (req.params) req.params = sanitize(req.params);
  
  next();
};

// Security event logging function
const logSecurityEvent = async (eventData) => {
  try {
    const securityLog = new SecurityLog({
      ...eventData,
      createdAt: new Date()
    });
    
    await securityLog.save();
    
    // If high severity, could trigger immediate alerts
    if (eventData.severity === 'high') {
      try {
        const alertingSystem = require('../utils/alertingSystem');
        await alertingSystem.handleSecurityEvent(eventType, {
          severity: eventData.severity || 'high',
          ...eventData
        });
      } catch (error) {
        const logger = require('../utils/structuredLogger');
        logger.error('Failed to send real-time security alert', { error: error.message, eventData });
      }
    }
  } catch (error) {
    console.error('Security event logging error:', error);
  }
};

// Helper functions
const generateDeviceFingerprint = (req) => {
  const userAgent = req.get('User-Agent') || '';
  const acceptLanguage = req.get('Accept-Language') || '';
  const acceptEncoding = req.get('Accept-Encoding') || '';
  
  const fingerprint = crypto
    .createHash('sha256')
    .update(userAgent + acceptLanguage + acceptEncoding)
    .digest('hex');
    
  return fingerprint;
};

const isIPInCIDR = (ip, cidr) => {
  // Simplified CIDR check - implement proper CIDR validation for production
  const [network, bits] = cidr.split('/');
  const mask = parseInt(bits);
  
  // This is a simplified implementation
  // For production, use a proper IP/CIDR library like 'ip' or 'netmask'
  return ip.startsWith(network.split('.').slice(0, Math.floor(mask / 8)).join('.'));
};

const sanitizeLogData = (data) => {
  if (!data || typeof data !== 'object') return data;
  
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'auth'];
  const sanitized = { ...data };
  
  Object.keys(sanitized).forEach(key => {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      sanitized[key] = '[REDACTED]';
    }
  });
  
  return sanitized;
};

// Export all security middleware
module.exports = {
  rateLimits,
  enhancedHelmet,
  ipWhitelist,
  bruteForceProtection,
  validateSession,
  deviceTracking,
  auditLogger,
  sanitizeInput,
  logSecurityEvent,
  createRateLimit
};