const EventEmitter = require('events');

class EnhancedSSEManager extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map();
    this.pingInterval = 25000; // 25 seconds - well under typical 30s timeouts
    this.pingTimer = null;
    this.connectionTimeout = 300000; // 5 minutes max connection time
    this.reconnectWindow = 1000; // 1 second reconnect window
    
    this.setupPingSystem();
    this.setupCleanupSystem();
  }

  setupPingSystem() {
    // Clear existing timer
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }

    this.pingTimer = setInterval(() => {
      this.pingAllConnections();
    }, this.pingInterval);
  }

  setupCleanupSystem() {
    // Clean up stale connections every minute
    setInterval(() => {
      this.cleanupStaleConnections();
    }, 60000);
  }

  addConnection(id, res, options = {}) {
    try {
      // Remove existing connection if it exists
      this.removeConnection(id);

      // Set SSE headers with enhanced configuration
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'X-Accel-Buffering': 'no', // Disable Nginx buffering
        'Content-Encoding': 'identity', // Prevent compression
        'Keep-Alive': `timeout=${Math.floor(this.connectionTimeout / 1000)}, max=100`
      });

      // Store connection info
      const connectionData = {
        res,
        id,
        startTime: Date.now(),
        lastPing: Date.now(),
        isAlive: true,
        pingCount: 0,
        options: {
          maxAge: options.maxAge || this.connectionTimeout,
          pingInterval: options.pingInterval || this.pingInterval,
          ...options
        }
      };

      this.connections.set(id, connectionData);

      // Send initial connection success message
      this.sendToConnection(id, {
        type: 'connection',
        data: {
          id,
          timestamp: new Date().toISOString(),
          status: 'connected',
          serverTime: Date.now()
        }
      });

      // Set up connection event handlers
      this.setupConnectionHandlers(id, res);

      // Send initial ping
      setTimeout(() => {
        this.sendPing(id);
      }, 1000);

      console.log(`🚀 Enhanced SSE connection established: ${id}`);
      this.emit('connection', { id, connectionData });

      return connectionData;
    } catch (error) {
      console.error('❌ Error adding SSE connection:', error);
      this.removeConnection(id);
      return null;
    }
  }

  setupConnectionHandlers(id, res) {
    const connectionData = this.connections.get(id);
    if (!connectionData) return;

    // Handle client disconnect
    res.on('close', () => {
      console.log(`🔌 SSE connection closed by client: ${id}`);
      this.removeConnection(id);
      this.emit('disconnect', { id, reason: 'client_close' });
    });

    // Handle errors
    res.on('error', (error) => {
      console.error(`❌ SSE connection error for ${id}:`, error.message);
      
      // Don't log common disconnection errors
      if (!this.isCommonDisconnectError(error)) {
        console.error(`❌ Unexpected SSE error for ${id}:`, error);
      }
      
      this.removeConnection(id);
      this.emit('error', { id, error });
    });

    // Handle connection abort
    res.on('abort', () => {
      console.log(`🔌 SSE connection aborted: ${id}`);
      this.removeConnection(id);
      this.emit('disconnect', { id, reason: 'aborted' });
    });

    // Set connection timeout
    const timeoutId = setTimeout(() => {
      console.log(`⏰ SSE connection timeout: ${id}`);
      this.removeConnection(id);
      this.emit('disconnect', { id, reason: 'timeout' });
    }, connectionData.options.maxAge);

    // Store timeout ID for cleanup
    connectionData.timeoutId = timeoutId;
  }

  isCommonDisconnectError(error) {
    const commonErrors = [
      'ECONNRESET',
      'EPIPE', 
      'ECONNABORTED',
      'ECANCELED',
      'aborted'
    ];
    
    return commonErrors.some(errorCode => 
      error.code === errorCode || 
      error.message.includes(errorCode) ||
      error.message.includes('aborted')
    );
  }

  removeConnection(id) {
    const connectionData = this.connections.get(id);
    if (connectionData) {
      try {
        // Clear timeout
        if (connectionData.timeoutId) {
          clearTimeout(connectionData.timeoutId);
        }

        // Mark as not alive
        connectionData.isAlive = false;

        // Try to end the response gracefully
        if (connectionData.res && !connectionData.res.destroyed) {
          try {
            connectionData.res.end();
          } catch (error) {
            // Ignore errors when ending response
          }
        }

        this.connections.delete(id);
        console.log(`🗑️ SSE connection removed: ${id}`);
      } catch (error) {
        console.error(`❌ Error removing SSE connection ${id}:`, error);
        this.connections.delete(id);
      }
    }
  }

  sendToConnection(id, data) {
    const connectionData = this.connections.get(id);
    if (!connectionData || !connectionData.isAlive) {
      return false;
    }

    try {
      const { res } = connectionData;
      
      if (res.destroyed || res.closed) {
        this.removeConnection(id);
        return false;
      }

      const formattedData = this.formatSSEData(data);
      res.write(formattedData);
      
      return true;
    } catch (error) {
      console.error(`❌ Error sending SSE data to ${id}:`, error);
      this.removeConnection(id);
      return false;
    }
  }

  sendToAll(data, filter = null) {
    let successCount = 0;
    const connections = Array.from(this.connections.entries());
    
    for (const [id, connectionData] of connections) {
      if (filter && !filter(id, connectionData)) {
        continue;
      }
      
      if (this.sendToConnection(id, data)) {
        successCount++;
      }
    }
    
    return successCount;
  }

  sendPing(id) {
    const connectionData = this.connections.get(id);
    if (!connectionData) return false;

    connectionData.lastPing = Date.now();
    connectionData.pingCount++;

    return this.sendToConnection(id, {
      type: 'ping',
      data: {
        timestamp: new Date().toISOString(),
        pingCount: connectionData.pingCount,
        connectionAge: Date.now() - connectionData.startTime
      }
    });
  }

  pingAllConnections() {
    const connections = Array.from(this.connections.keys());
    let activeConnections = 0;

    for (const id of connections) {
      if (this.sendPing(id)) {
        activeConnections++;
      }
    }

    if (activeConnections > 0) {
      console.log(`🏓 Pinged ${activeConnections} SSE connections`);
    }

    return activeConnections;
  }

  cleanupStaleConnections() {
    const now = Date.now();
    const staleConnections = [];

    for (const [id, connectionData] of this.connections.entries()) {
      const age = now - connectionData.startTime;
      const timeSinceLastPing = now - connectionData.lastPing;

      // Remove connections that are too old or haven't responded to pings
      if (age > connectionData.options.maxAge || 
          timeSinceLastPing > (this.pingInterval * 3)) {
        staleConnections.push(id);
      }
    }

    if (staleConnections.length > 0) {
      console.log(`🧹 Cleaning up ${staleConnections.length} stale SSE connections`);
      staleConnections.forEach(id => this.removeConnection(id));
    }
  }

  formatSSEData(data) {
    let formatted = '';
    
    // Add event type if specified
    if (data.type) {
      formatted += `event: ${data.type}\n`;
    }
    
    // Add ID if specified
    if (data.id) {
      formatted += `id: ${data.id}\n`;
    }
    
    // Add retry time if specified
    if (data.retry) {
      formatted += `retry: ${data.retry}\n`;
    }
    
    // Add data
    const dataStr = typeof data.data === 'string' ? data.data : JSON.stringify(data.data);
    
    // Split multi-line data properly
    const dataLines = dataStr.split('\n');
    dataLines.forEach(line => {
      formatted += `data: ${line}\n`;
    });
    
    // Add required double newline
    formatted += '\n';
    
    return formatted;
  }

  getConnectionStats() {
    const now = Date.now();
    const connections = Array.from(this.connections.values());
    
    return {
      total: connections.length,
      active: connections.filter(conn => conn.isAlive).length,
      averageAge: connections.length > 0 
        ? Math.round(connections.reduce((sum, conn) => sum + (now - conn.startTime), 0) / connections.length / 1000)
        : 0,
      oldestConnection: connections.length > 0 
        ? Math.round(Math.max(...connections.map(conn => now - conn.startTime)) / 1000)
        : 0
    };
  }

  // Graceful shutdown
  shutdown() {
    console.log('🔌 Shutting down SSE Manager...');
    
    // Clear ping timer
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }

    // Close all connections
    const connectionIds = Array.from(this.connections.keys());
    connectionIds.forEach(id => {
      this.sendToConnection(id, {
        type: 'shutdown',
        data: { message: 'Server shutting down', reconnect: true }
      });
      this.removeConnection(id);
    });

    console.log(`🔌 SSE Manager shutdown complete. Closed ${connectionIds.length} connections.`);
  }

  // Enhanced methods for theme updates
  broadcastThemeUpdate(themeData) {
    return this.sendToAll({
      type: 'theme_update',
      data: {
        ...themeData,
        timestamp: new Date().toISOString(),
        version: Date.now()
      }
    });
  }

  broadcastSystemNotification(notification) {
    return this.sendToAll({
      type: 'system_notification',
      data: {
        ...notification,
        timestamp: new Date().toISOString(),
        id: `notif_${Date.now()}`
      }
    });
  }
}

// Create singleton instance
const sseManager = new EnhancedSSEManager();

// Graceful shutdown handling
process.on('SIGTERM', () => sseManager.shutdown());
process.on('SIGINT', () => sseManager.shutdown());

module.exports = sseManager;