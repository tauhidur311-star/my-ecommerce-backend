const mongoose = require('mongoose');
const { Schema, ObjectId } = mongoose;

// Revision history for pages
const RevisionSchema = new mongoose.Schema({
  page_id: { type: ObjectId, ref: 'Page', required: true },
  user_id: { type: ObjectId, ref: 'User', required: true },
  sections_snapshot: [Schema.Types.Mixed], // Complete sections state
  theme_settings_snapshot: Schema.Types.Mixed, // Theme settings at this revision
  change_description: String,
  change_type: {
    type: String,
    enum: ['section_added', 'section_removed', 'section_modified', 'theme_updated', 'manual_save'],
    default: 'manual_save'
  },
  affected_sections: [String], // Section IDs that were changed
  restore_available: { type: Boolean, default: true },
  version_number: Number,
  // Metadata
  auto_generated: { type: Boolean, default: false },
  file_size: Number, // Size of the snapshot in bytes
  checksum: String, // For data integrity
  tags: [String] // For categorizing revisions
}, { 
  timestamps: true,
  toJSON: { virtuals: true }
});

// Indexes for performance
RevisionSchema.index({ page_id: 1, createdAt: -1 });
RevisionSchema.index({ user_id: 1, createdAt: -1 });
RevisionSchema.index({ change_type: 1, createdAt: -1 });
RevisionSchema.index({ version_number: 1 });
RevisionSchema.index({ restore_available: 1 });

// Virtual for time since creation
RevisionSchema.virtual('timeAgo').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
});

// Static method to create revision
RevisionSchema.statics.createRevision = async function(pageId, userId, sections, themeSettings, changeDescription, changeType = 'manual_save') {
  // Count existing revisions to set version number
  const revisionCount = await this.countDocuments({ page_id: pageId });
  
  // Create checksum for data integrity
  const crypto = require('crypto');
  const dataString = JSON.stringify({ sections, themeSettings });
  const checksum = crypto.createHash('md5').update(dataString).digest('hex');
  
  const revision = new this({
    page_id: pageId,
    user_id: userId,
    sections_snapshot: sections,
    theme_settings_snapshot: themeSettings,
    change_description: changeDescription,
    change_type: changeType,
    version_number: revisionCount + 1,
    file_size: Buffer.byteLength(dataString),
    checksum: checksum
  });
  
  return await revision.save();
};

// Static method to cleanup old revisions (keep last 50)
RevisionSchema.statics.cleanupOldRevisions = async function(pageId, keepCount = 50) {
  const revisions = await this.find({ page_id: pageId })
    .sort({ createdAt: -1 })
    .skip(keepCount);
  
  const idsToDelete = revisions.map(r => r._id);
  return await this.deleteMany({ _id: { $in: idsToDelete } });
};

module.exports = mongoose.model('Revision', RevisionSchema);