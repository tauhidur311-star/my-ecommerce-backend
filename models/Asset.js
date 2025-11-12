const mongoose = require('mongoose');

const AssetSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  originalName: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/avi', 'application/pdf']
  },
  width: {
    type: Number,
    default: null
  },
  height: {
    type: Number,
    default: null
  },
  alt: {
    type: String,
    trim: true,
    default: ''
  },
  tags: [{
    type: String,
    trim: true
  }],
  folder: {
    type: String,
    default: 'general',
    trim: true
  },
  // Enhanced storage and optimization support
  versions: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  storageInfo: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  optimized: {
    type: Boolean,
    default: false
  },
  thumbnailUrl: {
    type: String,
    default: null
  },
  // Usage tracking
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  },
  lastUsed: {
    type: Date,
    default: Date.now
  },
  usageCount: {
    type: Number,
    default: 0
  },
  // SEO and accessibility
  seoTitle: {
    type: String,
    trim: true,
    default: ''
  },
  seoDescription: {
    type: String,
    trim: true,
    default: ''
  }
});

// Text search index
AssetSchema.index({
  name: 'text',
  originalName: 'text',
  alt: 'text',
  tags: 'text'
}, {
  weights: {
    name: 10,
    alt: 5,
    tags: 3,
    originalName: 1
  }
});

// Method to increment usage
AssetSchema.methods.incrementUsage = function() {
  this.usageCount += 1;
  this.lastUsed = new Date();
  return this.save();
};

module.exports = mongoose.model('Asset', AssetSchema);