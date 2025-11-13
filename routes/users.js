const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Order = require('../models/Order');
const { auth } = require('../middleware/auth');
const { adminAuth, requireRole } = require('../middleware/adminAuth');
const { validate } = require('../utils/validation');

// Get User Profile
router.get('/profile', auth, async (req, res) => {
  try {
    console.log('🔍 Get Profile - User ID from auth:', req.user.userId);
    // Use req.userId for consistency (it's the ObjectId from auth middleware)
    const user = await User.findById(req.userId).select('-password -refreshTokens');
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    // Get user statistics
    const orderStats = await Order.aggregate([
      { $match: { userId: user._id } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$totalAmount' },
          avgOrderValue: { $avg: '$totalAmount' }
        }
      }
    ]);

    const userProfile = {
      ...user.toObject(),
      stats: orderStats[0] || {
        totalOrders: 0,
        totalSpent: 0,
        avgOrderValue: 0
      }
    };

    res.json({ 
      success: true, 
      user: userProfile 
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Update User Profile
router.put('/profile', auth, validate(require('../utils/validation').schemas.profileUpdate), async (req, res) => {
  try {
    console.log('🔍 Profile Update - User ID from auth:', req.user.userId);
    console.log('🔍 Profile Update - Request body:', req.body);
    
    // Use consistent user ID (req.userId is the ObjectId from auth middleware)
    const user = await User.findById(req.userId);
    if (!user) {
      console.error('❌ User not found in database for userId:', req.userId);
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }
    
    console.log('✅ Found user for profile update:', { id: user._id, name: user.name, email: user.email });

    const { name, phone, address, preferences } = req.body;

    // Update basic info
    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (address) {
      user.address = { ...user.address, ...address };
    }
    if (preferences) {
      user.preferences = { ...user.preferences, ...preferences };
    }

    const updatedUser = await user.save();
    console.log('✅ Profile updated successfully for user:', user._id);
    
    // Return clean user object without sensitive data
    const responseUser = {
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      phone: updatedUser.phone,
      address: updatedUser.address,
      preferences: updatedUser.preferences,
      avatar: updatedUser.avatar,
      createdAt: updatedUser.createdAt,
      role: updatedUser.role,
      isActive: updatedUser.isActive
    };
    
    res.json({ 
      success: true, 
      message: 'Profile updated successfully', 
      user: responseUser 
    });
  } catch (error) {
    console.error('Update profile error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: Object.values(error.errors).map(e => e.message)
      });
    }
    res.status(500).json({ 
      success: false, 
      error: 'Server error' 
    });
  }
});

// Upload Avatar
router.post('/profile/avatar', auth, async (req, res) => {
  try {
    const { avatarUrl } = req.body;

    if (!avatarUrl) {
      return res.status(400).json({
        success: false,
        error: 'Avatar URL is required'
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    user.avatar = avatarUrl;
    await user.save();

    res.json({
      success: true,
      message: 'Avatar updated successfully',
      avatarUrl: user.avatar
    });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Delete User Account
router.delete('/profile', auth, async (req, res) => {
  try {
    const { password } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Verify password for local accounts
    if (user.authProvider === 'local' && user.password) {
      if (!password) {
        return res.status(400).json({
          success: false,
          error: 'Password is required to delete account'
        });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          error: 'Invalid password'
        });
      }
    }

    // Soft delete - deactivate account instead of hard delete
    user.isActive = false;
    user.email = `deleted_${Date.now()}_${user.email}`;
    user.refreshTokens = [];
    await user.save();

    res.json({
      success: true,
      message: 'Account deactivated successfully'
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
});

// Get User Orders
router.get('/orders', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const filter = { userId: req.user._id };
    
    if (status) filter.status = status;

    const orders = await Order.find(filter)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 })
      .populate('items.productId', 'name images price');

    const total = await Order.countDocuments(filter);

    res.json({
      success: true,
      data: orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get user orders error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch orders'
    });
  }
});

// Admin Routes
// Get All Users (Admin only)
router.get('/', adminAuth, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      role, 
      isActive, 
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const users = await User.find(filter)
      .select('-password -refreshTokens -resetPasswordOtp -emailVerificationToken')
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort(sort);

    const total = await User.countDocuments(filter);

    res.json({
      success: true,
      data: users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users'
    });
  }
});

// Get User by ID (Admin only)
router.get('/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -refreshTokens -resetPasswordOtp -emailVerificationToken');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Get user order statistics
    const orderStats = await Order.aggregate([
      { $match: { userId: user._id } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalSpent: { $sum: '$totalAmount' },
          avgOrderValue: { $avg: '$totalAmount' },
          lastOrderDate: { $max: '$createdAt' }
        }
      }
    ]);

    const userData = {
      ...user.toObject(),
      stats: orderStats[0] || {
        totalOrders: 0,
        totalSpent: 0,
        avgOrderValue: 0,
        lastOrderDate: null
      }
    };

    res.json({
      success: true,
      data: userData
    });
  } catch (error) {
    console.error('❌ Get user error:', error);
    console.error('❌ Auth details:', { userId: req.userId, userFromToken: req.user });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user'
    });
  }
});

// Update User Role (Admin only)
router.patch('/:id/role', requireRole(['admin', 'super_admin']), async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!['customer', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid role'
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Prevent demoting the last super admin
    if (user.role === 'super_admin' && role !== 'super_admin') {
      const superAdminCount = await User.countDocuments({ role: 'super_admin' });
      if (superAdminCount <= 1) {
        return res.status(400).json({
          success: false,
          error: 'Cannot demote the last super admin'
        });
      }
    }

    user.role = role;
    await user.save();

    res.json({
      success: true,
      message: 'User role updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('❌ Update profile error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      userId: req.userId,
      userFromAuth: req.user,
      requestBody: req.body
    });
    res.status(500).json({
      success: false,
      error: 'Failed to update profile',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Activate/Deactivate User (Admin only)
router.patch('/:id/status', adminAuth, async (req, res) => {
  try {
    const { isActive } = req.body;
    
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    user.isActive = isActive;
    await user.save();

    res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isActive: user.isActive
      }
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user status'
    });
  }
});

// Delete User (Admin only - hard delete)
router.delete('/:id', requireRole(['super_admin']), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Prevent deleting super admins
    if (user.role === 'super_admin') {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete super admin users'
      });
    }

    await User.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user'
    });
  }
});

module.exports = router;