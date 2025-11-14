// Load environment variables from .env file at the very beginning
require('dotenv').config();

// Import structured logger
const logger = require('./utils/structuredLogger');

// Log server startup
logger.logStartup({
  nodeVersion: process.version,
  environment: process.env.NODE_ENV,
  port: process.env.PORT || 5000,
  mongoUri: process.env.MONGODB_URI ? 'configured' : 'missing',
  jwtSecret: process.env.JWT_SECRET ? 'configured' : 'missing',
  googleClientId: process.env.GOOGLE_CLIENT_ID ? 'configured' : 'missing'
});

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const helmet = require('helmet');
const path = require('path');

// Import optimized middleware
const enhancedCompression = require('./middleware/compression');
const { requestTracker, productionLogger, errorLogger } = require('./middleware/requestLogger');
const { apiLimiter, authLimiter, passwordResetLimiter } = require('./middleware/rateLimit');
const sanitizeInput = require('./middleware/sanitize');
const { validate } = require('./utils/validation');
const errorHandler = require('./middleware/errorHandler');
const connectDB = require('./config/database');
const { trackVisitor } = require('./middleware/analyticsTracker');
const cache = require('./utils/cache');

// Performance monitoring (with fallback)
let performanceMonitor, getPerformanceSummary;
try {
  ({ performanceMonitor, getPerformanceSummary } = require('./middleware/performanceMonitor'));
  logger.info('Performance monitoring loaded');
} catch (error) {
  logger.warn('Performance monitoring not available', { error: error.message });
  performanceMonitor = (req, res, next) => next(); // Fallback
  getPerformanceSummary = () => ({}); // Fallback
}

// Enhanced Security Middleware (with fallbacks)
let enhancedSecurityHeaders, enhancedSanitize, conditionalCSRF, generateCSRFToken;
let enhancedApiLimiter, enhancedAuthLimiter, recordRateLimit;

try {
  ({ enhancedSecurityHeaders } = require('./middleware/securityHeaders'));
  ({ enhancedSanitize } = require('./middleware/enhancedSanitize'));
  ({ conditionalCSRF, generateCSRFToken } = require('./middleware/enhancedCSRF'));
  ({ 
    apiLimiter: enhancedApiLimiter, 
    authLimiter: enhancedAuthLimiter,
    recordRateLimit 
  } = require('./middleware/enhancedRateLimit'));
  logger.info('Enhanced security middleware loaded');
} catch (error) {
  logger.warn('Enhanced security middleware not available, using fallback', { error: error.message });
  // Fallback implementations
  enhancedSecurityHeaders = (req, res, next) => next();
  enhancedSanitize = sanitizeInput;
  conditionalCSRF = () => (req, res, next) => next();
  generateCSRFToken = () => (req, res, next) => next();
  enhancedApiLimiter = apiLimiter;
  enhancedAuthLimiter = authLimiter;
  recordRateLimit = (req, res, next) => next();
}

