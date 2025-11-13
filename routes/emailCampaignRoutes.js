const express = require('express');
const router = express.Router();
const {
  getCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaign,
  getCampaignAnalytics,
  getCampaignStats
} = require('../controllers/emailCampaignController');
const { adminAuth } = require('../middleware/adminAuth');
const { validate } = require('../utils/validation');
const { body } = require('express-validator');

// Validation rules
const createCampaignValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Campaign name must be between 1 and 100 characters'),
  body('subject')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Subject must be between 1 and 200 characters'),
  body('htmlContent')
    .trim()
    .isLength({ min: 1 })
    .withMessage('Email content is required'),
  body('scheduledAt')
    .optional()
    .isISO8601()
    .withMessage('Invalid scheduled date format'),
  body('recipientList')
    .optional()
    .isArray()
    .withMessage('Recipient list must be an array'),
  body('recipientList.*.email')
    .optional()
    .isEmail()
    .withMessage('Invalid email address in recipient list')
];

const updateCampaignValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Campaign name must be between 1 and 100 characters'),
  body('subject')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Subject must be between 1 and 200 characters'),
  body('htmlContent')
    .optional()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Email content cannot be empty'),
  body('scheduledAt')
    .optional()
    .isISO8601()
    .withMessage('Invalid scheduled date format')
];

// @route   GET /api/admin/email-campaigns/stats
// @desc    Get campaign dashboard stats
// @access  Private/Admin
router.get('/stats', adminAuth, getCampaignStats);

// @route   GET /api/admin/email-campaigns
// @desc    Get all email campaigns
// @access  Private/Admin
router.get('/', adminAuth, getCampaigns);

// @route   POST /api/admin/email-campaigns
// @desc    Create new email campaign
// @access  Private/Admin
router.post('/', adminAuth, createCampaignValidation, validate, createCampaign);

// @route   GET /api/admin/email-campaigns/:id
// @desc    Get single email campaign
// @access  Private/Admin
router.get('/:id', adminAuth, getCampaign);

// @route   PUT /api/admin/email-campaigns/:id
// @desc    Update email campaign
// @access  Private/Admin
router.put('/:id', adminAuth, updateCampaignValidation, validate, updateCampaign);

// @route   DELETE /api/admin/email-campaigns/:id
// @desc    Delete email campaign
// @access  Private/Admin
router.delete('/:id', adminAuth, deleteCampaign);

// @route   POST /api/admin/email-campaigns/:id/send
// @desc    Send campaign immediately
// @access  Private/Admin
router.post('/:id/send', adminAuth, sendCampaign);

// @route   GET /api/admin/email-campaigns/:id/analytics
// @desc    Get campaign analytics
// @access  Private/Admin
router.get('/:id/analytics', adminAuth, getCampaignAnalytics);

module.exports = router;