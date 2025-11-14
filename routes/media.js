const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const Media = require('../models/Media');
const auth = require('../middleware/auth');
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

// POST /api/media/upload - Upload media files
router.post('/upload', auth, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    
    const { folder = 'theme-editor', tags = [] } = req.body;
    const uploadedFiles = [];
    
    for (const file of req.files) {
      try {
        // Generate unique filename
        const fileExtension = file.originalname.split('.').pop().toLowerCase();
        const uniqueFilename = `${crypto.randomUUID()}.${fileExtension}`;
        const r2Key = `${folder}/${uniqueFilename}`;
        
        let processedBuffer = file.buffer;
        let dimensions = {};
        let variants = [];
        
        // Process images to create variants
        if (file.mimetype.startsWith('image/') && file.mimetype !== 'image/svg+xml') {
          // Get original dimensions
          const metadata = await sharp(file.buffer).metadata();
          dimensions = { width: metadata.width, height: metadata.height };
          
          // Create variants for images
          const variantSizes = [
            { name: 'thumbnail', width: 150, height: 150 },
            { name: 'small', width: 300, height: 300 },
            { name: 'medium', width: 600, height: 600 },
            { name: 'large', width: 1200, height: 1200 }
          ];
          
          for (const size of variantSizes) {
            try {
              const variantBuffer = await sharp(file.buffer)
                .resize(size.width, size.height, {
                  fit: 'inside',
                  withoutEnlargement: true
                })
                .jpeg({ quality: 85 })
                .toBuffer();
              
              const variantKey = `${folder}/variants/${size.name}_${uniqueFilename.replace(/\.[^/.]+$/, '.jpg')}`;
              const variantUrl = await storageProvider.uploadFile(variantKey, variantBuffer, 'image/jpeg');
              
              const variantMetadata = await sharp(variantBuffer).metadata();
              variants.push({
                size: size.name,
                r2_key: variantKey,
                r2_url: variantUrl,
                dimensions: { width: variantMetadata.width, height: variantMetadata.height },
                file_size: variantBuffer.length
              });
            } catch (variantError) {
              console.warn(`Failed to create ${size.name} variant:`, variantError);
            }
          }
          
          // Optimize original image
          if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/jpg') {
            processedBuffer = await sharp(file.buffer)
              .jpeg({ quality: 90, progressive: true })
              .toBuffer();
          } else if (file.mimetype === 'image/png') {
            processedBuffer = await sharp(file.buffer)
              .png({ compressionLevel: 8 })
              .toBuffer();
          }
        }
        
        // Upload original file to R2
        const r2Url = await storageProvider.uploadFile(r2Key, processedBuffer, file.mimetype);
        
        // Add original as a variant
        variants.unshift({
          size: 'original',
          r2_key: r2Key,
          r2_url: r2Url,
          dimensions,
          file_size: processedBuffer.length
        });
        
        // Save media record to database
        const media = new Media({
          user_id: req.user._id,
          filename: uniqueFilename,
          original_filename: file.originalname,
          r2_key: r2Key,
          r2_url: r2Url,
          file_size: processedBuffer.length,
          mime_type: file.mimetype,
          dimensions,
          variants,
          folder,
          tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : []),
          is_optimized: file.mimetype.startsWith('image/'),
          optimization_stats: file.mimetype.startsWith('image/') ? {
            original_size: file.buffer.length,
            compressed_size: processedBuffer.length,
            compression_ratio: Math.round(((file.buffer.length - processedBuffer.length) / file.buffer.length) * 100)
          } : undefined
        });
        
        await media.save();
        uploadedFiles.push(media);
        
      } catch (fileError) {
        console.error(`Error processing file ${file.originalname}:`, fileError);
        // Continue with other files
      }
    }
    
    if (uploadedFiles.length === 0) {
      return res.status(500).json({ error: 'Failed to upload any files' });
    }
    
    res.status(201).json({
      message: `Successfully uploaded ${uploadedFiles.length} file(s)`,
      files: uploadedFiles.map(media => ({
        _id: media._id,
        filename: media.filename,
        original_filename: media.original_filename,
        url: media.r2_url,
        file_size: media.readableFileSize,
        mime_type: media.mime_type,
        dimensions: media.dimensions,
        variants: media.variants.map(v => ({
          size: v.size,
          url: v.r2_url,
          dimensions: v.dimensions
        }))
      }))
    });
    
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).json({ error: 'Failed to upload files' });
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