/**
 * AT Scheduler — Cron orchestrator for all audience-testing agents.
 * Runs as a standalone require (directly executes on load).
 */

const cron = require('node-cron');
const { getAtDb, logSchedulerRun, updateSchedulerRun } = require('../db/at-db');
const { getMetabaseSessionToken } = require('../../config/env');

// Mutex to prevent overlapping runs
const running = {};

async function runJob(name, fn) {
    if (running[name]) {
        console.log(`[AT Scheduler] ${name} already running, skipping`);
        return;
    }
    running[name] = true;
    const runId = logSchedulerRun(name, 'Starting...');
    console.log(`[AT Scheduler] Starting ${name}...`);
    try {
        const result = await fn();
        updateSchedulerRun(runId, 'completed', JSON.stringify(result || {}));
        console.log(`[AT Scheduler] ${name} completed`);
    } catch (err) {
        updateSchedulerRun(runId, 'error', null, err.message);
        console.error(`[AT Scheduler] ${name} error:`, err.message);
    } finally {
        running[name] = false;
    }
}

// Build config from environment
const config = {
    metaAccessToken: process.env.META_ACCESS_TOKEN,
    metaAdAccountId: process.env.META_AD_ACCOUNT_ID,
    metabaseUrl: process.env.METABASE_URL || 'https://analytics.univest.in',
    metabaseSessionToken: getMetabaseSessionToken(),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
};

// Initialize all agents
const metaScanner = require('./atMetaScanner')(config);
const googleScanner = require('./atGoogleScanner')(config);
const enricher = require('./atMetabaseEnricher')(config);
const learningEngine = require('./atLearningEngine')(config);
const recommendationEngine = require('./atRecommendationEngine')(config);
const optimizer = require('./atCurrentOptimizer')(config);

// --------------- Job definitions ---------------

const jobMap = {
    'optimizer-health': () => optimizer.checkHealth(),
    'enrich-meta': () => enricher.enrichMeta(),
    'enrich-google': () => enricher.enrichGoogle(),
    'learn-meta': () => learningEngine.runMetaAnalysis(),
    'learn-google': () => learningEngine.runGoogleAnalysis(),
    'recommend-meta': () => recommendationEngine.generatePlatformRecommendations('meta'),
    'recommend-google': () => recommendationEngine.generatePlatformRecommendations('google'),
    'scan-meta-full': () => metaScanner.runFullScan(),
    'scan-google-full': () => googleScanner.runFullScan(),
};

// --------------- Cron schedules (Asia/Kolkata) ---------------

function scheduleJob(cronExpr, jobName) {
    cron.schedule(cronExpr, () => {
        runJob(jobName, jobMap[jobName]);
    }, { timezone: 'Asia/Kolkata' });
}

// Every 6 hours: optimizer health check
scheduleJob('0 */6 * * *', 'optimizer-health');

// Every 12 hours: enrich meta + google from Metabase
scheduleJob('0 */12 * * *', 'enrich-meta');
scheduleJob('10 */12 * * *', 'enrich-google');

// Daily at 3 AM: learning engine analysis
scheduleJob('0 3 * * *', 'learn-meta');
scheduleJob('15 3 * * *', 'learn-google');

// Every 48 hours (2 AM on even days): recommendation generation
scheduleJob('0 2 */2 * *', 'recommend-meta');
scheduleJob('20 2 */2 * *', 'recommend-google');

// Weekly Sunday 1 AM: full platform scans
scheduleJob('0 1 * * 0', 'scan-meta-full');
scheduleJob('20 1 * * 0', 'scan-google-full');

// --------------- On-load bootstrap (45s delay) ---------------
// Only run a quick health check — do NOT auto-trigger full scans
// (those eat Meta API quota and compete with main portal calls)

setTimeout(async () => {
    try {
        const db = getAtDb();
        const metaCount = db.prepare('SELECT COUNT(*) as cnt FROM at_meta_adsets').get();
        const googleCount = db.prepare('SELECT COUNT(*) as cnt FROM at_google_adgroups').get();
        console.log(`[AT Scheduler] Bootstrap: ${metaCount?.cnt || 0} meta adsets, ${googleCount?.cnt || 0} google adgroups in DB`);
        if ((metaCount?.cnt || 0) > 0) {
            console.log('[AT Scheduler] Running initial optimizer health check...');
            await runJob('optimizer-health', jobMap['optimizer-health']);
        } else {
            console.log('[AT Scheduler] No data yet — use Scan Now button in the UI to trigger first scan');
        }
    } catch (err) {
        console.error('[AT Scheduler] Bootstrap error:', err.message);
    }
}, 45000);

// --------------- Exports ---------------

function getSchedulerStatus() {
    const db = getAtDb();

    const recentRuns = db.prepare(`
        SELECT id, job_type, status, started_at, completed_at, details, error
        FROM at_scheduler_log
        ORDER BY id DESC
        LIMIT 50
    `).all();

    const parsedRuns = recentRuns.map(r => {
        let details = null;
        try { details = JSON.parse(r.details); } catch (_) { details = r.details; }
        return { ...r, details };
    });

    const currentlyRunning = Object.keys(running).filter(k => running[k]);

    const cronSchedules = [
        { job: 'optimizer-health', schedule: 'Every 6 hours (0 */6 * * *)' },
        { job: 'enrich-meta', schedule: 'Every 12 hours (0 */12 * * *)' },
        { job: 'enrich-google', schedule: 'Every 12 hours (10 */12 * * *)' },
        { job: 'learn-meta', schedule: 'Daily at 3 AM (0 3 * * *)' },
        { job: 'learn-google', schedule: 'Daily at 3 AM (15 3 * * *)' },
        { job: 'recommend-meta', schedule: 'Every 48 hours (0 2 */2 * *)' },
        { job: 'recommend-google', schedule: 'Every 48 hours (20 2 */2 * *)' },
        { job: 'scan-meta-full', schedule: 'Weekly Sunday 1 AM (0 1 * * 0)' },
        { job: 'scan-google-full', schedule: 'Weekly Sunday 1 AM (20 1 * * 0)' },
    ];

    return {
        currentlyRunning,
        schedules: cronSchedules,
        recentRuns: parsedRuns
    };
}

function triggerJob(jobName) {
    const fn = jobMap[jobName];
    if (!fn) {
        return { success: false, error: `Unknown job: ${jobName}. Available: ${Object.keys(jobMap).join(', ')}` };
    }
    if (running[jobName]) {
        return { success: false, error: `Job ${jobName} is already running` };
    }
    // Fire and forget
    runJob(jobName, fn);
    return { success: true, message: `Job ${jobName} triggered` };
}

module.exports = { getSchedulerStatus, triggerJob };
