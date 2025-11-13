const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [100, 'Name cannot exceed 100 characters'],
    match: [/^[a-zA-Z\s\-'\.]+$/, 'Name can only contain letters, spaces, hyphens, apostrophes, and periods']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'],
    maxlength: [254, 'Email address is too long']
  },
  subject: {
    type: String,
    required: [true, 'Subject is required'],
    enum: {
      values: ['general', 'support', 'billing', 'partnership', 'feedback', 'other'],
      message: 'Subject must be one of: general, support, billing, partnership, feedback, other'
    }
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true,
    minlength: [10, 'Message must be at least 10 characters'],
    maxlength: [2000, 'Message cannot exceed 2000 characters']
  },
  status: {
    type: String,
    enum: ['new', 'in-progress', 'resolved', 'closed'],
    default: 'new'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  ipAddress: {
    type: String,
    default: 'unknown'
  },
  userAgent: {
    type: String,
    default: 'unknown'
  },
  responseTime: {
    type: Date,
    default: null
  },
  resolvedAt: {
    type: Date,
    default: null
  },
  adminNotes: [{
    note: {
      type: String,
      maxlength: [1000, 'Admin note cannot exceed 1000 characters']
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  tags: [{
    type: String,
    lowercase: true,
    trim: true
  }],
  source: {
    type: String,
    enum: ['website', 'mobile', 'api', 'admin'],
    default: 'website'
  },
  isSpam: {
    type: Boolean,
    default: false
  },
  spamScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date,
    default: null
  },
  readBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
contactSchema.index({ email: 1 });
contactSchema.index({ status: 1 });
contactSchema.index({ subject: 1 });
contactSchema.index({ createdAt: -1 });
contactSchema.index({ assignedTo: 1 });
contactSchema.index({ isSpam: 1 });
contactSchema.index({ isRead: 1 });

// Compound indexes
contactSchema.index({ status: 1, createdAt: -1 });
contactSchema.index({ assignedTo: 1, status: 1 });

// Virtual for response time calculation
contactSchema.virtual('responseTimeHours').get(function() {
  if (this.responseTime && this.createdAt) {
    return Math.round((this.responseTime - this.createdAt) / (1000 * 60 * 60));
  }
  return null;
});

// Virtual for resolution time calculation
contactSchema.virtual('resolutionTimeHours').get(function() {
  if (this.resolvedAt && this.createdAt) {
    return Math.round((this.resolvedAt - this.createdAt) / (1000 * 60 * 60));
  }
  return null;
});

// Virtual for age in hours
contactSchema.virtual('ageInHours').get(function() {
  return Math.round((new Date() - this.createdAt) / (1000 * 60 * 60));
});

// Pre-save middleware for spam detection
contactSchema.pre('save', function(next) {
  if (this.isNew) {
    // Simple spam detection logic
    let spamScore = 0;
    
    // Check for suspicious patterns
    const suspiciousPatterns = [
      /viagra|cialis|pharmacy|casino|lottery|winner/i,
      /click here|visit now|act now|limited time/i,
      /free money|make money|work from home/i,
      /\$\d+|\d+% off|guaranteed/i
    ];
    
    const messageText = `${this.name} ${this.message}`.toLowerCase();
    
    suspiciousPatterns.forEach(pattern => {
      if (pattern.test(messageText)) {
        spamScore += 25;
      }
    });
    
    // Check for excessive caps
    const capsRatio = (this.message.match(/[A-Z]/g) || []).length / this.message.length;
    if (capsRatio > 0.5) {
      spamScore += 15;
    }
    
    // Check for excessive special characters
    const specialChars = (this.message.match(/[!@#$%^&*()]/g) || []).length;
    if (specialChars > 10) {
      spamScore += 10;
    }
    
    // Check for very short or very long messages
    if (this.message.length < 20) {
      spamScore += 10;
    } else if (this.message.length > 1500) {
      spamScore += 5;
    }
    
    this.spamScore = Math.min(spamScore, 100);
    
    // Mark as spam if score is high
    if (this.spamScore >= 75) {
      this.isSpam = true;
      this.status = 'closed';
    }
  }
  
  next();
});

// Static methods
contactSchema.statics.getStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        new: { $sum: { $cond: [{ $eq: ['$status', 'new'] }, 1, 0] } },
        inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in-progress'] }, 1, 0] } },
        resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } },
        spam: { $sum: { $cond: ['$isSpam', 1, 0] } },
        avgResponseTime: {
          $avg: {
            $cond: [
              '$responseTime',
              { $subtract: ['$responseTime', '$createdAt'] },
              null
            ]
          }
        }
      }
    }
  ]);
};

contactSchema.statics.getSubjectStats = function() {
  return this.aggregate([
    {
      $match: { isSpam: { $ne: true } }
    },
    {
      $group: {
        _id: '$subject',
        count: { $sum: 1 },
        latest: { $max: '$createdAt' }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
};

// Instance methods
contactSchema.methods.markAsRead = function(userId) {
  this.status = 'in-progress';
  this.responseTime = new Date();
  this.assignedTo = userId;
  return this.save();
};

contactSchema.methods.resolve = function(userId, note) {
  this.status = 'resolved';
  this.resolvedAt = new Date();
  if (note) {
    this.adminNotes.push({
      note,
      addedBy: userId,
      addedAt: new Date()
    });
  }
  return this.save();
};

contactSchema.methods.addNote = function(note, userId) {
  this.adminNotes.push({
    note,
    addedBy: userId,
    addedAt: new Date()
  });
  return this.save();
};

contactSchema.methods.markAsSpam = function() {
  this.isSpam = true;
  this.status = 'closed';
  this.spamScore = 100;
  return this.save();
};

module.exports = mongoose.model('Contact', contactSchema);