const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    maxlength: 20
  },
  description: {
    type: String,
    required: true,
    maxlength: 200
  },
  discountType: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true
  },
  discountValue: {
    type: Number,
    required: true,
    min: 0
  },
  maxDiscountAmount: {
    type: Number,
    default: null // Only for percentage discounts
  },
  minOrderAmount: {
    type: Number,
    default: 0
  },
  maxOrderAmount: {
    type: Number,
    default: null
  },
  usageLimit: {
    type: Number,
    default: null // null means unlimited
  },
  usageCount: {
    type: Number,
    default: 0
  },
  userUsageLimit: {
    type: Number,
    default: 1 // How many times a single user can use this coupon
  },
  usedBy: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    usedAt: {
      type: Date,
      default: Date.now
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order'
    },
    discountAmount: Number
  }],
  validFrom: {
    type: Date,
    default: Date.now
  },
  validUntil: {
    type: Date,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  applicableCategories: [{
    type: String
  }],
  excludedCategories: [{
    type: String
  }],
  applicableProducts: [{
    type: String // Product IDs
  }],
  excludedProducts: [{
    type: String // Product IDs
  }],
  firstTimeUserOnly: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

// Indexes
couponSchema.index({ code: 1 });
couponSchema.index({ validFrom: 1, validUntil: 1 });
couponSchema.index({ isActive: 1 });
couponSchema.index({ 'usedBy.userId': 1 });

// Virtuals
couponSchema.virtual('isExpired').get(function() {
  return Date.now() > this.validUntil;
});

couponSchema.virtual('isUsageLimitReached').get(function() {
  return this.usageLimit && this.usageCount >= this.usageLimit;
});

couponSchema.virtual('remainingUses').get(function() {
  if (!this.usageLimit) return null;
  return Math.max(0, this.usageLimit - this.usageCount);
});

// Methods
couponSchema.methods.canBeUsedBy = function(userId, orderAmount, cartItems = []) {
  // Check if coupon is active
  if (!this.isActive) {
    return { valid: false, reason: 'Coupon is not active' };
  }
  
  // Check if coupon is expired
  if (this.isExpired) {
    return { valid: false, reason: 'Coupon has expired' };
  }
  
  // Check if coupon is not yet valid
  if (Date.now() < this.validFrom) {
    return { valid: false, reason: 'Coupon is not yet valid' };
  }
  
  // Check usage limit
  if (this.isUsageLimitReached) {
    return { valid: false, reason: 'Coupon usage limit reached' };
  }
  
  // Check minimum order amount
  if (orderAmount < this.minOrderAmount) {
    return { valid: false, reason: `Minimum order amount is ৳${this.minOrderAmount}` };
  }
  
  // Check maximum order amount
  if (this.maxOrderAmount && orderAmount > this.maxOrderAmount) {
    return { valid: false, reason: `Maximum order amount is ৳${this.maxOrderAmount}` };
  }
  
  // Check user usage limit
  const userUsageCount = this.usedBy.filter(usage => usage.userId.toString() === userId.toString()).length;
  if (userUsageCount >= this.userUsageLimit) {
    return { valid: false, reason: 'You have already used this coupon' };
  }
  
  // Check if first time user only
  if (this.firstTimeUserOnly) {
    // This would require checking if user has any previous orders
    // Implementation depends on your business logic
  }
  
  // Check category restrictions
  if (this.applicableCategories.length > 0 || this.excludedCategories.length > 0) {
    const cartCategories = cartItems.map(item => item.category);
    
    if (this.applicableCategories.length > 0) {
      const hasApplicableCategory = cartCategories.some(cat => 
        this.applicableCategories.includes(cat)
      );
      if (!hasApplicableCategory) {
        return { valid: false, reason: 'Coupon not applicable to items in cart' };
      }
    }
    
    if (this.excludedCategories.length > 0) {
      const hasExcludedCategory = cartCategories.some(cat => 
        this.excludedCategories.includes(cat)
      );
      if (hasExcludedCategory) {
        return { valid: false, reason: 'Coupon not applicable to some items in cart' };
      }
    }
  }
  
  // Check product restrictions
  if (this.applicableProducts.length > 0 || this.excludedProducts.length > 0) {
    const cartProductIds = cartItems.map(item => item.productId);
    
    if (this.applicableProducts.length > 0) {
      const hasApplicableProduct = cartProductIds.some(id => 
        this.applicableProducts.includes(id)
      );
      if (!hasApplicableProduct) {
        return { valid: false, reason: 'Coupon not applicable to items in cart' };
      }
    }
    
    if (this.excludedProducts.length > 0) {
      const hasExcludedProduct = cartProductIds.some(id => 
        this.excludedProducts.includes(id)
      );
      if (hasExcludedProduct) {
        return { valid: false, reason: 'Coupon not applicable to some items in cart' };
      }
    }
  }
  
  return { valid: true };
};

couponSchema.methods.calculateDiscount = function(orderAmount) {
  let discountAmount = 0;
  
  if (this.discountType === 'percentage') {
    discountAmount = (orderAmount * this.discountValue) / 100;
    
    // Apply maximum discount limit if set
    if (this.maxDiscountAmount && discountAmount > this.maxDiscountAmount) {
      discountAmount = this.maxDiscountAmount;
    }
  } else if (this.discountType === 'fixed') {
    discountAmount = this.discountValue;
    
    // Don't allow discount to exceed order amount
    if (discountAmount > orderAmount) {
      discountAmount = orderAmount;
    }
  }
  
  return Math.round(discountAmount * 100) / 100; // Round to 2 decimal places
};

couponSchema.methods.markAsUsed = function(userId, orderId, discountAmount) {
  this.usedBy.push({
    userId,
    orderId,
    discountAmount,
    usedAt: new Date()
  });
  
  this.usageCount += 1;
  return this.save();
};

// Statics
couponSchema.statics.findValidCoupon = async function(code, userId, orderAmount, cartItems = []) {
  const coupon = await this.findOne({ 
    code: code.toUpperCase(),
    isActive: true 
  });
  
  if (!coupon) {
    return { coupon: null, error: 'Invalid coupon code' };
  }
  
  const validation = coupon.canBeUsedBy(userId, orderAmount, cartItems);
  
  if (!validation.valid) {
    return { coupon: null, error: validation.reason };
  }
  
  const discountAmount = coupon.calculateDiscount(orderAmount);
  
  return { 
    coupon, 
    discountAmount,
    error: null 
  };
};

// Clean up expired coupons
couponSchema.statics.cleanupExpiredCoupons = async function() {
  const result = await this.updateMany(
    { validUntil: { $lt: new Date() } },
    { $set: { isActive: false } }
  );
  
  return result.modifiedCount;
};

module.exports = mongoose.model('Coupon', couponSchema);