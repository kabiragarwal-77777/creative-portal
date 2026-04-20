const {
    getCiDb, saveSnapshots, getLatestSnapshots, getSnapshotHistory,
    saveTrends, getTrends, saveActions, getActiveActions,
    saveAnalysis, getLatestAnalysis, logPipelineRun, updatePipelineRun, getLastPipelineRun,
    upsertRoasTracker, updateRoasTrackerPrediction, updateRoasTrackerAccuracy,
    getRoasTrackerAds, getUnpredictedTrackerAds,
} = require('./db');
const { cachedAsync } = require('../utils/ai-cache');
const { getInternalBase, getInternalAuthHeader, getMetabaseSessionToken, refreshMetabaseSessionToken } = require('../config/env');

module.exports = function (config) {
    // config = { metaApiBase, metaAdAccountId, metaAccessToken, metaAppSecretProof,
    //            metabaseUrl, metabaseSessionToken, openaiApiKey, targetCampaigns }

    const predictor = require('./predictor')(config);

    const META_API_BASE = config.metaApiBase || 'https://graph.facebook.com/v21.0';
    const META_AD_ACCOUNT_ID = config.metaAdAccountId || 'act_725019929189148';
    const META_ACCESS_TOKEN = config.metaAccessToken || '';
    const META_APP_SECRET_PROOF = config.metaAppSecretProof || '';
    const METABASE_URL = config.metabaseUrl || 'https://analytics.univest.in';
    const OPENAI_API_KEY = config.openaiApiKey || '';
    const TARGET_CAMPAIGNS = config.targetCampaigns || [];
    const INTERNAL_BASE = getInternalBase(process.env.CI_PORT || 3001);
    const AUTH_HEADERS = getInternalAuthHeader();

    // --- Scheduler state ---
    let schedulerInterval = null;
    let schedulerRunning = false;
    let lastRunTime = null;
    let nextRunTime = null;
    let schedulerHours = 24;

    // --- Helper: Meta API params ---
    function metaParams(extra = {}) {
        return {
            access_token: META_ACCESS_TOKEN,
            appsecret_proof: META_APP_SECRET_PROOF,
            ...extra,
        };
    }

    function resolveMetabaseSessionToken() {
        return getMetabaseSessionToken() || config.metabaseSessionToken || '';
    }

    // =========================================================================
    // collectSnapshots
    // =========================================================================
    async function collectSnapshots(dateFrom, dateTo) {
        const runId = logPipelineRun('collect', JSON.stringify({ dateFrom, dateTo }));
        const batchId = `batch_${Date.now()}`;

        try {
            if (!dateFrom) dateFrom = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
            if (!dateTo) dateTo = new Date().toISOString().slice(0, 10);

            // ----- 1. Fetch Meta daily ad-level insights in 14-day chunks -----
            const allMetaRows = [];
            const metaFields = 'campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,spend,impressions,clicks,cpm,ctr,cpc,actions,cost_per_action_type,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions';
            const CHUNK_DAYS = 14;

            const chunks = [];
            let chunkStart = new Date(dateFrom);
            const endDate = new Date(dateTo);
            while (chunkStart < endDate) {
                let chunkEnd = new Date(chunkStart.getTime() + CHUNK_DAYS * 86400000);
                if (chunkEnd > endDate) chunkEnd = endDate;
                chunks.push({
                    since: chunkStart.toISOString().slice(0, 10),
                    until: chunkEnd.toISOString().slice(0, 10),
                });
                chunkStart = new Date(chunkEnd.getTime() + 86400000);
            }
            console.log(`[ci/engine] Fetching Meta data in ${chunks.length} chunks of ${CHUNK_DAYS} days...`);

            let totalPages = 0;
            for (let ci = 0; ci < chunks.length; ci++) {
                const chunk = chunks[ci];
                console.log(`[ci/engine] Chunk ${ci + 1}/${chunks.length}: ${chunk.since} to ${chunk.until}`);

                const mp = metaParams({
                    fields: metaFields,
                    level: 'ad',
                    time_increment: 1,
                    time_range: JSON.stringify(chunk),
                    limit: 500,
                });

                let nextUrl = `${META_API_BASE}/${META_AD_ACCOUNT_ID}/insights?${new URLSearchParams(mp).toString()}`;
                while (nextUrl) {
                    totalPages++;
                    const response = await fetch(nextUrl);
                    const data = await response.json();

                    if (data.error) {
                        console.error(`[ci/engine] Meta error on chunk ${ci + 1}: ${data.error.message}`);
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
                console.log(`[ci/engine] Chunk ${ci + 1} done. Total rows so far: ${allMetaRows.length}`);
            }
            console.log(`[ci/engine] Meta done. ${totalPages} pages, ${allMetaRows.length} total rows.`);

            // ----- 2. Filter to TARGET_CAMPAIGNS -----
            const targetSet = new Set(TARGET_CAMPAIGNS.map(n => n.trim()));
            const filteredMetaRows = allMetaRows.filter(row => targetSet.has((row.campaign_name || '').trim()));
            console.log(`[ci/engine] Filtered to ${filteredMetaRows.length} rows from target campaigns.`);

            // ----- 3. Flatten Meta rows into structured objects -----
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
                    thruplay, p25, p50, p75, p100,
                    three_sec_views: threeSecViews,
                    hook_rate: impressions > 0 ? threeSecViews / impressions : 0,
                    hold_rate: threeSecViews > 0 ? thruplay / threeSecViews : 0,
                    completion_rate: impressions > 0 ? p100 / impressions : 0,
                };
            });

            // ----- 4. Fetch Metabase funnel data -----
            const campaignNamesSQL = TARGET_CAMPAIGNS.map(n => `'${n}'`).join(',');
            // FIXED: ID-based join via SPLIT_PART(tracker_name, ':', 2)
            const sql = `
WITH meta_attributed AS (
  SELECT
    SPLIT_PART(uad.tracker_name, ':', 2) AS meta_campaign_id,
    uad.tracker_campaign_name AS campaign_name,
    LOWER(TRIM(uad.tracker_sub_campaign_name)) AS adset_name,
    regexp_replace(uad.tracker_name, ':.*$', '', 'g') AS tracker_name,
    uad.user_id,
    uad.priority,
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
GROUP BY 1,2,3
ORDER BY SUM(sm.total_signup) DESC`;

            let funnelData = [];
            try {
                console.log('[ci/engine] Fetching Metabase funnel data...');
                let metabaseToken = resolveMetabaseSessionToken();
                if (!metabaseToken) metabaseToken = await refreshMetabaseSessionToken('creative intelligence engine').catch(() => '');
                const metabaseRequest = (sessionToken) => fetch(`${METABASE_URL}/api/dataset`, {
                    method: 'POST',
                    headers: {
                        'X-Metabase-Session': sessionToken,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        database: 2,
                        type: 'native',
                        native: { query: sql },
                    }),
                });
                let metabaseRes = metabaseToken ? await metabaseRequest(metabaseToken) : null;
                if (metabaseRes && metabaseRes.status === 401) {
                    const refreshed = await refreshMetabaseSessionToken('creative intelligence engine 401').catch(() => '');
                    if (refreshed) metabaseRes = await metabaseRequest(refreshed);
                }

                if (metabaseRes && metabaseRes.ok) {
                    const result = await metabaseRes.json();
                    const columns = result.data.cols.map(c => c.name);
                    funnelData = result.data.rows.map(row => {
                        const obj = {};
                        columns.forEach((col, i) => { obj[col] = row[i]; });
                        return obj;
                    });
                    console.log(`[ci/engine] Metabase done. ${funnelData.length} funnel rows.`);
                } else if (metabaseRes) {
                    console.error('[ci/engine] Metabase error:', await metabaseRes.text());
                }
            } catch (mbErr) {
                console.error('[ci/engine] Metabase fetch failed:', mbErr.message);
            }

            // ----- 5. Merge Meta + Metabase by ad_name <-> tracker_name -----
            // Normalize: lowercase, trim, strip colon suffix, normalize statics->static
            function normAdName(name) {
                if (!name) return '';
                return name.toLowerCase().trim().replace(/:.*$/, '').replace('statics_', 'static_');
            }
            function stripPrefix(name) {
                return normAdName(name).replace(/^fb_(mof|bof)_(video_|static_|inf[_-])?/i, '');
            }

            const funnelLookup = {};
            for (const row of funnelData) {
                if (row.tracker_name) {
                    const key = normAdName(row.tracker_name);
                    funnelLookup[key] = row;
                    const stripped = stripPrefix(row.tracker_name);
                    if (stripped && stripped !== key) funnelLookup[stripped] = row;
                }
            }
            console.log(`[ci/engine] Funnel lookup: ${Object.keys(funnelLookup).length} keys. Sample: ${Object.keys(funnelLookup).slice(0, 3).join(', ')}`);

            // Aggregate Meta rows per ad_name (daily -> totals)
            const adAgg = {};
            for (const row of metaAds) {
                const key = row.ad_name;
                if (!adAgg[key]) {
                    adAgg[key] = {
                        ad_name: row.ad_name, ad_id: row.ad_id,
                        campaign_name: row.campaign_name, campaign_id: row.campaign_id,
                        adset_name: row.adset_name, adset_id: row.adset_id,
                        spend: 0, impressions: 0, clicks: 0, installs: 0,
                        thruplay: 0, p25: 0, p50: 0, p75: 0, p100: 0,
                        three_sec_views: 0, dates: [],
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
            }

            // Build combined creative records
            const combinedCreatives = Object.values(adAgg).map(a => {
                const spendDates = a.dates.sort();
                const goLiveDate = spendDates.length > 0 ? spendDates[0] : null;
                const daysLive = spendDates.length > 0
                    ? Math.ceil((new Date(spendDates[spendDates.length - 1]) - new Date(spendDates[0])) / 86400000) + 1
                    : 0;

                const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
                const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
                const cpc = a.clicks > 0 ? a.spend / a.clicks : 0;
                const cpi = a.installs > 0 ? a.spend / a.installs : null;
                const hook_rate = a.impressions > 0 ? a.three_sec_views / a.impressions : 0;
                const hold_rate = a.three_sec_views > 0 ? a.thruplay / a.three_sec_views : 0;
                const completion_rate = a.impressions > 0 ? a.p100 / a.impressions : 0;

                const type = a.ad_name.includes('Video_') ? 'Video' : a.ad_name.includes('Static_') ? 'Static' : 'Unknown';

                // Match funnel data using normalized keys
                const funnelKey = normAdName(a.ad_name);
                const funnelKeyStripped = stripPrefix(a.ad_name);
                const funnel = funnelLookup[funnelKey] || funnelLookup[funnelKeyStripped] || {};

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
                const d15_overall_revenue = parseFloat(funnel.d15_overall_revenue || 0);
                const d30_overall_revenue = parseFloat(funnel.d30_overall_revenue || 0);
                const d60_overall_revenue = parseFloat(funnel.d60_overall_revenue || 0);
                const d180_overall_revenue = parseFloat(funnel.d180_overall_revenue || 0);

                const signup_cost = signups > 0 ? a.spend / signups : null;
                const d0_trial_cost = d0_trial > 0 ? a.spend / d0_trial : null;
                const d6_cac = d6 > 0 ? a.spend / d6 : null;
                // ROAS validity check — reject impossible values from matching errors
                const _valROAS = (sp, rev) => { if (!sp || sp <= 0 || !rev || rev < 0) return null; if (rev / sp > 50) return null; return (rev / sp) * 100; };
                const d6_roas = _valROAS(a.spend, d6_overall_revenue);
                const d15_roas = _valROAS(a.spend, d15_overall_revenue);
                const d30_roas = _valROAS(a.spend, d30_overall_revenue);
                const d60_roas = _valROAS(a.spend, d60_overall_revenue);
                const d180_roas = _valROAS(a.spend, d180_overall_revenue);
                const overall_roas = _valROAS(a.spend, overall_revenue);

                return {
                    snapshot_date: dateTo,
                    ad_name: a.ad_name,
                    ad_id: a.ad_id,
                    campaign_name: a.campaign_name,
                    adset_name: a.adset_name,
                    creative_type: type,
                    spend: Math.round(a.spend * 100) / 100,
                    impressions: a.impressions,
                    clicks: a.clicks,
                    cpm: Math.round(cpm * 100) / 100,
                    ctr: Math.round(ctr * 100) / 100,
                    cpc: Math.round(cpc * 100) / 100,
                    installs: a.installs,
                    cpi: cpi ? Math.round(cpi * 100) / 100 : null,
                    hook_rate: Math.round(hook_rate * 10000) / 100,
                    hold_rate: Math.round(hold_rate * 10000) / 100,
                    completion_rate: Math.round(completion_rate * 10000) / 100,
                    signups, p0_signup, p1_signup,
                    d0_trial, d0,
                    d0_revenue: Math.round(d0_revenue * 100) / 100,
                    d6,
                    d6_revenue: Math.round(d6_revenue * 100) / 100,
                    d6_overall_revenue: Math.round(d6_overall_revenue * 100) / 100,
                    d15_overall_revenue: Math.round(d15_overall_revenue * 100) / 100,
                    d30_overall_revenue: Math.round(d30_overall_revenue * 100) / 100,
                    d60_overall_revenue: Math.round(d60_overall_revenue * 100) / 100,
                    d180_overall_revenue: Math.round(d180_overall_revenue * 100) / 100,
                    overall_revenue: Math.round(overall_revenue * 100) / 100,
                    signup_cost: signup_cost ? Math.round(signup_cost * 100) / 100 : null,
                    d0_trial_cost: d0_trial_cost ? Math.round(d0_trial_cost * 100) / 100 : null,
                    d6_cac: d6_cac ? Math.round(d6_cac * 100) / 100 : null,
                    d6_roas: d6_roas != null ? Math.round(d6_roas * 100) / 100 : null,
                    d15_roas: d15_roas != null ? Math.round(d15_roas * 100) / 100 : null,
                    d30_roas: d30_roas != null ? Math.round(d30_roas * 100) / 100 : null,
                    d60_roas: d60_roas != null ? Math.round(d60_roas * 100) / 100 : null,
                    d180_roas: d180_roas != null ? Math.round(d180_roas * 100) / 100 : null,
                    overall_roas: overall_roas != null ? Math.round(overall_roas * 100) / 100 : null,
                    go_live_date: goLiveDate,
                    days_live: daysLive,
                };
            });

            console.log(`[ci/engine] ${combinedCreatives.length} combined creatives built.`);

            // ----- 6. Store as snapshots -----
            saveSnapshots(combinedCreatives, batchId);
            console.log(`[ci/engine] Saved ${combinedCreatives.length} snapshots with batch ${batchId}.`);

            updatePipelineRun(runId, 'completed', JSON.stringify({ snapshotCount: combinedCreatives.length, batchId }));
            return { snapshotCount: combinedCreatives.length, batchId };

        } catch (err) {
            console.error('[ci/engine] collectSnapshots error:', err);
            updatePipelineRun(runId, 'failed', null, err.message);
            throw err;
        }
    }

    // =========================================================================
    // computeTrends
    // =========================================================================
    function computeTrends() {
        const latestSnapshots = getLatestSnapshots();
        if (latestSnapshots.length === 0) return { trendsComputed: 0 };

        const latestDate = latestSnapshots[0].snapshot_date;
        const d = getCiDb();

        // Metrics where LOWER is better (reverse direction logic)
        const lowerIsBetter = new Set(['cpi', 'signup_cost', 'd6_cac']);
        const metrics = ['spend', 'cpi', 'd6_roas', 'overall_roas', 'hook_rate', 'signup_cost', 'd6_cac'];
        const periods = [
            { name: '7d', days: 7 },
            { name: '14d', days: 14 },
            { name: '30d', days: 30 },
        ];

        const trendRows = [];

        for (const snap of latestSnapshots) {
            for (const metric of metrics) {
                const currentValue = snap[metric];
                if (currentValue === null || currentValue === undefined) continue;

                for (const period of periods) {
                    const prevDateStr = new Date(new Date(latestDate).getTime() - period.days * 86400000).toISOString().slice(0, 10);
                    const prevSnap = d.prepare(`
                        SELECT ${metric} FROM snapshots
                        WHERE ad_id = ? AND snapshot_date = ?
                    `).get(snap.ad_id, prevDateStr);

                    const prevValue = prevSnap ? prevSnap[metric] : null;
                    let pctChange = null;
                    let direction = 'flat';

                    if (prevValue !== null && prevValue !== undefined && prevValue !== 0) {
                        pctChange = ((currentValue - prevValue) / Math.abs(prevValue)) * 100;
                        pctChange = Math.round(pctChange * 100) / 100;

                        if (lowerIsBetter.has(metric)) {
                            // For cost metrics: decrease is improving
                            if (pctChange < -5) direction = 'improving';
                            else if (pctChange > 5) direction = 'declining';
                            else direction = 'flat';
                        } else {
                            // For revenue/rate metrics: increase is improving
                            if (pctChange > 5) direction = 'improving';
                            else if (pctChange < -5) direction = 'declining';
                            else direction = 'flat';
                        }
                    }

                    trendRows.push({
                        ad_id: snap.ad_id,
                        ad_name: snap.ad_name,
                        metric_name: metric,
                        period: period.name,
                        value_current: currentValue,
                        value_previous: prevValue,
                        pct_change: pctChange,
                        direction,
                    });
                }
            }
        }

        saveTrends(trendRows);
        console.log(`[ci/engine] Computed ${trendRows.length} trend rows for ${latestSnapshots.length} ads.`);
        return { trendsComputed: trendRows.length };
    }

    // =========================================================================
    // generateActions
    // =========================================================================
    function generateActions() {
        const latestSnapshots = getLatestSnapshots();
        if (latestSnapshots.length === 0) return { actionsGenerated: 0, actions: [] };

        const allTrends = getTrends();
        // Build trend lookup: { ad_id: { metric_period: trendRow } }
        const trendLookup = {};
        for (const t of allTrends) {
            if (!trendLookup[t.ad_id]) trendLookup[t.ad_id] = {};
            trendLookup[t.ad_id][`${t.metric_name}_${t.period}`] = t;
        }

        const actionRows = [];

        function getTrend(adId, metric, period) {
            return (trendLookup[adId] || {})[`${metric}_${period}`] || {};
        }

        function r(v) { return v !== null && v !== undefined ? Math.round(v * 100) / 100 : 'N/A'; }
        function cur(v) { return v !== null && v !== undefined ? `\u20B9${Math.round(v).toLocaleString('en-IN')}` : 'N/A'; }

        for (const snap of latestSnapshots) {
            const reasons = [];
            let actionType = null;
            let priority = 0;
            let confidence = 'medium';

            const spend = snap.spend || 0;
            const d6_roas = snap.d6_roas || 0;
            const signups = snap.signups || 0;
            const cpi = snap.cpi || 0;
            const d6 = snap.d6 || 0;
            const daysLive = snap.days_live || 0;
            const signup_cost = snap.signup_cost || 0;
            const hook_rate = snap.hook_rate || 0;
            const overall_roas = snap.overall_roas || 0;
            const d6RoasTrend7d = getTrend(snap.ad_id, 'd6_roas', '7d');

            // --- KILL rules (priority 10) ---
            if (spend >= 3000 && d6_roas < 20 && daysLive >= 7) {
                reasons.push(`D6 ROAS is ${r(d6_roas)}% (below 20% threshold) with ${cur(spend)} spent over ${daysLive} days`);
                actionType = 'KILL'; priority = 10; confidence = 'high';
            }
            if (spend >= 1500 && signups === 0 && daysLive >= 5) {
                reasons.push(`Zero signups after ${cur(spend)} spent over ${daysLive} days`);
                if (!actionType || priority < 10) { actionType = 'KILL'; priority = 10; confidence = 'high'; }
            }
            if (cpi > 200 && d6 === 0 && daysLive >= 7) {
                reasons.push(`CPI of ${cur(cpi)} with zero D6 conversions after ${daysLive} days`);
                if (!actionType || priority < 10) { actionType = 'KILL'; priority = 10; confidence = 'high'; }
            }

            // --- PAUSE rules (priority 7) ---
            if (!actionType) {
                if (spend >= 2000 && d6_roas < 40 && daysLive >= 10) {
                    reasons.push(`D6 ROAS is ${r(d6_roas)}% (below 40% threshold) with ${cur(spend)} spent over ${daysLive} days`);
                    actionType = 'PAUSE'; priority = 7; confidence = 'high';
                }
                if (spend >= 1000 && signup_cost > 500 && d6 === 0) {
                    reasons.push(`Signup cost ${cur(signup_cost)} with zero D6 conversions`);
                    if (!actionType || priority < 7) { actionType = 'PAUSE'; priority = 7; }
                }
                if (d6RoasTrend7d.direction === 'declining' && d6RoasTrend7d.pct_change !== null && d6RoasTrend7d.pct_change < -30) {
                    reasons.push(`D6 ROAS declining ${r(Math.abs(d6RoasTrend7d.pct_change))}% over 7 days (from ${r(d6RoasTrend7d.value_previous)}% to ${r(d6RoasTrend7d.value_current)}%)`);
                    if (!actionType || priority < 7) { actionType = 'PAUSE'; priority = 7; confidence = 'medium'; }
                }
                if (hook_rate < 5 && spend >= 1000) {
                    reasons.push(`Hook rate only ${r(hook_rate)}% with ${cur(spend)} spent - creative not engaging`);
                    if (!actionType || priority < 7) { actionType = 'PAUSE'; priority = 7; confidence = 'medium'; }
                }
            }

            // --- WATCH rules (priority 4) ---
            if (!actionType) {
                if (spend >= 500 && d6_roas >= 40 && d6_roas < 70) {
                    reasons.push(`D6 ROAS is ${r(d6_roas)}% (between 40-70% range) - needs monitoring`);
                    actionType = 'WATCH'; priority = 4;
                }
                if (daysLive < 5 && spend > 500) {
                    reasons.push(`New creative (${daysLive} days live) with ${cur(spend)} spent - too early to judge`);
                    if (!actionType || priority < 4) { actionType = 'WATCH'; priority = 4; confidence = 'low'; }
                }
                // Check any key metric declining > 15% over 7d
                const keyMetrics = ['d6_roas', 'overall_roas', 'hook_rate', 'cpi', 'signup_cost'];
                for (const km of keyMetrics) {
                    const t = getTrend(snap.ad_id, km, '7d');
                    if (t.pct_change !== null && t.pct_change !== undefined) {
                        const isLowerBetter = km === 'cpi' || km === 'signup_cost';
                        const effectiveChange = isLowerBetter ? -t.pct_change : t.pct_change;
                        if (effectiveChange < -15) {
                            reasons.push(`${km} declining ${r(Math.abs(t.pct_change))}% over 7 days`);
                            if (!actionType || priority < 4) { actionType = 'WATCH'; priority = 4; }
                        }
                    }
                }
                if (hook_rate > 15 && d6 === 0) {
                    reasons.push(`Good hook rate (${r(hook_rate)}%) but zero D6 conversions - engagement without conversion`);
                    if (!actionType || priority < 4) { actionType = 'WATCH'; priority = 4; }
                }
            }

            // --- SCALE rules (priority 1) ---
            if (!actionType) {
                if (d6_roas >= 100 && spend < 5000) {
                    reasons.push(`Strong D6 ROAS of ${r(d6_roas)}% with only ${cur(spend)} spent - room to scale`);
                    actionType = 'SCALE'; priority = 1; confidence = 'high';
                }
                if (d6_roas >= 80 && d6RoasTrend7d.direction === 'improving' && spend < 8000) {
                    reasons.push(`D6 ROAS of ${r(d6_roas)}% and improving (${r(d6RoasTrend7d.pct_change)}% over 7d) with ${cur(spend)} spent`);
                    if (!actionType || priority < 1) { actionType = 'SCALE'; priority = 1; confidence = 'high'; }
                }
                if (overall_roas >= 150 && d6 >= 3) {
                    reasons.push(`Excellent overall ROAS of ${r(overall_roas)}% with ${d6} D6 conversions`);
                    if (!actionType || priority < 1) { actionType = 'SCALE'; priority = 1; confidence = 'high'; }
                }
            }

            if (actionType && reasons.length > 0) {
                actionRows.push({
                    ad_id: snap.ad_id,
                    ad_name: snap.ad_name,
                    campaign_name: snap.campaign_name,
                    adset_name: snap.adset_name,
                    action_type: actionType,
                    confidence,
                    reasons,
                    metrics_snapshot: {
                        spend, d6_roas, overall_roas, signups, cpi, d6,
                        signup_cost, hook_rate, days_live: daysLive,
                    },
                    priority,
                });
            }
        }

        saveActions(actionRows);
        console.log(`[ci/engine] Generated ${actionRows.length} actions.`);
        return { actionsGenerated: actionRows.length, actions: actionRows };
    }

    // =========================================================================
    // runGptAnalysis
    // =========================================================================
    async function runGptAnalysis(dateFrom, dateTo) {
        const runId = logPipelineRun('gpt_analysis', JSON.stringify({ dateFrom, dateTo }));

        try {
            const snapshots = getLatestSnapshots();
            const allTrends = getTrends();
            const actions = getActiveActions();

            if (snapshots.length === 0) {
                updatePipelineRun(runId, 'completed', 'No snapshots to analyze');
                return { analysis: null, message: 'No snapshots available' };
            }

            // Build compact payload
            const payload = snapshots.map(s => ({
                n: s.ad_name, id: s.ad_id, c: s.campaign_name, as: s.adset_name,
                t: s.creative_type, sp: s.spend, imp: s.impressions, cl: s.clicks,
                cpm: s.cpm, ctr: s.ctr, cpc: s.cpc, inst: s.installs, cpi: s.cpi,
                hr: s.hook_rate, hlr: s.hold_rate, cr: s.completion_rate,
                su: s.signups, p0: s.p0_signup, p1: s.p1_signup,
                d0t: s.d0_trial, d0: s.d0, d0r: s.d0_revenue,
                d6: s.d6, d6r: s.d6_revenue, d6or: s.d6_overall_revenue,
                or: s.overall_revenue, sc: s.signup_cost, d0tc: s.d0_trial_cost,
                d6c: s.d6_cac, d6ro: s.d6_roas, oro: s.overall_roas,
                gl: s.go_live_date, dl: s.days_live,
            }));

            // Build trends summary per ad
            const trendsByAd = {};
            for (const t of allTrends) {
                if (!trendsByAd[t.ad_id]) trendsByAd[t.ad_id] = [];
                trendsByAd[t.ad_id].push({
                    m: t.metric_name, p: t.period, cur: t.value_current,
                    prev: t.value_previous, pct: t.pct_change, dir: t.direction,
                });
            }

            // Build actions summary
            const actionsSummary = actions.map(a => ({
                n: a.ad_name, type: a.action_type, pri: a.priority,
                reasons: JSON.parse(a.reasons || '[]'),
            }));

            const prompt = `You are a senior performance marketing analyst for a fintech app (Univest). Analyze the following creative performance data and provide strategic recommendations.

ABBREVIATION KEY: n=ad_name, id=ad_id, c=campaign, as=adset, t=type, sp=spend(INR), imp=impressions, cl=clicks, cpm=CPM, ctr=CTR%, cpc=CPC, inst=installs, cpi=CPI, hr=hook_rate%, hlr=hold_rate%, cr=completion_rate%, su=signups, p0=P0_signup, p1=P1_signup, d0t=D0_trial, d0=D0_conv, d0r=D0_revenue, d6=D6_conv, d6r=D6_revenue, d6or=D6_overall_revenue, or=overall_revenue, sc=signup_cost, d0tc=D0_trial_cost, d6c=D6_CAC, d6ro=D6_ROAS%, oro=overall_ROAS%, gl=go_live_date, dl=days_live

CREATIVE DATA (${payload.length} ads):
${JSON.stringify(payload)}

TRENDS BY AD:
${JSON.stringify(trendsByAd)}

AUTO-GENERATED ACTIONS (${actionsSummary.length}):
${JSON.stringify(actionsSummary)}

Provide a comprehensive analysis in JSON format:
{
  "summary": "2-3 sentence executive summary",
  "portfolio_health": { "total_spend": X, "avg_d6_roas": X, "top_performers": N, "underperformers": N },
  "top_performers": [{ "ad_name": "", "d6_roas": X, "why": "" }],
  "underperformers": [{ "ad_name": "", "d6_roas": X, "issue": "" }],
  "creative_patterns": {
    "winning_themes": ["..."],
    "losing_themes": ["..."],
    "format_insights": "..."
  },
  "trend_alerts": [{ "ad_name": "", "metric": "", "change": "", "recommendation": "" }],
  "strategic_recommendations": [{ "priority": "high/medium/low", "action": "", "expected_impact": "" }],
  "budget_reallocation": [{ "ad_name": "", "current_spend": X, "suggested_action": "increase/decrease/pause/kill", "reason": "" }]
}`;

            const analysisText = await cachedAsync(
                ['ci.engine.runGptAnalysis', dateFrom, dateTo, prompt],
                async () => {
                    const gptRes = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${OPENAI_API_KEY}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            model: 'gpt-5.4',
                            messages: [{ role: 'user', content: prompt }],
                            temperature: 0.3,
                            max_completion_tokens: 3000,
                            response_format: { type: 'json_object' },
                        }),
                    });

                    const gptData = await gptRes.json();
                    return gptData.choices?.[0]?.message?.content || '{}';
                }
            );
            let parsed;
            try { parsed = JSON.parse(analysisText); } catch { parsed = { raw: analysisText }; }

            saveAnalysis('full_pipeline', dateFrom, dateTo, snapshots.length, analysisText, 'gpt-5.4');
            updatePipelineRun(runId, 'completed', JSON.stringify({ creativesAnalyzed: snapshots.length }));

            console.log(`[ci/engine] GPT analysis complete for ${snapshots.length} creatives.`);
            return { analysis: parsed };

        } catch (err) {
            console.error('[ci/engine] runGptAnalysis error:', err);
            updatePipelineRun(runId, 'failed', null, err.message);
            throw err;
        }
    }

    // =========================================================================
    // runFullPipeline
    // =========================================================================
    async function runFullPipeline(options = {}) {
        const dateFrom = options.dateFrom || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
        const dateTo = options.dateTo || new Date().toISOString().slice(0, 10);
        const skipGpt = options.skipGpt || false;

        console.log(`[ci/engine] Running full pipeline: ${dateFrom} to ${dateTo}`);
        const runId = logPipelineRun('full_pipeline', JSON.stringify({ dateFrom, dateTo, skipGpt }));

        try {
            // Step 1: Collect snapshots
            const collectResult = await collectSnapshots(dateFrom, dateTo);

            // Step 2: Compute trends
            const trendResult = computeTrends();

            // Step 3: Generate actions
            const actionResult = generateActions();

            // Step 4: GPT analysis (optional)
            let analysisResult = null;
            if (!skipGpt && OPENAI_API_KEY) {
                analysisResult = await runGptAnalysis(dateFrom, dateTo);
            }

            // Stage 5: Build/update cohort benchmarks
            console.log('[ci/engine] Building cohort benchmarks...');
            const cohortResult = predictor.buildCohortBenchmarks();
            console.log(`[ci/engine] Built ${cohortResult.cohortsBuilt} cohort benchmarks.`);

            // Stage 6: Detect new ads and generate predictions
            console.log('[ci/engine] Detecting new ads for prediction...');
            const predResult = await predictor.detectAndPredictNewAds();
            console.log(`[ci/engine] Generated ${predResult.predicted} predictions.`);

            // Stage 7: Track prediction accuracy for past predictions
            console.log('[ci/engine] Tracking prediction accuracy...');
            const accuracyResult = predictor.trackPredictionAccuracy();
            console.log(`[ci/engine] Updated accuracy for ${accuracyResult.tracked} predictions.`);

            const result = {
                collect: collectResult,
                trends: trendResult,
                actions: actionResult,
                analysis: analysisResult,
                cohorts: cohortResult,
                predictions: predResult,
                accuracy: accuracyResult,
            };

            updatePipelineRun(runId, 'completed', JSON.stringify(result));
            lastRunTime = new Date();
            console.log(`[ci/engine] Full pipeline complete.`);
            return result;

        } catch (err) {
            console.error('[ci/engine] Full pipeline error:', err);
            updatePipelineRun(runId, 'failed', null, err.message);
            throw err;
        }
    }

    // =========================================================================
    // Scheduler
    // =========================================================================
    function getSchedulerStatus() {
        return {
            running: schedulerRunning,
            lastRun: lastRunTime ? lastRunTime.toISOString() : null,
            nextRun: nextRunTime ? nextRunTime.toISOString() : null,
            interval: `${schedulerHours}h`,
        };
    }

    function startScheduler(intervalHours) {
        if (schedulerInterval) clearInterval(schedulerInterval);
        schedulerHours = intervalHours || 24;
        schedulerRunning = true;

        const intervalMs = schedulerHours * 3600000;
        nextRunTime = new Date(Date.now() + intervalMs);

        schedulerInterval = setInterval(async () => {
            try {
                console.log(`[ci/engine] Scheduler triggered at ${new Date().toISOString()}`);
                await runFullPipeline();
                lastRunTime = new Date();
                nextRunTime = new Date(Date.now() + intervalMs);
            } catch (err) {
                console.error('[ci/engine] Scheduled pipeline run failed:', err.message);
            }
        }, intervalMs);

        console.log(`[ci/engine] Scheduler started. Interval: ${schedulerHours}h. Next run: ${nextRunTime.toISOString()}`);
    }

    function stopScheduler() {
        if (schedulerInterval) {
            clearInterval(schedulerInterval);
            schedulerInterval = null;
        }
        schedulerRunning = false;
        nextRunTime = null;
        console.log('[ci/engine] Scheduler stopped.');
    }

    // =========================================================================
    // Pattern Detection
    // =========================================================================
    function getWinnerLoserPatterns() {
        const snapshots = getLatestSnapshots();
        if (snapshots.length < 4) return { winnerPatterns: [], loserPatterns: [] };

        // Sort by d6_roas descending
        const sorted = [...snapshots].sort((a, b) => (b.d6_roas || 0) - (a.d6_roas || 0));
        const q = Math.max(1, Math.floor(sorted.length / 4));
        const top25 = sorted.slice(0, q);
        const bottom25 = sorted.slice(-q);

        function extractFeatures(ads) {
            const types = {};
            const languages = {};
            const concepts = {};
            const metrics = { spend: 0, cpi: 0, d6_roas: 0, hook_rate: 0, signup_cost: 0, count: 0 };

            for (const ad of ads) {
                // Creative type
                const t = ad.creative_type || 'Unknown';
                types[t] = (types[t] || 0) + 1;

                // Language hints from ad name
                const name = ad.ad_name || '';
                const langMatch = name.match(/_(Hindi|English|Tamil|Telugu|Kannada|Bengali|Marathi|Gujarati|Eng|Hin)/i);
                if (langMatch) {
                    const lang = langMatch[1].toLowerCase();
                    languages[lang] = (languages[lang] || 0) + 1;
                }

                // Concept keywords - extract meaningful parts from ad name
                const parts = name.split(/[_\-]/);
                for (const part of parts) {
                    const p = part.trim().toLowerCase();
                    if (p.length > 3 && !/^\d+$/.test(p) && !['video', 'static', 'mof', 'campaign', 'test'].includes(p)) {
                        concepts[p] = (concepts[p] || 0) + 1;
                    }
                }

                // Aggregate metrics
                metrics.spend += ad.spend || 0;
                metrics.cpi += ad.cpi || 0;
                metrics.d6_roas += ad.d6_roas || 0;
                metrics.hook_rate += ad.hook_rate || 0;
                metrics.signup_cost += ad.signup_cost || 0;
                metrics.count++;
            }

            if (metrics.count > 0) {
                metrics.spend /= metrics.count;
                metrics.cpi /= metrics.count;
                metrics.d6_roas /= metrics.count;
                metrics.hook_rate /= metrics.count;
                metrics.signup_cost /= metrics.count;
            }

            return { types, languages, concepts, avgMetrics: metrics };
        }

        const winnerFeatures = extractFeatures(top25);
        const loserFeatures = extractFeatures(bottom25);

        // Build pattern descriptions
        const winnerPatterns = [];
        const loserPatterns = [];

        // Type patterns
        for (const [type, count] of Object.entries(winnerFeatures.types)) {
            const loserCount = loserFeatures.types[type] || 0;
            if (count > loserCount) {
                winnerPatterns.push({
                    pattern: `${type} creatives`,
                    detail: `${count}/${top25.length} top performers are ${type} (vs ${loserCount}/${bottom25.length} in bottom)`,
                    avgD6Roas: Math.round(winnerFeatures.avgMetrics.d6_roas * 100) / 100,
                });
            }
        }
        for (const [type, count] of Object.entries(loserFeatures.types)) {
            const winnerCount = winnerFeatures.types[type] || 0;
            if (count > winnerCount) {
                loserPatterns.push({
                    pattern: `${type} creatives`,
                    detail: `${count}/${bottom25.length} underperformers are ${type} (vs ${winnerCount}/${top25.length} in top)`,
                    avgD6Roas: Math.round(loserFeatures.avgMetrics.d6_roas * 100) / 100,
                });
            }
        }

        // Language patterns
        for (const [lang, count] of Object.entries(winnerFeatures.languages)) {
            if (count >= 2) {
                winnerPatterns.push({
                    pattern: `${lang} language`,
                    detail: `${count} top performers use ${lang}`,
                });
            }
        }
        for (const [lang, count] of Object.entries(loserFeatures.languages)) {
            if (count >= 2 && !(winnerFeatures.languages[lang] >= count)) {
                loserPatterns.push({
                    pattern: `${lang} language`,
                    detail: `${count} underperformers use ${lang}`,
                });
            }
        }

        // Concept patterns (only frequent ones)
        for (const [concept, count] of Object.entries(winnerFeatures.concepts)) {
            if (count >= 2 && (winnerFeatures.concepts[concept] || 0) > (loserFeatures.concepts[concept] || 0)) {
                winnerPatterns.push({
                    pattern: `"${concept}" concept`,
                    detail: `Appears in ${count} top performers`,
                });
            }
        }

        return {
            winnerPatterns,
            loserPatterns,
            topQuartileAvg: {
                d6_roas: Math.round(winnerFeatures.avgMetrics.d6_roas * 100) / 100,
                hook_rate: Math.round(winnerFeatures.avgMetrics.hook_rate * 100) / 100,
                cpi: Math.round(winnerFeatures.avgMetrics.cpi * 100) / 100,
            },
            bottomQuartileAvg: {
                d6_roas: Math.round(loserFeatures.avgMetrics.d6_roas * 100) / 100,
                hook_rate: Math.round(loserFeatures.avgMetrics.hook_rate * 100) / 100,
                cpi: Math.round(loserFeatures.avgMetrics.cpi * 100) / 100,
            },
        };
    }

    // =========================================================================
    // ROAS Tracker — snapshot + predict + track for ads since 2026-03-10
    // =========================================================================

    const ROAS_TRACKER_START_DATE = '2026-03-10';
    let roasTrackerInterval = null;

    // Parse go-live date from ad name suffix (e.g. "FB_MOF_Static_Retirement_V0_030326" → 2026-03-03)
    function parseAdDate(adName) {
        if (!adName) return null;
        const match = adName.match(/(\d{6})$/);
        if (!match) return null;
        const ddmmyy = match[1];
        const dd = ddmmyy.slice(0, 2);
        const mm = ddmmyy.slice(2, 4);
        const yy = ddmmyy.slice(4, 6);
        return `20${yy}-${mm}-${dd}`;
    }

    async function snapshotAndTrackLiveAds(forceRefresh) {
        const dateTo = new Date().toISOString().slice(0, 10);
        console.log(`[roas-tracker] Starting snapshot. Only test campaign ads with go-live >= ${ROAS_TRACKER_START_DATE}`);

        try {
            // 1. Use the SAME cached data as the dashboard (no separate fetch)
            //    Call the regular API endpoints — they use the cache from pre-warm
            const metaUrl = INTERNAL_BASE;
            const [metaRes, funnelRes] = await Promise.all([
                fetch(`${metaUrl}/api/meta/ad-insights-daily`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
                    body: JSON.stringify({ dateFrom: ROAS_TRACKER_START_DATE, dateTo, noCache: forceRefresh || false }),
                }).then(r => r.json()),
                fetch(`${metaUrl}/api/metabase/ad-funnel`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...AUTH_HEADERS },
                    body: JSON.stringify({ dateFrom: ROAS_TRACKER_START_DATE, dateTo, noCache: forceRefresh || false }),
                }).then(r => r.json()),
            ]);

            const metaRows = (metaRes.data || []).filter(r => /android/i.test(r.campaign_name));
            const funnelRows = funnelRes.data || [];
            const isTruncated = metaRes.truncated || false;
            console.log(`[roas-tracker] Fetched ${metaRows.length} Meta rows, ${funnelRows.length} funnel rows.${isTruncated ? ' WARNING: Meta data is truncated!' : ''}`);

            if (metaRows.length === 0) {
                console.warn('[roas-tracker] Meta returned 0 rows (likely rate limited). Skipping.');
                return { snapshots: 0, tracked: 0, newAds: 0, updated: 0, predicted: 0, skipped: true };
            }

            // Detect truncated data: count unique dates — should roughly match date range
            const uniqueDates = new Set(metaRows.map(r => r.date_start));
            const expectedDays = Math.ceil((new Date(dateTo) - new Date(ROAS_TRACKER_START_DATE)) / 86400000) + 1;
            if (uniqueDates.size < expectedDays * 0.5) {
                console.warn(`[roas-tracker] Data likely truncated: ${uniqueDates.size} unique dates for ${expectedDays}-day range. Skipping snapshot to protect existing data.`);
                return { snapshots: 0, tracked: 0, newAds: 0, updated: 0, predicted: 0, skipped: true, reason: 'truncated_data' };
            }

            // 2. Filter to TARGET_CAMPAIGNS only
            const targetSet = new Set(TARGET_CAMPAIGNS.map(n => n.trim()));
            const targetMetaRows = metaRows.filter(r => targetSet.has((r.campaign_name || '').trim()));

            // 3. Filter to ads with go-live date >= March 10 (parsed from ad name suffix)
            const eligibleAdNames = new Set();
            targetMetaRows.forEach(r => {
                const goLive = parseAdDate(r.ad_name);
                if (goLive && goLive >= ROAS_TRACKER_START_DATE) {
                    eligibleAdNames.add(r.ad_name);
                }
            });
            const eligibleRows = targetMetaRows.filter(r => eligibleAdNames.has(r.ad_name));
            console.log(`[roas-tracker] ${targetMetaRows.length} test campaign rows → ${eligibleAdNames.size} ads with go-live >= ${ROAS_TRACKER_START_DATE} (${eligibleRows.length} daily rows).`);

            // 4. Build Metabase daily lookup (same matching as campaign tree / dashboard)
            const mbDaily = {};
            for (const row of funnelRows) {
                const d = String(row.date || '').substring(0, 10);
                const key = d + '|||' + (row.campaign_name || '') + '|||' + (row.ad_set_name || '').toLowerCase().trim() + '|||' + (row.tracker_name || '').replace(/:.*$/, '');
                if (!mbDaily[key]) {
                    mbDaily[key] = { signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0, d6: 0, d6_revenue: 0, overall_revenue: 0, p0_signup: 0, p1_signup: 0, total_trial: 0, d6_overall_con: 0, d6_overall_revenue: 0, d15_overall_con: 0, d15_overall_revenue: 0, d30_overall_con: 0, d30_overall_revenue: 0, d60_overall_con: 0, d60_overall_revenue: 0, d180_overall_con: 0, d180_overall_revenue: 0 };
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
                m.d180_overall_con += Number(row.d180_overall_con) || 0;
                m.d180_overall_revenue += Number(row.d180_overall_revenue) || 0;
            }

            // 5. Aggregate per campaign|||adset|||ad with daily Metabase matching
            //    (identical logic to fetchLiveData in app.js and campaign tree)
            const adAgg = {};
            for (const row of eligibleRows) {
                const adUid = (row.campaign_name || '') + '|||' + (row.adset_name || '') + '|||' + (row.ad_name || '');
                if (!adAgg[adUid]) {
                    adAgg[adUid] = {
                        ad_name: row.ad_name, ad_id: row.ad_id,
                        campaign_name: row.campaign_name, adset_name: row.adset_name,
                        spend: 0, impressions: 0, clicks: 0, installs: 0,
                        signups: 0, d0_trial: 0, d6: 0, d6_revenue: 0, overall_revenue: 0,
                        d6_overall_con: 0, d6_overall_revenue: 0,
                        d15_overall_con: 0, d15_overall_revenue: 0,
                        d30_overall_con: 0, d30_overall_revenue: 0,
                        d60_overall_con: 0, d60_overall_revenue: 0,
                        d180_overall_con: 0, d180_overall_revenue: 0,
                        p0_signup: 0, p1_signup: 0,
                        dates: [], _matched: false,
                    };
                }
                const a = adAgg[adUid];
                a.spend += (row.spend || 0) * 1.18;
                a.impressions += row.impressions || 0;
                a.clicks += row.clicks || 0;
                a.installs += row.installs || 0;
                if (row.spend > 0) a.dates.push(row.date_start);

                const mbKey = (row.date_start || '') + '|||' + (row.campaign_name || '') + '|||' + (row.adset_name || '').toLowerCase().trim() + '|||' + (row.ad_name || '').replace(/:.*$/, '');
                const mb = mbDaily[mbKey];
                if (mb) {
                    a._matched = true;
                    a.signups += mb.signups;
                    a.d0_trial += mb.d0_trial;
                    a.d6 += mb.d6;
                    a.d6_revenue += mb.d6_revenue;
                    a.overall_revenue += mb.overall_revenue;
                    a.d6_overall_con += mb.d6_overall_con;
                    a.d6_overall_revenue += mb.d6_overall_revenue;
                    a.d15_overall_con += mb.d15_overall_con || 0;
                    a.d15_overall_revenue += mb.d15_overall_revenue || 0;
                    a.d30_overall_con += mb.d30_overall_con || 0;
                    a.d30_overall_revenue += mb.d30_overall_revenue || 0;
                    a.d60_overall_con += mb.d60_overall_con || 0;
                    a.d60_overall_revenue += mb.d60_overall_revenue || 0;
                    a.d180_overall_con += mb.d180_overall_con || 0;
                    a.d180_overall_revenue += mb.d180_overall_revenue || 0;
                    a.p0_signup += mb.p0_signup;
                    a.p1_signup += mb.p1_signup;
                }
            }

            // 6. Build combined creative records with derived metrics
            //    Validate per-ad: if an ad has far fewer daily rows than expected, its spend is truncated
            const batchId = `rt_${Date.now()}`;
            let truncatedAdCount = 0;
            const combinedCreatives = Object.values(adAgg).filter(a => {
                const goLiveDate = parseAdDate(a.ad_name);
                if (!goLiveDate) return true; // can't validate, keep
                const expectedDaysForAd = Math.ceil((new Date(dateTo) - new Date(goLiveDate)) / 86400000);
                const actualDays = a.dates.length;
                // If we have less than 30% of expected days with spend, this ad's data is truncated
                if (expectedDaysForAd > 5 && actualDays < expectedDaysForAd * 0.3 && a.spend > 0) {
                    truncatedAdCount++;
                    return false; // exclude from snapshot
                }
                return true;
            }).map(a => {
                const goLiveDate = parseAdDate(a.ad_name);
                const spendDates = a.dates.sort();
                const daysLive = goLiveDate ? Math.ceil((new Date(dateTo) - new Date(goLiveDate)) / 86400000) : 0;
                const cpi = a.installs > 0 ? a.spend / a.installs : null;
                const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
                const type = a.ad_name.includes('Video_') ? 'Video' : a.ad_name.includes('Static') ? 'Static' : 'Unknown';
                const signup_cost = a.signups > 0 ? a.spend / a.signups : null;
                const d6_cac = a.d6_overall_con > 0 ? a.spend / a.d6_overall_con : null;
                // ROAS validity: reject revenue/spend > 50x as matching error
                const _vR = (sp, rev) => { if (!sp || sp <= 0 || !rev || rev < 0) return null; if (rev / sp > 50) return null; return (rev / sp) * 100; };
                const d6_roas = _vR(a.spend, a.d6_overall_revenue);
                const overall_roas = _vR(a.spend, a.overall_revenue);
                const d15_roas = _vR(a.spend, a.d15_overall_revenue || 0);
                const d30_roas = _vR(a.spend, a.d30_overall_revenue || 0);
                const d60_roas = _vR(a.spend, a.d60_overall_revenue || 0);
                const d180_roas = _vR(a.spend, a.d180_overall_revenue || 0);

                return {
                    snapshot_date: dateTo, ad_id: a.ad_id, ad_name: a.ad_name,
                    campaign_name: a.campaign_name, adset_name: a.adset_name,
                    creative_type: type,
                    spend: Math.round(a.spend * 100) / 100,
                    impressions: a.impressions, clicks: a.clicks, installs: a.installs,
                    cpi: cpi ? Math.round(cpi * 100) / 100 : null,
                    ctr: Math.round(ctr * 100) / 100,
                    signups: a.signups, p0_signup: a.p0_signup, p1_signup: a.p1_signup,
                    d0_trial: a.d0_trial, d6: a.d6_overall_con,
                    d6_revenue: Math.round(a.d6_revenue * 100) / 100,
                    d6_overall_revenue: Math.round(a.d6_overall_revenue * 100) / 100,
                    d15_overall_revenue: Math.round((a.d15_overall_revenue || 0) * 100) / 100,
                    d30_overall_revenue: Math.round((a.d30_overall_revenue || 0) * 100) / 100,
                    d60_overall_revenue: Math.round((a.d60_overall_revenue || 0) * 100) / 100,
                    d180_overall_revenue: Math.round((a.d180_overall_revenue || 0) * 100) / 100,
                    overall_revenue: Math.round(a.overall_revenue * 100) / 100,
                    signup_cost: signup_cost ? Math.round(signup_cost * 100) / 100 : null,
                    d6_cac: d6_cac ? Math.round(d6_cac * 100) / 100 : null,
                    d6_roas: d6_roas != null ? Math.round(d6_roas * 100) / 100 : null,
                    d15_roas: d15_roas != null ? Math.round(d15_roas * 100) / 100 : null,
                    d30_roas: d30_roas != null ? Math.round(d30_roas * 100) / 100 : null,
                    d60_roas: d60_roas != null ? Math.round(d60_roas * 100) / 100 : null,
                    d180_roas: d180_roas != null ? Math.round(d180_roas * 100) / 100 : null,
                    overall_roas: overall_roas != null ? Math.round(overall_roas * 100) / 100 : null,
                    go_live_date: goLiveDate, days_live: daysLive,
                };
            });

            // Also add zero-spend test campaign ads from ads-status (never delivered but should be tracked)
            try {
                const statusRes = await fetch(`${metaUrl}/api/meta/ads-status`, { headers: AUTH_HEADERS }).then(r => r.json());
                if (statusRes.success && statusRes.data) {
                    const existingAdIds = new Set(combinedCreatives.map(c => c.ad_id));
                    statusRes.data.forEach(ad => {
                        if (!targetSet.has(ad.campaign_name)) return;
                        if (existingAdIds.has(ad.ad_id)) return;
                        const goLive = parseAdDate(ad.ad_name);
                        if (!goLive || goLive < ROAS_TRACKER_START_DATE) return;
                        combinedCreatives.push({
                            snapshot_date: dateTo, ad_id: ad.ad_id, ad_name: ad.ad_name,
                            campaign_name: ad.campaign_name, adset_name: '', creative_type: ad.ad_name.includes('Video_') ? 'Video' : 'Static',
                            spend: 0, impressions: 0, clicks: 0, installs: 0,
                            signups: 0, d0_trial: 0, d6: 0, d6_revenue: 0, d6_overall_revenue: 0,
                            d15_overall_revenue: 0, d30_overall_revenue: 0, d60_overall_revenue: 0, d180_overall_revenue: 0,
                            overall_revenue: 0, d6_roas: null, d15_roas: null, d30_roas: null, d60_roas: null, d180_roas: null, overall_roas: null,
                            go_live_date: goLive, days_live: Math.max(0, Math.round((Date.now() - new Date(goLive).getTime()) / 86400000)),
                        });
                    });
                }
            } catch(e) {}

            if (truncatedAdCount > 0) {
                console.warn(`[roas-tracker] Excluded ${truncatedAdCount} ads with truncated API data (too few daily rows).`);
            }
            const matched = combinedCreatives.filter(c => c.signups > 0 || c.d6 > 0).length;
            console.log(`[roas-tracker] ${combinedCreatives.length} creatives since ${ROAS_TRACKER_START_DATE} (${matched} with funnel data).`);

            // 7. Save snapshots to DB
            saveSnapshots(combinedCreatives, batchId);
            const snapResult = { snapshotCount: combinedCreatives.length, batchId };

            // 2. Get latest snapshot per ad, filter to ads with go_live_date >= start
            const db = getCiDb();
            const latestSnapshots = db.prepare(`
                SELECT s.* FROM snapshots s
                INNER JOIN (
                    SELECT ad_id, MAX(snapshot_date) as max_date
                    FROM snapshots
                    GROUP BY ad_id
                ) latest ON s.ad_id = latest.ad_id AND s.snapshot_date = latest.max_date
                WHERE s.go_live_date >= ?
                ORDER BY s.spend ASC
            `).all(ROAS_TRACKER_START_DATE);

            console.log(`[roas-tracker] ${latestSnapshots.length} ads since ${ROAS_TRACKER_START_DATE}.`);

            // 3. Upsert each into roas_tracker
            let newCount = 0;
            let updatedCount = 0;
            const needsPrediction = [];

            for (const snap of latestSnapshots) {
                const result = upsertRoasTracker({
                    ad_id: snap.ad_id,
                    ad_name: snap.ad_name,
                    campaign_name: snap.campaign_name,
                    adset_name: snap.adset_name,
                    creative_type: snap.creative_type,
                    go_live_date: snap.go_live_date,
                    spend: snap.spend,
                    installs: snap.installs,
                    signups: snap.signups,
                    d6: snap.d6,
                    cpi: snap.cpi,
                    d6_roas: snap.d6_roas,
                    overall_roas: snap.overall_roas,
                    d6_overall_revenue: snap.d6_overall_revenue,
                    overall_revenue: snap.overall_revenue,
                    days_live: snap.days_live,
                    snapshot_date: snap.snapshot_date,
                    is_active: 1,
                });

                if (result.isNew) newCount++;
                else updatedCount++;

                if (result.needsPrediction && snap.spend > 0) {
                    needsPrediction.push(snap);
                }
            }

            console.log(`[roas-tracker] Upserted: ${newCount} new, ${updatedCount} updated. ${needsPrediction.length} need predictions.`);

            // 4. Build cohort benchmarks first (needed for predictions)
            if (needsPrediction.length > 0) {
                try {
                    predictor.buildCohortBenchmarks();
                } catch (e) {
                    console.warn('[roas-tracker] Cohort benchmark build warning:', e.message);
                }
            }

            // 5. Run predictions for unpredicted ads
            let predictedCount = 0;
            for (const snap of needsPrediction) {
                try {
                    const prediction = await predictor.predictNewAd(snap);
                    if (prediction) {
                        // For low-spend ads, enhance with GPT (skip if AI prediction already has qualitative)
                        if (snap.spend < 15000 && predictor.enhanceWithGpt && !prediction.gpt_qualitative) {
                            try {
                                const gptEnhanced = await predictor.enhanceWithGpt(prediction, snap);
                                if (gptEnhanced && gptEnhanced.gpt_qualitative) {
                                    prediction.gpt_qualitative = typeof gptEnhanced.gpt_qualitative === 'string'
                                        ? gptEnhanced.gpt_qualitative
                                        : JSON.stringify(gptEnhanced.gpt_qualitative);
                                }
                            } catch (gptErr) {
                                console.warn(`[roas-tracker] GPT enhancement failed for ${snap.ad_name}: ${gptErr.message}`);
                            }
                        }

                        // Save prediction to predictions table
                        const predId = require('./db').savePrediction({
                            ...prediction,
                            ad_id: snap.ad_id,
                            ad_name: snap.ad_name,
                            campaign_name: snap.campaign_name,
                            adset_name: snap.adset_name,
                            creative_type: snap.creative_type,
                            batch_id: snapResult.batchId,
                        });

                        // Update roas_tracker with prediction
                        updateRoasTrackerPrediction(snap.ad_id, {
                            id: predId,
                            predicted_d6_roas: prediction.predicted_d6_roas,
                            predicted_d6_low: prediction.predicted_d6_low,
                            predicted_d6_high: prediction.predicted_d6_high,
                            predicted_d30_roas: prediction.predicted_d30_roas,
                            predicted_d60_roas: prediction.predicted_d60_roas,
                            predicted_d180_roas: prediction.predicted_d180_roas,
                            confidence_score: prediction.confidence_score,
                            trajectory: prediction.trajectory,
                            recommended_action: prediction.recommended_action,
                        });

                        predictedCount++;
                    }
                } catch (predErr) {
                    console.warn(`[roas-tracker] Prediction failed for ${snap.ad_name}: ${predErr.message}`);
                }
            }

            // 6. Track prediction accuracy for all ads
            try {
                predictor.trackPredictionAccuracy();

                // Also update roas_tracker accuracy from predictions table
                const verifiedPreds = db.prepare(`
                    SELECT ad_id, d6_accuracy_pct, d30_accuracy_pct
                    FROM predictions
                    WHERE is_latest = 1 AND d6_accuracy_pct IS NOT NULL
                `).all();
                for (const vp of verifiedPreds) {
                    updateRoasTrackerAccuracy(vp.ad_id, vp.d6_accuracy_pct, vp.d30_accuracy_pct);
                }
            } catch (accErr) {
                console.warn('[roas-tracker] Accuracy tracking warning:', accErr.message);
            }

            const summary = {
                snapshots: snapResult.snapshotCount,
                tracked: latestSnapshots.length,
                newAds: newCount,
                updated: updatedCount,
                predicted: predictedCount,
            };
            console.log(`[roas-tracker] Done.`, JSON.stringify(summary));
            return summary;
        } catch (err) {
            console.error('[roas-tracker] Error:', err);
            throw err;
        }
    }

    function startRoasTrackerScheduler(intervalHours = 4) {
        if (roasTrackerInterval) clearInterval(roasTrackerInterval);

        const intervalMs = intervalHours * 3600000;
        console.log(`[roas-tracker] Scheduler starting (every ${intervalHours}h)`);

        // Run after delay on startup (3 minutes — let cache pre-warm + browser load first)
        setTimeout(() => {
            snapshotAndTrackLiveAds().catch(err =>
                console.error('[roas-tracker] Initial run failed:', err.message)
            );
        }, 180000);

        // Then run every intervalHours
        roasTrackerInterval = setInterval(() => {
            snapshotAndTrackLiveAds().catch(err =>
                console.error('[roas-tracker] Scheduled run failed:', err.message)
            );
        }, intervalMs);
    }

    function stopRoasTrackerScheduler() {
        if (roasTrackerInterval) {
            clearInterval(roasTrackerInterval);
            roasTrackerInterval = null;
            console.log('[roas-tracker] Scheduler stopped');
        }
    }

    // =========================================================================
    // Public API
    // =========================================================================
    return {
        collectSnapshots,
        computeTrends,
        generateActions,
        runGptAnalysis,
        runFullPipeline,
        getSchedulerStatus,
        startScheduler,
        stopScheduler,
        getWinnerLoserPatterns,
        buildCohortBenchmarks: predictor.buildCohortBenchmarks,
        detectAndPredictNewAds: predictor.detectAndPredictNewAds,
        trackPredictionAccuracy: predictor.trackPredictionAccuracy,
        // ROAS Tracker
        snapshotAndTrackLiveAds,
        startRoasTrackerScheduler,
        stopRoasTrackerScheduler,
    };
};
