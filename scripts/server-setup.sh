#!/bin/bash
# ============================================================
# CREATIVE PORTAL — SERVER SETUP SCRIPT
# Run this ONCE on the internal server after first deployment
# Run again after any Node.js version change
# ============================================================

set -e

echo "=== Creative Portal Server Setup ==="
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "OS: $(uname -a)"

echo ""
echo "--- Installing root dependencies ---"
npm install

echo ""
echo "--- Installing sub-service dependencies ---"
npm --prefix uploader install
npm --prefix intelligence install
npm --prefix inventory-scanner install
npm --prefix google-creative install
npm --prefix audience-testing install
npm --prefix feedback-engine install
npm --prefix creative-intelligence install

echo ""
echo "--- Rebuilding native modules ---"
npm rebuild better-sqlite3 --build-from-source
cd uploader && npm rebuild better-sqlite3 --build-from-source 2>/dev/null || true; cd ..
cd intelligence && npm rebuild better-sqlite3 --build-from-source 2>/dev/null || true; cd ..
cd inventory-scanner && npm rebuild better-sqlite3 --build-from-source 2>/dev/null || true; cd ..
cd audience-testing && npm rebuild better-sqlite3 --build-from-source 2>/dev/null || true; cd ..
cd feedback-engine && npm rebuild better-sqlite3 --build-from-source 2>/dev/null || true; cd ..
cd creative-intelligence && npm rebuild better-sqlite3 --build-from-source 2>/dev/null || true; cd ..
cd google-creative && npm rebuild better-sqlite3 --build-from-source 2>/dev/null || true; cd ..
cd uploader && npm rebuild sharp --build-from-source 2>/dev/null || true; cd ..

echo ""
echo "--- Verifying better-sqlite3 ---"
node -e "
try {
  require('better-sqlite3');
  console.log('better-sqlite3: OK');
} catch(e) {
  console.error('better-sqlite3: FAILED -', e.message);
  process.exit(1);
}
"

echo ""
echo "--- Creating required directories ---"
mkdir -p logs
mkdir -p tmp
mkdir -p intelligence/database
mkdir -p audience-testing/db
mkdir -p feedback-engine/db
mkdir -p google-creative/db
mkdir -p inventory-scanner/database
mkdir -p creative-intelligence

echo ""
echo "--- Setting directory permissions ---"
chmod 755 logs tmp
chmod 755 intelligence/database audience-testing/db
chmod 755 feedback-engine/db google-creative/db
chmod 755 inventory-scanner/database creative-intelligence

echo ""
echo "--- Cache-busting static files ---"
node scripts/bump-version.js

echo ""
echo "--- Checking PM2 ---"
if ! command -v pm2 &> /dev/null; then
  echo "Installing PM2..."
  npm install -g pm2
else
  echo "PM2 already installed: $(pm2 --version)"
fi

echo ""
echo "=== Setup complete ==="
echo "To start all services: npm run pm2:start"
echo "To view logs: npm run pm2:logs"
echo "To check status: pm2 list"
