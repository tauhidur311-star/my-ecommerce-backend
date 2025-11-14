const express = require('express');
const router = express.Router();
const Page = require('../models/Page');
const Revision = require('../models/Revision');
const auth = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

// POST /api/pages/:pageId/sections - Add section to page
router.post('/:pageId/sections', auth, [
  body('type').notEmpty().withMessage('Section type is required'),
  body('settings').optional().isObject(),
  body('blocks').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const page = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const { type, settings = {}, blocks = [], insertAt } = req.body;
    
    // Generate unique section ID
    const sectionId = `section_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const newSection = {
      section_id: sectionId,
      type,
      order: insertAt !== undefined ? insertAt : page.sections.length,
      visible: true,
      settings: {
        // Default responsive settings
        desktop: { padding: 80, fontSize: 16 },
        tablet: { padding: 60, fontSize: 14 },
        mobile: { padding: 40, fontSize: 12 },
        ...settings
      },
      blocks: blocks.map((block, index) => ({
        block_id: `block_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`,
        order: index,
        ...block
      }))
    };
    
    // Insert section at specified position
    if (insertAt !== undefined && insertAt < page.sections.length) {
      page.sections.splice(insertAt, 0, newSection);
      // Update order for sections after insertion point
      page.sections.forEach((section, index) => {
        section.order = index;
      });
    } else {
      page.sections.push(newSection);
    }
    
    await page.save();
    
    // Create revision
    await Revision.createRevision(
      page._id,
      req.user._id,
      page.sections,
      page.theme_settings,
      `Added ${type} section`,
      'section_added'
    );
    
    res.status(201).json({
      message: 'Section added successfully',
      section: newSection,
      page_updated_at: page.updatedAt
    });
  } catch (error) {
    console.error('Error adding section:', error);
    res.status(500).json({ error: 'Failed to add section' });
  }
});

// PUT /api/pages/:pageId/sections/:sectionId - Update section
router.put('/:pageId/sections/:sectionId', auth, [
  body('settings').optional().isObject(),
  body('blocks').optional().isArray(),
  body('visible').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const page = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const sectionIndex = page.sections.findIndex(
      section => section.section_id === req.params.sectionId
    );
    
    if (sectionIndex === -1) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    const { settings, blocks, visible, content } = req.body;
    
    // Store original for change detection
    const originalSection = { ...page.sections[sectionIndex] };
    
    // Update section properties
    if (settings) {
      page.sections[sectionIndex].settings = {
        ...page.sections[sectionIndex].settings,
        ...settings
      };
    }
    
    if (blocks) {
      page.sections[sectionIndex].blocks = blocks.map((block, index) => ({
        ...block,
        block_id: block.block_id || `block_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`,
        order: index
      }));
    }
    
    if (visible !== undefined) {
      page.sections[sectionIndex].visible = visible;
    }
    
    if (content !== undefined) {
      page.sections[sectionIndex].content = content;
    }
    
    await page.save();
    
    // Create revision for significant changes
    const hasSignificantChange = settings || blocks || visible !== undefined;
    if (hasSignificantChange) {
      await Revision.createRevision(
        page._id,
        req.user._id,
        page.sections,
        page.theme_settings,
        `Updated ${page.sections[sectionIndex].type} section`,
        'section_modified'
      );
    }
    
    res.json({
      message: 'Section updated successfully',
      section: page.sections[sectionIndex],
      page_updated_at: page.updatedAt
    });
  } catch (error) {
    console.error('Error updating section:', error);
    res.status(500).json({ error: 'Failed to update section' });
  }
});

// DELETE /api/pages/:pageId/sections/:sectionId - Delete section
router.delete('/:pageId/sections/:sectionId', auth, async (req, res) => {
  try {
    const page = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const sectionIndex = page.sections.findIndex(
      section => section.section_id === req.params.sectionId
    );
    
    if (sectionIndex === -1) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    const deletedSection = page.sections[sectionIndex];
    
    // Remove section
    page.sections.splice(sectionIndex, 1);
    
    // Update order for remaining sections
    page.sections.forEach((section, index) => {
      section.order = index;
    });
    
    await page.save();
    
    // Create revision
    await Revision.createRevision(
      page._id,
      req.user._id,
      page.sections,
      page.theme_settings,
      `Deleted ${deletedSection.type} section`,
      'section_removed'
    );
    
    res.json({
      message: 'Section deleted successfully',
      deleted_section_id: req.params.sectionId,
      page_updated_at: page.updatedAt
    });
  } catch (error) {
    console.error('Error deleting section:', error);
    res.status(500).json({ error: 'Failed to delete section' });
  }
});

// POST /api/pages/:pageId/sections/:sectionId/duplicate - Duplicate section
router.post('/:pageId/sections/:sectionId/duplicate', auth, async (req, res) => {
  try {
    const page = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const sectionIndex = page.sections.findIndex(
      section => section.section_id === req.params.sectionId
    );
    
    if (sectionIndex === -1) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    const originalSection = page.sections[sectionIndex];
    const duplicatedSection = {
      ...JSON.parse(JSON.stringify(originalSection)), // Deep clone
      section_id: `section_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      order: sectionIndex + 1,
      blocks: originalSection.blocks.map((block, index) => ({
        ...block,
        block_id: `block_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`
      }))
    };
    
    // Insert duplicated section after original
    page.sections.splice(sectionIndex + 1, 0, duplicatedSection);
    
    // Update order for sections after insertion
    page.sections.forEach((section, index) => {
      section.order = index;
    });
    
    await page.save();
    
    // Create revision
    await Revision.createRevision(
      page._id,
      req.user._id,
      page.sections,
      page.theme_settings,
      `Duplicated ${originalSection.type} section`,
      'section_added'
    );
    
    res.status(201).json({
      message: 'Section duplicated successfully',
      section: duplicatedSection,
      page_updated_at: page.updatedAt
    });
  } catch (error) {
    console.error('Error duplicating section:', error);
    res.status(500).json({ error: 'Failed to duplicate section' });
  }
});

