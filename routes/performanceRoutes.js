const express = require('express');
const router = express.Router();
const { adminAuth } = require('../middleware/adminAuth');
const { getPerformanceSummary, monitorDatabasePerformance } = require('../middleware/performanceMonitor');
const { logger } = require('../utils/logger');
const mongoose = require('mongoose');

// Apply admin authentication to all performance routes
router.use(adminAuth);

// Get performance summary
router.get('/summary', (req, res) => {
  try {
    const summary = getPerformanceSummary();
    const memoryUsage = process.memoryUsage();
    
    res.json({
      success: true,
      data: {
        endpoints: summary,
        system: {
          uptime: Math.round(process.uptime()),
          memory: {
            rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB',
            heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
            heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
            external: Math.round(memoryUsage.external / 1024 / 1024) + 'MB'
          },
          nodeVersion: process.version,
          platform: process.platform,
          pid: process.pid
        },
        database: {
          connected: mongoose.connection.readyState === 1,
          name: mongoose.connection.name,
          host: mongoose.connection.host,
          port: mongoose.connection.port
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Performance summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get performance summary',
      error: error.message
    });
  }
});

// Get real-time metrics
router.get('/metrics', async (req, res) => {
  try {
    const { timeframe = '1h' } = req.query;
    
    // Get memory usage trend (simplified - you can enhance this)
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Convert to readable format
    const metrics = {
      timestamp: new Date().toISOString(),
      memory: {
        heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memoryUsage.rss / 1024 / 1024),
        externalMB: Math.round(memoryUsage.external / 1024 / 1024),
        usagePercentage: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: Math.round(process.uptime()),
      activeConnections: req.socket?.server?._connections || 0
    };
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error('Real-time metrics error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get real-time metrics',
      error: error.message
    });
  }
});

// Database performance test
router.post('/test-db', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Test various database operations
    const tests = [];
    
    // Test 1: Simple count query
    const countStart = Date.now();
    const userCount = await mongoose.connection.db.collection('users').countDocuments();
    const countTime = Date.now() - countStart;
    tests.push({ operation: 'User Count', time: countTime + 'ms', result: userCount });
    
    // Test 2: Find with limit
    const findStart = Date.now();
    const sampleUsers = await mongoose.connection.db.collection('users')
      .find({})
      .limit(5)
      .toArray();
    const findTime = Date.now() - findStart;
    tests.push({ operation: 'Find Users (limit 5)', time: findTime + 'ms', result: sampleUsers.length });
    
    // Test 3: Aggregate query
    const aggStart = Date.now();
    const orderStats = await mongoose.connection.db.collection('orders')
      .aggregate([
        { $group: { _id: null, total: { $sum: 1 }, avgTotal: { $avg: '$total' } } }
      ])
      .toArray();
    const aggTime = Date.now() - aggStart;
    tests.push({ operation: 'Order Aggregation', time: aggTime + 'ms', result: orderStats[0] || {} });
    
    const totalTime = Date.now() - startTime;
    
    res.json({
      success: true,
      data: {
        totalTime: totalTime + 'ms',
        tests,
        database: {
          connected: mongoose.connection.readyState === 1,
          name: mongoose.connection.name,
          collections: (await mongoose.connection.db.listCollections().toArray()).length
        }
      }
    });
    
  } catch (error) {
    logger.error('Database performance test error:', error);
    res.status(500).json({
      success: false,
      message: 'Database performance test failed',
      error: error.message
    });
  }
});

// Get slow queries log
router.get('/slow-queries', (req, res) => {
  try {
    // This would integrate with your logging system
    // For now, return mock data
    const slowQueries = [
      {
        timestamp: new Date().toISOString(),
        operation: 'find',
        collection: 'orders',
        duration: '1200ms',
        query: { userId: 'user123' }
      }
    ];
    
    res.json({
      success: true,
      data: slowQueries
    });
  } catch (error) {
    logger.error('Slow queries error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get slow queries',
      error: error.message
    });
  }
});

// Performance alerts configuration
router.get('/alerts', (req, res) => {
  try {
    const alerts = {
      memory: {
        threshold: 80, // 80% memory usage
        enabled: true,
        currentUsage: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100)
      },
      responseTime: {
        threshold: 1000, // 1 second
        enabled: true,
        avgResponseTime: '245ms' // This would come from performance monitoring
      },
      errorRate: {
        threshold: 5, // 5% error rate
        enabled: true,
        currentRate: '1.2%' // This would come from error tracking
      }
    };
    
    res.json({
      success: true,
      data: alerts
    });
  } catch (error) {
    logger.error('Performance alerts error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get performance alerts',
      error: error.message
    });
  }
});

module.exports = router;