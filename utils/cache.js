const redis = require('redis');
const logger = require('./structuredLogger');

class CacheManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.memoryCache = new Map();
    this.maxMemoryCacheSize = 1000;
    
    this.init();
  }

  async init() {
    try {
      // Try to connect to Redis
      if (process.env.REDIS_URL) {
        this.client = redis.createClient({
          url: process.env.REDIS_URL
        });

        this.client.on('error', (err) => {
          logger.warn('Redis connection error, falling back to memory cache', { error: err.message });
          this.isConnected = false;
        });

        this.client.on('connect', () => {
          logger.info('Redis connected successfully');
          this.isConnected = true;
        });

        await this.client.connect();
      } else {
        logger.info('Redis URL not found, using in-memory cache');
        this.isConnected = false;
      }
    } catch (error) {
      logger.warn('Failed to initialize Redis, using in-memory cache', { error: error.message });
      this.isConnected = false;
    }
  }

  async get(key) {
    try {
      if (this.isConnected && this.client) {
        const value = await this.client.get(key);
        return value ? JSON.parse(value) : null;
      } else {
        // Fallback to memory cache
        return this.memoryCache.get(key) || null;
      }
    } catch (error) {
      logger.error('Cache get error', { key, error: error.message });
      return null;
    }
  }

  async set(key, value, ttl = 300) {
    try {
      const serialized = JSON.stringify(value);
      
      if (this.isConnected && this.client) {
        await this.client.setEx(key, ttl, serialized);
      } else {
        // Fallback to memory cache with size limit
        if (this.memoryCache.size >= this.maxMemoryCacheSize) {
          const firstKey = this.memoryCache.keys().next().value;
          this.memoryCache.delete(firstKey);
        }
        
        this.memoryCache.set(key, value);
        
        // Set TTL for memory cache
        setTimeout(() => {
          this.memoryCache.delete(key);
        }, ttl * 1000);
      }
    } catch (error) {
      logger.error('Cache set error', { key, error: error.message });
    }
  }

  async delete(key) {
    try {
      if (this.isConnected && this.client) {
        await this.client.del(key);
      } else {
        this.memoryCache.delete(key);
      }
    } catch (error) {
      logger.error('Cache delete error', { key, error: error.message });
    }
  }

  async deletePattern(pattern) {
    try {
      if (this.isConnected && this.client) {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          await this.client.del(keys);
        }
      } else {
        // For memory cache, manually check pattern
        for (const key of this.memoryCache.keys()) {
          if (key.includes(pattern.replace('*', ''))) {
            this.memoryCache.delete(key);
          }
        }
      }
    } catch (error) {
      logger.error('Cache delete pattern error', { pattern, error: error.message });
    }
  }

  async flush() {
    try {
      if (this.isConnected && this.client) {
        await this.client.flushDb();
      } else {
        this.memoryCache.clear();
      }
    } catch (error) {
      logger.error('Cache flush error', { error: error.message });
    }
  }

  // Cache wrapper for functions
  async wrap(key, fn, ttl = 300) {
    try {
      let result = await this.get(key);
      
      if (result === null) {
        result = await fn();
        await this.set(key, result, ttl);
      }
      
      return result;
    } catch (error) {
      logger.error('Cache wrap error', { key, error: error.message });
      // Return function result directly if cache fails
      return await fn();
    }
  }

  // Get cache statistics
  getStats() {
    return {
      isRedisConnected: this.isConnected,
      memoryCacheSize: this.memoryCache.size,
      maxMemoryCacheSize: this.maxMemoryCacheSize
    };
  }
}

// Export singleton instance
const cache = new CacheManager();
module.exports = cache;