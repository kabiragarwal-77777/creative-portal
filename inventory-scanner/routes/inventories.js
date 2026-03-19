const express = require('express');
const router = express.Router();
const { getDb } = require('../database/db');
const existingInventoryAgent = require('../agents/existingInventoryAgent');

// GET / - all inventories with optional filters
router.get('/', (req, res) => {
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

    // Attach competitor count for each
    const competitorCountStmt = db.prepare('SELECT COUNT(DISTINCT competitor_id) as count FROM competitor_spends WHERE inventory_id = ?');
    const formatCountStmt = db.prepare('SELECT COUNT(*) as count FROM ad_format_scores WHERE inventory_id = ?');

    const enriched = inventories.map(inv => ({
      ...inv,
      competitor_count: competitorCountStmt.get(inv.id)?.count || 0,
      format_count: formatCountStmt.get(inv.id)?.count || 0
    }));

    res.json({ success: true, data: enriched, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /existing - Univest's current inventories
router.get('/existing', (req, res) => {
  try {
    const data = existingInventoryAgent.getExistingInventories();
    const benchmarks = existingInventoryAgent.getAllBenchmarks();
    res.json({ success: true, data: benchmarks, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /new - recently discovered
router.get('/new', (req, res) => {
  try {
    const db = getDb();
    const newInvs = db.prepare("SELECT * FROM inventories WHERE status = 'new' AND created_at >= datetime('now', '-7 days') ORDER BY created_at DESC").all();
    res.json({ success: true, data: newInvs, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /stats - dashboard stats
router.get('/stats', (req, res) => {
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
      error: null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /:id - single inventory detail
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const inventory = db.prepare('SELECT * FROM inventories WHERE id = ?').get(req.params.id);
    if (!inventory) return res.status(404).json({ success: false, data: null, error: 'Inventory not found', timestamp: new Date().toISOString() });

    const benchmark = existingInventoryAgent.compareWithBenchmark(req.params.id);
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
      error: null,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
