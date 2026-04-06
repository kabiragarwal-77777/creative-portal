/**
 * gcRecommendations.js - Creative Brief Generator for Google Ads
 * Generates RSA copy briefs, Video script briefs, and PMax asset group briefs
 * using historical performance data + OpenAI.
 */

const { getGcDb } = require('../db/gc-db');

const BRIEF_TYPES = ['rsa', 'video', 'pmax'];

// ── OpenAI helper ───────────────────────────────────────────────────────────

async function callOpenAI(systemPrompt, userPrompt, apiKey) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-5.4-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.7,
            max_completion_tokens: 4000
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim();

    // Strip markdown fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.error('[gcRecommendations] Failed to parse OpenAI JSON:', cleaned.substring(0, 300));
        throw new Error('OpenAI returned invalid JSON');
    }
}

// ── Data loaders ────────────────────────────────────────────────────────────

async function getTopPerformers(db, limit = 20) {
    try {
        return await db.prepare(`
            SELECT cs.creative_id, cs.gcps_score, cs.ad_type,
                   c.headline, c.description, c.asset_type, c.campaign_name,
                   sig.signal_type, sig.signal_value, sig.confidence
            FROM gc_creative_scores cs
            LEFT JOIN gc_creatives c ON c.id = cs.creative_id
            LEFT JOIN gc_creative_signals sig ON sig.creative_id = cs.creative_id
            WHERE cs.gcps_score IS NOT NULL
            ORDER BY cs.gcps_score DESC
            LIMIT ?
        `).all(limit);
    } catch (e) {
        console.warn('[gcRecommendations] Could not load top performers:', e.message);
        return [];
    }
}

async function getUnderperformers(db, limit = 10) {
    try {
        return await db.prepare(`
            SELECT cs.creative_id, cs.gcps_score, cs.ad_type,
                   c.headline, c.description, c.asset_type,
                   sig.signal_type, sig.signal_value
            FROM gc_creative_scores cs
            LEFT JOIN gc_creatives c ON c.id = cs.creative_id
            LEFT JOIN gc_creative_signals sig ON sig.creative_id = cs.creative_id
            WHERE cs.gcps_score IS NOT NULL
            ORDER BY cs.gcps_score ASC
            LIMIT ?
        `).all(limit);
    } catch (e) {
        console.warn('[gcRecommendations] Could not load underperformers:', e.message);
        return [];
    }
}

async function getMarketSignals(db) {
    try {
        return await db.prepare(`
            SELECT signal_type, signal_value, confidence, captured_at
            FROM gc_market_signals
            ORDER BY captured_at DESC
            LIMIT 20
        `).all();
    } catch (e) {
        console.warn('[gcRecommendations] Could not load market signals:', e.message);
        return [];
    }
}

// ── Summarisers (compress rows into prompt-friendly strings) ────────────────

function summariseTopSignals(rows) {
    if (!rows.length) return 'No historical data available. Use general Indian fintech best practices for an app offering Research Advisory (starts at Rs 1 trial) and Broking.';
    const grouped = {};
    for (const r of rows) {
        const key = r.headline || r.creative_id;
        if (!grouped[key]) grouped[key] = { score: r.gcps_score, ad_type: r.ad_type, headline: r.headline, description: r.description, signals: [] };
        if (r.signal_type) grouped[key].signals.push(`${r.signal_type}=${r.signal_value} (conf ${r.confidence})`);
    }
    return Object.values(grouped).map(g =>
        `[${g.ad_type} | G-CPS ${(g.score || 0).toFixed(2)}] "${g.headline || 'N/A'}" — ${g.signals.join(', ') || 'no signals'}`
    ).join('\n');
}

function summariseHeadlineThemes(rows) {
    if (!rows.length) return 'No headline data. Suggest themes: Offer/Trial, Trust/SEBI, Feature/AI, Urgency/Market-now.';
    const headlines = rows.filter(r => r.headline).map(r => r.headline);
    const unique = [...new Set(headlines)];
    return unique.slice(0, 15).join(' | ');
}

