const express = require('express');
const router = express.Router();
const { adminAuth } = require('../../middleware/adminAuth');
const { body, validationResult } = require('express-validator');

// Contact Info model (create if doesn't exist)
const mongoose = require('mongoose');

const contactInfoSchema = new mongoose.Schema({
  address: {
    type: String,
    maxlength: [500, 'Address cannot exceed 500 characters']
  },
  phoneNumber: {
    type: String,
    validate: {
      validator: function(v) {
        return !v || /^[\+]?[1-9][\d]{0,15}$/.test(v.replace(/[\s\-\(\)]/g, ''));
      },
      message: 'Please enter a valid phone number'
    }
  },
  email: {
    type: String,
    validate: {
      validator: function(v) {
        return !v || /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(v);
      },
      message: 'Please enter a valid email address'
    }
  },
  liveChatAvailability: {
    type: String,
    maxlength: [100, 'Live chat availability cannot exceed 100 characters']
  },
  socialLinks: {
    facebook: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^https?:\/\/(www\.)?facebook\.com\/.+/.test(v);
        },
        message: 'Please enter a valid Facebook URL'
      }
    },
    twitter: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/.+/.test(v);
        },
        message: 'Please enter a valid Twitter/X URL'
      }
    },
    instagram: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^https?:\/\/(www\.)?instagram\.com\/.+/.test(v);
        },
        message: 'Please enter a valid Instagram URL'
      }
    },
    linkedin: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^https?:\/\/(www\.)?linkedin\.com\/.+/.test(v);
        },
        message: 'Please enter a valid LinkedIn URL'
      }
    },
    youtube: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^https?:\/\/(www\.)?youtube\.com\/.+/.test(v);
        },
        message: 'Please enter a valid YouTube URL'
      }
    },
    tiktok: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^https?:\/\/(www\.)?tiktok\.com\/.+/.test(v);
        },
        message: 'Please enter a valid TikTok URL'
      }
    }
  },
  businessHours: {
    monday: {
      open: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      close: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      closed: { type: Boolean, default: false }
    },
    tuesday: {
      open: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      close: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      closed: { type: Boolean, default: false }
    },
    wednesday: {
      open: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      close: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      closed: { type: Boolean, default: false }
    },
    thursday: {
      open: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      close: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      closed: { type: Boolean, default: false }
    },
    friday: {
      open: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      close: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      closed: { type: Boolean, default: false }
    },
    saturday: {
      open: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      close: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      closed: { type: Boolean, default: false }
    },
    sunday: {
      open: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      close: { type: String, match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ },
      closed: { type: Boolean, default: true }
    }
  },
  emergencyContact: {
    phone: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^[\+]?[1-9][\d]{0,15}$/.test(v.replace(/[\s\-\(\)]/g, ''));
        },
        message: 'Please enter a valid emergency phone number'
      }
    },
    description: {
      type: String,
      maxlength: [200, 'Emergency description cannot exceed 200 characters']
    }
  },
  mapSettings: {
    embedUrl: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^https?:\/\/(www\.)?google\.com\/maps\/embed/.test(v);
        },
        message: 'Please enter a valid Google Maps embed URL'
      }
    },
    address: String,
    latitude: Number,
    longitude: Number,
    showDirections: { type: Boolean, default: true },
    showLocationDetails: { type: Boolean, default: true }
  },
  companyInfo: {
    name: {
      type: String,
      maxlength: [100, 'Company name cannot exceed 100 characters']
    },
    description: {
      type: String,
      maxlength: [500, 'Company description cannot exceed 500 characters']
    },
    website: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^https?:\/\/.+\..+/.test(v);
        },
        message: 'Please enter a valid website URL'
      }
    },
    logo: String,
    established: Date
  },
  seoSettings: {
    title: {
      type: String,
      maxlength: [60, 'SEO title cannot exceed 60 characters']
    },
    description: {
      type: String,
      maxlength: [160, 'SEO description cannot exceed 160 characters']
    },
    keywords: [String]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for formatted business hours
contactInfoSchema.virtual('formattedBusinessHours').get(function() {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  return days.map(day => {
    const hours = this.businessHours[day];
    return {
      day: day.charAt(0).toUpperCase() + day.slice(1),
      ...hours,
      formatted: hours.closed ? 'Closed' : `${hours.open} - ${hours.close}`
    };
  });
});

// Ensure only one contact info document exists
contactInfoSchema.pre('save', async function(next) {
  if (this.isNew) {
    const existingCount = await this.constructor.countDocuments();
    if (existingCount > 0) {
      const error = new Error('Contact info already exists. Use update instead.');
      error.statusCode = 400;
      return next(error);
    }
  }
  next();
});

const ContactInfo = mongoose.model('ContactInfo', contactInfoSchema);

// Validation middleware
const validateContactInfo = [
  body('address').optional().isLength({ max: 500 }).withMessage('Address cannot exceed 500 characters'),
  body('phoneNumber').optional().isMobilePhone().withMessage('Please enter a valid phone number'),
  body('email').optional().isEmail().withMessage('Please enter a valid email address'),
  body('liveChatAvailability').optional().isLength({ max: 100 }).withMessage('Live chat availability cannot exceed 100 characters'),
  body('socialLinks.facebook').optional().isURL().withMessage('Please enter a valid Facebook URL'),
  body('socialLinks.twitter').optional().isURL().withMessage('Please enter a valid Twitter URL'),
  body('socialLinks.instagram').optional().isURL().withMessage('Please enter a valid Instagram URL'),
  body('socialLinks.linkedin').optional().isURL().withMessage('Please enter a valid LinkedIn URL'),
  body('emergencyContact.phone').optional().isMobilePhone().withMessage('Please enter a valid emergency phone number'),
  body('emergencyContact.description').optional().isLength({ max: 200 }).withMessage('Emergency description cannot exceed 200 characters')
];

// @route   GET /api/admin/contact-info
// @desc    Get contact information settings
// @access  Private/Admin
// Get public contact info (only visible fields) 
router.get('/public', async (req, res) => {
  try {
    const ContactInfo = require('../../models/ContentSettings');
    const contactInfo = await ContactInfo.findOne({ type: 'contact' });
    
    if (!contactInfo) {
      return res.json({
        success: true,
        data: {}
      });
    }

    // Only return visible contact information
    const publicInfo = {};
    
    if (contactInfo.data) {
      // Handle both old and new format
      if (contactInfo.data.phone?.isVisible !== false) {
        publicInfo.phoneNumber = contactInfo.data.phone;
      }
      if (contactInfo.data.email?.isVisible !== false) {
        publicInfo.email = contactInfo.data.email;
      }
      if (contactInfo.data.address?.isVisible !== false) {
        publicInfo.address = contactInfo.data.address;
      }
      
      // Include other fields as they are
      if (contactInfo.data.liveChatAvailability) {
        publicInfo.liveChatAvailability = contactInfo.data.liveChatAvailability;
      }
      if (contactInfo.data.businessHours) {
        publicInfo.businessHours = contactInfo.data.businessHours;
      }
      if (contactInfo.data.socialLinks) {
        publicInfo.socialLinks = contactInfo.data.socialLinks;
      }
      if (contactInfo.data.emergencyContact) {
        publicInfo.emergencyContact = contactInfo.data.emergencyContact;
      }
    }

    res.json({
      success: true,
      data: publicInfo
    });
  } catch (error) {
    console.error('Get public contact info error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch public contact info'
    });
  }
});

