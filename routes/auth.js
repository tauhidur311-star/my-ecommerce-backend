const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { validate } = require('../utils/validation');
const { authLimiter, passwordResetLimiter } = require('../middleware/rateLimit');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generate JWT tokens
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '2h' } // Extended from 15m to 2h
  );
  
  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: '30d' } // Extended from 7d to 30d
  );
  
  return { accessToken, refreshToken };
};

// Email transporter setup
const createEmailTransporter = () => {
  // Check for new Mailjet SMTP configuration first
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    console.log('📧 Using Mailjet SMTP configuration for auth emails');
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  // Fallback to old email configuration
  else if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    console.log('📧 Using fallback email configuration');
    return nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }
  console.log('❌ No email configuration found');
  return null;
};

// Register
router.post('/register', authLimiter, validate(require('../utils/validation').schemas.register), async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email already registered' 
      });
    }

    // Generate email verification token
    const emailVerificationToken = jwt.sign(
      { email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    const user = new User({ 
      name, 
      email, 
      password, 
      phone,
      emailVerificationToken,
      isEmailVerified: false
    });
    await user.save();

    // Send verification email
    const transporter = createEmailTransporter();
    if (transporter) {
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${emailVerificationToken}`;
      
      await transporter.sendMail({
        from: `"${process.env.APP_NAME || 'StyleShop'}" <${process.env.EMAIL_FROM}>`,
        to: email,
        subject: 'Verify Your Email Address',
        html: `
          <h2>Welcome to ${process.env.APP_NAME || 'StyleShop'}!</h2>
          <p>Please verify your email address by clicking the link below:</p>
          <a href="${verificationUrl}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">Verify Email</a>
          <p>This link will expire in 24 hours.</p>
        `
      });
    } else {
      console.log(`📧 Email verification token for ${email}: ${emailVerificationToken}`);
    }

    const { accessToken, refreshToken } = generateTokens(user._id);

    // Store refresh token in user document
    user.refreshTokens = [refreshToken];
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email to verify your account.',
      tokens: {
        accessToken,
        refreshToken
      },
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error', 
      details: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
});

// Login
router.post('/login', authLimiter, validate(require('../utils/validation').schemas.login), async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    const user = await User.findOne({ email });
    if (!user || !user.password) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }

    // Update last login with IP tracking
    user.lastLoginAt = new Date();
    user.lastLoginIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    user.lastActivity = new Date();
    user.loginAttempts = 0;
    
    const { accessToken, refreshToken } = generateTokens(user._id);

    // Store refresh token
    if (!user.refreshTokens) user.refreshTokens = [];
    user.refreshTokens.push(refreshToken);
    
    // Limit refresh tokens (keep only last 5)
    if (user.refreshTokens.length > 5) {
      user.refreshTokens = user.refreshTokens.slice(-5);
    }
    
    await user.save();

    res.json({
      success: true,
      tokens: {
        accessToken,
        refreshToken
      },
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        lastLoginAt: user.lastLoginAt
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error', 
      details: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
});

// Google Login
router.post('/google-login', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ 
        success: false, 
        error: 'Google token is required' 
      });
    }

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    const { name, email, picture, email_verified } = payload;

    let user = await User.findOne({ email });

    if (!user) {
      user = new User({
        name,
        email,
        avatar: picture,
        isEmailVerified: email_verified,
        authProvider: 'google',
        lastLoginAt: new Date(),
        lastLoginIP: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
        lastActivity: new Date()
      });
      await user.save();
    } else {
      // Update existing user with IP tracking
      user.lastLoginAt = new Date();
      user.lastLoginIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
      user.lastActivity = new Date();
      if (picture && !user.avatar) user.avatar = picture;
      if (email_verified) user.isEmailVerified = true;
      await user.save();
    }

    const { accessToken, refreshToken } = generateTokens(user._id);

    // Store refresh token
    if (!user.refreshTokens) user.refreshTokens = [];
    user.refreshTokens.push(refreshToken);
    
    if (user.refreshTokens.length > 5) {
      user.refreshTokens = user.refreshTokens.slice(-5);
    }
    
    await user.save();

    res.json({
      success: true,
      tokens: {
        accessToken,
        refreshToken
      },
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        isEmailVerified: user.isEmailVerified,
        authProvider: user.authProvider
      }
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Google login failed', 
      details: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
});

// Refresh Token
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ 
        success: false, 
        error: 'Refresh token is required' 
      });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user || !user.refreshTokens.includes(refreshToken)) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid refresh token' 
      });
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id);

    // Replace old refresh token with new one
    user.refreshTokens = user.refreshTokens.filter(token => token !== refreshToken);
    user.refreshTokens.push(newRefreshToken);
    await user.save();

    res.json({
      success: true,
      tokens: {
        accessToken,
        refreshToken: newRefreshToken
      }
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({ 
      success: false, 
      error: 'Invalid refresh token' 
    });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const authHeader = req.headers['authorization'];
    const accessToken = authHeader && authHeader.split(' ')[1];

    if (refreshToken) {
      try {
        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (user) {
          user.refreshTokens = user.refreshTokens.filter(token => token !== refreshToken);
          await user.save();
        }
      } catch (error) {
        // Token might be invalid, but we still want to logout
        console.log('Invalid refresh token during logout');
      }
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Logout All Devices
router.post('/logout-all', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const accessToken = authHeader && authHeader.split(' ')[1];

    if (accessToken) {
      const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId);
      
      if (user) {
        user.refreshTokens = [];
        await user.save();
      }
    }

    res.json({
      success: true,
      message: 'Logged out from all devices successfully'
    });
  } catch (error) {
    console.error('Logout all error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Verify Email
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ 
        success: false, 
        error: 'Verification token is required' 
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ 
      email: decoded.email, 
      emailVerificationToken: token 
    });

    if (!user) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid or expired verification token' 
      });
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = undefined;
    await user.save();

    // Send welcome notification after email verification
    try {
      await Notification.createFromTemplate(user._id, 'welcome', {
        userName: user.name
      });
    } catch (notificationError) {
      console.error('Failed to send welcome notification:', notificationError);
      // Don't fail the email verification if notification fails
    }

    res.json({
      success: true,
      message: 'Email verified successfully'
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(400).json({ 
      success: false, 
      error: 'Invalid or expired verification token' 
    });
  }
});

// Resend Email Verification
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email is already verified' 
      });
    }

    const emailVerificationToken = jwt.sign(
      { email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    user.emailVerificationToken = emailVerificationToken;
    await user.save();

    const transporter = createEmailTransporter();
    if (transporter) {
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${emailVerificationToken}`;
      
      await transporter.sendMail({
        from: `"${process.env.APP_NAME || 'StyleShop'}" <${process.env.EMAIL_FROM}>`,
        to: email,
        subject: 'Verify Your Email Address',
        html: `
          <h2>Email Verification</h2>
          <p>Please verify your email address by clicking the link below:</p>
          <a href="${verificationUrl}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px;">Verify Email</a>
          <p>This link will expire in 24 hours.</p>
        `
      });
    } else {
      console.log(`📧 Email verification token for ${email}: ${emailVerificationToken}`);
    }

    res.json({
      success: true,
      message: 'Verification email sent'
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Forgot Password
router.post('/forgot-password', passwordResetLimiter, validate(require('../utils/validation').schemas.resetPassword), async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.json({ 
        success: true, 
        message: 'If a user with that email exists, a password reset OTP has been sent.' 
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPasswordOtp = otp;
    user.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

    await user.save();

    const transporter = createEmailTransporter();
    if (transporter) {
      await transporter.sendMail({
        from: `"${process.env.APP_NAME || 'StyleShop'}" <${process.env.EMAIL_FROM}>`,
        to: user.email,
        subject: 'Password Reset OTP',
        html: `
          <h2>Password Reset Request</h2>
          <p>Your password reset OTP is: <strong style="font-size: 24px; color: #007bff;">${otp}</strong></p>
          <p>This OTP will expire in 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
        `
      });
    } else {
      console.log(`🔐 OTP for ${user.email}: ${otp} (expires in 10 minutes)`);
    }

    res.json({ 
      success: true, 
      message: 'If a user with that email exists, a password reset OTP has been sent.' 
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({
      email,
      resetPasswordOtp: otp,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid OTP or OTP has expired' 
      });
    }

    res.json({ 
      success: true, 
      message: 'OTP verified successfully' 
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Reset Password
router.post('/reset-password', passwordResetLimiter, async (req, res) => {
  try {
    const { email, otp, password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password must be at least 6 characters long' 
      });
    }

    const user = await User.findOne({
      email,
      resetPasswordOtp: otp,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid OTP or OTP has expired' 
      });
    }

    user.password = password;
    user.resetPasswordOtp = undefined;
    user.resetPasswordExpires = undefined;
    user.refreshTokens = []; // Logout from all devices

    await user.save();

    res.json({ 
      success: true, 
      message: 'Password has been reset successfully' 
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Change Password (for logged-in users)
router.post('/change-password', require('../middleware/auth').auth, async (req, res) => {
  try {
    console.log('🔍 Change Password Debug - Request body:', { 
      hasCurrentPassword: !!req.body.currentPassword,
      hasNewPassword: !!req.body.newPassword,
      bodyKeys: Object.keys(req.body),
      userId: req.user?.userId 
    });
    
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: 'New password must be at least 6 characters long' 
      });
    }

    const user = await User.findById(req.user.userId);
    console.log('🔍 Change Password Debug - User lookup:', { 
      userFound: !!user,
      userId: req.user.userId,
      userEmail: user?.email,
      hasPassword: !!user?.password,
      authProvider: user?.authProvider 
    });
    
    if (!user) {
      console.error('❌ Change Password - User not found for ID:', req.user.userId);
      return res.status(400).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    // Check if this is a social login account
    if (user.authProvider === 'google' || user.googleId || !user.password) {
      return res.status(400).json({ 
        success: false, 
        error: 'User not found or account uses social login' 
      });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ 
        success: false, 
        error: 'Current password is incorrect' 
      });
    }

    user.password = newPassword;
    user.refreshTokens = []; // Logout from all devices
    await user.save();

    res.json({ 
      success: true, 
      message: 'Password changed successfully' 
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Session validation endpoint
router.post('/validate-session', require('../middleware/auth').auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const currentIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    
    // Find user with current session info
    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({
        valid: false,
        reason: 'User not found'
      });
    }

    // Check if user has stored IP from login
    const storedIP = user.lastLoginIP;
    
    // If IP has changed significantly, invalidate session
    if (storedIP && storedIP !== currentIP) {
      // Allow some flexibility for mobile/dynamic IPs by checking first 3 octets
      const storedIPPrefix = storedIP.split('.').slice(0, 3).join('.');
      const currentIPPrefix = currentIP.split('.').slice(0, 3).join('.');
      
      if (storedIPPrefix !== currentIPPrefix) {
        return res.status(401).json({
          valid: false,
          reason: 'IP address changed - session terminated for security'
        });
      }
    }

    // Update last activity
    user.lastActivity = new Date();
    await user.save();

    res.json({
      valid: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        address: user.address,
        phone: user.phone,
        province: user.province,
        authProvider: user.authProvider,
        googleId: user.googleId
      }
    });

  } catch (error) {
    console.error('Session validation error:', error);
    res.status(500).json({
      valid: false,
      reason: 'Server error during validation'
    });
  }
});

// Get active sessions endpoint
router.get('/active-sessions', require('../middleware/auth').auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const currentIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    
    // Find user
    const user = await User.findById(userId).select('lastLoginAt lastLoginIP refreshTokens');
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Create session data based on stored info
    const sessions = [];
    
    // Current session
    const currentSession = {
      id: 'current-session',
      deviceInfo: req.get('User-Agent')?.includes('Mobile') ? 'Mobile Device' : 'Desktop Computer',
      browser: getBrowserFromUserAgent(req.get('User-Agent') || ''),
      ipAddress: currentIP,
      location: 'Current Location', // Can be enhanced with IP geolocation
      lastActivity: new Date().toISOString(),
      isCurrent: true,
      createdAt: user.lastLoginAt || new Date().toISOString()
    };
    sessions.push(currentSession);

    // Add additional sessions based on refresh tokens (simplified)
    if (user.refreshTokens && user.refreshTokens.length > 1) {
      user.refreshTokens.slice(0, -1).forEach((token, index) => {
        sessions.push({
          id: `session-${index}`,
          deviceInfo: 'Unknown Device',
          browser: 'Unknown Browser',
          ipAddress: user.lastLoginIP || 'Unknown IP',
          location: 'Unknown Location',
          lastActivity: user.lastLoginAt || new Date().toISOString(),
          isCurrent: false,
          createdAt: user.lastLoginAt || new Date().toISOString()
        });
      });
    }

    res.json({
      success: true,
      sessions: sessions
    });

  } catch (error) {
    console.error('Error getting active sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get active sessions'
    });
  }
});

// Helper function to get browser from user agent
function getBrowserFromUserAgent(userAgent) {
  if (userAgent.includes('Chrome')) return 'Chrome';
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('Safari')) return 'Safari';
  if (userAgent.includes('Edge')) return 'Edge';
  if (userAgent.includes('Opera')) return 'Opera';
  return 'Unknown Browser';
}

// Terminate all sessions endpoint
router.post('/terminate-all-sessions', require('../middleware/auth').auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Update user's token version to invalidate all existing tokens
    // This approach works by incrementing a tokenVersion field
    if (!user.tokenVersion) {
      user.tokenVersion = 0;
    }
    user.tokenVersion += 1;
    
    // Clear session-related fields
    user.lastLoginIP = null;
    user.lastActivity = new Date();
    
    await user.save();

    // Log the session termination
    console.log(`All sessions terminated for user: ${user.email} (ID: ${userId})`);

    res.json({
      success: true,
      message: 'All sessions have been terminated successfully'
    });

  } catch (error) {
    console.error('Error terminating sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to terminate sessions'
    });
  }
});

module.exports = router;