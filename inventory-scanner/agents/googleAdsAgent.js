const { getDb } = require('../database/db');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MOCK_ADVERTISER_IDS = {
  'Groww': 'AR_GROWW_001',
  'Zerodha': 'AR_ZERODHA_002',
  'Angel One': 'AR_ANGELONE_003',
  'Upstox': 'AR_UPSTOX_004',
  '5paisa': 'AR_5PAISA_005',
  'CRED': 'AR_CRED_006',
  'Paytm Money': 'AR_PAYTM_007',
  'Univest': 'AR_UNIVEST_008'
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
  'Zerodha': [
    { format: 'display_banner', platform: 'google_display', creative_url: 'https://zerodha.com/ads/display1.jpg', theme_tag: 'Education', first_shown: '2025-10-01', last_shown: '2026-03-10' }
  ],
  'Upstox': [
    { format: 'responsive_display', platform: 'google_display', creative_url: 'https://upstox.com/ads/responsive1.html', theme_tag: 'Celebrity', first_shown: '2026-01-15', last_shown: '2026-03-18' },
    { format: 'display_banner', platform: 'google_display', creative_url: 'https://upstox.com/ads/display1.jpg', theme_tag: 'Free Trial', first_shown: '2026-02-01', last_shown: '2026-03-18' }
  ],
  '5paisa': [
    { format: 'display_banner', platform: 'google_display', creative_url: 'https://5paisa.com/ads/display1.jpg', theme_tag: 'Offer/Discount', first_shown: '2026-01-01', last_shown: '2026-03-15' }
  ],
  'CRED': [
    { format: 'responsive_display', platform: 'google_display', creative_url: 'https://cred.club/ads/responsive1.html', theme_tag: 'Fear/FOMO', first_shown: '2025-12-01', last_shown: '2026-03-18' },
    { format: 'display_banner', platform: 'google_display', creative_url: 'https://cred.club/ads/display1.jpg', theme_tag: 'Offer/Discount', first_shown: '2026-02-15', last_shown: '2026-03-18' }
  ],
  'Paytm Money': [
    { format: 'display_banner', platform: 'google_display', creative_url: 'https://paytmmoney.com/ads/display1.jpg', theme_tag: 'App Install', first_shown: '2026-01-10', last_shown: '2026-03-15' }
  ]
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

    // Attempt Google Ads Transparency Center API
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

  // Get or create competitor
  let competitor = db.prepare('SELECT id FROM competitors WHERE LOWER(name) = LOWER(?)').get(competitorName);
  if (!competitor) {
    const compId = uuidv4();
    db.prepare('INSERT INTO competitors (id, name, vertical, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(compId, competitorName, 'fintech');
    competitor = { id: compId };
  }

  // Store ads
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
        params: {
          q: `${competitorName} ad india`,
          type: 'video',
          videoCategoryId: '22',
          regionCode: 'IN',
          maxResults: 10,
          key: process.env.YOUTUBE_API_KEY,
          part: 'snippet'
        }
      });
      if (response.data && response.data.items) {
        ytAds = response.data.items.map(item => ({
          video_id: item.id.videoId,
          title: item.snippet.title,
          description: item.snippet.description,
          duration_seconds: 30,
          view_count: 0,
          publish_date: item.snippet.publishedAt ? item.snippet.publishedAt.split('T')[0] : null,
          ad_format_guess: 'in-stream_skippable',
          theme_tag: null
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
        title: ad.title,
        description: `${competitorName} promotional video advertisement for Indian market.`,
        duration_seconds: ad.duration_seconds,
        view_count: ad.view_count,
        publish_date: publishDate.toISOString().split('T')[0],
        ad_format_guess: ad.ad_format_guess,
        theme_tag: ad.theme_tag
      };
    });
  }

  // Get or create competitor
  let competitor = db.prepare('SELECT id FROM competitors WHERE LOWER(name) = LOWER(?)').get(competitorName);
  if (!competitor) {
    const compId = uuidv4();
    db.prepare('INSERT INTO competitors (id, name, vertical, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(compId, competitorName, 'fintech');
    competitor = { id: compId };
  }

  // Store YouTube ads
  for (const ad of ytAds) {
    const existing = db.prepare('SELECT id FROM youtube_ads WHERE video_id = ?').get(ad.video_id);
    if (existing) {
      db.prepare('UPDATE youtube_ads SET view_count = ?, theme_tag = ? WHERE id = ?')
        .run(ad.view_count, ad.theme_tag, existing.id);
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
        params: {
          q: keyword,
          location: 'India',
          google_domain: 'google.co.in',
          gl: 'in',
          hl: 'en',
          api_key: process.env.SERPAPI_KEY
        }
      });
      if (response.data && response.data.ads) {
        searchResults = response.data.ads.map(ad => ({
          competitor: ad.advertiser || 'Unknown',
          headline1: ad.title || '',
          headline2: '',
          headline3: '',
          description1: ad.description || '',
          description2: '',
          display_url: ad.displayed_link || '',
          position: ad.position || 0
        }));
      }
    } else {
      throw new Error('No SERPAPI_KEY configured');
    }
  } catch (err) {
    console.error(`[GoogleAdsAgent] SerpAPI failed for "${keyword}", using mock:`, err.message);
    searchResults = MOCK_SEARCH_ADS[keyword] || [];
  }

  // Store search ads
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

