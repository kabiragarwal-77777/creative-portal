/**
 * atGoogleScanner.js
 * Google Ads Audience Scanner — reads from existing cache files produced by the
 * main Google Creative portal (google-creative/insights-cache-*.json and
 * gc-funnel-cache-*.json) and aggregates data into the audience-testing DB.
 *
 * Falls back to direct Google Ads API calls if no recent cache files exist.
 */

const { getAtDb } = require('../db/at-db');
const path = require('path');
const fs = require('fs');

const CACHE_DIR = path.join(__dirname, '..', '..', 'google-creative');
const CACHE_MAX_AGE_MS = 48 * 3600_000; // 48 hours — treat caches older than this as stale

module.exports = function (config) {
    // Google Ads API credentials (used only in API fallback path)
    const GA_CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || '';
    const GA_CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || '';
    const GA_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
    const GA_CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID || '';
    const GA_LOGIN_CUSTOMER_ID = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '';
    const GA_REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN || '';

    // -----------------------------------------------------------------------
    // Logging
    // -----------------------------------------------------------------------
    function log(...args) { console.log('[AT Google Scanner]', ...args); }
    function logErr(...args) { console.error('[AT Google Scanner]', ...args); }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function hasGoogleAdsCreds() {
        return !!(GA_CLIENT_ID && GA_CLIENT_SECRET && GA_DEVELOPER_TOKEN &&
            GA_CUSTOMER_ID && GA_REFRESH_TOKEN);
    }

    /**
     * Infer business vertical from campaign/adgroup name.
     */
    function inferVertical(name) {
        if (!name) return 'Unknown';
        const n = name.toLowerCase();
        if (n.includes('stock') || n.includes('equity') || n.includes('trade') || n.includes('market')) return 'Stocks';
        if (n.includes('mf') || n.includes('mutual fund') || n.includes('sip')) return 'Mutual Funds';
        if (n.includes('ipl') || n.includes('cricket') || n.includes('fantasy')) return 'Fantasy';
        if (n.includes('gold') || n.includes('digi gold') || n.includes('digital gold')) return 'Gold';
        if (n.includes('fd') || n.includes('fixed deposit')) return 'FD';
        if (n.includes('insurance') || n.includes('life') || n.includes('term')) return 'Insurance';
        if (n.includes('loan') || n.includes('credit') || n.includes('emi')) return 'Loans';
        if (n.includes('brand') || n.includes('awareness') || n.includes('branding')) return 'Brand';
        if (n.includes('retarget') || n.includes('remarketing') || n.includes('remarket')) return 'Retargeting';
        if (n.includes('app') || n.includes('install') || n.includes('uac')) return 'App Install';
        return 'Unknown';
    }

    function mapStatus(status) {
        if (typeof status === 'string') return status;
        const statusMap = { 0: 'UNSPECIFIED', 1: 'UNKNOWN', 2: 'ENABLED', 3: 'PAUSED', 4: 'REMOVED' };
        return statusMap[status] || 'UNKNOWN';
    }

    function micros(val) {
        return (val || 0) / 1_000_000;
    }

    // -----------------------------------------------------------------------
    // Cache file discovery
    // -----------------------------------------------------------------------

    /**
     * Find the most recent cache file matching a prefix pattern.
     * Returns { filePath, data } or null.
     */
    function findBestCache(prefix) {
        if (!fs.existsSync(CACHE_DIR)) return null;

        const files = fs.readdirSync(CACHE_DIR)
            .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
            .map(f => {
                const full = path.join(CACHE_DIR, f);
                try {
                    const stat = fs.statSync(full);
                    return { file: f, path: full, mtime: stat.mtimeMs };
                } catch { return null; }
            })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime); // newest first

        for (const entry of files) {
            // Skip caches older than threshold
            if (Date.now() - entry.mtime > CACHE_MAX_AGE_MS) continue;

            try {
                const raw = JSON.parse(fs.readFileSync(entry.path, 'utf-8'));
                const data = raw.data || raw;
                if (Array.isArray(data) && data.length > 0) {
                    log(`Using cache: ${entry.file} (${data.length} rows, age ${Math.round((Date.now() - entry.mtime) / 3600_000)}h)`);
                    return { filePath: entry.path, data };
                }
            } catch (err) {
                logErr(`Failed to parse ${entry.file}: ${err.message}`);
            }
        }
        return null;
    }

    // -----------------------------------------------------------------------
    // Cache-based data ingestion
    // -----------------------------------------------------------------------

    /**
     * Read insights-cache-*.json files (produced by /api/google/insights endpoint).
     * These contain per-date, per-campaign, per-adgroup rows with spend/clicks/etc.
     * We aggregate across dates to get totals per campaign and per adgroup.
     *
     * Cache row shape:
     *   { date_start, campaign_name, campaign_id, campaign_type,
     *     adset_name, adset_id, spend, impressions, clicks, conversions, conversion_value }
     */
    async function ingestInsightsCache(rows) {
        const db = await getAtDb();

        // ---------- aggregate by campaign ----------
        const campaignMap = new Map();
        for (const r of rows) {
            const cid = r.campaign_id;
            if (!cid) continue;
            let c = campaignMap.get(cid);
            if (!c) {
                c = {
                    id: cid,
                    name: r.campaign_name || '',
                    channelType: typeof r.campaign_type === 'number' ? String(r.campaign_type) : (r.campaign_type || ''),
                    spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
                };
                campaignMap.set(cid, c);
            }
            c.spend += r.spend || 0;
            c.impressions += r.impressions || 0;
            c.clicks += r.clicks || 0;
            c.conversions += r.conversions || 0;
            c.conversionValue += r.conversion_value || 0;
        }

        const upsertCampaign = await db.prepare(`
            INSERT INTO at_google_campaigns
                (google_campaign_id, name, status, channel_type, vertical, bidding_strategy,
                 total_spend, impressions, clicks, conversions, conversion_value, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(google_campaign_id) DO UPDATE SET
                name = excluded.name,
                status = excluded.status,
                channel_type = excluded.channel_type,
                vertical = excluded.vertical,
                total_spend = excluded.total_spend,
                impressions = excluded.impressions,
                clicks = excluded.clicks,
                conversions = excluded.conversions,
                conversion_value = excluded.conversion_value,
                synced_at = CURRENT_TIMESTAMP
        `);

        const insertCampaigns = db.transaction(async () => {
            for (const c of campaignMap.values()) {
                const vertical = inferVertical(c.name);
                // Caches come from ENABLED campaigns only (the API query filters campaign.status = 'ENABLED')
                await upsertCampaign.run(c.id, c.name, 'ENABLED', c.channelType, vertical, '',
                    c.spend, c.impressions, c.clicks, c.conversions, c.conversionValue);
            }
        });
        await insertCampaigns();
        log(`Stored ${campaignMap.size} campaigns from insights cache`);

        // ---------- aggregate by adgroup ----------
        const adgroupMap = new Map();
        for (const r of rows) {
            const agId = r.adset_id;
            if (!agId) continue;
            let ag = adgroupMap.get(agId);
            if (!ag) {
                ag = {
                    id: agId,
                    campaignId: r.campaign_id || '',
                    name: r.adset_name || '',
                    spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0,
                };
                adgroupMap.set(agId, ag);
            }
            ag.spend += r.spend || 0;
            ag.impressions += r.impressions || 0;
            ag.clicks += r.clicks || 0;
            ag.conversions += r.conversions || 0;
            ag.conversionValue += r.conversion_value || 0;
        }

        const upsertAdgroup = db.prepare(`
            INSERT INTO at_google_adgroups
                (google_adgroup_id, google_campaign_id, name, status, adgroup_type,
                 cpc_bid, target_cpa, total_spend, impressions, clicks, conversions,
                 conversion_value, ctr, avg_cpc, cost_per_conversion, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(google_adgroup_id) DO UPDATE SET
                google_campaign_id = excluded.google_campaign_id,
                name = excluded.name,
                status = excluded.status,
                total_spend = excluded.total_spend,
                impressions = excluded.impressions,
                clicks = excluded.clicks,
                conversions = excluded.conversions,
                conversion_value = excluded.conversion_value,
                ctr = excluded.ctr,
                avg_cpc = excluded.avg_cpc,
                cost_per_conversion = excluded.cost_per_conversion,
                synced_at = CURRENT_TIMESTAMP
        `);

        const insertAdgroups = db.transaction(async () => {
            for (const ag of adgroupMap.values()) {
                const ctr = ag.impressions > 0 ? ag.clicks / ag.impressions : 0;
                const avgCpc = ag.clicks > 0 ? ag.spend / ag.clicks : 0;
                const costPerConv = ag.conversions > 0 ? ag.spend / ag.conversions : 0;
                await upsertAdgroup.run(ag.id, ag.campaignId, ag.name, 'ENABLED', '',
                    0, 0, ag.spend, ag.impressions, ag.clicks, ag.conversions,
                    ag.conversionValue, ctr, avgCpc, costPerConv);
            }
        });
        await insertAdgroups();
        log(`Stored ${adgroupMap.size} adgroups from insights cache`);

        return { campaigns: campaignMap.size, adgroups: adgroupMap.size };
    }

    /**
     * Read gc-funnel-cache-*.json files (produced by /api/google/ad-funnel endpoint).
     * These contain Metabase funnel metrics (signups, d6 conversions, d6 revenue, etc.)
     * keyed by campaign_name + ad_set_name. We match them to adgroups already in the DB.
     *
     * Cache row shape:
     *   { date, campaign_name, ad_set_name, tracker_name,
     *     signups, p0_signup, p1_signup, total_trial, d0_trial, d0, d0_revenue,
     *     d6, d6_revenue, new_converted_user, new_user_rev, overall_revenue,
     *     d6_overall_con, d6_overall_revenue, d15_overall_con, d15_overall_revenue,
     *     d30_overall_con, d30_overall_revenue, d60_overall_con, d60_overall_revenue }
     */
    async function ingestFunnelCache(rows) {
        const db = await getAtDb();

        // Aggregate funnel data by (campaign_name, ad_set_name)
        // Funnel rows are per-week, so we sum them up
        const funnelMap = new Map();
        for (const r of rows) {
            const key = `${(r.campaign_name || '').toLowerCase()}||${(r.ad_set_name || '').toLowerCase()}`;
            let f = funnelMap.get(key);
            if (!f) {
                f = {
                    campaign_name: r.campaign_name || '',
                    ad_set_name: r.ad_set_name || '',
                    signups: 0, d6_conversions: 0, d6_revenue: 0,
                };
                funnelMap.set(key, f);
            }
            f.signups += r.signups || 0;
            f.d6_conversions += r.d6_overall_con || 0;
            f.d6_revenue += r.d6_overall_revenue || 0;
        }

        // Build a lookup from lowercase adgroup name -> google_adgroup_id
        // The insights cache stores adset_name which maps to ad_group.name
        const allAdgroups = await db.prepare(`SELECT google_adgroup_id, name, total_spend FROM at_google_adgroups`).all();
        const agByName = new Map();
        for (const ag of allAdgroups) {
            if (ag.name) agByName.set(ag.name.toLowerCase(), ag);
        }

        const updateFunnel = await db.prepare(`
            UPDATE at_google_adgroups
            SET metabase_signups = ?,
                d6_conversions = ?,
                d6_revenue = ?,
                d6_cac = ?,
                d6_roas = ?,
                synced_at = CURRENT_TIMESTAMP
            WHERE google_adgroup_id = ?
        `);

        let matched = 0;
        const applyFunnel = db.transaction(async () => {
            for (const f of funnelMap.values()) {
                const ag = agByName.get(f.ad_set_name.toLowerCase());
                if (!ag) continue;
                const d6Cac = f.d6_conversions > 0 && ag.total_spend > 0
                    ? ag.total_spend / f.d6_conversions : null;
                const d6Roas = ag.total_spend > 0 && f.d6_revenue > 0
                    ? f.d6_revenue / ag.total_spend : null;
                await updateFunnel.run(f.signups, f.d6_conversions, f.d6_revenue, d6Cac, d6Roas, ag.google_adgroup_id);
                matched++;
            }
        });
        await applyFunnel();
        log(`Enriched ${matched}/${funnelMap.size} adgroups with funnel data`);

        return { funnelRows: funnelMap.size, matched };
    }

    // -----------------------------------------------------------------------
    // API-based data fetchers (fallback when no cache exists)
    // -----------------------------------------------------------------------

    function getCustomer() {
        const { GoogleAdsApi } = require('google-ads-api');
        const client = new GoogleAdsApi({
            client_id: GA_CLIENT_ID,
            client_secret: GA_CLIENT_SECRET,
            developer_token: GA_DEVELOPER_TOKEN,
        });
        return client.Customer({
            customer_id: GA_CUSTOMER_ID,
            login_customer_id: GA_LOGIN_CUSTOMER_ID || GA_CUSTOMER_ID,
            refresh_token: GA_REFRESH_TOKEN,
        });
    }

    async function fetchCampaignsFromAPI() {
        log('Fetching campaigns from Google Ads API...');
        const customer = getCustomer();

        const rows = await customer.query(`
            SELECT
                campaign.id,
                campaign.name,
                campaign.status,
                campaign.advertising_channel_type,
                campaign.bidding_strategy_type,
                campaign.start_date,
                campaign.end_date,
                metrics.cost_micros,
                metrics.impressions,
                metrics.clicks,
                metrics.conversions,
                metrics.all_conversions_value
            FROM campaign
            WHERE segments.date DURING LAST_365_DAYS
                AND campaign.status IN ('ENABLED', 'PAUSED')
        `);

        log(`Fetched ${rows.length} campaigns from Google Ads`);
        const db = await getAtDb();

        const upsert = db.prepare(`
            INSERT INTO at_google_campaigns
                (google_campaign_id, name, status, channel_type, vertical, bidding_strategy,
                 total_spend, impressions, clicks, conversions, conversion_value, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(google_campaign_id) DO UPDATE SET
                name = excluded.name,
                status = excluded.status,
                channel_type = excluded.channel_type,
                vertical = excluded.vertical,
                bidding_strategy = excluded.bidding_strategy,
                total_spend = excluded.total_spend,
                impressions = excluded.impressions,
                clicks = excluded.clicks,
                conversions = excluded.conversions,
                conversion_value = excluded.conversion_value,
                synced_at = CURRENT_TIMESTAMP
        `);

        const insertMany = db.transaction(async (items) => {
            for (const r of items) {
                const cid = String(r.campaign.id);
                const name = r.campaign.name || '';
                const status = mapStatus(r.campaign.status);
                const channelType = typeof r.campaign.advertising_channel_type === 'number'
                    ? String(r.campaign.advertising_channel_type)
                    : (r.campaign.advertising_channel_type || '');
                const biddingStrategy = typeof r.campaign.bidding_strategy_type === 'number'
                    ? String(r.campaign.bidding_strategy_type)
                    : (r.campaign.bidding_strategy_type || '');
                const spend = micros(r.metrics.cost_micros);
                const impressions = r.metrics.impressions || 0;
                const clicks = r.metrics.clicks || 0;
                const conversions = r.metrics.conversions || 0;
                const conversionValue = r.metrics.all_conversions_value || 0;
                const vertical = inferVertical(name);
                await upsert.run(cid, name, status, channelType, vertical, biddingStrategy,
                    spend, impressions, clicks, conversions, conversionValue);
            }
        });
        await insertMany(rows);
        log(`Stored ${rows.length} campaigns via API`);
        return rows.length;
    }

    async function fetchAdgroupsFromAPI() {
        log('Fetching adgroups from Google Ads API...');
        const customer = getCustomer();

        const rows = await customer.query(`
            SELECT
                ad_group.id,
                ad_group.name,
                ad_group.status,
                ad_group.type,
                ad_group.cpc_bid_micros,
                ad_group.target_cpa_micros,
                campaign.id,
                campaign.name,
                campaign.advertising_channel_type,
                metrics.cost_micros,
                metrics.impressions,
                metrics.clicks,
                metrics.conversions,
                metrics.all_conversions_value,
                metrics.ctr,
                metrics.average_cpc,
                metrics.cost_per_conversion
            FROM ad_group
            WHERE segments.date DURING LAST_365_DAYS
                AND ad_group.status IN ('ENABLED', 'PAUSED')
        `);

        log(`Fetched ${rows.length} adgroups from Google Ads`);
        const db = await getAtDb();

        const upsert = db.prepare(`
            INSERT INTO at_google_adgroups
                (google_adgroup_id, google_campaign_id, name, status, adgroup_type,
                 cpc_bid, target_cpa, total_spend, impressions, clicks, conversions,
                 conversion_value, ctr, avg_cpc, cost_per_conversion, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(google_adgroup_id) DO UPDATE SET
                google_campaign_id = excluded.google_campaign_id,
                name = excluded.name,
                status = excluded.status,
                adgroup_type = excluded.adgroup_type,
                cpc_bid = excluded.cpc_bid,
                target_cpa = excluded.target_cpa,
                total_spend = excluded.total_spend,
                impressions = excluded.impressions,
                clicks = excluded.clicks,
                conversions = excluded.conversions,
                conversion_value = excluded.conversion_value,
                ctr = excluded.ctr,
                avg_cpc = excluded.avg_cpc,
                cost_per_conversion = excluded.cost_per_conversion,
                synced_at = CURRENT_TIMESTAMP
        `);

        const insertMany = db.transaction(async (items) => {
            for (const r of items) {
                const agId = String(r.ad_group.id);
                const cId = String(r.campaign.id);
                const name = r.ad_group.name || '';
                const status = mapStatus(r.ad_group.status);
                const agType = typeof r.ad_group.type === 'number'
                    ? String(r.ad_group.type) : (r.ad_group.type || '');
                const cpcBid = micros(r.ad_group.cpc_bid_micros);
                const targetCpa = micros(r.ad_group.target_cpa_micros);
                const spend = micros(r.metrics.cost_micros);
                const impressions = r.metrics.impressions || 0;
                const clicks = r.metrics.clicks || 0;
                const conversions = r.metrics.conversions || 0;
                const conversionValue = r.metrics.all_conversions_value || 0;
                const ctr = r.metrics.ctr || 0;
                const avgCpc = micros(r.metrics.average_cpc);
                const costPerConversion = micros(r.metrics.cost_per_conversion);
                await upsert.run(agId, cId, name, status, agType, cpcBid, targetCpa,
                    spend, impressions, clicks, conversions, conversionValue,
                    ctr, avgCpc, costPerConversion);
            }
        });
        await insertMany(rows);
        log(`Stored ${rows.length} adgroups via API`);
        return rows.length;
    }

    async function fetchAudienceCriteriaFromAPI() {
        log('Fetching audience criteria from Google Ads API...');
        const customer = getCustomer();

        const rows = await customer.query(`
            SELECT
                ad_group.id,
                ad_group.name,
                ad_group_criterion.criterion_id,
                ad_group_criterion.type,
                ad_group_criterion.status,
                ad_group_criterion.bid_modifier,
                ad_group_criterion.user_list.user_list,
                ad_group_criterion.age_range.type,
                ad_group_criterion.gender.type,
                ad_group_criterion.user_interest.user_interest_category
            FROM ad_group_criterion
            WHERE ad_group_criterion.type IN ('USER_LIST', 'USER_INTEREST', 'AGE_RANGE', 'GENDER', 'DEVICE', 'PLACEMENT')
                AND ad_group.status IN ('ENABLED', 'PAUSED')
        `);

        log(`Fetched ${rows.length} audience criteria from Google Ads`);
        const db = await getAtDb();
        await db.prepare(`DELETE FROM at_google_audiences`).run();

        const insert = await db.prepare(`
            INSERT INTO at_google_audiences
                (adgroup_id, criterion_type, audience_name, audience_id, bid_modifier,
                 age_range, gender, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);

        const insertMany = db.transaction(async (items) => {
            for (const r of items) {
                const agId = String(r.ad_group.id);
                const criterion = r.ad_group_criterion || {};
                const criterionType = typeof criterion.type === 'number'
                    ? String(criterion.type) : (criterion.type || '');
                const bidModifier = criterion.bid_modifier || null;
                const criterionId = criterion.criterion_id ? String(criterion.criterion_id) : null;

                let audienceName = '';
                let ageRange = null;
                let gender = null;

                if (criterion.user_list && criterion.user_list.user_list) {
                    audienceName = criterion.user_list.user_list;
                } else if (criterion.user_interest && criterion.user_interest.user_interest_category) {
                    audienceName = criterion.user_interest.user_interest_category;
                } else if (criterion.age_range && criterion.age_range.type) {
                    const ageVal = criterion.age_range.type;
                    ageRange = typeof ageVal === 'number' ? String(ageVal) : (ageVal || '');
                    audienceName = `Age: ${ageRange}`;
                } else if (criterion.gender && criterion.gender.type) {
                    const genderVal = criterion.gender.type;
                    gender = typeof genderVal === 'number' ? String(genderVal) : (genderVal || '');
                    audienceName = `Gender: ${gender}`;
                }

                await insert.run(agId, criterionType, audienceName, criterionId,
                    bidModifier, ageRange, gender);
            }
        });
        await insertMany(rows);
        log(`Stored ${rows.length} audience criteria via API`);
        return rows.length;
    }

    async function fetchBreakdownsFromAPI() {
        log('Fetching breakdowns (device, network) from Google Ads API...');
        const customer = getCustomer();

        const rows = await customer.query(`
            SELECT
                ad_group.id,
                segments.ad_network_type,
                segments.device,
                metrics.cost_micros,
                metrics.impressions,
                metrics.clicks,
                metrics.conversions,
                metrics.ctr
            FROM ad_group
            WHERE segments.date DURING LAST_365_DAYS
                AND ad_group.status IN ('ENABLED', 'PAUSED')
        `);

        log(`Fetched ${rows.length} breakdown rows from Google Ads`);
        const db = await getAtDb();
        await db.prepare(`DELETE FROM at_google_breakdowns`).run();

        const insert = await db.prepare(`
            INSERT INTO at_google_breakdowns
                (adgroup_id, breakdown_type, breakdown_value, spend, impressions,
                 clicks, conversions, ctr, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);

        const insertMany = db.transaction(async (items) => {
            for (const r of items) {
                const agId = String(r.ad_group.id);
                const spend = micros(r.metrics.cost_micros);
                const impressions = r.metrics.impressions || 0;
                const clicks = r.metrics.clicks || 0;
                const conversions = r.metrics.conversions || 0;
                const ctr = r.metrics.ctr || 0;

                const device = r.segments.device;
                const deviceStr = typeof device === 'number' ? String(device) : (device || 'UNKNOWN');
                await insert.run(agId, 'device', deviceStr, spend, impressions, clicks, conversions, ctr);

                const network = r.segments.ad_network_type;
                const networkStr = typeof network === 'number' ? String(network) : (network || 'UNKNOWN');
                await insert.run(agId, 'network', networkStr, spend, impressions, clicks, conversions, ctr);
            }
        });
        await insertMany(rows);
        log(`Stored ${rows.length * 2} breakdown rows via API`);
        return rows.length;
    }

    // -----------------------------------------------------------------------
    // Orchestrator
    // -----------------------------------------------------------------------

    async function runFullScan() {
        log('Starting full Google Ads audience scan...');

        const result = {
            success: true,
            skipped: false,
            source: 'unknown', // 'cache' or 'api'
            campaigns: 0,
            adgroups: 0,
            audiences: 0,
            breakdowns: 0,
            funnelMatched: 0,
            errors: [],
        };

        // ---- Try cache-first path ----
        const insightsCache = findBestCache('insights-cache-');
        if (insightsCache) {
            result.source = 'cache';
            log(`Found insights cache with ${insightsCache.data.length} rows — using cache path`);

            try {
                const counts = await ingestInsightsCache(insightsCache.data);
                result.campaigns = counts.campaigns;
                result.adgroups = counts.adgroups;
            } catch (err) {
                logErr('Error ingesting insights cache:', err.message);
                result.errors.push({ step: 'insights_cache', error: err.message });
            }

            // Try funnel cache enrichment
            const funnelCache = findBestCache('gc-funnel-cache-');
            if (funnelCache) {
                try {
                    const funnelResult = await ingestFunnelCache(funnelCache.data);
                    result.funnelMatched = funnelResult.matched;
                } catch (err) {
                    logErr('Error ingesting funnel cache:', err.message);
                    result.errors.push({ step: 'funnel_cache', error: err.message });
                }
            } else {
                log('No recent funnel cache found — skipping funnel enrichment');
            }

            // Audience criteria and breakdowns are not available in the cache files.
            // These require direct API calls. We attempt them only if creds exist.
            if (hasGoogleAdsCreds()) {
                try {
                    result.audiences = await fetchAudienceCriteriaFromAPI();
                } catch (err) {
                    logErr('Error fetching audience criteria (API fallback):', err.message);
                    result.errors.push({ step: 'audiences_api', error: err.message });
                }

                try {
                    result.breakdowns = await fetchBreakdownsFromAPI();
                } catch (err) {
                    logErr('Error fetching breakdowns (API fallback):', err.message);
                    result.errors.push({ step: 'breakdowns_api', error: err.message });
                }
            } else {
                log('No Google Ads creds — skipping audience criteria & breakdowns (not in cache)');
            }

            if (result.errors.length > 0) result.success = false;
            log(`Cache scan complete: ${result.campaigns} campaigns, ${result.adgroups} adgroups, ${result.funnelMatched} funnel-enriched, ${result.audiences} audiences, ${result.breakdowns} breakdowns, ${result.errors.length} errors`);
            return result;
        }

        // ---- Fallback: direct API calls ----
        if (!hasGoogleAdsCreds()) {
            log('No cache files found and no Google Ads credentials — skipping scan');
            return {
                success: false,
                skipped: true,
                source: 'none',
                reason: 'No cache files and no Google Ads credentials',
                campaigns: 0, adgroups: 0, audiences: 0, breakdowns: 0, funnelMatched: 0,
            };
        }

        log('No recent cache files found — falling back to Google Ads API');
        result.source = 'api';

        try { result.campaigns = await fetchCampaignsFromAPI(); }
        catch (err) {
            logErr('Error fetching campaigns:', err.message);
            result.errors.push({ step: 'campaigns', error: err.message });
        }

        try { result.adgroups = await fetchAdgroupsFromAPI(); }
        catch (err) {
            logErr('Error fetching adgroups:', err.message);
            result.errors.push({ step: 'adgroups', error: err.message });
        }

        try { result.audiences = await fetchAudienceCriteriaFromAPI(); }
        catch (err) {
            logErr('Error fetching audience criteria:', err.message);
            result.errors.push({ step: 'audiences', error: err.message });
        }

        try { result.breakdowns = await fetchBreakdownsFromAPI(); }
        catch (err) {
            logErr('Error fetching breakdowns:', err.message);
            result.errors.push({ step: 'breakdowns', error: err.message });
        }

        if (result.errors.length > 0) result.success = false;
        log(`API scan complete: ${result.campaigns} campaigns, ${result.adgroups} adgroups, ${result.audiences} audiences, ${result.breakdowns} breakdowns, ${result.errors.length} errors`);
        return result;
    }

    // -----------------------------------------------------------------------
    // Status
    // -----------------------------------------------------------------------

    async function getScanStatus() {
        const db = await getAtDb();

        const campaigns = await db.prepare(`SELECT COUNT(*) as count, MAX(synced_at) as last_sync FROM at_google_campaigns`).get();
        const adgroups = await db.prepare(`SELECT COUNT(*) as count, MAX(synced_at) as last_sync FROM at_google_adgroups`).get();
        const audiences = await db.prepare(`SELECT COUNT(*) as count, MAX(synced_at) as last_sync FROM at_google_audiences`).get();
        const breakdowns = await db.prepare(`SELECT COUNT(*) as count, MAX(synced_at) as last_sync FROM at_google_breakdowns`).get();

        const topCampaigns = await db.prepare(`
            SELECT google_campaign_id, name, status, channel_type, vertical,
                   total_spend, impressions, clicks, conversions
            FROM at_google_campaigns
            ORDER BY total_spend DESC
            LIMIT 10
        `).all();

        // Check cache freshness
        const insightsCache = findBestCache('insights-cache-');
        const funnelCache = findBestCache('gc-funnel-cache-');

        return {
            hasCreds: hasGoogleAdsCreds(),
            hasCacheFiles: !!(insightsCache || funnelCache),
            cacheInfo: {
                insights: insightsCache ? { file: path.basename(insightsCache.filePath), rows: insightsCache.data.length } : null,
                funnel: funnelCache ? { file: path.basename(funnelCache.filePath), rows: funnelCache.data.length } : null,
            },
            campaigns: { count: campaigns.count, lastSync: campaigns.last_sync },
            adgroups: { count: adgroups.count, lastSync: adgroups.last_sync },
            audiences: { count: audiences.count, lastSync: audiences.last_sync },
            breakdowns: { count: breakdowns.count, lastSync: breakdowns.last_sync },
            topCampaigns,
        };
    }

    return { runFullScan, getScanStatus };
};
