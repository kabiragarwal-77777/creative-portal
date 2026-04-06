const DEFAULT_META_API_BASE = 'https://graph.facebook.com/v21.0';
const DEFAULT_META_FIELDS = 'campaign_name,campaign_id,adset_name,adset_id,ad_name,ad_id,spend,impressions,clicks,cpm,ctr,cpc,actions,cost_per_action_type,video_thruplay_watched_actions,video_p25_watched_actions,video_p100_watched_actions';

function ensureFetch(fetchImpl) {
    if (fetchImpl) return fetchImpl;
    if (typeof fetch === 'function') return fetch;
    throw new Error('A fetch implementation is required.');
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
    const date = String(dateStr || '').substring(0, 10);
    return [
        date,
        normalizeCampaignName(campaignName),
        normalizeAdsetName(adsetName),
        normalizeTrackerName(trackerName),
    ].join('|||');
}

function emptyRaw() {
    return {
        spend: 0,
        impressions: 0,
        clicks: 0,
        installs: 0,
        thruplay: 0,
        p25: 0,
        p100: 0,
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
        d180_overall_con: 0,
        d180_overall_revenue: 0,
        p0_signup: 0,
        p1_signup: 0,
        total_trial: 0,
        new_converted_user: 0,
        new_user_rev: 0,
    };
}

function sumRaw(items) {
    const total = emptyRaw();
    for (const item of items || []) {
        for (const key of Object.keys(total)) {
            total[key] += Number(item && item[key] ? item[key] : 0);
        }
    }
    return total;
}

function validRoas(spend, revenue) {
    const sp = Number(spend) || 0;
    const rev = Number(revenue) || 0;
    if (sp <= 0 || rev < 0) return null;
    if (rev / sp > 50) return null;
    return (rev / sp) * 100;
}

function deriveMetrics(raw) {
    const record = raw || emptyRaw();
    const p0p1 = (record.p0_signup || 0) + (record.p1_signup || 0);
    const d6Revenue = record.d6_overall_revenue || 0;
    return {
        ...record,
        cpm: record.impressions > 0 ? (record.spend / record.impressions) * 1000 : null,
        ctr: record.impressions > 0 ? (record.clicks / record.impressions) * 100 : null,
        cpi: record.installs > 0 ? record.spend / record.installs : null,
        hook: record.impressions > 0 ? (record.p25 / record.impressions) * 100 : null,
        hold: record.p25 > 0 ? (record.thruplay / record.p25) * 100 : null,
        fullPlay: record.impressions > 0 ? (record.p100 / record.impressions) * 100 : null,
        signupCost: record.signups > 0 ? record.spend / record.signups : null,
        signupPct: record.installs > 0 ? (record.signups / record.installs) * 100 : null,
        p0p1,
        p0p1Cost: p0p1 > 0 ? record.spend / p0p1 : null,
        p0p1Pct: record.signups > 0 ? (p0p1 / record.signups) * 100 : null,
        d0TrialCost: record.d0_trial > 0 ? record.spend / record.d0_trial : null,
        d0CAC: record.d0 > 0 ? record.spend / record.d0 : null,
        d6Con: record.d6 || 0,
        d6CAC: (record.d6 || 0) > 0 ? record.spend / record.d6 : null,
        d6Rev: d6Revenue,
        d6ROAS: validRoas(record.spend, d6Revenue) || 0,
        d15ROAS: validRoas(record.spend, record.d15_overall_revenue) || 0,
        d30ROAS: validRoas(record.spend, record.d30_overall_revenue) || 0,
        d60ROAS: validRoas(record.spend, record.d60_overall_revenue) || 0,
        d180ROAS: validRoas(record.spend, record.d180_overall_revenue) || 0,
        overallROAS: validRoas(record.spend, record.overall_revenue) || 0,
    };
}

function detectType(adName) {
    const name = String(adName || '').toLowerCase();
    if (name.includes('video')) return 'Video';
    if (name.includes('static')) return 'Static';
    if (name.includes('carousel')) return 'Carousel';
    if (name.includes('image')) return 'Image';
    return 'Unknown';
}

