const { getDb } = require('../database/db');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FALLBACK_COMPETITOR_DATA = [
  { competitor: 'Groww', inventory: 'Meta Instagram Feed', spend: 2500000, confidence: 'high' },
  { competitor: 'Groww', inventory: 'Google Search UAC', spend: 5000000, confidence: 'high' },
  { competitor: 'Groww', inventory: 'YouTube In-Stream', spend: 3000000, confidence: 'medium' },
  { competitor: 'Zerodha', inventory: 'Google Search UAC', spend: 1500000, confidence: 'medium' },
  { competitor: 'Zerodha', inventory: 'YouTube In-Stream', spend: 800000, confidence: 'medium' },
  { competitor: 'Angel One', inventory: 'Meta Instagram Feed', spend: 4000000, confidence: 'high' },
  { competitor: 'Angel One', inventory: 'Google Search UAC', spend: 6000000, confidence: 'high' },
  { competitor: 'Angel One', inventory: 'YouTube In-Stream', spend: 3500000, confidence: 'medium' },
  { competitor: 'Angel One', inventory: 'Google Display Network', spend: 2000000, confidence: 'medium' },
  { competitor: 'Upstox', inventory: 'Meta Instagram Reels', spend: 2000000, confidence: 'medium' },
  { competitor: 'Upstox', inventory: 'YouTube Shorts', spend: 1500000, confidence: 'medium' },
  { competitor: 'Upstox', inventory: 'Google Search UAC', spend: 3000000, confidence: 'high' },
  { competitor: '5paisa', inventory: 'Google Search UAC', spend: 1200000, confidence: 'medium' },
  { competitor: '5paisa', inventory: 'Google Display Network', spend: 800000, confidence: 'low' },
  { competitor: 'CRED', inventory: 'Meta Instagram Feed', spend: 8000000, confidence: 'high' },
  { competitor: 'CRED', inventory: 'YouTube In-Stream', spend: 10000000, confidence: 'high' },
  { competitor: 'Paytm Money', inventory: 'PhonePe Ads', spend: 500000, confidence: 'low' },
  { competitor: 'Paytm Money', inventory: 'Google Search UAC', spend: 2000000, confidence: 'medium' }
];

function getCompetitorSpends(inventoryId) {
  const db = getDb();
  return db.prepare(`
    SELECT cs.*, c.name as competitor_name, c.vertical, c.estimated_monthly_adspend,
           i.name as inventory_name, i.category
    FROM competitor_spends cs
    JOIN competitors c ON cs.competitor_id = c.id
    JOIN inventories i ON cs.inventory_id = i.id
    WHERE cs.inventory_id = ?
    ORDER BY cs.estimated_monthly_spend DESC
  `).all(inventoryId);
}

function getCompetitorProfile(competitorId) {
  const db = getDb();
  const competitor = db.prepare('SELECT * FROM competitors WHERE id = ?').get(competitorId);
  if (!competitor) return null;

  const spends = db.prepare(`
    SELECT cs.*, i.name as inventory_name, i.category, i.platform_parent
    FROM competitor_spends cs
    JOIN inventories i ON cs.inventory_id = i.id
    WHERE cs.competitor_id = ?
    ORDER BY cs.estimated_monthly_spend DESC
  `).all(competitorId);

  const totalSpend = spends.reduce((sum, s) => sum + (s.estimated_monthly_spend || 0), 0);
  const topChannel = spends.length > 0 ? spends[0].inventory_name : 'Unknown';
  const channelCount = new Set(spends.map(s => s.category)).size;

  return {
    ...competitor,
    spends,
    total_tracked_spend: totalSpend,
    top_channel: topChannel,
    channel_diversity: channelCount,
    spend_count: spends.length
  };
}

