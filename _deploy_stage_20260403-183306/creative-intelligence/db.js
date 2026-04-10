let Database;
try {
    Database = require('better-sqlite3');
} catch (e) {
    // better-sqlite3 is installed in inventory-scanner/node_modules
    Database = require('../inventory-scanner/node_modules/better-sqlite3');
}
const path = require('path');

const DB_PATH = path.join(__dirname, 'ci.db');
let db;

function getCiDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        initSchema();
    }
    return db;
}

function ensureColumn(tableName, columnName, definition) {
    const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (!cols.some(col => col.name === columnName)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
}

function initSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS simulations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ad_id TEXT,
            ad_name TEXT NOT NULL,
            campaign_name TEXT,
            adset_name TEXT,
            creative_type TEXT,
            -- Current metrics at simulation time
            spend REAL DEFAULT 0,
            impressions INTEGER DEFAULT 0,
            clicks INTEGER DEFAULT 0,
            installs INTEGER DEFAULT 0,
            cpi REAL,
            ctr REAL,
            signups INTEGER DEFAULT 0,
            signup_cost REAL,
            d0_trial INTEGER DEFAULT 0,
            d0_trial_cost REAL,
            d6 INTEGER DEFAULT 0,
            d6_cac REAL,
            d6_roas REAL,
            d6_revenue REAL DEFAULT 0,
            overall_roas REAL,
            overall_revenue REAL DEFAULT 0,
            d6_overall_revenue REAL DEFAULT 0,
            hook_rate REAL,
            hold_rate REAL,
            completion_rate REAL,
            days_live INTEGER DEFAULT 0,
            go_live_date TEXT,
            -- Predictions
            predicted_d6_roas REAL,
            predicted_d6_low REAL,
            predicted_d6_high REAL,
            predicted_d30_roas REAL,
            predicted_d30_low REAL,
            predicted_d30_high REAL,
            predicted_d60_roas REAL,
            predicted_d60_low REAL,
            predicted_d60_high REAL,
            predicted_d120_roas REAL,
            predicted_d120_low REAL,
            predicted_d120_high REAL,
            predicted_d365_roas REAL,
            predicted_d365_low REAL,
            predicted_d365_high REAL,
            -- Recommendation
            trajectory TEXT,
            action TEXT,
            reasoning TEXT,
            budget_suggestion TEXT,
            risk_factors TEXT,
            similar_creatives TEXT,
            -- Full GPT response (JSON)
            raw_response TEXT,
            -- Meta
            simulated_at TEXT DEFAULT (datetime('now')),
            batch_id TEXT,
            is_live INTEGER DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_sim_ad_name ON simulations(ad_name);
        CREATE INDEX IF NOT EXISTS idx_sim_ad_id ON simulations(ad_id);
        CREATE INDEX IF NOT EXISTS idx_sim_batch ON simulations(batch_id);
        CREATE INDEX IF NOT EXISTS idx_sim_date ON simulations(simulated_at);
        CREATE INDEX IF NOT EXISTS idx_sim_live ON simulations(is_live);

        CREATE TABLE IF NOT EXISTS simulation_actuals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            simulation_id INTEGER NOT NULL,
            ad_name TEXT NOT NULL,
            actual_d6_roas REAL,
            actual_d30_roas REAL,
            actual_d60_roas REAL,
            actual_overall_roas REAL,
            actual_spend REAL,
            actual_revenue REAL,
            recorded_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (simulation_id) REFERENCES simulations(id)
        );

        CREATE INDEX IF NOT EXISTS idx_actuals_sim ON simulation_actuals(simulation_id);
        CREATE INDEX IF NOT EXISTS idx_actuals_ad ON simulation_actuals(ad_name);

        -- Daily snapshots of each ad's metrics
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_date TEXT NOT NULL,
            ad_id TEXT NOT NULL,
            ad_name TEXT NOT NULL,
            campaign_name TEXT, adset_name TEXT, creative_type TEXT,
            spend REAL DEFAULT 0, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
            cpm REAL, ctr REAL, cpc REAL, installs INTEGER DEFAULT 0, cpi REAL,
            hook_rate REAL, hold_rate REAL, completion_rate REAL,
            signups INTEGER DEFAULT 0, p0_signup INTEGER DEFAULT 0, p1_signup INTEGER DEFAULT 0,
            d0_trial INTEGER DEFAULT 0, d0 INTEGER DEFAULT 0, d0_revenue REAL DEFAULT 0,
            d6 INTEGER DEFAULT 0, d6_revenue REAL DEFAULT 0, d6_overall_revenue REAL DEFAULT 0,
            d15_overall_revenue REAL DEFAULT 0, d30_overall_revenue REAL DEFAULT 0, d60_overall_revenue REAL DEFAULT 0, d180_overall_revenue REAL DEFAULT 0,
            overall_revenue REAL DEFAULT 0,
            signup_cost REAL, d0_trial_cost REAL, d6_cac REAL, d6_roas REAL,
            d15_roas REAL, d30_roas REAL, d60_roas REAL, d180_roas REAL, overall_roas REAL,
            go_live_date TEXT, days_live INTEGER DEFAULT 0,
            batch_id TEXT NOT NULL,
            collected_at TEXT DEFAULT (datetime('now')),
            UNIQUE(snapshot_date, ad_id)
        );

        CREATE INDEX IF NOT EXISTS idx_snap_date ON snapshots(snapshot_date);
        CREATE INDEX IF NOT EXISTS idx_snap_ad_id ON snapshots(ad_id);
        CREATE INDEX IF NOT EXISTS idx_snap_ad_name ON snapshots(ad_name);
        CREATE INDEX IF NOT EXISTS idx_snap_batch ON snapshots(batch_id);
        CREATE INDEX IF NOT EXISTS idx_snap_campaign ON snapshots(campaign_name);

        -- Computed trends per ad
        CREATE TABLE IF NOT EXISTS trends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ad_id TEXT NOT NULL, ad_name TEXT NOT NULL,
            metric_name TEXT NOT NULL, period TEXT NOT NULL,
            value_current REAL, value_previous REAL, pct_change REAL,
            direction TEXT,
            computed_at TEXT DEFAULT (datetime('now')),
            UNIQUE(ad_id, metric_name, period)
        );

        CREATE INDEX IF NOT EXISTS idx_trends_ad ON trends(ad_id);
        CREATE INDEX IF NOT EXISTS idx_trends_metric ON trends(metric_name);
        CREATE INDEX IF NOT EXISTS idx_trends_period ON trends(period);

        -- Action recommendations
        CREATE TABLE IF NOT EXISTS actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ad_id TEXT NOT NULL, ad_name TEXT NOT NULL,
            campaign_name TEXT, adset_name TEXT,
            action_type TEXT NOT NULL,
            confidence TEXT DEFAULT 'medium',
            reasons TEXT, metrics_snapshot TEXT,
            priority INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            acknowledged INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_actions_ad ON actions(ad_id);
        CREATE INDEX IF NOT EXISTS idx_actions_type ON actions(action_type);
        CREATE INDEX IF NOT EXISTS idx_actions_active ON actions(is_active);
        CREATE INDEX IF NOT EXISTS idx_actions_priority ON actions(priority);

        -- Stored GPT analysis results
        CREATE TABLE IF NOT EXISTS analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            analysis_type TEXT NOT NULL,
            date_from TEXT, date_to TEXT,
            creatives_analyzed INTEGER DEFAULT 0,
            result TEXT,
            model_used TEXT DEFAULT 'gpt-5.4',
            analyzed_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_analyses_type ON analyses(analysis_type);
        CREATE INDEX IF NOT EXISTS idx_analyses_date ON analyses(analyzed_at);

        -- Pipeline run log
        CREATE TABLE IF NOT EXISTS pipeline_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_type TEXT NOT NULL,
            status TEXT DEFAULT 'running',
            started_at TEXT DEFAULT (datetime('now')),
            completed_at TEXT,
            details TEXT, error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_pipeline_type ON pipeline_runs(run_type);
        CREATE INDEX IF NOT EXISTS idx_pipeline_status ON pipeline_runs(status);

        -- Cohort benchmarks for prediction
        CREATE TABLE IF NOT EXISTS cohort_benchmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cohort_key TEXT NOT NULL,
            creative_type TEXT,
            campaign_pattern TEXT,
            sample_size INTEGER DEFAULT 0,
            median_d6_roas REAL, p25_d6_roas REAL, p75_d6_roas REAL,
            median_overall_roas REAL, p25_overall_roas REAL, p75_overall_roas REAL,
            benchmark_hook_rate REAL,
            benchmark_cpi REAL,
            benchmark_ctr REAL,
            benchmark_hold_rate REAL,
            d6_to_overall_multiplier REAL,
            computed_at TEXT DEFAULT (datetime('now')),
            UNIQUE(cohort_key)
        );

        CREATE INDEX IF NOT EXISTS idx_cohort_key ON cohort_benchmarks(cohort_key);

        -- ROAS/LTV Predictions
        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ad_id TEXT NOT NULL,
            ad_name TEXT NOT NULL,
            campaign_name TEXT, adset_name TEXT, creative_type TEXT,
            days_live_at_prediction INTEGER,
            early_spend REAL, early_cpi REAL, early_ctr REAL,
            early_hook_rate REAL, early_hold_rate REAL,
            early_installs INTEGER, early_signups INTEGER,
            early_d6_roas REAL, early_overall_roas REAL,
            cohort_key TEXT, cohort_sample_size INTEGER,
            predicted_d6_roas REAL, predicted_d6_low REAL, predicted_d6_high REAL,
            predicted_d15_roas REAL, predicted_d15_low REAL, predicted_d15_high REAL,
            predicted_d30_roas REAL, predicted_d30_low REAL, predicted_d30_high REAL,
            predicted_d60_roas REAL, predicted_d60_low REAL, predicted_d60_high REAL,
            predicted_d180_roas REAL, predicted_d180_low REAL, predicted_d180_high REAL,
            prediction_method TEXT, confidence_score REAL,
            gpt_qualitative TEXT,
            trajectory TEXT, recommended_action TEXT, reasoning TEXT,
            actual_d6_roas REAL, actual_d30_roas REAL, actual_d60_roas REAL, actual_d180_roas REAL,
            d6_accuracy_pct REAL, d30_accuracy_pct REAL,
            predicted_at TEXT DEFAULT (datetime('now')),
            batch_id TEXT,
            is_latest INTEGER DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_pred_ad ON predictions(ad_id);
        CREATE INDEX IF NOT EXISTS idx_pred_latest ON predictions(is_latest);
        CREATE INDEX IF NOT EXISTS idx_pred_date ON predictions(predicted_at);

        -- ROAS Tracker: lightweight index linking ads to predictions + latest actuals
        CREATE TABLE IF NOT EXISTS roas_tracker (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ad_id TEXT NOT NULL UNIQUE,
            ad_name TEXT NOT NULL,
            campaign_name TEXT,
            adset_name TEXT,
            creative_type TEXT,
            go_live_date TEXT,
            first_detected_at TEXT DEFAULT (datetime('now')),
            -- Prediction (set once, never overwritten)
            prediction_id INTEGER,
            predicted_d6_roas REAL,
            predicted_d6_low REAL,
            predicted_d6_high REAL,
            predicted_d30_roas REAL,
            predicted_d60_roas REAL,
            predicted_d90_roas REAL,
            prediction_confidence REAL,
            prediction_trajectory TEXT,
            predicted_action TEXT,
            predicted_at TEXT,
            -- Latest actuals (updated each refresh)
            latest_spend REAL DEFAULT 0,
            latest_installs INTEGER DEFAULT 0,
            latest_signups INTEGER DEFAULT 0,
            latest_d6 INTEGER DEFAULT 0,
            latest_cpi REAL,
            latest_d6_roas REAL,
            latest_overall_roas REAL,
            latest_d6_overall_revenue REAL DEFAULT 0,
            latest_overall_revenue REAL DEFAULT 0,
            latest_days_live INTEGER DEFAULT 0,
            latest_snapshot_date TEXT,
            -- Accuracy
            d6_accuracy_pct REAL,
            d30_accuracy_pct REAL,
            is_low_spend INTEGER DEFAULT 1,
            is_active INTEGER DEFAULT 1,
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (prediction_id) REFERENCES predictions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_rt_ad ON roas_tracker(ad_id);
        CREATE INDEX IF NOT EXISTS idx_rt_low_spend ON roas_tracker(is_low_spend);
        CREATE INDEX IF NOT EXISTS idx_rt_active ON roas_tracker(is_active);
        CREATE INDEX IF NOT EXISTS idx_rt_go_live ON roas_tracker(go_live_date);

        CREATE TABLE IF NOT EXISTS simulator_checkpoint_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ad_id TEXT NOT NULL,
            ad_name TEXT NOT NULL,
            campaign_name TEXT,
            adset_name TEXT,
            creative_type TEXT,
            go_live_date TEXT,
            checkpoint_code TEXT NOT NULL,
            checkpoint_day INTEGER NOT NULL,
            created_snapshot_date TEXT NOT NULL,
            days_live_at_creation INTEGER DEFAULT 0,
            spend_at_creation REAL DEFAULT 0,
            installs_at_creation INTEGER DEFAULT 0,
            signups_at_creation INTEGER DEFAULT 0,
            actual_roas_at_creation REAL,
            actual_revenue_at_creation REAL DEFAULT 0,
            actual_d6_roas REAL,
            actual_d15_roas REAL,
            actual_d30_roas REAL,
            actual_d60_roas REAL,
            actual_d180_roas REAL,
            predicted_d6_roas REAL,
            predicted_d6_low REAL,
            predicted_d6_high REAL,
            predicted_d15_roas REAL,
            predicted_d15_low REAL,
            predicted_d15_high REAL,
            predicted_d30_roas REAL,
            predicted_d30_low REAL,
            predicted_d30_high REAL,
            predicted_d60_roas REAL,
            predicted_d60_low REAL,
            predicted_d60_high REAL,
            predicted_d180_roas REAL,
            predicted_d180_low REAL,
            predicted_d180_high REAL,
            prediction_method TEXT,
            confidence_score REAL,
            trajectory TEXT,
            recommended_action TEXT,
            reasoning TEXT,
            gpt_qualitative TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(ad_id, checkpoint_code)
        );

        CREATE INDEX IF NOT EXISTS idx_scr_ad ON simulator_checkpoint_runs(ad_id);
        CREATE INDEX IF NOT EXISTS idx_scr_checkpoint ON simulator_checkpoint_runs(checkpoint_code);
        CREATE INDEX IF NOT EXISTS idx_scr_snapshot_date ON simulator_checkpoint_runs(created_snapshot_date);
    `);

    ensureColumn('snapshots', 'd180_overall_revenue', 'REAL DEFAULT 0');
    ensureColumn('snapshots', 'd180_roas', 'REAL');
}

// --- Snapshots ---

function saveSnapshots(snapshots, batchId) {
    const d = getCiDb();

    // Check if existing snapshot has higher spend (never downgrade from partial API data)
    const checkStmt = d.prepare('SELECT spend FROM snapshots WHERE snapshot_date = @snapshot_date AND ad_id = @ad_id');

    const stmt = d.prepare(`
        INSERT OR REPLACE INTO snapshots (
            snapshot_date, ad_id, ad_name, campaign_name, adset_name, creative_type,
            spend, impressions, clicks, cpm, ctr, cpc, installs, cpi,
            hook_rate, hold_rate, completion_rate,
            signups, p0_signup, p1_signup,
            d0_trial, d0, d0_revenue,
            d6, d6_revenue, d6_overall_revenue,
            d15_overall_revenue, d30_overall_revenue, d60_overall_revenue, d180_overall_revenue,
            overall_revenue,
            signup_cost, d0_trial_cost, d6_cac, d6_roas,
            d15_roas, d30_roas, d60_roas, d180_roas, overall_roas,
            go_live_date, days_live, batch_id
        ) VALUES (
            @snapshot_date, @ad_id, @ad_name, @campaign_name, @adset_name, @creative_type,
            @spend, @impressions, @clicks, @cpm, @ctr, @cpc, @installs, @cpi,
            @hook_rate, @hold_rate, @completion_rate,
            @signups, @p0_signup, @p1_signup,
            @d0_trial, @d0, @d0_revenue,
            @d6, @d6_revenue, @d6_overall_revenue,
            @d15_overall_revenue, @d30_overall_revenue, @d60_overall_revenue, @d180_overall_revenue,
            @overall_revenue,
            @signup_cost, @d0_trial_cost, @d6_cac, @d6_roas,
            @d15_roas, @d30_roas, @d60_roas, @d180_roas, @overall_roas,
            @go_live_date, @days_live, @batch_id
        )
    `);

    const insertMany = d.transaction((rows) => {
        let skipped = 0;
        for (const row of rows) {
            // Guard: never overwrite a snapshot with lower spend (partial API data)
            const existing = checkStmt.get({
                snapshot_date: row.snapshot_date || new Date().toISOString().slice(0, 10),
                ad_id: row.ad_id || '',
            });
            if (existing && existing.spend > 0 && (row.spend || 0) < existing.spend * 0.5) {
                skipped++;
                continue; // skip — new data has significantly less spend, likely truncated API response
            }

            stmt.run({
                snapshot_date: row.snapshot_date || new Date().toISOString().slice(0, 10),
                ad_id: row.ad_id || '',
                ad_name: row.ad_name || '',
                campaign_name: row.campaign_name || null,
                adset_name: row.adset_name || null,
                creative_type: row.creative_type || row.type || null,
                spend: row.spend || 0,
                impressions: row.impressions || 0,
                clicks: row.clicks || 0,
                cpm: row.cpm || null,
                ctr: row.ctr || null,
                cpc: row.cpc || null,
                installs: row.installs || 0,
                cpi: row.cpi || null,
                hook_rate: row.hook_rate || null,
                hold_rate: row.hold_rate || null,
                completion_rate: row.completion_rate || null,
                signups: row.signups || 0,
                p0_signup: row.p0_signup || 0,
                p1_signup: row.p1_signup || 0,
                d0_trial: row.d0_trial || 0,
                d0: row.d0 || 0,
                d0_revenue: row.d0_revenue || 0,
                d6: row.d6 || 0,
                d6_revenue: row.d6_revenue || 0,
                d6_overall_revenue: row.d6_overall_revenue || 0,
                d15_overall_revenue: row.d15_overall_revenue || 0,
                d30_overall_revenue: row.d30_overall_revenue || 0,
                d60_overall_revenue: row.d60_overall_revenue || 0,
                d180_overall_revenue: row.d180_overall_revenue || 0,
                overall_revenue: row.overall_revenue || 0,
                signup_cost: row.signup_cost || null,
                d0_trial_cost: row.d0_trial_cost || null,
                d6_cac: row.d6_cac || null,
                d6_roas: row.d6_roas || null,
                d15_roas: row.d15_roas || null,
                d30_roas: row.d30_roas || null,
                d60_roas: row.d60_roas || null,
                d180_roas: row.d180_roas || null,
                overall_roas: row.overall_roas || null,
                go_live_date: row.go_live_date || null,
                days_live: row.days_live || 0,
                batch_id: batchId,
            });
        }
        return skipped;
    });

    const skipped = insertMany(snapshots);
    if (skipped > 0) console.log(`[snapshots] Skipped ${skipped} rows with lower spend (partial API data protection)`);
    return { inserted: snapshots.length - skipped, skipped };
}

function getLatestSnapshots() {
    const d = getCiDb();
    const latestDate = d.prepare(`SELECT MAX(snapshot_date) as d FROM snapshots`).get();
    if (!latestDate || !latestDate.d) return [];
    return d.prepare(`SELECT * FROM snapshots WHERE snapshot_date = ? AND (is_ghost != 1 OR is_ghost IS NULL)`).all(latestDate.d);
}

function getSnapshotHistory(adId, days = 30) {
    const d = getCiDb();
    return d.prepare(`
        SELECT * FROM snapshots
        WHERE ad_id = ? AND snapshot_date >= date('now', '-' || ? || ' days')
        ORDER BY snapshot_date ASC
    `).all(adId, days);
}

// --- Trends ---

function saveTrends(trendRows) {
    const d = getCiDb();
    const stmt = d.prepare(`
        INSERT OR REPLACE INTO trends (ad_id, ad_name, metric_name, period, value_current, value_previous, pct_change, direction)
        VALUES (@ad_id, @ad_name, @metric_name, @period, @value_current, @value_previous, @pct_change, @direction)
    `);

    const insertMany = d.transaction((rows) => {
        for (const row of rows) {
            stmt.run({
                ad_id: row.ad_id,
                ad_name: row.ad_name,
                metric_name: row.metric_name,
                period: row.period,
                value_current: row.value_current,
                value_previous: row.value_previous,
                pct_change: row.pct_change,
                direction: row.direction,
            });
        }
    });

    insertMany(trendRows);
    return { inserted: trendRows.length };
}

function getTrends(adId) {
    const d = getCiDb();
    if (adId) {
        return d.prepare(`SELECT * FROM trends WHERE ad_id = ? ORDER BY metric_name, period`).all(adId);
    }
    return d.prepare(`SELECT * FROM trends ORDER BY ad_id, metric_name, period`).all();
}

// --- Actions ---

function saveActions(actionRows) {
    const d = getCiDb();
    // Deactivate old actions first
    d.prepare(`UPDATE actions SET is_active = 0`).run();

    const stmt = d.prepare(`
        INSERT INTO actions (ad_id, ad_name, campaign_name, adset_name, action_type, confidence, reasons, metrics_snapshot, priority, is_active)
        VALUES (@ad_id, @ad_name, @campaign_name, @adset_name, @action_type, @confidence, @reasons, @metrics_snapshot, @priority, 1)
    `);

    const insertMany = d.transaction((rows) => {
        for (const row of rows) {
            stmt.run({
                ad_id: row.ad_id,
                ad_name: row.ad_name,
                campaign_name: row.campaign_name || null,
                adset_name: row.adset_name || null,
                action_type: row.action_type,
                confidence: row.confidence || 'medium',
                reasons: JSON.stringify(row.reasons || []),
                metrics_snapshot: JSON.stringify(row.metrics_snapshot || {}),
                priority: row.priority || 0,
            });
        }
    });

    insertMany(actionRows);
    return { inserted: actionRows.length };
}

function getActiveActions() {
    const d = getCiDb();
    return d.prepare(`SELECT * FROM actions WHERE is_active = 1 AND (is_ghost != 1 OR is_ghost IS NULL) ORDER BY priority DESC, created_at DESC`).all();
}

function acknowledgeAction(actionId) {
    const d = getCiDb();
    return d.prepare(`UPDATE actions SET acknowledged = 1 WHERE id = ?`).run(actionId);
}

// --- Analyses ---

function saveAnalysis(analysisType, dateFrom, dateTo, creativesAnalyzed, result, modelUsed) {
    const d = getCiDb();
    return d.prepare(`
        INSERT INTO analyses (analysis_type, date_from, date_to, creatives_analyzed, result, model_used)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(analysisType, dateFrom, dateTo, creativesAnalyzed, typeof result === 'string' ? result : JSON.stringify(result), modelUsed || 'gpt-5.4');
}

