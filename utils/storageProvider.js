const AWS = require('aws-sdk');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

class StorageProvider {
  constructor() {
    this.provider = process.env.STORAGE_PROVIDER || 'local';
    this.initializeProvider();
  }

  initializeProvider() {
    if (this.provider === 's3') {
      this.s3 = new AWS.S3({
        accessKeyId: process.env.S3_KEY,
        secretAccessKey: process.env.S3_SECRET,
        region: process.env.S3_REGION || 'us-east-1'
      });
      this.bucket = process.env.S3_BUCKET;
    } else {
      this.uploadDir = path.join(process.cwd(), 'uploads');
      this.ensureUploadDir();
    }
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
    if (this.provider === 's3') {
      return this.uploadToS3(buffer, filename, contentType);
    } else {
      return this.uploadToLocal(buffer, filename);
    }
  }

  async uploadToS3(buffer, filename, contentType) {
    try {
      const params = {
        Bucket: this.bucket,
        Key: filename,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'max-age=31536000', // 1 year
        ACL: 'public-read'
      };

      const result = await this.s3.upload(params).promise();
      
      return {
        url: result.Location,
        key: filename,
        provider: 's3'
      };
    } catch (error) {
      throw new Error(`S3 upload failed: ${error.message}`);
    }
  }

  async uploadToLocal(buffer, filename) {
    try {
      const filePath = path.join(this.uploadDir, filename);
      const dir = path.dirname(filePath);
      
      // Ensure directory exists
      await fs.mkdir(dir, { recursive: true });
      
      // Write file
      await fs.writeFile(filePath, buffer);
      
      const baseUrl = process.env.MEDIA_BASE_URL || process.env.BASE_URL || 'http://localhost:5000';
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
    if (this.provider === 's3' && fileInfo.key) {
      return this.deleteFromS3(fileInfo.key);
    } else if (fileInfo.path) {
      return this.deleteFromLocal(fileInfo.path);
    }
  }

  async deleteFromS3(key) {
    try {
      await this.s3.deleteObject({
        Bucket: this.bucket,
        Key: key
      }).promise();
    } catch (error) {
      console.error('S3 delete failed:', error);
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

module.exports = new StorageProvider();