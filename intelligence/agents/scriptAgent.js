require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const OpenAI = require('openai');
const { db, getAll, getOne, run, getRowCount } = require('../db');
const { cachedAsync } = require('../../utils/ai-cache');

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ============================================================
// 1. generateNewBriefs
// ============================================================

async function generateNewBriefs(count = 3) {
  if (!openai) return [];

  // --- Build context from SQLite ---
  let topPatterns = getAll(
    `SELECT pattern_name, signal_combination, avg_cps, avg_d6_roas, sample_count, confidence, best_example_ad_id
     FROM pattern_library ORDER BY avg_d6_roas DESC LIMIT 5`
  );

  let topCreatives = getAll(
    `SELECT rc.creative_name, rc.ad_id, rc.spend, rc.d6_roas, rc.cpi, rc.ctr, rc.d6,
            cs.format, cs.hook_type, cs.tone, cs.primary_emotion, cs.has_human_face,
            cs.has_chart, cs.text_density, cs.social_proof_type, cs.cta_clarity,
            cs.strongest_element, cs.why_it_works, cs.promise_made
     FROM creative_signals cs
     JOIN raw_creatives rc ON rc.ad_id = cs.ad_id
     ORDER BY rc.d6_roas DESC LIMIT 10`
  );

  let bottomCreatives = getAll(
    `SELECT rc.creative_name, rc.ad_id, rc.spend, rc.d6_roas, rc.cpi, rc.ctr,
            cs.format, cs.hook_type, cs.tone, cs.weakest_element, cs.why_it_fails,
            cs.improvement_priority
     FROM creative_signals cs
     JOIN raw_creatives rc ON rc.ad_id = cs.ad_id
     WHERE rc.spend > 5000
     ORDER BY rc.d6_roas ASC LIMIT 5`
  );

  let recentInsights = getAll(
    `SELECT insight_type, category, finding, evidence, action
     FROM ai_insights ORDER BY generated_at DESC LIMIT 10`
  );

  // Fallback: if no pattern/signal data, use raw_creatives directly
  if (topPatterns.length === 0 && topCreatives.length === 0) {
    topCreatives = getAll(
      `SELECT creative_name, ad_id, spend, d6_roas, cpi, ctr, d6, creative_type AS format
       FROM raw_creatives WHERE d6_roas IS NOT NULL
       ORDER BY d6_roas DESC LIMIT 10`
    );
    bottomCreatives = getAll(
      `SELECT creative_name, ad_id, spend, d6_roas, cpi, ctr, creative_type AS format
       FROM raw_creatives WHERE spend > 5000 AND d6_roas IS NOT NULL
       ORDER BY d6_roas ASC LIMIT 5`
    );
  }

  const prompt = `You are the Creative Director for Univest, a fintech app offering stock advisory subscriptions (₹999-2,999/month) plus a Trading/Demat account. Target: Indian retail investors aged 25-45, Android-heavy, Tier 1-2 cities. D6 ROAS target >28%, D6 CAC target <₹15,000.

=== WHAT WORKS (Top Patterns) ===
${topPatterns.length ? JSON.stringify(topPatterns, null, 2) : 'No pattern library data yet.'}

=== TOP 10 CREATIVES (with signals) ===
${topCreatives.length ? JSON.stringify(topCreatives, null, 2) : 'No creative data yet.'}

=== BOTTOM 5 CREATIVES (what to avoid) ===
${bottomCreatives.length ? JSON.stringify(bottomCreatives, null, 2) : 'No underperformer data yet.'}

=== LATEST INSIGHTS ===
${recentInsights.length ? JSON.stringify(recentInsights, null, 2) : 'No insights yet.'}

Generate exactly ${count} new creative briefs. Each brief MUST be a JSON object with these fields:
- title (string)
- format (one of: video_15s, video_30s, static_1x1, static_9x16, carousel)
- archetype (string)
- hypothesis (string)
- hook: { first_3_seconds (string), hook_type (string), emotion_target (string) }
- script: For video formats provide full word-for-word script with timestamps. For static formats provide { headline, subheadline, body, cta }.
- visual_direction: { color_palette (string), has_human (boolean), human_type (string), key_visual (string), text_overlays (array of strings) }
- predicted_cpi_range: { low (number), high (number) }
- predicted_d6_roas_range: { low (number), high (number) }
- test_budget (number in INR)
- success_threshold (string)
- data_basis (string explaining which patterns/creatives inspired this)

Respond ONLY with a JSON array of ${count} briefs. No markdown, no extra text.`;

  const rawContent = await cachedAsync(
    ['scriptAgent.generateNewBriefs', count, prompt],
    async () => {
      const response = await openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_completion_tokens: 1200,
        response_format: { type: 'json_object' },
        timeout: 30000
      });
      return response.choices[0].message.content;
    }
  );

  let briefs;
  try {
    const parsed = JSON.parse(rawContent);
    briefs = Array.isArray(parsed) ? parsed : (parsed.briefs || parsed.data || Object.values(parsed)[0]);
    if (!Array.isArray(briefs)) briefs = [parsed];
  } catch (e) {
    console.error('[scriptAgent] Failed to parse briefs response:', e.message);
    return [];
  }

  // Store each brief
  const stored = [];
  for (const b of briefs) {
    try {
      const result = run(
        `INSERT INTO creative_briefs
         (title, format, archetype, hypothesis, hook_json, script_text,
          visual_direction_json, predicted_cpi_low, predicted_cpi_high,
          predicted_d6_roas_low, predicted_d6_roas_high, test_budget,
          success_threshold, data_basis)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          b.title || 'Untitled Brief',
          b.format || 'video_30s',
          b.archetype || '',
          b.hypothesis || '',
          JSON.stringify(b.hook || {}),
          typeof b.script === 'string' ? b.script : JSON.stringify(b.script || {}),
          JSON.stringify(b.visual_direction || {}),
          b.predicted_cpi_range?.low ?? null,
          b.predicted_cpi_range?.high ?? null,
          b.predicted_d6_roas_range?.low ?? null,
          b.predicted_d6_roas_range?.high ?? null,
          b.test_budget ?? null,
          b.success_threshold || '',
          b.data_basis || ''
        ]
      );
      stored.push({ id: result.lastInsertRowid, ...b });
    } catch (e) {
      console.error('[scriptAgent] Failed to store brief:', e.message);
    }
  }

  return stored;
}

// ============================================================
// 2. generateRevampSuggestion
// ============================================================

async function generateRevampSuggestion(adId) {
  if (!openai) return [];

  // Get creative data with scores and signals
  const creative = getOne(
    `SELECT rc.*, cs.cps_score, cs.roas_component, cs.d6_component, cs.percentile_rank,
            sig.format, sig.hook_type, sig.tone, sig.primary_emotion, sig.has_human_face,
            sig.has_chart, sig.text_density, sig.social_proof_type, sig.cta_clarity,
            sig.message_clarity, sig.strongest_element, sig.weakest_element,
            sig.why_it_works, sig.why_it_fails, sig.improvement_priority, sig.promise_made
     FROM raw_creatives rc
     LEFT JOIN creative_scores cs ON cs.ad_id = rc.ad_id
     LEFT JOIN creative_signals sig ON sig.ad_id = rc.ad_id
     WHERE rc.ad_id = ?`,
    [adId]
  );

  if (!creative) return [];

  // If CPS >= 60, no revamp needed
  if (creative.cps_score != null && creative.cps_score >= 60) {
    return { message: `Creative ${adId} has CPS ${creative.cps_score.toFixed(1)} — it doesn't need a revamp.` };
  }

  // Get top patterns for reference
  const topPatterns = getAll(
    `SELECT pattern_name, signal_combination, avg_cps, avg_d6_roas, best_example_ad_id
     FROM pattern_library ORDER BY avg_d6_roas DESC LIMIT 5`
  );

  const prompt = `You are the Creative Director for Univest (fintech stock advisory app, ₹999-2,999/month subscriptions).

Here is an underperforming creative that needs a revamp:

${JSON.stringify(creative, null, 2)}

=== TOP PERFORMING PATTERNS FOR REFERENCE ===
${topPatterns.length ? JSON.stringify(topPatterns, null, 2) : 'No pattern data available.'}

Generate exactly 3 revamp options. Each option should change ONE thing about the creative. Each must be a JSON object with:
- option_number (1, 2, or 3)
- change_description (string - what to change)
- current_state (string - how it is now)
- new_state (string - what it should become)
- rationale (string - cite which top performer or pattern inspired this)
- predicted_improvement (string - expected % lift in key metric)

Respond ONLY with a JSON array of 3 objects. No markdown, no extra text.`;

  const rawContent = await cachedAsync(
    ['scriptAgent.generateRevampSuggestion', adId, prompt],
    async () => {
      const response = await openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_completion_tokens: 1200,
        response_format: { type: 'json_object' },
        timeout: 30000
      });
      return response.choices[0].message.content;
    }
  );

  let suggestions;
  try {
    const parsed = JSON.parse(rawContent);
    suggestions = Array.isArray(parsed) ? parsed : (parsed.options || parsed.suggestions || parsed.data || Object.values(parsed)[0]);
    if (!Array.isArray(suggestions)) suggestions = [parsed];
  } catch (e) {
    console.error('[scriptAgent] Failed to parse revamp response:', e.message);
    return [];
  }

  // Delete old suggestions for this ad_id, then insert new ones
  run(`DELETE FROM revamp_suggestions WHERE ad_id = ?`, [adId]);

  const stored = [];
  for (const s of suggestions) {
    try {
      const result = run(
        `INSERT INTO revamp_suggestions
         (ad_id, creative_name, option_number, change_description, current_state,
          new_state, rationale, predicted_improvement)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          adId,
          creative.creative_name || '',
          s.option_number || stored.length + 1,
          s.change_description || '',
          s.current_state || '',
          s.new_state || '',
          s.rationale || '',
          s.predicted_improvement || ''
        ]
      );
      stored.push({ id: result.lastInsertRowid, ad_id: adId, ...s });
    } catch (e) {
      console.error('[scriptAgent] Failed to store revamp suggestion:', e.message);
    }
  }

  return stored;
}

// ============================================================
// 3. generateRevampsForUnderperformers
// ============================================================

async function generateRevampsForUnderperformers() {
  const underperformers = getAll(
    `SELECT rc.ad_id
     FROM raw_creatives rc
     JOIN creative_scores cs ON cs.ad_id = rc.ad_id
     WHERE cs.cps_score < 40 AND rc.spend > 20000`
  );

  let revamped = 0;
  let errors = 0;

  for (const row of underperformers) {
    try {
      const result = await generateRevampSuggestion(row.ad_id);
      if (Array.isArray(result) && result.length > 0) {
        revamped++;
      } else if (result && result.message) {
        // Creative didn't need revamp (CPS >= 60), skip
      } else {
        errors++;
      }
    } catch (e) {
      console.error(`[scriptAgent] Revamp failed for ${row.ad_id}:`, e.message);
      errors++;
    }
  }

  return { revamped, errors };
}

// ============================================================
// 4. getBriefs
// ============================================================

function getBriefs() {
  return getAll(`SELECT * FROM creative_briefs ORDER BY generated_at DESC`);
}

// ============================================================
// 5. getRevamps
// ============================================================

function getRevamps(adId = null) {
  if (adId) {
    return getAll(
      `SELECT rs.*, rc.creative_name AS rc_creative_name, rc.spend, rc.d6_roas,
              rc.cpi, rc.ctr, rc.creative_type, rc.live_status
       FROM revamp_suggestions rs
       LEFT JOIN raw_creatives rc ON rc.ad_id = rs.ad_id
       WHERE rs.ad_id = ?
       ORDER BY rs.option_number ASC`,
      [adId]
    );
  }

  return getAll(
    `SELECT rs.*, rc.creative_name AS rc_creative_name, rc.spend, rc.d6_roas,
            rc.cpi, rc.ctr, rc.creative_type, rc.live_status
     FROM revamp_suggestions rs
     LEFT JOIN raw_creatives rc ON rc.ad_id = rs.ad_id
     ORDER BY rs.generated_at DESC`
  );
}

// ============================================================
// 6. getBriefById
// ============================================================

function getBriefById(id) {
  return getOne(`SELECT * FROM creative_briefs WHERE id = ?`, [id]);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  generateNewBriefs,
  generateRevampSuggestion,
  generateRevampsForUnderperformers,
  getBriefs,
  getRevamps,
  getBriefById
};
