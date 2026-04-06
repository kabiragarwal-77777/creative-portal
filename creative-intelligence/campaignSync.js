// ============================================================
// CAMPAIGN SYNC VALIDATOR — creative-intelligence/campaignSync.js
// Validates that ads stored in SQLite still exist in Meta API,
// marks ghost entries, and provides sync status reporting.
// ============================================================

const { getCiDb } = require('./db');

// =========================================================================
// Schema migration: add is_ghost + ghost_reason columns to relevant tables
// =========================================================================
function ensureGhostColumns() {
    const db = getCiDb();

    const tables = ['snapshots', 'roas_tracker', 'actions', 'simulations', 'trends'];

    for (const table of tables) {
        // Check if is_ghost column already exists
        const columns = db.prepare(`PRAGMA table_info(${table})`).all();
        const hasGhost = columns.some(c => c.name === 'is_ghost');
        const hasGhostReason = columns.some(c => c.name === 'ghost_reason');
        const hasMetaCampaignId = columns.some(c => c.name === 'meta_campaign_id');

        if (!hasGhost) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN is_ghost INTEGER DEFAULT 0`);
            console.log(`[CampaignSync] Added is_ghost column to ${table}`);
        }
        if (!hasGhostReason) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ghost_reason TEXT`);
            console.log(`[CampaignSync] Added ghost_reason column to ${table}`);
        }
        if (!hasMetaCampaignId && (table === 'snapshots' || table === 'roas_tracker')) {
            // snapshots and roas_tracker get meta_campaign_id for cross-referencing
            db.exec(`ALTER TABLE ${table} ADD COLUMN meta_campaign_id TEXT`);
            console.log(`[CampaignSync] Added meta_campaign_id column to ${table}`);
        }
    }

    // Create sync_log table for tracking sync runs
    db.exec(`
        CREATE TABLE IF NOT EXISTS sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_at TEXT DEFAULT (datetime('now')),
            total_stored_ads INTEGER DEFAULT 0,
            total_meta_ads INTEGER DEFAULT 0,
            ghosts_found INTEGER DEFAULT 0,
            ghosts_restored INTEGER DEFAULT 0,
            details TEXT,
            status TEXT DEFAULT 'success',
            error TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sync_log_date ON sync_log(run_at);
    `);

    console.log('[CampaignSync] Ghost columns and sync_log table ensured');
}

// =========================================================================
// fetchAllMetaAdIds — Fetch all ad IDs from Meta API for the ad account
// =========================================================================
async function fetchAllMetaAdIds(config) {
    const META_API_BASE = config.metaApiBase || 'https://graph.facebook.com/v21.0';
    const META_AD_ACCOUNT_ID = config.metaAdAccountId || 'act_725019929189148';
    const META_ACCESS_TOKEN = config.metaAccessToken || '';
    const META_APP_SECRET_PROOF = config.metaAppSecretProof || '';

    if (!META_ACCESS_TOKEN) {
        console.warn('[CampaignSync] No Meta access token configured — skipping API fetch');
        return null; // null means "could not fetch" (different from empty array)
    }

    const allAdIds = new Set();
    const campaignIdMap = {}; // ad_id -> campaign_id

    // Fetch ads with their campaign IDs
    const params = new URLSearchParams({
        access_token: META_ACCESS_TOKEN,
        appsecret_proof: META_APP_SECRET_PROOF,
        fields: 'id,campaign_id,name,status',
        limit: '500',
    });

    let nextUrl = `${META_API_BASE}/${META_AD_ACCOUNT_ID}/ads?${params.toString()}`;
    let pages = 0;

    while (nextUrl && pages < 50) { // safety limit
        pages++;
        try {
            const response = await fetch(nextUrl);
            const data = await response.json();

            if (data.error) {
                console.error(`[CampaignSync] Meta API error: ${data.error.message}`);
                break;
            }

            if (data.data) {
                for (const ad of data.data) {
                    allAdIds.add(ad.id);
                    campaignIdMap[ad.id] = ad.campaign_id || null;
                }
            }

            if (data.paging && data.paging.next) {
                const sep = data.paging.next.includes('?') ? '&' : '?';
                nextUrl = data.paging.next + sep + 'appsecret_proof=' + encodeURIComponent(META_APP_SECRET_PROOF);
            } else {
                nextUrl = null;
            }
        } catch (err) {
            console.error(`[CampaignSync] Fetch error on page ${pages}:`, err.message);
            break;
        }
    }

    console.log(`[CampaignSync] Fetched ${allAdIds.size} ad IDs from Meta API (${pages} pages)`);
    return { adIds: allAdIds, campaignIdMap };
}

