const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const MongoStore = require('rate-limit-mongo');

// Redis alternative using MongoDB for rate limiting storage
const createMongoStore = () => {
  try {
    return new MongoStore({
      uri: process.env.MONGODB_URI,
      collectionName: 'rate_limits',
      expireTimeMs: 15 * 60 * 1000, // 15 minutes
    });
  } catch (error) {
    console.warn('MongoDB store for rate limiting failed, falling back to memory store');
    return undefined;
  }
};

// Enhanced rate limiting with different tiers
const createRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100,
    message = 'Too many requests, please try again later.',
    standardHeaders = true,
    legacyHeaders = false,
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator = undefined,
    skip = undefined,
    handler = undefined
  } = options;

  return rateLimit({
    windowMs,
    max,
    message: {
      error: message,
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders,
    legacyHeaders,
    store: createMongoStore(),
    skipSuccessfulRequests,
    skipFailedRequests,
    keyGenerator: keyGenerator || ((req) => {
      // Use user ID if authenticated, otherwise IP
      return req.user?.id || req.ip;
    }),
    skip: skip || ((req) => {
      // Skip rate limiting for admin users
      return req.user?.role === 'admin';
    }),
    handler: handler || ((req, res) => {
      res.status(429).json({
        success: false,
        error: message,
        retryAfter: Math.ceil(windowMs / 1000),
        timestamp: new Date().toISOString()
      });
    })
  });
};

// Slow down middleware for gradual response delays
const createSlowDown = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    delayAfter = 5,
    delayMs = 500,
    maxDelayMs = 20000,
    skipFailedRequests = false,
    skipSuccessfulRequests = false
  } = options;

  return slowDown({
    windowMs,
    delayAfter,
    delayMs,
    maxDelayMs,
    skipFailedRequests,
    skipSuccessfulRequests,
    keyGenerator: (req) => req.user?.id || req.ip,
    skip: (req) => req.user?.role === 'admin'
  });
};

// General API rate limiting
const apiLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each user/IP to 1000 requests per windowMs
  message: 'Too many API requests, please try again later.'
});

// Strict rate limiting for authentication endpoints
const authLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: 'Too many authentication attempts, please try again later.',
  skipSuccessfulRequests: true
});

// Very strict rate limiting for password reset
const passwordResetLimiter = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // limit each IP to 3 password reset requests per hour
  message: 'Too many password reset requests, please try again later.'
});

// Rate limiting for file uploads
const uploadLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Upload limit exceeded, please try again later.'
});

// Rate limiting for search endpoints
const searchLimiter = createRateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 1 search per second average
  message: 'Search rate limit exceeded, please slow down.'
});

// Rate limiting for payment endpoints
const paymentLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Payment processing rate limit exceeded.'
});

// Rate limiting for admin operations
const adminLimiter = createRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: 'Admin operation rate limit exceeded.'
});

// Slow down for resource-intensive operations
const heavyOperationSlowDown = createSlowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 10,
  delayMs: 1000,
  maxDelayMs: 10000
});

// Dynamic rate limiting based on user tier
const dynamicRateLimit = (req, res, next) => {
  const user = req.user;
  let limits;

  if (user) {
    switch (user.tier || 'basic') {
      case 'premium':
        limits = { max: 2000, windowMs: 15 * 60 * 1000 };
        break;
      case 'pro':
        limits = { max: 5000, windowMs: 15 * 60 * 1000 };
        break;
      case 'enterprise':
        limits = { max: 10000, windowMs: 15 * 60 * 1000 };
        break;
      default:
        limits = { max: 1000, windowMs: 15 * 60 * 1000 };
    }
  } else {
    // Unauthenticated users get lower limits
    limits = { max: 100, windowMs: 15 * 60 * 1000 };
  }

  const limiter = createRateLimit(limits);
  limiter(req, res, next);
};

// Adaptive rate limiting based on server load
class AdaptiveRateLimit {
  constructor() {
    this.baseMax = 1000;
    this.currentMax = 1000;
    this.lastCheck = Date.now();
    this.checkInterval = 60000; // 1 minute
  }

  getServerLoad() {
    // Simple CPU and memory check
    const usage = process.cpuUsage();
    const memUsage = process.memoryUsage();
    
    const cpuPercent = (usage.user + usage.system) / 1000000; // Convert to ms
    const memPercent = memUsage.heapUsed / memUsage.heapTotal;
    
    return Math.max(cpuPercent / 100, memPercent);
  }

