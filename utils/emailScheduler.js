const cron = require('node-cron');
const EmailCampaign = require('../models/EmailCampaign');
const EmailEvent = require('../models/EmailEvent');
const User = require('../models/User');
const mailjetService = require('./mailjetEmailService');
const { notifyAdmins } = require('./socket');

class EmailScheduler {
  constructor() {
    this.scheduledJobs = new Map();
    this.init();
  }

  init() {
    console.log('📧 Email Scheduler initialized');
    
    // Start cleanup job for completed campaigns
    this.startCleanupJob();
    
    // Resume any scheduled campaigns on server restart
    this.resumeScheduledCampaigns();
  }

  // Schedule a campaign to be sent at a specific time
  scheduleCampaign(campaignId, scheduledAt) {
    try {
      const scheduleDate = new Date(scheduledAt);
      const now = new Date();

      if (scheduleDate <= now) {
        throw new Error('Scheduled time must be in the future');
      }

      // Convert to cron format (minute hour day month day-of-week)
      const cronExpression = this.dateToCronExpression(scheduleDate);
      
      const task = cron.schedule(cronExpression, async () => {
        console.log(`📧 Executing scheduled campaign: ${campaignId}`);
        await this.sendCampaignNow(campaignId);
        
        // Remove from scheduled jobs after execution
        this.scheduledJobs.delete(campaignId.toString());
      }, {
        scheduled: true,
        timezone: process.env.TIMEZONE || 'UTC'
      });

      const jobId = `campaign_${campaignId}_${Date.now()}`;
      this.scheduledJobs.set(campaignId.toString(), {
        task,
        jobId,
        scheduledAt: scheduleDate
      });

      console.log(`📅 Campaign ${campaignId} scheduled for ${scheduleDate}`);
      return jobId;
    } catch (error) {
      console.error('Error scheduling campaign:', error);
      throw error;
    }
  }

  // Cancel a scheduled campaign
  cancelScheduledCampaign(campaignId) {
    const job = this.scheduledJobs.get(campaignId.toString());
    if (job) {
      job.task.stop();
      job.task.destroy();
      this.scheduledJobs.delete(campaignId.toString());
      console.log(`❌ Cancelled scheduled campaign: ${campaignId}`);
      return true;
    }
    return false;
  }

  // Send campaign immediately
  async sendCampaignNow(campaignId) {
    try {
      const campaign = await EmailCampaign.findById(campaignId);
      
      if (!campaign) {
        throw new Error('Campaign not found');
      }

      if (campaign.status === 'sent') {
        console.log(`Campaign ${campaignId} already sent`);
        return;
      }

      console.log(`📧 Starting to send campaign: ${campaign.name}`);
      
      // Update campaign status
      campaign.status = 'sending';
      campaign.sentAt = new Date();
      await campaign.save();

      // Get recipient list
      const recipients = await this.getRecipients(campaign);
      
      if (recipients.length === 0) {
        campaign.status = 'failed';
        await campaign.save();
        throw new Error('No recipients found for campaign');
      }

      // Send emails in batches to avoid overwhelming the email service
      const batchSize = 50;
      let successCount = 0;
      let failureCount = 0;

      for (let i = 0; i < recipients.length; i += batchSize) {
        const batch = recipients.slice(i, i + batchSize);
        
        const results = await Promise.allSettled(
          batch.map(recipient => this.sendEmailToRecipient(campaign, recipient))
        );

        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            successCount++;
          } else {
            failureCount++;
            console.error(`Failed to send to ${batch[index].email}:`, result.reason);
          }
        });

