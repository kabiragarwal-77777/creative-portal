const GOOGLE_POLICY_URL = 'https://support.google.com/adspolicy/answer/12390454?hl=en';
const GOOGLE_CAMPAIGN_URL = 'https://ads.google.com/aw/campaigns';
const META_ADS_MANAGER_URL = 'https://adsmanager.facebook.com/';
const LINKEDIN_CAMPAIGN_URL = 'https://www.linkedin.com/campaignmanager/';
const TABOOLA_CAMPAIGN_URL = 'https://ads.taboola.com/';
const OUTBRAIN_CAMPAIGN_URL = 'https://my.outbrain.com/';
const JIOHOTSTAR_CONTACT_URL = 'https://ads.hotstar.com/contact-us/';
const NSE_AD_CODE_URL = 'https://www.nseindia.com/trade/members-code-of-advertisement';
const BSE_AD_FAQ_URL = 'https://www.bseindia.com/downloads1/Advertisement_FAQ.pdf';
const DEFAULT_COMPETITORS = ['Motilal Oswal', 'ICICI Direct', 'Mirae Asset', 'Axis MF', 'SBI MF'];

function competitorsFor(entry) {
  switch (entry.inventory_id) {
    case 'google-search':
      return ['Motilal Oswal', 'ICICI Direct', 'Angel One', 'Zerodha', 'Upstox'];
    case 'google-demand-gen':
    case 'google-display-network':
    case 'google-performance-max':
    case 'youtube-skippable':
    case 'youtube-bumper':
    case 'youtube-shorts':
      return ['Motilal Oswal', 'ICICI Direct', 'Angel One', 'Groww', 'Axis Direct'];
    case 'facebook-feed':
    case 'instagram-feed':
    case 'instagram-reels':
    case 'meta-audience-network':
    case 'meta-advantage-plus':
      return ['Motilal Oswal', 'ICICI Direct', 'Axis MF', 'SBI MF', 'Nippon India MF'];
    case 'linkedin-sponsored-content':
    case 'linkedin-message-ads':
      return ['HDFC Securities', 'ICICI Direct', 'Kotak Securities', 'Motilal Oswal', 'Groww'];
    case 'moneycontrol':
    case 'economic-times':
    case 'mint-display':
    case 'business-standard':
    case 'ndtv-profit':
    case 'value-research-online':
    case 'times-of-india':
      return ['HDFC Mutual Fund', 'ICICI Prudential AMC', 'SBI MF', 'Axis MF', 'Nippon India MF'];
    case 'livemint-newsletter':
      return ['Motilal Oswal', 'ICICI Direct', 'HDFC Mutual Fund', 'SBI MF', 'Kotak Mutual Fund'];
    case 'jiocinema-preroll':
    case 'hotstar-preroll':
    case 'spotify-audio':
      return ['Motilal Oswal', 'ICICI Direct', 'Angel One', 'HDFC Securities', 'SBI MF'];
    case 'bse-nse-investor-portal':
      return ['Motilal Oswal', 'ICICI Direct', 'Angel One', 'Zerodha', 'Kotak Securities'];
    case 'taboola':
    case 'outbrain':
      return ['Motilal Oswal', 'ICICI Direct', 'Angel One', 'SBI MF', 'Axis MF'];
    default:
      return DEFAULT_COMPETITORS;
  }
}

function band(low, mid, high) {
  return { low, mid, high };
}

function inventory(entry) {
  return {
    currency: 'INR',
    financial_advisory_eligible: true,
    ...entry,
    competitors_active: Array.isArray(entry.competitors_active) && entry.competitors_active.length
      ? entry.competitors_active
      : competitorsFor(entry),
    benchmark_confidence: entry.benchmark_confidence || 'medium'
  };
}

const COMMON_SEBI_NOTE =
  'Show SEBI registration details, fair-risk language, and no assured-return claims.';

