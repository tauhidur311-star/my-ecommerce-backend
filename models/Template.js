const mongoose = require('mongoose');
const { Schema } = mongoose;

// Store reusable templates
const TemplateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  category: { 
    type: String, 
    enum: ['fashion', 'electronics', 'minimal', 'luxury', 'food', 'beauty', 'sports', 'general'],
    required: true
  },
  thumbnail_url: String, // Stored in Cloudflare R2
  preview_images: [String], // Multiple preview images
  sections: [Schema.Types.Mixed], // Complete section configuration
  theme_settings: {
    colors: {
      primary: String,
      secondary: String,
      accent: String,
      background: String,
      text: String
    },
    fonts: {
      heading: String,
      body: String
    },
    spacing: String
  },
  is_premium: { type: Boolean, default: false },
  download_count: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  reviews: [{
    user_id: { type: mongoose.ObjectId, ref: 'User' },
    rating: { type: Number, min: 1, max: 5 },
    comment: String,
    created_at: { type: Date, default: Date.now }
  }],
  tags: [String],
  created_by: { type: mongoose.ObjectId, ref: 'User' },
  featured: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  compatibility: {
    responsive: { type: Boolean, default: true },
    performance_score: Number
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true }
});

// Indexes
TemplateSchema.index({ category: 1, featured: -1 });
TemplateSchema.index({ is_premium: 1, download_count: -1 });
TemplateSchema.index({ tags: 1 });
TemplateSchema.index({ active: 1, createdAt: -1 });

// Virtual for average rating
TemplateSchema.virtual('averageRating').get(function() {
  if (this.reviews.length === 0) return 0;
  const total = this.reviews.reduce((sum, review) => sum + review.rating, 0);
  return Math.round((total / this.reviews.length) * 10) / 10;
});

module.exports = mongoose.model('Template', TemplateSchema);