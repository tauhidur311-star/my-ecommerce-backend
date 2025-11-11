const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Email service for sending notifications and verification emails
class EmailService {
  constructor() {
    // Configure transporter based on environment variables
    const emailConfig = {
      host: process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp.mailtrap.io',
      port: parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || '587'),
      secure: false, // Use TLS
      auth: {
        user: process.env.SMTP_USER || process.env.EMAIL_USER,
        pass: process.env.SMTP_PASS || process.env.EMAIL_PASS,
      },
    };

    // Special configuration for Mailjet
    if (emailConfig.host === 'in-v3.mailjet.com') {
      console.log('📧 Using Mailjet SMTP configuration');
      emailConfig.auth = {
        user: process.env.MAILJET_API_KEY || process.env.SMTP_USER,
        pass: process.env.MAILJET_SECRET_KEY || process.env.SMTP_PASS,
      };
      
      // Try alternative Mailjet SMTP settings for better compatibility
      if (process.env.NODE_ENV === 'production') {
        console.log('🔧 Using production-optimized Mailjet settings');
        emailConfig.host = 'in-v3.mailjet.com';
        emailConfig.port = 587;
        emailConfig.secure = false; // Use STARTTLS
        emailConfig.requireTLS = true;
        emailConfig.connectionTimeout = 15000; // 15 second timeout
        emailConfig.greetingTimeout = 10000; // 10 second greeting
        emailConfig.socketTimeout = 15000; // 15 second socket timeout
        emailConfig.tls = {
          rejectUnauthorized: false,
          minVersion: 'TLSv1.2'
        };
        emailConfig.debug = false; // Disable debug in production
        emailConfig.logger = false; // Disable logging
      } else {
        // Development settings
        emailConfig.connectionTimeout = 10000;
        emailConfig.greetingTimeout = 5000;
        emailConfig.socketTimeout = 10000;
        emailConfig.requireTLS = true;
        emailConfig.secure = false;
        emailConfig.tls = {
          ciphers: 'SSLv3',
          rejectUnauthorized: false
        };
      }
    }

    // Special configuration for Gmail
    if (emailConfig.host === 'smtp.gmail.com') {
      console.log('📧 Using Gmail SMTP configuration');
      emailConfig.secure = false; // Use STARTTLS
      emailConfig.requireTLS = true;
    }

    console.log(`📧 Email service configured with host: ${emailConfig.host}:${emailConfig.port}`);

    this.transporter = nodemailer.createTransport(emailConfig);
    
