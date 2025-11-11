const express = require('express');
const router = express.Router();
const Review = require('../models/Review');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');
const { validate } = require('../utils/validation');

// Get reviews for a product
router.get('/product/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      rating,
      verifiedOnly = false
    } = req.query;

    // Build query
    const query = {
      productId,
      status: 'approved'
    };

    if (rating) {
      query.rating = parseInt(rating);
    }

    if (verifiedOnly === 'true') {
      query.verifiedPurchase = true;
    }

    // Build sort object
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // If sorting by helpfulness, sort by helpfulVotes
    if (sortBy === 'helpful') {
      sortOptions.helpfulVotes = -1;
      delete sortOptions[sortBy];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get reviews with user information
    const reviews = await Review.find(query)
      .populate('userId', 'name avatar')
      .populate('replies.userId', 'name avatar')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count for pagination
    const totalCount = await Review.countDocuments(query);

    // Get product rating statistics
    const ratingStats = await Review.getProductRatingStats(productId);

    res.json({
      success: true,
      data: {
        reviews,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / parseInt(limit))
        },
        statistics: ratingStats
      }
    });
  } catch (error) {
    console.error('Get product reviews error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch reviews'
    });
  }
});

// Get user's reviews
router.get('/user', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const reviews = await Review.find({ userId: req.user.userId })
      .populate('productId', 'name images price')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const totalCount = await Review.countDocuments({ userId: req.user.userId });

    res.json({
      success: true,
      data: {
        reviews,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get user reviews error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user reviews'
    });
  }
});

// Check if user can review a product
router.get('/can-review/:productId', auth, async (req, res) => {
  try {
    const { productId } = req.params;
    const result = await Review.canUserReview(req.user.userId, productId);
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Check can review error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check review eligibility'
    });
  }
});

// Create a new review
router.post('/', auth, async (req, res) => {
  try {
    const {
      productId,
      rating,
      title,
      comment,
      aspects = {},
      images = []
    } = req.body;

    // Validate required fields
    if (!productId || !rating || !title || !comment) {
      return res.status(400).json({
        success: false,
        error: 'Product ID, rating, title, and comment are required'
      });
    }

    // Validate rating
    if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
      return res.status(400).json({
        success: false,
        error: 'Rating must be an integer between 1 and 5'
      });
    }

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Check if user can review this product
    const canReview = await Review.canUserReview(req.user.userId, productId);
    if (!canReview.canReview) {
      const errorMessages = {
        already_reviewed: 'You have already reviewed this product'
      };
      
      return res.status(400).json({
        success: false,
        error: errorMessages[canReview.reason] || 'Cannot review this product'
      });
    }

    // Create review
    const reviewData = {
      userId: req.user.userId,
      productId,
      rating,
      title: title.trim(),
      comment: comment.trim(),
      aspects,
      images,
      verifiedPurchase: canReview.verifiedPurchase,
      orderId: canReview.orderId,
      deviceInfo: {
        platform: req.get('User-Agent')?.includes('Mobile') ? 'mobile' : 'desktop',
        browser: getBrowserFromUserAgent(req.get('User-Agent') || '')
      },
      ipAddress: req.ip || req.connection.remoteAddress
    };

    // Auto-approve reviews from verified purchases, pending for others
    reviewData.status = canReview.verifiedPurchase ? 'approved' : 'pending';

    const review = new Review(reviewData);
    await review.save();

    // Populate user info for response
    await review.populate('userId', 'name avatar');

    // Update product rating if review is approved
    if (review.status === 'approved') {
      await updateProductRating(productId);
    }

    res.status(201).json({
      success: true,
      message: canReview.verifiedPurchase ? 
        'Review submitted and approved!' : 
        'Review submitted for moderation',
      data: review
    });
  } catch (error) {
    console.error('Create review error:', error);
    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        error: 'You have already reviewed this product'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to create review'
      });
    }
  }
});

// Update a review
router.put('/:reviewId', auth, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const {
      rating,
      title,
      comment,
      aspects,
      images
    } = req.body;

    const review = await Review.findOne({
      _id: reviewId,
      userId: req.user.userId
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    // Update fields if provided
    if (rating !== undefined) {
      if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        return res.status(400).json({
          success: false,
          error: 'Rating must be an integer between 1 and 5'
        });
      }
      review.rating = rating;
    }

    if (title !== undefined) review.title = title.trim();
    if (comment !== undefined) review.comment = comment.trim();
    if (aspects !== undefined) review.aspects = aspects;
    if (images !== undefined) review.images = images;

    // Reset status to pending for re-moderation if not a verified purchase
    if (!review.verifiedPurchase) {
      review.status = 'pending';
    }

    await review.save();
    await review.populate('userId', 'name avatar');

    // Update product rating
    await updateProductRating(review.productId);

    res.json({
      success: true,
      message: 'Review updated successfully',
      data: review
    });
  } catch (error) {
    console.error('Update review error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update review'
    });
  }
});

