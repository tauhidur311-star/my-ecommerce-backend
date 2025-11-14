const mongoose = require('mongoose');
const { Schema, ObjectId } = mongoose;

// Media library tracking for theme editor
const MediaSchema = new mongoose.Schema({
  user_id: { type: ObjectId, ref: 'User', required: true },
  filename: { type: String, required: true },
  original_filename: String,
  r2_key: { type: String, required: true }, // Path in R2 bucket
  r2_url: { type: String, required: true }, // Full CDN URL
  file_size: { type: Number, required: true }, // in bytes
  mime_type: { type: String, required: true },
  dimensions: { 
    width: Number, 
    height: Number 
  },
  // Image variants for optimization
  variants: [{
    size: { 
      type: String, 
      enum: ['thumbnail', 'small', 'medium', 'large', 'original'],
      required: true
    },
    r2_key: String,
    r2_url: String,
    dimensions: { 
      width: Number, 
      height: Number 
    },
    file_size: Number
  }],
  // Track usage
  used_in_pages: [{ type: ObjectId, ref: 'Page' }],
  usage_count: { type: Number, default: 0 },
  // Organization
  tags: [String],
  folder: { type: String, default: 'uploads' },
  alt_text: String,
  // Metadata
  upload_source: { 
    type: String, 
    enum: ['theme_editor', 'media_library', 'product_upload'],
    default: 'theme_editor'
  },
  is_optimized: { type: Boolean, default: false },
  optimization_stats: {
    original_size: Number,
    compressed_size: Number,
    compression_ratio: Number
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true }
});

// Indexes for performance
MediaSchema.index({ user_id: 1, folder: 1 });
MediaSchema.index({ mime_type: 1 });
MediaSchema.index({ tags: 1 });
MediaSchema.index({ 'used_in_pages': 1 });
MediaSchema.index({ upload_source: 1, createdAt: -1 });

// Virtual for file size in readable format
MediaSchema.virtual('readableFileSize').get(function() {
  const bytes = this.file_size;
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
});

// Static method to get media by folder
MediaSchema.statics.getByFolder = function(userId, folder = 'uploads') {
  return this.find({ user_id: userId, folder })
    .sort({ createdAt: -1 })
    .populate('used_in_pages', 'page_name slug');
};

module.exports = mongoose.model('Media', MediaSchema);