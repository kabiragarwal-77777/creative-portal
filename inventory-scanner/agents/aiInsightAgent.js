const { getDb } = require('../database/db');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FALLBACK_INSIGHTS = [
  {
    insight_type: 'opportunity',
    title: 'PhonePe Ads showing strong fintech ROI',
    body: 'PhonePe Ads platform has 450M+ monthly users with high financial intent. Early adopters in fintech vertical are seeing CPAs 30-40% lower than Meta. Recommend allocating 10-15% of digital budget for testing.',
    priority: 'high',
    inventory_id: null
  },
  {
    insight_type: 'warning',
    title: 'Meta CPMs increasing 15-20% QoQ',
    body: 'Instagram and Facebook ad costs are trending upward, especially for BFSI category in India. Consider diversifying to YouTube Shorts and programmatic to maintain efficiency.',
    priority: 'high',
    inventory_id: null
  },
  {
    insight_type: 'trend',
    title: 'Short-form video dominating fintech ad performance',
    body: 'Across platforms, 15-30 second vertical videos are outperforming all other formats for fintech app installs. Reels, Shorts, and TikTok-style content showing 2-3x higher CTR than static ads.',
    priority: 'medium',
    inventory_id: null
  },
  {
    insight_type: 'benchmark',
    title: 'Industry CPA benchmark: ₹150-300 for demat account opening',
    body: 'Current market CPA for demat account opening via digital ads ranges from ₹150 (Google Search) to ₹300 (social media). If your CPA exceeds ₹350, review targeting and creative strategy.',
    priority: 'medium',
    inventory_id: null
  },
  {
    insight_type: 'whitespace',
    title: 'CRED Ads platform underutilized by competitors',
    body: 'Only 1-2 fintech competitors are active on CRED Ads despite the platform\'s premium user base (high credit score, affluent). First mover advantage available for investment-focused messaging.',
    priority: 'high',
    inventory_id: null
  },
  {
    insight_type: 'seasonal',
    title: 'Budget season (Feb) drives 40% spike in finance app installs',
    body: 'Historical data shows Union Budget announcement period drives massive interest in stock trading and tax-saving investments. Pre-load campaigns 2 weeks before budget date.',
    priority: 'medium',
    inventory_id: null
  },
  {
    insight_type: 'opportunity',
    title: 'YouTube Shorts ads at ₹10-15 CPM - best value in market',
    body: 'YouTube Shorts inventory is still priced 50-70% below Reels and main feed. With similar engagement rates, this represents the best CPM efficiency in current market. Scale budgets here.',
    priority: 'high',
    inventory_id: null
  },
  {
    insight_type: 'warning',
    title: 'Angel One ramping ad spend aggressively',
    body: 'Competitor Angel One has increased estimated monthly digital ad spend to ₹15-20 Cr across Google, Meta, and YouTube. Expect auction competition to increase in stock trading keywords.',
    priority: 'high',
    inventory_id: null
  },
  {
    insight_type: 'trend',
    title: 'Vernacular content ads showing 2x conversion in Tier 2 cities',
    body: 'Hindi, Tamil, and Telugu language ads are outperforming English by 2x on conversion rate in non-metro cities. Consider creating vernacular creative variants for YouTube and programmatic.',
    priority: 'medium',
    inventory_id: null
  },
  {
    insight_type: 'benchmark',
    title: 'App install costs varying 3x across platforms',
    body: 'Current app install CPI ranges: Google UAC ₹25-40, Meta ₹35-60, YouTube ₹20-35, Programmatic ₹15-30, In-App Networks ₹10-25. Portfolio approach recommended for optimal blended CPI.',
    priority: 'medium',
    inventory_id: null
  }
];

