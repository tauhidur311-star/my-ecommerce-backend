const mongoose = require('mongoose');

const tokenBlacklistSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  tokenType: {
    type: String,
    enum: ['access', 'refresh'],
    required: true
  },
  reason: {
    type: String,
    enum: ['logout', 'password_change', 'security_breach', 'admin_action', 'expired'],
    required: true
  },
  blacklistedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  ip: String,
  userAgent: String
}, {
  timestamps: true
});

// TTL index to automatically remove expired blacklisted tokens
tokenBlacklistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for fast lookups
tokenBlacklistSchema.index({ token: 1, tokenType: 1 });
tokenBlacklistSchema.index({ userId: 1, blacklistedAt: -1 });

// Static method to blacklist a token
tokenBlacklistSchema.statics.blacklistToken = async function(token, userId, tokenType, reason, expiresAt, metadata = {}) {
  try {
    await this.create({
      token,
      userId,
      tokenType,
      reason,
      expiresAt,
      ip: metadata.ip,
      userAgent: metadata.userAgent
    });
    
    console.log(`Token blacklisted: ${tokenType} token for user ${userId}, reason: ${reason}`);
  } catch (error) {
    if (error.code === 11000) {
      // Token already blacklisted
      console.log('Token already blacklisted');
      return;
    }
    throw error;
  }
};

// Static method to check if token is blacklisted
tokenBlacklistSchema.statics.isTokenBlacklisted = async function(token) {
  const blacklistedToken = await this.findOne({ token });
  return !!blacklistedToken;
};

// Static method to blacklist all tokens for a user
tokenBlacklistSchema.statics.blacklistAllUserTokens = async function(userId, reason, metadata = {}) {
  // This would require storing all active tokens, which we'll implement via refresh token invalidation
  console.log(`Blacklisting all tokens for user ${userId}, reason: ${reason}`);
  
  // In practice, we'll handle this by updating the user's tokenVersion
  const User = require('./User');
  await User.findByIdAndUpdate(userId, { 
    $inc: { tokenVersion: 1 },
    $set: { lastTokenInvalidation: new Date() }
  });
};

// Static method to cleanup expired blacklisted tokens
tokenBlacklistSchema.statics.cleanupExpiredTokens = async function() {
  const result = await this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
  
  console.log(`Cleaned up ${result.deletedCount} expired blacklisted tokens`);
  return result.deletedCount;
};

// Static method to get blacklisted tokens for user
tokenBlacklistSchema.statics.getUserBlacklistedTokens = async function(userId, limit = 50) {
  return await this.find({ userId })
    .sort({ blacklistedAt: -1 })
    .limit(limit)
    .select('tokenType reason blacklistedAt ip userAgent');
};

module.exports = mongoose.model('TokenBlacklist', tokenBlacklistSchema);