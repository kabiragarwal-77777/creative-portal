// =============================================================================
// Feedback Engine — Cron Scheduler / Orchestrator
// Runs all agents on correct cadences with mutex locks.
// Auto-starts when required.
// =============================================================================

const cron = require('node-cron');
const { logSchedulerStart, logSchedulerEnd, query } = require('../db/fe-db');

const PREFIX = '[FE:Scheduler]';

// ── Initialize all agents ────────────────────────────────────────────────
const feWatcher = require('./feWatcher')({});
const feKnowledgeCrawler = require('./feKnowledgeCrawler')({});
const feAccuracyAuditor = require('./feAccuracyAuditor')({});
const feSelfTester = require('./feSelfTester')({});
const feProposalGenerator = require('./feProposalGenerator')({});
const feApprovalEngine = require('./feApprovalEngine')({});
const feMemory = require('./feMemory')({});
const feAnomalyDetector = require('./feAnomalyDetector')({});
const feDataQualityMonitor = require('./feDataQualityMonitor')({});

// ── Mutex locks ──────────────────────────────────────────────────────────
const locks = {};

async function withLock(name, fn) {
    if (locks[name]) {
        console.log(`${PREFIX} Skipping ${name} — already running`);
        return null;
    }
    locks[name] = true;
    try {
        return await fn();
    } finally {
        locks[name] = false;
    }
}

// ── Job runner with logging ──────────────────────────────────────────────
async function runJob(jobName, fn) {
    return withLock(jobName, async () => {
        const logId = logSchedulerStart(jobName);
        const startTime = Date.now();
        console.log(`${PREFIX} Starting job: ${jobName}`);

        try {
            const result = await fn();
            const recordsProcessed = typeof result === 'number'
                ? result
                : (result && typeof result === 'object' && result.count != null)
                    ? result.count
                    : (Array.isArray(result) ? result.length : 1);

            logSchedulerEnd(logId, recordsProcessed);
            console.log(`${PREFIX} Completed job: ${jobName} (${Date.now() - startTime}ms, ${recordsProcessed} records)`);
            return result;
        } catch (err) {
            logSchedulerEnd(logId, 0, err.message);
            console.error(`${PREFIX} FAILED job: ${jobName} — ${err.message}`);
            return null;
        }
    });
}

// ── Job definitions ──────────────────────────────────────────────────────
const jobs = {};
const jobLastRun = {};

const JOB_DEFS = {
    'watcher-refresh': {
        schedule: '0 * * * *',                  // Every 1 hour
        description: 'feWatcher incremental refresh',
        fn: () => feWatcher.refresh()
    },
    'anomaly-check': {
        schedule: '0 */3 * * *',                // Every 3 hours
        description: 'feAnomalyDetector runAllChecks',
        fn: () => feAnomalyDetector.runAllChecks()
    },
    'data-quality-check': {
        schedule: '15 * * * *',                 // Every hour at :15
        description: 'feDataQualityMonitor runAudit',
        fn: () => feDataQualityMonitor.runAudit()
    },
    'proposal-generate': {
        schedule: '0 */6 * * *',                // Every 6 hours
        description: 'feProposalGenerator generateProposals',
        fn: () => feProposalGenerator.generateProposals()
    },
    'knowledge-crawl-tier1': {
        schedule: '30 */6 * * *',               // Every 6 hours at :30
        description: 'feKnowledgeCrawler crawlAll (Tier 1)',
        fn: () => feKnowledgeCrawler.crawlAll({ tier: 1 })
    },
    'knowledge-crawl-all': {
        schedule: '0 */12 * * *',               // Every 12 hours
        description: 'feKnowledgeCrawler crawlAll (all tiers)',
        fn: () => feKnowledgeCrawler.crawlAll()
    },
    'hypothesis-generate': {
        schedule: '0 0 * * *',                  // Every 24 hours at midnight
        description: 'feSelfTester generateHypotheses',
        fn: () => feSelfTester.generateHypotheses()
    },
    'memory-consolidate': {
        schedule: '30 20 * * *',                // 2:00 AM IST = 20:30 UTC
        description: 'feMemory nightly consolidation',
        fn: () => feMemory.consolidate()
    },
    'accuracy-audit': {
        schedule: '0 3 * * 0',                  // Every Sunday at 3 AM UTC
        description: 'feAccuracyAuditor runAudit',
        fn: () => feAccuracyAuditor.runAudit()
    },
    'proposal-expiry': {
        schedule: '0 4 1 * *',                  // 1st of every month at 4 AM
        description: 'Expire old pending proposals (>30 days)',
        fn: async () => {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const result = query(
                `UPDATE fe_proposals
                 SET status = 'expired'
                 WHERE status = 'pending' AND generated_at < ?
                 RETURNING id`,
                [thirtyDaysAgo]
            );
            console.log(`${PREFIX} Expired ${result.length} stale proposals.`);
            return result.length;
        }
    },
    'verify-applied-changes': {
        schedule: '0 5 * * 0',                  // Every Sunday at 5 AM UTC
        description: 'feApprovalEngine verifyAppliedChanges',
        fn: () => feApprovalEngine.verifyAppliedChanges()
    }
};

