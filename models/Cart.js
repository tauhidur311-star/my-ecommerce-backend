const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
  productId: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  size: {
    type: String,
    default: null
  },
  color: {
    type: String,
    default: null
  },
  price: {
    type: Number,
    required: true
  },
  originalPrice: Number,
  discount: Number,
  // Cache product data for performance
  productData: {
    name: String,
    images: [String],
    description: String,
    category: String,
    brand: String,
    inStock: Boolean,
    maxQuantity: Number
  },
  addedAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  _id: false
});

const cartSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  items: [cartItemSchema],
  totalItems: {
    type: Number,
    default: 0
  },
  subtotal: {
    type: Number,
    default: 0
  },
  totalDiscount: {
    type: Number,
    default: 0
  },
  estimatedTax: {
    type: Number,
    default: 0
  },
  estimatedShipping: {
    type: Number,
    default: 0
  },
  estimatedTotal: {
    type: Number,
    default: 0
  },
  appliedCoupons: [{
    code: String,
    discountAmount: Number,
    discountType: {
      type: String,
      enum: ['percentage', 'fixed']
    }
  }],
  shippingAddress: {
    name: String,
    phone: String,
    address: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  lastActivity: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Indexes
cartSchema.index({ userId: 1 });
cartSchema.index({ lastActivity: 1 }); // For cleanup of abandoned carts
cartSchema.index({ 'items.productId': 1 });

// Virtual for cart weight (if needed for shipping calculation)
cartSchema.virtual('totalWeight').get(function() {
  return this.items.reduce((total, item) => {
    return total + (item.productData.weight || 0) * item.quantity;
  }, 0);
});

// Methods
cartSchema.methods.addItem = async function(productData, quantity = 1, options = {}) {
  const { size, color } = options;
  const existingItemIndex = this.items.findIndex(item => 
    item.productId === productData.id &&
    item.size === size &&
    item.color === color
  );

  if (existingItemIndex >= 0) {
    // Update existing item
    this.items[existingItemIndex].quantity += quantity;
    this.items[existingItemIndex].updatedAt = new Date();
    this.items[existingItemIndex].productData = {
      name: productData.name,
      images: productData.images,
      description: productData.description,
      category: productData.category,
      brand: productData.brand,
      inStock: productData.inStock,
      maxQuantity: productData.stock
    };
  } else {
    // Add new item
    this.items.push({
      productId: productData.id,
      quantity,
      size,
      color,
      price: productData.price,
      originalPrice: productData.originalPrice,
      discount: productData.discount,
      productData: {
        name: productData.name,
        images: productData.images,
        description: productData.description,
        category: productData.category,
        brand: productData.brand,
        inStock: productData.inStock,
        maxQuantity: productData.stock
      }
    });
  }

  this.lastActivity = new Date();
  await this.calculateTotals();
  return this.save();
};

cartSchema.methods.removeItem = function(productId, size = null, color = null) {
  this.items = this.items.filter(item => 
    !(item.productId === productId && 
      item.size === size && 
      item.color === color)
  );
  
  this.lastActivity = new Date();
  this.calculateTotals();
  return this.save();
};

cartSchema.methods.updateQuantity = function(productId, quantity, size = null, color = null) {
  const item = this.items.find(item => 
    item.productId === productId &&
    item.size === size &&
    item.color === color
  );

  if (item) {
    if (quantity <= 0) {
      return this.removeItem(productId, size, color);
    }
    
    item.quantity = quantity;
    item.updatedAt = new Date();
    this.lastActivity = new Date();
    this.calculateTotals();
  }
  
  return this.save();
};

cartSchema.methods.clearCart = function() {
  this.items = [];
  this.appliedCoupons = [];
  this.calculateTotals();
  return this.save();
};

cartSchema.methods.calculateTotals = function() {
  this.totalItems = this.items.reduce((total, item) => total + item.quantity, 0);
  
  this.subtotal = this.items.reduce((total, item) => {
    return total + (item.price * item.quantity);
  }, 0);
  
  this.totalDiscount = this.items.reduce((total, item) => {
    const itemDiscount = item.originalPrice 
      ? (item.originalPrice - item.price) * item.quantity
      : 0;
    return total + itemDiscount;
  }, 0);
  
  // Add coupon discounts
  const couponDiscount = this.appliedCoupons.reduce((total, coupon) => {
    return total + coupon.discountAmount;
  }, 0);
  
  this.totalDiscount += couponDiscount;
  
  // Calculate tax (placeholder - implement based on business logic)
  this.estimatedTax = this.subtotal * 0.1; // 10% tax rate
  
  // Calculate shipping (placeholder - implement based on business logic)
  this.estimatedShipping = this.subtotal > 1000 ? 0 : 100; // Free shipping over 1000 BDT
  
  this.estimatedTotal = this.subtotal - this.totalDiscount + this.estimatedTax + this.estimatedShipping;
  
  return this;
};

cartSchema.methods.applyCoupon = function(couponCode, discountAmount, discountType) {
  // Remove existing coupon if already applied
  this.appliedCoupons = this.appliedCoupons.filter(c => c.code !== couponCode);
  
  // Add new coupon
  this.appliedCoupons.push({
    code: couponCode,
    discountAmount,
    discountType
  });
  
  this.calculateTotals();
  return this.save();
};

cartSchema.methods.removeCoupon = function(couponCode) {
  this.appliedCoupons = this.appliedCoupons.filter(c => c.code !== couponCode);
  this.calculateTotals();
  return this.save();
};

// Statics
cartSchema.statics.findOrCreateByUserId = async function(userId) {
  let cart = await this.findOne({ userId });
  
  if (!cart) {
    cart = new this({ 
      userId,
      items: [],
      lastActivity: new Date()
    });
    await cart.save();
  }
  
  return cart;
};

// Remove abandoned carts (older than 30 days)
cartSchema.statics.cleanupAbandonedCarts = async function() {
  const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
  
  const result = await this.deleteMany({
    lastActivity: { $lt: cutoffDate }
  });
  
  return result.deletedCount;
};

// Pre-save middleware to update totals
cartSchema.pre('save', function(next) {
  this.calculateTotals();
  next();
});

module.exports = mongoose.model('Cart', cartSchema);