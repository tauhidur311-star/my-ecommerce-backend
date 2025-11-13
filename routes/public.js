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
// IMPORTANT: Specific routes must come BEFORE parameterized routes

// SSE endpoint for theme updates (public access)
router.get('/theme/updates', themeUpdatesSSE);

// Published theme routes (parameterized - must come after specific routes)
router.get('/theme/:pageType', getPublishedTheme);
router.get('/theme/custom/:slug', getPublishedTheme);
router.get('/pages', getPublishedPages);

// Test endpoint to verify route is working
router.get('/test-sse', (req, res) => {
  console.log('🧪 Test SSE endpoint accessed');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  
  res.write(`event: test\n`);
  res.write(`data: {"message": "SSE test working", "timestamp": "${new Date().toISOString()}"}\n\n`);
  
  // Send a test message every 5 seconds
  const interval = setInterval(() => {
    try {
      res.write(`event: test\n`);
      res.write(`data: {"message": "Test ping", "timestamp": "${new Date().toISOString()}"}\n\n`);
    } catch (error) {
      clearInterval(interval);
    }
  }, 5000);
  
  req.on('close', () => {
    clearInterval(interval);
    console.log('🧪 Test SSE connection closed');
  });
});

// Preview routes (admin authentication required)
router.get('/theme/preview/:pageType', auth, adminAuth, getPreviewTheme);
router.get('/theme/preview/custom/:slug', auth, adminAuth, getPreviewTheme);

module.exports = router;