function summariseLowPatterns(rows) {
    if (!rows.length) return 'No underperformer data available.';
    return rows.filter(r => r.headline || r.signal_type).map(r =>
        `[G-CPS ${(r.gcps_score || 0).toFixed(2)}] "${r.headline || 'N/A'}" signal=${r.signal_type || 'none'}:${r.signal_value || 'none'}`
    ).join('\n');
}

function summariseSentiment(signals) {
    if (!signals.length) return 'Neutral market sentiment — no signals captured yet.';
    return signals.map(s => `${s.signal_type}: ${s.signal_value} (conf ${s.confidence})`).join('\n');
}

// ── Prompt builders ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Google Ads specialist and creative director for Univest, an Indian fintech company offering Research Advisory (\u20B91 trial) and Broking services.`;

function buildRSAUserPrompt(ctx) {
    return `Historical winning RSA patterns:
${ctx.topSignals}

BEST-performing headline themes: ${ctx.headlineThemes}

Underperforming patterns to avoid:
${ctx.lowPatterns}

Current market sentiment: ${ctx.sentiment}

Generate 3 RSA briefs for Univest. Each brief must follow Google RSA constraints:
- 15 headlines (max 30 chars each)
- 4 descriptions (max 90 chars each)
- Mix of: Offer headline / Feature headline / Trust headline / Urgency headline
- Flag which to pin to position 1 and why

Return ONLY valid JSON array:
[{
  "brief_id": "RSA-001",
  "theme": "descriptive name",
  "headlines": [{"text": "...", "type": "Offer|Feature|Trust|Urgency", "pin_position": null}],
  "descriptions": [{"text": "...", "type": "Value Prop|CTA|Social Proof|Feature"}],
  "rationale": "why this will work based on historical data",
  "expected_performance": "BEST|GOOD based on pattern match"
}]`;
}

function buildVideoUserPrompt(ctx) {
    return `Historical winning creative patterns:
${ctx.topSignals}

BEST-performing themes: ${ctx.headlineThemes}

Underperforming patterns to avoid:
${ctx.lowPatterns}

Current market sentiment: ${ctx.sentiment}

Generate 2 YouTube ad video briefs for Univest.
Include:
- Format recommendation: Skippable in-stream (15-30s) vs Bumper (6s) vs Discovery
- Scene-by-scene breakdown with timestamps
- On-screen text overlay suggestions
- Hook (first 5 seconds) strategy
- CTA strategy

Return ONLY valid JSON array:
[{
  "brief_id": "VID-001",
  "format": "Skippable In-Stream 15s | Bumper 6s | Discovery",
  "duration_seconds": 15,
  "hook": {"opening_line": "...", "visual": "...", "why_this_works": "..."},
  "scenes": [{"timestamp": "0-5s", "visual": "...", "text_overlay": "...", "voiceover": "..."}],
  "cta": {"text": "...", "type": "App Install|Learn More|Sign Up"},
  "rationale": "...",
  "expected_performance": "BEST|GOOD"
}]`;
}

function buildPMaxUserPrompt(ctx) {
    return `Historical winning creative patterns:
${ctx.topSignals}

BEST-performing themes: ${ctx.headlineThemes}

Underperforming patterns to avoid:
${ctx.lowPatterns}

Current market sentiment: ${ctx.sentiment}

Generate 2 PMax asset group briefs for Univest.
Each must include:
- 5 headlines (30 chars max)
- 5 long headlines (90 chars max)
- 5 descriptions (90 chars max)
- Image direction: 4 landscape + 1 square + 1 portrait
- Video brief: 1 long (30s) + 1 short (6s bumper)
- Audience signal recommendation
- Final URL recommendation

Return ONLY valid JSON array:
[{
  "brief_id": "PMAX-001",
  "theme": "...",
  "headlines": ["...", "..."],
  "long_headlines": ["...", "..."],
  "descriptions": ["...", "..."],
  "images": [{"orientation": "landscape|square|portrait", "visual_brief": "..."}],
  "video_briefs": [{"duration": "30s|6s", "concept": "..."}],
  "audience_signals": ["..."],
  "final_url": "...",
  "rationale": "..."
}]`;
}

