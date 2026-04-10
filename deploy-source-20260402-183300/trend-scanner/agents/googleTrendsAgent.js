const axios = require('axios');
const RSSParser = require('rss-parser');

const TRACKED_KEYWORDS = [
  'stock tips india', 'best trading app india', 'demat account open',
  'options trading strategy', 'nifty prediction', 'share market advice',
  'zerodha vs groww', 'stock market for beginners', 'best mutual fund',
  'technical analysis india',
];

function isFinanceRelated(topic) {
  const financeTerms = [
    'stock', 'market', 'nifty', 'sensex', 'rbi', 'sebi', 'ipo',
    'share', 'fund', 'invest', 'trading', 'broker', 'demat', 'budget', 'economy',
    'inflation', 'rate', 'bank', 'crypto', 'bitcoin', 'mutual fund',
  ];
  return financeTerms.some((t) => topic.toLowerCase().includes(t));
}

async function fetchGoogleTrendingRSS() {
  const parser = new RSSParser({
    timeout: 10000,
    customFields: {
      item: [
        ['ht:approx_traffic', 'ht_approx_traffic'],
        ['ht:picture', 'ht_picture'],
        ['ht:news_item', 'ht_news_item'],
      ],
    },
  });

  try {
    const feed = await parser.parseURL(
      'https://trends.google.com/trends/trendingsearches/daily/rss?geo=IN'
    );
    return feed.items.map((item) => ({
      source: 'google_trends',
      topic: item.title,
      traffic: item.ht_approx_traffic || 'N/A',
      related_articles: item.ht_news_item
        ? Array.isArray(item.ht_news_item)
          ? item.ht_news_item
          : [item.ht_news_item]
        : [],
      published: item.pubDate,
      is_finance_related: isFinanceRelated(item.title),
    }));
  } catch (e) {
    console.warn('Google Trends RSS: failed:', e.message);
    return [];
  }
}

async function fetchSerpAPI() {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) return [];

  const results = [];
  for (const keyword of TRACKED_KEYWORDS.slice(0, 3)) {
    try {
      const response = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google_trends',
          q: keyword,
          geo: 'IN',
          data_type: 'TIMESERIES',
          api_key: apiKey,
        },
        timeout: 10000,
      });
      const timelineData = response.data.interest_over_time?.timeline_data || [];
      const latest = timelineData.slice(-7);
      const avgInterest =
        latest.reduce((sum, d) => sum + (d.values?.[0]?.extracted_value || 0), 0) /
        Math.max(1, latest.length);

      results.push({
        source: 'google_trends_api',
        keyword,
        avg_interest_7d: Math.round(avgInterest),
        is_rising: avgInterest > 50,
        data_points: latest.length,
      });
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      console.warn(`SerpAPI: failed for "${keyword}":`, e.message);
    }
  }
  return results;
}

async function fetchGoogleTrendingIndia() {
  const [rss, serp] = await Promise.allSettled([
    fetchGoogleTrendingRSS(),
    fetchSerpAPI(),
  ]);

  const rssResults = rss.status === 'fulfilled' ? rss.value : [];
  const serpResults = serp.status === 'fulfilled' ? serp.value : [];

  // Filter RSS to finance-related or high-traffic
  const filtered = rssResults.filter(
    (t) => t.is_finance_related || (t.traffic && t.traffic.replace(/[^0-9]/g, '') > 100000)
  );

  return [...filtered, ...serpResults];
}

module.exports = { fetchGoogleTrendingIndia };
