const express = require('express');
const router = express.Router();
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const { auth } = require('../middleware/auth');

// Get user's cart
router.get('/', auth, async (req, res) => {
  try {
    const cart = await Cart.findOrCreateByUserId(req.user._id);
    
    // Verify product data is still accurate
    const updatedItems = await Promise.all(
      cart.items.map(async (item) => {
        const product = await Product.findById(item.productId);
        if (product) {
          item.productData = {
            name: product.name,
            images: product.images,
            description: product.description,
            category: product.category,
            brand: product.brand,
            inStock: product.inStock,
            maxQuantity: product.stock
          };
          item.price = product.price;
          item.originalPrice = product.originalPrice;
          item.discount = product.discount;
        }
        return item;
      })
    );
    
    cart.items = updatedItems;
    cart.calculateTotals();
    await cart.save();
    
    res.json({
      success: true,
      data: cart
    });
  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cart'
    });
  }
});

// Add item to cart
router.post('/items', auth, async (req, res) => {
  try {
    const { productId, quantity = 1, size, color } = req.body;
    
    if (!productId) {
      return res.status(400).json({
        success: false,
        error: 'Product ID is required'
      });
    }
    
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }
    
    if (!product.inStock || product.stock < quantity) {
      return res.status(400).json({
        success: false,
        error: 'Insufficient stock'
      });
    }
    
    const cart = await Cart.findOrCreateByUserId(req.user._id);
    await cart.addItem(product, quantity, { size, color });
    
    res.json({
      success: true,
      data: cart,
      message: 'Item added to cart successfully'
    });
  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add item to cart'
    });
  }
});

// Update item quantity
router.put('/items/:productId', auth, async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity, size = null, color = null } = req.body;
    
    if (quantity < 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid quantity'
      });
    }
    
    // Check stock if increasing quantity
    if (quantity > 0) {
      const product = await Product.findById(productId);
      if (!product || !product.inStock || product.stock < quantity) {
        return res.status(400).json({
          success: false,
          error: 'Insufficient stock'
        });
      }
    }
    
    const cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        error: 'Cart not found'
      });
    }
    
    await cart.updateQuantity(productId, quantity, size, color);
    
    res.json({
      success: true,
      data: cart,
      message: 'Cart updated successfully'
    });
  } catch (error) {
    console.error('Update cart error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update cart'
    });
  }
});

// Remove item from cart
router.delete('/items/:productId', auth, async (req, res) => {
  try {
    const { productId } = req.params;
    const { size = null, color = null } = req.query;
    
    const cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        error: 'Cart not found'
      });
    }
    
    await cart.removeItem(productId, size, color);
    
    res.json({
      success: true,
      data: cart,
      message: 'Item removed from cart'
    });
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove item from cart'
    });
  }
});

// Clear entire cart
router.delete('/', auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        error: 'Cart not found'
      });
    }
    
    await cart.clearCart();
    
    res.json({
      success: true,
      data: cart,
      message: 'Cart cleared successfully'
    });
  } catch (error) {
    console.error('Clear cart error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear cart'
    });
  }
});

// Apply coupon
router.post('/coupon', auth, async (req, res) => {
  try {
    const { couponCode } = req.body;
    
    if (!couponCode) {
      return res.status(400).json({
        success: false,
        error: 'Coupon code is required'
      });
    }
    
    const cart = await Cart.findOne({ userId: req.user._id });
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Cart is empty'
      });
    }
    
    const { coupon, discountAmount, error } = await Coupon.findValidCoupon(
      couponCode,
      req.user._id,
      cart.subtotal,
      cart.items
    );
    
    if (error) {
      return res.status(400).json({
        success: false,
        error
      });
    }
    
    await cart.applyCoupon(coupon.code, discountAmount, coupon.discountType);
    
    res.json({
      success: true,
      data: cart,
      message: 'Coupon applied successfully'
    });
  } catch (error) {
    console.error('Apply coupon error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to apply coupon'
    });
  }
});

// Remove coupon
router.delete('/coupon/:code', auth, async (req, res) => {
  try {
    const { code } = req.params;
    
    const cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        error: 'Cart not found'
      });
    }
    
    await cart.removeCoupon(code);
    
    res.json({
      success: true,
      data: cart,
      message: 'Coupon removed successfully'
    });
  } catch (error) {
    console.error('Remove coupon error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove coupon'
    });
  }
});

// Update shipping address
router.put('/shipping-address', auth, async (req, res) => {
  try {
    const { shippingAddress } = req.body;
    
    if (!shippingAddress) {
      return res.status(400).json({
        success: false,
        error: 'Shipping address is required'
      });
    }
    
    const cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        error: 'Cart not found'
      });
    }
    
    cart.shippingAddress = shippingAddress;
    cart.lastActivity = new Date();
    await cart.save();
    
    res.json({
      success: true,
      data: cart,
      message: 'Shipping address updated successfully'
    });
  } catch (error) {
    console.error('Update shipping address error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update shipping address'
    });
  }
});

// Get cart summary (minimal data for header display)
router.get('/summary', auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user._id }).select('totalItems subtotal estimatedTotal');
    
    if (!cart) {
      return res.json({
        success: true,
        data: {
          totalItems: 0,
          subtotal: 0,
          estimatedTotal: 0
        }
      });
    }
    
    res.json({
      success: true,
      data: {
        totalItems: cart.totalItems,
        subtotal: cart.subtotal,
        estimatedTotal: cart.estimatedTotal
      }
    });
  } catch (error) {
    console.error('Get cart summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cart summary'
    });
  }
});

// Sync cart with updated product prices
router.post('/sync', auth, async (req, res) => {
  try {
    const cart = await Cart.findOne({ userId: req.user._id });
    if (!cart) {
      return res.status(404).json({
        success: false,
        error: 'Cart not found'
      });
    }
    
    let hasChanges = false;
    const updatedItems = [];
    
    for (const item of cart.items) {
      const product = await Product.findById(item.productId);
      
      if (!product) {
        // Product no longer exists, remove from cart
        hasChanges = true;
        continue;
      }
      
      if (!product.inStock || product.stock < item.quantity) {
        // Update quantity to available stock
        item.quantity = Math.max(0, product.stock);
        hasChanges = true;
      }
      
      if (item.price !== product.price) {
        // Update price
        item.price = product.price;
        item.originalPrice = product.originalPrice;
        item.discount = product.discount;
        hasChanges = true;
      }
      
      // Update product data
      item.productData = {
        name: product.name,
        images: product.images,
        description: product.description,
        category: product.category,
        brand: product.brand,
        inStock: product.inStock,
        maxQuantity: product.stock
      };
      
      if (item.quantity > 0) {
        updatedItems.push(item);
      }
    }
    
    if (hasChanges) {
      cart.items = updatedItems;
      cart.calculateTotals();
      await cart.save();
    }
    
    res.json({
      success: true,
      data: cart,
      hasChanges,
      message: hasChanges ? 'Cart has been updated with latest product information' : 'Cart is up to date'
    });
  } catch (error) {
    console.error('Sync cart error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync cart'
    });
  }
});

module.exports = router;