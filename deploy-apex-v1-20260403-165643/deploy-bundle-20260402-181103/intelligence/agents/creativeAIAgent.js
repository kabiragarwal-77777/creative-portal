/**
 * Creative AI Agent
 * Deep-analyzes individual creatives using OpenAI GPT-4o-mini
 * and generates creative intelligence signals + pattern library.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const OpenAI = require('openai');
const { db, getAll, getOne, run, getRowCount } = require('../db');

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ──────────────────────────────────────────────
// 1. analyzeCreativeAsset
// ──────────────────────────────────────────────

async function analyzeCreativeAsset(creative) {
  if (!openai) return null;
  const systemPrompt = `You are a performance-marketing creative analyst for Univest, an Indian fintech app that sells stock advisory subscriptions and trading (demat) accounts. The target audience is Indian retail investors.

You will receive a creative's metadata and performance data. Analyze the creative name to infer its visual/messaging characteristics and return a JSON object with exactly three sections:

1. "visual_analysis" with these fields:
   - format (string): e.g. "static_image", "video", "carousel", "story"
   - color_temperature (string): "warm", "cool", "neutral", "mixed"
   - dominant_colors (array of strings): top 2-3 colors inferred from name/context
   - has_human_face (boolean)
   - face_is_relatable (boolean): true if the face would feel relatable to Indian retail investors
   - has_chart_or_data (boolean)
   - text_density (number 0-10): estimated amount of text overlay
   - visual_clutter (number 0-10)
   - brand_prominence (number 0-10)
   - mobile_optimized (boolean)

2. "messaging_analysis" with these fields:
   - primary_hook (string): the main hook/headline inferred
   - hook_type (string): one of "stat", "question", "benefit", "fear", "story", "offer", "social_proof"
   - tone (string): one of "urgent", "aspirational", "educational", "fearful", "conversational", "authoritative"
   - primary_emotion (string): one of "greed", "fear", "aspiration", "trust", "curiosity", "urgency"
   - has_specific_number (boolean)
   - specific_number_mentioned (string or null)
   - has_sebi_mention (boolean)
   - has_social_proof (boolean)
   - social_proof_type (string or null): e.g. "testimonial", "user_count", "returns", "rating", null
   - cta_clarity (number 0-10)
   - message_clarity (number 0-10)
   - promise_made (string): the core promise of the creative

3. "performance_hypothesis" with these fields:
   - why_it_works (string or null): explain why this creative performs well (only if CPS > 60)
   - why_it_fails (string or null): explain why this creative underperforms (only if CPS < 40)
   - strongest_element (string)
   - weakest_element (string)
   - improvement_priority (string): single most impactful change to improve this creative

Return ONLY valid JSON, no markdown fences, no extra text.`;

  const userPrompt = `Creative details:
- Creative Name: ${creative.creative_name || 'N/A'}
- Ad ID: ${creative.ad_id || 'N/A'}
- Campaign: ${creative.campaign_name || 'N/A'}
- Adset: ${creative.adset_name || 'N/A'}
- Creative Type: ${creative.creative_type || 'N/A'}
- Platform: ${creative.platform || 'N/A'}
- Live Status: ${creative.live_status || 'N/A'}

Performance data:
- Spend: ₹${creative.spend != null ? creative.spend.toFixed(2) : 'N/A'}
- CPI: ₹${creative.cpi != null ? creative.cpi.toFixed(2) : 'N/A'}
- D6 ROAS: ${creative.d6_roas != null ? creative.d6_roas.toFixed(2) : 'N/A'}
- D6 CAC: ₹${creative.d6_cac != null ? creative.d6_cac.toFixed(2) : 'N/A'}
- CPS Score: ${creative.cps_score != null ? creative.cps_score.toFixed(1) : 'N/A'}
- Impressions: ${creative.impressions || 'N/A'}
- Clicks: ${creative.clicks || 'N/A'}
- CTR: ${creative.ctr != null ? (creative.ctr * 100).toFixed(2) + '%' : 'N/A'}
- Installs: ${creative.installs || 'N/A'}
- Signups: ${creative.signups || 'N/A'}
- D0 Trial: ${creative.d0_trial || 'N/A'}
- D6 Conversions: ${creative.d6 || 'N/A'}

Analyze this creative and return the JSON object.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_completion_tokens: 2000,
      response_format: { type: 'json_object' }
    }, { timeout: 30000 });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);

    const v = parsed.visual_analysis || {};
    const m = parsed.messaging_analysis || {};
    const p = parsed.performance_hypothesis || {};

    run(`INSERT OR REPLACE INTO creative_signals (
      creative_name, ad_id, format, color_temperature, dominant_colors,
      has_human_face, face_is_relatable, has_chart, text_density,
      hook_type, tone, primary_emotion, has_specific_number,
      number_mentioned, has_sebi_mention, social_proof_type,
      cta_clarity, message_clarity, promise_made,
      why_it_works, why_it_fails, strongest_element,
      weakest_element, improvement_priority, analyzed_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, datetime('now')
    )`, [
      creative.creative_name,
      creative.ad_id,
      v.format || null,
      v.color_temperature || null,
      v.dominant_colors ? JSON.stringify(v.dominant_colors) : null,
      v.has_human_face ? 1 : 0,
      v.face_is_relatable ? 1 : 0,
      v.has_chart_or_data ? 1 : 0,
      v.text_density != null ? v.text_density : null,
      m.hook_type || null,
      m.tone || null,
      m.primary_emotion || null,
      m.has_specific_number ? 1 : 0,
      m.specific_number_mentioned || null,
      m.has_sebi_mention ? 1 : 0,
      m.social_proof_type || null,
      m.cta_clarity != null ? m.cta_clarity : null,
      m.message_clarity != null ? m.message_clarity : null,
      m.promise_made || null,
      p.why_it_works || null,
      p.why_it_fails || null,
      p.strongest_element || null,
      p.weakest_element || null,
      p.improvement_priority || null
    ]);

    return parsed;
  } catch (err) {
    console.error(`[creativeAIAgent] Error analyzing ad_id=${creative.ad_id}:`, err.message);
    return null;
  }
}

// ──────────────────────────────────────────────
// 2. analyzeNextBatch
// ──────────────────────────────────────────────

async function analyzeNextBatch(batchSize = 20) {
  let analyzed = 0;
  let errors = 0;

  // Get unanalyzed creatives (not in creative_signals) ordered by spend DESC
  const unanalyzed = getAll(`
    SELECT rc.*, cs.cps_score
    FROM raw_creatives rc
    LEFT JOIN creative_scores cs ON rc.ad_id = cs.ad_id
    WHERE rc.ad_id NOT IN (SELECT ad_id FROM creative_signals WHERE ad_id IS NOT NULL)
      AND rc.ad_id IS NOT NULL
    ORDER BY rc.spend DESC
    LIMIT ?
  `, [batchSize]);

  // Get stale creatives (analyzed_at older than 7 days)
  const remaining = batchSize - unanalyzed.length;
  const stale = remaining > 0 ? getAll(`
    SELECT rc.*, cs.cps_score
    FROM raw_creatives rc
    LEFT JOIN creative_scores cs ON rc.ad_id = cs.ad_id
    INNER JOIN creative_signals sig ON rc.ad_id = sig.ad_id
    WHERE sig.analyzed_at < datetime('now', '-7 days')
      AND rc.ad_id IS NOT NULL
    ORDER BY rc.spend DESC
    LIMIT ?
  `, [remaining]) : [];

  const allCreatives = [...unanalyzed, ...stale];

  for (const creative of allCreatives) {
    try {
      const result = await analyzeCreativeAsset(creative);
      if (result) {
        analyzed++;
      } else {
        errors++;
      }
    } catch (err) {
      console.error(`[creativeAIAgent] Batch error for ad_id=${creative.ad_id}:`, err.message);
      errors++;
    }
  }

  return { analyzed, errors };
}

// ──────────────────────────────────────────────
// 3. buildCreativePatternLibrary
// ──────────────────────────────────────────────

function buildCreativePatternLibrary() {
  // Query all signals joined with scores
  const rows = getAll(`
    SELECT
      sig.hook_type,
      sig.tone,
      sig.primary_emotion,
      sig.ad_id,
      cs.cps_score,
      rc.d6_roas,
      rc.creative_name
    FROM creative_signals sig
    INNER JOIN creative_scores cs ON sig.ad_id = cs.ad_id
    INNER JOIN raw_creatives rc ON sig.ad_id = rc.ad_id
    WHERE sig.hook_type IS NOT NULL
      AND sig.tone IS NOT NULL
      AND sig.primary_emotion IS NOT NULL
  `);

  // Group by hook_type + tone + primary_emotion
  const groups = {};
  for (const row of rows) {
    const key = `${row.hook_type}|${row.tone}|${row.primary_emotion}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }

  // Delete old patterns
  run('DELETE FROM pattern_library');

  let patternCount = 0;

  for (const [key, samples] of Object.entries(groups)) {
    if (samples.length < 3) continue;

    const [hookType, tone, emotion] = key.split('|');

    const avgCps = samples.reduce((s, r) => s + (r.cps_score || 0), 0) / samples.length;
    const validRoas = samples.filter(r => r.d6_roas != null);
    const avgD6Roas = validRoas.length > 0
      ? validRoas.reduce((s, r) => s + r.d6_roas, 0) / validRoas.length
      : null;

    // Best example = highest CPS
    const best = samples.reduce((a, b) => (b.cps_score || 0) > (a.cps_score || 0) ? b : a);

    // Confidence: more samples = higher confidence, capped at 1.0
    const confidence = Math.min(samples.length / 20, 1.0);

    const patternName = `${hookType} + ${tone} + ${emotion}`;
    const signalCombination = JSON.stringify({ hook_type: hookType, tone, primary_emotion: emotion });

    run(`INSERT INTO pattern_library (
      pattern_name, signal_combination, avg_cps, avg_d6_roas,
      sample_count, confidence, best_example_ad_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`, [
      patternName,
      signalCombination,
      avgCps,
      avgD6Roas,
      samples.length,
      confidence,
      best.ad_id
    ]);

    patternCount++;
  }

  return patternCount;
}

// ──────────────────────────────────────────────
// 4. getSignals
// ──────────────────────────────────────────────

function getSignals(adId) {
  const row = getOne('SELECT * FROM creative_signals WHERE ad_id = ?', [adId]);
  return row || null;
}

// ──────────────────────────────────────────────
// 5. getPatterns
// ──────────────────────────────────────────────

function getPatterns() {
  return getAll('SELECT * FROM pattern_library ORDER BY avg_d6_roas DESC');
}

module.exports = {
  analyzeCreativeAsset,
  analyzeNextBatch,
  buildCreativePatternLibrary,
  getSignals,
  getPatterns
};
