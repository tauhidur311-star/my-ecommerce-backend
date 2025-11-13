const express = require('express');
const router = express.Router();
const Design = require('../models/Design');
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const { body, param, validationResult } = require('express-validator');

// Apply security middleware
router.use(helmet());
router.use(compression());

// Rate limiting for design operations
const designRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: 'Too many design requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const saveRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // Limit saves to prevent spam
  message: {
    success: false,
    error: 'Too many save requests, please wait before saving again.'
  }
});

router.use(designRateLimit);

// Validation middleware
const validateStoreId = [
  param('storeId')
    .isLength({ min: 1, max: 100 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Store ID must contain only alphanumeric characters, hyphens, and underscores')
];

const validateDesignData = [
  body('layout')
    .optional()
    .isArray()
    .withMessage('Layout must be an array'),
  body('layout.*.id')
    .optional()
    .isString()
    .isLength({ min: 1, max: 50 })
    .withMessage('Section ID must be a string'),
  body('layout.*.type')
    .optional()
    .isIn(['hero', 'features', 'gallery', 'testimonials', 'contact', 'newsletter', 'custom'])
    .withMessage('Invalid section type'),
  body('globalSettings')
    .optional()
    .isObject()
    .withMessage('Global settings must be an object'),
  body('globalSettings.layout.maxWidth')
    .optional()
    .matches(/^\d+(px|%|rem|em)$|^(100%|auto)$/)
    .withMessage('Invalid max width format'),
  body('globalSettings.colors.primary')
    .optional()
    .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
    .withMessage('Invalid hex color format for primary color')
];

// GET /api/design/:storeId - Get design for a store
router.get('/:storeId', validateStoreId, async (req, res) => {
  try {
    const { storeId } = req.params;
    const { version, status = 'published' } = req.query;

    let query = { storeId };
    
    // If user is authenticated and admin, they can access drafts
    if (req.user && req.user.role === 'admin') {
      if (status) query.status = status;
    } else {
      query.status = 'published';
    }

    let design;
    if (version) {
      design = await Design.findOne({ ...query, version: parseInt(version) });
    } else {
      design = await Design.findOne(query).sort({ updatedAt: -1 });
    }

    if (!design) {
      // Return empty design structure for new stores
      return res.json({
        success: true,
        data: {
          storeId,
          layout: [],
          globalSettings: {
            layout: {
              maxWidth: '1200px',
              padding: '20px',
              backgroundColor: '#ffffff'
            },
            typography: {
              fontFamily: 'Inter, sans-serif',
              fontSize: {
                base: '16px',
                h1: '2.5rem',
                h2: '2rem',
                h3: '1.5rem'
              },
              lineHeight: 1.6
            },
            colors: {
              primary: '#3B82F6',
              secondary: '#10B981',
              accent: '#F59E0B',
              text: '#1F2937',
              background: '#FFFFFF'
            }
          },
          status: 'draft',
          version: 1
        }
      });
    }

    // Increment preview count for analytics
    if (req.query.preview === 'true') {
      design.metadata.previewCount = (design.metadata.previewCount || 0) + 1;
      await design.save();
    }

    res.json({
      success: true,
      data: {
        storeId: design.storeId,
        layout: design.layout || [],
        globalSettings: design.globalSettings,
        status: design.status,
        version: design.version,
        publishedAt: design.publishedAt,
        updatedAt: design.updatedAt,
        metadata: design.metadata
      }
    });

  } catch (error) {
    console.error('Error fetching design:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch design'
    });
  }
});

// POST /api/design/:storeId - Save/update design
router.post('/:storeId', 
  saveRateLimit,
  validateStoreId, 
  validateDesignData, 
  async (req, res) => {
    try {
      // Check validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { storeId } = req.params;
      const { layout = [], globalSettings, status = 'draft', name, description } = req.body;

      // Validate section content
      const contentValidationErrors = [];
      for (const section of layout) {
        if (section.type && section.content) {
          const validation = Design.validateSectionContent(section.type, section.content);
          if (!validation.valid) {
            contentValidationErrors.push(`Section ${section.id}: ${validation.errors.join(', ')}`);
          }
        }
      }

      if (contentValidationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          error: 'Section validation failed',
          details: contentValidationErrors
        });
      }

      // Sanitize and clean data
      const sanitizedLayout = layout.map(section => ({
        id: section.id,
        type: section.type,
        content: sanitizeObject(section.content || {}),
        settings: sanitizeObject(section.settings || {}),
        order: section.order || 0
      }));

      const sanitizedGlobalSettings = sanitizeObject(globalSettings || {});

      // Find existing design or create new one
      let design = await Design.findOne({ storeId });

      if (design) {
        // Update existing design
        design.layout = sanitizedLayout;
        design.globalSettings = { ...design.globalSettings, ...sanitizedGlobalSettings };
        design.status = status;
        if (name) design.name = name;
        if (description) design.description = description;
        
        // Increment version if publishing
        if (status === 'published' && design.status !== 'published') {
          design.version += 1;
        }
      } else {
        // Create new design
        design = new Design({
          storeId,
          userId: req.user?.id,
          layout: sanitizedLayout,
          globalSettings: sanitizedGlobalSettings,
          status,
          name: name || 'Untitled Design',
          description: description || ''
        });
      }

      // Update metadata
      if (!design.metadata) design.metadata = {};
      design.metadata.lastEditedSection = req.body.lastEditedSection;
      design.metadata.saveCount = (design.metadata.saveCount || 0) + 1;

      await design.save();

      res.json({
        success: true,
        data: {
          storeId: design.storeId,
          layout: design.layout,
          globalSettings: design.globalSettings,
          status: design.status,
          version: design.version,
          updatedAt: design.updatedAt,
          metadata: design.metadata
        },
        message: 'Design saved successfully'
      });

    } catch (error) {
      console.error('Error saving design:', error);
      
      // Handle specific MongoDB errors
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          error: 'Invalid data provided',
          details: Object.values(error.errors).map(err => err.message)
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to save design'
      });
    }
});

