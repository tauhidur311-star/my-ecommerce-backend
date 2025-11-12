const express = require('express');
const router = express.Router();
const {
  getPublishedTheme,
  getPublishedPages
} = require('../controllers/publicController');

// Public routes (no authentication required)
router.get('/theme/:pageType', getPublishedTheme);
router.get('/theme/custom/:slug', getPublishedTheme);
router.get('/pages', getPublishedPages);

module.exports = router;