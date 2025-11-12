const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const sseManager = require('../utils/sseManager');

// SSE endpoint for real-time updates
router.get('/events', auth, (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  // Send initial connection message
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({
    message: 'Connected to real-time updates',
    timestamp: new Date().toISOString(),
    userId: req.user.id
  })}\n\n`);

  // Add connection to manager
  sseManager.addConnection(req.user.id, res);

  // Handle client disconnect
  req.on('close', () => {
    sseManager.removeConnection(req.user.id, res);
  });
});

// SSE stats endpoint (admin only)
router.get('/stats', auth, (req, res) => {
  const stats = sseManager.getStats();
  res.json({
    success: true,
    data: stats
  });
});

// Test broadcast endpoint (admin only)
router.post('/broadcast', auth, (req, res) => {
  const { event, data } = req.body;
  
  if (!event || !data) {
    return res.status(400).json({
      success: false,
      message: 'Event name and data are required'
    });
  }

  const sent = sseManager.broadcast(event, data);
  
  res.json({
    success: true,
    message: `Broadcast sent to ${sent} connections`,
    connectionsSent: sent
  });
});

module.exports = router;