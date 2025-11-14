const mongoose = require('mongoose');
const { Schema, ObjectId } = mongoose;

// Comments system for collaboration
const CommentSchema = new mongoose.Schema({
  page_id: { type: ObjectId, ref: 'Page', required: true },
  section_id: { type: String, required: true }, // Which section the comment is on
  block_id: String, // Optional: specific block within section
  user_id: { type: ObjectId, ref: 'User', required: true },
  comment: { type: String, required: true },
  
  // Comment thread support
  parent_comment_id: { type: ObjectId, ref: 'Comment' }, // For replies
  thread_depth: { type: Number, default: 0, max: 3 }, // Limit nesting
  
  // Status management
  resolved: { type: Boolean, default: false },
  resolved_by: { type: ObjectId, ref: 'User' },
  resolved_at: Date,
  
  // Mentions and notifications
  mentions: [{ type: ObjectId, ref: 'User' }], // Users mentioned in comment
  notification_sent: { type: Boolean, default: false },
  
  // Position context (for precise placement)
  position: {
    x: Number, // X coordinate on the section
    y: Number, // Y coordinate on the section
    viewport: { // Viewport size when comment was made
      width: Number,
      height: Number
    }
  },
  
  // Priority and categorization
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  category: {
    type: String,
    enum: ['design', 'content', 'functionality', 'bug', 'suggestion'],
    default: 'design'
  },
  
  // Metadata
  edited: { type: Boolean, default: false },
  edit_history: [{
    previous_content: String,
    edited_at: Date,
    edited_by: { type: ObjectId, ref: 'User' }
  }],
  
  // Reactions
  reactions: [{
    user_id: { type: ObjectId, ref: 'User' },
    reaction: {
      type: String,
      enum: ['like', 'dislike', 'heart', 'thumbs_up', 'thumbs_down']
    }
  }]
}, { 
  timestamps: true,
  toJSON: { virtuals: true }
});

// Indexes for performance
CommentSchema.index({ page_id: 1, section_id: 1 });
CommentSchema.index({ user_id: 1, createdAt: -1 });
CommentSchema.index({ resolved: 1, priority: -1 });
CommentSchema.index({ mentions: 1, notification_sent: 1 });
CommentSchema.index({ parent_comment_id: 1, thread_depth: 1 });

// Virtual for reply count
CommentSchema.virtual('replyCount', {
  ref: 'Comment',
  localField: '_id',
  foreignField: 'parent_comment_id',
  count: true
});

// Virtual for time since creation
CommentSchema.virtual('timeAgo').get(function() {
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

// Method to add reply
CommentSchema.methods.addReply = function(userId, content, mentions = []) {
  const Comment = mongoose.model('Comment');
  const reply = new Comment({
    page_id: this.page_id,
    section_id: this.section_id,
    block_id: this.block_id,
    user_id: userId,
    comment: content,
    parent_comment_id: this._id,
    thread_depth: this.thread_depth + 1,
    mentions: mentions
  });
  return reply.save();
};

// Static method to get comments for a section
CommentSchema.statics.getForSection = function(pageId, sectionId, includeResolved = false) {
  const query = { 
    page_id: pageId, 
    section_id: sectionId,
    parent_comment_id: { $exists: false } // Only top-level comments
  };
  
  if (!includeResolved) {
    query.resolved = false;
  }
  
  return this.find(query)
    .populate('user_id', 'name email avatar')
    .populate('resolved_by', 'name email')
    .populate('mentions', 'name email')
    .populate({
      path: 'replyCount'
    })
    .sort({ createdAt: -1 });
};

// Pre-save middleware to send notifications
CommentSchema.pre('save', async function(next) {
  if (this.isNew && this.mentions.length > 0 && !this.notification_sent) {
    // Send Mailjet notifications to mentioned users
    try {
      const mailjet = require('../utils/mailjetEmailService');
      const User = mongoose.model('User');
      const Page = mongoose.model('Page');
      
      const [mentionedUsers, commenter, page] = await Promise.all([
        User.find({ _id: { $in: this.mentions } }),
        User.findById(this.user_id),
        Page.findById(this.page_id)
      ]);
      
      for (const user of mentionedUsers) {
        await mailjet.sendEmail({
          to: user.email,
          subject: `You were mentioned in a comment on ${page.page_name}`,
          html: `
            <h3>New Comment Mention</h3>
            <p><strong>${commenter.name}</strong> mentioned you in a comment:</p>
            <blockquote style="border-left: 4px solid #3b82f6; padding-left: 16px; margin: 16px 0;">
              ${this.comment}
            </blockquote>
            <p>Page: ${page.page_name}</p>
            <p>Section: ${this.section_id}</p>
            <a href="${process.env.FRONTEND_URL}/design?page=${page._id}&section=${this.section_id}" 
               style="background: #3b82f6; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px;">
              View Comment
            </a>
          `
        });
      }
      
      this.notification_sent = true;
    } catch (error) {
      console.error('Failed to send mention notifications:', error);
    }
  }
  next();
});

module.exports = mongoose.model('Comment', CommentSchema);