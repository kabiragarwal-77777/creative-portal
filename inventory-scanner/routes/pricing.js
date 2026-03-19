const express = require('express');
const router = express.Router();
const pricingAgent = require('../agents/pricingAgent');

// GET / - all pricing data
router.get('/', (req, res) => {
  try {
    const pricing = pricingAgent.getAllPricing();
    res.json({ success: true, data: pricing, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /compare - compare pricing for multiple inventories
router.get('/compare', (req, res) => {
  try {
    const ids = req.query.ids ? req.query.ids.split(',') : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, data: null, error: 'Missing ids query parameter (comma-separated)', timestamp: new Date().toISOString() });
    }
    const comparison = pricingAgent.comparePricing(ids);
    res.json({ success: true, data: comparison, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /:inventoryId - pricing for single inventory
router.get('/:inventoryId', (req, res) => {
  try {
    const pricing = pricingAgent.getPricingData(req.params.inventoryId);
    res.json({ success: true, data: pricing, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// POST /refresh - trigger pricing update
router.post('/refresh', async (req, res) => {
  try {
    const result = await pricingAgent.updatePricing();
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
