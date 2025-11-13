const mongoose = require('mongoose');
const logger = require('../utils/structuredLogger');

const connectDB = async () => {
  try {
    // Validate MongoDB URI
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI environment variable is required');
    }

    // Enhanced connection options for production
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      
      // Connection pool settings
      maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE) || 10,
      minPoolSize: parseInt(process.env.DB_MIN_POOL_SIZE) || 2,
      maxIdleTimeMS: parseInt(process.env.DB_MAX_IDLE_TIME) || 30000,
      
      // Server selection and socket settings
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      family: 4, // Use IPv4, skip trying IPv6
      
      // Buffering settings (removed bufferMaxEntries as it's deprecated)
      bufferCommands: false,
      
      // Heartbeat settings
      heartbeatFrequencyMS: 10000,
      
      // Compression (if supported by MongoDB server)
      compressors: process.env.NODE_ENV === 'production' ? ['snappy', 'zlib'] : undefined,
      
      // SSL settings for production
      ...(process.env.NODE_ENV === 'production' && {
        ssl: true,
        tlsAllowInvalidCertificates: false
      })
    };

    const conn = await mongoose.connect(process.env.MONGODB_URI, options);

    logger.logDatabase('connection_established', 0, {
      host: conn.connection.host,
      name: conn.connection.name,
      readyState: conn.connection.readyState,
      maxPoolSize: options.maxPoolSize,
      minPoolSize: options.minPoolSize
    });

    // Monitor connection events
    mongoose.connection.on('error', (err) => {
      logger.logError(err, { 
        context: 'mongodb_connection_error',
        host: conn.connection.host 
      });
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected', {
        host: conn.connection.host,
        readyState: mongoose.connection.readyState
      });
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected', {
        host: conn.connection.host,
        readyState: mongoose.connection.readyState
      });
    });

    // Monitor slow operations in development
    if (process.env.NODE_ENV !== 'production') {
      mongoose.set('debug', (collectionName, method, query, doc) => {
        logger.logDatabase('query_debug', 0, {
          collection: collectionName,
          method,
          query: JSON.stringify(query),
          doc: doc ? JSON.stringify(doc).substring(0, 100) : undefined
        });
      });
    }

    // Graceful shutdown handler
    process.on('SIGINT', async () => {
      try {
        await mongoose.connection.close();
        logger.info('MongoDB connection closed through app termination');
        process.exit(0);
      } catch (err) {
        logger.logError(err, { context: 'database_shutdown' });
        process.exit(1);
      }
    });

    return conn;

  } catch (error) {
    logger.logError(error, { 
      context: 'database_connection_failed',
      uri: process.env.MONGODB_URI ? 'configured' : 'missing'
    });
    process.exit(1);
  }
};

// Database performance monitoring
const monitorDBPerformance = () => {
  setInterval(() => {
    const stats = {
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name
    };

    // Log connection pool statistics if available
    if (mongoose.connection.db) {
      mongoose.connection.db.admin().serverStatus((err, info) => {
        if (!err && info) {
          logger.logPerformance('database_stats', 0, {
            connections: info.connections,
            opcounters: info.opcounters,
            memory: info.mem,
            uptime: info.uptime
          });
        }
      });
    }
  }, 60000); // Every minute
};

// Initialize performance monitoring in production
if (process.env.NODE_ENV === 'production') {
  monitorDBPerformance();
}

module.exports = connectDB;