const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');

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
        carrier: order.carrier,
        updates: order.trackingUpdates || [],
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
router.put('/:orderId/tracking', adminAuth, async (req, res) => {
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
      order.status = status;
    }

    // Update tracking information
    if (trackingNumber) order.trackingNumber = trackingNumber;
    if (carrier) order.carrier = carrier;
    if (estimatedDelivery) order.estimatedDelivery = new Date(estimatedDelivery);

    // Add tracking update
    if (status || message || location) {
      const update = {
        status: status || order.status,
        timestamp: new Date(),
        location: location || '',
        message: message || `Order ${status || 'updated'}`
      };

      if (!order.trackingUpdates) {
        order.trackingUpdates = [];
      }
      order.trackingUpdates.push(update);
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
    if (!cancellableStatuses.includes(order.status)) {
      return res.status(400).json({
        success: false,
        error: 'Order cannot be cancelled at this stage'
      });
    }

    // Update order status
    order.status = 'cancelled';
    order.cancellationReason = reason;
    order.cancelledAt = new Date();

    // Add tracking update
    if (!order.trackingUpdates) {
      order.trackingUpdates = [];
    }
    order.trackingUpdates.push({
      status: 'cancelled',
      timestamp: new Date(),
      message: `Order cancelled: ${reason}`
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
    if (order.status !== 'delivered') {
      return res.status(400).json({
        success: false,
        error: 'Only delivered orders can be returned'
      });
    }

    // Check return window (30 days)
    const deliveredDate = order.deliveredAt || order.updatedAt;
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

    // For now, just update the order with return request
    // In a full implementation, you'd create a separate Returns model
    order.returnRequest = returnRequest;
    order.status = 'return_requested';

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