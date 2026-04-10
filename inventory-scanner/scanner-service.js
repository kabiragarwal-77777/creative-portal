const fs = require('fs');
const path = require('path');
const { GoogleAdsApi } = require('google-ads-api');
const {
  CURATED_INVENTORIES,
  DAILY_DISCOVERY_WATCHLIST
} = require('./scanner-data');

const CACHE_DIR = path.join(__dirname, 'cache');
const SNAPSHOT_FILE = path.join(CACHE_DIR, 'inventory-snapshot.json');
const DISCOVERY_FILE = path.join(CACHE_DIR, 'inventory-discovery.json');
const META_CACHE_DIR = path.join(__dirname, '..', 'creative-intelligence');
const GOOGLE_CACHE_DIR = path.join(__dirname, '..', 'google-creative');
const DEFAULT_CVR = 0.032;
const LEAD_TO_CLIENT_RATE = 0.18;
const AVG_D6_REVENUE_PER_CLIENT = 8000;
const LEARNING_PHASE_BUFFER = 0.85;
const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
const DAILY_WINDOW_MS = 20 * 60 * 60 * 1000;
const LOCAL_PORT = process.env.PORT || 3000;

const META_PLACEMENT_MAP = {
  facebook_feed: 'facebook-feed',
  instagram_feed: 'instagram-feed',
  instagram_instagram_reels: 'instagram-reels',
  audience_network_an_classic: 'meta-audience-network',
  audience_network_rewarded_video: 'meta-audience-network'
};

const GOOGLE_NETWORK_MAP = {
  SEARCH: 'google-search',
  SEARCH_PARTNERS: 'google-search',
  CONTENT: 'google-display-network',
  DISCOVER: 'google-demand-gen',
  GMAIL: 'google-demand-gen'
};

