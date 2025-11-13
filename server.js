// Load environment variables from .env file at the very beginning
require('dotenv').config();

console.log('🔍 Starting server...');
console.log('📁 Current directory:', __dirname);
console.log('🔑 MONGODB_URI check:', process.env.MONGODB_URI ? 'Found' : 'NOT FOUND');
console.log('🔑 JWT_SECRET check:', process.env.JWT_SECRET ? 'Found' : 'NOT FOUND');
console.log('🔑 GOOGLE_CLIENT_ID check:', process.env.GOOGLE_CLIENT_ID ? 'Found' : 'NOT FOUND');

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

// Import middleware
const { apiLimiter, authLimiter, passwordResetLimiter } = require('./middleware/rateLimit');
const sanitizeInput = require('./middleware/sanitize');
const { validate } = require('./utils/validation');
const errorHandler = require('./middleware/errorHandler');
const connectDB = require('./config/database');
const { trackVisitor } = require('./middleware/analyticsTracker');

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
  console.log('✅ Enhanced security middleware loaded');
} catch (error) {
  console.warn('⚠️  Enhanced security middleware not available:', error.message);
  console.warn('⚠️  Using fallback security measures');
  
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

// Trust proxy setting - Required for proper IP detection behind reverse proxies (like Render, Heroku, etc.)
app.set('trust proxy', 1);

// Security Middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false, // Allow embedding for payment gateways
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));

// CORS configuration - Allow specific origins including your Vercel domain
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001', 
      'https://my-ecommerce-frontend-phi.vercel.app',
      'https://my-ecommerce-frontend-1osx.onrender.com',  // Current frontend URL
      'https://vercel.app'
    ];
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(null, true); // Allow all for now, but log blocked origins
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With', 'Accept']
};

app.use(cors(corsOptions));
app.use(compression()); // Compress responses

// Enhanced Security Headers
app.use(enhancedSecurityHeaders);

// Enhanced Rate Limiting and Analytics
app.use(recordRateLimit);
app.use('/api/', enhancedApiLimiter);

// Enhanced Input Sanitization
app.use(enhancedSanitize);

// CSRF Protection for state-changing requests
app.use(conditionalCSRF());
app.use(generateCSRFToken());

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Analytics tracking middleware (before routes)
app.use(trackVisitor);

// Serve static files (for Mailjet verification file)
app.use(express.static('public'));

// Serve uploaded assets with CORS headers  
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
}, express.static('uploads'));

// Security middleware
app.use(...sanitizeInput);

// Logging
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Rate limiting
app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', passwordResetLimiter);
app.use('/api/auth/reset-password', passwordResetLimiter);

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ============================================
// MODELS
// ============================================

// Import models
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');
const Wishlist = require('./models/Wishlist');

// Note: Authentication and user management routes have been moved to organized route modules
// This improves code organization and maintainability


// ============================================
// ROUTES - USE ORGANIZED ROUTE MODULES
// ============================================

// Authentication routes
app.use('/api/auth', require('./routes/auth'));

// User routes
app.use('/api/users', require('./routes/users'));

// Product routes
app.use('/api/products', require('./routes/products'));

// Category routes
app.use('/api/categories', require('./routes/categories'));

// Order routes (includes basic order management)
app.use('/api/orders', require('./routes/orders'));

// Wishlist routes
app.use('/api/wishlist', require('./routes/wishlist'));

// Cart routes
app.use('/api/cart', require('./routes/cart'));

// Upload routes
app.use('/api/upload', require('./routes/upload'));

// Analytics routes
app.use('/api/analytics', require('./routes/analytics'));

// Real-time admin analytics routes
app.use('/api/admin/analytics', require('./routes/adminAnalyticsRoutes'));

// Payment routes
app.use('/api/payments', require('./routes/payments'));

// Admin routes
app.use('/api/admin', require('./routes/admin'));

// Notification routes
app.use('/api/notifications', require('./routes/notifications'));

// Search routes
app.use('/api/search', require('./routes/search'));

// Enhanced Authentication routes (with fallback)
try {
  app.use('/api/auth/enhanced', require('./routes/enhancedAuth'));
  console.log('✅ Enhanced auth routes loaded');
} catch (error) {
  console.warn('⚠️  Enhanced auth routes not available:', error.message);
}

// Two-Factor Authentication routes
app.use('/api/auth/2fa', require('./routes/twoFactorAuth'));

// Review routes
app.use('/api/reviews', require('./routes/reviews'));

// Email verification routes
app.use('/api/auth', require('./routes/emailVerification'));

// Theme system routes
app.use('/api/admin/themes', require('./routes/theme'));
app.use('/api/admin/assets', require('./routes/assets'));
app.use('/api/admin/reusable-blocks', require('./routes/reusableBlocks'));
app.use('/api/public', require('./routes/public'));

// Contact form routes
app.use('/api/contact', require('./routes/contact'));

// Admin contact management routes
app.use('/api/admin/contacts', require('./routes/admin/contacts'));
app.use('/api/admin/contact-info', require('./routes/admin/contactInfo'));
app.use('/api/admin/email-templates', require('./routes/admin/emailTemplates'));

// Email campaign routes
app.use('/api/admin/email-campaigns', require('./routes/emailCampaignRoutes'));

// Enhanced notification routes
try {
  const notificationRoutes = require('./routes/notifications');
  app.use('/api/admin/notifications', notificationRoutes);
  console.log('✅ Enhanced notification routes loaded');
} catch (error) {
  console.warn('⚠️  Enhanced notification routes not available:', error.message);
}

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date(),
    environment: process.env.NODE_ENV,
    version: '1.0.0'
  });
});

// Mailjet domain verification file
app.get('/738e87164ff91be6c5e9400b1b2066af.txt', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.status(200).send('');
});

// 404 handler for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.originalUrl} not found`
  });
});

// Global error handler (must be last)
app.use(errorHandler);

// ============================================
// SERVER STARTUP
// ============================================

const startServer = async () => {
  try {
    // Connect to database
    await connectDB();
    
    const PORT = process.env.PORT || 5000;
    
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📁 Environment: ${process.env.NODE_ENV}`);
      console.log(`🌐 API Base URL: http://localhost:${PORT}/api`);
      console.log(`💊 Health Check: http://localhost:${PORT}/api/health`);
    });

    // Initialize WebSocket server
    const { initializeSocket } = require('./utils/socket');
    initializeSocket(server);

    // Cleanup expired notifications (run every hour)
    const Notification = require('./models/Notification');
    setInterval(async () => {
      try {
        const cleaned = await Notification.cleanupExpired();
        if (cleaned > 0) {
          console.log(`🧹 Cleaned up ${cleaned} expired notifications`);
        }
      } catch (error) {
        console.error('Notification cleanup error:', error);
      }
    }, 60 * 60 * 1000); // 1 hour

    // Cleanup abandoned carts (run daily)
    const Cart = require('./models/Cart');
    setInterval(async () => {
      try {
        const cleaned = await Cart.cleanupAbandonedCarts();
        if (cleaned > 0) {
          console.log(`🧹 Cleaned up ${cleaned} abandoned carts`);
        }
      } catch (error) {
        console.error('Cart cleanup error:', error);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Graceful shutdown
    const gracefulShutdown = (signal) => {
      console.log(`\n📴 ${signal} received. Starting graceful shutdown...`);
      
      server.close(() => {
        console.log('🔴 HTTP server closed.');
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
  process.exit(1);
});

// Start the server
startServer();