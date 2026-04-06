// =========================================================================
// Google Creative Portal — gc-app.js
// Full replica of app.js adapted for Google Ads data
// All DOM IDs use gc prefix, all API endpoints use /api/google/*
// =========================================================================

let allData = [];
let filteredData = [];
let _refreshTimer = null;
const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes
let currentDateRange = { since: null, until: null, label: '--' };
let currentDataMode = { type: 'na', label: 'Mode: --', detail: '' };
let currentDiagnostics = { source: 'Google + Metabase', matchedKeys: 0, unmatchedKeys: 0 };
const GC_URL_PARAMS = new URLSearchParams(window.location.search || '');
const GC_INITIAL_VIEW = GC_URL_PARAMS.get('view') || 'gcDashboard';
const GC_EMBED_MODE = GC_URL_PARAMS.get('embed') || '';

// =========================================================================
// Shared data pipeline — raw summable metrics + derived formulated metrics
// =========================================================================
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
    const t = emptyRaw();
    for (const item of items) {
        for (const k of Object.keys(t)) t[k] += (item[k] || 0);
    }
    return t;
}

function formatAbsDate(dateStr) {
    if (!dateStr) return '--';
    const dt = new Date(String(dateStr).substring(0, 10) + 'T00:00:00');
    if (Number.isNaN(dt.getTime())) return String(dateStr);
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function buildDateRangeLabel(since, until) {
    if (!since || !until) return '--';
    return `${formatAbsDate(since)} -> ${formatAbsDate(until)}`;
}

function summarizeMaturity(items) {
    const matured = (items || []).filter(item => item && item.isMatured).length;
    const early = Math.max(0, (items || []).length - matured);
    if (matured > 0 && early > 0) return { type: 'mixed', label: `Mode: Mixed (${matured} mature / ${early} early)`, detail: `${matured} mature records and ${early} early records are contributing.` };
    if (matured > 0) return { type: 'mature', label: `Mode: Mature (${matured})`, detail: 'Visible records are using mature data where available.' };
    return { type: 'early', label: `Mode: Early / Full Data (${early})`, detail: 'Visible records are still using early/full data.' };
}

function updateContextStrip() {
    const dateEl = document.getElementById('gcViewContextDate');
    const modeEl = document.getElementById('gcViewContextMode');
    const metaEl = document.getElementById('gcViewContextMeta');
    if (dateEl) dateEl.textContent = `Data: ${currentDateRange.label || '--'}`;
    if (modeEl) {
        modeEl.textContent = currentDataMode.label || 'Mode: --';
        modeEl.title = currentDataMode.detail || currentDataMode.label || '';
    }
    if (metaEl) {
        const matched = Number(currentDiagnostics.matchedKeys || 0);
        const unmatched = Number(currentDiagnostics.unmatchedKeys || 0);
        metaEl.textContent = `Source: ${currentDiagnostics.source || 'Google + Metabase'} • Keys ${matched}/${matched + unmatched || matched}`;
        metaEl.title = unmatched > 0 ? `${matched} matched keys, ${unmatched} unmatched spend-only rows retained.` : `${matched} matched keys.`;
    }
}

function getCurrentFilterState() {
    return {
        search: document.getElementById('gcSearchInput')?.value || '',
        type: document.getElementById('gcTypeFilter')?.value || 'all',
        status: document.getElementById('gcStatusFilter')?.value || 'all',
        performance: document.getElementById('gcPerfFilter')?.value || 'all',
    };
}

function publishPortalContext(extra) {
    const view = getCurrentView();
    const context = {
        app: 'google',
        view,
        title: views[view] ? views[view].title : 'Google Portal',
        subtitle: views[view] ? views[view].subtitle : 'Google portal view',
        dateRange: currentDateRange,
        dataMode: currentDataMode,
        filters: getCurrentFilterState(),
        diagnostics: {
            source: currentDiagnostics.source || 'Google + Metabase',
            matchedKeys: Number(currentDiagnostics.matchedKeys || 0),
            unmatchedKeys: Number(currentDiagnostics.unmatchedKeys || 0),
            lastUpdated: document.getElementById('gcLastUpdated')?.textContent || '--',
        },
        promptHints: [
            'I think data is wrong here',
            'Which campaign should I scale right now for max ROAS?',
            'Why is the optimizer showing limited actions?'
        ],
        ...(extra || {})
    };
    updateContextStrip();
    window.__portalAssistantContext = context;
    window.getPortalAssistantContext = () => window.__portalAssistantContext;
    try {
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'portal-context', context }, '*');
        }
    } catch (err) {}
}

async function runViewAssistantQuery() {
    const input = document.getElementById('gcViewPromptInput');
    const button = document.getElementById('gcViewPromptAskBtn');
    const panel = document.getElementById('gcViewAssistantPanel');
    const questionEl = document.getElementById('gcViewAssistantQuestion');
    const answerEl = document.getElementById('gcViewAssistantAnswer');
    const checksEl = document.getElementById('gcViewAssistantChecks');
    const nextEl = document.getElementById('gcViewAssistantNextSteps');
    const reopenBtn = document.getElementById('gcViewAssistantReopenBtn');
    if (!input || !button) return;
    const prompt = input.value.trim();
    if (!prompt) return;
    button.disabled = true;
    const context = window.getPortalAssistantContext ? window.getPortalAssistantContext() : null;
    if (panel) panel.hidden = false;
    if (reopenBtn) reopenBtn.hidden = true;
    if (questionEl) questionEl.textContent = `Question: ${prompt}`;
    if (answerEl) answerEl.textContent = 'Thinking through the current view...';
    if (checksEl) checksEl.innerHTML = '<div class="ai-dock-item">Reading current filters, date range, and diagnostics.</div>';
    if (nextEl) nextEl.innerHTML = '<div class="ai-dock-item">Preparing focused next steps.</div>';
    try {
        const res = await fetch('/api/ai/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system: 'You are an AI intelligent analyzer for the current Google portal view. Answer like a sharp performance marketing analyst. Prioritize practical decisions, especially scale/cut/debug questions. Return strict JSON with keys answer, checks, next_steps.',
                prompt: `Active Google portal context:\n${JSON.stringify(context, null, 2)}\n\nUser question:\n${prompt}`,
                max_tokens: 2200
            })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Assistant request failed');
        const parsed = JSON.parse(data.content);
        if (answerEl) answerEl.textContent = parsed.answer || 'No answer returned.';
        if (checksEl) {
            const checks = Array.isArray(parsed.checks) && parsed.checks.length ? parsed.checks : ['No structured checks returned.'];
            checksEl.innerHTML = checks.map(item => `<div class="ai-dock-item">${esc(item)}</div>`).join('');
        }
        if (nextEl) {
            const next = Array.isArray(parsed.next_steps) && parsed.next_steps.length ? parsed.next_steps : ['No next steps returned.'];
            nextEl.innerHTML = next.map(item => `<div class="ai-dock-item">${esc(item)}</div>`).join('');
        }
    } catch (err) {
        if (answerEl) answerEl.textContent = 'Assistant error: ' + err.message;
        if (checksEl) checksEl.innerHTML = `<div class="ai-dock-item">Context view: ${esc(context && context.view || 'unknown')}</div>`;
        if (nextEl) nextEl.innerHTML = '<div class="ai-dock-item">Retry after the current view finishes loading.</div>';
    } finally {
        button.disabled = false;
    }
}

function closeViewAssistantPanel() {
    const panel = document.getElementById('gcViewAssistantPanel');
    const reopenBtn = document.getElementById('gcViewAssistantReopenBtn');
    if (panel) panel.hidden = true;
    if (reopenBtn) reopenBtn.hidden = false;
}

function reopenViewAssistantPanel() {
    const panel = document.getElementById('gcViewAssistantPanel');
    const reopenBtn = document.getElementById('gcViewAssistantReopenBtn');
    if (panel) panel.hidden = false;
    if (reopenBtn) reopenBtn.hidden = true;
}

const _vR = (sp, rev) => {
    if (!sp || sp <= 0 || !rev || rev < 0) return null;
    if (rev / sp > 50) return null;
    return (rev / sp) * 100;
};

function deriveMetrics(r) {
    const p0p1 = (r.p0_signup || 0) + (r.p1_signup || 0);
    const d6Rev = r.d6_overall_revenue || 0;
    const d6Con = r.d6 || 0;
    return {
        ...r,
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
        d6ROAS: _vR(r.spend, d6Rev) ?? 0,
        d15ROAS: _vR(r.spend, r.d15_overall_revenue) ?? 0,
        d30ROAS: _vR(r.spend, r.d30_overall_revenue) ?? 0,
        d60ROAS: _vR(r.spend, r.d60_overall_revenue) ?? 0,
        overallROAS: _vR(r.spend, r.overall_revenue) ?? 0,
    };
}

