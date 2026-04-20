'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '..', '.env')
});

const METABASE_SESSION_CACHE_PATH = path.join(__dirname, '..', 'uploader', 'metabase-session-cache.json');
const METABASE_URL = process.env.METABASE_URL || 'https://analytics.univest.in';
const LOCAL_ENV_PATHS = [
  path.join(__dirname, '..', 'uploader', '.env'),
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '.env.combined'),
];
let metabaseRefreshPromise = null;

function readEnvFileValue(filePath, key) {
  try {
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf8');
    const line = content.split(/\r?\n/).find((entry) => entry.startsWith(`${key}=`));
    if (!line) return '';
    return line.slice(key.length + 1).trim();
  } catch (_) {
    return '';
  }
}

function getInternalBase(port) {
  if (process.env.PORTAL_INTERNAL_BASE_URL) {
    return process.env.PORTAL_INTERNAL_BASE_URL.replace(/\/$/, '');
  }
  return `http://[::1]:${port || process.env.PORT || 3000}`;
}

function getPublicBase() {
  if (process.env.PORTAL_PUBLIC_BASE_URL) {
    return process.env.PORTAL_PUBLIC_BASE_URL.replace(/\/$/, '');
  }
  return `http://[::1]:${process.env.PORT || 3000}`;
}

function getInternalAuthHeader() {
  if (process.env.PORTAL_INTERNAL_AUTH_TOKEN) {
    return { Authorization: `Bearer ${process.env.PORTAL_INTERNAL_AUTH_TOKEN}` };
  }
  if (process.env.PORTAL_USER && process.env.PORTAL_PASS) {
    const encoded = Buffer.from(`${process.env.PORTAL_USER}:${process.env.PORTAL_PASS}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}

function getMetabaseSessionToken() {
  const sessionAlias = String(process.env.METABASE_SESSION || '').trim();
  if (sessionAlias) return sessionAlias;
  const cached = loadMetabaseSessionTokenFromDisk();
  if (cached) return cached;
  const runtime = String(process.env.METABASE_SESSION_TOKEN || '').trim();
  if (runtime) return runtime;
  for (const envPath of LOCAL_ENV_PATHS) {
    const alias = readEnvFileValue(envPath, 'METABASE_SESSION');
    if (alias) return alias;
    const value = readEnvFileValue(envPath, 'METABASE_SESSION_TOKEN');
    if (value) return value;
  }
  return '';
}

function loadMetabaseSessionTokenFromDisk() {
  try {
    if (!fs.existsSync(METABASE_SESSION_CACHE_PATH)) return '';
    const cached = JSON.parse(fs.readFileSync(METABASE_SESSION_CACHE_PATH, 'utf8'));
    if (cached && typeof cached.token === 'string' && cached.token.trim()) {
      return cached.token.trim();
    }
  } catch (_) {}
  return '';
}

function persistMetabaseSessionToken(token) {
  try {
    fs.writeFileSync(METABASE_SESSION_CACHE_PATH, JSON.stringify({ ts: Date.now(), token: token || '' }));
  } catch (_) {}
  if (token) {
    process.env.METABASE_SESSION = token;
    process.env.METABASE_SESSION_TOKEN = token;
  }
}

function resolveMetabaseLoginCredentials() {
  const email = String(process.env.METABASE_LOGIN_EMAIL || process.env.METABASE_USER || '').trim();
  const password = String(process.env.METABASE_LOGIN_PASSWORD || process.env.METABASE_PASSWORD || '').trim();
  return { email, password };
}

async function refreshMetabaseSessionToken(reason) {
  const { email, password } = resolveMetabaseLoginCredentials();
  if (!email || !password) return '';
  if (metabaseRefreshPromise) return metabaseRefreshPromise;
  metabaseRefreshPromise = (async () => {
    const response = await fetch(`${METABASE_URL}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password })
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Metabase login failed (${response.status}): ${text}`);
    }
    const result = await response.json();
    const token = String(result.id || result.token || result.session_id || '').trim();
    if (!token) {
      throw new Error('Metabase login succeeded but no session token was returned');
    }
    persistMetabaseSessionToken(token);
    return token;
  })().finally(() => {
    metabaseRefreshPromise = null;
  });
  return metabaseRefreshPromise;
}

module.exports = {
  getInternalBase,
  getPublicBase,
  getInternalAuthHeader,
  getMetabaseSessionToken,
  refreshMetabaseSessionToken,
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'production',
  PORTAL_USER: process.env.PORTAL_USER,
  PORTAL_PASS: process.env.PORTAL_PASS,
};
