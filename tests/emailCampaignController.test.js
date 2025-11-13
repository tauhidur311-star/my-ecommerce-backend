const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const EmailCampaign = require('../models/EmailCampaign');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Mock email scheduler to prevent actual email sending during tests
jest.mock('../utils/emailScheduler', () => ({
  scheduleCampaign: jest.fn(() => 'mock-job-id'),
  cancelScheduledCampaign: jest.fn(() => true),
  sendCampaignNow: jest.fn()
}));

// Mock socket notifications
jest.mock('../utils/socket', () => ({
  notifyAdmins: jest.fn(),
  notifyUser: jest.fn()
}));

describe('Email Campaign Controller', () => {
  let adminToken;
  let adminUser;
  let testCampaign;

  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/test-db');
    }

    // Create admin user for testing
    adminUser = new User({
      name: 'Admin Test',
      email: 'admin@test.com',
      password: 'hashedpassword',
      role: 'admin',
      isActive: true
    });
    await adminUser.save();

    // Generate admin token
    adminToken = jwt.sign(
      { userId: adminUser._id, role: adminUser.role },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  beforeEach(async () => {
    // Clean up campaigns before each test
    await EmailCampaign.deleteMany({});
    
    // Create test campaign
    testCampaign = new EmailCampaign({
      name: 'Test Campaign',
      subject: 'Test Subject',
      htmlContent: '<h1>Test Content</h1>',
      recipientList: [
        { email: 'test1@example.com', name: 'Test User 1' },
        { email: 'test2@example.com', name: 'Test User 2' }
      ],
      createdBy: adminUser._id,
      lastModifiedBy: adminUser._id
    });
    await testCampaign.save();
  });

  afterEach(async () => {
    // Clean up after each test
    await EmailCampaign.deleteMany({});
  });

  afterAll(async () => {
    // Clean up after all tests
    await User.deleteMany({});
    await mongoose.connection.close();
  });

  describe('GET /api/admin/email-campaigns', () => {
    it('should get all email campaigns', async () => {
      const response = await request(app)
        .get('/api/admin/email-campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.campaigns).toHaveLength(1);
      expect(response.body.data.campaigns[0].name).toBe('Test Campaign');
    });

    it('should filter campaigns by status', async () => {
      // Create another campaign with different status
      const sentCampaign = new EmailCampaign({
        name: 'Sent Campaign',
        subject: 'Sent Subject',
        htmlContent: '<h1>Sent Content</h1>',
        status: 'sent',
        createdBy: adminUser._id
      });
      await sentCampaign.save();

      const response = await request(app)
        .get('/api/admin/email-campaigns?status=sent')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.campaigns).toHaveLength(1);
      expect(response.body.data.campaigns[0].status).toBe('sent');
    });

    it('should search campaigns by name', async () => {
      const response = await request(app)
        .get('/api/admin/email-campaigns?search=Test')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.campaigns).toHaveLength(1);
      expect(response.body.data.campaigns[0].name).toBe('Test Campaign');
    });

    it('should require admin authentication', async () => {
      await request(app)
        .get('/api/admin/email-campaigns')
        .expect(401);
    });
  });

  describe('POST /api/admin/email-campaigns', () => {
    it('should create a new email campaign', async () => {
      const campaignData = {
        name: 'New Campaign',
        subject: 'New Subject',
        htmlContent: '<h1>New Content</h1>',
        recipientList: [
          { email: 'new@example.com', name: 'New User' }
        ]
      };

      const response = await request(app)
        .post('/api/admin/email-campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(campaignData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('New Campaign');
      expect(response.body.data.status).toBe('draft');
    });

    it('should schedule a campaign for future sending', async () => {
      const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
      
      const campaignData = {
        name: 'Scheduled Campaign',
        subject: 'Scheduled Subject',
        htmlContent: '<h1>Scheduled Content</h1>',
        scheduledAt: scheduledAt.toISOString(),
        recipientList: [
          { email: 'scheduled@example.com', name: 'Scheduled User' }
        ]
      };

      const response = await request(app)
        .post('/api/admin/email-campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(campaignData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('scheduled');
      expect(response.body.data.cronJobId).toBe('mock-job-id');
    });

    it('should validate required fields', async () => {
      const invalidCampaignData = {
        name: '',
        subject: 'Subject without name'
      };

      const response = await request(app)
        .post('/api/admin/email-campaigns')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidCampaignData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('validation');
    });
  });

  describe('PUT /api/admin/email-campaigns/:id', () => {
    it('should update an existing campaign', async () => {
      const updateData = {
        name: 'Updated Campaign Name',
        subject: 'Updated Subject'
      };

      const response = await request(app)
        .put(`/api/admin/email-campaigns/${testCampaign._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Updated Campaign Name');
      expect(response.body.data.subject).toBe('Updated Subject');
    });

    it('should not allow editing sent campaigns', async () => {
      // Update campaign status to sent
      testCampaign.status = 'sent';
      await testCampaign.save();

      const updateData = {
        name: 'Should not update'
      };

      const response = await request(app)
        .put(`/api/admin/email-campaigns/${testCampaign._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Cannot edit sent');
    });
  });

  describe('DELETE /api/admin/email-campaigns/:id', () => {
    it('should soft delete a campaign', async () => {
      const response = await request(app)
        .delete(`/api/admin/email-campaigns/${testCampaign._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify soft deletion
      const deletedCampaign = await EmailCampaign.findById(testCampaign._id);
      expect(deletedCampaign.isActive).toBe(false);
      expect(deletedCampaign.status).toBe('cancelled');
    });

    it('should not allow deletion of sending campaigns', async () => {
      testCampaign.status = 'sending';
      await testCampaign.save();

      const response = await request(app)
        .delete(`/api/admin/email-campaigns/${testCampaign._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Cannot delete');
    });
  });

  describe('POST /api/admin/email-campaigns/:id/send', () => {
    it('should start sending a campaign immediately', async () => {
      const response = await request(app)
        .post(`/api/admin/email-campaigns/${testCampaign._id}/send`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('sending started');

      // Verify campaign status updated
      const updatedCampaign = await EmailCampaign.findById(testCampaign._id);
      expect(updatedCampaign.status).toBe('sending');
    });

    it('should not send already sent campaigns', async () => {
      testCampaign.status = 'sent';
      await testCampaign.save();

      const response = await request(app)
        .post(`/api/admin/email-campaigns/${testCampaign._id}/send`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('already sent');
    });
  });

  describe('GET /api/admin/email-campaigns/:id/analytics', () => {
    it('should get campaign analytics', async () => {
      // Set some analytics data
      testCampaign.analytics.totalSent = 100;
      testCampaign.analytics.totalOpened = 50;
      testCampaign.analytics.totalClicked = 25;
      await testCampaign.save();

      const response = await request(app)
        .get(`/api/admin/email-campaigns/${testCampaign._id}/analytics`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.summary.totalSent).toBe(100);
      expect(response.body.data.summary.totalOpened).toBe(50);
      expect(response.body.data.summary.totalClicked).toBe(25);
    });
  });

  describe('GET /api/admin/email-campaigns/stats', () => {
    it('should get campaign dashboard stats', async () => {
      const response = await request(app)
        .get('/api/admin/email-campaigns/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('summary');
      expect(response.body.data).toHaveProperty('statusDistribution');
      expect(response.body.data).toHaveProperty('recentCampaigns');
    });
  });
});