// =========================================================================
// DATA FETCHING — Google Ads API + Metabase funnel
// =========================================================================
async function fetchLiveData(customDateFrom, customDateTo) {
    showLoading(true);
    try {
        const dateTo = customDateTo || new Date().toISOString().slice(0, 10);
        const dateFrom = customDateFrom || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        currentDateRange = { since: dateFrom, until: dateTo, label: buildDateRangeLabel(dateFrom, dateTo) };
        console.log(`[fetchLiveData] Fetching Google ${dateFrom} to ${dateTo}...`);

        // Parallel fetch: Google insights + Metabase funnel + Campaign statuses
        const [googleRes, funnelRes, campaignsRes] = await Promise.all([
            fetch('/api/google/ad-insights-daily', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom, dateTo })
            }).then(r => r.json()),
            fetch('/api/google/ad-funnel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom, dateTo })
            }).then(r => r.json()),
            fetch('/api/google/campaigns').then(r => r.json()).catch(() => ({ success: false, data: [] }))
        ]);

        const googleRows = googleRes.data || [];
        const funnelRows = funnelRes.data || [];
        const campaignsData = campaignsRes.data || [];

        if (!funnelRes.success && funnelRows.length === 0 && googleRows.length === 0) {
            throw new Error('No data available: ' + (funnelRes.error || googleRes.error || 'Unknown error'));
        }

        if (googleRes.error) console.warn('[fetchLiveData] Google Ads API warning:', googleRes.error, '— using funnel data only');
        console.log(`[fetchLiveData] Google: ${googleRows.length} rows, Funnel: ${funnelRows.length} rows, Campaigns: ${campaignsData.length}`);

        // Build campaign status lookup: campaign_id -> { status, campaign_name, campaign_type }
        const campaignStatusMap = {};
        campaignsData.forEach(c => { campaignStatusMap[c.campaign_id] = c; });

        // Build Metabase daily lookup: date|||campaign_name|||adset_name
        // Google matches at adset level (no tracker_name/ad_name level)
        const mbDaily = {};
        for (const row of funnelRows) {
            const d = String(row.date || '').substring(0, 10);
            const key = d + '|||' + (row.campaign_name || '') + '|||' + (row.ad_set_name || '').toLowerCase().trim();
            if (!mbDaily[key]) {
                mbDaily[key] = { signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0, d6: 0, d6_revenue: 0, overall_revenue: 0, p0_signup: 0, p1_signup: 0, total_trial: 0, d6_overall_con: 0, d6_overall_revenue: 0, d15_overall_con: 0, d15_overall_revenue: 0, d30_overall_con: 0, d30_overall_revenue: 0, d60_overall_con: 0, d60_overall_revenue: 0 };
            }
            const m = mbDaily[key];
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
        const adAgg = {};
        for (const row of googleRows) {
            const adUid = (row.campaign_name || '') + '|||' + (row.adset_name || row.adgroup_name || '');
            if (!adAgg[adUid]) {
                adAgg[adUid] = {
                    adset_name: row.adset_name || row.adgroup_name || '',
                    campaign_name: row.campaign_name || '',
                    campaign_id: row.campaign_id || '',
                    adset_id: row.adset_id || row.adgroup_id || '',
                    campaign_type: row.campaign_type || row.advertising_channel_type || '',
                    spend: 0, impressions: 0, clicks: 0, conversions: 0,
                    signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
                    d6: 0, d6_revenue: 0, overall_revenue: 0,
                    d6_overall_con: 0, d6_overall_revenue: 0,
                    d15_overall_con: 0, d15_overall_revenue: 0,
                    d30_overall_con: 0, d30_overall_revenue: 0,
                    d60_overall_con: 0, d60_overall_revenue: 0,
                    p0_signup: 0, p1_signup: 0, total_trial: 0,
                    dates: [], _matched: false,
                };
            }
            const a = adAgg[adUid];
            a.spend += (row.spend || row.cost_micros / 1000000 || 0) * 1.18; // GST
            a.impressions += row.impressions || 0;
            a.clicks += row.clicks || 0;
            a.conversions += row.conversions || 0;
            if ((row.spend || row.cost_micros) > 0) a.dates.push(row.date_start || row.date || row.segments_date || '');

            // Daily key match to Metabase (adset level for Google)
            const dateKey = row.date_start || row.date || row.segments_date || '';
            const mbKey = dateKey + '|||' + (row.campaign_name || '') + '|||' + (row.adset_name || row.adgroup_name || '').toLowerCase().trim();
            const mb = mbDaily[mbKey];
            if (mb) {
                a._matched = true;
                a.signups += mb.signups;
                a.d0_trial += mb.d0_trial;
                a.d0 += mb.d0;
                a.d0_revenue += mb.d0_revenue;
                a.d6 += mb.d6;
                a.d6_revenue += mb.d6_revenue;
                a.overall_revenue += mb.overall_revenue;
                a.d6_overall_con += mb.d6_overall_con;
                a.d6_overall_revenue += mb.d6_overall_revenue;
                a.d15_overall_con += mb.d15_overall_con;
                a.d15_overall_revenue += mb.d15_overall_revenue;
                a.d30_overall_con += mb.d30_overall_con;
                a.d30_overall_revenue += mb.d30_overall_revenue;
                a.d60_overall_con += mb.d60_overall_con;
                a.d60_overall_revenue += mb.d60_overall_revenue;
                a.p0_signup += mb.p0_signup;
                a.p1_signup += mb.p1_signup;
                a.total_trial += mb.total_trial;
            }
        }

        // If no Google API data, build records from funnel data alone
        if (googleRows.length === 0 && funnelRows.length > 0) {
            // Group funnel by campaign|||adset
            for (const row of funnelRows) {
                const campName = row.campaign_name || '';
                const adsetName = (row.ad_set_name || '').toLowerCase().trim();
                const adUid = campName + '|||' + adsetName;
                if (!adAgg[adUid]) {
                    adAgg[adUid] = {
                        adset_name: row.ad_set_name || '',
                        campaign_name: campName,
                        campaign_id: '',
                        adset_id: '',
                        campaign_type: '',
                        spend: 0, impressions: 0, clicks: 0, conversions: 0,
                        signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
                        d6: 0, d6_revenue: 0, overall_revenue: 0,
                        d6_overall_con: 0, d6_overall_revenue: 0,
                        d15_overall_con: 0, d15_overall_revenue: 0,
                        d30_overall_con: 0, d30_overall_revenue: 0,
                        d60_overall_con: 0, d60_overall_revenue: 0,
                        p0_signup: 0, p1_signup: 0, total_trial: 0,
                        dates: [], _matched: true,
                    };
                }
                const a = adAgg[adUid];
                a.signups += Number(row.signups) || 0;
                a.d0_trial += Number(row.d0_trial) || 0;
                a.d0 += Number(row.d0) || 0;
                a.d0_revenue += Number(row.d0_revenue) || 0;
                a.d6 += Number(row.d6) || 0;
                a.d6_revenue += Number(row.d6_revenue) || 0;
                a.overall_revenue += Number(row.overall_revenue) || 0;
                a.d6_overall_con += Number(row.d6_overall_con) || 0;
                a.d6_overall_revenue += Number(row.d6_overall_revenue) || 0;
                a.d15_overall_con += Number(row.d15_overall_con) || 0;
                a.d15_overall_revenue += Number(row.d15_overall_revenue) || 0;
                a.d30_overall_con += Number(row.d30_overall_con) || 0;
                a.d30_overall_revenue += Number(row.d30_overall_revenue) || 0;
                a.d60_overall_con += Number(row.d60_overall_con) || 0;
                a.d60_overall_revenue += Number(row.d60_overall_revenue) || 0;
                a.p0_signup += Number(row.p0_signup) || 0;
                a.p1_signup += Number(row.p1_signup) || 0;
                a.total_trial += Number(row.total_trial) || 0;
                const d = String(row.date || '').substring(0, 10);
                if (d) a.dates.push(d);
            }
            console.log('[fetchLiveData] Built ' + Object.keys(adAgg).length + ' records from funnel data (Google Ads API unavailable)');
        }

        // Map to window.allData contract
        allData = Object.values(adAgg).map((a, idx) => {
            const campaignInfo = campaignStatusMap[a.campaign_id];
            const hasStatusData = campaignsData.length > 0;
            const isActive = hasStatusData
                ? (campaignInfo && (campaignInfo.status === 'ENABLED' || campaignInfo.status === 'ACTIVE'))
                : a.spend > 0;
            const spendDates = a.dates.filter(d => d).sort();

            // Detect campaign type
            const campaignType = detectType(a.campaign_name, a.campaign_type);

            // Go-live date: parse from campaign name suffix (_DDMMYY) or first spend date
            let goLiveDateISO = null;
            const campDateMatch = (a.campaign_name || '').match(/(\d{6})$/);
            if (campDateMatch) {
                const dd = campDateMatch[1].slice(0, 2), mm = campDateMatch[1].slice(2, 4), yy = campDateMatch[1].slice(4, 6);
                goLiveDateISO = '20' + yy + '-' + mm + '-' + dd;
            }
            if (!goLiveDateISO) {
                goLiveDateISO = (campaignInfo && campaignInfo.start_date) ? campaignInfo.start_date : (spendDates.length > 0 ? spendDates[0] : null);
            }
            const goLiveDate = goLiveDateISO || ((campaignInfo && campaignInfo.start_date) ? campaignInfo.start_date : (spendDates.length > 0 ? spendDates[0] : ''));
            const daysLive = goLiveDate ? Math.max(0, Math.round((Date.now() - new Date(goLiveDate).getTime()) / 86400000)) : 0;
            const isMatured = daysLive >= 14;

            // Build raw record and derive all metrics via shared pipeline
            const raw = {
                spend: a.spend, impressions: a.impressions, clicks: a.clicks,
                installs: a.conversions || 0, // Google "conversions" = installs equivalent
                thruplay: 0, p25: 0, p100: 0,
                signups: a.signups, d0_trial: a.d0_trial, d0: a.d0, d0_revenue: a.d0_revenue,
                d6: a.d6, d6_revenue: a.d6_revenue, overall_revenue: a.overall_revenue,
                d6_overall_con: a.d6_overall_con, d6_overall_revenue: a.d6_overall_revenue,
                d15_overall_con: a.d15_overall_con, d15_overall_revenue: a.d15_overall_revenue,
                d30_overall_con: a.d30_overall_con, d30_overall_revenue: a.d30_overall_revenue,
                d60_overall_con: a.d60_overall_con, d60_overall_revenue: a.d60_overall_revenue,
                p0_signup: a.p0_signup, p1_signup: a.p1_signup, total_trial: a.total_trial,
                new_converted_user: 0, new_user_rev: 0,
            };
            const derived = deriveMetrics(raw);

            // Compute testPerf — maturity-aware
            let testPerf = '';
            if (!isMatured) {
                testPerf = 'Try';
            } else if (a.spend >= 20000 && derived.d6ROAS < 5) testPerf = 'Drop';
            else if (a.spend >= 15000 && derived.d6ROAS < 15) testPerf = 'Failed';
            else if (a.spend < 15000) testPerf = 'Try';
            else if (a.spend >= 15000 && derived.d6ROAS > 40) testPerf = 'Exceptional';
            else if (a.spend >= 15000 && derived.d6ROAS > 28) testPerf = 'Performed';

            return {
                sno: idx + 1,
                name: a.adset_name, // adset-level for Google
                type: campaignType,
                date: goLiveDate,
                live: isActive ? 'Live' : 'Paused',
                testPerf: testPerf,
                nextSteps: '',
                daysLive: daysLive,
                isMatured: isMatured,
                goLiveDateISO: goLiveDate || null,
                spent: Math.round(a.spend * 100) / 100,
                impressions: a.impressions,
                cpm: derived.cpm != null ? Math.round(derived.cpm * 100) / 100 : 0,
                clicks: a.clicks,
                ctr: derived.ctr != null ? Math.round(derived.ctr * 100) / 100 : 0,
                installs: a.conversions || 0,
                cpi: derived.cpi != null ? Math.round(derived.cpi * 100) / 100 : 0,
                signups: a.signups,
                signupCost: derived.signupCost != null ? Math.round(derived.signupCost * 100) / 100 : 0,
                signupPct: derived.signupPct != null ? Math.round(derived.signupPct * 100) / 100 : 0,
                p0p1: derived.p0p1,
                p0p1Pct: derived.p0p1Pct != null ? Math.round(derived.p0p1Pct * 100) / 100 : 0,
                p0p1Cost: derived.p0p1Cost != null ? Math.round(derived.p0p1Cost * 100) / 100 : 0,
                d0Trials: a.d0_trial,
                d0TrialCost: derived.d0TrialCost != null ? Math.round(derived.d0TrialCost * 100) / 100 : 0,
                d0: a.d0,
                d0CAC: derived.d0CAC != null ? Math.round(derived.d0CAC * 100) / 100 : 0,
                d6: derived.d6Con,
                d6CAC: derived.d6CAC != null ? Math.round(derived.d6CAC * 100) / 100 : 0,
                d6ROAS: Math.round(derived.d6ROAS * 100) / 100,
                d6OverallRevenue: Math.round(derived.d6Rev * 100) / 100,
                d15OverallRevenue: Math.round((a.d15_overall_revenue || 0) * 100) / 100,
                d15ROAS: Math.round(derived.d15ROAS * 100) / 100,
                d30OverallRevenue: Math.round((a.d30_overall_revenue || 0) * 100) / 100,
                d30ROAS: Math.round(derived.d30ROAS * 100) / 100,
                d60OverallRevenue: Math.round((a.d60_overall_revenue || 0) * 100) / 100,
                d60ROAS: Math.round(derived.d60ROAS * 100) / 100,
                overallRevenue: Math.round((a.overall_revenue || 0) * 100) / 100,
                overallROAS: Math.round(derived.overallROAS * 100) / 100,
                campaign_name: a.campaign_name,
                adset_name: a.adset_name,
                campaign_type: a.campaign_type,
                campaign_id: a.campaign_id,
                adset_id: a.adset_id,
                _source: 'api',
                _raw: raw,
                _dateRange: {
                    fetchFrom: dateFrom,
                    fetchTo: dateTo,
                    adFrom: goLiveDate && goLiveDate > dateFrom ? goLiveDate : dateFrom,
                    adTo: dateTo,
                    label: (goLiveDate && goLiveDate > dateFrom ? goLiveDate : dateFrom).slice(5) + ' → ' + dateTo.slice(5),
                },
            };
        });

        // Compute Week-over-Week trends
        computeWoWTrends(allData, googleRows, mbDaily, funnelRows);

        const matched = allData.filter(d => d.signups > 0 || d.d6 > 0).length;
        console.log(`[fetchLiveData] ${allData.length} adsets loaded (${matched} with funnel data).`);
        currentDataMode = summarizeMaturity(allData);
        currentDiagnostics = { source: 'Google + Metabase', matchedKeys: matched, unmatchedKeys: Math.max(0, allData.length - matched) };

        window.allData = allData;
        window.filteredData = filteredData;
        document.getElementById('gcLastUpdated').textContent = new Date().toLocaleTimeString();
        applyFilters();
        publishPortalContext();
        renderCurrentView();
        showLoading(false);
    } catch (err) {
        console.error('[fetchLiveData] Error:', err);
        showLoading(false);
        let errBanner = document.getElementById('gcFetchErrorBanner');
        if (!errBanner) {
            errBanner = document.createElement('div');
            errBanner.id = 'gcFetchErrorBanner';
            errBanner.style.cssText = 'position:fixed;top:0;left:220px;right:0;z-index:999;padding:12px 20px;background:#ef4444;color:#fff;font-size:13px;display:flex;align-items:center;gap:12px;';
            const main = document.querySelector('.main-content');
            if (main) main.prepend(errBanner);
            else document.body.prepend(errBanner);
        }
        errBanner.innerHTML = `<span style="flex:1;">Failed to load Google data: ${err.message}</span><button onclick="fetchLiveData();this.parentElement.remove();" style="padding:6px 16px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;border-radius:6px;cursor:pointer;font-size:12px;">Retry</button>`;
    }
}

// =========================================================================
// TYPE DETECTION — Google campaign types
// =========================================================================
function detectType(campaignName, channelType) {
    if (channelType === 'MULTI_CHANNEL' || channelType === 6) return 'UAC';
    if (channelType === 'SEARCH' || channelType === 2) return 'Search';
    if (channelType === 'PERFORMANCE_MAX' || channelType === 13) return 'PMax';
    if (channelType === 'VIDEO' || channelType === 6) return 'Video';
    if (channelType === 'DISPLAY' || channelType === 3) return 'Display';
    if (/UAC/i.test(campaignName)) return 'UAC';
    if (/PMax|pmax/i.test(campaignName)) return 'PMax';
    if (/search/i.test(campaignName)) return 'Search';
    if (/display/i.test(campaignName)) return 'Display';
    if (/video/i.test(campaignName)) return 'Video';
    return 'Other';
}

function getEvaluatedD6ROAS(adGroup) {
    if (!adGroup) return 0;
    if (adGroup.isMatured && adGroup._wow && adGroup._wow.maturedD6ROAS != null) {
        return adGroup._wow.maturedD6ROAS;
    }
    return adGroup.d6ROAS || 0;
}

function getD6RankingMode(adGroup) {
    if (!adGroup) return 'Full Data';
    if (adGroup.isMatured && adGroup._wow && adGroup._wow.maturedD6ROAS != null) return 'Mature Eval';
    if (adGroup.isMatured) return 'Mature Full';
    return 'Early Data';
}

function buildTopRoasRanking(data, { minSpend = 0 } = {}) {
    const candidates = [...data].filter(d => getEvaluatedD6ROAS(d) > 0 && d.spent > minSpend);
    const matured = candidates
        .filter(d => d.isMatured)
        .sort((a, b) => getEvaluatedD6ROAS(b) - getEvaluatedD6ROAS(a));
    const early = candidates
        .filter(d => !d.isMatured)
        .sort((a, b) => getEvaluatedD6ROAS(b) - getEvaluatedD6ROAS(a));

    return [...matured, ...early].slice(0, 5).map(d => ({
        ...d,
        _rankD6ROAS: getEvaluatedD6ROAS(d),
        _d6DataMode: getD6RankingMode(d),
    }));
}

