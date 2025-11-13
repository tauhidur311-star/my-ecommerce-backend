#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * Script to automatically remove console.log statements from production code
 * and replace them with appropriate logger calls where needed
 */

const logger = require('../utils/structuredLogger');

// Directories to process
const DIRECTORIES_TO_CLEAN = [
  'controllers',
  'middleware', 
  'routes',
  'utils',
  'models',
  'config'
];

// Files to exclude from cleaning
const EXCLUDE_FILES = [
  'logger.js',
  'structuredLogger.js',
  'removeConsoleLog.js'
];

// Console methods to replace
const CONSOLE_METHODS = [
  'console.log',
  'console.info', 
  'console.warn',
  'console.error',
  'console.debug'
];

let totalFiles = 0;
let totalReplacements = 0;
const processedFiles = [];

function shouldProcessFile(filePath) {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath);
  
  // Only process JavaScript files
  if (ext !== '.js') return false;
  
  // Skip excluded files
  if (EXCLUDE_FILES.some(excluded => fileName.includes(excluded))) {
    return false;
  }
  
  return true;
}

function replaceConsoleStatements(content, filePath) {
  let replacements = 0;
  let newContent = content;
  
  // Pattern to match console statements
  const consoleRegex = /console\.(log|info|warn|error|debug)\s*\([^)]*\);?/g;
  
  const matches = content.match(consoleRegex) || [];
  
  for (const match of matches) {
    // Extract the console method and arguments
    const methodMatch = match.match(/console\.(log|info|warn|error|debug)\s*\(([^)]*)\)/);
    
    if (methodMatch) {
      const [fullMatch, method, args] = methodMatch;
      
      // Determine appropriate logger method
      let loggerMethod = 'info';
      switch (method) {
        case 'error':
          loggerMethod = 'error';
          break;
        case 'warn':
          loggerMethod = 'warn';
          break;
        case 'debug':
          loggerMethod = 'debug';
          break;
        case 'info':
        case 'log':
        default:
          loggerMethod = 'info';
          break;
      }
      
      // Replace with logger call
      const replacement = `logger.${loggerMethod}(${args})`;
      newContent = newContent.replace(fullMatch, replacement);
      replacements++;
    }
  }
  
  // Add logger import at the top if replacements were made
  if (replacements > 0 && !content.includes('require(\'../utils/structuredLogger\')')) {
    // Find the right place to add the import
    const lines = newContent.split('\n');
    let insertIndex = 0;
    
    // Find the last require statement or the first non-comment line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('require(') || line.startsWith('const ') && line.includes('require(')) {
        insertIndex = i + 1;
      } else if (line && !line.startsWith('//') && !line.startsWith('/*')) {
        break;
      }
    }
    
    // Add logger import
    lines.splice(insertIndex, 0, "const logger = require('../utils/structuredLogger');");
    newContent = lines.join('\n');
  }
  
  return { content: newContent, replacements };
}

function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const { content: newContent, replacements } = replaceConsoleStatements(content, filePath);
    
    if (replacements > 0) {
      fs.writeFileSync(filePath, newContent, 'utf8');
      totalReplacements += replacements;
      processedFiles.push({
        file: filePath,
        replacements
      });
      
      logger.info(`Processed ${filePath}: ${replacements} console statements replaced`);
    }
    
    totalFiles++;
  } catch (error) {
    logger.error(`Error processing file ${filePath}:`, { error: error.message });
  }
}

function processDirectory(dirPath) {
  try {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        // Recursively process subdirectories
        processDirectory(fullPath);
      } else if (shouldProcessFile(fullPath)) {
        processFile(fullPath);
      }
    }
  } catch (error) {
    logger.error(`Error processing directory ${dirPath}:`, { error: error.message });
  }
}

function main() {
  logger.info('🧹 Starting console.log cleanup process...');
  
  const startTime = Date.now();
  
  // Process each target directory
  for (const dir of DIRECTORIES_TO_CLEAN) {
    const dirPath = path.join(__dirname, '..', dir);
    
    if (fs.existsSync(dirPath)) {
      logger.info(`Processing directory: ${dir}`);
      processDirectory(dirPath);
    } else {
      logger.warn(`Directory not found: ${dir}`);
    }
  }
  
  const duration = Date.now() - startTime;
  
  // Generate summary
  logger.info('🎉 Console.log cleanup completed!', {
    duration: `${duration}ms`,
    totalFiles,
    totalReplacements,
    processedFiles: processedFiles.length
  });
  
  if (processedFiles.length > 0) {
    logger.info('📋 Files modified:', processedFiles);
  }
  
  // Generate backup recommendation
  if (totalReplacements > 0) {
    logger.warn('⚠️  IMPORTANT: Review the changes and test your application');
    logger.info('💡 Recommendation: Commit these changes after testing');
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { replaceConsoleStatements, processFile, processDirectory };