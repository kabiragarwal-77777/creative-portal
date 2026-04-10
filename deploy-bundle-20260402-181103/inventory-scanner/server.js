require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { getDb, isSeeded, markSeeded } = require('./database/db');
const agents = require('./agents');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  frameguard: false,
  originAgentCluster: false
}));
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
app.use('/api/inventories', routes.inventoriesRouter);
app.use('/api/discovery', routes.discoveryRouter);
app.use('/api/competitors', routes.competitorsRouter);
app.use('/api/onboarding', routes.onboardingRouter);
app.use('/api/insights', routes.insightsRouter);
app.use('/api/pricing', routes.pricingRouter);
app.use('/api/budget', routes.budgetRouter);
app.use('/api/formats', routes.formatsRouter);
app.use('/api/meta', routes.metaRouter);
app.use('/api/google', routes.googleRouter);
app.use('/api/synthesis', routes.synthesisRouter);
app.use('/api/inventory', routes.inventoryEngineRouter);

// Scheduler routes
app.get('/api/scheduler/status', (req, res) => {
  try {
    const status = agents.getSchedulerStatus();
    res.json({ success: true, data: status, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});
app.post('/api/scheduler/run/:jobName', async (req, res) => {
  try {
    const result = await agents.runSchedulerJob(req.params.jobName);
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
    const schedulerStatus = agents.getSchedulerStatus();

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
    agents.startScheduler();
    console.log('[Server] Scheduler started');
  } catch (err) {
    console.error('[Server] Scheduler start error:', err.message);
  }

  // Run initial discovery if no logs exist
  try {
    const logCount = db.prepare('SELECT COUNT(*) as count FROM discovery_log').get().count;
    if (logCount === 0) {
      console.log('[Server] No discovery logs found — running initial discovery...');
      agents.runDiscovery().then(() => {
        console.log('[Server] Initial discovery complete');
      }).catch(err => {
        console.error('[Server] Initial discovery error:', err.message);
      });
    }
  } catch (err) {
    console.error('[Server] Discovery check error:', err.message);
  }
});

// Pre-warm inventory name cache on server start
try {
  const { warmInventoryNameCache } = require('../inventory-engine');
  warmInventoryNameCache().then(() => console.log('[Server] Inventory names loaded')).catch(err => console.warn('[Server] Name cache warm failed:', err.message));
} catch (e) {
  console.warn('[Server] inventory-engine not available for pre-warming');
}

module.exports = app;
