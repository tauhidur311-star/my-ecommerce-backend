const jwt = require('jsonwebtoken');
const User = require('../models/User');
const TwoFactorAuth = require('../models/TwoFactorAuth');
const TokenBlacklist = require('../models/TokenBlacklist');
const SecurityLog = require('../models/SecurityLog');

// Enhanced auth middleware with security features
const enhancedAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      await SecurityLog.logEvent({
        action: 'unauthorized_access',
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: { endpoint: req.path, method: req.method },
        severity: 'medium'
      });
      
      return res.status(401).json({ 
        success: false, 
        error: 'Access denied. No token provided.',
        code: 'NO_TOKEN'
      });
    }

    // Check if token is blacklisted
    const isBlacklisted = await TokenBlacklist.isTokenBlacklisted(token);
    if (isBlacklisted) {
      await SecurityLog.logEvent({
        action: 'unauthorized_access',
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: { endpoint: req.path, method: req.method, reason: 'blacklisted_token' },
        severity: 'high'
      });
      
      return res.status(401).json({ 
        success: false, 
        error: 'Token has been invalidated',
        code: 'TOKEN_BLACKLISTED'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      await SecurityLog.logEvent({
        action: 'unauthorized_access',
        userId: decoded.userId,
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: { endpoint: req.path, method: req.method, reason: 'user_not_found' },
        severity: 'high'
      });
      
      return res.status(401).json({ 
        success: false, 
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check if user account is active
    if (!user.isActive) {
      await SecurityLog.logEvent({
        action: 'unauthorized_access',
        userId: user._id,
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: { endpoint: req.path, method: req.method, reason: 'account_inactive' },
        severity: 'medium'
      });
      
      return res.status(401).json({ 
        success: false, 
        error: 'Account is inactive',
        code: 'ACCOUNT_INACTIVE'
      });
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await SecurityLog.logEvent({
        action: 'unauthorized_access',
        userId: user._id,
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: { endpoint: req.path, method: req.method, reason: 'account_locked' },
        severity: 'medium'
      });
      
      return res.status(401).json({ 
        success: false, 
        error: 'Account is temporarily locked',
        code: 'ACCOUNT_LOCKED',
        lockedUntil: user.lockedUntil
      });
    }

    // Check token version for invalidation
    if (decoded.tokenVersion !== user.tokenVersion) {
      await SecurityLog.logEvent({
        action: 'unauthorized_access',
        userId: user._id,
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: { endpoint: req.path, method: req.method, reason: 'invalid_token_version' },
        severity: 'medium'
      });
      
      return res.status(401).json({ 
        success: false, 
        error: 'Token has been invalidated. Please login again.',
        code: 'TOKEN_VERSION_MISMATCH'
      });
    }

    // Check IP whitelist if enabled
    if (user.securitySettings?.ipWhitelistEnabled && user.allowedIPs?.length > 0) {
      const isIPAllowed = user.allowedIPs.some(allowedIP => allowedIP.ip === req.ip);
      if (!isIPAllowed) {
        await SecurityLog.logEvent({
          action: 'unauthorized_access',
          userId: user._id,
          ip: req.ip,
          userAgent: req.get('User-Agent') || '',
          details: { endpoint: req.path, method: req.method, reason: 'ip_not_whitelisted' },
          severity: 'high'
        });
        
        return res.status(401).json({ 
          success: false, 
          error: 'Access denied from this IP address',
          code: 'IP_NOT_ALLOWED'
        });
      }
    }

    // Update last activity
    await User.findByIdAndUpdate(user._id, { 
      lastActivity: new Date(),
      lastLoginIP: req.ip 
    });

    req.token = token;
    req.user = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
      twoFactorEnabled: user.twoFactorEnabled
    };
    req.userId = user._id;
    
    next();
  } catch (error) {
    console.error('Enhanced auth error:', error);
    
    let errorCode = 'AUTH_ERROR';
    let severity = 'medium';
    
    if (error.name === 'JsonWebTokenError') {
      errorCode = 'INVALID_TOKEN';
      severity = 'high';
    } else if (error.name === 'TokenExpiredError') {
      errorCode = 'TOKEN_EXPIRED';
      severity = 'low';
    }
    
    await SecurityLog.logEvent({
      action: 'unauthorized_access',
      ip: req.ip,
      userAgent: req.get('User-Agent') || '',
      details: { 
        endpoint: req.path, 
        method: req.method, 
        error: error.message,
        errorCode 
      },
      severity
    });
    
    res.status(401).json({ 
      success: false, 
      error: error.name === 'TokenExpiredError' ? 'Token expired' : 'Authentication failed',
      code: errorCode,
      ...(error.name === 'TokenExpiredError' && { expiredAt: error.expiredAt })
    });
  }
};

// Admin auth with enhanced security
const enhancedAdminAuth = async (req, res, next) => {
  try {
    // First run standard auth
    await enhancedAuth(req, res, async () => {
      // Check admin role
      if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
        await SecurityLog.logEvent({
          action: 'unauthorized_access',
          userId: req.user.userId,
          ip: req.ip,
          userAgent: req.get('User-Agent') || '',
          details: { 
            endpoint: req.path, 
            method: req.method, 
            reason: 'insufficient_privileges',
            userRole: req.user.role 
          },
          severity: 'high'
        });
        
        return res.status(403).json({ 
          success: false, 
          error: 'Access denied. Admin privileges required.',
          code: 'INSUFFICIENT_PRIVILEGES'
        });
      }

      // Check if 2FA is required for admin actions
      const user = await User.findById(req.user.userId);
      if (user.securitySettings?.requireTwoFactor && user.twoFactorEnabled) {
        // Check if this is a sensitive admin operation
        const sensitiveOperations = ['POST', 'PUT', 'DELETE'];
        if (sensitiveOperations.includes(req.method)) {
          const twoFA = await TwoFactorAuth.findOne({ userId: user._id });
          if (twoFA && twoFA.isEnabled) {
            // Check if device is trusted
            const deviceId = req.get('X-Device-ID') || 'unknown';
            const isTrusted = twoFA.isDeviceTrusted(deviceId, req.ip, req.get('User-Agent'));
            
            if (!isTrusted) {
              return res.status(403).json({
                success: false,
                error: 'Two-factor authentication required for this operation',
                code: 'TWO_FACTOR_REQUIRED'
              });
            }
          }
        }
      }

      // Log admin action
      await SecurityLog.logEvent({
        action: 'admin_action',
        userId: req.user.userId,
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: { 
          endpoint: req.path, 
          method: req.method,
          userRole: req.user.role 
        },
        severity: 'low'
      });

      next();
    });
  } catch (error) {
    console.error('Enhanced admin auth error:', error);
    res.status(401).json({ 
      success: false, 
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    });
  }
};

// Generate JWT tokens with enhanced security
const generateTokens = (user) => {
  const payload = {
    userId: user._id,
    email: user.email,
    role: user.role,
    tokenVersion: user.tokenVersion || 0
  };

  // Short-lived access token (15 minutes)
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '15m',
    issuer: 'styleshop-api',
    audience: 'styleshop-client'
  });

  // Long-lived refresh token (30 days)
  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' }, 
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    {
      expiresIn: '30d',
      issuer: 'styleshop-api',
      audience: 'styleshop-client'
    }
  );

  return { accessToken, refreshToken };
};

