const Notification = require('../models/Notification');
const { notifyUser, notifyAdmins, broadcastToAll } = require('../utils/socket');

// @desc    Create notification
// @route   POST /api/admin/notifications
// @access  Private/Admin
const createNotification = async (req, res) => {
  try {
    const {
      title,
      message,
      type = 'info',
      recipient,
      recipientType = 'user',
      actionUrl,
      expiresAt,
      priority = 'normal'
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        error: 'Title and message are required'
      });
    }

    const notificationData = {
      title,
      message,
      type,
      sender: req.user.id,
      actionUrl,
      priority,
      expiresAt: expiresAt ? new Date(expiresAt) : null
    };

    let notification;

    switch (recipientType) {
      case 'user':
        if (!recipient) {
          return res.status(400).json({
            success: false,
            error: 'Recipient ID is required for user notifications'
          });
        }
        notificationData.recipient = recipient;
        notification = await Notification.create(notificationData);
        
        // Send real-time notification
        notifyUser(recipient, 'notification', {
          id: notification._id,
          title,
          message,
          type,
          createdAt: notification.createdAt,
          actionUrl,
          priority
        });
        break;

      case 'admin':
        notificationData.recipientType = 'admin';
        notification = await Notification.create(notificationData);
        
        // Send to all admins
        notifyAdmins('notification', {
          id: notification._id,
          title,
          message,
          type,
          createdAt: notification.createdAt,
          actionUrl,
          priority
        });
        break;

      case 'broadcast':
        notificationData.recipientType = 'broadcast';
        notification = await Notification.create(notificationData);
        
        // Send to all connected users
        broadcastToAll('notification', {
          id: notification._id,
          title,
          message,
          type,
          createdAt: notification.createdAt,
          actionUrl,
          priority
        });
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid recipient type'
        });
    }

    res.status(201).json({
      success: true,
      data: notification,
      message: 'Notification created successfully'
    });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create notification'
    });
  }
};

// @desc    Send test notification
// @route   POST /api/admin/notifications/test
// @access  Private/Admin
const sendTestNotification = async (req, res) => {
  try {
    const { type = 'info', message = 'This is a test notification' } = req.body;

    // Create test notification
    const notification = await Notification.create({
      title: 'Test Notification',
      message,
      type,
      sender: req.user.id,
      recipient: req.user.id,
      priority: 'normal'
    });

    // Send real-time notification to sender
    notifyUser(req.user.id, 'notification', {
      id: notification._id,
      title: 'Test Notification',
      message,
      type,
      createdAt: notification.createdAt,
      priority: 'normal'
    });

    res.json({
      success: true,
      message: 'Test notification sent successfully'
    });
  } catch (error) {
    console.error('Send test notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send test notification'
    });
  }
};

// @desc    Get notification analytics
// @route   GET /api/admin/notifications/analytics
// @access  Private/Admin
const getNotificationAnalytics = async (req, res) => {
  try {
    const { timeframe = '7d' } = req.query;
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
      case '1d':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }

    // Get notification statistics
    const stats = await Notification.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          read: {
            $sum: {
              $cond: ['$isRead', 1, 0]
            }
          },
          unread: {
            $sum: {
              $cond: ['$isRead', 0, 1]
            }
          }
        }
      }
    ]);

    // Get notifications by type
    const typeStats = await Notification.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get daily notification counts
    const dailyStats = await Notification.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
      }
    ]);

    // Get recent notifications
    const recentNotifications = await Notification.find({
      createdAt: { $gte: startDate, $lte: endDate }
    })
      .populate('sender', 'name email')
      .populate('recipient', 'name email')
      .sort({ createdAt: -1 })
      .limit(10);

    const summary = stats[0] || { total: 0, read: 0, unread: 0 };
    const readRate = summary.total > 0 ? ((summary.read / summary.total) * 100).toFixed(2) : 0;

    res.json({
      success: true,
      data: {
        summary: {
          ...summary,
          readRate: parseFloat(readRate)
        },
        typeDistribution: typeStats,
        dailyStats,
        recentNotifications,
        timeframe
      }
    });
  } catch (error) {
    console.error('Get notification analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch notification analytics'
    });
  }
};

// @desc    Bulk send notifications
// @route   POST /api/admin/notifications/bulk
// @access  Private/Admin
const sendBulkNotifications = async (req, res) => {
  try {
    const {
      title,
      message,
      type = 'info',
      recipients = [],
      recipientType = 'user',
      actionUrl,
      priority = 'normal'
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        error: 'Title and message are required'
      });
    }

    if (recipientType === 'user' && recipients.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Recipients are required for user notifications'
      });
    }

    const notifications = [];
    const baseNotification = {
      title,
      message,
      type,
      sender: req.user.id,
      actionUrl,
      priority
    };

    if (recipientType === 'user') {
      // Create notifications for specific users
      for (const recipientId of recipients) {
        const notification = await Notification.create({
          ...baseNotification,
          recipient: recipientId
        });
        notifications.push(notification);

        // Send real-time notification
        notifyUser(recipientId, 'notification', {
          id: notification._id,
          title,
          message,
          type,
          createdAt: notification.createdAt,
          actionUrl,
          priority
        });
      }
    } else if (recipientType === 'admin') {
      const notification = await Notification.create({
        ...baseNotification,
        recipientType: 'admin'
      });
      notifications.push(notification);

      // Send to all admins
      notifyAdmins('notification', {
        id: notification._id,
        title,
        message,
        type,
        createdAt: notification.createdAt,
        actionUrl,
        priority
      });
    } else if (recipientType === 'broadcast') {
      const notification = await Notification.create({
        ...baseNotification,
        recipientType: 'broadcast'
      });
      notifications.push(notification);

      // Send to all connected users
      broadcastToAll('notification', {
        id: notification._id,
        title,
        message,
        type,
        createdAt: notification.createdAt,
        actionUrl,
        priority
      });
    }

    res.status(201).json({
      success: true,
      data: {
        created: notifications.length,
        notifications
      },
      message: `${notifications.length} notifications sent successfully`
    });
  } catch (error) {
    console.error('Send bulk notifications error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send bulk notifications'
    });
  }
};

module.exports = {
  createNotification,
  sendTestNotification,
  getNotificationAnalytics,
  sendBulkNotifications
};