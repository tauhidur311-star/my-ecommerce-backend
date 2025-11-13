const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Contact = require('../../models/Contact');
const { adminAuth } = require('../../middleware/adminAuth');

// Enhanced email service
let enhancedEmailService;
try {
  enhancedEmailService = require('../../utils/mailjetEmailService');
} catch (error) {
  enhancedEmailService = require('../../utils/emailService');
}

// @route   GET /api/admin/contacts
// @desc    Get all contact submissions with filtering and pagination
// @access  Private/Admin
router.get('/', adminAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      subject,
      priority,
      isSpam,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      dateFrom,
      dateTo,
      assignedTo
    } = req.query;

    // Build filter object
    const filter = {};

    // Status filter
    if (status) {
      filter.status = status;
    }

    // Subject filter
    if (subject) {
      filter.subject = subject;
    }

    // Priority filter
    if (priority) {
      filter.priority = priority;
    }

    // Spam filter
    if (isSpam !== undefined) {
      filter.isSpam = isSpam === 'true';
    }

    // Assigned filter
    if (assignedTo) {
      if (assignedTo === 'unassigned') {
        filter.assignedTo = null;
      } else {
        filter.assignedTo = assignedTo;
      }
    }

    // Search filter (name, email, message)
    if (search) {
      const searchRegex = new RegExp(search, 'i');
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { message: searchRegex }
      ];
    }

    // Date range filter
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) {
        filter.createdAt.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        filter.createdAt.$lte = new Date(dateTo + 'T23:59:59.999Z');
      }
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Sort options
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query
    const [contacts, totalCount] = await Promise.all([
      Contact.find(filter)
        .populate('assignedTo', 'name email')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Contact.countDocuments(filter)
    ]);

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount / parseInt(limit));
    const hasNextPage = parseInt(page) < totalPages;
    const hasPrevPage = parseInt(page) > 1;

    res.json({
      success: true,
      data: contacts,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalCount,
        hasNextPage,
        hasPrevPage,
        limit: parseInt(limit)
      },
      filters: {
        status,
        subject,
        priority,
        isSpam,
        search,
        dateFrom,
        dateTo,
        assignedTo
      }
    });

  } catch (error) {
    console.error('❌ Admin contacts fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contact submissions',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   GET /api/admin/contacts/stats
// @desc    Get detailed contact statistics
// @access  Private/Admin
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    // Build date filter
    const dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.createdAt = {};
      if (dateFrom) dateFilter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) dateFilter.createdAt.$lte = new Date(dateTo + 'T23:59:59.999Z');
    }

    // Get overall stats
    const [
      totalContacts,
      todayContacts,
      weekContacts,
      monthContacts,
      statusStats,
      subjectStats,
      priorityStats,
      responseTimeStats,
      spamStats
    ] = await Promise.all([
      // Total contacts
      Contact.countDocuments(dateFilter),
      
      // Today's contacts
      Contact.countDocuments({
        ...dateFilter,
        createdAt: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }),
      
      // This week's contacts
      Contact.countDocuments({
        ...dateFilter,
        createdAt: {
          $gte: new Date(new Date().setDate(new Date().getDate() - 7))
        }
      }),
      
      // This month's contacts
      Contact.countDocuments({
        ...dateFilter,
        createdAt: {
          $gte: new Date(new Date().setDate(new Date().getDate() - 30))
        }
      }),
      
      // Status breakdown
      Contact.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            latest: { $max: '$createdAt' }
          }
        },
        { $sort: { count: -1 } }
      ]),
      
      // Subject breakdown
      Contact.aggregate([
        { $match: { ...dateFilter, isSpam: { $ne: true } } },
        {
          $group: {
            _id: '$subject',
            count: { $sum: 1 },
            latest: { $max: '$createdAt' }
          }
        },
        { $sort: { count: -1 } }
      ]),
      
      // Priority breakdown
      Contact.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$priority',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]),
      
      // Average response time
      Contact.aggregate([
        {
          $match: {
            ...dateFilter,
            responseTime: { $exists: true },
            isSpam: { $ne: true }
          }
        },
        {
          $group: {
            _id: null,
            avgResponseTime: {
              $avg: {
                $subtract: ['$responseTime', '$createdAt']
              }
            },
            count: { $sum: 1 }
          }
        }
      ]),
      
      // Spam statistics
      Contact.aggregate([
        { $match: dateFilter },
        {
          $group: {
            _id: '$isSpam',
            count: { $sum: 1 },
            avgSpamScore: { $avg: '$spamScore' }
          }
        }
      ])
    ]);

    // Format response time (convert milliseconds to hours)
    const avgResponseTimeHours = responseTimeStats[0] 
      ? Math.round(responseTimeStats[0].avgResponseTime / (1000 * 60 * 60) * 10) / 10
      : null;

    res.json({
      success: true,
      data: {
        overview: {
          total: totalContacts,
          today: todayContacts,
          thisWeek: weekContacts,
          thisMonth: monthContacts
        },
        breakdown: {
          byStatus: statusStats,
          bySubject: subjectStats,
          byPriority: priorityStats
        },
        performance: {
          avgResponseTimeHours,
          responsesGiven: responseTimeStats[0]?.count || 0
        },
        spam: {
          total: spamStats.find(s => s._id === true)?.count || 0,
          legitimate: spamStats.find(s => s._id !== true)?.count || 0,
          avgSpamScore: spamStats.find(s => s._id === true)?.avgSpamScore || 0
        }
      }
    });

  } catch (error) {
    console.error('❌ Admin contact stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contact statistics'
    });
  }
});