// =========================================================================
// WEEK-OVER-WEEK TREND COMPUTATION
// =========================================================================
function computeWoWTrends(ads, googleRows, mbDaily, funnelRows) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
    const twoWeeksAgo = new Date(now - 14 * 86400000).toISOString().slice(0, 10);
    const threeWeeksAgo = new Date(now - 21 * 86400000).toISOString().slice(0, 10);

    const adWeekly = {};

    googleRows.forEach(row => {
        const adUid = (row.campaign_name || '') + '|||' + (row.adset_name || row.adgroup_name || '');
        if (!adWeekly[adUid]) {
            adWeekly[adUid] = {
                thisWeek: { spend: 0, installs: 0, signups: 0, d0_trial: 0, d6_overall_revenue: 0, overall_revenue: 0, d6_overall_con: 0 },
                lastWeek: { spend: 0, installs: 0, signups: 0, d0_trial: 0, d6_overall_revenue: 0, overall_revenue: 0, d6_overall_con: 0 },
                prevWeek: { spend: 0, installs: 0, signups: 0, d0_trial: 0, d6_overall_revenue: 0, overall_revenue: 0, d6_overall_con: 0 },
            };
        }
        const d = row.date_start || row.date || row.segments_date || '';
        let bucket = null;
        if (d >= weekAgo) bucket = adWeekly[adUid].thisWeek;
        else if (d >= twoWeeksAgo) bucket = adWeekly[adUid].lastWeek;
        else if (d >= threeWeeksAgo) bucket = adWeekly[adUid].prevWeek;
        if (!bucket) return;

        bucket.spend += (row.spend || row.cost_micros / 1000000 || 0) * 1.18;
        bucket.installs += row.conversions || 0;

        // Match to Metabase for funnel data (adset level)
        const mbKey = d + '|||' + (row.campaign_name || '') + '|||' + (row.adset_name || row.adgroup_name || '').toLowerCase().trim();
        const mb = mbDaily[mbKey];
        if (mb) {
            bucket.signups += mb.signups;
            bucket.d0_trial += mb.d0_trial;
            bucket.d6_overall_revenue += mb.d6_overall_revenue;
            bucket.overall_revenue += mb.overall_revenue;
            bucket.d6_overall_con += mb.d6_overall_con;
        }
    });

    function deriveWeekly(b) {
        const d = deriveMetrics(b);
        return {
            spend: b.spend,
            cpi: d.cpi,
            signupCost: d.signupCost,
            d0TrialCost: d.d0TrialCost,
            d6CAC: d.d6CAC,
            d6ROAS: _vR(b.spend, b.d6_overall_revenue),
            overallROAS: _vR(b.spend, b.overall_revenue),
            signups: b.signups,
            d0_trial: b.d0_trial,
            d6: b.d6_overall_con,
        };
    }

    function wowPct(curr, prev) {
        if (prev == null || prev === 0 || curr == null) return null;
        return ((curr - prev) / Math.abs(prev)) * 100;
    }

    ads.forEach(ad => {
        const adUid = (ad.campaign_name || '') + '|||' + (ad.name || '');
        const weekly = adWeekly[adUid];
        if (!weekly) {
            ad._wow = null;
            return;
        }

        const tw = deriveWeekly(weekly.thisWeek);
        const lw = deriveWeekly(weekly.lastWeek);
        const pw = deriveWeekly(weekly.prevWeek);

        const signupCost_wow = wowPct(tw.signupCost, lw.signupCost);
        const d0TrialCost_wow = wowPct(tw.d0TrialCost, lw.d0TrialCost);
        const cpi_wow = wowPct(tw.cpi, lw.cpi);
        const signupCost_wow2 = wowPct(lw.signupCost, pw.signupCost);
        const d0TrialCost_wow2 = wowPct(lw.d0TrialCost, pw.d0TrialCost);

        let maturedD6ROAS = null, maturedD6CAC = null;
        if (ad.isMatured) {
            const maturedSpend = weekly.lastWeek.spend + weekly.prevWeek.spend;
            const maturedD6Rev = weekly.lastWeek.d6_overall_revenue + weekly.prevWeek.d6_overall_revenue;
            const maturedD6Con = weekly.lastWeek.d6_overall_con + weekly.prevWeek.d6_overall_con;
            maturedD6ROAS = maturedSpend > 0 ? (maturedD6Rev / maturedSpend) * 100 : null;
            maturedD6CAC = maturedD6Con > 0 ? maturedSpend / maturedD6Con : null;
        }

        let trendBreaches = 0, trendHits = 0;
        if (signupCost_wow > 20) trendBreaches++;
        if (d0TrialCost_wow > 20) trendBreaches++;
        if (cpi_wow > 15) trendBreaches++;
        if (signupCost_wow > 20 && signupCost_wow2 > 20) trendBreaches++;
        if (d0TrialCost_wow > 20 && d0TrialCost_wow2 > 20) trendBreaches++;
        if (signupCost_wow < -15) trendHits++;
        if (d0TrialCost_wow < -15) trendHits++;
        if (cpi_wow < -10) trendHits++;

        const trendDirection = trendBreaches >= 2 ? 'declining' : trendHits >= 2 ? 'improving' : 'stable';

        ad._wow = {
            thisWeek: tw, lastWeek: lw, prevWeek: pw,
            signupCost_wow: signupCost_wow != null ? Math.round(signupCost_wow * 10) / 10 : null,
            d0TrialCost_wow: d0TrialCost_wow != null ? Math.round(d0TrialCost_wow * 10) / 10 : null,
            cpi_wow: cpi_wow != null ? Math.round(cpi_wow * 10) / 10 : null,
            signupCost_wow2: signupCost_wow2 != null ? Math.round(signupCost_wow2 * 10) / 10 : null,
            d0TrialCost_wow2: d0TrialCost_wow2 != null ? Math.round(d0TrialCost_wow2 * 10) / 10 : null,
            trendBreaches, trendHits, trendDirection,
            maturedD6ROAS: maturedD6ROAS != null ? Math.round(maturedD6ROAS * 100) / 100 : null,
            maturedD6CAC: maturedD6CAC != null ? Math.round(maturedD6CAC * 100) / 100 : null,
        };
    });

    const withTrends = ads.filter(d => d._wow && d._wow.trendDirection !== 'stable').length;
    console.log(`[WoW] Computed trends for ${ads.length} adsets. ${withTrends} with non-stable trends.`);
}

// =========================================================================
// HELPERS
// =========================================================================
function formatINR(n) {
    if (n >= 10000000) return '\u20B9' + (n / 10000000).toFixed(1) + 'Cr';
    if (n >= 100000) return '\u20B9' + (n / 100000).toFixed(1) + 'L';
    if (n >= 1000) return '\u20B9' + (n / 1000).toFixed(1) + 'K';
    return '\u20B9' + Math.round(n);
}

function formatNum(n) {
    if (n >= 10000000) return (n / 10000000).toFixed(1) + 'Cr';
    if (n >= 100000) return (n / 100000).toFixed(1) + 'L';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return Math.round(n).toLocaleString();
}

function shortName(name) {
    return (name || '').replace(/^GA_/i, '').replace(/_/g, ' ');
}

function parseDate(str) {
    if (!str) return 0;
    const parts = str.split('/');
    if (parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
    return new Date(str).getTime() || 0;
}

function cpiColor(v) {
    if (!v) return 'var(--text-dim)';
    return v < 300 ? 'var(--green)' : v < 500 ? 'var(--blue)' : v < 800 ? 'var(--orange)' : 'var(--red)';
}

function roasColor(v) {
    if (!v) return 'var(--text-dim)';
    return v > 50 ? 'var(--green)' : v > 25 ? 'var(--blue)' : v > 10 ? 'var(--orange)' : 'var(--red)';
}

function perfBadge(perf) {
    if (!perf) return '<span style="color:var(--text-muted)">-</span>';
    const cls = {
        Exceptional: 'badge-exceptional', Performed: 'badge-performed',
        Try: 'badge-try', Failed: 'badge-failed', Drop: 'badge-drop'
    };
    return `<span class="cc-badge ${cls[perf] || ''}">${perf}</span>`;
}

function typeBadge(type) {
    const colors = {
        'UAC': 'badge-video',
        'Search': 'badge-static',
        'PMax': 'badge-video',
        'Video': 'badge-video',
        'Display': 'badge-static',
        'Other': ''
    };
    return `<span class="cc-badge ${colors[type] || ''}">${type || '-'}</span>`;
}

function showLoading(show) {
    const el = document.getElementById('gcLoadingOverlay');
    if (el) el.classList.toggle('hidden', !show);
}

function cur(v) { return '\u20B9' + Math.round(v).toLocaleString('en-IN'); }
function curK(v) { return v >= 100000 ? '\u20B9' + (v/100000).toFixed(1) + 'L' : v >= 1000 ? '\u20B9' + (v/1000).toFixed(1) + 'K' : '\u20B9' + Math.round(v); }
function num(v) { return v.toLocaleString('en-IN'); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// =========================================================================
// FILTERS
// =========================================================================
function applyFilters() {
    const search = document.getElementById('gcSearchInput').value.toLowerCase();
    const type = document.getElementById('gcTypeFilter').value;
    const status = document.getElementById('gcStatusFilter').value;
    const perf = document.getElementById('gcPerfFilter').value;

    filteredData = allData.filter(d => {
        if (search && !d.name.toLowerCase().includes(search) && !(d.campaign_name || '').toLowerCase().includes(search)) return false;
        if (type !== 'all' && d.type !== type) return false;
        if (status !== 'all' && d.live !== status) return false;
        if (perf !== 'all' && d.testPerf !== perf) return false;
        return true;
    });
    window.allData = allData;
    window.filteredData = filteredData;
}

// =========================================================================
// NAVIGATION
// =========================================================================
const views = {
    gcDashboard: { title: 'Dashboard', subtitle: 'Overview of all Google ad groups' },
    gcCreatives: { title: 'All Ad Groups', subtitle: 'Complete ad group database' },
    gcNew: { title: 'New This Week', subtitle: 'Recently launched ad groups' },
    gcTop: { title: 'Top Performers', subtitle: 'Best performing ad groups by key metrics' },
    gcFailures: { title: 'Underperformers', subtitle: 'Ad groups that need attention or removal' },
    gcScorecard: { title: 'Scorecard', subtitle: 'Detailed performance scorecard per ad group' },
    gcAlerts: { title: 'Alerts', subtitle: 'Live alerts based on performance thresholds' },
    gcAccounts: { title: 'Accounts', subtitle: 'Manage connected Google Ads accounts' },
    gcCampaignTree: { title: 'Campaign Tree', subtitle: 'Hierarchical campaign \u2192 adset analysis with alerts' },
    gcIntelligence: { title: 'AI Intelligence', subtitle: 'AI-powered analysis of Google Ads performance' },
    gcSimulator: { title: 'ROAS Simulator', subtitle: 'Predict performance of new campaigns before launch' },
    gcRecommendations: { title: 'Recommendations', subtitle: 'AI-generated optimization recommendations' },
    gcOptimizer: { title: 'Campaign Optimizer', subtitle: 'AI-generated optimization plan with one-click execution' },
    gcAudienceTesting: { title: 'Audience Testing', subtitle: 'Audience performance analysis, pattern learning & AI recommendations' }
};

function setActiveView(view) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const viewEl = document.getElementById(view + 'View');
    if (viewEl) viewEl.classList.add('active');
    document.getElementById('gcPageTitle').textContent = views[view] ? views[view].title : '';
    document.getElementById('gcPageSubtitle').textContent = views[view] ? views[view].subtitle : '';
    publishPortalContext();
    renderCurrentView();
    const tabMap = { gcSimulator: 'simulator', gcIntelligence: 'intelligence', gcRecommendations: 'recommendations', gcAudienceTesting: 'audienceTesting' };
    if (tabMap[view]) {
        document.dispatchEvent(new CustomEvent('gc-tab-activated', { detail: { tab: tabMap[view] } }));
    }
}

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        setActiveView(item.dataset.view);
    });
});

function getCurrentView() {
    const active = document.querySelector('.nav-item.active');
    return active ? active.dataset.view : 'gcDashboard';
}

function renderCurrentView() {
    applyFilters();
    const view = getCurrentView();
    if (view === 'gcDashboard') renderDashboard();
    else if (view === 'gcCreatives') renderTable();
    else if (view === 'gcNew') renderNew();
    else if (view === 'gcTop') renderTop();
    else if (view === 'gcFailures') renderFailures();
    else if (view === 'gcScorecard') renderScorecardView();
    else if (view === 'gcAlerts') renderAlertsPage();
    else if (view === 'gcAccounts') renderAccountsView();
    else if (view === 'gcCampaignTree') { /* rendered on-demand */ }
    else if (view === 'gcOptimizer') { if (typeof renderGcOptimizer === 'function') renderGcOptimizer(); }
    publishPortalContext();
}

function applyEmbeddedMode() {
    if (GC_EMBED_MODE !== 'optimizer') return;
    const sidebar = document.querySelector('.sidebar');
    const header = document.querySelector('.top-header');
    const assistant = document.getElementById('gcViewAssistantPanel');
    const main = document.querySelector('.main-content');
    if (sidebar) sidebar.style.display = 'none';
    if (header) header.style.display = 'none';
    if (assistant) assistant.style.display = 'none';
    if (main) {
        main.style.padding = '0';
        main.style.overflow = 'auto';
    }
    document.body.style.overflow = 'auto';
}