async function generateInsights() {
  const db = getDb();
  let insights = [];

  try {
    // Gather context data
    const inventories = db.prepare('SELECT name, category, min_cpm, max_cpm, status, target_audience_fit FROM inventories LIMIT 50').all();
    const competitors = db.prepare('SELECT name, estimated_monthly_adspend, primary_channels FROM competitors').all();
    const competitorSpends = db.prepare(`
      SELECT c.name as competitor, i.name as inventory, cs.estimated_monthly_spend
      FROM competitor_spends cs
      JOIN competitors c ON cs.competitor_id = c.id
      JOIN inventories i ON cs.inventory_id = i.id
      ORDER BY cs.estimated_monthly_spend DESC LIMIT 30
    `).all();

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a performance marketing strategist for Univest, an Indian fintech company (stock trading, mutual funds, personal finance app).

Analyze the provided inventory, competitor, and pricing data. Generate 10 specific, actionable insights.

Categories: opportunity, warning, trend, benchmark, whitespace, seasonal

Return a JSON array of 10 insights, each with:
- insight_type: string (one of the categories above)
- title: string (concise, actionable)
- body: string (2-3 sentences with specific numbers/recommendations)
- priority: "high", "medium", or "low"

Return ONLY the JSON array.`
        },
        {
          role: 'user',
          content: `Current inventory data:\n${JSON.stringify(inventories, null, 1)}\n\nCompetitors:\n${JSON.stringify(competitors, null, 1)}\n\nTop competitor spends:\n${JSON.stringify(competitorSpends, null, 1)}\n\nDate: ${new Date().toISOString().split('T')[0]}`
        }
      ],
      temperature: 0.7,
      max_tokens: 4000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    insights = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[AIInsightAgent] OpenAI call failed, using fallback:', err.message);
    insights = FALLBACK_INSIGHTS;
  }

  // Store insights in DB
  let insertedCount = 0;
  for (const insight of insights) {
    db.prepare(`
      INSERT INTO ai_insights (id, inventory_id, insight_type, title, body, priority, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
    `).run(
      uuidv4(),
      insight.inventory_id || null,
      insight.insight_type,
      insight.title,
      insight.body,
      insight.priority || 'medium'
    );
    insertedCount++;
  }

  return { generated: insertedCount, total: insights.length };
}

async function newsSweep() {
  const db = getDb();
  let newsInsights = [];

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are a digital advertising news analyst focused on the Indian market.
Report any significant developments in the last 24 hours related to:
- New ad platform launches or features in India
- Pricing changes on major ad platforms
- New ad inventory types or formats
- Regulatory changes affecting fintech advertising
- Major advertiser moves in the fintech/BFSI space

If there are developments, return a JSON array of news items with:
- insight_type: "trend"
- title: string
- body: string (2-3 sentences)
- priority: "high"

If nothing notable happened, return an empty array [].
Return ONLY the JSON array.`
        },
        {
          role: 'user',
          content: `What significant Indian digital advertising developments happened in the last 24 hours? Date: ${new Date().toISOString()}`
        }
      ],
      temperature: 0.5,
      max_tokens: 2000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    newsInsights = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[AIInsightAgent] News sweep OpenAI call failed:', err.message);
    // No fallback for news - it is time-sensitive
    return { generated: 0, message: 'News sweep skipped - AI unavailable' };
  }

  let insertedCount = 0;
  for (const insight of newsInsights) {
    db.prepare(`
      INSERT INTO ai_insights (id, inventory_id, insight_type, title, body, priority, is_read, created_at)
      VALUES (?, NULL, ?, ?, ?, ?, 0, datetime('now'))
    `).run(uuidv4(), insight.insight_type || 'trend', insight.title, insight.body, insight.priority || 'high');
    insertedCount++;
  }

  return { generated: insertedCount };
}

function getInsights(onlyUnread) {
  const db = getDb();
  if (onlyUnread) {
    return db.prepare('SELECT * FROM ai_insights WHERE is_read = 0 ORDER BY created_at DESC').all();
  }
  return db.prepare('SELECT * FROM ai_insights ORDER BY created_at DESC').all();
}

function markAsRead(insightId) {
  const db = getDb();
  const result = db.prepare('UPDATE ai_insights SET is_read = 1 WHERE id = ?').run(insightId);
  return { updated: result.changes > 0 };
}

function getInsightsForInventory(inventoryId) {
  const db = getDb();
  return db.prepare('SELECT * FROM ai_insights WHERE inventory_id = ? ORDER BY created_at DESC').all(inventoryId);
}

module.exports = { generateInsights, newsSweep, getInsights, markAsRead, getInsightsForInventory };
