// =============================================================================
// Meta Ad Upload Server
// Node.js Express server for automating Meta (Facebook) ad uploads
// =============================================================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');

// Load .env for local development
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch(e) { /* dotenv not installed, use env vars directly */ }

// =============================================================================
// CONFIGURATION
// =============================================================================

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
const META_APP_SECRET_PROOF = process.env.META_APP_SECRET_PROOF || '';
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || 'act_725019929189148';
const META_API_VERSION = 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
let OpenAI;
try { OpenAI = require('openai'); } catch(e) { console.warn('OpenAI SDK not installed — analyser will not work. Run: npm install openai'); }

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '';
const GOOGLE_SHEET_TAB = process.env.GOOGLE_SHEET_TAB || '';
const GOOGLE_APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbyKYm0aNJHvjAuc6KxrcZAzuIpc2qs_RT8sbngiwC5-m-6-2gPVY7uV2z4gSFLtVHTysw/exec';

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
const ANALYTICS_SHEET_ID = '1S_NYpXFsBgKe3N4nrL4BSvtzwydpfoqx4eMSWFYPVFY';
const ANALYTICS_SHEET_GID = '1655578542';

const METABASE_SESSION_TOKEN = process.env.METABASE_SESSION_TOKEN || '';
const METABASE_URL = 'https://analytics.univest.in';

function parseGvizResponse(text) {
    const start = text.indexOf('setResponse(');
    if (start === -1) throw new Error('Invalid GViz payload');
    const jsonText = text.slice(start + 'setResponse('.length, text.lastIndexOf(');'));
    return JSON.parse(jsonText);
}

function stripJsonFences(text) {
    return String(text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
}

function safeJsonParse(text, fallback = null) {
    try { return JSON.parse(stripJsonFences(text)); } catch (e) { return fallback; }
}

function topItems(list, sortKey, limit) {
    return (Array.isArray(list) ? list.slice() : [])
        .sort((a, b) => (Number(b && b[sortKey]) || 0) - (Number(a && a[sortKey]) || 0))
        .slice(0, limit);
}

function summarizeByPredicate(list, predicate, labelKey, valueKey, limit) {
    return (Array.isArray(list) ? list.filter(predicate) : [])
        .sort((a, b) => (Number(b && b[valueKey]) || 0) - (Number(a && a[valueKey]) || 0))
        .slice(0, limit)
        .map(item => ({
            label: item && item[labelKey] || '',
            value: item && item[valueKey] != null ? item[valueKey] : null
        }));
}

function inferOptimizerUseCaseFallback(userRequest, runtimeContext) {
    const q = String(userRequest || '').toLowerCase();
    const target = runtimeContext && runtimeContext.request_scope ? runtimeContext.request_scope : {};
    let useCase = 'account_revamp';
    if (q.includes('overview') || q.includes('deep dive') || q.includes('make it better')) useCase = 'campaign_overview';
    if (q.includes('underperform') || q.includes('why') || q.includes('diagnos')) useCase = 'root_cause';
    if (q.includes('scale')) useCase = 'scale_decision';
    if (q.includes('creative')) useCase = 'creative_actionables';
    if (target.target_type && target.target_type !== 'account') useCase = 'campaign_overview';
    return {
        use_case: useCase,
        entity_focus: target.target_type || 'account',
        needs_clarification: false,
        clarification_question: ''
    };
}

function buildOptimizerBrainEvidence(runtimeContext) {
    const campaigns = Array.isArray(runtimeContext && runtimeContext.campaigns) ? runtimeContext.campaigns : [];
    const adSets = Array.isArray(runtimeContext && runtimeContext.ad_sets) ? runtimeContext.ad_sets : [];
    const ads = Array.isArray(runtimeContext && runtimeContext.ads) ? runtimeContext.ads : [];
    const requestScope = runtimeContext && runtimeContext.request_scope ? runtimeContext.request_scope : {};
    const targetQuery = String(requestScope.target_query || '').toLowerCase();
    const targetType = requestScope.target_type || 'account';

    const scopedCampaigns = campaigns.filter(c => !targetQuery || String(c.name || '').toLowerCase().includes(targetQuery));
    const scopedAdSets = adSets.filter(a => {
        if (!targetQuery) return true;
        return String(a.name || '').toLowerCase().includes(targetQuery) || String(a.campaign_name || '').toLowerCase().includes(targetQuery);
    });
    const scopedAds = ads.filter(a => {
        if (!targetQuery) return true;
        return String(a.name || '').toLowerCase().includes(targetQuery) ||
            String(a.adset_name || '').toLowerCase().includes(targetQuery) ||
            String(a.campaign_name || '').toLowerCase().includes(targetQuery);
    });

    const targetSlice = {
        target_type: targetType,
        target_query: requestScope.target_query || '',
        campaign_count: scopedCampaigns.length,
        adset_count: scopedAdSets.length,
        ad_count: scopedAds.length,
        campaigns: scopedCampaigns.slice(0, 8),
        ad_sets: scopedAdSets.slice(0, 16),
        ads: scopedAds.slice(0, 24)
    };

    const breakdowns = runtimeContext && runtimeContext.breakdowns ? runtimeContext.breakdowns : ((runtimeContext && runtimeContext.breakdown_context && runtimeContext.breakdown_context.breakdowns) || {});
    const ageGender = Array.isArray(breakdowns.age_gender) ? breakdowns.age_gender : [];
    const placement = Array.isArray(breakdowns.placement) ? breakdowns.placement : [];
    const geography = Array.isArray(breakdowns.geography) ? breakdowns.geography : [];
    const device = Array.isArray(breakdowns.device) ? breakdowns.device : [];
    const hourly = Array.isArray(breakdowns.hourly) ? breakdowns.hourly : [];

    const historicalWinners = {
        campaigns: topItems(campaigns, 'd6_roas_window', 5).map(c => ({ name: c.name, d6_roas_window: c.d6_roas_window, spend_window: c.spend_window })),
        ad_sets: topItems(adSets, 'd6_roas_window', 8).map(a => ({ campaign_name: a.campaign_name, name: a.name, d6_roas_window: a.d6_roas_window, spend_window: a.spend_window })),
        ads: topItems(ads.filter(a => a && a.is_account_winner), 'd6_roas_window', 10).map(a => ({ campaign_name: a.campaign_name, adset_name: a.adset_name, name: a.name, d6_roas_window: a.d6_roas_window, spend_window: a.spend_window }))
    };

    const weakPoints = {
        campaigns: topItems(campaigns.filter(c => Number(c.d6_roas_window) > 0), 'spend_window', 8)
            .filter(c => Number(c.d6_roas_window) < 20)
            .map(c => ({ name: c.name, d6_roas_window: c.d6_roas_window, spend_window: c.spend_window })),
        ad_sets: topItems(adSets.filter(a => Number(a.d6_roas_window) > 0), 'spend_window', 12)
            .filter(a => Number(a.d6_roas_window) < 20)
            .map(a => ({ campaign_name: a.campaign_name, name: a.name, d6_roas_window: a.d6_roas_window, spend_window: a.spend_window }))
    };

    const dimensionalHighlights = {
        best_age_gender: summarizeByPredicate(ageGender, row => row && row.cpa_7d != null, 'age_band', 'roas_7d', 5),
        best_placements: summarizeByPredicate(placement, row => row && row.roas_7d != null, 'placement', 'roas_7d', 5),
        weak_placements: summarizeByPredicate(placement, row => row && row.cpa_7d != null, 'placement', 'cpa_7d', 5),
        best_geos: summarizeByPredicate(geography, row => row && row.roas_7d != null, 'location', 'roas_7d', 5),
        weak_geos: summarizeByPredicate(geography, row => row && row.cpa_7d != null, 'location', 'cpa_7d', 5),
        device_summary: topItems(device, 'roas_7d', 5),
        best_hours: topItems(hourly.filter(h => Number(h && h.conversions) > 0), 'conversions', 8)
    };

    const metaOperatorAudit = runtimeContext && runtimeContext.meta_operator_audit ? runtimeContext.meta_operator_audit : null;
    const dataIntegrity = runtimeContext && runtimeContext.data_integrity_gate ? runtimeContext.data_integrity_gate : ((runtimeContext && runtimeContext.performance_summary && runtimeContext.performance_summary.data_integrity_gate) || null);

    return {
        user_request: runtimeContext && runtimeContext.user_request || '',
        request_scope: requestScope,
        target_slice: targetSlice,
        historical_winners: historicalWinners,
        weak_points: weakPoints,
        dimensional_highlights: dimensionalHighlights,
        meta_operator_audit: metaOperatorAudit,
        data_integrity_gate: dataIntegrity,
        external_context: runtimeContext && runtimeContext.external_context ? runtimeContext.external_context : null,
        playbook_rules: Array.isArray(runtimeContext && runtimeContext.playbook_rules) ? runtimeContext.playbook_rules.slice(0, 20) : [],
        account_metrics: runtimeContext && runtimeContext.performance_summary ? runtimeContext.performance_summary : {}
    };
}

function countPattern(text, regex) {
    const matches = String(text || '').match(regex);
    return matches ? matches.length : 0;
}

function analyzeOptimizerDraftQuality(draft) {
    const plan = draft && draft.optimizer_plan ? draft.optimizer_plan : (draft || {});
    const actions = Array.isArray(plan.actions) ? plan.actions : [];
    const operatorAnswer = String(plan.operator_answer || '');
    const morningBrief = plan.morning_brief || {};
    const doNow = Array.isArray(morningBrief.what_to_do_right_now) ? morningBrief.what_to_do_right_now : [];
    const campaignInsights = Array.isArray(morningBrief.campaign_insights) ? morningBrief.campaign_insights : [];

    const vagueVerbCount = countPattern(operatorAnswer, /\b(check|review|look at|investigate|monitor closely|assess)\b/gi);
    const concreteVerbCount = countPattern(operatorAnswer, /\b(pause|scale|increase|decrease|cut|refresh|replace|duplicate|exclude|shift|hold|reactivate|fix|launch|switch)\b/gi);
    const repetitiveActionMap = actions.reduce((acc, item) => {
        const key = String(item && (item.action_detail || item.action_type || '')).toLowerCase().trim();
        if (!key) return acc;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
    const maxRepeated = Object.values(repetitiveActionMap).reduce((m, v) => Math.max(m, v), 0);
    const weakActions = actions.filter(item => {
        const detail = String(item && item.action_detail || '');
        return !detail || /\b(check|review|investigate|look at)\b/i.test(detail);
    });

    const errors = [];
    if (!actions.length && !doNow.length) errors.push('No actionable recommendations were produced.');
    if (vagueVerbCount >= 3 && concreteVerbCount < Math.max(2, Math.floor(vagueVerbCount / 2))) errors.push('Operator answer is too vague and relies on check/review language instead of actions.');
    if (actions.length >= 4 && maxRepeated >= Math.ceil(actions.length * 0.7)) errors.push('Too many recommendations repeat the same action pattern across different entities.');
    if (weakActions.length >= Math.max(2, Math.floor(actions.length * 0.5))) errors.push('Many actions lack a concrete do-line and still read like diagnostics.');
    if (campaignInsights.length && !campaignInsights.some(item => String(item && (item.adset_insights || item.creative_insights || '')).trim())) errors.push('Campaign insights are present but do not go deep enough into adset or creative specifics.');
    if (operatorAnswer && !/\b(pause|scale|increase|decrease|refresh|replace|exclude|shift|hold|reactivate|fix|launch|switch)\b/i.test(operatorAnswer)) errors.push('Operator answer does not contain enough explicit performance-marketer action verbs.');

    return {
        passed: errors.length === 0,
        errors,
        stats: {
            action_count: actions.length,
            do_now_count: doNow.length,
            vague_verb_count: vagueVerbCount,
            concrete_verb_count: concreteVerbCount,
            max_repeated_action_pattern: maxRepeated,
            weak_action_count: weakActions.length
        }
    };
}

// Helper: write results back to Google Sheet via Apps Script
async function writeResultToSheet(rowIndex, data, tabName) {
    try {
        const payload = {
            row: rowIndex,
            tab: tabName || 'Sheet1',
            campaign_id: data.campaign_id || '',
            adset_id: data.adset_id || '',
            ad_id: data.ad_id || '',
            upload_status: data.upload_status || '',
            error_message: data.error_message || '',
        };
        await fetch(GOOGLE_APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (err) {
        console.error('Failed to write result to sheet:', err.message);
    }
}

const PORT = process.env.PORT || 3000;

// =============================================================================
// EXPRESS SETUP
// =============================================================================

const app = express();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// =============================================================================
// AUTHENTICATION — Simple username/password gate
// =============================================================================
const PORTAL_USER = process.env.PORTAL_USER || 'univest';
const PORTAL_PASS = process.env.PORTAL_PASS || 'univest2026';

// Sessions stored in memory (resets on restart)
const authSessions = new Map();

function generateSessionId() {
    return require('crypto').randomBytes(32).toString('hex');
}

function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(c => {
        const [key, ...rest] = c.trim().split('=');
        if (key) cookies[key.trim()] = rest.join('=').trim();
    });
    return cookies;
}

// Login page HTML
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Login — Univest Portal</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',-apple-system,sans-serif;background:#08080d;color:#e2e2e2;height:100vh;display:flex;align-items:center;justify-content:center}
.login-box{background:#0f0f18;border:1px solid #2a2a3e;border-radius:12px;padding:40px;width:360px;text-align:center}
.login-box h1{font-size:18px;font-weight:700;margin-bottom:6px}
.login-box .sub{font-size:12px;color:#888;margin-bottom:28px}
.brand-icon{width:48px;height:48px;background:linear-gradient(135deg,#6c5ce7,#00d4aa);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff;margin:0 auto 20px}
input{width:100%;padding:12px 14px;background:#13131f;border:1px solid #2a2a3e;border-radius:8px;color:#e2e2e2;font-size:14px;font-family:inherit;margin-bottom:12px;outline:none;transition:border 0.2s}
input:focus{border-color:#6c5ce7}
input::placeholder{color:#555}
button{width:100%;padding:12px;background:#6c5ce7;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;transition:background 0.2s}
button:hover{background:#7c6ef0}
.error{color:#ef4444;font-size:12px;margin-bottom:12px;display:none}
</style>
</head>
<body>
<div class="login-box">
<div class="brand-icon">PM</div>
<h1>Performance Marketing Auto</h1>
<div class="sub">Sign in to access the portal</div>
<form method="POST" action="/auth/login">
<div class="error" id="err"></div>
<input type="text" name="username" placeholder="Username" required autocomplete="username">
<input type="password" name="password" placeholder="Password" required autocomplete="current-password">
<button type="submit">Sign In</button>
</form>
</div>
<script>
if(location.search.includes('error=1'))document.getElementById('err').style.display='block',document.getElementById('err').textContent='Invalid username or password';
</script>
</body></html>`;

// Auth middleware — checks session cookie, skips login/auth routes and internal requests
app.use((req, res, next) => {
    // Skip auth for login routes
    if (req.path === '/auth/login' || req.path === '/auth/logout') return next();

    // Skip auth for all API routes — they're called internally by server, schedulers, and iframes
    // The login page blocks access to HTML pages; API data alone is not useful without the UI
    if (req.path.startsWith('/api/')) return next();

    // Skip auth for google-creative assets and shared static files (loaded inside authenticated iframe)
    if (req.path.startsWith('/google-creative') || req.path === '/google-creative.html') return next();
    if (/\.(css|js|ico|png|jpg|svg|woff2?)(\?.*)?$/.test(req.path)) return next();

    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies['portal_session'];

    if (sessionId && authSessions.has(sessionId)) {
        // Valid session — refresh expiry
        const session = authSessions.get(sessionId);
        session.lastAccess = Date.now();
        return next();
    }

    // Not authenticated
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ success: false, error: 'Not authenticated', timestamp: new Date().toISOString() });
    }

    // Serve login page for all other requests
    res.setHeader('Content-Type', 'text/html');
    return res.send(LOGIN_HTML);
});

// Login endpoint
app.post('/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    if (username === PORTAL_USER && password === PORTAL_PASS) {
        const sessionId = generateSessionId();
        authSessions.set(sessionId, { user: username, createdAt: Date.now(), lastAccess: Date.now() });
        res.setHeader('Set-Cookie', `portal_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
        return res.redirect('/');
    }
    return res.redirect('/auth/login?error=1');
});

// Login page (GET)
app.get('/auth/login', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(LOGIN_HTML);
});

// Logout endpoint
app.get('/auth/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const sessionId = cookies['portal_session'];
    if (sessionId) authSessions.delete(sessionId);
    res.setHeader('Set-Cookie', 'portal_session=; Path=/; HttpOnly; Max-Age=0');
    res.redirect('/auth/login');
});

// Clean up expired sessions every hour (24h max age)
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of authSessions) {
        if (now - session.lastAccess > 24 * 60 * 60 * 1000) authSessions.delete(id);
    }
}, 60 * 60 * 1000);

// Static files — serve both uploader and parent creative-portal directory
const parentDir = path.join(__dirname, '..');
app.use((req, res, next) => {
    if (req.path === '/upload.html' || req.path === '/uploader/upload.html') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
    }
    next();
});
app.use('/uploader', express.static(__dirname));
app.use('/analyser', express.static(path.join(parentDir, 'analyser')));
app.use(express.static(parentDir));
app.use('/google-creative/public', express.static(path.join(__dirname, '..', 'google-creative', 'public')));

// =============================================================================
// META API HELPERS
// =============================================================================

function metaParams(extra = {}) {
    return {
        access_token: META_ACCESS_TOKEN,
        appsecret_proof: META_APP_SECRET_PROOF,
        ...extra,
    };
}

async function metaGet(endpoint, params = {}) {
    const url = new URL(`${META_API_BASE}${endpoint}`);
    const allParams = metaParams(params);
    for (const [k, v] of Object.entries(allParams)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const resp = await fetch(url.toString());
    const data = await resp.json();
    if (data.error) {
        const err = new Error(data.error.message || 'Meta API error');
        err.metaError = data.error;
        throw err;
    }
    return data;
}

async function metaPost(endpoint, params = {}) {
    const allParams = metaParams(params);
    const url = `${META_API_BASE}${endpoint}`;
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(allParams)) {
        if (v != null) body.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    console.log(`[META POST] ${url}`);
    console.log(`[META POST] params:`, JSON.stringify(Object.fromEntries(body.entries()), null, 2));
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });
    const data = await resp.json();
    console.log(`[META POST] response:`, JSON.stringify(data));
    if (data.error) {
        const err = new Error(data.error.message || 'Meta API error');
        err.metaError = data.error;
        throw err;
    }
    return data;
}

async function metaPostForm(endpoint, filePath, filename, contentType, extraFields = {}) {
    const url = `${META_API_BASE}${endpoint}`;
    console.log(`[META POST FORM] ${url} file=${filename}`);
    const fileBuffer = fs.readFileSync(filePath);
    const formData = new FormData(); // native FormData
    const fileFieldName = endpoint.includes('/adimages') ? 'filename' : 'source';
    formData.append(fileFieldName, new Blob([fileBuffer], { type: contentType }), filename);
    formData.append('access_token', META_ACCESS_TOKEN);
    formData.append('appsecret_proof', META_APP_SECRET_PROOF);
    for (const [k, v] of Object.entries(extraFields)) {
        formData.append(k, v);
    }
    const resp = await fetch(url, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(600000), // 10 min timeout for large videos
    });
    const text = await resp.text();
    console.log(`[META POST FORM] response status=${resp.status} body=${text.substring(0, 500)}`);
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error(`Meta API returned non-JSON (status ${resp.status}): ${text.substring(0, 200)}`);
    }
    if (data.error) {
        const err = new Error(data.error.message || 'Meta API error');
        err.metaError = data.error;
        throw err;
    }
    return data;
}

// =============================================================================
// CHUNKED VIDEO UPLOAD (for files > 50MB)
// =============================================================================
const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB chunks

async function metaChunkedVideoUpload(filePath, filename, extraFields = {}) {
    const fileSize = fs.statSync(filePath).size;
    console.log(`[CHUNKED UPLOAD] Starting for ${filename} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);

    // Step 1: Start upload session
    const startParams = new URLSearchParams({
        upload_phase: 'start',
        file_size: fileSize.toString(),
        access_token: META_ACCESS_TOKEN,
        appsecret_proof: META_APP_SECRET_PROOF,
    });
    for (const [k, v] of Object.entries(extraFields)) startParams.append(k, v);

    const startResp = await fetch(`${META_API_BASE}/${META_AD_ACCOUNT_ID}/advideos`, {
        method: 'POST',
        body: startParams,
        signal: AbortSignal.timeout(30000),
    });
    const startData = await startResp.json();
    if (startData.error) throw new Error(startData.error.message);
    const { upload_session_id, video_id } = startData;
    console.log(`[CHUNKED UPLOAD] Session started: session=${upload_session_id} video_id=${video_id}`);

    // Step 2: Upload chunks
    const fd = fs.openSync(filePath, 'r');
    let offset = 0;
    let chunkNum = 0;
    try {
        while (offset < fileSize) {
            const remaining = fileSize - offset;
            const chunkLen = Math.min(CHUNK_SIZE, remaining);
            const chunk = Buffer.alloc(chunkLen);
            fs.readSync(fd, chunk, 0, chunkLen, offset);
            chunkNum++;
            console.log(`[CHUNKED UPLOAD] Chunk ${chunkNum}: offset=${offset} size=${(chunkLen / 1024 / 1024).toFixed(1)}MB`);

            const formData = new FormData();
            formData.append('upload_phase', 'transfer');
            formData.append('upload_session_id', upload_session_id);
            formData.append('start_offset', offset.toString());
            formData.append('video_file_chunk', new Blob([chunk], { type: 'application/octet-stream' }), filename);
            formData.append('access_token', META_ACCESS_TOKEN);
            formData.append('appsecret_proof', META_APP_SECRET_PROOF);

            const chunkResp = await fetch(`${META_API_BASE}/${META_AD_ACCOUNT_ID}/advideos`, {
                method: 'POST',
                body: formData,
                signal: AbortSignal.timeout(300000), // 5 min per chunk
            });
            const chunkData = await chunkResp.json();
            if (chunkData.error) throw new Error(`Chunk ${chunkNum} failed: ${chunkData.error.message}`);
            offset = parseInt(chunkData.start_offset, 10);
            console.log(`[CHUNKED UPLOAD] Chunk ${chunkNum} done, next offset=${offset}`);
        }
    } finally {
        fs.closeSync(fd);
    }

    // Step 3: Finish upload
    const finishParams = new URLSearchParams({
        upload_phase: 'finish',
        upload_session_id,
        access_token: META_ACCESS_TOKEN,
        appsecret_proof: META_APP_SECRET_PROOF,
    });
    const finishResp = await fetch(`${META_API_BASE}/${META_AD_ACCOUNT_ID}/advideos`, {
        method: 'POST',
        body: finishParams,
        signal: AbortSignal.timeout(30000),
    });
    const finishData = await finishResp.json();
    if (finishData.error) throw new Error(finishData.error.message);
    console.log(`[CHUNKED UPLOAD] Finished! video_id=${video_id}`);
    return { id: video_id, ...finishData };
}

// =============================================================================
// GOOGLE DRIVE HELPERS
// =============================================================================

function extractDriveFileId(urlOrId) {
    if (!urlOrId) return null;
    // Pattern: /file/d/FILE_ID/
    let match = urlOrId.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    // Pattern: ?id=FILE_ID
    match = urlOrId.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    // Pattern: /open?id=FILE_ID
    match = urlOrId.match(/open\?id=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    // Assume raw file ID if no URL pattern matched
    if (/^[a-zA-Z0-9_-]+$/.test(urlOrId)) return urlOrId;
    return null;
}

function extractDriveFolderId(urlOrId) {
    if (!urlOrId) return null;
    // Pattern: /folders/FOLDER_ID
    let match = urlOrId.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    // Pattern: ?id=FOLDER_ID (from open?id=)
    match = urlOrId.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    // Assume raw folder ID if no URL pattern matched
    if (/^[a-zA-Z0-9_-]+$/.test(urlOrId)) return urlOrId;
    return null;
}

async function downloadDriveFile(driveUrl, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await _downloadDriveFileOnce(driveUrl);
        } catch (err) {
            const is429 = err.message && err.message.includes('429');
            const isTransientFetch = err.message && (
                err.message.includes('fetch failed') ||
                err.message.includes('ECONNRESET') ||
                err.message.includes('ETIMEDOUT') ||
                err.message.includes('UND_ERR')
            );
            if ((is429 || isTransientFetch) && attempt < retries) {
                const delay = attempt * 5000; // 5s, 10s
                console.log(`[DRIVE] ${is429 ? 'rate limit' : 'transient fetch error'} retrying in ${delay / 1000}s (attempt ${attempt}/${retries})`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }
}

async function _downloadDriveFileOnce(driveUrl) {
    const fileId = extractDriveFileId(driveUrl);
    if (!fileId) throw new Error(`Could not extract Google Drive file ID from: ${driveUrl}`);

    // Step 1: Hit the download URL to get cookies + confirm token
    let downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    let resp = await fetch(downloadUrl, { redirect: 'manual', signal: AbortSignal.timeout(120000) });

    if (resp.status === 429) {
        throw new Error(`Failed to download image from Drive (status 429)`);
    }

    // Collect cookies from all responses (needed for large file virus scan bypass)
    let cookies = (resp.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');

    // Follow redirects manually to collect cookies
    while (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get('location');
        if (!location) break;
        resp = await fetch(location, { redirect: 'manual', headers: cookies ? { cookie: cookies } : {}, signal: AbortSignal.timeout(120000) });
        const newCookies = resp.headers.getSetCookie?.() || [];
        if (newCookies.length) {
            const existing = new Map(cookies.split('; ').filter(Boolean).map(c => { const [k,...v] = c.split('='); return [k, v.join('=')]; }));
            newCookies.forEach(c => { const [k,...v] = c.split(';')[0].split('='); existing.set(k, v.join('=')); });
            cookies = [...existing.entries()].map(([k,v]) => `${k}=${v}`).join('; ');
        }
    }

    let contentType = resp.headers.get('content-type') || 'application/octet-stream';
    let contentDisp = resp.headers.get('content-disposition') || '';

    // If we got HTML back, Google is showing a virus scan warning page
    if (contentType.includes('text/html')) {
        const html = await resp.text();

        // Extract confirm token + uuid from the warning page
        const confirmMatch = html.match(/confirm=([a-zA-Z0-9_-]+)/) || html.match(/name="confirm"\s+value="([^"]+)"/);
        const uuidMatch = html.match(/uuid=([a-zA-Z0-9_-]+)/) || html.match(/name="uuid"\s+value="([^"]+)"/);

        // Retry with confirm token + cookies
        let retryUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=${confirmMatch ? confirmMatch[1] : 't'}`;
        if (uuidMatch) retryUrl += `&uuid=${uuidMatch[1]}`;
        console.log(`[DRIVE] Large file detected, retrying with confirm token + cookies`);
        resp = await fetch(retryUrl, { redirect: 'follow', headers: cookies ? { cookie: cookies } : {}, signal: AbortSignal.timeout(120000) });
        contentType = resp.headers.get('content-type') || 'application/octet-stream';
        contentDisp = resp.headers.get('content-disposition') || '';

        // If still HTML, try drive.usercontent.google.com with cookies
        if (contentType.includes('text/html')) {
            console.log(`[DRIVE] Trying usercontent endpoint`);
            resp = await fetch(`https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`, {
                redirect: 'follow',
                headers: cookies ? { cookie: cookies } : {},
                signal: AbortSignal.timeout(120000),
            });
            contentType = resp.headers.get('content-type') || 'application/octet-stream';
            contentDisp = resp.headers.get('content-disposition') || '';
        }

        if (contentType.includes('text/html')) {
            throw new Error(`Google Drive download failed for large file. Try making the file publicly accessible or use a smaller file. File ID: ${fileId}`);
        }
    }

    // Try to get filename from content-disposition
    let filename = `drive_${fileId}`;
    const filenameMatch = contentDisp.match(/filename="?([^";]+)"?/);
    if (filenameMatch) {
        filename = filenameMatch[1];
    } else {
        // Guess extension from content type
        const extMap = {
            'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
            'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/x-msvideo': '.avi',
        };
        const ext = extMap[contentType] || '';
        filename += ext;
    }

    const tmpDir = os.tmpdir();
    const tmpPath = path.join(tmpDir, `meta_upload_${Date.now()}_${filename}`);
    const fileStream = fs.createWriteStream(tmpPath);
    await pipeline(resp.body, fileStream);

    // Verify we didn't download an HTML page
    const fileSize = fs.statSync(tmpPath).size;
    console.log(`[DRIVE DOWNLOAD] ${filename} | type=${contentType} | size=${fileSize} bytes`);
    if (fileSize < 1000) {
        const preview = fs.readFileSync(tmpPath, 'utf8').substring(0, 200);
        if (preview.includes('<html') || preview.includes('<!DOCTYPE')) {
            cleanupTempFile(tmpPath);
            throw new Error(`Google Drive download failed: received HTML instead of file. Preview: ${preview.substring(0, 100)}`);
        }
    }

    return { tmpPath, contentType, filename };
}

function cleanupTempFile(tmpPath) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
}

// =============================================================================
// ROUTES
// =============================================================================

// 1. Serve index.html (portal) as root
app.get('/', (req, res) => {
    res.sendFile(path.join(parentDir, 'index.html'));
});

// 1b. Serve Meta uploader on the main host path
app.get('/upload.html', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'upload.html'));
});