function getLatestAnalysis(analysisType) {
    const d = getCiDb();
    if (analysisType) {
        return d.prepare(`SELECT * FROM analyses WHERE analysis_type = ? ORDER BY analyzed_at DESC LIMIT 1`).get(analysisType);
    }
    return d.prepare(`SELECT * FROM analyses ORDER BY analyzed_at DESC LIMIT 1`).get();
}

// --- Pipeline Runs ---

function logPipelineRun(runType, details) {
    const d = getCiDb();
    const result = d.prepare(`
        INSERT INTO pipeline_runs (run_type, status, details)
        VALUES (?, 'running', ?)
    `).run(runType, details || null);
    return result.lastInsertRowid;
}

function updatePipelineRun(runId, status, details, error) {
    const d = getCiDb();
    return d.prepare(`
        UPDATE pipeline_runs SET status = ?, completed_at = datetime('now'), details = ?, error = ?
        WHERE id = ?
    `).run(status, details || null, error || null, runId);
}

function getLastPipelineRun(runType) {
    const d = getCiDb();
    if (runType) {
        return d.prepare(`SELECT * FROM pipeline_runs WHERE run_type = ? ORDER BY started_at DESC LIMIT 1`).get(runType);
    }
    return d.prepare(`SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 1`).get();
}

