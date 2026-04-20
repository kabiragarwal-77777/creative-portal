const axios = require('axios');
const crypto = require('crypto');
const { redisGetJson, redisSetJson } = require('./utils/redis-cache');

function log(msg) {
  console.log(`[competitor-apify-fetcher] ${new Date().toISOString()} ${msg}`);
}

function trim(str, max = 240) {
  const value = String(str || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}…`;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

function rootHost(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function isProbablyBadHost(hostname) {
  if (!hostname) return true;
  return [
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'youtube.com',
    'x.com',
    'twitter.com',
    'crunchbase.com',
    'tracxn.com',
    'justdial.com',
    'google.com',
    'maps.google.com',
    'play.google.com',
    'apps.apple.com',
    'pinterest.com',
    'reddit.com'
  ].some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
}

function createContentHash(parts) {
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex');
}

function defaultCompetitorGroups() {
  return {
    RA: (process.env.COMPETITOR_LIST_RA || 'Samco,StockGro,Sensibull,Definedge,Weekend Investing,Capitalmind,Dhan')
      .split(',').map(s => s.trim()).filter(Boolean),
    Broking: (process.env.COMPETITOR_LIST_BROKING || 'Zerodha,Groww,Angel One,Upstox,5paisa,Dhan,Paytm Money')
      .split(',').map(s => s.trim()).filter(Boolean)
  };
}

function uniqueCompetitors(groups) {
  return [...new Set(Object.values(groups).flat())];
}

function buildVerticalMap(groups) {
  const map = {};
  for (const [vertical, names] of Object.entries(groups)) {
    for (const name of names) {
      if (!map[name]) map[name] = [];
      map[name].push(vertical);
    }
  }
  return map;
}

function extractKeywordSignals(text) {
  const source = String(text || '').toLowerCase();
  const pricing = [];
  const proof = [];
  const cta = [];
  const features = [];
  const compliance = [];

  const pricingPatterns = [
    /\bfree\b/g,
    /\bzero\b/g,
    /₹\s?\d[\d,]*/g,
    /\$\s?\d[\d,.]*/g,
    /\b\d+%\s?(?:off|discount|commission)\b/g,
    /\bbrokerage\b/g,
    /\btrial\b/g
  ];
  const proofPatterns = [
    /\b\d+\s?(?:lakh|crore|million|k|m)\b/g,
    /\btrusted\b/g,
    /\breviews?\b/g,
    /\brating\b/g,
    /\bsebi\b/g,
    /\bregistered\b/g
  ];
  const ctaPatterns = [
    /\bopen account\b/g,
    /\bsign up\b/g,
    /\bregister\b/g,
    /\bget started\b/g,
    /\blearn more\b/g,
    /\btry free\b/g,
    /\bdownload\b/g
  ];
  const featurePatterns = [
    /\balg[o]?\b/g,
    /\bapi\b/g,
    /\bportfolio\b/g,
    /\bdashboard\b/g,
    /\balerts?\b/g,
    /\bcalculator\b/g,
    /\binvest\b/g
  ];
  const compliancePatterns = [
    /\bsebi\b/g,
    /\brbi\b/g,
    /\bregulated\b/g,
    /\bcompliance\b/g,
    /\bkyc\b/g
  ];

  const pushMatches = (bucket, patterns) => {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match) bucket.push(...match.map(s => s.trim()).filter(Boolean));
    }
  };

  pushMatches(pricing, pricingPatterns);
  pushMatches(proof, proofPatterns);
  pushMatches(cta, ctaPatterns);
  pushMatches(features, featurePatterns);
  pushMatches(compliance, compliancePatterns);

  const dedupe = arr => [...new Set(arr.map(s => s.trim()).filter(Boolean))].slice(0, 6);
  return {
    pricing: dedupe(pricing),
    proof: dedupe(proof),
    cta: dedupe(cta),
    features: dedupe(features),
    compliance: dedupe(compliance)
  };
}

function pageKindFromUrl(url, title) {
  const value = `${url || ''} ${title || ''}`.toLowerCase();
  if (value.includes('pricing') || value.includes('plans') || value.includes('fees')) return 'pricing';
  if (value.includes('feature')) return 'features';
  if (value.includes('compare') || value.includes('vs') || value.includes('alternative')) return 'comparison';
  if (value.includes('faq') || value.includes('help') || value.includes('support')) return 'faq';
  if (value.includes('about')) return 'about';
  if (value.includes('blog') || value.includes('insight') || value.includes('news')) return 'blog';
  if (value.includes('review') || value.includes('testimonial')) return 'social_proof';
  if (!url) return 'unknown';
  return 'homepage';
}

function compactText(...parts) {
  return trim(parts.filter(Boolean).join(' '), 900);
}

function textTags(...parts) {
  const blob = parts.filter(Boolean).join(' ').toLowerCase();
  const tags = [];
  if (/pricing|price|free|trial|discount|offer|coupon|0 brokerage|rs\.?\s?0|₹0/.test(blob)) tags.push('offer');
  if (/sebi|registered|regulated|trust|compliance|disclaimer/.test(blob)) tags.push('trust');
  if (/video|youtube|reel|instagram|story/.test(blob)) tags.push('video');
  if (/compare|comparison|vs\.?|versus/.test(blob)) tags.push('comparison');
  if (/learn|education|guide|course|webinar|blog|tutorial/.test(blob)) tags.push('education');
  if (/search|serp|ranking|query/.test(blob)) tags.push('search');
  if (/landing|homepage|pricing|product|feature|website|web/.test(blob)) tags.push('web');
  return [...new Set(tags)];
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch (_) {
    return fallback;
  }
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function ageMinutes(ts) {
  if (!ts) return null;
  const value = new Date(ts).getTime();
  if (!Number.isFinite(value)) return null;
  return Math.max(0, (Date.now() - value) / 60000);
}

function freshnessFromTs(ts) {
  const mins = ageMinutes(ts);
  if (mins === null) return { label: 'unknown', age_minutes: null, age_hours: null, score: 0 };
  if (mins < 60) return { label: 'fresh', age_minutes: Math.round(mins), age_hours: Number((mins / 60).toFixed(2)), score: 1 };
  if (mins < 24 * 60) return { label: 'recent', age_minutes: Math.round(mins), age_hours: Number((mins / 60).toFixed(2)), score: 0.75 };
  if (mins < 7 * 24 * 60) return { label: 'stale', age_minutes: Math.round(mins), age_hours: Number((mins / 60).toFixed(2)), score: 0.35 };
  return { label: 'old', age_minutes: Math.round(mins), age_hours: Number((mins / 60).toFixed(2)), score: 0.1 };
}

function costHint(kind, note) {
  return {
    tier: 'free-tier-friendly',
    level: 'low',
    estimated_usd: 0,
    kind,
    note
  };
}

function toActorPath(actorId) {
  return String(actorId || '').replace('/', '~');
}

function unwrapItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

function collectSerpResults(items) {
  const queries = [];
  const organic = [];
  const peopleAlsoAsk = [];
  const relatedSearches = [];
  const aiOverviews = [];
  const ads = [];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const query = (item.searchQuery && typeof item.searchQuery === 'object'
      ? item.searchQuery.term || item.searchQuery.query || item.searchQuery.searchTerm || ''
      : item.query || item.searchQuery || item.searchTerm || item.keyword || '');
    if (query) queries.push(query);

    const type = String(item.type || '').toLowerCase();
    if (type === 'searchresult' || type === 'organic' || (item.link && item.title && !item.question)) {
      organic.push({ ...item, query });
      continue;
    }
    if (type === 'peoplealsoask' || type === 'people_also_ask' || item.question) {
      peopleAlsoAsk.push(item);
      continue;
    }
    if (type === 'relatedsearch' || type === 'relatedsearches' || item.relatedQueries) {
      relatedSearches.push(item);
      continue;
    }
    if (type === 'ad') {
      ads.push(item);
      continue;
    }

    if (Array.isArray(item.results)) {
      organic.push(...item.results.map(result => ({ ...result, query })));
    }
    if (Array.isArray(item.organicResults)) {
      organic.push(...item.organicResults.map(result => ({ ...result, query })));
    }
    if (Array.isArray(item.peopleAlsoAsk)) peopleAlsoAsk.push(...item.peopleAlsoAsk);
    if (Array.isArray(item.relatedSearches)) relatedSearches.push(...item.relatedSearches);
    if (Array.isArray(item.queryFanOut)) relatedSearches.push(...item.queryFanOut);
    if (Array.isArray(item.aiOverviews)) aiOverviews.push(...item.aiOverviews);
    if (Array.isArray(item.ads)) ads.push(...item.ads);
  }

  return {
    queries: [...new Set(queries)],
    organic,
    peopleAlsoAsk,
    relatedSearches,
    aiOverviews,
    ads
  };
}

function chooseStartUrls(serp, competitorName) {
  const urls = [];
  const firstNonBadHost = (() => {
    for (const result of serp.organic) {
      const url = result.url || result.link || result.siteUrl || '';
      const host = rootHost(url);
      if (url && !isProbablyBadHost(host)) return host;
    }
    return '';
  })();

  for (const result of serp.organic) {
    const url = result.url || result.link || result.siteUrl || '';
    const host = rootHost(url);
    if (!url || isProbablyBadHost(host)) continue;
    if (firstNonBadHost && host !== firstNonBadHost) continue;
    urls.push(url);
    if (urls.length >= 2) break;
  }

  if (!urls.length && serp.organic.length) {
    for (const result of serp.organic) {
      const url = result.url || result.link || result.siteUrl || '';
      const host = rootHost(url);
      if (!url || isProbablyBadHost(host)) continue;
      urls.push(url);
      if (urls.length >= 2) break;
    }
  }

  if (!urls.length && competitorName) {
    const querySlug = encodeURIComponent(competitorName);
    urls.push(`https://www.google.com/search?q=${querySlug}`);
  }

  return [...new Set(urls)].slice(0, 2);
}

