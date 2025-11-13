const express = require('express');
const router = express.Router();

// Import controllers
const enhancedAnalyticsController = require('../controllers/enhancedAnalyticsController');
const inventoryController = require('../controllers/inventoryController');
const customerController = require('../controllers/customerController');

// Import middleware
const { adminAuth } = require('../middleware/adminAuth');
// Import rate limit with fallback
let rateLimit;
try {
  rateLimit = require('../middleware/rateLimit').rateLimit || require('express-rate-limit');
} catch (error) {
  rateLimit = require('express-rate-limit');
}

// Apply admin authentication to all routes
router.use(adminAuth);

// Enhanced Analytics Routes
router.get('/analytics/summary', rateLimit(100), enhancedAnalyticsController.getSummary);
router.get('/analytics/sales', rateLimit(100), enhancedAnalyticsController.getSalesAnalytics);
router.get('/analytics/customers', rateLimit(100), enhancedAnalyticsController.getCustomerAnalytics);
router.get('/analytics/products', rateLimit(100), enhancedAnalyticsController.getProductAnalytics);
router.get('/analytics/geographic', rateLimit(100), enhancedAnalyticsController.getGeographicAnalytics);

// Inventory Management Routes
router.get('/inventory', rateLimit(200), inventoryController.getInventory);
router.get('/inventory/alerts', rateLimit(100), inventoryController.getLowStockAlerts);
router.get('/inventory/analytics', rateLimit(100), inventoryController.getInventoryAnalytics);
router.put('/inventory/:productId/stock', rateLimit(50), inventoryController.updateStock);
router.put('/inventory/bulk-update', rateLimit(10), inventoryController.bulkUpdate);
router.post('/inventory/send-alert', rateLimit(20), inventoryController.sendLowStockAlert);

// Customer Management Routes
router.get('/customers', rateLimit(200), customerController.getCustomers);
router.get('/customers/segments', rateLimit(100), customerController.getCustomerSegments);
router.get('/customers/segmented', rateLimit(100), customerController.getSegmentedCustomers);
router.get('/customers/:customerId', rateLimit(100), customerController.getCustomerDetails);
router.get('/customers/:customerId/orders', rateLimit(100), customerController.getCustomerOrders);
router.get('/customers/:customerId/analytics', rateLimit(100), customerController.getCustomerAnalyticsEndpoint);
router.put('/customers/:customerId', rateLimit(50), customerController.updateCustomer);
router.delete('/customers/:customerId', rateLimit(20), customerController.deleteCustomer);
router.post('/customers/segments', rateLimit(20), customerController.createCustomSegment);
router.get('/customers/segments/:segmentName/export', rateLimit(10), customerController.exportSegmentData);

module.exports = router;