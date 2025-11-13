const express = require('express');
const router = express.Router();

// Import controllers
const previewController = require('../controllers/previewController');
const sseController = require('../controllers/sseController');

// Public theme routes (no authentication required)
router.get('/theme/:pageType', previewController.getPublishedTheme);
router.get('/theme/custom/:slug', previewController.getPublishedTheme);
router.get('/pages', previewController.getPublishedPages);

// SSE endpoint for live theme updates
router.get('/theme/updates', sseController.handleSSEConnection);

// Preview routes (admin authentication required for draft content)
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');

router.get('/theme/preview/:pageType', auth, adminAuth, previewController.getDraftTheme);
router.get('/theme/preview/custom/:slug', auth, adminAuth, previewController.getDraftTheme);

// Health check for public API
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Public API is healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    endpoints: {
      theme: '/theme/:pageType',
      customTheme: '/theme/custom/:slug',
      pages: '/pages',
      sseUpdates: '/theme/updates',
      preview: '/theme/preview/:pageType (admin only)'
    }
  });
});

// Get theme metadata (for SEO and social sharing)
router.get('/theme/:pageType/meta', async (req, res) => {
  try {
    const { pageType, slug } = req.params;
    const Template = require('../models/Template');
    const Theme = require('../models/Theme');
    
    // Find active theme
    const activeTheme = await Theme.findOne({ isActive: true });
    
    if (!activeTheme) {
      return res.status(404).json({
        success: false,
        message: 'No active theme found'
      });
    }
    
    // Build query
    const query = {
      themeId: activeTheme._id,
      status: 'published'
    };
    
    if (pageType === 'custom' && slug) {
      query.pageType = 'custom';
      query.slug = slug;
    } else {
      query.pageType = pageType;
    }
    
    const template = await Template.findOne(query)
      .select('seoTitle seoDescription seoKeywords publishedAt')
      .lean();
    
    if (!template) {
      return res.json({
        success: true,
        data: {
          title: `${pageType.charAt(0).toUpperCase() + pageType.slice(1)} - Your Store`,
          description: `${pageType} page`,
          keywords: [pageType],
          url: req.originalUrl,
          type: 'website',
          image: null,
          publishedAt: new Date().toISOString()
        }
      });
    }
    
    res.json({
      success: true,
      data: {
        title: template.seoTitle,
        description: template.seoDescription,
        keywords: template.seoKeywords,
        url: req.originalUrl,
        type: 'website',
        image: null, // Could be extracted from hero section
        publishedAt: template.publishedAt
      }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching theme metadata',
      error: error.message
    });
  }
});

// Sitemap generation
router.get('/sitemap', async (req, res) => {
  try {
    const Template = require('../models/Template');
    const Theme = require('../models/Theme');
    
    const activeTheme = await Theme.findOne({ isActive: true });
    
    if (!activeTheme) {
      return res.status(404).json({
        success: false,
        message: 'No active theme found'
      });
    }
    
    const pages = await Template.find({
      themeId: activeTheme._id,
      status: 'published'
    })
    .select('pageType slug publishedAt updatedAt')
    .lean();
    
    const baseUrl = process.env.FRONTEND_URL || 'https://yourstore.com';
    
    const sitemap = pages.map(page => ({
      url: page.slug ? `${baseUrl}/pages/${page.slug}` : `${baseUrl}/${page.pageType}`,
      lastmod: page.updatedAt.toISOString(),
      changefreq: 'weekly',
      priority: page.pageType === 'home' ? '1.0' : '0.8'
    }));
    
    res.json({
      success: true,
      data: sitemap
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error generating sitemap',
      error: error.message
    });
  }
});

// robots.txt
router.get('/robots.txt', (req, res) => {
  const baseUrl = process.env.FRONTEND_URL || 'https://yourstore.com';
  
  res.setHeader('Content-Type', 'text/plain');
  res.send(`User-agent: *
Allow: /

Sitemap: ${baseUrl}/api/public/sitemap
`);
});

module.exports = router;