// --- Cohort Benchmarks ---

function saveCohortBenchmarks(benchmarks) {
    const d = getCiDb();
    const stmt = d.prepare(`
        INSERT OR REPLACE INTO cohort_benchmarks (
            cohort_key, creative_type, campaign_pattern, sample_size,
            median_d6_roas, p25_d6_roas, p75_d6_roas,
            median_overall_roas, p25_overall_roas, p75_overall_roas,
            benchmark_hook_rate, benchmark_cpi, benchmark_ctr, benchmark_hold_rate,
            d6_to_overall_multiplier, computed_at
        ) VALUES (
            @cohort_key, @creative_type, @campaign_pattern, @sample_size,
            @median_d6_roas, @p25_d6_roas, @p75_d6_roas,
            @median_overall_roas, @p25_overall_roas, @p75_overall_roas,
            @benchmark_hook_rate, @benchmark_cpi, @benchmark_ctr, @benchmark_hold_rate,
            @d6_to_overall_multiplier, datetime('now')
        )
    `);

    const insertMany = d.transaction((rows) => {
        for (const row of rows) {
            stmt.run({
                cohort_key: row.cohort_key,
                creative_type: row.creative_type || null,
                campaign_pattern: row.campaign_pattern || null,
                sample_size: row.sample_size || 0,
                median_d6_roas: row.median_d6_roas || null,
                p25_d6_roas: row.p25_d6_roas || null,
                p75_d6_roas: row.p75_d6_roas || null,
                median_overall_roas: row.median_overall_roas || null,
                p25_overall_roas: row.p25_overall_roas || null,
                p75_overall_roas: row.p75_overall_roas || null,
                benchmark_hook_rate: row.benchmark_hook_rate || null,
                benchmark_cpi: row.benchmark_cpi || null,
                benchmark_ctr: row.benchmark_ctr || null,
                benchmark_hold_rate: row.benchmark_hold_rate || null,
                d6_to_overall_multiplier: row.d6_to_overall_multiplier || null,
            });
        }
    });

    insertMany(benchmarks);
    return { inserted: benchmarks.length };
}

