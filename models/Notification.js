const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'order_confirmed',
      'order_shipped',
      'order_delivered',
      'order_cancelled',
      'payment_received',
      'payment_failed',
      'product_back_in_stock',
      'new_message',
      'price_drop',
      'promotional',
      'system',
      'welcome'
    ]
  },
  title: {
    type: String,
    required: true,
    maxlength: 100
  },
  message: {
    type: String,
    required: true,
    maxlength: 500
  },
  data: {
    orderId: String,
    productId: String,
    couponCode: String,
    url: String,
    imageUrl: String,
    amount: Number
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  readAt: Date,
  archivedAt: Date,
  expiresAt: {
    type: Date,
    default: function() {
      // Default expiry: 30 days from creation
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
  },
  channels: {
    push: { type: Boolean, default: true },
    email: { type: Boolean, default: false },
    sms: { type: Boolean, default: false }
  },
  sentVia: {
    push: { type: Boolean, default: false },
    email: { type: Boolean, default: false },
    sms: { type: Boolean, default: false }
  },
  metadata: {
    source: String,
    campaign: String,
    version: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Indexes for better performance
notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
notificationSchema.index({ isArchived: 1, createdAt: -1 });

// Virtual for determining if notification is recent
notificationSchema.virtual('isRecent').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  return diff < (24 * 60 * 60 * 1000); // Less than 24 hours
});

// Instance methods
notificationSchema.methods.markAsRead = function() {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

notificationSchema.methods.archive = function() {
  this.isArchived = true;
  this.archivedAt = new Date();
  return this.save();
};

notificationSchema.methods.markAsSent = function(channel) {
  if (this.channels[channel] && ['push', 'email', 'sms'].includes(channel)) {
    this.sentVia[channel] = true;
    return this.save();
  }
  return Promise.resolve(this);
};

// Static methods
notificationSchema.statics.createNotification = async function(data) {
  const notification = new this(data);
  await notification.save();
  
  // Emit real-time notification if user is connected
  const io = require('../utils/socket').getIO();
  if (io) {
    io.to(`user_${data.userId}`).emit('notification', {
      id: notification._id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      priority: notification.priority,
      createdAt: notification.createdAt
    });
  }
  
  return notification;
};

notificationSchema.statics.getUnreadCount = async function(userId) {
  return this.countDocuments({
    userId,
    isRead: false,
    isArchived: false
  });
};

notificationSchema.statics.markAllAsRead = async function(userId) {
  return this.updateMany(
    { userId, isRead: false },
    { 
      $set: { 
        isRead: true, 
        readAt: new Date() 
      } 
    }
  );
};

notificationSchema.statics.cleanupExpired = async function() {
  const result = await this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
  return result.deletedCount;
};

// Notification templates
notificationSchema.statics.templates = {
  order_confirmed: {
    title: 'Order Confirmed',
    message: 'Your order #{orderNumber} has been confirmed and is being processed.',
    priority: 'normal',
    channels: { push: true, email: true }
  },
  order_shipped: {
    title: 'Order Shipped',
    message: 'Your order #{orderNumber} has been shipped and is on its way!',
    priority: 'high',
    channels: { push: true, email: true, sms: true }
  },
  order_delivered: {
    title: 'Order Delivered',
    message: 'Your order #{orderNumber} has been delivered. Thank you for shopping with us!',
    priority: 'high',
    channels: { push: true, email: true }
  },
  payment_received: {
    title: 'Payment Received',
    message: 'We have received your payment of ৳{amount} for order #{orderNumber}.',
    priority: 'normal',
    channels: { push: true, email: true }
  },
  welcome: {
    title: 'Welcome to StyleShop!',
    message: 'Thank you for joining us. Start exploring our amazing collection of products.',
    priority: 'normal',
    channels: { push: true, email: true }
  },
  product_back_in_stock: {
    title: 'Product Back in Stock',
    message: '{productName} is now back in stock. Get it before it runs out again!',
    priority: 'high',
    channels: { push: true, email: true }
  }
};

// Create notification with template
notificationSchema.statics.createFromTemplate = async function(userId, templateKey, variables = {}) {
  const template = this.templates[templateKey];
  if (!template) {
    throw new Error(`Notification template '${templateKey}' not found`);
  }

  let title = template.title;
  let message = template.message;

  // Replace variables in title and message
  Object.keys(variables).forEach(key => {
    const placeholder = `{${key}}`;
    title = title.replace(new RegExp(placeholder, 'g'), variables[key]);
    message = message.replace(new RegExp(placeholder, 'g'), variables[key]);
  });

  return this.createNotification({
    userId,
    type: templateKey,
    title,
    message,
    priority: template.priority,
    channels: template.channels,
    data: variables
  });
};

module.exports = mongoose.model('Notification', notificationSchema);