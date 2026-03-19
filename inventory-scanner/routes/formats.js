const express = require('express');
const router = express.Router();
const adFormatAgent = require('../agents/adFormatAgent');

// GET /:inventoryId - format recommendations for inventory
router.get('/:inventoryId', (req, res) => {
  try {
    const recommendations = adFormatAgent.getFormatRecommendations(req.params.inventoryId);
    res.json({ success: true, data: recommendations, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
