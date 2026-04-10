/**
 * gcDataFetcher.js
 * Fetches Google Ads creative data from two sources:
 *   1. Metabase (adset/adgroup-level performance metrics)
 *   2. Google Ads API (ad-level creative data: RSAs, assets, videos)
 * Merges them into gc_creatives for downstream scoring/analysis.
 */

const { getGcDb, logPipelineRun, updatePipelineRun } = require('../db/gc-db');

module.exports = function (config) {
    const METABASE_URL = config.metabaseUrl || process.env.METABASE_URL || 'https://analytics.univest.in';
    const METABASE_SESSION_TOKEN = config.metabaseSessionToken || process.env.METABASE_SESSION_TOKEN || '';

    // Google Ads API credentials — all optional; we gracefully skip if missing
    const GA_CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID || '';
    const GA_CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET || '';
    const GA_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
    const GA_CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID || '';
    const GA_LOGIN_CUSTOMER_ID = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '';
    const GA_REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN || '';

    const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

    // ---------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------

    function hasGoogleAdsCreds() {
        return GA_CLIENT_ID && GA_CLIENT_SECRET && GA_DEVELOPER_TOKEN &&
            GA_CUSTOMER_ID && GA_REFRESH_TOKEN;
    }

    function getGoogleAdsCustomer() {
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

    /**
     * Generic Metabase query helper.
     * Sends a native SQL query to Metabase DB 35 (ProdFullAccess for Google Ads)
     * and returns an array of row objects.
     */
    async function queryMetabase(sql) {
        if (!METABASE_SESSION_TOKEN) {
            throw new Error('METABASE_SESSION_TOKEN is not set — cannot query Metabase');
        }

        const response = await fetch(`${METABASE_URL}/api/dataset`, {
            method: 'POST',
            headers: {
                'X-Metabase-Session': METABASE_SESSION_TOKEN,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                database: 35, // Database 35 = ProdFullAccess for Google Ads
                type: 'native',
                native: { query: sql },
            }),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Metabase query failed (${response.status}): ${text}`);
        }

        const result = await response.json();

        if (result.error) {
            throw new Error(`Metabase query error: ${result.error}`);
        }

        const columns = result.data.cols.map(c => c.name);
        const rows = result.data.rows.map(row => {
            const obj = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            return obj;
        });
        return rows;
    }

    // ---------------------------------------------------------------------------
    // 1. Fetch Metabase adset-level performance
    // ---------------------------------------------------------------------------

    /**
     * Pulls adgroup (adset)-level daily metrics from Metabase for the last N days.
     * Stores results into gc_adset_performance.
     * Returns the fetched rows.
     */
    async function fetchMetabaseAdsets(days = 90) {
        console.log(`[gc/dataFetcher] Fetching Metabase adset performance for last ${days} days...`);

        // TODO: confirm actual Metabase table name for Google Ads data on DB 35
        // Using placeholder "google_ads_daily" — replace with real table once confirmed
        const sql = `
            SELECT
                campaign_id,
                campaign_name,
                adgroup_id,
                adgroup_name,
                (date AT TIME ZONE 'Asia/Kolkata')::date AS date,
                SUM(spend) AS spend,
                SUM(impressions) AS impressions,
                SUM(clicks) AS clicks,
                SUM(conversions) AS conversions,
                SUM(conversion_value) AS conversion_value,
                CASE WHEN SUM(spend) > 0 THEN SUM(conversion_value) / SUM(spend) ELSE 0 END AS roas,
                CASE WHEN SUM(impressions) > 0 THEN (SUM(clicks)::float / SUM(impressions)) * 100 ELSE 0 END AS ctr,
                CASE WHEN SUM(clicks) > 0 THEN SUM(spend) / SUM(clicks) ELSE 0 END AS cpc,
                CASE WHEN SUM(conversions) > 0 THEN SUM(spend) / SUM(conversions) ELSE 0 END AS cpa
            FROM google_ads_daily
            WHERE (date AT TIME ZONE 'Asia/Kolkata')::date >= (NOW() AT TIME ZONE 'Asia/Kolkata')::date - INTERVAL '${days} days'
            GROUP BY campaign_id, campaign_name, adgroup_id, adgroup_name, (date AT TIME ZONE 'Asia/Kolkata')::date
            ORDER BY date DESC, spend DESC
        `;

        const rows = await queryMetabase(sql);
        console.log(`[gc/dataFetcher] Got ${rows.length} adset-level rows from Metabase`);

        // Store into gc_adset_performance
        const db = getGcDb();
        const upsert = db.prepare(`
            INSERT INTO gc_adset_performance
                (campaign_id, campaign_name, adgroup_id, adgroup_name, date,
                 spend, impressions, clicks, conversions, conversion_value,
                 roas, ctr, cpc, cpa)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertMany = db.transaction((items) => {
            for (const r of items) {
                upsert.run(
                    r.campaign_id, r.campaign_name, r.adgroup_id, r.adgroup_name, r.date,
                    r.spend || 0, r.impressions || 0, r.clicks || 0,
                    r.conversions || 0, r.conversion_value || 0,
                    r.roas || 0, r.ctr || 0, r.cpc || 0, r.cpa || 0
                );
            }
        });
        insertMany(rows);

        console.log(`[gc/dataFetcher] Stored ${rows.length} rows into gc_adset_performance`);
        return rows;
    }

    // ---------------------------------------------------------------------------
    // 2. Fetch Google Ads API ad-level creative data
    // ---------------------------------------------------------------------------

    /**
     * Fetches RSA ads and asset-level data from Google Ads API.
     * Stores results into gc_ads_raw using UPSERT pattern.
     * Returns { rsaAds, assets } arrays.
     */
    async function fetchGoogleAdsCreatives() {
        if (!hasGoogleAdsCreds()) {
            console.warn('[gc/dataFetcher] Google Ads credentials not set — skipping API fetch');
            return { rsaAds: [], assets: [] };
        }

        console.log('[gc/dataFetcher] Fetching creatives from Google Ads API...');
        const customer = getGoogleAdsCustomer();

        // --- Fetch RSAs ---
        let rsaAds = [];
        try {
            const rsaResults = await customer.query(`
                SELECT
                    ad_group_ad.ad.id,
                    ad_group_ad.ad.responsive_search_ad.headlines,
                    ad_group_ad.ad.responsive_search_ad.descriptions,
                    ad_group_ad.ad.final_urls,
                    ad_group_ad.status,
                    segments.date,
                    campaign.id, campaign.name,
                    ad_group.id, ad_group.name,
                    metrics.impressions, metrics.clicks, metrics.cost_micros,
                    metrics.conversions, metrics.all_conversions_value
                FROM ad_group_ad
                WHERE segments.date DURING LAST_90_DAYS
                    AND campaign.status = 'ENABLED'
            `);

            rsaAds = rsaResults.map(r => ({
                ad_id: String(r.ad_group_ad.ad.id),
                date: r.segments?.date || r.segments_date || r.date || null,
                campaign_id: String(r.campaign.id),
                campaign_name: r.campaign.name,
                adgroup_id: String(r.ad_group.id),
                adgroup_name: r.ad_group.name,
                ad_type: 'RSA',
                headlines: r.ad_group_ad.ad.responsive_search_ad?.headlines || [],
                descriptions: r.ad_group_ad.ad.responsive_search_ad?.descriptions || [],
                final_url: (r.ad_group_ad.ad.final_urls || [])[0] || '',
                ad_status: r.ad_group_ad.status,
                impressions: r.metrics.impressions || 0,
                clicks: r.metrics.clicks || 0,
                cost_micros: r.metrics.cost_micros || 0,
                conversions: r.metrics.conversions || 0,
                conversion_value: r.metrics.all_conversions_value || 0,
            }));
            console.log(`[gc/dataFetcher] Fetched ${rsaAds.length} RSA ads`);
        } catch (err) {
            console.error('[gc/dataFetcher] Error fetching RSAs:', err.message);
        }

        // --- Fetch Assets (images, videos, text) ---
        let assets = [];
        try {
            const assetResults = await customer.query(`
                SELECT
                    asset.id, asset.name, asset.type,
                    asset.youtube_video_asset.youtube_video_id,
                    asset.image_asset.full_size.url,
                    asset.text_asset.text,
                    ad_group_asset.performance_label, ad_group_asset.status,
                    segments.date,
                    campaign.id, campaign.name,
                    ad_group.id, ad_group.name,
                    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
                FROM ad_group_asset
                WHERE segments.date DURING LAST_90_DAYS
                    AND asset.type IN ('IMAGE', 'YOUTUBE_VIDEO', 'TEXT')
            `);

            assets = assetResults.map(r => {
                const assetType = r.asset.type;
                let adType = 'OTHER';
                if (assetType === 'YOUTUBE_VIDEO') adType = 'VIDEO';
                else if (assetType === 'IMAGE') adType = 'DISPLAY';
                else if (assetType === 'TEXT') adType = 'TEXT';

                return {
                    ad_id: String(r.asset.id),
                    date: r.segments?.date || r.segments_date || r.date || null,
                    campaign_id: String(r.campaign.id),
                    campaign_name: r.campaign.name,
                    adgroup_id: String(r.ad_group.id),
                    adgroup_name: r.ad_group.name,
                    ad_type: adType,
                    asset_name: r.asset.name || '',
                    youtube_video_id: r.asset.youtube_video_asset?.youtube_video_id || '',
                    image_url: r.asset.image_asset?.full_size?.url || '',
                    text_content: r.asset.text_asset?.text || '',
                    performance_label: r.ad_group_asset.performance_label || 'UNSPECIFIED',
                    ad_status: r.ad_group_asset.status || '',
                    impressions: r.metrics.impressions || 0,
                    clicks: r.metrics.clicks || 0,
                    cost_micros: r.metrics.cost_micros || 0,
                    conversions: r.metrics.conversions || 0,
                };
            });
            console.log(`[gc/dataFetcher] Fetched ${assets.length} assets`);
        } catch (err) {
            console.error('[gc/dataFetcher] Error fetching assets:', err.message);
        }

        const rsaAdsRaw = Object.values(rsaAds.reduce((acc, row) => {
            if (!acc[row.ad_id]) {
                acc[row.ad_id] = Object.assign({}, row);
            } else {
                acc[row.ad_id].impressions += row.impressions || 0;
                acc[row.ad_id].clicks += row.clicks || 0;
                acc[row.ad_id].cost_micros += row.cost_micros || 0;
                acc[row.ad_id].conversions += row.conversions || 0;
                acc[row.ad_id].conversion_value += row.conversion_value || 0;
            }
            return acc;
        }, {}));

        const assetsRaw = Object.values(assets.reduce((acc, row) => {
            if (!acc[row.ad_id]) {
                acc[row.ad_id] = Object.assign({}, row);
            } else {
                acc[row.ad_id].impressions += row.impressions || 0;
                acc[row.ad_id].clicks += row.clicks || 0;
                acc[row.ad_id].cost_micros += row.cost_micros || 0;
                acc[row.ad_id].conversions += row.conversions || 0;
            }
            return acc;
        }, {}));

        // --- Store RSAs into gc_ads_raw ---
        const db = getGcDb();
        const upsertAd = db.prepare(`
            INSERT INTO gc_ads_raw
                (ad_id, campaign_id, adgroup_id, ad_type,
                 headlines_json, descriptions_json, image_url,
                 youtube_video_id, video_title, video_thumbnail_url,
                 asset_performance_label, ad_status, final_url,
                 impressions, clicks, cost_micros, conversions, conversion_value)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(ad_id) DO UPDATE SET
                campaign_id = excluded.campaign_id,
                adgroup_id = excluded.adgroup_id,
                ad_type = excluded.ad_type,
                headlines_json = excluded.headlines_json,
                descriptions_json = excluded.descriptions_json,
                image_url = excluded.image_url,
                youtube_video_id = excluded.youtube_video_id,
                video_title = excluded.video_title,
                video_thumbnail_url = excluded.video_thumbnail_url,
                asset_performance_label = excluded.asset_performance_label,
                ad_status = excluded.ad_status,
                final_url = excluded.final_url,
                impressions = excluded.impressions,
                clicks = excluded.clicks,
                cost_micros = excluded.cost_micros,
                conversions = excluded.conversions,
                conversion_value = excluded.conversion_value
        `);

        const insertRSAs = db.transaction((ads) => {
            for (const ad of ads) {
                upsertAd.run(
                    ad.ad_id, ad.campaign_id, ad.adgroup_id, ad.ad_type,
                    JSON.stringify(ad.headlines), JSON.stringify(ad.descriptions),
                    null, // image_url — RSAs don't have images
                    null, null, null, // youtube fields — RSAs don't have video
                    null, // performance_label is at asset level, not RSA level
                    ad.ad_status, ad.final_url,
                    ad.impressions || 0, ad.clicks || 0, ad.cost_micros || 0, ad.conversions || 0, ad.conversion_value || 0
                );
            }
        });
        insertRSAs(rsaAdsRaw);

        // --- Store Assets into gc_ads_raw ---
        const insertAssets = db.transaction((items) => {
            for (const a of items) {
                upsertAd.run(
                    a.ad_id, a.campaign_id, a.adgroup_id, a.ad_type,
                    a.text_content ? JSON.stringify([a.text_content]) : null, // headlines_json for text
                    null, // descriptions_json
                    a.image_url || null,
                    a.youtube_video_id || null,
                    null, null, // video_title, video_thumbnail_url — filled by fetchYouTubeMetadata
                    a.performance_label, a.ad_status,
                    null, // final_url — assets don't have final URLs
                    a.impressions || 0, a.clicks || 0, a.cost_micros || 0, a.conversions || 0, 0
                );
            }
        });
        insertAssets(assetsRaw);

        db.prepare('DELETE FROM gc_ad_daily').run();
        const insertAdDaily = db.prepare(`
            INSERT INTO gc_ad_daily
                (ad_id, campaign_id, campaign_name, adgroup_id, adgroup_name, ad_type, date,
                 impressions, clicks, cost_micros, conversions, conversion_value, asset_performance_label, ad_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertAdDailyTx = db.transaction((items) => {
            for (const row of items) {
                if (!row.date) continue;
                insertAdDaily.run(
                    row.ad_id, row.campaign_id, row.campaign_name, row.adgroup_id, row.adgroup_name, row.ad_type, row.date,
                    row.impressions || 0, row.clicks || 0, row.cost_micros || 0, row.conversions || 0, row.conversion_value || 0,
                    row.performance_label || null, row.ad_status || null
                );
            }
        });
        insertAdDailyTx(rsaAds.concat(assets));

        console.log(`[gc/dataFetcher] Upserted ${rsaAdsRaw.length} RSA ads + ${assetsRaw.length} assets into gc_ads_raw and stored ${rsaAds.length + assets.length} ad-daily rows`);
        return { rsaAds: rsaAdsRaw, assets: assetsRaw };
    }

    // ---------------------------------------------------------------------------
    // 3. Fetch YouTube video metadata (titles, thumbnails)
    // ---------------------------------------------------------------------------

    /**
     * Given an array of YouTube video IDs, fetches their titles and thumbnails
     * from the YouTube Data API v3 and updates gc_ads_raw.
     */
    async function fetchYouTubeMetadata(videoIds) {
        if (!videoIds || videoIds.length === 0) {
            return [];
        }

        if (!YOUTUBE_API_KEY) {
            console.warn('[gc/dataFetcher] YOUTUBE_API_KEY not set — skipping video metadata fetch');
            return [];
        }

        console.log(`[gc/dataFetcher] Fetching YouTube metadata for ${videoIds.length} videos...`);

        const results = [];
        // YouTube API allows up to 50 IDs per request
        const BATCH_SIZE = 50;
        for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
            const batch = videoIds.slice(i, i + BATCH_SIZE);
            const ids = batch.join(',');

            try {
                const ytRes = await fetch(
                    `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids}&key=${YOUTUBE_API_KEY}`
                );

                if (!ytRes.ok) {
                    console.error(`[gc/dataFetcher] YouTube API error: ${ytRes.status}`);
                    continue;
                }

                const ytData = await ytRes.json();

                if (ytData.items) {
                    for (const item of ytData.items) {
                        const videoId = item.id;
                        const title = item.snippet?.title || '';
                        const thumbnail = item.snippet?.thumbnails?.high?.url
                            || item.snippet?.thumbnails?.medium?.url
                            || item.snippet?.thumbnails?.default?.url
                            || '';

                        results.push({ videoId, title, thumbnail });
                    }
                }
            } catch (err) {
                console.error(`[gc/dataFetcher] YouTube fetch batch error:`, err.message);
            }
        }

        // Update gc_ads_raw with video titles and thumbnails
        const db = getGcDb();
        const updateStmt = db.prepare(`
            UPDATE gc_ads_raw
            SET video_title = ?, video_thumbnail_url = ?
            WHERE youtube_video_id = ?
        `);

        const updateAll = db.transaction((items) => {
            for (const v of items) {
                updateStmt.run(v.title, v.thumbnail, v.videoId);
            }
        });
        updateAll(results);

        console.log(`[gc/dataFetcher] Updated ${results.length} video titles/thumbnails in gc_ads_raw`);
        return results;
    }

    // ---------------------------------------------------------------------------
    // 4. Merge ad-level with adset-level data into gc_creatives
    // ---------------------------------------------------------------------------

    /**
     * Joins gc_ads_raw (ad-level) with gc_adset_performance (adset-level)
     * by campaign_id + adgroup_id.
     * Aggregates adset metrics across all dates per adgroup, then writes to gc_creatives.
     */
    async function mergeData() {
        console.log('[gc/dataFetcher] Merging ad-level and adset-level data into gc_creatives...');

        const db = getGcDb();

        // Get all ads from gc_ads_raw
        const ads = db.prepare('SELECT * FROM gc_ads_raw').all();
        if (ads.length === 0) {
            console.log('[gc/dataFetcher] No ads in gc_ads_raw — nothing to merge');
            return [];
        }

        // Aggregate adset performance per campaign_id + adgroup_id
        const adsetAgg = db.prepare(`
            SELECT
                campaign_id, campaign_name, adgroup_id, adgroup_name,
                SUM(spend) AS total_spend,
                SUM(conversions) AS total_conversions,
                CASE WHEN SUM(spend) > 0 THEN SUM(conversion_value) / SUM(spend) ELSE 0 END AS overall_roas,
                CASE WHEN SUM(impressions) > 0 THEN (CAST(SUM(clicks) AS REAL) / SUM(impressions)) * 100 ELSE 0 END AS overall_ctr
            FROM gc_adset_performance
            GROUP BY campaign_id, adgroup_id
        `).all();

        // Build lookup map: "campaign_id|adgroup_id" -> aggregated metrics
        const adsetMap = {};
        for (const ag of adsetAgg) {
            const key = `${ag.campaign_id}|${ag.adgroup_id}`;
            adsetMap[key] = ag;
        }

        // Clear old gc_creatives and re-insert fresh merged data
        db.prepare('DELETE FROM gc_creatives').run();

        const insertCreative = db.prepare(`
            INSERT INTO gc_creatives
                (ad_id, campaign_id, campaign_name, adgroup_id, adgroup_name,
                 ad_type, creative_content_json, asset_performance_label,
                 adset_roas, adset_spend, adset_conversions, adset_ctr,
                 ad_impressions, ad_clicks, ad_spend, ad_conversions, ad_conversion_value, ad_ctr, ad_cpc, ad_cpa)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const merged = [];
        const insertAll = db.transaction((adsList) => {
            for (const ad of adsList) {
                const key = `${ad.campaign_id}|${ad.adgroup_id}`;
                const perf = adsetMap[key] || {};

                // Build creative_content_json based on ad type
                const creativeContent = {};
                if (ad.ad_type === 'RSA') {
                    creativeContent.headlines = safeJsonParse(ad.headlines_json, []);
                    creativeContent.descriptions = safeJsonParse(ad.descriptions_json, []);
                    creativeContent.final_url = ad.final_url || '';
                } else if (ad.ad_type === 'VIDEO') {
                    creativeContent.youtube_video_id = ad.youtube_video_id || '';
                    creativeContent.video_title = ad.video_title || '';
                    creativeContent.video_thumbnail_url = ad.video_thumbnail_url || '';
                } else if (ad.ad_type === 'DISPLAY') {
                    creativeContent.image_url = ad.image_url || '';
                } else {
                    // TEXT or OTHER
                    creativeContent.text = safeJsonParse(ad.headlines_json, []);
                }

                const campaignName = perf.campaign_name || '';
                const adgroupName = perf.adgroup_name || '';

                insertCreative.run(
                    ad.ad_id,
                    ad.campaign_id, campaignName,
                    ad.adgroup_id, adgroupName,
                    ad.ad_type,
                    JSON.stringify(creativeContent),
                    ad.asset_performance_label || '',
                    perf.overall_roas || 0,
                    perf.total_spend || 0,
                    perf.total_conversions || 0,
                    perf.overall_ctr || 0,
                    ad.impressions || 0,
                    ad.clicks || 0,
                    (Number(ad.cost_micros) || 0) / 1000000,
                    ad.conversions || 0,
                    ad.conversion_value || 0,
                    (ad.impressions || 0) > 0 ? ((ad.clicks || 0) / ad.impressions) * 100 : 0,
                    (ad.clicks || 0) > 0 ? ((Number(ad.cost_micros) || 0) / 1000000) / ad.clicks : 0,
                    (ad.conversions || 0) > 0 ? ((Number(ad.cost_micros) || 0) / 1000000) / ad.conversions : 0
                );

                merged.push({
                    ad_id: ad.ad_id,
                    ad_type: ad.ad_type,
                    campaign_id: ad.campaign_id,
                    adgroup_id: ad.adgroup_id,
                    adset_roas: perf.overall_roas || 0,
                });
            }
        });
        insertAll(ads);

        console.log(`[gc/dataFetcher] Merged ${merged.length} creatives into gc_creatives`);
        return merged;
    }

    // ---------------------------------------------------------------------------
    // 5. Full fetch pipeline
    // ---------------------------------------------------------------------------

    /**
     * Orchestrates the full data fetch pipeline:
     *   1. Fetch Metabase adset performance
     *   2. Fetch Google Ads creatives (gracefully skip if no creds)
     *   3. Fetch YouTube metadata for any video IDs
     *   4. Merge into gc_creatives
     */
    async function runFullFetch(days = 90) {
        const runId = logPipelineRun('gc_data_fetch', JSON.stringify({ days }));
        const summary = { adsetRows: 0, rsaAds: 0, assets: 0, videos: 0, merged: 0 };

        try {
            // Step 1: Metabase adset data
            console.log('[gc/dataFetcher] === Step 1/4: Fetching Metabase adset data ===');
            const adsetRows = await fetchMetabaseAdsets(days);
            summary.adsetRows = adsetRows.length;

            // Step 2: Google Ads API creative data
            console.log('[gc/dataFetcher] === Step 2/4: Fetching Google Ads creatives ===');
            const { rsaAds, assets } = await fetchGoogleAdsCreatives();
            summary.rsaAds = rsaAds.length;
            summary.assets = assets.length;

            // Step 3: YouTube metadata for video assets
            console.log('[gc/dataFetcher] === Step 3/4: Fetching YouTube metadata ===');
            const videoIds = [];
            // Collect video IDs from assets
            for (const a of assets) {
                if (a.youtube_video_id) videoIds.push(a.youtube_video_id);
            }
            // Also check gc_ads_raw for any existing video IDs missing titles
            const db = getGcDb();
            const missingTitles = db.prepare(
                `SELECT youtube_video_id FROM gc_ads_raw
                 WHERE youtube_video_id IS NOT NULL AND youtube_video_id != ''
                   AND (video_title IS NULL OR video_title = '')`
            ).all();
            for (const row of missingTitles) {
                if (row.youtube_video_id && !videoIds.includes(row.youtube_video_id)) {
                    videoIds.push(row.youtube_video_id);
                }
            }

            const uniqueVideoIds = [...new Set(videoIds)];
            if (uniqueVideoIds.length > 0) {
                const videoResults = await fetchYouTubeMetadata(uniqueVideoIds);
                summary.videos = videoResults.length;
            }

            // Step 4: Merge
            console.log('[gc/dataFetcher] === Step 4/4: Merging data into gc_creatives ===');
            const merged = await mergeData();
            summary.merged = merged.length;

            updatePipelineRun(runId, 'success', JSON.stringify(summary));
            console.log(`[gc/dataFetcher] Full fetch complete:`, summary);
            return summary;

        } catch (err) {
            console.error('[gc/dataFetcher] Pipeline error:', err.message);
            updatePipelineRun(runId, 'error', JSON.stringify({
                error: err.message,
                ...summary,
            }));
            throw err;
        }
    }

    // ---------------------------------------------------------------------------
    // Utility
    // ---------------------------------------------------------------------------

    function safeJsonParse(str, fallback) {
        if (!str) return fallback;
        try {
            return JSON.parse(str);
        } catch {
            return fallback;
        }
    }

    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------

    return {
        fetchMetabaseAdsets,
        fetchGoogleAdsCreatives,
        fetchYouTubeMetadata,
        mergeData,
        runFullFetch,
    };
};
