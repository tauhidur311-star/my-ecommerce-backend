const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const AnalyticsAggregations = require('../utils/aggregations');
const VisitorEvent = require('../models/VisitorEvent');
const Contact = require('../models/Contact');

describe('Analytics Aggregations', () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear collections
    await VisitorEvent.deleteMany({});
    await Contact.deleteMany({});

    // Create test data
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const testEvents = [
      {
        sessionId: 'session1',
        page: '/home',
        referrer: 'https://google.com',
        userAgent: 'Mozilla/5.0',
        country: 'BD',
        deviceType: 'desktop',
        ipAddress: '192.168.1.1',
        ts: now
      },
      {
        sessionId: 'session2',
        page: '/products',
        referrer: 'https://facebook.com',
        userAgent: 'Mozilla/5.0 Mobile',
        country: 'US',
        deviceType: 'mobile',
        ipAddress: '192.168.1.2',
        ts: yesterday
      },
      {
        sessionId: 'session3',
        page: '/home',
        referrer: '',
        userAgent: 'Mozilla/5.0',
        country: 'BD',
        deviceType: 'desktop',
        ipAddress: '192.168.1.3',
        ts: lastWeek
      }
    ];

    await VisitorEvent.insertMany(testEvents);

    const testContacts = [
      {
        name: 'John Doe',
        email: 'john@test.com',
        subject: 'support',
        message: 'Test message 1',
        createdAt: now
      },
      {
        name: 'Jane Smith',
        email: 'jane@test.com',
        subject: 'general',
        message: 'Test message 2',
        createdAt: yesterday
      }
    ];

    await Contact.insertMany(testContacts);
  });

  describe('getDailyViews', () => {
    it('should return daily view counts', async () => {
      const result = await AnalyticsAggregations.getDailyViews(7);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      
      // Check structure
      const firstItem = result[0];
      expect(firstItem).toHaveProperty('date');
      expect(firstItem).toHaveProperty('count');
      expect(typeof firstItem.count).toBe('number');
    });
  });

  describe('getTopPages', () => {
    it('should return top pages by views', async () => {
      const result = await AnalyticsAggregations.getTopPages(5);
      
      expect(Array.isArray(result)).toBe(true);
      
      if (result.length > 0) {
        const firstItem = result[0];
        expect(firstItem).toHaveProperty('page');
        expect(firstItem).toHaveProperty('views');
        expect(typeof firstItem.views).toBe('number');
      }
    });
  });

  describe('getDeviceBreakdown', () => {
    it('should return device type breakdown', async () => {
      const result = await AnalyticsAggregations.getDeviceBreakdown();
      
      expect(Array.isArray(result)).toBe(true);
      
      if (result.length > 0) {
        const firstItem = result[0];
        expect(firstItem).toHaveProperty('deviceType');
        expect(firstItem).toHaveProperty('count');
        expect(typeof firstItem.count).toBe('number');
        expect(['desktop', 'mobile', 'tablet']).toContain(firstItem.deviceType);
      }
    });
  });

  describe('getGeoData', () => {
    it('should return geographic data', async () => {
      const result = await AnalyticsAggregations.getGeoData(10);
      
      expect(Array.isArray(result)).toBe(true);
      
      if (result.length > 0) {
        const firstItem = result[0];
        expect(firstItem).toHaveProperty('country');
        expect(firstItem).toHaveProperty('views');
        expect(typeof firstItem.views).toBe('number');
      }
    });
  });

  describe('getSubmissionsBySubject', () => {
    it('should return submissions grouped by subject', async () => {
      const result = await AnalyticsAggregations.getSubmissionsBySubject();
      
      expect(Array.isArray(result)).toBe(true);
      
      if (result.length > 0) {
        const firstItem = result[0];
        expect(firstItem).toHaveProperty('subject');
        expect(firstItem).toHaveProperty('count');
        expect(typeof firstItem.count).toBe('number');
      }
    });
  });

  describe('getActiveSessions', () => {
    it('should return active sessions count', async () => {
      const result = await AnalyticsAggregations.getActiveSessions();
      
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getTodayStats', () => {
    it('should return today\'s statistics', async () => {
      const result = await AnalyticsAggregations.getTodayStats();
      
      expect(result).toHaveProperty('todayViews');
      expect(result).toHaveProperty('todaySubmissions');
      expect(typeof result.todayViews).toBe('number');
      expect(typeof result.todaySubmissions).toBe('number');
    });
  });
});