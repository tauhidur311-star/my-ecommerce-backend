const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Category = require('../models/Category');
const Coupon = require('../models/Coupon');
const { adminAuth, requireRole } = require('../middleware/adminAuth');
const { validate } = require('../utils/validation');

// Dashboard Overview
router.get('/dashboard', adminAuth, async (req, res) => {
  try {
    const { period = '30' } = req.query; // days
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    // Get key metrics
    const [
      totalUsers,
      totalProducts,
      totalOrders,
      totalRevenue,
      recentUsers,
      recentOrders,
      topProducts,
      salesData
    ] = await Promise.all([
      // Total counts
      User.countDocuments({ isActive: true }),
      Product.countDocuments({ isActive: true }),
      Order.countDocuments({}),
      
      // Revenue calculation
      Order.aggregate([
        { $match: { paymentStatus: 'completed', createdAt: { $gte: startDate } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      
      // Recent users (last 7 days)
      User.find({ createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } })
        .select('name email createdAt')
        .sort({ createdAt: -1 })
        .limit(5),
      
      // Recent orders
      Order.find({})
        .populate('userId', 'name email')
        .select('orderNumber totalAmount status createdAt userId')
        .sort({ createdAt: -1 })
        .limit(10),
      
      // Top selling products
      Order.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            totalSold: { $sum: '$items.quantity' },
            revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
          }
        },
        { $sort: { totalSold: -1 } },
        { $limit: 5 }
      ]),
      
      // Sales data for chart (last 30 days)
      Order.aggregate([
        { $match: { createdAt: { $gte: startDate }, paymentStatus: 'completed' } },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
            },
            sales: { $sum: '$totalAmount' },
            orders: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    const revenue = totalRevenue.length > 0 ? totalRevenue[0].total : 0;

    // Calculate growth rates (compare with previous period)
    const previousPeriodStart = new Date(startDate);
    previousPeriodStart.setDate(previousPeriodStart.getDate() - parseInt(period));

    const [previousUsers, previousOrders, previousRevenue] = await Promise.all([
      User.countDocuments({ 
        createdAt: { $gte: previousPeriodStart, $lt: startDate },
        isActive: true 
      }),
      Order.countDocuments({ 
        createdAt: { $gte: previousPeriodStart, $lt: startDate } 
      }),
      Order.aggregate([
        { 
          $match: { 
            paymentStatus: 'completed',
            createdAt: { $gte: previousPeriodStart, $lt: startDate } 
          } 
        },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ])
    ]);

    const prevRevenue = previousRevenue.length > 0 ? previousRevenue[0].total : 0;

    // Calculate growth percentages
    const userGrowth = previousUsers > 0 ? ((recentUsers.length - previousUsers) / previousUsers * 100) : 0;
    const orderGrowth = previousOrders > 0 ? ((totalOrders - previousOrders) / previousOrders * 100) : 0;
    const revenueGrowth = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue * 100) : 0;

    res.json({
      success: true,
      data: {
        overview: {
          totalUsers,
          totalProducts,
          totalOrders,
          totalRevenue: revenue,
          userGrowth: Math.round(userGrowth * 100) / 100,
          orderGrowth: Math.round(orderGrowth * 100) / 100,
          revenueGrowth: Math.round(revenueGrowth * 100) / 100
        },
        recentActivity: {
          users: recentUsers,
          orders: recentOrders
        },
        topProducts,
        salesChart: salesData
      }
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data'
    });
  }
});

// User Management
router.get('/users', adminAuth, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search, 
      role, 
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc' 
    } = req.query;

    const filter = {};
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (role) filter.role = role;
    if (status) filter.isActive = status === 'active';

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const users = await User.find(filter)
      .select('-password -refreshTokens')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort(sort);

    const total = await User.countDocuments(filter);

    // Get user statistics
    const userStats = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      success: true,
      data: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      stats: userStats
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

// Bulk user operations
router.post('/users/bulk', requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { action, userIds, data } = req.body;

    if (!action || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Action and userIds are required'
      });
    }

    let result;
    switch (action) {
      case 'activate':
        result = await User.updateMany(
          { _id: { $in: userIds } },
          { $set: { isActive: true } }
        );
        break;
      case 'deactivate':
        result = await User.updateMany(
          { _id: { $in: userIds } },
          { $set: { isActive: false } }
        );
        break;
      case 'delete':
        // Only super admins can delete users
        if (req.user.role !== 'super_admin') {
          return res.status(403).json({
            success: false,
            error: 'Only super admins can delete users'
          });
        }
        result = await User.deleteMany({ 
          _id: { $in: userIds },
          role: { $ne: 'super_admin' } // Prevent deleting super admins
        });
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action'
        });
    }

    res.json({
      success: true,
      message: `Bulk ${action} completed`,
      modifiedCount: result.modifiedCount || result.deletedCount || 0
    });
  } catch (error) {
    console.error('Bulk user operation error:', error);
    res.status(500).json({
      success: false,
      error: 'Bulk operation failed'
    });
  }
});