// PUT /api/design/:storeId/publish - Publish design
router.put('/:storeId/publish', 
  adminAuth,
  validateStoreId, 
  async (req, res) => {
    try {
      const { storeId } = req.params;

      const design = await Design.findOne({ storeId });
      if (!design) {
        return res.status(404).json({
          success: false,
          error: 'Design not found'
        });
      }

      await design.publish();

      res.json({
        success: true,
        data: {
          storeId: design.storeId,
          status: design.status,
          publishedAt: design.publishedAt,
          version: design.version
        },
        message: 'Design published successfully'
      });

    } catch (error) {
      console.error('Error publishing design:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to publish design'
      });
    }
});

// DELETE /api/design/:storeId - Delete design
router.delete('/:storeId', 
  adminAuth,
  validateStoreId,
  async (req, res) => {
    try {
      const { storeId } = req.params;

      const design = await Design.findOneAndDelete({ storeId });
      if (!design) {
        return res.status(404).json({
          success: false,
          error: 'Design not found'
        });
      }

      res.json({
        success: true,
        message: 'Design deleted successfully'
      });

    } catch (error) {
      console.error('Error deleting design:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete design'
      });
    }
});

// GET /api/design/:storeId/versions - Get design version history
router.get('/:storeId/versions', 
  adminAuth,
  validateStoreId,
  async (req, res) => {
    try {
      const { storeId } = req.params;

      const designs = await Design.find({ storeId })
        .sort({ version: -1 })
        .select('version status publishedAt updatedAt metadata.totalSections metadata.saveCount')
        .limit(20);

      res.json({
        success: true,
        data: designs
      });

    } catch (error) {
      console.error('Error fetching design versions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch design versions'
      });
    }
});

// POST /api/design/:storeId/duplicate - Duplicate design
router.post('/:storeId/duplicate', 
  adminAuth,
  validateStoreId,
  [body('newStoreId').isString().isLength({ min: 1, max: 100 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { storeId } = req.params;
      const { newStoreId, name } = req.body;

      const design = await Design.findOne({ storeId });
      if (!design) {
        return res.status(404).json({
          success: false,
          error: 'Design not found'
        });
      }

      // Check if target store ID already exists
      const existingDesign = await Design.findOne({ storeId: newStoreId });
      if (existingDesign) {
        return res.status(400).json({
          success: false,
          error: 'Target store ID already exists'
        });
      }

      const duplicatedDesign = await design.duplicate(name);
      duplicatedDesign.storeId = newStoreId;
      await duplicatedDesign.save();

      res.json({
        success: true,
        data: {
          storeId: duplicatedDesign.storeId,
          layout: duplicatedDesign.layout,
          globalSettings: duplicatedDesign.globalSettings,
          status: duplicatedDesign.status
        },
        message: 'Design duplicated successfully'
      });

    } catch (error) {
      console.error('Error duplicating design:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to duplicate design'
      });
    }
});

// Utility function to sanitize objects and remove potential XSS
function sanitizeObject(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      // Basic XSS protection - remove script tags and javascript: protocols
      sanitized[key] = value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

module.exports = router;