const mongoose = require('mongoose');

const VersionSchema = new mongoose.Schema({
  json: mongoose.Schema.Types.Mixed,
  createdAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  versionName: {
    type: String,
    default: 'Auto-save'
  }
});

const TemplateSchema = new mongoose.Schema({
  themeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Theme',
    required: true
  },
  pageType: {
    type: String,
    required: true,
    enum: ['home', 'product', 'collection', 'about', 'contact', 'custom'],
    index: true
  },
  slug: {
    type: String,
    // Required only for custom pages
    required: function() {
      return this.pageType === 'custom';
    },
    index: true
  },
  status: {
    type: String,
    enum: ['draft', 'published'],
    default: 'draft',
    index: true
  },
  json: {
    type: mongoose.Schema.Types.Mixed,
    default: { sections: [] }
  },
  publishedJson: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  versions: [VersionSchema],
  seoTitle: {
    type: String,
    trim: true
  },
  seoDescription: {
    type: String,
    trim: true
  },
  seoKeywords: [String],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  publishedAt: {
    type: Date
  }
});

// Create compound index for efficient queries
TemplateSchema.index({ themeId: 1, pageType: 1, slug: 1 }, { unique: true });

// Auto-update timestamp
TemplateSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to publish template
TemplateSchema.methods.publish = function() {
  this.status = 'published';
  this.publishedJson = JSON.parse(JSON.stringify(this.json));
  this.publishedAt = new Date();
  return this.save();
};

// Method to create version backup
TemplateSchema.methods.createVersion = function(versionName = 'Auto-save', userId) {
  if (this.json && Object.keys(this.json).length > 0) {
    this.versions.push({
      json: JSON.parse(JSON.stringify(this.json)),
      createdBy: userId,
      versionName: versionName
    });
    
    // Keep only last 20 versions
    if (this.versions.length > 20) {
      this.versions = this.versions.slice(-20);
    }
  }
};

module.exports = mongoose.model('Template', TemplateSchema);