// ── start() — Initialize all cron jobs ───────────────────────────────────
function start() {
    console.log(`${PREFIX} Initializing scheduler with ${Object.keys(JOB_DEFS).length} jobs...`);

    for (const [jobName, def] of Object.entries(JOB_DEFS)) {
        jobs[jobName] = cron.schedule(def.schedule, () => {
            runJob(jobName, def.fn).then(() => {
                jobLastRun[jobName] = new Date().toISOString();
            });
        }, { timezone: 'UTC' });

        console.log(`${PREFIX}   Registered: ${jobName} (${def.schedule}) — ${def.description}`);
    }

    // Run initial watcher + anomaly check after 30s delay
    setTimeout(async () => {
        console.log(`${PREFIX} Running initial startup checks...`);
        await runJob('watcher-refresh', JOB_DEFS['watcher-refresh'].fn);
        jobLastRun['watcher-refresh'] = new Date().toISOString();

        await runJob('anomaly-check', JOB_DEFS['anomaly-check'].fn);
        jobLastRun['anomaly-check'] = new Date().toISOString();

        await runJob('data-quality-check', JOB_DEFS['data-quality-check'].fn);
        jobLastRun['data-quality-check'] = new Date().toISOString();

        console.log(`${PREFIX} Initial startup checks complete.`);
    }, 30 * 1000);

    console.log(`${PREFIX} Scheduler started. Initial checks will run in 30 seconds.`);
}

// ── getStatus() — Return all jobs with status info ───────────────────────
function getStatus() {
    const status = {};

    for (const [jobName, def] of Object.entries(JOB_DEFS)) {
        // Get last run from DB
        const lastRunRows = query(
            `SELECT started_at, completed_at, status, duration_ms, records_processed, errors
             FROM fe_scheduler_log
             WHERE job_name = ?
             ORDER BY started_at DESC
             LIMIT 1`,
            [jobName]
        );

        const lastRun = lastRunRows.length > 0 ? lastRunRows[0] : null;

        // Calculate next run from cron expression
        let nextRun = null;
        try {
            const interval = cron.getTasks();
            // node-cron doesn't expose next run easily, so compute from last run + schedule
            // We'll just note the cron schedule
            nextRun = def.schedule;
        } catch (e) {
            nextRun = def.schedule;
        }

        status[jobName] = {
            description: def.description,
            schedule: def.schedule,
            is_running: !!locks[jobName],
            last_run: lastRun ? {
                started_at: lastRun.started_at,
                completed_at: lastRun.completed_at,
                status: lastRun.status,
                duration_ms: lastRun.duration_ms,
                records_processed: lastRun.records_processed,
                errors: lastRun.errors
            } : null,
            last_run_cached: jobLastRun[jobName] || null,
            next_cron: def.schedule
        };
    }

    return status;
}

// ── triggerJob(jobName) — Manually trigger any job by name ───────────────
async function triggerJob(jobName) {
    const def = JOB_DEFS[jobName];
    if (!def) {
        const available = Object.keys(JOB_DEFS).join(', ');
        throw new Error(`Unknown job "${jobName}". Available: ${available}`);
    }

    console.log(`${PREFIX} Manual trigger: ${jobName}`);
    const result = await runJob(jobName, def.fn);
    jobLastRun[jobName] = new Date().toISOString();
    return result;
}

// ── Auto-start on require ────────────────────────────────────────────────
start();

module.exports = { start, getStatus, triggerJob };
