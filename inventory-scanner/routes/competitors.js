const express = require('express');
const router = express.Router();
const competitorAgent = require('../agents/competitorAgent');

// GET / - all competitors
router.get('/', (req, res) => {
  try {
    const competitors = competitorAgent.getAllCompetitors();
    res.json({ success: true, data: competitors, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /whitespace - whitespace opportunities
router.get('/whitespace', (req, res) => {
  try {
    const whitespace = competitorAgent.getWhitespace();
    res.json({ success: true, data: whitespace, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /inventory/:inventoryId - competitor spends for an inventory
router.get('/inventory/:inventoryId', (req, res) => {
  try {
    const spends = competitorAgent.getCompetitorSpends(req.params.inventoryId);
    res.json({ success: true, data: spends, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /:competitorId/spend - full competitor profile
router.get('/:competitorId/spend', (req, res) => {
  try {
    const profile = competitorAgent.getCompetitorProfile(req.params.competitorId);
    res.json({ success: true, data: profile, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /:competitorId/advantages/:inventoryId - advantages/disadvantages
router.get('/:competitorId/advantages/:inventoryId', (req, res) => {
  try {
    const advantages = competitorAgent.getAdvantages(req.params.competitorId, req.params.inventoryId);
    res.json({ success: true, data: advantages, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// POST /refresh - refresh competitor data
router.post('/refresh', async (req, res) => {
  try {
    const result = await competitorAgent.refreshCompetitorData();
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