// =========================================================================
// DASHBOARD
// =========================================================================
function renderDashboard() {
    const data = filteredData;
    const totalSpend = data.reduce((s, d) => s + d.spent, 0);
    const totalInstalls = data.reduce((s, d) => s + d.installs, 0);
    const totalSignups = data.reduce((s, d) => s + d.signups, 0);
    const liveCount = data.filter(d => d.live === 'Live').length;
    // Sum raw metrics first, then derive all ratios from totals (not averages of per-ad ratios)
    const rawAds = data.filter(d => d._raw).map(d => d._raw);
    const totals = rawAds.length > 0 ? deriveMetrics(sumRaw(rawAds)) : {};
    const avgCPI = totals.cpi || 0;
    const avgCTR = totals.ctr || 0;
    const avgROAS = totals.d6ROAS || 0;
    const avgOverallROAS = totals.overallROAS || 0;
    const avgSignupCost = totals.signupCost || 0;
    const avgP0P1Cost = totals.p0p1Cost || 0;
    const avgD0CAC = totals.d0CAC || 0;
    const avgD0TrialCost = totals.d0TrialCost || 0;
    const avgD6CAC = totals.d6CAC || 0;

    // Type counts for Google
    const typeCounts = {};
    data.forEach(d => { typeCounts[d.type] = (typeCounts[d.type] || 0) + 1; });
    const typeStr = Object.entries(typeCounts).map(([k, v]) => `${v} ${k}`).join(', ');

    const el = (id) => document.getElementById(id);

    el('gcKpiTotal').textContent = data.length;
    el('gcKpiTotalSub').textContent = typeStr || 'No data';
    el('gcKpiLive').textContent = liveCount;
    el('gcKpiLiveSub').textContent = `${data.length - liveCount} paused`;
    el('gcKpiSpend').textContent = formatINR(totalSpend);
    el('gcKpiSpendSub').textContent = `Avg ${formatINR(totalSpend / (data.length || 1))} per ad group`;
    el('gcKpiInstalls').textContent = formatNum(totalInstalls);
    el('gcKpiInstallsSub').textContent = `${formatNum(totalSignups)} signups`;
    el('gcKpiCPI').textContent = '\u20B9' + Math.round(avgCPI);
    el('gcKpiCPISub').textContent = `Across ${rawAds.length} ad groups`;
    el('gcKpiCTR').textContent = avgCTR.toFixed(2) + '%';
    el('gcKpiCTRSub').textContent = `Across ${rawAds.length} ad groups`;
    el('gcKpiSignups').textContent = formatNum(totalSignups);
    el('gcKpiSignupsSub').textContent = `${totalInstalls ? ((totalSignups / totalInstalls) * 100).toFixed(1) : 0}% of conversions`;
    el('gcKpiROAS').textContent = avgROAS.toFixed(1) + '%';
    el('gcKpiROASSub').textContent = `Across ${rawAds.length} ad groups`;
    el('gcKpiOverallROAS').textContent = avgOverallROAS.toFixed(1) + '%';
    el('gcKpiOverallROASSub').textContent = `Across ${rawAds.length} ad groups`;
    el('gcKpiSignupCost').textContent = '\u20B9' + Math.round(avgSignupCost);
    el('gcKpiSignupCostSub').textContent = `Across ${rawAds.length} ad groups`;
    el('gcKpiP0P1Cost').textContent = '\u20B9' + Math.round(avgP0P1Cost);
    el('gcKpiP0P1CostSub').textContent = `Across ${rawAds.length} ad groups`;
    el('gcKpiD0CAC').textContent = '\u20B9' + Math.round(avgD0CAC);
    el('gcKpiD0CACSub').textContent = `Across ${rawAds.length} ad groups`;
    el('gcKpiD0TrialCost').textContent = '\u20B9' + Math.round(avgD0TrialCost);
    el('gcKpiD0TrialCostSub').textContent = `Across ${rawAds.length} ad groups`;
    el('gcKpiD6CAC').textContent = '\u20B9' + Math.round(avgD6CAC);
    el('gcKpiD6CACSub').textContent = `Across ${rawAds.length} ad groups`;

    // Performance distribution
    const perfCounts = {};
    ['Exceptional', 'Performed', 'Try', 'Failed', 'Drop', ''].forEach(p => {
        perfCounts[p || 'Untagged'] = data.filter(d => (d.testPerf || 'Untagged') === (p || 'Untagged')).length;
    });
    const perfColors = { Exceptional: 'var(--green)', Performed: 'var(--blue)', Try: 'var(--orange)', Failed: 'var(--red)', Drop: '#f87171', Untagged: 'var(--text-muted)' };
    const maxPerf = Math.max(...Object.values(perfCounts), 1);
    el('gcPerfDistribution').innerHTML = `<div class="bar-chart">${
        Object.entries(perfCounts).map(([k, v]) => `
            <div class="bar-row">
                <span class="bar-label">${k}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${(v / maxPerf) * 100}%;background:${perfColors[k]}">${v}</div></div>
                <span class="bar-count">${v}</span>
            </div>
        `).join('')
    }</div>`;

    // Type split (Google campaign types)
    const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const typeColors = { 'UAC': 'var(--accent)', 'Search': 'var(--orange)', 'PMax': 'var(--green)', 'Video': 'var(--blue)', 'Display': 'var(--teal)', 'Other': 'var(--text-muted)' };
    el('gcTypeSplit').innerHTML = `<div class="bar-chart">
        ${typeEntries.map(([type, count]) => `
            <div class="bar-row"><span class="bar-label">${type}</span><div class="bar-track"><div class="bar-fill" style="width:${(count / (data.length || 1)) * 100}%;background:${typeColors[type] || 'var(--text-muted)'}">${count}</div></div><span class="bar-count">${((count / (data.length || 1)) * 100).toFixed(0)}%</span></div>
        `).join('')}
    </div>`;

    // Top 5 ROAS
    const topROAS = buildTopRoasRanking(data, { minSpend: 15000 });
    el('gcTopROAS').innerHTML = topROAS.map((d, i) => `
        <div class="rank-item">
            <span class="rank-num">#${i + 1}</span>
            <div class="rank-info">
                <div class="rank-name">${shortName(d.name)}</div>
                <div class="rank-meta">${d.type} | Spend: ${formatINR(d.spent)} | ${d._d6DataMode}</div>
            </div>
            <span class="rank-value">${d._rankD6ROAS.toFixed(0)}%</span>
        </div>
    `).join('') || '<p style="color:var(--text-dim);">No ROAS data yet.</p>';

    // Top 5 CPI
    const topCPI = [...data].filter(d => d.cpi > 0 && d.installs >= 10).sort((a, b) => a.cpi - b.cpi).slice(0, 5);
    el('gcTopCPI').innerHTML = topCPI.map((d, i) => `
        <div class="rank-item">
            <span class="rank-num">#${i + 1}</span>
            <div class="rank-info">
                <div class="rank-name">${shortName(d.name)}</div>
                <div class="rank-meta">${d.type} | Conversions: ${formatNum(d.installs)}</div>
            </div>
            <span class="rank-value" style="color:var(--teal)">\u20B9${Math.round(d.cpi)}</span>
        </div>
    `).join('') || '<p style="color:var(--text-dim);">No CPI data yet.</p>';

    // Recent table
    const recent = [...data].sort((a, b) => parseDate(b.date) - parseDate(a.date)).slice(0, 10);
    el('gcRecentTable').innerHTML = `
        <table>
            <thead><tr>
                <th>Ad Group</th><th>Type</th><th>Date</th><th>Spend</th><th>CTR</th><th>CPI</th><th>Signups</th><th>D6 ROAS</th><th>Signup Cost</th><th>D0 Trial Cost</th><th>Status</th>
            </tr></thead>
            <tbody>${recent.map(d => `<tr>
                <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis">${shortName(d.name)}</td>
                <td>${typeBadge(d.type)}</td>
                <td>${d.date || '-'}</td>
                <td>${formatINR(d.spent)}</td>
                <td>${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</td>
                <td>${d.cpi ? '\u20B9' + Math.round(d.cpi) : '-'}</td>
                <td>${d.signups || 0}</td>
                <td style="color:${d.d6ROAS > 25 ? 'var(--green)' : d.d6ROAS > 10 ? 'var(--orange)' : 'var(--red)'}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</td>
                <td>${d.signupCost ? '\u20B9' + Math.round(d.signupCost) : '-'}</td>
                <td>${d.d0TrialCost ? '\u20B9' + Math.round(d.d0TrialCost) : '-'}</td>
                <td>${perfBadge(d.testPerf)}</td>
            </tr>`).join('')}</tbody>
        </table>
    `;

    // Render alerts section
    renderAlerts();

    // Render live dashboard
    renderLiveDashboard();
}

// =========================================================================
// ALERT CLASSIFICATION
// =========================================================================
function classifyAlert(d) {
    if (d.spent < 15000) return 'neutral';

    const wow = d._wow || {};
    let trendBreaches = wow.trendBreaches || 0;
    let trendHits = wow.trendHits || 0;

    if (!d.isMatured) {
        if (d.d6ROAS > 28) return 'green';
        let earlyBreaches = trendBreaches;
        if (d.signupCost > 1000) earlyBreaches++;
        if (d.d0TrialCost > 3500) earlyBreaches++;
        if (d.cpi > 200) earlyBreaches++;
        if (d.installs > 50 && d.signups === 0) earlyBreaches++;
        if (earlyBreaches >= 2) return 'red';
        let earlyHits = trendHits;
        if (d.signupCost > 0 && d.signupCost < 500) earlyHits++;
        if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) earlyHits++;
        if (d.cpi > 0 && d.cpi < 100) earlyHits++;
        if (earlyHits >= 2) return 'green';
        return 'neutral';
    }

    const d6ROAS = (wow.maturedD6ROAS != null) ? wow.maturedD6ROAS : d.d6ROAS;
    const d6CAC = (wow.maturedD6CAC != null) ? wow.maturedD6CAC : d.d6CAC;

    if (d6ROAS > 28) return 'green';
    let breaches = trendBreaches;
    if (d.signupCost > 1000) breaches++;
    if (d.d0TrialCost > 3500) breaches++;
    if (d6CAC > 15000) breaches++;
    if (breaches >= 2) return 'red';
    let hits = trendHits;
    if (d.signupCost > 0 && d.signupCost < 500) hits++;
    if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) hits++;
    if (d6CAC > 0 && d6CAC < 12000) hits++;
    if (hits >= 2) return 'green';
    return 'neutral';
}

function classifyAlerts(items) {
    const eligible = items.filter(d => d.spent >= 15000);
    const redAlerts = eligible.filter(d => classifyAlert(d) === 'red');
    const greenAlerts = eligible.filter(d => classifyAlert(d) === 'green');
    return { redAlerts, greenAlerts };
}

function getAlertReasons(d, type) {
    const reasons = [];
    const matLabel = d.isMatured ? ' (matured)' : ' (early)';
    if (type === 'red') {
        if (!d.isMatured) {
            if (d.signupCost > 1000) reasons.push(`Signup Cost: \u20B9${Math.round(d.signupCost)} (> \u20B91,000)`);
            if (d.d0TrialCost > 3500) reasons.push(`D0 Trial Cost: \u20B9${Math.round(d.d0TrialCost)} (> \u20B93,500)`);
            if (d.cpi > 200) reasons.push(`CPI: \u20B9${Math.round(d.cpi)} (> \u20B9200)`);
            if (d.installs > 50 && d.signups === 0) reasons.push(`${d.installs} conversions but 0 signups`);
        } else {
            if (d.signupCost > 1000) reasons.push(`Signup Cost: \u20B9${Math.round(d.signupCost)} (> \u20B91,000)`);
            if (d.d0TrialCost > 3500) reasons.push(`D0 Trial Cost: \u20B9${Math.round(d.d0TrialCost)} (> \u20B93,500)`);
            if (d.d6CAC > 15000) reasons.push(`D6 CAC: \u20B9${Math.round(d.d6CAC)} (> \u20B915,000)${matLabel}`);
            if (d.d6ROAS <= 28 && d.d6ROAS > 0) reasons.push(`D6 ROAS: ${d.d6ROAS.toFixed(1)}% (< 28%)${matLabel}`);
        }
    } else {
        if (!d.isMatured) {
            if (d.signupCost > 0 && d.signupCost < 500) reasons.push(`Signup Cost: \u20B9${Math.round(d.signupCost)} (< \u20B9500)`);
            if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) reasons.push(`D0 Trial Cost: \u20B9${Math.round(d.d0TrialCost)} (< \u20B92,500)`);
            if (d.cpi > 0 && d.cpi < 100) reasons.push(`CPI: \u20B9${Math.round(d.cpi)} (< \u20B9100)`);
        } else {
            if (d.d6ROAS > 28) reasons.push(`D6 ROAS: ${d.d6ROAS.toFixed(1)}% (> 28%)${matLabel}`);
            if (d.signupCost > 0 && d.signupCost < 500) reasons.push(`Signup Cost: \u20B9${Math.round(d.signupCost)} (< \u20B9500)`);
            if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) reasons.push(`D0 Trial Cost: \u20B9${Math.round(d.d0TrialCost)} (< \u20B92,500)`);
            if (d.d6CAC > 0 && d.d6CAC < 12000) reasons.push(`D6 CAC: \u20B9${Math.round(d.d6CAC)} (< \u20B912,000)${matLabel}`);
        }
    }
    if (d.daysLive != null) reasons.push(`Days live: ${d.daysLive}${d.isMatured ? ' (matured)' : ' (not matured)'}`);
    const wow = d._wow;
    if (wow) {
        if (wow.trendDirection === 'declining') {
            reasons.push('\u2193 WoW DECLINING trend');
            if (wow.signupCost_wow > 20) reasons.push(`SU Cost \u2191${wow.signupCost_wow.toFixed(0)}% WoW`);
            if (wow.d0TrialCost_wow > 20) reasons.push(`D0 Trial Cost \u2191${wow.d0TrialCost_wow.toFixed(0)}% WoW`);
            if (wow.cpi_wow > 15) reasons.push(`CPI \u2191${wow.cpi_wow.toFixed(0)}% WoW`);
        } else if (wow.trendDirection === 'improving') {
            reasons.push('\u2191 WoW IMPROVING trend');
            if (wow.signupCost_wow < -15) reasons.push(`SU Cost \u2193${Math.abs(wow.signupCost_wow).toFixed(0)}% WoW`);
            if (wow.d0TrialCost_wow < -15) reasons.push(`D0 Trial Cost \u2193${Math.abs(wow.d0TrialCost_wow).toFixed(0)}% WoW`);
        }
        if (wow.maturedD6ROAS != null && d.isMatured) reasons.push(`Matured D6 ROAS (excl this week): ${wow.maturedD6ROAS.toFixed(1)}%`);
    }
    return reasons;
}

// =========================================================================
// ALERTS RENDERING (Dashboard section)
// =========================================================================
function renderAlerts() {
    const live = filteredData.filter(d => d.live === 'Live');
    const { redAlerts, greenAlerts } = classifyAlerts(live);

    const alertsContainer = document.getElementById('gcAlertsSection');
    if (!alertsContainer) return;

    let html = '';

    html += `<div class="alerts-panel alerts-red">
        <div class="alerts-header">
            <span class="alerts-icon">&#9888;</span>
            <h3>Red Alerts</h3>
            <span class="alerts-count">${redAlerts.length}</span>
        </div>
        <div class="alerts-body">`;

    if (redAlerts.length) {
        html += redAlerts.map(d => {
            const reasons = getAlertReasons(d, 'red');
            return `<div class="alert-item alert-item-red">
                <div class="alert-name">${shortName(d.name)}</div>
                <div class="alert-reasons">${reasons.join(' | ')}</div>
                <div class="alert-extra">${d.type} | Spend: ${formatINR(d.spent)} | D6 ROAS: ${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'} | ${d.isMatured ? 'Matured' : d.daysLive + 'd'}</div>
                <div style="font-size:10px;color:#888;margin-top:2px;">Data: ${d._dateRange ? d._dateRange.label : '-'}</div>
            </div>`;
        }).join('');
    } else {
        html += '<p class="alerts-empty">No red alerts. All live ad groups within thresholds.</p>';
    }
    html += `</div></div>`;

    html += `<div class="alerts-panel alerts-green">
        <div class="alerts-header">
            <span class="alerts-icon">&#10004;</span>
            <h3>Green Alerts</h3>
            <span class="alerts-count">${greenAlerts.length}</span>
        </div>
        <div class="alerts-body">`;

    if (greenAlerts.length) {
        html += greenAlerts.map(d => {
            const reasons = getAlertReasons(d, 'green');
            return `<div class="alert-item alert-item-green">
                <div class="alert-name">${shortName(d.name)}</div>
                <div class="alert-reasons">${reasons.join(' | ')}</div>
                <div class="alert-extra">${d.type} | Spend: ${formatINR(d.spent)} | D6 ROAS: ${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'} | ${d.isMatured ? 'Matured' : d.daysLive + 'd'}</div>
                <div style="font-size:10px;color:#888;margin-top:2px;">Data: ${d._dateRange ? d._dateRange.label : '-'}</div>
            </div>`;
        }).join('');
    } else {
        html += '<p class="alerts-empty">No green alerts among live ad groups.</p>';
    }
    html += `</div></div>`;

    alertsContainer.innerHTML = html;
}

