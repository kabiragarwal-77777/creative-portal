const fs = require('fs');

// ── Competitor ad templates based on real messaging ──────────────────────────
const COMPETITORS = {
  zerodha: {
    vertical: 'broking',
    themes: ['offer','offer','education','feature','trust','feature','education'],
    platforms: ['meta','meta','google','youtube','meta','google'],
    formats: ['video','image','search','video','carousel','image','story'],
    hooks: ['benefit_led','stat_led','benefit_led','story_led','stat_led','benefit_led'],
    headlines: [
      '₹0 brokerage on equity delivery. Forever.',
      'Over 1.5 crore investors trust Zerodha. Why?',
      'India\'s #1 stockbroker. Open free account in 10 min.',
      'Learn investing free on Varsity — 20 lakh students already have.',
      'Flat ₹20 per trade. No hidden charges. Ever.',
      '₹0 brokerage on mutual funds. Invest directly.',
      'Kite — the fastest trading platform in India.',
      'Start your SIP for ₹500/month. No demat charges.',
      'Why pay more? Switch to zero brokerage today.',
      'Trade options at flat ₹20. Zerodha Kite.',
      'Coin — direct mutual funds, zero commission.',
      'Zerodha Streak — algo trading without coding.',
      'Tax P&L report. Auto-calculate your gains.',
      '1.5 crore+ active clients. India\'s largest broker.',
      'Free equity investing. Start with ₹100.',
      'Options chain, Greeks, and more on Kite.',
      'Smallcase investing on Zerodha. Curated portfolios.',
      'GTT orders — set it and forget it.',
      'Zerodha Kite — 3 second order execution.',
      'Pi Bridge — trade from Amibroker, Excel, and more.',
      'No AMC for demat account. Save ₹300/year.',
      'Zerodha — profitable for 12 years straight.',
      'Varsity — free stock market education in Hindi.',
      'Basket orders — buy multiple stocks in one click.',
      'Sensex at all-time high. Are you invested?',
    ],
    ctas: ['Open Free Account','Start Investing','Learn on Varsity','Try Kite','Get Started','Open Account'],
    status_mix: [0.65, 0.35], // 65% active, 35% inactive
  },
  groww: {
    vertical: 'broking',
    themes: ['education','feature','social_proof','offer','trust','feature'],
    platforms: ['meta','meta','youtube','google','meta','instagram'],
    formats: ['video','carousel','video','search','image','story'],
    hooks: ['story_led','benefit_led','stat_led','benefit_led','stat_led'],
    headlines: [
      'Invest in US stocks from India. Starting $1.',
      '5 crore+ Indians invest on Groww. Join them.',
      'Start SIP from ₹1. No paperwork needed.',
      'Mutual funds made simple. Download Groww.',
      'IPO allotment in minutes. Apply on Groww.',
      'Digital gold — buy 24K gold from ₹1.',
      'US ETFs, tech stocks, S&P 500 — all on Groww.',
      'FD at 8.5% interest. Open instantly.',
      '0 commission mutual funds. More returns for you.',
      'Sensex SIP — invest in top 30 companies monthly.',
      'NSE, BSE, MCX — all on one app.',
      'Check your CIBIL score free on Groww.',
      'Groww — SEBI registered. Your money is safe.',
      'Passive investing made easy. Index funds on Groww.',
      'F&O trading with advanced charts.',
      'In-app news and analyst reports. Free.',
      'Smallcase — curated stock baskets from experts.',
      'Gold bonds vs digital gold — what\'s better?',
      'Education + investing = Groww Learn.',
      'Real-time portfolio tracker. See your gains live.',
      '1-tap UPI payments for investments.',
      'PPF calculator, SIP calculator — plan your wealth.',
      'NFO alert — new fund offers on Groww.',
      'Intraday trading at ₹20 flat brokerage.',
      'After-market orders. Place trades anytime.',
    ],
    ctas: ['Download Groww','Start SIP','Invest Now','Open Account','Apply for IPO','Start Free'],
    status_mix: [0.68, 0.32],
  },
  angelone: {
    vertical: 'broking',
    themes: ['feature','trust','offer','social_proof','education','feature'],
    platforms: ['meta','google','youtube','meta','google','linkedin'],
    formats: ['video','search','carousel','image','video','image'],
    hooks: ['stat_led','benefit_led','story_led','stat_led','benefit_led'],
    headlines: [
      'Angel One SmartAPI — build your own trading algo.',
      '2 crore+ clients. India\'s most trusted broker.',
      '₹0 brokerage on delivery trades. Open today.',
      'Research reports from 40+ analysts. Free access.',
      'Angel One ARQ — AI-powered investment engine.',
      'Trade stocks, F&O, commodities on one platform.',
      'One-click investing based on goals and risk profile.',
      'Margin Trading Facility up to 5x leverage.',
      'Angel One Robo — automated SIP recommendations.',
      'Free demat account. No annual charges.',
      'Angel BEE — mutual fund investing app.',
      'IPO grey market premium tracker — live.',
      '15+ years of stock data on advanced charts.',
      'Options strategy builder — covered call, iron condor.',
      'Angel One — NSE, BSE, MCX licensed broker.',
      'Guaranteed account opening in 15 minutes.',
      'Algo trading via SmartAPI — backtested strategies.',
      'Angel One Advisory — personalized stock calls.',
      'Sensex, Nifty50 alerts on your phone.',
      '1-minute, 5-minute, daily charts. All timeframes.',
      'ETF investing — Nifty 50 ETF from ₹100.',
      'F&O margin calculator. Plan your trades.',
      'Market depth — 20 levels on Angel One Pro.',
      'Cash management account — earn on idle funds.',
      'Weekend webinars — learn from SEBI-registered analysts.',
    ],
    ctas: ['Open Free Account','Try SmartAPI','Get Research','Start Investing','Open Account','Join Now'],
    status_mix: [0.60, 0.40],
  },
  upstox: {
    vertical: 'broking',
    themes: ['feature','offer','trust','feature','education','social_proof'],
    platforms: ['meta','google','youtube','meta','instagram','meta'],
    formats: ['video','search','carousel','image','story','video'],
    hooks: ['benefit_led','stat_led','benefit_led','fear_led','stat_led'],
    headlines: [
      'Upstox Pro — charts that professional traders love.',
      '1 crore+ traders. Open account in 3 minutes.',
      'Free delivery trading. Flat ₹20 for intraday.',
      'Options Greeks live on chart. Trade smarter.',
      'Upstox API — build trading bots in Python.',
      'Advanced TradingView charts. 100+ indicators.',
      'Speed matters. 0.01 sec order execution.',
      'Pledge your holdings for option selling margin.',
      'Upstox — backed by Tiger Global and Ratan Tata.',
      'Watch and trade — live market feed.',
      'F&O margin benefit with Upstox SPAN calculator.',
      'Multi-leg F&O orders. Complex strategies simplified.',
      'Upstox Pro Web — trade on desktop like a pro.',
      'Options profit & loss simulator before you trade.',
      'IPO investing — apply in 2 clicks.',
      'US stocks from ₹1. No currency headache.',
      'Instant fund withdrawal. Money in your account same day.',
      'Upstox — SEBI, NSE, BSE, MCX registered.',
      'Free research calls from partnered advisors.',
      'After-hours order placement. GTT orders.',
      'Basket orders — build portfolio in one go.',
      'Screener — filter 5000+ stocks by 50+ parameters.',
      'F&O learning center — free options education.',
      'Portfolio analytics — sector allocation, returns.',
      'Chart pattern recognition powered by AI.',
    ],
    ctas: ['Open Free Account','Try Upstox Pro','Start Trading','Open Account','Download App','Get Access'],
    status_mix: [0.62, 0.38],
  },
  '5paisa': {
    vertical: 'broking',
    themes: ['offer','comparison','feature','offer','trust','education'],
    platforms: ['meta','google','youtube','meta','google'],
    formats: ['search','image','video','carousel','search'],
    hooks: ['stat_led','fear_led','benefit_led','stat_led','benefit_led'],
    headlines: [
      'Pay just 5 paise per trade. India\'s lowest brokerage.',
      'Switch from high brokerage brokers. Save big.',
      '₹999/month unlimited trading plan.',
      '5paisa — IIFL Group. Trusted for 25+ years.',
      'Free trading + 8% on idle cash. Best deal.',
      'Robo advisory — AI picks stocks for you.',
      'Trade stocks, mutual funds, insurance — one app.',
      'Margin funding at lowest interest rates.',
      '5paisa Research — 200+ stock reports monthly.',
      'Digital gold, SGB, FDs — all in one place.',
      'Instant account opening. 100% paperless.',
      'F&O at Rs 20 flat. No percentage brokerage.',
      'Copy trade top investors on 5paisa.',
      '5paisa global — US stocks, ETFs from India.',
      'Free demat account. Zero AMC.',
      'Algo trading platform — 5paisa API.',
      'Market scanner — find breakout stocks daily.',
      'Instant payout — sell today, money today.',
      '5paisa — 35 lakh+ clients and growing.',
      'Research-backed stock recommendations. Free trial.',
    ],
    ctas: ['Switch to 5paisa','Open Account','Start Free Trial','Get ₹999 Plan','Open Free Account'],
    status_mix: [0.58, 0.42],
  },
  dhan: {
    vertical: 'broking',
    themes: ['feature','trust','offer','education','feature','social_proof'],
    platforms: ['meta','youtube','google','meta','instagram'],
    formats: ['video','carousel','search','image','story'],
    hooks: ['benefit_led','stat_led','story_led','benefit_led','stat_led'],
    headlines: [
      'Dhan — built for serious options traders.',
      'Options chain with live Greeks. Trade like a pro.',
      'TradingView inside Dhan. 200+ indicators free.',
      'Option buying and selling from same screen.',
      'Dhan — fastest order execution in India.',
      'OptionTrader — all strategies on one screen.',
      'Bracket orders, cover orders — advanced risk tools.',
      'Dhan TV — live market videos inside your trading app.',
      'Free demat + trading account. No hidden charges.',
      'Instant fund transfer via UPI. Trade immediately.',
      'MTF — use your holdings as margin.',
      'Dhan HeatMap — see which sectors are moving.',
      'Options positions P&L — live calculation.',
      'Dhan — 7 lakh+ traders already switched.',
      'Trade equities, F&O, currency, commodity — all on Dhan.',
      'Real-time alerts for your watchlist stocks.',
      'Dhan API — algo trading made simple.',
      'Chart drawing tools — Fibonacci, Gann, Elliott.',
      'F&O basket — execute multi-leg strategies instantly.',
      'Dark mode trading. Easy on your eyes.',
      'Portfolio rebalancing — auto alerts.',
      'Voice order placement — say it, trade it.',
      'Dhan — backed by Mirae Asset. Trusted capital.',
      'Option expiry calendar and OI data — live.',
      'Dhan for Zerodha users — switch in 48 hours.',
    ],
    ctas: ['Open Free Account','Try Dhan','Switch to Dhan','Download Dhan','Start Trading'],
    status_mix: [0.70, 0.30],
  },
  paytmmoney: {
    vertical: 'broking',
    themes: ['feature','education','trust','offer','feature'],
    platforms: ['meta','google','youtube','meta'],
    formats: ['video','search','image','carousel'],
    hooks: ['benefit_led','stat_led','story_led','benefit_led'],
    headlines: [
      'Invest in NPS. Save up to ₹2 lakh in taxes.',
      'Paytm Money — SIP from ₹100/month.',
      'Direct mutual funds. 0% commission.',
      'Gold ETF + physical gold — both on Paytm Money.',
      'Nifty 50 index fund — the safest long-term bet.',
      'Start equity SIP — invest in top stocks monthly.',
      'Tax saving ELSS funds. Lock 3 years, save tax.',
      'Smart Deposit — higher interest than FD.',
      'Paytm Money Wealth — personalized portfolio.',
      'F&O trading with advanced TradingView charts.',
      'US stocks — invest in Apple, Google from India.',
      'Passive investing via ETFs. Low cost, high returns.',
      '5 crore Paytm users. Now invest too.',
      'Auto SIP — never miss an investment date.',
      'Liquid funds — better than savings account.',
      'Paytm Money — regulated by SEBI.',
      'Goal-based investing — retirement, house, education.',
      'Market holiday calendar, IPO calendar — all in app.',
      'Stocks + MF + NPS — complete wealth app.',
      'P2P lending — earn up to 12% on Paytm Money.',
    ],
    ctas: ['Start Investing','Open Account','Start SIP','Save Tax Now','Invest in NPS'],
    status_mix: [0.55, 0.45],
  },
  samco: {
    vertical: 'ra',
    themes: ['feature','education','offer','trust','feature'],
    platforms: ['meta','google','youtube','linkedin'],
    formats: ['video','search','carousel','image'],
    hooks: ['stat_led','benefit_led','story_led','stat_led'],
    headlines: [
      'StockNote — trade, track, and learn on one platform.',
      'SAMCO — lowest margin rates. Trade more, pay less.',
      'Options hedging strategies. Protect your portfolio.',
      'Rank MF — find the best mutual fund in your category.',
      'SAMCO Free Account — ₹0 brokerage on delivery.',
      'Live market scanner with 150+ technical filters.',
      'Options strategy payoff graph — visualize before you trade.',
      'Intraday leverages up to 20x on select stocks.',
      'Advanced charting — Renko, Heikin Ashi, P&F.',
      'Market maker strategy — earn from bid-ask spread.',
      'SAMCO Wealth — portfolio management service.',
      'F&O margin benefit with span calculator.',
      'Auto square-off protection. Never blow your account.',
      'Risk-reward calculator. Know before you trade.',
      'Options Greeks — Delta, Theta, Gamma live.',
      'SAMCO — SEBI registered since 1993.',
      'Quarterly results screener — find opportunity.',
      'SAMCO API for algo trading.',
      'Backtest your strategy — 10 years of data.',
      'Covered call writing — earn income from your stocks.',
    ],
    ctas: ['Open Free Account','Try StockNote','Start Free Trial','Get Access','Open Account'],
    status_mix: [0.60, 0.40],
  },
  stockgro: {
    vertical: 'ra',
    themes: ['education','social_proof','feature','trust','education'],
    platforms: ['meta','instagram','youtube','meta'],
    formats: ['video','story','carousel','image'],
    hooks: ['story_led','stat_led','benefit_led','story_led'],
    headlines: [
      'Learn investing with ₹1 crore virtual money. Free.',
      '1 crore+ students learning to invest on StockGro.',
      'Compete in stock market leagues. Win real prizes.',
      'StockGro — paper trading before real trading.',
      'Copy portfolios of top investors. Learn by doing.',
      'Stock market courses by IIM and NSE experts.',
      'Earn badges as you learn. Gamified investing.',
      'StockGro — India\'s largest investing community.',
      'Discuss stocks with expert traders. Live.',
      'Portfolio simulator — test any strategy risk-free.',
      'Fundamental analysis made easy. StockGro Learn.',
      'F&O paper trading — practice options without loss.',
      'Stock market quiz — test your knowledge daily.',
      'Investment challenges — 30 days to beat the market.',
      'Social feed — see what top investors are buying.',
      'Mutual fund leaderboard — which funds top the chart.',
      'School student investing program. Start early.',
      'Company analysis templates. Research like a pro.',
      'StockGro leagues — compete with 10 lakh students.',
      'Virtual SIP — practice before going live.',
      'Learn, practice, invest — the StockGro way.',
      'Financial literacy for Gen Z. Free.',
      'StockGro on campus — 500+ colleges.',
      'From zero to investor — 30-day challenge.',
      'Parents investing with their kids — family feature.',
    ],
    ctas: ['Join Free','Start Learning','Play Now','Download App','Join Community','Try Free'],
    status_mix: [0.72, 0.28],
  },
  sensibull: {
    vertical: 'ra',
    themes: ['feature','education','trust','offer','feature'],
    platforms: ['meta','google','youtube','linkedin'],
    formats: ['video','carousel','search','image'],
    hooks: ['stat_led','benefit_led','story_led','stat_led','benefit_led'],
    headlines: [
      'Option strategies without the complexity. Sensibull.',
      'IV Rank and IV Percentile — live on every option.',
      'Build iron condor in 2 clicks. Sensibull.',
      '70% of retail options traders lose money. Don\'t be one.',
      'Max pain calculator — know where price gravitates.',
      'PCR, OI analysis — understand smart money moves.',
      'Sensibull — used by 3 lakh options traders.',
      'Strangle builder — auto-select strikes for best premium.',
      'Theta decay calculator — know your daily cost.',
      'Hedge your portfolio with puts. Auto-calculated.',
      'Strategy payoff chart — see profit zones before trading.',
      'Sensibull Paper Trade — practice options risk-free.',
      'Options screener — filter by IV rank, premium, OI.',
      'Expiry analysis — which strike is safest to sell.',
      'Greeks-based position sizing. Risk management made easy.',
      'Backtesting — how would your strategy have done last year?',
      'Sensibull free trial — 14 days, no credit card.',
      'NIFTY options — which strategy to trade this week.',
      'Option chain with color-coded IV. Spot opportunity.',
      'Sensibull vs Excel sheets — no comparison.',
      'Live options flow — where are the big trades going?',
      'Covered call overlay on your existing portfolio.',
      'Weekly expiry calendar — never miss an expiry.',
      'Option buyer vs seller — who makes money really?',
      'Sensibull — integrated with Zerodha, Upstox, AngelOne.',
    ],
    ctas: ['Try Free','Subscribe','Start Free Trial','Get Sensibull','Try 14 Days Free'],
    status_mix: [0.65, 0.35],
  },
  definedge: {
    vertical: 'ra',
    themes: ['education','feature','trust','feature','education'],
    platforms: ['meta','youtube','google','linkedin'],
    formats: ['video','carousel','image','search'],
    hooks: ['story_led','stat_led','benefit_led','stat_led'],
    headlines: [
      'Renko charts — eliminate noise, see the real trend.',
      'Point & Figure charting — the original trend tool.',
      'Learn technical analysis from Definedge experts.',
      'Definedge Zone — scanner + screener + charts.',
      'Trade-by-trade record keeping. Psychology journal.',
      'Sector rotation — spot where money is flowing.',
      'P&F price targets — objective, math-based.',
      '1000+ recorded webinars. Learn at your pace.',
      'Definedge — 15 years of technical analysis research.',
      'Volume analysis — accumulation and distribution.',
      'Swing trading setups — scanner updates daily.',
      'System trading via Definedge API.',
      'Definedge Analytics — portfolio-level risk report.',
      'CandleGlance — view 50 charts on one screen.',
      'Relative strength — which stocks beat the index?',
      'Options OI chart — track dealer positioning.',
      'Definedge Neo — all-in-one analysis platform.',
      'Elliott Wave analysis with auto-labeling.',
      'Gann square of 9 — price and time analysis.',
      'Definedge subscription — start at ₹499/month.',
    ],
    ctas: ['Start Free Trial','Subscribe Now','Try Definedge','Learn More','Get Access'],
    status_mix: [0.60, 0.40],
  },
  weekendinvesting: {
    vertical: 'ra',
    themes: ['social_proof','education','trust','offer','feature'],
    platforms: ['meta','youtube','linkedin','google'],
    formats: ['video','carousel','image','search'],
    hooks: ['story_led','stat_led','benefit_led','story_led'],
    headlines: [
      'mi100 — momentum investing in top 100 stocks. Automated.',
      'Beat the index without stock picking stress.',
      'WeekendInvesting Alpha — only 2 stocks at a time.',
      '15-minute investing. Rebalance once a week.',
      'Momentum strategies outperform FD by 3x historically.',
      'mi25 — 25 stocks. Maximum diversification, maximum return.',
      'No timing the market. Systematic momentum works.',
      'SEBI RIA — professional advice, low fees.',
      'WeekendInvesting — followed by 50,000 investors.',
      'Alpha Strategies — long/short for all market conditions.',
      'Monthly newsletter — what the strategy holds and why.',
      'YouTube channel — 500+ free investing videos.',
      'mi100 track record — 7 years of live performance.',
      'Momentum investing explained in plain English.',
      'NIFTY vs mi100 — see the comparison.',
      'Low churn — fewer trades, less tax, less effort.',
      'WeekendInvesting — for people who don\'t like stock tips.',
      'Factor investing in Indian markets. Evidence-based.',
      'Retire on momentum — 20-year SIP simulation.',
      'mi500 — broad market exposure with momentum filter.',
      'Flat fee advisory. No AUM percentage.',
      'How to build wealth without watching markets.',
      'Smallcase by WeekendInvesting — direct investing.',
      'No stock tips, no hot calls. Pure systematic.',
      'Family portfolio service — invest together.',
    ],
    ctas: ['Join mi100','Subscribe','Start Free','Follow Strategy','Get Advisory','Learn More'],
    status_mix: [0.68, 0.32],
  },
};