// Verify refresh token
const verifyRefreshToken = async (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    
    // Check if it's a refresh token
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    // Check if token is blacklisted
    const isBlacklisted = await TokenBlacklist.isTokenBlacklisted(token);
    if (isBlacklisted) {
      throw new Error('Token is blacklisted');
    }

    const user = await User.findById(decoded.userId);
    if (!user || decoded.tokenVersion !== user.tokenVersion) {
      throw new Error('Invalid token');
    }

    return { user, decoded };
  } catch (error) {
    throw error;
  }
};

// Middleware for refresh token endpoint
const refreshTokenAuth = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token is required',
        code: 'NO_REFRESH_TOKEN'
      });
    }

    const { user } = await verifyRefreshToken(refreshToken);
    
    req.user = user;
    req.refreshToken = refreshToken;
    next();
  } catch (error) {
    await SecurityLog.logEvent({
      action: 'unauthorized_access',
      ip: req.ip,
      userAgent: req.get('User-Agent') || '',
      details: { 
        endpoint: req.path, 
        method: req.method, 
        reason: 'invalid_refresh_token',
        error: error.message 
      },
      severity: 'medium'
    });
    
    res.status(401).json({
      success: false,
      error: 'Invalid refresh token',
      code: 'INVALID_REFRESH_TOKEN'
    });
  }
};

module.exports = {
  enhancedAuth,
  enhancedAdminAuth,
  generateTokens,
  verifyRefreshToken,
  refreshTokenAuth
};