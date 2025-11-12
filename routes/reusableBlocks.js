const express = require('express');
const router = express.Router();
const ReusableBlock = require('../models/ReusableBlock');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// All reusable block routes require authentication and admin access
router.use(auth);
router.use(adminAuth);

// Get all reusable blocks
router.get('/', async (req, res) => {
  try {
    const { category, search } = req.query;
    
    const query = {};
    if (category && category !== 'all') {
      query.category = category;
    }
    
    if (search) {
      query.$text = { $search: search };
    }
    
    const blocks = await ReusableBlock.find(query)
      .populate('createdBy', 'name email')
      .sort({ usageCount: -1, createdAt: -1 });
    
    res.status(200).json({
      success: true,
      data: blocks
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching reusable blocks',
      error: error.message
    });
  }
});

// Create new reusable block
router.post('/', async (req, res) => {
  try {
    const { name, description, category, type, settings, tags, isPublic } = req.body;
    
    const block = new ReusableBlock({
      name,
      description,
      category,
      type,
      settings,
      tags: Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : []),
      isPublic: isPublic || false,
      createdBy: req.user.id
    });
    
    await block.save();
    
    res.status(201).json({
      success: true,
      data: block
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating reusable block',
      error: error.message
    });
  }
});

// Get single reusable block
router.get('/:id', async (req, res) => {
  try {
    const block = await ReusableBlock.findById(req.params.id)
      .populate('createdBy', 'name email');
    
    if (!block) {
      return res.status(404).json({
        success: false,
        message: 'Reusable block not found'
      });
    }
    
    // Increment usage count
    await block.incrementUsage();
    
    res.status(200).json({
      success: true,
      data: block
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching reusable block',
      error: error.message
    });
  }
});

// Update reusable block
router.put('/:id', async (req, res) => {
  try {
    const { name, description, category, type, settings, tags, isPublic } = req.body;
    
    const block = await ReusableBlock.findById(req.params.id);
    
    if (!block) {
      return res.status(404).json({
        success: false,
        message: 'Reusable block not found'
      });
    }
    
    if (name !== undefined) block.name = name;
    if (description !== undefined) block.description = description;
    if (category !== undefined) block.category = category;
    if (type !== undefined) block.type = type;
    if (settings !== undefined) block.settings = settings;
    if (isPublic !== undefined) block.isPublic = isPublic;
    if (tags !== undefined) {
      block.tags = Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : []);
    }
    
    await block.save();
    
    res.status(200).json({
      success: true,
      data: block
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error updating reusable block',
      error: error.message
    });
  }
});

// Delete reusable block
router.delete('/:id', async (req, res) => {
  try {
    const block = await ReusableBlock.findById(req.params.id);
    
    if (!block) {
      return res.status(404).json({
        success: false,
        message: 'Reusable block not found'
      });
    }
    
    await ReusableBlock.findByIdAndDelete(req.params.id);
    
    res.status(200).json({
      success: true,
      message: 'Reusable block deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting reusable block',
      error: error.message
    });
  }
});

module.exports = router;