// =========================================================================
// ALERTS PAGE (full page view)
// =========================================================================
function renderAlertsPage() {
    const live = filteredData.filter(d => d.live === 'Live');
    const { redAlerts, greenAlerts } = classifyAlerts(live);

    const container = document.getElementById('gcAlertsPageContent');
    if (!container) return;

    function alertMetricsRow(d) {
        return `<div class="alert-metrics">
            <div class="alert-metric"><span class="alert-metric-label">Spend</span><span class="alert-metric-value">${formatINR(d.spent)}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">CPI</span><span class="alert-metric-value" style="color:${cpiColor(d.cpi)}">${d.cpi ? '\u20B9' + Math.round(d.cpi) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">CTR</span><span class="alert-metric-value">${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Conversions</span><span class="alert-metric-value">${d.installs || '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Signups</span><span class="alert-metric-value">${d.signups || '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Signup Cost</span><span class="alert-metric-value">${d.signupCost ? '\u20B9' + Math.round(d.signupCost) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Signup%</span><span class="alert-metric-value">${d.signupPct ? d.signupPct.toFixed(1) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">P0P1 Cost</span><span class="alert-metric-value">${d.p0p1Cost ? '\u20B9' + Math.round(d.p0p1Cost) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">D0 Trial Cost</span><span class="alert-metric-value">${d.d0TrialCost ? '\u20B9' + Math.round(d.d0TrialCost) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">D0 CAC</span><span class="alert-metric-value">${d.d0CAC ? '\u20B9' + Math.round(d.d0CAC) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">D6 CAC</span><span class="alert-metric-value">${d.d6CAC ? '\u20B9' + Math.round(d.d6CAC) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">D6 ROAS</span><span class="alert-metric-value" style="color:${roasColor(d.d6ROAS)}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Overall ROAS</span><span class="alert-metric-value" style="color:${roasColor(d.overallROAS)}">${d.overallROAS ? d.overallROAS.toFixed(1) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Perf.</span><span class="alert-metric-value">${perfBadge(d.testPerf)}</span></div>
        </div>`;
    }

    let html = '';

    html += `<div class="alerts-page-panel alerts-red">
        <div class="alerts-header">
            <span class="alerts-icon">&#9888;</span>
            <h3>Red Alerts</h3>
            <span class="alerts-count">${redAlerts.length}</span>
        </div>
        <div class="alerts-page-body">`;

    if (redAlerts.length) {
        html += redAlerts.map(d => {
            const reasons = getAlertReasons(d, 'red');
            return `<div class="alert-page-item alert-item-red">
                <div class="alert-page-top">
                    <div>
                        <div class="alert-name">${shortName(d.name)}</div>
                        <div class="alert-reasons">${reasons.join(' | ')}</div>
                        <div style="font-size:10px;color:#888;margin-top:2px;">Data: ${d._dateRange ? d._dateRange.label : '-'} | ${d.isMatured ? 'Matured (' + d.daysLive + 'd)' : d.daysLive + 'd (not matured)'}</div>
                    </div>
                    <div style="display:flex;gap:4px;align-items:center;">
                        ${typeBadge(d.type)}
                    </div>
                </div>
                ${alertMetricsRow(d)}
            </div>`;
        }).join('');
    } else {
        html += '<p class="alerts-empty">No red alerts. All live ad groups within thresholds.</p>';
    }
    html += `</div></div>`;

    html += `<div class="alerts-page-panel alerts-green">
        <div class="alerts-header">
            <span class="alerts-icon">&#10004;</span>
            <h3>Green Alerts</h3>
            <span class="alerts-count">${greenAlerts.length}</span>
        </div>
        <div class="alerts-page-body">`;

    if (greenAlerts.length) {
        html += greenAlerts.map(d => {
            const reasons = getAlertReasons(d, 'green');
            return `<div class="alert-page-item alert-item-green">
                <div class="alert-page-top">
                    <div>
                        <div class="alert-name">${shortName(d.name)}</div>
                        <div class="alert-reasons">${reasons.join(' | ')}</div>
                        <div style="font-size:10px;color:#888;margin-top:2px;">Data: ${d._dateRange ? d._dateRange.label : '-'} | ${d.isMatured ? 'Matured (' + d.daysLive + 'd)' : d.daysLive + 'd (not matured)'}</div>
                    </div>
                    <div style="display:flex;gap:4px;align-items:center;">
                        ${typeBadge(d.type)}
                    </div>
                </div>
                ${alertMetricsRow(d)}
            </div>`;
        }).join('');
    } else {
        html += '<p class="alerts-empty">No green alerts among live ad groups.</p>';
    }
    html += `</div></div>`;

    container.innerHTML = html;
}

