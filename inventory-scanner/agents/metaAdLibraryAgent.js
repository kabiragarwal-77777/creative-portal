const { getDb } = require('../database/db');
const { v4: uuidv4 } = require('uuid');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

  // Attempt Meta Ad Library API (will fail without valid token, falls back to mock)
  try {
    const axios = require('axios');
    const accessToken = process.env.META_AD_LIBRARY_TOKEN;
    if (!accessToken) throw new Error('No META_AD_LIBRARY_TOKEN configured');

    const response = await axios.get('https://graph.facebook.com/v18.0/ads_archive', {
      params: {
        search_terms: competitorName,
        ad_reached_countries: 'IN',
        ad_type: 'FINANCIAL_PRODUCTS_AND_SERVICES',
        fields: 'id,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,publisher_platforms,media_type,spend',
        limit: limit,
        access_token: accessToken
      }
    });

    if (response.data && response.data.data) {
      ads = response.data.data.map(ad => ({
        meta_ad_id: ad.id,
        headline: (ad.ad_creative_link_titles || []).join(' | ') || '',
        body: (ad.ad_creative_bodies || []).join(' ') || '',
        platform_list: (ad.publisher_platforms || []).join(','),
        media_type: ad.media_type || 'image',
        spend_min: ad.spend ? ad.spend.lower_bound : 0,
        spend_max: ad.spend ? ad.spend.upper_bound : 0,
        start_date: ad.ad_delivery_start_time || null,
        end_date: ad.ad_delivery_stop_time || null,
        is_active: ad.ad_delivery_stop_time ? 0 : 1,
        run_days: ad.ad_delivery_start_time ? Math.floor((Date.now() - new Date(ad.ad_delivery_start_time).getTime()) / 86400000) : 0,
        theme_tag: null
      }));
    }
  } catch (err) {
    console.error(`[MetaAdLibrary] API fetch failed for ${competitorName}, using mock data:`, err.message);
    // Fall back to mock data
    const mockAds = MOCK_ADS_BY_COMPETITOR[competitorName] || MOCK_ADS_BY_COMPETITOR['Groww'];
    const startBase = new Date();
    startBase.setDate(startBase.getDate() - 90);

    ads = mockAds.slice(0, limit).map((ad, idx) => {
      const startDate = new Date(startBase);
      startDate.setDate(startDate.getDate() + idx * 5);
      const endDate = ad.is_active ? null : new Date(startDate.getTime() + ad.run_days * 86400000);

      return {
        meta_ad_id: `mock_${competitorName.toLowerCase().replace(/\s+/g, '_')}_${idx + 1}`,
        headline: ad.headline,
        body: ad.body,
        platform_list: ad.platform_list,
        media_type: ad.media_type,
        spend_min: ad.spend_min,
        spend_max: ad.spend_max,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate ? endDate.toISOString().split('T')[0] : null,
        is_active: ad.is_active,
        run_days: ad.run_days,
        theme_tag: ad.theme_tag
      };
    });
  }

  // Get or create competitor record
  let competitor = db.prepare('SELECT id FROM competitors WHERE LOWER(name) = LOWER(?)').get(competitorName);
  if (!competitor) {
    const compId = uuidv4();
    db.prepare('INSERT INTO competitors (id, name, vertical, created_at) VALUES (?, ?, ?, datetime(\'now\'))').run(compId, competitorName, 'fintech');
    competitor = { id: compId };
  }

  // Classify themes and store
  for (const ad of ads) {
    if (!ad.theme_tag) {
      ad.theme_tag = await classifyAdTheme(`${ad.headline} ${ad.body}`);
    }

    // Check for duplicate
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
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Classify the following ad text into exactly ONE theme from this list:
Offer/Discount, Social Proof, Fear/FOMO, Education, Feature Highlight, Celebrity, Comparison, Free Trial, Testimonial, Trust/SEBI, App Install, Referral

Return ONLY the theme name, nothing else.`
        },
        { role: 'user', content: adText }
      ],
      temperature: 0,
      max_tokens: 20
    });

    const theme = response.choices[0].message.content.trim();
    const validThemes = Object.keys(THEME_KEYWORDS);
    if (validThemes.includes(theme)) return theme;
    return 'Feature Highlight';
  } catch (err) {
    // Fallback to keyword matching
    const textLower = adText.toLowerCase();
    let bestTheme = 'Feature Highlight';
    let bestScore = 0;

    for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
      const score = keywords.filter(kw => textLower.includes(kw)).length;
      if (score > bestScore) {
        bestScore = score;
        bestTheme = theme;
      }
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

async function refreshAllCompetitors() {
  const db = getDb();
  const competitors = db.prepare('SELECT name FROM competitors').all();
  const results = [];

  for (const comp of competitors) {
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
    FROM meta_ads
    WHERE theme_tag IS NOT NULL
    GROUP BY theme_tag
    ORDER BY count DESC
  `).all();

  const platformCounts = db.prepare(`
    SELECT platform_list, COUNT(*) as count
    FROM meta_ads
    GROUP BY platform_list
    ORDER BY count DESC
  `).all();

  const mediaTypeCounts = db.prepare(`
    SELECT media_type, COUNT(*) as count,
           ROUND(AVG(run_days), 1) as avg_run_days
    FROM meta_ads
    GROUP BY media_type
    ORDER BY count DESC
  `).all();

  return {
    theme_distribution: themeCounts,
    platform_distribution: platformCounts,
    media_type_distribution: mediaTypeCounts,
    top_theme: themeCounts.length > 0 ? themeCounts[0].theme_tag : null,
    top_platform: platformCounts.length > 0 ? platformCounts[0].platform_list : null,
    dominant_media: mediaTypeCounts.length > 0 ? mediaTypeCounts[0].media_type : null
  };
}

function getSpendSignals() {
  return extractSpendSignals();
}

module.exports = {
  fetchMetaAds, classifyAdTheme, detectLongRunningAds, extractSpendSignals,
  refreshAllCompetitors, getAdsByCompetitor, getTrends, getSpendSignals
};
