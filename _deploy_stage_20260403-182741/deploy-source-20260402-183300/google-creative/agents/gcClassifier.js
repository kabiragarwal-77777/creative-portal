/**
 * gcClassifier.js
 * Google Ads Creative Classifier & Tagger
 *
 * Classifies every Google ad creative (RSA, Video, Display, PMax) with
 * structured signals. Uses rule-based extraction first, then OpenAI for
 * subjective / visual fields. Results stored in gc_creative_signals.
 */

const { getGcDb } = require('../db/gc-db');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ── Enum values ──────────────────────────────────────────────────────────────

const HEADLINE_THEMES = ['Offer', 'Social Proof', 'Feature', 'Urgency', 'Trust'];
const CTA_STRENGTHS   = ['Strong', 'Medium', 'Weak'];
const OFFER_TYPES     = ['Free Trial', 'Discount', 'Feature', 'None'];
const HOOK_STRENGTHS  = ['Strong', 'Medium', 'Weak'];
const FIRST_5S_TYPES  = ['Question', 'Stat', 'Story', 'Offer', 'Face', 'Text'];
const VIDEO_TONES     = ['Urgency', 'Educational', 'Trust', 'Aspirational', 'FOMO'];
const LANGUAGE_SIGNALS = ['Hindi', 'English', 'Hinglish'];
const VIDEO_CTA_TYPES = ['App Install', 'Learn More', 'Sign Up', 'Download'];
const BRIGHTNESS_VALS = ['Light', 'Dark'];
const TEXT_DENSITY_VALS = ['High', 'Low'];
const VISUAL_COMPLEXITY_VALS = ['Simple', 'Complex'];
const PIN_STRATEGIES  = ['Heavy', 'Light', 'None'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function lower(str) {
    return (str || '').toLowerCase();
}

function safeJsonParse(str) {
    if (!str) return null;
    if (typeof str === 'object') return str;
    try { return JSON.parse(str); } catch { return null; }
}

function validateEnum(value, allowed, fallback) {
    if (!value) return fallback;
    if (allowed.includes(value)) return value;
    const match = allowed.find(a => a.toLowerCase() === value.toLowerCase());
    return match || fallback;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── RSA rule-based classification ────────────────────────────────────────────

function classifyRSARuleBased(content) {
    const headlines = content.headlines || content.headline_texts || [];
    const descriptions = content.descriptions || content.description_texts || [];
    const allText = [...headlines, ...descriptions].join(' ');
    const t = lower(allText);

    const headline_count = headlines.length;
    const description_count = descriptions.length;

    // Detect headline themes via keywords
    const headline_themes = [];
    const headlineText = lower(headlines.join(' '));
    if (/offer|discount|%\s*off|cashback|free|₹0|deal|coupon/.test(headlineText)) headline_themes.push('Offer');
    if (/crore|lakh|user|investor|trusted by|join\s+\d/.test(headlineText)) headline_themes.push('Social Proof');
    if (/feature|powerful|smart|advanced|ai|tool|platform|portfolio/.test(headlineText)) headline_themes.push('Feature');
    if (/hurry|limited|last chance|ends|expir|today only|now or never/.test(headlineText)) headline_themes.push('Urgency');
    if (/sebi|registered|regulated|trust|safe|secure|licen/.test(headlineText)) headline_themes.push('Trust');
    if (headline_themes.length === 0) headline_themes.push('Feature');

    // Price / number in headline
    const has_price_in_headline = headlines.some(h => /₹|rs\.?\s*\d|inr\s*\d|\d+\s*rupee/i.test(h));
    const has_number_in_headline = headlines.some(h => /\d/.test(h));

    // Question used
    const question_used = headlines.some(h => h.includes('?'));

    // SEBI mentioned
    const sebi_mentioned = /sebi/i.test(allText);

    // Personalization signal (you/your)
    const personalization_signal = /\byou\b|\byour\b/i.test(allText);

    // Offer type (rule-based)
    let offer_type = 'None';
    if (/free trial/i.test(allText)) offer_type = 'Free Trial';
    else if (/discount|%\s*off|cashback|coupon/i.test(allText)) offer_type = 'Discount';
    else if (/feature|tool|platform/i.test(allText) && headline_themes.includes('Feature')) offer_type = 'Feature';

    // Pin strategy — can only infer from headline count heuristic
    // Heavy = many headlines (>10), Light = 5-10, None = <5 or no pinning info
    let pin_strategy = 'None';
    if (headline_count > 10) pin_strategy = 'Heavy';
    else if (headline_count >= 5) pin_strategy = 'Light';

    return {
        ruled: {
            headline_count,
            description_count,
            headline_themes,
            has_price_in_headline,
            has_number_in_headline,
            question_used,
            sebi_mentioned,
            personalization_signal,
            offer_type,
            pin_strategy,
        },
        // Fields that need AI for subjective judgement
        needsAI: ['cta_strength'],
        allText,
    };
}

// ── AI classification via OpenAI ─────────────────────────────────────────────

async function callOpenAI(systemPrompt, userPrompt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'gpt-5.4-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            max_completion_tokens: 1000,
            response_format: { type: 'json_object' },
        }),
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    return JSON.parse(content);
}