// 2. Fetch all campaigns
app.get('/api/campaigns', async (req, res) => {
    try {
        const data = await metaGet(`/${META_AD_ACCOUNT_ID}/campaigns`, {
            fields: 'id,name,status,objective',
            limit: 500,
        });
        res.json({ success: true, campaigns: data.data || [] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

// 3. Fetch adsets in a campaign
app.get('/api/adsets/:campaignId', async (req, res) => {
    try {
        const data = await metaGet(`/${req.params.campaignId}/adsets`, {
            fields: 'id,name,status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_strategy',
            limit: 500,
        });
        res.json({ success: true, adsets: data.data || [] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

// 3b. Fetch single campaign details by ID
app.get('/api/campaign-details/:id', async (req, res) => {
    try {
        const data = await metaGet(`/${req.params.id}`, {
            fields: 'id,name,status,objective,special_ad_categories,bid_strategy,daily_budget,lifetime_budget',
        });
        res.json({ success: true, campaign: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

// 3c. Fetch single adset details by ID
app.get('/api/adset-details/:id', async (req, res) => {
    try {
        const data = await metaGet(`/${req.params.id}`, {
            fields: 'id,name,status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_strategy,bid_amount,start_time,end_time,campaign_id,promoted_object',
        });
        res.json({ success: true, adset: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

app.get('/api/adset-delivery-estimate/:id', async (req, res) => {
    try {
        const data = await metaGet(`/${req.params.id}/delivery_estimate`, {
            fields: 'estimate_ready,daily_outcomes_curve'
        });
        const estimate = Array.isArray(data && data.data) ? data.data[0] : data;
        res.json({ success: true, delivery_estimate: estimate || null });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

app.get('/api/adset-attribution-split/:id', async (req, res) => {
    try {
        const data = await metaGet(`/${req.params.id}/insights`, {
            level: 'adset',
            date_preset: 'last_7d',
            fields: 'spend,actions,action_values',
            action_attribution_windows: '["1d_click","7d_click","1d_view","7d_view"]',
            limit: 1
        });
        const row = Array.isArray(data && data.data) ? data.data[0] : null;
        const spend = Number(row && row.spend || 0);
        const actionValues = Array.isArray(row && row.action_values) ? row.action_values : [];
        const roasByWindow = {};
        actionValues.forEach(item => {
            const windowKey = String(item && item.action_attribution_window || '').toLowerCase();
            const value = Number(item && item.value || 0);
            if (!windowKey || !isFinite(value)) return;
            roasByWindow[windowKey] = (roasByWindow[windowKey] || 0) + value;
        });
        res.json({
            success: true,
            attribution_split: {
                spend,
                revenue_by_window: roasByWindow
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

// 4. Fetch custom audiences
app.get('/api/custom-audiences', async (req, res) => {
    try {
        const data = await metaGet(`/${META_AD_ACCOUNT_ID}/customaudiences`, {
            fields: 'id,name,description,approximate_count',
            limit: 500,
        });
        res.json({ success: true, audiences: data.data || [] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

// 5. Fetch Facebook Pages
app.get('/api/pages', async (req, res) => {
    try {
        const data = await metaGet('/me/accounts', {
            fields: 'id,name,access_token',
            limit: 100,
        });
        res.json({ success: true, pages: data.data || [] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

// 6a. Search for region/state keys (for geo targeting exclusions)
app.get('/api/search-regions', async (req, res) => {
    try {
        const q = req.query.q;
        if (!q) return res.status(400).json({ success: false, error: 'q (search query) is required' });
        const url = `https://graph.facebook.com/v21.0/search?type=adgeolocation&location_types=region&q=${encodeURIComponent(q)}&access_token=${META_ACCESS_TOKEN}&appsecret_proof=${APPSECRET_PROOF}`;
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.error) throw new Error(data.error.message);
        res.json({ success: true, regions: data.data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5b. Resolve Google Drive folder → find -H, -V, -S files
app.post('/api/resolve-folder', async (req, res) => {
    try {
        const { folderUrl } = req.body;
        if (!folderUrl) return res.status(400).json({ success: false, error: 'folderUrl is required' });
        if (!GOOGLE_API_KEY) return res.status(400).json({ success: false, error: 'GOOGLE_API_KEY not configured' });

        const folderId = extractDriveFolderId(folderUrl);
        if (!folderId) return res.status(400).json({ success: false, error: 'Could not extract folder ID from URL' });

        // List files in folder using Google Drive API v3
        const apiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&key=${GOOGLE_API_KEY}`;
        const resp = await fetch(apiUrl);
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Google Drive API error (${resp.status}): ${errText}`);
        }
        const data = await resp.json();
        const files = data.files || [];

        console.log(`[FOLDER] Found ${files.length} files in folder ${folderId}:`, files.map(f => f.name).join(', '));

        // Match files by -H, -V, -S suffix (before extension)
        const result = { horizontal: null, vertical: null, square: null, files: files.map(f => f.name) };
        for (const file of files) {
            const baseName = file.name.replace(/\.[^.]+$/, ''); // strip extension
            const driveLink = `https://drive.google.com/file/d/${file.id}/view`;
            if (/-horizontal$/i.test(baseName)) {
                result.horizontal = driveLink;
            } else if (/-vertical$/i.test(baseName)) {
                result.vertical = driveLink;
            } else if (/-square$/i.test(baseName)) {
                result.square = driveLink;
            }
        }

        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[FOLDER] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. Fetch Google Sheet data
app.get('/api/sheet-data', async (req, res) => {
    try {
        const sheetId = req.query.sheetId || GOOGLE_SHEET_ID;
        const tabName = req.query.tabName || GOOGLE_SHEET_TAB;
        if (!sheetId) return res.status(400).json({ success: false, error: 'sheetId is required' });

        let url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json`;
        if (tabName) url += `&sheet=${encodeURIComponent(tabName)}`;

        const resp = await fetch(url);
        const text = await resp.text();

        // Strip JSONP wrapper: google.visualization.Query.setResponse({...});
        const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\((.+)\);?\s*$/s);
        if (!jsonMatch) throw new Error('Failed to parse Google Sheets JSONP response');

        const parsed = JSON.parse(jsonMatch[1]);
        const table = parsed.table;
        if (!table) throw new Error('No table data in Google Sheets response');

        // Extract column headers
        const cols = (table.cols || []).map(c => c.label || c.id || '');

        // Extract rows as objects keyed by column header
        const rows = (table.rows || []).map(row => {
            const obj = {};
            (row.c || []).forEach((cell, idx) => {
                const key = cols[idx] || `col_${idx}`;
                obj[key] = cell ? (cell.v !== undefined ? cell.v : (cell.f || null)) : null;
            });
            return obj;
        });

        res.json({ success: true, columns: cols, rows, rowCount: rows.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. Upload image from Google Drive to Meta
app.post('/api/upload-image', async (req, res) => {
    let tmpPath = null;
    try {
        const { driveUrl } = req.body;
        if (!driveUrl) return res.status(400).json({ success: false, error: 'driveUrl is required' });

        const file = await downloadDriveFile(driveUrl);
        tmpPath = file.tmpPath;

        const data = await metaPostForm(`/${META_AD_ACCOUNT_ID}/adimages`, tmpPath, file.filename, file.contentType);

        // Response format: { images: { filename: { hash: "...", ... } } }
        let imageHash = null;
        if (data.images) {
            const key = Object.keys(data.images)[0];
            if (key) imageHash = data.images[key].hash;
        }

        res.json({ success: true, imageHash, raw: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    } finally {
        if (tmpPath) cleanupTempFile(tmpPath);
    }
});

// 8. Upload video from Google Drive to Meta with polling
app.post('/api/upload-video', async (req, res) => {
    let tmpPath = null;
    try {
        const { driveUrl, title } = req.body;
        if (!driveUrl) return res.status(400).json({ success: false, error: 'driveUrl is required' });

        const file = await downloadDriveFile(driveUrl);
        tmpPath = file.tmpPath;

        const extraFields = {};
        if (title) extraFields.title = title;

        const fileSize = fs.statSync(tmpPath).size;
        const data = fileSize > 50 * 1024 * 1024
            ? await metaChunkedVideoUpload(tmpPath, file.filename, extraFields)
            : await metaPostForm(`/${META_AD_ACCOUNT_ID}/advideos`, tmpPath, file.filename, file.contentType, extraFields);
        const videoId = data.id;
        if (!videoId) throw new Error('No video ID returned from Meta API');

        // Poll for video ready status
        const timeoutMs = 180000; // 180 seconds
        const pollInterval = 3000; // 3 seconds
        const startTime = Date.now();
        let videoStatus = null;

        while (Date.now() - startTime < timeoutMs) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            const statusResp = await metaGet(`/${videoId}`, { fields: 'status' });
            videoStatus = statusResp.status;

            if (videoStatus && videoStatus.video_status === 'ready') {
                return res.json({ success: true, videoId, status: videoStatus });
            }
            if (videoStatus && videoStatus.video_status === 'error') {
                throw new Error(`Video processing failed: ${JSON.stringify(videoStatus)}`);
            }
        }

        // Timed out but still return the video ID
        res.json({
            success: true,
            videoId,
            status: videoStatus,
            warning: 'Video upload timed out waiting for ready status. Video may still be processing.',
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    } finally {
        if (tmpPath) cleanupTempFile(tmpPath);
    }
});

// 9. Create adset
app.post('/api/create-adset', async (req, res) => {
    try {
        const config = req.body;
        if (!config.name || !config.campaign_id) {
            return res.status(400).json({ success: false, error: 'name and campaign_id are required' });
        }

        const params = {
            name: config.name,
            campaign_id: config.campaign_id,
            status: config.status || 'PAUSED',
            billing_event: config.billing_event,
            optimization_goal: config.optimization_goal,
            bid_strategy: config.bid_strategy,
        };

        // Budget — convert INR to paisa (multiply by 100)
        if (config.daily_budget != null) {
            params.daily_budget = Math.round(Number(config.daily_budget) * 100);
        }
        if (config.lifetime_budget != null) {
            params.lifetime_budget = Math.round(Number(config.lifetime_budget) * 100);
        }
        if (config.bid_amount != null) {
            params.bid_amount = Math.round(Number(config.bid_amount) * 100);
        }

        // Time
        if (config.start_time) params.start_time = config.start_time;
        if (config.end_time) params.end_time = config.end_time;

        // Targeting
        if (config.targeting) {
            params.targeting = JSON.stringify(config.targeting);
        }

        // Promoted object
        if (config.promoted_object) {
            params.promoted_object = JSON.stringify(config.promoted_object);
        }

        const data = await metaPost(`/${META_AD_ACCOUNT_ID}/adsets`, params);
        res.json({ success: true, adsetId: data.id, raw: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

// 10. Create ad creative
app.post('/api/create-creative', async (req, res) => {
    try {
        const config = req.body;
        if (!config.name) {
            return res.status(400).json({ success: false, error: 'name is required' });
        }

        const params = { name: config.name };

        // asset_feed_spec
        if (config.asset_feed_spec) {
            params.asset_feed_spec = JSON.stringify(config.asset_feed_spec);
        }

        // object_story_spec
        if (config.object_story_spec) {
            params.object_story_spec = JSON.stringify(config.object_story_spec);
        }

        // degrees_of_freedom_spec
        if (config.degrees_of_freedom_spec) {
            params.degrees_of_freedom_spec = JSON.stringify(config.degrees_of_freedom_spec);
        }

        const data = await metaPost(`/${META_AD_ACCOUNT_ID}/adcreatives`, params);
        res.json({ success: true, creativeId: data.id, raw: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

// 11. Create ad
app.post('/api/create-ad', async (req, res) => {
    try {
        const { name, adset_id, creative_id, status, tracking_specs } = req.body;
        if (!name || !adset_id || !creative_id) {
            return res.status(400).json({ success: false, error: 'name, adset_id, and creative_id are required' });
        }

        const params = {
            name,
            adset_id,
            creative: JSON.stringify({ creative_id }),
            status: status || 'PAUSED',
        };

        if (tracking_specs) {
            params.tracking_specs = JSON.stringify(tracking_specs);
        }

        const data = await metaPost(`/${META_AD_ACCOUNT_ID}/ads`, params);
        res.json({ success: true, adId: data.id, raw: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

// 11b. Update ad status (pause/activate)
app.post('/api/meta/ad-status', async (req, res) => {
    try {
        const { ad_id, status } = req.body;
        if (!ad_id) return res.status(400).json({ success: false, error: 'ad_id is required' });
        const validStatuses = ['PAUSED', 'ACTIVE'];
        const newStatus = (status || 'PAUSED').toUpperCase();
        if (!validStatuses.includes(newStatus)) {
            return res.status(400).json({ success: false, error: 'status must be PAUSED or ACTIVE' });
        }
        const data = await metaPost(`/${ad_id}`, { status: newStatus });
        res.json({ success: true, ad_id, status: newStatus, raw: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

// 11c. Update adset budget (for ABO)
app.post('/api/meta/adset-budget', async (req, res) => {
    try {
        const { adset_id, daily_budget, action } = req.body;
        if (!adset_id) return res.status(400).json({ success: false, error: 'adset_id is required' });

        // If action is 'increase' or 'decrease', fetch current and adjust by 20%
        if (action === 'increase' || action === 'decrease') {
            const current = await metaGet(`/${adset_id}`, { fields: 'daily_budget,name' });
            const currentBudget = parseInt(current.daily_budget || 0); // in cents
            const multiplier = action === 'increase' ? 1.20 : 0.80;
            const newBudget = Math.round(currentBudget * multiplier);
            const data = await metaPost(`/${adset_id}`, { daily_budget: newBudget });
            res.json({
                success: true, adset_id,
                adset_name: current.name,
                previous_budget: currentBudget / 100,
                new_budget: newBudget / 100,
                action,
                change_pct: action === 'increase' ? '+20%' : '-20%',
                raw: data
            });
        } else if (daily_budget) {
            // Direct budget set (in rupees, convert to paisa for Meta API)
            const budgetCents = Math.round(daily_budget * 100);
            const data = await metaPost(`/${adset_id}`, { daily_budget: budgetCents });
            res.json({ success: true, adset_id, new_budget: daily_budget, raw: data });
        } else {
            return res.status(400).json({ success: false, error: 'Provide daily_budget (rupees) or action (increase/decrease)' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

// 11d. Update campaign budget (for CBO)
app.post('/api/meta/campaign-budget', async (req, res) => {
    try {
        const { campaign_id, daily_budget, action } = req.body;
        if (!campaign_id) return res.status(400).json({ success: false, error: 'campaign_id is required' });

        if (action === 'increase' || action === 'decrease') {
            const current = await metaGet(`/${campaign_id}`, { fields: 'daily_budget,name' });
            const currentBudget = parseInt(current.daily_budget || 0);
            const multiplier = action === 'increase' ? 1.20 : 0.80;
            const newBudget = Math.round(currentBudget * multiplier);
            const data = await metaPost(`/${campaign_id}`, { daily_budget: newBudget });
            res.json({
                success: true, campaign_id,
                campaign_name: current.name,
                previous_budget: currentBudget / 100,
                new_budget: newBudget / 100,
                action,
                change_pct: action === 'increase' ? '+20%' : '-20%',
                raw: data
            });
        } else if (daily_budget) {
            const budgetCents = Math.round(daily_budget * 100);
            const data = await metaPost(`/${campaign_id}`, { daily_budget: budgetCents });
            res.json({ success: true, campaign_id, new_budget: daily_budget, raw: data });
        } else {
            return res.status(400).json({ success: false, error: 'Provide daily_budget (rupees) or action (increase/decrease)' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, metaError: err.metaError });
    }
});

// 12. Full orchestration endpoint
app.post('/api/execute-full', async (req, res) => {
    const config = req.body;
    console.log('\n[EXECUTE-FULL] Starting execution with config:', JSON.stringify(config, null, 2));
    const sheetRowIndex = config._sheetRowIndex || null;
    const sheetTabName = config._sheetTabName || 'Sheet1';
    const results = {
        steps: [],
        success: false,
    };

    function logStep(name, success, data) {
        results.steps.push({ step: name, success, ...data });
    }

    // Clean "null" strings from config (Google Sheets sends empty cells as literal "null")
    for (const key of Object.keys(config)) {
        if (config[key] === 'null' || config[key] === 'undefined') config[key] = null;
    }

    try {
        // ------------------------------------------------------------------
        // Parse Google Sheets Date() format: "Date(2026,2,15,18,7,49)" -> ISO string
        function parseGSheetsDate(val) {
            if (!val) return val;
            const str = String(val);
            const m = str.match(/^Date\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)$/);
            if (m) {
                const d = new Date(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
                return d.toISOString();
            }
            return str; // already a normal string
        }
        if (config.start_time) config.start_time = parseGSheetsDate(config.start_time);
        if (config.end_time) config.end_time = parseGSheetsDate(config.end_time);

        // Auto-resolve folder URL to individual asset links
        const folderUrl = config.asset_folder || config.folder_url || config.folder || null;
        if (folderUrl && GOOGLE_API_KEY) {
            const folderId = extractDriveFolderId(folderUrl);
            if (folderId) {
                console.log(`[EXECUTE-FULL] Resolving folder ${folderId} to individual assets...`);
                try {
                    const apiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType)&key=${GOOGLE_API_KEY}`;
                    const resp = await fetch(apiUrl);
                    if (resp.ok) {
                        const data = await resp.json();
                        for (const file of (data.files || [])) {
                            const baseName = file.name.replace(/\.[^.]+$/, '');
                            const driveLink = `https://drive.google.com/file/d/${file.id}/view`;
                            if (/-horizontal$/i.test(baseName) && !config.asset_horizontal) config.asset_horizontal = driveLink;
                            else if (/-vertical$/i.test(baseName) && !config.asset_vertical) config.asset_vertical = driveLink;
                            else if (/-square$/i.test(baseName) && !config.asset_square) config.asset_square = driveLink;
                        }
                        console.log(`[EXECUTE-FULL] Folder resolved: H=${config.asset_horizontal}, V=${config.asset_vertical}, S=${config.asset_square}`);
                    }
                } catch (err) {
                    console.error(`[EXECUTE-FULL] Folder resolution failed: ${err.message}`);
                }
            }
        }

        // Normalize field names from frontend format
        // ------------------------------------------------------------------
        // Asset URLs: frontend sends asset_horizontal, server needs drive URLs
        const driveUrls = {
            horizontal: config.asset_horizontal || config.horizontal_drive_url || null,
            vertical: config.asset_vertical || config.vertical_drive_url || null,
            square: config.asset_square || config.square_drive_url || null,
        };
        const thumbUrls = {
            horizontal: config.thumb_horizontal || config.horizontal_thumb_drive_url || null,
            vertical: config.thumb_vertical || config.vertical_thumb_drive_url || null,
            square: config.thumb_square || config.square_thumb_drive_url || null,
        };

        // Creative type
        const assetType = (config.creative_type || config.asset_type || 'VIDEO').toLowerCase(); // 'video' or 'image'

        // Budget: frontend sends budget_type + budget, normalize to daily_budget or lifetime_budget
        let dailyBudget = config.daily_budget || null;
        let lifetimeBudget = config.lifetime_budget || null;
        if (!dailyBudget && !lifetimeBudget && config.budget) {
            if (config.budget_type === 'lifetime') {
                lifetimeBudget = config.budget;
            } else {
                dailyBudget = config.budget;
            }
        }

        // Targeting: frontend sends flat fields, build targeting object
        let targeting = config.targeting;
        if (!targeting) {
            targeting = {};
            // Geo locations
            const countries = config.geo_countries || (config.countries ? String(config.countries).split(/[,|]/).map(s => s.trim()).filter(Boolean) : ['IN']);
            targeting.geo_locations = { countries };

            // Excluded geo locations (countries and/or regions/states by key)
            const excludedCountries = config.excluded_countries ? String(config.excluded_countries).split(/[,|]/).map(s => s.trim()).filter(Boolean) : [];
            const excludedRegions = config.excluded_regions ? String(config.excluded_regions).split(/[,|]/).map(s => ({ key: s.trim() })).filter(r => r.key) : [];
            if (excludedCountries.length > 0 || excludedRegions.length > 0) {
                targeting.excluded_geo_locations = {};
                if (excludedCountries.length > 0) targeting.excluded_geo_locations.countries = excludedCountries;
                if (excludedRegions.length > 0) targeting.excluded_geo_locations.regions = excludedRegions;
            }

            // Age
            targeting.age_min = parseInt(config.age_min) || 18;
            targeting.age_max = parseInt(config.age_max) || 65;

            // Gender
            if (config.genders && Array.isArray(config.genders) && config.genders.length > 0) {
                targeting.genders = config.genders;
            } else if (config.gender && String(config.gender) !== '0') {
                targeting.genders = [parseInt(config.gender)];
            }

            // Device platforms
            const devicePlatforms = config.device_platforms || ['mobile'];
            targeting.device_platforms = Array.isArray(devicePlatforms) ? devicePlatforms : String(devicePlatforms).split(/[,|]/).map(s => s.trim()).filter(Boolean);

            // OS
            const osTarget = config.os_target || config.os || 'Android';
            if (osTarget && osTarget !== 'All') {
                targeting.user_os = [osTarget];
                if (config.min_os_version) {
                    targeting.os_version_min = config.min_os_version;
                }
            }

            // Publisher platforms
            const pubPlatforms = config.publisher_platforms || ['facebook', 'instagram'];
            targeting.publisher_platforms = Array.isArray(pubPlatforms) ? pubPlatforms : String(pubPlatforms).split(/[,|]/).map(s => s.trim()).filter(Boolean);

            // Positions (auto-correct 'reels' to 'facebook_reels' for FB positions)
            const videoOnlyFbPositions = ['video_feeds', 'instream_video'];
            let fbPositions = config.facebook_positions || ['feed', 'video_feeds', 'story', 'facebook_reels', 'facebook_reels_overlay', 'profile_feed', 'instream_video', 'marketplace', 'search'];
            fbPositions = (Array.isArray(fbPositions) ? fbPositions : String(fbPositions).split(/[,|]/).map(s => s.trim()).filter(Boolean))
                .map(p => p === 'reels' ? 'facebook_reels' : p);
            // Remove video-only placements for image ads
            if (assetType === 'image') {
                fbPositions = fbPositions.filter(p => !videoOnlyFbPositions.includes(p));
            }
            targeting.facebook_positions = fbPositions;

            const igPositions = config.instagram_positions || ['stream', 'story', 'reels', 'ig_search', 'profile_reels', 'profile_feed'];
            targeting.instagram_positions = Array.isArray(igPositions) ? igPositions : String(igPositions).split(/[,|]/).map(s => s.trim()).filter(Boolean);

            // Custom audiences (filter out "null" and empty strings)
            const customAudiences = config.custom_audiences || [];
            const caList = (Array.isArray(customAudiences) ? customAudiences : String(customAudiences).split(/[,|]/)).map(s => String(s).trim()).filter(s => s && s !== 'null');
            if (caList.length > 0) targeting.custom_audiences = caList.map(id => ({ id }));

            const excludedAudiences = config.excluded_audiences || [];
            const exList = (Array.isArray(excludedAudiences) ? excludedAudiences : String(excludedAudiences).split(/[,|]/)).map(s => String(s).trim()).filter(s => s && s !== 'null');
            if (exList.length > 0) targeting.excluded_custom_audiences = exList.map(id => ({ id }));
        }

        // Promoted object
        let promotedObject = config.promoted_object;
        if (!promotedObject && config.app_id) {
            promotedObject = {
                application_id: config.app_id,
                object_store_url: config.object_store_url || config.app_store_url || '',
            };
            if (config.custom_event_type) {
                promotedObject.custom_event_type = config.custom_event_type;
            }
        }
        // Deferred deep link added below after linkUrl is defined

        // ------------------------------------------------------------------
        // Step 1: Upload assets (horizontal, vertical, square)
        // ------------------------------------------------------------------
        const assets = {};

        if (assetType === 'image') {
            // Upload images sequentially to avoid Drive 429 rate limits
            const sizes = ['horizontal', 'vertical', 'square'];

            for (const size of sizes) {
                const driveUrl = driveUrls[size];
                if (!driveUrl) {
                    logStep(`upload_image_${size}`, false, { error: `${size} drive URL not provided` });
                    continue;
                }
                    {
                        let tmpPath = null;
                        try {
                            const file = await downloadDriveFile(driveUrl);
                            tmpPath = file.tmpPath;
                            const data = await metaPostForm(`/${META_AD_ACCOUNT_ID}/adimages`, tmpPath, file.filename, file.contentType);
                            let imageHash = null;
                            if (data.images) {
                                const key = Object.keys(data.images)[0];
                                if (key) imageHash = data.images[key].hash;
                            }
                            assets[size] = { imageHash };
                            logStep(`upload_image_${size}`, true, { imageHash });
                        } catch (err) {
                            logStep(`upload_image_${size}`, false, { error: err.message });
                            throw err;
                        } finally {
                            if (tmpPath) cleanupTempFile(tmpPath);
                        }
                    }
            }
        } else {
            // Upload videos sequentially to avoid Drive 429 rate limits
            const sizes = ['horizontal', 'vertical', 'square'];
            const uploadedVideos = [];
            for (const size of sizes) {
                const driveUrl = driveUrls[size];
                if (!driveUrl) {
                    logStep(`upload_video_${size}`, false, { error: `${size} drive URL not provided` });
                    continue;
                }
                let tmpPath = null;
                try {
                    const file = await downloadDriveFile(driveUrl);
                    tmpPath = file.tmpPath;
                    const videoTitle = config.creative_name || config.adset_name || 'Ad Video';
                    const fileSize = fs.statSync(tmpPath).size;
                    const extraFields = { title: `${videoTitle} (${size})` };
                    const data = fileSize > 50 * 1024 * 1024
                        ? await metaChunkedVideoUpload(tmpPath, file.filename, extraFields)
                        : await metaPostForm(`/${META_AD_ACCOUNT_ID}/advideos`, tmpPath, file.filename, file.contentType, extraFields);
                    const videoId = data.id;
                    if (!videoId) throw new Error('No video ID returned');
                    assets[size] = { videoId };
                    logStep(`upload_video_${size}`, true, { videoId });
                    uploadedVideos.push({ size, videoId });
                } catch (err) {
                    logStep(`upload_video_${size}`, false, { error: err.message });
                    throw err;
                } finally {
                    if (tmpPath) cleanupTempFile(tmpPath);
                }
            }

            // Poll all videos for ready status in parallel
            const pollPromises = [];
            for (const { size, videoId } of uploadedVideos) {
                pollPromises.push(
                    (async () => {
                        const timeoutMs = 90000;
                        const pollInterval = 5000;
                        const startTime = Date.now();
                        let ready = false;

                        while (Date.now() - startTime < timeoutMs) {
                            await new Promise(resolve => setTimeout(resolve, pollInterval));
                            const statusResp = await metaGet(`/${videoId}`, { fields: 'status' });
                            if (statusResp.status && statusResp.status.video_status === 'ready') {
                                ready = true;
                                break;
                            }
                            if (statusResp.status && statusResp.status.video_status === 'error') {
                                throw new Error(`Video processing error: ${JSON.stringify(statusResp.status)}`);
                            }
                        }
                        assets[size] = { videoId };
                        logStep(`poll_video_${size}`, true, { videoId, ready });
                    })()
                );
            }
            await Promise.all(pollPromises);

            // Upload thumbnail images for videos sequentially
            for (const size of sizes) {
                const thumbUrl = thumbUrls[size];
                if (!thumbUrl) continue;
                let tmpPath = null;
                try {
                    const file = await downloadDriveFile(thumbUrl);
                    tmpPath = file.tmpPath;
                    const data = await metaPostForm(`/${META_AD_ACCOUNT_ID}/adimages`, tmpPath, file.filename, file.contentType);
                    let thumbHash = null;
                    if (data.images) {
                        const key = Object.keys(data.images)[0];
                        if (key) thumbHash = data.images[key].hash;
                    }
                    if (assets[size]) assets[size].thumbnailHash = thumbHash;
                    logStep(`upload_thumbnail_${size}`, true, { thumbHash });
                } catch (err) {
                    logStep(`upload_thumbnail_${size}`, false, { error: err.message });
                } finally {
                    if (tmpPath) cleanupTempFile(tmpPath);
                }
            }
        }

        // ------------------------------------------------------------------
        // Step 2: Create adset
        // ------------------------------------------------------------------
        const adsetParams = {
            name: config.adset_name,
            campaign_id: config.campaign_id,
            status: config.adset_status || 'PAUSED',
            billing_event: config.billing_event || 'IMPRESSIONS',
            optimization_goal: config.optimization_goal || 'APP_INSTALLS',
            bid_strategy: config.bid_strategy || 'LOWEST_COST_WITHOUT_CAP',
        };

        if (dailyBudget != null) adsetParams.daily_budget = Math.round(Number(dailyBudget) * 100);
        if (lifetimeBudget != null) adsetParams.lifetime_budget = Math.round(Number(lifetimeBudget) * 100);
        if (config.bid_amount != null && config.bid_amount !== '') {
            adsetParams.bid_amount = Math.round(Number(config.bid_amount) * 100);
        }
        adsetParams.start_time = config.start_time || new Date().toISOString();
        if (config.end_time) adsetParams.end_time = config.end_time;
        adsetParams.targeting = JSON.stringify(targeting);
        const linkUrl = config.link_url || '';
        const storeUrl = config.object_store_url || '';
        if (promotedObject) adsetParams.promoted_object = JSON.stringify(promotedObject);

        // India securities & investments regulatory requirement
        adsetParams.regional_regulated_categories = JSON.stringify(['INDIA_FINSERV']);
        const regulatoryId = config.regulatory_identity_id || '1698107647490483';
        adsetParams.regional_regulation_identities = JSON.stringify({
            india_finserv_beneficiary: regulatoryId,
            india_finserv_payer: regulatoryId,
        });

        let adsetId = String(config.existing_adset_id || config.adset_id || '').trim() || null;
        if (adsetId) {
            logStep('reuse_adset', true, { adsetId });
        } else {
            try {
                const adsetData = await metaPost(`/${META_AD_ACCOUNT_ID}/adsets`, adsetParams);
                adsetId = adsetData.id;
                logStep('create_adset', true, { adsetId });
            } catch (err) {
                logStep('create_adset', false, { error: err.message, metaError: err.metaError });
                throw err;
            }
        }

        // ------------------------------------------------------------------
        // Step 3: Create ad creative with asset customization
        // ------------------------------------------------------------------
        const bodyText = config.primary_text || config.body_text || '';
        const titleText = config.headline || config.title_text || '';
        const descText = config.description || config.description_text || '';
        const ctaType = config.cta || config.call_to_action || 'SUBSCRIBE';
        // For app install campaigns, asset_feed_spec link_urls must use the store URL
        const feedLinkUrl = storeUrl || linkUrl;
        const pageId = config.page_id || '';

        let creativeId;
        try {
            const creativeParams = { name: config.creative_name || `${config.adset_name} Creative` };

            if (assetType === 'video') {
                const videos = [];
                if (assets.horizontal && assets.horizontal.videoId) {
                    const entry = { video_id: assets.horizontal.videoId, adlabels: [{ name: 'horizontal' }] };
                    if (assets.horizontal.thumbnailHash) entry.thumbnail_hash = assets.horizontal.thumbnailHash;
                    videos.push(entry);
                }
                if (assets.vertical && assets.vertical.videoId) {
                    const entry = { video_id: assets.vertical.videoId, adlabels: [{ name: 'vertical' }] };
                    if (assets.vertical.thumbnailHash) entry.thumbnail_hash = assets.vertical.thumbnailHash;
                    videos.push(entry);
                }
                if (assets.square && assets.square.videoId) {
                    const entry = { video_id: assets.square.videoId, adlabels: [{ name: 'square' }] };
                    if (assets.square.thumbnailHash) entry.thumbnail_hash = assets.square.thumbnailHash;
                    videos.push(entry);
                }

                // Build link_urls with deeplink if provided
                // Only set deeplink_url for actual deep links (app schemes or verified app links)
                const vidLinkUrl = { website_url: feedLinkUrl, display_url: '' };
                if (linkUrl && linkUrl !== feedLinkUrl) {
                    // Check if it's a real deep link (custom scheme like univest://) vs regular web URL
                    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(linkUrl) && !linkUrl.startsWith('http')) {
                        vidLinkUrl.deeplink_url = linkUrl;
                    } else {
                        // Regular web URL — use as website_url instead of deeplink_url
                        vidLinkUrl.website_url = linkUrl;
                    }
                }

                const vidFeedSpec = {
                    videos,
                    ad_formats: ['AUTOMATIC_FORMAT'],
                    bodies: [{ text: bodyText }],
                    titles: [{ text: titleText }],
                    descriptions: [{ text: descText }],
                    call_to_action_types: [ctaType],
                    link_urls: [vidLinkUrl],
                    optimization_type: 'PLACEMENT',
                    asset_customization_rules: [
                        {
                            // Vertical placements (FB + IG combined)
                            customization_spec: { publisher_platforms: ['facebook', 'instagram'], facebook_positions: ['story', 'facebook_reels'], instagram_positions: ['story', 'reels', 'profile_reels', 'ig_search'] },
                            video_label: { name: 'vertical' },
                            priority: 1,
                        },
                        {
                            // Horizontal placements
                            customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['search'] },
                            video_label: { name: 'horizontal' },
                            priority: 2,
                        },
                        {
                            // Catch-all: square for everything else (feed, profile_feed, marketplace, reels_overlay, IG stream, explore, etc.)
                            customization_spec: {},
                            video_label: { name: 'square' },
                            priority: 3,
                        },
                    ],
                };
                creativeParams.asset_feed_spec = JSON.stringify(vidFeedSpec);
            } else {
                // Image creative
                const images = [];
                if (assets.horizontal && assets.horizontal.imageHash) {
                    images.push({ hash: assets.horizontal.imageHash, adlabels: [{ name: 'horizontal' }] });
                }
                if (assets.vertical && assets.vertical.imageHash) {
                    images.push({ hash: assets.vertical.imageHash, adlabels: [{ name: 'vertical' }] });
                }
                if (assets.square && assets.square.imageHash) {
                    images.push({ hash: assets.square.imageHash, adlabels: [{ name: 'square' }] });
                }

                // Build link_urls with deeplink if provided
                // Only set deeplink_url for actual deep links (custom scheme), not regular web URLs
                const imgLinkUrl = { website_url: feedLinkUrl, display_url: '' };
                if (linkUrl && linkUrl !== feedLinkUrl) {
                    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(linkUrl) && !linkUrl.startsWith('http')) {
                        imgLinkUrl.deeplink_url = linkUrl;
                    } else {
                        imgLinkUrl.website_url = linkUrl;
                    }
                }

                const imgFeedSpec = {
                    images,
                    ad_formats: ['AUTOMATIC_FORMAT'],
                    bodies: [{ text: bodyText }],
                    titles: [{ text: titleText }],
                    descriptions: [{ text: descText }],
                    call_to_action_types: [ctaType],
                    link_urls: [imgLinkUrl],
                    optimization_type: 'PLACEMENT',
                    asset_customization_rules: [
                        {
                            // Vertical placements (FB + IG combined)
                            customization_spec: { publisher_platforms: ['facebook', 'instagram'], facebook_positions: ['story', 'facebook_reels'], instagram_positions: ['story', 'reels', 'profile_reels', 'ig_search'] },
                            image_label: { name: 'vertical' },
                            priority: 1,
                        },
                        {
                            // Horizontal placements
                            customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['search'] },
                            image_label: { name: 'horizontal' },
                            priority: 2,
                        },
                        {
                            // Catch-all: square for everything else (feed, profile_feed, marketplace, reels_overlay, IG stream, explore, etc.)
                            customization_spec: {},
                            image_label: { name: 'square' },
                            priority: 3,
                        },
                    ],
                };
                creativeParams.asset_feed_spec = JSON.stringify(imgFeedSpec);
            }

            if (pageId) {
                const storySpec = { page_id: pageId };
                // Add Instagram actor if placing on Instagram
                const igActorId = config.instagram_actor_id || '17841452244426405';
                storySpec.instagram_user_id = igActorId;
                creativeParams.object_story_spec = JSON.stringify(storySpec);
            }

            const creativeData = await metaPost(`/${META_AD_ACCOUNT_ID}/adcreatives`, creativeParams);
            creativeId = creativeData.id;
            logStep('create_creative', true, { creativeId });
        } catch (err) {
            logStep('create_creative', false, { error: err.message, metaError: err.metaError });
            throw err;
        }

        // ------------------------------------------------------------------
        // Step 4: Create ad
        // ------------------------------------------------------------------
        try {
            const adParams = {
                name: config.ad_name || `${config.adset_name} Ad`,
                adset_id: adsetId,
                creative: JSON.stringify({ creative_id: creativeId }),
                status: config.ad_status || 'PAUSED',
            };

            // Auto-add tracking specs for app install campaigns
            if (config.app_id) {
                adParams.tracking_specs = JSON.stringify([{
                    'action.type': ['mobile_app_install'],
                    application: [config.app_id],
                }]);
            }

            // Deep link is now set via call_to_actions in asset_feed_spec

            const adData = await metaPost(`/${META_AD_ACCOUNT_ID}/ads`, adParams);
            logStep('create_ad', true, { adId: adData.id });

            results.success = true;
            results.adsetId = adsetId;
            results.creativeId = creativeId;
            results.adId = adData.id;
        } catch (err) {
            logStep('create_ad', false, { error: err.message, metaError: err.metaError });
            throw err;
        }

        // Write success back to sheet
        if (sheetRowIndex) {
            await writeResultToSheet(sheetRowIndex, {
                adset_id: results.adsetId,
                ad_id: results.adId,
                upload_status: 'SUCCESS',
                error_message: '',
            }, sheetTabName);
        }

        res.json(results);
    } catch (err) {
        results.success = false;
        results.error = err.message;

        // Write error back to sheet
        if (sheetRowIndex) {
            await writeResultToSheet(sheetRowIndex, {
                adset_id: results.adsetId || '',
                ad_id: results.adId || '',
                upload_status: 'FAILED',
                error_message: err.message,
            }, sheetTabName);
        }

        res.status(500).json(results);
    }
});

// =============================================================================
// DATA ANALYSER API
// =============================================================================

// Extract Google Sheet ID from various URL formats
function extractSheetId(url) {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
}

// Fetch Google Sheet as CSV
async function fetchSheetCSV(sheetUrl, tabName) {
    const sheetId = extractSheetId(sheetUrl);
    if (!sheetId) throw new Error('Invalid Google Sheets URL');

    let csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    if (tabName) csvUrl += `&sheet=${encodeURIComponent(tabName)}`;

    const res = await fetch(csvUrl, { redirect: 'follow' });
    if (!res.ok) {
        // Try alternative endpoint
        const altUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
        const altRes = await fetch(altUrl, { redirect: 'follow' });
        if (!altRes.ok) throw new Error('Could not fetch spreadsheet. Make sure it is publicly accessible (Anyone with link can view).');
        return await altRes.text();
    }
    return await res.text();
}

// Fetch Meta Ads performance data for analyser
async function fetchMetaAdsData(datePreset) {
    const preset = datePreset || 'maximum';
    const results = {};

    // 1. Account-level insights
    try {
        const accountInsights = await metaGet(`/${META_AD_ACCOUNT_ID}/insights`, {
            fields: 'spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type,purchase_roas',
            date_preset: preset,
            level: 'account',
        });
        results.accountInsights = accountInsights.data || [];
    } catch (e) {
        console.warn('[Analyser] Could not fetch account insights:', e.message);
        results.accountInsights = [];
    }

    // 2. Campaign-level insights
    try {
        const campaignInsights = await metaGet(`/${META_AD_ACCOUNT_ID}/insights`, {
            fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type,purchase_roas,objective',
            date_preset: preset,
            level: 'campaign',
            limit: 100,
        });
        results.campaignInsights = campaignInsights.data || [];
    } catch (e) {
        console.warn('[Analyser] Could not fetch campaign insights:', e.message);
        results.campaignInsights = [];
    }

    // 3. Adset-level insights (top 50 by spend)
    try {
        const adsetInsights = await metaGet(`/${META_AD_ACCOUNT_ID}/insights`, {
            fields: 'adset_id,adset_name,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,reach,actions,cost_per_action_type,purchase_roas',
            date_preset: preset,
            level: 'adset',
            sort: 'spend_descending',
            limit: 50,
        });
        results.adsetInsights = adsetInsights.data || [];
    } catch (e) {
        console.warn('[Analyser] Could not fetch adset insights:', e.message);
        results.adsetInsights = [];
    }

    // 4. Ad-level insights (top 50 by spend)
    try {
        const adInsights = await metaGet(`/${META_AD_ACCOUNT_ID}/insights`, {
            fields: 'ad_id,ad_name,adset_name,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,actions,cost_per_action_type,purchase_roas',
            date_preset: preset,
            level: 'ad',
            sort: 'spend_descending',
            limit: 50,
        });
        results.adInsights = adInsights.data || [];
    } catch (e) {
        console.warn('[Analyser] Could not fetch ad insights:', e.message);
        results.adInsights = [];
    }

    // 5. Daily breakdown (for trend analysis)
    try {
        const dailyInsights = await metaGet(`/${META_AD_ACCOUNT_ID}/insights`, {
            fields: 'spend,impressions,clicks,ctr,cpc,actions,purchase_roas',
            date_preset: preset,
            time_increment: 1,
            level: 'account',
            limit: 90,
        });
        results.dailyInsights = dailyInsights.data || [];
    } catch (e) {
        console.warn('[Analyser] Could not fetch daily insights:', e.message);
        results.dailyInsights = [];
    }

    return results;
}

// Flatten Meta actions/cost_per_action arrays into plain key-value
function flattenMetaRow(row) {
    const flat = {};
    for (const [k, v] of Object.entries(row)) {
        if (k === 'actions' && Array.isArray(v)) {
            v.forEach(a => { flat['actions_' + a.action_type] = a.value; });
        } else if (k === 'cost_per_action_type' && Array.isArray(v)) {
            v.forEach(a => { flat['cost_per_' + a.action_type] = a.value; });
        } else if (k === 'purchase_roas' && Array.isArray(v)) {
            v.forEach(a => { flat['roas_' + a.action_type] = a.value; });
        } else if (typeof v !== 'object') {
            flat[k] = v;
        }
    }
    return flat;
}

// Convert array of objects to CSV string
function toCSV(rows) {
    if (!rows.length) return '';
    const flatRows = rows.map(flattenMetaRow);
    const allKeys = [...new Set(flatRows.flatMap(r => Object.keys(r)))];
    // Put important cols first
    const priority = ['date_start','date_stop','campaign_name','campaign_id','adset_name','adset_id','ad_name','ad_id','spend','impressions','clicks','ctr','cpc','cpm','reach','frequency'];
    const keys = [
        ...priority.filter(k => allKeys.includes(k)),
        ...allKeys.filter(k => !priority.includes(k))
    ];
    let csv = keys.join(',') + '\n';
    flatRows.forEach(r => {
        csv += keys.map(k => {
            const val = r[k] !== undefined ? String(r[k]) : '';
            return val.includes(',') ? `"${val}"` : val;
        }).join(',') + '\n';
    });
    return csv;
}

// Format Meta data into clean CSV tables for the AI
function formatMetaDataForAI(metaData) {
    let text = '';

    if (metaData.accountInsights.length) {
        text += '--- ACCOUNT OVERVIEW ---\n';
        text += toCSV(metaData.accountInsights) + '\n';
    }

    if (metaData.campaignInsights.length) {
        text += '--- CAMPAIGN PERFORMANCE (all campaigns) ---\n';
        text += toCSV(metaData.campaignInsights) + '\n';
    }

    if (metaData.adsetInsights.length) {
        text += '--- TOP ADSETS BY SPEND ---\n';
        text += toCSV(metaData.adsetInsights) + '\n';
    }

    if (metaData.adInsights.length) {
        text += '--- TOP ADS BY SPEND ---\n';
        text += toCSV(metaData.adInsights) + '\n';
    }

    if (metaData.dailyInsights.length) {
        text += '--- DAILY TRENDS ---\n';
        text += toCSV(metaData.dailyInsights) + '\n';
    }

    return text;
}

const ANALYSER_SYSTEM_PROMPT = `You are an expert data analyst and performance marketing specialist.

CRITICAL ACCURACY RULES:
- ONLY cite numbers that EXACTLY appear in the provided data. NEVER estimate, round differently, or invent numbers.
- If a value is "1234.56" in the data, say "1234.56" — do not say "~1235" or "approximately 1.2K".
- If you cannot find a specific data point, say "not available in the data" — NEVER guess.
- When the data contains CSV columns, read them carefully by matching column headers to values in each row.
- Meta Ads "spend" is in the ad account's currency. "ctr" is already a percentage. "cpc"/"cpm" are in the account currency.
- The "actions_" prefixed columns are conversion events: actions_purchase = purchases, actions_link_click = link clicks, actions_app_install = installs, etc.
- "roas_" prefixed columns are return on ad spend for that action type.
- "cost_per_" prefixed columns are cost per that conversion type.

RESPONSE FORMAT:
- Output clean HTML only (no markdown, no code fences, no \`\`\`)
- Use these CSS classes: class="report-table" for tables, class="metric-highlight" for key numbers, class="insight-card" for insights, class="recommendation" for recommendations, class="warning-card" for warnings, class="section-header" for h2 headers
- Use HTML tables with actual data from the dataset — every number in a table MUST come directly from the source data
- For first analysis: Executive Summary, Data Overview, Key Findings (with tables), Actionable Recommendations, Risk Factors
- For follow-ups: respond conversationally but still use the HTML classes above
- Be specific and actionable. "Pause campaign X because its CPC of $Y is 3x higher than account average of $Z" — not "consider optimising underperforming campaigns"`;

// In-memory store for data context per session (keyed by sessionId)
const analyserSessions = {};

app.post('/api/analyse', async (req, res) => {
    try {
        const { sheetUrl, tabName, prompt, csvData: uploadedCsv, includeMeta, metaDatePreset, messages, sessionId } = req.body;

        if (!prompt) return res.status(400).json({ error: 'Analysis prompt is required' });

        if (!OpenAI) return res.status(500).json({ error: 'OpenAI SDK not installed. Run: npm install openai' });
        if (!OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not set in .env file' });

        const isFollowUp = messages && messages.length > 0;
        const sid = sessionId || 'default';

        // On first message, fetch and store the data
        let dataContext = '';
        if (!isFollowUp) {
            if (!sheetUrl && !uploadedCsv && !includeMeta) {
                return res.status(400).json({ error: 'Provide a data source: Google Sheet URL, file upload, or enable Meta Ads data' });
            }

            let allData = '';

            if (sheetUrl) {
                console.log(`[Analyser] Fetching sheet: ${sheetUrl}`);
                const sheetCsv = await fetchSheetCSV(sheetUrl, tabName);
                allData += '=== DATA FROM GOOGLE SHEET ===\n' + sheetCsv + '\n\n';
            }

            if (uploadedCsv) {
                allData += '=== DATA FROM UPLOADED FILE ===\n' + uploadedCsv + '\n\n';
            }

            if (includeMeta && META_ACCESS_TOKEN) {
                console.log(`[Analyser] Fetching Meta Ads data (${metaDatePreset || 'maximum'})...`);
                try {
                    const metaData = await fetchMetaAdsData(metaDatePreset);
                    const metaDataSection = formatMetaDataForAI(metaData);
                    if (metaDataSection) {
                        allData += '=== LIVE META ADS PERFORMANCE DATA ===\n' + metaDataSection + '\n\n';
                    }
                } catch (metaErr) {
                    console.warn('[Analyser] Meta data fetch failed:', metaErr.message);
                    allData += '=== META ADS DATA: Could not fetch — ' + metaErr.message + ' ===\n\n';
                }
            }

            if (allData.length > 200000) {
                allData = allData.slice(0, 200000) + '\n\n[DATA TRUNCATED — showing first 200KB]';
            }

            // Store data for follow-ups
            analyserSessions[sid] = allData;
            dataContext = allData;
            console.log(`[Analyser] Data loaded: ${(allData.length / 1024).toFixed(1)}KB, session=${sid}`);
        } else {
            // Retrieve stored data for follow-ups
            dataContext = analyserSessions[sid] || '';
        }

        // Build OpenAI messages — ALWAYS include data as system context
        const systemMsg = ANALYSER_SYSTEM_PROMPT + (dataContext
            ? `\n\nHere is the user's dataset. ONLY use numbers from this data. Do NOT make up values.\n\n${dataContext}`
            : '');

        let openaiMessages = [{ role: 'system', content: systemMsg }];

        if (isFollowUp) {
            // Add prior conversation turns
            messages.forEach(m => {
                openaiMessages.push({ role: m.role, content: m.content });
            });
        }

        // Add current user message
        openaiMessages.push({ role: 'user', content: prompt });

        console.log(`[Analyser] Sending ${openaiMessages.length} messages to GPT-4o (system: ${(systemMsg.length / 1024).toFixed(1)}KB)...`);

        const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
            model: 'gpt-5.4',
            max_completion_tokens: 8000,
            messages: openaiMessages,
        });

        const report = completion.choices[0].message.content;
        console.log(`[Analyser] Response generated (${report.length} chars)`);

        // Build conversation history (without data, just user/assistant turns)
        const updatedHistory = isFollowUp
            ? [...messages, { role: 'user', content: prompt }, { role: 'assistant', content: report }]
            : [{ role: 'user', content: prompt }, { role: 'assistant', content: report }];

        res.json({ report, history: updatedHistory, sessionId: sid, summary: 'Analysis complete' });
    } catch (err) {
        console.error('[Analyser] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// METABASE PROXY — Creative Metrics
// =============================================================================

app.post('/api/metabase/creative-metrics', async (req, res) => {
    try {
        const { dateFrom, dateTo, campaignNames } = req.body;

        if (!dateFrom || !dateTo) {
            return res.status(400).json({ success: false, error: 'dateFrom and dateTo are required' });
        }
        if (!Array.isArray(campaignNames) || campaignNames.length === 0) {
            return res.status(400).json({ success: false, error: 'campaignNames must be a non-empty array' });
        }

        // Sanitize date strings (YYYY-MM-DD only)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
            return res.status(400).json({ success: false, error: 'dateFrom and dateTo must be in YYYY-MM-DD format' });
        }

        // Sanitize campaign names — only allow alphanumeric, hyphens, underscores, spaces
        const safeNameRegex = /^[a-zA-Z0-9\-_ ]+$/;
        for (const name of campaignNames) {
            if (typeof name !== 'string' || !safeNameRegex.test(name)) {
                return res.status(400).json({ success: false, error: `Invalid campaign name: "${name}". Only alphanumeric, hyphens, underscores, and spaces are allowed.` });
            }
        }

        const campaignNamesSQL = campaignNames.map(n => `'${n}'`).join(',');

        // FIXED: ID-based join via SPLIT_PART(tracker_name, ':', 2)
        const sql = `
WITH meta_attributed AS (
  SELECT DISTINCT
    SPLIT_PART(uad.tracker_name, ':', 2) AS meta_campaign_id,
    uad.tracker_campaign_name AS campaign_name,
    LOWER(TRIM(uad.tracker_sub_campaign_name)) AS adset_name,
    regexp_replace(uad.creative, ':.*$', '', 'g') AS tracker_name,
    uad.user_id,
    u.priority,
    DATE(u.created_at) AS signup_date
  FROM user_additional_details uad
  INNER JOIN users u ON u.id = uad.user_id
  WHERE (uad.network ILIKE '%facebook%' OR uad.network ILIKE '%instagram%' OR uad.network = 'Facebook')
    AND SPLIT_PART(uad.tracker_name, ':', 2) != ''
    AND SPLIT_PART(uad.tracker_name, ':', 2) IS NOT NULL
    AND u.referred_by IS NULL
    AND DATE(u.created_at) >= '${dateFrom}'
    AND DATE(u.created_at) <= '${dateTo}'
    AND uad.tracker_campaign_name IN (${campaignNamesSQL})
),
first_payments AS (
  SELECT
    user_id, min(payment_date) as payment_date,
    sum(case when rt = 1 then amount else null end) as amount,
    sum(case when rt > 1 then amount else null end) as repeat_amount,
    count(case when rt > 1 then amount else null end) as repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 6 then amount else null end) as d6_window_amount,
    count(case when date(payment_date) - date(created_at) <= 6 then amount else null end) as d6_window_con,
    sum(case when date(payment_date) - date(created_at) <= 6 then amount else null end) as d6_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 6 then amount else null end) as d6_repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 15 then amount else null end) as d15_window_amount,
    count(case when date(payment_date) - date(created_at) <= 15 then amount else null end) as d15_window_con,
    sum(case when date(payment_date) - date(created_at) <= 15 then amount else null end) as d15_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 15 then amount else null end) as d15_repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 30 then amount else null end) as d30_window_amount,
    count(case when date(payment_date) - date(created_at) <= 30 then amount else null end) as d30_window_con,
    sum(case when date(payment_date) - date(created_at) <= 30 then amount else null end) as d30_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 30 then amount else null end) as d30_repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 60 then amount else null end) as d60_window_amount,
    count(case when date(payment_date) - date(created_at) <= 60 then amount else null end) as d60_window_con,
    sum(case when date(payment_date) - date(created_at) <= 60 then amount else null end) as d60_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 60 then amount else null end) as d60_repeat_con,
    sum(amount) as overall_amt,
    count(user_id) as overall_con
  FROM (
    SELECT user_id, payment_date, amount, created_at,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY payment_date) AS rt
    FROM user_transaction_history uth
    LEFT JOIN users u ON u.id = uth.user_id
    WHERE status = 'CHARGED' AND amount > 50
  ) sub
  GROUP BY 1
),
trial AS (
  SELECT user_id, trial_date FROM (
    SELECT user_id, payment_date AS trial_date, plan_id,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY payment_date DESC) AS rk
    FROM user_transaction_history
    WHERE (plan_id IN ('plan_000','plan_000_plus','plan_000_super') OR plan_id ILIKE '%trial%')
      AND status = 'CHARGED'
  ) sub WHERE rk = 1
),
signup_metrics AS (
  SELECT
    ma.signup_date AS event_date,
    ma.campaign_name AS tracker_campaign_name,
    ma.tracker_name,
    ma.meta_campaign_id,
    COUNT(DISTINCT ma.user_id) AS total_signup,
    COUNT(DISTINCT CASE WHEN ma.priority = 'PAYMENT-P0' THEN ma.user_id END) AS p0_signup,
    COUNT(DISTINCT CASE WHEN ma.priority = 'PAYMENT-P1' THEN ma.user_id END) AS p1_signup,
    COUNT(DISTINCT t.user_id) AS total_trial,
    COUNT(DISTINCT CASE WHEN DATE(fp.payment_date) = ma.signup_date THEN fp.user_id END) AS d0,
    SUM(CASE WHEN DATE(fp.payment_date) = ma.signup_date THEN fp.amount ELSE 0 END) AS d0_revenue,
    COUNT(DISTINCT CASE WHEN DATE(fp.payment_date) <= ma.signup_date + INTERVAL '6 day' THEN fp.user_id END) AS d6,
    SUM(CASE WHEN DATE(fp.payment_date) <= ma.signup_date + INTERVAL '6 day' THEN fp.amount ELSE 0 END) AS d6_revenue,
    COUNT(DISTINCT fp.user_id) AS new_converted_user,
    SUM(fp.amount) AS new_user_rev,
    SUM(fp.overall_amt) AS overall_revenue,
    COUNT(DISTINCT CASE WHEN DATE(trial_date) = DATE(ma.signup_date) THEN t.user_id END) AS d0_trial,
    SUM(d6_window_con) AS d6_overall_con,
    SUM(d6_window_amount) AS d6_overall_revenue,
    SUM(d15_window_con) AS d15_overall_con,
    SUM(d15_window_amount) AS d15_overall_revenue,
    SUM(d30_window_con) AS d30_overall_con,
    SUM(d30_window_amount) AS d30_overall_revenue,
    SUM(d60_window_con) AS d60_overall_con,
    SUM(d60_window_amount) AS d60_overall_revenue
  FROM meta_attributed ma
  LEFT JOIN first_payments fp ON ma.user_id = fp.user_id
  LEFT JOIN trial t ON ma.user_id = t.user_id
  GROUP BY 1,2,3,4
)
SELECT
  sm.tracker_name,
  sm.tracker_campaign_name AS campaign_name,
  sm.meta_campaign_id,
  SUM(sm.total_signup) AS signups,
  SUM(sm.p0_signup) AS p0_signup,
  SUM(sm.p1_signup) AS p1_signup,
  SUM(sm.total_trial) AS total_trial,
  SUM(sm.d0_trial) AS d0_trial,
  SUM(sm.d0) AS d0,
  SUM(sm.d0_revenue) AS d0_revenue,
  SUM(sm.d6) AS d6,
  SUM(sm.d6_revenue) AS d6_revenue,
  SUM(sm.new_converted_user) AS new_converted_user,
  SUM(sm.new_user_rev) AS new_user_rev,
  SUM(sm.overall_revenue) AS overall_revenue,
  SUM(sm.d6_overall_con) AS d6_overall_con,
  SUM(sm.d6_overall_revenue) AS d6_overall_revenue
FROM signup_metrics sm
GROUP BY 1,2,3
ORDER BY SUM(sm.total_signup) DESC`;

        const metabaseRes = await fetch(`${METABASE_URL}/api/dataset`, {
            method: 'POST',
            headers: {
                'X-Metabase-Session': METABASE_SESSION_TOKEN,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                database: 2,
                type: 'native',
                native: { query: sql },
            }),
        });

        if (!metabaseRes.ok) {
            const errText = await metabaseRes.text();
            return res.status(metabaseRes.status).json({ success: false, error: `Metabase API error: ${errText}` });
        }

        const result = await metabaseRes.json();
        const columns = result.data.cols.map(c => c.name);
        const rows = result.data.rows.map(row => {
            const obj = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            return obj;
        });

        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Metabase creative-metrics error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =============================================================================
// DAILY ALERT EMAILS (9 AM IST)
// =============================================================================

const nodemailer = require('nodemailer');
const cron = require('node-cron');

const ALERT_EMAIL_FROM = 'kabir.agarwal@univest.in';
const ALERT_EMAIL_APP_PASSWORD = 'foyg aeus rjzw jelo';
const ALERT_RECIPIENTS = [
    'mohit.mandal@univest.in',
    'sumit.kumar@univest.in',
    'ripal.vachher@univest.in',
    'yash.agarwal@univest.in'
];

const ALERT_SHEET_ID = '15cUn1ykWCttlk4G1y2SvT2yKoceRqsHRYJEnWeqzEIk';
const ALERT_SHEET_NAME = 'Creative Performance Tracker-Auto';

const alertTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: ALERT_EMAIL_FROM, pass: ALERT_EMAIL_APP_PASSWORD }
});

// Fetch sheet data via Google Visualization API (JSON)
async function fetchSheetForAlerts() {
    const url = `https://docs.google.com/spreadsheets/d/${ALERT_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(ALERT_SHEET_NAME)}`;
    const resp = await fetch(url);
    const text = await resp.text();
    const jsonStr = text.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '');
    const json = JSON.parse(jsonStr);
    const headers = json.table.cols.map(c => (c.label || '').trim());
    return json.table.rows.map(row => {
        const obj = {};
        row.c.forEach((cell, i) => {
            if (headers[i]) obj[headers[i]] = cell ? (cell.v != null ? cell.v : '') : '';
        });
        return obj;
    });
}

function parseAlertNum(v) {
    if (v == null || v === '' || v === '-') return 0;
    if (typeof v === 'number') return v;
    return parseFloat(String(v).replace(/[₹,%\s]/g, '')) || 0;
}

function parseAlertPercent(v) {
    if (v == null || v === '' || v === '-') return 0;
    if (typeof v === 'number') return v > 1 ? v : v * 100; // 0.28 → 28
    const n = parseFloat(String(v).replace(/[%\s]/g, ''));
    return n > 1 ? n : n * 100;
}

function parseAlertDate(str) {
    if (!str) return 0;
    if (str instanceof Date) return str.getTime();
    if (typeof str === 'string') {
        const parts = str.split('/');
        if (parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
        return new Date(str).getTime() || 0;
    }
    return 0;
}

function classifyServerAlerts(rows) {
    const now = Date.now();
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;

    // Normalize rows to creative objects
    const creatives = rows
        .filter(r => {
            const name = r['Creative Name'] || '';
            const live = r['Live?'] || '';
            const spent = parseAlertNum(r['Spent (15k min)']);
            return name.startsWith('FB_') && live === 'Live' && spent >= 15000;
        })
        .map(r => {
            const goLive = parseAlertDate(r['Date - Go Live']);
            const matured = goLive && (now - goLive) >= fourteenDays;
            const spent = parseAlertNum(r['Spent (15k min)']);
            const signupCost = spent / (parseAlertNum(r['Signups']) || 1);
            const d0TrialCost = spent / (parseAlertNum(r['D0_Trials']) || 1);
            const d6CAC = spent / (parseAlertNum(r['D6']) || 1);
            const d6ROAS = parseAlertPercent(r['D6 ROAS (overall)']);
            const d6CACMatured = parseAlertNum(r['D6 CAC matured']);
            const d6ROASMatured = parseAlertPercent(r['D6 ROAS overall (matured)']);

            // Pick metrics based on maturity
            const effectiveD6CAC = matured ? (d6CACMatured || d6CAC) : d6CAC;
            const effectiveD6ROAS = matured ? (d6ROASMatured || d6ROAS) : d6ROAS;

            return {
                name: r['Creative Name'],
                spent, signupCost, d0TrialCost,
                d6CAC: effectiveD6CAC,
                d6ROAS: effectiveD6ROAS,
                matured,
                signups: parseAlertNum(r['Signups']),
                d0Trials: parseAlertNum(r['D0_Trials']),
                d6: parseAlertNum(r['D6']),
                d6Revenue: parseAlertNum(r['D6 revenue(overall)']),
                overallROAS: parseAlertPercent(r['Overall ROAS']),
            };
        });

    const redAlerts = creatives.filter(d => {
        if (d.d6ROAS > 28) return false;
        let breaches = 0;
        if (d.signupCost > 1000) breaches++;
        if (d.d0TrialCost > 3500) breaches++;
        if (d.d6CAC > 15000) breaches++;
        return breaches >= 2;
    });

    const greenAlerts = creatives.filter(d => {
        if (d.d6ROAS > 28) return true;
        let hits = 0;
        if (d.signupCost > 0 && d.signupCost < 500) hits++;
        if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) hits++;
        if (d.d6CAC > 0 && d.d6CAC < 12000) hits++;
        return hits >= 2;
    });

    return { redAlerts, greenAlerts };
}

function formatINRServer(v) {
    if (!v || v === Infinity) return '-';
    return '₹' + Math.round(v).toLocaleString('en-IN');
}

function buildAlertEmailHTML(redAlerts, greenAlerts) {
    const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const redRows = redAlerts.map(d => {
        const reasons = [];
        if (d.signupCost > 1000) reasons.push('Signup Cost > ₹1K');
        if (d.d0TrialCost > 3500) reasons.push('D0 Trial > ₹3.5K');
        if (d.d6CAC > 15000) reasons.push('D6 CAC > ₹15K');
        return `<tr style="border-bottom:1px solid #333;">
            <td style="padding:10px;color:#ff4d4d;font-weight:600;">${d.name}</td>
            <td style="padding:10px;">${formatINRServer(d.spent)}</td>
            <td style="padding:10px;">${formatINRServer(d.signupCost)}</td>
            <td style="padding:10px;">${formatINRServer(d.d0TrialCost)}</td>
            <td style="padding:10px;">${formatINRServer(d.d6CAC)}</td>
            <td style="padding:10px;">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</td>
            <td style="padding:10px;color:#ff4d4d;">${reasons.join(', ')}</td>
        </tr>`;
    }).join('');

    const greenRows = greenAlerts.map(d => {
        const reasons = [];
        if (d.d6ROAS > 28) reasons.push('D6 ROAS > 28%');
        if (d.signupCost > 0 && d.signupCost < 500) reasons.push('Signup Cost < ₹500');
        if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) reasons.push('D0 Trial < ₹2.5K');
        if (d.d6CAC > 0 && d.d6CAC < 12000) reasons.push('D6 CAC < ₹12K');
        return `<tr style="border-bottom:1px solid #333;">
            <td style="padding:10px;color:#00c853;font-weight:600;">${d.name}</td>
            <td style="padding:10px;">${formatINRServer(d.spent)}</td>
            <td style="padding:10px;">${formatINRServer(d.signupCost)}</td>
            <td style="padding:10px;">${formatINRServer(d.d0TrialCost)}</td>
            <td style="padding:10px;">${formatINRServer(d.d6CAC)}</td>
            <td style="padding:10px;">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</td>
            <td style="padding:10px;color:#00c853;">${reasons.join(', ')}</td>
        </tr>`;
    }).join('');

    const tableHeader = `<tr style="background:#1a1a2e;border-bottom:2px solid #444;">
        <th style="padding:10px;text-align:left;">Creative</th>
        <th style="padding:10px;text-align:left;">Spend</th>
        <th style="padding:10px;text-align:left;">Signup Cost</th>
        <th style="padding:10px;text-align:left;">D0 Trial Cost</th>
        <th style="padding:10px;text-align:left;">D6 CAC</th>
        <th style="padding:10px;text-align:left;">D6 ROAS</th>
        <th style="padding:10px;text-align:left;">Flags</th>
    </tr>`;

    return `
    <div style="font-family:'Inter',Arial,sans-serif;background:#08080d;color:#e0e0e0;padding:24px;max-width:900px;margin:0 auto;">
        <h1 style="color:#fff;font-size:22px;margin-bottom:4px;">Creative Performance Alerts</h1>
        <p style="color:#888;font-size:13px;margin-bottom:24px;">${date} • Live Creatives Only</p>

        <div style="margin-bottom:32px;">
            <h2 style="color:#ff4d4d;font-size:16px;margin-bottom:12px;">⚠ Red Alerts (${redAlerts.length})</h2>
            ${redAlerts.length ? `<table style="width:100%;border-collapse:collapse;font-size:13px;background:#111;">${tableHeader}${redRows}</table>` : '<p style="color:#666;font-size:13px;">No red alerts — all creatives within benchmarks.</p>'}
        </div>

        <div style="margin-bottom:32px;">
            <h2 style="color:#00c853;font-size:16px;margin-bottom:12px;">✅ Green Alerts (${greenAlerts.length})</h2>
            ${greenAlerts.length ? `<table style="width:100%;border-collapse:collapse;font-size:13px;background:#111;">${tableHeader}${greenRows}</table>` : '<p style="color:#666;font-size:13px;">No green alerts found.</p>'}
        </div>

        <p style="color:#555;font-size:11px;border-top:1px solid #333;padding-top:12px;margin-top:24px;">
            Auto-generated by Creative Portal • <a href="https://kabiragarwal-77777.github.io/creative-portal/" style="color:#6c63ff;">Open Dashboard</a>
        </p>
    </div>`;
}

async function sendAlertEmails() {
    console.log('[Alert Cron] Fetching sheet data...');
    try {
        const rows = await fetchSheetForAlerts();
        console.log(`[Alert Cron] Fetched ${rows.length} rows`);

        const { redAlerts, greenAlerts } = classifyServerAlerts(rows);
        console.log(`[Alert Cron] Red: ${redAlerts.length}, Green: ${greenAlerts.length}`);

        if (redAlerts.length === 0 && greenAlerts.length === 0) {
            console.log('[Alert Cron] No alerts to send');
            return { sent: false, reason: 'No alerts' };
        }

        const html = buildAlertEmailHTML(redAlerts, greenAlerts);
        const subject = `Creative Alerts: ${redAlerts.length} Red, ${greenAlerts.length} Green — ${new Date().toLocaleDateString('en-IN')}`;

        await alertTransporter.sendMail({
            from: `"Creative Portal" <${ALERT_EMAIL_FROM}>`,
            to: ALERT_RECIPIENTS.join(', '),
            subject,
            html
        });

        console.log(`[Alert Cron] Email sent to ${ALERT_RECIPIENTS.length} recipients`);
        return { sent: true, red: redAlerts.length, green: greenAlerts.length };
    } catch (err) {
        console.error('[Alert Cron] Error:', err.message);
        return { sent: false, error: err.message };
    }
}

// Schedule: 9:00 AM IST every day (IST = UTC+5:30, so 3:30 AM UTC)
cron.schedule('30 3 * * *', () => {
    console.log('[Alert Cron] Triggered at', new Date().toISOString());
    sendAlertEmails();
});

// Manual trigger endpoint
app.post('/api/send-alerts', async (req, res) => {
    const result = await sendAlertEmails();
    res.json(result);
});

app.get('/api/send-alerts', async (req, res) => {
    const result = await sendAlertEmails();
    res.json(result);
});

console.log('[Alert Cron] Scheduled daily at 9:00 AM IST');

// =============================================================================
// AD INSIGHTS & FUNNEL ENDPOINTS
// =============================================================================

// In-memory cache for heavy API calls (30-min TTL default)
const _apiCache = {};
function getCached(key, maxAgeMs = 1800000) {
    const entry = _apiCache[key];
    if (entry && Date.now() - entry.ts < maxAgeMs) return entry.data;
    return null;
}
function getCacheAge(key) {
    const entry = _apiCache[key];
    return entry ? Date.now() - entry.ts : null;
}
function setCache(key, data) { _apiCache[key] = { data, ts: Date.now() }; }

function extractMetaInstallMetrics(row) {
    const actions = row.actions || [];
    const costPerAction = row.cost_per_action_type || [];
    const installs = actions.find(a => a.action_type === 'mobile_app_install');
    const cpiObj = costPerAction.find(a => a.action_type === 'mobile_app_install');
    return {
        installs: installs ? parseInt(installs.value || 0, 10) : 0,
        cpi: cpiObj ? parseFloat(cpiObj.value || 0) : null,
    };
}

function deriveMetaRollupMetrics(bucket) {
    const spend = Number(bucket.spend || 0);
    const impressions = Number(bucket.impressions || 0);
    const clicks = Number(bucket.clicks || 0);
    const reach = Number(bucket.reach || 0);
    const installs = Number(bucket.installs || 0);
    return {
        spend,
        impressions,
        clicks,
        reach,
        installs,
        cpm: impressions > 0 ? (spend * 1000) / impressions : 0,
        ctr: impressions > 0 ? (clicks * 100) / impressions : 0,
        cpc: clicks > 0 ? spend / clicks : 0,
        cpi: installs > 0 ? spend / installs : null,
        frequency: reach > 0 ? impressions / reach : 0,
    };
}

function aggregateMetaBreakdown(rows, getKey, formatRow) {
    const buckets = new Map();
    let totalSpend = 0;

    rows.forEach(row => {
        const key = getKey(row);
        if (!key) return;
        const current = buckets.get(key) || {
            spend: 0,
            impressions: 0,
            clicks: 0,
            reach: 0,
            installs: 0,
        };
        const { installs } = extractMetaInstallMetrics(row);
        current.spend += parseFloat(row.spend || 0);
        current.impressions += parseInt(row.impressions || 0, 10);
        current.clicks += parseInt(row.clicks || 0, 10);
        current.reach += parseInt(row.reach || 0, 10);
        current.installs += installs;
        buckets.set(key, current);
        totalSpend += parseFloat(row.spend || 0);
    });

    return Array.from(buckets.entries())
        .map(([key, bucket]) => {
            const metrics = deriveMetaRollupMetrics(bucket);
            const spendSharePct = totalSpend > 0 ? (metrics.spend / totalSpend) * 100 : 0;
            return formatRow(key, bucket, metrics, spendSharePct);
        })
        .sort((a, b) => (b.spend || 0) - (a.spend || 0));
}

function normalizeMetaDevicePlatform(value) {
    const raw = String(value || '').toLowerCase();
    if (!raw) return '';
    if (raw.includes('iphone') || raw.includes('ipad') || raw.includes('ipod') || raw.includes('ios')) return 'mobile_ios';
    if (raw.includes('android')) return 'mobile_android';
    if (raw.includes('desktop') || raw.includes('computer')) return 'desktop';
    if (raw.includes('mobile')) return 'mobile_other';
    return raw.replace(/[^a-z0-9]+/g, '_');
}

function parseMetaHourlyBucket(value) {
    const raw = String(value || '');
    const match = raw.match(/^(\d{2}):/);
    return match ? parseInt(match[1], 10) : null;
}

function getMetaDayOfWeek(dateStr) {
    if (!dateStr) return '';
    const date = new Date(`${dateStr}T00:00:00+05:30`);
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    return days[date.getUTCDay()] || '';
}

async function fetchMetaInsightsRows({
    fields,
    level = 'ad',
    timeRange,
    timeIncrement = 1,
    breakdowns = [],
    limit = 500,
    logLabel = 'meta-insights',
}) {
    const allRows = [];
    let pageCount = 0;
    let paginationBroke = false;
    const params = metaParams({
        fields,
        level,
        time_increment: timeIncrement,
        time_range: JSON.stringify(timeRange),
        limit,
        ...(breakdowns.length ? { breakdowns: breakdowns.join(',') } : {}),
    });

    let nextUrl = `${META_API_BASE}/${META_AD_ACCOUNT_ID}/insights?${new URLSearchParams(params).toString()}`;
    while (nextUrl) {
        pageCount++;
        console.log(`[${logLabel}] Fetching page ${pageCount}...${allRows.length ? ' (' + allRows.length + ' rows so far)' : ''}`);
        let response;
        let lastFetchErr = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                response = await fetch(nextUrl, { signal: AbortSignal.timeout(30000) });
                lastFetchErr = null;
                break;
            } catch (fetchErr) {
                lastFetchErr = fetchErr;
                const code = fetchErr && fetchErr.cause && fetchErr.cause.code;
                const isTransient = code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT';
                if (!isTransient || attempt === 3) break;
                console.warn(`[${logLabel}] Page ${pageCount} fetch attempt ${attempt} failed (${code || fetchErr.message}). Retrying...`);
                await new Promise(r => setTimeout(r, attempt * 1200));
            }
        }
        if (!response) throw lastFetchErr || new Error(`Meta insights request failed on page ${pageCount}`);

        const data = await response.json();
        if (data.error) {
            if (pageCount === 1) throw new Error(data.error.message || 'Meta insights error');
            console.error(`[${logLabel}] Pagination error on page ${pageCount}:`, data.error.message || data.error);
            paginationBroke = true;
            break;
        }

        if (data.data) allRows.push(...data.data);
        if (data.paging && data.paging.next) {
            const sep = data.paging.next.includes('?') ? '&' : '?';
            nextUrl = data.paging.next + sep + 'appsecret_proof=' + encodeURIComponent(META_APP_SECRET_PROOF);
        } else {
            nextUrl = null;
        }
    }

    console.log(`[${logLabel}] Done. ${pageCount} pages, ${allRows.length} total rows.${paginationBroke ? ' WARNING: pagination broke - data may be truncated!' : ''}`);
    return { rows: allRows, pageCount, paginationBroke };
}

// Force clear all caches
app.post('/api/cache/clear', (req, res) => {
    Object.keys(_apiCache).forEach(k => delete _apiCache[k]);
    // Delete disk caches
    const ciDir = path.join(__dirname, '..', 'creative-intelligence');
    try {
        fs.readdirSync(ciDir).filter(f => f.startsWith('insights-cache-') || f.startsWith('funnel-cache-') || f.startsWith('apex-breakdowns-cache-')).forEach(f => {
            try { fs.unlinkSync(path.join(ciDir, f)); } catch(e) {}
        });
    } catch(e) {}
    console.log('[Cache] All caches cleared');
    res.json({ success: true, message: 'All caches cleared' });
});

app.post('/api/meta/ad-insights-daily', async (req, res) => {
    try {
        const { dateFrom, dateTo, noCache } = req.body;
        if (!dateFrom || !dateTo) {
            return res.status(400).json({ success: false, error: 'dateFrom and dateTo are required' });
        }

        // Check memory cache, then disk cache
        const cacheKey = `insights_${dateFrom}_${dateTo}`;
        const diskFile = path.join(__dirname, '..', 'creative-intelligence', `insights-cache-${dateFrom}-${dateTo}.json`);
        let diskCache = null;
        let diskAgeMin = null;
        try {
            if (fs.existsSync(diskFile)) {
                diskCache = JSON.parse(fs.readFileSync(diskFile, 'utf-8'));
                diskAgeMin = diskCache.ts ? Math.round((Date.now() - diskCache.ts) / 60000) : null;
            }
        } catch(e) {}
        if (!noCache) {
            const cached = getCached(cacheKey);
            if (cached) {
                console.log(`[ad-insights] Serving from memory (${cached.length} rows)`);
                return res.json({ success: true, data: cached, total: cached.length, cached: true });
            }
            if (diskCache && diskCache.data && diskCache.data.length > 0 && diskCache.ts && Date.now() - diskCache.ts < 6 * 3600000) {
                console.log(`[ad-insights] Serving from disk (${diskCache.data.length} rows, ${diskAgeMin}min old)`);
                setCache(cacheKey, diskCache.data);
                return res.json({
                    success: true,
                    data: diskCache.data,
                    total: diskCache.data.length,
                    cached: true,
                    stale: (Date.now() - diskCache.ts) >= 2 * 3600000,
                    data_age_min: diskAgeMin,
                });
            }
        }

        const allRows = [];
        let url = `${META_API_BASE}/${META_AD_ACCOUNT_ID}/insights`;
        let params = metaParams({
            fields: 'campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,spend,impressions,clicks,cpm,ctr,cpc,actions,cost_per_action_type,video_thruplay_watched_actions,video_p25_watched_actions,video_p100_watched_actions',
            level: 'ad',
            time_increment: 1,
            time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
            // No status filter — include all ads that had delivery in the date range
            limit: 500,
        });

        // Paginate through all results
        let pageCount = 0;
        let paginationBroke = false;
        let nextUrl = `${url}?${new URLSearchParams(params).toString()}`;
        while (nextUrl) {
            pageCount++;
            console.log(`[ad-insights] Fetching page ${pageCount}...${allRows.length ? ' (' + allRows.length + ' rows so far)' : ''}`);
            let response;
            let lastFetchErr = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    response = await fetch(nextUrl, { signal: AbortSignal.timeout(30000) });
                    lastFetchErr = null;
                    break;
                } catch (fetchErr) {
                    lastFetchErr = fetchErr;
                    const code = fetchErr && fetchErr.cause && fetchErr.cause.code;
                    const isTransient = code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT';
                    if (!isTransient || attempt === 3) break;
                    console.warn(`[ad-insights] Page ${pageCount} fetch attempt ${attempt} failed (${code || fetchErr.message}). Retrying...`);
                    await new Promise(r => setTimeout(r, attempt * 1200));
                }
            }
            if (!response) throw lastFetchErr || new Error(`Meta insights request failed on page ${pageCount}`);
            const data = await response.json();

            if (data.error) {
                if (pageCount === 1) return res.status(400).json({ success: false, error: data.error.message });
                console.error('[ad-insights] Pagination error on page', pageCount, ':', data.error.message || data.error);
                paginationBroke = true;
                break;
            }

            if (data.data) allRows.push(...data.data);

            // Meta Insights API: check for paging.next cursor URL
            // Append appsecret_proof since Meta doesn't include it in pagination URLs
            if (data.paging && data.paging.next) {
                const sep = data.paging.next.includes('?') ? '&' : '?';
                nextUrl = data.paging.next + sep + 'appsecret_proof=' + encodeURIComponent(META_APP_SECRET_PROOF);
            } else {
                nextUrl = null;
            }
        }
        console.log(`[ad-insights] Done. ${pageCount} pages, ${allRows.length} total rows.${paginationBroke ? ' WARNING: pagination broke — data may be truncated!' : ''}`);

        // If pagination broke, check if disk cache has MORE data — prefer larger dataset
        if (paginationBroke) {
            try {
                if (diskCache && diskCache.data) {
                    const disk = JSON.parse(fs.readFileSync(diskFile, 'utf-8'));
                    if (disk.data && disk.data.length > allRows.length) {
                        console.log(`[ad-insights] Disk cache has ${disk.data.length} rows vs truncated ${allRows.length} — using disk cache.`);
                        setCache(cacheKey, disk.data);
                        const ageMin = disk.ts ? Math.round((Date.now() - disk.ts) / 60000) : 9999;
                        return res.json({ success: true, data: disk.data, total: disk.data.length, cached: true, data_age_min: ageMin, warning: `Meta API truncated at page ${pageCount}. Using cached data (${ageMin}min old, ${disk.data.length} rows).` });
                    }
                }
            } catch (e) { /* proceed with truncated data if disk read fails */ }
        }

        // Flatten actions to extract installs + video metrics
        const rows = allRows.map(row => {
            const actions = row.actions || [];
            const costPerAction = row.cost_per_action_type || [];
            const installs = actions.find(a => a.action_type === 'mobile_app_install');
            const cpiObj = costPerAction.find(a => a.action_type === 'mobile_app_install');
            const thruplay = row.video_thruplay_watched_actions ? parseInt((row.video_thruplay_watched_actions[0] || {}).value || 0) : 0;
            const p25 = row.video_p25_watched_actions ? parseInt((row.video_p25_watched_actions[0] || {}).value || 0) : 0;
            const p100 = row.video_p100_watched_actions ? parseInt((row.video_p100_watched_actions[0] || {}).value || 0) : 0;
            return {
                date_start: row.date_start,
                campaign_name: row.campaign_name,
                campaign_id: row.campaign_id,
                adset_name: row.adset_name,
                adset_id: row.adset_id,
                ad_name: row.ad_name,
                ad_id: row.ad_id,
                spend: parseFloat(row.spend || 0),
                impressions: parseInt(row.impressions || 0),
                clicks: parseInt(row.clicks || 0),
                cpm: parseFloat(row.cpm || 0),
                ctr: parseFloat(row.ctr || 0),
                cpc: parseFloat(row.cpc || 0),
                installs: installs ? parseInt(installs.value) : 0,
                cpi: cpiObj ? parseFloat(cpiObj.value) : null,
                thruplay, p25, p100,
            };
        });

        setCache(cacheKey, rows);

        // Only save to disk if we got a complete dataset (no pagination break)
        // Never overwrite disk cache with fewer rows — prevents poisoning from truncated API responses
        if (!paginationBroke) {
            try {
                let shouldWrite = true;
                if (fs.existsSync(diskFile)) {
                    try {
                        const existing = diskCache;
                        if (existing.data && existing.data.length > rows.length * 1.5) {
                            console.log(`[ad-insights] Disk has ${existing.data.length} rows, new fetch has ${rows.length} — keeping disk (possible partial fetch).`);
                            shouldWrite = false;
                        }
                    } catch (e) { /* corrupted disk cache, overwrite */ }
                }
                if (shouldWrite) {
                    fs.writeFileSync(diskFile, JSON.stringify({ ts: Date.now(), data: rows }));
                    console.log(`[ad-insights] Saved to disk: ${rows.length} rows`);
                }
            } catch(e) {}
        } else {
            console.log(`[ad-insights] Skipping disk write — pagination broke, data is truncated (${rows.length} rows).`);
        }

        res.json({ success: true, data: rows, total: rows.length, truncated: paginationBroke || false });
    } catch (err) {
        // Fallback to disk cache on error — flag with age so frontend knows
        try {
            if (diskCache && diskCache.data && diskCache.data.length > 0) {
                const stale = diskCache;
                const ageMin = stale.ts ? Math.round((Date.now() - stale.ts) / 60000) : 9999;
                console.log(`[ad-insights] Error fallback — disk cache (${stale.data.length} rows, ${ageMin}min old). Error: ${err.message}`);
                setCache(cacheKey, stale.data);
                return res.json({ success: true, data: stale.data, total: stale.data.length, cached: true, stale: true, data_age_min: ageMin, warning: `Data is ${ageMin}min old (Meta API error: ${err.message})` });
            }
        } catch(e2) {}
        console.error('Meta ad-insights-daily error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/meta/apex-breakdowns', async (req, res) => {
    const { dateFrom, dateTo, noCache } = req.body || {};
    if (!dateFrom || !dateTo) {
        return res.status(400).json({ success: false, error: 'dateFrom and dateTo are required' });
    }

    const cacheKey = `apex_breakdowns_${dateFrom}_${dateTo}`;
    const diskFile = path.join(__dirname, '..', 'creative-intelligence', `apex-breakdowns-cache-${dateFrom}-${dateTo}.json`);
    let diskCache = null;
    let diskAgeMin = null;

    try {
        if (fs.existsSync(diskFile)) {
            diskCache = JSON.parse(fs.readFileSync(diskFile, 'utf-8'));
            diskAgeMin = diskCache.ts ? Math.round((Date.now() - diskCache.ts) / 60000) : null;
        }
    } catch (e) {}

    try {
        if (!noCache) {
            const cached = getCached(cacheKey, 6 * 3600000);
            if (cached) {
                console.log(`[apex-breakdowns] Serving from memory`);
                return res.json({ success: true, ...cached, cached: true });
            }
            if (diskCache && diskCache.data && diskCache.ts && Date.now() - diskCache.ts < 6 * 3600000) {
                console.log(`[apex-breakdowns] Serving from disk (${diskAgeMin}min old)`);
                setCache(cacheKey, diskCache.data);
                return res.json({
                    success: true,
                    ...diskCache.data,
                    cached: true,
                    stale: (Date.now() - diskCache.ts) >= 2 * 3600000,
                    data_age_min: diskAgeMin,
                });
            }
        }

        const commonFields = 'spend,impressions,clicks,actions,cost_per_action_type';
        const timeRange = { since: dateFrom, until: dateTo };

        const breakdownJobs = {
            age_gender: fetchMetaInsightsRows({
                fields: commonFields,
                level: 'ad',
                timeRange,
                timeIncrement: 'all_days',
                breakdowns: ['age', 'gender'],
                logLabel: 'apex-breakdowns/age-gender',
            }),
            placement: fetchMetaInsightsRows({
                fields: commonFields,
                level: 'ad',
                timeRange,
                timeIncrement: 'all_days',
                breakdowns: ['publisher_platform', 'platform_position'],
                logLabel: 'apex-breakdowns/placement',
            }),
            device: fetchMetaInsightsRows({
                fields: commonFields,
                level: 'ad',
                timeRange,
                timeIncrement: 'all_days',
                breakdowns: ['impression_device'],
                logLabel: 'apex-breakdowns/device',
            }),
            geography: fetchMetaInsightsRows({
                fields: commonFields,
                level: 'ad',
                timeRange,
                timeIncrement: 'all_days',
                breakdowns: ['region'],
                logLabel: 'apex-breakdowns/geography',
            }),
            hourly: fetchMetaInsightsRows({
                fields: commonFields,
                level: 'ad',
                timeRange,
                breakdowns: ['hourly_stats_aggregated_by_audience_time_zone'],
                timeIncrement: 1,
                logLabel: 'apex-breakdowns/hourly',
            }),
        };

        const settled = await Promise.allSettled(Object.values(breakdownJobs));
        const breakdownResults = {};
        const breakdownErrors = {};
        Object.keys(breakdownJobs).forEach((key, index) => {
            const result = settled[index];
            if (result.status === 'fulfilled') {
                breakdownResults[key] = result.value;
            } else {
                breakdownResults[key] = { rows: [], paginationBroke: false };
                breakdownErrors[key] = result.reason ? result.reason.message : 'Breakdown unavailable';
                console.warn(`[apex-breakdowns] ${key} unavailable: ${breakdownErrors[key]}`);
            }
        });

        const ageGenderResp = breakdownResults.age_gender;
        const placementResp = breakdownResults.placement;
        const deviceResp = breakdownResults.device;
        const geographyResp = breakdownResults.geography;
        const hourlyResp = breakdownResults.hourly;

        const age_gender = aggregateMetaBreakdown(
            ageGenderResp.rows,
            row => {
                const ageBand = row.age || '';
                const gender = String(row.gender || '').toLowerCase() || 'unknown';
                return ageBand ? `${ageBand}__${gender}` : '';
            },
            (key, bucket, metrics, spendSharePct) => {
                const [age_band, gender] = key.split('__');
                return {
                    age_band,
                    gender,
                    spend_7d: metrics.spend,
                    impressions_7d: metrics.impressions,
                    cpm_7d: metrics.cpm,
                    ctr_7d: metrics.ctr,
                    cpc_7d: metrics.cpc,
                    installs_7d: metrics.installs,
                    cpi_7d: metrics.cpi,
                    spend_share_pct: spendSharePct,
                };
            }
        );

        const placement = aggregateMetaBreakdown(
            placementResp.rows,
            row => {
                const platform = String(row.publisher_platform || '').toLowerCase().trim();
                const position = String(row.platform_position || '').toLowerCase().trim();
                return platform && position ? `${platform}_${position}` : '';
            },
            (key, bucket, metrics, spendSharePct) => ({
                placement: key,
                spend_7d: metrics.spend,
                impressions_7d: metrics.impressions,
                cpm_7d: metrics.cpm,
                ctr_7d: metrics.ctr,
                cpc_7d: metrics.cpc,
                installs_7d: metrics.installs,
                cpi_7d: metrics.cpi,
                spend_share_pct: spendSharePct,
            })
        );

        const device = aggregateMetaBreakdown(
            deviceResp.rows,
            row => normalizeMetaDevicePlatform(row.impression_device),
            (key, bucket, metrics, spendSharePct) => ({
                device: key,
                spend_7d: metrics.spend,
                impressions_7d: metrics.impressions,
                ctr_7d: metrics.ctr,
                cpc_7d: metrics.cpc,
                cpi_7d: metrics.cpi,
                installs_7d: metrics.installs,
                spend_share_pct: spendSharePct,
            })
        );

        const geography = aggregateMetaBreakdown(
            geographyResp.rows,
            row => String(row.region || '').trim(),
            (key, bucket, metrics, spendSharePct) => ({
                region: key,
                spend_7d: metrics.spend,
                impressions_7d: metrics.impressions,
                cpm_7d: metrics.cpm,
                ctr_7d: metrics.ctr,
                cpc_7d: metrics.cpc,
                installs_7d: metrics.installs,
                cpi_7d: metrics.cpi,
                spend_share_pct: spendSharePct,
            })
        );

        const hourly = aggregateMetaBreakdown(
            hourlyResp.rows,
            row => {
                const hour = parseMetaHourlyBucket(row.hourly_stats_aggregated_by_audience_time_zone);
                const day = getMetaDayOfWeek(row.date_start);
                return hour == null || !day ? '' : `${day}__${hour}`;
            },
            (key, bucket, metrics) => {
                const [day_of_week, hourRaw] = key.split('__');
                return {
                    day_of_week,
                    hour: parseInt(hourRaw, 10),
                    spend: metrics.spend,
                    impressions: metrics.impressions,
                    clicks: metrics.clicks,
                    installs: metrics.installs,
                    ctr: metrics.ctr,
                    cpc: metrics.cpc,
                    cpi: metrics.cpi,
                };
            }
        ).sort((a, b) => {
            const dayOrder = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
            return (dayOrder.indexOf(a.day_of_week) - dayOrder.indexOf(b.day_of_week)) || (a.hour - b.hour);
        });

        const payload = {
            dateFrom,
            dateTo,
            breakdowns: {
                age_gender,
                placement,
                device,
                geography,
                hourly,
            },
            limitations: [
                'These breakdown tables are Meta delivery breakdowns only.',
                'Canonical D6 revenue and D6 ROAS remain sourced from the existing Metabase funnel path.',
                'Breakdown rows currently surface spend, clicks, installs, CPI, CTR, CPC, CPM, and impression volume where available.',
            ],
            unavailable_breakdowns: breakdownErrors,
            freshness: {
                generated_at: new Date().toISOString(),
                truncated: Boolean(
                    ageGenderResp.paginationBroke ||
                    placementResp.paginationBroke ||
                    deviceResp.paginationBroke ||
                    geographyResp.paginationBroke ||
                    hourlyResp.paginationBroke
                ),
            },
        };

        setCache(cacheKey, payload);
        try {
            fs.writeFileSync(diskFile, JSON.stringify({ ts: Date.now(), data: payload }));
        } catch (e) {}

        return res.json({ success: true, ...payload });
    } catch (err) {
        try {
            if (diskCache && diskCache.data) {
                const ageMin = diskCache.ts ? Math.round((Date.now() - diskCache.ts) / 60000) : 9999;
                setCache(cacheKey, diskCache.data);
                return res.json({
                    success: true,
                    ...diskCache.data,
                    cached: true,
                    stale: true,
                    data_age_min: ageMin,
                    warning: `Using cached breakdown data (${ageMin}min old) due to Meta API error: ${err.message}`,
                });
            }
        } catch (e) {}
        console.error('Meta apex-breakdowns error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/meta/ads-status — returns all ads with live/paused status + campaign name
// Cached in-memory (1 hour) + on disk (survives restarts)
const ADS_STATUS_FILE = path.join(__dirname, '..', 'creative-intelligence', 'ads-status-cache.json');
const ADS_STATUS_CACHE_KEY = 'ads_status_v2';
const ADS_STATUS_CACHE_VERSION = 2;

function budgetMinorToRupees(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n / 100 : null;
}

function normalizeAdsStatusRow(ad) {
    const campaign = ad && ad.campaign ? ad.campaign : {};
    const adset = ad && ad.adset ? ad.adset : {};
    const campaignDailyBudget = budgetMinorToRupees(campaign.daily_budget);
    const campaignLifetimeBudget = budgetMinorToRupees(campaign.lifetime_budget);
    const adsetDailyBudget = budgetMinorToRupees(adset.daily_budget);
    const adsetLifetimeBudget = budgetMinorToRupees(adset.lifetime_budget);
    const hasCampaignBudget = campaignDailyBudget != null || campaignLifetimeBudget != null;
    const hasAdsetBudget = adsetDailyBudget != null || adsetLifetimeBudget != null;

    let budgetLevel = 'unknown';
    let budgetType = 'unknown';
    let budgetEntityType = '';
    let budgetEntityId = '';
    let budgetEntityName = '';
    let budgetCurrentDailyBudget = null;

    if (hasCampaignBudget && hasAdsetBudget) {
        budgetLevel = 'unknown';
        budgetType = 'ambiguous';
    } else if (hasCampaignBudget) {
        budgetLevel = 'campaign';
        budgetType = campaignDailyBudget != null ? 'daily' : 'lifetime';
        budgetEntityType = 'campaign';
        budgetEntityId = ad.campaign_id || campaign.id || '';
        budgetEntityName = campaign.name || '';
        budgetCurrentDailyBudget = campaignDailyBudget;
    } else if (hasAdsetBudget) {
        budgetLevel = 'adset';
        budgetType = adsetDailyBudget != null ? 'daily' : 'lifetime';
        budgetEntityType = 'adset';
        budgetEntityId = ad.adset_id || adset.id || '';
        budgetEntityName = adset.name || '';
        budgetCurrentDailyBudget = adsetDailyBudget;
    }

    return {
        ad_id: ad.id,
        ad_name: ad.name,
        status: ad.effective_status || ad.status || 'UNKNOWN',
        raw_status: ad.status || '',
        adset_id: ad.adset_id || adset.id || '',
        adset_name: adset.name || '',
        adset_status: adset.effective_status || 'UNKNOWN',
        campaign_id: ad.campaign_id || campaign.id || '',
        campaign_name: campaign.name || '',
        campaign_status: campaign.effective_status || 'UNKNOWN',
        created_time: ad.created_time,
        campaign_daily_budget: campaignDailyBudget,
        campaign_lifetime_budget: campaignLifetimeBudget,
        adset_daily_budget: adsetDailyBudget,
        adset_lifetime_budget: adsetLifetimeBudget,
        budget_level: budgetLevel,
        budget_type: budgetType,
        budget_entity_type: budgetEntityType,
        budget_entity_id: budgetEntityId,
        budget_entity_name: budgetEntityName,
        budget_current_daily_budget: budgetCurrentDailyBudget
    };
}

function hasRichAdsStatusShape(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return false;
    const sample = rows[0] || {};
    return Object.prototype.hasOwnProperty.call(sample, 'adset_id') &&
        Object.prototype.hasOwnProperty.call(sample, 'campaign_status') &&
        Object.prototype.hasOwnProperty.call(sample, 'budget_level');
}

function readAdsStatusDiskCache() {
    if (!fs.existsSync(ADS_STATUS_FILE)) return null;
    const diskCache = JSON.parse(fs.readFileSync(ADS_STATUS_FILE, 'utf-8'));
    if (!diskCache || diskCache.version !== ADS_STATUS_CACHE_VERSION || !hasRichAdsStatusShape(diskCache.data)) return null;
    return diskCache;
}

app.get('/api/meta/ads-status', async (req, res) => {
    try {
        const forceRefresh = String(req.query.fresh || req.query.forceRefresh || '') === '1';
        // Check in-memory cache (1 hour TTL)
        const cached = forceRefresh ? null : getCached(ADS_STATUS_CACHE_KEY, 3600000);
        if (!forceRefresh && hasRichAdsStatusShape(cached)) {
            console.log(`[ads-status] Serving from memory cache (${cached.length} ads)`);
            return res.json({ success: true, data: cached, total: cached.length, cached: true });
        }

        // Check disk cache (4 hour TTL)
        try {
            const diskCache = readAdsStatusDiskCache();
            if (!forceRefresh && diskCache && diskCache.ts && Date.now() - diskCache.ts < 4 * 3600000) {
                console.log(`[ads-status] Serving from disk cache (${diskCache.data.length} ads, ${Math.round((Date.now() - diskCache.ts) / 60000)}min old)`);
                setCache(ADS_STATUS_CACHE_KEY, diskCache.data);
                return res.json({ success: true, data: diskCache.data, total: diskCache.data.length, cached: true });
            }
        } catch(e) {}

        const allAds = [];
        let nextUrl = `${META_API_BASE}/${META_AD_ACCOUNT_ID}/ads?${new URLSearchParams(metaParams({
            fields: 'id,name,status,effective_status,campaign_id,adset_id,campaign{id,name,effective_status,daily_budget,lifetime_budget},adset{id,name,effective_status,daily_budget,lifetime_budget},created_time',
            limit: 500
        })).toString()}`;

        let pageCount = 0;
        while (nextUrl) {
            pageCount++;
            const response = await fetch(nextUrl);
            const data = await response.json();
            if (data.error) {
                if (pageCount === 1) {
                    // Rate limited — try disk cache as fallback (any age)
                    try {
                        const stale = readAdsStatusDiskCache();
                        if (stale && stale.data && stale.data.length) {
                            console.log(`[ads-status] Rate limited — serving stale disk cache (${stale.data.length} ads)`);
                            setCache(ADS_STATUS_CACHE_KEY, stale.data);
                            return res.json({ success: true, data: stale.data, total: stale.data.length, cached: true, stale: true });
                        }
                    } catch(e) {}
                    return res.status(400).json({ success: false, error: data.error.message });
                }
                break;
            }
            if (data.data) {
                allAds.push(...data.data.map(normalizeAdsStatusRow));
            }
            if (data.paging && data.paging.next) {
                const sep = data.paging.next.includes('?') ? '&' : '?';
                nextUrl = data.paging.next + sep + 'appsecret_proof=' + encodeURIComponent(META_APP_SECRET_PROOF);
            } else {
                nextUrl = null;
            }
        }
        console.log(`[ads-status] Done. ${pageCount} pages, ${allAds.length} ads.`);
        setCache(ADS_STATUS_CACHE_KEY, allAds);
        // Save to disk for restart persistence
        try { fs.writeFileSync(ADS_STATUS_FILE, JSON.stringify({ version: ADS_STATUS_CACHE_VERSION, ts: Date.now(), data: allAds })); } catch(e) {}
        res.json({ success: true, data: allAds, total: allAds.length });
    } catch (err) {
        // Fallback to disk cache on any error
        try {
            const stale = readAdsStatusDiskCache();
            if (stale && stale.data && stale.data.length) {
                console.log(`[ads-status] Error fallback — serving disk cache (${stale.data.length} ads)`);
                return res.json({ success: true, data: stale.data, total: stale.data.length, cached: true, stale: true });
            }
        } catch(e2) {}
        console.error('Meta ads-status error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/metabase/ad-funnel', async (req, res) => {
    try {
        const { dateFrom, dateTo, noCache } = req.body;
        if (!dateFrom || !dateTo) {
            return res.status(400).json({ success: false, error: 'dateFrom and dateTo are required' });
        }

        // Check memory cache, then disk cache
        const funnelCacheKey = `funnel_${dateFrom}_${dateTo}`;
        const funnelDiskFile = path.join(__dirname, '..', 'creative-intelligence', `funnel-cache-${dateFrom}-${dateTo}.json`);
        if (!noCache) {
            const funnelCached = getCached(funnelCacheKey);
            if (funnelCached) {
                console.log(`[ad-funnel] Serving from memory (${funnelCached.length} rows)`);
                return res.json({ success: true, data: funnelCached, total: funnelCached.length, cached: true });
            }
            try {
                if (fs.existsSync(funnelDiskFile)) {
                    const disk = JSON.parse(fs.readFileSync(funnelDiskFile, 'utf-8'));
                    if (disk.ts && Date.now() - disk.ts < 2 * 3600000 && disk.data && disk.data.length > 0) {
                        const ageMin = Math.round((Date.now() - disk.ts) / 60000);
                        console.log(`[ad-funnel] Serving from disk (${disk.data.length} rows, ${ageMin}min old)`);
                        setCache(funnelCacheKey, disk.data);
                        return res.json({ success: true, data: disk.data, total: disk.data.length, cached: true, data_age_min: ageMin });
                    }
                }
            } catch(e) {}
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateFrom) || !dateRegex.test(dateTo)) {
            return res.status(400).json({ success: false, error: 'Dates must be YYYY-MM-DD' });
        }

        // FIXED: ID-based join via SPLIT_PART(tracker_name, ':', 2)
        const sql = `
WITH meta_attributed AS (
  SELECT
    SPLIT_PART(uad.tracker_name, ':', 2) AS meta_campaign_id,
    uad.tracker_campaign_name AS campaign_name,
    LOWER(TRIM(uad.tracker_sub_campaign_name)) AS adset_name,
    regexp_replace(uad.creative, ':.*$', '', 'g') AS tracker_name,
    uad.user_id,
    u.priority,
    DATE(u.created_at) AS signup_date
  FROM user_additional_details uad
  INNER JOIN users u ON u.id = uad.user_id
  WHERE (uad.network ILIKE '%facebook%' OR uad.network ILIKE '%instagram%' OR uad.network = 'Facebook')
    AND SPLIT_PART(uad.tracker_name, ':', 2) != ''
    AND SPLIT_PART(uad.tracker_name, ':', 2) IS NOT NULL
    AND u.referred_by IS NULL
    AND DATE(u.created_at) >= '${dateFrom}'
    AND DATE(u.created_at) <= '${dateTo}'
),
first_payments AS (
  SELECT
    user_id, min(payment_date) as payment_date,
    sum(case when rt = 1 then amount else null end) as amount,
    sum(case when rt > 1 then amount else null end) as repeat_amount,
    count(case when rt > 1 then amount else null end) as repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 6 then amount else null end) as d6_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 6 then amount else null end) as d6_repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 15 then amount else null end) as d15_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 15 then amount else null end) as d15_repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 30 then amount else null end) as d30_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 30 then amount else null end) as d30_repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 60 then amount else null end) as d60_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 60 then amount else null end) as d60_repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 180 then amount else null end) as d180_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 180 then amount else null end) as d180_repeat_con,
    sum(amount) as overall_amt,
    count(user_id) as overall_con
  FROM (
    SELECT user_id, payment_date, amount, created_at,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY payment_date) AS rt
    FROM user_transaction_history uth
    LEFT JOIN users u ON u.id = uth.user_id
    WHERE status = 'CHARGED' AND amount > 50
  ) sub
  GROUP BY 1
),
trial AS (
  SELECT user_id, trial_date FROM (
    SELECT user_id, payment_date AS trial_date, plan_id,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY payment_date DESC) AS rk
    FROM user_transaction_history
    WHERE (plan_id IN ('plan_000','plan_000_plus','plan_000_super') OR plan_id ILIKE '%trial%')
      AND status = 'CHARGED'
  ) sub WHERE rk = 1
),
signup_metrics AS (
  SELECT
    ma.signup_date AS event_date,
    ma.campaign_name AS tracker_campaign_name,
    ma.adset_name AS tracker_sub_campaign_name,
    ma.tracker_name,
    ma.meta_campaign_id,
    COUNT(DISTINCT ma.user_id) AS total_signup,
    COUNT(DISTINCT CASE WHEN ma.priority = 'PAYMENT-P0' THEN ma.user_id END) AS p0_signup,
    COUNT(DISTINCT CASE WHEN ma.priority = 'PAYMENT-P1' THEN ma.user_id END) AS p1_signup,
    COUNT(DISTINCT t.user_id) AS total_trial,
    COUNT(DISTINCT CASE WHEN DATE(fp.payment_date) = ma.signup_date THEN fp.user_id END) AS d0,
    SUM(CASE WHEN DATE(fp.payment_date) = ma.signup_date THEN fp.amount ELSE 0 END) AS d0_revenue,
    COUNT(DISTINCT CASE WHEN DATE(fp.payment_date) <= ma.signup_date + INTERVAL '6 day' THEN fp.user_id END) AS d6,
    SUM(CASE WHEN DATE(fp.payment_date) <= ma.signup_date + INTERVAL '6 day' THEN fp.amount ELSE 0 END) AS d6_revenue,
    COUNT(DISTINCT fp.user_id) AS new_converted_user,
    SUM(fp.amount) AS new_user_rev,
    SUM(fp.overall_amt) AS overall_revenue,
    COUNT(DISTINCT CASE WHEN DATE(trial_date) = DATE(ma.signup_date) THEN t.user_id END) AS d0_trial,
    SUM(d6_repeat_con) AS d6_overall_con,
    SUM(d6_repeat_amount) AS d6_overall_revenue,
    SUM(d15_repeat_con) AS d15_overall_con,
    SUM(d15_repeat_amount) AS d15_overall_revenue,
    SUM(d30_repeat_con) AS d30_overall_con,
    SUM(d30_repeat_amount) AS d30_overall_revenue,
    SUM(d60_repeat_con) AS d60_overall_con,
    SUM(d60_repeat_amount) AS d60_overall_revenue,
    SUM(d180_repeat_con) AS d180_overall_con,
    SUM(d180_repeat_amount) AS d180_overall_revenue
  FROM meta_attributed ma
  LEFT JOIN first_payments fp ON ma.user_id = fp.user_id
  LEFT JOIN trial t ON ma.user_id = t.user_id
  GROUP BY 1,2,3,4,5
)
SELECT
  sm.event_date AS date,
  sm.tracker_campaign_name AS campaign_name,
  sm.tracker_sub_campaign_name AS ad_set_name,
  sm.tracker_name,
  sm.meta_campaign_id,
  SUM(sm.total_signup) AS signups,
  SUM(sm.p0_signup) AS p0_signup,
  SUM(sm.p1_signup) AS p1_signup,
  SUM(sm.total_trial) AS total_trial,
  SUM(sm.d0_trial) AS d0_trial,
  SUM(sm.d0) AS d0,
  SUM(sm.d0_revenue) AS d0_revenue,
  SUM(sm.d6) AS d6,
  SUM(sm.d6_revenue) AS d6_revenue,
  SUM(sm.new_converted_user) AS new_converted_user,
  SUM(sm.new_user_rev) AS new_user_rev,
  SUM(sm.overall_revenue) AS overall_revenue,
  SUM(sm.d6_overall_con) AS d6_overall_con,
  SUM(sm.d6_overall_revenue) AS d6_overall_revenue,
  SUM(sm.d15_overall_con) AS d15_overall_con,
  SUM(sm.d15_overall_revenue) AS d15_overall_revenue,
  SUM(sm.d30_overall_con) AS d30_overall_con,
  SUM(sm.d30_overall_revenue) AS d30_overall_revenue,
  SUM(sm.d60_overall_con) AS d60_overall_con,
  SUM(sm.d60_overall_revenue) AS d60_overall_revenue,
  SUM(sm.d180_overall_con) AS d180_overall_con,
  SUM(sm.d180_overall_revenue) AS d180_overall_revenue
FROM signup_metrics sm
GROUP BY 1,2,3,4,5
ORDER BY SUM(sm.total_signup) DESC`;

        if (!METABASE_SESSION_TOKEN) {
            throw new Error('Metabase session token is missing. Set METABASE_SESSION_TOKEN in uploader/.env and restart the server.');
        }

        console.log('[ad-funnel] Running Metabase query...');
        const metabaseRes = await fetch(`${METABASE_URL}/api/dataset`, {
            method: 'POST',
            headers: {
                'X-Metabase-Session': METABASE_SESSION_TOKEN,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                database: 2,
                type: 'native',
                native: { query: sql },
                constraints: { 'max-results': 100000, 'max-results-bare-rows': 100000 },
            }),
        });

        if (!metabaseRes.ok) {
            const errText = await metabaseRes.text();
            if (metabaseRes.status === 401) {
                throw new Error(`Metabase session expired or is invalid (401): ${errText}`);
            }
            throw new Error(`Metabase API error (${metabaseRes.status}): ${errText}`);
        }

        const result = await metabaseRes.json();
        const columns = result.data.cols.map(c => c.name);
        const rows = result.data.rows.map(row => {
            const obj = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            return obj;
        });

        const truncated = result.data.rows_truncated || false;
        console.log(`[ad-funnel] Done. ${rows.length} rows returned. Truncated: ${truncated}`);
        // Only cache non-empty results
        if (rows.length > 0) {
            setCache(funnelCacheKey, rows);
            try { fs.writeFileSync(funnelDiskFile, JSON.stringify({ ts: Date.now(), data: rows })); } catch(e) {}
        }

        res.json({ success: true, data: rows, total: rows.length, truncated });
    } catch (err) {
        try {
            if (fs.existsSync(funnelDiskFile)) {
                const stale = JSON.parse(fs.readFileSync(funnelDiskFile, 'utf-8'));
                console.log(`[ad-funnel] Error fallback — disk (${stale.data.length} rows)`);
                setCache(funnelCacheKey, stale.data);
                return res.json({
                    success: true,
                    data: stale.data,
                    total: stale.data.length,
                    cached: true,
                    stale: true,
                    warning: err.message,
                });
                }
        } catch(e2) {}
        console.error('Metabase ad-funnel error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/metabase/debug-user-attribution', async (req, res) => {
    try {
        const { signupDate, campaignName, adsetName, trackerName } = req.body || {};
        if (!signupDate || !campaignName || !adsetName || !trackerName) {
            return res.status(400).json({
                success: false,
                error: 'signupDate, campaignName, adsetName, and trackerName are required',
            });
        }

        const safe = (value) => String(value).replace(/'/g, "''");
        const sql = `
WITH exact_attribution AS (
  SELECT
    uad.user_id,
    DATE(u.created_at) AS signup_date,
    u.priority,
    uad.tracker_name AS raw_tracker_name,
    uad.tracker_campaign_name AS campaign_name,
    LOWER(TRIM(uad.tracker_sub_campaign_name)) AS adset_name,
    regexp_replace(uad.creative, ':.*$', '', 'g') AS tracker_name
  FROM user_additional_details uad
  INNER JOIN users u ON u.id = uad.user_id
  WHERE (uad.network ILIKE '%facebook%' OR uad.network ILIKE '%instagram%' OR uad.network = 'Facebook')
    AND u.referred_by IS NULL
    AND DATE(u.created_at) = '${safe(signupDate)}'
    AND uad.tracker_campaign_name = '${safe(campaignName)}'
    AND LOWER(TRIM(uad.tracker_sub_campaign_name)) = LOWER(TRIM('${safe(adsetName)}'))
    AND regexp_replace(uad.creative, ':.*$', '', 'g') = '${safe(trackerName)}'
),
attrib_users AS (
  SELECT
    ea.user_id,
    ea.signup_date,
    MIN(ea.priority) AS priority,
    COUNT(*) AS attribution_rows,
    STRING_AGG(ea.raw_tracker_name, ' | ' ORDER BY ea.raw_tracker_name) AS raw_trackers
  FROM exact_attribution ea
  GROUP BY 1,2
),
payment_events AS (
  SELECT
    uth.user_id,
    uth.payment_date,
    uth.amount,
    ROW_NUMBER() OVER (PARTITION BY uth.user_id ORDER BY uth.payment_date) AS rt
  FROM user_transaction_history uth
  WHERE uth.status = 'CHARGED'
    AND uth.amount > 50
),
user_breakdown AS (
  SELECT
    au.user_id,
    au.signup_date,
    au.priority,
    au.attribution_rows,
    au.raw_trackers,
    COUNT(*) FILTER (WHERE DATE(pe.payment_date) <= au.signup_date + INTERVAL '6 day') AS payments_first_6d,
    COALESCE(SUM(CASE WHEN DATE(pe.payment_date) <= au.signup_date + INTERVAL '6 day' THEN pe.amount ELSE 0 END), 0) AS revenue_first_6d_all_payments,
    COUNT(*) FILTER (WHERE pe.rt = 1 AND DATE(pe.payment_date) <= au.signup_date + INTERVAL '6 day') AS new_payments_first_6d,
    COALESCE(SUM(CASE WHEN pe.rt = 1 AND DATE(pe.payment_date) <= au.signup_date + INTERVAL '6 day' THEN pe.amount ELSE 0 END), 0) AS d6_revenue,
    COUNT(*) FILTER (WHERE pe.rt > 1 AND DATE(pe.payment_date) <= au.signup_date + INTERVAL '6 day') AS repeat_payments_first_6d,
    COALESCE(SUM(CASE WHEN pe.rt > 1 AND DATE(pe.payment_date) <= au.signup_date + INTERVAL '6 day' THEN pe.amount ELSE 0 END), 0) AS d6_repeat_amount,
    STRING_AGG(
      TO_CHAR(pe.payment_date, 'YYYY-MM-DD HH24:MI:SS') || ' | rt=' || pe.rt::text || ' | amount=' || COALESCE(pe.amount, 0)::text,
      ' || '
      ORDER BY pe.payment_date
    ) FILTER (WHERE DATE(pe.payment_date) <= au.signup_date + INTERVAL '6 day') AS payment_trace
  FROM attrib_users au
  LEFT JOIN payment_events pe ON pe.user_id = au.user_id
  GROUP BY 1,2,3,4,5
),
current_formula AS (
  SELECT
    COUNT(DISTINCT au.user_id) AS signups,
    COUNT(DISTINCT CASE WHEN ub.d6_revenue > 0 THEN au.user_id END) AS d6,
    COALESCE(SUM(ub.d6_revenue), 0) AS d6_revenue,
    COALESCE(SUM(ub.repeat_payments_first_6d), 0) AS d6_overall_con,
    COALESCE(SUM(ub.d6_repeat_amount), 0) AS d6_overall_revenue,
    COALESCE(SUM(ub.revenue_first_6d_all_payments), 0) AS total_revenue_first_6d_all_payments,
    COALESCE(SUM(CASE WHEN ub.attribution_rows > 1 THEN 1 ELSE 0 END), 0) AS users_with_duplicate_attribution_rows
  FROM attrib_users au
  LEFT JOIN user_breakdown ub ON ub.user_id = au.user_id
)
SELECT
  'summary' AS row_type,
  NULL::text AS user_id,
  NULL::text AS priority,
  NULL::bigint AS attribution_rows,
  NULL::text AS raw_trackers,
  NULL::bigint AS payments_first_6d,
  NULL::numeric AS revenue_first_6d_all_payments,
  NULL::bigint AS new_payments_first_6d,
  NULL::numeric AS d6_revenue,
  NULL::bigint AS repeat_payments_first_6d,
  NULL::numeric AS d6_repeat_amount,
  NULL::text AS payment_trace,
  signups::numeric AS signups,
  d6::numeric AS d6,
  d6_overall_con::numeric AS d6_overall_con,
  d6_overall_revenue::numeric AS d6_overall_revenue,
  total_revenue_first_6d_all_payments::numeric AS total_revenue_first_6d_all_payments,
  users_with_duplicate_attribution_rows::numeric AS users_with_duplicate_attribution_rows
FROM current_formula
UNION ALL
SELECT
  'user' AS row_type,
  ub.user_id::text,
  ub.priority::text,
  ub.attribution_rows::bigint,
  ub.raw_trackers::text,
  ub.payments_first_6d::bigint,
  ub.revenue_first_6d_all_payments::numeric,
  ub.new_payments_first_6d::bigint,
  ub.d6_revenue::numeric,
  ub.repeat_payments_first_6d::bigint,
  ub.d6_repeat_amount::numeric,
  ub.payment_trace::text,
  NULL::numeric,
  NULL::numeric,
  NULL::numeric,
  NULL::numeric,
  NULL::numeric,
  NULL::numeric
FROM user_breakdown ub
ORDER BY row_type, revenue_first_6d_all_payments DESC NULLS LAST`;

        const metabaseRes = await fetch(`${METABASE_URL}/api/dataset`, {
            method: 'POST',
            headers: {
                'X-Metabase-Session': METABASE_SESSION_TOKEN,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                database: 2,
                type: 'native',
                native: { query: sql },
                constraints: { 'max-results': 10000, 'max-results-bare-rows': 10000 },
            }),
        });

        if (!metabaseRes.ok) {
            const errText = await metabaseRes.text();
            return res.status(metabaseRes.status).json({ success: false, error: `Metabase API error: ${errText}` });
        }

        const result = await metabaseRes.json();
        const columns = result.data.cols.map(c => c.name);
        const rows = result.data.rows.map(row => {
            const obj = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            return obj;
        });

        const summary = rows.find(r => r.row_type === 'summary') || null;
        const users = rows.filter(r => r.row_type === 'user');
        res.json({ success: true, summary, users, total: users.length });
    } catch (err) {
        console.error('Metabase debug-user-attribution error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =============================================================================
// CREATIVE INTELLIGENCE API
// =============================================================================

// Ensure creative-intelligence directory exists for tracking data
const ciDir = path.join(__dirname, '..', 'creative-intelligence');
if (!fs.existsSync(ciDir)) fs.mkdirSync(ciDir, { recursive: true });
const SIM_TRACKING_FILE = path.join(ciDir, 'sim-tracking.json');
const CI_DATA_CACHE_FILE = path.join(ciDir, 'data-cache.json');
const CI_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Helper: read cached creative data if fresh
function getCachedCreativeData(dateFrom, dateTo) {
    try {
        if (!fs.existsSync(CI_DATA_CACHE_FILE)) return null;
        const raw = JSON.parse(fs.readFileSync(CI_DATA_CACHE_FILE, 'utf-8'));
        if (raw.dateFrom === dateFrom && raw.dateTo === dateTo) {
            const age = Date.now() - new Date(raw.cachedAt).getTime();
            if (age < CI_CACHE_MAX_AGE_MS) {
                console.log(`[ci/cache] Using cached data (${raw.creatives.length} creatives, cached ${Math.round(age / 60000)}min ago)`);
                return raw.creatives;
            }
            console.log(`[ci/cache] Cache expired (${Math.round(age / 3600000)}h old)`);
        } else {
            console.log(`[ci/cache] Cache date range mismatch (cached: ${raw.dateFrom}-${raw.dateTo}, requested: ${dateFrom}-${dateTo})`);
        }
    } catch (e) {
        console.warn('[ci/cache] Failed to read cache:', e.message);
    }
    return null;
}

// Helper: save creative data to cache
function saveCacheCreativeData(dateFrom, dateTo, creatives) {
    try {
        fs.writeFileSync(CI_DATA_CACHE_FILE, JSON.stringify({
            dateFrom, dateTo,
            cachedAt: new Date().toISOString(),
            creativeCount: creatives.length,
            creatives
        }));
        console.log(`[ci/cache] Saved ${creatives.length} creatives to cache`);
    } catch (e) {
        console.warn('[ci/cache] Failed to save cache:', e.message);
    }
}

// Route 1: Fetch all historical creative performance data
app.post('/api/ci/historical-data', async (req, res) => {
    try {
        console.log('[ci/historical-data] Fetching historical creative data...');

        // Calculate date range: last 180 days
        const dateTo = new Date().toISOString().slice(0, 10);
        const dateFrom = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        // 1. Fetch Meta ads with daily insights (all campaigns)
        const allRows = [];
        let url = `${META_API_BASE}/${META_AD_ACCOUNT_ID}/insights`;
        let params = metaParams({
            fields: 'campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,spend,impressions,clicks,cpm,ctr,cpc,actions,cost_per_action_type',
            level: 'ad',
            time_increment: 1,
            time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
            limit: 500,
        });

        let pageCount = 0;
        let nextUrl = `${url}?${new URLSearchParams(params).toString()}`;
        while (nextUrl) {
            pageCount++;
            console.log(`[ci/historical-data] Meta page ${pageCount}...${allRows.length ? ' (' + allRows.length + ' rows so far)' : ''}`);
            const response = await fetch(nextUrl);
            const data = await response.json();

            if (data.error) {
                if (pageCount === 1) return res.status(400).json({ success: false, error: data.error.message });
                console.error('[ci/historical-data] Pagination error:', data.error);
                break;
            }

            if (data.data) allRows.push(...data.data);

            if (data.paging && data.paging.next) {
                const sep = data.paging.next.includes('?') ? '&' : '?';
                nextUrl = data.paging.next + sep + 'appsecret_proof=' + encodeURIComponent(META_APP_SECRET_PROOF);
            } else {
                nextUrl = null;
            }
        }
        console.log(`[ci/historical-data] Meta done. ${pageCount} pages, ${allRows.length} total rows.`);

        // Flatten actions
        const metaAds = allRows.map(row => {
            const actions = row.actions || [];
            const costPerAction = row.cost_per_action_type || [];
            const installs = actions.find(a => a.action_type === 'mobile_app_install');
            const cpiObj = costPerAction.find(a => a.action_type === 'mobile_app_install');
            return {
                date_start: row.date_start,
                campaign_name: row.campaign_name,
                campaign_id: row.campaign_id,
                adset_name: row.adset_name,
                adset_id: row.adset_id,
                ad_name: row.ad_name,
                ad_id: row.ad_id,
                spend: parseFloat(row.spend || 0),
                impressions: parseInt(row.impressions || 0),
                clicks: parseInt(row.clicks || 0),
                cpm: parseFloat(row.cpm || 0),
                ctr: parseFloat(row.ctr || 0),
                cpc: parseFloat(row.cpc || 0),
                installs: installs ? parseInt(installs.value) : 0,
                cpi: cpiObj ? parseFloat(cpiObj.value) : null,
            };
        });

        // 2. Fetch Metabase funnel data — get unique campaign names from Meta data
        const campaignNames = [...new Set(metaAds.map(a => a.campaign_name).filter(Boolean))];
        let funnelData = [];

        if (campaignNames.length > 0) {
            const safeNameRegex = /^[a-zA-Z0-9\-_ ]+$/;
            const safeCampaignNames = campaignNames.filter(n => safeNameRegex.test(n));

            if (safeCampaignNames.length > 0) {
                const campaignNamesSQL = safeCampaignNames.map(n => `'${n}'`).join(',');

                // FIXED: ID-based join via SPLIT_PART(tracker_name, ':', 2)
                const sql = `
WITH meta_attributed AS (
  SELECT
    SPLIT_PART(uad.tracker_name, ':', 2) AS meta_campaign_id,
    uad.tracker_campaign_name AS campaign_name,
    LOWER(TRIM(uad.tracker_sub_campaign_name)) AS adset_name,
    regexp_replace(uad.creative, ':.*$', '', 'g') AS tracker_name,
    uad.user_id,
    u.priority,
    DATE(u.created_at) AS signup_date
  FROM user_additional_details uad
  INNER JOIN users u ON u.id = uad.user_id
  WHERE (uad.network ILIKE '%facebook%' OR uad.network ILIKE '%instagram%' OR uad.network = 'Facebook')
    AND SPLIT_PART(uad.tracker_name, ':', 2) != ''
    AND SPLIT_PART(uad.tracker_name, ':', 2) IS NOT NULL
    AND u.referred_by IS NULL
    AND DATE(u.created_at) >= '${dateFrom}'
    AND DATE(u.created_at) <= '${dateTo}'
    AND uad.tracker_campaign_name IN (${campaignNamesSQL})
),
first_payments AS (
  SELECT
    user_id, min(payment_date) as payment_date,
    sum(case when rt = 1 then amount else null end) as amount,
    sum(amount) as overall_amount
  FROM (
    SELECT user_id, payment_date, amount, created_at,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY payment_date) AS rt
    FROM user_transaction_history uth
    LEFT JOIN users u ON u.id = uth.user_id
    WHERE status = 'CHARGED' AND amount > 50
  ) sub
  GROUP BY 1
),
signup_metrics AS (
  SELECT
    ma.tracker_name,
    ma.campaign_name AS tracker_campaign_name,
    ma.meta_campaign_id,
    COUNT(DISTINCT ma.user_id) AS total_signup,
    COUNT(DISTINCT CASE WHEN ma.priority = 0 THEN ma.user_id END) AS p0_signup,
    COUNT(DISTINCT CASE WHEN ma.priority = 1 THEN ma.user_id END) AS p1_signup,
    COUNT(DISTINCT CASE WHEN fp.payment_date IS NOT NULL THEN ma.user_id END) AS total_trial,
    COUNT(DISTINCT CASE WHEN fp.payment_date IS NOT NULL AND date(fp.payment_date) = ma.signup_date THEN ma.user_id END) AS d0_trial,
    COUNT(DISTINCT CASE WHEN fp.payment_date IS NOT NULL AND date(fp.payment_date) = ma.signup_date AND fp.amount > 0 THEN ma.user_id END) AS d0,
    COALESCE(SUM(CASE WHEN date(fp.payment_date) = ma.signup_date AND fp.amount > 0 THEN fp.amount END), 0) AS d0_revenue,
    COUNT(DISTINCT CASE WHEN fp.payment_date IS NOT NULL AND date(fp.payment_date) <= ma.signup_date + INTERVAL '6 days' AND fp.amount > 0 THEN ma.user_id END) AS d6,
    COALESCE(SUM(CASE WHEN date(fp.payment_date) <= ma.signup_date + INTERVAL '6 days' AND fp.amount > 0 THEN fp.amount END), 0) AS d6_revenue,
    COUNT(DISTINCT CASE WHEN fp.amount > 0 THEN ma.user_id END) AS new_converted_user,
    COALESCE(SUM(CASE WHEN fp.amount > 0 THEN fp.amount END), 0) AS new_user_rev,
    COALESCE(SUM(fp.overall_amount), 0) AS overall_revenue,
    COUNT(DISTINCT CASE WHEN date(fp.payment_date) <= ma.signup_date + INTERVAL '6 days' THEN ma.user_id END) AS d6_overall_con,
    COALESCE(SUM(CASE WHEN date(fp.payment_date) <= ma.signup_date + INTERVAL '6 days' THEN fp.overall_amount END), 0) AS d6_overall_revenue
  FROM meta_attributed ma
  LEFT JOIN first_payments fp ON fp.user_id = ma.user_id
  GROUP BY 1,2,3
)
SELECT
  sm.tracker_name,
  sm.tracker_campaign_name AS campaign_name,
  sm.meta_campaign_id,
  SUM(sm.total_signup) AS signups,
  SUM(sm.p0_signup) AS p0_signup,
  SUM(sm.p1_signup) AS p1_signup,
  SUM(sm.total_trial) AS total_trial,
  SUM(sm.d0_trial) AS d0_trial,
  SUM(sm.d0) AS d0,
  SUM(sm.d0_revenue) AS d0_revenue,
  SUM(sm.d6) AS d6,
  SUM(sm.d6_revenue) AS d6_revenue,
  SUM(sm.new_converted_user) AS new_converted_user,
  SUM(sm.new_user_rev) AS new_user_rev,
  SUM(sm.overall_revenue) AS overall_revenue,
  SUM(sm.d6_overall_con) AS d6_overall_con,
  SUM(sm.d6_overall_revenue) AS d6_overall_revenue
FROM signup_metrics sm
GROUP BY 1,2,3
ORDER BY SUM(sm.total_signup) DESC`;

                try {
                    const metabaseRes = await fetch(`${METABASE_URL}/api/dataset`, {
                        method: 'POST',
                        headers: {
                            'X-Metabase-Session': METABASE_SESSION_TOKEN,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            database: 2,
                            type: 'native',
                            native: { query: sql },
                        }),
                    });

                    if (metabaseRes.ok) {
                        const result = await metabaseRes.json();
                        const columns = result.data.cols.map(c => c.name);
                        funnelData = result.data.rows.map(row => {
                            const obj = {};
                            columns.forEach((col, i) => { obj[col] = row[i]; });
                            return obj;
                        });
                    } else {
                        console.error('[ci/historical-data] Metabase error:', await metabaseRes.text());
                    }
                } catch (mbErr) {
                    console.error('[ci/historical-data] Metabase fetch failed:', mbErr.message);
                }
            }
        }

        console.log(`[ci/historical-data] Done. ${metaAds.length} Meta rows, ${funnelData.length} funnel rows.`);
        res.json({ success: true, data: { metaAds, funnelData } });
    } catch (err) {
        console.error('CI historical-data error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Target campaigns for CI analysis
const TARGET_CAMPAIGNS = [
    'Test4-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_200326',
    'Test2-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_051225',
    'Test-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_131125'
];

const KNOWN_CREATIVES_FILE = path.join(ciDir, 'known-creatives.json');

// Route 2: Learn patterns — auto-fetches Meta + Metabase data server-side
app.post('/api/ci/learn', async (req, res) => {
    try {
        if (!OpenAI || !OPENAI_API_KEY) {
            return res.status(500).json({ success: false, error: 'OpenAI not configured' });
        }

        // 1. Date range (defaults to last 180 days)
        const dateTo = (req.body && req.body.dateTo) || new Date().toISOString().slice(0, 10);
        const dateFrom = (req.body && req.body.dateFrom) || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const forceRefresh = !!(req.body && req.body.forceRefresh);
        console.log(`[ci/learn] Requested data from ${dateFrom} to ${dateTo} (forceRefresh: ${forceRefresh})`);

        // Check cache first (skip if forceRefresh)
        let combinedCreatives;
        const cached = forceRefresh ? null : getCachedCreativeData(dateFrom, dateTo);
        if (cached) {
            combinedCreatives = cached;
            console.log(`[ci/learn] Using ${combinedCreatives.length} cached creatives. Skipping Meta/Metabase fetch.`);
        } else {
        // 2. Fetch Meta daily ad-level insights in 14-day chunks to avoid "reduce data" error
        const allMetaRows = [];
        const metaFields = 'campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,spend,impressions,clicks,cpm,ctr,cpc,actions,cost_per_action_type,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions';
        const CHUNK_DAYS = 14;

        // Build date chunks
        const chunks = [];
        let chunkStart = new Date(dateFrom);
        const endDate = new Date(dateTo);
        while (chunkStart < endDate) {
            let chunkEnd = new Date(chunkStart.getTime() + CHUNK_DAYS * 86400000);
            if (chunkEnd > endDate) chunkEnd = endDate;
            chunks.push({
                since: chunkStart.toISOString().slice(0, 10),
                until: chunkEnd.toISOString().slice(0, 10)
            });
            chunkStart = new Date(chunkEnd.getTime() + 86400000); // next day
        }
        console.log(`[ci/learn] Fetching Meta data in ${chunks.length} chunks of ${CHUNK_DAYS} days...`);

        let totalPages = 0;
        for (let ci = 0; ci < chunks.length; ci++) {
            const chunk = chunks[ci];
            console.log(`[ci/learn] Chunk ${ci + 1}/${chunks.length}: ${chunk.since} to ${chunk.until}`);

            let metaParams_ = metaParams({
                fields: metaFields,
                level: 'ad',
                time_increment: 1,
                time_range: JSON.stringify(chunk),
                limit: 500,
            });

            let nextUrl = `${META_API_BASE}/${META_AD_ACCOUNT_ID}/insights?${new URLSearchParams(metaParams_).toString()}`;
            while (nextUrl) {
                totalPages++;
                const response = await fetch(nextUrl);
                const data = await response.json();

                if (data.error) {
                    console.error(`[ci/learn] Meta error on chunk ${ci + 1}: ${data.error.message}`);
                    break;
                }

                if (data.data) allMetaRows.push(...data.data);

                if (data.paging && data.paging.next) {
                    const sep = data.paging.next.includes('?') ? '&' : '?';
                    nextUrl = data.paging.next + sep + 'appsecret_proof=' + encodeURIComponent(META_APP_SECRET_PROOF);
                } else {
                    nextUrl = null;
                }
            }
            console.log(`[ci/learn] Chunk ${ci + 1} done. Total rows so far: ${allMetaRows.length}`);
        }
        console.log(`[ci/learn] Meta done. ${totalPages} pages across ${chunks.length} chunks, ${allMetaRows.length} total rows.`);

        // Filter to TARGET_CAMPAIGNS only (server-side filter since Meta API filtering is limited)
        const targetSet = new Set(TARGET_CAMPAIGNS.map(n => n.trim()));
        const filteredMetaRows = allMetaRows.filter(row => targetSet.has((row.campaign_name || '').trim()));
        console.log(`[ci/learn] Filtered to ${filteredMetaRows.length} rows from target campaigns.`);

        // Flatten Meta rows into structured objects
        const metaAds = filteredMetaRows.map(row => {
            const actions = row.actions || [];
            const costPerAction = row.cost_per_action_type || [];
            const installs = actions.find(a => a.action_type === 'mobile_app_install');
            const cpiObj = costPerAction.find(a => a.action_type === 'mobile_app_install');
            const thruplay = row.video_thruplay_watched_actions ? parseInt((row.video_thruplay_watched_actions[0] || {}).value || 0) : 0;
            const p25 = row.video_p25_watched_actions ? parseInt((row.video_p25_watched_actions[0] || {}).value || 0) : 0;
            const p50 = row.video_p50_watched_actions ? parseInt((row.video_p50_watched_actions[0] || {}).value || 0) : 0;
            const p75 = row.video_p75_watched_actions ? parseInt((row.video_p75_watched_actions[0] || {}).value || 0) : 0;
            const p100 = row.video_p100_watched_actions ? parseInt((row.video_p100_watched_actions[0] || {}).value || 0) : 0;
            const impressions = parseInt(row.impressions || 0);
            // 3-second views ~ p25 for short videos, use p25 as proxy for hook
            const threeSecViews = p25;
            return {
                date_start: row.date_start,
                campaign_name: row.campaign_name,
                campaign_id: row.campaign_id,
                adset_name: row.adset_name,
                adset_id: row.adset_id,
                ad_name: row.ad_name,
                ad_id: row.ad_id,
                spend: parseFloat(row.spend || 0),
                impressions,
                clicks: parseInt(row.clicks || 0),
                cpm: parseFloat(row.cpm || 0),
                ctr: parseFloat(row.ctr || 0),
                cpc: parseFloat(row.cpc || 0),
                installs: installs ? parseInt(installs.value) : 0,
                cpi: cpiObj ? parseFloat(cpiObj.value) : null,
                thruplay,
                p25, p50, p75, p100,
                three_sec_views: threeSecViews,
                hook_rate: impressions > 0 ? threeSecViews / impressions : 0,
                hold_rate: threeSecViews > 0 ? thruplay / threeSecViews : 0,
                completion_rate: impressions > 0 ? p100 / impressions : 0,
            };
        });

        // 3. Fetch Metabase funnel data using exact SQL from /api/metabase/creative-metrics
        const campaignNamesSQL = TARGET_CAMPAIGNS.map(n => `'${n}'`).join(',');

        // FIXED: ID-based join via SPLIT_PART(tracker_name, ':', 2)
        const sql = `
WITH meta_attributed AS (
  SELECT
    SPLIT_PART(uad.tracker_name, ':', 2) AS meta_campaign_id,
    uad.tracker_campaign_name AS campaign_name,
    LOWER(TRIM(uad.tracker_sub_campaign_name)) AS adset_name,
    regexp_replace(uad.creative, ':.*$', '', 'g') AS tracker_name,
    uad.user_id,
    u.priority,
    DATE(u.created_at) AS signup_date
  FROM user_additional_details uad
  INNER JOIN users u ON u.id = uad.user_id
  WHERE (uad.network ILIKE '%facebook%' OR uad.network ILIKE '%instagram%' OR uad.network = 'Facebook')
    AND SPLIT_PART(uad.tracker_name, ':', 2) != ''
    AND SPLIT_PART(uad.tracker_name, ':', 2) IS NOT NULL
    AND u.referred_by IS NULL
    AND DATE(u.created_at) >= '${dateFrom}'
    AND DATE(u.created_at) <= '${dateTo}'
    AND uad.tracker_campaign_name IN (${campaignNamesSQL})
),
first_payments AS (
  SELECT
    user_id, min(payment_date) as payment_date,
    sum(case when rt = 1 then amount else null end) as amount,
    sum(case when rt > 1 then amount else null end) as repeat_amount,
    count(case when rt > 1 then amount else null end) as repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 6 then amount else null end) as d6_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 6 then amount else null end) as d6_repeat_con,
    sum(amount) as overall_amt,
    count(user_id) as overall_con
  FROM (
    SELECT user_id, payment_date, amount, created_at,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY payment_date) AS rt
    FROM user_transaction_history uth
    LEFT JOIN users u ON u.id = uth.user_id
    WHERE status = 'CHARGED' AND amount > 50
  ) sub
  GROUP BY 1
),
trial AS (
  SELECT user_id, trial_date FROM (
    SELECT user_id, payment_date AS trial_date, plan_id,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY payment_date DESC) AS rk
    FROM user_transaction_history
    WHERE (plan_id IN ('plan_000','plan_000_plus','plan_000_super') OR plan_id ILIKE '%trial%')
      AND status = 'CHARGED'
  ) sub WHERE rk = 1
),
signup_metrics AS (
  SELECT
    ma.signup_date AS event_date,
    ma.campaign_name AS tracker_campaign_name,
    ma.tracker_name,
    ma.meta_campaign_id,
    COUNT(DISTINCT ma.user_id) AS total_signup,
    COUNT(DISTINCT CASE WHEN ma.priority = 'PAYMENT-P0' THEN ma.user_id END) AS p0_signup,
    COUNT(DISTINCT CASE WHEN ma.priority = 'PAYMENT-P1' THEN ma.user_id END) AS p1_signup,
    COUNT(DISTINCT t.user_id) AS total_trial,
    COUNT(DISTINCT CASE WHEN DATE(fp.payment_date) = ma.signup_date THEN fp.user_id END) AS d0,
    SUM(CASE WHEN DATE(fp.payment_date) = ma.signup_date THEN fp.amount ELSE 0 END) AS d0_revenue,
    COUNT(DISTINCT CASE WHEN DATE(fp.payment_date) <= ma.signup_date + INTERVAL '6 day' THEN fp.user_id END) AS d6,
    SUM(CASE WHEN DATE(fp.payment_date) <= ma.signup_date + INTERVAL '6 day' THEN fp.amount ELSE 0 END) AS d6_revenue,
    COUNT(DISTINCT fp.user_id) AS new_converted_user,
    SUM(fp.amount) AS new_user_rev,
    SUM(fp.overall_amt) AS overall_revenue,
    COUNT(DISTINCT CASE WHEN DATE(trial_date) = DATE(ma.signup_date) THEN t.user_id END) AS d0_trial,
    SUM(d6_repeat_con) AS d6_overall_con,
    SUM(d6_repeat_amount) AS d6_overall_revenue
  FROM meta_attributed ma
  LEFT JOIN first_payments fp ON ma.user_id = fp.user_id
  LEFT JOIN trial t ON ma.user_id = t.user_id
  GROUP BY 1,2,3,4
)
SELECT
  sm.tracker_name,
  sm.tracker_campaign_name AS campaign_name,
  sm.meta_campaign_id,
  SUM(sm.total_signup) AS signups,
  SUM(sm.p0_signup) AS p0_signup,
  SUM(sm.p1_signup) AS p1_signup,
  SUM(sm.total_trial) AS total_trial,
  SUM(sm.d0_trial) AS d0_trial,
  SUM(sm.d0) AS d0,
  SUM(sm.d0_revenue) AS d0_revenue,
  SUM(sm.d6) AS d6,
  SUM(sm.d6_revenue) AS d6_revenue,
  SUM(sm.new_converted_user) AS new_converted_user,
  SUM(sm.new_user_rev) AS new_user_rev,
  SUM(sm.overall_revenue) AS overall_revenue,
  SUM(sm.d6_overall_con) AS d6_overall_con,
  SUM(sm.d6_overall_revenue) AS d6_overall_revenue
FROM signup_metrics sm
GROUP BY 1,2,3
ORDER BY SUM(sm.total_signup) DESC`;

        let funnelData = [];
        try {
            console.log('[ci/learn] Fetching Metabase funnel data...');
            const metabaseRes = await fetch(`${METABASE_URL}/api/dataset`, {
                method: 'POST',
                headers: {
                    'X-Metabase-Session': METABASE_SESSION_TOKEN,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    database: 2,
                    type: 'native',
                    native: { query: sql },
                }),
            });

            if (metabaseRes.ok) {
                const result = await metabaseRes.json();
                const columns = result.data.cols.map(c => c.name);
                funnelData = result.data.rows.map(row => {
                    const obj = {};
                    columns.forEach((col, i) => { obj[col] = row[i]; });
                    return obj;
                });
                console.log(`[ci/learn] Metabase done. ${funnelData.length} funnel rows.`);
            } else {
                console.error('[ci/learn] Metabase error:', await metabaseRes.text());
            }
        } catch (mbErr) {
            console.error('[ci/learn] Metabase fetch failed:', mbErr.message);
        }

        // 4. Merge Meta + Metabase data by ad_name <-> tracker_name
        // Build funnel lookup (case-insensitive, strip tracker suffix after colon)
        // Metabase SQL strips `:` suffix via regexp_replace(tracker_name, ':.*$', '', 'g')
        const funnelLookup = {};
        for (const row of funnelData) {
            if (row.tracker_name) {
                const key = row.tracker_name.toLowerCase().trim();
                funnelLookup[key] = row;
                // Also index with prefix stripped (FB_MOF_Video_ etc)
                const stripped = key.replace(/^fb_mof_(video_|static_)?/i, '');
                if (stripped && stripped !== key) funnelLookup[stripped] = row;
            }
        }
        console.log(`[ci/learn] Funnel lookup: ${Object.keys(funnelLookup).length} keys. Sample keys: ${Object.keys(funnelLookup).slice(0, 5).join(', ')}`);

        // Aggregate Meta rows per ad_name (they are daily — roll up to totals)
        const adAgg = {};
        for (const row of metaAds) {
            const key = row.ad_name;
            if (!adAgg[key]) {
                adAgg[key] = {
                    ad_name: row.ad_name,
                    ad_id: row.ad_id,
                    campaign_name: row.campaign_name,
                    campaign_id: row.campaign_id,
                    adset_name: row.adset_name,
                    adset_id: row.adset_id,
                    spend: 0, impressions: 0, clicks: 0,
                    installs: 0,
                    thruplay: 0, p25: 0, p50: 0, p75: 0, p100: 0,
                    three_sec_views: 0,
                    daily: [],
                    dates: [],
                    day_of_week_counts: {},
                };
            }
            const a = adAgg[key];
            a.spend += row.spend;
            a.impressions += row.impressions;
            a.clicks += row.clicks;
            a.installs += row.installs;
            a.thruplay += row.thruplay;
            a.p25 += row.p25;
            a.p50 += row.p50;
            a.p75 += row.p75;
            a.p100 += row.p100;
            a.three_sec_views += row.three_sec_views;
            if (row.spend > 0) a.dates.push(row.date_start);
            a.daily.push({ date: row.date_start, spend: row.spend, impressions: row.impressions, clicks: row.clicks, installs: row.installs });
            // Day of week distribution
            const dow = new Date(row.date_start).toLocaleDateString('en-US', { weekday: 'short' });
            a.day_of_week_counts[dow] = (a.day_of_week_counts[dow] || 0) + row.spend;
        }

        // Build combined creative records
        combinedCreatives = Object.values(adAgg).map(a => {
            const spendDates = a.dates.sort();
            const goLiveDate = spendDates.length > 0 ? spendDates[0] : null;
            const daysLive = spendDates.length > 0 ? Math.ceil((new Date(spendDates[spendDates.length - 1]) - new Date(spendDates[0])) / (1000 * 60 * 60 * 24)) + 1 : 0;

            // Derived Meta metrics
            const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
            const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
            const cpc = a.clicks > 0 ? a.spend / a.clicks : 0;
            const cpi = a.installs > 0 ? a.spend / a.installs : null;
            const hook_rate = a.impressions > 0 ? a.three_sec_views / a.impressions : 0;
            const hold_rate = a.three_sec_views > 0 ? a.thruplay / a.three_sec_views : 0;
            const completion_rate = a.impressions > 0 ? a.p100 / a.impressions : 0;

            // Creative type from name
            const type = a.ad_name.includes('Video_') ? 'Video' : a.ad_name.includes('Static_') ? 'Static' : 'Unknown';

            // Match funnel data — try multiple key formats
            const funnelKey = a.ad_name.toLowerCase().trim();
            const funnelKeyStripped = funnelKey.replace(/^fb_mof_(video_|static_)?/i, '');
            const funnelKeyNoColon = funnelKey.replace(/:.*$/, '');
            const funnel = funnelLookup[funnelKey] || funnelLookup[funnelKeyStripped] || funnelLookup[funnelKeyNoColon] || {};

            const signups = parseInt(funnel.signups || 0);
            const p0_signup = parseInt(funnel.p0_signup || 0);
            const p1_signup = parseInt(funnel.p1_signup || 0);
            const d0_trial = parseInt(funnel.d0_trial || 0);
            const d0 = parseInt(funnel.d0 || 0);
            const d0_revenue = parseFloat(funnel.d0_revenue || 0);
            const d6 = parseInt(funnel.d6 || 0);
            const d6_revenue = parseFloat(funnel.d6_revenue || 0);
            const overall_revenue = parseFloat(funnel.overall_revenue || 0);
            const d6_overall_revenue = parseFloat(funnel.d6_overall_revenue || 0);

            // Derived funnel metrics
            const signup_cost = signups > 0 ? a.spend / signups : null;
            const d0_trial_cost = d0_trial > 0 ? a.spend / d0_trial : null;
            const d6_cac = d6 > 0 ? a.spend / d6 : null;
            // ROAS validity check — reject revenue/spend > 50x as matching error
            const _vR = (sp, rev) => { if (!sp || sp <= 0 || !rev || rev < 0) return null; if (rev / sp > 50) return null; return (rev / sp) * 100; };
            const d6_roas = _vR(a.spend, d6_overall_revenue);
            const overall_roas = _vR(a.spend, overall_revenue);

            return {
                ad_name: a.ad_name,
                ad_id: a.ad_id,
                campaign_name: a.campaign_name,
                adset_name: a.adset_name,
                type,
                // Meta totals
                spend: Math.round(a.spend * 100) / 100,
                impressions: a.impressions,
                clicks: a.clicks,
                cpm: Math.round(cpm * 100) / 100,
                ctr: Math.round(ctr * 100) / 100,
                cpc: Math.round(cpc * 100) / 100,
                installs: a.installs,
                cpi: cpi ? Math.round(cpi * 100) / 100 : null,
                // Video metrics
                hook_rate: Math.round(hook_rate * 10000) / 100,
                hold_rate: Math.round(hold_rate * 10000) / 100,
                completion_rate: Math.round(completion_rate * 10000) / 100,
                // Funnel metrics
                signups,
                p0_signup,
                p1_signup,
                d0_trial,
                d0,
                d0_revenue: Math.round(d0_revenue * 100) / 100,
                d6,
                d6_revenue: Math.round(d6_revenue * 100) / 100,
                overall_revenue: Math.round(overall_revenue * 100) / 100,
                d6_overall_revenue: Math.round(d6_overall_revenue * 100) / 100,
                // Derived
                signup_cost: signup_cost ? Math.round(signup_cost * 100) / 100 : null,
                d0_trial_cost: d0_trial_cost ? Math.round(d0_trial_cost * 100) / 100 : null,
                d6_cac: d6_cac ? Math.round(d6_cac * 100) / 100 : null,
                d6_roas: d6_roas != null ? Math.round(d6_roas * 100) / 100 : null,
                overall_roas: overall_roas != null ? Math.round(overall_roas * 100) / 100 : null,
                // Temporal
                go_live_date: goLiveDate,
                days_live: daysLive,
                day_of_week_distribution: a.day_of_week_counts,
            };
        });

        const withFunnel = combinedCreatives.filter(c => c.signups > 0 || c.d6 > 0);
        console.log(`[ci/learn] ${combinedCreatives.length} combined creatives built (${withFunnel.length} with funnel data).`);
        if (combinedCreatives.length > 0 && withFunnel.length === 0) {
            console.log(`[ci/learn] Sample ad_names: ${combinedCreatives.slice(0, 3).map(c => c.ad_name).join(', ')}`);
            console.log(`[ci/learn] Sample funnel keys: ${Object.keys(funnelLookup).slice(0, 3).join(', ')}`);
        }

        // Save to cache for fast subsequent runs
        saveCacheCreativeData(dateFrom, dateTo, combinedCreatives);

        } // end else (cache miss)

        // 5. Prepare compact data for OpenAI — include ALL Metabase funnel fields
        const compactCreatives = combinedCreatives.map(c => ({
            n: c.ad_name, t: c.type, cmp: c.campaign_name, ads: c.adset_name,
            // Meta delivery
            sp: c.spend, imp: c.impressions, clk: c.clicks,
            cpm: c.cpm, ctr: c.ctr, cpc: c.cpc, inst: c.installs, cpi: c.cpi,
            // Video engagement
            hk: c.hook_rate, hd: c.hold_rate, cm: c.completion_rate,
            // Metabase funnel (deep)
            su: c.signups, p0: c.p0_signup, p1: c.p1_signup,
            dt: c.d0_trial, d0: c.d0, d0r: c.d0_revenue,
            d6: c.d6, d6r: c.d6_revenue, d6or: c.d6_overall_revenue,
            or: c.overall_revenue,
            // Derived efficiency
            sc: c.signup_cost, dtc: c.d0_trial_cost, d6c: c.d6_cac,
            d6x: c.d6_roas, ox: c.overall_roas,
            // Temporal
            lv: c.go_live_date, dy: c.days_live,
        }));

        // Sort by spend desc and cap at top 150 creatives to stay within token limits
        compactCreatives.sort((a, b) => b.sp - a.sp);
        const creativesForAI = compactCreatives.slice(0, 150);

        // Build aggregated summaries for context
        const dowSummary = {};
        const monthSummary = {};
        let totalSpend = 0, totalSignups = 0, totalD6 = 0, totalD0 = 0, totalInst = 0;
        let totalD6Rev = 0, totalOverallRev = 0, totalD0Trial = 0;
        for (const c of combinedCreatives) {
            totalSpend += c.spend; totalSignups += c.signups; totalD6 += c.d6;
            totalD0 += c.d0; totalInst += c.installs; totalD0Trial += c.d0_trial;
            totalD6Rev += c.d6_overall_revenue || 0; totalOverallRev += c.overall_revenue || 0;
            if (c.day_of_week_distribution) {
                for (const [day, spend] of Object.entries(c.day_of_week_distribution)) {
                    dowSummary[day] = Math.round((dowSummary[day] || 0) + spend);
                }
            }
            if (c.go_live_date) {
                const m = c.go_live_date.slice(0, 7);
                if (!monthSummary[m]) monthSummary[m] = { spend: 0, inst: 0, su: 0, d6: 0, d6rev: 0, count: 0 };
                monthSummary[m].spend += c.spend; monthSummary[m].inst += c.installs;
                monthSummary[m].su += c.signups; monthSummary[m].d6 += c.d6;
                monthSummary[m].d6rev += c.d6_overall_revenue || 0; monthSummary[m].count++;
            }
        }

        // Aggregate summaries for context
        const aggContext = {
            total: { spend: Math.round(totalSpend), installs: totalInst, signups: totalSignups, d0_trial: totalD0Trial, d0: totalD0, d6: totalD6, d6_revenue: Math.round(totalD6Rev), overall_revenue: Math.round(totalOverallRev), blended_cpi: totalInst > 0 ? Math.round(totalSpend/totalInst) : null, blended_d6_roas: totalSpend > 0 ? Math.round(totalD6Rev/totalSpend*10000)/100 : 0, blended_overall_roas: totalSpend > 0 ? Math.round(totalOverallRev/totalSpend*10000)/100 : 0 },
            by_month: monthSummary,
            by_dow: dowSummary,
        };

        const dataPayload = JSON.stringify(creativesForAI);
        console.log(`[ci/learn] ${combinedCreatives.length} creatives ready. Sending top ${creativesForAI.length} to OpenAI (${Math.round(dataPayload.length / 1000)}KB)...`);

        // 6. Send to OpenAI gpt-4o
        const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

        const systemPrompt = `You are a senior performance marketing analyst for Univest, an Indian fintech app (Research Advisory + Broking/Demat). You have Meta Ads delivery data MERGED with Metabase deep-funnel conversion data for each creative.

DATA FIELD KEY (abbreviated to save tokens):
n=ad_name, t=type(Video/Static), cmp=campaign, ads=adset,
sp=spend(₹), imp=impressions, clk=clicks, cpm, ctr(%), cpc(₹), inst=installs, cpi(₹),
hk=hook_rate(% of impressions that watched 3s), hd=hold_rate(% of 3s viewers that completed thruplay), cm=completion_rate(% watched 100%),
su=signups, p0=P0 priority signups(highest intent), p1=P1 priority signups(high intent),
dt=d0_trials(same-day trial subscriptions), d0=d0 paid conversions, d0r=d0 revenue(₹),
d6=conversions within 6 days, d6r=d6 first-payment revenue(₹), d6or=d6 overall revenue including repeats(₹),
or=overall lifetime revenue(₹),
sc=signup cost(₹), dtc=d0 trial cost(₹), d6c=d6 CAC(₹),
d6x=d6 ROAS(%), ox=overall ROAS(%),
lv=go_live_date, dy=days_live.

YOUR TASK: Produce DEEP, SPECIFIC, ACTIONABLE insights — not surface-level summaries. The marketing team needs to know EXACTLY what to do next.

REQUIRED ANALYSIS (be exhaustive, cite specific creatives with their numbers):

1. FULL-FUNNEL EFFICIENCY ANALYSIS
   - Map the ENTIRE funnel: Impression → Click → Install → Signup → P0/P1 → Trial → D0 → D6 → Overall
   - Find WHERE each creative's funnel breaks: which creatives get cheap installs but no signups? Which get signups but no conversions?
   - Identify the "golden creatives" that have strong conversion at EVERY stage
   - Calculate and compare: install-to-signup rate, signup-to-trial rate, trial-to-D6 rate, D6-to-overall revenue expansion

2. REVENUE & ROAS DEEP-DIVE (from Metabase data)
   - Rank creatives by D6 ROAS — what do the top 10% have in common vs bottom 10%?
   - D6 ROAS vs Overall ROAS trajectory: which creatives show LTV expansion (overall >> d6)? Which plateau?
   - Revenue per conversion analysis: d0r/d0 vs d6or/d6 — who generates higher ARPU?
   - P0/P1 quality signal: do high-P0 creatives produce better D6/Overall ROAS?

3. CREATIVE FORMAT & VIDEO METRICS
   - Video vs Static: compare FULL funnel (not just CTR — go all the way to ROAS)
   - Hook-to-ROAS correlation: does a higher hook rate actually predict better D6 ROAS?
   - Hold rate sweet spots: what hold rate range produces the best signup-to-conversion ratio?
   - Identify specific video creatives where engagement is high but conversions are low (and vice versa)

4. NAMING PATTERN INTELLIGENCE
   - Decode the naming convention (e.g. FB_MOF_Video_HindZinc_V0) — extract: language, concept, version, influencer name
   - Which concepts/themes produce the best ROAS? (e.g. does "HindZinc" beat "MoneyControl"?)
   - Version analysis: do V1/V2 iterations actually improve on V0?
   - Influencer identification: which influencer-tagged creatives outperform brand creatives on deep funnel?

5. BUDGET REALLOCATION RECOMMENDATIONS
   - Identify underspent winners: high ROAS but low spend — recommend scaling
   - Identify overspent losers: high spend but poor D6 ROAS — recommend cutting
   - Calculate potential revenue impact of reallocation (e.g. "shifting ₹X from A to B could generate ₹Y more revenue")

6. TEMPORAL & SEASONAL PATTERNS
   - Monthly performance trends from go_live_dates
   - Which creative themes work in which months?
   - Day-of-week spend efficiency

For EVERY insight: cite 3-5 specific creative names with their actual numbers. Don't be vague.

Return JSON:
{
  "patterns": [{"name":"","description":"","evidence":[{"creative":"","metrics":{}}],"confidence":"high|medium|low","recommendation":"SPECIFIC action to take"}],
  "top_performing_traits": [{"trait":"","impact":"quantified impact with ₹ numbers","examples":[{"creative":"","key_metric":""}]}],
  "failure_patterns": [{"pattern":"","why_it_fails":"cite funnel stage where it breaks","examples":[{"creative":"","key_metric":""}]}],
  "seasonal_insights": [{"period":"","observation":"","data_points":[],"recommendation":""}],
  "content_insights": {"best_tone":"","best_hook_style":"","format_winner":"with full-funnel comparison","influencer_vs_brand":"with ROAS comparison","color_scheme_signal":""},
  "market_correlation": {"bullish_impact":"","seasonal_multipliers":[],"day_of_week_patterns":[]},
  "overall_summary": "3-paragraph executive summary with key ₹ numbers and top 3 immediate actions",
  "creative_scoring_model": {"factors":[{"name":"","weight":0.0,"description":""}],"formula_description":""},
  "budget_actions": [{"action":"scale|cut|test","creative":"","current_spend":"","current_d6_roas":"","recommended_change":"","projected_impact":""}],
  "funnel_bottlenecks": [{"creative":"","bottleneck_stage":"","upstream_metric":"","downstream_metric":"","fix":""}]
}`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-5.4',
            max_completion_tokens: 16000,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Analyze top ${creativesForAI.length} creatives by spend (${combinedCreatives.length} total).\n\nAGGREGATE CONTEXT:\n${JSON.stringify(aggContext)}\n\nPER-CREATIVE DATA:\n${dataPayload}` },
            ],
            response_format: { type: 'json_object' },
        });

        const rawText = completion.choices[0].message.content;
        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch (parseErr) {
            console.warn('[ci/learn] Failed to parse JSON, returning raw text');
            return res.json({ success: true, data: null, rawResponse: rawText, creativesAnalyzed: combinedCreatives.length });
        }

        console.log('[ci/learn] Analysis complete.');
        res.json({ success: true, data: parsed, creativesAnalyzed: combinedCreatives.length, dateRange: { dateFrom, dateTo } });
    } catch (err) {
        console.error('CI learn error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 2b: Detect new creatives in target campaigns
app.post('/api/ci/detect-new-creatives', async (req, res) => {
    try {
        // 1. Find campaign IDs for TARGET_CAMPAIGNS
        console.log('[ci/detect-new] Finding campaign IDs for target campaigns...');
        const campaignsData = await metaGet('/' + META_AD_ACCOUNT_ID + '/campaigns', { fields: 'id,name', limit: 100 });

        if (campaignsData.error) {
            return res.status(400).json({ success: false, error: 'Meta API error: ' + campaignsData.error.message });
        }

        const targetCampaignIds = [];
        for (const c of (campaignsData.data || [])) {
            if (TARGET_CAMPAIGNS.includes(c.name)) {
                targetCampaignIds.push({ id: c.id, name: c.name });
            }
        }

        if (targetCampaignIds.length === 0) {
            return res.status(404).json({ success: false, error: 'None of the TARGET_CAMPAIGNS found in Meta account' });
        }
        console.log(`[ci/detect-new] Found ${targetCampaignIds.length} target campaigns.`);

        // 2. Fetch ads from each campaign
        const allAds = [];
        for (const campaign of targetCampaignIds) {
            let adsNextUrl = null;
            let firstPage = true;
            while (firstPage || adsNextUrl) {
                firstPage = false;
                let adsData;
                if (adsNextUrl) {
                    const sep = adsNextUrl.includes('?') ? '&' : '?';
                    const resp = await fetch(adsNextUrl + sep + 'appsecret_proof=' + encodeURIComponent(META_APP_SECRET_PROOF));
                    adsData = await resp.json();
                } else {
                    adsData = await metaGet('/' + campaign.id + '/ads', { fields: 'id,name,status,created_time', limit: 500 });
                }

                if (adsData.error) {
                    console.error(`[ci/detect-new] Error fetching ads for campaign ${campaign.name}:`, adsData.error);
                    break;
                }

                for (const ad of (adsData.data || [])) {
                    allAds.push({
                        ad_id: ad.id,
                        ad_name: ad.name,
                        campaign_name: campaign.name,
                        created_time: ad.created_time,
                        status: ad.status,
                    });
                }

                adsNextUrl = (adsData.paging && adsData.paging.next) ? adsData.paging.next : null;
            }
        }
        console.log(`[ci/detect-new] Found ${allAds.length} total ads across target campaigns.`);

        // 3. Load known creatives
        let knownCreatives = {};
        try {
            if (fs.existsSync(KNOWN_CREATIVES_FILE)) {
                knownCreatives = JSON.parse(fs.readFileSync(KNOWN_CREATIVES_FILE, 'utf-8'));
            }
        } catch (e) {
            console.warn('[ci/detect-new] Could not read known-creatives.json, starting fresh.');
            knownCreatives = {};
        }

        // 4. Compare and find new ones
        const now = new Date().toISOString();
        const newCreatives = [];
        const allCreativesOut = [];

        for (const ad of allAds) {
            const isNew = !knownCreatives[ad.ad_id];
            if (isNew) {
                knownCreatives[ad.ad_id] = {
                    ad_name: ad.ad_name,
                    campaign_name: ad.campaign_name,
                    created_time: ad.created_time,
                    status: ad.status,
                    first_seen: now,
                };
                newCreatives.push({ ...ad, is_new: true, first_seen: now });
            }
            allCreativesOut.push({
                ...ad,
                is_new: isNew,
                first_seen: isNew ? now : (knownCreatives[ad.ad_id].first_seen || now),
            });
        }

        // 5. Save updated known creatives
        fs.writeFileSync(KNOWN_CREATIVES_FILE, JSON.stringify(knownCreatives, null, 2));
        console.log(`[ci/detect-new] Done. ${newCreatives.length} new creatives detected, ${allCreativesOut.length} total.`);

        res.json({ success: true, newCreatives, allCreatives: allCreativesOut });
    } catch (err) {
        console.error('CI detect-new-creatives error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Helper: trim learnings to fit within GPT-4o context limits (~4K tokens max for learnings)
function trimLearnings(learnings) {
    if (!learnings) return '';
    // If it's already a small summary object, use as-is
    const raw = JSON.stringify(learnings);
    if (raw.length < 6000) return raw;

    // Extract only the most useful summary fields, skip bulky evidence arrays
    const summary = {};
    if (learnings.overall_summary) summary.overall_summary = learnings.overall_summary;
    if (learnings.content_insights) summary.content_insights = learnings.content_insights;
    if (learnings.market_correlation) summary.market_correlation = learnings.market_correlation;
    if (learnings.creative_scoring_model) summary.scoring = learnings.creative_scoring_model;

    // Top performing traits — name + impact only (strip examples)
    if (learnings.top_performing_traits) {
        summary.top_traits = learnings.top_performing_traits.map(t => ({
            trait: t.trait, impact: t.impact
        }));
    }
    // Failure patterns — name + why only
    if (learnings.failure_patterns) {
        summary.failures = learnings.failure_patterns.map(f => ({
            pattern: f.pattern, why: f.why_it_fails
        }));
    }
    // Patterns — name + description + confidence only (skip evidence arrays)
    if (learnings.patterns) {
        summary.patterns = learnings.patterns.slice(0, 8).map(p => ({
            name: p.name, description: p.description, confidence: p.confidence,
            recommendation: p.recommendation
        }));
    }
    // Seasonal insights — compact
    if (learnings.seasonal_insights) {
        summary.seasonal = learnings.seasonal_insights.map(s => ({
            period: s.period, observation: s.observation
        }));
    }

    const trimmed = JSON.stringify(summary);
    // If still too large, hard-truncate
    if (trimmed.length > 8000) return trimmed.slice(0, 8000) + '...}';
    return trimmed;
}

// Route 3: Simulate/predict ROAS trajectory for a creative
app.post('/api/ci/simulate', async (req, res) => {
    try {
        const { creative, learnings, daysLive } = req.body;
        if (!creative) {
            return res.status(400).json({ success: false, error: 'creative object is required' });
        }

        if (!OpenAI || !OPENAI_API_KEY) {
            return res.status(500).json({ success: false, error: 'OpenAI not configured' });
        }

        const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
        const learningsSummary = trimLearnings(learnings);

        const systemPrompt = `You are a ROAS prediction engine for Univest (Indian fintech).
Given the creative's current early metrics and historical pattern learnings, predict the ROAS trajectory.

Current creative data: ${JSON.stringify(creative)}
Historical learnings: ${learningsSummary}
Days live so far: ${daysLive || 0}

Based on the patterns from successful and failed creatives, predict:
1. Predicted D6 ROAS
2. Predicted 30-day ROAS
3. Predicted 60-day ROAS
4. Predicted 120-day ROAS
5. Predicted 365-day LTV ROAS
6. Confidence interval for each prediction
7. Key risk factors
8. Comparison to historical average
9. Recommended action (scale/maintain/pause/kill)

Return JSON:
{
  "predictions": {
    "d6": { "roas": 0, "confidence_low": 0, "confidence_high": 0 },
    "d30": { "roas": 0, "confidence_low": 0, "confidence_high": 0 },
    "d60": { "roas": 0, "confidence_low": 0, "confidence_high": 0 },
    "d120": { "roas": 0, "confidence_low": 0, "confidence_high": 0 },
    "d365": { "roas": 0, "confidence_low": 0, "confidence_high": 0 }
  },
  "trajectory": "improving|stable|declining",
  "risk_factors": [],
  "recommendation": { "action": "", "reasoning": "", "budget_suggestion": "" },
  "similar_creatives": [{ "name": "", "final_roas": 0, "similarity_reason": "" }],
  "overall_ltv_estimate": ""
}`;

        console.log(`[ci/simulate] Simulating ROAS for creative: ${creative.name || 'unknown'}...`);
        const completion = await openai.chat.completions.create({
            model: 'gpt-5.4',
            max_completion_tokens: 4000,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Predict the ROAS trajectory for this creative based on the provided data and learnings.' },
            ],
            response_format: { type: 'json_object' },
        });

        const rawText = completion.choices[0].message.content;
        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch (parseErr) {
            console.warn('[ci/simulate] Failed to parse JSON, returning raw text');
            return res.json({ success: true, data: null, rawResponse: rawText });
        }

        console.log('[ci/simulate] Simulation complete.');
        res.json({ success: true, data: parsed });
    } catch (err) {
        console.error('CI simulate error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 4: Generate creative recommendations
app.post('/api/ci/recommend', async (req, res) => {
    try {
        const { learnings, currentCreatives } = req.body;
        if (!learnings) {
            return res.status(400).json({ success: false, error: 'learnings object is required' });
        }

        if (!OpenAI || !OPENAI_API_KEY) {
            return res.status(500).json({ success: false, error: 'OpenAI not configured' });
        }

        const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

        const systemPrompt = `You are a creative director and performance marketing strategist for Univest (Indian fintech - Research Advisory & Broking).
Based on the learnings from historical creative performance and current active creatives, generate specific creative recommendations.

Historical learnings: ${JSON.stringify(learnings)}
Current active creatives: ${JSON.stringify(currentCreatives || [])}

Generate:
1. 5 new video script concepts (with hook, body structure, CTA, estimated duration)
2. 3 new static ad concepts (with headline, body copy, visual description)
3. For each current underperforming creative: specific revamp suggestions
4. Format recommendations (what's working: video length, aspect ratio, style)
5. Messaging angle recommendations (what hooks/themes resonate)
6. Compliance checklist for fintech ads (SEBI, RBI disclaimers)

Return JSON:
{
  "new_video_scripts": [{ "title": "", "hook_line": "", "body_outline": "", "cta": "", "duration_seconds": 0, "expected_performance": "", "rationale": "" }],
  "new_static_concepts": [{ "title": "", "headline": "", "body_copy": "", "visual_description": "", "rationale": "" }],
  "revamp_suggestions": [{ "creative_name": "", "current_issue": "", "suggested_changes": [], "expected_improvement": "" }],
  "format_insights": { "best_video_length": "", "best_aspect_ratio": "", "style_that_works": "" },
  "messaging_insights": { "top_hooks": [], "top_themes": [], "avoid": [] },
  "compliance_checklist": []
}`;

        console.log(`[ci/recommend] Generating recommendations...`);
        const completion = await openai.chat.completions.create({
            model: 'gpt-5.4',
            max_completion_tokens: 8000,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: 'Generate creative recommendations based on the provided learnings and current creatives.' },
            ],
            response_format: { type: 'json_object' },
        });

        const rawText = completion.choices[0].message.content;
        let parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch (parseErr) {
            console.warn('[ci/recommend] Failed to parse JSON, returning raw text');
            return res.json({ success: true, data: null, rawResponse: rawText });
        }

        console.log('[ci/recommend] Recommendations generated.');
        res.json({ success: true, data: parsed });
    } catch (err) {
        console.error('CI recommend error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route: Analytics sheet validation source
app.get('/api/validation/analytics-sheet', async (req, res) => {
    try {
        const gid = req.query.gid || ANALYTICS_SHEET_GID;
        const limit = Math.max(1, Math.min(5000, parseInt(req.query.limit || '500', 10)));
        const url = `https://docs.google.com/spreadsheets/d/${ANALYTICS_SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) {
            return res.status(response.status).json({ success: false, error: `Sheet request failed with status ${response.status}` });
        }
        const payload = parseGvizResponse(await response.text());
        const cols = (payload.table && payload.table.cols ? payload.table.cols : []).map(col => col.label || col.id);
        const rows = (payload.table && payload.table.rows ? payload.table.rows : []).slice(0, limit).map(row => {
            const obj = {};
            cols.forEach((col, idx) => {
                const cell = row.c && row.c[idx] ? row.c[idx] : null;
                obj[col] = cell ? (cell.f != null ? cell.f : cell.v) : null;
            });
            return obj;
        });
        res.json({
            success: true,
            sheet_id: ANALYTICS_SHEET_ID,
            gid,
            total: rows.length,
            columns: cols,
            rows,
            source_url: url,
        });
    } catch (err) {
        console.error('[validation/analytics-sheet] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route: Generic AI analyze proxy — accepts system + prompt, returns OpenAI response
app.post('/api/optimizer/brain', async (req, res) => {
    try {
        const runtimeContext = req.body && req.body.runtime_context;
        const userRequest = (req.body && req.body.user_request) || (runtimeContext && runtimeContext.user_request) || '';
        if (!runtimeContext || !userRequest) {
            return res.status(400).json({ success: false, error: 'runtime_context and user_request are required' });
        }
        if (!OpenAI || !OPENAI_API_KEY) {
            return res.status(500).json({ success: false, error: 'OpenAI not configured. Set OPENAI_API_KEY env var.' });
        }

        const openai = new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 240000 });
        const evidence = buildOptimizerBrainEvidence(runtimeContext);

        const classifierSystem = [
            'You classify a performance marketer operator request.',
            'Return JSON only.',
            'Use one use_case from: account_revamp, campaign_overview, root_cause, scale_decision, creative_actionables, queue_validation, clarification_needed.',
            'Keep it concise.'
        ].join('\n');
        const classifierPrompt = JSON.stringify({
            user_request: userRequest,
            request_scope: runtimeContext.request_scope || {},
            target_scope: runtimeContext.target_scope || null
        });

        let useCase = inferOptimizerUseCaseFallback(userRequest, runtimeContext);
        try {
            const classify = await openai.chat.completions.create({
                model: 'gpt-4.1',
                max_completion_tokens: 700,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: classifierSystem },
                    { role: 'user', content: classifierPrompt }
                ]
            });
            useCase = safeJsonParse(classify.choices[0].message.content, useCase) || useCase;
        } catch (e) {
            console.warn('[optimizer/brain] classifier fallback:', e.message);
        }

        if (useCase && useCase.needs_clarification) {
            return res.json({
                success: true,
                mode: 'clarification',
                use_case: useCase,
                evidence,
                optimizer_plan: {
                    executive_summary: useCase.clarification_question || 'I need one clarification before I can answer this properly.',
                    operator_answer: useCase.clarification_question || 'I need one clarification before I can answer this properly.',
                    actions: [],
                    do_not_touch: [],
                    watch_list: []
                }
            });
        }

        const strategistSystem = [
            'You are an expert performance marketer with 20+ years of experience working in a financial advisory brand.',
            'You are APEX, a world-class performance marketer operating a Meta account like it is your own money.',
            'Return JSON only.',
            'Use the user_request first, then the evidence, then the playbook rules.',
            'Do not be vague. Give specific actions with exact entities and exact numbers where evidence allows.',
            'If evidence is insufficient for an exact numeric change, say what data is missing and still give the next best concrete action.',
            'You must factor: campaign settings, adset settings, ad issues, audiences, location settings, placements, bid strategy, optimization event, historical winners, external context, and risks not present in historical data.',
            'Prioritize meta_operator_audit and data_integrity_gate before making any recommendation that depends on ROAS/CAC.',
            'If Meta-side evidence says CPI, CTR, CPM, audience concentration, placement waste, geo inefficiency, or bid/learning issues are the real problem, say that directly.',
            'For campaign deep dives, cover active adsets and active ads explicitly. Say which particular ads are not working and why.',
            'Keep the final answer operator-friendly, not analyst-style.'
        ].join('\n');

        const strategistPrompt = JSON.stringify({
            user_request: userRequest,
            use_case: useCase,
            evidence,
            required_output: {
                optimizer_plan: {
                    executive_summary: 'short operator summary',
                    operator_answer: 'full answer in one readable top-to-bottom document',
                    actions: [
                        {
                            action_id: 'ACT-001',
                            priority: 'P1|P2|P3',
                            action_type: 'PAUSE_AD|ACTIVATE_AD|ACTIVATE_ADSET|PAUSE_ADSET|ACTIVATE_CAMPAIGN|PAUSE_CAMPAIGN|UPDATE_ADSET_BUDGET|UPDATE_CAMPAIGN_BUDGET|MONITOR|CREATIVE_CHANGE',
                            entity_type: 'campaign|adset|ad|account',
                            entity_id: 'meta id if known',
                            entity_name: 'entity name',
                            campaign_name: '',
                            adset_name: '',
                            diagnosis: 'exact why',
                            action_detail: 'exact do',
                            expected_impact: 'expected outcome',
                            risk: 'main risk',
                            success_metric: 'what metric proves it worked',
                            confidence: 'HIGH|MEDIUM|LOW',
                            budget_change: { current_daily_budget: 0, recommended_daily_budget: 0, change_pct: '' }
                        }
                    ],
                    do_not_touch: [{ entity_name: '', entity_id: '', reason: '' }],
                    watch_list: [{ entity_name: '', priority: 'P2|P3', watch_reason: '', trigger_for_action: '' }],
                    morning_brief: {
                        market_read: { posture: '', summary: '', signals: [] },
                        account_pulse: {},
                        what_to_do_right_now: [],
                        what_to_leave_alone: [],
                        campaign_insights: [],
                        this_weeks_moves: [],
                        thirty_day_horizon: { risks: [], opportunities: [] }
                    }
                }
            }
        });

        const strategy = await openai.chat.completions.create({
            model: 'gpt-4.1',
            max_completion_tokens: 9000,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: strategistSystem },
                { role: 'user', content: strategistPrompt }
            ]
        });
        let strategyJson = safeJsonParse(strategy.choices[0].message.content, {}) || {};

        const qaSystem = [
            'You are the final optimizer-answer QA gate.',
            'Return JSON only.',
            'Reject vague answers.',
            'Check that the answer contains concrete entities, concrete reasons, and actionable changes.',
            'If weak, tighten it using the same evidence without inventing facts.'
        ].join('\n');
        const qaPrompt = JSON.stringify({
            user_request: userRequest,
            use_case: useCase,
            evidence,
            draft: strategyJson
        });

        try {
            const qa = await openai.chat.completions.create({
                model: 'gpt-4.1',
                max_completion_tokens: 2500,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: qaSystem },
                    { role: 'user', content: qaPrompt }
                ]
            });
            const qaJson = safeJsonParse(qa.choices[0].message.content, null);
            if (qaJson && qaJson.tightened_answer && typeof qaJson.tightened_answer === 'object') {
                strategyJson = qaJson.tightened_answer;
            }
            let qaGate = analyzeOptimizerDraftQuality(strategyJson);
            if (!qaGate.passed) {
                const fixerSystem = [
                    'You are PERFORMANCE MARKETER final QA.',
                    'Return JSON only.',
                    'You are fixing a weak optimizer answer.',
                    'Eliminate vague check/review language unless there is truly insufficient evidence.',
                    'Make recommendations differentiated by entity. Different entities should not receive the same generic advice unless the evidence is genuinely identical.',
                    'Every weak entity needs a concrete action or an explicit no-change-needed decision.',
                    'For campaign deep dives, include active adsets and active ads with specific fixes.'
                ].join('\n');
                const fixerPrompt = JSON.stringify({
                    user_request: userRequest,
                    use_case: useCase,
                    evidence,
                    qa_errors: qaGate.errors,
                    draft: strategyJson,
                    required_output: 'Return the same optimizer_plan schema, but repaired.'
                });
                try {
                    const repair = await openai.chat.completions.create({
                        model: 'gpt-4.1',
                        max_completion_tokens: 4000,
                        response_format: { type: 'json_object' },
                        messages: [
                            { role: 'system', content: fixerSystem },
                            { role: 'user', content: fixerPrompt }
                        ]
                    });
                    const repairedJson = safeJsonParse(repair.choices[0].message.content, null);
                    if (repairedJson && typeof repairedJson === 'object') {
                        strategyJson = repairedJson;
                        qaGate = analyzeOptimizerDraftQuality(strategyJson);
                    }
                } catch (repairErr) {
                    console.warn('[optimizer/brain] repair fallback:', repairErr.message);
                }
            }
            return res.json({
                success: true,
                use_case: useCase,
                evidence,
                qa: qaJson,
                qa_gate: qaGate,
                ...strategyJson
            });
        } catch (e) {
            console.warn('[optimizer/brain] qa fallback:', e.message);
            const qaGate = analyzeOptimizerDraftQuality(strategyJson);
            return res.json({
                success: true,
                use_case: useCase,
                evidence,
                qa_gate: qaGate,
                ...strategyJson
            });
        }
    } catch (err) {
        console.error('[optimizer/brain] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/ai/analyze', async (req, res) => {
    try {
        const { system, prompt, max_tokens } = req.body;
        const performanceMarketerPrefix = 'You are an expert performance marketer with 20+ years of experience working in a financial advisory brand.';
        if (!system || !prompt) {
            return res.status(400).json({ success: false, error: 'system and prompt are required' });
        }
        if (!OpenAI || !OPENAI_API_KEY) {
            return res.status(500).json({ success: false, error: 'OpenAI not configured. Set OPENAI_API_KEY env var.' });
        }

        const openai = new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 240000 });
        console.log(`[ai/analyze] Running AI analysis (prompt length: ${prompt.length} chars)...`);

        const completion = await openai.chat.completions.create({
            model: 'gpt-4.1',
            max_completion_tokens: max_tokens || 8000,
            messages: [
                { role: 'system', content: performanceMarketerPrefix + '\n\n' + system },
                { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
        });

        const content = completion.choices[0].message.content;
        console.log(`[ai/analyze] Done. Response length: ${content.length} chars`);
        res.json({ success: true, content: content });
    } catch (err) {
        console.error('[ai/analyze] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 5: Store simulation tracking data
app.post('/api/ci/simulate-track', async (req, res) => {
    try {
        const { creativeId, predictedRoas, actualRoas, date } = req.body;
        if (!creativeId) {
            return res.status(400).json({ success: false, error: 'creativeId is required' });
        }

        // Read existing tracking data
        let trackingData = [];
        if (fs.existsSync(SIM_TRACKING_FILE)) {
            try {
                trackingData = JSON.parse(fs.readFileSync(SIM_TRACKING_FILE, 'utf8'));
            } catch (e) {
                trackingData = [];
            }
        }

        // Append new record
        const record = {
            creativeId,
            predictedRoas: predictedRoas || null,
            actualRoas: actualRoas || null,
            date: date || new Date().toISOString().slice(0, 10),
            timestamp: new Date().toISOString(),
        };
        trackingData.push(record);

        // Write back
        fs.writeFileSync(SIM_TRACKING_FILE, JSON.stringify(trackingData, null, 2));

        // Return all records for this creativeId
        const creativeRecords = trackingData.filter(r => r.creativeId === creativeId);
        console.log(`[ci/simulate-track] Stored tracking for ${creativeId}. ${creativeRecords.length} total records.`);
        res.json({ success: true, data: creativeRecords });
    } catch (err) {
        console.error('CI simulate-track error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 6: Get simulation tracking records for a creative
app.get('/api/ci/sim-tracking/:creativeName', async (req, res) => {
    try {
        const { creativeName } = req.params;

        let trackingData = [];
        if (fs.existsSync(SIM_TRACKING_FILE)) {
            try {
                trackingData = JSON.parse(fs.readFileSync(SIM_TRACKING_FILE, 'utf8'));
            } catch (e) {
                trackingData = [];
            }
        }

        const creativeRecords = trackingData.filter(r => r.creativeId === creativeName);
        res.json({ success: true, data: creativeRecords });
    } catch (err) {
        console.error('CI sim-tracking error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =============================================================================
// CI ROAS SIMULATOR — PERMANENT DATABASE & AUTO-SIMULATE ALL LIVE ADS
// =============================================================================

const { getCiDb } = require('../creative-intelligence/db');

// Route 7: Auto-simulate ALL live ads — fetches live creatives, runs simulation for each, stores in DB
app.post('/api/ci/simulate-all', async (req, res) => {
    try {
        if (!OpenAI || !OPENAI_API_KEY) {
            return res.status(500).json({ success: false, error: 'OpenAI not configured' });
        }

        const db = getCiDb();
        const batchId = new Date().toISOString().replace(/[:.]/g, '-');
        console.log(`[ci/simulate-all] Starting batch ${batchId}...`);

        // 1. Fetch all campaigns to find target campaigns
        const campaignsData = await metaGet('/' + META_AD_ACCOUNT_ID + '/campaigns', {
            fields: 'id,name,status',
            limit: 100
        });

        if (campaignsData.error) {
            return res.status(400).json({ success: false, error: 'Meta API error: ' + campaignsData.error.message });
        }

        // Find ACTIVE campaigns matching TARGET_CAMPAIGNS
        const targetCampaignIds = [];
        for (const c of (campaignsData.data || [])) {
            if (TARGET_CAMPAIGNS.includes(c.name)) {
                targetCampaignIds.push({ id: c.id, name: c.name });
            }
        }

        if (targetCampaignIds.length === 0) {
            return res.status(404).json({ success: false, error: 'No target campaigns found' });
        }

        // 2. Fetch ALL ads with ACTIVE status from target campaigns
        const liveAds = [];
        for (const campaign of targetCampaignIds) {
            let firstPage = true;
            let adsNextUrl = null;
            while (firstPage || adsNextUrl) {
                firstPage = false;
                let adsData;
                if (adsNextUrl) {
                    const sep = adsNextUrl.includes('?') ? '&' : '?';
                    const resp = await fetch(adsNextUrl + sep + 'appsecret_proof=' + encodeURIComponent(META_APP_SECRET_PROOF));
                    adsData = await resp.json();
                } else {
                    adsData = await metaGet('/' + campaign.id + '/ads', {
                        fields: 'id,name,status,created_time',
                        filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]),
                        limit: 500
                    });
                }

                if (adsData.error) break;

                for (const ad of (adsData.data || [])) {
                    if (ad.status === 'ACTIVE') {
                        liveAds.push({
                            ad_id: ad.id,
                            ad_name: ad.name,
                            campaign_name: campaign.name,
                            created_time: ad.created_time,
                            status: ad.status,
                        });
                    }
                }
                adsNextUrl = (adsData.paging && adsData.paging.next) ? adsData.paging.next : null;
            }
        }

        console.log(`[ci/simulate-all] Found ${liveAds.length} live ads.`);

        if (liveAds.length === 0) {
            return res.json({ success: true, message: 'No live ads found', simulations: [] });
        }

        // 3. Fetch performance data for all live ads (last 30 days)
        const dateTo = new Date().toISOString().slice(0, 10);
        const dateFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const dateFrom180 = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);

        // Fetch Meta ad-level insights for these ads
        let allMetaRows = [];
        let nextUrl = `${META_API_BASE}/${META_AD_ACCOUNT_ID}/insights?${new URLSearchParams(metaParams({
            fields: 'ad_name,ad_id,campaign_name,adset_name,spend,impressions,clicks,cpm,ctr,cpc,actions,cost_per_action_type,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions',
            level: 'ad',
            time_range: JSON.stringify({ since: dateFrom180, until: dateTo }),
            limit: 500,
        })).toString()}`;

        while (nextUrl) {
            const response = await fetch(nextUrl);
            const data = await response.json();
            if (data.error) break;
            if (data.data) allMetaRows.push(...data.data);
            if (data.paging && data.paging.next) {
                const sep = data.paging.next.includes('?') ? '&' : '?';
                nextUrl = data.paging.next + sep + 'appsecret_proof=' + encodeURIComponent(META_APP_SECRET_PROOF);
            } else {
                nextUrl = null;
            }
        }

        // Filter to only live ad IDs
        const liveAdIds = new Set(liveAds.map(a => a.ad_id));
        const liveMetaRows = allMetaRows.filter(r => liveAdIds.has(r.ad_id));
        console.log(`[ci/simulate-all] Got ${liveMetaRows.length} insight rows for ${liveAdIds.size} live ads.`);

        // Aggregate per ad
        const adAgg = {};
        for (const row of liveMetaRows) {
            const key = row.ad_name;
            if (!adAgg[key]) {
                adAgg[key] = { ad_name: row.ad_name, ad_id: row.ad_id, campaign_name: row.campaign_name, adset_name: row.adset_name || '', spend: 0, impressions: 0, clicks: 0, installs: 0, thruplay: 0, p25: 0, p50: 0, p75: 0, p100: 0, three_sec_views: 0, dates: [] };
            }
            const a = adAgg[key];
            a.spend += parseFloat(row.spend || 0);
            a.impressions += parseInt(row.impressions || 0);
            a.clicks += parseInt(row.clicks || 0);
            const actions = row.actions || [];
            const installs = actions.find(x => x.action_type === 'mobile_app_install');
            if (installs) a.installs += parseInt(installs.value);
            a.thruplay += row.video_thruplay_watched_actions ? parseInt((row.video_thruplay_watched_actions[0] || {}).value || 0) : 0;
            a.p25 += row.video_p25_watched_actions ? parseInt((row.video_p25_watched_actions[0] || {}).value || 0) : 0;
            a.p100 += row.video_p100_watched_actions ? parseInt((row.video_p100_watched_actions[0] || {}).value || 0) : 0;
            a.three_sec_views += a.p25;
            if (parseFloat(row.spend || 0) > 0) a.dates.push(row.date_start);
        }

        // FIXED: ID-based join via SPLIT_PART(tracker_name, ':', 2)
        const funnelSql = `
WITH meta_attributed AS (
  SELECT
    SPLIT_PART(uad.tracker_name, ':', 2) AS meta_campaign_id,
    uad.tracker_campaign_name AS campaign_name,
    regexp_replace(uad.creative, ':.*$', '', 'g') AS tracker_name,
    uad.user_id,
    u.priority,
    DATE(u.created_at) AS signup_date
  FROM user_additional_details uad
  INNER JOIN users u ON u.id = uad.user_id
  WHERE (uad.network ILIKE '%facebook%' OR uad.network ILIKE '%instagram%' OR uad.network = 'Facebook')
    AND SPLIT_PART(uad.tracker_name, ':', 2) != ''
    AND SPLIT_PART(uad.tracker_name, ':', 2) IS NOT NULL
    AND u.referred_by IS NULL
    AND DATE(u.created_at) >= '${dateFrom180}'
    AND DATE(u.created_at) <= '${dateTo}'
    AND uad.tracker_campaign_name IN (${campaignNamesSQL})
),
first_payments AS (
  SELECT user_id, min(payment_date) as payment_date,
    sum(case when rt = 1 then amount else null end) as amount,
    sum(amount) as overall_amt
  FROM (SELECT user_id, payment_date, amount, created_at, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY payment_date) AS rt FROM user_transaction_history uth LEFT JOIN users u ON u.id = uth.user_id WHERE status = 'CHARGED' AND amount > 50) sub
  GROUP BY 1
),
signup_metrics AS (
  SELECT
    ma.tracker_name,
    ma.campaign_name AS tracker_campaign_name,
    ma.meta_campaign_id,
    COUNT(DISTINCT ma.user_id) AS total_signup,
    COUNT(DISTINCT CASE WHEN DATE(fp.payment_date) <= ma.signup_date + INTERVAL '6 day' AND fp.amount > 0 THEN ma.user_id END) AS d6,
    SUM(CASE WHEN DATE(fp.payment_date) <= ma.signup_date + INTERVAL '6 day' AND fp.amount > 0 THEN fp.amount ELSE 0 END) AS d6_revenue,
    SUM(fp.overall_amt) AS overall_revenue,
    COALESCE(SUM(CASE WHEN date(fp.payment_date) <= ma.signup_date + INTERVAL '6 days' THEN fp.overall_amt END), 0) AS d6_overall_revenue
  FROM meta_attributed ma LEFT JOIN first_payments fp ON ma.user_id = fp.user_id
  GROUP BY 1,2,3
)
SELECT sm.tracker_name, sm.tracker_campaign_name AS campaign_name, sm.meta_campaign_id,
  SUM(sm.total_signup) AS signups, SUM(sm.d6) AS d6, SUM(sm.d6_revenue) AS d6_revenue,
  SUM(sm.overall_revenue) AS overall_revenue, SUM(sm.d6_overall_revenue) AS d6_overall_revenue
FROM signup_metrics sm GROUP BY 1,2,3 ORDER BY SUM(sm.total_signup) DESC`;

        let funnelData = [];
        try {
            const metabaseRes = await fetch(`${METABASE_URL}/api/dataset`, {
                method: 'POST',
                headers: { 'X-Metabase-Session': METABASE_SESSION_TOKEN, 'Content-Type': 'application/json' },
                body: JSON.stringify({ database: 2, type: 'native', native: { query: funnelSql } }),
            });
            if (metabaseRes.ok) {
                const result = await metabaseRes.json();
                const columns = result.data.cols.map(c => c.name);
                funnelData = result.data.rows.map(row => {
                    const obj = {};
                    columns.forEach((col, i) => { obj[col] = row[i]; });
                    return obj;
                });
            }
        } catch (mbErr) {
            console.warn('[ci/simulate-all] Metabase fetch failed:', mbErr.message);
        }

        // Build funnel lookup
        const funnelLookup = {};
        for (const row of funnelData) {
            if (row.tracker_name) {
                const key = row.tracker_name.toLowerCase().trim();
                funnelLookup[key] = row;
                const stripped = key.replace(/^fb_mof_(video_|static_)?/i, '');
                if (stripped && stripped !== key) funnelLookup[stripped] = row;
            }
        }

        // 5. Build enriched creative records
        const enrichedCreatives = Object.values(adAgg).map(a => {
            const spendDates = a.dates.sort();
            const goLiveDate = spendDates.length > 0 ? spendDates[0] : null;
            const daysLive = spendDates.length > 0 ? Math.ceil((new Date(spendDates[spendDates.length - 1]) - new Date(spendDates[0])) / 86400000) + 1 : 0;
            const cpi = a.installs > 0 ? a.spend / a.installs : null;
            const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
            const hook_rate = a.impressions > 0 ? (a.three_sec_views / a.impressions) * 100 : 0;
            const hold_rate = a.three_sec_views > 0 ? (a.thruplay / a.three_sec_views) * 100 : 0;
            const completion_rate = a.impressions > 0 ? (a.p100 / a.impressions) * 100 : 0;
            const type = a.ad_name.includes('Video_') ? 'Video' : a.ad_name.includes('Static_') ? 'Static' : 'Unknown';

            const funnelKey = a.ad_name.toLowerCase().trim();
            const funnelKeyStripped = funnelKey.replace(/^fb_mof_(video_|static_)?/i, '');
            const funnel = funnelLookup[funnelKey] || funnelLookup[funnelKeyStripped] || {};

            const signups = parseInt(funnel.signups || 0);
            const d6 = parseInt(funnel.d6 || 0);
            const d6_revenue = parseFloat(funnel.d6_revenue || 0);
            const overall_revenue = parseFloat(funnel.overall_revenue || 0);
            const d6_overall_revenue = parseFloat(funnel.d6_overall_revenue || 0);
            const signup_cost = signups > 0 ? a.spend / signups : null;
            const d6_cac = d6 > 0 ? a.spend / d6 : null;
            // ROAS validity check — reject revenue/spend > 50x as matching error
            const _vR2 = (sp, rev) => { if (!sp || sp <= 0 || !rev || rev < 0) return null; if (rev / sp > 50) return null; return (rev / sp) * 100; };
            const d6_roas = _vR2(a.spend, d6_overall_revenue);
            const overall_roas = _vR2(a.spend, overall_revenue);

            return {
                ad_id: a.ad_id, ad_name: a.ad_name, campaign_name: a.campaign_name, adset_name: a.adset_name,
                type, spend: Math.round(a.spend * 100) / 100, impressions: a.impressions, clicks: a.clicks,
                installs: a.installs, cpi: cpi ? Math.round(cpi * 100) / 100 : null, ctr: Math.round(ctr * 100) / 100,
                signups, signup_cost: signup_cost ? Math.round(signup_cost * 100) / 100 : null,
                d6, d6_cac: d6_cac ? Math.round(d6_cac * 100) / 100 : null,
                d6_roas: d6_roas != null ? Math.round(d6_roas * 100) / 100 : null, d6_revenue: Math.round(d6_revenue * 100) / 100,
                d6_overall_revenue: Math.round(d6_overall_revenue * 100) / 100,
                overall_roas: overall_roas != null ? Math.round(overall_roas * 100) / 100 : null, overall_revenue: Math.round(overall_revenue * 100) / 100,
                hook_rate: Math.round(hook_rate * 100) / 100, hold_rate: Math.round(hold_rate * 100) / 100,
                completion_rate: Math.round(completion_rate * 100) / 100,
                go_live_date: goLiveDate, days_live: daysLive,
            };
        });

        console.log(`[ci/simulate-all] ${enrichedCreatives.length} enriched creatives ready for simulation.`);

        // 6. Build a compact peer summary for GPT context (not full cached data)
        const peerSummary = enrichedCreatives.map(c => ({
            name: c.ad_name, type: c.type, spend: c.spend, cpi: c.cpi,
            d6_roas: c.d6_roas, overall_roas: c.overall_roas, days_live: c.days_live
        }));
        const peerSummaryStr = JSON.stringify(peerSummary);

        // 7. Run simulation for each creative via GPT-4o
        const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
        const results = [];
        const insertSim = db.prepare(`
            INSERT INTO simulations (ad_id, ad_name, campaign_name, adset_name, creative_type,
                spend, impressions, clicks, installs, cpi, ctr, signups, signup_cost,
                d6, d6_cac, d6_roas, d6_revenue, d6_overall_revenue, overall_roas, overall_revenue,
                hook_rate, hold_rate, completion_rate, days_live, go_live_date,
                predicted_d6_roas, predicted_d6_low, predicted_d6_high,
                predicted_d30_roas, predicted_d30_low, predicted_d30_high,
                predicted_d60_roas, predicted_d60_low, predicted_d60_high,
                predicted_d120_roas, predicted_d120_low, predicted_d120_high,
                predicted_d365_roas, predicted_d365_low, predicted_d365_high,
                trajectory, action, reasoning, budget_suggestion, risk_factors, similar_creatives,
                raw_response, batch_id, is_live)
            VALUES (?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?,?, ?,?,?, ?,?,?, ?,?,?, ?,?,?,?,?,?, ?,?,?)
        `);

        // Simulate in batches of 3 concurrently
        for (let i = 0; i < enrichedCreatives.length; i += 3) {
            const batch = enrichedCreatives.slice(i, i + 3);
            const promises = batch.map(async (creative) => {
                try {
                    const systemPrompt = `You are a ROAS prediction engine for Univest (Indian fintech).
Given the creative's current metrics and peer context, predict the ROAS trajectory.

Creative data: ${JSON.stringify(creative)}
Peer creatives (for relative comparison): ${peerSummaryStr.length < 6000 ? peerSummaryStr : JSON.stringify(peerSummary.slice(0, 10))}
Days live: ${creative.days_live || 0}

Predict D6/30/60/120/365-day ROAS with confidence intervals.
Return JSON:
{
  "predictions": {
    "d6": { "roas": 0, "low": 0, "high": 0 },
    "d30": { "roas": 0, "low": 0, "high": 0 },
    "d60": { "roas": 0, "low": 0, "high": 0 },
    "d120": { "roas": 0, "low": 0, "high": 0 },
    "d365": { "roas": 0, "low": 0, "high": 0 }
  },
  "trajectory": "improving|stable|declining",
  "risk_factors": ["string"],
  "recommendation": { "action": "SCALE|MAINTAIN|PAUSE|KILL", "reasoning": "", "budget_suggestion": "" },
  "similar_creatives": [{ "name": "", "final_roas": 0, "similarity_reason": "" }]
}`;

                    const completion = await openai.chat.completions.create({
                        model: 'gpt-5.4',
                        max_completion_tokens: 2000,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: 'Predict ROAS trajectory.' },
                        ],
                        response_format: { type: 'json_object' },
                    });

                    const rawText = completion.choices[0].message.content;
                    let parsed;
                    try { parsed = JSON.parse(rawText); } catch(e) { parsed = {}; }

                    const preds = parsed.predictions || {};
                    const rec = parsed.recommendation || {};

                    // Insert into DB
                    const info = insertSim.run(
                        creative.ad_id, creative.ad_name, creative.campaign_name, creative.adset_name, creative.type,
                        creative.spend, creative.impressions, creative.clicks, creative.installs, creative.cpi, creative.ctr,
                        creative.signups, creative.signup_cost,
                        creative.d6, creative.d6_cac, creative.d6_roas, creative.d6_revenue, creative.d6_overall_revenue,
                        creative.overall_roas, creative.overall_revenue,
                        creative.hook_rate, creative.hold_rate, creative.completion_rate,
                        creative.days_live, creative.go_live_date,
                        preds.d6 ? preds.d6.roas : null, preds.d6 ? preds.d6.low : null, preds.d6 ? preds.d6.high : null,
                        preds.d30 ? preds.d30.roas : null, preds.d30 ? preds.d30.low : null, preds.d30 ? preds.d30.high : null,
                        preds.d60 ? preds.d60.roas : null, preds.d60 ? preds.d60.low : null, preds.d60 ? preds.d60.high : null,
                        preds.d120 ? preds.d120.roas : null, preds.d120 ? preds.d120.low : null, preds.d120 ? preds.d120.high : null,
                        preds.d365 ? preds.d365.roas : null, preds.d365 ? preds.d365.low : null, preds.d365 ? preds.d365.high : null,
                        parsed.trajectory || null,
                        rec.action || null, rec.reasoning || null, rec.budget_suggestion || null,
                        JSON.stringify(parsed.risk_factors || []),
                        JSON.stringify(parsed.similar_creatives || []),
                        rawText, batchId, 1
                    );

                    return { success: true, ad_name: creative.ad_name, simulation_id: info.lastInsertRowid, predictions: preds, action: rec.action };
                } catch (err) {
                    console.error(`[ci/simulate-all] Error simulating ${creative.ad_name}:`, err.message);
                    return { success: false, ad_name: creative.ad_name, error: err.message };
                }
            });

            const batchResults = await Promise.all(promises);
            results.push(...batchResults);
            console.log(`[ci/simulate-all] Batch ${Math.floor(i/3) + 1} done (${results.length}/${enrichedCreatives.length})`);
        }

        console.log(`[ci/simulate-all] Batch ${batchId} complete. ${results.filter(r => r.success).length}/${results.length} succeeded.`);
        res.json({ success: true, batchId, total: results.length, succeeded: results.filter(r => r.success).length, results });
    } catch (err) {
        console.error('CI simulate-all error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 8: Get all simulations from DB (with optional filters)
app.get('/api/ci/simulations', (req, res) => {
    try {
        const db = getCiDb();
        const { ad_name, batch_id, live_only, limit: lim } = req.query;
        let sql = 'SELECT * FROM simulations';
        const conditions = [];
        const params = [];

        if (ad_name) { conditions.push('ad_name = ?'); params.push(ad_name); }
        if (batch_id) { conditions.push('batch_id = ?'); params.push(batch_id); }
        if (live_only === '1' || live_only === 'true') { conditions.push('is_live = 1'); }

        if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
        sql += ' ORDER BY simulated_at DESC';
        if (lim) sql += ' LIMIT ' + parseInt(lim);

        const rows = db.prepare(sql).all(...params);
        // Parse JSON fields
        for (const row of rows) {
            try { row.risk_factors = JSON.parse(row.risk_factors || '[]'); } catch(e) { row.risk_factors = []; }
            try { row.similar_creatives = JSON.parse(row.similar_creatives || '[]'); } catch(e) { row.similar_creatives = []; }
        }

        res.json({ success: true, data: rows, total: rows.length });
    } catch (err) {
        console.error('CI simulations error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 9: Get latest simulation for each ad (deduplicated — one row per ad_name)
app.get('/api/ci/simulations/latest', (req, res) => {
    try {
        const db = getCiDb();
        const rows = db.prepare(`
            SELECT s.* FROM simulations s
            INNER JOIN (SELECT ad_name, MAX(id) AS max_id FROM simulations GROUP BY ad_name) latest
            ON s.id = latest.max_id
            ORDER BY s.spend DESC
        `).all();

        for (const row of rows) {
            try { row.risk_factors = JSON.parse(row.risk_factors || '[]'); } catch(e) { row.risk_factors = []; }
            try { row.similar_creatives = JSON.parse(row.similar_creatives || '[]'); } catch(e) { row.similar_creatives = []; }
        }

        res.json({ success: true, data: rows, total: rows.length });
    } catch (err) {
        console.error('CI simulations/latest error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 10: Get simulation history for a specific ad (all runs over time)
app.get('/api/ci/simulations/history/:adName', (req, res) => {
    try {
        const db = getCiDb();
        const rows = db.prepare('SELECT * FROM simulations WHERE ad_name = ? ORDER BY simulated_at DESC').all(req.params.adName);

        for (const row of rows) {
            try { row.risk_factors = JSON.parse(row.risk_factors || '[]'); } catch(e) { row.risk_factors = []; }
            try { row.similar_creatives = JSON.parse(row.similar_creatives || '[]'); } catch(e) { row.similar_creatives = []; }
        }

        res.json({ success: true, data: rows, total: rows.length });
    } catch (err) {
        console.error('CI simulation history error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 11: Update actual ROAS for a simulation (for accuracy tracking)
app.post('/api/ci/simulations/update-actuals', async (req, res) => {
    try {
        const db = getCiDb();

        // Fetch current actual ROAS from Meta + Metabase for all simulated ads
        const latestSims = db.prepare(`
            SELECT s.* FROM simulations s
            INNER JOIN (SELECT ad_name, MAX(id) AS max_id FROM simulations GROUP BY ad_name) latest
            ON s.id = latest.max_id
        `).all();

        if (latestSims.length === 0) {
            return res.json({ success: true, message: 'No simulations to update', updated: 0 });
        }

        // Fetch current Meta spend for these ads
        const dateTo = new Date().toISOString().slice(0, 10);
        const dateFrom = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);

        let allMetaRows = [];
        let nextUrl = `${META_API_BASE}/${META_AD_ACCOUNT_ID}/insights?${new URLSearchParams(metaParams({
            fields: 'ad_name,ad_id,spend',
            level: 'ad',
            time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
            limit: 500,
        })).toString()}`;

        while (nextUrl) {
            const response = await fetch(nextUrl);
            const data = await response.json();
            if (data.error) break;
            if (data.data) allMetaRows.push(...data.data);
            if (data.paging && data.paging.next) {
                const sep = data.paging.next.includes('?') ? '&' : '?';
                nextUrl = data.paging.next + sep + 'appsecret_proof=' + encodeURIComponent(META_APP_SECRET_PROOF);
            } else {
                nextUrl = null;
            }
        }

        // Aggregate spend per ad
        const spendMap = {};
        for (const row of allMetaRows) {
            spendMap[row.ad_name] = (spendMap[row.ad_name] || 0) + parseFloat(row.spend || 0);
        }

        const insertActual = db.prepare(`
            INSERT INTO simulation_actuals (simulation_id, ad_name, actual_overall_roas, actual_spend, recorded_at)
            VALUES (?, ?, ?, ?, datetime('now'))
        `);

        let updated = 0;
        for (const sim of latestSims) {
            const currentSpend = spendMap[sim.ad_name];
            if (currentSpend !== undefined) {
                insertActual.run(sim.id, sim.ad_name, sim.overall_roas, currentSpend);
                updated++;
            }
        }

        res.json({ success: true, updated, total: latestSims.length });
    } catch (err) {
        console.error('CI update-actuals error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 12: Get simulation stats/summary
app.get('/api/ci/simulations/stats', (req, res) => {
    try {
        const db = getCiDb();
        const stats = {
            total_simulations: db.prepare('SELECT COUNT(*) as c FROM simulations').get().c,
            unique_ads: db.prepare('SELECT COUNT(DISTINCT ad_name) as c FROM simulations').get().c,
            total_batches: db.prepare('SELECT COUNT(DISTINCT batch_id) as c FROM simulations').get().c,
            latest_batch: db.prepare('SELECT batch_id, simulated_at, COUNT(*) as ads_count FROM simulations GROUP BY batch_id ORDER BY simulated_at DESC LIMIT 1').get(),
            action_breakdown: db.prepare("SELECT action, COUNT(*) as count FROM simulations WHERE id IN (SELECT MAX(id) FROM simulations GROUP BY ad_name) GROUP BY action").all(),
            avg_predicted_d6: db.prepare("SELECT AVG(predicted_d6_roas) as avg FROM simulations WHERE id IN (SELECT MAX(id) FROM simulations GROUP BY ad_name)").get().avg,
        };
        res.json({ success: true, data: stats });
    } catch (err) {
        console.error('CI simulation stats error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =============================================================================
// INVENTORY SCANNER ROUTES (mounted from inventory-scanner module)
// =============================================================================

try {
    const scannerRoutes = require('../inventory-scanner/routes');
    const scannerAgents = require('../inventory-scanner/agents');
    const { getDb: getScannerDb, isSeeded: isScannerSeeded } = require('../inventory-scanner/database/db');

    // Initialize scanner DB and seed if needed
    getScannerDb();
    if (!isScannerSeeded()) {
        console.log('[Scanner] First run — seeding database...');
        try {
            const { runSeed } = require('../inventory-scanner/data/seed');
            runSeed();
            console.log('[Scanner] Database seeded');
        } catch (e) { console.error('[Scanner] Seed error:', e.message); }
    }

    // Mount all scanner API routes
    app.use('/api/inventories', scannerRoutes.inventoriesRouter);
    app.use('/api/discovery', scannerRoutes.discoveryRouter);
    app.use('/api/competitors', scannerRoutes.competitorsRouter);
    app.use('/api/onboarding', scannerRoutes.onboardingRouter);
    app.use('/api/insights', scannerRoutes.insightsRouter);
    app.use('/api/pricing', scannerRoutes.pricingRouter);
    app.use('/api/budget', scannerRoutes.budgetRouter);
    app.use('/api/formats', scannerRoutes.formatsRouter);
    app.use('/api/meta', scannerRoutes.metaRouter);
    app.use('/api/google', scannerRoutes.googleRouter);
    app.use('/api/synthesis', scannerRoutes.synthesisRouter);

    // Scheduler routes
    app.get('/api/scheduler/status', (req, res) => {
        try {
            const status = scannerAgents.getSchedulerStatus();
            res.json({ success: true, data: status, error: null, timestamp: new Date().toISOString() });
        } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
    });
    app.post('/api/scheduler/run/:jobName', async (req, res) => {
        try {
            const result = await scannerAgents.runSchedulerJob(req.params.jobName);
            res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
        } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
    });

    console.log('[Scanner] Inventory scanner routes mounted');
} catch (err) {
    console.warn('[Scanner] Could not mount inventory scanner routes:', err.message);
}

// =============================================================================
// CREATIVE INTELLIGENCE v2 — Pipeline, Dashboard, Actions, Trends
// =============================================================================

try {
    const ciRoutes = require('../creative-intelligence/routes');
    const ciRouter = ciRoutes({
        metaApiBase: META_API_BASE,
        metaAdAccountId: META_AD_ACCOUNT_ID,
        metaAccessToken: META_ACCESS_TOKEN,
        metaAppSecretProof: META_APP_SECRET_PROOF,
        metabaseUrl: METABASE_URL,
        metabaseSessionToken: METABASE_SESSION_TOKEN,
        openaiApiKey: OPENAI_API_KEY,
        targetCampaigns: TARGET_CAMPAIGNS,
    });
    app.use('/api/ci2', ciRouter);
    console.log('[CI2] Creative Intelligence v2 routes mounted at /api/ci2');
} catch (err) {
    console.warn('[CI2] Could not mount CI v2 routes:', err.message);
}

// =============================================================================
// GOOGLE ADS API ROUTES — Ad insights, funnel, campaigns
// =============================================================================

// Ensure google-creative directory exists for cache files
const gcDir = path.join(__dirname, '..', 'google-creative');
if (!fs.existsSync(gcDir)) fs.mkdirSync(gcDir, { recursive: true });

function hasGoogleAdsCredentials() {
    return !!(
        process.env.GOOGLE_ADS_CLIENT_ID &&
        process.env.GOOGLE_ADS_CLIENT_SECRET &&
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
        process.env.GOOGLE_ADS_CUSTOMER_ID &&
        process.env.GOOGLE_ADS_REFRESH_TOKEN
    );
}

function requireGoogleAdsId(value, fieldName) {
    const id = String(value || '').trim();
    if (!/^\d+$/.test(id)) {
        throw new Error(`${fieldName} must be a numeric Google Ads ID`);
    }
    return id;
}

function createGoogleAdsCustomer(options = {}) {
    if (!hasGoogleAdsCredentials()) {
        throw new Error('Google Ads API credentials not configured');
    }

    const { GoogleAdsApi } = require('google-ads-api');
    const client = new GoogleAdsApi({
        client_id: process.env.GOOGLE_ADS_CLIENT_ID,
        client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
        developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });

    const hooks = options.validateOnly ? {
        onMutationStart: async ({ editOptions }) => {
            editOptions({ validate_only: true });
        },
    } : undefined;

    return client.Customer({
        customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
        login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
        refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    }, hooks);
}

// Route 1: POST /api/google/ad-insights-daily
app.post('/api/google/ad-insights-daily', async (req, res) => {
    try {
        const { dateFrom, dateTo, noCache } = req.body;
        if (!dateFrom || !dateTo) return res.status(400).json({ success: false, error: 'dateFrom and dateTo required' });

        // Cache check (same pattern as Meta)
        const cacheKey = `gc_insights_${dateFrom}_${dateTo}`;
        const diskFile = path.join(__dirname, '..', 'google-creative', `insights-cache-${dateFrom}-${dateTo}.json`);
        if (!noCache) {
            const cached = getCached(cacheKey);
            if (cached) return res.json({ success: true, data: cached, total: cached.length, cached: true });
            try {
                if (fs.existsSync(diskFile)) {
                    const disk = JSON.parse(fs.readFileSync(diskFile, 'utf-8'));
                    if (disk.ts && Date.now() - disk.ts < 24 * 3600000) {
                        setCache(cacheKey, disk.data);
                        return res.json({ success: true, data: disk.data, total: disk.data.length, cached: true });
                    }
                }
            } catch(e) {}
        }

        // Check credentials
        if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN || !process.env.GOOGLE_ADS_REFRESH_TOKEN) {
            return res.json({ success: true, data: [], total: 0, warning: 'Google Ads API credentials not configured' });
        }

        const { GoogleAdsApi } = require('google-ads-api');
        const client = new GoogleAdsApi({
            client_id: process.env.GOOGLE_ADS_CLIENT_ID,
            client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
            developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        });
        const customer = client.Customer({
            customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
            login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
            refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
        });

        // Fetch campaign + ad group level daily data
        const rows = await customer.query(`
            SELECT
                segments.date,
                campaign.id,
                campaign.name,
                campaign.status,
                campaign.advertising_channel_type,
                ad_group.id,
                ad_group.name,
                metrics.cost_micros,
                metrics.impressions,
                metrics.clicks,
                metrics.conversions,
                metrics.all_conversions_value
            FROM ad_group
            WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
              AND campaign.status = 'ENABLED'
            ORDER BY segments.date DESC
        `);

        const data = rows.map(r => ({
            date_start: r.segments.date,
            campaign_name: r.campaign.name,
            campaign_id: String(r.campaign.id),
            campaign_type: r.campaign.advertising_channel_type,
            adset_name: r.ad_group.name,
            adset_id: String(r.ad_group.id),
            spend: (r.metrics.cost_micros || 0) / 1_000_000,
            impressions: r.metrics.impressions || 0,
            clicks: r.metrics.clicks || 0,
            conversions: r.metrics.conversions || 0,
            conversion_value: r.metrics.all_conversions_value || 0,
        }));

        setCache(cacheKey, data);
        try { fs.writeFileSync(diskFile, JSON.stringify({ ts: Date.now(), data })); } catch(e) {}
        console.log(`[gc-insights] ${data.length} rows fetched (${dateFrom} to ${dateTo})`);
        res.json({ success: true, data, total: data.length });
    } catch (err) {
        // Fallback to disk cache
        const diskFile = path.join(__dirname, '..', 'google-creative', `insights-cache-${req.body.dateFrom}-${req.body.dateTo}.json`);
        try {
            if (fs.existsSync(diskFile)) {
                const stale = JSON.parse(fs.readFileSync(diskFile, 'utf-8'));
                return res.json({ success: true, data: stale.data, total: stale.data.length, cached: true, stale: true });
            }
        } catch(e2) {}
        const errMsg = err.message || err.details || JSON.stringify(err) || 'Unknown Google Ads API error';
        console.error('[gc-insights] Error:', errMsg);
        res.status(500).json({ success: false, error: errMsg, data: [] });
    }
});

// Route 2: POST /api/google/ad-funnel — Google Ads funnel data from Metabase
app.post('/api/google/ad-funnel', async (req, res) => {
    try {
        const { dateFrom, dateTo, noCache } = req.body;
        if (!dateFrom || !dateTo) {
            return res.status(400).json({ success: false, error: 'dateFrom and dateTo are required' });
        }

        const funnelCacheKey = `gc_funnel_${dateFrom}_${dateTo}`;
        const funnelDiskFile = path.join(__dirname, '..', 'google-creative', `gc-funnel-cache-${dateFrom}-${dateTo}.json`);
        if (!noCache) {
            const funnelCached = getCached(funnelCacheKey);
            if (funnelCached) {
                console.log(`[gc-ad-funnel] Serving from memory (${funnelCached.length} rows)`);
                return res.json({ success: true, data: funnelCached, total: funnelCached.length, cached: true });
            }
            try {
                if (fs.existsSync(funnelDiskFile)) {
                    const disk = JSON.parse(fs.readFileSync(funnelDiskFile, 'utf-8'));
                    if (disk.ts && Date.now() - disk.ts < 2 * 3600000 && disk.data && disk.data.length > 0) {
                        console.log(`[gc-ad-funnel] Serving from disk (${disk.data.length} rows, ${Math.round((Date.now() - disk.ts) / 60000)}min old)`);
                        setCache(funnelCacheKey, disk.data);
                        return res.json({ success: true, data: disk.data, total: disk.data.length, cached: true });
                    }
                }
            } catch(e) {}
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        const sql = `
WITH user_data AS (
  SELECT
    uad.user_id,
    LOWER(TRIM(uad.tracker_sub_campaign_name)) AS tracker_sub_campaign_name,
    uad.tracker_campaign_name,
    uad.creative AS tracker_name,
    priority,
    CASE WHEN uad.network ILIKE '%Google%' AND network <> 'Google Pay (Custom)' THEN 'Google' ELSE uad.network END AS network,
    date(created_at) AS event_date
  FROM user_additional_details uad
  LEFT JOIN users u ON u.id = uad.user_id
  LEFT JOIN (SELECT DISTINCT "Adset ID"::bigint AS "Adset ID" FROM "Demat_Campaigns" WHERE "Adset ID" IS NOT NULL AND TRIM("Adset ID") <> '') ch ON ch."Adset ID" = uad.tracker_sub_campaign_id
  WHERE "Adset ID" IS NULL
    AND uad.user_id IN (SELECT id FROM users WHERE referred_by IS NULL AND user_interest IS NULL)
    AND uad.user_id IN (SELECT u.id FROM user_devices ud WHERE ud.user_id = u.id AND ud.os IN ('android','Android Web'))
    AND date(u.created_at) >= '${dateFrom}'
    AND date(u.created_at) <= '${dateTo}'
    AND uad.network ILIKE '%Google%' AND uad.network <> 'Google Pay (Custom)'
),
first_payments AS (
  SELECT
    user_id, min(payment_date) as payment_date,
    sum(case when rt = 1 then amount else null end) as amount,
    sum(case when rt > 1 then amount else null end) as repeat_amount,
    count(case when rt > 1 then amount else null end) as repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 6 then amount else null end) as d6_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 6 then amount else null end) as d6_repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 15 then amount else null end) as d15_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 15 then amount else null end) as d15_repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 30 then amount else null end) as d30_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 30 then amount else null end) as d30_repeat_con,
    sum(case when date(payment_date) - date(created_at) <= 60 then amount else null end) as d60_repeat_amount,
    count(case when date(payment_date) - date(created_at) <= 60 then amount else null end) as d60_repeat_con,
    sum(amount) as overall_amt,
    count(user_id) as overall_con
  FROM (
    SELECT user_id, payment_date, amount, created_at,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY payment_date) AS rt
    FROM user_transaction_history uth
    LEFT JOIN users u ON u.id = uth.user_id
    WHERE status = 'CHARGED' AND amount > 50
  ) sub
  GROUP BY 1
),
trial AS (
  SELECT user_id, trial_date FROM (
    SELECT user_id, payment_date AS trial_date, plan_id,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY payment_date DESC) AS rk
    FROM user_transaction_history
    WHERE (plan_id IN ('plan_000','plan_000_plus','plan_000_super') OR plan_id ILIKE '%trial%')
      AND status = 'CHARGED'
  ) sub WHERE rk = 1
),
signup_metrics AS (
  SELECT
    ud.event_date,
    ud.tracker_campaign_name,
    ud.tracker_sub_campaign_name,
    regexp_replace(ud.tracker_name, ':.*$', '', 'g') AS tracker_name,
    COUNT(DISTINCT ud.user_id) AS total_signup,
    COUNT(DISTINCT CASE WHEN ud.priority = 'PAYMENT-P0' THEN ud.user_id END) AS p0_signup,
    COUNT(DISTINCT CASE WHEN ud.priority = 'PAYMENT-P1' THEN ud.user_id END) AS p1_signup,
    COUNT(DISTINCT t.user_id) AS total_trial,
    COUNT(DISTINCT CASE WHEN DATE(fp.payment_date) = ud.event_date THEN fp.user_id END) AS d0,
    SUM(CASE WHEN DATE(fp.payment_date) = ud.event_date THEN fp.amount ELSE 0 END) AS d0_revenue,
    COUNT(DISTINCT CASE WHEN DATE(fp.payment_date) <= ud.event_date + INTERVAL '6 day' THEN fp.user_id END) AS d6,
    SUM(CASE WHEN DATE(fp.payment_date) <= ud.event_date + INTERVAL '6 day' THEN fp.amount ELSE 0 END) AS d6_revenue,
    COUNT(DISTINCT fp.user_id) AS new_converted_user,
    SUM(fp.amount) AS new_user_rev,
    SUM(fp.overall_amt) AS overall_revenue,
    COUNT(DISTINCT CASE WHEN DATE(trial_date) = DATE(ud.event_date) THEN t.user_id END) AS d0_trial,
    SUM(d6_repeat_con) AS d6_overall_con,
    SUM(d6_repeat_amount) AS d6_overall_revenue,
    SUM(d15_repeat_con) AS d15_overall_con,
    SUM(d15_repeat_amount) AS d15_overall_revenue,
    SUM(d30_repeat_con) AS d30_overall_con,
    SUM(d30_repeat_amount) AS d30_overall_revenue,
    SUM(d60_repeat_con) AS d60_overall_con,
    SUM(d60_repeat_amount) AS d60_overall_revenue
  FROM user_data ud
  LEFT JOIN first_payments fp ON ud.user_id = fp.user_id
  LEFT JOIN trial t ON ud.user_id = t.user_id
  GROUP BY 1,2,3,4
)
SELECT
  sm.event_date AS date,
  sm.tracker_campaign_name AS campaign_name,
  sm.tracker_sub_campaign_name AS ad_set_name,
  sm.tracker_name,
  SUM(sm.total_signup) AS signups,
  SUM(sm.p0_signup) AS p0_signup,
  SUM(sm.p1_signup) AS p1_signup,
  SUM(sm.total_trial) AS total_trial,
  SUM(sm.d0_trial) AS d0_trial,
  SUM(sm.d0) AS d0,
  SUM(sm.d0_revenue) AS d0_revenue,
  SUM(sm.d6) AS d6,
  SUM(sm.d6_revenue) AS d6_revenue,
  SUM(sm.new_converted_user) AS new_converted_user,
  SUM(sm.new_user_rev) AS new_user_rev,
  SUM(sm.overall_revenue) AS overall_revenue,
  SUM(sm.d6_overall_con) AS d6_overall_con,
  SUM(sm.d6_overall_revenue) AS d6_overall_revenue,
  SUM(sm.d15_overall_con) AS d15_overall_con,
  SUM(sm.d15_overall_revenue) AS d15_overall_revenue,
  SUM(sm.d30_overall_con) AS d30_overall_con,
  SUM(sm.d30_overall_revenue) AS d30_overall_revenue,
  SUM(sm.d60_overall_con) AS d60_overall_con,
  SUM(sm.d60_overall_revenue) AS d60_overall_revenue
FROM signup_metrics sm
GROUP BY 1,2,3,4
ORDER BY SUM(sm.total_signup) DESC`;

        if (!METABASE_SESSION_TOKEN) {
            throw new Error('Metabase session token is missing. Set METABASE_SESSION_TOKEN in uploader/.env and restart the server.');
        }

        console.log('[gc-ad-funnel] Running Metabase query...');
        const metabaseRes = await fetch(`${METABASE_URL}/api/dataset`, {
            method: 'POST',
            headers: {
                'X-Metabase-Session': METABASE_SESSION_TOKEN,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                database: 2,
                type: 'native',
                native: { query: sql },
                constraints: { 'max-results': 100000, 'max-results-bare-rows': 100000 },
            }),
        });

        if (!metabaseRes.ok) {
            const errText = await metabaseRes.text();
            if (metabaseRes.status === 401) {
                throw new Error(`Metabase session expired or is invalid (401): ${errText}`);
            }
            throw new Error(`Metabase API error (${metabaseRes.status}): ${errText}`);
        }

        const result = await metabaseRes.json();
        const columns = result.data.cols.map(c => c.name);
        const rows = result.data.rows.map(row => {
            const obj = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            return obj;
        });

        const truncated = result.data.rows_truncated || false;
        console.log(`[gc-ad-funnel] Done. ${rows.length} rows returned. Truncated: ${truncated}`);
        setCache(funnelCacheKey, rows);
        try { fs.writeFileSync(funnelDiskFile, JSON.stringify({ ts: Date.now(), data: rows })); } catch(e) {}

        res.json({ success: true, data: rows, total: rows.length, truncated });
    } catch (err) {
        try {
            if (fs.existsSync(funnelDiskFile)) {
                const stale = JSON.parse(fs.readFileSync(funnelDiskFile, 'utf-8'));
                console.log(`[gc-ad-funnel] Error fallback — disk (${stale.data.length} rows)`);
                setCache(funnelCacheKey, stale.data);
                return res.json({
                    success: true,
                    data: stale.data,
                    total: stale.data.length,
                    cached: true,
                    stale: true,
                    warning: err.message,
                });
            }
        } catch(e2) {}
        console.error('Metabase gc-ad-funnel error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 3: GET /api/google/campaigns — List Google Ads campaigns
app.get('/api/google/campaigns', async (req, res) => {
    try {
        if (!process.env.GOOGLE_ADS_DEVELOPER_TOKEN || !process.env.GOOGLE_ADS_REFRESH_TOKEN) {
            return res.json({ success: true, data: [], warning: 'Google Ads API credentials not configured' });
        }
        const { GoogleAdsApi } = require('google-ads-api');
        const client = new GoogleAdsApi({
            client_id: process.env.GOOGLE_ADS_CLIENT_ID,
            client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
            developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
        });
        const customer = client.Customer({
            customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
            login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
            refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
        });
        const rows = await customer.query(`
            SELECT campaign.id, campaign.name, campaign.status,
                   campaign.advertising_channel_type, campaign.bidding_strategy_type,
                   campaign_budget.amount_micros
            FROM campaign
            WHERE campaign.status != 'REMOVED'
            ORDER BY campaign.name
        `);
        const data = rows.map(r => ({
            campaign_id: String(r.campaign.id),
            campaign_name: r.campaign.name,
            status: r.campaign.status === 2 ? 'ENABLED' : r.campaign.status === 3 ? 'PAUSED' : 'OTHER',
            channel_type: r.campaign.advertising_channel_type,
            bidding_strategy: r.campaign.bidding_strategy_type,
            budget_per_day: (r.campaign_budget?.amount_micros || 0) / 1_000_000,
        }));
        res.json({ success: true, data, total: data.length });
    } catch(err) {
        console.error('[gc-campaigns] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 4: POST /api/google/campaign-budget — Update Google campaign budget
app.post('/api/google/campaign-budget', async (req, res) => {
    try {
        if (!hasGoogleAdsCredentials()) {
            return res.status(500).json({ success: false, error: 'Google Ads API credentials not configured' });
        }

        const campaignId = requireGoogleAdsId(req.body && req.body.campaign_id, 'campaign_id');
        const action = String((req.body && req.body.action) || '').toLowerCase();
        const validateOnly = !!(req.body && req.body.validate_only);
        const pctInput = Number(
            req.body && (req.body.pct != null ? req.body.pct : req.body.change_pct)
        );
        const changePct = pctInput > 0
            ? pctInput
            : (action === 'increase' || action === 'decrease' ? 20 : 0);

        if (!['increase', 'decrease'].includes(action)) {
            return res.status(400).json({ success: false, error: 'action must be increase or decrease' });
        }
        if (!(changePct > 0 && changePct <= 90)) {
            return res.status(400).json({ success: false, error: 'pct must be between 1 and 90' });
        }

        const customer = createGoogleAdsCustomer({ validateOnly });
        const rows = await customer.query(`
            SELECT
                campaign.id,
                campaign.name,
                campaign_budget.resource_name,
                campaign_budget.amount_micros
            FROM campaign
            WHERE campaign.id = ${campaignId}
            LIMIT 1
        `);

        if (!rows.length) {
            return res.status(404).json({ success: false, error: 'Campaign not found', campaign_id: campaignId });
        }

        const row = rows[0];
        const previousBudgetMicros = Number(row.campaign_budget?.amount_micros) || 0;
        if (previousBudgetMicros <= 0) {
            return res.status(400).json({ success: false, error: 'Campaign budget is missing or invalid', campaign_id: campaignId });
        }

        const factor = action === 'increase' ? (1 + (changePct / 100)) : (1 - (changePct / 100));
        const nextBudgetMicros = Math.max(1_000_000, Math.round(previousBudgetMicros * factor));

        await customer.mutateResources([{
            entity: 'campaign_budget',
            operation: 'update',
            resource: {
                resource_name: row.campaign_budget.resource_name,
                amount_micros: nextBudgetMicros,
            },
        }]);

        console.log(`[gc-budget] ${validateOnly ? 'Validated' : 'Updated'} campaign ${campaignId} ${action} ${changePct}%`);
        res.json({
            success: true,
            validate_only: validateOnly,
            campaign_id: campaignId,
            campaign_name: row.campaign.name,
            action,
            change_pct: changePct,
            previous_budget: previousBudgetMicros / 1_000_000,
            new_budget: nextBudgetMicros / 1_000_000,
        });
    } catch (err) {
        console.error('[gc-budget] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Route 5: POST /api/google/adgroup-status — Pause or enable a Google ad group
app.post('/api/google/adgroup-status', async (req, res) => {
    try {
        if (!hasGoogleAdsCredentials()) {
            return res.status(500).json({ success: false, error: 'Google Ads API credentials not configured' });
        }

        const adgroupId = requireGoogleAdsId(
            (req.body && (req.body.adgroup_id != null ? req.body.adgroup_id : req.body.ad_group_id)),
            'adgroup_id'
        );
        const status = String((req.body && req.body.status) || '').toUpperCase();
        const validateOnly = !!(req.body && req.body.validate_only);

        if (!['PAUSED', 'ENABLED'].includes(status)) {
            return res.status(400).json({ success: false, error: 'status must be PAUSED or ENABLED' });
        }

        const customer = createGoogleAdsCustomer({ validateOnly });
        const rows = await customer.query(`
            SELECT
                ad_group.id,
                ad_group.name,
                ad_group.resource_name,
                ad_group.status,
                campaign.id,
                campaign.name
            FROM ad_group
            WHERE ad_group.id = ${adgroupId}
            LIMIT 1
        `);

        if (!rows.length) {
            return res.status(404).json({ success: false, error: 'Ad group not found', adgroup_id: adgroupId });
        }

        const row = rows[0];
        const statusValue = status === 'PAUSED' ? 3 : 2;

        await customer.mutateResources([{
            entity: 'ad_group',
            operation: 'update',
            resource: {
                resource_name: row.ad_group.resource_name,
                status: statusValue,
            },
        }]);

        console.log(`[gc-adgroup] ${validateOnly ? 'Validated' : 'Updated'} ad group ${adgroupId} -> ${status}`);
        res.json({
            success: true,
            validate_only: validateOnly,
            adgroup_id: adgroupId,
            adgroup_name: row.ad_group.name,
            campaign_id: String(row.campaign.id),
            campaign_name: row.campaign.name,
            previous_status: row.ad_group.status,
            new_status: status,
        });
    } catch (err) {
        console.error('[gc-adgroup] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// =============================================================================
// GOOGLE CREATIVE INTELLIGENCE — Google Ads creative analysis layer
// =============================================================================

try {
    const gcRoutes = require('../google-creative/server');
    const gcRouter = gcRoutes({
        metabaseUrl: METABASE_URL,
        metabaseSessionToken: METABASE_SESSION_TOKEN,
        openaiApiKey: OPENAI_API_KEY,
    });
    app.use('/api/gc', gcRouter);
    console.log('[GC] Google Creative Intelligence routes mounted at /api/gc');
} catch (err) {
    console.warn('[GC] Could not mount Google Creative Intelligence routes:', err.message);
}

// =============================================================================
// META WRITE API — Campaign Optimizer execution
// =============================================================================

try {
    const metaWrite = require('./meta-write');
    app.use('/api/meta-write', metaWrite);
    console.log('[MetaWrite] Meta write routes mounted at /api/meta-write');
} catch (err) {
    console.warn('[MetaWrite] Could not mount meta-write routes:', err.message);
}

// =============================================================================
// TREND SCANNER
// =============================================================================
try {
    const trendRoutes = require('../trend-scanner/routes');
    app.use('/api/trends', trendRoutes);
    console.log('[TrendScanner] Trend scanner routes mounted at /api/trends');
} catch (err) {
    console.warn('[TrendScanner] Could not mount trend-scanner routes:', err.message);
}

// =============================================================================
// COMPETITOR INTELLIGENCE — Real-time competitor ad analysis + AI briefs
// =============================================================================
try {
    const competitorRoutes = require('../competitor-routes');
    const competitorRouter = competitorRoutes({
        metaAccessToken: META_ACCESS_TOKEN,
        openaiApiKey: OPENAI_API_KEY,
    });
    app.use('/api/competitor', competitorRouter);
    console.log('[CompetitorIntel] Competitor intelligence routes mounted at /api/competitor');
} catch (err) {
    console.warn('[CompetitorIntel] Could not mount competitor intelligence routes:', err.message);
}

// =============================================================================
// FEEDBACK ENGINE (Self-Learning)
// =============================================================================
try {
    const feedbackRoutes = require('../feedback-engine/server');
    const feRouter = feedbackRoutes({ metabaseUrl: METABASE_URL, metabaseSessionToken: METABASE_SESSION_TOKEN, openaiApiKey: OPENAI_API_KEY });
    app.use('/api/fe', feRouter);
    require('../feedback-engine/agents/feScheduler');
    console.log('[FeedbackEngine] Self-learning routes mounted at /api/fe');
} catch (err) {
    console.warn('[FeedbackEngine] Could not mount feedback engine:', err.message);
}

// =============================================================================
// AUDIENCE TESTING — Audience performance scanner + AI recommendations
// =============================================================================
try {
    const atRoutes = require('../audience-testing/server');
    const atRouter = atRoutes({
        metaAccessToken: META_ACCESS_TOKEN,
        metaAdAccountId: META_AD_ACCOUNT_ID,
        metabaseUrl: METABASE_URL,
        metabaseSessionToken: METABASE_SESSION_TOKEN,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    });
    app.use('/api/at', atRouter);
    app.use('/audience-testing/public', express.static(path.join(__dirname, '..', 'audience-testing', 'public')));
    require('../audience-testing/agents/atScheduler');
    console.log('[AudienceTesting] Routes mounted at /api/at, scheduler started');
} catch (err) {
    console.warn('[AudienceTesting] Could not mount audience testing:', err.message);
}

// =============================================================================
// START SERVER
// =============================================================================

// Export for Vercel serverless, start server for local dev
if (process.env.VERCEL) {
    module.exports = app;
} else {
    app.listen(PORT, () => {
        console.log(`Meta Ad Upload Server running on http://localhost:${PORT}`);
        console.log(`Ad Account: ${META_AD_ACCOUNT_ID}`);
        console.log(`API Version: ${META_API_VERSION}`);

        // Pre-warm cache after 5 seconds (let server settle + avoid competing with ROAS tracker)
        setTimeout(() => {
            const warmTo = new Date().toISOString().slice(0, 10);
            const warmFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
            console.log(`[Cache] Pre-warming insights cache (${warmFrom} to ${warmTo})...`);
            Promise.all([
                fetch(`http://localhost:${PORT}/api/meta/ad-insights-daily`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dateFrom: warmFrom, dateTo: warmTo })
                }).then(r => r.json()).then(d => {
                    console.log(`[Cache] Insights pre-warmed: ${d.total || 0} rows`);
                }),
                fetch(`http://localhost:${PORT}/api/metabase/ad-funnel`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dateFrom: warmFrom, dateTo: warmTo })
                }).then(r => r.json()).then(d => {
                    console.log(`[Cache] Funnel pre-warmed: ${d.total || 0} rows`);
                }),
                fetch(`http://localhost:${PORT}/api/meta/ads-status`).then(r => r.json()).then(d => {
                    console.log(`[Cache] Ads-status pre-warmed: ${d.total || 0} ads`);
                })
            ]).catch(e => console.warn('[Cache] Pre-warm failed:', e.message));
        }, 5000);
    });
}
