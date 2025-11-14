const express = require('express');
const router = express.Router();
const Revision = require('../models/Revision');
const Page = require('../models/Page');
const auth = require('../middleware/auth');

// GET /api/pages/:pageId/revisions - Get revision history
router.get('/:pageId/revisions', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, change_type } = req.query;
    
    // Verify page ownership
    const pageDoc = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!pageDoc) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const query = { page_id: req.params.pageId };
    if (change_type) query.change_type = change_type;
    
    const revisions = await Revision.find(query)
      .populate('user_id', 'name email avatar')
      .select('-sections_snapshot -theme_settings_snapshot') // Exclude large data for list view
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const total = await Revision.countDocuments(query);
    
    res.json({
      revisions: revisions.map(revision => ({
        _id: revision._id,
        user: revision.user_id,
        change_description: revision.change_description,
        change_type: revision.change_type,
        affected_sections: revision.affected_sections,
        version_number: revision.version_number,
        auto_generated: revision.auto_generated,
        restore_available: revision.restore_available,
        timeAgo: revision.timeAgo,
        createdAt: revision.createdAt,
        file_size: revision.file_size
      })),
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(total / limit),
        total_count: total
      }
    });
  } catch (error) {
    console.error('Error fetching revisions:', error);
    res.status(500).json({ error: 'Failed to fetch revisions' });
  }
});

// GET /api/pages/:pageId/revisions/:revisionId - Get specific revision details
router.get('/:pageId/revisions/:revisionId', auth, async (req, res) => {
  try {
    // Verify page ownership
    const pageDoc = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!pageDoc) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const revision = await Revision.findOne({
      _id: req.params.revisionId,
      page_id: req.params.pageId
    }).populate('user_id', 'name email avatar');
    
    if (!revision) {
      return res.status(404).json({ error: 'Revision not found' });
    }
    
    res.json({
      _id: revision._id,
      user: revision.user_id,
      change_description: revision.change_description,
      change_type: revision.change_type,
      affected_sections: revision.affected_sections,
      version_number: revision.version_number,
      sections_snapshot: revision.sections_snapshot,
      theme_settings_snapshot: revision.theme_settings_snapshot,
      auto_generated: revision.auto_generated,
      restore_available: revision.restore_available,
      timeAgo: revision.timeAgo,
      createdAt: revision.createdAt,
      checksum: revision.checksum
    });
  } catch (error) {
    console.error('Error fetching revision:', error);
    res.status(500).json({ error: 'Failed to fetch revision' });
  }
});

// POST /api/pages/:pageId/revisions/:revisionId/restore - Restore to specific revision
router.post('/:pageId/revisions/:revisionId/restore', auth, async (req, res) => {
  try {
    // Verify page ownership
    const pageDoc = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!pageDoc) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const revision = await Revision.findOne({
      _id: req.params.revisionId,
      page_id: req.params.pageId,
      restore_available: true
    });
    
    if (!revision) {
      return res.status(404).json({ error: 'Revision not found or not restorable' });
    }
    
    // Store current state as new revision before restoring
    await Revision.createRevision(
      pageDoc._id,
      req.user._id,
      pageDoc.sections,
      pageDoc.theme_settings,
      `Backup before restoring to version ${revision.version_number}`,
      'manual_save'
    );
    
    // Restore the page to the revision state
    pageDoc.sections = revision.sections_snapshot;
    pageDoc.theme_settings = revision.theme_settings_snapshot;
    await pageDoc.save();
    
    // Create revision for the restore action
    await Revision.createRevision(
      pageDoc._id,
      req.user._id,
      pageDoc.sections,
      pageDoc.theme_settings,
      `Restored to version ${revision.version_number}: ${revision.change_description}`,
      'manual_save'
    );
    
    res.json({
      message: `Successfully restored to version ${revision.version_number}`,
      restored_revision: {
        _id: revision._id,
        version_number: revision.version_number,
        change_description: revision.change_description,
        created_at: revision.createdAt
      },
      page: {
        _id: pageDoc._id,
        sections_count: pageDoc.sections.length,
        updated_at: pageDoc.updatedAt
      }
    });
  } catch (error) {
    console.error('Error restoring revision:', error);
    res.status(500).json({ error: 'Failed to restore revision' });
  }
});

