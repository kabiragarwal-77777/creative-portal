// =========================================================================
// DATA FETCHING — Real-time Meta API + Metabase (replaces Google Sheets)
// =========================================================================

let allData = [];
let filteredData = [];
let _refreshTimer = null;
let _verifyTimer = null;
let _verifyDailyBase = { metaRows: [], funnelRows: [], dateFrom: null, dateTo: null };
let _verifyDeltaCache = { from: null, to: null, fetchedAt: 0, metaRows: [], funnelRows: [] };
const REFRESH_INTERVAL = 10 * 60 * 1000; // 10 minutes
const VERIFY_INTERVAL = 15 * 60 * 1000; // 15 minutes
const PIN_CAMPAIGN_LAST = 'Test-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_131125';
const TEST_CAMPAIGNS = [
    'Test4-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_200326',
    'Test-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_131125',
    'Test2-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_051225',
];
let currentDateRange = { since: null, until: null, label: '--' };
let currentDataMode = { type: 'na', label: 'Mode: --', detail: '' };
let currentDiagnostics = { source: 'Meta + Metabase', matchedKeys: 0, unmatchedKeys: 0 };
const APP_URL_PARAMS = new URLSearchParams(window.location.search || '');
const APP_INITIAL_VIEW = APP_URL_PARAMS.get('view') || 'dashboard';
const APP_STANDALONE_MODE = APP_URL_PARAMS.get('standalone') === '1';
let CURRENT_VIEW = APP_INITIAL_VIEW || 'dashboard';
window.OPTIMIZER_PLATFORM = window.OPTIMIZER_PLATFORM || 'meta';

// =========================================================================
// SHARED DATA PIPELINE — Raw summable metrics + derived formulated metrics
// Pattern: leaf records (date×campaign×adset×ad) → SUM raw up → deriveMetrics() at each level
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

// Sum an array of raw records into one raw record (pivot/rollup)
function sumRaw(items) {
    const t = emptyRaw();
    for (const item of items) {
        for (const k of Object.keys(t)) t[k] += (item[k] || 0);
    }
    return t;
}

function sortCampaignsPinnedLast(items, getSpend) {
    return [...items].sort((a, b) => {
        const aPinned = (a.name || a.campaign_name || '') === PIN_CAMPAIGN_LAST;
        const bPinned = (b.name || b.campaign_name || '') === PIN_CAMPAIGN_LAST;
        if (aPinned && !bPinned) return 1;
        if (!aPinned && bPinned) return -1;
        return getSpend(b) - getSpend(a);
    });
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
    const d = String(dateStr || '').substring(0, 10);
    return [
        d,
        normalizeCampaignName(campaignName),
        normalizeAdsetName(adsetName),
        normalizeTrackerName(trackerName)
    ].join('|||');
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
    if (matured > 0 && early > 0) {
        return {
            type: 'mixed',
            label: `Mode: Mixed (${matured} mature / ${early} early)`,
            detail: `${matured} mature records and ${early} early records are contributing to this view.`,
        };
    }
    if (matured > 0) {
        return {
            type: 'mature',
            label: `Mode: Mature (${matured})`,
            detail: `All visible records are using mature data windows where applicable.`,
        };
    }
    return {
        type: 'early',
        label: `Mode: Early / Full Data (${early})`,
        detail: `Visible records are still using early/full data because no mature window is available yet.`,
    };
}

function updateContextStrip() {
    const dateEl = document.getElementById('viewContextDate');
    const modeEl = document.getElementById('viewContextMode');
    const metaEl = document.getElementById('viewContextMeta');
    if (dateEl) dateEl.textContent = `Data: ${currentDateRange.label || '--'}`;
    if (modeEl) {
        modeEl.textContent = currentDataMode.label || 'Mode: --';
        modeEl.title = currentDataMode.detail || currentDataMode.label || '';
    }
    if (metaEl) {
        const matched = Number(currentDiagnostics.matchedKeys || 0);
        const unmatched = Number(currentDiagnostics.unmatchedKeys || 0);
        metaEl.textContent = `Source: ${currentDiagnostics.source || 'Meta + Metabase'} • Keys ${matched}/${matched + unmatched || matched}`;
        metaEl.title = unmatched > 0
            ? `${matched} matched keys, ${unmatched} unmatched spend-only Meta keys retained.`
            : `${matched} matched keys.`;
    }
}

function getCurrentFilterState() {
    return {
        search: document.getElementById('searchInput')?.value || '',
        type: document.getElementById('typeFilter')?.value || 'all',
        status: document.getElementById('statusFilter')?.value || 'all',
        performance: document.getElementById('perfFilter')?.value || 'all',
    };
}

function buildPromptHints(view) {
    const base = [
        'I think data is wrong here',
        'Which campaign should I scale right now for max ROAS?',
        'Why is the optimizer showing limited actions?'
    ];
    if (view === 'campaignTree') return ['Which campaign is leaking budget?', 'Why are some adsets unmatched?', ...base];
    if (view === 'optimizer') return ['What is the highest-confidence action right now?', ...base];
    if (view === 'alerts') return ['Which alert needs action first?', ...base];
    return base;
}

function publishPortalContext(extra) {
    const view = getCurrentView();
    const optimizerPlatform = window.OPTIMIZER_PLATFORM || 'meta';
    const activeApp = view === 'optimizer' && optimizerPlatform === 'google' ? 'google' : 'meta';
    const activeTitle = view === 'optimizer'
        ? (optimizerPlatform === 'google' ? 'Campaign Optimizer - Google' : 'Campaign Optimizer - Meta')
        : (views[view] ? views[view].title : 'Meta Portal');
    const activeSubtitle = view === 'optimizer'
        ? (optimizerPlatform === 'google'
            ? 'Google Ads optimization workspace embedded inside the shared optimizer module'
            : 'Meta optimization workspace inside the shared optimizer module')
        : (views[view] ? views[view].subtitle : 'Meta portal view');
    const diagnosticsSource = view === 'optimizer'
        ? (optimizerPlatform === 'google' ? 'Google + Metabase • Optimizer' : 'Meta + Metabase • Optimizer')
        : (currentDiagnostics.source || 'Meta + Metabase');
    const context = {
        app: activeApp,
        view,
        title: activeTitle,
        subtitle: activeSubtitle,
        dateRange: {
            since: currentDateRange.since,
            until: currentDateRange.until,
            label: currentDateRange.label,
        },
        dataMode: currentDataMode,
        filters: getCurrentFilterState(),
        diagnostics: {
            source: diagnosticsSource,
            matchedKeys: Number(currentDiagnostics.matchedKeys || 0),
            unmatchedKeys: Number(currentDiagnostics.unmatchedKeys || 0),
            lastUpdated: document.getElementById('lastUpdated')?.textContent || '--',
        },
        promptHints: buildPromptHints(view),
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
window.__publishPortalContext = publishPortalContext;

async function runViewAssistantQuery() {
    const input = document.getElementById('viewPromptInput');
    const button = document.getElementById('viewPromptAskBtn');
    const panel = document.getElementById('viewAssistantPanel');
    const questionEl = document.getElementById('viewAssistantQuestion');
    const answerEl = document.getElementById('viewAssistantAnswer');
    const checksEl = document.getElementById('viewAssistantChecks');
    const nextEl = document.getElementById('viewAssistantNextSteps');
    const reopenBtn = document.getElementById('viewAssistantReopenBtn');
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
                system: 'You are an AI intelligent analyzer for the current Meta portal view. Answer like a sharp performance marketing analyst. Prioritize practical decisions, especially scale/cut/debug questions. Return strict JSON with keys answer, checks, next_steps.',
                prompt: `Active Meta portal context:\n${JSON.stringify(context, null, 2)}\n\nUser question:\n${prompt}`,
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
    const panel = document.getElementById('viewAssistantPanel');
    const reopenBtn = document.getElementById('viewAssistantReopenBtn');
    if (panel) panel.hidden = true;
    if (reopenBtn) reopenBtn.hidden = false;
}

function reopenViewAssistantPanel() {
    const panel = document.getElementById('viewAssistantPanel');
    const reopenBtn = document.getElementById('viewAssistantReopenBtn');
    if (panel) panel.hidden = false;
    if (reopenBtn) reopenBtn.hidden = true;
}

// ROAS validity check — null if invalid, percentage if valid
const _vR = (sp, rev) => {
    if (!sp || sp <= 0 || !rev || rev < 0) return null;
    if (rev / sp > 50) return null; // >5000% = matching error
    return (rev / sp) * 100;
};

// Derive ALL formulated metrics from raw summable totals
// Called AFTER aggregation at every level: ad, adset, campaign, account
function deriveMetrics(r) {
    const p0p1 = (r.p0_signup || 0) + (r.p1_signup || 0);
    const d6Rev = r.d6_overall_revenue || 0;
    const d6Con = r.d6 || 0;
    return {
        ...r,
        // Delivery
        cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : null,
        ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null,
        cpi: r.installs > 0 ? r.spend / r.installs : null,
        // Video
        hook: r.impressions > 0 ? (r.p25 / r.impressions) * 100 : null,
        hold: r.p25 > 0 ? (r.thruplay / r.p25) * 100 : null,
        fullPlay: r.impressions > 0 ? (r.p100 / r.impressions) * 100 : null,
        // Funnel
        signupCost: r.signups > 0 ? r.spend / r.signups : null,
        signupPct: r.installs > 0 ? (r.signups / r.installs) * 100 : null,
        p0p1: p0p1,
        p0p1Cost: p0p1 > 0 ? r.spend / p0p1 : null,
        p0p1Pct: r.signups > 0 ? (p0p1 / r.signups) * 100 : null,
        d0TrialCost: r.d0_trial > 0 ? r.spend / r.d0_trial : null,
        d0CAC: r.d0 > 0 ? r.spend / r.d0 : null,
        // D6
        d6Con: d6Con,
        d6CAC: d6Con > 0 ? r.spend / d6Con : null,
        d6Rev: d6Rev,
        d6ROAS: _vR(r.spend, d6Rev) ?? 0,
        // Higher windows
        d15ROAS: _vR(r.spend, r.d15_overall_revenue) ?? 0,
        d30ROAS: _vR(r.spend, r.d30_overall_revenue) ?? 0,
        d60ROAS: _vR(r.spend, r.d60_overall_revenue) ?? 0,
        overallROAS: _vR(r.spend, r.overall_revenue) ?? 0,
    };
}

function matureFunnelRow(row, asOfDateStr) {
    // D6 is treated as revenue/conversions accrued so far inside the first 6 days
    // from signup, not only after the full 6-day cohort matures. That means the
    // latest signup date in a week can still contribute d0..d5 into D6.
    return { ...(row || {}) };
}

// Force refresh — clears all server caches then re-fetches
window.forceRefresh = async function() {
    try { await fetch('/api/cache/clear', { method: 'POST' }); } catch(e) {}
    fetchLiveData();
};

async function fetchLiveData(customDateFrom, customDateTo) {
    showLoading(true);
    try {
        // Keep the default load window smaller and avoid "today" so the portal opens fast
        // even when the current-day range has not been warmed yet.
        const defaultDateTo = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        const defaultDateFrom = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
        const dateTo = customDateTo || defaultDateTo;
        const dateFrom = customDateFrom || defaultDateFrom;
        currentDateRange = { since: dateFrom, until: dateTo, label: buildDateRangeLabel(dateFrom, dateTo) };
        console.log(`[fetchLiveData] Fetching ${dateFrom} to ${dateTo}...`);

        // Parallel fetch: Meta insights + Metabase funnel (required) + Ad statuses (optional)
        const [metaRes, funnelRes, adsStatusRes] = await Promise.all([
            fetch('/api/meta/ad-insights-daily', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom, dateTo })
            }).then(r => r.json()),
            fetch('/api/metabase/ad-funnel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom, dateTo })
            }).then(r => r.json()),
            fetch('/api/meta/ads-status').then(r => r.json()).catch(() => ({ success: false, data: [] }))
        ]);

        if (!metaRes.success && !metaRes.data) {
            throw new Error('Meta API failed: ' + (metaRes.error || 'Unknown error'));
        }

        // Load full Android account data here.
        // View-level scoping is applied later so only dashboard/alerts/simulator stay test-only.
        const TEST_CAMPAIGNS_SET = new Set(TEST_CAMPAIGNS);
        const metaRows = metaRes.data || [];
        const funnelRows = funnelRes.data || [];
        const adsStatus = adsStatusRes.data || [];
        console.log(`[fetchLiveData] Meta: ${metaRows.length} rows, Funnel: ${funnelRows.length} rows, Ads: ${adsStatus.length}${!adsStatusRes.success ? ' (status unavailable - using spend as proxy)' : ''}`);
        _verifyDailyBase = { metaRows, funnelRows, dateFrom, dateTo };
        _verifyDeltaCache = { from: null, to: null, fetchedAt: 0, metaRows: [], funnelRows: [] };

        // Build ad status lookup: ad_id -> { status, campaign_name, created_time }
        const adStatusMap = {};
        adsStatus.forEach(ad => { adStatusMap[ad.ad_id] = ad; });

        // Canonical join: date|||campaign_name|||adset_name|||tracker_name
        const mbDaily = {};
        for (const row of funnelRows) {
            const key = buildJoinKey(row.date, row.campaign_name, row.ad_set_name, row.tracker_name);
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

        // Aggregate per campaign|||adset|||ad_name with daily Metabase matching
        const adAgg = {};
        let matchedKeys = 0;
        let unmatchedKeys = 0;
        for (const row of metaRows) {
            const adUid = (row.campaign_name || '') + '|||' + (row.adset_name || '') + '|||' + (row.ad_name || '');
            if (!adAgg[adUid]) {
                adAgg[adUid] = {
                    ad_name: row.ad_name, ad_id: row.ad_id,
                    campaign_name: row.campaign_name, campaign_id: row.campaign_id,
                    adset_name: row.adset_name, adset_id: row.adset_id,
                    spend: 0, impressions: 0, clicks: 0, installs: 0,
                    thruplay: 0, p25: 0, p100: 0,
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
            a.spend += (row.spend || 0) * 1.18; // GST
            a.impressions += row.impressions || 0;
            a.clicks += row.clicks || 0;
            a.installs += row.installs || 0;
            a.thruplay += row.thruplay || 0;
            a.p25 += row.p25 || 0;
            a.p100 += row.p100 || 0;
            if (row.spend > 0) a.dates.push(row.date_start);

            // Canonical join — Daily key match to Metabase
            const mbKey = buildJoinKey(row.date_start, row.campaign_name, row.adset_name, row.ad_name);
            const mb = mbDaily[mbKey];
            if (mb) {
                matchedKeys++;
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
            } else {
                unmatchedKeys++;
            }
        }

        // Add ACTIVE ads that have no spend in the date range (newly created, not yet delivered)
        if (adsStatus.length > 0) {
            const existingAdIds = new Set(Object.values(adAgg).map(a => a.ad_id));
            adsStatus.forEach(ad => {
                if (ad.status === 'ACTIVE' && !existingAdIds.has(ad.ad_id)) {
                    const uid = (ad.campaign_name || '') + '|||' + '|||' + (ad.ad_name || '');
                    adAgg[uid] = {
                        ad_name: ad.ad_name, ad_id: ad.ad_id,
                        campaign_name: ad.campaign_name, campaign_id: ad.campaign_id,
                        adset_name: '', adset_id: '',
                        spend: 0, impressions: 0, clicks: 0, installs: 0,
                        thruplay: 0, p25: 0, p100: 0,
                        signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
                        d6: 0, d6_revenue: 0, overall_revenue: 0,
                        d6_overall_con: 0, d6_overall_revenue: 0,
                        p0_signup: 0, p1_signup: 0, total_trial: 0,
                        dates: [], _matched: false,
                    };
                }
            });
        }

        // Map to window.allData contract
        // Step 1: raw ad totals already built in adAgg (summable metrics only)
        // Step 2: deriveMetrics() computes all formulated metrics from raw totals
        allData = Object.values(adAgg).map((a, idx) => {
            const statusInfo = adStatusMap[a.ad_id];
            const hasStatusData = adsStatus.length > 0;
            const isActive = hasStatusData
                ? (statusInfo && statusInfo.status === 'ACTIVE')
                : a.spend > 0;
            const isTestCampaign = TEST_CAMPAIGNS.includes(a.campaign_name);
            const spendDates = a.dates.sort();

            // Parse go-live date from ad name suffix (e.g. _030326 = March 3, 2026)
            const adDateMatch = (a.ad_name || '').match(/(\d{6})$/);
            let goLiveDateISO = null;
            if (adDateMatch) {
                const dd = adDateMatch[1].slice(0, 2), mm = adDateMatch[1].slice(2, 4), yy = adDateMatch[1].slice(4, 6);
                goLiveDateISO = '20' + yy + '-' + mm + '-' + dd;
            }
            const goLiveDate = goLiveDateISO || ((statusInfo && statusInfo.created_time) ? statusInfo.created_time.slice(0, 10) : (spendDates.length > 0 ? spendDates[0] : ''));
            const daysLive = goLiveDate ? Math.max(0, Math.round((Date.now() - new Date(goLiveDate).getTime()) / 86400000)) : 0;
            const isMatured = daysLive >= 14;

            // Derive all formulated metrics from raw ad totals
            const m = deriveMetrics(a);

            // Compute testPerf — maturity-aware (uses derived d6ROAS)
            let testPerf = '';
            if (!isMatured) {
                testPerf = 'Try';
            } else if (a.spend >= 20000 && m.d6ROAS < 5) testPerf = 'Drop';
            else if (a.spend >= 15000 && m.d6ROAS < 15) testPerf = 'Failed';
            else if (a.spend < 15000) testPerf = 'Try';
            else if (a.spend >= 15000 && m.d6ROAS > 40) testPerf = 'Exceptional';
            else if (a.spend >= 15000 && m.d6ROAS > 28) testPerf = 'Performed';

            const rnd = (v) => v != null ? Math.round(v * 100) / 100 : 0;

            return {
                sno: idx + 1,
                name: a.ad_name,
                type: detectType(a.ad_name),
                date: goLiveDate,
                live: isActive ? 'Live' : 'Paused',
                testPerf: testPerf,
                nextSteps: '',
                daysLive: daysLive,
                isMatured: isMatured,
                goLiveDateISO: goLiveDate || null,
                // Raw summable metrics (pass through)
                spent: rnd(a.spend),
                impressions: a.impressions,
                clicks: a.clicks,
                installs: a.installs,
                signups: a.signups,
                d0Trials: a.d0_trial,
                d0: a.d0,
                d6: m.d6Con,
                thruPlays: a.thruplay,
                threeSecViews: a.p25,
                p0p1: m.p0p1,
                // Revenue (raw)
                d6OverallRevenue: rnd(m.d6Rev),
                d15OverallRevenue: rnd(a.d15_overall_revenue || 0),
                d30OverallRevenue: rnd(a.d30_overall_revenue || 0),
                d60OverallRevenue: rnd(a.d60_overall_revenue || 0),
                overallRevenue: rnd(a.overall_revenue || 0),
                // Derived formulated metrics (computed AFTER aggregation)
                cpm: rnd(m.cpm),
                ctr: rnd(m.ctr),
                cpi: rnd(m.cpi),
                signupCost: rnd(m.signupCost),
                signupPct: rnd(m.signupPct),
                p0p1Pct: rnd(m.p0p1Pct),
                p0p1Cost: rnd(m.p0p1Cost),
                d0TrialCost: rnd(m.d0TrialCost),
                d0CAC: rnd(m.d0CAC),
                d6CAC: rnd(m.d6CAC),
                d6ROAS: rnd(m.d6ROAS),
                d15ROAS: rnd(m.d15ROAS),
                d30ROAS: rnd(m.d30ROAS),
                d60ROAS: rnd(m.d60ROAS),
                overallROAS: rnd(m.overallROAS),
                hook: rnd(m.hook),
                hold: rnd(m.hold),
                fullPlay: rnd(m.fullPlay),
                // Metadata
                campaign_name: a.campaign_name,
                adset_name: a.adset_name,
                ad_id: a.ad_id,
                _isTestCampaign: isTestCampaign,
                _source: 'api',
                _raw: a, // keep raw totals for pivot/rollup
                _dateRange: {
                    fetchFrom: dateFrom,
                    fetchTo: dateTo,
                    adFrom: goLiveDate && goLiveDate > dateFrom ? goLiveDate : dateFrom,
                    adTo: dateTo,
                    label: (goLiveDate && goLiveDate > dateFrom ? goLiveDate : dateFrom).slice(5) + ' → ' + dateTo.slice(5),
                },
            };
        }).filter(d => d.name && d.name.includes('FB_'));

        // Compute Week-over-Week trends from daily data (zero-cost — data already in memory)
        computeWoWTrends(allData, metaRows, mbDaily, funnelRows);

        const matched = allData.filter(d => d.signups > 0 || d.d6 > 0).length;
        console.log(`[fetchLiveData] ${allData.length} ads loaded (${matched} with funnel data). Test: ${allData.filter(d => d._isTestCampaign).length}`);
        currentDataMode = summarizeMaturity(allData);
        currentDiagnostics = { source: 'Meta + Metabase', matchedKeys, unmatchedKeys };

        window.allData = allData;
        window.filteredData = filteredData;
        // Show data freshness
        const metaAge = metaRes.data_age_min;
        const funnelAge = funnelRes.data_age_min;
        const staleWarning = metaRes.stale || funnelRes.stale;
        let freshness = new Date().toLocaleTimeString();
        if (metaAge || funnelAge) freshness += ` (cached: Meta ${metaAge || 0}m, Funnel ${funnelAge || 0}m ago)`;
        if (staleWarning) freshness += ' ⚠️ STALE';
        document.getElementById('lastUpdated').textContent = freshness;
        applyFilters();
        publishPortalContext();
        renderCurrentView();
        showLoading(false);

        // Cross-verification disabled — sheet has all-time data, API has 30 days
        crossVerifyWithSheet();
    } catch (err) {
        console.error('[fetchLiveData] Error:', err);
        showLoading(false);
        // Show error as a banner at top of page, don't block navigation
        let errBanner = document.getElementById('fetchErrorBanner');
        if (!errBanner) {
            errBanner = document.createElement('div');
            errBanner.id = 'fetchErrorBanner';
            errBanner.style.cssText = 'position:fixed;top:0;left:220px;right:0;z-index:999;padding:12px 20px;background:#ef4444;color:#fff;font-size:13px;display:flex;align-items:center;gap:12px;';
            const main = document.querySelector('.main-content');
            if (main) main.prepend(errBanner);
            else document.body.prepend(errBanner);
        }
        errBanner.innerHTML = `<span style="flex:1;">Failed to load data: ${err.message}</span><button onclick="fetchLiveData();this.parentElement.remove();" style="padding:6px 16px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:#fff;border-radius:6px;cursor:pointer;font-size:12px;">Retry</button>`;
    }
}

// =========================================================================
// WEEK-OVER-WEEK TREND COMPUTATION
// Computes WoW changes from daily data already in memory (zero extra API calls)
// =========================================================================
function computeWoWTrends(ads, metaRows, mbDaily, funnelRows) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekAgo = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
    const twoWeeksAgo = new Date(now - 14 * 86400000).toISOString().slice(0, 10);
    const threeWeeksAgo = new Date(now - 21 * 86400000).toISOString().slice(0, 10);

    // Build per-ad weekly buckets from daily Meta+Metabase data
    // thisWeek = last 7 days, lastWeek = 8-14 days ago, prevWeek = 15-21 days ago
    const adWeekly = {}; // adUid -> { thisWeek: {spend,signups,...}, lastWeek: {...}, prevWeek: {...} }

    metaRows.forEach(row => {
        const adUid = (row.campaign_name || '') + '|||' + (row.adset_name || '') + '|||' + (row.ad_name || '');
        if (!adWeekly[adUid]) {
            adWeekly[adUid] = {
                thisWeek: { spend: 0, installs: 0, signups: 0, d0_trial: 0, d6_overall_revenue: 0, overall_revenue: 0, d6_overall_con: 0 },
                lastWeek: { spend: 0, installs: 0, signups: 0, d0_trial: 0, d6_overall_revenue: 0, overall_revenue: 0, d6_overall_con: 0 },
                prevWeek: { spend: 0, installs: 0, signups: 0, d0_trial: 0, d6_overall_revenue: 0, overall_revenue: 0, d6_overall_con: 0 },
            };
        }
        const d = row.date_start;
        let bucket = null;
        if (d >= weekAgo) bucket = adWeekly[adUid].thisWeek;
        else if (d >= twoWeeksAgo) bucket = adWeekly[adUid].lastWeek;
        else if (d >= threeWeeksAgo) bucket = adWeekly[adUid].prevWeek;
        if (!bucket) return;

        bucket.spend += (row.spend || 0) * 1.18;
        bucket.installs += row.installs || 0;

        // FIXED: ID-based join — Match to Metabase for funnel data
        const mbKey = d + '|||' + (row.campaign_id || '') + '|||' + (row.adset_name || '').toLowerCase().trim() + '|||' + (row.ad_name || '').replace(/:.*$/, '');
        const mb = mbDaily[mbKey];
        if (mb) {
            bucket.signups += mb.signups;
            bucket.d0_trial += mb.d0_trial;
            bucket.d6_overall_revenue += mb.d6_overall_revenue;
            bucket.overall_revenue += mb.overall_revenue;
            bucket.d6_overall_con += mb.d6_overall_con;
        }
    });

    // Compute derived metrics per weekly bucket — uses shared deriveMetrics()
    function deriveWeekly(b) {
        return deriveMetrics(b);
    }

    function wowPct(curr, prev) {
        if (prev == null || prev === 0 || curr == null) return null;
        return ((curr - prev) / Math.abs(prev)) * 100;
    }

    // Attach _wow to each ad in allData
    ads.forEach(ad => {
        const adUid = (ad.campaign_name || '') + '|||' + (ad.adset_name || '') + '|||' + (ad.name || '');
        const weekly = adWeekly[adUid];
        if (!weekly) {
            ad._wow = null;
            return;
        }

        const tw = deriveWeekly(weekly.thisWeek);
        const lw = deriveWeekly(weekly.lastWeek);
        const pw = deriveWeekly(weekly.prevWeek);

        // WoW changes: current week vs last week
        const signupCost_wow = wowPct(tw.signupCost, lw.signupCost);
        const d0TrialCost_wow = wowPct(tw.d0TrialCost, lw.d0TrialCost);
        const cpi_wow = wowPct(tw.cpi, lw.cpi);
        const signups_wow = wowPct(tw.signups, lw.signups);
        const d0Trial_wow = wowPct(tw.d0_trial, lw.d0_trial);
        const d6Conv_wow = wowPct(tw.d6_overall_con, lw.d6_overall_con);
        const d6Revenue_wow = wowPct(tw.d6_overall_revenue, lw.d6_overall_revenue);

        // 2-week consecutive check: did last week also decline vs prev week?
        const signupCost_wow2 = wowPct(lw.signupCost, pw.signupCost);
        const d0TrialCost_wow2 = wowPct(lw.d0TrialCost, pw.d0TrialCost);
        const signups_wow2 = wowPct(lw.signups, pw.signups);
        const d0Trial_wow2 = wowPct(lw.d0_trial, pw.d0_trial);
        const d6Conv_wow2 = wowPct(lw.d6_overall_con, pw.d6_overall_con);
        const d6Revenue_wow2 = wowPct(lw.d6_overall_revenue, pw.d6_overall_revenue);

        // For matured ads: D6 metrics excluding current week (sum raw → derive)
        let maturedD6ROAS = null, maturedD6CAC = null;
        if (ad.isMatured) {
            const maturedRaw = sumRaw([weekly.lastWeek, weekly.prevWeek]);
            const maturedM = deriveMetrics(maturedRaw);
            maturedD6ROAS = maturedM.d6ROAS || null;
            maturedD6CAC = maturedM.d6CAC;
        }

        // Determine overall trend direction
        let trendBreaches = 0, trendHits = 0;
        // Cost metrics: increasing = bad
        if (signupCost_wow > 20) trendBreaches++;
        if (d0TrialCost_wow > 20) trendBreaches++;
        if (cpi_wow > 15) trendBreaches++;
        // Output metrics: declining = bad
        if (signups_wow < -20) trendBreaches++;
        if (d0Trial_wow < -20) trendBreaches++;
        if (d6Conv_wow < -25) trendBreaches++;
        if (d6Revenue_wow < -25) trendBreaches++;
        // 2-week consecutive decline = extra breach
        if (signupCost_wow > 20 && signupCost_wow2 > 20) trendBreaches++;
        if (d0TrialCost_wow > 20 && d0TrialCost_wow2 > 20) trendBreaches++;
        if (signups_wow < -20 && signups_wow2 < -20) trendBreaches++;
        if (d0Trial_wow < -20 && d0Trial_wow2 < -20) trendBreaches++;
        if (d6Conv_wow < -25 && d6Conv_wow2 < -25) trendBreaches++;
        if (d6Revenue_wow < -25 && d6Revenue_wow2 < -25) trendBreaches++;
        // Improving signals
        if (signupCost_wow < -15) trendHits++;
        if (d0TrialCost_wow < -15) trendHits++;
        if (cpi_wow < -10) trendHits++;
        if (signups_wow > 15) trendHits++;
        if (d0Trial_wow > 15) trendHits++;
        if (d6Conv_wow > 20) trendHits++;
        if (d6Revenue_wow > 20) trendHits++;
        if (signups_wow > 15 && signups_wow2 > 15) trendHits++;
        if (d0Trial_wow > 15 && d0Trial_wow2 > 15) trendHits++;
        if (d6Conv_wow > 20 && d6Conv_wow2 > 20) trendHits++;
        if (d6Revenue_wow > 20 && d6Revenue_wow2 > 20) trendHits++;

        const trendDirection = trendBreaches >= 2 ? 'declining' : trendHits >= 2 ? 'improving' : 'stable';
        const continuousDecline = (
            (signupCost_wow > 20 && signupCost_wow2 > 20) ||
            (d0TrialCost_wow > 20 && d0TrialCost_wow2 > 20) ||
            (signups_wow < -20 && signups_wow2 < -20) ||
            (d0Trial_wow < -20 && d0Trial_wow2 < -20) ||
            (d6Conv_wow < -25 && d6Conv_wow2 < -25) ||
            (d6Revenue_wow < -25 && d6Revenue_wow2 < -25)
        );
        const continuousIncrease = (
            (signupCost_wow < -15 && signupCost_wow2 < -15) ||
            (d0TrialCost_wow < -15 && d0TrialCost_wow2 < -15) ||
            (signups_wow > 15 && signups_wow2 > 15) ||
            (d0Trial_wow > 15 && d0Trial_wow2 > 15) ||
            (d6Conv_wow > 20 && d6Conv_wow2 > 20) ||
            (d6Revenue_wow > 20 && d6Revenue_wow2 > 20)
        );

        ad._wow = {
            thisWeek: tw, lastWeek: lw, prevWeek: pw,
            signupCost_wow: signupCost_wow != null ? Math.round(signupCost_wow * 10) / 10 : null,
            d0TrialCost_wow: d0TrialCost_wow != null ? Math.round(d0TrialCost_wow * 10) / 10 : null,
            cpi_wow: cpi_wow != null ? Math.round(cpi_wow * 10) / 10 : null,
            signupCost_wow2: signupCost_wow2 != null ? Math.round(signupCost_wow2 * 10) / 10 : null,
            d0TrialCost_wow2: d0TrialCost_wow2 != null ? Math.round(d0TrialCost_wow2 * 10) / 10 : null,
            signups_wow: signups_wow != null ? Math.round(signups_wow * 10) / 10 : null,
            d0Trial_wow: d0Trial_wow != null ? Math.round(d0Trial_wow * 10) / 10 : null,
            d6Conv_wow: d6Conv_wow != null ? Math.round(d6Conv_wow * 10) / 10 : null,
            d6Revenue_wow: d6Revenue_wow != null ? Math.round(d6Revenue_wow * 10) / 10 : null,
            signups_wow2: signups_wow2 != null ? Math.round(signups_wow2 * 10) / 10 : null,
            d0Trial_wow2: d0Trial_wow2 != null ? Math.round(d0Trial_wow2 * 10) / 10 : null,
            d6Conv_wow2: d6Conv_wow2 != null ? Math.round(d6Conv_wow2 * 10) / 10 : null,
            d6Revenue_wow2: d6Revenue_wow2 != null ? Math.round(d6Revenue_wow2 * 10) / 10 : null,
            trendBreaches, trendHits, trendDirection,
            continuousDecline, continuousIncrease,
            maturedD6ROAS: maturedD6ROAS != null ? Math.round(maturedD6ROAS * 100) / 100 : null,
            maturedD6CAC: maturedD6CAC != null ? Math.round(maturedD6CAC * 100) / 100 : null,
        };
    });

    const withTrends = ads.filter(d => d._wow && d._wow.trendDirection !== 'stable').length;
    console.log(`[WoW] Computed trends for ${ads.length} ads. ${withTrends} with non-stable trends.`);
}

