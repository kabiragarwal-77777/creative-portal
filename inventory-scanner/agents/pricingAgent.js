const { getDb } = require('../database/db');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const GOOGLE_SEARCH_UAC_BASELINE_CPM = 60; // INR

const FALLBACK_PRICING_UPDATES = [
  { name: 'Meta Instagram Feed', min_cpm: 25, max_cpm: 80, pricing_model: 'CPM', price_trend: 'increasing' },
  { name: 'Meta Instagram Reels', min_cpm: 15, max_cpm: 55, pricing_model: 'CPM', price_trend: 'stable' },
  { name: 'Google Search UAC', min_cpm: 40, max_cpm: 100, pricing_model: 'CPC', price_trend: 'increasing' },
  { name: 'YouTube In-Stream', min_cpm: 30, max_cpm: 90, pricing_model: 'CPV', price_trend: 'stable' },
  { name: 'YouTube Shorts', min_cpm: 10, max_cpm: 40, pricing_model: 'CPV', price_trend: 'decreasing' },
  { name: 'Google Display Network', min_cpm: 8, max_cpm: 30, pricing_model: 'CPM', price_trend: 'stable' },
  { name: 'LinkedIn Sponsored Content', min_cpm: 200, max_cpm: 500, pricing_model: 'CPM', price_trend: 'increasing' },
  { name: 'Twitter/X Promoted Tweets', min_cpm: 30, max_cpm: 80, pricing_model: 'CPM', price_trend: 'decreasing' },
  { name: 'Snapchat Ads India', min_cpm: 15, max_cpm: 45, pricing_model: 'CPM', price_trend: 'stable' },
  { name: 'PhonePe Ads', min_cpm: 40, max_cpm: 90, pricing_model: 'CPM', price_trend: 'increasing' },
  { name: 'Spotify India Audio Ads', min_cpm: 100, max_cpm: 250, pricing_model: 'CPM', price_trend: 'stable' },
  { name: 'CRED Ads', min_cpm: 150, max_cpm: 400, pricing_model: 'CPM', price_trend: 'increasing' }
];

function computePricingFields(inv) {
  const avg_cpm = (inv.min_cpm + inv.max_cpm) / 2;
  const benchmark_vs_google = Math.round(((avg_cpm - GOOGLE_SEARCH_UAC_BASELINE_CPM) / GOOGLE_SEARCH_UAC_BASELINE_CPM) * 100);

  return {
    ...inv,
    avg_cpm: Math.round(avg_cpm * 100) / 100,
    benchmark_vs_google: benchmark_vs_google,
    benchmark_vs_google_label: benchmark_vs_google < 0
      ? `${Math.abs(benchmark_vs_google)}% cheaper than Google`
      : benchmark_vs_google > 0
        ? `${benchmark_vs_google}% more expensive than Google`
        : 'Same as Google baseline',
    rate_card_type: avg_cpm > 200 ? 'premium' : avg_cpm > 80 ? 'mid_range' : 'value',
    typical_discount: avg_cpm > 200 ? '15-25%' : avg_cpm > 80 ? '10-15%' : '5-10%',
    price_trend: inv.price_trend || 'stable'
  };
}

function getPricingData(inventoryId) {
  const db = getDb();
  const inv = db.prepare(`
    SELECT id, name, category, platform_parent, min_cpm, max_cpm, pricing_model,
           estimated_monthly_reach, status
    FROM inventories WHERE id = ?
  `).get(inventoryId);

  if (!inv) return null;
  return computePricingFields(inv);
}

async function updatePricing() {
  const db = getDb();
  let updates = [];
  let aiModelUsed = 'fallback';

  try {
    const inventories = db.prepare('SELECT id, name, category, min_cpm, max_cpm, pricing_model FROM inventories').all();
    const inventoryNames = inventories.map(i => `${i.name} (current: ₹${i.min_cpm}-₹${i.max_cpm} ${i.pricing_model})`).join('\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an ad pricing analyst specializing in the Indian digital advertising market.
Given a list of ad inventories with their current pricing, provide updated cost estimates.

Return a JSON array where each object has:
- name: string (exact match to input)
- min_cpm: number (INR)
- max_cpm: number (INR)
- pricing_model: string
- price_trend: "increasing", "stable", or "decreasing"

Return ONLY the JSON array, no markdown.`
        },
        {
          role: 'user',
          content: `Update pricing estimates for these Indian ad inventories (date: ${new Date().toISOString().split('T')[0]}):\n\n${inventoryNames}`
        }
      ],
      temperature: 0.4,
      max_tokens: 4000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    updates = JSON.parse(jsonStr);
    aiModelUsed = 'gpt-4o';
  } catch (err) {
    console.error('[PricingAgent] OpenAI call failed, using fallback:', err.message);
    updates = FALLBACK_PRICING_UPDATES;
    aiModelUsed = 'fallback';
  }

  let updatedCount = 0;
  for (const update of updates) {
    const result = db.prepare(`
      UPDATE inventories SET
        min_cpm = ?, max_cpm = ?, pricing_model = COALESCE(?, pricing_model),
        last_verified_date = datetime('now'), updated_at = datetime('now')
      WHERE LOWER(name) = LOWER(?)
    `).run(update.min_cpm, update.max_cpm, update.pricing_model, update.name);
    if (result.changes > 0) updatedCount++;
  }

  return { updated: updatedCount, total: updates.length, ai_model_used: aiModelUsed };
}

function comparePricing(inventoryIds) {
  const db = getDb();
  if (!inventoryIds || inventoryIds.length === 0) return [];

  const placeholders = inventoryIds.map(() => '?').join(',');
  const inventories = db.prepare(`
    SELECT id, name, category, platform_parent, min_cpm, max_cpm, pricing_model, estimated_monthly_reach
    FROM inventories WHERE id IN (${placeholders})
  `).all(...inventoryIds);

  return inventories.map(inv => computePricingFields(inv));
}

function getAllPricing() {
  const db = getDb();
  const inventories = db.prepare(`
    SELECT id, name, category, platform_parent, min_cpm, max_cpm, pricing_model,
           estimated_monthly_reach, status
    FROM inventories ORDER BY name
  `).all();

  return inventories.map(inv => computePricingFields(inv));
}

module.exports = { getPricingData, updatePricing, comparePricing, getAllPricing };
