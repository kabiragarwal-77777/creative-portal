// =============================================================================
// Inventory Engine — Agent 1 (Math), Agent 2 (Name Resolver), Agent 3 (AI Advisor)
// CommonJS module for the Univest Performance Marketing Portal
// =============================================================================

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getMetabaseSessionToken, refreshMetabaseSessionToken } = require('./config/env');

// Load .env for local development
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch (e) { /* use env vars directly */ }

// =============================================================================
// CONFIGURATION
// =============================================================================

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || 'act_725019929189148';
const META_API_VERSION = 'v19.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

const METABASE_URL = process.env.METABASE_URL || 'https://analytics.univest.in';
const METABASE_SESSION = getMetabaseSessionToken();
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

const NAME_CACHE_FILE = path.join(__dirname, '.inventory-name-cache.json');

// In-memory name cache
let _nameCache = null;
let _nameCacheTs = 0;
const NAME_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// =============================================================================
// HELPERS
// =============================================================================

function formatDate(d) {
    if (typeof d === 'string') return d;
    return d.toISOString().slice(0, 10);
}

function clamp(val, min, max) {
    if (val == null || isNaN(val)) return null;
    return Math.max(min, Math.min(max, val));
}

function safeDivide(numerator, denominator, maxReasonable) {
    if (!denominator || denominator <= 0 || !numerator || numerator < 0) return null;
    const result = numerator / denominator;
    if (maxReasonable && result > maxReasonable) return null; // sanity cap
    return Math.round(result * 100) / 100;
}

function confidenceLevel(sampleSize) {
    if (sampleSize >= 100) return 'HIGH';
    if (sampleSize >= 30) return 'MEDIUM';
    if (sampleSize >= 10) return 'LOW';
    return 'INSUFFICIENT';
}

function normalizeDateRange(dateRange) {
    const since = dateRange && (dateRange.since || dateRange.start);
    const until = dateRange && (dateRange.until || dateRange.end);

    if (!since || !until) {
        throw new Error('dateRange with since/until is required');
    }

    return {
        since: formatDate(since),
        until: formatDate(until)
    };
}

function buildMetricsResult({
    spend = 0,
    impressions = 0,
    clicks = 0,
    signups = 0,
    d6Conversions = 0,
    d6Revenue = 0,
    error = null,
    confidenceOverride = null
}) {
    const cpm = safeDivide(spend * 1000, impressions, 5000);    // cap CPM at 5000
    const cpc = safeDivide(spend, clicks, 2000);                 // cap CPC at 2000
    const signupCost = safeDivide(spend, signups, 50000);        // cap signup cost at 50k
    const d6Cac = safeDivide(spend, d6Conversions, 100000);      // cap D6 CAC at 100k
    const d6Roas = (spend > 0 && d6Revenue >= 0)
        ? Math.round((d6Revenue / spend) * 100 * 100) / 100      // as percentage
        : null;

    const result = {
        spend: Math.round(spend * 100) / 100,
        impressions,
        clicks,
        signups,
        d6_conversions: d6Conversions,
        d6_revenue: Math.round(d6Revenue * 100) / 100,
        d6_cac: d6Cac,
        d6_roas: (d6Roas !== null && d6Roas > 5000) ? null : d6Roas,
        cpm,
        cpc,
        signup_cost: signupCost,
        data_confidence: confidenceOverride || confidenceLevel(d6Conversions)
    };

    if (error) result.error = error;
    return result;
}

// =============================================================================
// METABASE QUERY RUNNER
// =============================================================================

async function runMetabaseQuery(sqlString) {
    const token = METABASE_SESSION;
    if (!METABASE_SESSION) {
        throw new Error('METABASE_SESSION not configured — cannot query Metabase');
    }
    const request = (sessionToken) => axios.post(`${METABASE_URL}/api/dataset`, {
        database: 1,
        type: 'native',
        native: { query: sqlString }
    }, {
        headers: { 'X-Metabase-Session': sessionToken },
        timeout: 60000
    });
    let resp = await request(token);
    if (resp.status === 401) {
        const refreshed = await refreshMetabaseSessionToken('inventory engine 401').catch(() => '');
        if (refreshed) resp = await request(refreshed);
    }

    const data = resp.data;
    if (!data || !data.data || !data.data.rows) {
        return { columns: [], rows: [] };
    }
    const columns = (data.data.cols || []).map(c => c.name || c.display_name || 'col');
    return { columns, rows: data.data.rows };
}

