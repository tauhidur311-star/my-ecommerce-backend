const express = require('express');
const router = express.Router();
const Comment = require('../models/Comment');
const Page = require('../models/Page');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

// GET /api/pages/:pageId/comments - Get comments for a page
router.get('/:pageId/comments', auth, async (req, res) => {
  try {
    const { 
      section_id, 
      resolved, 
      priority, 
      category,
      page = 1,
      limit = 20 
    } = req.query;
    
    // Verify page access
    const pageDoc = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!pageDoc) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const query = { 
      page_id: req.params.pageId,
      parent_comment_id: { $exists: false } // Only top-level comments
    };
    
    // Apply filters
    if (section_id) query.section_id = section_id;
    if (resolved !== undefined) query.resolved = resolved === 'true';
    if (priority) query.priority = priority;
    if (category) query.category = category;
    
    const comments = await Comment.find(query)
      .populate('user_id', 'name email avatar')
      .populate('resolved_by', 'name email')
      .populate('mentions', 'name email')
      .populate({
        path: 'replies',
        populate: {
          path: 'user_id',
          select: 'name email avatar'
        }
      })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    // Get replies for each comment
    const commentsWithReplies = await Promise.all(
      comments.map(async (comment) => {
        const replies = await Comment.find({
          parent_comment_id: comment._id
        })
        .populate('user_id', 'name email avatar')
        .populate('mentions', 'name email')
        .sort({ createdAt: 1 });
        
        return {
          ...comment.toObject(),
          timeAgo: comment.timeAgo,
          replies: replies.map(reply => ({
            ...reply.toObject(),
            timeAgo: reply.timeAgo
          }))
        };
      })
    );
    
    const total = await Comment.countDocuments(query);
    
    res.json({
      comments: commentsWithReplies,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / limit),
        total_count: total
      }
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// POST /api/pages/:pageId/comments - Add comment
router.post('/:pageId/comments', auth, [
  body('section_id').notEmpty().withMessage('Section ID is required'),
  body('comment').isLength({ min: 1, max: 1000 }).withMessage('Comment must be 1-1000 characters'),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  body('category').optional().isIn(['design', 'content', 'functionality', 'bug', 'suggestion'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    // Verify page access
    const pageDoc = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!pageDoc) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const {
      section_id,
      block_id,
      comment: commentText,
      priority = 'medium',
      category = 'design',
      position,
      mentions = []
    } = req.body;
    
    // Validate mentions
    let validMentions = [];
    if (mentions.length > 0) {
      const mentionedUsers = await User.find({
        _id: { $in: mentions }
      }).select('_id');
      validMentions = mentionedUsers.map(u => u._id);
    }
    
    const comment = new Comment({
      page_id: req.params.pageId,
      section_id,
      block_id,
      user_id: req.user._id,
      comment: commentText,
      priority,
      category,
      position,
      mentions: validMentions
    });
    
    await comment.save();
    
    // Populate the created comment for response
    const populatedComment = await Comment.findById(comment._id)
      .populate('user_id', 'name email avatar')
      .populate('mentions', 'name email');
    
    res.status(201).json({
      message: 'Comment added successfully',
      comment: {
        ...populatedComment.toObject(),
        timeAgo: populatedComment.timeAgo,
        replies: []
      }
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// POST /api/pages/:pageId/comments/:commentId/reply - Reply to comment
router.post('/:pageId/comments/:commentId/reply', auth, [
  body('comment').isLength({ min: 1, max: 1000 }).withMessage('Reply must be 1-1000 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    // Verify page access
    const pageDoc = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!pageDoc) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const parentComment = await Comment.findOne({
      _id: req.params.commentId,
      page_id: req.params.pageId
    });
    
    if (!parentComment) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    // Check thread depth limit
    if (parentComment.thread_depth >= 3) {
      return res.status(400).json({ 
        error: 'Maximum thread depth reached' 
      });
    }
    
    const { comment: commentText, mentions = [] } = req.body;
    
    // Validate mentions
    let validMentions = [];
    if (mentions.length > 0) {
      const mentionedUsers = await User.find({
        _id: { $in: mentions }
      }).select('_id');
      validMentions = mentionedUsers.map(u => u._id);
    }
    
    const reply = await parentComment.addReply(
      req.user._id,
      commentText,
      validMentions
    );
    
    // Populate the reply for response
    const populatedReply = await Comment.findById(reply._id)
      .populate('user_id', 'name email avatar')
      .populate('mentions', 'name email');
    
    res.status(201).json({
      message: 'Reply added successfully',
      reply: {
        ...populatedReply.toObject(),
        timeAgo: populatedReply.timeAgo
      }
    });
  } catch (error) {
    console.error('Error adding reply:', error);
    res.status(500).json({ error: 'Failed to add reply' });
  }
});

// PUT /api/pages/:pageId/comments/:commentId - Update comment
router.put('/:pageId/comments/:commentId', auth, [
  body('comment').optional().isLength({ min: 1, max: 1000 }),
  body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  body('category').optional().isIn(['design', 'content', 'functionality', 'bug', 'suggestion'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const comment = await Comment.findOne({
      _id: req.params.commentId,
      page_id: req.params.pageId,
      user_id: req.user._id // Only comment author can edit
    });
    
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found or unauthorized' });
    }
    
    const { comment: commentText, priority, category } = req.body;
    
    // Store edit history if comment text is being changed
    if (commentText && commentText !== comment.comment) {
      comment.edit_history.push({
        previous_content: comment.comment,
        edited_at: new Date(),
        edited_by: req.user._id
      });
      comment.comment = commentText;
      comment.edited = true;
    }
    
    if (priority !== undefined) comment.priority = priority;
    if (category !== undefined) comment.category = category;
    
    await comment.save();
    
    const populatedComment = await Comment.findById(comment._id)
      .populate('user_id', 'name email avatar')
      .populate('mentions', 'name email');
    
    res.json({
      message: 'Comment updated successfully',
      comment: {
        ...populatedComment.toObject(),
        timeAgo: populatedComment.timeAgo
      }
    });
  } catch (error) {
    console.error('Error updating comment:', error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// PUT /api/pages/:pageId/comments/:commentId/resolve - Resolve/unresolve comment
router.put('/:pageId/comments/:commentId/resolve', auth, async (req, res) => {
  try {
    const { resolved = true } = req.body;
    
    const comment = await Comment.findOne({
      _id: req.params.commentId,
      page_id: req.params.pageId
    });
    
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    comment.resolved = resolved;
    if (resolved) {
      comment.resolved_by = req.user._id;
      comment.resolved_at = new Date();
    } else {
      comment.resolved_by = undefined;
      comment.resolved_at = undefined;
    }
    
    await comment.save();
    
    const populatedComment = await Comment.findById(comment._id)
      .populate('user_id', 'name email avatar')
      .populate('resolved_by', 'name email');
    
    res.json({
      message: `Comment ${resolved ? 'resolved' : 'unresolved'} successfully`,
      comment: {
        ...populatedComment.toObject(),
        timeAgo: populatedComment.timeAgo
      }
    });
  } catch (error) {
    console.error('Error resolving comment:', error);
    res.status(500).json({ error: 'Failed to resolve comment' });
  }
});

// DELETE /api/pages/:pageId/comments/:commentId - Delete comment
router.delete('/:pageId/comments/:commentId', auth, async (req, res) => {
  try {
    const comment = await Comment.findOne({
      _id: req.params.commentId,
      page_id: req.params.pageId,
      user_id: req.user._id // Only comment author can delete
    });
    
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found or unauthorized' });
    }
    
    // Also delete all replies
    await Comment.deleteMany({
      parent_comment_id: comment._id
    });
    
    await Comment.deleteOne({ _id: comment._id });
    
    res.json({
      message: 'Comment deleted successfully',
      deleted_comment_id: comment._id
    });
  } catch (error) {
    console.error('Error deleting comment:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// POST /api/pages/:pageId/comments/:commentId/reaction - Add/remove reaction
router.post('/:pageId/comments/:commentId/reaction', auth, [
  body('reaction').isIn(['like', 'dislike', 'heart', 'thumbs_up', 'thumbs_down'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const comment = await Comment.findOne({
      _id: req.params.commentId,
      page_id: req.params.pageId
    });
    
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    const { reaction } = req.body;
    
    // Check if user already reacted
    const existingReactionIndex = comment.reactions.findIndex(
      r => r.user_id.toString() === req.user._id.toString()
    );
    
    if (existingReactionIndex !== -1) {
      if (comment.reactions[existingReactionIndex].reaction === reaction) {
        // Remove reaction if it's the same
        comment.reactions.splice(existingReactionIndex, 1);
      } else {
        // Update reaction if it's different
        comment.reactions[existingReactionIndex].reaction = reaction;
      }
    } else {
      // Add new reaction
      comment.reactions.push({
        user_id: req.user._id,
        reaction
      });
    }
    
    await comment.save();
    
    res.json({
      message: 'Reaction updated successfully',
      reactions: comment.reactions
    });
  } catch (error) {
    console.error('Error updating reaction:', error);
    res.status(500).json({ error: 'Failed to update reaction' });
  }
});

// GET /api/pages/:pageId/comments/stats - Get comment statistics
router.get('/:pageId/comments/stats', auth, async (req, res) => {
  try {
    // Verify page access
    const pageDoc = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!pageDoc) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const stats = await Comment.aggregate([
      { $match: { page_id: pageDoc._id } },
      {
        $group: {
          _id: null,
          total_comments: { $sum: 1 },
          resolved_comments: {
            $sum: { $cond: ['$resolved', 1, 0] }
          },
          unresolved_comments: {
            $sum: { $cond: ['$resolved', 0, 1] }
          },
          high_priority_comments: {
            $sum: { $cond: [{ $in: ['$priority', ['high', 'urgent']] }, 1, 0] }
          },
          comments_by_category: {
            $push: '$category'
          }
        }
      }
    ]);
    
    // Get comments by section
    const commentsBySection = await Comment.aggregate([
      { $match: { page_id: pageDoc._id } },
      {
        $group: {
          _id: '$section_id',
          comment_count: { $sum: 1 },
          unresolved_count: {
            $sum: { $cond: ['$resolved', 0, 1] }
          }
        }
      }
    ]);
    
    const result = stats[0] || {
      total_comments: 0,
      resolved_comments: 0,
      unresolved_comments: 0,
      high_priority_comments: 0
    };
    
    res.json({
      ...result,
      comments_by_section: commentsBySection,
      resolution_rate: result.total_comments > 0 
        ? Math.round((result.resolved_comments / result.total_comments) * 100)
        : 0
    });
  } catch (error) {
    console.error('Error fetching comment stats:', error);
    res.status(500).json({ error: 'Failed to fetch comment statistics' });
  }
});

module.exports = router;