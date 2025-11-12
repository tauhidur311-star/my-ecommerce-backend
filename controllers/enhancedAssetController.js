const Asset = require('../models/Asset');
const imageOptimizer = require('../utils/imageOptimizer');
const storageProvider = require('../utils/storageProvider');
const multer = require('multer');

// Configure multer for memory storage (we'll handle file storage manually)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 10 // Max 10 files at once
  },
  fileFilter: (req, file, cb) => {
    // Accept images, videos, and PDFs
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/avi',
      'application/pdf'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
    }
  }
});

// Get assets with advanced filtering and search
const getAssets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      folder,
      type,
      search,
      sortBy = 'uploadedAt',
      sortOrder = 'desc',
      tags
    } = req.query;

    // Build query
    const query = {};
    
    if (folder && folder !== 'all') {
      query.folder = folder;
    }
    
    if (type) {
      if (type === 'images') {
        query.type = { $regex: '^image/', $options: 'i' };
      } else if (type === 'videos') {
        query.type = { $regex: '^video/', $options: 'i' };
      } else {
        query.type = type;
      }
    }
    
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim());
      query.tags = { $in: tagArray };
    }
    
    if (search) {
      query.$text = { $search: search };
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query
    const [assets, total] = await Promise.all([
      Asset.find(query)
        .populate('uploadedBy', 'name email')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Asset.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: assets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching assets',
      error: error.message
    });
  }
};

// Enhanced upload with optimization and multiple file support
const uploadAssets = async (req, res) => {
  try {
    const { folder = 'general', tags = '', generateWebP = true } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided'
      });
    }

    const results = [];
    const errors = [];

    for (const file of files) {
      try {
        let assetData = {
          name: file.originalname,
          originalName: file.originalname,
          type: file.mimetype,
          size: file.size,
          folder: folder,
          tags: tags ? tags.split(',').map(t => t.trim()) : [],
          uploadedBy: req.user.id,
          versions: {}
        };

        if (imageOptimizer.isImageFile(file.originalname)) {
          // Process image with optimization
          const optimized = await imageOptimizer.optimizeImage(file.buffer, file.originalname, {
            generateWebP: generateWebP
          });

          // Upload all versions
          const uploadResults = await storageProvider.uploadMultipleVersions(
            {
              original: optimized.original,
              thumbnail: optimized.thumbnail,
              small: optimized.small
            },
            file.originalname,
            folder,
            'image/webp'
          );

          assetData.url = uploadResults.original.url;
          assetData.versions = uploadResults;
          assetData.width = optimized.metadata.width;
          assetData.height = optimized.metadata.height;
          assetData.optimized = true;

        } else {
          // Upload non-image files as-is
          const filename = storageProvider.generateFilename(file.originalname, folder);
          const uploadResult = await storageProvider.uploadFile(file.buffer, filename, file.mimetype);
          
          assetData.url = uploadResult.url;
          assetData.storageInfo = uploadResult;
        }

        // Save to database
        const asset = new Asset(assetData);
        await asset.save();

        results.push({
          success: true,
          asset: asset
        });

      } catch (error) {
        errors.push({
          filename: file.originalname,
          error: error.message
        });
      }
    }

    res.status(201).json({
      success: true,
      data: {
        uploaded: results,
        errors: errors,
        summary: {
          total: files.length,
          successful: results.length,
          failed: errors.length
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Upload failed',
      error: error.message
    });
  }
};

// Get folders with asset counts
const getFolders = async (req, res) => {
  try {
    const folders = await Asset.aggregate([
      {
        $group: {
          _id: '$folder',
          count: { $sum: 1 },
          totalSize: { $sum: '$size' },
          lastUpdated: { $max: '$uploadedAt' }
        }
      },
      {
        $project: {
          name: '$_id',
          count: 1,
          totalSize: 1,
          lastUpdated: 1,
          _id: 0
        }
      },
      { $sort: { name: 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: folders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching folders',
      error: error.message
    });
  }
};

// Update asset (name, alt text, tags, folder)
const updateAsset = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, alt, tags, folder } = req.body;

    const asset = await Asset.findById(id);
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Update fields
    if (name) asset.name = name;
    if (alt !== undefined) asset.alt = alt;
    if (tags !== undefined) {
      asset.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
    }
    if (folder) asset.folder = folder;

    await asset.save();

    res.status(200).json({
      success: true,
      data: asset
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating asset',
      error: error.message
    });
  }
};

// Delete asset and associated files
const deleteAsset = async (req, res) => {
  try {
    const { id } = req.params;

    const asset = await Asset.findById(id);
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }

    // Delete files from storage
    if (asset.versions && Object.keys(asset.versions).length > 0) {
      // Delete all versions
      for (const version of Object.values(asset.versions)) {
        await storageProvider.deleteFile(version);
      }
    } else if (asset.storageInfo) {
      // Delete single file
      await storageProvider.deleteFile(asset.storageInfo);
    }

    // Delete from database
    await Asset.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Asset deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting asset',
      error: error.message
    });
  }
};

// Bulk operations
const bulkDeleteAssets = async (req, res) => {
  try {
    const { assetIds } = req.body;

    if (!assetIds || !Array.isArray(assetIds)) {
      return res.status(400).json({
        success: false,
        message: 'Asset IDs array is required'
      });
    }

    const assets = await Asset.find({ _id: { $in: assetIds } });
    const results = [];

    for (const asset of assets) {
      try {
        // Delete files from storage
        if (asset.versions && Object.keys(asset.versions).length > 0) {
          for (const version of Object.values(asset.versions)) {
            await storageProvider.deleteFile(version);
          }
        } else if (asset.storageInfo) {
          await storageProvider.deleteFile(asset.storageInfo);
        }

        await Asset.findByIdAndDelete(asset._id);
        
        results.push({
          id: asset._id,
          success: true
        });
      } catch (error) {
        results.push({
          id: asset._id,
          success: false,
          error: error.message
        });
      }
    }

    res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Bulk delete failed',
      error: error.message
    });
  }
};

// Get asset usage analytics
const getAssetAnalytics = async (req, res) => {
  try {
    const [
      totalAssets,
      totalSize,
      byType,
      byFolder,
      recentUploads,
      topUsed
    ] = await Promise.all([
      Asset.countDocuments(),
      Asset.aggregate([
        { $group: { _id: null, total: { $sum: '$size' } } }
      ]),
      Asset.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 }, size: { $sum: '$size' } } },
        { $sort: { count: -1 } }
      ]),
      Asset.aggregate([
        { $group: { _id: '$folder', count: { $sum: 1 }, size: { $sum: '$size' } } },
        { $sort: { count: -1 } }
      ]),
      Asset.find().sort({ uploadedAt: -1 }).limit(10).populate('uploadedBy', 'name'),
      Asset.find().sort({ usageCount: -1 }).limit(10)
    ]);

    res.status(200).json({
      success: true,
      data: {
        totalAssets,
        totalSize: totalSize[0]?.total || 0,
        byType,
        byFolder,
        recentUploads,
        topUsed
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching analytics',
      error: error.message
    });
  }
};

module.exports = {
  upload,
  getAssets,
  uploadAssets,
  getFolders,
  updateAsset,
  deleteAsset,
  bulkDeleteAssets,
  getAssetAnalytics
};