function round2(value) {
    if (value == null || Number.isNaN(Number(value))) return 0;
    return Math.round(Number(value) * 100) / 100;
}

function parseGoLiveDateFromAdName(adName) {
    const match = String(adName || '').match(/(\d{6})$/);
    if (!match) return null;
    const dd = match[1].slice(0, 2);
    const mm = match[1].slice(2, 4);
    const yy = match[1].slice(4, 6);
    return `20${yy}-${mm}-${dd}`;
}

function daysSince(dateStr, now) {
    if (!dateStr) return 0;
    const dt = new Date(String(dateStr).substring(0, 10) + 'T00:00:00');
    if (Number.isNaN(dt.getTime())) return 0;
    return Math.max(0, Math.round((now.getTime() - dt.getTime()) / 86400000));
}

function appSecretPaginationUrl(nextUrl, appSecretProof) {
    if (!nextUrl || !appSecretProof) return nextUrl;
    const separator = nextUrl.includes('?') ? '&' : '?';
    return nextUrl + separator + 'appsecret_proof=' + encodeURIComponent(appSecretProof);
}

async function fetchJson(fetchImpl, url, init) {
    const response = await fetchImpl(url, init);
    const text = await response.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : {};
    } catch (err) {
        throw new Error(text || `Request failed: ${response.status}`);
    }
    if (!response.ok) {
        const message = body && body.error ? body.error.message || body.error : JSON.stringify(body);
        throw new Error(message || `Request failed: ${response.status}`);
    }
    return body;
}

async function fetchMetaDailyDirect(config, dateFrom, dateTo) {
    const fetchImpl = ensureFetch(config.fetchImpl);
    const metaApiBase = config.metaApiBase || DEFAULT_META_API_BASE;
    const adAccountId = config.metaAdAccountId;
    const accessToken = config.metaAccessToken;
    const appSecretProof = config.metaAppSecretProof || '';

    if (!adAccountId || !accessToken) {
        throw new Error('metaAdAccountId and metaAccessToken are required for direct Meta fetches.');
    }

    let nextUrl = `${metaApiBase}/${adAccountId}/insights?${new URLSearchParams({
        access_token: accessToken,
        appsecret_proof: appSecretProof,
        fields: DEFAULT_META_FIELDS,
        level: 'ad',
        time_increment: '1',
        time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
        limit: '500',
    }).toString()}`;

    const allRows = [];
    while (nextUrl) {
        const data = await fetchJson(fetchImpl, nextUrl);
        if (Array.isArray(data.data)) allRows.push(...data.data);
        nextUrl = data.paging && data.paging.next ? appSecretPaginationUrl(data.paging.next, appSecretProof) : null;
    }

    return allRows.map(row => {
        const actions = row.actions || [];
        const costPerAction = row.cost_per_action_type || [];
        const installs = actions.find(action => action.action_type === 'mobile_app_install');
        const cpiObj = costPerAction.find(action => action.action_type === 'mobile_app_install');
        const thruplay = row.video_thruplay_watched_actions ? parseInt((row.video_thruplay_watched_actions[0] || {}).value || 0, 10) : 0;
        const p25 = row.video_p25_watched_actions ? parseInt((row.video_p25_watched_actions[0] || {}).value || 0, 10) : 0;
        const p100 = row.video_p100_watched_actions ? parseInt((row.video_p100_watched_actions[0] || {}).value || 0, 10) : 0;
        return {
            date_start: row.date_start,
            campaign_name: row.campaign_name,
            campaign_id: row.campaign_id,
            adset_name: row.adset_name,
            adset_id: row.adset_id,
            ad_name: row.ad_name,
            ad_id: row.ad_id,
            spend: parseFloat(row.spend || 0),
            impressions: parseInt(row.impressions || 0, 10),
            clicks: parseInt(row.clicks || 0, 10),
            cpm: parseFloat(row.cpm || 0),
            ctr: parseFloat(row.ctr || 0),
            cpc: parseFloat(row.cpc || 0),
            installs: installs ? parseInt(installs.value || 0, 10) : 0,
            cpi: cpiObj ? parseFloat(cpiObj.value || 0) : null,
            thruplay,
            p25,
            p100,
        };
    });
}

