const express = require('express');
const router = express.Router();
const {
  getReusableBlocks,
  createReusableBlock,
  getReusableBlockById,
  updateReusableBlock,
  deleteReusableBlock,
  incrementUsage,
  getCategories,
  getPopularTags,
  createBlockFromSection
} = require('../controllers/reusableBlockController');
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');

// All routes require authentication
router.use(auth);

// Public routes (any authenticated user)
router.get('/', getReusableBlocks);
router.get('/categories', getCategories);
router.get('/tags', getPopularTags);
router.get('/:id', getReusableBlockById);
router.post('/:id/use', incrementUsage);

// Admin-only routes
router.use(adminAuth);
router.post('/', createReusableBlock);
router.post('/from-section', createBlockFromSection);
router.put('/:id', updateReusableBlock);
router.delete('/:id', deleteReusableBlock);

module.exports = router;

module.exports = router;