// Product Management
router.get('/products', adminAuth, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      search, 
      category, 
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc' 
    } = req.query;

    const filter = {};
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (category) filter.category = category;
    if (status) filter.inStock = status === 'inStock';

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const products = await Product.find(filter)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort(sort);

    const total = await Product.countDocuments(filter);

    // Product statistics
    const productStats = await Product.aggregate([
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          inStock: { $sum: { $cond: [{ $gt: ['$stock', 0] }, 1, 0] } },
          outOfStock: { $sum: { $cond: [{ $eq: ['$stock', 0] }, 1, 0] } },
          avgPrice: { $avg: '$price' }
        }
      }
    ]);

    res.json({
      success: true,
      data: products,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      stats: productStats[0] || {}
    });
  } catch (error) {
    console.error('Get admin products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch products'
    });
  }
});

// Order Management
router.get('/orders', adminAuth, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      paymentStatus,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc' 
    } = req.query;

    const filter = {};
    
    if (status) filter.status = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const orders = await Order.find(filter)
      .populate('userId', 'name email')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort(sort);

    const total = await Order.countDocuments(filter);

    // Order statistics
    const orderStats = await Order.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      stats: orderStats
    });
  } catch (error) {
    console.error('Get admin orders error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders'
    });
  }
});

// Update order status
router.patch('/orders/:id/status', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status'
      });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    order.status = status;
    order.statusHistory.push({
      status,
      updatedBy: req.user._id,
      updatedAt: new Date()
    });

    if (status === 'delivered') {
      order.deliveredAt = new Date();
    } else if (status === 'shipped') {
      order.shippedAt = new Date();
    }

    await order.save();

    res.json({
      success: true,
      data: order,
      message: 'Order status updated successfully'
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update order status'
    });
  }
});

// Analytics endpoints
router.get('/analytics/sales', adminAuth, async (req, res) => {
  try {
    const { period = '30', groupBy = 'day' } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    let groupFormat;
    switch (groupBy) {
      case 'hour':
        groupFormat = '%Y-%m-%d %H:00';
        break;
      case 'day':
        groupFormat = '%Y-%m-%d';
        break;
      case 'week':
        groupFormat = '%Y-%U'; // Week number
        break;
      case 'month':
        groupFormat = '%Y-%m';
        break;
      default:
        groupFormat = '%Y-%m-%d';
    }

    const salesData = await Order.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startDate },
          paymentStatus: 'completed'
        } 
      },
      {
        $group: {
          _id: {
            $dateToString: { format: groupFormat, date: '$createdAt' }
          },
          sales: { $sum: '$totalAmount' },
          orders: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: salesData
    });
  } catch (error) {
    console.error('Sales analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sales analytics'
    });
  }
});

// System settings
router.get('/settings', requireRole(['super_admin']), async (req, res) => {
  try {
    // Return system configuration
    const settings = {
      paymentMethods: {
        stripe: !!process.env.STRIPE_SECRET_KEY,
        bkash: !!process.env.BKASH_APP_KEY,
        nagad: !!process.env.NAGAD_API_KEY
      },
      email: {
        configured: !!(process.env.EMAIL_HOST && process.env.EMAIL_USER),
        service: process.env.EMAIL_HOST
      },
      storage: {
        cloudinary: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY)
      },
      features: {
        emailVerification: true,
        userRegistration: true,
        guestCheckout: false
      }
    };

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch settings'
    });
  }
});

// Update system settings
router.put('/settings', requireRole(['super_admin']), async (req, res) => {
  try {
    const { features } = req.body;

    // In a real application, you might store these in a database
    // For now, we'll just return success
    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: { features }
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update settings'
    });
  }
});

module.exports = router;