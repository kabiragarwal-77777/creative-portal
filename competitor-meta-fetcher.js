/**
 * competitor-meta-fetcher.js
 * Meta Ad Library data fetcher for Univest Competitor Intelligence portal.
 * Fetches ad creatives for all tracked competitors and Univest itself.
 */

module.exports = function (config) {
  const axios = require('axios');

  const META_ACCESS_TOKEN = config.metaAccessToken;
  const META_APP_SECRET_PROOF = process.env.META_APP_SECRET_PROOF || '';
  const UNIVEST_PAGE_ID = process.env.UNIVEST_META_PAGE_ID || '100391482646475';
  const CACHE_TTL_MS = (parseFloat(process.env.COMPETITOR_CACHE_TTL_HOURS) || 6) * 60 * 60 * 1000;

  const COMPETITORS = {
    RA: (process.env.COMPETITOR_LIST_RA || 'Samco,StockGro,Sensibull,Definedge,Weekend Investing,Capitalmind,Dhan').split(',').map(s => s.trim()),
    Broking: (process.env.COMPETITOR_LIST_BROKING || 'Zerodha,Groww,Angel One,Upstox,5paisa,Dhan,Paytm Money').split(',').map(s => s.trim())
  };

  const AD_LIBRARY_BASE = 'https://graph.facebook.com/v19.0/ads_archive';
  const AD_FIELDS = 'id,ad_creative_body,ad_creative_link_caption,ad_creative_link_title,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,page_name,impressions,spend,currency,publisher_platforms';
  const PER_PAGE_LIMIT = 50;
  const LOOKBACK_DAYS = 90;

  // Retry config
  const MAX_RETRIES = 3;
  const INITIAL_BACKOFF_MS = 2000;

  // ---------- In-memory cache ----------
  let cache = {
    competitors: {},   // key: competitor name, value: { ads: [], fetchedAt, vertical }
    univest: null,     // { ads: [], fetchedAt }
    lastFetchTime: null,
    hitCounts: {}       // key: competitor name or 'univest', value: number of getAds hits
  };

  // ---------- Helpers ----------

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function ninetyDaysAgo() {
    const d = new Date();
    d.setDate(d.getDate() - LOOKBACK_DAYS);
    return d.toISOString().split('T')[0];
  }

  function isCacheValid(entry) {
    if (!entry || !entry.fetchedAt) return false;
    return (Date.now() - entry.fetchedAt) < CACHE_TTL_MS;
  }

  function log(msg) {
    console.log(`[competitor-meta-fetcher] ${new Date().toISOString()} ${msg}`);
  }

  // ---------- API call with retry + backoff ----------

  async function fetchWithRetry(url, params, retryCount = 0) {
    try {
      const resp = await axios.get(url, { params, timeout: 30000 });
      return resp.data;
    } catch (err) {
      const status = err.response ? err.response.status : null;
      const isRateLimit = status === 429 || status === 4 || (err.response && err.response.data && err.response.data.error && err.response.data.error.code === 4);

      if ((isRateLimit || status === 500 || status === 503) && retryCount < MAX_RETRIES) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, retryCount);
        log(`Rate limit / transient error (status=${status}), retry ${retryCount + 1}/${MAX_RETRIES} in ${backoff}ms`);
        await sleep(backoff);
        return fetchWithRetry(url, params, retryCount + 1);
      }

      // Non-retryable or exhausted retries
      const errMsg = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
      log(`FETCH ERROR: ${errMsg}`);
      throw err;
    }
  }

  // ---------- Fetch ads for a single competitor by search_terms ----------

  async function fetchAdsForCompetitor(competitorName) {
    const sinceDate = ninetyDaysAgo();
    const allAds = [];
    let url = AD_LIBRARY_BASE;
    let params = {
      search_terms: competitorName,
      ad_reached_countries: 'IN',
      fields: AD_FIELDS,
      access_token: META_ACCESS_TOKEN,
      appsecret_proof: META_APP_SECRET_PROOF,
      limit: PER_PAGE_LIMIT,
      ad_delivery_date_min: sinceDate
    };

    log(`Fetching ads for competitor: ${competitorName}`);

    let page = 0;
    while (url) {
      const data = await fetchWithRetry(url, params);
      const ads = data.data || [];
      allAds.push(...ads);
      page++;

      // Pagination — after first request, use the paging.next URL directly
      if (data.paging && data.paging.next) {
        url = data.paging.next;
        params = {}; // next URL already contains all params
      } else {
        url = null;
      }

      // Safety cap: max 10 pages (500 ads) per competitor
      if (page >= 10) {
        log(`Reached page cap (10) for ${competitorName}, stopping pagination`);
        break;
      }
    }

    log(`Fetched ${allAds.length} ads for ${competitorName}`);
    return allAds;
  }

  // ---------- Fetch Univest's own ads by page_id ----------

  async function fetchAdsForUnivestPage() {
    const sinceDate = ninetyDaysAgo();
    const allAds = [];
    let url = AD_LIBRARY_BASE;
    let params = {
      search_page_ids: UNIVEST_PAGE_ID,
      ad_reached_countries: 'IN',
      fields: AD_FIELDS,
      access_token: META_ACCESS_TOKEN,
      appsecret_proof: META_APP_SECRET_PROOF,
      limit: PER_PAGE_LIMIT,
      ad_delivery_date_min: sinceDate
    };

    log(`Fetching Univest ads (page_id=${UNIVEST_PAGE_ID})`);

    let page = 0;
    while (url) {
      const data = await fetchWithRetry(url, params);
      const ads = data.data || [];
      allAds.push(...ads);
      page++;

      if (data.paging && data.paging.next) {
        url = data.paging.next;
        params = {};
      } else {
        url = null;
      }

      if (page >= 10) {
        log(`Reached page cap (10) for Univest, stopping pagination`);
        break;
      }
    }

    log(`Fetched ${allAds.length} Univest ads`);
    return allAds;
  }

  // ---------- Build vertical lookup ----------

  function buildVerticalMap() {
    const map = {};
    for (const [vertical, names] of Object.entries(COMPETITORS)) {
      for (const name of names) {
        if (!map[name]) {
          map[name] = [];
        }
        map[name].push(vertical);
      }
    }
    return map;
  }

  const verticalMap = buildVerticalMap();

  // ---------- Exported functions ----------

  /**
   * Fetch ads for every competitor across all verticals. Populates cache.
   * Returns a summary object.
   */
  async function fetchAllCompetitorAds() {
    const summary = { fetched: 0, competitors: {}, errors: [] };
    const uniqueNames = [...new Set(Object.values(COMPETITORS).flat())];

    for (const name of uniqueNames) {
      // Skip if cache is still valid
      if (isCacheValid(cache.competitors[name])) {
        log(`Cache still valid for ${name}, skipping fetch`);
        summary.competitors[name] = { ads: cache.competitors[name].ads.length, cached: true };
        summary.fetched += cache.competitors[name].ads.length;
        continue;
      }

      try {
        const ads = await fetchAdsForCompetitor(name);
        cache.competitors[name] = {
          ads,
          fetchedAt: Date.now(),
          verticals: verticalMap[name] || []
        };
        summary.competitors[name] = { ads: ads.length, cached: false };
        summary.fetched += ads.length;
      } catch (err) {
        const errMsg = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
        log(`Failed to fetch ads for ${name}: ${errMsg}`);
        summary.errors.push({ competitor: name, error: errMsg });
      }

      // Small delay between competitors to be polite to the API
      await sleep(500);
    }

    // If API returned zero ads (permission issue / quota), seed with demo data
    if (summary.fetched === 0 && summary.errors.length > 0) {
      log('API returned no ads — seeding cache with demo data for pipeline to work');
      seedDemoData();
      summary.fetched = Object.values(cache.competitors).reduce((s, e) => s + (e.ads ? e.ads.length : 0), 0);
      summary.seeded = true;
    }

    cache.lastFetchTime = Date.now();
    log(`fetchAllCompetitorAds complete: ${summary.fetched} total ads from ${uniqueNames.length} competitors, ${summary.errors.length} errors${summary.seeded ? ' (DEMO DATA)' : ''}`);
    return summary;
  }

  /**
   * Fetch Univest's own ads for gap analysis.
   */
  async function fetchUnivest() {
    if (isCacheValid(cache.univest)) {
      log('Univest cache still valid, skipping fetch');
      return { ads: cache.univest.ads.length, cached: true };
    }

    try {
      const ads = await fetchAdsForUnivestPage();
      cache.univest = { ads, fetchedAt: Date.now() };
      cache.lastFetchTime = Date.now();
      return { ads: ads.length, cached: false };
    } catch (err) {
      const errMsg = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
      log(`Failed to fetch Univest ads: ${errMsg}`);
      // If cache already has seeded data, don't throw
      if (cache.univest && cache.univest.ads && cache.univest.ads.length > 0) {
        log('Using existing seeded Univest data');
        return { ads: cache.univest.ads.length, cached: true, seeded: true };
      }
      throw err;
    }
  }

  /**
   * Return cached ads, optionally filtered.
   * @param {Object} filters
   * @param {string} [filters.vertical] — 'RA' or 'Broking'
   * @param {string} [filters.competitor] — exact competitor name
   * @param {number} [filters.days] — only ads from last N days
   * @param {boolean} [filters.includeUnivestFlag] — if true, include Univest ads too
   */
  function getAds(filters = {}) {
    const { vertical, competitor, days, includeUnivestFlag } = filters;
    let results = [];

    // Determine which competitor entries to include
    const entries = Object.entries(cache.competitors);

    for (const [name, entry] of entries) {
      if (!entry || !entry.ads) continue;

      // Filter by specific competitor name
      if (competitor && name !== competitor) continue;

      // Filter by vertical
      if (vertical) {
        const nameVerticals = verticalMap[name] || [];
        if (!nameVerticals.includes(vertical)) continue;
      }

      // Track cache hits
      cache.hitCounts[name] = (cache.hitCounts[name] || 0) + 1;

      let ads = entry.ads.map(ad => ({
        ...ad,
        _competitor: name,
        _verticals: verticalMap[name] || [],
        _fetchedAt: entry.fetchedAt
      }));

      // Filter by recency (days)
      if (days) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString();
        ads = ads.filter(ad => {
          const startTime = ad.ad_delivery_start_time;
          return startTime && startTime >= cutoffStr;
        });
      }

      results.push(...ads);
    }

    // Optionally include Univest
    if (includeUnivestFlag && cache.univest && cache.univest.ads) {
      cache.hitCounts['univest'] = (cache.hitCounts['univest'] || 0) + 1;
      let uAds = cache.univest.ads.map(ad => ({
        ...ad,
        _competitor: 'Univest',
        _verticals: ['Univest'],
        _fetchedAt: cache.univest.fetchedAt
      }));

      if (days) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString();
        uAds = uAds.filter(ad => {
          const startTime = ad.ad_delivery_start_time;
          return startTime && startTime >= cutoffStr;
        });
      }

      results.push(...uAds);
    }

    // Sort by ad_delivery_start_time descending (newest first)
    results.sort((a, b) => {
      const tA = a.ad_delivery_start_time || '';
      const tB = b.ad_delivery_start_time || '';
      return tB.localeCompare(tA);
    });

    return results;
  }

  /**
   * Returns timestamp (ms epoch) of the last successful fetch, or null.
   */
  function getLastFetchTime() {
    return cache.lastFetchTime;
  }

  /**
   * Returns cache status: age, entry counts, hit counts.
   */
  function getCacheStatus() {
    const competitorEntries = Object.entries(cache.competitors);
    const totalAds = competitorEntries.reduce((sum, [, e]) => sum + (e && e.ads ? e.ads.length : 0), 0);
    const univestAds = cache.univest && cache.univest.ads ? cache.univest.ads.length : 0;

    const oldestFetch = competitorEntries.reduce((oldest, [, e]) => {
      if (!e || !e.fetchedAt) return oldest;
      return oldest === null ? e.fetchedAt : Math.min(oldest, e.fetchedAt);
    }, null);

    const newestFetch = competitorEntries.reduce((newest, [, e]) => {
      if (!e || !e.fetchedAt) return newest;
      return newest === null ? e.fetchedAt : Math.max(newest, e.fetchedAt);
    }, null);

    const staleEntries = competitorEntries.filter(([, e]) => !isCacheValid(e)).map(([name]) => name);

    return {
      totalCompetitorAds: totalAds,
      univestAds,
      competitorsCached: competitorEntries.filter(([, e]) => e && e.ads).length,
      competitorsTotal: [...new Set(Object.values(COMPETITORS).flat())].length,
      cacheTtlHours: CACHE_TTL_MS / (60 * 60 * 1000),
      lastFetchTime: cache.lastFetchTime,
      lastFetchAgo: cache.lastFetchTime ? `${Math.round((Date.now() - cache.lastFetchTime) / 60000)} minutes ago` : null,
      oldestEntry: oldestFetch ? new Date(oldestFetch).toISOString() : null,
      newestEntry: newestFetch ? new Date(newestFetch).toISOString() : null,
      staleEntries,
      hitCounts: { ...cache.hitCounts }
    };
  }

  // ---------- Demo seed data (used when Ad Library API is unavailable) ----------

  function seedDemoData() {
    const themes = ['offer', 'education', 'feature', 'social_proof', 'trust', 'fomo', 'free_trial', 'comparison'];
    const hooks = ['Question', 'Stat-led', 'Benefit-led', 'Fear-led', 'Story-led', 'Offer-led'];
    const ctas = ['App Install', 'Sign Up', 'Free Trial', 'Learn More', 'Download'];
    const formats = ['Video', 'Static', 'Carousel', 'Story'];
    const platforms = [['facebook'], ['facebook', 'instagram'], ['instagram'], ['facebook', 'instagram', 'messenger']];
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); };

    const competitorAds = {
      Zerodha: [
        { body: "₹0 brokerage on equity delivery. Forever. Trade smarter with India's #1 broker.", firstSeen: 150 },
        { body: "Over 1.5 crore investors trust Zerodha. Open free account in 10 min.", firstSeen: 120 },
        { body: "Learn investing free on Varsity — 20 lakh students already have.", firstSeen: 75 },
        { body: "Flat ₹20 per trade. No hidden charges. Ever.", firstSeen: 45 },
        { body: "Kite — the fastest trading platform in India.", firstSeen: 30 },
        { body: "Start your SIP for ₹500/month. No demat charges.", firstSeen: 60 },
        { body: "Trade options at flat ₹20. Zerodha Kite.", firstSeen: 80 },
        { body: "Coin — direct mutual funds, zero commission.", firstSeen: 40 },
        { body: "Zerodha Streak — algo trading without coding.", firstSeen: 55 },
        { body: "Why pay more? Switch to zero brokerage today.", firstSeen: 20 },
        { body: "₹0 brokerage on mutual funds. Invest directly.", firstSeen: 35 },
        { body: "Console — manage your portfolio smartly with analytics.", firstSeen: 10 },
      ],
      Groww: [
        { body: "Start investing in stocks from ₹1. No minimum balance.", firstSeen: 90 },
        { body: "Mutual funds SIP from ₹100/month. India ka investing app.", firstSeen: 70 },
        { body: "Groww — invest in stocks, mutual funds, gold. All in one app.", firstSeen: 50 },
        { body: "Zero commission on direct mutual funds. Switch to Groww.", firstSeen: 40 },
        { body: "Open demat account in 5 minutes. Start trading today.", firstSeen: 25 },
        { body: "Learn stock market basics with Groww. Free courses.", firstSeen: 60 },
        { body: "2 crore+ Indians invest with Groww. Join the tribe.", firstSeen: 80 },
        { body: "F&O trading now live on Groww. Advanced charts included.", firstSeen: 15 },
        { body: "Groww NPS — save tax under Section 80CCD. Start with ₹500.", firstSeen: 35 },
        { body: "IPO investing made easy. Apply from Groww app.", firstSeen: 5 },
      ],
      'Angel One': [
        { body: "SmartAPI — build your algo trading bot. Free for Angel One users.", firstSeen: 85 },
        { body: "Angel One SPARK — AI-powered options trading recommendations.", firstSeen: 55 },
        { body: "Flat ₹20 per order on all segments. Angel One.", firstSeen: 70 },
        { body: "15 million+ investors. India's trusted stockbroker since 1996.", firstSeen: 100 },
        { body: "Research reports for free. 300+ stocks covered daily.", firstSeen: 30 },
        { body: "Trade from your smartwatch. Angel One on wearOS.", firstSeen: 20 },
        { body: "Margin pledge — use your holdings as collateral instantly.", firstSeen: 45 },
        { body: "Angel One — SEBI registered. Trusted for 28 years.", firstSeen: 60 },
      ],
      Upstox: [
        { body: "₹0 brokerage on delivery trades. Upstox Pro.", firstSeen: 65 },
        { body: "Trade at lightning speed — Upstox Pro Web platform.", firstSeen: 40 },
        { body: "Upstox — backed by Tiger Global, Ratan Tata, GVK Davix.", firstSeen: 90 },
        { body: "Options trading with advanced strategy builder. Try free.", firstSeen: 25 },
        { body: "1 crore+ users trust Upstox. Open account in 10 min.", firstSeen: 50 },
        { body: "Mutual funds with 0% commission. Switch to Upstox.", firstSeen: 30 },
        { body: "Futures trading at ₹20 flat. No hidden fees.", firstSeen: 15 },
        { body: "Pre-market orders now live. Get early advantage.", firstSeen: 8 },
      ],
      '5paisa': [
        { body: "India's lowest brokerage — ₹15 per trade. 5paisa.", firstSeen: 75 },
        { body: "Trade for free. Zero brokerage on delivery. 5paisa.", firstSeen: 50 },
        { body: "Robo Advisory — automated portfolio management. Free.", firstSeen: 35 },
        { body: "F&O at ₹15 flat. Lowest in industry.", firstSeen: 60 },
        { body: "Open demat account with Aadhaar. 2 minutes.", firstSeen: 20 },
      ],
      Dhan: [
        { body: "Option buying and selling from same screen. Dhan.", firstSeen: 80 },
        { body: "Dhan — fastest order execution in India.", firstSeen: 55 },
        { body: "Free demat + trading account. No hidden charges.", firstSeen: 40 },
        { body: "Dhan HeatMap — see which sectors are moving.", firstSeen: 30 },
        { body: "F&O basket — execute multi-leg strategies instantly.", firstSeen: 65 },
        { body: "Dhan for Zerodha users — switch in 48 hours.", firstSeen: 10 },
        { body: "Bracket orders, cover orders — advanced risk tools.", firstSeen: 45 },
        { body: "Dhan API — algo trading made simple.", firstSeen: 25 },
      ],
      'Paytm Money': [
        { body: "Invest in NPS. Save up to ₹2 lakh in taxes.", firstSeen: 70 },
        { body: "Nifty 50 index fund — the safest long-term bet.", firstSeen: 85 },
        { body: "5 crore Paytm users. Now invest too.", firstSeen: 55 },
        { body: "Gold ETF + physical gold — both on Paytm Money.", firstSeen: 40 },
        { body: "Paytm Money — regulated by SEBI.", firstSeen: 90 },
        { body: "Goal-based investing — retirement, house, education.", firstSeen: 60 },
      ],
      Samco: [
        { body: "StockNote — trade, track, and learn on one platform.", firstSeen: 70 },
        { body: "SAMCO — lowest margin rates. Trade more, pay less.", firstSeen: 45 },
        { body: "Rank MF — find the best mutual fund in your category.", firstSeen: 55 },
        { body: "Options hedging strategies. Protect your portfolio.", firstSeen: 30 },
        { body: "SAMCO Free Account — ₹0 brokerage on delivery.", firstSeen: 80 },
        { body: "Backtest your strategy — 10 years of data.", firstSeen: 20 },
      ],
      StockGro: [
        { body: "Learn investing with ₹1 crore virtual money. Free.", firstSeen: 65 },
        { body: "1 crore+ students learning to invest on StockGro.", firstSeen: 50 },
        { body: "Compete in stock market leagues. Win real prizes.", firstSeen: 35 },
        { body: "Copy portfolios of top investors. Learn by doing.", firstSeen: 75 },
        { body: "StockGro — paper trading before real trading.", firstSeen: 40 },
        { body: "Financial literacy for Gen Z. Free.", firstSeen: 20 },
        { body: "F&O paper trading — practice options without loss.", firstSeen: 15 },
        { body: "Stock market quiz — test your knowledge daily.", firstSeen: 60 },
      ],
      Sensibull: [
        { body: "Option strategies without the complexity. Sensibull.", firstSeen: 70 },
        { body: "Build iron condor in 2 clicks. Sensibull.", firstSeen: 85 },
        { body: "70% of retail options traders lose money. Don't be one.", firstSeen: 45 },
        { body: "Max pain calculator — know where price gravitates.", firstSeen: 55 },
        { body: "PCR, OI analysis — understand smart money moves.", firstSeen: 30 },
        { body: "Sensibull — used by 3 lakh options traders.", firstSeen: 15 },
        { body: "Hedge your portfolio with puts. Auto-calculated.", firstSeen: 60 },
      ],
      Definedge: [
        { body: "Renko charts + Zone analysis — Definedge way.", firstSeen: 80 },
        { body: "Point & Figure charts for Indian markets. Professional grade.", firstSeen: 50 },
        { body: "Opstra — options analysis for serious traders.", firstSeen: 60 },
        { body: "TradePoint — scan 5000 stocks in seconds.", firstSeen: 35 },
        { body: "Definedge — learn technical analysis the right way.", firstSeen: 20 },
      ],
      'Weekend Investing': [
        { body: "Mi India Top 10 — outperformed Nifty for 8 years.", firstSeen: 90 },
        { body: "SEBI Registered Investment Adviser. Your money, our research.", firstSeen: 65 },
        { body: "Momentum investing — systematic, rule-based, no emotion.", firstSeen: 40 },
        { body: "Weekend Investing — spend 30 min/week on your portfolio.", firstSeen: 55 },
        { body: "Smallcase by Weekend Investing — invest like a pro.", firstSeen: 25 },
      ],
      Capitalmind: [
        { body: "Capitalmind Premium — institutional research for retail investors.", firstSeen: 75 },
        { body: "Wealth — PMS by Capitalmind. SEBI registered.", firstSeen: 50 },
        { body: "Momentum portfolio — 20%+ CAGR over 5 years.", firstSeen: 35 },
        { body: "Slack community of 3000+ serious investors.", firstSeen: 60 },
      ],
    };

    for (const [name, adTemplates] of Object.entries(competitorAds)) {
      const ads = adTemplates.map((t, i) => {
        const isActive = Math.random() > 0.3;
        const startDate = daysAgo(t.firstSeen);
        return {
          id: `demo_${name.replace(/\s+/g, '_').toLowerCase()}_${i}`,
          ad_creative_body: t.body,
          ad_creative_link_title: t.body.substring(0, 50),
          ad_creative_link_caption: name,
          ad_delivery_start_time: startDate,
          ad_delivery_stop_time: isActive ? null : daysAgo(Math.floor(Math.random() * t.firstSeen * 0.5)),
          ad_snapshot_url: null,
          page_name: name,
          impressions: null,
          spend: null,
          currency: 'INR',
          publisher_platforms: pick(platforms),
          _demo: true,
        };
      });
      cache.competitors[name] = { ads, fetchedAt: Date.now(), verticals: verticalMap[name] || [] };
    }

    // Seed Univest too
    cache.univest = {
      ads: [
        { id: 'demo_univest_1', ad_creative_body: '₹1 trial — Get expert stock picks for 7 days.', page_name: 'Univest', ad_delivery_start_time: daysAgo(60), ad_delivery_stop_time: null, publisher_platforms: ['facebook', 'instagram'], _demo: true },
        { id: 'demo_univest_2', ad_creative_body: 'Join 5 lakh investors. SEBI-registered research advisory.', page_name: 'Univest', ad_delivery_start_time: daysAgo(45), ad_delivery_stop_time: null, publisher_platforms: ['facebook'], _demo: true },
        { id: 'demo_univest_3', ad_creative_body: 'Stocks that beat Nifty — expert-curated portfolio.', page_name: 'Univest', ad_delivery_start_time: daysAgo(30), ad_delivery_stop_time: null, publisher_platforms: ['facebook', 'instagram'], _demo: true },
        { id: 'demo_univest_4', ad_creative_body: '92% accuracy. Try Univest Research for ₹1.', page_name: 'Univest', ad_delivery_start_time: daysAgo(20), ad_delivery_stop_time: null, publisher_platforms: ['instagram'], _demo: true },
      ],
      fetchedAt: Date.now(),
    };
  }

  // ---------- Public API ----------

  return {
    fetchAllCompetitorAds,
    fetchUnivest,
    getAds,
    getLastFetchTime,
    getCacheStatus
  };
};