// =========================================================================
// LIVE DASHBOARD (sub-section of dashboard)
// =========================================================================
function renderLiveDashboard() {
    const live = filteredData.filter(d => d.live === 'Live');

    // Sum raw metrics first, then derive all ratios from totals
    const liveRawAds = live.filter(d => d._raw).map(d => d._raw);
    const liveTotals = liveRawAds.length > 0 ? deriveMetrics(sumRaw(liveRawAds)) : {};
    const liveSpend = liveTotals.spend || 0;
    const liveInstalls = liveTotals.installs || 0;
    const liveSignups = liveTotals.signups || 0;
    const avgLiveCPI = liveTotals.cpi || 0;
    const avgLiveCTR = liveTotals.ctr || 0;
    const avgLiveROAS = liveTotals.d6ROAS || 0;

    const el = (id) => document.getElementById(id);

    const typeCounts = {};
    live.forEach(d => { typeCounts[d.type] = (typeCounts[d.type] || 0) + 1; });
    const typeStr = Object.entries(typeCounts).map(([k, v]) => `${v} ${k}`).join(', ');

    el('gcLiveKpiCount').textContent = live.length;
    el('gcLiveKpiCountSub').textContent = typeStr || 'No live ad groups';
    el('gcLiveKpiSpend').textContent = formatINR(liveSpend);
    el('gcLiveKpiSpendSub').textContent = `Avg ${formatINR(liveSpend / (live.length || 1))} per ad group`;
    el('gcLiveKpiInstalls').textContent = formatNum(liveInstalls);
    el('gcLiveKpiInstallsSub').textContent = `${formatNum(liveSignups)} signups`;
    el('gcLiveKpiCPI').textContent = avgLiveCPI ? '\u20B9' + Math.round(avgLiveCPI) : '--';
    el('gcLiveKpiCPISub').textContent = `Across ${liveRawAds.length} ad groups`;
    el('gcLiveKpiCTR').textContent = avgLiveCTR ? avgLiveCTR.toFixed(2) + '%' : '--';
    el('gcLiveKpiCTRSub').textContent = `Across ${liveRawAds.length} ad groups`;
    el('gcLiveKpiSignups').textContent = formatNum(liveSignups);
    el('gcLiveKpiSignupsSub').textContent = liveInstalls ? `${((liveSignups / liveInstalls) * 100).toFixed(1)}% of conversions` : '';
    el('gcLiveKpiROAS').textContent = avgLiveROAS ? avgLiveROAS.toFixed(1) + '%' : '--';
    el('gcLiveKpiROASSub').textContent = `Across ${liveRawAds.length} ad groups`;

    // Live table
    el('gcLiveCreativesTable').innerHTML = live.length ? `
        <table>
            <thead><tr>
                <th>#</th><th>Ad Group</th><th>Type</th><th>Date</th><th>Spend</th><th>CTR</th><th>CPI</th><th>Conversions</th><th>Signups</th><th>Signup%</th><th>D6 ROAS</th><th>Overall ROAS</th><th>Signup Cost</th><th>P0P1 Cost</th><th>D0 Trial Cost</th><th>D0 CAC</th><th>D6 CAC</th><th>Perf.</th>
            </tr></thead>
            <tbody>${live.map((d, i) => `<tr>
                <td>${i + 1}</td>
                <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${d.name}">${shortName(d.name)}</td>
                <td>${typeBadge(d.type)}</td>
                <td>${d.date || '-'}</td>
                <td>${formatINR(d.spent)}</td>
                <td>${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</td>
                <td style="color:${cpiColor(d.cpi)}">${d.cpi ? '\u20B9' + Math.round(d.cpi) : '-'}</td>
                <td>${d.installs || '-'}</td>
                <td>${d.signups || '-'}</td>
                <td>${d.signupPct ? d.signupPct.toFixed(1) + '%' : '-'}</td>
                <td style="color:${roasColor(d.d6ROAS)}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</td>
                <td style="color:${roasColor(d.overallROAS)}">${d.overallROAS ? d.overallROAS.toFixed(1) + '%' : '-'}</td>
                <td>${d.signupCost ? '\u20B9' + Math.round(d.signupCost) : '-'}</td>
                <td>${d.p0p1Cost ? '\u20B9' + Math.round(d.p0p1Cost) : '-'}</td>
                <td>${d.d0TrialCost ? '\u20B9' + Math.round(d.d0TrialCost) : '-'}</td>
                <td>${d.d0CAC ? '\u20B9' + Math.round(d.d0CAC) : '-'}</td>
                <td>${d.d6CAC ? '\u20B9' + Math.round(d.d6CAC) : '-'}</td>
                <td>${perfBadge(d.testPerf)}</td>
            </tr>`).join('')}</tbody>
        </table>
    ` : '<p style="color:var(--text-dim);padding:20px;">No live ad groups found.</p>';

    // Live top ROAS
    const liveTopROAS = buildTopRoasRanking(live);
    el('gcLiveTopROAS').innerHTML = liveTopROAS.length ? liveTopROAS.map((d, i) => `
        <div class="rank-item">
            <span class="rank-num">#${i + 1}</span>
            <div class="rank-info">
                <div class="rank-name">${shortName(d.name)}</div>
                <div class="rank-meta">${d.type} | Spend: ${formatINR(d.spent)} | ${d._d6DataMode}</div>
            </div>
            <span class="rank-value">${d._rankD6ROAS.toFixed(0)}%</span>
        </div>
    `).join('') : '<p style="color:var(--text-dim);">No ROAS data yet.</p>';

    // Live top CPI
    const liveTopCPI = [...live].filter(d => d.cpi > 0 && d.installs >= 5).sort((a, b) => a.cpi - b.cpi).slice(0, 5);
    el('gcLiveTopCPI').innerHTML = liveTopCPI.length ? liveTopCPI.map((d, i) => `
        <div class="rank-item">
            <span class="rank-num">#${i + 1}</span>
            <div class="rank-info">
                <div class="rank-name">${shortName(d.name)}</div>
                <div class="rank-meta">${d.type} | Conversions: ${formatNum(d.installs)}</div>
            </div>
            <span class="rank-value" style="color:var(--teal)">\u20B9${Math.round(d.cpi)}</span>
        </div>
    `).join('') : '<p style="color:var(--text-dim);">No CPI data yet.</p>';
}

// =========================================================================
// ALL AD GROUPS TABLE
// =========================================================================
function renderTable() {
    const data = filteredData;
    const el = (id) => document.getElementById(id);
    el('gcTableCount').textContent = `${data.length} ad groups`;
    const thead = document.querySelector('#gcCreativesTable thead');
    const tbody = document.querySelector('#gcCreativesTable tbody');
    const cols = ['#', 'Ad Group', 'Campaign', 'Type', 'Date', 'Days', 'Spend', 'Impr.', 'CPM', 'CTR', 'Conversions', 'CPI', 'Signups', 'Signup%', 'D6 ROAS', 'Overall ROAS', 'Signup Cost', 'P0P1 Cost', 'D0 Trial Cost', 'D0 CAC', 'D6 CAC', 'Status', 'Perf.', 'Data Range'];
    thead.innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`;
    tbody.innerHTML = data.map((d, i) => `<tr>
        <td>${i + 1}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${d.name}">${shortName(d.name)}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;font-size:11px;color:#888;" title="${d.campaign_name}">${shortName(d.campaign_name)}</td>
        <td>${typeBadge(d.type)}</td>
        <td>${d.date || '-'}</td>
        <td>${d.daysLive || '-'}${d.isMatured ? ' \u2713' : ''}</td>
        <td>${formatINR(d.spent)}</td>
        <td>${formatNum(d.impressions)}</td>
        <td>${d.cpm ? Math.round(d.cpm) : '-'}</td>
        <td>${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</td>
        <td>${d.installs || '-'}</td>
        <td style="color:${cpiColor(d.cpi)}">${d.cpi ? '\u20B9' + Math.round(d.cpi) : '-'}</td>
        <td>${d.signups || '-'}</td>
        <td>${d.signupPct ? d.signupPct.toFixed(1) + '%' : '-'}</td>
        <td style="color:${roasColor(d.d6ROAS)}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</td>
        <td style="color:${roasColor(d.overallROAS)}">${d.overallROAS ? d.overallROAS.toFixed(1) + '%' : '-'}</td>
        <td>${d.signupCost ? '\u20B9' + Math.round(d.signupCost) : '-'}</td>
        <td>${d.p0p1Cost ? '\u20B9' + Math.round(d.p0p1Cost) : '-'}</td>
        <td>${d.d0TrialCost ? '\u20B9' + Math.round(d.d0TrialCost) : '-'}</td>
        <td>${d.d0CAC ? '\u20B9' + Math.round(d.d0CAC) : '-'}</td>
        <td>${d.d6CAC ? '\u20B9' + Math.round(d.d6CAC) : '-'}</td>
        <td><span class="cc-badge ${d.live === 'Live' ? 'badge-live' : 'badge-paused'}">${d.live}</span></td>
        <td>${perfBadge(d.testPerf)}</td>
        <td style="font-size:10px;color:#888;">${d._dateRange ? d._dateRange.label : '-'}</td>
    </tr>`).join('');
}

// =========================================================================
// NEW THIS WEEK
// =========================================================================
function renderNew() {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime();
    const newOnes = filteredData.filter(d => {
        const ts = parseDate(d.date);
        return ts && ts >= sevenDaysAgo;
    });
    const container = document.getElementById('gcNewCreativeCards');
    if (!newOnes.length) {
        container.innerHTML = '<p style="color:var(--text-dim);">No new ad groups found for the latest week.</p>';
        return;
    }
    container.innerHTML = newOnes.map(d => creativeCard(d)).join('');
}

// =========================================================================
// TOP PERFORMERS
// =========================================================================
function renderTop() {
    const top = [...filteredData]
        .filter(d => d.spent > 15000)
        .sort((a, b) => {
            const scoreA = computeScore(a);
            const scoreB = computeScore(b);
            return scoreB - scoreA;
        }).slice(0, 20);
    document.getElementById('gcTopCreativeCards').innerHTML = top.map(d => creativeCard(d, true)).join('');
}

// =========================================================================
// FAILURES
// =========================================================================
function renderFailures() {
    const fails = filteredData.filter(d =>
        d.testPerf === 'Failed' || d.testPerf === 'Drop' ||
        (d.spent > 20000 && d.signups === 0) ||
        (d.spent > 50000 && d.d6ROAS === 0)
    );
    document.getElementById('gcFailureCreativeCards').innerHTML = fails.length
        ? fails.map(d => creativeCard(d)).join('')
        : '<p style="color:var(--text-dim);">No underperformers found with current filters.</p>';
}

// =========================================================================
// SCORECARD
// =========================================================================
function renderScorecardView() {
    const select = document.getElementById('gcScorecardSelect');
    if (select.options.length <= 1) {
        select.innerHTML = '<option value="">Select an ad group...</option>' +
            allData.map((d, i) => `<option value="${i}">${d.name} (${d.campaign_name})</option>`).join('');
    }
}

document.getElementById('gcScorecardSelect')?.addEventListener('change', (e) => {
    const idx = parseInt(e.target.value);
    if (isNaN(idx)) return;
    renderScorecard(allData[idx]);
});

function renderScorecard(d) {
    const container = document.getElementById('gcScorecardContent');
    const metrics = [
        { label: 'CPM', value: d.cpm, format: v => '\u20B9' + Math.round(v), rate: rateCPM },
        { label: 'CTR', value: d.ctr, format: v => v.toFixed(2) + '%', rate: rateCTR },
        { label: 'CPI', value: d.cpi, format: v => '\u20B9' + Math.round(v), rate: rateCPI },
        { label: 'Signup %', value: d.signupPct, format: v => v.toFixed(1) + '%', rate: rateSignup },
        { label: 'D6 ROAS', value: d.d6ROAS, format: v => v.toFixed(1) + '%', rate: rateROAS },
        { label: 'Overall ROAS', value: d.overallROAS, format: v => v.toFixed(1) + '%', rate: rateOverallROAS }
    ];

    const score = computeScore(d);
    const grade = score >= 80 ? 'EXCEPTIONAL' : score >= 60 ? 'GOOD' : score >= 40 ? 'AVERAGE' : 'POOR';
    const gradeColor = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--blue)' : score >= 40 ? 'var(--orange)' : 'var(--red)';

    container.innerHTML = `
        <div class="sc-overall" style="margin-bottom:20px;">
            <div class="sc-overall-score" style="color:${gradeColor}">${Math.round(score)}/100</div>
            <div class="sc-overall-label">${grade} | ${d.type} | Spend: ${formatINR(d.spent)}</div>
        </div>
        <div class="scorecard-grid">
            ${metrics.map(m => {
                const r = m.value > 0 ? m.rate(m.value) : 'N/A';
                return `<div class="sc-metric">
                    <div class="sc-label">${m.label}</div>
                    <div class="sc-value">${m.value > 0 ? m.format(m.value) : '-'}</div>
                    <span class="sc-rating ${r !== 'N/A' ? 'rating-' + r.toLowerCase() : ''}">${r}</span>
                </div>`;
            }).join('')}
        </div>
    `;
}

// =========================================================================
// SCORING & RATING
// =========================================================================
function computeScore(d) {
    let score = 0;
    let factors = 0;
    if (d.cpi > 0) { score += scoreCPI(d.cpi); factors++; }
    if (d.ctr > 0) { score += scoreCTR(d.ctr); factors++; }
    if (d.signupPct > 0) { score += scoreSignup(d.signupPct); factors++; }
    if (d.d6ROAS > 0) { score += scoreROAS(d.d6ROAS) * 2; factors += 2; }
    return factors > 0 ? score / factors : 0;
}

function scoreCPI(v) { return v < 300 ? 100 : v < 500 ? 75 : v < 800 ? 50 : 25; }
function scoreCTR(v) { return v > 0.7 ? 100 : v > 0.5 ? 75 : v > 0.3 ? 50 : 25; }
function scoreSignup(v) { return v > 45 ? 100 : v > 25 ? 75 : v > 10 ? 50 : 25; }
function scoreROAS(v) { return v > 50 ? 100 : v > 25 ? 75 : v > 10 ? 50 : 25; }

function rateCPM(v) { return v < 100 ? 'Exceptional' : v < 200 ? 'Good' : v < 350 ? 'Average' : 'Poor'; }
function rateCTR(v) { return v > 0.7 ? 'Exceptional' : v > 0.5 ? 'Good' : v > 0.3 ? 'Average' : 'Poor'; }
function rateCPI(v) { return v < 300 ? 'Exceptional' : v < 500 ? 'Good' : v < 800 ? 'Average' : 'Poor'; }
function rateSignup(v) { return v > 45 ? 'Exceptional' : v > 25 ? 'Good' : v > 10 ? 'Average' : 'Poor'; }
function rateROAS(v) { return v > 50 ? 'Exceptional' : v > 25 ? 'Good' : v > 10 ? 'Average' : 'Poor'; }
function rateOverallROAS(v) { return v > 60 ? 'Exceptional' : v > 35 ? 'Good' : v > 15 ? 'Average' : 'Poor'; }

// =========================================================================
// CREATIVE CARD
// =========================================================================
function creativeCard(d, showScore = false) {
    const score = computeScore(d);
    return `
        <div class="creative-card">
            <div class="cc-header">
                <div>
                    <div class="cc-name">${shortName(d.name)}</div>
                    <div style="font-size:10px;color:#888;margin-top:2px;">${shortName(d.campaign_name)}</div>
                    ${showScore ? `<div style="margin-top:4px;font-size:11px;color:var(--text-muted)">Score: <strong style="color:${score >= 70 ? 'var(--green)' : score >= 50 ? 'var(--blue)' : 'var(--orange)'}">${Math.round(score)}/100</strong></div>` : ''}
                </div>
                <div style="display:flex;gap:4px;">
                    ${typeBadge(d.type)}
                    ${perfBadge(d.testPerf)}
                </div>
            </div>
            <div class="cc-metrics">
                <div class="cc-metric"><div class="cc-metric-label">Spend</div><div class="cc-metric-value">${formatINR(d.spent)}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">CPI</div><div class="cc-metric-value" style="color:${cpiColor(d.cpi)}">${d.cpi ? '\u20B9' + Math.round(d.cpi) : '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">CTR</div><div class="cc-metric-value">${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">Signups</div><div class="cc-metric-value">${d.signups || '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">D6 ROAS</div><div class="cc-metric-value" style="color:${roasColor(d.d6ROAS)}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">Signup%</div><div class="cc-metric-value">${d.signupPct ? d.signupPct.toFixed(1) + '%' : '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">Signup Cost</div><div class="cc-metric-value">${d.signupCost ? '\u20B9' + Math.round(d.signupCost) : '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">D0 Trial Cost</div><div class="cc-metric-value">${d.d0TrialCost ? '\u20B9' + Math.round(d.d0TrialCost) : '-'}</div></div>
            </div>
            <div class="cc-date">${d.date || ''} | <span class="cc-badge ${d.live === 'Live' ? 'badge-live' : 'badge-paused'}">${d.live}</span> ${d.isMatured ? '<span style="color:#10b981;font-size:10px;">Matured</span>' : '<span style="color:#888;font-size:10px;">' + (d.daysLive || 0) + 'd</span>'} | <span style="color:#666;font-size:10px;">Data: ${d._dateRange ? d._dateRange.label : '-'}</span></div>
        </div>
    `;
}

// =========================================================================
// CSV EXPORT
// =========================================================================
document.getElementById('gcExportBtn')?.addEventListener('click', () => {
    const headers = ['Ad Group', 'Campaign', 'Type', 'Date', 'Spend', 'Impressions', 'CPM', 'CTR', 'Conversions', 'CPI', 'Signups', 'Signup Cost', 'Signup%', 'D6 ROAS', 'Overall ROAS', 'P0P1', 'P0P1%', 'P0P1 Cost', 'D0 Trials', 'D0 Trial Cost', 'D0', 'D0 CAC', 'D6 CAC', 'Status', 'Performance'];
    const csvRows = [headers.join(',')];
    filteredData.forEach(d => {
        csvRows.push([
            `"${d.name}"`, `"${d.campaign_name}"`, d.type, d.date, d.spent, d.impressions, d.cpm,
            d.ctr, d.installs, d.cpi, d.signups, d.signupCost, d.signupPct,
            d.d6ROAS, d.overallROAS, d.p0p1, d.p0p1Pct, d.p0p1Cost, d.d0Trials, d.d0TrialCost, d.d0, d.d0CAC, d.d6CAC, d.live, d.testPerf
        ].join(','));
    });
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'google_ads_export.csv';
    a.click();
});

// =========================================================================
// EVENT LISTENERS
// =========================================================================
document.getElementById('gcSearchInput').addEventListener('input', () => renderCurrentView());
document.getElementById('gcTypeFilter').addEventListener('change', () => renderCurrentView());
document.getElementById('gcStatusFilter').addEventListener('change', () => renderCurrentView());
document.getElementById('gcPerfFilter').addEventListener('change', () => renderCurrentView());
document.getElementById('gcViewPromptAskBtn')?.addEventListener('click', runViewAssistantQuery);
document.getElementById('gcViewPromptInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runViewAssistantQuery(); });
document.getElementById('gcViewAssistantCloseBtn')?.addEventListener('click', closeViewAssistantPanel);
document.getElementById('gcViewAssistantReopenBtn')?.addEventListener('click', reopenViewAssistantPanel);
document.querySelectorAll('.ai-dock-chip[data-ai-prompt]').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById('gcViewPromptInput');
        if (!input) return;
        input.value = btn.dataset.aiPrompt || '';
        runViewAssistantQuery();
    });
});

function onDateFilterChange() {
    const fromEl = document.getElementById('gcDateFrom');
    const toEl = document.getElementById('gcDateTo');
    const dateFrom = fromEl._flatpickr ? fromEl._flatpickr.selectedDates[0] : fromEl.value;
    const dateTo = toEl._flatpickr ? toEl._flatpickr.selectedDates[0] : toEl.value;
    if (dateFrom && dateTo) {
        const from = dateFrom instanceof Date ? dateFrom.toISOString().slice(0, 10) : dateFrom;
        const to = dateTo instanceof Date ? dateTo.toISOString().slice(0, 10) : dateTo;
        fetchLiveData(from, to);
    }
}

function initDatePickers() {
    if (typeof flatpickr === 'undefined') {
        document.getElementById('gcDateFrom').addEventListener('change', onDateFilterChange);
        document.getElementById('gcDateTo').addEventListener('change', onDateFilterChange);
        return;
    }
    const fpConfig = {
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd M Y',
        theme: 'dark',
        allowInput: false,
        onChange: onDateFilterChange
    };
    flatpickr('#gcDateFrom', fpConfig);
    flatpickr('#gcDateTo', fpConfig);
}
initDatePickers();

document.getElementById('gcClearDates').addEventListener('click', () => {
    const fromEl = document.getElementById('gcDateFrom');
    const toEl = document.getElementById('gcDateTo');
    if (fromEl._flatpickr) { fromEl._flatpickr.clear(); } else { fromEl.value = ''; }
    if (toEl._flatpickr) { toEl._flatpickr.clear(); } else { toEl.value = ''; }
    fetchLiveData();
});

document.getElementById('gcRefreshBtn').addEventListener('click', () => fetchLiveData());

// Stub for accounts view
function renderAccountsView() {}

// =========================================================================
// INIT
// =========================================================================
async function init() {
    applyEmbeddedMode();
    setActiveView(views[GC_INITIAL_VIEW] ? GC_INITIAL_VIEW : 'gcDashboard');
    await fetchLiveData();
    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(() => {
        console.log('[Auto-refresh] Fetching latest Google data...');
        fetchLiveData();
    }, REFRESH_INTERVAL);
}
init();

// =========================================================================
// CAMPAIGN TREE — Hierarchical campaign -> adset analysis
// =========================================================================
const TREE_SERVER = window.location.origin || 'http://localhost:3000';

window.fetchCampaignTree = async function () {
    const dateFrom = document.getElementById('gcTreeDateFrom').value;
    const dateTo = document.getElementById('gcTreeDateTo').value;
    const status = document.getElementById('gcTreeStatus');
    const container = document.getElementById('gcTreeContainer');
    const summaryEl = document.getElementById('gcTreeSummary');
    const btn = document.getElementById('gcTreeAnalyzeBtn');

    if (!dateFrom || !dateTo) { status.textContent = 'Please select both dates.'; return; }

    btn.disabled = true;
    status.textContent = 'Fetching data from Google Ads API + Metabase...';
    container.innerHTML = '';
    summaryEl.style.display = 'none';

    try {
        const [googleRes, funnelRes] = await Promise.all([
            fetch(`${TREE_SERVER}/api/google/ad-insights-daily`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom, dateTo }),
            }).then(r => r.json()),
            fetch(`${TREE_SERVER}/api/google/ad-funnel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom, dateTo }),
            }).then(r => r.json()),
        ]);

        if (!googleRes.success) throw new Error('Google Ads API: ' + googleRes.error);
        if (!funnelRes.success) throw new Error('Metabase: ' + funnelRes.error);

        status.textContent = `Google: ${googleRes.total || googleRes.data.length} rows | Metabase: ${funnelRes.total || funnelRes.data.length} rows. Matching...`;

        // Build daily Metabase lookup (adset level for Google)
        const mbDaily = {};
        for (const row of funnelRes.data) {
            const d = String(row.date).substring(0, 10);
            const key = d + '|||' + (row.campaign_name || '') + '|||' + (row.ad_set_name || '').toLowerCase().trim();
            if (!mbDaily[key]) {
                mbDaily[key] = { signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0, d6: 0, d6_revenue: 0, overall_revenue: 0, d6_overall_con: 0, d6_overall_revenue: 0 };
            }
            const m = mbDaily[key];
            m.signups += Number(row.signups) || 0;
            m.d0_trial += Number(row.d0_trial) || 0;
            m.d0 += Number(row.d0) || 0;
            m.d0_revenue += Number(row.d0_revenue) || 0;
            m.d6 += Number(row.d6) || 0;
            m.d6_revenue += Number(row.d6_revenue) || 0;
            m.overall_revenue += Number(row.overall_revenue) || 0;
            m.d6_overall_con += Number(row.d6_overall_con) || 0;
            m.d6_overall_revenue += Number(row.d6_overall_revenue) || 0;
        }

        // Aggregate per campaign|||adset
        const adAgg = {};
        let matchedKeys = 0;
        let unmatchedKeys = 0;
        const matchedMbKeys = new Set();

        const googleRows = googleRes.data;

        for (const row of googleRows) {
            const adsetName = row.adset_name || row.adgroup_name || '';
            const adUid = (row.campaign_name || '') + '|||' + adsetName;
            if (!adAgg[adUid]) {
                adAgg[adUid] = {
                    campaign_name: row.campaign_name || '', campaign_id: row.campaign_id || '',
                    adset_name: adsetName, adset_id: row.adset_id || row.adgroup_id || '',
                    campaign_type: row.campaign_type || row.advertising_channel_type || '',
                    spend: 0, impressions: 0, clicks: 0, conversions: 0,
                    signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
                    d6: 0, d6_revenue: 0, overall_revenue: 0,
                    d6_overall_con: 0, d6_overall_revenue: 0,
                    _matched: false,
                };
            }
            const a = adAgg[adUid];
            a.spend += (row.spend || row.cost_micros / 1000000 || 0) * 1.18;
            a.impressions += row.impressions || 0;
            a.clicks += row.clicks || 0;
            a.conversions += row.conversions || 0;

            const dateKey = row.date_start || row.date || row.segments_date || '';
            const mbKey = dateKey + '|||' + (row.campaign_name || '') + '|||' + adsetName.toLowerCase().trim();
            const mb = mbDaily[mbKey];
            if (mb) {
                matchedKeys++;
                matchedMbKeys.add(mbKey);
                a._matched = true;
                a.signups += mb.signups;
                a.d0_trial += mb.d0_trial;
                a.d0 += mb.d0;
                a.d0_revenue += mb.d0_revenue;
                a.d6 += mb.d6;
                a.d6_revenue += mb.d6_revenue;
                a.overall_revenue += mb.overall_revenue;
                a.d6_overall_con += mb.d6_overall_con;
                a.d6_overall_revenue += mb.d6_overall_revenue;
            } else {
                unmatchedKeys++;
            }
        }

        // Add unmatched Metabase entries
        for (const [key, mb] of Object.entries(mbDaily)) {
            if (!matchedMbKeys.has(key)) {
                const parts = key.split('|||');
                const adUid = parts[1] + '|||' + parts[2];
                if (!adAgg[adUid]) {
                    adAgg[adUid] = {
                        campaign_name: parts[1], campaign_id: '',
                        adset_name: parts[2], adset_id: '',
                        campaign_type: '',
                        spend: 0, impressions: 0, clicks: 0, conversions: 0,
                        signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
                        d6: 0, d6_revenue: 0, overall_revenue: 0,
                        d6_overall_con: 0, d6_overall_revenue: 0,
                        _matched: true,
                    };
                }
                const a = adAgg[adUid];
                a._matched = true;
                a.signups += mb.signups;
                a.d0_trial += mb.d0_trial;
                a.d0 += mb.d0;
                a.d0_revenue += mb.d0_revenue;
                a.d6 += mb.d6;
                a.d6_revenue += mb.d6_revenue;
                a.overall_revenue += mb.overall_revenue;
            }
        }

        const totalMbKeys = Object.keys(mbDaily).length;
        console.log(`[Tree] Google rows: ${googleRows.length} | MB daily keys: ${totalMbKeys} | Matched: ${matchedKeys}/${matchedKeys + unmatchedKeys}`);

        const spendOnly = document.getElementById('gcTreeSpendFilter').checked;
        const adEntries = spendOnly ? Object.values(adAgg).filter(a => a.spend > 0) : Object.values(adAgg);

        // Compute derived metrics via shared pipeline
        const ads = adEntries.map(a => {
            const raw = { ...a, installs: a.conversions || 0 };
            const derived = deriveMetrics(raw);
            const adFrom = dateFrom;
            const _dateRange = adFrom.slice(5) + ' \u2192 ' + dateTo.slice(5);
            return { ...a, ...derived, installs: raw.installs, d6OverallCAC: derived.d6CAC, d6OverallROAS: _vR(a.spend, a.d6_overall_revenue) ?? 0, _dateRange, spent: a.spend };
        });

        // Build tree: campaign -> adset (no ad level for Google)
        const tree = {};
        for (const ad of ads) {
            if (!tree[ad.campaign_name]) {
                tree[ad.campaign_name] = { name: ad.campaign_name, id: ad.campaign_id, type: detectType(ad.campaign_name, ad.campaign_type), adsets: {}, totals: null };
            }
            const camp = tree[ad.campaign_name];
            camp.adsets[ad.adset_name] = { name: ad.adset_name, id: ad.adset_id, totals: ad };
        }

        // Aggregate campaign totals
        function sumAdsets(adsetList) {
            const rawItems = adsetList.map(as => {
                const a = as.totals;
                return { ...a, installs: a.installs || a.conversions || 0 };
            });
            const t = sumRaw(rawItems);
            const derived = deriveMetrics(t);
            return { ...t, ...derived, d6OverallCAC: derived.d6CAC, d6OverallROAS: _vR(t.spend, t.d6_overall_revenue) ?? 0 };
        }

        let totalSpend = 0, totalSignups = 0, totalD6 = 0, totalD6Rev = 0, totalInstalls = 0;
        let redCount = 0, greenCount = 0;

        for (const camp of Object.values(tree)) {
            const adsetList = Object.values(camp.adsets);
            camp.totals = sumAdsets(adsetList);
            camp.totals.campaign_id = camp.id;
            totalSpend += camp.totals.spend;
            totalSignups += camp.totals.signups;
            totalD6 += camp.totals.d6;
            totalD6Rev += camp.totals.d6_revenue;
            totalInstalls += camp.totals.installs;
        }

        // Classify alerts
        function classifyTreeAlert(d) {
            if ((d.spend || d.spent || 0) < 15000) return 'neutral';
            if (d.d6ROAS > 28) return 'green';
            let breaches = 0;
            if (d.signupCost > 1000) breaches++;
            if (d.d0TrialCost > 3500) breaches++;
            if (d.d6CAC > 15000) breaches++;
            if (d.cpi > 200) breaches++;
            if (breaches >= 2) return 'red';
            let hits = 0;
            if (d.signupCost > 0 && d.signupCost < 500) hits++;
            if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) hits++;
            if (d.d6CAC > 0 && d.d6CAC < 12000) hits++;
            if (hits >= 2) return 'green';
            return 'neutral';
        }

        for (const ad of ads) {
            const alert = classifyTreeAlert(ad);
            if (alert === 'red') redCount++;
            else if (alert === 'green') greenCount++;
        }

        // Render summary
        const overallROAS = totalSpend > 0 ? (totalD6Rev / totalSpend * 100).toFixed(1) : '0';
        summaryEl.style.display = 'block';
        summaryEl.innerHTML = `
            <div class="tree-summary-cards">
                <div class="tree-summary-card"><div class="val" style="color:#6c5ce7;">${Object.keys(tree).length}</div><div class="lbl">Campaigns</div></div>
                <div class="tree-summary-card"><div class="val">${cur(totalSpend)}</div><div class="lbl">Total Spend</div></div>
                <div class="tree-summary-card"><div class="val">${num(totalInstalls)}</div><div class="lbl">Conversions</div></div>
                <div class="tree-summary-card"><div class="val">${num(totalSignups)}</div><div class="lbl">Signups</div></div>
                <div class="tree-summary-card"><div class="val">${totalD6}</div><div class="lbl">D6 Conversions</div></div>
                <div class="tree-summary-card"><div class="val">${overallROAS}%</div><div class="lbl">D6 ROAS</div></div>
                <div class="tree-summary-card"><div class="val" style="color:#ef4444;">${redCount}</div><div class="lbl">Red Alerts</div></div>
                <div class="tree-summary-card"><div class="val" style="color:#10b981;">${greenCount}</div><div class="lbl">Green Alerts</div></div>
                <div class="tree-summary-card"><div class="val" style="color:#888;">${matchedKeys}/${matchedKeys + unmatchedKeys}</div><div class="lbl">Keys Matched</div></div>
            </div>`;

        // Render tree
        const sortedCampaigns = Object.values(tree).sort((a, b) => b.totals.spend - a.totals.spend);
        let html = '';
        for (const camp of sortedCampaigns) {
            const campAlert = classifyTreeAlert(camp.totals);
            html += renderTreeNode(camp.name + ' [' + (camp.type || '') + ']', 'campaign', camp.totals, campAlert, () => {
                let inner = '';
                const sortedAdsets = Object.values(camp.adsets).sort((a, b) => (b.totals.spend || 0) - (a.totals.spend || 0));
                for (const adset of sortedAdsets) {
                    const adsetAlert = classifyTreeAlert(adset.totals);
                    const noFunnel = !adset.totals._matched ? ' tree-no-funnel' : '';
                    inner += renderTreeNode(adset.name, 'adset', adset.totals, adsetAlert, null, noFunnel);
                }
                return inner;
            });
        }
        container.innerHTML = html;

        status.textContent = `Done. ${Object.keys(tree).length} campaigns, ${ads.length} ad groups. ${matchedKeys} key matches, ${unmatchedKeys} unmatched.`;

    } catch (err) {
        status.textContent = 'Error: ' + err.message;
        console.error('Campaign tree error:', err);
    } finally {
        btn.disabled = false;
    }
};

