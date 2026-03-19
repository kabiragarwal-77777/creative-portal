const cron = require('node-cron');
const discoveryAgent = require('./discoveryAgent');
const pricingAgent = require('./pricingAgent');
const competitorAgent = require('./competitorAgent');
const aiInsightAgent = require('./aiInsightAgent');

const jobs = {};
const lastRuns = {};

function startScheduler() {
  // 6am daily - Discovery
  jobs.discovery = cron.schedule('0 6 * * *', async () => {
    lastRuns.discovery = new Date().toISOString();
    try { await discoveryAgent.runDiscovery(); } catch(e) { console.error('Discovery cron error:', e.message); }
  });

  // 7am daily - Pricing update
  jobs.pricing = cron.schedule('0 7 * * *', async () => {
    lastRuns.pricing = new Date().toISOString();
    try { await pricingAgent.updatePricing(); } catch(e) { console.error('Pricing cron error:', e.message); }
  });

  // 8am daily - Competitor refresh
  jobs.competitor = cron.schedule('0 8 * * *', async () => {
    lastRuns.competitor = new Date().toISOString();
    try { await competitorAgent.refreshCompetitorData(); } catch(e) { console.error('Competitor cron error:', e.message); }
  });

  // 9am Monday - Weekly full refresh
  jobs.weeklyRefresh = cron.schedule('0 9 * * 1', async () => {
    lastRuns.weeklyRefresh = new Date().toISOString();
    try {
      await discoveryAgent.runDiscovery();
      await pricingAgent.updatePricing();
      await competitorAgent.refreshCompetitorData();
      await aiInsightAgent.generateInsights();
    } catch(e) { console.error('Weekly refresh error:', e.message); }
  });

  // Every 30 min - News sweep
  jobs.newsSweep = cron.schedule('*/30 * * * *', async () => {
    lastRuns.newsSweep = new Date().toISOString();
    try { await aiInsightAgent.newsSweep(); } catch(e) { console.error('News sweep error:', e.message); }
  });

  // 10am daily - Meta refresh (extension)
  jobs.metaRefresh = cron.schedule('0 10 * * *', async () => {
    lastRuns.metaRefresh = new Date().toISOString();
    // Will be wired when metaAdLibraryAgent is available
  });

  // 11am daily - Google refresh (extension)
  jobs.googleRefresh = cron.schedule('0 11 * * *', async () => {
    lastRuns.googleRefresh = new Date().toISOString();
  });

  // Auto-update status of 'new' inventories older than 7 days
  jobs.statusUpdate = cron.schedule('0 0 * * *', () => {
    try { discoveryAgent.autoUpdateStatus(); } catch(e) { console.error('Status update error:', e.message); }
  });

  console.log('[Scheduler] All cron jobs started');
}

function getStatus() {
  const nextRuns = {};
  for (const [name, job] of Object.entries(jobs)) {
    nextRuns[name] = { lastRun: lastRuns[name] || 'never', active: true };
  }
  return { jobs: nextRuns, schedulerRunning: true };
}

async function runJob(jobName) {
  const runners = {
    discovery: () => discoveryAgent.runDiscovery(),
    pricing: () => pricingAgent.updatePricing(),
    competitor: () => competitorAgent.refreshCompetitorData(),
    insights: () => aiInsightAgent.generateInsights(),
    newsSweep: () => aiInsightAgent.newsSweep(),
    statusUpdate: () => discoveryAgent.autoUpdateStatus()
  };

  if (!runners[jobName]) throw new Error(`Unknown job: ${jobName}`);
  lastRuns[jobName] = new Date().toISOString();
  return await runners[jobName]();
}

function stopScheduler() {
  for (const job of Object.values(jobs)) {
    job.stop();
  }
  console.log('[Scheduler] All cron jobs stopped');
}

module.exports = { startScheduler, getStatus, runJob, stopScheduler };
