/**
 * Audience Testing — Express Router
 * Mounts all AT agent endpoints under the /at prefix.
 */

let express;
try { express = require('express'); } catch (e) { express = require('../uploader/node_modules/express'); }

module.exports = function(config) {
    const router = express.Router();

    // Initialize all agents
    const metaScanner = require('./agents/atMetaScanner')(config);
    const googleScanner = require('./agents/atGoogleScanner')(config);
    const enricher = require('./agents/atMetabaseEnricher')(config);
    const learningEngine = require('./agents/atLearningEngine')(config);
    const recommendationEngine = require('./agents/atRecommendationEngine')(config);
    const testDesigner = require('./agents/atTestDesigner')(config);
    const optimizer = require('./agents/atCurrentOptimizer')(config);

    // Start scheduler
    const scheduler = require('./agents/atScheduler');

    // Helper: get DB instance
    async function db() {
        const { getAtDb } = require('./db/at-db');
        return await getAtDb();
    }

    // ==================== META SCANNER ====================

    // GET /meta/scan/trigger — Trigger a full Meta scan
    router.get('/meta/scan/trigger', async (req, res) => {
        try {
            const resultPromise = metaScanner.runFullScan();
            resultPromise.catch(err => console.error('[AT] meta scan error:', err.message));
            res.json({ success: true, data: { status: 'started', message: 'Full Meta scan triggered' } });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /meta/scan/status — Get Meta scan status
    router.get('/meta/scan/status', async (req, res) => {
        try {
            const status = await metaScanner.getScanStatus();
            res.json({ success: true, data: status });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /meta/adsets — Query adsets with optional filters
    router.get('/meta/adsets', async (req, res) => {
        try {
            const d = await db();
            const conditions = ['1=1'];
            const params = [];

            if (req.query.vertical) {
                conditions.push(`mc.vertical = ?`);
                params.push(req.query.vertical);
            }
            if (req.query.status) {
                conditions.push(`a.status = ?`);
                params.push(req.query.status.toUpperCase());
            }
            if (req.query.min_spend) {
                conditions.push(`a.total_spend >= ?`);
                params.push(parseFloat(req.query.min_spend));
            }

            const sql = `
                SELECT a.*, mc.name AS campaign_name, mc.vertical, mc.objective
                FROM at_meta_adsets a
                LEFT JOIN at_meta_campaigns mc ON mc.meta_campaign_id = a.meta_campaign_id
                WHERE ${conditions.join(' AND ')}
                ORDER BY a.total_spend DESC
                LIMIT 500
            `;
            const rows = await d.prepare(sql).all(...params);
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /meta/campaigns — Query Meta campaigns
    router.get('/meta/campaigns', async (req, res) => {
        try {
            const d = await db();
            const rows = await d.prepare(`
                SELECT * FROM at_meta_campaigns ORDER BY total_spend DESC
            `).all();
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== GOOGLE SCANNER ====================

    // GET /google/scan/trigger — Trigger a full Google scan
    router.get('/google/scan/trigger', async (req, res) => {
        try {
            const resultPromise = googleScanner.runFullScan();
            resultPromise.catch(err => console.error('[AT] google scan error:', err.message));
            res.json({ success: true, data: { status: 'started', message: 'Full Google scan triggered' } });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /google/scan/status — Get Google scan status
    router.get('/google/scan/status', async (req, res) => {
        try {
            const status = await googleScanner.getScanStatus();
            res.json({ success: true, data: status });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /google/adgroups — Query Google adgroups
    router.get('/google/adgroups', async (req, res) => {
        try {
            const d = await db();
            const conditions = ['1=1'];
            const params = [];

            if (req.query.status) {
                conditions.push(`ag.status = ?`);
                params.push(req.query.status.toUpperCase());
            }
            if (req.query.min_spend) {
                conditions.push(`ag.total_spend >= ?`);
                params.push(parseFloat(req.query.min_spend));
            }

            const sql = `
                SELECT ag.*, gc.name AS campaign_name, gc.vertical, gc.channel_type
                FROM at_google_adgroups ag
                LEFT JOIN at_google_campaigns gc ON gc.google_campaign_id = ag.google_campaign_id
                WHERE ${conditions.join(' AND ')}
                ORDER BY ag.total_spend DESC
                LIMIT 500
            `;
            const rows = await d.prepare(sql).all(...params);
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /google/campaigns — Query Google campaigns
    router.get('/google/campaigns', async (req, res) => {
        try {
            const d = await db();
            const rows = await d.prepare(`
                SELECT * FROM at_google_campaigns ORDER BY total_spend DESC
            `).all();
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== ENRICHMENT ====================

    // POST /enrich/meta — Trigger Meta enrichment from Metabase
    router.post('/enrich/meta', async (req, res) => {
        try {
            const result = await enricher.enrichMeta();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /enrich/google — Trigger Google enrichment from Metabase
    router.post('/enrich/google', async (req, res) => {
        try {
            const result = await enricher.enrichGoogle();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /enrich/status — Get enrichment status
    router.get('/enrich/status', async (req, res) => {
        try {
            const status = await enricher.getEnrichmentStatus();
            res.json({ success: true, data: status });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== LEARNING ====================

    // POST /learn/meta — Trigger Meta pattern analysis
    router.post('/learn/meta', async (req, res) => {
        try {
            const result = await learningEngine.runMetaAnalysis();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /learn/google — Trigger Google pattern analysis
    router.post('/learn/google', async (req, res) => {
        try {
            const result = await learningEngine.runGoogleAnalysis();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /patterns/meta — Get Meta patterns
    router.get('/patterns/meta', async (req, res) => {
        try {
            const patterns = await learningEngine.getPatterns('meta');
            res.json({ success: true, data: patterns });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /patterns/google — Get Google patterns
    router.get('/patterns/google', async (req, res) => {
        try {
            const patterns = await learningEngine.getPatterns('google');
            res.json({ success: true, data: patterns });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /patterns/summary — Top findings from both platforms
    router.get('/patterns/summary', async (req, res) => {
        try {
            const metaPatterns = await learningEngine.getPatterns('meta');
            const googlePatterns = await learningEngine.getPatterns('google');

            // Take top 5 from each by confidence then sample size
            const topMeta = (Array.isArray(metaPatterns) ? metaPatterns : []).slice(0, 5);
            const topGoogle = (Array.isArray(googlePatterns) ? googlePatterns : []).slice(0, 5);

            res.json({
                success: true,
                data: {
                    meta: { total: (Array.isArray(metaPatterns) ? metaPatterns.length : 0), top: topMeta },
                    google: { total: (Array.isArray(googlePatterns) ? googlePatterns.length : 0), top: topGoogle }
                }
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== RECOMMENDATIONS ====================

    // POST /recommendations/generate — Generate all recommendations
    router.post('/recommendations/generate', async (req, res) => {
        try {
            const result = await recommendationEngine.generateAll();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /recommendations/tests — Get test recommendations
    router.get('/recommendations/tests', async (req, res) => {
        try {
            const d = await db();
            const conditions = ["rec_type = 'test'"];
            const params = [];

            if (req.query.platform) {
                conditions.push('platform = ?');
                params.push(req.query.platform.toLowerCase());
            }
            if (req.query.vertical) {
                conditions.push('vertical = ?');
                params.push(req.query.vertical);
            }
            if (req.query.priority) {
                conditions.push('priority = ?');
                params.push(req.query.priority.toLowerCase());
            }

            const sql = `
                SELECT * FROM at_recommendations
                WHERE ${conditions.join(' AND ')} AND status = 'pending'
                ORDER BY
                    CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
                    generated_at DESC
            `;
            const rows = await d.prepare(sql).all(...params);
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /recommendations/optimizations — Get optimization recommendations
    router.get('/recommendations/optimizations', async (req, res) => {
        try {
            const d = await db();
            const conditions = ["rec_type = 'optimization'"];
            const params = [];

            if (req.query.platform) {
                conditions.push('platform = ?');
                params.push(req.query.platform.toLowerCase());
            }
            if (req.query.urgency) {
                conditions.push('urgency = ?');
                params.push(req.query.urgency.toLowerCase());
            }

            const sql = `
                SELECT * FROM at_recommendations
                WHERE ${conditions.join(' AND ')} AND status = 'pending'
                ORDER BY
                    CASE urgency WHEN 'immediate' THEN 1 WHEN 'this_week' THEN 2 WHEN 'this_month' THEN 3 ELSE 4 END,
                    generated_at DESC
            `;
            const rows = await d.prepare(sql).all(...params);
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /recommendations/:id/mark-implemented — Mark recommendation as implemented
    router.post('/recommendations/:id/mark-implemented', async (req, res) => {
        try {
            const d = await db();
            const id = parseInt(req.params.id);
            const result = await d.prepare(`
                UPDATE at_recommendations SET status = 'implemented', implemented_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(id);

            if (result.changes === 0) {
                return res.status(404).json({ success: false, error: 'Recommendation not found' });
            }
            res.json({ success: true, data: { id, status: 'implemented' } });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /recommendations/:id/dismiss — Dismiss a recommendation
    router.post('/recommendations/:id/dismiss', async (req, res) => {
        try {
            const d = await db();
            const id = parseInt(req.params.id);
            const reason = (req.body && req.body.reason) || 'No reason given';
            const result = await d.prepare(`
                UPDATE at_recommendations SET status = 'dismissed', dismissed_reason = ?
                WHERE id = ?
            `).run(reason, id);

            if (result.changes === 0) {
                return res.status(404).json({ success: false, error: 'Recommendation not found' });
            }
            res.json({ success: true, data: { id, status: 'dismissed', reason } });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== TEST DESIGNER ====================

    // GET /tests/:id/spec — Generate test spec for a recommendation
    router.get('/tests/:id/spec', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const spec = await testDesigner.generateSpec(id);
            res.json({ success: true, data: spec });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /tests/all-specs — Get all test specs
    router.get('/tests/all-specs', async (req, res) => {
        try {
            const platform = req.query.platform || null;
            const specs = await testDesigner.getAllSpecs(platform);
            res.json({ success: true, data: specs });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== OPTIMIZER (LIVE FLAGS) ====================

    // GET /live/flags — Get live flags with optional filters
    router.get('/live/flags', async (req, res) => {
        try {
            const flags = await optimizer.getFlags(req.query);
            res.json({ success: true, data: flags, total: flags.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /live/health — Run health check and return flags with summary
    router.get('/live/health', async (req, res) => {
        try {
            const result = await optimizer.refreshFlags();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /live/refresh — Run health check and return flags with summary
    router.post('/live/refresh', async (req, res) => {
        try {
            const result = await optimizer.refreshFlags();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== SCHEDULER ====================

    // GET /scheduler/status — Get scheduler status
    router.get('/scheduler/status', async (req, res) => {
        try {
            const status = await scheduler.getSchedulerStatus();
            res.json({ success: true, data: status });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /scheduler/:job/trigger — Trigger a specific scheduler job
    router.post('/scheduler/:job/trigger', async (req, res) => {
        try {
            const jobName = req.params.job;
            const result = await scheduler.triggerJob(jobName);
            if (!result.success) {
                return res.status(400).json(result);
            }
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
