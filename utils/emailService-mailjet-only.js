const mailjetService = require('./mailjetEmailService');
const logger = require('./structuredLogger');

// Email service using PURE Mailjet REST API (no SMTP)
class EmailService {
  constructor() {
    this.isReady = false;
    this.initialize();
  }

  async initialize() {
    try {
      // Check if Mailjet is configured
      if (!process.env.MAILJET_API_KEY || !process.env.MAILJET_SECRET_KEY) {
        logger.error('Mailjet API keys not configured', {
          hasApiKey: !!process.env.MAILJET_API_KEY,
          hasSecretKey: !!process.env.MAILJET_SECRET_KEY
        });
        throw new Error('MAILJET_API_KEY and MAILJET_SECRET_KEY environment variables are required');
      }

      // Test Mailjet connection
      await mailjetService.testMailjetConnection();
      this.isReady = true;
      
      logger.info('Email service initialized with Mailjet REST API', {
        service: 'mailjet_rest_api',
        status: 'ready'
      });

    } catch (error) {
      logger.error('Failed to initialize email service', { 
        error: error.message,
        service: 'mailjet_rest_api'
      });
      throw error;
    }
  }

  // Send verification email for user registration
  async sendVerificationEmail(user, verificationToken) {
    try {
      if (!this.isReady) {
        await this.initialize();
      }

      logger.info('Sending verification email', {
        userEmail: user.email,
        userId: user._id,
        service: 'mailjet_rest_api'
      });

      const result = await mailjetService.sendVerificationEmail(user, verificationToken);
      
      logger.info('Verification email sent successfully', {
        userEmail: user.email,
        userId: user._id,
        messageId: result.messageId,
        service: 'mailjet_rest_api'
      });

      return { success: true, messageId: result.messageId };

    } catch (error) {
      logger.error('Failed to send verification email', {
        error: error.message,
        userEmail: user.email,
        userId: user._id,
        service: 'mailjet_rest_api'
      });
      throw new Error('Failed to send verification email');
    }
  }

  // Send password reset email
  async sendPasswordResetEmail(user, resetToken) {
    try {
      if (!this.isReady) {
        await this.initialize();
      }

      logger.info('Sending password reset email', {
        userEmail: user.email,
        userId: user._id,
        service: 'mailjet_rest_api'
      });

      const result = await mailjetService.sendPasswordResetEmail(user, resetToken);

      logger.info('Password reset email sent successfully', {
        userEmail: user.email,
        userId: user._id,
        messageId: result.messageId,
        service: 'mailjet_rest_api'
      });

      return { success: true, messageId: result.messageId };

    } catch (error) {
      logger.error('Failed to send password reset email', {
        error: error.message,
        userEmail: user.email,
        userId: user._id,
        service: 'mailjet_rest_api'
      });
      throw new Error('Failed to send password reset email');
    }
  }

  // Send 2FA code
  async send2FACode(user, code) {
    try {
      if (!this.isReady) {
        await this.initialize();
      }

      logger.info('Sending 2FA code', {
        userEmail: user.email,
        userId: user._id,
        service: 'mailjet_rest_api'
      });

      const result = await mailjetService.sendOTPEmail(user.email, code, '2FA Authentication');

      logger.info('2FA code sent successfully', {
        userEmail: user.email,
        userId: user._id,
        messageId: result.messageId,
        service: 'mailjet_rest_api'
      });

      return { success: true, messageId: result.messageId };

    } catch (error) {
      logger.error('Failed to send 2FA code', {
        error: error.message,
        userEmail: user.email,
        userId: user._id,
        service: 'mailjet_rest_api'
      });
      throw new Error('Failed to send 2FA code');
    }
  }

