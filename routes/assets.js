const express = require('express');
const router = express.Router();
const {
  upload,
  getAssets,
  uploadAssets,
  deleteAsset,
  updateAsset,
  getFolders,
  bulkDeleteAssets,
  getAssetAnalytics
} = require('../controllers/enhancedAssetController');
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');

// All asset routes require authentication and admin access
router.use(auth);
router.use(adminAuth);

// Asset routes
router.get('/', getAssets);
router.post('/upload', upload.array('files', 10), uploadAssets); // Support multiple files
router.get('/folders', getFolders);
router.get('/analytics', getAssetAnalytics);
router.put('/:id', updateAsset);
router.delete('/:id', deleteAsset);
router.post('/bulk-delete', bulkDeleteAssets);

module.exports = router;