const SYSTEM_PROMPT = 'You are a Google Ads creative analyst for Univest, an Indian fintech company. Classify the given ad creative. Return ONLY valid JSON matching the requested schema, no preamble.';

async function classifyRSAWithAI(content, ruleBased) {
    const userPrompt = `Ad type: RSA
Headlines: ${JSON.stringify(content.headlines || content.headline_texts || [])}
Descriptions: ${JSON.stringify(content.descriptions || content.description_texts || [])}

Return JSON:
{
  "cta_strength": "Strong | Medium | Weak"
}

Rules:
- Strong = clear action verb with urgency (e.g. "Start Now", "Get Free Trial Today")
- Medium = action verb without urgency (e.g. "Learn More", "Explore")
- Weak = no clear CTA or passive language`;

    const ai = await callOpenAI(SYSTEM_PROMPT, userPrompt);
    return {
        ...ruleBased,
        cta_strength: validateEnum(ai.cta_strength, CTA_STRENGTHS, 'Medium'),
    };
}

async function classifyVideoWithAI(content) {
    const userPrompt = `Ad type: VIDEO
Video title: ${content.video_title || 'N/A'}
Video ID: ${content.youtube_video_id || 'N/A'}
Thumbnail URL: ${content.video_thumbnail_url || 'N/A'}
Associated text: ${JSON.stringify(content.headlines || content.descriptions || content.ad_text || '')}

Return JSON:
{
  "video_duration_seconds": <number or 0 if unknown>,
  "hook_strength": "Strong | Medium | Weak",
  "first_5s_type": "Question | Stat | Story | Offer | Face | Text",
  "tone": "Urgency | Educational | Trust | Aspirational | FOMO",
  "has_face": <boolean>,
  "has_subtitles_likely": <boolean>,
  "language_signal": "Hindi | English | Hinglish",
  "cta_type": "App Install | Learn More | Sign Up | Download"
}

Context: Univest is an Indian fintech app. Infer from title/text what you can.`;

    const ai = await callOpenAI(SYSTEM_PROMPT, userPrompt);
    return {
        video_duration_seconds: typeof ai.video_duration_seconds === 'number' ? ai.video_duration_seconds : 0,
        hook_strength: validateEnum(ai.hook_strength, HOOK_STRENGTHS, 'Medium'),
        first_5s_type: validateEnum(ai.first_5s_type, FIRST_5S_TYPES, 'Text'),
        tone: validateEnum(ai.tone, VIDEO_TONES, 'Educational'),
        has_face: !!ai.has_face,
        has_subtitles_likely: !!ai.has_subtitles_likely,
        language_signal: validateEnum(ai.language_signal, LANGUAGE_SIGNALS, 'English'),
        cta_type: validateEnum(ai.cta_type, VIDEO_CTA_TYPES, 'Learn More'),
    };
}

