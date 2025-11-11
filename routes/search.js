const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Category = require('../models/Category');
const { optionalAuth } = require('../middleware/auth');

// Advanced product search with filters
router.get('/products', optionalAuth, async (req, res) => {
  try {
    const {
      q = '', // search query
      category,
      minPrice,
      maxPrice,
      brand,
      rating,
      inStock,
      featured,
      sortBy = 'relevance',
      sortOrder = 'desc',
      page = 1,
      limit = 20,
      sizes,
      colors,
      tags,
      discount
    } = req.query;

    // Build search filter
    const filter = { isActive: true };
    const sort = {};

    // Text search
    if (q.trim()) {
      filter.$text = { $search: q };
    }

    // Category filter
    if (category) {
      if (Array.isArray(category)) {
        filter.category = { $in: category };
      } else {
        filter.category = category;
      }
    }

    // Price range filter
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseFloat(minPrice);
      if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }

    // Brand filter
    if (brand) {
      if (Array.isArray(brand)) {
        filter.brand = { $in: brand };
      } else {
        filter.brand = brand;
      }
    }

    // Rating filter
    if (rating) {
      filter.averageRating = { $gte: parseFloat(rating) };
    }

    // Stock filter
    if (inStock !== undefined) {
      if (inStock === 'true') {
        filter.stock = { $gt: 0 };
        filter.inStock = true;
      } else {
        filter.stock = 0;
      }
    }

    // Featured filter
    if (featured !== undefined) {
      filter.featured = featured === 'true';
    }

    // Size filter
    if (sizes) {
      const sizeArray = Array.isArray(sizes) ? sizes : [sizes];
      filter.sizes = { $in: sizeArray };
    }

    // Color filter
    if (colors) {
      const colorArray = Array.isArray(colors) ? colors : [colors];
      filter.colors = { $in: colorArray };
    }

    // Tags filter
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      filter.tags = { $in: tagArray };
    }

    // Discount filter
    if (discount) {
      filter.discount = { $gte: parseFloat(discount) };
    }

    // Sorting
    if (q.trim() && sortBy === 'relevance') {
      sort.score = { $meta: 'textScore' };
    } else {
      switch (sortBy) {
        case 'price':
          sort.price = sortOrder === 'desc' ? -1 : 1;
          break;
        case 'rating':
          sort.averageRating = sortOrder === 'desc' ? -1 : 1;
          break;
        case 'popularity':
          sort.totalSales = sortOrder === 'desc' ? -1 : 1;
          break;
        case 'newest':
          sort.createdAt = -1;
          break;
        case 'discount':
          sort.discount = sortOrder === 'desc' ? -1 : 1;
          break;
        default:
          sort.createdAt = sortOrder === 'desc' ? -1 : 1;
      }
    }

    // Execute search
    const products = await Product.find(filter)
      .select('name price originalPrice discount images description category brand averageRating totalReviews stock inStock featured tags sizes colors')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Product.countDocuments(filter);

    // Get search facets for filtering UI
    const facets = await Product.aggregate([
      { $match: filter },
      {
        $facet: {
          categories: [
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          brands: [
            { $group: { _id: '$brand', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          priceRanges: [
            {
              $group: {
                _id: null,
                minPrice: { $min: '$price' },
                maxPrice: { $max: '$price' },
                avgPrice: { $avg: '$price' }
              }
            }
          ],
          sizes: [
            { $unwind: '$sizes' },
            { $group: { _id: '$sizes', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          colors: [
            { $unwind: '$colors' },
            { $group: { _id: '$colors', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ]
        }
      }
    ]);

    res.json({
      success: true,
      data: products,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      facets: facets[0] || {},
      searchInfo: {
        query: q,
        resultsFound: total,
        searchTime: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Product search error:', error);
    res.status(500).json({
      success: false,
      error: 'Search failed'
    });
  }
});

// Get search suggestions
router.get('/suggestions', async (req, res) => {
  try {
    const { q = '', limit = 10 } = req.query;

    if (!q.trim()) {
      return res.json({
        success: true,
        data: []
      });
    }

    // Get product name suggestions
    const productSuggestions = await Product.find({
      name: { $regex: q, $options: 'i' },
      isActive: true
    })
    .select('name category')
    .limit(limit)
    .sort({ totalSales: -1 });

    // Get category suggestions
    const categorySuggestions = await Category.find({
      name: { $regex: q, $options: 'i' },
      isActive: true
    })
    .select('name slug')
    .limit(5);

    // Get brand suggestions
    const brandSuggestions = await Product.aggregate([
      { $match: { brand: { $regex: q, $options: 'i' }, isActive: true } },
      { $group: { _id: '$brand', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    const suggestions = [
      ...productSuggestions.map(p => ({ type: 'product', name: p.name, category: p.category })),
      ...categorySuggestions.map(c => ({ type: 'category', name: c.name, slug: c.slug })),
      ...brandSuggestions.map(b => ({ type: 'brand', name: b._id }))
    ];

    res.json({
      success: true,
      data: suggestions.slice(0, limit)
    });
  } catch (error) {
    console.error('Search suggestions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get suggestions'
    });
  }
});

// Get search filters/facets
router.get('/filters', async (req, res) => {
  try {
    const { category } = req.query;
    const matchStage = { isActive: true };
    
    if (category) {
      matchStage.category = category;
    }

    const filters = await Product.aggregate([
      { $match: matchStage },
      {
        $facet: {
          categories: [
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          brands: [
            { $match: { brand: { $ne: null, $ne: '' } } },
            { $group: { _id: '$brand', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          priceRange: [
            {
              $group: {
                _id: null,
                minPrice: { $min: '$price' },
                maxPrice: { $max: '$price' }
              }
            }
          ],
          ratings: [
            { $match: { averageRating: { $gte: 1 } } },
            {
              $group: {
                _id: { $floor: '$averageRating' },
                count: { $sum: 1 }
              }
            },
            { $sort: { _id: -1 } }
          ],
          sizes: [
            { $unwind: '$sizes' },
            { $group: { _id: '$sizes', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          colors: [
            { $unwind: '$colors' },
            { $group: { _id: '$colors', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
          ],
          availability: [
            {
              $group: {
                _id: null,
                inStock: { $sum: { $cond: [{ $gt: ['$stock', 0] }, 1, 0] } },
                outOfStock: { $sum: { $cond: [{ $eq: ['$stock', 0] }, 1, 0] } }
              }
            }
          ]
        }
      }
    ]);

    res.json({
      success: true,
      data: filters[0] || {}
    });
  } catch (error) {
    console.error('Get search filters error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get search filters'
    });
  }
});

// Similar products (recommendation)
router.get('/similar/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { limit = 8 } = req.query;

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found'
      });
    }

    // Find similar products based on category, brand, price range, and tags
    const priceRange = product.price * 0.3; // 30% price variation
    
    const similarProducts = await Product.find({
      _id: { $ne: productId },
      isActive: true,
      $or: [
        { category: product.category },
        { brand: product.brand },
        { tags: { $in: product.tags || [] } },
        { 
          price: { 
            $gte: product.price - priceRange, 
            $lte: product.price + priceRange 
          } 
        }
      ]
    })
    .select('name price originalPrice discount images category brand averageRating totalReviews')
    .limit(parseInt(limit))
    .sort({ averageRating: -1, totalSales: -1 });

    res.json({
      success: true,
      data: similarProducts
    });
  } catch (error) {
    console.error('Similar products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get similar products'
    });
  }
});

// Recently viewed products (for logged-in users)
router.get('/recent', optionalAuth, async (req, res) => {
  try {
    if (!req.user) {
      return res.json({
        success: true,
        data: []
      });
    }

    // This would typically come from a user activity collection
    // For now, return empty array or implement based on your user activity tracking
    res.json({
      success: true,
      data: []
    });
  } catch (error) {
    console.error('Recent products error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get recent products'
    });
  }
});

// Track search query (for analytics)
router.post('/track', optionalAuth, async (req, res) => {
  try {
    const { query, resultCount, filters } = req.body;

    // In a real application, you would store this in a search analytics collection
    console.log('Search tracked:', {
      userId: req.user?._id,
      query,
      resultCount,
      filters,
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: 'Search tracked successfully'
    });
  } catch (error) {
    console.error('Track search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track search'
    });
  }
});

// Get popular searches
router.get('/popular', async (req, res) => {
  try {
    // This could be implemented with a SearchHistory model
    // For now, return static popular searches
    const popularSearches = [
      'casual shirt',
      'formal wear',
      'jeans',
      'sneakers',
      'accessories',
      'winter wear',
      'summer collection',
      'ethnic wear'
    ];

    res.json({
      success: true,
      data: popularSearches
    });
  } catch (error) {
    console.error('Popular searches error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get popular searches'
    });
  }
});

module.exports = router;