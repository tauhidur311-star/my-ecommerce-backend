// ADD THESE IMPORTS AT THE TOP OF YOUR server.js file (after existing imports):

const { logger } = require('./utils/logger');
const { globalErrorHandler, notFoundHandler } = require('./utils/errorHandler');
const { performanceMonitor, getPerformanceSummary } = require('./middleware/performanceMonitor');

// ADD THIS MIDDLEWARE AFTER YOUR EXISTING MIDDLEWARE (after helmet, cors, etc.):

// Performance monitoring middleware
app.use(performanceMonitor);

// ADD THESE ROUTES BEFORE YOUR EXISTING ROUTES:

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version
  });
});

// Performance monitoring routes
try {
  const performanceRoutes = require('./routes/performanceRoutes');
  app.use('/api/admin/performance', performanceRoutes);
  console.log('✅ Performance monitoring routes loaded');
} catch (error) {
  console.warn('⚠️ Performance routes not available:', error.message);
}

// REPLACE YOUR EXISTING ERROR HANDLER WITH:

// 404 handler for undefined routes
app.use(notFoundHandler);

// Global error handler
app.use(globalErrorHandler);

// ADD GRACEFUL SHUTDOWN AT THE END OF YOUR server.js:

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  server.close(() => {
    console.log('✅ HTTP server closed');
    
    // Close database connection
    mongoose.connection.close(() => {
      console.log('✅ Database connection closed');
      process.exit(0);
    });
  });

  // Force close after 10 seconds
  setTimeout(() => {
    console.error('⚠️ Forcing shutdown after 10 seconds');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));