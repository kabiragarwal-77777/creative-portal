const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Adjust require path for db module
const { getDb, isSeeded, markSeeded } = require(path.join(__dirname, '..', 'database', 'db'));

function runSeed() {
  const db = getDb();

  if (isSeeded()) {
    console.log('Database already seeded. Skipping.');
    return;
  }

  console.log('Seeding database...');

  // ─────────────────────────────────────────────
  // COMPETITORS
  // ─────────────────────────────────────────────
  const competitors = [
    { id: uuidv4(), name: 'Zerodha', vertical: 'both', estimated_monthly_adspend: 40000000, primary_channels: 'Google Search, Content Marketing' },
    { id: uuidv4(), name: 'Groww', vertical: 'both', estimated_monthly_adspend: 175000000, primary_channels: 'Meta, YouTube, OTT' },
    { id: uuidv4(), name: 'Angel One', vertical: 'both', estimated_monthly_adspend: 325000000, primary_channels: 'TV, Digital mix' },
    { id: uuidv4(), name: 'Upstox', vertical: 'both', estimated_monthly_adspend: 100000000, primary_channels: 'Meta, YouTube, Influencer' },
    { id: uuidv4(), name: 'Dhan', vertical: 'broking', estimated_monthly_adspend: 30000000, primary_channels: 'Google, Twitter' },
    { id: uuidv4(), name: '5paisa', vertical: 'both', estimated_monthly_adspend: 65000000, primary_channels: 'Google, Meta, Programmatic' },
    { id: uuidv4(), name: 'Paytm Money', vertical: 'both', estimated_monthly_adspend: 125000000, primary_channels: 'Cross-platform (Paytm ecosystem)' },
    { id: uuidv4(), name: 'Samco', vertical: 'broking', estimated_monthly_adspend: 15000000, primary_channels: 'Google, YouTube' },
    { id: uuidv4(), name: 'Sensibull', vertical: 'ra', estimated_monthly_adspend: 7500000, primary_channels: 'Google, Twitter' },
    { id: uuidv4(), name: 'Smallcase', vertical: 'ra', estimated_monthly_adspend: 40000000, primary_channels: 'Meta, Content, Influencer' },
    { id: uuidv4(), name: 'INDmoney', vertical: 'both', estimated_monthly_adspend: 100000000, primary_channels: 'Meta, YouTube, Influencer' },
    { id: uuidv4(), name: 'Fisdom', vertical: 'ra', estimated_monthly_adspend: 20000000, primary_channels: 'Google, Meta' },
  ];

  const competitorMap = {};
  competitors.forEach(c => { competitorMap[c.name] = c.id; });

  // ─────────────────────────────────────────────
  // INVENTORIES (80+)
  // ─────────────────────────────────────────────
  const inventories = [
    // === SEARCH ===
    { id: uuidv4(), name: 'Google Search - UAC', category: 'search', platform_parent: 'Google', min_cpm: 40, max_cpm: 80, pricing_model: 'cpc', estimated_monthly_reach: 500000000, target_audience_fit: 9, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Google Search - Brand Keywords', category: 'search', platform_parent: 'Google', min_cpm: 60, max_cpm: 120, pricing_model: 'cpc', estimated_monthly_reach: 200000000, target_audience_fit: 10, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Google Search - Generic Finance', category: 'search', platform_parent: 'Google', min_cpm: 80, max_cpm: 200, pricing_model: 'cpc', estimated_monthly_reach: 300000000, target_audience_fit: 8, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Google Shopping Ads', category: 'search', platform_parent: 'Google', min_cpm: 50, max_cpm: 100, pricing_model: 'cpc', estimated_monthly_reach: 150000000, target_audience_fit: 3, fintech_friendly: 0, status: 'inactive' },
    { id: uuidv4(), name: 'Bing Search Ads', category: 'search', platform_parent: 'Microsoft', min_cpm: 30, max_cpm: 60, pricing_model: 'cpc', estimated_monthly_reach: 20000000, target_audience_fit: 6, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Apple Search Ads', category: 'search', platform_parent: 'Apple', min_cpm: 80, max_cpm: 200, pricing_model: 'cpc', estimated_monthly_reach: 50000000, target_audience_fit: 8, fintech_friendly: 1, status: 'active' },

    // === SOCIAL ===
    { id: uuidv4(), name: 'Meta Facebook Feed', category: 'social', platform_parent: 'Meta', min_cpm: 60, max_cpm: 120, pricing_model: 'cpm', estimated_monthly_reach: 350000000, target_audience_fit: 7, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Meta Instagram Feed', category: 'social', platform_parent: 'Meta', min_cpm: 80, max_cpm: 150, pricing_model: 'cpm', estimated_monthly_reach: 270000000, target_audience_fit: 8, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Instagram Reels', category: 'social', platform_parent: 'Meta', min_cpm: 50, max_cpm: 100, pricing_model: 'cpm', estimated_monthly_reach: 300000000, target_audience_fit: 7, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Instagram Stories', category: 'social', platform_parent: 'Meta', min_cpm: 40, max_cpm: 90, pricing_model: 'cpm', estimated_monthly_reach: 250000000, target_audience_fit: 7, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Meta Audience Network', category: 'social', platform_parent: 'Meta', min_cpm: 20, max_cpm: 50, pricing_model: 'cpm', estimated_monthly_reach: 400000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Meta Messenger Ads', category: 'social', platform_parent: 'Meta', min_cpm: 30, max_cpm: 70, pricing_model: 'cpm', estimated_monthly_reach: 180000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'YouTube Skippable In-Stream', category: 'social', platform_parent: 'Google', min_cpm: 80, max_cpm: 180, pricing_model: 'cpv', estimated_monthly_reach: 450000000, target_audience_fit: 8, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'YouTube Non-Skippable In-Stream', category: 'social', platform_parent: 'Google', min_cpm: 120, max_cpm: 250, pricing_model: 'cpm', estimated_monthly_reach: 450000000, target_audience_fit: 8, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'YouTube Bumper Ads (6s)', category: 'social', platform_parent: 'Google', min_cpm: 100, max_cpm: 200, pricing_model: 'cpm', estimated_monthly_reach: 450000000, target_audience_fit: 7, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'YouTube Shorts Ads', category: 'social', platform_parent: 'Google', min_cpm: 40, max_cpm: 90, pricing_model: 'cpv', estimated_monthly_reach: 300000000, target_audience_fit: 6, fintech_friendly: 1, status: 'new' },
    { id: uuidv4(), name: 'YouTube Discovery Ads', category: 'social', platform_parent: 'Google', min_cpm: 60, max_cpm: 140, pricing_model: 'cpv', estimated_monthly_reach: 400000000, target_audience_fit: 8, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'LinkedIn Sponsored Content', category: 'social', platform_parent: 'LinkedIn', min_cpm: 400, max_cpm: 900, pricing_model: 'cpm', estimated_monthly_reach: 90000000, target_audience_fit: 9, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'LinkedIn InMail Sponsored', category: 'social', platform_parent: 'LinkedIn', min_cpm: 500, max_cpm: 1200, pricing_model: 'cpm', estimated_monthly_reach: 90000000, target_audience_fit: 9, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Twitter/X Promoted Tweets', category: 'social', platform_parent: 'Twitter', min_cpm: 100, max_cpm: 250, pricing_model: 'cpm', estimated_monthly_reach: 50000000, target_audience_fit: 8, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Twitter/X Promoted Trends', category: 'social', platform_parent: 'Twitter', min_cpm: 200, max_cpm: 500, pricing_model: 'flat', estimated_monthly_reach: 50000000, target_audience_fit: 7, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Snapchat Ads India', category: 'social', platform_parent: 'Snapchat', min_cpm: 60, max_cpm: 130, pricing_model: 'cpm', estimated_monthly_reach: 40000000, target_audience_fit: 4, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Pinterest Ads India', category: 'social', platform_parent: 'Pinterest', min_cpm: 80, max_cpm: 180, pricing_model: 'cpm', estimated_monthly_reach: 30000000, target_audience_fit: 4, fintech_friendly: 1, status: 'new' },
    { id: uuidv4(), name: 'Reddit Ads India', category: 'social', platform_parent: 'Reddit', min_cpm: 50, max_cpm: 120, pricing_model: 'cpm', estimated_monthly_reach: 15000000, target_audience_fit: 7, fintech_friendly: 1, status: 'new' },
    { id: uuidv4(), name: 'Quora Ads India', category: 'social', platform_parent: 'Quora', min_cpm: 60, max_cpm: 150, pricing_model: 'cpc', estimated_monthly_reach: 25000000, target_audience_fit: 8, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Google Display Network (GDN)', category: 'social', platform_parent: 'Google', min_cpm: 15, max_cpm: 40, pricing_model: 'cpm', estimated_monthly_reach: 600000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },

    // === PROGRAMMATIC ===
    { id: uuidv4(), name: 'DV360 - Open Exchange', category: 'programmatic', platform_parent: 'Google', min_cpm: 30, max_cpm: 80, pricing_model: 'cpm', estimated_monthly_reach: 500000000, target_audience_fit: 6, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'DV360 - PMP Finance', category: 'programmatic', platform_parent: 'Google', min_cpm: 80, max_cpm: 200, pricing_model: 'cpm', estimated_monthly_reach: 100000000, target_audience_fit: 9, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'InMobi Exchange', category: 'programmatic', platform_parent: 'InMobi', min_cpm: 20, max_cpm: 60, pricing_model: 'cpm', estimated_monthly_reach: 400000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Moneycontrol Display', category: 'programmatic', platform_parent: 'Network18', min_cpm: 200, max_cpm: 450, pricing_model: 'cpm', estimated_monthly_reach: 50000000, target_audience_fit: 10, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Economic Times Display', category: 'programmatic', platform_parent: 'Times Internet', min_cpm: 250, max_cpm: 500, pricing_model: 'cpm', estimated_monthly_reach: 40000000, target_audience_fit: 10, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Livemint Display', category: 'programmatic', platform_parent: 'HT Media', min_cpm: 180, max_cpm: 400, pricing_model: 'cpm', estimated_monthly_reach: 20000000, target_audience_fit: 9, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Business Standard Display', category: 'programmatic', platform_parent: 'BS Media', min_cpm: 150, max_cpm: 350, pricing_model: 'cpm', estimated_monthly_reach: 15000000, target_audience_fit: 9, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Flipkart Ads', category: 'programmatic', platform_parent: 'Flipkart', min_cpm: 80, max_cpm: 200, pricing_model: 'cpm', estimated_monthly_reach: 300000000, target_audience_fit: 4, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Amazon DSP India', category: 'programmatic', platform_parent: 'Amazon', min_cpm: 70, max_cpm: 180, pricing_model: 'cpm', estimated_monthly_reach: 250000000, target_audience_fit: 4, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Swiggy Brand Ads', category: 'programmatic', platform_parent: 'Swiggy', min_cpm: 150, max_cpm: 350, pricing_model: 'cpm', estimated_monthly_reach: 60000000, target_audience_fit: 3, fintech_friendly: 0, status: 'under_review' },
    { id: uuidv4(), name: 'Zomato Brand Ads', category: 'programmatic', platform_parent: 'Zomato', min_cpm: 150, max_cpm: 350, pricing_model: 'cpm', estimated_monthly_reach: 55000000, target_audience_fit: 3, fintech_friendly: 0, status: 'under_review' },
    { id: uuidv4(), name: 'Taboola Native India', category: 'programmatic', platform_parent: 'Taboola', min_cpm: 25, max_cpm: 60, pricing_model: 'cpc', estimated_monthly_reach: 200000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Outbrain Native India', category: 'programmatic', platform_parent: 'Outbrain', min_cpm: 25, max_cpm: 55, pricing_model: 'cpc', estimated_monthly_reach: 150000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Columbia Native (JEENG)', category: 'programmatic', platform_parent: 'JEENG', min_cpm: 20, max_cpm: 50, pricing_model: 'cpc', estimated_monthly_reach: 80000000, target_audience_fit: 4, fintech_friendly: 1, status: 'new' },

    // === INFLUENCER ===
    { id: uuidv4(), name: 'YouTube Finance Influencers', category: 'influencer', platform_parent: 'YouTube', min_cpm: 100, max_cpm: 300, pricing_model: 'flat', estimated_monthly_reach: 50000000, target_audience_fit: 9, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Instagram Finance Influencers', category: 'influencer', platform_parent: 'Instagram', min_cpm: 80, max_cpm: 250, pricing_model: 'flat', estimated_monthly_reach: 40000000, target_audience_fit: 8, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Twitter/X Finfluencers', category: 'influencer', platform_parent: 'Twitter', min_cpm: 60, max_cpm: 200, pricing_model: 'flat', estimated_monthly_reach: 15000000, target_audience_fit: 9, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Telegram Finance Channels', category: 'influencer', platform_parent: 'Telegram', min_cpm: 30, max_cpm: 80, pricing_model: 'flat', estimated_monthly_reach: 20000000, target_audience_fit: 9, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'LinkedIn Finance Influencers', category: 'influencer', platform_parent: 'LinkedIn', min_cpm: 200, max_cpm: 500, pricing_model: 'flat', estimated_monthly_reach: 10000000, target_audience_fit: 10, fintech_friendly: 1, status: 'new' },

    // === OOH ===
    { id: uuidv4(), name: 'Mumbai Metro DOOH', category: 'ooh', platform_parent: 'Times OOH', min_cpm: 10, max_cpm: 30, pricing_model: 'cpd', estimated_monthly_reach: 5000000, target_audience_fit: 6, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Bangalore Airport DOOH', category: 'ooh', platform_parent: 'JCDecaux', min_cpm: 15, max_cpm: 40, pricing_model: 'cpd', estimated_monthly_reach: 3000000, target_audience_fit: 8, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Delhi Metro DOOH', category: 'ooh', platform_parent: 'DMRC Media', min_cpm: 8, max_cpm: 25, pricing_model: 'cpd', estimated_monthly_reach: 8000000, target_audience_fit: 6, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Highway Billboard Network', category: 'ooh', platform_parent: 'Selvel Advertising', min_cpm: 5, max_cpm: 15, pricing_model: 'flat', estimated_monthly_reach: 20000000, target_audience_fit: 3, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Cab-top Digital Screens', category: 'ooh', platform_parent: 'Wrap2Earn', min_cpm: 6, max_cpm: 18, pricing_model: 'cpd', estimated_monthly_reach: 10000000, target_audience_fit: 5, fintech_friendly: 1, status: 'new' },

    // === VERNACULAR ===
    { id: uuidv4(), name: 'ShareChat Ads', category: 'vernacular', platform_parent: 'ShareChat', min_cpm: 30, max_cpm: 70, pricing_model: 'cpm', estimated_monthly_reach: 180000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Moj Short Video Ads', category: 'vernacular', platform_parent: 'ShareChat', min_cpm: 25, max_cpm: 60, pricing_model: 'cpm', estimated_monthly_reach: 160000000, target_audience_fit: 4, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Josh Short Video Ads', category: 'vernacular', platform_parent: 'VerSe Innovation', min_cpm: 25, max_cpm: 55, pricing_model: 'cpm', estimated_monthly_reach: 150000000, target_audience_fit: 4, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Dailyhunt Native Ads', category: 'vernacular', platform_parent: 'VerSe Innovation', min_cpm: 20, max_cpm: 50, pricing_model: 'cpm', estimated_monthly_reach: 120000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Glance Lock Screen Ads', category: 'vernacular', platform_parent: 'InMobi', min_cpm: 15, max_cpm: 40, pricing_model: 'cpm', estimated_monthly_reach: 200000000, target_audience_fit: 4, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Koo Promoted Posts', category: 'vernacular', platform_parent: 'Koo', min_cpm: 20, max_cpm: 50, pricing_model: 'cpm', estimated_monthly_reach: 30000000, target_audience_fit: 5, fintech_friendly: 1, status: 'inactive' },

    // === AUDIO ===
    { id: uuidv4(), name: 'Spotify Audio Ads India', category: 'audio', platform_parent: 'Spotify', min_cpm: 120, max_cpm: 200, pricing_model: 'cpm', estimated_monthly_reach: 50000000, target_audience_fit: 7, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Gaana Audio Ads', category: 'audio', platform_parent: 'Gaana', min_cpm: 60, max_cpm: 120, pricing_model: 'cpm', estimated_monthly_reach: 80000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'JioSaavn Audio Ads', category: 'audio', platform_parent: 'JioSaavn', min_cpm: 80, max_cpm: 150, pricing_model: 'cpm', estimated_monthly_reach: 70000000, target_audience_fit: 6, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Wynk Music Ads', category: 'audio', platform_parent: 'Airtel', min_cpm: 50, max_cpm: 100, pricing_model: 'cpm', estimated_monthly_reach: 40000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },

    // === GAMING ===
    { id: uuidv4(), name: 'MPL In-App Ads', category: 'gaming', platform_parent: 'MPL', min_cpm: 50, max_cpm: 120, pricing_model: 'cpm', estimated_monthly_reach: 60000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Dream11 Brand Integrations', category: 'gaming', platform_parent: 'Dream11', min_cpm: 70, max_cpm: 150, pricing_model: 'flat', estimated_monthly_reach: 80000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Ludo King Interstitial Ads', category: 'gaming', platform_parent: 'Gametion', min_cpm: 30, max_cpm: 80, pricing_model: 'cpm', estimated_monthly_reach: 50000000, target_audience_fit: 3, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Unity Ads India (Rewarded)', category: 'gaming', platform_parent: 'Unity', min_cpm: 40, max_cpm: 100, pricing_model: 'cpm', estimated_monthly_reach: 100000000, target_audience_fit: 3, fintech_friendly: 1, status: 'active' },

    // === CTV ===
    { id: uuidv4(), name: 'Disney+ Hotstar Ads', category: 'ctv', platform_parent: 'Disney', min_cpm: 180, max_cpm: 350, pricing_model: 'cpm', estimated_monthly_reach: 60000000, target_audience_fit: 7, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'JioCinema Ads', category: 'ctv', platform_parent: 'Jio', min_cpm: 150, max_cpm: 300, pricing_model: 'cpm', estimated_monthly_reach: 80000000, target_audience_fit: 6, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'SonyLIV Ads', category: 'ctv', platform_parent: 'Sony', min_cpm: 120, max_cpm: 250, pricing_model: 'cpm', estimated_monthly_reach: 40000000, target_audience_fit: 6, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Zee5 Ads', category: 'ctv', platform_parent: 'Zee', min_cpm: 100, max_cpm: 220, pricing_model: 'cpm', estimated_monthly_reach: 50000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'MX Player Ads', category: 'ctv', platform_parent: 'MX Media', min_cpm: 40, max_cpm: 100, pricing_model: 'cpm', estimated_monthly_reach: 150000000, target_audience_fit: 4, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Samsung TV Plus Ads', category: 'ctv', platform_parent: 'Samsung', min_cpm: 80, max_cpm: 180, pricing_model: 'cpm', estimated_monthly_reach: 20000000, target_audience_fit: 6, fintech_friendly: 1, status: 'new' },
    { id: uuidv4(), name: 'Amazon miniTV Ads', category: 'ctv', platform_parent: 'Amazon', min_cpm: 60, max_cpm: 140, pricing_model: 'cpm', estimated_monthly_reach: 30000000, target_audience_fit: 5, fintech_friendly: 1, status: 'new' },

    // === HYPERLOCAL ===
    { id: uuidv4(), name: 'Google Local Services Ads', category: 'hyperlocal', platform_parent: 'Google', min_cpm: 50, max_cpm: 120, pricing_model: 'cpl', estimated_monthly_reach: 50000000, target_audience_fit: 6, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Google Maps Promoted Pins', category: 'hyperlocal', platform_parent: 'Google', min_cpm: 30, max_cpm: 80, pricing_model: 'cpc', estimated_monthly_reach: 100000000, target_audience_fit: 4, fintech_friendly: 0, status: 'under_review' },
    { id: uuidv4(), name: 'Dunzo In-App Banners', category: 'hyperlocal', platform_parent: 'Dunzo', min_cpm: 40, max_cpm: 100, pricing_model: 'cpm', estimated_monthly_reach: 10000000, target_audience_fit: 3, fintech_friendly: 0, status: 'new' },

    // === EMAIL ===
    { id: uuidv4(), name: 'Moneycontrol Newsletter Sponsorship', category: 'email', platform_parent: 'Network18', min_cpm: 300, max_cpm: 600, pricing_model: 'cpm', estimated_monthly_reach: 5000000, target_audience_fit: 10, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Economic Times Newsletter', category: 'email', platform_parent: 'Times Internet', min_cpm: 350, max_cpm: 700, pricing_model: 'cpm', estimated_monthly_reach: 3000000, target_audience_fit: 10, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'The Morning Context Sponsorship', category: 'email', platform_parent: 'TMC Media', min_cpm: 500, max_cpm: 1000, pricing_model: 'flat', estimated_monthly_reach: 200000, target_audience_fit: 10, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Finshots Newsletter Ads', category: 'email', platform_parent: 'Finshots', min_cpm: 250, max_cpm: 500, pricing_model: 'flat', estimated_monthly_reach: 1500000, target_audience_fit: 10, fintech_friendly: 1, status: 'active' },

    // === PUSH ===
    { id: uuidv4(), name: 'iZooto Push Notifications', category: 'push', platform_parent: 'iZooto', min_cpm: 10, max_cpm: 30, pricing_model: 'cpm', estimated_monthly_reach: 50000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'WebEngage Push Campaigns', category: 'push', platform_parent: 'WebEngage', min_cpm: 5, max_cpm: 15, pricing_model: 'cpm', estimated_monthly_reach: 30000000, target_audience_fit: 7, fintech_friendly: 1, status: 'active' },

    // === SMS ===
    { id: uuidv4(), name: 'Gupshup Promotional SMS', category: 'sms', platform_parent: 'Gupshup', min_cpm: 200, max_cpm: 400, pricing_model: 'cpm', estimated_monthly_reach: 100000000, target_audience_fit: 6, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Karix RCS Messaging', category: 'sms', platform_parent: 'Karix', min_cpm: 150, max_cpm: 300, pricing_model: 'cpm', estimated_monthly_reach: 50000000, target_audience_fit: 6, fintech_friendly: 1, status: 'new' },

    // === AFFILIATE ===
    { id: uuidv4(), name: 'CueLinks Finance Vertical', category: 'affiliate', platform_parent: 'CueLinks', min_cpm: 0, max_cpm: 0, pricing_model: 'cpa', estimated_monthly_reach: 20000000, target_audience_fit: 7, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'vCommission Finance', category: 'affiliate', platform_parent: 'vCommission', min_cpm: 0, max_cpm: 0, pricing_model: 'cpa', estimated_monthly_reach: 30000000, target_audience_fit: 6, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Admitad India', category: 'affiliate', platform_parent: 'Admitad', min_cpm: 0, max_cpm: 0, pricing_model: 'cpa', estimated_monthly_reach: 25000000, target_audience_fit: 6, fintech_friendly: 1, status: 'active' },

    // === PODCAST ===
    { id: uuidv4(), name: 'Spotify Podcast Ads India', category: 'podcast', platform_parent: 'Spotify', min_cpm: 150, max_cpm: 350, pricing_model: 'cpm', estimated_monthly_reach: 10000000, target_audience_fit: 8, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'IVM Podcasts Sponsorship', category: 'podcast', platform_parent: 'IVM', min_cpm: 200, max_cpm: 400, pricing_model: 'flat', estimated_monthly_reach: 3000000, target_audience_fit: 7, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Hubhopper Podcast Network', category: 'podcast', platform_parent: 'Hubhopper', min_cpm: 100, max_cpm: 250, pricing_model: 'cpm', estimated_monthly_reach: 5000000, target_audience_fit: 6, fintech_friendly: 1, status: 'active' },

    // === REGIONAL OTT ===
    { id: uuidv4(), name: 'Sun NXT Ads (Tamil/Telugu)', category: 'regional_ott', platform_parent: 'Sun TV Network', min_cpm: 60, max_cpm: 140, pricing_model: 'cpm', estimated_monthly_reach: 25000000, target_audience_fit: 4, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Hoichoi Ads (Bengali)', category: 'regional_ott', platform_parent: 'SVF', min_cpm: 50, max_cpm: 120, pricing_model: 'cpm', estimated_monthly_reach: 10000000, target_audience_fit: 4, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Aha Video Ads (Telugu)', category: 'regional_ott', platform_parent: 'Arha Media', min_cpm: 50, max_cpm: 130, pricing_model: 'cpm', estimated_monthly_reach: 12000000, target_audience_fit: 4, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Planet Marathi OTT Ads', category: 'regional_ott', platform_parent: 'Planet Marathi', min_cpm: 40, max_cpm: 100, pricing_model: 'cpm', estimated_monthly_reach: 5000000, target_audience_fit: 4, fintech_friendly: 1, status: 'new' },

    // === VIDEO ===
    { id: uuidv4(), name: 'Google Video Partners', category: 'video', platform_parent: 'Google', min_cpm: 40, max_cpm: 100, pricing_model: 'cpv', estimated_monthly_reach: 300000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Voot/JioCinema AVOD', category: 'video', platform_parent: 'Jio', min_cpm: 100, max_cpm: 250, pricing_model: 'cpm', estimated_monthly_reach: 60000000, target_audience_fit: 5, fintech_friendly: 1, status: 'active' },
    { id: uuidv4(), name: 'Times Now Digital Video', category: 'video', platform_parent: 'Times Internet', min_cpm: 120, max_cpm: 280, pricing_model: 'cpm', estimated_monthly_reach: 20000000, target_audience_fit: 7, fintech_friendly: 1, status: 'active' },
  ];

  // Build name->id map for inventories
  const inventoryMap = {};
  inventories.forEach(inv => { inventoryMap[inv.name] = inv.id; });

  // Helper to look up inventory id by partial name match
  function invId(partial) {
    const key = Object.keys(inventoryMap).find(k => k.includes(partial));
    return key ? inventoryMap[key] : null;
  }

  // ─────────────────────────────────────────────
  // EXISTING INVENTORIES (Univest current spend)
  // ─────────────────────────────────────────────
  const existingInventories = [
    { id: uuidv4(), inventory_id: invId('Google Search - UAC'), current_monthly_spend: 2500000, current_cpm: 55, current_cpc: 8.5, current_ctr: 0.065, current_cpa: 320, notes: 'Primary UA channel, scaling steadily' },
    { id: uuidv4(), inventory_id: invId('Meta Facebook Feed'), current_monthly_spend: 1800000, current_cpm: 85, current_cpc: 12, current_ctr: 0.042, current_cpa: 280, notes: 'Good for awareness + retargeting' },
    { id: uuidv4(), inventory_id: invId('Meta Instagram Feed'), current_monthly_spend: 1200000, current_cpm: 110, current_cpc: 15, current_ctr: 0.038, current_cpa: 350, notes: 'Better for younger audience' },
    { id: uuidv4(), inventory_id: invId('Instagram Reels'), current_monthly_spend: 800000, current_cpm: 65, current_cpc: 10, current_ctr: 0.05, current_cpa: 300, notes: 'Growing channel, good engagement' },
    { id: uuidv4(), inventory_id: invId('YouTube Skippable'), current_monthly_spend: 1500000, current_cpm: 120, current_cpc: null, current_ctr: 0.012, current_cpa: 450, notes: 'Brand + performance mix' },
    { id: uuidv4(), inventory_id: invId('Google Display Network'), current_monthly_spend: 600000, current_cpm: 22, current_cpc: 5, current_ctr: 0.018, current_cpa: 500, notes: 'Retargeting only, low intent' },
  ];

  // ─────────────────────────────────────────────
  // COMPETITOR SPENDS
  // ─────────────────────────────────────────────
  const competitorSpends = [
    // Zerodha
    { id: uuidv4(), competitor_id: competitorMap['Zerodha'], inventory_id: invId('Google Search - UAC'), estimated_monthly_spend: 15000000, confidence_level: 'high', source: 'Google Ads Transparency' },
    { id: uuidv4(), competitor_id: competitorMap['Zerodha'], inventory_id: invId('Google Search - Brand'), estimated_monthly_spend: 5000000, confidence_level: 'high', source: 'Google Ads Transparency' },
    { id: uuidv4(), competitor_id: competitorMap['Zerodha'], inventory_id: invId('YouTube Skippable'), estimated_monthly_spend: 8000000, confidence_level: 'medium', source: 'YouTube Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Zerodha'], inventory_id: invId('Twitter/X Promoted Tweets'), estimated_monthly_spend: 2000000, confidence_level: 'low', source: 'Estimated from visibility' },

    // Groww
    { id: uuidv4(), competitor_id: competitorMap['Groww'], inventory_id: invId('Meta Facebook Feed'), estimated_monthly_spend: 40000000, confidence_level: 'high', source: 'Meta Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Groww'], inventory_id: invId('Meta Instagram Feed'), estimated_monthly_spend: 30000000, confidence_level: 'high', source: 'Meta Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Groww'], inventory_id: invId('Instagram Reels'), estimated_monthly_spend: 25000000, confidence_level: 'medium', source: 'Meta Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Groww'], inventory_id: invId('YouTube Skippable'), estimated_monthly_spend: 35000000, confidence_level: 'medium', source: 'YouTube Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Groww'], inventory_id: invId('Disney+ Hotstar'), estimated_monthly_spend: 20000000, confidence_level: 'medium', source: 'OTT ad monitoring' },

    // Angel One
    { id: uuidv4(), competitor_id: competitorMap['Angel One'], inventory_id: invId('Google Search - UAC'), estimated_monthly_spend: 50000000, confidence_level: 'high', source: 'Google Ads Transparency' },
    { id: uuidv4(), competitor_id: competitorMap['Angel One'], inventory_id: invId('Meta Facebook Feed'), estimated_monthly_spend: 35000000, confidence_level: 'high', source: 'Meta Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Angel One'], inventory_id: invId('YouTube Non-Skippable'), estimated_monthly_spend: 40000000, confidence_level: 'medium', source: 'YouTube Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Angel One'], inventory_id: invId('Disney+ Hotstar'), estimated_monthly_spend: 30000000, confidence_level: 'medium', source: 'OTT ad monitoring' },
    { id: uuidv4(), competitor_id: competitorMap['Angel One'], inventory_id: invId('JioCinema'), estimated_monthly_spend: 25000000, confidence_level: 'medium', source: 'OTT ad monitoring' },

    // Upstox
    { id: uuidv4(), competitor_id: competitorMap['Upstox'], inventory_id: invId('Meta Facebook Feed'), estimated_monthly_spend: 20000000, confidence_level: 'high', source: 'Meta Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Upstox'], inventory_id: invId('Instagram Reels'), estimated_monthly_spend: 15000000, confidence_level: 'medium', source: 'Meta Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Upstox'], inventory_id: invId('YouTube Skippable'), estimated_monthly_spend: 25000000, confidence_level: 'medium', source: 'YouTube Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Upstox'], inventory_id: invId('YouTube Finance Influencers'), estimated_monthly_spend: 15000000, confidence_level: 'low', source: 'Influencer monitoring' },

    // Dhan
    { id: uuidv4(), competitor_id: competitorMap['Dhan'], inventory_id: invId('Google Search - UAC'), estimated_monthly_spend: 12000000, confidence_level: 'high', source: 'Google Ads Transparency' },
    { id: uuidv4(), competitor_id: competitorMap['Dhan'], inventory_id: invId('Twitter/X Promoted Tweets'), estimated_monthly_spend: 5000000, confidence_level: 'medium', source: 'Twitter observation' },
    { id: uuidv4(), competitor_id: competitorMap['Dhan'], inventory_id: invId('Google Search - Generic'), estimated_monthly_spend: 8000000, confidence_level: 'medium', source: 'Google Ads Transparency' },

    // 5paisa
    { id: uuidv4(), competitor_id: competitorMap['5paisa'], inventory_id: invId('Google Search - UAC'), estimated_monthly_spend: 18000000, confidence_level: 'high', source: 'Google Ads Transparency' },
    { id: uuidv4(), competitor_id: competitorMap['5paisa'], inventory_id: invId('Meta Facebook Feed'), estimated_monthly_spend: 12000000, confidence_level: 'high', source: 'Meta Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['5paisa'], inventory_id: invId('DV360 - Open Exchange'), estimated_monthly_spend: 10000000, confidence_level: 'medium', source: 'Programmatic monitoring' },
    { id: uuidv4(), competitor_id: competitorMap['5paisa'], inventory_id: invId('InMobi'), estimated_monthly_spend: 8000000, confidence_level: 'low', source: 'SDK detection' },

    // Paytm Money
    { id: uuidv4(), competitor_id: competitorMap['Paytm Money'], inventory_id: invId('Google Search - UAC'), estimated_monthly_spend: 30000000, confidence_level: 'high', source: 'Google Ads Transparency' },
    { id: uuidv4(), competitor_id: competitorMap['Paytm Money'], inventory_id: invId('Meta Facebook Feed'), estimated_monthly_spend: 25000000, confidence_level: 'high', source: 'Meta Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Paytm Money'], inventory_id: invId('YouTube Skippable'), estimated_monthly_spend: 20000000, confidence_level: 'medium', source: 'YouTube Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Paytm Money'], inventory_id: invId('Disney+ Hotstar'), estimated_monthly_spend: 15000000, confidence_level: 'medium', source: 'OTT ad monitoring' },

    // Samco
    { id: uuidv4(), competitor_id: competitorMap['Samco'], inventory_id: invId('Google Search - UAC'), estimated_monthly_spend: 6000000, confidence_level: 'high', source: 'Google Ads Transparency' },
    { id: uuidv4(), competitor_id: competitorMap['Samco'], inventory_id: invId('YouTube Skippable'), estimated_monthly_spend: 4000000, confidence_level: 'medium', source: 'YouTube Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Samco'], inventory_id: invId('Google Display Network'), estimated_monthly_spend: 3000000, confidence_level: 'medium', source: 'GDN monitoring' },

    // Sensibull
    { id: uuidv4(), competitor_id: competitorMap['Sensibull'], inventory_id: invId('Google Search - UAC'), estimated_monthly_spend: 3000000, confidence_level: 'high', source: 'Google Ads Transparency' },
    { id: uuidv4(), competitor_id: competitorMap['Sensibull'], inventory_id: invId('Twitter/X Promoted Tweets'), estimated_monthly_spend: 2000000, confidence_level: 'medium', source: 'Twitter observation' },
    { id: uuidv4(), competitor_id: competitorMap['Sensibull'], inventory_id: invId('Google Search - Generic'), estimated_monthly_spend: 2500000, confidence_level: 'medium', source: 'Google Ads Transparency' },

    // Smallcase
    { id: uuidv4(), competitor_id: competitorMap['Smallcase'], inventory_id: invId('Meta Facebook Feed'), estimated_monthly_spend: 10000000, confidence_level: 'high', source: 'Meta Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Smallcase'], inventory_id: invId('Meta Instagram Feed'), estimated_monthly_spend: 8000000, confidence_level: 'high', source: 'Meta Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Smallcase'], inventory_id: invId('Instagram Finance Influencers'), estimated_monthly_spend: 10000000, confidence_level: 'low', source: 'Influencer monitoring' },
    { id: uuidv4(), competitor_id: competitorMap['Smallcase'], inventory_id: invId('YouTube Finance Influencers'), estimated_monthly_spend: 5000000, confidence_level: 'low', source: 'Influencer monitoring' },

    // INDmoney
    { id: uuidv4(), competitor_id: competitorMap['INDmoney'], inventory_id: invId('Meta Facebook Feed'), estimated_monthly_spend: 22000000, confidence_level: 'high', source: 'Meta Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['INDmoney'], inventory_id: invId('Instagram Reels'), estimated_monthly_spend: 18000000, confidence_level: 'medium', source: 'Meta Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['INDmoney'], inventory_id: invId('YouTube Skippable'), estimated_monthly_spend: 20000000, confidence_level: 'medium', source: 'YouTube Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['INDmoney'], inventory_id: invId('YouTube Finance Influencers'), estimated_monthly_spend: 12000000, confidence_level: 'low', source: 'Influencer monitoring' },
    { id: uuidv4(), competitor_id: competitorMap['INDmoney'], inventory_id: invId('ShareChat'), estimated_monthly_spend: 5000000, confidence_level: 'low', source: 'SDK detection' },

    // Fisdom
    { id: uuidv4(), competitor_id: competitorMap['Fisdom'], inventory_id: invId('Google Search - UAC'), estimated_monthly_spend: 8000000, confidence_level: 'high', source: 'Google Ads Transparency' },
    { id: uuidv4(), competitor_id: competitorMap['Fisdom'], inventory_id: invId('Meta Facebook Feed'), estimated_monthly_spend: 5000000, confidence_level: 'high', source: 'Meta Ad Library' },
    { id: uuidv4(), competitor_id: competitorMap['Fisdom'], inventory_id: invId('Google Display Network'), estimated_monthly_spend: 4000000, confidence_level: 'medium', source: 'GDN monitoring' },
  ];

  // ─────────────────────────────────────────────
  // BUDGET RECOMMENDATIONS (top 20 inventories)
  // ─────────────────────────────────────────────
  const budgetRecommendations = [
    { id: uuidv4(), inventory_id: invId('Google Search - UAC'), recommended_starting_budget: 500000, recommended_testing_budget: 200000, recommended_scale_budget: 5000000, rationale: 'Highest intent channel for fintech UA. Start with branded + competitor keywords, then expand to generic.', data_sources: 'Google Keyword Planner, competitor spend analysis', confidence_score: 0.92 },
    { id: uuidv4(), inventory_id: invId('Meta Facebook Feed'), recommended_starting_budget: 400000, recommended_testing_budget: 150000, recommended_scale_budget: 3000000, rationale: 'Strong for awareness and retargeting. Use lookalike audiences from existing users.', data_sources: 'Meta Business Suite, industry benchmarks', confidence_score: 0.88 },
    { id: uuidv4(), inventory_id: invId('Meta Instagram Feed'), recommended_starting_budget: 300000, recommended_testing_budget: 100000, recommended_scale_budget: 2000000, rationale: 'Good for 18-35 demographic. Carousel ads perform best for fintech.', data_sources: 'Meta Business Suite, internal testing', confidence_score: 0.85 },
    { id: uuidv4(), inventory_id: invId('Instagram Reels'), recommended_starting_budget: 200000, recommended_testing_budget: 100000, recommended_scale_budget: 1500000, rationale: 'Fastest growing placement. Lower CPMs with strong engagement. Test 15s educational content.', data_sources: 'Meta trends report, competitor analysis', confidence_score: 0.82 },
    { id: uuidv4(), inventory_id: invId('YouTube Skippable'), recommended_starting_budget: 500000, recommended_testing_budget: 200000, recommended_scale_budget: 3000000, rationale: 'Best for brand building + consideration. Finance audience indexes high on YouTube.', data_sources: 'YouTube Ads benchmarks, Google internal data', confidence_score: 0.87 },
    { id: uuidv4(), inventory_id: invId('Google Display Network'), recommended_starting_budget: 200000, recommended_testing_budget: 100000, recommended_scale_budget: 1000000, rationale: 'Use only for retargeting. Prospecting CPAs too high for fintech.', data_sources: 'Internal campaign data', confidence_score: 0.90 },
    { id: uuidv4(), inventory_id: invId('LinkedIn Sponsored Content'), recommended_starting_budget: 300000, recommended_testing_budget: 150000, recommended_scale_budget: 1500000, rationale: 'Premium audience but high CPMs. Best for HNI targeting and B2B wealth management.', data_sources: 'LinkedIn Campaign Manager benchmarks', confidence_score: 0.80 },
    { id: uuidv4(), inventory_id: invId('Twitter/X Promoted Tweets'), recommended_starting_budget: 200000, recommended_testing_budget: 100000, recommended_scale_budget: 800000, rationale: 'Finance Twitter community is highly engaged. Good for thought leadership + app installs.', data_sources: 'Twitter Ads benchmarks, Sensibull case study', confidence_score: 0.75 },
    { id: uuidv4(), inventory_id: invId('Disney+ Hotstar'), recommended_starting_budget: 500000, recommended_testing_budget: 300000, recommended_scale_budget: 5000000, rationale: 'Premium inventory with cricket season spikes. Plan around IPL for max impact.', data_sources: 'Hotstar rate cards, OTT industry reports', confidence_score: 0.78 },
    { id: uuidv4(), inventory_id: invId('JioCinema'), recommended_starting_budget: 400000, recommended_testing_budget: 200000, recommended_scale_budget: 3000000, rationale: 'Growing rapidly post-IPL rights. Good reach at lower CPMs than Hotstar.', data_sources: 'JioCinema media kit, industry reports', confidence_score: 0.75 },
    { id: uuidv4(), inventory_id: invId('Moneycontrol Display'), recommended_starting_budget: 300000, recommended_testing_budget: 150000, recommended_scale_budget: 1500000, rationale: 'Most relevant finance audience in India. Premium but highly targeted.', data_sources: 'Moneycontrol media kit, direct publisher data', confidence_score: 0.88 },
    { id: uuidv4(), inventory_id: invId('Economic Times Display'), recommended_starting_budget: 250000, recommended_testing_budget: 100000, recommended_scale_budget: 1200000, rationale: 'Affluent readership, strong for wealth/investment messaging.', data_sources: 'ET media kit, ComScore data', confidence_score: 0.85 },
    { id: uuidv4(), inventory_id: invId('ShareChat'), recommended_starting_budget: 150000, recommended_testing_budget: 80000, recommended_scale_budget: 800000, rationale: 'Tier 2/3 audience reach. Good for vernacular campaigns and mass market products.', data_sources: 'ShareChat for Business data', confidence_score: 0.70 },
    { id: uuidv4(), inventory_id: invId('Spotify Audio Ads'), recommended_starting_budget: 200000, recommended_testing_budget: 100000, recommended_scale_budget: 1000000, rationale: 'Growing audio ad market. Good for brand recall with 15-30s spots.', data_sources: 'Spotify Ad Studio, audio ad benchmarks', confidence_score: 0.72 },
    { id: uuidv4(), inventory_id: invId('YouTube Finance Influencers'), recommended_starting_budget: 500000, recommended_testing_budget: 200000, recommended_scale_budget: 3000000, rationale: 'Highly trusted channel. Integration with top finance YouTubers drives strong CPA.', data_sources: 'Influencer marketing benchmarks, competitor spend', confidence_score: 0.80 },
    { id: uuidv4(), inventory_id: invId('DV360 - Open Exchange'), recommended_starting_budget: 200000, recommended_testing_budget: 100000, recommended_scale_budget: 1500000, rationale: 'Broad reach at low CPMs. Use with strong audience targeting and viewability filters.', data_sources: 'DV360 benchmarks, programmatic industry data', confidence_score: 0.75 },
    { id: uuidv4(), inventory_id: invId('InMobi'), recommended_starting_budget: 150000, recommended_testing_budget: 80000, recommended_scale_budget: 800000, rationale: 'Strong mobile reach in India. Good for app install campaigns.', data_sources: 'InMobi pulse data, mobile marketing benchmarks', confidence_score: 0.72 },
    { id: uuidv4(), inventory_id: invId('Finshots Newsletter'), recommended_starting_budget: 100000, recommended_testing_budget: 50000, recommended_scale_budget: 500000, rationale: 'Hyper-targeted finance audience. Small scale but excellent engagement and trust.', data_sources: 'Publisher direct data', confidence_score: 0.85 },
    { id: uuidv4(), inventory_id: invId('Apple Search Ads'), recommended_starting_budget: 300000, recommended_testing_budget: 150000, recommended_scale_budget: 2000000, rationale: 'High-intent iOS users. Premium demographic. Strong for iOS app installs.', data_sources: 'Apple Search Ads benchmarks', confidence_score: 0.82 },
    { id: uuidv4(), inventory_id: invId('Quora Ads India'), recommended_starting_budget: 100000, recommended_testing_budget: 50000, recommended_scale_budget: 500000, rationale: 'High-intent users asking finance questions. Good contextual targeting.', data_sources: 'Quora Ads Manager, industry benchmarks', confidence_score: 0.70 },
  ];

  // ─────────────────────────────────────────────
  // AD FORMAT SCORES (top 30 inventories)
  // ─────────────────────────────────────────────
  const adFormatScores = [
    // Google Search UAC
    { id: uuidv4(), inventory_id: invId('Google Search - UAC'), format: 'search_text', score: 10, reason: 'Core format for search ads', best_size_spec: 'Headline 30 chars x3, Description 90 chars x2' },
    { id: uuidv4(), inventory_id: invId('Google Search - UAC'), format: 'shopping', score: 2, reason: 'Not applicable for fintech', best_size_spec: 'N/A' },

    // Meta Facebook Feed
    { id: uuidv4(), inventory_id: invId('Meta Facebook Feed'), format: 'static', score: 7, reason: 'Good performance with clear value prop imagery', best_size_spec: '1080x1080 or 1200x628' },
    { id: uuidv4(), inventory_id: invId('Meta Facebook Feed'), format: 'video', score: 9, reason: 'Highest engagement format on Facebook', best_size_spec: '1080x1080 or 1080x1920, 15-30s' },
    { id: uuidv4(), inventory_id: invId('Meta Facebook Feed'), format: 'carousel', score: 8, reason: 'Great for showcasing multiple features', best_size_spec: '1080x1080 per card, 3-5 cards' },

    // Meta Instagram Feed
    { id: uuidv4(), inventory_id: invId('Meta Instagram Feed'), format: 'static', score: 8, reason: 'Strong visual platform, clean creatives perform well', best_size_spec: '1080x1080' },
    { id: uuidv4(), inventory_id: invId('Meta Instagram Feed'), format: 'video', score: 9, reason: 'Top performing format', best_size_spec: '1080x1080 or 1080x1920, 15s' },
    { id: uuidv4(), inventory_id: invId('Meta Instagram Feed'), format: 'carousel', score: 9, reason: 'Swipeable stories drive high engagement', best_size_spec: '1080x1080, 3-10 cards' },
    { id: uuidv4(), inventory_id: invId('Meta Instagram Feed'), format: 'story', score: 8, reason: 'Full-screen immersive format', best_size_spec: '1080x1920' },

    // Instagram Reels
    { id: uuidv4(), inventory_id: invId('Instagram Reels'), format: 'video', score: 10, reason: 'Native format, highest organic reach', best_size_spec: '1080x1920, 15-30s' },
    { id: uuidv4(), inventory_id: invId('Instagram Reels'), format: 'static', score: 3, reason: 'Not native to Reels format', best_size_spec: 'N/A' },

    // Instagram Stories
    { id: uuidv4(), inventory_id: invId('Instagram Stories'), format: 'video', score: 9, reason: 'High completion rates for 15s videos', best_size_spec: '1080x1920, 15s' },
    { id: uuidv4(), inventory_id: invId('Instagram Stories'), format: 'static', score: 7, reason: 'Works for simple CTA-driven ads', best_size_spec: '1080x1920' },
    { id: uuidv4(), inventory_id: invId('Instagram Stories'), format: 'interactive', score: 8, reason: 'Polls and quizzes drive engagement', best_size_spec: '1080x1920 with interactive elements' },

    // YouTube Skippable
    { id: uuidv4(), inventory_id: invId('YouTube Skippable'), format: 'video', score: 10, reason: 'Core format for YouTube ads', best_size_spec: '1920x1080, 15-60s (hook in first 5s)' },

    // YouTube Non-Skippable
    { id: uuidv4(), inventory_id: invId('YouTube Non-Skippable'), format: 'video', score: 10, reason: 'Guaranteed full view', best_size_spec: '1920x1080, 15s max' },

    // YouTube Bumper
    { id: uuidv4(), inventory_id: invId('YouTube Bumper'), format: 'video', score: 9, reason: 'Quick brand recall, cost-effective', best_size_spec: '1920x1080, 6s' },

    // YouTube Shorts
    { id: uuidv4(), inventory_id: invId('YouTube Shorts'), format: 'video', score: 9, reason: 'Vertical short-form, growing rapidly', best_size_spec: '1080x1920, 15-60s' },

    // LinkedIn Sponsored Content
    { id: uuidv4(), inventory_id: invId('LinkedIn Sponsored Content'), format: 'static', score: 8, reason: 'Professional imagery works well', best_size_spec: '1200x628 or 1080x1080' },
    { id: uuidv4(), inventory_id: invId('LinkedIn Sponsored Content'), format: 'video', score: 7, reason: 'Good for explainer content', best_size_spec: '1920x1080 or 1080x1080, 30-90s' },
    { id: uuidv4(), inventory_id: invId('LinkedIn Sponsored Content'), format: 'carousel', score: 8, reason: 'Document-style carousels perform well', best_size_spec: '1080x1080, 2-10 cards' },
    { id: uuidv4(), inventory_id: invId('LinkedIn Sponsored Content'), format: 'native', score: 7, reason: 'Thought leadership articles drive credibility', best_size_spec: 'Article format with hero image 1200x628' },

    // Twitter/X
    { id: uuidv4(), inventory_id: invId('Twitter/X Promoted Tweets'), format: 'static', score: 7, reason: 'Image tweets get more engagement', best_size_spec: '1200x675 or 1080x1080' },
    { id: uuidv4(), inventory_id: invId('Twitter/X Promoted Tweets'), format: 'video', score: 8, reason: 'Autoplay in feed drives views', best_size_spec: '1280x720, 15-30s' },

    // Disney+ Hotstar
    { id: uuidv4(), inventory_id: invId('Disney+ Hotstar'), format: 'video', score: 10, reason: 'Primary format for OTT', best_size_spec: '1920x1080, 10-30s' },
    { id: uuidv4(), inventory_id: invId('Disney+ Hotstar'), format: 'native', score: 6, reason: 'L-band and squeeze-back available during live sports', best_size_spec: 'Custom per placement' },

    // JioCinema
    { id: uuidv4(), inventory_id: invId('JioCinema'), format: 'video', score: 10, reason: 'Pre-roll and mid-roll video ads', best_size_spec: '1920x1080, 10-30s' },
    { id: uuidv4(), inventory_id: invId('JioCinema'), format: 'static', score: 5, reason: 'Banner overlays during content', best_size_spec: '728x90 or 300x250' },

    // Moneycontrol Display
    { id: uuidv4(), inventory_id: invId('Moneycontrol Display'), format: 'static', score: 8, reason: 'Display banners on premium finance pages', best_size_spec: '728x90, 300x250, 160x600' },
    { id: uuidv4(), inventory_id: invId('Moneycontrol Display'), format: 'native', score: 9, reason: 'Sponsored articles blend with editorial', best_size_spec: 'Sponsored content format' },
    { id: uuidv4(), inventory_id: invId('Moneycontrol Display'), format: 'rich_media', score: 7, reason: 'Expandable and interactive units available', best_size_spec: '300x250 expandable to 300x600' },
    { id: uuidv4(), inventory_id: invId('Moneycontrol Display'), format: 'video', score: 7, reason: 'Pre-roll on video content', best_size_spec: '1920x1080, 15-30s' },

    // Economic Times
    { id: uuidv4(), inventory_id: invId('Economic Times Display'), format: 'static', score: 8, reason: 'Premium display inventory', best_size_spec: '728x90, 300x250, 970x250' },
    { id: uuidv4(), inventory_id: invId('Economic Times Display'), format: 'native', score: 9, reason: 'Sponsored stories in ET editorial', best_size_spec: 'Article format' },

    // ShareChat
    { id: uuidv4(), inventory_id: invId('ShareChat'), format: 'video', score: 8, reason: 'Native video format for vernacular audience', best_size_spec: '1080x1920, 10-15s' },
    { id: uuidv4(), inventory_id: invId('ShareChat'), format: 'static', score: 6, reason: 'Feed image ads', best_size_spec: '1080x1080' },

    // Spotify
    { id: uuidv4(), inventory_id: invId('Spotify Audio Ads'), format: 'audio', score: 10, reason: 'Core format - audio ads between songs', best_size_spec: '15-30s audio, 640x640 companion banner' },

    // DV360
    { id: uuidv4(), inventory_id: invId('DV360 - Open Exchange'), format: 'static', score: 7, reason: 'Standard IAB display sizes across web', best_size_spec: '300x250, 728x90, 160x600, 320x50' },
    { id: uuidv4(), inventory_id: invId('DV360 - Open Exchange'), format: 'video', score: 8, reason: 'VAST/VPAID video across publishers', best_size_spec: '1920x1080, 15-30s' },
    { id: uuidv4(), inventory_id: invId('DV360 - Open Exchange'), format: 'native', score: 7, reason: 'Native display across exchanges', best_size_spec: '1200x628 with title and description' },

    // InMobi
    { id: uuidv4(), inventory_id: invId('InMobi'), format: 'interstitial', score: 8, reason: 'Full-screen mobile interstitials', best_size_spec: '320x480 or 1080x1920' },
    { id: uuidv4(), inventory_id: invId('InMobi'), format: 'rewarded', score: 7, reason: 'Rewarded video for app installs', best_size_spec: '1920x1080, 15-30s' },
    { id: uuidv4(), inventory_id: invId('InMobi'), format: 'static', score: 6, reason: 'Mobile banner ads', best_size_spec: '320x50, 300x250' },

    // Finshots
    { id: uuidv4(), inventory_id: invId('Finshots Newsletter'), format: 'native', score: 10, reason: 'Sponsored section within newsletter, highest trust', best_size_spec: '600px wide, inline with content' },

    // Apple Search
    { id: uuidv4(), inventory_id: invId('Apple Search Ads'), format: 'search_text', score: 10, reason: 'App Store search results format', best_size_spec: 'App icon + title + subtitle' },
  ];

  // ─────────────────────────────────────────────
  // AI INSIGHTS
  // ─────────────────────────────────────────────
  const aiInsights = [
    { id: uuidv4(), inventory_id: invId('Instagram Reels'), insight_type: 'opportunity', title: 'Reels CPMs dropping 15% QoQ', body: 'Instagram Reels CPMs have been declining steadily as Meta pushes adoption. Current CPMs are 30-40% lower than Feed. Recommend shifting 20% of Instagram Feed budget to Reels for better reach efficiency.', priority: 'high', is_read: 0 },
    { id: uuidv4(), inventory_id: invId('JioCinema'), insight_type: 'opportunity', title: 'JioCinema IPL 2026 inventory opening', body: 'JioCinema is offering early-bird rates for IPL 2026 season. Locking in inventory now could save 25-30% vs in-season rates. Estimated 500M+ streaming viewers this season.', priority: 'high', is_read: 0 },
    { id: uuidv4(), inventory_id: invId('YouTube Shorts'), insight_type: 'trend', title: 'YouTube Shorts monetization expanding', body: 'YouTube is rapidly expanding Shorts ad inventory. Early advertisers seeing 40-50% lower CPVs compared to standard in-stream. Finance content consumption on Shorts growing 80% YoY.', priority: 'medium', is_read: 0 },
    { id: uuidv4(), inventory_id: null, insight_type: 'whitespace', title: 'No competitor presence on Reddit India', body: 'Reddit India finance communities (r/IndiaInvestments, r/IndianStreetBets) have 2M+ combined subscribers with zero fintech ad presence. Early mover advantage available at low CPMs.', priority: 'medium', is_read: 0 },
    { id: uuidv4(), inventory_id: invId('Moneycontrol Display'), insight_type: 'benchmark', title: 'Moneycontrol CPMs increasing 20% YoY', body: 'Premium finance publisher CPMs are rising due to demand from BFSI advertisers. Consider locking annual deals for rate protection. Current rates still below industry ceiling.', priority: 'medium', is_read: 0 },
    { id: uuidv4(), inventory_id: invId('Google Search - UAC'), insight_type: 'warning', title: 'Google Search CPCs rising in finance vertical', body: 'Average CPCs for finance keywords up 18% in last quarter due to increased competition from Groww, Angel One, and INDmoney. Recommend expanding to long-tail keywords and improving Quality Scores.', priority: 'high', is_read: 0 },
    { id: uuidv4(), inventory_id: null, insight_type: 'seasonal', title: 'Tax season advertising window approaching', body: 'January-March is peak season for investment and tax-saving product advertising. Historically CPMs increase 30-40% during this period. Pre-book inventory and increase budgets by November.', priority: 'medium', is_read: 0 },
    { id: uuidv4(), inventory_id: invId('Finshots Newsletter'), insight_type: 'opportunity', title: 'Finshots expanding to 2M subscribers', body: 'Finshots newsletter has grown to 2M+ subscribers with 45%+ open rates. Their audience is exactly the fintech-savvy demographic. Limited sponsorship slots available - book quarterly.', priority: 'high', is_read: 0 },
    { id: uuidv4(), inventory_id: invId('LinkedIn Sponsored Content'), insight_type: 'benchmark', title: 'LinkedIn HNI targeting outperforms other channels', body: 'LinkedIn campaigns targeting users with Job Title containing Director/VP/CXO show 3x better conversion rates for wealth management products despite 5x higher CPMs. Net CPA is 40% lower.', priority: 'medium', is_read: 0 },
    { id: uuidv4(), inventory_id: invId('ShareChat'), insight_type: 'trend', title: 'Vernacular fintech adoption accelerating in Tier 2-3', body: 'ShareChat and Moj user data shows 120% growth in finance content consumption in Hindi, Tamil, and Telugu. Fintech brands running vernacular creatives seeing 2x better engagement vs English.', priority: 'medium', is_read: 0 },
  ];

  // ─────────────────────────────────────────────
  // ONBOARDING GUIDES (top 5 platforms)
  // ─────────────────────────────────────────────
  const onboardingGuides = [
    // Google UAC
    { id: uuidv4(), inventory_id: invId('Google Search - UAC'), step_number: 1, step_title: 'Create Google Ads Account', step_description: 'Sign up at ads.google.com with your business email. Select "App Promotion" as your campaign goal. Enter your app store listing URL.', estimated_time: '30 minutes', contact_name: 'Google Ads Support', contact_email: null, contact_phone: '1800-572-8309', contact_url: 'https://ads.google.com', minimum_commitment: 'No minimum, recommended ₹500/day', documents_required: 'GST certificate, Business PAN, Bank account details' },
    { id: uuidv4(), inventory_id: invId('Google Search - UAC'), step_number: 2, step_title: 'Setup Conversion Tracking', step_description: 'Install Firebase SDK or Google Analytics for Firebase. Configure app install and in-app event tracking. Set up conversion values for registration, KYC, and first investment.', estimated_time: '2-4 hours (dev required)', contact_name: null, contact_email: null, contact_phone: null, contact_url: 'https://firebase.google.com/docs/analytics', minimum_commitment: null, documents_required: null },
    { id: uuidv4(), inventory_id: invId('Google Search - UAC'), step_number: 3, step_title: 'Create UAC Campaign', step_description: 'Choose "App installs" or "In-app actions" as goal. Add 4-5 text ideas (30 char headlines), upload 20 landscape and 20 portrait images, add 5-10 video assets. Set target CPA based on your unit economics.', estimated_time: '2-3 hours', contact_name: null, contact_email: null, contact_phone: null, contact_url: null, minimum_commitment: null, documents_required: null },
    { id: uuidv4(), inventory_id: invId('Google Search - UAC'), step_number: 4, step_title: 'SEBI Compliance Setup', step_description: 'Apply for Google Financial Services advertiser verification. Submit SEBI registration certificate. Wait for approval (typically 3-5 business days). Add required disclaimers to ad copy.', estimated_time: '3-5 business days', contact_name: 'Google Policy Team', contact_email: 'advertiser-verification@google.com', contact_phone: null, contact_url: 'https://support.google.com/adspolicy/answer/12362048', minimum_commitment: null, documents_required: 'SEBI registration certificate, Company incorporation docs, Authorized signatory ID' },

    // Meta (Facebook + Instagram)
    { id: uuidv4(), inventory_id: invId('Meta Facebook Feed'), step_number: 1, step_title: 'Create Meta Business Account', step_description: 'Set up Meta Business Suite at business.facebook.com. Create an Ad Account. Link your Facebook Page and Instagram Business Account.', estimated_time: '1 hour', contact_name: 'Meta Business Help', contact_email: null, contact_phone: null, contact_url: 'https://business.facebook.com', minimum_commitment: 'No minimum, recommended ₹1000/day', documents_required: 'Business registration, GST certificate, Authorized person ID' },
    { id: uuidv4(), inventory_id: invId('Meta Facebook Feed'), step_number: 2, step_title: 'Install Meta Pixel & SDK', step_description: 'Install Meta Pixel on website for web conversions. Integrate Facebook SDK in mobile app for app events. Configure standard events: Install, CompleteRegistration, Purchase (for first investment).', estimated_time: '4-6 hours (dev required)', contact_name: null, contact_email: null, contact_phone: null, contact_url: 'https://developers.facebook.com/docs/meta-pixel', minimum_commitment: null, documents_required: null },
    { id: uuidv4(), inventory_id: invId('Meta Facebook Feed'), step_number: 3, step_title: 'Financial Services Ad Authorization', step_description: 'Navigate to Ad Account Settings > Financial Products/Services. Submit RBI/SEBI license details. Upload compliance documents. Authorization typically takes 5-7 business days.', estimated_time: '5-7 business days', contact_name: 'Meta Policy Team', contact_email: null, contact_phone: null, contact_url: 'https://www.facebook.com/business/help/financial-products-services-advertising', minimum_commitment: null, documents_required: 'SEBI registration, RBI authorization (if applicable), Company registration' },
    { id: uuidv4(), inventory_id: invId('Meta Facebook Feed'), step_number: 4, step_title: 'Create First Campaign', step_description: 'Use Campaign Budget Optimization (CBO). Start with Conversions objective targeting App Installs. Create 3-5 ad sets with different audiences: Lookalike 1%, Interest-based (Investing, Mutual Funds, Stock Market), Broad targeting. Upload 3-5 creatives per ad set.', estimated_time: '3-4 hours', contact_name: null, contact_email: null, contact_phone: null, contact_url: null, minimum_commitment: null, documents_required: null },

    // YouTube
    { id: uuidv4(), inventory_id: invId('YouTube Skippable'), step_number: 1, step_title: 'Link YouTube Channel to Google Ads', step_description: 'Ensure you have a YouTube channel for your brand. Go to Google Ads > Tools > Linked Accounts > YouTube. Link your channel for remarketing and engagement audiences.', estimated_time: '30 minutes', contact_name: null, contact_email: null, contact_phone: null, contact_url: 'https://ads.google.com', minimum_commitment: 'No minimum, recommended ₹2000/day for video', documents_required: null },
    { id: uuidv4(), inventory_id: invId('YouTube Skippable'), step_number: 2, step_title: 'Prepare Video Assets', step_description: 'Create 15s, 30s, and 60s versions of your ad. Ensure strong hook in first 5 seconds (key for skippable ads). Include clear CTA and app store badges. Upload to YouTube as unlisted videos.', estimated_time: '1-2 weeks (creative production)', contact_name: null, contact_email: null, contact_phone: null, contact_url: null, minimum_commitment: null, documents_required: null },
    { id: uuidv4(), inventory_id: invId('YouTube Skippable'), step_number: 3, step_title: 'Create Video Campaign', step_description: 'Select "Video" campaign type > "Drive conversions" goal. Choose "Skippable in-stream" ad format. Set target CPA bidding. Target by affinity (Banking & Finance), custom intent (competitor keywords), and remarketing audiences.', estimated_time: '2-3 hours', contact_name: null, contact_email: null, contact_phone: null, contact_url: null, minimum_commitment: null, documents_required: null },

    // LinkedIn
    { id: uuidv4(), inventory_id: invId('LinkedIn Sponsored Content'), step_number: 1, step_title: 'Create LinkedIn Campaign Manager Account', step_description: 'Go to linkedin.com/campaignmanager. Create a new ad account linked to your LinkedIn Company Page. Add billing information.', estimated_time: '30 minutes', contact_name: 'LinkedIn Marketing Solutions', contact_email: null, contact_phone: null, contact_url: 'https://business.linkedin.com/marketing-solutions', minimum_commitment: '₹500/day minimum, recommended ₹3000/day', documents_required: 'Business registration, Credit card or invoice billing setup' },
    { id: uuidv4(), inventory_id: invId('LinkedIn Sponsored Content'), step_number: 2, step_title: 'Install LinkedIn Insight Tag', step_description: 'Add the LinkedIn Insight Tag to your website for conversion tracking and website retargeting. Configure conversion events for sign-up, KYC completion, and first investment.', estimated_time: '1-2 hours (dev required)', contact_name: null, contact_email: null, contact_phone: null, contact_url: 'https://business.linkedin.com/marketing-solutions/insight-tag', minimum_commitment: null, documents_required: null },
    { id: uuidv4(), inventory_id: invId('LinkedIn Sponsored Content'), step_number: 3, step_title: 'Create Sponsored Content Campaign', step_description: 'Choose "Website conversions" or "Lead generation" objective. Target by Job Title, Company Size, Industry (Financial Services, IT), and Seniority (Manager+). Use Single Image, Carousel, or Video formats. Write professional copy with clear value proposition.', estimated_time: '2-3 hours', contact_name: null, contact_email: null, contact_phone: null, contact_url: null, minimum_commitment: null, documents_required: null },

    // Disney+ Hotstar
    { id: uuidv4(), inventory_id: invId('Disney+ Hotstar'), step_number: 1, step_title: 'Contact Hotstar Ad Sales', step_description: 'Reach out to Disney+ Hotstar advertising team via their self-serve platform or direct sales for premium inventory. For IPL and cricket, contact at least 2-3 months in advance.', estimated_time: '1-2 weeks for response', contact_name: 'Disney+ Hotstar Ad Sales', contact_email: 'adsales@hotstar.com', contact_phone: null, contact_url: 'https://www.hotstar.com/in/advertise', minimum_commitment: '₹5L minimum for self-serve, ₹25L+ for managed', documents_required: 'Brand deck, Campaign brief, SEBI registration' },
    { id: uuidv4(), inventory_id: invId('Disney+ Hotstar'), step_number: 2, step_title: 'Select Ad Format & Inventory', step_description: 'Choose from Pre-roll (10-30s), Mid-roll (during content breaks), Branded Content Cards, or Masthead takeovers. For cricket, select specific match days or tournament packages. Negotiate rates based on volume.', estimated_time: '1-2 weeks (negotiation)', contact_name: null, contact_email: null, contact_phone: null, contact_url: null, minimum_commitment: null, documents_required: null },
    { id: uuidv4(), inventory_id: invId('Disney+ Hotstar'), step_number: 3, step_title: 'Submit Creatives & Go Live', step_description: 'Submit video creatives in 1920x1080 (landscape) and 1080x1920 (portrait) for mobile. Allow 3-5 business days for creative review. Ensure SEBI disclaimers are visible. Set up tracking pixels for attribution.', estimated_time: '3-5 business days for review', contact_name: null, contact_email: null, contact_phone: null, contact_url: null, minimum_commitment: null, documents_required: 'Video creatives in specified formats, SEBI disclaimers' },
  ];

  // ─────────────────────────────────────────────
  // INSERT ALL DATA IN TRANSACTION
  // ─────────────────────────────────────────────
  const insertAll = db.transaction(() => {
    // Insert competitors
    const insertCompetitor = db.prepare(`
      INSERT INTO competitors (id, name, vertical, estimated_monthly_adspend, primary_channels)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const c of competitors) {
      insertCompetitor.run(c.id, c.name, c.vertical, c.estimated_monthly_adspend, c.primary_channels);
    }
    console.log(`  Inserted ${competitors.length} competitors`);

    // Insert inventories
    const insertInventory = db.prepare(`
      INSERT INTO inventories (id, name, category, platform_parent, country, min_cpm, max_cpm, pricing_model, estimated_monthly_reach, target_audience_fit, fintech_friendly, last_verified_date, status)
      VALUES (?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const inv of inventories) {
      insertInventory.run(inv.id, inv.name, inv.category, inv.platform_parent, inv.min_cpm, inv.max_cpm, inv.pricing_model, inv.estimated_monthly_reach, inv.target_audience_fit, inv.fintech_friendly, '2026-03-15', inv.status);
    }
    console.log(`  Inserted ${inventories.length} inventories`);

    // Insert existing inventories
    const insertExisting = db.prepare(`
      INSERT INTO existing_inventories (id, inventory_id, current_monthly_spend, current_cpm, current_cpc, current_ctr, current_cpa, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ei of existingInventories) {
      insertExisting.run(ei.id, ei.inventory_id, ei.current_monthly_spend, ei.current_cpm, ei.current_cpc, ei.current_ctr, ei.current_cpa, ei.notes);
    }
    console.log(`  Inserted ${existingInventories.length} existing inventories`);

    // Insert competitor spends
    const insertSpend = db.prepare(`
      INSERT INTO competitor_spends (id, competitor_id, inventory_id, estimated_monthly_spend, confidence_level, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const cs of competitorSpends) {
      if (cs.inventory_id) {
        insertSpend.run(cs.id, cs.competitor_id, cs.inventory_id, cs.estimated_monthly_spend, cs.confidence_level, cs.source);
      }
    }
    console.log(`  Inserted ${competitorSpends.filter(cs => cs.inventory_id).length} competitor spends`);

    // Insert budget recommendations
    const insertBudget = db.prepare(`
      INSERT INTO budget_recommendations (id, inventory_id, recommended_starting_budget, recommended_testing_budget, recommended_scale_budget, rationale, data_sources, confidence_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const br of budgetRecommendations) {
      insertBudget.run(br.id, br.inventory_id, br.recommended_starting_budget, br.recommended_testing_budget, br.recommended_scale_budget, br.rationale, br.data_sources, br.confidence_score);
    }
    console.log(`  Inserted ${budgetRecommendations.length} budget recommendations`);

    // Insert ad format scores
    const insertFormat = db.prepare(`
      INSERT INTO ad_format_scores (id, inventory_id, format, score, reason, best_size_spec)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const af of adFormatScores) {
      insertFormat.run(af.id, af.inventory_id, af.format, af.score, af.reason, af.best_size_spec);
    }
    console.log(`  Inserted ${adFormatScores.length} ad format scores`);

    // Insert AI insights
    const insertInsight = db.prepare(`
      INSERT INTO ai_insights (id, inventory_id, insight_type, title, body, priority, is_read)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ai of aiInsights) {
      insertInsight.run(ai.id, ai.inventory_id, ai.insight_type, ai.title, ai.body, ai.priority, ai.is_read);
    }
    console.log(`  Inserted ${aiInsights.length} AI insights`);

    // Insert onboarding guides
    const insertGuide = db.prepare(`
      INSERT INTO onboarding_guides (id, inventory_id, step_number, step_title, step_description, estimated_time, contact_name, contact_email, contact_phone, contact_url, minimum_commitment, documents_required)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const og of onboardingGuides) {
      insertGuide.run(og.id, og.inventory_id, og.step_number, og.step_title, og.step_description, og.estimated_time, og.contact_name, og.contact_email, og.contact_phone, og.contact_url, og.minimum_commitment, og.documents_required);
    }
    console.log(`  Inserted ${onboardingGuides.length} onboarding guide steps`);

    // Insert initial discovery log
    const insertLog = db.prepare(`
      INSERT INTO discovery_log (id, inventories_found, new_inventories, updated_inventories, ai_model_used, summary)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertLog.run(uuidv4(), inventories.length, inventories.length, 0, 'manual_seed', `Initial seed: ${inventories.length} inventories, ${competitors.length} competitors, ${competitorSpends.filter(cs => cs.inventory_id).length} competitor spend entries across all categories.`);
    console.log('  Inserted 1 discovery log entry');

    markSeeded();
    console.log('  Marked database as seeded');
  });

  insertAll();
  console.log('Seeding complete!');
}

// Run if called directly
if (require.main === module) {
  runSeed();
}

module.exports = { runSeed };
