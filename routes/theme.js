const express = require('express');
const router = express.Router();
const Page = require('../models/Page'); // Using existing Page model

// Get published theme for home page
router.get('/public/theme/home', async (req, res) => {
  try {
    console.log('📥 Fetching published theme for home page');
    
    // Fetch theme data from Page model (where ThemeEditor saves)
    const homePage = await Page.findOne({ 
      template_type: 'home', 
      published: true 
    }).select('sections theme_settings page_name slug published_at updatedAt');
    
    if (!homePage) {
      console.log('⚠️ No published home page theme found');
      return res.status(404).json({ 
        success: false,
        error: 'Theme not found',
        message: 'No published theme available for home page',
        timestamp: new Date().toISOString()
      });
    }
    
    // Convert Page model data to frontend-expected format
    const themeData = {
      success: true,
      theme: {
        type: 'home',
        name: homePage.page_name || 'Home',
        layout: {
          sections: homePage.sections.map(section => ({
            id: section.section_id,
            type: section.type,
            content: section.content || '',
            visible: section.visible,
            settings: section.settings,
            blocks: section.blocks ? section.blocks.map(block => ({
              id: block.block_id,
              type: block.type,
              content: block.content,
              settings: block.settings
            })) : []
          }))
        },
        theme_settings: homePage.theme_settings || {}
      },
      lastUpdated: homePage.updatedAt,
      publishedAt: homePage.published_at
    };
    
    // Set cache headers
    res.set({
      'Cache-Control': 'public, max-age=300', // 5 minutes cache
      'ETag': `"home-${homePage.updatedAt.getTime()}"`,
      'Last-Modified': homePage.updatedAt.toUTCString()
    });
    
    console.log('✅ Theme data sent successfully');
    res.json(themeData);
    
  } catch (error) {
    console.error('❌ Theme fetch error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get published theme for other page types
router.get('/public/theme/:pageType', async (req, res) => {
  try {
    const { pageType } = req.params;
    console.log(`📥 Fetching published theme for ${pageType} page`);
    
    const page = await Page.findOne({ 
      template_type: pageType, 
      published: true 
    }).select('sections theme_settings page_name slug published_at updatedAt');
    
    if (!page) {
      return res.status(404).json({ 
        success: false,
        error: 'Theme not found',
        message: `No published theme available for ${pageType} page`
      });
    }
    
    const themeData = {
      success: true,
      theme: {
        type: pageType,
        name: page.page_name || pageType,
        layout: {
          sections: page.sections.map(section => ({
            id: section.section_id,
            type: section.type,
            content: section.content || '',
            visible: section.visible,
            settings: section.settings,
            blocks: section.blocks ? section.blocks.map(block => ({
              id: block.block_id,
              type: block.type,
              content: block.content,
              settings: block.settings
            })) : []
          }))
        },
        theme_settings: page.theme_settings || {}
      },
      lastUpdated: page.updatedAt,
      publishedAt: page.published_at
    };
    
    res.json(themeData);
    
  } catch (error) {
    console.error('❌ Theme fetch error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error', 
      message: error.message 
    });
  }
});

// SSE endpoint for real-time theme updates
router.get('/public/theme/updates', (req, res) => {
  try {
    console.log('🔄 New SSE connection for theme updates');
    
    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control, Content-Type');
    
    // Send initial connection message
    res.write('data: {"type":"connected","message":"Theme updates connected","timestamp":"' + new Date().toISOString() + '"}\n\n');
    
    // Keep connection alive with heartbeat
    const heartbeatInterval = setInterval(() => {
      res.write('data: {"type":"heartbeat","timestamp":"' + new Date().toISOString() + '"}\n\n');
    }, 30000); // Every 30 seconds
    
    // Store connection for broadcasting updates
    global.sseConnections = global.sseConnections || [];
    global.sseConnections.push(res);
    
    // Cleanup on disconnect
    req.on('close', () => {
      console.log('🔌 SSE connection closed');
      clearInterval(heartbeatInterval);
      
      // Remove from connections array
      if (global.sseConnections) {
        const index = global.sseConnections.indexOf(res);
        if (index > -1) {
          global.sseConnections.splice(index, 1);
        }
      }
      
      res.end();
    });
    
    req.on('error', (error) => {
      console.error('❌ SSE connection error:', error);
      clearInterval(heartbeatInterval);
      res.end();
    });
    
  } catch (error) {
    console.error('❌ SSE setup error:', error);
    res.status(500).json({ error: 'SSE connection failed' });
  }
});

// Broadcast theme update to all connected clients
const broadcastThemeUpdate = (pageType, themeData) => {
  if (global.sseConnections && global.sseConnections.length > 0) {
    const message = JSON.stringify({
      type: 'theme_update',
      pageType,
      data: themeData,
      timestamp: new Date().toISOString()
    });
    
    console.log(`📡 Broadcasting theme update to ${global.sseConnections.length} clients`);
    
    // Send to all connected clients
    global.sseConnections.forEach((connection, index) => {
      try {
        connection.write(`data: ${message}\n\n`);
      } catch (error) {
        console.error(`❌ Failed to send update to client ${index}:`, error);
        // Remove dead connection
        global.sseConnections.splice(index, 1);
      }
    });
  }
};

// Export router as default and broadcastThemeUpdate as named export
module.exports = router;
module.exports.broadcastThemeUpdate = broadcastThemeUpdate;