  // Send order confirmation email
  async sendOrderConfirmation(user, order) {
    try {
      if (!this.isReady) {
        await this.initialize();
      }

      logger.info('Sending order confirmation email', {
        userEmail: user.email,
        userId: user._id,
        orderId: order._id,
        service: 'mailjet_rest_api'
      });

      const result = await mailjetService.sendOrderConfirmation(user, order);

      logger.info('Order confirmation email sent successfully', {
        userEmail: user.email,
        userId: user._id,
        orderId: order._id,
        messageId: result.messageId,
        service: 'mailjet_rest_api'
      });

      return { success: true, messageId: result.messageId };

    } catch (error) {
      logger.error('Failed to send order confirmation email', {
        error: error.message,
        userEmail: user.email,
        userId: user._id,
        orderId: order._id,
        service: 'mailjet_rest_api'
      });
      throw new Error('Failed to send order confirmation email');
    }
  }

  // Send verification code (generic)
  async sendVerificationCode(user, code, subject = 'Email Verification Code') {
    try {
      if (!this.isReady) {
        await this.initialize();
      }

      logger.info('Sending verification code', {
        userEmail: user.email,
        userId: user._id,
        subject,
        service: 'mailjet_rest_api'
      });

      const result = await mailjetService.sendOTPEmail(user.email, code, subject);

      logger.info('Verification code sent successfully', {
        userEmail: user.email,
        userId: user._id,
        subject,
        messageId: result.messageId,
        service: 'mailjet_rest_api'
      });

      return { success: true, messageId: result.messageId };

    } catch (error) {
      logger.error('Failed to send verification code', {
        error: error.message,
        userEmail: user.email,
        userId: user._id,
        subject,
        service: 'mailjet_rest_api'
      });
      throw new Error('Failed to send verification code');
    }
  }

  // Send welcome email
  async sendWelcomeEmail(user) {
    try {
      if (!this.isReady) {
        await this.initialize();
      }

      logger.info('Sending welcome email', {
        userEmail: user.email,
        userId: user._id,
        service: 'mailjet_rest_api'
      });

      const result = await mailjetService.sendWelcomeEmail(user);

      logger.info('Welcome email sent successfully', {
        userEmail: user.email,
        userId: user._id,
        messageId: result.messageId,
        service: 'mailjet_rest_api'
      });

      return { success: true, messageId: result.messageId };

    } catch (error) {
      logger.error('Failed to send welcome email', {
        error: error.message,
        userEmail: user.email,
        userId: user._id,
        service: 'mailjet_rest_api'
      });
      throw new Error('Failed to send welcome email');
    }
  }

  // Generic email sending method
  async sendEmail(to, subject, htmlContent, textContent = null) {
    try {
      if (!this.isReady) {
        await this.initialize();
      }

      logger.info('Sending generic email', {
        to,
        subject,
        service: 'mailjet_rest_api'
      });

      const result = await mailjetService.sendEmail({
        to,
        subject,
        html: htmlContent,
        text: textContent || this.htmlToText(htmlContent)
      });

      logger.info('Generic email sent successfully', {
        to,
        subject,
        messageId: result.messageId,
        service: 'mailjet_rest_api'
      });

      return { success: true, messageId: result.messageId };

    } catch (error) {
      logger.error('Failed to send generic email', {
        error: error.message,
        to,
        subject,
        service: 'mailjet_rest_api'
      });
      throw new Error('Failed to send email');
    }
  }

  // Convert HTML to plain text (basic implementation)
  htmlToText(html) {
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace &nbsp;
      .replace(/&amp;/g, '&') // Replace &amp;
      .replace(/&lt;/g, '<') // Replace &lt;
      .replace(/&gt;/g, '>') // Replace &gt;
      .trim();
  }

  // Health check method
  async healthCheck() {
    try {
      const stats = await mailjetService.getMailjetStats();
      return {
        status: 'healthy',
        service: 'mailjet_rest_api',
        isReady: this.isReady,
        stats
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        service: 'mailjet_rest_api',
        isReady: this.isReady,
        error: error.message
      };
    }
  }

  // Get service info
  getServiceInfo() {
    return {
      name: 'EmailService',
      type: 'mailjet_rest_api',
      isReady: this.isReady,
      features: [
        'User verification emails',
        'Password reset emails',
        '2FA authentication codes',
        'Order confirmation emails',
        'Welcome emails',
        'Generic email sending'
      ]
    };
  }
}

module.exports = new EmailService();