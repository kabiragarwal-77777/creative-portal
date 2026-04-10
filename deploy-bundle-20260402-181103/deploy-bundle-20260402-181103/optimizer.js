// =============================================================================
// Campaign Optimizer — Scan → Plan → Execute
// Uses same data pipeline as Campaign Tree (server-side Meta + Metabase fetch)
// =============================================================================

(function() {
'use strict';

window.OPTIMIZER_SCAN = null;
window.OPTIMIZER_PLAN = null;
window.OPTIMIZER_STAGE = 'scan';
window.OPTIMIZER_LOG = [];
window.OPTIMIZER_PLAN_FILTER = 'all';
window.OPTIMIZER_PLAN_SCOPE = 'all';

var SERVER = 'http://localhost:3000';

// ── Helpers ──

function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

function fmtINR(v) {
    if (v == null || isNaN(v)) return '--';
    if (Math.abs(v) >= 100000) return '\u20b9' + (v / 100000).toFixed(1) + 'L';
    if (Math.abs(v) >= 1000) return '\u20b9' + (v / 1000).toFixed(1) + 'K';
    return '\u20b9' + Math.round(v);
}

function fmtPct(v) { return v != null ? parseFloat(v).toFixed(1) + '%' : '--'; }
function statusUpper(status) { return String(status || 'UNKNOWN').toUpperCase(); }
function isEffectivelyPausedStatus(status) {
    status = statusUpper(status);
    return status === 'PAUSED' || status === 'ADSET_PAUSED' || status === 'CAMPAIGN_PAUSED' || status === 'ARCHIVED' || status === 'DELETED';
}
function isActiveDeliveryStatus(status) { return statusUpper(status) === 'ACTIVE'; }
function getDeliveryState(adStatus, adsetStatus, campaignStatus) {
    if (isEffectivelyPausedStatus(campaignStatus) || statusUpper(adStatus) === 'CAMPAIGN_PAUSED') return 'paused_campaign';
    if (isEffectivelyPausedStatus(adsetStatus) || statusUpper(adStatus) === 'ADSET_PAUSED') return 'paused_adset';
    if (isEffectivelyPausedStatus(adStatus)) return 'paused_ad';
    if (isActiveDeliveryStatus(adStatus)) return 'live';
    if (statusUpper(adStatus) === 'PENDING_REVIEW' || statusUpper(adStatus) === 'IN_PROCESS') return 'pending';
    return 'unknown';
}
function isExecutableActionType(type) {
    return [
        'PAUSE_AD', 'ACTIVATE_AD',
        'PAUSE_ADSET', 'ACTIVATE_ADSET',
        'PAUSE_CAMPAIGN', 'ACTIVATE_CAMPAIGN',
        'UPDATE_ADSET_BUDGET', 'UPDATE_CAMPAIGN_BUDGET'
    ].indexOf(String(type || '').toUpperCase()) !== -1;
}
function getActivationActionForAd(ad) {
    if (!ad) return 'ACTIVATE_AD';
    if (isEffectivelyPausedStatus(ad.campaign_status) || statusUpper(ad.ad_status) === 'CAMPAIGN_PAUSED') return 'ACTIVATE_CAMPAIGN';
    if (isEffectivelyPausedStatus(ad.adset_status) || statusUpper(ad.ad_status) === 'ADSET_PAUSED') return 'ACTIVATE_ADSET';
    return 'ACTIVATE_AD';
}
function getActivationActionForAds(ads) {
    if ((ads || []).some(function(ad) { return getActivationActionForAd(ad) === 'ACTIVATE_CAMPAIGN'; })) return 'ACTIVATE_CAMPAIGN';
    if ((ads || []).some(function(ad) { return getActivationActionForAd(ad) === 'ACTIVATE_ADSET'; })) return 'ACTIVATE_ADSET';
    return 'ACTIVATE_AD';
}
function getDefaultBudgetRecommendation(currentBudget, direction) {
    var current = Number(currentBudget) || 0;
    if (current <= 0) return null;
    return Math.max(1, Math.round(current * (direction === 'decrease' ? 0.8 : 1.2)));
}

function actionIcon(type) {
    if (!type) return '';
    if (type.indexOf('PAUSE') !== -1) return '\ud83d\udd34';
    if (type === 'ACTIVATE_AD' || type === 'ACTIVATE_ADSET' || type === 'ACTIVATE_CAMPAIGN') return '\ud83d\udfe2';
    if (type === 'UPDATE_ADSET_BUDGET' || type === 'UPDATE_CAMPAIGN_BUDGET') return '\ud83d\udcc8';
    if (type === 'NO_ACTION') return '\u26aa';
    return '\u26a1';
}

function actionColor(type) {
    if (!type) return 'var(--text-dim)';
    if (type.indexOf('PAUSE') !== -1) return 'var(--red)';
    if (type === 'ACTIVATE_AD' || type === 'ACTIVATE_ADSET' || type === 'ACTIVATE_CAMPAIGN') return 'var(--green)';
    if (type === 'UPDATE_ADSET_BUDGET' || type === 'UPDATE_CAMPAIGN_BUDGET') return 'var(--orange)';
    return 'var(--text-dim)';
}

function confidenceBadge(c) {
    var colors = { HIGH: 'var(--green)', MEDIUM: 'var(--orange)', LOW: 'var(--red)' };
    var col = colors[(c || '').toUpperCase()] || 'var(--text-dim)';
    return '<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;color:#fff;background:' + col + ';">' + esc(c) + '</span>';
}

var CS = 'background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;';
var CARD = 'background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;padding:14px;';

// Shared data pipeline — raw summable metrics + derived formulated metrics
function emptyRaw() {
    return {
        spend: 0, impressions: 0, clicks: 0, installs: 0,
        thruplay: 0, p25: 0, p100: 0,
        signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
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

function normalizeCampaignName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeAdsetName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeTrackerName(value) {
    return String(value || '').replace(/:.*$/, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildJoinKey(dateStr, campaignName, adsetName, trackerName) {
    var d = String(dateStr || '').substring(0, 10);
    return [
        d,
        normalizeCampaignName(campaignName),
        normalizeAdsetName(adsetName),
        normalizeTrackerName(trackerName)
    ].join('|||');
}

var _vR = function(sp, rev) {
    if (!sp || sp <= 0 || !rev || rev < 0) return null;
    if (rev / sp > 50) return null;
    return (rev / sp) * 100;
};

function deriveMetrics(r) {
    var p0p1 = (r.p0_signup || 0) + (r.p1_signup || 0);
    var d6Rev = r.d6_overall_revenue || 0;
    var d6Con = r.d6 || 0;
    return {
        spend: r.spend, impressions: r.impressions, clicks: r.clicks, installs: r.installs,
        thruplay: r.thruplay, p25: r.p25, p100: r.p100,
        signups: r.signups, d0_trial: r.d0_trial, d0: r.d0, d0_revenue: r.d0_revenue,
        d6: r.d6, d6_revenue: r.d6_revenue, overall_revenue: r.overall_revenue,
        d6_overall_con: r.d6_overall_con, d6_overall_revenue: r.d6_overall_revenue,
        d15_overall_con: r.d15_overall_con, d15_overall_revenue: r.d15_overall_revenue,
        d30_overall_con: r.d30_overall_con, d30_overall_revenue: r.d30_overall_revenue,
        d60_overall_con: r.d60_overall_con, d60_overall_revenue: r.d60_overall_revenue,
        p0_signup: r.p0_signup, p1_signup: r.p1_signup, total_trial: r.total_trial,
        new_converted_user: r.new_converted_user, new_user_rev: r.new_user_rev,
        cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : null,
        ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null,
        cpi: r.installs > 0 ? r.spend / r.installs : null,
        hook: r.impressions > 0 ? (r.p25 / r.impressions) * 100 : null,
        hold: r.p25 > 0 ? (r.thruplay / r.p25) * 100 : null,
        fullPlay: r.impressions > 0 ? (r.p100 / r.impressions) * 100 : null,
        signupCost: r.signups > 0 ? r.spend / r.signups : null,
        signupPct: r.installs > 0 ? (r.signups / r.installs) * 100 : null,
        p0p1: p0p1,
        p0p1Cost: p0p1 > 0 ? r.spend / p0p1 : null,
        p0p1Pct: r.signups > 0 ? (p0p1 / r.signups) * 100 : null,
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

function rawFromItem(item) {
    var raw = emptyRaw();
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i++) raw[keys[i]] = Number(item && item[keys[i]]) || 0;
    return raw;
}

function applyRaw(target, raw) {
    var keys = Object.keys(emptyRaw());
    for (var i = 0; i < keys.length; i++) target[keys[i]] = Number(raw && raw[keys[i]]) || 0;
    return target;
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

function publishOptimizerContext(scan) {
    if (typeof window.__publishPortalContext !== 'function') return;
    var s = scan && scan.summary ? scan.summary : {};
    var matured = Number(s.matured_ads || 0);
    var early = Number(s.non_matured_ads || 0);
    window.__publishPortalContext({
        view: 'optimizer',
        title: 'Campaign Optimizer',
        subtitle: 'AI-generated optimization plan with one-click execution',
        dataMode: matured || early ? {
            type: matured && early ? 'mixed' : (matured ? 'mature' : 'early'),
            label: matured && early ? 'Mode: Mixed (' + matured + ' mature / ' + early + ' early)' : (matured ? 'Mode: Mature (' + matured + ')' : 'Mode: Early / Full Data (' + early + ')'),
            detail: buildMaturityNote(s, 'matured_ads', 'non_matured_ads', 'ad')
        } : {
            type: 'na',
            label: 'Mode: Awaiting scan',
            detail: 'Run a scan to populate maturity-aware optimizer context.'
        },
        diagnostics: {
            source: 'Meta + Metabase • Optimizer',
            matchedKeys: Number(s.matched_keys || 0),
            unmatchedKeys: Number(s.unmatched_keys || 0),
            lastUpdated: document.getElementById('lastUpdated') ? document.getElementById('lastUpdated').textContent : '--'
        }
    });
}

function buildScanEntityLookups(scanData) {
    var lookups = { ad: {}, adset: {}, campaign: {}, adByName: {}, adsetByName: {}, campaignByName: {} };
    (scanData && scanData.ads || []).forEach(function(ad) {
        if (!ad) return;
        if (ad.ad_id) lookups.ad[ad.ad_id] = ad;
        var campaignKey = normalizeCampaignName(ad.campaign_name || '');
        var adsetKey = campaignKey + '|||' + normalizeAdsetName(ad.adset_name || '');
        var adKey = adsetKey + '|||' + normalizeTrackerName(ad.ad_name || '');
        if (campaignKey && !lookups.campaignByName[campaignKey]) lookups.campaignByName[campaignKey] = null;
        if (adsetKey && !lookups.adsetByName[adsetKey]) lookups.adsetByName[adsetKey] = null;
        if (adKey && !lookups.adByName[adKey]) lookups.adByName[adKey] = ad;
        if (ad.adset_id && !lookups.adset[ad.adset_id]) {
            lookups.adset[ad.adset_id] = {
                entity_type: 'adset',
                entity_id: ad.adset_id,
                adset_id: ad.adset_id,
                campaign_id: ad.campaign_id,
                entity_name: ad.adset_name,
                campaign_name: ad.campaign_name,
                adset_name: ad.adset_name,
                adset_status: ad.adset_status || 'UNKNOWN',
                campaign_status: ad.campaign_status || 'UNKNOWN',
                delivery_state: getDeliveryState(ad.ad_status, ad.adset_status, ad.campaign_status),
                budget_level: ad.budget_level || 'unknown',
                budget_type: ad.budget_type || 'unknown',
                budget_entity_type: ad.budget_entity_type || '',
                budget_entity_id: ad.budget_entity_id || '',
                budget_entity_name: ad.budget_entity_name || '',
                budget_current_daily_budget: ad.budget_current_daily_budget || null
            };
        }
        if (ad.campaign_id && !lookups.campaign[ad.campaign_id]) {
            lookups.campaign[ad.campaign_id] = {
                entity_type: 'campaign',
                entity_id: ad.campaign_id,
                campaign_id: ad.campaign_id,
                entity_name: ad.campaign_name,
                campaign_name: ad.campaign_name,
                adset_name: '',
                campaign_status: ad.campaign_status || 'UNKNOWN',
                delivery_state: isEffectivelyPausedStatus(ad.campaign_status) ? 'paused_campaign' : (isActiveDeliveryStatus(ad.campaign_status) ? 'live' : 'unknown'),
                budget_level: ad.budget_level === 'campaign' ? 'campaign' : 'unknown',
                budget_type: ad.budget_level === 'campaign' ? (ad.budget_type || 'unknown') : 'unknown',
                budget_entity_type: ad.budget_level === 'campaign' ? (ad.budget_entity_type || 'campaign') : '',
                budget_entity_id: ad.budget_level === 'campaign' ? (ad.budget_entity_id || ad.campaign_id) : '',
                budget_entity_name: ad.budget_level === 'campaign' ? (ad.budget_entity_name || ad.campaign_name) : '',
                budget_current_daily_budget: ad.budget_level === 'campaign' ? (ad.budget_current_daily_budget || null) : null
            };
        }
        if (adsetKey && lookups.adset[ad.adset_id] && !lookups.adsetByName[adsetKey]) lookups.adsetByName[adsetKey] = lookups.adset[ad.adset_id];
        if (campaignKey && lookups.campaign[ad.campaign_id] && !lookups.campaignByName[campaignKey]) lookups.campaignByName[campaignKey] = lookups.campaign[ad.campaign_id];
    });
    return lookups;
}

function resolvePlanSource(action, lookups) {
    var entityType = String(action && action.entity_type || '').toLowerCase();
    var entityId = action && action.entity_id;
    if (entityId) {
        if (entityType === 'ad' && lookups.ad[entityId]) return lookups.ad[entityId];
        if (entityType === 'adset' && lookups.adset[entityId]) return lookups.adset[entityId];
        if (entityType === 'campaign' && lookups.campaign[entityId]) return lookups.campaign[entityId];
        if (lookups.ad[entityId]) return lookups.ad[entityId];
        if (lookups.adset[entityId]) return lookups.adset[entityId];
        if (lookups.campaign[entityId]) return lookups.campaign[entityId];
    }
    var campaignName = normalizeCampaignName((action && (action.campaign_name || action.entity_name)) || '');
    var adsetName = normalizeAdsetName((action && (action.adset_name || action.entity_name)) || '');
    var adName = normalizeTrackerName((action && action.entity_name) || '');
    if (entityType === 'campaign' && campaignName && lookups.campaignByName[campaignName]) return lookups.campaignByName[campaignName];
    if (entityType === 'adset') {
        var namedAdsetKey = campaignName + '|||' + adsetName;
        if (campaignName && adsetName && lookups.adsetByName[namedAdsetKey]) return lookups.adsetByName[namedAdsetKey];
    }
    if (entityType === 'ad') {
        var namedAdKey = campaignName + '|||' + normalizeAdsetName(action && action.adset_name || '') + '|||' + adName;
        if (campaignName && adName && lookups.adByName[namedAdKey]) return lookups.adByName[namedAdKey];
    }
    if (campaignName && lookups.campaignByName[campaignName]) return lookups.campaignByName[campaignName];
    if (campaignName && adsetName && lookups.adsetByName[campaignName + '|||' + adsetName]) return lookups.adsetByName[campaignName + '|||' + adsetName];
    return null;
}

function enrichPlanWithScanContext(plan, scanData) {
    if (!plan || !scanData || !scanData.ads) return plan;
    var lookups = buildScanEntityLookups(scanData);
    (plan.actions || []).forEach(function(action) {
        if (!action || !action.entity_id) return;
        var source = resolvePlanSource(action, lookups);
        if (!source) return;
        action.is_matured = source.isMatured;
        action.days_live = source.daysSinceGoLive;
        action.data_mode = source._evalMode;
        action.data_mode_label = source.evalDataLabel;
        action.data_range = scanData.date_range.since + ' → ' + scanData.date_range.until;
        action.current_metrics = Object.assign({}, action.current_metrics || {}, {
            spend: source.spend,
            d6_roas: source.d6ROAS,
            d6_cac: source.d6CAC,
            signup_cost: source.signupCost,
            cpi: source.cpi,
            installs: source.installs,
            signups: source.signups,
            d6: source.evalD6 != null ? source.evalD6 : source.d6,
            alert_status: source.alertStatus,
            ad_status: source.ad_status || '',
            adset_status: source.adset_status || '',
            campaign_status: source.campaign_status || '',
            delivery_state: source.delivery_state || '',
            budget_level: source.budget_level || '',
            budget_type: source.budget_type || '',
            budget_owner: source.budget_entity_name || '',
            budget_current_daily_budget: source.budget_current_daily_budget || null
        });
    });
    return plan;
}

// ── Date helpers ──

function readDateInputValue(id) {
    var el = document.getElementById(id);
    return el && el.value ? el.value : null;
}

function readActiveTreeRange() {
    var since = readDateInputValue('treeDateFrom');
    var until = readDateInputValue('treeDateTo');
    return since && until ? { since: since, until: until, source: 'Campaign Tree' } : null;
}

function readPortalRange() {
    var since = readDateInputValue('dateFrom');
    var until = readDateInputValue('dateTo');
    return since && until ? { since: since, until: until, source: 'Main Dashboard' } : null;
}

function sameDateRange(left, right) {
    return !!(left && right && left.since === right.since && left.until === right.until);
}

function getOptimizerRangeContext(scanRange) {
    var treeRange = readActiveTreeRange();
    if (!treeRange) {
        return {
            inSyncWithTree: null,
            label: 'Campaign Tree range unavailable',
            detail: 'Set Campaign Tree dates to run a direct parity check.'
        };
    }
    if (sameDateRange(scanRange, treeRange)) {
        return {
            inSyncWithTree: true,
            label: 'Aligned with Campaign Tree',
            detail: treeRange.since + ' -> ' + treeRange.until
        };
    }
    return {
        inSyncWithTree: false,
        label: 'Range mismatch vs Campaign Tree',
        detail: 'Optimizer ' + scanRange.since + ' -> ' + scanRange.until + ' | Campaign Tree ' + treeRange.since + ' -> ' + treeRange.until
    };
}

function getDefaultDates() {
    if (window.OPTIMIZER_SCAN && window.OPTIMIZER_SCAN.date_range) {
        return window.OPTIMIZER_SCAN.date_range;
    }
    var treeRange = readActiveTreeRange();
    if (treeRange) return { since: treeRange.since, until: treeRange.until };
    var portalRange = readPortalRange();
    if (portalRange) return { since: portalRange.since, until: portalRange.until };
    var now = new Date();
    var until = now.toISOString().split('T')[0];
    var since = new Date(now - 29 * 86400000).toISOString().split('T')[0];
    return { since: since, until: until };
}

function getSelectedDates() {
    var fromEl = document.getElementById('optDateFrom');
    var toEl = document.getElementById('optDateTo');
    if (fromEl && toEl && fromEl.value && toEl.value) return { since: fromEl.value, until: toEl.value };
    return getDefaultDates();
}

function ensureScanRaw(map, key, seed) {
    if (!map[key]) map[key] = Object.assign(emptyRaw(), seed || {});
    return map[key];
}

function addScanFunnelRaw(target, row) {
    target.signups += Number(row.signups) || 0;
    target.d0_trial += Number(row.d0_trial) || 0;
    target.d0 += Number(row.d0) || 0;
    target.d0_revenue += Number(row.d0_revenue) || 0;
    target.d6 += Number(row.d6) || 0;
    target.d6_revenue += Number(row.d6_revenue) || 0;
    target.overall_revenue += Number(row.overall_revenue) || 0;
    target.new_converted_user += Number(row.new_converted_user) || 0;
    target.new_user_rev += Number(row.new_user_rev) || 0;
    target.p0_signup += Number(row.p0_signup) || 0;
    target.p1_signup += Number(row.p1_signup) || 0;
    target.total_trial += Number(row.total_trial) || 0;
    target.d6_overall_con += Number(row.d6_overall_con) || 0;
    target.d6_overall_revenue += Number(row.d6_overall_revenue) || 0;
}

function addScanMetaRaw(target, row) {
    target.spend += (Number(row.spend) || 0) * 1.18;
    target.impressions += Number(row.impressions) || 0;
    target.clicks += Number(row.clicks) || 0;
    target.installs += Number(row.installs) || 0;
    target.thruplay += Number(row.thruplay) || 0;
    target.p25 += Number(row.p25) || 0;
    target.p100 += Number(row.p100) || 0;
}

// ── Scanner — uses same endpoints as Campaign Tree ──

async function scanAccount(progressCb) {
    var dr = getSelectedDates();
    progressCb('Fetching data from Meta API + Metabase...');

    var metaRes, funnelRes, adsStatusRes;
    try {
        var results = await Promise.all([
            fetch(SERVER + '/api/meta/ad-insights-daily', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom: dr.since, dateTo: dr.until })
            }).then(function(r) { return r.json(); }),
            fetch(SERVER + '/api/metabase/ad-funnel', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom: dr.since, dateTo: dr.until })
            }).then(function(r) { return r.json(); }),
            fetch(SERVER + '/api/meta/ads-status?fresh=1').then(function(r) { return r.json(); }).catch(function() { return { success: false }; })
        ]);
        metaRes = results[0];
        funnelRes = results[1];
        adsStatusRes = results[2];
    } catch (err) {
        throw new Error('Failed to fetch data: ' + err.message);
    }

    if (!metaRes.success) throw new Error('Meta API: ' + metaRes.error);
    if (!funnelRes.success) throw new Error('Metabase: ' + funnelRes.error);

    // Build ad status lookup: ad_id → { created_time, status }
    var adStatusMap = {};
    if (adsStatusRes && adsStatusRes.success && adsStatusRes.data) {
        adsStatusRes.data.forEach(function(ad) {
            adStatusMap[ad.ad_id] = ad;
        });
    }

    progressCb('Meta: ' + metaRes.total + ' rows | Metabase: ' + funnelRes.total + ' rows | Ad statuses: ' + Object.keys(adStatusMap).length + '. Matching...');

    // Build daily Metabase lookup (same as Campaign Tree)
    // FIXED: ID-based join — use meta_campaign_id from Metabase instead of campaign_name
    var mbDaily = {};
    var mbCampaign = {};
    var mbAdset = {};
    for (var fi = 0; fi < funnelRes.data.length; fi++) {
        var row = funnelRes.data[fi];
        var key = buildJoinKey(row.date, row.campaign_name, row.ad_set_name, row.tracker_name);
        addScanFunnelRaw(ensureScanRaw(mbDaily, key), row);

        var campKeyMb = normalizeCampaignName(row.campaign_name || '');
        addScanFunnelRaw(ensureScanRaw(mbCampaign, campKeyMb, {
            campaign_name: row.campaign_name || '',
            campaign_id: row.meta_campaign_id || ''
        }), row);

        var adsetKeyMb = campKeyMb + '|||' + normalizeAdsetName(row.ad_set_name || '');
        addScanFunnelRaw(ensureScanRaw(mbAdset, adsetKeyMb, {
            campaign_name: row.campaign_name || '',
            campaign_id: row.meta_campaign_id || '',
            adset_name: row.ad_set_name || '',
            adset_id: ''
        }), row);
    }

    // Match Meta to Metabase — identical logic to Campaign Tree
    var metaCampaign = {};
    var metaAdset = {};
    var adAgg = {};
    var matchedKeys = 0, unmatchedKeys = 0;
    var matchedMbKeys = {};
    var metaRows = (metaRes.data || []).filter(function(row) {
        return /android/i.test(row.campaign_name || '');
    });

    progressCb('Matching ' + metaRows.length + ' Meta rows to ' + Object.keys(mbDaily).length + ' Metabase keys...');

    for (var mi = 0; mi < metaRows.length; mi++) {
        var mr = metaRows[mi];
        var campKey = normalizeCampaignName(mr.campaign_name || '');
        addScanMetaRaw(ensureScanRaw(metaCampaign, campKey, {
            campaign_name: mr.campaign_name || '',
            campaign_id: mr.campaign_id || ''
        }), mr);

        var metaAdsetKey = campKey + '|||' + normalizeAdsetName(mr.adset_name || '');
        addScanMetaRaw(ensureScanRaw(metaAdset, metaAdsetKey, {
            campaign_name: mr.campaign_name || '',
            campaign_id: mr.campaign_id || '',
            adset_name: mr.adset_name || '',
            adset_id: mr.adset_id || ''
        }), mr);

        var adUid = mr.campaign_name + '|||' + mr.adset_name + '|||' + mr.ad_name;
        if (!adAgg[adUid]) {
            adAgg[adUid] = {
                campaign_name: mr.campaign_name, campaign_id: mr.campaign_id,
                adset_name: mr.adset_name, adset_id: mr.adset_id,
                ad_name: mr.ad_name, ad_id: mr.ad_id,
                spend: 0, impressions: 0, clicks: 0, installs: 0,
                thruplay: 0, p25: 0, p100: 0,
                signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
                d6: 0, d6_revenue: 0, overall_revenue: 0,
                new_converted_user: 0, new_user_rev: 0,
                p0_signup: 0, p1_signup: 0, total_trial: 0,
                d6_overall_con: 0, d6_overall_revenue: 0, _matched: false
            };
        }
        var a = adAgg[adUid];
        addScanMetaRaw(a, mr);

        // FIXED: ID-based join — use campaign_id from Meta API to match meta_campaign_id from Metabase
        var mbKey = buildJoinKey(mr.date_start, mr.campaign_name, mr.adset_name, mr.ad_name);
        var mb = mbDaily[mbKey];
        if (mb) {
            matchedKeys++;
            matchedMbKeys[mbKey] = true;
            a._matched = true;
            addScanFunnelRaw(a, mb);
        } else {
            unmatchedKeys++;
        }
    }

    // Add unmatched Metabase entries
    for (var mbk in mbDaily) {
        if (!matchedMbKeys[mbk]) {
            var parts = mbk.split('|||');
            var uid = parts[1] + '|||' + parts[2] + '|||' + parts[3];
            var au = ensureScanRaw(adAgg, uid, {
                campaign_name: parts[1] || '',
                campaign_id: '',
                adset_name: parts[2] || '',
                adset_id: '',
                ad_name: parts[3] || '',
                ad_id: '',
                _matched: true
            });
            au._matched = true;
            addScanFunnelRaw(au, mbDaily[mbk]);
        }
    }

    // Add PAUSED ads from ads-status that have no spend in the date range
    // These are reactivation candidates — they had historical performance but were turned off
    if (adsStatusRes && adsStatusRes.success && adsStatusRes.data) {
        var existingAdIds = {};
        for (var ek in adAgg) { if (adAgg[ek].ad_id) existingAdIds[adAgg[ek].ad_id] = true; }
        adsStatusRes.data.forEach(function(ad) {
            if (!/android/i.test(ad.campaign_name || '')) return;
            if (isEffectivelyPausedStatus(ad.status) && !existingAdIds[ad.ad_id]) {
                var uid = (ad.campaign_name || '') + '|||' + (ad.adset_name || '') + '|||' + (ad.ad_name || '');
                adAgg[uid] = {
                    campaign_name: ad.campaign_name || '', campaign_id: ad.campaign_id || '',
                adset_name: ad.adset_name || '', adset_id: ad.adset_id || '',
                ad_name: ad.ad_name || '', ad_id: ad.ad_id,
                spend: 0, impressions: 0, clicks: 0, installs: 0,
                thruplay: 0, p25: 0, p100: 0,
                signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0, d6: 0, d6_revenue: 0,
                overall_revenue: 0, new_converted_user: 0, new_user_rev: 0, p0_signup: 0,
                p1_signup: 0, total_trial: 0, d6_overall_con: 0, d6_overall_revenue: 0,
                _matched: false, _pausedNoSpend: true
            };
            }
        });
    }

    // Compute derived metrics per ad with go-live maturity logic
    var DECISION_MATURITY_DAYS = 29 * 24 * 60 * 60 * 1000;
    var now = Date.now();

    // Include ads with spend > 0 AND paused ads with no spend (reactivation candidates)
    var ads = Object.values(adAgg).filter(function(x) { return x.spend > 0 || x._pausedNoSpend; }).map(function(a) {
        // Enrich with ad status, parent statuses, and budget ownership metadata
        var statusInfo = adStatusMap[a.ad_id];
        a.created_time = statusInfo ? statusInfo.created_time : null;
        a.ad_status = statusInfo ? statusInfo.status : 'UNKNOWN';
        a.adset_status = statusInfo ? (statusInfo.adset_status || 'UNKNOWN') : 'UNKNOWN';
        a.campaign_status = statusInfo ? (statusInfo.campaign_status || 'UNKNOWN') : 'UNKNOWN';
        a.budget_level = statusInfo ? (statusInfo.budget_level || 'unknown') : 'unknown';
        a.budget_type = statusInfo ? (statusInfo.budget_type || 'unknown') : 'unknown';
        a.budget_entity_type = statusInfo ? (statusInfo.budget_entity_type || '') : '';
        a.budget_entity_id = statusInfo ? (statusInfo.budget_entity_id || '') : '';
        a.budget_entity_name = statusInfo ? (statusInfo.budget_entity_name || '') : '';
        a.budget_current_daily_budget = statusInfo && statusInfo.budget_current_daily_budget != null ? Number(statusInfo.budget_current_daily_budget) : null;
        a.delivery_state = getDeliveryState(a.ad_status, a.adset_status, a.campaign_status);
        a.is_effectively_paused = a.delivery_state.indexOf('paused') === 0;
        a.is_live = a.delivery_state === 'live';

        // Determine go-live date: use created_time from Meta, fallback to first spend date
        var goLiveTs = 0;
        if (a.created_time) {
            goLiveTs = new Date(a.created_time).getTime();
        }
        a.goLiveDate = goLiveTs ? new Date(goLiveTs).toISOString().split('T')[0] : null;
        a.daysSinceGoLive = goLiveTs ? Math.floor((now - goLiveTs) / (24 * 60 * 60 * 1000)) : null;
        a.isMatured = goLiveTs ? (now - goLiveTs) >= DECISION_MATURITY_DAYS : false;

        a._fullRangeRaw = rawFromItem(a);
        a._evalMode = a.isMatured ? 'full_fallback' : 'full_early';
        a._evalRaw = rawFromItem(a);
        applyRaw(a, a._evalRaw);

        // Derive all metrics via the evaluated raw totals
        var derived = deriveMetrics(a);
        a.cpi = derived.cpi;
        a.ctr = derived.ctr;
        a.signupCost = derived.signupCost;
        a.d0TrialCost = derived.d0TrialCost;
        a.d6CAC_raw = derived.d6CAC;
        a.d6ROAS_raw = derived.d6ROAS;

        // Matured D6 metrics: only reliable for ads live long enough for the 29-day decision model
        // Both matured and non-matured use same raw values; maturity label differs
        a.d6CAC = derived.d6CAC;
        a.d6ROAS = derived.d6ROAS;
        a.d6 = derived.d6Con;
        a.evalD6 = derived.d6Con;
        a.evalDataLabel = a._evalMode === 'mature'
            ? 'Mature data (29-day decision model)'
            : (a._evalMode === 'full_fallback'
                ? 'Full data (no 29-day mature window available in selected range)'
                : 'Full data (ad still early / not mature yet)');
        a.d6Label = a._evalMode === 'mature'
            ? 'Matured (29-day decision model)'
            : (a.daysSinceGoLive !== null ? a.daysSinceGoLive + 'd old • Full data' : 'Unknown age • Full data');

        a.d6OverallROAS = _vR(a.spend, a.d6_overall_revenue) || 0;
        a.overallROAS = derived.overallROAS;
        a.alertStatus = classifyAlert(a);
        return a;
    });

    // Build tree
    var tree = {};
    for (var ti = 0; ti < ads.length; ti++) {
        var ad = ads[ti];
        if (!tree[ad.campaign_name]) {
            tree[ad.campaign_name] = {
                name: ad.campaign_name,
                id: ad.campaign_id,
                campaign_status: ad.campaign_status || 'UNKNOWN',
                budget_level: ad.budget_level === 'campaign' ? ad.budget_level : 'unknown',
                budget_type: ad.budget_level === 'campaign' ? ad.budget_type : 'unknown',
                budget_entity_type: ad.budget_level === 'campaign' ? ad.budget_entity_type : '',
                budget_entity_id: ad.budget_level === 'campaign' ? ad.budget_entity_id : '',
                budget_entity_name: ad.budget_level === 'campaign' ? ad.budget_entity_name : '',
                budget_current_daily_budget: ad.budget_level === 'campaign' ? ad.budget_current_daily_budget : null,
                adsets: {}
            };
        }
        if (!tree[ad.campaign_name].adsets[ad.adset_name]) {
            tree[ad.campaign_name].adsets[ad.adset_name] = {
                name: ad.adset_name,
                id: ad.adset_id,
                adset_status: ad.adset_status || 'UNKNOWN',
                campaign_status: ad.campaign_status || 'UNKNOWN',
                budget_level: ad.budget_level || 'unknown',
                budget_type: ad.budget_type || 'unknown',
                budget_entity_type: ad.budget_entity_type || '',
                budget_entity_id: ad.budget_entity_id || '',
                budget_entity_name: ad.budget_entity_name || '',
                budget_current_daily_budget: ad.budget_current_daily_budget,
                ads: []
            };
        }
        tree[ad.campaign_name].adsets[ad.adset_name].ads.push(ad);
    }

    var campaignAgg = {};
    for (var ckRaw in metaCampaign) {
        campaignAgg[ckRaw] = Object.assign(emptyRaw(), metaCampaign[ckRaw], {
            campaign_name: metaCampaign[ckRaw].campaign_name,
            campaign_id: metaCampaign[ckRaw].campaign_id
        });
    }
    for (var ckMb in mbCampaign) {
        if (!campaignAgg[ckMb]) {
            campaignAgg[ckMb] = Object.assign(emptyRaw(), {
                campaign_name: mbCampaign[ckMb].campaign_name,
                campaign_id: mbCampaign[ckMb].campaign_id
            });
        }
        addScanFunnelRaw(campaignAgg[ckMb], mbCampaign[ckMb]);
    }

    var adsetAgg = {};
    for (var akRaw in metaAdset) {
        adsetAgg[akRaw] = Object.assign(emptyRaw(), metaAdset[akRaw], {
            campaign_name: metaAdset[akRaw].campaign_name,
            campaign_id: metaAdset[akRaw].campaign_id,
            adset_name: metaAdset[akRaw].adset_name,
            adset_id: metaAdset[akRaw].adset_id
        });
    }
    for (var akMb in mbAdset) {
        if (!adsetAgg[akMb]) {
            adsetAgg[akMb] = Object.assign(emptyRaw(), {
                campaign_name: mbAdset[akMb].campaign_name,
                campaign_id: mbAdset[akMb].campaign_id,
                adset_name: mbAdset[akMb].adset_name,
                adset_id: mbAdset[akMb].adset_id
            });
        }
        addScanFunnelRaw(adsetAgg[akMb], mbAdset[akMb]);
    }

    // Aggregate totals using the same campaign/adset layers as Campaign Tree
    var redCount = 0, greenCount = 0;
    for (var ck in tree) {
        for (var ak in tree[ck].adsets) {
            var adset = tree[ck].adsets[ak];
            adset.ads.sort(function(x, y) { return y.spend - x.spend; });
            var adsetKey = normalizeCampaignName(ck) + '|||' + normalizeAdsetName(ak);
            var adsetRaw = adsetAgg[adsetKey] || emptyRaw();
            adset.totals = Object.assign(deriveMetrics(adsetRaw), { adset_id: adset.id || adsetRaw.adset_id || '' });
        }
        var campaignRaw = campaignAgg[normalizeCampaignName(ck)] || emptyRaw();
        tree[ck].totals = Object.assign(deriveMetrics(campaignRaw), { campaign_id: tree[ck].id || campaignRaw.campaign_id || '' });
    }
    for (var ai2 = 0; ai2 < ads.length; ai2++) {
        if (ads[ai2].alertStatus === 'red') redCount++;
        else if (ads[ai2].alertStatus === 'green') greenCount++;
    }

    var evaluatedTotals = deriveMetrics(sumRaw(Object.values(campaignAgg)));
    var totalSpend = Object.values(campaignAgg).reduce(function(s, x) { return s + (x.spend || 0); }, 0);
    var totalAdsets = Object.values(tree).reduce(function(s, c) { return s + Object.keys(c.adsets).length; }, 0);

    var scanResult = {
        scan_date: new Date().toISOString(),
        date_range: dr,
        tree: tree,
        ads: ads,
        evaluatedTotals: evaluatedTotals,
        rangeContext: getOptimizerRangeContext(dr),
        summary: {
            total_campaigns: Object.keys(tree).length,
            total_adsets: totalAdsets,
            total_ads: ads.length,
            total_spend: totalSpend,
            red_ads: redCount,
            green_ads: greenCount,
            matched_keys: matchedKeys,
            unmatched_keys: unmatchedKeys,
            matured_ads: ads.filter(function(a) { return a.isMatured; }).length,
            non_matured_ads: ads.filter(function(a) { return !a.isMatured; }).length,
            ads_with_status: ads.filter(function(a) { return a.created_time; }).length
        }
    };

    window.OPTIMIZER_SCAN = scanResult;
    return scanResult;
}

// Maturity-aware alert classification with WoW trend signals
function classifyAlert(d) {
    if (d.spend < 15000) return 'neutral';

    // WoW trend signals (from window.allData if available, or from d._wow)
    var wow = d._wow || {};
    var trendBreaches = wow.trendBreaches || 0;
    var trendHits = wow.trendHits || 0;

    // For NON-MATURED ads (<29 days), use early funnel signals
    // EXCEPTION: exceptional D6 ROAS = always green regardless of maturity
    if (!d.isMatured) {
        if (d.d6ROAS > 28) return 'green';
        var earlyBreaches = trendBreaches;
        if (d.signupCost > 1000) earlyBreaches++;
        if (d.d0TrialCost > 3500) earlyBreaches++;
        if (d.cpi > 200) earlyBreaches++;
        if (d.installs > 50 && d.signups === 0) earlyBreaches++;
        if (earlyBreaches >= 2) return 'red';

        // If early signals look good
        var earlyHits = trendHits;
        if (d.signupCost > 0 && d.signupCost < 500) earlyHits++;
        if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) earlyHits++;
        if (d.cpi > 0 && d.cpi < 100) earlyHits++;
        if (earlyHits >= 2) return 'green';

        return 'neutral';
    }

    // MATURED ads: use matured D6 metrics (excl current week if WoW data available)
    var matD6ROAS = (wow.maturedD6ROAS != null) ? wow.maturedD6ROAS : d.d6ROAS;
    var matD6CAC = (wow.maturedD6CAC != null) ? wow.maturedD6CAC : d.d6CAC;
    if (matD6ROAS > 28) return 'green';
    var breaches = trendBreaches;
    if (d.signupCost > 1000) breaches++;
    if (d.d0TrialCost > 3500) breaches++;
    if (matD6CAC > 15000) breaches++;
    if (breaches >= 2) return 'red';
    var hits = trendHits;
    if (d.signupCost > 0 && d.signupCost < 500) hits++;
    if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) hits++;
    if (d.d6CAC > 0 && d.d6CAC < 12000) hits++;
    if (hits >= 2) return 'green';
    return 'neutral';
}

