const cron = require('node-cron');

function log(msg) {
  console.log(`[CompetitorScheduler] ${new Date().toISOString()} — ${msg}`);
}

module.exports = function (config) {
  const {
    fetchAllCompetitorAds,
    fetchUnivest,
    classifyNewAds,
    computeTrends,
    generateRadar,
    generateBriefs
  } = config;

  const state = {
    jobs: {
      fetch:    { lastRun: null, nextRun: null, duration: null, status: 'idle', recordCount: 0, error: null },
      classify: { lastRun: null, nextRun: null, duration: null, status: 'idle', recordCount: 0, error: null },
      trends:   { lastRun: null, nextRun: null, duration: null, status: 'idle', recordCount: 0, error: null },
      radar:    { lastRun: null, nextRun: null, duration: null, status: 'idle', recordCount: 0, error: null },
      briefs:   { lastRun: null, nextRun: null, duration: null, status: 'idle', recordCount: 0, error: null }
    },
    isRunning: false,
    startedAt: null
  };

  let pipelineCron = null;
  let briefsCron = null;
  let initialTimeout = null;

  // ── helpers ────────────────────────────────────────────────────────

  async function runStep(jobName, fn, ...args) {
    const job = state.jobs[jobName];
    job.status = 'running';
    job.error = null;
    const t0 = Date.now();
    log(`${jobName} — started`);
    try {
      const result = await fn(...args);
      const duration = Date.now() - t0;
      job.lastRun = new Date().toISOString();
      job.duration = duration;
      job.status = 'done';

      // Normalise whatever the step returns into a record count + passable value
      let count = 0;
      let passthrough = result;
      if (Array.isArray(result)) {
        count = result.length;
      } else if (result && typeof result === 'object' && typeof result.count === 'number') {
        count = result.count;
        passthrough = result.data !== undefined ? result.data : result;
      } else if (typeof result === 'number') {
        count = result;
      }
      job.recordCount = count;

      log(`${jobName} — done in ${duration}ms, records: ${count}`);
      return passthrough;
    } catch (err) {
      const duration = Date.now() - t0;
      job.lastRun = new Date().toISOString();
      job.duration = duration;
      job.status = 'error';
      job.error = err.message || String(err);
      log(`${jobName} — ERROR after ${duration}ms: ${job.error}`);
      return null;
    }
  }

  // ── pipeline ───────────────────────────────────────────────────────

  async function runPipeline() {
    if (state.isRunning) {
      log('Pipeline already running — skipping');
      return;
    }
    state.isRunning = true;
    log('Pipeline started');
    const t0 = Date.now();

    try {
      // Step 1 — fetch (sequential to respect rate limits)
      const competitorAds = await runStep('fetch', async () => {
        await fetchAllCompetitorAds();
        try { await fetchUnivest(); } catch (e) { log('fetchUnivest skipped: ' + e.message); }
        // After fetching, get ALL raw ads from the fetcher cache for classification
        const allRawAds = config.getAds ? config.getAds() : [];
        return allRawAds;
      });

      // Step 2 — classify only new ads
      if (competitorAds) {
        await runStep('classify', classifyNewAds, competitorAds);
      } else {
        log('classify — skipped (no ads from fetch step)');
      }

      // Step 3 — compute trends
      await runStep('trends', computeTrends);

      // Step 4 — generate radar
      await runStep('radar', generateRadar);

    } catch (err) {
      log(`Pipeline unexpected error: ${err.message}`);
    } finally {
      state.isRunning = false;
      log(`Pipeline finished in ${Date.now() - t0}ms`);
    }
  }

  async function runBriefs() {
    if (state.jobs.briefs.status === 'running') {
      log('Briefs already running — skipping');
      return;
    }
    await runStep('briefs', generateBriefs);
  }

  // ── public API ─────────────────────────────────────────────────────

  function computeNextRuns() {
    // Approximate next-run times for status display
    const now = Date.now();
    const sixH = 6 * 60 * 60 * 1000;
    const twelveH = 12 * 60 * 60 * 1000;

    ['fetch', 'classify', 'trends', 'radar'].forEach((k) => {
      const last = state.jobs[k].lastRun ? new Date(state.jobs[k].lastRun).getTime() : now;
      state.jobs[k].nextRun = new Date(last + sixH).toISOString();
    });
    const lastBriefs = state.jobs.briefs.lastRun ? new Date(state.jobs.briefs.lastRun).getTime() : now;
    state.jobs.briefs.nextRun = new Date(lastBriefs + twelveH).toISOString();
  }

  function getStatus() {
    computeNextRuns();
    return JSON.parse(JSON.stringify(state)); // deep clone
  }

  async function runJob(jobName) {
    if (jobName === 'full') {
      await runPipeline();
      await runBriefs();
      return getStatus();
    }

    const fnMap = {
      fetch: async () => {
        const ads = await fetchAllCompetitorAds();
        const univest = await fetchUnivest();
        return [].concat(ads || [], univest || []);
      },
      classify: classifyNewAds,
      trends: computeTrends,
      radar: generateRadar,
      briefs: generateBriefs
    };

    const fn = fnMap[jobName];
    if (!fn) {
      log(`runJob — unknown job "${jobName}"`);
      return { error: `Unknown job: ${jobName}` };
    }

    await runStep(jobName, fn);
    return getStatus();
  }

  function start() {
    if (state.startedAt) {
      log('Already started');
      return;
    }
    state.startedAt = new Date().toISOString();
    log('Starting scheduler');

    // Every 6 hours — main pipeline
    pipelineCron = cron.schedule('0 */6 * * *', () => {
      runPipeline().catch((err) => log(`Cron pipeline error: ${err.message}`));
    });

    // Every 12 hours — briefs
    briefsCron = cron.schedule('0 */12 * * *', () => {
      runBriefs().catch((err) => log(`Cron briefs error: ${err.message}`));
    });

    // Initial run after 10-second delay to let server settle
    initialTimeout = setTimeout(() => {
      log('Running initial pipeline + briefs');
      runPipeline()
        .then(() => runBriefs())
        .catch((err) => log(`Initial run error: ${err.message}`));
    }, 10_000);

    log('Cron jobs registered — pipeline every 6h, briefs every 12h');
  }

  function stop() {
    log('Stopping scheduler');
    if (pipelineCron) { pipelineCron.stop(); pipelineCron = null; }
    if (briefsCron) { briefsCron.stop(); briefsCron = null; }
    if (initialTimeout) { clearTimeout(initialTimeout); initialTimeout = null; }
    state.startedAt = null;
    log('All cron jobs stopped');
  }

  return { start, stop, getStatus, runJob };
};
