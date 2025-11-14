const Template = require('../models/Template');
const Theme = require('../models/Theme');

// Get published theme layout for public pages
const getPublishedTheme = async (req, res) => {
  try {
    const { pageType, slug } = req.params;
    
    // Find active theme or use first available theme
    let activeTheme = await Theme.findOne({ isActive: true });
    
    if (!activeTheme) {
      // If no active theme, use the first theme and make it active
      activeTheme = await Theme.findOne({});
      if (activeTheme) {
        activeTheme.isActive = true;
        await activeTheme.save();
        console.log('Auto-activated theme:', activeTheme.name);
      } else {
        return res.status(404).json({
          success: false,
          message: 'No themes found in database'
        });
      }
    }
    
    // Build query based on page type
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
      .select('publishedJson seoTitle seoDescription seoKeywords updatedAt');
    
    // Set cache headers for published content
    res.set({
      'Cache-Control': 'no-store',
      'ETag': `"theme-${pageType}-${template ? template.updatedAt.getTime() : Date.now()}"`,
      'Last-Modified': template ? template.updatedAt.toUTCString() : new Date().toUTCString()
    });
    
    if (!template || !template.publishedJson) {
      // Return default layout if no published template found
      const defaultLayout = getDefaultLayout(pageType);
      return res.status(200).json({
        success: true,
        data: {
          layout: defaultLayout,
          seo: {
            title: `${pageType.charAt(0).toUpperCase() + pageType.slice(1)} - Your Store`,
            description: `${pageType} page`,
            keywords: [pageType]
          },
          lastUpdated: new Date().toISOString()
        }
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        layout: template.publishedJson,
        seo: {
          title: template.seoTitle,
          description: template.seoDescription,
          keywords: template.seoKeywords
        },
        lastUpdated: template.updatedAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching published theme',
      error: error.message
    });
  }
};

// Get all published pages (for sitemap/navigation)
const getPublishedPages = async (req, res) => {
  try {
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
    }).select('pageType slug seoTitle seoDescription updatedAt');
    
    const formattedPages = pages.map(page => ({
      pageType: page.pageType,
      slug: page.slug,
      title: page.seoTitle,
      description: page.seoDescription,
      url: page.pageType === 'custom' ? `/pages/${page.slug}` : `/${page.pageType === 'home' ? '' : page.pageType}`,
      lastUpdated: page.updatedAt
    }));
    
    res.status(200).json({
      success: true,
      data: formattedPages
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching published pages',
      error: error.message
    });
  }
};

// Helper function to get default layouts
function getDefaultLayout(pageType) {
  const defaults = {
    home: {
      sections: [
        {
          id: 'hero-default',
          type: 'hero',
          settings: {
            title: 'Welcome to Your Store',
            subtitle: 'Discover amazing products',
            buttonText: 'Shop Now',
            buttonLink: '#products',
            backgroundImage: '',
            textColor: '#ffffff',
            backgroundColor: '#1f2937',
            padding: { top: 80, bottom: 80 }
          }
        },
        {
          id: 'products-default',
          type: 'product-grid',
          settings: {
            title: 'Featured Products',
            subtitle: 'Check out our best sellers',
            limit: 8,
            sort: 'featured',
            showTitle: true,
            padding: { top: 60, bottom: 60 }
          }
        }
      ]
    },
    product: {
      sections: [
        {
          id: 'product-details-default',
          type: 'product-details',
          settings: {
            showReviews: true,
            showRelated: true,
            relatedLimit: 4
          }
        }
      ]
    },
    collection: {
      sections: [
        {
          id: 'collection-header-default',
          type: 'collection-header',
          settings: {
            showFilters: true,
            showSorting: true
          }
        },
        {
          id: 'product-grid-default',
          type: 'product-grid',
          settings: {
            showFilters: true,
            pagination: true,
            itemsPerPage: 12
          }
        }
      ]
    },
    about: {
      sections: [
        {
          id: 'page-header-default',
          type: 'page-header',
          settings: {
            title: 'About Us',
            subtitle: 'Learn more about our story'
          }
        },
        {
          id: 'content-default',
          type: 'html',
          settings: {
            html: '<div class="prose max-w-none"><p>Tell your story here...</p></div>'
          }
        }
      ]
    },
    contact: {
      sections: [
        {
          id: 'contact-header-default',
          type: 'page-header',
          settings: {
            title: 'Contact Us',
            subtitle: 'Get in touch with us'
          }
        },
        {
          id: 'contact-form-default',
          type: 'contact-form',
          settings: {
            showMap: false,
            fields: ['name', 'email', 'message']
          }
        }
      ]
    }
  };
  
  return defaults[pageType] || { sections: [] };
}

