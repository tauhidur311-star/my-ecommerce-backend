const Mailjet = require('node-mailjet');
const crypto = require('crypto');

// Enhanced Email service using Mailjet REST API
class MailjetEmailService {
  constructor() {
    // Initialize Mailjet client
    this.mailjetClient = null;
    this.isMailjetConfigured = false;
    
    this.initializeMailjet();
  }

  initializeMailjet() {
    try {
      if (process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY) {
        this.mailjetClient = new Mailjet({
          apiKey: process.env.MAILJET_API_KEY,
          apiSecret: process.env.MAILJET_SECRET_KEY
        });
        this.isMailjetConfigured = true;
        const logger = require('./structuredLogger');
        logger.info('Mailjet REST API configured successfully');
        
        // Test the connection
        this.testMailjetConnection();
      } else {
        const logger = require('./structuredLogger');
        logger.warn('Mailjet API keys not found', {
          hasApiKey: !!process.env.MAILJET_API_KEY,
          hasSecretKey: !!process.env.MAILJET_SECRET_KEY
        });
      }
    } catch (error) {
      const logger = require('./structuredLogger');
      logger.error('Failed to initialize Mailjet', { error: error.message });
      this.isMailjetConfigured = false;
    }
  }

  async testMailjetConnection() {
    try {
      // Test with a simple API call to get account info
      const result = await this.mailjetClient
        .get('user')
        .request();
      
      if (result.response && result.response.status === 200) {
        const logger = require('./structuredLogger');
        logger.info('Mailjet REST API connection verified successfully');
        return true;
      } else {
        throw new Error('Invalid response from Mailjet API');
      }
    } catch (error) {
      const logger = require('./structuredLogger');
      logger.error('Mailjet API connection test failed', { error: error.message });
      this.isMailjetConfigured = false;
      return false;
    }
  }

  async sendEmail(emailOptions) {
    if (!this.isMailjetConfigured) {
      throw new Error('Mailjet is not properly configured');
    }

    const {
      to,
      subject,
      text,
      html,
      from = process.env.FROM_EMAIL || 'noreply@yourdomain.com',
      fromName = process.env.FROM_NAME || process.env.APP_NAME || 'Your Store'
    } = emailOptions;

    try {
      const mailjetRequest = {
        Messages: [
          {
            From: {
              Email: from,
              Name: fromName
            },
            To: [
              {
                Email: to,
                Name: to.split('@')[0] // Use email prefix as name fallback
              }
            ],
            Subject: subject,
            TextPart: text || '',
            HTMLPart: html || text || ''
          }
        ]
      };

      const result = await this.mailjetClient
        .post('send', { version: 'v3.1' })
        .request(mailjetRequest);

      if (result.response && result.response.status === 200) {
        const logger = require('./structuredLogger');
        logger.info('Email sent successfully via Mailjet REST API', {
          to: emailData.to,
          subject: emailData.subject,
          messageId: result.body.Messages[0].To[0].MessageID
        });
        return {
          success: true,
          messageId: result.body.Messages[0].To[0].MessageID,
          response: result.body
        };
      } else {
        throw new Error(`Mailjet API returned status: ${result.response?.status}`);
      }

    } catch (error) {
      const logger = require('./structuredLogger');
      logger.error('Failed to send email via Mailjet REST API', {
        error: error.message,
        to: emailData.to,
        subject: emailData.subject
      });
      throw error;
    }
  }

