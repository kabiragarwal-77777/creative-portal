require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const OpenAI = require('openai');
const { getIntelDb, getAll, getOne, run, getRowCount } = require('../db');

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// ============================================================
// 1. analyzeCreativePerformance
// ============================================================

async function analyzeCreativePerformance() {
  try {
    // Check cache – return existing insights if generated < 24 hours ago
    const cached = await getOne(
      `SELECT generated_at FROM ai_insights ORDER BY generated_at DESC LIMIT 1`
    );
    if (cached && cached.generated_at) {
      const age = Date.now() - new Date(cached.generated_at + 'Z').getTime();
      if (age < 24 * 60 * 60 * 1000) {
        const insights = await getAll(`SELECT * FROM ai_insights ORDER BY id`);
        console.log('[insightAgent] Returning cached insights (age: ' + Math.round(age / 3600000) + 'h)');
        return { cached: true, insights };
      }
    }

    // Fetch top 50 creatives by spend
    const creatives = await getAll(
      `SELECT creative_name, ad_id, spend, cpi, d6_roas, d6_cac, signups, d0_trial, d6,
              live_status, creative_type
       FROM raw_creatives
       ORDER BY spend DESC
       LIMIT 50`
    );

    if (!creatives || creatives.length === 0) {
      console.log('[insightAgent] No creative data found');
      return { cached: false, insights: [] };
    }

    if (!process.env.OPENAI_API_KEY) {
      console.log('[insightAgent] No OpenAI API key configured');
      return { cached: false, insights: [] };
    }

    // Build condensed dataset
    const condensed = creatives.map(c => ({
      name: c.creative_name,
      spend: c.spend,
      cpi: c.cpi,
      d6_roas: c.d6_roas,
      d6_cac: c.d6_cac,
      signups: c.signups,
      d0_trial: c.d0_trial,
      d6: c.d6,
      live_status: c.live_status,
      creative_type: c.creative_type
    }));

    const systemPrompt = `You are a performance marketing analyst for Univest, an Indian fintech company selling stock advisory subscriptions and trading accounts.
Key metrics: CPI (benchmark ₹80-150), Signup Cost (₹300-600), D0 Trial = trial on day 0, D6 = paid by day 6 (critical), D6 CAC (₹12,000-15,000 acceptable), D6 ROAS (>28% = good).
Analyze the data and return insights as structured JSON.`;

    const userPrompt = `Analyze this creative performance data and return a JSON object with these keys:

- top_performers: array of top 5 creatives with fields: name, spend, d6_roas, finding (WHY it works), evidence, confidence (0-1), action, impact (high/medium/low)
- bottom_performers: array of bottom 5 creatives with fields: name, spend, d6_roas, finding (diagnosis of why it fails), evidence, confidence (0-1), action, impact (high/medium/low)
- patterns: array of 5-7 statistical patterns, each with: finding, evidence, confidence (0-1), action, impact (high/medium/low)
- winning_formula: object with: finding, evidence, confidence (0-1), action, impact
- budget_efficiency: object with: finding, evidence, confidence (0-1), action, impact
- fatigue_signals: array of creatives showing fatigue, each with: finding, evidence, confidence (0-1), action, impact
- quick_wins: array of exactly 3 immediate actions, each with: finding, evidence, confidence (0-1), action, impact
- anomalies: array of unusual data points, each with: finding, evidence, confidence (0-1), action, impact

Data:
${JSON.stringify(condensed, null, 0)}

Return ONLY valid JSON, no markdown fences.`;

    // Call OpenAI with 30s timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let response;
    try {
      response = await openai.chat.completions.create(
        {
          model: 'gpt-5.4-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.4,
          response_format: { type: 'json_object' }
        },
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timeout);
    }

    const rawContent = response.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (parseErr) {
      // Try stripping markdown fences if present
      const stripped = rawContent.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(stripped);
    }

    // Clear old insights and insert new ones
    await run(`DELETE FROM ai_insights`);

    const db = await getIntelDb();
    const insertStmt = db.prepare(
      `INSERT INTO ai_insights (insight_type, category, finding, evidence, confidence, action, impact, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    );

    const insertInsight = async (type, category, item) => {
      await insertStmt.run(
        type,
        category,
        item.finding || item.name || '',
        item.evidence || '',
        item.confidence != null ? item.confidence : 0.5,
        item.action || '',
        item.impact || 'medium'
      );
    };

    // Top performers
    if (Array.isArray(parsed.top_performers)) {
      for (const item of parsed.top_performers) {
        await insertInsight('top_performer', 'performance', item);
      }
    }

    // Bottom performers
    if (Array.isArray(parsed.bottom_performers)) {
      for (const item of parsed.bottom_performers) {
        await insertInsight('bottom_performer', 'performance', item);
      }
    }

    // Patterns
    if (Array.isArray(parsed.patterns)) {
      for (const item of parsed.patterns) {
        await insertInsight('pattern', 'statistical', item);
      }
    }

    // Winning formula
    if (parsed.winning_formula) {
      await insertInsight('winning_formula', 'strategy', parsed.winning_formula);
    }

    // Budget efficiency
    if (parsed.budget_efficiency) {
      await insertInsight('budget_efficiency', 'budget', parsed.budget_efficiency);
    }

    // Fatigue signals
    if (Array.isArray(parsed.fatigue_signals)) {
      for (const item of parsed.fatigue_signals) {
        await insertInsight('fatigue_signal', 'health', item);
      }
    }

    // Quick wins
    if (Array.isArray(parsed.quick_wins)) {
      for (const item of parsed.quick_wins) {
        await insertInsight('quick_win', 'action', item);
      }
    }

    // Anomalies
    if (Array.isArray(parsed.anomalies)) {
      for (const item of parsed.anomalies) {
        await insertInsight('anomaly', 'anomaly', item);
      }
    }

    const insights = await getAll(`SELECT * FROM ai_insights ORDER BY id`);
    console.log('[insightAgent] Generated ' + insights.length + ' insights');
    return { cached: false, insights };
  } catch (err) {
    console.error('[insightAgent] analyzeCreativePerformance error:', err.message);
    return { cached: false, insights: [], error: err.message };
  }
}

// ============================================================
// 2. scoreCreative
// ============================================================

function validateROAS(spend, revenue, window) {
  if (!spend || spend <= 0) return null;
  if (!revenue || revenue < 0) return null;
  if (revenue / spend > 50) return null;  // ROAS > 50x is almost certainly a matching error
  return revenue / spend;
}

async function scoreCreative(creativeData) {
  try {
    // Get benchmarks from all creatives — cap max_d6_roas to exclude outliers from matching errors
    const benchmarks = await getOne(
      `SELECT
         MAX(CASE WHEN d6_roas <= 5000 THEN d6_roas END) as max_d6_roas,
         MIN(CASE WHEN cpi > 0 THEN cpi END) as min_cpi,
         MAX(CASE WHEN installs > 0 THEN CAST(d6 AS REAL) / installs END) as max_d6_rate,
         MIN(CASE WHEN signups > 0 THEN spend / signups END) as min_signup_cost
       FROM raw_creatives
       WHERE spend > 0`
    );

    if (!benchmarks || !benchmarks.max_d6_roas) {
      return null;
    }

    const maxD6Roas = benchmarks.max_d6_roas || 1;
    const minCpi = benchmarks.min_cpi || 1;
    const maxD6Rate = benchmarks.max_d6_rate || 1;
    const minSignupCost = benchmarks.min_signup_cost || 1;

    // Calculate normalized components
    const rawD6Roas = creativeData.d6_roas || 0;
    // Validate ROAS — reject impossible values from matching errors
    const d6Roas = (rawD6Roas > 0 && rawD6Roas <= 5000) ? rawD6Roas : 0;
    const cpi = creativeData.cpi || 0;
    const installs = creativeData.installs || 0;
    const d6 = creativeData.d6 || 0;
    const spend = creativeData.spend || 0;
    const signups = creativeData.signups || 0;

    const d6Rate = installs > 0 ? d6 / installs : 0;
    const signupCost = signups > 0 ? spend / signups : 0;

    // D6 ROAS component (weight: 35) — use validated ROAS
    const roasComponent = Math.min(35, (d6Roas / maxD6Roas) * 35);

    // D6 rate component (weight: 25)
    const d6Component = Math.min(25, (d6Rate / maxD6Rate) * 25);

    // Signup cost efficiency component (weight: 20) – lower is better
    const signupComponent = signupCost > 0
      ? Math.min(20, (minSignupCost / signupCost) * 20)
      : 0;

    // CPI efficiency component (weight: 20) – lower is better
    const cpiComponent = cpi > 0
      ? Math.min(20, (minCpi / cpi) * 20)
      : 0;

    const cpsScore = Math.round((roasComponent + d6Component + signupComponent + cpiComponent) * 100) / 100;

    // Store in creative_scores table
    await run(
      `INSERT OR REPLACE INTO creative_scores (creative_name, ad_id, cps_score, roas_component, d6_component, signup_component, cpi_component, calculated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        creativeData.creative_name || '',
        creativeData.ad_id || '',
        cpsScore,
        Math.round(roasComponent * 100) / 100,
        Math.round(d6Component * 100) / 100,
        Math.round(signupComponent * 100) / 100,
        Math.round(cpiComponent * 100) / 100
      ]
    );

    return {
      ad_id: creativeData.ad_id,
      creative_name: creativeData.creative_name,
      cps_score: cpsScore,
      roas_component: Math.round(roasComponent * 100) / 100,
      d6_component: Math.round(d6Component * 100) / 100,
      signup_component: Math.round(signupComponent * 100) / 100,
      cpi_component: Math.round(cpiComponent * 100) / 100
    };
  } catch (err) {
    console.error('[insightAgent] scoreCreative error:', err.message);
    return null;
  }
}

