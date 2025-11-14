const mongoose = require('mongoose');
const { Schema, ObjectId } = mongoose;

// Store complete page designs
const PageSchema = new mongoose.Schema({
  user_id: { type: ObjectId, ref: 'User', required: true },
  page_name: { type: String, required: true },
  slug: { type: String, unique: true },
  template_type: { 
    type: String, 
    enum: ['home', 'product', 'collection', 'about', 'contact', 'custom'],
    default: 'custom'
  },
  sections: [{
    section_id: { type: String, required: true },
    type: { type: String, required: true }, // 'hero', 'products', 'footer', etc.
    order: { type: Number, required: true },
    visible: { type: Boolean, default: true },
    settings: {
      // Responsive settings
      desktop: Schema.Types.Mixed,
      tablet: Schema.Types.Mixed,
      mobile: Schema.Types.Mixed,
      // Common settings
      bgColor: String,
      textColor: String,
      padding: Number,
      margin: Number
    },
    blocks: [{
      block_id: { type: String, required: true },
      type: { type: String, required: true },
      content: Schema.Types.Mixed,
      settings: Schema.Types.Mixed,
      order: Number
    }]
  }],
  theme_settings: {
    colors: { 
      primary: { type: String, default: '#3b82f6' },
      secondary: { type: String, default: '#6b7280' },
      accent: { type: String, default: '#8b5cf6' },
      background: { type: String, default: '#ffffff' },
      text: { type: String, default: '#000000' }
    },
    fonts: { 
      heading: { type: String, default: 'Inter' },
      body: { type: String, default: 'Inter' }
    },
    spacing: { type: String, default: 'normal' }
  },
  published: { type: Boolean, default: false },
  published_at: Date,
  version: { type: Number, default: 1 },
  is_active: { type: Boolean, default: false }, // Currently live on storefront
  seo: {
    title: String,
    description: String,
    keywords: [String]
  },
  performance: {
    last_save_time: Date,
    auto_save_enabled: { type: Boolean, default: true }
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
PageSchema.index({ user_id: 1, slug: 1 });
PageSchema.index({ published: 1, is_active: 1 });
PageSchema.index({ template_type: 1 });
PageSchema.index({ 'sections.type': 1 });

// Virtual for full URL
PageSchema.virtual('url').get(function() {
  return `/${this.slug}`;
});

module.exports = mongoose.model('Page', PageSchema);