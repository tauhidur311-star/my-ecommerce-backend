const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    required: true,
    maxlength: 500
  },
  verified: {
    type: Boolean,
    default: false
  },
  helpful: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const variantSchema = new mongoose.Schema({
  size: String,
  color: String,
  sku: String,
  stock: {
    type: Number,
    default: 0
  },
  price: {
    type: Number,
    min: 0
  },
  images: [String]
});

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    maxlength: 2000
  },
  shortDescription: {
    type: String,
    maxlength: 500
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  originalPrice: {
    type: Number,
    min: 0
  },
  category: {
    type: String,
    required: true
    // Removed enum restriction to allow any category
  },
  subcategory: String,
  brand: String,
  sku: {
    type: String,
    unique: true,
    required: true
  },
  images: [{
    type: String,
    required: true
  }],
  image: String, // Main image (for backward compatibility)
  variants: [variantSchema],
  sizes: [String],
  colors: [String],
  tags: [String],
  features: [String],
  specifications: {
    type: Map,
    of: String
  },
  dimensions: {
    weight: Number,
    length: Number,
    width: Number,
    height: Number
  },
  inStock: {
    type: Boolean,
    default: true
  },
  stock: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  lowStockThreshold: {
    type: Number,
    default: 10
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  reviewCount: {
    type: Number,
    default: 0
  },
  // Enhanced review system
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  ratingBreakdown: {
    5: { type: Number, default: 0 },
    4: { type: Number, default: 0 },
    3: { type: Number, default: 0 },
    2: { type: Number, default: 0 },
    1: { type: Number, default: 0 }
  },
  reviews: [reviewSchema],
  featured: {
    type: Boolean,
    default: false
  },
  bestseller: {
    type: Boolean,
    default: false
  },
  newArrival: {
    type: Boolean,
    default: false
  },
  onSale: {
    type: Boolean,
    default: false
  },
  discount: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  seoTitle: String,
  seoDescription: String,
  seoKeywords: [String],
  status: {
    type: String,
    enum: ['active', 'inactive', 'draft', 'discontinued'],
    default: 'active'
  },
  visibility: {
    type: String,
    enum: ['public', 'private', 'hidden'],
    default: 'public'
  },
  viewCount: {
    type: Number,
    default: 0
  },
  salesCount: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
productSchema.index({ name: 'text', description: 'text', tags: 'text' });
productSchema.index({ category: 1, subcategory: 1 });
productSchema.index({ price: 1 });
productSchema.index({ rating: -1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ featured: -1, createdAt: -1 });
productSchema.index({ bestseller: -1, salesCount: -1 });
productSchema.index({ sku: 1 }, { unique: true });

// Virtual for discount percentage
productSchema.virtual('discountPercentage').get(function() {
  if (this.originalPrice && this.originalPrice > this.price) {
    return Math.round(((this.originalPrice - this.price) / this.originalPrice) * 100);
  }
  return this.discount || 0;
});

// Note: averageRating is now a real field in the schema, not a virtual

// Virtual for stock status
productSchema.virtual('stockStatus').get(function() {
  if (this.stock <= 0) return 'out-of-stock';
  if (this.stock <= this.lowStockThreshold) return 'low-stock';
  return 'in-stock';
});

// Pre-save middleware
productSchema.pre('save', function(next) {
  // Update inStock based on stock quantity
  this.inStock = this.stock > 0;
  
  // Set main image from images array if not set
  if (!this.image && this.images && this.images.length > 0) {
    this.image = this.images[0];
  }
  
  // Calculate rating and review count
  if (this.reviews && this.reviews.length > 0) {
    const sum = this.reviews.reduce((acc, review) => acc + review.rating, 0);
    this.rating = Math.round((sum / this.reviews.length) * 10) / 10;
    this.averageRating = this.rating; // Update averageRating field as well
    this.reviewCount = this.reviews.length;
  }
  
  // Auto-generate SKU if not provided
  if (!this.sku) {
    this.sku = `PRD-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }
  
  next();
});

// Instance methods
productSchema.methods.updateStock = function(quantity, operation = 'subtract') {
  if (operation === 'subtract') {
    this.stock = Math.max(0, this.stock - quantity);
  } else if (operation === 'add') {
    this.stock += quantity;
  }
  this.inStock = this.stock > 0;
  return this.save();
};

productSchema.methods.addReview = function(userId, name, rating, comment) {
  this.reviews.push({
    user: userId,
    name,
    rating,
    comment
  });
  return this.save();
};

productSchema.methods.incrementView = function() {
  this.viewCount += 1;
  return this.save();
};

productSchema.methods.incrementSales = function(quantity = 1) {
  this.salesCount += quantity;
  return this.save();
};

// Static methods
productSchema.statics.findByCategory = function(category, options = {}) {
  const query = { category, status: 'active', visibility: 'public' };
  return this.find(query, null, options);
};

productSchema.statics.findFeatured = function(limit = 10) {
  return this.find({ 
    featured: true, 
    status: 'active', 
    visibility: 'public',
    inStock: true 
  }).limit(limit).sort({ createdAt: -1 });
};

productSchema.statics.findBestsellers = function(limit = 10) {
  return this.find({ 
    bestseller: true, 
    status: 'active', 
    visibility: 'public' 
  }).limit(limit).sort({ salesCount: -1 });
};

productSchema.statics.search = function(searchTerm, options = {}) {
  const query = {
    $text: { $search: searchTerm },
    status: 'active',
    visibility: 'public'
  };
  
  return this.find(query, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(options.limit || 20);
};

module.exports = mongoose.model('Product', productSchema);