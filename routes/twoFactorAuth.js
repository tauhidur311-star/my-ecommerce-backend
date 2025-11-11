const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const twoFactorAuth = require('../utils/twoFactorAuth');
const User = require('../models/User');

// Enable Two-Factor Authentication
router.post('/enable', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const result = await twoFactorAuth.enableTwoFactor(user);
    res.json(result);
  } catch (error) {
    console.error('Enable 2FA error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to enable two-factor authentication'
    });
  }
});

// Verify and complete 2FA setup
router.post('/verify-setup', auth, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Verification code is required'
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const result = await twoFactorAuth.completeTwoFactorSetup(user, code);
    res.json(result);
  } catch (error) {
    console.error('Verify 2FA setup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify two-factor authentication'
    });
  }
});

// Disable Two-Factor Authentication
router.post('/disable', auth, async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required to disable 2FA'
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Verify password before disabling 2FA
    if (user.authProvider === 'local' && user.password) {
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid password'
        });
      }
    }

    const result = await twoFactorAuth.disableTwoFactor(user);
    res.json(result);
  } catch (error) {
    console.error('Disable 2FA error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to disable two-factor authentication'
    });
  }
});

// Send 2FA code for login
router.post('/send-code', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const user = await User.findOne({ email });
    if (!user || !user.twoFactorEnabled) {
      // Don't reveal if user exists or has 2FA enabled
      return res.json({
        success: true,
        message: 'If two-factor authentication is enabled for this account, a code has been sent.'
      });
    }

    const result = await twoFactorAuth.sendCodeViaEmail(user);
    res.json(result);
  } catch (error) {
    console.error('Send 2FA code error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send verification code'
    });
  }
});

// Verify 2FA code during login
router.post('/verify-login', async (req, res) => {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({
        success: false,
        error: 'Email and verification code are required'
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'Invalid verification'
      });
    }

    const result = await twoFactorAuth.verifyCode(user, code);
    
    if (result.success) {
      // Generate login tokens
      const jwt = require('jsonwebtoken');
      const generateTokens = (userId) => {
        const accessToken = jwt.sign(
          { userId },
          process.env.JWT_SECRET,
          { expiresIn: '2h' }
        );
        
        const refreshToken = jwt.sign(
          { userId },
          process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
          { expiresIn: '30d' }
        );
        
        return { accessToken, refreshToken };
      };

      const { accessToken, refreshToken } = generateTokens(user._id);

      // Update user login info
      user.lastLoginAt = new Date();
      user.lastLoginIP = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
      user.lastActivity = new Date();
      
      // Store refresh token
      if (!user.refreshTokens) user.refreshTokens = [];
      user.refreshTokens.push(refreshToken);
      
      if (user.refreshTokens.length > 5) {
        user.refreshTokens = user.refreshTokens.slice(-5);
      }
      
      await user.save();

      res.json({
        success: true,
        message: 'Two-factor authentication verified successfully',
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
          twoFactorEnabled: user.twoFactorEnabled
        }
      });
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Verify 2FA login error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify two-factor authentication'
    });
  }
});

// Get 2FA status
router.get('/status', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      twoFactorEnabled: user.twoFactorEnabled,
      hasSecret: !!user.twoFactorSecret,
      isEmailVerified: user.isEmailVerified
    });
  } catch (error) {
    console.error('Get 2FA status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get two-factor authentication status'
    });
  }
});

module.exports = router;