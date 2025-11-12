const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

class ImageOptimizer {
  constructor() {
    this.supportedFormats = ['jpeg', 'jpg', 'png', 'webp', 'gif'];
    this.maxWidth = 2048;
    this.maxHeight = 2048;
    this.quality = 85;
  }

  async optimizeImage(inputBuffer, filename, options = {}) {
    const {
      maxWidth = this.maxWidth,
      maxHeight = this.maxHeight,
      quality = this.quality,
      format = 'webp'
    } = options;

    try {
      const image = sharp(inputBuffer);
      const metadata = await image.metadata();

      // Calculate new dimensions while maintaining aspect ratio
      let { width, height } = metadata;
      if (width > maxWidth || height > maxHeight) {
        const aspectRatio = width / height;
        if (width > height) {
          width = maxWidth;
          height = Math.round(maxWidth / aspectRatio);
        } else {
          height = maxHeight;
          width = Math.round(maxHeight * aspectRatio);
        }
      }

      // Generate optimized versions
      const optimized = await image
        .resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .toFormat(format, { quality })
        .toBuffer();

      // Generate thumbnail (300x300)
      const thumbnail = await image
        .resize(300, 300, {
          fit: 'cover',
          position: 'center'
        })
        .toFormat('webp', { quality: 80 })
        .toBuffer();

      // Generate small version (150x150)
      const small = await image
        .resize(150, 150, {
          fit: 'cover',
          position: 'center'
        })
        .toFormat('webp', { quality: 75 })
        .toBuffer();

      return {
        original: optimized,
        thumbnail,
        small,
        metadata: {
          width,
          height,
          originalWidth: metadata.width,
          originalHeight: metadata.height,
          format: metadata.format,
          size: optimized.length
        }
      };
    } catch (error) {
      throw new Error(`Image optimization failed: ${error.message}`);
    }
  }

  async processMultiple(files) {
    const results = [];
    
    for (const file of files) {
      try {
        const optimized = await this.optimizeImage(file.buffer, file.originalname);
        results.push({
          success: true,
          file: file.originalname,
          optimized
        });
      } catch (error) {
        results.push({
          success: false,
          file: file.originalname,
          error: error.message
        });
      }
    }

    return results;
  }

  isImageFile(filename) {
    const ext = path.extname(filename).toLowerCase().slice(1);
    return this.supportedFormats.includes(ext);
  }
}

module.exports = new ImageOptimizer();