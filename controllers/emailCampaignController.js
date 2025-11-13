const EmailCampaign = require('../models/EmailCampaign');
const EmailEvent = require('../models/EmailEvent');
const User = require('../models/User');
const mailjetService = require('../utils/mailjetEmailService');
const emailScheduler = require('../utils/emailScheduler');
const { notifyAdmins } = require('../utils/socket');

// @desc    Get all email campaigns
// @route   GET /api/admin/email-campaigns
// @access  Private/Admin
const getCampaigns = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status;
    const search = req.query.search;

    let query = { isActive: true };

    if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (page - 1) * limit;

    const campaigns = await EmailCampaign.find(query)
      .populate('createdBy', 'name email')
      .populate('lastModifiedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await EmailCampaign.countDocuments(query);

    res.json({
      success: true,
      data: {
        campaigns,
        pagination: {
          current: page,
          pages: Math.ceil(total / limit),
          total,
          limit
        }
      }
    });
  } catch (error) {
    console.error('Get campaigns error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch campaigns'
    });
  }
};

// @desc    Get single email campaign
// @route   GET /api/admin/email-campaigns/:id
// @access  Private/Admin
const getCampaign = async (req, res) => {
  try {
    const campaign = await EmailCampaign.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('lastModifiedBy', 'name email')
      .populate('templateId', 'name');

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    res.json({
      success: true,
      data: campaign
    });
  } catch (error) {
    console.error('Get campaign error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch campaign'
    });
  }
};

// @desc    Create new email campaign
// @route   POST /api/admin/email-campaigns
// @access  Private/Admin
const createCampaign = async (req, res) => {
  try {
    const {
      name,
      subject,
      htmlContent,
      textContent,
      templateId,
      recipientList,
      recipientFilter,
      scheduledAt,
      settings
    } = req.body;

    // Validate required fields
    if (!name || !subject || !htmlContent) {
      return res.status(400).json({
        success: false,
        error: 'Name, subject, and content are required'
      });
    }

    const campaignData = {
      name,
      subject,
      htmlContent,
      textContent,
      templateId: templateId || null,
      recipientList: recipientList || [],
      recipientFilter: recipientFilter || { type: 'all', criteria: {} },
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      settings: {
        trackOpens: true,
        trackClicks: true,
        replyTo: process.env.REPLY_TO_EMAIL || '',
        fromName: process.env.APP_NAME || 'StyleShop',
        ...settings
      },
      createdBy: req.user.id,
      lastModifiedBy: req.user.id
    };

    const campaign = new EmailCampaign(campaignData);
    await campaign.save();

    // Populate created campaign
    await campaign.populate('createdBy', 'name email');

    // If scheduled, set up the cron job
    if (scheduledAt && new Date(scheduledAt) > new Date()) {
      const jobId = emailScheduler.scheduleCampaign(campaign._id, scheduledAt);
      campaign.cronJobId = jobId;
      campaign.status = 'scheduled';
      await campaign.save();
    }

    // Notify admins
    notifyAdmins('campaign_created', {
      campaignId: campaign._id,
      campaignName: campaign.name,
      createdBy: req.user.name
    });

    res.status(201).json({
      success: true,
      data: campaign,
      message: 'Campaign created successfully'
    });
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create campaign'
    });
  }
};

// @desc    Update email campaign
// @route   PUT /api/admin/email-campaigns/:id
// @access  Private/Admin
const updateCampaign = async (req, res) => {
  try {
    const campaign = await EmailCampaign.findById(req.params.id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    // Don't allow editing of sent campaigns
    if (campaign.status === 'sent' || campaign.status === 'sending') {
      return res.status(400).json({
        success: false,
        error: 'Cannot edit sent or sending campaigns'
      });
    }

    const updates = { ...req.body };
    updates.lastModifiedBy = req.user.id;

    // Handle scheduling updates
    if (updates.scheduledAt) {
      const newScheduledAt = new Date(updates.scheduledAt);
      
      // Cancel existing cron job if exists
      if (campaign.cronJobId) {
        emailScheduler.cancelScheduledCampaign(campaign.cronJobId);
      }

      if (newScheduledAt > new Date()) {
        const jobId = emailScheduler.scheduleCampaign(campaign._id, newScheduledAt);
        updates.cronJobId = jobId;
        updates.status = 'scheduled';
      } else {
        updates.cronJobId = null;
        updates.status = 'draft';
      }
    }

    const updatedCampaign = await EmailCampaign.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email')
     .populate('lastModifiedBy', 'name email');

    res.json({
      success: true,
      data: updatedCampaign,
      message: 'Campaign updated successfully'
    });
  } catch (error) {
    console.error('Update campaign error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update campaign'
    });
  }
};