    // Verify the connection on startup
    this.verifyConnection();
  }

  async verifyConnection() {
    try {
      console.log('🔍 Testing email service connection...');
      // Skip verification in production to avoid connection timeout issues
      if (process.env.NODE_ENV === 'production') {
        console.log('⏭️ Skipping email verification in production environment');
        return;
      }
      await this.transporter.verify();
      console.log('✅ Email service connection verified successfully');
    } catch (error) {
      console.error('❌ Email service connection failed:', error.message);
      console.log('🔧 Continuing without verification - will attempt actual sending when needed...');
      // Continue without verification - some services don't support verify()
    }
  }

  async sendVerificationEmail(user, verificationToken) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}&email=${user.email}`;
    
    const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_FROM || 'noreply@yourdomain.com';
    const fromName = process.env.FROM_NAME || process.env.APP_NAME || 'Your Store';
    
    const mailOptions = {
      from: `${fromName} <${fromEmail}>`,
      to: user.email,
      subject: 'Verify Your Email Address',
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
          <h2 style="color: #333;">Welcome to Our Store!</h2>
          <p>Hello ${user.name},</p>
          <p>Thank you for registering with us. Please click the button below to verify your email address:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" 
               style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Verify Email Address
            </a>
          </div>
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
          <p>This link will expire in 24 hours.</p>
          <p>If you didn't create this account, please ignore this email.</p>
        </div>
      `,
    };

    try {
      console.log(`📧 Attempting to send verification email to ${user.email}...`);
      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Verification email sent successfully to ${user.email}`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('Verification email sending failed:', error);
      
      // Fallback to REST API on timeout
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
        console.log('🔄 SMTP timeout detected, falling back to Mailjet REST API...');
        try {
          const apiResult = await this.sendViaMailjetAPI(
            user.email,
            'Verify Your Email Address',
            mailOptions.html
          );
          console.log(`✅ Verification email sent via API to ${user.email}`);
          return apiResult;
        } catch (apiError) {
          console.error('API fallback also failed:', apiError);
        }
      }
      
      throw new Error('Failed to send verification email');
    }
  }

  async sendPasswordResetEmail(user, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&email=${user.email}`;
    
    const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_FROM || 'noreply@yourdomain.com';
    const fromName = process.env.FROM_NAME || process.env.APP_NAME || 'Your Store';
    
    const mailOptions = {
      from: `${fromName} <${fromEmail}>`,
      to: user.email,
      subject: 'Reset Your Password',
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p>Hello ${user.name},</p>
          <p>We received a request to reset your password. Click the button below to reset it:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="background-color: #dc3545; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p>If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="word-break: break-all; color: #666;">${resetUrl}</p>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't request this reset, please ignore this email and your password will remain unchanged.</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      return { success: true };
    } catch (error) {
      console.error('Password reset email sending failed:', error);
      throw new Error('Failed to send password reset email');
    }
  }

  async sendTwoFactorCode(user, code) {
    const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_FROM || 'noreply@yourdomain.com';
    const fromName = process.env.FROM_NAME || process.env.APP_NAME || 'Your Store';
    
    const mailOptions = {
      from: `${fromName} <${fromEmail}>`,
      to: user.email,
      subject: 'Your Two-Factor Authentication Code',
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
          <h2 style="color: #333;">Two-Factor Authentication</h2>
          <p>Hello ${user.name},</p>
          <p>Your two-factor authentication code is:</p>
          <div style="text-align: center; margin: 30px 0;">
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333;">
              ${code}
            </div>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't request this code, please contact our support team immediately.</p>
        </div>
      `,
    };

    try {
      console.log(`📧 Attempting to send 2FA code to ${user.email}...`);
      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ 2FA code email sent successfully to ${user.email}`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('2FA code email sending failed:', error);
      
      // If it's a connection timeout, try Mailjet REST API as fallback
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
        console.log('🔄 SMTP timeout detected, falling back to Mailjet REST API...');
        try {
          const apiResult = await this.sendViaMailjetAPI(
            user.email,
            'Your Two-Factor Authentication Code',
            mailOptions.html
          );
          console.log(`✅ 2FA code email sent via API to ${user.email}`);
          return apiResult;
        } catch (apiError) {
          console.error('API fallback also failed:', apiError);
        }
      }
      
      throw new Error('Failed to send 2FA code');
    }
  }

  createFreshTransporter() {
    const emailConfig = {
      host: 'in-v3.mailjet.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 20000, // 20 second timeout for retry
      greetingTimeout: 15000,
      socketTimeout: 20000,
      requireTLS: true,
      tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
      }
    };
    
    const nodemailer = require('nodemailer');
    return nodemailer.createTransport(emailConfig); // Fixed: was createTransporter, should be createTransport
  }

  // Fallback to Mailjet REST API when SMTP fails
  async sendViaMailjetAPI(to, subject, htmlContent) {
    try {
      console.log('🔄 Attempting to send email via Mailjet REST API...');
      
      const https = require('https');
      const apiKey = process.env.SMTP_USER;
      const apiSecret = process.env.SMTP_PASS;
      const fromEmail = process.env.FROM_EMAIL || 'noreply@yourdomain.com';
      const fromName = process.env.FROM_NAME || 'Your Store';
      
      const postData = JSON.stringify({
        Messages: [{
          From: {
            Email: fromEmail,
            Name: fromName
          },
          To: [{
            Email: to
          }],
          Subject: subject,
          HTMLPart: htmlContent
        }]
      });

      const options = {
        hostname: 'api.mailjet.com',
        port: 443,
        path: '/v3.1/send',
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64'),
          'Content-Type': 'application/json',
          'Content-Length': postData.length
        }
      };

      return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              console.log('✅ Email sent successfully via Mailjet REST API');
              resolve({ success: true, method: 'API' });
            } else {
              console.error('❌ Mailjet API error:', res.statusCode, data);
              reject(new Error(`API Error: ${res.statusCode}`));
            }
          });
        });

        req.on('error', (error) => {
          console.error('❌ Mailjet API request failed:', error);
          reject(error);
        });

        req.write(postData);
        req.end();
      });
    } catch (error) {
      console.error('❌ Mailjet API fallback failed:', error);
      throw error;
    }
  }

  async sendOrderConfirmation(user, order) {
    const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_FROM || 'noreply@yourdomain.com';
    const fromName = process.env.FROM_NAME || process.env.APP_NAME || 'Your Store';
    
    const mailOptions = {
      from: `${fromName} <${fromEmail}>`,
      to: user.email,
      subject: `Order Confirmation - Order #${order._id.toString().slice(-8)}`,
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
          <h2 style="color: #333;">Order Confirmation</h2>
          <p>Hello ${user.name},</p>
          <p>Thank you for your order! Here are the details:</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Order #${order._id.toString().slice(-8)}</h3>
            <p><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString()}</p>
            <p><strong>Total Amount:</strong> ৳${order.totalAmount}</p>
            <p><strong>Payment Method:</strong> ${order.paymentMethod.toUpperCase()}</p>
            <p><strong>Status:</strong> ${order.status.charAt(0).toUpperCase() + order.status.slice(1)}</p>
          </div>

          <h3>Order Items:</h3>
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background-color: #f8f9fa;">
                <th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Item</th>
                <th style="border: 1px solid #ddd; padding: 12px; text-align: center;">Qty</th>
                <th style="border: 1px solid #ddd; padding: 12px; text-align: right;">Price</th>
              </tr>
            </thead>
            <tbody>
              ${order.items.map(item => `
                <tr>
                  <td style="border: 1px solid #ddd; padding: 12px;">${item.productId.name || 'Product'}</td>
                  <td style="border: 1px solid #ddd; padding: 12px; text-align: center;">${item.quantity}</td>
                  <td style="border: 1px solid #ddd; padding: 12px; text-align: right;">৳${item.price}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <h3>Shipping Address:</h3>
          <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px;">
            <p>${order.shippingAddress.name}<br>
            ${order.shippingAddress.address}<br>
            ${order.shippingAddress.city}, ${order.shippingAddress.zipCode}</p>
          </div>

          <p style="margin-top: 30px;">We'll send you an email when your order ships. You can track your order status in your dashboard.</p>
          <p>Thank you for shopping with us!</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      return { success: true };
    } catch (error) {
      console.error('Order confirmation email sending failed:', error);
      throw new Error('Failed to send order confirmation email');
    }
  }

  generateVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  generateTwoFactorCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async sendVerificationCode(user, code) {
    const fromEmail = process.env.FROM_EMAIL || process.env.EMAIL_FROM || 'noreply@yourdomain.com';
    const fromName = process.env.FROM_NAME || process.env.APP_NAME || 'Your Store';
    
    const mailOptions = {
      from: `${fromName} <${fromEmail}>`,
      to: user.email,
      subject: 'Email Verification Code',
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
          <h2 style="color: #333;">Email Verification</h2>
          <p>Hello ${user.name},</p>
          <p>Your email verification code is:</p>
          <div style="text-align: center; margin: 30px 0;">
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #333;">
              ${code}
            </div>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't request this code, please ignore this email.</p>
        </div>
      `,
    };

    try {
      console.log(`📧 Attempting to send verification code to ${user.email}...`);
      const result = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Verification code email sent successfully to ${user.email}`);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      console.error('Verification code email sending failed:', error);
      
      // Fallback to REST API on timeout
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
        console.log('🔄 SMTP timeout detected, falling back to Mailjet REST API...');
        try {
          const apiResult = await this.sendViaMailjetAPI(
            user.email,
            'Email Verification Code',
            mailOptions.html
          );
          console.log(`✅ Verification code email sent via API to ${user.email}`);
          return apiResult;
        } catch (apiError) {
          console.error('API fallback also failed:', apiError);
        }
      }
      
      throw new Error('Failed to send verification code');
    }
  }
}

module.exports = new EmailService();