let schedulerStarted = false;
let syncPromise = null;

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeJson(file, value) {
  ensureCacheDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function listLatestFile(dir, prefix) {
  try {
    return fs
      .readdirSync(dir)
      .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
      .map(name => ({
        file: path.join(dir, name),
        mtime: fs.statSync(path.join(dir, name)).mtimeMs
      }))
      .sort((a, b) => b.mtime - a.mtime)[0]?.file || null;
  } catch (_) {
    return null;
  }
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function unwrapData(payload) {
  if (!payload) return null;
  return payload.data || payload;
}

async function postLocalJson(endpoint, body) {
  try {
    const response = await fetch(`http://127.0.0.1:${LOCAL_PORT}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (_) {
    return null;
  }
}

function hasGoogleAdsCredentials() {
  return Boolean(
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CUSTOMER_ID &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN
  );
}

function createGoogleAdsCustomer() {
  const client = new GoogleAdsApi({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID,
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
    developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  });
  return client.Customer({
    customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
    login_customer_id: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN
  });
}

async function fetchMetaPlacementRows(forceRefresh, dateFrom, dateTo) {
  const live = await postLocalJson('/api/meta/apex-breakdowns', {
    dateFrom,
    dateTo,
    noCache: !!forceRefresh
  });
  const liveRows = unwrapData(live)?.breakdowns?.placement;
  if (Array.isArray(liveRows) && liveRows.length) {
    return { rows: liveRows, source: 'live' };
  }
  const latest = readJson(listLatestFile(META_CACHE_DIR, 'apex-breakdowns-cache-'));
  return {
    rows: latest?.data?.breakdowns?.placement || latest?.breakdowns?.placement || [],
    source: latest ? 'cache' : 'none'
  };
}

async function fetchMetaInsightRows(forceRefresh, dateFrom, dateTo) {
  const live = await postLocalJson('/api/meta/ad-insights-daily', {
    dateFrom,
    dateTo,
    noCache: !!forceRefresh
  });
  const liveRows = unwrapData(live);
  if (Array.isArray(liveRows) && liveRows.length) {
    return { rows: liveRows, source: 'live' };
  }
  const latest = readJson(listLatestFile(META_CACHE_DIR, 'insights-cache-'));
  return { rows: latest?.data || latest || [], source: latest ? 'cache' : 'none' };
}

async function fetchMetaFunnelRows(forceRefresh, dateFrom, dateTo) {
  const live = await postLocalJson('/api/metabase/ad-funnel', {
    dateFrom,
    dateTo,
    noCache: !!forceRefresh
  });
  const liveRows = unwrapData(live);
  if (Array.isArray(liveRows) && liveRows.length) {
    return { rows: liveRows, source: 'live' };
  }
  const latest = readJson(listLatestFile(META_CACHE_DIR, 'funnel-cache-'));
  return { rows: latest?.data || latest || [], source: latest ? 'cache' : 'none' };
}

async function fetchGoogleInsightRows(forceRefresh, dateFrom, dateTo) {
  const live = await postLocalJson('/api/google/ad-insights-daily', {
    dateFrom,
    dateTo,
    noCache: !!forceRefresh
  });
  const liveRows = unwrapData(live);
  if (Array.isArray(liveRows) && liveRows.length) {
    return { rows: liveRows, source: 'live' };
  }
  const latest = readJson(listLatestFile(GOOGLE_CACHE_DIR, 'insights-cache-'));
  return { rows: latest?.data || latest || [], source: latest ? 'cache' : 'none' };
}

async function fetchGoogleFunnelRows(forceRefresh, dateFrom, dateTo) {
  const live = await postLocalJson('/api/google/ad-funnel', {
    dateFrom,
    dateTo,
    noCache: !!forceRefresh
  });
  const liveRows = unwrapData(live);
  if (Array.isArray(liveRows) && liveRows.length) {
    return { rows: liveRows, source: 'live' };
  }
  const latest = readJson(listLatestFile(GOOGLE_CACHE_DIR, 'gc-funnel-cache-'));
  return { rows: latest?.data || latest || [], source: latest ? 'cache' : 'none' };
}

async function fetchGooglePlacementRows(dateFrom, dateTo) {
  if (!hasGoogleAdsCredentials()) {
    return { rows: [], source: 'none' };
  }
  try {
    const customer = createGoogleAdsCustomer();
    const rows = await customer.query(`
      SELECT
        segments.ad_network_type,
        campaign.id,
        campaign.name,
        campaign.advertising_channel_type,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions,
        metrics.all_conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
        AND campaign.status = 'ENABLED'
    `);
    return {
      rows: rows.map(row => ({
        network: row.segments.ad_network_type,
        campaign_id: String(row.campaign.id),
        campaign_name: row.campaign.name,
        campaign_type: row.campaign.advertising_channel_type,
        spend: number(row.metrics.cost_micros) / 1_000_000,
        impressions: number(row.metrics.impressions),
        clicks: number(row.metrics.clicks),
        conversions: number(row.metrics.conversions),
        conversion_value: number(row.metrics.all_conversions_value)
      })),
      source: 'live'
    };
  } catch (_) {
    return { rows: [], source: 'none' };
  }
}

function deriveClicks(spend, cpc, impressions, ctrPercent) {
  if (cpc > 0) return spend / cpc;
  if (impressions > 0 && ctrPercent > 0) return impressions * (ctrPercent / 100);
  return 0;
}

function aggregateMetaOverlay(rows) {
  const overlay = {};
  rows.forEach(row => {
    const id = META_PLACEMENT_MAP[row.placement];
    if (!id) return;
    const spend = number(row.spend_7d);
    const impressions = number(row.impressions_7d);
    const ctr = number(row.ctr_7d);
    const cpc = number(row.cpc_7d);
    const clicks = deriveClicks(spend, cpc, impressions, ctr);
    if (!overlay[id]) overlay[id] = { spend: 0, impressions: 0, clicks: 0, source: 'meta' };
    overlay[id].spend += spend;
    overlay[id].impressions += impressions;
    overlay[id].clicks += clicks;
  });
  Object.values(overlay).forEach(item => {
    item.current_cpm = item.impressions ? (item.spend * 1000) / item.impressions : 0;
    item.current_cpc = item.clicks ? item.spend / item.clicks : 0;
  });
  return overlay;
}

function aggregateGoogleOverlay(rows) {
  const overlay = {};
  rows.forEach(row => {
    const id = GOOGLE_NETWORK_MAP[String(row.network || '').toUpperCase()];
    if (!id) return;
    if (!overlay[id]) overlay[id] = { spend: 0, impressions: 0, clicks: 0, source: 'google' };
    overlay[id].spend += number(row.spend);
    overlay[id].impressions += number(row.impressions);
    overlay[id].clicks += number(row.clicks);
  });
  Object.values(overlay).forEach(item => {
    item.current_cpm = item.impressions ? (item.spend * 1000) / item.impressions : 0;
    item.current_cpc = item.clicks ? item.spend / item.clicks : 0;
  });
  return overlay;
}

function computeObservedCvr(insightRows, funnelRows) {
  const clicks = insightRows.reduce((sum, row) => sum + number(row.clicks), 0);
  const signups = funnelRows.reduce((sum, row) => sum + number(row.signups), 0);
  if (!clicks || !signups) return DEFAULT_CVR;
  return clamp(signups / clicks, 0.01, 0.12);
}

function priceFromCpm(cpm, ctrPercent) {
  if (!cpm || !ctrPercent) return 0;
  return cpm / (10 * ctrPercent);
}

function cpmFromCpc(cpc, ctrPercent) {
  if (!cpc || !ctrPercent) return 0;
  return cpc * 10 * ctrPercent;
}

function normalizePricing(basePricing, ctrBenchmark, cvr) {
  const pricing = JSON.parse(JSON.stringify(basePricing || {}));
  if (!pricing.CPC && pricing.CPM && ctrBenchmark) {
    pricing.CPC = {
      low: round(priceFromCpm(pricing.CPM.low, ctrBenchmark.high)),
      mid: round(priceFromCpm(pricing.CPM.mid, ctrBenchmark.mid)),
      high: round(priceFromCpm(pricing.CPM.high, ctrBenchmark.low))
    };
  }
  if (!pricing.CPM && pricing.CPC && ctrBenchmark) {
    pricing.CPM = {
      low: round(cpmFromCpc(pricing.CPC.low, ctrBenchmark.low)),
      mid: round(cpmFromCpc(pricing.CPC.mid, ctrBenchmark.mid)),
      high: round(cpmFromCpc(pricing.CPC.high, ctrBenchmark.high))
    };
  }
  if (!pricing.CPL && pricing.CPC) {
    pricing.CPL = {
      low: round(pricing.CPC.low / cvr),
      mid: round(pricing.CPC.mid / cvr),
      high: round(pricing.CPC.high / cvr)
    };
  }
  return pricing;
}

function predictionSpreadFor(inventory, liveOverlay) {
  if (liveOverlay?.spend > 0) return 0.12;
  if (inventory.benchmark_confidence === 'high') return 0.16;
  if (inventory.benchmark_confidence === 'medium') return 0.22;
  return 0.28;
}

function buildPredictions(pricing, inventory, liveOverlay) {
  const effectiveCpc = Number(liveOverlay?.current_cpc || pricing.CPC?.mid || 0);
  const effectiveCpl = effectiveCpc > 0 ? effectiveCpc / (inventory.observed_cvr || DEFAULT_CVR) : Number(pricing.CPL?.mid || 0);
  const midCac = effectiveCpl ? effectiveCpl / LEAD_TO_CLIENT_RATE : 0;
  const spread = predictionSpreadFor(inventory, liveOverlay);
  const lowCac = midCac ? midCac * (1 - spread) : 0;
  const highCac = midCac ? midCac * (1 + spread) : 0;
  const revenuePerLead = AVG_D6_REVENUE_PER_CLIENT * LEAD_TO_CLIENT_RATE;
  return {
    predicted_cac_range: { low: round(lowCac), mid: round(midCac), high: round(highCac) },
    predicted_roas_d6: {
      low: highCac ? round(revenuePerLead / highCac, 2) : 0,
      high: lowCac ? round(revenuePerLead / lowCac, 2) : 0
    }
  };
}

function confidenceForInventory(inventory, liveOverlay, platformCvrs) {
  if (liveOverlay?.spend > 0) return 'High';
  if ((inventory.platform === 'Google' && platformCvrs.google > DEFAULT_CVR) || (inventory.platform === 'Meta' && platformCvrs.meta > DEFAULT_CVR)) {
    return 'Medium';
  }
  return inventory.benchmark_confidence === 'high' ? 'Medium' : 'Low';
}

function buildInventoryEntry(inventory, liveOverlay, platformCvrs) {
  const cvr = inventory.platform === 'Meta' ? platformCvrs.meta : inventory.platform === 'Google' ? platformCvrs.google : DEFAULT_CVR;
  const pricing = normalizePricing(inventory.pricing, inventory.ctr_benchmark, cvr);
  const predicted = buildPredictions(pricing, { ...inventory, observed_cvr: cvr }, liveOverlay);
  const priceBand = pricing[inventory.primary_cost_model] || pricing.CPM || pricing.CPC || pricing.CPL || pricing.Fixed || pricing.CPV;
  const currentCpm = round(liveOverlay?.current_cpm || 0, 2);
  const benchmarkMidCpm = number(pricing.CPM?.mid);
  const efficiency = liveOverlay?.spend && benchmarkMidCpm
    ? round(((benchmarkMidCpm - currentCpm) / benchmarkMidCpm) * 100, 1)
    : null;
  return {
    ...inventory,
    pricing,
    status: liveOverlay?.spend > 0 ? 'active' : 'available',
    live_data: liveOverlay ? {
      monthly_spend: round(liveOverlay.spend),
      current_cpm: currentCpm,
      current_cpc: round(liveOverlay.current_cpc || 0, 2),
      efficiency_vs_benchmark_pct: efficiency
    } : null,
    competitor_count: inventory.competitors_active.length,
    primary_price_mid: priceBand ? number(priceBand.mid) : 0,
    confidence_level: confidenceForInventory(inventory, liveOverlay, platformCvrs),
    observed_cvr: round(cvr, 4),
    ...predicted
  };
}

async function runDailyDiscoveryWatchlist() {
  const previous = readJson(DISCOVERY_FILE) || {};
  const candidates = [];
  for (const source of DAILY_DISCOVERY_WATCHLIST) {
    try {
      const response = await fetch(source.url, { headers: { 'User-Agent': 'Mozilla/5.0 InventoryScanner/1.0' } });
      if (!response.ok) {
        candidates.push({ id: source.id, name: source.name, url: source.url, status: 'unreachable' });
        continue;
      }
      const html = (await response.text()).toLowerCase();
      const matched = source.keywords.every(keyword => html.includes(keyword.toLowerCase()));
      candidates.push({
        id: source.id,
        name: source.name,
        url: source.url,
        status: matched ? 'candidate' : 'watching'
      });
    } catch (_) {
      candidates.push({ id: source.id, name: source.name, url: source.url, status: 'error' });
    }
  }
  const payload = {
    lastRunAt: new Date().toISOString(),
    nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    previousRunAt: previous.lastRunAt || null,
    candidates
  };
  writeJson(DISCOVERY_FILE, payload);
  return payload;
}

async function buildSnapshot(options = {}) {
  const dateFrom = dateDaysAgo(30);
  const dateTo = todayIso();
  const [metaPlacements, metaInsights, metaFunnel, googlePlacements, googleInsights, googleFunnel] = await Promise.all([
    fetchMetaPlacementRows(options.forceRefresh, dateFrom, dateTo),
    fetchMetaInsightRows(options.forceRefresh, dateFrom, dateTo),
    fetchMetaFunnelRows(options.forceRefresh, dateFrom, dateTo),
    fetchGooglePlacementRows(dateFrom, dateTo),
    fetchGoogleInsightRows(options.forceRefresh, dateFrom, dateTo),
    fetchGoogleFunnelRows(options.forceRefresh, dateFrom, dateTo)
  ]);

  const discovery = options.skipDiscovery ? (readJson(DISCOVERY_FILE) || { candidates: [] }) : await runDailyDiscoveryWatchlist();
  const metaOverlay = aggregateMetaOverlay(metaPlacements.rows);
  const googleOverlay = aggregateGoogleOverlay(googlePlacements.rows);
  const overlay = { ...metaOverlay, ...googleOverlay };
  const platformCvrs = {
    meta: computeObservedCvr(metaInsights.rows, metaFunnel.rows),
    google: computeObservedCvr(googleInsights.rows, googleFunnel.rows)
  };
  const inventories = CURATED_INVENTORIES.map(item => buildInventoryEntry(item, overlay[item.inventory_id], platformCvrs));
  const apiUnavailable = [metaPlacements, metaInsights, metaFunnel, googlePlacements, googleInsights, googleFunnel].some(item => item.source === 'cache' || item.source === 'none');
  const snapshot = {
    generatedAt: new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
    warning: apiUnavailable ? 'API unavailable - showing last synced data' : null,
    sources: {
      meta: { placements: metaPlacements.source, insights: metaInsights.source, funnel: metaFunnel.source },
      google: { placements: googlePlacements.source, insights: googleInsights.source, funnel: googleFunnel.source }
    },
    platformCvrs,
    discovery,
    inventories
  };
  writeJson(SNAPSHOT_FILE, snapshot);
  return snapshot;
}

async function getDiscoverySnapshot(options = {}) {
  const cached = !options.forceRefresh && readJson(SNAPSHOT_FILE);
  if (cached) return cached;
  return buildSnapshot({ forceRefresh: false, skipDiscovery: false });
}

async function syncDiscoverySnapshot(options = {}) {
  if (syncPromise) return syncPromise;
  syncPromise = buildSnapshot({ forceRefresh: true, skipDiscovery: false }).finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

function pickTopInventories(inventories) {
  return [...inventories].sort((a, b) => {
    if (b.audience_quality_score !== a.audience_quality_score) return b.audience_quality_score - a.audience_quality_score;
    return a.predicted_cac_range.mid - b.predicted_cac_range.mid;
  }).slice(0, 5);
}

function goalWeight(inventory, goal) {
  const audience = inventory.audience_quality_score / 10;
  const cacComponent = inventory.predicted_cac_range.mid ? 1 / inventory.predicted_cac_range.mid : 0;
  const cpmComponent = inventory.pricing.CPM?.mid ? 1 / inventory.pricing.CPM.mid : 0;
  if (goal === 'maximize-leads') return cacComponent * 0.7 + audience * 0.3;
  if (goal === 'minimize-cac') return audience * 0.5 + cpmComponent * 0.5;
  return audience * 0.5 + cacComponent * 0.5;
}

function allocationRationale(goal, inventory, activePreferred) {
  if (activePreferred?.inventory_id === inventory.inventory_id) return 'Proven active Google/Meta placement kept above the floor for test stability.';
  if (goal === 'maximize-leads') return 'Weighted toward lower predicted CAC to maximize lead volume.';
  if (goal === 'minimize-cac') return 'Weighted toward audience quality and lower CPM to protect CAC.';
  return 'Balanced allocation between audience quality and predicted CAC.';
}

async function generateBudgetPlan(input) {
  const snapshot = await getDiscoverySnapshot();
  const inventoryIds = Array.isArray(input.inventoryIds) ? input.inventoryIds : [];
  const selected = inventoryIds
    .map(id => snapshot.inventories.find(item => item.inventory_id === id))
    .filter(Boolean)
    .sort((a, b) => {
      if (b.audience_quality_score !== a.audience_quality_score) return b.audience_quality_score - a.audience_quality_score;
      return a.predicted_cac_range.mid - b.predicted_cac_range.mid;
    });
  const limited = selected.length > 5 ? pickTopInventories(selected) : selected;
  const totalBudget = number(input.totalBudget);
  const goal = String(input.goal || 'balanced');
  const durationDays = number(input.durationDays || input.duration || 14) || 14;
  const activePreferred = limited.filter(item => item.status === 'active' && ['Google', 'Meta'].includes(item.platform))
    .sort((a, b) => a.predicted_cac_range.mid - b.predicted_cac_range.mid)[0] || null;

  const base = new Map(limited.map(item => [item.inventory_id, 0.15]));
  if (activePreferred) base.set(activePreferred.inventory_id, Math.max(0.2, base.get(activePreferred.inventory_id)));
  const baseShare = [...base.values()].reduce((sum, value) => sum + value, 0);
  const remainingShare = Math.max(0, 1 - baseShare);
  const weights = limited.map(item => goalWeight(item, goal));
  const weightSum = weights.reduce((sum, value) => sum + value, 0) || 1;

  const rows = limited.map((item, index) => {
    const allocationPct = base.get(item.inventory_id) + remainingShare * (weights[index] / weightSum);
    const allocatedBudget = totalBudget * allocationPct;
    const expectedLeads = item.predicted_cac_range.mid ? (allocatedBudget / item.predicted_cac_range.mid) * LEARNING_PHASE_BUFFER : 0;
    return {
      inventory: item.name,
      inventory_id: item.inventory_id,
      allocation_pct: round(allocationPct * 100, 1),
      allocated_budget: round(allocatedBudget),
      expected_leads: round(expectedLeads, 1),
      expected_cac: round(item.predicted_cac_range.mid),
      rationale: allocationRationale(goal, item, activePreferred)
    };
  });

  const highestRisk = [...limited].sort((a, b) => b.pricing.CPL.mid - a.pricing.CPL.mid)[0] || null;
  return {
    selected_count: selected.length,
    recommended_top_five: selected.length > 5 ? limited.map(item => item.name) : [],
    selection_warning: selected.length > 5 ? 'More than 5 inventories selected. Only the top 5 will be used in the plan.' : null,
    budget_allocation_table: rows,
    initiation_sequence: {
      phase_1: `Day 1-3: Launch ${rows.slice(0, 2).map(row => row.inventory).join(' and ')} first to establish benchmark CPL and creative fit.`,
      phase_2: `Day 4-7: Add ${rows.slice(2, 4).map(row => row.inventory).join(' and ') || 'the next best inventory'} once early signal quality is stable.`,
      phase_3: `Day 8-${durationDays}: Scale the winners, cut weak placements, and reallocate into the best two inventories by qualified lead rate.`
    },
    watch_metrics: {
      primary_kpi: 'Cost per Lead',
      secondary_kpi: 'Lead-to-meeting rate',
      red_flag: highestRisk ? `CPL > ${Math.round(highestRisk.pricing.CPL.high)} for more than 3 days -> pause ${highestRisk.name}` : null
    },
    compliance_checklist: {
      sebi_disclaimer_required_on: limited.map(item => item.name),
      google_financial_services_verification: limited.some(item => item.platform === 'Google') ? 'Required before scaling regulated Google campaigns.' : 'Not selected.',
      meta_financial_products_policy: limited.some(item => item.platform === 'Meta') ? 'Review finance claims, landing-page disclosures, and business verification before scaling.' : 'Not selected.'
    }
  };
}

function ensureInventoryScannerScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setTimeout(() => {
    syncDiscoverySnapshot({ reason: 'startup' }).catch(() => null);
  }, 5000);
  setInterval(() => {
    const cached = readJson(SNAPSHOT_FILE);
    const lastSyncAt = cached?.lastSyncedAt ? new Date(cached.lastSyncedAt).getTime() : 0;
    if (Date.now() - lastSyncAt > DAILY_WINDOW_MS) {
      syncDiscoverySnapshot({ reason: 'scheduled' }).catch(() => null);
      return;
    }
    const discovery = readJson(DISCOVERY_FILE);
    const lastDiscoveryAt = discovery?.lastRunAt ? new Date(discovery.lastRunAt).getTime() : 0;
    if (Date.now() - lastDiscoveryAt > DAILY_WINDOW_MS) {
      runDailyDiscoveryWatchlist().catch(() => null);
    }
  }, SCHEDULER_INTERVAL_MS);
}

module.exports = {
  ensureInventoryScannerScheduler,
  generateBudgetPlan,
  getDiscoverySnapshot,
  syncDiscoverySnapshot
};
