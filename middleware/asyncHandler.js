/**
 * Async Handler Middleware
 * Wraps async functions to catch errors and pass them to error handler
 */

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;