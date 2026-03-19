const { getDb } = require('../database/db');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function calculateFallbackBudget(inventory) {
  const maxCpm = inventory.max_cpm || 100;
  const minCpm = inventory.min_cpm || 20;
  const avgCpm = (minCpm + maxCpm) / 2;

  // test_budget = max_cpm * 1000 (get ~1000 impressions minimum)
  const testBudget = maxCpm * 1000;
  // starter = test * 10
  const starterBudget = testBudget * 10;
  // scale = starter * 5
  const scaleBudget = starterBudget * 5;

  // Estimate performance metrics
  const avgCtr = inventory.category === 'search' ? 0.035 :
                 inventory.category === 'social' ? 0.012 :
                 inventory.category === 'video' ? 0.008 :
                 inventory.category === 'audio' ? 0.005 : 0.01;

  const avgConversionRate = 0.03; // 3% from click to conversion

  return {
    test_budget: Math.round(testBudget),
    starter_budget: Math.round(starterBudget),
    scale_budget: Math.round(scaleBudget),
    expected_test_impressions: Math.round((testBudget / avgCpm) * 1000),
    expected_test_clicks: Math.round((testBudget / avgCpm) * 1000 * avgCtr),
    expected_test_conversions: Math.round((testBudget / avgCpm) * 1000 * avgCtr * avgConversionRate),
    expected_starter_impressions: Math.round((starterBudget / avgCpm) * 1000),
    expected_starter_clicks: Math.round((starterBudget / avgCpm) * 1000 * avgCtr),
    expected_starter_conversions: Math.round((starterBudget / avgCpm) * 1000 * avgCtr * avgConversionRate),
    expected_scale_impressions: Math.round((scaleBudget / avgCpm) * 1000),
    expected_scale_clicks: Math.round((scaleBudget / avgCpm) * 1000 * avgCtr),
    expected_scale_conversions: Math.round((scaleBudget / avgCpm) * 1000 * avgCtr * avgConversionRate),
    estimated_cpa_test: Math.round(testBudget / Math.max(1, (testBudget / avgCpm) * 1000 * avgCtr * avgConversionRate)),
    estimated_cpa_starter: Math.round(starterBudget / Math.max(1, (starterBudget / avgCpm) * 1000 * avgCtr * avgConversionRate)),
    estimated_cpa_scale: Math.round(scaleBudget / Math.max(1, (scaleBudget / avgCpm) * 1000 * avgCtr * avgConversionRate)),
    rationale: `Fallback calculation based on CPM range ₹${minCpm}-₹${maxCpm}. Test budget covers ~${Math.round((testBudget / avgCpm) * 1000)} impressions for statistical significance. Starter budget provides 10x test for learning phase. Scale budget at 5x starter for meaningful reach.`,
    confidence_score: 0.5,
    data_sources: 'cpm_based_calculation'
  };
}

function getBudgetRecommendation(inventoryId) {
  const db = getDb();
  const existing = db.prepare(`
    SELECT * FROM budget_recommendations WHERE inventory_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(inventoryId);

  if (existing) {
    // Parse and enrich stored data
    const inventory = db.prepare('SELECT name, category, min_cpm, max_cpm FROM inventories WHERE id = ?').get(inventoryId);
    return {
      ...existing,
      inventory_name: inventory ? inventory.name : 'Unknown',
      category: inventory ? inventory.category : 'Unknown',
      rationale_parsed: existing.rationale,
      data_sources_parsed: existing.data_sources
    };
  }

  // Generate if not found
  return generateBudgetRecommendation(inventoryId);
}

async function generateBudgetRecommendation(inventoryId) {
  const db = getDb();
  const inventory = db.prepare('SELECT * FROM inventories WHERE id = ?').get(inventoryId);
  if (!inventory) throw new Error(`Inventory not found: ${inventoryId}`);

  let budgetData;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a media planning expert for Indian fintech advertising.
Given an ad inventory, recommend budgets across three tiers.

Return a JSON object with:
- test_budget: number (INR, minimum for statistically valid test data)
- starter_budget: number (INR, initial scale for learning phase)
- scale_budget: number (INR, meaningful reach and optimization)
- expected_test_impressions: number
- expected_test_clicks: number
- expected_test_conversions: number
- expected_starter_impressions: number
- expected_starter_clicks: number
- expected_starter_conversions: number
- expected_scale_impressions: number
- expected_scale_clicks: number
- expected_scale_conversions: number
- estimated_cpa_test: number (INR)
- estimated_cpa_starter: number (INR)
- estimated_cpa_scale: number (INR)
- rationale: string (2-3 sentences explaining the recommendation)
- confidence_score: number (0-1)
- data_sources: string

Context: Univest is a fintech app for stock trading, mutual funds, and personal finance.
Target audience: 25-45, Tier 1+2 cities, interested in investing.
Return ONLY the JSON object.`
        },
        {
          role: 'user',
          content: `Recommend budgets for: ${inventory.name} (${inventory.category}, ${inventory.platform_parent || 'Independent'}, CPM: ₹${inventory.min_cpm}-₹${inventory.max_cpm}, pricing: ${inventory.pricing_model}, monthly reach: ${inventory.estimated_monthly_reach})`
        }
      ],
      temperature: 0.4,
      max_tokens: 2000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    budgetData = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[BudgetAgent] OpenAI call failed, using fallback:', err.message);
    budgetData = calculateFallbackBudget(inventory);
  }

  // Store in DB
  const id = uuidv4();
  db.prepare(`
    INSERT INTO budget_recommendations (id, inventory_id, recommended_testing_budget, recommended_starting_budget,
      recommended_scale_budget, rationale, data_sources, confidence_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id, inventoryId,
    budgetData.test_budget,
    budgetData.starter_budget,
    budgetData.scale_budget,
    budgetData.rationale || '',
    budgetData.data_sources || 'ai_generated',
    budgetData.confidence_score || 0.7
  );

  return {
    id,
    inventory_id: inventoryId,
    inventory_name: inventory.name,
    category: inventory.category,
    ...budgetData
  };
}

function compareBudgets(inventoryIds) {
  const db = getDb();
  if (!inventoryIds || inventoryIds.length === 0) return [];

  const results = [];
  for (const invId of inventoryIds) {
    try {
      const rec = getBudgetRecommendation(invId);
      results.push(rec);
    } catch (err) {
      console.error(`[BudgetAgent] Error getting budget for ${invId}:`, err.message);
    }
  }

  return results;
}

module.exports = { getBudgetRecommendation, generateBudgetRecommendation, compareBudgets };
