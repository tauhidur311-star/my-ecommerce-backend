const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const Media = require('../models/Media');
const { auth } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 10 // Max 10 files at once
  },
  fileFilter: (req, file, cb) => {
    // Allow images and some document types
    const allowedMimes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'application/pdf',
      'video/mp4',
      'video/webm'
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images, PDFs, and videos are allowed.'), false);
    }
  }
});

// Import R2 storage provider
const storageProvider = require('../utils/storageProvider');

// POST /api/media/upload - Simple file upload for theme editor
router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    console.log('📤 Media upload request received');
    console.log('📤 File details:', req.file ? {
      name: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    } : 'No file');

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const { folder = 'theme-editor', tags = [] } = req.body;
    const file = req.file;

    // Generate unique filename
    const fileExtension = file.originalname.split('.').pop().toLowerCase();
    const uniqueFilename = `${crypto.randomUUID()}.${fileExtension}`;
    const storageKey = `${folder}/${uniqueFilename}`;

    try {
      // Use storageProvider for upload (supports both local and R2)
      const uploadResult = await storageProvider.uploadFile(file.buffer, storageKey, file.mimetype);
      
      console.log('📤 Upload successful:', uploadResult.url);

      // Save to database (optional - for tracking)
      const media = new Media({
        user_id: req.user._id || req.user.userId,
        filename: uniqueFilename,
        original_filename: file.originalname,
        r2_key: storageKey,
        r2_url: uploadResult.url,
        file_size: file.size,
        mime_type: file.mimetype,
        folder,
        tags: Array.isArray(tags) ? tags : [],
        is_optimized: false,
        variants: []
      });

      await media.save();

      return res.status(201).json({
        success: true,
        file: {
          _id: media._id,
          name: file.originalname,
          filename: uniqueFilename,
          url: uploadResult.url,
          mimeType: file.mimetype,
          size: file.size
        }
      });

    } catch (uploadError) {
      console.error('📤 Upload failed:', uploadError);
      
      // Fallback: return a simple response without storage
      const baseUrl = process.env.MEDIA_BASE_URL || process.env.BASE_URL || 'http://localhost:5000';
      const fallbackUrl = `${baseUrl}/uploads/${storageKey}`;
      
      return res.status(201).json({
        success: true,
        file: {
          name: file.originalname,
          filename: uniqueFilename,
          url: fallbackUrl,
          mimeType: file.mimetype,
          size: file.size
        }
      });
    }
    
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to upload files',
      message: error.message 
    });
  }
});