function sumAds(adsList) {
    return deriveMetrics(sumRaw(adsList));
}

function medianMetric(items, selector) {
    var vals = (items || []).map(selector).filter(function(v) { return v != null && isFinite(v) && v > 0; }).sort(function(a, b) { return a - b; });
    if (!vals.length) return 0;
    var mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

function buildOptimizerBenchmarks(ads) {
    var cohort = (ads || []).filter(function(a) { return (a.spend || 0) >= 15000; });
    return {
        scope: 'meta_optimizer_account',
        sample_size: cohort.length,
        median_d6_roas: medianMetric(cohort, function(a) { return a.d6ROAS; }),
        median_d6_cac: medianMetric(cohort, function(a) { return a.d6CAC; }),
        median_signup_cost: medianMetric(cohort, function(a) { return a.signupCost; }),
        median_d0_trial_cost: medianMetric(cohort, function(a) { return a.d0TrialCost; }),
        median_cpi: medianMetric(cohort, function(a) { return a.cpi; })
    };
}

// ── AI Plan Generator ──

function retargetActionTo(action, entityType, entityId, entityName, campaignName, adsetName) {
    action.entity_type = entityType;
    action.entity_id = entityId || action.entity_id;
    action.entity_name = entityName || action.entity_name;
    action.campaign_name = campaignName != null ? campaignName : action.campaign_name;
    action.adset_name = adsetName != null ? adsetName : action.adset_name;
    return action;
}

function setBudgetActionFromOwner(action, source, direction) {
    if (!source || source.budget_type !== 'daily' || !source.budget_entity_id || !source.budget_level) return false;
    var currentBudget = Number(source.budget_current_daily_budget) || 0;
    if (currentBudget <= 0) return false;
    action.budget_change = Object.assign({}, action.budget_change || {});
    action.budget_change.current_daily_budget = Math.round(currentBudget);
    var recommended = Number(action.budget_change.recommended_daily_budget);
    if (!(recommended > 0)) recommended = getDefaultBudgetRecommendation(currentBudget, direction);
    if (!(recommended > 0)) return false;
    if (direction === 'decrease' && recommended >= currentBudget) recommended = getDefaultBudgetRecommendation(currentBudget, 'decrease');
    if (direction === 'increase' && recommended <= currentBudget) recommended = getDefaultBudgetRecommendation(currentBudget, 'increase');
    action.budget_change.recommended_daily_budget = Math.round(recommended);
    action.budget_change.change_pct = currentBudget > 0 ? (((recommended - currentBudget) / currentBudget) * 100).toFixed(0) + '%' : '';
    if (source.budget_level === 'campaign') {
        action.action_type = 'UPDATE_CAMPAIGN_BUDGET';
        retargetActionTo(action, 'campaign', source.budget_entity_id, source.budget_entity_name || source.campaign_name, source.campaign_name || action.campaign_name, '');
    } else if (source.budget_level === 'adset') {
        action.action_type = 'UPDATE_ADSET_BUDGET';
        retargetActionTo(action, 'adset', source.budget_entity_id, source.budget_entity_name || source.adset_name, source.campaign_name || action.campaign_name, source.adset_name || action.adset_name);
    } else {
        return false;
    }
    return true;
}

function convertActionToMonitor(action, note) {
    action.action_type = 'MONITOR';
    action.category = action.category || 'MONITOR';
    if (note) {
        action.action_detail = note;
        action.diagnosis = action.diagnosis ? (action.diagnosis + ' ' + note) : note;
    }
    return action;
}

function normalizePauseActionFromState(action, source) {
    var state = Object.assign({}, action && action.current_metrics || {}, source || {});
    var deliveryState = state.delivery_state || getDeliveryState(state.ad_status, state.adset_status, state.campaign_status);
    if (action.action_type === 'PAUSE_AD') {
        if (deliveryState === 'paused_campaign') {
            return convertActionToMonitor(action, 'Campaign is already paused, so pausing the child ad is redundant.');
        }
        if (deliveryState === 'paused_adset') {
            return convertActionToMonitor(action, 'Adset is already paused, so pausing the child ad is redundant.');
        }
        if (deliveryState === 'paused_ad' || isEffectivelyPausedStatus(state.ad_status)) {
            return convertActionToMonitor(action, 'Ad is already paused.');
        }
    }
    if (action.action_type === 'PAUSE_ADSET') {
        if (deliveryState === 'paused_campaign') {
            return convertActionToMonitor(action, 'Campaign is already paused, so pausing the adset is redundant.');
        }
        if (deliveryState === 'paused_adset' || isEffectivelyPausedStatus(state.adset_status)) {
            return convertActionToMonitor(action, 'Adset is already paused.');
        }
    }
    if (action.action_type === 'PAUSE_CAMPAIGN' && isEffectivelyPausedStatus(state.campaign_status)) {
        return convertActionToMonitor(action, 'Campaign is already paused.');
    }
    return action;
}

function normalizeOptimizationPlan(plan, scanData) {
    if (!plan || !Array.isArray(plan.actions) || !scanData) return plan;
    var lookups = buildScanEntityLookups(scanData);
    var increaseBudgetTypes = { SCALE_BUDGET: true, SCALE_AD_BUDGET: true, SCALE_ADSET: true, SCALE_CAMPAIGN: true, SCALE_ADSET_BUDGET: true, SCALE_CAMPAIGN_BUDGET: true };
    var decreaseBudgetTypes = { CUT_ADSET_BUDGET: true, CUT_CAMPAIGN_BUDGET: true, REDUCE_BUDGET: true };
    var shiftBudgetTypes = { INTRA_ADSET_SHIFT: true, AUDIENCE_SHIFT: true, BUDGET_REALLOCATION: true };

    plan.actions = plan.actions.map(function(rawAction, index) {
        var action = Object.assign({}, rawAction || {});
        action.action_id = action.action_id || ('ACT-' + String(index + 1).padStart(3, '0'));
        action.action_type = String(action.action_type || 'MONITOR').toUpperCase();
        action.entity_type = String(action.entity_type || '').toLowerCase();
        var source = resolvePlanSource(action, lookups);
        if (source) {
            action.current_metrics = Object.assign({}, action.current_metrics || {}, {
                ad_status: source.ad_status || '',
                adset_status: source.adset_status || '',
                campaign_status: source.campaign_status || '',
                delivery_state: source.delivery_state || '',
                budget_level: source.budget_level || '',
                budget_type: source.budget_type || '',
                budget_owner: source.budget_entity_name || '',
                budget_current_daily_budget: source.budget_current_daily_budget || null
            });
        }

        if (action.action_type === 'REACTIVATE_AD') action.action_type = 'ACTIVATE_AD';
        if (action.action_type === 'REACTIVATE_ADSET') action.action_type = 'ACTIVATE_ADSET';
        if (action.action_type === 'REACTIVATE_CAMPAIGN') action.action_type = 'ACTIVATE_CAMPAIGN';
        if (action.action_type === 'KILL_AD') action.action_type = 'PAUSE_AD';

        if (shiftBudgetTypes[action.action_type]) {
            return convertActionToMonitor(action, 'Budget cannot be shifted at ad level. Review the campaign/adset owner budget manually.');
        }

        if (increaseBudgetTypes[action.action_type] || decreaseBudgetTypes[action.action_type]) {
            if (!source || !setBudgetActionFromOwner(action, source, increaseBudgetTypes[action.action_type] ? 'increase' : 'decrease')) {
                return convertActionToMonitor(action, 'Budget owner is not a daily campaign/adset budget, so no direct executable budget change is possible here.');
            }
        }

        if (action.action_type === 'UPDATE_ADSET_BUDGET' || action.action_type === 'UPDATE_CAMPAIGN_BUDGET') {
            if (!source || !setBudgetActionFromOwner(action, source, (action.budget_change && Number(action.budget_change.recommended_daily_budget) < Number(action.budget_change.current_daily_budget)) ? 'decrease' : 'increase')) {
                return convertActionToMonitor(action, 'Budget owner is not a daily campaign/adset budget, so this budget update was downgraded to monitor.');
            }
        }

        if (action.action_type === 'ACTIVATE_AD' || action.action_type === 'ACTIVATE_ADSET') {
            if (source && getActivationActionForAd(source) === 'ACTIVATE_CAMPAIGN') {
                action.action_type = 'ACTIVATE_CAMPAIGN';
            } else if (source && getActivationActionForAd(source) === 'ACTIVATE_ADSET' && action.action_type === 'ACTIVATE_AD') {
                action.action_type = 'ACTIVATE_ADSET';
            }
        }

        if (action.action_type === 'PAUSE_AD' || action.action_type === 'PAUSE_ADSET' || action.action_type === 'PAUSE_CAMPAIGN') {
            action = normalizePauseActionFromState(action, source);
        }

        if (source && action.action_type === 'ACTIVATE_CAMPAIGN') {
            retargetActionTo(action, 'campaign', source.campaign_id || source.budget_entity_id, source.campaign_name || source.budget_entity_name || action.entity_name, source.campaign_name || action.campaign_name, '');
        } else if (source && action.action_type === 'PAUSE_CAMPAIGN') {
            retargetActionTo(action, 'campaign', source.campaign_id || source.budget_entity_id, source.campaign_name || action.entity_name, source.campaign_name || action.campaign_name, '');
        } else if (source && action.action_type === 'ACTIVATE_ADSET') {
            retargetActionTo(action, 'adset', source.adset_id || source.entity_id, source.adset_name || action.entity_name, source.campaign_name || action.campaign_name, source.adset_name || action.adset_name);
        } else if (source && action.action_type === 'PAUSE_ADSET') {
            retargetActionTo(action, 'adset', source.adset_id || source.entity_id, source.adset_name || action.entity_name, source.campaign_name || action.campaign_name, source.adset_name || action.adset_name);
        } else if (source && (action.action_type === 'PAUSE_AD' || action.action_type === 'ACTIVATE_AD')) {
            retargetActionTo(action, 'ad', source.ad_id || source.entity_id, source.ad_name || action.entity_name, source.campaign_name || action.campaign_name, source.adset_name || action.adset_name);
        }

        if (!isExecutableActionType(action.action_type) && action.action_type !== 'MONITOR' && action.action_type !== 'CREATIVE_CHANGE') {
            return convertActionToMonitor(action, 'Unsupported action type was downgraded to monitor.');
        }
        if (isExecutableActionType(action.action_type) && !action.entity_id) {
            return convertActionToMonitor(action, 'Missing Meta entity id for execution.');
        }
        return action;
    });
    return plan;
}

function buildCompactTree(tree) {
    // Only include ads with >₹5K spend — rest are summarized as counts
    var MIN_SPEND = 5000;
    var compact = {};
    var skippedCount = 0;
    for (var ck in tree) {
        var camp = tree[ck];
        var campData = {
            id: camp.id,
            campaign_status: camp.campaign_status || 'UNKNOWN',
            budget_level: camp.budget_level || 'unknown',
            budget_type: camp.budget_type || 'unknown',
            budget_owner_name: camp.budget_entity_name || '',
            budget_current_daily_budget: camp.budget_current_daily_budget || null,
            adsets: {}
        };
        var hasContent = false;
        for (var ak in camp.adsets) {
            var as = camp.adsets[ak];
            var significantAds = as.ads.filter(function(ad) { return ad.spend >= MIN_SPEND; });
            var smallAds = as.ads.length - significantAds.length;
            skippedCount += smallAds;
            if (!significantAds.length && smallAds > 0) {
                // Adset with only tiny-spend ads — just note it
                campData.adsets[ak] = {
                    id: as.id,
                    totals: { spend: Math.round(as.totals.spend), d6ROAS: +as.totals.d6ROAS.toFixed(1), signups: as.totals.signups, d6: as.totals.d6 },
                    adset_status: as.adset_status || 'UNKNOWN',
                    campaign_status: as.campaign_status || 'UNKNOWN',
                    budget_level: as.budget_level || 'unknown',
                    budget_type: as.budget_type || 'unknown',
                    budget_owner_name: as.budget_entity_name || '',
                    budget_current_daily_budget: as.budget_current_daily_budget || null,
                    note: smallAds + ' ads all below \u20b95K spend — insufficient data'
                };
                hasContent = true;
                continue;
            }
            if (significantAds.length) {
                campData.adsets[ak] = {
                    id: as.id,
                    totals: { spend: Math.round(as.totals.spend), d6ROAS: +as.totals.d6ROAS.toFixed(1), signups: as.totals.signups, d6: as.totals.d6 },
                    adset_status: as.adset_status || 'UNKNOWN',
                    campaign_status: as.campaign_status || 'UNKNOWN',
                    budget_level: as.budget_level || 'unknown',
                    budget_type: as.budget_type || 'unknown',
                    budget_owner_name: as.budget_entity_name || '',
                    budget_current_daily_budget: as.budget_current_daily_budget || null,
                    ads: significantAds.map(function(ad) {
                        return {
                            id: ad.ad_id, name: ad.ad_name, spend: Math.round(ad.spend),
                            installs: ad.installs, signups: ad.signups, d0_trial: ad.d0_trial, d6: ad.d6,
                            cpi: ad.cpi ? Math.round(ad.cpi) : null,
                            signup_cost: ad.signupCost ? Math.round(ad.signupCost) : null,
                            d0_trial_cost: ad.d0TrialCost ? Math.round(ad.d0TrialCost) : null,
                            d6_cac: ad.d6CAC ? Math.round(ad.d6CAC) : null,
                            d6_roas: +ad.d6ROAS.toFixed(1),
                            alert: ad.alertStatus,
                            is_matured: ad.isMatured, days_live: ad.daysSinceGoLive,
                            go_live: ad.goLiveDate,
                            ad_status: ad.ad_status,
                            adset_status: ad.adset_status,
                            campaign_status: ad.campaign_status,
                            delivery_state: ad.delivery_state,
                            budget_level: ad.budget_level,
                            budget_type: ad.budget_type,
                            budget_owner_name: ad.budget_entity_name,
                            budget_current_daily_budget: ad.budget_current_daily_budget,
                            d6_label: ad.d6Label
                        };
                    }),
                    small_ads_skipped: smallAds > 0 ? smallAds + ' ads below \u20b95K spend omitted' : undefined
                };
                hasContent = true;
            }
        }
        if (hasContent) compact[ck] = campData;
    }
    console.log('[Optimizer] Compact tree: included ads with >\u20b95K spend, skipped ' + skippedCount + ' small ads');
    return compact;
}

async function generateOptimizationPlan(scanData) {
    var compactTree = buildCompactTree(scanData.tree);

    // Pre-compute rules-based actions to feed AI
    var rulesActions = [];
    var ads = scanData.ads || [];
    var benchmarks = buildOptimizerBenchmarks(ads);

    // Sort by spend desc for priority
    var sorted = ads.slice().sort(function(a, b) { return b.spend - a.spend; });

    sorted.forEach(function(ad) {
        var issues = [];
        var positives = [];
        var wowAd = (window.allData || []).find(function(a) { return a.ad_id === ad.ad_id; });
        var wow = wowAd ? wowAd._wow : null;
        var priorBestD6ROAS = 0;
        var hadStrongHistory;
        var belowMedianROAS;
        var worseThanMedianCosts;
        if (wow && wow.lastWeek) priorBestD6ROAS = Math.max(priorBestD6ROAS, wow.lastWeek.d6ROAS || 0);
        if (wow && wow.prevWeek) priorBestD6ROAS = Math.max(priorBestD6ROAS, wow.prevWeek.d6ROAS || 0);
        if (wow && wow.maturedD6ROAS != null) priorBestD6ROAS = Math.max(priorBestD6ROAS, wow.maturedD6ROAS || 0);
        hadStrongHistory = priorBestD6ROAS > 28;
        belowMedianROAS = benchmarks.median_d6_roas > 0 && ad.d6ROAS > 0 && ad.d6ROAS < benchmarks.median_d6_roas;
        worseThanMedianCosts =
            (benchmarks.median_signup_cost > 0 && ad.signupCost > benchmarks.median_signup_cost) ||
            (benchmarks.median_d0_trial_cost > 0 && ad.d0TrialCost > benchmarks.median_d0_trial_cost) ||
            (benchmarks.median_cpi > 0 && ad.cpi > benchmarks.median_cpi);
        var maturityNote = ad.isMatured ? 'MATURED (' + ad.daysSinceGoLive + 'd)' : 'NOT MATURED (' + (ad.daysSinceGoLive !== null ? ad.daysSinceGoLive + 'd' : 'unknown age') + ') — D6 metrics unreliable';

        // For non-matured ads, only flag early funnel issues
        if (!ad.isMatured && ad.spend >= 15000) {
            issues.push('[' + maturityNote + '] — judge on CPI/signup/D0 only, not D6');
            if (ad.signupCost > 1000) issues.push('Signup cost ' + fmtINR(ad.signupCost) + ' > \u20b91000');
            if (ad.d0TrialCost > 3500) issues.push('D0 trial cost ' + fmtINR(ad.d0TrialCost) + ' > \u20b93500');
            if (ad.cpi > 200) issues.push('CPI ' + fmtINR(ad.cpi) + ' > \u20b9200');
            if (ad.installs > 0 && ad.signups === 0 && ad.spend > 10000) issues.push(ad.installs + ' installs but zero signups');
            if (worseThanMedianCosts) issues.push('Early costs are worse than current Meta account medians');
            // Early positive signals
            if (ad.signupCost < 500 && ad.signups > 5) positives.push('Good early signal: signup cost ' + fmtINR(ad.signupCost));
            if (ad.cpi < 100) positives.push('Strong CPI ' + fmtINR(ad.cpi));
            if (!worseThanMedianCosts && ad.signupCost > 0 && benchmarks.median_signup_cost > 0 && ad.signupCost < benchmarks.median_signup_cost) positives.push('Early signup cost beats Meta account median');
        }

        // MATURED ads: use full D6 metrics
        if (ad.isMatured && ad.spend >= 15000) {
            issues.push('[' + maturityNote + '] — D6 metrics are reliable');
            if (ad.d6ROAS <= 0 && ad.signups === 0) issues.push('KILL: ' + fmtINR(ad.spend) + ' spent, zero signups, zero D6 ROAS');
            else if (ad.d6ROAS < 5 && ad.spend >= 20000) issues.push('DROP: D6 ROAS ' + fmtPct(ad.d6ROAS) + ' with ' + fmtINR(ad.spend) + ' spent');
            else if (ad.d6ROAS < 15) issues.push('POOR D6 ROAS: ' + fmtPct(ad.d6ROAS) + ' (threshold: 28%)');

            if (ad.signupCost > 1000) issues.push('Signup cost ' + fmtINR(ad.signupCost) + ' > \u20b91000');
            if (ad.d0TrialCost > 3500) issues.push('D0 trial cost ' + fmtINR(ad.d0TrialCost) + ' > \u20b93500');
            if (ad.d6CAC > 15000) issues.push('D6 CAC ' + fmtINR(ad.d6CAC) + ' > \u20b915K');
            if (ad.cpi > 200) issues.push('CPI ' + fmtINR(ad.cpi) + ' > \u20b9200');
            if (ad.installs > 0 && ad.signups === 0 && ad.spend > 10000) issues.push(ad.installs + ' installs but zero signups');
            if (belowMedianROAS) issues.push('Current D6 ROAS is below Meta optimizer median (' + fmtPct(benchmarks.median_d6_roas) + ')');
            if (worseThanMedianCosts) issues.push('Current costs are worse than Meta optimizer medians');
        }

        // GREEN: scale candidates (only matured or very strong early signals)
        if (ad.spend >= 15000) {
            if (ad.isMatured && ad.d6ROAS > 50) positives.push('EXCEPTIONAL D6 ROAS: ' + fmtPct(ad.d6ROAS) + ' (matured) \u2014 scale aggressively');
            else if (ad.isMatured && ad.d6ROAS > 28) positives.push('STRONG D6 ROAS: ' + fmtPct(ad.d6ROAS) + ' (matured) \u2014 scale candidate');
            if (ad.signupCost < 500 && ad.signups > 10) positives.push('Low signup cost ' + fmtINR(ad.signupCost));
            if (ad.isMatured && ad.d6CAC < 12000 && ad.d6 > 0) positives.push('D6 CAC ' + fmtINR(ad.d6CAC) + ' excellent (matured)');
            if (benchmarks.median_d6_roas > 0 && ad.d6ROAS > benchmarks.median_d6_roas) positives.push('D6 ROAS beats Meta optimizer median');
        }

        // REACTIVATE: paused ads/adsets with good historical performance
        if (ad.is_effectively_paused && ad.spend >= 10000) {
            if (ad.isMatured && ad.d6ROAS > 28) {
                positives.push('REACTIVATE: Paused but D6 ROAS was ' + fmtPct(ad.d6ROAS) + ' (>28%) — strong performer was turned off');
                issues.push('[PAUSED] Ad is not running despite good D6 ROAS');
            } else if (ad.isMatured && ad.d6ROAS > 15 && ad.signupCost < 800) {
                positives.push('REACTIVATE CANDIDATE: Paused but had decent metrics — D6 ROAS ' + fmtPct(ad.d6ROAS) + ', SU Cost ' + fmtINR(ad.signupCost));
            } else if (!ad.isMatured && ad.signupCost > 0 && ad.signupCost < 500 && ad.signups > 5) {
                positives.push('REACTIVATE CANDIDATE: Paused before maturity — early signals were good (SU Cost ' + fmtINR(ad.signupCost) + ', ' + ad.signups + ' signups)');
            }
        }

        // WATCH: low spend creatives
        if (ad.spend > 0 && ad.spend < 15000) {
            if (ad.signups === 0 && ad.spend > 5000) issues.push('WATCH: ' + fmtINR(ad.spend) + ' spent, no signups yet');
            if (ad.cpi > 150 && ad.spend > 3000) issues.push('EARLY WARNING: CPI ' + fmtINR(ad.cpi) + ' trending high');
        }

        // Funnel drop-off analysis
        if (ad.installs > 50 && ad.signups > 0) {
            var signupRate = ad.signups / ad.installs;
            if (signupRate < 0.05) issues.push('Funnel leak: only ' + (signupRate * 100).toFixed(1) + '% install-to-signup rate');
        }
        if (ad.signups > 10 && ad.d0_trial === 0) issues.push('Funnel blocked: ' + ad.signups + ' signups but zero D0 trials');
        if (ad.isMatured && ad.d0_trial > 5 && ad.d6 === 0 && ad.spend > 15000) issues.push('D0\u2192D6 conversion dead: ' + ad.d0_trial + ' trials, zero D6 (matured ad)');

        // WoW trend analysis (from window.allData)
        if (wow && wow.trendDirection === 'declining') {
            issues.push('WoW DECLINING: signup cost \u2191' + (wow.signupCost_wow || 0).toFixed(0) + '%, D0 trial cost \u2191' + (wow.d0TrialCost_wow || 0).toFixed(0) + '% — D6 will likely deteriorate');
        }
        if (wow && wow.trendDirection === 'improving') {
            positives.push('WoW IMPROVING: costs trending down — performance recovering');
        }
        if (wow && wow.continuousDecline) issues.push('Continuous WoW decline in costs/output is a major red signal');
        if (wow && wow.continuousIncrease) positives.push('Continuous WoW improvement in costs/output is a major green signal');
        if (wow && wow.signups_wow != null && wow.signups_wow < -20) issues.push('Signups down ' + Math.abs(wow.signups_wow).toFixed(0) + '% WoW');
        if (wow && wow.d6Revenue_wow != null && wow.d6Revenue_wow < -25) issues.push('D6 revenue down ' + Math.abs(wow.d6Revenue_wow).toFixed(0) + '% WoW');
        if (wow && wow.signups_wow != null && wow.signups_wow > 15) positives.push('Signups up ' + wow.signups_wow.toFixed(0) + '% WoW');
        if (wow && wow.d6Revenue_wow != null && wow.d6Revenue_wow > 20) positives.push('D6 revenue up ' + wow.d6Revenue_wow.toFixed(0) + '% WoW');
        if (wow && wow.maturedD6ROAS != null && ad.isMatured) {
            if (wow.maturedD6ROAS < 15) issues.push('Matured D6 ROAS (excl this week): ' + wow.maturedD6ROAS.toFixed(1) + '% — very poor');
        }

        if (hadStrongHistory && wow && wow.continuousDecline) positives.push('Historically strong performer; recent drop should not trigger an immediate hard cut');

        if (issues.length > 0 || positives.length > 0) {
            var suggestedAction =
                ad.is_effectively_paused && ad.isMatured && ad.d6ROAS > 28 ? getActivationActionForAd(ad) :
                ad.is_effectively_paused && !ad.isMatured && ad.signupCost > 0 && ad.signupCost < 500 ? getActivationActionForAd(ad) :
                ad.isMatured && wow && wow.continuousDecline && hadStrongHistory ? 'REVIEW' :
                ad.isMatured && wow && wow.continuousDecline && ad.d6ROAS < 15 ? 'REVIEW' :
                ad.isMatured && issues.length >= 3 && ad.spend >= 15000 && !hadStrongHistory ? 'PAUSE' :
                !ad.isMatured && issues.length >= 3 ? 'EARLY_WARNING' :
                wow && wow.continuousIncrease && positives.length > 0 && ad.isMatured ? 'SCALE' :
                wow && wow.continuousIncrease && positives.length > 0 ? 'REVIEW' :
                (positives.length > 0 && ad.isMatured && ad.d6ROAS > 28 ? 'SCALE' : 'REVIEW');
            rulesActions.push({
                name: ad.ad_name, id: ad.ad_id, campaign: ad.campaign_name, adset: ad.adset_name,
                spend: Math.round(ad.spend), d6_roas: +ad.d6ROAS.toFixed(1), signups: ad.signups, d6: ad.d6,
                impressions: ad.impressions, clicks: ad.clicks, installs: ad.installs,
                cpi: ad.cpi ? Math.round(ad.cpi) : null,
                ctr_pct: ad.ctr != null ? +ad.ctr.toFixed(2) : null,
                signup_cost: ad.signupCost ? Math.round(ad.signupCost) : null,
                d0_trial_cost: ad.d0TrialCost ? Math.round(ad.d0TrialCost) : null,
                d6_cac: ad.d6CAC ? Math.round(ad.d6CAC) : null,
                ad_status: ad.ad_status,
                adset_status: ad.adset_status,
                campaign_status: ad.campaign_status,
                delivery_state: ad.delivery_state,
                budget_level: ad.budget_level,
                budget_type: ad.budget_type,
                budget_owner_name: ad.budget_entity_name,
                budget_current_daily_budget: ad.budget_current_daily_budget,
                alert: ad.alertStatus,
                is_matured: ad.isMatured, days_live: ad.daysSinceGoLive, go_live: ad.goLiveDate,
                trend: wow ? wow.trendDirection : 'unknown',
                trend_strength: wow && wow.continuousDecline ? 'continuous_decline' : (wow && wow.continuousIncrease ? 'continuous_increase' : 'single_window'),
                prior_best_d6_roas: priorBestD6ROAS ? +priorBestD6ROAS.toFixed(1) : null,
                benchmark_context: {
                    scope: benchmarks.scope,
                    median_d6_roas: benchmarks.median_d6_roas ? +benchmarks.median_d6_roas.toFixed(1) : 0,
                    median_signup_cost: benchmarks.median_signup_cost ? Math.round(benchmarks.median_signup_cost) : 0,
                    median_d0_trial_cost: benchmarks.median_d0_trial_cost ? Math.round(benchmarks.median_d0_trial_cost) : 0,
                    median_cpi: benchmarks.median_cpi ? Math.round(benchmarks.median_cpi) : 0
                },
                issues: issues, positives: positives,
                suggested: suggestedAction
            });
        }
    });

    // ── ADSET-LEVEL ANALYSIS ──
    var adsetActions = [];
    for (var ck in scanData.tree) {
        for (var ak in scanData.tree[ck].adsets) {
            var as = scanData.tree[ck].adsets[ak];
            var redAds = as.ads.filter(function(a) { return a.alertStatus === 'red'; });
            var greenAds = as.ads.filter(function(a) { return a.alertStatus === 'green'; });
            var decliningAds = as.ads.filter(function(a) {
                var w = (window.allData || []).find(function(x) { return x.ad_id === a.ad_id; });
                return w && w._wow && w._wow.trendDirection === 'declining';
            });
            var continuousDecliners = as.ads.filter(function(a) {
                var w = (window.allData || []).find(function(x) { return x.ad_id === a.ad_id; });
                return w && w._wow && w._wow.continuousDecline;
            });
            var strongHistoryDecliners = as.ads.filter(function(a) {
                var w = (window.allData || []).find(function(x) { return x.ad_id === a.ad_id; });
                var priorBest = 0;
                if (w && w._wow && w._wow.lastWeek) priorBest = Math.max(priorBest, w._wow.lastWeek.d6ROAS || 0);
                if (w && w._wow && w._wow.prevWeek) priorBest = Math.max(priorBest, w._wow.prevWeek.d6ROAS || 0);
                if (w && w._wow && w._wow.maturedD6ROAS != null) priorBest = Math.max(priorBest, w._wow.maturedD6ROAS || 0);
                return w && w._wow && w._wow.continuousDecline && priorBest > 28;
            });
            var totalAds = as.ads.length;
            var spend = as.totals.spend;
            var d6ROAS = as.totals.d6ROAS;

            if (redAds.length > 0 && redAds.length === totalAds) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'PAUSE_ADSET', reason: 'All ' + totalAds + ' ads are red alerts', spend: spend });
            } else if (redAds.length > totalAds * 0.7) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'PAUSE_ADSET', reason: redAds.length + '/' + totalAds + ' ads are red — adset mostly failing', spend: spend });
            }
            if (decliningAds.length > totalAds * 0.5 && spend > 15000) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'WATCH_ADSET', reason: decliningAds.length + '/' + totalAds + ' ads declining WoW — adset trending down, D6 will worsen', spend: spend });
            }
            if (continuousDecliners.length > 0 && strongHistoryDecliners.length > 0 && spend > 30000) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'WATCH_ADSET', reason: strongHistoryDecliners.length + ' historically strong ad(s) are now in continuous WoW decline - refresh creatives before hard cuts', spend: spend });
            }
            if (greenAds.length > 0 && d6ROAS > 28 && spend > 30000) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'SCALE_ADSET', reason: 'Adset D6 ROAS ' + d6ROAS.toFixed(1) + '% with ' + fmtINR(spend) + ' — scale budget', spend: spend });
            }
            if (d6ROAS < 15 && spend > 50000) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'CUT_ADSET_BUDGET', reason: strongHistoryDecliners.length > 0 ? 'Adset has strong-history assets but recent decline - trim budget carefully, not aggressively' : 'Adset D6 ROAS only ' + d6ROAS.toFixed(1) + '% with ' + fmtINR(spend) + ' spent - reduce budget', spend: spend });
            }
            // REACTIVATE paused adsets with good historical performance
            var pausedGoodAds = as.ads.filter(function(a) { return a.is_effectively_paused && a.d6ROAS > 20 && a.spend >= 10000; });
            if (pausedGoodAds.length > 0) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: getActivationActionForAds(pausedGoodAds),
                    reason: pausedGoodAds.length + ' paused ad(s) with D6 ROAS >' + 20 + '% — ' + pausedGoodAds.map(function(a) { return a.ad_name + ' (' + a.d6ROAS.toFixed(1) + '%)'; }).join(', '),
                    spend: spend, ads: pausedGoodAds.map(function(a) { return { name: a.ad_name, id: a.ad_id, d6ROAS: a.d6ROAS, spend: a.spend }; }) });
            }
            // Budget optimization within adset: shift from worst to best ads
            if (as.ads.length >= 3 && spend > 30000) {
                var sortedByROAS = as.ads.filter(function(a) { return a.spend > 5000 && a.d6ROAS > 0; }).sort(function(a, b) { return b.d6ROAS - a.d6ROAS; });
                if (sortedByROAS.length >= 2) {
                    var best = sortedByROAS[0];
                    var worst = sortedByROAS[sortedByROAS.length - 1];
                    if (best.d6ROAS > worst.d6ROAS * 2) {
                        adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'INTRA_ADSET_SHIFT',
                            reason: 'Best ad ' + best.ad_name + ' (' + best.d6ROAS.toFixed(1) + '%) vs worst ' + worst.ad_name + ' (' + worst.d6ROAS.toFixed(1) + '%) — shift budget within adset',
                            spend: spend });
                    }
                }
            }
        }
    }

    // ── CAMPAIGN-LEVEL ANALYSIS ──
    var campaignActions = [];
    for (var ck2 in scanData.tree) {
        var camp = scanData.tree[ck2];
        var campTotals = camp.totals;
        var campAdsets = Object.keys(camp.adsets);
        var campRedAdsets = campAdsets.filter(function(ak) {
            return camp.adsets[ak].ads.every(function(a) { return a.alertStatus === 'red'; });
        });

        if (campRedAdsets.length === campAdsets.length && campAdsets.length > 0) {
            campaignActions.push({ level: 'campaign', campaign: ck2, action: 'PAUSE_CAMPAIGN', reason: 'All ' + campAdsets.length + ' adsets are red — campaign is fully underperforming', spend: campTotals.spend });
        }
        if (campTotals.d6ROAS > 28 && campTotals.spend > 100000) {
            campaignActions.push({ level: 'campaign', campaign: ck2, action: 'SCALE_CAMPAIGN', reason: 'Campaign D6 ROAS ' + campTotals.d6ROAS.toFixed(1) + '% with ' + fmtINR(campTotals.spend) + ' — increase campaign budget', spend: campTotals.spend });
        }
        if (campTotals.d6ROAS < 15 && campTotals.spend > 100000) {
            campaignActions.push({ level: 'campaign', campaign: ck2, action: 'CUT_CAMPAIGN_BUDGET', reason: 'Campaign D6 ROAS only ' + campTotals.d6ROAS.toFixed(1) + '% with ' + fmtINR(campTotals.spend) + ' — reduce campaign budget significantly', spend: campTotals.spend });
        }
    }

    var systemPrompt = 'You are a senior Meta Ads optimization specialist for Univest, an Indian fintech app (Research Advisory + Broking).\n\n' +
        'Generate a COMPREHENSIVE optimization plan covering EVERY ad, adset, and campaign. Be specific and actionable.\n\n' +
        'UNIVEST FUNNEL: Ad Impression \u2192 Install (CPI) \u2192 Signup (Signup Cost) \u2192 D0 Trial (Trial Cost) \u2192 D0 Payment \u2192 D6 Payment (D6 CAC, D6 ROAS) \u2192 Overall Revenue\n\n' +
        'PERFORMANCE THRESHOLDS:\n' +
        '- D6 ROAS: >50% exceptional (scale aggressively), >28% good (scale cautiously), 15-28% average (watch), <15% poor (pause), <5% with >20K spend (kill)\n' +
        '- D6 CAC: <\u20b912K excellent, <\u20b915K ok, >\u20b915K red\n' +
        '- Signup Cost: <\u20b9500 excellent, <\u20b91000 ok, >\u20b91000 red\n' +
        '- D0 Trial Cost: <\u20b92500 good, >\u20b93500 red\n' +
        '- CPI: <\u20b9100 great, <\u20b9150 ok, >\u20b9200 concerning\n' +
        '- Install\u2192Signup rate: >15% good, <5% funnel leak\n' +
        '- Ads with <\u20b915K spend = insufficient data for pause decision, but flag if early signals are bad\n\n' +
        'OPTIMIZATION CATEGORIES (generate actions for ALL):\n' +
        '1. PAUSE_AD \u2014 underperforming ads with >\u20b915K spend and sustained weakness, especially without prior strong history\n' +
        '2. KILL_AD \u2014 zero signups or zero D6 with >\u20b920K spend. Immediate action.\n' +
        '3. UPDATE_OWNER_BUDGET \u2014 top performers with D6 ROAS >28% and positive multi-week trend. Budget changes must happen only at the true Meta budget owner level.\n' +
        '4. ACTIVATE_AD \u2014 directly paused ads that had GOOD historical performance (D6 ROAS >20%, or good early signals before maturity). Only use this when campaign and adset are already live.\n' +
        '5. ACTIVATE_ADSET / ACTIVATE_CAMPAIGN \u2014 if an ad is off because its parent adset/campaign is paused, reactivate the paused parent instead of the child ad.\n' +
        '6. PAUSE_ADSET \u2014 all ads in adset are red\n' +
        '7. UPDATE_CAMPAIGN_BUDGET / UPDATE_ADSET_BUDGET \u2014 use only the owner budget reported in the data. Ads never have their own budget.\n' +
        '8. CREATIVE_RECOMMENDATION \u2014 suggest new creative concepts based on what\'s working/failing\n' +
        '9. AUDIENCE_SHIFT \u2014 non-executable planning note only. Do not present this as an automated ad-level budget move.\n' +
        '10. FUNNEL_FIX \u2014 ads with high installs but low signups = landing page or targeting issue\n' +
        '11. EARLY_WARNING \u2014 low-spend ads showing bad early signals (high CPI, zero signups after \u20b95K)\n' +
        '12. BUDGET_REALLOCATION \u2014 non-executable planning note only. Never imply that budget can be moved directly at ad level.\n' +
        '13. MONITOR \u2014 use when no safe executable action exists because budget owner is lifetime/unknown or status context is incomplete.\n\n' +
        'MATURITY RULES (CRITICAL):\n' +
        '- Each ad has is_matured (true/false) and days_live fields\n' +
        '- MATURED (is_matured=true, >=29 days live): D6 ROAS and D6 CAC are reliable for this decision model. Use these for pause/scale decisions.\n' +
        '- NOT MATURED (is_matured=false, <29 days live): D6 data is still less reliable. Bias toward early-funnel checks, trend monitoring, creative refresh, or light budget changes instead of hard pause decisions.\n' +
        '  For non-matured ads, ONLY use CPI, signup cost, and D0 trial cost for decisions.\n' +
        '  NEVER pause a non-matured ad based on low D6 ROAS — it hasn\'t had enough time.\n' +
        '  Flag non-matured ads with bad early signals as EARLY_WARNING, not PAUSE.\n' +
        '- Always mention maturity status in your diagnosis.\n\n' +
        'RULES:\n' +
        '- Week-over-week trend direction is a major signal. Continuous decline across multiple weeks is a stronger red flag than a single bad week.\n' +
        '- Continuous improvement across multiple weeks is a stronger green signal than a single strong week.\n' +
        '- If an ad or adset had strong performance in prior weeks but has only recently dropped, prefer creative refresh, watch, or light budget cuts before hard pause decisions.\n' +
        '- If performance has recently improved after weak history, prefer controlled budget increases instead of instant aggressive scaling.\n' +
        '- Use Meta optimizer account medians as decision references for this view. Do not use Google benchmarks here.\n' +
        '- Campaign Tree and Optimizer do not need identical benchmarks: Campaign Tree can stay diagnostic, while Optimizer should use account medians plus WoW behavior for actioning.\n' +
        '- STATUS HIERARCHY: if a campaign is PAUSED/OFF, treat all of its child adsets and ads as effectively off by default.\n' +
        '- STATUS HIERARCHY: if an adset is PAUSED/OFF, treat all of its child ads as effectively off by default.\n' +
        '- Never recommend reactivating a child entity without accounting for the parent entity that is currently off.\n' +
        '- STATUS VALUES can include ACTIVE, PAUSED, ADSET_PAUSED, CAMPAIGN_PAUSED, PENDING_REVIEW, or IN_PROCESS. Only ACTIVE is live.\n' +
        '- ADS NEVER HAVE THEIR OWN BUDGET. If budget_level is campaign, only emit UPDATE_CAMPAIGN_BUDGET. If budget_level is adset, only emit UPDATE_ADSET_BUDGET.\n' +
        '- If budget_type is lifetime or unknown, do not emit an executable budget update. Use MONITOR instead.\n' +
        '- Generate AT LEAST one action for every ad with >\u20b915K spend\n' +
        '- Group by priority: P1 (immediate action today), P2 (this week), P3 (monitor)\n' +
        '- Cite EXACT numbers from the data (spend, ROAS, CAC, signup cost)\n' +
        '- Compare each ad against the Meta optimizer median benchmark for this account\n' +
        '- For budget changes: recommend specific \u20b9 amounts with rationale\n' +
        '- Include creative insights: what type of creative (video/static) is winning\n' +
        '- Flag any funnel bottlenecks (high installs but low signups = targeting mismatch)\n' +
        '- All spend values include 1.18x GST\n' +
        '- ctr_pct is already in percentage (e.g. 0.92 means 0.92% CTR, NOT 92%). Do NOT multiply by 100.\n' +
        '- d6_roas is already in percentage (e.g. 14.2 means 14.2% ROAS)\n' +
        '- ad_status, adset_status, campaign_status, budget_level, budget_type, budget_owner_name, and budget_current_daily_budget are authoritative. Follow them exactly.';

    var portfolioMedian = {
        d6_roas: benchmarks.median_d6_roas || 0,
        cpi: benchmarks.median_cpi || 0,
        signup_cost: benchmarks.median_signup_cost || 0,
        d0_trial_cost: benchmarks.median_d0_trial_cost || 0,
        d6_cac: benchmarks.median_d6_cac || 0
    };

    var userPrompt = 'Generate COMPREHENSIVE optimization plan for Univest Meta ad account.\n\n' +
        'PERIOD: ' + scanData.date_range.since + ' to ' + scanData.date_range.until + '\n' +
        'SUMMARY: ' + scanData.summary.total_campaigns + ' campaigns, ' + scanData.summary.total_adsets + ' adsets, ' + scanData.summary.total_ads + ' ads\n' +
        'TOTAL SPEND: \u20b9' + Math.round(scanData.summary.total_spend) + ' | RED: ' + scanData.summary.red_ads + ' | GREEN: ' + scanData.summary.green_ads + '\n' +
        'META OPTIMIZER BENCHMARKS (ads >\u20b915K): D6 ROAS ' + (portfolioMedian.d6_roas || 0).toFixed(1) + '%, CPI \u20b9' + Math.round(portfolioMedian.cpi || 0) + ', Signup Cost \u20b9' + Math.round(portfolioMedian.signup_cost || 0) + ', D0 Trial Cost \u20b9' + Math.round(portfolioMedian.d0_trial_cost || 0) + ', D6 CAC \u20b9' + Math.round(portfolioMedian.d6_cac || 0) + '\n' +
        'BENCHMARK POLICY: Use Meta optimizer medians only for this plan. Google portal medians are separate and must not be mixed into Meta decisions.\n' +
        'WOW POLICY: Multi-week decline/increase in output is a major decision signal. If historical performance was strong and the recent drop is new, bias toward light cuts, watch, or creative refresh before pause.\n\n' +
        'RULES-ENGINE PRE-ANALYSIS — 3 LEVELS:\n\n' +
        '1. CAMPAIGN-LEVEL FLAGS:\n' + JSON.stringify(campaignActions) + '\n\n' +
        '2. ADSET-LEVEL FLAGS:\n' + JSON.stringify(adsetActions) + '\n\n' +
        '3. AD-LEVEL FLAGS (top 40 by spend):\n' + JSON.stringify(rulesActions.slice(0, 40)) + '\n\n' +
        'Return JSON with this structure:\n' +
        '{\n' +
        '  "executive_summary": "2-3 sentence summary of the optimization opportunity",\n' +
        '  "plan_summary": { "total_actions":0, "ads_to_pause":0, "ads_to_kill":0, "ads_to_scale":0, "adsets_to_pause":0, "budget_increases":0, "budget_decreases":0, "estimated_spend_saved_daily":"\u20b9X", "estimated_roas_improvement":"X%", "top_priority_action":"" },\n' +
        '  "actions": [{\n' +
        '    "action_id": "ACT-001",\n' +
        '    "priority": "P1|P2|P3",\n' +
        '    "category": "PAUSE|KILL|SCALE|BUDGET_SHIFT|FUNNEL_FIX|EARLY_WARNING|CREATIVE_REC",\n' +
        '    "action_type": "PAUSE_AD|ACTIVATE_AD|ACTIVATE_ADSET|PAUSE_ADSET|ACTIVATE_CAMPAIGN|PAUSE_CAMPAIGN|UPDATE_ADSET_BUDGET|UPDATE_CAMPAIGN_BUDGET|MONITOR|CREATIVE_CHANGE",\n' +
        '    "entity_type": "ad|adset|campaign",\n' +
        '    "entity_id": "Meta ID",\n' +
        '    "entity_name": "name",\n' +
        '    "campaign_name": "",\n' +
        '    "adset_name": "",\n' +
        '    "current_metrics": { "spend":0, "d6_roas":"", "d6_cac":"", "signup_cost":"", "cpi":"", "installs":0, "signups":0, "d6":0, "alert_status":"", "ad_status":"", "adset_status":"", "campaign_status":"", "delivery_state":"", "budget_level":"", "budget_type":"", "budget_owner":"", "budget_current_daily_budget":0 },\n' +
        '    "diagnosis": "What is wrong or right with this ad — specific numbers vs thresholds vs Meta optimizer median and WoW trend context",\n' +
        '    "action_detail": "Exact action to take with specific numbers",\n' +
        '    "expected_impact": "Estimated daily spend saved or ROAS improvement",\n' +
        '    "confidence": "HIGH|MEDIUM|LOW",\n' +
        '    "budget_change": { "current_daily_budget":0, "recommended_daily_budget":0, "change_pct":"" }\n' +
        '  }],\n' +
        '  "budget_reallocation": {\n' +
        '    "total_daily_budget_shift": "\u20b9X from underperformers to top performers",\n' +
        '    "from": [{"name":"", "current_budget":"", "reduce_to":"", "reason":""}],\n' +
        '    "to": [{"name":"", "current_budget":"", "increase_to":"", "reason":""}]\n' +
        '  },\n' +
        '  "creative_insights": {\n' +
        '    "winning_format": "Video or Static and why",\n' +
        '    "top_themes": ["theme1", "theme2"],\n' +
        '    "failing_themes": ["theme1"],\n' +
        '    "new_creative_suggestions": ["suggestion1", "suggestion2"]\n' +
        '  },\n' +
        '  "funnel_analysis": {\n' +
        '    "bottleneck": "Where in the funnel is the biggest drop-off",\n' +
        '    "fix_recommendations": ["rec1", "rec2"]\n' +
        '  },\n' +
        '  "do_not_touch": [{ "entity_name":"", "entity_id":"", "reason":"" }],\n' +
        '  "watch_list": [{ "entity_name":"", "priority":"P2|P3", "watch_reason":"", "trigger_for_action":"When to act" }]\n' +
        '}\n\nGenerate 15-25 actions covering all categories. Include REACTIVATE actions for paused ads with good history. Sort by priority. Cite exact numbers. Keep diagnosis/action_detail concise (1-2 sentences each). Return valid JSON only.';

    var response = await fetch('/api/ai/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system: systemPrompt, prompt: userPrompt, max_tokens: 16000 }),
        signal: AbortSignal.timeout(300000)
    });
    var result = await response.json();
    if (!result.success) throw new Error(result.error || 'AI call failed');
    var clean = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    // Repair truncated JSON — close any open arrays/objects
    var plan;
    try {
        plan = JSON.parse(clean);
    } catch (e) {
        console.warn('[Optimizer] JSON truncated, attempting repair...');
        var repaired = clean;
        // Remove trailing incomplete key-value pairs
        repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*$/, '');
        repaired = repaired.replace(/,\s*\{[^}]*$/, '');
        repaired = repaired.replace(/,\s*"[^"]*$/, '');
        // Count and close open brackets
        var opens = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
        var openBraces = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
        for (var bi = 0; bi < opens; bi++) repaired += ']';
        for (var bj = 0; bj < openBraces; bj++) repaired += '}';
        plan = JSON.parse(repaired);
    }
    plan = enrichPlanWithScanContext(plan, scanData);
    plan = normalizeOptimizationPlan(plan, scanData);
    window.OPTIMIZER_PLAN = plan;
    return plan;
}

