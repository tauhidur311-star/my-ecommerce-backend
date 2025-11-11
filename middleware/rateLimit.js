const rateLimit = require('express-rate-limit');

// More lenient API rate limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Allow 300 API requests per 15 minutes (was 100)
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks and options requests
    return req.method === 'OPTIONS' || req.path === '/api/health';
  }
});

// More lenient limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Allow 20 authentication attempts per 15 minutes (was 5)
  message: {
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins against the limit
});

// Password reset limiter
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes (reduced from 1 hour for testing)
  max: 10, // limit each IP to 10 password reset requests per 15 minutes (increased for testing)
  message: {
    error: 'Too many password reset attempts, please try again later.',
    retryAfter: '15 minutes'
  }
});

module.exports = {
  apiLimiter,
  authLimiter,
  passwordResetLimiter
};