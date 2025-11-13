const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const TwoFactorAuth = require('../models/TwoFactorAuth');
const TokenBlacklist = require('../models/TokenBlacklist');
const SecurityLog = require('../models/SecurityLog');
const { 
  generateTokens, 
  verifyRefreshToken, 
  refreshTokenAuth,
  enhancedAuth 
} = require('../middleware/enhancedAuth');
const { authLimiter, passwordResetLimiter } = require('../middleware/enhancedRateLimit');
const { enhancedSanitize } = require('../middleware/enhancedSanitize');

const router = express.Router();

// Apply sanitization to all routes
router.use(enhancedSanitize);

// Enhanced login with 2FA support and security logging
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password, twoFactorToken, trustDevice = false } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required'
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      await SecurityLog.logEvent({
        action: 'login_failure',
        userId: null,
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: { 
          endpoint: req.path,
          email: email.toLowerCase(),
          reason: 'user_not_found' 
        },
        severity: 'medium'
      });

      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await SecurityLog.logEvent({
        action: 'login_failure',
        userId: user._id,
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: { 
          endpoint: req.path,
          reason: 'account_locked',
          lockedUntil: user.lockedUntil 
        },
        severity: 'medium'
      });

      return res.status(401).json({
        success: false,
        error: 'Account is temporarily locked due to multiple failed login attempts',
        lockedUntil: user.lockedUntil
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      // Increment login attempts
      user.loginAttempts += 1;
      
      // Lock account after 5 failed attempts for 30 minutes
      if (user.loginAttempts >= 5) {
        user.lockedUntil = new Date(Date.now() + 30 * 60 * 1000);
        user.loginAttempts = 0;
      }
      
      await user.save();

      await SecurityLog.logEvent({
        action: 'login_failure',
        userId: user._id,
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: { 
          endpoint: req.path,
          reason: 'invalid_password',
          attempts: user.loginAttempts 
        },
        severity: 'medium'
      });

      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        attemptsRemaining: Math.max(0, 5 - user.loginAttempts)
      });
    }

    // Check if account is active
    if (!user.isActive) {
      await SecurityLog.logEvent({
        action: 'login_failure',
        userId: user._id,
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: { 
          endpoint: req.path,
          reason: 'account_inactive' 
        },
        severity: 'medium'
      });

      return res.status(401).json({
        success: false,
        error: 'Account is inactive'
      });
    }

    // Check 2FA if enabled
    if (user.twoFactorEnabled) {
      const twoFA = await TwoFactorAuth.findOne({ userId: user._id });
      
      if (twoFA && twoFA.isEnabled) {
        // Check if device is trusted
        const deviceId = req.get('X-Device-ID') || 'unknown';
        const isTrusted = twoFA.isDeviceTrusted(deviceId, req.ip, req.get('User-Agent'));
        
        if (!isTrusted && !twoFactorToken) {
          return res.status(200).json({
            success: false,
            requiresTwoFactor: true,
            message: 'Two-factor authentication required'
          });
        }
        
        if (!isTrusted && twoFactorToken) {
          const isValidToken = twoFA.verifyToken(twoFactorToken);
          await twoFA.save();
          
          if (!isValidToken) {
            await SecurityLog.logEvent({
              action: '2fa_failure',
              userId: user._id,
              ip: req.ip,
              userAgent: req.get('User-Agent') || '',
              details: { 
                endpoint: req.path,
                failedAttempts: twoFA.failedAttempts 
              },
              severity: 'high'
            });

            return res.status(401).json({
              success: false,
              error: 'Invalid two-factor authentication code',
              attemptsRemaining: Math.max(0, 5 - twoFA.failedAttempts)
            });
          }

          // Add trusted device if requested
          if (trustDevice) {
            twoFA.addTrustedDevice(deviceId, req.ip, req.get('User-Agent') || '');
            await twoFA.save();
          }

          await SecurityLog.logEvent({
            action: '2fa_success',
            userId: user._id,
            ip: req.ip,
            userAgent: req.get('User-Agent') || '',
            details: { endpoint: req.path, trustDevice },
            severity: 'low'
          });
        }
      }
    }

    // Reset login attempts on successful login
    user.loginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    user.lastLoginIP = req.ip;
    user.lastActivity = new Date();
    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Store refresh token (optional - for token rotation)
    user.refreshTokens = user.refreshTokens || [];
    user.refreshTokens.push(refreshToken);
    
    // Keep only last 5 refresh tokens
    if (user.refreshTokens.length > 5) {
      user.refreshTokens = user.refreshTokens.slice(-5);
    }
    
    await user.save();

    await SecurityLog.logEvent({
      action: 'login_success',
      userId: user._id,
      ip: req.ip,
      userAgent: req.get('User-Agent') || '',
      details: { endpoint: req.path },
      severity: 'low'
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
          twoFactorEnabled: user.twoFactorEnabled
        },
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: '15m'
        }
      }
    });

  } catch (error) {
    console.error('Enhanced login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed'
    });
  }
});

