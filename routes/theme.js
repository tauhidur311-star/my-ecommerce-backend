const express = require('express');
const router = express.Router();
const {
  getThemes,
  createTheme,
  getTemplates,
  getTemplate,
  updateTemplate,
  publishTemplate,
  rollbackTemplate,
  exportTemplate,
  importTemplate
} = require('../controllers/themeController');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

// All theme routes require authentication and admin access
router.use(auth);
router.use(adminAuth);

// Theme routes
router.get('/', getThemes);
router.post('/', createTheme);

// Template routes
router.get('/:themeId/templates', getTemplates);
router.get('/templates/:id', getTemplate);
router.put('/templates/:id', updateTemplate);
router.post('/templates/:id/publish', publishTemplate);
router.post('/templates/:id/rollback', rollbackTemplate);
router.get('/templates/:id/export', exportTemplate);
router.post('/import', importTemplate);

module.exports = router;