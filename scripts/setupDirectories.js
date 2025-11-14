/**
 * Setup Required Directories
 * Creates necessary directories for the application
 */

const fs = require('fs');
const path = require('path');

const requiredDirectories = [
  './exports',
  './uploads',
  './temp',
  './logs'
];

// Create directories if they don't exist
requiredDirectories.forEach(dir => {
  const fullPath = path.resolve(dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`✅ Created directory: ${dir}`);
  } else {
    console.log(`✅ Directory exists: ${dir}`);
  }
});

// Create .gitkeep files to ensure directories are tracked
requiredDirectories.forEach(dir => {
  const gitkeepPath = path.join(dir, '.gitkeep');
  if (!fs.existsSync(gitkeepPath)) {
    fs.writeFileSync(gitkeepPath, '');
    console.log(`✅ Added .gitkeep to: ${dir}`);
  }
});

console.log('🎉 Directory setup complete!');

module.exports = { requiredDirectories };