async function fetchAdsStatusDirect(config) {
    const fetchImpl = ensureFetch(config.fetchImpl);
    const metaApiBase = config.metaApiBase || DEFAULT_META_API_BASE;
    const adAccountId = config.metaAdAccountId;
    const accessToken = config.metaAccessToken;
    const appSecretProof = config.metaAppSecretProof || '';

    if (!adAccountId || !accessToken) {
        return [];
    }

    let nextUrl = `${metaApiBase}/${adAccountId}/ads?${new URLSearchParams({
        access_token: accessToken,
        appsecret_proof: appSecretProof,
        fields: 'id,name,status,effective_status,campaign_id,campaign{name},created_time',
        limit: '500',
    }).toString()}`;

    const ads = [];
    while (nextUrl) {
        const data = await fetchJson(fetchImpl, nextUrl);
        if (Array.isArray(data.data)) ads.push(...data.data);
        nextUrl = data.paging && data.paging.next ? appSecretPaginationUrl(data.paging.next, appSecretProof) : null;
    }

    return ads.map(ad => ({
        ad_id: ad.id,
        ad_name: ad.name,
        status: ad.effective_status || ad.status,
        campaign_id: ad.campaign_id || (ad.campaign && ad.campaign.id) || null,
        campaign_name: (ad.campaign && ad.campaign.name) || ad.campaign_name || '',
        created_time: ad.created_time || null,
    }));
}

function buildMetabaseAdFunnelSql(dateFrom, dateTo) {
    return `
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
}

async function fetchMetabaseAdFunnelDirect(config, dateFrom, dateTo) {
    const fetchImpl = ensureFetch(config.fetchImpl);
    const metabaseUrl = config.metabaseUrl;
    const metabaseSessionToken = config.metabaseSessionToken;
    if (!metabaseUrl || !metabaseSessionToken) {
        throw new Error('metabaseUrl and metabaseSessionToken are required for direct Metabase fetches.');
    }

    const response = await fetchImpl(`${metabaseUrl}/api/dataset`, {
        method: 'POST',
        headers: {
            'X-Metabase-Session': metabaseSessionToken,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            database: Number(config.metabaseDatabaseId || 2),
            type: 'native',
            native: { query: buildMetabaseAdFunnelSql(dateFrom, dateTo) },
            constraints: { 'max-results': 100000, 'max-results-bare-rows': 100000 },
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Metabase request failed: ${response.status}`);
    }

    const result = await response.json();
    const columns = (((result || {}).data || {}).cols || []).map(col => col.name);
    return ((((result || {}).data || {}).rows) || []).map(row => {
        const obj = {};
        columns.forEach((column, index) => { obj[column] = row[index]; });
        return obj;
    });
}

function createEndpointFetchers(options) {
    const fetchImpl = ensureFetch(options.fetchImpl);
    const baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
    if (!baseUrl) throw new Error('baseUrl is required for endpoint fetchers.');

    async function routeJson(path, init) {
        const response = await fetchImpl(baseUrl + path, init);
        const body = await response.json();
        if (!response.ok || !body.success) {
            throw new Error(body.error || `Request failed: ${response.status}`);
        }
        return body.data || [];
    }

    return {
        async fetchMetaDaily(input) {
            return routeJson('/api/meta/ad-insights-daily', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom: input.dateFrom, dateTo: input.dateTo }),
            });
        },
        async fetchMetabaseFunnel(input) {
            return routeJson('/api/metabase/ad-funnel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom: input.dateFrom, dateTo: input.dateTo }),
            });
        },
        async fetchAdsStatus() {
            return routeJson('/api/meta/ads-status', { method: 'GET' });
        },
    };
}

