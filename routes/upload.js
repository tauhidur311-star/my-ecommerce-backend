const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure multer for memory storage
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Check file type
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

// Helper function to upload to Cloudinary
const uploadToCloudinary = (buffer, options = {}) => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        resource_type: 'auto',
        folder: options.folder || 'ecommerce',
        transformation: options.transformation || [
          { quality: 'auto' },
          { fetch_format: 'auto' }
        ],
        ...options
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    ).end(buffer);
  });
};

// Upload single image
router.post('/image', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No image file provided'
      });
    }

    const { folder = 'general' } = req.body;
    
    const result = await uploadToCloudinary(req.file.buffer, {
      folder: `ecommerce/${folder}`,
      transformation: [
        { quality: 'auto' },
        { fetch_format: 'auto' },
        { width: 1200, height: 1200, crop: 'limit' }
      ]
    });

    res.json({
      success: true,
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
        size: result.bytes
      }
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload image',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Upload multiple images
router.post('/images', auth, upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No image files provided'
      });
    }

    const { folder = 'general' } = req.body;
    const uploadPromises = req.files.map(file => 
      uploadToCloudinary(file.buffer, {
        folder: `ecommerce/${folder}`,
        transformation: [
          { quality: 'auto' },
          { fetch_format: 'auto' },
          { width: 1200, height: 1200, crop: 'limit' }
        ]
      })
    );

    const results = await Promise.all(uploadPromises);
    
    const uploadedImages = results.map(result => ({
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
      size: result.bytes
    }));

    res.json({
      success: true,
      data: uploadedImages
    });
  } catch (error) {
    console.error('Multiple images upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload images',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Upload avatar
router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No avatar file provided'
      });
    }

    const result = await uploadToCloudinary(req.file.buffer, {
      folder: 'ecommerce/avatars',
      transformation: [
        { quality: 'auto' },
        { fetch_format: 'auto' },
        { width: 300, height: 300, crop: 'fill', gravity: 'face' },
        { radius: 'max' }
      ]
    });

    // Update user avatar
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user._id, {
      avatar: result.secure_url
    });

    res.json({
      success: true,
      data: {
        url: result.secure_url,
        publicId: result.public_id
      },
      message: 'Avatar updated successfully'
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload avatar',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Upload product images (Admin only)
router.post('/product-images', adminAuth, upload.array('images', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No image files provided'
      });
    }

    const { productId } = req.body;
    const uploadPromises = req.files.map((file, index) => 
      uploadToCloudinary(file.buffer, {
        folder: `ecommerce/products/${productId || 'temp'}`,
        public_id: `${productId || 'temp'}_${Date.now()}_${index}`,
        transformation: [
          { quality: 'auto' },
          { fetch_format: 'auto' },
          { width: 1200, height: 1200, crop: 'limit' }
        ]
      })
    );

    const results = await Promise.all(uploadPromises);
    
    const uploadedImages = results.map(result => ({
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height
    }));

    res.json({
      success: true,
      data: uploadedImages
    });
  } catch (error) {
    console.error('Product images upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload product images',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Delete image from Cloudinary
router.delete('/image/:publicId', auth, async (req, res) => {
  try {
    const { publicId } = req.params;
    
    if (!publicId) {
      return res.status(400).json({
        success: false,
        error: 'Public ID is required'
      });
    }

    // Decode the public ID (it might be URL encoded)
    const decodedPublicId = decodeURIComponent(publicId);
    
    const result = await cloudinary.uploader.destroy(decodedPublicId);
    
    if (result.result === 'ok') {
      res.json({
        success: true,
        message: 'Image deleted successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Image not found or already deleted'
      });
    }
  } catch (error) {
    console.error('Image deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete image',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get upload signature for direct uploads (Admin only)
router.post('/signature', adminAuth, async (req, res) => {
  try {
    const { folder = 'ecommerce/temp', transformation } = req.body;
    
    const timestamp = Math.round(Date.now() / 1000);
    const params = {
      timestamp,
      folder,
      ...(transformation && { transformation })
    };
    
    const signature = cloudinary.utils.api_sign_request(
      params,
      process.env.CLOUDINARY_API_SECRET
    );
    
    res.json({
      success: true,
      data: {
        signature,
        timestamp,
        apiKey: process.env.CLOUDINARY_API_KEY,
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        folder
      }
    });
  } catch (error) {
    console.error('Signature generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate upload signature'
    });
  }
});

// Image optimization endpoint
router.post('/optimize', auth, async (req, res) => {
  try {
    const { imageUrl, width, height, quality = 'auto' } = req.body;
    
    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        error: 'Image URL is required'
      });
    }
    
    // Extract public ID from Cloudinary URL
    const publicId = imageUrl.split('/').slice(-1)[0].split('.')[0];
    
    const optimizedUrl = cloudinary.url(publicId, {
      transformation: [
        { quality },
        { fetch_format: 'auto' },
        ...(width && height ? [{ width, height, crop: 'fill' }] : [])
      ]
    });
    
    res.json({
      success: true,
      data: {
        originalUrl: imageUrl,
        optimizedUrl
      }
    });
  } catch (error) {
    console.error('Image optimization error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to optimize image'
    });
  }
});

module.exports = router;