// GET /api/media - List media files
router.get('/', auth, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      folder, 
      mime_type, 
      search,
      sort_by = 'createdAt'
    } = req.query;
    
    const query = { user_id: req.user._id };
    
    if (folder) query.folder = folder;
    if (mime_type) {
      if (mime_type === 'image') {
        query.mime_type = { $regex: '^image/' };
      } else if (mime_type === 'video') {
        query.mime_type = { $regex: '^video/' };
      } else {
        query.mime_type = mime_type;
      }
    }
    if (search) {
      query.$or = [
        { original_filename: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } },
        { alt_text: { $regex: search, $options: 'i' } }
      ];
    }
    
    const sortOptions = {};
    sortOptions[sort_by] = sort_by === 'file_size' ? 1 : -1;
    
    const media = await Media.find(query)
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('used_in_pages', 'page_name slug');
    
    const total = await Media.countDocuments(query);
    
    res.json({
      media: media.map(m => ({
        _id: m._id,
        filename: m.filename,
        original_filename: m.original_filename,
        url: m.r2_url,
        file_size: m.readableFileSize,
        mime_type: m.mime_type,
        dimensions: m.dimensions,
        tags: m.tags,
        folder: m.folder,
        usage_count: m.usage_count,
        used_in_pages: m.used_in_pages,
        createdAt: m.createdAt,
        variants: m.variants.filter(v => v.size !== 'original').map(v => ({
          size: v.size,
          url: v.r2_url,
          dimensions: v.dimensions
        }))
      })),
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / limit),
        total_count: total
      }
    });
  } catch (error) {
    console.error('Error fetching media:', error);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

// GET /api/media/folders - List all folders
router.get('/folders', auth, async (req, res) => {
  try {
    const folders = await Media.aggregate([
      { $match: { user_id: req.user._id } },
      {
        $group: {
          _id: '$folder',
          count: { $sum: 1 },
          total_size: { $sum: '$file_size' },
          last_upload: { $max: '$createdAt' }
        }
      },
      { $sort: { count: -1 } }
    ]);
    
    res.json({
      folders: folders.map(folder => ({
        name: folder._id,
        count: folder.count,
        total_size: folder.total_size,
        last_upload: folder.last_upload
      }))
    });
  } catch (error) {
    console.error('Error fetching folders:', error);
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

// PUT /api/media/:id - Update media metadata
router.put('/:id', auth, [
  body('alt_text').optional().isLength({ max: 200 }),
  body('tags').optional().isArray(),
  body('folder').optional().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const media = await Media.findOne({
      _id: req.params.id,
      user_id: req.user._id
    });
    
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }
    
    const { alt_text, tags, folder } = req.body;
    
    if (alt_text !== undefined) media.alt_text = alt_text;
    if (tags !== undefined) media.tags = tags;
    if (folder !== undefined) media.folder = folder;
    
    await media.save();
    
    res.json({
      message: 'Media updated successfully',
      media: {
        _id: media._id,
        filename: media.filename,
        alt_text: media.alt_text,
        tags: media.tags,
        folder: media.folder
      }
    });
  } catch (error) {
    console.error('Error updating media:', error);
    res.status(500).json({ error: 'Failed to update media' });
  }
});

// DELETE /api/media/:id - Delete media file
router.delete('/:id', auth, async (req, res) => {
  try {
    const media = await Media.findOne({
      _id: req.params.id,
      user_id: req.user._id
    });
    
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }
    
    // Check if media is being used in pages
    if (media.used_in_pages.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete media that is being used in pages',
        used_in_pages: media.used_in_pages
      });
    }
    
    try {
      // Delete from R2
      await storageProvider.deleteFile(media.r2_key);
      
      // Delete variants from R2
      for (const variant of media.variants) {
        if (variant.r2_key !== media.r2_key) {
          await storageProvider.deleteFile(variant.r2_key);
        }
      }
    } catch (storageError) {
      console.warn('Error deleting from storage:', storageError);
      // Continue with database deletion even if storage deletion fails
    }
    
    await Media.deleteOne({ _id: media._id });
    
    res.json({ message: 'Media deleted successfully' });
  } catch (error) {
    console.error('Error deleting media:', error);
    res.status(500).json({ error: 'Failed to delete media' });
  }
});

// POST /api/media/bulk-delete - Bulk delete media files
router.post('/bulk-delete', auth, [
  body('media_ids').isArray().withMessage('Media IDs must be an array')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { media_ids } = req.body;
    
    const mediaFiles = await Media.find({
      _id: { $in: media_ids },
      user_id: req.user._id
    });
    
    if (mediaFiles.length === 0) {
      return res.status(404).json({ error: 'No media files found' });
    }
    
    // Check for usage
    const usedFiles = mediaFiles.filter(media => media.used_in_pages.length > 0);
    if (usedFiles.length > 0) {
      return res.status(400).json({ 
        error: 'Some files are being used and cannot be deleted',
        used_files: usedFiles.map(m => ({
          _id: m._id,
          filename: m.filename,
          used_in_pages: m.used_in_pages
        }))
      });
    }
    
    let deletedCount = 0;
    const failedDeletions = [];
    
    for (const media of mediaFiles) {
      try {
        // Delete from R2
        await storageProvider.deleteFile(media.r2_key);
        
        // Delete variants
        for (const variant of media.variants) {
          if (variant.r2_key !== media.r2_key) {
            await storageProvider.deleteFile(variant.r2_key);
          }
        }
        
        await Media.deleteOne({ _id: media._id });
        deletedCount++;
      } catch (error) {
        console.error(`Error deleting media ${media._id}:`, error);
        failedDeletions.push({
          _id: media._id,
          filename: media.filename,
          error: error.message
        });
      }
    }
    
    res.json({
      message: `Successfully deleted ${deletedCount} file(s)`,
      deleted_count: deletedCount,
      failed_deletions: failedDeletions
    });
  } catch (error) {
    console.error('Error bulk deleting media:', error);
    res.status(500).json({ error: 'Failed to delete media files' });
  }
});

module.exports = router;