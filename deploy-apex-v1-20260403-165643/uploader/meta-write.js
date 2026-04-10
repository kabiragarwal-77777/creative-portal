// =============================================================================
// Meta API Write Operations — proxied through server to protect token
// Mounted at /api/meta-write
// =============================================================================

const express = require('express');
const router = express.Router();

const META_API_BASE = 'https://graph.facebook.com/v21.0';

function resolveMetaAuth(body) {
    return {
        access_token: (body && body.access_token) || process.env.META_ACCESS_TOKEN || '',
        appsecret_proof: (body && body.appsecret_proof) || process.env.META_APP_SECRET_PROOF || '',
    };
}

// Helper: make a POST to Meta Graph API
async function metaPost(entityId, params) {
    const url = `${META_API_BASE}/${entityId}`;
    const body = new URLSearchParams(params);
    const response = await fetch(url, { method: 'POST', body });
    const data = await response.json();
    if (data.error) throw new Error(data.error.message);
    return data;
}

// PAUSE or ACTIVATE an ad
router.post('/ad/:adId/status', async (req, res) => {
    const { adId } = req.params;
    const { status } = req.body;
    const { access_token, appsecret_proof } = resolveMetaAuth(req.body);
    if (!['PAUSED', 'ACTIVE'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid status. Must be PAUSED or ACTIVE.' });
    }
    if (!access_token) return res.status(401).json({ success: false, error: 'Missing access_token' });
    try {
        const data = await metaPost(adId, { status, access_token, appsecret_proof });
        console.log(`[MetaWrite] Ad ${adId} → ${status}`, new Date().toISOString());
        res.json({ success: true, ad_id: adId, new_status: status, meta_response: data });
    } catch (err) {
        console.error(`[MetaWrite] Ad ${adId} status change failed:`, err.message);
        res.status(500).json({ success: false, error: err.message, ad_id: adId });
    }
});

// PAUSE or ACTIVATE an adset
router.post('/adset/:adsetId/status', async (req, res) => {
    const { adsetId } = req.params;
    const { status } = req.body;
    const { access_token, appsecret_proof } = resolveMetaAuth(req.body);
    if (!['PAUSED', 'ACTIVE'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    if (!access_token) return res.status(401).json({ success: false, error: 'Missing access_token' });
    try {
        const data = await metaPost(adsetId, { status, access_token, appsecret_proof });
        console.log(`[MetaWrite] Adset ${adsetId} → ${status}`, new Date().toISOString());
        res.json({ success: true, adset_id: adsetId, new_status: status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, adset_id: adsetId });
    }
});

// UPDATE adset daily budget (Meta expects cents)
router.post('/adset/:adsetId/budget', async (req, res) => {
    const { adsetId } = req.params;
    const { daily_budget_cents } = req.body;
    const { access_token, appsecret_proof } = resolveMetaAuth(req.body);
    if (!daily_budget_cents || daily_budget_cents < 100) {
        return res.status(400).json({ success: false, error: 'Budget too low. Minimum 100 cents (₹1).' });
    }
    if (!access_token) return res.status(401).json({ success: false, error: 'Missing access_token' });
    try {
        const data = await metaPost(adsetId, {
            daily_budget: daily_budget_cents.toString(),
            access_token, appsecret_proof
        });
        console.log(`[MetaWrite] Adset ${adsetId} budget → ₹${daily_budget_cents / 100}`, new Date().toISOString());
        res.json({ success: true, adset_id: adsetId, new_daily_budget_cents: daily_budget_cents });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, adset_id: adsetId });
    }
});

// PAUSE or ACTIVATE a campaign
router.post('/campaign/:campaignId/status', async (req, res) => {
    const { campaignId } = req.params;
    const { status } = req.body;
    const { access_token, appsecret_proof } = resolveMetaAuth(req.body);
    if (!['PAUSED', 'ACTIVE'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid status' });
    }
    if (!access_token) return res.status(401).json({ success: false, error: 'Missing access_token' });
    try {
        const data = await metaPost(campaignId, { status, access_token, appsecret_proof });
        console.log(`[MetaWrite] Campaign ${campaignId} → ${status}`, new Date().toISOString());
        res.json({ success: true, campaign_id: campaignId, new_status: status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, campaign_id: campaignId });
    }
});

// UPDATE campaign daily budget (Meta expects cents)
router.post('/campaign/:campaignId/budget', async (req, res) => {
    const { campaignId } = req.params;
    const { daily_budget_cents } = req.body;
    const { access_token, appsecret_proof } = resolveMetaAuth(req.body);
    if (!daily_budget_cents || daily_budget_cents < 100) {
        return res.status(400).json({ success: false, error: 'Budget too low. Minimum 100 cents (INR 1).' });
    }
    if (!access_token) return res.status(401).json({ success: false, error: 'Missing access_token' });
    try {
        const data = await metaPost(campaignId, {
            daily_budget: daily_budget_cents.toString(),
            access_token, appsecret_proof
        });
        console.log(`[MetaWrite] Campaign ${campaignId} budget -> INR ${daily_budget_cents / 100}`, new Date().toISOString());
        res.json({ success: true, campaign_id: campaignId, new_daily_budget_cents: daily_budget_cents, meta_response: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, campaign_id: campaignId });
    }
});

// BATCH execute multiple actions (sequential with rate limit delay)
router.post('/batch', async (req, res) => {
    const { actions } = req.body;
    const { access_token, appsecret_proof } = resolveMetaAuth(req.body);
    if (!Array.isArray(actions) || !actions.length) {
        return res.status(400).json({ success: false, error: 'No actions provided' });
    }
    if (!access_token) return res.status(401).json({ success: false, error: 'Missing access_token' });

    const results = [];
    for (const action of actions) {
        await new Promise(r => setTimeout(r, 300)); // rate limit delay
        try {
            let params = { access_token, appsecret_proof };
            if (action.action_type === 'UPDATE_ADSET_BUDGET' || action.action_type === 'UPDATE_CAMPAIGN_BUDGET') {
                params.daily_budget = (action.new_daily_budget * 100).toString();
            } else if (action.new_status) {
                params.status = action.new_status;
            }
            const data = await metaPost(action.entity_id, params);
            results.push({ action_id: action.action_id, entity_id: action.entity_id, success: true });
            console.log(`[MetaBatch] ${action.action_id} ${action.entity_type} ${action.entity_id} → SUCCESS`);
        } catch (err) {
            results.push({ action_id: action.action_id, entity_id: action.entity_id, success: false, error: err.message });
            console.error(`[MetaBatch] ${action.action_id} FAILED:`, err.message);
        }
    }
    const succeeded = results.filter(r => r.success).length;
    res.json({ success: true, total: actions.length, succeeded, failed: actions.length - succeeded, results });
});

module.exports = router;
