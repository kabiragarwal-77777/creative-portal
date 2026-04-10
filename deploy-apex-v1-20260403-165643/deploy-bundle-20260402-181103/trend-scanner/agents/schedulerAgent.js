const cron = require('node-cron');

let runFullScan = null;

// Every 2 hours: full scrape + synthesis
cron.schedule('0 */2 * * *', () => {
  if (runFullScan) {
    console.log('[TrendScanner] Scheduled scan starting...');
    runFullScan().catch((e) =>
      console.error('[TrendScanner] Scheduled scan failed:', e)
    );
  }
});

// Every 6 hours: regenerate creative concepts
cron.schedule('0 */6 * * *', () => {
  console.log('[TrendScanner] Scheduled concept regeneration...');
  // Concept generation runs as part of full scan
  if (runFullScan) {
    runFullScan().catch((e) =>
      console.error('[TrendScanner] Scheduled concept regen failed:', e)
    );
  }
});

function startScheduler(scanFn) {
  runFullScan = scanFn;
  console.log('[TrendScanner] Scheduler started — scans every 2h, concepts every 6h');
}

module.exports = { startScheduler };
