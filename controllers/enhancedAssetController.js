const multer = require('multer');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const path = require('path');
const crypto = require('crypto');
const Asset = require('../models/Asset');

// Cloudflare R2 Configuration
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Multer configuration for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow images, videos, and documents
    const allowedTypes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'video/mp4',
      'video/webm',
      'video/ogg',
      'video/mov',
      'video/avi',
      'application/pdf',
      'text/plain',
      'application/json',
      // Enhanced theme editor specific formats
      'text/css',
      'text/javascript',
      'application/javascript',
      'font/woff',
      'font/woff2',
      'application/font-woff',
      'application/font-woff2'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'), false);
    }
  }
});

// Generate unique filename
const generateFileName = (originalName, mimetype) => {
  const ext = path.extname(originalName);
  const hash = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  return `${timestamp}-${hash}${ext}`;
};

// Optimize image using Sharp
const optimizeImage = async (buffer, mimetype) => {
  if (!mimetype.startsWith('image/') || mimetype === 'image/svg+xml') {
    return buffer; // Return original buffer for non-images or SVGs
  }

  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();
    
    let optimized = image;
    
    // Resize if too large
    if (metadata.width > 2048 || metadata.height > 2048) {
      optimized = optimized.resize(2048, 2048, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }
    
    // Convert to appropriate format and optimize
    switch (mimetype) {
      case 'image/jpeg':
      case 'image/jpg':
        return await optimized.jpeg({ quality: 85, progressive: true }).toBuffer();
      case 'image/png':
        return await optimized.png({ compressionLevel: 8 }).toBuffer();
      case 'image/webp':
        return await optimized.webp({ quality: 85 }).toBuffer();
      default:
        return await optimized.jpeg({ quality: 85 }).toBuffer();
    }
  } catch (error) {
    console.warn('Image optimization failed, using original:', error.message);
    return buffer;
  }
};

// Upload single asset
const uploadAsset = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    const { buffer, originalname, mimetype, size } = req.file;
    const { folder = 'assets', alt = '', title = '' } = req.body;
    
    // Optimize image if it's an image type
    const optimizedBuffer = await optimizeImage(buffer, mimetype);
    const finalSize = optimizedBuffer.length;
    
    // Generate unique filename
    const fileName = generateFileName(originalname, mimetype);
    const key = `${folder}/${fileName}`;
    
    // Upload to Cloudflare R2
    const uploadCommand = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: optimizedBuffer,
      ContentType: mimetype,
      Metadata: {
        originalName: originalname,
        uploadedBy: req.user?.id || 'system',
        uploadedAt: new Date().toISOString()
      }
    });
    
    await r2Client.send(uploadCommand);
    
    // Generate public URL
    const publicUrl = `${process.env.R2_PUBLIC_URL || process.env.R2_ENDPOINT}/${process.env.R2_BUCKET}/${key}`;
    
    // Save asset record to database
    const asset = new Asset({
      name: title || originalname,
      originalName: originalname,
      fileName,
      url: publicUrl,
      key,
      size: finalSize,
      originalSize: size,
      type: mimetype,
      folder,
      metadata: {
        alt,
        title,
        optimized: finalSize !== size,
        compressionRatio: size > 0 ? ((size - finalSize) / size * 100).toFixed(2) : 0
      },
      uploadedBy: req.user?.id || 'system'
    });
    
    await asset.save();
    
    res.status(201).json({
      success: true,
      message: 'Asset uploaded successfully',
      data: asset
    });
    
  } catch (error) {
    console.error('Error uploading asset:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading asset',
      error: error.message
    });
  }
};

// Upload multiple assets
const uploadMultipleAssets = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files provided'
      });
    }

    const { folder = 'assets' } = req.body;
    const uploadPromises = [];
    
    for (const file of req.files) {
      const uploadPromise = processFileUpload(file, folder, req.user?.id);
      uploadPromises.push(uploadPromise);
    }
    
    const results = await Promise.allSettled(uploadPromises);
    const successful = [];
    const failed = [];
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successful.push(result.value);
      } else {
        failed.push({
          file: req.files[index].originalname,
          error: result.reason.message
        });
      }
    });
    
    res.status(successful.length > 0 ? 201 : 400).json({
      success: successful.length > 0,
      message: `${successful.length} assets uploaded successfully${failed.length > 0 ? `, ${failed.length} failed` : ''}`,
      data: {
        successful,
        failed,
        total: req.files.length
      }
    });
    
  } catch (error) {
    console.error('Error uploading multiple assets:', error);
    res.status(500).json({
      success: false,
      message: 'Error uploading assets',
      error: error.message
    });
  }
};