async function refreshAllCompetitors() {
  const db = getDb();
  const competitors = db.prepare('SELECT name FROM competitors').all();
  const results = { google_display: [], youtube: [], search: [] };

  // Fetch Google Display and YouTube ads for each competitor
  for (const comp of competitors) {
    try {
      const gResult = await fetchGoogleAds(comp.name);
      results.google_display.push(gResult);
    } catch (err) {
      console.error(`[GoogleAdsAgent] Display error for ${comp.name}:`, err.message);
    }

    try {
      const yResult = await fetchCompetitorYouTubeAds(comp.name);
      results.youtube.push(yResult);
    } catch (err) {
      console.error(`[GoogleAdsAgent] YouTube error for ${comp.name}:`, err.message);
    }
  }

  // Fetch search ads for all keywords
  for (const keyword of MOCK_SEARCH_KEYWORDS) {
    try {
      const sResult = await fetchSearchAds(keyword);
      results.search.push(sResult);
    } catch (err) {
      console.error(`[GoogleAdsAgent] Search error for "${keyword}":`, err.message);
    }
  }

  return {
    competitors_processed: competitors.length,
    keywords_searched: MOCK_SEARCH_KEYWORDS.length,
    results
  };
}

function getKeywordGaps() {
  const db = getDb();

  // Get all keywords where competitors are active
  const competitorKeywords = db.prepare(`
    SELECT DISTINCT sa.keyword, c.name as competitor_name, sa.position
    FROM search_ads sa
    JOIN competitors c ON sa.competitor_id = c.id
    ORDER BY sa.keyword, sa.position
  `).all();

  // Group by keyword
  const keywordMap = {};
  for (const row of competitorKeywords) {
    if (!keywordMap[row.keyword]) {
      keywordMap[row.keyword] = { keyword: row.keyword, competitors: [], positions: {} };
    }
    if (!keywordMap[row.keyword].competitors.includes(row.competitor_name)) {
      keywordMap[row.keyword].competitors.push(row.competitor_name);
    }
    keywordMap[row.keyword].positions[row.competitor_name] = row.position;
  }

  // Check if Univest is present
  const gaps = [];
  for (const [keyword, data] of Object.entries(keywordMap)) {
    const univestPresent = data.competitors.some(c => c.toLowerCase().includes('univest'));
    gaps.push({
      keyword: data.keyword,
      competitor_count: data.competitors.length,
      competitors: data.competitors,
      positions: data.positions,
      univest_present: univestPresent,
      gap_type: univestPresent ? 'active' : 'gap',
      priority: !univestPresent && data.competitor_count >= 3 ? 'high' :
                !univestPresent && data.competitor_count >= 2 ? 'medium' : 'low',
      recommendation: univestPresent
        ? 'Already active - optimize position'
        : `${data.competitor_count} competitors active. Consider bidding on this keyword.`
    });
  }

  // Sort: gaps first, then by competitor count desc
  gaps.sort((a, b) => {
    if (a.gap_type !== b.gap_type) return a.gap_type === 'gap' ? -1 : 1;
    return b.competitor_count - a.competitor_count;
  });

  return gaps;
}

module.exports = { searchAdvertiser, fetchGoogleAds, fetchCompetitorYouTubeAds, fetchSearchAds, refreshAllCompetitors, getKeywordGaps };