function detectType(name) {
    if (!name) return '';
    if (name.toLowerCase().includes('video')) return 'Video';
    if (name.toLowerCase().includes('static')) return 'Static';
    return '';
}

function getEvaluatedD6ROAS(creative) {
    if (!creative) return 0;
    if (creative.isMatured && creative._wow && creative._wow.maturedD6ROAS != null) {
        return creative._wow.maturedD6ROAS;
    }
    return creative.d6ROAS || 0;
}

function getD6RankingMode(creative) {
    if (!creative) return 'Full Data';
    if (creative.isMatured && creative._wow && creative._wow.maturedD6ROAS != null) return 'Mature Eval';
    if (creative.isMatured) return 'Mature Full';
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
// CROSS-VERIFICATION — Compare API data vs Google Sheet in background
// =========================================================================

const VERIFY_SHEET_ID = '15cUn1ykWCttlk4G1y2SvT2yKoceRqsHRYJEnWeqzEIk';
const VERIFY_SHEET_NAME = 'Creative Performance Tracker-Auto';

function crossVerifyWithSheet() {
    // Fetch sheet data via JSONP in background (non-blocking)
    const callbackName = 'verifySheetCb_' + Date.now();
    const script = document.createElement('script');
    const timeout = setTimeout(() => { cleanup(); updateVerifyBadge('timeout', 'Sheet verification timed out'); }, 30000);

    function cleanup() {
        clearTimeout(timeout);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[callbackName] = async function(response) {
        cleanup();
        try {
            const sheetRows = parseVerifySheet(response);
            await runVerification(sheetRows);
        } catch(e) {
            console.warn('[Verify] Sheet parse failed:', e);
            updateVerifyBadge('error', 'Sheet parse error');
        }
    };

    const url = `https://docs.google.com/spreadsheets/d/${VERIFY_SHEET_ID}/gviz/tq?tqx=out:json;responseHandler:${callbackName}&sheet=${encodeURIComponent(VERIFY_SHEET_NAME)}`;
    script.src = url;
    script.onerror = () => { cleanup(); updateVerifyBadge('error', 'Sheet fetch failed'); };
    document.body.appendChild(script);
}

function parseVerifySheet(response) {
    const table = response.table;
    const headers = table.cols.map(c => (c.label && c.label.trim()) || c.id);
    const rows = [];
    for (const row of table.rows) {
        const obj = {};
        row.c.forEach((cell, idx) => {
            if (idx < headers.length && cell) {
                obj[headers[idx]] = cell.f != null ? String(cell.f) : (cell.v != null ? String(cell.v) : '');
            }
        });
        rows.push(obj);
    }
    return rows;
}

function parseSheetDate(value) {
    const raw = String(value || '').trim();
    const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return null;
}

function addDaysISO(dateStr, days) {
    if (!dateStr) return null;
    const dt = new Date(String(dateStr).substring(0, 10) + 'T00:00:00');
    if (Number.isNaN(dt.getTime())) return null;
    dt.setDate(dt.getDate() + days);
    return dt.toISOString().slice(0, 10);
}

async function fetchVerificationDelta(dateFrom, dateTo) {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
        return { metaRows: [], funnelRows: [] };
    }
    const cacheFresh = _verifyDeltaCache.from === dateFrom &&
        _verifyDeltaCache.to === dateTo &&
        (Date.now() - _verifyDeltaCache.fetchedAt) < 10 * 60 * 1000;
    if (cacheFresh) {
        return { metaRows: _verifyDeltaCache.metaRows, funnelRows: _verifyDeltaCache.funnelRows };
    }

    const [metaRes, funnelRes] = await Promise.all([
        fetch('/api/meta/ad-insights-daily', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dateFrom, dateTo })
        }).then(r => r.json()).catch(() => ({ success: false, data: [] })),
        fetch('/api/metabase/ad-funnel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dateFrom, dateTo })
        }).then(r => r.json()).catch(() => ({ success: false, data: [] })),
    ]);

    const delta = {
        metaRows: metaRes.success ? (metaRes.data || []) : [],
        funnelRows: funnelRes.success ? (funnelRes.data || []) : [],
    };
    _verifyDeltaCache = { from: dateFrom, to: dateTo, fetchedAt: Date.now(), ...delta };
    return delta;
}

function buildVerificationDailyIndex(metaRows, funnelRows) {
    const funnelMap = new Map();
    for (const row of funnelRows || []) {
        const key = buildJoinKey(row.date, row.campaign_name, row.ad_set_name, row.tracker_name);
        const current = funnelMap.get(key) || { signups: 0, d6OverallRevenue: 0 };
        current.signups += Number(row.signups) || 0;
        current.d6OverallRevenue += Number(row.d6_overall_revenue) || 0;
        funnelMap.set(key, current);
    }

    const byCreative = new Map();
    for (const row of metaRows || []) {
        const key = buildJoinKey(row.date_start, row.campaign_name, row.adset_name, row.ad_name);
        const funnel = funnelMap.get(key) || { signups: 0, d6OverallRevenue: 0 };
        const daily = {
            date: String(row.date_start || '').substring(0, 10),
            spend: (Number(row.spend) || 0) * 1.18,
            signups: funnel.signups,
            d6OverallRevenue: funnel.d6OverallRevenue,
        };
        if (!byCreative.has(row.ad_name)) byCreative.set(row.ad_name, []);
        byCreative.get(row.ad_name).push(daily);
    }
    return byCreative;
}

function computeVerificationTotals(ad, sheetEntry, dailyIndex, compareTo) {
    const startDate = sheetEntry.startDate || ad.goLiveDateISO || currentDateRange.since;
    const totals = (dailyIndex.get(ad.name) || [])
        .filter(row => row.date >= startDate && row.date <= compareTo)
        .reduce((acc, row) => {
            acc.spend += row.spend || 0;
            acc.signups += row.signups || 0;
            acc.d6OverallRevenue += row.d6OverallRevenue || 0;
            return acc;
        }, { spend: 0, signups: 0, d6OverallRevenue: 0 });
    totals.d6ROAS = totals.spend > 0 ? (totals.d6OverallRevenue / totals.spend) * 100 : 0;
    totals.startDate = startDate;
    return totals;
}

