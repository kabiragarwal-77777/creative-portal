const express = require('express');
const router = express.Router();
const cache = require('./cache');

const redditAgent = require('./agents/redditAgent');
const youtubeAgent = require('./agents/youtubeAgent');
const newsAgent = require('./agents/newsAgent');
const twitterAgent = require('./agents/twitterAgent');
const googleTrendsAgent = require('./agents/googleTrendsAgent');
const indiaFinanceAgent = require('./agents/indiaFinanceAgent');
const synthAgent = require('./agents/synthAgent');
const scriptAgent = require('./agents/scriptAgent');
const { startScheduler } = require('./agents/schedulerAgent');

async function runFullScan() {
  if (cache.is_scraping) return { status: 'already_running' };
  cache.is_scraping = true;
  cache.scan_progress = { step: 'scraping', sources: {} };

  try {
    console.log('[TrendScanner] Starting full scrape...');

    const scrapers = [
      { key: 'reddit', fn: () => redditAgent.fetchAllRedditTrends() },
      { key: 'youtube', fn: () => youtubeAgent.fetchYouTubeTrends() },
      { key: 'news', fn: () => newsAgent.fetchAllNews() },
      { key: 'twitter_trends', fn: () => twitterAgent.fetchIndiaTrends() },
      { key: 'google_trends', fn: () => googleTrendsAgent.fetchGoogleTrendingIndia() },
      { key: 'india_finance', fn: () => indiaFinanceAgent.fetchAllIndiaFinanceTrends() },
    ];

    const rawData = { scraped_at: new Date().toISOString() };

    // Run scrapers with progress tracking
    const results = await Promise.allSettled(scrapers.map((s) => s.fn()));
    scrapers.forEach((s, i) => {
      const r = results[i];
      if (r.status === 'fulfilled') {
        rawData[s.key] = r.value;
        const count = Array.isArray(r.value) ? r.value.length : Object.keys(r.value).length;
        cache.scan_progress.sources[s.key] = { status: 'done', count };
      } else {
        rawData[s.key] = s.key === 'india_finance' ? {} : [];
        cache.scan_progress.sources[s.key] = { status: 'failed', error: r.reason?.message };
      }
    });

    cache.set('raw_trends', rawData);

    // Synthesize
    cache.scan_progress.step = 'synthesizing';
    console.log('[TrendScanner] Synthesizing...');
    const synthesized = await synthAgent.synthesizeTrends(rawData);
    synthesized.raw_sources = {
      reddit_count: (rawData.reddit || []).length,
      youtube_count: (rawData.youtube || []).length,
      news_count: (rawData.news || []).length,
      twitter_count: (rawData.twitter_trends || []).length,
      google_trends_count: (rawData.google_trends || []).length,
    };
    cache.set('synthesized', synthesized);

    // Generate concepts
    cache.scan_progress.step = 'generating_concepts';
    console.log('[TrendScanner] Generating concepts...');
    const concepts = await scriptAgent.generateAllConcepts(synthesized);
    cache.set('concepts', concepts);

    cache.is_scraping = false;
    cache.scan_progress = { step: 'complete' };
    return { status: 'complete', trends_found: synthesized.top_trends?.length || 0 };
  } catch (err) {
    cache.is_scraping = false;
    cache.scan_progress = { step: 'error', error: err.message };
    throw err;
  }
}

// Start the scheduler with runFullScan
startScheduler(runFullScan);

// GET /api/trends/status
router.get('/status', (req, res) => {
  res.json({
    is_scraping: cache.is_scraping,
    is_synthesizing: cache.is_synthesizing,
    last_scraped: cache.last_scraped,
    last_synthesized: cache.last_synthesized,
    has_data: !!cache.synthesized,
    trend_count: cache.synthesized?.top_trends?.length || 0,
    scan_progress: cache.scan_progress,
  });
});

// GET /api/trends/data
router.get('/data', (req, res) => {
  if (!cache.synthesized) {
    return res.json({ status: 'no_data', message: 'Run a scan first' });
  }
  res.json({
    status: 'ok',
    synthesized: cache.synthesized,
    concepts: cache.concepts,
    last_scraped: cache.last_scraped,
    is_stale: cache.isStale('raw_trends', 120),
  });
});

// POST /api/trends/scan
router.post('/scan', async (req, res) => {
  if (cache.is_scraping) {
    return res.json({ status: 'already_running', message: 'Scan in progress...' });
  }
  res.json({ status: 'started', message: 'Scan started. Poll /api/trends/status for progress.' });
  runFullScan().catch((e) => console.error('[TrendScanner] Scan error:', e));
});

// POST /api/trends/concepts/:trendId/:format
// Accepts optional body: { script_style, talent_direction, shooting_setup, hinglish }
router.post('/concepts/:trendId/:format', async (req, res) => {
  const { trendId, format } = req.params;
  if (!['static', 'video'].includes(format)) {
    return res.status(400).json({ error: 'format must be static or video' });
  }
  const trend = cache.synthesized?.top_trends?.find((t) => t.trend_id === trendId);
  if (!trend) return res.status(404).json({ error: 'Trend not found' });

  // Extract production context from request body (all optional)
  const productionContext = {
    script_style: req.body?.script_style || null,
    talent_direction: req.body?.talent_direction || null,
    shooting_setup: req.body?.shooting_setup || null,
    hinglish: req.body?.hinglish ?? false,
  };

  try {
    const concept = await scriptAgent.generateCreativeConcepts(
      { ...trend, market_mood: cache.synthesized.market_mood },
      format,
      productionContext
    );
    res.json(concept);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/trends/raw
router.get('/raw', (req, res) => {
  if (!cache.raw_trends) return res.json({ status: 'no_data' });
  res.json({
    reddit_count: cache.raw_trends.reddit?.length,
    youtube_count: cache.raw_trends.youtube?.length,
    news_count: cache.raw_trends.news?.length,
    twitter_count: cache.raw_trends.twitter_trends?.length,
    google_trends_count: cache.raw_trends.google_trends?.length,
    scraped_at: cache.raw_trends.scraped_at,
  });
});

module.exports = router;
module.exports.runFullScan = runFullScan;