// ============================================================
// 3. scoreAllCreatives
// ============================================================

async function scoreAllCreatives() {
  try {
    const creatives = await getAll(
      `SELECT creative_name, ad_id, spend, cpi, d6_roas, d6_cac, signups, d0_trial, d6, installs, live_status, creative_type
       FROM raw_creatives
       WHERE spend > 0`
    );

    if (!creatives || creatives.length === 0) {
      console.log('[insightAgent] No creatives to score');
      return 0;
    }

    // Score each creative
    for (const c of creatives) {
      await scoreCreative(c);
    }

    // Calculate percentile ranks
    const scored = await getAll(
      `SELECT id, ad_id, cps_score FROM creative_scores ORDER BY cps_score ASC`
    );

    const total = scored.length;
    if (total > 0) {
      const db = await getIntelDb();
      const updateStmt = db.prepare(
        `UPDATE creative_scores SET percentile_rank = ? WHERE id = ?`
      );
      for (let i = 0; i < total; i++) {
        const percentile = Math.round(((i + 1) / total) * 100 * 100) / 100;
        await updateStmt.run(percentile, scored[i].id);
      }
    }

    console.log('[insightAgent] Scored ' + total + ' creatives');
    return total;
  } catch (err) {
    console.error('[insightAgent] scoreAllCreatives error:', err.message);
    return 0;
  }
}

