const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');
const { notifyUser, notifyAdmins } = require('../utils/socket');

// Get user notifications
router.get('/', auth, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      type, 
      isRead, 
      priority 
    } = req.query;

    const filter = { 
      userId: req.user.userId,
      isArchived: false
    };
    
    if (type) filter.type = type;
    if (isRead !== undefined) filter.isRead = isRead === 'true';
    if (priority) filter.priority = priority;

    const notifications = await Notification.find(filter)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .sort({ createdAt: -1 });

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.getUnreadCount(req.user._id);

    res.json({
      success: true,
      data: notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      unreadCount
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notifications'
    });
  }
});

// Get unread notification count
router.get('/unread-count', auth, async (req, res) => {
  try {
    const count = await Notification.getUnreadCount(req.user._id);
    
    res.json({
      success: true,
      data: { count }
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get unread count'
    });
  }
});

// Mark notification as read
router.patch('/:id/read', auth, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    await notification.markAsRead();
    const unreadCount = await Notification.getUnreadCount(req.user._id);

    res.json({
      success: true,
      data: notification,
      unreadCount
    });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notification as read'
    });
  }
});

// Mark all notifications as read
router.patch('/mark-all-read', auth, async (req, res) => {
  try {
    await Notification.markAllAsRead(req.user._id);
    
    res.json({
      success: true,
      message: 'All notifications marked as read',
      unreadCount: 0
    });
  } catch (error) {
    console.error('Mark all as read error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark all notifications as read'
    });
  }
});

// Archive notification
router.patch('/:id/archive', auth, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    await notification.archive();

    res.json({
      success: true,
      data: notification,
      message: 'Notification archived'
    });
  } catch (error) {
    console.error('Archive notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to archive notification'
    });
  }
});

// Delete notification
router.delete('/:id', auth, async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete notification'
    });
  }
});

// Get notification preferences
router.get('/preferences', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(req.user._id).select('preferences.notifications');

    res.json({
      success: true,
      data: user.preferences.notifications
    });
  } catch (error) {
    console.error('Get notification preferences error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get notification preferences'
    });
  }
});

// Update notification preferences
router.put('/preferences', auth, async (req, res) => {
  try {
    const { email, sms, push } = req.body;
    const User = require('../models/User');
    
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    user.preferences.notifications = {
      email: email !== undefined ? email : user.preferences.notifications.email,
      sms: sms !== undefined ? sms : user.preferences.notifications.sms,
      push: push !== undefined ? push : user.preferences.notifications.push
    };

    await user.save();

    res.json({
      success: true,
      data: user.preferences.notifications,
      message: 'Notification preferences updated'
    });
  } catch (error) {
    console.error('Update notification preferences error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update notification preferences'
    });
  }
});

// Admin: Send notification to user
router.post('/send', adminAuth, async (req, res) => {
  try {
    const { userId, type, title, message, priority = 'normal', data = {} } = req.body;

    if (!userId || !title || !message) {
      return res.status(400).json({
        success: false,
        error: 'userId, title, and message are required'
      });
    }

    const notification = await Notification.createNotification({
      userId,
      type: type || 'system',
      title,
      message,
      priority,
      data,
      metadata: {
        source: 'admin',
        sentBy: req.user._id
      }
    });

    res.json({
      success: true,
      data: notification,
      message: 'Notification sent successfully'
    });
  } catch (error) {
    console.error('Send notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send notification'
    });
  }
});

// Admin: Broadcast notification to all users
router.post('/broadcast', adminAuth, async (req, res) => {
  try {
    const { type, title, message, priority = 'normal', userFilter = {} } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        error: 'title and message are required'
      });
    }

    const User = require('../models/User');
    
    // Get users based on filter
    const filter = { isActive: true, ...userFilter };
    const users = await User.find(filter).select('_id');

    // Create notifications for all users
    const notifications = users.map(user => ({
      userId: user._id,
      type: type || 'promotional',
      title,
      message,
      priority,
      metadata: {
        source: 'admin_broadcast',
        sentBy: req.user._id
      }
    }));

    await Notification.insertMany(notifications);

    // Send real-time notifications
    users.forEach(user => {
      notifyUser(user._id.toString(), 'notification', {
        type: type || 'promotional',
        title,
        message,
        priority,
        createdAt: new Date()
      });
    });

    res.json({
      success: true,
      message: `Broadcast sent to ${users.length} users`,
      sentTo: users.length
    });
  } catch (error) {
    console.error('Broadcast notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to broadcast notification'
    });
  }
});

// Admin: Get notification analytics
router.get('/analytics', adminAuth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const matchStage = {};

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    const [typeStats, priorityStats, readStats] = await Promise.all([
      // Notifications by type
      Notification.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            readCount: { $sum: { $cond: ['$isRead', 1, 0] } }
          }
        },
        { $sort: { count: -1 } }
      ]),

      // Notifications by priority
      Notification.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$priority',
            count: { $sum: 1 }
          }
        }
      ]),

      // Read vs unread statistics
      Notification.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            read: { $sum: { $cond: ['$isRead', 1, 0] } },
            unread: { $sum: { $cond: ['$isRead', 0, 1] } },
            archived: { $sum: { $cond: ['$isArchived', 1, 0] } }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      data: {
        byType: typeStats,
        byPriority: priorityStats,
        readStats: readStats[0] || { total: 0, read: 0, unread: 0, archived: 0 }
      }
    });
  } catch (error) {
    console.error('Notification analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notification analytics'
    });
  }
});

// Test notification endpoint (development only)
if (process.env.NODE_ENV === 'development') {
  router.post('/test', auth, async (req, res) => {
    try {
      await Notification.createFromTemplate(req.user._id, 'welcome', {
        userName: req.user.name
      });

      res.json({
        success: true,
        message: 'Test notification sent'
      });
    } catch (error) {
      console.error('Test notification error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send test notification'
      });
    }
  });
}

// Enhanced notification routes
const {
  createNotification,
  sendTestNotification,
  getNotificationAnalytics,
  sendBulkNotifications
} = require('../controllers/notificationController');

// Admin notification management routes
router.post('/admin/create', adminAuth, createNotification);
router.post('/admin/test', adminAuth, sendTestNotification);
router.post('/admin/bulk', adminAuth, sendBulkNotifications);
router.get('/admin/analytics', adminAuth, getNotificationAnalytics);

module.exports = router;