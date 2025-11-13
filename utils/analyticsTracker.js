const mongoose = require('mongoose');

// Analytics Event Schema
const analyticsEventSchema = new mongoose.Schema({
  eventType: {
    type: String,
    required: true,
    enum: [
      'page_view',
      'product_view', 
      'product_click',
      'add_to_cart',
      'remove_from_cart',
      'checkout_start',
      'checkout_complete',
      'search',
      'filter_applied',
      'wishlist_add',
      'wishlist_remove',
      'user_signup',
      'user_login',
      'newsletter_signup',
      'contact_form_submit',
      'social_share'
    ]
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  sessionId: {
    type: String,
    required: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  userAgent: String,
  ipAddress: String,
  referrer: String,
  url: String,
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  // TTL index to automatically delete old analytics data after 1 year
  expireAfterSeconds: 365 * 24 * 60 * 60
});

// Indexes for better query performance
analyticsEventSchema.index({ eventType: 1, timestamp: -1 });
analyticsEventSchema.index({ productId: 1, eventType: 1, timestamp: -1 });
analyticsEventSchema.index({ userId: 1, timestamp: -1 });
analyticsEventSchema.index({ sessionId: 1 });
analyticsEventSchema.index({ timestamp: -1 });

const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);

// Product Performance Schema for aggregated data
const productPerformanceSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    unique: true
  },
  views: {
    total: { type: Number, default: 0 },
    today: { type: Number, default: 0 },
    thisWeek: { type: Number, default: 0 },
    thisMonth: { type: Number, default: 0 }
  },
  clicks: {
    total: { type: Number, default: 0 },
    today: { type: Number, default: 0 },
    thisWeek: { type: Number, default: 0 },
    thisMonth: { type: Number, default: 0 }
  },
  addToCarts: {
    total: { type: Number, default: 0 },
    today: { type: Number, default: 0 },
    thisWeek: { type: Number, default: 0 },
    thisMonth: { type: Number, default: 0 }
  },
  wishlistAdds: {
    total: { type: Number, default: 0 },
    today: { type: Number, default: 0 },
    thisWeek: { type: Number, default: 0 },
    thisMonth: { type: Number, default: 0 }
  },
  conversionRate: {
    viewToCart: { type: Number, default: 0 },
    clickToCart: { type: Number, default: 0 }
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

const ProductPerformance = mongoose.model('ProductPerformance', productPerformanceSchema);

class AnalyticsTracker {
  constructor() {
    this.batchEvents = [];
    this.batchSize = 50;
    this.flushInterval = 5000; // 5 seconds
    
    // Start batch processing
    this.startBatchProcessing();
    
    // Schedule daily aggregation
    this.scheduleAggregation();
  }

  // Track an analytics event
  async track(eventType, data = {}) {
    try {
      const event = {
        eventType,
        userId: data.userId || null,
        sessionId: data.sessionId || this.generateSessionId(),
        productId: data.productId || null,
        metadata: data.metadata || {},
        userAgent: data.userAgent || '',
        ipAddress: data.ipAddress || '',
        referrer: data.referrer || '',
        url: data.url || '',
        timestamp: new Date()
      };

      // Add to batch for processing
      this.batchEvents.push(event);

      // Flush if batch is full
      if (this.batchEvents.length >= this.batchSize) {
        await this.flushBatch();
      }

      // Update real-time product performance for specific events
      if (eventType === 'product_view' || eventType === 'product_click' || 
          eventType === 'add_to_cart' || eventType === 'wishlist_add') {
        await this.updateProductPerformance(eventType, data.productId);
      }

    } catch (error) {
      console.error('Analytics tracking error:', error);
    }
  }

  // Batch process events for better performance
  async flushBatch() {
    if (this.batchEvents.length === 0) return;

    try {
      await AnalyticsEvent.insertMany(this.batchEvents);
      this.batchEvents = [];
    } catch (error) {
      console.error('Batch flush error:', error);
      this.batchEvents = []; // Clear batch to prevent memory leak
    }
  }

  // Start batch processing interval
  startBatchProcessing() {
    setInterval(() => {
      this.flushBatch();
    }, this.flushInterval);
  }

  // Update real-time product performance
  async updateProductPerformance(eventType, productId) {
    if (!productId) return;

    try {
      const update = {};
      const field = this.getPerformanceField(eventType);
      
      if (field) {
        update[`${field}.total`] = 1;
        update[`${field}.today`] = 1;
        update[`${field}.thisWeek`] = 1;
        update[`${field}.thisMonth`] = 1;
        update.lastUpdated = new Date();
      }

      await ProductPerformance.findOneAndUpdate(
        { productId },
        { $inc: update },
        { upsert: true, new: true }
      );

      // Update conversion rates
      await this.updateConversionRates(productId);

    } catch (error) {
      console.error('Product performance update error:', error);
    }
  }

  // Map event types to performance fields
  getPerformanceField(eventType) {
    const fieldMap = {
      'product_view': 'views',
      'product_click': 'clicks',
      'add_to_cart': 'addToCarts',
      'wishlist_add': 'wishlistAdds'
    };
    return fieldMap[eventType];
  }

  // Update conversion rates
  async updateConversionRates(productId) {
    try {
      const performance = await ProductPerformance.findOne({ productId });
      if (!performance) return;

      const updates = {};
      
      // Calculate view to cart conversion rate
      if (performance.views.total > 0) {
        updates['conversionRate.viewToCart'] = 
          (performance.addToCarts.total / performance.views.total) * 100;
      }

      // Calculate click to cart conversion rate
      if (performance.clicks.total > 0) {
        updates['conversionRate.clickToCart'] = 
          (performance.addToCarts.total / performance.clicks.total) * 100;
      }

      if (Object.keys(updates).length > 0) {
        await ProductPerformance.updateOne({ productId }, { $set: updates });
      }

    } catch (error) {
      console.error('Conversion rate update error:', error);
    }
  }

  // Get analytics data
  async getAnalytics(options = {}) {
    try {
      const {
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        endDate = new Date(),
        eventType,
        productId,
        userId,
        groupBy = 'day'
      } = options;

      const matchStage = {
        timestamp: { $gte: startDate, $lte: endDate }
      };

      if (eventType) matchStage.eventType = eventType;
      if (productId) matchStage.productId = new mongoose.Types.ObjectId(productId);
      if (userId) matchStage.userId = new mongoose.Types.ObjectId(userId);

      const groupFormat = this.getGroupFormat(groupBy);
      
      const pipeline = [
        { $match: matchStage },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: groupFormat, date: '$timestamp' } },
              eventType: '$eventType'
            },
            count: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: '$_id.date',
            events: {
              $push: {
                eventType: '$_id.eventType',
                count: '$count'
              }
            },
            totalEvents: { $sum: '$count' }
          }
        },
        { $sort: { _id: 1 } }
      ];

      return await AnalyticsEvent.aggregate(pipeline);

    } catch (error) {
      console.error('Get analytics error:', error);
      return [];
    }
  }

  // Get product performance analytics
  async getProductAnalytics(productId, timeframe = 'month') {
    try {
      const performance = await ProductPerformance.findOne({ productId })
        .populate('productId', 'name price category');

      if (!performance) {
        return null;
      }

      // Get detailed events for the timeframe
      const startDate = this.getStartDateForTimeframe(timeframe);
      const events = await AnalyticsEvent.find({
        productId,
        timestamp: { $gte: startDate }
      }).sort({ timestamp: -1 });

      return {
        product: performance.productId,
        performance: {
          views: performance.views[timeframe] || 0,
          clicks: performance.clicks[timeframe] || 0,
          addToCarts: performance.addToCarts[timeframe] || 0,
          wishlistAdds: performance.wishlistAdds[timeframe] || 0,
          conversionRate: performance.conversionRate
        },
        events: events.slice(0, 100) // Limit to recent 100 events
      };

    } catch (error) {
      console.error('Get product analytics error:', error);
      return null;
    }
  }

  // Get top performing products
  async getTopProducts(options = {}) {
    try {
      const {
        limit = 10,
        sortBy = 'views.total',
        timeframe = 'total'
      } = options;

      const sortField = `${sortBy.includes('.') ? sortBy : `${sortBy}.${timeframe}`}`;
      const sortObj = {};
      sortObj[sortField] = -1;

      return await ProductPerformance.find({})
        .populate('productId', 'name price category image')
        .sort(sortObj)
        .limit(limit);

    } catch (error) {
      console.error('Get top products error:', error);
      return [];
    }
  }

  // Schedule daily aggregation to reset daily/weekly/monthly counters
  scheduleAggregation() {
    setInterval(() => {
      this.performDailyAggregation();
    }, 24 * 60 * 60 * 1000); // Run daily
  }

  // Perform daily aggregation
  async performDailyAggregation() {
    try {
      const today = new Date();
      const isNewWeek = today.getDay() === 1; // Monday
      const isNewMonth = today.getDate() === 1;

      const resetFields = { 'today': 0 };
      if (isNewWeek) resetFields['thisWeek'] = 0;
      if (isNewMonth) resetFields['thisMonth'] = 0;

      // Reset counters
      await ProductPerformance.updateMany({}, {
        $set: {
          'views.today': 0,
          'clicks.today': 0,
          'addToCarts.today': 0,
          'wishlistAdds.today': 0,
          ...(isNewWeek && {
            'views.thisWeek': 0,
            'clicks.thisWeek': 0,
            'addToCarts.thisWeek': 0,
            'wishlistAdds.thisWeek': 0
          }),
          ...(isNewMonth && {
            'views.thisMonth': 0,
            'clicks.thisMonth': 0,
            'addToCarts.thisMonth': 0,
            'wishlistAdds.thisMonth': 0
          })
        }
      });

      console.log('Daily analytics aggregation completed');

    } catch (error) {
      console.error('Daily aggregation error:', error);
    }
  }

  // Helper methods
  generateSessionId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  getGroupFormat(groupBy) {
    const formats = {
      hour: '%Y-%m-%d-%H',
      day: '%Y-%m-%d',
      week: '%Y-%U',
      month: '%Y-%m',
      year: '%Y'
    };
    return formats[groupBy] || formats.day;
  }

  getStartDateForTimeframe(timeframe) {
    const now = new Date();
    switch (timeframe) {
      case 'today':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case 'thisWeek':
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        return startOfWeek;
      case 'thisMonth':
        return new Date(now.getFullYear(), now.getMonth(), 1);
      default:
        return new Date(0); // Beginning of time for 'total'
    }
  }
}

// Export singleton instance
module.exports = new AnalyticsTracker();