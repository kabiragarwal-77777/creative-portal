const express = require('express');
const router = express.Router();
const aiInsightAgent = require('../agents/aiInsightAgent');

// GET / - all insights, optional ?unread=true filter
router.get('/', (req, res) => {
  try {
    const unreadOnly = req.query.unread === 'true';
    const insights = aiInsightAgent.getInsights(unreadOnly);
    res.json({ success: true, data: insights, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// POST /generate - trigger insight generation
router.post('/generate', async (req, res) => {
  try {
    const result = await aiInsightAgent.generateInsights();
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// PUT /:id/read - mark insight as read
router.put('/:id/read', (req, res) => {
  try {
    const result = aiInsightAgent.markAsRead(req.params.id);
    res.json({ success: true, data: result, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /inventory/:inventoryId - insights for specific inventory
router.get('/inventory/:inventoryId', (req, res) => {
  try {
    const insights = aiInsightAgent.getInsightsForInventory(req.params.inventoryId);
    res.json({ success: true, data: insights, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
