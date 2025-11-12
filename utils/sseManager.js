class SSEManager {
  constructor() {
    this.connections = new Map(); // userId -> Set of response objects
  }

  // Add a new SSE connection
  addConnection(userId, res) {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    
    this.connections.get(userId).add(res);
    
    // Clean up when connection closes
    res.on('close', () => {
      this.removeConnection(userId, res);
    });

    console.log(`SSE connection added for user ${userId}. Total connections: ${this.getTotalConnections()}`);
  }

  // Remove a connection
  removeConnection(userId, res) {
    if (this.connections.has(userId)) {
      this.connections.get(userId).delete(res);
      
      // Remove empty sets
      if (this.connections.get(userId).size === 0) {
        this.connections.delete(userId);
      }
    }

    console.log(`SSE connection removed for user ${userId}. Total connections: ${this.getTotalConnections()}`);
  }

  // Send message to specific user
  sendToUser(userId, event, data) {
    if (!this.connections.has(userId)) {
      return false;
    }

    const userConnections = this.connections.get(userId);
    let sent = 0;

    userConnections.forEach(res => {
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        sent++;
      } catch (error) {
        console.error(`Error sending SSE to user ${userId}:`, error);
        this.removeConnection(userId, res);
      }
    });

    return sent > 0;
  }

  // Send message to all connected users
  broadcast(event, data) {
    let totalSent = 0;

    this.connections.forEach((userConnections, userId) => {
      userConnections.forEach(res => {
        try {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
          totalSent++;
        } catch (error) {
          console.error(`Error broadcasting SSE to user ${userId}:`, error);
          this.removeConnection(userId, res);
        }
      });
    });

    return totalSent;
  }

  // Send to users with specific role or permission
  sendToRole(role, event, data) {
    // This would require user role information to be stored with connections
    // For now, just broadcast to all
    return this.broadcast(event, data);
  }

  // Get connection statistics
  getStats() {
    return {
      totalUsers: this.connections.size,
      totalConnections: this.getTotalConnections(),
      userConnections: Array.from(this.connections.entries()).map(([userId, connections]) => ({
        userId,
        connections: connections.size
      }))
    };
  }

  getTotalConnections() {
    let total = 0;
    this.connections.forEach(userConnections => {
      total += userConnections.size;
    });
    return total;
  }

  // Cleanup dead connections
  cleanup() {
    this.connections.forEach((userConnections, userId) => {
      const deadConnections = [];
      
      userConnections.forEach(res => {
        if (res.destroyed || !res.writable) {
          deadConnections.push(res);
        }
      });
      
      deadConnections.forEach(res => {
        this.removeConnection(userId, res);
      });
    });
  }

  // Health check - send ping to all connections
  ping() {
    const pinged = this.broadcast('ping', {
      timestamp: new Date().toISOString(),
      message: 'Connection check'
    });

    console.log(`Pinged ${pinged} SSE connections`);
    return pinged;
  }
}

// Singleton instance
const sseManager = new SSEManager();

// Cleanup dead connections every 30 seconds
setInterval(() => {
  sseManager.cleanup();
}, 30000);

// Send ping every 25 seconds to keep connections alive
setInterval(() => {
  sseManager.ping();
}, 25000);

module.exports = sseManager;