// Token refresh endpoint
router.post('/refresh', refreshTokenAuth, async (req, res) => {
  try {
    const user = req.user;
    const oldRefreshToken = req.refreshToken;

    // Generate new tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Rotate refresh tokens
    user.refreshTokens = user.refreshTokens || [];
    
    // Remove old refresh token and add new one
    user.refreshTokens = user.refreshTokens.filter(token => token !== oldRefreshToken);
    user.refreshTokens.push(refreshToken);
    
    // Keep only last 5 refresh tokens
    if (user.refreshTokens.length > 5) {
      user.refreshTokens = user.refreshTokens.slice(-5);
    }
    
    await user.save();

    // Blacklist old refresh token
    const decoded = jwt.decode(oldRefreshToken);
    await TokenBlacklist.blacklistToken(
      oldRefreshToken,
      user._id,
      'refresh',
      'token_refresh',
      new Date(decoded.exp * 1000),
      { ip: req.ip, userAgent: req.get('User-Agent') }
    );

    await SecurityLog.logEvent({
      action: 'token_refresh',
      userId: user._id,
      ip: req.ip,
      userAgent: req.get('User-Agent') || '',
      details: { endpoint: req.path },
      severity: 'low'
    });

    res.json({
      success: true,
      data: {
        tokens: {
          accessToken,
          refreshToken,
          expiresIn: '15m'
        }
      }
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'Token refresh failed'
    });
  }
});

// Enhanced logout with token blacklisting
router.post('/logout', enhancedAuth, async (req, res) => {
  try {
    const { logoutFromAllDevices = false } = req.body;
    const userId = req.user.userId;
    const token = req.token;

    // Decode token to get expiry
    const decoded = jwt.decode(token);
    const expiresAt = new Date(decoded.exp * 1000);

    // Blacklist current access token
    await TokenBlacklist.blacklistToken(
      token,
      userId,
      'access',
      'logout',
      expiresAt,
      { ip: req.ip, userAgent: req.get('User-Agent') }
    );

    const user = await User.findById(userId);
    if (user) {
      if (logoutFromAllDevices) {
        // Blacklist all refresh tokens
        if (user.refreshTokens && user.refreshTokens.length > 0) {
          for (const refreshToken of user.refreshTokens) {
            try {
              const refreshDecoded = jwt.decode(refreshToken);
              await TokenBlacklist.blacklistToken(
                refreshToken,
                userId,
                'refresh',
                'logout',
                new Date(refreshDecoded.exp * 1000),
                { ip: req.ip, userAgent: req.get('User-Agent') }
              );
            } catch (err) {
              console.error('Error blacklisting refresh token:', err);
            }
          }
        }

        // Clear all refresh tokens and increment token version
        user.refreshTokens = [];
        user.tokenVersion += 1;
        user.lastTokenInvalidation = new Date();
        await user.save();

        await SecurityLog.logEvent({
          action: 'logout',
          userId,
          ip: req.ip,
          userAgent: req.get('User-Agent') || '',
          details: { 
            endpoint: req.path,
            logoutFromAllDevices: true 
          },
          severity: 'low'
        });
      } else {
        await SecurityLog.logEvent({
          action: 'logout',
          userId,
          ip: req.ip,
          userAgent: req.get('User-Agent') || '',
          details: { endpoint: req.path },
          severity: 'low'
        });
      }
    }

    res.json({
      success: true,
      message: logoutFromAllDevices 
        ? 'Logged out from all devices successfully' 
        : 'Logged out successfully'
    });

  } catch (error) {
    console.error('Enhanced logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed'
    });
  }
});

