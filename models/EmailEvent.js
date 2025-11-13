const mongoose = require('mongoose');

const emailEventSchema = new mongoose.Schema({
  campaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EmailCampaign',
    required: true,
    index: true
  },
  recipientEmail: {
    type: String,
    required: true,
    index: true
  },
  eventType: {
    type: String,
    enum: ['sent', 'delivered', 'open', 'click', 'bounce', 'spam', 'unsubscribe'],
    required: true,
    index: true
  },
  eventData: {
    userAgent: String,
    ipAddress: String,
    clickedUrl: String,
    bounceReason: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  messageId: {
    type: String,
    index: true
  },
  mailjetMessageId: {
    type: String,
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
emailEventSchema.index({ campaignId: 1, eventType: 1 });
emailEventSchema.index({ campaignId: 1, recipientEmail: 1 });
emailEventSchema.index({ eventType: 1, createdAt: 1 });

// Static method to get events for a campaign
emailEventSchema.statics.getCampaignEvents = function(campaignId, eventType = null) {
  const query = { campaignId };
  if (eventType) {
    query.eventType = eventType;
  }
  
  return this.find(query).sort({ createdAt: -1 });
};

// Static method to get unique events (for calculating unique opens/clicks)
emailEventSchema.statics.getUniqueEvents = function(campaignId, eventType) {
  return this.distinct('recipientEmail', { campaignId, eventType });
};

// Static method to aggregate campaign analytics
emailEventSchema.statics.aggregateCampaignAnalytics = async function(campaignId) {
  const pipeline = [
    { $match: { campaignId: new mongoose.Types.ObjectId(campaignId) } },
    {
      $group: {
        _id: '$eventType',
        count: { $sum: 1 },
        uniqueRecipients: { $addToSet: '$recipientEmail' }
      }
    },
    {
      $project: {
        eventType: '$_id',
        count: 1,
        uniqueCount: { $size: '$uniqueRecipients' }
      }
    }
  ];

  const results = await this.aggregate(pipeline);
  
  // Convert results to easier format
  const analytics = {};
  results.forEach(result => {
    analytics[result.eventType] = {
      total: result.count,
      unique: result.uniqueCount
    };
  });

  return analytics;
};

module.exports = mongoose.model('EmailEvent', emailEventSchema);