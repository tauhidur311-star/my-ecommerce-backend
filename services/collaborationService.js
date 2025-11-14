/**
 * Real-Time Collaboration Service
 * WebSocket-based collaboration system for page builder
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Design = require('../models/Design');
const logger = require('../utils/logger');

class CollaborationService {
  constructor(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    // Store active sessions
    this.activeSessions = new Map(); // designId -> Set of socketIds
    this.userSockets = new Map(); // userId -> socketId
    this.socketUsers = new Map(); // socketId -> user info
    this.cursors = new Map(); // socketId -> cursor position
    this.editingSections = new Map(); // sectionId -> socketId
    this.documentStates = new Map(); // designId -> current state

    this.initializeSocketHandlers();
  }

  initializeSocketHandlers() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          throw new Error('No token provided');
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('name email avatar role');
        
        if (!user) {
          throw new Error('User not found');
        }

        socket.userId = user._id.toString();
        socket.user = user;
        next();
      } catch (error) {
        logger.error('Socket authentication failed:', error.message);
        next(new Error('Authentication failed'));
      }
    });

    this.io.on('connection', (socket) => {
      logger.info(`User ${socket.user.name} connected (${socket.id})`);
      
      // Store user-socket mapping
      this.userSockets.set(socket.userId, socket.id);
      this.socketUsers.set(socket.id, {
        id: socket.userId,
        name: socket.user.name,
        avatar: socket.user.avatar,
        color: this.generateUserColor(socket.userId)
      });

      // Handle design room joining
      socket.on('join-design', async (data) => {
        await this.handleJoinDesign(socket, data);
      });

      // Handle leaving design room
      socket.on('leave-design', (data) => {
        this.handleLeaveDesign(socket, data);
      });

      // Handle cursor movement
      socket.on('cursor-move', (data) => {
        this.handleCursorMove(socket, data);
      });

      // Handle section editing
      socket.on('section-edit-start', (data) => {
        this.handleSectionEditStart(socket, data);
      });

      socket.on('section-edit-end', (data) => {
        this.handleSectionEditEnd(socket, data);
      });

      // Handle real-time updates
      socket.on('section-update', (data) => {
        this.handleSectionUpdate(socket, data);
      });

      socket.on('sections-reorder', (data) => {
        this.handleSectionsReorder(socket, data);
      });

      socket.on('section-add', (data) => {
        this.handleSectionAdd(socket, data);
      });

      socket.on('section-delete', (data) => {
        this.handleSectionDelete(socket, data);
      });

      // Handle document operations
      socket.on('undo', (data) => {
        this.handleUndo(socket, data);
      });

      socket.on('redo', (data) => {
        this.handleRedo(socket, data);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      // Handle typing indicators
      socket.on('typing-start', (data) => {
        this.handleTypingStart(socket, data);
      });

      socket.on('typing-end', (data) => {
        this.handleTypingEnd(socket, data);
      });

      // Handle comments
      socket.on('comment-add', (data) => {
        this.handleCommentAdd(socket, data);
      });
    });
  }

  async handleJoinDesign(socket, { designId, permissions = 'edit' }) {
    try {
      // Verify user has access to the design
      const design = await Design.findById(designId);
      if (!design) {
        socket.emit('error', { message: 'Design not found' });
        return;
      }

      // Check permissions (simplified - in production, implement proper ACL)
      const hasAccess = design.user.toString() === socket.userId || 
                       design.collaborators?.some(c => c.user.toString() === socket.userId) ||
                       socket.user.role === 'admin';

      if (!hasAccess) {
        socket.emit('error', { message: 'Access denied' });
        return;
      }

      // Join the design room
      socket.join(`design:${designId}`);
      socket.currentDesign = designId;
      socket.permissions = permissions;

      // Add to active sessions
      if (!this.activeSessions.has(designId)) {
        this.activeSessions.set(designId, new Set());
      }
      this.activeSessions.get(designId).add(socket.id);

      // Initialize document state if not exists
      if (!this.documentStates.has(designId)) {
        this.documentStates.set(designId, {
          sections: design.sections || [],
          globalSettings: design.globalSettings || {},
          history: [],
          historyIndex: -1
        });
      }

      // Get current collaborators
      const collaborators = this.getDesignCollaborators(designId);

      // Notify others about new user
      socket.to(`design:${designId}`).emit('user-joined', {
        user: this.socketUsers.get(socket.id),
        collaborators
      });

      // Send current state to new user
      socket.emit('design-state', {
        designId,
        state: this.documentStates.get(designId),
        collaborators,
        permissions
      });

      logger.info(`User ${socket.user.name} joined design ${designId}`);

    } catch (error) {
      logger.error('Error joining design:', error);
      socket.emit('error', { message: 'Failed to join design' });
    }
  }

  handleLeaveDesign(socket, { designId }) {
    if (socket.currentDesign !== designId) return;

    socket.leave(`design:${designId}`);
    
    // Remove from active sessions
    if (this.activeSessions.has(designId)) {
      this.activeSessions.get(designId).delete(socket.id);
      if (this.activeSessions.get(designId).size === 0) {
        this.activeSessions.delete(designId);
        // Optionally clean up document state after delay
        setTimeout(() => {
          if (!this.activeSessions.has(designId)) {
            this.documentStates.delete(designId);
          }
        }, 60000); // 1 minute delay
      }
    }

    // Release any editing locks
    this.releaseEditingLocks(socket);

    // Notify others
    socket.to(`design:${designId}`).emit('user-left', {
      userId: socket.userId,
      collaborators: this.getDesignCollaborators(designId)
    });

    socket.currentDesign = null;
    logger.info(`User ${socket.user.name} left design ${designId}`);
  }

  handleCursorMove(socket, { designId, position }) {
    if (socket.currentDesign !== designId) return;

    this.cursors.set(socket.id, {
      userId: socket.userId,
      position,
      timestamp: Date.now()
    });

    socket.to(`design:${designId}`).emit('cursor-update', {
      userId: socket.userId,
      user: this.socketUsers.get(socket.id),
      position
    });
  }

  handleSectionEditStart(socket, { designId, sectionId }) {
    if (socket.currentDesign !== designId || socket.permissions === 'view') return;

    // Check if section is already being edited
    if (this.editingSections.has(sectionId)) {
      const currentEditor = this.editingSections.get(sectionId);
      if (currentEditor !== socket.id) {
        socket.emit('section-locked', {
          sectionId,
          editor: this.socketUsers.get(currentEditor)
        });
        return;
      }
    }

    // Lock the section
    this.editingSections.set(sectionId, socket.id);

    // Notify others
    socket.to(`design:${designId}`).emit('section-edit-started', {
      sectionId,
      editor: this.socketUsers.get(socket.id)
    });
  }

  handleSectionEditEnd(socket, { designId, sectionId }) {
    if (socket.currentDesign !== designId) return;

    // Release lock if this user has it
    if (this.editingSections.get(sectionId) === socket.id) {
      this.editingSections.delete(sectionId);

      // Notify others
      socket.to(`design:${designId}`).emit('section-edit-ended', {
        sectionId,
        editor: this.socketUsers.get(socket.id)
      });
    }
  }

  handleSectionUpdate(socket, { designId, sectionId, updates, version }) {
    if (socket.currentDesign !== designId || socket.permissions === 'view') return;

    try {
      const docState = this.documentStates.get(designId);
      if (!docState) return;

      // Find and update the section
      const sectionIndex = docState.sections.findIndex(s => s.id === sectionId);
      if (sectionIndex === -1) return;

      // Version check for conflict resolution
      const currentSection = docState.sections[sectionIndex];
      if (version && currentSection.version && currentSection.version > version) {
        socket.emit('version-conflict', {
          sectionId,
          currentVersion: currentSection.version,
          serverState: currentSection
        });
        return;
      }

      // Apply updates
      docState.sections[sectionIndex] = {
        ...currentSection,
        ...updates,
        version: (currentSection.version || 0) + 1,
        lastEditedBy: socket.userId,
        lastEditedAt: new Date()
      };

      // Save to history
      this.saveToHistory(designId, {
        type: 'section-update',
        sectionId,
        updates,
        userId: socket.userId,
        timestamp: Date.now()
      });

      // Broadcast to others
      socket.to(`design:${designId}`).emit('section-updated', {
        sectionId,
        updates: docState.sections[sectionIndex],
        editor: this.socketUsers.get(socket.id)
      });

      // Persist to database (debounced)
      this.debouncedSave(designId);

    } catch (error) {
      logger.error('Error handling section update:', error);
      socket.emit('error', { message: 'Failed to update section' });
    }
  }

  handleSectionsReorder(socket, { designId, startIndex, endIndex }) {
    if (socket.currentDesign !== designId || socket.permissions === 'view') return;

    const docState = this.documentStates.get(designId);
    if (!docState) return;

    // Reorder sections
    const sections = [...docState.sections];
    const [movedSection] = sections.splice(startIndex, 1);
    sections.splice(endIndex, 0, movedSection);
    
    docState.sections = sections;

    // Save to history
    this.saveToHistory(designId, {
      type: 'sections-reorder',
      startIndex,
      endIndex,
      userId: socket.userId,
      timestamp: Date.now()
    });

    // Broadcast to others
    socket.to(`design:${designId}`).emit('sections-reordered', {
      startIndex,
      endIndex,
      sections: docState.sections,
      editor: this.socketUsers.get(socket.id)
    });

    this.debouncedSave(designId);
  }

  handleSectionAdd(socket, { designId, section, index }) {
    if (socket.currentDesign !== designId || socket.permissions === 'view') return;

    const docState = this.documentStates.get(designId);
    if (!docState) return;

    // Add section
    const newSection = {
      ...section,
      id: section.id || `section_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      version: 1,
      createdBy: socket.userId,
      createdAt: new Date()
    };

    if (index !== undefined) {
      docState.sections.splice(index, 0, newSection);
    } else {
      docState.sections.push(newSection);
    }

    // Save to history
    this.saveToHistory(designId, {
      type: 'section-add',
      section: newSection,
      index,
      userId: socket.userId,
      timestamp: Date.now()
    });

    // Broadcast to others
    socket.to(`design:${designId}`).emit('section-added', {
      section: newSection,
      index,
      editor: this.socketUsers.get(socket.id)
    });

    this.debouncedSave(designId);
  }

  handleSectionDelete(socket, { designId, sectionId }) {
    if (socket.currentDesign !== designId || socket.permissions === 'view') return;

    const docState = this.documentStates.get(designId);
    if (!docState) return;

    // Find and remove section
    const sectionIndex = docState.sections.findIndex(s => s.id === sectionId);
    if (sectionIndex === -1) return;

    const deletedSection = docState.sections[sectionIndex];
    docState.sections.splice(sectionIndex, 1);

    // Release editing lock if exists
    if (this.editingSections.get(sectionId) === socket.id) {
      this.editingSections.delete(sectionId);
    }

    // Save to history
    this.saveToHistory(designId, {
      type: 'section-delete',
      section: deletedSection,
      index: sectionIndex,
      userId: socket.userId,
      timestamp: Date.now()
    });

    // Broadcast to others
    socket.to(`design:${designId}`).emit('section-deleted', {
      sectionId,
      editor: this.socketUsers.get(socket.id)
    });

    this.debouncedSave(designId);
  }

  handleUndo(socket, { designId }) {
    if (socket.currentDesign !== designId || socket.permissions === 'view') return;

    const docState = this.documentStates.get(designId);
    if (!docState || docState.historyIndex < 0) return;

    // Apply undo
    const historyItem = docState.history[docState.historyIndex];
    this.applyHistoryItem(docState, historyItem, true); // true for undo
    docState.historyIndex--;

    // Broadcast to others
    socket.to(`design:${designId}`).emit('design-undone', {
      state: {
        sections: docState.sections,
        globalSettings: docState.globalSettings
      },
      editor: this.socketUsers.get(socket.id)
    });

    this.debouncedSave(designId);
  }

  handleRedo(socket, { designId }) {
    if (socket.currentDesign !== designId || socket.permissions === 'view') return;

    const docState = this.documentStates.get(designId);
    if (!docState || docState.historyIndex >= docState.history.length - 1) return;

    docState.historyIndex++;
    const historyItem = docState.history[docState.historyIndex];
    this.applyHistoryItem(docState, historyItem, false); // false for redo

    // Broadcast to others
    socket.to(`design:${designId}`).emit('design-redone', {
      state: {
        sections: docState.sections,
        globalSettings: docState.globalSettings
      },
      editor: this.socketUsers.get(socket.id)
    });

    this.debouncedSave(designId);
  }

  handleDisconnect(socket) {
    logger.info(`User ${socket.user?.name} disconnected (${socket.id})`);

    // Clean up all references
    this.userSockets.delete(socket.userId);
    this.socketUsers.delete(socket.id);
    this.cursors.delete(socket.id);

    // Release editing locks
    this.releaseEditingLocks(socket);

    // Leave design room and notify others
    if (socket.currentDesign) {
      const designId = socket.currentDesign;
      
      if (this.activeSessions.has(designId)) {
        this.activeSessions.get(designId).delete(socket.id);
      }

      socket.to(`design:${designId}`).emit('user-left', {
        userId: socket.userId,
        collaborators: this.getDesignCollaborators(designId)
      });
    }
  }

  handleTypingStart(socket, { designId, sectionId, field }) {
    if (socket.currentDesign !== designId) return;

    socket.to(`design:${designId}`).emit('typing-started', {
      sectionId,
      field,
      user: this.socketUsers.get(socket.id)
    });
  }

  handleTypingEnd(socket, { designId, sectionId, field }) {
    if (socket.currentDesign !== designId) return;

    socket.to(`design:${designId}`).emit('typing-ended', {
      sectionId,
      field,
      userId: socket.userId
    });
  }

  handleCommentAdd(socket, { designId, comment }) {
    if (socket.currentDesign !== designId) return;

    const newComment = {
      id: `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...comment,
      user: this.socketUsers.get(socket.id),
      createdAt: new Date()
    };

    // Broadcast to all users in the design
    this.io.to(`design:${designId}`).emit('comment-added', newComment);
  }

  // Helper methods

  getDesignCollaborators(designId) {
    if (!this.activeSessions.has(designId)) return [];
    
    return Array.from(this.activeSessions.get(designId))
      .map(socketId => this.socketUsers.get(socketId))
      .filter(Boolean);
  }

  releaseEditingLocks(socket) {
    for (const [sectionId, editorSocketId] of this.editingSections.entries()) {
      if (editorSocketId === socket.id) {
        this.editingSections.delete(sectionId);
        
        if (socket.currentDesign) {
          socket.to(`design:${socket.currentDesign}`).emit('section-edit-ended', {
            sectionId,
            editor: this.socketUsers.get(socket.id)
          });
        }
      }
    }
  }

  generateUserColor(userId) {
    // Generate a consistent color for each user
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
      '#FECA57', '#FF9FF3', '#54A0FF', '#5F27CD'
    ];
    
    const hash = userId.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    
    return colors[Math.abs(hash) % colors.length];
  }

  saveToHistory(designId, operation) {
    const docState = this.documentStates.get(designId);
    if (!docState) return;

    // Remove future history if we're not at the end
    if (docState.historyIndex < docState.history.length - 1) {
      docState.history = docState.history.slice(0, docState.historyIndex + 1);
    }

    // Add new operation
    docState.history.push(operation);
    docState.historyIndex = docState.history.length - 1;

    // Limit history size
    const maxHistory = 50;
    if (docState.history.length > maxHistory) {
      docState.history = docState.history.slice(-maxHistory);
      docState.historyIndex = docState.history.length - 1;
    }
  }

  applyHistoryItem(docState, historyItem, isUndo) {
    // Implement undo/redo logic based on operation type
    switch (historyItem.type) {
      case 'section-update':
        // For undo: revert to previous state
        // For redo: apply the update
        // This is simplified - in production, store before/after states
        break;
      case 'section-add':
        if (isUndo) {
          docState.sections = docState.sections.filter(s => s.id !== historyItem.section.id);
        } else {
          docState.sections.splice(historyItem.index || docState.sections.length, 0, historyItem.section);
        }
        break;
      case 'section-delete':
        if (isUndo) {
          docState.sections.splice(historyItem.index, 0, historyItem.section);
        } else {
          docState.sections = docState.sections.filter(s => s.id !== historyItem.section.id);
        }
        break;
      case 'sections-reorder':
        if (isUndo) {
          // Reverse the reorder
          const sections = [...docState.sections];
          const [movedSection] = sections.splice(historyItem.endIndex, 1);
          sections.splice(historyItem.startIndex, 0, movedSection);
          docState.sections = sections;
        } else {
          const sections = [...docState.sections];
          const [movedSection] = sections.splice(historyItem.startIndex, 1);
          sections.splice(historyItem.endIndex, 0, movedSection);
          docState.sections = sections;
        }
        break;
    }
  }

  // Debounced save to database
  debouncedSave(designId) {
    if (this.saveTimeouts) {
      clearTimeout(this.saveTimeouts.get(designId));
    } else {
      this.saveTimeouts = new Map();
    }

    this.saveTimeouts.set(designId, setTimeout(async () => {
      try {
        const docState = this.documentStates.get(designId);
        if (docState) {
          await Design.findByIdAndUpdate(designId, {
            sections: docState.sections,
            globalSettings: docState.globalSettings,
            updatedAt: new Date()
          });
          logger.info(`Design ${designId} saved to database`);
        }
      } catch (error) {
        logger.error(`Failed to save design ${designId}:`, error);
      } finally {
        this.saveTimeouts.delete(designId);
      }
    }, 2000)); // 2 second debounce
  }

  // Public methods for external use
  getActiveCollaborators(designId) {
    return this.getDesignCollaborators(designId);
  }

  broadcastToDesign(designId, event, data) {
    this.io.to(`design:${designId}`).emit(event, data);
  }

  getUserSocket(userId) {
    const socketId = this.userSockets.get(userId);
    return socketId ? this.io.sockets.sockets.get(socketId) : null;
  }
}

module.exports = CollaborationService;