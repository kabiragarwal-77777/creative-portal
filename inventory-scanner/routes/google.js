const express = require('express');
const router = express.Router();
const googleAdsAgent = require('../agents/googleAdsAgent');
const { getDb } = require('../database/db');

// GET /ads/all - all google ads across competitors
router.get('/ads/all', (req, res) => {
  try {
    const db = getDb();
    const ads = db.prepare(`
      SELECT ga.*, c.name as competitor_name
      FROM google_ads ga
      LEFT JOIN competitors c ON ga.competitor_id = c.id
      ORDER BY ga.first_shown DESC
    `).all();
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /ads/:competitorName - google ads for a competitor
router.get('/ads/:competitorName', async (req, res) => {
  try {
    const ads = await googleAdsAgent.fetchGoogleAds(req.params.competitorName);
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /youtube/:competitorName - youtube ads for a competitor
router.get('/youtube/:competitorName', async (req, res) => {
  try {
    const ads = await googleAdsAgent.fetchCompetitorYouTubeAds(req.params.competitorName);
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /search-ads - all search ads
router.get('/search-ads', (req, res) => {
  try {
    const db = getDb();
    const ads = db.prepare(`
      SELECT sa.*, c.name as competitor_name
      FROM search_ads sa
      LEFT JOIN competitors c ON sa.competitor_id = c.id
      ORDER BY sa.captured_date DESC
    `).all();
    res.json({ success: true, data: ads, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /keyword-gaps - keyword gap analysis
router.get('/keyword-gaps', (req, res) => {
  try {
    const gaps = googleAdsAgent.getKeywordGaps();
    res.json({ success: true, data: gaps, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// POST /refresh - full refresh of google ads data
router.post('/refresh', async (req, res) => {
  try {
    const result = await googleAdsAgent.refreshAllCompetitors();
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
