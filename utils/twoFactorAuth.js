const crypto = require('crypto');
const emailService = require('./emailService');

class TwoFactorAuth {
  constructor() {
    this.codeExpiry = 10 * 60 * 1000; // 10 minutes
  }

  // Generate a 6-digit verification code
  generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // Generate a secret for TOTP (future implementation)
  generateSecret() {
    return crypto.randomBytes(20).toString('base32');
  }

  // Send 2FA code via email
  async sendCodeViaEmail(user) {
    try {
      const code = this.generateCode();
      const expiry = new Date(Date.now() + this.codeExpiry);

      // Save code to user document
      user.twoFactorCode = code;
      user.twoFactorExpires = expiry;
      await user.save();

      // Send email
      await emailService.sendTwoFactorCode(user, code);

      return {
        success: true,
        message: 'Two-factor authentication code sent to your email',
        expiresIn: this.codeExpiry / 1000 / 60 // minutes
      };
    } catch (error) {
      console.error('Error sending 2FA code:', error);
      throw new Error('Failed to send verification code');
    }
  }

  // Verify 2FA code
  async verifyCode(user, providedCode) {
    try {
      // Check if code exists and is not expired
      if (!user.twoFactorCode || !user.twoFactorExpires) {
        return {
          success: false,
          error: 'No verification code found. Please request a new one.'
        };
      }

      // Check if code has expired
      if (user.twoFactorExpires < new Date()) {
        // Clear expired code
        user.twoFactorCode = null;
        user.twoFactorExpires = null;
        await user.save();

        return {
          success: false,
          error: 'Verification code has expired. Please request a new one.'
        };
      }

      // Check if code matches
      if (user.twoFactorCode !== providedCode) {
        return {
          success: false,
          error: 'Invalid verification code.'
        };
      }

      // Clear the code after successful verification
      user.twoFactorCode = null;
      user.twoFactorExpires = null;
      await user.save();

      return {
        success: true,
        message: 'Two-factor authentication verified successfully'
      };
    } catch (error) {
      console.error('Error verifying 2FA code:', error);
      throw new Error('Failed to verify code');
    }
  }

  // Enable 2FA for user
  async enableTwoFactor(user) {
    try {
      if (user.twoFactorEnabled) {
        return {
          success: false,
          error: 'Two-factor authentication is already enabled'
        };
      }

      // Generate and send initial code
      const result = await this.sendCodeViaEmail(user);
      
      return {
        success: true,
        message: 'Two-factor authentication setup initiated. Please verify the code sent to your email.',
        expiresIn: result.expiresIn
      };
    } catch (error) {
      console.error('Error enabling 2FA:', error);
      throw new Error('Failed to enable two-factor authentication');
    }
  }

  // Disable 2FA for user
  async disableTwoFactor(user) {
    try {
      if (!user.twoFactorEnabled) {
        return {
          success: false,
          error: 'Two-factor authentication is not enabled'
        };
      }

      // Clear 2FA settings
      user.twoFactorEnabled = false;
      user.twoFactorSecret = null;
      user.twoFactorCode = null;
      user.twoFactorExpires = null;
      await user.save();

      return {
        success: true,
        message: 'Two-factor authentication has been disabled'
      };
    } catch (error) {
      console.error('Error disabling 2FA:', error);
      throw new Error('Failed to disable two-factor authentication');
    }
  }

  // Complete 2FA setup
  async completeTwoFactorSetup(user, verificationCode) {
    try {
      // Verify the code first
      const verificationResult = await this.verifyCode(user, verificationCode);
      
      if (!verificationResult.success) {
        return verificationResult;
      }

      // Enable 2FA
      user.twoFactorEnabled = true;
      await user.save();

      return {
        success: true,
        message: 'Two-factor authentication has been successfully enabled'
      };
    } catch (error) {
      console.error('Error completing 2FA setup:', error);
      throw new Error('Failed to complete two-factor authentication setup');
    }
  }

  // Check if user requires 2FA verification
  requiresTwoFactor(user) {
    return user.twoFactorEnabled === true;
  }
}

module.exports = new TwoFactorAuth();