router.get('/', adminAuth, async (req, res) => {
  try {
    let contactInfo = await ContactInfo.findOne();

    // If no contact info exists, create default one
    if (!contactInfo) {
      contactInfo = new ContactInfo({
        address: '',
        phoneNumber: '',
        email: '',
        liveChatAvailability: 'Mon-Fri 9AM-6PM EST',
        socialLinks: {
          facebook: '',
          twitter: '',
          instagram: '',
          linkedin: '',
          youtube: '',
          tiktok: ''
        },
        businessHours: {
          monday: { open: '09:00', close: '17:00', closed: false },
          tuesday: { open: '09:00', close: '17:00', closed: false },
          wednesday: { open: '09:00', close: '17:00', closed: false },
          thursday: { open: '09:00', close: '17:00', closed: false },
          friday: { open: '09:00', close: '17:00', closed: false },
          saturday: { open: '10:00', close: '16:00', closed: false },
          sunday: { open: '10:00', close: '16:00', closed: true }
        },
        emergencyContact: {
          phone: '',
          description: ''
        },
        mapSettings: {
          embedUrl: '',
          address: '',
          showDirections: true,
          showLocationDetails: true
        },
        companyInfo: {
          name: '',
          description: '',
          website: ''
        },
        seoSettings: {
          title: 'Contact Us',
          description: 'Get in touch with us for any questions or inquiries.',
          keywords: ['contact', 'support', 'help']
        }
      });
      
      await contactInfo.save();
    }

    res.json({
      success: true,
      data: contactInfo
    });

  } catch (error) {
    console.error('❌ Contact info fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contact information'
    });
  }
});