const app = express();

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Enhanced security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.ADMIN_URL,
      'http://localhost:3000',
      'http://localhost:3001',
      'https://my-ecommerce-frontend-1osx.onrender.com',
      'https://my-ecommerce-frontend.onrender.com',
      'https://your-custom-domain.com'
    ].filter(Boolean);

    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.logSecurity('cors_violation', { 
        origin, 
        allowedOrigins 
      });
      // In production, be more permissive to avoid blocking legitimate requests
      if (process.env.NODE_ENV === 'production') {
        logger.warn('CORS: Allowing unrecognized origin in production', { origin });
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token', 'Accept', 'Origin'],
  preflightContinue: false,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Emergency CORS fix - add headers to ALL responses
app.use((req, res, next) => {
  const origin = req.get('Origin');
  const allowedOrigins = [
    'https://my-ecommerce-frontend-1osx.onrender.com',
    'https://my-ecommerce-frontend.onrender.com',
    'http://localhost:3000',
    'http://localhost:3001'
  ];
  
  if (!origin || allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin || '*');
  } else {
    res.header('Access-Control-Allow-Origin', 'https://my-ecommerce-frontend-1osx.onrender.com');
  }
  
  res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-CSRF-Token, Accept, Origin, Cache-Control');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Handle preflight OPTIONS requests explicitly
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.get('Origin') || 'https://my-ecommerce-frontend-1osx.onrender.com');
  res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-CSRF-Token, Accept, Origin, Cache-Control');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// Enhanced compression with monitoring
app.use(enhancedCompression);

// Enhanced Security Headers
app.use(enhancedSecurityHeaders);

// Enhanced Rate Limiting and Analytics
app.use(recordRateLimit);
app.use('/api/', enhancedApiLimiter);

// Enhanced Input Sanitization
app.use(enhancedSanitize);

// CSRF Protection
app.use(conditionalCSRF());
app.use(generateCSRFToken());

// Body parsing middleware
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    // Log large payloads for monitoring
    if (buf.length > 1024 * 1024) { // 1MB
      logger.logPerformance('large_payload', buf.length, {
        url: req.originalUrl,
        method: req.method,
        contentType: req.get('Content-Type')
      });
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request tracking and analytics
app.use(requestTracker);
app.use(trackVisitor);

// Static file serving with caching
app.use(express.static('public', {
  maxAge: process.env.NODE_ENV === 'production' ? '1y' : 0,
  etag: true
}));

// File upload security
app.use('/uploads', (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  next();
}, express.static('uploads'));

// Security middleware
app.use(...sanitizeInput);

// Performance monitoring middleware
app.use(performanceMonitor);

// HTTP request logging
if (process.env.NODE_ENV === 'production') {
  app.use(productionLogger);
} else {
  app.use(require('morgan')('dev', { stream: logger.stream }));
}

// Rate limiting for specific endpoints
app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', passwordResetLimiter);
app.use('/api/auth/reset-password', passwordResetLimiter);

// Database connection will be handled in the main startup function

// Import models
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');
const Wishlist = require('./models/Wishlist');

// Enhanced API routes with caching where appropriate
const routes = [
  { path: '/api/auth', module: './routes/auth', cache: false },
  { path: '/api/users', module: './routes/users', cache: false },
  { path: '/api/products', module: './routes/products', cache: true },
  { path: '/api/categories', module: './routes/categories', cache: true },
  { path: '/api/orders', module: './routes/orders', cache: false },
  { path: '/api/wishlist', module: './routes/wishlist', cache: false },
  { path: '/api/cart', module: './routes/cart', cache: false },
  { path: '/api/upload', module: './routes/upload', cache: false },
  { path: '/api/analytics', module: './routes/analytics', cache: true },
  { path: '/api/admin/analytics', module: './routes/adminAnalyticsRoutes', cache: true },
  { path: '/api/payments', module: './routes/payments', cache: false },
  { path: '/api/admin', module: './routes/admin', cache: false },
  { path: '/api/notifications', module: './routes/notifications', cache: false },
  { path: '/api/search', module: './routes/search', cache: true },
  // Theme Editor Routes
  { path: '/api/pages', module: './routes/pages', cache: false },
  { path: '/api/pages', module: './routes/sections', cache: false },
  { path: '/api/pages', module: './routes/revisions', cache: false },
  { path: '/api/pages', module: './routes/comments', cache: false },
  { path: '/api/media', module: './routes/media', cache: false },
];

// Load routes with error handling
routes.forEach(({ path, module, cache }) => {
  try {
    const router = require(module);
    app.use(path, router);
    logger.debug('Route loaded', { path, module, cacheEnabled: cache });
  } catch (error) {
    logger.error('Failed to load route', { path, module, error: error.message });
  }
});

// Enhanced Authentication routes (with fallback)
try {
  app.use('/api/auth/enhanced', require('./routes/enhancedAuth'));
  logger.info('Enhanced auth routes loaded');
} catch (error) {
  logger.warn('Enhanced auth routes not available', { error: error.message });
}

// Two-Factor Authentication routes
try {
  app.use('/api/auth/2fa', require('./routes/twoFactorAuth'));
  logger.info('2FA routes loaded');
} catch (error) {
  logger.warn('2FA routes not available', { error: error.message });
}

// Additional routes with error handling
const additionalRoutes = [
  { path: '/api/reviews', module: './routes/reviews' },
  { path: '/api/admin/assets', module: './routes/assets' },
  { path: '/api/admin/reusable-blocks', module: './routes/reusableBlocks' },
  { path: '/api/public', module: './routes/public' },
  { path: '/api/contact', module: './routes/contact' },
  { path: '/api/admin/contacts', module: './routes/admin/contacts' },
  { path: '/api/admin/contact-info', module: './routes/admin/contactInfo' },
  { path: '/api/admin/email-templates', module: './routes/admin/emailTemplates' },
  { path: '/api/admin/email-campaigns', module: './routes/emailCampaignRoutes' },
  { path: '/api/templates', module: './routes/templates' },
  { path: '/api/export', module: './routes/exports' },
];

additionalRoutes.forEach(({ path, module }) => {
  try {
    app.use(path, require(module));
    logger.debug('Additional route loaded', { path, module });
  } catch (error) {
    logger.warn('Additional route not available', { path, module, error: error.message });
  }
});

// Enhanced SSE Routes (improved connection handling)
try {
  const enhancedSSERoutes = require('./routes/enhancedSSERoutes');
  app.use('/api/sse', enhancedSSERoutes);
  logger.info('Enhanced SSE routes loaded');
} catch (error) {
  logger.warn('Enhanced SSE routes not available', { error: error.message });
}

// Optional enhanced routes
const optionalRoutes = [
  { path: '/api/admin', module: './routes/enhancedAdminRoutes', name: 'Enhanced admin' },
  { path: '/api/admin/marketing', module: './routes/marketingRoutes', name: 'Marketing' },
  { path: '/api/admin/performance', module: './routes/performanceRoutes', name: 'Performance monitoring' },
  { path: '/api/admin/notifications', module: './routes/notifications', name: 'Enhanced notifications' },
  { path: '/api/admin/testimonials', module: './routes/testimonials', name: 'Testimonials' },
  { path: '/api/testimonials', module: './routes/testimonials', name: 'Public testimonials' },
  { path: '/api/admin/content-settings', module: './routes/contentSettings', name: 'Content settings' },
  { path: '/api/content-settings', module: './routes/contentSettings', name: 'Public content settings' },
];

optionalRoutes.forEach(({ path, module, name }) => {
  try {
    app.use(path, require(module));
    logger.info(`${name} routes loaded`);
  } catch (error) {
    logger.warn(`${name} routes not available`, { error: error.message });
  }
});

// Enhanced health check endpoint with detailed system info
app.get('/health', async (req, res) => {
  const healthData = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version,
    environment: process.env.NODE_ENV,
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    cache: cache.getStats(),
    cors: 'enabled'
  };
  
  res.json(healthData);
});

// Simple CORS test endpoint
app.get('/api/cors-test', (req, res) => {
  res.json({
    success: true,
    message: 'CORS is working!',
    origin: req.get('Origin'),
    timestamp: new Date().toISOString()
  });
});

// Enhanced performance monitoring endpoint
app.get('/api/admin/performance', async (req, res) => {
  try {
    const summary = getPerformanceSummary();
    const cacheStats = cache.getStats();
    
    res.json({
      success: true,
      data: {
        performance: summary,
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          timestamp: new Date().toISOString(),
          nodeVersion: process.version,
          environment: process.env.NODE_ENV
        },
        cache: cacheStats,
        database: {
          readyState: mongoose.connection.readyState,
          host: mongoose.connection.host,
          name: mongoose.connection.name
        }
      }
    });
  } catch (error) {
    logger.logError(error, { endpoint: '/api/admin/performance' });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch performance data'
    });
  }
});