function getTreeAlertReasons(m, alertType) {
    const reasons = [];
    if (alertType === 'red') {
        if (m.signupCost > 1000) reasons.push(`SU Cost \u20B9${Math.round(m.signupCost)} (> \u20B91,000)`);
        if (m.d0TrialCost > 3500) reasons.push(`D0 Trial \u20B9${Math.round(m.d0TrialCost)} (> \u20B93,500)`);
        if (m.d6CAC > 15000) reasons.push(`D6 CAC \u20B9${Math.round(m.d6CAC)} (> \u20B915,000)`);
        if (m.d6ROAS <= 28 && m.d6ROAS > 0) reasons.push(`D6 ROAS ${m.d6ROAS.toFixed(1)}% (< 28%)`);
    } else if (alertType === 'green') {
        if (m.d6ROAS > 28) reasons.push(`D6 ROAS ${m.d6ROAS.toFixed(1)}% (> 28%)`);
        if (m.signupCost > 0 && m.signupCost < 500) reasons.push(`SU Cost \u20B9${Math.round(m.signupCost)} (< \u20B9500)`);
        if (m.d6CAC > 0 && m.d6CAC < 12000) reasons.push(`D6 CAC \u20B9${Math.round(m.d6CAC)} (< \u20B912,000)`);
    }
    return reasons;
}

function getBudgetSuggestion(m, alertType) {
    if (m.spend < 5000) return null;
    if (alertType === 'green' && m.d6ROAS > 28) {
        return { action: 'increase', label: '\u2191 +20% Budget', reason: `D6 ROAS ${m.d6ROAS.toFixed(1)}% is above 28% target \u2014 scale up`, color: '#10b981' };
    }
    if (alertType === 'green' && m.d6ROAS > 20) {
        return { action: 'increase', label: '\u2191 +20% Budget', reason: `D6 ROAS trending well at ${m.d6ROAS.toFixed(1)}% \u2014 cautious scale`, color: '#10b981' };
    }
    if (alertType === 'red') {
        return { action: 'decrease', label: '\u2193 -20% Budget', reason: `Underperforming metrics \u2014 reduce budget to limit losses`, color: '#ef4444' };
    }
    if (m.d6ROAS > 0 && m.d6ROAS < 15 && m.spend > 30000) {
        return { action: 'decrease', label: '\u2193 -20% Budget', reason: `D6 ROAS only ${m.d6ROAS.toFixed(1)}% with \u20B9${Math.round(m.spend/1000)}K spent \u2014 cut to reallocate`, color: '#ef4444' };
    }
    return null;
}

function renderTreeNode(name, level, metrics, alertType, childrenFn, extraClass) {
    const id = 'gc-tree-' + Math.random().toString(36).substr(2, 9);
    const hasChildren = !!childrenFn;
    const toggle = hasChildren ? `<span class="tree-toggle" onclick="toggleTreeNode('${id}')">&#9654;</span>` : '<span style="width:16px;display:inline-block;"></span>';
    const badge = alertType !== 'neutral' ? `<span class="tree-badge ${alertType}">${alertType === 'red' ? 'RED' : 'GREEN'}</span>` : '';

    const m = metrics;
    const metricsHtml = `
        <div class="tree-metrics">
            <div class="tree-metric"><div class="label">Spend</div><div class="value">${cur(m.spend)}</div></div>
            <div class="tree-metric"><div class="label">Conv.</div><div class="value">${num(m.installs || m.conversions || 0)}</div></div>
            <div class="tree-metric"><div class="label">CPI</div><div class="value">${m.cpi ? '\u20B9' + Math.round(m.cpi) : '-'}</div></div>
            <div class="tree-metric"><div class="label">Signups</div><div class="value">${num(m.signups || 0)}</div></div>
            <div class="tree-metric"><div class="label">SU Cost</div><div class="value" style="color:${m.signupCost ? (m.signupCost < 500 ? '#10b981' : m.signupCost > 1000 ? '#ef4444' : '#e0e0e0') : '#888'}">${m.signupCost ? '\u20B9' + Math.round(m.signupCost) : '-'}</div></div>
            <div class="tree-metric"><div class="label">D0 Trial</div><div class="value">${m.d0TrialCost ? '\u20B9' + Math.round(m.d0TrialCost) : '-'}</div></div>
            <div class="tree-metric"><div class="label">D6 CAC</div><div class="value" style="color:${m.d6CAC ? (m.d6CAC < 12000 ? '#10b981' : m.d6CAC > 15000 ? '#ef4444' : '#e0e0e0') : '#888'}">${m.d6CAC ? '\u20B9' + Math.round(m.d6CAC) : '-'}</div></div>
            <div class="tree-metric"><div class="label">D6 ROAS</div><div class="value" style="color:${m.d6ROAS > 28 ? '#10b981' : m.d6ROAS > 0 ? '#ef4444' : '#888'}">${m.d6ROAS ? m.d6ROAS.toFixed(1) + '%' : '-'}</div></div>
            ${m._dateRange ? '<div class="tree-metric" style="min-width:auto;"><div class="label" style="font-size:9px;color:#666;">Data</div><div class="value" style="font-size:9px;color:#888;">' + m._dateRange + '</div></div>' : ''}
        </div>`;

    let actionsHtml = '';
    const reasons = getTreeAlertReasons(m, alertType);

    if (level === 'adset' && alertType === 'red') {
        actionsHtml = `<div class="tree-actions" onclick="event.stopPropagation()">
            <div class="tree-insight tree-insight-red">
                <span class="tree-insight-icon">&#9888;</span>
                <span class="tree-insight-reasons">${reasons.join(' \u00B7 ')}</span>
            </div>
        </div>`;
    } else if (level === 'adset' && alertType === 'green') {
        actionsHtml = `<div class="tree-actions" onclick="event.stopPropagation()">
            <div class="tree-insight tree-insight-green">
                <span class="tree-insight-icon">&#10004;</span>
                <span class="tree-insight-reasons">${reasons.join(' \u00B7 ')}</span>
            </div>
        </div>`;
    }

    if (level === 'campaign' && m.spend >= 5000) {
        const suggestion = getBudgetSuggestion(m, alertType);
        if (suggestion) {
            const entityId = m.campaign_id || '';
            if (entityId) {
                actionsHtml += `<div class="tree-actions" onclick="event.stopPropagation()">
                    <div class="tree-insight" style="border-left-color:${suggestion.color}">
                        <span class="tree-insight-reasons" style="color:var(--text-dim)">${suggestion.reason}</span>
                        <button class="tree-action-btn" style="background:${suggestion.color};border-color:${suggestion.color}"
                            onclick="window.updateGoogleBudget('${entityId}', '${suggestion.action}', this)">
                            ${suggestion.label}
                        </button>
                    </div>
                </div>`;
            } else if (reasons.length) {
                actionsHtml += `<div class="tree-actions" onclick="event.stopPropagation()">
                    <div class="tree-insight" style="border-left-color:${alertType === 'red' ? '#ef4444' : alertType === 'green' ? '#10b981' : '#888'}">
                        <span class="tree-insight-reasons" style="color:var(--text-dim)">${reasons.join(' \u00B7 ')}</span>
                        <span style="font-size:11px;color:var(--text-muted);padding:4px 8px;">Suggestion: ${suggestion.label}</span>
                    </div>
                </div>`;
            }
        }
    }

    const childrenHtml = hasChildren ? `<div class="tree-children collapsed" id="${id}-children">${childrenFn()}</div>` : '';

    return `<div class="tree-node${extraClass || ''}">
        <div class="tree-header ${level}" onclick="${hasChildren ? `toggleTreeNode('${id}')` : ''}">
            ${toggle}
            <span class="tree-name">${esc(name)}</span>
            ${badge}
            ${metricsHtml}
        </div>
        ${actionsHtml}
        ${childrenHtml}
    </div>`;
}

