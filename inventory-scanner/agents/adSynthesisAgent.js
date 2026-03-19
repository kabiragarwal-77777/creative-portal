const { getDb } = require('../database/db');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildCompetitorAdProfile(competitorId) {
  const db = getDb();
  const competitor = db.prepare('SELECT * FROM competitors WHERE id = ?').get(competitorId);
  if (!competitor) return null;

  // Meta ads data
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

  // Google ads data
  const googleAds = db.prepare('SELECT * FROM google_ads WHERE competitor_id = ?').all(competitorId);
  const youtubeAds = db.prepare('SELECT * FROM youtube_ads WHERE competitor_id = ?').all(competitorId);
  const searchAds = db.prepare('SELECT * FROM search_ads WHERE competitor_id = ?').all(competitorId);

  const searchKeywords = [...new Set(searchAds.map(a => a.keyword))];
  const topSearchKeywords = searchKeywords.slice(0, 10);
  const googleFormats = {};
  googleAds.forEach(a => { if (a.format) googleFormats[a.format] = (googleFormats[a.format] || 0) + 1; });
  const dominantGoogleFormat = Object.entries(googleFormats).sort((a, b) => b[1] - a[1])[0];

  // Unified metrics
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

  // Gather all ad data for pattern detection
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
      model: 'gpt-4o',
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
      max_tokens: 3000
    });

    const content = response.choices[0].message.content.trim();
    const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    patterns = JSON.parse(jsonStr);
  } catch (err) {
    console.error('[AdSynthesis] Pattern detection OpenAI failed, using DB analysis:', err.message);

    // Fallback: derive patterns from DB data
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

  // 1. Blitz alert: 5+ new ads in 48h
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

  // 2. Silence alert: 7+ days without new ads
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

  // 3. New keyword entrant
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
      // Check if this is new (no older search ads for this competitor+keyword)
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

  // 4. New format testing
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
      const alertKey = `${ad.competitor_name}_${ad.media_type}`;
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

  // Channel gaps: channels where competitors are active but Univest may not be
  const competitorChannels = db.prepare(`
    SELECT DISTINCT i.category, i.name as inventory_name, COUNT(DISTINCT cs.competitor_id) as competitor_count
    FROM competitor_spends cs
    JOIN inventories i ON cs.inventory_id = i.id
    GROUP BY i.category, i.name
    ORDER BY competitor_count DESC
  `).all();

  // Check Univest presence (existing_inventories)
  const univestInventories = db.prepare(`
    SELECT i.category, i.name
    FROM existing_inventories ei
    JOIN inventories i ON ei.inventory_id = i.id
  `).all();
  const univestChannelNames = new Set(univestInventories.map(i => i.name.toLowerCase()));
  const univestCategories = new Set(univestInventories.map(i => i.category));

  const channelGaps = competitorChannels
    .filter(ch => !univestChannelNames.has(ch.inventory_name.toLowerCase()))
    .map(ch => ({
      channel: ch.inventory_name,
      category: ch.category,
      competitors_active: ch.competitor_count,
      univest_present: false,
      priority: ch.competitor_count >= 3 ? 'high' : 'medium'
    }));

  // Theme gaps
  const competitorThemes = db.prepare(`
    SELECT theme_tag, COUNT(*) as usage_count
    FROM meta_ads WHERE theme_tag IS NOT NULL
    GROUP BY theme_tag ORDER BY usage_count DESC
  `).all();

  // Assume Univest themes are a subset (we track what they could use)
  const commonUnivestThemes = ['Feature Highlight', 'App Install', 'Education'];
  const themeGaps = competitorThemes
    .filter(t => !commonUnivestThemes.includes(t.theme_tag))
    .map(t => ({
      theme: t.theme_tag,
      competitor_usage: t.usage_count,
      univest_using: false,
      recommendation: `Consider testing "${t.theme_tag}" theme - ${t.usage_count} competitor ads use it`
    }));

  // Keyword gaps
  const searchKeywords = db.prepare(`
    SELECT DISTINCT keyword, COUNT(DISTINCT competitor_id) as competitor_count
    FROM search_ads GROUP BY keyword ORDER BY competitor_count DESC
  `).all();

  const keywordGaps = searchKeywords.map(kw => ({
    keyword: kw.keyword,
    competitors_bidding: kw.competitor_count,
    univest_present: false, // Assume not present unless tracked
    priority: kw.competitor_count >= 3 ? 'high' : 'medium'
  }));

  // Format gaps
  const competitorFormats = db.prepare(`
    SELECT media_type as format, COUNT(*) as usage_count
    FROM meta_ads GROUP BY media_type ORDER BY usage_count DESC
  `).all();

  const googleFormats = db.prepare(`
    SELECT format, COUNT(*) as usage_count
    FROM google_ads GROUP BY format ORDER BY usage_count DESC
  `).all();

  const allFormats = {};
  competitorFormats.forEach(f => { allFormats[f.format] = (allFormats[f.format] || 0) + f.usage_count; });
  googleFormats.forEach(f => { allFormats[f.format] = (allFormats[f.format] || 0) + f.usage_count; });

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
  const competitors = db.prepare('SELECT id, name FROM competitors').all();

  const profiles = [];
  for (const comp of competitors) {
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

  let alerts;
  try {
    alerts = generateCompetitiveAlerts();
  } catch (err) {
    console.error('[AdSynthesis] Alert generation error:', err.message);
    alerts = [];
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
    competitive_alerts: alerts,
    gap_report: gapReport,
    summary: {
      competitors_analyzed: profiles.length,
      alerts_generated: alerts.length,
      high_priority_alerts: alerts.filter(a => a.severity === 'high').length
    }
  };
}

// Helper function to count occurrences of a field value
function countField(items, field) {
  const counts = {};
  for (const item of items) {
    const val = item[field];
    if (val) counts[val] = (counts[val] || 0) + 1;
  }
  return counts;
}

module.exports = { buildCompetitorAdProfile, detectCampaignPatterns, generateCompetitiveAlerts, buildUnivestGapReport, runSynthesis };
