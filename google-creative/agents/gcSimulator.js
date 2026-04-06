/**
 * gcSimulator.js — ROAS prediction simulator for new Google ad creatives
 * Predicts d7/d30/d60/d120/d365 ROAS before a creative goes live
 * Uses historical creative similarity + OpenAI for prediction
 */

const { getGcDb } = require('../db/gc-db');

// ── Signal vector conversion ──────────────────────────────────────────────

const CTA_STRENGTH_MAP = { none: 0, weak: 1, medium: 2, strong: 3 };
const TONE_MAP = { neutral: 0, informative: 1, urgent: 2, emotional: 3, humorous: 4, authoritative: 5 };
const HOOK_STRENGTH_MAP = { none: 0, weak: 1, medium: 2, strong: 3 };
const DURATION_BUCKET_MAP = { short: 0, medium: 1, long: 2, very_long: 3 };
const VISUAL_COMPLEXITY_MAP = { low: 0, medium: 1, high: 2 };

function safeNum(val, fallback = 0) {
    const n = Number(val);
    return isNaN(n) ? fallback : n;
}

function signalsToVector(signals, adType) {
    if (!signals) return [];
    const s = typeof signals === 'string' ? JSON.parse(signals) : signals;

    if (adType === 'RSA') {
        return [
            safeNum(s.headline_count),
            safeNum(s.description_count),
            s.has_price ? 1 : 0,
            s.has_number ? 1 : 0,
            s.has_percentage ? 1 : 0,
            s.has_emoji ? 1 : 0,
            s.has_question ? 1 : 0,
            s.has_exclamation ? 1 : 0,
            CTA_STRENGTH_MAP[s.cta_strength] || 0,
            safeNum(s.avg_headline_length),
            safeNum(s.avg_description_length),
            s.mentions_brand ? 1 : 0,
            s.mentions_offer ? 1 : 0,
            s.mentions_urgency ? 1 : 0,
            TONE_MAP[s.tone] || 0
        ];
    }

    if (adType === 'VIDEO') {
        return [
            DURATION_BUCKET_MAP[s.duration_bucket] || 0,
            HOOK_STRENGTH_MAP[s.hook_strength] || 0,
            TONE_MAP[s.tone] || 0,
            s.has_cta ? 1 : 0,
            s.has_text_overlay ? 1 : 0,
            s.has_music ? 1 : 0,
            s.has_voiceover ? 1 : 0,
            s.has_face ? 1 : 0,
            s.has_product_demo ? 1 : 0,
            safeNum(s.estimated_duration_seconds),
            s.is_vertical ? 1 : 0,
            VISUAL_COMPLEXITY_MAP[s.visual_complexity] || 0
        ];
    }

    if (adType === 'PMAX') {
        return [
            safeNum(s.asset_count),
            safeNum(s.headline_count),
            safeNum(s.description_count),
            safeNum(s.image_count),
            safeNum(s.video_count),
            s.has_price ? 1 : 0,
            s.has_offer ? 1 : 0,
            CTA_STRENGTH_MAP[s.cta_strength] || 0,
            TONE_MAP[s.tone] || 0,
            s.mentions_brand ? 1 : 0,
            s.mentions_urgency ? 1 : 0
        ];
    }

    if (adType === 'DISPLAY') {
        return [
            VISUAL_COMPLEXITY_MAP[s.visual_complexity] || 0,
            s.has_text ? 1 : 0,
            s.has_logo ? 1 : 0,
            s.has_cta_button ? 1 : 0,
            s.has_price ? 1 : 0,
            s.has_offer ? 1 : 0,
            CTA_STRENGTH_MAP[s.cta_strength] || 0,
            TONE_MAP[s.tone] || 0,
            safeNum(s.text_density),
            s.mentions_brand ? 1 : 0
        ];
    }

    // Fallback: extract all numeric-ish values
    return Object.values(s).map(v => safeNum(v));
}

