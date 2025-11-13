const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const VisitorEvent = require('../models/VisitorEvent');
const EmailCampaign = require('../models/EmailCampaign');

class EnhancedAnalyticsController {
  // Get comprehensive analytics summary
  async getSummary(req, res) {
    try {
      const { range = '7d' } = req.query;
      const dateRange = this.getDateRange(range);
      
      const [
        currentPeriodData,
        previousPeriodData,
        realTimeMetrics
      ] = await Promise.all([
        this.getPeriodData(dateRange.current.start, dateRange.current.end),
        this.getPeriodData(dateRange.previous.start, dateRange.previous.end),
        this.getRealTimeMetrics()
      ]);

      const summary = {
        totalRevenue: currentPeriodData.revenue,
        revenueGrowth: this.calculateGrowth(currentPeriodData.revenue, previousPeriodData.revenue),
        totalOrders: currentPeriodData.orders,
        ordersGrowth: this.calculateGrowth(currentPeriodData.orders, previousPeriodData.orders),
        totalCustomers: currentPeriodData.customers,
        customersGrowth: this.calculateGrowth(currentPeriodData.customers, previousPeriodData.customers),
        conversionRate: currentPeriodData.conversionRate,
        conversionGrowth: this.calculateGrowth(currentPeriodData.conversionRate, previousPeriodData.conversionRate),
        avgOrderValue: currentPeriodData.avgOrderValue,
        customerLifetimeValue: currentPeriodData.lifetimeValue
      };

      res.json({
        success: true,
        data: {
          ...summary,
          realTimeMetrics
        }
      });
    } catch (error) {
      console.error('Analytics summary error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch analytics summary',
        error: error.message 
      });
    }
  }

  // Get sales analytics with trend data
  async getSalesAnalytics(req, res) {
    try {
      const { range = '7d' } = req.query;
      const dateRange = this.getDateRange(range);

      const salesData = await Order.aggregate([
        {
          $match: {
            createdAt: { 
              $gte: dateRange.current.start, 
              $lte: dateRange.current.end 
            },
            status: { $in: ['completed', 'shipped', 'delivered'] }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: this.getGroupFormat(range),
                date: '$createdAt'
              }
            },
            revenue: { $sum: '$total' },
            orders: { $sum: 1 },
            avgOrderValue: { $avg: '$total' }
          }
        },
        { $sort: { '_id': 1 } }
      ]);

      const chartData = salesData.map(item => ({
        date: item._id,
        revenue: item.revenue,
        orders: item.orders,
        avgOrderValue: Math.round(item.avgOrderValue)
      }));

      // Get top performing products
      const topProducts = await Order.aggregate([
        {
          $match: {
            createdAt: { 
              $gte: dateRange.current.start, 
              $lte: dateRange.current.end 
            },
            status: { $in: ['completed', 'shipped', 'delivered'] }
          }
        },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
            quantity: { $sum: '$items.quantity' },
            orders: { $sum: 1 }
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
            revenue: 1,
            quantity: 1,
            orders: 1
          }
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 }
      ]);

      res.json({
        success: true,
        data: {
          chartData,
          topProducts,
          totalRevenue: salesData.reduce((sum, item) => sum + item.revenue, 0),
          totalOrders: salesData.reduce((sum, item) => sum + item.orders, 0)
        }
      });
    } catch (error) {
      console.error('Sales analytics error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch sales analytics',
        error: error.message 
      });
    }
  }

  // Get customer analytics and segmentation data
  async getCustomerAnalytics(req, res) {
    try {
      const { range = '7d' } = req.query;
      const dateRange = this.getDateRange(range);

      // Customer acquisition data
      const acquisitionData = await User.aggregate([
        {
          $match: {
            createdAt: { 
              $gte: dateRange.current.start, 
              $lte: dateRange.current.end 
            }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: this.getGroupFormat(range),
                date: '$createdAt'
              }
            },
            newCustomers: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);

      // Customer segments
      const segments = await this.calculateCustomerSegments();

      // Customer lifetime value analysis
      const lifetimeValueData = await Order.aggregate([
        {
          $match: {
            status: { $in: ['completed', 'shipped', 'delivered'] }
          }
        },
        {
          $group: {
            _id: '$userId',
            totalSpent: { $sum: '$total' },
            orderCount: { $sum: 1 },
            firstOrder: { $min: '$createdAt' },
            lastOrder: { $max: '$createdAt' }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' },
        {
          $project: {
            name: '$user.name',
            email: '$user.email',
            totalSpent: 1,
            orderCount: 1,
            avgOrderValue: { $divide: ['$totalSpent', '$orderCount'] },
            daysSinceFirstOrder: {
              $divide: [
                { $subtract: [new Date(), '$firstOrder'] },
                1000 * 60 * 60 * 24
              ]
            }
          }
        },
        { $sort: { totalSpent: -1 } },
        { $limit: 100 }
      ]);

      res.json({
        success: true,
        data: {
          acquisition: acquisitionData.map(item => ({
            date: item._id,
            newCustomers: item.newCustomers
          })),
          segments,
          lifetimeValue: lifetimeValueData,
          averageLifetimeValue: lifetimeValueData.reduce((sum, customer) => sum + customer.totalSpent, 0) / lifetimeValueData.length
        }
      });
    } catch (error) {
      console.error('Customer analytics error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch customer analytics',
        error: error.message 
      });
    }
  }

  // Get product performance analytics
  async getProductAnalytics(req, res) {
    try {
      const { range = '7d' } = req.query;
      const dateRange = this.getDateRange(range);

      // Product performance data
      const productPerformance = await Order.aggregate([
        {
          $match: {
            createdAt: { 
              $gte: dateRange.current.start, 
              $lte: dateRange.current.end 
            },
            status: { $in: ['completed', 'shipped', 'delivered'] }
          }
        },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
            quantity: { $sum: '$items.quantity' },
            orders: { $sum: 1 }
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
            category: '$product.category',
            revenue: 1,
            quantity: 1,
            orders: 1,
            avgOrderValue: { $divide: ['$revenue', '$orders'] }
          }
        },
        { $sort: { revenue: -1 } }
      ]);

      // Category performance
      const categoryPerformance = await Order.aggregate([
        {
          $match: {
            createdAt: { 
              $gte: dateRange.current.start, 
              $lte: dateRange.current.end 
            },
            status: { $in: ['completed', 'shipped', 'delivered'] }
          }
        },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            localField: 'items.productId',
            foreignField: '_id',
            as: 'product'
          }
        },
        { $unwind: '$product' },
        {
          $group: {
            _id: '$product.category',
            revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
            quantity: { $sum: '$items.quantity' },
            orders: { $sum: 1 }
          }
        },
        { $sort: { revenue: -1 } }
      ]);

      res.json({
        success: true,
        data: {
          topProducts: productPerformance.slice(0, 20),
          categoryPerformance: categoryPerformance.map(cat => ({
            category: cat._id,
            revenue: cat.revenue,
            quantity: cat.quantity,
            orders: cat.orders
          }))
        }
      });
    } catch (error) {
      console.error('Product analytics error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch product analytics',
        error: error.message 
      });
    }
  }

  // Get geographic analytics
  async getGeographicAnalytics(req, res) {
    try {
      const { range = '7d' } = req.query;
      const dateRange = this.getDateRange(range);

      const geoData = await Order.aggregate([
        {
          $match: {
            createdAt: { 
              $gte: dateRange.current.start, 
              $lte: dateRange.current.end 
            },
            status: { $in: ['completed', 'shipped', 'delivered'] }
          }
        },
        {
          $group: {
            _id: {
              city: '$shippingAddress.city',
              state: '$shippingAddress.state',
              country: '$shippingAddress.country'
            },
            revenue: { $sum: '$total' },
            orders: { $sum: 1 },
            customers: { $addToSet: '$userId' }
          }
        },
        {
          $project: {
            location: {
              $concat: ['$_id.city', ', ', '$_id.state', ', ', '$_id.country']
            },
            revenue: 1,
            orders: 1,
            customers: { $size: '$customers' }
          }
        },
        { $sort: { revenue: -1 } },
        { $limit: 50 }
      ]);

      res.json({
        success: true,
        data: {
          locations: geoData
        }
      });
    } catch (error) {
      console.error('Geographic analytics error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch geographic analytics',
        error: error.message 
      });
    }
  }

  // Helper methods
  getDateRange(range) {
    const now = new Date();
    let current, previous;

    switch (range) {
      case '7d':
        current = {
          start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          end: now
        };
        previous = {
          start: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
          end: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        };
        break;
      case '30d':
        current = {
          start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
          end: now
        };
        previous = {
          start: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
          end: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        };
        break;
      case '90d':
        current = {
          start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
          end: now
        };
        previous = {
          start: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000),
          end: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        };
        break;
      case '1y':
        current = {
          start: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
          end: now
        };
        previous = {
          start: new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000),
          end: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        };
        break;
      default:
        current = {
          start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          end: now
        };
        previous = {
          start: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000),
          end: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        };
    }

    return { current, previous };
  }

  getGroupFormat(range) {
    switch (range) {
      case '7d':
      case '30d':
        return '%Y-%m-%d';
      case '90d':
      case '1y':
        return '%Y-%m';
      default:
        return '%Y-%m-%d';
    }
  }

  async getPeriodData(startDate, endDate) {
    const orders = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          status: { $in: ['completed', 'shipped', 'delivered'] }
        }
      },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
          avgOrderValue: { $avg: '$total' },
          customers: { $addToSet: '$userId' }
        }
      }
    ]);

    const visitors = await VisitorEvent.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalVisitors: { $addToSet: '$sessionId' }
        }
      }
    ]);

    const orderData = orders[0] || { revenue: 0, orders: 0, avgOrderValue: 0, customers: [] };
    const visitorData = visitors[0] || { totalVisitors: [] };

    return {
      revenue: orderData.revenue,
      orders: orderData.orders,
      avgOrderValue: orderData.avgOrderValue,
      customers: orderData.customers.length,
      conversionRate: visitorData.totalVisitors.length > 0 ? 
        (orderData.orders / visitorData.totalVisitors.length * 100) : 0,
      lifetimeValue: orderData.revenue / (orderData.customers.length || 1)
    };
  }

  async getRealTimeMetrics() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [todayOrders, activeSessions] = await Promise.all([
      Order.aggregate([
        {
          $match: {
            createdAt: { $gte: today },
            status: { $in: ['completed', 'shipped', 'delivered'] }
          }
        },
        {
          $group: {
            _id: null,
            revenue: { $sum: '$total' },
            orders: { $sum: 1 }
          }
        }
      ]),
      VisitorEvent.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) } // Last 30 minutes
          }
        },
        {
          $group: {
            _id: null,
            sessions: { $addToSet: '$sessionId' }
          }
        }
      ])
    ]);

    const todayData = todayOrders[0] || { revenue: 0, orders: 0 };
    const sessionData = activeSessions[0] || { sessions: [] };

    return {
      activeSessions: sessionData.sessions.length,
      revenueToday: todayData.revenue,
      ordersToday: todayData.orders,
      conversionRate: 0 // Calculate based on your conversion logic
    };
  }

  calculateGrowth(current, previous) {
    if (!previous || previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  }

  async calculateCustomerSegments() {
    const segments = await Order.aggregate([
      {
        $match: {
          status: { $in: ['completed', 'shipped', 'delivered'] }
        }
      },
      {
        $group: {
          _id: '$userId',
          totalSpent: { $sum: '$total' },
          orderCount: { $sum: 1 },
          lastOrder: { $max: '$createdAt' }
        }
      },
      {
        $project: {
          segment: {
            $switch: {
              branches: [
                { case: { $gte: ['$totalSpent', 50000] }, then: 'VIP' },
                { case: { $and: [{ $gte: ['$totalSpent', 20000] }, { $gte: ['$orderCount', 5] }] }, then: 'Premium' },
                { case: { $gte: ['$orderCount', 3] }, then: 'Loyal' },
                { case: { $lt: [{ $subtract: [new Date(), '$lastOrder'] }, 90 * 24 * 60 * 60 * 1000] }, then: 'At Risk' }
              ],
              default: 'Regular'
            }
          }
        }
      },
      {
        $group: {
          _id: '$segment',
          count: { $sum: 1 }
        }
      }
    ]);

    return segments.map(seg => ({
      name: seg._id,
      count: seg.count
    }));
  }
}

module.exports = new EnhancedAnalyticsController();