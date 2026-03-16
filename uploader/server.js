// =============================================================================
// Meta Ad Upload Server
// Node.js Express server for automating Meta (Facebook) ad uploads
// =============================================================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pipeline } = require('stream/promises');

// =============================================================================
// CONFIGURATION
// =============================================================================

const META_ACCESS_TOKEN = 'EAAHDBv0GZCRYBQyK7aPCLInqIH1BCZAl5p3CLHZAngLOWT00ZAcXe84uW9CHogplylkwyovDH9473hg6CMEArA9ZAyR6wKJK3MIrLvb9YHqQDiLVSDw08MMSEBu5kucQr9TNZClZATU8FvB8XHVHuDyEKzZBhjFYA4saidojpVmZAQYpwd1ukGsGkuCvg56MDLwZDZD';
const META_APP_SECRET = 'ab84f581ca7dfd75d6e64ff8771dc359';
const META_APP_SECRET_PROOF = '90ac6dda5c28ea7294af38156e56aa6f48d3027b6cbf86763f02e364e55bd414';
const META_AD_ACCOUNT_ID = 'act_725019929189148';
const META_API_VERSION = 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// Google Sheet config — fill these in as needed
const GOOGLE_SHEET_ID = '';
const GOOGLE_SHEET_TAB = '';
const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyKYm0aNJHvjAuc6KxrcZAzuIpc2qs_RT8sbngiwC5-m-6-2gPVY7uV2z4gSFLtVHTysw/exec';