// ── Execution ──

async function executeAction(action) {
    var endpoint, payload;

    if (action.action_type === 'PAUSE_AD') {
        endpoint = '/api/meta-write/ad/' + action.entity_id + '/status';
        payload = { status: 'PAUSED' };
    } else if (action.action_type === 'ACTIVATE_AD') {
        endpoint = '/api/meta-write/ad/' + action.entity_id + '/status';
        payload = { status: 'ACTIVE' };
    } else if (action.action_type === 'ACTIVATE_ADSET') {
        endpoint = '/api/meta-write/adset/' + action.entity_id + '/status';
        payload = { status: 'ACTIVE' };
    } else if (action.action_type === 'PAUSE_ADSET') {
        endpoint = '/api/meta-write/adset/' + action.entity_id + '/status';
        payload = { status: 'PAUSED' };
    } else if (action.action_type === 'UPDATE_ADSET_BUDGET' && action.budget_change) {
        endpoint = '/api/meta-write/adset/' + action.entity_id + '/budget';
        payload = { daily_budget_cents: Math.round(action.budget_change.recommended_daily_budget * 100) };
    } else if (action.action_type === 'ACTIVATE_CAMPAIGN') {
        endpoint = '/api/meta-write/campaign/' + action.entity_id + '/status';
        payload = { status: 'ACTIVE' };
    } else if (action.action_type === 'PAUSE_CAMPAIGN') {
        endpoint = '/api/meta-write/campaign/' + action.entity_id + '/status';
        payload = { status: 'PAUSED' };
    } else if (action.action_type === 'UPDATE_CAMPAIGN_BUDGET' && action.budget_change) {
        endpoint = '/api/meta-write/campaign/' + action.entity_id + '/budget';
        payload = { daily_budget_cents: Math.round(action.budget_change.recommended_daily_budget * 100) };
    } else {
        return { success: false, error: 'Unknown action type' };
    }

    var res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000)
    }).then(function(r) { return r.json(); });

    window.OPTIMIZER_LOG.push({
        timestamp: new Date().toISOString(), action_id: action.action_id,
        action_type: action.action_type, entity_id: action.entity_id,
        entity_name: action.entity_name, success: res.success || false, error: res.error || null
    });
    saveLog();
    return res;
}