// =============================================================================
// META MARKETING API — SPEND DATA
// =============================================================================

async function fetchMetaInsights(campaignIds, since, until) {
    if (!META_ACCESS_TOKEN) {
        throw new Error('META_ACCESS_TOKEN not configured');
    }

    const accountId = META_AD_ACCOUNT_ID.startsWith('act_')
        ? META_AD_ACCOUNT_ID
        : `act_${META_AD_ACCOUNT_ID}`;

    // Fetch at campaign level for the given campaign IDs
    const allRows = [];
    let nextUrl = `${META_API_BASE}/${accountId}/insights`;

    const params = {
        fields: 'spend,impressions,clicks,campaign_id,campaign_name,adset_id,adset_name',
        level: 'campaign',
        time_range: JSON.stringify({ since, until }),
        filtering: JSON.stringify([{
            field: 'campaign.id',
            operator: 'IN',
            value: campaignIds.map(String)
        }]),
        limit: 500,
        access_token: META_ACCESS_TOKEN
    };

    try {
        const resp = await axios.get(nextUrl, { params, timeout: 30000 });
        if (resp.data && resp.data.data) {
            allRows.push(...resp.data.data);
        }
        // Handle pagination
        let paging = resp.data && resp.data.paging;
        while (paging && paging.next) {
            const pageResp = await axios.get(paging.next, { timeout: 30000 });
            if (pageResp.data && pageResp.data.data) {
                allRows.push(...pageResp.data.data);
            }
            paging = pageResp.data && pageResp.data.paging;
        }
    } catch (err) {
        const msg = err.response ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`Meta API insights fetch failed: ${msg}`);
    }

    return allRows;
}

// =============================================================================
// AGENT 1 — MATH ENGINE
// =============================================================================

/**
 * calculateD6CAC — Pulls Meta spend + Metabase D6 conversions, computes metrics.
 * @param {string[]} campaignIds — Array of Meta campaign IDs
 * @param {{ since: string, until: string }} dateRange
 * @returns {Object} { spend, impressions, clicks, signups, d6_conversions, d6_revenue, d6_cac, d6_roas, cpm, cpc, signup_cost, data_confidence }
 */
async function calculateD6CAC(campaignIds, dateRange) {
    const metricsByCampaign = await calculateD6CACByCampaign(campaignIds, dateRange);
    const metricsList = Object.values(metricsByCampaign);

    if (!metricsList.length) {
        throw new Error('campaignIds is required and must be a non-empty array');
    }

    const aggregate = metricsList.reduce((acc, metric) => {
        acc.spend += metric.spend || 0;
        acc.impressions += metric.impressions || 0;
        acc.clicks += metric.clicks || 0;
        acc.signups += metric.signups || 0;
        acc.d6Conversions += metric.d6_conversions || 0;
        acc.d6Revenue += metric.d6_revenue || 0;
        return acc;
    }, {
        spend: 0,
        impressions: 0,
        clicks: 0,
        signups: 0,
        d6Conversions: 0,
        d6Revenue: 0
    });

    let confidenceOverride = null;
    if (metricsList.some(metric => metric.data_confidence === 'ERROR')) {
        confidenceOverride = 'ERROR';
    } else if (metricsList.some(metric => metric.data_confidence === 'PARTIAL')) {
        confidenceOverride = 'PARTIAL';
    }

    const errorMessages = [...new Set(metricsList.map(metric => metric.error).filter(Boolean))];

    return buildMetricsResult({
        ...aggregate,
        error: errorMessages.length ? errorMessages.join(' | ') : null,
        confidenceOverride
    });
}

