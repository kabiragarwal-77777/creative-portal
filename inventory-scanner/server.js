require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { getDb, isSeeded, markSeeded } = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize DB and seed
const db = getDb();

// Run seed if needed
if (!isSeeded()) {
  console.log('[Server] First run detected — seeding database...');
  try {
    const { runSeed } = require('./data/seed');
    runSeed();
    console.log('[Server] Database seeded successfully');
  } catch (err) {
    console.error('[Server] Seed error:', err.message);
  }
}

// Mount routes
app.use('/api/inventories', require('./routes/inventories'));
app.use('/api/discovery', require('./routes/discovery'));
app.use('/api/competitors', require('./routes/competitors'));
app.use('/api/onboarding', require('./routes/onboarding'));
app.use('/api/insights', require('./routes/insights'));
app.use('/api/pricing', require('./routes/pricing'));
app.use('/api/budget', require('./routes/budget'));
app.use('/api/formats', require('./routes/formats'));
app.use('/api/meta', require('./routes/meta'));
app.use('/api/google', require('./routes/google'));
app.use('/api/synthesis', require('./routes/synthesis'));

// Scheduler routes
const schedulerAgent = require('./agents/schedulerAgent');
app.get('/api/scheduler/status', (req, res) => {
  try {
    const status = schedulerAgent.getStatus();
    res.json({ success: true, data: status, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});
app.post('/api/scheduler/run/:jobName', async (req, res) => {
  try {
    const result = await schedulerAgent.runJob(req.params.jobName);
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  try {
    const db = getDb();
    const inventoryCount = db.prepare('SELECT COUNT(*) as count FROM inventories').get().count;
    const competitorCount = db.prepare('SELECT COUNT(*) as count FROM competitors').get().count;
    const insightCount = db.prepare('SELECT COUNT(*) as count FROM ai_insights').get().count;
    const lastDiscovery = db.prepare('SELECT run_date FROM discovery_log ORDER BY run_date DESC LIMIT 1').get();
    const schedulerStatus = schedulerAgent.getStatus();

    res.json({
      success: true,
      data: {
        status: 'healthy',
        uptime: process.uptime(),
        database: {
          inventories: inventoryCount,
          competitors: competitorCount,
          insights: insightCount
        },
        lastDiscoveryRun: lastDiscovery?.run_date || 'never',
        scheduler: schedulerStatus
      },
      error: null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({
    success: false,
    data: null,
    error: err.message || 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[Inventory Scanner] Running on http://localhost:${PORT}`);

  // Start scheduler
  try {
    schedulerAgent.startScheduler();
    console.log('[Server] Scheduler started');
  } catch (err) {
    console.error('[Server] Scheduler start error:', err.message);
  }

  // Run initial discovery if no logs exist
  try {
    const logCount = db.prepare('SELECT COUNT(*) as count FROM discovery_log').get().count;
    if (logCount === 0) {
      console.log('[Server] No discovery logs found — running initial discovery...');
      const discoveryAgent = require('./agents/discoveryAgent');
      discoveryAgent.runDiscovery().then(() => {
        console.log('[Server] Initial discovery complete');
      }).catch(err => {
        console.error('[Server] Initial discovery error:', err.message);
      });
    }
  } catch (err) {
    console.error('[Server] Discovery check error:', err.message);
  }
});

module.exports = app;
