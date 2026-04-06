/**
 * AT Scheduler — Cron orchestrator for all audience-testing agents.
 * Runs as a standalone require (directly executes on load).
 */

const cron = require('node-cron');
const { getAtDb, logSchedulerRun, updateSchedulerRun } = require('../db/at-db');

// Mutex to prevent overlapping runs
const running = {};

async function runJob(name, fn) {
    if (running[name]) {
        console.log(`[AT Scheduler] ${name} already running, skipping`);
        return;
    }
    running[name] = true;
    const runId = await logSchedulerRun(name, 'Starting...');
    console.log(`[AT Scheduler] Starting ${name}...`);
    try {
        const result = await fn();
        await updateSchedulerRun(runId, 'completed', JSON.stringify(result || {}));
        console.log(`[AT Scheduler] ${name} completed`);
    } catch (err) {
        await updateSchedulerRun(runId, 'error', null, err.message);
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
    metabaseSessionToken: process.env.METABASE_SESSION_TOKEN,
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
    'recommend-all': () => recommendationEngine.generateAll(),
    'scan-meta-full': () => metaScanner.runFullScan(),
    'scan-google-full': () => googleScanner.runFullScan(),
};

// --------------- Cron schedules (Asia/Kolkata) ---------------

// Every 6 hours: optimizer health check
cron.schedule('0 */6 * * *', () => {
    runJob('optimizer-health', jobMap['optimizer-health']);
}, { timezone: 'Asia/Kolkata' });

// Every 12 hours: enrich meta + google from Metabase
cron.schedule('0 */12 * * *', () => {
    runJob('enrich-meta', jobMap['enrich-meta']);
    runJob('enrich-google', jobMap['enrich-google']);
}, { timezone: 'Asia/Kolkata' });

// Daily at 3 AM: learning engine analysis
cron.schedule('0 3 * * *', () => {
    runJob('learn-meta', jobMap['learn-meta']);
    runJob('learn-google', jobMap['learn-google']);
}, { timezone: 'Asia/Kolkata' });

// Every 48 hours (2 AM on even days): recommendation generation
cron.schedule('0 2 */2 * *', () => {
    runJob('recommend-all', jobMap['recommend-all']);
}, { timezone: 'Asia/Kolkata' });

// Weekly Sunday 1 AM: full platform scans
cron.schedule('0 1 * * 0', () => {
    runJob('scan-meta-full', jobMap['scan-meta-full']);
    runJob('scan-google-full', jobMap['scan-google-full']);
}, { timezone: 'Asia/Kolkata' });

// --------------- On-load bootstrap (45s delay) ---------------
// Only run a quick health check — do NOT auto-trigger full scans
// (those eat Meta API quota and compete with main portal calls)

setTimeout(async () => {
    try {
        const db = await getAtDb();
        const metaCount = await db.prepare('SELECT COUNT(*) as cnt FROM at_meta_adsets').get();
        const googleCount = await db.prepare('SELECT COUNT(*) as cnt FROM at_google_adgroups').get();
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

async function getSchedulerStatus() {
    const db = await getAtDb();

    const recentRuns = await db.prepare(`
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
        { job: 'enrich-google', schedule: 'Every 12 hours (0 */12 * * *)' },
        { job: 'learn-meta', schedule: 'Daily at 3 AM (0 3 * * *)' },
        { job: 'learn-google', schedule: 'Daily at 3 AM (0 3 * * *)' },
        { job: 'recommend-all', schedule: 'Every 48 hours (0 2 */2 * *)' },
        { job: 'scan-meta-full', schedule: 'Weekly Sunday 1 AM (0 1 * * 0)' },
        { job: 'scan-google-full', schedule: 'Weekly Sunday 1 AM (0 1 * * 0)' },
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