async function calculateD6CACByCampaign(campaignIds, dateRange) {
    const normalizedIds = [...new Set((campaignIds || []).map(id => String(id).trim()).filter(Boolean))];
    if (!normalizedIds.length) {
        throw new Error('campaignIds is required and must be a non-empty array');
    }

    const { since, until } = normalizeDateRange(dateRange);
    const rawMetricsByCampaign = Object.fromEntries(normalizedIds.map(id => [id, {
        spend: 0,
        impressions: 0,
        clicks: 0,
        signups: 0,
        d6Conversions: 0,
        d6Revenue: 0
    }]));

    try {
        const insights = await fetchMetaInsights(normalizedIds, since, until);
        for (const row of insights) {
            const campaignId = String(row.campaign_id || '').trim();
            if (!campaignId) continue;
            if (!rawMetricsByCampaign[campaignId]) {
                rawMetricsByCampaign[campaignId] = {
                    spend: 0,
                    impressions: 0,
                    clicks: 0,
                    signups: 0,
                    d6Conversions: 0,
                    d6Revenue: 0
                };
            }

            rawMetricsByCampaign[campaignId].spend += parseFloat(row.spend || 0);
            rawMetricsByCampaign[campaignId].impressions += parseInt(row.impressions || 0, 10);
            rawMetricsByCampaign[campaignId].clicks += parseInt(row.clicks || 0, 10);
        }
    } catch (err) {
        const msg = err.response ? JSON.stringify(err.response.data) : err.message;
        const error = `Meta API insights fetch failed: ${msg}`;
        return Object.fromEntries(normalizedIds.map(id => [id, buildMetricsResult({
            error,
            confidenceOverride: 'ERROR'
        })]));
    }

    const campaignIdArray = normalizedIds.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
    const d6Query = `
WITH attributed_users AS (
  SELECT
    SPLIT_PART(uad.tracker_name, ':', 2) AS meta_campaign_id,
    uad.user_id,
    DATE(uad.created_at) AS signup_date
  FROM user_additional_details uad
  INNER JOIN users u ON u.id = uad.user_id
  WHERE (uad.network ILIKE '%facebook%' OR uad.network = 'Facebook')
    AND SPLIT_PART(uad.tracker_name, ':', 2) = ANY(ARRAY[${campaignIdArray}])
    AND DATE(uad.created_at) BETWEEN '${since}' AND '${until}'
    AND u.referred_by IS NULL
),
per_user_d6 AS (
  SELECT
    au.meta_campaign_id,
    au.user_id,
    COUNT(CASE
      WHEN uth.status = 'CHARGED'
       AND uth.amount > 50
       AND DATE(uth.created_at) <= au.signup_date + INTERVAL '6 days'
      THEN 1
    END) AS d6_txn_count,
    COALESCE(SUM(CASE
      WHEN uth.status = 'CHARGED'
       AND uth.amount > 50
       AND DATE(uth.created_at) <= au.signup_date + INTERVAL '6 days'
      THEN uth.amount
      ELSE 0
    END), 0) AS d6_revenue
  FROM attributed_users au
  LEFT JOIN user_transaction_history uth ON uth.user_id = au.user_id
  GROUP BY 1, 2
)
SELECT
  meta_campaign_id,
  COUNT(DISTINCT user_id) AS total_signups,
  COUNT(DISTINCT CASE WHEN d6_txn_count > 0 THEN user_id END) AS total_d6_conversions,
  COALESCE(SUM(d6_revenue), 0) AS total_d6_revenue
FROM per_user_d6
GROUP BY 1`;

    try {
        const result = await runMetabaseQuery(d6Query);
        for (const row of result.rows || []) {
            const campaignId = String(row[0] || '').trim();
            if (!campaignId) continue;
            if (!rawMetricsByCampaign[campaignId]) {
                rawMetricsByCampaign[campaignId] = {
                    spend: 0,
                    impressions: 0,
                    clicks: 0,
                    signups: 0,
                    d6Conversions: 0,
                    d6Revenue: 0
                };
            }

            rawMetricsByCampaign[campaignId].signups = parseInt(row[1] || 0, 10);
            rawMetricsByCampaign[campaignId].d6Conversions = parseInt(row[2] || 0, 10);
            rawMetricsByCampaign[campaignId].d6Revenue = parseFloat(row[3] || 0);
        }
    } catch (err) {
        const error = `Metabase error: ${err.message}`;
        return Object.fromEntries(normalizedIds.map(id => {
            const raw = rawMetricsByCampaign[id] || {
                spend: 0,
                impressions: 0,
                clicks: 0,
                signups: 0,
                d6Conversions: 0,
                d6Revenue: 0
            };
            return [id, buildMetricsResult({
                ...raw,
                d6Conversions: 0,
                d6Revenue: 0,
                error,
                confidenceOverride: 'PARTIAL'
            })];
        }));
    }

    return Object.fromEntries(normalizedIds.map(id => {
        const raw = rawMetricsByCampaign[id] || {
            spend: 0,
            impressions: 0,
            clicks: 0,
            signups: 0,
            d6Conversions: 0,
            d6Revenue: 0
        };
        return [id, buildMetricsResult(raw)];
    }));
}

