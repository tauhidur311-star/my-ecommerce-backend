const Asset = require('../models/Asset');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads/assets');
    try {
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + extension);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/png', 
    'image/webp',
    'image/gif',
    'video/mp4',
    'application/pdf'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('File type not supported'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Get all assets
const getAssets = async (req, res) => {
  try {
    const { page = 1, limit = 20, folder, type, search } = req.query;
    
    const query = {};
    
    if (folder && folder !== 'all') {
      query.folder = folder;
    }
    
    if (type && type !== 'all') {
      query.type = { $regex: type, $options: 'i' };
    }
    
    if (search) {
      query.$text = { $search: search };
    }
    
    const assets = await Asset.find(query)
      .populate('uploadedBy', 'name email')
      .sort({ uploadedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await Asset.countDocuments(query);
    
    res.status(200).json({
      success: true,
      data: assets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
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

// Upload new asset
const uploadAsset = async (req, res) => {
  try {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: 'File upload error',
          error: err.message
        });
      }
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No file provided'
        });
      }
      
      const { folder = 'general', alt = '', tags = '' } = req.body;
      
      // Generate URL (adjust based on your setup)
      const fileUrl = `${req.protocol}://${req.get('host')}/uploads/assets/${req.file.filename}`;
      
      // Get image dimensions if it's an image
      let width = null;
      let height = null;
      
      if (req.file.mimetype.startsWith('image/')) {
        try {
          const sharp = require('sharp');
          const metadata = await sharp(req.file.path).metadata();
          width = metadata.width;
          height = metadata.height;
        } catch (sharpError) {
          // Sharp not available, skip dimensions
          console.log('Sharp not available for image processing');
        }
      }
      
      const asset = new Asset({
        name: req.file.filename,
        originalName: req.file.originalname,
        url: fileUrl,
        size: req.file.size,
        type: req.file.mimetype,
        width,
        height,
        alt,
        tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
        folder,
        uploadedBy: req.user.id
      });
      
      await asset.save();
      
      res.status(201).json({
        success: true,
        data: asset
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error uploading asset',
      error: error.message
    });
  }
};

// Delete asset
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
    
    // Delete file from filesystem
    try {
      const filePath = path.join(__dirname, '../uploads/assets', asset.name);
      await fs.unlink(filePath);
    } catch (fileError) {
      console.log('File already deleted or not found:', fileError.message);
    }
    
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

// Get asset by ID
const getAssetById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const asset = await Asset.findById(id)
      .populate('uploadedBy', 'name email');
    
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: asset
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching asset',
      error: error.message
    });
  }
};

// Update asset metadata
const updateAsset = async (req, res) => {
  try {
    const { id } = req.params;
    const { alt, tags, folder } = req.body;
    
    const asset = await Asset.findById(id);
    
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }
    
    if (alt !== undefined) asset.alt = alt;
    if (folder !== undefined) asset.folder = folder;
    if (tags !== undefined) {
      asset.tags = Array.isArray(tags) ? tags : tags.split(',').map(tag => tag.trim());
    }
    
    await asset.save();
    
    res.status(200).json({
      success: true,
      data: asset
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error updating asset',
      error: error.message
    });
  }
};

// Get folders (distinct values)
const getFolders = async (req, res) => {
  try {
    const folders = await Asset.distinct('folder');
    
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

module.exports = {
  getAssets,
  uploadAsset,
  deleteAsset,
  getAssetById,
  updateAsset,
  getFolders,
  upload
};