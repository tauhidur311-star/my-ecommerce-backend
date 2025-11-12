const ReusableBlock = require('../models/ReusableBlock');

// Get all reusable blocks with filtering and search
const getReusableBlocks = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      search,
      tags,
      isPublic,
      sortBy = 'usageCount',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};
    
    // Filter by category
    if (category && category !== 'all') {
      query.category = category;
    }
    
    // Filter by public status
    if (isPublic !== undefined) {
      query.isPublic = isPublic === 'true';
    } else {
      // Default: show public blocks and user's own blocks
      query.$or = [
        { isPublic: true },
        { createdBy: req.user.id }
      ];
    }
    
    // Filter by tags
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim());
      query.tags = { $in: tagArray };
    }
    
    // Text search
    if (search) {
      query.$text = { $search: search };
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query
    const [blocks, total] = await Promise.all([
      ReusableBlock.find(query)
        .populate('createdBy', 'name email')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      ReusableBlock.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: blocks,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching reusable blocks',
      error: error.message
    });
  }
};

// Create new reusable block
const createReusableBlock = async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      type,
      settings,
      tags = [],
      isPublic = false
    } = req.body;

    // Validate required fields
    if (!name || !type || !settings) {
      return res.status(400).json({
        success: false,
        message: 'Name, type, and settings are required'
      });
    }

    const reusableBlock = new ReusableBlock({
      name,
      description,
      category,
      type,
      settings,
      tags: Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()),
      isPublic,
      createdBy: req.user.id
    });

    await reusableBlock.save();

    res.status(201).json({
      success: true,
      data: reusableBlock
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating reusable block',
      error: error.message
    });
  }
};

// Get single reusable block
const getReusableBlockById = async (req, res) => {
  try {
    const { id } = req.params;

    const block = await ReusableBlock.findById(id)
      .populate('createdBy', 'name email');

    if (!block) {
      return res.status(404).json({
        success: false,
        message: 'Reusable block not found'
      });
    }

    // Check access permissions
    if (!block.isPublic && block.createdBy._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

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
};

// Update reusable block
const updateReusableBlock = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      category,
      settings,
      tags,
      isPublic
    } = req.body;

    const block = await ReusableBlock.findById(id);

    if (!block) {
      return res.status(404).json({
        success: false,
        message: 'Reusable block not found'
      });
    }

    // Check ownership
    if (block.createdBy.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own blocks'
      });
    }

    // Update fields
    if (name !== undefined) block.name = name;
    if (description !== undefined) block.description = description;
    if (category !== undefined) block.category = category;
    if (settings !== undefined) block.settings = settings;
    if (isPublic !== undefined) block.isPublic = isPublic;
    if (tags !== undefined) {
      block.tags = Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim());
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
};

// Delete reusable block
const deleteReusableBlock = async (req, res) => {
  try {
    const { id } = req.params;

    const block = await ReusableBlock.findById(id);

    if (!block) {
      return res.status(404).json({
        success: false,
        message: 'Reusable block not found'
      });
    }

    // Check ownership
    if (block.createdBy.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own blocks'
      });
    }

    await ReusableBlock.findByIdAndDelete(id);

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
};

// Increment usage count
const incrementUsage = async (req, res) => {
  try {
    const { id } = req.params;

    const block = await ReusableBlock.findById(id);

    if (!block) {
      return res.status(404).json({
        success: false,
        message: 'Reusable block not found'
      });
    }

    // Check access
    if (!block.isPublic && block.createdBy.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    await block.incrementUsage();

    res.status(200).json({
      success: true,
      data: block
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating usage count',
      error: error.message
    });
  }
};

// Get categories with counts
const getCategories = async (req, res) => {
  try {
    const query = {
      $or: [
        { isPublic: true },
        { createdBy: req.user.id }
      ]
    };

    const categories = await ReusableBlock.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalUsage: { $sum: '$usageCount' }
        }
      },
      {
        $project: {
          category: '$_id',
          count: 1,
          totalUsage: 1,
          _id: 0
        }
      },
      { $sort: { count: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: categories
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching categories',
      error: error.message
    });
  }
};

// Get popular tags
const getPopularTags = async (req, res) => {
  try {
    const query = {
      $or: [
        { isPublic: true },
        { createdBy: req.user.id }
      ]
    };

    const tags = await ReusableBlock.aggregate([
      { $match: query },
      { $unwind: '$tags' },
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 },
          totalUsage: { $sum: '$usageCount' }
        }
      },
      {
        $project: {
          tag: '$_id',
          count: 1,
          totalUsage: 1,
          _id: 0
        }
      },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ]);

    res.status(200).json({
      success: true,
      data: tags
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching tags',
      error: error.message
    });
  }
};

// Create block from section
const createBlockFromSection = async (req, res) => {
  try {
    const {
      sectionData,
      name,
      description,
      category,
      tags = [],
      isPublic = false
    } = req.body;

    if (!sectionData || !name) {
      return res.status(400).json({
        success: false,
        message: 'Section data and name are required'
      });
    }

    const reusableBlock = new ReusableBlock({
      name,
      description: description || `Reusable ${sectionData.type} section`,
      category: category || 'general',
      type: sectionData.type,
      settings: sectionData.settings || {},
      tags: Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim()),
      isPublic,
      createdBy: req.user.id
    });

    await reusableBlock.save();

    res.status(201).json({
      success: true,
      data: reusableBlock,
      message: 'Reusable block created from section'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Error creating reusable block from section',
      error: error.message
    });
  }
};

module.exports = {
  getReusableBlocks,
  createReusableBlock,
  getReusableBlockById,
  updateReusableBlock,
  deleteReusableBlock,
  incrementUsage,
  getCategories,
  getPopularTags,
  createBlockFromSection
};