function cosineSimilarity(a, b) {
    if (!a.length || !b.length) return 0;
    const len = Math.min(a.length, b.length);
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < len; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    magA = Math.sqrt(magA);
    magB = Math.sqrt(magB);
    if (magA === 0 || magB === 0) return 0;
    return dot / (magA * magB);
}

// ── Rule-based headline analysis (RSA) ───────────────────────────────────

function analyzeRsaSignals(headlines, descriptions) {
    const allHeadlineText = (headlines || []).join(' ');
    const allDescText = (descriptions || []).join(' ');
    const combined = allHeadlineText + ' ' + allDescText;

    const pricePattern = /₹|rs\.?|inr|price|free|cost|\d+%\s*off/i;
    const numberPattern = /\d+/;
    const percentPattern = /\d+\s*%/;
    const questionPattern = /\?/;
    const exclamationPattern = /!/;
    const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/u;
    const urgencyWords = /limited|hurry|now|today|last chance|don'?t miss|ending|offer ends/i;
    const offerWords = /offer|discount|bonus|cashback|reward|free|deal/i;
    const brandWords = /univest/i;
    const ctaWords = /download|install|sign up|start|invest|open|get|try|join|apply|click|tap/i;

    let ctaStrength = 'none';
    if (ctaWords.test(combined)) {
        const ctaCount = (combined.match(new RegExp(ctaWords.source, 'gi')) || []).length;
        ctaStrength = ctaCount >= 3 ? 'strong' : ctaCount >= 1 ? 'medium' : 'weak';
    }

    const avgHeadlineLen = headlines.length
        ? headlines.reduce((s, h) => s + h.length, 0) / headlines.length
        : 0;
    const avgDescLen = descriptions.length
        ? descriptions.reduce((s, d) => s + d.length, 0) / descriptions.length
        : 0;

    let tone = 'neutral';
    if (urgencyWords.test(combined)) tone = 'urgent';
    else if (questionPattern.test(allHeadlineText)) tone = 'informative';
    else if (exclamationPattern.test(combined) && emojiPattern.test(combined)) tone = 'emotional';

    return {
        headline_count: headlines.length,
        description_count: descriptions.length,
        has_price: pricePattern.test(combined),
        has_number: numberPattern.test(combined),
        has_percentage: percentPattern.test(combined),
        has_emoji: emojiPattern.test(combined),
        has_question: questionPattern.test(allHeadlineText),
        has_exclamation: exclamationPattern.test(combined),
        cta_strength: ctaStrength,
        avg_headline_length: Math.round(avgHeadlineLen),
        avg_description_length: Math.round(avgDescLen),
        mentions_brand: brandWords.test(combined),
        mentions_offer: offerWords.test(combined),
        mentions_urgency: urgencyWords.test(combined),
        tone
    };
}

// ── AI classification for non-RSA types ──────────────────────────────────

async function classifyWithAI(adType, contentDescription) {
    const signalSchemas = {
        VIDEO: '{"duration_bucket":"short|medium|long|very_long","hook_strength":"none|weak|medium|strong","tone":"neutral|informative|urgent|emotional|humorous|authoritative","has_cta":bool,"has_text_overlay":bool,"has_music":bool,"has_voiceover":bool,"has_face":bool,"has_product_demo":bool,"estimated_duration_seconds":num,"is_vertical":bool,"visual_complexity":"low|medium|high"}',
        PMAX: '{"asset_count":num,"headline_count":num,"description_count":num,"image_count":num,"video_count":num,"has_price":bool,"has_offer":bool,"cta_strength":"none|weak|medium|strong","tone":"neutral|informative|urgent|emotional|humorous|authoritative","mentions_brand":bool,"mentions_urgency":bool}',
        DISPLAY: '{"visual_complexity":"low|medium|high","has_text":bool,"has_logo":bool,"has_cta_button":bool,"has_price":bool,"has_offer":bool,"cta_strength":"none|weak|medium|strong","tone":"neutral|informative|urgent|emotional|humorous|authoritative","text_density":0.0-1.0,"mentions_brand":bool}'
    };

    const schema = signalSchemas[adType];
    if (!schema) return {};

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-5.4-mini',
            messages: [
                {
                    role: 'system',
                    content: `You classify Google Ads creatives into signal vectors. Given a ${adType} creative description, return ONLY valid JSON matching this schema: ${schema}. Use true/false for booleans.`
                },
                {
                    role: 'user',
                    content: `Classify this ${adType} ad creative:\n${contentDescription}`
                }
            ],
            temperature: 0.2,
            max_completion_tokens: 800
        })
    });

    const data = await response.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
}