function createDirectFetchers(config) {
    return {
        fetchMetaDaily(input) {
            return fetchMetaDailyDirect(config, input.dateFrom, input.dateTo);
        },
        fetchMetabaseFunnel(input) {
            return fetchMetabaseAdFunnelDirect(config, input.dateFrom, input.dateTo);
        },
        fetchAdsStatus() {
            return fetchAdsStatusDirect(config);
        },
    };
}

function resolveFetchers(options) {
    if (options.fetchers) return options.fetchers;
    if (options.baseUrl) return createEndpointFetchers(options);
    if (options.metaAdAccountId && options.metaAccessToken && options.metabaseUrl && options.metabaseSessionToken) {
        return createDirectFetchers(options);
    }
    throw new Error('Pass either fetchers, baseUrl, or direct Meta/Metabase credentials.');
}

function matchMetaAndMetabaseData(input) {
    const metaRows = input.metaRows || [];
    const funnelRows = input.funnelRows || [];
    const adsStatus = input.adsStatus || [];
    const testCampaigns = new Set(input.testCampaigns || []);
    const now = input.now instanceof Date ? input.now : new Date();

    const mbDaily = {};
    for (const row of funnelRows) {
        const key = buildJoinKey(row.date, row.campaign_name, row.ad_set_name, row.tracker_name);
        if (!mbDaily[key]) {
            mbDaily[key] = emptyRaw();
        }
        const bucket = mbDaily[key];
        bucket.signups += Number(row.signups) || 0;
        bucket.d0_trial += Number(row.d0_trial) || 0;
        bucket.d0 += Number(row.d0) || 0;
        bucket.d0_revenue += Number(row.d0_revenue) || 0;
        bucket.d6 += Number(row.d6) || 0;
        bucket.d6_revenue += Number(row.d6_revenue) || 0;
        bucket.overall_revenue += Number(row.overall_revenue) || 0;
        bucket.p0_signup += Number(row.p0_signup) || 0;
        bucket.p1_signup += Number(row.p1_signup) || 0;
        bucket.total_trial += Number(row.total_trial) || 0;
        bucket.d6_overall_con += Number(row.d6_overall_con) || 0;
        bucket.d6_overall_revenue += Number(row.d6_overall_revenue) || 0;
        bucket.d15_overall_con += Number(row.d15_overall_con) || 0;
        bucket.d15_overall_revenue += Number(row.d15_overall_revenue) || 0;
        bucket.d30_overall_con += Number(row.d30_overall_con) || 0;
        bucket.d30_overall_revenue += Number(row.d30_overall_revenue) || 0;
        bucket.d60_overall_con += Number(row.d60_overall_con) || 0;
        bucket.d60_overall_revenue += Number(row.d60_overall_revenue) || 0;
        bucket.d180_overall_con += Number(row.d180_overall_con) || 0;
        bucket.d180_overall_revenue += Number(row.d180_overall_revenue) || 0;
        bucket.new_converted_user += Number(row.new_converted_user) || 0;
        bucket.new_user_rev += Number(row.new_user_rev) || 0;
    }

    const adAgg = {};
    let matchedKeys = 0;
    let unmatchedKeys = 0;

    for (const row of metaRows) {
        const adKey = `${row.campaign_name || ''}|||${row.adset_name || ''}|||${row.ad_name || ''}`;
        if (!adAgg[adKey]) {
            adAgg[adKey] = {
                ad_name: row.ad_name,
                ad_id: row.ad_id,
                campaign_name: row.campaign_name,
                campaign_id: row.campaign_id,
                adset_name: row.adset_name,
                adset_id: row.adset_id,
                ...emptyRaw(),
                dates: [],
                _matched: false,
            };
        }

        const bucket = adAgg[adKey];
        bucket.spend += (Number(row.spend) || 0) * 1.18;
        bucket.impressions += Number(row.impressions) || 0;
        bucket.clicks += Number(row.clicks) || 0;
        bucket.installs += Number(row.installs) || 0;
        bucket.thruplay += Number(row.thruplay) || 0;
        bucket.p25 += Number(row.p25) || 0;
        bucket.p100 += Number(row.p100) || 0;
        if ((Number(row.spend) || 0) > 0 && row.date_start) bucket.dates.push(row.date_start);

        const dailyKey = buildJoinKey(row.date_start, row.campaign_name, row.adset_name, row.ad_name);
        const funnel = mbDaily[dailyKey];
        if (funnel) {
            matchedKeys++;
            bucket._matched = true;
            bucket.signups += funnel.signups;
            bucket.d0_trial += funnel.d0_trial;
            bucket.d0 += funnel.d0;
            bucket.d0_revenue += funnel.d0_revenue;
            bucket.d6 += funnel.d6;
            bucket.d6_revenue += funnel.d6_revenue;
            bucket.overall_revenue += funnel.overall_revenue;
            bucket.d6_overall_con += funnel.d6_overall_con;
            bucket.d6_overall_revenue += funnel.d6_overall_revenue;
            bucket.d15_overall_con += funnel.d15_overall_con;
            bucket.d15_overall_revenue += funnel.d15_overall_revenue;
            bucket.d30_overall_con += funnel.d30_overall_con;
            bucket.d30_overall_revenue += funnel.d30_overall_revenue;
            bucket.d60_overall_con += funnel.d60_overall_con;
            bucket.d60_overall_revenue += funnel.d60_overall_revenue;
            bucket.d180_overall_con += funnel.d180_overall_con;
            bucket.d180_overall_revenue += funnel.d180_overall_revenue;
            bucket.p0_signup += funnel.p0_signup;
            bucket.p1_signup += funnel.p1_signup;
            bucket.total_trial += funnel.total_trial;
            bucket.new_converted_user += funnel.new_converted_user;
            bucket.new_user_rev += funnel.new_user_rev;
        } else {
            unmatchedKeys++;
        }
    }

    if (adsStatus.length > 0) {
        const existingAdIds = new Set(Object.values(adAgg).map(row => row.ad_id));
        adsStatus.forEach(ad => {
            if ((ad.status || '').toUpperCase() !== 'ACTIVE') return;
            if (existingAdIds.has(ad.ad_id)) return;
            const adKey = `${ad.campaign_name || ''}|||${ad.adset_name || ''}|||${ad.ad_name || ''}`;
            adAgg[adKey] = {
                ad_name: ad.ad_name,
                ad_id: ad.ad_id,
                campaign_name: ad.campaign_name,
                campaign_id: ad.campaign_id,
                adset_name: '',
                adset_id: '',
                ...emptyRaw(),
                dates: [],
                _matched: false,
            };
        });
    }

    const adStatusMap = {};
    adsStatus.forEach(ad => { adStatusMap[ad.ad_id] = ad; });

    const ads = Object.values(adAgg).map((raw, index) => {
        const derived = deriveMetrics(raw);
        const statusInfo = adStatusMap[raw.ad_id];
        const hasStatusData = adsStatus.length > 0;
        const goLiveDate = parseGoLiveDateFromAdName(raw.ad_name) ||
            (statusInfo && statusInfo.created_time ? String(statusInfo.created_time).substring(0, 10) : '') ||
            (raw.dates.length ? raw.dates.sort()[0] : '');
        const daysLive = daysSince(goLiveDate, now);
        const isMatured = daysLive >= 14;

        let testPerf = '';
        if (!isMatured) testPerf = 'Try';
        else if (raw.spend >= 20000 && derived.d6ROAS < 5) testPerf = 'Drop';
        else if (raw.spend >= 15000 && derived.d6ROAS < 15) testPerf = 'Failed';
        else if (raw.spend < 15000) testPerf = 'Try';
        else if (raw.spend >= 15000 && derived.d6ROAS > 40) testPerf = 'Exceptional';
        else if (raw.spend >= 15000 && derived.d6ROAS > 28) testPerf = 'Performed';

        return {
            sno: index + 1,
            name: raw.ad_name,
            type: detectType(raw.ad_name),
            date: goLiveDate || '',
            live: hasStatusData ? ((statusInfo && statusInfo.status === 'ACTIVE') ? 'Live' : 'Paused') : (raw.spend > 0 ? 'Live' : 'Paused'),
            testPerf,
            nextSteps: '',
            daysLive,
            isMatured,
            goLiveDateISO: goLiveDate || null,
            spent: round2(raw.spend),
            impressions: raw.impressions,
            clicks: raw.clicks,
            installs: raw.installs,
            signups: raw.signups,
            d0Trials: raw.d0_trial,
            d0: raw.d0,
            d6: derived.d6Con,
            thruPlays: raw.thruplay,
            threeSecViews: raw.p25,
            p0p1: derived.p0p1,
            d6OverallRevenue: round2(derived.d6Rev),
            d15OverallRevenue: round2(raw.d15_overall_revenue || 0),
            d30OverallRevenue: round2(raw.d30_overall_revenue || 0),
            d60OverallRevenue: round2(raw.d60_overall_revenue || 0),
            d180OverallRevenue: round2(raw.d180_overall_revenue || 0),
            overallRevenue: round2(raw.overall_revenue || 0),
            cpm: round2(derived.cpm),
            ctr: round2(derived.ctr),
            cpi: round2(derived.cpi),
            signupCost: round2(derived.signupCost),
            signupPct: round2(derived.signupPct),
            p0p1Pct: round2(derived.p0p1Pct),
            p0p1Cost: round2(derived.p0p1Cost),
            d0TrialCost: round2(derived.d0TrialCost),
            d0CAC: round2(derived.d0CAC),
            d6CAC: round2(derived.d6CAC),
            d6ROAS: round2(derived.d6ROAS),
            d15ROAS: round2(derived.d15ROAS),
            d30ROAS: round2(derived.d30ROAS),
            d60ROAS: round2(derived.d60ROAS),
            d180ROAS: round2(derived.d180ROAS),
            overallROAS: round2(derived.overallROAS),
            hook: round2(derived.hook),
            hold: round2(derived.hold),
            fullPlay: round2(derived.fullPlay),
            campaign_name: raw.campaign_name,
            adset_name: raw.adset_name,
            ad_id: raw.ad_id,
            _isTestCampaign: testCampaigns.has(raw.campaign_name),
            _source: 'api',
            _raw: raw,
        };
    }).filter(ad => ad.name && ad.name.includes('FB_'));

    return {
        ads,
        metaRows,
        funnelRows,
        adsStatus,
        mbDaily,
        diagnostics: {
            source: 'Meta + Metabase',
            matchedKeys,
            unmatchedKeys,
        },
    };
}

