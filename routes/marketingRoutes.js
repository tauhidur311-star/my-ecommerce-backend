const express = require('express');
const router = express.Router();
const EmailCampaign = require('../models/EmailCampaign');
const User = require('../models/User');
const { adminAuth } = require('../middleware/adminAuth');
const { rateLimit } = require('../middleware/rateLimit');

// Apply admin authentication
router.use(adminAuth);

// Get all campaigns with analytics
router.get('/campaigns', rateLimit(100), async (req, res) => {
  try {
    const { status, type, page = 1, limit = 20 } = req.query;
    
    const query = {};
    if (status && status !== 'all') query.status = status;
    if (type && type !== 'all') query.type = type;

    const campaigns = await EmailCampaign.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('createdBy', 'name email');

    const total = await EmailCampaign.countDocuments(query);

    res.json({
      success: true,
      data: {
        campaigns,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });
  } catch (error) {
    console.error('Get campaigns error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch campaigns',
      error: error.message 
    });
  }
});

// Create new campaign
router.post('/campaigns', rateLimit(20), async (req, res) => {
  try {
    const {
      name,
      type = 'email',
      subject,
      content,
      targetSegment = 'all',
      scheduledAt,
      status = 'draft'
    } = req.body;

    // Get target audience count
    let targetAudience = 0;
    if (targetSegment === 'all') {
      targetAudience = await User.countDocuments({ role: { $ne: 'admin' } });
    } else {
      // Calculate based on segment - simplified for now
      targetAudience = await User.countDocuments({ 
        role: { $ne: 'admin' }
        // Add segment filtering logic here
      });
    }

    const campaign = new EmailCampaign({
      name,
      type,
      subject,
      content,
      targetSegment,
      targetAudience,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      status,
      createdBy: req.user.id,
      analytics: {
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        bounced: 0,
        unsubscribed: 0
      }
    });

    await campaign.save();

    // If status is active, start sending immediately
    if (status === 'active') {
      // TODO: Implement campaign sending logic
      campaign.status = 'active';
      campaign.sentAt = new Date();
      await campaign.save();
    }

    res.json({
      success: true,
      message: 'Campaign created successfully',
      data: { campaign }
    });
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create campaign',
      error: error.message 
    });
  }
});

// Update campaign status
router.put('/campaigns/:campaignId/:action', rateLimit(50), async (req, res) => {
  try {
    const { campaignId, action } = req.params;
    
    const campaign = await EmailCampaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    switch (action) {
      case 'start':
        campaign.status = 'active';
        campaign.sentAt = new Date();
        break;
      case 'pause':
        campaign.status = 'paused';
        break;
      case 'resume':
        campaign.status = 'active';
        break;
      case 'stop':
        campaign.status = 'completed';
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid action'
        });
    }

    await campaign.save();

    res.json({
      success: true,
      message: `Campaign ${action}ed successfully`,
      data: { campaign }
    });
  } catch (error) {
    console.error('Update campaign error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update campaign',
      error: error.message 
    });
  }
});

// Delete campaign
router.delete('/campaigns/:campaignId', rateLimit(20), async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    const campaign = await EmailCampaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    // Only allow deletion of draft campaigns
    if (campaign.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft campaigns can be deleted'
      });
    }

    await EmailCampaign.findByIdAndDelete(campaignId);

    res.json({
      success: true,
      message: 'Campaign deleted successfully'
    });
  } catch (error) {
    console.error('Delete campaign error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete campaign',
      error: error.message 
    });
  }
});

// Get campaign analytics
router.get('/campaigns/:campaignId/analytics', rateLimit(100), async (req, res) => {
  try {
    const { campaignId } = req.params;
    
    const campaign = await EmailCampaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: 'Campaign not found'
      });
    }

    // Calculate additional analytics
    const analytics = {
      ...campaign.analytics,
      openRate: campaign.analytics.sent > 0 ? 
        ((campaign.analytics.opened / campaign.analytics.sent) * 100).toFixed(2) : 0,
      clickRate: campaign.analytics.sent > 0 ? 
        ((campaign.analytics.clicked / campaign.analytics.sent) * 100).toFixed(2) : 0,
      bounceRate: campaign.analytics.sent > 0 ? 
        ((campaign.analytics.bounced / campaign.analytics.sent) * 100).toFixed(2) : 0,
      unsubscribeRate: campaign.analytics.sent > 0 ? 
        ((campaign.analytics.unsubscribed / campaign.analytics.sent) * 100).toFixed(2) : 0
    };

    res.json({
      success: true,
      data: { analytics }
    });
  } catch (error) {
    console.error('Get campaign analytics error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch campaign analytics',
      error: error.message 
    });
  }
});

// Get marketing analytics overview
router.get('/analytics', rateLimit(100), async (req, res) => {
  try {
    const { range = '30d' } = req.query;
    
    // Get date range
    const now = new Date();
    let startDate;
    switch (range) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get campaign analytics
    const campaignStats = await EmailCampaign.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: now }
        }
      },
      {
        $group: {
          _id: null,
          totalCampaigns: { $sum: 1 },
          totalSent: { $sum: '$analytics.sent' },
          totalOpened: { $sum: '$analytics.opened' },
          totalClicked: { $sum: '$analytics.clicked' },
          totalBounced: { $sum: '$analytics.bounced' }
        }
      }
    ]);

    const stats = campaignStats[0] || {
      totalCampaigns: 0,
      totalSent: 0,
      totalOpened: 0,
      totalClicked: 0,
      totalBounced: 0
    };

    // Calculate rates
    const analytics = {
      totalSent: stats.totalSent,
      avgOpenRate: stats.totalSent > 0 ? 
        ((stats.totalOpened / stats.totalSent) * 100).toFixed(1) : 0,
      avgClickRate: stats.totalSent > 0 ? 
        ((stats.totalClicked / stats.totalSent) * 100).toFixed(1) : 0,
      bounceRate: stats.totalSent > 0 ? 
        ((stats.totalBounced / stats.totalSent) * 100).toFixed(1) : 0,
      sentGrowth: 0, // Calculate based on previous period
      openRateGrowth: 0 // Calculate based on previous period
    };

    // Get campaign performance over time
    const chartData = await EmailCampaign.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: now },
          status: { $in: ['active', 'completed'] }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt'
            }
          },
          sent: { $sum: '$analytics.sent' },
          opened: { $sum: '$analytics.opened' },
          clicked: { $sum: '$analytics.clicked' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    res.json({
      success: true,
      data: {
        analytics: {
          ...analytics,
          chartData: chartData.map(item => ({
            date: item._id,
            sent: item.sent,
            opened: item.opened,
            clicked: item.clicked
          }))
        }
      }
    });
  } catch (error) {
    console.error('Get marketing analytics error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch marketing analytics',
      error: error.message 
    });
  }
});

module.exports = router;