// @desc    Delete email campaign
// @route   DELETE /api/admin/email-campaigns/:id
// @access  Private/Admin
const deleteCampaign = async (req, res) => {
  try {
    const campaign = await EmailCampaign.findById(req.params.id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    // Don't allow deletion of sending campaigns
    if (campaign.status === 'sending') {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete campaigns that are currently sending'
      });
    }

    // Cancel scheduled job if exists
    if (campaign.cronJobId) {
      emailScheduler.cancelScheduledCampaign(campaign.cronJobId);
    }

    // Soft delete
    campaign.isActive = false;
    campaign.status = 'cancelled';
    await campaign.save();

    res.json({
      success: true,
      message: 'Campaign deleted successfully'
    });
  } catch (error) {
    console.error('Delete campaign error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete campaign'
    });
  }
};

// @desc    Send campaign immediately
// @route   POST /api/admin/email-campaigns/:id/send
// @access  Private/Admin
const sendCampaign = async (req, res) => {
  try {
    const campaign = await EmailCampaign.findById(req.params.id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    if (campaign.status === 'sent' || campaign.status === 'sending') {
      return res.status(400).json({
        success: false,
        error: 'Campaign already sent or sending'
      });
    }

    // Cancel scheduled job if exists
    if (campaign.cronJobId) {
      emailScheduler.cancelScheduledCampaign(campaign.cronJobId);
      campaign.cronJobId = null;
    }

    // Start sending process
    campaign.status = 'sending';
    await campaign.save();

    // Send in background
    emailScheduler.sendCampaignNow(campaign._id);

    res.json({
      success: true,
      message: 'Campaign sending started'
    });
  } catch (error) {
    console.error('Send campaign error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start sending campaign'
    });
  }
};

// @desc    Get campaign analytics
// @route   GET /api/admin/email-campaigns/:id/analytics
// @access  Private/Admin
const getCampaignAnalytics = async (req, res) => {
  try {
    const campaign = await EmailCampaign.findById(req.params.id);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    // Get detailed event analytics
    const eventAnalytics = await EmailEvent.aggregateCampaignAnalytics(campaign._id);
    
    // Get recent events
    const recentEvents = await EmailEvent.getCampaignEvents(campaign._id)
      .limit(50);

    res.json({
      success: true,
      data: {
        campaign: {
          id: campaign._id,
          name: campaign.name,
          status: campaign.status,
          sentAt: campaign.sentAt
        },
        summary: campaign.analytics,
        eventAnalytics,
        recentEvents
      }
    });
  } catch (error) {
    console.error('Get campaign analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch campaign analytics'
    });
  }
};

// @desc    Get campaigns dashboard stats
// @route   GET /api/admin/email-campaigns/stats
// @access  Private/Admin
const getCampaignStats = async (req, res) => {
  try {
    const stats = await EmailCampaign.getCampaignStats();
    
    // Get status distribution
    const statusStats = await EmailCampaign.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    // Recent activity
    const recentCampaigns = await EmailCampaign.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('createdBy', 'name');

    res.json({
      success: true,
      data: {
        summary: stats,
        statusDistribution: statusStats,
        recentCampaigns
      }
    });
  } catch (error) {
    console.error('Get campaign stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch campaign stats'
    });
  }
};

module.exports = {
  getCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  sendCampaign,
  getCampaignAnalytics,
  getCampaignStats
};