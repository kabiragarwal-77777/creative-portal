// ============================================================
// CONSOLIDATED AGENTS — inventory-scanner/agents.js
// All 12 agent modules merged into a single file.
// ============================================================

const { getDb } = require('./database/db');
const { v4: uuidv4 } = require('uuid');
let OpenAI, openai;
try {
  OpenAI = require('openai');
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy' });
} catch (e) {
  console.warn('[Agents] OpenAI SDK not available — AI features disabled');
}

// ==================== AD FORMAT AGENT ====================

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
      model: 'gpt-5.4',
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
      max_completion_tokens: 2000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    formatScores = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[AdFormatAgent] OpenAI call failed, using fallback:', err.message);
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

// ==================== AD SYNTHESIS AGENT ====================

function buildCompetitorAdProfile(competitorId) {
  const db = getDb();
  const competitor = db.prepare('SELECT * FROM competitors WHERE id = ?').get(competitorId);
  if (!competitor) return null;

  const metaAds = db.prepare('SELECT * FROM meta_ads WHERE competitor_id = ?').all(competitorId);
  const activeMetaAds = metaAds.filter(a => a.is_active === 1);
  const metaSpendMin = metaAds.reduce((s, a) => s + (a.spend_min || 0), 0);
  const metaSpendMax = metaAds.reduce((s, a) => s + (a.spend_max || 0), 0);
  const metaThemes = {};
  metaAds.forEach(a => {
    if (a.theme_tag) metaThemes[a.theme_tag] = (metaThemes[a.theme_tag] || 0) + 1;
  });
  const topMetaThemes = Object.entries(metaThemes).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const avgMetaRunDays = metaAds.length > 0 ? Math.round(metaAds.reduce((s, a) => s + (a.run_days || 0), 0) / metaAds.length) : 0;
  const longestMeta = metaAds.reduce((best, a) => (!best || (a.run_days || 0) > (best.run_days || 0)) ? a : best, null);
  const metaMediaTypes = {};
  metaAds.forEach(a => { if (a.media_type) metaMediaTypes[a.media_type] = (metaMediaTypes[a.media_type] || 0) + 1; });
  const dominantMetaFormat = Object.entries(metaMediaTypes).sort((a, b) => b[1] - a[1])[0];

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const newMetaAdsThisWeek = metaAds.filter(a => a.created_at && new Date(a.created_at) >= oneWeekAgo).length;

  const googleAds = db.prepare('SELECT * FROM google_ads WHERE competitor_id = ?').all(competitorId);
  const youtubeAds = db.prepare('SELECT * FROM youtube_ads WHERE competitor_id = ?').all(competitorId);
  const searchAds = db.prepare('SELECT * FROM search_ads WHERE competitor_id = ?').all(competitorId);

  const searchKeywords = [...new Set(searchAds.map(a => a.keyword))];
  const topSearchKeywords = searchKeywords.slice(0, 10);
  const googleFormats = {};
  googleAds.forEach(a => { if (a.format) googleFormats[a.format] = (googleFormats[a.format] || 0) + 1; });
  const dominantGoogleFormat = Object.entries(googleFormats).sort((a, b) => b[1] - a[1])[0];

  const totalEstimatedSpend = Math.round((metaSpendMin + metaSpendMax) / 2);
  const channelCounts = { meta: metaAds.length, google_display: googleAds.length, youtube: youtubeAds.length, search: searchAds.length };
  const primaryChannel = Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0];

  const allThemes = { ...metaThemes };
  googleAds.forEach(a => { if (a.theme_tag) allThemes[a.theme_tag] = (allThemes[a.theme_tag] || 0) + 1; });
  youtubeAds.forEach(a => { if (a.theme_tag) allThemes[a.theme_tag] = (allThemes[a.theme_tag] || 0) + 1; });
  const mostUsedHook = Object.entries(allThemes).sort((a, b) => b[1] - a[1])[0];

  const totalAds = metaAds.length + googleAds.length + youtubeAds.length + searchAds.length;
  const totalActiveAds = activeMetaAds.length + googleAds.filter(a => {
    if (!a.last_shown) return false;
    const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    return new Date(a.last_shown) >= twoWeeksAgo;
  }).length;

  const intensity = totalActiveAds > 15 ? 'very_high' :
                    totalActiveAds > 10 ? 'high' :
                    totalActiveAds > 5 ? 'medium' : 'low';

  return {
    competitor_id: competitorId,
    competitor_name: competitor.name,
    meta: {
      active_ads: activeMetaAds.length,
      total_ads: metaAds.length,
      total_spend_estimate: { min: metaSpendMin, max: metaSpendMax, avg: Math.round((metaSpendMin + metaSpendMax) / 2) },
      top_themes: topMetaThemes.slice(0, 5),
      avg_run_duration: avgMetaRunDays,
      longest_running_ad: longestMeta ? { headline: longestMeta.headline, run_days: longestMeta.run_days } : null,
      dominant_format: dominantMetaFormat ? dominantMetaFormat[0] : null,
      new_ads_this_week: newMetaAdsThisWeek
    },
    google: {
      active_display_ads: googleAds.length,
      youtube_ads: youtubeAds.length,
      search_keywords_active: searchKeywords.length,
      top_search_keywords: topSearchKeywords,
      dominant_format: dominantGoogleFormat ? dominantGoogleFormat[0] : null
    },
    unified: {
      total_estimated_spend: totalEstimatedSpend,
      primary_channel: primaryChannel ? primaryChannel[0] : null,
      most_used_hook: mostUsedHook ? mostUsedHook[0] : null,
      intensity,
      total_ads: totalAds,
      total_active_ads: totalActiveAds,
      trend: newMetaAdsThisWeek > 3 ? 'ramping_up' : newMetaAdsThisWeek > 0 ? 'steady' : 'slowing_down'
    }
  };
}

