const mongoose = require('mongoose');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const crypto = require('crypto');

const twoFactorAuthSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  secret: {
    type: String,
    required: true,
    // Encrypt the secret
    set: function(value) {
      if (!value) return value;
      const cipher = crypto.createCipher('aes-256-cbc', process.env.ENCRYPTION_KEY);
      let encrypted = cipher.update(value, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return encrypted;
    },
    get: function(value) {
      if (!value) return value;
      try {
        const decipher = crypto.createDecipher('aes-256-cbc', process.env.ENCRYPTION_KEY);
        let decrypted = decipher.update(value, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
      } catch (error) {
        console.error('Error decrypting 2FA secret:', error);
        return null;
      }
    }
  },
  backupCodes: [{
    code: {
      type: String,
      required: true
    },
    used: {
      type: Boolean,
      default: false
    },
    usedAt: Date
  }],
  isEnabled: {
    type: Boolean,
    default: false
  },
  lastUsed: {
    type: Date,
    default: null
  },
  failedAttempts: {
    type: Number,
    default: 0
  },
  lockedUntil: {
    type: Date,
    default: null
  },
  trustedDevices: [{
    deviceId: String,
    userAgent: String,
    ip: String,
    trustedAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: {
      type: Date,
      default: function() {
        return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      }
    }
  }]
}, {
  timestamps: true,
  toJSON: { getters: true },
  toObject: { getters: true }
});

// Method to generate secret and QR code
twoFactorAuthSchema.methods.generateSecret = async function(userEmail, serviceName = 'StyleShop') {
  const secret = speakeasy.generateSecret({
    name: userEmail,
    issuer: serviceName,
    length: 32
  });

  this.secret = secret.base32;
  await this.save();

  // Generate QR code
  const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);
  
  return {
    secret: secret.base32,
    qrCode: qrCodeUrl,
    manualEntryKey: secret.base32
  };
};

// Method to verify TOTP token
twoFactorAuthSchema.methods.verifyToken = function(token) {
  if (this.lockedUntil && this.lockedUntil > new Date()) {
    throw new Error('2FA is temporarily locked due to too many failed attempts');
  }

  const isValid = speakeasy.totp.verify({
    secret: this.secret,
    encoding: 'base32',
    token,
    window: 2 // Allow 2 time steps (60 seconds) of tolerance
  });

  if (isValid) {
    this.failedAttempts = 0;
    this.lockedUntil = null;
    this.lastUsed = new Date();
  } else {
    this.failedAttempts += 1;
    
    // Lock after 5 failed attempts for 30 minutes
    if (this.failedAttempts >= 5) {
      this.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
    }
  }

  return isValid;
};

// Method to verify backup code
twoFactorAuthSchema.methods.verifyBackupCode = function(code) {
  const backupCode = this.backupCodes.find(bc => bc.code === code && !bc.used);
  
  if (!backupCode) {
    return false;
  }

  backupCode.used = true;
  backupCode.usedAt = new Date();
  this.lastUsed = new Date();
  
  return true;
};

// Method to generate backup codes
twoFactorAuthSchema.methods.generateBackupCodes = function(count = 8) {
  const codes = [];
  
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(code);
    this.backupCodes.push({ code });
  }
  
  return codes;
};

// Method to check if device is trusted
twoFactorAuthSchema.methods.isDeviceTrusted = function(deviceId, ip, userAgent) {
  const trustedDevice = this.trustedDevices.find(device => 
    device.deviceId === deviceId && 
    device.ip === ip && 
    device.userAgent === userAgent &&
    device.expiresAt > new Date()
  );
  
  return !!trustedDevice;
};

// Method to add trusted device
twoFactorAuthSchema.methods.addTrustedDevice = function(deviceId, ip, userAgent) {
  // Remove expired devices
  this.trustedDevices = this.trustedDevices.filter(device => device.expiresAt > new Date());
  
  // Add new trusted device
  this.trustedDevices.push({
    deviceId,
    ip,
    userAgent,
    trustedAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
  });
  
  // Keep only last 5 trusted devices
  if (this.trustedDevices.length > 5) {
    this.trustedDevices = this.trustedDevices.slice(-5);
  }
};

// Static method to setup 2FA for user
twoFactorAuthSchema.statics.setupForUser = async function(userId, userEmail) {
  let twoFA = await this.findOne({ userId });
  
  if (!twoFA) {
    twoFA = new this({ userId });
  }
  
  return await twoFA.generateSecret(userEmail);
};

module.exports = mongoose.model('TwoFactorAuth', twoFactorAuthSchema);