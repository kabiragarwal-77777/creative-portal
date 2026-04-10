let express;
try { express = require('express'); } catch(e) { express = require('../uploader/node_modules/express'); }

module.exports = function(config) {
    const router = express.Router();

    // config: { metabaseUrl, metabaseSessionToken, openaiApiKey }

    const dataFetcher = require('./agents/gcDataFetcher')(config);
    const classifier = require('./agents/gcClassifier')(config);
    const scoring = require('./agents/gcScoring')(config);
    const signals = require('./agents/gcSignals')(config);
    const simulator = require('./agents/gcSimulator')(config);
    const forecast = require('./agents/gcForecast')(config);
    const recommendations = require('./agents/gcRecommendations')(config);

    // Start scheduler
    require('./agents/gcScheduler')({ dataFetcher, classifier, scoring, signals, recommendations, forecast });

    // ==================== CREATIVES ====================

    // GET /creatives — List all creatives with filters
    router.get('/creatives', (req, res) => {
        try {
            const { getGcDb } = require('./db/gc-db');
            const db = getGcDb();
            const days = parseInt(req.query.days) || 90;
            const type = req.query.type || 'all';
            const performance = req.query.performance || 'all';

            let sql = `SELECT c.*, s.gcps_score, s.score_breakdown_json,
                        sig.signals_json
                        FROM gc_creatives c
                        LEFT JOIN gc_creative_scores s ON s.creative_id = c.id
                        LEFT JOIN gc_creative_signals sig ON sig.creative_id = c.id
                        WHERE c.merged_at >= datetime('now', '-' || ? || ' days')`;
            const params = [days];

            if (type !== 'all') { sql += ` AND c.ad_type = ?`; params.push(type.toUpperCase()); }
            if (performance !== 'all') { sql += ` AND c.asset_performance_label = ?`; params.push(performance.toUpperCase()); }

            sql += ` ORDER BY s.gcps_score DESC NULLS LAST`;

            const rows = db.prepare(sql).all(...params);
            res.json({ success: true, data: rows, total: rows.length });
        } catch(err) {
            console.error('[GC] /creatives error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /adsets — Adset performance
    router.get('/adsets', (req, res) => {
        try {
            const { getGcDb } = require('./db/gc-db');
            const db = getGcDb();
            const days = parseInt(req.query.days) || 30;
            const campaignId = req.query.campaign_id || null;

            let sql = `SELECT campaign_id, campaign_name, adgroup_id, adgroup_name,
                        SUM(spend) AS total_spend,
                        SUM(impressions) AS total_impressions,
                        SUM(clicks) AS total_clicks,
                        SUM(conversions) AS total_conversions,
                        SUM(conversion_value) AS total_conversion_value,
                        CASE WHEN SUM(spend) > 0 THEN SUM(conversion_value) / SUM(spend) ELSE 0 END AS roas,
                        CASE WHEN SUM(impressions) > 0 THEN (CAST(SUM(clicks) AS REAL) / SUM(impressions)) * 100 ELSE 0 END AS ctr,
                        CASE WHEN SUM(clicks) > 0 THEN SUM(spend) / SUM(clicks) ELSE 0 END AS cpc,
                        CASE WHEN SUM(conversions) > 0 THEN SUM(spend) / SUM(conversions) ELSE 0 END AS cpa
                        FROM gc_adset_performance
                        WHERE date >= date('now', '-' || ? || ' days')`;
            const params = [days];

            if (campaignId) { sql += ` AND campaign_id = ?`; params.push(campaignId); }

            sql += ` GROUP BY campaign_id, campaign_name, adgroup_id, adgroup_name
                     ORDER BY total_spend DESC`;

            const rows = db.prepare(sql).all(...params);
            res.json({ success: true, data: rows, total: rows.length });
        } catch(err) {
            console.error('[GC] /adsets error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /ads/daily — Ad-level Google-only daily history
    router.get('/ads/daily', (req, res) => {
        try {
            const { getGcDb } = require('./db/gc-db');
            const db = getGcDb();
            const days = parseInt(req.query.days) || 90;
            const rows = db.prepare(`
                SELECT *
                FROM gc_ad_daily
                WHERE date >= date('now', '-' || ? || ' days')
                ORDER BY date DESC, cost_micros DESC
            `).all(days);
            res.json({ success: true, data: rows, total: rows.length });
        } catch(err) {
            console.error('[GC] /ads/daily error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /fetch/trigger — Manual refresh
    router.post('/fetch/trigger', async (req, res) => {
        try {
            const result = dataFetcher.runFullFetch(parseInt(req.query.days) || 90);
            result.catch(err => console.error('[GC] fetch error:', err.message));
            res.json({ success: true, data: { status: 'started' } });
        } catch(err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /signals/:creativeId — Creative signals
    router.get('/signals/:creativeId', (req, res) => {
        try {
            const { getGcDb } = require('./db/gc-db');
            const db = getGcDb();
            const creativeId = parseInt(req.params.creativeId);

            const row = db.prepare(`
                SELECT sig.*, c.ad_id, c.ad_type, c.campaign_name, c.adgroup_name,
                       c.asset_performance_label, c.adset_roas, c.adset_spend,
                       s.gcps_score, s.score_breakdown_json
                FROM gc_creative_signals sig
                JOIN gc_creatives c ON c.id = sig.creative_id
                LEFT JOIN gc_creative_scores s ON s.creative_id = sig.creative_id
                WHERE sig.creative_id = ?
            `).get(creativeId);

            if (!row) {
                return res.status(404).json({ success: false, error: 'Creative signals not found' });
            }

            let signalsParsed = null;
            try { signalsParsed = JSON.parse(row.signals_json); } catch(_) {}
            let scoreBreakdown = null;
            try { scoreBreakdown = JSON.parse(row.score_breakdown_json); } catch(_) {}

            res.json({
                success: true,
                data: {
                    creative_id: creativeId,
                    ad_id: row.ad_id,
                    ad_type: row.ad_type,
                    campaign_name: row.campaign_name,
                    adgroup_name: row.adgroup_name,
                    asset_performance_label: row.asset_performance_label,
                    adset_roas: row.adset_roas,
                    adset_spend: row.adset_spend,
                    gcps_score: row.gcps_score,
                    signals: signalsParsed,
                    score_breakdown: scoreBreakdown,
                    classified_at: row.classified_at
                }
            });
        } catch(err) {
            console.error('[GC] /signals/:creativeId error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /signals/market — Market signals
    router.get('/signals/market', async (req, res) => {
        try {
            const result = await signals.getLatestSignals();
            if (!result) {
                return res.json({ success: true, data: null, message: 'No market signals yet' });
            }
            res.json({ success: true, data: result });
        } catch(err) {
            console.error('[GC] /signals/market error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /learning/report — Learning report
    router.get('/learning/report', async (req, res) => {
        try {
            const report = await scoring.getLearningReport();
            res.json({ success: true, data: report });
        } catch(err) {
            console.error('[GC] /learning/report error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== SIMULATOR ====================

    // POST /simulator/predict
    router.post('/simulator/predict', async (req, res) => {
        try {
            const { adType, headlines, descriptions, youtubeUrl, assetDescription, imageDescription, campaignId, adgroupId, budget } = req.body;

            if (!adType) {
                return res.status(400).json({ success: false, error: 'adType is required (RSA, VIDEO, PMAX, DISPLAY)' });
            }

            const result = await simulator.simulateCreative({
                adType,
                headlines: headlines || [],
                descriptions: descriptions || [],
                youtubeUrl: youtubeUrl || '',
                assetDescription: assetDescription || '',
                imageDescription: imageDescription || '',
                campaignId: campaignId || null,
                adgroupId: adgroupId || null,
                budget: budget || null
            });

            res.json({ success: true, data: result });
        } catch(err) {
            console.error('[GC] /simulator/predict error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /simulator/simulations
    router.get('/simulator/simulations', (req, res) => {
        try {
            const status = req.query.status || 'active';
            // getSimulations is async
            simulator.getSimulations(status).then(rows => {
                res.json({ success: true, data: rows, total: rows.length });
            }).catch(err => {
                console.error('[GC] /simulator/simulations error:', err.message);
                res.status(500).json({ success: false, error: err.message });
            });
        } catch(err) {
            console.error('[GC] /simulator/simulations error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /simulator/:simId/timeseries
    router.get('/simulator/:simId/timeseries', (req, res) => {
        try {
            const simId = parseInt(req.params.simId);
            simulator.getSimulationTimeseries(simId).then(result => {
                if (!result) {
                    return res.status(404).json({ success: false, error: 'Simulation not found' });
                }
                res.json({ success: true, data: result });
            }).catch(err => {
                console.error('[GC] /simulator/:simId/timeseries error:', err.message);
                res.status(500).json({ success: false, error: err.message });
            });
        } catch(err) {
            console.error('[GC] /simulator/:simId/timeseries error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== FORECAST ====================

    // GET /forecast/alerts
    router.get('/forecast/alerts', async (req, res) => {
        try {
            const unreadOnly = req.query.unread === 'true' || req.query.unread === '1';
            const alerts = await forecast.getAlerts(unreadOnly);
            res.json({ success: true, data: alerts, total: alerts.length });
        } catch(err) {
            console.error('[GC] /forecast/alerts error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /forecast/summary
    router.get('/forecast/summary', async (req, res) => {
        try {
            const summary = await forecast.getForecastSummary();
            res.json({ success: true, data: summary });
        } catch(err) {
            console.error('[GC] /forecast/summary error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== RECOMMENDATIONS ====================

    // GET /recommendations/briefs
    router.get('/recommendations/briefs', async (req, res) => {
        try {
            const type = req.query.type || 'all';
            const briefs = await recommendations.getLatestBriefs(type);
            res.json({ success: true, data: briefs });
        } catch(err) {
            console.error('[GC] /recommendations/briefs error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /recommendations/refresh
    router.post('/recommendations/refresh', async (req, res) => {
        try {
            const type = (req.body && req.body.type) || req.query.type || 'all';
            const result = await recommendations.generateBriefs(type);
            res.json({ success: true, data: result });
        } catch(err) {
            console.error('[GC] /recommendations/refresh error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== PIPELINE ====================

    // GET /pipeline/status
    router.get('/pipeline/status', (req, res) => {
        try {
            const { getGcDb } = require('./db/gc-db');
            const db = getGcDb();
            const limit = parseInt(req.query.limit) || 20;

            const runs = db.prepare(`
                SELECT id, run_type, status, started_at, completed_at, details
                FROM gc_pipeline_runs
                ORDER BY id DESC
                LIMIT ?
            `).all(limit);

            const creativesCount = db.prepare(`SELECT COUNT(*) as cnt FROM gc_creatives`).get();
            const scoresCount = db.prepare(`SELECT COUNT(*) as cnt FROM gc_creative_scores`).get();
            const signalsCount = db.prepare(`SELECT COUNT(*) as cnt FROM gc_creative_signals`).get();
            const simulationsCount = db.prepare(`SELECT COUNT(*) as cnt FROM gc_simulations WHERE status = 'active'`).get();
            const alertsCount = db.prepare(`SELECT COUNT(*) as cnt FROM gc_forecast_alerts WHERE is_read = 0`).get();

            const parsedRuns = runs.map(r => {
                let details = null;
                try { details = JSON.parse(r.details); } catch(_) { details = r.details; }
                return { ...r, details };
            });

            res.json({
                success: true,
                data: {
                    pipeline_runs: parsedRuns,
                    counts: {
                        creatives: (creativesCount && creativesCount.cnt) || 0,
                        scores: (scoresCount && scoresCount.cnt) || 0,
                        signals: (signalsCount && signalsCount.cnt) || 0,
                        active_simulations: (simulationsCount && simulationsCount.cnt) || 0,
                        unread_alerts: (alertsCount && alertsCount.cnt) || 0
                    }
                }
            });
        } catch(err) {
            console.error('[GC] /pipeline/status error:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
