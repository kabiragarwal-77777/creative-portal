const { getDb } = require('../database/db');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const FALLBACK_DISCOVERIES = [
  {
    name: 'PhonePe Ads',
    category: 'in_app',
    platform_parent: 'PhonePe',
    min_cpm: 40,
    max_cpm: 90,
    pricing_model: 'CPM',
    estimated_monthly_reach: 450000000,
    target_audience_fit: 9,
    fintech_friendly: 1,
    source_url: 'https://business.phonepe.com/ads'
  },
  {
    name: 'Swiggy Instamart Ads',
    category: 'in_app',
    platform_parent: 'Swiggy',
    min_cpm: 50,
    max_cpm: 120,
    pricing_model: 'CPM',
    estimated_monthly_reach: 50000000,
    target_audience_fit: 6,
    fintech_friendly: 1,
    source_url: 'https://partner.swiggy.com'
  },
  {
    name: 'Jio Cinema Premium Ads',
    category: 'video',
    platform_parent: 'Jio',
    min_cpm: 80,
    max_cpm: 200,
    pricing_model: 'CPM',
    estimated_monthly_reach: 200000000,
    target_audience_fit: 7,
    fintech_friendly: 1,
    source_url: 'https://ads.jiocinema.com'
  },
  {
    name: 'Flipkart Ads Network',
    category: 'in_app',
    platform_parent: 'Flipkart',
    min_cpm: 30,
    max_cpm: 80,
    pricing_model: 'CPC',
    estimated_monthly_reach: 350000000,
    target_audience_fit: 7,
    fintech_friendly: 1,
    source_url: 'https://ads.flipkart.com'
  },
  {
    name: 'Zomato Hyperpure Ads',
    category: 'in_app',
    platform_parent: 'Zomato',
    min_cpm: 45,
    max_cpm: 110,
    pricing_model: 'CPM',
    estimated_monthly_reach: 80000000,
    target_audience_fit: 5,
    fintech_friendly: 1,
    source_url: 'https://www.zomato.com/advertising'
  },
  {
    name: 'Spotify India Audio Ads',
    category: 'audio',
    platform_parent: 'Spotify',
    min_cpm: 100,
    max_cpm: 250,
    pricing_model: 'CPM',
    estimated_monthly_reach: 80000000,
    target_audience_fit: 6,
    fintech_friendly: 1,
    source_url: 'https://ads.spotify.com/en-IN/'
  },
  {
    name: 'Threads Ads (Meta)',
    category: 'social',
    platform_parent: 'Meta',
    min_cpm: 20,
    max_cpm: 60,
    pricing_model: 'CPM',
    estimated_monthly_reach: 30000000,
    target_audience_fit: 6,
    fintech_friendly: 1,
    source_url: 'https://www.facebook.com/business/ads'
  },
  {
    name: 'Paytm Ads Platform',
    category: 'in_app',
    platform_parent: 'Paytm',
    min_cpm: 35,
    max_cpm: 85,
    pricing_model: 'CPM',
    estimated_monthly_reach: 300000000,
    target_audience_fit: 9,
    fintech_friendly: 1,
    source_url: 'https://business.paytm.com/ads'
  },
  {
    name: 'ShareChat Ads',
    category: 'social',
    platform_parent: 'ShareChat',
    min_cpm: 15,
    max_cpm: 40,
    pricing_model: 'CPM',
    estimated_monthly_reach: 180000000,
    target_audience_fit: 5,
    fintech_friendly: 1,
    source_url: 'https://ads.sharechat.com'
  },
  {
    name: 'Dailyhunt / Josh Ads',
    category: 'social',
    platform_parent: 'VerSe Innovation',
    min_cpm: 10,
    max_cpm: 35,
    pricing_model: 'CPM',
    estimated_monthly_reach: 300000000,
    target_audience_fit: 5,
    fintech_friendly: 1,
    source_url: 'https://ads.dailyhunt.in'
  }
];