async function executeAllActions(actions) {
    var batch = actions.filter(function(a) { return isExecutableActionType(a.action_type); }).map(function(a) {
        return {
            action_id: a.action_id, action_type: a.action_type, entity_type: a.entity_type,
            entity_id: a.entity_id,
            new_status: a.action_type.indexOf('PAUSE') !== -1 ? 'PAUSED' : ((a.action_type === 'ACTIVATE_AD' || a.action_type === 'ACTIVATE_ADSET' || a.action_type === 'ACTIVATE_CAMPAIGN') ? 'ACTIVE' : null),
            new_daily_budget: a.budget_change ? a.budget_change.recommended_daily_budget : null
        };
    });

    var res = await fetch('/api/meta-write/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: batch }),
        signal: AbortSignal.timeout(300000)
    }).then(function(r) { return r.json(); });

    (res.results || []).forEach(function(r) {
        var orig = actions.find(function(a) { return a.action_id === r.action_id; });
        window.OPTIMIZER_LOG.push({
            timestamp: new Date().toISOString(), action_id: r.action_id,
            action_type: orig ? orig.action_type : '', entity_id: r.entity_id,
            entity_name: orig ? orig.entity_name : '', success: r.success, error: r.error || null
        });
    });
    saveLog();
    return res;
}

