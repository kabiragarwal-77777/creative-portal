// ============================================================
// DATA INTEGRITY TESTS — creative-intelligence/integrityTests.js
// Runs on server start + every 6 hours to verify data pipeline integrity.
// ============================================================

const fs = require('fs');
const path = require('path');
const { getMetabaseSessionToken, refreshMetabaseSessionToken } = require('../config/env');

const RESULTS_FILE = path.join(__dirname, '..', 'data_integrity_results.json');
const SIX_HOURS = 6 * 60 * 60 * 1000;

let latestResults = null;
let intervalHandle = null;

// ---- Helpers ----

function normAdName(name) {
    if (!name) return '';
    return name.toLowerCase().trim().replace(/:.*$/, '').replace('statics_', 'static_');
}

function now() {
    return new Date().toISOString();
}

// ---- Test definitions ----

function buildTests(config) {
    const META_API_BASE = config.metaApiBase || 'https://graph.facebook.com/v21.0';
    const META_AD_ACCOUNT_ID = config.metaAdAccountId || 'act_725019929189148';
    const META_ACCESS_TOKEN = config.metaAccessToken || '';
    const META_APP_SECRET_PROOF = config.metaAppSecretProof || '';
    const METABASE_URL = config.metabaseUrl || 'https://analytics.univest.in';
    const TARGET_CAMPAIGNS = config.targetCampaigns || [];
    const socialNetworkWhere = (prefix = '') => `(${prefix}network ILIKE '%facebook%' OR ${prefix}network ILIKE '%instagram%' OR ${prefix}network = 'Facebook')`;

    function resolveMetabaseSessionToken() {
        return getMetabaseSessionToken() || config.metabaseSessionToken || '';
    }

    // Reusable: query Metabase with raw SQL, returns array of row objects
    async function metabaseQuery(sql) {
        const request = (sessionToken) => fetch(`${METABASE_URL}/api/dataset`, {
            method: 'POST',
            headers: {
                'X-Metabase-Session': sessionToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ database: 2, type: 'native', native: { query: sql } }),
        });
        let token = resolveMetabaseSessionToken();
        if (!token) token = await refreshMetabaseSessionToken('creative integrity tests').catch(() => '');
        let res = token ? await request(token) : null;
        if (res && res.status === 401) {
            const refreshed = await refreshMetabaseSessionToken('creative integrity tests 401').catch(() => '');
            if (refreshed) res = await request(refreshed);
        }
        if (!res || !res.ok) {
            if (!res) throw new Error('Metabase token unavailable');
            const text = await res.text();
            throw new Error(`Metabase ${res.status}: ${text.slice(0, 200)}`);
        }
        const result = await res.json();
        if (!result.data || !result.data.rows) return [];
        const columns = result.data.cols.map(c => c.name);
        return result.data.rows.map(row => {
            const obj = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            return obj;
        });
    }

    // Reusable: call Meta Graph API, returns parsed JSON
    async function metaApiFetch(endpoint, extraParams = {}) {
        const params = new URLSearchParams({
            access_token: META_ACCESS_TOKEN,
            appsecret_proof: META_APP_SECRET_PROOF,
            ...extraParams,
        });
        const url = `${META_API_BASE}${endpoint}?${params.toString()}`;
        const res = await fetch(url);
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Meta API ${res.status}: ${text.slice(0, 200)}`);
        }
        return res.json();
    }

    async function metaApiFetchAll(endpoint, extraParams = {}, maxPages = 20) {
        const cacheKey = JSON.stringify({ endpoint, extraParams, maxPages });
        if (!buildTests._metaApiAllCache) buildTests._metaApiAllCache = new Map();
        const cached = buildTests._metaApiAllCache.get(cacheKey);
        if (cached) return cached;

        const params = new URLSearchParams({
            access_token: META_ACCESS_TOKEN,
            appsecret_proof: META_APP_SECRET_PROOF,
            ...extraParams,
        });

        let nextUrl = `${META_API_BASE}${endpoint}?${params.toString()}`;
        const rows = [];
        let page = 0;

        while (nextUrl && page < maxPages) {
            page += 1;
            const res = await fetch(nextUrl);
            if (!res.ok) {
                const text = await res.text();
                const error = new Error(`Meta API ${res.status}: ${text.slice(0, 200)}`);
                error.status = res.status;
                error.body = text;
                throw error;
            }
            const data = await res.json();
            if (data.error) {
                const error = new Error(`Meta API error: ${JSON.stringify(data.error).slice(0, 200)}`);
                error.metaError = data.error;
                throw error;
            }
            rows.push(...(data.data || []));
            if (data.paging && data.paging.next) {
                const sep = data.paging.next.includes('?') ? '&' : '?';
                nextUrl = data.paging.next + sep + 'appsecret_proof=' + encodeURIComponent(META_APP_SECRET_PROOF);
            } else {
                nextUrl = null;
            }
        }

        buildTests._metaApiAllCache.set(cacheKey, rows);
        return rows;
    }

    function isMetaRateLimitError(err) {
        const text = [
            err && err.message,
            err && err.body,
            err && JSON.stringify(err.metaError || {})
        ].filter(Boolean).join(' ').toLowerCase();
        return text.includes('user request limit reached') ||
            text.includes('too many api calls') ||
            text.includes('error_subcode\":2446079') ||
            text.includes('code\":17') ||
            text.includes('oauthexception');
    }

    // Get CI database handle (lazy, same as engine uses)
    function getCiDb() {
        return require('./db').getCiDb();
    }

    // ---- The five integrity tests ----

    const tests = [
        {
            name: 'Campaign ID extraction',
            test: async () => {
                if (!METABASE_SESSION_TOKEN) {
                    return { pass: true, level: 'SKIP', message: 'Metabase session token not configured — skipped' };
                }
                const sql = `
                    SELECT uad.tracker_name, uad.network,
                           SPLIT_PART(uad.tracker_name, ':', 2) AS extracted_campaign_id
                    FROM user_additional_details uad
                    INNER JOIN users u ON u.id = uad.user_id
                    WHERE ${socialNetworkWhere('uad.')}
                      AND uad.tracker_name IS NOT NULL
                      AND u.referred_by IS NULL
                      AND DATE(u.created_at) >= current_date - INTERVAL '30 day'
                    ORDER BY u.created_at DESC
                    LIMIT 10`;
                const rows = await metabaseQuery(sql);
                if (rows.length === 0) {
                    return { pass: false, level: 'FAIL', message: 'No Meta-attributed rows found in user_additional_details (last 30 days)' };
                }
                const empty = rows.filter(r => !r.extracted_campaign_id || String(r.extracted_campaign_id).trim() === '');
                if (empty.length > 0) {
                    return {
                        pass: false,
                        level: 'WARN',
                        message: `${empty.length}/${rows.length} rows have empty SPLIT_PART(tracker_name, ':', 2). Sample tracker_names: ${empty.slice(0, 3).map(r => r.tracker_name).join(', ')}`,
                    };
                }
                return { pass: true, level: 'OK', message: `All ${rows.length} rows have non-empty campaign ID extraction` };
            },
        },
        {
            name: 'Campaign ID <-> Meta API match rate',
            test: async () => {
                if (!METABASE_SESSION_TOKEN || !META_ACCESS_TOKEN) {
                    return { pass: true, level: 'SKIP', message: 'Metabase or Meta API not configured — skipped' };
                }
                // 1. Distinct campaign IDs from Metabase (last 30 days)
                const campaignNamesSQL = TARGET_CAMPAIGNS.map(n => `'${n}'`).join(',');
                if (!campaignNamesSQL) {
                    return { pass: true, level: 'SKIP', message: 'No target campaigns configured' };
                }
                const sql = `
                    SELECT DISTINCT uad.tracker_campaign_name AS campaign_name
                    FROM user_additional_details uad
                    INNER JOIN users u ON u.id = uad.user_id
                    WHERE ${socialNetworkWhere('uad.')}
                      AND uad.tracker_campaign_name IN (${campaignNamesSQL})
                      AND u.referred_by IS NULL
                      AND DATE(u.created_at) >= current_date - INTERVAL '30 day'`;
                const mbRows = await metabaseQuery(sql);
                const mbNames = new Set(mbRows.map(r => (r.campaign_name || '').trim()).filter(Boolean));

                // 2. Campaign names from Meta API
                const metaData = await metaApiFetch(`/${META_AD_ACCOUNT_ID}/campaigns`, {
                    fields: 'name,id',
                    limit: '500',
                });
                const metaNames = new Set((metaData.data || []).map(c => (c.name || '').trim()));

                if (mbNames.size === 0) {
                    return { pass: true, level: 'WARN', message: 'No campaign names found in Metabase for target campaigns' };
                }

                let matched = 0;
                for (const name of mbNames) {
                    if (metaNames.has(name)) matched++;
                }
                const matchRate = (matched / mbNames.size) * 100;

                if (matchRate < 80) {
                    return {
                        pass: false,
                        level: 'FAIL',
                        message: `Campaign match rate ${matchRate.toFixed(1)}% (${matched}/${mbNames.size}) — below 80% threshold. Metabase campaigns not in Meta: ${[...mbNames].filter(n => !metaNames.has(n)).slice(0, 5).join(', ')}`,
                    };
                }
                if (matchRate < 95) {
                    return {
                        pass: true,
                        level: 'WARN',
                        message: `Campaign match rate ${matchRate.toFixed(1)}% (${matched}/${mbNames.size}) — below 95% ideal. Unmatched: ${[...mbNames].filter(n => !metaNames.has(n)).slice(0, 3).join(', ')}`,
                    };
                }
                return { pass: true, level: 'OK', message: `Campaign match rate ${matchRate.toFixed(1)}% (${matched}/${mbNames.size})` };
            },
        },
        {
            name: 'ROAS sanity check',
            test: async () => {
                let db;
                try { db = getCiDb(); } catch (e) {
                    return { pass: true, level: 'SKIP', message: 'CI database not available: ' + e.message };
                }

                // Pull all snapshots from last 24h (or latest batch if no recent)
                let rows;
                try {
                    rows = db.prepare(`
                        SELECT ad_name, d6_roas, d15_roas, d30_roas, d60_roas, overall_roas, spend
                        FROM snapshots
                        WHERE collected_at >= datetime('now', '-24 hours')
                          AND spend > 0
                    `).all();
                } catch (e) {
                    return { pass: true, level: 'SKIP', message: 'Snapshots table query failed: ' + e.message };
                }

                if (rows.length === 0) {
                    // Fall back to latest snapshot date
                    try {
                        rows = db.prepare(`
                            SELECT ad_name, d6_roas, d15_roas, d30_roas, d60_roas, overall_roas, spend
                            FROM snapshots
                            WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM snapshots)
                              AND spend > 0
                        `).all();
                    } catch (e) { /* ignore */ }
                }

                if (rows.length === 0) {
                    return { pass: true, level: 'WARN', message: 'No snapshot data with spend > 0 found' };
                }

                const issues = [];

                // Check for absurd ROAS values (> 5000% = 50x)
                const absurdRoas = rows.filter(r =>
                    (r.d6_roas != null && r.d6_roas > 5000) ||
                    (r.overall_roas != null && r.overall_roas > 5000)
                );
                if (absurdRoas.length > 0) {
                    issues.push(`FAIL: ${absurdRoas.length} ads have ROAS > 5000%: ${absurdRoas.slice(0, 3).map(r => `${r.ad_name} (d6=${r.d6_roas}%, overall=${r.overall_roas}%)`).join('; ')}`);
                }

                // Check average ROAS too low (< 10% = 0.1x)
                const roasValues = rows.map(r => r.d6_roas).filter(v => v != null && v > 0);
                if (roasValues.length > 0) {
                    const avgRoas = roasValues.reduce((a, b) => a + b, 0) / roasValues.length;
                    if (avgRoas < 10) {
                        issues.push(`FAIL: Average D6 ROAS is ${avgRoas.toFixed(2)}% across ${roasValues.length} ads — below 10% threshold`);
                    }
                }

                // Check null ROAS rate
                const nullCount = rows.filter(r => r.d6_roas == null || r.d6_roas === 0).length;
                const nullRate = (nullCount / rows.length) * 100;
                if (nullRate > 90) {
                    issues.push(`WARN: ${nullRate.toFixed(1)}% of ads (${nullCount}/${rows.length}) have null/zero D6 ROAS`);
                }

                if (issues.some(i => i.startsWith('FAIL'))) {
                    return { pass: false, level: 'FAIL', message: issues.join(' | ') };
                }
                if (issues.length > 0) {
                    return { pass: true, level: 'WARN', message: issues.join(' | ') };
                }
                return { pass: true, level: 'OK', message: `${rows.length} ads checked — ROAS values within expected ranges (avg D6: ${roasValues.length > 0 ? (roasValues.reduce((a, b) => a + b, 0) / roasValues.length).toFixed(1) : 'N/A'}%)` };
            },
        },
        {
            name: 'Revenue window alignment',
            test: async () => {
                let db;
                try { db = getCiDb(); } catch (e) {
                    return { pass: true, level: 'SKIP', message: 'CI database not available: ' + e.message };
                }

                let rows;
                try {
                    rows = db.prepare(`
                        SELECT ad_name, ad_id, d6_revenue, d6_overall_revenue, d15_overall_revenue, d30_overall_revenue, d60_overall_revenue, overall_revenue, spend
                        FROM snapshots
                        WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM snapshots)
                          AND spend > 100
                    `).all();
                } catch (e) {
                    return { pass: true, level: 'SKIP', message: 'Snapshot query failed: ' + e.message };
                }

                if (rows.length === 0) {
                    return { pass: true, level: 'WARN', message: 'No snapshots with spend > 100 found' };
                }

                const violations = [];
                for (const r of rows) {
                    const d6 = r.d6_overall_revenue || 0;
                    const d15 = r.d15_overall_revenue || 0;
                    const d30 = r.d30_overall_revenue || 0;
                    const d60 = r.d60_overall_revenue || 0;
                    const overall = r.overall_revenue || 0;

                    // D6 should <= D15 <= D30 <= D60 <= overall (with small tolerance for rounding)
                    const tolerance = 1; // 1 rupee tolerance
                    if (d6 > d15 + tolerance && d15 > 0) {
                        violations.push(`${r.ad_name}: D6 (${d6}) > D15 (${d15})`);
                    }
                    if (d15 > d30 + tolerance && d30 > 0) {
                        violations.push(`${r.ad_name}: D15 (${d15}) > D30 (${d30})`);
                    }
                    if (d30 > d60 + tolerance && d60 > 0) {
                        violations.push(`${r.ad_name}: D30 (${d30}) > D60 (${d60})`);
                    }
                    if (d6 > overall + tolerance && overall > 0) {
                        violations.push(`${r.ad_name}: D6 (${d6}) > Overall (${overall})`);
                    }
                }

                if (violations.length > 0) {
                    return {
                        pass: false,
                        level: 'FAIL',
                        message: `${violations.length} revenue window violations found: ${violations.slice(0, 5).join('; ')}${violations.length > 5 ? ` (and ${violations.length - 5} more)` : ''}`,
                    };
                }
                return { pass: true, level: 'OK', message: `${rows.length} ads checked — all revenue windows correctly ordered (D6 <= D15 <= D30 <= D60 <= Overall)` };
            },
        },
        {
            name: 'Adset name normalization',
            test: async () => {
                if (!METABASE_SESSION_TOKEN || !META_ACCESS_TOKEN) {
                    return { pass: true, level: 'SKIP', message: 'Metabase or Meta API not configured — skipped' };
                }

                const campaignNamesSQL = TARGET_CAMPAIGNS.map(n => `'${n}'`).join(',');
                if (!campaignNamesSQL) {
                    return { pass: true, level: 'SKIP', message: 'No target campaigns configured' };
                }

                // 1. Pull adset names from Metabase (tracker_sub_campaign_name)
                const sql = `
                    SELECT DISTINCT LOWER(TRIM(uad.tracker_sub_campaign_name)) AS adset_name
                    FROM user_additional_details uad
                    INNER JOIN users u ON u.id = uad.user_id
                    WHERE ${socialNetworkWhere('uad.')}
                      AND uad.tracker_campaign_name IN (${campaignNamesSQL})
                      AND uad.tracker_sub_campaign_name IS NOT NULL
                      AND u.referred_by IS NULL
                      AND DATE(u.created_at) >= current_date - INTERVAL '30 day'
                    LIMIT 20`;
                const mbRows = await metabaseQuery(sql);
                const mbAdsets = mbRows.map(r => r.adset_name).filter(Boolean);

                if (mbAdsets.length === 0) {
                    return { pass: true, level: 'WARN', message: 'No adset names found in Metabase' };
                }

                // 2. Pull adset names from Meta API
                let metaCampaigns;
                try {
                    metaCampaigns = await metaApiFetchAll(`/${META_AD_ACCOUNT_ID}/campaigns`, {
                        fields: 'name,id',
                        limit: '500',
                    }, 3);
                } catch (err) {
                    if (isMetaRateLimitError(err)) {
                        return { pass: true, level: 'WARN', message: 'Meta API rate limit reached while loading campaigns — adset normalization skipped to avoid extra API burn' };
                    }
                    throw err;
                }
                const targetCampaignIds = new Set(
                    metaCampaigns
                        .filter(c => TARGET_CAMPAIGNS.includes((c.name || '').trim()))
                        .map(c => String(c.id || '').trim())
                        .filter(Boolean)
                );
                if (targetCampaignIds.size === 0) {
                    return { pass: true, level: 'WARN', message: 'No target campaigns were returned from Meta API' };
                }

                let metaAdsetsData;
                try {
                    metaAdsetsData = await metaApiFetchAll(`/${META_AD_ACCOUNT_ID}/adsets`, {
                        fields: 'name,id,campaign_id',
                        limit: '500',
                    }, 5);
                } catch (err) {
                    if (isMetaRateLimitError(err)) {
                        return { pass: true, level: 'WARN', message: 'Meta API rate limit reached while loading adsets — normalization check skipped to avoid failing integrity on quota pressure' };
                    }
                    throw err;
                }
                const metaAdsets = metaAdsetsData
                    .filter(a => targetCampaignIds.has(String(a.campaign_id || '').trim()))
                    .map(a => (a.name || '').toLowerCase().trim());

                if (metaAdsets.length === 0) {
                    return { pass: true, level: 'WARN', message: 'No adsets returned from Meta API for target campaigns' };
                }

                // 3. Compute match rate using normalized comparison
                let matched = 0;
                for (const mbName of mbAdsets) {
                    const norm = normAdName(mbName);
                    if (metaAdsets.some(m => normAdName(m) === norm || normAdName(m).includes(norm) || norm.includes(normAdName(m)))) {
                        matched++;
                    }
                }
                const matchRate = (matched / mbAdsets.length) * 100;

                if (matchRate < 70) {
                    return {
                        pass: true,
                        level: 'WARN',
                        message: `Adset name match rate ${matchRate.toFixed(1)}% (${matched}/${mbAdsets.length}) — below 70%. Unmatched MB adsets: ${mbAdsets.filter(n => !metaAdsets.some(m => normAdName(m) === normAdName(n))).slice(0, 3).join(', ')}`,
                    };
                }
                return { pass: true, level: 'OK', message: `Adset name match rate ${matchRate.toFixed(1)}% (${matched}/${mbAdsets.length})` };
            },
        },
    ];

    return tests;
}

// ---- Test runner ----

async function runIntegrityTests(config) {
    const tests = buildTests(config);
    const results = {
        runAt: now(),
        duration: 0,
        summary: { total: tests.length, passed: 0, failed: 0, warnings: 0, skipped: 0 },
        overallStatus: 'OK',
        tests: [],
    };

    const startTime = Date.now();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[Integrity] Running ${tests.length} data integrity tests...`);
    console.log(`${'='.repeat(60)}`);

    for (const t of tests) {
        const testStart = Date.now();
        let result;
        try {
            result = await t.test();
        } catch (err) {
            result = { pass: false, level: 'FAIL', message: `Exception: ${err.message}` };
        }
        const elapsed = Date.now() - testStart;

        const entry = {
            name: t.name,
            pass: result.pass,
            level: result.level,
            message: result.message,
            durationMs: elapsed,
        };
        results.tests.push(entry);

        // Tally
        if (result.level === 'SKIP') results.summary.skipped++;
        else if (!result.pass) results.summary.failed++;
        else if (result.level === 'WARN') results.summary.warnings++;
        else results.summary.passed++;

        // Log with prominence
        const icon = result.level === 'OK' ? 'PASS' : result.level === 'WARN' ? 'WARN' : result.level === 'SKIP' ? 'SKIP' : 'FAIL';
        const prefix = result.level === 'FAIL' ? '  *** ' : '  ';
        console.log(`${prefix}[${icon}] ${t.name} (${elapsed}ms) — ${result.message}`);
    }

    results.duration = Date.now() - startTime;
    results.overallStatus = results.summary.failed > 0 ? 'FAIL' : results.summary.warnings > 0 ? 'WARN' : 'OK';

    console.log(`${'='.repeat(60)}`);
    console.log(`[Integrity] Done in ${results.duration}ms — ${results.overallStatus} (${results.summary.passed} pass, ${results.summary.failed} fail, ${results.summary.warnings} warn, ${results.summary.skipped} skip)`);
    if (results.summary.failed > 0) {
        console.log(`[Integrity] *** FAILURES DETECTED — review data_integrity_results.json ***`);
    }
    console.log(`${'='.repeat(60)}\n`);

    // Persist to disk
    latestResults = results;
    try {
        fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
    } catch (e) {
        console.error('[Integrity] Could not write results file:', e.message);
    }

    return results;
}

