const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

// Fallback storage provider that works without AWS SDK for initial deployment
class StorageProviderFallback {
  constructor() {
    this.provider = 'local'; // Force local for now
    this.initializeProvider();
  }

  initializeProvider() {
    this.uploadDir = path.join(process.cwd(), 'uploads');
    this.ensureUploadDir();
  }

  async ensureUploadDir() {
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create upload directory:', error);
    }
  }

  generateFilename(originalName, folder = 'general') {
    const ext = path.extname(originalName);
    const name = path.basename(originalName, ext);
    const hash = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    return `${folder}/${name}-${timestamp}-${hash}${ext}`;
  }

  async uploadFile(buffer, filename, contentType) {
    return this.uploadToLocal(buffer, filename);
  }

  async uploadToLocal(buffer, filename) {
    try {
      const filePath = path.join(this.uploadDir, filename);
      const dir = path.dirname(filePath);
      
      // Ensure directory exists
      await fs.mkdir(dir, { recursive: true });
      
      // Write file
      await fs.writeFile(filePath, buffer);
      
      const baseUrl = process.env.BASE_URL || 'http://localhost:5000';
      const url = `${baseUrl}/uploads/${filename}`;
      
      return {
        url,
        path: filePath,
        provider: 'local'
      };
    } catch (error) {
      throw new Error(`Local upload failed: ${error.message}`);
    }
  }

  async deleteFile(fileInfo) {
    if (fileInfo.path) {
      return this.deleteFromLocal(fileInfo.path);
    }
  }

  async deleteFromLocal(filePath) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      console.error('Local delete failed:', error);
    }
  }

  async uploadMultipleVersions(versions, baseFilename, folder, contentType) {
    const results = {};
    
    for (const [version, buffer] of Object.entries(versions)) {
      const filename = this.generateVersionFilename(baseFilename, version, folder);
      const result = await this.uploadFile(buffer, filename, contentType);
      results[version] = result;
    }
    
    return results;
  }

  generateVersionFilename(baseFilename, version, folder) {
    const ext = path.extname(baseFilename);
    const name = path.basename(baseFilename, ext);
    return `${folder}/${name}-${version}${ext}`;
  }
}

module.exports = new StorageProviderFallback();