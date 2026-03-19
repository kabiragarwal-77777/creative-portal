const { getDb } = require('../database/db');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DEFAULT_FORMAT_SCORES = {
  social: {
    video: { score: 9, reason: 'Short-form video drives highest engagement on social platforms', best_size_spec: '1080x1920 (9:16), 15-30s', example_hook: 'See how ₹500/month can grow to ₹5 Lakhs', compliance_notes: 'Include SEBI disclaimer in first 3 seconds' },
    carousel: { score: 8, reason: 'Carousel allows multi-step storytelling for financial education', best_size_spec: '1080x1080, 3-10 cards', example_hook: '5 stocks that doubled in 2025 →', compliance_notes: 'Each card needs risk disclaimer if showing returns' },
    story: { score: 8, reason: 'Stories create urgency and direct response for app installs', best_size_spec: '1080x1920 (9:16), 5-15s', example_hook: 'IPO Alert: Subscribe before 5 PM today', compliance_notes: 'Swipe-up must go to compliant landing page' },
    static: { score: 6, reason: 'Static images have lower engagement but good for brand awareness', best_size_spec: '1080x1080 or 1200x628', example_hook: '₹0 Brokerage. Start Trading Today.', compliance_notes: 'Must include "Investments subject to market risks" text' },
    native: { score: 5, reason: 'Native ads blend in but may underperform for direct response', best_size_spec: 'Platform-specific, article format', example_hook: 'How millennials are building wealth in 2026', compliance_notes: 'Mark as "Sponsored" per ASCI guidelines' }
  },
  search: {
    search_text: { score: 10, reason: 'Highest intent format - users actively searching for financial products', best_size_spec: '3 headlines (30 char each), 2 descriptions (90 char)', example_hook: 'Open Free Demat Account | ₹0 Brokerage on Delivery', compliance_notes: 'Cannot claim guaranteed returns in ad text' },
    shopping: { score: 7, reason: 'App listing ads work well for trading app installs', best_size_spec: 'App icon + screenshots + description', example_hook: 'Univest - Stock Trading & MF App', compliance_notes: 'App store listing must match ad claims' }
  },
  video: {
    video: { score: 10, reason: 'Video platforms are built for video - maximum format advantage', best_size_spec: '1920x1080 (16:9), 15-30s skippable or 6s bumper', example_hook: 'I turned ₹10,000 into ₹1 Lakh. Here is how.', compliance_notes: 'Non-skippable must be max 15s, include disclaimer overlay' },
    static: { score: 3, reason: 'Static display on video platforms has very low engagement', best_size_spec: '300x250 or 728x90 companion', example_hook: 'Trade Smarter with Univest', compliance_notes: 'Standard display compliance applies' }
  },
  audio: {
    audio: { score: 10, reason: 'Audio is the native format - highest attention on audio platforms', best_size_spec: '15-30s audio spot, 44.1kHz stereo', example_hook: 'Tired of your savings earning 4%? Univest users earn 12% average returns.', compliance_notes: 'Must verbally state risk disclaimer' }
  },
  programmatic: {
    static: { score: 7, reason: 'Display banners have broad reach across programmatic networks', best_size_spec: '300x250, 728x90, 160x600, 320x50', example_hook: 'Smart Investing Starts Here - Download Univest', compliance_notes: 'Landing page must match ad content' },
    video: { score: 8, reason: 'Outstream/in-banner video commands attention in programmatic', best_size_spec: '640x360 or 1280x720, 15-30s, autoplay muted', example_hook: 'Markets up 20% this year. Are you investing yet?', compliance_notes: 'Autoplay must be muted, include captions' },
    native: { score: 7, reason: 'Native programmatic blends with publisher content for trust', best_size_spec: '1200x628 + 100 char title + 200 char body', example_hook: 'Why 10 lakh Indians switched to Univest this month', compliance_notes: 'Must be clearly marked as advertisement' },
    rich_media: { score: 6, reason: 'Interactive rich media drives engagement but has higher production cost', best_size_spec: '300x250 expandable, HTML5', example_hook: 'Swipe to see your portfolio grow →', compliance_notes: 'Expansion must be user-initiated, not auto' }
  },
  in_app: {
    native: { score: 8, reason: 'In-app native ads match the host app experience', best_size_spec: 'Platform-specific native unit', example_hook: 'Complete your financial portfolio with Univest', compliance_notes: 'Must comply with host app ad policies' },
    video: { score: 8, reason: 'Rewarded/interstitial video has high completion rates in-app', best_size_spec: '1080x1920 or 1920x1080, 15-30s', example_hook: 'Watch & earn: Learn how to start investing', compliance_notes: 'Rewarded video must deliver promised reward' },
    static: { score: 6, reason: 'Banner ads in apps have moderate visibility', best_size_spec: '320x50 or 320x100', example_hook: '₹0 Account Opening - Trade Now', compliance_notes: 'Standard SEBI compliance required' },
    interstitial: { score: 7, reason: 'Full-screen interstitials get attention between app sessions', best_size_spec: '1080x1920 full screen', example_hook: 'Ready to invest? Open Univest in 2 mins', compliance_notes: 'Must have clear close button, no dark patterns' }
  },
  dooh: {
    static: { score: 7, reason: 'Digital OOH billboards in metro areas hit affluent audiences', best_size_spec: '1920x1080 or custom per venue', example_hook: 'Your money should work harder. Univest.', compliance_notes: 'Limited text, QR codes for compliance details' },
    video: { score: 8, reason: 'Moving DOOH creatives capture attention in high-traffic areas', best_size_spec: '1920x1080, 10-15s loop', example_hook: 'Markets are live. Are you? Download Univest.', compliance_notes: 'No misleading return claims on public display' }
  },
  ctv: {
    video: { score: 9, reason: 'CTV ads on big screen create premium brand impact', best_size_spec: '1920x1080 (16:9), 15-30s', example_hook: 'Invest from your couch. Univest app.', compliance_notes: 'Full disclaimer at end, QR code for app download' }
  },
  podcast: {
    audio: { score: 9, reason: 'Host-read podcast ads have highest trust and engagement', best_size_spec: '30-60s host read or 15-30s produced spot', example_hook: 'I have been using Univest to manage my portfolio and honestly...', compliance_notes: 'Host must disclose sponsorship, avoid return guarantees' }
  },
  influencer: {
    video: { score: 9, reason: 'Influencer video content drives authentic engagement and trust', best_size_spec: '1080x1920 (9:16) or 1920x1080 (16:9), 30-120s', example_hook: 'My honest review of Univest after 6 months...', compliance_notes: 'Must tag #Ad or #Sponsored per ASCI, SEBI disclaimer required' },
    static: { score: 6, reason: 'Static influencer posts have lower engagement than video', best_size_spec: '1080x1080', example_hook: 'My portfolio is up 18% this year. Link in bio.', compliance_notes: '#Paid partnership label required' }
  },
  email: {
    static: { score: 7, reason: 'Email newsletters reach engaged finance-interested audiences', best_size_spec: '600px wide HTML, mobile responsive', example_hook: 'This week in markets: 3 stocks to watch', compliance_notes: 'CAN-SPAM/India IT Act compliance, unsubscribe link' }
  },
  sms: {
    static: { score: 5, reason: 'SMS has high open rate but limited creative expression', best_size_spec: '160 characters + short URL', example_hook: 'Univest: Markets up 2% today. See top gainers: [link]', compliance_notes: 'DND compliance, TRAI regulations, opt-out required' }
  },
  push_notification: {
    static: { score: 6, reason: 'Push notifications drive re-engagement for app users', best_size_spec: 'Title (50 char) + Body (100 char) + icon', example_hook: 'Your watchlist stock just hit 52-week high!', compliance_notes: 'Must have opt-in, cannot send financial advice via push' }
  },
  native: {
    native: { score: 8, reason: 'Native content networks offer seamless content discovery', best_size_spec: '1200x628 thumbnail + headline + body', example_hook: 'How this app is changing the way Indians invest', compliance_notes: 'Clearly mark as sponsored content per ASCI' },
    static: { score: 6, reason: 'Standard native display ads blend with publisher content', best_size_spec: '300x250 or in-feed unit', example_hook: 'Start your investment journey today', compliance_notes: 'Must not mimic editorial content without disclosure' }
  }
};