async function runVerification(sheetRows) {
    // Build sheet lookup by creative name
    const sheetLookup = {};
    for (const row of sheetRows) {
        const name = findVal(row, ['Creative']);
        if (!name || !name.includes('FB_')) continue;
        const spend = pNum(findVal(row, ['Spent']));
        const signups = pNum(findVal(row, ['Signup']));
        const d6Roas = pPct(findVal(row, ['D6 ROAS']));
        const d6OverallRevenue = pNum(findVal(row, ['D6 Rev', 'd0_d6_revenue_overall', 'd6 revenue']));
        const startDate = parseSheetDate(findVal(row, ['Start date'])) || parseSheetDate(findVal(row, ['Go Live']));
        if (spend > 0) {
            sheetLookup[name.toLowerCase().trim()] = { name, spend, signups, d6Roas, d6OverallRevenue, startDate };
        }
    }

    // Compare with all loaded Facebook creatives that can reasonably match the sheet.
    // NOTE: Sheet may be broader than the active fetch range, so we keep the go-live guard.
    const fetchFrom = allData.length > 0 && allData[0]._dateRange ? allData[0]._dateRange.fetchFrom : '';
    const trackedAds = allData.filter(d => {
        if (!d || !d.name || !d.name.includes('FB_')) return false;
        if (!(d.spent > 0)) return false;
        if (!d.goLiveDateISO || !fetchFrom) return false;
        return d.goLiveDateISO >= fetchFrom;
    });
    const today = new Date().toISOString().slice(0, 10);
    const deltaFrom = currentDateRange.until && currentDateRange.until < today
        ? addDaysISO(currentDateRange.until, 1)
        : null;
    const delta = deltaFrom ? await fetchVerificationDelta(deltaFrom, today) : { metaRows: [], funnelRows: [] };
    const verifyMetaRows = (_verifyDailyBase.metaRows || []).concat(delta.metaRows || []);
    const verifyFunnelRows = (_verifyDailyBase.funnelRows || []).concat(delta.funnelRows || []);
    const dailyIndex = buildVerificationDailyIndex(verifyMetaRows, verifyFunnelRows);
    let matched = 0, mismatched = 0, missing = 0;
    const mismatches = [];

    for (const ad of trackedAds) {
        const key = ad.name.toLowerCase().trim();
        const sheet = sheetLookup[key];
        if (!sheet) { missing++; continue; }
        const totals = computeVerificationTotals(ad, sheet, dailyIndex, today);

        // Compare spend (1% tolerance)
        const spendPctDiff = sheet.spend > 0 ? Math.abs(totals.spend - sheet.spend) / sheet.spend * 100 : 0;
        // Compare signups (within 1)
        const signupDiff = Math.abs(totals.signups - sheet.signups);
        // Compare D6 ROAS (0.5% tolerance)
        const roasDiff = Math.abs((totals.d6ROAS || 0) - (sheet.d6Roas || 0));
        // Compare D6 overall revenue (1% tolerance)
        const d6RevenuePctDiff = sheet.d6OverallRevenue > 0 ? Math.abs((totals.d6OverallRevenue || 0) - sheet.d6OverallRevenue) / sheet.d6OverallRevenue * 100 : ((totals.d6OverallRevenue || 0) === 0 ? 0 : 100);

        const isMatch = spendPctDiff <= 1 && signupDiff <= 1 && roasDiff <= 0.5 && d6RevenuePctDiff <= 1;
        if (isMatch) {
            matched++;
        } else {
            mismatched++;
            mismatches.push({
                name: ad.name,
                apiSpend: Math.round(totals.spend),
                sheetSpend: Math.round(sheet.spend),
                apiSignups: totals.signups,
                sheetSignups: sheet.signups,
                apiD6Revenue: Math.round(totals.d6OverallRevenue || 0),
                sheetD6Revenue: Math.round(sheet.d6OverallRevenue || 0),
                apiD6Roas: (totals.d6ROAS || 0).toFixed(1),
                sheetD6Roas: (sheet.d6Roas || 0).toFixed(1),
                verifyStart: totals.startDate,
                verifyEnd: today,
            });
        }
    }

    const total = matched + mismatched;
    const matchPct = total > 0 ? Math.round(matched / total * 100) : 0;
    console.log(`[Verify] Sheet comparison: ${matched}/${total} matched (${matchPct}%), ${mismatched} mismatches, ${missing} not in sheet, ${trackedAds.length} creatives checked`);
    if (mismatches.length > 0) {
        console.log('[Verify] Mismatches:', mismatches.slice(0, 5));
    }

    // Store for tooltip/detail view
    window._verifyResult = {
        matched, mismatched, missing, total, matchPct, mismatches,
        checked: trackedAds.length,
        timestamp: new Date().toISOString(),
        compareTo: today,
        usesSheetWindow: true,
    };

    if (matchPct >= 90) {
        updateVerifyBadge('ok', `Sheet verified: ${matchPct}% match (${matched}/${total}) · 15m`);
    } else if (matchPct >= 70) {
        updateVerifyBadge('warn', `Sheet mismatch: ${matchPct}% match (${mismatched} diffs) · 15m`);
    } else {
        updateVerifyBadge('error', `Data drift: only ${matchPct}% match (${mismatched} diffs) · 15m`);
    }
}

function updateVerifyBadge(status, text) {
    let badge = document.getElementById('verifyBadge');
    if (!badge) {
        // Create badge next to lastUpdated
        const parent = document.getElementById('lastUpdated').parentElement;
        badge = document.createElement('span');
        badge.id = 'verifyBadge';
        badge.style.cssText = 'display:inline-block;margin-left:8px;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;cursor:pointer;vertical-align:middle;';
        badge.onclick = showVerifyDetails;
        parent.appendChild(badge);
    }

    if (status === 'ok') {
        badge.style.background = 'rgba(16,185,129,0.15)';
        badge.style.color = '#10b981';
        badge.textContent = '\u2713 ' + text;
    } else if (status === 'warn') {
        badge.style.background = 'rgba(245,158,11,0.15)';
        badge.style.color = '#f59e0b';
        badge.textContent = '\u26A0 ' + text;
    } else if (status === 'error') {
        badge.style.background = 'rgba(239,68,68,0.15)';
        badge.style.color = '#ef4444';
        badge.textContent = '\u2717 ' + text;
    } else {
        badge.style.background = 'rgba(100,100,100,0.15)';
        badge.style.color = '#888';
        badge.textContent = '\u231B ' + text;
    }
}

function showVerifyDetails() {
    const r = window._verifyResult;
    if (!r) return;

    let html = '<div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;" onclick="this.remove()">' +
        '<div style="background:var(--bg-card,#1a1a2e);border:1px solid var(--border,#333);border-radius:12px;padding:24px;max-width:700px;width:90%;max-height:80vh;overflow-y:auto;color:var(--text,#e0e0e0);" onclick="event.stopPropagation()">' +
        '<h3 style="margin:0 0 16px 0;font-size:16px;">Sheet Cross-Verification</h3>' +
        '<div style="display:flex;gap:12px;margin-bottom:16px;">' +
            '<div style="flex:1;background:rgba(16,185,129,0.1);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:24px;font-weight:700;color:#10b981;">' + r.matched + '</div><div style="font-size:11px;color:#888;">Matched</div></div>' +
            '<div style="flex:1;background:rgba(239,68,68,0.1);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:24px;font-weight:700;color:#ef4444;">' + r.mismatched + '</div><div style="font-size:11px;color:#888;">Mismatched</div></div>' +
            '<div style="flex:1;background:rgba(100,100,100,0.1);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:24px;font-weight:700;color:#888;">' + r.missing + '</div><div style="font-size:11px;color:#888;">Not in Sheet</div></div>' +
            '<div style="flex:1;background:rgba(99,102,241,0.1);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:24px;font-weight:700;color:#6366f1;">' + r.matchPct + '%</div><div style="font-size:11px;color:#888;">Match Rate</div></div>' +
            '<div style="flex:1;background:rgba(14,165,233,0.1);border-radius:8px;padding:12px;text-align:center;"><div style="font-size:24px;font-weight:700;color:#0ea5e9;">' + (r.checked || 0) + '</div><div style="font-size:11px;color:#888;">Checked</div></div>' +
        '</div>';

    if (r.mismatches && r.mismatches.length > 0) {
        html += '<h4 style="margin:0 0 8px 0;font-size:13px;color:#f59e0b;">Mismatches (top ' + Math.min(r.mismatches.length, 15) + ')</h4>' +
            '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
            '<thead><tr style="border-bottom:1px solid #333;">' +
                '<th style="text-align:left;padding:6px;">Creative</th>' +
                '<th style="text-align:right;padding:6px;">API Spend</th><th style="text-align:right;padding:6px;">Sheet Spend</th>' +
                '<th style="text-align:right;padding:6px;">API SU</th><th style="text-align:right;padding:6px;">Sheet SU</th>' +
                '<th style="text-align:right;padding:6px;">API D6 Rev</th><th style="text-align:right;padding:6px;">Sheet D6 Rev</th>' +
                '<th style="text-align:right;padding:6px;">API D6%</th><th style="text-align:right;padding:6px;">Sheet D6%</th>' +
            '</tr></thead><tbody>';

        r.mismatches.slice(0, 15).forEach(function(m) {
            var spendColor = Math.abs(m.apiSpend - m.sheetSpend) / Math.max(m.sheetSpend, 1) > 0.1 ? '#ef4444' : '#10b981';
            var suColor = Math.abs(m.apiSignups - m.sheetSignups) > 5 ? '#ef4444' : '#10b981';
            var d6RevColor = Math.abs(m.apiD6Revenue - m.sheetD6Revenue) / Math.max(m.sheetD6Revenue, 1) > 0.1 ? '#ef4444' : '#10b981';
            html += '<tr style="border-bottom:1px solid #222;">' +
                '<td style="padding:6px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + m.name.slice(0, 40) + '</td>' +
                '<td style="text-align:right;padding:6px;">' + m.apiSpend.toLocaleString() + '</td>' +
                '<td style="text-align:right;padding:6px;color:' + spendColor + ';">' + m.sheetSpend.toLocaleString() + '</td>' +
                '<td style="text-align:right;padding:6px;">' + m.apiSignups + '</td>' +
                '<td style="text-align:right;padding:6px;color:' + suColor + ';">' + m.sheetSignups + '</td>' +
                '<td style="text-align:right;padding:6px;">' + m.apiD6Revenue.toLocaleString() + '</td>' +
                '<td style="text-align:right;padding:6px;color:' + d6RevColor + ';">' + m.sheetD6Revenue.toLocaleString() + '</td>' +
                '<td style="text-align:right;padding:6px;">' + m.apiD6Roas + '%</td>' +
                '<td style="text-align:right;padding:6px;">' + m.sheetD6Roas + '%</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
    }

    html += '<p style="font-size:10px;color:#666;margin-top:12px;">Verified at: ' + new Date(r.timestamp).toLocaleString() + ' | Scheduled every 15 minutes | Sheet window: per-creative start date \u2192 ' + (r.compareTo || 'today') + ' | Tolerances: Spend 1%, Signups \u00B11, D6 Revenue 1%, D6 ROAS 0.5%</p>' +
        '<button onclick="this.closest(\'div[style*=fixed]\').remove()" style="margin-top:12px;padding:8px 20px;background:var(--accent,#6366f1);border:none;color:white;border-radius:6px;cursor:pointer;font-size:12px;">Close</button>' +
        '</div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
}

// Helper for sheet parsing
function findVal(obj, keys) {
    for (const k of keys) {
        for (const h of Object.keys(obj)) {
            if (h.toLowerCase().includes(k.toLowerCase()) && obj[h]) return obj[h];
        }
    }
    return '';
}
function pNum(v) {
    if (!v) return 0;
    return parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0;
}
function pPct(v) {
    if (!v) return 0;
    var n = parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0;
    // If already a decimal like 0.28, convert to percentage
    if (n > 0 && n < 1) n = n * 100;
    return n;
}

function parseNum(val) {
    if (!val) return 0;
    const cleaned = String(val).replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
}

function parsePercent(val) {
    if (!val) return 0;
    const cleaned = String(val).replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
}

function formatINR(n) {
    if (n >= 10000000) return '₹' + (n / 10000000).toFixed(1) + 'Cr';
    if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L';
    if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'K';
    return '₹' + Math.round(n);
}

function formatNum(n) {
    if (n >= 10000000) return (n / 10000000).toFixed(1) + 'Cr';
    if (n >= 100000) return (n / 100000).toFixed(1) + 'L';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return Math.round(n).toLocaleString();
}

// ---- Data Merging (Meta API + Google Sheets) ----
function normalizeCreativeName(name) {
    if (!name) return '';
    return name.trim().toLowerCase().replace(/\s+/g, '_');
}

function stripCreativePrefix(name) {
    if (!name) return '';
    return name.replace(/^FB_MOF_(Video_|Static_)?/i, '').trim().toLowerCase().replace(/\s+/g, '_');
}

// [Dead code removed — mergeDataSources/buildRawIndexes/aggregateMetrics replaced by fetchLiveData]

function _dead_code_placeholder() { /* removed */ }
/* --- CUT START (old sheets merge code removed) ---
function _removed_mergeDataSources() {
    if (!metaData.length) {
        allData = sheetsData.slice();
        window.allData = allData;
        return;
    }

    // Build lookup from sheets data by normalized name
    const sheetsMap = new Map();
    sheetsData.forEach(d => {
        sheetsMap.set(normalizeCreativeName(d.name), d);
    });

    // Also build a fallback map with prefix stripped
    const sheetsFallbackMap = new Map();
    sheetsData.forEach(d => {
        const stripped = stripCreativePrefix(d.name);
        if (stripped) sheetsFallbackMap.set(stripped, d);
    });

    const merged = [];
    const matchedSheetNames = new Set();

    // Match each Meta ad against sheets data
    metaData.forEach(metaAd => {
        const metaKey = normalizeCreativeName(metaAd.name);
        const metaStripped = stripCreativePrefix(metaAd.name);

        // Primary match: exact normalized name
        let sheetsRow = sheetsMap.get(metaKey);
        // Fallback: stripped prefix match
        if (!sheetsRow && metaStripped) {
            sheetsRow = sheetsFallbackMap.get(metaStripped);
        }

        if (sheetsRow) {
            matchedSheetNames.add(normalizeCreativeName(sheetsRow.name));
            // Merged record: Meta real-time + Sheets enrichment
            merged.push({
                sno: 0,
                name: metaAd.name,
                type: metaAd.type || sheetsRow.type,
                date: sheetsRow.date || metaAd.date,
                // Real-time from Meta
                spent: metaAd.spent,
                impressions: metaAd.impressions,
                cpm: metaAd.cpm,
                clicks: metaAd.clicks,
                ctr: metaAd.ctr,
                installs: metaAd.installs,
                cpi: metaAd.cpi,
                live: metaAd.live,
                // Enrichment from Sheets
                signups: sheetsRow.signups,
                signupCost: sheetsRow.signupCost,
                signupPct: sheetsRow.signupPct,
                d6: sheetsRow.d6,
                d6CAC: sheetsRow.d6CAC,
                d6ROAS: sheetsRow.d6ROAS,
                overallROAS: sheetsRow.overallROAS,
                overallRevenue: sheetsRow.overallRevenue,
                p0p1: sheetsRow.p0p1,
                p0p1Pct: sheetsRow.p0p1Pct,
                p0p1Cost: sheetsRow.p0p1Cost,
                d0Trials: sheetsRow.d0Trials,
                d0TrialCost: sheetsRow.d0TrialCost,
                d0: sheetsRow.d0,
                d0CAC: sheetsRow.d0CAC,
                hook: sheetsRow.hook,
                hold: sheetsRow.hold,
                fullPlay: sheetsRow.fullPlay,
                thruPlays: sheetsRow.thruPlays || metaAd.thruPlays,
                threeSecViews: sheetsRow.threeSecViews,
                nextSteps: sheetsRow.nextSteps,
                testPerf: sheetsRow.testPerf,
                week: sheetsRow.week,
                year: sheetsRow.year,
                campaignId: metaAd.campaignId,
                campaignName: metaAd.campaignName,
                _raw: metaAd._raw,
                _rawSheets: sheetsRow._raw,
                _source: 'merged'
            });
        } else {
            // Unmatched Meta ad
            merged.push({ ...metaAd, _source: 'meta' });
        }
    });

    // Add unmatched sheets rows
    sheetsData.forEach(d => {
        if (!matchedSheetNames.has(normalizeCreativeName(d.name))) {
            merged.push({ ...d, _source: 'sheets' });
        }
    });

    // Re-number
    merged.forEach((d, i) => { d.sno = i + 1; });

    const matchedCount = merged.filter(d => d._source === 'merged').length;
    const metaOnly = merged.filter(d => d._source === 'meta').length;
    const sheetsOnly = merged.filter(d => d._source === 'sheets').length;
    console.log(`Merge: ${matchedCount} matched, ${metaOnly} meta-only, ${sheetsOnly} sheets-only (total: ${merged.length})`);

    allData = merged;
    window.allData = allData;
}

// Pre-built lookup maps for fast aggregation (built once when raw data loads)
let adsDumpIndex = new Map();   // adName -> [{day, spend, impr, clicks, installs, thru, threeSec}]
let metabaseIndex = new Map();  // trackerName -> [{day, signups, p0, p1, d0Trial, d0, d6, ...}]

function buildRawIndexes() {
    console.time('buildRawIndexes');
    // Index Meta Ads Dump by Ad Name
    adsDumpIndex = new Map();
    metaAdsDumpRaw.forEach(row => {
        const adName = (row['Ad Name'] || '').trim().toLowerCase();
        if (!adName) return;
        const dayStr = row['Day'] || '';
        if (!dayStr) return;
        const dayTs = new Date(dayStr).getTime();
        if (isNaN(dayTs)) return;
        if (!adsDumpIndex.has(adName)) adsDumpIndex.set(adName, []);
        adsDumpIndex.get(adName).push({
            dayTs,
            spend: parseFloat(row['Amount Spent']) || 0,
            impr: parseFloat(row['Impressions']) || 0,
            clicks: parseFloat(row['Link Clicks']) || 0,
            installs: parseFloat(row['App Installs']) || 0,
            thru: parseFloat(row['ThruPlays']) || 0,
            threeSec: parseFloat(row['3-Second Video Views']) || 0
        });
    });

    // Index Metabase Import by tracker_name (only "Test" campaigns)
    metabaseIndex = new Map();
    metabaseImportRaw.forEach(row => {
        const campaign = row['campaign_name'] || '';
        if (!campaign.includes('Test')) return;
        const trackerName = (row['tracker_name'] || '').trim().toLowerCase();
        if (!trackerName) return;
        const dateStr = row['date'] || '';
        if (!dateStr) return;
        const dayTs = new Date(dateStr).getTime();
        if (isNaN(dayTs)) return;
        const pn = (v) => parseFloat(v) || 0;
        if (!metabaseIndex.has(trackerName)) metabaseIndex.set(trackerName, []);
        metabaseIndex.get(trackerName).push({
            dayTs,
            signups: pn(row['signups']),
            p0: pn(row['p0_signup']),
            p1: pn(row['p1_signup']),
            d0Trial: pn(row['d0_trial']),
            d0: pn(row['d0']),
            d0Revenue: pn(row['d0_revenue']),
            d6: pn(row['d0_2d_d6'] || row['d0-d6']),
            d6Revenue: pn(row['d0_2d_d6_revenue'] || row['d0-d6_revenue']),
            newConv: pn(row['new_converted_user']),
            newUserRev: pn(row['new_user_rev']),
            overallRev: pn(row['overall_revenue']),
            d6OverallCon: pn(row['d0_d6_overall']),
            d6OverallRev: pn(row['d0_d6_revenue_overall'])
        });
    });
    console.timeEnd('buildRawIndexes');
    console.log(`Indexed: ${adsDumpIndex.size} ad names, ${metabaseIndex.size} tracker names`);
}

function aggregateMetrics(creativeName, dateFrom, dateTo) {
    const nameNorm = creativeName.trim().toLowerCase();
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : 0;
    const toTs = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : Infinity;

    // --- Meta Ads Dump (fast lookup) ---
    let spend = 0, impressions = 0, clicks = 0, installs = 0, thruPlays = 0, threeSecViews = 0;
    const adsRows = adsDumpIndex.get(nameNorm);
    if (adsRows) {
        for (const r of adsRows) {
            if (r.dayTs < fromTs || r.dayTs > toTs) continue;
            spend += r.spend;
            impressions += r.impr;
            clicks += r.clicks;
            installs += r.installs;
            thruPlays += r.thru;
            threeSecViews += r.threeSec;
        }
    }
    spend *= 1.18;
    thruPlays *= 1.18;
    threeSecViews *= 1.18;

    // --- Metabase Import (fast lookup) ---
    let signups = 0, p0 = 0, p1 = 0, d0Trials = 0, d0 = 0, d0Revenue = 0;
    let d6 = 0, d6Revenue = 0, newConversions = 0, newUserRev = 0, overallRevenue = 0;
    let d6OverallCon = 0, d6OverallRevenue = 0;
    const mbRows = metabaseIndex.get(nameNorm);
    if (mbRows) {
        for (const r of mbRows) {
            if (r.dayTs < fromTs || r.dayTs > toTs) continue;
            signups += r.signups;
            p0 += r.p0;
            p1 += r.p1;
            d0Trials += r.d0Trial;
            d0 += r.d0;
            d0Revenue += r.d0Revenue;
            d6 += r.d6;
            d6Revenue += r.d6Revenue;
            newConversions += r.newConv;
            newUserRev += r.newUserRev;
            overallRevenue += r.overallRev;
            d6OverallCon += r.d6OverallCon;
            d6OverallRevenue += r.d6OverallRev;
        }
    }
    const p0p1 = p0 + p1;

    return {
        spent: spend, impressions, clicks, installs, thruPlays, threeSecViews,
        cpm: impressions > 0 ? (spend / impressions * 1000) : 0,
        ctr: impressions > 0 ? (clicks / impressions) : 0,
        cpi: installs > 0 ? (spend / installs) : 0,
        hook: impressions > 0 ? (threeSecViews / impressions) : 0,
        hold: threeSecViews > 0 ? (thruPlays / threeSecViews) : 0,
        fullPlay: impressions > 0 ? (thruPlays / impressions) : 0,
        signups, p0p1, d0Trials, d0, d6, newConversions,
        overallRevenue, d6Revenue, d6OverallRevenue,
        signupCost: signups > 0 ? (spend / signups) : 0,
        signupPct: installs > 0 ? (signups / installs) : 0,
        p0p1Pct: signups > 0 ? (p0p1 / signups) : 0,
        p0p1Cost: p0p1 > 0 ? (spend / p0p1) : 0,
        d0TrialCost: d0Trials > 0 ? (spend / d0Trials) : 0,
        d0CAC: d0 > 0 ? (spend / d0) : 0,
        d6CAC: d6 > 0 ? (spend / d6) : 0,
        d6ROAS: spend > 0 ? (d6OverallRevenue / spend * 100) : 0,
        newUserCAC: newConversions > 0 ? (spend / newConversions) : 0,
        overallROAS: spend > 0 ? (overallRevenue / spend * 100) : 0
    };
}
--- CUT END (old sheets merge code removed) --- */

// ---- Filters ----
function applyFilters() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const type = document.getElementById('typeFilter').value;
    const status = document.getElementById('statusFilter').value;
    const perf = document.getElementById('perfFilter').value;

    // Test campaign scoping: some views only show test campaign ads
    const currentView = getCurrentView();
    const testOnlyViews = ['dashboard', 'alerts', 'simulator'];
    const testOnly = testOnlyViews.includes(currentView);

    filteredData = allData.filter(d => {
        // Scope to test campaigns for test-only views
        if (testOnly && !d._isTestCampaign) return false;
        if (search && !d.name.toLowerCase().includes(search)) return false;
        if (type !== 'all' && d.type !== type) return false;
        if (status !== 'all' && d.live !== status) return false;
        if (perf !== 'all' && d.testPerf !== perf) return false;
        return true;
    });
    // Expose to AI layer
    window.allData = allData;
    window.filteredData = filteredData;
}

// ---- Navigation ----
const views = {
    dashboard: { title: 'Dashboard', subtitle: 'Overview of all Meta ad creatives' },
    creatives: { title: 'All Creatives', subtitle: 'Complete creative database' },
    new: { title: 'New This Week', subtitle: 'Recently launched creatives' },
    top: { title: 'Top Performers', subtitle: 'Best performing creatives by key metrics' },
    failures: { title: 'Underperformers', subtitle: 'Creatives that need attention or removal' },
    scorecard: { title: 'Scorecard', subtitle: 'Detailed performance scorecard per creative' },
    alerts: { title: 'Alerts', subtitle: 'Live creative alerts based on performance thresholds' },
    accounts: { title: 'Accounts', subtitle: 'Manage connected ad platform accounts' },
    campaignTree: { title: 'Campaign Tree', subtitle: 'Hierarchical campaign → adset → ad analysis with alerts' },
    intelligence: { title: 'AI Intelligence', subtitle: 'AI-powered analysis of what makes your creatives succeed or fail' },
    simulator: { title: 'ROAS Simulator', subtitle: 'Meta-only actual vs frozen checkpoint forecasts for immature ad cohorts' },
    recommendations: { title: 'Recommendations', subtitle: 'AI-generated creative recommendations based on learned patterns' },
    optimizer: { title: 'Campaign Optimizer', subtitle: 'Shared optimizer module with Meta and Google platform switching' },
    audienceTesting: { title: 'Audience Testing', subtitle: 'Audience performance analysis, pattern learning & AI recommendations' }
};

function setActiveView(view) {
    CURRENT_VIEW = view || 'dashboard';
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(view + 'View');
    if (target) target.classList.add('active');
    document.getElementById('pageTitle').textContent = views[view].title;
    document.getElementById('pageSubtitle').textContent = views[view].subtitle;
    publishPortalContext();
    renderCurrentView();
}

function applyStandaloneMode() {
    if (!APP_STANDALONE_MODE) return;
    document.body.classList.add('standalone-module');
    const appRoot = document.querySelector('.app');
    const sidebar = document.querySelector('.sidebar');
    const header = document.querySelector('.top-header');
    const assistant = document.getElementById('viewAssistantPanel');
    if (appRoot) appRoot.classList.add('standalone-module-shell');
    if (sidebar) sidebar.style.display = 'none';
    if (header) header.style.display = 'none';
    if (assistant) assistant.style.display = 'none';
}

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        setActiveView(item.dataset.view);
    });
});

