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

module.exports = {
  getPublishedTheme,
  getPublishedPages
};