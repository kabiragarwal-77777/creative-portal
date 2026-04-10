const express = require('express');

module.exports = function(config) {
  const router = express.Router();

  const fetcher = require('./competitor-meta-fetcher')({ metaAccessToken: config.metaAccessToken });
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
    getRadar: () => radar.getRadar()
  });
  const scheduler = require('./competitor-scheduler')({
    fetchAllCompetitorAds: () => fetcher.fetchAllCompetitorAds(),
    fetchUnivest: () => fetcher.fetchUnivest(),
    getAds: () => fetcher.getAds({}),
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

  // ── Helper: add ad_library_link and sort by impressions ────────────────

  function enrichAdLinks(ads) {
    return (ads || []).map(ad => {
      let ad_library_link = ad.ad_library_link || null;
      if (!ad_library_link) {
        if (ad.id) {
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
