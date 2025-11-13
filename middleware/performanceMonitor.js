const { logger, logHelpers } = require('../utils/logger');

// Performance thresholds
const THRESHOLDS = {
  SLOW_REQUEST: 1000, // 1 second
  VERY_SLOW_REQUEST: 5000, // 5 seconds
  MEMORY_WARNING: 100 * 1024 * 1024, // 100MB
  CPU_WARNING: 80 // 80% CPU usage
};

// Track request performance
const performanceMonitor = (req, res, next) => {
  const startTime = process.hrtime.bigint();
  const startMemory = process.memoryUsage();
  
  // Track request start
  req.performanceStart = {
    time: startTime,
    memory: startMemory
  };
  
  // Override res.end to capture response time
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    const endMemory = process.memoryUsage();
    
    // Calculate memory usage for this request
    const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;
    
    // Set performance headers
    res.set({
      'X-Response-Time': `${duration.toFixed(2)}ms`,
      'X-Memory-Usage': `${Math.round(memoryDelta / 1024)}KB`
    });
    
    // Log performance metrics
    logPerformanceMetrics(req, res, duration, memoryDelta);
    
    // Call original end method
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
};

const logPerformanceMetrics = (req, res, duration, memoryDelta) => {
  const performanceData = {
    method: req.method,
    url: req.originalUrl,
    statusCode: res.statusCode,
    duration: `${duration.toFixed(2)}ms`,
    memoryDelta: `${Math.round(memoryDelta / 1024)}KB`,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    userId: req.user?.id || 'anonymous'
  };
  
  // Log based on performance thresholds
  if (duration > THRESHOLDS.VERY_SLOW_REQUEST) {
    logHelpers.performance('VERY SLOW REQUEST DETECTED', {
      ...performanceData,
      severity: 'critical'
    });
  } else if (duration > THRESHOLDS.SLOW_REQUEST) {
    logHelpers.performance('Slow request detected', {
      ...performanceData,
      severity: 'warning'
    });
  } else if (process.env.NODE_ENV === 'development') {
    logHelpers.performance('Request completed', performanceData);
  }
  
  // Log high memory usage
  if (Math.abs(memoryDelta) > THRESHOLDS.MEMORY_WARNING) {
    logHelpers.performance('High memory usage detected', {
      ...performanceData,
      memoryDelta: `${Math.round(memoryDelta / 1024 / 1024)}MB`,
      severity: 'warning'
    });
  }
  
  // Track error responses
  if (res.statusCode >= 400) {
    logHelpers.api('Error response', {
      ...performanceData,
      severity: res.statusCode >= 500 ? 'error' : 'warning'
    });
  }
};

// System performance monitoring
const systemPerformanceMonitor = () => {
  setInterval(() => {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Convert to percentages and MB
    const memoryMB = {
      rss: Math.round(memoryUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      external: Math.round(memoryUsage.external / 1024 / 1024)
    };
    
    // Log system metrics
    logHelpers.performance('System performance metrics', {
      memory: memoryMB,
      uptime: `${Math.round(process.uptime())}s`,
      pid: process.pid,
      nodeVersion: process.version
    });
    
    // Check for memory leaks
    if (memoryUsage.heapUsed > 200 * 1024 * 1024) { // 200MB threshold
      logHelpers.performance('Memory usage warning', {
        heapUsed: memoryMB.heapUsed + 'MB',
        severity: 'warning',
        recommendation: 'Consider investigating memory leaks'
      });
    }
    
    // Check for high RSS memory
    if (memoryUsage.rss > 500 * 1024 * 1024) { // 500MB threshold
      logHelpers.performance('High RSS memory usage', {
        rss: memoryMB.rss + 'MB',
        severity: 'critical',
        recommendation: 'Server may need restart or optimization'
      });
    }
    
  }, 60000); // Check every minute
};

// Database performance monitoring
const monitorDatabasePerformance = (operation, duration, collection = 'unknown') => {
  const performanceData = {
    operation,
    collection,
    duration: `${duration.toFixed(2)}ms`,
    timestamp: new Date().toISOString()
  };
  
  if (duration > 5000) { // 5 second threshold for DB operations
    logHelpers.database('Slow database operation detected', {
      ...performanceData,
      severity: 'critical'
    });
  } else if (duration > 1000) { // 1 second threshold
    logHelpers.database('Database operation warning', {
      ...performanceData,
      severity: 'warning'
    });
  }
};

// API endpoint performance tracking
const endpointStats = new Map();

const trackEndpointPerformance = (req, res, duration) => {
  const endpoint = `${req.method} ${req.route?.path || req.originalUrl}`;
  const stats = endpointStats.get(endpoint) || {
    count: 0,
    totalDuration: 0,
    maxDuration: 0,
    minDuration: Infinity,
    errors: 0
  };
  
  stats.count++;
  stats.totalDuration += duration;
  stats.maxDuration = Math.max(stats.maxDuration, duration);
  stats.minDuration = Math.min(stats.minDuration, duration);
  
  if (res.statusCode >= 400) {
    stats.errors++;
  }
  
  endpointStats.set(endpoint, stats);
};

// Get performance summary
const getPerformanceSummary = () => {
  const summary = {};
  
  for (const [endpoint, stats] of endpointStats.entries()) {
    summary[endpoint] = {
      averageTime: (stats.totalDuration / stats.count).toFixed(2) + 'ms',
      maxTime: stats.maxDuration.toFixed(2) + 'ms',
      minTime: stats.minDuration.toFixed(2) + 'ms',
      totalRequests: stats.count,
      errorRate: ((stats.errors / stats.count) * 100).toFixed(2) + '%'
    };
  }
  
  return summary;
};

// Initialize system monitoring
if (process.env.NODE_ENV === 'production') {
  systemPerformanceMonitor();
}

module.exports = {
  performanceMonitor,
  monitorDatabasePerformance,
  trackEndpointPerformance,
  getPerformanceSummary,
  systemPerformanceMonitor
};