function getCurrentView() {
    return CURRENT_VIEW || 'dashboard';
}

function renderCurrentView() {
    applyFilters();
    const view = getCurrentView();
    if (view === 'dashboard') renderDashboard();
    else if (view === 'creatives') renderTable();
    else if (view === 'new') renderNew();
    else if (view === 'top') renderTop();
    else if (view === 'failures') renderFailures();
    else if (view === 'scorecard') renderScorecardView();
    else if (view === 'alerts') renderAlertsPage();
    else if (view === 'accounts') renderAccountsView();
    else if (view === 'campaignTree') { /* rendered on-demand via fetchCampaignTree */ }
    else if (view === 'optimizer') { renderSharedOptimizerView(); }
    publishPortalContext();
}

function renderSharedOptimizerView() {
    const platform = window.OPTIMIZER_PLATFORM || 'meta';
    const metaPanel = document.querySelector('[data-platform-panel="meta"]');
    const googlePanel = document.querySelector('[data-platform-panel="google"]');
    document.querySelectorAll('.shared-platform-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.platform === platform);
    });
    if (metaPanel) metaPanel.classList.toggle('active', platform === 'meta');
    if (googlePanel) googlePanel.classList.toggle('active', platform === 'google');

    if (platform === 'meta') {
        if (typeof renderOptimizer === 'function') renderOptimizer();
    } else {
        const frame = document.getElementById('googleOptimizerFrame');
        if (frame && !frame.src) {
            frame.src = '/google-creative.html?view=gcOptimizer&embed=optimizer';
        }
    }
}

function setOptimizerPlatform(platform) {
    window.OPTIMIZER_PLATFORM = platform === 'google' ? 'google' : 'meta';
    if (getCurrentView() === 'optimizer') {
        document.getElementById('pageTitle').textContent = views.optimizer.title;
        document.getElementById('pageSubtitle').textContent = views.optimizer.subtitle;
        renderSharedOptimizerView();
        publishPortalContext();
    }
}

document.querySelectorAll('.shared-platform-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        setOptimizerPlatform(btn.dataset.platform);
    });
});

// ---- Dashboard ----
function renderDashboard() {
    const data = filteredData;
    const liveCount = data.filter(d => d.live === 'Live').length;
    // Sum raw metrics first, then derive all ratios from totals (never average percentages)
    const rawAds = data.filter(d => d._raw).map(d => d._raw);
    const totals = rawAds.length > 0 ? deriveMetrics(sumRaw(rawAds)) : {};
    const totalSpend = totals.spend || 0;
    const totalInstalls = totals.installs || 0;
    const totalSignups = totals.signups || 0;
    const avgCPI = totals.cpi || 0;
    const avgCTR = totals.ctr || 0;
    const avgROAS = totals.d6ROAS || 0;
    const avgOverallROAS = totals.overallROAS || 0;
    const avgSignupCost = totals.signupCost || 0;
    const avgP0P1Cost = totals.p0p1Cost || 0;
    const avgD0CAC = totals.d0CAC || 0;
    const avgD0TrialCost = totals.d0TrialCost || 0;
    const avgD6CAC = totals.d6CAC || 0;

    const mergedCount = data.filter(d => d._source === 'merged').length;
    const metaOnlyCount = data.filter(d => d._source === 'meta').length;
    const sheetsOnlyCount = data.filter(d => d._source === 'sheets').length;

    document.getElementById('kpiTotal').textContent = data.length;
    document.getElementById('kpiTotalSub').textContent = mergedCount
        ? `${mergedCount} merged, ${metaOnlyCount} meta, ${sheetsOnlyCount} sheets`
        : `${data.filter(d => d.type === 'Video').length} video, ${data.filter(d => d.type === 'Static').length} static`;
    document.getElementById('kpiLive').textContent = liveCount;
    document.getElementById('kpiLiveSub').textContent = `${data.length - liveCount} paused`;
    document.getElementById('kpiSpend').textContent = formatINR(totalSpend);
    document.getElementById('kpiSpendSub').textContent = `Avg ${formatINR(totalSpend / (data.length || 1))} per creative`;
    document.getElementById('kpiInstalls').textContent = formatNum(totalInstalls);
    document.getElementById('kpiInstallsSub').textContent = `${formatNum(totalSignups)} signups`;
    document.getElementById('kpiCPI').textContent = '₹' + Math.round(avgCPI);
    document.getElementById('kpiCPISub').textContent = `Across ${rawAds.length} creatives`;
    document.getElementById('kpiCTR').textContent = avgCTR.toFixed(2) + '%';
    document.getElementById('kpiCTRSub').textContent = `Across ${rawAds.length} creatives`;
    document.getElementById('kpiSignups').textContent = formatNum(totalSignups);
    document.getElementById('kpiSignupsSub').textContent = `${totalInstalls ? ((totalSignups / totalInstalls) * 100).toFixed(1) : 0}% of installs`;
    document.getElementById('kpiROAS').textContent = avgROAS.toFixed(1) + '%';
    document.getElementById('kpiROASSub').textContent = `Across ${rawAds.length} creatives`;
    document.getElementById('kpiOverallROAS').textContent = avgOverallROAS.toFixed(1) + '%';
    document.getElementById('kpiOverallROASSub').textContent = `Across ${rawAds.length} creatives`;
    document.getElementById('kpiSignupCost').textContent = '₹' + Math.round(avgSignupCost);
    document.getElementById('kpiSignupCostSub').textContent = `Across ${rawAds.length} creatives`;
    document.getElementById('kpiP0P1Cost').textContent = '₹' + Math.round(avgP0P1Cost);
    document.getElementById('kpiP0P1CostSub').textContent = `Across ${rawAds.length} creatives`;
    document.getElementById('kpiD0CAC').textContent = '₹' + Math.round(avgD0CAC);
    document.getElementById('kpiD0CACSub').textContent = `Across ${rawAds.length} creatives`;
    document.getElementById('kpiD0TrialCost').textContent = '₹' + Math.round(avgD0TrialCost);
    document.getElementById('kpiD0TrialCostSub').textContent = `Across ${rawAds.length} creatives`;
    document.getElementById('kpiD6CAC').textContent = '₹' + Math.round(avgD6CAC);
    document.getElementById('kpiD6CACSub').textContent = `Across ${rawAds.length} creatives`;

    // Performance distribution
    const perfCounts = {};
    ['Exceptional', 'Performed', 'Try', 'Failed', 'Drop', ''].forEach(p => {
        perfCounts[p || 'Untagged'] = data.filter(d => (d.testPerf || 'Untagged') === (p || 'Untagged')).length;
    });
    const perfColors = { Exceptional: 'var(--green)', Performed: 'var(--blue)', Try: 'var(--orange)', Failed: 'var(--red)', Drop: '#f87171', Untagged: 'var(--text-muted)' };
    const maxPerf = Math.max(...Object.values(perfCounts), 1);
    document.getElementById('perfDistribution').innerHTML = `<div class="bar-chart">${
        Object.entries(perfCounts).map(([k, v]) => `
            <div class="bar-row">
                <span class="bar-label">${k}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${(v / maxPerf) * 100}%;background:${perfColors[k]}">${v}</div></div>
                <span class="bar-count">${v}</span>
            </div>
        `).join('')
    }</div>`;

    // Type split
    const videoCount = data.filter(d => d.type === 'Video').length;
    const staticCount = data.filter(d => d.type === 'Static').length;
    const otherCount = data.length - videoCount - staticCount;
    document.getElementById('typeSplit').innerHTML = `<div class="bar-chart">
        <div class="bar-row"><span class="bar-label">Video</span><div class="bar-track"><div class="bar-fill" style="width:${(videoCount / (data.length || 1)) * 100}%;background:var(--accent)">${videoCount}</div></div><span class="bar-count">${((videoCount / (data.length || 1)) * 100).toFixed(0)}%</span></div>
        <div class="bar-row"><span class="bar-label">Static</span><div class="bar-track"><div class="bar-fill" style="width:${(staticCount / (data.length || 1)) * 100}%;background:var(--orange)">${staticCount}</div></div><span class="bar-count">${((staticCount / (data.length || 1)) * 100).toFixed(0)}%</span></div>
        ${otherCount ? `<div class="bar-row"><span class="bar-label">Other</span><div class="bar-track"><div class="bar-fill" style="width:${(otherCount / (data.length || 1)) * 100}%;background:var(--text-muted)">${otherCount}</div></div><span class="bar-count">${otherCount}</span></div>` : ''}
    </div>`;

    // Top 5 ROAS
    const topROAS = buildTopRoasRanking(data, { minSpend: 15000 });
    document.getElementById('topROAS').innerHTML = topROAS.length ? topROAS.map((d, i) => `
        <div class="rank-item">
            <span class="rank-num">#${i + 1}</span>
            <div class="rank-info">
                <div class="rank-name">${shortName(d.name)}</div>
                <div class="rank-meta">${d.type} | Spend: ${formatINR(d.spent)} | ${d._d6DataMode}</div>
            </div>
            <span class="rank-value">${d._rankD6ROAS.toFixed(0)}%</span>
        </div>
    `).join('') : '<p style="color:var(--text-dim);">No ROAS data yet.</p>';

    // Top 5 CPI
    const topCPI = [...data].filter(d => d.cpi > 0 && d.installs >= 10).sort((a, b) => a.cpi - b.cpi).slice(0, 5);
    document.getElementById('topCPI').innerHTML = topCPI.map((d, i) => `
        <div class="rank-item">
            <span class="rank-num">#${i + 1}</span>
            <div class="rank-info">
                <div class="rank-name">${shortName(d.name)}</div>
                <div class="rank-meta">${d.type} | Installs: ${formatNum(d.installs)}</div>
            </div>
            <span class="rank-value" style="color:var(--teal)">₹${Math.round(d.cpi)}</span>
        </div>
    `).join('');

    // Recent table
    const recent = [...data].sort((a, b) => parseDate(b.date) - parseDate(a.date)).slice(0, 10);
    document.getElementById('recentTable').innerHTML = `
        <table>
            <thead><tr>
                <th>Creative</th><th>Type</th><th>Date</th><th>Spend</th><th>CTR</th><th>CPI</th><th>Signups</th><th>D6 ROAS</th><th>Signup Cost</th><th>D0 Trial Cost</th><th>Status</th>
            </tr></thead>
            <tbody>${recent.map(d => `<tr>
                <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis">${shortName(d.name)}</td>
                <td><span class="cc-badge ${d.type === 'Video' ? 'badge-video' : 'badge-static'}">${d.type}</span></td>
                <td>${d.date || '-'}</td>
                <td>${formatINR(d.spent)}</td>
                <td>${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</td>
                <td>${d.cpi ? '₹' + Math.round(d.cpi) : '-'}</td>
                <td>${d.signups || 0}</td>
                <td style="color:${d.d6ROAS > 25 ? 'var(--green)' : d.d6ROAS > 10 ? 'var(--orange)' : 'var(--red)'}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</td>
                <td>${d.signupCost ? '₹' + Math.round(d.signupCost) : '-'}</td>
                <td>${d.d0TrialCost ? '₹' + Math.round(d.d0TrialCost) : '-'}</td>
                <td>${perfBadge(d.testPerf)}</td>
            </tr>`).join('')}</tbody>
        </table>
    `;

    // Render alerts
    renderAlerts();

    // Render live dashboard below
    renderLiveDashboard();
}

// Shared alert classification logic
// Determine if a creative is "matured" (go-live 14+ days ago)
// Maturity-aware alert classification — used by Dashboard, Campaign Tree, and Optimizer
// Matured = 14+ days since go-live (d.isMatured set in fetchLiveData from ad name date suffix)
function classifyAlert(d) {
    if (d.spent < 15000) return 'neutral';

    // WoW trend signals (apply to both matured and non-matured)
    const wow = d._wow || {};
    let trendBreaches = wow.trendBreaches || 0;
    let trendHits = wow.trendHits || 0;

    // NON-MATURED (<14 days): D6 metrics unreliable, use early funnel signals
    // EXCEPTION: if D6 ROAS is already exceptional, always green regardless of maturity
    if (!d.isMatured) {
        if (d.d6ROAS > 28) return 'green'; // exceptional early D6 signal

        let earlyBreaches = trendBreaches; // WoW declining trends count as breaches
        if (d.signupCost > 1000) earlyBreaches++;
        if (d.d0TrialCost > 3500) earlyBreaches++;
        if (d.cpi > 200) earlyBreaches++;
        if (d.installs > 50 && d.signups === 0) earlyBreaches++;
        if (earlyBreaches >= 2) return 'red';

        let earlyHits = trendHits; // WoW improving trends count as hits
        if (d.signupCost > 0 && d.signupCost < 500) earlyHits++;
        if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) earlyHits++;
        if (d.cpi > 0 && d.cpi < 100) earlyHits++;
        if (earlyHits >= 2) return 'green';

        return 'neutral';
    }

    // MATURED (14+ days): use matured D6 metrics (excl. current week if available)
    const d6ROAS = (wow.maturedD6ROAS != null) ? wow.maturedD6ROAS : d.d6ROAS;
    const d6CAC = (wow.maturedD6CAC != null) ? wow.maturedD6CAC : d.d6CAC;

    if (d6ROAS > 28) return 'green';

    let breaches = trendBreaches; // WoW declining trends add to breaches
    if (d.signupCost > 1000) breaches++;
    if (d.d0TrialCost > 3500) breaches++;
    if (d6CAC > 15000) breaches++;
    if (breaches >= 2) return 'red';

    let hits = trendHits; // WoW improving trends add to hits
    if (d.signupCost > 0 && d.signupCost < 500) hits++;
    if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) hits++;
    if (d6CAC > 0 && d6CAC < 12000) hits++;
    if (hits >= 2) return 'green';
    return 'neutral';
}

