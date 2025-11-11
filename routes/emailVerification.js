const express = require('express');
const router = express.Router();
const User = require('../models/User');
const emailService = require('../utils/emailService');

// Send email verification
router.post('/send-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

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

    // Generate verification token
    const verificationToken = emailService.generateVerificationToken();
    
    // Set expiry (24 hours)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    // Save token to user
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpires = expiresAt;
    await user.save();

    // Send email
    await emailService.sendVerificationEmail(user, verificationToken);

    res.json({
      success: true,
      message: 'Verification email sent successfully'
    });
  } catch (error) {
    console.error('Send verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send verification email'
    });
  }
});

// Resend verification email
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

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

    // Generate new verification code (6-digit)
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Set expiry (1 hour for codes)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    // Save code to user
    user.emailVerificationCode = verificationCode;
    user.emailVerificationExpires = expiresAt;
    await user.save();

    // Send verification code via email
    const emailHtml = `
      <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
        <h2 style="color: #333;">Email Verification</h2>
        <p>Hello ${user.name},</p>
        <p>Your email verification code is:</p>
        <div style="text-align: center; margin: 30px 0;">
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333;">
            ${verificationCode}
          </div>
        </div>
        <p>This code will expire in 1 hour.</p>
        <p>If you didn't request this code, please ignore this email.</p>
      </div>
    `;

    // Use the centralized email service
    const tempUser = { email: user.email, name: user.name };
    await emailService.sendVerificationCode(tempUser, verificationCode);

    res.json({
      success: true,
      message: 'Verification code sent successfully'
    });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send verification code'
    });
  }
});

// Verify email with token or code
router.post('/verify-email', async (req, res) => {
  try {
    const { token, email } = req.body;

    if (!token || !email) {
      return res.status(400).json({
        success: false,
        error: 'Token and email are required'
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    if (user.isEmailVerified) {
      return res.json({
        success: true,
        message: 'Email is already verified'
      });
    }

    // Check if token matches and hasn't expired
    const now = new Date();
    
    // Check verification code (6-digit)
    if (user.emailVerificationCode === token) {
      if (user.emailVerificationExpires && user.emailVerificationExpires > now) {
        user.isEmailVerified = true;
        user.emailVerifiedAt = now;
        user.emailVerificationCode = null;
        user.emailVerificationExpires = null;
        await user.save();

        return res.json({
          success: true,
          message: 'Email verified successfully'
        });
      } else {
        return res.status(400).json({
          success: false,
          error: 'Verification code has expired'
        });
      }
    }

    // Check verification token (URL-based)
    if (user.emailVerificationToken === token) {
      if (user.emailVerificationExpires && user.emailVerificationExpires > now) {
        user.isEmailVerified = true;
        user.emailVerifiedAt = now;
        user.emailVerificationToken = null;
        user.emailVerificationExpires = null;
        await user.save();

        return res.json({
          success: true,
          message: 'Email verified successfully'
        });
      } else {
        return res.status(400).json({
          success: false,
          error: 'Verification token has expired'
        });
      }
    }

    return res.status(400).json({
      success: false,
      error: 'Invalid verification token or code'
    });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify email'
    });
  }
});

module.exports = router;