  adjustLimits() {
    const now = Date.now();
    
    if (now - this.lastCheck < this.checkInterval) {
      return this.currentMax;
    }

    const load = this.getServerLoad();
    
    if (load > 0.8) {
      // High load - reduce limits by 50%
      this.currentMax = Math.floor(this.baseMax * 0.5);
    } else if (load > 0.6) {
      // Medium load - reduce limits by 25%
      this.currentMax = Math.floor(this.baseMax * 0.75);
    } else {
      // Normal load - use base limits
      this.currentMax = this.baseMax;
    }

    this.lastCheck = now;
    return this.currentMax;
  }

  middleware() {
    return (req, res, next) => {
      const max = this.adjustLimits();
      const limiter = createRateLimit({ max });
      limiter(req, res, next);
    };
  }
}

const adaptiveRateLimit = new AdaptiveRateLimit();

// IP Whitelist middleware
const ipWhitelist = (allowedIPs = []) => {
  return (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    if (allowedIPs.length > 0 && !allowedIPs.includes(clientIP)) {
      return next(); // Continue to rate limiting
    }
    
    // Skip rate limiting for whitelisted IPs
    next();
  };
};

// Suspicious activity detector
const suspiciousActivityDetector = (req, res, next) => {
  const userAgent = req.get('User-Agent') || '';
  const referer = req.get('Referer') || '';
  
  // Check for suspicious patterns
  const suspiciousPatterns = [
    /bot/i,
    /crawler/i,
    /spider/i,
    /scraper/i,
    /^$/,  // Empty user agent
  ];

  const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(userAgent));
  
  if (isSuspicious) {
    // Apply stricter rate limiting for suspicious requests
    const strictLimiter = createRateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: 'Suspicious activity detected. Access temporarily restricted.'
    });
    
    return strictLimiter(req, res, next);
  }
  
  next();
};

// Rate limiting analytics
const rateLimitAnalytics = {
  hits: new Map(),
  
  record(ip, endpoint) {
    const key = `${ip}:${endpoint}`;
    const now = Date.now();
    const hour = Math.floor(now / (60 * 60 * 1000));
    
    if (!this.hits.has(hour)) {
      this.hits.set(hour, new Map());
    }
    
    const hourlyHits = this.hits.get(hour);
    hourlyHits.set(key, (hourlyHits.get(key) || 0) + 1);
    
    // Clean up old data (keep only last 24 hours)
    if (this.hits.size > 24) {
      const oldestHour = Math.min(...this.hits.keys());
      this.hits.delete(oldestHour);
    }
  },
  
  getStats() {
    const stats = {
      totalHits: 0,
      uniqueIPs: new Set(),
      topEndpoints: new Map(),
      hourlyBreakdown: new Map()
    };
    
    for (const [hour, hourlyHits] of this.hits.entries()) {
      let hourTotal = 0;
      
      for (const [key, hits] of hourlyHits.entries()) {
        const [ip, endpoint] = key.split(':');
        
        stats.totalHits += hits;
        stats.uniqueIPs.add(ip);
        stats.topEndpoints.set(endpoint, (stats.topEndpoints.get(endpoint) || 0) + hits);
        hourTotal += hits;
      }
      
      stats.hourlyBreakdown.set(hour, hourTotal);
    }
    
    // Convert to arrays for easier consumption
    stats.uniqueIPs = stats.uniqueIPs.size;
    stats.topEndpoints = Array.from(stats.topEndpoints.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    return stats;
  }
};

// Middleware to record analytics
const recordRateLimit = (req, res, next) => {
  rateLimitAnalytics.record(req.ip, req.path);
  next();
};

module.exports = {
  createRateLimit,
  createSlowDown,
  apiLimiter,
  authLimiter,
  passwordResetLimiter,
  uploadLimiter,
  searchLimiter,
  paymentLimiter,
  adminLimiter,
  heavyOperationSlowDown,
  dynamicRateLimit,
  adaptiveRateLimit: adaptiveRateLimit.middleware(),
  ipWhitelist,
  suspiciousActivityDetector,
  recordRateLimit,
  rateLimitAnalytics
};