function classifyAlerts(creatives) {
    const eligible = creatives.filter(d => d.spent >= 15000);
    const redAlerts = eligible.filter(d => classifyAlert(d) === 'red');
    const greenAlerts = eligible.filter(d => classifyAlert(d) === 'green');
    return { redAlerts, greenAlerts };
}

function getAlertReasons(d, type) {
    const reasons = [];
    const matLabel = d.isMatured ? ' (matured)' : ' (early)';
    if (type === 'red') {
        if (!d.isMatured) {
            // Early signals
            if (d.signupCost > 1000) reasons.push(`Signup Cost: ₹${Math.round(d.signupCost)} (> ₹1,000)`);
            if (d.d0TrialCost > 3500) reasons.push(`D0 Trial Cost: ₹${Math.round(d.d0TrialCost)} (> ₹3,500)`);
            if (d.cpi > 200) reasons.push(`CPI: ₹${Math.round(d.cpi)} (> ₹200)`);
            if (d.installs > 50 && d.signups === 0) reasons.push(`${d.installs} installs but 0 signups`);
        } else {
            if (d.signupCost > 1000) reasons.push(`Signup Cost: ₹${Math.round(d.signupCost)} (> ₹1,000)`);
            if (d.d0TrialCost > 3500) reasons.push(`D0 Trial Cost: ₹${Math.round(d.d0TrialCost)} (> ₹3,500)`);
            if (d.d6CAC > 15000) reasons.push(`D6 CAC: ₹${Math.round(d.d6CAC)} (> ₹15,000)${matLabel}`);
            if (d.d6ROAS <= 28 && d.d6ROAS > 0) reasons.push(`D6 ROAS: ${d.d6ROAS.toFixed(1)}% (< 28%)${matLabel}`);
        }
    } else {
        if (!d.isMatured) {
            if (d.signupCost > 0 && d.signupCost < 500) reasons.push(`Signup Cost: ₹${Math.round(d.signupCost)} (< ₹500)`);
            if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) reasons.push(`D0 Trial Cost: ₹${Math.round(d.d0TrialCost)} (< ₹2,500)`);
            if (d.cpi > 0 && d.cpi < 100) reasons.push(`CPI: ₹${Math.round(d.cpi)} (< ₹100)`);
        } else {
            if (d.d6ROAS > 28) reasons.push(`D6 ROAS: ${d.d6ROAS.toFixed(1)}% (> 28%)${matLabel}`);
            if (d.signupCost > 0 && d.signupCost < 500) reasons.push(`Signup Cost: ₹${Math.round(d.signupCost)} (< ₹500)`);
            if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) reasons.push(`D0 Trial Cost: ₹${Math.round(d.d0TrialCost)} (< ₹2,500)`);
            if (d.d6CAC > 0 && d.d6CAC < 12000) reasons.push(`D6 CAC: ₹${Math.round(d.d6CAC)} (< ₹12,000)${matLabel}`);
        }
    }
    if (d.daysLive != null) reasons.push(`Days live: ${d.daysLive}${d.isMatured ? ' (matured)' : ' (not matured)'}`);
    // WoW trend reasons
    const wow = d._wow;
    if (wow) {
        if (wow.trendDirection === 'declining') {
            reasons.push(`\u2193 WoW DECLINING trend`);
            if (wow.signupCost_wow > 20) reasons.push(`SU Cost \u2191${wow.signupCost_wow.toFixed(0)}% WoW`);
            if (wow.d0TrialCost_wow > 20) reasons.push(`D0 Trial Cost \u2191${wow.d0TrialCost_wow.toFixed(0)}% WoW`);
            if (wow.cpi_wow > 15) reasons.push(`CPI \u2191${wow.cpi_wow.toFixed(0)}% WoW`);
        } else if (wow.trendDirection === 'improving') {
            reasons.push(`\u2191 WoW IMPROVING trend`);
            if (wow.signupCost_wow < -15) reasons.push(`SU Cost \u2193${Math.abs(wow.signupCost_wow).toFixed(0)}% WoW`);
            if (wow.d0TrialCost_wow < -15) reasons.push(`D0 Trial Cost \u2193${Math.abs(wow.d0TrialCost_wow).toFixed(0)}% WoW`);
        }
        if (wow.maturedD6ROAS != null && d.isMatured) reasons.push(`Matured D6 ROAS (excl this week): ${wow.maturedD6ROAS.toFixed(1)}%`);
    }
    return reasons;
}

function renderAlerts() {
    const live = filteredData.filter(d => d.live === 'Live');
    const { redAlerts, greenAlerts } = classifyAlerts(live);

    const alertsContainer = document.getElementById('alertsSection');
    if (!alertsContainer) return;

    let html = '';

    // Red alerts
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
        html += '<p class="alerts-empty">No red alerts. All live creatives within thresholds.</p>';
    }

    html += `</div></div>`;

    // Green alerts
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
        html += '<p class="alerts-empty">No green alerts among live creatives.</p>';
    }

    html += `</div></div>`;

    alertsContainer.innerHTML = html;
}

// ---- Alerts Page ----
function renderAlertsPage() {
    const live = filteredData.filter(d => d.live === 'Live');
    const { redAlerts, greenAlerts } = classifyAlerts(live);

    const container = document.getElementById('alertsPageContent');
    if (!container) return;

    function alertMetricsRow(d) {
        return `<div class="alert-metrics">
            <div class="alert-metric"><span class="alert-metric-label">Spend</span><span class="alert-metric-value">${formatINR(d.spent)}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">CPI</span><span class="alert-metric-value" style="color:${cpiColor(d.cpi)}">${d.cpi ? '₹' + Math.round(d.cpi) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">CTR</span><span class="alert-metric-value">${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Installs</span><span class="alert-metric-value">${d.installs || '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Signups</span><span class="alert-metric-value">${d.signups || '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Signup Cost</span><span class="alert-metric-value">${d.signupCost ? '₹' + Math.round(d.signupCost) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Signup%</span><span class="alert-metric-value">${d.signupPct ? d.signupPct.toFixed(1) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">P0P1 Cost</span><span class="alert-metric-value">${d.p0p1Cost ? '₹' + Math.round(d.p0p1Cost) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">D0 Trial Cost</span><span class="alert-metric-value">${d.d0TrialCost ? '₹' + Math.round(d.d0TrialCost) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">D0 CAC</span><span class="alert-metric-value">${d.d0CAC ? '₹' + Math.round(d.d0CAC) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">D6 CAC</span><span class="alert-metric-value">${d.d6CAC ? '₹' + Math.round(d.d6CAC) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">D6 ROAS</span><span class="alert-metric-value" style="color:${roasColor(d.d6ROAS)}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Overall ROAS</span><span class="alert-metric-value" style="color:${roasColor(d.overallROAS)}">${d.overallROAS ? d.overallROAS.toFixed(1) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Hook%</span><span class="alert-metric-value">${d.hook ? d.hook.toFixed(1) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Hold%</span><span class="alert-metric-value">${d.hold ? d.hold.toFixed(1) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Perf.</span><span class="alert-metric-value">${perfBadge(d.testPerf)}</span></div>
        </div>`;
    }

    let html = '';

    // Red alerts panel
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
                        <span class="cc-badge ${d.type === 'Video' ? 'badge-video' : 'badge-static'}">${d.type}</span>
                    </div>
                </div>
                ${alertMetricsRow(d)}
            </div>`;
        }).join('');
    } else {
        html += '<p class="alerts-empty">No red alerts. All live creatives within thresholds.</p>';
    }

    html += `</div></div>`;

    // Green alerts panel
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
                        <span class="cc-badge ${d.type === 'Video' ? 'badge-video' : 'badge-static'}">${d.type}</span>
                    </div>
                </div>
                ${alertMetricsRow(d)}
            </div>`;
        }).join('');
    } else {
        html += '<p class="alerts-empty">No green alerts among live creatives.</p>';
    }

    html += `</div></div>`;

    container.innerHTML = html;
}

