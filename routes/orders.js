const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const { auth } = require('../middleware/auth');
const { validate } = require('../utils/validation');

// Get all orders for a user
router.get('/', auth, async (req, res) => {
  try {
    const { status, limit = 20, page = 1, search } = req.query;
    
    let query = { userId: req.user.userId };
    
    if (status && status !== 'all') {
      query.orderStatus = status;
    }
    
    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'items.name': { $regex: search, $options: 'i' } },
        { 'shippingAddress.name': { $regex: search, $options: 'i' } }
      ];
    }

    const orders = await Order.find(query)
      .populate('items.productId', 'name images category')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Order.countDocuments(query);

    // Get order statistics
    const stats = await Order.getOrderStats(req.user.userId);

    res.json({
      success: true,
      orders: orders.map(order => ({
        ...order.toObject(),
        progressPercentage: order.getProgressPercentage(),
        statusMessage: order.getStatusMessage(),
        canCancel: order.canCancel(),
        canReturn: order.canReturn()
      })),
      stats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Get orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
      error: error.message
    });
  }
});

// Get a specific order
router.get('/:id', auth, async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      userId: req.user.userId
    }).populate('items.productId', 'name images category');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.json({
      success: true,
      order: {
        ...order.toObject(),
        progressPercentage: order.getProgressPercentage(),
        statusMessage: order.getStatusMessage(),
        trackingUrl: order.getTrackingUrl(),
        estimatedDelivery: order.getEstimatedDelivery(),
        canCancel: order.canCancel(),
        canReturn: order.canReturn()
      }
    });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order',
      error: error.message
    });
  }
});

// Get order by order number (public tracking)
router.get('/track/:orderNumber', async (req, res) => {
  try {
    const order = await Order.findByOrderNumber(req.params.orderNumber);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Return limited information for public tracking
    res.json({
      success: true,
      order: {
        orderNumber: order.orderNumber,
        orderStatus: order.orderStatus,
        statusMessage: order.getStatusMessage(),
        progressPercentage: order.getProgressPercentage(),
        trackingHistory: order.trackingHistory,
        estimatedDelivery: order.getEstimatedDelivery(),
        actualDelivery: order.actualDelivery,
        trackingNumber: order.trackingNumber,
        courierService: order.courierService,
        trackingUrl: order.getTrackingUrl(),
        createdAt: order.createdAt,
        shippingAddress: {
          city: order.shippingAddress.city,
          state: order.shippingAddress.state
        },
        items: order.items.map(item => ({
          name: item.name,
          quantity: item.quantity,
          image: item.image
        }))
      }
    });
  } catch (error) {
    console.error('Track order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to track order',
      error: error.message
    });
  }
});