async function classifyDisplayWithAI(content) {
    const userPrompt = `Ad type: DISPLAY / PMAX
Image URL: ${content.image_url || 'N/A'}
Headlines: ${JSON.stringify(content.headlines || content.headline_texts || [])}
Descriptions: ${JSON.stringify(content.descriptions || content.description_texts || [])}
Final URL: ${content.final_url || 'N/A'}

Return JSON:
{
  "dominant_color_hex": "<hex code>",
  "brightness": "Light | Dark",
  "text_density": "High | Low",
  "has_human": <boolean>,
  "offer_visible": <boolean>,
  "visual_complexity": "Simple | Complex"
}

Context: Univest is an Indian fintech app. Infer from the creative metadata what you can. If image is unavailable, make best guess from text/URL context.`;

    const ai = await callOpenAI(SYSTEM_PROMPT, userPrompt);
    return {
        dominant_color_hex: ai.dominant_color_hex || '',
        brightness: validateEnum(ai.brightness, BRIGHTNESS_VALS, 'Light'),
        text_density: validateEnum(ai.text_density, TEXT_DENSITY_VALS, 'Low'),
        has_human: !!ai.has_human,
        offer_visible: !!ai.offer_visible,
        visual_complexity: validateEnum(ai.visual_complexity, VISUAL_COMPLEXITY_VALS, 'Simple'),
    };
}

// ── Rule-based-only fallbacks (when no OpenAI key) ───────────────────────────

function classifyRSARuleOnly(content) {
    const { ruled } = classifyRSARuleBased(content);
    // Heuristic CTA strength from text
    const allText = lower([...(content.headlines || []), ...(content.descriptions || [])].join(' '));
    let cta_strength = 'Weak';
    if (/start now|get started|sign up today|download now|open.*account.*today|hurry/i.test(allText)) {
        cta_strength = 'Strong';
    } else if (/learn more|explore|try|get|start|sign up|download|install/i.test(allText)) {
        cta_strength = 'Medium';
    }
    return { ...ruled, cta_strength };
}

function classifyVideoRuleOnly(content) {
    const text = lower(content.video_title || '');
    return {
        video_duration_seconds: 0,
        hook_strength: 'Medium',
        first_5s_type: text.includes('?') ? 'Question' : 'Text',
        tone: /hurry|limited|last/i.test(text) ? 'Urgency' : 'Educational',
        has_face: false,
        has_subtitles_likely: false,
        language_signal: /hindi|हिन्दी/i.test(text) ? 'Hindi' : (/hinglish/i.test(text) ? 'Hinglish' : 'English'),
        cta_type: /install|download/i.test(text) ? 'App Install' : 'Learn More',
    };
}

function classifyDisplayRuleOnly(content) {
    const text = lower([...(content.headlines || []), ...(content.descriptions || [])].join(' '));
    return {
        dominant_color_hex: '',
        brightness: 'Light',
        text_density: (content.headlines || []).length + (content.descriptions || []).length > 4 ? 'High' : 'Low',
        has_human: false,
        offer_visible: /offer|discount|%\s*off|cashback|free/i.test(text),
        visual_complexity: 'Simple',
    };
}

// ── Main module factory ──────────────────────────────────────────────────────

