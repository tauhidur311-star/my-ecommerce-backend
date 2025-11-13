const compression = require('compression');
const logger = require('../utils/structuredLogger');

// Enhanced compression middleware with logging
const compressionMiddleware = compression({
  // Only compress responses that are larger than 1kb
  threshold: 1024,
  
  // Compression level (1-9, 6 is default)
  level: process.env.NODE_ENV === 'production' ? 6 : 1,
  
  // Filter function to determine what to compress
  filter: (req, res) => {
    // Don't compress if the request includes a cache-control: no-transform directive
    if (req.headers['cache-control'] && req.headers['cache-control'].includes('no-transform')) {
      return false;
    }

    // Skip compression for already compressed files
    const contentType = res.getHeader('Content-Type');
    if (contentType) {
      const skipTypes = [
        'image/',
        'video/',
        'audio/',
        'application/zip',
        'application/gzip',
        'application/x-rar-compressed',
        'application/pdf'
      ];
      
      if (skipTypes.some(type => contentType.includes(type))) {
        return false;
      }
    }

    // Use the default compression filter for everything else
    return compression.filter(req, res);
  }
});

// Wrapper that adds logging
const enhancedCompression = (req, res, next) => {
  const originalEnd = res.end;
  const startTime = Date.now();

  res.end = function(chunk, encoding) {
    const responseTime = Date.now() - startTime;
    const contentLength = res.getHeader('Content-Length');
    const contentEncoding = res.getHeader('Content-Encoding');
    
    // Log compression statistics for monitoring
    if (contentEncoding && responseTime > 100) {
      logger.logPerformance('response_compression', responseTime, {
        url: req.originalUrl,
        method: req.method,
        contentLength,
        contentEncoding,
        compressionRatio: chunk ? (chunk.length / (contentLength || chunk.length)).toFixed(2) : 'unknown'
      });
    }

    return originalEnd.call(this, chunk, encoding);
  };

  compressionMiddleware(req, res, next);
};

module.exports = enhancedCompression;