const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');

// GET /api/analytics - Dashboard analytics data
router.get('/', auth, adminAuth, async (req, res) => {
  try {
    const { range = '7d' } = req.query;
    
    // Mock analytics data (replace with real database queries)
    const analyticsData = {
      success: true,
      data: {
        totalRevenue: 125000,
        totalOrders: 1250,
        totalUsers: 3500,
        revenueGrowth: 15.8,
        ordersGrowth: 12.3,
        usersGrowth: 8.7,
        chartData: [
          { name: 'Jan', sales: 4000, orders: 240, users: 800 },
          { name: 'Feb', sales: 3000, orders: 220, users: 750 },
          { name: 'Mar', sales: 2000, orders: 180, users: 900 },
          { name: 'Apr', sales: 2780, orders: 200, users: 850 },
          { name: 'May', sales: 1890, orders: 160, users: 700 },
          { name: 'Jun', sales: 2390, orders: 190, users: 950 },
          { name: 'Jul', sales: 3490, orders: 280, users: 1100 }
        ]
      },
      range,
      generatedAt: new Date().toISOString()
    };

    res.json(analyticsData);
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics data',
      details: error.message
    });
  }
});

// GET /api/analytics/chart-data
router.get('/chart-data', auth, adminAuth, async (req, res) => {
  try {
    const { range = '7d' } = req.query;
    
    const chartData = {
      success: true,
      data: [
        { name: 'Jan', sales: 4000, orders: 240, users: 800 },
        { name: 'Feb', sales: 3000, orders: 220, users: 750 },
        { name: 'Mar', sales: 2000, orders: 180, users: 900 },
        { name: 'Apr', sales: 2780, orders: 200, users: 850 },
        { name: 'May', sales: 1890, orders: 160, users: 700 },
        { name: 'Jun', sales: 2390, orders: 190, users: 950 },
        { name: 'Jul', sales: 3490, orders: 280, users: 1100 }
      ]
    };

    res.json(chartData);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chart data',
      details: error.message
    });
  }
});

// GET /api/analytics/category-data
router.get('/category-data', auth, adminAuth, async (req, res) => {
  try {
    const categoryData = {
      success: true,
      data: [
        { name: 'Electronics', value: 35, color: '#8884d8' },
        { name: 'Fashion', value: 25, color: '#82ca9d' },
        { name: 'Home & Garden', value: 20, color: '#ffc658' },
        { name: 'Books', value: 15, color: '#ff7c7c' },
        { name: 'Sports', value: 5, color: '#8dd1e1' }
      ]
    };

    res.json(categoryData);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category data',
      details: error.message
    });
  }
});

// GET /api/analytics/traffic-sources
router.get('/traffic-sources', auth, adminAuth, async (req, res) => {
  try {
    const trafficData = {
      success: true,
      data: [
        { source: 'Direct', visitors: 2400, percentage: 40 },
        { source: 'Search Engines', visitors: 1800, percentage: 30 },
        { source: 'Social Media', visitors: 900, percentage: 15 },
        { source: 'Referrals', visitors: 600, percentage: 10 },
        { source: 'Email', visitors: 300, percentage: 5 }
      ]
    };

    res.json(trafficData);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch traffic data',
      details: error.message
    });
  }
});

// GET /api/analytics/summary
router.get('/summary', auth, adminAuth, async (req, res) => {
  try {
    const { range = '7d' } = req.query;
    
    const summaryData = {
      success: true,
      data: {
        totalRevenue: 125000,
        totalOrders: 1250,
        totalUsers: 3500,
        revenueGrowth: 15.8,
        ordersGrowth: 12.3,
        usersGrowth: 8.7,
        averageOrderValue: 100,
        conversionRate: 3.2
      }
    };

    res.json(summaryData);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch summary data',
      details: error.message
    });
  }
});

// GET /api/analytics/real-time
router.get('/real-time', auth, adminAuth, async (req, res) => {
  try {
    const realTimeData = {
      success: true,
      data: {
        revenueToday: 3500,
        ordersToday: 28,
        activeUsers: 45,
        onlineNow: 12,
        topProducts: [
          { name: 'Wireless Headphones', sales: 15 },
          { name: 'Smart Watch', sales: 12 },
          { name: 'Laptop Stand', sales: 8 }
        ]
      }
    };

    res.json(realTimeData);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch real-time data',
      details: error.message
    });
  }
});

module.exports = router;