// @route   GET /api/admin/contacts/:id
// @desc    Get single contact submission details
// @access  Private/Admin
router.get('/:id', adminAuth, async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id)
      .populate('assignedTo', 'name email')
      .populate('adminNotes.addedBy', 'name email');

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact submission not found'
      });
    }

    res.json({
      success: true,
      data: contact
    });

  } catch (error) {
    console.error('❌ Admin contact fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contact submission'
    });
  }
});

// @route   PATCH /api/admin/contacts/:id/mark-read
// @desc    Mark contact as read
// @access  Private/Admin
router.patch('/:id/mark-read', adminAuth, async (req, res) => {
  try {
    const contactId = req.params.id;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(contactId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid contact ID'
      });
    }

    // Find and update the contact
    const contact = await Contact.findByIdAndUpdate(
      contactId,
      { 
        isRead: true,
        readAt: new Date(),
        readBy: req.user._id
      },
      { new: true, runValidators: true }
    ).populate('assignedTo', 'name email')
     .populate('readBy', 'name email');

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact submission not found'
      });
    }

    res.json({
      success: true,
      message: 'Contact marked as read successfully',
      data: contact
    });

  } catch (error) {
    console.error('❌ Mark contact as read error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark contact as read',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// @route   PATCH /api/admin/contacts/:id/status
// @desc    Update contact status
// @access  Private/Admin
router.patch('/:id/status', adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['new', 'in-progress', 'resolved', 'closed'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
      });
    }

    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      { 
        status,
        ...(status === 'resolved' && { resolvedAt: new Date() }),
        ...(status === 'in-progress' && !contact.responseTime && { responseTime: new Date() })
      },
      { new: true, runValidators: true }
    );

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact submission not found'
      });
    }

    res.json({
      success: true,
      data: contact,
      message: `Contact status updated to ${status}`
    });

  } catch (error) {
    console.error('❌ Contact status update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update contact status'
    });
  }
});

// @route   PATCH /api/admin/contacts/:id/assign
// @desc    Assign contact to admin user
// @access  Private/Admin
router.patch('/:id/assign', adminAuth, async (req, res) => {
  try {
    const { assignedTo } = req.body;

    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      { 
        assignedTo: assignedTo || null,
        ...(assignedTo && { status: 'in-progress' }),
        ...(assignedTo && !contact.responseTime && { responseTime: new Date() })
      },
      { new: true, runValidators: true }
    ).populate('assignedTo', 'name email');

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact submission not found'
      });
    }

    res.json({
      success: true,
      data: contact,
      message: assignedTo ? 'Contact assigned successfully' : 'Contact unassigned'
    });

  } catch (error) {
    console.error('❌ Contact assignment error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to assign contact'
    });
  }
});

// @route   PATCH /api/admin/contacts/:id/priority
// @desc    Update contact priority
// @access  Private/Admin
router.patch('/:id/priority', adminAuth, async (req, res) => {
  try {
    const { priority } = req.body;
    const validPriorities = ['low', 'medium', 'high', 'urgent'];

    if (!validPriorities.includes(priority)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid priority. Must be one of: ' + validPriorities.join(', ')
      });
    }

    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      { priority },
      { new: true, runValidators: true }
    );

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact submission not found'
      });
    }

    res.json({
      success: true,
      data: contact,
      message: `Priority updated to ${priority}`
    });

  } catch (error) {
    console.error('❌ Contact priority update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update contact priority'
    });
  }
});