async function runDiscovery() {
  const db = getDb();
  let discoveries = [];
  let aiModelUsed = 'fallback';

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an ad inventory discovery agent for Univest, an Indian fintech company.
Your job is to find new and emerging advertising inventory opportunities in India.

Focus on:
1. New ad platforms or ad networks launching in India
2. New ad formats on existing platforms (Instagram, YouTube, Google, Meta, etc.)
3. Seasonal advertising opportunities (IPL, Diwali, Budget season, etc.)
4. Emerging channels: CTV, DOOH, podcast ads, in-game ads, in-app commerce ads
5. Platform-specific inventory: PhonePe, Paytm, CRED, Groww, Zerodha, etc.

Return a JSON array of discovered inventories. Each object must have:
- name: string
- category: one of "social", "search", "video", "audio", "programmatic", "in_app", "dooh", "ctv", "podcast", "influencer", "email", "sms", "push_notification", "native"
- platform_parent: string
- min_cpm: number (in INR)
- max_cpm: number (in INR)
- pricing_model: "CPM", "CPC", "CPA", "CPV", "Flat Rate", or "Hybrid"
- estimated_monthly_reach: number
- target_audience_fit: 1-10 (10 = perfect fit for fintech)
- fintech_friendly: 0 or 1
- source_url: string

Return ONLY the JSON array, no markdown.`
        },
        {
          role: 'user',
          content: `Discover 10 new or emerging ad inventory opportunities in India for a fintech company focused on stock trading, mutual funds, and personal finance. Date: ${new Date().toISOString().split('T')[0]}`
        }
      ],
      temperature: 0.7,
      max_tokens: 4000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    discoveries = JSON.parse(jsonStr);
    aiModelUsed = 'gpt-4o';
  } catch (err) {
    console.error('[DiscoveryAgent] OpenAI call failed, using fallback:', err.message);
    discoveries = FALLBACK_DISCOVERIES;
    aiModelUsed = 'fallback';
  }

  let newCount = 0;
  let updatedCount = 0;

  for (const disc of discoveries) {
    // Deduplicate by checking name similarity
    const existing = db.prepare(
      `SELECT id, name FROM inventories WHERE LOWER(name) = LOWER(?) OR name LIKE ?`
    ).get(disc.name, `%${disc.name.split(' ')[0]}%${disc.name.split(' ').slice(-1)[0]}%`);

    if (existing) {
      // Update existing inventory with fresh data
      db.prepare(`
        UPDATE inventories SET
          min_cpm = COALESCE(?, min_cpm),
          max_cpm = COALESCE(?, max_cpm),
          estimated_monthly_reach = COALESCE(?, estimated_monthly_reach),
          last_verified_date = datetime('now'),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(disc.min_cpm, disc.max_cpm, disc.estimated_monthly_reach, existing.id);
      updatedCount++;
    } else {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO inventories (id, name, category, platform_parent, country, min_cpm, max_cpm,
          pricing_model, estimated_monthly_reach, target_audience_fit, fintech_friendly,
          last_verified_date, source_url, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, datetime('now'), ?, 'new', datetime('now'), datetime('now'))
      `).run(
        id, disc.name, disc.category, disc.platform_parent,
        disc.min_cpm, disc.max_cpm, disc.pricing_model,
        disc.estimated_monthly_reach, disc.target_audience_fit || 5,
        disc.fintech_friendly !== undefined ? disc.fintech_friendly : 1,
        disc.source_url || null
      );
      newCount++;
    }
  }

  // Log the discovery run
  const logId = uuidv4();
  db.prepare(`
    INSERT INTO discovery_log (id, run_date, inventories_found, new_inventories, updated_inventories, ai_model_used, summary)
    VALUES (?, datetime('now'), ?, ?, ?, ?, ?)
  `).run(
    logId,
    discoveries.length,
    newCount,
    updatedCount,
    aiModelUsed,
    `Discovery run completed. Found ${discoveries.length} inventories. ${newCount} new, ${updatedCount} updated.`
  );

  return {
    total_found: discoveries.length,
    new_inventories: newCount,
    updated_inventories: updatedCount,
    ai_model_used: aiModelUsed,
    log_id: logId
  };
}

function getDiscoveryLog() {
  const db = getDb();
  return db.prepare('SELECT * FROM discovery_log ORDER BY run_date DESC').all();
}

function getNewInventories() {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM inventories
    WHERE status = 'new'
      AND created_at >= datetime('now', '-7 days')
    ORDER BY created_at DESC
  `).all();
}

function autoUpdateStatus() {
  const db = getDb();
  const result = db.prepare(`
    UPDATE inventories
    SET status = 'active', updated_at = datetime('now')
    WHERE status = 'new'
      AND created_at < datetime('now', '-7 days')
  `).run();
  return { updated: result.changes };
}

module.exports = { runDiscovery, getDiscoveryLog, getNewInventories, autoUpdateStatus };
