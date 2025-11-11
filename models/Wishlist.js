const mongoose = require('mongoose');

const wishlistSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  items: [{
    productId: {
      type: String,
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    productData: {
      name: String,
      price: Number,
      originalPrice: Number,
      images: [String],
      description: String,
      category: String,
      rating: Number,
      discount: Number,
      stock: Number
    }
  }],
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Update the updatedAt field before saving
wishlistSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Methods
wishlistSchema.methods.addItem = function(productId, productData) {
  const existingItem = this.items.find(item => item.productId === productId);
  
  if (existingItem) {
    // Update existing item with latest product data
    existingItem.productData = productData;
    existingItem.addedAt = Date.now();
  } else {
    // Add new item
    this.items.unshift({
      productId,
      productData,
      addedAt: Date.now()
    });
  }
  
  return this.save();
};

wishlistSchema.methods.removeItem = function(productId) {
  this.items = this.items.filter(item => item.productId !== productId);
  return this.save();
};

wishlistSchema.methods.clearAll = function() {
  this.items = [];
  return this.save();
};

wishlistSchema.methods.getItemIds = function() {
  return this.items.map(item => item.productId);
};

// Statics
wishlistSchema.statics.findOrCreateByUserId = async function(userId) {
  let wishlist = await this.findOne({ userId });
  
  if (!wishlist) {
    wishlist = new this({ userId, items: [] });
    await wishlist.save();
  }
  
  return wishlist;
};

module.exports = mongoose.model('Wishlist', wishlistSchema);