// =========================================================================
// deduplicateGhostCampaigns — Core sync logic
// =========================================================================
async function deduplicateGhostCampaigns(config) {
    const db = getCiDb();

    console.log('[CampaignSync] Starting ghost campaign deduplication...');

    // 1. Pull all ad IDs from Meta API
    const metaResult = await fetchAllMetaAdIds(config);

    if (!metaResult) {
        console.warn('[CampaignSync] Could not fetch Meta ad IDs — skipping dedup');
        db.prepare(`
            INSERT INTO sync_log (total_stored_ads, total_meta_ads, ghosts_found, status, error)
            VALUES (0, 0, 0, 'skipped', 'No Meta access token or API error')
        `).run();
        return { ghostsMarked: 0, ghostsRestored: 0, status: 'skipped' };
    }

    const { adIds: metaAdIds, campaignIdMap } = metaResult;

    // 2. Pull all ad_ids stored in snapshots (non-ghost)
    const storedAds = db.prepare(`
        SELECT DISTINCT ad_id FROM snapshots
        WHERE (is_ghost != 1 OR is_ghost IS NULL) AND ad_id IS NOT NULL AND ad_id != ''
    `).all();

    // 3. Pull all ad_ids from roas_tracker (non-ghost)
    const trackerAds = db.prepare(`
        SELECT DISTINCT ad_id FROM roas_tracker
        WHERE (is_ghost != 1 OR is_ghost IS NULL) AND ad_id IS NOT NULL AND ad_id != ''
    `).all();

    // 4. Combine all unique stored ad IDs
    const allStoredIds = new Set([
        ...storedAds.map(r => r.ad_id),
        ...trackerAds.map(r => r.ad_id),
    ]);

    // 5. Find ghosts — stored but not in Meta API
    const ghostAdIds = [];
    for (const adId of allStoredIds) {
        if (!metaAdIds.has(adId)) {
            ghostAdIds.push(adId);
        }
    }

    // 6. Find resurrected — previously marked ghost but now found in Meta
    const previousGhosts = db.prepare(`
        SELECT DISTINCT ad_id FROM snapshots WHERE is_ghost = 1
    `).all();
    const restoredAdIds = [];
    for (const row of previousGhosts) {
        if (metaAdIds.has(row.ad_id)) {
            restoredAdIds.push(row.ad_id);
        }
    }

    // 7. Mark ghosts (don't delete — soft flag)
    let ghostsMarked = 0;
    if (ghostAdIds.length > 0) {
        const markGhostSnapshot = db.prepare(
            'UPDATE snapshots SET is_ghost = 1, ghost_reason = ? WHERE ad_id = ? AND (is_ghost != 1 OR is_ghost IS NULL)'
        );
        const markGhostTracker = db.prepare(
            'UPDATE roas_tracker SET is_ghost = 1, ghost_reason = ? WHERE ad_id = ? AND (is_ghost != 1 OR is_ghost IS NULL)'
        );
        const markGhostActions = db.prepare(
            'UPDATE actions SET is_ghost = 1, ghost_reason = ? WHERE ad_id = ? AND (is_ghost != 1 OR is_ghost IS NULL)'
        );
        const markGhostTrends = db.prepare(
            'UPDATE trends SET is_ghost = 1, ghost_reason = ? WHERE ad_id = ? AND (is_ghost != 1 OR is_ghost IS NULL)'
        );

        const markTransaction = db.transaction((ids) => {
            for (const adId of ids) {
                const reason = 'not_found_in_meta_api';
                markGhostSnapshot.run(reason, adId);
                markGhostTracker.run(reason, adId);
                markGhostActions.run(reason, adId);
                markGhostTrends.run(reason, adId);
                ghostsMarked++;
            }
        });
        markTransaction(ghostAdIds);
    }

    // 8. Restore previously ghosted ads that are back in Meta
    let ghostsRestored = 0;
    if (restoredAdIds.length > 0) {
        const restoreSnapshot = db.prepare(
            'UPDATE snapshots SET is_ghost = 0, ghost_reason = NULL WHERE ad_id = ?'
        );
        const restoreTracker = db.prepare(
            'UPDATE roas_tracker SET is_ghost = 0, ghost_reason = NULL WHERE ad_id = ?'
        );
        const restoreActions = db.prepare(
            'UPDATE actions SET is_ghost = 0, ghost_reason = NULL WHERE ad_id = ?'
        );
        const restoreTrends = db.prepare(
            'UPDATE trends SET is_ghost = 0, ghost_reason = NULL WHERE ad_id = ?'
        );

        const restoreTransaction = db.transaction((ids) => {
            for (const adId of ids) {
                restoreSnapshot.run(adId);
                restoreTracker.run(adId);
                restoreActions.run(adId);
                restoreTrends.run(adId);
                ghostsRestored++;
            }
        });
        restoreTransaction(restoredAdIds);
    }

    // 9. Backfill meta_campaign_id where possible
    const backfillSnapshot = db.prepare(
        'UPDATE snapshots SET meta_campaign_id = ? WHERE ad_id = ? AND (meta_campaign_id IS NULL OR meta_campaign_id = "")'
    );
    const backfillTracker = db.prepare(
        'UPDATE roas_tracker SET meta_campaign_id = ? WHERE ad_id = ? AND (meta_campaign_id IS NULL OR meta_campaign_id = "")'
    );
    const backfillTransaction = db.transaction(() => {
        for (const [adId, campaignId] of Object.entries(campaignIdMap)) {
            if (campaignId) {
                backfillSnapshot.run(campaignId, adId);
                backfillTracker.run(campaignId, adId);
            }
        }
    });
    backfillTransaction();

    // 10. Log sync run
    db.prepare(`
        INSERT INTO sync_log (total_stored_ads, total_meta_ads, ghosts_found, ghosts_restored, details, status)
        VALUES (?, ?, ?, ?, ?, 'success')
    `).run(
        allStoredIds.size,
        metaAdIds.size,
        ghostsMarked,
        ghostsRestored,
        JSON.stringify({
            ghostAdIds: ghostAdIds.slice(0, 50), // store first 50 for debugging
            restoredAdIds: restoredAdIds.slice(0, 50),
        })
    );

    console.log(`[CampaignSync] Done. Marked ${ghostsMarked} ghosts, restored ${ghostsRestored}. Stored: ${allStoredIds.size}, Meta: ${metaAdIds.size}`);

    return {
        ghostsMarked,
        ghostsRestored,
        totalStored: allStoredIds.size,
        totalMeta: metaAdIds.size,
        status: 'success',
    };
}