// ---- Scheduler: run on start + every 6 hours ----

function startIntegrityScheduler(config) {
    // Run immediately on startup (with a short delay so server is ready)
    setTimeout(() => {
        runIntegrityTests(config).catch(err => {
            console.error('[Integrity] Startup run failed:', err.message);
        });
    }, 5000);

    // Schedule every 6 hours
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = setInterval(() => {
        console.log('[Integrity] Scheduled 6-hour run starting...');
        runIntegrityTests(config).catch(err => {
            console.error('[Integrity] Scheduled run failed:', err.message);
        });
    }, SIX_HOURS);

    console.log('[Integrity] Scheduler armed — runs on start + every 6 hours');
}

function stopIntegrityScheduler() {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        console.log('[Integrity] Scheduler stopped');
    }
}

// ---- Status getter for dashboard header ----

function getIntegrityStatus() {
    if (!latestResults) {
        // Try to load from disk
        try {
            if (fs.existsSync(RESULTS_FILE)) {
                latestResults = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
            }
        } catch (e) { /* ignore */ }
    }
    if (!latestResults) {
        return { status: 'PENDING', message: 'Integrity tests have not run yet', runAt: null };
    }
    return {
        status: latestResults.overallStatus,
        message: `${latestResults.summary.passed} pass, ${latestResults.summary.failed} fail, ${latestResults.summary.warnings} warn`,
        runAt: latestResults.runAt,
        duration: latestResults.duration,
        failedTests: latestResults.tests.filter(t => !t.pass).map(t => t.name),
    };
}

module.exports = {
    runIntegrityTests,
    startIntegrityScheduler,
    stopIntegrityScheduler,
    getIntegrityStatus,
};
