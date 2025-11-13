// Enhanced security headers middleware
const setSecurityHeaders = (req, res, next) => {
  // Strict Transport Security (HSTS)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent page embedding (clickjacking protection)
  res.setHeader('X-Frame-Options', 'DENY');

  // XSS Protection (legacy header, but still good for older browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy (formerly Feature Policy)
  res.setHeader('Permissions-Policy', 
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=()'
  );

  // Content Security Policy
  const frontendDomains = [
    process.env.FRONTEND_URL,
    'https://my-ecommerce-frontend-phi.vercel.app',
    'https://my-ecommerce-frontend-1osx.onrender.com',
    'http://localhost:3000',
    'http://localhost:3001'
  ].filter(Boolean).join(' ');

  const cspDirectives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://checkout.stripe.com https://www.google.com https://www.gstatic.com`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data: blob: https: http:`,
    `media-src 'self' blob: https:`,
    `object-src 'none'`,
    `frame-src 'self' https://js.stripe.com https://checkout.stripe.com https://www.google.com`,
    `connect-src 'self' ${frontendDomains} https://api.stripe.com https://checkout.stripe.com wss: ws:`,
    `form-action 'self'`,
    `base-uri 'self'`,
    "upgrade-insecure-requests"
  ];

  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));

  // Additional security headers for admin routes
  if (req.path.startsWith('/api/admin')) {
    // More restrictive CSP for admin
    const adminCSP = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'`,
      `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
      `font-src 'self' https://fonts.gstatic.com`,
      `img-src 'self' data: blob: https:`,
      `connect-src 'self' ${frontendDomains}`,
      `frame-ancestors 'none'`,
      `form-action 'self'`,
      `base-uri 'self'`
    ];
    res.setHeader('Content-Security-Policy', adminCSP.join('; '));
    
    // Additional admin-specific headers
    res.setHeader('X-Admin-Request', 'true');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }

  // API-specific headers
  if (req.path.startsWith('/api/')) {
    res.setHeader('X-API-Version', '1.0');
    res.setHeader('X-Rate-Limit-Policy', 'standard');
  }

  // Asset-specific headers
  if (req.path.includes('/uploads/') || req.path.includes('/assets/')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    
    // Cache control for static assets
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }

  next();
};

// Content Security Policy Nonce Generator
const generateCSPNonce = (req, res, next) => {
  const crypto = require('crypto');
  const nonce = crypto.randomBytes(16).toString('base64');
  res.locals.nonce = nonce;
  
  // Update CSP header to include nonce
  const existingCSP = res.getHeader('Content-Security-Policy');
  if (existingCSP) {
    const updatedCSP = existingCSP.replace(
      "'unsafe-inline'",
      `'nonce-${nonce}' 'strict-dynamic'`
    );
    res.setHeader('Content-Security-Policy', updatedCSP);
  }
  
  next();
};

// CORS preflight headers
const setCORSHeaders = (req, res, next) => {
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'https://my-ecommerce-frontend-phi.vercel.app',
    'https://my-ecommerce-frontend-1osx.onrender.com',
    'http://localhost:3000',
    'http://localhost:3001'
  ].filter(Boolean);

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-Requested-With, Accept, X-Device-ID');
  res.setHeader('Access-Control-Max-Age', '3600'); // 1 hour

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  next();
};

// Security headers for file uploads
const setUploadSecurityHeaders = (req, res, next) => {
  // Prevent execution of uploaded files
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'attachment');
  
  // Additional restrictions for uploaded content
  if (req.path.includes('/uploads/')) {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:");
  }

  next();
};

// Rate limit headers
const setRateLimitHeaders = (req, res, next) => {
  // Add rate limit info to response headers
  if (req.rateLimit) {
    res.setHeader('X-RateLimit-Limit', req.rateLimit.limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, req.rateLimit.remaining));
    res.setHeader('X-RateLimit-Reset', req.rateLimit.resetTime);
  }

  next();
};

// Security information headers (for debugging in development)
const setDebugSecurityHeaders = (req, res, next) => {
  if (process.env.NODE_ENV === 'development') {
    res.setHeader('X-Debug-Request-ID', req.id || 'unknown');
    res.setHeader('X-Debug-User-ID', req.user?.userId || 'anonymous');
    res.setHeader('X-Debug-IP', req.ip);
    res.setHeader('X-Debug-User-Agent', req.get('User-Agent') || 'unknown');
  }

  next();
};

// Remove sensitive server information
const removeServerHeaders = (req, res, next) => {
  // Remove default Express/Node.js headers that reveal technology stack
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  
  // Set generic server header
  res.setHeader('Server', 'StyleShop/1.0');

  next();
};

// Comprehensive security headers middleware
const enhancedSecurityHeaders = [
  removeServerHeaders,
  setCORSHeaders,
  setSecurityHeaders,
  setRateLimitHeaders,
  setDebugSecurityHeaders
];

module.exports = {
  enhancedSecurityHeaders,
  setSecurityHeaders,
  generateCSPNonce,
  setCORSHeaders,
  setUploadSecurityHeaders,
  setRateLimitHeaders,
  setDebugSecurityHeaders,
  removeServerHeaders
};