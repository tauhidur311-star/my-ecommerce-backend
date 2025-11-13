const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const SecurityLog = require('../models/SecurityLog');

// Allowed file types and their MIME types
const ALLOWED_FILE_TYPES = {
  images: {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
    'image/svg+xml': ['.svg']
  },
  videos: {
    'video/mp4': ['.mp4'],
    'video/mpeg': ['.mpeg'],
    'video/quicktime': ['.mov'],
    'video/x-msvideo': ['.avi'],
    'video/webm': ['.webm']
  },
  documents: {
    'application/pdf': ['.pdf'],
    'text/plain': ['.txt'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
  }
};

// File size limits (in bytes)
const FILE_SIZE_LIMITS = {
  image: 10 * 1024 * 1024, // 10MB
  video: 100 * 1024 * 1024, // 100MB
  document: 5 * 1024 * 1024, // 5MB
  default: 2 * 1024 * 1024 // 2MB
};

// Magic numbers for file type validation
const MAGIC_NUMBERS = {
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/png': [0x89, 0x50, 0x4E, 0x47],
  'image/gif': [0x47, 0x49, 0x46],
  'image/webp': [0x52, 0x49, 0x46, 0x46],
  'video/mp4': [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70] // or variations
};

// Validate file type using magic numbers
const validateFileSignature = (buffer, mimeType) => {
  const magicNumbers = MAGIC_NUMBERS[mimeType];
  if (!magicNumbers) return true; // Skip validation if no magic numbers defined

  const fileHeader = Array.from(buffer.slice(0, magicNumbers.length));
  return magicNumbers.every((byte, index) => byte === fileHeader[index]);
};

// Generate secure filename
const generateSecureFilename = (originalName, userId) => {
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(originalName).toLowerCase();
  return `${userId}_${timestamp}_${randomBytes}${ext}`;
};

// File filter function
const createFileFilter = (allowedTypes = ['images', 'videos', 'documents']) => {
  return async (req, file, cb) => {
    try {
      const allowedMimeTypes = [];
      allowedTypes.forEach(type => {
        if (ALLOWED_FILE_TYPES[type]) {
          allowedMimeTypes.push(...Object.keys(ALLOWED_FILE_TYPES[type]));
        }
      });

      // Check MIME type
      if (!allowedMimeTypes.includes(file.mimetype)) {
        await SecurityLog.logEvent({
          action: 'suspicious_activity',
          userId: req.user?.userId || null,
          ip: req.ip,
          userAgent: req.get('User-Agent') || '',
          details: {
            endpoint: req.path,
            method: req.method,
            reason: 'invalid_file_type',
            fileName: file.originalname,
            mimeType: file.mimetype,
            allowedTypes: allowedMimeTypes
          },
          severity: 'medium'
        });

        return cb(new Error(`File type ${file.mimetype} not allowed`), false);
      }

      // Check file extension
      const ext = path.extname(file.originalname).toLowerCase();
      const allowedExtensions = [];
      allowedTypes.forEach(type => {
        if (ALLOWED_FILE_TYPES[type]) {
          Object.values(ALLOWED_FILE_TYPES[type]).forEach(exts => {
            allowedExtensions.push(...exts);
          });
        }
      });

      if (!allowedExtensions.includes(ext)) {
        await SecurityLog.logEvent({
          action: 'suspicious_activity',
          userId: req.user?.userId || null,
          ip: req.ip,
          userAgent: req.get('User-Agent') || '',
          details: {
            endpoint: req.path,
            method: req.method,
            reason: 'invalid_file_extension',
            fileName: file.originalname,
            extension: ext,
            allowedExtensions
          },
          severity: 'medium'
        });

        return cb(new Error(`File extension ${ext} not allowed`), false);
      }

      // Log successful file validation
      console.log(`File validation passed: ${file.originalname} (${file.mimetype})`);
      cb(null, true);

    } catch (error) {
      console.error('File filter error:', error);
      cb(error, false);
    }
  };
};

// Enhanced multer configuration
const createUploadMiddleware = (options = {}) => {
  const {
    allowedTypes = ['images'],
    maxFileSize = null,
    maxFiles = 1,
    fieldName = 'file',
    destination = 'uploads/temp'
  } = options;

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, destination);
    },
    filename: (req, file, cb) => {
      const secureFilename = generateSecureFilename(file.originalname, req.user?.userId || 'anonymous');
      cb(null, secureFilename);
    }
  });

  const fileFilter = createFileFilter(allowedTypes);

  // Determine file size limit
  let sizeLimit = maxFileSize;
  if (!sizeLimit) {
    if (allowedTypes.includes('videos')) {
      sizeLimit = FILE_SIZE_LIMITS.video;
    } else if (allowedTypes.includes('images')) {
      sizeLimit = FILE_SIZE_LIMITS.image;
    } else if (allowedTypes.includes('documents')) {
      sizeLimit = FILE_SIZE_LIMITS.document;
    } else {
      sizeLimit = FILE_SIZE_LIMITS.default;
    }
  }

  const upload = multer({
    storage,
    fileFilter,
    limits: {
      fileSize: sizeLimit,
      files: maxFiles,
      fieldNameSize: 100,
      fieldSize: 1024 * 1024 // 1MB for text fields
    }
  });

  // Return appropriate upload middleware
  if (maxFiles === 1) {
    return upload.single(fieldName);
  } else {
    return upload.array(fieldName, maxFiles);
  }
};

