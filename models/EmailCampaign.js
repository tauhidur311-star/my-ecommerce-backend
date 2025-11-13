const mongoose = require('mongoose');

const emailCampaignSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Campaign name is required'],
    trim: true,
    maxlength: [100, 'Campaign name cannot exceed 100 characters']
  },
  subject: {
    type: String,
    required: [true, 'Email subject is required'],
    trim: true,
    maxlength: [200, 'Subject cannot exceed 200 characters']
  },
  htmlContent: {
    type: String,
    required: [true, 'Email content is required']
  },
  textContent: {
    type: String,
    default: ''
  },
  templateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EmailTemplate',
    default: null
  },
  recipientList: [{
    email: {
      type: String,
      required: true
    },
    name: {
      type: String,
      default: ''
    },
    customVariables: {
      type: Map,
      of: String,
      default: {}
    }
  }],
  recipientFilter: {
    type: {
      type: String,
      enum: ['all', 'customers', 'subscribers', 'custom'],
      default: 'all'
    },
    criteria: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'sending', 'sent', 'cancelled', 'failed'],
    default: 'draft'
  },
  scheduledAt: {
    type: Date,
    default: null
  },
  sentAt: {
    type: Date,
    default: null
  },
  analytics: {
    totalSent: {
      type: Number,
      default: 0
    },
    totalDelivered: {
      type: Number,
      default: 0
    },
    totalOpened: {
      type: Number,
      default: 0
    },
    totalClicked: {
      type: Number,
      default: 0
    },
    totalBounced: {
      type: Number,
      default: 0
    },
    uniqueOpens: {
      type: Number,
      default: 0
    },
    uniqueClicks: {
      type: Number,
      default: 0
    },
    openRate: {
      type: Number,
      default: 0
    },
    clickRate: {
      type: Number,
      default: 0
    },
    bounceRate: {
      type: Number,
      default: 0
    }
  },
  settings: {
    trackOpens: {
      type: Boolean,
      default: true
    },
    trackClicks: {
      type: Boolean,
      default: true
    },
    replyTo: {
      type: String,
      default: ''
    },
    fromName: {
      type: String,
      default: process.env.APP_NAME || 'StyleShop'
    }
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  cronJobId: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Indexes for performance
emailCampaignSchema.index({ status: 1 });
emailCampaignSchema.index({ scheduledAt: 1 });
emailCampaignSchema.index({ createdBy: 1 });
emailCampaignSchema.index({ 'recipientList.email': 1 });

// Virtual for open rate calculation
emailCampaignSchema.virtual('calculatedOpenRate').get(function() {
  if (this.analytics.totalSent === 0) return 0;
  return ((this.analytics.totalOpened / this.analytics.totalSent) * 100).toFixed(2);
});

// Virtual for click rate calculation
emailCampaignSchema.virtual('calculatedClickRate').get(function() {
  if (this.analytics.totalSent === 0) return 0;
  return ((this.analytics.totalClicked / this.analytics.totalSent) * 100).toFixed(2);
});

// Method to update analytics
emailCampaignSchema.methods.updateAnalytics = function() {
  if (this.analytics.totalSent > 0) {
    this.analytics.openRate = parseFloat(((this.analytics.totalOpened / this.analytics.totalSent) * 100).toFixed(2));
    this.analytics.clickRate = parseFloat(((this.analytics.totalClicked / this.analytics.totalSent) * 100).toFixed(2));
    this.analytics.bounceRate = parseFloat(((this.analytics.totalBounced / this.analytics.totalSent) * 100).toFixed(2));
  }
};

// Static method to get campaign statistics
emailCampaignSchema.statics.getCampaignStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: null,
        totalCampaigns: { $sum: 1 },
        totalSent: { $sum: '$analytics.totalSent' },
        totalOpened: { $sum: '$analytics.totalOpened' },
        totalClicked: { $sum: '$analytics.totalClicked' },
        avgOpenRate: { $avg: '$analytics.openRate' },
        avgClickRate: { $avg: '$analytics.clickRate' }
      }
    }
  ]);
  
  return stats[0] || {
    totalCampaigns: 0,
    totalSent: 0,
    totalOpened: 0,
    totalClicked: 0,
    avgOpenRate: 0,
    avgClickRate: 0
  };
};

// Pre-save middleware to update analytics
emailCampaignSchema.pre('save', function(next) {
  if (this.isModified('analytics')) {
    this.updateAnalytics();
  }
  next();
});

module.exports = mongoose.model('EmailCampaign', emailCampaignSchema);