function saveLog() { try { localStorage.setItem('optimizer_log', JSON.stringify((window.OPTIMIZER_LOG || []).slice(-200))); } catch (e) {} }
function loadLog() { try { return JSON.parse(localStorage.getItem('optimizer_log') || '[]'); } catch (e) { return []; } }

// ══════════════════════════════════════════════════════════════════
// UI RENDERING
// ══════════════════════════════════════════════════════════════════

window.renderOptimizer = function() {
    var container = document.getElementById('optimizerContent');
    if (!container) return;
    var stage = window.OPTIMIZER_STAGE || 'scan';
    if (stage === 'plan' && window.OPTIMIZER_PLAN) renderPlanStage(container);
    else if (stage === 'execute') renderExecuteStage(container);
    else renderScanStage(container);
};

// ── SCAN STAGE ──

function renderScanStage(container) {
    var scan = window.OPTIMIZER_SCAN;
    var dr = scan && scan.date_range ? scan.date_range : getDefaultDates();

    var html = '<div class="ci-panel">' +
        '<h2>\u26a1 Campaign Optimizer</h2>' +
        '<p style="color:var(--text-dim);font-size:13px;margin-bottom:20px;">Scan all campaigns \u2192 AI generates optimization plan \u2192 one-click execute</p>' +

        '<div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap;">' +
            '<label style="font-size:12px;color:var(--text-dim);">Date Range:</label>' +
            '<input type="date" id="optDateFrom" value="' + dr.since + '" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px;">' +
            '<span style="color:var(--text-dim);">to</span>' +
            '<input type="date" id="optDateTo" value="' + dr.until + '" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px;">' +
        '</div>';

    if (!scan) {
        html += '<div style="' + CS + '">' +
            '<h3 style="font-size:15px;font-weight:600;margin-bottom:8px;">Step 1: Scan Account</h3>' +
            '<p style="font-size:13px;color:var(--text-dim);margin-bottom:16px;">Pulls all campaigns, adsets, and ads from Meta API. Enriches with Metabase funnel data (signups, D0 trials, D6 conversions, revenue). Same data pipeline as Campaign Tree.</p>' +
            '<button id="optScanBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 28px;">\ud83d\udd0d Scan Full Account</button>' +
            '<div id="optScanProgress" style="display:none;margin-top:16px;font-size:13px;color:var(--text-dim);"></div>' +
        '</div>';
    } else {
        var rangeContext = scan.rangeContext || getOptimizerRangeContext(scan.date_range || dr);
        var rangeColor = rangeContext.inSyncWithTree === false ? 'var(--orange)' : 'var(--green)';
        html += '<div style="' + CS + 'border-left:4px solid ' + rangeColor + ';margin-bottom:16px;">' +
            '<div style="font-size:13px;font-weight:700;color:' + rangeColor + ';margin-bottom:6px;">' + esc(rangeContext.label) + '</div>' +
            '<div style="font-size:12px;color:var(--text-dim);line-height:1.5;">' + esc(rangeContext.detail) + '</div>' +
        '</div>';
        html += renderAccountHealth(scan);
    }

    html += '</div>' + renderLogSection();
    container.innerHTML = html;
    publishOptimizerContext(scan);
    bindScanEvents(container);
}

