const express = require('express');
const router = express.Router();
const onboardingAgent = require('../agents/onboardingAgent');

// GET /:inventoryId - get onboarding guide (generates if missing)
router.get('/:inventoryId', async (req, res) => {
  try {
    const guide = await onboardingAgent.getOnboardingGuide(req.params.inventoryId);
    res.json({ success: true, data: guide, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

// POST /:inventoryId/regenerate - force regenerate guide
router.post('/:inventoryId/regenerate', async (req, res) => {
  try {
    const guide = await onboardingAgent.regenerateGuide(req.params.inventoryId);
    res.json({ success: true, data: guide, error: null, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, data: null, error: err.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
