const mongoose = require('mongoose');

const orderStatusEnum = ['pending', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned'];

const trackingEventSchema = new mongoose.Schema({
  status: {
    type: String,
    enum: orderStatusEnum,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  location: String,
  description: String,
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

const orderItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  size: {
    type: String,
    default: null
  },
  color: {
    type: String,
    default: null
  },
  image: {
    type: String,
    required: true
  },
  sku: String
});

const shippingAddressSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  phone: {
    type: String,
    required: true
  },
  address: {
    type: String,
    required: true
  },
  city: {
    type: String,
    required: true
  },
  state: String,
  zipCode: String,
  country: {
    type: String,
    default: 'Bangladesh'
  }
});

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true,
    required: true
  },
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    required: true
  },
  items: [orderItemSchema],
  totalAmount: { 
    type: Number, 
    required: true,
    min: 0
  },
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  shippingCost: {
    type: Number,
    default: 0,
    min: 0
  },
  tax: {
    type: Number,
    default: 0,
    min: 0
  },
  discount: {
    type: Number,
    default: 0,
    min: 0
  },
  couponCode: String,
  shippingAddress: {
    type: shippingAddressSchema,
    required: true
  },
  billingAddress: shippingAddressSchema,
  paymentMethod: { 
    type: String, 
    enum: ['bkash', 'nagad', 'rocket', 'upay', 'card', 'cod'],
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'],
    default: 'pending'
  },
  orderStatus: {
    type: String,
    enum: orderStatusEnum,
    default: 'pending'
  },
  trackingNumber: String,
  courierService: String,
  estimatedDelivery: Date,
  actualDelivery: Date,
  transactionId: String,
  paymentReference: String,
  notes: String,
  adminNotes: String,
  trackingHistory: [trackingEventSchema],
  refundAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  refundReason: String,
  cancellationReason: String,
  returnReason: String,
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  tags: [String],
  customerRating: {
    type: Number,
    min: 1,
    max: 5
  },
  customerReview: String,
  isGift: {
    type: Boolean,
    default: false
  },
  giftMessage: String,
  source: {
    type: String,
    enum: ['web', 'mobile', 'admin', 'pos'],
    default: 'web'
  }
}, {
  timestamps: true
});

// Indexes for better performance
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ paymentStatus: 1 });
orderSchema.index({ trackingNumber: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'shippingAddress.phone': 1 });

// Generate order number before saving
orderSchema.pre('save', async function(next) {
  if (this.isNew) {
    // Generate order number: ORD-YYYYMMDD-XXXX
    const date = new Date();
    const dateStr = date.getFullYear().toString() + 
                    (date.getMonth() + 1).toString().padStart(2, '0') + 
                    date.getDate().toString().padStart(2, '0');
    
    let orderNumber;
    let attempts = 0;
    const maxAttempts = 10;
    
    do {
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      orderNumber = `ORD-${dateStr}-${randomNum}`;
      
      const existingOrder = await this.constructor.findOne({ orderNumber });
      if (!existingOrder) break;
      
      attempts++;
    } while (attempts < maxAttempts);
    
    if (attempts >= maxAttempts) {
      return next(new Error('Unable to generate unique order number'));
    }
    
    this.orderNumber = orderNumber;
    
    // Add initial tracking event
    this.trackingHistory.push({
      status: 'pending',
      description: 'Order has been placed and is waiting for confirmation',
      timestamp: new Date()
    });
  }
  
  next();
});

// Virtual for order age
orderSchema.virtual('orderAge').get(function() {
  return Date.now() - this.createdAt.getTime();
});

// Virtual for formatted order number
orderSchema.virtual('formattedOrderNumber').get(function() {
  return this.orderNumber;
});

// Methods
orderSchema.methods.addTrackingEvent = function(status, description = '', location = '', updatedBy = null) {
  const statusDescriptions = {
    pending: 'Order received and waiting for confirmation',
    confirmed: 'Order confirmed and being prepared',
    processing: 'Your order is being processed',
    packed: 'Order packed and ready for shipment',
    shipped: 'Order has been shipped',
    out_for_delivery: 'Order is out for delivery',
    delivered: 'Order has been delivered successfully',
    cancelled: 'Order has been cancelled',
    returned: 'Order has been returned'
  };
  
  this.trackingHistory.push({
    status,
    description: description || statusDescriptions[status] || '',
    location,
    updatedBy,
    timestamp: new Date()
  });
  
  this.orderStatus = status;
  
  // Set delivery date if status is delivered
  if (status === 'delivered' && !this.actualDelivery) {
    this.actualDelivery = new Date();
  }
  
  return this.save();
};

