/**
 * Deployment Fix Script
 * Handles common deployment issues and validation errors
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function fixDeploymentIssues() {
  try {
    console.log('🔧 Starting deployment fixes...');
    
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ Database connected');
    
    // Fix 1: Ensure EmailCampaign collection exists
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map(col => col.name);
    
    if (!collectionNames.includes('emailcampaigns')) {
      await db.createCollection('emailcampaigns');
      console.log('✅ Created emailcampaigns collection');
    } else {
      console.log('✅ EmailCampaigns collection exists');
    }
    
    // Fix 2: Validate ContentSettings schema
    try {
      const ContentSettings = require('../models/ContentSettings');
      const testSettings = await ContentSettings.find().limit(1);
      console.log('✅ ContentSettings model working correctly');
    } catch (error) {
      console.log('⚠️  ContentSettings validation issue:', error.message);
    }
    
    // Fix 3: Check required indexes
    const indexes = [
      { collection: 'emailcampaigns', index: { status: 1, scheduledAt: 1 } },
      { collection: 'contentsettings', index: { sectionType: 1, isActive: 1 } }
    ];
    
    for (const { collection, index } of indexes) {
      try {
        await db.collection(collection).createIndex(index);
        console.log(`✅ Index created for ${collection}:`, Object.keys(index).join(', '));
      } catch (error) {
        console.log(`ℹ️  Index already exists for ${collection}:`, Object.keys(index).join(', '));
      }
    }
    
    console.log('🎉 Deployment fixes completed successfully');
    
  } catch (error) {
    console.error('❌ Deployment fix failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  fixDeploymentIssues();
}

module.exports = { fixDeploymentIssues };