function summarizeSerp(serp, competitorName) {
  const topOrganic = serp.organic.slice(0, 5).map((result, index) => {
    const title = result.title || result.name || result.heading || 'Untitled result';
    const desc = result.description || result.snippet || result.text || '';
    const url = result.url || result.link || result.siteUrl || '';
    return `${index + 1}. ${title}${url ? ` (${url})` : ''}${desc ? ` - ${trim(desc, 140)}` : ''}`;
  });
  const paa = serp.peopleAlsoAsk.slice(0, 5).map(item => {
    if (typeof item === 'string') return item;
    return item.question || item.text || item.title || '';
  }).filter(Boolean);
  const related = serp.relatedSearches.slice(0, 6).map(item => {
    if (typeof item === 'string') return item;
    return item.query || item.text || item.title || item.keyword || '';
  }).filter(Boolean);
  const ai = serp.aiOverviews.slice(0, 2).map(item => trim(typeof item === 'string' ? item : item.text || item.title || item.summary || '', 220)).filter(Boolean);

  return compactText(
    `${competitorName} SERP snapshot.`,
    topOrganic.length ? `Top results: ${topOrganic.join(' | ')}` : '',
    paa.length ? `People also ask: ${paa.join(' | ')}` : '',
    related.length ? `Related searches: ${related.join(' | ')}` : '',
    ai.length ? `AI overview: ${ai.join(' | ')}` : ''
  );
}

function normalizeWebsitePage({ competitor, verticals, record, fetchedAt, actorId, primaryUrl }) {
  const crawl = record.crawl && typeof record.crawl === 'object' ? record.crawl : {};
  const url = record.loadedUrl || crawl.loadedUrl || record.url || primaryUrl || '';
  const title = record.title || '';
  const description = record.description || '';
  const text = compactText(title, description, record.text || record.markdown || record.content || '');
  const kind = pageKindFromUrl(url, title);
  const signals = extractKeywordSignals(text);
  const baseId = `${slugify(competitor)}:${slugify(kind)}:${slugify(url || title || primaryUrl)}`;
  const contentHash = createContentHash([
    competitor,
    kind,
    url,
    title,
    description,
    trim(record.text || record.markdown || record.content || '', 1200)
  ]);

  return {
    id: `apify:web:${baseId}`,
    source: 'apify',
    source_type: 'website',
    competitor,
    vertical: verticals[0] || null,
    verticals,
    page_name: competitor,
    page_kind: kind,
    url,
    title,
    description,
    text,
    summary: trim(text, 300),
    content_hash: contentHash,
    query: null,
    rank: null,
    depth: typeof record.depth === 'number' ? record.depth : (typeof crawl.depth === 'number' ? crawl.depth : null),
    status_code: record.httpStatusCode || record.statusCode || crawl.statusCode || null,
    language: record.languageCode || record.language || crawl.language || null,
    signals,
    ad_creative_body: compactText(title, description, text),
    ad_creative_link_title: title || competitor,
    ad_creative_link_caption: rootHost(url) || competitor,
    ad_delivery_start_time: fetchedAt,
    ad_delivery_stop_time: null,
    ad_snapshot_url: url || null,
    publisher_platforms: ['web'],
    platform: ['web'],
    format: 'Static',
    status: 'Active',
    source_actor: actorId,
    fetched_at: fetchedAt,
    _intel_kind: 'website'
  };
}