async function refreshCompetitorData() {
  const db = getDb();
  let updates = [];
  let aiModelUsed = 'fallback';

  try {
    const competitors = db.prepare('SELECT id, name, vertical FROM competitors').all();
    const inventories = db.prepare('SELECT id, name, category FROM inventories').all();

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a competitive intelligence analyst for the Indian fintech advertising market.

Given a list of competitors and ad inventories, estimate monthly ad spend for each competitor-inventory pair where you believe the competitor is active.

Return a JSON array where each object has:
- competitor: string (exact name match)
- inventory: string (exact name match)
- spend: number (monthly INR estimate)
- confidence: "high", "medium", or "low"

Only include pairs where you have reasonable evidence the competitor is advertising. Return ONLY the JSON array.`
        },
        {
          role: 'user',
          content: `Competitors:\n${competitors.map(c => c.name).join(', ')}\n\nInventories:\n${inventories.map(i => `${i.name} (${i.category})`).join(', ')}\n\nDate: ${new Date().toISOString().split('T')[0]}`
        }
      ],
      temperature: 0.5,
      max_tokens: 4000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    updates = JSON.parse(jsonStr);
    aiModelUsed = 'gpt-4o';
  } catch (err) {
    console.error('[CompetitorAgent] OpenAI call failed, using fallback:', err.message);
    updates = FALLBACK_COMPETITOR_DATA;
    aiModelUsed = 'fallback';
  }

  let insertedCount = 0;
  for (const update of updates) {
    const competitor = db.prepare('SELECT id FROM competitors WHERE LOWER(name) = LOWER(?)').get(update.competitor);
    const inventory = db.prepare('SELECT id FROM inventories WHERE LOWER(name) = LOWER(?)').get(update.inventory);

    if (!competitor || !inventory) continue;

    // Upsert: delete old record and insert new
    db.prepare('DELETE FROM competitor_spends WHERE competitor_id = ? AND inventory_id = ?')
      .run(competitor.id, inventory.id);

    db.prepare(`
      INSERT INTO competitor_spends (id, competitor_id, inventory_id, estimated_monthly_spend, confidence_level, source, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(uuidv4(), competitor.id, inventory.id, update.spend, update.confidence, aiModelUsed);
    insertedCount++;
  }

  return { updated: insertedCount, total: updates.length, ai_model_used: aiModelUsed };
}

function getWhitespace() {
  const db = getDb();
  // Find inventories with audience_fit > 5 that have zero competitor_spends entries
  const whitespace = db.prepare(`
    SELECT i.* FROM inventories i
    WHERE i.target_audience_fit > 5
      AND i.id NOT IN (SELECT DISTINCT inventory_id FROM competitor_spends)
    ORDER BY i.target_audience_fit DESC, i.estimated_monthly_reach DESC
  `).all();

  return whitespace.map(inv => ({
    ...inv,
    opportunity_reason: 'No competitor presence detected',
    avg_cpm: inv.min_cpm && inv.max_cpm ? (inv.min_cpm + inv.max_cpm) / 2 : null,
    recommendation: inv.target_audience_fit >= 8
      ? 'High priority - strong audience fit, no competition'
      : inv.target_audience_fit >= 6
        ? 'Medium priority - decent fit, explore further'
        : 'Low priority - moderate fit'
  }));
}

function getAdvantagesDisadvantages(inventoryId) {
  const db = getDb();
  const inventory = db.prepare('SELECT * FROM inventories WHERE id = ?').get(inventoryId);
  if (!inventory) return null;

  const competitorSpends = db.prepare(`
    SELECT cs.*, c.name as competitor_name
    FROM competitor_spends cs
    JOIN competitors c ON cs.competitor_id = c.id
    WHERE cs.inventory_id = ?
  `).all(inventoryId);

  const totalCompetitorSpend = competitorSpends.reduce((s, c) => s + (c.estimated_monthly_spend || 0), 0);
  const competitorCount = competitorSpends.length;
  const avgCpm = (inventory.min_cpm + inventory.max_cpm) / 2;

  const advantages = [];
  const disadvantages = [];

  // Audience fit
  if (inventory.target_audience_fit >= 8) {
    advantages.push('Strong audience alignment with fintech/investment users');
  } else if (inventory.target_audience_fit <= 4) {
    disadvantages.push('Weak audience alignment - may see poor conversion rates');
  }

  // Competition level
  if (competitorCount === 0) {
    advantages.push('No competitor presence - first mover advantage');
  } else if (competitorCount <= 2) {
    advantages.push(`Low competition (${competitorCount} competitors) - room to capture share`);
  } else if (competitorCount >= 5) {
    disadvantages.push(`Highly competitive (${competitorCount} competitors) - CPMs may inflate`);
  }

  // Pricing
  if (avgCpm < 50) {
    advantages.push(`Low cost entry (avg ₹${Math.round(avgCpm)} CPM) - good for testing`);
  } else if (avgCpm > 200) {
    disadvantages.push(`High CPM (avg ₹${Math.round(avgCpm)}) - requires significant budget`);
  }

  // Reach
  if (inventory.estimated_monthly_reach > 100000000) {
    advantages.push('Massive reach potential (100M+ monthly)');
  } else if (inventory.estimated_monthly_reach < 1000000) {
    disadvantages.push('Limited reach - may not scale');
  }

  // Fintech friendly
  if (inventory.fintech_friendly) {
    advantages.push('Platform is fintech-friendly with streamlined approval');
  } else {
    disadvantages.push('Platform has strict fintech ad policies - expect approval delays');
  }

  // Competitor spend intensity
  if (totalCompetitorSpend > 10000000) {
    disadvantages.push('Heavy competitor investment (₹1Cr+/month combined) - established players');
  }

  return {
    inventory_name: inventory.name,
    inventory_id: inventoryId,
    advantages,
    disadvantages,
    competitor_count: competitorCount,
    total_competitor_spend: totalCompetitorSpend,
    overall_recommendation: advantages.length > disadvantages.length ? 'Favorable' :
                            advantages.length < disadvantages.length ? 'Cautious' : 'Neutral',
    top_competitors: competitorSpends.slice(0, 3).map(c => ({
      name: c.competitor_name,
      spend: c.estimated_monthly_spend
    }))
  };
}

function getAllCompetitors() {
  const db = getDb();
  return db.prepare('SELECT * FROM competitors ORDER BY name').all();
}

module.exports = { getCompetitorSpends, getCompetitorProfile, refreshCompetitorData, getWhitespace, getAdvantagesDisadvantages, getAllCompetitors };
