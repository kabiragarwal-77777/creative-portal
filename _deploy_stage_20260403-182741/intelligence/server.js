const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { db, getAll, getOne, run, getRowCount } = require('./db');

const dataAgent = require('./agents/dataAgent');
const insightAgent = require('./agents/insightAgent');
const creativeAIAgent = require('./agents/creativeAIAgent');
const forecastAgent = require('./agents/forecastAgent');
const scriptAgent = require('./agents/scriptAgent');
const schedulerAgent = require('./agents/schedulerAgent');

const app = express();
app.use(express.json());
app.use(cors({ origin: /localhost/ }));
app.use(express.static(path.join(__dirname, 'public')));

// ── DATA routes ──

app.post('/api/intel/data/refresh', async (req, res) => {
  try {
    const result = await dataAgent.fetchAndStoreAll();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/data/status', async (req, res) => {
  try {
    const status = await dataAgent.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/data/creatives', async (req, res) => {
  try {
    const rows = await getAll('SELECT * FROM raw_creatives ORDER BY spend DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/data/meta-dump', async (req, res) => {
  try {
    const rows = await getAll('SELECT * FROM raw_meta_dump ORDER BY date DESC LIMIT 1000');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/data/metabase', async (req, res) => {
  try {
    const rows = await getAll('SELECT * FROM raw_metabase ORDER BY date DESC LIMIT 1000');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── INSIGHT routes ──

app.get('/api/intel/insights', async (req, res) => {
  try {
    const insights = await insightAgent.getInsights(req.query);
    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/intel/insights/generate', async (req, res) => {
  try {
    const insights = await insightAgent.analyzeCreativePerformance();
    res.json(insights);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/scores', async (req, res) => {
  try {
    const scores = await insightAgent.getScores(req.query.sortBy, req.query.order);
    res.json(scores);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/scores/:adId', async (req, res) => {
  try {
    const score = await getOne('SELECT * FROM creative_scores WHERE ad_id = ?', [req.params.adId]);
    res.json(score);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CREATIVE routes ──

app.get('/api/intel/creative/:adId/signals', async (req, res) => {
  try {
    const signals = await creativeAIAgent.getSignals(req.params.adId);
    res.json(signals);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/creative/:adId/analysis', async (req, res) => {
  try {
    const adId = req.params.adId;
    const [signals, scores, creative] = await Promise.all([
      creativeAIAgent.getSignals(adId),
      getOne('SELECT * FROM creative_scores WHERE ad_id = ?', [adId]),
      getOne('SELECT * FROM raw_creatives WHERE ad_id = ?', [adId])
    ]);
    res.json({ signals, scores, creative });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/intel/creative/analyze-batch', async (req, res) => {
  try {
    const result = await creativeAIAgent.analyzeNextBatch();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/patterns', async (req, res) => {
  try {
    const patterns = await creativeAIAgent.getPatterns();
    res.json(patterns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── FORECAST routes ──
// /forecast/all MUST come before /forecast/:adId

app.get('/api/intel/forecast/all', async (req, res) => {
  try {
    const forecasts = await forecastAgent.getForecasts();
    res.json(forecasts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/forecast/:adId', async (req, res) => {
  try {
    const forecasts = await forecastAgent.getForecasts(req.params.adId);
    res.json(forecasts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/intel/forecast/run', async (req, res) => {
  try {
    const result = await forecastAgent.runForecasts();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/cohorts', async (req, res) => {
  try {
    const cohorts = await forecastAgent.getCohorts();
    res.json(cohorts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── BRIEF routes ──
// /briefs must come before /briefs/:id

app.get('/api/intel/briefs', async (req, res) => {
  try {
    const briefs = await scriptAgent.getBriefs();
    res.json(briefs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/intel/briefs/generate', async (req, res) => {
  try {
    const briefs = await scriptAgent.generateNewBriefs(req.body.count || 3);
    res.json(briefs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/briefs/:id', async (req, res) => {
  try {
    const brief = await scriptAgent.getBriefById(req.params.id);
    res.json(brief);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/briefs/:id/script', async (req, res) => {
  try {
    const brief = await scriptAgent.getBriefById(req.params.id);
    res.json({ script_text: brief.script_text, format: brief.format, title: brief.title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── REVAMP routes ──

app.get('/api/intel/revamps', async (req, res) => {
  try {
    const revamps = await scriptAgent.getRevamps();
    res.json(revamps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/intel/revamps/:adId', async (req, res) => {
  try {
    const result = await scriptAgent.generateRevampSuggestion(req.params.adId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SCHEDULER routes ──

app.get('/api/intel/scheduler/status', async (req, res) => {
  try {
    const status = await schedulerAgent.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/intel/scheduler/log', async (req, res) => {
  try {
    const log = await schedulerAgent.getLog(parseInt(req.query.limit) || 50);
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/intel/scheduler/:job', async (req, res) => {
  try {
    const result = await schedulerAgent.triggerJob(req.params.job);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HEALTH ──

app.get('/api/intel/health', async (req, res) => {
  try {
    const status = {
      status: 'ok',
      db: {
        raw_creatives: getRowCount('raw_creatives'),
        raw_meta_dump: getRowCount('raw_meta_dump'),
        raw_metabase: getRowCount('raw_metabase'),
        creative_scores: getRowCount('creative_scores'),
        creative_signals: getRowCount('creative_signals'),
        ltv_predictions: getRowCount('ltv_predictions'),
        ltv_cohorts: getRowCount('ltv_cohorts'),
        ai_insights: getRowCount('ai_insights'),
        creative_briefs: getRowCount('creative_briefs'),
        revamp_suggestions: getRowCount('revamp_suggestions'),
        scheduler_log: getRowCount('scheduler_log')
      },
      scheduler: schedulerAgent.getStatus(),
      openai: !!process.env.OPENAI_API_KEY,
      uptime: process.uptime()
    };
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── STARTUP ──

const PORT = process.env.PORT_INTEL || 3002;
app.listen(PORT, () => {
  console.log(`Intelligence server running on port ${PORT}`);
  schedulerAgent.startAll();
  console.log('Scheduler started');
});