// =========================================================================
// validateCampaignSync — Ongoing validation (lightweight check)
// =========================================================================
async function validateCampaignSync(config) {
    const db = getCiDb();

    try {
        console.log('[CampaignSync] Running scheduled sync validation...');
        const result = await deduplicateGhostCampaigns(config);

        // Additional check: find duplicate ad entries across snapshots
        const duplicates = db.prepare(`
            SELECT ad_id, snapshot_date, COUNT(*) as cnt
            FROM snapshots
            WHERE is_ghost != 1 OR is_ghost IS NULL
            GROUP BY ad_id, snapshot_date
            HAVING cnt > 1
        `).all();

        if (duplicates.length > 0) {
            console.warn(`[CampaignSync] Found ${duplicates.length} duplicate snapshot entries`);
        }

        return {
            ...result,
            duplicateEntries: duplicates.length,
        };
    } catch (err) {
        console.error('[CampaignSync] Validation error:', err.message);
        db.prepare(`
            INSERT INTO sync_log (status, error) VALUES ('error', ?)
        `).run(err.message);
        return { status: 'error', error: err.message };
    }
}

// =========================================================================
// getSyncStatus — Returns current sync state for API endpoint
// =========================================================================
function getSyncStatus() {
    const db = getCiDb();

    // Latest sync run
    const lastSync = db.prepare(`
        SELECT * FROM sync_log ORDER BY run_at DESC LIMIT 1
    `).get() || null;

    // Ghost counts per table
    const snapshotGhosts = db.prepare(`
        SELECT COUNT(DISTINCT ad_id) as count FROM snapshots WHERE is_ghost = 1
    `).get().count;

    const trackerGhosts = db.prepare(`
        SELECT COUNT(DISTINCT ad_id) as count FROM roas_tracker WHERE is_ghost = 1
    `).get().count;

    const actionGhosts = db.prepare(`
        SELECT COUNT(*) as count FROM actions WHERE is_ghost = 1
    `).get().count;

    // Total active (non-ghost) counts
    const activeSnapshots = db.prepare(`
        SELECT COUNT(DISTINCT ad_id) as count FROM snapshots
        WHERE is_ghost != 1 OR is_ghost IS NULL
    `).get().count;

    const activeTracker = db.prepare(`
        SELECT COUNT(*) as count FROM roas_tracker
        WHERE is_ghost != 1 OR is_ghost IS NULL
    `).get().count;

    // Recent sync history (last 10 runs)
    const syncHistory = db.prepare(`
        SELECT id, run_at, total_stored_ads, total_meta_ads, ghosts_found, ghosts_restored, status, error
        FROM sync_log ORDER BY run_at DESC LIMIT 10
    `).all();

    // Ghost ad details (latest 20)
    const ghostDetails = db.prepare(`
        SELECT DISTINCT s.ad_id, s.ad_name, s.campaign_name, s.ghost_reason,
            MAX(s.snapshot_date) as last_snapshot_date, MAX(s.spend) as max_spend
        FROM snapshots s
        WHERE s.is_ghost = 1
        GROUP BY s.ad_id
        ORDER BY last_snapshot_date DESC
        LIMIT 20
    `).all();

    return {
        lastSync: lastSync ? {
            runAt: lastSync.run_at,
            totalStored: lastSync.total_stored_ads,
            totalMeta: lastSync.total_meta_ads,
            ghostsFound: lastSync.ghosts_found,
            ghostsRestored: lastSync.ghosts_restored,
            status: lastSync.status,
            error: lastSync.error,
        } : null,
        ghostCounts: {
            snapshots: snapshotGhosts,
            roas_tracker: trackerGhosts,
            actions: actionGhosts,
        },
        activeCounts: {
            snapshot_ads: activeSnapshots,
            tracker_ads: activeTracker,
        },
        syncHistory,
        ghostDetails,
    };
}

