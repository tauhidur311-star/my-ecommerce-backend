const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');
const emailService = require('../utils/emailService');

class InventoryController {
  // Get inventory overview
  async getInventory(req, res) {
    try {
      const { page = 1, limit = 50, category, status, search } = req.query;
      
      const query = {};
      
      if (category && category !== 'all') {
        query.category = category;
      }
      
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { sku: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ];
      }

      if (status) {
        switch (status) {
          case 'low-stock':
            query.$expr = { $lte: ['$stock', '$lowStockThreshold'] };
            break;
          case 'out-of-stock':
            query.stock = 0;
            break;
          case 'in-stock':
            query.$expr = { $gt: ['$stock', '$lowStockThreshold'] };
            break;
        }
      }

      const products = await Product.find(query)
        .sort({ updatedAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .populate('supplier', 'name contactInfo')
        .exec();

      const total = await Product.countDocuments(query);

      // Calculate inventory metrics
      const metrics = await this.calculateInventoryMetrics();

      res.json({
        success: true,
        data: {
          products,
          pagination: {
            current: page,
            pages: Math.ceil(total / limit),
            total
          },
          metrics
        }
      });
    } catch (error) {
      console.error('Inventory fetch error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch inventory',
        error: error.message 
      });
    }
  }

  // Get low stock alerts
  async getLowStockAlerts(req, res) {
    try {
      const lowStockProducts = await Product.find({
        $or: [
          { stock: 0 },
          { $expr: { $lte: ['$stock', '$lowStockThreshold'] } }
        ]
      })
      .sort({ stock: 1 })
      .populate('supplier', 'name contactInfo');

      res.json({
        success: true,
        data: lowStockProducts
      });
    } catch (error) {
      console.error('Low stock alerts error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch low stock alerts',
        error: error.message 
      });
    }
  }

  // Update product stock
  async updateStock(req, res) {
    try {
      const { productId } = req.params;
      const { quantity, operation = 'set', reason } = req.body;

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }

      let newStock;
      switch (operation) {
        case 'set':
          newStock = quantity;
          break;
        case 'add':
          newStock = product.stock + quantity;
          break;
        case 'subtract':
          newStock = Math.max(0, product.stock - quantity);
          break;
        default:
          newStock = quantity;
      }

      const oldStock = product.stock;
      product.stock = newStock;
      
      // Add stock movement history
      if (!product.stockHistory) {
        product.stockHistory = [];
      }
      
      product.stockHistory.push({
        date: new Date(),
        oldStock,
        newStock,
        operation,
        quantity,
        reason: reason || `Stock ${operation} via admin panel`,
        updatedBy: req.user.id
      });

      // Keep only last 100 history entries
      if (product.stockHistory.length > 100) {
        product.stockHistory = product.stockHistory.slice(-100);
      }

      await product.save();

      // Check if product is now low stock and send alerts if needed
      if (newStock <= product.lowStockThreshold) {
        await this.sendLowStockAlert([product]);
      }

      res.json({
        success: true,
        message: 'Stock updated successfully',
        data: {
          product,
          oldStock,
          newStock
        }
      });
    } catch (error) {
      console.error('Stock update error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to update stock',
        error: error.message 
      });
    }
  }

  // Bulk update inventory
  async bulkUpdate(req, res) {
    try {
      const { updates } = req.body;
      
      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Updates array is required'
        });
      }

      const results = [];
      const errors = [];

      for (const update of updates) {
        try {
          const { productId, field, value, operation = 'set' } = update;
          
          const product = await Product.findById(productId);
          if (!product) {
            errors.push({ productId, error: 'Product not found' });
            continue;
          }

          const oldValue = product[field];
          
          switch (field) {
            case 'stock':
              if (operation === 'set') {
                product.stock = value;
              } else if (operation === 'add') {
                product.stock += value;
              } else if (operation === 'multiply') {
                product.stock *= value;
              }
              break;
            case 'price':
              if (operation === 'set') {
                product.price = value;
              } else if (operation === 'add') {
                product.price += value;
              } else if (operation === 'multiply') {
                product.price *= value;
              }
              break;
            case 'category':
              product.category = value;
              break;
            case 'lowStockThreshold':
              product.lowStockThreshold = value;
              break;
            default:
              errors.push({ productId, error: `Invalid field: ${field}` });
              continue;
          }

          await product.save();
          results.push({
            productId,
            field,
            oldValue,
            newValue: product[field],
            success: true
          });
        } catch (error) {
          errors.push({ 
            productId: update.productId, 
            error: error.message 
          });
        }
      }

      res.json({
        success: errors.length === 0,
        message: `Bulk update completed. ${results.length} successful, ${errors.length} failed.`,
        data: {
          successful: results,
          failed: errors
        }
      });
    } catch (error) {
      console.error('Bulk update error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to perform bulk update',
        error: error.message 
      });
    }
  }

  // Send low stock alerts
  async sendLowStockAlert(req, res) {
    try {
      const { productIds, alertType = 'email', customMessage, recipients = [] } = req.body;
      
      let products;
      if (productIds && productIds.length > 0) {
        products = await Product.find({ _id: { $in: productIds } });
      } else {
        // Get all low stock products
        products = await Product.find({
          $or: [
            { stock: 0 },
            { $expr: { $lte: ['$stock', '$lowStockThreshold'] } }
          ]
        });
      }

      if (products.length === 0) {
        return res.json({
          success: true,
          message: 'No low stock products found'
        });
      }

      await this.sendLowStockAlert(products, alertType, customMessage, recipients);

      res.json({
        success: true,
        message: `Low stock alerts sent for ${products.length} products`
      });
    } catch (error) {
      console.error('Send alert error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to send low stock alerts',
        error: error.message 
      });
    }
  }

  // Get inventory analytics
  async getInventoryAnalytics(req, res) {
    try {
      const { range = '30d' } = req.query;
      const dateRange = this.getDateRange(range);

      // Stock movement analytics
      const stockMovements = await Product.aggregate([
        { $unwind: '$stockHistory' },
        {
          $match: {
            'stockHistory.date': {
              $gte: dateRange.start,
              $lte: dateRange.end
            }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$stockHistory.date'
              }
            },
            totalMovements: { $sum: 1 },
            stockAdded: {
              $sum: {
                $cond: [
                  { $eq: ['$stockHistory.operation', 'add'] },
                  '$stockHistory.quantity',
                  0
                ]
              }
            },
            stockRemoved: {
              $sum: {
                $cond: [
                  { $eq: ['$stockHistory.operation', 'subtract'] },
                  '$stockHistory.quantity',
                  0
                ]
              }
            }
          }
        },
        { $sort: { '_id': 1 } }
      ]);

      // Category-wise inventory value
      const categoryAnalytics = await Product.aggregate([
        {
          $group: {
            _id: '$category',
            totalProducts: { $sum: 1 },
            totalStock: { $sum: '$stock' },
            totalValue: { $sum: { $multiply: ['$stock', '$price'] } },
            lowStockProducts: {
              $sum: {
                $cond: [
                  { $lte: ['$stock', '$lowStockThreshold'] },
                  1,
                  0
                ]
              }
            },
            outOfStockProducts: {
              $sum: {
                $cond: [
                  { $eq: ['$stock', 0] },
                  1,
                  0
                ]
              }
            }
          }
        },
        { $sort: { totalValue: -1 } }
      ]);

      // Top selling products (based on recent orders)
      const topSellingProducts = await Order.aggregate([
        {
          $match: {
            createdAt: {
              $gte: dateRange.start,
              $lte: dateRange.end
            },
            status: { $in: ['completed', 'shipped', 'delivered'] }
          }
        },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.productId',
            quantitySold: { $sum: '$items.quantity' },
            revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
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
            currentStock: '$product.stock',
            quantitySold: 1,
            revenue: 1,
            orders: 1,
            turnoverRate: {
              $divide: ['$quantitySold', { $add: ['$product.stock', '$quantitySold'] }]
            }
          }
        },
        { $sort: { quantitySold: -1 } },
        { $limit: 20 }
      ]);

      res.json({
        success: true,
        data: {
          stockMovements: stockMovements.map(item => ({
            date: item._id,
            movements: item.totalMovements,
            stockAdded: item.stockAdded,
            stockRemoved: item.stockRemoved
          })),
          categoryAnalytics,
          topSellingProducts
        }
      });
    } catch (error) {
      console.error('Inventory analytics error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch inventory analytics',
        error: error.message 
      });
    }
  }

  // Helper methods
  async calculateInventoryMetrics() {
    const [totalProducts, lowStockCount, outOfStockCount, totalValue] = await Promise.all([
      Product.countDocuments(),
      Product.countDocuments({ $expr: { $lte: ['$stock', '$lowStockThreshold'] } }),
      Product.countDocuments({ stock: 0 }),
      Product.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: { $multiply: ['$stock', '$price'] } }
          }
        }
      ])
    ]);

    return {
      totalProducts,
      lowStockCount,
      outOfStockCount,
      totalValue: totalValue[0]?.total || 0
    };
  }

  async sendLowStockAlert(products, alertType = 'email', customMessage = '', recipients = []) {
    try {
      if (alertType === 'email') {
        const emailContent = this.generateLowStockEmailContent(products, customMessage);
        
        // Default recipients (admin emails)
        const defaultRecipients = ['admin@yourstore.com']; // Configure as needed
        const allRecipients = recipients.length > 0 ? recipients : defaultRecipients;

        await emailService.sendEmail({
          to: allRecipients,
          subject: `Low Stock Alert - ${products.length} Product(s) Need Attention`,
          html: emailContent
        });
      }
      
      // TODO: Implement SMS and push notification alerts
      
    } catch (error) {
      console.error('Send alert error:', error);
      throw error;
    }
  }

  generateLowStockEmailContent(products, customMessage) {
    const productList = products.map(product => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${product.name}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${product.stock}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">${product.lowStockThreshold}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">
          <span style="color: ${product.stock === 0 ? '#e53e3e' : '#d69e2e'}; font-weight: bold;">
            ${product.stock === 0 ? 'Out of Stock' : 'Low Stock'}
          </span>
        </td>
      </tr>
    `).join('');

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #e53e3e;">Low Stock Alert</h2>
        
        ${customMessage ? `<p style="background: #f7fafc; padding: 15px; border-radius: 5px; border-left: 4px solid #4299e1;">${customMessage}</p>` : ''}
        
        <p>The following products are running low on stock and need your attention:</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <thead>
            <tr style="background: #f7fafc;">
              <th style="padding: 10px; text-align: left; border-bottom: 2px solid #e2e8f0;">Product Name</th>
              <th style="padding: 10px; text-align: center; border-bottom: 2px solid #e2e8f0;">Current Stock</th>
              <th style="padding: 10px; text-align: center; border-bottom: 2px solid #e2e8f0;">Threshold</th>
              <th style="padding: 10px; text-align: center; border-bottom: 2px solid #e2e8f0;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${productList}
          </tbody>
        </table>
        
        <p style="margin-top: 30px;">
          <a href="${process.env.FRONTEND_URL}/admin/inventory" 
             style="background: #4299e1; color: white; padding: 12px 20px; text-decoration: none; border-radius: 5px;">
            Manage Inventory
          </a>
        </p>
        
        <p style="color: #718096; font-size: 12px; margin-top: 30px;">
          This is an automated alert from your inventory management system.
        </p>
      </div>
    `;
  }

  getDateRange(range) {
    const now = new Date();
    let start;

    switch (range) {
      case '7d':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return { start, end: now };
  }
}

module.exports = new InventoryController();