function normalizeSerpRecord({ competitor, verticals, serp, fetchedAt, actorId }) {
  const summary = summarizeSerp(serp, competitor);
  const contentHash = createContentHash([
    competitor,
    summary,
    JSON.stringify(serp.organic.slice(0, 8)),
    JSON.stringify(serp.peopleAlsoAsk.slice(0, 5)),
    JSON.stringify(serp.relatedSearches.slice(0, 5))
  ]);

  const firstOrganic = serp.organic[0] || {};
  const url = firstOrganic.url || firstOrganic.link || firstOrganic.siteUrl || null;
  const title = firstOrganic.title || firstOrganic.name || `${competitor} SERP`;

  return {
    id: `apify:serp:${slugify(competitor)}:${slugify(url || title)}`,
    source: 'apify',
    source_type: 'serp',
    competitor,
    vertical: verticals[0] || null,
    verticals,
    page_name: competitor,
    page_kind: 'serp',
    url,
    title,
    description: firstOrganic.description || firstOrganic.snippet || '',
    text: summary,
    summary,
    content_hash: contentHash,
    query: serp.queries.join(' | ') || null,
    rank: 1,
    depth: 0,
    status_code: 200,
    language: null,
    signals: {
      pricing: [],
      proof: [],
      cta: [],
      features: []
    },
    ad_creative_body: summary,
    ad_creative_link_title: title,
    ad_creative_link_caption: url ? rootHost(url) : competitor,
    ad_delivery_start_time: fetchedAt,
    ad_delivery_stop_time: null,
    ad_snapshot_url: url || null,
    publisher_platforms: ['web'],
    platform: ['web'],
    format: 'Static',
    status: 'Active',
    source_actor: actorId,
    fetched_at: fetchedAt,
    _intel_kind: 'serp',
    _serp: {
      queries: serp.queries,
      organic: serp.organic.slice(0, 10),
      peopleAlsoAsk: serp.peopleAlsoAsk.slice(0, 5),
      relatedSearches: serp.relatedSearches.slice(0, 10),
      ads: serp.ads.slice(0, 10)
    }
  };
}