// @route   POST /api/admin/contacts/:id/notes
// @desc    Add admin note to contact
// @access  Private/Admin
router.post('/:id/notes', adminAuth, async (req, res) => {
  try {
    const { note } = req.body;

    if (!note || note.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Note content is required'
      });
    }

    const contact = await Contact.findById(req.params.id);

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact submission not found'
      });
    }

    contact.adminNotes.push({
      note: note.trim(),
      addedBy: req.user.id,
      addedAt: new Date()
    });

    await contact.save();

    // Populate the new note
    await contact.populate('adminNotes.addedBy', 'name email');

    res.json({
      success: true,
      data: contact.adminNotes[contact.adminNotes.length - 1],
      message: 'Note added successfully'
    });

  } catch (error) {
    console.error('❌ Add note error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add note'
    });
  }
});

// @route   PATCH /api/admin/contacts/:id/spam
// @desc    Mark/unmark contact as spam
// @access  Private/Admin
router.patch('/:id/spam', adminAuth, async (req, res) => {
  try {
    const { isSpam } = req.body;

    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      { 
        isSpam: Boolean(isSpam),
        ...(isSpam && { status: 'closed', spamScore: 100 })
      },
      { new: true, runValidators: true }
    );

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact submission not found'
      });
    }

    res.json({
      success: true,
      data: contact,
      message: isSpam ? 'Marked as spam' : 'Unmarked as spam'
    });

  } catch (error) {
    console.error('❌ Spam toggle error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update spam status'
    });
  }
});

// @route   POST /api/admin/contacts/bulk-action
// @desc    Handle bulk actions on multiple contacts
// @access  Private/Admin
router.post('/bulk-action', adminAuth, async (req, res) => {
  try {
    const { action, ids } = req.body;

    // Validation
    if (!action || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Action and contact IDs are required'
      });
    }

    // Validate ObjectIds
    const validIds = ids.filter(id => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length !== ids.length) {
      return res.status(400).json({
        success: false,
        error: 'Some contact IDs are invalid'
      });
    }

    let updateResult = {};
    let deletedCount = 0;

    switch (action) {
      case 'markRead':
        updateResult = await Contact.updateMany(
          { _id: { $in: validIds } },
          { 
            isRead: true,
            readAt: new Date(),
            readBy: req.user._id
          }
        );
        break;

      case 'archive':
        updateResult = await Contact.updateMany(
          { _id: { $in: validIds } },
          { 
            status: 'closed',
            resolvedAt: new Date(),
            resolvedBy: req.user._id
          }
        );
        break;

      case 'delete':
        const deleteResult = await Contact.deleteMany({ _id: { $in: validIds } });
        deletedCount = deleteResult.deletedCount;
        break;

      case 'updatePriority':
        const { priority } = req.body;
        if (!priority || !['low', 'medium', 'high', 'urgent'].includes(priority)) {
          return res.status(400).json({
            success: false,
            error: 'Valid priority is required for priority update'
          });
        }
        updateResult = await Contact.updateMany(
          { _id: { $in: validIds } },
          { priority }
        );
        break;

      case 'assign':
        const { assignedTo } = req.body;
        if (!assignedTo || !mongoose.Types.ObjectId.isValid(assignedTo)) {
          return res.status(400).json({
            success: false,
            error: 'Valid assigned user ID is required'
          });
        }
        updateResult = await Contact.updateMany(
          { _id: { $in: validIds } },
          { 
            assignedTo,
            status: 'in-progress'
          }
        );
        break;

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action specified'
        });
    }

    // Log the bulk action for audit trail
    console.log(`✅ Bulk action performed: ${action} on ${validIds.length} contacts by user ${req.user._id}`);

    res.json({
      success: true,
      message: `Bulk ${action} completed successfully`,
      data: {
        action,
        affectedCount: action === 'delete' ? deletedCount : updateResult.modifiedCount,
        totalRequested: validIds.length
      }
    });

  } catch (error) {
    console.error('❌ Bulk action error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform bulk action',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
// @desc    Perform bulk actions on multiple contacts
// @access  Private/Admin
router.post('/bulk-actions', adminAuth, async (req, res) => {
  try {
    const { action, contactIds, data = {} } = req.body;

    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Contact IDs array is required'
      });
    }

    const validActions = ['updateStatus', 'assign', 'updatePriority', 'markSpam', 'delete'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid action. Must be one of: ' + validActions.join(', ')
      });
    }

    let updateData = {};
    let result;

    switch (action) {
      case 'updateStatus':
        const validStatuses = ['new', 'in-progress', 'resolved', 'closed'];
        if (!validStatuses.includes(data.status)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid status'
          });
        }
        updateData.status = data.status;
        if (data.status === 'resolved') {
          updateData.resolvedAt = new Date();
        }
        break;

      case 'assign':
        updateData.assignedTo = data.assignedTo || null;
        if (data.assignedTo) {
          updateData.status = 'in-progress';
        }
        break;

      case 'updatePriority':
        const validPriorities = ['low', 'medium', 'high', 'urgent'];
        if (!validPriorities.includes(data.priority)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid priority'
          });
        }
        updateData.priority = data.priority;
        break;

      case 'markSpam':
        updateData.isSpam = Boolean(data.isSpam);
        if (data.isSpam) {
          updateData.status = 'closed';
          updateData.spamScore = 100;
        }
        break;

      case 'delete':
        result = await Contact.deleteMany({
          _id: { $in: contactIds }
        });
        
        return res.json({
          success: true,
          data: {
            deletedCount: result.deletedCount,
            action: 'delete'
          },
          message: `${result.deletedCount} contacts deleted successfully`
        });
    }

    // Perform the bulk update
    if (action !== 'delete') {
      result = await Contact.updateMany(
        { _id: { $in: contactIds } },
        { $set: updateData },
        { runValidators: true }
      );
    }

    res.json({
      success: true,
      data: {
        modifiedCount: result.modifiedCount,
        matchedCount: result.matchedCount,
        action,
        updateData
      },
      message: `${result.modifiedCount} contacts updated successfully`
    });

  } catch (error) {
    console.error('❌ Bulk action error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to perform bulk action'
    });
  }
});

