/**
 * Validation Middleware
 * Request validation for API endpoints
 */

const { body, param, query, validationResult } = require('express-validator');

// Validation result checker
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Generic request validator
const validateRequest = (validationSchema) => {
  return [
    ...buildValidationChain(validationSchema),
    handleValidationErrors
  ];
};

// Build validation chain from schema
const buildValidationChain = (schema) => {
  const validations = [];
  
  // Body validations
  if (schema.body) {
    Object.entries(schema.body).forEach(([field, rules]) => {
      let validation = body(field);
      
      if (rules.required) {
        validation = validation.notEmpty().withMessage(`${field} is required`);
      }
      
      if (rules.type === 'email') {
        validation = validation.isEmail().withMessage(`${field} must be a valid email`);
      }
      
      if (rules.type === 'string') {
        validation = validation.isString().withMessage(`${field} must be a string`);
        if (rules.minLength) {
          validation = validation.isLength({ min: rules.minLength }).withMessage(`${field} must be at least ${rules.minLength} characters`);
        }
        if (rules.maxLength) {
          validation = validation.isLength({ max: rules.maxLength }).withMessage(`${field} must not exceed ${rules.maxLength} characters`);
        }
      }
      
      if (rules.type === 'number') {
        validation = validation.isNumeric().withMessage(`${field} must be a number`);
        if (rules.min !== undefined) {
          validation = validation.isFloat({ min: rules.min }).withMessage(`${field} must be at least ${rules.min}`);
        }
        if (rules.max !== undefined) {
          validation = validation.isFloat({ max: rules.max }).withMessage(`${field} must not exceed ${rules.max}`);
        }
      }
      
      if (rules.pattern) {
        validation = validation.matches(rules.pattern).withMessage(`${field} format is invalid`);
      }
      
      if (rules.enum) {
        validation = validation.isIn(rules.enum).withMessage(`${field} must be one of: ${rules.enum.join(', ')}`);
      }
      
      validations.push(validation);
    });
  }
  
  // Param validations
  if (schema.params) {
    Object.entries(schema.params).forEach(([field, rules]) => {
      let validation = param(field);
      
      if (rules.required) {
        validation = validation.notEmpty().withMessage(`${field} parameter is required`);
      }
      
      if (rules.pattern) {
        validation = validation.matches(rules.pattern).withMessage(`${field} parameter format is invalid`);
      }
      
      validations.push(validation);
    });
  }
  
  // Query validations
  if (schema.query) {
    Object.entries(schema.query).forEach(([field, rules]) => {
      let validation = query(field);
      
      if (rules.required) {
        validation = validation.notEmpty().withMessage(`${field} query parameter is required`);
      }
      
      if (rules.pattern) {
        validation = validation.matches(rules.pattern).withMessage(`${field} query parameter format is invalid`);
      }
      
      if (rules.enum) {
        validation = validation.isIn(rules.enum).withMessage(`${field} must be one of: ${rules.enum.join(', ')}`);
      }
      
      validations.push(validation.optional());
    });
  }
  
  return validations;
};

module.exports = {
  validateRequest,
  handleValidationErrors
};