// ── ACCOUNT HEALTH DASHBOARD (after scan, before plan) ──

function renderAccountHealth(scan) {
    var s = scan.summary;
    var ads = scan.ads || [];
    var tree = scan.tree || {};

    // Compute aggregate funnel metrics via shared pipeline
    var totals = scan.evaluatedTotals || deriveMetrics(sumRaw(ads));
    var blendedD6ROAS = totals.d6ROAS;
    var avgCPI = totals.cpi || 0;
    var avgSignupCost = totals.signupCost || 0;
    var avgD6CAC = totals.d6CAC || 0;
    var maturityCardNote = buildMaturityNote(s, 'matured_ads', 'non_matured_ads', 'ad');

    // Health score: 0-100 based on key metrics
    var healthScore = 0;
    var healthFactors = [];
    if (blendedD6ROAS > 50) { healthScore += 30; healthFactors.push('Excellent D6 ROAS'); }
    else if (blendedD6ROAS > 28) { healthScore += 22; healthFactors.push('Good D6 ROAS'); }
    else if (blendedD6ROAS > 15) { healthScore += 12; healthFactors.push('Average D6 ROAS'); }
    else { healthScore += 5; healthFactors.push('Poor D6 ROAS'); }
    if (avgCPI < 100) { healthScore += 20; } else if (avgCPI < 150) { healthScore += 12; } else { healthScore += 5; }
    if (avgSignupCost > 0 && avgSignupCost < 500) { healthScore += 20; } else if (avgSignupCost > 0 && avgSignupCost < 1000) { healthScore += 12; } else if (avgSignupCost > 0) { healthScore += 5; } else { healthScore += 10; }
    var greenPct = s.total_ads > 0 ? s.green_ads / s.total_ads : 0;
    var redPct = s.total_ads > 0 ? s.red_ads / s.total_ads : 0;
    healthScore += Math.round(greenPct * 20);
    healthScore += Math.round((1 - redPct) * 10);
    healthScore = Math.min(100, Math.max(0, healthScore));
    var healthColor = healthScore >= 70 ? 'var(--green)' : healthScore >= 45 ? 'var(--orange)' : 'var(--red)';
    var healthLabel = healthScore >= 70 ? 'Good' : healthScore >= 45 ? 'Needs Work' : 'Critical';

    var html = '';

    // ── Health Score + Key KPIs row ──
    html += '<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;align-items:stretch;">' +
        // Health Score circle
        '<div style="' + CARD + 'min-width:140px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;">' +
            '<div style="width:80px;height:80px;border-radius:50%;border:4px solid ' + healthColor + ';display:flex;align-items:center;justify-content:center;flex-direction:column;">' +
                '<div style="font-size:28px;font-weight:800;color:' + healthColor + ';">' + healthScore + '</div>' +
            '</div>' +
            '<div style="font-size:11px;font-weight:700;color:' + healthColor + ';margin-top:4px;">' + healthLabel + '</div>' +
            '<div style="font-size:9px;color:var(--text-dim);">Account Health</div>' +
            '<div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div>' +
        '</div>' +
        // KPI cards
        '<div style="flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;">';
    var kpis = [
        { v: fmtINR(totals.spend), l: 'Total Spend', c: 'var(--text)' },
        { v: fmtPct(blendedD6ROAS), l: 'Blended D6 ROAS', c: blendedD6ROAS > 28 ? 'var(--green)' : blendedD6ROAS > 15 ? 'var(--orange)' : 'var(--red)' },
        { v: fmtINR(avgCPI), l: 'Avg CPI', c: avgCPI < 100 ? 'var(--green)' : avgCPI < 150 ? 'var(--orange)' : 'var(--red)' },
        { v: fmtINR(avgSignupCost), l: 'Avg Signup Cost', c: avgSignupCost < 500 ? 'var(--green)' : avgSignupCost < 1000 ? 'var(--orange)' : 'var(--red)' },
        { v: fmtINR(avgD6CAC), l: 'Avg D6 CAC', c: avgD6CAC < 12000 ? 'var(--green)' : avgD6CAC < 15000 ? 'var(--orange)' : 'var(--red)' },
        { v: String(totals.installs), l: 'Installs', c: 'var(--text)' },
        { v: String(totals.signups), l: 'Signups', c: 'var(--text)' },
        { v: String(totals.d6Con || totals.d6 || 0), l: 'D6 Conversions', c: 'var(--accent)' },
        { v: s.total_campaigns, l: 'Campaigns', c: 'var(--text)' },
        { v: s.total_adsets, l: 'Adsets', c: 'var(--text)' },
        { v: s.total_ads, l: 'Total Ads', c: 'var(--text)' },
        { v: '<span style="color:var(--red);">' + s.red_ads + '</span> / <span style="color:var(--green);">' + s.green_ads + '</span>', l: 'Red / Green', c: '' },
        { v: (s.matured_ads || 0) + ' / ' + (s.non_matured_ads || 0), l: 'Matured / New', c: 'var(--text)' },
    ];
    kpis.forEach(function(k) {
        html += '<div style="' + CARD + 'text-align:center;padding:10px 6px;">' +
            '<div style="font-size:17px;font-weight:700;color:' + k.c + ';">' + k.v + '</div>' +
            '<div style="font-size:9px;color:var(--text-dim);margin-top:4px;">' + k.l + '</div>' +
            '<div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>';
    });
    html += '</div></div>';

    html += '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:16px;">&#128202;</span>' +
        '<div><div style="font-size:12px;font-weight:600;color:var(--accent);">Overview metrics are maturity-aware</div>' +
        '<div style="font-size:11px;color:var(--text-dim);">' + s.matured_ads + ' ads are using mature data excluding the last 7 days where available. ' + s.non_matured_ads + ' early ads still use full data until they mature.</div></div>' +
    '</div>';

    // ── Funnel Visualization ──
    var funnel = [
        { label: 'Impressions', val: totals.impressions },
        { label: 'Clicks', val: totals.clicks },
        { label: 'Installs', val: totals.installs },
        { label: 'Signups', val: totals.signups },
        { label: 'D0 Trials', val: totals.d0_trial },
        { label: 'D0 Paid', val: totals.d0 },
        { label: 'D6 Paid', val: totals.d6Con || totals.d6 || 0 },
    ];
    var maxFunnel = Math.max(1, funnel[0].val);
    html += '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:14px;">\ud83d\udd0d Funnel Analysis</h3>' +
        '<div style="display:flex;flex-direction:column;gap:6px;">';
    for (var fi = 0; fi < funnel.length; fi++) {
        var f = funnel[fi];
        var pct = maxFunnel > 0 ? (f.val / maxFunnel) * 100 : 0;
        var convRate = fi > 0 && funnel[fi - 1].val > 0 ? (f.val / funnel[fi - 1].val * 100) : null;
        var barColor = fi < 3 ? 'var(--accent)' : fi < 5 ? 'var(--orange)' : 'var(--green)';
        var dropWarning = convRate !== null && convRate < 10 && fi >= 2 ? ' \u26a0' : '';
        html += '<div style="display:flex;align-items:center;gap:10px;">' +
            '<div style="min-width:80px;font-size:11px;color:var(--text-dim);text-align:right;">' + f.label + '</div>' +
            '<div style="flex:1;background:var(--bg-card);border-radius:4px;height:22px;position:relative;overflow:hidden;">' +
                '<div style="height:100%;width:' + Math.max(1, pct) + '%;background:' + barColor + ';border-radius:4px;transition:width 0.5s;opacity:0.7;"></div>' +
                '<span style="position:absolute;left:8px;top:3px;font-size:10px;font-weight:600;color:#fff;">' + f.val.toLocaleString() + '</span>' +
            '</div>' +
            '<div style="min-width:55px;font-size:10px;color:' + (dropWarning ? 'var(--red)' : 'var(--text-dim)') + ';">' + (convRate !== null ? convRate.toFixed(1) + '%' + dropWarning : '') + '</div>' +
        '</div>';
    }
    html += '</div>' +
        '<div style="font-size:10px;color:var(--text-dim);margin-top:8px;text-align:right;">Conversion rates shown between each step. \u26a0 = drop-off below 10%</div>' +
    '</div>';

    // ── Campaign Performance Table ──
    var campList = [];
    for (var ck in tree) {
        var c = tree[ck];
        var t = c.totals || {};
        var adsetCount = Object.keys(c.adsets || {}).length;
        var adCount = 0; var reds = 0; var greens = 0;
        for (var ak in c.adsets) {
            var as = c.adsets[ak];
            adCount += as.ads.length;
            as.ads.forEach(function(a) { if (a.alertStatus === 'red') reds++; if (a.alertStatus === 'green') greens++; });
        }
        campList.push({
            name: ck, id: c.id, adsets: adsetCount, ads: adCount,
            spend: t.spend || 0, installs: t.installs || 0, signups: t.signups || 0,
            d6: t.d6Con || t.d6 || 0, d6ROAS: t.d6ROAS || 0, cpi: t.cpi, signupCost: t.signupCost, d6CAC: t.d6CAC,
            reds: reds, greens: greens, spendPct: totals.spend > 0 ? t.spend / totals.spend * 100 : 0
        });
    }
    campList.sort(function(a, b) { return b.spend - a.spend; });

    html += '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:14px;">\ud83d\udcca Campaign Performance</h3>' +
        '<div style="overflow-x:auto;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
        '<thead><tr style="border-bottom:2px solid var(--border);">' +
            '<th style="text-align:left;padding:8px 6px;color:var(--text-dim);font-weight:600;">Campaign</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">Spend</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">% Budget</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">Installs</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">Signups</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">D6</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">D6 ROAS</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">CPI</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">SU Cost</th>' +
            '<th style="text-align:center;padding:8px 6px;color:var(--text-dim);">\ud83d\udfe2/\ud83d\udd34</th>' +
        '</tr></thead><tbody>';
    campList.forEach(function(c) {
        var roasColor = c.d6ROAS > 28 ? 'var(--green)' : c.d6ROAS > 15 ? 'var(--orange)' : 'var(--red)';
        html += '<tr style="border-bottom:1px solid var(--border);">' +
            '<td style="padding:8px 6px;font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(c.name) + '">' + esc(c.name.length > 35 ? c.name.substring(0, 35) + '...' : c.name) + ' <span style="color:var(--text-dim);font-weight:400;font-size:10px;">(' + c.adsets + ' adsets, ' + c.ads + ' ads)</span></td>' +
            '<td style="text-align:right;padding:8px 6px;font-weight:600;">' + fmtINR(c.spend) + '</td>' +
            '<td style="text-align:right;padding:8px 6px;"><div style="display:flex;align-items:center;justify-content:flex-end;gap:4px;"><div style="width:40px;height:6px;background:var(--bg-card);border-radius:3px;overflow:hidden;"><div style="height:100%;width:' + Math.min(100, c.spendPct) + '%;background:var(--accent);border-radius:3px;"></div></div><span>' + c.spendPct.toFixed(0) + '%</span></div></td>' +
            '<td style="text-align:right;padding:8px 6px;">' + c.installs + '</td>' +
            '<td style="text-align:right;padding:8px 6px;">' + c.signups + '</td>' +
            '<td style="text-align:right;padding:8px 6px;">' + c.d6 + '</td>' +
            '<td style="text-align:right;padding:8px 6px;color:' + roasColor + ';font-weight:600;">' + fmtPct(c.d6ROAS) + '</td>' +
            '<td style="text-align:right;padding:8px 6px;">' + (c.cpi ? fmtINR(c.cpi) : '--') + '</td>' +
            '<td style="text-align:right;padding:8px 6px;">' + (c.signupCost ? fmtINR(c.signupCost) : '--') + '</td>' +
            '<td style="text-align:center;padding:8px 6px;"><span style="color:var(--green);">' + c.greens + '</span>/<span style="color:var(--red);">' + c.reds + '</span></td>' +
        '</tr>';
    });
    html += '</tbody></table></div></div>';

    // ── Top 5 / Bottom 5 Performers ──
    var significantAds = ads.filter(function(a) { return a.spend >= 15000; });
    if (significantAds.length >= 4) {
        // Only rank matured ads by D6 ROAS — non-matured D6 is unreliable
        var maturedAds = significantAds.filter(function(a) { return a.isMatured; });
        var nonMaturedAds = significantAds.filter(function(a) { return !a.isMatured; });
        var byROAS = (maturedAds.length >= 4 ? maturedAds : significantAds).slice().sort(function(a, b) { return b.d6ROAS - a.d6ROAS; });
        var top5 = byROAS.slice(0, 5);
        var bottom5 = byROAS.slice(-5).reverse();

        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">';

        // Top performers
        var maturedLabel = maturedAds.length >= 4 ? ' (Matured Only)' : (nonMaturedAds.length ? ' (Includes Early Full Data)' : '');
        html += '<div style="' + CS + 'border-top:3px solid var(--green);">' +
            '<h3 style="font-size:13px;font-weight:600;color:var(--green);margin-bottom:12px;">\ud83c\udfc6 Top Performers — D6 ROAS' + maturedLabel + '</h3>';
        top5.forEach(function(a, i) {
            var matBadge = a.isMatured ? '<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(34,197,94,0.15);color:var(--green);margin-left:4px;">' + a.daysSinceGoLive + 'd</span>' :
                '<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(245,158,11,0.15);color:var(--orange);margin-left:4px;">' + (a.daysSinceGoLive || '?') + 'd \u2731</span>';
            html += '<div style="' + CARD + 'margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(a.ad_name) + '">' + (i+1) + '. ' + esc(a.ad_name.length > 30 ? a.ad_name.substring(0,30) + '...' : a.ad_name) + matBadge + '</div>' +
                    '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;">Spend: ' + fmtINR(a.spend) + ' | SU: ' + a.signups + ' | D6: ' + (a.evalD6 != null ? a.evalD6 : a.d6) + '</div>' +
                    '<div style="font-size:9px;color:var(--accent);margin-top:2px;">' + esc(a.evalDataLabel) + '</div>' +
                '</div>' +
                '<div style="text-align:right;min-width:60px;">' +
                    '<div style="font-size:14px;font-weight:700;color:var(--green);">' + fmtPct(a.d6ROAS) + '</div>' +
                    '<div style="font-size:9px;color:var(--text-dim);">D6 ROAS</div>' +
                '</div>' +
            '</div>';
        });
        html += '</div>';

        // Bottom performers
        html += '<div style="' + CS + 'border-top:3px solid var(--red);">' +
            '<h3 style="font-size:13px;font-weight:600;color:var(--red);margin-bottom:12px;">\u26a0\ufe0f Underperformers — D6 ROAS' + maturedLabel + '</h3>';
        bottom5.forEach(function(a, i) {
            var matBadge2 = a.isMatured ? '<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(239,68,68,0.15);color:var(--red);margin-left:4px;">' + a.daysSinceGoLive + 'd</span>' :
                '<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(245,158,11,0.15);color:var(--orange);margin-left:4px;">' + (a.daysSinceGoLive || '?') + 'd \u2731</span>';
            html += '<div style="' + CARD + 'margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(a.ad_name) + '">' + (i+1) + '. ' + esc(a.ad_name.length > 30 ? a.ad_name.substring(0,30) + '...' : a.ad_name) + matBadge2 + '</div>' +
                    '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;">Spend: ' + fmtINR(a.spend) + ' | SU: ' + a.signups + ' | D6: ' + (a.evalD6 != null ? a.evalD6 : a.d6) + '</div>' +
                    '<div style="font-size:9px;color:var(--accent);margin-top:2px;">' + esc(a.evalDataLabel) + '</div>' +
                '</div>' +
                '<div style="text-align:right;min-width:60px;">' +
                    '<div style="font-size:14px;font-weight:700;color:var(--red);">' + fmtPct(a.d6ROAS) + '</div>' +
                    '<div style="font-size:9px;color:var(--text-dim);">D6 ROAS</div>' +
                '</div>' +
            '</div>';
        });
        html += '</div></div>';
    }

    // ── Budget Distribution Bar ──
    if (campList.length > 1) {
        var barColors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
        html += '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:14px;">\ud83d\udcb0 Budget Distribution</h3>' +
            '<div style="display:flex;height:24px;border-radius:6px;overflow:hidden;margin-bottom:10px;">';
        campList.forEach(function(c, i) {
            if (c.spendPct < 1) return;
            html += '<div style="width:' + c.spendPct + '%;background:' + barColors[i % barColors.length] + ';min-width:2px;" title="' + esc(c.name) + ': ' + c.spendPct.toFixed(1) + '%"></div>';
        });
        html += '</div><div style="display:flex;flex-wrap:wrap;gap:8px;">';
        campList.forEach(function(c, i) {
            if (c.spendPct < 1) return;
            html += '<div style="display:flex;align-items:center;gap:4px;font-size:10px;">' +
                '<div style="width:8px;height:8px;border-radius:2px;background:' + barColors[i % barColors.length] + ';"></div>' +
                '<span style="color:var(--text-dim);" title="' + esc(c.name) + '">' + esc(c.name.length > 20 ? c.name.substring(0,20) + '...' : c.name) + ' (' + c.spendPct.toFixed(0) + '%)</span></div>';
        });
        html += '</div></div>';
    }

    // ── Action buttons ──
    html += '<div style="display:flex;gap:10px;margin-bottom:16px;align-items:center;">' +
        '<button id="optPlanBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 28px;">\ud83e\udd16 Generate Optimization Plan</button>' +
        '<button id="optRescanBtn" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:13px;">\u21bb Rescan</button>' +
        '<span style="font-size:11px;color:var(--text-dim);">Last scan: ' + new Date(scan.scan_date).toLocaleString() + ' | Match rate: ' + s.matched_keys + '/' + (s.matched_keys + s.unmatched_keys) + '</span>' +
    '</div>' +
    '<div id="optPlanProgress" style="display:none;"></div>';

    return html;
}

