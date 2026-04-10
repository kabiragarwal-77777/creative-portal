const axios = require('axios');
const RSSParser = require('rss-parser');

const RSS_FEEDS = [
  { name: 'Moneycontrol Markets', url: 'https://www.moneycontrol.com/rss/marketsnews.xml', weight: 1.4 },
  { name: 'ET Markets', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', weight: 1.4 },
  { name: 'Livemint Markets', url: 'https://www.livemint.com/rss/markets', weight: 1.3 },
  { name: 'BS Markets', url: 'https://www.business-standard.com/rss/markets-106.rss', weight: 1.3 },
  { name: 'NDTV Profit', url: 'https://feeds.feedburner.com/ndtvprofit-latest', weight: 1.2 },
  { name: 'Financial Express Markets', url: 'https://www.financialexpress.com/market/feed/', weight: 1.1 },
  { name: 'Inc42 Fintech', url: 'https://inc42.com/tag/fintech/feed/', weight: 1.2 },
  { name: 'YourStory Finance', url: 'https://yourstory.com/feed', weight: 1.0 },
  { name: 'Reuters Finance', url: 'https://feeds.reuters.com/reuters/businessNews', weight: 0.8 },
  { name: 'Bloomberg Markets RSS', url: 'https://feeds.bloomberg.com/markets/news.rss', weight: 0.9 },
];

function scoreIndiaRelevance(title, summary) {
  const indiaTerms = [
    'india', 'nse', 'bse', 'nifty', 'sensex', 'sebi', 'rbi',
    'rupee', 'inr', '₹', 'dalal street', 'bombay', 'mumbai', 'zerodha', 'groww',
    'angel one', 'upstox', 'ipo india', 'f&o', 'fno',
  ];
  const text = (title + ' ' + summary).toLowerCase();
  const matches = indiaTerms.filter((t) => text.includes(t)).length;
  return Math.min(1, matches / 3);
}

function scoreUnivestRelevance(title, summary) {
  const univestTerms = [
    'subscription', 'advisory', 'stock tips', 'options strategy',
    'trading app', 'demat', 'broker', 'research', 'analyst', 'recommendation',
    'portfolio', 'trading education', 'market analysis', 'technical analysis',
  ];
  const text = (title + ' ' + summary).toLowerCase();
  const matches = univestTerms.filter((t) => text.includes(t)).length;
  return Math.min(1, matches / 2);
}

function classifyCategory(title) {
  const t = title.toLowerCase();
  if (t.includes('ipo')) return 'ipo';
  if (t.includes('crypto') || t.includes('bitcoin')) return 'crypto';
  if (t.includes('economy') || t.includes('gdp') || t.includes('inflation')) return 'economy';
  if (t.includes('fintech') || t.includes('app')) return 'fintech';
  if (t.includes('trading') || t.includes('f&o') || t.includes('options')) return 'trading';
  if (t.includes('mutual fund') || t.includes('sip') || t.includes('personal finance')) return 'personal_finance';
  if (t.includes('stock') || t.includes('share') || t.includes('equity')) return 'stocks';
  return 'markets';
}

function simpleSentiment(title) {
  const t = title.toLowerCase();
  const bullish = ['surge', 'rally', 'gain', 'rise', 'jump', 'soar', 'bull', 'high', 'record', 'boom', 'profit'];
  const bearish = ['crash', 'fall', 'drop', 'plunge', 'sink', 'bear', 'loss', 'low', 'decline', 'sell-off', 'panic'];
  const bullScore = bullish.filter((w) => t.includes(w)).length;
  const bearScore = bearish.filter((w) => t.includes(w)).length;
  if (bullScore > bearScore) return 'bullish';
  if (bearScore > bullScore) return 'bearish';
  return 'neutral';
}

async function fetchRSSFeeds() {
  const parser = new RSSParser({ timeout: 10000 });
  const results = [];

  for (const feed of RSS_FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const articles = parsed.items.slice(0, 15).map((item) => {
        const title = item.title || '';
        const summary = (item.contentSnippet || item.content || '').substring(0, 400);
        const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();
        const ageHours = (Date.now() - new Date(publishedAt).getTime()) / 3600000;

        return {
          source: 'news',
          source_name: feed.name,
          title,
          summary,
          url: item.link || '',
          published_at: publishedAt,
          category: classifyCategory(title),
          keywords: title.split(/\s+/).filter((w) => w.length > 4).slice(0, 5),
          sentiment: simpleSentiment(title),
          india_relevance: scoreIndiaRelevance(title, summary),
          univest_relevance: scoreUnivestRelevance(title, summary),
          age_hours: Math.round(ageHours * 10) / 10,
          viral_score: Math.round((1 / Math.max(1, ageHours)) * feed.weight * 100),
        };
      });
      results.push(...articles);
      await new Promise((r) => setTimeout(r, 400));
    } catch (e) {
      console.warn(`News RSS: failed for ${feed.name}:`, e.message);
    }
  }
  return results;
}

async function fetchNewsAPI() {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey) return [];

  try {
    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: 'stock market India OR NSE OR BSE OR Nifty OR trading app',
        language: 'en',
        sortBy: 'publishedAt',
        pageSize: 30,
        apiKey,
      },
      timeout: 10000,
    });
    return (response.data.articles || []).map((a) => {
      const title = a.title || '';
      const summary = (a.description || '').substring(0, 400);
      const publishedAt = a.publishedAt || new Date().toISOString();
      const ageHours = (Date.now() - new Date(publishedAt).getTime()) / 3600000;

      return {
        source: 'news',
        source_name: a.source?.name || 'NewsAPI',
        title,
        summary,
        url: a.url || '',
        published_at: publishedAt,
        category: classifyCategory(title),
        keywords: title.split(/\s+/).filter((w) => w.length > 4).slice(0, 5),
        sentiment: simpleSentiment(title),
        india_relevance: scoreIndiaRelevance(title, summary),
        univest_relevance: scoreUnivestRelevance(title, summary),
        age_hours: Math.round(ageHours * 10) / 10,
        viral_score: Math.round((1 / Math.max(1, ageHours)) * 120),
      };
    });
  } catch (e) {
    console.warn('NewsAPI: failed:', e.message);
    return [];
  }
}

async function fetchAllNews() {
  const [rss, api] = await Promise.allSettled([fetchRSSFeeds(), fetchNewsAPI()]);
  const all = [
    ...(rss.status === 'fulfilled' ? rss.value : []),
    ...(api.status === 'fulfilled' ? api.value : []),
  ];
  return all.sort((a, b) => b.viral_score - a.viral_score).slice(0, 100);
}

module.exports = { fetchAllNews };
