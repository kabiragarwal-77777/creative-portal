// ============================================================
// CONSOLIDATED ROUTES — inventory-scanner/routes.js
// All 11 route modules merged into a single file.
// ============================================================

const express = require('express');
const { getDb } = require('./database/db');
const agents = require('./agents');
const scannerService = require('./scanner-service');

scannerService.ensureInventoryScannerScheduler();

// ==================== BUDGET ROUTES ====================
const budgetRouter = express.Router();

budgetRouter.get('/compare', (req, res) => {
  try {
    const ids = req.query.ids ? req.query.ids.split(',') : [];
    if (ids.length === 0) return res.status(400).json({ success: false, data: null, error: 'Missing ids query parameter (comma-separated)', timestamp: new Date().toISOString() });
    const comparison = agents.compareBudgets(ids);
    res.json({ success: true, data: comparison, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

budgetRouter.post('/plan', async (req, res) => {
  try {
    const plan = await scannerService.generateBudgetPlan(req.body || {});
    res.json({ success: true, data: plan, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

budgetRouter.get('/:inventoryId', (req, res) => {
  try {
    const recommendation = agents.getBudgetRecommendation(req.params.inventoryId);
    res.json({ success: true, data: recommendation, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

// ==================== COMPETITOR ROUTES ====================
const competitorsRouter = express.Router();

competitorsRouter.get('/', (req, res) => {
  try {
    const competitors = agents.getAllCompetitors();
    res.json({ success: true, data: competitors, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

competitorsRouter.get('/whitespace', (req, res) => {
  try {
    const whitespace = agents.getWhitespace();
    res.json({ success: true, data: whitespace, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

competitorsRouter.get('/inventory/:inventoryId', (req, res) => {
  try {
    const spends = agents.getCompetitorSpends(req.params.inventoryId);
    res.json({ success: true, data: spends, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

competitorsRouter.get('/:competitorId/spend', (req, res) => {
  try {
    const profile = agents.getCompetitorProfile(req.params.competitorId);
    res.json({ success: true, data: profile, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

competitorsRouter.get('/:competitorId/advantages/:inventoryId', (req, res) => {
  try {
    const advantages = agents.getAdvantagesDisadvantages(req.params.inventoryId);
    res.json({ success: true, data: advantages, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

competitorsRouter.post('/refresh', async (req, res) => {
  try {
    const result = await agents.refreshCompetitorData();
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

// ==================== DISCOVERY ROUTES ====================
const discoveryRouter = express.Router();

discoveryRouter.post('/run', async (req, res) => {
  try {
    const results = await agents.runDiscovery();
    res.json({ success: true, data: results, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

discoveryRouter.get('/log', (req, res) => {
  try {
    const logs = agents.getDiscoveryLog();
    res.json({ success: true, data: logs, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

discoveryRouter.get('/new', (req, res) => {
  try {
    const newInventories = agents.getNewInventories();
    res.json({ success: true, data: newInventories, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

// ==================== FORMATS ROUTES ====================
const formatsRouter = express.Router();

formatsRouter.get('/:inventoryId', (req, res) => {
  try {
    const recommendations = agents.getFormatRecommendations(req.params.inventoryId);
    res.json({ success: true, data: recommendations, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

// ==================== GOOGLE ROUTES ====================
const googleRouter = express.Router();

googleRouter.get('/ads/all', (req, res) => {
  try {
    const db = getDb();
    const ads = db.prepare(`
      SELECT ga.*, c.name as competitor_name
      FROM google_ads ga
      LEFT JOIN competitors c ON ga.competitor_id = c.id
      ORDER BY ga.first_shown DESC
    `).all();
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

googleRouter.get('/ads/:competitorName', async (req, res) => {
  try {
    const ads = await agents.fetchGoogleAds(req.params.competitorName);
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

googleRouter.get('/youtube/:competitorName', async (req, res) => {
  try {
    const ads = await agents.fetchCompetitorYouTubeAds(req.params.competitorName);
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

googleRouter.get('/search-ads', (req, res) => {
  try {
    const db = getDb();
    const ads = db.prepare(`
      SELECT sa.*, c.name as competitor_name
      FROM search_ads sa
      LEFT JOIN competitors c ON sa.competitor_id = c.id
      ORDER BY sa.captured_date DESC
    `).all();
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

googleRouter.get('/keyword-gaps', (req, res) => {
  try {
    const gaps = agents.getKeywordGaps();
    res.json({ success: true, data: gaps, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

googleRouter.post('/refresh', async (req, res) => {
  try {
    const result = await agents.refreshAllGoogleCompetitors();
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

// ==================== INSIGHTS ROUTES ====================
const insightsRouter = express.Router();

insightsRouter.get('/', (req, res) => {
  try {
    const unreadOnly = req.query.unread === 'true';
    const insights = agents.getInsights(unreadOnly);
    res.json({ success: true, data: insights, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

insightsRouter.post('/generate', async (req, res) => {
  try {
    const result = await agents.generateInsights();
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

insightsRouter.put('/:id/read', (req, res) => {
  try {
    const result = agents.markAsRead(req.params.id);
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

insightsRouter.get('/inventory/:inventoryId', (req, res) => {
  try {
    const insights = agents.getInsightsForInventory(req.params.inventoryId);
    res.json({ success: true, data: insights, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

// ==================== INVENTORIES ROUTES ====================
const inventoriesRouter = express.Router();

inventoriesRouter.get('/', (req, res) => {
  try {
    const db = getDb();
    let query = 'SELECT * FROM inventories WHERE 1=1';
    const params = [];

    if (req.query.category) { query += ' AND category = ?'; params.push(req.query.category); }
    if (req.query.status) { query += ' AND status = ?'; params.push(req.query.status); }
    if (req.query.fintech_friendly) { query += ' AND fintech_friendly = ?'; params.push(parseInt(req.query.fintech_friendly)); }
    if (req.query.min_cpm) { query += ' AND min_cpm >= ?'; params.push(parseFloat(req.query.min_cpm)); }
    if (req.query.max_cpm) { query += ' AND max_cpm <= ?'; params.push(parseFloat(req.query.max_cpm)); }
    if (req.query.min_fit) { query += ' AND target_audience_fit >= ?'; params.push(parseInt(req.query.min_fit)); }
    if (req.query.search) { query += ' AND (name LIKE ? OR platform_parent LIKE ? OR category LIKE ?)'; const s = `%${req.query.search}%`; params.push(s, s, s); }

    query += ' ORDER BY target_audience_fit DESC, name ASC';

    const inventories = db.prepare(query).all(...params);

    const competitorCountStmt = db.prepare('SELECT COUNT(DISTINCT competitor_id) as count FROM competitor_spends WHERE inventory_id = ?');
    const formatCountStmt = db.prepare('SELECT COUNT(*) as count FROM ad_format_scores WHERE inventory_id = ?');

    const enriched = inventories.map(inv => ({
      ...inv,
      competitor_count: competitorCountStmt.get(inv.id)?.count || 0,
      format_count: formatCountStmt.get(inv.id)?.count || 0
    }));

    res.json({ success: true, data: enriched, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

inventoriesRouter.get('/existing', (req, res) => {
  try {
    const benchmarks = agents.getAllBenchmarks();
    res.json({ success: true, data: benchmarks, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

inventoriesRouter.get('/new', (req, res) => {
  try {
    const db = getDb();
    const newInvs = db.prepare("SELECT * FROM inventories WHERE status = 'new' AND created_at >= datetime('now', '-7 days') ORDER BY created_at DESC").all();
    res.json({ success: true, data: newInvs, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

inventoriesRouter.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) as count FROM inventories').get().count;
    const active = db.prepare("SELECT COUNT(*) as count FROM inventories WHERE status = 'active'").get().count;
    const newThisWeek = db.prepare("SELECT COUNT(*) as count FROM inventories WHERE created_at >= datetime('now', '-7 days')").get().count;
    const avgCpm = db.prepare('SELECT AVG((min_cpm + max_cpm) / 2) as avg FROM inventories WHERE min_cpm IS NOT NULL').get().avg;
    const competitorCount = db.prepare('SELECT COUNT(*) as count FROM competitors').get().count;
    const categories = db.prepare('SELECT category, COUNT(*) as count FROM inventories GROUP BY category ORDER BY count DESC').all();

    res.json({
      success: true,
      data: { total, active, newThisWeek, avgCpm: Math.round(avgCpm || 0), competitorCount, categories },
      error: null, timestamp: new Date().toISOString()
    });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

inventoriesRouter.get('/discovery', async (req, res) => {
  try {
    const snapshot = await scannerService.getDiscoverySnapshot();
    res.json({ success: true, data: snapshot, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

inventoriesRouter.post('/sync', async (req, res) => {
  try {
    const snapshot = await scannerService.syncDiscoverySnapshot({ reason: 'manual' });
    res.json({ success: true, data: snapshot, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

inventoriesRouter.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const inventory = db.prepare('SELECT * FROM inventories WHERE id = ?').get(req.params.id);
    if (!inventory) return res.status(404).json({ success: false, data: null, error: 'Inventory not found', timestamp: new Date().toISOString() });

    const benchmark = agents.compareWithBenchmark(req.params.id);
    const competitors = db.prepare(`
      SELECT cs.*, c.name as competitor_name
      FROM competitor_spends cs
      JOIN competitors c ON cs.competitor_id = c.id
      WHERE cs.inventory_id = ?
    `).all(req.params.id);
    const formats = db.prepare('SELECT * FROM ad_format_scores WHERE inventory_id = ? ORDER BY score DESC').all(req.params.id);
    const insights = db.prepare('SELECT * FROM ai_insights WHERE inventory_id = ? ORDER BY created_at DESC').all(req.params.id);

    res.json({
      success: true,
      data: { ...inventory, benchmark, competitors, formats, insights },
      error: null, timestamp: new Date().toISOString()
    });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

// ==================== META ROUTES ====================
const metaRouter = express.Router();

metaRouter.get('/ads/all', (req, res) => {
  try {
    const db = getDb();
    const ads = db.prepare(`
      SELECT ma.*, c.name as competitor_name
      FROM meta_ads ma
      LEFT JOIN competitors c ON ma.competitor_id = c.id
      ORDER BY ma.start_date DESC
    `).all();
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

metaRouter.get('/ads/:competitorName', async (req, res) => {
  try {
    const ads = agents.getAdsByCompetitor(req.params.competitorName);
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

metaRouter.get('/trends', (req, res) => {
  try {
    const trends = agents.getTrends();
    res.json({ success: true, data: trends, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

metaRouter.get('/longrunning', (req, res) => {
  try {
    const ads = agents.detectLongRunningAds();
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

metaRouter.get('/spend-signals', (req, res) => {
  try {
    const signals = agents.extractSpendSignals();
    res.json({ success: true, data: signals, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

metaRouter.post('/refresh', async (req, res) => {
  try {
    const result = await agents.refreshAllMetaCompetitors();
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

// ==================== ONBOARDING ROUTES ====================
const onboardingRouter = express.Router();

onboardingRouter.get('/:inventoryId', async (req, res) => {
  try {
    const guide = await agents.getOnboardingGuide(req.params.inventoryId);
    res.json({ success: true, data: guide, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

onboardingRouter.post('/:inventoryId/regenerate', async (req, res) => {
  try {
    const guide = await agents.regenerateGuide(req.params.inventoryId);
    res.json({ success: true, data: guide, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

// ==================== PRICING ROUTES ====================
const pricingRouter = express.Router();

pricingRouter.get('/', (req, res) => {
  try {
    const pricing = agents.getAllPricing();
    res.json({ success: true, data: pricing, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

pricingRouter.get('/compare', (req, res) => {
  try {
    const ids = req.query.ids ? req.query.ids.split(',') : [];
    if (ids.length === 0) return res.status(400).json({ success: false, data: null, error: 'Missing ids query parameter (comma-separated)', timestamp: new Date().toISOString() });
    const comparison = agents.comparePricing(ids);
    res.json({ success: true, data: comparison, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

pricingRouter.get('/:inventoryId', (req, res) => {
  try {
    const pricing = agents.getPricingData(req.params.inventoryId);
    res.json({ success: true, data: pricing, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

pricingRouter.post('/refresh', async (req, res) => {
  try {
    const result = await agents.updatePricing();
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

// ==================== SYNTHESIS ROUTES ====================
const synthesisRouter = express.Router();

synthesisRouter.get('/competitor/:competitorId', async (req, res) => {
  try {
    const profile = await agents.buildCompetitorAdProfile(req.params.competitorId);
    res.json({ success: true, data: profile, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

synthesisRouter.get('/patterns', (req, res) => {
  try {
    const patterns = agents.detectCampaignPatterns();
    res.json({ success: true, data: patterns, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

synthesisRouter.get('/alerts', (req, res) => {
  try {
    const alerts = agents.generateCompetitiveAlerts();
    res.json({ success: true, data: alerts, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

synthesisRouter.get('/gap-report', (req, res) => {
  try {
    const report = agents.buildUnivestGapReport();
    res.json({ success: true, data: report, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

synthesisRouter.post('/run', async (req, res) => {
  try {
    const result = await agents.runSynthesis();
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() }); }
});

// ==================== INVENTORY ENGINE ROUTES ====================
const inventoryEngineRouter = express.Router();

// Import inventory engine (try/catch in case not yet available)
let inventoryEngine;
try {
  inventoryEngine = require('../inventory-engine');
} catch (e) {
  console.warn('[Routes] inventory-engine.js not found, engine routes will return 503');
}

function engineMiddleware(req, res, next) {
  if (!inventoryEngine) return res.status(503).json({ success: false, error: 'Inventory engine not loaded', timestamp: new Date().toISOString() });
  next();
}

function buildEngineDateRange(query = {}) {
  return {
    since: query.since || query.start || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
    until: query.until || query.end || new Date().toISOString().slice(0, 10)
  };
}

function normalizeBenchmarkEntry(entry) {
  const confidenceMap = {
    high: 'high',
    medium: 'medium',
    low: 'low',
    insufficient: 'low',
    partial: 'medium',
    error: 'low'
  };
  const rawConfidence = String(entry.data_confidence || 'INSUFFICIENT').toLowerCase();

  return {
    ...entry,
    confidence: confidenceMap[rawConfidence] || 'low',
    badge: entry.winner_tier ? String(entry.winner_tier).toLowerCase() : null
  };
}

async function resolveCampaignTarget(rawId) {
  const requestedId = String(rawId || '').trim();
  const nameMap = await inventoryEngine.resolveInventoryNames();

  if (!requestedId) {
    return { requestedId, campaignId: null, adsetId: null, displayName: 'Unknown', nameMap };
  }

  const directEntry = nameMap[requestedId];
  if (directEntry && directEntry.campaign_id) {
    return {
      requestedId,
      campaignId: String(directEntry.campaign_id),
      adsetId: requestedId,
      displayName: directEntry.campaign_name || directEntry.adset_name || requestedId,
      campaignName: directEntry.campaign_name || null,
      nameMap
    };
  }

  const matchingCampaign = Object.entries(nameMap).find(([, info]) => String(info.campaign_id || '') === requestedId);
  if (matchingCampaign) {
    const [adsetId, info] = matchingCampaign;
    return {
      requestedId,
      campaignId: requestedId,
      adsetId,
      displayName: info.campaign_name || info.adset_name || requestedId,
      campaignName: info.campaign_name || null,
      nameMap
    };
  }

  return {
    requestedId,
    campaignId: requestedId,
    adsetId: null,
    displayName: inventoryEngine.getInventoryDisplayName(requestedId, nameMap),
    campaignName: null,
    nameMap
  };
}

// GET /api/inventory/benchmark/all — benchmark table for all inventories
inventoryEngineRouter.get('/benchmark/all', engineMiddleware, async (req, res) => {
  try {
    const nameMap = await inventoryEngine.resolveInventoryNames();
    const dateRange = buildEngineDateRange(req.query);

    // Group adsets under their campaign IDs so winner scoring is done per campaign.
    const campaignMap = new Map();
    for (const [adsetId, info] of Object.entries(nameMap)) {
      const campaignId = String(info.campaign_id || '').trim();
      if (!campaignId) continue;

      if (!campaignMap.has(campaignId)) {
        campaignMap.set(campaignId, {
          id: campaignId,
          campaign_id: campaignId,
          campaign_name: info.campaign_name || null,
          display_name: info.campaign_name || info.adset_name || `Campaign:${campaignId}`,
          adset_ids: [adsetId],
          adset_count: 1
        });
      } else {
        const existing = campaignMap.get(campaignId);
        existing.adset_ids.push(adsetId);
        existing.adset_count = existing.adset_ids.length;
      }
    }

    const campaignIds = [...campaignMap.keys()];
    if (campaignIds.length === 0) {
      return res.json({ success: true, data: {}, rows: [], nameMap, timestamp: new Date().toISOString() });
    }

    const metricsByCampaign = await inventoryEngine.calculateD6CACByCampaign(campaignIds, dateRange);
    const winners = inventoryEngine.identifyWinners(
      campaignIds.map(campaignId => ({
        ...campaignMap.get(campaignId),
        ...(metricsByCampaign[campaignId] || {})
      }))
    ).map(normalizeBenchmarkEntry);

    const benchmarkMap = Object.fromEntries(winners.map(entry => [String(entry.id), entry]));
    res.json({ success: true, data: benchmarkMap, rows: winners, nameMap, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[InventoryEngine] benchmark/all error:', err.message);
    res.status(500).json({ success: false, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /api/inventory/:id/d6cac — D6 CAC for specific inventory
inventoryEngineRouter.get('/:id/d6cac', engineMiddleware, async (req, res) => {
  try {
    const dateRange = buildEngineDateRange(req.query);
    const target = await resolveCampaignTarget(req.params.id);
    const metrics = await inventoryEngine.calculateD6CAC([target.campaignId], dateRange);

    res.json({
      success: true,
      data: normalizeBenchmarkEntry({
        requested_id: target.requestedId,
        campaign_id: target.campaignId,
        adset_id: target.adsetId,
        display_name: target.displayName,
        campaign_name: target.campaignName,
        ...metrics
      }),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, timestamp: new Date().toISOString() });
  }
});

// POST /api/inventory/budget-project — Project budget outcome
inventoryEngineRouter.post('/budget-project', engineMiddleware, async (req, res) => {
  try {
    const { budget, benchmarks } = req.body;
    if (!budget || !benchmarks) return res.status(400).json({ success: false, error: 'budget and benchmarks required', timestamp: new Date().toISOString() });
    const projection = inventoryEngine.projectBudgetOutcome(budget, benchmarks);
    res.json({ success: true, data: projection, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, timestamp: new Date().toISOString() });
  }
});

// POST /api/inventory/recommendations — AI recommendations
inventoryEngineRouter.post('/recommendations', engineMiddleware, async (req, res) => {
  try {
    const { inventories, totalBudget, vertical } = req.body;
    if (!inventories) return res.status(400).json({ success: false, error: 'inventories required', timestamp: new Date().toISOString() });
    const recommendations = await inventoryEngine.generateInventoryRecommendations(
      inventories, totalBudget || 1000000, vertical || 'Advisory'
    );
    res.json({ success: true, data: recommendations, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /api/inventory/names — Resolve all inventory names
inventoryEngineRouter.get('/names', engineMiddleware, async (req, res) => {
  try {
    const nameMap = await inventoryEngine.resolveInventoryNames();
    res.json({ success: true, data: nameMap, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, timestamp: new Date().toISOString() });
  }
});

// ==================== EXPORTS ====================
module.exports = {
  budgetRouter,
  competitorsRouter,
  discoveryRouter,
  formatsRouter,
  googleRouter,
  insightsRouter,
  inventoriesRouter,
  metaRouter,
  onboardingRouter,
  pricingRouter,
  synthesisRouter,
  inventoryEngineRouter
};