// Get draft theme for preview (admin only)
const getPreviewTheme = async (req, res) => {
  try {
    const { pageType, slug } = req.params;
    
    // Find active theme
    const activeTheme = await Theme.findOne({ isActive: true });
    
    if (!activeTheme) {
      return res.status(404).json({
        success: false,
        message: 'No active theme found'
      });
    }
    
    // Build query for draft template
    const query = {
      themeId: activeTheme._id
      // Note: No status filter - we want draft content for preview
    };
    
    if (pageType === 'custom' && slug) {
      query.pageType = 'custom';
      query.slug = slug;
    } else {
      query.pageType = pageType;
    }
    
    const template = await Template.findOne(query)
      .select('json seoTitle seoDescription seoKeywords updatedAt status');
    
    // Set no-cache headers for preview content
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    if (!template || !template.json) {
      // Return default layout if no template found
      const defaultLayout = getDefaultLayout(pageType);
      return res.status(200).json({
        success: true,
        data: {
          layout: defaultLayout,
          seo: {
            title: `${pageType.charAt(0).toUpperCase() + pageType.slice(1)} - Your Store`,
            description: `${pageType} page`,
            keywords: [pageType]
          },
          lastUpdated: new Date().toISOString(),
          isDraft: true
        }
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        layout: template.json, // Return draft JSON for preview
        seo: {
          title: template.seoTitle,
          description: template.seoDescription,
          keywords: template.seoKeywords
        },
        lastUpdated: template.updatedAt,
        isDraft: template.status === 'draft'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching preview theme',
      error: error.message
    });
  }
};

// SSE endpoint for theme updates - Render compatible
const themeUpdatesSSE = (req, res) => {
  console.log('🚀 THEME UPDATES SSE ENDPOINT HIT - Starting SSE connection');
  
  // Render-compatible SSE headers (CORS handled by main middleware)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable Nginx buffering for SSE
  });
  
  console.log('📡 Render-compatible SSE headers set');
  
  // Send initial connection message with proper format
  const sendMessage = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  // Initial connection
  sendMessage('connected', {
    message: 'Connected to theme updates successfully',
    timestamp: new Date().toISOString(),
    server: 'render'
  });
  
  console.log('📨 Initial SSE message sent');
  
  let isConnected = true;
  
  // Aggressive keep-alive for Render (every 5 seconds)
  const pingInterval = setInterval(() => {
    if (!isConnected) {
      clearInterval(pingInterval);
      return;
    }
    
    try {
      sendMessage('ping', {
        type: 'keepalive',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
      console.log('🏓 Render SSE ping sent');
    } catch (error) {
      console.error('❌ Error sending ping:', error);
      isConnected = false;
      clearInterval(pingInterval);
    }
  }, 5000); // More frequent for Render
  
  // Handle connection close
  req.on('close', () => {
    console.log('🔌 SSE connection closed by client');
    isConnected = false;
    clearInterval(pingInterval);
  });
  
  req.on('error', (err) => {
    console.error('❌ SSE connection error:', err);
    isConnected = false;
    clearInterval(pingInterval);
  });
  
  // Render timeout handling
  req.setTimeout(0); // Disable request timeout for SSE
  
  console.log('✅ Render-compatible SSE connection established');
};

module.exports = {
  getPublishedTheme,
  getPublishedPages,
  getPreviewTheme,
  themeUpdatesSSE
};