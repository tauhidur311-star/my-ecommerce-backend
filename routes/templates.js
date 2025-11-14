/**
 * Template Routes
 * API routes for template management and marketplace
 */

const express = require('express');
const {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  getFeaturedTemplates,
  getPopularTemplates,
  getTemplatesByCategory,
  cloneTemplate,
  rateTemplate,
  getTemplateAnalytics,
  bulkImportTemplates
} = require('../controllers/templateController');

const { protect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const rateLimit = require('../middleware/rateLimit');

const router = express.Router();

// Public routes
router.get('/', getTemplates);
router.get('/featured', getFeaturedTemplates);
router.get('/popular', getPopularTemplates);
router.get('/category/:category', getTemplatesByCategory);
router.get('/:id', getTemplate);

// Protected routes
router.use(protect); // All routes below require authentication

// Template CRUD operations
router.post('/', 
  authorize('user', 'admin'), 
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), // 10 templates per 15 minutes
  createTemplate
);

router.put('/:id', 
  authorize('user', 'admin'),
  updateTemplate
);

router.delete('/:id', 
  authorize('user', 'admin'),
  deleteTemplate
);

// Template interactions
router.post('/:id/clone', 
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }), // 5 clones per 15 minutes
  cloneTemplate
);

router.post('/:id/rate',
  validateRequest({
    body: {
      rating: {
        type: 'number',
        min: 1,
        max: 5,
        required: true
      }
    }
  }),
  rateTemplate
);

// Admin only routes
router.get('/admin/analytics', 
  authorize('admin'),
  getTemplateAnalytics
);

router.post('/admin/bulk-import',
  authorize('admin'),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 1 }), // 1 bulk import per hour
  bulkImportTemplates
);

module.exports = router;