// Helper: write results back to Google Sheet via Apps Script
async function writeResultToSheet(rowIndex, data, tabName) {
    try {
        const payload = {
            row: rowIndex + 1, // +1 because sheet row 1 is headers, data starts at row 2
            tab: tabName || 'Sheet1',
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

const PORT = 3000;

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

// Static files
app.use(express.static(__dirname));

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
    formData.append('source', new Blob([fileBuffer], { type: contentType }), filename);
    formData.append('access_token', META_ACCESS_TOKEN);
    formData.append('appsecret_proof', META_APP_SECRET_PROOF);
    for (const [k, v] of Object.entries(extraFields)) {
        formData.append(k, v);
    }
    const resp = await fetch(url, {
        method: 'POST',
        body: formData,
    });
    const data = await resp.json();
    console.log(`[META POST FORM] response:`, JSON.stringify(data));
    if (data.error) {
        const err = new Error(data.error.message || 'Meta API error');
        err.metaError = data.error;
        throw err;
    }
    return data;
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

async function downloadDriveFile(driveUrl) {
    const fileId = extractDriveFileId(driveUrl);
    if (!fileId) throw new Error(`Could not extract Google Drive file ID from: ${driveUrl}`);

    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    const resp = await fetch(downloadUrl, { redirect: 'follow' });
    if (!resp.ok) throw new Error(`Failed to download from Google Drive: HTTP ${resp.status}`);

    const contentType = resp.headers.get('content-type') || 'application/octet-stream';
    const contentDisp = resp.headers.get('content-disposition') || '';

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

    return { tmpPath, contentType, filename };
}

function cleanupTempFile(tmpPath) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
}

// =============================================================================
// ROUTES
// =============================================================================

// 1. Serve upload.html
app.get('/', (req, res) => {
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

        const data = await metaPostForm(`/${META_AD_ACCOUNT_ID}/advideos`, tmpPath, file.filename, file.contentType, extraFields);
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
            const fbPositions = config.facebook_positions || ['feed', 'video_feeds', 'story', 'facebook_reels', 'facebook_reels_overlay', 'profile_feed', 'instream_video', 'marketplace', 'search'];
            targeting.facebook_positions = (Array.isArray(fbPositions) ? fbPositions : String(fbPositions).split(/[,|]/).map(s => s.trim()).filter(Boolean))
                .map(p => p === 'reels' ? 'facebook_reels' : p);

            const igPositions = config.instagram_positions || ['stream', 'story', 'reels', 'explore', 'explore_home', 'ig_search', 'profile_reels', 'profile_feed'];
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
        }

        // ------------------------------------------------------------------
        // Step 1: Upload assets (horizontal, vertical, square)
        // ------------------------------------------------------------------
        const assets = {};

        if (assetType === 'image') {
            // Upload images in parallel
            const uploadPromises = [];
            const sizes = ['horizontal', 'vertical', 'square'];

            for (const size of sizes) {
                const driveUrl = driveUrls[size];
                if (!driveUrl) {
                    logStep(`upload_image_${size}`, false, { error: `${size} drive URL not provided` });
                    continue;
                }
                uploadPromises.push(
                    (async () => {
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
                    })()
                );
            }
            await Promise.all(uploadPromises);
        } else {
            // Upload videos sequentially, then poll
            const sizes = ['horizontal', 'vertical', 'square'];
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
                    const data = await metaPostForm(`/${META_AD_ACCOUNT_ID}/advideos`, tmpPath, file.filename, file.contentType, { title: `${videoTitle} (${size})` });
                    const videoId = data.id;
                    if (!videoId) throw new Error('No video ID returned');

                    // Poll for ready
                    const timeoutMs = 180000;
                    const pollInterval = 3000;
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
                    logStep(`upload_video_${size}`, true, { videoId, ready });
                } catch (err) {
                    logStep(`upload_video_${size}`, false, { error: err.message });
                    throw err;
                } finally {
                    if (tmpPath) cleanupTempFile(tmpPath);
                }
            }

            // Upload thumbnail images for videos if provided
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
        if (promotedObject) adsetParams.promoted_object = JSON.stringify(promotedObject);

        // India securities & investments regulatory requirement
        adsetParams.regional_regulated_categories = JSON.stringify(['INDIA_FINSERV']);
        const regulatoryId = config.regulatory_identity_id || '1698107647490483';
        adsetParams.regional_regulation_identities = JSON.stringify({
            india_finserv_beneficiary: regulatoryId,
            india_finserv_payer: regulatoryId,
        });

        let adsetId;
        try {
            const adsetData = await metaPost(`/${META_AD_ACCOUNT_ID}/adsets`, adsetParams);
            adsetId = adsetData.id;
            logStep('create_adset', true, { adsetId });
        } catch (err) {
            logStep('create_adset', false, { error: err.message, metaError: err.metaError });
            throw err;
        }

        // ------------------------------------------------------------------
        // Step 3: Create ad creative with asset customization
        // ------------------------------------------------------------------
        const bodyText = config.primary_text || config.body_text || '';
        const titleText = config.headline || config.title_text || '';
        const descText = config.description || config.description_text || '';
        const ctaType = config.cta || config.call_to_action || 'INSTALL_MOBILE_APP';
        const linkUrl = config.link_url || '';
        const storeUrl = config.object_store_url || '';
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

                const vidFeedSpec = {
                    videos,
                    ad_formats: ['SINGLE_VIDEO'],
                    bodies: [{ text: bodyText }],
                    titles: [{ text: titleText }],
                    descriptions: [{ text: descText }],
                    call_to_action_types: [ctaType],
                    link_urls: [{ website_url: feedLinkUrl }],
                    asset_customization_rules: [
                        {
                            customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['feed', 'video_feeds', 'instream_video', 'profile_feed'] },
                            video_label: { name: 'square' },
                        },
                        {
                            customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['story', 'facebook_reels', 'facebook_reels_overlay'] },
                            video_label: { name: 'vertical' },
                        },
                        {
                            customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['search', 'marketplace'] },
                            video_label: { name: 'horizontal' },
                        },
                        {
                            customization_spec: { publisher_platforms: ['instagram'], instagram_positions: ['stream', 'explore', 'explore_home', 'ig_search', 'profile_feed'] },
                            video_label: { name: 'square' },
                        },
                        {
                            customization_spec: { publisher_platforms: ['instagram'], instagram_positions: ['story', 'reels', 'profile_reels'] },
                            video_label: { name: 'vertical' },
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

                const imgFeedSpec = {
                    images,
                    ad_formats: ['SINGLE_IMAGE'],
                    bodies: [{ text: bodyText }],
                    titles: [{ text: titleText }],
                    descriptions: [{ text: descText }],
                    call_to_action_types: [ctaType],
                    link_urls: [{ website_url: feedLinkUrl }],
                    asset_customization_rules: [
                        {
                            customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['feed', 'video_feeds', 'instream_video', 'profile_feed'] },
                            image_label: { name: 'square' },
                        },
                        {
                            customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['story', 'facebook_reels', 'facebook_reels_overlay'] },
                            image_label: { name: 'vertical' },
                        },
                        {
                            customization_spec: { publisher_platforms: ['facebook'], facebook_positions: ['search', 'marketplace'] },
                            image_label: { name: 'horizontal' },
                        },
                        {
                            customization_spec: { publisher_platforms: ['instagram'], instagram_positions: ['stream', 'explore', 'explore_home', 'ig_search', 'profile_feed'] },
                            image_label: { name: 'square' },
                        },
                        {
                            customization_spec: { publisher_platforms: ['instagram'], instagram_positions: ['story', 'reels', 'profile_reels'] },
                            image_label: { name: 'vertical' },
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

            // Add deferred deep link if link_url differs from store URL
            if (linkUrl && linkUrl !== feedLinkUrl) {
                creativeParams.link_deep_link_url = linkUrl;
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

            // No extra deeplink params needed on the ad - it's set on the creative

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
// START SERVER
// =============================================================================

app.listen(PORT, () => {
    console.log(`Meta Ad Upload Server running on http://localhost:${PORT}`);
    console.log(`Ad Account: ${META_AD_ACCOUNT_ID}`);
    console.log(`API Version: ${META_API_VERSION}`);
});
