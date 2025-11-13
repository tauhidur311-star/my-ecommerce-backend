const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../server');
const User = require('../models/User');
const VisitorEvent = require('../models/VisitorEvent');
const Contact = require('../models/Contact');

describe('Analytics Routes', () => {
  let adminToken;
  let adminUser;

  beforeAll(async () => {
    // Create admin user for testing
    adminUser = new User({
      email: 'admin@test.com',
      username: 'admin',
      password: 'password123',
      role: 'admin'
    });
    await adminUser.save();

    // Login to get token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'admin@test.com',
        password: 'password123'
      });

    adminToken = loginRes.body.token;
  });

  afterAll(async () => {
    await User.findByIdAndDelete(adminUser._id);
    await VisitorEvent.deleteMany({});
    await Contact.deleteMany({});
  });

  beforeEach(async () => {
    // Create test data
    const testEvents = [
      {
        sessionId: 'session1',
        page: '/home',
        referrer: 'https://google.com',
        userAgent: 'Mozilla/5.0',
        country: 'BD',
        deviceType: 'desktop',
        ipAddress: '192.168.1.1',
        ts: new Date()
      },
      {
        sessionId: 'session2',
        page: '/products',
        referrer: 'https://facebook.com',
        userAgent: 'Mozilla/5.0 Mobile',
        country: 'US',
        deviceType: 'mobile',
        ipAddress: '192.168.1.2',
        ts: new Date()
      }
    ];

    await VisitorEvent.insertMany(testEvents);

    const testContacts = [
      {
        name: 'John Doe',
        email: 'john@test.com',
        subject: 'support',
        message: 'Test message',
        createdAt: new Date()
      }
    ];

    await Contact.insertMany(testContacts);
  });

  afterEach(async () => {
    await VisitorEvent.deleteMany({});
    await Contact.deleteMany({});
  });

  describe('GET /api/admin/analytics/summary', () => {
    it('should return analytics summary for admin', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/summary')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('activeSessions');
      expect(res.body.data).toHaveProperty('todayViews');
      expect(res.body.data).toHaveProperty('todaySubmissions');
    });

    it('should require admin authentication', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/summary');

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/admin/analytics/charts', () => {
    it('should return chart data for views', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/charts?type=views&range=7d')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return chart data for submissions', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/charts?type=submissions&range=7d')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/admin/analytics/top-pages', () => {
    it('should return top pages', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/top-pages?limit=5')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/admin/analytics/devices', () => {
    it('should return device breakdown', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/devices')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/admin/analytics/geo', () => {
    it('should return geographic data', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/geo?top=5')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /api/admin/analytics/recent-submissions', () => {
    it('should return recent contact submissions', async () => {
      const res = await request(app)
        .get('/api/admin/analytics/recent-submissions?limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});