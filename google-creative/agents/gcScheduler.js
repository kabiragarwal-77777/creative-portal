const cron = require('node-cron');

module.exports = function(agents) {
    const { dataFetcher, classifier, scoring, signals, recommendations, forecast } = agents;

    console.log('[GC Scheduler] Initializing...');

    const running = {};

    async function runJob(name, fn) {
        if (running[name]) {
            console.log(`[GC Scheduler] ${name} already running, skipping`);
            return;
        }
        running[name] = true;
        console.log(`[GC Scheduler] Starting ${name}...`);
        try {
            const result = await fn();
            console.log(`[GC Scheduler] ${name} completed`, result ? '' : '');
            return result;
        } catch (err) {
            console.error(`[GC Scheduler] ${name} error:`, err.message);
            throw err;
        } finally {
            running[name] = false;
        }
    }

    function scheduleJob(cronExpr, name, fn) {
        cron.schedule(cronExpr, () => {
            runJob(name, fn).catch(err => {
                console.error(`[GC Scheduler] ${name} failed:`, err.message);
            });
        }, { timezone: 'Asia/Kolkata' });
    }

    // Every 6 hours: data fetch only
    scheduleJob('0 */6 * * *', 'data-fetch', () => dataFetcher.runFullFetch(90));

    // Every 6 hours, offset: classification only
    scheduleJob('10 */6 * * *', 'classify', () => classifier.classifyAll({ incrementalOnly: true }));

    // Every 6 hours, offset: scoring only
    scheduleJob('20 */6 * * *', 'score', () => scoring.scoreAll());

    // Every 12 hours: brief generation split by brief type
    scheduleJob('0 */12 * * *', 'briefs-rsa', () => recommendations.generateBriefs('rsa'));
    scheduleJob('20 */12 * * *', 'briefs-video', () => recommendations.generateBriefs('video'));
    scheduleJob('40 */12 * * *', 'briefs-pmax', () => recommendations.generateBriefs('pmax'));

    // Daily 6 AM IST: forecast actuals only
    scheduleJob('0 6 * * *', 'forecast', () => forecast.updateForecasts());

    // Daily 6:20 AM IST: market signals only
    scheduleJob('20 6 * * *', 'signals', () => signals.fetchMarketSignals());

    console.log('[GC Scheduler] Cron jobs registered (data fetch, classify, score, briefs by type, forecast, signals)');

    // Bootstrap each job separately so startup does not bundle analysis steps
    setTimeout(() => {
        runJob('data-fetch', () => dataFetcher.runFullFetch(90)).catch(err => {
            console.error('[GC Scheduler] Initial data fetch error:', err.message);
        });
    }, 30000);

    setTimeout(() => {
        runJob('classify', () => classifier.classifyAll({ incrementalOnly: true })).catch(err => {
            console.error('[GC Scheduler] Initial classify error:', err.message);
        });
    }, 60000);

    setTimeout(() => {
        runJob('score', () => scoring.scoreAll()).catch(err => {
            console.error('[GC Scheduler] Initial score error:', err.message);
        });
    }, 90000);

    setTimeout(() => {
        runJob('signals', () => signals.fetchMarketSignals()).catch(err => {
            console.error('[GC Scheduler] Initial signals error:', err.message);
        });
    }, 120000);
};
