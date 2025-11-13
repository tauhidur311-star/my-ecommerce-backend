const Template = require('../models/Template');
const Theme = require('../models/Theme');
const sseManager = require('./sseController');

// Get template by ID
const getTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    
    const template = await Template.findById(id).populate('themeId', 'name settings');
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching template',
      error: error.message
    });
  }
};

// Save template draft
const saveDraft = async (req, res) => {
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
    
    // Create version backup before saving
    if (template.json) {
      template.createVersion('Auto-save backup', req.user?.id || 'system');
    }
    
    // Update template with new data
    template.json = json;
    template.status = 'draft';
    template.updatedAt = new Date();
    
    // Update SEO if provided
    if (seoTitle) template.seoTitle = seoTitle;
    if (seoDescription) template.seoDescription = seoDescription;
    if (seoKeywords) template.seoKeywords = seoKeywords;
    
    await template.save();
    
    res.json({
      success: true,
      message: 'Draft saved successfully',
      data: template
    });
  } catch (error) {
    console.error('Error saving draft:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving draft',
      error: error.message
    });
  }
};

// Publish template
const publishTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    
    const template = await Template.findById(id).populate('themeId');
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    // Create version backup before publishing
    if (template.publishedJson) {
      template.createVersion('Pre-publish backup', req.user?.id || 'system');
    }
    
    // Copy json to publishedJson and update status
    template.publishedJson = template.json;
    template.status = 'published';
    template.publishedAt = new Date();
    template.updatedAt = new Date();
    
    await template.save();
    
    // Update theme metadata
    if (template.themeId) {
      template.themeId.metadata.lastPublished = new Date();
      await template.themeId.save();
    }
    
    // Broadcast SSE update to all connected clients
    sseManager.broadcast('theme-update', {
      type: 'template-published',
      pageType: template.pageType,
      slug: template.slug,
      themeId: template.themeId?._id,
      updatedAt: template.updatedAt.toISOString(),
      publishedAt: template.publishedAt.toISOString()
    });
    
    console.log(`✅ Template published: ${template.pageType} - Broadcasting to ${sseManager.getTotalConnections()} clients`);
    
    res.json({
      success: true,
      message: 'Template published successfully',
      data: template
    });
  } catch (error) {
    console.error('Error publishing template:', error);
    res.status(500).json({
      success: false,
      message: 'Error publishing template',
      error: error.message
    });
  }
};

// Create new template
const createTemplate = async (req, res) => {
  try {
    const { 
      themeId, 
      pageType, 
      slug, 
      seoTitle, 
      seoDescription, 
      seoKeywords, 
      json 
    } = req.body;
    
    // Check if template with same pageType/slug already exists for this theme
    const existingTemplate = await Template.findOne({
      themeId,
      $or: [
        { pageType, slug: { $exists: false } },
        { pageType, slug }
      ]
    });
    
    if (existingTemplate) {
      return res.status(400).json({
        success: false,
        message: 'Template with this page type and slug already exists'
      });
    }
    
    // Create default layout if none provided
    const defaultLayout = json || {
      sections: [
        {
          id: 'hero-1',
          type: 'hero',
          settings: {
            title: 'Welcome to Your Store',
            subtitle: 'Discover amazing products',
            backgroundColor: '#1F2937',
            textColor: '#FFFFFF',
            buttonText: 'Shop Now',
            buttonLink: '/products'
          }
        }
      ]
    };
    
    const template = new Template({
      themeId,
      pageType,
      slug,
      seoTitle: seoTitle || `${pageType.charAt(0).toUpperCase() + pageType.slice(1)} Page`,
      seoDescription: seoDescription || `${pageType} page description`,
      seoKeywords: seoKeywords || [pageType],
      json: defaultLayout,
      status: 'draft',
      createdBy: req.user?.id || 'admin'
    });
    
    await template.save();
    
    // Update theme's total templates count
    await Theme.findByIdAndUpdate(themeId, {
      $inc: { 'metadata.totalTemplates': 1 }
    });
    
    res.status(201).json({
      success: true,
      message: 'Template created successfully',
      data: template
    });
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating template',
      error: error.message
    });
  }
};

// Get template versions
const getTemplateVersions = async (req, res) => {
  try {
    const { id } = req.params;
    
    const template = await Template.findById(id).select('versions');
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    res.json({
      success: true,
      data: template.versions
    });
  } catch (error) {
    console.error('Error fetching template versions:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching template versions',
      error: error.message
    });
  }
};

// Rollback to specific version
const rollbackToVersion = async (req, res) => {
  try {
    const { id, versionId } = req.params;
    
    const template = await Template.findById(id);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    const version = template.versions.id(versionId);
    
    if (!version) {
      return res.status(404).json({
        success: false,
        message: 'Version not found'
      });
    }
    
    // Create backup of current state
    template.createVersion('Pre-rollback backup', req.user?.id || 'system');
    
    // Restore from version
    template.json = version.json;
    template.seoTitle = version.seoTitle;
    template.seoDescription = version.seoDescription;
    template.seoKeywords = version.seoKeywords;
    template.status = 'draft'; // Set to draft after rollback
    template.updatedAt = new Date();
    
    await template.save();
    
    res.json({
      success: true,
      message: 'Template rolled back successfully',
      data: template
    });
  } catch (error) {
    console.error('Error rolling back template:', error);
    res.status(500).json({
      success: false,
      message: 'Error rolling back template',
      error: error.message
    });
  }
};

// Export template as JSON
const exportTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    
    const template = await Template.findById(id)
      .populate('themeId', 'name settings')
      .select('-versions -__v');
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }
    
    const exportData = {
      template: template.toObject(),
      exportedAt: new Date().toISOString(),
      version: '1.0.0'
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="template-${template.pageType}-${Date.now()}.json"`);
    
    res.json(exportData);
  } catch (error) {
    console.error('Error exporting template:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting template',
      error: error.message
    });
  }
};

// Import template from JSON
const importTemplate = async (req, res) => {
  try {
    const { themeId } = req.params;
    const { template: templateData } = req.body;
    
    if (!templateData) {
      return res.status(400).json({
        success: false,
        message: 'Template data is required'
      });
    }
    
    // Create new template with imported data
    const template = new Template({
      themeId,
      pageType: templateData.pageType,
      slug: templateData.slug,
      seoTitle: templateData.seoTitle,
      seoDescription: templateData.seoDescription,
      seoKeywords: templateData.seoKeywords,
      json: templateData.json,
      status: 'draft',
      createdBy: req.user?.id || 'admin'
    });
    
    await template.save();
    
    res.status(201).json({
      success: true,
      message: 'Template imported successfully',
      data: template
    });
  } catch (error) {
    console.error('Error importing template:', error);
    res.status(500).json({
      success: false,
      message: 'Error importing template',
      error: error.message
    });
  }
};

module.exports = {
  getTemplate,
  saveDraft,
  publishTemplate,
  createTemplate,
  getTemplateVersions,
  rollbackToVersion,
  exportTemplate,
  importTemplate
};