const Testimonial = require('../models/Testimonial');
const Product = require('../models/Product');

// @desc    Get all testimonials
// @route   GET /api/admin/testimonials
// @access  Private/Admin
const getTestimonials = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const testimonials = await Testimonial.find()
      .sort({ order: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('productId', 'name')
      .lean();

    const total = await Testimonial.countDocuments();

    res.json({
      success: true,
      data: testimonials,
      pagination: {
        current: page,
        pages: Math.ceil(total / limit),
        total,
        limit
      }
    });
  } catch (error) {
    console.error('Get testimonials error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch testimonials'
    });
  }
};

// @desc    Get active testimonials for public display
// @route   GET /api/testimonials
// @access  Public
const getActiveTestimonials = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const testimonials = await Testimonial.getActiveTestimonials(limit);

    res.json({
      success: true,
      data: testimonials
    });
  } catch (error) {
    console.error('Get active testimonials error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch testimonials'
    });
  }
};

// @desc    Create new testimonial
// @route   POST /api/admin/testimonials
// @access  Private/Admin
const createTestimonial = async (req, res) => {
  try {
    const {
      customerName,
      reviewText,
      rating,
      avatarUrl,
      productId,
      customerEmail,
      order
    } = req.body;

    // Validate required fields
    if (!customerName || !reviewText || !rating) {
      return res.status(400).json({
        success: false,
        error: 'Customer name, review text, and rating are required'
      });
    }

    // Validate rating range
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        error: 'Rating must be between 1 and 5'
      });
    }

    // If productId provided, verify it exists
    if (productId) {
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(400).json({
          success: false,
          error: 'Product not found'
        });
      }
    }

    const testimonial = new Testimonial({
      customerName,
      reviewText,
      rating,
      avatarUrl,
      productId: productId || null,
      customerEmail,
      order: order || 0,
      source: 'admin'
    });

    await testimonial.save();
    await testimonial.populate('productId', 'name');

    res.status(201).json({
      success: true,
      data: testimonial,
      message: 'Testimonial created successfully'
    });
  } catch (error) {
    console.error('Create testimonial error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create testimonial'
    });
  }
};

// @desc    Update testimonial
// @route   PUT /api/admin/testimonials/:id
// @access  Private/Admin
const updateTestimonial = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Validate rating if provided
    if (updates.rating && (updates.rating < 1 || updates.rating > 5)) {
      return res.status(400).json({
        success: false,
        error: 'Rating must be between 1 and 5'
      });
    }

    // If productId provided, verify it exists
    if (updates.productId) {
      const product = await Product.findById(updates.productId);
      if (!product) {
        return res.status(400).json({
          success: false,
          error: 'Product not found'
        });
      }
    }

    const testimonial = await Testimonial.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    ).populate('productId', 'name');

    if (!testimonial) {
      return res.status(404).json({
        success: false,
        error: 'Testimonial not found'
      });
    }

    res.json({
      success: true,
      data: testimonial,
      message: 'Testimonial updated successfully'
    });
  } catch (error) {
    console.error('Update testimonial error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update testimonial'
    });
  }
};

// @desc    Delete testimonial
// @route   DELETE /api/admin/testimonials/:id
// @access  Private/Admin
const deleteTestimonial = async (req, res) => {
  try {
    const { id } = req.params;

    const testimonial = await Testimonial.findByIdAndDelete(id);

    if (!testimonial) {
      return res.status(404).json({
        success: false,
        error: 'Testimonial not found'
      });
    }

    res.json({
      success: true,
      message: 'Testimonial deleted successfully'
    });
  } catch (error) {
    console.error('Delete testimonial error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete testimonial'
    });
  }
};

// @desc    Toggle testimonial active status
// @route   PATCH /api/admin/testimonials/:id/toggle
// @access  Private/Admin
const toggleTestimonialStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const testimonial = await Testimonial.findById(id);
    if (!testimonial) {
      return res.status(404).json({
        success: false,
        error: 'Testimonial not found'
      });
    }

    testimonial.isActive = !testimonial.isActive;
    await testimonial.save();
    await testimonial.populate('productId', 'name');

    res.json({
      success: true,
      data: testimonial,
      message: `Testimonial ${testimonial.isActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Toggle testimonial status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle testimonial status'
    });
  }
};

// @desc    Update testimonials order
// @route   PUT /api/admin/testimonials/reorder
// @access  Private/Admin
const reorderTestimonials = async (req, res) => {
  try {
    const { testimonials } = req.body;

    if (!Array.isArray(testimonials)) {
      return res.status(400).json({
        success: false,
        error: 'Testimonials array is required'
      });
    }

    // Update order for each testimonial
    const updatePromises = testimonials.map((item, index) => 
      Testimonial.findByIdAndUpdate(
        item.id || item._id,
        { order: index },
        { new: true }
      )
    );

    await Promise.all(updatePromises);

    res.json({
      success: true,
      message: 'Testimonials reordered successfully'
    });
  } catch (error) {
    console.error('Reorder testimonials error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reorder testimonials'
    });
  }
};

module.exports = {
  getTestimonials,
  getActiveTestimonials,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
  toggleTestimonialStatus,
  reorderTestimonials
};