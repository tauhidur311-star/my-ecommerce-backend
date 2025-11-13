const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

class WebSocketManager {
  constructor() {
    this.clients = new Map();
    this.wss = null;
  }

  initialize(server) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/notifications'
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    console.log('WebSocket server initialized on /notifications');
  }

  async handleConnection(ws, req) {
    console.log('New WebSocket connection established');
    
    const clientId = this.generateClientId();
    let userId = null;
    let userRole = null;

    // Store connection info
    this.clients.set(clientId, {
      ws,
      userId: null,
      userRole: null,
      lastActivity: Date.now()
    });

    // Send welcome message
    this.sendToClient(clientId, {
      type: 'connection',
      payload: {
        message: 'Connected to real-time notifications',
        clientId,
        timestamp: new Date().toISOString()
      }
    });

    // Handle incoming messages
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleMessage(clientId, message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
        this.sendToClient(clientId, {
          type: 'error',
          payload: { message: 'Invalid message format' }
        });
      }
    });

    // Handle connection close
    ws.on('close', () => {
      console.log(`WebSocket connection closed: ${clientId}`);
      this.clients.delete(clientId);
    });

    // Handle connection errors
    ws.on('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
      this.clients.delete(clientId);
    });

    // Set up heartbeat
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(heartbeat);
        this.clients.delete(clientId);
      }
    }, 30000); // Ping every 30 seconds

    ws.on('pong', () => {
      // Update last activity
      const client = this.clients.get(clientId);
      if (client) {
        client.lastActivity = Date.now();
      }
    });
  }

  async handleMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'auth':
        await this.handleAuth(clientId, message.token);
        break;
      
      case 'subscribe':
        await this.handleSubscribe(clientId, message.channels);
        break;
      
      case 'ping':
        this.sendToClient(clientId, {
          type: 'pong',
          payload: { timestamp: new Date().toISOString() }
        });
        break;
      
      default:
        console.log(`Unknown message type: ${message.type}`);
    }
  }

  async handleAuth(clientId, token) {
    try {
      if (!token) {
        this.sendToClient(clientId, {
          type: 'auth_error',
          payload: { message: 'No token provided' }
        });
        return;
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        this.sendToClient(clientId, {
          type: 'auth_error',
          payload: { message: 'User not found' }
        });
        return;
      }

      // Update client info
      const client = this.clients.get(clientId);
      if (client) {
        client.userId = user._id.toString();
        client.userRole = user.role;
      }

      this.sendToClient(clientId, {
        type: 'auth_success',
        payload: {
          message: 'Authentication successful',
          user: {
            id: user._id,
            name: user.name,
            role: user.role
          }
        }
      });

      // Send any pending notifications for this user
      this.sendPendingNotifications(clientId, user._id);

    } catch (error) {
      console.error('Authentication error:', error);
      this.sendToClient(clientId, {
        type: 'auth_error',
        payload: { message: 'Invalid token' }
      });
    }
  }

  async handleSubscribe(clientId, channels) {
    const client = this.clients.get(clientId);
    if (!client || !client.userId) {
      this.sendToClient(clientId, {
        type: 'error',
        payload: { message: 'Authentication required' }
      });
      return;
    }

    client.subscriptions = channels || ['general'];
    
    this.sendToClient(clientId, {
      type: 'subscription_success',
      payload: {
        message: 'Subscribed to channels',
        channels: client.subscriptions
      }
    });
  }

  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  // Send notification to specific user
  sendToUser(userId, notification) {
    for (const [clientId, client] of this.clients.entries()) {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(clientId, {
          type: 'notification',
          payload: notification
        });
      }
    }
  }

  // Send notification to users with specific role
  sendToRole(role, notification) {
    for (const [clientId, client] of this.clients.entries()) {
      if (client.userRole === role && client.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(clientId, {
          type: 'notification',
          payload: notification
        });
      }
    }
  }

  // Broadcast to all connected clients
  broadcast(notification) {
    for (const [clientId, client] of this.clients.entries()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        this.sendToClient(clientId, {
          type: 'notification',
          payload: notification
        });
      }
    }
  }

  // Send order update notifications
  sendOrderUpdate(orderId, orderData) {
    const notification = {
      type: 'order_update',
      orderId,
      data: orderData,
      timestamp: new Date().toISOString()
    };

    // Send to admins
    this.sendToRole('admin', notification);
    this.sendToRole('super_admin', notification);
  }

  // Send analytics updates
  sendAnalyticsUpdate(analyticsData) {
    const notification = {
      type: 'analytics_update',
      data: analyticsData,
      timestamp: new Date().toISOString()
    };

    // Send to admins
    this.sendToRole('admin', notification);
    this.sendToRole('super_admin', notification);
  }

  async sendPendingNotifications(clientId, userId) {
    try {
      // This would fetch pending notifications from database
      // For now, send a welcome notification
      this.sendToClient(clientId, {
        type: 'notification',
        payload: {
          title: 'Welcome!',
          message: 'You are now connected to real-time notifications',
          type: 'info',
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error sending pending notifications:', error);
    }
  }

  generateClientId() {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  // Get connection statistics
  getStats() {
    return {
      totalConnections: this.clients.size,
      authenticatedConnections: Array.from(this.clients.values()).filter(c => c.userId).length,
      adminConnections: Array.from(this.clients.values()).filter(c => c.userRole === 'admin' || c.userRole === 'super_admin').length
    };
  }

  // Cleanup inactive connections
  cleanup() {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    for (const [clientId, client] of this.clients.entries()) {
      if (now - client.lastActivity > timeout) {
        console.log(`Cleaning up inactive connection: ${clientId}`);
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.close();
        }
        this.clients.delete(clientId);
      }
    }
  }
}

// Create singleton instance
const wsManager = new WebSocketManager();

// Cleanup inactive connections every 5 minutes
setInterval(() => {
  wsManager.cleanup();
}, 5 * 60 * 1000);

module.exports = wsManager;