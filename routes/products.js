const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { auth } = require('../middleware/auth');
const { validate } = require('../utils/validation');

// GET /api/products - Get all products with pagination and filtering
// Simple test endpoint
router.post('/test', async (req, res) => {
  console.log('TEST ENDPOINT HIT - Body:', req.body);
  res.json({ 
    success: true, 
    message: 'Test endpoint working', 
    receivedData: req.body 
  });
});

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 10, category, search, inStock } = req.query;
    const filter = {};
    
    if (category) filter.category = category;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    if (inStock !== undefined) filter.inStock = inStock === 'true';

    const products = await Product.find(filter)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Product.countDocuments(filter);
    
    res.json({
      success: true,
      data: products,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch products' });
  }
});

// GET /api/products/:id - Get single product
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }
    res.json({ success: true, data: product });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch product' });
  }
});

// POST /api/products - Create new product (admin only)
router.post('/', async (req, res) => {
  try {
    console.log('Raw product data from frontend:', JSON.stringify(req.body, null, 2));
    
    // Create product data with all required fields
    const productData = {
      name: req.body.name || 'Test Product',
      price: parseFloat(req.body.price) || 99.99,
      description: req.body.description || 'Test description',
      category: req.body.category || 'General',
      stock: parseInt(req.body.stock) || 0,
      // Generate SKU if not provided to avoid validation error
      sku: req.body.sku || `PRD-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
      images: req.body.images && req.body.images.length > 0 ? req.body.images : ['placeholder.jpg'],
      inStock: true
    };

    console.log('Creating product with data:', productData);
    const product = new Product(productData);
    console.log('Product instance created, now saving...');
    const savedProduct = await product.save();
    console.log('Product saved successfully:', savedProduct._id);
    
    res.status(201).json({ success: true, data: savedProduct });
  } catch (error) {
    console.error('Error creating product:', error);
    if (error.name === 'ValidationError') {
      const validationErrors = Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message
      }));
      return res.status(400).json({ 
        success: false, 
        error: 'Validation failed', 
        details: error.errors,
        validationErrors 
      });
    }
    if (error.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        error: 'SKU already exists. Please use a unique SKU.' 
      });
    }
    res.status(500).json({ success: false, error: 'Failed to create product' });
  }
});

// PUT /api/products/:id - Update product (admin only)
router.put('/:id', auth, validate(require('../utils/validation').schemas.product), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const updatedData = {
      ...req.body,
      updatedAt: new Date(),
      updatedBy: req.user.id
    };

    Object.assign(product, updatedData);
    await product.save();
    
    res.json({ success: true, data: product });
  } catch (error) {
    console.error('Error updating product:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        success: false, 
        error: 'Validation failed', 
        details: error.errors 
      });
    }
    res.status(500).json({ success: false, error: 'Failed to update product' });
  }
});

// DELETE /api/products/:id - Delete product (admin only)
router.delete('/:id', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ success: false, error: 'Failed to delete product' });
  }
});

// POST /api/products/bulk - Bulk operations (admin only)
router.post('/bulk', auth, async (req, res) => {
  try {
    const { action, productIds } = req.body;
    
    if (!action || !productIds || !Array.isArray(productIds)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Action and productIds array are required' 
      });
    }

    let result;
    switch (action) {
      case 'delete':
        result = await Product.deleteMany({ _id: { $in: productIds } });
        break;
      case 'updateStock':
        const { inStock } = req.body;
        result = await Product.updateMany(
          { _id: { $in: productIds } },
          { $set: { inStock, updatedAt: new Date() } }
        );
        break;
      case 'updateCategory':
        const { category } = req.body;
        result = await Product.updateMany(
          { _id: { $in: productIds } },
          { $set: { category, updatedAt: new Date() } }
        );
        break;
      default:
        return res.status(400).json({ success: false, error: 'Invalid action' });
    }

    res.json({ 
      success: true, 
      message: `Bulk ${action} completed`, 
      modifiedCount: result.modifiedCount || result.deletedCount 
    });
  } catch (error) {
    console.error('Error in bulk operation:', error);
    res.status(500).json({ success: false, error: 'Bulk operation failed' });
  }
});

module.exports = router;