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

function fmtPct(v) { return v != null && !isNaN(v) ? parseFloat(v).toFixed(1) + '%' : '--'; }
function fmtNum(v) { return v != null ? Number(v).toLocaleString('en-IN') : '--'; }

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

function deriveMetrics(r) {
    var p0p1 = (r.p0_signup || 0) + (r.p1_signup || 0);
    var d6Rev = r.d6_overall_revenue || r.d6_revenue || 0;
    var d6Con = r.d6_overall_con || r.d6 || 0;
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

function loadGcExecLog() {
    try { return JSON.parse(localStorage.getItem('gc_optimizer_exec_log') || '[]'); }
    catch (e) { return []; }
}

function saveGcExecLog() {
    try { localStorage.setItem('gc_optimizer_exec_log', JSON.stringify((GC_OPT_EXEC_LOG || []).slice(-200))); }
    catch (e) {}
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
        endpoint = '/api/google/adgroup-status';
        payload = { adgroup_id: action.adset_id || action.entity_id, status: 'PAUSED' };
    } else if (action.action_type === 'UPDATE_CAMPAIGN_BUDGET') {
        endpoint = '/api/google/campaign-budget';
        payload = {
            campaign_id: action.campaign_id || action.entity_id,
            action: action.budget_action,
            pct: action.change_pct
        };
    } else {
        return { success: false, error: 'Unsupported Google execution action' };
    }

    if (options && options.validateOnly) payload.validate_only = true;

    var response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    var since = new Date(now - 14 * 86400000).toISOString().split('T')[0];
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

// ── Rule-based optimization logic ──

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
        return { action: 'REDUCE BUDGET', color: 'var(--orange)', reason: 'CPI ' + fmtINR(cpi) + ' is too high (>250) — inefficient acquisition', impact: 'Reduce waste on expensive installs', priority: 'P2' };
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

// ── Scanner — fetches Google Ads + Metabase data ──

async function scanGoogleAccount(progressCb) {
    var dr = getSelectedDates();
    progressCb('Fetching Google Ads insights + Metabase funnel...');

    var googleRes, funnelRes;
    try {
        var results = await Promise.all([
            fetch('/creative-portal/api/google/ad-insights-daily', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom: dr.since, dateTo: dr.until })
            }).then(function(r) { return r.json(); }),
            fetch('/creative-portal/api/google/ad-funnel', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom: dr.since, dateTo: dr.until })
            }).then(function(r) { return r.json(); })
        ]);
        googleRes = results[0];
        funnelRes = results[1];
    } catch (err) {
        throw new Error('Failed to fetch data: ' + err.message);
    }

    var googleRows = googleRes.data || [];
    var funnelRows = funnelRes.data || [];

    if (googleRows.length === 0 && funnelRows.length === 0) {
        throw new Error('No data returned from either Google Ads API or Metabase funnel');
    }

    progressCb('Google: ' + googleRows.length + ' rows | Funnel: ' + funnelRows.length + ' rows. Matching...');

    // Build Metabase daily lookup: date|||campaign_name|||adset_name
    var mbDaily = {};
    for (var fi = 0; fi < funnelRows.length; fi++) {
        var row = funnelRows[fi];
        var d = String(row.date || '').substring(0, 10);
        var key = d + '|||' + (row.campaign_name || '') + '|||' + (row.ad_set_name || '').toLowerCase().trim();
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
        var adUid = (gr.campaign_name || '') + '|||' + (gr.adset_name || gr.adgroup_name || '');
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
        var mbKey = dateKey + '|||' + (gr.campaign_name || '') + '|||' + (gr.adset_name || gr.adgroup_name || '').toLowerCase().trim();
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

    // If no Google API data, build from funnel alone
    if (googleRows.length === 0 && funnelRows.length > 0) {
        for (var ffi = 0; ffi < funnelRows.length; ffi++) {
            var fr = funnelRows[ffi];
            var campName = fr.campaign_name || '';
            var adsetName = (fr.ad_set_name || '').toLowerCase().trim();
            var fUid = campName + '|||' + adsetName;
            if (!adAgg[fUid]) {
                adAgg[fUid] = {
                    adset_name: fr.ad_set_name || '', campaign_name: campName,
                    campaign_id: '', adset_id: '', campaign_type: '',
                    spend: 0, impressions: 0, clicks: 0, installs: 0, conversions: 0,
                    signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
                    d6: 0, d6_revenue: 0, overall_revenue: 0,
                    d6_overall_con: 0, d6_overall_revenue: 0,
                    d15_overall_con: 0, d15_overall_revenue: 0,
                    d30_overall_con: 0, d30_overall_revenue: 0,
                    d60_overall_con: 0, d60_overall_revenue: 0,
                    p0_signup: 0, p1_signup: 0, total_trial: 0,
                    _matched: true, _weeklySpend: [0, 0], _weeklyInstalls: [0, 0]
                };
            }
            var fa = adAgg[fUid];
            fa.signups += Number(fr.signups) || 0;
            fa.d0_trial += Number(fr.d0_trial) || 0;
            fa.d0 += Number(fr.d0) || 0;
            fa.d0_revenue += Number(fr.d0_revenue) || 0;
            fa.d6 += Number(fr.d6) || 0;
            fa.d6_revenue += Number(fr.d6_revenue) || 0;
            fa.overall_revenue += Number(fr.overall_revenue) || 0;
            fa.d6_overall_con += Number(fr.d6_overall_con) || 0;
            fa.d6_overall_revenue += Number(fr.d6_overall_revenue) || 0;
            fa.d15_overall_con += Number(fr.d15_overall_con) || 0;
            fa.d15_overall_revenue += Number(fr.d15_overall_revenue) || 0;
            fa.d30_overall_con += Number(fr.d30_overall_con) || 0;
            fa.d30_overall_revenue += Number(fr.d30_overall_revenue) || 0;
            fa.d60_overall_con += Number(fr.d60_overall_con) || 0;
            fa.d60_overall_revenue += Number(fr.d60_overall_revenue) || 0;
            fa.p0_signup += Number(fr.p0_signup) || 0;
            fa.p1_signup += Number(fr.p1_signup) || 0;
            fa.total_trial += Number(fr.total_trial) || 0;
        }
    }

    progressCb('Building campaign tree and running optimization rules on mature data...');

    // ── Maturity detection & mature data separation ──
    // Mature = campaign is 14+ days old. Mature data = exclude last 7 days of spend & metrics.
    var sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    // Build mature-only aggregates (excluding last 7 days)
    var matureAgg = {};
    for (var gi2 = 0; gi2 < googleRows.length; gi2++) {
        var gr2 = googleRows[gi2];
        var rowDate2 = gr2.date_start || gr2.date || gr2.segments_date || '';
        if (rowDate2 >= sevenDaysAgo) continue; // Skip last 7 days
        var adUid2 = (gr2.campaign_name || '') + '|||' + (gr2.adset_name || gr2.adgroup_name || '');
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
        var mbKey2 = rowDate2 + '|||' + (gr2.campaign_name || '') + '|||' + (gr2.adset_name || gr2.adgroup_name || '').toLowerCase().trim();
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
        var adUidKey = a.campaign_name + '|||' + a.adset_name;

        // Detect maturity from campaign name date suffix (_DDMMYY)
        var campDateMatch = (a.campaign_name || '').match(/(\d{6})$/);
        var goLiveISO = null;
        if (campDateMatch) {
            var dd = campDateMatch[1].slice(0, 2), mm = campDateMatch[1].slice(2, 4), yy = campDateMatch[1].slice(4, 6);
            goLiveISO = '20' + yy + '-' + mm + '-' + dd;
        }
        a.daysLive = goLiveISO ? Math.max(0, Math.round((Date.now() - new Date(goLiveISO).getTime()) / 86400000)) : 0;
        a.isMatured = a.daysLive >= 14;
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
            a.recommendation = { action: 'TOO EARLY', color: 'var(--text-dim)', reason: 'Campaign is only ' + a.daysLive + ' days old — needs 14+ days for reliable evaluation', impact: 'Let it run, reassess after day 14', priority: 'P3' };
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

    // Build campaign tree
    var tree = {};
    for (var ti = 0; ti < adsets.length; ti++) {
        var as = adsets[ti];
        if (!tree[as.campaign_name]) {
            tree[as.campaign_name] = {
                name: as.campaign_name, id: as.campaign_id,
                type: as.campType, adsets: {}
            };
        }
        tree[as.campaign_name].adsets[as.adset_name] = as;
    }

    // Compute campaign-level totals
    for (var ck in tree) {
        var campAdsets = Object.values(tree[ck].adsets);
        tree[ck].totals = sumEvaluated(campAdsets);
        tree[ck].totals.campType = tree[ck].type;
        tree[ck].recommendation = classifyAction(tree[ck].totals);
    }

    var evaluatedTotals = sumEvaluated(adsets);
    var pauseCount = adsets.filter(function(x) { return x.recommendation.action === 'PAUSE'; }).length;
    var scaleCount = adsets.filter(function(x) { return x.recommendation.action === 'SCALE'; }).length;
    var reduceCount = adsets.filter(function(x) { return x.recommendation.action === 'REDUCE BUDGET'; }).length;
    var watchCount = adsets.filter(function(x) { return x.recommendation.action === 'WATCH'; }).length;
    var maturedCount = adsets.filter(function(x) { return x._evalMode === 'mature'; }).length;

    var scanResult = {
        scan_date: new Date().toISOString(),
        date_range: dr,
        tree: tree,
        adsets: adsets,
        evaluatedTotals: evaluatedTotals,
        summary: {
            total_campaigns: Object.keys(tree).length,
            total_adsets: adsets.length,
            total_spend: evaluatedTotals.spend || 0,
            pause_count: pauseCount,
            scale_count: scaleCount,
            reduce_count: reduceCount,
            watch_count: watchCount,
            matched_keys: matchedKeys,
            unmatched_keys: unmatchedKeys,
            matured_adsets: maturedCount,
            early_adsets: adsets.length - maturedCount,
        }
    };

    GC_OPT_SCAN = scanResult;
    return scanResult;
}

// ══════════════════════════════════════════════════════════════════
// UI RENDERING
// ══════════════════════════════════════════════════════════════════

window.renderGcOptimizer = function() {
    var container = document.getElementById('gcOptimizerContent');
    if (!container) return;

    if (GC_OPT_STAGE === 'plan' && GC_OPT_SCAN) {
        renderPlanStage(container);
    } else {
        renderScanStage(container);
    }
};

// ── SCAN STAGE ──

function renderScanStage(container) {
    var dr = getDefaultDates();

    var html = '<div class="ci-panel">' +
        '<h2 style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">' +
            '<span style="font-size:22px;">&#9889;</span> Google Ads Optimizer' +
        '</h2>' +
        '<p style="color:var(--text-dim);font-size:13px;margin-bottom:20px;">Scan campaigns &#8594; Rule-based analysis &#8594; Mature-aware recommendations &#8594; One-click execution for supported actions</p>' +

        '<div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap;">' +
            '<label style="font-size:12px;color:var(--text-dim);">Date Range:</label>' +
            '<input type="date" id="gcOptDateFrom" value="' + dr.since + '" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px;">' +
            '<span style="color:var(--text-dim);">to</span>' +
            '<input type="date" id="gcOptDateTo" value="' + dr.until + '" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px;">' +
        '</div>';

    if (!GC_OPT_SCAN) {
        html += '<div style="' + CS + '">' +
            '<h3 style="font-size:15px;font-weight:600;margin-bottom:8px;">Step 1: Scan Google Ads Account</h3>' +
            '<p style="font-size:13px;color:var(--text-dim);margin-bottom:16px;">Fetches all campaigns and ad groups from Google Ads API. Enriches with Metabase funnel data (signups, D0 trials, D6 conversions, revenue). Applies rule-based optimization logic.</p>' +
            '<button id="gcOptScanBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 28px;">&#128270; Scan Google Ads</button>' +
            '<div id="gcOptScanProgress" style="display:none;margin-top:16px;font-size:13px;color:var(--text-dim);"></div>' +
        '</div>';
    } else {
        html += renderAccountOverview(GC_OPT_SCAN);
    }

    html += '</div>';
    container.innerHTML = html;
    bindScanEvents(container);
}

// ── ACCOUNT OVERVIEW (after scan) ──

function renderAccountOverview(scan) {
    var s = scan.summary;
    var adsets = scan.adsets || [];
    var tree = scan.tree || {};
    var maturityCardNote = buildMaturityNote(s, 'matured_adsets', 'early_adsets', 'ad group');

    var totals = scan.evaluatedTotals || sumEvaluated(adsets);
    var blendedD6ROAS = totals.d6ROAS;
    var avgCPI = totals.cpi || 0;
    var avgSignupCost = totals.signupCost || 0;

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
        { v: fmtINR(totals.spend), l: 'Total Spend', c: 'var(--text)' },
        { v: fmtPct(blendedD6ROAS), l: 'Blended D6 ROAS', c: blendedD6ROAS > 28 ? 'var(--green)' : blendedD6ROAS > 15 ? 'var(--orange)' : 'var(--red)' },
        { v: fmtINR(avgCPI), l: 'Avg CPI', c: avgCPI > 0 && avgCPI < 100 ? 'var(--green)' : avgCPI < 150 ? 'var(--orange)' : 'var(--red)' },
        { v: fmtINR(avgSignupCost), l: 'Avg Signup Cost', c: avgSignupCost > 0 && avgSignupCost < 500 ? 'var(--green)' : avgSignupCost < 1000 ? 'var(--orange)' : 'var(--red)' },
        { v: fmtNum(totals.installs), l: 'Installs', c: 'var(--text)' },
        { v: fmtNum(totals.signups), l: 'Signups', c: 'var(--text)' },
        { v: fmtNum(totals.d6Con || totals.d6 || 0), l: 'D6 Conversions', c: 'var(--accent)' },
        { v: String(s.total_campaigns), l: 'Campaigns', c: 'var(--text)' },
        { v: String(s.total_adsets), l: 'Ad Groups', c: 'var(--text)' },
        { v: '<span style="color:var(--red);">' + s.pause_count + '</span> / <span style="color:var(--green);">' + s.scale_count + '</span>', l: 'Pause / Scale', c: '' },
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
        '<div style="font-size:11px;color:var(--text-dim);">' + s.matured_adsets + ' ad groups are using mature data excluding the last 7 days. ' + s.early_adsets + ' early ad groups still use full data until they mature.</div></div>' +
    '</div>';

    // ── Funnel ──
    var funnel = [
        { label: 'Impressions', val: totals.impressions || 0 },
        { label: 'Clicks', val: totals.clicks || 0 },
        { label: 'Installs', val: totals.installs || 0 },
        { label: 'Signups', val: totals.signups || 0 },
        { label: 'D0 Trials', val: totals.d0_trial || 0 },
        { label: 'D0 Paid', val: totals.d0 || 0 },
        { label: 'D6 Paid', val: totals.d6Con || totals.d6 || 0 },
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
            spend: t.spend || 0, installs: t.installs || 0, signups: t.signups || 0,
            d6: t.d6Con || t.d6 || 0, d6ROAS: t.d6ROAS || 0, cpi: t.cpi, signupCost: t.signupCost,
            rec: c.recommendation,
            spendPct: totals.spend > 0 ? (t.spend || 0) / totals.spend * 100 : 0
        });
    }
    campList.sort(function(a, b) { return b.spend - a.spend; });

    html += '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:14px;">&#128202; Campaign Performance</h3>' +
        '<div style="overflow-x:auto;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
        '<thead><tr style="border-bottom:2px solid var(--border);">' +
            '<th style="text-align:left;padding:8px 6px;color:var(--text-dim);font-weight:600;">Campaign</th>' +
            '<th style="text-align:center;padding:8px 6px;color:var(--text-dim);">Type</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">Spend</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">Installs</th>' +
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
    html += '<div style="display:flex;gap:10px;margin-bottom:16px;align-items:center;">' +
        '<button id="gcOptPlanBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 28px;">&#128203; View Optimization Plan</button>' +
        '<button id="gcOptRescanBtn" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:13px;">&#8635; Rescan</button>' +
        '<span style="font-size:11px;color:var(--text-dim);">Scanned: ' + new Date(scan.scan_date).toLocaleString() + ' | Match rate: ' + s.matched_keys + '/' + (s.matched_keys + s.unmatched_keys) + '</span>' +
    '</div>';

    return html;
}