// Delete a review
router.delete('/:reviewId', auth, async (req, res) => {
  try {
    const { reviewId } = req.params;

    const review = await Review.findOne({
      _id: reviewId,
      userId: req.user.userId
    });

    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    const productId = review.productId;
    await review.deleteOne();

    // Update product rating
    await updateProductRating(productId);

    res.json({
      success: true,
      message: 'Review deleted successfully'
    });
  } catch (error) {
    console.error('Delete review error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete review'
    });
  }
});

// Vote on review helpfulness
router.post('/:reviewId/vote', auth, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { voteType } = req.body;

    if (!['helpful', 'unhelpful'].includes(voteType)) {
      return res.status(400).json({
        success: false,
        error: 'Vote type must be "helpful" or "unhelpful"'
      });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    // Don't allow voting on own review
    if (review.userId.toString() === req.user.userId) {
      return res.status(400).json({
        success: false,
        error: 'Cannot vote on your own review'
      });
    }

    review.vote(req.user.userId, voteType);
    await review.save();

    res.json({
      success: true,
      message: 'Vote recorded successfully',
      data: {
        helpfulVotes: review.helpfulVotes,
        unhelpfulVotes: review.unhelpfulVotes,
        helpfulnessRatio: review.helpfulnessRatio
      }
    });
  } catch (error) {
    console.error('Vote on review error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record vote'
    });
  }
});

// Report a review
router.post('/:reviewId/report', auth, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { reason, details = '' } = req.body;

    const validReasons = ['inappropriate', 'spam', 'fake', 'off-topic', 'other'];
    if (!reason || !validReasons.includes(reason)) {
      return res.status(400).json({
        success: false,
        error: 'Valid reason is required'
      });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    const reported = review.report(req.user.userId, reason, details);
    if (!reported) {
      return res.status(400).json({
        success: false,
        error: 'You have already reported this review'
      });
    }

    await review.save();

    res.json({
      success: true,
      message: 'Review reported successfully'
    });
  } catch (error) {
    console.error('Report review error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to report review'
    });
  }
});

// Reply to a review (for admins/sellers)
router.post('/:reviewId/reply', auth, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Reply message is required'
      });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    // Determine user type (for admin replies)
    const userType = req.user.role === 'admin' || req.user.role === 'super_admin' ? 'admin' : 'customer';

    review.addReply(req.user.userId, message.trim(), userType);
    await review.save();
    await review.populate('replies.userId', 'name avatar');

    res.json({
      success: true,
      message: 'Reply added successfully',
      data: review.replies
    });
  } catch (error) {
    console.error('Reply to review error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add reply'
    });
  }
});

// Admin: Get all reviews for moderation
router.get('/admin/pending', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'pending' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const reviews = await Review.find({ status })
      .populate('userId', 'name email avatar')
      .populate('productId', 'name images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const totalCount = await Review.countDocuments({ status });

    res.json({
      success: true,
      data: {
        reviews,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get pending reviews error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pending reviews'
    });
  }
});

// Admin: Moderate review
router.patch('/admin/:reviewId/moderate', adminAuth, async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { status, moderationNotes = '' } = req.body;

    const validStatuses = ['approved', 'rejected', 'flagged'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Valid status is required (approved, rejected, flagged)'
      });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({
        success: false,
        error: 'Review not found'
      });
    }

    review.status = status;
    review.moderationNotes = moderationNotes;
    await review.save();

    // Update product rating if approved
    if (status === 'approved') {
      await updateProductRating(review.productId);
    }

    res.json({
      success: true,
      message: `Review ${status} successfully`,
      data: review
    });
  } catch (error) {
    console.error('Moderate review error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to moderate review'
    });
  }
});

// Helper function to update product rating
async function updateProductRating(productId) {
  try {
    const stats = await Review.getProductRatingStats(productId);
    
    await Product.findByIdAndUpdate(productId, {
      averageRating: stats.averageRating,
      reviewCount: stats.totalReviews,
      ratingBreakdown: stats.ratingBreakdown
    });
  } catch (error) {
    console.error('Error updating product rating:', error);
  }
}

// Helper function to get browser from user agent
function getBrowserFromUserAgent(userAgent) {
  if (userAgent.includes('Chrome')) return 'Chrome';
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('Safari')) return 'Safari';
  if (userAgent.includes('Edge')) return 'Edge';
  return 'Unknown';
}

module.exports = router;