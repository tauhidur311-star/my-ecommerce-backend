const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  productId: {
    type: String,
    required: true,
    index: true
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  title: {
    type: String,
    required: true,
    maxlength: 100,
    trim: true
  },
  comment: {
    type: String,
    required: true,
    maxlength: 1000,
    trim: true
  },
  images: [{
    url: String,
    publicId: String
  }],
  isVerifiedPurchase: {
    type: Boolean,
    default: false
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  moderationNotes: String,
  helpfulVotes: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    isHelpful: Boolean,
    votedAt: {
      type: Date,
      default: Date.now
    }
  }],
  helpfulCount: {
    type: Number,
    default: 0
  },
  notHelpfulCount: {
    type: Number,
    default: 0
  },
  response: {
    text: String,
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    respondedAt: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Ensure user can only review a product once per order
reviewSchema.index({ userId: 1, productId: 1, orderId: 1 }, { unique: true });

// Index for efficient querying
reviewSchema.index({ productId: 1, isApproved: 1 });
reviewSchema.index({ userId: 1 });
reviewSchema.index({ rating: 1 });
reviewSchema.index({ createdAt: -1 });

// Virtual for calculating helpfulness ratio
reviewSchema.virtual('helpfulnessRatio').get(function() {
  const total = this.helpfulCount + this.notHelpfulCount;
  return total > 0 ? this.helpfulCount / total : 0;
});

// Methods
reviewSchema.methods.updateHelpfulCounts = function() {
  this.helpfulCount = this.helpfulVotes.filter(vote => vote.isHelpful).length;
  this.notHelpfulCount = this.helpfulVotes.filter(vote => !vote.isHelpful).length;
  return this.save();
};

reviewSchema.methods.addHelpfulVote = function(userId, isHelpful) {
  // Remove existing vote if any
  this.helpfulVotes = this.helpfulVotes.filter(
    vote => vote.userId.toString() !== userId.toString()
  );
  
  // Add new vote
  this.helpfulVotes.push({
    userId,
    isHelpful,
    votedAt: new Date()
  });
  
  return this.updateHelpfulCounts();
};

// Statics
reviewSchema.statics.getProductStats = async function(productId) {
  const stats = await this.aggregate([
    { $match: { productId, isApproved: true } },
    {
      $group: {
        _id: null,
        totalReviews: { $sum: 1 },
        averageRating: { $avg: '$rating' },
        ratingDistribution: {
          $push: '$rating'
        }
      }
    }
  ]);
  
  if (stats.length === 0) {
    return {
      totalReviews: 0,
      averageRating: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    };
  }
  
  const result = stats[0];
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  
  result.ratingDistribution.forEach(rating => {
    distribution[rating]++;
  });
  
  return {
    totalReviews: result.totalReviews,
    averageRating: Math.round(result.averageRating * 10) / 10,
    ratingDistribution: distribution
  };
};

reviewSchema.statics.canUserReview = async function(userId, productId, orderId) {
  // Check if user has purchased this product
  const Order = mongoose.model('Order');
  const order = await Order.findOne({
    _id: orderId,
    userId,
    'items.productId': productId,
    status: 'delivered'
  });
  
  if (!order) return false;
  
  // Check if user has already reviewed this product for this order
  const existingReview = await this.findOne({
    userId,
    productId,
    orderId
  });
  
  return !existingReview;
};

module.exports = mongoose.model('Review', reviewSchema);