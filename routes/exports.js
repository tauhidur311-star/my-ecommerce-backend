/**
 * Export Routes
 * API routes for design exports in various formats
 */

const express = require('express');
const {
  exportJSON,
  exportHTML,
  exportPDF,
  downloadExport,
  getExportStatus,
  getExportHistory,
  deleteExport
} = require('../controllers/exportController');

const { protect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const rateLimit = require('../middleware/rateLimit');

const router = express.Router();

// All routes require authentication
router.use(protect);

// Export routes with rate limiting
router.post('/json',
  rateLimit({ 
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 exports per 15 minutes
    message: 'Too many export requests, please try again later'
  }),
  validateRequest({
    body: {
      designId: {
        type: 'string',
        required: true,
        pattern: '^[0-9a-fA-F]{24}$' // MongoDB ObjectId pattern
      },
      options: {
        type: 'object',
        properties: {
          includeAssets: { type: 'boolean' },
          compression: { type: 'boolean' },
          version: { type: 'string' },
          metadata: {
            type: 'object',
            properties: {
              title: { type: 'string', maxLength: 100 },
              description: { type: 'string', maxLength: 500 },
              author: { type: 'string', maxLength: 100 }
            }
          }
        }
      }
    }
  }),
  exportJSON
);

router.post('/html',
  rateLimit({ 
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 HTML exports per 15 minutes (more resource intensive)
    message: 'Too many export requests, please try again later'
  }),
  validateRequest({
    body: {
      designId: {
        type: 'string',
        required: true,
        pattern: '^[0-9a-fA-F]{24}$'
      },
      options: {
        type: 'object',
        properties: {
          includeAssets: { type: 'boolean' },
          compression: { type: 'boolean' },
          version: { type: 'string' },
          metadata: {
            type: 'object',
            properties: {
              title: { type: 'string', maxLength: 100 },
              description: { type: 'string', maxLength: 500 },
              author: { type: 'string', maxLength: 100 }
            }
          }
        }
      }
    }
  }),
  exportHTML
);

router.post('/pdf',
  rateLimit({ 
    windowMs: 30 * 60 * 1000, // 30 minutes
    max: 3, // 3 PDF exports per 30 minutes (most resource intensive)
    message: 'Too many PDF export requests, please try again later'
  }),
  validateRequest({
    body: {
      designId: {
        type: 'string',
        required: true,
        pattern: '^[0-9a-fA-F]{24}$'
      },
      options: {
        type: 'object',
        properties: {
          includeAssets: { type: 'boolean' },
          compression: { type: 'boolean' },
          version: { type: 'string' },
          width: { type: 'number', min: 400, max: 2000 },
          height: { type: 'number', min: 400, max: 3000 },
          format: { 
            type: 'string',
            enum: ['A4', 'A3', 'A5', 'Letter', 'Legal', 'Tabloid']
          },
          margin: {
            type: 'object',
            properties: {
              top: { type: 'string' },
              bottom: { type: 'string' },
              left: { type: 'string' },
              right: { type: 'string' }
            }
          },
          metadata: {
            type: 'object',
            properties: {
              title: { type: 'string', maxLength: 100 },
              description: { type: 'string', maxLength: 500 },
              author: { type: 'string', maxLength: 100 }
            }
          }
        }
      }
    }
  }),
  exportPDF
);

// Export management routes
router.get('/history',
  validateRequest({
    query: {
      format: {
        type: 'string',
        enum: ['json', 'html', 'pdf'],
        required: false
      },
      status: {
        type: 'string',
        enum: ['pending', 'processing', 'completed', 'failed'],
        required: false
      },
      page: {
        type: 'string',
        pattern: '^[1-9]\\d*$', // Positive integer
        required: false
      },
      limit: {
        type: 'string',
        pattern: '^([1-9]|[1-4][0-9]|50)$', // 1-50
        required: false
      }
    }
  }),
  getExportHistory
);

router.get('/:exportId/status',
  validateRequest({
    params: {
      exportId: {
        type: 'string',
        pattern: '^[0-9a-fA-F]{24}$',
        required: true
      }
    }
  }),
  getExportStatus
);

router.get('/download/:exportId',
  validateRequest({
    params: {
      exportId: {
        type: 'string',
        pattern: '^[0-9a-fA-F]{24}$',
        required: true
      }
    }
  }),
  downloadExport
);

router.delete('/:exportId',
  validateRequest({
    params: {
      exportId: {
        type: 'string',
        pattern: '^[0-9a-fA-F]{24}$',
        required: true
      }
    }
  }),
  deleteExport
);

module.exports = router;