// =============================================================================
// AGENT 1 — BUDGET PROJECTOR
// =============================================================================

/**
 * projectBudgetOutcome — Projects what a given budget will yield based on historical benchmarks.
 * @param {number} budget — Daily or total budget in INR
 * @param {Object} inventoryBenchmarks — { cpm, ctr, signup_rate, d6_cvr, avg_d6_revenue_per_user, sample_size }
 * @returns {Object} projections with low/mid/high confidence intervals
 */
function projectBudgetOutcome(budget, inventoryBenchmarks) {
    if (!budget || budget <= 0) {
        throw new Error('budget must be a positive number');
    }
    if (!inventoryBenchmarks) {
        throw new Error('inventoryBenchmarks is required');
    }

    const {
        cpm = 0,
        ctr = 0,
        signup_rate = 0,
        d6_cvr = 0,
        avg_d6_revenue_per_user = 0,
        sample_size = 0
    } = inventoryBenchmarks;

    // Validate inputs
    if (cpm <= 0) return { error: 'CPM must be positive — no delivery benchmark available' };
    if (ctr <= 0) return { error: 'CTR must be positive — no click benchmark available' };

    // Core funnel calculations (mid estimate)
    const impressions = (budget / cpm) * 1000;
    const clicks = impressions * (ctr / 100);
    const signups = clicks * (signup_rate / 100);
    const d6Conversions = signups * (d6_cvr / 100);
    const d6Revenue = d6Conversions * avg_d6_revenue_per_user;
    const d6Roas = budget > 0 ? (d6Revenue / budget) * 100 : 0;
    const d6Cac = d6Conversions > 0 ? budget / d6Conversions : null;

    // Confidence intervals: ±20% variance on key conversion rates
    const varianceFactor = 0.20;
    const dataConf = confidenceLevel(sample_size);

    // Widen intervals for low-confidence data
    const confMultiplier = dataConf === 'HIGH' ? 1.0 : dataConf === 'MEDIUM' ? 1.3 : 1.6;
    const effectiveVariance = varianceFactor * confMultiplier;

    function buildScenario(factor) {
        const adjCtr = ctr * factor;
        const adjSignupRate = signup_rate * factor;
        const adjD6Cvr = d6_cvr * factor;
        const adjImpressions = (budget / cpm) * 1000; // impressions depend on CPM, not conversion
        const adjClicks = adjImpressions * (adjCtr / 100);
        const adjSignups = adjClicks * (adjSignupRate / 100);
        const adjD6 = adjSignups * (adjD6Cvr / 100);
        const adjRevenue = adjD6 * avg_d6_revenue_per_user;

        return {
            impressions: Math.round(adjImpressions),
            clicks: Math.round(adjClicks),
            signups: Math.round(adjSignups),
            d6_conversions: Math.round(adjD6),
            d6_revenue: Math.round(adjRevenue),
            d6_roas: budget > 0 ? Math.round((adjRevenue / budget) * 100 * 100) / 100 : 0,
            d6_cac: adjD6 > 0 ? Math.round((budget / adjD6) * 100) / 100 : null
        };
    }

    return {
        budget,
        data_confidence: dataConf,
        sample_size,
        low: buildScenario(1 - effectiveVariance),
        mid: buildScenario(1),
        high: buildScenario(1 + effectiveVariance),
        assumptions: {
            cpm,
            ctr,
            signup_rate,
            d6_cvr,
            avg_d6_revenue_per_user,
            variance_factor: effectiveVariance
        }
    };
}

