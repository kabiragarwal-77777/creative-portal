// =============================================================================
// Google Ads Campaign Optimizer — Scan → Analyze → Recommendations (Read-Only)
// Adapted from Meta optimizer.js for Google Ads (no write access)
// =============================================================================

(function() {
'use strict';

var GC_OPT_SCAN = null;
var GC_OPT_STAGE = 'scan'; // scan | loading | plan
var GC_OPT_ACTIVE_FILTER = 'all';
var GC_OPT_EXEC_PLAN = null;
var GC_OPT_EXEC_STATUS = {};
var GC_OPT_EXEC_LOG = loadGcExecLog();
var GC_OPT_LAST_EXEC_SUMMARY = null;
var GC_OPT_QUERY_RESULT = null;
var GC_OPT_SCAN_ERROR = null;
var GC_OPT_OVERVIEW_CAMPAIGN = '';
var GC_OPT_URL_PARAMS = new URLSearchParams(window.location.search || '');
var GC_OPT_EMBED_MODE = GC_OPT_URL_PARAMS.get('embed') || '';
var GC_OPT_AUTO_SCAN_PENDING = false;
var GC_OPT_AUTO_SCAN_STARTED = false;
var GC_OPT_BRAIN_CACHE = {};
var GC_OPT_BRAIN_CACHE_TTL_MS = 15 * 60 * 1000;
var GC_OPT_SCAN_CACHE_KEY_PREFIX = 'gc_optimizer_scan_cache.v8';
var GC_OPT_SCAN_CACHE_TTL_MS = 30 * 60 * 1000;
var GC_PORTAL_TREE_CACHE_PREFIX = 'googlePortal.tree.cache.v1';
var GC_PORTAL_CACHE_TTL_MS = 15 * 60 * 1000;
var GC_OPT_BROWSER_CACHE_NS = 'gc-optimizer';
var GC_OPT_BROWSER_CACHE_MEM = null;

// ── Helpers ──

function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

function gcPortalHeaders(extra) {
    var base = (window.PortalAuth && typeof window.PortalAuth.getHeaders === 'function') ? window.PortalAuth.getHeaders() : {};
    return Object.assign({}, base, extra || {});
}

function gcPortalApi(path) {
    return String(path || '').replace(/^\//, '');
}

function fmtINR(v) {
    if (v == null || isNaN(v)) return '--';
    if (Math.abs(v) >= 100000) return '\u20b9' + (v / 100000).toFixed(1) + 'L';
    if (Math.abs(v) >= 1000) return '\u20b9' + (v / 1000).toFixed(1) + 'K';
    return '\u20b9' + Math.round(v);
}

function fmtPct(v) { return v != null && !isNaN(v) ? parseFloat(v).toFixed(1) + '%' : '--'; }
function fmtNum(v) { return v != null ? Number(v).toLocaleString('en-IN') : '--'; }

function titleCaseWords(s) {
    return String(s || '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .map(function(w) { return w.charAt(0).toUpperCase() + w.slice(1); })
        .join(' ');
}

function formatRefreshStamp(value) {
    if (!value) return '--';
    var dt = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dt.getTime())) return String(value);
    return dt.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function normalizeGoogleJoinText(v) {
    return String(v || '').toLowerCase().trim();
}

var CS = 'background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;';
var CARD = 'background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;padding:14px;';

function _vR(sp, rev) {
    if (!sp || sp <= 0 || !rev || rev < 0) return null;
    if (rev / sp > 50) return null;
    return (rev / sp) * 100;
}

// ── Shared data pipeline ──

function emptyRaw() {
    return {
        spend: 0, impressions: 0, clicks: 0, installs: 0,
        conversions: 0, signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
        d6: 0, d6_revenue: 0, overall_revenue: 0,
        d6_overall_con: 0, d6_overall_revenue: 0,
        d15_overall_con: 0, d15_overall_revenue: 0,
        d30_overall_con: 0, d30_overall_revenue: 0,
        d60_overall_con: 0, d60_overall_revenue: 0,
        p0_signup: 0, p1_signup: 0, total_trial: 0,
        new_converted_user: 0, new_user_rev: 0,
    };
}

function sumRaw(items) {
    var t = emptyRaw();
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var keys = Object.keys(t);
        for (var k = 0; k < keys.length; k++) t[keys[k]] += (item[keys[k]] || 0);
    }
    return t;
}

function mergeMetricsPreferNonZero(base, overlay) {
    var merged = Object.assign({}, base || {});
    if (!overlay) return merged;
    var keys = Object.keys(emptyRaw());
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var baseVal = Number(merged[key]) || 0;
        var overlayVal = Number(overlay[key]) || 0;
        if (baseVal <= 0 && overlayVal > 0) merged[key] = overlayVal;
        if (key === 'spend' && baseVal <= 0 && overlayVal > 0) merged[key] = overlayVal;
    }
    return merged;
}

function deriveMetrics(r) {
    var p0p1 = (r.p0_signup || 0) + (r.p1_signup || 0);
    var d6Rev = r.d6_overall_revenue || 0;
    var d6Con = r.d6_overall_con || 0;
    return {
        spend: r.spend, impressions: r.impressions, clicks: r.clicks,
        installs: r.installs, conversions: r.conversions || 0,
        signups: r.signups, d0_trial: r.d0_trial, d0: r.d0, d0_revenue: r.d0_revenue,
        d6: r.d6, d6_revenue: r.d6_revenue, overall_revenue: r.overall_revenue,
        d6_overall_con: r.d6_overall_con, d6_overall_revenue: r.d6_overall_revenue,
        d15_overall_con: r.d15_overall_con, d15_overall_revenue: r.d15_overall_revenue,
        d30_overall_con: r.d30_overall_con, d30_overall_revenue: r.d30_overall_revenue,
        d60_overall_con: r.d60_overall_con, d60_overall_revenue: r.d60_overall_revenue,
        p0_signup: r.p0_signup, p1_signup: r.p1_signup, total_trial: r.total_trial,
        cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : null,
        ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null,
        cpi: r.installs > 0 ? r.spend / r.installs : null,
        signupCost: r.signups > 0 ? r.spend / r.signups : null,
        signupPct: r.installs > 0 ? (r.signups / r.installs) * 100 : null,
        p0p1: p0p1,
        d0TrialCost: r.d0_trial > 0 ? r.spend / r.d0_trial : null,
        d0CAC: r.d0 > 0 ? r.spend / r.d0 : null,
        d6Con: d6Con,
        d6CAC: d6Con > 0 ? r.spend / d6Con : null,
        d6Rev: d6Rev,
        d6ROAS: _vR(r.spend, d6Rev) || 0,
        d15ROAS: _vR(r.spend, r.d15_overall_revenue) || 0,
        d30ROAS: _vR(r.spend, r.d30_overall_revenue) || 0,
        d60ROAS: _vR(r.spend, r.d60_overall_revenue) || 0,
        overallROAS: _vR(r.spend, r.overall_revenue) || 0,
    };
}

function sumAdsets(list) { return deriveMetrics(sumRaw(list)); }

function rawFromItem(item) {
    var raw = emptyRaw();
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i++) raw[keys[i]] = Number(item && item[keys[i]]) || 0;
    return raw;
}

function getEvalRaw(item) {
    return (item && item._evalRaw) ? item._evalRaw : rawFromItem(item || {});
}

function sumEvaluated(items) {
    return deriveMetrics(sumRaw((items || []).map(getEvalRaw)));
}

function pluralize(word, count) {
    return count === 1 ? word : word + 's';
}

function buildMaturityNote(summary, matureKey, earlyKey, entityName) {
    var mature = Number(summary && summary[matureKey]) || 0;
    var early = Number(summary && summary[earlyKey]) || 0;
    if (mature > 0 && early > 0) return 'Mature where available; ' + early + ' early ' + pluralize(entityName, early) + ' still use full data';
    if (mature > 0) return 'Mature-evaluated data';
    if (early > 0) return 'Full data only; no mature ' + pluralize(entityName, early) + ' yet';
    return 'Maturity-aware metrics';
}

function loadGcBrowserCacheStore() {
    if (GC_OPT_BROWSER_CACHE_MEM) return GC_OPT_BROWSER_CACHE_MEM;
    GC_OPT_BROWSER_CACHE_MEM = {};
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', gcPortalApi('api/browser-cache/' + encodeURIComponent(GC_OPT_BROWSER_CACHE_NS)), false);
        xhr.send(null);
        if (xhr.status >= 200 && xhr.status < 300) {
            var parsed = JSON.parse(xhr.responseText || '{}');
            GC_OPT_BROWSER_CACHE_MEM = parsed && parsed.data ? parsed.data : {};
        }
    } catch (e) {}
    return GC_OPT_BROWSER_CACHE_MEM;
}

function getGcBrowserCacheEntry(key) {
    var store = loadGcBrowserCacheStore();
    var entry = store && store[key];
    if (!entry) return null;
    var ts = Number(entry.ts || 0);
    var ttlMs = Number(entry.ttlMs || 0);
    if (ttlMs > 0 && (Date.now() - ts) > ttlMs) {
        delete store[key];
        return null;
    }
    return entry;
}

function setGcBrowserCacheEntry(key, value, ttlMs) {
    var store = loadGcBrowserCacheStore();
    store[key] = { ts: Date.now(), ttlMs: Number(ttlMs || 0), value: value };
    GC_OPT_BROWSER_CACHE_MEM = store;
    try {
        fetch(gcPortalApi('api/browser-cache/' + encodeURIComponent(GC_OPT_BROWSER_CACHE_NS)), {
            method: 'POST',
            headers: gcPortalHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ key: key, value: store[key], ttlMs: ttlMs || 0 }),
            keepalive: true
        }).catch(function() {});
    } catch (e) {}
}

function deleteGcBrowserCacheEntry(key) {
    var store = loadGcBrowserCacheStore();
    if (store && Object.prototype.hasOwnProperty.call(store, key)) delete store[key];
    GC_OPT_BROWSER_CACHE_MEM = store;
    try {
        fetch(gcPortalApi('api/browser-cache/' + encodeURIComponent(GC_OPT_BROWSER_CACHE_NS) + '/' + encodeURIComponent(key)), {
            method: 'DELETE',
            keepalive: true
        }).catch(function() {});
    } catch (e) {}
}

function loadGcExecLog() {
    var entry = getGcBrowserCacheEntry('gc_optimizer_exec_log');
    return entry && Array.isArray(entry.value) ? entry.value : [];
}

function loadGcBrainCache() {
    var entry = getGcBrowserCacheEntry('gc_optimizer_brain_cache');
    return entry && entry.value && typeof entry.value === 'object' ? entry.value : {};
}

function saveGcBrainCache(cache) {
    setGcBrowserCacheEntry('gc_optimizer_brain_cache', cache || {}, GC_OPT_BRAIN_CACHE_TTL_MS);
}

function loadGcScanCache() {
    var entry = getGcBrowserCacheEntry(GC_OPT_SCAN_CACHE_KEY_PREFIX);
    return entry && entry.value && typeof entry.value === 'object' ? entry.value : {};
}

function saveGcScanCache(cache) {
    setGcBrowserCacheEntry(GC_OPT_SCAN_CACHE_KEY_PREFIX, cache || {}, GC_OPT_SCAN_CACHE_TTL_MS);
}

function isTrustworthyOptimizerScan(scan) {
    if (!scan) return false;
    var rawSpend = Number(scan.rawTotals && scan.rawTotals.spend || 0);
    var evalSpend = Number(scan.evaluatedTotals && scan.evaluatedTotals.spend || 0);
    var summarySpend = Number(scan.summary && scan.summary.total_spend || 0);
    return rawSpend > 0 || evalSpend > 0 || summarySpend > 0;
}

function clearUntrustworthyOptimizerScan() {
    try {
        if (!GC_OPT_SCAN || isTrustworthyOptimizerScan(GC_OPT_SCAN)) return;
        GC_OPT_SCAN = null;
        GC_OPT_SCAN_ERROR = 'Discarded stale zero-spend Google optimizer scan. Refreshing live data...';
        deleteGcBrowserCacheEntry(GC_OPT_SCAN_CACHE_KEY_PREFIX);
    } catch (e) {}
}

function getGoogleAccountTotals(scan, adsets) {
    var raw = scan && scan.rawTotals ? scan.rawTotals : null;
    var derived = adsets && adsets.length ? deriveMetrics(sumRaw(adsets)) : null;
    if (!raw && !derived) return {};
    var base = {};
    var keys = Object.keys(emptyRaw());
    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var rawVal = raw ? Number(raw[key]) || 0 : 0;
        var derivedVal = derived ? Number(derived[key]) || 0 : 0;
        base[key] = rawVal > 0 ? rawVal : derivedVal;
    }
    if (raw && Number(raw.spend || 0) > 0) base.spend = Number(raw.spend) || 0;
    if (!base.spend && derived) base.spend = Number(derived.spend) || 0;
    return deriveMetrics(base);
}

function readGoogleTreeSnapshotForRange(dr) {
    if (!dr || !dr.since || !dr.until) return null;
    var keys = [
        GC_PORTAL_TREE_CACHE_PREFIX + '.' + String(dr.since) + '.' + String(dr.until) + '.spend',
        GC_PORTAL_TREE_CACHE_PREFIX + '.' + String(dr.since) + '.' + String(dr.until) + '.all'
    ];
    for (var i = 0; i < keys.length; i++) {
        try {
            var entry = getGcBrowserCacheEntry(keys[i]);
            var parsed = entry && entry.value ? entry.value : null;
            if (parsed && parsed.ts && (Date.now() - Number(parsed.ts || 0)) <= GC_PORTAL_CACHE_TTL_MS && parsed.data && parsed.data.tree) {
                return parsed.data;
            }
        } catch (e) {}
    }
    if (window.__googleCampaignTreeSnapshot && window.__googleCampaignTreeSnapshot.tree) {
        return window.__googleCampaignTreeSnapshot;
    }
    return null;
}

function normalizeGoogleTreeKey(campaignName, adsetName) {
    return String(campaignName || '').trim().toLowerCase() + '|||' + String(adsetName || '').trim().toLowerCase();
}

function mergeGoogleTreeSnapshot(adsets, tree, snapshot) {
    if (!snapshot || !snapshot.tree) return { adsets: adsets, tree: tree };
    var lookup = {};
    Object.keys(snapshot.tree || {}).forEach(function(campName) {
        var camp = snapshot.tree[campName] || {};
        Object.keys(camp.adsets || {}).forEach(function(adsetName) {
            var adsetNode = camp.adsets[adsetName] || {};
            lookup[normalizeGoogleTreeKey(campName, adsetName)] = adsetNode.totals || adsetNode;
        });
    });
    var mergedAdsets = (adsets || []).map(function(a) {
        var merged = Object.assign({}, a);
        var cached = lookup[normalizeGoogleTreeKey(merged.campaign_name, merged.adset_name)];
        if (cached) {
            if ((Number(merged.spend) || 0) <= 0 || (Number(merged.signups) || 0) <= 0 || (Number(merged.d6_overall_revenue) || 0) <= 0) {
                merged = Object.assign({}, merged, {
                    spend: Number(cached.spend) || merged.spend || 0,
                    impressions: Number(cached.impressions) || merged.impressions || 0,
                    clicks: Number(cached.clicks) || merged.clicks || 0,
                    installs: Number(cached.installs || cached.conversions) || merged.installs || merged.conversions || 0,
                    conversions: Number(cached.conversions || cached.installs) || merged.conversions || merged.installs || 0,
                    signups: Number(cached.signups) || merged.signups || 0,
                    d0_trial: Number(cached.d0_trial) || merged.d0_trial || 0,
                    d0: Number(cached.d0) || merged.d0 || 0,
                    d0_revenue: Number(cached.d0_revenue) || merged.d0_revenue || 0,
                    d6: Number(cached.d6) || merged.d6 || 0,
                    d6_revenue: Number(cached.d6_revenue) || merged.d6_revenue || 0,
                    overall_revenue: Number(cached.overall_revenue) || merged.overall_revenue || 0,
                    d6_overall_con: Number(cached.d6_overall_con) || merged.d6_overall_con || 0,
                    d6_overall_revenue: Number(cached.d6_overall_revenue) || merged.d6_overall_revenue || 0,
                    d15_overall_con: Number(cached.d15_overall_con) || merged.d15_overall_con || 0,
                    d15_overall_revenue: Number(cached.d15_overall_revenue) || merged.d15_overall_revenue || 0,
                    d30_overall_con: Number(cached.d30_overall_con) || merged.d30_overall_con || 0,
                    d30_overall_revenue: Number(cached.d30_overall_revenue) || merged.d30_overall_revenue || 0,
                    d60_overall_con: Number(cached.d60_overall_con) || merged.d60_overall_con || 0,
                    d60_overall_revenue: Number(cached.d60_overall_revenue) || merged.d60_overall_revenue || 0
                });
                var raw = rawFromItem(merged);
                var derived = deriveMetrics(raw);
                merged = Object.assign({}, merged, derived, {
                    _evalRaw: raw,
                    evalSpend: raw.spend,
                    evalInstalls: raw.installs,
                    evalSignups: raw.signups,
                    evalD6: raw.d6_overall_con || raw.d6 || 0
                });
            }
        }
        return merged;
    });
    var mergedTree = {};
    for (var i = 0; i < mergedAdsets.length; i++) {
        var as = mergedAdsets[i];
        if (!mergedTree[as.campaign_name]) {
            mergedTree[as.campaign_name] = {
                name: as.campaign_name,
                id: as.campaign_id,
                type: as.campType,
                adsets: {},
                settings: {}
            };
        }
        mergedTree[as.campaign_name].adsets[as.adset_name] = as;
    }
    for (var ck in mergedTree) {
        mergedTree[ck].totals = sumEvaluated(Object.values(mergedTree[ck].adsets || {}));
        mergedTree[ck].totals.campType = mergedTree[ck].type;
    }
    return { adsets: mergedAdsets, tree: mergedTree };
}

function setPortalLoadState(state, text) {
    var el = document.getElementById('gcPortalLoadState');
    if (!el) return;
    var nextState = ['loading', 'cached', 'fresh'].includes(state) ? state : 'fresh';
    el.classList.remove('context-chip-load-ok', 'context-chip-load-warn', 'context-chip-load-cached');
    el.classList.add('context-chip-load');
    if (nextState === 'loading') {
        el.classList.add('context-chip-load-warn');
        el.textContent = text || 'Loading cached data...';
    } else if (nextState === 'cached') {
        el.classList.add('context-chip-load-cached');
        el.textContent = text || 'Cached';
    } else {
        el.classList.add('context-chip-load-ok');
        el.textContent = text || 'Fresh';
    }
}

function buildGcScanCacheKey(dr) {
    var since = dr && dr.since ? String(dr.since) : '';
    var until = dr && dr.until ? String(dr.until) : '';
    return since + '::' + until;
}

function getGcCachedScan(dr) {
    var cache = loadGcScanCache();
    var key = buildGcScanCacheKey(dr);
    var item = cache[key];
    if (!item || !item.scan) return null;
    if ((Date.now() - Number(item.ts || 0)) > GC_OPT_SCAN_CACHE_TTL_MS) {
        delete cache[key];
        saveGcScanCache(cache);
        return null;
    }
    return item;
}

function setGcCachedScan(dr, scan) {
    var cache = loadGcScanCache();
    var key = buildGcScanCacheKey(dr);
    cache[key] = { ts: Date.now(), scan: scan };
    saveGcScanCache(cache);
}

function buildGcBrainCacheKey(scan, prompt, parsed) {
    var summary = scan && scan.summary ? scan.summary : {};
    var dateRange = scan && scan.date_range ? scan.date_range : {};
    var fingerprint = {
        platform: 'google',
        version: 2,
        prompt: String(prompt || '').trim().toLowerCase(),
        command_type: parsed && parsed.command_type || '',
        session_mode: parsed && parsed.mode || '',
        target: parsed && parsed.target ? {
            type: parsed.target.type || '',
            query: String(parsed.target.query || '').trim().toLowerCase()
        } : {},
        date_range: {
            since: dateRange.since || '',
            until: dateRange.until || ''
        },
        totals: {
            spend: Number((scan.evaluatedTotals || scan.rawTotals || {}).spend || 0),
            signups: Number((scan.evaluatedTotals || scan.rawTotals || {}).signups || 0),
            d6_roas: Number((scan.evaluatedTotals || scan.rawTotals || {}).d6ROAS || 0),
            d6_cac: Number((scan.evaluatedTotals || scan.rawTotals || {}).d6CAC || 0)
        },
        summary: {
            total_campaigns: Number(summary.total_campaigns || 0),
            total_adsets: Number(summary.total_adsets || 0),
            matched_adsets: Number(summary.matched_adsets || 0),
            matured_adsets: Number(summary.matured_adsets || 0),
            early_adsets: Number(summary.early_adsets || 0)
        },
        integrity: {
            adCoveragePct: Math.round((scan.integrity || {}).adCoveragePct || 0),
            spendCoveragePct: Math.round((scan.integrity || {}).spendCoveragePct || 0),
            freshStatusPct: Math.round((scan.integrity || {}).freshStatusPct || 0)
        }
    };
    return JSON.stringify(fingerprint);
}

function getGcBrainCache(cacheKey) {
    if (!GC_OPT_BRAIN_CACHE) GC_OPT_BRAIN_CACHE = loadGcBrainCache();
    var item = GC_OPT_BRAIN_CACHE[cacheKey];
    if (!item) return null;
    if ((Date.now() - item.ts) > GC_OPT_BRAIN_CACHE_TTL_MS) {
        delete GC_OPT_BRAIN_CACHE[cacheKey];
        saveGcBrainCache(GC_OPT_BRAIN_CACHE);
        return null;
    }
    return item.value || null;
}

function setGcBrainCache(cacheKey, value) {
    if (!GC_OPT_BRAIN_CACHE) GC_OPT_BRAIN_CACHE = loadGcBrainCache();
    GC_OPT_BRAIN_CACHE[cacheKey] = { ts: Date.now(), value: value };
    saveGcBrainCache(GC_OPT_BRAIN_CACHE);
}

function saveGcExecLog() {
    setGcBrowserCacheEntry('gc_optimizer_exec_log', (GC_OPT_EXEC_LOG || []).slice(-200), 7 * 24 * 60 * 60 * 1000);
}

function budgetPctForRecommendation(action) {
    if (action === 'REDUCE BUDGET') return 50;
    if (action === 'SCALE') return 30;
    return 0;
}

function buildGoogleExecutionPlan(scan) {
    var plan = {
        actions: [],
        pauseActionsByAdsetId: {},
        campaignBudgetActionsByCampaignId: {},
        campaignBudgetLeadersByCampaignId: {},
        pauseCount: 0,
        budgetCount: 0
    };
    if (!scan) return plan;

    var adsets = scan.adsets || [];
    for (var i = 0; i < adsets.length; i++) {
        var adset = adsets[i];
        if (adset.recommendation && adset.recommendation.action === 'PAUSE' && adset.adset_id) {
            var pauseAction = {
                action_id: 'gc-pause-' + adset.adset_id,
                action_type: 'PAUSE_ADGROUP',
                entity_id: String(adset.adset_id),
                campaign_id: String(adset.campaign_id || ''),
                adset_id: String(adset.adset_id),
                entity_name: adset.adset_name || '',
                campaign_name: adset.campaign_name || '',
                recommended_action: adset.recommendation.action,
                priority: adset.recommendation.priority,
                short_label: 'Pause',
                execute_label: 'Pause Ad Group'
            };
            plan.actions.push(pauseAction);
            plan.pauseActionsByAdsetId[pauseAction.adset_id] = pauseAction;
            plan.pauseCount++;
        }
    }

    var tree = scan.tree || {};
    Object.keys(tree).forEach(function(campaignName) {
        var campaign = tree[campaignName] || {};
        var rec = campaign.recommendation || {};
        var campaignId = String(campaign.id || '');
        if (!campaignId || (rec.action !== 'REDUCE BUDGET' && rec.action !== 'SCALE')) return;

        var campaignAdsets = Object.values(campaign.adsets || {});
        var matching = campaignAdsets.filter(function(a) {
            return a && a.adset_id && a.recommendation && a.recommendation.action === rec.action;
        });
        var leaderPool = matching.length ? matching : campaignAdsets.filter(function(a) { return a && a.adset_id; });
        leaderPool.sort(function(a, b) { return (b.evalSpend || b.spend || 0) - (a.evalSpend || a.spend || 0); });
        var leader = leaderPool[0] || null;
        var budgetAction = {
            action_id: 'gc-budget-' + campaignId + '-' + (rec.action === 'SCALE' ? 'increase' : 'decrease'),
            action_type: 'UPDATE_CAMPAIGN_BUDGET',
            entity_id: campaignId,
            campaign_id: campaignId,
            entity_name: campaign.name || campaignName,
            campaign_name: campaign.name || campaignName,
            recommended_action: rec.action,
            priority: rec.priority,
            budget_action: rec.action === 'SCALE' ? 'increase' : 'decrease',
            change_pct: budgetPctForRecommendation(rec.action),
            short_label: rec.action === 'SCALE' ? 'Scale Camp' : 'Cut Camp',
            execute_label: rec.action === 'SCALE' ? 'Scale Campaign Budget' : 'Reduce Campaign Budget',
            leader_adset_id: leader && leader.adset_id ? String(leader.adset_id) : ''
        };
        plan.actions.push(budgetAction);
        plan.campaignBudgetActionsByCampaignId[campaignId] = budgetAction;
        if (budgetAction.leader_adset_id) {
            plan.campaignBudgetLeadersByCampaignId[campaignId] = budgetAction.leader_adset_id;
        }
        plan.budgetCount++;
    });

    return plan;
}

function getGoogleExecActionForAdset(adset) {
    if (!GC_OPT_EXEC_PLAN || !adset) return null;
    var adsetId = String(adset.adset_id || '');
    var campaignId = String(adset.campaign_id || '');
    if (adsetId && GC_OPT_EXEC_PLAN.pauseActionsByAdsetId[adsetId]) {
        return GC_OPT_EXEC_PLAN.pauseActionsByAdsetId[adsetId];
    }
    if (
        campaignId &&
        GC_OPT_EXEC_PLAN.campaignBudgetActionsByCampaignId[campaignId] &&
        GC_OPT_EXEC_PLAN.campaignBudgetLeadersByCampaignId[campaignId] === adsetId
    ) {
        return GC_OPT_EXEC_PLAN.campaignBudgetActionsByCampaignId[campaignId];
    }
    return null;
}

function pushGoogleExecLog(action, result, options) {
    var entry = {
        timestamp: new Date().toISOString(),
        action_id: action.action_id,
        action_type: action.action_type,
        action_label: action.execute_label,
        entity_name: action.entity_name,
        campaign_name: action.campaign_name,
        success: !!(result && result.success),
        error: result && result.error ? result.error : null,
        validate_only: !!(options && options.validateOnly)
    };
    GC_OPT_EXEC_LOG.push(entry);
    GC_OPT_EXEC_LOG = GC_OPT_EXEC_LOG.slice(-200);
    saveGcExecLog();
}

function setGoogleExecSummary(summary) {
    GC_OPT_LAST_EXEC_SUMMARY = summary;
}

function markGoogleExecResult(action, result, options) {
    GC_OPT_EXEC_STATUS[action.action_id] = {
        success: !!(result && result.success),
        error: result && result.error ? result.error : null,
        timestamp: new Date().toISOString(),
        details: result || null
    };
    pushGoogleExecLog(action, result, options);
}

async function executeGoogleAction(action, options) {
    if (!action) return { success: false, error: 'No Google execution action provided' };

    var endpoint = '';
    var payload = {};
    if (action.action_type === 'PAUSE_ADGROUP') {
        endpoint = 'api/google/adgroup-status';
        payload = { adgroup_id: action.adset_id || action.entity_id, status: 'PAUSED' };
    } else if (action.action_type === 'UPDATE_CAMPAIGN_BUDGET') {
        endpoint = 'api/google/campaign-budget';
        payload = {
            campaign_id: action.campaign_id || action.entity_id,
            action: action.budget_action,
            pct: action.change_pct
        };
    } else {
        return { success: false, error: 'Unsupported Google execution action' };
    }

    if (options && options.validateOnly) payload.validate_only = true;

    var response = await fetch(endpoint.replace(/^\//, ''), {
        method: 'POST',
        headers: gcPortalHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000)
    });

    var result;
    try {
        result = await response.json();
    } catch (err) {
        result = { success: false, error: 'Invalid server response' };
    }
    if (!response.ok && !result.error) result.error = 'HTTP ' + response.status;

    markGoogleExecResult(action, result, options);
    return result;
}

async function executeAllGoogleActions(actions, progressCb) {
    var results = [];
    for (var i = 0; i < actions.length; i++) {
        if (progressCb) progressCb(actions[i], i + 1, actions.length);
        var result;
        try {
            result = await executeGoogleAction(actions[i]);
        } catch (err) {
            result = { success: false, error: err.message };
            markGoogleExecResult(actions[i], result);
        }
        results.push({
            action_id: actions[i].action_id,
            entity_name: actions[i].entity_name,
            success: !!result.success,
            error: result.error || null
        });
        await new Promise(function(resolve) { setTimeout(resolve, 250); });
    }
    return {
        total: actions.length,
        succeeded: results.filter(function(r) { return r.success; }).length,
        failed: results.filter(function(r) { return !r.success; }).length,
        results: results
    };
}

function renderGoogleExecSummary() {
    var s = GC_OPT_LAST_EXEC_SUMMARY;
    if (!s) return '';
    var color = s.success ? 'var(--green)' : (s.failed ? 'var(--orange)' : 'var(--red)');
    var message = s.message || (s.success ? 'Execution complete' : 'Execution update');
    return '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid ' + color + ';">' +
        '<div style="font-size:12px;font-weight:700;color:' + color + ';">' + esc(message) + '</div>' +
        '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(s.detail || '') + '</div>' +
    '</div>';
}

function renderGoogleExecLogSection() {
    var log = GC_OPT_EXEC_LOG && GC_OPT_EXEC_LOG.length ? GC_OPT_EXEC_LOG.slice().reverse().slice(0, 12) : [];
    if (!log.length) return '';
    var html = '<div style="' + CS + 'margin-top:18px;">' +
        '<h3 style="font-size:13px;font-weight:600;margin-bottom:12px;">Execution Log</h3>' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
        '<thead><tr style="border-bottom:1px solid var(--border);">' +
            '<th style="text-align:left;padding:6px 8px;color:var(--text-dim);">Time</th>' +
            '<th style="text-align:left;padding:6px 8px;color:var(--text-dim);">Action</th>' +
            '<th style="text-align:left;padding:6px 8px;color:var(--text-dim);">Entity</th>' +
            '<th style="text-align:center;padding:6px 8px;color:var(--text-dim);">Result</th>' +
        '</tr></thead><tbody>';
    log.forEach(function(entry) {
        html += '<tr style="border-bottom:1px solid var(--border);">' +
            '<td style="padding:6px 8px;color:var(--text-dim);">' + new Date(entry.timestamp).toLocaleString() + '</td>' +
            '<td style="padding:6px 8px;color:var(--text);">' + esc(entry.action_label || entry.action_type) + '</td>' +
            '<td style="padding:6px 8px;color:var(--text);">' + esc(entry.entity_name || '') + '</td>' +
            '<td style="padding:6px 8px;text-align:center;color:' + (entry.success ? 'var(--green)' : 'var(--red)') + ';">' + (entry.success ? 'OK' : 'Failed') + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
}

// ── Date helpers ──

function getDefaultDates() {
    var now = new Date();
    var until = now.toISOString().split('T')[0];
    // Mirror Meta optimizer default window so Google starts from the same
    // broader evidence base for maturity, benchmarks, and daily analysis.
    var since = new Date(now - 29 * 86400000).toISOString().split('T')[0];
    return { since: since, until: until };
}

function getSelectedDates() {
    var fromEl = document.getElementById('gcOptDateFrom');
    var toEl = document.getElementById('gcOptDateTo');
    if (fromEl && toEl && fromEl.value && toEl.value) return { since: fromEl.value, until: toEl.value };
    return getDefaultDates();
}

// ── Campaign type detection ──

function detectCampaignType(name, type) {
    var n = String(name || '').toLowerCase();
    var t = String(type || '').toLowerCase();
    // Handle numeric enums from Google Ads API
    if (type === 6 || type === 'MULTI_CHANNEL' || t === '6') return 'UAC';
    if (type === 2 || type === 'SEARCH' || t === '2') return 'Search';
    if (type === 13 || type === 'PERFORMANCE_MAX' || t === '13') return 'PMax';
    if (type === 6 || type === 'VIDEO' || t.indexOf('video') !== -1) return 'Video';
    if (type === 3 || type === 'DISPLAY' || t === '3') return 'Display';
    if (t.indexOf('app') !== -1 || n.indexOf('uac') !== -1 || n.indexOf('app') !== -1) return 'UAC';
    if (n.indexOf('search') !== -1) return 'Search';
    if (n.indexOf('pmax') !== -1) return 'PMax';
    if (n.indexOf('video') !== -1 || n.indexOf('youtube') !== -1) return 'Video';
    if (n.indexOf('display') !== -1 || n.indexOf('gdn') !== -1) return 'Display';
    return 'Other';
}

function weightedMedian(items, valueGetter, weightGetter) {
    var pairs = (items || []).map(function(item) {
        return {
            value: valueGetter(item),
            weight: Math.max(0, Number(weightGetter(item)) || 0)
        };
    }).filter(function(pair) {
        return pair.value != null && !isNaN(pair.value) && pair.weight > 0;
    }).sort(function(a, b) {
        return a.value - b.value;
    });
    if (!pairs.length) return null;
    var totalWeight = pairs.reduce(function(sum, pair) { return sum + pair.weight; }, 0);
    var threshold = totalWeight / 2;
    var running = 0;
    for (var i = 0; i < pairs.length; i++) {
        running += pairs[i].weight;
        if (running >= threshold) return pairs[i].value;
    }
    return pairs[pairs.length - 1].value;
}

function weightedAverage(items, valueGetter, weightGetter) {
    var num = 0;
    var den = 0;
    (items || []).forEach(function(item) {
        var value = valueGetter(item);
        var weight = Math.max(0, Number(weightGetter(item)) || 0);
        if (value == null || isNaN(value) || weight <= 0) return;
        num += value * weight;
        den += weight;
    });
    return den > 0 ? num / den : null;
}

function buildGoogleBenchmarks(adsets) {
    var eligible = (adsets || []).filter(function(item) {
        return item &&
            item.isMatured &&
            (item.evalSpend || 0) >= 15000 &&
            ((item.evalSignups || 0) > 0 || (item.evalD6 || 0) > 0);
    });
    return {
        eligible_count: eligible.length,
        signupCost_median: weightedMedian(eligible, function(x) { return x.signupCost; }, function(x) { return x.evalSpend; }),
        d0TrialCost_median: weightedMedian(eligible, function(x) { return x.d0TrialCost; }, function(x) { return x.evalSpend; }),
        d6CAC_median: weightedMedian(eligible, function(x) { return x.d6CAC; }, function(x) { return x.evalSpend; }),
        d6ROAS_median: weightedMedian(eligible, function(x) { return x.d6ROAS; }, function(x) { return x.evalSpend; }),
        d15ROAS_median: weightedMedian(eligible, function(x) { return x.d15ROAS; }, function(x) { return x.evalSpend; }),
        d30ROAS_median: weightedMedian(eligible, function(x) { return x.d30ROAS; }, function(x) { return x.evalSpend; }),
        cpi_median: weightedMedian(eligible, function(x) { return x.cpi; }, function(x) { return x.evalSpend; }),
        spend_weighted_d6ROAS: weightedAverage(eligible, function(x) { return x.d6ROAS; }, function(x) { return x.evalSpend; }),
        spend_weighted_signupCost: weightedAverage(eligible, function(x) { return x.signupCost; }, function(x) { return x.evalSpend; })
    };
}

var GOOGLE_DECISION_MATURITY_DAYS = 29;

function scoreGoogleTrialWeek(week) {
    var score = 0;
    var notes = [];
    if (!week || !(Number(week.spend) > 0)) {
        return { score: null, label: 'no spend', notes: notes };
    }
    if ((Number(week.signups) || 0) > 0) {
        score += 2;
        notes.push('signups');
    } else {
        score -= 1;
    }
    if ((Number(week.d0_trial) || 0) > 0) {
        score += 1;
        notes.push('D0 trials');
    } else {
        score -= 1;
    }
    if (week.signupCost != null) {
        if (week.signupCost <= 800) score += 2;
        else if (week.signupCost <= 1200) score += 1;
        else if (week.signupCost > 2400) score -= 2;
        else if (week.signupCost > 1600) score -= 1;
    }
    if (week.d0TrialCost != null) {
        if (week.d0TrialCost <= 800) score += 2;
        else if (week.d0TrialCost <= 1200) score += 1;
        else if (week.d0TrialCost > 2400) score -= 2;
        else if (week.d0TrialCost > 1600) score -= 1;
    }
    if (week.cpi != null) {
        if (week.cpi <= 120) score += 1;
        else if (week.cpi > 240) score -= 1;
    }
    if (week.d6ROAS != null) {
        if (week.d6ROAS >= 28) score += 2;
        else if (week.d6ROAS >= 15) score += 1;
        else if (week.d6ROAS < 5) score -= 2;
        else score -= 1;
    }
    if ((Number(week.d6Revenue) || 0) > 0) score += 1;
    return {
        score: score,
        label: score >= 4 ? 'strong' : (score >= 1 ? 'improving' : (score <= -2 ? 'weak' : 'mixed')),
        notes: notes
    };
}

function buildGoogleWoWContext(adsets, googleRows, funnelRows) {
    var now = Date.now();
    var weekAgo = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
    var twoWeeksAgo = new Date(now - 14 * 86400000).toISOString().slice(0, 10);
    var threeWeeksAgo = new Date(now - 21 * 86400000).toISOString().slice(0, 10);
    var fourWeeksAgo = new Date(now - 28 * 86400000).toISOString().slice(0, 10);
    var funnelByKey = {};
    var weekly = {};

    (funnelRows || []).forEach(function(row) {
        var key = String(row.date || '').substring(0, 10) + '|||' + normalizeGoogleJoinText(row.ad_set_name || row.adgroup_name);
        funnelByKey[key] = row;
    });

    function ensureWeekly(key) {
        if (!weekly[key]) {
            weekly[key] = {
                thisWeek: { spend: 0, installs: 0, signups: 0, d0_trial: 0, d6_overall_con: 0, d6_overall_revenue: 0 },
                lastWeek: { spend: 0, installs: 0, signups: 0, d0_trial: 0, d6_overall_con: 0, d6_overall_revenue: 0 },
                prevWeek: { spend: 0, installs: 0, signups: 0, d0_trial: 0, d6_overall_con: 0, d6_overall_revenue: 0 },
                priorWeek: { spend: 0, installs: 0, signups: 0, d0_trial: 0, d6_overall_con: 0, d6_overall_revenue: 0 }
            };
        }
        return weekly[key];
    }

    (googleRows || []).forEach(function(row) {
        var key = normalizeGoogleJoinText(row.campaign_name) + '|||' + normalizeGoogleJoinText(row.adset_name || row.adgroup_name);
        var bucket = ensureWeekly(key);
        var date = row.date_start || row.date || row.segments_date || '';
        var target = null;
        if (date >= weekAgo) target = bucket.thisWeek;
        else if (date >= twoWeeksAgo) target = bucket.lastWeek;
        else if (date >= threeWeeksAgo) target = bucket.prevWeek;
        else if (date >= fourWeeksAgo) target = bucket.priorWeek;
        if (!target) return;
        target.spend += (Number(row.spend) || Number(row.cost_micros) / 1000000 || 0) * 1.18;
        target.installs += Number(row.conversions) || 0;
        var funnelKey = String(date || '') + '|||' + normalizeGoogleJoinText(row.campaign_name) + '|||' + normalizeGoogleJoinText(row.adset_name || row.adgroup_name);
        var funnel = funnelByKey[funnelKey];
        if (!funnel) return;
        target.signups += Number(funnel.signups) || 0;
        target.d0_trial += Number(funnel.d0_trial) || 0;
        target.d6_overall_con += Number(funnel.d6_overall_con) || 0;
        target.d6_overall_revenue += Number(funnel.d6_overall_revenue) || 0;
    });

    function weeklyDerived(raw) {
        var derived = deriveMetrics(raw);
        return {
            spend: raw.spend || 0,
            installs: raw.installs || 0,
            signups: raw.signups || 0,
            d0_trial: raw.d0_trial || 0,
            d6: raw.d6_overall_con || 0,
            d6ROAS: derived.d6ROAS || 0,
            signupCost: derived.signupCost,
            d0TrialCost: derived.d0TrialCost,
            cpi: derived.cpi,
            d6CAC: derived.d6CAC,
            d6Revenue: raw.d6_overall_revenue || 0
        };
    }

    function wowPct(curr, prev) {
        if (curr == null || prev == null || prev === 0) return null;
        return ((curr - prev) / Math.abs(prev)) * 100;
    }

    (adsets || []).forEach(function(adset) {
        var key = normalizeGoogleJoinText(adset.campaign_name) + '|||' + normalizeGoogleJoinText(adset.adset_name || adset.adgroup_name);
        var row = weekly[key];
        if (!row) {
            adset._wow = null;
            return;
        }
        var tw = weeklyDerived(row.thisWeek);
        var lw = weeklyDerived(row.lastWeek);
        var pw = weeklyDerived(row.prevWeek);
        var ow = weeklyDerived(row.priorWeek);
        var twScore = scoreGoogleTrialWeek(tw);
        var lwScore = scoreGoogleTrialWeek(lw);
        var pwScore = scoreGoogleTrialWeek(pw);
        var owScore = scoreGoogleTrialWeek(ow);
        var signupsWoW = wowPct(tw.signups, lw.signups);
        var signupsWoW2 = wowPct(lw.signups, pw.signups);
        var d6RevenueWoW = wowPct(tw.d6Revenue, lw.d6Revenue);
        var d6RevenueWoW2 = wowPct(lw.d6Revenue, pw.d6Revenue);
        var signupCostWoW = wowPct(tw.signupCost, lw.signupCost);
        var signupCostWoW2 = wowPct(lw.signupCost, pw.signupCost);
        var d0TrialCostWoW = wowPct(tw.d0TrialCost, lw.d0TrialCost);
        var d0TrialCostWoW2 = wowPct(lw.d0TrialCost, pw.d0TrialCost);
        var cpiWoW = wowPct(tw.cpi, lw.cpi);
        var cpiWoW2 = wowPct(lw.cpi, pw.cpi);
        var d6WoW = wowPct(tw.d6, lw.d6);
        var d6WoW2 = wowPct(lw.d6, pw.d6);
        var weakRunWeeks = 0;
        if (lwScore.score != null && lwScore.score <= 0) weakRunWeeks++;
        if (pwScore.score != null && pwScore.score <= 0) weakRunWeeks++;
        if (owScore.score != null && owScore.score <= 0) weakRunWeeks++;
        var recoveryAfterWeakRun = weakRunWeeks >= 3 && twScore.score != null && twScore.score > 0;
        var recentWeekImproving = twScore.score != null && lwScore.score != null ? twScore.score > lwScore.score : false;
        var continuousDecline =
            (signupCostWoW != null && signupCostWoW > 20 && signupCostWoW2 != null && signupCostWoW2 > 20) ||
            (d0TrialCostWoW != null && d0TrialCostWoW > 20 && d0TrialCostWoW2 != null && d0TrialCostWoW2 > 20) ||
            (cpiWoW != null && cpiWoW > 15 && cpiWoW2 != null && cpiWoW2 > 15) ||
            (signupsWoW != null && signupsWoW < -15 && signupsWoW2 != null && signupsWoW2 < -15) ||
            (d6RevenueWoW != null && d6RevenueWoW < -15 && d6RevenueWoW2 != null && d6RevenueWoW2 < -15);
        var continuousIncrease =
            (signupCostWoW != null && signupCostWoW < -15 && signupCostWoW2 != null && signupCostWoW2 < -15) ||
            (d0TrialCostWoW != null && d0TrialCostWoW < -15 && d0TrialCostWoW2 != null && d0TrialCostWoW2 < -15) ||
            (cpiWoW != null && cpiWoW < -10 && cpiWoW2 != null && cpiWoW2 < -10) ||
            (signupsWoW != null && signupsWoW > 15 && signupsWoW2 != null && signupsWoW2 > 15) ||
            (d6RevenueWoW != null && d6RevenueWoW > 15 && d6RevenueWoW2 != null && d6RevenueWoW2 > 15);
        var trendBreaches = 0;
        var trendHits = 0;
        if (signupCostWoW != null && signupCostWoW > 20) trendBreaches++;
        if (d0TrialCostWoW != null && d0TrialCostWoW > 20) trendBreaches++;
        if (cpiWoW != null && cpiWoW > 15) trendBreaches++;
        if (signupsWoW != null && signupsWoW < -15) trendBreaches++;
        if (d6RevenueWoW != null && d6RevenueWoW < -15) trendBreaches++;
        if (signupCostWoW != null && signupCostWoW < -15) trendHits++;
        if (d0TrialCostWoW != null && d0TrialCostWoW < -15) trendHits++;
        if (cpiWoW != null && cpiWoW < -10) trendHits++;
        if (signupsWoW != null && signupsWoW > 15) trendHits++;
        if (d6RevenueWoW != null && d6RevenueWoW > 15) trendHits++;
        if (recoveryAfterWeakRun) trendHits++;
        var maturedSpend = row.lastWeek.spend + row.prevWeek.spend;
        var maturedD6Rev = row.lastWeek.d6_overall_revenue + row.prevWeek.d6_overall_revenue;
        var maturedD6Con = row.lastWeek.d6_overall_con + row.prevWeek.d6_overall_con;
        adset._wow = {
            thisWeek: tw,
            lastWeek: lw,
            prevWeek: pw,
            priorWeek: ow,
            signupCost_wow: signupCostWoW,
            signupCost_wow2: signupCostWoW2,
            d0TrialCost_wow: d0TrialCostWoW,
            d0TrialCost_wow2: d0TrialCostWoW2,
            cpi_wow: cpiWoW,
            cpi_wow2: cpiWoW2,
            signups_wow: signupsWoW,
            signups_wow2: signupsWoW2,
            d6_wow: d6WoW,
            d6_wow2: d6WoW2,
            d6Revenue_wow: d6RevenueWoW,
            d6Revenue_wow2: d6RevenueWoW2,
            recentWeekScore: twScore.score,
            recentWeekLabel: twScore.label,
            recentWeekImproving: recentWeekImproving,
            recentWeekTrialFirst: true,
            weakRunWeeks: weakRunWeeks,
            recoveryAfterWeakRun: recoveryAfterWeakRun,
            trendBreaches: trendBreaches,
            trendHits: trendHits,
            trendDirection: recoveryAfterWeakRun ? 'recovering' : (trendBreaches >= 2 ? 'declining' : (trendHits >= 2 || recentWeekImproving ? 'improving' : 'stable')),
            continuousDecline: continuousDecline,
            continuousIncrease: continuousIncrease,
            maturedD6ROAS: maturedSpend > 0 ? (maturedD6Rev / maturedSpend) * 100 : null,
            maturedD6CAC: maturedD6Con > 0 ? maturedSpend / maturedD6Con : null,
            trialFirstNote: recoveryAfterWeakRun
                ? 'Recent week recovered after three weak weeks, so read it as a trial-first signal.'
                : 'Recent week is treated as a trial-first window; D6 ROAS is secondary until the pocket matures.'
        };
    });
}

function buildGoogleOptimizerLoop(adsets, tree, benchmarks, integrity, scan) {
    var rulesActions = [];
    var adgroupActions = [];
    var campaignActions = [];
    var warnings = [];
    var benchmarkNeutral = benchmarks && benchmarks.eligible_count >= 3;
    var adHealthByKey = {};
    var trendSummary = { recovery: 0, decline: 0, steady: 0, trial_first: 0 };
    var sourceCoverage = scan && scan.settingsCoverage ? scan.settingsCoverage : null;
    (scan && buildGoogleAdHealthAudits(scan) || []).forEach(function(audit) {
        var key = normalizeGoogleJoinText(audit.campaign_name) + '|||' + normalizeGoogleJoinText(audit.adset_name);
        adHealthByKey[key] = audit;
    });

    (adsets || []).slice().sort(function(a, b) {
        return (b.evalSpend || 0) - (a.evalSpend || 0);
    }).forEach(function(item) {
        var wow = item._wow || null;
        var spend = item.evalSpend || 0;
        var benchmarkFlags = [];
        var reasons = [];
        var positives = [];
        var actionOptions = [];
        var strongHistory = false;
        var priorBestD6 = 0;
        var sourceContext = [];
        var adHealth = adHealthByKey[normalizeGoogleJoinText(item.campaign_name) + '|||' + normalizeGoogleJoinText(item.adset_name || item.adgroup_name)] || null;
        var baseRec = item.recommendation || classifyActionAgainstBenchmarks(item, benchmarks, wow);
        if (wow && wow.lastWeek) priorBestD6 = Math.max(priorBestD6, wow.lastWeek.d6ROAS || 0);
        if (wow && wow.prevWeek) priorBestD6 = Math.max(priorBestD6, wow.prevWeek.d6ROAS || 0);
        if (wow && wow.maturedD6ROAS != null) priorBestD6 = Math.max(priorBestD6, wow.maturedD6ROAS || 0);
        strongHistory = priorBestD6 >= Math.max(28, Number(benchmarks && benchmarks.d6ROAS_median || 0) * 1.1);

        if (wow) {
            if (wow.recoveryAfterWeakRun) trendSummary.recovery++;
            else if (wow.trendDirection === 'declining' || wow.continuousDecline) trendSummary.decline++;
            else trendSummary.steady++;
            if (wow.recentWeekTrialFirst) trendSummary.trial_first++;
            sourceContext.push(wow.recoveryAfterWeakRun ? 'trend: recovery' : (wow.trendDirection === 'declining' ? 'trend: decline' : 'trend'));
        }

        if (benchmarks && benchmarks.d6ROAS_median && item.d6ROAS > 0) {
            if (item.d6ROAS < benchmarks.d6ROAS_median) benchmarkFlags.push('D6 ROAS below Google account median');
            else positives.push('D6 ROAS above Google account median');
        }
        if (benchmarks && benchmarks.signupCost_median && item.signupCost > 0) {
            if (item.signupCost > benchmarks.signupCost_median) benchmarkFlags.push('Signup cost above Google account median');
            else positives.push('Signup cost below Google account median');
        }
        if (benchmarks && benchmarks.d0TrialCost_median && item.d0TrialCost > 0) {
            if (item.d0TrialCost > benchmarks.d0TrialCost_median) benchmarkFlags.push('D0 trial cost above Google account median');
            else positives.push('D0 trial cost below Google account median');
        }
        if (benchmarks && benchmarks.cpi_median && item.cpi > 0) {
            if (item.cpi > benchmarks.cpi_median) benchmarkFlags.push('CPI above Google account median');
            else positives.push('CPI below Google account median');
        }

        if (!item.isMatured) {
            reasons.push('Still inside the 29-day decision window, so budget actions should stay conservative.');
            actionOptions.push('WATCH');
            if ((item.signupCost || 0) > 0 && (benchmarks.signupCost_median || 0) > 0 && item.signupCost > benchmarks.signupCost_median * 1.25) {
                actionOptions.push('CREATIVE_REFRESH');
                reasons.push('Early signup cost is already drifting above benchmark.');
            }
        } else {
            if ((item.evalSignups || 0) === 0 && spend >= 20000) reasons.push('Material spend without signups is a hard red signal.');
            if (item.d6ROAS > 0 && item.d6ROAS < 15 && spend >= 20000) reasons.push('Mature D6 ROAS is below the lower operating band.');
            if (item.d6CAC > 0 && benchmarks.d6CAC_median && item.d6CAC > benchmarks.d6CAC_median * 1.3) reasons.push('Downstream CAC is above the mature account benchmark.');
        }

        if (wow && wow.continuousDecline) reasons.push('Continuous week-on-week decline in cost or output is a major red signal.');
        if (wow && wow.continuousIncrease) positives.push('Continuous week-on-week improvement is a major green signal.');
        if (wow && wow.signups_wow != null && wow.signups_wow < -20) reasons.push('Signups are down ' + Math.abs(wow.signups_wow).toFixed(0) + '% WoW.');
        if (wow && wow.d6Revenue_wow != null && wow.d6Revenue_wow < -20) reasons.push('D6 revenue is down ' + Math.abs(wow.d6Revenue_wow).toFixed(0) + '% WoW.');
        if (wow && wow.signups_wow != null && wow.signups_wow > 15) positives.push('Signups are up ' + wow.signups_wow.toFixed(0) + '% WoW.');
        if (wow && wow.d6Revenue_wow != null && wow.d6Revenue_wow > 15) positives.push('D6 revenue is up ' + wow.d6Revenue_wow.toFixed(0) + '% WoW.');

        if (item.searchAudit && item.searchAudit.actions && item.searchAudit.actions.length) {
            reasons.push(item.searchAudit.actions[0]);
            actionOptions.push('SEARCH_CLEANUP');
            sourceContext.push('search terms');
        }
        if (item.settingsAudit && item.settingsAudit.actions && item.settingsAudit.actions.length) {
            reasons.push(item.settingsAudit.actions[0]);
            actionOptions.push('SETTINGS_FIX');
            sourceContext.push('settings');
        }
        if (item.settings && item.settings.breakdowns && item.settings.breakdowns.length) sourceContext.push('placements');
        if (item.settings && item.settings.audiences && item.settings.audiences.length) sourceContext.push('audiences');
        if (item.settings && item.settings.keywords && item.settings.keywords.length) sourceContext.push('keywords');
        if (item.settings && item.settings.assetGroups && item.settings.assetGroups.length) sourceContext.push('asset groups');
        if (adHealth) {
            sourceContext.push('ad assets');
            if (adHealth.creative_summary) sourceContext.push('headlines');
        }
        sourceContext = sourceContext.filter(function(value, index, arr) { return value && arr.indexOf(value) === index; });

        var nextAction = baseRec.action || 'WATCH';
        var priority = baseRec.priority || 'P3';
        var reasonText = baseRec.reason || 'Review current performance.';
        var impactText = baseRec.impact || '--';
        var confidence = spend >= 30000 && item.isMatured ? 'high' : (spend >= 15000 ? 'medium' : 'low');

        if (!item.isMatured) {
            if (wow && (wow.recentWeekImproving || wow.recoveryAfterWeakRun) && positives.length) {
                nextAction = 'MAINTAIN';
                reasonText = wow && wow.recoveryAfterWeakRun
                    ? 'Recent week recovered after a weak run, but the ad group is still inside the 29-day learning window.'
                    : 'Early signals are improving, but the ad group is still inside the 29-day learning window.';
                impactText = 'Hold spend steady and let the signal mature.';
            } else if (benchmarkFlags.length >= 2 && spend >= 15000 && !(wow && wow.recoveryAfterWeakRun)) {
                nextAction = 'OPTIMIZE';
                reasonText = 'Early efficiency is weak versus current Google medians, but it is too early for a hard budget move.';
                impactText = 'Refresh assets or tighten settings before reducing spend.';
            } else {
                nextAction = 'WATCH';
                reasonText = 'Collect more data before making structural budget moves.';
                impactText = 'Reassess after the ad group exits the 29-day decision window.';
            }
            priority = 'P3';
        } else if (wow && wow.recoveryAfterWeakRun && (nextAction === 'PAUSE' || nextAction === 'REDUCE BUDGET')) {
            nextAction = positives.length >= 2 && benchmarkNeutral ? 'SCALE' : 'OPTIMIZE';
            reasonText = 'Three weak weeks were followed by a recent recovery, so the newest window should stay trial-first instead of being cut on D6 ROAS alone.';
            impactText = nextAction === 'SCALE' ? 'Allow the recovery to compound in controlled steps.' : 'Keep the pocket live and fix the remaining leak.';
            actionOptions.push('CREATIVE_REFRESH');
            priority = nextAction === 'SCALE' ? 'P1' : 'P2';
        } else if (wow && wow.continuousDecline && strongHistory) {
            nextAction = 'REDUCE BUDGET';
            reasonText = 'Historically strong ad group has recently declined. Cut carefully instead of pausing immediately.';
            impactText = 'Protect spend while giving room for recovery.';
            actionOptions.push('CREATIVE_REFRESH');
            priority = 'P2';
        } else if (wow && wow.continuousIncrease && positives.length >= 2 && spend >= 20000) {
            nextAction = 'SCALE';
            reasonText = 'Mature performance is above benchmark and improving week on week.';
            impactText = 'Increase budget in controlled steps.';
            actionOptions.push('BUDGET_INCREASE');
            priority = 'P1';
        } else if ((item.evalSignups || 0) === 0 && spend >= 20000) {
            nextAction = 'PAUSE';
            reasonText = 'No signups on material spend after maturity.';
            impactText = 'Stop a confirmed budget leak.';
            actionOptions.push('PAUSE_ADGROUP');
            priority = 'P1';
        } else if (benchmarkFlags.length >= 3 && spend >= 25000 && !strongHistory) {
            nextAction = 'REDUCE BUDGET';
            reasonText = 'Multiple benchmark breaches on a mature ad group point to clear inefficiency.';
            impactText = 'Reduce budget and fix structure before testing more spend.';
            actionOptions.push('CREATIVE_REFRESH');
            priority = 'P2';
        } else if (positives.length >= 2 && benchmarkNeutral && item.d6ROAS >= Math.max(28, Number(benchmarks && benchmarks.d6ROAS_median || 0))) {
            nextAction = 'SCALE';
            reasonText = 'Ad group is outperforming Google account medians with enough maturity to scale.';
            impactText = 'Push more budget into a benchmark-positive pocket.';
            actionOptions.push('BUDGET_INCREASE');
            priority = 'P1';
        } else if (benchmarkFlags.length >= 2 || (item.searchAudit && item.searchAudit.actions && item.searchAudit.actions.length)) {
            nextAction = 'OPTIMIZE';
            reasonText = 'Performance is mixed and should be improved through structure, search terms, settings, or creative before a harder budget move.';
            impactText = 'Tighten efficiency first.';
            actionOptions.push('CREATIVE_REFRESH');
            priority = 'P2';
        }

        actionOptions.push(nextAction);
        actionOptions = actionOptions.filter(function(value, index, arr) { return value && arr.indexOf(value) === index; });
        var actionDetails = buildGoogleActionExecutionDetails(item, {
            action: nextAction,
            reason: reasonText,
            impact: impactText,
            do_line: buildGoogleRecommendedDoLine(item, nextAction)
        });
        item.recommendation = Object.assign({}, item.recommendation || {}, {
            action: nextAction,
            color: nextAction === 'PAUSE' ? 'var(--red)' : (nextAction === 'SCALE' || nextAction === 'MAINTAIN' ? 'var(--green)' : (nextAction === 'REDUCE BUDGET' ? 'var(--orange)' : 'var(--blue)')),
            reason: reasonText,
            impact: impactText,
            budget_text: actionDetails.budget_text,
            next_step: actionDetails.next_step,
            evidence: actionDetails.evidence,
            priority: priority,
            benchmark_context: benchmarkFlags,
            positives: positives,
            trend_context: wow ? {
                direction: wow.trendDirection,
                continuousDecline: !!wow.continuousDecline,
                continuousIncrease: !!wow.continuousIncrease,
                signups_wow: wow.signups_wow,
                d6Revenue_wow: wow.d6Revenue_wow
            } : null,
            history_context: {
                strong_history: strongHistory,
                prior_best_d6_roas: priorBestD6
            },
            confidence: confidence,
            suggested_actions: actionOptions,
            do_line: buildGoogleRecommendedDoLine(item, nextAction),
            do_not: buildGoogleRecommendedDoNot(item, nextAction),
            key_question: buildGoogleKeyQuestion(item),
            creative_insights: adHealth ? (adHealth.creative_summary || (adHealth.notes && adHealth.notes[0]) || (adHealth.positives && adHealth.positives[0]) || '') : '',
            source_context: sourceContext,
            validation_basis: {
                maturity_days: GOOGLE_DECISION_MATURITY_DAYS,
                google_benchmarks_only: true,
                weighted_benchmark_eligible_count: benchmarks && benchmarks.eligible_count || 0
            },
            flags: (reasons || []).concat(benchmarkFlags || [])
        });

        rulesActions.push({
            level: 'adgroup',
            campaign: item.campaign_name,
            adset: item.adset_name,
            action: nextAction,
            reason: reasonText,
            spend: spend,
            d6_roas: item.d6ROAS || 0,
            signup_cost: item.signupCost || null,
            confidence: confidence,
            source_context: sourceContext
        });
    });

    Object.keys(tree || {}).forEach(function(campaignName) {
        var bucket = tree[campaignName];
        var members = Object.values(bucket.adsets || {});
        var totals = bucket.totals || {};
        var red = members.filter(function(x) {
            return x.recommendation && (x.recommendation.action === 'PAUSE' || x.recommendation.action === 'REDUCE BUDGET');
        });
        var green = members.filter(function(x) {
            return x.recommendation && (x.recommendation.action === 'SCALE' || x.recommendation.action === 'MAINTAIN');
        });
        var continuousDecliners = members.filter(function(x) { return x._wow && x._wow.continuousDecline; });
        var strongHistoryDecliners = members.filter(function(x) {
            return x._wow && x._wow.continuousDecline && x.recommendation && x.recommendation.history_context && x.recommendation.history_context.strong_history;
        });
        var campaignAction = null;
        if (members.length && red.length === members.length && (totals.spend || 0) >= 50000) {
            campaignAction = { level: 'campaign', campaign: campaignName, action: 'CUT_CAMPAIGN_BUDGET', reason: 'Every ad group is underperforming, so campaign budget should be reduced.' };
        } else if (strongHistoryDecliners.length > 0) {
            campaignAction = { level: 'campaign', campaign: campaignName, action: 'WATCH_CAMPAIGN', reason: strongHistoryDecliners.length + ' ad group(s) were strong historically but are now declining. Refresh before making hard cuts.' };
        } else if (continuousDecliners.length >= Math.max(2, Math.round(members.length * 0.5)) && (totals.spend || 0) >= 40000) {
            campaignAction = { level: 'campaign', campaign: campaignName, action: 'CREATIVE_REFRESH', reason: 'A majority of ad groups show continuous WoW decline.' };
        } else if (green.length > 0 && (totals.d6ROAS || 0) >= Math.max(28, Number(benchmarks && benchmarks.d6ROAS_median || 0)) && (totals.spend || 0) >= 50000) {
            campaignAction = { level: 'campaign', campaign: campaignName, action: 'SCALE_CAMPAIGN', reason: 'Campaign-level D6 ROAS is benchmark-positive with at least one scalable ad group.' };
        } else if (red.length >= Math.max(1, Math.round(members.length * 0.6)) && (totals.spend || 0) >= 40000) {
            campaignAction = { level: 'campaign', campaign: campaignName, action: 'CUT_CAMPAIGN_BUDGET', reason: 'Most ad groups are weak versus benchmark, so campaign spend should be reduced.' };
        } else if (green.length && !red.length) {
            campaignAction = { level: 'campaign', campaign: campaignName, action: 'MAINTAIN_CAMPAIGN', reason: 'Campaign is stable with no major negative pockets.' };
        }
        if (campaignAction) campaignActions.push(campaignAction);
        bucket.recommendation = bucket.recommendation || {};
        if (campaignAction) {
            bucket.recommendation.meta_loop_action = campaignAction.action;
            bucket.recommendation.meta_loop_reason = campaignAction.reason;
        }
    });

    adgroupActions = rulesActions.filter(function(action) { return action.level === 'adgroup'; });

    if ((integrity && integrity.adCoveragePct || 0) < 70) warnings.push('Ad group coverage is below 70%, so Google optimizer decisions should be treated cautiously.');
    if ((integrity && integrity.spendCoveragePct || 0) < 80) warnings.push('Matched spend coverage is below 80%, so cross-portal totals may drift.');
    if (!benchmarkNeutral) warnings.push('Too few mature Google ad groups are eligible for stable weighted medians.');

    return {
        input: {
            sources: [
                'Google Ads API',
                'Metabase funnel',
                'Google campaign settings',
                'Google ad group settings',
                'Google placements / breakdowns',
                'Google audiences',
                'Google search terms / keywords',
                'Google asset groups',
                'Google ad assets'
            ],
            maturity_days: GOOGLE_DECISION_MATURITY_DAYS
        },
        process: {
            raw_first_aggregation: true,
            benchmark_mode: 'google_only_weighted_medians',
            wow_enabled: true,
            layers: ['trend', 'settings', 'placements', 'audiences', 'search terms', 'asset groups', 'ad assets', 'adgroup', 'campaign']
        },
        trend: {
            recent_week_mode: 'trial-first',
            recovery_count: trendSummary.recovery,
            decline_count: trendSummary.decline,
            steady_count: trendSummary.steady,
            trial_first_count: trendSummary.trial_first,
            note: trendSummary.recovery
                ? 'Recent week recovery is being protected and evaluated as a trial-first window.'
                : 'Recent week is being evaluated as a trial-first window; D6 ROAS is secondary until maturity.'
        },
        source_coverage: sourceCoverage ? {
            campaigns: sourceCoverage.campaigns || 0,
            adgroups: sourceCoverage.adgroups || 0,
            breakdowns: sourceCoverage.breakdowns || 0,
            audiences: sourceCoverage.audiences || 0,
            keywords: sourceCoverage.keywords || 0,
            searchTerms: sourceCoverage.searchTerms || 0,
            assetGroups: sourceCoverage.assetGroups || 0,
            ads: sourceCoverage.ads || 0
        } : null,
        output: {
            pause: rulesActions.filter(function(x) { return x.action === 'PAUSE'; }).length,
            reduce: rulesActions.filter(function(x) { return x.action === 'REDUCE BUDGET'; }).length,
            scale: rulesActions.filter(function(x) { return x.action === 'SCALE'; }).length,
            optimize: rulesActions.filter(function(x) { return x.action === 'OPTIMIZE'; }).length,
            maintain: rulesActions.filter(function(x) { return x.action === 'MAINTAIN'; }).length,
            watch: rulesActions.filter(function(x) { return x.action === 'WATCH'; }).length
        },
        rulesActions: rulesActions,
        adgroupActions: adgroupActions,
        campaignActions: campaignActions,
        warnings: warnings
    };
}

function buildGoogleRecommendedDoLine(item, nextAction) {
    var searchAction = item && item.searchAudit && item.searchAudit.actions && item.searchAudit.actions.length ? item.searchAudit.actions[0] : '';
    var settingsAction = item && item.settingsAudit && item.settingsAudit.actions && item.settingsAudit.actions.length ? item.settingsAudit.actions[0] : '';
    var wow = item && item._wow ? item._wow : null;
    if (nextAction === 'PAUSE') return [
        '1) Pause this ad group now and keep the campaign budget unchanged for one more mature read.',
        '2) Check whether the problem is search terms, bid settings, or asset-group quality before re-opening spend.',
        '3) Reallocate spend only after the leak is isolated and a control pocket is still live.'
    ].join(' ');
    if (nextAction === 'REDUCE BUDGET') {
        if (wow && wow.continuousDecline && item.recommendation && item.recommendation.history_context && item.recommendation.history_context.strong_history) {
            return [
                '1) Reduce the campaign budget by 15-20%.',
                '2) Keep the strongest ad group or asset group untouched as the control.',
                '3) Refresh the weakest assets and review search terms or settings before any second budget change.'
            ].join(' ');
        }
        return [
            '1) Cut only the campaign budget by 15-25%.',
            '2) Identify the leak inside search terms, bid settings, asset-group quality, or geo/device mix.',
            '3) Fix that leak first, then let spend expand again only after one clean mature read.'
        ].join(' ');
    }
    if (nextAction === 'SCALE') return [
        '1) Scale only through campaign budget in controlled 10-15% steps.',
        '2) Keep the strongest ad-group and asset-group structure unchanged as the control.',
        '3) Recheck WoW output before the next budget step.'
    ].join(' ');
    if (nextAction === 'OPTIMIZE') {
        if (searchAction) return searchAction;
        if (settingsAction) return settingsAction;
        return [
            '1) Refresh creatives or asset groups if the hook or message is the leak.',
            '2) Tighten search/query quality and remove wasteful terms or settings before changing budget.',
            '3) Review bidding, audience, network, and geo mix after the weak pocket is isolated.'
        ].join(' ');
    }
    if (nextAction === 'MAINTAIN') return [
        '1) Hold the current setup unchanged today.',
        '2) Protect this pocket from unnecessary edits while WoW settles.',
        '3) Revisit only if search terms, settings, or asset quality break again.'
    ].join(' ');
    return searchAction || settingsAction || [
        '1) Hold for now and review the weakest structural signal first.',
        '2) Keep one control pocket live while you isolate the leak.',
        '3) Do not make a second budget or settings edit until the issue is clear.'
    ].join(' ');
}

function buildGoogleRecommendedDoNot(item, nextAction) {
    if (nextAction === 'SCALE') return 'Do not stack multiple targeting, bid, and creative edits on the same ad group while scaling.';
    if (nextAction === 'PAUSE') return 'Do not pause sibling winners just because this one is weak.';
    if (nextAction === 'REDUCE BUDGET') return 'Do not hard-cut a historically strong pocket in one move unless conversion signal is fully broken.';
    if (nextAction === 'OPTIMIZE') return 'Do not combine budget cuts, bid changes, and creative refreshes all at once.';
    return 'Do not make a second structural change on this entity today.';
}

function buildGoogleKeyQuestion(item) {
    if (!item) return 'What is the main efficiency constraint on this ad group right now?';
    if (item.searchAudit && item.searchAudit.actions && item.searchAudit.actions.length) return 'Is search query quality the main reason this ad group is underperforming?';
    if (item.settingsAudit && item.settingsAudit.actions && item.settingsAudit.actions.length) return 'Is a campaign or ad group setting constraining delivery quality or conversion efficiency?';
    if (item._wow && item._wow.continuousDecline) return 'Is this a structural decline or a temporary recent drop from a historically strong base?';
    return 'Is the next move here creative, budget, bid, or audience/settings?';
}

function buildGoogleStructuredMorningBrief(scan) {
    var campaignAudits = buildGoogleCampaignSettingsAudits(scan);
    var adgroupAudits = buildGoogleAdgroupSettingsAudits(scan);
    var adHealthAudits = buildGoogleAdHealthAudits(scan);
    function findAdgroupAudit(campaignName, adsetName) {
        return adgroupAudits.find(function(item) {
            return item.campaign_name === campaignName && item.adset_name === adsetName;
        }) || null;
    }
    function findAdHealthAudit(campaignName, adsetName) {
        return adHealthAudits.find(function(item) {
            return item.campaign_name === campaignName && item.adset_name === adsetName;
        }) || null;
    }
    function findCampaignAudit(campaignName) {
        return campaignAudits.find(function(item) { return item.campaign_name === campaignName; }) || null;
    }
    var adsets = (scan && scan.adsets || []).slice().sort(function(a, b) {
        var order = { P1: 0, P2: 1, P3: 2 };
        var pa = order[(a.recommendation && a.recommendation.priority) || 'P3'];
        var pb = order[(b.recommendation && b.recommendation.priority) || 'P3'];
        if (pa !== pb) return pa - pb;
        return (b.evalSpend || 0) - (a.evalSpend || 0);
    });
    var actionable = adsets.filter(function(a) {
        var action = String(a.recommendation && a.recommendation.action || '');
        return /PAUSE|REDUCE BUDGET|SCALE|OPTIMIZE/.test(action);
    });
    var protectedRows = adsets.filter(function(a) {
        var action = String(a.recommendation && a.recommendation.action || '');
        return /MAINTAIN|SCALE|WATCH/.test(action);
    });
    var doNow = actionable.slice(0, 7).map(function(a) {
        var rec = a.recommendation || {};
        var audit = findAdgroupAudit(a.campaign_name || '', a.adset_name || a.adgroup_name || '');
        var adHealth = findAdHealthAudit(a.campaign_name || '', a.adset_name || a.adgroup_name || '');
        var why = (audit && audit.reason) || rec.reason || 'Current ad-group recommendation based on mature data, benchmarks, and WoW trend.';
        var doLine = (audit && audit.do_line) || rec.do_line || buildGoogleRecommendedDoLine(a, rec.action);
        if (adHealth && adHealth.action === 'CREATIVE_REFRESH' && !/creative/i.test(doLine)) {
            doLine += ' Creative layer: ' + adHealth.do_line;
        }
        return {
            title: (a.campaign_name || '--') + ' → ' + (a.adset_name || '--') + ' → ' + (rec.action || 'WATCH'),
            why: why,
            do: doLine,
            do_not: rec.do_not || buildGoogleRecommendedDoNot(a, rec.action)
        };
    });
    var leaveAlone = protectedRows.slice(0, 5).map(function(a) {
        var rec = a.recommendation || {};
        return {
            title: (a.campaign_name || '--') + ' → ' + (a.adset_name || '--'),
            reason: rec.reason || 'Current signal does not justify a hard change today.',
            watch_for: rec.trend_context && rec.trend_context.continuousDecline ? 'Watch closely for a second week of weakness before acting.' : 'Only intervene if costs break or output rolls over.'
        };
    });
    var campaigns = Object.keys(scan && scan.tree || {}).map(function(name) {
        var campaign = scan.tree[name] || {};
        var adsetList = Object.values(campaign.adsets || {}).sort(function(a, b) { return (b.evalSpend || 0) - (a.evalSpend || 0); });
        var topAdset = adsetList[0] || null;
        var campaignRec = campaign.recommendation || {};
        var campaignAudit = findCampaignAudit(name);
        var topAdgroupAudit = topAdset ? findAdgroupAudit(topAdset.campaign_name || '', topAdset.adset_name || topAdset.adgroup_name || '') : null;
        var topAdHealth = topAdset ? findAdHealthAudit(topAdset.campaign_name || '', topAdset.adset_name || topAdset.adgroup_name || '') : null;
        return {
            campaign_name: name,
            status: (campaignAudit && campaignAudit.classification) || campaignRec.meta_loop_action || campaignRec.action || 'WATCH',
            trend: (campaignAudit && campaignAudit.reason) || campaignRec.meta_loop_reason || campaignRec.reason || ('Spend ' + fmtINR(((campaign.totals || {}).spend) || 0)),
            adset_insights: topAdset ? ((topAdset.adset_name || '--') + ': ' + (((topAdgroupAudit && topAdgroupAudit.reason) || (topAdset.recommendation && topAdset.recommendation.reason)) || 'No major issue flagged')) : 'No ad-group detail available.',
            creative_insights: topAdHealth ? ((topAdHealth.reason || 'Review the creative') + (topAdHealth.asset_signal ? ' | ' + topAdHealth.asset_signal : '') + (topAdHealth.asset_why ? ' | ' + topAdHealth.asset_why : '')) : (topAdset && topAdset.searchAudit && topAdset.searchAudit.actions && topAdset.searchAudit.actions.length ? topAdset.searchAudit.actions[0] : (topAdset && topAdset.settingsAudit && topAdset.settingsAudit.actions && topAdset.settingsAudit.actions.length ? topAdset.settingsAudit.actions[0] : 'Review whether the current top-spend ad group needs a creative or structural change.')),
            key_question: topAdset ? buildGoogleKeyQuestion(topAdset) : 'Which ad group is truly driving this campaign outcome?'
        };
    }).slice(0, 8);
    var weekMoves = actionable.slice(0, 4).map(function(a) {
        return { title: (a.campaign_name || '--') + ' → ' + (a.adset_name || '--') + ' → ' + ((a.recommendation && a.recommendation.action) || 'WATCH') };
    });
    var risks = actionable.filter(function(a) {
        return a._wow && a._wow.continuousDecline;
    }).slice(0, 3).map(function(a) {
        return { risk: (a.campaign_name || '--') + ' → ' + (a.adset_name || '--') + ' is in continuous decline.' };
    });
    var opportunities = protectedRows.filter(function(a) {
        return a._wow && a._wow.continuousIncrease;
    }).slice(0, 3).map(function(a) {
        return { opportunity: (a.campaign_name || '--') + ' → ' + (a.adset_name || '--') + ' is improving and can be protected or scaled carefully.' };
    });
    return {
        what_to_do_right_now: doNow,
        what_to_leave_alone: leaveAlone,
        campaign_insights: campaigns,
        this_weeks_moves: weekMoves,
        thirty_day_horizon: { risks: risks, opportunities: opportunities }
    };
}

function avgOrNull(values) {
    var nums = (values || []).map(function(v) { return Number(v); }).filter(function(v) { return !isNaN(v); });
    if (!nums.length) return null;
    return nums.reduce(function(sum, v) { return sum + v; }, 0) / nums.length;
}

function safeJsonParse(value, fallback) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (err) { return fallback; }
}

function inferGoogleBrandIntent(item) {
    var text = [
        item && item.campaign_name,
        item && item.adset_name,
        item && item.adgroup_name
    ].join(' ').toLowerCase();
    if (/\bbrand\b/.test(text)) return 'brand';
    if (/\bnon[\s-]?brand\b/.test(text) || /\bgeneric\b/.test(text) || /\bcompetitor\b/.test(text)) return 'non_brand';
    return 'unknown';
}

function buildGoogleSearchOperatorAudit(item) {
    var settings = item && item.settings ? item.settings : {};
    var keywords = settings.keywords || [];
    var searchTerms = settings.searchTerms || [];
    var audit = { summary: [], actions: [], positives: [] };
    if (item.campType !== 'Search') return audit;
    var brandIntent = inferGoogleBrandIntent(item);

    if (keywords.length) {
        var avgQs = avgOrNull(keywords.map(function(k) { return k.quality_score; }));
        var avgLostRank = avgOrNull(keywords.map(function(k) { return k.search_rank_lost_impression_share; }));
        var avgLostBudget = avgOrNull(keywords.map(function(k) { return k.search_budget_lost_impression_share; }));
        var broadKeywords = keywords.filter(function(k) { return /BROAD/i.test(String(k.match_type || '')); });
        if (avgQs != null && avgQs < 5) {
            audit.summary.push('low keyword quality score');
            audit.actions.push('1) Improve RSA relevance and landing page fit. 2) Recluster the keywords by intent inside the ad group. 3) Re-read the quality score after one mature window.');
        } else if (avgQs != null && avgQs >= 7) {
            audit.positives.push('keyword quality score is healthy');
        }
        if (avgLostRank != null && avgLostRank > 0.35) {
            audit.summary.push('rank loss is high');
            audit.actions.push('1) Tighten ad relevance first. 2) Review the bid strategy or bid cap that is throttling rank. 3) Add budget only after the rank-loss pressure eases.');
        }
        if (avgLostBudget != null && avgLostBudget > 0.25) {
            audit.summary.push('budget loss is high');
            audit.actions.push('1) Increase budget only on benchmark-positive search groups. 2) Keep the strongest search group as the control. 3) Do not scale the weaker query themes at the same time.');
        }
        if (broadKeywords.length >= Math.max(2, Math.round(keywords.length * 0.4))) {
            audit.summary.push('broad match exposure is high');
            audit.actions.push('1) Review match-type discipline. 2) Isolate high-intent exact or phrase terms before broad scaling. 3) Add negatives for the broad terms that keep wasting spend.');
        }
    }

    if (searchTerms.length) {
        var termSpend = searchTerms.reduce(function(sum, row) { return sum + (Number(row.spend) || 0); }, 0);
        var termConv = searchTerms.reduce(function(sum, row) { return sum + (Number(row.conversions) || 0); }, 0);
        var lowCtrTerms = searchTerms.filter(function(row) { return (Number(row.impressions) || 0) > 1000 && (Number(row.ctr) || 0) < 1; });
        if (termSpend > 15000 && termConv === 0) {
            audit.summary.push('search term spend is not converting');
            audit.actions.push('1) Review negatives and query-intent drift. 2) Keep only the cleanest search terms active. 3) Do not scale until one mature week confirms the waste is removed.');
        } else if (termConv > 0) {
            audit.positives.push('search terms have confirmed conversion signal');
        }
        var zeroConvTerms = searchTerms.filter(function(row) { return (Number(row.spend) || 0) > 3000 && (Number(row.conversions) || 0) === 0; });
        if (zeroConvTerms.length >= 3) {
            audit.summary.push('multiple wasteful terms are consuming budget');
            audit.actions.push('1) Add negatives from the repeated non-converting search terms. 2) Tighten match types. 3) Recheck after the next mature read before adding more budget.');
        }
        if (lowCtrTerms.length >= 3) {
            audit.summary.push('several search terms are attracting low-intent clicks');
            audit.actions.push('1) Tighten ad copy to query intent. 2) Cut the weak query themes. 3) Keep the best query cluster live as the control before increasing budget.');
        }
        if (brandIntent === 'brand') {
            var brandWaste = zeroConvTerms.filter(function(row) { return (Number(row.spend) || 0) > 2000; });
            if (brandWaste.length) {
                audit.summary.push('brand demand is not converting efficiently');
                audit.actions.push('1) Defend brand coverage. 2) Audit the landing page and conversion path. 3) Only then scale brand spend.');
            } else {
                audit.positives.push('brand demand appears protected');
            }
        } else if (brandIntent === 'non_brand' && termSpend > 20000 && termConv > 0) {
            audit.positives.push('non-brand search has confirmed intent signal');
        }
    }

    if (brandIntent === 'brand') audit.summary.push('brand search structure detected');
    else if (brandIntent === 'non_brand') audit.summary.push('non-brand search structure detected');

    return audit;
}

function buildGoogleAdAudit(ad) {
    var audit = { summary: [], actions: [], positives: [] };
    if (!ad) return audit;
    var gcps = Number(ad.gcps_score) || null;
    var adCtr = Number(ad.ad_ctr);
    var adCpa = Number(ad.ad_cpa);
    var label = String(ad.asset_performance_label || '').toUpperCase();
    if (label === 'LOW') {
        audit.summary.push('asset label is low');
        audit.actions.push('1) Refresh or replace this asset. 2) Keep the strongest asset as the control. 3) Do not add more budget until the new asset is tested.');
    } else if (label === 'BEST' || label === 'GOOD') {
        audit.positives.push('asset label is healthy');
    }
    if (gcps != null && gcps < 0.35) {
        audit.summary.push('creative score is weak');
        audit.actions.push('1) Replace with a stronger Google creative angle. 2) Refresh the RSA asset mix. 3) Keep the best existing asset as the benchmark.');
    } else if (gcps != null && gcps >= 0.65) {
        audit.positives.push('creative score is strong');
    }
    if (adCtr && adCtr < 1) {
        audit.summary.push('CTR is weak');
        audit.actions.push('1) Refresh the headlines and descriptions. 2) Rewrite the asset framing to match query intent. 3) Keep one control asset live while comparing the new version.');
    }
    if (adCpa && adCpa > 0) {
        audit.summary.push('CPA ' + fmtINR(adCpa));
    }
    return audit;
}

function buildGoogleSettingsAudit(item) {
    var settings = item && item.settings ? item.settings : {};
    var campaign = settings.campaign || {};
    var adgroup = settings.adgroup || {};
    var breakdowns = settings.breakdowns || [];
    var assetGroups = settings.assetGroups || [];
    var audit = { summary: [], actions: [], positives: [] };

    if (campaign.bidding_strategy) {
        audit.summary.push('bidding: ' + campaign.bidding_strategy);
    }
    if (campaign.target_roas != null) {
        audit.summary.push('target ROAS: ' + fmtPct(Number(campaign.target_roas) * 100));
    }
    if (campaign.budget_amount != null) {
        audit.summary.push('budget: ' + fmtINR(campaign.budget_amount));
    }
    if (adgroup.target_cpa != null) {
        audit.summary.push('target CPA: ' + fmtINR(adgroup.target_cpa));
    }

    var geoTargets = safeJsonParse(campaign.geo_targeting_json, []);
    var langTargets = safeJsonParse(campaign.language_targeting_json, []);
    var networkSettings = safeJsonParse(campaign.network_settings_json, {});
    if (geoTargets && geoTargets.length) audit.summary.push('geo targets: ' + geoTargets.length);
    if (langTargets && langTargets.length) audit.summary.push('languages: ' + langTargets.length);
    if (networkSettings && Object.keys(networkSettings).length) audit.summary.push('network settings available');

    if (breakdowns.length) {
        var deviceRows = breakdowns.filter(function(row) { return row.breakdown_type === 'device'; });
        var networkRows = breakdowns.filter(function(row) { return row.breakdown_type === 'network'; });
        var topWasteDevice = deviceRows.sort(function(a, b) { return (Number(b.spend) || 0) - (Number(a.spend) || 0); })[0];
        var topWasteNetwork = networkRows.sort(function(a, b) { return (Number(b.spend) || 0) - (Number(a.spend) || 0); })[0];
        if (topWasteDevice && (Number(topWasteDevice.spend) || 0) > 10000) {
            audit.summary.push('top device: ' + topWasteDevice.breakdown_value);
        }
        if (topWasteNetwork && (Number(topWasteNetwork.spend) || 0) > 10000) {
            audit.summary.push('top network: ' + topWasteNetwork.breakdown_value);
        }
    }

    if (item && item.campType === 'PMax') {
        audit.summary.push('asset groups: ' + assetGroups.length);
        if (!assetGroups.length) {
            audit.actions.push('1) Pull PMax asset-group coverage first. 2) Keep the current budget flat until the coverage is visible. 3) Do not make broad budget changes yet.');
        } else {
            var weakAssetGroups = assetGroups.filter(function(row) {
                return String(row.primary_status || '').toUpperCase().indexOf('LIMITED') !== -1 ||
                    String(row.strength || '').toUpperCase().indexOf('POOR') !== -1;
            });
            if (weakAssetGroups.length) {
                audit.summary.push('some asset groups are limited or weak');
                audit.actions.push('1) Improve PMax asset-group coverage and strength. 2) Keep the stronger asset group live as the control. 3) Scale only after the weak group is rebuilt.');
            } else {
                audit.positives.push('PMax asset-group coverage is available');
            }
        }
    }

    return audit;
}

function buildGoogleImportedAuditSummary(scan) {
    var adgroups = scan && scan.adsets ? scan.adsets : [];
    var campaigns = scan && scan.tree ? Object.keys(scan.tree).map(function(name) { return scan.tree[name]; }) : [];
    var searchPressureCount = 0;
    var benchmarkPositive = 0;
    var benchmarkNegative = 0;
    var estimatedWastedSpend = 0;
    var geoSpend = {};
    var deviceSpend = {};
    var topCampaignSpendSharePct = 0;

    if (campaigns.length) {
        var spends = campaigns.map(function(campaign) {
            return deriveMetrics(campaign.totals || emptyRaw()).spend || 0;
        }).sort(function(a, b) { return b - a; });
        var totalSpend = spends.reduce(function(sum, value) { return sum + value; }, 0);
        if (totalSpend > 0 && spends.length) topCampaignSpendSharePct = (spends[0] / totalSpend) * 100;
    }

    adgroups.forEach(function(item) {
        var spend = Number(item.evalSpend || item.spend || 0);
        var action = String(item.recommendation && item.recommendation.action || '').toUpperCase();
        if (action === 'SCALE' || action === 'MAINTAIN') benchmarkPositive++;
        if (action === 'PAUSE' || action === 'REDUCE BUDGET') {
            benchmarkNegative++;
            estimatedWastedSpend += spend;
        }
        if (item.searchAudit && item.searchAudit.summary && item.searchAudit.summary.length) searchPressureCount++;
        var breakdowns = item.settings && item.settings.breakdowns ? item.settings.breakdowns : [];
        breakdowns.forEach(function(row) {
            var type = String(row.breakdown_type || '');
            var value = String(row.breakdown_value || '--');
            var rowSpend = Number(row.spend || 0);
            if (type === 'geo') geoSpend[value] = (geoSpend[value] || 0) + rowSpend;
            if (type === 'device') deviceSpend[value] = (deviceSpend[value] || 0) + rowSpend;
        });
    });

    function topPocket(map) {
        var best = null;
        Object.keys(map || {}).forEach(function(key) {
            if (!best || map[key] > best.value) best = { key: key, value: map[key] };
        });
        return best;
    }

    return {
        search_pressure_count: searchPressureCount,
        benchmark_positive_count: benchmarkPositive,
        benchmark_negative_count: benchmarkNegative,
        estimated_wasted_spend: estimatedWastedSpend,
        top_campaign_spend_share_pct: topCampaignSpendSharePct,
        top_geo_spend_pocket: topPocket(geoSpend),
        top_device_spend_pocket: topPocket(deviceSpend),
        pacing_risk: topCampaignSpendSharePct >= 45 ? 'high concentration' : (topCampaignSpendSharePct >= 30 ? 'moderate concentration' : 'distributed')
    };
}

function buildGoogleCampaignSettingsAudits(scan) {
    return Object.keys(scan && scan.tree || {}).map(function(name) {
        var campaign = scan.tree[name] || {};
        var totals = deriveMetrics(campaign.totals || emptyRaw());
        var settings = campaign.settings && campaign.settings.campaign ? campaign.settings.campaign : {};
        var adsets = Object.values(campaign.adsets || {});
        var searchPressure = adsets.filter(function(a) { return a.searchAudit && a.searchAudit.actions && a.searchAudit.actions.length; });
        var settingsPressure = adsets.filter(function(a) { return a.settingsAudit && a.settingsAudit.actions && a.settingsAudit.actions.length; });
        var benchmarkNegative = adsets.filter(function(a) {
            var action = String(a.recommendation && a.recommendation.action || '');
            return /PAUSE|REDUCE BUDGET|OPTIMIZE/.test(action);
        });
        var action = 'NO CHANGE NEEDED';
        var classification = 'Stable';
        var reason = 'Campaign is not showing a concentrated deterministic issue.';
        if ((totals.spend || 0) >= 50000 && benchmarkNegative.length >= Math.max(1, Math.round(adsets.length * 0.6))) {
            action = 'REDUCE CAMPAIGN BUDGET';
            classification = 'Needs Attention';
            reason = 'Most ad groups inside this campaign are below benchmark or need structural fixes.';
        } else if (searchPressure.length >= Math.max(1, Math.round(adsets.length * 0.5))) {
            action = 'SEARCH / STRUCTURE CLEANUP';
            classification = 'Needs Attention';
            reason = 'Search-term, match-type, or query-quality pressure is concentrated across the campaign.';
        } else if (settingsPressure.length >= Math.max(1, Math.round(adsets.length * 0.5))) {
            action = 'SETTINGS FIX';
            classification = 'Needs Attention';
            reason = 'Campaign/ad-group settings show repeated deterministic pressure.';
        } else if ((totals.d6ROAS || 0) >= 28 && benchmarkNegative.length === 0 && (totals.spend || 0) >= 40000) {
            action = 'SCALE CAREFULLY';
            classification = 'Healthy';
            reason = 'Campaign is benchmark-positive with no major deterministic leak.';
        }
        return {
            campaign_name: name,
            classification: classification,
            action: action,
            reason: reason,
            do_line: action === 'REDUCE CAMPAIGN BUDGET' ? [
                '1) Trim campaign budget by 15-20%.',
                '2) Keep the strongest ad group or asset group as the control.',
                '3) Fix the weakest ad-group pockets before any second budget move.'
            ].join(' ') :
                action === 'SEARCH / STRUCTURE CLEANUP' ? [
                    '1) Pull the search-term report and split the wasteful query themes.',
                    '2) Add negatives and tighten match types so the same waste does not repeat.',
                    '3) Rebuild the weak asset groups or ad groups only after the cleanup is clear.'
                ].join(' ') :
                action === 'SETTINGS FIX' ? [
                    '1) Review bid strategy, target settings, and network or geo configuration.',
                    '2) Isolate whether a setting is throttling delivery or conversion quality.',
                    '3) Keep the best campaign pocket stable until the next mature read.'
                ].join(' ') :
                action === 'SCALE CAREFULLY' ? [
                    '1) Increase campaign budget in small steps.',
                    '2) Protect the strongest ad groups and asset groups from unnecessary edits.',
                    '3) Recheck WoW stability before the next increase.'
                ].join(' ') :
                '1) No immediate campaign-level change needed. 2) Keep the strongest pocket as the control. 3) Revisit only if the WoW or settings signal changes.',
            notes: []
                .concat(settings.bidding_strategy ? ['Bidding: ' + settings.bidding_strategy] : [])
                .concat(settings.target_roas != null ? ['Target ROAS ' + fmtPct(Number(settings.target_roas) * 100)] : [])
                .concat(settings.budget_amount != null ? ['Budget ' + fmtINR(settings.budget_amount)] : [])
        };
    });
}

function buildGoogleAdgroupSettingsAudits(scan) {
    return (scan && scan.adsets || []).map(function(a) {
        var searchAudit = a.searchAudit || { summary: [], actions: [], positives: [] };
        var settingsAudit = a.settingsAudit || { summary: [], actions: [], positives: [] };
        var wow = a._wow || null;
        var action = 'HOLD';
        var reason = 'No deterministic structural issue is strong enough to override current pacing.';
        if (searchAudit.actions && searchAudit.actions.length) {
            action = 'SEARCH TERM / MATCH-TYPE CLEANUP';
            reason = searchAudit.actions[0];
        } else if (settingsAudit.actions && settingsAudit.actions.length) {
            action = 'SETTINGS FIX';
            reason = settingsAudit.actions[0];
        } else if (wow && wow.continuousDecline) {
            action = 'CREATIVE / STRUCTURE REVIEW';
            reason = 'Continuous week-on-week decline suggests structural or creative pressure even without a single obvious settings bug.';
        } else if (a.recommendation && a.recommendation.action === 'SCALE') {
            action = 'PROTECT AND SCALE';
            reason = 'This ad group is one of the stronger pockets and should be scaled carefully without unnecessary edits.';
        }
        return {
            campaign_name: a.campaign_name || '',
            adset_name: a.adset_name || a.adgroup_name || '',
            action: action,
            reason: reason,
            do_line: a.recommendation && a.recommendation.do_line ? a.recommendation.do_line : (
                action === 'SEARCH TERM / MATCH-TYPE CLEANUP' ? [
                    '1) Pull the search-term report.',
                    '2) Add negatives and split the weak query themes.',
                    '3) Tighten match types or ad-group structure, then re-read after one mature window.'
                ].join(' ') :
                action === 'SETTINGS FIX' ? [
                    '1) Review bid strategy and optimization event settings.',
                    '2) Remove the specific throttle before changing budget.',
                    '3) Keep the best ad group as the control while the new setting settles.'
                ].join(' ') :
                action === 'CREATIVE / STRUCTURE REVIEW' ? [
                    '1) Refresh RSA or asset-group angles.',
                    '2) Keep one control ad live so the comparison stays clean.',
                    '3) Compare WoW after the next mature read before scaling.'
                ].join(' ') :
                action === 'PROTECT AND SCALE' ? [
                    '1) Scale only through campaign budget.',
                    '2) Leave this ad group unchanged as the winner.',
                    '3) Monitor search terms and WoW weekly before a second increase.'
                ].join(' ') :
                buildGoogleRecommendedDoLine(a, a.recommendation && a.recommendation.action)
            ),
            notes: []
                .concat(searchAudit.summary || [])
                .concat(settingsAudit.summary || [])
                .slice(0, 4),
            positives: []
                .concat(searchAudit.positives || [])
                .concat(settingsAudit.positives || [])
                .slice(0, 3)
        };
    });
}

function buildGoogleAdHealthAudits(scan) {
    var grouped = {};
    var assetPlaybook = buildGoogleAppAssetPlaybook(scan || {});
    (scan && scan.ads || []).forEach(function(ad) {
        var key = normalizeGoogleJoinText(ad.campaign_name) + '|||' + normalizeGoogleJoinText(ad.adgroup_name || '');
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(ad);
    });
    return Object.keys(grouped).map(function(key) {
        var ads = grouped[key].slice().sort(function(a, b) { return (b.ad_spend || 0) - (a.ad_spend || 0); });
        var lead = ads[0] || {};
        var audit = lead.adAudit || { summary: [], actions: [], positives: [] };
        var assetKey = normalizeGoogleJoinText(lead.campaign_name || '') + '|||' + normalizeGoogleJoinText(lead.adgroup_name || '');
        var assetGroup = assetPlaybook.group_index ? assetPlaybook.group_index[assetKey] : null;
        var content = lead.content || {};
        var textBits = [];
        function pushText(value) {
            if (!value) return;
            if (Array.isArray(value)) {
                value.forEach(pushText);
                return;
            }
            if (typeof value === 'object') {
                pushText(value.text != null ? value.text : value.value != null ? value.value : value.asset_text != null ? value.asset_text : value.title);
                return;
            }
            var text = String(value || '').trim();
            if (text) textBits.push(text);
        }
        pushText(content.headlines);
        pushText(content.headline);
        pushText(content.descriptions);
        pushText(content.description);
        pushText(content.primary_text);
        pushText(content.primaryText);
        pushText(content.call_to_action);
        pushText(content.callToAction);
        return {
            campaign_name: lead.campaign_name || '',
            adset_name: lead.adgroup_name || '',
            dominant_ad_id: lead.ad_id || '',
            action: assetGroup && assetGroup.asset_signal ? assetGroup.asset_signal : (audit.actions && audit.actions.length ? 'CREATIVE_REFRESH' : 'HOLD'),
            reason: assetGroup && assetGroup.why ? assetGroup.why : (audit.actions && audit.actions.length ? audit.actions[0] : 'No deterministic ad-level creative issue is dominant.'),
            do_line: assetGroup && assetGroup.next_step ? assetGroup.next_step : (audit.actions && audit.actions.length ? audit.actions[0] : 'Protect the current strongest asset until a clear weakness appears.'),
            notes: audit.summary || [],
            positives: audit.positives || [],
            creative_summary: textBits.slice(0, 3).join(' | '),
            asset_signal: assetGroup ? assetGroup.asset_signal : '',
            asset_next_step: assetGroup ? assetGroup.next_step : '',
            asset_why: assetGroup ? assetGroup.why : ''
        };
    });
}

function buildGoogleAppAssetPlaybook(scan) {
    var report = scan && scan.app_asset_performance ? scan.app_asset_performance : {};
    var typeRows = Array.isArray(report.type_rows) ? report.type_rows.slice() : [];
    var groupRows = Array.isArray(report.group_rows) ? report.group_rows.slice() : [];
    var groupIndex = {};
    groupRows.forEach(function(row) {
        var key = normalizeGoogleJoinText(row.campaign_name || '') + '|||' + normalizeGoogleJoinText(row.adgroup_name || '');
        groupIndex[key] = Object.assign({}, row, {
            asset_signal: row.asset_signal || row.asset_signal_text || row.asset_signal_label || (row.winning_asset_type ? 'REUSE / SWAP' : ''),
            why: row.why || '',
            next_step: row.next_step || ''
        });
    });
    return {
        total_rows: Number(report.total_rows || 0),
        nonzero_rows: Number(report.nonzero_rows || 0),
        source_range: report.source_range || '',
        source_path: report.source_path || '',
        type_rows: typeRows,
        top_type_rows: Array.isArray(report.top_type_rows) ? report.top_type_rows.slice() : typeRows.slice(0, 5),
        weak_type_rows: Array.isArray(report.weak_type_rows) ? report.weak_type_rows.slice() : typeRows.slice(-5).reverse(),
        group_rows: groupRows,
        top_groups: Array.isArray(report.top_groups) ? report.top_groups.slice() : groupRows.slice(0, 10),
        weak_groups: Array.isArray(report.weak_groups) ? report.weak_groups.slice() : groupRows.slice(-10).reverse(),
        group_index: groupIndex
    };
}

function medianGoogleNumber(values) {
    var nums = (values || []).map(function(v) { return Number(v); }).filter(function(v) { return !isNaN(v); }).sort(function(a, b) { return a - b; });
    if (!nums.length) return null;
    var mid = Math.floor(nums.length / 2);
    return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function flattenGoogleCreativeText(value, out) {
    if (!value) return;
    if (Array.isArray(value)) {
        value.forEach(function(item) { flattenGoogleCreativeText(item, out); });
        return;
    }
    if (typeof value === 'object') {
        flattenGoogleCreativeText(value.text != null ? value.text : value.value != null ? value.value : value.asset_text != null ? value.asset_text : value.title, out);
        return;
    }
    var text = String(value || '').trim();
    if (text) out.push(text);
}

function buildGoogleDailyAdAnalysis(scan) {
    var rows = (scan && scan.ad_daily) || [];
    var creatives = {};
    var assetPlaybook = buildGoogleAppAssetPlaybook(scan || {});
    (scan && scan.ads || []).forEach(function(ad) {
        creatives[String(ad.ad_id || '')] = ad;
    });
    if (!rows.length) {
        return { summary: 'No ad-daily rows available yet.', winners: [], losers: [], reuse: [], rollup: [], top_texts: [] };
    }

    var maxDate = rows.reduce(function(best, row) {
        var d = String(row.date || '').substring(0, 10);
        return !best || compareIso(d, best) > 0 ? d : best;
    }, '');
    var currentStart = addDaysIso(maxDate || new Date().toISOString().slice(0, 10), -6);
    var previousStart = addDaysIso(currentStart, -7);
    var currentEnd = maxDate || new Date().toISOString().slice(0, 10);
    var previousEnd = addDaysIso(currentStart, -1);

    var grouped = {};
    rows.forEach(function(row) {
        var adId = String(row.ad_id || '');
        if (!adId) return;
        if (!grouped[adId]) grouped[adId] = { current: emptyRaw(), previous: emptyRaw(), rows: [] };
        grouped[adId].rows.push(row);
        var d = String(row.date || '').substring(0, 10);
        var bucket = compareIso(d, currentStart) >= 0 && compareIso(d, currentEnd) <= 0 ? 'current' : (compareIso(d, previousStart) >= 0 && compareIso(d, previousEnd) <= 0 ? 'previous' : null);
        if (!bucket) return;
        var target = grouped[adId][bucket];
        target.spend += ((Number(row.cost_micros) || 0) / 1000000) * 1.18;
        target.impressions += Number(row.impressions) || 0;
        target.clicks += Number(row.clicks) || 0;
        target.installs += Number(row.conversions) || 0;
        target.conversions += Number(row.conversions) || 0;
        target.overall_revenue += Number(row.conversion_value) || 0;
    });

    var currentRows = [];
    Object.keys(grouped).forEach(function(adId) {
        var bucket = grouped[adId];
        var current = deriveMetrics(bucket.current);
        var previous = deriveMetrics(bucket.previous);
        var creative = creatives[adId] || {};
        var assetGroup = assetPlaybook.group_index ? assetPlaybook.group_index[normalizeGoogleJoinText(bucket.rows[0].campaign_name || '') + '|||' + normalizeGoogleJoinText(bucket.rows[0].adgroup_name || '')] : null;
        var content = safeJsonParse(creative.creative_content_json, creative.content || {});
        var textBits = [];
        flattenGoogleCreativeText(content.headlines, textBits);
        flattenGoogleCreativeText(content.headline, textBits);
        flattenGoogleCreativeText(content.descriptions, textBits);
        flattenGoogleCreativeText(content.description, textBits);
        flattenGoogleCreativeText(content.primary_text, textBits);
        flattenGoogleCreativeText(content.primaryText, textBits);
        flattenGoogleCreativeText(content.call_to_action, textBits);
        flattenGoogleCreativeText(content.callToAction, textBits);
        var label = String(creative.asset_performance_label || bucket.rows[0].asset_performance_label || '').toUpperCase();
        var ctrMedian = medianGoogleNumber(rows.map(function(r) { return ((Number(r.clicks) || 0) / Math.max(1, Number(r.impressions) || 0)) * 100; }));
        var cpcMedian = medianGoogleNumber(rows.map(function(r) { var clicks = Number(r.clicks) || 0; return clicks > 0 ? ((Number(r.cost_micros) || 0) / 1000000) / clicks : null; }));
        var cpaMedian = medianGoogleNumber(rows.map(function(r) { var conv = Number(r.conversions) || 0; return conv > 0 ? (((Number(r.cost_micros) || 0) / 1000000) * 1.18) / conv : null; }));
        var conversionRateMedian = medianGoogleNumber(rows.map(function(r) { var clicks = Number(r.clicks) || 0; return clicks > 0 ? ((Number(r.conversions) || 0) / clicks) * 100 : null; }));
        var score = 0;
        var sourceContext = [];
        if (current.ctr != null) {
            if (ctrMedian != null && current.ctr >= ctrMedian * 1.15) score += 2; else if (ctrMedian != null && current.ctr <= ctrMedian * 0.8) score -= 2;
            else if (current.ctr >= 1.2) score += 1;
            sourceContext.push('CTR/CPC/CPA');
        }
        if (current.cpc != null) {
            if (cpcMedian != null && current.cpc <= cpcMedian * 0.85) score += 1; else if (cpcMedian != null && current.cpc >= cpcMedian * 1.2) score -= 1;
            sourceContext.push('account benchmark');
        }
        if (current.cpa != null) {
            if (cpaMedian != null && current.cpa <= cpaMedian * 0.85) score += 2; else if (cpaMedian != null && current.cpa >= cpaMedian * 1.2) score -= 2;
        }
        if (current.conversions > 0) score += 2;
        else if (current.spend >= 5000 && current.clicks >= 30) score -= 2;
        if (previous.clicks > 0 && current.ctr > 0 && current.ctr > previous.ctr) score += 1;
        if (previous.cpa > 0 && current.cpa > 0 && current.cpa < previous.cpa) score += 1;
        if (previous.cpa > 0 && current.cpa > 0 && current.cpa > previous.cpa * 1.2) score -= 1;
        if (String(label) === 'BEST') score += 3;
        else if (String(label) === 'GOOD') score += 2;
        else if (String(label) === 'LEARNING') score += 0;
        else if (String(label) === 'LOW') score -= 3;
        if (Number(creative.gcps_score) >= 0.65) score += 2;
        else if (Number(creative.gcps_score) >= 0.35) score += 1;
        else if (Number(creative.gcps_score) > 0) score -= 1;
        if (textBits.length) score += 1;

        var action = 'KEEP CONTROL';
        var reason = 'Keep this as the control ad.';
        var fixLine = 'Protect the current text and use it as the benchmark.';
        if (current.conversions === 0 && current.spend >= 5000 && (ctrMedian == null || current.ctr <= ctrMedian) && (current.cpa == null || cpaMedian == null || current.cpa >= cpaMedian)) {
            action = 'PAUSE';
            reason = 'No useful conversion signal and weak efficiency versus the current daily set.';
            fixLine = 'Pause this ad and keep the stronger sibling as the control.';
            score -= 2;
        } else if (score >= 5 && textBits.length) {
            action = 'REUSE ELSEWHERE';
            reason = 'This ad is winning on Google-native signals and its hook can be copied into other pockets.';
            fixLine = textBits.slice(0, 2).join(' | ') || 'Reuse the winning hook in other ad groups.';
        } else if (score >= 2) {
            action = 'IMPROVE';
            reason = 'This ad is close, but it needs a cleaner hook, headline, or offer frame.';
            fixLine = 'Rewrite the first headline and description while keeping the strongest asset live.';
        } else if (current.conversions > 0 && current.cpa != null && cpaMedian != null && current.cpa <= cpaMedian) {
            action = 'KEEP CONTROL';
            reason = 'This ad is holding the control position on cost and conversion quality.';
            fixLine = 'Keep this live as the benchmark.';
        }
        if (assetGroup && assetGroup.next_step && (action === 'REUSE ELSEWHERE' || action === 'IMPROVE' || action === 'KEEP CONTROL')) {
            fixLine = assetGroup.next_step;
        }
        if (assetGroup && assetGroup.why) {
            reason = reason + ' | ' + assetGroup.why;
        }

        currentRows.push({
            ad_id: adId,
            ad_status: String(bucket.rows[0].ad_status || bucket.rows[0].status || '').toLowerCase(),
            campaign_name: creative.campaign_name || bucket.rows[0].campaign_name || '',
            adgroup_name: creative.adgroup_name || bucket.rows[0].adgroup_name || '',
            ad_type: creative.ad_type || bucket.rows[0].ad_type || '',
            asset_performance_label: label || bucket.rows[0].asset_performance_label || '',
            score: score,
            action: action,
            reason: reason,
            fix_line: fixLine,
            asset_signal: assetGroup ? assetGroup.asset_signal : '',
            asset_next_step: assetGroup ? assetGroup.next_step : '',
            asset_why: assetGroup ? assetGroup.why : '',
            source_context: ['trend', 'creative text', 'asset label', 'CTR/CPC/CPA', 'account benchmark', 'sibling comparison'],
            creative_text: textBits.slice(0, 3).join(' | '),
            metrics: current,
            previous_metrics: previous,
            spend: current.spend,
            current_period: currentStart + ' → ' + currentEnd,
            previous_period: previousStart + ' → ' + previousEnd
        });
    });

    currentRows.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
    var winners = currentRows.filter(function(r) { return /REUSE ELSEWHERE|KEEP CONTROL/.test(r.action); }).slice(0, 4);
    var losers = currentRows.filter(function(r) { return r.action === 'PAUSE' || r.action === 'IMPROVE'; }).sort(function(a, b) { return (a.score || 0) - (b.score || 0); }).slice(0, 4);
    var reuse = currentRows.filter(function(r) { return r.action === 'REUSE ELSEWHERE'; }).slice(0, 4);
    var topTexts = reuse.map(function(r) {
        return {
            label: r.campaign_name + ' → ' + r.adgroup_name,
            text: r.creative_text || r.fix_line,
            reason: r.reason
        };
    });
    var campaignRollup = {};
    currentRows.forEach(function(r) {
        var camp = r.campaign_name || '--';
        if (!campaignRollup[camp]) campaignRollup[camp] = { campaign_name: camp, weak: 0, improve: 0, reuse: 0, control: 0, total: 0 };
        campaignRollup[camp].total++;
        if (r.action === 'PAUSE') campaignRollup[camp].weak++;
        else if (r.action === 'IMPROVE') campaignRollup[camp].improve++;
        else if (r.action === 'REUSE ELSEWHERE') campaignRollup[camp].reuse++;
        else campaignRollup[camp].control++;
    });
    return {
        summary: currentRows.length ? (winners.length ? 'Top ad winners and reusable hooks are sorted by daily ad performance.' : 'Daily ad analysis is available.') : 'No ad-daily rows available yet.',
        rows: currentRows,
        winners: winners,
        losers: losers,
        reuse: reuse,
        rollup: Object.values(campaignRollup).sort(function(a, b) { return (b.weak + b.improve) - (a.weak + a.improve); }),
        top_texts: topTexts
    };
}

function renderGoogleDailyAdAnalysisSection(scan) {
    var analysis = buildGoogleDailyAdAnalysis(scan || {});
    if (!scan || !scan.ad_daily || !scan.ad_daily.length) {
        return '<div style="' + CARD + 'margin:16px 0;border-left:3px solid var(--text-dim);"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px;">Daily Ad Analysis</div><div style="font-size:11px;color:var(--text-dim);">No ad-daily rows available yet. Refresh the scan after the Google daily table is populated.</div></div>';
    }
    function renderRow(row) {
        if (!row) return '';
        var color = row.action === 'PAUSE' ? 'var(--red)' : (row.action === 'IMPROVE' ? 'var(--orange)' : (row.action === 'REUSE ELSEWHERE' ? 'var(--green)' : 'var(--accent)'));
        return '<div style="' + CARD + 'margin-bottom:8px;border-left:3px solid ' + color + ';">' +
            '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px;">' +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;color:#fff;background:' + color + ';">' + esc(row.action) + '</span>' +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:9px;font-weight:600;border:1px solid var(--border);color:var(--text-dim);">Score ' + esc(String(row.score || 0)) + '</span>' +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:9px;font-weight:600;border:1px solid var(--border);color:var(--text-dim);">' + esc(row.asset_performance_label || '--') + '</span>' +
                    '</div>' +
                    '<div style="font-size:12px;font-weight:700;color:var(--text);line-height:1.4;">' + esc((row.campaign_name || '--') + ' → ' + (row.adgroup_name || '--') + ' → ' + (row.ad_id || '--')) + '</div>' +
                    '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;line-height:1.5;">' +
                        'CTR ' + esc(fmtPct(row.metrics && row.metrics.ctr || 0)) + ' | CPC ' + esc(fmtINR(row.metrics && row.metrics.cpc || 0)) + ' | CPA ' + esc(fmtINR(row.metrics && row.metrics.cpa || 0)) +
                        ' | Conv ' + esc(fmtNum(row.metrics && row.metrics.conversions || 0)) + ' | Spend ' + esc(fmtINR(row.metrics && row.metrics.spend || 0)) +
                    '</div>' +
                    (row.creative_text ? '<div style="font-size:10px;color:var(--text-dim);margin-top:6px;line-height:1.5;">Text: ' + esc(row.creative_text) + '</div>' : '') +
                    '<div style="font-size:11px;color:var(--text);margin-top:6px;line-height:1.5;">Why: ' + esc(row.reason || '--') + '</div>' +
                    '<div style="font-size:10px;color:var(--green);margin-top:6px;line-height:1.5;">Next step: ' + esc(row.fix_line || '--') + '</div>' +
                    (row.asset_signal ? '<div style="font-size:10px;color:var(--accent);margin-top:6px;line-height:1.5;">Asset signal: ' + esc(row.asset_signal) + '</div>' : '') +
                    '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px;">' + (row.source_context || []).slice(0, 6).map(function(tag) {
                        return '<span style="padding:2px 6px;border-radius:999px;font-size:9px;font-weight:600;border:1px solid rgba(99,102,241,0.25);color:var(--accent);background:rgba(99,102,241,0.08);">' + esc(tag) + '</span>';
                    }).join('') + '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    return '<div style="' + CS + 'margin-top:12px;">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Daily Ad Analysis</h3>' +
        '<div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">Ad-level guidance is advisory only. Campaign budget moves stay at campaign level.</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-bottom:12px;">' +
            '<div style="' + CARD + 'border-left:3px solid var(--green);"><div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Top Winners</div>' + (analysis.winners.length ? analysis.winners.map(renderRow).join('') : '<div style="font-size:11px;color:var(--text-dim);">No clear winners yet.</div>') + '</div>' +
            '<div style="' + CARD + 'border-left:3px solid var(--red);"><div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Pause / Replace</div>' + (analysis.losers.length ? analysis.losers.map(renderRow).join('') : '<div style="font-size:11px;color:var(--text-dim);">No clear weak ads yet.</div>') + '</div>' +
            '<div style="' + CARD + 'border-left:3px solid var(--accent);"><div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Copy This Elsewhere</div>' + (analysis.reuse.length ? analysis.reuse.map(renderRow).join('') : '<div style="font-size:11px;color:var(--text-dim);">No reusable hooks found yet.</div>') + '</div>' +
        '</div>' +
        '<div style="' + CARD + 'border-left:3px solid var(--accent);margin-bottom:10px;">' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Campaign Rollup</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;">' + analysis.rollup.slice(0, 6).map(function(camp) {
                return '<div style="' + CARD + 'margin:0;"><div style="font-size:12px;font-weight:700;color:var(--text);line-height:1.4;">' + esc(camp.campaign_name) + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Weak ' + esc(String(camp.weak || 0)) + ' | Improve ' + esc(String(camp.improve || 0)) + ' | Reuse ' + esc(String(camp.reuse || 0)) + ' | Control ' + esc(String(camp.control || 0)) + '</div>' + ((camp.weak + camp.improve >= 3) ? '<div style="font-size:10px;color:var(--orange);margin-top:4px;">Campaign review recommended</div>' : '') + '</div>';
            }).join('') + '</div>' +
        '</div>' +
    '</div>';
}

function buildGoogleBreakdownActionRecommendations(scan) {
    var recommendations = [];
    (scan && scan.adsets || []).forEach(function(a) {
        var breakdowns = a.settings && a.settings.breakdowns ? a.settings.breakdowns : [];
        var geoRows = breakdowns.filter(function(row) { return String(row.breakdown_type || '') === 'geo'; });
        var deviceRows = breakdowns.filter(function(row) { return String(row.breakdown_type || '') === 'device'; });
        if (geoRows.length >= 2) {
            var weakGeo = geoRows.slice().sort(function(x, y) { return (Number(y.spend) || 0) - (Number(x.spend) || 0); }).find(function(row) {
                return (Number(row.conversions) || 0) === 0 && (Number(row.spend) || 0) > 3000;
            });
            if (weakGeo) {
                recommendations.push({
                    title: (a.campaign_name || '--') + ' → ' + (a.adset_name || '--') + ' → Geo cleanup',
                    why: 'A spend-heavy geo pocket has no confirmed conversion signal.',
                    do: [
                        '1) Review geo targeting and reduce waste from ' + String(weakGeo.breakdown_value || '--') + '.',
                        '2) Keep the stronger geo pockets live as the control.',
                        '3) Re-open budget only after the geo leak stops.'
                    ].join(' ')
                });
            }
        }
        if (deviceRows.length >= 2) {
            var weakDevice = deviceRows.slice().sort(function(x, y) { return (Number(y.spend) || 0) - (Number(x.spend) || 0); }).find(function(row) {
                return (Number(row.conversions) || 0) === 0 && (Number(row.spend) || 0) > 3000;
            });
            if (weakDevice) {
                recommendations.push({
                    title: (a.campaign_name || '--') + ' → ' + (a.adset_name || '--') + ' → Device cleanup',
                    why: 'One device pocket is consuming spend without producing output.',
                    do: [
                        '1) Validate bid or delivery mix for ' + String(weakDevice.breakdown_value || '--') + '.',
                        '2) Keep the stronger device pocket as the control.',
                        '3) Re-test after a full week before broad campaign scaling.'
                    ].join(' ')
                });
            }
        }
    });
    return recommendations.slice(0, 8);
}

function buildGoogleAdvancedTrendIntelligence(scan) {
    var campaigns = {};
    var adsets = {};
    (scan && scan.adsets || []).forEach(function(a) {
        var wow = a._wow || null;
        if (!wow) return;
        adsets[normalizeGoogleJoinText(a.adset_name || a.adgroup_name || '')] = {
            trend: wow.trendDirection || 'stable',
            continuous_decline: !!wow.continuousDecline,
            continuous_increase: !!wow.continuousIncrease,
            signups_wow: wow.signups_wow,
            d6_revenue_wow: wow.d6Revenue_wow,
            d0_trial_cost_wow: wow.d0TrialCost_wow,
            learning_state: a.isMatured ? 'mature' : 'trial-heavy',
            trend_note: a.isMatured
                ? 'Use the previous week as a real performance read.'
                : 'Treat the previous week as a learning-window read; low ROAS can be normal while trials are still forming.',
            contradiction: (wow.d6Revenue_wow > 0 && wow.signupCost_wow > 0) ? 'ROAS/output improving while costs are worsening' : ''
        };
        if (!campaigns[a.campaign_name]) campaigns[a.campaign_name] = { declining: 0, improving: 0, contradictory: 0 };
        if (wow.continuousDecline) campaigns[a.campaign_name].declining++;
        if (wow.continuousIncrease) campaigns[a.campaign_name].improving++;
        if (wow.d6Revenue_wow > 0 && wow.signupCost_wow > 0) campaigns[a.campaign_name].contradictory++;
    });
    return { campaigns: campaigns, adsets: adsets };
}

function buildGoogleLearningGovernor(scan) {
    var early = (scan && scan.adsets || []).filter(function(a) { return !a.isMatured; });
    var totalSpend = (scan && scan.evaluatedTotals && scan.evaluatedTotals.spend) || 0;
    var earlySpend = early.reduce(function(sum, a) { return sum + (a.evalSpend || 0); }, 0);
    var trialLearningNote = earlySpend > 0
        ? 'This account still carries a trial-heavy learning window, so a weak previous-week ROAS can be normal while D0 trials are still forming. Read D0 trial cost, signups, D15/D30 ROAS, search terms, geo/device/network mix, and asset-group quality before making a hard cut.'
        : 'Read previous-week ROAS with the learning window in mind; do not treat one weak week as the full verdict.';
    return {
        learning_spend_share_pct: totalSpend > 0 ? Math.round((earlySpend / totalSpend) * 100) : 0,
        edit_policy: earlySpend > totalSpend * 0.3 ? 'conservative' : 'normal',
        trial_learning_note: trialLearningNote,
        trend_breadth_note: 'Always cover week-on-week trends, campaign hierarchy, search-term drift, geo/device/network mix, and asset-group quality before reducing the account to a budget-only story.'
    };
}

function buildGoogleHistoricalWinnerLibrary(scan) {
    return (scan && scan.adsets || []).filter(function(a) {
        return a && a.isMatured && (a.d6ROAS || 0) >= 28 && (a.evalSpend || 0) >= 15000;
    }).sort(function(a, b) {
        return (b.d6ROAS || 0) - (a.d6ROAS || 0);
    }).slice(0, 8).map(function(a) {
        return {
            campaign_name: a.campaign_name,
            adset_name: a.adset_name,
            camp_type: a.campType,
            d6_roas: a.d6ROAS,
            signup_cost: a.signupCost,
            notes: (a.searchAudit && a.searchAudit.positives || []).concat(a.settingsAudit && a.settingsAudit.positives || []).slice(0, 3)
        };
    });
}

function buildGoogleSignalAvailability(scan) {
    var coverage = scan && scan.settingsCoverage ? scan.settingsCoverage : {};
    var limitations = [];
    if (!(coverage.assetGroups > 0)) limitations.push('Asset-group metadata is thin or missing.');
    if (!(coverage.searchTerms > 0)) limitations.push('Search-term coverage is missing.');
    if (!(coverage.breakdowns > 0)) limitations.push('Breakdown coverage is thin.');
    return {
        creative_signals: { hook_hold_applicable: true, hook_hold_available: !!(scan && scan.ads && scan.ads.length) },
        settings_signals: {
            delivery_estimate_available: !!(coverage.breakdowns > 0),
            attribution_split_available: false
        },
        limitations: limitations
    };
}

function addDaysIso(iso, days) {
    var d = new Date(String(iso).substring(0, 10) + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

function compareIso(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

function normalizePrompt(text) {
    return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function parseGoogleOptimizerQuery(prompt) {
    var q = normalizePrompt(prompt);
    var metric = null;
    if (/(d0\s*trial cost|d0trial cost)/.test(q)) metric = 'd0TrialCost';
    else if (/(signup cost|sign up cost|su cost)/.test(q)) metric = 'signupCost';
    else if (/(d6 roas)/.test(q)) metric = 'd6ROAS';
    else if (/(d15 roas)/.test(q)) metric = 'd15ROAS';
    else if (/(d30 roas)/.test(q)) metric = 'd30ROAS';
    else if (/(d6 cac)/.test(q)) metric = 'd6CAC';
    else if (/\bctr\b/.test(q)) metric = 'ctr';
    else if (/\bcpc\b/.test(q)) metric = 'cpc';
    else if (/\bcpa\b/.test(q)) metric = 'cpa';
    else if (/(d0 trials|d0trial|d0 trial)/.test(q)) metric = 'd0_trial';
    else if (/(signups|sign ups|signup)/.test(q)) metric = 'signups';

    var entity = 'adgroup';
    if (/\bcampaigns?\b/.test(q)) entity = 'campaign';
    else if (/\bad ?groups?\b|\badsets?\b/.test(q)) entity = 'adgroup';
    else if (/\bads?\b/.test(q)) entity = 'ad';

    var queryType = null;
    if (/(week on week|wow|trend|trends)/.test(q)) queryType = 'trend';
    else if (/(how to reduce|how can i reduce|lower|decrease|cut)/.test(q)) queryType = 'reduce_metric';
    else if (/(how to increase|increase|get more|improve|scale)/.test(q)) queryType = 'increase_metric';
    else if (/(which|show me|give me|find|list|any|scan through|tell me|was there any|are there any|do we have any)/.test(q) && metric) queryType = 'search';

    var matureOnly = /(mature|matured|only take mature|exclude last 7 days)/.test(q);
    var status = /\bpaused\b/.test(q) ? 'paused' : (/\blive\b|\benabled\b/.test(q) ? 'live' : 'all');
    var askActionables = /(why|fix|action|what should|how to)/.test(q);
    var askInsights = askActionables || /(insight|insights|reason|what does this mean|analyse|analyze)/.test(q);
    var compareDirection = null;
    if (/(declin|reduc|fall|down|improv)/.test(q)) compareDirection = 'down';
    else if (/(ris|increas|up|worsen)/.test(q)) compareDirection = 'up';

    return {
        raw: prompt,
        normalized: q,
        metric: metric,
        entity: entity,
        queryType: queryType,
        matureOnly: matureOnly,
        status: status,
        askActionables: askActionables,
        askInsights: askInsights,
        compareDirection: compareDirection
    };
}

function emptyGoogleTrendRaw() {
    return {
        spend: 0, impressions: 0, clicks: 0, installs: 0,
        signups: 0, d0_trial: 0, d0: 0,
        d6_overall_con: 0, d6_overall_revenue: 0,
        d15_overall_revenue: 0, d30_overall_revenue: 0
    };
}

function buildGoogleTrendBuckets(scan, entityType, options) {
    var source = scan && scan._trendSource ? scan._trendSource : null;
    if (!source) return [];
    var googleRows = source.googleRows || [];
    var funnelRows = source.funnelRows || [];
    var adsDailyRows = source.adsDailyRows || [];
    var until = options && options.until ? options.until : scan.date_range.until;
    if (options && options.matureOnly) until = addDaysIso(until, -7);
    var currentStart = addDaysIso(until, -6);
    var prevEnd = addDaysIso(currentStart, -1);
    var prevStart = addDaysIso(prevEnd, -6);

    var store = {};
    function keyFor(campaignName, adgroupName, adId) {
        if (entityType === 'ad') return String(adId || '');
        if (entityType === 'campaign') return String(campaignName || '');
        return normalizeGoogleJoinText(campaignName) + '|||' + normalizeGoogleJoinText(adgroupName);
    }
    function ensureEntity(key, campaignName, adgroupName, adId, extra) {
        if (!store[key]) {
            store[key] = {
                key: key,
                campaign_name: campaignName || '',
                adgroup_name: adgroupName || '',
                ad_id: adId || '',
                ad_status: extra && extra.ad_status ? extra.ad_status : '',
                ad_type: extra && extra.ad_type ? extra.ad_type : '',
                asset_performance_label: extra && extra.asset_performance_label ? extra.asset_performance_label : '',
                current: emptyGoogleTrendRaw(),
                previous: emptyGoogleTrendRaw()
            };
        }
        return store[key];
    }
    function bucketFor(dateStr) {
        if (!dateStr) return null;
        var d = String(dateStr).substring(0, 10);
        if (compareIso(d, prevStart) >= 0 && compareIso(d, prevEnd) <= 0) return 'previous';
        if (compareIso(d, currentStart) >= 0 && compareIso(d, until) <= 0) return 'current';
        return null;
    }
    function addRaw(target, partial) {
        Object.keys(target).forEach(function(k) {
            target[k] += Number(partial[k]) || 0;
        });
    }

    googleRows.forEach(function(row) {
        if (entityType === 'ad') return;
        var bucket = bucketFor(row.date_start || row.date || row.segments_date || '');
        if (!bucket) return;
        var key = keyFor(row.campaign_name, row.adset_name || row.adgroup_name);
        var entity = ensureEntity(key, row.campaign_name, row.adset_name || row.adgroup_name);
        addRaw(entity[bucket], {
            spend: ((row.spend || (row.cost_micros ? row.cost_micros / 1000000 : 0)) * 1.18),
            impressions: row.impressions || 0,
            clicks: row.clicks || 0,
            installs: row.installs || row.conversions || 0
        });
    });

    funnelRows.forEach(function(row) {
        if (entityType === 'ad') return;
        var bucket = bucketFor(row.date || '');
        if (!bucket) return;
        var key = keyFor(row.campaign_name, row.ad_set_name);
        var entity = ensureEntity(key, row.campaign_name, row.ad_set_name);
        addRaw(entity[bucket], {
            signups: row.signups || 0,
            d0_trial: row.d0_trial || 0,
            d0: row.d0 || 0,
            d6_overall_con: row.d6_overall_con || 0,
            d6_overall_revenue: row.d6_overall_revenue || 0,
            d15_overall_revenue: row.d15_overall_revenue || 0,
            d30_overall_revenue: row.d30_overall_revenue || 0
        });
    });

    adsDailyRows.forEach(function(row) {
        if (entityType !== 'ad') return;
        var bucket = bucketFor(row.date || '');
        if (!bucket) return;
        var key = keyFor(row.campaign_name, row.adgroup_name, row.ad_id);
        var entity = ensureEntity(key, row.campaign_name, row.adgroup_name, row.ad_id, {
            ad_status: row.ad_status,
            ad_type: row.ad_type,
            asset_performance_label: row.asset_performance_label
        });
        addRaw(entity[bucket], {
            spend: ((Number(row.cost_micros) || 0) / 1000000) * 1.18,
            impressions: row.impressions || 0,
            clicks: row.clicks || 0,
            installs: row.conversions || 0,
            conversions: row.conversions || 0,
            overall_revenue: row.conversion_value || 0
        });
    });

    return Object.values(store).map(function(entity) {
        var currentMetrics = deriveMetrics(entity.current);
        var previousMetrics = deriveMetrics(entity.previous);
        return {
            key: entity.key,
            campaign_name: entity.campaign_name,
            adgroup_name: entity.adgroup_name,
            ad_id: entity.ad_id || '',
            ad_status: entity.ad_status || '',
            ad_type: entity.ad_type || '',
            asset_performance_label: entity.asset_performance_label || '',
            current: currentMetrics,
            previous: previousMetrics,
            basis: prevStart + ' → ' + prevEnd + ' vs ' + currentStart + ' → ' + until
        };
    });
}

function valueForMetric(metrics, metric) {
    if (!metrics) return null;
    return metrics[metric];
}

function metricLabel(metric) {
    return {
        signupCost: 'Signup Cost',
        d0TrialCost: 'D0 Trial Cost',
        d6ROAS: 'D6 ROAS',
        d15ROAS: 'D15 ROAS',
        d30ROAS: 'D30 ROAS',
        d6CAC: 'D6 CAC',
        ctr: 'CTR',
        cpc: 'CPC',
        cpa: 'CPA',
        d0_trial: 'D0 Trials',
        signups: 'Signups'
    }[metric] || metric;
}

function isCostMetric(metric) {
    return metric === 'signupCost' || metric === 'd0TrialCost' || metric === 'd6CAC' || metric === 'cpc' || metric === 'cpa';
}

function buildMetricDriverRows(scan, entityType, metric, options) {
    if (entityType === 'ad') {
        var dailyAdAnalysis = buildGoogleDailyAdAnalysis(scan || {});
        var adItems = ((dailyAdAnalysis && dailyAdAnalysis.rows) || []).map(function(row) {
            return {
                label: (row.campaign_name || '') + ' â†’ ' + (row.adgroup_name || '') + ' â†’ ' + (row.ad_id || row.adId || ''),
                campaign_name: row.campaign_name || '',
                adgroup_name: row.adgroup_name || '',
                status: String(row.ad_status || row.status || '').toLowerCase(),
                metrics: row.metrics || deriveMetrics(row.current || row.previous || row.current_metrics || row.previous_metrics || emptyRaw()),
                adAudit: row.action ? {
                    action: row.action,
                    reason: row.reason,
                    fix_line: row.fix_line,
                    creative_summary: row.creative_text || ''
                } : null
            };
        });
        return adItems.filter(function(item) {
            var value = valueForMetric(item.metrics, metric);
            if (value == null || isNaN(value)) return false;
            if (options.status === 'paused' && item.status.indexOf('pause') === -1) return false;
            if (options.status === 'live' && item.status && item.status.indexOf('pause') !== -1) return false;
            return !options.matureOnly || true;
        });
    }
    var items = entityType === 'campaign'
        ? Object.keys(scan.tree || {}).map(function(name) {
            var campaign = scan.tree[name];
            return {
                label: campaign.name || name,
                campaign_name: campaign.name || name,
                status: String((campaign.settings && campaign.settings.campaign && campaign.settings.campaign.status) || '').toLowerCase(),
                metrics: deriveMetrics(campaign.totals || emptyRaw()),
                recommendation: campaign.recommendation || null
            };
        })
        : entityType === 'ad'
        ? (scan.ads || []).map(function(ad) {
            return {
                label: (ad.campaign_name || '') + ' → ' + (ad.adgroup_name || '') + ' → ' + (ad.ad_id || ''),
                campaign_name: ad.campaign_name || '',
                adgroup_name: ad.adgroup_name || '',
                status: String(ad.ad_status || '').toLowerCase(),
                metrics: {
                    ctr: ad.ad_ctr,
                    cpc: ad.ad_cpc,
                    cpa: ad.ad_cpa,
                    spend: ad.ad_spend,
                    conversions: ad.ad_conversions,
                    conversion_value: ad.ad_conversion_value
                },
                adAudit: ad.adAudit || null
            };
        })
        : (scan.adsets || []).map(function(adgroup) {
            return {
                label: (adgroup.campaign_name || '') + ' → ' + (adgroup.adset_name || ''),
                campaign_name: adgroup.campaign_name || '',
                adgroup_name: adgroup.adset_name || '',
                status: String((adgroup.settings && adgroup.settings.adgroup && adgroup.settings.adgroup.status) || '').toLowerCase(),
                metrics: deriveMetrics(adgroup._evalRaw || rawFromItem(adgroup)),
                recommendation: adgroup.recommendation || null,
                searchAudit: adgroup.searchAudit || null,
                settingsAudit: adgroup.settingsAudit || null
            };
        });
    return items.filter(function(item) {
        var value = valueForMetric(item.metrics, metric);
        if (value == null || isNaN(value)) return false;
        if (options.status === 'paused' && item.status.indexOf('pause') === -1) return false;
        if (options.status === 'live' && item.status && item.status.indexOf('pause') !== -1) return false;
        return !options.matureOnly || true;
    });
}

function rankMetricRows(rows, metric, intent) {
    var costMetric = isCostMetric(metric);
    return rows.slice().sort(function(a, b) {
        var av = valueForMetric(a.metrics, metric);
        var bv = valueForMetric(b.metrics, metric);
        if (costMetric || intent === 'reduce_metric') return av - bv;
        return bv - av;
    });
}

function renderGoogleQueryResult(result) {
    if (!result) return '';
    if (result.loading) {
        return '<div style="' + CS + 'margin-top:16px;font-size:12px;color:var(--text-dim);">Reading the Google optimizer context...</div>';
    }
    var scan = GC_OPT_SCAN || {};
    var integrity = scan.integrity || {};
    var currentSlice = result.current_slice || 'All | All';
    var basis = result.basis || (((scan.date_range || {}).since || '--') + ' → ' + ((scan.date_range || {}).until || '--'));
    var html = '<div style="' + CS + 'margin-top:16px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;">' +
            '<div>' +
                '<div style="font-size:11px;color:var(--text-dim);">APEX Answer</div>' +
                '<div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + esc(result.title || 'Google optimizer result') + '</div>' +
            '</div>' +
        '</div>';

    html += '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--accent);">' +
        '<div style="font-size:10px;color:var(--text-dim);">Analysis Basis</div>' +
        '<div style="font-size:13px;color:var(--text);margin-top:4px;">Date range: ' + esc(basis) + '</div>' +
    '</div>';

    html += '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--accent);">' +
        '<div style="font-size:10px;color:var(--text-dim);">Current Working Slice</div>' +
        '<div style="font-size:13px;color:var(--text);margin-top:4px;">' + esc(currentSlice) + '</div>' +
    '</div>';

    if (integrity && (integrity.adCoveragePct != null || integrity.spendCoveragePct != null || integrity.freshStatusPct != null)) {
        html += '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid ' + (integrity.weightedMedianCoherent ? 'var(--green)' : 'var(--orange)') + ';">' +
            '<div style="font-size:10px;color:var(--text-dim);">Data Integrity</div>' +
            '<div style="font-size:13px;color:var(--text);margin-top:4px;">Ad group coverage ' + esc(fmtPct(integrity.adCoveragePct)) + ' | Spend coverage ' + esc(fmtPct(integrity.spendCoveragePct)) + ' | Fresh status ' + esc(fmtPct(integrity.freshStatusPct)) + '</div>' +
            '<div style="font-size:11px;color:var(--text-dim);margin-top:6px;">Weighted median coherence: ' + (integrity.weightedMedianCoherent ? 'PASS' : 'WATCH') + '</div>' +
        '</div>';
    }

    if (result.summary) {
        html += '<div style="' + CARD + 'margin-bottom:12px;border-left:3px solid var(--orange);font-size:12px;line-height:1.7;">' + esc(result.summary) + '</div>';
    }

    if (result.plan_summary) {
        var ps = result.plan_summary;
        html += '<div style="' + CARD + 'margin-top:12px;">' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Execution Summary</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;">' +
                '<div style="' + CARD + 'margin:0;border-left:3px solid var(--red);"><div style="font-size:10px;color:var(--text-dim);">Pause</div><div style="font-size:14px;font-weight:700;color:var(--red);">' + esc(ps.pause_count != null ? ps.pause_count : '--') + '</div></div>' +
                '<div style="' + CARD + 'margin:0;border-left:3px solid var(--orange);"><div style="font-size:10px;color:var(--text-dim);">Reduce</div><div style="font-size:14px;font-weight:700;color:var(--orange);">' + esc(ps.reduce_count != null ? ps.reduce_count : '--') + '</div></div>' +
                '<div style="' + CARD + 'margin:0;border-left:3px solid var(--green);"><div style="font-size:10px;color:var(--text-dim);">Scale</div><div style="font-size:14px;font-weight:700;color:var(--green);">' + esc(ps.scale_count != null ? ps.scale_count : '--') + '</div></div>' +
                '<div style="' + CARD + 'margin:0;border-left:3px solid var(--accent);"><div style="font-size:10px;color:var(--text-dim);">Watch</div><div style="font-size:14px;font-weight:700;color:var(--accent);">' + esc(ps.watch_count != null ? ps.watch_count : '--') + '</div></div>' +
            '</div>' +
            (ps.top_priority_action ? '<div style="font-size:11px;color:var(--text-dim);margin-top:8px;">Top priority: ' + esc(ps.top_priority_action) + '</div>' : '') +
        '</div>';
    }

    if (result.morning_brief) {
        var brief = result.morning_brief;
        html += '<div style="' + CARD + 'margin-top:12px;">' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Morning Brief</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">' +
                '<div style="' + CARD + 'border-left:3px solid var(--accent);margin:0;"><div style="font-size:10px;color:var(--text-dim);margin-bottom:6px;">Market Read</div><div style="font-size:12px;color:var(--text);line-height:1.6;">' + esc((brief.market_read && brief.market_read.summary) || brief.market_read || '--') + '</div>' + ((brief.market_read && brief.market_read.signals && brief.market_read.signals.length) ? '<div style="margin-top:6px;font-size:11px;color:var(--text-dim);">' + brief.market_read.signals.slice(0, 3).map(function(item) { return '• ' + esc(item); }).join('<br>') + '</div>' : '') + '</div>' +
                '<div style="' + CARD + 'border-left:3px solid var(--green);margin:0;"><div style="font-size:10px;color:var(--text-dim);margin-bottom:6px;">Account Pulse</div><div style="font-size:12px;color:var(--text);line-height:1.6;">' + esc((brief.account_pulse && brief.account_pulse.summary) || brief.account_pulse || '--') + '</div>' + ((brief.account_pulse && brief.account_pulse.signals && brief.account_pulse.signals.length) ? '<div style="margin-top:6px;font-size:11px;color:var(--text-dim);">' + brief.account_pulse.signals.slice(0, 3).map(function(item) { return '• ' + esc(item); }).join('<br>') + '</div>' : '') + '</div>' +
                '<div style="' + CARD + 'border-left:3px solid var(--orange);margin:0;"><div style="font-size:10px;color:var(--text-dim);margin-bottom:6px;">What To Do Right Now</div>' + ((brief.what_to_do_right_now && brief.what_to_do_right_now.length) ? brief.what_to_do_right_now.slice(0, 4).map(function(item) { return '<div style="font-size:11px;color:var(--text);line-height:1.6;margin-bottom:6px;">• ' + esc(item) + '</div>'; }).join('') : '<div style="font-size:12px;color:var(--text-dim);">No immediate action.</div>') + '</div>' +
                '<div style="' + CARD + 'border-left:3px solid var(--text-dim);margin:0;"><div style="font-size:10px;color:var(--text-dim);margin-bottom:6px;">What To Leave Alone</div>' + ((brief.what_to_leave_alone && brief.what_to_leave_alone.length) ? brief.what_to_leave_alone.slice(0, 4).map(function(item) { return '<div style="font-size:11px;color:var(--text);line-height:1.6;margin-bottom:6px;">• ' + esc(item) + '</div>'; }).join('') : '<div style="font-size:12px;color:var(--text-dim);">No do-not-touch list.</div>') + '</div>' +
            '</div>' +
            ((brief.campaign_insights && brief.campaign_insights.length) ? '<div style="margin-top:10px;"><div style="font-size:10px;color:var(--text-dim);margin-bottom:6px;">Campaign Insights</div>' + brief.campaign_insights.slice(0, 5).map(function(item) { return '<div style="font-size:11px;color:var(--text);line-height:1.6;margin-bottom:4px;">• ' + esc(item) + '</div>'; }).join('') + '</div>' : '') +
        '</div>';
    }

    function renderLineSection(title, items) {
        if (!items || !items.length) return '';
        return '<div style="' + CARD + 'margin-top:12px;">' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">' + esc(title) + '</div>' +
            items.map(function(line) { return '<div style="font-size:11px;color:var(--text);margin-bottom:6px;">• ' + esc(line) + '</div>'; }).join('') +
        '</div>';
    }

    if (result.rows && result.rows.length) {
        var showStatus = result.rows.some(function(row) { return row.statusText; });
        html += '<div style="' + CARD + 'margin-top:12px;"><div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Breakdown</div><div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;">' +
            '<thead><tr style="border-bottom:1px solid var(--border);">' +
                '<th style="text-align:left;padding:8px;color:var(--text-dim);">Entity</th>' +
                (showStatus ? '<th style="text-align:left;padding:8px;color:var(--text-dim);">Status</th>' : '') +
                '<th style="text-align:right;padding:8px;color:var(--text-dim);">Prev</th>' +
                '<th style="text-align:right;padding:8px;color:var(--text-dim);">Current</th>' +
                '<th style="text-align:right;padding:8px;color:var(--text-dim);">Delta</th>' +
                '<th style="text-align:right;padding:8px;color:var(--text-dim);">Spend</th>' +
            '</tr></thead><tbody>';
        result.rows.forEach(function(row) {
            html += '<tr style="border-bottom:1px solid var(--border);">' +
                '<td style="padding:8px;color:var(--text);">' + esc(row.label || row.entity || '--') + '</td>' +
                (showStatus ? '<td style="padding:8px;color:var(--text-dim);">' + esc(row.statusText || '--') + '</td>' : '') +
                '<td style="padding:8px;text-align:right;color:var(--text);">' + esc(row.prevText || '--') + '</td>' +
                '<td style="padding:8px;text-align:right;color:var(--text);">' + esc(row.currentText || '--') + '</td>' +
                '<td style="padding:8px;text-align:right;color:' + (row.deltaColor || 'var(--text)') + ';">' + esc(row.deltaText || '--') + '</td>' +
                '<td style="padding:8px;text-align:right;color:var(--text);">' + esc(row.spendText || '--') + '</td>' +
            '</tr>';
        });
        html += '</tbody></table></div></div>';
    }

    html += renderLineSection('What To Do Right Now', result.what_to_do_right_now);
    html += renderLineSection('What To Leave Alone', result.what_to_leave_alone);
    html += renderLineSection('Watch List', result.watch_list);
    html += renderLineSection('Campaign Insights', result.campaign_insights);

    if (result.insights && result.insights.length) {
        html += '<div style="' + CARD + 'margin-top:12px;">' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Insights / Actionables</div>' +
            result.insights.map(function(line) { return '<div style="font-size:11px;color:var(--text);margin-bottom:6px;">• ' + esc(line) + '</div>'; }).join('') +
        '</div>';
    }
    html += '</div>';
    return html;
}

function renderGoogleUseCaseBar() {
    var cases = [
        { label: 'Daily Analysis', prompt: 'Give me a daily analysis for this Google account with top winners, weak pockets, and actions.', title: 'Top winners, weak pockets, and what to do today.' },
        { label: 'Deep Dive', prompt: 'Deep dive this Google account and explain the main campaign and ad group drivers.', title: 'Broad account read across campaigns and ad groups.' },
        { label: 'Why Weak', prompt: 'Why is this Google account underperforming? Focus on search terms, settings, trends, and creative.', title: 'Diagnosis before a hard cut.' },
        { label: 'Search Cleanup', prompt: 'Why is this Google account underperforming? Focus on search-term cleanup, negatives, and match types.', title: 'Search waste, negatives, and query drift.' },
        { label: 'Scale Check', prompt: 'Should we scale this Google account? Show only benchmark-positive and structurally clean pockets.', title: 'Scale only the clean, benchmark-positive pockets.' },
        { label: 'Creative Brief', prompt: 'What should we brief creative for in this Google account? Use the strongest and weakest ads.', title: 'Winning hooks, weak hooks, and next creative tests.' },
        { label: 'Paused Revamp', prompt: 'Paused revamp: rank paused campaigns, ad groups, and ads for relaunch.', title: 'Paused relaunch candidates ranked by signal.' },
        { label: 'Change Impact', prompt: 'Run change impact analysis and tell me what changed, why, and what to do next.', title: 'What changed, why, and what to fix.' }
    ];
    return '<div style="margin-top:10px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--bg-card);">' +
        '<div style="font-size:10px;color:var(--text-dim);margin-bottom:8px;">Quick Google Use Cases</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + cases.map(function(item) {
            return '<button class="gc-opt-query-chip" data-query="' + esc(item.prompt) + '" title="' + esc(item.title) + '" style="padding:7px 11px;border-radius:999px;border:1px solid var(--border);background:rgba(15,23,42,0.8);color:var(--text);font-size:11px;font-weight:600;cursor:pointer;">' + esc(item.label) + '</button>';
        }).join('') + '</div>' +
    '</div>';
}

function googleActionTone(action, fallback) {
    var a = String(action || '').toUpperCase();
    if (/PAUSE|CUT|REDUCE|REBUILD|VERIFY|DROP/.test(a)) return 'var(--red)';
    if (/SCALE|INCREASE|KEEP LIVE|PROTECT|MAINTAIN|HOLD/.test(a)) return 'var(--green)';
    if (/WATCH|MONITOR/.test(a)) return 'var(--accent)';
    return fallback || 'var(--orange)';
}

function buildGoogleCreativeAngleLabel(adgroup, adHealthAudit) {
    var summary = ((adHealthAudit && adHealthAudit.notes) || []).join(' ').toLowerCase();
    var reason = String((adHealthAudit && adHealthAudit.reason) || '').toLowerCase();
    var searchAction = String(adgroup && adgroup.searchAudit && adgroup.searchAudit.actions && adgroup.searchAudit.actions[0] || '').toLowerCase();
    var settingsAction = String(adgroup && adgroup.settingsAudit && adgroup.settingsAudit.actions && adgroup.settingsAudit.actions[0] || '').toLowerCase();
    if (/headline|description|ctr|click-through/.test(summary + ' ' + reason)) return 'Headline / hook angle';
    if (/asset label|creative score|asset framing|creative/.test(summary + ' ' + reason)) return 'Asset framing angle';
    if (/search|query|match-type/.test(searchAction)) return 'Search intent to asset angle';
    if (/bid|target|network|geo|setting/.test(settingsAction)) return 'Conversion-setting angle';
    return 'Primary conversion message angle';
}

function buildGoogleCreativeFixText(adgroup, adHealthAudit) {
    var creativeCandidate = adHealthAudit && adHealthAudit.do_line ? adHealthAudit.do_line : '';
    var searchCandidate = adgroup && adgroup.searchAudit && adgroup.searchAudit.actions && adgroup.searchAudit.actions.length ? adgroup.searchAudit.actions[0] : '';
    var settingsCandidate = adgroup && adgroup.settingsAudit && adgroup.settingsAudit.actions && adgroup.settingsAudit.actions.length ? adgroup.settingsAudit.actions[0] : '';
    var recCandidate = adgroup && adgroup.recommendation && adgroup.recommendation.do_line ? adgroup.recommendation.do_line : '';
    if (creativeCandidate) return creativeCandidate;
    if (searchCandidate) return searchCandidate;
    if (settingsCandidate) return settingsCandidate;
    if (recCandidate) return recCandidate;
    return 'Replace the weakest current asset with a clearer value-led challenger and avoid stacking another structural edit on the same ad group today.';
}

function enrichGoogleCreativeTests(plan, scan) {
    if (!plan || !plan.view_4_forward_plan || !Array.isArray(plan.view_4_forward_plan.creative_tests)) return plan;
    var tests = plan.view_4_forward_plan.creative_tests;
    plan.view_4_forward_plan.creative_tests = tests.map(function(item) {
        if (item && item.fix && item.hook && item.hook !== 'Refresh the weakest asset angle') return item;
        var hypothesis = String(item && item.hypothesis || '');
        var parts = hypothesis.split('â†’').map(function(part) { return String(part || '').trim(); });
        var campaignName = parts[0] || '';
        var adsetName = parts[1] || '';
        if (!adsetName) {
            parts = hypothesis.split(/â†’|->/).map(function(part) { return String(part || '').trim(); });
            campaignName = parts[0] || '';
            adsetName = parts[1] || '';
        }
        var adgroup = (scan && scan.adsets || []).find(function(row) {
            return String(row.campaign_name || '').trim() === campaignName && String(row.adset_name || row.adgroup_name || '').trim() === adsetName;
        }) || null;
        var adHealthAudit = adgroup ? buildGoogleAdHealthAudits(scan).find(function(audit) {
            return audit.campaign_name === (adgroup.campaign_name || '') && audit.adset_name === (adgroup.adset_name || adgroup.adgroup_name || '');
        }) : null;
        var next = Object.assign({}, item || {});
        next.hook = buildGoogleCreativeAngleLabel(adgroup, adHealthAudit);
        next.fix = buildGoogleCreativeFixText(adgroup, adHealthAudit);
        return next;
    });
    return plan;
}

function renderGoogleCampaignAdgroupBreakdown(scan) {
    scan = scan || {};
    var campaigns = Object.keys(scan.tree || {}).map(function(name) {
        var campaign = scan.tree[name] || {};
        var totals = deriveMetrics(campaign.totals || emptyRaw());
        var rec = campaign.recommendation || {};
        return {
            name: name,
            totals: totals,
            recommendation: rec,
            type: campaign.type || '',
            adsets: Object.values(campaign.adsets || {}).sort(function(a, b) { return (b.evalSpend || 0) - (a.evalSpend || 0); }).slice(0, 6)
        };
    }).sort(function(a, b) {
        return (b.totals.spend || 0) - (a.totals.spend || 0);
    }).slice(0, 6);

    if (!GC_OPT_OVERVIEW_CAMPAIGN || !campaigns.some(function(c) { return c.name === GC_OPT_OVERVIEW_CAMPAIGN; })) {
        GC_OPT_OVERVIEW_CAMPAIGN = campaigns.length ? campaigns[0].name : '';
    }
    var selected = campaigns.filter(function(c) { return c.name === GC_OPT_OVERVIEW_CAMPAIGN; })[0] || null;
    var html = '<div style="' + CARD + 'margin-top:12px;border-left:3px solid var(--accent);">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Campaign Drilldown</div>' +
        '<div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">Show campaign names first. Click one campaign to open only the adsets inside it.</div>';
    if (campaigns.length) {
        html += '<div style="display:grid;grid-template-columns:minmax(300px,360px) 1fr;gap:12px;">';
        html += '<div style="' + CARD + 'margin:0;">' +
            '<div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:8px;">Campaigns</div>' +
            campaigns.map(function(camp, idx) {
                var active = camp.name === GC_OPT_OVERVIEW_CAMPAIGN;
                return '<button class="gc-opt-open-campaign" data-campaign="' + esc(camp.name || '') + '" style="display:block;width:100%;text-align:left;padding:12px 12px;margin-bottom:8px;border-radius:10px;border:1px solid ' + (active ? 'var(--accent)' : 'var(--border)') + ';background:' + (active ? 'rgba(99,102,241,0.12)' : 'var(--bg-card)') + ';color:var(--text);cursor:pointer;">' +
                    '<div style="font-size:12px;font-weight:700;">' + (idx + 1) + '. ' + esc(camp.name || '--') + '</div>' +
                    '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Spend ' + esc(fmtINR(camp.totals.spend || 0)) + ' | D6 ROAS ' + esc(fmtPct(camp.totals.d6ROAS || 0)) + '</div>' +
                '</button>';
            }).join('') +
        '</div>';
        html += '<div style="' + CARD + 'margin:0;">';
        if (selected) {
            var rec = selected.recommendation || {};
            var tone = googleActionTone(rec.action, rec.color);
            html += '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px;">' +
                '<div style="min-width:0;">' +
                    '<div style="font-size:12px;color:var(--text-dim);">Selected Campaign</div>' +
                    '<div style="font-size:15px;font-weight:700;color:var(--text);margin-top:4px;">' + esc(selected.name || '--') + '</div>' +
                    '<div style="font-size:11px;color:var(--text-dim);margin-top:6px;">Spend ' + esc(fmtINR(selected.totals.spend || 0)) + ' | D6 ROAS ' + esc(fmtPct(selected.totals.d6ROAS || 0)) + ' | Signup cost ' + esc(fmtINR(selected.totals.signupCost || 0)) + '</div>' +
                '</div>' +
                '<div style="font-size:11px;font-weight:700;color:' + tone + ';white-space:nowrap;">' + esc(rec.action || rec.meta_loop_action || 'WATCH') + '</div>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Why: ' + esc(rec.meta_loop_reason || rec.reason || 'No major issue flagged') + '</div>' +
            '<div style="font-size:11px;color:var(--accent);margin-bottom:10px;">Fix: ' + esc(rec.do_line || rec.meta_loop_reason || 'Hold current settings.') + '</div>' +
            '<div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:8px;">Adsets In This Campaign</div>' +
            (selected.adsets && selected.adsets.length ? selected.adsets.map(function(adgroup) {
                var ar = adgroup.recommendation || {};
                return '<div style="padding:10px 0;border-bottom:1px dashed var(--border);">' +
                    '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">' +
                        '<div style="min-width:0;">' +
                            '<div style="font-size:11px;font-weight:700;color:var(--text);">' + esc(adgroup.adset_name || adgroup.adgroup_name || '--') + '</div>' +
                            '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Spend ' + esc(fmtINR(adgroup.evalSpend || 0)) + ' | D6 ROAS ' + esc(fmtPct(adgroup.d6ROAS || 0)) + ' | Signup cost ' + esc(fmtINR(adgroup.signupCost || 0)) + '</div>' +
                        '</div>' +
                        '<div style="font-size:10px;font-weight:700;color:' + googleActionTone(ar.action, ar.color) + ';white-space:nowrap;">' + esc(ar.action || 'WATCH') + '</div>' +
                    '</div>' +
                    '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Why: ' + esc(ar.reason || 'No major issue flagged') + '</div>' +
                    '<div style="font-size:10px;color:var(--accent);margin-top:4px;">Fix: ' + esc(ar.do_line || 'Hold current settings.') + '</div>' +
                '</div>';
            }).join('') : '<div style="font-size:11px;color:var(--text-dim);">No adsets available in this campaign.</div>');
        } else {
            html += '<div style="font-size:11px;color:var(--text-dim);">No campaigns available in this slice.</div>';
        }
        html += '</div></div>';
    } else {
        html += '<div style="font-size:11px;color:var(--text-dim);">No campaigns available in this slice.</div>';
    }
    html += '</div>';
    return html;
}

function renderGoogleOperatorOverview(plan, scan, actions) {
    var pulse = plan && plan.account_pulse ? plan.account_pulse : {};
    var scanSummary = scan && scan.summary ? scan.summary : {};
    var urgent = (actions || []).filter(function(a) { return a.priority === 'P1' || a.priority_label === 'urgent'; }).length;
    var budgetMoves = (actions || []).filter(function(a) { return /BUDGET/.test(String(a.action_type || '')); }).length;
    var pauses = (actions || []).filter(function(a) { return /PAUSE/.test(String(a.action_type || '')); }).length;
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px;">' +
        '<div style="' + CARD + 'border-left:3px solid var(--accent);"><div style="font-size:10px;color:var(--text-dim);">Spend</div><div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + fmtINR(pulse.spend_total || 0) + '</div></div>' +
        '<div style="' + CARD + 'border-left:3px solid var(--green);"><div style="font-size:10px;color:var(--text-dim);">D6 ROAS</div><div style="font-size:16px;font-weight:700;color:var(--green);margin-top:4px;">' + fmtPct(pulse.roas_window || 0) + '</div></div>' +
        '<div style="' + CARD + 'border-left:3px solid var(--orange);"><div style="font-size:10px;color:var(--text-dim);">Current Slice</div><div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + esc(String(scanSummary.total_adsets || 0)) + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + esc(String(scanSummary.total_campaigns || 0)) + ' campaigns</div></div>' +
        '<div style="' + CARD + 'border-left:3px solid var(--red);"><div style="font-size:10px;color:var(--text-dim);">Do Now</div><div style="font-size:16px;font-weight:700;color:var(--red);margin-top:4px;">' + esc(String(urgent)) + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + esc(String(pauses)) + ' pauses | ' + esc(String(budgetMoves)) + ' budget moves</div></div>' +
    '</div>';
}

function renderGoogleActionsTable(actions) {
    if (!actions || !actions.length) return '<div style="font-size:11px;color:var(--text-dim);">No action rows available.</div>';
    return '<div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;">' +
        '<thead><tr style="border-bottom:1px solid var(--border);">' +
            '<th style="text-align:left;padding:8px;color:var(--text-dim);">Priority</th>' +
            '<th style="text-align:left;padding:8px;color:var(--text-dim);">Entity</th>' +
            '<th style="text-align:left;padding:8px;color:var(--text-dim);">Action</th>' +
            '<th style="text-align:left;padding:8px;color:var(--text-dim);">Budget</th>' +
            '<th style="text-align:left;padding:8px;color:var(--text-dim);">Why</th>' +
            '<th style="text-align:left;padding:8px;color:var(--text-dim);">Next step</th>' +
        '</tr></thead><tbody>' +
        actions.map(function(a) {
            return '<tr style="border-bottom:1px solid var(--border);">' +
                '<td style="padding:8px;color:var(--text);">' + esc(a.priority || '--') + '</td>' +
                '<td style="padding:8px;color:var(--text);">' + esc((a.campaign_name || '--') + ' → ' + (a.adset_name || a.entity_name || '--')) + '</td>' +
                '<td style="padding:8px;color:' + googleActionTone(a.category || a.action_type, 'var(--text)') + ';">' + esc(a.category || a.action_type || '--') + '</td>' +
                '<td style="padding:8px;color:var(--text-dim);">' + esc(a.budget_text || a.budgetAmount || a.budget_amount || '--') + '</td>' +
                '<td style="padding:8px;color:var(--text-dim);">' + esc(a.diagnosis || a.reason || '--') + '</td>' +
                '<td style="padding:8px;color:var(--accent);">' + esc(a.next_step || a.action_detail || a.do_line || a.do || '--') + '</td>' +
            '</tr>';
        }).join('') + '</tbody></table></div>';
}

function renderGoogleMarketerDailyReview(plan, scan) {
    var brief = plan.morning_brief || {};
    var marketRead = brief.market_read || {};
    var pulse = brief.account_pulse || {};
    var doNow = normalizeGoogleActionItems(brief.what_to_do_right_now, 'Do not stack another structural edit on the same entity today.');
    var leaveAlone = normalizeGoogleLeaveAloneItems(brief.what_to_leave_alone);
    var campaignInsights = normalizeGoogleCampaignInsights(brief.campaign_insights);
    var thisWeek = Array.isArray(brief.this_weeks_moves) ? brief.this_weeks_moves : [];
    var horizon = brief.thirty_day_horizon || {};
    var risks = Array.isArray(horizon.risks) ? horizon.risks : [];
    var opportunities = Array.isArray(horizon.opportunities) ? horizon.opportunities : [];
    var range = ((scan.date_range || {}).since || '--') + ' → ' + ((scan.date_range || {}).until || '--');
    return '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:700;margin-bottom:12px;">APEX Morning Brief</h3>' +
        '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--accent);"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Recommendation Basis</div><div style="font-size:12px;color:var(--text);line-height:1.7;">Date range: ' + esc(range) + ' | Basis: Google mature/early logic</div></div>' +
        '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--accent);"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Market Read</div><div style="font-size:12px;color:var(--text);line-height:1.7;">' + esc(marketRead.summary || plan.executive_summary || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:6px;">Posture: ' + esc(marketRead.posture || 'HOLD AND OPTIMISE') + '</div></div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px;">' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Spend Today</div><div style="font-size:14px;font-weight:700;color:var(--text);margin-top:4px;">' + esc(pulse.spend_today || '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">ROAS 7d</div><div style="font-size:14px;font-weight:700;color:var(--green);margin-top:4px;">' + esc(pulse.roas_7d || '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">CPA 7d</div><div style="font-size:14px;font-weight:700;color:var(--orange);margin-top:4px;">' + esc(pulse.cpa_7d || '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Active / Learning</div><div style="font-size:14px;font-weight:700;color:var(--text);margin-top:4px;">' + esc(pulse.active_counts || '--') + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + esc(pulse.learning_counts || '--') + '</div></div>' +
        '</div>' +
        renderGoogleCampaignAdgroupBreakdown(scan) +
        '<div style="' + CARD + 'margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">What To Do Right Now</div>' +
            (doNow.length ? doNow.slice(0, 7).map(function(item) {
                return '<div style="padding:8px 0;border-bottom:1px solid var(--border);"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.title || '--') + '</div>' +
                    (item.why ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Why: ' + esc(item.why) + '</div>' : '') +
                    (item.do ? '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Do: ' + esc(item.do) + '</div>' : '') +
                    (item.budget_text ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Budget: ' + esc(item.budget_text) + '</div>' : '') +
                    (item.do_not ? '<div style="font-size:11px;color:var(--orange);margin-top:4px;">Do not: ' + esc(item.do_not) + '</div>' : '') +
                '</div>';
            }).join('') : renderGoogleActionsTable(plan.actions || [])) +
        '</div>' +
        '<div style="' + CARD + 'margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">What To Leave Alone Today</div>' +
            (leaveAlone.length ? leaveAlone.map(function(item) {
                return '<div style="padding:8px 0;border-bottom:1px solid var(--border);"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.title || '--') + '</div>' +
                    (item.reason ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Leave alone because: ' + esc(item.reason) + '</div>' : '') +
                    (item.watch_for ? '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Watch for: ' + esc(item.watch_for) + '</div>' : '') +
                '</div>';
            }).join('') : '<div style="font-size:11px;color:var(--text-dim);">No protected entities were returned for this run.</div>') +
        '</div>' +
        (campaignInsights.length ? '<div style="' + CARD + 'margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Campaign Insights</div>' +
            campaignInsights.map(function(item) {
                return '<div style="padding:8px 0;border-bottom:1px solid var(--border);"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.campaign_name || '--') + '</div>' +
                    (item.status ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Status: ' + esc(item.status) + '</div>' : '') +
                    (item.trend ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Trend: ' + esc(item.trend) + '</div>' : '') +
                    (item.adset_insights ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Ad Set Insights: ' + esc(item.adset_insights) + '</div>' : '') +
                    (item.creative_insights ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Creative Insights: ' + esc(item.creative_insights) + '</div>' : '') +
                    (item.key_question ? '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Key Question: ' + esc(item.key_question) + '</div>' : '') +
                '</div>';
            }).join('') + '</div>' : '') +
        ((thisWeek.length || risks.length || opportunities.length) ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
            '<div style="' + CARD + '"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">This Week\'s Moves</div>' + (thisWeek.length ? thisWeek.map(function(item) { return '<div style="font-size:11px;color:var(--text-dim);padding:4px 0;">• ' + esc(item.title || item.entity_name || item) + '</div>'; }).join('') : '<div style="font-size:11px;color:var(--text-dim);">No additional non-urgent moves returned.</div>') + '</div>' +
            '<div style="' + CARD + '"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">30-Day Horizon</div>' +
            (risks.length ? '<div style="font-size:11px;color:var(--orange);margin-bottom:6px;">Risks</div>' + risks.map(function(item) { return '<div style="font-size:11px;color:var(--text-dim);padding:3px 0;">• ' + esc(item.risk || item.title || item) + '</div>'; }).join('') : '') +
            (opportunities.length ? '<div style="font-size:11px;color:var(--green);margin:8px 0 6px 0;">Opportunities</div>' + opportunities.map(function(item) { return '<div style="font-size:11px;color:var(--text-dim);padding:3px 0;">• ' + esc(item.opportunity || item.title || item) + '</div>'; }).join('') : '') +
            '</div></div>' : '') +
    '</div>';
}

function renderGoogleDailyActionConsole(plan, scan) {
    var gate = plan.data_integrity_gate || {};
    var breakdownActions = Array.isArray(plan.breakdown_action_recommendations) ? plan.breakdown_action_recommendations : [];
    return '<div style="' + CS + '">' +
        (gate.provisional_only ? '<div style="' + CARD + 'margin-bottom:12px;border-left:3px solid var(--orange);"><div style="font-size:12px;font-weight:700;color:var(--orange);">Provisional Recommendations</div><div style="font-size:11px;color:var(--text-dim);margin-top:6px;">' + esc((gate.warnings && gate.warnings[0]) || 'Integrity checks failed. Treat recommendations cautiously.') + '</div></div>' : '') +
        (breakdownActions.length ? '<div style="' + CARD + 'margin-bottom:12px;border-left:3px solid var(--accent);"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Account-Level Breakdown Actions</div>' +
            breakdownActions.map(function(item) { return '<div style="padding:6px 0;border-bottom:1px solid var(--border);"><div style="font-size:11px;font-weight:600;color:var(--text);">' + esc(item.title || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Why: ' + esc(item.why || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">Do: ' + esc(item.do || '--') + '</div></div>'; }).join('') + '</div>' : '') +
        '<div style="' + CARD + 'margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Today\'s Action Queue</div>' + renderGoogleActionsTable(plan.actions || []) + '</div>' +
    '</div>';
}

function renderGoogleMarketerDiagnosis(plan) {
    var diag = plan.view_2_diagnosis || {};
    var perf = Array.isArray(diag.performance_shifts) ? diag.performance_shifts.slice(0, 4) : [];
    var delivery = Array.isArray(diag.delivery_issues) ? diag.delivery_issues.slice(0, 4) : [];
    var learning = Array.isArray(diag.learning_phase_map) ? diag.learning_phase_map.slice(0, 4) : [];
    return '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Why Performance Looks Like This</h3>' +
        (perf.length ? perf.map(function(item) { return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.metric || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(item.attributed_cause || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">Confidence: ' + esc(item.confidence || '--') + '</div></div>'; }).join('') : '') +
        (delivery.length ? delivery.map(function(item) { return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--orange);">' + esc(item.entity_name || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(item.detail || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">Fix: ' + esc(item.fix || '--') + '</div></div>'; }).join('') : '') +
        (learning.length ? '<div style="margin-top:10px;"><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Learning-Limited</div>' + learning.map(function(item) { return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.adset_name || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(item.status || '--') + ' | Events ' + esc(item.opt_events_7d != null ? String(item.opt_events_7d) : '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">' + esc(item.fix || '--') + '</div></div>'; }).join('') + '</div>' : '') +
    '</div>';
}

function renderGoogleScaleAndTest(plan) {
    var forward = plan.view_4_forward_plan || {};
    var scaling = Array.isArray(forward.scaling_roadmap) ? forward.scaling_roadmap.slice(0, 4) : [];
    var creativeTests = Array.isArray(forward.creative_tests) ? forward.creative_tests.slice(0, 3) : [];
    return '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Next Moves</h3>' +
        (scaling.length ? '<div style="margin-bottom:12px;"><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Scale Steps</div>' + scaling.map(function(item) { return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--green);">' + esc(item.adset_name || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">Watch: ' + esc(item.watch_metric || '--') + '</div></div>'; }).join('') + '</div>' : '') +
        (creativeTests.length ? '<div style="margin-bottom:12px;"><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Creative Tests</div>' + creativeTests.map(function(item) { return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.hypothesis || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Angle: ' + esc(item.hook || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">Fix: ' + esc(item.fix || '--') + '</div></div>'; }).join('') + '</div>' : '') +
    '</div>';
}

window.renderGcOptimizerQueryResultHtml = renderGoogleQueryResult;

function normalizeGoogleStatusLabel(status) {
    var value = String(status || '').toUpperCase();
    if (!value) return '--';
    if (value.indexOf('PAUSE') !== -1) return 'Paused';
    if (value.indexOf('ENABLE') !== -1) return 'Live';
    return value;
}

function isGooglePausedStatus(status) {
    return String(status || '').toUpperCase().indexOf('PAUSE') !== -1;
}

function buildGoogleQueryInsights(parsed, rows) {
    var insights = [];
    if (!rows || !rows.length) return insights;
    var top = rows[0];
    if (parsed.queryType === 'trend') {
        if (parsed.compareDirection === 'down' && isCostMetric(parsed.metric)) {
            insights.push('Best cost improvement is in ' + top.label + ', where the current bucket is lower than the previous bucket.');
            if (parsed.status === 'paused') insights.push('These entities are still paused, so review whether a controlled reactivation test is justified.');
        } else if (parsed.compareDirection === 'up' && isCostMetric(parsed.metric)) {
            insights.push('The worst cost pressure pocket is ' + top.label + ' and should be fixed before scaling.');
        } else if (!isCostMetric(parsed.metric)) {
            insights.push('The strongest momentum pocket is ' + top.label + ' on the requested metric.');
        }
    } else if (parsed.queryType === 'reduce_metric') {
        insights.push('Use the lowest-cost mature pockets as the operating template before changing account-wide bids or budgets.');
        if (top.label) insights.push('Start from ' + top.label + ' and compare its settings, search terms, and device/network mix against the weaker rows.');
    } else if (parsed.queryType === 'increase_metric') {
        insights.push('Scale only the strongest output pockets first and keep weaker structures on tighter control.');
    }
    return insights.slice(0, 4);
}

function getGoogleApexModeConfig(mode) {
    var configs = {
        daily_review: {
            label: 'Daily Optimisations',
            objective: 'Tell me exactly what to change today across campaign budgets, pauses, reactivations, structure, search-term cleanup, geo/device mix, asset-group quality, and week-on-week trends.',
            command: 'SESSION: daily_review. Focus on what to change today. Be specific and numeric.'
        },
        paused_revamp: {
            label: 'Paused Revamp',
            objective: 'Review paused campaigns, ad groups, and ads using the last active window, then rank relaunch candidates and keep-paused rows clearly.',
            command: 'SESSION: paused_revamp. Focus only on paused campaigns, ad groups, and ads. Use the last active months performance window, rank relaunch candidates, and separate relaunch, test, and keep-paused decisions clearly.'
        },
        diagnostic: {
            label: 'Diagnosis',
            objective: 'Explain why performance looks like this before making broad changes.',
            command: 'SESSION: diagnostic. Focus on causes, confidence, and missing evidence.'
        },
        account_overview: {
            label: 'Account Overview',
            objective: 'Go campaign by campaign, then ad group by ad group, and tell the operator what to improve and what to leave alone.',
            command: 'SESSION: account_overview. Cover all active campaigns and ad groups in order.'
        }
    };
    return configs[mode] || configs.daily_review;
}

function getCanonicalGoogleOptimizerCommand(parsed, prompt) {
    var lower = String(prompt || '').toLowerCase();
    if (/paused revamp|paused recovery|paused relaunch|relaunch paused|reactivate paused|revive paused|bring back paused/.test(lower)) return 'paused_revamp';
    if (/run morning account review|morning brief|morning account review/.test(lower)) return 'morning_account_review';
    if (/^deep dive:/.test(lower) || /deep dive/.test(lower)) return 'deep_dive';
    if (/^why is .*underperforming\??$/.test(lower) || /underperforming|why limited|why is performance weak|why performance is weak|why is google performance weak/.test(lower)) return 'underperformance_rca';
    if (/^should we scale /.test(lower) || /should we scale/.test(lower)) return 'scale_check';
    if (/validate optimizer queue/.test(lower)) return 'queue_validation';
    if (/predict next 30 days/.test(lower)) return 'predict_30_days';
    if (/what should we brief creative for|brief creative|creative refresh|create next/.test(lower)) return 'creative_brief';
    if (/run change impact analysis|change impact analysis/.test(lower)) return 'change_impact_analysis';
    if (/daily analysis|full account daily analysis|campaign by campaign|full account|all live campaigns/.test(lower)) return 'full_account_review';
    if (parsed && parsed.mode === 'account_overview') return 'deep_dive';
    if (parsed && parsed.mode === 'diagnostic') return 'underperformance_rca';
    return 'daily_optimisation';
}

function normalizeGoogleOptimizerPrompt(value) {
    return String(value || '').trim();
}

function inferGooglePromptEntityMatch(scan, prompt) {
    if (!scan || !prompt) return null;
    var q = String(prompt || '').toLowerCase();
    var matches = [];
    Object.keys(scan.tree || {}).forEach(function(campaignName) {
        if (q.indexOf(String(campaignName || '').toLowerCase()) !== -1) {
            matches.push({ type: 'campaign', query: campaignName, score: String(campaignName || '').length });
        }
    });
    (scan.adsets || []).forEach(function(adgroup) {
        if (q.indexOf(String(adgroup.adset_name || '').toLowerCase()) !== -1) {
            matches.push({ type: 'adgroup', query: adgroup.adset_name, score: String(adgroup.adset_name || '').length });
        }
    });
    (scan.ads || []).forEach(function(ad) {
        var adName = ad.ad_name || ad.ad_id || '';
        if (adName && q.indexOf(String(adName).toLowerCase()) !== -1) {
            matches.push({ type: 'ad', query: adName, score: String(adName).length });
        }
    });
    matches.sort(function(a, b) { return b.score - a.score; });
    return matches[0] || null;
}

function parseGooglePromptIntent(scan, prompt) {
    var text = normalizeGoogleOptimizerPrompt(prompt);
    var lower = text.toLowerCase();
    var isMorningBrief = /(run morning account review|morning brief|morning account review)/.test(lower);
    var isPausedRevamp = /(paused revamp|paused recovery|paused relaunch|relaunch paused|reactivate paused|revive paused|bring back paused)/.test(lower);
    var isDailyAnalysis = /(daily analysis|daily review of account|account daily analysis|full account daily analysis)/.test(lower);
    var isFullHierarchyReview = /(full account|entire account|all active items|all live campaigns|campaign by campaign)/.test(lower);
    var isBroadEntitySearch = /\b(any|all|which|what all|show me|list|give me|tell me)\b.*\b(campaign|campaigns|ad group|adgroup|adgroups|ads|ad)\b/.test(lower);
    var result = {
        ok: true,
        mode: 'daily_review',
        target: { type: 'account', query: '' },
        statusFilter: 'all',
        command_type: 'daily_optimisation',
        clarification: ''
    };
    if (!text) {
        result.ok = false;
        result.clarification = 'Tell me what you want. Example: "daily analysis", "deep dive", or "why is performance weak".';
        return result;
    }
    if (isPausedRevamp) {
        result.mode = 'paused_revamp';
        result.statusFilter = 'paused_only';
    }
    if (/\bpaused\b/.test(lower)) result.statusFilter = 'paused_only';
    if (/\blive\b/.test(lower) && !/\ball live campaigns\b/.test(lower)) result.statusFilter = 'live_only';
    if (isMorningBrief || isDailyAnalysis || isFullHierarchyReview) {
        result.mode = isDailyAnalysis || isFullHierarchyReview ? 'account_overview' : 'daily_review';
    }
    if (isPausedRevamp) {
        result.mode = 'paused_revamp';
        result.target = { type: 'account', query: '' };
        result.statusFilter = 'paused_only';
    }
    if (/\boverview\b|\bdeep dive\b/.test(lower)) result.mode = 'account_overview';
    if (!isDailyAnalysis && !isFullHierarchyReview && /\bdiagnose\b|\bwhy is\b|\bunderperform\b|\bproblem\b|\bwhy limited\b|\bwhy is performance weak\b/.test(lower)) {
        result.mode = 'diagnostic';
    }
    if (!isPausedRevamp && /\bactionable\b|\brevamp\b|\bwhat should i do\b|\bchange today\b/.test(lower)) result.mode = 'daily_review';
    var match = inferGooglePromptEntityMatch(scan, text);
    if (match && !isBroadEntitySearch) result.target = { type: match.type, query: match.query };
    result.command_type = getCanonicalGoogleOptimizerCommand(result, text);
    return result;
}

function buildGoogleScopedScanData(scan, target) {
    if (!scan || !target || !target.query || target.type === 'account') return scan;
    var query = String(target.query || '').toLowerCase();
    var scopedTree = {};
    var scopedAdsets = [];
    var scopedAds = [];
    if (target.type === 'campaign') {
        Object.keys(scan.tree || {}).forEach(function(name) {
            if (String(name || '').toLowerCase() === query) scopedTree[name] = scan.tree[name];
        });
        scopedAdsets = (scan.adsets || []).filter(function(a) { return String(a.campaign_name || '').toLowerCase() === query; });
        scopedAds = (scan.ads || []).filter(function(a) { return String(a.campaign_name || '').toLowerCase() === query; });
    } else if (target.type === 'adgroup') {
        scopedAdsets = (scan.adsets || []).filter(function(a) { return String(a.adset_name || '').toLowerCase() === query; });
        scopedAds = (scan.ads || []).filter(function(a) { return String(a.adgroup_name || '').toLowerCase() === query; });
        scopedAdsets.forEach(function(a) {
            var campName = a.campaign_name;
            if (!scopedTree[campName] && scan.tree && scan.tree[campName]) scopedTree[campName] = { name: campName, type: scan.tree[campName].type, totals: scan.tree[campName].totals, recommendation: scan.tree[campName].recommendation, adsets: {} };
            if (scopedTree[campName]) scopedTree[campName].adsets[a.adset_name] = scan.tree[campName].adsets[a.adset_name];
        });
    } else if (target.type === 'ad') {
        scopedAds = (scan.ads || []).filter(function(a) {
            var adName = a.ad_name || a.ad_id || '';
            return String(adName).toLowerCase() === query;
        });
        var adgroupKeys = {};
        scopedAds.forEach(function(ad) { adgroupKeys[String(ad.adgroup_name || '').toLowerCase()] = true; });
        scopedAdsets = (scan.adsets || []).filter(function(a) { return adgroupKeys[String(a.adset_name || '').toLowerCase()]; });
        scopedAdsets.forEach(function(a) {
            var campName = a.campaign_name;
            if (!scopedTree[campName] && scan.tree && scan.tree[campName]) scopedTree[campName] = { name: campName, type: scan.tree[campName].type, totals: scan.tree[campName].totals, recommendation: scan.tree[campName].recommendation, adsets: {} };
            if (scopedTree[campName]) scopedTree[campName].adsets[a.adset_name] = scan.tree[campName].adsets[a.adset_name];
        });
    }
    return Object.assign({}, scan, {
        tree: Object.keys(scopedTree).length ? scopedTree : scan.tree,
        adsets: scopedAdsets.length ? scopedAdsets : scan.adsets,
        ads: scopedAds.length ? scopedAds : scan.ads
    });
}

function buildGoogleFilteredScanData(scan, filters) {
    if (!scan) return scan;
    var statusFilter = (filters && filters.statusFilter) || 'all';
    if (statusFilter === 'all') return scan;
    function isPaused(status) { return String(status || '').toLowerCase().indexOf('pause') !== -1; }
    var adsets = (scan.adsets || []).filter(function(a) {
        var status = a.settings && a.settings.adgroup ? a.settings.adgroup.adgroup_status : '';
        return statusFilter === 'paused_only' ? isPaused(status) : !isPaused(status);
    });
    var adgroupNameSet = {};
    adsets.forEach(function(a) { adgroupNameSet[String(a.adset_name || '').toLowerCase()] = true; });
    var ads = (scan.ads || []).filter(function(a) {
        var status = a.ad_status || '';
        if (statusFilter === 'paused_only') return isPaused(status);
        return !isPaused(status);
    }).filter(function(a) {
        if (!adsets.length) return true;
        return adgroupNameSet[String(a.adgroup_name || '').toLowerCase()];
    });
    var tree = {};
    adsets.forEach(function(a) {
        var campName = a.campaign_name;
        if (!tree[campName] && scan.tree && scan.tree[campName]) tree[campName] = { name: campName, type: scan.tree[campName].type, totals: scan.tree[campName].totals, recommendation: scan.tree[campName].recommendation, adsets: {} };
        if (tree[campName]) tree[campName].adsets[a.adset_name] = scan.tree[campName].adsets[a.adset_name];
    });
    return Object.assign({}, scan, {
        tree: Object.keys(tree).length ? tree : scan.tree,
        adsets: adsets,
        ads: ads
    });
}

function buildGoogleSkillContracts() {
    return [
        { id: 'skill-router', path: 'skills/skill-router/SKILL.md' },
        { id: 'google-benchmark-engine', path: 'skills/google-benchmark-engine/SKILL.md' },
        { id: 'google-account-learning', path: 'skills/google-account-learning/SKILL.md' },
        { id: 'cpa-diagnostics', path: 'skills/cpa-diagnostics/SKILL.md' },
        { id: 'wasted-spend-finder', path: 'skills/wasted-spend-finder/SKILL.md' },
        { id: 'anomaly-detection', path: 'skills/anomaly-detection/SKILL.md' },
        { id: 'pacing-monitor', path: 'skills/pacing-monitor/SKILL.md' },
        { id: 'performance-benchmarking', path: 'skills/performance-benchmarking/SKILL.md' },
        { id: 'geo-performance-analysis', path: 'skills/geo-performance-analysis/SKILL.md' },
        { id: 'device-performance-analysis', path: 'skills/device-performance-analysis/SKILL.md' },
        { id: 'attribution-model-comparison', path: 'skills/attribution-model-comparison/SKILL.md' },
        { id: 'account-structure-review', path: 'skills/account-structure-review/SKILL.md' },
        { id: 'roas-forecasting', path: 'skills/roas-forecasting/SKILL.md' },
        { id: 'google-structure-audit', path: 'skills/google-structure-audit/SKILL.md' },
        { id: 'google-bidding-budget-audit', path: 'skills/google-bidding-budget-audit/SKILL.md' },
        { id: 'google-bid-strategy-audit', path: 'skills/google-bid-strategy-audit/SKILL.md' },
        { id: 'google-search-operator-audit', path: 'skills/google-search-operator-audit/SKILL.md' },
        { id: 'search-term-mining', path: 'skills/search-term-mining/SKILL.md' },
        { id: 'google-quality-score-audit', path: 'skills/google-quality-score-audit/SKILL.md' },
        { id: 'keyword-cannibalization-audit', path: 'skills/keyword-cannibalization-audit/SKILL.md' },
        { id: 'google-ad-extension-audit', path: 'skills/google-ad-extension-audit/SKILL.md' },
        { id: 'google-channel-logic', path: 'skills/google-channel-logic/SKILL.md' },
        { id: 'google-query-engine', path: 'skills/google-query-engine/SKILL.md' },
        { id: 'google-playbook-operator', path: 'skills/google-playbook-operator/SKILL.md' },
        { id: 'google-asset-refresh-intelligence', path: 'skills/google-asset-refresh-intelligence/SKILL.md' }
    ];
}

function buildGooglePlaybookRules() {
    return [
        'For the newest week, treat D0 trial cost and signup cost as the primary leading signals; use ROAS as the mature-window KPI.',
        'Use matured basis when available. If the operator asks for mature-only, exclude the last 7 days from deterministic analysis.',
        'If the previous week is weak but the ad group is still trial-heavy or inside the 29-day learning window, do not overreact. Read D0 trial cost, signups, D15/D30 ROAS, and structure before a hard cut.',
        'Treat Search, PMax, Display, Video, and UAC as separate operating systems inside one account.',
        'Ad-level analysis is Google-only. Funnel economics are valid only at campaign and ad group level in this optimizer.',
        'Do not generalize one winner. Scale benchmark-positive pockets first and fix structural waste before broad budget moves.',
        'Always read week-on-week trends, search-term drift, geo/device/network mix, and asset-group quality alongside the KPI line.',
        'For Search, diagnose search terms, match type drift, quality score pressure, and lost impression share before blaming bids alone.'
    ];
}

function buildGoogleActionRows(scan) {
    var rows = [];
    var adgroups = (scan.adsets || []).slice().sort(function(a, b) {
        var pa = (a.recommendation && a.recommendation.priority) || 'P3';
        var pb = (b.recommendation && b.recommendation.priority) || 'P3';
        var order = { P1: 0, P2: 1, P3: 2 };
        if ((order[pa] || 9) !== (order[pb] || 9)) return (order[pa] || 9) - (order[pb] || 9);
        return (b.evalSpend || 0) - (a.evalSpend || 0);
    }).slice(0, 12);
    adgroups.forEach(function(a) {
        var rec = a.recommendation || {};
        var exec = buildGoogleActionExecutionDetails(a, rec);
        var metricSummary = 'D6 ROAS ' + fmtPct(a.d6ROAS) + ' | SU Cost ' + fmtINR(a.signupCost);
        var actionSummary = (rec.action || 'WATCH') + (rec.priority ? ' (' + rec.priority + ')' : '');
        rows.push({
            label: (a.campaign_name || '--') + ' → ' + (a.adset_name || '--'),
            statusText: normalizeGoogleStatusLabel(a.settings && a.settings.adgroup ? a.settings.adgroup.adgroup_status : ''),
            prevText: exec.budget_text || metricSummary,
            currentText: actionSummary,
            deltaText: [exec.next_step || '', rec.reason || '', metricSummary].filter(Boolean).join(' | '),
            deltaColor: rec.color || 'var(--text)',
            spendText: fmtINR(a.evalSpend || 0)
        });
    });
    return rows;
}

function buildGoogleDoNotTouchRows(scan) {
    return (scan.adsets || []).filter(function(a) {
        return a && a.recommendation && (a.recommendation.action === 'MAINTAIN' || a.recommendation.action === 'SCALE');
    }).sort(function(a, b) {
        return (b.d6ROAS || 0) - (a.d6ROAS || 0);
    }).slice(0, 8).map(function(a) {
        return {
            label: (a.campaign_name || '--') + ' → ' + (a.adset_name || '--'),
            statusText: normalizeGoogleStatusLabel(a.settings && a.settings.adgroup ? a.settings.adgroup.adgroup_status : ''),
            prevText: 'Protect',
            currentText: 'D6 ROAS ' + fmtPct(a.d6ROAS),
            deltaText: 'Signup cost ' + fmtINR(a.signupCost) + ' | ' + (a.evalDataLabel || ''),
            deltaColor: 'var(--green)',
            spendText: fmtINR(a.evalSpend || 0)
        };
    });
}

function buildGoogleRiskRows(scan) {
    return (scan.adsets || []).filter(function(a) {
        return a && a.recommendation && (a.recommendation.action === 'PAUSE' || a.recommendation.action === 'REDUCE BUDGET' || a.recommendation.action === 'OPTIMIZE');
    }).sort(function(a, b) {
        return (b.evalSpend || 0) - (a.evalSpend || 0);
    }).slice(0, 8).map(function(a) {
        return {
            label: (a.campaign_name || '--') + ' → ' + (a.adset_name || '--'),
            statusText: normalizeGoogleStatusLabel(a.settings && a.settings.adgroup ? a.settings.adgroup.adgroup_status : ''),
            prevText: 'Risk',
            currentText: (a.recommendation && a.recommendation.action) || 'WATCH',
            deltaText: (a.recommendation && a.recommendation.reason) || '--',
            deltaColor: (a.recommendation && a.recommendation.color) || 'var(--orange)',
            spendText: fmtINR(a.evalSpend || 0)
        };
    });
}

function buildGoogleCreativeBriefRows(scan) {
    var playbook = buildGoogleAppAssetPlaybook(scan || {});
    if (playbook.group_rows && playbook.group_rows.length) {
        return playbook.group_rows.slice(0, 8).map(function(row) {
            return {
                label: (row.campaign_name || '--') + ' â†’ ' + (row.adgroup_name || '--'),
                statusText: (row.winning_asset_type || 'Asset playbook'),
                prevText: row.winning_asset_text || '--',
                currentText: row.next_step || 'Reuse the winning asset pattern',
                deltaText: row.why || '--',
                deltaColor: 'var(--green)',
                spendText: fmtINR(row.cost || 0)
            };
        });
    }
    return (scan.ads || []).filter(function(ad) {
        return ad && ad.adAudit && ad.adAudit.summary && ad.adAudit.summary.length;
    }).sort(function(a, b) {
        return (b.ad_spend || 0) - (a.ad_spend || 0);
    }).slice(0, 8).map(function(ad) {
        return {
            label: (ad.campaign_name || '--') + ' → ' + (ad.adgroup_name || '--') + ' → ' + (ad.ad_id || '--'),
            statusText: normalizeGoogleStatusLabel(ad.ad_status || ''),
            prevText: ad.asset_performance_label || ad.ad_type || 'Google ad',
            currentText: ad.adAudit.actions && ad.adAudit.actions.length ? ad.adAudit.actions[0] : 'Refresh creative',
            deltaText: (ad.adAudit.summary || []).join(', '),
            deltaColor: 'var(--orange)',
            spendText: fmtINR(ad.ad_spend || 0)
        };
    });
}

function buildGoogleCommandInsights(scan, parsed, rows) {
    var insights = [];
    var integrity = scan.integrity || {};
    var benchmarks = scan.benchmarks || {};
    var imported = buildGoogleImportedAuditSummary(scan);
    var advanced = buildGoogleAdvancedTrendIntelligence(scan);
    var playbook = buildGoogleAppAssetPlaybook(scan || {});
    if (parsed.command_type === 'morning_account_review' || parsed.command_type === 'full_account_review' || parsed.command_type === 'daily_optimisation') {
        insights.push('Primary KPI basis: D6 ROAS with signup cost and D0 trial cost as forward efficiency signals.');
        insights.push('Read the account at campaign, ad group, search-term, geo/device/network, and asset-group levels; do not compress everything into budget advice.');
        insights.push('For Google learning windows, a weak previous week can be expected while trial volume is still forming. Judge the pocket with D0 trial cost, signups, and downstream quality before a hard cut.');
        insights.push('Integrity: spend coverage ' + fmtPct(integrity.spendCoveragePct) + ' | ad group coverage ' + fmtPct(integrity.adCoveragePct) + ' | weighted median coherence ' + (integrity.weightedMedianCoherent ? 'PASS' : 'WATCH') + '.');
        if (benchmarks.d6ROAS_median) insights.push('Protect structures beating the D6 ROAS weighted median of ' + fmtPct(benchmarks.d6ROAS_median) + ' before making broad changes.');
        if (imported.estimated_wasted_spend > 0) insights.push('Estimated benchmark-negative spend is ' + fmtINR(imported.estimated_wasted_spend) + ', so waste-cutting is material.');
        if (imported.benchmark_positive_count || imported.benchmark_negative_count) insights.push('Benchmark-positive pockets: ' + (imported.benchmark_positive_count || 0) + ' | benchmark-negative pockets: ' + (imported.benchmark_negative_count || 0) + '.');
        if (advanced && advanced.campaigns) insights.push('Week-on-week trend signals are present for ' + Object.keys(advanced.campaigns || {}).length + ' campaigns and ' + Object.keys(advanced.adsets || {}).length + ' ad groups.');
        if (playbook.top_type_rows && playbook.top_type_rows.length) {
            var topDesc = playbook.top_type_rows.find(function(row) { return String(row.app_asset_type || '').toLowerCase() === 'description'; }) || playbook.top_type_rows[0];
            if (topDesc) insights.push('Reuse this offer-led description before broadening the pocket: ' + (topDesc.top_asset_text || '--') + '.');
        }
    }
    if (parsed.command_type === 'underperformance_rca') {
        insights.push('Read Search term drift, bid strategy, geo/device/network mix, and benchmark gaps before blaming creative alone.');
        insights.push('If D0 trial cost is weak but long-tail ROAS is strong, improve the surrounding structure rather than cutting the pocket immediately.');
        if (imported.search_pressure_count > 0) insights.push('Search pressure is visible in ' + imported.search_pressure_count + ' ad groups, so query intent and QS need review.');
    }
    if (parsed.command_type === 'scale_check') {
        insights.push('Scale only benchmark-positive pockets and keep budget steps disciplined.');
        insights.push('Do not broaden weak Search or PMax structures just because one ad group is working.');
        if (imported.pacing_risk !== 'distributed') insights.push('Spend concentration is ' + imported.pacing_risk + ', so scaling should stay selective.');
        if (imported.benchmark_positive_count) insights.push('There are ' + imported.benchmark_positive_count + ' benchmark-positive ad groups available as scale candidates.');
    }
    if (parsed.command_type === 'paused_revamp') {
        insights.push('Inspect paused campaigns, ad groups, and ads using the last active window before relaunching anything.');
        insights.push('For Google, keep budget changes at campaign level only. Use ad group and ad findings for relaunch and creative refresh, not ad group budget shifts.');
    }
    if (parsed.command_type === 'queue_validation') {
        insights.push('Only P1 and P2 actions on mature or materially spent rows should survive the queue.');
        insights.push('Rows with thin spend or weak coverage should be downgraded to WATCH or MONITOR.');
    }
    if (parsed.command_type === 'predict_30_days') {
        insights.push('Use D15 and D30 ROAS plus current D0 trial cost direction as the main forward signals.');
        insights.push('Predictions are directional when coverage or status freshness is weak.');
    }
    if (parsed.command_type === 'creative_brief') {
        insights.push('Ad-level creative recommendations are Google-only. Funnel economics stay at campaign and ad group level.');
        insights.push('Use high-spend weak ads as refresh candidates and protect asset groups or ads already holding benchmark-positive economics.');
        if (playbook.top_type_rows && playbook.top_type_rows.length) {
            var topDescription = playbook.top_type_rows.find(function(row) { return String(row.app_asset_type || '').toLowerCase() === 'description'; }) || playbook.top_type_rows[0];
            var topHeadline = playbook.top_type_rows.find(function(row) { return String(row.app_asset_type || '').toLowerCase() === 'headline'; }) || null;
            var topDeepLink = playbook.top_type_rows.find(function(row) { return String(row.app_asset_type || '').toLowerCase() === 'app deep link'; }) || null;
            var weakImage = playbook.weak_type_rows && playbook.weak_type_rows.find ? playbook.weak_type_rows.find(function(row) { return String(row.app_asset_type || '').toLowerCase() === 'horizontal image'; }) : null;
            if (topDescription) insights.push('Reuse this offer-led description: ' + (topDescription.top_asset_text || '--') + '.');
            if (topHeadline) insights.push('Adapt this headline into the next test: ' + (topHeadline.top_asset_text || '--') + '.');
            if (topDeepLink) insights.push('Use the deep link as the primary conversion path: ' + (topDeepLink.top_asset_text || '--') + '.');
            if (weakImage) insights.push('Pause image-heavy variants first: ' + (weakImage.weakest_asset_text || '--') + '.');
        }
    }
    if (parsed.command_type === 'paused_revamp') {
        insights.push('Paused rows should be separated by campaign, ad group, and ad so relaunch decisions stay clean.');
    }
    if (parsed.command_type === 'change_impact_analysis') {
        insights.push('Interpret change impact through bid strategy, budget, geo/language, search-term shifts, and asset-group quality before attributing movement to one lever.');
    }
    if (imported.top_geo_spend_pocket && insights.length < 8) {
        insights.push('Top geo spend pocket: ' + imported.top_geo_spend_pocket.key + ' at ' + fmtINR(imported.top_geo_spend_pocket.value) + '.');
    }
    if (imported.top_device_spend_pocket && insights.length < 8) {
        insights.push('Top device spend pocket: ' + imported.top_device_spend_pocket.key + ' at ' + fmtINR(imported.top_device_spend_pocket.value) + '.');
    }
    if (imported.benchmark_positive_count != null && imported.benchmark_negative_count != null && insights.length < 8) {
        insights.push('Operating mix: ' + imported.benchmark_positive_count + ' benchmark-positive vs ' + imported.benchmark_negative_count + ' benchmark-negative ad groups.');
    }
    if (rows && rows.length && insights.length < 8) {
        insights.push('Highest-priority visible row: ' + rows[0].label + ' | ' + rows[0].currentText + '.');
    }
    return insights.slice(0, 8);
}

function buildGooglePausedRevampContext(scan) {
    scan = scan || {};
    var campaignRows = [];
    var adgroupRows = [];
    var adRows = [];
    var assetPlaybook = buildGoogleAppAssetPlaybook(scan || {});
    var campaignSettingsRows = Array.isArray(scan.campaign_settings) ? scan.campaign_settings : [];
    var adgroupSettingsRows = Array.isArray(scan.adgroup_settings) ? scan.adgroup_settings : [];
    var campaignSettingsByName = {};
    var campaignRowSeen = {};
    var adgroupRowSeen = {};

    function normalizeBudgetAmount(value) {
        var num = Number(value);
        return isFinite(num) && num > 0 ? num : null;
    }

    function formatPausedBudget(amount) {
        return amount != null ? fmtINR(Math.round(amount)) : '--';
    }

    function normalizeLookupText(value) {
        return normalizeGoogleJoinText(value || '');
    }

    function getCampaignStatus(row) {
        return normalizeGoogleStatusLabel(
            (row && (row.status || row.campaign_status || row.primary_status || row.campaign_state || row.state)) || ''
        );
    }

    function getAdgroupStatus(row) {
        return normalizeGoogleStatusLabel(
            (row && (row.adgroup_status || row.status || row.ad_status || row.adgroup_state || row.state)) || ''
        );
    }

    function getCampaignBudget(row) {
        return normalizeBudgetAmount(
            row && (row.budget_amount != null ? row.budget_amount : (row.daily_budget != null ? row.daily_budget : (row.campaign_budget_amount != null ? row.campaign_budget_amount : row.budget || row.amount)))
        );
    }

    function getAdgroupBudget(row) {
        return normalizeBudgetAmount(
            row && (row.budget_amount != null ? row.budget_amount : (row.daily_budget != null ? row.daily_budget : (row.adgroup_budget_amount != null ? row.adgroup_budget_amount : row.budget || row.amount)))
        );
    }

    function getCampaignNameFromRow(row) {
        return row && (row.campaign_name || row.name || row.campaign || row.title || '') || '';
    }

    function getAdgroupNameFromRow(row) {
        return row && (row.adgroup_name || row.adset_name || row.name || row.title || '') || '';
    }

    function getAssetSignalForCampaign(campaignName) {
        var assetKey = normalizeLookupText(campaignName || '') + '|||';
        var direct = assetPlaybook.group_index ? assetPlaybook.group_index[assetKey] : null;
        if (direct && direct.asset_signal) return direct.asset_signal;
        var campaignAssets = (assetPlaybook.top_groups || []).filter(function(row) {
            return normalizeLookupText(row.campaign_name || '') === normalizeLookupText(campaignName || '');
        });
        return campaignAssets.length && campaignAssets[0].asset_signal ? campaignAssets[0].asset_signal : '';
    }

    function getAssetSignalForAdgroup(campaignName, adgroupName) {
        var assetKey = normalizeLookupText(campaignName || '') + '|||' + normalizeLookupText(adgroupName || '');
        var assetGroup = assetPlaybook.group_index ? assetPlaybook.group_index[assetKey] : null;
        return assetGroup && assetGroup.asset_signal ? assetGroup.asset_signal : '';
    }

    campaignSettingsRows.forEach(function(row) {
        var campaignName = getCampaignNameFromRow(row);
        if (!campaignName) return;
        campaignSettingsByName[normalizeLookupText(campaignName)] = row;
    });

    Object.keys(scan.tree || {}).forEach(function(campaignName) {
        var campaign = scan.tree[campaignName] || {};
        var campaignStatus = normalizeGoogleStatusLabel(campaign.settings && campaign.settings.campaign ? campaign.settings.campaign.status : '');
        var campaignTotals = campaign.totals || {};
        campaignRowSeen[normalizeLookupText(campaignName)] = true;
        var campaignPaused = isGooglePausedStatus(campaignStatus);
        var campaignBudget = normalizeBudgetAmount((campaign.settings && campaign.settings.campaign && campaign.settings.campaign.budget_amount) || campaign.budget_amount);
        var campaignRelaunchBudget = campaignBudget != null
            ? (campaignTotals.d6ROAS >= 28 ? campaignBudget : Math.max(Math.round(campaignBudget * 0.7), 1))
            : null;
        var pausedAdgroups = Object.keys(campaign.adsets || {}).map(function(adgroupName) {
            var adgroup = campaign.adsets[adgroupName] || {};
            var adgroupStatus = normalizeGoogleStatusLabel(adgroup.settings && adgroup.settings.adgroup ? adgroup.settings.adgroup.adgroup_status : adgroup.status || '');
            var adgroupPaused = isGooglePausedStatus(adgroupStatus);
            var assetSignal = getAssetSignalForAdgroup(campaignName, adgroupName);
            return {
                campaign_name: campaignName,
                adgroup_name: adgroupName,
                campaign_budget_amount: campaignBudget,
                campaign_relaunch_budget_amount: campaignRelaunchBudget,
                spend_window: Math.round((adgroup.totals && adgroup.totals.spend) || 0),
                d6_roas_window: +Number((adgroup.totals && adgroup.totals.d6ROAS) || 0).toFixed(1),
                signup_cost_window: adgroup.totals && adgroup.totals.signupCost != null ? Math.round(adgroup.totals.signupCost || 0) : null,
                d0_trial_cost_window: adgroup.totals && adgroup.totals.d0TrialCost != null ? Math.round(adgroup.totals.d0TrialCost || 0) : null,
                signups_window: Math.round((adgroup.totals && adgroup.totals.signups) || 0),
                paused_ads: (adgroup.ads || []).filter(function(ad) { return isGooglePausedStatus(normalizeGoogleStatusLabel(ad.ad_status || '')); }).length,
                paused: adgroupPaused,
                asset_signal: assetSignal,
                why: 'Last active window: ' + fmtINR(adgroup.totals && adgroup.totals.spend || 0) + ' spend | D6 ROAS ' + fmtPct((adgroup.totals && adgroup.totals.d6ROAS) || 0) + ' | Signup cost ' + fmtINR(adgroup.totals && adgroup.totals.signupCost || 0) + ' | D0 trial cost ' + fmtINR(adgroup.totals && adgroup.totals.d0TrialCost || 0) + (assetSignal ? ' | Asset: ' + assetSignal : '')
            };
        }).filter(function(item) { return item.paused; }).sort(function(a, b) { return b.spend_window - a.spend_window; });

        if (campaignPaused || pausedAdgroups.length) {
            var campaignWhy = 'Last active window: ' + fmtINR(campaignTotals.spend || 0) + ' spend | D6 ROAS ' + fmtPct(campaignTotals.d6ROAS || 0) + ' | Signup cost ' + fmtINR(campaignTotals.signupCost || 0) + ' | D0 trial cost ' + fmtINR(campaignTotals.d0TrialCost || 0);
            var campaignAssetSignal = pausedAdgroups.length && pausedAdgroups[0].asset_signal ? pausedAdgroups[0].asset_signal : '';
            campaignRows.push({
                campaign_name: campaignName,
                campaign_budget_amount: campaignBudget,
                campaign_relaunch_budget_amount: campaignRelaunchBudget,
                spend_window: Math.round(campaignTotals.spend || 0),
                d6_roas_window: +Number(campaignTotals.d6ROAS || 0).toFixed(1),
                signup_cost_window: campaignTotals.signupCost != null ? Math.round(campaignTotals.signupCost || 0) : null,
                d0_trial_cost_window: campaignTotals.d0TrialCost != null ? Math.round(campaignTotals.d0TrialCost || 0) : null,
                signups_window: Math.round(campaignTotals.signups || 0),
                paused_adgroups: pausedAdgroups.length,
                recommendation: (campaignTotals.d6ROAS || 0) >= 28 ? 'RELAUNCH' : ((campaignTotals.d6ROAS || 0) >= 15 && (campaignTotals.signupCost || 0) < 1000 ? 'TEST RELAUNCH' : 'KEEP PAUSED'),
                budget_text: campaignRelaunchBudget != null ? 'Restart campaign at ' + formatPausedBudget(campaignRelaunchBudget) + '/day' : 'No budget recommendation',
                next_step: campaignRelaunchBudget != null ? 'Restart this campaign at ' + formatPausedBudget(campaignRelaunchBudget) + '/day' : 'Keep this campaign paused',
                asset_signal: campaignAssetSignal,
                why_text: campaignWhy + (campaignAssetSignal ? ' | Asset: ' + campaignAssetSignal : ''),
                basis: campaignWhy
            });
        }

        pausedAdgroups.forEach(function(adgroup) {
            adgroupRowSeen[normalizeLookupText(adgroup.campaign_name) + '|||' + normalizeLookupText(adgroup.adgroup_name)] = true;
            adgroupRows.push({
                campaign_name: adgroup.campaign_name,
                adgroup_name: adgroup.adgroup_name,
                campaign_budget_amount: adgroup.campaign_budget_amount,
                campaign_relaunch_budget_amount: adgroup.campaign_relaunch_budget_amount,
                spend_window: adgroup.spend_window,
                d6_roas_window: adgroup.d6_roas_window,
                signup_cost_window: adgroup.signup_cost_window,
                d0_trial_cost_window: adgroup.d0_trial_cost_window,
                signups_window: adgroup.signups_window,
                paused_ads: adgroup.paused_ads,
                recommendation: adgroup.d6_roas_window >= 28 ? 'RELAUNCH' : (adgroup.d6_roas_window >= 15 && (adgroup.signup_cost_window || 0) < 800 ? 'TEST RELAUNCH' : 'KEEP PAUSED'),
                budget_text: adgroup.campaign_relaunch_budget_amount != null ? 'Use campaign restart budget ' + formatPausedBudget(adgroup.campaign_relaunch_budget_amount) + '/day' : 'Inherit campaign budget',
                next_step: adgroup.campaign_relaunch_budget_amount != null ? 'Restart this ad group with the parent campaign at ' + formatPausedBudget(adgroup.campaign_relaunch_budget_amount) + '/day' : 'Keep this ad group paused',
                why_text: adgroup.why,
                basis: adgroup.why
            });
        });
    });

    campaignSettingsRows.forEach(function(row) {
        var campaignName = getCampaignNameFromRow(row);
        var key = normalizeLookupText(campaignName);
        if (!campaignName || campaignRowSeen[key]) return;
        var campaignStatus = getCampaignStatus(row);
        if (!isGooglePausedStatus(campaignStatus)) return;
        var campaignBudget = getCampaignBudget(row);
        var campaignRelaunchBudget = campaignBudget != null ? Math.max(Math.round(campaignBudget * 0.7), 1) : null;
        var relatedAdgroups = adgroupSettingsRows.filter(function(adgroupRow) {
            return normalizeLookupText(getCampaignNameFromRow(adgroupRow)) === key && isGooglePausedStatus(getAdgroupStatus(adgroupRow));
        });
        var relatedAssetSignal = relatedAdgroups.length ? getAssetSignalForAdgroup(campaignName, getAdgroupNameFromRow(relatedAdgroups[0])) : getAssetSignalForCampaign(campaignName);
        campaignRowSeen[key] = true;
        campaignRows.push({
            campaign_name: campaignName,
            campaign_budget_amount: campaignBudget,
            campaign_relaunch_budget_amount: campaignRelaunchBudget,
            spend_window: Math.round(Number(row.spend || row.total_spend || row.campaign_spend || 0) || 0),
            d6_roas_window: +Number(row.d6ROAS || row.d6_roas || row.d6_overall_roas || row.d6_overall_con || 0).toFixed(1),
            signup_cost_window: row.signupCost != null ? Math.round(row.signupCost || 0) : null,
            d0_trial_cost_window: row.d0TrialCost != null ? Math.round(row.d0TrialCost || 0) : null,
            signups_window: Math.round(Number(row.signups || row.total_signups || 0) || 0),
            paused_adgroups: relatedAdgroups.length,
            recommendation: campaignRelaunchBudget != null ? 'TEST RELAUNCH' : 'KEEP PAUSED',
            budget_text: campaignRelaunchBudget != null ? 'Restart campaign at ' + formatPausedBudget(campaignRelaunchBudget) + '/day' : 'No budget recommendation',
            next_step: campaignRelaunchBudget != null ? 'Restart this campaign at ' + formatPausedBudget(campaignRelaunchBudget) + '/day and watch signup / trial cost first' : 'Keep this campaign paused',
            asset_signal: relatedAssetSignal,
            why_text: 'Paused in settings | Configured budget ' + (campaignBudget != null ? formatPausedBudget(campaignBudget) : '--') + (relatedAssetSignal ? ' | Asset: ' + relatedAssetSignal : '') + ' | No active tree window available',
            basis: 'Paused in settings | Configured budget ' + (campaignBudget != null ? formatPausedBudget(campaignBudget) : '--') + ' | No active tree window available'
        });
    });

    adgroupSettingsRows.forEach(function(row) {
        var campaignName = getCampaignNameFromRow(row);
        var adgroupName = getAdgroupNameFromRow(row);
        var key = normalizeLookupText(campaignName) + '|||' + normalizeLookupText(adgroupName);
        if (!campaignName || !adgroupName || adgroupRowSeen[key]) return;
        var adgroupStatus = getAdgroupStatus(row);
        if (!isGooglePausedStatus(adgroupStatus)) return;
        var parentCampaignRow = campaignSettingsByName[normalizeLookupText(campaignName)] || null;
        var campaignBudget = getCampaignBudget(parentCampaignRow) || getCampaignBudget(row) || null;
        var adgroupBudget = getAdgroupBudget(row);
        var restartBudget = campaignBudget != null ? Math.max(Math.round(campaignBudget * 0.7), 1) : (adgroupBudget != null ? Math.max(Math.round(adgroupBudget * 0.7), 1) : null);
        var relatedAssetSignal = getAssetSignalForAdgroup(campaignName, adgroupName);
        adgroupRowSeen[key] = true;
        adgroupRows.push({
            campaign_name: campaignName,
            adgroup_name: adgroupName,
            campaign_budget_amount: campaignBudget,
            campaign_relaunch_budget_amount: restartBudget,
            spend_window: Math.round(Number(row.spend || row.total_spend || row.adgroup_spend || 0) || 0),
            d6_roas_window: +Number(row.d6ROAS || row.d6_roas || row.d6_overall_roas || row.d6_overall_con || 0).toFixed(1),
            signup_cost_window: row.signupCost != null ? Math.round(row.signupCost || 0) : null,
            d0_trial_cost_window: row.d0TrialCost != null ? Math.round(row.d0TrialCost || 0) : null,
            signups_window: Math.round(Number(row.signups || row.total_signups || 0) || 0),
            paused_ads: Number(row.paused_ads || row.pausedAds || 0) || 0,
            recommendation: restartBudget != null ? 'TEST RELAUNCH' : 'KEEP PAUSED',
            budget_text: restartBudget != null ? 'Use parent campaign restart budget ' + formatPausedBudget(restartBudget) + '/day' : 'Inherit campaign budget',
            next_step: restartBudget != null ? 'Restart this ad group at ' + formatPausedBudget(restartBudget) + '/day and watch signup / trial cost first' : 'Keep this ad group paused',
            why_text: 'Paused in settings | Configured budget ' + (adgroupBudget != null ? formatPausedBudget(adgroupBudget) : '--') + (relatedAssetSignal ? ' | Asset: ' + relatedAssetSignal : '') + ' | No active tree window available',
            basis: 'Paused in settings | Configured budget ' + (adgroupBudget != null ? formatPausedBudget(adgroupBudget) : '--') + ' | No active tree window available',
            asset_signal: relatedAssetSignal
        });
    });

    (scan.ads || []).forEach(function(ad) {
        var status = normalizeGoogleStatusLabel(ad.ad_status || '');
        if (!isGooglePausedStatus(status)) return;
        var wow = ad && ad._wow ? ad._wow : {};
        var historicalRoas = wow.maturedD6ROAS != null ? wow.maturedD6ROAS : (ad.d6ROAS != null ? ad.d6ROAS : 0);
        adRows.push({
            campaign_name: ad.campaign_name || '--',
            adgroup_name: ad.adgroup_name || ad.adset_name || '--',
            ad_name: ad.ad_name || ad.ad_id || '--',
            campaign_budget_amount: null,
            campaign_relaunch_budget_amount: null,
            spend_window: Math.round(ad.spend || 0),
            d6_roas_window: +Number(historicalRoas || 0).toFixed(1),
            signup_cost_window: ad.signupCost != null ? Math.round(ad.signupCost || 0) : null,
            d0_trial_cost_window: ad.d0TrialCost != null ? Math.round(ad.d0TrialCost || 0) : null,
            signups_window: Math.round(ad.signups || 0),
            recommendation: historicalRoas >= 28 ? 'RELAUNCH' : (historicalRoas >= 15 && (ad.signupCost || 0) < 800 ? 'TEST RELAUNCH' : 'KEEP PAUSED'),
            budget_text: 'Use parent campaign budget',
            next_step: historicalRoas >= 28 ? 'Restart this ad with the parent campaign budget' : 'Keep this ad paused',
            why_text: 'Last active window: ' + fmtINR(ad.spend || 0) + ' spend | D6 ROAS ' + fmtPct(historicalRoas || 0) + ' | Signup cost ' + fmtINR(ad.signupCost || 0) + ' | D0 trial cost ' + fmtINR(ad.d0TrialCost || 0),
            basis: 'Last active window: ' + fmtINR(ad.spend || 0) + ' spend | D6 ROAS ' + fmtPct(historicalRoas || 0) + ' | Signup cost ' + fmtINR(ad.signupCost || 0)
        });
    });

    campaignRows.sort(function(a, b) { return b.spend_window - a.spend_window; });
    adgroupRows.sort(function(a, b) { return b.spend_window - a.spend_window; });
    adRows.sort(function(a, b) { return b.spend_window - a.spend_window; });

    return {
        summary: {
            paused_campaigns: campaignRows.length,
            paused_adgroups: adgroupRows.length,
            paused_ads: adRows.length,
            relaunch_candidates: campaignRows.filter(function(row) { return /RELAUNCH|TEST RELAUNCH/.test(row.recommendation); }).length +
                adgroupRows.filter(function(row) { return /RELAUNCH|TEST RELAUNCH/.test(row.recommendation); }).length +
                adRows.filter(function(row) { return /RELAUNCH|TEST RELAUNCH/.test(row.recommendation); }).length
        },
        campaign_rows: campaignRows.slice(0, 6),
        adgroup_rows: adgroupRows.slice(0, 8),
        ad_rows: adRows.slice(0, 8)
    };
}

function buildGooglePausedRevampRows(scan) {
    var context = buildGooglePausedRevampContext(scan);
    var rows = [];
    (context.campaign_rows || []).forEach(function(row) {
        rows.push({
            label: row.campaign_name,
            statusText: 'Paused campaign',
            prevText: 'Last active D6 ROAS ' + fmtPct(row.d6_roas_window || 0),
            currentText: row.recommendation,
            budgetText: row.budget_text || row.budgetText || '--',
            nextStepText: row.next_step || row.budget_text || row.budgetText || '--',
            whyText: row.why_text || row.whyText || row.basis || '',
            assetSignalText: row.asset_signal || '',
            deltaText: 'Spend ' + fmtINR(row.spend_window || 0) + ' | Signups ' + fmtNum(row.signups_window || 0),
            spendText: fmtINR(row.spend_window || 0)
        });
    });
    (context.adgroup_rows || []).forEach(function(row) {
        rows.push({
            label: row.campaign_name + ' → ' + row.adgroup_name,
            statusText: 'Paused ad group',
            prevText: 'Last active D6 ROAS ' + fmtPct(row.d6_roas_window || 0),
            currentText: row.recommendation,
            budgetText: row.budget_text || row.budgetText || '--',
            nextStepText: row.next_step || row.budget_text || row.budgetText || '--',
            whyText: row.why_text || row.whyText || row.basis || '',
            assetSignalText: row.asset_signal || '',
            deltaText: 'Spend ' + fmtINR(row.spend_window || 0) + ' | Signups ' + fmtNum(row.signups_window || 0),
            spendText: fmtINR(row.spend_window || 0)
        });
    });
    (context.ad_rows || []).forEach(function(row) {
        rows.push({
            label: row.campaign_name + ' → ' + row.adgroup_name + ' → ' + row.ad_name,
            statusText: 'Paused ad',
            prevText: 'Last active D6 ROAS ' + fmtPct(row.d6_roas_window || 0),
            currentText: row.recommendation,
            budgetText: row.budget_text || row.budgetText || '--',
            nextStepText: row.next_step || row.budget_text || row.budgetText || '--',
            whyText: row.why_text || row.whyText || row.basis || '',
            deltaText: 'Spend ' + fmtINR(row.spend_window || 0) + ' | Signups ' + fmtNum(row.signups_window || 0),
            spendText: fmtINR(row.spend_window || 0)
        });
    });
    return { context: context, rows: rows };
}

function buildGoogleRuntimeContext(scan, parsed, prompt) {
    var campaigns = Object.keys(scan.tree || {}).map(function(name) {
        var campaign = scan.tree[name];
        var totals = deriveMetrics(campaign.totals || emptyRaw());
        return {
            name: name,
            campaign_name: name,
            type: campaign.type || '',
            status: normalizeGoogleStatusLabel(campaign.settings && campaign.settings.campaign ? campaign.settings.campaign.status : ''),
            spend: totals.spend || 0,
            spend_window: totals.spend || 0,
            signupCost: totals.signupCost,
            d0TrialCost: totals.d0TrialCost,
            d6ROAS: totals.d6ROAS,
            d6_roas_window: totals.d6ROAS,
            d15ROAS: totals.d15ROAS,
            d30ROAS: totals.d30ROAS,
            recommendation: campaign.recommendation || null
        };
    }).sort(function(a, b) { return (b.spend || 0) - (a.spend || 0); }).slice(0, 12);
    var adgroups = (scan.adsets || []).slice().sort(function(a, b) { return (b.evalSpend || 0) - (a.evalSpend || 0); }).slice(0, 24).map(function(a) {
        return {
            name: a.adset_name,
            campaign_name: a.campaign_name,
            adset_name: a.adset_name,
            adgroup_name: a.adset_name,
            status: normalizeGoogleStatusLabel(a.settings && a.settings.adgroup ? a.settings.adgroup.adgroup_status : ''),
            channel: a.campType,
            basis: a.evalDataLabel,
            spend: a.evalSpend || 0,
            spend_window: a.evalSpend || 0,
            signups: a.evalSignups || 0,
            d0TrialCost: a.d0TrialCost,
            signupCost: a.signupCost,
            d6ROAS: a.d6ROAS,
            d6_roas_window: a.d6ROAS,
            d15ROAS: a.d15ROAS,
            d30ROAS: a.d30ROAS,
            recommendation: a.recommendation || null,
            searchAudit: a.searchAudit || null,
            settingsAudit: a.settingsAudit || null
        };
    });
    var ads = (scan.ads || []).slice().sort(function(a, b) { return (b.ad_spend || 0) - (a.ad_spend || 0); }).slice(0, 20).map(function(ad) {
        return {
            name: ad.ad_name || ad.asset_name || ad.ad_id,
            campaign_name: ad.campaign_name,
            adset_name: ad.adgroup_name,
            adgroup_name: ad.adgroup_name,
            ad_id: ad.ad_id,
            status: ad.ad_status,
            spend: ad.ad_spend,
            spend_window: ad.ad_spend,
            ctr: ad.ad_ctr,
            cpc: ad.ad_cpc,
            cpa: ad.ad_cpa,
            d6_roas_window: ad.ad_roas_d6,
            asset_label: ad.asset_performance_label,
            adAudit: ad.adAudit || null
        };
    });
    var campaignSettingsAudits = buildGoogleCampaignSettingsAudits(scan);
    var adgroupSettingsAudits = buildGoogleAdgroupSettingsAudits(scan);
    var adHealthAudits = buildGoogleAdHealthAudits(scan);
    var breakdownActionRecommendations = buildGoogleBreakdownActionRecommendations(scan);
    var advancedTrendIntelligence = buildGoogleAdvancedTrendIntelligence(scan);
    var pausedRevampContext = buildGooglePausedRevampContext(scan);
    var learningGovernor = buildGoogleLearningGovernor(scan);
    var historicalWinnerLibrary = buildGoogleHistoricalWinnerLibrary(scan);
    var signalAvailability = buildGoogleSignalAvailability(scan);
    var dataIntegrityGate = {
        safe_for_actioning: !!((scan.integrity || {}).weightedMedianCoherent),
        provisional_only: !((scan.integrity || {}).weightedMedianCoherent),
        entity_match_rate_pct: Math.round((scan.integrity || {}).adCoveragePct || 0),
        spend_match_rate_pct: Math.round((scan.integrity || {}).spendCoveragePct || 0),
        fresh_status_verified_pct: Math.round((scan.integrity || {}).freshStatusPct || 0),
        daily_row_match_rate_pct: Math.round((scan.integrity || {}).adCoveragePct || 0),
        warnings: ((scan.optimizerLoop && scan.optimizerLoop.warnings) || []).slice(0, 3)
    };
    return {
        platform: 'google',
        session_id: 'google-optimizer-' + Date.now(),
        run_timestamp: new Date().toISOString(),
        session_mode: parsed.mode,
        command_type: parsed.command_type,
        user_request: prompt,
        date_range: scan.date_range,
        request_scope: {
            target_type: (parsed.target && parsed.target.type) || 'account',
            target_query: (parsed.target && parsed.target.query) || '',
            audience_filter: 'all',
            status_filter: parsed.statusFilter || 'all'
        },
        integrity: scan.integrity,
        benchmarks: scan.benchmarks,
        settings_coverage: scan.settingsCoverage,
        summary: scan.summary,
        performance_summary: {
            selected_window: {
                spend: Math.round((scan.evaluatedTotals || {}).spend || 0),
                impressions: Math.round((scan.evaluatedTotals || {}).impressions || 0),
                clicks: Math.round((scan.evaluatedTotals || {}).clicks || 0),
                google_conversions: Math.round((scan.evaluatedTotals || {}).installs || 0),
                signups: Math.round((scan.evaluatedTotals || {}).signups || 0),
                d0_trial: Math.round((scan.evaluatedTotals || {}).d0_trial || 0),
                d6: Math.round((scan.evaluatedTotals || {}).d6Con || (scan.evaluatedTotals || {}).d6 || 0),
                cpi: (scan.evaluatedTotals || {}).cpi != null ? Math.round((scan.evaluatedTotals || {}).cpi) : null,
                signup_cost: (scan.evaluatedTotals || {}).signupCost != null ? Math.round((scan.evaluatedTotals || {}).signupCost) : null,
                d0_trial_cost: (scan.evaluatedTotals || {}).d0TrialCost != null ? Math.round((scan.evaluatedTotals || {}).d0TrialCost) : null,
                d6_cac: (scan.evaluatedTotals || {}).d6CAC != null ? Math.round((scan.evaluatedTotals || {}).d6CAC) : null,
                d6_roas: (scan.evaluatedTotals || {}).d6ROAS != null ? +((scan.evaluatedTotals || {}).d6ROAS).toFixed(1) : null,
                d15_roas: (scan.evaluatedTotals || {}).d15ROAS != null ? +((scan.evaluatedTotals || {}).d15ROAS).toFixed(1) : null,
                d30_roas: (scan.evaluatedTotals || {}).d30ROAS != null ? +((scan.evaluatedTotals || {}).d30ROAS).toFixed(1) : null
            },
            benchmark_summary: {
                median_d6_roas: +(scan.benchmarks && scan.benchmarks.d6ROAS || 0).toFixed(1),
                median_d15_roas: +(scan.benchmarks && scan.benchmarks.d15ROAS || 0).toFixed(1),
                median_d30_roas: +(scan.benchmarks && scan.benchmarks.d30ROAS || 0).toFixed(1),
                median_signup_cost: Math.round(scan.benchmarks && scan.benchmarks.signupCost || 0),
                median_d0_trial_cost: Math.round(scan.benchmarks && scan.benchmarks.d0TrialCost || 0),
                median_cpi: Math.round(scan.benchmarks && scan.benchmarks.cpi || 0),
                median_d6_cac: Math.round(scan.benchmarks && scan.benchmarks.d6CAC || 0)
            },
            maturity_mix: {
                matured_adgroups: scan.summary && scan.summary.matured_adgroups || 0,
                early_adgroups: scan.summary && scan.summary.early_adgroups || 0
            },
            data_integrity_gate: dataIntegrityGate
        },
        skill_contracts: buildGoogleSkillContracts(),
        playbook_rules: buildGooglePlaybookRules(),
        imported_audit_summary: buildGoogleImportedAuditSummary(scan),
        google_operator_audit: {
            campaign_settings_audits: campaignSettingsAudits,
            adgroup_settings_audits: adgroupSettingsAudits,
            ad_health_audits: adHealthAudits
        },
        campaign_settings_audits: campaignSettingsAudits,
        adgroup_settings_audits: adgroupSettingsAudits,
        ad_health_audits: adHealthAudits,
        breakdown_action_recommendations: breakdownActionRecommendations,
        advanced_trend_intelligence: advancedTrendIntelligence,
        paused_revamp_context: pausedRevampContext,
        learning_governor: learningGovernor,
        weekly_trend_summary: {
            learning_spend_share_pct: learningGovernor.learning_spend_share_pct,
            edit_policy: learningGovernor.edit_policy,
            trial_learning_note: learningGovernor.trial_learning_note,
            trend_breadth_note: learningGovernor.trend_breadth_note
        },
        historical_winner_library: historicalWinnerLibrary,
        signal_availability: signalAvailability,
        campaigns: campaigns,
        ad_sets: adgroups,
        ads: ads,
        app_asset_performance: scan && scan.app_asset_performance ? scan.app_asset_performance : null,
        top_campaigns: campaigns,
        top_adgroups: adgroups,
        top_ads: ads,
        deterministic_action_rows: buildGoogleActionRows(scan),
        data_integrity_gate: dataIntegrityGate
    };
}

function buildGoogleApexPrompts(runtimeContext) {
    var mode = runtimeContext && runtimeContext.session_mode ? runtimeContext.session_mode : 'daily_review';
    var commandType = runtimeContext && runtimeContext.command_type ? runtimeContext.command_type : 'daily_optimisation';
    var modeConfig = getGoogleApexModeConfig(mode);
    var systemPrompt = [
        'You are an expert performance marketer with 20+ years of experience working in a financial advisory brand.',
        'You are APEX for this Google Ads account.',
        'Use the same operating rigor as the Meta optimizer: command first, action first, cautious with learning, strict with benchmarks, and explicit about basis and confidence.',
        'For the newest week, use D0 trial cost and signup cost as the leading signals. Use D15 and D30 ROAS as the real quality signals once the window matures.',
        'Campaign and ad group funnel economics come from the joined Google + Metabase contract. Ad-level economics remain Google-only.',
        'Respect mature versus early basis exactly. If a row says mature basis, treat it as excluding the last 7 days. If it says early or fallback, say so directly.',
        'Search campaigns require search-term, match-type, quality-score, and impression-share reasoning. PMax, Display, Video, and UAC need channel-specific reasoning.',
        'Read week-on-week trends, campaign hierarchy, search-term drift, geo/device/network mix, and asset-group quality as first-class account context.',
        'Use app asset performance as a first-class evidence layer for ad-group and ad-level creative diagnosis. Description, Headline, App deep link, YouTube video, and Horizontal image should map to explicit next actions.',
        'For Google, a weak previous week can be expected while the ad group is still trial-heavy or inside the learning window. Do not treat last week ROAS alone as failure if D0 trial cost and signups are still evolving; explain the learning caveat and inspect structure before a hard cut.',
        'When SESSION_MODE is paused_revamp, focus only on paused campaigns, ad groups, and ads. Use the last active months performance window, rank relaunch candidates, and keep Google budget moves at campaign level only.',
        'campaign_settings_audits, adgroup_settings_audits, ad_health_audits, breakdown_action_recommendations, advanced_trend_intelligence, learning_governor, historical_winner_library, paused_revamp_context, and signal_availability are deterministic operator inputs. Use them directly instead of replacing them with vague wording.',
        '- paused_revamp_context is a deterministic operator layer. Use it to rank paused campaigns, ad groups, and ads for relaunch. Google account and campaign totals still come from the full selected window; only drilldown views hide paused rows.',
        'Use only the runtime context. Do not invent missing data.',
        'Return strict JSON with keys title, summary, morning_brief, rows, insights, what_to_do_right_now, what_to_leave_alone, watch_list, campaign_insights.',
        'morning_brief must be an object with market_read, account_pulse, what_to_do_right_now, what_to_leave_alone, campaign_insights, this_weeks_moves, and thirty_day_horizon.',
        'rows must be an array of objects with keys: label, statusText, prevText, currentText, deltaText, spendText.',
        'what_to_do_right_now must be an array of objects with title, why, do, do_not.',
        'what_to_leave_alone must be an array of objects with title, reason, watch_for.',
        'campaign_insights must be an array of objects with campaign_name, status, trend, adset_insights, creative_insights, key_question.',
        'this_weeks_moves should prefer objects with title.',
        'watch_list may be flat lines or objects with title.',
        'insights should stay concise flat lines.'
    ].join('\n');
    var userPrompt = [
        'SESSION_MODE: ' + mode,
        'CANONICAL_COMMAND: ' + commandType,
        'MODE_OBJECTIVE: ' + modeConfig.objective,
        'MODE_INSTRUCTION: ' + modeConfig.command,
        '',
        'USER_COMMAND:',
        runtimeContext.user_request || '',
        '',
        'RUNTIME_CONTEXT:',
        JSON.stringify(runtimeContext),
        '',
        'Rules:',
        '- If the command is full_account_review or daily_optimisation, act like a real optimizer and tell the operator what to do today.',
        '- Put the best action rows first.',
        '- Always mention the selected date range and matured/early basis in the summary.',
        '- If integrity or coverage is weak, downgrade confidence, not usefulness.',
        '- For account-wide prompts, cover campaign and ad group structure, search-term quality, geo/device/network mix, asset-group quality, and ad-level Google-only creative/asset notes where relevant.',
        '- For deep_dive, explain settings, search structure, channel logic, and best next moves.',
        '- For underperformance_rca, focus on why performance is limited before giving broad actions.',
        '- Always populate what_to_do_right_now, what_to_leave_alone, campaign_insights, and watch_list when the account scope is broader than a single entity.',
        '- Make operator actions specific and exact: pause this ad group, reduce this campaign budget by 15-20%, restart this paused campaign at 70% of prior budget, swap this headline, reuse this description, use this deep link, drop this image-first variant, change bid/target, negative the query, or keep budget flat.',
        '- Every output row should carry entity name, exact action, exact budget when relevant, one-line why, one-line next step, and evidence source. Do not use vague summary language unless it is the lead-in to an action row.',
        '- For Google, if the previous week looks weak while the ad group is still trial-heavy or in the learning window, explain that caveat and prioritize D0 trial cost, signups, and the structural signals before a hard cut.',
        '- When paused_revamp is requested, inspect only paused campaigns, ad groups, and ads. Use the last active window as the evidence base, rank relaunch candidates, and never recommend ad group budget shifts; Google budget moves stay at campaign level.',
        '- Do not return vague lines like "optimize settings" unless you also name the exact setting family to inspect.',
        '- If deterministic audits already name the issue, reuse that language and only add interpretation where it changes the decision.'
    ].join('\n');
    return { system: systemPrompt, user: userPrompt };
}

function buildGoogleDeterministicBaseResult(scan, parsed) {
    var rows = buildGoogleActionRows(scan);
    var structuredBrief = buildGoogleStructuredMorningBrief(scan);
    if (parsed.command_type === 'creative_brief') rows = buildGoogleCreativeBriefRows(scan);
    else if (parsed.command_type === 'underperformance_rca' || parsed.command_type === 'change_impact_analysis') rows = buildGoogleRiskRows(scan);
    else if (parsed.command_type === 'scale_check') rows = buildGoogleDoNotTouchRows(scan).concat(buildGoogleActionRows(scan).slice(0, 6)).slice(0, 12);
    else if (parsed.command_type === 'paused_revamp') rows = buildGooglePausedRevampRows(scan).rows;
    else if (parsed.command_type === 'queue_validation') rows = buildGoogleActionRows(scan).filter(function(row) {
        return /P1|P2|PAUSE|SCALE|REDUCE BUDGET|OPTIMIZE/.test(String(row.currentText || ''));
    }).slice(0, 12);
    var summaryParts = [
        'Basis: ' + ((scan.date_range || {}).since || '--') + ' → ' + ((scan.date_range || {}).until || '--'),
        ((scan.summary && scan.summary.matured_adsets) || 0) + ' matured / ' + ((scan.summary && scan.summary.early_adsets) || 0) + ' early ad groups',
        'Spend coverage ' + fmtPct(scan.integrity && scan.integrity.spendCoveragePct)
    ];
    if (parsed.command_type === 'predict_30_days') {
        var d15 = benchmarksValue(scan.benchmarks, 'd15ROAS_median');
        var d30 = benchmarksValue(scan.benchmarks, 'd30ROAS_median');
        summaryParts.push('Forward medians D15 ' + fmtPct(d15) + ' | D30 ' + fmtPct(d30));
    }
    if (parsed.command_type === 'underperformance_rca') summaryParts.push('Search/QS/settings pressure prioritized before broad cuts');
    if (parsed.command_type === 'scale_check') summaryParts.push('Scale only benchmark-positive and structurally clean pockets');
    if (parsed.command_type === 'paused_revamp') summaryParts.push('Paused relaunch candidates ranked on last active performance; campaign budget moves stay at campaign level only');
    if (parsed.command_type === 'deep_dive') summaryParts.push('Campaign, ad group, and Google-only ad detail reviewed together');
    var insights = buildGoogleCommandInsights(scan, parsed, rows);
    var doNow = structuredBrief.what_to_do_right_now;
    var leaveAlone = structuredBrief.what_to_leave_alone;
    var watchList = buildGoogleRiskRows(scan).slice(0, 4).map(function(row) {
        return row.label + ' | ' + row.currentText + ' | ' + row.deltaText;
    });
    var campaignInsights = structuredBrief.campaign_insights;
    var marketRead = {
        summary: parsed.command_type === 'full_account_review' || parsed.command_type === 'morning_account_review'
            ? 'Google account wide review with trial-first recent-week signals, mature-window ROAS, and week-on-week trend as the basis where available.'
            : 'Focus on the requested Google slice with benchmark and structure context.',
        signals: [
            'Spend coverage ' + fmtPct((scan.integrity || {}).spendCoveragePct),
            'Fresh status ' + fmtPct((scan.integrity || {}).freshStatusPct),
            'Weighted median coherence ' + ((scan.integrity || {}).weightedMedianCoherent ? 'PASS' : 'WATCH')
        ]
    };
    var accountPulse = {
        summary: 'Spend ' + fmtINR((scan.evaluatedTotals || {}).spend || 0) + ' | D6 ROAS ' + fmtPct((scan.evaluatedTotals || {}).d6ROAS || 0) + ' | Signup cost ' + fmtINR((scan.evaluatedTotals || {}).signupCost || 0),
        signals: [
            (scan.summary && scan.summary.matured_adsets ? scan.summary.matured_adsets : 0) + ' mature ad groups / ' + (scan.summary && scan.summary.early_adsets ? scan.summary.early_adsets : 0) + ' early ad groups',
            'Ad group coverage ' + fmtPct((scan.integrity || {}).adCoveragePct),
            'Search pressure count ' + (buildGoogleImportedAuditSummary(scan).search_pressure_count || 0)
        ]
    };
    return {
        title: parsed.command_type === 'morning_account_review' ? 'Google morning account review' :
            parsed.command_type === 'underperformance_rca' ? 'Why performance is limited' :
            parsed.command_type === 'deep_dive' ? 'Google account deep dive' :
            parsed.command_type === 'scale_check' ? 'Google scale check' :
            parsed.command_type === 'queue_validation' ? 'Google queue validation' :
            parsed.command_type === 'predict_30_days' ? 'Google 30-day forecast read' :
            parsed.command_type === 'creative_brief' ? 'Google creative brief' :
            parsed.command_type === 'change_impact_analysis' ? 'Google change impact analysis' :
            parsed.command_type === 'paused_revamp' ? 'Google paused revamp' :
            parsed.command_type === 'full_account_review' ? 'Google daily analysis' : 'Google optimizer plan',
        basis: ((scan.date_range || {}).since || '--') + ' → ' + ((scan.date_range || {}).until || '--'),
        current_slice: 'All | ' + titleCaseWords(String(parsed && parsed.statusFilter ? parsed.statusFilter : 'all').replace(/_/g, ' ')),
        summary: summaryParts.join(' | '),
        plan_summary: {
            pause_count: rows.filter(function(row) { return String(row.currentText || '').indexOf('PAUSE') !== -1; }).length,
            reduce_count: rows.filter(function(row) { return String(row.currentText || '').indexOf('REDUCE') !== -1; }).length,
            scale_count: rows.filter(function(row) { return String(row.currentText || '').indexOf('SCALE') !== -1; }).length,
            watch_count: rows.filter(function(row) { return String(row.currentText || '').indexOf('WATCH') !== -1 || String(row.currentText || '').indexOf('MAINTAIN') !== -1; }).length,
            top_priority_action: rows[0] ? (rows[0].currentText + ' — ' + rows[0].label) : 'No priority action',
            total_actions: rows.length
        },
        executive_summary: summaryParts.join(' | '),
        rows: rows,
        insights: insights.slice(0, 8),
        morning_brief: {
            market_read: marketRead,
            account_pulse: accountPulse,
            what_to_do_right_now: doNow,
            what_to_leave_alone: leaveAlone,
            campaign_insights: campaignInsights.slice(0, 5),
            this_weeks_moves: structuredBrief.this_weeks_moves,
            thirty_day_horizon: {
                risks: structuredBrief.thirty_day_horizon.risks,
                opportunities: structuredBrief.thirty_day_horizon.opportunities
            }
        },
        what_to_do_right_now: doNow,
        what_to_leave_alone: leaveAlone,
        watch_list: watchList,
        campaign_insights: campaignInsights,
        optimizer_plan: buildGoogleMetaStylePlan(scan, parsed, {
            summary: summaryParts.join(' | '),
            executive_summary: summaryParts.join(' | '),
            plan_summary: {
                total_actions: rows.length,
                top_priority_action: rows[0] ? (rows[0].currentText + ' — ' + rows[0].label) : 'No priority action'
            },
            morning_brief: {
                market_read: marketRead,
                account_pulse: accountPulse,
                what_to_do_right_now: doNow,
                what_to_leave_alone: leaveAlone,
                campaign_insights: campaignInsights,
                this_weeks_moves: structuredBrief.this_weeks_moves,
                thirty_day_horizon: structuredBrief.thirty_day_horizon
            }
        })
    };
}

function normalizeGoogleActionItems(items, fallbackDoNot) {
    if (!Array.isArray(items)) return [];
    return items.map(function(item) {
        if (item && typeof item === 'object') return item;
        var text = String(item || '').trim();
        if (!text) return null;
        return {
            title: text,
            why: text,
            do: text,
            do_not: fallbackDoNot || 'Do not combine this with another structural change on the same entity today.'
        };
    }).filter(Boolean);
}

function normalizeGoogleLeaveAloneItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map(function(item) {
        if (item && typeof item === 'object') return item;
        var text = String(item || '').trim();
        if (!text) return null;
        return {
            title: text,
            reason: text,
            watch_for: 'Act only if efficiency breaks further.'
        };
    }).filter(Boolean);
}

function normalizeGoogleCampaignInsights(items) {
    if (!Array.isArray(items)) return [];
    return items.map(function(item) {
        if (item && typeof item === 'object') return item;
        var text = String(item || '').trim();
        if (!text) return null;
        return {
            campaign_name: text,
            status: '--',
            trend: text,
            adset_insights: '',
            creative_insights: '',
            key_question: ''
        };
    }).filter(Boolean);
}

function buildGooglePlanActions(scan) {
    var campaignAudits = buildGoogleCampaignSettingsAudits(scan);
    var adgroupAudits = buildGoogleAdgroupSettingsAudits(scan);
    var adHealthAudits = buildGoogleAdHealthAudits(scan);
    function findAdgroupAudit(campaignName, adsetName) {
        return adgroupAudits.find(function(item) {
            return item.campaign_name === campaignName && item.adset_name === adsetName;
        }) || null;
    }
    function findAdHealthAudit(campaignName, adsetName) {
        return adHealthAudits.find(function(item) {
            return item.campaign_name === campaignName && item.adset_name === adsetName;
        }) || null;
    }
    var campaignActions = Object.keys(scan && scan.tree || {}).map(function(name, idx) {
        var campaign = scan.tree[name] || {};
        var totals = deriveMetrics(campaign.totals || emptyRaw());
        var rec = campaign.recommendation || {};
        var audit = campaignAudits.find(function(item) { return item.campaign_name === name; }) || null;
        var actionLabel = String(rec.meta_loop_action || rec.action || (audit && audit.action) || 'WATCH').toUpperCase();
        var actionType = /CUT|REDUCE/.test(actionLabel) ? 'UPDATE_CAMPAIGN_BUDGET' :
            (/SCALE/.test(actionLabel) ? 'UPDATE_CAMPAIGN_BUDGET' : 'MONITOR');
        var category = /CUT|REDUCE/.test(actionLabel) ? 'BUDGET_DECREASE' :
            (/SCALE/.test(actionLabel) ? 'BUDGET_INCREASE' :
            (/CREATIVE_REFRESH/.test(actionLabel) ? 'CREATIVE_REFRESH' : 'MONITOR'));
        return {
            action_id: 'GCAMP-' + String(idx + 1).padStart(3, '0'),
            priority: /CUT|REDUCE|SCALE/.test(actionLabel) ? 'P1' : 'P2',
            priority_label: /CUT|REDUCE|SCALE/.test(actionLabel) ? 'urgent' : 'recommended',
            category: category,
            action_type: actionType,
            entity_type: 'campaign',
            entity_id: campaign.id || '',
            entity_name: name,
            campaign_name: name,
            adset_name: '',
            current_metrics: {
                spend: totals.spend || 0,
                d6_roas: fmtPct(totals.d6ROAS || 0),
                d6_cac: fmtINR(totals.d6CAC || 0),
                signup_cost: fmtINR(totals.signupCost || 0),
                cpi: fmtINR(totals.cpi || 0),
                installs: totals.installs || 0,
                signups: totals.signups || 0,
                d6: totals.d6 || totals.d6Con || 0,
                campaign_status: normalizeGoogleStatusLabel(campaign.settings && campaign.settings.campaign ? campaign.settings.campaign.status : '')
            },
            diagnosis: (audit && audit.reason) || rec.meta_loop_reason || rec.reason || 'Campaign-level review.',
            action_detail: (audit && audit.do_line) || rec.do_line || 'Hold current campaign settings.',
            expected_impact: '--',
            risk: 'Do not stack multiple campaign-wide changes in the same review cycle.',
            success_metric: /SCALE/.test(actionLabel) ? 'Campaign-level D6 ROAS stays healthy while spend expands' : 'Campaign spend efficiency improves on the next review'
        };
    }).filter(function(a) {
        return a.category !== 'MONITOR' || /Needs Attention|Healthy/.test(String(a.diagnosis || ''));
    });
    var adgroupActions = (scan && scan.adsets || []).slice().sort(function(a, b) {
        var order = { P1: 0, P2: 1, P3: 2 };
        var pa = order[(a.recommendation && a.recommendation.priority) || 'P3'];
        var pb = order[(b.recommendation && b.recommendation.priority) || 'P3'];
        if (pa !== pb) return pa - pb;
        return (b.evalSpend || 0) - (a.evalSpend || 0);
    }).slice(0, 18).map(function(a, idx) {
        var rec = a.recommendation || {};
        var audit = findAdgroupAudit(a.campaign_name || '', a.adset_name || a.adgroup_name || '');
        var health = findAdHealthAudit(a.campaign_name || '', a.adset_name || a.adgroup_name || '');
        var action = String(rec.action || 'WATCH').toUpperCase();
        var actionType = 'MONITOR';
        var category = action;
        var actionDetail = rec.do_line || buildGoogleRecommendedDoLine(a, rec.action);
        if (action === 'PAUSE') {
            actionType = 'PAUSE_ADSET';
            category = 'PAUSE';
        } else if (action === 'REDUCE BUDGET') {
            actionType = 'UPDATE_CAMPAIGN_BUDGET';
            category = 'BUDGET_DECREASE';
        } else if (action === 'SCALE') {
            actionType = 'UPDATE_CAMPAIGN_BUDGET';
            category = 'BUDGET_INCREASE';
        } else if (action === 'OPTIMIZE') {
            if (audit && /SEARCH/i.test(audit.action || '')) {
                actionType = 'MONITOR';
                category = 'SEARCH_CLEANUP';
                actionDetail = audit.do_line || actionDetail;
            } else if (audit && /SETTINGS/i.test(audit.action || '')) {
                actionType = 'MONITOR';
                category = 'SETTINGS_FIX';
                actionDetail = audit.do_line || actionDetail;
            } else if (health && health.action === 'CREATIVE_REFRESH') {
                actionType = 'CREATIVE_CHANGE';
                category = 'CREATIVE_REFRESH';
                actionDetail = health.do_line || actionDetail;
            } else {
                actionType = 'MONITOR';
                category = 'OPTIMIZE';
            }
        } else if (action === 'MAINTAIN') {
            actionType = 'MONITOR';
            category = 'HOLD';
        }
        if (health && health.action === 'CREATIVE_REFRESH' && category !== 'PAUSE' && category !== 'BUDGET_INCREASE' && category !== 'BUDGET_DECREASE') {
            category = 'CREATIVE_REFRESH';
            actionType = actionType === 'MONITOR' ? 'CREATIVE_CHANGE' : actionType;
            actionDetail = health.do_line || actionDetail;
        }
        return {
            action_id: 'GACT-' + String(idx + 1).padStart(3, '0'),
            priority: rec.priority || 'P3',
            priority_label: rec.priority === 'P1' ? 'urgent' : (rec.priority === 'P2' ? 'recommended' : 'watch'),
            category: category,
            action_type: actionType,
            entity_type: 'adset',
            entity_id: a.adset_id || a.adgroup_id || '',
            entity_name: a.adset_name || a.adgroup_name || '',
            campaign_name: a.campaign_name || '',
            adset_name: a.adset_name || a.adgroup_name || '',
            current_metrics: {
                spend: a.evalSpend || 0,
                d6_roas: fmtPct(a.d6ROAS || 0),
                d6_cac: fmtINR(a.d6CAC || 0),
                signup_cost: fmtINR(a.signupCost || 0),
                cpi: fmtINR(a.cpi || 0),
                installs: a.evalInstalls || 0,
                signups: a.evalSignups || 0,
                d6: a.evalD6 || 0,
                ad_status: normalizeGoogleStatusLabel(a.settings && a.settings.adgroup ? a.settings.adgroup.adgroup_status : ''),
                campaign_status: normalizeGoogleStatusLabel(a.settings && a.settings.campaign ? a.settings.campaign.status : '')
            },
            diagnosis: (audit && audit.reason) || rec.reason || 'Google optimizer recommendation.',
            action_detail: actionDetail,
            expected_impact: rec.impact || '--',
            risk: rec.do_not || buildGoogleRecommendedDoNot(a, rec.action),
            success_metric: action === 'SCALE' ? 'D6 ROAS holds while volume grows' : (action === 'PAUSE' ? 'Spend leakage stops immediately' : 'Signup cost and D6 ROAS improve over the next review window')
        };
    });
    return campaignActions.concat(adgroupActions).slice(0, 24);
}

function buildGoogleMetaStylePlan(scan, parsed, resultLike) {
    var structuredBrief = buildGoogleStructuredMorningBrief(scan);
    var actions = buildGooglePlanActions(scan);
    var result = resultLike || {};
    var campaignSettingsAudits = buildGoogleCampaignSettingsAudits(scan);
    var adgroupSettingsAudits = buildGoogleAdgroupSettingsAudits(scan);
    var adHealthAudits = buildGoogleAdHealthAudits(scan);
    var breakdownActionRecommendations = buildGoogleBreakdownActionRecommendations(scan);
    var advancedTrendIntelligence = buildGoogleAdvancedTrendIntelligence(scan);
    var learningGovernor = buildGoogleLearningGovernor(scan);
    var signalAvailability = buildGoogleSignalAvailability(scan);
    var optimizerLoop = scan && scan.optimizerLoop ? scan.optimizerLoop : null;
    var brief = result.morning_brief && typeof result.morning_brief === 'object' ? Object.assign({}, result.morning_brief) : {};
    brief.market_read = brief.market_read || {
        posture: 'HOLD AND OPTIMISE',
        summary: result.summary || 'Google account review built on account-specific benchmarks and trend context.',
        signals: [
            'Spend coverage ' + fmtPct((scan.integrity || {}).spendCoveragePct),
            'Fresh status ' + fmtPct((scan.integrity || {}).freshStatusPct),
            'Weighted median coherence ' + ((scan.integrity || {}).weightedMedianCoherent ? 'PASS' : 'WATCH')
        ]
    };
    brief.account_pulse = brief.account_pulse || {
        spend_today: fmtINR((scan.evaluatedTotals || {}).spend || 0),
        roas_7d: fmtPct((scan.evaluatedTotals || {}).d6ROAS || 0),
        cpa_7d: fmtINR((scan.evaluatedTotals || {}).signupCost || 0),
        active_counts: ((scan.summary && scan.summary.total_campaigns) || 0) + ' campaigns · ' + ((scan.summary && scan.summary.total_adsets) || 0) + ' ad groups',
        learning_counts: ((scan.summary && scan.summary.early_adsets) || 0) + ' early / learning'
    };
    brief.what_to_do_right_now = normalizeGoogleActionItems(brief.what_to_do_right_now, 'Do not stack another structural edit on the same entity today.');
    if (!brief.what_to_do_right_now.length) brief.what_to_do_right_now = structuredBrief.what_to_do_right_now;
    brief.what_to_leave_alone = normalizeGoogleLeaveAloneItems(brief.what_to_leave_alone);
    if (!brief.what_to_leave_alone.length) brief.what_to_leave_alone = structuredBrief.what_to_leave_alone;
    brief.campaign_insights = normalizeGoogleCampaignInsights(brief.campaign_insights);
    if (!brief.campaign_insights.length) brief.campaign_insights = structuredBrief.campaign_insights;
    brief.this_weeks_moves = Array.isArray(brief.this_weeks_moves) && brief.this_weeks_moves.length ? brief.this_weeks_moves : structuredBrief.this_weeks_moves;
    brief.thirty_day_horizon = brief.thirty_day_horizon || structuredBrief.thirty_day_horizon;
    return {
        session_mode: parsed && parsed.mode ? parsed.mode : 'daily_review',
        command_type: parsed && parsed.command_type ? parsed.command_type : 'daily_optimisation',
        morning_brief: brief,
        executive_summary: result.executive_summary || result.summary || 'Google optimizer review.',
        plan_summary: result.plan_summary || {
            total_actions: actions.length,
            ads_to_pause: actions.filter(function(a) { return a.action_type === 'PAUSE_ADSET'; }).length,
            ads_to_kill: 0,
            ads_to_scale: actions.filter(function(a) { return a.category === 'SCALE'; }).length,
            adsets_to_pause: actions.filter(function(a) { return a.action_type === 'PAUSE_ADSET'; }).length,
            budget_increases: actions.filter(function(a) { return a.category === 'SCALE'; }).length,
            budget_decreases: actions.filter(function(a) { return a.category === 'REDUCE BUDGET'; }).length,
            estimated_spend_saved_daily: '--',
            estimated_roas_improvement: '--',
            top_priority_action: actions[0] ? (actions[0].campaign_name + ' → ' + actions[0].adset_name + ' → ' + actions[0].category) : 'No priority action'
        },
        actions: actions,
        account_pulse: {
            spend_total: (scan.evaluatedTotals || {}).spend || 0,
            roas_window: (scan.evaluatedTotals || {}).d6ROAS || 0
        },
        data_integrity_gate: {
            safe_for_actioning: !!((scan.integrity || {}).weightedMedianCoherent),
            provisional_only: !((scan.integrity || {}).weightedMedianCoherent),
            entity_match_rate_pct: Math.round((scan.integrity || {}).adCoveragePct || 0),
            spend_match_rate_pct: Math.round((scan.integrity || {}).spendCoveragePct || 0),
            fresh_status_verified_pct: Math.round((scan.integrity || {}).freshStatusPct || 0),
            daily_row_match_rate_pct: Math.round((scan.integrity || {}).adCoveragePct || 0),
            warnings: ((scan.optimizerLoop && scan.optimizerLoop.warnings) || []).slice(0, 3)
        },
        imported_skill_context: null,
        google_operator_audit: {
            campaign_settings_audits: campaignSettingsAudits,
            adgroup_settings_audits: adgroupSettingsAudits,
            ad_health_audits: adHealthAudits
        },
        action_engine: optimizerLoop ? {
            rules_actions: optimizerLoop.rulesActions || [],
            adgroup_actions: optimizerLoop.adgroupActions || [],
            campaign_actions: optimizerLoop.campaignActions || [],
            warnings: optimizerLoop.warnings || []
        } : { rules_actions: [], adgroup_actions: [], campaign_actions: [], warnings: [] },
        campaign_settings_audits: campaignSettingsAudits,
        adgroup_settings_audits: adgroupSettingsAudits,
        ad_health_audits: adHealthAudits,
        breakdown_action_recommendations: breakdownActionRecommendations.length ? breakdownActionRecommendations : structuredBrief.what_to_do_right_now.slice(0, 3).map(function(item) {
            return { title: item.title, why: item.why, do: item.do };
        }),
        advanced_trend_intelligence: advancedTrendIntelligence,
        learning_governor: learningGovernor,
        signal_availability: signalAvailability,
        historical_winner_library: buildGoogleHistoricalWinnerLibrary(scan),
        view_2_diagnosis: {
            performance_shifts: (scan.adsets || []).filter(function(a) { return a._wow && a._wow.trendDirection !== 'stable'; }).slice(0, 4).map(function(a) {
                return { metric: a.campaign_name + ' → ' + a.adset_name, attributed_cause: (a.recommendation && a.recommendation.reason) || '--', confidence: (a.recommendation && a.recommendation.confidence) || 'medium' };
            }),
            delivery_issues: (scan.adsets || []).filter(function(a) { return a.settingsAudit && a.settingsAudit.actions && a.settingsAudit.actions.length; }).slice(0, 4).map(function(a) {
                return { entity_name: a.campaign_name + ' → ' + a.adset_name, detail: a.settingsAudit.actions[0], fix: (a.recommendation && a.recommendation.do_line) || '--' };
            }),
            learning_phase_map: (scan.adsets || []).filter(function(a) { return !a.isMatured; }).slice(0, 4).map(function(a) {
                return { adset_name: a.adset_name, status: 'learning', opt_events_7d: a.evalSignups || 0, fix: 'Avoid broad changes until the 29-day window is complete unless costs break badly.' };
            })
        },
        view_4_forward_plan: {
            scaling_roadmap: structuredBrief.what_to_do_right_now.filter(function(item) { return /SCALE/.test(item.title || ''); }).slice(0, 3).map(function(item) {
                return { adset_name: item.title, budget_today: null, budget_day3: null, budget_day7: null, watch_metric: 'D6 ROAS and signup cost' };
            }),
            creative_tests: (scan.adsets || []).filter(function(a) { return a.recommendation && /OPTIMIZE|REDUCE BUDGET/.test(a.recommendation.action || ''); }).slice(0, 3).map(function(a) {
                return { hypothesis: (a.campaign_name || '--') + ' → ' + (a.adset_name || '--'), format: 'Creative / structure refresh', hook: (a.searchAudit && a.searchAudit.actions && a.searchAudit.actions[0]) || 'Refresh the weakest asset angle', audience: a.campaign_name || '--', daily_budget: null };
            }),
            audience_expansion: [],
            risk_flags: ((scan.optimizerLoop && scan.optimizerLoop.warnings) || []).slice(0, 4)
        },
        operator_answer: result.summary || ''
    };
}

function benchmarksValue(benchmarks, key) {
    return Number(benchmarks && benchmarks[key] || 0);
}

async function executeGoogleOptimizationPlan(scan, prompt) {
    var parsed = parseGooglePromptIntent(scan, prompt);
    if (!parsed.ok) {
        return {
            title: 'Google optimizer query not recognized',
            basis: ((scan.date_range || {}).since || '--') + ' → ' + ((scan.date_range || {}).until || '--'),
            current_slice: 'All | All',
            summary: parsed.clarification || 'Please rephrase the request.'
        };
    }
    var scoped = buildGoogleScopedScanData(scan, parsed.target);
    scoped = buildGoogleFilteredScanData(scoped, { statusFilter: parsed.statusFilter });
    var cacheKey = buildGcBrainCacheKey(scoped, prompt, parsed);
    var cached = getGcBrainCache(cacheKey);
    if (cached) {
        return cached;
    }
    var runtimeContext = buildGoogleRuntimeContext(scoped, parsed, prompt);
    var prompts = buildGoogleApexPrompts(runtimeContext);
    try {
        var res = await fetch('api/optimizer/brain', {
            method: 'POST',
            headers: gcPortalHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
                user_request: prompt,
                runtime_context: runtimeContext
            }),
            signal: AbortSignal.timeout(300000)
        });
        var data = await res.json();
        if (!data.success) throw new Error(data.error || 'Google optimizer brain failed');
        var parsedJson = data.optimizer_plan ? Object.assign({}, data.optimizer_plan, {
            summary: data.optimizer_plan.executive_summary || '',
            use_case: data.use_case || null,
            evidence: data.evidence || null,
            qa: data.qa || null
        }) : (data || {});
        var fallbackBase = buildGoogleDeterministicBaseResult(scoped, parsed);
        var normalizedDoNow = normalizeGoogleActionItems(parsedJson.what_to_do_right_now, 'Do not stack another structural edit on the same entity today.');
        var normalizedLeaveAlone = normalizeGoogleLeaveAloneItems(parsedJson.what_to_leave_alone);
        var normalizedCampaignInsights = normalizeGoogleCampaignInsights(parsedJson.campaign_insights);
        var normalizedBrief = parsedJson.morning_brief && typeof parsedJson.morning_brief === 'object' ? Object.assign({}, parsedJson.morning_brief) : null;
        if (normalizedBrief) {
            normalizedBrief.what_to_do_right_now = normalizeGoogleActionItems(normalizedBrief.what_to_do_right_now, 'Do not stack another structural edit on the same entity today.');
            normalizedBrief.what_to_leave_alone = normalizeGoogleLeaveAloneItems(normalizedBrief.what_to_leave_alone);
            normalizedBrief.campaign_insights = normalizeGoogleCampaignInsights(normalizedBrief.campaign_insights);
        }
        var aiPlan = parsedJson.optimizer_plan && typeof parsedJson.optimizer_plan === 'object'
            ? buildGoogleMetaStylePlan(scoped, parsed, Object.assign({}, parsedJson.optimizer_plan, {
                summary: parsedJson.summary || fallbackBase.summary,
                executive_summary: parsedJson.executive_summary || fallbackBase.executive_summary,
                plan_summary: parsedJson.plan_summary || fallbackBase.plan_summary,
                morning_brief: normalizedBrief || fallbackBase.morning_brief
            }))
            : buildGoogleMetaStylePlan(scoped, parsed, {
                summary: parsedJson.summary || fallbackBase.summary,
                executive_summary: parsedJson.executive_summary || fallbackBase.executive_summary,
                plan_summary: parsedJson.plan_summary || fallbackBase.plan_summary,
                morning_brief: normalizedBrief || fallbackBase.morning_brief
            });
        aiPlan = enrichGoogleCreativeTests(aiPlan, scoped);
        return {
            title: parsedJson.title || fallbackBase.title,
            basis: ((scoped.date_range || {}).since || '--') + ' → ' + ((scoped.date_range || {}).until || '--'),
            current_slice: fallbackBase.current_slice,
            summary: parsedJson.summary || fallbackBase.summary,
            plan_summary: parsedJson.plan_summary || fallbackBase.plan_summary,
            executive_summary: parsedJson.executive_summary || fallbackBase.executive_summary,
            morning_brief: normalizedBrief || fallbackBase.morning_brief,
            rows: Array.isArray(parsedJson.rows) && parsedJson.rows.length ? parsedJson.rows : fallbackBase.rows,
            insights: Array.isArray(parsedJson.insights) && parsedJson.insights.length ? parsedJson.insights : fallbackBase.insights,
            what_to_do_right_now: normalizedDoNow.length ? normalizedDoNow : fallbackBase.what_to_do_right_now,
            what_to_leave_alone: normalizedLeaveAlone.length ? normalizedLeaveAlone : fallbackBase.what_to_leave_alone,
            watch_list: Array.isArray(parsedJson.watch_list) && parsedJson.watch_list.length ? parsedJson.watch_list : fallbackBase.watch_list,
            campaign_insights: normalizedCampaignInsights.length ? normalizedCampaignInsights : fallbackBase.campaign_insights,
            optimizer_plan: aiPlan
        };
    } catch (err) {
        try {
            var response = await fetch('api/ai/analyze', {
                method: 'POST',
                headers: gcPortalHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    system: prompts.system,
                    prompt: prompts.user,
                    max_tokens: 2400
                }),
                signal: AbortSignal.timeout(300000)
            });
            var fallbackData = await response.json();
            if (!fallbackData.success) throw new Error(fallbackData.error || 'Google optimizer plan failed');
            var aiJson = JSON.parse(fallbackData.content || '{}');
            var fallbackBase = buildGoogleDeterministicBaseResult(scoped, parsed);
            var normalizedDoNowFallback = normalizeGoogleActionItems(aiJson.what_to_do_right_now, 'Do not stack another structural edit on the same entity today.');
            var normalizedLeaveAloneFallback = normalizeGoogleLeaveAloneItems(aiJson.what_to_leave_alone);
            var normalizedCampaignInsightsFallback = normalizeGoogleCampaignInsights(aiJson.campaign_insights);
            var normalizedBriefFallback = aiJson.morning_brief && typeof aiJson.morning_brief === 'object' ? Object.assign({}, aiJson.morning_brief) : null;
            if (normalizedBriefFallback) {
                normalizedBriefFallback.what_to_do_right_now = normalizeGoogleActionItems(normalizedBriefFallback.what_to_do_right_now, 'Do not stack another structural edit on the same entity today.');
                normalizedBriefFallback.what_to_leave_alone = normalizeGoogleLeaveAloneItems(normalizedBriefFallback.what_to_leave_alone);
                normalizedBriefFallback.campaign_insights = normalizeGoogleCampaignInsights(normalizedBriefFallback.campaign_insights);
            }
            var aiPlanFallback = aiJson.optimizer_plan && typeof aiJson.optimizer_plan === 'object'
                ? buildGoogleMetaStylePlan(scoped, parsed, Object.assign({}, aiJson.optimizer_plan, {
                    summary: aiJson.summary || fallbackBase.summary,
                    executive_summary: aiJson.executive_summary || fallbackBase.executive_summary,
                    plan_summary: aiJson.plan_summary || fallbackBase.plan_summary,
                    morning_brief: normalizedBriefFallback || fallbackBase.morning_brief
                }))
                : buildGoogleMetaStylePlan(scoped, parsed, {
                    summary: aiJson.summary || fallbackBase.summary,
                    executive_summary: aiJson.executive_summary || fallbackBase.executive_summary,
                    plan_summary: aiJson.plan_summary || fallbackBase.plan_summary,
                    morning_brief: normalizedBriefFallback || fallbackBase.morning_brief
                });
            aiPlanFallback = enrichGoogleCreativeTests(aiPlanFallback, scoped);
            return {
                title: aiJson.title || fallbackBase.title,
                basis: ((scoped.date_range || {}).since || '--') + ' → ' + ((scoped.date_range || {}).until || '--'),
                current_slice: fallbackBase.current_slice,
                summary: (aiJson.summary || fallbackBase.summary) + ' | Optimizer brain fallback used: ' + (err && err.message ? err.message : 'unknown error'),
                plan_summary: aiJson.plan_summary || fallbackBase.plan_summary,
                executive_summary: aiJson.executive_summary || fallbackBase.executive_summary,
                morning_brief: normalizedBriefFallback || fallbackBase.morning_brief,
                rows: Array.isArray(aiJson.rows) && aiJson.rows.length ? aiJson.rows : fallbackBase.rows,
                insights: Array.isArray(aiJson.insights) && aiJson.insights.length ? aiJson.insights : fallbackBase.insights,
                what_to_do_right_now: normalizedDoNowFallback.length ? normalizedDoNowFallback : fallbackBase.what_to_do_right_now,
                what_to_leave_alone: normalizedLeaveAloneFallback.length ? normalizedLeaveAloneFallback : fallbackBase.what_to_leave_alone,
                watch_list: Array.isArray(aiJson.watch_list) && aiJson.watch_list.length ? aiJson.watch_list : fallbackBase.watch_list,
                campaign_insights: normalizedCampaignInsightsFallback.length ? normalizedCampaignInsightsFallback : fallbackBase.campaign_insights,
                optimizer_plan: aiPlanFallback
            };
            setGcBrainCache(cacheKey, finalResultFallback);
            return finalResultFallback;
        } catch (fallbackErr) {
            var finalFallback = {
                title: 'Google optimizer fallback',
                basis: ((scoped.date_range || {}).since || '--') + ' â†’ ' + ((scoped.date_range || {}).until || '--'),
                current_slice: 'All | All',
                summary: 'Fallback after error: ' + (fallbackErr && fallbackErr.message ? fallbackErr.message : (err && err.message ? err.message : 'unknown error')),
                rows: [],
                insights: ['The scan is available; the Google query renderer hit a helper error.'],
                morning_brief: {
                    market_read: { summary: 'Fallback only', signals: [] },
                    account_pulse: { summary: 'Fallback only', signals: [] },
                    what_to_do_right_now: [],
                    what_to_leave_alone: [],
                    campaign_insights: [],
                    this_weeks_moves: [],
                    thirty_day_horizon: { risks: [], opportunities: [] }
                },
                what_to_do_right_now: [],
                what_to_leave_alone: [],
                watch_list: [],
                campaign_insights: []
            };
            setGcBrainCache(cacheKey, finalFallback);
            return finalFallback;
        }
    }
}

async function executeGoogleAiFallback(scan, prompt) {
    var topCampaigns = Object.keys(scan.tree || {}).map(function(name) {
        var campaign = scan.tree[name];
        var totals = deriveMetrics(campaign.totals || emptyRaw());
        return {
            campaign_name: campaign.name || name,
            type: campaign.type || '',
            spend: totals.spend || 0,
            signupCost: totals.signupCost,
            d0TrialCost: totals.d0TrialCost,
            d6ROAS: totals.d6ROAS,
            d15ROAS: totals.d15ROAS,
            d30ROAS: totals.d30ROAS,
            recommendation: campaign.recommendation || null
        };
    }).sort(function(a, b) { return (b.spend || 0) - (a.spend || 0); }).slice(0, 12);
    var topAdgroups = (scan.adsets || []).slice().sort(function(a, b) { return (b.evalSpend || 0) - (a.evalSpend || 0); }).slice(0, 20).map(function(a) {
        return {
            campaign_name: a.campaign_name,
            adgroup_name: a.adset_name,
            campaign_type: a.campType,
            spend: a.evalSpend || 0,
            signupCost: a.signupCost,
            d0TrialCost: a.d0TrialCost,
            d6ROAS: a.d6ROAS,
            d15ROAS: a.d15ROAS,
            d30ROAS: a.d30ROAS,
            searchAudit: a.searchAudit,
            settingsAudit: a.settingsAudit,
            recommendation: a.recommendation || null
        };
    });
    var topAds = (scan.ads || []).slice().sort(function(a, b) { return (b.ad_spend || 0) - (a.ad_spend || 0); }).slice(0, 20).map(function(ad) {
        return {
            campaign_name: ad.campaign_name,
            adgroup_name: ad.adgroup_name,
            ad_id: ad.ad_id,
            ad_type: ad.ad_type,
            status: ad.ad_status,
            spend: ad.ad_spend,
            ctr: ad.ad_ctr,
            cpc: ad.ad_cpc,
            cpa: ad.ad_cpa,
            asset_label: ad.asset_performance_label,
            adAudit: ad.adAudit || null
        };
    });
    var res = await fetch('api/ai/analyze', {
        method: 'POST',
        headers: gcPortalHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
            system: 'You are the Google optimizer brain for this portal. Answer like a performance marketer for Google Ads while preserving deterministic metric contracts. Treat the newest week as trial-first: prioritize signup cost, D0 trial cost, CTR, CPC, and week-on-week direction, and keep D6 ROAS as the mature-window KPI. Keep campaign and ad group funnel economics on the joined Google plus Metabase contract, and keep ad-level analysis Google-only. Return strict JSON with keys title, summary, insights.',
            prompt: 'Google optimizer context:\n' + JSON.stringify({
                date_range: scan.date_range,
                integrity: scan.integrity,
                benchmarks: scan.benchmarks,
                summary: scan.summary,
                top_campaigns: topCampaigns,
                top_adgroups: topAdgroups,
                top_ads: topAds
            }, null, 2) + '\n\nUser question:\n' + prompt,
            max_tokens: 1800
        })
    });
    var data = await res.json();
    if (!data.success) throw new Error(data.error || 'Google AI analysis failed');
    var parsed = JSON.parse(data.content || '{}');
    return {
        title: parsed.title || 'Google optimizer answer',
        basis: (scan.date_range || {}).since + ' â†’ ' + (scan.date_range || {}).until,
        summary: parsed.summary || parsed.answer || 'No answer returned.',
        insights: Array.isArray(parsed.insights) ? parsed.insights : (Array.isArray(parsed.next_steps) ? parsed.next_steps : [])
    };
}

async function executeGoogleOptimizerQueryLegacy(scan, prompt) {
    var parsed = parseGoogleOptimizerQuery(prompt);
    if (!parsed.metric || !parsed.queryType) {
        return {
            title: 'Google optimizer query not recognized',
            basis: (scan.date_range || {}).since + ' → ' + (scan.date_range || {}).until,
            summary: 'This Google query engine handles metric improvement/reduction prompts and week-on-week trend questions for campaign, ad group, and ad levels.'
        };
    }
    if (parsed.entity === 'ad' && parsed.queryType === 'trend') {
        return {
            title: 'Ad-level WoW trends',
            basis: (scan.date_range || {}).since + ' → ' + (scan.date_range || {}).until,
            summary: 'Ad-level week-on-week history now comes from the Google daily ad table, so CTR, CPC, CPA, conversion rate, and creative text can be read together.'
        };
    }

    if (parsed.queryType === 'trend' || parsed.queryType === 'search') {
        var buckets = buildGoogleTrendBuckets(scan, parsed.entity, { matureOnly: parsed.matureOnly });
        var rows = buckets.map(function(bucket) {
            var prev = valueForMetric(bucket.previous, parsed.metric);
            var current = valueForMetric(bucket.current, parsed.metric);
            var spend = (bucket.current && bucket.current.spend || 0) + (bucket.previous && bucket.previous.spend || 0);
            if (prev == null || current == null) return null;
            var deltaPct = null;
            if (prev !== 0) deltaPct = ((current - prev) / Math.abs(prev)) * 100;
            var better = isCostMetric(parsed.metric) ? current < prev : current > prev;
            return {
                label: parsed.entity === 'campaign' ? bucket.campaign_name : (bucket.campaign_name + ' → ' + bucket.adgroup_name),
                prevText: isCostMetric(parsed.metric) ? fmtINR(prev) : (parsed.metric.indexOf('ROAS') !== -1 ? fmtPct(prev) : fmtNum(prev)),
                currentText: isCostMetric(parsed.metric) ? fmtINR(current) : (parsed.metric.indexOf('ROAS') !== -1 ? fmtPct(current) : fmtNum(current)),
                deltaText: deltaPct == null ? '--' : ((deltaPct > 0 ? '+' : '') + deltaPct.toFixed(1) + '%'),
                deltaColor: better ? 'var(--green)' : 'var(--red)',
                spendText: fmtINR(spend),
                better: better,
                deltaPct: deltaPct,
                current: current,
                previous: prev
            };
        }).filter(Boolean).sort(function(a, b) {
            if (a.better !== b.better) return a.better ? -1 : 1;
            return (isCostMetric(parsed.metric) ? a.current - b.current : b.current - a.current);
        }).slice(0, 12);

        return {
            title: metricLabel(parsed.metric) + ' week-on-week',
            basis: (parsed.matureOnly ? addDaysIso(scan.date_range.until, -7) : scan.date_range.until) + ' windowed into previous 7d vs current 7d' + (parsed.matureOnly ? ' | Mature-only (last 7 days excluded)' : ''),
            summary: rows.length ? 'Numbers first: current 7-day vs previous 7-day bucketed view for matching ' + (parsed.entity === 'campaign' ? 'campaigns' : 'ad groups') + '.' : 'No usable week-on-week rows found for this metric in the selected window.',
            rows: rows,
            insights: parsed.askActionables && rows.length ? [
                'Prioritize the green rows with improving ' + metricLabel(parsed.metric).toLowerCase() + ' and material spend.',
                'For red rows, inspect bid strategy, search term drift, and location/network/device waste before scaling budget.'
            ] : []
        };
    }

    var ranked = rankMetricRows(buildMetricDriverRows(scan, parsed.entity, parsed.metric, parsed), parsed.metric, parsed.queryType);
    var best = ranked.slice(0, 6);
    var worst = ranked.slice(-6).reverse();
    var outputRows = best.concat(worst).map(function(item, idx) {
        var value = valueForMetric(item.metrics, parsed.metric);
        return {
            label: item.label,
            prevText: idx < best.length ? 'Best' : 'Weak',
            currentText: parsed.metric.indexOf('ROAS') !== -1 ? fmtPct(value) : (isCostMetric(parsed.metric) ? fmtINR(value) : fmtNum(value)),
            deltaText: idx < best.length ? 'Lean in' : 'Fix / cut',
            deltaColor: idx < best.length ? 'var(--green)' : 'var(--red)',
            spendText: fmtINR(item.metrics.spend || 0)
        };
    });
    var insights = [];
    if (parsed.metric === 'd0TrialCost') {
        insights.push('Shift budget toward the lowest D0 trial cost groups that also hold D6 ROAS above benchmark.');
    }
    if (parsed.metric === 'signupCost') {
        insights.push('Use the lowest signup cost groups as templates for bids, targeting, and query structure.');
    }
    if (parsed.queryType === 'reduce_metric') {
        insights.push('Reduce pressure first in the weak rows before making account-wide budget moves.');
    } else if (parsed.queryType === 'increase_metric') {
        insights.push('Scale only benchmark-positive rows; do not generalize one winner across weak structures.');
    }
    if (parsed.entity === 'ad' && best.length) {
        insights.push('For Google ads, use asset label, CTR, and CPA as the primary ad-level decision surface. Funnel economics remain campaign/ad group level.');
    }
    return {
        title: (parsed.queryType === 'reduce_metric' ? 'How to reduce ' : 'How to improve ') + metricLabel(parsed.metric),
        basis: (scan.date_range || {}).since + ' → ' + (scan.date_range || {}).until + (parsed.matureOnly ? ' | Mature-only (last 7 days excluded)' : ''),
        summary: 'Best and weakest ' + (parsed.entity === 'campaign' ? 'campaign' : 'ad group') + ' pockets for ' + metricLabel(parsed.metric).toLowerCase() + ', ranked deterministically from the current Google optimizer slice.',
        rows: outputRows,
        insights: insights
    };
}

function classifyActionAgainstBenchmarks(item, benchmarks, wow) {
    var spend = item.evalSpend || item.spend || 0;
    var d6ROAS = item.d6ROAS || 0;
    var signupCost = item.signupCost;
    var d0TrialCost = item.d0TrialCost;
    var d6CAC = item.d6CAC;
    var b = benchmarks || {};
    var roasMedian = b.d6ROAS_median;
    var signupMedian = b.signupCost_median;
    var d0TrialMedian = b.d0TrialCost_median;
    var d6CACMedian = b.d6CAC_median;
    var recentRecovery = wow && wow.recoveryAfterWeakRun;
    var recentWeakRun = wow && wow.weakRunWeeks >= 3;

    if ((item.evalSignups || item.signups || 0) === 0 && spend >= 20000) {
        if (recentRecovery && spend >= 15000) {
            return { action: 'WATCH', color: 'var(--text-dim)', reason: 'Recent week improved after a weak run, so treat the newest window as trial-first before making a hard cut', impact: 'Keep the pocket live and read the next mature week', priority: 'P3' };
        }
        return { action: 'PAUSE', color: 'var(--red)', reason: 'No signups on material spend — no confirmed funnel signal in this window', impact: 'Protect budget from non-converting traffic', priority: 'P1' };
    }
    if (recentRecovery && spend >= 15000 && d6ROAS < 15 && (signupCost == null || signupCost > 0)) {
        return { action: 'OPTIMIZE', color: 'var(--blue)', reason: 'The recent week is improving after a weak run, so use signup and D0 trial costs before judging D6 ROAS', impact: 'Keep the recovery live and fix the leak', priority: 'P2' };
    }
    if (roasMedian != null && spend >= 30000 && d6ROAS < roasMedian * 0.45) {
        if (recentRecovery && recentWeakRun) {
            return { action: 'OPTIMIZE', color: 'var(--blue)', reason: 'Three weak weeks were followed by a recent recovery, so the latest window should stay trial-first instead of being cut on D6 ROAS alone', impact: 'Hold the pocket and inspect the upstream leak', priority: 'P2' };
        }
        return { action: 'PAUSE', color: 'var(--red)', reason: 'D6 ROAS is materially below the weighted benchmark for mature Google ad groups', impact: 'Cut a clear value destroyer', priority: 'P1' };
    }
    if (d0TrialMedian != null && d0TrialCost != null && spend >= 20000 && d0TrialCost > d0TrialMedian * 1.35) {
        if (recentRecovery) {
            return { action: 'WATCH', color: 'var(--text-dim)', reason: 'D0 trial cost is still heavy, but the recent week is improving after a weak run', impact: 'Let the trial window mature one more week', priority: 'P3' };
        }
        return { action: 'REDUCE BUDGET', color: 'var(--orange)', reason: 'D0 trial cost is materially above the weighted benchmark — upstream efficiency is weak', impact: 'Reduce expensive trial acquisition', priority: 'P2' };
    }
    if (signupMedian != null && signupCost != null && spend >= 20000 && signupCost > signupMedian * 1.3) {
        if (recentRecovery) {
            return { action: 'WATCH', color: 'var(--text-dim)', reason: 'Signup cost is above benchmark, but the recent week is recovering after prior weakness', impact: 'Keep the pocket live and read one more mature week', priority: 'P3' };
        }
        return { action: 'REDUCE BUDGET', color: 'var(--orange)', reason: 'Signup cost is materially above the weighted benchmark', impact: 'Cap inefficient lead acquisition', priority: 'P2' };
    }
    if (d6CACMedian != null && d6CAC != null && spend >= 20000 && d6CAC > d6CACMedian * 1.3) {
        if (recentRecovery) {
            return { action: 'OPTIMIZE', color: 'var(--blue)', reason: 'Downstream CAC is heavy, but the recent week is recovering after a weak run', impact: 'Fix the structural leak before cutting spend', priority: 'P2' };
        }
        return { action: 'REDUCE BUDGET', color: 'var(--orange)', reason: 'D6 CAC is materially above the weighted benchmark', impact: 'Reduce spend until downstream conversion quality improves', priority: 'P2' };
    }
    if (roasMedian != null && spend >= 20000 && d6ROAS > roasMedian * 1.35) {
        return { action: 'SCALE', color: 'var(--green)', reason: 'D6 ROAS is materially above the weighted benchmark', impact: 'Scale a confirmed winner', priority: 'P1' };
    }
    if (roasMedian != null && spend >= 15000 && d6ROAS >= roasMedian * 0.95) {
        if (recentWeakRun && recentRecovery) {
            return { action: 'MAINTAIN', color: 'var(--green)', reason: 'Recent week recovered after three weak weeks, so protect the recovery while it matures', impact: 'Hold steady and recheck the next mature read', priority: 'P3' };
        }
        return { action: 'MAINTAIN', color: 'var(--green)', reason: 'D6 ROAS is holding around or above the weighted benchmark', impact: 'Keep stable and protect performance', priority: 'P3' };
    }
    if (spend < 15000) {
        return { action: 'WATCH', color: 'var(--text-dim)', reason: 'Spend is still below the confidence threshold for a benchmarked decision', impact: 'Accumulate more data before making structural changes', priority: 'P3' };
    }
    if (recentRecovery) {
        return { action: 'WATCH', color: 'var(--text-dim)', reason: 'Recent week is improving after a weak run, so keep reading the trial-first signals before a hard budget move', impact: 'Protect the recovery and inspect the weakest surface', priority: 'P3' };
    }
    return { action: 'OPTIMIZE', color: 'var(--blue)', reason: 'Metrics are mixed versus benchmark — optimize settings, search structure, and assets before taking broader action', impact: 'Tighten efficiency without overreacting', priority: 'P2' };
}

// ── Rule-based optimization logic ──

function buildGoogleActionExecutionDetails(item, rec) {
    var action = String(rec && rec.action || '').toUpperCase();
    var campaignBudget = item && item.campaign_budget_amount != null ? Number(item.campaign_budget_amount) : null;
    var relaunchBudget = item && item.campaign_relaunch_budget_amount != null ? Number(item.campaign_relaunch_budget_amount) : null;
    var details = {
        budget_text: '--',
        next_step: rec && rec.do_line ? rec.do_line : (rec && rec.impact ? rec.impact : ''),
        why: rec && rec.reason ? rec.reason : '',
        evidence: []
    };
    if (action === 'PAUSE') {
        details.budget_text = 'Hold parent campaign budget flat';
        details.next_step = 'Pause this ad group. Keep the parent campaign budget flat until a stronger replacement or recovery signal appears.';
    } else if (action === 'REDUCE BUDGET') {
        details.budget_text = campaignBudget != null ? 'Reduce parent campaign budget by 15-20% from ' + fmtINR(campaignBudget) : 'Reduce parent campaign budget by 15-20%';
        details.next_step = 'Reduce the parent campaign budget by 15-20% and fix the leak before adding more spend.';
    } else if (action === 'SCALE') {
        details.budget_text = campaignBudget != null ? 'Increase parent campaign budget by 10-15% from ' + fmtINR(campaignBudget) : 'Increase parent campaign budget by 10-15%';
        details.next_step = 'Increase the parent campaign budget by 10-15% and monitor the same KPI on the next mature read.';
    } else if (action === 'MAINTAIN') {
        details.budget_text = 'Hold parent campaign budget flat';
        details.next_step = 'Keep the parent campaign budget flat and protect the winner.';
    } else if (action === 'OPTIMIZE') {
        details.budget_text = 'Hold parent campaign budget flat';
        details.next_step = 'Keep the parent campaign budget flat and fix settings, search terms, placements, or assets first.';
    } else if (action === 'WATCH') {
        details.budget_text = 'No budget change';
        details.next_step = 'Keep budget flat and recheck the next mature week before acting.';
    } else if (action === 'TEST RELAUNCH' || action === 'RELAUNCH') {
        details.budget_text = relaunchBudget != null ? 'Restart at ' + fmtINR(relaunchBudget) + '/day' : 'Restart at prior campaign budget';
        details.next_step = 'Restart this paused entity at the stated budget and watch the same KPI in the first mature read.';
    }
    if (campaignBudget != null) details.evidence.push('Campaign budget ' + fmtINR(campaignBudget));
    if (relaunchBudget != null) details.evidence.push('Restart budget ' + fmtINR(relaunchBudget));
    return details;
}

function classifyAction(item) {
    var spend = item.spend || 0;
    var d6ROAS = item.d6ROAS || 0;
    var signups = item.signups || 0;
    var cpi = item.cpi;
    var signupCost = item.signupCost;

    // Priority rules (evaluated top-to-bottom, first match wins)
    // Rule: No conversions with significant spend
    if (signups === 0 && spend > 20000) {
        return { action: 'PAUSE', color: 'var(--red)', reason: 'No signups with ' + fmtINR(spend) + ' spent — zero conversion signal', impact: 'Save ' + fmtINR(spend / 14) + '/day', priority: 'P1' };
    }
    // Rule: High spend, terrible ROAS
    if (spend > 50000 && d6ROAS < 5) {
        return { action: 'PAUSE', color: 'var(--red)', reason: 'D6 ROAS ' + fmtPct(d6ROAS) + ' with ' + fmtINR(spend) + ' spent — wasting budget', impact: 'Save ' + fmtINR(spend / 14) + '/day', priority: 'P1' };
    }
    // Rule: Moderate spend, poor ROAS
    if (spend > 30000 && d6ROAS < 15) {
        var reducedDaily = (spend / 14) * 0.5;
        return { action: 'REDUCE BUDGET', color: 'var(--orange)', reason: 'D6 ROAS ' + fmtPct(d6ROAS) + ' below 15% threshold — cut budget 50%', impact: 'Save ~' + fmtINR(reducedDaily) + '/day', priority: 'P2' };
    }
    // Rule: High performer — scale
    if (spend > 15000 && d6ROAS > 40) {
        return { action: 'SCALE', color: 'var(--green)', reason: 'D6 ROAS ' + fmtPct(d6ROAS) + ' is exceptional — increase budget 30%', impact: 'More volume at profitable ROAS', priority: 'P1' };
    }
    // Rule: Good performer — maintain
    if (spend > 15000 && d6ROAS > 28) {
        return { action: 'MAINTAIN', color: 'var(--green)', reason: 'D6 ROAS ' + fmtPct(d6ROAS) + ' above 28% target — healthy performance', impact: 'Keep current pacing', priority: 'P3' };
    }
    // Rule: CPI too high with spend
    if (cpi && cpi > 250 && spend > 15000) {
        return { action: 'REDUCE BUDGET', color: 'var(--orange)', reason: 'Cost per Google conversion ' + fmtINR(cpi) + ' is too high (>250) — inefficient acquisition', impact: 'Reduce waste on expensive Google conversion volume', priority: 'P2' };
    }
    // Rule: Signup cost too high
    if (signupCost && signupCost > 1200 && spend > 15000) {
        return { action: 'REDUCE BUDGET', color: 'var(--orange)', reason: 'Signup cost ' + fmtINR(signupCost) + ' exceeds threshold — funnel inefficient', impact: 'Cap spend until creative refresh', priority: 'P2' };
    }
    // Rule: Low spend — insufficient data
    if (spend < 15000) {
        return { action: 'WATCH', color: 'var(--text-dim)', reason: 'Only ' + fmtINR(spend) + ' spent — insufficient data for reliable recommendation', impact: 'Let it run, reassess after 15K spend', priority: 'P3' };
    }
    // Rule: Middle ground — mediocre but not terrible
    if (d6ROAS >= 15 && d6ROAS <= 28) {
        return { action: 'OPTIMIZE', color: 'var(--blue)', reason: 'D6 ROAS ' + fmtPct(d6ROAS) + ' is average (15-28%) — needs creative or targeting refresh', impact: 'Test new creatives to lift ROAS above 28%', priority: 'P2' };
    }

    return { action: 'REVIEW', color: 'var(--text-dim)', reason: 'Metrics inconclusive — manual review needed', impact: '--', priority: 'P3' };
}

// Check WoW CPI trend (needs daily data)
function checkCPITrend(item) {
    if (!item._weeklySpend || !item._weeklyInstalls) return null;
    var w1Spend = item._weeklySpend[0] || 0;
    var w1Inst = item._weeklyInstalls[0] || 0;
    var w2Spend = item._weeklySpend[1] || 0;
    var w2Inst = item._weeklyInstalls[1] || 0;
    if (w1Inst < 5 || w2Inst < 5) return null;
    var cpi1 = w1Spend / w1Inst;
    var cpi2 = w2Spend / w2Inst;
    if (cpi2 <= 0) return null;
    var change = ((cpi1 - cpi2) / cpi2) * 100;
    if (change > 30) return { direction: 'up', pct: change, cpi1: cpi1, cpi2: cpi2 };
    if (change < -20) return { direction: 'down', pct: change, cpi1: cpi1, cpi2: cpi2 };
    return null;
}

async function executeGoogleOptimizerQuery(scan, prompt) {
    var parsed = parseGoogleOptimizerQuery(prompt);
    if (!parsed.metric || !parsed.queryType) return executeGoogleOptimizationPlan(scan, prompt);

    if (parsed.queryType === 'trend' || parsed.queryType === 'search') {
        var buckets = buildGoogleTrendBuckets(scan, parsed.entity, { matureOnly: parsed.matureOnly });
        var rows = buckets.map(function(bucket) {
            var prev = valueForMetric(bucket.previous, parsed.metric);
            var current = valueForMetric(bucket.current, parsed.metric);
            var spend = (bucket.current && bucket.current.spend || 0) + (bucket.previous && bucket.previous.spend || 0);
            if (prev == null || current == null) return null;
            var deltaPct = null;
            if (prev !== 0) deltaPct = ((current - prev) / Math.abs(prev)) * 100;
            var better = isCostMetric(parsed.metric) ? current < prev : current > prev;
            return {
                label: parsed.entity === 'campaign'
                    ? bucket.campaign_name
                    : (parsed.entity === 'ad'
                        ? (bucket.campaign_name + ' → ' + bucket.adgroup_name + ' → ' + bucket.ad_id)
                        : (bucket.campaign_name + ' → ' + bucket.adgroup_name)),
                statusText: normalizeGoogleStatusLabel(parsed.entity === 'ad' ? bucket.ad_status : ''),
                prevText: isCostMetric(parsed.metric) ? fmtINR(prev) : (parsed.metric.indexOf('ROAS') !== -1 ? fmtPct(prev) : (parsed.metric === 'ctr' ? fmtPct(prev) : fmtNum(prev))),
                currentText: isCostMetric(parsed.metric) ? fmtINR(current) : (parsed.metric.indexOf('ROAS') !== -1 ? fmtPct(current) : (parsed.metric === 'ctr' ? fmtPct(current) : fmtNum(current))),
                deltaText: deltaPct == null ? '--' : ((deltaPct > 0 ? '+' : '') + deltaPct.toFixed(1) + '%'),
                deltaColor: better ? 'var(--green)' : 'var(--red)',
                spendText: fmtINR(spend),
                better: better,
                deltaPct: deltaPct,
                current: current,
                previous: prev,
                rawStatus: String(parsed.entity === 'ad' ? bucket.ad_status || '' : '').toLowerCase()
            };
        }).filter(Boolean).filter(function(row) {
            if (parsed.status === 'paused') return row.rawStatus.indexOf('pause') !== -1;
            if (parsed.status === 'live') return row.rawStatus && row.rawStatus.indexOf('pause') === -1;
            return true;
        }).sort(function(a, b) {
            if (a.better !== b.better) return a.better ? -1 : 1;
            if (parsed.compareDirection === 'down') return (a.deltaPct || 0) - (b.deltaPct || 0);
            if (parsed.compareDirection === 'up') return (b.deltaPct || 0) - (a.deltaPct || 0);
            return (isCostMetric(parsed.metric) ? a.current - b.current : b.current - a.current);
        }).slice(0, 12);

        return {
            title: metricLabel(parsed.metric) + ' week-on-week',
            basis: (parsed.matureOnly ? addDaysIso(scan.date_range.until, -7) : scan.date_range.until) + ' windowed into previous 7d vs current 7d' + (parsed.matureOnly ? ' | Mature-only (last 7 days excluded)' : ''),
            summary: rows.length ? 'Numbers first: current 7-day vs previous 7-day bucketed view for matching ' + (parsed.entity === 'campaign' ? 'campaigns' : parsed.entity === 'ad' ? 'ads' : 'ad groups') + '.' : 'No usable week-on-week rows found for this metric in the selected window.',
            rows: rows,
            insights: parsed.askInsights ? buildGoogleQueryInsights(parsed, rows) : []
        };
    }

    var ranked = rankMetricRows(buildMetricDriverRows(scan, parsed.entity, parsed.metric, parsed), parsed.metric, parsed.queryType);
    var best = ranked.slice(0, 6);
    var worst = ranked.slice(-6).reverse();
    var outputRows = best.concat(worst).map(function(item, idx) {
        var value = valueForMetric(item.metrics, parsed.metric);
        return {
            label: item.label,
            statusText: normalizeGoogleStatusLabel(item.status),
            prevText: idx < best.length ? 'Best' : 'Weak',
            currentText: parsed.metric.indexOf('ROAS') !== -1 ? fmtPct(value) : (isCostMetric(parsed.metric) ? fmtINR(value) : (parsed.metric === 'ctr' ? fmtPct(value) : fmtNum(value))),
            deltaText: idx < best.length ? 'Lean in' : 'Fix / cut',
            deltaColor: idx < best.length ? 'var(--green)' : 'var(--red)',
            spendText: fmtINR(item.metrics.spend || 0)
        };
    });
    var insights = [];
    if (parsed.metric === 'd0TrialCost') insights.push('For the newest week, use D0 trial cost and trial recovery first; use D6 ROAS only as mature-window context.');
    if (parsed.metric === 'signupCost') insights.push('Use the lowest signup cost groups as templates for bids, targeting, and query structure.');
    if (parsed.queryType === 'reduce_metric') insights.push('Reduce pressure first in the weak rows before making account-wide budget moves.');
    else if (parsed.queryType === 'increase_metric') insights.push('Scale only benchmark-positive rows; do not generalize one winner across weak structures.');
    if (parsed.entity === 'ad' && best.length) insights.push('For Google ads, use asset label, CTR, and CPA as the primary ad-level decision surface. Funnel economics remain campaign/ad group level.');

    return {
        title: (parsed.queryType === 'reduce_metric' ? 'How to reduce ' : 'How to improve ') + metricLabel(parsed.metric),
        basis: (scan.date_range || {}).since + ' → ' + (scan.date_range || {}).until + (parsed.matureOnly ? ' | Mature-only (last 7 days excluded)' : ''),
        summary: 'Best and weakest ' + (parsed.entity === 'campaign' ? 'campaign' : parsed.entity === 'ad' ? 'ad' : 'ad group') + ' pockets for ' + metricLabel(parsed.metric).toLowerCase() + ', ranked deterministically from the current Google optimizer slice.',
        rows: outputRows,
        insights: insights
    };
}

window.runGcOptimizerQuery = async function(prompt) {
    if (!GC_OPT_SCAN) {
        return {
            title: 'Google optimizer not scanned yet',
            basis: '--',
            summary: 'Run a Google optimizer scan first, then ask the question again.',
            rows: [],
            insights: ['Scan Google Ads first so the optimizer has live campaign, ad group, and ad data.']
        };
    }
    return executeGoogleOptimizerQuery(GC_OPT_SCAN, prompt);
};

window.addEventListener('message', async function(event) {
    var data = event && event.data ? event.data : {};
    if (data.type !== 'gc-optimizer-query') return;
    try {
        var result = await window.runGcOptimizerQuery(data.prompt || '');
        if (event.source && typeof event.source.postMessage === 'function') {
            event.source.postMessage({
                type: 'gc-optimizer-query-result',
                requestId: data.requestId,
                result: result
            }, '*');
        }
    } catch (err) {
        if (event.source && typeof event.source.postMessage === 'function') {
            event.source.postMessage({
                type: 'gc-optimizer-query-result',
                requestId: data.requestId,
                error: err && err.message ? err.message : 'Google optimizer query failed'
            }, '*');
        }
    }
});

// ── Scanner — fetches Google Ads + Metabase data ──

async function scanGoogleAccount(progressCb) {
    var dr = getSelectedDates();
    var scanCacheKey = buildGcScanCacheKey(dr);
    var cachedScan = getGcCachedScan(dr);
    if (cachedScan && cachedScan.scan) {
        GC_OPT_SCAN = cachedScan.scan;
        GC_OPT_SCAN_ERROR = GC_OPT_SCAN_ERROR || 'Showing cached Google scan while fresh data loads.';
        setPortalLoadState('cached', 'Cached Google optimizer');
        if (typeof progressCb === 'function') progressCb('Showing cached Google scan while fresh data loads...');
        if (typeof window.renderGcOptimizer === 'function') window.renderGcOptimizer();
    }
    if (!(cachedScan && cachedScan.scan)) {
        setPortalLoadState('loading', 'Loading Google optimizer...');
        progressCb('Fetching Google Ads insights, Metabase funnel, Google settings layers, and app asset performance...');
    } else if (typeof progressCb === 'function') {
        progressCb('Refreshing Google data in the background...');
    }

    function safeFetchJson(url, options, fallback) {
        var normalizedUrl = String(url || '').replace(/^\//, '');
        var mergedOptions = Object.assign({}, options || {});
        mergedOptions.headers = Object.assign({}, gcPortalHeaders(), mergedOptions.headers || {});
        return fetch(normalizedUrl, mergedOptions).then(function(r) {
            if (!r.ok) return fallback;
            return r.json().catch(function() { return fallback; });
        }).catch(function() {
            return fallback;
        });
    }

    function sleep(ms) {
        return new Promise(function(resolve) { setTimeout(resolve, ms); });
    }

    function withTimeout(promise, ms, label) {
        var timer;
        var timeout = new Promise(function(_, reject) {
            timer = setTimeout(function() {
                reject(new Error(label + ' timed out after ' + ms + 'ms'));
            }, ms);
        });
        return Promise.race([
            Promise.resolve(promise).finally(function() { clearTimeout(timer); }),
            timeout
        ]);
    }

    function toGoogleAggRow(row) {
        var syncDate = row.synced_at ? String(row.synced_at).slice(0, 10) : dr.until;
        return {
            date_start: syncDate,
            campaign_name: row.campaign_name || '',
            campaign_id: String(row.google_campaign_id || row.campaign_id || ''),
            campaign_type: row.channel_type || row.campaign_type || '',
            adset_name: row.name || row.adgroup_name || '',
            adgroup_name: row.name || row.adgroup_name || '',
            adset_id: String(row.google_adgroup_id || row.adset_id || row.adgroup_id || ''),
            adgroup_id: String(row.google_adgroup_id || row.adset_id || row.adgroup_id || ''),
            spend: Number(row.total_spend) || 0,
            impressions: Number(row.impressions) || 0,
            clicks: Number(row.clicks) || 0,
            conversions: Number(row.conversions) || 0,
            conversion_value: Number(row.conversion_value) || 0,
            installs: Number(row.conversions) || 0,
            signups: 0,
            d0_trial: 0,
            d0: 0,
            d0_revenue: 0,
            d6: 0,
            d6_revenue: 0,
            overall_revenue: 0,
            d6_overall_con: 0,
            d6_overall_revenue: 0,
            d15_overall_con: 0,
            d15_overall_revenue: 0,
            d30_overall_con: 0,
            d30_overall_revenue: 0,
            d60_overall_con: 0,
            d60_overall_revenue: 0,
            p0_signup: 0,
            p1_signup: 0,
            total_trial: 0
        };
    }

    var campaignSettingsRes, adgroupSettingsRes, breakdownsRes, audiencesRes, keywordsRes, searchTermsRes, assetGroupsRes, creativesRes, adsDailyRes, appAssetPerformanceRes, googleInsightsRes, funnelRes, campaignsRes;
    try {
        var coreResults = await Promise.allSettled([
            withTimeout(safeFetchJson('api/google/ad-insights-daily', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom: dr.since, dateTo: dr.until })
            }, { success: false, data: [] }), 45000, 'Google ad insights'),
            withTimeout(safeFetchJson('api/google/ad-funnel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom: dr.since, dateTo: dr.until })
            }, { success: false, data: [] }), 45000, 'Google funnel')
        ]);
        googleInsightsRes = coreResults[0] && coreResults[0].status === 'fulfilled' ? coreResults[0].value : { success: false, data: [] };
        funnelRes = coreResults[1] && coreResults[1].status === 'fulfilled' ? coreResults[1].value : { success: false, data: [] };
        var funnelSourceState = 'live';
        var funnelSourceLabel = 'Live Metabase';
        if (funnelRes && (funnelRes.cached || funnelRes.stale || funnelRes.warning)) {
            funnelSourceState = funnelRes.cached || funnelRes.stale ? 'cached' : 'degraded';
            funnelSourceLabel = funnelRes.cached || funnelRes.stale ? 'Cached fallback' : 'Degraded live';
        }
        campaignsRes = { success: true, data: [] };
        if ((coreResults[0] && coreResults[0].status === 'rejected') || (coreResults[1] && coreResults[1].status === 'rejected')) {
            var coreWarnings = [];
            if (coreResults[0] && coreResults[0].status === 'rejected' && coreResults[0].reason) coreWarnings.push('ad insights: ' + coreResults[0].reason.message);
            if (coreResults[1] && coreResults[1].status === 'rejected' && coreResults[1].reason) coreWarnings.push('funnel: ' + coreResults[1].reason.message);
            if (coreWarnings.length) progressCb('Google core fetch partial: ' + coreWarnings.join(' | '));
        }

        if ((!funnelRes || !Array.isArray(funnelRes.data) || funnelRes.data.length === 0) && googleInsightsRes && Array.isArray(googleInsightsRes.data) && googleInsightsRes.data.length > 0) {
            try {
                var freshFunnelRes = await withTimeout(safeFetchJson('api/google/ad-funnel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dateFrom: dr.since, dateTo: dr.until, noCache: true })
                }, { success: false, data: [] }), 45000, 'Google funnel refresh');
                if (freshFunnelRes && freshFunnelRes.success && Array.isArray(freshFunnelRes.data) && freshFunnelRes.data.length > 0) {
                    funnelRes = freshFunnelRes;
                    progressCb('Google funnel refreshed after an empty cached read.');
                }
            } catch (freshFunnelErr) {}
        }

        safeFetchJson('api/google/ad-insights-daily', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dateFrom: dr.since, dateTo: dr.until, noCache: true })
        }, { success: false, data: [] }).catch(function() {});

        var auxResults = [];
        try {
            auxResults = await withTimeout(Promise.allSettled([
                safeFetchJson('api/at/google/campaigns', {}, { success: false, data: [] }),
                safeFetchJson('api/at/google/adgroups', {}, { success: false, data: [] }),
                safeFetchJson('api/at/google/breakdowns', {}, { success: false, data: [] }),
                safeFetchJson('api/at/google/audiences', {}, { success: false, data: [] }),
                safeFetchJson('api/at/google/keywords', {}, { success: false, data: [] }),
                safeFetchJson('api/at/google/search-terms', {}, { success: false, data: [] }),
                safeFetchJson('api/at/google/asset-groups', {}, { success: false, data: [] }),
                safeFetchJson('api/google/creatives?days=180', {}, { success: false, data: [] }),
                safeFetchJson('api/google/ads/daily?days=180', {}, { success: false, data: [] }),
                safeFetchJson('api/google/app-asset-performance?dateFrom=' + encodeURIComponent(dr.since) + '&dateTo=' + encodeURIComponent(dr.until), {}, { success: false, data: {} })
            ]), 14000, 'Google scan enrichment bundle');
        } catch (auxErr) {
            auxResults = [];
        }
        campaignSettingsRes = auxResults[0] && auxResults[0].status === 'fulfilled' ? auxResults[0].value : { success: false, data: [] };
        adgroupSettingsRes = auxResults[1] && auxResults[1].status === 'fulfilled' ? auxResults[1].value : { success: false, data: [] };
        breakdownsRes = auxResults[2] && auxResults[2].status === 'fulfilled' ? auxResults[2].value : { success: false, data: [] };
        audiencesRes = auxResults[3] && auxResults[3].status === 'fulfilled' ? auxResults[3].value : { success: false, data: [] };
        keywordsRes = auxResults[4] && auxResults[4].status === 'fulfilled' ? auxResults[4].value : { success: false, data: [] };
        searchTermsRes = auxResults[5] && auxResults[5].status === 'fulfilled' ? auxResults[5].value : { success: false, data: [] };
        assetGroupsRes = auxResults[6] && auxResults[6].status === 'fulfilled' ? auxResults[6].value : { success: false, data: [] };
        creativesRes = auxResults[7] && auxResults[7].status === 'fulfilled' ? auxResults[7].value : { success: false, data: [] };
        adsDailyRes = auxResults[8] && auxResults[8].status === 'fulfilled' ? auxResults[8].value : { success: false, data: [] };
        appAssetPerformanceRes = auxResults[9] && auxResults[9].status === 'fulfilled' ? auxResults[9].value : { success: false, data: {} };
    } catch (err) {
        if (cachedScan && cachedScan.scan) {
            GC_OPT_SCAN = cachedScan.scan;
            GC_OPT_SCAN_ERROR = 'Showing cached Google scan while fresh data loads or recovers: ' + err.message;
            setPortalLoadState('cached', 'Showing cached Google scan while fresh data loads');
            if (typeof progressCb === 'function') progressCb('Fresh Google scan failed, keeping cached scan on screen...');
            return GC_OPT_SCAN;
        }
        throw new Error('Failed to fetch data: ' + err.message);
    }

    var googleRows = (googleInsightsRes && googleInsightsRes.data ? googleInsightsRes.data : []).map(function(row) {
        return {
            date_start: row.date_start || row.date || '',
            campaign_name: row.campaign_name || '',
            campaign_id: String(row.campaign_id || ''),
            campaign_type: row.campaign_type || '',
            adset_name: row.adset_name || row.adgroup_name || '',
            adgroup_name: row.adset_name || row.adgroup_name || '',
            adset_id: String(row.adset_id || row.adgroup_id || ''),
            adgroup_id: String(row.adset_id || row.adgroup_id || ''),
            spend: Number(row.spend) || 0,
            impressions: Number(row.impressions) || 0,
            clicks: Number(row.clicks) || 0,
            conversions: Number(row.conversions) || 0,
            conversion_value: Number(row.conversion_value) || 0,
            installs: Number(row.installs || row.conversions) || 0
        };
    });
    var funnelRows = (funnelRes && funnelRes.data ? funnelRes.data : []).map(function(row) {
        return {
            date: row.date || row.date_start || '',
            campaign_name: row.campaign_name || '',
            ad_set_name: row.ad_set_name || row.adgroup_name || '',
            adgroup_name: row.adgroup_name || row.ad_set_name || '',
            signups: Number(row.signups) || 0,
            p0_signup: Number(row.p0_signup) || 0,
            p1_signup: Number(row.p1_signup) || 0,
            total_trial: Number(row.total_trial) || 0,
            d0_trial: Number(row.d0_trial) || 0,
            d0: Number(row.d0) || 0,
            d0_revenue: Number(row.d0_revenue) || 0,
            d6: Number(row.d6) || 0,
            d6_revenue: Number(row.d6_revenue) || 0,
            overall_revenue: Number(row.overall_revenue) || 0,
            d6_overall_con: Number(row.d6_overall_con) || 0,
            d6_overall_revenue: Number(row.d6_overall_revenue) || 0,
            d15_overall_con: Number(row.d15_overall_con) || 0,
            d15_overall_revenue: Number(row.d15_overall_revenue) || 0,
            d30_overall_con: Number(row.d30_overall_con) || 0,
            d30_overall_revenue: Number(row.d30_overall_revenue) || 0,
            d60_overall_con: Number(row.d60_overall_con) || 0,
            d60_overall_revenue: Number(row.d60_overall_revenue) || 0
        };
    });
    var campaignSettings = campaignSettingsRes && campaignSettingsRes.data ? campaignSettingsRes.data : [];
    var adgroupSettings = adgroupSettingsRes && adgroupSettingsRes.data ? adgroupSettingsRes.data : [];
    var breakdownRows = breakdownsRes && breakdownsRes.data ? breakdownsRes.data : [];
    var audienceRows = audiencesRes && audiencesRes.data ? audiencesRes.data : [];
    var keywordRows = keywordsRes && keywordsRes.data ? keywordsRes.data : [];
    var searchTermRows = searchTermsRes && searchTermsRes.data ? searchTermsRes.data : [];
    var assetGroupRows = assetGroupsRes && assetGroupsRes.data ? assetGroupsRes.data : [];
    var creativeRows = creativesRes && creativesRes.data ? creativesRes.data : [];
    var adsDailyRows = adsDailyRes && adsDailyRes.data ? adsDailyRes.data : [];

    if (googleRows.length === 0 && funnelRows.length === 0) {
        throw new Error('No data returned from either Google Ads API or Metabase funnel');
    }

    var campaignSettingsById = {};
    campaignSettings.forEach(function(row) {
        campaignSettingsById[String(row.google_campaign_id || '')] = row;
    });
    var adgroupSettingsById = {};
    adgroupSettings.forEach(function(row) {
        adgroupSettingsById[String(row.google_adgroup_id || '')] = row;
    });
    function groupBy(rows, keyGetter) {
        var out = {};
        (rows || []).forEach(function(row) {
            var key = String(keyGetter(row) || '');
            if (!key) return;
            if (!out[key]) out[key] = [];
            out[key].push(row);
        });
        return out;
    }
    var breakdownsByAdgroup = groupBy(breakdownRows, function(row) { return row.adgroup_id; });
    var audiencesByAdgroup = groupBy(audienceRows, function(row) { return row.adgroup_id; });
    var keywordsByAdgroup = groupBy(keywordRows, function(row) { return row.google_adgroup_id; });
    var searchTermsByAdgroup = groupBy(searchTermRows, function(row) { return row.google_adgroup_id; });
    var assetGroupsByCampaign = groupBy(assetGroupRows, function(row) { return row.google_campaign_id; });

    progressCb('Google daily rows: ' + googleRows.length + ' | Funnel rows: ' + funnelRows.length + ' | Settings: ' + campaignSettings.length + ' campaigns / ' + adgroupSettings.length + ' ad groups');

    function buildGoogleFallbackScan(errorMessage) {
        var fallbackRows = (adgroupSettingsRes && adgroupSettingsRes.data ? adgroupSettingsRes.data : []).map(function(row) {
            return toGoogleAggRow(row);
        });
        var fallbackAdsets = fallbackRows.map(function(a) {
            var evalRaw = rawFromItem(a);
            var derived = deriveMetrics(evalRaw);
            var campType = detectCampaignType(a.campaign_name, a.campaign_type);
            return Object.assign({}, a, derived, {
                campType: campType,
                isMatured: false,
                daysLive: 0,
                goLiveDate: '',
                _matched: false,
                _evalMode: 'fallback',
                _evalRaw: evalRaw,
                evalSpend: evalRaw.spend,
                evalInstalls: evalRaw.installs,
                evalSignups: evalRaw.signups,
                evalD6: evalRaw.d6_overall_con || evalRaw.d6 || 0,
                evalDataLabel: 'Fallback scan after error',
                recommendation: {
                    action: 'WATCH',
                    color: 'var(--text-dim)',
                    reason: 'Fallback scan after error: ' + esc(errorMessage || 'unknown error'),
                    impact: 'Retry once data stabilizes',
                    priority: 'P3'
                },
                cpiTrend: null,
                settings: {
                    campaign: campaignSettingsById[String(a.campaign_id || '')] || null,
                    adgroup: adgroupSettingsById[String(a.adset_id || '')] || null,
                    breakdowns: breakdownsByAdgroup[String(a.adset_id || '')] || [],
                    audiences: audiencesByAdgroup[String(a.adset_id || '')] || [],
                    keywords: keywordsByAdgroup[String(a.adset_id || '')] || [],
                    searchTerms: searchTermsByAdgroup[String(a.adset_id || '')] || [],
                    assetGroups: assetGroupsByCampaign[String(a.campaign_id || '')] || []
                },
                searchAudit: { actions: [], signals: [], notes: ['Fallback scan.'] },
                settingsAudit: { actions: [], signals: [], notes: ['Fallback scan.'] }
            });
        });
        var tree = {};
        for (var i = 0; i < fallbackAdsets.length; i++) {
            var as = fallbackAdsets[i];
            if (!tree[as.campaign_name]) {
                tree[as.campaign_name] = {
                    name: as.campaign_name,
                    id: as.campaign_id,
                    type: as.campType,
                    adsets: {},
                    settings: { campaign: campaignSettingsById[String(as.campaign_id || '')] || null }
                };
            }
            tree[as.campaign_name].adsets[as.adset_name] = as;
        }
        for (var ck in tree) {
            tree[ck].totals = sumEvaluated(Object.values(tree[ck].adsets || {}));
            tree[ck].totals.campType = tree[ck].type;
            tree[ck].recommendation = {
                action: 'WATCH',
                color: 'var(--text-dim)',
                reason: 'Fallback scan only',
                impact: 'Re-run scan',
                priority: 'P3'
            };
        }
        var totals = sumEvaluated(fallbackAdsets);
        return {
            scan_date: new Date().toISOString(),
            date_range: dr,
            tree: tree,
            adsets: fallbackAdsets,
            campaign_settings: campaignSettings,
            adgroup_settings: adgroupSettings,
            ads: (creativeRows || []).map(function(row) {
                var content = safeJsonParse(row.creative_content_json, {});
                return {
                    id: row.id,
                    ad_id: row.ad_id,
                    campaign_id: row.campaign_id,
                    campaign_name: row.campaign_name || '',
                    adgroup_id: row.adgroup_id,
                    adgroup_name: row.adgroup_name || '',
                    ad_type: row.ad_type || '',
                    ad_status: row.ad_status || '',
                    asset_performance_label: row.asset_performance_label || '',
                    gcps_score: row.gcps_score,
                    ad_spend: Number(row.ad_spend) || 0,
                    ad_impressions: Number(row.ad_impressions) || 0,
                    ad_clicks: Number(row.ad_clicks) || 0,
                    ad_conversions: Number(row.ad_conversions) || 0,
                    ad_conversion_value: Number(row.ad_conversion_value) || 0,
                    ad_ctr: Number(row.ad_ctr) || 0,
                    ad_cpc: Number(row.ad_cpc) || 0,
                    ad_cpa: Number(row.ad_cpa) || 0,
                    content: content,
                    adAudit: buildGoogleAdAudit({
                        campaign_name: row.campaign_name || '',
                        adgroup_name: row.adgroup_name || '',
                        ad_id: row.ad_id,
                        ad_type: row.ad_type || '',
                        ad_status: row.ad_status || '',
                        asset_performance_label: row.asset_performance_label || '',
                        ad_spend: Number(row.ad_spend) || 0,
                        ad_impressions: Number(row.ad_impressions) || 0,
                        ad_clicks: Number(row.ad_clicks) || 0,
                        ad_conversions: Number(row.ad_conversions) || 0,
                        ad_conversion_value: Number(row.ad_conversion_value) || 0,
                        ad_ctr: Number(row.ad_ctr) || 0,
                        ad_cpc: Number(row.ad_cpc) || 0,
                        ad_cpa: Number(row.ad_cpa) || 0,
                        content: content
                    })
                };
            }),
            ad_daily: (adsDailyRes && adsDailyRes.data ? adsDailyRes.data : []),
            app_asset_performance: (appAssetPerformanceRes && appAssetPerformanceRes.data ? appAssetPerformanceRes.data : {}),
            benchmarks: buildGoogleBenchmarks(fallbackAdsets),
            settingsCoverage: {
                campaigns: campaignSettings.length,
                adgroups: adgroupSettings.length,
                breakdowns: breakdownRows.length,
                audiences: audienceRows.length,
                keywords: keywordRows.length,
                searchTerms: searchTermRows.length,
                assetGroups: assetGroupRows.length,
                ads: creativeRows.length,
                appAssets: appAssetPerformanceRes && appAssetPerformanceRes.data ? (appAssetPerformanceRes.data.total_rows || 0) : 0
            },
            integrity: {
                adCoveragePct: 0,
                spendCoveragePct: 0,
                freshStatusPct: 0,
                weightedMedianCoherent: false,
                error: String(errorMessage || 'scan fallback')
            },
            _trendSource: {
                googleRows: fallbackRows,
                adsDailyRows: adsDailyRes && adsDailyRes.data ? adsDailyRes.data : [],
                funnelRows: fallbackRows.map(function(row) {
                    return {
                        date: row.date_start,
                        campaign_name: row.campaign_name,
                        ad_set_name: row.adset_name,
                        signups: row.signups,
                        p0_signup: row.p0_signup,
                        p1_signup: row.p1_signup,
                        total_trial: row.total_trial,
                        d0_trial: row.d0_trial,
                        d0: row.d0,
                        d0_revenue: row.d0_revenue,
                        d6_overall_con: row.d6_overall_con,
                        d6_overall_revenue: row.d6_overall_revenue,
                        d15_overall_con: row.d15_overall_con,
                        d15_overall_revenue: row.d15_overall_revenue,
                        d30_overall_con: row.d30_overall_con,
                        d30_overall_revenue: row.d30_overall_revenue,
                        d60_overall_con: row.d60_overall_con,
                        d60_overall_revenue: row.d60_overall_revenue
                    };
                }),
                adsDailyRows: adsDailyRows
            },
            evaluatedTotals: totals,
            summary: {
                total_campaigns: Object.keys(tree).length,
                total_adsets: fallbackAdsets.length,
                total_spend: totals.spend || 0,
                pause_count: 0,
                scale_count: 0,
                reduce_count: 0,
                watch_count: fallbackAdsets.length,
                matched_keys: 0,
                unmatched_keys: 0,
                matured_adsets: 0,
                early_adsets: fallbackAdsets.length,
                matched_adsets: 0,
                ad_coverage_pct: 0,
                spend_coverage_pct: 0,
                fresh_status_pct: 0,
                weighted_median_coherent: false,
                fallback: true
            }
        };
    }

    try {
    // Build Metabase daily lookup: date|||campaign_name|||adset_name
    var mbDaily = {};
    for (var fi = 0; fi < funnelRows.length; fi++) {
        var row = funnelRows[fi];
        var d = String(row.date || '').substring(0, 10);
        var key = d + '|||' + normalizeGoogleJoinText(row.campaign_name) + '|||' + normalizeGoogleJoinText(row.ad_set_name || row.adgroup_name);
        if (!mbDaily[key]) {
            mbDaily[key] = { signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0, d6: 0, d6_revenue: 0, overall_revenue: 0, p0_signup: 0, p1_signup: 0, total_trial: 0, d6_overall_con: 0, d6_overall_revenue: 0, d15_overall_con: 0, d15_overall_revenue: 0, d30_overall_con: 0, d30_overall_revenue: 0, d60_overall_con: 0, d60_overall_revenue: 0 };
        }
        var m = mbDaily[key];
            m.signups += Number(row.signups) || 0;
            m.d0_trial += Number(row.d0_trial) || 0;
            m.d0 += Number(row.d0) || 0;
            m.d0_revenue += Number(row.d0_revenue) || 0;
            m.d6 += Number(row.d6) || 0;
            m.d6_revenue += Number(row.d6_revenue) || 0;
        m.overall_revenue += Number(row.overall_revenue) || 0;
        m.p0_signup += Number(row.p0_signup) || 0;
        m.p1_signup += Number(row.p1_signup) || 0;
        m.total_trial += Number(row.total_trial) || 0;
            m.d6_overall_con += Number(row.d6_overall_con) || 0;
            m.d6_overall_revenue += Number(row.d6_overall_revenue) || 0;
        m.d15_overall_con += Number(row.d15_overall_con) || 0;
        m.d15_overall_revenue += Number(row.d15_overall_revenue) || 0;
        m.d30_overall_con += Number(row.d30_overall_con) || 0;
        m.d30_overall_revenue += Number(row.d30_overall_revenue) || 0;
        m.d60_overall_con += Number(row.d60_overall_con) || 0;
        m.d60_overall_revenue += Number(row.d60_overall_revenue) || 0;
    }

    // Aggregate per campaign|||adset (adset-level for Google)
    var adAgg = {};
    var matchedKeys = 0, unmatchedKeys = 0;

    for (var gi = 0; gi < googleRows.length; gi++) {
        var gr = googleRows[gi];
        var adUid = normalizeGoogleJoinText(gr.adset_name || gr.adgroup_name);
        if (!adAgg[adUid]) {
            adAgg[adUid] = {
                adset_name: gr.adset_name || gr.adgroup_name || '',
                campaign_name: gr.campaign_name || '',
                campaign_id: gr.campaign_id || '',
                adset_id: gr.adset_id || gr.adgroup_id || '',
                campaign_type: gr.campaign_type || gr.advertising_channel_type || '',
                spend: 0, impressions: 0, clicks: 0, installs: 0, conversions: 0,
                signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
                d6: 0, d6_revenue: 0, overall_revenue: 0,
                d6_overall_con: 0, d6_overall_revenue: 0,
                d15_overall_con: 0, d15_overall_revenue: 0,
                d30_overall_con: 0, d30_overall_revenue: 0,
                d60_overall_con: 0, d60_overall_revenue: 0,
                p0_signup: 0, p1_signup: 0, total_trial: 0,
                _matched: false,
                _weeklySpend: [0, 0], _weeklyInstalls: [0, 0]
            };
        }
        var a = adAgg[adUid];
        var rowSpend = (gr.spend || (gr.cost_micros ? gr.cost_micros / 1000000 : 0)) * 1.18; // GST
        a.spend += rowSpend;
        a.impressions += gr.impressions || 0;
        a.clicks += gr.clicks || 0;
        a.installs += gr.installs || gr.conversions || 0;
        a.conversions += gr.conversions || 0;

        // Weekly buckets for WoW CPI trend (week 0 = recent, week 1 = older)
        var rowDate = gr.date_start || gr.date || gr.segments_date || '';
        if (rowDate) {
            var dayAge = Math.floor((Date.now() - new Date(rowDate).getTime()) / 86400000);
            var wk = dayAge < 7 ? 0 : 1;
            a._weeklySpend[wk] += rowSpend;
            a._weeklyInstalls[wk] += gr.installs || gr.conversions || 0;
        }

        // Daily key match to Metabase
        var dateKey = gr.date_start || gr.date || gr.segments_date || '';
        var mbKey = dateKey + '|||' + normalizeGoogleJoinText(gr.campaign_name) + '|||' + normalizeGoogleJoinText(gr.adset_name || gr.adgroup_name);
        var mb = mbDaily[mbKey];
        if (mb) {
            matchedKeys++;
            a._matched = true;
            a.signups += mb.signups; a.d0_trial += mb.d0_trial; a.d0 += mb.d0;
            a.d0_revenue += mb.d0_revenue; a.d6 += mb.d6; a.d6_revenue += mb.d6_revenue;
            a.overall_revenue += mb.overall_revenue;
            a.d6_overall_con += mb.d6_overall_con; a.d6_overall_revenue += mb.d6_overall_revenue;
            a.d15_overall_con += mb.d15_overall_con; a.d15_overall_revenue += mb.d15_overall_revenue;
            a.d30_overall_con += mb.d30_overall_con; a.d30_overall_revenue += mb.d30_overall_revenue;
            a.d60_overall_con += mb.d60_overall_con; a.d60_overall_revenue += mb.d60_overall_revenue;
            a.p0_signup += mb.p0_signup; a.p1_signup += mb.p1_signup; a.total_trial += mb.total_trial;
        } else {
            unmatchedKeys++;
        }
    }

    progressCb('Building campaign tree and running optimization rules on mature data...');

    // ── Maturity detection & mature data separation ──
    // Mature = campaign is 29+ days old. Mature data = exclude last 7 days of spend & metrics.
    var sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    // Build mature-only aggregates (excluding last 7 days)
    var matureAgg = {};
    for (var gi2 = 0; gi2 < googleRows.length; gi2++) {
        var gr2 = googleRows[gi2];
        var rowDate2 = gr2.date_start || gr2.date || gr2.segments_date || '';
        if (rowDate2 >= sevenDaysAgo) continue; // Skip last 7 days
        var adUid2 = normalizeGoogleJoinText(gr2.adset_name || gr2.adgroup_name);
        if (!matureAgg[adUid2]) {
            matureAgg[adUid2] = {
                spend: 0, impressions: 0, clicks: 0, installs: 0,
                signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
                d6: 0, d6_revenue: 0, overall_revenue: 0,
                d6_overall_con: 0, d6_overall_revenue: 0,
                d15_overall_con: 0, d15_overall_revenue: 0,
                d30_overall_con: 0, d30_overall_revenue: 0,
                d60_overall_con: 0, d60_overall_revenue: 0,
                p0_signup: 0, p1_signup: 0, total_trial: 0
            };
        }
        var ma = matureAgg[adUid2];
        ma.spend += (gr2.spend || (gr2.cost_micros ? gr2.cost_micros / 1000000 : 0)) * 1.18;
        ma.impressions += gr2.impressions || 0;
        ma.clicks += gr2.clicks || 0;
        ma.installs += gr2.installs || gr2.conversions || 0;
        // Funnel match for mature dates
        var mbKey2 = rowDate2 + '|||' + normalizeGoogleJoinText(gr2.campaign_name) + '|||' + normalizeGoogleJoinText(gr2.adset_name || gr2.adgroup_name);
        var mb2 = mbDaily[mbKey2];
        if (mb2) {
            ma.signups += mb2.signups; ma.d0_trial += mb2.d0_trial; ma.d0 += mb2.d0;
            ma.d0_revenue += mb2.d0_revenue; ma.d6 += mb2.d6; ma.d6_revenue += mb2.d6_revenue;
            ma.overall_revenue += mb2.overall_revenue;
            ma.d6_overall_con += mb2.d6_overall_con; ma.d6_overall_revenue += mb2.d6_overall_revenue;
            ma.d15_overall_con += mb2.d15_overall_con; ma.d15_overall_revenue += mb2.d15_overall_revenue;
            ma.d30_overall_con += mb2.d30_overall_con; ma.d30_overall_revenue += mb2.d30_overall_revenue;
            ma.d60_overall_con += mb2.d60_overall_con; ma.d60_overall_revenue += mb2.d60_overall_revenue;
            ma.p0_signup += mb2.p0_signup; ma.p1_signup += mb2.p1_signup; ma.total_trial += mb2.total_trial;
        }
    }

    // Derive metrics and classify each adset
    var adsets = Object.values(adAgg).filter(function(x) { return x.spend > 0 || x.signups > 0; }).map(function(a) {
        var adUidKey = normalizeGoogleJoinText(a.adset_name || '');
        var campaignSettingsRow = campaignSettingsById[String(a.campaign_id || '')] || null;
        var adgroupSettingsRow = adgroupSettingsById[String(a.adset_id || '')] || null;
        var breakdownList = breakdownsByAdgroup[String(a.adset_id || '')] || [];
        var audienceList = audiencesByAdgroup[String(a.adset_id || '')] || [];
        var keywordList = keywordsByAdgroup[String(a.adset_id || '')] || [];
        var searchTermList = searchTermsByAdgroup[String(a.adset_id || '')] || [];
        var assetGroupList = assetGroupsByCampaign[String(a.campaign_id || '')] || [];

        // Detect maturity from campaign name date suffix (_DDMMYY)
        var campDateMatch = (a.campaign_name || '').match(/(\d{6})$/);
        var goLiveISO = null;
        if (campDateMatch) {
            var dd = campDateMatch[1].slice(0, 2), mm = campDateMatch[1].slice(2, 4), yy = campDateMatch[1].slice(4, 6);
            goLiveISO = '20' + yy + '-' + mm + '-' + dd;
        }
        a.daysLive = goLiveISO ? Math.max(0, Math.round((Date.now() - new Date(goLiveISO).getTime()) / 86400000)) : 0;
        a.isMatured = a.daysLive >= GOOGLE_DECISION_MATURITY_DAYS;
        a.goLiveDate = goLiveISO || '';

        // For matured campaigns: use mature data (excl. last 7 days)
        // For immature campaigns: use all data but mark as "early"
        var evalData = a;
        a._evalMode = 'full_early';
        if (a.isMatured && matureAgg[adUidKey]) {
            evalData = Object.assign({}, a, matureAgg[adUidKey]);
            a._evalMode = 'mature';
        } else if (a.isMatured) {
            a._evalMode = 'full_fallback';
        }
        a._evalRaw = rawFromItem(evalData);

        var derived = deriveMetrics(a._evalRaw);
        a.cpi = derived.cpi;
        a.ctr = derived.ctr;
        a.cpm = derived.cpm;
        a.signupCost = derived.signupCost;
        a.signupPct = derived.signupPct;
        a.d0TrialCost = derived.d0TrialCost;
        a.d6CAC = derived.d6CAC;
        a.d6ROAS = derived.d6ROAS;
        a.d6Rev = derived.d6Rev;
        a.d15ROAS = derived.d15ROAS;
        a.d30ROAS = derived.d30ROAS;
        a.overallROAS = derived.overallROAS;
        a.campType = detectCampaignType(a.campaign_name, a.campaign_type);
        a.settings = {
            campaign: campaignSettingsRow,
            adgroup: adgroupSettingsRow,
            breakdowns: breakdownList,
            audiences: audienceList,
            keywords: keywordList,
            searchTerms: searchTermList,
            assetGroups: assetGroupList
        };
        a.searchAudit = buildGoogleSearchOperatorAudit(a);
        a.settingsAudit = buildGoogleSettingsAudit(a);
        a.evalSpend = a._evalRaw.spend;
        a.evalInstalls = a._evalRaw.installs;
        a.evalSignups = a._evalRaw.signups;
        a.evalD6 = a._evalRaw.d6_overall_con || a._evalRaw.d6 || 0;
        a.evalDataLabel = a._evalMode === 'mature'
            ? 'Mature data (excluding last 7 days)'
            : (a._evalMode === 'full_fallback'
                ? 'Full data (no mature window available in selected range)'
                : 'Full data (campaign still early / not mature yet)');

        // Classify optimization action — only on mature data
        if (!a.isMatured) {
            a.recommendation = { action: 'TOO EARLY', color: 'var(--text-dim)', reason: 'Campaign is only ' + a.daysLive + ' days old — needs ' + GOOGLE_DECISION_MATURITY_DAYS + '+ days for reliable evaluation', impact: 'Let it run, reassess after day ' + GOOGLE_DECISION_MATURITY_DAYS, priority: 'P3' };
        } else {
            a.recommendation = classifyAction(a._evalRaw.spend > 0 ? { spend: a._evalRaw.spend, d6ROAS: derived.d6ROAS, signups: a._evalRaw.signups, cpi: derived.cpi, signupCost: derived.signupCost } : a);
        }

        // Check WoW CPI trend
        a.cpiTrend = checkCPITrend(a);
        if (a.cpiTrend && a.cpiTrend.direction === 'up' && a.cpiTrend.pct > 30) {
            if (a.recommendation.action !== 'PAUSE' && a.recommendation.action !== 'TOO EARLY') {
                a.recommendation.flags = a.recommendation.flags || [];
                a.recommendation.flags.push('CPI rising ' + a.cpiTrend.pct.toFixed(0) + '% WoW (' + fmtINR(a.cpiTrend.cpi2) + ' \u2192 ' + fmtINR(a.cpiTrend.cpi1) + ')');
            }
        }

        return a;
    });

    var benchmarks = buildGoogleBenchmarks(adsets);
    buildGoogleWoWContext(adsets, googleRows, funnelRows);
    adsets.forEach(function(a) {
        if (!a.isMatured) return;
        a.recommendation = classifyActionAgainstBenchmarks(a, benchmarks);
        if (a.campType === 'Search' && a.searchAudit && a.searchAudit.actions.length) {
            a.recommendation.reason += ' Search action: ' + a.searchAudit.actions[0] + '.';
        } else if (a.campType === 'PMax' && a.settings && a.settings.assetGroups && a.settings.assetGroups.length === 0) {
            a.recommendation.reason += ' PMax asset-group metadata is thin — review asset coverage before scaling.';
        } else if (a.campType === 'PMax' && a.settings && a.settings.assetGroups && a.settings.assetGroups.length > 0) {
            a.recommendation.reason += ' PMax asset groups are available — use asset coverage and strength before broad budget changes.';
        } else if ((a.campType === 'Display' || a.campType === 'Video') && a.settings && a.settings.breakdowns && a.settings.breakdowns.length) {
            a.recommendation.reason += ' Channel check: validate network/device pockets before broad budget changes.';
        } else if (a.campType === 'UAC') {
            a.recommendation.reason += ' App campaign actions should prioritize bid/budget discipline over manual targeting edits.';
        }
        if (a.cpiTrend && a.cpiTrend.direction === 'up' && a.cpiTrend.pct > 30 && a.recommendation.action !== 'PAUSE') {
            a.recommendation.flags = a.recommendation.flags || [];
            a.recommendation.flags.push('CPI rising ' + a.cpiTrend.pct.toFixed(0) + '% WoW (' + fmtINR(a.cpiTrend.cpi2) + ' → ' + fmtINR(a.cpiTrend.cpi1) + ')');
        }
    });

    var treeSnapshot = readGoogleTreeSnapshotForRange(dr);
    var treeFromSnapshot = null;
    if ((!treeSnapshot || !treeSnapshot.tree) && typeof window.fetchCampaignTree === 'function') {
        try {
            progressCb('Loading Google campaign-tree enrichment for optimizer...');
            await window.fetchCampaignTree();
        } catch (treeErr) {}
        treeSnapshot = readGoogleTreeSnapshotForRange(dr);
    }
    if (treeSnapshot && treeSnapshot.tree) {
        var mergedSnapshot = mergeGoogleTreeSnapshot(adsets, {}, treeSnapshot);
        adsets = mergedSnapshot.adsets || adsets;
        treeFromSnapshot = treeSnapshot.tree || mergedSnapshot.tree || null;
        progressCb('Using cached Google campaign-tree enrichment while live scan warms up...');
    }

    benchmarks = buildGoogleBenchmarks(adsets);
    buildGoogleWoWContext(adsets, googleRows, funnelRows);
    adsets.forEach(function(a) {
        if (!a.isMatured) return;
        a.recommendation = classifyActionAgainstBenchmarks(a, benchmarks);
        if (a.campType === 'Search' && a.searchAudit && a.searchAudit.actions.length) {
            a.recommendation.reason += ' Search action: ' + a.searchAudit.actions[0] + '.';
        } else if (a.campType === 'PMax' && a.settings && a.settings.assetGroups && a.settings.assetGroups.length === 0) {
            a.recommendation.reason += ' PMax asset-group metadata is thin â€” review asset coverage before scaling.';
        } else if (a.campType === 'PMax' && a.settings && a.settings.assetGroups && a.settings.assetGroups.length > 0) {
            a.recommendation.reason += ' PMax asset groups are available â€” use asset coverage and strength before broad budget changes.';
        } else if ((a.campType === 'Display' || a.campType === 'Video') && a.settings && a.settings.breakdowns && a.settings.breakdowns.length) {
            a.recommendation.reason += ' Channel check: validate network/device pockets before broad budget changes.';
        } else if (a.campType === 'UAC') {
            a.recommendation.reason += ' App campaign actions should prioritize bid/budget discipline over manual targeting edits.';
        }
        if (a.cpiTrend && a.cpiTrend.direction === 'up' && a.cpiTrend.pct > 30 && a.recommendation.action !== 'PAUSE') {
            a.recommendation.flags = a.recommendation.flags || [];
            a.recommendation.flags.push('CPI rising ' + a.cpiTrend.pct.toFixed(0) + '% WoW (' + fmtINR(a.cpiTrend.cpi2) + ' â†’ ' + fmtINR(a.cpiTrend.cpi1) + ')');
        }
    });

    // Build campaign tree; prefer the campaign-tree snapshot when available because it
    // already has the trusted campaign/adgroup rollup used by the tree view.
    var tree = {};
    if (treeFromSnapshot && Object.keys(treeFromSnapshot).length) {
        tree = treeFromSnapshot;
    } else {
        for (var ti = 0; ti < adsets.length; ti++) {
            var as = adsets[ti];
            if (!tree[as.campaign_name]) {
                tree[as.campaign_name] = {
                    name: as.campaign_name, id: as.campaign_id,
                    type: as.campType, adsets: {},
                    settings: { campaign: campaignSettingsById[String(as.campaign_id || '')] || null }
                };
            }
            tree[as.campaign_name].adsets[as.adset_name] = as;
        }
    }

    // Normalize campaign/adset totals and recommendations regardless of source tree.
    for (var ck2 in tree) {
        var campNode = tree[ck2] || {};
        if (!campNode.totals) {
            var campAdsets2 = Object.values(campNode.adsets || {});
            campNode.totals = sumEvaluated(campAdsets2);
        }
        campNode.totals.campType = campNode.type || campNode.totals.campType || '';
        campNode.recommendation = campNode.recommendation || classifyActionAgainstBenchmarks(campNode.totals, benchmarks);
        Object.keys(campNode.adsets || {}).forEach(function(adsetKey) {
            var adsetNode = campNode.adsets[adsetKey] || {};
            adsetNode.totals = adsetNode.totals || adsetNode;
            adsetNode.recommendation = adsetNode.recommendation || classifyActionAgainstBenchmarks(adsetNode.totals, benchmarks);
            campNode.adsets[adsetKey] = adsetNode;
        });
        tree[ck2] = campNode;
    }

    var rawTotals = deriveMetrics(sumRaw(adsets));
    var evaluatedTotals = sumEvaluated(adsets);
    var pauseCount = adsets.filter(function(x) { return x.recommendation.action === 'PAUSE'; }).length;
    var scaleCount = adsets.filter(function(x) { return x.recommendation.action === 'SCALE'; }).length;
    var reduceCount = adsets.filter(function(x) { return x.recommendation.action === 'REDUCE BUDGET'; }).length;
    var watchCount = adsets.filter(function(x) { return x.recommendation.action === 'WATCH'; }).length;
    var maturedCount = adsets.filter(function(x) { return x._evalMode === 'mature'; }).length;
    var matchedAdsets = adsets.filter(function(x) { return x._matched; }).length;
    var matchedSpend = adsets.filter(function(x) { return x._matched; }).reduce(function(sum, x) { return sum + (x.evalSpend || 0); }, 0);
    var totalEvalSpend = adsets.reduce(function(sum, x) { return sum + (x.evalSpend || 0); }, 0);
    var campaignCoveragePct = Object.keys(tree).length > 0 ? (campaignSettings.length / Object.keys(tree).length) * 100 : 0;
    var adgroupCoveragePct = adsets.length > 0 ? (adgroupSettings.length / adsets.length) * 100 : 0;
    var freshStatusPct = Math.max(0, Math.min(100, Math.round((campaignCoveragePct * 0.4) + (adgroupCoveragePct * 0.6))));
    var adCoveragePct = adsets.length > 0 ? (matchedAdsets / adsets.length) * 100 : 0;
    var spendCoveragePct = totalEvalSpend > 0 ? (matchedSpend / totalEvalSpend) * 100 : 0;
    var weightedMedianCoherent = benchmarks.eligible_count >= Math.max(5, Math.round(maturedCount * 0.2));
    var optimizerLoop = buildGoogleOptimizerLoop(adsets, tree, benchmarks, {
        adCoveragePct: adCoveragePct,
        spendCoveragePct: spendCoveragePct,
        freshStatusPct: freshStatusPct,
        weightedMedianCoherent: weightedMedianCoherent
    }, scanResult);
    pauseCount = adsets.filter(function(x) { return x.recommendation.action === 'PAUSE'; }).length;
    scaleCount = adsets.filter(function(x) { return x.recommendation.action === 'SCALE'; }).length;
    reduceCount = adsets.filter(function(x) { return x.recommendation.action === 'REDUCE BUDGET'; }).length;
    watchCount = adsets.filter(function(x) { return x.recommendation.action === 'WATCH'; }).length;

    var sourceDeliveryRaw = emptyRaw();
    for (var sr = 0; sr < googleRows.length; sr++) {
        var gsr = googleRows[sr];
        sourceDeliveryRaw.spend += (Number(gsr.spend) || Number(gsr.cost_micros) / 1000000 || 0) * 1.18;
        sourceDeliveryRaw.impressions += Number(gsr.impressions) || 0;
        sourceDeliveryRaw.clicks += Number(gsr.clicks) || 0;
        sourceDeliveryRaw.installs += Number(gsr.installs || gsr.conversions) || 0;
    }
    var sourceFunnelRaw = emptyRaw();
    for (var fr = 0; fr < funnelRows.length; fr++) {
        var frr = funnelRows[fr];
        sourceFunnelRaw.signups += Number(frr.signups) || 0;
        sourceFunnelRaw.p0_signup += Number(frr.p0_signup) || 0;
        sourceFunnelRaw.p1_signup += Number(frr.p1_signup) || 0;
        sourceFunnelRaw.total_trial += Number(frr.total_trial) || 0;
        sourceFunnelRaw.d0_trial += Number(frr.d0_trial) || 0;
        sourceFunnelRaw.d0 += Number(frr.d0) || 0;
        sourceFunnelRaw.d0_revenue += Number(frr.d0_revenue) || 0;
        sourceFunnelRaw.d6 += Number(frr.d6) || 0;
        sourceFunnelRaw.d6_revenue += Number(frr.d6_revenue) || 0;
        sourceFunnelRaw.overall_revenue += Number(frr.overall_revenue) || 0;
        sourceFunnelRaw.d6_overall_con += Number(frr.d6_overall_con) || 0;
        sourceFunnelRaw.d6_overall_revenue += Number(frr.d6_overall_revenue) || 0;
        sourceFunnelRaw.d15_overall_con += Number(frr.d15_overall_con) || 0;
        sourceFunnelRaw.d15_overall_revenue += Number(frr.d15_overall_revenue) || 0;
        sourceFunnelRaw.d30_overall_con += Number(frr.d30_overall_con) || 0;
        sourceFunnelRaw.d30_overall_revenue += Number(frr.d30_overall_revenue) || 0;
        sourceFunnelRaw.d60_overall_con += Number(frr.d60_overall_con) || 0;
        sourceFunnelRaw.d60_overall_revenue += Number(frr.d60_overall_revenue) || 0;
    }
    var sourceTotals = deriveMetrics(Object.assign(emptyRaw(), sourceDeliveryRaw, sourceFunnelRaw));
    var sourceSpend = Number(sourceTotals.spend || 0);
    var evalSpendCheck = Number(evaluatedTotals.spend || 0);
    var adsetTotals = deriveMetrics(sumRaw(adsets));
    if (adsetTotals && Number(adsetTotals.spend || 0) > 0) {
        sourceTotals = mergeMetricsPreferNonZero(sourceTotals, adsetTotals);
        sourceSpend = Number(sourceTotals.spend || 0);
    }
    if (sourceSpend <= 0 && treeSnapshot && treeSnapshot.totals && Number(treeSnapshot.totals.spend || 0) > 0) {
        sourceTotals = mergeMetricsPreferNonZero(sourceTotals, treeSnapshot.totals);
        sourceSpend = Number(sourceTotals.spend || 0);
    }
    if (sourceSpend <= 0 && evalSpendCheck <= 0) {
        var zeroSpendError = 'No spend-bearing Google data returned for the selected range.';
        var cachedZeroSpend = getGcCachedScan(dr);
        if (cachedZeroSpend && cachedZeroSpend.scan) {
            GC_OPT_SCAN = cachedZeroSpend.scan;
            GC_OPT_SCAN_ERROR = zeroSpendError + ' — showing cached Google scan';
            setPortalLoadState('cached', 'Cached Google optimizer');
            return cachedZeroSpend.scan;
        }
        throw new Error(zeroSpendError);
    }

    var accountTotals = mergeMetricsPreferNonZero(sourceTotals, adsetTotals);
    if (treeSnapshot && treeSnapshot.totals && Number(treeSnapshot.totals.spend || 0) > 0) {
        accountTotals = mergeMetricsPreferNonZero(accountTotals, treeSnapshot.totals);
    }
    if (Number(accountTotals.spend || 0) <= 0) {
        accountTotals = sourceTotals;
    }

    var scanResult = {
        scan_date: new Date().toISOString(),
        date_range: dr,
        tree: tree,
        adsets: adsets,
        campaign_settings: campaignSettings,
        adgroup_settings: adgroupSettings,
        ads: creativeRows.map(function(row) {
            var content = safeJsonParse(row.creative_content_json, {});
            var ad = {
                id: row.id,
                ad_id: row.ad_id,
                campaign_id: row.campaign_id,
                campaign_name: row.campaign_name || '',
                adgroup_id: row.adgroup_id,
                adgroup_name: row.adgroup_name || '',
                ad_type: row.ad_type || '',
                ad_status: row.ad_status || '',
                asset_performance_label: row.asset_performance_label || '',
                gcps_score: row.gcps_score,
                ad_spend: Number(row.ad_spend) || 0,
                ad_impressions: Number(row.ad_impressions) || 0,
                ad_clicks: Number(row.ad_clicks) || 0,
                ad_conversions: Number(row.ad_conversions) || 0,
                ad_conversion_value: Number(row.ad_conversion_value) || 0,
                ad_ctr: Number(row.ad_ctr) || 0,
                ad_cpc: Number(row.ad_cpc) || 0,
                ad_cpa: Number(row.ad_cpa) || 0,
                adset_roas: Number(row.adset_roas) || 0,
                content: content
            };
            ad.adAudit = buildGoogleAdAudit(ad);
            return ad;
        }),
        ad_daily: adsDailyRows,
        app_asset_performance: appAssetPerformanceRes && appAssetPerformanceRes.data ? appAssetPerformanceRes.data : {},
        benchmarks: benchmarks,
        settingsCoverage: {
            campaigns: campaignSettings.length,
            adgroups: adgroupSettings.length,
            breakdowns: breakdownRows.length,
            audiences: audienceRows.length,
            keywords: keywordRows.length,
            searchTerms: searchTermRows.length,
            assetGroups: assetGroupRows.length,
            ads: creativeRows.length,
            appAssets: appAssetPerformanceRes && appAssetPerformanceRes.data ? (appAssetPerformanceRes.data.total_rows || 0) : 0
        },
        integrity: {
            adCoveragePct: adCoveragePct,
            spendCoveragePct: spendCoveragePct,
            freshStatusPct: freshStatusPct,
            weightedMedianCoherent: weightedMedianCoherent
        },
        rawTotals: accountTotals,
        optimizerLoop: optimizerLoop,
        _trendSource: {
            googleRows: googleRows,
            funnelRows: funnelRows,
            adsDailyRows: adsDailyRows
        },
        funnel_source_state: funnelSourceState,
        funnel_source_label: funnelSourceLabel,
        funnel_source_warning: funnelRes && funnelRes.warning ? String(funnelRes.warning) : '',
        evaluatedTotals: evaluatedTotals,
        summary: {
            total_campaigns: Object.keys(tree).length,
            total_adsets: adsets.length,
            total_spend: accountTotals.spend || 0,
            pause_count: pauseCount,
            scale_count: scaleCount,
            reduce_count: reduceCount,
            watch_count: watchCount,
            matched_keys: matchedKeys,
            unmatched_keys: unmatchedKeys,
            matured_adsets: maturedCount,
            early_adsets: adsets.length - maturedCount,
            matched_adsets: matchedAdsets,
            ad_coverage_pct: adCoveragePct,
            spend_coverage_pct: spendCoveragePct,
            fresh_status_pct: freshStatusPct,
            optimizer_loop_pause: optimizerLoop.output.pause,
            optimizer_loop_reduce: optimizerLoop.output.reduce,
            optimizer_loop_scale: optimizerLoop.output.scale,
            optimizer_loop_optimize: optimizerLoop.output.optimize,
            optimizer_loop_maintain: optimizerLoop.output.maintain,
            optimizer_loop_watch: optimizerLoop.output.watch,
            weighted_median_coherent: weightedMedianCoherent,
        }
    };

    GC_OPT_SCAN = scanResult;
    GC_OPT_SCAN_ERROR = null;
    if ((scanResult.rawTotals && scanResult.rawTotals.spend > 0) || (scanResult.evaluatedTotals && scanResult.evaluatedTotals.spend > 0)) {
        setGcCachedScan(dr, scanResult);
    }
    setPortalLoadState('fresh', 'Fresh');
    return scanResult;
    } catch (innerErr) {
        var cached = getGcCachedScan(dr);
        if (cached && cached.scan) {
            GC_OPT_SCAN = cached.scan;
            GC_OPT_SCAN_ERROR = (innerErr && innerErr.message ? innerErr.message : 'scan error') + ' — showing cached Google scan';
            setPortalLoadState('cached', 'Cached Google optimizer');
            return cached.scan;
        }
        GC_OPT_SCAN = null;
        GC_OPT_SCAN_ERROR = innerErr && innerErr.message ? innerErr.message : 'scan error';
        setPortalLoadState('fresh', 'Fresh');
        return null;
    }
}

// ══════════════════════════════════════════════════════════════════
// UI RENDERING
// ══════════════════════════════════════════════════════════════════

window.renderGcOptimizer = function() {
    var container = document.getElementById('gcOptimizerContent');
    if (!container) return;
    var optimizerUiMode = GC_OPT_EMBED_MODE === 'optimizer' || GC_OPT_URL_PARAMS.get('view') === 'gcOptimizer';
    var cachedStamp = GC_OPT_SCAN && (GC_OPT_SCAN._cached_at || GC_OPT_SCAN.fetched_at || GC_OPT_SCAN.generated_at || GC_OPT_SCAN.last_updated_at);
    clearUntrustworthyOptimizerScan();

    if (optimizerUiMode && !GC_OPT_SCAN) {
        var cached = getGcCachedScan(getSelectedDates());
        if (cached && cached.scan && isTrustworthyOptimizerScan(cached.scan)) {
            GC_OPT_SCAN = cached.scan;
            GC_OPT_SCAN_ERROR = 'Showing cached Google optimizer scan while refreshing latest data.';
            setPortalLoadState('cached', 'Cached Google optimizer');
        }
    }

    if (optimizerUiMode && !GC_OPT_AUTO_SCAN_PENDING && !GC_OPT_AUTO_SCAN_STARTED) {
        GC_OPT_AUTO_SCAN_STARTED = true;
        GC_OPT_AUTO_SCAN_PENDING = true;
        scanGoogleAccount(function() {}).then(function() {
            GC_OPT_AUTO_SCAN_PENDING = false;
            GC_OPT_SCAN_ERROR = null;
            window.renderGcOptimizer();
        }).catch(function() {
            GC_OPT_AUTO_SCAN_PENDING = false;
            GC_OPT_SCAN_ERROR = GC_OPT_SCAN_ERROR || 'Google optimizer scan failed';
            window.renderGcOptimizer();
        });
    } else if (optimizerUiMode && !GC_OPT_AUTO_SCAN_PENDING && (!GC_OPT_SCAN || GC_OPT_SCAN_ERROR)) {
        GC_OPT_AUTO_SCAN_PENDING = true;
        scanGoogleAccount(function() {}).then(function() {
            GC_OPT_AUTO_SCAN_PENDING = false;
            GC_OPT_SCAN_ERROR = null;
            window.renderGcOptimizer();
        }).catch(function() {
            GC_OPT_AUTO_SCAN_PENDING = false;
            GC_OPT_SCAN_ERROR = GC_OPT_SCAN_ERROR || 'Google optimizer scan failed';
            window.renderGcOptimizer();
        });
    }

    if (optimizerUiMode) {
        renderScanStage(container);
    } else if (GC_OPT_STAGE === 'plan' && GC_OPT_SCAN) {
        renderPlanStage(container);
    } else {
        renderScanStage(container);
    }
};

// ── SCAN STAGE ──

function renderScanStage(container) {
    var dr = getDefaultDates();
    var optimizerUiMode = GC_OPT_EMBED_MODE === 'optimizer' || GC_OPT_URL_PARAMS.get('view') === 'gcOptimizer';
    var cachedStamp = GC_OPT_SCAN && (GC_OPT_SCAN._cached_at || GC_OPT_SCAN.fetched_at || GC_OPT_SCAN.generated_at || GC_OPT_SCAN.last_updated_at);
    var funnelSourceLabel = GC_OPT_SCAN && GC_OPT_SCAN.funnel_source_label ? GC_OPT_SCAN.funnel_source_label : '';
    var funnelSourceState = GC_OPT_SCAN && GC_OPT_SCAN.funnel_source_state ? GC_OPT_SCAN.funnel_source_state : '';
    var funnelSourceWarning = GC_OPT_SCAN && GC_OPT_SCAN.funnel_source_warning ? GC_OPT_SCAN.funnel_source_warning : '';
    var funnelBadgeColor = funnelSourceState === 'cached' ? 'var(--orange)' : (funnelSourceState === 'degraded' ? 'var(--red)' : 'var(--green)');

    var html = '<div class="ci-panel">' +
        '<h2 style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">' +
            '<span style="font-size:22px;">&#9889;</span> Optimizer' +
        '</h2>' +
        '<p style="color:var(--text-dim);font-size:13px;margin-bottom:20px;">Input sources &#8594; raw-first processing &#8594; 29-day / WoW-aware recommendations &#8594; execution-ready actions for supported changes</p>' +
        (cachedStamp ? '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--green);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
            '<div>Last refreshed: ' + esc(formatRefreshStamp(cachedStamp)) + (GC_OPT_SCAN && GC_OPT_SCAN._cached_at ? ' | Cached scan shown while fresh data loads.' : '') + '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                (funnelSourceLabel ? '<span style="padding:3px 8px;border-radius:999px;border:1px solid ' + funnelBadgeColor + ';color:' + funnelBadgeColor + ';font-size:10px;font-weight:700;">Funnel: ' + esc(funnelSourceLabel) + '</span>' : '') +
                (funnelSourceWarning ? '<span style="font-size:10px;color:var(--text-dim);">Metabase fallback active</span>' : '') +
            '</div>' +
        '</div>' : '') +

        '<div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap;">' +
            '<label style="font-size:12px;color:var(--text-dim);">Date Range:</label>' +
            '<input type="date" id="gcOptDateFrom" value="' + dr.since + '" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px;">' +
            '<span style="color:var(--text-dim);">to</span>' +
            '<input type="date" id="gcOptDateTo" value="' + dr.until + '" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px;">' +
        '</div>';

    if (!GC_OPT_SCAN) {
        if (optimizerUiMode) {
            html += '<div style="' + CS + '">' +
                '<h3 style="font-size:15px;font-weight:600;margin-bottom:8px;">Loading optimizer data...</h3>' +
                '<p style="font-size:13px;color:var(--text-dim);margin-bottom:8px;">Fetching Google Ads + Metabase data so the optimizer can render the same operator view as Meta.</p>' +
                '<div style="font-size:12px;color:var(--text-dim);">If this takes a moment, the optimizer is still building the same raw-first scan used for analytics and recommendations.</div>' +
                (GC_OPT_SCAN_ERROR ? '<div style="margin-top:12px;padding:12px 14px;border-radius:8px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);color:var(--red);font-size:12px;">' + esc(GC_OPT_SCAN_ERROR) + '</div>' : '') +
                '<div style="margin-top:14px;"><button id="gcOptScanBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 28px;">&#128270; Retry Scan</button></div>' +
            '</div>';
        } else {
        html += '<div style="' + CS + '">' +
            '<h3 style="font-size:15px;font-weight:600;margin-bottom:8px;">Step 1: Scan Account</h3>' +
            '<p style="font-size:13px;color:var(--text-dim);margin-bottom:16px;">Fetches all campaigns and ad groups from Google Ads API. Enriches with Metabase funnel data (signups, D0 trials, D6 conversions, revenue). Applies rule-based optimization logic.</p>' +
            '<button id="gcOptScanBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 28px;">&#128270; Scan Google Ads</button>' +
            '<div id="gcOptScanProgress" style="display:none;margin-top:16px;font-size:13px;color:var(--text-dim);"></div>' +
        '</div>';
        }
    } else {
        try {
            html += renderAccountOverview(GC_OPT_SCAN);
        } catch (err) {
            GC_OPT_SCAN_ERROR = err && err.message ? err.message : 'Render failed';
            html += renderGoogleScanErrorCard(GC_OPT_SCAN_ERROR, GC_OPT_SCAN);
        }
    }

    html += '</div>';
    container.innerHTML = html;
    bindScanEvents(container);
}

function renderGoogleScanErrorCard(message, scan) {
    var s = scan && scan.summary ? scan.summary : {};
    var totals = getGoogleAccountTotals(scan);
    return '<div style="' + CS + '">' +
        '<h3 style="font-size:15px;font-weight:600;margin-bottom:8px;">Google optimizer render error</h3>' +
        '<p style="font-size:13px;color:var(--text-dim);margin-bottom:8px;">' + esc(message || 'Unknown render error') + '</p>' +
        '<div style="font-size:12px;color:var(--text);line-height:1.7;">' +
            'Campaigns: <strong>' + esc(String(s.total_campaigns || 0)) + '</strong> &nbsp; ' +
            'Ad groups: <strong>' + esc(String(s.total_adsets || 0)) + '</strong> &nbsp; ' +
            'Spend: <strong>' + esc(fmtINR(totals.spend || 0)) + '</strong> &nbsp; ' +
            'D6 ROAS: <strong>' + esc(fmtPct(totals.d6ROAS || 0)) + '</strong>' +
        '</div>' +
        '<div style="margin-top:12px;"><button id="gcOptScanBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 28px;">&#128270; Retry Scan</button></div>' +
    '</div>';
}

function renderGoogleOptimizerLoopSummary(scan) {
    var loop = scan && scan.optimizerLoop ? scan.optimizerLoop : null;
    if (!loop) return '';
    var warnings = loop.warnings || [];
    var dateRangeLabel = (scan.date_range && scan.date_range.since ? scan.date_range.since : '--') + ' → ' + (scan.date_range && scan.date_range.until ? scan.date_range.until : '--');
    var rawTotals = getGoogleAccountTotals(scan);
    var evalTotals = scan.evaluatedTotals || null;
    var trend = loop.trend || {};
    var sourceCoverage = loop.source_coverage || scan.settingsCoverage || {};
    return '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Meta-Style Input → Process → Output</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">' +
            '<div><div style="font-size:10px;color:var(--text-dim);margin-bottom:4px;">Input</div><div style="font-size:11px;color:var(--text);line-height:1.6;">Data Range: ' + esc(dateRangeLabel) + '<br>' + esc(loop.input.sources.join(', ')) + '<br>Decision maturity: ' + esc(String(loop.input.maturity_days)) + ' days</div></div>' +
            '<div><div style="font-size:10px;color:var(--text-dim);margin-bottom:4px;">Process</div><div style="font-size:11px;color:var(--text);line-height:1.6;">Recent week: ' + esc(trend.recent_week_mode || 'trial-first') + '<br>' + esc(trend.note || 'Recent week is trial-first; D6 ROAS is secondary until maturity.') + '<br>Layers: ' + esc(loop.process.layers.join(' + ')) + '</div></div>' +
            '<div><div style="font-size:10px;color:var(--text-dim);margin-bottom:4px;">Output</div><div style="font-size:11px;color:var(--text);line-height:1.6;">Pause ' + esc(String(loop.output.pause)) + ' | Reduce ' + esc(String(loop.output.reduce)) + ' | Scale ' + esc(String(loop.output.scale)) + '<br>Optimize ' + esc(String(loop.output.optimize)) + ' | Maintain ' + esc(String(loop.output.maintain)) + ' | Watch ' + esc(String(loop.output.watch)) + '<br>Raw spend: ' + esc(fmtINR((rawTotals && rawTotals.spend) || 0)) + ' | Eval spend: ' + esc(fmtINR((evalTotals && evalTotals.spend) || 0)) + '</div></div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">' +
            '<span style="padding:2px 8px;border-radius:999px;border:1px solid var(--border);font-size:9px;color:var(--text-dim);">Recovery ' + esc(String(trend.recovery_count || 0)) + '</span>' +
            '<span style="padding:2px 8px;border-radius:999px;border:1px solid var(--border);font-size:9px;color:var(--text-dim);">Decline ' + esc(String(trend.decline_count || 0)) + '</span>' +
            '<span style="padding:2px 8px;border-radius:999px;border:1px solid var(--border);font-size:9px;color:var(--text-dim);">Trial-first ' + esc(String(trend.trial_first_count || 0)) + '</span>' +
            '<span style="padding:2px 8px;border-radius:999px;border:1px solid var(--border);font-size:9px;color:var(--text-dim);">Assets ' + esc(String(sourceCoverage.appAssets || sourceCoverage.ads || 0)) + '</span>' +
        '</div>' +
        (warnings.length ? '<div style="font-size:10px;color:var(--orange);margin-top:10px;">' + warnings.map(function(w) { return '&#9888; ' + esc(w); }).join('<br>') + '</div>' : '') +
    '</div>';
}

function renderGoogleCampaignActions(scan) {
    var loop = scan && scan.optimizerLoop ? scan.optimizerLoop : null;
    var items = loop && loop.campaignActions ? loop.campaignActions : [];
    if (!items.length) return '';
    return '<div style="' + CS + 'margin-bottom:16px;">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Campaign Actions</h3>' +
        items.map(function(item) {
            var color = /SCALE/.test(item.action) ? 'var(--green)' : (/CUT|PAUSE/.test(item.action) ? 'var(--orange)' : 'var(--accent)');
            return '<div style="' + CARD + 'margin-bottom:8px;border-left:3px solid ' + color + ';">' +
                '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">' +
                    '<div style="flex:1;min-width:0;">' +
                        '<div style="font-size:12px;font-weight:700;color:var(--text);">' + esc(item.campaign) + '</div>' +
                        '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;line-height:1.6;">' + esc(item.reason) + '</div>' +
                    '</div>' +
                    '<div style="padding:4px 8px;border-radius:6px;background:' + color + ';color:#fff;font-size:10px;font-weight:700;white-space:nowrap;">' + esc(item.action) + '</div>' +
                '</div>' +
            '</div>';
        }).join('') +
    '</div>';
}

// ── ACCOUNT OVERVIEW (after scan) ──

function renderGooglePausedRevampPanel(scan) {
    var paused = buildGooglePausedRevampRows(scan || GC_OPT_SCAN || { tree: {}, adsets: [], ads: [] });
    var context = paused.context || { summary: {} };
    function renderSection(title, rows) {
        var list = Array.isArray(rows) ? rows : [];
        return '<div style="' + CARD + 'margin-bottom:12px;">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">' + esc(title) + '</div>' +
            (list.length ? list.map(function(row) {
                return '<div style="padding:10px 0;border-bottom:1px solid var(--border);">' +
                    '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">' +
                        '<div style="flex:1;min-width:0;">' +
                            '<div style="font-size:12px;font-weight:700;color:var(--text);line-height:1.45;">' + esc(row.label || '--') + '</div>' +
                            '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(row.prevText || '') + '</div>' +
                            '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Budget: ' + esc(row.budgetText || row.budget_text || '--') + '</div>' +
                            '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Next step: ' + esc(row.nextStepText || row.next_step || row.budgetText || row.budget_text || '--') + '</div>' +
                            '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(row.deltaText || '') + '</div>' +
                            (row.assetSignalText ? '<div style="font-size:11px;color:var(--green);margin-top:4px;">Asset signal: ' + esc(row.assetSignalText) + '</div>' : '') +
                            '<div style="font-size:11px;color:var(--text);margin-top:6px;line-height:1.5;">Why: ' + esc(row.whyText || row.why_text || row.basis || '') + '</div>' +
                        '</div>' +
                        '<div style="padding:4px 8px;border-radius:999px;background:' + (/RELAUNCH/.test(String(row.currentText || '')) ? 'rgba(34,197,94,0.16)' : (/TEST/.test(String(row.currentText || '')) ? 'rgba(59,130,246,0.16)' : 'rgba(239,68,68,0.16)')) + ';color:' + (/RELAUNCH/.test(String(row.currentText || '')) ? 'var(--green)' : (/TEST/.test(String(row.currentText || '')) ? 'var(--blue)' : 'var(--orange)')) + ';font-size:10px;font-weight:700;white-space:nowrap;">' + esc(row.currentText || '--') + '</div>' +
                    '</div>' +
                    '<div style="font-size:11px;color:var(--text-dim);margin-top:6px;">Spend ' + esc(row.spendText || '--') + '</div>' +
                '</div>';
            }).join('') : '<div style="font-size:11px;color:var(--text-dim);">No paused relaunch candidates in this slice.</div>') +
        '</div>';
    }
    return '<div style="' + CARD + 'margin-top:12px;border-left:3px solid var(--accent);">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Paused Revamp</div>' +
        '<div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">Review paused campaigns, ad groups, and ads using the last active window. Campaign budget changes stay at campaign level only. Ad group and ad rows are relaunch or keep-paused decisions, not budget-shift rows.</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:12px;">' +
            '<div style="' + CARD + 'text-align:center;"><div style="font-size:16px;font-weight:700;color:var(--green);">' + esc(String(context.summary.paused_campaigns || 0)) + '</div><div style="font-size:9px;color:var(--text-dim);">Paused Campaigns</div></div>' +
            '<div style="' + CARD + 'text-align:center;"><div style="font-size:16px;font-weight:700;color:var(--blue);">' + esc(String(context.summary.paused_adgroups || 0)) + '</div><div style="font-size:9px;color:var(--text-dim);">Paused Ad Groups</div></div>' +
            '<div style="' + CARD + 'text-align:center;"><div style="font-size:16px;font-weight:700;color:var(--orange);">' + esc(String(context.summary.paused_ads || 0)) + '</div><div style="font-size:9px;color:var(--text-dim);">Paused Ads</div></div>' +
            '<div style="' + CARD + 'text-align:center;"><div style="font-size:16px;font-weight:700;color:var(--accent);">' + esc(String(context.summary.relaunch_candidates || 0)) + '</div><div style="font-size:9px;color:var(--text-dim);">Relaunch Candidates</div></div>' +
        '</div>' +
        renderSection('Campaign Relaunch Candidates', context.campaign_rows || []) +
        renderSection('Ad Group Relaunch Candidates', context.adgroup_rows || []) +
        renderSection('Ad Relaunch Candidates', context.ad_rows || []) +
    '</div>';
}

function renderGoogleAssetPlaybookSection(scan) {
    var playbook = buildGoogleAppAssetPlaybook(scan || {});
    if (!playbook || !playbook.type_rows || !playbook.type_rows.length) return '';
    var topTypes = (playbook.top_type_rows && playbook.top_type_rows.length ? playbook.top_type_rows : playbook.type_rows.slice(0, 5));
    var weakTypes = (playbook.weak_type_rows && playbook.weak_type_rows.length ? playbook.weak_type_rows : playbook.type_rows.slice(-5).reverse());
    var topGroups = (playbook.top_groups && playbook.top_groups.length ? playbook.top_groups : playbook.group_rows.slice(0, 6));
    var sourceLabel = playbook.source_mode === 'google_ads_api' ? 'Live Google Ads API' : (playbook.source_mode === 'csv_fallback' ? 'CSV fallback' : 'Unknown source');
    return '<div style="' + CARD + 'margin-top:16px;border-left:3px solid var(--green);">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:6px;">Asset Playbook</div>' +
        '<div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">Source: ' + esc(sourceLabel) + '. Use these app asset patterns to change the ad group, not just the summary. Description and headline are the main levers; deep links keep the conversion path alive; image-first variants are the first to replace.</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:12px;">' +
            '<div style="' + CARD + '"><div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:6px;">Winning Asset Types</div>' +
                topTypes.map(function(row) {
                    return '<div style="padding:6px 0;border-bottom:1px solid var(--border);">' +
                        '<div style="font-size:11px;font-weight:700;color:var(--text);">' + esc(row.app_asset_type || '--') + '</div>' +
                        '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Top asset: ' + esc(row.top_asset_text || '--') + '</div>' +
                        '<div style="font-size:10px;color:var(--accent);margin-top:4px;">Next step: ' + esc(row.next_step || '--') + '</div>' +
                    '</div>';
                }).join('') + '</div>' +
            '<div style="' + CARD + '"><div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:6px;">Weakest Asset Types</div>' +
                weakTypes.map(function(row) {
                    return '<div style="padding:6px 0;border-bottom:1px solid var(--border);">' +
                        '<div style="font-size:11px;font-weight:700;color:var(--text);">' + esc(row.app_asset_type || '--') + '</div>' +
                        '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Weak asset: ' + esc(row.weakest_asset_text || '--') + '</div>' +
                        '<div style="font-size:10px;color:var(--orange);margin-top:4px;">Why: ' + esc(row.why || '--') + '</div>' +
                    '</div>';
                }).join('') + '</div>' +
        '</div>' +
        '<div style="' + CARD + '"><div style="font-size:11px;font-weight:700;color:var(--text);margin-bottom:6px;">Ad Group Asset Scorecards</div>' +
            topGroups.slice(0, 6).map(function(row) {
                return '<div style="padding:8px 0;border-bottom:1px solid var(--border);">' +
                    '<div style="font-size:11px;font-weight:700;color:var(--text);">' + esc((row.campaign_name || '--') + ' â†’ ' + (row.adgroup_name || '--')) + '</div>' +
                    '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Winning type: ' + esc(row.winning_asset_type || '--') + ' | Winning asset: ' + esc(row.winning_asset_text || '--') + '</div>' +
                    '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Weakest type: ' + esc(row.weakest_asset_type || '--') + ' | Weak asset: ' + esc(row.weakest_asset_text || '--') + '</div>' +
                    '<div style="font-size:10px;color:var(--accent);margin-top:4px;">Next step: ' + esc(row.next_step || '--') + '</div>' +
                    '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Why: ' + esc(row.why || '--') + '</div>' +
                '</div>';
            }).join('') +
        '</div>' +
    '</div>';
}

function renderAccountOverview(scan) {
    var optimizerUiMode = GC_OPT_EMBED_MODE === 'optimizer' || GC_OPT_URL_PARAMS.get('view') === 'gcOptimizer';
    var s = scan.summary;
    var adsets = scan.adsets || [];
    var tree = scan.tree || {};
    var integrity = scan.integrity || {};
    var benchmarks = scan.benchmarks || {};
    var coverage = scan.settingsCoverage || {};
    var dateRangeLabel = (scan.date_range && scan.date_range.since ? scan.date_range.since : '--') + ' → ' + (scan.date_range && scan.date_range.until ? scan.date_range.until : '--');
    var maturityCardNote = buildMaturityNote(s, 'matured_adsets', 'early_adsets', 'ad group');

    var rawTotals = getGoogleAccountTotals(scan, adsets);
    var evalTotals = scan.evaluatedTotals || sumEvaluated(adsets);
    var blendedD6ROAS = rawTotals.d6ROAS;
    var avgCPI = rawTotals.cpi || 0;
    var avgSignupCost = rawTotals.signupCost || 0;
    var immatureAdsets = adsets.filter(function(a) { return !a.isMatured; });
    var immatureNames = immatureAdsets.slice(0, 4).map(function(a) { return a.adset_name || a.name || ''; }).filter(Boolean);

    // Health score
    var healthScore = 0;
    if (blendedD6ROAS > 50) healthScore += 30;
    else if (blendedD6ROAS > 28) healthScore += 22;
    else if (blendedD6ROAS > 15) healthScore += 12;
    else healthScore += 5;
    if (avgCPI > 0 && avgCPI < 100) healthScore += 20;
    else if (avgCPI > 0 && avgCPI < 150) healthScore += 12;
    else healthScore += 5;
    if (avgSignupCost > 0 && avgSignupCost < 500) healthScore += 20;
    else if (avgSignupCost > 0 && avgSignupCost < 1000) healthScore += 12;
    else if (avgSignupCost > 0) healthScore += 5;
    else healthScore += 10;
    var greenPct = s.total_adsets > 0 ? s.scale_count / s.total_adsets : 0;
    var redPct = s.total_adsets > 0 ? s.pause_count / s.total_adsets : 0;
    healthScore += Math.round(greenPct * 20);
    healthScore += Math.round((1 - redPct) * 10);
    healthScore = Math.min(100, Math.max(0, healthScore));
    var healthColor = healthScore >= 70 ? 'var(--green)' : healthScore >= 45 ? 'var(--orange)' : 'var(--red)';
    var healthLabel = healthScore >= 70 ? 'Good' : healthScore >= 45 ? 'Needs Work' : 'Critical';

    var html = '';
    if (GC_OPT_SCAN_ERROR) {
        html += '<div style="margin-bottom:16px;padding:12px 14px;border-radius:8px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);color:var(--orange);font-size:12px;">' + esc(GC_OPT_SCAN_ERROR) + '</div>';
    }

    // ── Health + KPIs ──
    html += '<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;align-items:stretch;">' +
        '<div style="' + CARD + 'min-width:140px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;">' +
            '<div style="width:80px;height:80px;border-radius:50%;border:4px solid ' + healthColor + ';display:flex;align-items:center;justify-content:center;">' +
                '<div style="font-size:28px;font-weight:800;color:' + healthColor + ';">' + healthScore + '</div>' +
            '</div>' +
            '<div style="font-size:11px;font-weight:700;color:' + healthColor + ';margin-top:4px;">' + healthLabel + '</div>' +
            '<div style="font-size:9px;color:var(--text-dim);">Account Health</div>' +
            '<div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div>' +
        '</div>' +
        '<div style="flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;">';

    var kpis = [
        { v: fmtINR(rawTotals.spend), l: 'Total Spend', c: 'var(--text)' },
        { v: fmtPct(blendedD6ROAS), l: 'Blended D6 ROAS', c: blendedD6ROAS > 28 ? 'var(--green)' : blendedD6ROAS > 15 ? 'var(--orange)' : 'var(--red)' },
        { v: fmtINR(avgCPI), l: 'Avg CPI', c: avgCPI > 0 && avgCPI < 100 ? 'var(--green)' : avgCPI < 150 ? 'var(--orange)' : 'var(--red)' },
        { v: fmtINR(avgSignupCost), l: 'Avg Signup Cost', c: avgSignupCost > 0 && avgSignupCost < 500 ? 'var(--green)' : avgSignupCost < 1000 ? 'var(--orange)' : 'var(--red)' },
        { v: fmtNum(rawTotals.installs), l: 'Google Conversions', c: 'var(--text)' },
        { v: fmtNum(rawTotals.signups), l: 'Signups', c: 'var(--text)' },
        { v: fmtNum(rawTotals.d6Con || rawTotals.d6 || 0), l: 'D6 Conversions', c: 'var(--accent)' },
        { v: String(s.total_campaigns), l: 'Campaigns', c: 'var(--text)' },
        { v: String(s.total_adsets), l: 'Ad Groups', c: 'var(--text)' },
        { v: '<span style="color:var(--red);">' + s.pause_count + '</span> / <span style="color:var(--green);">' + s.scale_count + '</span>', l: 'Pause / Scale', c: '' },
    ];
    kpis.forEach(function(k) {
        html += '<div style="' + CARD + 'text-align:center;padding:10px 6px;">' +
            '<div style="font-size:17px;font-weight:700;color:' + k.c + ';">' + k.v + '</div>' +
            '<div style="font-size:9px;color:var(--text-dim);margin-top:4px;">' + k.l + '</div>' +
            '<div style="font-size:8px;color:var(--accent);margin-top:2px;">Data Range: ' + esc(dateRangeLabel) + ' | Raw window</div></div>';
    });
    html += '</div></div>';
    html += renderGoogleOptimizerLoopSummary(scan);

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-bottom:16px;">' +
        '<div style="' + CARD + 'border-left:3px solid ' + ((integrity.adCoveragePct || 0) >= 60 ? 'var(--green)' : 'var(--orange)') + ';">' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Integrity</div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--text);">Ad Group Coverage ' + fmtPct(integrity.adCoveragePct) + '</div>' +
            '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Spend coverage ' + fmtPct(integrity.spendCoveragePct) + ' | Fresh status ' + fmtPct(integrity.freshStatusPct) + ' | Data Range: ' + esc(dateRangeLabel) + '</div>' +
            '<div style="font-size:10px;color:' + (integrity.weightedMedianCoherent ? 'var(--green)' : 'var(--orange)') + ';margin-top:6px;">Weighted median coherence: ' + (integrity.weightedMedianCoherent ? 'PASS' : 'WATCH') + '</div>' +
        '</div>' +
        '<div style="' + CARD + 'border-left:3px solid var(--accent);">' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Weighted Benchmarks</div>' +
            '<div style="font-size:11px;color:var(--text);">D6 ROAS median: <strong>' + fmtPct(benchmarks.d6ROAS_median) + '</strong></div>' +
            '<div style="font-size:11px;color:var(--text);">SU Cost median: <strong>' + fmtINR(benchmarks.signupCost_median) + '</strong></div>' +
            '<div style="font-size:11px;color:var(--text);">D0 Trial Cost median: <strong>' + fmtINR(benchmarks.d0TrialCost_median) + '</strong></div>' +
            '<div style="font-size:10px;color:var(--text-dim);margin-top:6px;">Eligible mature ad groups: ' + fmtNum(benchmarks.eligible_count || 0) + '</div>' +
        '</div>' +
        '<div style="' + CARD + 'border-left:3px solid var(--blue);">' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Google Settings Coverage</div>' +
            '<div style="font-size:11px;color:var(--text);">Campaign settings: <strong>' + fmtNum(coverage.campaigns || 0) + '</strong> | Ad group settings: <strong>' + fmtNum(coverage.adgroups || 0) + '</strong></div>' +
            '<div style="font-size:11px;color:var(--text);">Keywords: <strong>' + fmtNum(coverage.keywords || 0) + '</strong> | Search terms: <strong>' + fmtNum(coverage.searchTerms || 0) + '</strong></div>' +
            '<div style="font-size:11px;color:var(--text);">Breakdowns: <strong>' + fmtNum(coverage.breakdowns || 0) + '</strong> | Asset groups: <strong>' + fmtNum(coverage.assetGroups || 0) + '</strong> | App assets: <strong>' + fmtNum(coverage.appAssets || 0) + '</strong></div>' +
            '<div style="font-size:10px;color:var(--text-dim);margin-top:6px;">Data Range: ' + esc(dateRangeLabel) + '</div>' +
        '</div>' +
    '</div>';

    html += '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:16px;">&#128202;</span>' +
        '<div><div style="font-size:12px;font-weight:600;color:var(--accent);">Overview metrics are raw-window; recent week is trial-first; recommendations are maturity-aware</div>' +
        '<div style="font-size:11px;color:var(--text-dim);">Data Range: ' + esc(dateRangeLabel) + ' | Raw metrics include the full selected window. Mature evaluation excludes the last 7 days where applicable. WoW recovery is protected when a weak run turns up. ' + s.matured_adsets + ' ad groups are mature; ' + s.early_adsets + ' remain immature.</div>' +
        (immatureNames.length ? '<div style="font-size:10px;color:var(--orange);margin-top:4px;">Immature examples: ' + esc(immatureNames.join(' | ')) + '</div>' : '') +
        '</div>' +
    '</div>';
    html += renderGoogleDailyAdAnalysisSection(scan);
    html += renderGoogleAssetPlaybookSection(scan);

    if (GC_OPT_EMBED_MODE === 'optimizer' || GC_OPT_URL_PARAMS.get('view') === 'gcOptimizer') {
        html += '<div style="' + CS + '">' +
            '<div style="font-size:14px;font-weight:600;margin-bottom:10px;">Keep asking in plain language. APEX will infer whether you want diagnosis, daily actions, or a campaign deep dive.</div>' +
            '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
                '<input id="gcOptQueryInput" type="text" placeholder="Example: give me week on week trends for sign up costs" style="flex:1;min-width:320px;background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;font-size:12px;">' +
                '<button id="gcOptQueryBtn" class="btn-ci-primary" style="padding:10px 16px;font-size:12px;">Ask APEX</button>' +
            '</div>' +
            renderGoogleUseCaseBar() +
            '<div id="gcOptQueryResult">' + renderGoogleQueryResult(GC_OPT_QUERY_RESULT) + '</div>' +
        '</div>';
    }

    // ── Funnel ──
    var funnel = [
        { label: 'Impressions', val: rawTotals.impressions || 0 },
        { label: 'Clicks', val: rawTotals.clicks || 0 },
        { label: 'Google Conversions', val: rawTotals.installs || 0 },
        { label: 'Signups', val: rawTotals.signups || 0 },
        { label: 'D0 Trials', val: rawTotals.d0_trial || 0 },
        { label: 'D0 Paid', val: rawTotals.d0 || 0 },
        { label: 'D6 Paid', val: rawTotals.d6Con || rawTotals.d6 || 0 },
    ];
    var maxFunnel = Math.max(1, funnel[0].val);
    html += '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:14px;">&#128269; Funnel Analysis</h3>' +
        '<div style="display:flex;flex-direction:column;gap:6px;">';
    for (var fi = 0; fi < funnel.length; fi++) {
        var f = funnel[fi];
        var pct = maxFunnel > 0 ? (f.val / maxFunnel) * 100 : 0;
        var convRate = fi > 0 && funnel[fi - 1].val > 0 ? (f.val / funnel[fi - 1].val * 100) : null;
        var barColor = fi < 3 ? 'var(--accent)' : fi < 5 ? 'var(--orange)' : 'var(--green)';
        var dropWarn = convRate !== null && convRate < 10 && fi >= 2 ? ' !' : '';
        html += '<div style="display:flex;align-items:center;gap:10px;">' +
            '<div style="min-width:80px;font-size:11px;color:var(--text-dim);text-align:right;">' + f.label + '</div>' +
            '<div style="flex:1;background:var(--bg-card);border-radius:4px;height:22px;position:relative;overflow:hidden;">' +
                '<div style="height:100%;width:' + Math.max(1, pct) + '%;background:' + barColor + ';border-radius:4px;opacity:0.7;"></div>' +
                '<span style="position:absolute;left:8px;top:3px;font-size:10px;font-weight:600;color:#fff;">' + f.val.toLocaleString() + '</span>' +
            '</div>' +
            '<div style="min-width:55px;font-size:10px;color:' + (dropWarn ? 'var(--red)' : 'var(--text-dim)') + ';">' + (convRate !== null ? convRate.toFixed(1) + '%' + dropWarn : '') + '</div>' +
        '</div>';
    }
    html += '</div></div>';

    // ── Campaign Table ──
    var campList = [];
    for (var ck in tree) {
        var c = tree[ck];
        var t = c.totals || {};
        var adsetCount = Object.keys(c.adsets || {}).length;
        campList.push({
            name: ck, type: c.type, adsets: adsetCount,
            status: normalizeGoogleStatusLabel(c.settings && c.settings.campaign ? c.settings.campaign.status : ''),
            spend: t.spend || 0, installs: t.installs || 0, signups: t.signups || 0,
            d6: t.d6Con || t.d6 || 0, d6ROAS: t.d6ROAS || 0, cpi: t.cpi, signupCost: t.signupCost,
            rec: c.recommendation,
            spendPct: rawTotals.spend > 0 ? (t.spend || 0) / rawTotals.spend * 100 : 0
        });
    }
    campList = campList.filter(function(c) { return !isGooglePausedStatus(c.status); });
    campList.sort(function(a, b) { return b.spend - a.spend; });

    html += '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:14px;">&#128202; Campaign Performance</h3>' +
        '<div style="font-size:10px;color:var(--text-dim);margin-bottom:8px;">Paused campaigns are hidden from this live table. Use the plan/filter views to inspect them separately.</div>' +
        '<div style="overflow-x:auto;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
        '<thead><tr style="border-bottom:2px solid var(--border);">' +
            '<th style="text-align:left;padding:8px 6px;color:var(--text-dim);font-weight:600;">Campaign</th>' +
            '<th style="text-align:center;padding:8px 6px;color:var(--text-dim);">Type</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">Spend</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">Google Conv.</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">Signups</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">D6 ROAS</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">CPI</th>' +
            '<th style="text-align:center;padding:8px 6px;color:var(--text-dim);">Action</th>' +
        '</tr></thead><tbody>';
    campList.forEach(function(c) {
        var roasColor = c.d6ROAS > 28 ? 'var(--green)' : c.d6ROAS > 15 ? 'var(--orange)' : 'var(--red)';
        var typeColors = { UAC: 'var(--blue)', Search: 'var(--green)', PMax: 'var(--purple)', Video: 'var(--pink)', Display: 'var(--teal)' };
        var tc = typeColors[c.type] || 'var(--text-dim)';
        html += '<tr style="border-bottom:1px solid var(--border);">' +
            '<td style="padding:8px 6px;font-weight:600;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(c.name) + '">' + esc(c.name.length > 40 ? c.name.substring(0, 40) + '...' : c.name) + ' <span style="color:var(--text-dim);font-weight:400;font-size:10px;">(' + c.adsets + ' ad groups)</span></td>' +
            '<td style="text-align:center;padding:8px 6px;"><span style="padding:2px 8px;border-radius:6px;font-size:9px;font-weight:700;border:1px solid ' + tc + ';color:' + tc + ';">' + esc(c.type) + '</span></td>' +
            '<td style="text-align:right;padding:8px 6px;font-weight:600;">' + fmtINR(c.spend) + '</td>' +
            '<td style="text-align:right;padding:8px 6px;">' + (c.installs || 0) + '</td>' +
            '<td style="text-align:right;padding:8px 6px;">' + (c.signups || 0) + '</td>' +
            '<td style="text-align:right;padding:8px 6px;color:' + roasColor + ';font-weight:600;">' + fmtPct(c.d6ROAS) + '</td>' +
            '<td style="text-align:right;padding:8px 6px;">' + (c.cpi ? fmtINR(c.cpi) : '--') + '</td>' +
            '<td style="text-align:center;padding:8px 6px;"><span style="padding:2px 8px;border-radius:6px;font-size:9px;font-weight:700;color:#fff;background:' + (c.rec ? c.rec.color : 'var(--text-dim)') + ';">' + (c.rec ? esc(c.rec.action) : '--') + '</span></td>' +
        '</tr>';
    });
    html += '</tbody></table></div></div>';

    // ── Action buttons ──
    if (!optimizerUiMode) {
        html += '<div style="display:flex;gap:10px;margin-bottom:16px;align-items:center;">' +
            '<button id="gcOptPlanBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 28px;">&#128203; View Optimization Plan</button>' +
            '<button id="gcOptRescanBtn" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:13px;">&#8635; Rescan</button>' +
            '<span style="font-size:11px;color:var(--text-dim);">Scanned: ' + new Date(scan.scan_date).toLocaleString() + ' | Match rate: ' + s.matched_keys + '/' + (s.matched_keys + s.unmatched_keys) + '</span>' +
        '</div>';
    }

    return html;
}

// ── PLAN STAGE — Recommendation Cards ──

function renderPlanStage(container) {
    var scan = GC_OPT_SCAN;
    if (!scan) { GC_OPT_STAGE = 'scan'; renderScanStage(container); return; }
    var optimizerUiMode = GC_OPT_EMBED_MODE === 'optimizer' || GC_OPT_URL_PARAMS.get('view') === 'gcOptimizer';

    var adsets = (scan.adsets || []).slice().sort(function(a, b) {
        var pOrd = { P1: 0, P2: 1, P3: 2 };
        var pa = pOrd[a.recommendation.priority] || 2;
        var pb = pOrd[b.recommendation.priority] || 2;
        if (pa !== pb) return pa - pb;
        return (b.evalSpend || b.spend || 0) - (a.evalSpend || a.spend || 0);
    });

    var s = scan.summary;
    var rawTotals = getGoogleAccountTotals(scan, adsets);
    var totals = scan.evaluatedTotals || sumEvaluated(adsets);
    var maturityCardNote = buildMaturityNote(s, 'matured_adsets', 'early_adsets', 'ad group');
    GC_OPT_EXEC_PLAN = buildGoogleExecutionPlan(scan);
    var execPlan = GC_OPT_EXEC_PLAN;

    // Compute estimated daily savings from PAUSE recommendations
    var dailySavings = adsets.filter(function(x) { return x.recommendation.action === 'PAUSE'; })
        .reduce(function(s, x) { return s + ((x.evalSpend || x.spend || 0) / 14); }, 0);
    var dailyReduceSavings = adsets.filter(function(x) { return x.recommendation.action === 'REDUCE BUDGET'; })
        .reduce(function(s, x) { return s + ((x.evalSpend || x.spend || 0) / 14) * 0.5; }, 0);

    var html = '<div class="ci-panel">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
            '<h2 style="display:flex;align-items:center;gap:10px;">' +
                '<span style="font-size:22px;">&#128203;</span> Optimization Plan' +
            '</h2>' +
            '<div style="display:flex;gap:8px;">' +
                '<button id="gcOptBackBtn" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:12px;">← Back</button>' +
                (!optimizerUiMode ? '<button id="gcOptRescanBtn2" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:12px;">&#8635; Rescan</button>' : '') +
            '</div>' +
        '</div>' +
        '<p style="color:var(--text-dim);font-size:12px;margin-bottom:20px;">Data Range: ' + esc((scan.date_range && scan.date_range.since ? scan.date_range.since : '--') + ' → ' + (scan.date_range && scan.date_range.until ? scan.date_range.until : '--')) + ' | Supported actions can execute directly from this plan. Budget changes are applied once per campaign to avoid double-scaling across multiple ad-group cards.</p>' +
        (cachedStamp ? '<div style="' + CARD + 'margin-bottom:12px;border-left:3px solid var(--green);">Last refreshed: ' + esc(formatRefreshStamp(cachedStamp)) + (scan && scan._cached_at ? ' | Cached scan shown while fresh data loads.' : '') + '</div>' : '');

    // ── Summary cards ──
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:20px;">' +
        '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--red);"><div style="font-size:22px;font-weight:700;color:var(--red);">' + s.pause_count + '</div><div style="font-size:10px;color:var(--text-dim);">Pause</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">Raw window + mature eval</div></div>' +
        '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--orange);"><div style="font-size:22px;font-weight:700;color:var(--orange);">' + s.reduce_count + '</div><div style="font-size:10px;color:var(--text-dim);">Reduce Budget</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">Raw window + mature eval</div></div>' +
        '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--green);"><div style="font-size:22px;font-weight:700;color:var(--green);">' + s.scale_count + '</div><div style="font-size:10px;color:var(--text-dim);">Scale</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">Raw window + mature eval</div></div>' +
        '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--text-dim);"><div style="font-size:22px;font-weight:700;color:var(--text-dim);">' + s.watch_count + '</div><div style="font-size:10px;color:var(--text-dim);">Watch</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">Raw window + mature eval</div></div>' +
        '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--accent);"><div style="font-size:22px;font-weight:700;color:var(--accent);">' + s.total_adsets + '</div><div style="font-size:10px;color:var(--text-dim);">Total Ad Groups</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">Raw window + mature eval</div></div>' +
    '</div>';

    // ── Estimated impact ──
    if (dailySavings > 0 || dailyReduceSavings > 0) {
        html += '<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;">' +
            (dailySavings > 0 ? '<div style="' + CARD + 'flex:1;min-width:200px;border-left:3px solid var(--green);"><div style="font-size:11px;color:var(--text-dim);">Est. Daily Savings (Pauses)</div><div style="font-size:18px;font-weight:700;color:var(--green);margin-top:4px;">' + fmtINR(dailySavings) + '/day</div></div>' : '') +
            (dailyReduceSavings > 0 ? '<div style="' + CARD + 'flex:1;min-width:200px;border-left:3px solid var(--orange);"><div style="font-size:11px;color:var(--text-dim);">Est. Daily Savings (Budget Cuts)</div><div style="font-size:18px;font-weight:700;color:var(--orange);margin-top:4px;">' + fmtINR(dailyReduceSavings) + '/day</div></div>' : '') +
            '<div style="' + CARD + 'flex:1;min-width:200px;border-left:3px solid var(--accent);"><div style="font-size:11px;color:var(--text-dim);">Total Estimated Monthly Savings</div><div style="font-size:18px;font-weight:700;color:var(--accent);margin-top:4px;">' + fmtINR((dailySavings + dailyReduceSavings) * 30) + '/mo</div></div>' +
        '</div>';
    }

    // ── Mature data notice ──
    var maturedCount = adsets.filter(function(x) { return x.isMatured; }).length;
    var earlyCount = adsets.filter(function(x) { return !x.isMatured; }).length;
    html += '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:16px;">&#128202;</span>' +
        '<div><div style="font-size:12px;font-weight:600;color:var(--accent);">Using Mature Data (excl. last 7 days)</div>' +
        '<div style="font-size:11px;color:var(--text-dim);">Data Range: ' + esc((scan.date_range && scan.date_range.since ? scan.date_range.since : '--') + ' → ' + (scan.date_range && scan.date_range.until ? scan.date_range.until : '--')) + ' | ' + maturedCount + ' matured ad groups (' + GOOGLE_DECISION_MATURITY_DAYS + '+ days old) evaluated on data excluding the last 7 days for reliable metrics. ' + earlyCount + ' ad groups are too early to evaluate.</div>' +
        ((scan.adsets || []).filter(function(x) { return !x.isMatured; }).slice(0, 4).map(function(x) { return x.adset_name || x.name || ''; }).filter(Boolean).length ? '<div style="font-size:10px;color:var(--orange);margin-top:4px;">Immature examples: ' + esc((scan.adsets || []).filter(function(x) { return !x.isMatured; }).slice(0, 4).map(function(x) { return x.adset_name || x.name || ''; }).filter(Boolean).join(' | ')) + '</div>' : '') +
        '</div>' +
    '</div>';
    html += renderGoogleOptimizerLoopSummary(scan);
    html += renderGoogleCampaignActions(scan);
    html += '<div id="gcOptExecStatus">' + renderGoogleExecSummary() + '</div>';
    if (execPlan.actions.length) {
        html += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">' +
            '<button id="gcOptExecAllBtn" class="btn-ci-primary" style="font-size:13px;padding:10px 20px;background:var(--green);">Execute All Supported (' + execPlan.actions.length + ')</button>' +
            '<span style="font-size:11px;color:var(--text-dim);">' + execPlan.pauseCount + ' ad group pauses + ' + execPlan.budgetCount + ' campaign budget updates. Campaign budget changes run once per campaign.</span>' +
        '</div>';
    } else {
        html += '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--text-dim);"><div style="font-size:11px;color:var(--text-dim);">No auto-executable actions are available in this scan. Pause actions need linked ad group IDs and budget changes need linked campaign IDs.</div></div>';
    }

    // ── Filter tabs ──
    var tabStyle = 'padding:4px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:11px;';
    var optimizeCount = adsets.filter(function(x) { return x.recommendation.action === 'OPTIMIZE'; }).length;
    var maintainCount = adsets.filter(function(x) { return x.recommendation.action === 'MAINTAIN'; }).length;
    var tooEarlyCount = adsets.filter(function(x) { return x.recommendation.action === 'TOO EARLY'; }).length;
    function tabBtn(filter, label, count) {
        var active = GC_OPT_ACTIVE_FILTER === filter;
        return '<button class="gc-opt-filter' + (active ? ' active' : '') + '" data-filter="' + filter + '" style="' + tabStyle + (active ? 'border-color:var(--accent);background:rgba(99,102,241,0.15);color:var(--accent);' : '') + '">' + label + ' (' + count + ')</button>';
    }
    html += '<div id="gcOptFilterTabs" style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;">' +
        tabBtn('all', 'All', adsets.length) +
        tabBtn('pause', 'Pause', s.pause_count) +
        tabBtn('reduce', 'Reduce', s.reduce_count) +
        tabBtn('scale', 'Scale', s.scale_count) +
        (optimizeCount > 0 ? tabBtn('optimize', 'Optimize', optimizeCount) : '') +
        (maintainCount > 0 ? tabBtn('maintain', 'Maintain', maintainCount) : '') +
        tabBtn('watch', 'Watch', s.watch_count) +
        (tooEarlyCount > 0 ? tabBtn('early', 'Too Early', tooEarlyCount) : '') +
    '</div>';

    // ── Recommendation cards ──
    html += '<div id="gcOptCards">' + renderRecommendationCards(adsets, GC_OPT_ACTIVE_FILTER) + '</div>';

    html += renderGoogleExecLogSection() + '</div>';
    container.innerHTML = html;
    bindPlanEvents(container, adsets);
}

function renderRecommendationCards(adsets, filter) {
    var list = adsets;
    if (filter === 'pause') list = adsets.filter(function(a) { return a.recommendation.action === 'PAUSE'; });
    else if (filter === 'reduce') list = adsets.filter(function(a) { return a.recommendation.action === 'REDUCE BUDGET'; });
    else if (filter === 'scale') list = adsets.filter(function(a) { return a.recommendation.action === 'SCALE'; });
    else if (filter === 'optimize') list = adsets.filter(function(a) { return a.recommendation.action === 'OPTIMIZE'; });
    else if (filter === 'maintain') list = adsets.filter(function(a) { return a.recommendation.action === 'MAINTAIN'; });
    else if (filter === 'watch') list = adsets.filter(function(a) { return a.recommendation.action === 'WATCH'; });
    else if (filter === 'early') list = adsets.filter(function(a) { return a.recommendation.action === 'TOO EARLY'; });

    if (!list.length) return '<p style="color:var(--text-dim);padding:20px;">No ad groups in this category.</p>';

    var html = '';
    list.forEach(function(a) {
        var rec = a.recommendation;
        var typeColors = { UAC: 'var(--blue)', Search: 'var(--green)', PMax: 'var(--purple)', Video: 'var(--pink)', Display: 'var(--teal)' };
        var tc = typeColors[a.campType] || 'var(--text-dim)';
        var execAction = getGoogleExecActionForAdset(a);
        var execState = execAction ? GC_OPT_EXEC_STATUS[execAction.action_id] : null;
        var isCampaignBudgetFollower = (
            !execAction &&
            String(a.campaign_id || '') &&
            GC_OPT_EXEC_PLAN &&
            GC_OPT_EXEC_PLAN.campaignBudgetActionsByCampaignId[String(a.campaign_id || '')]
        );
        var rightSideHtml = '<div style="margin-top:8px;padding:3px 8px;border-radius:4px;font-size:9px;font-weight:600;background:rgba(99,102,241,0.1);color:var(--accent);border:1px solid rgba(99,102,241,0.2);">MANUAL</div>';
        if (execAction) {
            var btnLabel = execState ? (execState.success ? 'Executed' : 'Retry') : execAction.short_label;
            var btnStyle = execState
                ? (execState.success
                    ? 'background:var(--green);border-color:var(--green);cursor:default;'
                    : 'background:var(--red);border-color:var(--red);')
                : '';
            rightSideHtml =
                '<button class="gc-opt-run-single btn-ci-primary" data-action-id="' + esc(execAction.action_id) + '" ' + (execState && execState.success ? 'disabled' : '') + ' style="margin-top:8px;font-size:10px;padding:6px 10px;white-space:nowrap;' + btnStyle + '">' + esc(btnLabel) + '</button>' +
                '<div style="font-size:9px;color:var(--text-dim);margin-top:4px;">' + esc(execAction.action_type === 'UPDATE_CAMPAIGN_BUDGET' ? 'Campaign-level action' : 'Ad group action') + '</div>' +
                (execState && execState.error ? '<div style="font-size:9px;color:var(--red);margin-top:4px;max-width:90px;word-break:break-word;">' + esc(execState.error) + '</div>' : '');
        } else if (isCampaignBudgetFollower) {
            rightSideHtml = '<div style="margin-top:8px;padding:3px 8px;border-radius:4px;font-size:9px;font-weight:600;background:rgba(16,185,129,0.08);color:var(--green);border:1px solid rgba(16,185,129,0.2);">AUTO ONCE</div>' +
                '<div style="font-size:9px;color:var(--text-dim);margin-top:4px;">Campaign action shown once</div>';
        }

        html += '<div style="' + CARD + 'margin-bottom:10px;border-left:4px solid ' + rec.color + ';">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
                '<div style="flex:1;min-width:0;">' +
                    // Badges row
                    '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">' +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;color:#fff;background:' + rec.color + ';">' + esc(rec.action) + '</span>' +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:9px;font-weight:700;border:1px solid ' + tc + ';color:' + tc + ';">' + esc(a.campType) + '</span>' +
                        '<span style="padding:2px 6px;border-radius:4px;font-size:9px;font-weight:600;border:1px solid var(--border);color:var(--text-dim);">' + esc(rec.priority) + '</span>' +
                        (a.isMatured ? '<span style="padding:2px 6px;border-radius:4px;font-size:9px;font-weight:600;border:1px solid var(--green);color:var(--green);">' + a.daysLive + 'd \u2713 Mature Data</span>' : '<span style="padding:2px 6px;border-radius:4px;font-size:9px;font-weight:600;border:1px solid var(--orange);color:var(--orange);">' + a.daysLive + 'd \u2022 Early</span>') +
                        '<span style="padding:2px 6px;border-radius:4px;font-size:9px;font-weight:600;border:1px solid rgba(99,102,241,0.35);color:var(--accent);">' + esc(a._evalMode === 'mature' ? 'Metrics: Mature Eval' : (a._evalMode === 'full_fallback' ? 'Metrics: Full Data Fallback' : 'Metrics: Early Full Data')) + '</span>' +
                    '</div>' +

                    // Campaign + adset names
                    '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(a.campaign_name) + '">' + esc(a.campaign_name.length > 50 ? a.campaign_name.substring(0, 50) + '...' : a.campaign_name) + '</div>' +
                    '<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(a.adset_name) + '">&#8250; ' + esc(a.adset_name.length > 60 ? a.adset_name.substring(0, 60) + '...' : a.adset_name) + '</div>' +

                    // Metrics row
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;margin-bottom:8px;">' +
                        '<span style="' + CARD + 'padding:4px 8px;">Spend: <strong>' + fmtINR(a.evalSpend) + '</strong></span>' +
                        (a.d6ROAS > 0 ? '<span style="' + CARD + 'padding:4px 8px;color:' + (a.d6ROAS > 28 ? 'var(--green)' : a.d6ROAS > 15 ? 'var(--orange)' : 'var(--red)') + ';">D6 ROAS: <strong>' + fmtPct(a.d6ROAS) + '</strong></span>' : '') +
                        (a.cpi ? '<span style="' + CARD + 'padding:4px 8px;">CPI: <strong>' + fmtINR(a.cpi) + '</strong></span>' : '') +
                        (a.signupCost ? '<span style="' + CARD + 'padding:4px 8px;">SU Cost: <strong>' + fmtINR(a.signupCost) + '</strong></span>' : '') +
                        (a.evalSignups > 0 ? '<span style="' + CARD + 'padding:4px 8px;">Signups: <strong>' + a.evalSignups + '</strong></span>' : '') +
                        (a.evalInstalls > 0 ? '<span style="' + CARD + 'padding:4px 8px;">Google Conv.: <strong>' + a.evalInstalls + '</strong></span>' : '') +
                        (a.evalD6 > 0 ? '<span style="' + CARD + 'padding:4px 8px;">D6: <strong>' + a.evalD6 + '</strong></span>' : '') +
                    '</div>' +

                    '<div style="font-size:10px;color:var(--accent);margin-bottom:8px;">' + esc(a.evalDataLabel) + '</div>' +

                    ((rec.suggested_actions && rec.suggested_actions.length) ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">' + rec.suggested_actions.slice(0, 4).map(function(actionName) {
                        return '<span style="padding:2px 6px;border-radius:999px;font-size:9px;font-weight:600;border:1px solid var(--border);color:var(--text-dim);">' + esc(actionName) + '</span>';
                    }).join('') + '</div>' : '') +

                    ((rec.source_context && rec.source_context.length) ? '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">' + rec.source_context.slice(0, 6).map(function(sourceName) {
                        return '<span style="padding:2px 6px;border-radius:999px;font-size:9px;font-weight:600;border:1px solid rgba(99,102,241,0.25);color:var(--accent);background:rgba(99,102,241,0.08);">' + esc(sourceName) + '</span>';
                    }).join('') + '</div>' : '') +

                    ((a.searchAudit && ((a.searchAudit.summary && a.searchAudit.summary.length) || (a.searchAudit.positives && a.searchAudit.positives.length))) ? '<div style="font-size:10px;color:var(--text-dim);margin-bottom:8px;line-height:1.5;">Search audit: ' + esc((a.searchAudit.summary || []).join(', ') || (a.searchAudit.positives || []).join(', ')) + '</div>' : '') +
                    ((a.settingsAudit && a.settingsAudit.summary && a.settingsAudit.summary.length) ? '<div style="font-size:10px;color:var(--text-dim);margin-bottom:8px;line-height:1.5;">Settings: ' + esc(a.settingsAudit.summary.join(' | ')) + '</div>' : '') +
                    (rec.creative_insights ? '<div style="font-size:10px;color:var(--text-dim);margin-bottom:8px;line-height:1.5;">Ad signal: ' + esc(rec.creative_insights) + '</div>' : '') +

                    // Reasoning
                    '<div style="font-size:12px;color:var(--text);line-height:1.6;padding:8px;background:rgba(0,0,0,0.2);border-radius:6px;margin-bottom:6px;">' + esc(rec.reason) + '</div>' +
                    (rec.next_step || rec.do_line || rec.impact ? '<div style="font-size:11px;color:var(--accent);margin-bottom:6px;">Next step: ' + esc(rec.next_step || rec.do_line || rec.impact || '--') + '</div>' : '') +
                    (rec.budget_text || rec.budget_amount != null ? '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Budget: ' + esc(rec.budget_text || (rec.budget_amount != null ? String(rec.budget_amount) : '--')) + '</div>' : '') +

                    // CPI trend flag
                    (rec.flags && rec.flags.length > 0 ? '<div style="font-size:11px;color:var(--orange);margin-bottom:6px;">' + rec.flags.map(function(f) { return '&#9888; ' + esc(f); }).join('<br>') + '</div>' : '') +
                    ((rec.positives && rec.positives.length) ? '<div style="font-size:11px;color:var(--green);margin-bottom:6px;">' + rec.positives.slice(0, 3).map(function(f) { return '&#10003; ' + esc(f); }).join('<br>') + '</div>' : '') +
                    ((rec.benchmark_context && rec.benchmark_context.length) ? '<div style="font-size:10px;color:var(--text-dim);margin-bottom:6px;">Benchmarks: ' + esc(rec.benchmark_context.slice(0, 3).join(' | ')) + '</div>' : '') +
                    (rec.history_context && rec.history_context.strong_history ? '<div style="font-size:10px;color:var(--accent);margin-bottom:6px;">History: strong past performance detected; recent weakness is being handled conservatively.</div>' : '') +
                    (rec.trend_context ? '<div style="font-size:10px;color:var(--text-dim);margin-bottom:6px;">Trend: ' + esc(rec.trend_context.direction || 'stable') + (rec.trend_context.recoveryAfterWeakRun ? ' | recovery after weak run' : '') + (rec.trend_context.continuousDecline ? ' | continuous decline' : '') + (rec.trend_context.continuousIncrease ? ' | continuous increase' : '') + (rec.trend_context.note ? '<br>' + esc(rec.trend_context.note) : '') + '</div>' : '') +
                    ((a.searchAudit && a.searchAudit.actions && a.searchAudit.actions.length) ? '<div style="font-size:11px;color:var(--orange);margin-bottom:6px;">&#9888; ' + esc(a.searchAudit.actions[0]) + '</div>' : '') +

                    // Expected impact
                    (rec.impact ? '<div style="font-size:11px;color:var(--green);">&#8594; ' + esc(rec.impact) + '</div>' : '') +
                '</div>' +

                // Right side: execution / status
                '<div style="text-align:center;min-width:70px;padding:8px 0;">' +
                    '<div style="font-size:20px;font-weight:800;color:' + rec.color + ';">' + (a.d6ROAS > 0 ? fmtPct(a.d6ROAS) : '--') + '</div>' +
                    '<div style="font-size:9px;color:var(--text-dim);margin-top:2px;">D6 ROAS</div>' +
                    rightSideHtml +
                '</div>' +
            '</div>' +
        '</div>';
    });

    return html;
}

// ── EVENT BINDING ──

function bindScanEvents(container) {
    var scanBtn = document.getElementById('gcOptScanBtn');
    if (scanBtn) {
        scanBtn.addEventListener('click', async function() {
            GC_OPT_SCAN_ERROR = null;
            scanBtn.disabled = true;
            scanBtn.textContent = 'Scanning...';
            var prog = document.getElementById('gcOptScanProgress');
            if (prog) prog.style.display = '';
            var reportProgress = function(msg) {
                if (prog) prog.textContent = msg;
            };
            try {
                await scanGoogleAccount(reportProgress);
                GC_OPT_SCAN_ERROR = null;
                GC_OPT_ACTIVE_FILTER = 'all';
                GC_OPT_EXEC_PLAN = null;
                GC_OPT_EXEC_STATUS = {};
                GC_OPT_LAST_EXEC_SUMMARY = null;
                GC_OPT_QUERY_RESULT = null;
                GC_OPT_OVERVIEW_CAMPAIGN = '';
                GC_OPT_STAGE = 'scan';
                window.renderGcOptimizer();
            } catch (err) {
                GC_OPT_SCAN_ERROR = err && err.message ? err.message : 'Scan failed';
                if (prog) prog.innerHTML = '<span style="color:var(--red);">Scan failed: ' + esc(GC_OPT_SCAN_ERROR) + '</span>';
                scanBtn.disabled = false;
                scanBtn.textContent = '&#128270; Retry Scan';
                window.renderGcOptimizer();
            }
        });
    }

    var planBtn = document.getElementById('gcOptPlanBtn');
    if (planBtn) {
        planBtn.addEventListener('click', function() {
            GC_OPT_STAGE = 'plan';
            window.renderGcOptimizer();
        });
    }

    var rescanBtn = document.getElementById('gcOptRescanBtn');
    if (rescanBtn) {
        rescanBtn.addEventListener('click', function() {
            GC_OPT_SCAN = null;
            GC_OPT_ACTIVE_FILTER = 'all';
            GC_OPT_EXEC_PLAN = null;
            GC_OPT_EXEC_STATUS = {};
            GC_OPT_LAST_EXEC_SUMMARY = null;
            GC_OPT_QUERY_RESULT = null;
            GC_OPT_OVERVIEW_CAMPAIGN = '';
            GC_OPT_STAGE = 'scan';
            window.renderGcOptimizer();
        });
    }

    var queryBtn = document.getElementById('gcOptQueryBtn');
    var queryInput = document.getElementById('gcOptQueryInput');
    async function runGoogleQuery() {
        if (!GC_OPT_SCAN || !queryInput) return;
        var prompt = (queryInput.value || '').trim();
        if (!prompt) return;
        var resultEl = document.getElementById('gcOptQueryResult');
        GC_OPT_QUERY_RESULT = { loading: true };
        if (queryBtn) queryBtn.disabled = true;
        if (resultEl) {
            resultEl.innerHTML = renderGoogleQueryResult(GC_OPT_QUERY_RESULT);
            bindGoogleQueryResultEvents(container);
        }
        try {
            GC_OPT_QUERY_RESULT = await executeGoogleOptimizerQuery(GC_OPT_SCAN, prompt);
        } catch (err) {
            GC_OPT_QUERY_RESULT = {
                title: 'Google optimizer query failed',
                basis: (GC_OPT_SCAN.date_range || {}).since + ' → ' + (GC_OPT_SCAN.date_range || {}).until,
                summary: err.message || 'Unknown query failure'
            };
        } finally {
            if (queryBtn) queryBtn.disabled = false;
        }
        if (resultEl) {
            resultEl.innerHTML = renderGoogleQueryResult(GC_OPT_QUERY_RESULT);
            bindGoogleQueryResultEvents(container);
        }
    }
    if (queryBtn) queryBtn.addEventListener('click', runGoogleQuery);
    if (queryInput) {
        queryInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') runGoogleQuery();
        });
    }
    container.querySelectorAll('.gc-opt-query-chip').forEach(function(btn) {
        btn.addEventListener('click', function() {
            if (!queryInput) return;
            queryInput.value = btn.getAttribute('data-query') || '';
            runGoogleQuery();
        });
    });
    bindGoogleQueryResultEvents(container);
}

function bindGoogleQueryResultEvents(container) {
    container.querySelectorAll('.gc-opt-open-campaign').forEach(function(btn) {
        if (btn.__gcBound) return;
        btn.__gcBound = true;
        btn.addEventListener('click', function() {
            GC_OPT_OVERVIEW_CAMPAIGN = btn.getAttribute('data-campaign') || '';
            var resultEl = document.getElementById('gcOptQueryResult');
            if (resultEl) {
                resultEl.innerHTML = renderGoogleQueryResult(GC_OPT_QUERY_RESULT);
                bindGoogleQueryResultEvents(container);
            }
        });
    });
}

function bindPlanEvents(container, adsets) {
    // Filter tabs
    container.querySelectorAll('.gc-opt-filter').forEach(function(btn) {
        btn.addEventListener('click', function() {
            container.querySelectorAll('.gc-opt-filter').forEach(function(b) {
                b.classList.remove('active');
                b.style.borderColor = 'var(--border)';
                b.style.background = 'var(--bg-card)';
                b.style.color = 'var(--text)';
            });
            btn.classList.add('active');
            btn.style.borderColor = 'var(--accent)';
            btn.style.background = 'rgba(99,102,241,0.15)';
            btn.style.color = 'var(--accent)';
            var f = btn.getAttribute('data-filter');
            GC_OPT_ACTIVE_FILTER = f;
            document.getElementById('gcOptCards').innerHTML = renderRecommendationCards(adsets, f);
            bindGoogleRunButtons(container, adsets);
        });
    });

    var execAllBtn = document.getElementById('gcOptExecAllBtn');
    if (execAllBtn) {
        execAllBtn.addEventListener('click', async function() {
            if (!GC_OPT_EXEC_PLAN || !GC_OPT_EXEC_PLAN.actions.length) return;
            var confirmMsg = 'Execute ' + GC_OPT_EXEC_PLAN.actions.length + ' supported Google Ads actions?\n\n' +
                GC_OPT_EXEC_PLAN.pauseCount + ' ad group pauses\n' +
                GC_OPT_EXEC_PLAN.budgetCount + ' campaign budget updates';
            if (!window.confirm(confirmMsg)) return;

            execAllBtn.disabled = true;
            execAllBtn.textContent = 'Executing...';
            var statusEl = document.getElementById('gcOptExecStatus');
            if (statusEl) {
                statusEl.innerHTML = '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);"><div style="font-size:12px;font-weight:700;color:var(--accent);">Executing supported Google Ads actions...</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Budget updates run once per campaign. The plan will refresh statuses when finished.</div></div>';
            }

            try {
                var batchRes = await executeAllGoogleActions(GC_OPT_EXEC_PLAN.actions, function(action, index, total) {
                    if (statusEl) {
                        statusEl.innerHTML = '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);"><div style="font-size:12px;font-weight:700;color:var(--accent);">Executing ' + index + '/' + total + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(action.execute_label + ': ' + action.entity_name) + '</div></div>';
                    }
                });
                setGoogleExecSummary({
                    success: batchRes.failed === 0,
                    failed: batchRes.failed > 0,
                    message: batchRes.failed === 0 ? 'Execution complete' : 'Execution completed with some failures',
                    detail: batchRes.succeeded + ' succeeded' + (batchRes.failed ? ', ' + batchRes.failed + ' failed' : '')
                });
            } catch (err) {
                setGoogleExecSummary({
                    success: false,
                    message: 'Execution failed',
                    detail: err.message
                });
            }

            window.renderGcOptimizer();
        });
    }

    // Back button
    var backBtn = document.getElementById('gcOptBackBtn');
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            GC_OPT_STAGE = 'scan';
            window.renderGcOptimizer();
        });
    }

    // Rescan button (plan stage)
    var rescanBtn2 = document.getElementById('gcOptRescanBtn2');
    if (rescanBtn2) {
        rescanBtn2.addEventListener('click', function() {
            GC_OPT_SCAN = null;
            GC_OPT_ACTIVE_FILTER = 'all';
            GC_OPT_EXEC_PLAN = null;
            GC_OPT_EXEC_STATUS = {};
            GC_OPT_LAST_EXEC_SUMMARY = null;
            GC_OPT_STAGE = 'scan';
            window.renderGcOptimizer();
        });
    }

    bindGoogleRunButtons(container, adsets);
}

function bindGoogleRunButtons(container, adsets) {
    container.querySelectorAll('.gc-opt-run-single').forEach(function(btn) {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation();
            var actionId = btn.getAttribute('data-action-id');
            var action = GC_OPT_EXEC_PLAN && GC_OPT_EXEC_PLAN.actions
                ? GC_OPT_EXEC_PLAN.actions.find(function(a) { return a.action_id === actionId; })
                : null;
            if (!action) return;
            var confirmMsg = action.execute_label + '?\n\n' + (action.entity_name || '');
            if (!window.confirm(confirmMsg)) return;

            btn.disabled = true;
            btn.textContent = '...';
            try {
                var res = await executeGoogleAction(action);
                setGoogleExecSummary({
                    success: !!res.success,
                    message: res.success ? 'Execution complete' : 'Execution failed',
                    detail: res.success ? (action.execute_label + ' completed for ' + action.entity_name) : (res.error || 'Unknown error')
                });
            } catch (err) {
                setGoogleExecSummary({
                    success: false,
                    message: 'Execution failed',
                    detail: err.message
                });
            }

            window.renderGcOptimizer();
        });
    });
}

function renderGoogleQueryResultMetaStyle(result) {
    if (!result) return '';
    if (result.loading) {
        return '<div style="' + CS + 'margin-top:16px;font-size:12px;color:var(--text-dim);">Reading the Google optimizer context...</div>';
    }
    var scan = GC_OPT_SCAN || {};
    var integrity = scan.integrity || {};
    var basis = result.basis || (((scan.date_range || {}).since || '--') + ' â†’ ' + ((scan.date_range || {}).until || '--'));
    var currentSlice = result.current_slice || 'All | All';
    var brief = result.morning_brief || {};
    var marketRead = brief.market_read || {};
    var doNow = normalizeGoogleActionItems(result.what_to_do_right_now, 'Do not stack another structural edit on the same entity today.');
    var leaveAlone = normalizeGoogleLeaveAloneItems(result.what_to_leave_alone);
    var watchList = Array.isArray(result.watch_list) ? result.watch_list : [];
    var campaignInsights = normalizeGoogleCampaignInsights(result.campaign_insights);
    var thisWeek = Array.isArray(brief.this_weeks_moves) ? brief.this_weeks_moves : [];
    var horizon = brief.thirty_day_horizon || {};
    var risks = Array.isArray(horizon.risks) ? horizon.risks : [];
    var opportunities = Array.isArray(horizon.opportunities) ? horizon.opportunities : [];
    var plan = result.optimizer_plan || null;
    if (plan) {
        var mode = plan.session_mode || 'daily_review';
        var actions = Array.isArray(plan.actions) ? plan.actions : [];
        var htmlPlan = '<div style="' + CS + 'margin-top:16px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;">' +
                '<div><div style="font-size:11px;color:var(--text-dim);">APEX Answer</div><div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + esc(result.title || 'Google optimizer result') + '</div></div>' +
            '</div>' +
            '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--accent);"><div style="font-size:10px;color:var(--text-dim);">Analysis Basis</div><div style="font-size:13px;color:var(--text);margin-top:4px;">Date range: ' + esc(basis) + '</div></div>' +
        '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--accent);"><div style="font-size:10px;color:var(--text-dim);">Current Working Slice</div><div style="font-size:13px;color:var(--text);margin-top:4px;">' + esc(currentSlice) + '</div></div>' +
            (integrity && (integrity.adCoveragePct != null || integrity.spendCoveragePct != null || integrity.freshStatusPct != null) ? '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid ' + (integrity.weightedMedianCoherent ? 'var(--green)' : 'var(--orange)') + ';"><div style="font-size:10px;color:var(--text-dim);">Data Integrity</div><div style="font-size:13px;color:var(--text);margin-top:4px;">Ad group coverage ' + esc(fmtPct(integrity.adCoveragePct)) + ' | Spend coverage ' + esc(fmtPct(integrity.spendCoveragePct)) + ' | Fresh status ' + esc(fmtPct(integrity.freshStatusPct)) + '</div></div>' : '') +
        renderGoogleOperatorOverview(plan, scan, actions) +
        (plan.executive_summary ? '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);">' + esc(plan.executive_summary) + '</div>' : '');
        if (mode === 'daily_review') {
            htmlPlan += ((plan.command_type === 'morning_account_review') ? renderGoogleMarketerDailyReview(plan, scan) : renderGoogleDailyActionConsole(plan, scan));
        } else if (mode === 'diagnostic') {
            htmlPlan += renderGoogleMarketerDiagnosis(plan);
        } else if (mode === 'paused_revamp') {
            htmlPlan += renderGooglePausedRevampPanel(scan) + renderGoogleCampaignAdgroupBreakdown(scan) + renderGoogleScaleAndTest(plan);
        } else {
            htmlPlan += renderGoogleCampaignAdgroupBreakdown(scan) + renderGoogleScaleAndTest(plan);
        }
        htmlPlan += '</div>';
        return htmlPlan;
    }
    var html = '<div style="' + CS + 'margin-top:16px;">' +
        '<h3 style="font-size:14px;font-weight:700;margin-bottom:12px;">APEX Morning Brief</h3>' +
        '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--accent);"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Recommendation Basis</div><div style="font-size:12px;color:var(--text);line-height:1.7;">Date range: ' + esc(basis) + ' | Current slice: ' + esc(currentSlice) + '</div></div>' +
        '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--accent);"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Market Read</div><div style="font-size:12px;color:var(--text);line-height:1.7;">' + esc(marketRead.summary || result.summary || '--') + '</div>' + (marketRead.posture ? '<div style="font-size:11px;color:var(--accent);margin-top:6px;">Posture: ' + esc(marketRead.posture) + '</div>' : '') + '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px;">' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Spend</div><div style="font-size:14px;font-weight:700;color:var(--text);margin-top:4px;">' + esc(fmtINR((getGoogleAccountTotals(scan).spend || 0))) + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">D6 ROAS</div><div style="font-size:14px;font-weight:700;color:var(--green);margin-top:4px;">' + esc(fmtPct((getGoogleAccountTotals(scan).d6ROAS || 0))) + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Signup Cost</div><div style="font-size:14px;font-weight:700;color:var(--orange);margin-top:4px;">' + esc(fmtINR((getGoogleAccountTotals(scan).signupCost || 0))) + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Ad Groups</div><div style="font-size:14px;font-weight:700;color:var(--text);margin-top:4px;">' + esc(String((scan.summary && scan.summary.total_adsets) || 0)) + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + esc(String((scan.summary && scan.summary.matured_adsets) || 0)) + ' mature / ' + esc(String((scan.summary && scan.summary.early_adsets) || 0)) + ' early</div></div>' +
        '</div>' +
        renderGoogleCampaignAdgroupBreakdown(scan) +
        '<div style="' + CARD + 'margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">What To Do Right Now</div>' +
            (doNow.length ? doNow.slice(0, 7).map(function(item) {
                return '<div style="padding:8px 0;border-bottom:1px solid var(--border);"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.title || item.entity_name || item || '--') + '</div>' +
                    (item.why ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Why: ' + esc(item.why) + '</div>' : '') +
                    (item.do ? '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Do: ' + esc(item.do) + '</div>' : '') +
                    (item.do_not ? '<div style="font-size:11px;color:var(--orange);margin-top:4px;">Do not: ' + esc(item.do_not) + '</div>' : '') +
                '</div>';
            }).join('') : '<div style="font-size:11px;color:var(--text-dim);">No immediate action.</div>') +
        '</div>' +
        '<div style="' + CARD + 'margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">What To Leave Alone Today</div>' +
            (leaveAlone.length ? leaveAlone.map(function(item) {
                return '<div style="padding:8px 0;border-bottom:1px solid var(--border);"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.title || item.entity_name || item || '--') + '</div>' +
                    (item.reason ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Leave alone because: ' + esc(item.reason) + '</div>' : '') +
                    (item.watch_for ? '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Watch for: ' + esc(item.watch_for) + '</div>' : '') +
                '</div>';
            }).join('') : '<div style="font-size:11px;color:var(--text-dim);">No do-not-touch list.</div>') +
        '</div>' +
        (campaignInsights.length ? '<div style="' + CARD + 'margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Campaign Insights</div>' +
            campaignInsights.slice(0, 5).map(function(item) { return '<div style="padding:8px 0;border-bottom:1px solid var(--border);"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.campaign_name || item.name || '--') + '</div>' +
                (item.status ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Status: ' + esc(item.status) + '</div>' : '') +
                (item.trend ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Trend: ' + esc(item.trend) + '</div>' : '') +
                (item.adset_insights ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Ad Group Insights: ' + esc(item.adset_insights) + '</div>' : '') +
                (item.creative_insights ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Creative / Structure: ' + esc(item.creative_insights) + '</div>' : '') +
                (item.key_question ? '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Key Question: ' + esc(item.key_question) + '</div>' : '') +
                '</div>'; }).join('') + '</div>' : '') +
        ((thisWeek.length || risks.length || opportunities.length) ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
            '<div style="' + CARD + '"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">This Week\'s Moves</div>' + (thisWeek.length ? thisWeek.map(function(item) { return '<div style="font-size:11px;color:var(--text-dim);padding:4px 0;">• ' + esc(item.title || item.entity_name || item) + '</div>'; }).join('') : '<div style="font-size:11px;color:var(--text-dim);">No additional non-urgent moves returned.</div>') + '</div>' +
            '<div style="' + CARD + '"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">30-Day Horizon</div>' +
                (risks.length ? '<div style="font-size:11px;color:var(--orange);margin-bottom:6px;">Risks</div>' + risks.map(function(item) { return '<div style="font-size:11px;color:var(--text-dim);padding:3px 0;">• ' + esc(item.risk || item.title || item) + '</div>'; }).join('') : '') +
                (opportunities.length ? '<div style="font-size:11px;color:var(--green);margin:8px 0 6px 0;">Opportunities</div>' + opportunities.map(function(item) { return '<div style="font-size:11px;color:var(--text-dim);padding:3px 0;">• ' + esc(item.opportunity || item.title || item) + '</div>'; }).join('') : '') +
            '</div>' +
        '</div>' : '');

    if (result.rows && result.rows.length) {
        var showStatus = result.rows.some(function(row) { return row.statusText; });
        html += '<div style="' + CARD + 'margin-top:12px;"><div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Query Breakdown</div><div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:11px;">' +
            '<thead><tr style="border-bottom:1px solid var(--border);">' +
                '<th style="text-align:left;padding:8px;color:var(--text-dim);">Entity</th>' +
                (showStatus ? '<th style="text-align:left;padding:8px;color:var(--text-dim);">Status</th>' : '') +
                '<th style="text-align:right;padding:8px;color:var(--text-dim);">Prev</th>' +
                '<th style="text-align:right;padding:8px;color:var(--text-dim);">Current</th>' +
                '<th style="text-align:right;padding:8px;color:var(--text-dim);">Delta</th>' +
                '<th style="text-align:right;padding:8px;color:var(--text-dim);">Spend</th>' +
            '</tr></thead><tbody>';
        result.rows.forEach(function(row) {
            html += '<tr style="border-bottom:1px solid var(--border);">' +
                '<td style="padding:8px;color:var(--text);">' + esc(row.label || row.entity || '--') + '</td>' +
                (showStatus ? '<td style="padding:8px;color:var(--text-dim);">' + esc(row.statusText || '--') + '</td>' : '') +
                '<td style="padding:8px;text-align:right;color:var(--text);">' + esc(row.prevText || '--') + '</td>' +
                '<td style="padding:8px;text-align:right;color:var(--text);">' + esc(row.currentText || '--') + '</td>' +
                '<td style="padding:8px;text-align:right;color:' + (row.deltaColor || 'var(--text)') + ';">' + esc(row.deltaText || '--') + '</td>' +
                '<td style="padding:8px;text-align:right;color:var(--text);">' + esc(row.spendText || '--') + '</td>' +
            '</tr>';
        });
        html += '</tbody></table></div></div>';
    }

    if (result.insights && result.insights.length) {
        html += '<div style="' + CARD + 'margin-top:12px;">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Insights / Actionables</div>' +
            result.insights.slice(0, 8).map(function(item) { return '<div style="font-size:11px;color:var(--text);line-height:1.6;margin-bottom:4px;">• ' + esc(item) + '</div>'; }).join('') +
        '</div>';
    }
    html += '</div>';
    return html;
}

renderGoogleQueryResult = renderGoogleQueryResultMetaStyle;
window.renderGcOptimizerQueryResultHtml = renderGoogleQueryResultMetaStyle;

})();