// Create a new order
router.post('/', auth, validate(require('../utils/validation').schemas.order), async (req, res) => {
  try {
    const {
      items,
      shippingAddress,
      billingAddress,
      paymentMethod,
      couponCode,
      notes,
      isGift,
      giftMessage
    } = req.body;

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order items are required'
      });
    }

    if (!shippingAddress || !shippingAddress.name || !shippingAddress.address) {
      return res.status(400).json({
        success: false,
        message: 'Shipping address is required'
      });
    }

    // Calculate totals and validate products
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product) {
        return res.status(404).json({
          success: false,
          message: `Product ${item.productId} not found`
        });
      }

      // Check stock
      if (product.stock < item.quantity) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${product.name}. Available: ${product.stock}`
        });
      }

      const itemTotal = product.price * item.quantity;
      subtotal += itemTotal;

      orderItems.push({
        productId: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        size: item.size,
        color: item.color,
        image: product.images?.[0] || product.image,
        sku: product.sku
      });
    }

    // Calculate shipping and tax
    const shippingCost = subtotal > 1000 ? 0 : 60; // Free shipping over 1000 BDT
    const tax = Math.round(subtotal * 0.0); // No tax for now, but structure is ready
    let discount = 0;
    
    // Apply coupon logic here if needed
    if (couponCode) {
      // TODO: Implement coupon validation
    }
    
    const totalAmount = subtotal + shippingCost + tax - discount;

    // Create order
    const order = new Order({
      userId: req.user.userId,
      items: orderItems,
      subtotal,
      shippingCost,
      tax,
      discount,
      totalAmount,
      shippingAddress,
      billingAddress: billingAddress || shippingAddress,
      paymentMethod,
      couponCode,
      notes,
      isGift: isGift || false,
      giftMessage,
      source: 'web'
    });

    await order.save();

    // Update product stock
    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (product) {
        product.stock -= item.quantity;
        if (product.stock <= 0) {
          product.inStock = false;
        }
        await product.save();
      }
    }

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
        orderStatus: order.orderStatus,
        estimatedDelivery: order.getEstimatedDelivery()
      }
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error.message
    });
  }
});

// Update order status (Admin only)
router.put('/:id/status', auth, async (req, res) => {
  try {
    // TODO: Add admin role check
    const { status, description, location, trackingNumber, courierService } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (trackingNumber) order.trackingNumber = trackingNumber;
    if (courierService) order.courierService = courierService;

    await order.updateStatus(status, description, location, req.user.userId);

    res.json({
      success: true,
      message: 'Order status updated successfully',
      order
    });
  } catch (error) {
    console.error('Update order status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order status',
      error: error.message
    });
  }
});

// Cancel an order
router.put('/:id/cancel', auth, async (req, res) => {
  try {
    const { cancellationReason } = req.body;

    const order = await Order.findOne({
      _id: req.params.id,
      userId: req.user.userId
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (!order.canCancel()) {
      return res.status(400).json({
        success: false,
        message: 'Order cannot be cancelled at this stage'
      });
    }

    // Restore product stock
    for (const item of order.items) {
      const product = await Product.findById(item.productId);
      if (product) {
        product.stock += item.quantity;
        product.inStock = true;
        await product.save();
      }
    }

    // Update order status
    order.cancellationReason = cancellationReason;
    await order.updateStatus('cancelled', `Order cancelled: ${cancellationReason}`, '', req.user.userId);

    res.json({
      success: true,
      message: 'Order cancelled successfully',
      order
    });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel order',
      error: error.message
    });
  }
});

// Request return
router.put('/:id/return', auth, async (req, res) => {
  try {
    const { returnReason } = req.body;

    const order = await Order.findOne({
      _id: req.params.id,
      userId: req.user.userId
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (!order.canReturn()) {
      return res.status(400).json({
        success: false,
        message: 'Return period has expired or order is not eligible for return'
      });
    }

    order.returnReason = returnReason;
    await order.updateStatus('returned', `Return requested: ${returnReason}`, '', req.user.userId);

    res.json({
      success: true,
      message: 'Return request submitted successfully',
      order
    });
  } catch (error) {
    console.error('Return order error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit return request',
      error: error.message
    });
  }
});

// Add review for order
router.put('/:id/review', auth, async (req, res) => {
  try {
    const { rating, review } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    const order = await Order.findOne({
      _id: req.params.id,
      userId: req.user.userId
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.orderStatus !== 'delivered') {
      return res.status(400).json({
        success: false,
        message: 'Can only review delivered orders'
      });
    }

    order.customerRating = rating;
    order.customerReview = review;
    await order.save();

    res.json({
      success: true,
      message: 'Review added successfully',
      order
    });
  } catch (error) {
    console.error('Add review error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add review',
      error: error.message
    });
  }
});

// Get recent orders
router.get('/recent/list', auth, async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    
    const orders = await Order.getRecentOrders(req.user.userId, parseInt(limit));
    
    res.json({
      success: true,
      orders: orders.map(order => ({
        ...order.toObject(),
        progressPercentage: order.getProgressPercentage(),
        statusMessage: order.getStatusMessage()
      }))
    });
  } catch (error) {
    console.error('Get recent orders error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recent orders',
      error: error.message
    });
  }
});

// Get order statistics
router.get('/stats/overview', auth, async (req, res) => {
  try {
    const stats = await Order.getOrderStats(req.user.userId);
    const monthlyStats = await Order.getMonthlyStats();
    
    res.json({
      success: true,
      stats: {
        orderBreakdown: stats,
        monthlyTrends: monthlyStats
      }
    });
  } catch (error) {
    console.error('Get order stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order statistics',
      error: error.message
    });
  }
});

// Get single order with tracking information
router.get('/:orderId', auth, async (req, res) => {
  try {
    const { orderId } = req.params;

    // Find order and populate product information
    const order = await Order.findOne({
      _id: orderId,
      userId: req.user.userId
    }).populate('items.productId', 'name images price');

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Add tracking information if available
    const orderWithTracking = {
      ...order.toObject(),
      tracking: {
        trackingNumber: order.trackingNumber,
        carrier: order.carrier || order.courierService,
        updates: order.trackingHistory || order.trackingUpdates || [],
        estimatedDelivery: order.estimatedDelivery
      }
    };

    res.json({
      success: true,
      data: orderWithTracking
    });
  } catch (error) {
    console.error('Get order tracking error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get order tracking information'
    });
  }
});

// Update order tracking (Admin only)
router.put('/:orderId/tracking', require('../middleware/adminAuth').adminAuth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { 
      status, 
      trackingNumber, 
      carrier, 
      estimatedDelivery, 
      location, 
      message 
    } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Update order status if provided
    if (status) {
      order.orderStatus = status;
    }

    // Update tracking information
    if (trackingNumber) order.trackingNumber = trackingNumber;
    if (carrier) order.courierService = carrier;
    if (estimatedDelivery) order.estimatedDelivery = new Date(estimatedDelivery);

    // Add tracking update
    if (status || message || location) {
      const update = {
        status: status || order.orderStatus,
        timestamp: new Date(),
        location: location || '',
        description: message || `Order ${status || 'updated'}`
      };

      if (!order.trackingHistory) {
        order.trackingHistory = [];
      }
      order.trackingHistory.push(update);
    }

    await order.save();

    res.json({
      success: true,
      message: 'Order tracking updated successfully',
      data: order
    });
  } catch (error) {
    console.error('Update order tracking error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update order tracking'
    });
  }
});

// Cancel order
router.post('/:orderId/cancel', auth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason = 'Customer request' } = req.body;

    const order = await Order.findOne({
      _id: orderId,
      userId: req.user.userId
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Check if order can be cancelled
    const cancellableStatuses = ['pending', 'confirmed', 'processing'];
    if (!cancellableStatuses.includes(order.orderStatus)) {
      return res.status(400).json({
        success: false,
        error: 'Order cannot be cancelled at this stage'
      });
    }

    // Update order status
    order.orderStatus = 'cancelled';
    order.cancellationReason = reason;

    // Add tracking update
    if (!order.trackingHistory) {
      order.trackingHistory = [];
    }
    order.trackingHistory.push({
      status: 'cancelled',
      timestamp: new Date(),
      description: `Order cancelled: ${reason}`
    });

    await order.save();

    res.json({
      success: true,
      message: 'Order cancelled successfully',
      data: order
    });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel order'
    });
  }
});

// Request return/refund
router.post('/:orderId/return', auth, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { items = [], reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Return reason is required'
      });
    }

    const order = await Order.findOne({
      _id: orderId,
      userId: req.user.userId
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // Check if order is eligible for return
    if (order.orderStatus !== 'delivered') {
      return res.status(400).json({
        success: false,
        error: 'Only delivered orders can be returned'
      });
    }

    // Check return window (30 days)
    const deliveredDate = order.actualDelivery || order.updatedAt;
    const returnWindow = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds
    if (Date.now() - new Date(deliveredDate).getTime() > returnWindow) {
      return res.status(400).json({
        success: false,
        error: 'Return window has expired (30 days)'
      });
    }

    // Create return request
    const returnRequest = {
      orderId: order._id,
      userId: req.user.userId,
      items: items.length > 0 ? items : order.items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        reason: reason
      })),
      reason,
      status: 'pending',
      requestedAt: new Date()
    };

    // Update order with return request
    order.returnRequest = returnRequest;
    order.orderStatus = 'return_requested';

    await order.save();

    res.json({
      success: true,
      message: 'Return request submitted successfully',
      data: {
        order,
        returnRequest
      }
    });
  } catch (error) {
    console.error('Request return error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit return request'
    });
  }
});

module.exports = router;