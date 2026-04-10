#!/usr/bin/env node
/**
 * Google Ads OAuth2 Helper
 * Generates a refresh token for Google Ads API access.
 *
 * Usage:  node google-creative/auth/google-auth-helper.js
 */

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');

// --------------- Load environment variables ---------------

const ENV_CANDIDATES = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', '..', '.env'),
    path.join(__dirname, '..', '..', 'uploader', '.env'),
];

for (const envPath of ENV_CANDIDATES) {
    if (fs.existsSync(envPath)) {
        try {
            require('dotenv').config({ path: envPath });
            console.log(`[env] Loaded ${envPath}`);
        } catch (e) {
            const lines = fs.readFileSync(envPath, 'utf8').split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx === -1) continue;
                const key = trimmed.slice(0, eqIdx).trim();
                const val = trimmed.slice(eqIdx + 1).trim();
                if (!process.env[key]) process.env[key] = val;
            }
            console.log(`[env] Manually parsed ${envPath}`);
        }
    }
}

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('\nERROR: GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET must be set.');
    process.exit(1);
}

const SCOPES = ['https://www.googleapis.com/auth/adwords'];
const REDIRECT_PORT = 8089;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;

async function run() {
    let OAuth2Client;
    try {
        const { OAuth2Client: OAC } = require('google-auth-library');
        OAuth2Client = OAC;
    } catch (_) {
        try {
            const { google } = require('googleapis');
            OAuth2Client = google.auth.OAuth2;
        } catch (__) {
            console.error('\nERROR: Neither "google-auth-library" nor "googleapis" is installed.');
            console.error('Run:  cd google-creative && npm install');
            process.exit(1);
        }
    }

    const oauth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
    });

    console.log('\n=== Google Ads OAuth2 Setup ===\n');
    console.log('1. A browser window will open (or copy this URL):\n');
    console.log(`   ${authUrl}\n`);
    console.log('2. Sign in and authorize access.\n');
    console.log('3. You will be redirected back automatically.\n');

    // Open browser
    try {
        const { exec } = require('child_process');
        if (process.platform === 'win32') exec(`start chrome "${authUrl}"`);
        else if (process.platform === 'darwin') exec(`open "${authUrl}"`);
        else exec(`xdg-open "${authUrl}"`);
    } catch (_) {}

    // Start local server to catch the redirect
    const code = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const parsed = url.parse(req.url, true);
            const authCode = parsed.query.code;
            if (authCode) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end('<html><body style="font-family:Inter,sans-serif;background:#08080d;color:#e2e2e2;display:flex;align-items:center;justify-content:center;height:100vh;"><div style="text-align:center;"><h1 style="color:#00d4aa;">Authorization Successful!</h1><p>You can close this tab and return to the terminal.</p></div></body></html>');
                server.close();
                resolve(authCode);
            } else {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('No authorization code received. Try again.');
            }
        });

        server.listen(REDIRECT_PORT, () => {
            console.log(`   Waiting for authorization on http://localhost:${REDIRECT_PORT}...\n`);
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`\nERROR: Port ${REDIRECT_PORT} is in use. Close the app using it and try again.`);
            }
            reject(err);
        });

        // Timeout after 5 minutes
        setTimeout(() => {
            server.close();
            reject(new Error('Timed out waiting for authorization (5 minutes)'));
        }, 5 * 60 * 1000);
    });

    try {
        const { tokens } = await oauth2Client.getToken(code);

        console.log('\n=== SUCCESS ===\n');
        console.log('Refresh Token:');
        console.log(`   ${tokens.refresh_token}\n`);
        console.log('Add this to your uploader/.env file:\n');
        console.log(`   GOOGLE_ADS_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    } catch (err) {
        console.error('\nERROR exchanging code for tokens:', err.message || err);
        process.exit(1);
    }
}

run();
