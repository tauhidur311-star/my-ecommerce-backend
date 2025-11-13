const express = require('express');
const router = express.Router();
const {
  getTestimonials,
  getActiveTestimonials,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
  toggleTestimonialStatus,
  reorderTestimonials
} = require('../controllers/testimonialsController');
const { adminAuth } = require('../middleware/adminAuth');
const { validate } = require('../utils/validation');
const { body } = require('express-validator');

// Validation rules
const createTestimonialValidation = [
  body('customerName')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Customer name must be between 1 and 100 characters'),
  body('reviewText')
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage('Review text must be between 1 and 1000 characters'),
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('customerEmail')
    .optional()
    .isEmail()
    .withMessage('Invalid email address'),
  body('avatarUrl')
    .optional()
    .isURL()
    .withMessage('Invalid avatar URL')
];

const updateTestimonialValidation = [
  body('customerName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Customer name must be between 1 and 100 characters'),
  body('reviewText')
    .optional()
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage('Review text must be between 1 and 1000 characters'),
  body('rating')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('customerEmail')
    .optional()
    .isEmail()
    .withMessage('Invalid email address'),
  body('avatarUrl')
    .optional()
    .isURL()
    .withMessage('Invalid avatar URL')
];

// Public routes
router.get('/active', getActiveTestimonials);

// Admin routes
router.use(adminAuth);

router.get('/', getTestimonials);
router.post('/', createTestimonialValidation, validate, createTestimonial);
router.put('/reorder', reorderTestimonials);
router.put('/:id', updateTestimonialValidation, validate, updateTestimonial);
router.patch('/:id/toggle', toggleTestimonialStatus);
router.delete('/:id', deleteTestimonial);

module.exports = router;