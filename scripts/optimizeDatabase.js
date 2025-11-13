const mongoose = require('mongoose');
const { logger } = require('../utils/logger');
require('dotenv').config();

const optimizeDatabase = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Connected to MongoDB for optimization');

    const db = mongoose.connection.db;
    
    // Drop existing indexes that might be inefficient
    const collections = ['orders', 'products', 'users', 'notifications', 'securitylogs'];
    
    for (const collectionName of collections) {
      try {
        const collection = db.collection(collectionName);
        const existingIndexes = await collection.indexes();
        
        // Drop inefficient single-field indexes (keep _id and unique indexes)
        for (const index of existingIndexes) {
          if (index.name !== '_id_' && !index.unique && Object.keys(index.key).length === 1) {
            try {
              await collection.dropIndex(index.name);
              logger.info(`Dropped inefficient index: ${index.name} from ${collectionName}`);
            } catch (error) {
              // Index might not exist or be in use
            }
          }
        }
      } catch (error) {
        logger.warn(`Collection ${collectionName} might not exist: ${error.message}`);
      }
    }

    // Create optimized compound indexes
    logger.info('Creating optimized indexes...');
    
    // Orders collection - optimized for common queries
    await db.collection('orders').createIndex(
      { userId: 1, createdAt: -1, status: 1 },
      { 
        name: 'user_date_status_compound',
        background: true,
        partialFilterExpression: { userId: { $exists: true } }
      }
    );
    
    await db.collection('orders').createIndex(
      { status: 1, createdAt: -1 },
      { 
        name: 'status_date_compound',
        background: true 
      }
    );
    
    await db.collection('orders').createIndex(
      { 'items.productId': 1, createdAt: -1 },
      { 
        name: 'product_sales_tracking',
        background: true 
      }
    );

    // Products collection - optimized for search and filtering
    await db.collection('products').createIndex(
      { category: 1, stock: 1, price: 1 },
      { 
        name: 'category_inventory_price',
        background: true 
      }
    );
    
    // Simple stock tracking index (removed $expr for compatibility)
    await db.collection('products').createIndex(
      { stock: 1, lowStockThreshold: 1 },
      { 
        name: 'stock_alert_tracking',
        background: true,
        partialFilterExpression: { 
          stock: { $exists: true, $gte: 0 },
          lowStockThreshold: { $exists: true, $gte: 0 }
        }
      }
    );
    
    // Text search index for products
    await db.collection('products').createIndex(
      { 
        name: 'text', 
        description: 'text', 
        category: 'text',
        tags: 'text'
      },
      { 
        name: 'product_text_search',
        background: true,
        weights: {
          name: 10,
          category: 5,
          description: 1,
          tags: 3
        }
      }
    );

    // Users collection - optimized for authentication and admin queries
    await db.collection('users').createIndex(
      { email: 1 },
      { 
        name: 'email_unique',
        unique: true,
        sparse: true,
        background: true 
      }
    );
    
    await db.collection('users').createIndex(
      { role: 1, createdAt: -1 },
      { 
        name: 'role_created_compound',
        background: true 
      }
    );
    
    await db.collection('users').createIndex(
      { 'knownDevices.fingerprint': 1 },
      { 
        name: 'device_tracking',
        background: true,
        sparse: true 
      }
    );

    // Security logs - optimized for monitoring
    await db.collection('securitylogs').createIndex(
      { type: 1, createdAt: -1 },
      { 
        name: 'security_type_date',
        background: true 
      }
    );
    
    await db.collection('securitylogs').createIndex(
      { ip: 1, createdAt: -1 },
      { 
        name: 'ip_tracking',
        background: true 
      }
    );
    
    await db.collection('securitylogs').createIndex(
      { severity: 1, createdAt: -1 },
      { 
        name: 'severity_monitoring',
        background: true 
      }
    );

    // Notifications - optimized for real-time queries
    await db.collection('notifications').createIndex(
      { userId: 1, read: 1, createdAt: -1 },
      { 
        name: 'user_notifications',
        background: true 
      }
    );
    
    await db.collection('notifications').createIndex(
      { type: 1, createdAt: -1 },
      { 
        name: 'notification_type_date',
        background: true 
      }
    );

    // Email campaigns - marketing optimization
    if (await db.collection('emailcampaigns').countDocuments() > 0) {
      await db.collection('emailcampaigns').createIndex(
        { status: 1, scheduledAt: 1 },
        { 
          name: 'campaign_scheduling',
          background: true 
        }
      );
      
      await db.collection('emailcampaigns').createIndex(
        { targetSegment: 1, createdAt: -1 },
        { 
          name: 'segment_targeting',
          background: true 
        }
      );
    }

    // Create TTL indexes for temporary data
    await db.collection('tokensblacklists').createIndex(
      { expiresAt: 1 },
      { 
        name: 'token_ttl',
        expireAfterSeconds: 0,
        background: true 
      }
    );
    
    // Analytics aggregation optimization
    await db.collection('visitorevents').createIndex(
      { sessionId: 1, createdAt: -1 },
      { 
        name: 'session_analytics',
        background: true,
        expireAfterSeconds: 30 * 24 * 60 * 60 // 30 days
      }
    );

    logger.info('Database optimization completed successfully');
    
    // Log index statistics
    for (const collectionName of collections) {
      try {
        const collection = db.collection(collectionName);
        const stats = await collection.stats();
        const indexes = await collection.indexes();
        
        logger.info(`${collectionName} collection stats:`, {
          documents: stats.count,
          avgDocSize: Math.round(stats.avgObjSize),
          totalIndexSize: Math.round(stats.totalIndexSize / 1024) + 'KB',
          indexCount: indexes.length
        });
      } catch (error) {
        // Collection might not exist
      }
    }
    
  } catch (error) {
    logger.error('Database optimization failed:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
};

// Run optimization if called directly
if (require.main === module) {
  optimizeDatabase()
    .then(() => {
      console.log('✅ Database optimization completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Database optimization failed:', error);
      process.exit(1);
    });
}

module.exports = optimizeDatabase;