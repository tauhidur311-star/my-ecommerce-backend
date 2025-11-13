const AnalyticsAggregations = require('../utils/aggregations');
const Contact = require('../models/Contact');
const VisitorEvent = require('../models/VisitorEvent');

// Store SSE clients
const clients = [];

// SSE handler for real-time updates
const sseHandler = (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
  
  res.flushHeaders();
  
  // Add client to the list
  clients.push(res);
  
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date() })}\n\n`);
  
  // Remove client on disconnect
  req.on('close', () => {
    const index = clients.indexOf(res);
    if (index !== -1) {
      clients.splice(index, 1);
    }
  });
};

// Broadcast function to send updates to all connected clients
const broadcast = (event, payload) => {
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  
  clients.forEach((client, index) => {
    try {
      client.write(message);
    } catch (error) {
      console.error('Error sending SSE message:', error);
      // Remove disconnected client
      clients.splice(index, 1);
    }
  });
};

// Analytics summary endpoint
const getSummary = async (req, res) => {
  try {
    const [activeSessions, todayStats, viewsPerMinute, submissionsPerMinute] = await Promise.all([
      AnalyticsAggregations.getActiveSessions(),
      AnalyticsAggregations.getTodayStats(),
      AnalyticsAggregations.getViewsPerMinute(),
      AnalyticsAggregations.getSubmissionsPerMinute()
    ]);

    const summary = {
      activeSessions,
      todayViews: todayStats.todayViews,
      todaySubmissions: todayStats.todaySubmissions,
      viewsPerMinute,
      submissionsPerMinute
    };

    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Error fetching analytics summary:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch analytics summary' });
  }
};

// Charts data endpoint
const getCharts = async (req, res) => {
  try {
    const { range = '7d', type = 'views' } = req.query;
    
    let days;
    switch (range) {
      case '7d':
        days = 7;
        break;
      case '30d':
        days = 30;
        break;
      case '90d':
        days = 90;
        break;
      default:
        days = 7;
    }

    let data;
    if (type === 'views') {
      data = await AnalyticsAggregations.getDailyViews(days);
    } else if (type === 'submissions') {
      data = await AnalyticsAggregations.getDailySubmissions(days);
    } else {
      return res.status(400).json({ success: false, error: 'Invalid chart type' });
    }

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching chart data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch chart data' });
  }
};

// Top pages endpoint
const getTopPages = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const data = await AnalyticsAggregations.getTopPages(parseInt(limit));
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching top pages:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch top pages' });
  }
};

// Top referrers endpoint
const getReferrers = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const data = await AnalyticsAggregations.getTopReferrers(parseInt(limit));
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching referrers:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch referrers' });
  }
};

// Device breakdown endpoint
const getDevices = async (req, res) => {
  try {
    const data = await AnalyticsAggregations.getDeviceBreakdown();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching device data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch device data' });
  }
};

// Geographic data endpoint
const getGeo = async (req, res) => {
  try {
    const { top = 10 } = req.query;
    const data = await AnalyticsAggregations.getGeoData(parseInt(top));
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching geographic data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch geographic data' });
  }
};

// Recent submissions endpoint
const getRecentSubmissions = async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const submissions = await Contact.find()
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .select('name email subject message createdAt status')
      .lean();

    res.json({ success: true, data: submissions });
  } catch (error) {
    console.error('Error fetching recent submissions:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch recent submissions' });
  }
};

// Helper function to track visitor event
const trackVisitorEvent = async (sessionId, page, referrer, userAgent, country, deviceType, ipAddress) => {
  try {
    const visitorEvent = new VisitorEvent({
      sessionId,
      page,
      referrer,
      userAgent,
      country,
      deviceType,
      ipAddress
    });
    
    await visitorEvent.save();
    
    // Broadcast real-time update
    broadcast('visitor-event', {
      page,
      sessionId,
      country,
      deviceType,
      timestamp: new Date()
    });
    
    return visitorEvent;
  } catch (error) {
    console.error('Error tracking visitor event:', error);
    throw error;
  }
};

// Helper function to broadcast new submission
const broadcastNewSubmission = (submission) => {
  broadcast('new-submission', {
    submissionId: submission._id,
    name: submission.name,
    email: submission.email,
    subject: submission.subject,
    submittedAt: submission.createdAt
  });
};

// Helper function to broadcast metric updates
const broadcastMetricUpdate = async () => {
  try {
    const [activeSessions, viewsPerMinute, submissionsPerMinute] = await Promise.all([
      AnalyticsAggregations.getActiveSessions(),
      AnalyticsAggregations.getViewsPerMinute(),
      AnalyticsAggregations.getSubmissionsPerMinute()
    ]);

    broadcast('metric-update', {
      activeSessions,
      viewsPerMinute,
      submissionsPerMinute,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error broadcasting metric update:', error);
  }
};

module.exports = {
  sseHandler,
  broadcast,
  getSummary,
  getCharts,
  getTopPages,
  getReferrers,
  getDevices,
  getGeo,
  getRecentSubmissions,
  trackVisitorEvent,
  broadcastNewSubmission,
  broadcastMetricUpdate
};