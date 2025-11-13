const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const Contact = require('../models/Contact');
const User = require('../models/User');

describe('Contact Routes', () => {
  let mongoServer;
  let adminToken;
  let adminUser;

  beforeAll(async () => {
    // Setup in-memory MongoDB
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    // Create admin user for authenticated tests
    adminUser = new User({
      name: 'Admin User',
      email: 'admin@test.com',
      password: 'hashedpassword123',
      role: 'admin'
    });
    await adminUser.save();

    // Mock JWT token (replace with actual token generation)
    adminToken = 'mock-admin-token';
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear contacts collection before each test
    await Contact.deleteMany({});
  });

  describe('POST /api/contact', () => {
    test('should create new contact submission with valid data', async () => {
      const contactData = {
        name: 'John Doe',
        email: 'john@example.com',
        subject: 'general',
        message: 'This is a test message for support.'
      };

      const response = await request(app)
        .post('/api/contact')
        .send(contactData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('successfully');
      expect(response.body.contactId).toBeDefined();

      // Verify contact was saved to database
      const savedContact = await Contact.findById(response.body.contactId);
      expect(savedContact).toBeTruthy();
      expect(savedContact.name).toBe(contactData.name);
      expect(savedContact.email).toBe(contactData.email);
      expect(savedContact.status).toBe('new');
    });

    test('should reject invalid email format', async () => {
      const invalidData = {
        name: 'John Doe',
        email: 'invalid-email',
        subject: 'general',
        message: 'Test message'
      };

      const response = await request(app)
        .post('/api/contact')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid input data');
    });

    test('should reject missing required fields', async () => {
      const incompleteData = {
        name: 'John Doe',
        email: 'john@example.com'
        // missing subject and message
      };

      const response = await request(app)
        .post('/api/contact')
        .send(incompleteData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('required');
    });

    test('should respect rate limiting', async () => {
      const contactData = {
        name: 'John Doe',
        email: 'john@example.com',
        subject: 'general',
        message: 'Test message'
      };

      // Make multiple requests quickly
      const requests = Array(5).fill().map(() => 
        request(app).post('/api/contact').send(contactData)
      );

      const responses = await Promise.all(requests);
      
      // Some requests should be rate limited
      const rateLimited = responses.some(res => res.status === 429);
      expect(rateLimited).toBe(true);
    });
  });

  describe('GET /api/contact/stats', () => {
    beforeEach(async () => {
      // Create test contacts
      const contacts = [
        { name: 'User 1', email: 'user1@test.com', subject: 'general', message: 'Test 1', timestamp: new Date() },
        { name: 'User 2', email: 'user2@test.com', subject: 'support', message: 'Test 2', timestamp: new Date() },
        { name: 'User 3', email: 'user3@test.com', subject: 'general', message: 'Test 3', timestamp: new Date(Date.now() - 86400000) } // yesterday
      ];

      await Contact.insertMany(contacts);
    });

    test('should return contact statistics for admin', async () => {
      const response = await request(app)
        .get('/api/contact/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.total).toBe(3);
      expect(response.body.data.today).toBe(2);
      expect(response.body.data.bySubject).toBeDefined();
      expect(Array.isArray(response.body.data.bySubject)).toBe(true);
    });

    test('should require admin authentication', async () => {
      const response = await request(app)
        .get('/api/contact/stats')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/admin/contacts', () => {
    beforeEach(async () => {
      // Create test contacts
      const contacts = [
        { name: 'User 1', email: 'user1@test.com', subject: 'general', message: 'Test 1', status: 'new' },
        { name: 'User 2', email: 'user2@test.com', subject: 'support', message: 'Test 2', status: 'in-progress' },
        { name: 'User 3', email: 'user3@test.com', subject: 'billing', message: 'Test 3', status: 'resolved' }
      ];

      await Contact.insertMany(contacts);
    });

    test('should return paginated contact submissions for admin', async () => {
      const response = await request(app)
        .get('/api/admin/contacts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBe(3);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.totalCount).toBe(3);
    });

    test('should filter by status', async () => {
      const response = await request(app)
        .get('/api/admin/contacts?status=new')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].status).toBe('new');
    });

    test('should support search functionality', async () => {
      const response = await request(app)
        .get('/api/admin/contacts?search=User 1')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].name).toBe('User 1');
    });
  });

  describe('POST /api/admin/contacts/bulk-action', () => {
    let contactIds;

    beforeEach(async () => {
      // Create test contacts
      const contacts = await Contact.insertMany([
        { name: 'User 1', email: 'user1@test.com', subject: 'general', message: 'Test 1', status: 'new' },
        { name: 'User 2', email: 'user2@test.com', subject: 'support', message: 'Test 2', status: 'new' },
        { name: 'User 3', email: 'user3@test.com', subject: 'billing', message: 'Test 3', status: 'new' }
      ]);

      contactIds = contacts.map(c => c._id.toString());
    });

    test('should mark multiple contacts as read', async () => {
      const response = await request(app)
        .post('/api/admin/contacts/bulk-action')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'markRead',
          ids: contactIds.slice(0, 2)
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.affectedCount).toBe(2);

      // Verify contacts were updated
      const updatedContacts = await Contact.find({ _id: { $in: contactIds.slice(0, 2) } });
      updatedContacts.forEach(contact => {
        expect(contact.isRead).toBe(true);
        expect(contact.readAt).toBeTruthy();
      });
    });

    test('should archive multiple contacts', async () => {
      const response = await request(app)
        .post('/api/admin/contacts/bulk-action')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'archive',
          ids: contactIds
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.affectedCount).toBe(3);

      // Verify contacts were archived
      const archivedContacts = await Contact.find({ _id: { $in: contactIds } });
      archivedContacts.forEach(contact => {
        expect(contact.status).toBe('closed');
        expect(contact.resolvedAt).toBeTruthy();
      });
    });

    test('should delete multiple contacts', async () => {
      const response = await request(app)
        .post('/api/admin/contacts/bulk-action')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'delete',
          ids: [contactIds[0]]
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.affectedCount).toBe(1);

      // Verify contact was deleted
      const deletedContact = await Contact.findById(contactIds[0]);
      expect(deletedContact).toBeNull();
    });

    test('should reject invalid action', async () => {
      const response = await request(app)
        .post('/api/admin/contacts/bulk-action')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'invalidAction',
          ids: contactIds
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid action');
    });

    test('should require admin authentication', async () => {
      const response = await request(app)
        .post('/api/admin/contacts/bulk-action')
        .send({
          action: 'markRead',
          ids: contactIds
        })
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });
});