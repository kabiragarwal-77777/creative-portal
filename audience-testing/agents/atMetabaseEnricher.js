/**
 * AT Metabase Enricher
 * Enriches Meta + Google audience data with downstream conversion data from Metabase.
 * Queries user_additional_details + user_transaction_history to get D0/D6/D30 metrics.
 */

const { getAtDb } = require('../db/at-db');

module.exports = function (config) {
    config = config || {};

    const METABASE_URL = config.metabaseUrl || process.env.METABASE_URL || 'https://analytics.univest.in';
    const METABASE_SESSION_TOKEN = config.metabaseSessionToken || process.env.METABASE_SESSION_TOKEN || '';

    // ── Metabase query helper ───────────────────────────────────────────

    async function queryMetabase(sql) {
        if (!METABASE_SESSION_TOKEN) throw new Error('METABASE_SESSION_TOKEN not set');
        const response = await fetch(`${METABASE_URL}/api/dataset`, {
            method: 'POST',
            headers: {
                'X-Metabase-Session': METABASE_SESSION_TOKEN,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                database: 35,
                type: 'native',
                native: { query: sql },
            }),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Metabase query failed (${response.status}): ${text}`);
        }
        const result = await response.json();
        if (result.error) throw new Error(`Metabase error: ${result.error}`);
        const columns = result.data.cols.map(c => c.name);
        return result.data.rows.map(row => {
            const obj = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            return obj;
        });
    }

    // ── Enrich Meta adsets ──────────────────────────────────────────────

    async function enrichMeta() {
        console.log('[AT Metabase Enricher] Starting Meta enrichment...');
        const db = await getAtDb();

        const sql = `
            WITH attributed AS (
                SELECT
                    SPLIT_PART(uad.tracker_name, ':', 2) AS meta_campaign_id,
                    uad.tracker_sub_campaign_name AS adset_name,
                    uad.user_id,
                    DATE(uad.signup_date_col) AS signup_date
                FROM user_additional_details uad
                JOIN users u ON u.id = uad.user_id
                WHERE (uad.network ILIKE '%facebook%' OR uad.network = 'Facebook')
                    AND SPLIT_PART(uad.tracker_name, ':', 2) != ''
                    AND u.referred_by IS NULL
                    AND DATE(uad.signup_date_col) >= CURRENT_DATE - INTERVAL '365 days'
            ),
            conversions AS (
                SELECT
                    a.meta_campaign_id,
                    a.adset_name,
                    COUNT(DISTINCT a.user_id) AS total_signups,
                    COUNT(DISTINCT CASE WHEN DATE(uth.payment_date) = a.signup_date THEN uth.user_id END) AS d0_conversions,
                    SUM(CASE WHEN DATE(uth.payment_date) = a.signup_date THEN uth.amount ELSE 0 END) AS d0_revenue,
                    COUNT(DISTINCT CASE WHEN DATE(uth.payment_date) <= a.signup_date + INTERVAL '6 days' THEN uth.user_id END) AS d6_conversions,
                    SUM(CASE WHEN DATE(uth.payment_date) <= a.signup_date + INTERVAL '6 days' THEN uth.amount ELSE 0 END) AS d6_revenue,
                    COUNT(DISTINCT CASE WHEN DATE(uth.payment_date) <= a.signup_date + INTERVAL '30 days' THEN uth.user_id END) AS d30_conversions,
                    SUM(CASE WHEN DATE(uth.payment_date) <= a.signup_date + INTERVAL '30 days' THEN uth.amount ELSE 0 END) AS d30_revenue
                FROM attributed a
                LEFT JOIN user_transaction_history uth
                    ON uth.user_id = a.user_id
                    AND uth.status = 'CHARGED'
                    AND uth.amount > 50
                GROUP BY 1, 2
            )
            SELECT * FROM conversions
        `;

        let metabaseRows;
        try {
            metabaseRows = await queryMetabase(sql);
            console.log(`[AT Metabase Enricher] Fetched ${metabaseRows.length} Meta conversion rows from Metabase`);
        } catch (err) {
            console.error('[AT Metabase Enricher] Failed to fetch Meta conversions:', err.message);
            throw err;
        }

        // Build lookup: lowercase trimmed adset_name -> metabase row
        const mbLookup = new Map();
        for (const row of metabaseRows) {
            const key = (row.adset_name || '').trim().toLowerCase();
            if (!key) continue;
            // If duplicate keys, merge by summing (same adset name across campaigns)
            if (mbLookup.has(key)) {
                const existing = mbLookup.get(key);
                existing.total_signups += (row.total_signups || 0);
                existing.d0_conversions += (row.d0_conversions || 0);
                existing.d0_revenue += (row.d0_revenue || 0);
                existing.d6_conversions += (row.d6_conversions || 0);
                existing.d6_revenue += (row.d6_revenue || 0);
                existing.d30_conversions += (row.d30_conversions || 0);
                existing.d30_revenue += (row.d30_revenue || 0);
            } else {
                mbLookup.set(key, {
                    total_signups: row.total_signups || 0,
                    d0_conversions: row.d0_conversions || 0,
                    d0_revenue: row.d0_revenue || 0,
                    d6_conversions: row.d6_conversions || 0,
                    d6_revenue: row.d6_revenue || 0,
                    d30_conversions: row.d30_conversions || 0,
                    d30_revenue: row.d30_revenue || 0,
                });
            }
        }

        // Load all adsets from local DB
        const adsets = await db.prepare('SELECT id, name, total_spend FROM at_meta_adsets').all();
        console.log(`[AT Metabase Enricher] Matching against ${adsets.length} local Meta adsets`);

        const updateStmt = db.prepare(`
            UPDATE at_meta_adsets SET
                metabase_signups = ?,
                d0_conversions = ?,
                d0_revenue = ?,
                d6_conversions = ?,
                d6_revenue = ?,
                d30_conversions = ?,
                d30_revenue = ?,
                d6_cac = ?,
                d6_roas = ?,
                d0_cvr_pct = ?,
                d6_cvr_pct = ?
            WHERE id = ?
        `);

        let matched = 0;
        let skipped = 0;

        const updateAll = db.transaction(async () => {
            for (const adset of adsets) {
                const key = (adset.name || '').trim().toLowerCase();
                const mb = mbLookup.get(key);
                if (!mb) {
                    skipped++;
                    continue;
                }

                const spend = adset.total_spend || 0;

                // D6 CAC: total_spend / d6_conversions, validate between 100 and 50000
                let d6Cac = null;
                if (mb.d6_conversions > 0 && spend > 0) {
                    const raw = spend / mb.d6_conversions;
                    if (raw >= 100 && raw <= 50000) {
                        d6Cac = Math.round(raw * 100) / 100;
                    }
                }

                // D6 ROAS: d6_revenue / total_spend, validate between 0.1 and 20
                let d6Roas = null;
                if (spend > 0 && mb.d6_revenue > 0) {
                    const raw = mb.d6_revenue / spend;
                    if (raw >= 0.1 && raw <= 20) {
                        d6Roas = Math.round(raw * 1000) / 1000;
                    }
                }

                // Conversion rates
                let d0CvrPct = null;
                if (mb.total_signups > 0) {
                    d0CvrPct = Math.round((mb.d0_conversions / mb.total_signups) * 10000) / 100;
                }

                let d6CvrPct = null;
                if (mb.total_signups > 0) {
                    d6CvrPct = Math.round((mb.d6_conversions / mb.total_signups) * 10000) / 100;
                }

                await updateStmt.run(
                    mb.total_signups,
                    mb.d0_conversions,
                    Math.round(mb.d0_revenue * 100) / 100,
                    mb.d6_conversions,
                    Math.round(mb.d6_revenue * 100) / 100,
                    mb.d30_conversions,
                    Math.round(mb.d30_revenue * 100) / 100,
                    d6Cac,
                    d6Roas,
                    d0CvrPct,
                    d6CvrPct,
                    adset.id
                );
                matched++;
            }
        });

        await updateAll();
        console.log(`[AT Metabase Enricher] Meta enrichment complete: ${matched} matched, ${skipped} unmatched`);

        return { matched, skipped, total: adsets.length, metabaseRows: metabaseRows.length };
    }

    // ── Enrich Google ad groups ─────────────────────────────────────────

    async function enrichGoogle() {
        console.log('[AT Metabase Enricher] Starting Google enrichment...');
        const db = await getAtDb();

        const sql = `
            WITH attributed AS (
                SELECT
                    uad.tracker_sub_campaign_name AS adgroup_name,
                    uad.user_id,
                    DATE(uad.signup_date_col) AS signup_date
                FROM user_additional_details uad
                JOIN users u ON u.id = uad.user_id
                WHERE (uad.network ILIKE '%google%' OR uad.network ILIKE '%adwords%')
                    AND u.referred_by IS NULL
                    AND DATE(uad.signup_date_col) >= CURRENT_DATE - INTERVAL '365 days'
            ),
            conversions AS (
                SELECT
                    a.adgroup_name,
                    COUNT(DISTINCT a.user_id) AS total_signups,
                    COUNT(DISTINCT CASE WHEN DATE(uth.payment_date) = a.signup_date THEN uth.user_id END) AS d0_conversions,
                    SUM(CASE WHEN DATE(uth.payment_date) = a.signup_date THEN uth.amount ELSE 0 END) AS d0_revenue,
                    COUNT(DISTINCT CASE WHEN DATE(uth.payment_date) <= a.signup_date + INTERVAL '6 days' THEN uth.user_id END) AS d6_conversions,
                    SUM(CASE WHEN DATE(uth.payment_date) <= a.signup_date + INTERVAL '6 days' THEN uth.amount ELSE 0 END) AS d6_revenue,
                    COUNT(DISTINCT CASE WHEN DATE(uth.payment_date) <= a.signup_date + INTERVAL '30 days' THEN uth.user_id END) AS d30_conversions,
                    SUM(CASE WHEN DATE(uth.payment_date) <= a.signup_date + INTERVAL '30 days' THEN uth.amount ELSE 0 END) AS d30_revenue
                FROM attributed a
                LEFT JOIN user_transaction_history uth
                    ON uth.user_id = a.user_id
                    AND uth.status = 'CHARGED'
                    AND uth.amount > 50
                GROUP BY 1
            )
            SELECT * FROM conversions
        `;

        let metabaseRows;
        try {
            metabaseRows = await queryMetabase(sql);
            console.log(`[AT Metabase Enricher] Fetched ${metabaseRows.length} Google conversion rows from Metabase`);
        } catch (err) {
            console.error('[AT Metabase Enricher] Failed to fetch Google conversions:', err.message);
            throw err;
        }

        // Build lookup: lowercase trimmed adgroup_name -> metabase row
        const mbLookup = new Map();
        for (const row of metabaseRows) {
            const key = (row.adgroup_name || '').trim().toLowerCase();
            if (!key) continue;
            if (mbLookup.has(key)) {
                const existing = mbLookup.get(key);
                existing.total_signups += (row.total_signups || 0);
                existing.d0_conversions += (row.d0_conversions || 0);
                existing.d0_revenue += (row.d0_revenue || 0);
                existing.d6_conversions += (row.d6_conversions || 0);
                existing.d6_revenue += (row.d6_revenue || 0);
                existing.d30_conversions += (row.d30_conversions || 0);
                existing.d30_revenue += (row.d30_revenue || 0);
            } else {
                mbLookup.set(key, {
                    total_signups: row.total_signups || 0,
                    d0_conversions: row.d0_conversions || 0,
                    d0_revenue: row.d0_revenue || 0,
                    d6_conversions: row.d6_conversions || 0,
                    d6_revenue: row.d6_revenue || 0,
                    d30_conversions: row.d30_conversions || 0,
                    d30_revenue: row.d30_revenue || 0,
                });
            }
        }

        // Load all adgroups from local DB
        const adgroups = await db.prepare('SELECT id, name, total_spend FROM at_google_adgroups').all();
        console.log(`[AT Metabase Enricher] Matching against ${adgroups.length} local Google ad groups`);

        const updateStmt = db.prepare(`
            UPDATE at_google_adgroups SET
                metabase_signups = ?,
                d6_conversions = ?,
                d6_revenue = ?,
                d6_cac = ?,
                d6_roas = ?
            WHERE id = ?
        `);

        let matched = 0;
        let skipped = 0;

        const updateAll = db.transaction(async () => {
            for (const ag of adgroups) {
                const key = (ag.name || '').trim().toLowerCase();
                const mb = mbLookup.get(key);
                if (!mb) {
                    skipped++;
                    continue;
                }

                const spend = ag.total_spend || 0;

                // D6 CAC: total_spend / d6_conversions, validate between 100 and 50000
                let d6Cac = null;
                if (mb.d6_conversions > 0 && spend > 0) {
                    const raw = spend / mb.d6_conversions;
                    if (raw >= 100 && raw <= 50000) {
                        d6Cac = Math.round(raw * 100) / 100;
                    }
                }

                // D6 ROAS: d6_revenue / total_spend, validate between 0.1 and 20
                let d6Roas = null;
                if (spend > 0 && mb.d6_revenue > 0) {
                    const raw = mb.d6_revenue / spend;
                    if (raw >= 0.1 && raw <= 20) {
                        d6Roas = Math.round(raw * 1000) / 1000;
                    }
                }

                await updateStmt.run(
                    mb.total_signups,
                    mb.d6_conversions,
                    Math.round(mb.d6_revenue * 100) / 100,
                    d6Cac,
                    d6Roas,
                    ag.id
                );
                matched++;
            }
        });

        await updateAll();
        console.log(`[AT Metabase Enricher] Google enrichment complete: ${matched} matched, ${skipped} unmatched`);

        return { matched, skipped, total: adgroups.length, metabaseRows: metabaseRows.length };
    }

    // ── Enrichment status ───────────────────────────────────────────────

    async function getEnrichmentStatus() {
        const db = await getAtDb();

        const metaTotal = (await db.prepare('SELECT COUNT(*) AS cnt FROM at_meta_adsets').get()).cnt;
        const metaEnriched = (await db.prepare('SELECT COUNT(*) AS cnt FROM at_meta_adsets WHERE metabase_signups > 0').get()).cnt;
        const metaWithCac = (await db.prepare('SELECT COUNT(*) AS cnt FROM at_meta_adsets WHERE d6_cac IS NOT NULL').get()).cnt;

        const googleTotal = (await db.prepare('SELECT COUNT(*) AS cnt FROM at_google_adgroups').get()).cnt;
        const googleEnriched = (await db.prepare('SELECT COUNT(*) AS cnt FROM at_google_adgroups WHERE metabase_signups > 0').get()).cnt;
        const googleWithCac = (await db.prepare('SELECT COUNT(*) AS cnt FROM at_google_adgroups WHERE d6_cac IS NOT NULL').get()).cnt;

        return {
            meta: {
                total: metaTotal,
                enriched: metaEnriched,
                withD6Cac: metaWithCac,
                enrichedPct: metaTotal > 0 ? Math.round((metaEnriched / metaTotal) * 100) : 0,
            },
            google: {
                total: googleTotal,
                enriched: googleEnriched,
                withD6Cac: googleWithCac,
                enrichedPct: googleTotal > 0 ? Math.round((googleEnriched / googleTotal) * 100) : 0,
            },
        };
    }

    return { enrichMeta, enrichGoogle, getEnrichmentStatus };
};