// API documentation route (if swagger is implemented)
try {
  const swaggerUi = require('swagger-ui-express');
  const swaggerDocument = require('./docs/swagger.json');
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  logger.info('API documentation available at /api/docs');
} catch (error) {
  logger.debug('Swagger documentation not available', { error: error.message });
}

// Email testing routes (for development/testing)
if (process.env.NODE_ENV !== 'production') {
  try {
    const testEmailRoutes = require('./routes/test-email');
    app.use('/api/test', testEmailRoutes);
    logger.info('Email testing endpoints available at /api/test');
  } catch (error) {
    logger.warn('Email testing routes not available', { error: error.message });
  }
}

// Global error handler for unhandled routes
app.use('*', (req, res) => {
  logger.logSecurity('route_not_found', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  res.status(404).json({
    success: false,
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  logger.logError(err, {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: req.user?.userId,
    userAgent: req.get('User-Agent')
  });
  
  errorHandler(err, req, res, next);
});

// Server startup with enhanced error handling
const startServer = async () => {
  try {
    // Connect to MongoDB first
    await connectDB();
    logger.info('Database connection established');
    
    const PORT = process.env.PORT || 5000;
    
    const server = app.listen(PORT, () => {
      logger.logStartup({
        port: PORT,
        environment: process.env.NODE_ENV,
        baseUrl: `http://localhost:${PORT}/api`,
        healthCheck: `http://localhost:${PORT}/health`,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      });
    });

    // Initialize Socket.IO
    try {
      const { initializeSocket } = require('./utils/socket');
      initializeSocket(server);
      logger.info('Socket.IO initialized');
    } catch (error) {
      logger.warn('Socket.IO initialization failed', { error: error.message });
    }

    // Initialize WebSocket for real-time notifications
    try {
      const wsManager = require('./routes/websocket');
      wsManager.initialize(server);
      logger.info('WebSocket notifications initialized');
      
      // Make wsManager available globally
      app.locals.wsManager = wsManager;
    } catch (error) {
      logger.warn('WebSocket initialization failed', { error: error.message });
    }

    // Background cleanup jobs with enhanced logging
    const Notification = require('./models/Notification');
    setInterval(async () => {
      try {
        const cleaned = await Notification.deleteMany({ 
          createdAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } 
        });
        if (cleaned.deletedCount > 0) {
          logger.logBusinessEvent('cleanup_notifications', { 
            deletedCount: cleaned.deletedCount 
          });
        }
      } catch (error) {
        logger.logError(error, { task: 'notification_cleanup' });
      }
    }, 60 * 60 * 1000); // 1 hour

    // Cleanup abandoned carts
    const Cart = require('./models/Cart');
    setInterval(async () => {
      try {
        const cleaned = await Cart.cleanupAbandonedCarts();
        if (cleaned > 0) {
          logger.logBusinessEvent('cleanup_carts', { 
            deletedCount: cleaned 
          });
        }
      } catch (error) {
        logger.logError(error, { task: 'cart_cleanup' });
      }
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Graceful shutdown handling
    const gracefulShutdown = async (signal) => {
      logger.logShutdown(signal);
      
      server.close(async () => {
        logger.info('HTTP server closed');
        try {
          await mongoose.connection.close();
          logger.info('MongoDB connection closed');
        } catch (error) {
          logger.error('Error closing MongoDB connection:', error);
        }
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.logError(error, { context: 'server_startup' });
    process.exit(1);
  }
};

// Enhanced process error handlers
process.on('uncaughtException', (err) => {
  logger.logError(err, { context: 'uncaught_exception' });
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  logger.logError(err, { context: 'unhandled_rejection' });
  process.exit(1);
});

// Start the server
startServer();

module.exports = app;