const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const Product = require('../models/Product');
const { adminAuth } = require('../middleware/adminAuth');
const { validate } = require('../utils/validation');

// Get all categories (with hierarchy)
router.get('/', async (req, res) => {
  try {
    const { includeInactive = false, flat = false } = req.query;
    
    const filter = {};
    if (!includeInactive) filter.isActive = true;
    
    let categories;
    
    if (flat === 'true') {
      // Return flat list of categories
      categories = await Category.find(filter)
        .select('name slug description image icon parentCategory isActive sortOrder productCount')
        .sort('sortOrder name');
    } else {
      // Return hierarchical structure
      categories = await Category.getHierarchy();
    }

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch categories'
    });
  }
});

// Get category by ID or slug
router.get('/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    
    // Try to find by ID first, then by slug
    let category = await Category.findById(identifier).populate('subcategories');
    if (!category) {
      category = await Category.findOne({ slug: identifier }).populate('subcategories');
    }
    
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }
    
    // Get products in this category
    const products = await Product.find({ 
      category: category.name,
      isActive: true 
    }).limit(12);
    
    res.json({
      success: true,
      data: {
        ...category.toObject(),
        products
      }
    });
  } catch (error) {
    console.error('Get category error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category'
    });
  }
});

// Create category (Admin only)
router.post('/', adminAuth, validate(require('../utils/validation').schemas.category), async (req, res) => {
  try {
    const categoryData = req.body;
    
    // Check if category with same name exists
    const existingCategory = await Category.findOne({ 
      name: { $regex: new RegExp(`^${categoryData.name}$`, 'i') }
    });
    
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        error: 'Category with this name already exists'
      });
    }
    
    const category = new Category(categoryData);
    await category.save();
    
    // If this is a subcategory, add it to parent's subcategories array
    if (category.parentCategory) {
      await Category.findByIdAndUpdate(
        category.parentCategory,
        { $push: { subcategories: category._id } }
      );
    }
    
    res.status(201).json({
      success: true,
      data: category,
      message: 'Category created successfully'
    });
  } catch (error) {
    console.error('Create category error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: Object.values(error.errors).map(e => e.message)
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to create category'
    });
  }
});

// Update category (Admin only)
router.put('/:id', adminAuth, validate(require('../utils/validation').schemas.category), async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }
    
    const updateData = req.body;
    
    // Check if new name conflicts with existing category
    if (updateData.name && updateData.name !== category.name) {
      const existingCategory = await Category.findOne({
        name: { $regex: new RegExp(`^${updateData.name}$`, 'i') },
        _id: { $ne: category._id }
      });
      
      if (existingCategory) {
        return res.status(400).json({
          success: false,
          error: 'Category with this name already exists'
        });
      }
    }
    
    // Handle parent category changes
    if (updateData.parentCategory !== category.parentCategory) {
      // Remove from old parent
      if (category.parentCategory) {
        await Category.findByIdAndUpdate(
          category.parentCategory,
          { $pull: { subcategories: category._id } }
        );
      }
      
      // Add to new parent
      if (updateData.parentCategory) {
        await Category.findByIdAndUpdate(
          updateData.parentCategory,
          { $push: { subcategories: category._id } }
        );
      }
    }
    
    Object.assign(category, updateData);
    await category.save();
    
    res.json({
      success: true,
      data: category,
      message: 'Category updated successfully'
    });
  } catch (error) {
    console.error('Update category error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: Object.values(error.errors).map(e => e.message)
      });
    }
    res.status(500).json({
      success: false,
      error: 'Failed to update category'
    });
  }
});

// Delete category (Admin only)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }
    
    // Check if category has products
    const productCount = await Product.countDocuments({ category: category.name });
    if (productCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete category with ${productCount} products. Please reassign or delete the products first.`
      });
    }
    
    // Check if category has subcategories
    if (category.subcategories && category.subcategories.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete category with subcategories. Please delete or reassign subcategories first.'
      });
    }
    
    // Remove from parent category if applicable
    if (category.parentCategory) {
      await Category.findByIdAndUpdate(
        category.parentCategory,
        { $pull: { subcategories: category._id } }
      );
    }
    
    await Category.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    console.error('Delete category error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete category'
    });
  }
});

// Update category product count (Admin only)
router.patch('/:id/update-count', adminAuth, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }
    
    await category.updateProductCount();
    
    res.json({
      success: true,
      data: {
        categoryId: category._id,
        productCount: category.productCount
      },
      message: 'Product count updated successfully'
    });
  } catch (error) {
    console.error('Update category count error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update product count'
    });
  }
});

// Reorder categories (Admin only)
router.post('/reorder', adminAuth, async (req, res) => {
  try {
    const { categoryOrders } = req.body; // Array of { id, sortOrder }
    
    if (!Array.isArray(categoryOrders)) {
      return res.status(400).json({
        success: false,
        error: 'categoryOrders must be an array'
      });
    }
    
    const updatePromises = categoryOrders.map(({ id, sortOrder }) =>
      Category.findByIdAndUpdate(id, { sortOrder })
    );
    
    await Promise.all(updatePromises);
    
    res.json({
      success: true,
      message: 'Categories reordered successfully'
    });
  } catch (error) {
    console.error('Reorder categories error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reorder categories'
    });
  }
});

// Get category statistics (Admin only)
router.get('/:id/stats', adminAuth, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }
    
    // Get detailed statistics
    const stats = await Product.aggregate([
      { $match: { category: category.name } },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          activeProducts: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
          },
          inactiveProducts: {
            $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] }
          },
          totalStock: { $sum: '$stock' },
          avgPrice: { $avg: '$price' },
          minPrice: { $min: '$price' },
          maxPrice: { $max: '$price' }
        }
      }
    ]);
    
    const categoryStats = stats[0] || {
      totalProducts: 0,
      activeProducts: 0,
      inactiveProducts: 0,
      totalStock: 0,
      avgPrice: 0,
      minPrice: 0,
      maxPrice: 0
    };
    
    res.json({
      success: true,
      data: {
        category: category.name,
        ...categoryStats
      }
    });
  } catch (error) {
    console.error('Get category stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch category statistics'
    });
  }
});

module.exports = router;