const express = require('express');
const router = express.Router();
const { adminAuth } = require('../middleware/adminAuth');
const {
  sseHandler,
  getSummary,
  getCharts,
  getTopPages,
  getReferrers,
  getDevices,
  getGeo,
  getRecentSubmissions
} = require('../controllers/analyticsController');

// All routes require admin authentication
router.use(adminAuth);

// SSE stream for real-time updates
router.get('/stream', sseHandler);

// Analytics summary
router.get('/summary', getSummary);

// Charts data
router.get('/charts', getCharts);

// Top pages
router.get('/top-pages', getTopPages);

// Top referrers
router.get('/referrers', getReferrers);

// Device breakdown
router.get('/devices', getDevices);

// Geographic data
router.get('/geo', getGeo);

// Recent contact submissions
router.get('/recent-submissions', getRecentSubmissions);

module.exports = router;