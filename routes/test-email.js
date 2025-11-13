const express = require('express');
const router = express.Router();
const emailService = require('../utils/emailService');
const logger = require('../utils/structuredLogger');

// Test endpoint for email functionality
router.post('/test-email', async (req, res) => {
  try {
    const { email, type = 'verification' } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required'
      });
    }

    logger.info('Testing email service', { email, type });

    const testUser = {
      _id: 'test-' + Date.now(),
      email: email,
      name: 'Test User'
    };

    let result;

    switch (type) {
      case 'verification':
        result = await emailService.sendVerificationEmail(testUser, 'test-token-' + Date.now());
        break;
      
      case 'password-reset':
        result = await emailService.sendPasswordResetEmail(testUser, 'reset-token-' + Date.now());
        break;
      
      case '2fa':
        result = await emailService.send2FACode(testUser, '123456');
        break;
      
      case 'welcome':
        result = await emailService.sendWelcomeEmail(testUser);
        break;
      
      case 'generic':
        result = await emailService.sendEmail(
          email,
          'Test Email from Your E-commerce Store',
          '<h1>Test Email</h1><p>This is a test email sent via Mailjet REST API!</p><p>Timestamp: ' + new Date().toISOString() + '</p>'
        );
        break;
      
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid email type. Use: verification, password-reset, 2fa, welcome, or generic'
        });
    }

    logger.info('Test email sent successfully', { 
      email, 
      type, 
      messageId: result.messageId 
    });

    res.json({
      success: true,
      message: `Test ${type} email sent successfully`,
      data: {
        email,
        type,
        messageId: result.messageId,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Test email failed', { 
      error: error.message,
      email: req.body.email,
      type: req.body.type
    });

    res.status(500).json({
      success: false,
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Health check endpoint
router.get('/email-health', async (req, res) => {
  try {
    const health = await emailService.healthCheck();
    const serviceInfo = emailService.getServiceInfo();

    res.json({
      success: true,
      health,
      serviceInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;