async function fetchAndMatchMetaMetabase(options) {
    const dateFrom = options.dateFrom;
    const dateTo = options.dateTo;
    if (!dateFrom || !dateTo) {
        throw new Error('dateFrom and dateTo are required.');
    }

    const fetchers = resolveFetchers(options);
    const metaRows = await fetchers.fetchMetaDaily({ dateFrom, dateTo });
    const funnelRows = await fetchers.fetchMetabaseFunnel({ dateFrom, dateTo });
    const adsStatus = fetchers.fetchAdsStatus ? await fetchers.fetchAdsStatus({ dateFrom, dateTo }) : [];

    return matchMetaAndMetabaseData({
        metaRows,
        funnelRows,
        adsStatus,
        testCampaigns: options.testCampaigns || [],
        now: options.now || new Date(),
    });
}

module.exports = {
    emptyRaw,
    sumRaw,
    deriveMetrics,
    validRoas,
    buildJoinKey,
    normalizeCampaignName,
    normalizeAdsetName,
    normalizeTrackerName,
    parseGoLiveDateFromAdName,
    createEndpointFetchers,
    createDirectFetchers,
    buildMetabaseAdFunnelSql,
    fetchMetaDailyDirect,
    fetchMetabaseAdFunnelDirect,
    fetchAdsStatusDirect,
    matchMetaAndMetabaseData,
    fetchAndMatchMetaMetabase,
};
