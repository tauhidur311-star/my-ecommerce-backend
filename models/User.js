const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    index: true
  },
  password: {
    type: String,
    required: false,
    minlength: 6
  },
  phone: {
    type: String,
    validate: {
      validator: function(v) {
        return !v || /^01[0-9]{9}$/.test(v);
      },
      message: 'Phone number must be in format: 01XXXXXXXXX'
    }
  },
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: { type: String, default: 'Bangladesh' }
  },
  province: String,
  avatar: String,
  role: {
    type: String,
    enum: ['customer', 'admin', 'super_admin'],
    default: 'customer'
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  resetPasswordOtp: String,
  resetPasswordExpires: Date,
  refreshTokens: [String],
  authProvider: {
    type: String,
    enum: ['local', 'google', 'facebook'],
    default: 'local'
  },
  lastLoginAt: Date,
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockedUntil: Date,
  preferences: {
    language: { type: String, default: 'en' },
    currency: { type: String, default: 'BDT' },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      push: { type: Boolean, default: true }
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLoginIP: {
    type: String,
    default: null
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  tokenVersion: {
    type: Number,
    default: 0
  },
  // Two-Factor Authentication
  twoFactorSecret: {
    type: String,
    default: null
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  twoFactorCode: {
    type: String,
    default: null
  },
  twoFactorExpires: {
    type: Date,
    default: null
  },
  // Account Security
  securityQuestions: [{
    question: String,
    answer: String
  }],
  accountLocked: {
    type: Boolean,
    default: false
  },
  // Profile completion
  profileCompleteness: {
    type: Number,
    default: 0
  },
  // Wishlist integration
  wishlistItems: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  // Shopping preferences
  shoppingPreferences: {
    favoriteCategories: [String],
    sizePreference: String,
    priceRange: {
      min: Number,
      max: Number
    },
    brands: [String]
  },
  // Email verification fields
  emailVerificationToken: {
    type: String,
    default: null
  },
  emailVerificationCode: {
    type: String,
    default: null
  },
  emailVerificationExpires: {
    type: Date,
    default: null
  },
  emailVerifiedAt: {
    type: Date,
    default: null
  }
}, { 
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.refreshTokens;
      delete ret.resetPasswordOtp;
      delete ret.emailVerificationToken;
      return ret;
    }
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  // and it's not an empty string (for Google sign-in users)
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// Check if account is locked
userSchema.methods.isLocked = function() {
  return !!(this.lockedUntil && this.lockedUntil > Date.now());
};

// Increment login attempts
userSchema.methods.incLoginAttempts = function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockedUntil && this.lockedUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockedUntil: 1 },
      $set: { loginAttempts: 1 }
    });
  }
  
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock account after 5 failed attempts for 2 hours
  if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
    updates.$set = { lockedUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
  }
  
  return this.updateOne(updates);
};

// Reset login attempts
userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockedUntil: 1 }
  });
};

// Get full name
userSchema.virtual('fullName').get(function() {
  return this.name;
});

// Check if user has permission
userSchema.methods.hasPermission = function(permission) {
  const rolePermissions = {
    customer: ['read:own_profile', 'update:own_profile', 'create:order', 'read:own_orders'],
    admin: ['*'],
    super_admin: ['*']
  };
  
  const permissions = rolePermissions[this.role] || [];
  return permissions.includes('*') || permissions.includes(permission);
};

// Add indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ resetPasswordOtp: 1, resetPasswordExpires: 1 });
userSchema.index({ emailVerificationToken: 1 });
userSchema.index({ role: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);