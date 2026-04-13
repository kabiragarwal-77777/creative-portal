// ============================================================
// CREATIVE INTELLIGENCE ROUTES — creative-intelligence/routes.js
// Express Router for CI pipeline, dashboard, actions, snapshots,
// trends, and analysis endpoints.
// ============================================================

let express;
try { express = require('express'); } catch (e) { express = require('../uploader/node_modules/express'); }

function ok(data) {
    return { success: true, data, error: null, timestamp: new Date().toISOString() };
}
function fail(err) {
    return { success: false, data: null, error: err.message || String(err), timestamp: new Date().toISOString() };
}

function safeJson(str) {
    if (!str) return null;
    if (typeof str === 'object') return str;
    try { return JSON.parse(str); } catch { return str; }
}

module.exports = function (config) {
    const router = express.Router();

    // Initialize engine
    const engine = require('./engine')(config);
    const roasSimulatorV2 = require('./roasSimulatorV2')(config);
    const { getCiDb } = require('./db');

    // Start scheduler automatically
    const intervalHours = parseInt(process.env.CI_REFRESH_HOURS || '24');
    engine.startScheduler(intervalHours);

    // Start campaign sync scheduler (validates Meta ads exist, marks ghosts)
    const { startSyncScheduler, getSyncStatus, validateCampaignSync, ensureGhostColumns } = require('./campaignSync');
    ensureGhostColumns(); // ensure columns exist before any queries run
    const syncIntervalHours = parseInt(process.env.CI_SYNC_HOURS || '24');
    startSyncScheduler(config, syncIntervalHours);

    // ==================== PIPELINE ====================

    // POST /pipeline/run — Trigger full pipeline (returns immediately)
    router.post('/pipeline/run', async (req, res) => {
        try {
            const dateFrom = req.body.dateFrom || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
            const dateTo = req.body.dateTo || new Date().toISOString().slice(0, 10);
            // Don't await — run in background
            const runPromise = engine.runFullPipeline({ dateFrom, dateTo, stages: req.body.stages });
            runPromise.catch(err => console.error('[CI Pipeline] Error:', err.message));
            res.json(ok({ status: 'started', dateFrom, dateTo }));
        } catch (err) {
            console.error('[CI] pipeline/run error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // GET /pipeline/status — Get pipeline status
    router.get('/pipeline/status', (req, res) => {
        try {
            const db = getCiDb();
            const schedulerStatus = engine.getSchedulerStatus ? engine.getSchedulerStatus() : { running: false, lastRun: null, nextRun: null };
            const lastPipeline = db.prepare(`
                SELECT run_type, status, started_at, completed_at, details
                FROM pipeline_runs ORDER BY started_at DESC LIMIT 1
            `).get() || null;
            if (lastPipeline && lastPipeline.details) lastPipeline.details = safeJson(lastPipeline.details);
            res.json(ok({ scheduler: schedulerStatus, lastPipeline }));
        } catch (err) {
            console.error('[CI] pipeline/status error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // ==================== DASHBOARD ====================

    // GET /dashboard — Main dashboard data (fast, all from DB)
    router.get('/dashboard', (req, res) => {
        try {
            const db = getCiDb();

            // 1. Latest snapshots sorted by spend desc (exclude ghosts)
            const snapshots = db.prepare(`
                SELECT * FROM snapshots
                WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM snapshots)
                  AND (is_ghost != 1 OR is_ghost IS NULL)
                ORDER BY spend DESC
            `).all();

            // 2. Active actions grouped by type (exclude ghosts)
            const actions = db.prepare(`
                SELECT * FROM actions WHERE is_active = 1 AND (is_ghost != 1 OR is_ghost IS NULL) ORDER BY created_at DESC
            `).all().map(a => ({
                ...a,
                reasons: safeJson(a.reasons),
                metrics_snapshot: safeJson(a.metrics_snapshot)
            }));
            const actionsByType = { SCALE: [], PAUSE: [], WATCH: [], KILL: [] };
            for (const a of actions) {
                if (actionsByType[a.action_type]) actionsByType[a.action_type].push(a);
                else actionsByType[a.action_type] = [a];
            }

            // 3. Action counts (exclude ghosts)
            const actionCounts = db.prepare(`
                SELECT action_type, COUNT(*) as count FROM actions
                WHERE is_active = 1 AND (is_ghost != 1 OR is_ghost IS NULL) GROUP BY action_type
            `).all().reduce((acc, r) => { acc[r.action_type] = r.count; return acc; }, {});

            // 4. Top 10 performers by d6_roas (spend > 500, exclude ghosts)
            const topPerformers = db.prepare(`
                SELECT * FROM snapshots
                WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM snapshots) AND spend > 500
                  AND (is_ghost != 1 OR is_ghost IS NULL)
                ORDER BY d6_roas DESC LIMIT 10
            `).all();

            // 5. Bottom 10 performers by d6_roas (spend > 500, exclude ghosts)
            const bottomPerformers = db.prepare(`
                SELECT * FROM snapshots
                WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM snapshots) AND spend > 500
                  AND (is_ghost != 1 OR is_ghost IS NULL)
                ORDER BY d6_roas ASC LIMIT 10
            `).all();

            // 6. Trend alerts: declining d6_roas with pct_change < -15 (exclude ghosts)
            const trendAlerts = db.prepare(`
                SELECT * FROM trends
                WHERE metric_name = 'd6_roas' AND period = '7d' AND direction = 'declining' AND pct_change < -15
                  AND (is_ghost != 1 OR is_ghost IS NULL)
                ORDER BY pct_change ASC
            `).all();

            // 7. Latest analysis summary
            const latestAnalysis = db.prepare(`
                SELECT * FROM analyses ORDER BY analyzed_at DESC LIMIT 1
            `).get() || null;
            if (latestAnalysis && latestAnalysis.result) latestAnalysis.result = safeJson(latestAnalysis.result);

            // 8. Pipeline status
            const lastCollection = db.prepare(`
                SELECT started_at FROM pipeline_runs WHERE run_type = 'collect' AND status = 'success'
                ORDER BY started_at DESC LIMIT 1
            `).get();
            const lastAnalysisRun = db.prepare(`
                SELECT started_at FROM pipeline_runs WHERE run_type = 'analyze' AND status = 'success'
                ORDER BY started_at DESC LIMIT 1
            `).get();
            const pipelineStatus = {
                lastCollectionTime: lastCollection ? lastCollection.started_at : null,
                lastAnalysisTime: lastAnalysisRun ? lastAnalysisRun.started_at : null
            };

            // 9. Winner/loser patterns
            const winnerLoserPatterns = engine.getWinnerLoserPatterns ? engine.getWinnerLoserPatterns() : null;

            // 10. Latest predictions for new ads
            let predictions = [];
            let predictionAccuracy = null;
            try {
                predictions = db.prepare(`
                    SELECT * FROM predictions WHERE is_latest = 1 ORDER BY predicted_at DESC LIMIT 20
                `).all().map(p => ({ ...p, gpt_qualitative: safeJson(p.gpt_qualitative) }));

                // 11. Prediction accuracy summary
                predictionAccuracy = db.prepare(`
                    SELECT COUNT(*) as total, COUNT(actual_d6_roas) as verified,
                        CASE WHEN COUNT(actual_d6_roas) > 0 THEN ROUND(AVG(d6_accuracy_pct), 1) ELSE NULL END as avg_error
                    FROM predictions WHERE is_latest = 1
                `).get();
            } catch (predErr) {
                // predictions table may not exist yet — that's fine
            }

            // 12. Portfolio totals (exclude ghosts)
            const totals = db.prepare(`
                SELECT
                    SUM(spend) as total_spend,
                    SUM(installs) as total_installs,
                    SUM(signups) as total_signups,
                    SUM(d6) as total_d6,
                    CASE WHEN SUM(installs) > 0 THEN SUM(spend) / SUM(installs) ELSE 0 END as blended_cpi,
                    CASE WHEN SUM(spend) > 0 THEN SUM(d6_overall_revenue) / SUM(spend) * 100 ELSE 0 END as blended_d6_roas,
                    CASE WHEN SUM(spend) > 0 THEN SUM(overall_revenue) / SUM(spend) * 100 ELSE 0 END as blended_overall_roas
                FROM snapshots
                WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM snapshots)
                  AND (is_ghost != 1 OR is_ghost IS NULL)
            `).get() || {};

            res.json(ok({
                snapshots,
                actionsByType,
                actionCounts,
                topPerformers,
                bottomPerformers,
                trendAlerts,
                latestAnalysis,
                pipelineStatus,
                winnerLoserPatterns,
                portfolioTotals: {
                    total_spend: totals.total_spend || 0,
                    total_installs: totals.total_installs || 0,
                    total_signups: totals.total_signups || 0,
                    total_d6: totals.total_d6 || 0,
                    blended_cpi: Math.round((totals.blended_cpi || 0) * 100) / 100,
                    blended_d6_roas: Math.round((totals.blended_d6_roas || 0) * 100) / 100,
                    blended_overall_roas: Math.round((totals.blended_overall_roas || 0) * 100) / 100
                },
                predictions,
                predictionAccuracy,
            }));
        } catch (err) {
            console.error('[CI] dashboard error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // ==================== ACTIONS ====================

    // GET /actions — Active actions with optional filters
    router.get('/actions', (req, res) => {
        try {
            const db = getCiDb();
            let query = `SELECT * FROM actions WHERE (is_ghost != 1 OR is_ghost IS NULL)`;
            const params = [];

            if (req.query.type) { query += ` AND action_type = ?`; params.push(req.query.type); }
            if (req.query.acknowledged !== undefined) { query += ` AND acknowledged = ?`; params.push(parseInt(req.query.acknowledged)); }
            if (!req.query.type && req.query.acknowledged === undefined) { query += ` AND status = 'active'`; }

            query += ` ORDER BY created_at DESC`;

            const actions = db.prepare(query).all(...params).map(a => ({
                ...a,
                reasons: safeJson(a.reasons),
                metrics_snapshot: safeJson(a.metrics_snapshot)
            }));
            res.json(ok(actions));
        } catch (err) {
            console.error('[CI] actions error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // POST /actions/:id/acknowledge — Mark action as seen
    router.post('/actions/:id/acknowledge', (req, res) => {
        try {
            const db = getCiDb();
            const result = db.prepare(`UPDATE actions SET acknowledged = 1 WHERE id = ?`).run(req.params.id);
            if (result.changes === 0) return res.status(404).json(fail({ message: 'Action not found' }));
            res.json(ok({ id: parseInt(req.params.id), acknowledged: 1 }));
        } catch (err) {
            console.error('[CI] actions/acknowledge error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // ==================== SNAPSHOTS ====================

    // GET /snapshots — List snapshots with filters
    router.get('/snapshots', (req, res) => {
        try {
            const db = getCiDb();
            const limit = parseInt(req.query.limit) || 100;

            let snapshots;
            if (req.query.date) {
                snapshots = db.prepare(`SELECT * FROM snapshots WHERE snapshot_date = ? AND (is_ghost != 1 OR is_ghost IS NULL) ORDER BY spend DESC LIMIT ?`).all(req.query.date, limit);
            } else {
                snapshots = db.prepare(`
                    SELECT * FROM snapshots
                    WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM snapshots)
                      AND (is_ghost != 1 OR is_ghost IS NULL)
                    ORDER BY spend DESC LIMIT ?
                `).all(limit);
            }
            res.json(ok(snapshots));
        } catch (err) {
            console.error('[CI] snapshots error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // GET /snapshots/:adId/history — Time-series for specific ad
    router.get('/snapshots/:adId/history', (req, res) => {
        try {
            const db = getCiDb();
            const snapshots = db.prepare(`
                SELECT * FROM snapshots WHERE ad_id = ? ORDER BY snapshot_date ASC
            `).all(req.params.adId);

            const trends = db.prepare(`
                SELECT * FROM trends WHERE ad_id = ? ORDER BY computed_at DESC
            `).all(req.params.adId);

            res.json(ok({ snapshots, trends }));
        } catch (err) {
            console.error('[CI] snapshots/history error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // ==================== TRENDS ====================

    // GET /trends — Current trends (exclude ghosts)
    router.get('/trends', (req, res) => {
        try {
            const db = getCiDb();
            let query = `SELECT * FROM trends WHERE (is_ghost != 1 OR is_ghost IS NULL)`;
            const params = [];

            if (req.query.direction) { query += ` AND direction = ?`; params.push(req.query.direction); }
            if (req.query.metric) { query += ` AND metric_name = ?`; params.push(req.query.metric); }

            query += ` ORDER BY computed_at DESC`;

            const trends = db.prepare(query).all(...params);

            // Group by ad
            const grouped = {};
            for (const t of trends) {
                if (!grouped[t.ad_id]) grouped[t.ad_id] = { ad_id: t.ad_id, ad_name: t.ad_name, trends: [] };
                grouped[t.ad_id].trends.push(t);
            }

            res.json(ok(Object.values(grouped)));
        } catch (err) {
            console.error('[CI] trends error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // ==================== ANALYSES ====================

    // GET /analyses/latest — Most recent stored analysis
    router.get('/analyses/latest', (req, res) => {
        try {
            const db = getCiDb();
            const analysis = db.prepare(`SELECT * FROM analyses ORDER BY analyzed_at DESC LIMIT 1`).get() || null;
            if (analysis && analysis.result) analysis.result = safeJson(analysis.result);
            res.json(ok(analysis));
        } catch (err) {
            console.error('[CI] analyses/latest error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // POST /analyze — Trigger GPT analysis only
    router.post('/analyze', async (req, res) => {
        try {
            const dateFrom = req.body.dateFrom || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
            const dateTo = req.body.dateTo || new Date().toISOString().slice(0, 10);
            console.log('[CI] Running GPT analysis for', dateFrom, 'to', dateTo);
            const result = await engine.runGptAnalysis({ dateFrom, dateTo });
            res.json(ok(result));
        } catch (err) {
            console.error('[CI] analyze error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // ==================== PREDICTIONS ====================

    // GET /predictions/accuracy — Accuracy report (must be before :adId)
    router.get('/predictions/accuracy', (req, res) => {
        try {
            const db = getCiDb();
            // Overall accuracy stats
            const stats = db.prepare(`
                SELECT
                    COUNT(*) as total_predictions,
                    COUNT(actual_d6_roas) as verified_d6,
                    CASE WHEN COUNT(actual_d6_roas) > 0 THEN AVG(d6_accuracy_pct) ELSE NULL END as avg_d6_error,
                    COUNT(actual_d30_roas) as verified_d30,
                    CASE WHEN COUNT(actual_d30_roas) > 0 THEN AVG(d30_accuracy_pct) ELSE NULL END as avg_d30_error
                FROM predictions WHERE is_latest = 1
            `).get();

            // Per-cohort accuracy
            const byCohort = db.prepare(`
                SELECT cohort_key, COUNT(*) as count,
                    AVG(d6_accuracy_pct) as avg_d6_error,
                    AVG(confidence_score) as avg_confidence
                FROM predictions WHERE is_latest = 1 AND actual_d6_roas IS NOT NULL
                GROUP BY cohort_key
            `).all();

            // Recent predictions with actuals
            const recent = db.prepare(`
                SELECT ad_name, predicted_d6_roas, actual_d6_roas, d6_accuracy_pct,
                       predicted_d30_roas, actual_d30_roas, trajectory, cohort_key
                FROM predictions WHERE is_latest = 1 AND actual_d6_roas IS NOT NULL
                ORDER BY predicted_at DESC LIMIT 20
            `).all();

            res.json(ok({ stats, byCohort, recent }));
        } catch (err) {
            console.error('[CI] predictions/accuracy error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // GET /predictions — List latest predictions
    router.get('/predictions', (req, res) => {
        try {
            const db = getCiDb();
            let query = 'SELECT * FROM predictions WHERE is_latest = 1';
            const params = [];
            if (req.query.trajectory) { query += ' AND trajectory = ?'; params.push(req.query.trajectory); }
            if (req.query.cohort) { query += ' AND cohort_key = ?'; params.push(req.query.cohort); }
            query += ' ORDER BY predicted_at DESC';
            const predictions = db.prepare(query).all(...params).map(p => ({
                ...p,
                gpt_qualitative: safeJson(p.gpt_qualitative)
            }));
            res.json(ok(predictions));
        } catch (err) {
            console.error('[CI] predictions error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // GET /predictions/:adId — Get prediction for specific ad
    router.get('/predictions/:adId', (req, res) => {
        try {
            const db = getCiDb();
            const predictions = db.prepare('SELECT * FROM predictions WHERE ad_id = ? ORDER BY predicted_at DESC').all(req.params.adId);
            predictions.forEach(p => { p.gpt_qualitative = safeJson(p.gpt_qualitative); });
            const latest = predictions.find(p => p.is_latest === 1) || predictions[0] || null;
            res.json(ok({ latest, history: predictions }));
        } catch (err) {
            console.error('[CI] predictions/:adId error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // POST /predictions/run — Manually trigger predictions
    router.post('/predictions/run', async (req, res) => {
        try {
            // First rebuild cohorts, then predict
            const cohortResult = engine.buildCohortBenchmarks();
            const predResult = await engine.detectAndPredictNewAds();
            res.json(ok({ cohorts: cohortResult, predictions: predResult }));
        } catch (err) {
            console.error('[CI] predictions/run error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // GET /cohorts — List cohort benchmarks
    router.get('/cohorts', (req, res) => {
        try {
            const db = getCiDb();
            const cohorts = db.prepare('SELECT * FROM cohort_benchmarks ORDER BY sample_size DESC').all();
            res.json(ok(cohorts));
        } catch (err) {
            console.error('[CI] cohorts error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // POST /cohorts/rebuild — Rebuild cohort benchmarks
    router.post('/cohorts/rebuild', (req, res) => {
        try {
            const result = engine.buildCohortBenchmarks();
            res.json(ok(result));
        } catch (err) {
            console.error('[CI] cohorts/rebuild error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // ==================== ROAS TRACKER ====================

    // Start the ROAS tracker scheduler (every 4 hours)
    const roasTrackerHours = parseInt(process.env.ROAS_TRACKER_HOURS || '1');
    engine.startRoasTrackerScheduler(roasTrackerHours);

    // Keep frozen checkpoint runs in sync from stored snapshots.
    const roasSimulatorMinutes = parseInt(process.env.ROAS_SIMULATOR_CHECKPOINT_MINUTES || '15');
    roasSimulatorV2.startScheduler(roasSimulatorMinutes);

    // GET /roas-tracker/dashboard — main data for the frontend
    router.get('/roas-tracker/dashboard', (req, res) => {
        try {
            const db = getCiDb();
            const {
                getRoasTrackerAds, getRoasTrackerStats,
            } = require('./db');

            const stats = getRoasTrackerStats();
            const ads = getRoasTrackerAds();

            // Enrich with live/paused status from ads-status disk cache
            try {
                const fs = require('fs');
                const path = require('path');
                const statusFile = path.join(__dirname, 'ads-status-cache.json');
                if (fs.existsSync(statusFile)) {
                    const diskCache = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
                    const statusMap = {};
                    (diskCache.data || []).forEach(a => { statusMap[a.ad_id] = a.status; });
                    ads.forEach(ad => {
                        ad.meta_status = statusMap[ad.ad_id] || 'UNKNOWN';
                    });
                }
            } catch(e) { /* status unavailable */ }

            res.json(ok({ summary: stats, ads }));
        } catch (err) {
            console.error('[CI] roas-tracker/dashboard error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // GET /roas-tracker/trendline/:adId — daily time-series for one ad
    router.get('/roas-tracker/trendline/:adId', (req, res) => {
        try {
            const { getRoasTrackerTrendline } = require('./db');
            const data = getRoasTrackerTrendline(req.params.adId);
            if (!data) return res.status(404).json(fail({ message: 'Ad not found in tracker' }));
            res.json(ok(data));
        } catch (err) {
            console.error('[CI] roas-tracker/trendline error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // POST /roas-tracker/refresh — manually trigger snapshot + predict
    router.post('/roas-tracker/refresh', async (req, res) => {
        try {
            const result = await engine.snapshotAndTrackLiveAds(true); // forceRefresh = bypass cache
            res.json(ok(result));
        } catch (err) {
            console.error('[CI] roas-tracker/refresh error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // ==================== ROAS SIMULATOR V2 ====================

    router.get('/roas-simulator/dashboard', async (req, res) => {
        try {
            if (roasSimulatorV2.ensureCheckpointRuns) {
                await roasSimulatorV2.ensureCheckpointRuns(false);
            }
            const data = roasSimulatorV2.getDashboardData();

            try {
                const fs = require('fs');
                const path = require('path');
                const statusFile = path.join(__dirname, 'ads-status-cache.json');
                if (fs.existsSync(statusFile)) {
                    const diskCache = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
                    const statusMap = {};
                    (diskCache.data || []).forEach(ad => { statusMap[ad.ad_id] = ad.status; });
                    (data.ads || []).forEach(ad => {
                        ad.meta_status = statusMap[ad.ad_id] || 'UNKNOWN';
                    });
                }
            } catch (statusErr) {
                console.warn('[CI] roas-simulator/dashboard status enrichment warning:', statusErr.message);
            }

            res.json(ok(data));
        } catch (err) {
            console.error('[CI] roas-simulator/dashboard error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    router.get('/roas-simulator/trendline/:adId', async (req, res) => {
        try {
            if (roasSimulatorV2.ensureCheckpointRunsForAd) {
                await roasSimulatorV2.ensureCheckpointRunsForAd(req.params.adId);
            }
            const data = roasSimulatorV2.getTrendlineData(req.params.adId);
            if (!data) return res.status(404).json(fail({ message: 'Ad not found in simulator' }));
            res.json(ok(data));
        } catch (err) {
            console.error('[CI] roas-simulator/trendline error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    router.post('/roas-simulator/refresh', async (req, res) => {
        try {
            const runRefresh = Promise.allSettled([
                engine.snapshotAndTrackLiveAds(true),
                roasSimulatorV2.ensureCheckpointRuns(true)
            ]).then(([snapshotsResult, checkpointsResult]) => {
                if (snapshotsResult.status === 'rejected') {
                    console.error('[CI] roas-simulator/refresh snapshot error:', snapshotsResult.reason && snapshotsResult.reason.message ? snapshotsResult.reason.message : snapshotsResult.reason);
                }
                if (checkpointsResult.status === 'rejected') {
                    console.error('[CI] roas-simulator/refresh checkpoint error:', checkpointsResult.reason && checkpointsResult.reason.message ? checkpointsResult.reason.message : checkpointsResult.reason);
                }
            });
            runRefresh.catch(err => console.error('[CI] roas-simulator/refresh async error:', err.message));
            res.status(202).json(ok({ queued: true, message: 'Refresh started in background' }));
        } catch (err) {
            console.error('[CI] roas-simulator/refresh error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // ==================== SYNC VALIDATOR ====================

    // GET /sync/issues — Returns sync status, ghost counts, history
    router.get('/sync/issues', (req, res) => {
        try {
            const status = getSyncStatus();
            res.json(ok(status));
        } catch (err) {
            console.error('[CI] sync/issues error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // POST /sync/run — Manually trigger sync validation
    router.post('/sync/run', async (req, res) => {
        try {
            const result = await validateCampaignSync(config);
            res.json(ok(result));
        } catch (err) {
            console.error('[CI] sync/run error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // ==================== DATA INTEGRITY ====================

    const { startIntegrityScheduler, getIntegrityStatus, runIntegrityTests } = require('./integrityTests');

    // Start integrity tests scheduler (runs on start + every 6 hours)
    startIntegrityScheduler(config);

    // GET /integrity/results — Full integrity test results
    router.get('/integrity/results', (req, res) => {
        try {
            const fs = require('fs');
            const path = require('path');
            const resultsFile = path.join(__dirname, '..', 'data_integrity_results.json');
            if (fs.existsSync(resultsFile)) {
                const data = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
                res.json(ok(data));
            } else {
                res.json(ok({ status: 'PENDING', message: 'Tests have not run yet' }));
            }
        } catch (err) {
            console.error('[CI] integrity/results error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // GET /integrity/status — Quick status for dashboard header
    router.get('/integrity/status', (req, res) => {
        try {
            res.json(ok(getIntegrityStatus()));
        } catch (err) {
            console.error('[CI] integrity/status error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    // POST /integrity/run — Manually trigger integrity tests
    router.post('/integrity/run', async (req, res) => {
        try {
            const results = await runIntegrityTests(config);
            res.json(ok(results));
        } catch (err) {
            console.error('[CI] integrity/run error:', err.message);
            res.status(500).json(fail(err));
        }
    });

    return router;
};
