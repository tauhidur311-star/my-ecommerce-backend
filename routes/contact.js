const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const { broadcastNewSubmission } = require('../controllers/analyticsController');

// Try to load express-validator, fallback to custom validation
let body, validationResult;
try {
  ({ body, validationResult } = require('express-validator'));
} catch (error) {
  console.warn('⚠️ express-validator not available, using fallback validation');
  // Fallback validation functions
  body = (field) => ({
    trim: () => ({ isLength: () => ({ withMessage: () => ({ matches: () => ({ withMessage: () => ({}) }) }) }) }),
    isEmail: () => ({ normalizeEmail: () => ({ withMessage: () => ({ isLength: () => ({ withMessage: () => ({}) }) }) }) }),
    isIn: () => ({ withMessage: () => ({}) }),
    escape: () => ({})
  });
  validationResult = () => ({ isEmpty: () => true, array: () => [] });
}

const { validate } = require('../utils/validation');

// Enhanced email service (with fallback)
let enhancedEmailService;
try {
  enhancedEmailService = require('../utils/mailjetEmailService');
  console.log('✅ Enhanced email service loaded for contact forms');
} catch (error) {
  console.warn('⚠️  Enhanced email service not available, using basic email service');
  enhancedEmailService = require('../utils/emailService');
}

