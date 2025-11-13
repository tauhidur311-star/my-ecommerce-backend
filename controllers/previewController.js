const Template = require('../models/Template');
const Theme = require('../models/Theme');

// Get published theme layout for public rendering
const getPublishedTheme = async (req, res) => {
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
      .select('publishedJson seoTitle seoDescription seoKeywords updatedAt publishedAt')
      .populate('themeId', 'name settings');
    
    // Set cache control headers for published content
    res.set({
      'Cache-Control': 'no-store',
      'ETag': `"theme-${pageType}-${template ? template.updatedAt.getTime() : Date.now()}"`,
      'Last-Modified': template ? template.updatedAt.toUTCString() : new Date().toUTCString()
    });
    
    if (!template || !template.publishedJson) {
      // Return default layout
      const defaultLayout = getDefaultLayout(pageType, activeTheme);
      return res.json({
        success: true,
        data: {
          layout: defaultLayout,
          theme: activeTheme,
          seo: {
            title: `${pageType.charAt(0).toUpperCase() + pageType.slice(1)} - Your Store`,
            description: `${pageType} page`,
            keywords: [pageType]
          },
          lastUpdated: new Date().toISOString(),
          isDefault: true
        }
      });
    }
    
    res.json({
      success: true,
      data: {
        layout: template.publishedJson,
        theme: activeTheme,
        seo: {
          title: template.seoTitle,
          description: template.seoDescription,
          keywords: template.seoKeywords
        },
        lastUpdated: template.updatedAt.toISOString(),
        publishedAt: template.publishedAt.toISOString(),
        isDefault: false
      }
    });
  } catch (error) {
    console.error('Error fetching published theme:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching published theme',
      error: error.message
    });
  }
};

// Get draft theme layout for admin preview
const getDraftTheme = async (req, res) => {
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
    
    // Build query for draft content
    const query = {
      themeId: activeTheme._id
      // No status filter - get latest draft
    };
    
    if (pageType === 'custom' && slug) {
      query.pageType = 'custom';
      query.slug = slug;
    } else {
      query.pageType = pageType;
    }
    
    const template = await Template.findOne(query)
      .select('json seoTitle seoDescription seoKeywords updatedAt status')
      .populate('themeId', 'name settings')
      .sort({ updatedAt: -1 }); // Get most recent
    
    // Set no-cache headers for draft content
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    if (!template || !template.json) {
      // Return default layout
      const defaultLayout = getDefaultLayout(pageType, activeTheme);
      return res.json({
        success: true,
        data: {
          layout: defaultLayout,
          theme: activeTheme,
          seo: {
            title: `${pageType.charAt(0).toUpperCase() + pageType.slice(1)} - Your Store`,
            description: `${pageType} page`,
            keywords: [pageType]
          },
          lastUpdated: new Date().toISOString(),
          isDraft: true,
          isDefault: true
        }
      });
    }
    
    res.json({
      success: true,
      data: {
        layout: template.json, // Return draft JSON
        theme: activeTheme,
        seo: {
          title: template.seoTitle,
          description: template.seoDescription,
          keywords: template.seoKeywords
        },
        lastUpdated: template.updatedAt.toISOString(),
        isDraft: template.status === 'draft',
        isDefault: false
      }
    });
  } catch (error) {
    console.error('Error fetching draft theme:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching draft theme',
      error: error.message
    });
  }
};

// Get all published pages for navigation
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
    })
    .select('pageType slug seoTitle publishedAt')
    .sort({ pageType: 1, slug: 1 });
    
    // Group pages by type
    const groupedPages = pages.reduce((acc, page) => {
      const type = page.pageType;
      if (!acc[type]) {
        acc[type] = [];
      }
      acc[type].push({
        id: page._id,
        pageType: page.pageType,
        slug: page.slug,
        title: page.seoTitle,
        publishedAt: page.publishedAt,
        url: page.slug ? `/pages/${page.slug}` : `/${page.pageType}`
      });
      return acc;
    }, {});
    
    res.json({
      success: true,
      data: {
        pages: groupedPages,
        total: pages.length,
        theme: {
          id: activeTheme._id,
          name: activeTheme.name
        }
      }
    });
  } catch (error) {
    console.error('Error fetching published pages:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching published pages',
      error: error.message
    });
  }
};

// Helper function to generate default layouts
const getDefaultLayout = (pageType, theme = null) => {
  const defaultColor = theme?.settings?.colors?.primary || '#3B82F6';
  const defaultBg = theme?.settings?.colors?.background || '#FFFFFF';
  const defaultText = theme?.settings?.colors?.text || '#1F2937';
  
  const layouts = {
    home: {
      sections: [
        {
          id: 'hero-default',
          type: 'hero',
          settings: {
            title: 'Welcome to Your Store',
            subtitle: 'Discover amazing products and great deals',
            backgroundColor: defaultColor,
            textColor: '#FFFFFF',
            buttonText: 'Shop Now',
            buttonLink: '/products',
            alignment: 'center',
            minHeight: '500px'
          }
        },
        {
          id: 'featured-products-default',
          type: 'product-grid',
          settings: {
            title: 'Featured Products',
            subtitle: 'Check out our best sellers',
            productsToShow: 8,
            columns: 4,
            showPrices: true,
            showAddToCart: true,
            backgroundColor: defaultBg,
            textColor: defaultText
          }
        },
        {
          id: 'newsletter-default',
          type: 'newsletter',
          settings: {
            title: 'Stay Updated',
            subtitle: 'Get the latest news and exclusive offers',
            backgroundColor: '#F9FAFB',
            textColor: defaultText,
            buttonColor: defaultColor
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
            showBreadcrumbs: true,
            showReviews: true,
            showRelatedProducts: true,
            backgroundColor: defaultBg,
            textColor: defaultText
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
            showSorting: true,
            productsPerPage: 24,
            backgroundColor: defaultBg,
            textColor: defaultText
          }
        },
        {
          id: 'product-grid-default',
          type: 'product-grid',
          settings: {
            columns: 3,
            showPrices: true,
            showAddToCart: true,
            showQuickView: true,
            backgroundColor: defaultBg,
            textColor: defaultText
          }
        }
      ]
    },
    about: {
      sections: [
        {
          id: 'about-hero-default',
          type: 'image-text',
          settings: {
            title: 'About Us',
            content: 'Learn more about our story and mission.',
            imagePosition: 'left',
            backgroundColor: defaultBg,
            textColor: defaultText
          }
        }
      ]
    },
    contact: {
      sections: [
        {
          id: 'contact-form-default',
          type: 'contact-form',
          settings: {
            title: 'Get in Touch',
            subtitle: 'We\'d love to hear from you',
            showMap: true,
            backgroundColor: defaultBg,
            textColor: defaultText
          }
        }
      ]
    }
  };
  
  return layouts[pageType] || layouts.home;
};

module.exports = {
  getPublishedTheme,
  getDraftTheme,
  getPublishedPages
};