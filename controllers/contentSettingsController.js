const ContentSettings = require('../models/ContentSettings');
const Product = require('../models/Product');

// @desc    Get content settings for a specific section
// @route   GET /api/admin/content-settings/:sectionType
// @access  Private/Admin
const getSectionSettings = async (req, res) => {
  try {
    const { sectionType } = req.params;
    
    const validSections = ['featuredProduct', 'imageGallery', 'hero', 'testimonials', 'newsletter'];
    if (!validSections.includes(sectionType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid section type'
      });
    }

    const settings = await ContentSettings.getSectionSettings(sectionType);
    
    // If it's featuredProduct and has a productId, populate the product data
    if (sectionType === 'featuredProduct' && settings.settings?.productId) {
      const product = await Product.findById(settings.settings.productId)
        .select('name description price images category inStock rating');
      settings.productData = product;
    }

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get section settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch section settings'
    });
  }
};

// @desc    Update content settings for a specific section
// @route   PUT /api/admin/content-settings/:sectionType
// @access  Private/Admin
const updateSectionSettings = async (req, res) => {
  try {
    const { sectionType } = req.params;
    const { settings, isActive, order } = req.body;

    const validSections = ['featuredProduct', 'imageGallery', 'hero', 'testimonials', 'newsletter'];
    if (!validSections.includes(sectionType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid section type'
      });
    }

    // Validate featured product settings
    if (sectionType === 'featuredProduct' && settings?.productId) {
      const product = await Product.findById(settings.productId);
      if (!product) {
        return res.status(400).json({
          success: false,
          error: 'Product not found'
        });
      }
    }

    // Find existing settings or create new
    let contentSettings = await ContentSettings.findOne({ sectionType });
    
    if (contentSettings) {
      // Update existing settings
      contentSettings.settings = { ...contentSettings.settings, ...settings };
      if (typeof isActive !== 'undefined') contentSettings.isActive = isActive;
      if (typeof order !== 'undefined') contentSettings.order = order;
      contentSettings.lastModifiedBy = req.user.id;
    } else {
      // Create new settings
      contentSettings = new ContentSettings({
        sectionType,
        settings,
        isActive: isActive !== undefined ? isActive : true,
        order: order || 0,
        lastModifiedBy: req.user.id
      });
    }

    await contentSettings.save();
    
    // Get the merged settings with defaults
    const mergedSettings = contentSettings.getMergedSettings();

    // If it's featuredProduct and has a productId, populate the product data
    if (sectionType === 'featuredProduct' && mergedSettings.settings?.productId) {
      const product = await Product.findById(mergedSettings.settings.productId)
        .select('name description price images category inStock rating');
      mergedSettings.productData = product;
    }

    res.json({
      success: true,
      data: mergedSettings,
      message: 'Settings updated successfully'
    });
  } catch (error) {
    console.error('Update section settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update section settings'
    });
  }
};

// @desc    Get all content settings
// @route   GET /api/admin/content-settings
// @access  Private/Admin
const getAllSettings = async (req, res) => {
  try {
    const settings = await ContentSettings.find()
      .sort({ order: 1, createdAt: -1 })
      .populate('lastModifiedBy', 'name email')
      .lean();

    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Get all settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch all settings'
    });
  }
};

// @desc    Get public content settings (for frontend display)
// @route   GET /api/content-settings
// @access  Public
const getPublicSettings = async (req, res) => {
  try {
    const { sections } = req.query;
    
    let sectionTypes = ['featuredProduct', 'imageGallery', 'hero', 'testimonials', 'newsletter'];
    
    if (sections) {
      sectionTypes = sections.split(',').filter(s => 
        ['featuredProduct', 'imageGallery', 'hero', 'testimonials', 'newsletter'].includes(s)
      );
    }

    const settingsPromises = sectionTypes.map(async (sectionType) => {
      const settings = await ContentSettings.getSectionSettings(sectionType);
      
      // If it's featuredProduct and has a productId, populate the product data
      if (sectionType === 'featuredProduct' && settings.settings?.productId) {
        try {
          const product = await Product.findById(settings.settings.productId)
            .select('name description price images category inStock rating');
          settings.productData = product;
        } catch (error) {
          console.error('Error fetching featured product:', error);
        }
      }
      
      return settings;
    });

    const allSettings = await Promise.all(settingsPromises);
    
    // Create a map for easy access
    const settingsMap = {};
    allSettings.forEach((setting, index) => {
      settingsMap[sectionTypes[index]] = setting;
    });

    res.json({
      success: true,
      data: settingsMap
    });
  } catch (error) {
    console.error('Get public settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch public settings'
    });
  }
};

// @desc    Reset section settings to defaults
// @route   POST /api/admin/content-settings/:sectionType/reset
// @access  Private/Admin
const resetSectionSettings = async (req, res) => {
  try {
    const { sectionType } = req.params;

    const validSections = ['featuredProduct', 'imageGallery', 'hero', 'testimonials', 'newsletter'];
    if (!validSections.includes(sectionType)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid section type'
      });
    }

    // Delete existing settings to revert to defaults
    await ContentSettings.findOneAndDelete({ sectionType });

    // Get default settings
    const defaultSettings = ContentSettings.getDefaultSettings(sectionType);

    res.json({
      success: true,
      data: defaultSettings,
      message: 'Settings reset to defaults successfully'
    });
  } catch (error) {
    console.error('Reset section settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset section settings'
    });
  }
};

// @desc    Search products for featured product selection
// @route   GET /api/admin/content-settings/search-products
// @access  Private/Admin
const searchProducts = async (req, res) => {
  try {
    const { q = '', limit = 20 } = req.query;

    const query = {};
    if (q) {
      query.$or = [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } }
      ];
    }

    const products = await Product.find(query)
      .select('name description price images category inStock rating')
      .limit(parseInt(limit))
      .sort({ name: 1 })
      .lean();

    res.json({
      success: true,
      data: products
    });
  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search products'
    });
  }
};

module.exports = {
  getSectionSettings,
  updateSectionSettings,
  getAllSettings,
  getPublicSettings,
  resetSectionSettings,
  searchProducts
};