// Rate limiting for contact form submissions
const contactLimiter = require('express-rate-limit')({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // limit each IP to 3 contact submissions per windowMs
  message: {
    success: false,
    error: 'Too many contact form submissions from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation middleware for contact form
const validateContactForm = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z\s\-'\.]+$/)
    .withMessage('Name can only contain letters, spaces, hyphens, apostrophes, and periods'),
  
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
    .isLength({ max: 254 })
    .withMessage('Email address is too long'),
  
  body('subject')
    .isIn(['general', 'support', 'billing', 'partnership', 'feedback', 'other'])
    .withMessage('Please select a valid subject'),
  
  body('message')
    .trim()
    .isLength({ min: 10, max: 2000 })
    .withMessage('Message must be between 10 and 2000 characters')
    .escape(), // Sanitize HTML
];

// @route   POST /api/contact
// @desc    Submit contact form
// @access  Public (with rate limiting)
router.post('/', contactLimiter, validateContactForm, async (req, res) => {
  try {
    // Check validation results
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid input data',
        details: errors.array()
      });
    }

    const { name, email, subject, message } = req.body;

    // Additional server-side validation
    if (!name || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        error: 'All fields are required'
      });
    }

    // Get client IP for tracking
    const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
    
    // Create contact record
    const contactData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      subject,
      message: message.trim(),
      ipAddress: clientIP,
      userAgent: req.get('User-Agent') || 'unknown',
      timestamp: new Date(),
      status: 'new'
    };

    // Save to database
    const contact = new Contact(contactData);
    await contact.save();

    // Broadcast real-time update for analytics
    try {
      broadcastNewSubmission(contact);
    } catch (broadcastError) {
      console.error('Error broadcasting new submission:', broadcastError);
    }

    // Prepare email content
    const subjectMapping = {
      general: 'General Inquiry',
      support: 'Technical Support Request',
      billing: 'Billing Question',
      partnership: 'Partnership Opportunity',
      feedback: 'Customer Feedback',
      other: 'Other Inquiry'
    };

    const emailSubject = `New Contact Form Submission: ${subjectMapping[subject]}`;
    
    const adminEmailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; border-bottom: 2px solid #4F46E5; padding-bottom: 10px;">
          New Contact Form Submission
        </h2>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #4F46E5; margin-top: 0;">Contact Details</h3>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Subject:</strong> ${subjectMapping[subject]}</p>
          <p><strong>Submission Time:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>IP Address:</strong> ${clientIP}</p>
        </div>
        
        <div style="background-color: #fff; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h3 style="color: #333; margin-top: 0;">Message</h3>
          <p style="white-space: pre-wrap; line-height: 1.6;">${message}</p>
        </div>
        
        <div style="margin-top: 20px; padding: 15px; background-color: #e8f4fd; border-radius: 8px;">
          <p style="margin: 0; font-size: 14px; color: #666;">
            <strong>Action Required:</strong> Please respond to this customer inquiry within 24 hours.
            <br>
            Contact ID: ${contact._id}
          </p>
        </div>
      </div>
    `;

    const customerEmailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4F46E5; text-align: center;">Thank You for Contacting Us!</h2>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p>Dear ${name},</p>
          <p>Thank you for reaching out to us. We have received your message and will get back to you as soon as possible.</p>
          
          <div style="background-color: #fff; padding: 15px; border-left: 4px solid #4F46E5; margin: 15px 0;">
            <h4 style="margin: 0 0 10px 0; color: #333;">Your Message:</h4>
            <p style="margin: 0; color: #666; white-space: pre-wrap;">${message}</p>
          </div>
        </div>
        
        <div style="background-color: #e8f4fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #333; margin: 0 0 10px 0;">What happens next?</h3>
          <ul style="margin: 0; padding-left: 20px; color: #666;">
            <li>Our team will review your message within 24 hours</li>
            <li>We'll respond to your inquiry at ${email}</li>
            <li>For urgent matters, you can call our support line</li>
          </ul>
        </div>
        
        <div style="text-align: center; margin-top: 30px; padding: 20px; background-color: #f8f9fa; border-radius: 8px;">
          <p style="margin: 0; color: #666; font-size: 14px;">
            Reference ID: ${contact._id}<br>
            Submitted: ${new Date().toLocaleString()}
          </p>
        </div>
        
        <div style="text-align: center; margin-top: 20px;">
          <p style="color: #999; font-size: 12px;">
            This is an automated response. Please do not reply to this email.
          </p>
        </div>
      </div>
    `;

    // Send enhanced email notifications
    try {
      // Enhanced admin notification email
      const adminNotificationSubject = `🔔 New Contact Submission - ${subjectMapping[subject]}`;
      const enhancedAdminContent = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 700px; margin: 0 auto; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 15px;">
          <div style="background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.1);">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">New Contact Submission</h1>
              <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">Priority: ${subject === 'support' ? 'High' : 'Medium'}</p>
            </div>
            
            <div style="padding: 30px;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px;">
                <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea;">
                  <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">Contact Details</h3>
                  <p style="margin: 5px 0; color: #666;"><strong>Name:</strong> ${name}</p>
                  <p style="margin: 5px 0; color: #666;"><strong>Email:</strong> ${email}</p>
                  <p style="margin: 5px 0; color: #666;"><strong>Subject:</strong> ${subjectMapping[subject]}</p>
                </div>
                
                <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #764ba2;">
                  <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">Submission Info</h3>
                  <p style="margin: 5px 0; color: #666;"><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                  <p style="margin: 5px 0; color: #666;"><strong>IP:</strong> ${clientIP}</p>
                  <p style="margin: 5px 0; color: #666;"><strong>ID:</strong> ${contact._id}</p>
                </div>
              </div>
              
              <div style="background: #fff; padding: 25px; border: 2px solid #f1f3f4; border-radius: 10px;">
                <h3 style="color: #333; margin: 0 0 15px 0; font-size: 18px;">Message</h3>
                <p style="white-space: pre-wrap; line-height: 1.8; color: #444; font-size: 15px; margin: 0;">${message}</p>
              </div>
              
              <div style="margin-top: 25px; text-align: center;">
                <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/contact-submissions" 
                   style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);">
                  View in Admin Dashboard →
                </a>
              </div>
            </div>
            
            <div style="background: #f8f9fa; padding: 20px; border-top: 1px solid #e9ecef; text-align: center;">
              <p style="margin: 0; color: #666; font-size: 14px;">
                📧 This is an automated notification from your contact management system
              </p>
            </div>
          </div>
        </div>
      `;

      // Send notification to admin
      await enhancedEmailService.sendEmail({
        to: process.env.ADMIN_NOTIFICATION_EMAIL || process.env.ADMIN_EMAIL || 'admin@yourstore.com',
        subject: adminNotificationSubject,
        html: enhancedAdminContent
      });

      // Send confirmation to customer
      await enhancedEmailService.sendEmail({
        to: email,
        subject: 'Thank you for contacting us - We\'ve received your message',
        html: customerEmailContent
      });

      console.log(`✅ Enhanced contact form emails sent for submission ${contact._id}`);
    } catch (emailError) {
      console.error('❌ Error sending contact form emails:', emailError);
      // Don't fail the request if email sending fails
    }

    // Return success response
    res.status(201).json({
      success: true,
      message: 'Your message has been sent successfully! We\'ll get back to you soon.',
      contactId: contact._id
    });

  } catch (error) {
    console.error('❌ Contact form submission error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message. Please try again later.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/contact/stats
// @desc    Get contact form statistics (admin only)
// @access  Private/Admin
router.get('/stats', require('../middleware/adminAuth').adminAuth, async (req, res) => {
  try {
    const stats = await Contact.aggregate([
      {
        $group: {
          _id: '$subject',
          count: { $sum: 1 },
          latest: { $max: '$timestamp' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    const totalContacts = await Contact.countDocuments();
    const todayContacts = await Contact.countDocuments({
      timestamp: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0))
      }
    });

    res.json({
      success: true,
      data: {
        total: totalContacts,
        today: todayContacts,
        bySubject: stats
      }
    });
  } catch (error) {
    console.error('❌ Contact stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contact statistics'
    });
  }
});

module.exports = router;