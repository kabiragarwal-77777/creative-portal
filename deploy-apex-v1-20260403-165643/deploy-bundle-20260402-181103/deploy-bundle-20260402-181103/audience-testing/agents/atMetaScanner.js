/**
 * AT Meta Scanner Agent — Cache-Based
 * Reads existing cached data from creative-intelligence/ instead of
 * making live Meta API calls (which hit rate limits).
 *
 * Data sources:
 *   - insights-cache-*.json  → per-ad daily rows (spend, impressions, clicks, etc.)
 *   - funnel-cache-*.json    → per-tracker daily rows (signups, d6, d6_revenue, etc.)
 *   - ads-status-cache.json  → ad status + campaign mapping
 *
 * Optional: one Meta API call to fetch adset targeting via /api/adset-details/:id
 */

module.exports = function (config) {
    const { getAtDb } = require('../db/at-db');
    const path = require('path');
    const fs = require('fs');
    const glob = require('path');

    const CI_DIR = path.join(__dirname, '..', '..', 'creative-intelligence');
    const UPLOADER_BASE = config.uploaderBase || process.env.UPLOADER_BASE || 'http://localhost:4000';

    // --------------- helpers ---------------

    function log(...args) {
        console.log('[AT Meta Scanner]', ...args);
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    /**
     * Find the most recent cache file matching the pattern.
     * We pick the file whose date range is largest (widest window).
     * Pattern: insights-cache-YYYY-MM-DD-YYYY-MM-DD.json
     */
    function findBestCacheFile(prefix) {
        const files = fs.readdirSync(CI_DIR).filter(f => f.startsWith(prefix) && f.endsWith('.json'));
        if (files.length === 0) return null;

        let best = null;
        let bestSpan = -1;

        for (const f of files) {
            // Extract dates from filename like "insights-cache-2026-02-25-2026-03-27.json"
            const match = f.match(/(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})\.json$/);
            if (!match) continue;
            const start = new Date(match[1]);
            const end = new Date(match[2]);
            const span = end - start;
            if (span > bestSpan) {
                bestSpan = span;
                best = f;
            }
        }

        return best ? path.join(CI_DIR, best) : (files.length > 0 ? path.join(CI_DIR, files[0]) : null);
    }

    /**
     * Load a JSON cache file. Format: { ts, data: [...] }
     */
    function loadCacheFile(filePath) {
        if (!filePath || !fs.existsSync(filePath)) return [];
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed.data || parsed || [];
    }

    // --------------- inferVertical ---------------

    function inferVertical(campaignName) {
        const name = (campaignName || '').toLowerCase();
        if (name.includes('mof') || name.includes('mutual') || name.includes('sip') || name.includes('mfa')) return 'MFA';
        if (name.includes('demat') || name.includes('broking') || name.includes('tof')) return 'Broking';
        if (name.includes('pro') || name.includes('advisory') || name.includes('subscription') || name.includes('ra_') || name.includes('ra ')) return 'RA';
        return 'Unknown';
    }

    // --------------- parseTargeting ---------------

    function parseTargeting(targeting) {
        if (!targeting) return {
            age_min: 18, age_max: 65, genders: [1, 2],
            geo_locations: ['India'], interests: [], behaviors: [],
            custom_audiences: [], lookalike_audiences: [], excluded_audiences: [],
            device_platforms: ['mobile'], publisher_platforms: ['facebook', 'instagram'],
            facebook_positions: [], instagram_positions: [],
            audience_network_positions: [], broadening: true, advantage_plus: false
        };
        return {
            age_min: targeting.age_min || 18,
            age_max: targeting.age_max || 65,
            genders: targeting.genders || [1, 2],
            geo_locations: targeting.geo_locations?.cities?.map(c => c.name) || targeting.geo_locations?.regions?.map(r => r.name) || ['India'],
            interests: targeting.flexible_spec?.flatMap(s => s.interests?.map(i => i.name) || []) || [],
            behaviors: targeting.flexible_spec?.flatMap(s => s.behaviors?.map(b => b.name) || []) || [],
            custom_audiences: targeting.custom_audiences?.map(a => a.name) || [],
            lookalike_audiences: targeting.custom_audiences?.filter(a => a.name?.includes('lookalike') || a.subtype === 'LOOKALIKE').map(a => a.name) || [],
            excluded_audiences: targeting.exclusions?.custom_audiences?.map(a => a.name) || [],
            device_platforms: targeting.device_platforms || ['mobile'],
            publisher_platforms: targeting.publisher_platforms || ['facebook', 'instagram'],
            facebook_positions: targeting.facebook_positions || [],
            instagram_positions: targeting.instagram_positions || [],
            audience_network_positions: targeting.audience_network_positions || [],
            broadening: !targeting.flexible_spec?.length && !targeting.custom_audiences?.length,
            advantage_plus: targeting.targeting_optimization === 'expansion_all' || false
        };
    }

    // --------------- fuzzy match adset name ---------------

    /**
     * Normalize an adset name for fuzzy matching.
     * Funnel data uses lowercase ad_set_name while insights uses mixed-case adset_name.
     */
    function normalizeName(name) {
        return (name || '').toLowerCase().replace(/[\s_\-]+/g, '').replace(/adset/gi, '');
    }

    // --------------- aggregate from cache ---------------

    function aggregateCampaigns(insightsRows, adsStatusRows) {
        log('Aggregating campaigns from insights cache...');
        const db = getAtDb();

        // Build campaign map from insights
        const campMap = new Map();
        for (const row of insightsRows) {
            const cid = String(row.campaign_id || '');
            if (!cid) continue;
            if (!campMap.has(cid)) {
                campMap.set(cid, {
                    meta_campaign_id: cid,
                    name: row.campaign_name || '',
                    spend: 0, impressions: 0, clicks: 0
                });
            }
            const c = campMap.get(cid);
            c.spend += parseFloat(row.spend || 0);
            c.impressions += parseInt(row.impressions || 0, 10);
            c.clicks += parseInt(row.clicks || 0, 10);
        }

        // Build status lookup from ads-status-cache (campaign-level)
        const campStatusMap = new Map();
        for (const ad of adsStatusRows) {
            const cid = String(ad.campaign_id || '');
            if (!cid) continue;
            // Any ACTIVE ad means campaign is ACTIVE
            if (!campStatusMap.has(cid) || ad.status === 'ACTIVE') {
                campStatusMap.set(cid, {
                    status: ad.status || 'UNKNOWN',
                    name: ad.campaign_name || ''
                });
            }
        }

        const upsert = db.prepare(`
            INSERT OR REPLACE INTO at_meta_campaigns
                (meta_campaign_id, name, objective, status, vertical,
                 daily_budget, lifetime_budget, start_time, stop_time,
                 total_spend, total_impressions, total_clicks, synced_at)
            VALUES
                (@meta_campaign_id, @name, @objective, @status, @vertical,
                 @daily_budget, @lifetime_budget, @start_time, @stop_time,
                 @total_spend, @total_impressions, @total_clicks, datetime('now'))
        `);

        const rows = [];
        for (const [cid, c] of campMap) {
            const statusInfo = campStatusMap.get(cid);
            rows.push({
                meta_campaign_id: cid,
                name: c.name || (statusInfo ? statusInfo.name : ''),
                objective: '',
                status: statusInfo ? statusInfo.status : 'UNKNOWN',
                vertical: inferVertical(c.name || (statusInfo ? statusInfo.name : '')),
                daily_budget: 0,
                lifetime_budget: 0,
                start_time: null,
                stop_time: null,
                total_spend: Math.round(c.spend * 100) / 100,
                total_impressions: c.impressions,
                total_clicks: c.clicks
            });
        }

        const insertMany = db.transaction((items) => {
            for (const item of items) upsert.run(item);
        });
        insertMany(rows);

        log(`Campaigns: ${rows.length} stored from cache.`);
        return rows.length;
    }

    function aggregateAdsets(insightsRows, adsStatusRows) {
        log('Aggregating adsets from insights cache...');
        const db = getAtDb();

        // Build adset map from insights
        const adsetMap = new Map();
        for (const row of insightsRows) {
            const asid = String(row.adset_id || '');
            if (!asid) continue;
            if (!adsetMap.has(asid)) {
                adsetMap.set(asid, {
                    meta_adset_id: asid,
                    meta_campaign_id: String(row.campaign_id || ''),
                    name: row.adset_name || '',
                    campaign_name: row.campaign_name || '',
                    spend: 0, impressions: 0, clicks: 0,
                    installs: 0, thruplay: 0
                });
            }
            const a = adsetMap.get(asid);
            a.spend += parseFloat(row.spend || 0);
            a.impressions += parseInt(row.impressions || 0, 10);
            a.clicks += parseInt(row.clicks || 0, 10);
            a.installs += parseInt(row.installs || 0, 10);
            a.thruplay += parseInt(row.thruplay || 0, 10);
        }

        // Build status lookup from ads-status-cache (adset → campaign)
        // ads-status-cache has ad-level data; derive adset status from ad statuses
        // We don't have adset_id in ads-status-cache, so we skip adset-level status

        const upsert = db.prepare(`
            INSERT OR REPLACE INTO at_meta_adsets
                (meta_adset_id, meta_campaign_id, name, status,
                 optimization_goal, bid_strategy, daily_budget, lifetime_budget,
                 age_min, age_max, genders_json, geo_locations_json,
                 interests_json, behaviors_json, custom_audiences_json,
                 lookalike_audiences_json, excluded_audiences_json,
                 device_platforms_json, publisher_platforms_json,
                 facebook_positions_json, instagram_positions_json,
                 is_broad, is_advantage_plus,
                 total_spend, impressions, clicks, reach, frequency,
                 cpm, cpc, ctr, cpp, installs, synced_at)
            VALUES
                (@meta_adset_id, @meta_campaign_id, @name, @status,
                 @optimization_goal, @bid_strategy, @daily_budget, @lifetime_budget,
                 @age_min, @age_max, @genders_json, @geo_locations_json,
                 @interests_json, @behaviors_json, @custom_audiences_json,
                 @lookalike_audiences_json, @excluded_audiences_json,
                 @device_platforms_json, @publisher_platforms_json,
                 @facebook_positions_json, @instagram_positions_json,
                 @is_broad, @is_advantage_plus,
                 @total_spend, @impressions, @clicks, @reach, @frequency,
                 @cpm, @cpc, @ctr, @cpp, @installs, datetime('now'))
        `);

        const rows = [];
        for (const [asid, a] of adsetMap) {
            const spend = Math.round(a.spend * 100) / 100;
            const impressions = a.impressions;
            const clicks = a.clicks;
            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
            const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;
            const cpc = clicks > 0 ? spend / clicks : 0;
            const t = parseTargeting(null); // defaults — targeting fetched optionally later

            rows.push({
                meta_adset_id: asid,
                meta_campaign_id: a.meta_campaign_id,
                name: a.name,
                status: 'UNKNOWN',
                optimization_goal: '',
                bid_strategy: '',
                daily_budget: 0,
                lifetime_budget: 0,
                age_min: t.age_min,
                age_max: t.age_max,
                genders_json: JSON.stringify(t.genders),
                geo_locations_json: JSON.stringify(t.geo_locations),
                interests_json: JSON.stringify(t.interests),
                behaviors_json: JSON.stringify(t.behaviors),
                custom_audiences_json: JSON.stringify(t.custom_audiences),
                lookalike_audiences_json: JSON.stringify(t.lookalike_audiences),
                excluded_audiences_json: JSON.stringify(t.excluded_audiences),
                device_platforms_json: JSON.stringify(t.device_platforms),
                publisher_platforms_json: JSON.stringify(t.publisher_platforms),
                facebook_positions_json: JSON.stringify(t.facebook_positions),
                instagram_positions_json: JSON.stringify(t.instagram_positions),
                is_broad: t.broadening ? 1 : 0,
                is_advantage_plus: t.advantage_plus ? 1 : 0,
                total_spend: spend,
                impressions,
                clicks,
                reach: 0,
                frequency: 0,
                cpm: Math.round(cpm * 100) / 100,
                cpc: Math.round(cpc * 100) / 100,
                ctr: Math.round(ctr * 1000) / 1000,
                cpp: 0,
                installs: a.installs
            });
        }

        const insertMany = db.transaction((items) => {
            for (const item of items) upsert.run(item);
        });
        insertMany(rows);

        log(`Adsets: ${rows.length} stored from cache.`);
        return rows.length;
    }

    /**
     * Join funnel data onto adsets.
     * Funnel rows have: meta_campaign_id, ad_set_name (lowercase).
     * We aggregate funnel by campaign_id + ad_set_name, then match to adsets.
     */
    function joinFunnelData(funnelRows) {
        log('Joining funnel data to adsets...');
        const db = getAtDb();

        // Aggregate funnel by campaign_id + normalized ad_set_name
        const funnelMap = new Map(); // key = campaignId + '||' + normalizedAdsetName
        for (const row of funnelRows) {
            const cid = String(row.meta_campaign_id || '');
            const asName = normalizeName(row.ad_set_name);
            if (!cid || !asName) continue;
            const key = cid + '||' + asName;
            if (!funnelMap.has(key)) {
                funnelMap.set(key, {
                    signups: 0, d0_conversions: 0, d0_revenue: 0,
                    d6_conversions: 0, d6_revenue: 0,
                    d30_conversions: 0, d30_revenue: 0
                });
            }
            const f = funnelMap.get(key);
            f.signups += parseInt(row.signups || 0, 10);
            f.d0_conversions += parseInt(row.d0 || 0, 10);
            f.d0_revenue += parseFloat(row.d0_revenue || 0);
            f.d6_conversions += parseInt(row.d6_overall_con || row.d6 || 0, 10);
            f.d6_revenue += parseFloat(row.d6_overall_revenue || row.d6_revenue || 0);
            f.d30_conversions += parseInt(row.d30_overall_con || 0, 10);
            f.d30_revenue += parseFloat(row.d30_overall_revenue || 0);
        }

        log(`  Funnel map has ${funnelMap.size} unique campaign+adset keys.`);

        // Load all adsets from DB
        const adsets = db.prepare('SELECT meta_adset_id, meta_campaign_id, name, total_spend FROM at_meta_adsets').all();

        const updateFunnel = db.prepare(`
            UPDATE at_meta_adsets SET
                signups = @signups,
                d0_conversions = @d0_conversions,
                d0_revenue = @d0_revenue,
                d6_conversions = @d6_conversions,
                d6_revenue = @d6_revenue,
                d6_cac = @d6_cac,
                d6_roas = @d6_roas,
                d0_cvr_pct = @d0_cvr_pct,
                d6_cvr_pct = @d6_cvr_pct,
                d30_conversions = @d30_conversions,
                d30_revenue = @d30_revenue,
                synced_at = datetime('now')
            WHERE meta_adset_id = @meta_adset_id
        `);

        let matched = 0;
        let unmatched = 0;

        const updateMany = db.transaction((items) => {
            for (const item of items) updateFunnel.run(item);
        });

        const updates = [];
        for (const adset of adsets) {
            const normAdsetName = normalizeName(adset.name);
            const key = adset.meta_campaign_id + '||' + normAdsetName;
            const funnel = funnelMap.get(key);

            if (funnel) {
                const spend = adset.total_spend || 0;
                const d6_cac = funnel.d6_conversions > 0 ? Math.round((spend / funnel.d6_conversions) * 100) / 100 : null;
                const d6_roas = spend > 0 ? Math.round((funnel.d6_revenue / spend) * 1000) / 1000 : null;
                const d0_cvr = funnel.signups > 0 ? Math.round((funnel.d0_conversions / funnel.signups) * 10000) / 100 : null;
                const d6_cvr = funnel.signups > 0 ? Math.round((funnel.d6_conversions / funnel.signups) * 10000) / 100 : null;

                updates.push({
                    meta_adset_id: adset.meta_adset_id,
                    signups: funnel.signups,
                    d0_conversions: funnel.d0_conversions,
                    d0_revenue: Math.round(funnel.d0_revenue * 100) / 100,
                    d6_conversions: funnel.d6_conversions,
                    d6_revenue: Math.round(funnel.d6_revenue * 100) / 100,
                    d6_cac,
                    d6_roas,
                    d0_cvr_pct: d0_cvr,
                    d6_cvr_pct: d6_cvr,
                    d30_conversions: funnel.d30_conversions,
                    d30_revenue: Math.round(funnel.d30_revenue * 100) / 100
                });
                matched++;
            } else {
                unmatched++;
            }
        }

        if (updates.length > 0) {
            updateMany(updates);
        }

        log(`Funnel join: ${matched} matched, ${unmatched} unmatched out of ${adsets.length} adsets.`);
        return { matched, unmatched };
    }

    /**
     * Optionally fetch targeting data from the uploader's /api/adset-details/:id endpoint.
     * This uses our own server proxy, not direct Meta API calls, so it goes through
     * the existing rate-limit handling in the uploader.
     * We only attempt this for adsets that have spend > 0 to keep it useful.
     * If any request fails, we log and continue — targeting is optional.
     */
    async function fetchTargetingFromUploader() {
        log('Fetching adset targeting from uploader API...');
        const db = getAtDb();

        // Only fetch targeting for adsets that have meaningful spend and no targeting yet
        const adsets = db.prepare(`
            SELECT meta_adset_id FROM at_meta_adsets
            WHERE total_spend > 100
              AND interests_json = '[]'
              AND custom_audiences_json = '[]'
            ORDER BY total_spend DESC
            LIMIT 200
        `).all();

        if (adsets.length === 0) {
            log('  No adsets need targeting fetch.');
            return 0;
        }

        log(`  Attempting targeting fetch for ${adsets.length} adsets via uploader API...`);

        const updateTargeting = db.prepare(`
            UPDATE at_meta_adsets SET
                status = COALESCE(@status, status),
                optimization_goal = COALESCE(@optimization_goal, optimization_goal),
                bid_strategy = COALESCE(@bid_strategy, bid_strategy),
                daily_budget = COALESCE(@daily_budget, daily_budget),
                lifetime_budget = COALESCE(@lifetime_budget, lifetime_budget),
                age_min = @age_min,
                age_max = @age_max,
                genders_json = @genders_json,
                geo_locations_json = @geo_locations_json,
                interests_json = @interests_json,
                behaviors_json = @behaviors_json,
                custom_audiences_json = @custom_audiences_json,
                lookalike_audiences_json = @lookalike_audiences_json,
                excluded_audiences_json = @excluded_audiences_json,
                device_platforms_json = @device_platforms_json,
                publisher_platforms_json = @publisher_platforms_json,
                facebook_positions_json = @facebook_positions_json,
                instagram_positions_json = @instagram_positions_json,
                is_broad = @is_broad,
                is_advantage_plus = @is_advantage_plus,
                synced_at = datetime('now')
            WHERE meta_adset_id = @meta_adset_id
        `);

        let fetched = 0;
        let errors = 0;

        for (const adset of adsets) {
            try {
                const url = `${UPLOADER_BASE}/api/adset-details/${adset.meta_adset_id}`;
                const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
                if (!res.ok) {
                    // Rate limited or error — stop trying
                    if (res.status === 429) {
                        log(`  Rate limited at ${fetched} adsets. Stopping targeting fetch.`);
                        break;
                    }
                    errors++;
                    continue;
                }
                const body = await res.json();
                if (!body.success || !body.adset) {
                    errors++;
                    continue;
                }

                const adsetData = body.adset;
                const t = parseTargeting(adsetData.targeting);

                updateTargeting.run({
                    meta_adset_id: adset.meta_adset_id,
                    status: adsetData.status || null,
                    optimization_goal: adsetData.optimization_goal || null,
                    bid_strategy: adsetData.bid_strategy || null,
                    daily_budget: adsetData.daily_budget ? parseFloat(adsetData.daily_budget) / 100 : null,
                    lifetime_budget: adsetData.lifetime_budget ? parseFloat(adsetData.lifetime_budget) / 100 : null,
                    age_min: t.age_min,
                    age_max: t.age_max,
                    genders_json: JSON.stringify(t.genders),
                    geo_locations_json: JSON.stringify(t.geo_locations),
                    interests_json: JSON.stringify(t.interests),
                    behaviors_json: JSON.stringify(t.behaviors),
                    custom_audiences_json: JSON.stringify(t.custom_audiences),
                    lookalike_audiences_json: JSON.stringify(t.lookalike_audiences),
                    excluded_audiences_json: JSON.stringify(t.excluded_audiences),
                    device_platforms_json: JSON.stringify(t.device_platforms),
                    publisher_platforms_json: JSON.stringify(t.publisher_platforms),
                    facebook_positions_json: JSON.stringify(t.facebook_positions),
                    instagram_positions_json: JSON.stringify(t.instagram_positions),
                    is_broad: t.broadening ? 1 : 0,
                    is_advantage_plus: t.advantage_plus ? 1 : 0
                });

                fetched++;

                // Be gentle — 1 request per second
                if (fetched % 10 === 0) {
                    log(`  Fetched targeting for ${fetched}/${adsets.length} adsets...`);
                }
                await sleep(1000);
            } catch (err) {
                errors++;
                if (err.name === 'TimeoutError' || err.name === 'AbortError') {
                    log(`  Uploader API timeout. Stopping targeting fetch.`);
                    break;
                }
                // Connection refused means uploader isn't running — stop
                if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
                    log(`  Uploader not running at ${UPLOADER_BASE}. Skipping targeting fetch.`);
                    break;
                }
            }
        }

        log(`Targeting fetch: ${fetched} succeeded, ${errors} errors.`);
        return fetched;
    }

    // --------------- runFullScan ---------------

    async function runFullScan() {
        log('=== Starting full Meta scan (cache-based) ===');
        const startTime = Date.now();

        try {
            // 1. Find and load cache files
            const insightsFile = findBestCacheFile('insights-cache-');
            const funnelFile = findBestCacheFile('funnel-cache-');
            const adsStatusFile = path.join(CI_DIR, 'ads-status-cache.json');

            if (!insightsFile) {
                throw new Error('No insights-cache-*.json found in creative-intelligence/');
            }

            log(`Loading insights: ${path.basename(insightsFile)}`);
            const insightsRows = loadCacheFile(insightsFile);
            log(`  ${insightsRows.length} insight rows loaded.`);

            log(`Loading funnel: ${funnelFile ? path.basename(funnelFile) : 'NOT FOUND'}`);
            const funnelRows = funnelFile ? loadCacheFile(funnelFile) : [];
            log(`  ${funnelRows.length} funnel rows loaded.`);

            log(`Loading ads status: ${fs.existsSync(adsStatusFile) ? 'found' : 'NOT FOUND'}`);
            const adsStatusRows = fs.existsSync(adsStatusFile) ? loadCacheFile(adsStatusFile) : [];
            log(`  ${adsStatusRows.length} ad status rows loaded.`);

            // 2. Aggregate campaigns from insights
            const campaignCount = aggregateCampaigns(insightsRows, adsStatusRows);

            // 3. Aggregate adsets from insights
            const adsetCount = aggregateAdsets(insightsRows, adsStatusRows);

            // 4. Join funnel data
            const funnelResult = joinFunnelData(funnelRows);

            // 5. Optionally fetch targeting from uploader API (graceful — skips if unavailable)
            let targetingFetched = 0;
            try {
                targetingFetched = await fetchTargetingFromUploader();
            } catch (err) {
                log(`Targeting fetch failed (non-critical): ${err.message}`);
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const summary = {
                campaigns: campaignCount,
                adsets: adsetCount,
                funnelMatched: funnelResult.matched,
                funnelUnmatched: funnelResult.unmatched,
                targetingFetched,
                insightsFile: insightsFile ? path.basename(insightsFile) : null,
                funnelFile: funnelFile ? path.basename(funnelFile) : null,
                elapsedSeconds: parseFloat(elapsed)
            };

            log(`=== Full scan complete in ${elapsed}s ===`, JSON.stringify(summary));
            return summary;
        } catch (err) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            log(`=== Full scan FAILED after ${elapsed}s: ${err.message} ===`);
            throw err;
        }
    }

    // --------------- getScanStatus ---------------

    function getScanStatus() {
        const db = getAtDb();
        const campaignCount = db.prepare('SELECT COUNT(*) as cnt FROM at_meta_campaigns').get().cnt;
        const adsetCount = db.prepare('SELECT COUNT(*) as cnt FROM at_meta_adsets').get().cnt;
        const adsetWithMetrics = db.prepare('SELECT COUNT(*) as cnt FROM at_meta_adsets WHERE total_spend > 0').get().cnt;
        const adsetWithFunnel = db.prepare('SELECT COUNT(*) as cnt FROM at_meta_adsets WHERE d6_conversions > 0').get().cnt;
        const lastSync = db.prepare('SELECT MAX(synced_at) as ts FROM at_meta_campaigns').get().ts;

        // Check which cache files are available
        const insightsFile = findBestCacheFile('insights-cache-');
        const funnelFile = findBestCacheFile('funnel-cache-');

        return {
            lastSync: lastSync || null,
            campaignCount,
            adsetCount,
            adsetWithMetrics,
            adsetWithFunnel,
            cacheFiles: {
                insights: insightsFile ? path.basename(insightsFile) : null,
                funnel: funnelFile ? path.basename(funnelFile) : null,
                adsStatus: fs.existsSync(path.join(CI_DIR, 'ads-status-cache.json'))
            }
        };
    }

    // --------------- public API ---------------

    return {
        runFullScan,
        getScanStatus
    };
};
