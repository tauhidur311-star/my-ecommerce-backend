/**
 * Export Model
 * MongoDB schema for tracking page builder exports
 */

const mongoose = require('mongoose');

const exportSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  design: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Design',
    index: true
  },
  format: {
    type: String,
    required: true,
    enum: ['json', 'html', 'pdf', 'figma'],
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true
  },
  options: {
    includeAssets: {
      type: Boolean,
      default: true
    },
    compression: {
      type: Boolean,
      default: false
    },
    version: {
      type: String,
      default: '1.0.0'
    },
    metadata: {
      title: String,
      description: String,
      author: String,
      created: {
        type: Date,
        default: Date.now
      }
    }
  },
  result: {
    fileUrl: String, // URL to the exported file
    fileName: String,
    fileSize: Number, // in bytes
    downloadCount: {
      type: Number,
      default: 0
    },
    expiresAt: Date // When the export link expires
  },
  processing: {
    startedAt: Date,
    completedAt: Date,
    duration: Number, // in milliseconds
    error: String,
    logs: [String]
  },
  analytics: {
    userAgent: String,
    ipAddress: String,
    downloadedAt: [Date]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
exportSchema.index({ user: 1, createdAt: -1 });
exportSchema.index({ status: 1, createdAt: -1 });
exportSchema.index({ format: 1 });
exportSchema.index({ 'result.expiresAt': 1 }, { expireAfterSeconds: 0 });

// Virtual for processing duration in human readable format
exportSchema.virtual('processingDurationFormatted').get(function() {
  if (!this.processing.duration) return null;
  
  const seconds = Math.floor(this.processing.duration / 1000);
  const minutes = Math.floor(seconds / 60);
  
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
});

// Virtual for file size in human readable format
exportSchema.virtual('fileSizeFormatted').get(function() {
  if (!this.result.fileSize) return null;
  
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(this.result.fileSize) / Math.log(1024));
  return Math.round(this.result.fileSize / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
});

// Pre-save middleware
exportSchema.pre('save', function(next) {
  // Set expiration date for the export file (7 days from creation)
  if (this.isNew && this.status === 'completed' && !this.result.expiresAt) {
    this.result.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  }
  
  // Calculate processing duration
  if (this.processing.startedAt && this.processing.completedAt && !this.processing.duration) {
    this.processing.duration = this.processing.completedAt - this.processing.startedAt;
  }
  
  next();
});

// Instance methods
exportSchema.methods.markAsProcessing = function() {
  this.status = 'processing';
  this.processing.startedAt = new Date();
  return this.save();
};

exportSchema.methods.markAsCompleted = function(result) {
  this.status = 'completed';
  this.processing.completedAt = new Date();
  this.result = { ...this.result, ...result };
  this.result.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  return this.save();
};

exportSchema.methods.markAsFailed = function(error) {
  this.status = 'failed';
  this.processing.completedAt = new Date();
  this.processing.error = error;
  return this.save();
};

exportSchema.methods.incrementDownload = function() {
  this.result.downloadCount += 1;
  this.analytics.downloadedAt.push(new Date());
  return this.save();
};

exportSchema.methods.addLog = function(message) {
  this.processing.logs.push(`[${new Date().toISOString()}] ${message}`);
  return this.save();
};

// Static methods
exportSchema.statics.findByUser = function(userId, options = {}) {
  const { format, status, limit = 20, skip = 0 } = options;
  
  const query = { user: userId };
  if (format) query.format = format;
  if (status) query.status = status;
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('design', 'name thumbnail');
};

exportSchema.statics.getAnalytics = function(timeframe = '7d') {
  const startDate = new Date();
  
  switch (timeframe) {
    case '24h':
      startDate.setHours(startDate.getHours() - 24);
      break;
    case '7d':
      startDate.setDate(startDate.getDate() - 7);
      break;
    case '30d':
      startDate.setDate(startDate.getDate() - 30);
      break;
    case '90d':
      startDate.setDate(startDate.getDate() - 90);
      break;
  }
  
  return this.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: {
          format: '$format',
          status: '$status'
        },
        count: { $sum: 1 },
        totalSize: { $sum: '$result.fileSize' },
        avgDuration: { $avg: '$processing.duration' },
        totalDownloads: { $sum: '$result.downloadCount' }
      }
    },
    {
      $group: {
        _id: '$_id.format',
        stats: {
          $push: {
            status: '$_id.status',
            count: '$count',
            totalSize: '$totalSize',
            avgDuration: '$avgDuration',
            totalDownloads: '$totalDownloads'
          }
        },
        totalExports: { $sum: '$count' },
        totalSize: { $sum: '$totalSize' },
        totalDownloads: { $sum: '$totalDownloads' }
      }
    },
    { $sort: { totalExports: -1 } }
  ]);
};

exportSchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    'result.expiresAt': { $lt: new Date() },
    status: 'completed'
  });
};

module.exports = mongoose.model('Export', exportSchema);