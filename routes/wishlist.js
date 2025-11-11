const express = require('express');
const router = express.Router();
const Wishlist = require('../models/Wishlist');
const { auth } = require('../middleware/auth');

// Get user's wishlist
router.get('/', auth, async (req, res) => {
  try {
    const wishlist = await Wishlist.findOrCreateByUserId(req.user.userId);
    res.json({
      success: true,
      wishlist: {
        items: wishlist.items,
        itemCount: wishlist.items.length,
        itemIds: wishlist.getItemIds(),
        updatedAt: wishlist.updatedAt
      }
    });
  } catch (error) {
    console.error('Get wishlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch wishlist',
      error: error.message
    });
  }
});

// Add item to wishlist
router.post('/add', auth, async (req, res) => {
  try {
    const { productId, productData } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        message: 'Product ID is required'
      });
    }

    const wishlist = await Wishlist.findOrCreateByUserId(req.user.userId);
    await wishlist.addItem(productId, productData);

    res.json({
      success: true,
      message: 'Item added to wishlist',
      wishlist: {
        items: wishlist.items,
        itemCount: wishlist.items.length,
        itemIds: wishlist.getItemIds()
      }
    });
  } catch (error) {
    console.error('Add to wishlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add item to wishlist',
      error: error.message
    });
  }
});

// Remove item from wishlist
router.delete('/remove/:productId', auth, async (req, res) => {
  try {
    const { productId } = req.params;

    const wishlist = await Wishlist.findOrCreateByUserId(req.user.userId);
    await wishlist.removeItem(productId);

    res.json({
      success: true,
      message: 'Item removed from wishlist',
      wishlist: {
        items: wishlist.items,
        itemCount: wishlist.items.length,
        itemIds: wishlist.getItemIds()
      }
    });
  } catch (error) {
    console.error('Remove from wishlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove item from wishlist',
      error: error.message
    });
  }
});

// Clear entire wishlist
router.delete('/clear', auth, async (req, res) => {
  try {
    const wishlist = await Wishlist.findOrCreateByUserId(req.user.userId);
    await wishlist.clearAll();

    res.json({
      success: true,
      message: 'Wishlist cleared',
      wishlist: {
        items: [],
        itemCount: 0,
        itemIds: []
      }
    });
  } catch (error) {
    console.error('Clear wishlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear wishlist',
      error: error.message
    });
  }
});

// Check if item is in wishlist
router.get('/check/:productId', auth, async (req, res) => {
  try {
    const { productId } = req.params;
    const wishlist = await Wishlist.findOrCreateByUserId(req.user.userId);
    
    const isInWishlist = wishlist.getItemIds().includes(productId);
    
    res.json({
      success: true,
      isInWishlist,
      productId
    });
  } catch (error) {
    console.error('Check wishlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check wishlist status',
      error: error.message
    });
  }
});

// Sync local wishlist with backend (for migration purposes)
router.post('/sync', auth, async (req, res) => {
  try {
    const { localWishlistIds, products } = req.body;

    if (!Array.isArray(localWishlistIds)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid wishlist data'
      });
    }

    const wishlist = await Wishlist.findOrCreateByUserId(req.user.userId);
    
    // Clear existing items and add from local storage
    wishlist.items = [];
    
    for (const productId of localWishlistIds) {
      const productData = products?.find(p => p.id.toString() === productId.toString());
      await wishlist.addItem(productId.toString(), productData || {});
    }

    res.json({
      success: true,
      message: 'Wishlist synced successfully',
      wishlist: {
        items: wishlist.items,
        itemCount: wishlist.items.length,
        itemIds: wishlist.getItemIds()
      }
    });
  } catch (error) {
    console.error('Sync wishlist error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync wishlist',
      error: error.message
    });
  }
});

// Get wishlist statistics
router.get('/stats', auth, async (req, res) => {
  try {
    const wishlist = await Wishlist.findOrCreateByUserId(req.user.userId);
    
    const stats = {
      totalItems: wishlist.items.length,
      categoryCounts: {},
      totalValue: 0,
      averagePrice: 0,
      oldestItem: null,
      newestItem: null
    };

    if (wishlist.items.length > 0) {
      // Calculate category counts and total value
      wishlist.items.forEach(item => {
        const category = item.productData?.category || 'Uncategorized';
        stats.categoryCounts[category] = (stats.categoryCounts[category] || 0) + 1;
        stats.totalValue += item.productData?.price || 0;
      });

      stats.averagePrice = stats.totalValue / wishlist.items.length;

      // Find oldest and newest items
      const sortedByDate = [...wishlist.items].sort((a, b) => new Date(a.addedAt) - new Date(b.addedAt));
      stats.oldestItem = sortedByDate[0];
      stats.newestItem = sortedByDate[sortedByDate.length - 1];
    }

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Get wishlist stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get wishlist statistics',
      error: error.message
    });
  }
});

module.exports = router;