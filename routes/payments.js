const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Coupon = require('../models/Coupon');
const { auth } = require('../middleware/auth');
const { validate } = require('../utils/validation');

// Payment methods configuration
const PAYMENT_METHODS = {
  bkash: {
    name: 'bKash',
    minAmount: 10,
    maxAmount: 25000,
    fee: 18.5, // 1.85% fee
    currency: 'BDT'
  },
  nagad: {
    name: 'Nagad',
    minAmount: 10,
    maxAmount: 25000,
    fee: 10,
    currency: 'BDT'
  },
  rocket: {
    name: 'Rocket',
    minAmount: 10,
    maxAmount: 25000,
    fee: 12.5,
    currency: 'BDT'
  },
  upay: {
    name: 'Upay',
    minAmount: 10,
    maxAmount: 25000,
    fee: 15,
    currency: 'BDT'
  },
  stripe: {
    name: 'Credit/Debit Card',
    minAmount: 50,
    maxAmount: 100000,
    fee: 29, // 2.9% + 30 BDT
    currency: 'BDT'
  },
  cod: {
    name: 'Cash on Delivery',
    minAmount: 100,
    maxAmount: 5000,
    fee: 0,
    currency: 'BDT'
  }
};

// Get available payment methods
router.get('/methods', async (req, res) => {
  try {
    const { amount } = req.query;
    const orderAmount = parseFloat(amount) || 0;

    const availableMethods = Object.keys(PAYMENT_METHODS)
      .filter(key => {
        const method = PAYMENT_METHODS[key];
        return orderAmount >= method.minAmount && orderAmount <= method.maxAmount;
      })
      .map(key => ({
        id: key,
        ...PAYMENT_METHODS[key],
        isAvailable: true
      }));

    res.json({
      success: true,
      data: availableMethods
    });
  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment methods'
    });
  }
});

// Calculate payment fee
router.post('/calculate-fee', async (req, res) => {
  try {
    const { paymentMethod, amount } = req.body;

    if (!PAYMENT_METHODS[paymentMethod]) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment method'
      });
    }

    const method = PAYMENT_METHODS[paymentMethod];
    let fee = 0;

    if (paymentMethod === 'stripe') {
      fee = Math.round((amount * 0.029 + 30) * 100) / 100; // 2.9% + 30 BDT
    } else if (method.fee > 0) {
      fee = Math.round((amount * method.fee / 1000) * 100) / 100; // Convert from per thousand
    }

    const total = amount + fee;

    res.json({
      success: true,
      data: {
        subtotal: amount,
        fee,
        total,
        paymentMethod: method.name
      }
    });
  } catch (error) {
    console.error('Calculate fee error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate payment fee'
    });
  }
});

// Create Stripe Payment Intent
router.post('/stripe/create-intent', auth, async (req, res) => {
  try {
    const { amount, orderId } = req.body;

    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(400).json({
        success: false,
        error: 'Stripe is not configured'
      });
    }

    const order = await Order.findOne({ _id: orderId, userId: req.user._id });
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to paisa
      currency: 'bdt',
      metadata: {
        orderId: order._id.toString(),
        userId: req.user._id.toString()
      },
      description: `Payment for order ${order.orderNumber}`
    });

    // Update order with payment intent
    order.paymentIntentId = paymentIntent.id;
    order.paymentStatus = 'pending';
    await order.save();

    res.json({
      success: true,
      data: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      }
    });
  } catch (error) {
    console.error('Create Stripe payment intent error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create payment intent',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Process Mobile Banking Payment (bKash, Nagad, etc.)
router.post('/mobile-banking/initiate', auth, async (req, res) => {
  try {
    const { paymentMethod, amount, orderId, mobileNumber } = req.body;

    if (!['bkash', 'nagad', 'rocket', 'upay'].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mobile banking method'
      });
    }

    const order = await Order.findOne({ _id: orderId, userId: req.user._id });
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    // In a real implementation, you would integrate with the actual payment gateway APIs
    // For now, we'll simulate the process
    const transactionId = `${paymentMethod.toUpperCase()}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Update order with payment details
    order.paymentMethod = paymentMethod;
    order.paymentStatus = 'pending';
    order.transactionId = transactionId;
    order.paymentMetadata = {
      mobileNumber: mobileNumber,
      initiatedAt: new Date()
    };
    await order.save();

    res.json({
      success: true,
      data: {
        transactionId,
        message: `Please complete payment using ${PAYMENT_METHODS[paymentMethod].name}`,
        instructions: [
          `Dial *247# for ${PAYMENT_METHODS[paymentMethod].name}`,
          `Select "Send Money"`,
          `Enter Merchant: 01XXXXXXXXX`, // Replace with actual merchant number
          `Enter Amount: ৳${amount}`,
          `Reference: ${transactionId}`,
          `Enter PIN to confirm payment`
        ]
      }
    });
  } catch (error) {
    console.error('Initiate mobile banking payment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initiate payment'
    });
  }
});

// Confirm Mobile Banking Payment
router.post('/mobile-banking/confirm', auth, async (req, res) => {
  try {
    const { transactionId, userTransactionId } = req.body;

    const order = await Order.findOne({ 
      transactionId,
      userId: req.user._id 
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    // In real implementation, verify with payment gateway API
    // For now, simulate verification
    const isVerified = userTransactionId && userTransactionId.length >= 6;

    if (isVerified) {
      order.paymentStatus = 'completed';
      order.status = 'confirmed';
      order.paidAt = new Date();
      order.paymentMetadata.userTransactionId = userTransactionId;
      order.paymentMetadata.confirmedAt = new Date();
      await order.save();

      res.json({
        success: true,
        data: { order },
        message: 'Payment confirmed successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Invalid transaction ID'
      });
    }
  } catch (error) {
    console.error('Confirm mobile banking payment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm payment'
    });
  }
});

// Process Cash on Delivery
router.post('/cod/confirm', auth, async (req, res) => {
  try {
    const { orderId } = req.body;

    const order = await Order.findOne({ _id: orderId, userId: req.user._id });
    if (!order) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }

    order.paymentMethod = 'cod';
    order.paymentStatus = 'cod_pending';
    order.status = 'confirmed';
    await order.save();

    res.json({
      success: true,
      data: { order },
      message: 'Cash on Delivery order confirmed'
    });
  } catch (error) {
    console.error('COD confirmation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm COD order'
    });
  }
});

// Get payment history
router.get('/history', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const filter = { userId: req.user._id };
    
    if (status) filter.paymentStatus = status;

    const orders = await Order.find(filter)
      .select('orderNumber paymentMethod paymentStatus totalAmount paidAt transactionId createdAt')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Order.countDocuments(filter);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch payment history'
    });
  }
});

module.exports = router;