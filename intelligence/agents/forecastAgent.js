/**
 * forecastAgent.js — LTV predictions using cohort data
 * Builds cohort-level LTV estimates and per-creative ROAS forecasts.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const OpenAI = require('openai');
const { getIntelDb, getAll, getOne, run, getRowCount } = require('../db');

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const SUBSCRIPTION_PRICE = 1299; // ₹/month

// ---------------------------------------------------------------------------
// ROAS validity check — used everywhere ROAS is calculated
// ---------------------------------------------------------------------------
function validateROAS(spend, revenue, window) {
  if (!spend || spend <= 0) return null;
  if (!revenue || revenue < 0) return null;
  if (revenue / spend > 50) return null;  // ROAS > 50x is almost certainly a matching error
  return revenue / spend;
}

// ---------------------------------------------------------------------------
// Normalize adset name for matching
// ---------------------------------------------------------------------------
const normalize = (s) => s?.toLowerCase().trim().replace(/\s+/g, '_') || '';

// ---------------------------------------------------------------------------
// 1. buildLTVCohorts
// ---------------------------------------------------------------------------
async function buildLTVCohorts() {
  const rows = await getAll(`
    SELECT
      campaign_name,
      adset_name,
      MIN(date) AS period_start,
      MAX(date) AS period_end,
      SUM(COALESCE(signups, 0))   AS signups,
      SUM(COALESCE(d0_trial, 0))  AS d0_trial,
      SUM(COALESCE(d6, 0))        AS d6,
      SUM(COALESCE(revenue, 0))   AS revenue
    FROM raw_metabase
    GROUP BY campaign_name, adset_name
  `);

  // We also need spend from raw_creatives (metabase doesn't carry spend).
  // Join through raw_meta_dump which has campaign_id — the reliable key.
  // Key: campaign_id + normalized adset_name → spend/installs
  const spendMap = {};
  const spendRows = await getAll(`
    SELECT d.campaign_id,
           c.adset_name,
           SUM(COALESCE(c.spend, 0)) AS total_spend,
           SUM(COALESCE(c.installs, 0)) AS installs
    FROM raw_creatives c
    INNER JOIN raw_meta_dump d
      ON d.ad_id = c.ad_id
    WHERE d.campaign_id IS NOT NULL
    GROUP BY d.campaign_id, c.adset_name
  `);
  for (const r of spendRows) {
    const normalizedAdset = normalize(r.adset_name);
    spendMap[`${r.campaign_id}||${normalizedAdset}`] = {
      total_spend: r.total_spend,
      installs: r.installs
    };
  }

  // Build a campaign_name → campaign_id lookup from raw_meta_dump
  const campaignIdMap = {};
  const cidRows = await getAll(`
    SELECT DISTINCT campaign_name, campaign_id
    FROM raw_meta_dump
    WHERE campaign_id IS NOT NULL AND campaign_name IS NOT NULL
  `);
  for (const r of cidRows) {
    campaignIdMap[r.campaign_name] = r.campaign_id;
  }

  // Clear existing cohorts
  await run('DELETE FROM ltv_cohorts');

  const db = await getIntelDb();
  const insert = db.prepare(`
    INSERT INTO ltv_cohorts
      (campaign_name, adset_name, period_start, period_end,
       total_spend, installs, signups, d0_trial, d6_conversions,
       d6_rate, d6_roas, implied_ltv_30d, implied_ltv_90d, calculated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const insertMany = db.transaction(async (cohorts) => {
    for (const c of cohorts) await insert.run(...c);
  });

  const cohorts = rows.map((r) => {
    // Match by campaign_id (from raw_meta_dump) + normalized adset_name
    const campaignId = campaignIdMap[r.campaign_name];
    const idKey = campaignId ? `${campaignId}||${normalize(r.adset_name)}` : null;
    const meta = (idKey && spendMap[idKey]) || { total_spend: 0, installs: 0 };

    const d6Rate = r.d0_trial > 0 ? r.d6 / r.d0_trial : 0;
    const rawRoas = validateROAS(meta.total_spend, r.revenue, 'd6');
    const d6Roas = rawRoas != null ? rawRoas * 100 : null;

    // Implied LTV using Indian fintech retention curves
    // Month 1: 100% of D6 cohort (just converted)
    // Month 2: 60% retained
    // Month 3: 45% retained
    const impliedLtv30d = r.d6 * SUBSCRIPTION_PRICE;                       // D6 * 1299
    const impliedLtv90d = r.d6 * SUBSCRIPTION_PRICE * (1 + 0.60 + 0.45);   // D6 * 1299 * 2.05

    return [
      r.campaign_name,
      r.adset_name,
      r.period_start,
      r.period_end,
      meta.total_spend,
      meta.installs,
      r.signups,
      r.d0_trial,
      r.d6,
      Math.round(d6Rate * 10000) / 10000,
      d6Roas != null ? Math.round(d6Roas * 100) / 100 : null,
      Math.round(impliedLtv30d * 100) / 100,
      Math.round(impliedLtv90d * 100) / 100
    ];
  });

  await insertMany(cohorts);
  return cohorts.length;
}

// ---------------------------------------------------------------------------
// 2. forecastCreativeROAS
// ---------------------------------------------------------------------------
async function forecastCreativeROAS(adId) {
  const creative = await getOne('SELECT * FROM raw_creatives WHERE ad_id = ?', [adId]);
  if (!creative) throw new Error(`Creative not found for ad_id=${adId}`);

  const score = await getOne('SELECT * FROM creative_scores WHERE ad_id = ?', [adId]);
  const signals = await getOne('SELECT * FROM creative_signals WHERE ad_id = ?', [adId]);

  // Find benchmark data from similar archetype/pattern
  let benchmarks = [];
  if (signals && signals.hook_type) {
    benchmarks = await getAll(`
      SELECT avg_cps, avg_d6_roas, sample_count, confidence, pattern_name
      FROM pattern_library
      WHERE signal_combination LIKE ?
      ORDER BY confidence DESC
      LIMIT 5
    `, [`%${signals.hook_type}%`]);
  }
  if (benchmarks.length === 0) {
    benchmarks = await getAll(`
      SELECT avg_cps, avg_d6_roas, sample_count, confidence, pattern_name
      FROM pattern_library
      ORDER BY confidence DESC
      LIMIT 5
    `);
  }

  // Days live
  const dateFrom = creative.date_from ? new Date(creative.date_from) : new Date();
  const daysLive = Math.max(1, Math.floor((Date.now() - dateFrom.getTime()) / 86400000));

  const spend = creative.spend || 0;
  const d6 = creative.d6 || 0;
  // Validate stored d6_roas — if it looks like a matching error, recompute or null out
  const storedRoas = creative.d6_roas || 0;
  const d6Roas = (storedRoas > 0 && storedRoas <= 5000) ? storedRoas : (validateROAS(spend, d6 * SUBSCRIPTION_PRICE, 'd6') != null ? validateROAS(spend, d6 * SUBSCRIPTION_PRICE, 'd6') * 100 : 0);
  const installs = creative.installs || 0;
  const signups = creative.signups || 0;
  const d0Trial = creative.d0_trial || 0;
  const cpi = creative.cpi || 0;

  const archetype = signals ? (signals.hook_type || 'unknown') : 'unknown';
  const avgBenchRoas = benchmarks.length > 0
    ? benchmarks.reduce((s, b) => s + (b.avg_d6_roas || 0), 0) / benchmarks.length
    : 0;

  let prediction;

  if (!openai) {
    // ----- Mathematical fallback (no OpenAI key) -----
    const baseRoas = d6Roas > 0 ? d6Roas : avgBenchRoas;
    const maturityFactor = Math.min(daysLive / 30, 1);                // ramp-up
    const retentionMultiplier30 = 1.0;
    const retentionMultiplier60 = 1.0 + 0.60;
    const retentionMultiplier90 = 1.0 + 0.60 + 0.45;
    const retentionMultiplier365 = 1.0 + 0.60 + 0.45 + 0.35 * 9;    // months 4-12 at 35%

    const roas30 = baseRoas * retentionMultiplier30;
    const roas60 = baseRoas * retentionMultiplier60;
    const roas90 = baseRoas * retentionMultiplier90;
    const roas365 = baseRoas * retentionMultiplier365;

    const ltvPerUser = d0Trial > 0 && d6 > 0
      ? (d6 / d0Trial) * SUBSCRIPTION_PRICE * retentionMultiplier90
      : SUBSCRIPTION_PRICE * 0.10 * retentionMultiplier90;           // assume 10% conversion

    const conf30 = Math.min(0.4 + maturityFactor * 0.4, 0.80);
    const conf60 = conf30 * 0.85;
    const conf90 = conf30 * 0.70;

    let action = 'maintain';
    let budget = spend;
    if (roas90 > 100 && conf30 > 0.5) { action = 'scale'; budget = spend * 1.5; }
    else if (roas30 < 30) { action = 'pause'; budget = 0; }
    else if (roas30 >= 30 && roas30 < 70) { action = 'test-variation'; budget = spend * 0.8; }

    prediction = {
      roas_30d: Math.round(roas30 * 100) / 100,
      roas_60d: Math.round(roas60 * 100) / 100,
      roas_90d: Math.round(roas90 * 100) / 100,
      roas_365d: Math.round(roas365 * 100) / 100,
      ltv_per_user: Math.round(ltvPerUser * 100) / 100,
      confidence_30d: Math.round(conf30 * 100) / 100,
      confidence_60d: Math.round(conf60 * 100) / 100,
      confidence_90d: Math.round(conf90 * 100) / 100,
      action,
      budget: Math.round(budget * 100) / 100,
      reasoning_30d: `Math forecast: base ROAS ${baseRoas.toFixed(1)}%, ${daysLive}d live, archetype=${archetype}`,
      reasoning_60d: `Retention-adjusted (60% M2) from base ${baseRoas.toFixed(1)}%`,
      reasoning_90d: `Retention-adjusted (45% M3) from base ${baseRoas.toFixed(1)}%`
    };
  } else {
    // ----- OpenAI forecast -----
    const benchmarkText = benchmarks.map(
      (b) => `  ${b.pattern_name}: avg_d6_roas=${b.avg_d6_roas}%, samples=${b.sample_count}, confidence=${b.confidence}`
    ).join('\n');

    const prompt = `You are a performance-marketing analyst for an Indian fintech app (₹1,299/month subscription).

Creative: "${creative.creative_name}" (ad_id: ${adId})
Days live: ${daysLive}
Current metrics:
  spend=₹${spend}, installs=${installs}, signups=${signups}, d0_trial=${d0Trial}, d6=${d6}
  d6_roas=${d6Roas}%, cpi=₹${cpi}
  CPS score: ${score ? score.cps_score : 'N/A'}, percentile: ${score ? score.percentile_rank : 'N/A'}
Archetype/hook: ${archetype}
Signals: format=${signals ? signals.format : 'unknown'}, tone=${signals ? signals.tone : 'unknown'}, emotion=${signals ? signals.primary_emotion : 'unknown'}

Benchmarks for similar creatives:
${benchmarkText || '  No benchmark data available'}

Indian fintech retention curve: M1=100%, M2=60%, M3=45%, M4-M12=35%.

Predict the following and return ONLY valid JSON (no markdown):
{
  "roas_30d": <number>,
  "roas_60d": <number>,
  "roas_90d": <number>,
  "roas_365d": <number>,
  "ltv_per_user": <number in INR>,
  "confidence_30d": <0-1>,
  "confidence_60d": <0-1>,
  "confidence_90d": <0-1>,
  "action": "scale|maintain|pause|test-variation",
  "budget": <recommended daily budget in INR>,
  "reasoning_30d": "<1-2 sentences>",
  "reasoning_60d": "<1-2 sentences>",
  "reasoning_90d": "<1-2 sentences>"
}`;

    const response = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_completion_tokens: 800
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('OpenAI timeout (30s)')), 30000))
    ]);

    const raw = response.choices[0].message.content.trim();
    try {
      prediction = JSON.parse(raw);
    } catch {
      // Try to extract JSON from markdown code block
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        prediction = JSON.parse(match[0]);
      } else {
        throw new Error(`Failed to parse OpenAI response: ${raw.substring(0, 200)}`);
      }
    }
  }

  // Persist prediction (delete existing then insert for upsert behavior)
  await run('DELETE FROM ltv_predictions WHERE ad_id = ?', [adId]);
  await run(`
    INSERT INTO ltv_predictions
      (creative_name, ad_id, days_live_at_prediction,
       predicted_roas_30d, predicted_roas_60d, predicted_roas_90d, predicted_roas_365d,
       predicted_ltv_per_user,
       confidence_30d, confidence_60d, confidence_90d,
       recommended_action, recommended_budget,
       reasoning_30d, reasoning_60d, reasoning_90d,
       archetype_used, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    creative.creative_name, adId, daysLive,
    prediction.roas_30d, prediction.roas_60d, prediction.roas_90d, prediction.roas_365d,
    prediction.ltv_per_user,
    prediction.confidence_30d, prediction.confidence_60d, prediction.confidence_90d,
    prediction.action, prediction.budget,
    prediction.reasoning_30d, prediction.reasoning_60d, prediction.reasoning_90d,
    archetype
  ]);

  return prediction;
}

// ---------------------------------------------------------------------------
// 3. runForecasts
// ---------------------------------------------------------------------------
async function runForecasts() {
  const creatives = await getAll(`
    SELECT ad_id FROM raw_creatives
    WHERE live_status = 'Live' OR spend > 0
  `);

  let forecasted = 0;
  let errors = 0;

  for (const c of creatives) {
    try {
      await forecastCreativeROAS(c.ad_id);
      forecasted++;
    } catch (err) {
      console.error(`[forecastAgent] Error forecasting ${c.ad_id}:`, err.message);
      errors++;
    }
  }

  return { forecasted, errors };
}

// ---------------------------------------------------------------------------
// 4. updateActualROAS
// ---------------------------------------------------------------------------
async function updateActualROAS() {
  // Find predictions old enough to have actuals (30+ days since prediction)
  const stale = await getAll(`
    SELECT p.id, p.ad_id, p.created_at,
           julianday('now') - julianday(p.created_at) AS days_since
    FROM ltv_predictions p
    WHERE julianday('now') - julianday(p.created_at) >= 30
  `);

  let updated = 0;

  for (const pred of stale) {
    const creative = await getOne('SELECT * FROM raw_creatives WHERE ad_id = ?', [pred.ad_id]);
    if (!creative || !creative.spend || creative.spend === 0) continue;

    const revenue = creative.d6 ? creative.d6 * SUBSCRIPTION_PRICE : 0;
    const validatedRoas = validateROAS(creative.spend, revenue, 'd6');
    if (validatedRoas == null) continue; // skip invalid ROAS — store null explicitly
    const actualRoas = validatedRoas * 100;

    // 30d actual available when prediction is 30+ days old
    const updates = {};
    if (pred.days_since >= 30) updates.actual_roas_30d = Math.round(actualRoas * 100) / 100;
    if (pred.days_since >= 60) {
      const roas60 = validateROAS(creative.spend, revenue * (1 + 0.60), 'd60');
      updates.actual_roas_60d = roas60 != null ? Math.round(roas60 * 100 * 100) / 100 : null;
    }
    if (pred.days_since >= 90) {
      const roas90 = validateROAS(creative.spend, revenue * (1 + 0.60 + 0.45), 'd90');
      updates.actual_roas_90d = roas90 != null ? Math.round(roas90 * 100 * 100) / 100 : null;
    }

    const setClauses = Object.entries(updates).map(([k, v]) => `${k} = ${v}`).join(', ');
    if (setClauses) {
      await run(`UPDATE ltv_predictions SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [pred.id]);
      updated++;
    }
  }

  return updated;
}

// ---------------------------------------------------------------------------
// 5. getForecasts
// ---------------------------------------------------------------------------
async function getForecasts(adId = null) {
  if (adId) {
    return await getOne(`
      SELECT p.*, c.spend, c.installs, c.signups, c.d0_trial, c.d6,
             c.d6_roas, c.cpi, c.live_status, c.creative_type, c.platform,
             c.date_from, c.date_to
      FROM ltv_predictions p
      LEFT JOIN raw_creatives c ON c.ad_id = p.ad_id
      WHERE p.ad_id = ?
    `, [adId]);
  }
  return await getAll(`
    SELECT p.*, c.spend, c.installs, c.signups, c.d0_trial, c.d6,
           c.d6_roas, c.cpi, c.live_status, c.creative_type, c.platform,
           c.date_from, c.date_to
    FROM ltv_predictions p
    LEFT JOIN raw_creatives c ON c.ad_id = p.ad_id
    ORDER BY p.confidence_30d DESC
  `);
}

// ---------------------------------------------------------------------------
// 6. getCohorts
// ---------------------------------------------------------------------------
async function getCohorts() {
  return await getAll('SELECT * FROM ltv_cohorts ORDER BY d6_roas DESC');
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  buildLTVCohorts,
  forecastCreativeROAS,
  runForecasts,
  updateActualROAS,
  getForecasts,
  getCohorts
};
