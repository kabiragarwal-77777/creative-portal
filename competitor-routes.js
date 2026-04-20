const express = require('express');

module.exports = function(config) {
  const router = express.Router();

  const fetcher = require('./competitor-meta-fetcher')({ metaAccessToken: config.metaAccessToken });
  const apify = require('./competitor-apify-fetcher')({
    apifyToken: config.apifyToken || process.env.APIFY_TOKEN || process.env.APIFY_API_TOKEN,
    getTrackedCompetitors: () => fetcher.getTrackedCompetitors()
  });
  const classifier = require('./competitor-classifier')({ openaiApiKey: config.openaiApiKey });
  const trends = require('./competitor-trends')({
    getClassifiedAds: (filters) => classifier.getClassifiedAds(filters),
    getUnivest: () => fetcher.getAds({ competitor: 'Univest' })
  });
  const radar = require('./competitor-radar')({
    openaiApiKey: config.openaiApiKey,
    getTrends: () => trends.getTrends()
  });
  const briefs = require('./competitor-creative-briefs')({
    openaiApiKey: config.openaiApiKey,
    getTrends: () => trends.getTrends(),
    getClassifiedAds: (filters) => classifier.getClassifiedAds(filters),
    getRadar: () => radar.getRadar(),
    getApifyInsights: () => apify.getInsights({ limit: 12 })
  });
  const scheduler = require('./competitor-scheduler')({
    fetchAllCompetitorAds: () => fetcher.fetchAllCompetitorAds(),
    fetchUnivest: () => fetcher.fetchUnivest(),
    getAds: () => fetcher.getAds({}),
    getApifyIntel: (payload) => apify.getIntel(payload || {}),
    classifyNewAds: (ads) => classifier.classifyNewAds(ads),
    computeTrends: () => trends.computeTrends(),
    generateRadar: () => radar.generateRadar(),
    generateBriefs: () => briefs.generateBriefs()
  });

  function ok(data) {
    return { success: true, data: data, timestamp: new Date().toISOString() };
  }

  function fail(err) {
    return { success: false, error: err.message, timestamp: new Date().toISOString() };
  }

  function buildApifyEnrichmentPayload(status, insights) {
    const summary = insights && insights.summary ? insights.summary : { feed_count: 0, recent_run_count: 0, recent_dataset_count: 0, sampled_item_count: 0 };
    const recentScans = insights && Array.isArray(insights.feed)
      ? insights.feed
      : (insights && Array.isArray(insights.recentScans) ? insights.recentScans : []);
    const websiteChanges = [];
    const pricingChanges = [];
    const serpChanges = [];

    for (const scan of recentScans) {
      const items = Array.isArray(scan.items) ? scan.items : [scan];
      for (const item of items) {
        const normalized = {
          id: item.key || item.id || `${scan.label || 'scan'}-${item.url || item.title || Math.random().toString(36).slice(2)}`,
          competitor_name: item.competitor || scan.competitor || scan.label || 'Unknown',
          competitor_id: String(item.competitor || scan.competitor || scan.label || 'Unknown').toLowerCase().replace(/[^a-z0-9]+/g, ''),
          source: item.source || scan.sourceType || scan.source || 'apify',
          page: item.url || scan.url || '',
          url: item.url || scan.url || '',
          keyword: scan.label || scan.sourceType || scan.source || '',
          change_type: scan.sourceType || scan.source || 'website',
          change: item.delta_summary || item.deltaSummary || item.subtitle || item.title || 'Apify observation',
          old_value: '',
          new_value: item.title || item.delta_summary || item.deltaSummary || item.subtitle || '',
          impact: Array.isArray(item.tags) && item.tags.length ? item.tags[0] : '',
          confidence: 'medium',
          detected_at: item.observed_at || item.observedAt || scan.observed_at || scan.createdAt || null
        };
        if ((scan.sourceType || '').includes('serp') || (item.tags || []).includes('search')) {
          serpChanges.push(normalized);
        } else if ((item.tags || []).includes('offer') || (item.tags || []).includes('pricing')) {
          pricingChanges.push(normalized);
        } else {
          websiteChanges.push(normalized);
        }
      }
    }

    return {
      status: status && status.status ? status.status : (websiteChanges.length || pricingChanges.length || serpChanges.length ? 'healthy' : 'empty'),
      source: 'apify',
      plan: status && status.account && status.account.plan ? status.account.plan.id || status.account.plan.tier || 'FREE' : 'FREE',
      account: status && status.account ? status.account : null,
      quota: status && status.limits ? status.limits : null,
      lastUpdated: insights && insights.updatedAt ? insights.updatedAt : new Date().toISOString(),
      lastRunAt: status && Array.isArray(status.recentRuns) && status.recentRuns[0] ? status.recentRuns[0].startedAt || status.recentRuns[0].createdAt || null : null,
      nextRunAt: null,
      usage: status && typeof status.currentUsageUsd === 'number'
        ? {
            currentUsd: status.currentUsageUsd,
            maxUsd: status.maxUsageUsd,
            remainingUsd: status.remainingUsageUsd
          }
        : null,
      limits: status && status.limits ? status.limits : null,
      coverage: {
        configuredScans: status && Array.isArray(status.configured_targets) ? status.configured_targets.length : 0,
        totalScans: summary.feed_count || 0,
        totalItems: summary.sampled_item_count || 0,
        bySource: insights && insights.by_source ? insights.by_source : {}
      },
      notes: status && status.error ? status.error : 'Apify enrichment feed',
      runs: status && Array.isArray(status.recentRuns) ? status.recentRuns : [],
      datasets: status && Array.isArray(status.recentDatasets) ? status.recentDatasets : [],
      recentRuns: status && Array.isArray(status.recentRuns) ? status.recentRuns : [],
      recentDatasets: status && Array.isArray(status.recentDatasets) ? status.recentDatasets : [],
      websiteChanges: websiteChanges.slice(0, 25),
      pricingChanges: pricingChanges.slice(0, 25),
      serpChanges: serpChanges.slice(0, 25),
      website_changes: websiteChanges.slice(0, 25),
      pricing_changes: pricingChanges.slice(0, 25),
      serp_changes: serpChanges.slice(0, 25),
      recent_scans: recentScans.slice(0, 10).map(scan => ({
        id: scan.id || null,
        label: scan.label || scan.title || null,
        sourceType: scan.sourceType || scan.source || null,
        competitor: scan.competitor || null,
        createdAt: scan.createdAt || scan.observed_at || null,
        itemCount: scan.itemCount || scan.item_count || 0
      }))
    };
  }

  // ── Helper: add ad_library_link and sort by impressions ────────────────

  function enrichAdLinks(ads) {
    return (ads || []).map(ad => {
      let ad_library_link = ad.ad_library_link || null;
      if (!ad_library_link) {
        if (ad.page_id) {
          ad_library_link = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=IN&view_all_page_id=${encodeURIComponent(ad.page_id)}`;
        } else if (ad.id) {
          ad_library_link = `https://www.facebook.com/ads/library/?id=${ad.id}`;
        } else if (ad.page_name) {
          ad_library_link = `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=IN&q=${encodeURIComponent(ad.page_name)}&search_type=keyword_unordered`;
        }
      }
      return { ...ad, ad_library_link };
    });
  }

  function sortByImpressions(ads, sortParam) {
    if (!sortParam) return ads;
    const sorted = [...ads];
    if (sortParam === 'impressions_desc') {
      sorted.sort((a, b) => {
        const aVal = (a.impressions && a.impressions.lower_bound) || 0;
        const bVal = (b.impressions && b.impressions.lower_bound) || 0;
        return bVal - aVal;
      });
    } else if (sortParam === 'impressions_asc') {
      sorted.sort((a, b) => {
        const aVal = (a.impressions && a.impressions.lower_bound) || 0;
        const bVal = (b.impressions && b.impressions.lower_bound) || 0;
        return aVal - bVal;
      });
    }
    return sorted;
  }

  // ── Existing Routes ───────────────────────────────────────────────────────

  router.get('/ads', async (req, res) => {
    try {
      let data = await fetcher.getAds(req.query);
      // Enrich with ad_library_link
      if (Array.isArray(data)) {
        data = enrichAdLinks(data);
        data = sortByImpressions(data, req.query.sort);
      } else if (data && Array.isArray(data.ads)) {
        data.ads = enrichAdLinks(data.ads);
        data.ads = sortByImpressions(data.ads, req.query.sort);
      }
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  router.get('/classified', async (req, res) => {
    try {
      const data = await classifier.getClassifiedAds(req.query);
      if (Array.isArray(data)) {
        res.json(ok(sortByImpressions(enrichAdLinks(data), 'impressions_desc')));
        return;
      }
      if (data && Array.isArray(data.ads)) {
        data.ads = sortByImpressions(enrichAdLinks(data.ads), 'impressions_desc');
      }
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  router.get('/trends', async (req, res) => {
    try {
      const data = await trends.getTrends();
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  router.get('/radar', async (req, res) => {
    try {
      const data = await radar.getRadar();
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  router.get('/briefs', async (req, res) => {
    try {
      const data = await briefs.getBriefs(req.query.type || 'all');
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  router.post('/briefs/refresh', async (req, res) => {
    try {
      const data = await briefs.refreshBriefs();
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  // ── Competitor-Specific Brief Routes ──────────────────────────────────────

  router.get('/briefs/competitor', async (req, res) => {
    try {
      const filters = {
        competitor: req.query.competitor || null,
        vertical: req.query.vertical || null,
        type: req.query.type || null
      };
      const data = briefs.getCompetitorBriefs(filters);
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  router.post('/briefs/competitor/generate', async (req, res) => {
    try {
      const { competitor, vertical } = req.body || {};

      // If specific competitor + vertical provided, generate just that pair
      if (competitor && vertical) {
        // Get competitor ads for context
        let competitorAds = [];
        try {
          const allClassified = await classifier.getClassifiedAds({});
          const adList = Array.isArray(allClassified) ? allClassified : (allClassified && Array.isArray(allClassified.ads) ? allClassified.ads : []);
          competitorAds = adList.filter(a => {
            const name = (a.page_name || a.advertiser || a.brand || '').toLowerCase();
            return name.includes(competitor.toLowerCase());
          });
        } catch (err) {
          console.error('[Routes] Could not load classified ads:', err.message);
        }

        const [staticBriefs, videoBriefs] = await Promise.all([
          briefs.generateCompetitorBrief(competitor, vertical, competitorAds, 'static'),
          briefs.generateCompetitorBrief(competitor, vertical, competitorAds, 'video')
        ]);

        res.json(ok({
          competitor,
          vertical,
          static: staticBriefs,
          video: videoBriefs,
          total: staticBriefs.length + videoBriefs.length,
          generated_at: new Date().toISOString()
        }));
      } else {
        // Full matrix generation
        const data = await briefs.generateCompetitorBriefMatrix();
        res.json(ok(data));
      }
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  // ── Scheduler & Cache Routes ──────────────────────────────────────────────

  router.get('/apify/status', async (req, res) => {
    try {
      const data = await apify.getStatus(req.query.force === 'true' || req.query.force === '1');
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  router.get('/apify/intel', async (req, res) => {
    try {
      const data = await apify.getIntel(req.query);
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  router.post('/apify/intel/refresh', async (req, res) => {
    try {
      const body = req.body || {};
      const competitor = body.competitor || req.query.competitor || null;
      const force = body.force === true || body.force === 'true' || req.query.force === 'true' || req.query.force === '1';
      const data = competitor
        ? await apify.fetchApifyIntel({
            competitor,
            force: true
          })
        : await apify.getInsights({
            force,
            limit: req.query.limit ? Number(req.query.limit) : 20
          });
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  router.get('/enrichment', async (req, res) => {
    try {
      const insights = await apify.getInsights({
        force: req.query.force === 'true' || req.query.force === '1',
        limit: req.query.limit ? Number(req.query.limit) : undefined
      });
      res.json(ok(buildApifyEnrichmentPayload(insights, insights)));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  router.get('/scheduler/status', async (req, res) => {
    try {
      const data = await scheduler.getStatus();
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  router.post('/scheduler/run/:jobName', async (req, res) => {
    try {
      const data = await scheduler.runJob(req.params.jobName);
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  router.get('/cache-status', async (req, res) => {
    try {
      const data = await fetcher.getCacheStatus();
      res.json(ok(data));
    } catch (err) {
      res.status(500).json(fail(err));
    }
  });

  scheduler.start();

  console.log('[CompetitorIntel] All modules initialized, scheduler started');

  return router;
};
