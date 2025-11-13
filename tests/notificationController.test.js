const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const Notification = require('../models/Notification');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Mock socket notifications
jest.mock('../utils/socket', () => ({
  notifyUser: jest.fn(),
  notifyAdmins: jest.fn(),
  broadcastToAll: jest.fn()
}));

const { notifyUser, notifyAdmins, broadcastToAll } = require('../utils/socket');

describe('Notification Controller', () => {
  let adminToken;
  let adminUser;
  let testUser;

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

    // Create test user
    testUser = new User({
      name: 'Test User',
      email: 'user@test.com',
      password: 'hashedpassword',
      role: 'customer',
      isActive: true
    });
    await testUser.save();

    // Generate admin token
    adminToken = jwt.sign(
      { userId: adminUser._id, role: adminUser.role },
      process.env.JWT_SECRET || 'test-secret',
      { expiresIn: '1h' }
    );
  });

  beforeEach(async () => {
    // Clean up notifications before each test
    await Notification.deleteMany({});
    
    // Clear mock function calls
    jest.clearAllMocks();
  });

  afterAll(async () => {
    // Clean up after all tests
    await User.deleteMany({});
    await Notification.deleteMany({});
    await mongoose.connection.close();
  });

  describe('POST /api/admin/notifications', () => {
    it('should create a user notification', async () => {
      const notificationData = {
        title: 'Test Notification',
        message: 'This is a test notification',
        type: 'info',
        recipient: testUser._id,
        recipientType: 'user',
        actionUrl: '/dashboard',
        priority: 'normal'
      };

      const response = await request(app)
        .post('/api/admin/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(notificationData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('Test Notification');
      expect(response.body.data.recipient.toString()).toBe(testUser._id.toString());

      // Verify real-time notification was sent
      expect(notifyUser).toHaveBeenCalledWith(
        testUser._id.toString(),
        'notification',
        expect.objectContaining({
          title: 'Test Notification',
          message: 'This is a test notification',
          type: 'info'
        })
      );
    });

    it('should create an admin notification', async () => {
      const notificationData = {
        title: 'Admin Alert',
        message: 'This is an admin notification',
        type: 'warning',
        recipientType: 'admin'
      };

      const response = await request(app)
        .post('/api/admin/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(notificationData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('Admin Alert');
      expect(response.body.data.recipientType).toBe('admin');

      // Verify admin notification was sent
      expect(notifyAdmins).toHaveBeenCalledWith(
        'notification',
        expect.objectContaining({
          title: 'Admin Alert',
          message: 'This is an admin notification',
          type: 'warning'
        })
      );
    });

    it('should create a broadcast notification', async () => {
      const notificationData = {
        title: 'System Announcement',
        message: 'System maintenance scheduled',
        type: 'info',
        recipientType: 'broadcast'
      };

      const response = await request(app)
        .post('/api/admin/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(notificationData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('System Announcement');
      expect(response.body.data.recipientType).toBe('broadcast');

      // Verify broadcast notification was sent
      expect(broadcastToAll).toHaveBeenCalledWith(
        'notification',
        expect.objectContaining({
          title: 'System Announcement',
          message: 'System maintenance scheduled',
          type: 'info'
        })
      );
    });

    it('should validate required fields', async () => {
      const invalidData = {
        message: 'Missing title'
      };

      const response = await request(app)
        .post('/api/admin/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Title and message are required');
    });

    it('should require recipient for user notifications', async () => {
      const invalidData = {
        title: 'Test',
        message: 'Test message',
        recipientType: 'user'
        // Missing recipient
      };

      const response = await request(app)
        .post('/api/admin/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Recipient ID is required');
    });

    it('should require admin authentication', async () => {
      const notificationData = {
        title: 'Test',
        message: 'Test message'
      };

      await request(app)
        .post('/api/admin/notifications')
        .send(notificationData)
        .expect(401);
    });
  });

  describe('POST /api/admin/notifications/test', () => {
    it('should send a test notification', async () => {
      const testData = {
        type: 'success',
        message: 'Custom test message'
      };

      const response = await request(app)
        .post('/api/admin/notifications/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(testData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Test notification sent');

      // Verify test notification was sent to admin
      expect(notifyUser).toHaveBeenCalledWith(
        adminUser._id.toString(),
        'notification',
        expect.objectContaining({
          title: 'Test Notification',
          message: 'Custom test message',
          type: 'success'
        })
      );
    });

    it('should send default test notification', async () => {
      const response = await request(app)
        .post('/api/admin/notifications/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify default test notification
      expect(notifyUser).toHaveBeenCalledWith(
        adminUser._id.toString(),
        'notification',
        expect.objectContaining({
          title: 'Test Notification',
          message: 'This is a test notification',
          type: 'info'
        })
      );
    });
  });

  describe('POST /api/admin/notifications/bulk', () => {
    it('should send bulk notifications to multiple users', async () => {
      const bulkData = {
        title: 'Bulk Notification',
        message: 'This is a bulk notification',
        type: 'info',
        recipients: [testUser._id, adminUser._id],
        recipientType: 'user'
      };

      const response = await request(app)
        .post('/api/admin/notifications/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(bulkData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.created).toBe(2);

      // Verify notifications were sent to both users
      expect(notifyUser).toHaveBeenCalledTimes(2);
      expect(notifyUser).toHaveBeenCalledWith(
        testUser._id.toString(),
        'notification',
        expect.objectContaining({
          title: 'Bulk Notification'
        })
      );
    });

    it('should send bulk admin notification', async () => {
      const bulkData = {
        title: 'Admin Bulk Alert',
        message: 'This is a bulk admin notification',
        type: 'warning',
        recipientType: 'admin'
      };

      const response = await request(app)
        .post('/api/admin/notifications/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(bulkData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.created).toBe(1);

      // Verify admin notification was sent
      expect(notifyAdmins).toHaveBeenCalledWith(
        'notification',
        expect.objectContaining({
          title: 'Admin Bulk Alert'
        })
      );
    });

    it('should validate required fields for bulk notifications', async () => {
      const invalidData = {
        message: 'Missing title',
        recipients: [testUser._id]
      };

      const response = await request(app)
        .post('/api/admin/notifications/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Title and message are required');
    });
  });

  describe('GET /api/admin/notifications/analytics', () => {
    beforeEach(async () => {
      // Create some test notifications for analytics
      await Notification.create([
        {
          title: 'Test 1',
          message: 'Message 1',
          type: 'info',
          sender: adminUser._id,
          recipient: testUser._id,
          isRead: true
        },
        {
          title: 'Test 2',
          message: 'Message 2',
          type: 'warning',
          sender: adminUser._id,
          recipient: testUser._id,
          isRead: false
        },
        {
          title: 'Test 3',
          message: 'Message 3',
          type: 'error',
          sender: adminUser._id,
          recipientType: 'admin',
          isRead: false
        }
      ]);
    });

    it('should get notification analytics', async () => {
      const response = await request(app)
        .get('/api/admin/notifications/analytics')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.summary).toHaveProperty('total');
      expect(response.body.data.summary).toHaveProperty('read');
      expect(response.body.data.summary).toHaveProperty('unread');
      expect(response.body.data.summary).toHaveProperty('readRate');
      expect(response.body.data).toHaveProperty('typeDistribution');
      expect(response.body.data).toHaveProperty('recentNotifications');
    });

    it('should filter analytics by timeframe', async () => {
      const response = await request(app)
        .get('/api/admin/notifications/analytics?timeframe=1d')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.timeframe).toBe('1d');
    });
  });
});