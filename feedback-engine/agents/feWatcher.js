// =============================================================================
// Feedback Engine — Performance Watcher Agent
// Monitors prediction accuracy delta between predicted and actual ROAS
// =============================================================================

const path = require('path');
const axios = require('axios');
const { getFeDb, insert, update, getAll, count, query, run, logSchedulerStart, logSchedulerEnd } = require('../db/fe-db');

const METABASE_URL = process.env.METABASE_URL || 'https://analytics.univest.in';
const METABASE_SESSION = process.env.METABASE_SESSION_TOKEN;

const CI_DB_PATH = path.resolve(__dirname, '../../creative-intelligence/ci.db');
const GC_DB_PATH = path.resolve(__dirname, '../../google-creative/google-creative.db');

module.exports = function (config) {

    // ── Open external DB read-only, return null if missing ──
    async function openExternalDb(dbPath) {
        try {
            const createDb = require('../lib/duckdb-adapter').createDb;
            return await createDb(dbPath);
        } catch (err) {
            console.log(`[FE:Watcher] Cannot open ${dbPath}: ${err.message}`);
            return null;
        }
    }

    // ── Metabase query helper ──
    async function queryMetabase(sql) {
        if (!METABASE_SESSION) {
            console.log('[FE:Watcher] No METABASE_SESSION_TOKEN, skipping Metabase query');
            return null;
        }
        try {
            const resp = await axios.post(`${METABASE_URL}/api/dataset`, {
                database: 1,
                type: 'native',
                native: { query: sql }
            }, {
                headers: { 'X-Metabase-Session': METABASE_SESSION },
                timeout: 30000
            });
            const cols = resp.data.data.cols.map(c => c.name);
            return resp.data.data.rows.map(row => {
                const obj = {};
                cols.forEach((c, i) => { obj[c] = row[i]; });
                return obj;
            });
        } catch (err) {
            console.error('[FE:Watcher] Metabase query failed:', err.message);
            return null;
        }
    }

    // ── Tag accuracy based on error % ──
    function tagAccuracy(errorPct) {
        if (errorPct === null || errorPct === undefined) return null;
        if (errorPct < -15) return 'overestimate';
        if (errorPct > 15) return 'underestimate';
        return 'accurate';
    }

    // ── Compute error % ──
    function computeError(predicted, actual) {
        if (predicted === null || predicted === undefined || actual === null || actual === undefined) return null;
        if (predicted === 0) return actual === 0 ? 0 : 100;
        return ((actual - predicted) / Math.abs(predicted)) * 100;
    }

    // ── 1. Refresh Meta Predictions ──
    // Reads from CI `predictions` table (has predicted + actual ROAS columns)
    async function refreshMetaPredictions() {
        console.log('[FE:Watcher] Refreshing Meta prediction accuracy...');
        const ciDb = await openExternalDb(CI_DB_PATH);
        if (!ciDb) return { processed: 0, skipped: 0 };

        let processed = 0;
        let skipped = 0;

        try {
            // Read from predictions table — it has both predicted and actual columns
            let predictions = [];
            try {
                predictions = await ciDb.prepare(
                    `SELECT id, ad_id, ad_name, predicted_d6_roas, predicted_d30_roas, predicted_d60_roas,
                            actual_d6_roas, actual_d30_roas, actual_d60_roas,
                            d6_accuracy_pct, d30_accuracy_pct, predicted_at
                     FROM predictions
                     WHERE predicted_d6_roas IS NOT NULL
                     ORDER BY id DESC`
                ).all();
            } catch (err) {
                console.log('[FE:Watcher] predictions table error:', err.message);
                return { processed: 0, skipped: 0 };
            }

            for (const pred of predictions) {
                try {
                    // Check if already tracked
                    const existing = await query(
                        `SELECT id FROM fe_prediction_accuracy WHERE source = 'meta' AND simulation_id = ?`,
                        [String(pred.id)]
                    );
                    if (existing.length > 0) { skipped++; continue; }

                    // Use actuals from the predictions table directly (already computed by CI engine)
                    const predictedD7 = pred.predicted_d6_roas; // CI uses d6 as primary window
                    const predictedD30 = pred.predicted_d30_roas;
                    const predictedD60 = pred.predicted_d60_roas;
                    const actualD7 = pred.actual_d6_roas;
                    const actualD30 = pred.actual_d30_roas;
                    const actualD60 = pred.actual_d60_roas;

                    const errorD7 = computeError(predictedD7, actualD7);
                    const errorD30 = computeError(predictedD30, actualD30);
                    const errorD60 = computeError(predictedD60, actualD60);
                    const primaryError = errorD7 !== null ? errorD7 : (errorD30 !== null ? errorD30 : errorD60);
                    const tag = tagAccuracy(primaryError);

                    await insert('fe_prediction_accuracy', {
                        source: 'meta',
                        simulation_id: String(pred.id),
                        ad_id: String(pred.ad_id),
                        ad_name: pred.ad_name || null,
                        predicted_roas_d7: predictedD7,
                        predicted_roas_d30: predictedD30,
                        predicted_roas_d60: predictedD60,
                        actual_roas_d7: actualD7,
                        actual_roas_d30: actualD30,
                        actual_roas_d60: actualD60,
                        error_d7: errorD7 !== null ? Math.round(errorD7 * 100) / 100 : null,
                        error_d30: errorD30 !== null ? Math.round(errorD30 * 100) / 100 : null,
                        error_d60: errorD60 !== null ? Math.round(errorD60 * 100) / 100 : null,
                        accuracy_tag: tag,
                        checked_at: new Date().toISOString()
                    });
                    processed++;
                } catch (err) {
                    console.error(`[FE:Watcher] Error processing Meta prediction ${pred.id}:`, err.message);
                    skipped++;
                }
            }
        } catch (err) {
            console.error('[FE:Watcher] Meta predictions error:', err.message);
        }

        console.log(`[FE:Watcher] Meta predictions: ${processed} processed, ${skipped} skipped`);
        return { processed, skipped };
    }

    // ── 2. Refresh Google Predictions ──
    // Reads from gc_simulations + gc_forecast_timeseries for actuals
    async function refreshGooglePredictions() {
        console.log('[FE:Watcher] Refreshing Google prediction accuracy...');
        const gcDb = await openExternalDb(GC_DB_PATH);
        if (!gcDb) return { processed: 0, skipped: 0 };

        let processed = 0;
        let skipped = 0;

        try {
            let sims = [];
            try {
                sims = await gcDb.prepare(
                    `SELECT id, ad_type, predicted_d7_roas, predicted_d30_roas, predicted_d60_roas,
                            campaign_id, adgroup_id, simulated_at
                     FROM gc_simulations
                     WHERE predicted_d7_roas IS NOT NULL
                     ORDER BY id DESC`
                ).all();
            } catch (err) {
                console.log('[FE:Watcher] gc_simulations query error:', err.message);
                return { processed: 0, skipped: 0 };
            }

            for (const sim of sims) {
                try {
                    const existing = await query(
                        `SELECT id FROM fe_prediction_accuracy WHERE source = 'google' AND simulation_id = ?`,
                        [String(sim.id)]
                    );
                    if (existing.length > 0) { skipped++; continue; }

                    // Try to get actuals from gc_forecast_timeseries
                    let actualD7 = null, actualD30 = null, actualD60 = null;
                    try {
                        const forecasts = await gcDb.prepare(
                            `SELECT day_number, actual_roas FROM gc_forecast_timeseries
                             WHERE simulation_id = ? AND actual_roas IS NOT NULL
                             ORDER BY day_number`
                        ).all(sim.id);
                        for (const f of forecasts) {
                            if (f.day_number <= 7) actualD7 = f.actual_roas;
                            if (f.day_number <= 30) actualD30 = f.actual_roas;
                            if (f.day_number <= 60) actualD60 = f.actual_roas;
                        }
                    } catch (e) { /* forecast table may not have data */ }

                    const errorD7 = computeError(sim.predicted_d7_roas, actualD7);
                    const errorD30 = computeError(sim.predicted_d30_roas, actualD30);
                    const errorD60 = computeError(sim.predicted_d60_roas, actualD60);
                    const primaryError = errorD7 !== null ? errorD7 : (errorD30 !== null ? errorD30 : errorD60);
                    const tag = tagAccuracy(primaryError);

                    await insert('fe_prediction_accuracy', {
                        source: 'google',
                        simulation_id: String(sim.id),
                        ad_id: sim.campaign_id ? `gc-${sim.campaign_id}-${sim.id}` : `gc-${sim.id}`,
                        ad_name: sim.ad_type || null,
                        predicted_roas_d7: sim.predicted_d7_roas,
                        predicted_roas_d30: sim.predicted_d30_roas,
                        predicted_roas_d60: sim.predicted_d60_roas,
                        actual_roas_d7: actualD7,
                        actual_roas_d30: actualD30,
                        actual_roas_d60: actualD60,
                        error_d7: errorD7 !== null ? Math.round(errorD7 * 100) / 100 : null,
                        error_d30: errorD30 !== null ? Math.round(errorD30 * 100) / 100 : null,
                        error_d60: errorD60 !== null ? Math.round(errorD60 * 100) / 100 : null,
                        accuracy_tag: tag,
                        checked_at: new Date().toISOString()
                    });
                    processed++;
                } catch (err) {
                    console.error(`[FE:Watcher] Error processing Google sim ${sim.id}:`, err.message);
                    skipped++;
                }
            }
        } catch (err) {
            console.error('[FE:Watcher] Google predictions error:', err.message);
        }

        console.log(`[FE:Watcher] Google predictions: ${processed} processed, ${skipped} skipped`);
        return { processed, skipped };
    }

    // ── 3. Refresh Recommendation Tracking ──
    async function refreshRecommendationTracking() {
        console.log('[FE:Watcher] Refreshing recommendation tracking...');
        let processed = 0;

        // -- Meta recommendations --
        const ciDb = await openExternalDb(CI_DB_PATH);
        if (ciDb) {
            try {
                let recs = [];
                try {
                    recs = await ciDb.prepare(`SELECT * FROM ci_recommendations WHERE created_at IS NOT NULL`).all();
                } catch (err) {
                    console.log('[FE:Watcher] ci_recommendations not found:', err.message);
                }

                for (const rec of recs) {
                    try {
                        const existing = await query(
                            `SELECT id FROM fe_recommendation_tracking WHERE source = 'meta' AND brief_id = ?`,
                            [String(rec.id)]
                        );
                        if (existing.length > 0) continue;

                        // Adoption heuristic: check if a new ad with similar theme appeared within 14 days
                        const theme = rec.theme || rec.brief_theme || rec.title || '';
                        let adoptionStatus = 'unknown';
                        let evidenceAdId = null;

                        if (theme) {
                            const fourteenDaysLater = new Date(
                                new Date(rec.created_at).getTime() + 14 * 24 * 60 * 60 * 1000
                            ).toISOString();

                            const matchingAds = await queryMetabase(`
                                SELECT ad_id, ad_name FROM meta_ads
                                WHERE created_time > '${rec.created_at}'
                                  AND created_time < '${fourteenDaysLater}'
                                  AND (LOWER(ad_name) LIKE '%${theme.toLowerCase().replace(/'/g, "''").substring(0, 30)}%'
                                       OR LOWER(ad_body) LIKE '%${theme.toLowerCase().replace(/'/g, "''").substring(0, 30)}%')
                                LIMIT 1
                            `);

                            if (matchingAds && matchingAds.length > 0) {
                                adoptionStatus = 'adopted';
                                evidenceAdId = matchingAds[0].ad_id;
                            } else if (new Date() > new Date(fourteenDaysLater)) {
                                adoptionStatus = 'ignored';
                            }
                        }

                        await insert('fe_recommendation_tracking', {
                            source: 'meta',
                            brief_id: String(rec.id),
                            brief_type: rec.type || rec.brief_type || 'creative',
                            brief_theme: theme,
                            generated_at: rec.created_at,
                            adoption_status: adoptionStatus,
                            evidence_ad_id: evidenceAdId,
                            checked_at: new Date().toISOString()
                        });
                        processed++;
                    } catch (err) {
                        console.error(`[FE:Watcher] Error tracking Meta rec ${rec.id}:`, err.message);
                    }
                }
            } catch (err) {
                console.error('[FE:Watcher] Meta recommendations error:', err.message);
            }
        }

        // -- Google recommendations --
        const gcDb = await openExternalDb(GC_DB_PATH);
        if (gcDb) {
            try {
                let recs = [];
                try {
                    recs = await gcDb.prepare(`SELECT * FROM gc_recommendations WHERE generated_at IS NOT NULL`).all();
                } catch (err) {
                    console.log('[FE:Watcher] gc_recommendations not found:', err.message);
                }

                for (const rec of recs) {
                    try {
                        const existing = await query(
                            `SELECT id FROM fe_recommendation_tracking WHERE source = 'google' AND brief_id = ?`,
                            [String(rec.id)]
                        );
                        if (existing.length > 0) continue;

                        const recDate = rec.generated_at || rec.created_at;
                        const theme = rec.theme || rec.brief_theme || rec.brief_type || '';
                        let adoptionStatus = 'unknown';
                        let evidenceAdId = null;

                        if (theme && recDate) {
                            const fourteenDaysLater = new Date(
                                new Date(recDate).getTime() + 14 * 24 * 60 * 60 * 1000
                            ).toISOString();

                            if (new Date() > new Date(fourteenDaysLater)) {
                                adoptionStatus = 'ignored'; // Default if past window
                            }
                        }

                        await insert('fe_recommendation_tracking', {
                            source: 'google',
                            brief_id: String(rec.id),
                            brief_type: rec.brief_type || 'creative',
                            brief_theme: theme,
                            generated_at: recDate,
                            adoption_status: adoptionStatus,
                            evidence_ad_id: evidenceAdId,
                            checked_at: new Date().toISOString()
                        });
                        processed++;
                    } catch (err) {
                        console.error(`[FE:Watcher] Error tracking Google rec ${rec.id}:`, err.message);
                    }
                }
            } catch (err) {
                console.error('[FE:Watcher] Google recommendations error:', err.message);
            }
        }

        console.log(`[FE:Watcher] Recommendation tracking: ${processed} processed`);
        return { processed };
    }

    // ── 4. Refresh Competitor Signals ──
    async function refreshCompetitorSignals() {
        console.log('[FE:Watcher] Refreshing competitor signal accuracy...');
        let processed = 0;

        // Try to read competitor radar cache
        let insights = [];
        try {
            const cachePath = path.resolve(__dirname, '../../ai-cache.js');
            const aiCache = require(cachePath);
            if (aiCache && typeof aiCache.getCache === 'function') {
                const cached = aiCache.getCache('competitor-radar');
                if (cached && cached.insights) {
                    insights = cached.insights;
                }
            }
        } catch (err) {
            // Try alternative: read competitor-radar insights from a JSON cache file
            try {
                const fs = require('fs');
                const radarCachePath = path.resolve(__dirname, '../../competitor-radar-cache.json');
                if (fs.existsSync(radarCachePath)) {
                    insights = JSON.parse(fs.readFileSync(radarCachePath, 'utf8'));
                    if (!Array.isArray(insights)) insights = insights.insights || [];
                }
            } catch (innerErr) {
                console.log('[FE:Watcher] No competitor radar cache available:', innerErr.message);
            }
        }

        for (const insight of insights) {
            try {
                const insightId = insight.id || insight.title || String(Date.now());
                const existing = await query(
                    `SELECT id FROM fe_competitor_signal_accuracy WHERE insight_id = ?`,
                    [String(insightId)]
                );
                if (existing.length > 0) continue;

                // Check if opportunity materialized by looking at our CTR changes
                let materialized = 'unknown';
                let ctrBefore = null;
                let ctrAfter = null;

                if (insight.predicted_at || insight.date) {
                    const predDate = insight.predicted_at || insight.date;
                    const verifyDate = new Date(
                        new Date(predDate).getTime() + 14 * 24 * 60 * 60 * 1000
                    ).toISOString();

                    if (new Date() > new Date(verifyDate)) {
                        const ctrData = await queryMetabase(`
                            SELECT
                                AVG(CASE WHEN date < '${predDate}' THEN ctr END) as ctr_before,
                                AVG(CASE WHEN date >= '${predDate}' AND date <= '${verifyDate}' THEN ctr END) as ctr_after
                            FROM meta_ad_performance
                            WHERE date BETWEEN DATE('${predDate}', '-7 days') AND '${verifyDate}'
                        `);

                        if (ctrData && ctrData.length > 0) {
                            ctrBefore = ctrData[0].ctr_before;
                            ctrAfter = ctrData[0].ctr_after;
                            if (ctrBefore !== null && ctrAfter !== null) {
                                materialized = ctrAfter > ctrBefore * 1.05 ? 'true' : 'false';
                            }
                        }
                    }
                }

                await insert('fe_competitor_signal_accuracy', {
                    insight_id: String(insightId),
                    opportunity_type: insight.vertical || insight.type || 'general',
                    predicted_at: insight.predicted_at || insight.date || new Date().toISOString(),
                    verification_date: new Date().toISOString(),
                    materialized: materialized,
                    univest_ctr_before: ctrBefore,
                    univest_ctr_after: ctrAfter,
                    notes: insight.title ? `${insight.title}: ${insight.observation || ''}`.substring(0, 500) : null
                });
                processed++;
            } catch (err) {
                console.error(`[FE:Watcher] Error processing competitor insight:`, err.message);
            }
        }

        console.log(`[FE:Watcher] Competitor signals: ${processed} processed`);
        return { processed };
    }

    // ── 5. Get Summary ──
    async function getSummary() {
        try {
            const total = await count('fe_prediction_accuracy');
            if (total === 0) {
                return {
                    total: 0,
                    accurate_pct: 0,
                    overestimate_pct: 0,
                    underestimate_pct: 0,
                    by_source: { meta: {}, google: {} }
                };
            }

            const accurateCount = await count('fe_prediction_accuracy', { accuracy_tag: 'accurate' });
            const overCount = await count('fe_prediction_accuracy', { accuracy_tag: 'overestimate' });
            const underCount = await count('fe_prediction_accuracy', { accuracy_tag: 'underestimate' });

            // Per-source breakdown
            const sourceBreakdown = {};
            for (const source of ['meta', 'google']) {
                const sTotal = await count('fe_prediction_accuracy', { source });
                if (sTotal === 0) {
                    sourceBreakdown[source] = { total: 0, accurate_pct: 0, overestimate_pct: 0, underestimate_pct: 0 };
                    continue;
                }
                const sRows = await query(
                    `SELECT accuracy_tag, COUNT(*) as cnt FROM fe_prediction_accuracy WHERE source = ? AND accuracy_tag IS NOT NULL GROUP BY accuracy_tag`,
                    [source]
                );
                const tagMap = {};
                sRows.forEach(r => { tagMap[r.accuracy_tag] = r.cnt; });
                sourceBreakdown[source] = {
                    total: sTotal,
                    accurate_pct: Math.round(((tagMap.accurate || 0) / sTotal) * 10000) / 100,
                    overestimate_pct: Math.round(((tagMap.overestimate || 0) / sTotal) * 10000) / 100,
                    underestimate_pct: Math.round(((tagMap.underestimate || 0) / sTotal) * 10000) / 100
                };
            }

            return {
                total,
                accurate_pct: Math.round((accurateCount / total) * 10000) / 100,
                overestimate_pct: Math.round((overCount / total) * 10000) / 100,
                underestimate_pct: Math.round((underCount / total) * 10000) / 100,
                by_source: sourceBreakdown
            };
        } catch (err) {
            console.error('[FE:Watcher] getSummary error:', err.message);
            return { total: 0, error: err.message };
        }
    }

    // ── 6. Get Predictions ──
    async function getPredictions(filters = {}) {
        try {
            const where = {};
            if (filters.source) where.source = filters.source;
            if (filters.accuracy_tag) where.accuracy_tag = filters.accuracy_tag;
            return await getAll('fe_prediction_accuracy', where, 'checked_at DESC', filters.limit || 500);
        } catch (err) {
            console.error('[FE:Watcher] getPredictions error:', err.message);
            return [];
        }
    }

    // ── 7. Refresh All ──
    async function refresh() {
        const logId = await logSchedulerStart('feWatcher.refresh');
        let totalProcessed = 0;
        let errors = [];

        try {
            const metaResult = await refreshMetaPredictions();
            totalProcessed += metaResult.processed;

            const googleResult = await refreshGooglePredictions();
            totalProcessed += googleResult.processed;

            const recResult = await refreshRecommendationTracking();
            totalProcessed += recResult.processed;

            const compResult = await refreshCompetitorSignals();
            totalProcessed += compResult.processed;

            console.log(`[FE:Watcher] Full refresh complete: ${totalProcessed} records processed`);
            await logSchedulerEnd(logId, totalProcessed, errors.length > 0 ? errors.join('; ') : null);
        } catch (err) {
            console.error('[FE:Watcher] refresh() failed:', err.message);
            errors.push(err.message);
            logSchedulerEnd(logId, totalProcessed, errors.join('; '));
        }

        return { totalProcessed, errors };
    }

    return {
        refreshMetaPredictions,
        refreshGooglePredictions,
        refreshRecommendationTracking,
        refreshCompetitorSignals,
        getSummary,
        getPredictions,
        refresh
    };
};
