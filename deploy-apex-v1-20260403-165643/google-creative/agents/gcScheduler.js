const cron = require('node-cron');

module.exports = function(agents) {
    const { dataFetcher, classifier, scoring, signals, recommendations, forecast } = agents;

    console.log('[GC Scheduler] Initializing...');

    // Every 6 hours: fetch -> classify -> score
    cron.schedule('0 */6 * * *', async () => {
        console.log('[GC Scheduler] Starting 6-hour cycle...');
        try {
            await dataFetcher.runFullFetch(90);
            console.log('[GC Scheduler] Fetch complete, classifying...');
            await classifier.classifyAll({ incrementalOnly: true });
            console.log('[GC Scheduler] Classification complete, scoring...');
            await scoring.scoreAll();
            console.log('[GC Scheduler] Scoring complete.');
        } catch(err) {
            console.error('[GC Scheduler] 6-hour cycle error:', err.message);
        }
    }, { timezone: 'Asia/Kolkata' });

    // Every 12 hours: recommendations refresh
    cron.schedule('0 */12 * * *', async () => {
        console.log('[GC Scheduler] Starting 12-hour recommendations refresh...');
        try {
            await recommendations.generateBriefs('all');
            console.log('[GC Scheduler] Recommendations refresh complete.');
        } catch(err) {
            console.error('[GC Scheduler] 12-hour recommendations error:', err.message);
        }
    }, { timezone: 'Asia/Kolkata' });

    // Daily 6 AM IST: forecast actuals + divergence check + market signals
    cron.schedule('0 6 * * *', async () => {
        console.log('[GC Scheduler] Starting daily 6 AM cycle...');
        try {
            console.log('[GC Scheduler] Updating forecast actuals...');
            const forecastResult = await forecast.updateForecasts();
            console.log(`[GC Scheduler] Forecast updated: ${forecastResult.updated} rows, ${forecastResult.alerts} new alerts`);

            console.log('[GC Scheduler] Fetching market signals...');
            const marketResult = await signals.fetchMarketSignals();
            console.log(`[GC Scheduler] Market signals: ${marketResult.market_sentiment} (source: ${marketResult.source})`);

            console.log('[GC Scheduler] Daily 6 AM cycle complete.');
        } catch(err) {
            console.error('[GC Scheduler] Daily 6 AM cycle error:', err.message);
        }
    }, { timezone: 'Asia/Kolkata' });

    console.log('[GC Scheduler] Cron jobs registered (6h fetch/classify/score, 12h recommendations, daily 6AM forecast+signals)');

    // Run initial fetch after 30 seconds (let server settle)
    setTimeout(async () => {
        console.log('[GC Scheduler] Running initial data fetch...');
        try {
            await dataFetcher.runFullFetch(90);
            await classifier.classifyAll({ incrementalOnly: true });
            await scoring.scoreAll();
            await signals.fetchMarketSignals();
            console.log('[GC Scheduler] Initial cycle complete.');
        } catch(err) {
            console.error('[GC Scheduler] Initial cycle error:', err.message);
        }
    }, 30000);
};