module.exports = function (config = {}) {
    const hasAI = !!OPENAI_API_KEY;
    if (!hasAI) {
        console.warn('[gcClassifier] OPENAI_API_KEY not set — using rule-based classification only');
    }

    /**
     * Classify a single creative row from gc_creatives.
     * Returns the signals object (not yet persisted).
     */
    async function classifyCreative(creative) {
        const adType = (creative.ad_type || '').toUpperCase();
        const content = safeJsonParse(creative.creative_content_json) || {};

        let signals;

        if (adType === 'RSA') {
            if (hasAI) {
                const { ruled, allText } = classifyRSARuleBased(content);
                signals = await classifyRSAWithAI(content, ruled);
            } else {
                signals = classifyRSARuleOnly(content);
            }
        } else if (adType === 'VIDEO') {
            signals = hasAI ? await classifyVideoWithAI(content) : classifyVideoRuleOnly(content);
        } else {
            // DISPLAY, PMAX, or unknown — treat as display/visual
            signals = hasAI ? await classifyDisplayWithAI(content) : classifyDisplayRuleOnly(content);
        }

        return signals;
    }

    /**
     * Classify all (or unclassified) creatives and persist to gc_creative_signals.
     * options.incrementalOnly = true (default): skip creatives that already have signals.
     */
    async function classifyAll(options = { incrementalOnly: true }) {
        const db = getGcDb();

        // Get creatives, optionally filtering out already-classified ones
        let creatives;
        if (options.incrementalOnly) {
            creatives = db.prepare(`
                SELECT c.* FROM gc_creatives c
                LEFT JOIN gc_creative_signals s ON s.creative_id = c.id
                WHERE s.id IS NULL
            `).all();
        } else {
            creatives = db.prepare(`SELECT * FROM gc_creatives`).all();
        }

        if (creatives.length === 0) {
            console.log('[gcClassifier] No creatives to classify');
            return { classified: 0, skipped: 0, errors: 0 };
        }

        console.log(`[gcClassifier] Classifying ${creatives.length} creatives (AI=${hasAI})...`);

        const BATCH_SIZE = 5; // max concurrent AI calls
        const BATCH_DELAY_MS = 200; // small delay between batches to respect rate limits

        // Prepare upsert statements
        const existsStmt = db.prepare(`SELECT id FROM gc_creative_signals WHERE creative_id = ?`);
        const insertStmt = db.prepare(`
            INSERT INTO gc_creative_signals (creative_id, ad_id, ad_type, signals_json, classified_at)
            VALUES (?, ?, ?, ?, datetime('now'))
        `);
        const updateStmt = db.prepare(`
            UPDATE gc_creative_signals SET signals_json = ?, classified_at = datetime('now')
            WHERE creative_id = ?
        `);

        let classified = 0;
        let errors = 0;

        // Process in batches
        for (let i = 0; i < creatives.length; i += BATCH_SIZE) {
            const batch = creatives.slice(i, i + BATCH_SIZE);

            const results = await Promise.allSettled(
                batch.map(async (creative) => {
                    const signals = await classifyCreative(creative);
                    return { creative, signals };
                })
            );

            for (const result of results) {
                if (result.status === 'rejected') {
                    errors++;
                    console.error('[gcClassifier] Classification error:', result.reason?.message || result.reason);
                    continue;
                }

                const { creative, signals } = result.value;
                const signalsJson = JSON.stringify(signals);

                try {
                    const existing = existsStmt.get(creative.id);
                    if (existing) {
                        updateStmt.run(signalsJson, creative.id);
                    } else {
                        insertStmt.run(creative.id, creative.ad_id, creative.ad_type, signalsJson);
                    }
                    classified++;
                } catch (dbErr) {
                    errors++;
                    console.error(`[gcClassifier] DB error for creative ${creative.id}:`, dbErr.message);
                }
            }

            // Rate-limit pause between batches (only if using AI and more batches remain)
            if (hasAI && i + BATCH_SIZE < creatives.length) {
                await sleep(BATCH_DELAY_MS);
            }
        }

        console.log(`[gcClassifier] Done: ${classified} classified, ${errors} errors`);
        return { classified, skipped: creatives.length - classified - errors, errors };
    }

    /**
     * Get stored signals for a specific creative by id.
     */
    async function getSignals(creativeId) {
        const db = getGcDb();
        const row = db.prepare(`SELECT * FROM gc_creative_signals WHERE creative_id = ?`).get(creativeId);
        if (!row) return null;
        return {
            ...row,
            signals: safeJsonParse(row.signals_json),
        };
    }

    return { classifyCreative, classifyAll, getSignals };
};