// ── Main module ──────────────────────────────────────────────────────────

module.exports = function (config) {

    // Ensure gc_simulations table exists (schema should handle it, but be safe)
    async function ensureSimulationsTable() {
        const db = await getGcDb();
        await db.exec(`CREATE TABLE IF NOT EXISTS gc_simulations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ad_type TEXT,
            creative_input_json TEXT,
            signals_json TEXT,
            similar_creatives_json TEXT,
            predicted_d7_roas REAL, predicted_d7_low REAL, predicted_d7_high REAL,
            predicted_d30_roas REAL, predicted_d30_low REAL, predicted_d30_high REAL,
            predicted_d60_roas REAL, predicted_d60_low REAL, predicted_d60_high REAL,
            predicted_d120_roas REAL, predicted_d120_low REAL, predicted_d120_high REAL,
            predicted_d365_roas REAL, predicted_d365_low REAL, predicted_d365_high REAL,
            campaign_id TEXT,
            adgroup_id TEXT,
            budget_per_day REAL,
            status TEXT DEFAULT 'active',
            raw_response TEXT,
            simulated_at TEXT DEFAULT (CURRENT_TIMESTAMP)
        )`);
    }

    ensureSimulationsTable().catch(e => console.error('[gcSimulator] Table init error:', e.message));

    /**
     * Classify a new creative into its signal vector
     */
    async function classifyNewCreative(input) {
        const { adType, headlines, descriptions, youtubeUrl, assetDescription, imageDescription } = input;

        if (adType === 'RSA') {
            const ruleSignals = analyzeRsaSignals(headlines || [], descriptions || []);
            // Enhance with AI for tone/intent refinement
            const combinedText = [
                ...(headlines || []),
                ...(descriptions || [])
            ].join('\n');

            let aiSignals = {};
            try {
                const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'gpt-5.4-mini',
                        messages: [
                            {
                                role: 'system',
                                content: 'You analyze RSA ad copy. Return ONLY valid JSON with: {"tone":"neutral|informative|urgent|emotional|humorous|authoritative","cta_strength":"none|weak|medium|strong","intent":"brand_awareness|lead_gen|app_install|conversion|retargeting"}'
                            },
                            { role: 'user', content: `Analyze:\n${combinedText}` }
                        ],
                        temperature: 0.2,
                        max_completion_tokens: 300
                    })
                });
                const data = await resp.json();
                const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
                aiSignals = JSON.parse(text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
            } catch (e) {
                console.error('[gcSimulator] AI RSA classification failed, using rule-based only:', e.message);
            }

            // Merge: AI overrides only tone/cta_strength if present, adds intent
            return {
                ...ruleSignals,
                tone: aiSignals.tone || ruleSignals.tone,
                cta_strength: aiSignals.cta_strength || ruleSignals.cta_strength,
                intent: aiSignals.intent || 'conversion'
            };
        }

        // Non-RSA: AI classification
        let description = '';
        if (adType === 'VIDEO') {
            description = `YouTube URL/ID: ${youtubeUrl || 'unknown'}. ${assetDescription || ''}`;
        } else if (adType === 'PMAX') {
            description = assetDescription || '';
        } else if (adType === 'DISPLAY') {
            description = imageDescription || assetDescription || '';
        }

        try {
            return await classifyWithAI(adType, description);
        } catch (e) {
            console.error(`[gcSimulator] AI classification failed for ${adType}:`, e.message);
            return {};
        }
    }

    /**
     * Find top-N similar historical creatives by cosine similarity
     */
    async function findSimilarCreatives(newSignals, adType, topN = 10) {
        const db = await getGcDb();
        const rows = await db.prepare(`
            SELECT
                c.id, c.ad_id, c.ad_type, c.creative_content_json,
                c.asset_performance_label, c.adset_roas, c.adset_spend,
                c.adset_conversions, c.adset_ctr,
                s.signals_json,
                sc.gcps_score, sc.roas_normalized, sc.ctr_normalized, sc.cpa_efficiency
            FROM gc_creatives c
            LEFT JOIN gc_creative_signals s ON s.creative_id = c.id
            LEFT JOIN gc_creative_scores sc ON sc.creative_id = c.id
            WHERE c.ad_type = ?
        `).all(adType);

        if (!rows.length) return [];

        const newVec = signalsToVector(newSignals, adType);

        const scored = rows.map(row => {
            let signals = {};
            try { signals = JSON.parse(row.signals_json || '{}'); } catch (e) { /* skip */ }
            const histVec = signalsToVector(signals, adType);
            const similarity = cosineSimilarity(newVec, histVec);

            return {
                creative_id: row.id,
                ad_id: row.ad_id,
                ad_type: row.ad_type,
                creative_content: row.creative_content_json,
                asset_performance_label: row.asset_performance_label,
                adset_roas: row.adset_roas,
                adset_spend: row.adset_spend,
                adset_conversions: row.adset_conversions,
                adset_ctr: row.adset_ctr,
                signals,
                gcps_score: row.gcps_score,
                roas_normalized: row.roas_normalized,
                ctr_normalized: row.ctr_normalized,
                cpa_efficiency: row.cpa_efficiency,
                similarity
            };
        });

        scored.sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, topN);
    }

    /**
     * Get current market sentiment score
     */
    async function getLatestMarketSignal() {
        const db = await getGcDb();
        const row = await db.prepare(`
            SELECT * FROM gc_market_signals ORDER BY date DESC LIMIT 1
        `).get();

        if (!row) {
            return { score: 0.5, sentiment: 'neutral', raw: null };
        }

        let signals = {};
        try { signals = JSON.parse(row.signals_json || '{}'); } catch (e) { /* skip */ }

        return {
            score: row.google_roas_correlation != null ? row.google_roas_correlation : 0.5,
            sentiment: row.market_sentiment || 'neutral',
            nifty_50: row.nifty_50,
            vix: row.vix,
            dxy: row.dxy,
            raw: signals
        };
    }

    /**
     * Build creative input JSON for storage
     */
    function buildCreativeInputJson(input) {
        const { adType, headlines, descriptions, youtubeUrl, assetDescription, imageDescription, campaignId, budget } = input;
        const obj = { ad_type: adType };
        if (adType === 'RSA') {
            obj.headlines = headlines || [];
            obj.descriptions = descriptions || [];
        } else if (adType === 'VIDEO') {
            obj.youtube_url = youtubeUrl || null;
            obj.description = assetDescription || null;
        } else if (adType === 'PMAX') {
            obj.asset_description = assetDescription || null;
        } else if (adType === 'DISPLAY') {
            obj.image_description = imageDescription || assetDescription || null;
        }
        if (campaignId) obj.campaign_id = campaignId;
        if (budget) obj.budget = budget;
        return obj;
    }

    /**
     * Call OpenAI to predict ROAS
     */
    async function predictWithAI(newSignals, similarCreatives, marketSignal) {
        const similarForPrompt = similarCreatives.map(c => ({
            ad_type: c.ad_type,
            roas: c.adset_roas,
            spend: c.adset_spend,
            conversions: c.adset_conversions,
            ctr: c.adset_ctr,
            gcps_score: c.gcps_score,
            asset_label: c.asset_performance_label,
            signals: c.signals,
            similarity: Math.round(c.similarity * 1000) / 1000
        }));

        const lowConfidenceNote = similarCreatives.length === 0
            ? '\nIMPORTANT: No historical data available. Provide conservative baseline predictions for an Indian fintech app (Univest) with wider confidence intervals.'
            : '';

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-5.4-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a Google Ads performance analyst for Univest (Indian fintech). You predict ROAS trajectories for new creatives based on historical similarity data and market conditions.'
                    },
                    {
                        role: 'user',
                        content: `Based on these ${similarCreatives.length} similar historical creatives and their ROAS curves: ${JSON.stringify(similarForPrompt)}
And this new creative's signals: ${JSON.stringify(newSignals)}
And current market sentiment score: ${JSON.stringify({ score: marketSignal.score, sentiment: marketSignal.sentiment, vix: marketSignal.vix })}${lowConfidenceNote}
Predict ROAS at day 7, 30, 60, 120, and 365 with confidence intervals.
Return ONLY valid JSON: {"day_7":{"roas":X,"low":X,"high":X},"day_30":{"roas":X,"low":X,"high":X},"day_60":{"roas":X,"low":X,"high":X},"day_120":{"roas":X,"low":X,"high":X},"day_365":{"roas":X,"low":X,"high":X}}`
                    }
                ],
                temperature: 0.4,
                max_completion_tokens: 1500
            })
        });

        const data = await response.json();
        const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return { parsed: JSON.parse(cleaned), raw: text };
    }

    /**
     * Store simulation result in gc_simulations
     */
    async function storeSimulation(adType, creativeInputJson, signals, similarCreatives, predictions, rawResponse, campaignId, adgroupId, budget) {
        const db = await getGcDb();
        const p = predictions;
        const d7 = p.day_7 || {};
        const d30 = p.day_30 || {};
        const d60 = p.day_60 || {};
        const d120 = p.day_120 || {};
        const d365 = p.day_365 || {};

        const stmt = db.prepare(`
            INSERT INTO gc_simulations (
                ad_type, creative_input_json, signals_json, similar_creatives_json,
                predicted_d7_roas, predicted_d7_low, predicted_d7_high,
                predicted_d30_roas, predicted_d30_low, predicted_d30_high,
                predicted_d60_roas, predicted_d60_low, predicted_d60_high,
                predicted_d120_roas, predicted_d120_low, predicted_d120_high,
                predicted_d365_roas, predicted_d365_low, predicted_d365_high,
                campaign_id, adgroup_id, budget_per_day, status, raw_response
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
        `);

        const result = await stmt.run(
            adType,
            JSON.stringify(creativeInputJson),
            JSON.stringify(signals),
            JSON.stringify(similarCreatives.map(c => ({
                creative_id: c.creative_id,
                ad_id: c.ad_id,
                roas: c.adset_roas,
                gcps_score: c.gcps_score,
                similarity: c.similarity
            }))),
            safeNum(d7.roas), safeNum(d7.low), safeNum(d7.high),
            safeNum(d30.roas), safeNum(d30.low), safeNum(d30.high),
            safeNum(d60.roas), safeNum(d60.low), safeNum(d60.high),
            safeNum(d120.roas), safeNum(d120.low), safeNum(d120.high),
            safeNum(d365.roas), safeNum(d365.low), safeNum(d365.high),
            campaignId || null,
            adgroupId || null,
            budget || null,
            rawResponse
        );

        return result.lastInsertRowid;
    }

    // ── Public API ─────────────────────────────────────────────────────

    /**
     * Simulate ROAS for a new creative before it goes live
     * @param {Object} input
     * @param {string} input.adType - RSA | VIDEO | PMAX | DISPLAY
     * @param {string[]} [input.headlines] - RSA headlines
     * @param {string[]} [input.descriptions] - RSA descriptions
     * @param {string} [input.youtubeUrl] - Video YouTube URL or ID
     * @param {string} [input.assetDescription] - PMax/Display description
     * @param {string} [input.imageDescription] - Display image description
     * @param {string} [input.campaignId] - Optional campaign ID
     * @param {string} [input.adgroupId] - Optional adgroup ID
     * @param {number} [input.budget] - Optional daily budget
     * @returns {Object} { simulationId, predictions, similarCreatives, signals, confidence }
     */
    async function simulateCreative(input) {
        const { adType, campaignId, adgroupId, budget } = input;

        if (!adType || !['RSA', 'VIDEO', 'PMAX', 'DISPLAY'].includes(adType)) {
            throw new Error(`Invalid adType: ${adType}. Must be RSA, VIDEO, PMAX, or DISPLAY.`);
        }

        console.log(`[gcSimulator] Starting simulation for ${adType} creative...`);

        // Step 1: Classify the new creative into signals
        const signals = await classifyNewCreative(input);
        console.log(`[gcSimulator] Classified signals:`, JSON.stringify(signals).substring(0, 200));

        // Step 2: Find similar historical creatives
        const similarCreatives = await findSimilarCreatives(signals, adType, 10);
        console.log(`[gcSimulator] Found ${similarCreatives.length} similar historical creatives`);

        // Step 3: Get market signal
        const marketSignal = await getLatestMarketSignal();
        console.log(`[gcSimulator] Market sentiment: ${marketSignal.sentiment} (score: ${marketSignal.score})`);

        // Step 4: Predict via OpenAI
        let predictions;
        let rawResponse;
        try {
            const result = await predictWithAI(signals, similarCreatives, marketSignal);
            predictions = result.parsed;
            rawResponse = result.raw;
        } catch (e) {
            console.error('[gcSimulator] AI prediction failed:', e.message);
            // Fallback: compute naive averages from similar creatives
            predictions = computeFallbackPredictions(similarCreatives);
            rawResponse = JSON.stringify({ error: e.message, fallback: true });
        }

        // Step 5: Store in gc_simulations
        const creativeInputJson = buildCreativeInputJson(input);
        const simulationId = await storeSimulation(
            adType, creativeInputJson, signals, similarCreatives,
            predictions, rawResponse, campaignId, adgroupId, budget
        );

        // Determine confidence level
        let confidence = 'high';
        if (similarCreatives.length === 0) confidence = 'low';
        else if (similarCreatives.length < 3) confidence = 'medium';
        else if (similarCreatives[0].similarity < 0.5) confidence = 'medium';

        console.log(`[gcSimulator] Simulation ${simulationId} stored. Confidence: ${confidence}`);

        return {
            simulationId: Number(simulationId),
            predictions,
            similarCreatives: similarCreatives.map(c => ({
                creative_id: c.creative_id,
                ad_id: c.ad_id,
                roas: c.adset_roas,
                spend: c.adset_spend,
                gcps_score: c.gcps_score,
                asset_label: c.asset_performance_label,
                similarity: Math.round(c.similarity * 1000) / 1000
            })),
            signals,
            confidence
        };
    }

    /**
     * Fallback predictions when AI call fails — uses average of similar creatives
     */
    function computeFallbackPredictions(similarCreatives) {
        if (!similarCreatives.length) {
            // No data at all — return conservative baseline for Indian fintech
            return {
                day_7: { roas: 0.3, low: 0.1, high: 0.6 },
                day_30: { roas: 0.8, low: 0.3, high: 1.5 },
                day_60: { roas: 1.2, low: 0.5, high: 2.2 },
                day_120: { roas: 1.8, low: 0.7, high: 3.5 },
                day_365: { roas: 2.5, low: 1.0, high: 5.0 }
            };
        }

        const avgRoas = similarCreatives.reduce((s, c) => s + (c.adset_roas || 0), 0) / similarCreatives.length;
        const roasValues = similarCreatives.map(c => c.adset_roas || 0);
        const minRoas = Math.min(...roasValues);
        const maxRoas = Math.max(...roasValues);
        const spread = Math.max(maxRoas - minRoas, avgRoas * 0.3);

        // Scale ROAS over time horizons (typical Google Ads ramp)
        const scales = { day_7: 0.25, day_30: 0.6, day_60: 0.85, day_120: 1.0, day_365: 1.15 };
        const result = {};
        for (const [key, scale] of Object.entries(scales)) {
            const predicted = avgRoas * scale;
            result[key] = {
                roas: Math.round(predicted * 100) / 100,
                low: Math.round(Math.max(0, predicted - spread * 0.5) * 100) / 100,
                high: Math.round((predicted + spread * 0.5) * 100) / 100
            };
        }
        return result;
    }

    /**
     * Get all simulations by status
     */
    async function getSimulations(status = 'active') {
        const db = await getGcDb();
        const rows = await db.prepare(`
            SELECT
                id, ad_type, creative_input_json, signals_json,
                predicted_d7_roas, predicted_d7_low, predicted_d7_high,
                predicted_d30_roas, predicted_d30_low, predicted_d30_high,
                predicted_d60_roas, predicted_d60_low, predicted_d60_high,
                predicted_d120_roas, predicted_d120_low, predicted_d120_high,
                predicted_d365_roas, predicted_d365_low, predicted_d365_high,
                campaign_id, adgroup_id, budget_per_day, status, simulated_at
            FROM gc_simulations
            WHERE status = ?
            ORDER BY simulated_at DESC
        `).all(status);

        return rows.map(row => {
            let creativeInput = {};
            let signals = {};
            try { creativeInput = JSON.parse(row.creative_input_json || '{}'); } catch (e) { /* skip */ }
            try { signals = JSON.parse(row.signals_json || '{}'); } catch (e) { /* skip */ }

            return {
                id: row.id,
                ad_type: row.ad_type,
                creative_input: creativeInput,
                signals,
                predictions: {
                    day_7: { roas: row.predicted_d7_roas, low: row.predicted_d7_low, high: row.predicted_d7_high },
                    day_30: { roas: row.predicted_d30_roas, low: row.predicted_d30_low, high: row.predicted_d30_high },
                    day_60: { roas: row.predicted_d60_roas, low: row.predicted_d60_low, high: row.predicted_d60_high },
                    day_120: { roas: row.predicted_d120_roas, low: row.predicted_d120_low, high: row.predicted_d120_high },
                    day_365: { roas: row.predicted_d365_roas, low: row.predicted_d365_low, high: row.predicted_d365_high }
                },
                campaign_id: row.campaign_id,
                adgroup_id: row.adgroup_id,
                budget_per_day: row.budget_per_day,
                status: row.status,
                simulated_at: row.simulated_at
            };
        });
    }

    /**
     * Get timeseries data for a simulation (actual vs predicted over time)
     */
    async function getSimulationTimeseries(simId) {
        const db = await getGcDb();
        const sim = await db.prepare(`SELECT * FROM gc_simulations WHERE id = ?`).get(simId);
        if (!sim) return null;

        const timeseries = await db.prepare(`
            SELECT date, spend, conversions, conversion_value, actual_roas,
                   predicted_roas, prediction_version, day_number
            FROM gc_forecast_timeseries
            WHERE simulation_id = ?
            ORDER BY day_number ASC
        `).all(simId);

        const alerts = await db.prepare(`
            SELECT alert_type, message, severity, is_read, triggered_at
            FROM gc_forecast_alerts
            WHERE simulation_id = ?
            ORDER BY triggered_at DESC
        `).all(simId);

        let creativeInput = {};
        try { creativeInput = JSON.parse(sim.creative_input_json || '{}'); } catch (e) { /* skip */ }

        return {
            simulation_id: sim.id,
            ad_type: sim.ad_type,
            creative_input: creativeInput,
            predictions: {
                day_7: { roas: sim.predicted_d7_roas, low: sim.predicted_d7_low, high: sim.predicted_d7_high },
                day_30: { roas: sim.predicted_d30_roas, low: sim.predicted_d30_low, high: sim.predicted_d30_high },
                day_60: { roas: sim.predicted_d60_roas, low: sim.predicted_d60_low, high: sim.predicted_d60_high },
                day_120: { roas: sim.predicted_d120_roas, low: sim.predicted_d120_low, high: sim.predicted_d120_high },
                day_365: { roas: sim.predicted_d365_roas, low: sim.predicted_d365_low, high: sim.predicted_d365_high }
            },
            timeseries,
            alerts,
            simulated_at: sim.simulated_at,
            status: sim.status
        };
    }

    return { simulateCreative, getSimulations, getSimulationTimeseries };
};
