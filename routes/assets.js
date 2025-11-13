const express = require('express');
const router = express.Router();
const {
  upload,
  getAssets,
  uploadAsset,
  uploadMultipleAssets,
  deleteAsset,
  getAssetById,
  getFolders
} = require('../controllers/enhancedAssetController');
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');

// All asset routes require authentication and admin access
router.use(auth);
router.use(adminAuth);

// Asset routes
router.get('/', getAssets);
router.post('/upload', upload.single('file'), uploadAsset); // Single file upload
router.post('/upload-multiple', upload.array('files', 10), uploadMultipleAssets); // Multiple files
router.get('/folders', getFolders);
router.get('/:id', getAssetById);
router.delete('/:id', deleteAsset);

module.exports = router;