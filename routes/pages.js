const express = require('express');
const router = express.Router();
const Page = require('../models/Page');
const Template = require('../models/Template');
const Revision = require('../models/Revision');
const Comment = require('../models/Comment');
const Media = require('../models/Media');
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');
const { body, validationResult } = require('express-validator');

// GET /api/pages - List all pages for user
router.get('/', auth, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      template_type, 
      published, 
      search 
    } = req.query;
    
    const query = { user_id: req.user.userId }; // ✅ FIXED: Use userId from auth middleware
    
    if (template_type) query.template_type = template_type;
    if (published !== undefined) query.published = published === 'true';
    if (search) {
      query.$or = [
        { page_name: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } }
      ];
    }
    
    const pages = await Page.find(query)
      .select('page_name slug template_type published published_at is_active createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await Page.countDocuments(query);
    
    res.json({
      pages,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / limit),
        total_count: total,
        has_next: page * limit < total,
        has_prev: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching pages:', error);
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

// GET /api/pages/active - Get currently active page for storefront
router.get('/active', async (req, res) => {
  try {
    const activePage = await Page.findOne({ 
      is_active: true, 
      published: true 
    })
    .populate('user_id', 'name email')
    .select('-__v');
    
    if (!activePage) {
      return res.status(404).json({ error: 'No active page found' });
    }
    
    res.json(activePage);
  } catch (error) {
    console.error('Error fetching active page:', error);
    res.status(500).json({ error: 'Failed to fetch active page' });
  }
});

// GET /api/pages/:id - Get specific page
router.get('/:id', auth, async (req, res) => {
  try {
    const page = await Page.findOne({
      _id: req.params.id,
      user_id: req.user.userId // ✅ FIXED: Use userId from auth middleware
    }).populate('user_id', 'name email');
    
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    res.json(page);
  } catch (error) {
    console.error('Error fetching page:', error);
    res.status(500).json({ error: 'Failed to fetch page' });
  }
});

// POST /api/pages - Create new page
router.post('/', auth, [
  body('page_name').notEmpty().withMessage('Page name is required'),
  body('slug').optional().isSlug().withMessage('Invalid slug format'),
  body('template_type').optional().isIn(['home', 'product', 'collection', 'about', 'contact', 'custom'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { page_name, slug, template_type = 'custom', sections = [] } = req.body;
    
    // Generate slug if not provided
    const finalSlug = slug || page_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    // Check if slug is unique
    const existingPage = await Page.findOne({ slug: finalSlug });
    if (existingPage) {
      return res.status(400).json({ error: 'Slug already exists' });
    }
    
    // ✅ FIX: Use req.user.userId (not req.user._id) - matches auth middleware
    const page = new Page({
      user_id: req.user.userId, // ✅ FIXED: Use userId property from auth middleware
      page_name,
      slug: finalSlug,
      template_type,
      sections: sections.map((section, index) => ({
        ...section,
        section_id: section.section_id || `section_${Date.now()}_${index}`,
        order: index
      }))
    });
    
    await page.save();
    
    // Create initial revision
    await Revision.createRevision(
      page._id,
      req.user.userId, // ✅ FIXED: Use userId from auth middleware
      page.sections,
      page.theme_settings,
      'Initial page creation',
      'manual_save'
    );
    
    res.status(201).json(page);
  } catch (error) {
    console.error('Error creating page:', error);
    res.status(500).json({ error: 'Failed to create page' });
  }
});

// PUT /api/pages/:id - Update page
router.put('/:id', auth, [
  body('page_name').optional().notEmpty(),
  body('sections').optional().isArray(),
  body('theme_settings').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const page = await Page.findOne({
      _id: req.params.id,
      user_id: req.user.userId // ✅ FIXED: Use userId from auth middleware
    });
    
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    // Store original data for revision
    const originalSections = [...page.sections];
    const originalThemeSettings = { ...page.theme_settings };
    
    // Update fields
    if (req.body.page_name) page.page_name = req.body.page_name;
    if (req.body.sections) {
      page.sections = req.body.sections.map((section, index) => ({
        ...section,
        order: index,
        section_id: section.section_id || `section_${Date.now()}_${index}`
      }));
    }
    if (req.body.theme_settings) {
      page.theme_settings = { ...page.theme_settings, ...req.body.theme_settings };
    }
    if (req.body.seo) page.seo = { ...page.seo, ...req.body.seo };
    
    page.performance.last_save_time = new Date();
    await page.save();
    
    // ✅ FIX: Create revision with correct user_id property
    if (req.body.sections || req.body.theme_settings) {
      await Revision.createRevision(
        page._id,
        req.user.userId, // ✅ FIXED: Use userId from auth middleware
        page.sections,
        page.theme_settings,
        req.body.change_description || 'Page updated',
        'manual_save'
      );
      
      // Cleanup old revisions (keep last 50)
      await Revision.cleanupOldRevisions(page._id, 50);
    }
    
    res.json(page);
  } catch (error) {
    console.error('Error updating page:', error);
    res.status(500).json({ error: 'Failed to update page' });
  }
});

// ✅ FIXED: Publish page with correct user_id property
router.put('/:id/publish', auth, async (req, res) => {
  try {
    const page = await Page.findOne({
      _id: req.params.id,
      user_id: req.user.userId // ✅ FIXED: Use userId from auth middleware
    });
    
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const { set_active = false } = req.body;
    
    // If setting as active, deactivate other pages
    if (set_active) {
      await Page.updateMany(
        { user_id: req.user.userId }, // ✅ FIXED: Use userId from auth middleware
        { is_active: false }
      );
      page.is_active = true;
    }
    
    page.published = true;
    page.published_at = new Date();
    await page.save();
    
    res.json({ 
      message: 'Page published successfully',
      page: {
        _id: page._id,
        page_name: page.page_name,
        published: page.published,
        published_at: page.published_at,
        is_active: page.is_active,
        url: page.url
      }
    });
  } catch (error) {
    console.error('Error publishing page:', error);
    res.status(500).json({ error: 'Failed to publish page' });
  }
});

// DELETE /api/pages/:id - Delete page
router.delete('/:id', auth, async (req, res) => {
  try {
    const page = await Page.findOne({
      _id: req.params.id,
      user_id: req.user.userId // ✅ FIXED: Use userId from auth middleware
    });
    
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    // Don't allow deletion of active page
    if (page.is_active) {
      return res.status(400).json({ 
        error: 'Cannot delete active page. Set another page as active first.' 
      });
    }
    
    // Delete associated data
    await Promise.all([
      Revision.deleteMany({ page_id: page._id }),
      Comment.deleteMany({ page_id: page._id }),
      Media.updateMany(
        { used_in_pages: page._id },
        { $pull: { used_in_pages: page._id } }
      )
    ]);
    
    await Page.deleteOne({ _id: page._id });
    
    res.json({ message: 'Page deleted successfully' });
  } catch (error) {
    console.error('Error deleting page:', error);
    res.status(500).json({ error: 'Failed to delete page' });
  }
});

// POST /api/pages/:id/duplicate - Duplicate page
router.post('/:id/duplicate', auth, async (req, res) => {
  try {
    const originalPage = await Page.findOne({
      _id: req.params.id,
      user_id: req.user.userId // ✅ FIXED: Use userId from auth middleware
    });
    
    if (!originalPage) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const { page_name } = req.body;
    const newPageName = page_name || `${originalPage.page_name} (Copy)`;
    const newSlug = newPageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    
    // Ensure unique slug
    let finalSlug = newSlug;
    let counter = 1;
    while (await Page.findOne({ slug: finalSlug })) {
      finalSlug = `${newSlug}-${counter}`;
      counter++;
    }
    
    const duplicatedPage = new Page({
      user_id: req.user.userId, // ✅ FIXED: Use userId from auth middleware
      page_name: newPageName,
      slug: finalSlug,
      template_type: originalPage.template_type,
      sections: originalPage.sections.map(section => ({
        ...section,
        section_id: `section_${Date.now()}_${Math.random()}`
      })),
      theme_settings: originalPage.theme_settings,
      seo: originalPage.seo,
      published: false,
      is_active: false
    });
    
    await duplicatedPage.save();
    
    // ✅ FIXED: Create initial revision with correct user_id
    await Revision.createRevision(
      duplicatedPage._id,
      req.user.userId, // ✅ FIXED: Use userId from auth middleware
      duplicatedPage.sections,
      duplicatedPage.theme_settings,
      `Duplicated from ${originalPage.page_name}`,
      'manual_save'
    );
    
    res.status(201).json(duplicatedPage);
  } catch (error) {
    console.error('Error duplicating page:', error);
    res.status(500).json({ error: 'Failed to duplicate page' });
  }
});

module.exports = router;