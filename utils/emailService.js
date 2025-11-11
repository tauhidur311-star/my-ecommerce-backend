const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Email service for sending notifications and verification emails
class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  async sendVerificationEmail(user, verificationToken) {
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}&email=${user.email}`;
    
    const mailOptions = {
      from: process.env.FROM_EMAIL || 'noreply@yourdomain.com',
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
      await this.transporter.sendMail(mailOptions);
      return { success: true };
    } catch (error) {
      console.error('Email sending failed:', error);
      throw new Error('Failed to send verification email');
    }
  }

  async sendPasswordResetEmail(user, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}&email=${user.email}`;
    
    const mailOptions = {
      from: process.env.FROM_EMAIL || 'noreply@yourdomain.com',
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
    const mailOptions = {
      from: process.env.FROM_EMAIL || 'noreply@yourdomain.com',
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
      await this.transporter.sendMail(mailOptions);
      return { success: true };
    } catch (error) {
      console.error('2FA code email sending failed:', error);
      throw new Error('Failed to send 2FA code');
    }
  }

  async sendOrderConfirmation(user, order) {
    const mailOptions = {
      from: process.env.FROM_EMAIL || 'noreply@yourdomain.com',
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
}

module.exports = new EmailService();