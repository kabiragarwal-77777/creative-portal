const axios = require('axios');

async function fetchMoneycontrolHot() {
  try {
    const url = 'https://www.moneycontrol.com/news/business/markets/';
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html',
      },
      timeout: 12000,
    });
    const cheerio = require('cheerio');
    const $ = cheerio.load(response.data);
    const articles = [];
    $('h2 a, h3 a, .article-title a, #ca498 li h2 a').each((i, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr('href');
      if (title && title.length > 20 && href) {
        articles.push({ source: 'moneycontrol', title, url: href });
      }
    });
    return articles.slice(0, 20);
  } catch (e) {
    console.warn('Moneycontrol: failed:', e.message);
    return [];
  }
}

async function fetchETMarketsHot() {
  try {
    const url = 'https://economictimes.indiatimes.com/markets';
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html',
      },
      timeout: 12000,
    });
    const cheerio = require('cheerio');
    const $ = cheerio.load(response.data);
    const articles = [];
    $('h2 a, h3 a, .eachStory h3 a, .top-stories a').each((i, el) => {
      const title = $(el).text().trim();
      const href = $(el).attr('href');
      if (title && title.length > 20 && href) {
        const fullUrl = href.startsWith('http')
          ? href
          : `https://economictimes.indiatimes.com${href}`;
        articles.push({ source: 'et_markets', title, url: fullUrl });
      }
    });
    return articles.slice(0, 20);
  } catch (e) {
    console.warn('ET Markets: failed:', e.message);
    return [];
  }
}

async function fetchNSEMostActive() {
  try {
    // NSE requires a cookie/session — first hit the homepage to get cookies
    const session = axios.create({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
        Referer: 'https://www.nseindia.com/',
      },
      timeout: 10000,
    });

    // Get cookies first
    await session.get('https://www.nseindia.com/', { timeout: 5000 }).catch(() => {});

    const response = await session.get(
      'https://www.nseindia.com/api/live-analysis-most-active-securities?index=securities&limit=10'
    );

    return (
      response.data?.data?.map((s) => ({
        source: 'nse',
        symbol: s.symbol,
        company: s.companyName || s.symbol,
        volume: s.totalTradedVolume,
        change_pct: s.pChange,
        last_price: s.lastPrice,
        is_trending: Math.abs(s.pChange) > 2,
      })) || []
    );
  } catch (e) {
    console.warn('NSE: failed:', e.message);
    return [];
  }
}

async function fetchTickertapeTrending() {
  try {
    const url = 'https://www.tickertape.in/market-mood-index';
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'text/html',
      },
      timeout: 10000,
    });
    const cheerio = require('cheerio');
    const $ = cheerio.load(response.data);
    const moodText = $('.mmi-value, .mood-value, [class*="mmi"]').first().text().trim();
    return {
      source: 'tickertape',
      market_mood_index: moodText || 'N/A',
      scraped_at: new Date().toISOString(),
    };
  } catch (e) {
    console.warn('Tickertape: failed:', e.message);
    return { source: 'tickertape', market_mood_index: 'N/A' };
  }
}

async function fetchAllIndiaFinanceTrends() {
  const [mc, et, nse, tt] = await Promise.allSettled([
    fetchMoneycontrolHot(),
    fetchETMarketsHot(),
    fetchNSEMostActive(),
    fetchTickertapeTrending(),
  ]);
  return {
    moneycontrol: mc.status === 'fulfilled' ? mc.value : [],
    et_markets: et.status === 'fulfilled' ? et.value : [],
    nse_active: nse.status === 'fulfilled' ? nse.value : [],
    tickertape: tt.status === 'fulfilled' ? tt.value : {},
  };
}

module.exports = { fetchAllIndiaFinanceTrends, fetchNSEMostActive };