// POST /api/pages/:pageId/revisions/create - Manually create revision
router.post('/:pageId/revisions/create', auth, async (req, res) => {
  try {
    const { description = 'Manual save' } = req.body;
    
    // Verify page ownership
    const pageDoc = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!pageDoc) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const revision = await Revision.createRevision(
      pageDoc._id,
      req.user._id,
      pageDoc.sections,
      pageDoc.theme_settings,
      description,
      'manual_save'
    );
    
    const populatedRevision = await Revision.findById(revision._id)
      .populate('user_id', 'name email avatar')
      .select('-sections_snapshot -theme_settings_snapshot');
    
    res.status(201).json({
      message: 'Revision created successfully',
      revision: {
        _id: populatedRevision._id,
        user: populatedRevision.user_id,
        change_description: populatedRevision.change_description,
        change_type: populatedRevision.change_type,
        version_number: populatedRevision.version_number,
        timeAgo: populatedRevision.timeAgo,
        createdAt: populatedRevision.createdAt
      }
    });
  } catch (error) {
    console.error('Error creating revision:', error);
    res.status(500).json({ error: 'Failed to create revision' });
  }
});

// DELETE /api/pages/:pageId/revisions/:revisionId - Delete specific revision
router.delete('/:pageId/revisions/:revisionId', auth, async (req, res) => {
  try {
    // Verify page ownership
    const pageDoc = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!pageDoc) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const revision = await Revision.findOne({
      _id: req.params.revisionId,
      page_id: req.params.pageId
    });
    
    if (!revision) {
      return res.status(404).json({ error: 'Revision not found' });
    }
    
    // Don't allow deleting the most recent revision
    const latestRevision = await Revision.findOne({ page_id: req.params.pageId })
      .sort({ createdAt: -1 });
    
    if (latestRevision && latestRevision._id.toString() === revision._id.toString()) {
      return res.status(400).json({ 
        error: 'Cannot delete the most recent revision' 
      });
    }
    
    await Revision.deleteOne({ _id: revision._id });
    
    res.json({
      message: 'Revision deleted successfully',
      deleted_revision: {
        _id: revision._id,
        version_number: revision.version_number,
        change_description: revision.change_description
      }
    });
  } catch (error) {
    console.error('Error deleting revision:', error);
    res.status(500).json({ error: 'Failed to delete revision' });
  }
});

// POST /api/pages/:pageId/revisions/cleanup - Clean up old revisions
router.post('/:pageId/revisions/cleanup', auth, async (req, res) => {
  try {
    const { keep_count = 50 } = req.body;
    
    // Verify page ownership
    const pageDoc = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!pageDoc) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const result = await Revision.cleanupOldRevisions(req.params.pageId, keep_count);
    
    res.json({
      message: `Cleanup completed. Kept ${keep_count} most recent revisions.`,
      deleted_count: result.deletedCount
    });
  } catch (error) {
    console.error('Error cleaning up revisions:', error);
    res.status(500).json({ error: 'Failed to cleanup revisions' });
  }
});

// GET /api/pages/:pageId/revisions/compare/:revisionId1/:revisionId2 - Compare two revisions
router.get('/:pageId/revisions/compare/:revisionId1/:revisionId2', auth, async (req, res) => {
  try {
    // Verify page ownership
    const pageDoc = await Page.findOne({
      _id: req.params.pageId,
      user_id: req.user._id
    });
    
    if (!pageDoc) {
      return res.status(404).json({ error: 'Page not found' });
    }
    
    const [revision1, revision2] = await Promise.all([
      Revision.findOne({ 
        _id: req.params.revisionId1, 
        page_id: req.params.pageId 
      }).populate('user_id', 'name email'),
      Revision.findOne({ 
        _id: req.params.revisionId2, 
        page_id: req.params.pageId 
      }).populate('user_id', 'name email')
    ]);
    
    if (!revision1 || !revision2) {
      return res.status(404).json({ error: 'One or both revisions not found' });
    }
    
    // Simple comparison (can be enhanced with more sophisticated diff logic)
    const comparison = {
      revision1: {
        _id: revision1._id,
        version_number: revision1.version_number,
        change_description: revision1.change_description,
        user: revision1.user_id,
        createdAt: revision1.createdAt,
        sections_count: revision1.sections_snapshot.length
      },
      revision2: {
        _id: revision2._id,
        version_number: revision2.version_number,
        change_description: revision2.change_description,
        user: revision2.user_id,
        createdAt: revision2.createdAt,
        sections_count: revision2.sections_snapshot.length
      },
      differences: {
        sections_count_change: revision2.sections_snapshot.length - revision1.sections_snapshot.length,
        theme_settings_changed: JSON.stringify(revision1.theme_settings_snapshot) !== JSON.stringify(revision2.theme_settings_snapshot)
      }
    };
    
    res.json(comparison);
  } catch (error) {
    console.error('Error comparing revisions:', error);
    res.status(500).json({ error: 'Failed to compare revisions' });
  }
});

module.exports = router;