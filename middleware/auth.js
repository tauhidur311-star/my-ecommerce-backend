const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: 'Access denied. No token provided.' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('🔍 Auth Debug - Decoded token:', { userId: decoded.userId, email: decoded.email });
    
    const user = await User.findById(decoded.userId).select('-password -refreshTokens');
    console.log('🔍 Auth Debug - User lookup result:', user ? 'User found' : 'User NOT found');

    if (!user) {
      console.error('❌ User not found in database for userId:', decoded.userId);
      return res.status(401).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    req.token = token;
    req.user = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name
    };
    req.userId = user._id; // For backward compatibility
    
    console.log('🔍 Auth Debug - Set req.user:', { 
      userId: req.user.userId,
      email: req.user.email,
      role: req.user.role 
    });
    next();
  } catch (error) {
    console.error('Auth error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid token' 
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
        expiredAt: error.expiredAt 
      });
    }
    
    res.status(401).json({ 
      success: false, 
      error: 'Please authenticate' 
    });
  }
};

// Optional auth middleware - doesn't fail if no token provided
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      req.user = null;
      return next();
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password -refreshTokens');

    req.token = token;
    req.user = user ? {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name
    } : null;
    req.userId = user?._id;
    next();
  } catch (error) {
    // In optional auth, we don't fail on invalid tokens
    req.user = null;
    next();
  }
};

module.exports = { auth, optionalAuth };