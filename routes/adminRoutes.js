const express = require('express');
const router = express.Router();

// Import controllers
const templateController = require('../controllers/templateController');
const previewController = require('../controllers/previewController');
const assetController = require('../controllers/enhancedAssetController');
const reusableBlockController = require('../controllers/reusableBlockController');

// Import middleware
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');

// Apply authentication middleware to all admin routes
router.use(auth);
router.use(adminAuth);

// Template Routes
router.get('/templates/:id', templateController.getTemplate);
router.put('/templates/:id/draft', templateController.saveDraft);
router.post('/templates/:id/publish', templateController.publishTemplate);
router.post('/templates', templateController.createTemplate);
router.get('/templates/:id/versions', templateController.getTemplateVersions);
router.post('/templates/:id/rollback/:versionId', templateController.rollbackToVersion);
router.get('/templates/:id/export', templateController.exportTemplate);
router.post('/themes/:themeId/import', templateController.importTemplate);

// Preview Routes (for admin preview)
router.get('/preview/theme/:pageType', previewController.getDraftTheme);
router.get('/preview/theme/custom/:slug', previewController.getDraftTheme);

// Asset Routes
router.post('/assets/upload', assetController.upload.single('file'), assetController.uploadAsset);
router.post('/assets/upload-multiple', assetController.upload.array('files', 10), assetController.uploadMultipleAssets);
router.get('/assets', assetController.getAssets);
router.get('/assets/:id', assetController.getAssetById);
router.delete('/assets/:id', assetController.deleteAsset);
router.get('/assets/folders', assetController.getFolders);

// Reusable Blocks Routes
router.get('/reusables', reusableBlockController.getReusableBlocks);
router.post('/reusables', reusableBlockController.createReusableBlock);
router.put('/reusables/:id', reusableBlockController.updateReusableBlock);
router.delete('/reusables/:id', reusableBlockController.deleteReusableBlock);
router.get('/reusables/:id', reusableBlockController.getReusableBlock);

// Batch operations
router.delete('/assets/batch', async (req, res) => {
  try {
    const { assetIds } = req.body;
    
    if (!assetIds || !Array.isArray(assetIds)) {
      return res.status(400).json({
        success: false,
        message: 'Asset IDs array is required'
      });
    }

    const deletePromises = assetIds.map(id => 
      assetController.deleteAsset({ params: { id } }, { 
        status: () => ({ json: () => {} }),
        json: () => {} 
      })
    );
    
    await Promise.allSettled(deletePromises);
    
    res.json({
      success: true,
      message: `Batch deletion completed for ${assetIds.length} assets`
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error in batch deletion',
      error: error.message
    });
  }
});

// Theme statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const Template = require('../models/Template');
    const Asset = require('../models/Asset');
    const Theme = require('../models/Theme');
    const ReusableBlock = require('../models/ReusableBlock');

    const [
      totalTemplates,
      publishedTemplates,
      draftTemplates,
      totalAssets,
      totalThemes,
      totalReusableBlocks
    ] = await Promise.all([
      Template.countDocuments(),
      Template.countDocuments({ status: 'published' }),
      Template.countDocuments({ status: 'draft' }),
      Asset.countDocuments(),
      Theme.countDocuments(),
      ReusableBlock.countDocuments()
    ]);

    // Get asset size statistics
    const assetStats = await Asset.aggregate([
      {
        $group: {
          _id: null,
          totalSize: { $sum: '$size' },
          totalOriginalSize: { $sum: '$originalSize' },
          averageCompressionRatio: { $avg: { $toDouble: '$metadata.compressionRatio' } }
        }
      }
    ]);

    const totalAssetSize = assetStats[0]?.totalSize || 0;
    const totalOriginalSize = assetStats[0]?.totalOriginalSize || 0;
    const averageCompression = assetStats[0]?.averageCompressionRatio || 0;

    // Format sizes in MB
    const formatSize = (bytes) => (bytes / (1024 * 1024)).toFixed(2);

    res.json({
      success: true,
      data: {
        templates: {
          total: totalTemplates,
          published: publishedTemplates,
          draft: draftTemplates
        },
        assets: {
          total: totalAssets,
          totalSize: `${formatSize(totalAssetSize)} MB`,
          originalSize: `${formatSize(totalOriginalSize)} MB`,
          spaceSaved: `${formatSize(totalOriginalSize - totalAssetSize)} MB`,
          averageCompressionRatio: `${averageCompression.toFixed(1)}%`
        },
        themes: {
          total: totalThemes
        },
        reusableBlocks: {
          total: totalReusableBlocks
        },
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching statistics',
      error: error.message
    });
  }
});

// Recent activity
router.get('/activity/recent', async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const Template = require('../models/Template');
    const Asset = require('../models/Asset');

    const [recentTemplates, recentAssets] = await Promise.all([
      Template.find()
        .sort({ updatedAt: -1 })
        .limit(parseInt(limit) / 2)
        .select('pageType status updatedAt publishedAt')
        .lean(),
      Asset.find()
        .sort({ uploadedAt: -1 })
        .limit(parseInt(limit) / 2)
        .select('name type size uploadedAt')
        .lean()
    ]);

    // Combine and format activities
    const activities = [
      ...recentTemplates.map(template => ({
        type: 'template',
        action: template.status === 'published' ? 'published' : 'updated',
        title: `${template.pageType} template ${template.status === 'published' ? 'published' : 'updated'}`,
        timestamp: template.status === 'published' ? template.publishedAt : template.updatedAt,
        id: template._id
      })),
      ...recentAssets.map(asset => ({
        type: 'asset',
        action: 'uploaded',
        title: `${asset.name} uploaded`,
        subtitle: `${asset.type} - ${(asset.size / 1024).toFixed(1)} KB`,
        timestamp: asset.uploadedAt,
        id: asset._id
      }))
    ]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, parseInt(limit));

    res.json({
      success: true,
      data: activities
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching recent activity',
      error: error.message
    });
  }
});

module.exports = router;