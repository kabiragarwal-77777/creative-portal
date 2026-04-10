const dataAgent = require('./dataAgent');
const insightAgent = require('./insightAgent');
const creativeAIAgent = require('./creativeAIAgent');
const forecastAgent = require('./forecastAgent');
const scriptAgent = require('./scriptAgent');
const cron = require('node-cron');
const { run, getAll } = require('../db');

// ---------------------------------------------------------------------------
// Job definitions
// ---------------------------------------------------------------------------
const JOB_DEFS = {
  dataRefresh:      { schedule: '0 */6 * * *',   fn: () => dataAgent.fetchAndStoreAll() },
  dailyInsights:    { schedule: '0 8 * * *',      fn: () => insightAgent.analyzeCreativePerformance() },
  dailyScoring:     { schedule: '0 9 * * *',      fn: () => insightAgent.scoreAllCreatives() },
  updateActuals:    { schedule: '0 10 * * *',     fn: () => forecastAgent.updateActualROAS() },
  dailyForecasts:   { schedule: '30 10 * * *',    fn: () => forecastAgent.runForecasts() },
  weeklyAnalysis:   { schedule: '0 7 * * 1',      fn: () => creativeAIAgent.analyzeNextBatch() },
  weeklyPatterns:   { schedule: '0 9 * * 1',      fn: () => creativeAIAgent.buildCreativePatternLibrary() },
  weeklyBriefs:     { schedule: '0 11 * * 1',     fn: () => scriptAgent.generateNewBriefs(3) },
  weeklyRevamps:    { schedule: '0 12 * * 1',     fn: () => scriptAgent.generateRevampsForUnderperformers() },
};

// Active cron task handles keyed by job name
const jobs = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Log a scheduler run into the scheduler_log table.
 */
async function logJob(jobName, status, startTime, error = null, rowsAffected = 0) {
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startTime;
  await run(
    `INSERT INTO scheduler_log (job_name, status, started_at, completed_at, duration_ms, error_message, rows_affected)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [jobName, status, new Date(startTime).toISOString(), completedAt, durationMs, error, rowsAffected]
  );
}

/**
 * Return a human-readable representation of the next run.
 * Exact calculation from a cron expression without an external library is
 * non-trivial, so we return the cron expression string for display.
 */
function getNextRun(cronExpression) {
  return cronExpression;
}

/**
 * Wrap an agent function with logging, error handling, and duration tracking.
 */
async function executeJob(jobName, fn) {
  const start = Date.now();
  console.log(`[scheduler] ${jobName} started`);
  try {
    const result = await fn();
    const rows = typeof result === 'number' ? result : 0;
    await logJob(jobName, 'completed', start, null, rows);
    const durationMs = Date.now() - start;
    console.log(`[scheduler] ${jobName} completed in ${durationMs}ms`);
  } catch (err) {
    const durationMs = Date.now() - start;
    console.error(`[scheduler] ${jobName} failed after ${durationMs}ms:`, err.message);
    await logJob(jobName, 'error', start, err.message).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start all scheduled cron jobs.
 * On first start, if raw_creatives is empty, triggers dataRefresh immediately.
 * Returns the count of scheduled jobs.
 */
async function startAll() {
  for (const [name, def] of Object.entries(JOB_DEFS)) {
    const task = cron.schedule(def.schedule, () => {
      executeJob(name, def.fn);
    });
    jobs.set(name, { task, schedule: def.schedule, fn: def.fn });
  }

  // On first start: seed data if table is empty
  try {
    const rows = await getAll('SELECT 1 FROM raw_creatives LIMIT 1');
    if (!rows || rows.length === 0) {
      console.log('[scheduler] raw_creatives is empty — triggering initial dataRefresh');
      executeJob('dataRefresh', JOB_DEFS.dataRefresh.fn);
    }
  } catch (_) {
    // Table may not exist yet; ignore
  }

  console.log(`[scheduler] ${jobs.size} jobs scheduled`);
  return jobs.size;
}

/**
 * Stop all running cron tasks.
 * Returns the count of stopped jobs.
 */
function stopAll() {
  const count = jobs.size;
  for (const [, entry] of jobs) {
    entry.task.stop();
  }
  jobs.clear();
  console.log(`[scheduler] ${count} jobs stopped`);
  return count;
}

/**
 * Manually trigger a specific job by name (runs in background).
 * Returns { triggered, status } immediately.
 */
function triggerJob(jobName) {
  const entry = jobs.get(jobName) || (JOB_DEFS[jobName] ? { fn: JOB_DEFS[jobName].fn } : null);
  if (!entry) {
    throw new Error(`Unknown job: ${jobName}`);
  }
  const fn = entry.fn || JOB_DEFS[jobName].fn;

  // Fire and forget — don't await
  executeJob(jobName, fn);

  return { triggered: jobName, status: 'running' };
}

/**
 * Get the current status of every defined job.
 * Returns an array of { name, schedule, lastRun, nextRun, status }.
 */
async function getStatus() {
  const statuses = [];

  for (const [name, def] of Object.entries(JOB_DEFS)) {
    let lastRun = null;
    let lastStatus = null;

    try {
      const row = await getAll(
        `SELECT started_at, status FROM scheduler_log WHERE job_name = ? ORDER BY started_at DESC LIMIT 1`,
        [name]
      );
      if (row && row.length > 0) {
        lastRun = row[0].started_at;
        lastStatus = row[0].status;
      }
    } catch (_) {
      // table may not exist yet
    }

    statuses.push({
      name,
      schedule: def.schedule,
      lastRun,
      nextRun: getNextRun(def.schedule),
      status: lastStatus || 'never_run',
    });
  }

  return statuses;
}

/**
 * Return the last N scheduler_log entries (most recent first).
 */
async function getLog(limit = 50) {
  return getAll(
    `SELECT * FROM scheduler_log ORDER BY started_at DESC LIMIT ?`,
    [limit]
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = { startAll, stopAll, triggerJob, getStatus, getLog };