function getCohortBenchmarks(cohortKey) {
    const d = getCiDb();
    if (cohortKey) {
        return d.prepare(`SELECT * FROM cohort_benchmarks WHERE cohort_key = ?`).get(cohortKey);
    }
    return null;
}

function getAllCohortBenchmarks() {
    const d = getCiDb();
    return d.prepare(`SELECT * FROM cohort_benchmarks ORDER BY sample_size DESC`).all();
}

// --- Predictions ---

function savePrediction(prediction) {
    const d = getCiDb();
    const result = d.prepare(`
        INSERT INTO predictions (
            ad_id, ad_name, campaign_name, adset_name, creative_type,
            days_live_at_prediction,
            early_spend, early_cpi, early_ctr, early_hook_rate, early_hold_rate,
            early_installs, early_signups, early_d6_roas, early_overall_roas,
            cohort_key, cohort_sample_size,
            predicted_d6_roas, predicted_d6_low, predicted_d6_high,
            predicted_d15_roas, predicted_d15_low, predicted_d15_high,
            predicted_d30_roas, predicted_d30_low, predicted_d30_high,
            predicted_d60_roas, predicted_d60_low, predicted_d60_high,
            predicted_d180_roas, predicted_d180_low, predicted_d180_high,
            prediction_method, confidence_score, gpt_qualitative,
            trajectory, recommended_action, reasoning,
            batch_id, is_latest
        ) VALUES (
            @ad_id, @ad_name, @campaign_name, @adset_name, @creative_type,
            @days_live_at_prediction,
            @early_spend, @early_cpi, @early_ctr, @early_hook_rate, @early_hold_rate,
            @early_installs, @early_signups, @early_d6_roas, @early_overall_roas,
            @cohort_key, @cohort_sample_size,
            @predicted_d6_roas, @predicted_d6_low, @predicted_d6_high,
            @predicted_d15_roas, @predicted_d15_low, @predicted_d15_high,
            @predicted_d30_roas, @predicted_d30_low, @predicted_d30_high,
            @predicted_d60_roas, @predicted_d60_low, @predicted_d60_high,
            @predicted_d180_roas, @predicted_d180_low, @predicted_d180_high,
            @prediction_method, @confidence_score, @gpt_qualitative,
            @trajectory, @recommended_action, @reasoning,
            @batch_id, 1
        )
    `).run({
        ad_id: prediction.ad_id,
        ad_name: prediction.ad_name,
        campaign_name: prediction.campaign_name || null,
        adset_name: prediction.adset_name || null,
        creative_type: prediction.creative_type || null,
        days_live_at_prediction: prediction.days_live_at_prediction || 0,
        early_spend: prediction.early_spend || null,
        early_cpi: prediction.early_cpi || null,
        early_ctr: prediction.early_ctr || null,
        early_hook_rate: prediction.early_hook_rate || null,
        early_hold_rate: prediction.early_hold_rate || null,
        early_installs: prediction.early_installs || null,
        early_signups: prediction.early_signups || null,
        early_d6_roas: prediction.early_d6_roas || null,
        early_overall_roas: prediction.early_overall_roas || null,
        cohort_key: prediction.cohort_key || null,
        cohort_sample_size: prediction.cohort_sample_size || null,
        predicted_d6_roas: prediction.predicted_d6_roas || null,
        predicted_d6_low: prediction.predicted_d6_low || null,
        predicted_d6_high: prediction.predicted_d6_high || null,
        predicted_d15_roas: prediction.predicted_d15_roas || null,
        predicted_d15_low: prediction.predicted_d15_low || null,
        predicted_d15_high: prediction.predicted_d15_high || null,
        predicted_d30_roas: prediction.predicted_d30_roas || null,
        predicted_d30_low: prediction.predicted_d30_low || null,
        predicted_d30_high: prediction.predicted_d30_high || null,
        predicted_d60_roas: prediction.predicted_d60_roas || null,
        predicted_d60_low: prediction.predicted_d60_low || null,
        predicted_d60_high: prediction.predicted_d60_high || null,
        predicted_d180_roas: prediction.predicted_d180_roas || null,
        predicted_d180_low: prediction.predicted_d180_low || null,
        predicted_d180_high: prediction.predicted_d180_high || null,
        prediction_method: prediction.prediction_method || null,
        confidence_score: prediction.confidence_score || null,
        gpt_qualitative: prediction.gpt_qualitative || null,
        trajectory: prediction.trajectory || null,
        recommended_action: prediction.recommended_action || null,
        reasoning: prediction.reasoning || null,
        batch_id: prediction.batch_id || null,
    });
    return result.lastInsertRowid;
}