async function detectCampaignPatterns() {
  const db = getDb();

  const metaAds = db.prepare(`
    SELECT ma.*, c.name as competitor_name
    FROM meta_ads ma JOIN competitors c ON ma.competitor_id = c.id
  `).all();
  const googleAds = db.prepare(`
    SELECT ga.*, c.name as competitor_name
    FROM google_ads ga JOIN competitors c ON ga.competitor_id = c.id
  `).all();
  const youtubeAds = db.prepare(`
    SELECT ya.*, c.name as competitor_name
    FROM youtube_ads ya JOIN competitors c ON ya.competitor_id = c.id
  `).all();

  let patterns;

  try {
    const summaryData = {
      meta_ads_count: metaAds.length,
      google_ads_count: googleAds.length,
      youtube_ads_count: youtubeAds.length,
      top_meta_themes: countField(metaAds, 'theme_tag'),
      top_google_themes: countField(googleAds, 'theme_tag'),
      top_yt_themes: countField(youtubeAds, 'theme_tag'),
      competitor_activity: countField(metaAds, 'competitor_name'),
      meta_formats: countField(metaAds, 'media_type'),
      google_formats: countField(googleAds, 'format'),
      yt_formats: countField(youtubeAds, 'ad_format_guess')
    };

    const response = await openai.chat.completions.create({
      model: 'gpt-5.4',
      messages: [
        {
          role: 'system',
          content: `You are a competitive intelligence analyst for fintech advertising in India.
Analyze the provided ad data summary and detect campaign patterns.

Return a JSON object with:
- seasonal_patterns: array of { pattern, evidence, recommendation }
- theme_trends: array of { theme, direction (rising/stable/declining), competitors_using }
- format_shifts: array of { from_format, to_format, platforms, evidence }
- spending_patterns: array of { competitor, pattern, evidence }
- emerging_tactics: array of { tactic, used_by, effectiveness_signal }

Return ONLY the JSON object.`
        },
        {
          role: 'user',
          content: `Analyze this fintech ad data:\n${JSON.stringify(summaryData, null, 1)}`
        }
      ],
      temperature: 0.5,
      max_completion_tokens: 3000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    patterns = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[AdSynthesis] Pattern detection OpenAI failed, using DB analysis:', err.message);

    const themeDistribution = countField(metaAds, 'theme_tag');
    const competitorActivity = countField(metaAds, 'competitor_name');
    const formatDistribution = countField(metaAds, 'media_type');

    patterns = {
      seasonal_patterns: [
        { pattern: 'IPL season ad surge', evidence: 'Historically competitors increase ad spend 30-50% during IPL (Mar-May)', recommendation: 'Pre-load creatives and increase budgets by February' },
        { pattern: 'Tax season ELSS push', evidence: 'Jan-Mar sees spike in tax-saving investment ads', recommendation: 'Launch ELSS/tax-saving campaigns by December' }
      ],
      theme_trends: Object.entries(themeDistribution).slice(0, 5).map(([theme, count]) => ({
        theme,
        direction: count > 5 ? 'rising' : 'stable',
        competitors_using: count
      })),
      format_shifts: [
        { from_format: 'static', to_format: 'video', platforms: ['Instagram', 'YouTube'], evidence: `Video ads: ${formatDistribution.video || 0}, Static: ${formatDistribution.image || 0}` }
      ],
      spending_patterns: Object.entries(competitorActivity).slice(0, 5).map(([comp, count]) => ({
        competitor: comp,
        pattern: count > 5 ? 'aggressive_spender' : count > 2 ? 'moderate' : 'conservative',
        evidence: `${count} ads tracked`
      })),
      emerging_tactics: [
        { tactic: 'Celebrity endorsements for trust building', used_by: ['Angel One', 'Upstox'], effectiveness_signal: 'Longer running ads (60+ days)' },
        { tactic: 'Zero brokerage as primary hook', used_by: ['Groww', 'Angel One', '5paisa'], effectiveness_signal: 'Used across all platforms consistently' }
      ]
    };
  }

  return patterns;
}

function generateCompetitiveAlerts() {
  const db = getDb();
  const alerts = [];

  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const twoDaysAgoStr = twoDaysAgo.toISOString();

  const blitzCompetitors = db.prepare(`
    SELECT c.name, COUNT(*) as new_ad_count
    FROM meta_ads ma
    JOIN competitors c ON ma.competitor_id = c.id
    WHERE ma.created_at >= ?
    GROUP BY c.name
    HAVING COUNT(*) >= 5
  `).all(twoDaysAgoStr);

  for (const comp of blitzCompetitors) {
    alerts.push({
      type: 'blitz',
      severity: 'high',
      competitor: comp.name,
      message: `${comp.name} launched ${comp.new_ad_count} new Meta ads in the last 48 hours - possible campaign blitz`,
      recommendation: 'Monitor closely. Consider counter-campaign or differentiated messaging.',
      detected_at: new Date().toISOString()
    });
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const competitors = db.prepare('SELECT id, name FROM competitors').all();

  for (const comp of competitors) {
    const recentAds = db.prepare(`
      SELECT COUNT(*) as cnt FROM meta_ads
      WHERE competitor_id = ? AND created_at >= ?
    `).get(comp.id, sevenDaysAgo.toISOString());

    if (recentAds.cnt === 0) {
      const totalAds = db.prepare('SELECT COUNT(*) as cnt FROM meta_ads WHERE competitor_id = ?').get(comp.id);
      if (totalAds.cnt > 0) {
        alerts.push({
          type: 'silence',
          severity: 'medium',
          competitor: comp.name,
          message: `${comp.name} has gone silent - no new Meta ads in 7+ days`,
          recommendation: 'Could indicate budget reallocation, platform shift, or campaign pause. Monitor other channels.',
          detected_at: new Date().toISOString()
        });
      }
    }
  }

  const recentSearchAds = db.prepare(`
    SELECT sa.keyword, c.name as competitor_name
    FROM search_ads sa
    JOIN competitors c ON sa.competitor_id = c.id
    WHERE sa.created_at >= ?
  `).all(sevenDaysAgo.toISOString());

  const keywordEntrants = {};
  for (const sa of recentSearchAds) {
    const key = `${sa.competitor_name}__${sa.keyword}`;
    if (!keywordEntrants[key]) {
      const older = db.prepare(`
        SELECT COUNT(*) as cnt FROM search_ads sa
        JOIN competitors c ON sa.competitor_id = c.id
        WHERE LOWER(c.name) = LOWER(?) AND sa.keyword = ? AND sa.created_at < ?
      `).get(sa.competitor_name, sa.keyword, sevenDaysAgo.toISOString());

      if (older.cnt === 0) {
        keywordEntrants[key] = { competitor: sa.competitor_name, keyword: sa.keyword };
      }
    }
  }

  for (const entry of Object.values(keywordEntrants)) {
    alerts.push({
      type: 'new_keyword_entrant',
      severity: 'medium',
      competitor: entry.competitor,
      message: `${entry.competitor} started bidding on keyword "${entry.keyword}"`,
      recommendation: `Review your position on "${entry.keyword}". Consider increasing bid or improving ad relevance.`,
      detected_at: new Date().toISOString()
    });
  }

  const recentMetaAds = db.prepare(`
    SELECT ma.media_type, c.name as competitor_name, c.id as competitor_id
    FROM meta_ads ma
    JOIN competitors c ON ma.competitor_id = c.id
    WHERE ma.created_at >= ?
  `).all(sevenDaysAgo.toISOString());

  for (const ad of recentMetaAds) {
    const olderWithFormat = db.prepare(`
      SELECT COUNT(*) as cnt FROM meta_ads
      WHERE competitor_id = ? AND media_type = ? AND created_at < ?
    `).get(ad.competitor_id, ad.media_type, sevenDaysAgo.toISOString());

    if (olderWithFormat.cnt === 0) {
      const alreadyAlerted = alerts.some(a => a.type === 'new_format' && a.message.includes(ad.competitor_name) && a.message.includes(ad.media_type));
      if (!alreadyAlerted) {
        alerts.push({
          type: 'new_format',
          severity: 'low',
          competitor: ad.competitor_name,
          message: `${ad.competitor_name} testing new format: ${ad.media_type} on Meta`,
          recommendation: `Evaluate ${ad.media_type} format for your campaigns if not already using it.`,
          detected_at: new Date().toISOString()
        });
      }
    }
  }

  return alerts;
}

function buildUnivestGapReport() {
  const db = getDb();

  const competitorChannels = db.prepare(`
    SELECT DISTINCT i.category, i.name as inventory_name, COUNT(DISTINCT cs.competitor_id) as competitor_count
    FROM competitor_spends cs
    JOIN inventories i ON cs.inventory_id = i.id
    GROUP BY i.category, i.name
    ORDER BY competitor_count DESC
  `).all();

  const univestInventories = db.prepare(`
    SELECT i.category, i.name
    FROM existing_inventories ei
    JOIN inventories i ON ei.inventory_id = i.id
  `).all();
  const univestChannelNames = new Set(univestInventories.map(i => i.name.toLowerCase()));

  const channelGaps = competitorChannels
    .filter(ch => !univestChannelNames.has(ch.inventory_name.toLowerCase()))
    .map(ch => ({
      channel: ch.inventory_name,
      category: ch.category,
      competitors_active: ch.competitor_count,
      univest_present: false,
      priority: ch.competitor_count >= 3 ? 'high' : 'medium'
    }));

  const competitorThemes = db.prepare(`
    SELECT theme_tag, COUNT(*) as usage_count
    FROM meta_ads WHERE theme_tag IS NOT NULL
    GROUP BY theme_tag ORDER BY usage_count DESC
  `).all();

  const commonUnivestThemes = ['Feature Highlight', 'App Install', 'Education'];
  const themeGaps = competitorThemes
    .filter(t => !commonUnivestThemes.includes(t.theme_tag))
    .map(t => ({
      theme: t.theme_tag,
      competitor_usage: t.usage_count,
      univest_using: false,
      recommendation: `Consider testing "${t.theme_tag}" theme - ${t.usage_count} competitor ads use it`
    }));

  const searchKeywords = db.prepare(`
    SELECT DISTINCT keyword, COUNT(DISTINCT competitor_id) as competitor_count
    FROM search_ads GROUP BY keyword ORDER BY competitor_count DESC
  `).all();

  const keywordGaps = searchKeywords.map(kw => ({
    keyword: kw.keyword,
    competitors_bidding: kw.competitor_count,
    univest_present: false,
    priority: kw.competitor_count >= 3 ? 'high' : 'medium'
  }));

  const competitorFormats = db.prepare(`
    SELECT media_type as format, COUNT(*) as usage_count
    FROM meta_ads GROUP BY media_type ORDER BY usage_count DESC
  `).all();

  const googleFormatsData = db.prepare(`
    SELECT format, COUNT(*) as usage_count
    FROM google_ads GROUP BY format ORDER BY usage_count DESC
  `).all();

  const allFormats = {};
  competitorFormats.forEach(f => { allFormats[f.format] = (allFormats[f.format] || 0) + f.usage_count; });
  googleFormatsData.forEach(f => { allFormats[f.format] = (allFormats[f.format] || 0) + f.usage_count; });

  const formatGaps = Object.entries(allFormats)
    .sort((a, b) => b[1] - a[1])
    .map(([format, count]) => ({
      format,
      competitor_usage: count,
      recommendation: count > 10 ? 'Must-have format' : count > 5 ? 'Recommended format' : 'Optional format'
    }));

  return {
    summary: {
      total_channel_gaps: channelGaps.length,
      total_theme_gaps: themeGaps.length,
      total_keyword_gaps: keywordGaps.filter(k => !k.univest_present).length,
      total_format_gaps: formatGaps.length,
      high_priority_gaps: channelGaps.filter(g => g.priority === 'high').length +
                          keywordGaps.filter(g => g.priority === 'high').length
    },
    channel_gaps: channelGaps,
    theme_gaps: themeGaps,
    keyword_gaps: keywordGaps,
    format_gaps: formatGaps,
    top_recommendations: [
      ...channelGaps.filter(g => g.priority === 'high').slice(0, 3).map(g => `Activate on ${g.channel} (${g.competitors_active} competitors active)`),
      ...keywordGaps.filter(g => g.priority === 'high').slice(0, 3).map(g => `Bid on "${g.keyword}" (${g.competitors_bidding} competitors bidding)`),
      ...themeGaps.slice(0, 2).map(g => `Test "${g.theme}" messaging theme`)
    ]
  };
}

async function runSynthesis() {
  const db = getDb();
  const competitorsList = db.prepare('SELECT id, name FROM competitors').all();

  const profiles = [];
  for (const comp of competitorsList) {
    try {
      const profile = buildCompetitorAdProfile(comp.id);
      if (profile) profiles.push(profile);
    } catch (err) {
      console.error(`[AdSynthesis] Error building profile for ${comp.name}:`, err.message);
    }
  }

  let patterns;
  try {
    patterns = await detectCampaignPatterns();
  } catch (err) {
    console.error('[AdSynthesis] Pattern detection error:', err.message);
    patterns = { error: 'Pattern detection failed' };
  }

  let alertsList;
  try {
    alertsList = generateCompetitiveAlerts();
  } catch (err) {
    console.error('[AdSynthesis] Alert generation error:', err.message);
    alertsList = [];
  }

  let gapReport;
  try {
    gapReport = buildUnivestGapReport();
  } catch (err) {
    console.error('[AdSynthesis] Gap report error:', err.message);
    gapReport = { error: 'Gap report failed' };
  }

  return {
    synthesis_date: new Date().toISOString(),
    competitor_profiles: profiles,
    campaign_patterns: patterns,
    competitive_alerts: alertsList,
    gap_report: gapReport,
    summary: {
      competitors_analyzed: profiles.length,
      alerts_generated: alertsList.length,
      high_priority_alerts: alertsList.filter(a => a.severity === 'high').length
    }
  };
}

function countField(items, field) {
  const counts = {};
  for (const item of items) {
    const val = item[field];
    if (val) counts[val] = (counts[val] || 0) + 1;
  }
  return counts;
}

// ==================== AI INSIGHT AGENT ====================

const FALLBACK_INSIGHTS = [
  { insight_type: 'opportunity', title: 'PhonePe Ads showing strong fintech ROI', body: 'PhonePe Ads platform has 450M+ monthly users with high financial intent. Early adopters in fintech vertical are seeing CPAs 30-40% lower than Meta. Recommend allocating 10-15% of digital budget for testing.', priority: 'high', inventory_id: null },
  { insight_type: 'warning', title: 'Meta CPMs increasing 15-20% QoQ', body: 'Instagram and Facebook ad costs are trending upward, especially for BFSI category in India. Consider diversifying to YouTube Shorts and programmatic to maintain efficiency.', priority: 'high', inventory_id: null },
  { insight_type: 'trend', title: 'Short-form video dominating fintech ad performance', body: 'Across platforms, 15-30 second vertical videos are outperforming all other formats for fintech app installs. Reels, Shorts, and TikTok-style content showing 2-3x higher CTR than static ads.', priority: 'medium', inventory_id: null },
  { insight_type: 'benchmark', title: 'Industry CPA benchmark: ₹150-300 for demat account opening', body: 'Current market CPA for demat account opening via digital ads ranges from ₹150 (Google Search) to ₹300 (social media). If your CPA exceeds ₹350, review targeting and creative strategy.', priority: 'medium', inventory_id: null },
  { insight_type: 'whitespace', title: 'CRED Ads platform underutilized by competitors', body: 'Only 1-2 fintech competitors are active on CRED Ads despite the platform\'s premium user base (high credit score, affluent). First mover advantage available for investment-focused messaging.', priority: 'high', inventory_id: null },
  { insight_type: 'seasonal', title: 'Budget season (Feb) drives 40% spike in finance app installs', body: 'Historical data shows Union Budget announcement period drives massive interest in stock trading and tax-saving investments. Pre-load campaigns 2 weeks before budget date.', priority: 'medium', inventory_id: null },
  { insight_type: 'opportunity', title: 'YouTube Shorts ads at ₹10-15 CPM - best value in market', body: 'YouTube Shorts inventory is still priced 50-70% below Reels and main feed. With similar engagement rates, this represents the best CPM efficiency in current market. Scale budgets here.', priority: 'high', inventory_id: null },
  { insight_type: 'warning', title: 'Angel One ramping ad spend aggressively', body: 'Competitor Angel One has increased estimated monthly digital ad spend to ₹15-20 Cr across Google, Meta, and YouTube. Expect auction competition to increase in stock trading keywords.', priority: 'high', inventory_id: null },
  { insight_type: 'trend', title: 'Vernacular content ads showing 2x conversion in Tier 2 cities', body: 'Hindi, Tamil, and Telugu language ads are outperforming English by 2x on conversion rate in non-metro cities. Consider creating vernacular creative variants for YouTube and programmatic.', priority: 'medium', inventory_id: null },
  { insight_type: 'benchmark', title: 'App install costs varying 3x across platforms', body: 'Current app install CPI ranges: Google UAC ₹25-40, Meta ₹35-60, YouTube ₹20-35, Programmatic ₹15-30, In-App Networks ₹10-25. Portfolio approach recommended for optimal blended CPI.', priority: 'medium', inventory_id: null }
];

async function generateInsights() {
  const db = getDb();
  let insights = [];

  try {
    const inventories = db.prepare('SELECT name, category, min_cpm, max_cpm, status, target_audience_fit FROM inventories LIMIT 50').all();
    const competitorsData = db.prepare('SELECT name, estimated_monthly_adspend, primary_channels FROM competitors').all();
    const competitorSpends = db.prepare(`
      SELECT c.name as competitor, i.name as inventory, cs.estimated_monthly_spend
      FROM competitor_spends cs
      JOIN competitors c ON cs.competitor_id = c.id
      JOIN inventories i ON cs.inventory_id = i.id
      ORDER BY cs.estimated_monthly_spend DESC LIMIT 30
    `).all();

    const response = await openai.chat.completions.create({
      model: 'gpt-5.4',
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
          content: `Current inventory data:\n${JSON.stringify(inventories, null, 1)}\n\nCompetitors:\n${JSON.stringify(competitorsData, null, 1)}\n\nTop competitor spends:\n${JSON.stringify(competitorSpends, null, 1)}\n\nDate: ${new Date().toISOString().split('T')[0]}`
        }
      ],
      temperature: 0.7,
      max_completion_tokens: 4000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    insights = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[AIInsightAgent] OpenAI call failed, using fallback:', err.message);
    insights = FALLBACK_INSIGHTS;
  }

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
      model: 'gpt-5.4',
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
      max_completion_tokens: 2000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    newsInsights = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[AIInsightAgent] News sweep OpenAI call failed:', err.message);
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

// ==================== BUDGET AGENT ====================

function calculateFallbackBudget(inventory) {
  const maxCpm = inventory.max_cpm || 100;
  const minCpm = inventory.min_cpm || 20;
  const avgCpm = (minCpm + maxCpm) / 2;

  const testBudget = maxCpm * 1000;
  const starterBudget = testBudget * 10;
  const scaleBudget = starterBudget * 5;

  const avgCtr = inventory.category === 'search' ? 0.035 :
                 inventory.category === 'social' ? 0.012 :
                 inventory.category === 'video' ? 0.008 :
                 inventory.category === 'audio' ? 0.005 : 0.01;

  const avgConversionRate = 0.03;

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
    const inventory = db.prepare('SELECT name, category, min_cpm, max_cpm FROM inventories WHERE id = ?').get(inventoryId);
    return {
      ...existing,
      inventory_name: inventory ? inventory.name : 'Unknown',
      category: inventory ? inventory.category : 'Unknown',
      rationale_parsed: existing.rationale,
      data_sources_parsed: existing.data_sources
    };
  }

  return generateBudgetRecommendation(inventoryId);
}

async function generateBudgetRecommendation(inventoryId) {
  const db = getDb();
  const inventory = db.prepare('SELECT * FROM inventories WHERE id = ?').get(inventoryId);
  if (!inventory) throw new Error(`Inventory not found: ${inventoryId}`);

  let budgetData;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5.4',
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
      max_completion_tokens: 2000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    budgetData = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[BudgetAgent] OpenAI call failed, using fallback:', err.message);
    budgetData = calculateFallbackBudget(inventory);
  }

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

// ==================== COMPETITOR AGENT ====================

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
    const competitorsData = db.prepare('SELECT id, name, vertical FROM competitors').all();
    const inventories = db.prepare('SELECT id, name, category FROM inventories').all();

    const response = await openai.chat.completions.create({
      model: 'gpt-5.4',
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
          content: `Competitors:\n${competitorsData.map(c => c.name).join(', ')}\n\nInventories:\n${inventories.map(i => `${i.name} (${i.category})`).join(', ')}\n\nDate: ${new Date().toISOString().split('T')[0]}`
        }
      ],
      temperature: 0.5,
      max_completion_tokens: 4000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    updates = JSON.parse(jsonStr);
    aiModelUsed = 'gpt-5.4';
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

  const competitorSpendsData = db.prepare(`
    SELECT cs.*, c.name as competitor_name
    FROM competitor_spends cs
    JOIN competitors c ON cs.competitor_id = c.id
    WHERE cs.inventory_id = ?
  `).all(inventoryId);

  const totalCompetitorSpend = competitorSpendsData.reduce((s, c) => s + (c.estimated_monthly_spend || 0), 0);
  const competitorCount = competitorSpendsData.length;
  const avgCpm = (inventory.min_cpm + inventory.max_cpm) / 2;

  const advantages = [];
  const disadvantages = [];

  if (inventory.target_audience_fit >= 8) advantages.push('Strong audience alignment with fintech/investment users');
  else if (inventory.target_audience_fit <= 4) disadvantages.push('Weak audience alignment - may see poor conversion rates');

  if (competitorCount === 0) advantages.push('No competitor presence - first mover advantage');
  else if (competitorCount <= 2) advantages.push(`Low competition (${competitorCount} competitors) - room to capture share`);
  else if (competitorCount >= 5) disadvantages.push(`Highly competitive (${competitorCount} competitors) - CPMs may inflate`);

  if (avgCpm < 50) advantages.push(`Low cost entry (avg ₹${Math.round(avgCpm)} CPM) - good for testing`);
  else if (avgCpm > 200) disadvantages.push(`High CPM (avg ₹${Math.round(avgCpm)}) - requires significant budget`);

  if (inventory.estimated_monthly_reach > 100000000) advantages.push('Massive reach potential (100M+ monthly)');
  else if (inventory.estimated_monthly_reach < 1000000) disadvantages.push('Limited reach - may not scale');

  if (inventory.fintech_friendly) advantages.push('Platform is fintech-friendly with streamlined approval');
  else disadvantages.push('Platform has strict fintech ad policies - expect approval delays');

  if (totalCompetitorSpend > 10000000) disadvantages.push('Heavy competitor investment (₹1Cr+/month combined) - established players');

  return {
    inventory_name: inventory.name,
    inventory_id: inventoryId,
    advantages,
    disadvantages,
    competitor_count: competitorCount,
    total_competitor_spend: totalCompetitorSpend,
    overall_recommendation: advantages.length > disadvantages.length ? 'Favorable' :
                            advantages.length < disadvantages.length ? 'Cautious' : 'Neutral',
    top_competitors: competitorSpendsData.slice(0, 3).map(c => ({
      name: c.competitor_name,
      spend: c.estimated_monthly_spend
    }))
  };
}

function getAllCompetitors() {
  const db = getDb();
  return db.prepare('SELECT * FROM competitors ORDER BY name').all();
}

// ==================== DISCOVERY AGENT ====================

const FALLBACK_DISCOVERIES = [
  { name: 'PhonePe Ads', category: 'in_app', platform_parent: 'PhonePe', min_cpm: 40, max_cpm: 90, pricing_model: 'CPM', estimated_monthly_reach: 450000000, target_audience_fit: 9, fintech_friendly: 1, source_url: 'https://business.phonepe.com/ads' },
  { name: 'Swiggy Instamart Ads', category: 'in_app', platform_parent: 'Swiggy', min_cpm: 50, max_cpm: 120, pricing_model: 'CPM', estimated_monthly_reach: 50000000, target_audience_fit: 6, fintech_friendly: 1, source_url: 'https://partner.swiggy.com' },
  { name: 'Jio Cinema Premium Ads', category: 'video', platform_parent: 'Jio', min_cpm: 80, max_cpm: 200, pricing_model: 'CPM', estimated_monthly_reach: 200000000, target_audience_fit: 7, fintech_friendly: 1, source_url: 'https://ads.jiocinema.com' },
  { name: 'Flipkart Ads Network', category: 'in_app', platform_parent: 'Flipkart', min_cpm: 30, max_cpm: 80, pricing_model: 'CPC', estimated_monthly_reach: 350000000, target_audience_fit: 7, fintech_friendly: 1, source_url: 'https://ads.flipkart.com' },
  { name: 'Zomato Hyperpure Ads', category: 'in_app', platform_parent: 'Zomato', min_cpm: 45, max_cpm: 110, pricing_model: 'CPM', estimated_monthly_reach: 80000000, target_audience_fit: 5, fintech_friendly: 1, source_url: 'https://www.zomato.com/advertising' },
  { name: 'Spotify India Audio Ads', category: 'audio', platform_parent: 'Spotify', min_cpm: 100, max_cpm: 250, pricing_model: 'CPM', estimated_monthly_reach: 80000000, target_audience_fit: 6, fintech_friendly: 1, source_url: 'https://ads.spotify.com/en-IN/' },
  { name: 'Threads Ads (Meta)', category: 'social', platform_parent: 'Meta', min_cpm: 20, max_cpm: 60, pricing_model: 'CPM', estimated_monthly_reach: 30000000, target_audience_fit: 6, fintech_friendly: 1, source_url: 'https://www.facebook.com/business/ads' },
  { name: 'Paytm Ads Platform', category: 'in_app', platform_parent: 'Paytm', min_cpm: 35, max_cpm: 85, pricing_model: 'CPM', estimated_monthly_reach: 300000000, target_audience_fit: 9, fintech_friendly: 1, source_url: 'https://business.paytm.com/ads' },
  { name: 'ShareChat Ads', category: 'social', platform_parent: 'ShareChat', min_cpm: 15, max_cpm: 40, pricing_model: 'CPM', estimated_monthly_reach: 180000000, target_audience_fit: 5, fintech_friendly: 1, source_url: 'https://ads.sharechat.com' },
  { name: 'Dailyhunt / Josh Ads', category: 'social', platform_parent: 'VerSe Innovation', min_cpm: 10, max_cpm: 35, pricing_model: 'CPM', estimated_monthly_reach: 300000000, target_audience_fit: 5, fintech_friendly: 1, source_url: 'https://ads.dailyhunt.in' }
];

async function runDiscovery() {
  const db = getDb();
  let discoveries = [];
  let aiModelUsed = 'fallback';

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5.4',
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
      max_completion_tokens: 4000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    discoveries = JSON.parse(jsonStr);
    aiModelUsed = 'gpt-5.4';
  } catch (err) {
    console.error('[DiscoveryAgent] OpenAI call failed, using fallback:', err.message);
    discoveries = FALLBACK_DISCOVERIES;
    aiModelUsed = 'fallback';
  }

  let newCount = 0;
  let updatedCount = 0;

  for (const disc of discoveries) {
    const existing = db.prepare(
      `SELECT id, name FROM inventories WHERE LOWER(name) = LOWER(?) OR name LIKE ?`
    ).get(disc.name, `%${disc.name.split(' ')[0]}%${disc.name.split(' ').slice(-1)[0]}%`);

    if (existing) {
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

// ==================== EXISTING INVENTORY AGENT ====================

function getExistingInventories() {
  const db = getDb();
  return db.prepare(`
    SELECT ei.*, i.name, i.category, i.platform_parent, i.min_cpm as benchmark_min_cpm,
           i.max_cpm as benchmark_max_cpm, i.pricing_model, i.estimated_monthly_reach
    FROM existing_inventories ei
    JOIN inventories i ON ei.inventory_id = i.id
  `).all();
}

function compareWithBenchmark(inventoryId) {
  const db = getDb();
  const existing = db.prepare(`
    SELECT ei.*, i.name, i.min_cpm as benchmark_min_cpm, i.max_cpm as benchmark_max_cpm
    FROM existing_inventories ei
    JOIN inventories i ON ei.inventory_id = i.id
    WHERE ei.inventory_id = ?
  `).get(inventoryId);

  if (!existing) return null;

  const benchmarkAvg = (existing.benchmark_min_cpm + existing.benchmark_max_cpm) / 2;
  const performanceRatio = existing.current_cpm / benchmarkAvg;

  return {
    ...existing,
    benchmark_avg_cpm: benchmarkAvg,
    performance_ratio: performanceRatio,
    status: performanceRatio < 0.9 ? 'outperforming' : performanceRatio > 1.1 ? 'underperforming' : 'on_par',
    efficiency_score: Math.round((1 / performanceRatio) * 100)
  };
}

function getAllBenchmarks() {
  const db = getDb();
  const existing = db.prepare(`
    SELECT ei.*, i.name, i.category, i.min_cpm as benchmark_min_cpm, i.max_cpm as benchmark_max_cpm
    FROM existing_inventories ei
    JOIN inventories i ON ei.inventory_id = i.id
  `).all();

  return existing.map(inv => {
    const benchmarkAvg = (inv.benchmark_min_cpm + inv.benchmark_max_cpm) / 2;
    const performanceRatio = inv.current_cpm / benchmarkAvg;
    return {
      ...inv,
      benchmark_avg_cpm: benchmarkAvg,
      performance_ratio: performanceRatio,
      status: performanceRatio < 0.9 ? 'outperforming' : performanceRatio > 1.1 ? 'underperforming' : 'on_par',
      efficiency_score: Math.round((1 / performanceRatio) * 100)
    };
  });
}

// ==================== GOOGLE ADS AGENT ====================
// (Mock data and API agent for Google Ads, YouTube, and Search ads)
// Note: Full mock data constants are included for functionality

const MOCK_ADVERTISER_IDS = {
  'Groww': 'AR_GROWW_001', 'Zerodha': 'AR_ZERODHA_002', 'Angel One': 'AR_ANGELONE_003',
  'Upstox': 'AR_UPSTOX_004', '5paisa': 'AR_5PAISA_005', 'CRED': 'AR_CRED_006',
  'Paytm Money': 'AR_PAYTM_007', 'Univest': 'AR_UNIVEST_008'
};

const MOCK_SEARCH_KEYWORDS = [
  'demat account', 'stock tips', 'options trading app', 'zero brokerage',
  'best trading app india', 'SEBI registered advisor', 'stock market advisory', 'mutual fund app'
];

const MOCK_SEARCH_ADS = {
  'demat account': [
    { competitor: 'Groww', headline1: 'Open Free Demat Account', headline2: 'Start Trading in 5 Min', headline3: '₹0 Account Opening', description1: 'Join 5 Crore+ investors on Groww. Zero brokerage on equity delivery. Invest in stocks, MFs, IPOs.', description2: 'Download India\'s most loved investment app. 4.4★ rating on Play Store.', display_url: 'groww.in/demat', position: 1 },
    { competitor: 'Angel One', headline1: '₹0 Brokerage Demat Account', headline2: 'Trusted by 5Cr+ Users', headline3: 'Open in 10 Minutes', description1: 'Angel One - India\'s trusted broker since 1987. SEBI registered. Zero brokerage on delivery trades.', description2: 'Advanced tools for F&O, commodities. Smart API for algo trading. Start now!', display_url: 'angelone.in/open-account', position: 2 },
    { competitor: 'Zerodha', headline1: 'Zerodha - India\'s #1 Broker', headline2: 'Flat ₹20/Trade', headline3: 'Award Winning Platform', description1: '1.5 Crore+ customers. Kite - fastest trading platform. Open demat account with Aadhaar eKYC.', description2: 'Free Varsity courses included. Learn and earn with India\'s largest broker.', display_url: 'zerodha.com/open-account', position: 3 },
    { competitor: 'Upstox', headline1: 'Free Demat Account - Upstox', headline2: 'Backed by Ratan Tata', headline3: '₹0 on Equity Delivery', description1: 'Open demat account in 5 minutes. Zero account opening charges. Trade stocks, F&O, commodities.', description2: 'Ultra-fast execution. 100+ technical indicators. Pro charts. Download now.', display_url: 'upstox.com/open-account', position: 4 }
  ],
  'stock tips': [
    { competitor: '5paisa', headline1: 'Free Stock Tips Daily', headline2: 'Expert Research Reports', headline3: 'SEBI Registered', description1: 'Get daily stock recommendations from certified analysts. Track accuracy & performance.', description2: 'India\'s lowest brokerage. ₹0 on delivery. ₹20 flat on F&O. Open free account.', display_url: '5paisa.com/stock-tips', position: 1 },
    { competitor: 'Angel One', headline1: 'Smart Stock Tips - Angel One', headline2: 'AI-Powered Recommendations', headline3: 'ARQ Prime Advisory', description1: 'Get AI-driven stock recommendations with ARQ Prime. Personalized for your risk profile.', description2: 'Research reports, price targets, stop loss - all in one app. Download now.', display_url: 'angelone.in/research', position: 2 }
  ],
  'options trading app': [
    { competitor: 'Zerodha', headline1: 'Options Trading on Kite', headline2: 'Advanced Option Chain', headline3: 'Strategy Builder Free', description1: 'Trade options with India\'s fastest platform. Greeks, payoff charts, strategy builder included.', description2: 'Flat ₹20/order. No hidden charges. Sensibull integration for advanced strategies.', display_url: 'zerodha.com/options', position: 1 },
    { competitor: 'Angel One', headline1: 'F&O Trading - Angel One', headline2: '4x Leverage Intraday', headline3: 'SmartAPI for Algo Trading', description1: 'Trade options with maximum leverage. Advanced risk management. Real-time Greeks display.', description2: 'Build your own algo with SmartAPI. Python, Java support. Backtest strategies free.', display_url: 'angelone.in/options', position: 2 },
    { competitor: 'Upstox', headline1: 'Options Trading Made Easy', headline2: 'Pro Charts & Analytics', headline3: '₹20 Flat Per Order', description1: 'Trade options with professional tools. Option chain with all Greeks. Quick order placement.', description2: 'Open free demat account. Start trading in 5 minutes. Backed by Tiger Global.', display_url: 'upstox.com/options', position: 3 }
  ],
  'zero brokerage': [
    { competitor: 'Groww', headline1: '₹0 Brokerage Trading App', headline2: 'Zero on Equity Delivery', headline3: 'Start with ₹100', description1: 'Groww - truly zero brokerage on equity delivery. No hidden charges. Transparent pricing.', description2: 'Stocks, mutual funds, IPOs, digital gold - all in one app. 5Cr+ users.', display_url: 'groww.in/zero-brokerage', position: 1 },
    { competitor: 'Angel One', headline1: '₹0 Brokerage All Segments', headline2: 'Equity + F&O + Commodity', headline3: 'Free Forever Plan', description1: 'India\'s first truly free broker. Zero brokerage across all segments. No monthly charges.', description2: 'SEBI registered. 40+ years legacy. 5 Crore+ investors trust Angel One.', display_url: 'angelone.in/zero', position: 2 }
  ],
  'best trading app india': [
    { competitor: 'Groww', headline1: 'Best Trading App 2025', headline2: '#1 on Play Store', headline3: '4.4★ Rating', description1: 'Groww voted India\'s best trading app. Simple UI. Fast execution. All investments in one place.', description2: '₹0 brokerage on delivery. SIP from ₹100. IPO in 2 taps. Download free.', display_url: 'groww.in', position: 1 },
    { competitor: 'Zerodha', headline1: 'Zerodha Kite - #1 Platform', headline2: 'Award Winning Trading', headline3: '10M+ Users', description1: 'Kite by Zerodha - India\'s most advanced trading platform. Lightning fast. Feature rich.', description2: 'Options, futures, stocks, MFs. Varsity learning platform free. Open account today.', display_url: 'zerodha.com/kite', position: 2 },
    { competitor: 'Upstox', headline1: 'Upstox Pro Trading App', headline2: 'Ultra-Fast Execution', headline3: '100+ Indicators', description1: 'Professional trading app with advanced charting. Market depth, order book, advanced orders.', description2: 'Free demat account. ₹0 delivery brokerage. Ratan Tata backed. Download now.', display_url: 'upstox.com', position: 3 }
  ],
  'SEBI registered advisor': [
    { competitor: '5paisa', headline1: 'SEBI Registered Advisor', headline2: 'Expert Stock Picks', headline3: 'Track Record Verified', description1: '5paisa advisory - SEBI registered research analysts. Daily stock picks with target price.', description2: 'Verified track record. Risk-managed recommendations. Start following experts today.', display_url: '5paisa.com/advisory', position: 1 },
    { competitor: 'Angel One', headline1: 'SEBI Registered Broker', headline2: 'ARQ Advisory Engine', headline3: '40 Years Trust', description1: 'Angel One - SEBI, BSE, NSE registered. AI-powered ARQ advisory for personalized stock picks.', description2: 'Research reports by certified analysts. Technical + fundamental analysis. Download app.', display_url: 'angelone.in/advisory', position: 2 }
  ],
  'stock market advisory': [
    { competitor: '5paisa', headline1: 'Stock Market Advisory Free', headline2: 'Daily Expert Picks', headline3: 'SEBI Registered', description1: 'Free stock advisory with ₹0 account. Daily recommendations from expert analysts.', description2: 'Intraday + delivery picks. SMS alerts. Portfolio tracker. Open free demat.', display_url: '5paisa.com/advisory', position: 1 },
    { competitor: 'Groww', headline1: 'Stock Market Made Simple', headline2: 'Learn & Invest', headline3: 'Beginner Friendly', description1: 'New to stock market? Groww makes it easy. Curated stock collections. Expert insights.', description2: 'Start with ₹100. Zero jargon. Simple charts. India\'s most user-friendly trading app.', display_url: 'groww.in/stocks', position: 2 }
  ],
  'mutual fund app': [
    { competitor: 'Groww', headline1: '#1 Mutual Fund App India', headline2: 'Direct Plans Only', headline3: '₹0 Commission Forever', description1: 'Invest in 5000+ mutual funds on Groww. Direct plans = higher returns. SIP from ₹100/month.', description2: 'Goal-based investing. Smart recommendations. Track all MFs in one place. Download free.', display_url: 'groww.in/mutual-funds', position: 1 },
    { competitor: 'Paytm Money', headline1: 'Mutual Funds on Paytm', headline2: 'Direct Plans Zero Commission', headline3: 'SIP from ₹100', description1: 'Invest in mutual funds with Paytm Money. Zero commission. All direct plans. Track easily.', description2: 'Tax-saving ELSS, equity, debt, hybrid funds. Trusted by 10M+ investors.', display_url: 'paytmmoney.com/mf', position: 2 },
    { competitor: 'Zerodha', headline1: 'Zerodha Coin - Direct MF', headline2: '₹50/month Flat Fee', headline3: 'Save 1.5% vs Regular', description1: 'Invest in direct mutual funds via Zerodha Coin. Save 1-1.5% annually vs regular plans.', description2: 'SIP automation. Goal tracking. Complete portfolio view. Open Coin account now.', display_url: 'zerodha.com/coin', position: 3 }
  ]
};

const MOCK_YOUTUBE_ADS = {
  'Groww': [
    { title: 'Why 5 Crore Indians Choose Groww | Open Free Demat', duration_seconds: 30, view_count: 2500000, ad_format_guess: 'in-stream_skippable', theme_tag: 'Social Proof' },
    { title: 'Start SIP at ₹100 | Mutual Funds on Groww', duration_seconds: 15, view_count: 1800000, ad_format_guess: 'in-stream_non_skippable', theme_tag: 'Education' },
    { title: 'Groww IPO Guide: How to Apply for IPO in 2 Minutes', duration_seconds: 60, view_count: 800000, ad_format_guess: 'in-stream_skippable', theme_tag: 'Education' }
  ],
  'Zerodha': [
    { title: 'Varsity by Zerodha - Free Stock Market Course', duration_seconds: 30, view_count: 3000000, ad_format_guess: 'in-stream_skippable', theme_tag: 'Education' },
    { title: 'Kite Trading Platform Demo | Zerodha', duration_seconds: 45, view_count: 1200000, ad_format_guess: 'in-stream_skippable', theme_tag: 'Feature Highlight' }
  ],
  'Angel One': [
    { title: 'Dhoni & Angel One - Smart Trading Ka Smart Tarika', duration_seconds: 30, view_count: 5000000, ad_format_guess: 'in-stream_skippable', theme_tag: 'Celebrity' },
    { title: '₹0 Brokerage on ALL Segments | Angel One', duration_seconds: 15, view_count: 3200000, ad_format_guess: 'bumper', theme_tag: 'Offer/Discount' },
    { title: 'Angel One SmartAPI - Build Your Own Trading Bot', duration_seconds: 60, view_count: 600000, ad_format_guess: 'in-stream_skippable', theme_tag: 'Feature Highlight' },
    { title: 'Refer & Earn ₹1000 | Angel One Referral Program', duration_seconds: 20, view_count: 1500000, ad_format_guess: 'in-stream_non_skippable', theme_tag: 'Referral' }
  ],
  'Upstox': [
    { title: 'Kapil Dev x Upstox - Start Your Investment Journey', duration_seconds: 30, view_count: 4000000, ad_format_guess: 'in-stream_skippable', theme_tag: 'Celebrity' },
    { title: 'Upstox Pro - Professional Trading for Everyone', duration_seconds: 20, view_count: 1000000, ad_format_guess: 'in-stream_non_skippable', theme_tag: 'Feature Highlight' }
  ],
  '5paisa': [
    { title: 'Pack of 5 - Stocks, MF, IPO, Insurance, Gold | 5paisa', duration_seconds: 15, view_count: 800000, ad_format_guess: 'bumper', theme_tag: 'Feature Highlight' },
    { title: 'Zero Brokerage on Delivery | 5paisa', duration_seconds: 20, view_count: 600000, ad_format_guess: 'in-stream_non_skippable', theme_tag: 'Offer/Discount' }
  ],
  'CRED': [
    { title: 'CRED Ad - Not Everyone Gets It (Jim Sarbh)', duration_seconds: 45, view_count: 15000000, ad_format_guess: 'in-stream_skippable', theme_tag: 'Fear/FOMO' },
    { title: 'CRED Mint - Earn 9% on Savings | Download Now', duration_seconds: 15, view_count: 5000000, ad_format_guess: 'bumper', theme_tag: 'Feature Highlight' },
    { title: 'CRED Jackpot Season - Win iPhone 15 Pro', duration_seconds: 30, view_count: 8000000, ad_format_guess: 'in-stream_skippable', theme_tag: 'Offer/Discount' }
  ],
  'Paytm Money': [
    { title: 'Invest in Mutual Funds with Paytm Money', duration_seconds: 30, view_count: 1500000, ad_format_guess: 'in-stream_skippable', theme_tag: 'Education' },
    { title: 'F&O Trading at ₹10 Flat | Paytm Money', duration_seconds: 15, view_count: 700000, ad_format_guess: 'in-stream_non_skippable', theme_tag: 'Offer/Discount' }
  ]
};

const MOCK_GOOGLE_DISPLAY_ADS = {
  'Groww': [
    { format: 'display_banner', platform: 'google_display', creative_url: 'https://groww.in/ads/display1.jpg', theme_tag: 'App Install', first_shown: '2025-12-01', last_shown: '2026-03-15' },
    { format: 'responsive_display', platform: 'google_display', creative_url: 'https://groww.in/ads/responsive1.html', theme_tag: 'Free Trial', first_shown: '2026-01-10', last_shown: '2026-03-18' }
  ],
  'Angel One': [
    { format: 'display_banner', platform: 'google_display', creative_url: 'https://angelone.in/ads/display1.jpg', theme_tag: 'Offer/Discount', first_shown: '2025-11-15', last_shown: '2026-03-18' },
    { format: 'responsive_display', platform: 'google_display', creative_url: 'https://angelone.in/ads/responsive1.html', theme_tag: 'Celebrity', first_shown: '2026-01-01', last_shown: '2026-03-18' },
    { format: 'display_banner', platform: 'google_display', creative_url: 'https://angelone.in/ads/display2.jpg', theme_tag: 'Trust/SEBI', first_shown: '2026-02-01', last_shown: '2026-03-18' }
  ],
  'Zerodha': [{ format: 'display_banner', platform: 'google_display', creative_url: 'https://zerodha.com/ads/display1.jpg', theme_tag: 'Education', first_shown: '2025-10-01', last_shown: '2026-03-10' }],
  'Upstox': [
    { format: 'responsive_display', platform: 'google_display', creative_url: 'https://upstox.com/ads/responsive1.html', theme_tag: 'Celebrity', first_shown: '2026-01-15', last_shown: '2026-03-18' },
    { format: 'display_banner', platform: 'google_display', creative_url: 'https://upstox.com/ads/display1.jpg', theme_tag: 'Free Trial', first_shown: '2026-02-01', last_shown: '2026-03-18' }
  ],
  '5paisa': [{ format: 'display_banner', platform: 'google_display', creative_url: 'https://5paisa.com/ads/display1.jpg', theme_tag: 'Offer/Discount', first_shown: '2026-01-01', last_shown: '2026-03-15' }],
  'CRED': [
    { format: 'responsive_display', platform: 'google_display', creative_url: 'https://cred.club/ads/responsive1.html', theme_tag: 'Fear/FOMO', first_shown: '2025-12-01', last_shown: '2026-03-18' },
    { format: 'display_banner', platform: 'google_display', creative_url: 'https://cred.club/ads/display1.jpg', theme_tag: 'Offer/Discount', first_shown: '2026-02-15', last_shown: '2026-03-18' }
  ],
  'Paytm Money': [{ format: 'display_banner', platform: 'google_display', creative_url: 'https://paytmmoney.com/ads/display1.jpg', theme_tag: 'App Install', first_shown: '2026-01-10', last_shown: '2026-03-15' }]
};

function searchAdvertiser(name) {
  const db = getDb();
  let record = db.prepare('SELECT * FROM google_advertiser_ids WHERE LOWER(competitor_name) = LOWER(?)').get(name);

  if (!record) {
    const mockId = MOCK_ADVERTISER_IDS[name] || `AR_${name.toUpperCase().replace(/\s+/g, '_')}_${Date.now().toString().slice(-4)}`;
    const id = uuidv4();
    db.prepare(`
      INSERT INTO google_advertiser_ids (id, competitor_name, advertiser_id, verified, last_checked)
      VALUES (?, ?, ?, 0, datetime('now'))
    `).run(id, name, mockId);
    record = { id, competitor_name: name, advertiser_id: mockId, verified: 0, last_checked: new Date().toISOString() };
  }

  return record;
}

async function fetchGoogleAds(competitorName) {
  const db = getDb();
  let ads = [];

  try {
    const axios = require('axios');
    const advertiserId = searchAdvertiser(competitorName).advertiser_id;

    if (process.env.GOOGLE_ADS_TRANSPARENCY_KEY) {
      const response = await axios.get(`https://adstransparency.google.com/anji/advertiser/${advertiserId}/creative`, {
        headers: { 'Authorization': `Bearer ${process.env.GOOGLE_ADS_TRANSPARENCY_KEY}` }
      });
      if (response.data && response.data.creatives) {
        ads = response.data.creatives.map(c => ({
          google_ad_id: c.id || uuidv4(),
          format: c.format || 'display_banner',
          platform: c.platform || 'google_display',
          first_shown: c.firstShown || null,
          last_shown: c.lastShown || null,
          creative_url: c.url || null,
          theme_tag: null
        }));
      }
    } else {
      throw new Error('No GOOGLE_ADS_TRANSPARENCY_KEY configured');
    }
  } catch (err) {
    console.error(`[GoogleAdsAgent] API fetch failed for ${competitorName}, using mock:`, err.message);
    const mockDisplayAds = MOCK_GOOGLE_DISPLAY_ADS[competitorName] || [];
    ads = mockDisplayAds.map((ad, idx) => ({
      google_ad_id: `mock_gdn_${competitorName.toLowerCase().replace(/\s+/g, '_')}_${idx + 1}`,
      format: ad.format,
      platform: ad.platform,
      first_shown: ad.first_shown,
      last_shown: ad.last_shown,
      creative_url: ad.creative_url,
      theme_tag: ad.theme_tag
    }));
  }

  let competitor = db.prepare('SELECT id FROM competitors WHERE LOWER(name) = LOWER(?)').get(competitorName);
  if (!competitor) {
    const compId = uuidv4();
    db.prepare('INSERT INTO competitors (id, name, vertical, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(compId, competitorName, 'fintech');
    competitor = { id: compId };
  }

  for (const ad of ads) {
    const existing = db.prepare('SELECT id FROM google_ads WHERE google_ad_id = ?').get(ad.google_ad_id);
    if (existing) {
      db.prepare('UPDATE google_ads SET last_shown = ?, theme_tag = ? WHERE id = ?')
        .run(ad.last_shown, ad.theme_tag, existing.id);
    } else {
      db.prepare(`
        INSERT INTO google_ads (id, competitor_id, google_ad_id, format, platform, first_shown, last_shown, creative_url, theme_tag, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(uuidv4(), competitor.id, ad.google_ad_id, ad.format, ad.platform, ad.first_shown, ad.last_shown, ad.creative_url, ad.theme_tag);
    }
  }

  return { competitor: competitorName, google_ads_fetched: ads.length, ads };
}

async function fetchCompetitorYouTubeAds(competitorName) {
  const db = getDb();
  let ytAds = [];

  try {
    const axios = require('axios');
    if (process.env.YOUTUBE_API_KEY) {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: { q: `${competitorName} ad india`, type: 'video', videoCategoryId: '22', regionCode: 'IN', maxResults: 10, key: process.env.YOUTUBE_API_KEY, part: 'snippet' }
      });
      if (response.data && response.data.items) {
        ytAds = response.data.items.map(item => ({
          video_id: item.id.videoId, title: item.snippet.title, description: item.snippet.description,
          duration_seconds: 30, view_count: 0, publish_date: item.snippet.publishedAt ? item.snippet.publishedAt.split('T')[0] : null,
          ad_format_guess: 'in-stream_skippable', theme_tag: null
        }));
      }
    } else {
      throw new Error('No YOUTUBE_API_KEY configured');
    }
  } catch (err) {
    console.error(`[GoogleAdsAgent] YouTube API failed for ${competitorName}, using mock:`, err.message);
    const mockYt = MOCK_YOUTUBE_ADS[competitorName] || [];
    const baseDate = new Date();
    baseDate.setDate(baseDate.getDate() - 60);

    ytAds = mockYt.map((ad, idx) => {
      const publishDate = new Date(baseDate);
      publishDate.setDate(publishDate.getDate() + idx * 10);
      return {
        video_id: `mock_yt_${competitorName.toLowerCase().replace(/\s+/g, '_')}_${idx + 1}`,
        title: ad.title, description: `${competitorName} promotional video advertisement for Indian market.`,
        duration_seconds: ad.duration_seconds, view_count: ad.view_count,
        publish_date: publishDate.toISOString().split('T')[0],
        ad_format_guess: ad.ad_format_guess, theme_tag: ad.theme_tag
      };
    });
  }

  let competitor = db.prepare('SELECT id FROM competitors WHERE LOWER(name) = LOWER(?)').get(competitorName);
  if (!competitor) {
    const compId = uuidv4();
    db.prepare('INSERT INTO competitors (id, name, vertical, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(compId, competitorName, 'fintech');
    competitor = { id: compId };
  }

  for (const ad of ytAds) {
    const existing = db.prepare('SELECT id FROM youtube_ads WHERE video_id = ?').get(ad.video_id);
    if (existing) {
      db.prepare('UPDATE youtube_ads SET view_count = ?, theme_tag = ? WHERE id = ?').run(ad.view_count, ad.theme_tag, existing.id);
    } else {
      db.prepare(`
        INSERT INTO youtube_ads (id, competitor_id, video_id, title, description, duration_seconds,
          view_count, publish_date, ad_format_guess, theme_tag, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(uuidv4(), competitor.id, ad.video_id, ad.title, ad.description, ad.duration_seconds,
        ad.view_count, ad.publish_date, ad.ad_format_guess, ad.theme_tag);
    }
  }

  return { competitor: competitorName, youtube_ads_fetched: ytAds.length, ads: ytAds };
}

async function fetchSearchAds(keyword) {
  const db = getDb();
  let searchResults = [];

  try {
    const axios = require('axios');
    if (process.env.SERPAPI_KEY) {
      const response = await axios.get('https://serpapi.com/search', {
        params: { q: keyword, location: 'India', google_domain: 'google.co.in', gl: 'in', hl: 'en', api_key: process.env.SERPAPI_KEY }
      });
      if (response.data && response.data.ads) {
        searchResults = response.data.ads.map(ad => ({
          competitor: ad.advertiser || 'Unknown', headline1: ad.title || '', headline2: '', headline3: '',
          description1: ad.description || '', description2: '', display_url: ad.displayed_link || '', position: ad.position || 0
        }));
      }
    } else {
      throw new Error('No SERPAPI_KEY configured');
    }
  } catch (err) {
    console.error(`[GoogleAdsAgent] SerpAPI failed for "${keyword}", using mock:`, err.message);
    searchResults = MOCK_SEARCH_ADS[keyword] || [];
  }

  for (const ad of searchResults) {
    let competitor = db.prepare('SELECT id FROM competitors WHERE LOWER(name) = LOWER(?)').get(ad.competitor);
    if (!competitor) {
      const compId = uuidv4();
      db.prepare('INSERT INTO competitors (id, name, vertical, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(compId, ad.competitor, 'fintech');
      competitor = { id: compId };
    }

    db.prepare(`
      INSERT INTO search_ads (id, competitor_id, keyword, headline1, headline2, headline3,
        description1, description2, display_url, position, captured_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(uuidv4(), competitor.id, keyword, ad.headline1, ad.headline2 || '', ad.headline3 || '',
      ad.description1, ad.description2 || '', ad.display_url, ad.position);
  }

  return { keyword, results_count: searchResults.length, results: searchResults };
}

async function refreshAllGoogleCompetitors() {
  const db = getDb();
  const competitorsList = db.prepare('SELECT name FROM competitors').all();
  const results = { google_display: [], youtube: [], search: [] };

  for (const comp of competitorsList) {
    try { const gResult = await fetchGoogleAds(comp.name); results.google_display.push(gResult); } catch (err) { console.error(`[GoogleAdsAgent] Display error for ${comp.name}:`, err.message); }
    try { const yResult = await fetchCompetitorYouTubeAds(comp.name); results.youtube.push(yResult); } catch (err) { console.error(`[GoogleAdsAgent] YouTube error for ${comp.name}:`, err.message); }
  }

  for (const keyword of MOCK_SEARCH_KEYWORDS) {
    try { const sResult = await fetchSearchAds(keyword); results.search.push(sResult); } catch (err) { console.error(`[GoogleAdsAgent] Search error for "${keyword}":`, err.message); }
  }

  return { competitors_processed: competitorsList.length, keywords_searched: MOCK_SEARCH_KEYWORDS.length, results };
}

function getKeywordGaps() {
  const db = getDb();

  const competitorKeywords = db.prepare(`
    SELECT DISTINCT sa.keyword, c.name as competitor_name, sa.position
    FROM search_ads sa
    JOIN competitors c ON sa.competitor_id = c.id
    ORDER BY sa.keyword, sa.position
  `).all();

  const keywordMap = {};
  for (const row of competitorKeywords) {
    if (!keywordMap[row.keyword]) keywordMap[row.keyword] = { keyword: row.keyword, competitors: [], positions: {} };
    if (!keywordMap[row.keyword].competitors.includes(row.competitor_name)) keywordMap[row.keyword].competitors.push(row.competitor_name);
    keywordMap[row.keyword].positions[row.competitor_name] = row.position;
  }

  const gaps = [];
  for (const [keyword, data] of Object.entries(keywordMap)) {
    const univestPresent = data.competitors.some(c => c.toLowerCase().includes('univest'));
    gaps.push({
      keyword: data.keyword, competitor_count: data.competitors.length, competitors: data.competitors,
      positions: data.positions, univest_present: univestPresent,
      gap_type: univestPresent ? 'active' : 'gap',
      priority: !univestPresent && data.competitor_count >= 3 ? 'high' : !univestPresent && data.competitor_count >= 2 ? 'medium' : 'low',
      recommendation: univestPresent ? 'Already active - optimize position' : `${data.competitor_count} competitors active. Consider bidding on this keyword.`
    });
  }

  gaps.sort((a, b) => {
    if (a.gap_type !== b.gap_type) return a.gap_type === 'gap' ? -1 : 1;
    return b.competitor_count - a.competitor_count;
  });

  return gaps;
}

// ==================== META AD LIBRARY AGENT ====================

const MOCK_ADS_BY_COMPETITOR = {
  'Groww': [
    { headline: 'Open FREE Demat Account in 5 Minutes', body: 'Join 5 Crore+ Indians who invest with Groww. Zero account opening charges. Start with just ₹100.', platform_list: 'instagram,facebook', media_type: 'video', spend_min: 50000, spend_max: 200000, run_days: 45, theme_tag: 'Free Trial', is_active: 1 },
    { headline: 'Mutual Funds Sahi Hai - Start SIP at ₹100', body: 'Invest in top-rated mutual funds. No commission. Direct plans only. Grow your wealth systematically.', platform_list: 'instagram,facebook', media_type: 'carousel', spend_min: 30000, spend_max: 150000, run_days: 60, theme_tag: 'Education', is_active: 1 },
    { headline: 'Groww Stocks: ₹0 Brokerage on Equity Delivery', body: 'Trade stocks with zero brokerage on delivery. Advanced charts. Real-time market data. Join now!', platform_list: 'facebook', media_type: 'video', spend_min: 80000, spend_max: 300000, run_days: 30, theme_tag: 'Offer/Discount', is_active: 1 },
    { headline: 'IPO Alert: Apply for Latest IPOs on Groww', body: 'Never miss an IPO again. Get allotment alerts. Track IPO performance. Apply in 2 taps.', platform_list: 'instagram', media_type: 'image', spend_min: 20000, spend_max: 80000, run_days: 14, theme_tag: 'Fear/FOMO', is_active: 1 },
    { headline: '10 Lakh+ Reviews on Play Store ⭐4.4', body: 'India\'s most loved investment app. Stocks, MF, IPOs, F&O - all in one place. Download now.', platform_list: 'instagram,facebook,messenger', media_type: 'video', spend_min: 100000, spend_max: 400000, run_days: 90, theme_tag: 'Social Proof', is_active: 1 },
    { headline: 'Gold at ₹1 - Start Digital Gold Investment', body: 'Buy 24K digital gold starting at ₹1. Store safely. Sell anytime. No making charges.', platform_list: 'instagram', media_type: 'image', spend_min: 15000, spend_max: 60000, run_days: 21, theme_tag: 'Feature Highlight', is_active: 0 }
  ],
  'Zerodha': [
    { headline: 'Zerodha - India\'s Largest Stock Broker', body: '1.5 Crore+ customers trust Zerodha. Flat ₹20 per trade. Award-winning platforms Kite & Console.', platform_list: 'facebook', media_type: 'image', spend_min: 20000, spend_max: 100000, run_days: 120, theme_tag: 'Social Proof', is_active: 1 },
    { headline: 'Learn Trading with Varsity by Zerodha', body: 'Free certified courses on stock markets, trading strategies, and personal finance. 10M+ learners.', platform_list: 'instagram,facebook', media_type: 'carousel', spend_min: 10000, spend_max: 50000, run_days: 90, theme_tag: 'Education', is_active: 1 },
    { headline: 'Zerodha Coin: Direct Mutual Funds, Zero Commission', body: 'Invest in direct mutual funds with zero commission. Save 1-1.5% annually. ₹50/month flat fee.', platform_list: 'facebook', media_type: 'image', spend_min: 15000, spend_max: 60000, run_days: 60, theme_tag: 'Comparison', is_active: 1 },
    { headline: 'Options Trading Made Simple on Kite', body: 'Trade options with advanced tools. Option chain, Greeks, strategy builder. India\'s fastest trading platform.', platform_list: 'instagram', media_type: 'video', spend_min: 25000, spend_max: 120000, run_days: 45, theme_tag: 'Feature Highlight', is_active: 1 },
    { headline: 'Open Demat Account - Flat ₹200 One-Time', body: 'No annual maintenance charges for first year. Flat ₹20 per F&O trade. SEBI registered broker.', platform_list: 'facebook', media_type: 'image', spend_min: 30000, spend_max: 90000, run_days: 30, theme_tag: 'Trust/SEBI', is_active: 1 }
  ],
  'Angel One': [
    { headline: '₹0 Brokerage on Equity, F&O, Commodity', body: 'Trade across all segments with ZERO brokerage. India\'s first truly free trading platform. Join 5Cr+ users.', platform_list: 'instagram,facebook,messenger', media_type: 'video', spend_min: 200000, spend_max: 800000, run_days: 60, theme_tag: 'Offer/Discount', is_active: 1 },
    { headline: 'Get 4x Leverage on F&O with Angel One', body: 'Maximum leverage for intraday trading. Advanced risk management tools. Trade with confidence.', platform_list: 'instagram', media_type: 'video', spend_min: 100000, spend_max: 400000, run_days: 30, theme_tag: 'Feature Highlight', is_active: 1 },
    { headline: 'SmartAPI - Algo Trading for Everyone', body: 'Build your own trading bot with SmartAPI. Free API access. Python, Java, Node.js support. Backtest strategies.', platform_list: 'facebook', media_type: 'carousel', spend_min: 30000, spend_max: 120000, run_days: 45, theme_tag: 'Feature Highlight', is_active: 1 },
    { headline: 'Dhoni Recommends Angel One for Smart Trading', body: 'MS Dhoni trusts Angel One. Join India\'s fastest growing broker. Open account in 10 minutes.', platform_list: 'instagram,facebook', media_type: 'video', spend_min: 300000, spend_max: 1000000, run_days: 90, theme_tag: 'Celebrity', is_active: 1 },
    { headline: 'Refer & Earn ₹1000 per Referral', body: 'Share Angel One with friends. Earn ₹1000 for every successful referral. No limit on earnings!', platform_list: 'instagram', media_type: 'image', spend_min: 80000, spend_max: 300000, run_days: 30, theme_tag: 'Referral', is_active: 1 },
    { headline: 'IPL Season Special: Open Account & Get Free Trades', body: 'Limited time IPL offer. Open demat account and get 30 days of free trading. T&C apply.', platform_list: 'instagram,facebook', media_type: 'video', spend_min: 150000, spend_max: 500000, run_days: 21, theme_tag: 'Offer/Discount', is_active: 0 },
    { headline: 'SEBI Registered. 40+ Years Legacy.', body: 'Angel One (formerly Angel Broking). 40+ years in Indian stock markets. Trusted by 5 Crore investors.', platform_list: 'facebook', media_type: 'image', spend_min: 20000, spend_max: 80000, run_days: 120, theme_tag: 'Trust/SEBI', is_active: 1 }
  ],
  'Upstox': [
    { headline: 'Open FREE Demat Account - Upstox', body: 'Zero account opening charges. ₹0 brokerage on delivery. Backed by Ratan Tata & Tiger Global.', platform_list: 'instagram,facebook', media_type: 'video', spend_min: 60000, spend_max: 250000, run_days: 45, theme_tag: 'Free Trial', is_active: 1 },
    { headline: 'Trade at Lightning Speed with Upstox Pro', body: 'Ultra-fast order execution. Advanced charts with 100+ indicators. Trade stocks, F&O, commodities, currencies.', platform_list: 'instagram', media_type: 'video', spend_min: 40000, spend_max: 180000, run_days: 30, theme_tag: 'Feature Highlight', is_active: 1 },
    { headline: 'Kapil Dev says: Start Investing with Upstox', body: 'Like Kapil Dev hits sixes, hit financial goals with Upstox. Open account in under 5 minutes.', platform_list: 'facebook', media_type: 'video', spend_min: 100000, spend_max: 450000, run_days: 60, theme_tag: 'Celebrity', is_active: 1 },
    { headline: '1 Crore+ Indians Trust Upstox', body: 'Join the fastest growing stock trading platform. MFs, IPOs, Stocks - everything in one app.', platform_list: 'instagram,facebook', media_type: 'carousel', spend_min: 50000, spend_max: 200000, run_days: 30, theme_tag: 'Social Proof', is_active: 1 },
    { headline: 'F&O Trading at ₹20 Flat Per Order', body: 'Best-in-class F&O trading. Option chain, strategy builder, margin calculator. All at flat ₹20.', platform_list: 'instagram', media_type: 'image', spend_min: 30000, spend_max: 100000, run_days: 21, theme_tag: 'Offer/Discount', is_active: 1 }
  ],
  '5paisa': [
    { headline: 'Lowest Brokerage in India - ₹0 on Delivery', body: 'Trade stocks at India\'s lowest charges. ₹0 delivery brokerage. ₹20 flat on intraday & F&O.', platform_list: 'facebook', media_type: 'image', spend_min: 20000, spend_max: 80000, run_days: 60, theme_tag: 'Offer/Discount', is_active: 1 },
    { headline: 'Auto-Invest in Mutual Funds with 5paisa', body: 'Set up SIP in 2 minutes. 5000+ mutual funds. Direct plans. Zero commission forever.', platform_list: 'instagram', media_type: 'carousel', spend_min: 15000, spend_max: 50000, run_days: 30, theme_tag: 'Feature Highlight', is_active: 1 },
    { headline: 'Open Demat Account in Under 5 Minutes', body: 'Paperless account opening. Aadhaar-based eKYC. Start trading today. SEBI & BSE registered.', platform_list: 'facebook', media_type: 'video', spend_min: 25000, spend_max: 100000, run_days: 45, theme_tag: 'App Install', is_active: 1 },
    { headline: 'Pack of 5: Stocks, MF, IPO, Insurance, Gold', body: '5 investment options in one app. ₹0 to start. Build your complete financial portfolio.', platform_list: 'instagram,facebook', media_type: 'carousel', spend_min: 10000, spend_max: 40000, run_days: 30, theme_tag: 'Feature Highlight', is_active: 1 },
    { headline: 'Expert Stock Tips FREE on 5paisa', body: 'Get daily stock recommendations from market experts. Track accuracy. Make informed decisions.', platform_list: 'instagram', media_type: 'image', spend_min: 15000, spend_max: 60000, run_days: 14, theme_tag: 'Education', is_active: 1 }
  ],
  'CRED': [
    { headline: 'CRED: Pay Credit Card Bills & Win Rewards', body: 'Pay your credit card bills on CRED. Earn CRED coins. Unlock exclusive rewards & cashbacks.', platform_list: 'instagram,facebook', media_type: 'video', spend_min: 500000, spend_max: 2000000, run_days: 90, theme_tag: 'Offer/Discount', is_active: 1 },
    { headline: 'CRED Mint: Earn 9% on Your Savings', body: 'Park your money in CRED Mint. Earn up to 9% returns. Withdraw anytime. No lock-in period.', platform_list: 'instagram', media_type: 'video', spend_min: 200000, spend_max: 800000, run_days: 60, theme_tag: 'Feature Highlight', is_active: 1 },
    { headline: 'Only for High Credit Score Members', body: 'CRED is built for people with 750+ credit score. Join the exclusive club. Unlock premium benefits.', platform_list: 'instagram,facebook', media_type: 'video', spend_min: 300000, spend_max: 1200000, run_days: 45, theme_tag: 'Fear/FOMO', is_active: 1 },
    { headline: 'Jackpot Season on CRED - Win iPhone, MacBook', body: 'Pay bills. Spin the wheel. Win incredible rewards. iPhone 15, MacBook Pro, PS5 up for grabs!', platform_list: 'instagram,facebook,messenger', media_type: 'video', spend_min: 400000, spend_max: 1500000, run_days: 30, theme_tag: 'Offer/Discount', is_active: 1 },
    { headline: 'CRED UPI: Scan & Pay with Rewards', body: 'Now pay using UPI on CRED. Earn cashback on every transaction. Making payments rewarding.', platform_list: 'instagram', media_type: 'video', spend_min: 150000, spend_max: 600000, run_days: 30, theme_tag: 'Feature Highlight', is_active: 1 }
  ],
  'Paytm Money': [
    { headline: 'Paytm Money: Invest in Stocks & MF', body: 'Start your investment journey with Paytm Money. Zero brokerage on delivery. Trusted by 10M+ investors.', platform_list: 'facebook', media_type: 'image', spend_min: 30000, spend_max: 120000, run_days: 60, theme_tag: 'App Install', is_active: 1 },
    { headline: 'SIP Starting at ₹100/month', body: 'Build wealth systematically. Choose from 5000+ mutual funds. Track your portfolio in real-time.', platform_list: 'instagram', media_type: 'carousel', spend_min: 20000, spend_max: 80000, run_days: 45, theme_tag: 'Education', is_active: 1 },
    { headline: 'Tax-Saving Mutual Funds on Paytm Money', body: 'Save up to ₹46,800 in taxes. Invest in ELSS funds. Lock-in period of just 3 years.', platform_list: 'facebook', media_type: 'image', spend_min: 40000, spend_max: 150000, run_days: 30, theme_tag: 'Feature Highlight', is_active: 0 },
    { headline: 'Trade F&O at ₹10 Flat', body: 'Lowest F&O brokerage in India. Flat ₹10 per order. Advanced options analytics built-in.', platform_list: 'instagram,facebook', media_type: 'video', spend_min: 25000, spend_max: 90000, run_days: 30, theme_tag: 'Offer/Discount', is_active: 1 },
    { headline: 'Paytm Money - SEBI Registered Broker', body: 'Fully compliant. SEBI registered. Your investments are safe. Backed by Paytm ecosystem.', platform_list: 'facebook', media_type: 'image', spend_min: 10000, spend_max: 40000, run_days: 90, theme_tag: 'Trust/SEBI', is_active: 1 }
  ]
};

const THEME_KEYWORDS = {
  'Offer/Discount': ['free', '₹0', 'zero', 'discount', 'offer', 'cashback', 'flat', 'lowest', 'save', 'reward'],
  'Social Proof': ['crore', 'million', 'lakh', 'users', 'trust', 'rating', 'review', 'loved', 'popular', 'join'],
  'Fear/FOMO': ['miss', 'alert', 'limited', 'hurry', 'last chance', 'ending', 'exclusive', 'only', 'before'],
  'Education': ['learn', 'course', 'guide', 'how', 'what', 'tips', 'knowledge', 'varsity', 'tutorial'],
  'Feature Highlight': ['advanced', 'fast', 'powerful', 'tool', 'chart', 'platform', 'feature', 'analytics', 'builder'],
  'Celebrity': ['dhoni', 'kapil', 'virat', 'sachin', 'celebrity', 'brand ambassador', 'recommends', 'endorses'],
  'Comparison': ['better', 'vs', 'compare', 'switch', 'unlike', 'direct', 'commission free'],
  'Free Trial': ['free', 'trial', 'no charges', 'open free', 'start free', 'try'],
  'Testimonial': ['honest review', 'experience', 'my journey', 'real story', 'customer', 'feedback'],
  'Trust/SEBI': ['sebi', 'registered', 'regulated', 'safe', 'secure', 'compliant', 'legacy', 'years'],
  'App Install': ['download', 'install', 'app', 'play store', 'app store', 'get app'],
  'Referral': ['refer', 'earn', 'share', 'invite', 'referral', 'friend']
};

async function fetchMetaAds(competitorName, limit = 10) {
  const db = getDb();
  let ads = [];

  try {
    const axios = require('axios');
    const accessToken = process.env.META_AD_LIBRARY_TOKEN;
    if (!accessToken) throw new Error('No META_AD_LIBRARY_TOKEN configured');

    const response = await axios.get('https://graph.facebook.com/v18.0/ads_archive', {
      params: {
        search_terms: competitorName, ad_reached_countries: 'IN', ad_type: 'FINANCIAL_PRODUCTS_AND_SERVICES',
        fields: 'id,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,publisher_platforms,media_type,spend',
        limit: limit, access_token: accessToken
      }
    });

    if (response.data && response.data.data) {
      ads = response.data.data.map(ad => ({
        meta_ad_id: ad.id, headline: (ad.ad_creative_link_titles || []).join(' | ') || '',
        body: (ad.ad_creative_bodies || []).join(' ') || '', platform_list: (ad.publisher_platforms || []).join(','),
        media_type: ad.media_type || 'image', spend_min: ad.spend ? ad.spend.lower_bound : 0,
        spend_max: ad.spend ? ad.spend.upper_bound : 0, start_date: ad.ad_delivery_start_time || null,
        end_date: ad.ad_delivery_stop_time || null, is_active: ad.ad_delivery_stop_time ? 0 : 1,
        run_days: ad.ad_delivery_start_time ? Math.floor((Date.now() - new Date(ad.ad_delivery_start_time).getTime()) / 86400000) : 0,
        theme_tag: null
      }));
    }
  } catch (err) {
    console.error(`[MetaAdLibrary] API fetch failed for ${competitorName}, using mock data:`, err.message);
    const mockAds = MOCK_ADS_BY_COMPETITOR[competitorName] || MOCK_ADS_BY_COMPETITOR['Groww'];
    const startBase = new Date();
    startBase.setDate(startBase.getDate() - 90);

    ads = mockAds.slice(0, limit).map((ad, idx) => {
      const startDate = new Date(startBase);
      startDate.setDate(startDate.getDate() + idx * 5);
      const endDate = ad.is_active ? null : new Date(startDate.getTime() + ad.run_days * 86400000);

      return {
        meta_ad_id: `mock_${competitorName.toLowerCase().replace(/\s+/g, '_')}_${idx + 1}`,
        headline: ad.headline, body: ad.body, platform_list: ad.platform_list, media_type: ad.media_type,
        spend_min: ad.spend_min, spend_max: ad.spend_max,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate ? endDate.toISOString().split('T')[0] : null,
        is_active: ad.is_active, run_days: ad.run_days, theme_tag: ad.theme_tag
      };
    });
  }

  let competitor = db.prepare('SELECT id FROM competitors WHERE LOWER(name) = LOWER(?)').get(competitorName);
  if (!competitor) {
    const compId = uuidv4();
    db.prepare('INSERT INTO competitors (id, name, vertical, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(compId, competitorName, 'fintech');
    competitor = { id: compId };
  }

  for (const ad of ads) {
    if (!ad.theme_tag) ad.theme_tag = await classifyAdTheme(`${ad.headline} ${ad.body}`);

    const existing = db.prepare('SELECT id FROM meta_ads WHERE meta_ad_id = ?').get(ad.meta_ad_id);
    if (existing) {
      db.prepare(`
        UPDATE meta_ads SET is_active = ?, spend_min = ?, spend_max = ?, run_days = ?,
          end_date = ?, theme_tag = ? WHERE id = ?
      `).run(ad.is_active, ad.spend_min, ad.spend_max, ad.run_days, ad.end_date, ad.theme_tag, existing.id);
    } else {
      db.prepare(`
        INSERT INTO meta_ads (id, competitor_id, meta_ad_id, headline, body, platform_list, media_type,
          spend_min, spend_max, impressions_min, impressions_max, start_date, end_date, is_active,
          run_days, theme_tag, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        uuidv4(), competitor.id, ad.meta_ad_id, ad.headline, ad.body, ad.platform_list,
        ad.media_type, ad.spend_min, ad.spend_max, ad.start_date, ad.end_date,
        ad.is_active, ad.run_days, ad.theme_tag
      );
    }
  }

  return { competitor: competitorName, ads_fetched: ads.length, ads };
}

async function classifyAdTheme(adText) {
  if (!adText) return 'Feature Highlight';

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5.4',
      messages: [
        { role: 'system', content: `Classify the following ad text into exactly ONE theme from this list:\nOffer/Discount, Social Proof, Fear/FOMO, Education, Feature Highlight, Celebrity, Comparison, Free Trial, Testimonial, Trust/SEBI, App Install, Referral\n\nReturn ONLY the theme name, nothing else.` },
        { role: 'user', content: adText }
      ],
      temperature: 0, max_completion_tokens: 20
    });

    const theme = response.choices[0].message.content.trim();
    const validThemes = Object.keys(THEME_KEYWORDS);
    if (validThemes.includes(theme)) return theme;
    return 'Feature Highlight';
  } catch (err) {
    const textLower = adText.toLowerCase();
    let bestTheme = 'Feature Highlight';
    let bestScore = 0;

    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      const score = keywords.filter(kw => textLower.includes(kw)).length;
      if (score > bestScore) { bestScore = score; bestTheme = theme; }
    }

    return bestTheme;
  }
}

function detectLongRunningAds() {
  const db = getDb();
  return db.prepare(`
    SELECT ma.*, c.name as competitor_name
    FROM meta_ads ma
    JOIN competitors c ON ma.competitor_id = c.id
    WHERE ma.run_days >= 30
    ORDER BY ma.run_days DESC
  `).all();
}

function extractSpendSignals() {
  const db = getDb();
  const signals = db.prepare(`
    SELECT c.name as competitor_name,
           COUNT(*) as total_ads,
           SUM(CASE WHEN ma.is_active = 1 THEN 1 ELSE 0 END) as active_ads,
           ROUND(SUM(ma.spend_min), 0) as total_spend_min,
           ROUND(SUM(ma.spend_max), 0) as total_spend_max,
           ROUND(AVG(ma.spend_min), 0) as avg_spend_min,
           ROUND(AVG(ma.spend_max), 0) as avg_spend_max,
           ROUND(AVG(ma.run_days), 1) as avg_run_days
    FROM meta_ads ma
    JOIN competitors c ON ma.competitor_id = c.id
    GROUP BY c.name
    ORDER BY total_spend_max DESC
  `).all();

  return signals.map(s => ({
    ...s,
    estimated_monthly_meta_spend: Math.round((s.total_spend_min + s.total_spend_max) / 2),
    intensity: s.active_ads > 5 ? 'high' : s.active_ads > 2 ? 'medium' : 'low'
  }));
}

async function refreshAllMetaCompetitors() {
  const db = getDb();
  const competitorsList = db.prepare('SELECT name FROM competitors').all();
  const results = [];

  for (const comp of competitorsList) {
    try {
      const result = await fetchMetaAds(comp.name, 10);
      results.push(result);
    } catch (err) {
      console.error(`[MetaAdLibrary] Error refreshing ${comp.name}:`, err.message);
      results.push({ competitor: comp.name, ads_fetched: 0, error: err.message });
    }
  }

  return { competitors_processed: results.length, results };
}

function getAdsByCompetitor(competitorName) {
  const db = getDb();
  return db.prepare(`
    SELECT ma.*, c.name as competitor_name
    FROM meta_ads ma
    JOIN competitors c ON ma.competitor_id = c.id
    WHERE LOWER(c.name) = LOWER(?)
    ORDER BY ma.created_at DESC
  `).all(competitorName);
}

function getTrends() {
  const db = getDb();
  const themeCounts = db.prepare(`
    SELECT theme_tag, COUNT(*) as count,
           SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count,
           ROUND(AVG(run_days), 1) as avg_run_days,
           ROUND(AVG(spend_max), 0) as avg_max_spend
    FROM meta_ads WHERE theme_tag IS NOT NULL GROUP BY theme_tag ORDER BY count DESC
  `).all();

  const platformCounts = db.prepare('SELECT platform_list, COUNT(*) as count FROM meta_ads GROUP BY platform_list ORDER BY count DESC').all();
  const mediaTypeCounts = db.prepare('SELECT media_type, COUNT(*) as count, ROUND(AVG(run_days), 1) as avg_run_days FROM meta_ads GROUP BY media_type ORDER BY count DESC').all();

  return {
    theme_distribution: themeCounts, platform_distribution: platformCounts, media_type_distribution: mediaTypeCounts,
    top_theme: themeCounts.length > 0 ? themeCounts[0].theme_tag : null,
    top_platform: platformCounts.length > 0 ? platformCounts[0].platform_list : null,
    dominant_media: mediaTypeCounts.length > 0 ? mediaTypeCounts[0].media_type : null
  };
}

function getSpendSignals() { return extractSpendSignals(); }

// ==================== ONBOARDING AGENT ====================

const FALLBACK_GUIDE_STEPS = [
  { step_number: 1, step_title: 'Research & Requirements', step_description: 'Review the platform\'s advertiser policies, especially for fintech/BFSI category. Check SEBI compliance requirements. Gather documentation: SEBI registration certificate, company PAN, GST certificate, RBI compliance docs if applicable.', estimated_time: '1-2 days', contact_name: 'Platform Sales Team', contact_email: 'sales@platform.com', contact_phone: null, contact_url: null, minimum_commitment: 'Varies by platform', documents_required: 'SEBI registration, Company PAN, GST certificate, Business registration, Brand guidelines' },
  { step_number: 2, step_title: 'Account Setup & Verification', step_description: 'Create an advertiser account on the platform. Complete business verification process. Submit required documentation for fintech category approval. Set up billing with company credit card or bank transfer.', estimated_time: '2-5 days', contact_name: 'Account Manager', contact_email: null, contact_phone: null, contact_url: null, minimum_commitment: null, documents_required: 'Business email, Company website URL, Authorized signatory details' },
  { step_number: 3, step_title: 'Documentation & Compliance Review', step_description: 'Submit all regulatory documents for platform review. This includes SEBI advisory registration, mutual fund distributor license (if applicable), AMFI registration, and disclaimers.', estimated_time: '3-7 days', contact_name: 'Compliance Team', contact_email: null, contact_phone: null, contact_url: null, minimum_commitment: null, documents_required: 'SEBI advisory registration, AMFI registration, Disclaimer templates, Legal approval on ad copy' },
  { step_number: 4, step_title: 'Creative Preparation', step_description: 'Design ad creatives according to platform specifications. Prepare multiple variants for A/B testing. Ensure all creatives include mandatory disclaimers.', estimated_time: '3-5 days', contact_name: 'Creative Team', contact_email: null, contact_phone: null, contact_url: null, minimum_commitment: null, documents_required: 'Brand assets, Logo files, Product screenshots, Disclaimer text, Landing page URLs' },
  { step_number: 5, step_title: 'Campaign Setup & Configuration', step_description: 'Create campaign structure: Campaign > Ad Set > Ad. Configure targeting: demographics (25-45 age, Tier 1+2 cities), interests (stocks, mutual funds, personal finance, trading).', estimated_time: '1-2 days', contact_name: 'Media Buyer', contact_email: null, contact_phone: null, contact_url: null, minimum_commitment: 'Minimum daily budget per platform requirements', documents_required: 'Targeting brief, Budget allocation, KPI targets, Conversion event mapping' },
  { step_number: 6, step_title: 'Launch & Initial Monitoring', step_description: 'Submit ads for review (allow 24-48h for fintech category). Once approved, launch campaign in learning phase. Monitor closely for first 72 hours.', estimated_time: '1-3 days (+ 7 days learning)', contact_name: 'Campaign Manager', contact_email: null, contact_phone: null, contact_url: null, minimum_commitment: null, documents_required: 'Launch checklist, Monitoring dashboard access, Alert configuration' }
];

function getOnboardingGuide(inventoryId) {
  const db = getDb();
  let steps = db.prepare('SELECT * FROM onboarding_guides WHERE inventory_id = ? ORDER BY step_number ASC').all(inventoryId);

  if (steps.length === 0) {
    generateGuide(inventoryId);
    steps = db.prepare('SELECT * FROM onboarding_guides WHERE inventory_id = ? ORDER BY step_number ASC').all(inventoryId);
  }

  const inventory = db.prepare('SELECT name, category, platform_parent FROM inventories WHERE id = ?').get(inventoryId);

  return {
    inventory_id: inventoryId,
    inventory_name: inventory ? inventory.name : 'Unknown',
    platform: inventory ? inventory.platform_parent : 'Unknown',
    category: inventory ? inventory.category : 'Unknown',
    total_steps: steps.length,
    estimated_total_time: steps.map(s => s.estimated_time).join(' + '),
    steps
  };
}

async function generateGuide(inventoryId) {
  const db = getDb();
  const inventory = db.prepare('SELECT * FROM inventories WHERE id = ?').get(inventoryId);
  if (!inventory) throw new Error(`Inventory not found: ${inventoryId}`);

  let guideSteps = [];

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-5.4',
      messages: [
        {
          role: 'system',
          content: `You are an ad operations expert helping a fintech company (Univest) onboard onto new advertising platforms in India.
Generate a detailed step-by-step activation guide for the specified ad inventory.
Return a JSON array of steps, each with: step_number, step_title, step_description, estimated_time, contact_name, contact_email, contact_phone, contact_url, minimum_commitment, documents_required.
Return ONLY the JSON array.`
        },
        {
          role: 'user',
          content: `Generate an onboarding guide for: ${inventory.name} (${inventory.category}, platform: ${inventory.platform_parent || 'Independent'}, pricing: ${inventory.pricing_model}, CPM range: ₹${inventory.min_cpm}-₹${inventory.max_cpm})`
        }
      ],
      temperature: 0.5,
      max_completion_tokens: 3000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    guideSteps = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[OnboardingAgent] OpenAI call failed, using fallback:', err.message);
    guideSteps = FALLBACK_GUIDE_STEPS.map(step => ({ ...step, step_description: step.step_description.replace(/the platform/g, inventory.name) }));
  }

  for (const step of guideSteps) {
    db.prepare(`
      INSERT INTO onboarding_guides (id, inventory_id, step_number, step_title, step_description,
        estimated_time, contact_name, contact_email, contact_phone, contact_url,
        minimum_commitment, documents_required, created_at)
      VALUES ($id, $inventory_id, $step_number, $step_title, $step_description,
        $estimated_time, $contact_name, $contact_email, $contact_phone, $contact_url,
        $minimum_commitment, $documents_required, datetime('now'))
    `).run({
      id: uuidv4(),
      inventory_id: inventoryId,
      step_number: step.step_number,
      step_title: step.step_title,
      step_description: step.step_description,
      estimated_time: step.estimated_time,
      contact_name: step.contact_name || null,
      contact_email: step.contact_email || null,
      contact_phone: step.contact_phone || null,
      contact_url: step.contact_url || null,
      minimum_commitment: step.minimum_commitment || null,
      documents_required: step.documents_required ? JSON.stringify(step.documents_required) : null,
    });
  }

  return guideSteps;
}

async function regenerateGuide(inventoryId) {
  const db = getDb();
  db.prepare('DELETE FROM onboarding_guides WHERE inventory_id = ?').run(inventoryId);
  return await generateGuide(inventoryId);
}

// ==================== PRICING AGENT ====================

const GOOGLE_SEARCH_UAC_BASELINE_CPM = 60;

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
    benchmark_vs_google_label: benchmark_vs_google < 0 ? `${Math.abs(benchmark_vs_google)}% cheaper than Google` : benchmark_vs_google > 0 ? `${benchmark_vs_google}% more expensive than Google` : 'Same as Google baseline',
    rate_card_type: avg_cpm > 200 ? 'premium' : avg_cpm > 80 ? 'mid_range' : 'value',
    typical_discount: avg_cpm > 200 ? '15-25%' : avg_cpm > 80 ? '10-15%' : '5-10%',
    price_trend: inv.price_trend || 'stable'
  };
}

function getPricingData(inventoryId) {
  const db = getDb();
  const inv = db.prepare('SELECT id, name, category, platform_parent, min_cpm, max_cpm, pricing_model, estimated_monthly_reach, status FROM inventories WHERE id = ?').get(inventoryId);
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
      model: 'gpt-5.4',
      messages: [
        {
          role: 'system',
          content: `You are an ad pricing analyst specializing in the Indian digital advertising market.
Given a list of ad inventories with their current pricing, provide updated cost estimates.
Return a JSON array where each object has: name, min_cpm, max_cpm, pricing_model, price_trend.
Return ONLY the JSON array, no markdown.`
        },
        {
          role: 'user',
          content: `Update pricing estimates for these Indian ad inventories (date: ${new Date().toISOString().split('T')[0]}):\n\n${inventoryNames}`
        }
      ],
      temperature: 0.4,
      max_completion_tokens: 4000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    updates = JSON.parse(jsonStr);
    aiModelUsed = 'gpt-5.4';
  } catch (err) {
    console.error('[PricingAgent] OpenAI call failed, using fallback:', err.message);
    updates = FALLBACK_PRICING_UPDATES;
    aiModelUsed = 'fallback';
  }

  let updatedCount = 0;
  for (const update of updates) {
    const result = db.prepare(`
      UPDATE inventories SET min_cpm = ?, max_cpm = ?, pricing_model = COALESCE(?, pricing_model),
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
  const inventories = db.prepare('SELECT id, name, category, platform_parent, min_cpm, max_cpm, pricing_model, estimated_monthly_reach, status FROM inventories ORDER BY name').all();
  return inventories.map(inv => computePricingFields(inv));
}

// ==================== SCHEDULER AGENT ====================

const cron = require('node-cron');

const jobs = {};
const lastRuns = {};

function startScheduler() {
  jobs.discovery = cron.schedule('0 6 * * *', async () => { lastRuns.discovery = new Date().toISOString(); try { await runDiscovery(); } catch(e) { console.error('Discovery cron error:', e.message); } });
  jobs.pricing = cron.schedule('0 7 * * *', async () => { lastRuns.pricing = new Date().toISOString(); try { await updatePricing(); } catch(e) { console.error('Pricing cron error:', e.message); } });
  jobs.competitor = cron.schedule('0 8 * * *', async () => { lastRuns.competitor = new Date().toISOString(); try { await refreshCompetitorData(); } catch(e) { console.error('Competitor cron error:', e.message); } });
  jobs.weeklyRefresh = cron.schedule('0 9 * * 1', async () => { lastRuns.weeklyRefresh = new Date().toISOString(); try { await runDiscovery(); await updatePricing(); await refreshCompetitorData(); await generateInsights(); } catch(e) { console.error('Weekly refresh error:', e.message); } });
  jobs.newsSweep = cron.schedule('*/30 * * * *', async () => { lastRuns.newsSweep = new Date().toISOString(); try { await newsSweep(); } catch(e) { console.error('News sweep error:', e.message); } });
  jobs.metaRefresh = cron.schedule('0 10 * * *', async () => { lastRuns.metaRefresh = new Date().toISOString(); });
  jobs.googleRefresh = cron.schedule('0 11 * * *', async () => { lastRuns.googleRefresh = new Date().toISOString(); });
  jobs.statusUpdate = cron.schedule('0 0 * * *', () => { try { autoUpdateStatus(); } catch(e) { console.error('Status update error:', e.message); } });
  console.log('[Scheduler] All cron jobs started');
}

function getSchedulerStatus() {
  const nextRuns = {};
  for (const [name, job] of Object.entries(jobs)) {
    nextRuns[name] = { lastRun: lastRuns[name] || 'never', active: true };
  }
  return { jobs: nextRuns, schedulerRunning: true };
}

async function runSchedulerJob(jobName) {
  const runners = {
    discovery: () => runDiscovery(),
    pricing: () => updatePricing(),
    competitor: () => refreshCompetitorData(),
    insights: () => generateInsights(),
    newsSweep: () => newsSweep(),
    statusUpdate: () => autoUpdateStatus()
  };

  if (!runners[jobName]) throw new Error(`Unknown job: ${jobName}`);
  lastRuns[jobName] = new Date().toISOString();
  return await runners[jobName]();
}

function stopScheduler() {
  for (const job of Object.values(jobs)) { job.stop(); }
  console.log('[Scheduler] All cron jobs stopped');
}

// ==================== EXPORTS ====================

module.exports = {
  // Ad Format Agent
  getFormatRecommendations, generateFormatScores,
  // Ad Synthesis Agent
  buildCompetitorAdProfile, detectCampaignPatterns, generateCompetitiveAlerts, buildUnivestGapReport, runSynthesis,
  // AI Insight Agent
  generateInsights, newsSweep, getInsights, markAsRead, getInsightsForInventory,
  // Budget Agent
  getBudgetRecommendation, generateBudgetRecommendation, compareBudgets,
  // Competitor Agent
  getCompetitorSpends, getCompetitorProfile, refreshCompetitorData, getWhitespace, getAdvantagesDisadvantages, getAllCompetitors,
  // Discovery Agent
  runDiscovery, getDiscoveryLog, getNewInventories, autoUpdateStatus,
  // Existing Inventory Agent
  getExistingInventories, compareWithBenchmark, getAllBenchmarks,
  // Google Ads Agent
  searchAdvertiser, fetchGoogleAds, fetchCompetitorYouTubeAds, fetchSearchAds, refreshAllGoogleCompetitors, getKeywordGaps,
  // Meta Ad Library Agent
  fetchMetaAds, classifyAdTheme, detectLongRunningAds, extractSpendSignals, refreshAllMetaCompetitors, getAdsByCompetitor, getTrends, getSpendSignals,
  // Onboarding Agent
  getOnboardingGuide, generateGuide, regenerateGuide,
  // Pricing Agent
  getPricingData, updatePricing, comparePricing, getAllPricing,
  // Scheduler Agent
  startScheduler, getSchedulerStatus, runSchedulerJob, stopScheduler
};
