const express = require('express');
const router = express.Router();
const {
  getAssets,
  uploadAsset,
  deleteAsset,
  getAssetById,
  updateAsset,
  getFolders
} = require('../controllers/assetController');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// All asset routes require authentication and admin access
router.use(auth);
router.use(adminAuth);

// Asset routes
router.get('/', getAssets);
router.post('/upload', uploadAsset);
router.get('/folders', getFolders);
router.get('/:id', getAssetById);
router.put('/:id', updateAsset);
router.delete('/:id', deleteAsset);

module.exports = router;