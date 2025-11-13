const express = require('express');
const router = express.Router();
const {
  getPublishedTheme,
  getPublishedPages,
  getPreviewTheme,
  themeUpdatesSSE
} = require('../controllers/publicController');
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');

// Public routes (no authentication required)
router.get('/theme/:pageType', getPublishedTheme);
router.get('/theme/custom/:slug', getPublishedTheme);
router.get('/pages', getPublishedPages);

// SSE endpoint for theme updates (public access)
router.get('/theme/updates', themeUpdatesSSE);

// Preview routes (admin authentication required)
router.get('/theme/preview/:pageType', auth, adminAuth, getPreviewTheme);
router.get('/theme/preview/custom/:slug', auth, adminAuth, getPreviewTheme);

module.exports = router;