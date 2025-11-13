const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const validator = require('validator');
const DOMPurify = require('isomorphic-dompurify');
const SecurityLog = require('../models/SecurityLog');

// Enhanced XSS protection with custom configuration
const enhancedXssClean = () => {
  return (req, res, next) => {
    // Log potential XSS attempts
    const logXssAttempt = async (key, value, sanitized) => {
      if (value !== sanitized) {
        await SecurityLog.logEvent({
          action: 'xss_attempt',
          userId: req.user?.userId || null,
          ip: req.ip,
          userAgent: req.get('User-Agent') || '',
          details: {
            endpoint: req.path,
            method: req.method,
            field: key,
            originalValue: value.substring(0, 200), // Limit log size
            sanitizedValue: sanitized.substring(0, 200)
          },
          severity: 'medium'
        });
      }
    };

    // Recursively sanitize object
    const sanitizeObject = async (obj, path = '') => {
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          const fullPath = path ? `${path}.${key}` : key;
          
          if (typeof obj[key] === 'string') {
            const original = obj[key];
            
            // Use DOMPurify for HTML content
            if (key.includes('html') || key.includes('content') || key.includes('description')) {
              obj[key] = DOMPurify.sanitize(original, {
                ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
                ALLOWED_ATTR: ['href', 'target', 'rel']
              });
            } else {
              // Basic XSS cleaning for other fields
              obj[key] = validator.escape(original);
            }
            
            await logXssAttempt(fullPath, original, obj[key]);
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            await sanitizeObject(obj[key], fullPath);
          }
        }
      }
    };

    // Sanitize request body
    if (req.body && typeof req.body === 'object') {
      sanitizeObject(req.body).catch(console.error);
    }

    // Sanitize query parameters
    if (req.query && typeof req.query === 'object') {
      sanitizeObject(req.query).catch(console.error);
    }

    // Sanitize URL parameters
    if (req.params && typeof req.params === 'object') {
      sanitizeObject(req.params).catch(console.error);
    }

    next();
  };
};

// SQL injection detection (even though we use MongoDB)
const sqlInjectionDetection = () => {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i,
    /(\'|\"|;|--|\*|\/\*|\*\/)/,
    /(\bOR\b|\bAND\b).*(\=|\>|\<)/i
  ];

  return async (req, res, next) => {
    const checkForSqlInjection = async (obj, path = '') => {
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          const fullPath = path ? `${path}.${key}` : key;
          
          if (typeof obj[key] === 'string') {
            const value = obj[key];
            const hasSqlPattern = sqlPatterns.some(pattern => pattern.test(value));
            
            if (hasSqlPattern) {
              await SecurityLog.logEvent({
                action: 'sql_injection_attempt',
                userId: req.user?.userId || null,
                ip: req.ip,
                userAgent: req.get('User-Agent') || '',
                details: {
                  endpoint: req.path,
                  method: req.method,
                  field: fullPath,
                  suspiciousValue: value.substring(0, 200)
                },
                severity: 'high'
              });
            }
          } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            await checkForSqlInjection(obj[key], fullPath);
          }
        }
      }
    };

    // Check request body, query, and params
    if (req.body) await checkForSqlInjection(req.body);
    if (req.query) await checkForSqlInjection(req.query);
    if (req.params) await checkForSqlInjection(req.params);

    next();
  };
};

// Template JSON validation and sanitization
const templateJsonSanitizer = () => {
  return (req, res, next) => {
    if (req.body && req.body.sections) {
      try {
        // Validate template structure
        if (!Array.isArray(req.body.sections)) {
          return res.status(400).json({
            success: false,
            error: 'Template sections must be an array'
          });
        }

        // Sanitize each section
        req.body.sections = req.body.sections.map(section => {
          // Validate required fields
          if (!section.id || !section.type) {
            throw new Error('Each section must have id and type');
          }

          // Sanitize section settings
          if (section.settings) {
            for (const key in section.settings) {
              if (typeof section.settings[key] === 'string') {
                // Allow HTML in specific content fields but sanitize
                if (['content', 'description', 'html'].includes(key)) {
                  section.settings[key] = DOMPurify.sanitize(section.settings[key], {
                    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img'],
                    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'width', 'height']
                  });
                } else {
                  // Escape other string values
                  section.settings[key] = validator.escape(section.settings[key]);
                }
              }
            }
          }

          return section;
        });

      } catch (error) {
        return res.status(400).json({
          success: false,
          error: `Invalid template data: ${error.message}`
        });
      }
    }

    next();
  };
};

// File name sanitization
const fileNameSanitizer = () => {
  return (req, res, next) => {
    if (req.file || req.files) {
      const sanitizeFileName = (fileName) => {
        // Remove dangerous characters and normalize
        return fileName
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .replace(/\.{2,}/g, '.')
          .replace(/^\.+|\.+$/g, '')
          .toLowerCase();
      };

      if (req.file) {
        req.file.originalname = sanitizeFileName(req.file.originalname);
      }

      if (req.files) {
        if (Array.isArray(req.files)) {
          req.files.forEach(file => {
            file.originalname = sanitizeFileName(file.originalname);
          });
        } else {
          Object.keys(req.files).forEach(key => {
            if (Array.isArray(req.files[key])) {
              req.files[key].forEach(file => {
                file.originalname = sanitizeFileName(file.originalname);
              });
            } else {
              req.files[key].originalname = sanitizeFileName(req.files[key].originalname);
            }
          });
        }
      }
    }

    next();
  };
};

// Enhanced NoSQL injection protection
const enhancedMongoSanitize = () => {
  return (req, res, next) => {
    const originalSanitizer = mongoSanitize({
      replaceWith: '_',
      onSanitize: async ({ req, key }) => {
        await SecurityLog.logEvent({
          action: 'sql_injection_attempt',
          userId: req.user?.userId || null,
          ip: req.ip,
          userAgent: req.get('User-Agent') || '',
          details: {
            endpoint: req.path,
            method: req.method,
            field: key,
            type: 'nosql_injection'
          },
          severity: 'high'
        });
      }
    });

    originalSanitizer(req, res, next);
  };
};

// Comprehensive sanitization middleware stack
const enhancedSanitize = [
  enhancedMongoSanitize(),
  sqlInjectionDetection(),
  enhancedXssClean(),
  templateJsonSanitizer(),
  fileNameSanitizer()
];

module.exports = {
  enhancedSanitize,
  enhancedXssClean,
  sqlInjectionDetection,
  templateJsonSanitizer,
  fileNameSanitizer,
  enhancedMongoSanitize
};