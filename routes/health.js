const express = require('express');
const router = express.Router();

// GET /api/health - Simple health check (no auth required)
router.get('/', async (req, res) => {
  try {
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'my-ecommerce-backend',
      version: '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/health/analytics - Analytics health check
router.get('/analytics', async (req, res) => {
  try {
    res.json({
      success: true,
      service: 'analytics',
      status: 'operational',
      endpoints: [
        '/api/analytics/chart-data',
        '/api/analytics/category-data', 
        '/api/analytics/traffic-sources',
        '/api/analytics/summary',
        '/api/analytics/real-time'
      ],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;