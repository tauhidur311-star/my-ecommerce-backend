const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: false // Optional, for verified purchases
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
    validate: {
      validator: Number.isInteger,
      message: 'Rating must be an integer between 1 and 5'
    }
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  comment: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  images: [{
    url: String,
    alt: String
  }],
  // Review attributes/aspects
  aspects: {
    quality: { type: Number, min: 1, max: 5 },
    value: { type: Number, min: 1, max: 5 },
    design: { type: Number, min: 1, max: 5 },
    comfort: { type: Number, min: 1, max: 5 },
    sizing: { type: Number, min: 1, max: 5 }
  },
  // Purchase verification
  verifiedPurchase: {
    type: Boolean,
    default: false
  },
  purchaseDate: {
    type: Date,
    required: false
  },
  // Helpfulness voting
  helpfulVotes: {
    type: Number,
    default: 0
  },
  unhelpfulVotes: {
    type: Number,
    default: 0
  },
  voters: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    vote: {
      type: String,
      enum: ['helpful', 'unhelpful']
    }
  }],
  // Review status
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'flagged'],
    default: 'pending'
  },
  moderationNotes: {
    type: String,
    maxlength: 500
  },
  // Engagement metrics
  replies: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    message: {
      type: String,
      maxlength: 500
    },
    createdAt: {
      type: Date,
      default: Date.now
    },
    userType: {
      type: String,
      enum: ['customer', 'admin', 'seller'],
      default: 'customer'
    }
  }],
  // Reporting
  reports: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: {
      type: String,
      enum: ['inappropriate', 'spam', 'fake', 'off-topic', 'other'],
      required: true
    },
    details: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  lastModified: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Virtual for helpfulness ratio
reviewSchema.virtual('helpfulnessRatio').get(function() {
  const totalVotes = this.helpfulVotes + this.unhelpfulVotes;
  if (totalVotes === 0) return 0;
  return (this.helpfulVotes / totalVotes) * 100;
});

// Virtual for time since review
reviewSchema.virtual('timeAgo').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
});

// Compound index to prevent duplicate reviews from same user for same product
reviewSchema.index({ userId: 1, productId: 1 }, { unique: true });

// Index for efficient querying
reviewSchema.index({ productId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ userId: 1, createdAt: -1 });
reviewSchema.index({ status: 1 });
reviewSchema.index({ rating: 1 });
reviewSchema.index({ verifiedPurchase: 1 });

// Static method to calculate product rating statistics
reviewSchema.statics.getProductRatingStats = async function(productId) {
  try {
    const stats = await this.aggregate([
      {
        $match: {
          productId: new mongoose.Types.ObjectId(productId),
          status: 'approved'
        }
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          ratingDistribution: {
            $push: '$rating'
          },
          verifiedPurchases: {
            $sum: { $cond: ['$verifiedPurchase', 1, 0] }
          }
        }
      },
      {
        $addFields: {
          ratingBreakdown: {
            5: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 5] } } } },
            4: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 4] } } } },
            3: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 3] } } } },
            2: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 2] } } } },
            1: { $size: { $filter: { input: '$ratingDistribution', cond: { $eq: ['$$this', 1] } } } }
          }
        }
      }
    ]);

    return stats[0] || {
      averageRating: 0,
      totalReviews: 0,
      ratingBreakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
      verifiedPurchases: 0
    };
  } catch (error) {
    console.error('Error calculating product rating stats:', error);
    throw error;
  }
};

// Method to check if user can review product
reviewSchema.statics.canUserReview = async function(userId, productId) {
  try {
    // Check if user already reviewed this product
    const existingReview = await this.findOne({ userId, productId });
    if (existingReview) {
      return { canReview: false, reason: 'already_reviewed' };
    }

    // Check if user purchased this product
    const Order = mongoose.model('Order');
    const purchase = await Order.findOne({
      userId,
      'items.productId': productId,
      status: { $in: ['delivered', 'completed'] }
    });

    if (!purchase) {
      return { canReview: true, verifiedPurchase: false };
    }

    return { canReview: true, verifiedPurchase: true, orderId: purchase._id };
  } catch (error) {
    console.error('Error checking if user can review:', error);
    throw error;
  }
};

// Method to vote on helpfulness
reviewSchema.methods.vote = function(userId, voteType) {
  // Remove any existing vote from this user
  this.voters = this.voters.filter(voter => voter.userId.toString() !== userId.toString());
  
  // Add new vote
  this.voters.push({ userId, vote: voteType });
  
  // Recalculate vote counts
  this.helpfulVotes = this.voters.filter(voter => voter.vote === 'helpful').length;
  this.unhelpfulVotes = this.voters.filter(voter => voter.vote === 'unhelpful').length;
};

// Method to add reply
reviewSchema.methods.addReply = function(userId, message, userType = 'customer') {
  this.replies.push({
    userId,
    message,
    userType,
    createdAt: new Date()
  });
};

// Method to report review
reviewSchema.methods.report = function(userId, reason, details = '') {
  // Check if user already reported this review
  const existingReport = this.reports.find(report => report.userId.toString() === userId.toString());
  if (existingReport) {
    return false; // Already reported
  }

  this.reports.push({
    userId,
    reason,
    details,
    createdAt: new Date()
  });

  // Auto-flag if multiple reports
  if (this.reports.length >= 3) {
    this.status = 'flagged';
  }

  return true;
};

// Pre-save middleware to update lastModified
reviewSchema.pre('save', function(next) {
  this.lastModified = new Date();
  next();
});

module.exports = mongoose.model('Review', reviewSchema);