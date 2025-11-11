const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

// GET /api/analytics/overview - Get dashboard overview data
router.get('/overview', auth, async (req, res) => {
  try {
    const { dateRange = '7days' } = req.query;
    const now = new Date();
    let startDate;

    switch (dateRange) {
      case '7days':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30days':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90days':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    // Get basic counts
    const [totalProducts, totalCustomers, totalOrders] = await Promise.all([
      Product.countDocuments(),
      User.countDocuments({ role: 'customer' }),
      Order.countDocuments({ createdAt: { $gte: startDate } })
    ]);

    // Get revenue data
    const revenueData = await Order.aggregate([
      { $match: { createdAt: { $gte: startDate }, status: 'delivered' } },
      { $group: { _id: null, totalRevenue: { $sum: '$total' } } }
    ]);

    const totalRevenue = revenueData.length > 0 ? revenueData[0].totalRevenue : 0;

    // Get stock status
    const [inStockCount, outOfStockCount] = await Promise.all([
      Product.countDocuments({ inStock: true }),
      Product.countDocuments({ inStock: false })
    ]);

    // Get categories count
    const categoriesData = await Product.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);

    const overview = {
      totalRevenue,
      totalOrders,
      totalCustomers,
      totalProducts,
      inStockCount,
      outOfStockCount,
      categoriesCount: categoriesData.length,
      revenueGrowth: await calculateGrowth('revenue', startDate),
      ordersGrowth: await calculateGrowth('orders', startDate),
      customersGrowth: await calculateGrowth('customers', startDate)
    };

    res.json({ success: true, data: overview });
  } catch (error) {
    console.error('Error fetching analytics overview:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
});

// GET /api/analytics/sales-chart - Get sales chart data
router.get('/sales-chart', auth, async (req, res) => {
  try {
    const { dateRange = '7days' } = req.query;
    const now = new Date();
    let startDate, groupBy;

    switch (dateRange) {
      case '7days':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        groupBy = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
        break;
      case '30days':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        groupBy = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
        break;
      case '90days':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        groupBy = { $dateToString: { format: "%Y-%m", date: "$createdAt" } };
        break;
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        groupBy = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };
    }

    const salesData = await Order.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startDate },
          status: { $ne: 'cancelled' }
        } 
      },
      {
        $group: {
          _id: groupBy,
          revenue: { $sum: '$total' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({ success: true, data: salesData });
  } catch (error) {
    console.error('Error fetching sales chart data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch sales data' });
  }
});

// GET /api/analytics/top-products - Get top selling products
router.get('/top-products', auth, async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    const topProducts = await Order.aggregate([
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          totalSales: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          name: '$product.name',
          sales: '$totalSales',
          revenue: '$totalRevenue'
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: parseInt(limit) }
    ]);

    res.json({ success: true, data: topProducts });
  } catch (error) {
    console.error('Error fetching top products:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch top products' });
  }
});

// GET /api/analytics/customer-segments - Get customer segmentation data
router.get('/customer-segments', auth, async (req, res) => {
  try {
    const newCustomers = await User.countDocuments({
      role: 'customer',
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    });

    const returningCustomers = await Order.aggregate([
      { $group: { _id: '$customerId', orderCount: { $sum: 1 } } },
      { $match: { orderCount: { $gt: 1 } } },
      { $count: 'total' }
    ]);

    const vipCustomers = await Order.aggregate([
      { $group: { _id: '$customerId', totalSpent: { $sum: '$total' } } },
      { $match: { totalSpent: { $gte: 10000 } } },
      { $count: 'total' }
    ]);

    const inactiveCustomers = await User.countDocuments({
      role: 'customer',
      lastLoginAt: { $lt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) }
    });

    const segments = [
      { segment: 'New Customers', count: newCustomers, color: 'bg-blue-500' },
      { 
        segment: 'Returning Customers', 
        count: returningCustomers.length > 0 ? returningCustomers[0].total : 0,
        color: 'bg-green-500' 
      },
      { 
        segment: 'VIP Customers', 
        count: vipCustomers.length > 0 ? vipCustomers[0].total : 0,
        color: 'bg-purple-500' 
      },
      { segment: 'Inactive Customers', count: inactiveCustomers, color: 'bg-gray-400' }
    ];

    res.json({ success: true, data: segments });
  } catch (error) {
    console.error('Error fetching customer segments:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch customer segments' });
  }
});

// Helper function to calculate growth percentage
async function calculateGrowth(metric, startDate) {
  const previousPeriod = new Date(startDate.getTime() - (Date.now() - startDate.getTime()));
  
  let currentValue, previousValue;

  switch (metric) {
    case 'revenue':
      const currentRevenue = await Order.aggregate([
        { $match: { createdAt: { $gte: startDate }, status: 'delivered' } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]);
      const previousRevenue = await Order.aggregate([
        { $match: { 
          createdAt: { $gte: previousPeriod, $lt: startDate }, 
          status: 'delivered' 
        } },
        { $group: { _id: null, total: { $sum: '$total' } } }
      ]);
      currentValue = currentRevenue.length > 0 ? currentRevenue[0].total : 0;
      previousValue = previousRevenue.length > 0 ? previousRevenue[0].total : 0;
      break;

    case 'orders':
      currentValue = await Order.countDocuments({ createdAt: { $gte: startDate } });
      previousValue = await Order.countDocuments({ 
        createdAt: { $gte: previousPeriod, $lt: startDate } 
      });
      break;

    case 'customers':
      currentValue = await User.countDocuments({ 
        role: 'customer',
        createdAt: { $gte: startDate } 
      });
      previousValue = await User.countDocuments({ 
        role: 'customer',
        createdAt: { $gte: previousPeriod, $lt: startDate } 
      });
      break;

    default:
      return 0;
  }

  if (previousValue === 0) return currentValue > 0 ? 100 : 0;
  return ((currentValue - previousValue) / previousValue * 100).toFixed(1);
}

module.exports = router;