  async sendVerificationEmail(user, verificationToken) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}&email=${encodeURIComponent(user.email)}`;
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { font-size: 28px; font-weight: bold; color: #3b82f6; }
          .content { background: #f8fafc; padding: 30px; border-radius: 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #3b82f6; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">${process.env.APP_NAME || 'StyleShop'}</div>
          </div>
          
          <div class="content">
            <h2>Welcome to ${process.env.APP_NAME || 'StyleShop'}!</h2>
            <p>Hi ${user.name || 'there'},</p>
            <p>Thank you for creating an account with us. To complete your registration and start shopping, please verify your email address by clicking the button below:</p>
            
            <div style="text-align: center;">
              <a href="${verificationUrl}" class="button">Verify Email Address</a>
            </div>
            
            <p>If the button doesn't work, you can also copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #3b82f6;">${verificationUrl}</p>
            
            <p><strong>This verification link will expire in 24 hours.</strong></p>
            
            <p>If you didn't create an account with us, please ignore this email.</p>
          </div>
          
          <div class="footer">
            <p>© ${new Date().getFullYear()} ${process.env.APP_NAME || 'StyleShop'}. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
Welcome to ${process.env.APP_NAME || 'StyleShop'}!

Hi ${user.name || 'there'},

Thank you for creating an account with us. To complete your registration and start shopping, please verify your email address by clicking the link below:

${verificationUrl}

This verification link will expire in 24 hours.

If you didn't create an account with us, please ignore this email.

© ${new Date().getFullYear()} ${process.env.APP_NAME || 'StyleShop'}. All rights reserved.
    `;

    return await this.sendEmail({
      to: user.email,
      subject: `Verify Your Email - ${process.env.APP_NAME || 'StyleShop'}`,
      text: textContent,
      html: htmlContent
    });
  }

  async sendPasswordResetEmail(user, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;
    
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { font-size: 28px; font-weight: bold; color: #3b82f6; }
          .content { background: #f8fafc; padding: 30px; border-radius: 10px; }
          .button { display: inline-block; padding: 12px 30px; background: #dc2626; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
          .warning { background: #fef2f2; border: 1px solid #fecaca; padding: 15px; border-radius: 5px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">${process.env.APP_NAME || 'StyleShop'}</div>
          </div>
          
          <div class="content">
            <h2>Reset Your Password</h2>
            <p>Hi ${user.name || 'there'},</p>
            <p>We received a request to reset your password for your ${process.env.APP_NAME || 'StyleShop'} account.</p>
            
            <div style="text-align: center;">
              <a href="${resetUrl}" class="button">Reset Password</a>
            </div>
            
            <p>If the button doesn't work, you can also copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #dc2626;">${resetUrl}</p>
            
            <div class="warning">
              <strong>Important Security Information:</strong>
              <ul>
                <li>This reset link will expire in 1 hour</li>
                <li>If you didn't request this reset, please ignore this email</li>
                <li>Your password will remain unchanged until you create a new one</li>
              </ul>
            </div>
          </div>
          
          <div class="footer">
            <p>© ${new Date().getFullYear()} ${process.env.APP_NAME || 'StyleShop'}. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
Reset Your Password - ${process.env.APP_NAME || 'StyleShop'}

Hi ${user.name || 'there'},

We received a request to reset your password for your ${process.env.APP_NAME || 'StyleShop'} account.

Click the following link to reset your password:
${resetUrl}

IMPORTANT SECURITY INFORMATION:
- This reset link will expire in 1 hour
- If you didn't request this reset, please ignore this email
- Your password will remain unchanged until you create a new one

© ${new Date().getFullYear()} ${process.env.APP_NAME || 'StyleShop'}. All rights reserved.
    `;

    return await this.sendEmail({
      to: user.email,
      subject: `Reset Your Password - ${process.env.APP_NAME || 'StyleShop'}`,
      text: textContent,
      html: htmlContent
    });
  }

  async sendOTPEmail(email, otpCode, purpose = 'verification') {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Verification Code</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { font-size: 28px; font-weight: bold; color: #3b82f6; }
          .content { background: #f8fafc; padding: 30px; border-radius: 10px; text-align: center; }
          .otp-code { font-size: 36px; font-weight: bold; color: #3b82f6; background: white; padding: 20px; border-radius: 10px; margin: 20px 0; letter-spacing: 8px; }
          .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">${process.env.APP_NAME || 'StyleShop'}</div>
          </div>
          
          <div class="content">
            <h2>Your Verification Code</h2>
            <p>Here's your ${purpose} code:</p>
            
            <div class="otp-code">${otpCode}</div>
            
            <p><strong>This code will expire in 10 minutes.</strong></p>
            <p>Enter this code to complete your ${purpose}.</p>
            
            <p>If you didn't request this code, please ignore this email.</p>
          </div>
          
          <div class="footer">
            <p>© ${new Date().getFullYear()} ${process.env.APP_NAME || 'StyleShop'}. All rights reserved.</p>
            <p>This is an automated email. Please do not reply to this message.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const textContent = `
Your Verification Code - ${process.env.APP_NAME || 'StyleShop'}

Your ${purpose} code: ${otpCode}

This code will expire in 10 minutes.
Enter this code to complete your ${purpose}.

If you didn't request this code, please ignore this email.

© ${new Date().getFullYear()} ${process.env.APP_NAME || 'StyleShop'}. All rights reserved.
    `;

    return await this.sendEmail({
      to: email,
      subject: `Your Verification Code - ${process.env.APP_NAME || 'StyleShop'}`,
      text: textContent,
      html: htmlContent
    });
  }

  async sendOrderConfirmationEmail(user, order) {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Confirmation</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .logo { font-size: 28px; font-weight: bold; color: #3b82f6; }
          .content { background: #f8fafc; padding: 30px; border-radius: 10px; }
          .order-info { background: white; padding: 20px; border-radius: 10px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">${process.env.APP_NAME || 'StyleShop'}</div>
          </div>
          
          <div class="content">
            <h2>Order Confirmation</h2>
            <p>Hi ${user.name || 'there'},</p>
            <p>Thank you for your order! We've received your order and are processing it now.</p>
            
            <div class="order-info">
              <h3>Order Details</h3>
              <p><strong>Order Number:</strong> ${order.orderNumber || order._id}</p>
              <p><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString()}</p>
              <p><strong>Total Amount:</strong> ৳${order.totalAmount || order.total}</p>
            </div>
            
            <p>We'll send you another email when your order ships.</p>
            <p>You can track your order status in your account dashboard.</p>
          </div>
          
          <div class="footer">
            <p>© ${new Date().getFullYear()} ${process.env.APP_NAME || 'StyleShop'}. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return await this.sendEmail({
      to: user.email,
      subject: `Order Confirmation #${order.orderNumber || order._id} - ${process.env.APP_NAME || 'StyleShop'}`,
      html: htmlContent
    });
  }

  // Method to check if Mailjet is properly configured
  isConfigured() {
    return this.isMailjetConfigured;
  }

  // Method to get Mailjet statistics
  async getStats() {
    if (!this.isMailjetConfigured) {
      throw new Error('Mailjet is not configured');
    }

    try {
      const result = await this.mailjetClient
        .get('statcounters')
        .request();
      
      return result.body;
    } catch (error) {
      const logger = require('./structuredLogger');
      logger.error('Failed to get Mailjet stats', { error: error.message });
      throw error;
    }
  }
}

module.exports = new MailjetEmailService();