const express = require('express');
const router = express.Router();
const Design = require('../models/Design');
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/adminAuth');

// All analytics routes require authentication and admin access
router.use(auth);
router.use(adminAuth);

// Design performance analytics
router.get('/performance/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;
    const { timeframe = '30d' } = req.query;

    const design = await Design.findOne({ storeId, status: 'published' });
    if (!design) {
      return res.status(404).json({
        success: false,
        error: 'No published design found'
      });
    }

    // Calculate performance metrics
    const metrics = {
      sectionCount: design.layout.length,
      lastModified: design.updatedAt,
      saveCount: design.metadata?.saveCount || 0,
      designDuration: design.metadata?.designDuration || 0,
      status: design.status,
      version: design.version
    };

    // Section type distribution
    const sectionTypes = {};
    design.layout.forEach(section => {
      sectionTypes[section.type] = (sectionTypes[section.type] || 0) + 1;
    });

    res.json({
      success: true,
      data: {
        overview: metrics,
        sectionDistribution: sectionTypes,
        recommendations: generateOptimizationTips(design.layout)
      }
    });
  } catch (error) {
    console.error('Design analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch design analytics'
    });
  }
});

// Design optimization suggestions
router.get('/optimization/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;
    
    const design = await Design.findOne({ storeId, status: 'published' });
    if (!design) {
      return res.status(404).json({
        success: false,
        error: 'No published design found'
      });
    }

    const suggestions = [];

    // Check section count
    if (design.layout.length > 10) {
      suggestions.push({
        type: 'performance',
        severity: 'medium',
        message: 'Consider reducing sections for better page load speed',
        impact: 'Page performance'
      });
    }

    // Check for missing CTAs
    const heroSections = design.layout.filter(s => s.type === 'hero');
    heroSections.forEach((section, index) => {
      if (!section.content.primaryCTA && !section.content.ctaText) {
        suggestions.push({
          type: 'conversion',
          severity: 'high', 
          message: `Hero section #${index + 1} missing call-to-action`,
          impact: 'User engagement'
        });
      }
    });

    // Check for image optimization
    const gallerySections = design.layout.filter(s => s.type === 'gallery');
    if (gallerySections.length > 0) {
      suggestions.push({
        type: 'performance',
        severity: 'low',
        message: 'Ensure gallery images are optimized for web',
        impact: 'Page load speed'
      });
    }

    res.json({
      success: true,
      data: {
        suggestions,
        score: calculateDesignScore(design.layout),
        lastAnalyzed: new Date()
      }
    });
  } catch (error) {
    console.error('Design optimization error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate optimization suggestions'
    });
  }
});

// Helper functions
function generateOptimizationTips(sections) {
  const tips = [];
  
  if (sections.length === 0) {
    tips.push('Add sections to create engaging content');
  }
  
  if (!sections.some(s => s.type === 'hero')) {
    tips.push('Consider adding a hero section for better first impression');
  }
  
  if (!sections.some(s => s.type === 'contact' || s.type === 'newsletter')) {
    tips.push('Add contact or newsletter section to capture leads');
  }

  return tips;
}

function calculateDesignScore(sections) {
  let score = 0;
  const maxScore = 100;

  // Section diversity (30 points)
  const uniqueTypes = new Set(sections.map(s => s.type));
  score += Math.min(uniqueTypes.size * 5, 30);

  // Has hero section (20 points)
  if (sections.some(s => s.type === 'hero')) score += 20;

  // Has CTA sections (20 points)
  const ctaSections = sections.filter(s => 
    s.type === 'cta-block' || 
    (s.content.primaryCTA || s.content.ctaText)
  );
  score += Math.min(ctaSections.length * 10, 20);

  // Section count balance (20 points)
  if (sections.length >= 3 && sections.length <= 8) score += 20;
  else if (sections.length >= 2) score += 10;

  // Has contact method (10 points)
  if (sections.some(s => s.type === 'contact' || s.type === 'newsletter')) {
    score += 10;
  }

  return Math.min(score, maxScore);
}

module.exports = router;