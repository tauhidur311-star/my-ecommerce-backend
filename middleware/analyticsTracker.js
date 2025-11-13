const { trackVisitorEvent } = require('../controllers/analyticsController');
const UAParser = require('ua-parser-js');

// Middleware to track visitor events
const trackVisitor = async (req, res, next) => {
  try {
    // Skip tracking for API routes, admin routes, and static assets
    if (
      req.path.startsWith('/api/') || 
      req.path.startsWith('/admin/') ||
      req.path.includes('.') || // Skip files with extensions
      req.method !== 'GET'
    ) {
      return next();
    }

    // Parse user agent
    const parser = new UAParser(req.get('User-Agent'));
    const device = parser.getDevice();
    const browser = parser.getBrowser();
    
    // Determine device type
    let deviceType = 'desktop';
    if (device.type === 'mobile') {
      deviceType = 'mobile';
    } else if (device.type === 'tablet') {
      deviceType = 'tablet';
    }

    // Get or create session ID
    let sessionId = req.session?.id || req.get('X-Session-ID') || `session_${Date.now()}_${Math.random()}`;
    
    // Get client IP (considering proxies)
    const ipAddress = req.ip || 
      req.connection.remoteAddress || 
      req.socket.remoteAddress ||
      (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
      '0.0.0.0';

    // Get referrer
    const referrer = req.get('Referer') || '';

    // Get country from IP (simplified - in production use a GeoIP service)
    const country = req.get('CF-IPCountry') || 
      req.get('X-Country-Code') || 
      'Unknown';

    // Track the visitor event (async, don't wait)
    setImmediate(async () => {
      try {
        await trackVisitorEvent(
          sessionId,
          req.path,
          referrer,
          req.get('User-Agent') || '',
          country,
          deviceType,
          ipAddress
        );
      } catch (error) {
        console.error('Error tracking visitor event:', error);
      }
    });

    next();
  } catch (error) {
    console.error('Analytics tracking middleware error:', error);
    next(); // Continue even if tracking fails
  }
};

module.exports = { trackVisitor };