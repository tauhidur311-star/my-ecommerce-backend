// This file replaces the existing SSE manager with enhanced version
const sseManager = require('../utils/sseManager');
const enhancedSSEManager = require('../utils/enhancedSSEManager');

// If you have an existing sseManager.js file, you can gradually migrate to the enhanced version
// For now, we'll create a bridge to maintain compatibility

class SSEManagerBridge {
  constructor() {
    this.enhanced = enhancedSSEManager;
    this.clients = new Map(); // For backward compatibility
  }

  // Legacy compatibility methods
  addClient(id, res) {
    return this.enhanced.addConnection(id, res);
  }

  removeClient(id) {
    return this.enhanced.removeConnection(id);
  }

  broadcast(data) {
    return this.enhanced.sendToAll({
      type: 'broadcast',
      data
    });
  }

  broadcastThemeUpdate(themeData) {
    return this.enhanced.broadcastThemeUpdate(themeData);
  }

  getClientCount() {
    return this.enhanced.getConnectionStats().total;
  }

  // Enhanced methods
  sendToConnection(id, data) {
    return this.enhanced.sendToConnection(id, data);
  }

  sendToAll(data, filter) {
    return this.enhanced.sendToAll(data, filter);
  }

  getConnectionStats() {
    return this.enhanced.getConnectionStats();
  }
}

// Export singleton instance
module.exports = new SSEManagerBridge();