// @route   PUT /api/admin/contact-info
// @desc    Update contact information settings
// @access  Private/Admin
router.put('/', adminAuth, validateContactInfo, async (req, res) => {
  try {
    // Check validation results
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const updateData = req.body;

    // Find existing contact info or create new one
    let contactInfo = await ContactInfo.findOne();

    if (contactInfo) {
      // Update existing
      Object.assign(contactInfo, updateData);
      await contactInfo.save();
    } else {
      // Create new
      contactInfo = new ContactInfo(updateData);
      await contactInfo.save();
    }

    res.json({
      success: true,
      data: contactInfo,
      message: 'Contact information updated successfully'
    });

  } catch (error) {
    console.error('❌ Contact info update error:', error);
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validationErrors
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update contact information'
    });
  }
});

// @route   GET /api/admin/contact-info/public
// @desc    Get public contact information (for frontend display)
// @access  Public
router.get('/public', async (req, res) => {
  try {
    const contactInfo = await ContactInfo.findOne().select('-__v -updatedAt');

    if (!contactInfo) {
      return res.json({
        success: true,
        data: null,
        message: 'No contact information configured'
      });
    }

    res.json({
      success: true,
      data: contactInfo
    });

  } catch (error) {
    console.error('❌ Public contact info fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch contact information'
    });
  }
});

// @route   PATCH /api/admin/contact-info/business-hours
// @desc    Update only business hours
// @access  Private/Admin
router.patch('/business-hours', adminAuth, async (req, res) => {
  try {
    const { businessHours } = req.body;

    if (!businessHours) {
      return res.status(400).json({
        success: false,
        error: 'Business hours data is required'
      });
    }

    const contactInfo = await ContactInfo.findOneAndUpdate(
      {},
      { $set: { businessHours } },
      { new: true, upsert: true, runValidators: true }
    );

    res.json({
      success: true,
      data: contactInfo,
      message: 'Business hours updated successfully'
    });

  } catch (error) {
    console.error('❌ Business hours update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update business hours'
    });
  }
});

// @route   PATCH /api/admin/contact-info/social-links
// @desc    Update only social media links
// @access  Private/Admin
router.patch('/social-links', adminAuth, async (req, res) => {
  try {
    const { socialLinks } = req.body;

    if (!socialLinks) {
      return res.status(400).json({
        success: false,
        error: 'Social links data is required'
      });
    }

    const contactInfo = await ContactInfo.findOneAndUpdate(
      {},
      { $set: { socialLinks } },
      { new: true, upsert: true, runValidators: true }
    );

    res.json({
      success: true,
      data: contactInfo,
      message: 'Social links updated successfully'
    });

  } catch (error) {
    console.error('❌ Social links update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update social links'
    });
  }
});

// @route   PATCH /api/admin/contact-info/map-settings
// @desc    Update map settings
// @access  Private/Admin
router.patch('/map-settings', adminAuth, async (req, res) => {
  try {
    const { mapSettings } = req.body;

    if (!mapSettings) {
      return res.status(400).json({
        success: false,
        error: 'Map settings data is required'
      });
    }

    const contactInfo = await ContactInfo.findOneAndUpdate(
      {},
      { $set: { mapSettings } },
      { new: true, upsert: true, runValidators: true }
    );

    res.json({
      success: true,
      data: contactInfo,
      message: 'Map settings updated successfully'
    });

  } catch (error) {
    console.error('❌ Map settings update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update map settings'
    });
  }
});

// @route   DELETE /api/admin/contact-info/reset
// @desc    Reset contact information to defaults
// @access  Private/Admin
router.delete('/reset', adminAuth, async (req, res) => {
  try {
    await ContactInfo.deleteMany({});

    const defaultContactInfo = new ContactInfo({
      address: '',
      phoneNumber: '',
      email: '',
      liveChatAvailability: 'Mon-Fri 9AM-6PM EST',
      socialLinks: {
        facebook: '',
        twitter: '',
        instagram: '',
        linkedin: '',
        youtube: '',
        tiktok: ''
      },
      businessHours: {
        monday: { open: '09:00', close: '17:00', closed: false },
        tuesday: { open: '09:00', close: '17:00', closed: false },
        wednesday: { open: '09:00', close: '17:00', closed: false },
        thursday: { open: '09:00', close: '17:00', closed: false },
        friday: { open: '09:00', close: '17:00', closed: false },
        saturday: { open: '10:00', close: '16:00', closed: false },
        sunday: { open: '10:00', close: '16:00', closed: true }
      },
      emergencyContact: {
        phone: '',
        description: ''
      }
    });

    await defaultContactInfo.save();

    res.json({
      success: true,
      data: defaultContactInfo,
      message: 'Contact information reset to defaults'
    });

  } catch (error) {
    console.error('❌ Contact info reset error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset contact information'
    });
  }
});

module.exports = router;