// Helper function to process individual file upload
const processFileUpload = async (file, folder, userId) => {
  const { buffer, originalname, mimetype, size } = file;
  
  // Optimize image if it's an image type
  const optimizedBuffer = await optimizeImage(buffer, mimetype);
  const finalSize = optimizedBuffer.length;
  
  // Generate unique filename
  const fileName = generateFileName(originalname, mimetype);
  const key = `${folder}/${fileName}`;
  
  // Upload to Cloudflare R2
  const uploadCommand = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: optimizedBuffer,
    ContentType: mimetype,
    Metadata: {
      originalName: originalname,
      uploadedBy: userId || 'system',
      uploadedAt: new Date().toISOString()
    }
  });
  
  await r2Client.send(uploadCommand);
  
  // Generate public URL
  const publicUrl = `${process.env.R2_PUBLIC_URL || process.env.R2_ENDPOINT}/${process.env.R2_BUCKET}/${key}`;
  
  // Save asset record to database
  const asset = new Asset({
    name: originalname,
    originalName: originalname,
    fileName,
    url: publicUrl,
    key,
    size: finalSize,
    originalSize: size,
    type: mimetype,
    folder,
    metadata: {
      optimized: finalSize !== size,
      compressionRatio: size > 0 ? ((size - finalSize) / size * 100).toFixed(2) : 0
    },
    uploadedBy: userId || 'system'
  });
  
  await asset.save();
  return asset;
};

// Get all assets with filtering and pagination
const getAssets = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      type, 
      folder, 
      search,
      sortBy = 'uploadedAt',
      sortOrder = 'desc'
    } = req.query;
    
    // Build filter query
    const filter = {};
    
    if (type) {
      if (type === 'image') {
        filter.type = { $regex: '^image/', $options: 'i' };
      } else if (type === 'video') {
        filter.type = { $regex: '^video/', $options: 'i' };
      } else {
        filter.type = type;
      }
    }
    
    if (folder) {
      filter.folder = folder;
    }
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { originalName: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
    
    // Execute query
    const [assets, total] = await Promise.all([
      Asset.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Asset.countDocuments(filter)
    ]);
    
    // Calculate pagination info
    const totalPages = Math.ceil(total / parseInt(limit));
    const hasNext = parseInt(page) < totalPages;
    const hasPrev = parseInt(page) > 1;
    
    res.json({
      success: true,
      data: {
        assets,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalItems: total,
          itemsPerPage: parseInt(limit),
          hasNext,
          hasPrev
        },
        filters: {
          type,
          folder,
          search,
          sortBy,
          sortOrder
        }
      }
    });
    
  } catch (error) {
    console.error('Error fetching assets:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching assets',
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
    
    // Delete from Cloudflare R2
    try {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: asset.key
      });
      
      await r2Client.send(deleteCommand);
    } catch (r2Error) {
      console.warn('Error deleting from R2:', r2Error.message);
      // Continue with database deletion even if R2 deletion fails
    }
    
    // Delete from database
    await Asset.findByIdAndDelete(id);
    
    res.json({
      success: true,
      message: 'Asset deleted successfully'
    });
    
  } catch (error) {
    console.error('Error deleting asset:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting asset',
      error: error.message
    });
  }
};

// Get asset details by ID
const getAssetById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const asset = await Asset.findById(id);
    
    if (!asset) {
      return res.status(404).json({
        success: false,
        message: 'Asset not found'
      });
    }
    
    res.json({
      success: true,
      data: asset
    });
    
  } catch (error) {
    console.error('Error fetching asset:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching asset',
      error: error.message
    });
  }
};

// Get folders list
const getFolders = async (req, res) => {
  try {
    const folders = await Asset.distinct('folder');
    
    // Get asset count per folder
    const folderStats = await Promise.all(
      folders.map(async (folder) => {
        const count = await Asset.countDocuments({ folder });
        return { name: folder, count };
      })
    );
    
    res.json({
      success: true,
      data: folderStats
    });
    
  } catch (error) {
    console.error('Error fetching folders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching folders',
      error: error.message
    });
  }
};

module.exports = {
  upload,
  uploadAsset,
  uploadMultipleAssets,
  getAssets,
  deleteAsset,
  getAssetById,
  getFolders
};