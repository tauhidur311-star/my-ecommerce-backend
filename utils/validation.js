const Joi = require('joi');

// Validation schemas
const registerValidation = Joi.object({
  name: Joi.string().min(2).max(50).trim().required(),
  email: Joi.string().email().lowercase().trim().required(),
  password: Joi.string().min(6).max(128).required(),
  phone: Joi.string().pattern(/^01[0-9]{9}$/).optional()
});

const loginValidation = Joi.object({
  email: Joi.string().email().lowercase().trim().required(),
  password: Joi.string().required(),
  rememberMe: Joi.boolean().optional()
});

const resetPasswordValidation = Joi.object({
  email: Joi.string().email().lowercase().trim().required()
});

const productValidation = Joi.object({
  name: Joi.string().min(1).max(200).trim().required(),
  description: Joi.string().max(2000).trim().optional().allow('', null).default(''),
  shortDescription: Joi.string().max(500).trim().optional().allow('', null),
  price: Joi.alternatives().try(
    Joi.number().positive(),
    Joi.string().custom((value) => {
      const num = parseFloat(value);
      if (isNaN(num) || num <= 0) throw new Error('Invalid price');
      return num;
    })
  ).required(),
  originalPrice: Joi.alternatives().try(
    Joi.number().positive(),
    Joi.string().custom((value) => {
      const num = parseFloat(value);
      if (isNaN(num) || num <= 0) throw new Error('Invalid original price');
      return num;
    })
  ).optional().allow('', null),
  category: Joi.string().min(1).required(),
  subcategory: Joi.string().max(50).optional().allow('', null),
  brand: Joi.string().max(50).optional().allow('', null),
  sku: Joi.string().max(50).optional().allow('', null),
  images: Joi.alternatives().try(
    Joi.array().items(Joi.string()),
    Joi.string()
  ).optional().default([]),
  sizes: Joi.array().items(Joi.string()).optional().default([]),
  colors: Joi.array().items(Joi.string()).optional().default([]),
  tags: Joi.array().items(Joi.string()).optional().default([]),
  stock: Joi.alternatives().try(
    Joi.number().integer().min(0),
    Joi.string().custom((value) => {
      const num = parseInt(value);
      if (isNaN(num) || num < 0) return 0;
      return num;
    })
  ).optional().default(0),
  inStock: Joi.alternatives().try(
    Joi.boolean(),
    Joi.string().custom((value) => value === 'true' || value === true)
  ).optional().default(true),
  featured: Joi.alternatives().try(
    Joi.boolean(),
    Joi.string().custom((value) => value === 'true' || value === true)
  ).optional().default(false),
  discount: Joi.alternatives().try(
    Joi.number().min(0).max(100),
    Joi.string().custom((value) => {
      const num = parseFloat(value);
      if (isNaN(num)) return 0;
      return Math.max(0, Math.min(100, num));
    })
  ).optional().default(0),
  sold: Joi.alternatives().try(
    Joi.number().integer().min(0),
    Joi.string().custom((value) => Math.max(0, parseInt(value) || 0))
  ).optional().default(0),
  showSoldNumbers: Joi.alternatives().try(
    Joi.boolean(),
    Joi.string().custom((value) => value !== 'false' && value !== false)
  ).optional().default(true),
  rating: Joi.alternatives().try(
    Joi.number().min(0).max(5),
    Joi.string().custom((value) => {
      const num = parseFloat(value);
      return isNaN(num) ? null : Math.max(0, Math.min(5, num));
    })
  ).optional().allow(null, ''),
  // Strip any extra fields
  id: Joi.any().optional().strip(),
  createdAt: Joi.any().optional().strip(),
  updatedAt: Joi.any().optional().strip(),
  _id: Joi.any().optional().strip()
}).options({ stripUnknown: true, allowUnknown: true });

const orderValidation = Joi.object({
  items: Joi.array().items(
    Joi.object({
      productId: Joi.string().hex().length(24).required(),
      quantity: Joi.number().integer().positive().required(),
      size: Joi.string().optional(),
      color: Joi.string().optional()
    })
  ).min(1).required(),
  shippingAddress: Joi.object({
    name: Joi.string().min(2).max(100).trim().required(),
    phone: Joi.string().pattern(/^01[0-9]{9}$/).required(),
    address: Joi.string().min(10).max(200).trim().required(),
    city: Joi.string().min(2).max(50).trim().required(),
    zipCode: Joi.string().max(10).optional(),
    state: Joi.string().max(50).optional()
  }).required(),
  billingAddress: Joi.object({
    name: Joi.string().min(2).max(100).trim().optional(),
    phone: Joi.string().pattern(/^01[0-9]{9}$/).optional(),
    address: Joi.string().min(10).max(200).trim().optional(),
    city: Joi.string().min(2).max(50).trim().optional(),
    zipCode: Joi.string().max(10).optional(),
    state: Joi.string().max(50).optional()
  }).optional(),
  paymentMethod: Joi.string().valid('bkash', 'nagad', 'rocket', 'upay', 'cod').required(),
  notes: Joi.string().max(500).optional(),
  couponCode: Joi.string().max(50).optional(),
  isGift: Joi.boolean().optional(),
  giftMessage: Joi.string().max(200).optional()
});

const profileUpdateValidation = Joi.object({
  name: Joi.string().min(2).max(50).trim().optional(),
  phone: Joi.string().pattern(/^01[0-9]{9}$/).optional(),
  address: Joi.object({
    street: Joi.string().max(200).trim().optional(),
    city: Joi.string().max(50).trim().optional(),
    state: Joi.string().max(50).trim().optional(),
    zipCode: Joi.string().max(10).optional(),
    country: Joi.string().max(50).optional()
  }).optional(),
  province: Joi.string().max(50).optional(),
  preferences: Joi.object({
    language: Joi.string().valid('en', 'bn').optional(),
    currency: Joi.string().valid('BDT', 'USD').optional(),
    notifications: Joi.object({
      email: Joi.boolean().optional(),
      sms: Joi.boolean().optional(),
      push: Joi.boolean().optional()
    }).optional()
  }).optional()
});

const changePasswordValidation = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).max(128).required()
});

const categoryValidation = Joi.object({
  name: Joi.string().min(2).max(50).trim().required(),
  description: Joi.string().max(500).trim().optional(),
  image: Joi.string().uri().optional(),
  icon: Joi.string().optional(),
  parentCategory: Joi.string().hex().length(24).optional(),
  isActive: Joi.boolean().optional(),
  sortOrder: Joi.number().integer().optional(),
  seo: Joi.object({
    metaTitle: Joi.string().max(60).optional(),
    metaDescription: Joi.string().max(160).optional(),
    metaKeywords: Joi.array().items(Joi.string()).optional()
  }).optional()
});

// Middleware function
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));
      
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors
      });
    }

    req.body = value;
    next();
  };
};

module.exports = {
  validate,
  schemas: {
    register: registerValidation,
    login: loginValidation,
    resetPassword: resetPasswordValidation,
    product: productValidation,
    order: orderValidation,
    profileUpdate: profileUpdateValidation,
    changePassword: changePasswordValidation,
    category: categoryValidation
  }
};