const CURATED_INVENTORIES = [
  inventory({
    inventory_id: 'google-search',
    name: 'Google Search',
    platform: 'Google',
    buy_type: 'self-serve',
    primary_cost_model: 'CPC',
    cost_model: ['CPC', 'CPL'],
    pricing: { CPC: band(28, 55, 120) },
    min_budget: 10000,
    ctr_benchmark: band(4.5, 6.5, 8.5),
    audience_quality_score: 10,
    pricing_source_note: 'India PPC benchmark plus finance-category economics.',
    pricing_source_urls: ['https://www.themediaant.com/digital?pricingModels=CPC', 'https://backlinko.com/how-much-does-google-ads-cost'],
    sebi_compliance_note: 'Google may require financial-services verification; keep ad and landing-page disclosures aligned.',
    how_to_start: 'Create a Search campaign in Google Ads; target advisory-intent keywords; add disclosure assets; complete verification if prompted; send traffic to a compliant lead page.',
    start_url: GOOGLE_CAMPAIGN_URL,
    access_notes: 'Self-serve in Google Ads.',
    time_to_go_live: '24-48 hours',
    google_networks: ['SEARCH', 'SEARCH_PARTNERS'],
    google_campaign_types: ['SEARCH']
  }),
  inventory({
    inventory_id: 'google-demand-gen',
    name: 'Google Discovery / Demand Gen',
    platform: 'Google',
    buy_type: 'self-serve',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'CPC', 'CPL'],
    pricing: { CPM: band(60, 110, 180) },
    min_budget: 15000,
    ctr_benchmark: band(0.8, 1.2, 1.8),
    audience_quality_score: 8,
    pricing_source_note: 'Demand Gen inferred from Google visual surfaces and India display/video benchmarks.',
    pricing_source_urls: ['https://support.google.com/google-ads/answer/13695777?hl=en-IN', 'https://www.themediaant.com/digital/google-display-advertising', 'https://www.themediaant.com/blog/how-much-do-youtube-ads-cost/'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Google visual-surface policy review still applies.`,
    how_to_start: 'Create a Demand Gen campaign; upload image and short video assets; seed investor lookalikes; exclude rival interests; point traffic to a compliant lead page.',
    start_url: GOOGLE_CAMPAIGN_URL,
    access_notes: 'Self-serve in Google Ads.',
    time_to_go_live: '24-48 hours',
    google_networks: ['DISCOVER', 'GMAIL'],
    google_campaign_types: ['DEMAND_GEN']
  }),
  inventory({
    inventory_id: 'google-display-network',
    name: 'Google Display Network (financial content placements only)',
    platform: 'Google',
    buy_type: 'self-serve',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'CPC', 'CPL'],
    pricing: { CPM: band(80, 150, 300) },
    min_budget: 15000,
    ctr_benchmark: band(0.35, 0.6, 0.9),
    audience_quality_score: 7,
    pricing_source_note: 'India Google Display and programmatic CPM guidance.',
    pricing_source_urls: ['https://www.themediaant.com/digital/google-display-advertising', 'https://www.themediaant.com/digital/programmatic-platforms-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Restrict placements to approved finance/business inventory only.`,
    how_to_start: 'Create a Display campaign; use managed placements for finance publishers; exclude low-quality inventory; start with lead-form or landing-page optimization.',
    start_url: GOOGLE_CAMPAIGN_URL,
    access_notes: 'Self-serve in Google Ads.',
    time_to_go_live: '24-48 hours',
    google_networks: ['CONTENT'],
    google_campaign_types: ['DISPLAY']
  }),
  inventory({
    inventory_id: 'youtube-skippable',
    name: 'YouTube Skippable In-Stream',
    platform: 'Google',
    buy_type: 'self-serve',
    primary_cost_model: 'CPV',
    cost_model: ['CPV', 'CPM', 'CPL'],
    pricing: { CPV: band(0.75, 1.5, 3), CPM: band(50, 90, 140) },
    min_budget: 15000,
    ctr_benchmark: band(0.45, 0.7, 1.1),
    audience_quality_score: 8,
    pricing_source_note: 'India YouTube skippable CPV and CPM guidance.',
    pricing_source_urls: ['https://www.themediaant.com/blog/how-much-do-youtube-ads-cost/', 'https://www.themediaant.com/digital/youtube-advertising/video'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Video disclaimer should remain readable on-screen.`,
    how_to_start: 'Build a Video Reach or Demand Gen campaign; upload a 15-30 second explainer; add a compliant CTA; retarget viewers who watched at least 25 percent.',
    start_url: GOOGLE_CAMPAIGN_URL,
    access_notes: 'Self-serve in Google Ads.',
    time_to_go_live: '24-48 hours',
    google_networks: ['YOUTUBE'],
    google_campaign_types: ['VIDEO']
  }),
  inventory({
    inventory_id: 'youtube-bumper',
    name: 'YouTube Non-Skippable (6s Bumper)',
    platform: 'Google',
    buy_type: 'self-serve',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'CPV'],
    pricing: { CPM: band(70, 120, 180), CPV: band(0.6, 1.2, 2.2) },
    min_budget: 20000,
    ctr_benchmark: band(0.15, 0.25, 0.4),
    audience_quality_score: 7,
    pricing_source_note: 'India bumper and non-skippable video guidance.',
    pricing_source_urls: ['https://www.themediaant.com/blog/how-much-do-youtube-ads-cost/', 'https://www.themediaant.com/digital/youtube-advertising/video'],
    sebi_compliance_note: 'Use a short brand or reminder message only; disclaimer text still needs to be legible.',
    how_to_start: 'Launch a bumper sequence for recall; use a compliance-safe supers template; pair it with Search or Demand Gen retargeting to capture demand.',
    start_url: GOOGLE_CAMPAIGN_URL,
    access_notes: 'Self-serve in Google Ads.',
    time_to_go_live: '24-48 hours',
    google_networks: ['YOUTUBE'],
    google_campaign_types: ['VIDEO']
  }),
  inventory({
    inventory_id: 'youtube-shorts',
    name: 'YouTube Shorts',
    platform: 'Google',
    buy_type: 'self-serve',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'CPC', 'CPV', 'CPL'],
    pricing: { CPM: band(40, 70, 110) },
    min_budget: 15000,
    ctr_benchmark: band(0.5, 0.8, 1.2),
    audience_quality_score: 6,
    pricing_source_note: 'Shorts benchmark inferred from Demand Gen reach notes and India video CPM ranges.',
    pricing_source_urls: ['https://support.google.com/google-ads/answer/13695777?hl=en-IN', 'https://www.themediaant.com/blog/how-much-do-youtube-ads-cost/'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Use educational hooks, not sensational outcome claims.`,
    how_to_start: 'Upload vertical 9:16 assets; keep the first two seconds strong; use lead-focused landing pages or retargeting paths after engagement.',
    start_url: GOOGLE_CAMPAIGN_URL,
    access_notes: 'Self-serve in Google Ads.',
    time_to_go_live: '24-48 hours',
    google_networks: ['YOUTUBE'],
    google_campaign_types: ['VIDEO', 'DEMAND_GEN']
  }),
  inventory({
    inventory_id: 'facebook-feed',
    name: 'Meta Facebook Feed',
    platform: 'Meta',
    buy_type: 'self-serve',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'CPC', 'CPL'],
    pricing: { CPM: band(90, 130, 220) },
    min_budget: 10000,
    ctr_benchmark: band(0.7, 1.0, 1.4),
    audience_quality_score: 8,
    benchmark_confidence: 'high',
    pricing_source_note: 'Blend of India Meta benchmark guidance and Univest live Facebook Feed CPMs.',
    pricing_source_urls: ['https://www.themediaant.com/digital/facebook-advertising', 'https://www.themediaant.com/digital/digital-advertising-under-40k-budget-advertising/meta-ads'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Meta may reject exaggerated returns or vague finance claims.`,
    how_to_start: 'Open Ads Manager; use Feed-only placement; set a lead objective; upload compliant image or video creative; route to a disclosure-complete landing page or instant form.',
    start_url: META_ADS_MANAGER_URL,
    access_notes: 'Self-serve in Meta Ads Manager.',
    time_to_go_live: '24-48 hours',
    meta_placements: ['facebook_feed']
  }),
  inventory({
    inventory_id: 'instagram-feed',
    name: 'Meta Instagram Feed',
    platform: 'Meta',
    buy_type: 'self-serve',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'CPC', 'CPL'],
    pricing: { CPM: band(110, 150, 240) },
    min_budget: 10000,
    ctr_benchmark: band(1.1, 1.5, 1.9),
    audience_quality_score: 7,
    benchmark_confidence: 'high',
    pricing_source_note: 'Blend of India Instagram benchmark guidance and Univest live Instagram Feed CPMs.',
    pricing_source_urls: ['https://www.themediaant.com/digital/instagram-advertising', 'https://www.themediaant.com/digital/digital-advertising-under-40k-budget-advertising/meta-ads'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Keep the disclaimer visible inside the creative because feed consumption is fast.`,
    how_to_start: 'Use Ads Manager with Instagram Feed placement; start with a concise educational creative; connect to a form or landing page that repeats the regulatory disclosure.',
    start_url: META_ADS_MANAGER_URL,
    access_notes: 'Self-serve in Meta Ads Manager.',
    time_to_go_live: '24-48 hours',
    meta_placements: ['instagram_feed']
  }),
  inventory({
    inventory_id: 'instagram-reels',
    name: 'Instagram Reels',
    platform: 'Meta',
    buy_type: 'self-serve',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'CPC', 'CPL'],
    pricing: { CPM: band(85, 110, 180) },
    min_budget: 10000,
    ctr_benchmark: band(0.35, 0.6, 0.9),
    audience_quality_score: 7,
    benchmark_confidence: 'high',
    pricing_source_note: 'Blend of India Instagram benchmark guidance and Univest live Reels CPMs.',
    pricing_source_urls: ['https://www.themediaant.com/digital/instagram-advertising', 'https://www.themediaant.com/digital/digital-advertising-under-40k-budget-advertising/meta-ads'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Use educational hooks and avoid sensational before-versus-after wealth narratives.`,
    how_to_start: 'Run vertical 9:16 video through Ads Manager; keep Reels placement only; pair the creative with clear disclosure overlays and a clean lead capture experience.',
    start_url: META_ADS_MANAGER_URL,
    access_notes: 'Self-serve in Meta Ads Manager.',
    time_to_go_live: '24-48 hours',
    meta_placements: ['instagram_instagram_reels']
  }),
  inventory({
    inventory_id: 'meta-audience-network',
    name: 'Meta Audience Network (whitelisted placements only)',
    platform: 'Meta',
    buy_type: 'self-serve',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'CPC', 'CPL'],
    pricing: { CPM: band(150, 220, 360) },
    min_budget: 10000,
    ctr_benchmark: band(2.5, 5.0, 8.5),
    audience_quality_score: 5,
    benchmark_confidence: 'high',
    pricing_source_note: 'Anchored to Univest live Audience Network CPM and CPC data with whitelist-only use.',
    pricing_source_urls: ['https://www.themediaant.com/digital/facebook-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Use a strict whitelist and exclude low-intent inventory to avoid bad context.`,
    how_to_start: 'Activate Audience Network only inside a monitored Meta ad set; use a safe publisher allowlist; shut off placements that generate cheap but low-intent traffic.',
    start_url: META_ADS_MANAGER_URL,
    access_notes: 'Managed inside Meta Ads Manager with whitelist discipline.',
    time_to_go_live: '24-48 hours',
    meta_placements: ['audience_network_an_classic', 'audience_network_rewarded_video']
  }),
  inventory({
    inventory_id: 'linkedin-sponsored-content',
    name: 'LinkedIn Sponsored Content',
    platform: 'LinkedIn',
    buy_type: 'self-serve',
    primary_cost_model: 'CPC',
    cost_model: ['CPM', 'CPC', 'CPL'],
    pricing: { CPM: band(200, 440, 550), CPC: band(70, 100, 150), CPL: band(1800, 2400, 3200) },
    min_budget: 10000,
    ctr_benchmark: band(0.45, 0.7, 1.0),
    audience_quality_score: 9,
    pricing_source_note: 'LinkedIn India rates from Media Ant and professional-targeting benchmarks.',
    pricing_source_urls: ['https://www.themediaant.com/digital/linkedin-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Keep copy factual and targeted to education or consultation, not trading-style urgency.`,
    how_to_start: 'Open Campaign Manager; choose Sponsored Content; target finance professionals and high-income business audiences; use a form or landing page with advisory credentials up front.',
    start_url: LINKEDIN_CAMPAIGN_URL,
    access_notes: 'Self-serve in LinkedIn Campaign Manager.',
    time_to_go_live: '24-48 hours'
  }),
  inventory({
    inventory_id: 'linkedin-message-ads',
    name: 'LinkedIn Message Ads (InMail)',
    platform: 'LinkedIn',
    buy_type: 'self-serve',
    primary_cost_model: 'CPC',
    cost_model: ['CPC', 'CPL'],
    pricing: { CPC: band(60, 66, 110), CPL: band(2200, 3200, 4800) },
    min_budget: 10000,
    ctr_benchmark: band(1.2, 2.0, 3.0),
    audience_quality_score: 8,
    pricing_source_note: 'LinkedIn Sponsored InMail benchmark from Media Ant plus India professional lead-gen pricing.',
    pricing_source_urls: ['https://www.themediaant.com/digital/linkedin-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Message copy must stay consultative and avoid personalized return promises.`,
    how_to_start: 'Use Message Ads or Conversation Ads in Campaign Manager; target a narrow professional segment; send a compliance-safe consultation offer with explicit firm credentials.',
    start_url: LINKEDIN_CAMPAIGN_URL,
    access_notes: 'Self-serve in LinkedIn Campaign Manager.',
    time_to_go_live: '24-48 hours'
  }),
  inventory({
    inventory_id: 'moneycontrol',
    name: 'Moneycontrol Display & Native',
    platform: 'Direct Buy',
    buy_type: 'direct',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'Fixed'],
    pricing: { CPM: band(87, 174, 348), Fixed: band(348000, 464500, 581000) },
    min_budget: 348000,
    ctr_benchmark: band(0.45, 0.7, 1.0),
    audience_quality_score: 10,
    benchmark_confidence: 'high',
    pricing_source_note: 'Moneycontrol banner, video, roadblock, and article rates from Media Ant.',
    pricing_source_urls: ['https://www.themediaant.com/digital/money-control-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Native content must be clearly labeled sponsored and should not read like unverified stock advice.`,
    how_to_start: 'Request the Moneycontrol media kit; choose banner or sponsored-content inventory; submit compliance-cleared creative; confirm business-news adjacency before launch.',
    start_url: 'https://www.themediaant.com/digital/money-control-advertising',
    access_notes: 'Direct buy or managed marketplace booking.',
    time_to_go_live: '3-5 business days'
  }),
  inventory({
    inventory_id: 'economic-times',
    name: 'Economic Times (ET) Display & Sponsored Content',
    platform: 'Direct Buy',
    buy_type: 'direct',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'Fixed'],
    pricing: { CPM: band(103, 180, 260), Fixed: band(139700, 258500, 658350) },
    min_budget: 139700,
    ctr_benchmark: band(0.35, 0.55, 0.8),
    audience_quality_score: 9,
    benchmark_confidence: 'high',
    pricing_source_note: 'ET banner, article, listicle, and roadblock rates from Media Ant.',
    pricing_source_urls: ['https://www.themediaant.com/digital/economic-times-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Sponsored content should stay educational and prominently labeled.`,
    how_to_start: 'Request ET digital inventory; pick banner or sponsored article units; share approved claims and disclaimers; ask for business or markets adjacency.',
    start_url: 'https://www.themediaant.com/digital/economic-times-advertising',
    access_notes: 'Managed or direct-buy placement.',
    time_to_go_live: '3-5 business days'
  }),
  inventory({
    inventory_id: 'mint-display',
    name: 'Mint (HT Media) Display',
    platform: 'Direct Buy',
    buy_type: 'direct',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'Fixed'],
    pricing: { CPM: band(94, 140, 220), Fixed: band(69000, 348000, 1040000) },
    min_budget: 69000,
    ctr_benchmark: band(0.4, 0.65, 0.9),
    audience_quality_score: 9,
    pricing_source_note: 'Livemint marketplace rates used as the HT Media digital benchmark for Mint display.',
    pricing_source_urls: ['https://www.themediaant.com/digital/livemint-advertising/social-media-post', 'https://www.themediaant.com/digital/livemint-advertising/article'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Keep premium-publisher creatives conservative and evidence-based.`,
    how_to_start: 'Request HT Media digital placements for Mint; choose banner inventory; provide approved creative and disclaimer copy; ask for business-news section priority.',
    start_url: 'https://www.themediaant.com/digital/livemint-advertising/social-media-post',
    access_notes: 'Direct HT Media buy or managed marketplace booking.',
    time_to_go_live: '3-5 business days'
  }),
  inventory({
    inventory_id: 'business-standard',
    name: 'Business Standard Digital',
    platform: 'Direct Buy',
    buy_type: 'direct',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'Fixed'],
    pricing: { CPM: band(94, 103, 160), Fixed: band(197000, 216700, 697000) },
    min_budget: 197000,
    ctr_benchmark: band(0.35, 0.5, 0.75),
    audience_quality_score: 8,
    benchmark_confidence: 'high',
    pricing_source_note: 'Business Standard digital banner, article, and roadblock rates from Media Ant.',
    pricing_source_urls: ['https://www.themediaant.com/digital/business-standard-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Sponsored content should be plainly marked and fact-based.`,
    how_to_start: 'Request Business Standard digital inventory; select banner or article inventory; send approved creative and landing page; confirm finance-news adjacency.',
    start_url: 'https://www.themediaant.com/digital/business-standard-advertising',
    access_notes: 'Direct or managed marketplace buy.',
    time_to_go_live: '3-5 business days'
  }),
  inventory({
    inventory_id: 'ndtv-profit',
    name: 'NDTV Profit Display',
    platform: 'Direct Buy',
    buy_type: 'direct',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'Fixed'],
    pricing: { CPM: band(94, 103, 217), Fixed: band(209000, 325000, 357500) },
    min_budget: 209000,
    ctr_benchmark: band(0.3, 0.45, 0.7),
    audience_quality_score: 8,
    pricing_source_note: 'NDTV digital benchmark used as the NDTV Profit proxy due shared premium news inventory.',
    pricing_source_urls: ['https://www.themediaant.com/digital/ndtv-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Use business-news-safe messaging and no speculative trading claims.`,
    how_to_start: 'Request NDTV Profit or NDTV business inventory; lock banner or video inventory; submit approved creative; confirm finance or markets adjacency.',
    start_url: 'https://www.themediaant.com/digital/ndtv-advertising',
    access_notes: 'Direct buy with publisher or managed marketplace.',
    time_to_go_live: '3-5 business days'
  }),
  inventory({
    inventory_id: 'value-research-online',
    name: 'Value Research Online (direct buy)',
    platform: 'Direct Buy',
    buy_type: 'direct',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'Fixed'],
    pricing: { CPM: band(120, 180, 260), Fixed: band(100000, 175000, 300000) },
    min_budget: 100000,
    ctr_benchmark: band(0.6, 0.9, 1.3),
    audience_quality_score: 10,
    benchmark_confidence: 'low',
    pricing_source_note: 'No public Value Research rate card surfaced; pricing inferred from premium finance-publisher display bands.',
    pricing_source_urls: ['https://www.themediaant.com/digital/money-control-advertising', 'https://www.themediaant.com/digital/economic-times-advertising', 'https://www.themediaant.com/digital/livemint-advertising/social-media-post'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Keep copy educational and avoid stock-tip framing on a research-led audience environment.`,
    how_to_start: 'Reach out through Value Research commercial or editorial contacts for sponsorship availability; request desktop and newsletter options; confirm legal review before launch.',
    start_url: 'https://www.valueresearchonline.com/',
    access_notes: 'Direct publisher outreach required.',
    time_to_go_live: '5-7 business days'
  }),
  inventory({
    inventory_id: 'livemint-newsletter',
    name: 'Livemint Newsletter Sponsorship',
    platform: 'Direct Buy',
    buy_type: 'direct',
    primary_cost_model: 'Fixed',
    cost_model: ['Fixed', 'CPM'],
    pricing: { CPM: band(180, 260, 420), Fixed: band(90000, 175000, 325000) },
    min_budget: 90000,
    ctr_benchmark: band(1.2, 2.0, 3.0),
    audience_quality_score: 9,
    benchmark_confidence: 'low',
    pricing_source_note: 'Newsletter sponsorship benchmark inferred from Livemint premium rates plus India email/newsletter entry pricing.',
    pricing_source_urls: ['https://www.themediaant.com/digital/livemint-advertising/social-media-post', 'https://www.themediaant.com/digital?categories=Advertising+And+Marketing'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Newsletter copy must disclose the advisory identity immediately.`,
    how_to_start: 'Request the Livemint newsletter sponsorship menu; choose a markets or business slot; supply a disclaimer-safe sponsor block; link to a compliant lead page.',
    start_url: 'https://www.themediaant.com/digital/livemint-advertising/social-media-post',
    access_notes: 'Direct publisher or managed marketplace booking.',
    time_to_go_live: '3-5 business days'
  }),
  inventory({
    inventory_id: 'jiocinema-preroll',
    name: 'JioCinema Pre-Roll',
    platform: 'Direct Buy',
    buy_type: 'direct',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'CPV', 'Fixed'],
    pricing: { CPM: band(125, 175, 225), CPV: band(0.8, 1.6, 2.8) },
    min_budget: 100000,
    ctr_benchmark: band(0.2, 0.35, 0.6),
    audience_quality_score: 6,
    pricing_source_note: 'JioCinema video benchmark from JioHotstar/JioCinema planning pages and IPL inventory guidance.',
    pricing_source_urls: ['https://www.themediaant.com/blog/advertisers-leverage-ad-options-jiocinema-app-wpl-ipl-2024/', 'https://www.themediaant.com/digital/star-maa-jiohotstar-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Keep messaging educational and avoid live-trading style claims.`,
    how_to_start: 'Request pre-roll inventory on relevant finance, business, or premium-content clusters; submit a six to fifteen second compliance-safe video; confirm contextual adjacency.',
    start_url: 'https://www.themediaant.com/blog/advertisers-leverage-ad-options-jiocinema-app-wpl-ipl-2024/',
    access_notes: 'Publisher-managed video buy.',
    time_to_go_live: '3-5 business days'
  }),
  inventory({
    inventory_id: 'hotstar-preroll',
    name: 'Hotstar / Disney+ Hotstar Pre-Roll',
    platform: 'Direct Buy',
    buy_type: 'direct',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'CPV', 'Fixed'],
    pricing: { CPM: band(125, 175, 225), CPV: band(0.8, 1.6, 2.8) },
    min_budget: 100000,
    ctr_benchmark: band(0.2, 0.32, 0.55),
    audience_quality_score: 7,
    benchmark_confidence: 'high',
    pricing_source_note: 'JioHotstar video rates from official Jiostar terms/contact path and Media Ant rate cards.',
    pricing_source_urls: ['https://ads.hotstar.com/advertising-services-agreement-march-21-2025', 'https://ads.hotstar.com/contact-us/', 'https://www.themediaant.com/digital/star-maa-jiohotstar-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Use awareness or education creative, not speculative trading language.`,
    how_to_start: 'Contact Jiostar ad sales; reserve pre-roll inventory; align the video cut to the selected content cluster; clear the disclaimer treatment before launch.',
    start_url: JIOHOTSTAR_CONTACT_URL,
    access_notes: 'Publisher-managed Jiostar inventory.',
    time_to_go_live: '3-5 business days'
  }),
  inventory({
    inventory_id: 'spotify-audio',
    name: 'Spotify Audio Ads (India)',
    platform: 'Direct Buy',
    buy_type: 'direct',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'CPV'],
    pricing: { CPM: band(113, 124, 200), CPV: band(0.6, 1.2, 2) },
    min_budget: 100000,
    ctr_benchmark: band(0.15, 0.25, 0.4),
    audience_quality_score: 6,
    benchmark_confidence: 'high',
    pricing_source_note: 'Spotify India audio and video CPM ranges from Media Ant marketplace listing.',
    pricing_source_urls: ['https://www.themediaant.com/digital/spotify-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Audio scripts must avoid exaggerated income claims and clearly name the advisory brand.`,
    how_to_start: 'Book Spotify audio inventory; upload a 30-second compliance-safe script; pair the audio slot with a clickable banner or landing page for response.',
    start_url: 'https://www.themediaant.com/digital/spotify-advertising',
    access_notes: 'Spotify Ads Studio or managed marketplace booking.',
    time_to_go_live: '3-5 business days'
  }),
  inventory({
    inventory_id: 'times-of-india',
    name: 'Times of India Digital Display',
    platform: 'Direct Buy',
    buy_type: 'direct',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'Fixed'],
    pricing: { CPM: band(94, 140, 220), Fixed: band(162000, 232000, 255200) },
    min_budget: 162000,
    ctr_benchmark: band(0.2, 0.35, 0.55),
    audience_quality_score: 6,
    benchmark_confidence: 'high',
    pricing_source_note: 'Times of India digital banner, article, and roadblock rates from Media Ant.',
    pricing_source_urls: ['https://www.themediaant.com/digital/times-of-india-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Use TOI as top-funnel reach or broad credibility inventory, not aggressive response copy.`,
    how_to_start: 'Request TOI digital placements; select high-visibility display inventory; confirm premium-news or business adjacency if available; send approved creative assets.',
    start_url: 'https://www.themediaant.com/digital/times-of-india-advertising',
    access_notes: 'Managed marketplace or direct publisher buy.',
    time_to_go_live: '3-5 business days'
  }),
  inventory({
    inventory_id: 'bse-nse-investor-portal',
    name: 'BSE/NSE Investor Portal (if available for direct buy)',
    platform: 'Direct Buy',
    buy_type: 'direct',
    primary_cost_model: 'Fixed',
    cost_model: ['Fixed', 'CPM'],
    pricing: { CPM: band(150, 220, 320), Fixed: band(125000, 250000, 500000) },
    min_budget: 125000,
    ctr_benchmark: band(0.7, 1.0, 1.4),
    audience_quality_score: 10,
    benchmark_confidence: 'low',
    pricing_source_note: 'No public exchange website rate card was confirmed; pricing inferred from premium investor-publisher display bands.',
    pricing_source_urls: [NSE_AD_CODE_URL, BSE_AD_FAQ_URL, 'https://www.themediaant.com/digital/money-control-advertising'],
    sebi_compliance_note: 'Exchange-facing creative may require exchange-specific advertisement approval or legal review before publication.',
    how_to_start: 'Confirm whether the exchange or portal accepts sponsorship; route the creative through compliance review; obtain any required exchange approval before booking.',
    start_url: NSE_AD_CODE_URL,
    access_notes: 'Availability must be confirmed directly with the exchange or portal partner.',
    time_to_go_live: '5-7 business days'
  }),
  inventory({
    inventory_id: 'google-performance-max',
    name: 'Google Performance Max',
    platform: 'Google',
    buy_type: 'self-serve',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'CPC', 'CPL'],
    pricing: { CPM: band(70, 130, 220) },
    min_budget: 15000,
    ctr_benchmark: band(0.7, 1.1, 1.6),
    audience_quality_score: 8,
    pricing_source_note: 'Performance Max inferred from blended Search, Display, and Demand Gen market ranges.',
    pricing_source_urls: ['https://www.themediaant.com/digital/google-display-advertising', 'https://www.themediaant.com/digital?pricingModels=CPC', 'https://support.google.com/google-ads/answer/13695777?hl=en-IN'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Keep asset groups tightly controlled and review spillover frequently.`,
    how_to_start: 'Create a Performance Max campaign with strict asset groups, finance-safe audience signals, compliant creative assets, and a qualified lead conversion goal.',
    start_url: GOOGLE_CAMPAIGN_URL,
    access_notes: 'Self-serve in Google Ads.',
    time_to_go_live: '24-48 hours',
    google_campaign_types: ['PERFORMANCE_MAX']
  }),
  inventory({
    inventory_id: 'meta-advantage-plus',
    name: 'Meta Advantage+ Shopping (configured for lead gen)',
    platform: 'Meta',
    buy_type: 'self-serve',
    primary_cost_model: 'CPM',
    cost_model: ['CPM', 'CPC', 'CPL'],
    pricing: { CPM: band(80, 120, 200) },
    min_budget: 10000,
    ctr_benchmark: band(0.8, 1.2, 1.8),
    audience_quality_score: 7,
    pricing_source_note: 'Advantage+ lead benchmark inferred from Meta feed/reels auction ranges and India Meta guidance.',
    pricing_source_urls: ['https://www.themediaant.com/digital/facebook-advertising', 'https://www.themediaant.com/digital/instagram-advertising', 'https://www.themediaant.com/digital/digital-advertising-under-40k-budget-advertising/meta-ads'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Advantage+ can expand quickly, so claims should stay conservative and pre-approved.`,
    how_to_start: 'Create an Advantage+ campaign using compliant product-style creative, a lead objective or form integration, and exclusions for weak placements or audiences.',
    start_url: META_ADS_MANAGER_URL,
    access_notes: 'Self-serve in Meta Ads Manager.',
    time_to_go_live: '24-48 hours'
  }),
  inventory({
    inventory_id: 'taboola',
    name: 'Taboola (financial content sites whitelist)',
    platform: 'Programmatic',
    buy_type: 'programmatic',
    primary_cost_model: 'CPC',
    cost_model: ['CPC', 'CPM', 'CPL'],
    pricing: { CPC: band(8, 15, 25), CPM: band(80, 120, 180) },
    min_budget: 20000,
    ctr_benchmark: band(0.35, 0.6, 0.9),
    audience_quality_score: 7,
    pricing_source_note: 'Taboola uses CPC or CPM pricing; India benchmark inferred from native/programmatic marketplace ranges with finance whitelisting.',
    pricing_source_urls: ['https://www.taboola.com/help/en/articles/3878003-pricing-and-billing-basics', 'https://www.themediaant.com/digital/native-advertising/banner', 'https://www.themediaant.com/digital/programmatic-platforms-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Run only on an approved finance and business publisher whitelist.`,
    how_to_start: 'Create a Taboola campaign; upload native creative; whitelist finance publishers only; add compliance-safe headlines; optimize on qualified leads rather than cheap clicks.',
    start_url: TABOOLA_CAMPAIGN_URL,
    access_notes: 'Programmatic self-serve with strict whitelist controls.',
    time_to_go_live: '24-48 hours'
  }),
  inventory({
    inventory_id: 'outbrain',
    name: 'OutBrain (financial content sites whitelist)',
    platform: 'Programmatic',
    buy_type: 'programmatic',
    primary_cost_model: 'CPC',
    cost_model: ['CPC', 'CPM', 'CPL'],
    pricing: { CPC: band(7, 14, 24), CPM: band(75, 115, 175) },
    min_budget: 20000,
    ctr_benchmark: band(0.3, 0.55, 0.85),
    audience_quality_score: 7,
    pricing_source_note: 'Outbrain CPC benchmark inferred from native/programmatic marketplace ranges; official help confirms CPC add-on pricing.',
    pricing_source_urls: ['https://www.outbrain.com/help/advertisers/advanced-audience-targeting-options/', 'https://www.themediaant.com/digital/native-advertising/banner', 'https://www.themediaant.com/digital/programmatic-platforms-advertising'],
    sebi_compliance_note: `${COMMON_SEBI_NOTE} Use a finance-safe publisher whitelist and plain-language native headlines only.`,
    how_to_start: 'Launch through Outbrain; whitelist premium finance and business publishers; connect only compliant editorial-style creatives; optimize to qualified lead events.',
    start_url: OUTBRAIN_CAMPAIGN_URL,
    access_notes: 'Programmatic self-serve with whitelist discipline.',
    time_to_go_live: '24-48 hours'
  })
];

const DAILY_DISCOVERY_WATCHLIST = [
  { id: 'cnbctv18', name: 'CNBC TV18 Digital', url: 'https://www.cnbctv18.com/', keywords: ['business', 'markets', 'investors', 'advertis'] },
  { id: 'financial-express', name: 'Financial Express Digital', url: 'https://www.financialexpress.com/', keywords: ['markets', 'finance', 'investor', 'advertis'] },
  { id: 'forbes-india', name: 'Forbes India Digital', url: 'https://www.forbesindia.com/', keywords: ['business', 'investing', 'advertis', 'brand'] },
  { id: 'dsij', name: 'DSIJ Digital', url: 'https://www.dsij.in/advertise-with-us', keywords: ['stock market', 'digital ads', 'website banner', 'newsletter'] },
  { id: 'jiosaavn', name: 'JioSaavn Audio', url: 'https://www.themediaant.com/digital?pricingModels=Others', keywords: ['audio', 'banner', 'music', 'jio saavn'] },
  { id: 'et-markets', name: 'ET Markets Sponsorship', url: 'https://economictimes.indiatimes.com/markets', keywords: ['markets', 'investing', 'business', 'advertis'] }
];

module.exports = {
  BSE_AD_FAQ_URL,
  COMMON_SEBI_NOTE,
  CURATED_INVENTORIES,
  DAILY_DISCOVERY_WATCHLIST,
  GOOGLE_CAMPAIGN_URL,
  GOOGLE_POLICY_URL,
  JIOHOTSTAR_CONTACT_URL,
  LINKEDIN_CAMPAIGN_URL,
  META_ADS_MANAGER_URL,
  NSE_AD_CODE_URL,
  OUTBRAIN_CAMPAIGN_URL,
  TABOOLA_CAMPAIGN_URL
};
