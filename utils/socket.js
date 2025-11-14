const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io;

const initializeSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? [process.env.FRONTEND_URL, process.env.ADMIN_URL].filter(Boolean)
        : ['http://localhost:3000', 'http://localhost:3001'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // Authentication middleware for socket connections
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password -refreshTokens');
      
      if (!user || !user.isActive) {
        return next(new Error('User not found or inactive'));
      }

      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User ${socket.user.name} connected (${socket.userId})`);

    // Join user-specific room for targeted notifications
    socket.join(`user_${socket.userId}`);
    
    // Join role-specific rooms for admin features
    if (socket.user.role === 'admin' || socket.user.role === 'super_admin') {
      socket.join('admins');
    }

    // Handle user status
    socket.on('user_online', () => {
      socket.broadcast.emit('user_status', {
        userId: socket.userId,
        status: 'online'
      });
    });

    // Handle typing indicators (for chat features)
    socket.on('typing_start', (data) => {
      socket.broadcast.to(`user_${data.recipientId}`).emit('user_typing', {
        userId: socket.userId,
        userName: socket.user.name
      });
    });

    socket.on('typing_stop', (data) => {
      socket.broadcast.to(`user_${data.recipientId}`).emit('user_stop_typing', {
        userId: socket.userId
      });
    });

    // Handle notification acknowledgment
    socket.on('notification_read', async (notificationId) => {
      try {
        const Notification = require('../models/Notification');
        await Notification.findByIdAndUpdate(notificationId, {
          isRead: true,
          readAt: new Date()
        });
        
        // Emit updated unread count
        const unreadCount = await Notification.getUnreadCount(socket.userId);
        socket.emit('unread_count_updated', { count: unreadCount });
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    });

    // Handle order tracking subscription
    socket.on('subscribe_order_updates', (orderId) => {
      socket.join(`order_${orderId}`);
    });

    socket.on('unsubscribe_order_updates', (orderId) => {
      socket.leave(`order_${orderId}`);
    });

    // Handle admin-specific events
    if (socket.user.role === 'admin' || socket.user.role === 'super_admin') {
      socket.on('admin_broadcast', (data) => {
        // Only super admins can send broadcasts
        if (socket.user.role === 'super_admin') {
          socket.broadcast.emit('admin_announcement', {
            message: data.message,
            type: data.type || 'info',
            from: socket.user.name
          });
        }
      });

      // Real-time dashboard updates
      socket.on('subscribe_admin_updates', () => {
        socket.join('admin_dashboard');
      });

      // Real-time inventory updates
      socket.on('subscribe_inventory_updates', () => {
        socket.join('inventory_updates');
      });

      socket.on('unsubscribe_inventory_updates', () => {
        socket.leave('inventory_updates');
      });

      // Handle inventory stock updates
      socket.on('update_product_stock', async (data) => {
        try {
          const { productId, newStock, operation, reason } = data;
          
          // Broadcast stock update to all admin users
          socket.to('inventory_updates').emit('inventory_stock_updated', {
            productId,
            newStock,
            operation,
            reason,
            updatedBy: socket.user.name,
            timestamp: new Date().toISOString()
          });

          // Log the stock update for audit trail
          console.log(`Stock updated by ${socket.user.name}: Product ${productId}, Stock: ${newStock}, Operation: ${operation}`);
        } catch (error) {
          console.error('Error updating product stock:', error);
          socket.emit('inventory_error', { message: 'Failed to update stock', error: error.message });
        }
      });

      // Handle low stock alerts
      socket.on('inventory_low_stock_alert', (data) => {
        const { productId, productName, currentStock, threshold } = data;
        
        // Notify all admins about low stock
        socket.to('admins').emit('low_stock_alert', {
          productId,
          productName,
          currentStock,
          threshold,
          alertedBy: socket.user.name,
          timestamp: new Date().toISOString()
        });
      });
    }

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`User ${socket.user.name} disconnected: ${reason}`);
      
      socket.broadcast.emit('user_status', {
        userId: socket.userId,
        status: 'offline'
      });
    });

    // Send initial unread notification count
    (async () => {
      try {
        const Notification = require('../models/Notification');
        const unreadCount = await Notification.getUnreadCount(socket.userId);
        socket.emit('unread_count_updated', { count: unreadCount });
      } catch (error) {
        console.error('Error getting initial unread count:', error);
      }
    })();
  });

  console.log('✅ Socket.IO initialized');
  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

// Utility functions for sending notifications
const notifyUser = (userId, event, data) => {
  if (io) {
    io.to(`user_${userId}`).emit(event, data);
  }
};

const notifyAdmins = (event, data) => {
  if (io) {
    io.to('admins').emit(event, data);
  }
};

const notifyOrderUpdate = (orderId, data) => {
  if (io) {
    io.to(`order_${orderId}`).emit('order_updated', data);
  }
};

const broadcastToAll = (event, data) => {
  if (io) {
    io.emit(event, data);
  }
};

const notifyAdminDashboard = (data) => {
  if (io) {
    io.to('admin_dashboard').emit('dashboard_update', data);
  }
};

// Inventory-specific notification functions
const notifyInventoryUpdate = (data) => {
  if (io) {
    io.to('inventory_updates').emit('inventory_updated', data);
  }
};

const notifyStockUpdate = (productId, stockData) => {
  if (io) {
    io.to('inventory_updates').emit('stock_updated', {
      productId,
      ...stockData,
      timestamp: new Date().toISOString()
    });
  }
};

const notifyLowStockAlert = (alertData) => {
  if (io) {
    io.to('admins').emit('low_stock_alert', {
      ...alertData,
      timestamp: new Date().toISOString()
    });
  }
};

const broadcastInventoryChange = (changeData) => {
  if (io) {
    io.to('inventory_updates').emit('inventory_change', {
      ...changeData,
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = {
  initializeSocket,
  getIO,
  notifyUser,
  notifyAdmins,
  notifyOrderUpdate,
  broadcastToAll,
  notifyAdminDashboard,
  notifyInventoryUpdate,
  notifyStockUpdate,
  notifyLowStockAlert,
  broadcastInventoryChange
};