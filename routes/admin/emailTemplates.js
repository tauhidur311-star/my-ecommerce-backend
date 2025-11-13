const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { adminAuth } = require('../../middleware/adminAuth');

// Email Template Schema
const emailTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Template name is required'],
    trim: true,
    maxlength: [100, 'Template name cannot exceed 100 characters']
  },
  subject: {
    type: String,
    required: [true, 'Email subject is required'],
    trim: true,
    maxlength: [200, 'Subject cannot exceed 200 characters']
  },
  htmlContent: {
    type: String,
    required: [true, 'Email content is required'],
    maxlength: [10000, 'Content cannot exceed 10000 characters']
  },
  variables: [{
    name: String,
    description: String,
    required: { type: Boolean, default: false }
  }],
  category: {
    type: String,
    enum: ['response', 'notification', 'marketing', 'system'],
    default: 'response'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

const EmailTemplate = mongoose.model('EmailTemplate', emailTemplateSchema);

// Enhanced email service
let enhancedEmailService;
try {
  enhancedEmailService = require('../../utils/mailjetEmailService');
} catch (error) {
  enhancedEmailService = require('../../utils/emailService');
}

// @route   GET /api/admin/email-templates
// @desc    Get all email templates
// @access  Private/Admin
router.get('/', adminAuth, async (req, res) => {
  try {
    const { category, search, page = 1, limit = 20 } = req.query;
    
    const filter = { isActive: true };
    
    if (category) {
      filter.category = category;
    }
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } }
      ];
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [templates, total] = await Promise.all([
      EmailTemplate.find(filter)
        .populate('createdBy', 'name email')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      EmailTemplate.countDocuments(filter)
    ]);
    
    res.json({
      success: true,
      data: templates,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('❌ Get email templates error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch email templates'
    });
  }
});

// @route   POST /api/admin/email-templates
// @desc    Create new email template
// @access  Private/Admin
router.post('/', adminAuth, async (req, res) => {
  try {
    const { name, subject, htmlContent, variables, category } = req.body;
    
    // Validation
    if (!name || !subject || !htmlContent) {
      return res.status(400).json({
        success: false,
        error: 'Name, subject, and content are required'
      });
    }
    
    // Check for duplicate template name
    const existingTemplate = await EmailTemplate.findOne({ 
      name: name.trim(),
      isActive: true 
    });
    
    if (existingTemplate) {
      return res.status(400).json({
        success: false,
        error: 'Template with this name already exists'
      });
    }
    
    const template = new EmailTemplate({
      name: name.trim(),
      subject: subject.trim(),
      htmlContent,
      variables: variables || [],
      category: category || 'response',
      createdBy: req.user._id
    });
    
    await template.save();
    
    const populatedTemplate = await EmailTemplate.findById(template._id)
      .populate('createdBy', 'name email');
    
    res.status(201).json({
      success: true,
      message: 'Email template created successfully',
      data: populatedTemplate
    });
  } catch (error) {
    console.error('❌ Create email template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create email template'
    });
  }
});

// @route   PUT /api/admin/email-templates/:id
// @desc    Update email template
// @access  Private/Admin
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const { name, subject, htmlContent, variables, category } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid template ID'
      });
    }
    
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (subject) updateData.subject = subject.trim();
    if (htmlContent) updateData.htmlContent = htmlContent;
    if (variables) updateData.variables = variables;
    if (category) updateData.category = category;
    
    const template = await EmailTemplate.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');
    
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Email template not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Email template updated successfully',
      data: template
    });
  } catch (error) {
    console.error('❌ Update email template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update email template'
    });
  }
});

// @route   DELETE /api/admin/email-templates/:id
// @desc    Delete email template (soft delete)
// @access  Private/Admin
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid template ID'
      });
    }
    
    const template = await EmailTemplate.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Email template not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Email template deleted successfully'
    });
  } catch (error) {
    console.error('❌ Delete email template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete email template'
    });
  }
});

// @route   POST /api/admin/email-templates/:id/send
// @desc    Send email using template
// @access  Private/Admin
router.post('/:id/send', adminAuth, async (req, res) => {
  try {
    const { recipientEmail, recipientName, variables } = req.body;
    
    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        error: 'Recipient email is required'
      });
    }
    
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Email template not found'
      });
    }
    
    // Replace variables in template
    let subject = template.subject;
    let htmlContent = template.htmlContent;
    
    if (variables) {
      Object.keys(variables).forEach(key => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        subject = subject.replace(regex, variables[key]);
        htmlContent = htmlContent.replace(regex, variables[key]);
      });
    }
    
    // Send email
    await enhancedEmailService.sendEmail({
      to: recipientEmail,
      subject,
      html: htmlContent,
      fromName: 'Admin Support'
    });
    
    res.json({
      success: true,
      message: 'Email sent successfully'
    });
  } catch (error) {
    console.error('❌ Send template email error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send email'
    });
  }
});

// @route   GET /api/admin/email-templates/categories
// @desc    Get template categories
// @access  Private/Admin
router.get('/categories', adminAuth, async (req, res) => {
  try {
    const categories = [
      { value: 'response', label: 'Customer Response', description: 'Templates for responding to customer inquiries' },
      { value: 'notification', label: 'Notifications', description: 'System notifications and alerts' },
      { value: 'marketing', label: 'Marketing', description: 'Promotional and marketing emails' },
      { value: 'system', label: 'System', description: 'Automated system emails' }
    ];
    
    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories'
    });
  }
});

module.exports = router;