// =============================================================================
// AGENT 2 — NAME RESOLVER
// =============================================================================

/**
 * resolveInventoryNames — Fetches all adsets from Meta API, builds nameMap, caches.
 * @returns {Object} nameMap — { [adsetId]: { adset_name, campaign_id, campaign_name, status, daily_budget, lifetime_budget } }
 */
async function resolveInventoryNames() {
    // Return cached if fresh
    if (_nameCache && (Date.now() - _nameCacheTs < NAME_CACHE_TTL)) {
        return _nameCache;
    }

    if (!META_ACCESS_TOKEN) {
        // Try loading from disk cache
        return _loadNameCacheFromDisk();
    }

    const accountId = META_AD_ACCOUNT_ID.startsWith('act_')
        ? META_AD_ACCOUNT_ID
        : `act_${META_AD_ACCOUNT_ID}`;

    const nameMap = {};
    let nextUrl = `${META_API_BASE}/${accountId}/adsets`;
    const params = {
        fields: 'id,name,campaign_id,campaign{name},status,daily_budget,lifetime_budget',
        limit: 500,
        access_token: META_ACCESS_TOKEN
    };

    try {
        let page = 0;
        const maxPages = 20; // safety limit

        while (nextUrl && page < maxPages) {
            const resp = await axios.get(nextUrl, {
                params: page === 0 ? params : undefined, // params only for first request; next URLs have params baked in
                timeout: 30000
            });

            const data = resp.data;
            if (data && data.data) {
                for (const adset of data.data) {
                    nameMap[adset.id] = {
                        adset_name: adset.name || `Adset ${adset.id}`,
                        campaign_id: adset.campaign_id || (adset.campaign && adset.campaign.id) || null,
                        campaign_name: (adset.campaign && adset.campaign.name) || null,
                        status: adset.status || 'UNKNOWN',
                        daily_budget: adset.daily_budget ? parseFloat(adset.daily_budget) / 100 : null,
                        lifetime_budget: adset.lifetime_budget ? parseFloat(adset.lifetime_budget) / 100 : null
                    };
                }
            }

            nextUrl = (data && data.paging && data.paging.next) || null;
            page++;
        }

        // Cache in memory
        _nameCache = nameMap;
        _nameCacheTs = Date.now();

        // Cache to disk
        _saveNameCacheToDisk(nameMap);

        console.log(`[inventory-engine] Resolved ${Object.keys(nameMap).length} adset names`);
        return nameMap;

    } catch (err) {
        console.error('[inventory-engine] Failed to resolve names from Meta:', err.message);
        // Fallback to disk cache
        return _loadNameCacheFromDisk();
    }
}

function _saveNameCacheToDisk(nameMap) {
    try {
        fs.writeFileSync(NAME_CACHE_FILE, JSON.stringify({
            timestamp: Date.now(),
            data: nameMap
        }), 'utf8');
    } catch (err) {
        console.warn('[inventory-engine] Could not save name cache to disk:', err.message);
    }
}

function _loadNameCacheFromDisk() {
    try {
        if (fs.existsSync(NAME_CACHE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(NAME_CACHE_FILE, 'utf8'));
            if (raw && raw.data) {
                _nameCache = raw.data;
                _nameCacheTs = raw.timestamp || 0;
                console.log(`[inventory-engine] Loaded ${Object.keys(raw.data).length} names from disk cache`);
                return raw.data;
            }
        }
    } catch (err) {
        console.warn('[inventory-engine] Could not load name cache from disk:', err.message);
    }
    return {};
}

