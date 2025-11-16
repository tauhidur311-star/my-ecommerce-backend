const express = require('express');
const mongoose = require('mongoose');
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
    
    console.log('📤 Sending theme data:', themeData);
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

// Add missing routes for complete theme system

// Get all published pages
router.get('/public/theme/pages', async (req, res) => {
  try {
    console.log('📥 Fetching all published pages');
    
    const publishedPages = await Page.find({ 
      published: true 
    }).select('page_name slug template_type published_at updatedAt');
    
    res.json({
      success: true,
      data: publishedPages.map(page => ({
        name: page.page_name,
        slug: page.slug,
        type: page.template_type,
        publishedAt: page.published_at,
        lastUpdated: page.updatedAt
      }))
    });
    
  } catch (error) {
    console.error('❌ Error fetching published pages:', error);
    res.status(500).json({ 
      success: false,
      error: 'Server error', 
      message: error.message 
    });
  }
});

// ✅ ENHANCED: Save and publish page (from ThemeEditor)
router.post('/api/pages/publish', async (req, res) => {
  try {
    console.log('📥 Publishing page - Raw body received:');
    console.log('📤 COMPLETE REQUEST BODY:', JSON.stringify(req.body, null, 2));
    
    // ✅ ENHANCED: Extract all fields that frontend sends
    const { 
      page_name, 
      page_type, 
      slug, 
      template_type, 
      sections, 
      themeSettings, 
      user_id,
      published = true 
    } = req.body;
    
    console.log('📋 Extracted fields:', {
      page_name,
      page_type, 
      slug,
      template_type,
      user_id: user_id ? 'PROVIDED' : 'MISSING',
      sections_count: sections?.length || 0,
      themeSettings: themeSettings ? 'PROVIDED' : 'MISSING'
    });
    
    // ✅ FIX: Use correct user_id from req.user (backend logs show req.user.userId, not req.user.id)
    if (!req.user || !req.user.userId) {
      console.error('❌ Authentication failed - req.user missing or invalid:', req.user);
      return res.status(401).json({ 
        success: false,
        error: 'Authentication required',
        message: 'User must be authenticated to create/update pages'
      });
    }
    
    const finalUserId = req.user.userId; // ✅ BACKEND PROVIDES: Use server-side user_id, ignore frontend user_id
    
    console.log('🔍 Looking for existing page:', {
      template_type: page_type || template_type,
      authenticated_user_id: finalUserId,
      req_user_data: req.user
    });
    
    let page = await Page.findOne({ 
      template_type: page_type || template_type,
      ...(finalUserId && { user_id: finalUserId })
    });
    
    console.log('🔍 Existing page found:', page ? 'YES' : 'NO');
    
    if (!page) {
      console.log('➕ Creating new page with authenticated user:', {
        user_id: finalUserId,
        page_name: page_name || page_type,
        slug: slug,
        template_type: page_type || template_type
      });
      
      // ✅ CREATE PAGE WITH AUTHENTICATED USER_ID
      page = new Page({
        user_id: finalUserId, // ✅ REQUIRED FIELD: Set from authenticated user
        page_name: page_name || page_type,
        slug: slug,
        template_type: page_type || template_type
      });
    } else {
      console.log('📝 Updating existing page:', {
        existing_page_id: page._id,
        current_user_id: page.user_id,
        authenticated_user_id: finalUserId
      });
      
      // ✅ SECURITY: Verify user owns the page they're updating
      if (page.user_id.toString() !== finalUserId.toString()) {
        console.error('❌ User trying to update page they don\'t own');
        return res.status(403).json({
          success: false,
          error: 'Access denied',
          message: 'You can only edit pages you created'
        });
      }
    }
    
    // ✅ ENHANCED: Process sections with proper field mapping
    console.log('🔧 Processing sections data...');
    
    page.sections = sections.map((section, index) => {
      console.log(`📋 Processing section ${index}:`, {
        has_section_id: !!section.section_id,
        has_id: !!section.id,
        type: section.type,
        blocks_count: section.blocks?.length || 0
      });
      
      const processedSection = {
        section_id: section.section_id || section.id, // ✅ Use section_id from frontend
        type: section.type,
        content: section.content || '',
        order: index,
        visible: section.visible !== false,
        settings: section.settings || {},
        blocks: section.blocks ? section.blocks.map((block, blockIndex) => {
          console.log(`  🔧 Processing block ${blockIndex}:`, {
            has_block_id: !!block.block_id,
            has_id: !!block.id,
            type: block.type
          });
          
          return {
            block_id: block.block_id || block.id, // ✅ Use block_id from frontend (required field)
            type: block.type,
            content: block.content || '',
            settings: block.settings || {},
            order: blockIndex
          };
        }) : []
      };
      
      console.log(`✅ Section ${index} processed:`, {
        section_id: processedSection.section_id,
        type: processedSection.type,
        blocks_count: processedSection.blocks.length,
        all_blocks_have_block_id: processedSection.blocks.every(b => b.block_id)
      });
      
      return processedSection;
    });
    
    // ✅ ENHANCED: Update remaining page fields and auto-publish
    page.page_name = page_name || page.page_name;
    page.slug = slug || page.slug;
    page.theme_settings = themeSettings || {};
    page.published = true; // ✅ AUTO-PUBLISH: Always publish from theme editor
    page.published_at = new Date();
    page.is_active = true;
    
    console.log('💾 Saving page to database...');
    console.log('📊 Final page data before save:', {
      user_id: page.user_id,
      page_name: page.page_name,
      slug: page.slug,
      template_type: page.template_type,
      sections_count: page.sections.length,
      total_blocks: page.sections.reduce((total, s) => total + s.blocks.length, 0)
    });
    
    await page.save();
    console.log('✅ Page saved successfully to database');
    
    // Broadcast update to all connected clients
    const broadcastData = {
      pageType: page_type || template_type,
      sections: page.sections,
      theme_settings: page.theme_settings
    };
    
    broadcastThemeUpdate(page_type || template_type, broadcastData);
    console.log('📡 Broadcast sent to connected clients');
    
    res.json({
      success: true,
      message: 'Page published successfully',
      data: {
        id: page._id,
        page_name: page.page_name,
        slug: page.slug,
        pageType: page.template_type,
        publishedAt: page.published_at,
        sectionsCount: page.sections.length,
        blocksCount: page.sections.reduce((total, s) => total + s.blocks.length, 0)
      }
    });
    
  } catch (error) {
    console.error('❌ Error publishing page:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to publish page', 
      message: error.message 
    });
  }
});

// Export router as default and broadcastThemeUpdate as named export
module.exports = router;
module.exports.broadcastThemeUpdate = broadcastThemeUpdate;