// POST /api/pages/:pageId/sections/reorder - Reorder sections
router.post('/:pageId/sections/reorder', auth, [
  body('section_orders').isArray().withMessage('Section orders must be an array'),
  body('section_orders.*.section_id').notEmpty(),
  body('section_orders.*.order').isNumeric()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const page = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const { section_orders } = req.body;
    
    // Validate that all section IDs exist
    const sectionIds = page.sections.map(s => s.section_id);
    const providedIds = section_orders.map(so => so.section_id);
    
    const missingIds = sectionIds.filter(id => !providedIds.includes(id));
    const extraIds = providedIds.filter(id => !sectionIds.includes(id));
    
    if (missingIds.length > 0 || extraIds.length > 0) {
      return res.status(400).json({ 
        error: 'Invalid section IDs provided',
        missing: missingIds,
        extra: extraIds
      });
    }
    
    // Create order mapping
    const orderMap = {};
    section_orders.forEach(so => {
      orderMap[so.section_id] = so.order;
    });
    
    // Update section orders
    page.sections.forEach(section => {
      section.order = orderMap[section.section_id];
    });
    
    // Sort sections by new order
    page.sections.sort((a, b) => a.order - b.order);
    
    await page.save();
    
    // Create revision
    await Revision.createRevision(
      page._id,
      req.user._id,
      page.sections,
      page.theme_settings,
      'Reordered sections',
      'section_modified'
    );
    
    res.json({
      message: 'Sections reordered successfully',
      sections: page.sections.map(s => ({
        section_id: s.section_id,
        type: s.type,
        order: s.order
      })),
      page_updated_at: page.updatedAt
    });
  } catch (error) {
    console.error('Error reordering sections:', error);
    res.status(500).json({ error: 'Failed to reorder sections' });
  }
});

// GET /api/pages/:pageId/sections/:sectionId - Get specific section
router.get('/:pageId/sections/:sectionId', auth, async (req, res) => {
  try {
    const page = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const section = page.sections.find(
      section => section.section_id === req.params.sectionId
    );
    
    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }
    
    res.json(section);
  } catch (error) {
    console.error('Error fetching section:', error);
    res.status(500).json({ error: 'Failed to fetch section' });
  }
});

module.exports = router;