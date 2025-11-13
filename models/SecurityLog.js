const mongoose = require('mongoose');

const securityLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  action: {
    type: String,
    required: true,
    enum: [
      'login_attempt',
      'login_success',
      'login_failure',
      'logout',
      'password_change',
      'password_reset_request',
      'password_reset_success',
      '2fa_enable',
      '2fa_disable',
      '2fa_attempt',
      '2fa_success',
      '2fa_failure',
      'admin_action',
      'template_publish',
      'template_delete',
      'template_rollback',
      'asset_upload',
      'asset_delete',
      'suspicious_activity',
      'rate_limit_exceeded',
      'csrf_violation',
      'xss_attempt',
      'sql_injection_attempt',
      'unauthorized_access',
      'token_refresh',
      'token_blacklist'
    ]
  },
  ip: {
    type: String,
    required: true
  },
  userAgent: {
    type: String,
    required: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'low'
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  metadata: {
    endpoint: String,
    method: String,
    statusCode: Number,
    responseTime: Number,
    country: String,
    city: String
  }
}, {
  timestamps: true,
  // TTL index to automatically delete logs older than 1 year
  expireAfterSeconds: 365 * 24 * 60 * 60
});

// Indexes for better query performance
securityLogSchema.index({ userId: 1, timestamp: -1 });
securityLogSchema.index({ action: 1, timestamp: -1 });
securityLogSchema.index({ ip: 1, timestamp: -1 });
securityLogSchema.index({ severity: 1, timestamp: -1 });
securityLogSchema.index({ timestamp: -1 });

// Static method to log security events
securityLogSchema.statics.logEvent = async function(eventData) {
  try {
    const log = new this(eventData);
    await log.save();
    
    // Send alerts for high/critical severity events
    if (eventData.severity === 'high' || eventData.severity === 'critical') {
      try {
        const alertingSystem = require('../utils/alertingSystem');
        await alertingSystem.handleSecurityEvent(eventData.action, {
          severity: eventData.severity,
          ip: eventData.ip,
          userAgent: eventData.userAgent,
          userId: eventData.userId,
          details: eventData.details,
          metadata: eventData.metadata
        });
      } catch (error) {
        const logger = require('../utils/structuredLogger');
        logger.error('Failed to send security alert', { error: error.message, eventData });
      }
    }
    
    return log;
  } catch (error) {
    console.error('Failed to log security event:', error);
    throw error;
  }
};

// Method to get security summary for user
securityLogSchema.statics.getUserSecuritySummary = async function(userId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const pipeline = [
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        timestamp: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: '$action',
        count: { $sum: 1 },
        lastOccurrence: { $max: '$timestamp' }
      }
    },
    {
      $sort: { lastOccurrence: -1 }
    }
  ];
  
  return await this.aggregate(pipeline);
};

// Method to detect suspicious patterns
securityLogSchema.statics.detectSuspiciousActivity = async function() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  // Find IPs with multiple failed login attempts
  const suspiciousIPs = await this.aggregate([
    {
      $match: {
        action: 'login_failure',
        timestamp: { $gte: oneHourAgo }
      }
    },
    {
      $group: {
        _id: '$ip',
        failedAttempts: { $sum: 1 },
        userIds: { $addToSet: '$userId' },
        lastAttempt: { $max: '$timestamp' }
      }
    },
    {
      $match: {
        failedAttempts: { $gte: 10 } // 10+ failed attempts in 1 hour
      }
    }
  ]);
  
  return suspiciousIPs;
};

module.exports = mongoose.model('SecurityLog', securityLogSchema);