// =========================================================================
// Scheduler: run sync on start + every 24 hours
// =========================================================================
let syncInterval = null;

function startSyncScheduler(config, intervalHours = 24) {
    if (syncInterval) clearInterval(syncInterval);

    const intervalMs = intervalHours * 3600000;

    console.log(`[CampaignSync] Scheduler starting (every ${intervalHours}h)`);

    // Ensure schema columns exist
    ensureGhostColumns();

    // Run initial sync after a short delay (let other startup complete)
    setTimeout(async () => {
        try {
            await validateCampaignSync(config);
        } catch (err) {
            console.error('[CampaignSync] Initial sync error:', err.message);
        }
    }, 30000); // 30 second delay on startup

    // Schedule recurring sync
    syncInterval = setInterval(async () => {
        try {
            await validateCampaignSync(config);
        } catch (err) {
            console.error('[CampaignSync] Scheduled sync error:', err.message);
        }
    }, intervalMs);
}

function stopSyncScheduler() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
        console.log('[CampaignSync] Scheduler stopped');
    }
}

module.exports = {
    ensureGhostColumns,
    fetchAllMetaAdIds,
    deduplicateGhostCampaigns,
    validateCampaignSync,
    getSyncStatus,
    startSyncScheduler,
    stopSyncScheduler,
};