// Update Google campaign budget
window.updateGoogleBudget = async function(campaignId, action, btn) {
    const actionLabel = action === 'increase' ? 'increase by 20%' : 'decrease by 20%';
    if (!confirm(`${actionLabel} budget for this campaign?`)) return;
    const origText = btn.innerHTML;
    btn.innerHTML = '\u231B Updating...';
    btn.disabled = true;
    try {
        const res = await fetch('/api/google/campaign-budget', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campaign_id: campaignId, action })
        });
        const data = await res.json();
        if (data.success) {
            btn.innerHTML = `\u2713 \u20B9${Math.round(data.previous_budget)} \u2192 \u20B9${Math.round(data.new_budget)}`;
            btn.style.background = '#374151';
            btn.style.borderColor = '#374151';
            btn.disabled = true;
        } else {
            throw new Error(data.error || 'Failed');
        }
    } catch (err) {
        btn.innerHTML = origText;
        btn.disabled = false;
        alert('Budget update failed: ' + err.message);
    }
};

window.toggleTreeNode = function (id) {
    const children = document.getElementById(id + '-children');
    if (!children) return;
    children.classList.toggle('collapsed');
    const header = children.previousElementSibling;
    if (!header) return;
    const toggle = header.querySelector('.tree-toggle');
    if (toggle) toggle.classList.toggle('open');
};

// =========================================================================
// WEEKLY BREAKDOWN
// =========================================================================
function localDateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getWeekBuckets() {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const buckets = [];
    const todayStr = localDateStr(today);
    buckets.push({ label: 'Today', from: todayStr, to: todayStr, dates: new Set([todayStr]) });
    for (let w = 0; w < 4; w++) {
        const endDay = new Date(today); endDay.setDate(endDay.getDate() - 1 - (w * 7));
        const startDay = new Date(endDay); startDay.setDate(startDay.getDate() - 6);
        const dates = new Set();
        for (const dt = new Date(startDay); dt <= endDay; dt.setDate(dt.getDate() + 1)) {
            dates.add(localDateStr(dt));
        }
        const fromStr = localDateStr(startDay);
        const toStr = localDateStr(endDay);
        const fmtFrom = startDay.getDate() + ' ' + startDay.toLocaleString('en', { month: 'short' });
        const fmtTo = endDay.getDate() + ' ' + endDay.toLocaleString('en', { month: 'short' });
        buckets.push({ label: fmtFrom + ' - ' + fmtTo, from: fromStr, to: toStr, dates });
    }
    return buckets;
}

function sumRawBuckets(items, bucketCount) {
    const result = [];
    for (let b = 0; b < bucketCount; b++) {
        const sum = emptyRaw();
        for (const item of items) {
            const src = item.buckets[b];
            for (const k of Object.keys(sum)) sum[k] += src[k] || 0;
        }
        result.push(sum);
    }
    return result;
}

window.fetchWeeklyBreakdown = async function () {
    const status = document.getElementById('gcTreeStatus');
    const treeContainer = document.getElementById('gcTreeContainer');
    const weeklyContainer = document.getElementById('gcWeeklyTreeContainer');
    const btn = document.getElementById('gcWeeklyBtn');

    btn.disabled = true;
    treeContainer.style.display = 'none';
    weeklyContainer.style.display = 'block';
    weeklyContainer.innerHTML = '';
    document.getElementById('gcTreeSummary').style.display = 'none';
    status.textContent = 'Fetching last 28 days + today...';

    const buckets = getWeekBuckets();
    const dateFrom = buckets[buckets.length - 1].from;
    const dateTo = buckets[0].to;

    try {
        status.textContent = 'Fetching 5 weekly buckets from Google Ads + Metabase...';

        const bucketResults = await Promise.all(buckets.map(async (bkt, idx) => {
            const [googleRes, mbRes] = await Promise.all([
                fetch(`${TREE_SERVER}/api/google/ad-insights-daily`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dateFrom: bkt.from, dateTo: bkt.to }),
                }).then(r => r.json()),
                fetch(`${TREE_SERVER}/api/google/ad-funnel`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dateFrom: bkt.from, dateTo: bkt.to }),
                }).then(r => r.json()),
            ]);
            console.log(`[Weekly] Bucket ${idx} (${bkt.label}): Google=${googleRes.total || 0} MB=${mbRes.total || 0}`);
            return { google: googleRes, mb: mbRes, bucketIdx: idx };
        }));

        const adWeekly = {};
        const campMB = {};
        const adsetMB = {};
        let matched = 0, unmatched = 0;

        function addMBToRaw(target, row) {
            target.signups += Number(row.signups) || 0;
            target.d0_trial += Number(row.d0_trial) || 0;
            target.d0 += Number(row.d0) || 0;
            target.d0_revenue += Number(row.d0_revenue) || 0;
            target.d6 += Number(row.d6) || 0;
            target.d6_revenue += Number(row.d6_revenue) || 0;
            target.overall_revenue += Number(row.overall_revenue) || 0;
            target.d6_overall_con += Number(row.d6_overall_con) || 0;
            target.d6_overall_revenue += Number(row.d6_overall_revenue) || 0;
        }

        for (const { google, mb, bucketIdx } of bucketResults) {
            if (!google.success || !mb.success) continue;

            // Direct Metabase aggregates
            for (const row of mb.data) {
                if (!campMB[row.campaign_name]) campMB[row.campaign_name] = buckets.map(() => emptyRaw());
                addMBToRaw(campMB[row.campaign_name][bucketIdx], row);
                const asKey = row.campaign_name + '|||' + (row.ad_set_name || '').toLowerCase().trim();
                if (!adsetMB[asKey]) adsetMB[asKey] = buckets.map(() => emptyRaw());
                addMBToRaw(adsetMB[asKey][bucketIdx], row);
            }

            // Adset-level: Google spend + matched Metabase funnel
            const mbLookup = {};
            for (const row of mb.data) {
                const key = row.campaign_name + '|||' + (row.ad_set_name || '').toLowerCase().trim();
                if (!mbLookup[key]) mbLookup[key] = emptyRaw();
                addMBToRaw(mbLookup[key], row);
            }

            const googleRows = google.data;
            const googleByAdset = {};
            for (const row of googleRows) {
                const adsetName = row.adset_name || row.adgroup_name || '';
                const adUid = (row.campaign_name || '') + '|||' + adsetName;
                if (!googleByAdset[adUid]) {
                    googleByAdset[adUid] = { ...row, adset_name: adsetName, spend: 0, impressions: 0, clicks: 0, conversions: 0 };
                }
                googleByAdset[adUid].spend += row.spend || row.cost_micros / 1000000 || 0;
                googleByAdset[adUid].impressions += row.impressions || 0;
                googleByAdset[adUid].clicks += row.clicks || 0;
                googleByAdset[adUid].conversions += row.conversions || 0;
            }

            for (const [adUid, row] of Object.entries(googleByAdset)) {
                if (!adWeekly[adUid]) {
                    adWeekly[adUid] = {
                        campaign_name: row.campaign_name, adset_name: row.adset_name,
                        campaign_id: row.campaign_id, adset_id: row.adset_id || row.adgroup_id,
                        buckets: buckets.map(() => emptyRaw()),
                    };
                }
                const b = adWeekly[adUid].buckets[bucketIdx];
                b.spend += row.spend * 1.18;
                b.impressions += row.impressions;
                b.clicks += row.clicks;
                b.installs += row.conversions;

                const mbKey = row.campaign_name + '|||' + (row.adset_name || '').toLowerCase().trim();
                const mbRow = mbLookup[mbKey];
                if (mbRow) {
                    matched++;
                    addMBToRaw(b, mbRow);
                } else { unmatched++; }
            }
        }

        const spendOnly = document.getElementById('gcTreeSpendFilter').checked;
        const adList = Object.values(adWeekly).filter(a => !spendOnly || a.buckets.some(b => b.spend > 0));

        // Build tree: campaign -> adset
        const tree = {};
        for (const ad of adList) {
            if (!tree[ad.campaign_name]) tree[ad.campaign_name] = { name: ad.campaign_name, adsets: {} };
            const camp = tree[ad.campaign_name];
            camp.adsets[ad.adset_name] = ad;
        }

        // Campaign buckets
        for (const camp of Object.values(tree)) {
            const adsetList = Object.values(camp.adsets);
            const spendBuckets = sumRawBuckets(adsetList, buckets.length);
            const mbBuckets = campMB[camp.name] || buckets.map(() => emptyRaw());
            camp.buckets = spendBuckets.map((sb, i) => ({
                ...mbBuckets[i],
                spend: sb.spend, impressions: sb.impressions, clicks: sb.clicks, installs: sb.installs,
            }));
        }

        const sortedCampaigns = Object.values(tree).sort((a, b) =>
            b.buckets.reduce((s, x) => s + x.spend, 0) - a.buckets.reduce((s, x) => s + x.spend, 0));

        const metricCols = ['Spend', 'Conv.', 'CPI', 'Signups', 'SU Cost', 'D0 Trial', 'D6', 'D6 CAC', 'D6 ROAS'];

        let html = '';
        for (const camp of sortedCampaigns) {
            const totalSpend = camp.buckets.reduce((s, b) => s + b.spend, 0);
            const totalSignups = camp.buckets.reduce((s, b) => s + b.signups, 0);
            const cId = 'gc-wk-' + Math.random().toString(36).substr(2, 8);
            html += wkHeader(camp.name, 'campaign', totalSpend, totalSignups, cId);
            html += `<div class="wk-children collapsed" id="${cId}-children">`;
            html += wkTable(camp.buckets, buckets, metricCols);

            const sortedAdsets = Object.entries(camp.adsets).sort((a, b) =>
                b[1].buckets.reduce((s, x) => s + x.spend, 0) - a[1].buckets.reduce((s, x) => s + x.spend, 0));
            for (const [asName, adset] of sortedAdsets) {
                const asSpend = adset.buckets.reduce((s, b) => s + b.spend, 0);
                const asSignups = adset.buckets.reduce((s, b) => s + b.signups, 0);
                const aId = 'gc-wk-' + Math.random().toString(36).substr(2, 8);
                html += wkHeader(asName, 'adset', asSpend, asSignups, aId);
                html += `<div class="wk-children collapsed" id="${aId}-children">`;
                html += wkTable(adset.buckets, buckets, metricCols);
                html += '</div>';
            }
            html += '</div>';
        }

        weeklyContainer.innerHTML = html;
        status.textContent = `Weekly: ${sortedCampaigns.length} campaigns, ${adList.length} ad groups. Matched: ${matched}/${matched + unmatched}`;

    } catch (err) {
        status.textContent = 'Error: ' + err.message;
        console.error('Weekly breakdown error:', err);
    } finally {
        btn.disabled = false;
    }
};

function wkHeader(name, level, totalSpend, totalSignups, nodeId) {
    return `<div class="tree-header ${level}" onclick="toggleTreeNode('${nodeId}')">
        <span class="tree-toggle">&#9654;</span>
        <span class="tree-name">${esc(name)}</span>
        <div class="tree-metrics">
            <div class="tree-metric"><div class="label">Spend</div><div class="value">${cur(totalSpend)}</div></div>
            <div class="tree-metric"><div class="label">Signups</div><div class="value">${num(totalSignups)}</div></div>
        </div>
    </div>`;
}

function wkTable(rawBuckets, bucketDefs, metricCols) {
    let html = '<table class="wk-tbl"><thead><tr><th class="wk-tbl-period">Period</th>';
    for (const col of metricCols) html += `<th>${col}</th>`;
    html += '</tr></thead><tbody>';
    for (let i = 0; i < rawBuckets.length; i++) {
        const raw = rawBuckets[i];
        const m = deriveMetrics(raw);
        const label = bucketDefs[i].label;
        const rColor = m.d6ROAS > 28 ? '#10b981' : m.d6ROAS > 0 ? '#ef4444' : '#888';
        const suCostColor = m.signupCost ? (m.signupCost < 500 ? '#10b981' : m.signupCost > 1000 ? '#ef4444' : '#e0e0e0') : '#888';
        const d6CACColor = m.d6CAC ? (m.d6CAC < 12000 ? '#10b981' : m.d6CAC > 15000 ? '#ef4444' : '#e0e0e0') : '#888';
        html += `<tr>
            <td class="wk-tbl-period">${label}</td>
            <td>${raw.spend > 0 ? curK(raw.spend) : '-'}</td>
            <td>${raw.installs || '-'}</td>
            <td>${m.cpi ? '\u20B9' + Math.round(m.cpi) : '-'}</td>
            <td>${raw.signups || '-'}</td>
            <td style="color:${suCostColor}">${m.signupCost ? '\u20B9' + Math.round(m.signupCost) : '-'}</td>
            <td>${raw.d0_trial || '-'}</td>
            <td>${raw.d6 || '-'}</td>
            <td style="color:${d6CACColor}">${m.d6CAC ? '\u20B9' + Math.round(m.d6CAC) : '-'}</td>
            <td style="color:${rColor}">${m.d6ROAS ? m.d6ROAS.toFixed(1) + '%' : '-'}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    return html;
}