// ── PLAN STAGE ──

function renderPlanStage(container) {
    var plan = window.OPTIMIZER_PLAN;
    if (!plan) { window.OPTIMIZER_STAGE = 'scan'; renderScanStage(container); return; }

    var scan = window.OPTIMIZER_SCAN || null;
    var scanSummary = scan ? scan.summary : null;
    var maturityCardNote = buildMaturityNote(scanSummary, 'matured_ads', 'non_matured_ads', 'ad');
    var ps = plan.plan_summary || {};
    var actions = plan.actions || [];
    var actionable = actions.filter(function(a) { return isExecutableActionType(a.action_type); });
    var currentFilter = window.OPTIMIZER_PLAN_FILTER || 'all';
    var currentScope = window.OPTIMIZER_PLAN_SCOPE || 'all';

    var html = '<div class="ci-panel">' +
        '<h2>\u26a1 Optimization Plan</h2>' +

        // Executive summary
        (plan.executive_summary ? '<div style="' + CS + 'border-left:4px solid var(--accent);"><p style="font-size:14px;color:var(--text);line-height:1.7;">' + esc(plan.executive_summary) + '</p></div>' : '') +

        // Summary KPIs
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-bottom:20px;">' +
            (ps.ads_to_pause ? '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--red);"><div style="font-size:22px;font-weight:700;color:var(--red);">' + ps.ads_to_pause + '</div><div style="font-size:10px;color:var(--text-dim);">Ads to Pause</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' : '') +
            (ps.ads_to_kill ? '<div style="' + CARD + 'text-align:center;border-top:3px solid #dc2626;"><div style="font-size:22px;font-weight:700;color:#dc2626;">' + ps.ads_to_kill + '</div><div style="font-size:10px;color:var(--text-dim);">Ads to Kill</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' : '') +
            (ps.ads_to_scale ? '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--green);"><div style="font-size:22px;font-weight:700;color:var(--green);">' + ps.ads_to_scale + '</div><div style="font-size:10px;color:var(--text-dim);">Ads to Scale</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' : '') +
            (ps.budget_increases ? '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--green);"><div style="font-size:22px;font-weight:700;color:var(--green);">' + ps.budget_increases + '</div><div style="font-size:10px;color:var(--text-dim);">Budget \u2191</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' : '') +
            (ps.budget_decreases ? '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--orange);"><div style="font-size:22px;font-weight:700;color:var(--orange);">' + ps.budget_decreases + '</div><div style="font-size:10px;color:var(--text-dim);">Budget \u2193</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' : '') +
            '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--accent);"><div style="font-size:22px;font-weight:700;color:var(--accent);">' + actions.length + '</div><div style="font-size:10px;color:var(--text-dim);">Total Actions</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' +
        '</div>' +

        (scanSummary ? '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);display:flex;align-items:center;gap:10px;">' +
            '<span style="font-size:16px;">&#128202;</span>' +
            '<div><div style="font-size:12px;font-weight:600;color:var(--accent);">Using Mature Data Where Available</div>' +
            '<div style="font-size:11px;color:var(--text-dim);">' + scanSummary.matured_ads + ' mature ads are evaluated on data excluding the last 7 days where available. ' + scanSummary.non_matured_ads + ' early ads still use full data until they mature.</div></div>' +
        '</div>' : '') +

        '<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;">' +
            (ps.estimated_spend_saved_daily ? '<div style="' + CARD + 'flex:1;min-width:200px;"><div style="font-size:11px;color:var(--text-dim);">Est. Daily Spend Saved</div><div style="font-size:16px;font-weight:700;color:var(--green);margin-top:4px;">' + esc(ps.estimated_spend_saved_daily) + '</div></div>' : '') +
            (ps.estimated_roas_improvement ? '<div style="' + CARD + 'flex:1;min-width:200px;"><div style="font-size:11px;color:var(--text-dim);">Est. ROAS Improvement</div><div style="font-size:16px;font-weight:700;color:var(--accent);margin-top:4px;">' + esc(ps.estimated_roas_improvement) + '</div></div>' : '') +
            (ps.top_priority_action ? '<div style="' + CARD + 'flex:2;min-width:200px;"><div style="font-size:11px;color:var(--text-dim);">Top Priority</div><div style="font-size:14px;font-weight:600;color:var(--text);margin-top:4px;">' + esc(ps.top_priority_action) + '</div></div>' : '') +
        '</div>' +

        // Creative Insights
        (plan.creative_insights ? '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">\ud83c\udfa8 Creative Insights</h3>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;">' +
                (plan.creative_insights.winning_format ? '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Winning Format</div><div style="font-size:13px;color:var(--green);margin-top:4px;">' + esc(plan.creative_insights.winning_format) + '</div></div>' : '') +
                (plan.creative_insights.top_themes ? '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Top Themes</div><div style="font-size:13px;color:var(--text);margin-top:4px;">' + plan.creative_insights.top_themes.map(function(t){ return esc(t); }).join(', ') + '</div></div>' : '') +
                (plan.creative_insights.failing_themes ? '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Failing Themes</div><div style="font-size:13px;color:var(--red);margin-top:4px;">' + plan.creative_insights.failing_themes.map(function(t){ return esc(t); }).join(', ') + '</div></div>' : '') +
            '</div>' +
            (plan.creative_insights.new_creative_suggestions ? '<div style="margin-top:10px;"><div style="font-size:10px;color:var(--text-dim);margin-bottom:6px;">New Creative Suggestions</div>' + plan.creative_insights.new_creative_suggestions.map(function(s) { return '<div style="font-size:12px;color:var(--accent);padding:4px 0;">\u2022 ' + esc(s) + '</div>'; }).join('') + '</div>' : '') +
        '</div>' : '') +

        // Funnel Analysis
        (plan.funnel_analysis ? '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">\ud83d\udd0d Funnel Analysis</h3>' +
            (plan.funnel_analysis.bottleneck ? '<div style="' + CARD + 'margin-bottom:8px;border-left:3px solid var(--orange);"><div style="font-size:12px;color:var(--orange);font-weight:600;">Bottleneck</div><div style="font-size:13px;color:var(--text);margin-top:4px;">' + esc(plan.funnel_analysis.bottleneck) + '</div></div>' : '') +
            (plan.funnel_analysis.fix_recommendations ? plan.funnel_analysis.fix_recommendations.map(function(r) { return '<div style="font-size:12px;color:var(--text-dim);padding:4px 0;">\u2022 ' + esc(r) + '</div>'; }).join('') : '') +
        '</div>' : '') +

        // Budget Reallocation
        (plan.budget_reallocation ? '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">\ud83d\udcb0 Budget Reallocation</h3>' +
            (plan.budget_reallocation.total_daily_budget_shift ? '<p style="font-size:13px;color:var(--accent);margin-bottom:12px;">' + esc(plan.budget_reallocation.total_daily_budget_shift) + '</p>' : '') +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
                '<div><div style="font-size:11px;color:var(--red);font-weight:600;margin-bottom:8px;">Reduce Budget From:</div>' + ((plan.budget_reallocation.from || []).map(function(f) { return '<div style="' + CARD + 'margin-bottom:6px;font-size:12px;"><strong>' + esc(f.name).slice(0,35) + '</strong><br>' + esc(f.current_budget) + ' \u2192 ' + esc(f.reduce_to) + '<br><span style="color:var(--text-dim);">' + esc(f.reason) + '</span></div>'; }).join('') || '<div style="color:var(--text-dim);font-size:12px;">None</div>') + '</div>' +
                '<div><div style="font-size:11px;color:var(--green);font-weight:600;margin-bottom:8px;">Increase Budget To:</div>' + ((plan.budget_reallocation.to || []).map(function(t) { return '<div style="' + CARD + 'margin-bottom:6px;font-size:12px;"><strong>' + esc(t.name).slice(0,35) + '</strong><br>' + esc(t.current_budget) + ' \u2192 ' + esc(t.increase_to) + '<br><span style="color:var(--text-dim);">' + esc(t.reason) + '</span></div>'; }).join('') || '<div style="color:var(--text-dim);font-size:12px;">None</div>') + '</div>' +
            '</div>' +
        '</div>' : '') +

        // Action buttons
        '<div style="display:flex;gap:10px;margin-bottom:20px;">' +
            '<button id="optExecAllBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 28px;background:var(--green);">\u2705 Execute All (' + actionable.length + ' executable actions)</button>' +
            '<button id="optBackToScan" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:13px;">\u2190 Back to Scan</button>' +
        '</div>';

    // Filter tabs
    var p1Count = actions.filter(function(a) { return a.priority === 'P1' || a.priority === 1; }).length;
    var pauseCount = actions.filter(function(a) { return a.action_type.indexOf('PAUSE') !== -1 || a.action_type.indexOf('KILL') !== -1; }).length;
    var budgetCount = actions.filter(function(a) { return a.action_type.indexOf('BUDGET') !== -1 || a.action_type.indexOf('SCALE') !== -1; }).length;
    var creativeCount = actions.filter(function(a) { return (a.category || '').indexOf('CREATIVE') !== -1 || (a.category || '').indexOf('FUNNEL') !== -1; }).length;
    var campaignActionCount = actions.filter(function(a) { return String(a.entity_type || '').toLowerCase() === 'campaign'; }).length;
    var adsetActionCount = actions.filter(function(a) { return String(a.entity_type || '').toLowerCase() === 'adset'; }).length;
    var adActionCount = actions.filter(function(a) { return String(a.entity_type || '').toLowerCase() === 'ad'; }).length;
    var tabStyle = 'padding:4px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:11px;';
    html += '<div id="optFilterTabs" style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;">' +
        '<button class="opt-filter' + (currentFilter === 'all' ? ' active' : '') + '" data-filter="all" style="' + tabStyle + (currentFilter === 'all' ? 'border-color:var(--accent);background:rgba(99,102,241,0.15);color:var(--accent);' : '') + '">All (' + actions.length + ')</button>' +
        '<button class="opt-filter' + (currentFilter === 'p1' ? ' active' : '') + '" data-filter="p1" style="' + tabStyle + (currentFilter === 'p1' ? 'border-color:var(--accent);background:rgba(99,102,241,0.15);color:var(--accent);' : '') + '">P1 Urgent (' + p1Count + ')</button>' +
        '<button class="opt-filter' + (currentFilter === 'pause' ? ' active' : '') + '" data-filter="pause" style="' + tabStyle + (currentFilter === 'pause' ? 'border-color:var(--accent);background:rgba(99,102,241,0.15);color:var(--accent);' : '') + '">Pause/Kill (' + pauseCount + ')</button>' +
        '<button class="opt-filter' + (currentFilter === 'budget' ? ' active' : '') + '" data-filter="budget" style="' + tabStyle + (currentFilter === 'budget' ? 'border-color:var(--accent);background:rgba(99,102,241,0.15);color:var(--accent);' : '') + '">Budget (' + budgetCount + ')</button>' +
        (creativeCount ? '<button class="opt-filter' + (currentFilter === 'creative' ? ' active' : '') + '" data-filter="creative" style="' + tabStyle + (currentFilter === 'creative' ? 'border-color:var(--accent);background:rgba(99,102,241,0.15);color:var(--accent);' : '') + '">Creative/Funnel (' + creativeCount + ')</button>' : '') +
    '</div>';
    html += '<div id="optScopeTabs" style="display:flex;gap:6px;margin:-8px 0 16px 0;flex-wrap:wrap;">' +
        '<span style="font-size:11px;color:var(--text-dim);align-self:center;margin-right:4px;">Recommendations:</span>' +
        '<button class="opt-scope' + (currentScope === 'all' ? ' active' : '') + '" data-scope="all" style="' + tabStyle + (currentScope === 'all' ? 'border-color:var(--green);background:rgba(16,185,129,0.12);color:var(--green);' : '') + '">All Levels (' + actions.length + ')</button>' +
        '<button class="opt-scope' + (currentScope === 'campaign' ? ' active' : '') + '" data-scope="campaign" style="' + tabStyle + (currentScope === 'campaign' ? 'border-color:var(--green);background:rgba(16,185,129,0.12);color:var(--green);' : '') + '">Campaign (' + campaignActionCount + ')</button>' +
        '<button class="opt-scope' + (currentScope === 'adset' ? ' active' : '') + '" data-scope="adset" style="' + tabStyle + (currentScope === 'adset' ? 'border-color:var(--green);background:rgba(16,185,129,0.12);color:var(--green);' : '') + '">Adset (' + adsetActionCount + ')</button>' +
        '<button class="opt-scope' + (currentScope === 'ad' ? ' active' : '') + '" data-scope="ad" style="' + tabStyle + (currentScope === 'ad' ? 'border-color:var(--green);background:rgba(16,185,129,0.12);color:var(--green);' : '') + '">Ad Wise (' + adActionCount + ')</button>' +
    '</div>';

    // Actions list
    html += '<div id="optActionsTable">' + renderActionsTable(actions, currentFilter, currentScope) + '</div>';

    // Watch list
    if (plan.watch_list && plan.watch_list.length) {
        html += '<div style="' + CS + 'margin-top:16px;">' +
            '<h3 style="font-size:14px;font-weight:600;color:var(--orange);margin-bottom:12px;">\ud83d\udc41 Watch List (' + plan.watch_list.length + ')</h3>';
        plan.watch_list.forEach(function(w) {
            html += '<div style="' + CARD + 'margin-bottom:8px;">' +
                '<div style="font-size:13px;font-weight:600;color:var(--text);">' + esc(w.entity_name) + '</div>' +
                '<p style="font-size:12px;color:var(--text-dim);margin-top:4px;">' + esc(w.watch_reason) + '</p>' +
                '<p style="font-size:11px;color:var(--orange);margin-top:4px;">Trigger: ' + esc(w.trigger_for_action) + '</p>' +
            '</div>';
        });
        html += '</div>';
    }

    // Do not touch
    if (plan.do_not_touch && plan.do_not_touch.length) {
        html += '<details style="' + CS + '">' +
            '<summary style="cursor:pointer;font-size:14px;font-weight:600;color:var(--text-dim);">Do Not Touch (' + plan.do_not_touch.length + ')</summary>' +
            '<div style="margin-top:12px;">';
        plan.do_not_touch.forEach(function(d) {
            html += '<p style="padding:4px 0;border-bottom:1px solid var(--border);font-size:12px;">' +
                '<span style="color:var(--text);">' + esc(d.entity_name) + '</span> \u2014 <span style="color:var(--text-dim);">' + esc(d.reason) + '</span></p>';
        });
        html += '</div></details>';
    }

    html += '</div>' + renderLogSection();
    container.innerHTML = html;
    bindPlanEvents(container);
}

