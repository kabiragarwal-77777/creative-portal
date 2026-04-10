const axios = require('axios');

const NITTER_INSTANCES = [
  'https://nitter.net',
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
];

const SEARCH_QUERIES = [
  '#NiftyBanknifty', '#StockMarketIndia', '#NSEIndia',
  '#OptionsTrading', '#Zerodha', '#Groww', '#AngelOne',
  '#DalalStreet', '#Sensex', '#TradingPsychology',
  'demat account', 'stock tips india', 'multibagger',
  '#FnO', '#BreakoutStocks',
];

function extractNumber(text, label) {
  const regex = new RegExp(`(\\d[\\d,]*)\\s*${label}`, 'i');
  const match = text.match(regex);
  return match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
}

async function fetchNitterSearch(query, instance) {
  const url = `${instance}/search?f=tweets&q=${encodeURIComponent(query)}`;
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 8000,
  });
  const cheerio = require('cheerio');
  const $ = cheerio.load(response.data);
  const tweets = [];
  $('.timeline-item').each((i, el) => {
    const text = $(el).find('.tweet-content').text().trim();
    const stats = $(el).find('.tweet-stats').text();
    const likes = extractNumber(stats, 'like') || 0;
    const retweets = extractNumber(stats, 'retweet') || 0;
    if (text && text.length > 20) {
      tweets.push({
        source: 'twitter',
        text: text.substring(0, 280),
        likes,
        retweets,
        engagement: likes + retweets * 2,
        query,
        url: instance + ($(el).find('a.tweet-link').attr('href') || ''),
        scraped_at: new Date().toISOString(),
      });
    }
  });
  return tweets;
}

async function fetchTrends24() {
  try {
    const url = 'https://trends24.in/india/';
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000,
    });
    const cheerio = require('cheerio');
    const $ = cheerio.load(response.data);
    const trends = [];
    $('.trend-card .trend-name, .trend-card__list li a').each((i, el) => {
      const topic = $(el).text().trim();
      if (topic) {
        trends.push({
          source: 'twitter_trends',
          topic,
          rank: i + 1,
        });
      }
    });
    return trends.slice(0, 30);
  } catch (e) {
    console.warn('Trends24: failed:', e.message);
    return [];
  }
}

async function fetchNitterTrends() {
  const results = [];
  for (const query of SEARCH_QUERIES.slice(0, 5)) {
    for (const instance of NITTER_INSTANCES) {
      try {
        const tweets = await fetchNitterSearch(query, instance);
        results.push(...tweets);
        break; // success — move to next query
      } catch (e) {
        continue; // try next instance
      }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return results;
}

async function fetchIndiaTrends() {
  const [nitter, trends24] = await Promise.allSettled([
    fetchNitterTrends(),
    fetchTrends24(),
  ]);
  return [
    ...(trends24.status === 'fulfilled' ? trends24.value : []),
    ...(nitter.status === 'fulfilled' ? nitter.value : []),
  ];
}

module.exports = { fetchIndiaTrends };