// File security validation middleware
const validateUploadedFiles = () => {
  return async (req, res, next) => {
    const files = req.files || (req.file ? [req.file] : []);
    
    for (const file of files) {
      try {
        // Read file header for magic number validation
        const fs = require('fs').promises;
        const buffer = await fs.readFile(file.path);
        
        // Validate file signature
        if (!validateFileSignature(buffer, file.mimetype)) {
          // Delete the uploaded file
          await fs.unlink(file.path).catch(console.error);
          
          await SecurityLog.logEvent({
            action: 'suspicious_activity',
            userId: req.user?.userId || null,
            ip: req.ip,
            userAgent: req.get('User-Agent') || '',
            details: {
              endpoint: req.path,
              method: req.method,
              reason: 'file_signature_mismatch',
              fileName: file.originalname,
              mimeType: file.mimetype
            },
            severity: 'high'
          });

          return res.status(400).json({
            success: false,
            error: 'File content does not match declared type',
            code: 'INVALID_FILE_SIGNATURE'
          });
        }

        // Additional security checks
        const fileName = file.originalname.toLowerCase();
        const dangerousExtensions = ['.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.js'];
        
        if (dangerousExtensions.some(ext => fileName.includes(ext))) {
          await fs.unlink(file.path).catch(console.error);
          
          await SecurityLog.logEvent({
            action: 'suspicious_activity',
            userId: req.user?.userId || null,
            ip: req.ip,
            userAgent: req.get('User-Agent') || '',
            details: {
              endpoint: req.path,
              method: req.method,
              reason: 'dangerous_file_extension',
              fileName: file.originalname
            },
            severity: 'high'
          });

          return res.status(400).json({
            success: false,
            error: 'Dangerous file type detected',
            code: 'DANGEROUS_FILE_TYPE'
          });
        }

        // Log successful upload
        await SecurityLog.logEvent({
          action: 'asset_upload',
          userId: req.user?.userId || null,
          ip: req.ip,
          userAgent: req.get('User-Agent') || '',
          details: {
            endpoint: req.path,
            method: req.method,
            fileName: file.originalname,
            size: file.size,
            mimeType: file.mimetype
          },
          severity: 'low'
        });

      } catch (error) {
        console.error('File validation error:', error);
        
        // Delete the uploaded file on error
        const fs = require('fs').promises;
        await fs.unlink(file.path).catch(console.error);
        
        return res.status(500).json({
          success: false,
          error: 'File validation failed',
          code: 'FILE_VALIDATION_ERROR'
        });
      }
    }

    next();
  };
};

// Rate limiting for file uploads
const uploadRateLimit = () => {
  const uploadAttempts = new Map();

  return (req, res, next) => {
    const identifier = req.user?.userId || req.ip;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const maxUploads = req.user ? 50 : 10; // Higher limit for authenticated users

    if (!uploadAttempts.has(identifier)) {
      uploadAttempts.set(identifier, []);
    }

    const userAttempts = uploadAttempts.get(identifier);
    
    // Clean old attempts
    const validAttempts = userAttempts.filter(attempt => now - attempt < windowMs);
    uploadAttempts.set(identifier, validAttempts);

    if (validAttempts.length >= maxUploads) {
      SecurityLog.logEvent({
        action: 'rate_limit_exceeded',
        userId: req.user?.userId || null,
        ip: req.ip,
        userAgent: req.get('User-Agent') || '',
        details: {
          endpoint: req.path,
          method: req.method,
          reason: 'upload_rate_limit_exceeded',
          attempts: validAttempts.length
        },
        severity: 'medium'
      }).catch(console.error);

      return res.status(429).json({
        success: false,
        error: 'Upload rate limit exceeded',
        code: 'UPLOAD_RATE_LIMIT',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }

    // Record this attempt
    validAttempts.push(now);
    next();
  };
};

module.exports = {
  createUploadMiddleware,
  validateUploadedFiles,
  uploadRateLimit,
  createFileFilter,
  generateSecureFilename,
  ALLOWED_FILE_TYPES,
  FILE_SIZE_LIMITS
};