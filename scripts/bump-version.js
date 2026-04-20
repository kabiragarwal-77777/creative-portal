'use strict';

const fs = require('fs');
const path = require('path');

const version = Date.now();
const htmlFiles = [
  path.join(__dirname, '..', 'index.html'),
  path.join(__dirname, '..', 'creative.html'),
  path.join(__dirname, '..', 'google-creative.html'),
  path.join(__dirname, '..', 'trend-scanner.html'),
  path.join(__dirname, '..', 'inventory-scanner', 'public', 'index.html'),
  path.join(__dirname, '..', 'uploader', 'upload.html')
];

const versionPattern = /\?v=\d+/g;
let updatedCount = 0;

for (const filePath of htmlFiles) {
  if (!fs.existsSync(filePath)) continue;
  const content = fs.readFileSync(filePath, 'utf8');
  const updated = content.replace(versionPattern, `?v=${version}`);
  if (updated !== content) {
    fs.writeFileSync(filePath, updated, 'utf8');
    console.log(`Updated: ${path.relative(process.cwd(), filePath)}`);
    updatedCount += 1;
  }
}

console.log(`Cache-busted ${updatedCount} files with version: ${version}`);