        // Add delay between batches
        if (i + batchSize < recipients.length) {
          await this.delay(1000); // 1 second delay
        }
      }

      // Update campaign analytics
      campaign.analytics.totalSent = successCount;
      campaign.status = 'sent';
      await campaign.save();

      // Notify admins
      notifyAdmins('campaign_sent', {
        campaignId: campaign._id,
        campaignName: campaign.name,
        totalSent: successCount,
        failures: failureCount
      });

      console.log(`✅ Campaign ${campaign.name} sent to ${successCount} recipients`);
      
    } catch (error) {
      console.error('Error sending campaign:', error);
      
      // Update campaign status to failed
      try {
        await EmailCampaign.findByIdAndUpdate(campaignId, { 
          status: 'failed' 
        });
      } catch (updateError) {
        console.error('Error updating campaign status:', updateError);
      }
      
      throw error;
    }
  }

  // Get recipients based on campaign settings
  async getRecipients(campaign) {
    let recipients = [];

    if (campaign.recipientList && campaign.recipientList.length > 0) {
      // Use predefined recipient list
      recipients = campaign.recipientList.map(r => ({
        email: r.email,
        name: r.name || '',
        customVariables: r.customVariables || {}
      }));
    } else {
      // Build recipient list based on filter
      const filter = campaign.recipientFilter;
      
      switch (filter.type) {
        case 'all':
          const allUsers = await User.find({ 
            isActive: true,
            email: { $exists: true, $ne: '' }
          }).select('email name');
          
          recipients = allUsers.map(user => ({
            email: user.email,
            name: user.name,
            customVariables: {}
          }));
          break;

        case 'customers':
          const customers = await User.find({ 
            isActive: true,
            email: { $exists: true, $ne: '' },
            role: 'customer'
          }).select('email name');
          
          recipients = customers.map(user => ({
            email: user.email,
            name: user.name,
            customVariables: {}
          }));
          break;

        case 'custom':
          // Implement custom filtering based on criteria
          const customUsers = await this.getCustomRecipients(filter.criteria);
          recipients = customUsers;
          break;
      }
    }

    return recipients;
  }

  // Send email to individual recipient
  async sendEmailToRecipient(campaign, recipient) {
    try {
      // Replace variables in content
      let htmlContent = campaign.htmlContent;
      let subject = campaign.subject;

      // Replace standard variables
      const variables = {
        name: recipient.name || 'Valued Customer',
        email: recipient.email,
        unsubscribe_url: `${process.env.FRONTEND_URL}/unsubscribe?email=${encodeURIComponent(recipient.email)}`,
        ...recipient.customVariables
      };

      Object.entries(variables).forEach(([key, value]) => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        htmlContent = htmlContent.replace(regex, value);
        subject = subject.replace(regex, value);
      });

      // Add tracking pixels if enabled
      if (campaign.settings.trackOpens) {
        const trackingPixel = `<img src="${process.env.API_URL}/api/email/track/open/${campaign._id}/${encodeURIComponent(recipient.email)}" width="1" height="1" style="display:none;" />`;
        htmlContent = htmlContent.replace('</body>', `${trackingPixel}</body>`);
      }

      // Send email via Mailjet
      const result = await mailjetService.sendEmail({
        to: recipient.email,
        subject: subject,
        html: htmlContent,
        fromName: campaign.settings.fromName,
        replyTo: campaign.settings.replyTo
      });

      // Record sent event
      await EmailEvent.create({
        campaignId: campaign._id,
        recipientEmail: recipient.email,
        eventType: 'sent',
        messageId: result.messageId || '',
        mailjetMessageId: result.mailjetMessageId || '',
        eventData: {
          timestamp: new Date()
        }
      });

      return result;
    } catch (error) {
      console.error(`Error sending email to ${recipient.email}:`, error);
      throw error;
    }
  }

  // Convert date to cron expression
  dateToCronExpression(date) {
    const minute = date.getMinutes();
    const hour = date.getHours();
    const day = date.getDate();
    const month = date.getMonth() + 1;
    
    // Format: minute hour day month day-of-week
    return `${minute} ${hour} ${day} ${month} *`;
  }

  // Resume scheduled campaigns after server restart
  async resumeScheduledCampaigns() {
    try {
      // Wait for database connection
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
        console.log('⏳ Waiting for database connection before resuming campaigns...');
        return;
      }

      const scheduledCampaigns = await EmailCampaign.find({
        status: 'scheduled',
        scheduledAt: { $gt: new Date() },
        isActive: true
      });

      console.log(`📧 Resuming ${scheduledCampaigns.length} scheduled campaigns`);

      for (const campaign of scheduledCampaigns) {
        try {
          const jobId = this.scheduleCampaign(campaign._id, campaign.scheduledAt);
          campaign.cronJobId = jobId;
          await campaign.save();
        } catch (error) {
          console.error(`Error resuming campaign ${campaign._id}:`, error);
          // Mark as failed if can't reschedule
          campaign.status = 'failed';
          await campaign.save();
        }
      }
    } catch (error) {
      console.error('Error resuming scheduled campaigns:', error);
    }
  }

  // Cleanup job for old data
  startCleanupJob() {
    // Run cleanup every day at 2 AM
    cron.schedule('0 2 * * *', async () => {
      console.log('🧹 Running email campaign cleanup...');
      
      try {
        // Clean up old email events (older than 90 days)
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 90);
        
        const deletedEvents = await EmailEvent.deleteMany({
          createdAt: { $lt: cutoffDate }
        });
        
        console.log(`🧹 Cleaned up ${deletedEvents.deletedCount} old email events`);
      } catch (error) {
        console.error('Cleanup job error:', error);
      }
    });
  }

  // Get custom recipients based on criteria
  async getCustomRecipients(criteria) {
    // This can be extended based on your needs
    // For now, return empty array
    return [];
  }

  // Utility delay function
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get all scheduled jobs info
  getScheduledJobs() {
    const jobs = [];
    this.scheduledJobs.forEach((job, campaignId) => {
      jobs.push({
        campaignId,
        jobId: job.jobId,
        scheduledAt: job.scheduledAt
      });
    });
    return jobs;
  }
}

// Export singleton instance
module.exports = new EmailScheduler();