// @route   DELETE /api/admin/contacts/:id
// @desc    Delete single contact submission
// @access  Private/Admin
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const contact = await Contact.findByIdAndDelete(req.params.id);

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact submission not found'
      });
    }

    res.json({
      success: true,
      data: contact,
      message: 'Contact submission deleted successfully'
    });

  } catch (error) {
    console.error('❌ Contact deletion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete contact submission'
    });
  }
});

// @route   POST /api/admin/contacts/:id/reply
// @desc    Send email reply to contact submission
// @access  Private/Admin
router.post('/:id/reply', adminAuth, async (req, res) => {
  try {
    const { subject, message, markAsResolved = true } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        error: 'Subject and message are required'
      });
    }

    const contact = await Contact.findById(req.params.id);

    if (!contact) {
      return res.status(404).json({
        success: false,
        error: 'Contact submission not found'
      });
    }

    // Send email reply
    const emailContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #4F46E5;">Response to Your Contact Inquiry</h2>
        
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #333; margin-top: 0;">Your Original Message:</h3>
          <p style="color: #666; font-style: italic;">"${contact.message}"</p>
        </div>
        
        <div style="background-color: #fff; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h3 style="color: #333; margin-top: 0;">Our Response:</h3>
          <div style="white-space: pre-wrap; line-height: 1.6;">${message}</div>
        </div>
        
        <div style="margin-top: 30px; padding: 20px; background-color: #e8f4fd; border-radius: 8px;">
          <p style="margin: 0; color: #666; font-size: 14px;">
            <strong>Need further assistance?</strong> Feel free to reply to this email or contact us through our website.
            <br>
            Reference ID: ${contact._id}
          </p>
        </div>
      </div>
    `;

    await enhancedEmailService.sendEmail({
      to: contact.email,
      subject: subject,
      html: emailContent
    });

    // Add admin note about the reply
    contact.adminNotes.push({
      note: `Email reply sent: "${subject}"`,
      addedBy: req.user.id,
      addedAt: new Date()
    });

    // Update contact status if requested
    if (markAsResolved) {
      contact.status = 'resolved';
      contact.resolvedAt = new Date();
    }

    // Set response time if not already set
    if (!contact.responseTime) {
      contact.responseTime = new Date();
    }

    await contact.save();

    res.json({
      success: true,
      data: contact,
      message: 'Reply sent successfully'
    });

  } catch (error) {
    console.error('❌ Reply email error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send reply email'
    });
  }
});

module.exports = router;