function markOldPredictions(adId) {
    const d = getCiDb();
    return d.prepare(`UPDATE predictions SET is_latest = 0 WHERE ad_id = ? AND is_latest = 1`).run(adId);
}

function getLatestPredictions() {
    const d = getCiDb();
    return d.prepare(`SELECT * FROM predictions WHERE is_latest = 1 ORDER BY predicted_at DESC`).all();
}

function getPrediction(adId) {
    const d = getCiDb();
    return d.prepare(`SELECT * FROM predictions WHERE ad_id = ? AND is_latest = 1 ORDER BY predicted_at DESC LIMIT 1`).get(adId);
}

function getUnverifiedPredictions() {
    const d = getCiDb();
    return d.prepare(`SELECT * FROM predictions WHERE is_latest = 1 AND actual_d6_roas IS NULL`).all();
}

function updatePredictionActuals(id, actuals) {
    const d = getCiDb();
    const setClauses = [];
    const params = { id };

    if (actuals.actual_d6_roas !== undefined) {
        setClauses.push('actual_d6_roas = @actual_d6_roas');
        params.actual_d6_roas = actuals.actual_d6_roas;
    }
    if (actuals.actual_d30_roas !== undefined) {
        setClauses.push('actual_d30_roas = @actual_d30_roas');
        params.actual_d30_roas = actuals.actual_d30_roas;
    }
    if (actuals.actual_d60_roas !== undefined) {
        setClauses.push('actual_d60_roas = @actual_d60_roas');
        params.actual_d60_roas = actuals.actual_d60_roas;
    }
    if (actuals.actual_d180_roas !== undefined) {
        setClauses.push('actual_d180_roas = @actual_d180_roas');
        params.actual_d180_roas = actuals.actual_d180_roas;
    }
    if (actuals.d6_accuracy_pct !== undefined) {
        setClauses.push('d6_accuracy_pct = @d6_accuracy_pct');
        params.d6_accuracy_pct = actuals.d6_accuracy_pct;
    }
    if (actuals.d30_accuracy_pct !== undefined) {
        setClauses.push('d30_accuracy_pct = @d30_accuracy_pct');
        params.d30_accuracy_pct = actuals.d30_accuracy_pct;
    }

    if (!setClauses.length) return;

    return d.prepare(`UPDATE predictions SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
}

// --- ROAS Tracker ---

function upsertRoasTracker(ad) {
    const d = getCiDb();
    // Check if already exists
    const existing = d.prepare('SELECT id, prediction_id, latest_spend FROM roas_tracker WHERE ad_id = ?').get(ad.ad_id);
    if (existing) {
        // Guard: never downgrade spend from partial API data
        const newSpend = ad.spend || 0;
        if (existing.latest_spend > 0 && newSpend < existing.latest_spend * 0.5) {
            // New data has significantly less spend — likely truncated API response, skip update
            return { id: existing.id, isNew: false, needsPrediction: !existing.prediction_id, skippedDowngrade: true };
        }

        // Update latest actuals only — never overwrite prediction
        d.prepare(`
            UPDATE roas_tracker SET
                latest_spend = @latest_spend, latest_installs = @latest_installs,
                latest_signups = @latest_signups, latest_d6 = @latest_d6,
                latest_cpi = @latest_cpi, latest_d6_roas = @latest_d6_roas,
                latest_overall_roas = @latest_overall_roas,
                latest_d6_overall_revenue = @latest_d6_overall_revenue,
                latest_overall_revenue = @latest_overall_revenue,
                latest_days_live = @latest_days_live,
                latest_snapshot_date = @latest_snapshot_date,
                is_low_spend = @is_low_spend,
                is_active = @is_active,
                updated_at = datetime('now')
            WHERE ad_id = @ad_id
        `).run({
            ad_id: ad.ad_id,
            latest_spend: ad.spend || 0,
            latest_installs: ad.installs || 0,
            latest_signups: ad.signups || 0,
            latest_d6: ad.d6 || 0,
            latest_cpi: ad.cpi || null,
            latest_d6_roas: ad.d6_roas || null,
            latest_overall_roas: ad.overall_roas || null,
            latest_d6_overall_revenue: ad.d6_overall_revenue || 0,
            latest_overall_revenue: ad.overall_revenue || 0,
            latest_days_live: ad.days_live || 0,
            latest_snapshot_date: ad.snapshot_date || new Date().toISOString().slice(0, 10),
            is_low_spend: (ad.spend || 0) < 15000 ? 1 : 0,
            is_active: ad.is_active !== undefined ? ad.is_active : 1,
        });
        return { id: existing.id, isNew: false, needsPrediction: !existing.prediction_id };
    }

    // Insert new
    const result = d.prepare(`
        INSERT INTO roas_tracker (
            ad_id, ad_name, campaign_name, adset_name, creative_type, go_live_date,
            latest_spend, latest_installs, latest_signups, latest_d6,
            latest_cpi, latest_d6_roas, latest_overall_roas,
            latest_d6_overall_revenue, latest_overall_revenue,
            latest_days_live, latest_snapshot_date, is_low_spend, is_active
        ) VALUES (
            @ad_id, @ad_name, @campaign_name, @adset_name, @creative_type, @go_live_date,
            @latest_spend, @latest_installs, @latest_signups, @latest_d6,
            @latest_cpi, @latest_d6_roas, @latest_overall_roas,
            @latest_d6_overall_revenue, @latest_overall_revenue,
            @latest_days_live, @latest_snapshot_date, @is_low_spend, @is_active
        )
    `).run({
        ad_id: ad.ad_id,
        ad_name: ad.ad_name || '',
        campaign_name: ad.campaign_name || null,
        adset_name: ad.adset_name || null,
        creative_type: ad.creative_type || null,
        go_live_date: ad.go_live_date || null,
        latest_spend: ad.spend || 0,
        latest_installs: ad.installs || 0,
        latest_signups: ad.signups || 0,
        latest_d6: ad.d6 || 0,
        latest_cpi: ad.cpi || null,
        latest_d6_roas: ad.d6_roas || null,
        latest_overall_roas: ad.overall_roas || null,
        latest_d6_overall_revenue: ad.d6_overall_revenue || 0,
        latest_overall_revenue: ad.overall_revenue || 0,
        latest_days_live: ad.days_live || 0,
        latest_snapshot_date: ad.snapshot_date || new Date().toISOString().slice(0, 10),
        is_low_spend: (ad.spend || 0) < 15000 ? 1 : 0,
        is_active: 1,
    });
    return { id: result.lastInsertRowid, isNew: true, needsPrediction: true };
}

function updateRoasTrackerPrediction(adId, prediction) {
    const d = getCiDb();
    d.prepare(`
        UPDATE roas_tracker SET
            prediction_id = @prediction_id,
            predicted_d6_roas = @predicted_d6_roas,
            predicted_d6_low = @predicted_d6_low,
            predicted_d6_high = @predicted_d6_high,
            predicted_d30_roas = @predicted_d30_roas,
            predicted_d60_roas = @predicted_d60_roas,
            predicted_d90_roas = @predicted_d90_roas,
            prediction_confidence = @prediction_confidence,
            prediction_trajectory = @prediction_trajectory,
            predicted_action = @predicted_action,
            predicted_at = datetime('now')
        WHERE ad_id = @ad_id
    `).run({
        ad_id: adId,
        prediction_id: prediction.id || null,
        predicted_d6_roas: prediction.predicted_d6_roas || null,
        predicted_d6_low: prediction.predicted_d6_low || null,
        predicted_d6_high: prediction.predicted_d6_high || null,
        predicted_d30_roas: prediction.predicted_d30_roas || null,
        predicted_d60_roas: prediction.predicted_d60_roas || null,
        predicted_d90_roas: prediction.predicted_d180_roas || null,
        prediction_confidence: prediction.confidence_score || null,
        prediction_trajectory: prediction.trajectory || null,
        predicted_action: prediction.recommended_action || null,
    });
}

function updateRoasTrackerAccuracy(adId, d6Acc, d30Acc) {
    const d = getCiDb();
    const params = { ad_id: adId };
    const sets = [];
    if (d6Acc !== undefined) { sets.push('d6_accuracy_pct = @d6'); params.d6 = d6Acc; }
    if (d30Acc !== undefined) { sets.push('d30_accuracy_pct = @d30'); params.d30 = d30Acc; }
    if (!sets.length) return;
    d.prepare(`UPDATE roas_tracker SET ${sets.join(', ')} WHERE ad_id = @ad_id`).run(params);
}

function getRoasTrackerAds() {
    const d = getCiDb();
    return d.prepare(`
        SELECT rt.*,
            p.predicted_d15_roas, p.predicted_d15_low, p.predicted_d15_high,
            p.predicted_d30_roas AS pred_d30_roas, p.predicted_d30_low AS pred_d30_low, p.predicted_d30_high AS pred_d30_high,
            p.predicted_d60_roas AS pred_d60_roas, p.predicted_d60_low AS pred_d60_low, p.predicted_d60_high AS pred_d60_high,
            p.predicted_d180_roas AS pred_d180_roas, p.predicted_d180_low AS pred_d180_low, p.predicted_d180_high AS pred_d180_high,
            p.prediction_method, p.early_spend, p.early_cpi, p.early_ctr,
            p.early_hook_rate, p.early_hold_rate, p.early_installs, p.early_signups,
            p.early_d6_roas, p.early_overall_roas,
            p.cohort_key, p.cohort_sample_size,
            p.gpt_qualitative, p.reasoning AS prediction_reasoning
        FROM roas_tracker rt
        LEFT JOIN predictions p ON p.id = rt.prediction_id
        WHERE (rt.is_ghost != 1 OR rt.is_ghost IS NULL)
        ORDER BY rt.is_low_spend DESC, rt.latest_spend ASC
    `).all();
}

function getRoasTrackerTrendline(adId) {
    const d = getCiDb();
    const tracker = d.prepare(`
        SELECT rt.*,
            p.predicted_d15_roas, p.predicted_d15_low, p.predicted_d15_high,
            p.predicted_d30_roas, p.predicted_d30_low, p.predicted_d30_high,
            p.predicted_d60_roas, p.predicted_d60_low, p.predicted_d60_high,
            p.predicted_d180_roas, p.predicted_d180_low, p.predicted_d180_high,
            p.prediction_method, p.early_spend, p.early_cpi, p.early_ctr,
            p.early_hook_rate, p.early_hold_rate, p.early_installs, p.early_signups,
            p.early_d6_roas, p.early_overall_roas,
            p.cohort_key, p.cohort_sample_size,
            p.gpt_qualitative, p.reasoning AS prediction_reasoning
        FROM roas_tracker rt
        LEFT JOIN predictions p ON p.id = rt.prediction_id
        WHERE rt.ad_id = ?
    `).get(adId);
    if (!tracker) return null;

    const snapshots = d.prepare(`
        SELECT snapshot_date, spend, installs, signups, d6,
               cpi, d6_roas, d15_roas, d30_roas, d60_roas, d180_roas, overall_roas,
               d6_overall_revenue, d15_overall_revenue, d30_overall_revenue, d60_overall_revenue, d180_overall_revenue,
               overall_revenue, days_live
        FROM snapshots
        WHERE ad_id = ?
        ORDER BY snapshot_date ASC
    `).all(adId);

    return { tracker, snapshots };
}

function getRoasTrackerStats() {
    const d = getCiDb();
    const ghostFilter = 'AND (is_ghost != 1 OR is_ghost IS NULL)';
    return {
        total_tracked: d.prepare(`SELECT COUNT(*) as c FROM roas_tracker WHERE 1=1 ${ghostFilter}`).get().c,
        low_spend: d.prepare(`SELECT COUNT(*) as c FROM roas_tracker WHERE is_low_spend = 1 ${ghostFilter}`).get().c,
        predicted: d.prepare(`SELECT COUNT(*) as c FROM roas_tracker WHERE prediction_id IS NOT NULL ${ghostFilter}`).get().c,
        active: d.prepare(`SELECT COUNT(*) as c FROM roas_tracker WHERE is_active = 1 ${ghostFilter}`).get().c,
        avg_accuracy: d.prepare(`SELECT AVG(d6_accuracy_pct) as a FROM roas_tracker WHERE d6_accuracy_pct IS NOT NULL ${ghostFilter}`).get().a,
        verified: d.prepare(`SELECT COUNT(*) as c FROM roas_tracker WHERE d6_accuracy_pct IS NOT NULL ${ghostFilter}`).get().c,
        ghosts: d.prepare('SELECT COUNT(*) as c FROM roas_tracker WHERE is_ghost = 1').get().c,
    };
}

function getUnpredictedTrackerAds() {
    const d = getCiDb();
    return d.prepare(`
        SELECT * FROM roas_tracker
        WHERE prediction_id IS NULL AND latest_spend > 0
          AND (is_ghost != 1 OR is_ghost IS NULL)
    `).all();
}

module.exports = {
    getCiDb,
    saveSnapshots,
    getLatestSnapshots,
    getSnapshotHistory,
    saveTrends,
    getTrends,
    saveActions,
    getActiveActions,
    acknowledgeAction,
    saveAnalysis,
    getLatestAnalysis,
    logPipelineRun,
    updatePipelineRun,
    getLastPipelineRun,
    saveCohortBenchmarks,
    getCohortBenchmarks,
    getAllCohortBenchmarks,
    savePrediction,
    markOldPredictions,
    getLatestPredictions,
    getPrediction,
    getUnverifiedPredictions,
    updatePredictionActuals,
    // ROAS Tracker
    upsertRoasTracker,
    updateRoasTrackerPrediction,
    updateRoasTrackerAccuracy,
    getRoasTrackerAds,
    getRoasTrackerTrendline,
    getRoasTrackerStats,
    getUnpredictedTrackerAds,
};