/**
 * getInventoryDisplayName — Lookup with fallback
 * @param {string} id — adset or campaign ID
 * @param {Object} nameMap — from resolveInventoryNames()
 * @returns {string} display name
 */
function getInventoryDisplayName(id, nameMap) {
    if (!id) return 'Unknown';
    if (!nameMap) return `ID:${id}`;

    const entry = nameMap[String(id)];
    if (entry) {
        return entry.adset_name || entry.campaign_name || `ID:${id}`;
    }

    // Check if id matches a campaign_id in any entry
    for (const key of Object.keys(nameMap)) {
        if (nameMap[key].campaign_id === String(id)) {
            return nameMap[key].campaign_name || `Campaign:${id}`;
        }
    }

    return `ID:${id}`;
}

/**
 * warmInventoryNameCache — Pre-loads the name cache. Call on server start.
 */
async function warmInventoryNameCache() {
    try {
        console.log('[inventory-engine] Warming inventory name cache...');
        const nameMap = await resolveInventoryNames();
        console.log(`[inventory-engine] Cache warmed: ${Object.keys(nameMap).length} entries`);
        return nameMap;
    } catch (err) {
        console.error('[inventory-engine] Cache warm failed:', err.message);
        return {};
    }
}

// =============================================================================
// AGENT 1 — WINNER IDENTIFICATION (SCORING)
// =============================================================================

/**
 * identifyWinners — Scores inventories on roas (35%), cac (35%), volume (20%), stability (10%).
 * @param {Array} inventories — Array of { id, name, d6_roas, d6_cac, d6_conversions, spend, days_active, daily_spend_stddev, avg_daily_spend }
 * @returns {Array} Sorted by composite_score desc, each with composite_score, winner_tier, subscores
 */
function identifyWinners(inventories) {
    if (!inventories || !inventories.length) return [];

    // Compute min/max for normalization
    const roasValues = inventories.map(i => i.d6_roas || 0).filter(v => v > 0);
    const cacValues = inventories.map(i => i.d6_cac || 0).filter(v => v > 0);
    const volumeValues = inventories.map(i => i.d6_conversions || 0);

    const maxRoas = Math.max(...roasValues, 1);
    const minCac = Math.min(...cacValues.filter(v => v > 0), 1);
    const maxCac = Math.max(...cacValues, 1);
    const maxVolume = Math.max(...volumeValues, 1);

    const scored = inventories.map(inv => {
        // ROAS score (0-10): higher is better
        const roasRaw = inv.d6_roas || 0;
        const roasScore = maxRoas > 0 ? clamp((roasRaw / maxRoas) * 10, 0, 10) : 0;

        // CAC score (0-10): lower is better (invert)
        const cacRaw = inv.d6_cac || 0;
        let cacScore = 0;
        if (cacRaw > 0 && maxCac > 0) {
            // Invert: best CAC (lowest) gets highest score
            cacScore = clamp(((maxCac - cacRaw) / (maxCac - minCac)) * 10, 0, 10);
        }

        // Volume score (0-10): higher conversions = better
        const volumeRaw = inv.d6_conversions || 0;
        const volumeScore = maxVolume > 0 ? clamp((volumeRaw / maxVolume) * 10, 0, 10) : 0;

        // Stability score (0-10): lower coefficient of variation = better
        let stabilityScore = 5; // default mid-score if no data
        if (inv.avg_daily_spend && inv.avg_daily_spend > 0 && inv.daily_spend_stddev != null) {
            const cv = inv.daily_spend_stddev / inv.avg_daily_spend;
            // CV = 0 is perfect stability (10), CV >= 1 is very unstable (0)
            stabilityScore = clamp((1 - cv) * 10, 0, 10);
        } else if (inv.days_active && inv.days_active >= 7) {
            stabilityScore = 6; // decent stability assumed if running 7+ days
        }

        // Weighted composite
        const composite = (roasScore * 0.35) + (cacScore * 0.35) + (volumeScore * 0.20) + (stabilityScore * 0.10);
        const compositeRounded = Math.round(composite * 100) / 100;

        // Tier assignment
        let winnerTier = 'AVOID';
        if (compositeRounded >= 7) winnerTier = 'WINNER';
        else if (compositeRounded >= 4.5) winnerTier = 'POTENTIAL';

        return {
            ...inv,
            subscores: {
                roas: Math.round(roasScore * 100) / 100,
                cac: Math.round(cacScore * 100) / 100,
                volume: Math.round(volumeScore * 100) / 100,
                stability: Math.round(stabilityScore * 100) / 100
            },
            composite_score: compositeRounded,
            winner_tier: winnerTier
        };
    });

    // Sort by composite_score descending
    scored.sort((a, b) => b.composite_score - a.composite_score);

    return scored;
}

