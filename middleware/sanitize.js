const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');

const sanitizeInput = [
  // Prevent NoSQL injection attacks
  mongoSanitize({
    replaceWith: '_',
    onSanitize: ({ req, key }) => {
      console.warn(`Potential NoSQL injection attempt detected: ${key} in ${req.path}`);
    }
  }),
  // Prevent XSS attacks
  xss()
];

module.exports = sanitizeInput;