orderSchema.methods.updateStatus = function(newStatus, description = '', location = '', updatedBy = null) {
  return this.addTrackingEvent(newStatus, description, location, updatedBy);
};

orderSchema.methods.calculateTotal = function() {
  this.subtotal = this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  this.totalAmount = this.subtotal + this.shippingCost + this.tax - this.discount;
  return this.totalAmount;
};

orderSchema.methods.canCancel = function() {
  return ['pending', 'confirmed'].includes(this.orderStatus);
};

orderSchema.methods.canReturn = function() {
  return this.orderStatus === 'delivered' && 
         this.actualDelivery && 
         (Date.now() - this.actualDelivery.getTime()) < (30 * 24 * 60 * 60 * 1000); // 30 days
};

orderSchema.methods.getStatusMessage = function() {
  const statusMessages = {
    pending: 'Order received and waiting for confirmation',
    confirmed: 'Order confirmed and being prepared',
    processing: 'Your order is being processed',
    packed: 'Order packed and ready for shipment',
    shipped: 'Order has been shipped',
    out_for_delivery: 'Order is out for delivery',
    delivered: 'Order has been delivered successfully',
    cancelled: 'Order has been cancelled',
    returned: 'Order has been returned'
  };
  
  return statusMessages[this.orderStatus] || 'Status unknown';
};

orderSchema.methods.getProgressPercentage = function() {
  const statusOrder = ['pending', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery', 'delivered'];
  const currentIndex = statusOrder.indexOf(this.orderStatus);
  
  if (currentIndex === -1 || this.orderStatus === 'cancelled' || this.orderStatus === 'returned') {
    return 0;
  }
  
  return Math.round((currentIndex / (statusOrder.length - 1)) * 100);
};

orderSchema.methods.getTrackingUrl = function() {
  if (!this.trackingNumber || !this.courierService) return null;
  
  const trackingUrls = {
    'steadfast': `https://steadfast.com.bd/t/${this.trackingNumber}`,
    'pathao': `https://merchant.pathao.com/tracking/${this.trackingNumber}`,
    'redx': `https://redx.com.bd/tracking/${this.trackingNumber}`,
    'paperfly': `https://paperfly.com.bd/tracking/${this.trackingNumber}`,
    'sundarban': `https://sundarban.com.bd/tracking/${this.trackingNumber}`
  };
  
  return trackingUrls[this.courierService.toLowerCase()] || null;
};

orderSchema.methods.getEstimatedDelivery = function() {
  if (this.estimatedDelivery) return this.estimatedDelivery;
  
  // Calculate estimated delivery based on order date and shipping method
  const deliveryDays = this.shippingCost === 0 ? 7 : 3; // Free shipping takes longer
  const estimatedDate = new Date(this.createdAt);
  estimatedDate.setDate(estimatedDate.getDate() + deliveryDays);
  
  return estimatedDate;
};

// Statics
orderSchema.statics.getOrdersByStatus = function(status, limit = 50) {
  return this.find({ orderStatus: status })
    .populate('userId', 'name email phone')
    .sort({ createdAt: -1 })
    .limit(limit);
};

orderSchema.statics.getOrderStats = function(userId = null, dateRange = null) {
  const match = {};
  if (userId) match.userId = userId;
  if (dateRange) {
    match.createdAt = {
      $gte: new Date(dateRange.start),
      $lte: new Date(dateRange.end)
    };
  }
  
  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$orderStatus',
        count: { $sum: 1 },
        totalAmount: { $sum: '$totalAmount' }
      }
    }
  ]);
};

orderSchema.statics.getRecentOrders = function(userId, limit = 10) {
  return this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('items.productId', 'name images');
};

orderSchema.statics.getMonthlyStats = function(year = new Date().getFullYear()) {
  return this.aggregate([
    {
      $match: {
        createdAt: {
          $gte: new Date(year, 0, 1),
          $lt: new Date(year + 1, 0, 1)
        }
      }
    },
    {
      $group: {
        _id: { $month: '$createdAt' },
        orders: { $sum: 1 },
        revenue: { $sum: '$totalAmount' },
        avgOrderValue: { $avg: '$totalAmount' }
      }
    },
    {
      $sort: { '_id': 1 }
    }
  ]);
};

orderSchema.statics.findByOrderNumber = function(orderNumber) {
  return this.findOne({ orderNumber })
    .populate('userId', 'name email phone')
    .populate('items.productId', 'name images category');
};

module.exports = mongoose.model('Order', orderSchema);