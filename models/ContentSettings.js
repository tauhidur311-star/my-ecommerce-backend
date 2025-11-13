const mongoose = require('mongoose');

const contentSettingsSchema = new mongoose.Schema({
  sectionType: {
    type: String,
    required: true,
    enum: ['featuredProduct', 'imageGallery', 'hero', 'testimonials', 'newsletter'],
    index: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0
  },
  settings: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Create compound index for efficient queries
contentSettingsSchema.index({ sectionType: 1, isActive: 1, order: 1 });

// Static method to get settings for a specific section
contentSettingsSchema.statics.getSectionSettings = async function(sectionType) {
  const settings = await this.findOne({ s
    sectionType,
    isActive: true
  }).lean();
  
  return settings || this.getDefaultSettings(sectionType);
};

// Static method to get default settings for each section type
contentSettingsSchema.statics.getDefaultSettings = function(sectionType) {
  const defaults = {
    featuredProduct: {
      sectionType: 'featuredProduct',
      isActive: true,
      settings: {
        productId: null,
        customTitle: '',
        customSubtitle: '',
        layout: 'standard', // 'standard', 'banner', 'card'
        showPrice: true,
        showDescription: true,
        showRating: true,
        backgroundColor: '#ffffff',
        textColor: '#000000',
        buttonText: 'Shop Now',
        buttonColor: '#007bff'
      }
    },
    imageGallery: {
      sectionType: 'imageGallery',
      isActive: true,
      settings: {
        title: 'Our Gallery',
        subtitle: '',
        images: [],
        imagesPerRow: 3,
        showLightbox: true,
        spacing: 'normal', // 'tight', 'normal', 'loose'
        aspectRatio: 'square', // 'square', 'landscape', 'portrait', 'auto'
        borderRadius: 8,
        showTitles: false
      }
    },
    testimonials: {
      sectionType: 'testimonials',
      isActive: true,
      settings: {
        title: 'What Our Customers Say',
        subtitle: '',
        layout: 'carousel', // 'carousel', 'grid', 'list'
        showAvatars: true,
        showRatings: true,
        autoplay: true,
        autoplayInterval: 5000,
        itemsPerView: 3,
        backgroundColor: '#f8f9fa'
      }
    },
    hero: {
      sectionType: 'hero',
      isActive: true,
      settings: {
        title: 'Welcome to Our Store',
        subtitle: 'Discover amazing products',
        backgroundImage: '',
        backgroundColor: '#f8f9fa',
        textColor: '#000000',
        buttonText: 'Shop Now',
        buttonUrl: '/products',
        alignment: 'center', // 'left', 'center', 'right'
        height: 'medium' // 'small', 'medium', 'large', 'full'
      }
    },
    newsletter: {
      sectionType: 'newsletter',
      isActive: true,
      settings: {
        title: 'Stay Updated',
        subtitle: 'Subscribe to our newsletter for the latest updates',
        placeholder: 'Enter your email address',
        buttonText: 'Subscribe',
        backgroundColor: '#007bff',
        textColor: '#ffffff',
        successMessage: 'Thank you for subscribing!',
        layout: 'inline' // 'inline', 'stacked'
      }
    }
  };

  return defaults[sectionType] || {};
};

// Instance method to merge with defaults
contentSettingsSchema.methods.getMergedSettings = function() {
  const defaults = this.constructor.getDefaultSettings(this.sectionType);
  return {
    ...defaults,
    ...this.toObject(),
    settings: {
      ...defaults.settings,
      ...this.settings
    }
  };
};

module.exports = mongoose.model('ContentSettings', contentSettingsSchema);