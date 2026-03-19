const express = require('express');
const router = express.Router();
const metaAdLibraryAgent = require('../agents/metaAdLibraryAgent');
const { getDb } = require('../database/db');

// GET /ads/all - all meta ads across competitors
router.get('/ads/all', (req, res) => {
  try {
    const db = getDb();
    const ads = db.prepare(`
      SELECT ma.*, c.name as competitor_name
      FROM meta_ads ma
      LEFT JOIN competitors c ON ma.competitor_id = c.id
      ORDER BY ma.start_date DESC
    `).all();
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /ads/:competitorName - meta ads for a competitor
router.get('/ads/:competitorName', async (req, res) => {
  try {
    const ads = metaAdLibraryAgent.getAdsByCompetitor(req.params.competitorName);
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /trends - theme trends across competitors
router.get('/trends', (req, res) => {
  try {
    const trends = metaAdLibraryAgent.getTrends();
    res.json({ success: true, data: trends, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /longrunning - ads running 30+ days
router.get('/longrunning', (req, res) => {
  try {
    const ads = metaAdLibraryAgent.detectLongRunningAds();
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /spend-signals - spend signals from ad patterns
router.get('/spend-signals', (req, res) => {
  try {
    const signals = metaAdLibraryAgent.extractSpendSignals();
    res.json({ success: true, data: signals, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// POST /refresh - full refresh of all competitor ads
router.post('/refresh', async (req, res) => {
  try {
    const result = await metaAdLibraryAgent.refreshAllCompetitors();
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
