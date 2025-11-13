const mongoose = require('mongoose');

const testimonialSchema = new mongoose.Schema({
  customerName: {
    type: String,
    required: [true, 'Customer name is required'],
    trim: true,
    maxlength: [100, 'Customer name cannot exceed 100 characters']
  },
  reviewText: {
    type: String,
    required: [true, 'Review text is required'],
    trim: true,
    maxlength: [1000, 'Review text cannot exceed 1000 characters']
  },
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: 1,
    max: 5
  },
  avatarUrl: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    default: null
  },
  isVerified: {
    type: Boolean,
    default: true
  },
  source: {
    type: String,
    enum: ['admin', 'customer', 'imported'],
    default: 'admin'
  },
  customerEmail: {
    type: String,
    sparse: true,
    validate: {
      validator: function(email) {
        if (email) {
          return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(email);
        }
        return true;
      },
      message: 'Please enter a valid email address'
    }
  }
}, {
  timestamps: true
});

// Index for performance
testimonialSchema.index({ isActive: 1, order: 1 });
testimonialSchema.index({ rating: -1 });
testimonialSchema.index({ createdAt: -1 });

// Static method to get active testimonials
testimonialSchema.statics.getActiveTestimonials = function(limit = 10) {
  return this.find({ isActive: true })
    .sort({ order: 1, createdAt: -1 })
    .limit(limit)
    .populate('productId', 'name')
    .lean();
};

// Instance method to get star rating
testimonialSchema.methods.getStarRating = function() {
  return '★'.repeat(this.rating) + '☆'.repeat(5 - this.rating);
};

module.exports = mongoose.model('Testimonial', testimonialSchema);