// Change password with enhanced security
router.post('/change-password', enhancedAuth, authLimiter, async (req, res) => {
  try {
    const { currentPassword, newPassword, twoFactorToken } = req.body;
    const userId = req.user.userId;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters long'
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      await SecurityLog.logEvent({
        action: 'password_change_failure',
        userId,
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: { 
          endpoint: req.path,
          reason: 'invalid_current_password' 
        },
        severity: 'medium'
      });

      return res.status(400).json({
        success: false,
        error: 'Current password is incorrect'
      });
    }

    // Check 2FA if enabled for password change
    if (user.twoFactorEnabled) {
      if (!twoFactorToken) {
        return res.status(400).json({
          success: false,
          error: 'Two-factor authentication required for password change',
          requiresTwoFactor: true
        });
      }

      const twoFA = await TwoFactorAuth.findOne({ userId });
      if (twoFA && twoFA.isEnabled) {
        const isValidToken = twoFA.verifyToken(twoFactorToken);
        await twoFA.save();

        if (!isValidToken) {
          await SecurityLog.logEvent({
            action: 'password_change_failure',
            userId,
            ip: req.ip,
            userAgent: req.get('User-Agent') || '',
            details: { 
              endpoint: req.path,
              reason: 'invalid_2fa_token' 
            },
            severity: 'high'
          });

          return res.status(401).json({
            success: false,
            error: 'Invalid two-factor authentication code'
          });
        }
      }
    }

    // Store old password hash in history (optional)
    if (!user.passwordHistory) {
      user.passwordHistory = [];
    }
    user.passwordHistory.push({
      hash: user.password,
      createdAt: new Date()
    });

    // Keep only last 5 passwords
    if (user.passwordHistory.length > 5) {
      user.passwordHistory = user.passwordHistory.slice(-5);
    }

    // Update password
    user.password = newPassword;
    
    // Invalidate all tokens
    user.tokenVersion += 1;
    user.lastTokenInvalidation = new Date();
    user.refreshTokens = [];
    
    await user.save();

    // Blacklist all existing tokens
    await TokenBlacklist.blacklistAllUserTokens(userId, 'password_change', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    await SecurityLog.logEvent({
      action: 'password_change',
      userId,
      ip: req.ip,
      userAgent: req.get('User-Agent') || '',
      details: { endpoint: req.path },
      severity: 'medium'
    });

    res.json({
      success: true,
      message: 'Password changed successfully. Please login again.'
    });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to change password'
    });
  }
});

// Get user security summary
router.get('/security-summary', enhancedAuth, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get security logs summary
    const securitySummary = await SecurityLog.getUserSecuritySummary(userId);
    
    // Get 2FA status
    const twoFA = await TwoFactorAuth.findOne({ userId });
    const twoFactorStatus = {
      enabled: twoFA?.isEnabled || false,
      backupCodesRemaining: twoFA?.backupCodes?.filter(code => !code.used).length || 0,
      trustedDevices: twoFA?.trustedDevices?.filter(device => device.expiresAt > new Date()).length || 0
    };

    // Get recent security events
    const recentEvents = await SecurityLog.find({ userId })
      .sort({ timestamp: -1 })
      .limit(10)
      .select('action timestamp ip details severity');

    res.json({
      success: true,
      data: {
        securitySummary,
        twoFactorStatus,
        recentEvents
      }
    });

  } catch (error) {
    console.error('Security summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get security summary'
    });
  }
});

module.exports = router;