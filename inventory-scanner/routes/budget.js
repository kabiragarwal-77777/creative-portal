const express = require('express');
const router = express.Router();
const budgetAgent = require('../agents/budgetAgent');

// GET /compare - compare budgets for multiple inventories (must be before /:inventoryId)
router.get('/compare', (req, res) => {
  try {
    const ids = req.query.ids ? req.query.ids.split(',') : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, data: null, error: 'Missing ids query parameter (comma-separated)', timestamp: new Date().toISOString() });
    }
    const comparison = budgetAgent.compareBudgets(ids);
    res.json({ success: true, data: comparison, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /:inventoryId - budget recommendation for inventory
router.get('/:inventoryId', (req, res) => {
  try {
    const recommendation = budgetAgent.getBudgetRecommendation(req.params.inventoryId);
    res.json({ success: true, data: recommendation, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
