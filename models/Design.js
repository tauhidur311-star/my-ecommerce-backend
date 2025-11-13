const mongoose = require('mongoose');

// Schema for individual section content based on section type
const sectionContentSchema = new mongoose.Schema({}, { strict: false, _id: false });

// Schema for section settings (styling, spacing, etc.)
const sectionSettingsSchema = new mongoose.Schema({
  backgroundColor: {
    type: String,
    default: 'transparent'
  },
  textColor: {
    type: String,
    default: 'inherit'
  },
  padding: {
    top: { type: Number, default: 60, min: 0, max: 200 },
    bottom: { type: Number, default: 60, min: 0, max: 200 }
  },
  hidden: {
    type: Boolean,
    default: false
  },
  customCSS: {
    type: String,
    default: ''
  }
}, { _id: false });

// Schema for individual page sections
const sectionSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: ['hero', 'features', 'gallery', 'testimonials', 'contact', 'newsletter', 'custom']
  },
  content: {
    type: sectionContentSchema,
    required: true
  },
  settings: {
    type: sectionSettingsSchema,
    default: {}
  },
  order: {
    type: Number,
    default: 0
  }
}, { _id: false });

// Schema for global design settings
const globalSettingsSchema = new mongoose.Schema({
  layout: {
    maxWidth: { type: String, default: '1200px' },
    padding: { type: String, default: '20px' },
    backgroundColor: { type: String, default: '#ffffff' }
  },
  typography: {
    fontFamily: { type: String, default: 'Inter, sans-serif' },
    fontSize: {
      base: { type: String, default: '16px' },
      h1: { type: String, default: '2.5rem' },
      h2: { type: String, default: '2rem' },
      h3: { type: String, default: '1.5rem' }
    },
    lineHeight: { type: Number, default: 1.6 }
  },
  colors: {
    primary: { type: String, default: '#3B82F6' },
    secondary: { type: String, default: '#10B981' },
    accent: { type: String, default: '#F59E0B' },
    text: { type: String, default: '#1F2937' },
    background: { type: String, default: '#FFFFFF' }
  },
  spacing: {
    small: { type: String, default: '1rem' },
    medium: { type: String, default: '2rem' },
    large: { type: String, default: '4rem' }
  }
}, { _id: false });

// Main Design schema
const designSchema = new mongoose.Schema({
  storeId: {
    type: String,
    required: true,
    index: true,
    default: 'default'
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Allow anonymous designs for demos
  },
  name: {
    type: String,
    default: 'Untitled Design'
  },
  description: {
    type: String,
    default: ''
  },
  layout: {
    type: [sectionSchema],
    default: []
  },
  globalSettings: {
    type: globalSettingsSchema,
    default: {}
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'archived'],
    default: 'draft'
  },
  version: {
    type: Number,
    default: 1
  },
  publishedAt: {
    type: Date
  },
  metadata: {
    totalSections: { type: Number, default: 0 },
    lastEditedSection: { type: String },
    designDuration: { type: Number, default: 0 }, // Time spent designing in minutes
    previewCount: { type: Number, default: 0 },
    saveCount: { type: Number, default: 0 }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
designSchema.index({ storeId: 1, status: 1 });
designSchema.index({ userId: 1, updatedAt: -1 });
designSchema.index({ status: 1, publishedAt: -1 });

// Virtual for section count
designSchema.virtual('sectionCount').get(function() {
  return this.layout ? this.layout.length : 0;
});

// Pre-save middleware to update metadata
designSchema.pre('save', function(next) {
  if (this.layout) {
    this.metadata.totalSections = this.layout.length;
    
    // Update order for sections
    this.layout.forEach((section, index) => {
      section.order = index;
    });
  }
  
  if (this.isModified('layout') || this.isModified('globalSettings')) {
    this.metadata.saveCount = (this.metadata.saveCount || 0) + 1;
  }
  
  next();
});

// Instance methods
designSchema.methods.publish = function() {
  this.status = 'published';
  this.publishedAt = new Date();
  return this.save();
};

designSchema.methods.duplicate = function(newName) {
  const newDesign = new this.constructor({
    storeId: this.storeId + '_copy',
    userId: this.userId,
    name: newName || `${this.name} (Copy)`,
    description: this.description,
    layout: JSON.parse(JSON.stringify(this.layout)), // Deep clone
    globalSettings: JSON.parse(JSON.stringify(this.globalSettings)),
    status: 'draft'
  });
  
  return newDesign.save();
};

designSchema.methods.addSection = function(sectionData, index = -1) {
  if (!this.layout) {
    this.layout = [];
  }
  
  if (index >= 0 && index < this.layout.length) {
    this.layout.splice(index, 0, sectionData);
  } else {
    this.layout.push(sectionData);
  }
  
  return this.save();
};

designSchema.methods.removeSection = function(sectionId) {
  if (!this.layout) return this;
  
  this.layout = this.layout.filter(section => section.id !== sectionId);
  return this.save();
};

designSchema.methods.updateSection = function(sectionId, updates) {
  if (!this.layout) return this;
  
  const sectionIndex = this.layout.findIndex(section => section.id === sectionId);
  if (sectionIndex === -1) return this;
  
  // Merge updates into existing section
  this.layout[sectionIndex] = {
    ...this.layout[sectionIndex],
    ...updates,
    content: updates.content ? { ...this.layout[sectionIndex].content, ...updates.content } : this.layout[sectionIndex].content,
    settings: updates.settings ? { ...this.layout[sectionIndex].settings, ...updates.settings } : this.layout[sectionIndex].settings
  };
  
  this.metadata.lastEditedSection = sectionId;
  return this.save();
};

designSchema.methods.reorderSections = function(fromIndex, toIndex) {
  if (!this.layout || fromIndex === toIndex) return this;
  
  const section = this.layout.splice(fromIndex, 1)[0];
  this.layout.splice(toIndex, 0, section);
  
  return this.save();
};

// Static methods
designSchema.statics.findByStore = function(storeId, options = {}) {
  const query = { storeId };
  if (options.status) query.status = options.status;
  
  return this.find(query)
    .sort({ updatedAt: -1 })
    .limit(options.limit || 50);
};

designSchema.statics.getPublished = function(storeId) {
  return this.findOne({ 
    storeId, 
    status: 'published' 
  }).sort({ publishedAt: -1 });
};

// Validation helpers
designSchema.statics.validateSectionContent = function(type, content) {
  const validationRules = {
    hero: {
      required: ['title'],
      optional: ['subtitle', 'ctaText', 'ctaUrl', 'backgroundImage', 'alignment', 'height']
    },
    features: {
      required: ['title', 'items'],
      optional: []
    },
    gallery: {
      required: ['images'],
      optional: ['title', 'columns', 'showTitles']
    },
    testimonials: {
      required: ['testimonials'],
      optional: ['title']
    },
    contact: {
      required: [],
      optional: ['title', 'subtitle', 'showPhone', 'showEmail', 'showAddress', 'showForm', 'formFields']
    },
    newsletter: {
      required: ['title'],
      optional: ['subtitle', 'placeholder', 'buttonText', 'successMessage']
    }
  };

  const rules = validationRules[type];
  if (!rules) return { valid: false, errors: ['Invalid section type'] };

  const errors = [];
  
  // Check required fields
  for (const field of rules.required) {
    if (!(field in content) || content[field] === undefined || content[field] === '') {
      errors.push(`${field} is required for ${type} section`);
    }
  }

  return { valid: errors.length === 0, errors };
};

module.exports = mongoose.model('Design', designSchema);