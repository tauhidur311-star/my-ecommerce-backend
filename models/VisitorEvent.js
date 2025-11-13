const mongoose = require('mongoose');

const visitorEventSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    index: true
  },
  page: {
    type: String,
    required: true,
    index: true
  },
  referrer: {
    type: String,
    default: ''
  },
  userAgent: {
    type: String,
    required: true
  },
  country: {
    type: String,
    default: 'Unknown'
  },
  deviceType: {
    type: String,
    enum: ['desktop', 'mobile', 'tablet'],
    required: true
  },
  ipAddress: {
    type: String,
    required: true
  },
  ts: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: false
});

// Compound indexes for performance
visitorEventSchema.index({ ts: -1, page: 1 });
visitorEventSchema.index({ sessionId: 1, ts: -1 });
visitorEventSchema.index({ deviceType: 1, ts: -1 });
visitorEventSchema.index({ country: 1, ts: -1 });

module.exports = mongoose.model('VisitorEvent', visitorEventSchema);