// ── Date generation helpers ──────────────────────────────────────────────────
const TODAY = new Date('2026-03-19');

function randomDate(daysAgoMin, daysAgoMax) {
  const days = Math.floor(Math.random() * (daysAgoMax - daysAgoMin + 1)) + daysAgoMin;
  const d = new Date(TODAY);
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ── Generate ads ─────────────────────────────────────────────────────────────
const SPEND_LEVELS = ['low','medium','medium','high','high','very_high'];
const AUDIENCE_POOL = [
  '22-35 urban professionals','25-40 salaried investors','28-45 HNI traders',
  '18-30 first-time investors','30-50 F&O traders','35-55 wealth managers',
  '20-35 college graduates','25-45 self-employed','30-50 business owners',
  '22-40 tech professionals','28-45 middle-income families','35-60 retirees',
];

let adId = 1;
const allAds = [];

for (const [compId, comp] of Object.entries(COMPETITORS)) {
  const headlineCount = comp.headlines.length;
  // Each competitor gets 20-30 ads
  const adCount = headlineCount;

  for (let i = 0; i < adCount; i++) {
    const isActive = Math.random() < comp.status_mix[0];
    const daysAgoStart = Math.floor(Math.random() * 210) + 3; // 3–213 days ago
    const firstSeen = randomDate(daysAgoStart, daysAgoStart);
    let lastSeen = null;
    if (!isActive) {
      const runDays = Math.floor(Math.random() * 60) + 7;
      const ls = new Date(firstSeen);
      ls.setDate(ls.getDate() + runDays);
      if (ls < TODAY) lastSeen = ls.toISOString().split('T')[0];
      else lastSeen = null; // keep active if end would be future
    }

    const theme = comp.themes[i % comp.themes.length];
    const platform = comp.platforms[i % comp.platforms.length];
    const format = comp.formats[i % comp.formats.length];
    const hookStyle = comp.hooks[i % comp.hooks.length];
    const headline = comp.headlines[i % headlineCount];
    const cta = pick(comp.ctas);

    allAds.push(
      `  {id:'ad_${String(adId).padStart(3,'0')}', competitorId:'${compId}', platform:'${platform}', format:'${format}', theme:'${theme}', hookStyle:'${hookStyle}', status:'${isActive && !lastSeen ? 'active' : 'inactive'}', headline:${JSON.stringify(headline)}, cta:${JSON.stringify(cta)}, firstSeen:'${firstSeen}', lastSeen:${lastSeen ? `'${lastSeen}'` : 'null'}, estimatedSpend:'${pick(SPEND_LEVELS)}', targetAudience:${JSON.stringify(pick(AUDIENCE_POOL))}}`
    );
    adId++;
  }
}

console.log(`Generated ${allAds.length} ads across ${Object.keys(COMPETITORS).length} competitors`);

// Count per competitor
const counts = {};
allAds.forEach(ad => {
  const m = ad.match(/competitorId:'(\w+)'/);
  if(m) counts[m[1]] = (counts[m[1]]||0)+1;
});
console.log('Per competitor:', JSON.stringify(counts));

const activeCount = allAds.filter(a => a.includes("status:'active'")).length;
console.log('Active:', activeCount, '/', allAds.length);

// ── Inject into HTML ─────────────────────────────────────────────────────────
let html = fs.readFileSync('C:/Users/Dell/Desktop/creative-portal/univest_ci_portal.html', 'utf8');

// Find and replace the ads array
const adsStart = html.indexOf('ads: [');
const adsEnd = html.indexOf('],\n\ncampaigns:');
if (adsStart === -1 || adsEnd === -1) {
  console.error('ERROR: could not find ads array boundaries');
  process.exit(1);
}

const before = html.slice(0, adsStart);
const after = html.slice(adsEnd);
const newAdsBlock = `ads: [\n${allAds.join(',\n')}\n]`;

html = before + newAdsBlock + after;
fs.writeFileSync('C:/Users/Dell/Desktop/creative-portal/univest_ci_portal.html', html);
console.log('Injected into HTML. File size:', (html.length/1024).toFixed(1)+'KB');