// =============================================================================
// AGENT 3 — AI ADVISOR
// =============================================================================

/**
 * generateInventoryRecommendations — Calls Claude for strategic recommendations.
 * @param {Array} scoredInventories — Output of identifyWinners()
 * @param {number} totalBudget — Total daily/weekly budget
 * @param {string} vertical — e.g. "fintech", "trading", "mutual_funds"
 * @returns {Object} { recommended, budget_split, traps, fatigue_signals, contrarian_pick }
 */
async function generateInventoryRecommendations(scoredInventories, totalBudget, vertical) {
    if (!ANTHROPIC_API_KEY) {
        return _fallbackRecommendations(scoredInventories, totalBudget);
    }

    if (!scoredInventories || !scoredInventories.length) {
        return {
            recommended: [],
            budget_split: {},
            traps: [],
            fatigue_signals: [],
            contrarian_pick: null,
            source: 'no_data'
        };
    }

    // Build a compact summary for the prompt
    const inventorySummary = scoredInventories.slice(0, 30).map(inv => ({
        id: inv.id,
        name: inv.name || `ID:${inv.id}`,
        tier: inv.winner_tier,
        score: inv.composite_score,
        d6_roas: inv.d6_roas,
        d6_cac: inv.d6_cac,
        spend: inv.spend,
        d6_conversions: inv.d6_conversions,
        days_active: inv.days_active || null,
        status: inv.status || null
    }));

    const prompt = `You are a senior performance marketing analyst at a fintech company (Univest — stock trading & mutual funds app in India).

TASK: Analyze inventory (adset) performance data and recommend budget allocation.

VERTICAL: ${vertical || 'fintech_trading'}
TOTAL BUDGET: INR ${totalBudget || 'not specified'}

INVENTORY PERFORMANCE DATA:
${JSON.stringify(inventorySummary, null, 2)}

SCORING: Each inventory has a composite_score (0-10) based on: ROAS 35%, CAC 35%, Volume 20%, Stability 10%.
Tiers: WINNER >= 7, POTENTIAL >= 4.5, AVOID < 4.5

RESPOND IN STRICT JSON (no markdown, no backticks, just raw JSON):
{
  "recommended": ["list of inventory IDs to keep running, in priority order"],
  "budget_split": {"inventory_id": percentage, ...},
  "traps": ["inventory IDs that look good on one metric but are traps — explain why in 1 sentence each"],
  "fatigue_signals": ["inventory IDs showing signs of creative fatigue — declining ROAS, rising CAC, etc."],
  "contrarian_pick": {
    "id": "one POTENTIAL-tier inventory worth scaling",
    "reason": "1 sentence why"
  },
  "summary": "2-3 sentence executive summary"
}

RULES:
- Budget split percentages must sum to 100
- Never recommend more than 60% of budget on a single inventory
- AVOID-tier inventories should get 0% budget unless you have a strong contrarian reason
- If total_budget is not specified, give relative percentages only
- Be specific — reference actual IDs and numbers`;

    try {
        const resp = await axios.post('https://api.anthropic.com/v1/messages', {
            model: CLAUDE_MODEL,
            max_tokens: 2000,
            messages: [{ role: 'user', content: prompt }]
        }, {
            headers: {
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            timeout: 45000
        });

        const content = resp.data && resp.data.content && resp.data.content[0] && resp.data.content[0].text;
        if (!content) {
            console.warn('[inventory-engine] Empty Claude response, using fallback');
            return _fallbackRecommendations(scoredInventories, totalBudget);
        }

        // Parse JSON from response — handle potential markdown wrapping
        let cleaned = content.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        }

        try {
            const parsed = JSON.parse(cleaned);
            // Validate budget_split sums to ~100
            if (parsed.budget_split) {
                const splitSum = Object.values(parsed.budget_split).reduce((a, b) => a + (Number(b) || 0), 0);
                if (splitSum < 90 || splitSum > 110) {
                    console.warn(`[inventory-engine] AI budget_split sums to ${splitSum}%, normalizing`);
                    const factor = 100 / splitSum;
                    for (const key of Object.keys(parsed.budget_split)) {
                        parsed.budget_split[key] = Math.round(parsed.budget_split[key] * factor * 10) / 10;
                    }
                }
            }
            parsed.source = 'claude_ai';
            return parsed;
        } catch (parseErr) {
            console.error('[inventory-engine] Failed to parse Claude JSON:', parseErr.message);
            console.error('[inventory-engine] Raw response:', cleaned.substring(0, 500));
            return _fallbackRecommendations(scoredInventories, totalBudget);
        }

    } catch (err) {
        const msg = err.response ? `${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
        console.error('[inventory-engine] Claude API error:', msg);
        return _fallbackRecommendations(scoredInventories, totalBudget);
    }
}

/**
 * Fallback heuristic recommendations when Claude API is unavailable.
 */
function _fallbackRecommendations(scoredInventories, totalBudget) {
    const winners = scoredInventories.filter(i => i.winner_tier === 'WINNER');
    const potential = scoredInventories.filter(i => i.winner_tier === 'POTENTIAL');
    const avoid = scoredInventories.filter(i => i.winner_tier === 'AVOID');

    // Budget allocation: 70% to winners, 25% to potential, 5% test
    const recommended = [...winners, ...potential].map(i => i.id);

    const budgetSplit = {};
    const winnerCount = winners.length;
    const potentialCount = potential.length;

    if (winnerCount > 0) {
        const winnerShare = 70 / winnerCount;
        for (const w of winners) {
            budgetSplit[w.id] = Math.round(Math.min(winnerShare, 60) * 10) / 10;
        }
    }

    if (potentialCount > 0) {
        const remainingBudget = 100 - Object.values(budgetSplit).reduce((a, b) => a + b, 0);
        const potentialShare = remainingBudget / potentialCount;
        for (const p of potential) {
            budgetSplit[p.id] = Math.round(Math.min(potentialShare, 30) * 10) / 10;
        }
    }

    // Normalize to 100%
    const splitSum = Object.values(budgetSplit).reduce((a, b) => a + b, 0);
    if (splitSum > 0 && splitSum !== 100) {
        const factor = 100 / splitSum;
        for (const key of Object.keys(budgetSplit)) {
            budgetSplit[key] = Math.round(budgetSplit[key] * factor * 10) / 10;
        }
    }

    // Pick contrarian: best POTENTIAL-tier inventory
    const contrarianPick = potential.length > 0
        ? { id: potential[0].id, reason: 'Highest-scoring POTENTIAL inventory — may scale with more budget' }
        : null;

    return {
        recommended,
        budget_split: budgetSplit,
        traps: avoid.slice(0, 3).map(i =>
            `${i.id}: Score ${i.composite_score} — low composite across metrics, avoid scaling`
        ),
        fatigue_signals: [],
        contrarian_pick: contrarianPick,
        summary: `${winners.length} winner(s), ${potential.length} potential, ${avoid.length} to avoid. Heuristic allocation (Claude API unavailable).`,
        source: 'heuristic_fallback'
    };
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
    // Agent 1 — Math Engine
    calculateD6CAC,
    calculateD6CACByCampaign,
    projectBudgetOutcome,
    identifyWinners,

    // Agent 2 — Name Resolver
    resolveInventoryNames,
    getInventoryDisplayName,
    warmInventoryNameCache,

    // Agent 3 — AI Advisor
    generateInventoryRecommendations
};