// ============================================================
// 4. getInsights
// ============================================================

async function getInsights(filters = {}) {
  try {
    const { category, impact, limit } = filters;
    let sql = `SELECT * FROM ai_insights WHERE 1=1`;
    const params = [];

    if (category) {
      sql += ` AND category = ?`;
      params.push(category);
    }
    if (impact) {
      sql += ` AND impact = ?`;
      params.push(impact);
    }

    sql += ` ORDER BY generated_at DESC, id DESC`;

    if (limit) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }

    return await getAll(sql, params);
  } catch (err) {
    console.error('[insightAgent] getInsights error:', err.message);
    return [];
  }
}

// ============================================================
// 5. getScores
// ============================================================

async function getScores(sortBy = 'cps_score', order = 'DESC') {
  try {
    // Whitelist sort columns to prevent injection
    const allowedSort = ['cps_score', 'roas_component', 'd6_component', 'signup_component', 'cpi_component', 'percentile_rank', 'calculated_at'];
    const safeSort = allowedSort.includes(sortBy) ? sortBy : 'cps_score';
    const safeOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    return await getAll(
      `SELECT cs.*, rc.spend, rc.cpi, rc.d6_roas, rc.d6_cac, rc.signups, rc.d0_trial, rc.d6,
              rc.installs, rc.live_status, rc.creative_type, rc.campaign_name, rc.adset_name,
              rc.impressions, rc.clicks, rc.ctr, rc.cpc
       FROM creative_scores cs
       LEFT JOIN raw_creatives rc ON cs.ad_id = rc.ad_id
       ORDER BY cs.${safeSort} ${safeOrder}`
    );
  } catch (err) {
    console.error('[insightAgent] getScores error:', err.message);
    return [];
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  analyzeCreativePerformance,
  scoreCreative,
  scoreAllCreatives,
  getInsights,
  getScores
};