module.exports = function (config = {}) {
  const apifyToken = config.apifyToken || process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN || '';
  const serpActor = config.serpActor || process.env.APIFY_SERP_ACTOR || 'apify/google-search-scraper';
  const websiteActor = config.websiteActor || process.env.APIFY_WEBSITE_ACTOR || 'apify/website-content-crawler';
  const cacheTtlHours = parseFloat(process.env.COMPETITOR_APIFY_CACHE_TTL_HOURS) || 24;
  const cacheTtlMs = Math.max(1, cacheTtlHours) * 60 * 60 * 1000;
  const maxWebsitePages = Math.max(1, parseInt(process.env.COMPETITOR_APIFY_MAX_WEBSITE_PAGES || '5', 10) || 5);
  const maxSerpPages = Math.max(1, parseInt(process.env.COMPETITOR_APIFY_MAX_SERP_PAGES || '1', 10) || 1);
  const maxStartUrls = Math.max(1, parseInt(process.env.COMPETITOR_APIFY_MAX_START_URLS || '2', 10) || 2);
  const trackedGroups = defaultCompetitorGroups();
  const trackedCompetitors = typeof config.getTrackedCompetitors === 'function'
    ? [...new Set((config.getTrackedCompetitors() || []).filter(Boolean))]
    : uniqueCompetitors(trackedGroups);
  const verticalMap = typeof config.getVerticalMap === 'function' ? config.getVerticalMap() : buildVerticalMap(trackedGroups);

  const cache = {
    competitors: {},
    lastFetchTime: null,
    connection: null,
    connectionCheckedAt: null,
    statusSnapshot: null,
    statusSnapshotAt: null,
    insightsSnapshots: new Map()
  };
  const statusCacheTtlMs = Math.max(5, parseInt(process.env.COMPETITOR_APIFY_STATUS_CACHE_MINUTES || '30', 10) || 30) * 60 * 1000;
  const insightsCacheTtlMs = Math.max(5, parseInt(process.env.COMPETITOR_APIFY_INSIGHTS_CACHE_MINUTES || '15', 10) || 15) * 60 * 1000;
  const configuredTargets = loadConfiguredTargets();

  function cacheKeyForCompetitor(name) {
    return `creative-portal:competitor-apify:${slugify(name)}`;
  }

  async function loadCachedEntry(name) {
    const key = slugify(name);
    if (cache.competitors[key]) return cache.competitors[key];
    const stored = await redisGetJson(cacheKeyForCompetitor(name));
    if (stored) {
      cache.competitors[key] = stored;
      return stored;
    }
    return null;
  }

  async function persistEntry(name, entry) {
    const key = slugify(name);
    cache.competitors[key] = entry;
    cache.lastFetchTime = Date.now();
    cache.insightsSnapshots.clear();
    cache.statusSnapshot = null;
    cache.statusSnapshotAt = null;
    void redisSetJson(cacheKeyForCompetitor(name), entry, cacheTtlMs);
  }

  function loadConfiguredTargets() {
    const rawSources = [
      config.apifyTargets,
      config.apifyScanPlan,
      process.env.COMPETITOR_APIFY_TARGETS,
      process.env.COMPETITOR_APIFY_SCAN_PLAN,
      process.env.APIFY_COMPETITOR_TARGETS_JSON,
      process.env.APIFY_RUN_TARGETS_JSON
    ];

    const targets = [];
    for (const source of rawSources) {
      const parsed = safeJsonParse(source, null);
      if (Array.isArray(parsed)) {
        for (const target of parsed) {
          const normalized = normalizeTarget(target);
          if (normalized) targets.push(normalized);
        }
      }
    }

    const actorId = process.env.APIFY_RUN_ACTOR_ID || process.env.APIFY_COMPETITOR_ACTOR_ID || '';
    const taskId = process.env.APIFY_RUN_TASK_ID || process.env.APIFY_COMPETITOR_TASK_ID || '';
    if (actorId) {
      targets.push(normalizeTarget({
        actorId,
        label: process.env.APIFY_RUN_ACTOR_LABEL || actorId,
        input: safeJsonParse(process.env.APIFY_RUN_ACTOR_INPUT_JSON, {}),
        sourceType: process.env.APIFY_RUN_ACTOR_SOURCE_TYPE || 'website'
      }));
    }
    if (taskId) {
      targets.push(normalizeTarget({
        taskId,
        label: process.env.APIFY_RUN_TASK_LABEL || taskId,
        input: safeJsonParse(process.env.APIFY_RUN_TASK_INPUT_JSON, {}),
        sourceType: process.env.APIFY_RUN_TASK_SOURCE_TYPE || 'website'
      }));
    }

    const deduped = new Map();
    for (const target of targets) {
      if (!target) continue;
      const key = `${target.actorId || ''}|${target.taskId || ''}|${target.label || ''}`;
      if (!deduped.has(key)) deduped.set(key, target);
    }
    return [...deduped.values()];
  }

  function normalizeTarget(target) {
    if (!target || typeof target !== 'object') return null;
    const actorId = String(target.actorId || target.actor_id || '').trim();
    const taskId = String(target.taskId || target.task_id || '').trim();
    if (!actorId && !taskId) return null;
    return {
      actorId: actorId || null,
      taskId: taskId || null,
      label: String(target.label || target.name || actorId || taskId || 'Apify target').trim(),
      competitor: target.competitor || target.brand || null,
      sourceType: String(target.sourceType || target.source_type || (target.query ? 'serp' : 'website')).toLowerCase(),
      input: target.input && typeof target.input === 'object' ? target.input : safeJsonParse(target.input, {}),
      url: target.url || target.startUrl || (Array.isArray(target.startUrls) ? target.startUrls[0] : null) || null,
      maxItems: clampInt(target.maxItems || target.max_items, 20, 1, 100),
      timeoutSeconds: clampInt(target.timeoutSeconds || target.timeout, 120, 10, 1800),
      costHint: target.costHint || target.cost_hint || null
    };
  }

  async function apifyApiRequest(method, endpoint, { params = {}, data = null, timeoutMs = 60000 } = {}) {
    if (!apifyToken) {
      throw new Error('APIFY_TOKEN is not configured');
    }
    const response = await axios.request({
      method,
      url: `https://api.apify.com/v2${endpoint}`,
      params,
      data,
      timeout: timeoutMs,
      headers: {
        Authorization: `Bearer ${apifyToken}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data;
  }

  function extractList(response) {
    if (Array.isArray(response)) return response;
    if (response && Array.isArray(response.items)) return response.items;
    if (response && response.data && Array.isArray(response.data.items)) return response.data.items;
    return [];
  }

  function normalizeRunSummary(run) {
    const observedAt = run.finishedAt || run.startedAt || run.createdAt || new Date().toISOString();
    const actorId = run.actId || run.actorId || null;
    const taskId = run.actorTaskId || null;
    const bits = [];
    if (run.status) bits.push(String(run.status).toLowerCase());
    if (run.usageTotalUsd !== undefined && run.usageTotalUsd !== null) bits.push(`$${Number(run.usageTotalUsd).toFixed(4)}`);
    return {
      id: run.id || createContentHash([observedAt, actorId || '', taskId || '']),
      source: 'apify:run',
      url: run.url || `https://api.apify.com/v2/actor-runs/${encodeURIComponent(run.id || '')}`,
      title: run.name || actorId || taskId || 'Apify run',
      observed_at: observedAt,
      observedAt,
      startedAt: run.startedAt || run.createdAt || observedAt,
      createdAt: run.createdAt || observedAt,
      finishedAt: run.finishedAt || observedAt,
      delta_summary: bits.join(' | ') || 'Recent run',
      tags: [...textTags(run.name, run.status, actorId, taskId), 'run', String(run.status || '').toLowerCase()].filter(Boolean),
      freshness: freshnessFromTs(observedAt),
      cost_hint: costHint('run-metadata', 'Recent run lookups are cheap and help anchor what changed.'),
      actor_id: actorId,
      task_id: taskId,
      dataset_id: run.defaultDatasetId || null
    };
  }

  function normalizeDatasetSummary(dataset) {
    const observedAt = dataset.modifiedAt || dataset.createdAt || new Date().toISOString();
    const itemCount = typeof dataset.itemCount === 'number' ? dataset.itemCount : null;
    return {
      id: dataset.id || createContentHash([observedAt, dataset.name || '']),
      source: 'apify:dataset',
      url: dataset.itemsUrl || `https://api.apify.com/v2/datasets/${encodeURIComponent(dataset.id || '')}/items?format=json&clean=1`,
      title: dataset.name || dataset.id || 'Apify dataset',
      observed_at: observedAt,
      observedAt,
      createdAt: dataset.createdAt || observedAt,
      modifiedAt: dataset.modifiedAt || observedAt,
      delta_summary: itemCount !== null ? `${itemCount} items` : 'Dataset metadata',
      tags: [...textTags(dataset.name, 'dataset', dataset.id), 'dataset', 'storage'].filter(Boolean),
      freshness: freshnessFromTs(observedAt),
      cost_hint: costHint('dataset-metadata', 'Dataset metadata is cheap to list; item sampling stays capped.'),
      item_count: itemCount
    };
  }

  function normalizeIntelRecord(record, context = {}) {
    const observedAt = record.observed_at || record.observedAt || record.fetched_at || record.fetchedAt || new Date().toISOString();
    const url = record.url || record.ad_snapshot_url || null;
    const title = record.title || record.ad_creative_link_title || record.page_name || record.name || url || 'Apify intel';
    const summary = record.delta_summary || record.summary || record.description || record.text || record.ad_creative_body || record.ad_creative_link_caption || '';
    return {
      id: record.id || createContentHash([context.competitor || record.competitor || '', url || '', title || '', observedAt || '']),
      source: record.source || context.source || 'apify:intel',
      url,
      title,
      observed_at: observedAt,
      delta_summary: trim(summary, 220),
      tags: [...textTags(title, summary, record.page_kind, record.source_type, context.sourceType), ...(Array.isArray(record.tags) ? record.tags : []), 'intel'].filter(Boolean),
      freshness: freshnessFromTs(observedAt),
      cost_hint: costHint('cached-intel', 'This uses already-fetched competitor intel from the local cache.'),
      competitor: record.competitor || context.competitor || null,
      source_type: record.source_type || context.sourceType || null,
      page_kind: record.page_kind || null
    };
  }

  async function apifyRequest(actorId, input, options = {}) {
    if (!apifyToken) {
      throw new Error('APIFY_TOKEN is not configured');
    }

    const path = `/acts/${toActorPath(actorId)}/run-sync-get-dataset-items`;
    const resp = await axios.post(`https://api.apify.com/v2${path}`, input, {
      headers: {
        Authorization: `Bearer ${apifyToken}`,
        'Content-Type': 'application/json'
      },
      params: {
        clean: 'true',
        maxItems: options.maxItems || undefined
      },
      timeout: options.timeoutMs || 180000
    });

    return resp.data;
  }

  async function verifyConnection(force = false) {
    const checkedRecently = cache.connectionCheckedAt && (Date.now() - cache.connectionCheckedAt) < (6 * 60 * 60 * 1000);
    if (!force && checkedRecently && cache.connection) {
      return cache.connection;
    }

    if (!apifyToken) {
      cache.connection = { connected: false, reason: 'APIFY_TOKEN missing' };
      cache.connectionCheckedAt = Date.now();
      return cache.connection;
    }

    try {
      const headers = { Authorization: `Bearer ${apifyToken}` };
      const [meResp, limitsResp] = await Promise.all([
        axios.get('https://api.apify.com/v2/users/me', { headers, timeout: 15000 }),
        axios.get('https://api.apify.com/v2/users/me/limits', { headers, timeout: 15000 })
      ]);

      const me = meResp.data && meResp.data.data ? meResp.data.data : {};
      const limits = limitsResp.data && limitsResp.data.data ? limitsResp.data.data : {};
      const plan = me.plan || limits.plan || {};

      cache.connection = {
        connected: true,
        userId: me.id || null,
        username: me.username || null,
        account: {
          id: me.id || null,
          username: me.username || null,
          plan: plan
        },
        limits,
        planId: plan.id || plan.tier || null,
        planTier: plan.tier || plan.id || null,
        monthlyUsageUsd: limits.current && typeof limits.current.monthlyUsageUsd === 'number' ? limits.current.monthlyUsageUsd : null,
        maxMonthlyUsageUsd: limits.limits && typeof limits.limits.maxMonthlyUsageUsd === 'number' ? limits.limits.maxMonthlyUsageUsd : null,
        dataRetentionDays: limits.limits && typeof limits.limits.dataRetentionDays === 'number' ? limits.limits.dataRetentionDays : null,
        maxConcurrentActorRuns: plan.maxConcurrentActorRuns || null,
        maxMonthlyActorComputeUnits: plan.maxMonthlyActorComputeUnits || null,
        enabledPlatformFeatures: Array.isArray(plan.enabledPlatformFeatures) ? plan.enabledPlatformFeatures : [],
        checkedAt: new Date().toISOString()
      };
      cache.connectionCheckedAt = Date.now();
      return cache.connection;
    } catch (err) {
      cache.connection = {
        connected: false,
        error: err.response && err.response.data ? err.response.data : err.message,
        checkedAt: new Date().toISOString()
      };
      cache.connectionCheckedAt = Date.now();
      return cache.connection;
    }
  }

  async function fetchSerpIntel(competitorName) {
    const queries = [
      `${competitorName} official website`,
      `${competitorName} pricing`
    ];

    const raw = await apifyRequest(serpActor, {
      queries: queries.join('\n'),
      resultsPerPage: 10,
      maxPagesPerQuery: maxSerpPages,
      maxItems: Math.max(20, queries.length * 10),
      countryCode: 'in',
      languageCode: 'en',
      mobileResults: false,
      includePeopleAlsoAsk: true,
      includeRelatedSearches: true,
      includeAds: false,
      maxConcurrency: 2,
      debugMode: false
    }, { maxItems: queries.length * 2, timeoutMs: 120000 });

    const serpItems = unwrapItems(raw);
    return collectSerpResults(serpItems);
  }

  async function crawlWebsite(startUrls, competitorName) {
    if (!startUrls.length) return [];

    const raw = await apifyRequest(websiteActor, {
      startUrls: startUrls.map(url => ({ url })),
      crawlerType: 'http',
      maxCrawlDepth: 1,
      maxCrawlPages: maxWebsitePages,
      maxItems: maxWebsitePages,
      maxConcurrency: 2,
      outputFormat: 'markdown',
      excludeUrlGlobs: [
        '**/*login*',
        '**/*logout*',
        '**/*signup*',
        '**/*sign-up*',
        '**/*register*',
        '**/*privacy*',
        '**/*terms*'
      ],
      respectRobotsTxtFile: false,
      useSitemaps: false,
      debugMode: false
    }, { maxItems: maxWebsitePages, timeoutMs: 150000 });

    const pages = unwrapItems(raw);
    return pages.map(page => ({ ...page, competitorName }));
  }

  async function fetchCompetitorIntel(competitorName, options = {}) {
    const force = Boolean(options.force);
    const key = slugify(competitorName);
    const cached = await loadCachedEntry(competitorName);
    if (cached && !force && cached.expiresAt && Date.now() < cached.expiresAt) {
      return { ...cached, cached: true };
    }

    const fetchedAt = new Date().toISOString();
    const verticals = verticalMap[competitorName] || [];
    const summary = {
      competitor: competitorName,
      verticals,
      fetchedAt,
      cached: false,
      websitePages: 0,
      serpQueries: 0,
      records: 0,
      startUrls: [],
      errors: []
    };

    try {
      const serp = await fetchSerpIntel(competitorName);
      summary.serpQueries = serp.queries.length;
      const startUrls = chooseStartUrls(serp, competitorName).slice(0, maxStartUrls);
      summary.startUrls = startUrls;
      const websitePages = await crawlWebsite(startUrls, competitorName);
      summary.websitePages = websitePages.length;

      const records = [
        normalizeSerpRecord({ competitor: competitorName, verticals, serp, fetchedAt, actorId: serpActor }),
        ...websitePages.map(page => normalizeWebsitePage({
          competitor: competitorName,
          verticals,
          record: page,
          fetchedAt,
          actorId: websiteActor,
          primaryUrl: startUrls[0] || null
        }))
      ];

      const entry = {
        competitor: competitorName,
        verticals,
        fetchedAt,
        expiresAt: Date.now() + cacheTtlMs,
        source: 'apify',
        startUrls,
        serp: {
          queries: serp.queries,
          organic: serp.organic.slice(0, 10),
          peopleAlsoAsk: serp.peopleAlsoAsk.slice(0, 10),
          relatedSearches: serp.relatedSearches.slice(0, 10),
          ads: serp.ads.slice(0, 10),
          aiOverviews: serp.aiOverviews.slice(0, 5)
        },
        websitePages,
        records
      };

      summary.records = records.length;
      await persistEntry(competitorName, entry);
      log(`Fetched ${records.length} Apify intel records for ${competitorName}`);
      return { ...entry, cached: false, summary };
    } catch (err) {
      const message = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
      summary.errors.push(message);
      log(`Failed to fetch Apify intel for ${competitorName}: ${message}`);
      if (cached) {
        return { ...cached, cached: true, stale: true, summary };
      }
      return {
        competitor: competitorName,
        verticals,
        fetchedAt,
        expiresAt: Date.now() + cacheTtlMs,
        source: 'apify',
        startUrls: [],
        serp: { queries: [], organic: [], peopleAlsoAsk: [], relatedSearches: [], ads: [], aiOverviews: [] },
        websitePages: [],
        records: [],
        cached: false,
        stale: false,
        summary
      };
    }
  }

  async function fetchAllApifyIntel(options = {}) {
    const requested = options.competitor
      ? [options.competitor]
      : trackedCompetitors;

    const uniqueNames = [...new Set(requested.filter(Boolean))];
    const summary = {
      fetched: 0,
      competitors: {},
      errors: [],
      skipped: [],
      refreshedAt: new Date().toISOString()
    };

    for (const competitorName of uniqueNames) {
      const entry = await fetchCompetitorIntel(competitorName, options);
      const recordCount = Array.isArray(entry.records) ? entry.records.length : 0;
      summary.fetched += recordCount;
      summary.competitors[competitorName] = {
        records: recordCount,
        cached: Boolean(entry.cached),
        stale: Boolean(entry.stale),
        startUrls: entry.startUrls || []
      };
      if (entry.summary && Array.isArray(entry.summary.errors) && entry.summary.errors.length > 0) {
        summary.errors.push({ competitor: competitorName, errors: entry.summary.errors });
      }
      if (recordCount === 0 && !entry.cached) {
        summary.skipped.push(competitorName);
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    cache.lastFetchTime = Date.now();
    return summary;
  }

  async function listRecentRuns(limit = 5) {
    if (!apifyToken) return [];
    const payload = await apifyApiRequest('GET', '/actor-runs', { params: { limit, desc: 1 }, timeoutMs: 15000 });
    return extractList(payload).map(normalizeRunSummary);
  }

  async function listRecentDatasets(limit = 5) {
    if (!apifyToken) return [];
    const payload = await apifyApiRequest('GET', '/datasets', { params: { limit, desc: 1 }, timeoutMs: 15000 });
    return extractList(payload).map(normalizeDatasetSummary);
  }

  async function sampleDatasetItems(datasets, perDatasetLimit = 3) {
    if (!apifyToken) return [];
    const items = [];
    for (const dataset of (datasets || []).slice(0, 3)) {
      const datasetId = dataset.id || dataset.dataset_id || dataset.datasetId;
      if (!datasetId) continue;
      try {
        const payload = await apifyApiRequest('GET', `/datasets/${encodeURIComponent(datasetId)}/items`, {
          params: { format: 'json', clean: 1, limit: perDatasetLimit, desc: 1 },
          timeoutMs: 15000
        });
        for (const item of extractList(payload).slice(0, perDatasetLimit)) {
          items.push({
            id: item.id || createContentHash([datasetId, JSON.stringify(item).slice(0, 300)]),
            source: 'apify:dataset-item',
            url: item.url || item.pageUrl || item.link || dataset.url || null,
            title: item.title || item.name || item.headline || item.query || dataset.title || dataset.name || datasetId,
            observed_at: item.observed_at || item.observedAt || item.createdAt || dataset.observed_at || dataset.observedAt || dataset.createdAt || new Date().toISOString(),
            delta_summary: trim(item.delta_summary || item.summary || item.snippet || item.description || item.text || item.body || item.content || item.title || item.name || '', 180),
            tags: [...textTags(item.title, item.name, item.summary, item.snippet, item.description, item.text, item.url, dataset.title), 'dataset-item'].filter(Boolean),
            freshness: freshnessFromTs(item.observed_at || item.observedAt || item.createdAt || dataset.observed_at || dataset.createdAt),
            cost_hint: costHint('dataset-item', 'Sampling a few items keeps the refresh useful without a full rerun.'),
            dataset_id: datasetId
          });
        }
      } catch (err) {
        log(`Dataset sample skipped for ${datasetId}: ${err.message}`);
      }
    }
    return items;
  }

  async function runConfiguredTargets(request = {}) {
    const explicitTargets = Array.isArray(request.targets)
      ? request.targets.map(normalizeTarget).filter(Boolean)
      : [];
    const targets = explicitTargets.length ? explicitTargets : configuredTargets;
    if (!targets.length) return [];

    const results = [];
    for (const target of targets) {
      try {
        results.push(await runScan(target));
      } catch (err) {
        results.push({
          id: createContentHash([target.actorId || '', target.taskId || '', target.label || '', err.message || '']),
          label: target.label || target.actorId || target.taskId || 'Apify target',
          error: err.message,
          skipped: true
        });
      }
    }
    return results;
  }

  async function runScan(target = {}) {
    const normalized = normalizeTarget(target);
    if (!normalized) {
      throw new Error('Provide an actorId or taskId to run an Apify scan');
    }

    const endpoint = normalized.actorId
      ? `/acts/${encodeURIComponent(normalized.actorId)}/run-sync-get-dataset-items`
      : `/actor-tasks/${encodeURIComponent(normalized.taskId)}/run-sync-get-dataset-items`;

    const payload = await apifyApiRequest('POST', endpoint, {
      params: {
        timeout: normalized.timeoutSeconds,
        maxItems: normalized.maxItems,
        format: 'json',
        clean: 1
      },
      data: normalized.input,
      timeoutMs: Math.max(60000, normalized.timeoutSeconds * 1000 + 15000)
    });

    const items = extractList(payload);
    const observedAt = new Date().toISOString();
    const normalizedItems = items.map(item => ({
      id: item.id || createContentHash([normalized.label, JSON.stringify(item).slice(0, 250)]),
      source: 'apify:dataset-item',
      url: item.url || item.pageUrl || item.link || normalized.url || null,
      title: item.title || item.name || item.headline || item.query || normalized.label,
      observed_at: item.observed_at || item.observedAt || item.createdAt || observedAt,
      delta_summary: trim(item.delta_summary || item.summary || item.snippet || item.description || item.text || item.body || item.content || item.title || item.name || '', 180),
      tags: [...textTags(item.title, item.name, item.summary, item.snippet, item.description, item.text, item.url, normalized.label, normalized.sourceType), 'configured-run'].filter(Boolean),
      freshness: freshnessFromTs(item.observed_at || item.observedAt || item.createdAt || observedAt),
      cost_hint: costHint('configured-run', 'Only run configured targets when the extra detail is worth the compute cost.'),
      actor_id: normalized.actorId || null,
      task_id: normalized.taskId || null,
      source_label: normalized.label || null
    }));

    const scan = {
      id: createContentHash([observedAt, normalized.label, normalized.actorId || '', normalized.taskId || '']),
      actorId: normalized.actorId,
      taskId: normalized.taskId,
      competitor: normalized.competitor,
      label: normalized.label,
      sourceType: normalized.sourceType,
      url: normalized.url,
      createdAt: observedAt,
      observed_at: observedAt,
      itemCount: normalizedItems.length,
      deltaSummary: {
        summary: normalizedItems.length ? `Fetched ${normalizedItems.length} items` : 'No items returned'
      },
      items: normalizedItems,
      cost_hint: costHint('configured-run', 'Explicit configured runs are optional and should be used sparingly.'),
      freshness: freshnessFromTs(observedAt)
    };

    return scan;
  }

  async function getCapabilities(force = false) {
    const connection = await verifyConnection(force);
    return {
      tokenConfigured: Boolean(apifyToken),
      connected: Boolean(connection && connection.connected),
      account: connection && connection.account ? connection.account : null,
      plan: connection && connection.account && connection.account.plan ? connection.account.plan : null,
      supportedActions: [
        'status',
        'capabilities',
        'refresh',
        'insights',
        'scan'
      ],
      freeTier: {
        monthlyUsageUsd: 5,
        dataRetentionDays: 7,
        actorComputeUnits: 625,
        maxConcurrentActorRuns: 25
      },
      configuredTargets: configuredTargets.map(target => ({
        actorId: target.actorId,
        taskId: target.taskId,
        label: target.label,
        sourceType: target.sourceType
      })),
      recommendedSources: [
        'competitor homepages',
        'pricing pages',
        'product pages',
        'SERP snapshots',
        'public review or directory pages'
      ]
    };
  }

  async function getInsights(filters = {}) {
    const force = Boolean(filters.force);
    const competitor = filters.competitor || null;
    const cacheKey = JSON.stringify({
      competitor: competitor || null,
      runLimit: clampInt(filters.runLimit || filters.limitRuns, 5, 1, 20),
      datasetLimit: clampInt(filters.datasetLimit || filters.limitDatasets, 5, 1, 20),
      sampleLimit: clampInt(filters.sampleLimit, 3, 1, 10),
      limit: clampInt(filters.limit, 20, 1, 100),
      runConfigured: Boolean(filters.runConfigured)
    });
    const cachedInsights = cache.insightsSnapshots.get(cacheKey);
    if (!force && cachedInsights && (Date.now() - cachedInsights.cachedAt) < insightsCacheTtlMs) {
      return { ...cachedInsights.value, cached: true };
    }

    const connection = await verifyConnection(force);
    const recentRuns = await listRecentRuns(clampInt(filters.runLimit || filters.limitRuns, 5, 1, 20));
    const recentDatasets = await listRecentDatasets(clampInt(filters.datasetLimit || filters.limitDatasets, 5, 1, 20));
    const sampledItems = await sampleDatasetItems(recentDatasets, clampInt(filters.sampleLimit, 3, 1, 10));

    if (competitor && !cache.competitors[slugify(competitor)]) {
      try {
        await fetchCompetitorIntel(competitor, { force });
      } catch (err) {
        log(`Competitor bootstrap skipped for ${competitor}: ${err.message}`);
      }
    }

    const cachedIntel = flattenIntelRecords(filters).map(record => normalizeIntelRecord(record, { source: 'apify:intel-cache' }));
    const configuredRuns = filters.runConfigured ? await runConfiguredTargets(filters) : [];
    const feed = [...cachedIntel, ...recentRuns, ...recentDatasets, ...sampledItems, ...configuredRuns.map(scan => ({
      id: scan.id,
      source: 'apify:scan',
      url: scan.url || null,
      title: scan.label || 'Configured Apify scan',
      observed_at: scan.observed_at || scan.createdAt || new Date().toISOString(),
      delta_summary: scan.deltaSummary && scan.deltaSummary.summary ? scan.deltaSummary.summary : 'Configured Apify scan completed',
      tags: ['configured-run'],
      freshness: freshnessFromTs(scan.observed_at || scan.createdAt),
      cost_hint: costHint('configured-run', 'Explicit configured runs should only happen on demand.'),
      actor_id: scan.actorId || null,
      task_id: scan.taskId || null
    }))];

    const deduped = [];
    const seen = new Set();
    for (const item of feed) {
      const key = item.id || createContentHash([item.source || '', item.url || '', item.title || '', item.observed_at || '']);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }
    deduped.sort((a, b) => String(b.observed_at || '').localeCompare(String(a.observed_at || '')));

    const bySource = deduped.reduce((acc, item) => {
      acc[item.source] = (acc[item.source] || 0) + 1;
      return acc;
    }, {});

    const result = {
      source: 'apify',
      status: connection && connection.connected ? 'connected' : 'degraded',
      account: connection && connection.account ? connection.account : null,
      limits: connection && connection.limits ? connection.limits : null,
      usage: connection && connection.connected ? {
        currentUsd: connection.monthlyUsageUsd,
        maxUsd: connection.maxMonthlyUsageUsd,
        remainingUsd: connection.maxMonthlyUsageUsd !== null && connection.monthlyUsageUsd !== null
          ? Math.max(0, connection.maxMonthlyUsageUsd - connection.monthlyUsageUsd)
          : null,
        dataRetentionDays: connection.dataRetentionDays
      } : null,
      summary: {
        feed_count: deduped.length,
        recent_run_count: recentRuns.length,
        recent_dataset_count: recentDatasets.length,
        sampled_item_count: sampledItems.length,
        cached_intel_count: cachedIntel.length,
        configured_run_count: configuredRuns.filter(item => !item.skipped).length
      },
      by_source: bySource,
      recentRuns,
      recentDatasets,
      recent_runs: recentRuns,
      recent_datasets: recentDatasets,
      recentScans: cachedIntel.slice(0, 10),
      configured_runs: configuredRuns,
      feed: deduped.slice(0, clampInt(filters.limit, 20, 1, 100)),
      updated_at: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    cache.insightsSnapshots.set(cacheKey, { cachedAt: Date.now(), value: result });
    return result;
  }

  async function refresh(request = {}) {
    const insights = await getInsights({ ...request, force: true });
    return {
      count: insights.feed.length,
      data: insights,
      refreshedAt: new Date().toISOString()
    };
  }

  function flattenIntelRecords(filters = {}) {
    const {
      competitor,
      vertical,
      sourceType,
      kind,
      days,
      query,
      limit
    } = filters || {};

    let records = [];
    for (const entry of Object.values(cache.competitors)) {
      if (!entry || !Array.isArray(entry.records)) continue;
      records.push(...entry.records);
    }

    if (competitor) {
      const wanted = String(competitor).toLowerCase();
      records = records.filter(record => String(record.competitor || '').toLowerCase().includes(wanted));
    }

    if (vertical) {
      const wanted = String(vertical).toLowerCase();
      records = records.filter(record => {
        const recordVertical = String(record.vertical || '').toLowerCase();
        const recordVerticals = Array.isArray(record.verticals) ? record.verticals.map(v => String(v).toLowerCase()) : [];
        return recordVertical === wanted || recordVerticals.includes(wanted);
      });
    }

    if (sourceType) {
      const wanted = String(sourceType).toLowerCase();
      records = records.filter(record => String(record.source_type || '').toLowerCase() === wanted);
    }

    if (kind) {
      const wanted = String(kind).toLowerCase();
      records = records.filter(record => String(record.page_kind || '').toLowerCase() === wanted);
    }

    if (query) {
      const wanted = String(query).toLowerCase();
      records = records.filter(record => {
        const haystack = [
          record.query,
          record.title,
          record.description,
          record.text,
          record.summary
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(wanted);
      });
    }

    if (days && Number.isFinite(Number(days))) {
      const cutoff = Date.now() - (Number(days) * 24 * 60 * 60 * 1000);
      records = records.filter(record => {
        const ts = Date.parse(record.ad_delivery_start_time || record.fetched_at || '');
        return Number.isFinite(ts) ? ts >= cutoff : true;
      });
    }

    records.sort((a, b) => {
      const aTime = Date.parse(a.ad_delivery_start_time || a.fetched_at || '') || 0;
      const bTime = Date.parse(b.ad_delivery_start_time || b.fetched_at || '') || 0;
      return bTime - aTime;
    });

    if (limit && Number.isFinite(Number(limit))) {
      return records.slice(0, Math.max(0, Number(limit)));
    }
    return records;
  }

  async function getIntel(filters = {}) {
    const competitorName = filters.competitor || null;
    if (competitorName && Boolean(filters.force) && !cache.competitors[slugify(competitorName)]) {
      await fetchCompetitorIntel(competitorName, { force: true });
    }
    return flattenIntelRecords(filters);
  }

  async function getStatus(forceVerify = false) {
    if (!forceVerify && cache.statusSnapshot && cache.statusSnapshotAt && (Date.now() - cache.statusSnapshotAt) < statusCacheTtlMs) {
      return { ...cache.statusSnapshot, cached: true };
    }

    const connection = await verifyConnection(forceVerify);
    const records = flattenIntelRecords({});
    const recentRuns = await listRecentRuns(5);
    const recentDatasets = await listRecentDatasets(5);
    const competitorsCached = Object.values(cache.competitors).length;
    const websiteRecords = records.filter(record => record.source_type === 'website').length;
    const serpRecords = records.filter(record => record.source_type === 'serp').length;

    const result = {
      connected: Boolean(connection && connection.connected),
      connection,
      account: connection && connection.account ? connection.account : null,
      limits: connection && connection.limits ? connection.limits : null,
      currentUsageUsd: connection ? connection.monthlyUsageUsd : null,
      maxUsageUsd: connection ? connection.maxMonthlyUsageUsd : null,
      remainingUsageUsd: connection && connection.monthlyUsageUsd !== null && connection.maxMonthlyUsageUsd !== null
        ? Math.max(0, connection.maxMonthlyUsageUsd - connection.monthlyUsageUsd)
        : null,
      cacheTtlHours,
      lastFetchTime: cache.lastFetchTime,
      lastFetchAgo: cache.lastFetchTime ? `${Math.round((Date.now() - cache.lastFetchTime) / 60000)} minutes ago` : null,
      competitorsTracked: trackedCompetitors.length,
      competitorsCached,
      totalRecords: records.length,
      websiteRecords,
      serpRecords,
      recentRuns,
      recentDatasets,
      recent_runs: recentRuns,
      recent_datasets: recentDatasets,
      configured_targets: configuredTargets,
      staleCompetitors: Object.values(cache.competitors)
        .filter(entry => entry && entry.expiresAt && Date.now() > entry.expiresAt)
        .map(entry => entry.competitor)
    };

    cache.statusSnapshot = result;
    cache.statusSnapshotAt = Date.now();
    return result;
  }

  return {
    verifyConnection,
    fetchApifyIntel: fetchAllApifyIntel,
    fetchCompetitorIntel,
    getIntel,
    getStatus,
    getCapabilities,
    getInsights,
    refresh,
    runScan
  };
};
