const csrf = require('csurf');
const SecurityLog = require('../models/SecurityLog');

// Enhanced CSRF protection with logging
const enhancedCSRFProtection = () => {
  const csrfMiddleware = csrf({
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 1000 // 1 hour
    },
    ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
    // Custom error handler
    onError: async (req, res, next, error) => {
      // Log CSRF violation
      await SecurityLog.logEvent({
        action: 'csrf_violation',
        userId: req.user?.userId || null,
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: {
          endpoint: req.path,
          method: req.method,
          error: error.message,
          providedToken: req.body._csrf || req.get('X-CSRF-Token') || req.get('X-Xsrf-Token'),
          referer: req.get('Referer')
        },
        severity: 'high'
      });

      res.status(403).json({
        success: false,
        error: 'Invalid CSRF token',
        code: 'CSRF_VIOLATION'
      });
    }
  });

  return csrfMiddleware;
};

// CSRF token generator middleware
const generateCSRFToken = () => {
  return (req, res, next) => {
    // Generate token and attach to request
    const token = req.csrfToken();
    
    // Add token to response headers for SPA applications
    res.set('X-CSRF-Token', token);
    
    // Also add to locals for template rendering (if needed)
    res.locals.csrfToken = token;
    
    next();
  };
};

// Conditional CSRF protection (skip for API keys, apply for browser sessions)
const conditionalCSRF = () => {
  return (req, res, next) => {
    // Skip CSRF for API key authentication
    const apiKey = req.get('X-API-Key');
    if (apiKey) {
      return next();
    }

    // Skip CSRF for certain endpoints (like webhooks)
    const skipPaths = [
      '/api/webhooks',
      '/api/callbacks',
      '/api/auth/refresh'
    ];
    
    if (skipPaths.some(path => req.path.startsWith(path))) {
      return next();
    }

    // Apply CSRF protection for browser-based requests
    const csrfProtection = enhancedCSRFProtection();
    csrfProtection(req, res, next);
  };
};

// Double-submit cookie pattern for additional protection
const doubleSubmitCookie = () => {
  return (req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const cookieToken = req.cookies['csrf-token'];
      const headerToken = req.get('X-CSRF-Token') || req.body._csrf;

      if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        SecurityLog.logEvent({
          action: 'csrf_violation',
          userId: req.user?.userId || null,
          ip: req.ip,
          userAgent: req.get('User-Agent') || '',
          details: {
            endpoint: req.path,
            method: req.method,
            reason: 'double_submit_cookie_mismatch',
            cookieToken: cookieToken ? 'present' : 'missing',
            headerToken: headerToken ? 'present' : 'missing'
          },
          severity: 'high'
        }).catch(console.error);

        return res.status(403).json({
          success: false,
          error: 'CSRF token validation failed',
          code: 'CSRF_DOUBLE_SUBMIT_FAILED'
        });
      }

      // Set cookie for next request
      res.cookie('csrf-token', headerToken, {
        httpOnly: false, // Needed for JS access
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 1000 // 1 hour
      });
    }

    next();
  };
};

// Origin validation middleware
const validateOrigin = () => {
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:3001',
    'https://my-ecommerce-frontend-phi.vercel.app',
    'https://my-ecommerce-frontend-1osx.onrender.com'
  ].filter(Boolean);

  return async (req, res, next) => {
    const origin = req.get('Origin') || req.get('Referer');
    
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      if (!origin) {
        await SecurityLog.logEvent({
          action: 'suspicious_activity',
          userId: req.user?.userId || null,
          ip: req.ip,
          userAgent: req.get('User-Agent') || '',
          details: {
            endpoint: req.path,
            method: req.method,
            reason: 'missing_origin_header'
          },
          severity: 'medium'
        });

        return res.status(403).json({
          success: false,
          error: 'Origin header required',
          code: 'MISSING_ORIGIN'
        });
      }

      const isAllowedOrigin = allowedOrigins.some(allowed => 
        origin.startsWith(allowed)
      );

      if (!isAllowedOrigin) {
        await SecurityLog.logEvent({
          action: 'csrf_violation',
          userId: req.user?.userId || null,
          ip: req.ip,
          userAgent: req.get('User-Agent') || '',
          details: {
            endpoint: req.path,
            method: req.method,
            reason: 'invalid_origin',
            origin: origin
          },
          severity: 'high'
        });

        return res.status(403).json({
          success: false,
          error: 'Origin not allowed',
          code: 'INVALID_ORIGIN'
        });
      }
    }

    next();
  };
};

// Admin-specific CSRF protection
const adminCSRFProtection = () => {
  return (req, res, next) => {
    // Apply stricter CSRF protection for admin routes
    if (req.path.startsWith('/api/admin')) {
      const csrfProtection = enhancedCSRFProtection();
      const originValidation = validateOrigin();
      
      // Chain both middlewares
      originValidation(req, res, (err) => {
        if (err) return next(err);
        csrfProtection(req, res, next);
      });
    } else {
      next();
    }
  };
};

module.exports = {
  enhancedCSRFProtection,
  generateCSRFToken,
  conditionalCSRF,
  doubleSubmitCookie,
  validateOrigin,
  adminCSRFProtection
};