// ── PLAN STAGE — Recommendation Cards ──

function renderPlanStage(container) {
    var scan = GC_OPT_SCAN;
    if (!scan) { GC_OPT_STAGE = 'scan'; renderScanStage(container); return; }

    var adsets = (scan.adsets || []).slice().sort(function(a, b) {
        var pOrd = { P1: 0, P2: 1, P3: 2 };
        var pa = pOrd[a.recommendation.priority] || 2;
        var pb = pOrd[b.recommendation.priority] || 2;
        if (pa !== pb) return pa - pb;
        return (b.evalSpend || b.spend || 0) - (a.evalSpend || a.spend || 0);
    });

    var s = scan.summary;
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
                '<button id="gcOptBackBtn" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:12px;">&#8592; Back to Scan</button>' +
                '<button id="gcOptRescanBtn2" style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:12px;">&#8635; Rescan</button>' +
            '</div>' +
        '</div>' +
        '<p style="color:var(--text-dim);font-size:12px;margin-bottom:20px;">Supported actions can execute directly from this plan. Budget changes are applied once per campaign to avoid double-scaling across multiple ad-group cards.</p>';

    // ── Summary cards ──
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:20px;">' +
        '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--red);"><div style="font-size:22px;font-weight:700;color:var(--red);">' + s.pause_count + '</div><div style="font-size:10px;color:var(--text-dim);">Pause</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' +
        '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--orange);"><div style="font-size:22px;font-weight:700;color:var(--orange);">' + s.reduce_count + '</div><div style="font-size:10px;color:var(--text-dim);">Reduce Budget</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' +
        '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--green);"><div style="font-size:22px;font-weight:700;color:var(--green);">' + s.scale_count + '</div><div style="font-size:10px;color:var(--text-dim);">Scale</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' +
        '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--text-dim);"><div style="font-size:22px;font-weight:700;color:var(--text-dim);">' + s.watch_count + '</div><div style="font-size:10px;color:var(--text-dim);">Watch</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' +
        '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--accent);"><div style="font-size:22px;font-weight:700;color:var(--accent);">' + s.total_adsets + '</div><div style="font-size:10px;color:var(--text-dim);">Total Ad Groups</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' +
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
        '<div style="font-size:11px;color:var(--text-dim);">' + maturedCount + ' matured ad groups (14+ days old) evaluated on data excluding the last 7 days for reliable metrics. ' + earlyCount + ' ad groups are too early to evaluate.</div></div>' +
    '</div>';
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
                        (a.evalInstalls > 0 ? '<span style="' + CARD + 'padding:4px 8px;">Installs: <strong>' + a.evalInstalls + '</strong></span>' : '') +
                        (a.evalD6 > 0 ? '<span style="' + CARD + 'padding:4px 8px;">D6: <strong>' + a.evalD6 + '</strong></span>' : '') +
                    '</div>' +

                    '<div style="font-size:10px;color:var(--accent);margin-bottom:8px;">' + esc(a.evalDataLabel) + '</div>' +

                    // Reasoning
                    '<div style="font-size:12px;color:var(--text);line-height:1.6;padding:8px;background:rgba(0,0,0,0.2);border-radius:6px;margin-bottom:6px;">' + esc(rec.reason) + '</div>' +

                    // CPI trend flag
                    (rec.flags && rec.flags.length > 0 ? '<div style="font-size:11px;color:var(--orange);margin-bottom:6px;">' + rec.flags.map(function(f) { return '&#9888; ' + esc(f); }).join('<br>') + '</div>' : '') +

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
            scanBtn.disabled = true;
            scanBtn.textContent = 'Scanning...';
            var prog = document.getElementById('gcOptScanProgress');
            prog.style.display = '';
            try {
                await scanGoogleAccount(function(msg) { prog.textContent = msg; });
                GC_OPT_ACTIVE_FILTER = 'all';
                GC_OPT_EXEC_PLAN = null;
                GC_OPT_EXEC_STATUS = {};
                GC_OPT_LAST_EXEC_SUMMARY = null;
                GC_OPT_STAGE = 'scan';
                window.renderGcOptimizer();
            } catch (err) {
                prog.innerHTML = '<span style="color:var(--red);">Scan failed: ' + esc(err.message) + '</span>';
                scanBtn.disabled = false;
                scanBtn.textContent = '&#128270; Scan Google Ads';
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
            GC_OPT_STAGE = 'scan';
            window.renderGcOptimizer();
        });
    }
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

})();