// ── Ensure table ────────────────────────────────────────────────────────────

async function ensureTable(db) {
    await db.prepare(`
        CREATE TABLE IF NOT EXISTS gc_recommendations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            brief_type TEXT NOT NULL,
            briefs_json TEXT NOT NULL,
            generated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
        )
    `).run();
}

// ── Module export ───────────────────────────────────────────────────────────

module.exports = function (config) {
    const apiKey = config?.openaiApiKey || process.env.OPENAI_API_KEY;

    /**
     * Generate creative briefs for the given type(s).
     * @param {'rsa'|'video'|'pmax'|'all'} type
     * @returns {Object} { rsa?: [...], video?: [...], pmax?: [...] }
     */
    async function generateBriefs(type = 'all') {
        if (!apiKey) throw new Error('Missing OPENAI_API_KEY');

        const db = await getGcDb();
        await ensureTable(db);

        // 1. Gather data
        const topRows = await getTopPerformers(db);
        const lowRows = await getUnderperformers(db);
        const mktSignals = await getMarketSignals(db);

        const ctx = {
            topSignals: summariseTopSignals(topRows),
            headlineThemes: summariseHeadlineThemes(topRows),
            lowPatterns: summariseLowPatterns(lowRows),
            sentiment: summariseSentiment(mktSignals)
        };

        const types = type === 'all' ? BRIEF_TYPES : [type];
        if (!types.every(t => BRIEF_TYPES.includes(t))) {
            throw new Error(`Invalid brief type "${type}". Use rsa, video, pmax, or all.`);
        }

        const results = {};
        const insertStmt = db.prepare(`
            INSERT INTO gc_recommendations (brief_type, briefs_json, generated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `);

        // 2. Generate each type (sequentially to stay within rate limits)
        for (const t of types) {
            console.log(`[gcRecommendations] Generating ${t.toUpperCase()} briefs...`);

            let userPrompt;
            if (t === 'rsa') userPrompt = buildRSAUserPrompt(ctx);
            else if (t === 'video') userPrompt = buildVideoUserPrompt(ctx);
            else userPrompt = buildPMaxUserPrompt(ctx);

            try {
                const briefs = await callOpenAI(SYSTEM_PROMPT, userPrompt, apiKey);
                results[t] = Array.isArray(briefs) ? briefs : [briefs];

                // Persist
                await insertStmt.run(t, JSON.stringify(results[t]));
                console.log(`[gcRecommendations] Stored ${results[t].length} ${t.toUpperCase()} briefs`);
            } catch (err) {
                console.error(`[gcRecommendations] Failed to generate ${t} briefs:`, err.message);
                results[t] = { error: err.message };
            }
        }

        return results;
    }

    /**
     * Return the latest stored briefs, optionally filtered by type.
     * @param {'rsa'|'video'|'pmax'|'all'} type
     * @returns {Object} { rsa?: [...], video?: [...], pmax?: [...] }
     */
    async function getLatestBriefs(type = 'all') {
        const db = await getGcDb();
        await ensureTable(db);

        const types = type === 'all' ? BRIEF_TYPES : [type];
        const results = {};

        for (const t of types) {
            try {
                const row = await db.prepare(`
                    SELECT briefs_json, generated_at
                    FROM gc_recommendations
                    WHERE brief_type = ?
                    ORDER BY generated_at DESC
                    LIMIT 1
                `).get(t);

                if (row) {
                    results[t] = {
                        briefs: JSON.parse(row.briefs_json),
                        generated_at: row.generated_at
                    };
                } else {
                    results[t] = { briefs: [], generated_at: null };
                }
            } catch (e) {
                console.error(`[gcRecommendations] Error fetching ${t} briefs:`, e.message);
                results[t] = { briefs: [], generated_at: null, error: e.message };
            }
        }

        return results;
    }

    return { generateBriefs, getLatestBriefs };
};
