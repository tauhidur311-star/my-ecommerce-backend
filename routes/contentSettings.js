const express = require('express');
const router = express.Router();
const {
  getSectionSettings,
  updateSectionSettings,
  getAllSettings,
  getPublicSettings,
  resetSectionSettings,
  searchProducts
} = require('../controllers/contentSettingsController');
const { adminAuth } = require('../middleware/adminAuth');
const { validate } = require('../utils/validation');
const { body, param } = require('express-validator');

// Validation rules
const sectionTypeValidation = [
  param('sectionType')
    .isIn(['featuredProduct', 'imageGallery', 'hero', 'testimonials', 'newsletter'])
    .withMessage('Invalid section type')
];

const updateSettingsValidation = [
  body('settings')
    .optional()
    .isObject()
    .withMessage('Settings must be an object'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),
  body('order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Order must be a non-negative integer')
];

// Public routes (no authentication required)
router.get('/public', getPublicSettings);

// Admin routes (require authentication)
router.use(adminAuth);

// Get all content settings
router.get('/', getAllSettings);

// Search products for featured product selection
router.get('/search-products', searchProducts);

// Get specific section settings
router.get('/:sectionType', sectionTypeValidation, validate, getSectionSettings);

// Update specific section settings
router.put('/:sectionType', 
  sectionTypeValidation, 
  updateSettingsValidation, 
  validate, 
  updateSectionSettings
);

// Reset section settings to defaults
router.post('/:sectionType/reset', sectionTypeValidation, validate, resetSectionSettings);

module.exports = router;