function getFormatRecommendations(inventoryId) {
  const db = getDb();
  let scores = db.prepare(`
    SELECT * FROM ad_format_scores
    WHERE inventory_id = ?
    ORDER BY score DESC
  `).all(inventoryId);

  if (scores.length === 0) {
    generateFormatScores(inventoryId);
    scores = db.prepare(`
      SELECT * FROM ad_format_scores
      WHERE inventory_id = ?
      ORDER BY score DESC
    `).all(inventoryId);
  }

  const inventory = db.prepare('SELECT name, category FROM inventories WHERE id = ?').get(inventoryId);

  return {
    inventory_id: inventoryId,
    inventory_name: inventory ? inventory.name : 'Unknown',
    category: inventory ? inventory.category : 'Unknown',
    total_formats: scores.length,
    top_format: scores.length > 0 ? scores[0].format : null,
    scores
  };
}

async function generateFormatScores(inventoryId) {
  const db = getDb();
  const inventory = db.prepare('SELECT * FROM inventories WHERE id = ?').get(inventoryId);
  if (!inventory) throw new Error(`Inventory not found: ${inventoryId}`);

  let formatScores = [];

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an ad format specialist for Indian fintech advertising.
Given an ad inventory, score each applicable ad format from 1-10 for effectiveness.

Return a JSON array where each object has:
- format: string (e.g., "video", "carousel", "static", "native", "audio", "search_text", "story", "rich_media", "interstitial")
- score: integer 1-10
- reason: string (why this score)
- best_size_spec: string (recommended dimensions/duration)
- example_hook: string (sample hook text for Univest)
- compliance_notes: string (fintech-specific compliance notes)

Only include formats applicable to this inventory type.
Return ONLY the JSON array.`
        },
        {
          role: 'user',
          content: `Score ad formats for: ${inventory.name} (category: ${inventory.category}, platform: ${inventory.platform_parent || 'Independent'}, pricing: ${inventory.pricing_model})`
        }
      ],
      temperature: 0.4,
      max_tokens: 2000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    formatScores = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[AdFormatAgent] OpenAI call failed, using fallback:', err.message);
    // Use category-based defaults
    const categoryDefaults = DEFAULT_FORMAT_SCORES[inventory.category] || DEFAULT_FORMAT_SCORES.programmatic;
    formatScores = Object.entries(categoryDefaults).map(([format, data]) => ({
      format,
      score: data.score,
      reason: data.reason,
      best_size_spec: data.best_size_spec,
      example_hook: data.example_hook,
      compliance_notes: data.compliance_notes
    }));
  }

  // Store in DB
  // Clear existing scores first
  db.prepare('DELETE FROM ad_format_scores WHERE inventory_id = ?').run(inventoryId);

  for (const fs of formatScores) {
    const specJson = JSON.stringify({
      best_size_spec: fs.best_size_spec || '',
      example_hook: fs.example_hook || '',
      compliance_notes: fs.compliance_notes || ''
    });

    db.prepare(`
      INSERT INTO ad_format_scores (id, inventory_id, format, score, reason, best_size_spec, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(uuidv4(), inventoryId, fs.format, fs.score, fs.reason, specJson);
  }

  return formatScores;
}

module.exports = { getFormatRecommendations, generateFormatScores };
