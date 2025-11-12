const mongoose = require('mongoose');

const ReusableBlockSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  category: {
    type: String,
    default: 'general',
    enum: ['general', 'hero', 'product', 'content', 'footer', 'navigation', 'testimonial', 'gallery', 'form']
  },
  type: {
    type: String,
    required: true,
    enum: ['hero', 'product-grid', 'image-text', 'testimonials', 'footer', 'html', 'gallery', 'newsletter', 'contact-form']
  },
  settings: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  preview: {
    type: String, // Base64 encoded preview image or screenshot
    default: null
  },
  tags: [{
    type: String,
    trim: true
  }],
  isPublic: {
    type: Boolean,
    default: false
  },
  usageCount: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Text search index
ReusableBlockSchema.index({
  name: 'text',
  description: 'text',
  tags: 'text'
});

// Auto-update timestamp
ReusableBlockSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to increment usage
ReusableBlockSchema.methods.incrementUsage = function() {
  this.usageCount += 1;
  return this.save();
};

module.exports = mongoose.model('ReusableBlock', ReusableBlockSchema);