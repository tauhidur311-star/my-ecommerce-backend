const Theme = require('../models/Theme');
const Template = require('../models/Template');
const ReusableBlock = require('../models/ReusableBlock');

// Get all themes
const getThemes = async (req, res) => {
  try {
    const themes = await Theme.find()
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      data: themes
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching themes',
      error: error.message
    });
  }
};

// Create new theme
const createTheme = async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const theme = new Theme({
      name,
      description,
      isActive: true, // Make new themes active by default
      createdBy: req.user.id
    });
    
    await theme.save();
    
    // Create default home template
    const homeTemplate = new Template({
      themeId: theme._id,
      pageType: 'home',
      json: {
        sections: [
          {
            id: 'hero-1',
            type: 'hero',
            settings: {
              title: 'Welcome to Your Store',
              subtitle: 'Discover amazing products',
              buttonText: 'Shop Now',
              buttonLink: '#products',
              backgroundImage: '',
              textColor: '#ffffff',
              backgroundColor: '#1f2937'
            }
          }
        ]
      },
      createdBy: req.user.id
    });
    
    await homeTemplate.save();
    
    res.status(201).json({
      success: true,
      data: theme
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating theme',
      error: error.message
    });
  }
};

// Get templates for a theme
const getTemplates = async (req, res) => {
  try {
    const { themeId } = req.params;
    
    const templates = await Template.find({ themeId })
      .populate('createdBy', 'name email')
      .sort({ pageType: 1, createdAt: -1 });
    
    res.status(200).json({
      success: true,
      data: templates
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching templates',
      error: error.message
    });
  }
};

// Get single template
const getTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    
    const template = await Template.findById(id)
      .populate('createdBy', 'name email');
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: template
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching template',
      error: error.message
    });
  }
};

// Update template (save draft)
const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { json, seoTitle, seoDescription, seoKeywords } = req.body;
    
    const template = await Template.findById(id);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    // Create version backup before updating
    template.createVersion('Auto-save', req.user.id);
    
    // Update template
    template.json = json;
    if (seoTitle !== undefined) template.seoTitle = seoTitle;
    if (seoDescription !== undefined) template.seoDescription = seoDescription;
    if (seoKeywords !== undefined) template.seoKeywords = seoKeywords;
    
    await template.save();
    
    res.status(200).json({
      success: true,
      data: template
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error updating template',
      error: error.message
    });
  }
};

// Publish template
const publishTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    
    const template = await Template.findById(id);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    // Create version backup before publishing
    template.createVersion('Pre-publish backup', req.user.id);
    
    await template.publish();
    
    // Import SSE manager for broadcasting
    const sseManager = require('../utils/sseManager');
    
    // Emit theme-updated event to all connected clients
    sseManager.broadcast('theme-update', {
      pageType: template.pageType,
      slug: template.slug,
      updatedAt: template.updatedAt.toISOString(),
      publishedAt: template.publishedAt.toISOString(),
      themeId: template.themeId
    });
    
    console.log(`Published template ${template.pageType} and broadcasted to ${sseManager.getTotalConnections()} connections`);
    
    res.status(200).json({
      success: true,
      message: 'Template published successfully',
      data: template
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error publishing template',
      error: error.message
    });
  }
};

// Rollback to version
const rollbackTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const { versionIndex } = req.body;
    
    const template = await Template.findById(id);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    if (!template.versions[versionIndex]) {
      return res.status(400).json({
        success: false,
        message: 'Version not found'
      });
    }
    
    // Create backup of current state
    template.createVersion('Pre-rollback backup', req.user.id);
    
    // Rollback to selected version
    template.json = template.versions[versionIndex].json;
    await template.save();
    
    res.status(200).json({
      success: true,
      message: 'Template rolled back successfully',
      data: template
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error rolling back template',
      error: error.message
    });
  }
};

// Export template
const exportTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    
    const template = await Template.findById(id)
      .select('pageType json seoTitle seoDescription seoKeywords');
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    const exportData = {
      pageType: template.pageType,
      json: template.json,
      seoTitle: template.seoTitle,
      seoDescription: template.seoDescription,
      seoKeywords: template.seoKeywords,
      exportedAt: new Date().toISOString(),
      version: '1.0'
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="template-${template.pageType}-${Date.now()}.json"`);
    res.status(200).send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error exporting template',
      error: error.message
    });
  }
};

// Import template
const importTemplate = async (req, res) => {
  try {
    const { templateData, themeId, overwrite } = req.body;
    
    if (!templateData || !themeId) {
      return res.status(400).json({
        success: false,
        message: 'Template data and theme ID are required'
      });
    }
    
    // Check if template already exists
    const existingTemplate = await Template.findOne({
      themeId,
      pageType: templateData.pageType
    });
    
    if (existingTemplate && !overwrite) {
      return res.status(400).json({
        success: false,
        message: 'Template already exists. Set overwrite to true to replace it.'
      });
    }
    
    if (existingTemplate && overwrite) {
      // Update existing template
      existingTemplate.createVersion('Pre-import backup', req.user.id);
      existingTemplate.json = templateData.json;
      existingTemplate.seoTitle = templateData.seoTitle;
      existingTemplate.seoDescription = templateData.seoDescription;
      existingTemplate.seoKeywords = templateData.seoKeywords;
      await existingTemplate.save();
      
      res.status(200).json({
        success: true,
        message: 'Template imported and updated successfully',
        data: existingTemplate
      });
    } else {
      // Create new template
      const newTemplate = new Template({
        themeId,
        pageType: templateData.pageType,
        json: templateData.json,
        seoTitle: templateData.seoTitle,
        seoDescription: templateData.seoDescription,
        seoKeywords: templateData.seoKeywords,
        createdBy: req.user.id
      });
      
      await newTemplate.save();
      
      res.status(201).json({
        success: true,
        message: 'Template imported successfully',
        data: newTemplate
      });
    }
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error importing template',
      error: error.message
    });
  }
};

module.exports = {
  getThemes,
  createTheme,
  getTemplates,
  getTemplate,
  updateTemplate,
  publishTemplate,
  rollbackTemplate,
  exportTemplate,
  importTemplate
};