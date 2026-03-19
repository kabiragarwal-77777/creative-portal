const express = require('express');
const router = express.Router();
const adSynthesisAgent = require('../agents/adSynthesisAgent');

// GET /competitor/:competitorId - unified competitor ad profile
router.get('/competitor/:competitorId', async (req, res) => {
  try {
    const profile = await adSynthesisAgent.buildCompetitorAdProfile(req.params.competitorId);
    res.json({ success: true, data: profile, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /patterns - campaign patterns across competitors
router.get('/patterns', (req, res) => {
  try {
    const patterns = adSynthesisAgent.detectCampaignPatterns();
    res.json({ success: true, data: patterns, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /alerts - competitive alerts
router.get('/alerts', (req, res) => {
  try {
    const alerts = adSynthesisAgent.generateCompetitiveAlerts();
    res.json({ success: true, data: alerts, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /gap-report - Univest gap report
router.get('/gap-report', (req, res) => {
  try {
    const report = adSynthesisAgent.buildUnivestGapReport();
    res.json({ success: true, data: report, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// POST /run - trigger full synthesis
router.post('/run', async (req, res) => {
  try {
    const result = await adSynthesisAgent.runSynthesis();
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
