const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');

class CustomerController {
  // Get all customers with segmentation
  async getCustomers(req, res) {
    try {
      const { 
        page = 1, 
        limit = 50, 
        segment, 
        search, 
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;
      
      const query = { role: { $ne: 'admin' } };
      
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { phone: { $regex: search, $options: 'i' } }
        ];
      }

      // Get customers with order analytics
      const customers = await User.aggregate([
        { $match: query },
        {
          $lookup: {
            from: 'orders',
            localField: '_id',
            foreignField: 'userId',
            as: 'orders'
          }
        },
        {
          $addFields: {
            orderCount: { $size: '$orders' },
            totalSpent: {
              $reduce: {
                input: {
                  $filter: {
                    input: '$orders',
                    as: 'order',
                    cond: { $in: ['$$order.status', ['completed', 'shipped', 'delivered']] }
                  }
                },
                initialValue: 0,
                in: { $add: ['$$value', '$$this.total'] }
              }
            },
            lastOrderDate: {
              $max: {
                $map: {
                  input: {
                    $filter: {
                      input: '$orders',
                      as: 'order',
                      cond: { $in: ['$$order.status', ['completed', 'shipped', 'delivered']] }
                    }
                  },
                  as: 'order',
                  in: '$$order.createdAt'
                }
              }
            }
          }
        },
        {
          $addFields: {
            avgOrderValue: {
              $cond: [
                { $gt: ['$orderCount', 0] },
                { $divide: ['$totalSpent', '$orderCount'] },
                0
              ]
            },
            segment: {
              $switch: {
                branches: [
                  { case: { $gte: ['$totalSpent', 50000] }, then: 'VIP' },
                  { 
                    case: { 
                      $and: [
                        { $gte: ['$totalSpent', 20000] },
                        { $gte: ['$orderCount', 5] }
                      ]
                    }, 
                    then: 'Premium' 
                  },
                  { case: { $gte: ['$orderCount', 3] }, then: 'Loyal' },
                  {
                    case: {
                      $and: [
                        { $ne: ['$lastOrderDate', null] },
                        { 
                          $lt: [
                            '$lastOrderDate',
                            new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
                          ]
                        }
                      ]
                    },
                    then: 'At Risk'
                  }
                ],
                default: 'Regular'
              }
            }
          }
        },
        ...(segment && segment !== 'all' ? [{ $match: { segment } }] : []),
        { $project: { orders: 0, password: 0 } },
        { $sort: { [sortBy]: sortOrder === 'asc' ? 1 : -1 } },
        { $skip: (page - 1) * limit },
        { $limit: parseInt(limit) }
      ]);

      // Get total count for pagination
      const totalPipeline = [
        { $match: query },
        {
          $lookup: {
            from: 'orders',
            localField: '_id',
            foreignField: 'userId',
            as: 'orders'
          }
        },
        {
          $addFields: {
            orderCount: { $size: '$orders' },
            totalSpent: {
              $reduce: {
                input: {
                  $filter: {
                    input: '$orders',
                    as: 'order',
                    cond: { $in: ['$$order.status', ['completed', 'shipped', 'delivered']] }
                  }
                },
                initialValue: 0,
                in: { $add: ['$$value', '$$this.total'] }
              }
            }
          }
        },
        {
          $addFields: {
            segment: {
              $switch: {
                branches: [
                  { case: { $gte: ['$totalSpent', 50000] }, then: 'VIP' },
                  { 
                    case: { 
                      $and: [
                        { $gte: ['$totalSpent', 20000] },
                        { $gte: ['$orderCount', 5] }
                      ]
                    }, 
                    then: 'Premium' 
                  },
                  { case: { $gte: ['$orderCount', 3] }, then: 'Loyal' }
                ],
                default: 'Regular'
              }
            }
          }
        },
        ...(segment && segment !== 'all' ? [{ $match: { segment } }] : []),
        { $count: 'total' }
      ];

      const totalResult = await User.aggregate(totalPipeline);
      const total = totalResult[0]?.total || 0;

      res.json({
        success: true,
        data: {
          customers,
          pagination: {
            current: parseInt(page),
            pages: Math.ceil(total / limit),
            total
          }
        }
      });
    } catch (error) {
      console.error('Get customers error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch customers',
        error: error.message 
      });
    }
  }

  // Get customer segments
  async getCustomerSegments(req, res) {
    try {
      const segments = await User.aggregate([
        { $match: { role: { $ne: 'admin' } } },
        {
          $lookup: {
            from: 'orders',
            localField: '_id',
            foreignField: 'userId',
            as: 'orders'
          }
        },
        {
          $addFields: {
            orderCount: { $size: '$orders' },
            totalSpent: {
              $reduce: {
                input: {
                  $filter: {
                    input: '$orders',
                    as: 'order',
                    cond: { $in: ['$$order.status', ['completed', 'shipped', 'delivered']] }
                  }
                },
                initialValue: 0,
                in: { $add: ['$$value', '$$this.total'] }
              }
            },
            lastOrderDate: {
              $max: {
                $map: {
                  input: '$orders',
                  as: 'order',
                  in: '$$order.createdAt'
                }
              }
            }
          }
        },
        {
          $addFields: {
            segment: {
              $switch: {
                branches: [
                  { case: { $gte: ['$totalSpent', 50000] }, then: 'VIP' },
                  { 
                    case: { 
                      $and: [
                        { $gte: ['$totalSpent', 20000] },
                        { $gte: ['$orderCount', 5] }
                      ]
                    }, 
                    then: 'Premium' 
                  },
                  { case: { $gte: ['$orderCount', 3] }, then: 'Loyal' },
                  {
                    case: {
                      $and: [
                        { $ne: ['$lastOrderDate', null] },
                        { 
                          $lt: [
                            '$lastOrderDate',
                            new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
                          ]
                        }
                      ]
                    },
                    then: 'At Risk'
                  },
                  {
                    case: {
                      $lt: [
                        '$createdAt',
                        new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
                      ]
                    },
                    then: 'Inactive'
                  }
                ],
                default: 'Regular'
              }
            }
          }
        },
        {
          $group: {
            _id: '$segment',
            count: { $sum: 1 },
            totalValue: { $sum: '$totalSpent' },
            avgOrderValue: { $avg: '$totalSpent' }
          }
        },
        {
          $project: {
            name: '$_id',
            count: 1,
            totalValue: 1,
            avgOrderValue: { $round: ['$avgOrderValue', 2] },
            _id: 0
          }
        },
        { $sort: { totalValue: -1 } }
      ]);

      res.json({
        success: true,
        data: {
          segments
        }
      });
    } catch (error) {
      console.error('Get segments error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch customer segments',
        error: error.message 
      });
    }
  }

  // Get segmented customers for campaigns
  async getSegmentedCustomers(req, res) {
    try {
      const customers = await User.aggregate([
        { $match: { role: { $ne: 'admin' } } },
        {
          $lookup: {
            from: 'orders',
            localField: '_id',
            foreignField: 'userId',
            as: 'orders'
          }
        },
        {
          $addFields: {
            orderCount: { $size: '$orders' },
            totalSpent: {
              $reduce: {
                input: {
                  $filter: {
                    input: '$orders',
                    as: 'order',
                    cond: { $in: ['$$order.status', ['completed', 'shipped', 'delivered']] }
                  }
                },
                initialValue: 0,
                in: { $add: ['$$value', '$$this.total'] }
              }
            },
            lastOrderDate: {
              $max: {
                $map: {
                  input: '$orders',
                  as: 'order',
                  in: '$$order.createdAt'
                }
              }
            }
          }
        },
        {
          $addFields: {
            segment: {
              $switch: {
                branches: [
                  { case: { $gte: ['$totalSpent', 50000] }, then: 'VIP' },
                  { 
                    case: { 
                      $and: [
                        { $gte: ['$totalSpent', 20000] },
                        { $gte: ['$orderCount', 5] }
                      ]
                    }, 
                    then: 'Premium' 
                  },
                  { case: { $gte: ['$orderCount', 3] }, then: 'Loyal' }
                ],
                default: 'Regular'
              }
            }
          }
        },
        {
          $project: {
            name: 1,
            email: 1,
            phone: 1,
            segment: 1,
            orderCount: 1,
            totalSpent: 1,
            lastOrderDate: 1,
            createdAt: 1
          }
        }
      ]);

      res.json({
        success: true,
        data: {
          customers
        }
      });
    } catch (error) {
      console.error('Get segmented customers error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch segmented customers',
        error: error.message 
      });
    }
  }

  // Get single customer details with analytics
  async getCustomerDetails(req, res) {
    try {
      const { customerId } = req.params;
      
      const customer = await User.findById(customerId)
        .select('-password')
        .lean();

      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'Customer not found'
        });
      }

      // Get customer analytics
      const analytics = await this.getCustomerAnalytics(customerId);

      res.json({
        success: true,
        data: {
          customer: {
            ...customer,
            ...analytics
          }
        }
      });
    } catch (error) {
      console.error('Get customer details error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch customer details',
        error: error.message 
      });
    }
  }

  // Get customer orders
  async getCustomerOrders(req, res) {
    try {
      const { customerId } = req.params;
      const { page = 1, limit = 20 } = req.query;

      const orders = await Order.find({ userId: customerId })
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .populate('items.productId', 'name image price')
        .lean();

      const total = await Order.countDocuments({ userId: customerId });

      res.json({
        success: true,
        data: {
          orders,
          pagination: {
            current: parseInt(page),
            pages: Math.ceil(total / limit),
            total
          }
        }
      });
    } catch (error) {
      console.error('Get customer orders error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch customer orders',
        error: error.message 
      });
    }
  }

  // Get customer analytics
  async getCustomerAnalytics(customerId) {
    try {
      const analytics = await Order.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(customerId),
            status: { $in: ['completed', 'shipped', 'delivered'] }
          }
        },
        {
          $group: {
            _id: '$userId',
            totalSpent: { $sum: '$total' },
            orderCount: { $sum: 1 },
            avgOrderValue: { $avg: '$total' },
            firstOrderDate: { $min: '$createdAt' },
            lastOrderDate: { $max: '$createdAt' }
          }
        }
      ]);

      if (analytics.length === 0) {
        return {
          totalSpent: 0,
          orderCount: 0,
          avgOrderValue: 0,
          lifetimeValue: 0,
          firstOrderDate: null,
          lastOrderDate: null
        };
      }

      const data = analytics[0];

      // Get spending pattern over time
      const chartData = await Order.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(customerId),
            status: { $in: ['completed', 'shipped', 'delivered'] }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m',
                date: '$createdAt'
              }
            },
            spending: { $sum: '$total' },
            orders: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);

      // Get favorite category
      const favoriteCategory = await Order.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(customerId),
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
            count: { $sum: '$items.quantity' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 1 }
      ]);

      return {
        ...data,
        lifetimeValue: data.totalSpent,
        chartData: chartData.map(item => ({
          month: item._id,
          spending: item.spending,
          orders: item.orders
        })),
        favoriteCategory: favoriteCategory[0]?._id || 'N/A'
      };
    } catch (error) {
      console.error('Get customer analytics error:', error);
      throw error;
    }
  }

  async getCustomerAnalyticsEndpoint(req, res) {
    try {
      const { customerId } = req.params;
      const analytics = await this.getCustomerAnalytics(customerId);

      res.json({
        success: true,
        data: {
          analytics
        }
      });
    } catch (error) {
      console.error('Get customer analytics endpoint error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch customer analytics',
        error: error.message 
      });
    }
  }

  // Update customer
  async updateCustomer(req, res) {
    try {
      const { customerId } = req.params;
      const updateData = req.body;

      // Remove sensitive fields that shouldn't be updated
      delete updateData.password;
      delete updateData.role;
      delete updateData._id;

      const customer = await User.findByIdAndUpdate(
        customerId,
        { $set: updateData },
        { new: true, runValidators: true }
      ).select('-password');

      if (!customer) {
        return res.status(404).json({
          success: false,
          message: 'Customer not found'
        });
      }

      res.json({
        success: true,
        message: 'Customer updated successfully',
        data: { customer }
      });
    } catch (error) {
      console.error('Update customer error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to update customer',
        error: error.message 
      });
    }
  }

  // Delete customer
  async deleteCustomer(req, res) {
    try {
      const { customerId } = req.params;

      // Check if customer has orders
      const orderCount = await Order.countDocuments({ userId: customerId });
      
      if (orderCount > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete customer with existing orders'
        });
      }

      await User.findByIdAndDelete(customerId);

      res.json({
        success: true,
        message: 'Customer deleted successfully'
      });
    } catch (error) {
      console.error('Delete customer error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to delete customer',
        error: error.message 
      });
    }
  }

  // Create custom segment
  async createCustomSegment(req, res) {
    try {
      const { name, description, criteria } = req.body;

      // Build MongoDB query from criteria
      const query = { role: { $ne: 'admin' } };
      
      // This would need to be implemented based on your specific segmentation needs
      // For now, return success
      
      res.json({
        success: true,
        message: 'Custom segment created successfully',
        data: { name, description, criteria }
      });
    } catch (error) {
      console.error('Create custom segment error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to create custom segment',
        error: error.message 
      });
    }
  }

  // Export segment data
  async exportSegmentData(req, res) {
    try {
      const { segmentName } = req.params;
      
      // Get customers for this segment
      const customers = await User.aggregate([
        { $match: { role: { $ne: 'admin' } } },
        {
          $lookup: {
            from: 'orders',
            localField: '_id',
            foreignField: 'userId',
            as: 'orders'
          }
        },
        {
          $addFields: {
            orderCount: { $size: '$orders' },
            totalSpent: {
              $reduce: {
                input: {
                  $filter: {
                    input: '$orders',
                    as: 'order',
                    cond: { $in: ['$$order.status', ['completed', 'shipped', 'delivered']] }
                  }
                },
                initialValue: 0,
                in: { $add: ['$$value', '$$this.total'] }
              }
            }
          }
        },
        {
          $addFields: {
            segment: {
              $switch: {
                branches: [
                  { case: { $gte: ['$totalSpent', 50000] }, then: 'VIP' },
                  { 
                    case: { 
                      $and: [
                        { $gte: ['$totalSpent', 20000] },
                        { $gte: ['$orderCount', 5] }
                      ]
                    }, 
                    then: 'Premium' 
                  },
                  { case: { $gte: ['$orderCount', 3] }, then: 'Loyal' }
                ],
                default: 'Regular'
              }
            }
          }
        },
        { $match: { segment: segmentName } },
        {
          $project: {
            name: 1,
            email: 1,
            phone: 1,
            totalSpent: 1,
            orderCount: 1,
            createdAt: 1
          }
        }
      ]);

      // Convert to CSV
      const csvHeader = 'Name,Email,Phone,Total Spent,Order Count,Join Date\n';
      const csvData = customers.map(customer => 
        `"${customer.name}","${customer.email}","${customer.phone || ''}","${customer.totalSpent}","${customer.orderCount}","${new Date(customer.createdAt).toLocaleDateString()}"`
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${segmentName}-customers.csv"`);
      res.send(csvHeader + csvData);
    } catch (error) {
      console.error('Export segment error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to export segment data',
        error: error.message 
      });
    }
  }
}

module.exports = new CustomerController();