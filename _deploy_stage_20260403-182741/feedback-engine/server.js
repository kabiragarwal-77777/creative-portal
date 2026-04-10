const express = require('express');
const path = require('path');

const startTime = Date.now();

module.exports = function(config) {
  const router = express.Router();

  // Initialize all agents
  const feWatcher = require('./agents/feWatcher')(config);
  const feKnowledgeCrawler = require('./agents/feKnowledgeCrawler')(config);
  const feAccuracyAuditor = require('./agents/feAccuracyAuditor')(config);
  const feSelfTester = require('./agents/feSelfTester')(config);
  const feProposalGenerator = require('./agents/feProposalGenerator')(config);
  const feApprovalEngine = require('./agents/feApprovalEngine')(config);
  const feMemory = require('./agents/feMemory')(config);
  const feAnomalyDetector = require('./agents/feAnomalyDetector')(config);
  const feDataQualityMonitor = require('./agents/feDataQualityMonitor')(config);
  const scheduler = require('./agents/feScheduler');

  // Serve static files
  router.use('/public', express.static(path.join(__dirname, 'public')));

  // --- Helper ---
  function ok(data) {
    return { success: true, data, timestamp: new Date().toISOString() };
  }
  function fail(error) {
    return { success: false, error: error.message || String(error), timestamp: new Date().toISOString() };
  }

  // =========== WATCHER ===========

  router.get('/watcher/summary', async (req, res) => {
    try {
      const data = await feWatcher.getSummary();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.get('/watcher/predictions', async (req, res) => {
    try {
      const data = await feWatcher.getPredictions(req.query);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.post('/watcher/refresh', async (req, res) => {
    try {
      const data = await feWatcher.refresh();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  // =========== KNOWLEDGE ===========

  router.get('/knowledge/items', async (req, res) => {
    try {
      const data = await feKnowledgeCrawler.getItems(req.query);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.get('/knowledge/sources', async (req, res) => {
    try {
      const data = await feKnowledgeCrawler.getSources();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.post('/knowledge/crawl', async (req, res) => {
    try {
      const data = await feKnowledgeCrawler.crawlAll(req.body.tier);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.put('/knowledge/sources', async (req, res) => {
    try {
      const data = await feKnowledgeCrawler.addSource(req.body);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  // =========== AUDIT ===========

  router.get('/audit/report', async (req, res) => {
    try {
      const data = await feAccuracyAuditor.getLatestReport();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.get('/audit/history', async (req, res) => {
    try {
      const data = await feAccuracyAuditor.getHistory();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.post('/audit/run', async (req, res) => {
    try {
      const data = await feAccuracyAuditor.runAudit();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  // =========== HYPOTHESES ===========

  router.get('/hypotheses', async (req, res) => {
    try {
      const data = await feSelfTester.getHypotheses(req.query);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.post('/hypotheses/generate', async (req, res) => {
    try {
      const data = await feSelfTester.generateHypotheses();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.get('/hypotheses/:id/results', async (req, res) => {
    try {
      const data = await feSelfTester.getTestResults(req.params.id);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  // =========== PROPOSALS ===========

  router.get('/proposals', async (req, res) => {
    try {
      const data = await feProposalGenerator.getProposals(req.query);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.get('/proposals/:id', async (req, res) => {
    try {
      const data = await feProposalGenerator.getProposal(req.params.id);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.post('/proposals/generate', async (req, res) => {
    try {
      const data = await feProposalGenerator.generateProposals();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.post('/proposals/:id/approve', async (req, res) => {
    try {
      const data = await feApprovalEngine.approveProposal(req.params.id, req.body.reviewed_by || 'user');
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.post('/proposals/:id/reject', async (req, res) => {
    try {
      const data = await feApprovalEngine.rejectProposal(req.params.id, req.body.reason, req.body.reviewed_by || 'user');
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.post('/proposals/approve-batch', async (req, res) => {
    try {
      const data = await feApprovalEngine.approveBatch(req.body.ids, req.body.reviewed_by || 'user');
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.post('/proposals/:id/rollback', async (req, res) => {
    try {
      const data = await feApprovalEngine.rollbackChange(req.params.id);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  // =========== CHANGES ===========

  router.get('/changes', async (req, res) => {
    try {
      const data = await feApprovalEngine.getChangeLog();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  // =========== MEMORY ===========

  router.get('/memory/episodic', async (req, res) => {
    try {
      const data = await feMemory.getEpisodic(req.query);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.get('/memory/semantic', async (req, res) => {
    try {
      const data = await feMemory.getSemantic();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.get('/memory/procedural', async (req, res) => {
    try {
      const data = await feMemory.getProcedural();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.get('/memory/search', async (req, res) => {
    try {
      const data = await feMemory.search(req.query.q);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.post('/memory/consolidate', async (req, res) => {
    try {
      const data = await feMemory.consolidate();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  // =========== ANOMALIES ===========

  router.get('/anomalies', async (req, res) => {
    try {
      const data = await feAnomalyDetector.getAnomalies(req.query);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.get('/anomalies/active', async (req, res) => {
    try {
      const data = await feAnomalyDetector.getActive();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.post('/anomalies/:id/resolve', async (req, res) => {
    try {
      const data = await feAnomalyDetector.resolve(req.params.id);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  // =========== DATA QUALITY ===========

  router.get('/data-quality/latest', async (req, res) => {
    try {
      const data = await feDataQualityMonitor.getLatestRun();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.get('/data-quality/history', async (req, res) => {
    try {
      const data = await feDataQualityMonitor.getHistory(req.query.limit);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.post('/data-quality/run', async (req, res) => {
    try {
      const data = await feDataQualityMonitor.runAudit(req.body || {});
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  // =========== SCHEDULER ===========

  router.get('/scheduler/status', async (req, res) => {
    try {
      const data = await scheduler.getStatus();
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.post('/scheduler/:job/trigger', async (req, res) => {
    try {
      const data = await scheduler.triggerJob(req.params.job);
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  router.get('/scheduler/runs/:job', async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
      const { query } = require('./db/fe-db');
      const rows = query(
        `SELECT started_at, completed_at, duration_ms, records_processed, errors, status
         FROM fe_scheduler_log
         WHERE job_name = ?
         ORDER BY started_at DESC
         LIMIT ${limit}`,
        [req.params.job]
      );
      const data = rows.map(row => ({
        started_at: row.started_at,
        completed_at: row.completed_at,
        duration_ms: row.duration_ms,
        items_processed: row.records_processed,
        error: row.errors,
        status: row.status === 'completed' ? 'success' : (row.status === 'failed' ? 'error' : 'warning'),
      }));
      res.json(ok(data));
    } catch (e) {
      res.status(500).json(fail(e));
    }
  });

  // =========== HEALTH ===========

  router.get('/health', (req, res) => {
    res.json(ok({
      status: 'ok',
      agents: 9,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: '1.0.0'
    }));
  });

  return router;
};
