/**
 * Export Controller
 * Handles design exports in various formats (JSON, HTML, PDF)
 */

const Export = require('../models/Export');
const Design = require('../models/Design');
const ErrorResponse = require('../utils/ErrorResponse');
const asyncHandler = require('../middleware/asyncHandler');
const logger = require('../utils/logger');
const { chromium } = require('playwright-core');
const fs = require('fs').promises;
const path = require('path');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

// @desc    Export design as JSON
// @route   POST /api/export/json
// @access  Private
exports.exportJSON = asyncHandler(async (req, res) => {
  const { designId, options = {} } = req.body;

  // Validate design access
  const design = await Design.findById(designId);
  if (!design) {
    throw new ErrorResponse('Design not found', 404);
  }

  if (design.user.toString() !== req.user.id && req.user.role !== 'admin') {
    throw new ErrorResponse('Not authorized to export this design', 403);
  }

  // Create export record
  const exportRecord = await Export.create({
    user: req.user.id,
    design: designId,
    format: 'json',
    options: {
      includeAssets: options.includeAssets !== false,
      compression: options.compression || false,
      version: options.version || '1.0.0',
      metadata: {
        title: options.metadata?.title || design.name,
        description: options.metadata?.description || '',
        author: req.user.name,
        created: new Date()
      }
    },
    analytics: {
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip
    }
  });

  try {
    await exportRecord.markAsProcessing();

    // Prepare export data
    const exportData = {
      version: exportRecord.options.version,
      metadata: exportRecord.options.metadata,
      design: {
        id: design._id,
        name: design.name,
        description: design.description,
        sections: design.sections,
        globalSettings: design.globalSettings,
        customCSS: design.customCSS
      },
      exportedAt: new Date().toISOString()
    };

    // Include assets if requested
    if (exportRecord.options.includeAssets) {
      exportData.assets = await extractAssets(design.sections);
    }

    // Generate filename
    const fileName = `${design.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
    const filePath = path.join(process.env.EXPORTS_DIR || './exports', fileName);

    // Ensure exports directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Write JSON file
    let jsonContent = JSON.stringify(exportData, null, exportRecord.options.compression ? 0 : 2);
    await fs.writeFile(filePath, jsonContent);

    // Get file stats
    const stats = await fs.stat(filePath);

    // Generate download URL
    const fileUrl = `/api/export/download/${exportRecord._id}`;

    await exportRecord.markAsCompleted({
      fileUrl,
      fileName,
      fileSize: stats.size
    });

    logger.info(`JSON export completed: ${fileName} for user ${req.user.id}`);

    res.status(200).json({
      success: true,
      message: 'Design exported successfully',
      data: {
        exportId: exportRecord._id,
        downloadUrl: fileUrl,
        fileName,
        fileSize: stats.size,
        format: 'json'
      }
    });

  } catch (error) {
    await exportRecord.markAsFailed(error.message);
    logger.error('JSON export failed:', error);
    throw new ErrorResponse('Export failed', 500);
  }
});

// @desc    Export design as HTML
// @route   POST /api/export/html
// @access  Private
exports.exportHTML = asyncHandler(async (req, res) => {
  const { designId, options = {} } = req.body;

  // Validate design access
  const design = await Design.findById(designId);
  if (!design) {
    throw new ErrorResponse('Design not found', 404);
  }

  if (design.user.toString() !== req.user.id && req.user.role !== 'admin') {
    throw new ErrorResponse('Not authorized to export this design', 403);
  }

  // Create export record
  const exportRecord = await Export.create({
    user: req.user.id,
    design: designId,
    format: 'html',
    options: {
      includeAssets: options.includeAssets !== false,
      compression: options.compression || false,
      version: options.version || '1.0.0',
      metadata: {
        title: options.metadata?.title || design.name,
        description: options.metadata?.description || '',
        author: req.user.name,
        created: new Date()
      }
    },
    analytics: {
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip
    }
  });

  try {
    await exportRecord.markAsProcessing();

    // Generate HTML content
    const htmlContent = await generateStaticHTML(design, exportRecord.options);

    // Create export directory
    const exportDir = path.join(process.env.EXPORTS_DIR || './exports', `${design.name}_${Date.now()}`);
    await fs.mkdir(exportDir, { recursive: true });

    // Write HTML file
    const htmlPath = path.join(exportDir, 'index.html');
    await fs.writeFile(htmlPath, htmlContent);

    // Copy assets if requested
    if (exportRecord.options.includeAssets) {
      const assetsDir = path.join(exportDir, 'assets');
      await fs.mkdir(assetsDir, { recursive: true });
      await copyAssets(design.sections, assetsDir);

      // Generate CSS file
      const cssContent = await generateCSS(design.globalSettings, design.customCSS);
      await fs.writeFile(path.join(assetsDir, 'styles.css'), cssContent);
    }

    // Create ZIP archive
    const zipFileName = `${design.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.zip`;
    const zipPath = path.join(process.env.EXPORTS_DIR || './exports', zipFileName);
    
    await createZipArchive(exportDir, zipPath);

    // Get file stats
    const stats = await fs.stat(zipPath);

    // Clean up temporary directory
    await fs.rmdir(exportDir, { recursive: true });

    // Generate download URL
    const fileUrl = `/api/export/download/${exportRecord._id}`;

    await exportRecord.markAsCompleted({
      fileUrl,
      fileName: zipFileName,
      fileSize: stats.size
    });

    logger.info(`HTML export completed: ${zipFileName} for user ${req.user.id}`);

    res.status(200).json({
      success: true,
      message: 'Design exported successfully',
      data: {
        exportId: exportRecord._id,
        downloadUrl: fileUrl,
        fileName: zipFileName,
        fileSize: stats.size,
        format: 'html'
      }
    });

  } catch (error) {
    await exportRecord.markAsFailed(error.message);
    logger.error('HTML export failed:', error);
    throw new ErrorResponse('Export failed', 500);
  }
});

// @desc    Export design as PDF
// @route   POST /api/export/pdf
// @access  Private
exports.exportPDF = asyncHandler(async (req, res) => {
  const { designId, options = {} } = req.body;

  // Validate design access
  const design = await Design.findById(designId);
  if (!design) {
    throw new ErrorResponse('Design not found', 404);
  }

  if (design.user.toString() !== req.user.id && req.user.role !== 'admin') {
    throw new ErrorResponse('Not authorized to export this design', 403);
  }

  // Create export record
  const exportRecord = await Export.create({
    user: req.user.id,
    design: designId,
    format: 'pdf',
    options: {
      includeAssets: true,
      compression: options.compression || false,
      version: options.version || '1.0.0',
      metadata: {
        title: options.metadata?.title || design.name,
        description: options.metadata?.description || '',
        author: req.user.name,
        created: new Date()
      }
    },
    analytics: {
      userAgent: req.get('User-Agent'),
      ipAddress: req.ip
    }
  });

  let browser;

  try {
    await exportRecord.markAsProcessing();

    // Generate HTML content for PDF
    const htmlContent = await generateStaticHTML(design, exportRecord.options);

    // Launch Playwright
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
      viewport: {
        width: options.width || 1200,
        height: options.height || 800
      }
    });
    const page = await context.newPage();

    // Set HTML content
    await page.setContent(htmlContent, {
      waitUntil: 'networkidle'
    });

    // PDF generation options
    const pdfOptions = {
      format: options.format || 'A4',
      printBackground: true,
      margin: {
        top: options.margin?.top || '1cm',
        bottom: options.margin?.bottom || '1cm',
        left: options.margin?.left || '1cm',
        right: options.margin?.right || '1cm'
      }
    };

    // Generate PDF
    const pdfBuffer = await page.pdf(pdfOptions);

    // Generate filename
    const fileName = `${design.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.pdf`;
    const filePath = path.join(process.env.EXPORTS_DIR || './exports', fileName);

    // Ensure exports directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Write PDF file
    await fs.writeFile(filePath, pdfBuffer);

    // Get file stats
    const stats = await fs.stat(filePath);

    // Generate download URL
    const fileUrl = `/api/export/download/${exportRecord._id}`;

    await exportRecord.markAsCompleted({
      fileUrl,
      fileName,
      fileSize: stats.size
    });

    logger.info(`PDF export completed: ${fileName} for user ${req.user.id}`);

    res.status(200).json({
      success: true,
      message: 'Design exported successfully',
      data: {
        exportId: exportRecord._id,
        downloadUrl: fileUrl,
        fileName,
        fileSize: stats.size,
        format: 'pdf'
      }
    });

  } catch (error) {
    await exportRecord.markAsFailed(error.message);
    logger.error('PDF export failed:', error);
    throw new ErrorResponse('Export failed', 500);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// @desc    Download exported file
// @route   GET /api/export/download/:exportId
// @access  Private
exports.downloadExport = asyncHandler(async (req, res) => {
  const exportRecord = await Export.findById(req.params.exportId);

  if (!exportRecord) {
    throw new ErrorResponse('Export not found', 404);
  }

  if (exportRecord.user.toString() !== req.user.id && req.user.role !== 'admin') {
    throw new ErrorResponse('Not authorized to download this export', 403);
  }

  if (exportRecord.status !== 'completed') {
    throw new ErrorResponse('Export is not ready for download', 400);
  }

  if (exportRecord.result.expiresAt && exportRecord.result.expiresAt < new Date()) {
    throw new ErrorResponse('Export has expired', 410);
  }

  const filePath = path.join(process.env.EXPORTS_DIR || './exports', exportRecord.result.fileName);

  try {
    await fs.access(filePath);
  } catch (error) {
    throw new ErrorResponse('Export file not found', 404);
  }

  // Increment download count
  await exportRecord.incrementDownload();

  // Set headers for download
  res.setHeader('Content-Disposition', `attachment; filename="${exportRecord.result.fileName}"`);
  res.setHeader('Content-Type', getContentType(exportRecord.format));
  
  // Stream file to response
  const fileStream = require('fs').createReadStream(filePath);
  fileStream.pipe(res);
});

// @desc    Get export status
// @route   GET /api/export/:exportId/status
// @access  Private
exports.getExportStatus = asyncHandler(async (req, res) => {
  const exportRecord = await Export.findById(req.params.exportId)
    .populate('design', 'name thumbnail');

  if (!exportRecord) {
    throw new ErrorResponse('Export not found', 404);
  }

  if (exportRecord.user.toString() !== req.user.id && req.user.role !== 'admin') {
    throw new ErrorResponse('Not authorized to view this export', 403);
  }

  res.status(200).json({
    success: true,
    data: exportRecord
  });
});

// @desc    Get user export history
// @route   GET /api/export/history
// @access  Private
exports.getExportHistory = asyncHandler(async (req, res) => {
  const { format, status, page = 1, limit = 20 } = req.query;

  const exports = await Export.findByUser(req.user.id, {
    format,
    status,
    limit: Math.min(parseInt(limit), 50),
    skip: (parseInt(page) - 1) * parseInt(limit)
  });

  const total = await Export.countDocuments({ user: req.user.id });

  res.status(200).json({
    success: true,
    count: exports.length,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / parseInt(limit)),
    data: exports
  });
});

// @desc    Delete export
// @route   DELETE /api/export/:exportId
// @access  Private
exports.deleteExport = asyncHandler(async (req, res) => {
  const exportRecord = await Export.findById(req.params.exportId);

  if (!exportRecord) {
    throw new ErrorResponse('Export not found', 404);
  }

  if (exportRecord.user.toString() !== req.user.id && req.user.role !== 'admin') {
    throw new ErrorResponse('Not authorized to delete this export', 403);
  }

  // Delete file if exists
  if (exportRecord.result.fileName) {
    const filePath = path.join(process.env.EXPORTS_DIR || './exports', exportRecord.result.fileName);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      logger.warn(`Failed to delete export file: ${filePath}`);
    }
  }

  await exportRecord.deleteOne();

  res.status(200).json({
    success: true,
    message: 'Export deleted successfully'
  });
});

// Helper functions

async function extractAssets(sections) {
  const assets = [];
  
  for (const section of sections) {
    if (section.content) {
      // Extract images from various section types
      extractImagesFromContent(section.content, assets);
    }
  }
  
  return [...new Set(assets)]; // Remove duplicates
}

function extractImagesFromContent(content, assets) {
  for (const [key, value] of Object.entries(content)) {
    if (typeof value === 'string' && isImageUrl(value)) {
      assets.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(item => {
        if (typeof item === 'object') {
          extractImagesFromContent(item, assets);
        }
      });
    } else if (typeof value === 'object' && value !== null) {
      extractImagesFromContent(value, assets);
    }
  }
}

function isImageUrl(url) {
  return typeof url === 'string' && 
         (url.startsWith('http') || url.startsWith('data:image/')) &&
         /\.(jpg|jpeg|png|gif|svg|webp)$/i.test(url);
}

async function generateStaticHTML(design, options) {
  // Implementation similar to frontend/src/utils/pageBuilderUtils.ts
  const cssVariables = generateCSSVariables(design.globalSettings);
  
  const sectionsHTML = design.sections
    .map(section => generateSectionHTML(section))
    .join('\n');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${options.metadata.title}</title>
      <meta name="description" content="${options.metadata.description}">
      <meta name="author" content="${options.metadata.author}">
      <style>
        ${cssVariables}
        
        body {
          margin: 0;
          padding: 0;
          font-family: var(--font-family);
          line-height: var(--line-height);
          color: var(--color-text);
          background-color: var(--color-background);
        }
        
        .section-content {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 1rem;
        }
        
        @media (max-width: 768px) {
          .section-content {
            padding: 0 0.5rem;
          }
        }
        
        ${design.customCSS || ''}
      </style>
    </head>
    <body>
      ${sectionsHTML}
      
      <script>
        // Add basic interactions
        console.log('Generated by Advanced Page Builder');
      </script>
    </body>
    </html>
  `;
}

function generateSectionHTML(section) {
  // Simplified HTML generation for sections
  return `
    <section data-section-type="${section.type}" data-section-id="${section.id}">
      <div class="section-content">
        <h2>${section.content.title || section.name || 'Section'}</h2>
        <!-- Section content would be rendered here based on type -->
      </div>
    </section>
  `;
}

function generateCSSVariables(globalSettings) {
  if (!globalSettings) return '';
  
  let css = ':root {\n';
  
  if (globalSettings.colors) {
    Object.entries(globalSettings.colors).forEach(([key, value]) => {
      css += `  --color-${key}: ${value};\n`;
    });
  }
  
  if (globalSettings.typography) {
    css += `  --font-family: ${globalSettings.typography.fontFamily || 'Arial, sans-serif'};\n`;
    css += `  --line-height: ${globalSettings.typography.lineHeight || 1.6};\n`;
  }
  
  css += '}\n';
  return css;
}

async function copyAssets(sections, assetsDir) {
  const assets = await extractAssets(sections);
  
  for (const assetUrl of assets) {
    if (assetUrl.startsWith('http')) {
      // Download and save external assets
      try {
        const response = await fetch(assetUrl);
        const buffer = await response.arrayBuffer();
        const filename = path.basename(new URL(assetUrl).pathname) || 'asset';
        await fs.writeFile(path.join(assetsDir, filename), Buffer.from(buffer));
      } catch (error) {
        logger.warn(`Failed to download asset: ${assetUrl}`);
      }
    }
  }
}

async function generateCSS(globalSettings, customCSS) {
  return `
    ${generateCSSVariables(globalSettings)}
    
    /* Custom CSS */
    ${customCSS || ''}
    
    /* Responsive utilities */
    @media (max-width: 768px) {
      .hide-mobile { display: none !important; }
    }
    
    @media (min-width: 769px) {
      .hide-desktop { display: none !important; }
    }
  `;
}

async function createZipArchive(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = require('fs').createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', resolve);
    archive.on('error', reject);
    
    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function getContentType(format) {
  const mimeTypes = {
    json: 'application/json',
    html: 'application/zip',
    pdf: 'application/pdf'
  };
  
  return mimeTypes[format] || 'application/octet-stream';
}

module.exports = {
  exportJSON,
  exportHTML,
  exportPDF,
  downloadExport,
  getExportStatus,
  getExportHistory,
  deleteExport
};