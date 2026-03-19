const express = require('express');
const router = express.Router();
const discoveryAgent = require('../agents/discoveryAgent');

// POST /run - trigger discovery scan
router.post('/run', async (req, res) => {
  try {
    const results = await discoveryAgent.runDiscovery();
    res.json({ success: true, data: results, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /log - all discovery logs
router.get('/log', (req, res) => {
  try {
    const logs = discoveryAgent.getDiscoveryLog();
    res.json({ success: true, data: logs, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// GET /new - newly discovered inventories
router.get('/new', (req, res) => {
  try {
    const newInventories = discoveryAgent.getNewInventories();
    res.json({ success: true, data: newInventories, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
