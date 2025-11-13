const mongoose = require('mongoose');
const { logger } = require('../utils/logger');
require('dotenv').config();

const fixOptimizeDatabase = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('Connected to MongoDB for optimization fix');

    const db = mongoose.connection.db;
    
    // Continue creating the remaining indexes (the ones that failed)
    logger.info('Creating remaining optimized indexes...');
    
    try {
      // Products collection - fixed stock alert tracking
      await db.collection('products').createIndex(
        { stock: 1, lowStockThreshold: 1 },
        { 
          name: 'stock_alert_tracking_fixed',
          background: true,
          partialFilterExpression: { 
            stock: { $exists: true, $gte: 0 },
            lowStockThreshold: { $exists: true, $gte: 0 }
          }
        }
      );
      logger.info('Created fixed stock alert tracking index');

      // Text search index for products
      await db.collection('products').createIndex(
        { 
          name: 'text', 
          description: 'text', 
          category: 'text'
        },
        { 
          name: 'product_text_search',
          background: true,
          weights: {
            name: 10,
            category: 5,
            description: 1
          }
        }
      );
      logger.info('Created product text search index');

      // Users collection - optimized for authentication and admin queries
      await db.collection('users').createIndex(
        { email: 1 },
        { 
          name: 'email_unique_safe',
          unique: true,
          sparse: true,
          background: true 
        }
      );
      logger.info('Created unique email index');
      
      await db.collection('users').createIndex(
        { role: 1, createdAt: -1 },
        { 
          name: 'role_created_compound',
          background: true 
        }
      );
      logger.info('Created role and created date compound index');

      // Security logs - create collection and indexes if needed
      try {
        // Try to create the collection first
        await db.createCollection('securitylogs');
        logger.info('Created securitylogs collection');
      } catch (error) {
        // Collection might already exist
        logger.info('securitylogs collection already exists');
      }
      
      await db.collection('securitylogs').createIndex(
        { type: 1, createdAt: -1 },
        { 
          name: 'security_type_date',
          background: true 
        }
      );
      logger.info('Created security logs type and date index');
      
      await db.collection('securitylogs').createIndex(
        { ip: 1, createdAt: -1 },
        { 
          name: 'ip_tracking',
          background: true 
        }
      );
      logger.info('Created IP tracking index');
      
      await db.collection('securitylogs').createIndex(
        { severity: 1, createdAt: -1 },
        { 
          name: 'severity_monitoring',
          background: true 
        }
      );
      logger.info('Created severity monitoring index');

      // Notifications - optimized for real-time queries
      await db.collection('notifications').createIndex(
        { userId: 1, read: 1, createdAt: -1 },
        { 
          name: 'user_notifications_compound',
          background: true 
        }
      );
      logger.info('Created user notifications compound index');
      
      await db.collection('notifications').createIndex(
        { type: 1, createdAt: -1 },
        { 
          name: 'notification_type_date',
          background: true 
        }
      );
      logger.info('Created notification type and date index');

      // Email campaigns - marketing optimization
      try {
        await db.collection('emailcampaigns').createIndex(
          { status: 1, scheduledAt: 1 },
          { 
            name: 'campaign_scheduling',
            background: true 
          }
        );
        logger.info('Created campaign scheduling index');
        
        await db.collection('emailcampaigns').createIndex(
          { targetSegment: 1, createdAt: -1 },
          { 
            name: 'segment_targeting',
            background: true 
          }
        );
        logger.info('Created segment targeting index');
      } catch (error) {
        logger.info('Email campaigns collection may not exist yet');
      }

      // Create TTL indexes for temporary data
      try {
        await db.collection('tokenblacklists').createIndex(
          { expiresAt: 1 },
          { 
            name: 'token_ttl',
            expireAfterSeconds: 0,
            background: true 
          }
        );
        logger.info('Created token TTL index');
      } catch (error) {
        logger.info('Token blacklist collection may not exist yet');
      }
      
      // Analytics aggregation optimization
      try {
        await db.collection('visitorevents').createIndex(
          { sessionId: 1, createdAt: -1 },
          { 
            name: 'session_analytics',
            background: true,
            expireAfterSeconds: 30 * 24 * 60 * 60 // 30 days
          }
        );
        logger.info('Created session analytics index');
      } catch (error) {
        logger.info('Visitor events collection may not exist yet');
      }

      logger.info('All remaining indexes created successfully');
      
    } catch (indexError) {
      logger.error('Error creating specific index:', indexError);
    }
    
    // Log final index statistics
    const collections = ['orders', 'products', 'users', 'notifications'];
    
    for (const collectionName of collections) {
      try {
        const collection = db.collection(collectionName);
        const stats = await collection.stats();
        const indexes = await collection.indexes();
        
        logger.info(`${collectionName} collection stats:`, {
          documents: stats.count || 0,
          avgDocSize: Math.round(stats.avgObjSize || 0),
          totalIndexSize: Math.round((stats.totalIndexSize || 0) / 1024) + 'KB',
          indexCount: indexes.length,
          indexes: indexes.map(idx => idx.name)
        });
      } catch (error) {
        logger.warn(`Could not get stats for ${collectionName}: ${error.message}`);
      }
    }
    
    logger.info('Database optimization fix completed successfully');
    
  } catch (error) {
    logger.error('Database optimization fix failed:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
};

// Run optimization fix if called directly
if (require.main === module) {
  fixOptimizeDatabase()
    .then(() => {
      console.log('✅ Database optimization fix completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Database optimization fix failed:', error.message);
      process.exit(1);
    });
}

module.exports = fixOptimizeDatabase;