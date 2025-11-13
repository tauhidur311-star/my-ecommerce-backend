const express = require('express');
const router = express.Router();
const sseManager = require('../utils/enhancedSSEManager');
const { v4: uuidv4 } = require('uuid');

// Enhanced theme updates SSE endpoint
router.get('/theme/updates', (req, res) => {
  const connectionId = `theme_${uuidv4()}_${Date.now()}`;
  
  console.log(`🚀 Enhanced theme updates SSE endpoint hit - Connection ID: ${connectionId}`);
  
  try {
    // Add connection with specific options for theme updates
    const connection = sseManager.addConnection(connectionId, res, {
      maxAge: 300000, // 5 minutes
      pingInterval: 20000, // 20 seconds
      type: 'theme_updates'
    });

    if (!connection) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to establish SSE connection' 
      });
    }

    // Send initial theme data
    setTimeout(() => {
      sseManager.sendToConnection(connectionId, {
        type: 'theme_initial',
        data: {
          message: 'Theme updates stream ready',
          connectionId,
          features: ['theme_updates', 'layout_changes', 'style_updates'],
          reconnectDelay: 1000
        }
      });
    }, 100);

    // Set up connection-specific handlers
    sseManager.on('disconnect', ({ id, reason }) => {
      if (id === connectionId) {
        console.log(`🔌 Theme SSE connection ${connectionId} disconnected: ${reason}`);
      }
    });

  } catch (error) {
    console.error('❌ Error setting up theme SSE connection:', error);
    res.status(500).json({ 
      success: false, 
      message: 'SSE connection failed',
      error: error.message 
    });
  }
});

// Admin notifications SSE endpoint
router.get('/admin/notifications', (req, res) => {
  const connectionId = `admin_${uuidv4()}_${Date.now()}`;
  
  console.log(`🚀 Admin notifications SSE endpoint hit - Connection ID: ${connectionId}`);
  
  try {
    const connection = sseManager.addConnection(connectionId, res, {
      maxAge: 600000, // 10 minutes for admin connections
      pingInterval: 30000, // 30 seconds
      type: 'admin_notifications'
    });

    if (!connection) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to establish admin SSE connection' 
      });
    }

    // Send initial admin data
    setTimeout(() => {
      sseManager.sendToConnection(connectionId, {
        type: 'admin_ready',
        data: {
          message: 'Admin notifications stream ready',
          connectionId,
          features: ['low_stock_alerts', 'order_notifications', 'system_alerts'],
          reconnectDelay: 2000
        }
      });
    }, 100);

  } catch (error) {
    console.error('❌ Error setting up admin SSE connection:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Admin SSE connection failed',
      error: error.message 
    });
  }
});

// System status SSE endpoint
router.get('/system/status', (req, res) => {
  const connectionId = `system_${uuidv4()}_${Date.now()}`;
  
  try {
    const connection = sseManager.addConnection(connectionId, res, {
      maxAge: 120000, // 2 minutes for status updates
      pingInterval: 15000, // 15 seconds
      type: 'system_status'
    });

    if (!connection) {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to establish system status SSE connection' 
      });
    }

    // Send system status every 30 seconds
    const statusInterval = setInterval(() => {
      if (sseManager.connections.has(connectionId)) {
        sseManager.sendToConnection(connectionId, {
          type: 'system_status',
          data: {
            timestamp: new Date().toISOString(),
            connections: sseManager.getConnectionStats(),
            uptime: process.uptime(),
            memory: process.memoryUsage()
          }
        });
      } else {
        clearInterval(statusInterval);
      }
    }, 30000);

    // Cleanup interval when connection closes
    sseManager.once('disconnect', ({ id }) => {
      if (id === connectionId) {
        clearInterval(statusInterval);
      }
    });

  } catch (error) {
    console.error('❌ Error setting up system status SSE connection:', error);
    res.status(500).json({ 
      success: false, 
      message: 'System status SSE connection failed',
      error: error.message 
    });
  }
});

// SSE connection statistics endpoint
router.get('/stats', (req, res) => {
  try {
    const stats = sseManager.getConnectionStats();
    const connections = Array.from(sseManager.connections.entries()).map(([id, data]) => ({
      id,
      type: data.options.type || 'unknown',
      age: Math.round((Date.now() - data.startTime) / 1000),
      pingCount: data.pingCount,
      isAlive: data.isAlive
    }));

    res.json({
      success: true,
      data: {
        stats,
        connections,
        serverUptime: process.uptime()
      }
    });
  } catch (error) {
    console.error('❌ Error getting SSE stats:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to get SSE statistics',
      error: error.message 
    });
  }
});

// Force broadcast endpoint for testing
router.post('/broadcast', (req, res) => {
  try {
    const { type, data } = req.body;
    
    if (!type || !data) {
      return res.status(400).json({
        success: false,
        message: 'Type and data are required'
      });
    }

    const sentCount = sseManager.sendToAll({
      type,
      data: {
        ...data,
        timestamp: new Date().toISOString(),
        broadcast: true
      }
    });

    res.json({
      success: true,
      message: `Broadcast sent to ${sentCount} connections`,
      data: { sentCount, type }
    });
  } catch (error) {
    console.error('❌ Error broadcasting SSE message:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Broadcast failed',
      error: error.message 
    });
  }
});

module.exports = router;