function renderActionsTable(actions, filter, scope) {
    var list = actions;
    if (filter === 'pause') list = actions.filter(function(a) { return a.action_type.indexOf('PAUSE') !== -1 || a.action_type.indexOf('KILL') !== -1; });
    else if (filter === 'budget') list = actions.filter(function(a) { return a.action_type.indexOf('BUDGET') !== -1 || a.action_type.indexOf('SCALE') !== -1; });
    else if (filter === 'p1') list = actions.filter(function(a) { return a.priority === 'P1' || a.priority === 1; });
    else if (filter === 'creative') list = actions.filter(function(a) { return (a.category || '').indexOf('CREATIVE') !== -1 || (a.category || '').indexOf('FUNNEL') !== -1; });
    if (scope && scope !== 'all') list = list.filter(function(a) { return String(a.entity_type || '').toLowerCase() === scope; });

    if (!list.length) return '<p style="color:var(--text-dim);padding:20px;">No actions in this view.</p>';

    var priorityColors = { P1: 'var(--red)', P2: 'var(--orange)', P3: 'var(--text-dim)' };

    var html = '';
    list.forEach(function(a) {
        var m = a.current_metrics || {};
        var bc = a.budget_change;
        var pColor = priorityColors[a.priority] || 'var(--text-dim)';
        var catLabel = (a.category || a.action_type || '').replace(/_/g, ' ');
        var isExecutable = isExecutableActionType(a.action_type);
        var entityTypeLabel = String(a.entity_type || 'unknown').toUpperCase();
        var locationLabel = '';
        if (String(a.entity_type || '').toLowerCase() === 'ad') {
            locationLabel = '<div style="font-size:11px;color:var(--accent);margin-bottom:6px;">Ad Path: <strong style="color:var(--text);">' + esc(a.campaign_name || '--') + '</strong> \u203a <strong style="color:var(--text);">' + esc(a.adset_name || '--') + '</strong></div>';
        } else if (String(a.entity_type || '').toLowerCase() === 'adset') {
            locationLabel = '<div style="font-size:11px;color:var(--accent);margin-bottom:6px;">Campaign: <strong style="color:var(--text);">' + esc(a.campaign_name || '--') + '</strong></div>';
        } else if (String(a.entity_type || '').toLowerCase() === 'campaign') {
            locationLabel = '<div style="font-size:11px;color:var(--accent);margin-bottom:6px;">Campaign Level Recommendation</div>';
        }

        html += '<div style="' + CARD + 'margin-bottom:10px;border-left:4px solid ' + actionColor(a.action_type) + ';">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
                '<div style="flex:1;min-width:0;">' +
                    // Priority + Category + Confidence badges
                    '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">' +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;color:#fff;background:' + pColor + ';">' + esc(a.priority || '') + '</span>' +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;color:#fff;background:' + actionColor(a.action_type) + ';">' + esc(a.action_type.replace(/_/g, ' ')) + '</span>' +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:9px;font-weight:700;border:1px solid var(--border);color:var(--text-dim);">' + esc(entityTypeLabel) + '</span>' +
                        (a.category && a.category !== a.action_type ? '<span style="padding:2px 8px;border-radius:6px;font-size:9px;font-weight:600;border:1px solid var(--border);color:var(--text-dim);">' + esc(catLabel) + '</span>' : '') +
                        confidenceBadge(a.confidence) +
                        (a.data_mode ? '<span style="padding:2px 6px;border-radius:4px;font-size:9px;font-weight:600;border:1px solid rgba(99,102,241,0.35);color:var(--accent);">' + esc(a.data_mode === 'mature' ? 'Metrics: Mature Eval' : (a.data_mode === 'full_fallback' ? 'Metrics: Full Data Fallback' : 'Metrics: Early Full Data')) + '</span>' : '') +
                        '<span style="font-size:10px;color:var(--text-dim);">#' + esc(a.action_id) + '</span>' +
                    '</div>' +
                    // Entity name
                    '<div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px;" title="' + esc(a.entity_name) + '">' + esc(a.entity_name || '') + '</div>' +
                    '<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">' + esc(a.campaign_name || '') + (a.adset_name ? ' \u203a ' + esc(a.adset_name) : '') + '</div>' +
                    locationLabel +
                    '<div style="font-size:9px;color:#666;margin-bottom:8px;">Data: ' + esc(a.data_range || getSelectedDates().since + ' \u2192 ' + getSelectedDates().until) + (a.is_matured !== undefined ? ' | ' + (a.is_matured ? 'Matured' : a.days_live + 'd') : '') + (a.data_mode_label ? ' | ' + esc(a.data_mode_label) : '') + '</div>' +
                    // Metrics row
                    '<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-bottom:8px;">' +
                        (m.spend != null ? '<span style="' + CARD + 'padding:4px 8px;">Spend: <strong>' + fmtINR(typeof m.spend === 'string' ? parseFloat(m.spend) : m.spend) + '</strong></span>' : '') +
                        (m.d6_roas ? '<span style="' + CARD + 'padding:4px 8px;color:' + (parseFloat(m.d6_roas) > 28 ? 'var(--green)' : parseFloat(m.d6_roas) < 15 ? 'var(--red)' : 'var(--orange)') + ';">D6 ROAS: <strong>' + esc(typeof m.d6_roas === 'number' ? m.d6_roas.toFixed(1) + '%' : m.d6_roas) + '</strong></span>' : '') +
                        (m.d6_cac ? '<span style="' + CARD + 'padding:4px 8px;">D6 CAC: ' + esc(typeof m.d6_cac === 'number' ? fmtINR(m.d6_cac) : m.d6_cac) + '</span>' : '') +
                        (m.signup_cost ? '<span style="' + CARD + 'padding:4px 8px;">SU Cost: ' + esc(typeof m.signup_cost === 'number' ? fmtINR(m.signup_cost) : m.signup_cost) + '</span>' : '') +
                        (m.cpi ? '<span style="' + CARD + 'padding:4px 8px;">CPI: ' + esc(typeof m.cpi === 'number' ? fmtINR(m.cpi) : m.cpi) + '</span>' : '') +
                        (m.installs ? '<span style="' + CARD + 'padding:4px 8px;">Inst: ' + m.installs + '</span>' : '') +
                        (m.signups ? '<span style="' + CARD + 'padding:4px 8px;">SU: ' + m.signups + '</span>' : '') +
                    '</div>' +
                    // Diagnosis (always visible)
                    (a.diagnosis ? '<div style="font-size:12px;color:var(--text);line-height:1.6;margin-bottom:6px;padding:8px;background:rgba(0,0,0,0.2);border-radius:6px;">' + esc(a.diagnosis) + '</div>' : '') +
                    // Action detail
                    (a.action_detail ? '<div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:6px;">\u2192 ' + esc(a.action_detail) + '</div>' : '') +
                    // Budget change
                    (bc && bc.recommended_daily_budget ? '<div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:6px;display:flex;align-items:center;gap:6px;">' +
                        '<span>\u20b9' + (bc.current_daily_budget || '?') + '/day \u2192</span>' +
                        '<input type="number" class="opt-budget-input" data-action-id="' + esc(a.action_id) + '" value="' + bc.recommended_daily_budget + '" style="width:80px;padding:3px 6px;background:var(--bg);border:1px solid var(--accent);border-radius:4px;color:var(--accent);font-size:12px;font-weight:600;text-align:right;" onclick="event.stopPropagation()" />' +
                        '<span>/day</span>' +
                        (bc.change_pct ? '<span style="font-size:10px;color:var(--text-dim);">(' + esc(bc.change_pct) + ')</span>' : '') +
                    '</div>' : '') +
                    // Expected impact
                    (a.expected_impact ? '<div style="font-size:11px;color:var(--green);">\ud83d\udcca ' + esc(a.expected_impact) + '</div>' : '') +
                '</div>' +
                // Execute button (only for executable actions)
                (isExecutable ? '<button class="opt-run-single btn-ci-primary" data-action-id="' + esc(a.action_id) + '" style="font-size:11px;padding:6px 14px;white-space:nowrap;">Execute</button>' : '') +
            '</div>' +
        '</div>';
    });
    return html;
}

// ── EXECUTE STAGE ──

function renderExecuteStage(container) {
    var html = '<div class="ci-panel">' +
        '<h2>\u26a1 Execution Results</h2>' +
        '<div id="optExecResults"></div>' +
        '<div style="display:flex;gap:10px;margin-top:20px;">' +
            '<button id="optRescanAfterExec" class="btn-ci-primary">\u21bb Rescan Account</button>' +
        '</div></div>' + renderLogSection();
    container.innerHTML = html;
    document.getElementById('optRescanAfterExec').addEventListener('click', function() {
        window.OPTIMIZER_SCAN = null; window.OPTIMIZER_PLAN = null;
        window.OPTIMIZER_STAGE = 'scan'; renderOptimizer();
    });
}

// ── LOG ──

function renderLogSection() {
    var log = window.OPTIMIZER_LOG.length ? window.OPTIMIZER_LOG : loadLog();
    if (!log.length) return '';
    var html = '<div style="' + CS + 'margin-top:24px;">' +
        '<h3 style="font-size:14px;font-weight:600;color:var(--text-dim);margin-bottom:12px;">Execution Log</h3>' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
        '<thead><tr style="border-bottom:1px solid var(--border);">' +
            '<th style="text-align:left;padding:6px 8px;color:var(--text-dim);">Time</th>' +
            '<th style="text-align:left;padding:6px 8px;color:var(--text-dim);">Action</th>' +
            '<th style="text-align:left;padding:6px 8px;color:var(--text-dim);">Entity</th>' +
            '<th style="text-align:center;padding:6px 8px;color:var(--text-dim);">Result</th>' +
        '</tr></thead><tbody>';
    log.slice().reverse().slice(0, 30).forEach(function(e) {
        html += '<tr style="border-bottom:1px solid var(--border);">' +
            '<td style="padding:6px 8px;color:var(--text-dim);white-space:nowrap;">' + new Date(e.timestamp).toLocaleString() + '</td>' +
            '<td style="padding:6px 8px;">' + esc(e.action_type) + '</td>' +
            '<td style="padding:6px 8px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(e.entity_name) + '">' + esc(e.entity_name) + '</td>' +
            '<td style="text-align:center;padding:6px 8px;">' + (e.success ? '\u2705' : '<span title="' + esc(e.error) + '">\u274c</span>') + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
}

// ── CONFIRMATION MODAL ──

function showConfirmModal(actions, onConfirm) {
    var actionable = actions.filter(function(a) { return isExecutableActionType(a.action_type); });
    var pauses = actionable.filter(function(a) { return a.action_type.indexOf('PAUSE') !== -1; }).length;
    var budgets = actionable.filter(function(a) { return a.action_type === 'UPDATE_ADSET_BUDGET' || a.action_type === 'UPDATE_CAMPAIGN_BUDGET'; }).length;

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:32px;max-width:520px;width:90%;">' +
        '<h3 style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:16px;">\u26a0\ufe0f Confirm Execution</h3>' +
        '<p style="font-size:13px;color:var(--text);margin-bottom:12px;">You are about to make <strong>' + actionable.length + ' changes</strong> to your Meta ad account:</p>' +
        '<ul style="font-size:13px;color:var(--text-dim);margin-bottom:16px;padding-left:20px;">' +
            (pauses ? '<li>Pause ' + pauses + ' entities</li>' : '') +
            (budgets ? '<li>Change ' + budgets + ' budgets</li>' : '') +
        '</ul>' +
        '<p style="font-size:12px;color:var(--orange);margin-bottom:16px;">\u26a0 These changes take effect immediately in Meta Ads Manager and cannot be auto-reversed.</p>' +
        '<div style="margin-bottom:16px;">' +
            '<label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:6px;">Type <strong>EXECUTE</strong> to confirm:</label>' +
            '<input id="optConfirmInput" type="text" placeholder="EXECUTE" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;font-family:monospace;">' +
        '</div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
            '<button id="optConfirmCancel" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;">Cancel</button>' +
            '<button id="optConfirmExec" class="btn-ci-primary" style="background:var(--red);opacity:0.4;pointer-events:none;" disabled>Execute Plan \u2192</button>' +
        '</div></div>';

    document.body.appendChild(overlay);
    var input = document.getElementById('optConfirmInput');
    var execBtn = document.getElementById('optConfirmExec');
    input.addEventListener('input', function() {
        var ok = input.value.trim() === 'EXECUTE';
        execBtn.disabled = !ok;
        execBtn.style.opacity = ok ? '1' : '0.4';
        execBtn.style.pointerEvents = ok ? 'auto' : 'none';
    });
    document.getElementById('optConfirmCancel').addEventListener('click', function() { overlay.remove(); });
    execBtn.addEventListener('click', function() { overlay.remove(); onConfirm(actionable); });
}

// ── EVENT BINDING ──

function bindScanEvents(container) {
    var scanBtn = document.getElementById('optScanBtn');
    if (scanBtn) {
        scanBtn.addEventListener('click', async function() {
            scanBtn.disabled = true; scanBtn.textContent = 'Scanning...';
            var prog = document.getElementById('optScanProgress');
            prog.style.display = '';
            try {
                await scanAccount(function(msg) { prog.textContent = msg; });
                window.OPTIMIZER_STAGE = 'scan';
                renderOptimizer();
            } catch (err) {
                prog.innerHTML = '<span style="color:var(--red);">Scan failed: ' + esc(err.message) + '</span>';
                scanBtn.disabled = false; scanBtn.textContent = '\ud83d\udd0d Scan Full Account';
            }
        });
    }

    var planBtn = document.getElementById('optPlanBtn');
    if (planBtn) {
        planBtn.addEventListener('click', async function() {
            planBtn.disabled = true; planBtn.textContent = 'Generating plan...';
            var prog = document.getElementById('optPlanProgress');
            prog.style.display = '';
            prog.innerHTML = '<div class="ai-loading"><div class="ai-loading-spinner"></div><div class="ai-loading-text">AI analyzing ' + window.OPTIMIZER_SCAN.summary.total_ads + ' ads...</div><div class="ai-loading-sub">30-60 seconds</div></div>';
            try {
                await generateOptimizationPlan(window.OPTIMIZER_SCAN);
                window.OPTIMIZER_STAGE = 'plan';
                renderOptimizer();
            } catch (err) {
                prog.innerHTML = '<div class="ai-error"><div class="ai-error-title">Plan generation failed</div><div class="ai-error-msg">' + esc(err.message) + '</div></div>';
                planBtn.disabled = false; planBtn.textContent = '\ud83e\udd16 Generate Optimization Plan';
            }
        });
    }

    var rescanBtn = document.getElementById('optRescanBtn');
    if (rescanBtn) {
        rescanBtn.addEventListener('click', function() {
            window.OPTIMIZER_SCAN = null; window.OPTIMIZER_PLAN = null;
            window.OPTIMIZER_STAGE = 'scan'; renderOptimizer();
        });
    }
}

function bindPlanEvents(container) {
    // Filter tabs
    container.querySelectorAll('.opt-filter').forEach(function(btn) {
        btn.addEventListener('click', function() {
            container.querySelectorAll('.opt-filter').forEach(function(b) {
                b.classList.remove('active');
                b.style.borderColor = 'var(--border)'; b.style.background = 'var(--bg-card)'; b.style.color = 'var(--text)';
            });
            btn.classList.add('active');
            btn.style.borderColor = 'var(--accent)'; btn.style.background = 'rgba(99,102,241,0.15)'; btn.style.color = 'var(--accent)';
            window.OPTIMIZER_PLAN_FILTER = btn.dataset.filter || 'all';
            document.getElementById('optActionsTable').innerHTML = renderActionsTable(
                window.OPTIMIZER_PLAN.actions,
                window.OPTIMIZER_PLAN_FILTER,
                window.OPTIMIZER_PLAN_SCOPE || 'all'
            );
            bindBudgetInputs(container);
            bindRunButtons();
        });
    });

    // Budget input editing — update action data when user changes the value
    container.querySelectorAll('.opt-budget-input').forEach(function(input) {
        input.addEventListener('change', function() {
            var actionId = input.dataset.actionId;
            var newBudget = parseFloat(input.value);
            if (!actionId || isNaN(newBudget) || !window.OPTIMIZER_PLAN) return;
            var action = window.OPTIMIZER_PLAN.actions.find(function(a) { return a.action_id === actionId; });
            if (action && action.budget_change) {
                action.budget_change.recommended_daily_budget = newBudget;
                console.log('[Optimizer] Budget updated for', actionId, '→ \u20b9' + newBudget + '/day');
                input.style.borderColor = 'var(--green)';
                setTimeout(function() { input.style.borderColor = 'var(--accent)'; }, 1500);
            }
        });
    });

    container.querySelectorAll('.opt-scope').forEach(function(btn) {
        btn.addEventListener('click', function() {
            window.OPTIMIZER_PLAN_SCOPE = btn.dataset.scope || 'all';
            container.querySelectorAll('.opt-scope').forEach(function(b) {
                b.classList.remove('active');
                b.style.borderColor = 'var(--border)'; b.style.background = 'var(--bg-card)'; b.style.color = 'var(--text)';
            });
            btn.classList.add('active');
            btn.style.borderColor = 'var(--green)'; btn.style.background = 'rgba(16,185,129,0.12)'; btn.style.color = 'var(--green)';
            document.getElementById('optActionsTable').innerHTML = renderActionsTable(
                window.OPTIMIZER_PLAN.actions,
                window.OPTIMIZER_PLAN_FILTER || 'all',
                window.OPTIMIZER_PLAN_SCOPE
            );
            bindBudgetInputs(container);
            bindRunButtons();
        });
    });

    bindBudgetInputs(container);

    // Execute all
    document.getElementById('optExecAllBtn').addEventListener('click', function() {
        showConfirmModal(window.OPTIMIZER_PLAN.actions, async function(actionable) {
            window.OPTIMIZER_STAGE = 'execute';
            renderOptimizer();
            var el = document.getElementById('optExecResults');
            el.innerHTML = '<div class="ai-loading"><div class="ai-loading-spinner"></div><div class="ai-loading-text">Executing ' + actionable.length + ' actions...</div></div>';
            try {
                var res = await executeAllActions(actionable);
                el.innerHTML = '<div style="' + CS + '">' +
                    '<h3 style="color:' + (res.failed === 0 ? 'var(--green)' : 'var(--orange)') + ';">Execution Complete</h3>' +
                    '<p style="font-size:14px;color:var(--text);margin-top:8px;">\u2705 ' + res.succeeded + ' succeeded' + (res.failed > 0 ? ' \u274c ' + res.failed + ' failed' : '') + '</p></div>';
            } catch (err) {
                el.innerHTML = '<div class="ai-error"><div class="ai-error-title">Execution failed</div><div class="ai-error-msg">' + esc(err.message) + '</div></div>';
            }
        });
    });

    document.getElementById('optBackToScan').addEventListener('click', function() {
        window.OPTIMIZER_STAGE = 'scan'; renderOptimizer();
    });

    bindRunButtons();
}

function bindBudgetInputs(container) {
    container.querySelectorAll('.opt-budget-input').forEach(function(input) {
        input.addEventListener('change', function() {
            var actionId = input.dataset.actionId;
            var newBudget = parseFloat(input.value);
            if (!actionId || isNaN(newBudget) || !window.OPTIMIZER_PLAN) return;
            var action = window.OPTIMIZER_PLAN.actions.find(function(a) { return a.action_id === actionId; });
            if (action && action.budget_change) {
                action.budget_change.recommended_daily_budget = newBudget;
                console.log('[Optimizer] Budget updated for', actionId, 'â†’ \u20b9' + newBudget + '/day');
                input.style.borderColor = 'var(--green)';
                setTimeout(function() { input.style.borderColor = 'var(--accent)'; }, 1500);
            }
        });
    });
}

function bindRunButtons() {
    document.querySelectorAll('.opt-run-single').forEach(function(btn) {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation();
            var actionId = btn.dataset.actionId;
            var action = (window.OPTIMIZER_PLAN.actions || []).find(function(a) { return a.action_id === actionId; });
            if (!action || !isExecutableActionType(action.action_type)) return;
            btn.disabled = true; btn.textContent = '...';
            try {
                var res = await executeAction(action);
                btn.textContent = res.success ? '\u2705' : '\u274c';
                btn.style.background = res.success ? 'var(--green)' : 'var(--red)';
            } catch (err) {
                btn.textContent = '\u274c'; btn.style.background = 'var(--red)';
            }
        });
    });
}

// ── INIT ──
window.OPTIMIZER_LOG = loadLog();

})();