// ---- Live Creatives Dashboard ----
function renderLiveDashboard() {
    const live = filteredData.filter(d => d.live === 'Live');
    // Sum raw metrics, then derive ratios from totals (never average percentages)
    const liveRaws = live.filter(d => d._raw).map(d => d._raw);
    const lm = liveRaws.length > 0 ? deriveMetrics(sumRaw(liveRaws)) : {};
    const liveSpend = lm.spend || 0;
    const liveInstalls = lm.installs || 0;
    const liveSignups = lm.signups || 0;

    document.getElementById('liveKpiCount').textContent = live.length;
    document.getElementById('liveKpiCountSub').textContent = `${live.filter(d => d.type === 'Video').length} video, ${live.filter(d => d.type === 'Static').length} static`;
    document.getElementById('liveKpiSpend').textContent = formatINR(liveSpend);
    document.getElementById('liveKpiSpendSub').textContent = `Avg ${formatINR(liveSpend / (live.length || 1))} per creative`;
    document.getElementById('liveKpiInstalls').textContent = formatNum(liveInstalls);
    document.getElementById('liveKpiInstallsSub').textContent = `${formatNum(liveSignups)} signups`;
    document.getElementById('liveKpiCPI').textContent = lm.cpi ? '₹' + Math.round(lm.cpi) : '--';
    document.getElementById('liveKpiCPISub').textContent = `Across ${live.filter(d => d.installs > 0).length} creatives`;
    document.getElementById('liveKpiCTR').textContent = lm.ctr ? lm.ctr.toFixed(2) + '%' : '--';
    document.getElementById('liveKpiCTRSub').textContent = `Across ${live.filter(d => d.impressions > 0).length} creatives`;
    document.getElementById('liveKpiSignups').textContent = formatNum(liveSignups);
    document.getElementById('liveKpiSignupsSub').textContent = liveInstalls ? `${((liveSignups / liveInstalls) * 100).toFixed(1)}% of installs` : '';
    document.getElementById('liveKpiROAS').textContent = lm.d6ROAS ? lm.d6ROAS.toFixed(1) + '%' : '--';
    document.getElementById('liveKpiROASSub').textContent = `Across ${live.filter(d => d.d6ROAS > 0).length} creatives`;
    document.getElementById('liveKpiHook').textContent = lm.hook ? lm.hook.toFixed(1) + '%' : '--';
    document.getElementById('liveKpiHookSub').textContent = `Across ${live.filter(d => d.hook > 0).length} videos`;

    // Live table
    document.getElementById('liveCreativesTable').innerHTML = live.length ? `
        <table>
            <thead><tr>
                <th>#</th><th>Creative</th><th>Type</th><th>Date</th><th>Spend</th><th>CTR</th><th>CPI</th><th>Installs</th><th>Signups</th><th>Signup%</th><th>Hook%</th><th>Hold%</th><th>D6 ROAS</th><th>Overall ROAS</th><th>Signup Cost</th><th>P0P1 Cost</th><th>D0 Trial Cost</th><th>D0 CAC</th><th>D6 CAC</th><th>Perf.</th><th>Source</th>
            </tr></thead>
            <tbody>${live.map((d, i) => `<tr>
                <td>${i + 1}</td>
                <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${d.name}">${shortName(d.name)}</td>
                <td><span class="cc-badge ${d.type === 'Video' ? 'badge-video' : 'badge-static'}">${d.type}</span></td>
                <td>${d.date || '-'}</td>
                <td>${formatINR(d.spent)}</td>
                <td>${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</td>
                <td style="color:${cpiColor(d.cpi)}">${d.cpi ? '₹' + Math.round(d.cpi) : '-'}</td>
                <td>${d.installs || '-'}</td>
                <td>${d.signups || '-'}</td>
                <td>${d.signupPct ? d.signupPct.toFixed(1) + '%' : '-'}</td>
                <td>${d.hook ? d.hook.toFixed(1) + '%' : '-'}</td>
                <td>${d.hold ? d.hold.toFixed(1) + '%' : '-'}</td>
                <td style="color:${roasColor(d.d6ROAS)}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</td>
                <td style="color:${roasColor(d.overallROAS)}">${d.overallROAS ? d.overallROAS.toFixed(1) + '%' : '-'}</td>
                <td>${d.signupCost ? '₹' + Math.round(d.signupCost) : '-'}</td>
                <td>${d.p0p1Cost ? '₹' + Math.round(d.p0p1Cost) : '-'}</td>
                <td>${d.d0TrialCost ? '₹' + Math.round(d.d0TrialCost) : '-'}</td>
                <td>${d.d0CAC ? '₹' + Math.round(d.d0CAC) : '-'}</td>
                <td>${d.d6CAC ? '₹' + Math.round(d.d6CAC) : '-'}</td>
                <td>${perfBadge(d.testPerf)}</td>
                <td>${sourceBadge(d._source)}</td>
            </tr>`).join('')}</tbody>
        </table>
    ` : '<p style="color:var(--text-dim);padding:20px;">No live creatives found.</p>';

    // Live top ROAS
    const liveTopROAS = buildTopRoasRanking(live);
    document.getElementById('liveTopROAS').innerHTML = liveTopROAS.length ? liveTopROAS.map((d, i) => `
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
    document.getElementById('liveTopCPI').innerHTML = liveTopCPI.length ? liveTopCPI.map((d, i) => `
        <div class="rank-item">
            <span class="rank-num">#${i + 1}</span>
            <div class="rank-info">
                <div class="rank-name">${shortName(d.name)}</div>
                <div class="rank-meta">${d.type} | Installs: ${formatNum(d.installs)}</div>
            </div>
            <span class="rank-value" style="color:var(--teal)">₹${Math.round(d.cpi)}</span>
        </div>
    `).join('') : '<p style="color:var(--text-dim);">No CPI data yet.</p>';
}

// ---- All Creatives Table ----
function renderTable() {
    const data = filteredData;
    document.getElementById('tableCount').textContent = `${data.length} creatives`;
    const thead = document.querySelector('#creativesTable thead');
    const tbody = document.querySelector('#creativesTable tbody');
    const cols = ['#', 'Name', 'Type', 'Date', 'Days', 'Spend', 'Impr.', 'CPM', 'CTR', 'Installs', 'CPI', 'Signups', 'Signup%', 'Hook%', 'Hold%', 'D6 ROAS', 'Overall ROAS', 'Signup Cost', 'P0P1 Cost', 'D0 Trial Cost', 'D0 CAC', 'D6 CAC', 'Status', 'Perf.', 'Data Range'];
    thead.innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`;
    tbody.innerHTML = data.map((d, i) => `<tr>
        <td>${i + 1}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${d.name}">${shortName(d.name)}</td>
        <td><span class="cc-badge ${d.type === 'Video' ? 'badge-video' : 'badge-static'}">${d.type || '-'}</span></td>
        <td>${d.date || '-'}</td>
        <td>${d.daysLive || '-'}${d.isMatured ? ' ✓' : ''}</td>
        <td>${formatINR(d.spent)}</td>
        <td>${formatNum(d.impressions)}</td>
        <td>${d.cpm ? Math.round(d.cpm) : '-'}</td>
        <td>${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</td>
        <td>${d.installs || '-'}</td>
        <td style="color:${cpiColor(d.cpi)}">${d.cpi ? '₹' + Math.round(d.cpi) : '-'}</td>
        <td>${d.signups || '-'}</td>
        <td>${d.signupPct ? d.signupPct.toFixed(1) + '%' : '-'}</td>
        <td>${d.hook ? d.hook.toFixed(1) + '%' : '-'}</td>
        <td>${d.hold ? d.hold.toFixed(1) + '%' : '-'}</td>
        <td style="color:${roasColor(d.d6ROAS)}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</td>
        <td style="color:${roasColor(d.overallROAS)}">${d.overallROAS ? d.overallROAS.toFixed(1) + '%' : '-'}</td>
        <td>${d.signupCost ? '₹' + Math.round(d.signupCost) : '-'}</td>
        <td>${d.p0p1Cost ? '₹' + Math.round(d.p0p1Cost) : '-'}</td>
        <td>${d.d0TrialCost ? '₹' + Math.round(d.d0TrialCost) : '-'}</td>
        <td>${d.d0CAC ? '₹' + Math.round(d.d0CAC) : '-'}</td>
        <td>${d.d6CAC ? '₹' + Math.round(d.d6CAC) : '-'}</td>
        <td><span class="cc-badge ${d.live === 'Live' ? 'badge-live' : 'badge-paused'}">${d.live}</span></td>
        <td>${perfBadge(d.testPerf)}</td>
        <td style="font-size:10px;color:#888;">${d._dateRange ? d._dateRange.label : '-'}</td>
    </tr>`).join('');
}

// ---- New This Week ----
function renderNew() {
    // Show creatives that went live in the last 7 days (including today)
    const now = new Date();
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime();
    const newOnes = filteredData.filter(d => {
        const ts = parseDate(d.date);
        return ts && ts >= sevenDaysAgo;
    });
    const container = document.getElementById('newCreativeCards');
    if (!newOnes.length) {
        container.innerHTML = '<p style="color:var(--text-dim);">No new creatives found for the latest week.</p>';
        return;
    }
    container.innerHTML = newOnes.map(d => creativeCard(d)).join('');
}

// ---- Top Performers ----
function renderTop() {
    const top = [...filteredData]
        .filter(d => d.spent > 15000)
        .sort((a, b) => {
            const scoreA = computeScore(a);
            const scoreB = computeScore(b);
            return scoreB - scoreA;
        }).slice(0, 20);
    document.getElementById('topCreativeCards').innerHTML = top.map(d => creativeCard(d, true)).join('');
}

// ---- Failures ----
function renderFailures() {
    const fails = filteredData.filter(d =>
        d.testPerf === 'Failed' || d.testPerf === 'Drop' ||
        (d.spent > 20000 && d.signups === 0) ||
        (d.spent > 50000 && d.d6ROAS === 0)
    );
    document.getElementById('failureCreativeCards').innerHTML = fails.length
        ? fails.map(d => creativeCard(d)).join('')
        : '<p style="color:var(--text-dim);">No underperformers found with current filters.</p>';
}

// ---- Scorecard ----
function renderScorecardView() {
    const select = document.getElementById('scorecardSelect');
    if (select.options.length <= 1) {
        select.innerHTML = '<option value="">Select a creative...</option>' +
            allData.map((d, i) => `<option value="${i}">${d.name}</option>`).join('');
    }
}

document.getElementById('scorecardSelect')?.addEventListener('change', (e) => {
    const idx = parseInt(e.target.value);
    if (isNaN(idx)) return;
    renderScorecard(allData[idx]);
});

function renderScorecard(d) {
    const container = document.getElementById('scorecardContent');
    const metrics = [
        { label: 'CPM', value: d.cpm, format: v => '₹' + Math.round(v), rate: rateCPM },
        { label: 'CTR', value: d.ctr, format: v => v.toFixed(2) + '%', rate: rateCTR },
        { label: 'CPI', value: d.cpi, format: v => '₹' + Math.round(v), rate: rateCPI },
        { label: 'Signup %', value: d.signupPct, format: v => v.toFixed(1) + '%', rate: rateSignup },
        { label: 'Hook %', value: d.hook, format: v => v.toFixed(1) + '%', rate: rateHook },
        { label: 'Hold %', value: d.hold, format: v => v.toFixed(1) + '%', rate: rateHold },
        { label: 'Full Play %', value: d.fullPlay, format: v => v.toFixed(1) + '%', rate: rateFullPlay },
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

// ---- Scoring ----
function computeScore(d) {
    let score = 0;
    let factors = 0;
    if (d.cpi > 0) { score += scoreCPI(d.cpi); factors++; }
    if (d.ctr > 0) { score += scoreCTR(d.ctr); factors++; }
    if (d.signupPct > 0) { score += scoreSignup(d.signupPct); factors++; }
    if (d.d6ROAS > 0) { score += scoreROAS(d.d6ROAS) * 2; factors += 2; }
    if (d.hook > 0) { score += scoreHook(d.hook); factors++; }
    if (d.hold > 0) { score += scoreHold(d.hold); factors++; }
    return factors > 0 ? score / factors : 0;
}

function scoreCPI(v) { return v < 300 ? 100 : v < 500 ? 75 : v < 800 ? 50 : 25; }
function scoreCTR(v) { return v > 0.7 ? 100 : v > 0.5 ? 75 : v > 0.3 ? 50 : 25; }
function scoreSignup(v) { return v > 45 ? 100 : v > 25 ? 75 : v > 10 ? 50 : 25; }
function scoreROAS(v) { return v > 50 ? 100 : v > 25 ? 75 : v > 10 ? 50 : 25; }
function scoreHook(v) { return v > 30 ? 100 : v > 20 ? 75 : v > 12 ? 50 : 25; }
function scoreHold(v) { return v > 40 ? 100 : v > 25 ? 75 : v > 15 ? 50 : 25; }

function rateCPM(v) { return v < 100 ? 'Exceptional' : v < 200 ? 'Good' : v < 350 ? 'Average' : 'Poor'; }
function rateCTR(v) { return v > 0.7 ? 'Exceptional' : v > 0.5 ? 'Good' : v > 0.3 ? 'Average' : 'Poor'; }
function rateCPI(v) { return v < 300 ? 'Exceptional' : v < 500 ? 'Good' : v < 800 ? 'Average' : 'Poor'; }
function rateSignup(v) { return v > 45 ? 'Exceptional' : v > 25 ? 'Good' : v > 10 ? 'Average' : 'Poor'; }
function rateHook(v) { return v > 30 ? 'Exceptional' : v > 20 ? 'Good' : v > 12 ? 'Average' : 'Poor'; }
function rateHold(v) { return v > 40 ? 'Exceptional' : v > 25 ? 'Good' : v > 15 ? 'Average' : 'Poor'; }
function rateFullPlay(v) { return v > 10 ? 'Exceptional' : v > 5 ? 'Good' : v > 3 ? 'Average' : 'Poor'; }
function rateROAS(v) { return v > 50 ? 'Exceptional' : v > 25 ? 'Good' : v > 10 ? 'Average' : 'Poor'; }
function rateOverallROAS(v) { return v > 60 ? 'Exceptional' : v > 35 ? 'Good' : v > 15 ? 'Average' : 'Poor'; }

// ---- Helpers ----
function shortName(name) {
    return (name || '').replace(/^FB_MOF_(Video_|Static_)?/, '').replace(/_/g, ' ');
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

function sourceBadge(source) {
    if (source === 'merged') return '<span class="cc-badge badge-merged">MERGED</span>';
    if (source === 'meta') return '<span class="cc-badge badge-meta">META</span>';
    return '<span class="cc-badge badge-sheets">SHEETS</span>';
}

function creativeCard(d, showScore = false) {
    const score = computeScore(d);
    return `
        <div class="creative-card">
            <div class="cc-header">
                <div>
                    <div class="cc-name">${shortName(d.name)}</div>
                    ${showScore ? `<div style="margin-top:4px;font-size:11px;color:var(--text-muted)">Score: <strong style="color:${score >= 70 ? 'var(--green)' : score >= 50 ? 'var(--blue)' : 'var(--orange)'}">${Math.round(score)}/100</strong></div>` : ''}
                </div>
                <div style="display:flex;gap:4px;">
                    <span class="cc-badge ${d.type === 'Video' ? 'badge-video' : 'badge-static'}">${d.type}</span>
                    ${perfBadge(d.testPerf)}
                </div>
            </div>
            <div class="cc-metrics">
                <div class="cc-metric"><div class="cc-metric-label">Spend</div><div class="cc-metric-value">${formatINR(d.spent)}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">CPI</div><div class="cc-metric-value" style="color:${cpiColor(d.cpi)}">${d.cpi ? '₹' + Math.round(d.cpi) : '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">CTR</div><div class="cc-metric-value">${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">Signups</div><div class="cc-metric-value">${d.signups || '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">D6 ROAS</div><div class="cc-metric-value" style="color:${roasColor(d.d6ROAS)}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">${d.type === 'Video' ? 'Hook%' : 'Signup%'}</div><div class="cc-metric-value">${d.type === 'Video' ? (d.hook ? d.hook.toFixed(1) + '%' : '-') : (d.signupPct ? d.signupPct.toFixed(1) + '%' : '-')}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">Signup Cost</div><div class="cc-metric-value">${d.signupCost ? '₹' + Math.round(d.signupCost) : '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">D0 Trial Cost</div><div class="cc-metric-value">${d.d0TrialCost ? '₹' + Math.round(d.d0TrialCost) : '-'}</div></div>
            </div>
            <div class="cc-date">${d.date || ''} | <span class="cc-badge ${d.live === 'Live' ? 'badge-live' : 'badge-paused'}">${d.live}</span> ${d.isMatured ? '<span style="color:#10b981;font-size:10px;">Matured</span>' : '<span style="color:#888;font-size:10px;">' + (d.daysLive || 0) + 'd</span>'} | <span style="color:#666;font-size:10px;">Data: ${d._dateRange ? d._dateRange.label : '-'}</span></div>
        </div>
    `;
}

function showLoading(show) {
    document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}

// ---- CSV Export ----
document.getElementById('exportBtn')?.addEventListener('click', () => {
    const headers = ['Name', 'Type', 'Date', 'Spend', 'Impressions', 'CPM', 'CTR', 'Installs', 'CPI', 'Signups', 'Signup Cost', 'Signup%', 'Hook%', 'Hold%', 'D6 ROAS', 'Overall ROAS', 'P0P1', 'P0P1%', 'P0P1 Cost', 'D0 Trials', 'D0 Trial Cost', 'D0', 'D0 CAC', 'D6 CAC', 'Status', 'Performance', 'Source'];
    const csvRows = [headers.join(',')];
    filteredData.forEach(d => {
        csvRows.push([
            `"${d.name}"`, d.type, d.date, d.spent, d.impressions, d.cpm,
            d.ctr, d.installs, d.cpi, d.signups, d.signupCost, d.signupPct,
            d.hook, d.hold, d.d6ROAS, d.overallROAS, d.p0p1, d.p0p1Pct, d.p0p1Cost, d.d0Trials, d.d0TrialCost, d.d0, d.d0CAC, d.d6CAC, d.live, d.testPerf, d._source
        ].join(','));
    });
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'creative_data_export.csv';
    a.click();
});

// ---- Event Listeners ----
document.getElementById('searchInput').addEventListener('input', () => renderCurrentView());
document.getElementById('typeFilter').addEventListener('change', () => renderCurrentView());
document.getElementById('statusFilter').addEventListener('change', () => renderCurrentView());
document.getElementById('perfFilter').addEventListener('change', () => renderCurrentView());
document.getElementById('viewPromptAskBtn')?.addEventListener('click', runViewAssistantQuery);
document.getElementById('viewPromptInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') runViewAssistantQuery(); });
document.getElementById('viewAssistantCloseBtn')?.addEventListener('click', closeViewAssistantPanel);
document.getElementById('viewAssistantReopenBtn')?.addEventListener('click', reopenViewAssistantPanel);
document.querySelectorAll('.ai-dock-chip[data-ai-prompt]').forEach(btn => {
    btn.addEventListener('click', () => {
        const input = document.getElementById('viewPromptInput');
        if (!input) return;
        input.value = btn.dataset.aiPrompt || '';
        runViewAssistantQuery();
    });
});
// sourceFilter removed — all data comes from API now
try { document.getElementById('sourceFilter').addEventListener('change', () => renderCurrentView()); } catch(e) {}
// Flatpickr calendar date pickers — now trigger API re-fetch
function onDateFilterChange() {
    const fromEl = document.getElementById('dateFrom');
    const toEl = document.getElementById('dateTo');
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
        document.getElementById('dateFrom').addEventListener('change', onDateFilterChange);
        document.getElementById('dateTo').addEventListener('change', onDateFilterChange);
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
    flatpickr('#dateFrom', fpConfig);
    flatpickr('#dateTo', fpConfig);
}
initDatePickers();
document.getElementById('clearDates').addEventListener('click', () => {
    const fromEl = document.getElementById('dateFrom');
    const toEl = document.getElementById('dateTo');
    if (fromEl._flatpickr) { fromEl._flatpickr.clear(); } else { fromEl.value = ''; }
    if (toEl._flatpickr) { toEl._flatpickr.clear(); } else { toEl.value = ''; }
    fetchLiveData(); // Reset to default 30-day range
});
document.getElementById('refreshBtn').addEventListener('click', () => fetchLiveData());

/* --- CUT START (old client-side Meta API code removed — credentials moved to server) ---
const META_ACCESS_TOKEN = 'REMOVED';
const META_APP_SECRET_PROOF = 'REMOVED';
const META_AD_ACCOUNT_ID = 'act_725019929189148';
const TARGET_CAMPAIGNS = [
    'Test2-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_051225',
    'Test-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_131125'
];
let metaData = [];
let metaUserName = '';
let metaConnected = false;
let metaCampaignIds = []; // { id, name } pairs

function getMetaDateRange() {
    const rangeEl = document.getElementById('metaDateRange');
    const range = rangeEl ? rangeEl.value : 'last_30d';
    const now = new Date();
    const end = now.toISOString().split('T')[0];
    let start;
    switch (range) {
        case 'last_7d': start = new Date(now - 7 * 86400000); break;
        case 'last_14d': start = new Date(now - 14 * 86400000); break;
        case 'last_90d': start = new Date(now - 90 * 86400000); break;
        default: start = new Date(now - 30 * 86400000);
    }
    return { since: start.toISOString().split('T')[0], until: end };
}

// Step 1: Look up campaign IDs by name
async function fetchTargetCampaignIds() {
    const url = `https://graph.facebook.com/v21.0/${META_AD_ACCOUNT_ID}/campaigns?fields=id,name&limit=100&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}&appsecret_proof=${META_APP_SECRET_PROOF}`;
    const allCampaigns = await fetchMetaPage(url, []);
    const matched = allCampaigns.filter(c => TARGET_CAMPAIGNS.includes(c.name.trim()));
    console.log(`Meta: found ${matched.length}/${TARGET_CAMPAIGNS.length} target campaigns`, matched.map(c => c.name));
    if (!matched.length) throw new Error('No target campaigns found in this ad account');
    return matched.map(c => ({ id: c.id, name: c.name }));
}

// Step 2: Fetch ads from a specific campaign
async function fetchAdsFromCampaign(campaignId) {
    const { since, until } = getMetaDateRange();
    const fields = 'name,status,created_time,campaign_id,campaign{name},creative{title,body,thumbnail_url},insights.time_range({"since":"' + since + '","until":"' + until + '"}){spend,impressions,cpm,clicks,ctr,actions,cost_per_action_type,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions}';
    const url = `https://graph.facebook.com/v21.0/${campaignId}/ads?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}&appsecret_proof=${META_APP_SECRET_PROOF}`;
    return fetchMetaPage(url, []);
}

// Main Meta fetch: find campaigns, fetch ads
async function fetchMetaData() {
    try {
        metaUserName = 'App Connected';
        metaConnected = true;

        // Find target campaign IDs
        metaCampaignIds = await fetchTargetCampaignIds();

        // Fetch ads from all target campaigns in parallel
        const adArrays = await Promise.all(
            metaCampaignIds.map(c => fetchAdsFromCampaign(c.id))
        );
        const allAds = adArrays.flat();

        // Find campaign name for each ad
        const campaignNameMap = {};
        metaCampaignIds.forEach(c => { campaignNameMap[c.id] = c.name; });

        metaData = allAds.map(ad => normalizeMetaAd(ad, campaignNameMap));
        console.log(`Meta: loaded ${metaData.length} ads from ${metaCampaignIds.length} campaigns`);

        // Merge with sheets data
        mergeDataSources();

        updateMetaStatus(true);
        renderCurrentView();
    } catch (err) {
        console.error('Meta fetch error:', err);
        updateMetaStatus(false, err.message);
    }
}

function updateMetaStatus(connected, errorMsg) {
    const statusEl = document.getElementById('metaAccountStatus');
    const detailsEl = document.getElementById('metaAccountDetails');
    const connectBtn = document.getElementById('metaConnectBtn');
    const disconnectBtn = document.getElementById('metaDisconnectBtn');
    const fetchBtn = document.getElementById('metaFetchBtn');

    if (!statusEl) return;

    if (connected) {
        statusEl.innerHTML = '<span class="status-dot connected"></span><span class="status-text">Connected as ' + metaUserName + '</span>';
        detailsEl.style.display = 'block';
        connectBtn.style.display = 'none';
        disconnectBtn.style.display = 'inline-block';
        fetchBtn.style.display = 'inline-block';
        fetchBtn.textContent = 'Refresh Meta Data';
        fetchBtn.disabled = false;
        document.getElementById('metaUserName').textContent = metaUserName;
        document.getElementById('metaCreativeCount').textContent = metaData.length;
        const campaignInfoEl = document.getElementById('metaCampaignInfo');
        if (campaignInfoEl) {
            campaignInfoEl.textContent = metaCampaignIds.length + ' targeted (' + metaCampaignIds.map(c => c.name.split('_')[0]).join(', ') + ')';
        }
        const matchedEl = document.getElementById('metaMatchedCount');
        if (matchedEl) {
            matchedEl.textContent = allData.filter(d => d._source === 'merged').length;
        }
    } else {
        statusEl.innerHTML = '<span class="status-dot disconnected"></span><span class="status-text">Error: ' + (errorMsg || 'Not connected') + '</span>';
        detailsEl.style.display = 'none';
        connectBtn.style.display = 'inline-block';
        disconnectBtn.style.display = 'none';
        fetchBtn.style.display = 'none';
    }
}

function metaConnect() {
    fetchMetaData();
}
--- (continues below through renderAccountsView) ---

function metaDisconnect() {
    allData = sheetsData.slice();
    window.allData = allData;
    metaData = [];
    metaConnected = false;
    updateMetaStatus(false, 'Disconnected');
    renderCurrentView();
}

function metaFetchAds() {
    const fetchBtn = document.getElementById('metaFetchBtn');
    if (fetchBtn) {
        fetchBtn.textContent = 'Fetching...';
        fetchBtn.disabled = true;
    }
    fetchMetaData();
}

// Generic paginated Meta API fetch
function fetchMetaPage(url, accumulated) {
    // Ensure appsecret_proof is on every request (pagination URLs may lack it)
    if (!url.includes('appsecret_proof')) {
        url += (url.includes('?') ? '&' : '?') + 'appsecret_proof=' + META_APP_SECRET_PROOF;
    }
    return fetch(url)
        .then(r => r.json())
        .then(data => {
            if (data.error) throw new Error(data.error.message);
            const items = accumulated.concat(data.data || []);
            if (data.paging && data.paging.next && items.length < 500) {
                return fetchMetaPage(data.paging.next, items);
            }
            return items;
        });
}

function normalizeMetaAd(ad, campaignNameMap) {
    const insights = (ad.insights && ad.insights.data && ad.insights.data[0]) || {};
    const actions = insights.actions || [];

    const getAction = (type) => {
        const a = actions.find(x => x.action_type === type);
        return a ? parseFloat(a.value) : 0;
    };

    const installs = getAction('app_install') || getAction('omni_app_install');
    const signups = getAction('complete_registration') || getAction('omni_complete_registration');
    const spendRaw = parseFloat(insights.spend) || 0;
    const spend = spendRaw * 1.18; // 18% tax multiplier
    const impressions = parseFloat(insights.impressions) || 0;
    const clicks = parseFloat(insights.clicks) || 0;

    const isVideo = ad.name && (ad.name.toLowerCase().includes('video') || ad.name.includes('VID'));
    const isActive = ad.status === 'ACTIVE';

    let dateStr = '';
    if (ad.created_time) {
        const dt = new Date(ad.created_time);
        dateStr = dt.toLocaleDateString('en-GB');
    }

    const campaignName = (ad.campaign && ad.campaign.name) || (campaignNameMap && campaignNameMap[ad.campaign_id]) || '';

    return {
        sno: 0,
        type: isVideo ? 'Video' : 'Static',
        name: ad.name || 'Untitled Ad',
        date: dateStr,
        spent: spend,
        impressions: impressions,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        clicks: clicks,
        ctr: parseFloat(insights.ctr) || 0,
        installs: installs,
        cpi: installs > 0 ? spend / installs : 0,
        signups: signups,
        signupCost: signups > 0 ? spend / signups : 0,
        signupPct: installs > 0 ? (signups / installs) * 100 : 0,
        d6: 0,
        d6CAC: 0,
        d6ROAS: 0,
        overallROAS: 0,
        overallRevenue: 0,
        p0p1: 0,
        p0p1Pct: 0,
        p0p1Cost: 0,
        d0Trials: 0,
        d0TrialCost: 0,
        d0: 0,
        d0CAC: 0,
        hook: 0,
        hold: 0,
        fullPlay: 0,
        thruPlays: parseFloat((insights.video_thruplay_watched_actions || [{}])[0].value) || 0,
        threeSecViews: 0,
        nextSteps: '',
        live: isActive ? 'Live' : 'Paused',
        testPerf: '',
        week: '',
        year: '',
        campaignId: ad.campaign_id || '',
        campaignName: campaignName,
        _raw: ad,
        _source: 'meta'
    };
}

function renderAccountsView() {
    // Accounts view — simplified for API mode
}
--- CUT END (old client-side Meta API code removed) --- */

// Stub for accounts view (old Meta connect UI removed)
function renderAccountsView() {}
function updateMetaStatus() {}
function metaConnect() {}

// ---- Init ----
async function init() {
    applyStandaloneMode();
    await fetchLiveData();
    if (views[APP_INITIAL_VIEW] && APP_INITIAL_VIEW !== 'dashboard') {
        setActiveView(APP_INITIAL_VIEW);
    }
    // Auto-refresh every 10 minutes
    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(() => {
        console.log('[Auto-refresh] Fetching latest data...');
        fetchLiveData();
    }, REFRESH_INTERVAL);
    if (_verifyTimer) clearInterval(_verifyTimer);
    _verifyTimer = setInterval(() => {
        console.log('[Verify] Running scheduled sheet cross-check...');
        crossVerifyWithSheet();
    }, VERIFY_INTERVAL);
}
init();

// =========================================================================
// CAMPAIGN TREE — Hierarchical campaign → adset → ad analysis
// =========================================================================
const TREE_SERVER = window.location.origin || `${window.location.protocol}//${window.location.host}`;

function dateToExcelSerial(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const epochDays = Date.UTC(y, m - 1, d) / 86400000;
    return Math.round(epochDays + 25569);
}

function buildMetaKey(dateStr, campaignName, adsetName, adName) {
    const serial = dateToExcelSerial(dateStr);
    return serial + campaignName + adsetName.toLowerCase().trim() + adName.replace(/:.*$/, '');
}

function buildMetabaseKey(dateStr, campaignName, adsetName, trackerName) {
    // Metabase dates come as ISO strings e.g. "2026-03-18T00:00:00+05:30"
    const d = dateStr.substring(0, 10);
    const serial = dateToExcelSerial(d);
    // adsetName is already lowered in the SQL
    return serial + campaignName + adsetName + trackerName;
}

window.fetchCampaignTree = async function () {
    const dateFrom = document.getElementById('treeDateFrom').value;
    const dateTo = document.getElementById('treeDateTo').value;
    const status = document.getElementById('treeStatus');
    const container = document.getElementById('treeContainer');
    const summaryEl = document.getElementById('treeSummary');
    const btn = document.getElementById('treeAnalyzeBtn');

    if (!dateFrom || !dateTo) { status.textContent = 'Please select both dates.'; return; }

    btn.disabled = true;
    status.textContent = 'Fetching data from Meta API + Metabase...';
    container.innerHTML = '';
    summaryEl.style.display = 'none';

    try {
        // Fetch both sources in parallel
        const [metaRes, funnelRes] = await Promise.all([
            fetch(`${TREE_SERVER}/api/meta/ad-insights-daily`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom, dateTo }),
            }).then(r => r.json()),
            fetch(`${TREE_SERVER}/api/metabase/ad-funnel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom, dateTo }),
            }).then(r => r.json()),
        ]);

        if (!metaRes.success) throw new Error('Meta API: ' + metaRes.error);
        if (!funnelRes.success) throw new Error('Metabase: ' + funnelRes.error);

        status.textContent = `Meta: ${metaRes.total} rows | Metabase: ${funnelRes.total} rows. Matching...`;

        // Campaign Tree contract:
        // campaign totals come from campaign-level aggregation
        // adset totals come from adset-level aggregation
        // ad rows come from day+campaign+adset+ad matching only
        const mbDaily = {};
        const mbCampaign = {};
        const mbAdset = {};
        const metaCampaign = {};
        const metaAdset = {};
        const adAgg = {};
        let matchedKeys = 0;
        let unmatchedKeys = 0;
        const matchedMbKeys = new Set();
        const metaRows = (metaRes.data || []).filter(r => /android/i.test(r.campaign_name || ''));
        const funnelRows = funnelRes.data || [];

        function ensureTreeRaw(map, key, seed) {
            if (!map[key]) map[key] = { ...emptyRaw(), ...(seed || {}) };
            return map[key];
        }

        function addFunnelRaw(target, row) {
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

        function addMetaRaw(target, row) {
            target.spend += (Number(row.spend) || 0) * 1.18;
            target.impressions += Number(row.impressions) || 0;
            target.clicks += Number(row.clicks) || 0;
            target.installs += Number(row.installs) || 0;
            target.thruplay += Number(row.thruplay) || 0;
            target.p25 += Number(row.p25) || 0;
            target.p100 += Number(row.p100) || 0;
        }

        for (const row of funnelRows) {
            const adKey = buildJoinKey(row.date, row.campaign_name, row.ad_set_name, row.tracker_name);
            addFunnelRaw(ensureTreeRaw(mbDaily, adKey), row);

            const campKey = normalizeCampaignName(row.campaign_name || '');
            addFunnelRaw(ensureTreeRaw(mbCampaign, campKey, {
                campaign_name: row.campaign_name || '',
                campaign_id: row.meta_campaign_id || '',
            }), row);

            const adsetKey = campKey + '|||' + normalizeAdsetName(row.ad_set_name || '');
            addFunnelRaw(ensureTreeRaw(mbAdset, adsetKey, {
                campaign_name: row.campaign_name || '',
                campaign_id: row.meta_campaign_id || '',
                adset_name: row.ad_set_name || '',
                adset_id: '',
            }), row);
        }

        for (const row of metaRows) {
            const campKey = normalizeCampaignName(row.campaign_name || '');
            addMetaRaw(ensureTreeRaw(metaCampaign, campKey, {
                campaign_name: row.campaign_name || '',
                campaign_id: row.campaign_id || '',
            }), row);

            const adsetKey = campKey + '|||' + normalizeAdsetName(row.adset_name || '');
            addMetaRaw(ensureTreeRaw(metaAdset, adsetKey, {
                campaign_name: row.campaign_name || '',
                campaign_id: row.campaign_id || '',
                adset_name: row.adset_name || '',
                adset_id: row.adset_id || '',
            }), row);

            const adUid = (row.campaign_name || '') + '|||' + (row.adset_name || '') + '|||' + (row.ad_name || '');
            addMetaRaw(ensureTreeRaw(adAgg, adUid, {
                campaign_name: row.campaign_name || '',
                campaign_id: row.campaign_id || '',
                adset_name: row.adset_name || '',
                adset_id: row.adset_id || '',
                ad_name: row.ad_name || '',
                ad_id: row.ad_id || '',
                _matched: false,
            }), row);

            const mbKey = buildJoinKey(row.date_start, row.campaign_name, row.adset_name, row.ad_name);
            const mb = mbDaily[mbKey];
            if (mb) {
                matchedKeys++;
                matchedMbKeys.add(mbKey);
                const adRaw = adAgg[adUid];
                adRaw._matched = true;
                addFunnelRaw(adRaw, mb);
            } else {
                unmatchedKeys++;
            }
        }

        for (const [key, mb] of Object.entries(mbDaily)) {
            if (matchedMbKeys.has(key)) continue;
            const parts = key.split('|||');
            const adUid = parts[1] + '|||' + parts[2] + '|||' + parts[3];
            const adRaw = ensureTreeRaw(adAgg, adUid, {
                campaign_name: parts[1] || '',
                campaign_id: '',
                adset_name: parts[2] || '',
                adset_id: '',
                ad_name: parts[3] || '',
                ad_id: '',
                _matched: true,
            });
            adRaw._matched = true;
            addFunnelRaw(adRaw, mb);
        }

        const campaignAgg = {};
        for (const [key, raw] of Object.entries(metaCampaign)) {
            campaignAgg[key] = { ...emptyRaw(), ...raw, campaign_name: raw.campaign_name, campaign_id: raw.campaign_id };
        }
        for (const [key, raw] of Object.entries(mbCampaign)) {
            if (!campaignAgg[key]) campaignAgg[key] = { ...emptyRaw(), campaign_name: raw.campaign_name, campaign_id: raw.campaign_id };
            addFunnelRaw(campaignAgg[key], raw);
        }

        const adsetAgg = {};
        for (const [key, raw] of Object.entries(metaAdset)) {
            adsetAgg[key] = {
                ...emptyRaw(),
                ...raw,
                campaign_name: raw.campaign_name,
                campaign_id: raw.campaign_id,
                adset_name: raw.adset_name,
                adset_id: raw.adset_id,
            };
        }
        for (const [key, raw] of Object.entries(mbAdset)) {
            if (!adsetAgg[key]) {
                adsetAgg[key] = {
                    ...emptyRaw(),
                    campaign_name: raw.campaign_name,
                    campaign_id: raw.campaign_id,
                    adset_name: raw.adset_name,
                    adset_id: raw.adset_id,
                };
            }
            addFunnelRaw(adsetAgg[key], raw);
        }

        const totalMbKeys = Object.keys(mbDaily).length;
        console.log(`[Tree] Meta rows: ${metaRows.length} | MB daily keys: ${totalMbKeys} | Matched: ${matchedKeys}/${matchedKeys + unmatchedKeys} | Unmatched MB: ${totalMbKeys - matchedMbKeys.size}`);

        const spendOnly = document.getElementById('treeSpendFilter').checked;
        const ads = Object.values(adAgg)
            .filter(a => !spendOnly || a.spend > 0)
            .map(a => {
                const m = deriveMetrics(a);
                const adDateMatch = (a.ad_name || '').match(/(\d{6})$/);
                let adGoLive = null;
                if (adDateMatch) {
                    const dd = adDateMatch[1].slice(0, 2), mm = adDateMatch[1].slice(2, 4), yy = adDateMatch[1].slice(4, 6);
                    adGoLive = '20' + yy + '-' + mm + '-' + dd;
                }
                const adFrom = adGoLive && adGoLive > dateFrom ? adGoLive : dateFrom;
                const _dateRange = adFrom.slice(5) + ' → ' + dateTo.slice(5);
                const daysLive = adGoLive ? Math.max(0, Math.round((Date.now() - new Date(adGoLive).getTime()) / 86400000)) : 0;
                return { ...m, _dateRange, goLiveDateISO: adGoLive, daysLive, isMatured: daysLive >= 14 };
            });

        const tree = {};
        for (const [campKey, raw] of Object.entries(campaignAgg)) {
            if (spendOnly && raw.spend <= 0) continue;
            tree[campKey] = {
                key: campKey,
                name: raw.campaign_name || '(No Campaign)',
                id: raw.campaign_id || '',
                totals: { ...deriveMetrics(raw), campaign_id: raw.campaign_id || '' },
                adsets: {},
            };
        }

        for (const [adsetKey, raw] of Object.entries(adsetAgg)) {
            if (spendOnly && raw.spend <= 0) continue;
            const campKey = normalizeCampaignName(raw.campaign_name || '');
            if (!tree[campKey]) {
                tree[campKey] = {
                    key: campKey,
                    name: raw.campaign_name || '(No Campaign)',
                    id: raw.campaign_id || '',
                    totals: { ...deriveMetrics({ ...emptyRaw(), campaign_name: raw.campaign_name || '', campaign_id: raw.campaign_id || '' }), campaign_id: raw.campaign_id || '' },
                    adsets: {},
                };
            }
            tree[campKey].adsets[adsetKey] = {
                key: adsetKey,
                name: raw.adset_name || '(No Adset)',
                id: raw.adset_id || '',
                totals: { ...deriveMetrics(raw), adset_id: raw.adset_id || '' },
                ads: [],
            };
        }

        for (const ad of ads) {
            const campKey = normalizeCampaignName(ad.campaign_name || '');
            const adsetKey = campKey + '|||' + normalizeAdsetName(ad.adset_name || '');
            if (!tree[campKey]) {
                tree[campKey] = {
                    key: campKey,
                    name: ad.campaign_name || '(No Campaign)',
                    id: ad.campaign_id || '',
                    totals: { ...deriveMetrics({ ...emptyRaw(), campaign_name: ad.campaign_name || '', campaign_id: ad.campaign_id || '' }), campaign_id: ad.campaign_id || '' },
                    adsets: {},
                };
            }
            if (!tree[campKey].adsets[adsetKey]) {
                tree[campKey].adsets[adsetKey] = {
                    key: adsetKey,
                    name: ad.adset_name || '(No Adset)',
                    id: ad.adset_id || '',
                    totals: { ...deriveMetrics({ ...emptyRaw(), campaign_name: ad.campaign_name || '', campaign_id: ad.campaign_id || '', adset_name: ad.adset_name || '', adset_id: ad.adset_id || '' }), adset_id: ad.adset_id || '' },
                    ads: [],
                };
            }
            tree[campKey].adsets[adsetKey].ads.push(ad);
        }

        for (const camp of Object.values(tree)) {
            for (const adset of Object.values(camp.adsets)) {
                adset.ads.sort((a, b) => b.spend - a.spend);
            }
        }

        let redCount = 0, greenCount = 0;
        const summaryTotals = deriveMetrics(sumRaw(Object.values(tree).map(c => c.totals)));
        const totalSpend = summaryTotals.spend;
        const totalSignups = summaryTotals.signups;
        const totalD6 = summaryTotals.d6Con;
        const totalInstalls = summaryTotals.installs;

        // Classify alerts per ad
        function classifyTreeAlert(d) {
            // Parse go-live from ad name for maturity check
            const adName = d.ad_name || d.name || '';
            const dateMatch = adName.match(/(\d{6})$/);
            let matured = d.isMatured;
            if (matured === undefined && dateMatch) {
                const dd = dateMatch[1].slice(0,2), mm = dateMatch[1].slice(2,4), yy = dateMatch[1].slice(4,6);
                const goLive = new Date('20' + yy + '-' + mm + '-' + dd);
                matured = (Date.now() - goLive.getTime()) / 86400000 >= 14;
            }

            if ((d.spend || d.spent || 0) < 15000) return 'neutral';

            // Get WoW trend data from window.allData if available
            let trendBreaches = 0, trendHits = 0;
            const wowAd = (window.allData || []).find(a => a.ad_id === d.ad_id);
            if (wowAd && wowAd._wow) {
                trendBreaches = wowAd._wow.trendBreaches || 0;
                trendHits = wowAd._wow.trendHits || 0;
            }

            // NON-MATURED: use early funnel signals, but exceptional D6 ROAS = always green
            if (!matured) {
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

            // MATURED: use matured D6 metrics (excl current week if available)
            const maturedD6ROAS = (wowAd && wowAd._wow && wowAd._wow.maturedD6ROAS != null) ? wowAd._wow.maturedD6ROAS : d.d6ROAS;
            const maturedD6CAC = (wowAd && wowAd._wow && wowAd._wow.maturedD6CAC != null) ? wowAd._wow.maturedD6CAC : d.d6CAC;

            if (maturedD6ROAS > 28) return 'green';
            let breaches = trendBreaches;
            if (d.signupCost > 1000) breaches++;
            if (d.d0TrialCost > 3500) breaches++;
            if (maturedD6CAC > 15000) breaches++;
            if (breaches >= 2) return 'red';
            let hits = trendHits;
            if (d.signupCost > 0 && d.signupCost < 500) hits++;
            if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) hits++;
            if (d.d6CAC > 0 && d.d6CAC < 12000) hits++;
            if (hits >= 2) return 'green';
            return 'neutral';
        }

        // Count alerts
        for (const ad of ads) {
            const alert = classifyTreeAlert(ad);
            if (alert === 'red') redCount++;
            else if (alert === 'green') greenCount++;
        }

        // Render summary — ROAS from deriveMetrics (sum raw first, then compute ratio)
        const overallROAS = (summaryTotals.d6ROAS || 0).toFixed(1);
        summaryEl.style.display = 'block';
        summaryEl.innerHTML = `
            <div class="tree-summary-cards">
                <div class="tree-summary-card"><div class="val" style="color:#6c5ce7;">${Object.keys(tree).length}</div><div class="lbl">Campaigns</div></div>
                <div class="tree-summary-card"><div class="val">${cur(totalSpend)}</div><div class="lbl">Total Spend</div></div>
                <div class="tree-summary-card"><div class="val">${num(totalInstalls)}</div><div class="lbl">Installs</div></div>
                <div class="tree-summary-card"><div class="val">${num(totalSignups)}</div><div class="lbl">Signups</div></div>
                <div class="tree-summary-card"><div class="val">${totalD6}</div><div class="lbl">D6 Conversions</div></div>
                <div class="tree-summary-card"><div class="val">${overallROAS}%</div><div class="lbl">D6 ROAS</div></div>
                <div class="tree-summary-card"><div class="val" style="color:#ef4444;">${redCount}</div><div class="lbl">Red Alerts</div></div>
                <div class="tree-summary-card"><div class="val" style="color:#10b981;">${greenCount}</div><div class="lbl">Green Alerts</div></div>
                <div class="tree-summary-card"><div class="val" style="color:#888;">${matchedKeys}/${matchedKeys + unmatchedKeys}</div><div class="lbl">Keys Matched</div></div>
            </div>`;

        // Render tree
        const sortedCampaigns = sortCampaignsPinnedLast(Object.values(tree), c => c.totals.spend);
        let html = '';
        for (const camp of sortedCampaigns) {
            const campAlert = classifyTreeAlert(camp.totals);
            html += renderTreeNode(camp.name, 'campaign', camp.totals, campAlert, () => {
                let inner = '';
                const sortedAdsets = Object.values(camp.adsets).sort((a, b) => b.totals.spend - a.totals.spend);
                for (const adset of sortedAdsets) {
                    const adsetAlert = classifyTreeAlert(adset.totals);
                    inner += renderTreeNode(adset.name, 'adset', adset.totals, adsetAlert, () => {
                        let adHtml = '';
                        for (const ad of adset.ads) {
                            const adAlert = classifyTreeAlert(ad);
                            const noFunnel = !ad._matched ? ' tree-no-funnel' : '';
                            adHtml += renderTreeNode(ad.ad_name, 'ad', ad, adAlert, null, noFunnel);
                        }
                        return adHtml;
                    });
                }
                return inner;
            });
        }
        container.innerHTML = html;

        status.textContent = `Done. ${Object.keys(tree).length} campaigns, ${ads.length} ads. ${matchedKeys} key matches, ${unmatchedKeys} unmatched.`;
        currentDateRange = { since: dateFrom, until: dateTo, label: buildDateRangeLabel(dateFrom, dateTo) };
        currentDataMode = summarizeMaturity(ads.map(ad => ({ isMatured: ad.isMatured })));
        currentDiagnostics = { source: 'Meta + Metabase • Campaign Tree', matchedKeys, unmatchedKeys };
        publishPortalContext({
            view: 'campaignTree',
            diagnostics: {
                source: 'Meta + Metabase • Campaign Tree',
                matchedKeys,
                unmatchedKeys,
                lastUpdated: document.getElementById('lastUpdated')?.textContent || '--',
            }
        });

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
        if (m.signupCost > 1000) reasons.push(`SU Cost ₹${Math.round(m.signupCost)} (> ₹1,000)`);
        if (m.d0TrialCost > 3500) reasons.push(`D0 Trial ₹${Math.round(m.d0TrialCost)} (> ₹3,500)`);
        if (m.d6CAC > 15000) reasons.push(`D6 CAC ₹${Math.round(m.d6CAC)} (> ₹15,000)`);
        if (m.d6ROAS <= 28 && m.d6ROAS > 0) reasons.push(`D6 ROAS ${m.d6ROAS.toFixed(1)}% (< 28%)`);
    } else if (alertType === 'green') {
        if (m.d6ROAS > 28) reasons.push(`D6 ROAS ${m.d6ROAS.toFixed(1)}% (> 28%)`);
        if (m.signupCost > 0 && m.signupCost < 500) reasons.push(`SU Cost ₹${Math.round(m.signupCost)} (< ₹500)`);
        if (m.d6CAC > 0 && m.d6CAC < 12000) reasons.push(`D6 CAC ₹${Math.round(m.d6CAC)} (< ₹12,000)`);
    }
    return reasons;
}

function getBudgetSuggestion(m, alertType) {
    if (m.spend < 5000) return null;
    if (alertType === 'green' && m.d6ROAS > 28) {
        return { action: 'increase', label: '↑ +20% Budget', reason: `D6 ROAS ${m.d6ROAS.toFixed(1)}% is above 28% target — scale up to capture more conversions`, color: '#10b981' };
    }
    if (alertType === 'green' && m.d6ROAS > 20) {
        return { action: 'increase', label: '↑ +20% Budget', reason: `D6 ROAS trending well at ${m.d6ROAS.toFixed(1)}% — cautious scale`, color: '#10b981' };
    }
    if (alertType === 'red') {
        return { action: 'decrease', label: '↓ -20% Budget', reason: `Underperforming metrics — reduce budget to limit losses while optimizing`, color: '#ef4444' };
    }
    if (m.d6ROAS > 0 && m.d6ROAS < 15 && m.spend > 30000) {
        return { action: 'decrease', label: '↓ -20% Budget', reason: `D6 ROAS only ${m.d6ROAS.toFixed(1)}% with ₹${Math.round(m.spend/1000)}K spent — cut to reallocate`, color: '#ef4444' };
    }
    return null;
}

function renderTreeNode(name, level, metrics, alertType, childrenFn, extraClass) {
    const id = 'tree-' + Math.random().toString(36).substr(2, 9);
    const hasChildren = !!childrenFn;
    const toggle = hasChildren ? `<span class="tree-toggle" onclick="toggleTreeNode('${id}')">&#9654;</span>` : '<span style="width:16px;display:inline-block;"></span>';
    const badge = alertType !== 'neutral' ? `<span class="tree-badge ${alertType}">${alertType === 'red' ? 'RED' : 'GREEN'}</span>` : '';

    const m = metrics;
    const metricsHtml = `
        <div class="tree-metrics">
            <div class="tree-metric"><div class="label">Spend</div><div class="value">${cur(m.spend)}</div></div>
            <div class="tree-metric"><div class="label">Installs</div><div class="value">${num(m.installs)}</div></div>
            <div class="tree-metric"><div class="label">CPI</div><div class="value">${m.cpi ? '₹' + Math.round(m.cpi) : '-'}</div></div>
            <div class="tree-metric"><div class="label">Signups</div><div class="value">${num(m.signups)}</div></div>
            <div class="tree-metric"><div class="label">SU Cost</div><div class="value" style="color:${m.signupCost ? (m.signupCost < 500 ? '#10b981' : m.signupCost > 1000 ? '#ef4444' : '#e0e0e0') : '#888'}">${m.signupCost ? '₹' + Math.round(m.signupCost) : '-'}</div></div>
            <div class="tree-metric"><div class="label">D0 Trial</div><div class="value">${m.d0TrialCost ? '₹' + Math.round(m.d0TrialCost) : '-'}</div></div>
            <div class="tree-metric"><div class="label">D6 CAC</div><div class="value" style="color:${m.d6CAC ? (m.d6CAC < 12000 ? '#10b981' : m.d6CAC > 15000 ? '#ef4444' : '#e0e0e0') : '#888'}">${m.d6CAC ? '₹' + Math.round(m.d6CAC) : '-'}</div></div>
            <div class="tree-metric"><div class="label">D6 ROAS</div><div class="value" style="color:${m.d6ROAS > 28 ? '#10b981' : m.d6ROAS > 0 ? '#ef4444' : '#888'}">${m.d6ROAS ? m.d6ROAS.toFixed(1) + '%' : '-'}</div></div>
            ${m._dateRange ? '<div class="tree-metric" style="min-width:auto;"><div class="label" style="font-size:9px;color:#666;">Data</div><div class="value" style="font-size:9px;color:#888;">' + m._dateRange + '</div></div>' : ''}
        </div>`;

    // Action buttons based on alert type and level
    let actionsHtml = '';
    const reasons = getTreeAlertReasons(m, alertType);

    if (level === 'ad' && alertType === 'red' && m.ad_id) {
        // Red alert ad: show pause button + reasons
        actionsHtml = `<div class="tree-actions" onclick="event.stopPropagation()">
            <div class="tree-insight tree-insight-red">
                <span class="tree-insight-icon">&#9888;</span>
                <span class="tree-insight-reasons">${reasons.join(' · ')}</span>
                <button class="tree-action-btn tree-btn-pause" onclick="window.pauseAd('${m.ad_id}', this)" title="Pause this ad on Meta">
                    &#10074;&#10074; Pause Ad
                </button>
            </div>
        </div>`;
    } else if (level === 'ad' && alertType === 'green') {
        actionsHtml = `<div class="tree-actions" onclick="event.stopPropagation()">
            <div class="tree-insight tree-insight-green">
                <span class="tree-insight-icon">&#10004;</span>
                <span class="tree-insight-reasons">${reasons.join(' · ')}</span>
            </div>
        </div>`;
    }

    // Budget suggestions for adsets and campaigns
    if ((level === 'adset' || level === 'campaign') && m.spend >= 5000) {
        const suggestion = getBudgetSuggestion(m, alertType);
        if (suggestion) {
            const entityId = level === 'adset' ? (m.adset_id || m.id || '') : (m.campaign_id || m.id || '');
            const apiEndpoint = level === 'adset' ? 'adset-budget' : 'campaign-budget';
            const idParam = level === 'adset' ? 'adset_id' : 'campaign_id';
            if (entityId) {
                actionsHtml += `<div class="tree-actions" onclick="event.stopPropagation()">
                    <div class="tree-insight" style="border-left-color:${suggestion.color}">
                        <span class="tree-insight-reasons" style="color:var(--text-dim)">${suggestion.reason}</span>
                        <button class="tree-action-btn" style="background:${suggestion.color};border-color:${suggestion.color}"
                            onclick="window.updateBudget('${apiEndpoint}', '${idParam}', '${entityId}', '${suggestion.action}', this)">
                            ${suggestion.label}
                        </button>
                    </div>
                </div>`;
            } else if (reasons.length) {
                actionsHtml += `<div class="tree-actions" onclick="event.stopPropagation()">
                    <div class="tree-insight" style="border-left-color:${alertType === 'red' ? '#ef4444' : alertType === 'green' ? '#10b981' : '#888'}">
                        <span class="tree-insight-reasons" style="color:var(--text-dim)">${reasons.join(' · ')}</span>
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

// Pause an ad via Meta API
window.pauseAd = async function(adId, btn) {
    if (!confirm('Pause this ad on Meta? This will stop it from delivering.')) return;
    const origText = btn.innerHTML;
    btn.innerHTML = '⏳ Pausing...';
    btn.disabled = true;
    try {
        const res = await fetch('/api/meta/ad-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ad_id: adId, status: 'PAUSED' })
        });
        const data = await res.json();
        if (data.success) {
            btn.innerHTML = '✓ Paused';
            btn.style.background = '#374151';
            btn.style.borderColor = '#374151';
            btn.style.color = '#9ca3af';
        } else {
            throw new Error(data.error || 'Failed');
        }
    } catch (err) {
        btn.innerHTML = origText;
        btn.disabled = false;
        alert('Failed to pause: ' + err.message);
    }
};

// Update budget via Meta API (±20%)
window.updateBudget = async function(endpoint, idParam, entityId, action, btn) {
    const actionLabel = action === 'increase' ? 'increase by 20%' : 'decrease by 20%';
    if (!confirm(`${actionLabel} budget for this ${idParam.replace('_id', '')}?`)) return;
    const origText = btn.innerHTML;
    btn.innerHTML = '⏳ Updating...';
    btn.disabled = true;
    try {
        const body = { [idParam]: entityId, action };
        const res = await fetch(`/api/meta/${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.success) {
            btn.innerHTML = `✓ ₹${Math.round(data.previous_budget)} → ₹${Math.round(data.new_budget)}`;
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
    const toggle = header.querySelector('.tree-toggle');
    if (toggle) toggle.classList.toggle('open');
};

// Helper formatters
function cur(v) { return '₹' + Math.round(v).toLocaleString('en-IN'); }
function curK(v) { return v >= 100000 ? '₹' + (v/100000).toFixed(1) + 'L' : v >= 1000 ? '₹' + (v/1000).toFixed(1) + 'K' : '₹' + Math.round(v); }
function num(v) { return v.toLocaleString('en-IN'); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// =========================================================================
// WEEKLY BREAKDOWN
// =========================================================================
function localDateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getWeekBuckets() {
    const today = new Date(); today.setHours(12, 0, 0, 0); // noon to avoid DST issues
    const buckets = [];
    // Bucket 0: Today
    const todayStr = localDateStr(today);
    buckets.push({ label: 'Today', from: todayStr, to: todayStr, dates: new Set([todayStr]) });
    // Buckets 1-4: last 4 weeks (7 days each, going backwards from yesterday)
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

// emptyRaw(), deriveMetrics(), sumRaw() — shared at top of file
// sumRawBuckets uses the shared emptyRaw() for weekly pivot
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
    const status = document.getElementById('treeStatus');
    const treeContainer = document.getElementById('treeContainer');
    const weeklyContainer = document.getElementById('weeklyTreeContainer');
    const btn = document.getElementById('weeklyBtn');

    btn.disabled = true;
    treeContainer.style.display = 'none';
    weeklyContainer.style.display = 'block';
    weeklyContainer.innerHTML = '';
    document.getElementById('treeSummary').style.display = 'none';
    status.textContent = 'Fetching last 28 days + today...';

    const buckets = getWeekBuckets();
    const dateFrom = buckets[buckets.length - 1].from; // oldest week start
    const dateTo = buckets[0].to; // today
    const asOfDate = localDateStr(new Date());

    try {
        // Fetch buckets sequentially to avoid hammering Meta/Metabase with 10 concurrent calls.
        // This is slower in theory, but much more reliable on local startup.
        status.textContent = 'Fetching 5 weekly buckets from Meta + Metabase...';
        const bucketResults = [];
        for (let idx = 0; idx < buckets.length; idx++) {
            const bkt = buckets[idx];
            status.textContent = `Fetching weekly bucket ${idx + 1}/${buckets.length}: ${bkt.label}...`;
            const [metaRes, mbRes] = await Promise.all([
                fetch(`${TREE_SERVER}/api/meta/ad-insights-daily`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dateFrom: bkt.from, dateTo: bkt.to }),
                }).then(r => r.json()),
                fetch(`${TREE_SERVER}/api/metabase/ad-funnel`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dateFrom: bkt.from, dateTo: bkt.to }),
                }).then(r => r.json()),
            ]);
            console.log(`[Weekly] Bucket ${idx} (${bkt.label}): Meta=${metaRes.total || 0} MB=${mbRes.total || 0}`);
            bucketResults.push({ meta: metaRes, mb: mbRes, bucketIdx: idx });
        }

        // Build per-ad bucketed data + direct campaign/adset Metabase aggregates
        const adWeekly = {};
        const campMB = {};   // campaign → buckets (direct from Metabase)
        const adsetMB = {};  // campaign|||adset → buckets (direct from Metabase)
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

        for (const { meta, mb, bucketIdx } of bucketResults) {
            if (!meta.success || !mb.success) continue;

            // FIXED: ID-based join — Direct Metabase aggregates by campaign and adset
            for (const rawRow of mb.data) {
                const row = matureFunnelRow(rawRow, asOfDate);
                // Campaign level — keyed by meta_campaign_id
                const campId = normalizeCampaignName(row.campaign_name || '');
                if (!campMB[campId]) campMB[campId] = buckets.map(() => emptyRaw());
                addMBToRaw(campMB[campId][bucketIdx], row);
                // Adset level — keyed by meta_campaign_id|||normalized(adset)
                const asKey = campId + '|||' + (row.ad_set_name || '').toLowerCase().trim();
                if (!adsetMB[asKey]) adsetMB[asKey] = buckets.map(() => emptyRaw());
                addMBToRaw(adsetMB[asKey][bucketIdx], row);
            }

            // FIXED: ID-based join — Ad-level: Meta spend + matched Metabase funnel
            const mbLookup = {};
            for (const rawRow of mb.data) {
                const row = matureFunnelRow(rawRow, asOfDate);
                const key = normalizeCampaignName(row.campaign_name || '') + '|||' + normalizeAdsetName(row.ad_set_name || '') + '|||' + normalizeTrackerName(row.tracker_name || '');
                if (!mbLookup[key]) mbLookup[key] = emptyRaw();
                addMBToRaw(mbLookup[key], row);
            }

            const metaRows = (meta.data || []).filter(r => /android/i.test(r.campaign_name || ''));
            const metaByAd = {};
            for (const row of metaRows) {
                const adUid = row.campaign_name + '|||' + row.adset_name + '|||' + row.ad_name;
                if (!metaByAd[adUid]) {
                    metaByAd[adUid] = { ...row, spend: 0, impressions: 0, clicks: 0, installs: 0 };
                }
                metaByAd[adUid].spend += row.spend;
                metaByAd[adUid].impressions += row.impressions;
                metaByAd[adUid].clicks += row.clicks;
                metaByAd[adUid].installs += row.installs;
            }

            for (const [adUid, row] of Object.entries(metaByAd)) {
                if (!adWeekly[adUid]) {
                    adWeekly[adUid] = {
                        campaign_name: row.campaign_name, adset_name: row.adset_name, ad_name: row.ad_name,
                        campaign_id: row.campaign_id, adset_id: row.adset_id, ad_id: row.ad_id,
                        buckets: buckets.map(() => emptyRaw()),
                    };
                }
                const b = adWeekly[adUid].buckets[bucketIdx];
                b.spend += row.spend * 1.18;
                b.impressions += row.impressions;
                b.clicks += row.clicks;
                b.installs += row.installs;

                // FIXED: ID-based join
                const mbKey = normalizeCampaignName(row.campaign_name || '') + '|||' + normalizeAdsetName(row.adset_name || '') + '|||' + normalizeTrackerName(row.ad_name || '');
                const mbRow = mbLookup[mbKey];
                if (mbRow) {
                    matched++;
                    addMBToRaw(b, mbRow);
                } else { unmatched++; }
            }
        }

        // Filter spend-only if checked
        const spendOnly = document.getElementById('treeSpendFilter').checked;
        const adList = Object.values(adWeekly).filter(a => !spendOnly || a.buckets.some(b => b.spend > 0));

        // Build tree: campaign → adset → ad
        const tree = {};
        for (const ad of adList) {
            if (!tree[ad.campaign_name]) tree[ad.campaign_name] = { name: ad.campaign_name, campaign_id: ad.campaign_id, adsets: {} };
            const camp = tree[ad.campaign_name];
            if (!camp.adsets[ad.adset_name]) camp.adsets[ad.adset_name] = { name: ad.adset_name, ads: [] };
            camp.adsets[ad.adset_name].ads.push(ad);
        }

        // Campaign/adset buckets: use Meta spend from ads + direct Metabase funnel (not ad rollup)
        for (const camp of Object.values(tree)) {
            // FIXED: ID-based join — Campaign: sum Meta spend from ads, funnel from direct Metabase
            const spendBuckets = sumRawBuckets(Object.values(camp.adsets).flatMap(as => as.ads), buckets.length);
            const mbBuckets = campMB[normalizeCampaignName(camp.name || '')] || buckets.map(() => emptyRaw());
            camp.buckets = spendBuckets.map((sb, i) => ({
                ...mbBuckets[i],
                spend: sb.spend, impressions: sb.impressions, clicks: sb.clicks, installs: sb.installs,
            }));

            for (const adset of Object.values(camp.adsets)) {
                adset.ads.sort((a, b) => b.buckets.reduce((s, x) => s + x.spend, 0) - a.buckets.reduce((s, x) => s + x.spend, 0));
                const asSpendBuckets = sumRawBuckets(adset.ads, buckets.length);
                // FIXED: ID-based join
                const asKey = normalizeCampaignName(camp.name || '') + '|||' + normalizeAdsetName(adset.name || '');
                const asMbBuckets = adsetMB[asKey] || buckets.map(() => emptyRaw());
                adset.buckets = asSpendBuckets.map((sb, i) => ({
                    ...asMbBuckets[i],
                    spend: sb.spend, impressions: sb.impressions, clicks: sb.clicks, installs: sb.installs,
                }));
            }
        }

        // Sort campaigns by total spend
        const sortedCampaigns = sortCampaignsPinnedLast(
            Object.values(tree),
            c => c.buckets.reduce((s, x) => s + x.spend, 0)
        );

        // Metric column headers (shared for all weekly tables)
        const metricCols = ['Spend', 'Installs', 'CPI', 'Signups', 'SU Cost', 'D0 Trial', 'D6', 'D6 CAC', 'D6 ROAS'];

        // Render tree: campaign → (weekly rows + adsets) → (weekly rows + ads) → weekly rows
        let html = '';
        for (const camp of sortedCampaigns) {
            const totalSpend = camp.buckets.reduce((s, b) => s + b.spend, 0);
            const totalSignups = camp.buckets.reduce((s, b) => s + b.signups, 0);
            const cId = 'wk-' + Math.random().toString(36).substr(2, 8);
            html += wkHeader(camp.name, 'campaign', totalSpend, totalSignups, cId);
            html += `<div class="wk-children collapsed" id="${cId}-children">`;
            html += wkTable(camp.buckets, buckets, metricCols);
            // Adsets
            const sortedAdsets = Object.values(camp.adsets).sort((a, b) =>
                b.buckets.reduce((s, x) => s + x.spend, 0) - a.buckets.reduce((s, x) => s + x.spend, 0));
            for (const adset of sortedAdsets) {
                const asSpend = adset.buckets.reduce((s, b) => s + b.spend, 0);
                const asSignups = adset.buckets.reduce((s, b) => s + b.signups, 0);
                const aId = 'wk-' + Math.random().toString(36).substr(2, 8);
                html += wkHeader(adset.name, 'adset', asSpend, asSignups, aId);
                html += `<div class="wk-children collapsed" id="${aId}-children">`;
                html += wkTable(adset.buckets, buckets, metricCols);
                // Ads
                for (const ad of adset.ads) {
                    const adSpend = ad.buckets.reduce((s, b) => s + b.spend, 0);
                    const adSignups = ad.buckets.reduce((s, b) => s + b.signups, 0);
                    const adNodeId = 'wk-' + Math.random().toString(36).substr(2, 8);
                    html += wkHeader(ad.ad_name, 'ad', adSpend, adSignups, adNodeId);
                    html += `<div class="wk-children collapsed" id="${adNodeId}-children">`;
                    html += wkTable(ad.buckets, buckets, metricCols);
                    html += '</div>';
                }
                html += '</div>';
            }
            html += '</div>';
        }

        weeklyContainer.innerHTML = html;
        status.textContent = `Weekly: ${sortedCampaigns.length} campaigns, ${adList.length} ads. Matched: ${matched}/${matched + unmatched}`;
        currentDateRange = { since: dateFrom, until: dateTo, label: buildDateRangeLabel(dateFrom, dateTo) };
        currentDataMode = summarizeMaturity(adList.map(ad => ({ isMatured: ad.isMatured })));
        currentDiagnostics = { source: 'Meta + Metabase • Weekly Breakdown', matchedKeys: matched, unmatchedKeys: unmatched };
        publishPortalContext({
            view: 'campaignTree',
            diagnostics: {
                source: 'Meta + Metabase • Weekly Breakdown',
                matchedKeys: matched,
                unmatchedKeys: unmatched,
                lastUpdated: document.getElementById('lastUpdated')?.textContent || '--',
            }
        });

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
        const roasColor = m.d6ROAS > 28 ? '#10b981' : m.d6ROAS > 0 ? '#ef4444' : '#888';
        const suCostColor = m.signupCost ? (m.signupCost < 500 ? '#10b981' : m.signupCost > 1000 ? '#ef4444' : '#e0e0e0') : '#888';
        const d6CACColor = m.d6CAC ? (m.d6CAC < 12000 ? '#10b981' : m.d6CAC > 15000 ? '#ef4444' : '#e0e0e0') : '#888';
        html += `<tr>
            <td class="wk-tbl-period">${label}</td>
            <td>${raw.spend > 0 ? curK(raw.spend) : '-'}</td>
            <td>${raw.installs || '-'}</td>
            <td>${m.cpi ? '₹' + Math.round(m.cpi) : '-'}</td>
            <td>${raw.signups || '-'}</td>
            <td style="color:${suCostColor}">${m.signupCost ? '₹' + Math.round(m.signupCost) : '-'}</td>
            <td>${raw.d0_trial || '-'}</td>
            <td>${raw.d6 || '-'}</td>
            <td style="color:${d6CACColor}">${m.d6CAC ? '₹' + Math.round(m.d6CAC) : '-'}</td>
            <td style="color:${roasColor}">${m.d6ROAS ? m.d6ROAS.toFixed(1) + '%' : '-'}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    return html;
}
