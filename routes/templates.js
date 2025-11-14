const express = require('express');
const router = express.Router();
const Template = require('../models/Template');
const Page = require('../models/Page');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { body, validationResult } = require('express-validator');

// GET /api/templates - List all templates with filters
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      category,
      is_premium,
      featured,
      search,
      sort_by = 'download_count'
    } = req.query;
    
    const query = { active: true };
    
    // Apply filters
    if (category) query.category = category;
    if (is_premium !== undefined) query.is_premium = is_premium === 'true';
    if (featured !== undefined) query.featured = featured === 'true';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }
    
    // Determine sort order
    let sortOptions = {};
    switch (sort_by) {
      case 'newest':
        sortOptions = { createdAt: -1 };
        break;
      case 'popular':
        sortOptions = { download_count: -1 };
        break;
      case 'rating':
        sortOptions = { rating: -1 };
        break;
      case 'name':
        sortOptions = { name: 1 };
        break;
      default:
        sortOptions = { download_count: -1 };
    }
    
    // If featured templates are requested, prioritize them
    if (featured === 'true') {
      sortOptions = { featured: -1, ...sortOptions };
    }
    
    const templates = await Template.find(query)
      .select('name description category thumbnail_url preview_images is_premium download_count rating tags featured')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('created_by', 'name');
    
    const total = await Template.countDocuments(query);
    
    // Get categories for filtering
    const categories = await Template.distinct('category', { active: true });
    
    res.json({
      templates: templates.map(template => ({
        ...template.toObject(),
        averageRating: template.averageRating
      })),
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / limit),
        total_count: total,
        has_next: page * limit < total,
        has_prev: page > 1
      },
      filters: {
        categories,
        available_sorts: ['newest', 'popular', 'rating', 'name']
      }
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// POST /api/templates/:templateId/apply/:pageId - Apply template to existing page
router.post('/:templateId/apply/:pageId', auth, async (req, res) => {
  try {
    const [template, page] = await Promise.all([
      Template.findOne({ _id: req.params.templateId, active: true }),
      Page.findOne({ _id: req.params.pageId, user_id: req.user._id })
    ]);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const { merge_sections = false } = req.body;
    
    if (merge_sections) {
      // Merge template sections with existing ones
      const templateSections = template.sections.map((section, index) => ({
        ...section,
        section_id: `section_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`,
        order: page.sections.length + index
      }));
      page.sections = [...page.sections, ...templateSections];
    } else {
      // Replace all sections with template sections
      page.sections = template.sections.map((section, index) => ({
        ...section,
        section_id: `section_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`,
        order: index
      }));
    }
    
    // Apply theme settings
    if (template.theme_settings) {
      page.theme_settings = {
        ...page.theme_settings,
        ...template.theme_settings
      };
    }
    
    await page.save();
    
    // Increment template download count
    await Template.updateOne(
      { _id: template._id },
      { $inc: { download_count: 1 } }
    );
    
    res.json({
      message: 'Template applied successfully',
      page: {
        _id: page._id,
        page_name: page.page_name,
        sections_count: page.sections.length,
        template_applied: template.name
      }
    });
  } catch (error) {
    console.error('Error applying template:', error);
    res.status(500).json({ error: 'Failed to apply template' });
  }
});

module.exports = router;