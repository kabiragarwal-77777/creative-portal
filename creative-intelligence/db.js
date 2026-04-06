const { createDb } = require('../lib/duckdb-adapter');
const path = require('path');

const DB_PATH = path.join(__dirname, 'ci.db');
let db;
let initPromise;

async function getCiDb() {
    if (db) return db;
    if (!initPromise) {
        initPromise = (async () => {
            db = await createDb(DB_PATH);
            await initSchema();
            return db;
        })();
    }
    return initPromise;
}

async function ensureColumn(tableName, columnName, definition) {
    try {
        const cols = await db.prepare(
            `SELECT column_name FROM information_schema.columns WHERE table_name = ?`
        ).all(tableName.toLowerCase());
        if (!cols.some(col => col.column_name === columnName)) {
            await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
        }
    } catch (e) {
        // If table doesn't exist yet or column already exists, ignore
        if (!e.message.includes('already exists')) {
            console.warn(`[CI] ensureColumn warning: ${e.message}`);
        }
    }
}

async function initSchema() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS simulations (
            id INTEGER PRIMARY KEY,
            ad_id TEXT,
            ad_name TEXT NOT NULL,
            campaign_name TEXT,
            adset_name TEXT,
            creative_type TEXT,
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
            trajectory TEXT,
            action TEXT,
            reasoning TEXT,
            budget_suggestion TEXT,
            risk_factors TEXT,
            similar_creatives TEXT,
            raw_response TEXT,
            simulated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            batch_id TEXT,
            is_live INTEGER DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_sim_ad_name ON simulations(ad_name);
        CREATE INDEX IF NOT EXISTS idx_sim_ad_id ON simulations(ad_id);
        CREATE INDEX IF NOT EXISTS idx_sim_batch ON simulations(batch_id);
        CREATE INDEX IF NOT EXISTS idx_sim_date ON simulations(simulated_at);
        CREATE INDEX IF NOT EXISTS idx_sim_live ON simulations(is_live);

        CREATE TABLE IF NOT EXISTS simulation_actuals (
            id INTEGER PRIMARY KEY,
            simulation_id INTEGER NOT NULL,
            ad_name TEXT NOT NULL,
            actual_d6_roas REAL,
            actual_d30_roas REAL,
            actual_d60_roas REAL,
            actual_overall_roas REAL,
            actual_spend REAL,
            actual_revenue REAL,
            recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (simulation_id) REFERENCES simulations(id)
        );

        CREATE INDEX IF NOT EXISTS idx_actuals_sim ON simulation_actuals(simulation_id);
        CREATE INDEX IF NOT EXISTS idx_actuals_ad ON simulation_actuals(ad_name);

        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY,
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
            collected_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(snapshot_date, ad_id)
        );

        CREATE INDEX IF NOT EXISTS idx_snap_date ON snapshots(snapshot_date);
        CREATE INDEX IF NOT EXISTS idx_snap_ad_id ON snapshots(ad_id);
        CREATE INDEX IF NOT EXISTS idx_snap_ad_name ON snapshots(ad_name);
        CREATE INDEX IF NOT EXISTS idx_snap_batch ON snapshots(batch_id);
        CREATE INDEX IF NOT EXISTS idx_snap_campaign ON snapshots(campaign_name);

        CREATE TABLE IF NOT EXISTS trends (
            id INTEGER PRIMARY KEY,
            ad_id TEXT NOT NULL, ad_name TEXT NOT NULL,
            metric_name TEXT NOT NULL, period TEXT NOT NULL,
            value_current REAL, value_previous REAL, pct_change REAL,
            direction TEXT,
            computed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(ad_id, metric_name, period)
        );

        CREATE INDEX IF NOT EXISTS idx_trends_ad ON trends(ad_id);
        CREATE INDEX IF NOT EXISTS idx_trends_metric ON trends(metric_name);
        CREATE INDEX IF NOT EXISTS idx_trends_period ON trends(period);

        CREATE TABLE IF NOT EXISTS actions (
            id INTEGER PRIMARY KEY,
            ad_id TEXT NOT NULL, ad_name TEXT NOT NULL,
            campaign_name TEXT, adset_name TEXT,
            action_type TEXT NOT NULL,
            confidence TEXT DEFAULT 'medium',
            reasons TEXT, metrics_snapshot TEXT,
            priority INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            acknowledged INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_actions_ad ON actions(ad_id);
        CREATE INDEX IF NOT EXISTS idx_actions_type ON actions(action_type);
        CREATE INDEX IF NOT EXISTS idx_actions_active ON actions(is_active);
        CREATE INDEX IF NOT EXISTS idx_actions_priority ON actions(priority);

        CREATE TABLE IF NOT EXISTS analyses (
            id INTEGER PRIMARY KEY,
            analysis_type TEXT NOT NULL,
            date_from TEXT, date_to TEXT,
            creatives_analyzed INTEGER DEFAULT 0,
            result TEXT,
            model_used TEXT DEFAULT 'gpt-5.4',
            analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_analyses_type ON analyses(analysis_type);
        CREATE INDEX IF NOT EXISTS idx_analyses_date ON analyses(analyzed_at);

        CREATE TABLE IF NOT EXISTS pipeline_runs (
            id INTEGER PRIMARY KEY,
            run_type TEXT NOT NULL,
            status TEXT DEFAULT 'running',
            started_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT,
            details TEXT, error TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_pipeline_type ON pipeline_runs(run_type);
        CREATE INDEX IF NOT EXISTS idx_pipeline_status ON pipeline_runs(status);

        CREATE TABLE IF NOT EXISTS cohort_benchmarks (
            id INTEGER PRIMARY KEY,
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
            computed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(cohort_key)
        );

        CREATE INDEX IF NOT EXISTS idx_cohort_key ON cohort_benchmarks(cohort_key);

        CREATE TABLE IF NOT EXISTS predictions (
            id INTEGER PRIMARY KEY,
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
            predicted_at TEXT DEFAULT CURRENT_TIMESTAMP,
            batch_id TEXT,
            is_latest INTEGER DEFAULT 1
        );

        CREATE INDEX IF NOT EXISTS idx_pred_ad ON predictions(ad_id);
        CREATE INDEX IF NOT EXISTS idx_pred_latest ON predictions(is_latest);
        CREATE INDEX IF NOT EXISTS idx_pred_date ON predictions(predicted_at);

        CREATE TABLE IF NOT EXISTS roas_tracker (
            id INTEGER PRIMARY KEY,
            ad_id TEXT NOT NULL UNIQUE,
            ad_name TEXT NOT NULL,
            campaign_name TEXT,
            adset_name TEXT,
            creative_type TEXT,
            go_live_date TEXT,
            first_detected_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
            d6_accuracy_pct REAL,
            d30_accuracy_pct REAL,
            is_low_spend INTEGER DEFAULT 1,
            is_active INTEGER DEFAULT 1,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (prediction_id) REFERENCES predictions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_rt_ad ON roas_tracker(ad_id);
        CREATE INDEX IF NOT EXISTS idx_rt_low_spend ON roas_tracker(is_low_spend);
        CREATE INDEX IF NOT EXISTS idx_rt_active ON roas_tracker(is_active);
        CREATE INDEX IF NOT EXISTS idx_rt_go_live ON roas_tracker(go_live_date);

        CREATE TABLE IF NOT EXISTS simulator_checkpoint_runs (
            id INTEGER PRIMARY KEY,
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
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(ad_id, checkpoint_code)
        );

        CREATE INDEX IF NOT EXISTS idx_scr_ad ON simulator_checkpoint_runs(ad_id);
        CREATE INDEX IF NOT EXISTS idx_scr_checkpoint ON simulator_checkpoint_runs(checkpoint_code);
        CREATE INDEX IF NOT EXISTS idx_scr_snapshot_date ON simulator_checkpoint_runs(created_snapshot_date);
    `);

    await ensureColumn('snapshots', 'd180_overall_revenue', 'REAL DEFAULT 0');
    await ensureColumn('snapshots', 'd180_roas', 'REAL');
}

// --- Snapshots ---

async function saveSnapshots(snapshots, batchId) {
    const d = await getCiDb();

    let skipped = 0;
    for (const row of snapshots) {
        const snapshotDate = row.snapshot_date || new Date().toISOString().slice(0, 10);
        const adId = row.ad_id || '';

        // Guard: never overwrite a snapshot with lower spend (partial API data)
        const existing = await d.prepare('SELECT spend FROM snapshots WHERE snapshot_date = ? AND ad_id = ?').get(snapshotDate, adId);
        if (existing && existing.spend > 0 && (row.spend || 0) < existing.spend * 0.5) {
            skipped++;
            continue;
        }

        await d.prepare(`
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
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?,
                ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?
            )
        `).run(
            snapshotDate, adId, row.ad_name || '', row.campaign_name || null, row.adset_name || null, row.creative_type || row.type || null,
            row.spend || 0, row.impressions || 0, row.clicks || 0, row.cpm || null, row.ctr || null, row.cpc || null, row.installs || 0, row.cpi || null,
            row.hook_rate || null, row.hold_rate || null, row.completion_rate || null,
            row.signups || 0, row.p0_signup || 0, row.p1_signup || 0,
            row.d0_trial || 0, row.d0 || 0, row.d0_revenue || 0,
            row.d6 || 0, row.d6_revenue || 0, row.d6_overall_revenue || 0,
            row.d15_overall_revenue || 0, row.d30_overall_revenue || 0, row.d60_overall_revenue || 0, row.d180_overall_revenue || 0,
            row.overall_revenue || 0,
            row.signup_cost || null, row.d0_trial_cost || null, row.d6_cac || null, row.d6_roas || null,
            row.d15_roas || null, row.d30_roas || null, row.d60_roas || null, row.d180_roas || null, row.overall_roas || null,
            row.go_live_date || null, row.days_live || 0, batchId
        );
    }

    if (skipped > 0) console.log(`[snapshots] Skipped ${skipped} rows with lower spend (partial API data protection)`);
    return { inserted: snapshots.length - skipped, skipped };
}

async function getLatestSnapshots() {
    const d = await getCiDb();
    const latestDate = await d.prepare(`SELECT MAX(snapshot_date) as d FROM snapshots`).get();
    if (!latestDate || !latestDate.d) return [];
    return d.prepare(`SELECT * FROM snapshots WHERE snapshot_date = ? AND (is_ghost != 1 OR is_ghost IS NULL)`).all(latestDate.d);
}

async function getSnapshotHistory(adId, days = 30) {
    const d = await getCiDb();
    return d.prepare(`
        SELECT * FROM snapshots
        WHERE ad_id = ? AND snapshot_date >= CURRENT_DATE - INTERVAL '${days} days'
        ORDER BY snapshot_date ASC
    `).all(adId);
}

// --- Trends ---

async function saveTrends(trendRows) {
    const d = await getCiDb();

    for (const row of trendRows) {
        await d.prepare(`
            INSERT OR REPLACE INTO trends (ad_id, ad_name, metric_name, period, value_current, value_previous, pct_change, direction)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            row.ad_id, row.ad_name, row.metric_name, row.period,
            row.value_current, row.value_previous, row.pct_change, row.direction
        );
    }

    return { inserted: trendRows.length };
}

async function getTrends(adId) {
    const d = await getCiDb();
    if (adId) {
        return d.prepare(`SELECT * FROM trends WHERE ad_id = ? ORDER BY metric_name, period`).all(adId);
    }
    return d.prepare(`SELECT * FROM trends ORDER BY ad_id, metric_name, period`).all();
}

// --- Actions ---

async function saveActions(actionRows) {
    const d = await getCiDb();
    await d.prepare(`UPDATE actions SET is_active = 0`).run();

    for (const row of actionRows) {
        await d.prepare(`
            INSERT INTO actions (ad_id, ad_name, campaign_name, adset_name, action_type, confidence, reasons, metrics_snapshot, priority, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
            row.ad_id, row.ad_name, row.campaign_name || null, row.adset_name || null,
            row.action_type, row.confidence || 'medium',
            JSON.stringify(row.reasons || []), JSON.stringify(row.metrics_snapshot || {}),
            row.priority || 0
        );
    }

    return { inserted: actionRows.length };
}

async function getActiveActions() {
    const d = await getCiDb();
    return d.prepare(`SELECT * FROM actions WHERE is_active = 1 AND (is_ghost != 1 OR is_ghost IS NULL) ORDER BY priority DESC, created_at DESC`).all();
}

async function acknowledgeAction(actionId) {
    const d = await getCiDb();
    return d.prepare(`UPDATE actions SET acknowledged = 1 WHERE id = ?`).run(actionId);
}

// --- Analyses ---

async function saveAnalysis(analysisType, dateFrom, dateTo, creativesAnalyzed, result, modelUsed) {
    const d = await getCiDb();
    return d.prepare(`
        INSERT INTO analyses (analysis_type, date_from, date_to, creatives_analyzed, result, model_used)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(analysisType, dateFrom, dateTo, creativesAnalyzed, typeof result === 'string' ? result : JSON.stringify(result), modelUsed || 'gpt-5.4');
}

async function getLatestAnalysis(analysisType) {
    const d = await getCiDb();
    if (analysisType) {
        return d.prepare(`SELECT * FROM analyses WHERE analysis_type = ? ORDER BY analyzed_at DESC LIMIT 1`).get(analysisType);
    }
    return d.prepare(`SELECT * FROM analyses ORDER BY analyzed_at DESC LIMIT 1`).get();
}

// --- Pipeline Runs ---

async function logPipelineRun(runType, details) {
    const d = await getCiDb();
    const result = await d.prepare(`
        INSERT INTO pipeline_runs (run_type, status, details)
        VALUES (?, 'running', ?)
    `).run(runType, details || null);
    return result.lastInsertRowid;
}

async function updatePipelineRun(runId, status, details, error) {
    const d = await getCiDb();
    return d.prepare(`
        UPDATE pipeline_runs SET status = ?, completed_at = CURRENT_TIMESTAMP, details = ?, error = ?
        WHERE id = ?
    `).run(status, details || null, error || null, runId);
}

async function getLastPipelineRun(runType) {
    const d = await getCiDb();
    if (runType) {
        return d.prepare(`SELECT * FROM pipeline_runs WHERE run_type = ? ORDER BY started_at DESC LIMIT 1`).get(runType);
    }
    return d.prepare(`SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT 1`).get();
}

// --- Cohort Benchmarks ---

async function saveCohortBenchmarks(benchmarks) {
    const d = await getCiDb();

    for (const row of benchmarks) {
        await d.prepare(`
            INSERT OR REPLACE INTO cohort_benchmarks (
                cohort_key, creative_type, campaign_pattern, sample_size,
                median_d6_roas, p25_d6_roas, p75_d6_roas,
                median_overall_roas, p25_overall_roas, p75_overall_roas,
                benchmark_hook_rate, benchmark_cpi, benchmark_ctr, benchmark_hold_rate,
                d6_to_overall_multiplier, computed_at
            ) VALUES (
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?,
                ?, ?, ?, ?,
                ?, CURRENT_TIMESTAMP
            )
        `).run(
            row.cohort_key, row.creative_type || null, row.campaign_pattern || null, row.sample_size || 0,
            row.median_d6_roas || null, row.p25_d6_roas || null, row.p75_d6_roas || null,
            row.median_overall_roas || null, row.p25_overall_roas || null, row.p75_overall_roas || null,
            row.benchmark_hook_rate || null, row.benchmark_cpi || null, row.benchmark_ctr || null, row.benchmark_hold_rate || null,
            row.d6_to_overall_multiplier || null
        );
    }

    return { inserted: benchmarks.length };
}

async function getCohortBenchmarks(cohortKey) {
    const d = await getCiDb();
    if (cohortKey) {
        return d.prepare(`SELECT * FROM cohort_benchmarks WHERE cohort_key = ?`).get(cohortKey);
    }
    return null;
}

async function getAllCohortBenchmarks() {
    const d = await getCiDb();
    return d.prepare(`SELECT * FROM cohort_benchmarks ORDER BY sample_size DESC`).all();
}

// --- Predictions ---

async function savePrediction(prediction) {
    const d = await getCiDb();
    const result = await d.prepare(`
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
            ?, ?, ?, ?, ?,
            ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, 1
        )
    `).run(
        prediction.ad_id, prediction.ad_name, prediction.campaign_name || null, prediction.adset_name || null, prediction.creative_type || null,
        prediction.days_live_at_prediction || 0,
        prediction.early_spend || null, prediction.early_cpi || null, prediction.early_ctr || null, prediction.early_hook_rate || null, prediction.early_hold_rate || null,
        prediction.early_installs || null, prediction.early_signups || null, prediction.early_d6_roas || null, prediction.early_overall_roas || null,
        prediction.cohort_key || null, prediction.cohort_sample_size || null,
        prediction.predicted_d6_roas || null, prediction.predicted_d6_low || null, prediction.predicted_d6_high || null,
        prediction.predicted_d15_roas || null, prediction.predicted_d15_low || null, prediction.predicted_d15_high || null,
        prediction.predicted_d30_roas || null, prediction.predicted_d30_low || null, prediction.predicted_d30_high || null,
        prediction.predicted_d60_roas || null, prediction.predicted_d60_low || null, prediction.predicted_d60_high || null,
        prediction.predicted_d180_roas || null, prediction.predicted_d180_low || null, prediction.predicted_d180_high || null,
        prediction.prediction_method || null, prediction.confidence_score || null, prediction.gpt_qualitative || null,
        prediction.trajectory || null, prediction.recommended_action || null, prediction.reasoning || null,
        prediction.batch_id || null
    );
    return result.lastInsertRowid;
}

async function markOldPredictions(adId) {
    const d = await getCiDb();
    return d.prepare(`UPDATE predictions SET is_latest = 0 WHERE ad_id = ? AND is_latest = 1`).run(adId);
}

async function getLatestPredictions() {
    const d = await getCiDb();
    return d.prepare(`SELECT * FROM predictions WHERE is_latest = 1 ORDER BY predicted_at DESC`).all();
}

async function getPrediction(adId) {
    const d = await getCiDb();
    return d.prepare(`SELECT * FROM predictions WHERE ad_id = ? AND is_latest = 1 ORDER BY predicted_at DESC LIMIT 1`).get(adId);
}

async function getUnverifiedPredictions() {
    const d = await getCiDb();
    return d.prepare(`SELECT * FROM predictions WHERE is_latest = 1 AND actual_d6_roas IS NULL`).all();
}

async function updatePredictionActuals(id, actuals) {
    const d = await getCiDb();
    const setClauses = [];
    const params = [];

    if (actuals.actual_d6_roas !== undefined) { setClauses.push('actual_d6_roas = ?'); params.push(actuals.actual_d6_roas); }
    if (actuals.actual_d30_roas !== undefined) { setClauses.push('actual_d30_roas = ?'); params.push(actuals.actual_d30_roas); }
    if (actuals.actual_d60_roas !== undefined) { setClauses.push('actual_d60_roas = ?'); params.push(actuals.actual_d60_roas); }
    if (actuals.actual_d180_roas !== undefined) { setClauses.push('actual_d180_roas = ?'); params.push(actuals.actual_d180_roas); }
    if (actuals.d6_accuracy_pct !== undefined) { setClauses.push('d6_accuracy_pct = ?'); params.push(actuals.d6_accuracy_pct); }
    if (actuals.d30_accuracy_pct !== undefined) { setClauses.push('d30_accuracy_pct = ?'); params.push(actuals.d30_accuracy_pct); }

    if (!setClauses.length) return;

    params.push(id);
    return d.prepare(`UPDATE predictions SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
}

// --- ROAS Tracker ---

async function upsertRoasTracker(ad) {
    const d = await getCiDb();
    const existing = await d.prepare('SELECT id, prediction_id, latest_spend FROM roas_tracker WHERE ad_id = ?').get(ad.ad_id);

    if (existing) {
        const newSpend = ad.spend || 0;
        if (existing.latest_spend > 0 && newSpend < existing.latest_spend * 0.5) {
            return { id: existing.id, isNew: false, needsPrediction: !existing.prediction_id, skippedDowngrade: true };
        }

        await d.prepare(`
            UPDATE roas_tracker SET
                latest_spend = ?, latest_installs = ?,
                latest_signups = ?, latest_d6 = ?,
                latest_cpi = ?, latest_d6_roas = ?,
                latest_overall_roas = ?,
                latest_d6_overall_revenue = ?,
                latest_overall_revenue = ?,
                latest_days_live = ?,
                latest_snapshot_date = ?,
                is_low_spend = ?,
                is_active = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE ad_id = ?
        `).run(
            ad.spend || 0, ad.installs || 0,
            ad.signups || 0, ad.d6 || 0,
            ad.cpi || null, ad.d6_roas || null,
            ad.overall_roas || null,
            ad.d6_overall_revenue || 0,
            ad.overall_revenue || 0,
            ad.days_live || 0,
            ad.snapshot_date || new Date().toISOString().slice(0, 10),
            (ad.spend || 0) < 15000 ? 1 : 0,
            ad.is_active !== undefined ? ad.is_active : 1,
            ad.ad_id
        );
        return { id: existing.id, isNew: false, needsPrediction: !existing.prediction_id };
    }

    const result = await d.prepare(`
        INSERT INTO roas_tracker (
            ad_id, ad_name, campaign_name, adset_name, creative_type, go_live_date,
            latest_spend, latest_installs, latest_signups, latest_d6,
            latest_cpi, latest_d6_roas, latest_overall_roas,
            latest_d6_overall_revenue, latest_overall_revenue,
            latest_days_live, latest_snapshot_date, is_low_spend, is_active
        ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?,
            ?, ?, ?, ?
        )
    `).run(
        ad.ad_id, ad.ad_name || '', ad.campaign_name || null, ad.adset_name || null, ad.creative_type || null, ad.go_live_date || null,
        ad.spend || 0, ad.installs || 0, ad.signups || 0, ad.d6 || 0,
        ad.cpi || null, ad.d6_roas || null, ad.overall_roas || null,
        ad.d6_overall_revenue || 0, ad.overall_revenue || 0,
        ad.days_live || 0, ad.snapshot_date || new Date().toISOString().slice(0, 10), (ad.spend || 0) < 15000 ? 1 : 0, 1
    );
    return { id: result.lastInsertRowid, isNew: true, needsPrediction: true };
}

async function updateRoasTrackerPrediction(adId, prediction) {
    const d = await getCiDb();
    await d.prepare(`
        UPDATE roas_tracker SET
            prediction_id = ?,
            predicted_d6_roas = ?,
            predicted_d6_low = ?,
            predicted_d6_high = ?,
            predicted_d30_roas = ?,
            predicted_d60_roas = ?,
            predicted_d90_roas = ?,
            prediction_confidence = ?,
            prediction_trajectory = ?,
            predicted_action = ?,
            predicted_at = CURRENT_TIMESTAMP
        WHERE ad_id = ?
    `).run(
        prediction.id || null,
        prediction.predicted_d6_roas || null,
        prediction.predicted_d6_low || null,
        prediction.predicted_d6_high || null,
        prediction.predicted_d30_roas || null,
        prediction.predicted_d60_roas || null,
        prediction.predicted_d180_roas || null,
        prediction.confidence_score || null,
        prediction.trajectory || null,
        prediction.recommended_action || null,
        adId
    );
}

async function updateRoasTrackerAccuracy(adId, d6Acc, d30Acc) {
    const d = await getCiDb();
    const sets = [];
    const params = [];
    if (d6Acc !== undefined) { sets.push('d6_accuracy_pct = ?'); params.push(d6Acc); }
    if (d30Acc !== undefined) { sets.push('d30_accuracy_pct = ?'); params.push(d30Acc); }
    if (!sets.length) return;
    params.push(adId);
    await d.prepare(`UPDATE roas_tracker SET ${sets.join(', ')} WHERE ad_id = ?`).run(...params);
}

async function getRoasTrackerAds() {
    const d = await getCiDb();
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

async function getRoasTrackerTrendline(adId) {
    const d = await getCiDb();
    const tracker = await d.prepare(`
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

    const snapshots = await d.prepare(`
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

async function getRoasTrackerStats() {
    const d = await getCiDb();
    const ghostFilter = 'AND (is_ghost != 1 OR is_ghost IS NULL)';
    const total = await d.prepare(`SELECT COUNT(*) as c FROM roas_tracker WHERE 1=1 ${ghostFilter}`).get();
    const lowSpend = await d.prepare(`SELECT COUNT(*) as c FROM roas_tracker WHERE is_low_spend = 1 ${ghostFilter}`).get();
    const predicted = await d.prepare(`SELECT COUNT(*) as c FROM roas_tracker WHERE prediction_id IS NOT NULL ${ghostFilter}`).get();
    const active = await d.prepare(`SELECT COUNT(*) as c FROM roas_tracker WHERE is_active = 1 ${ghostFilter}`).get();
    const avgAcc = await d.prepare(`SELECT AVG(d6_accuracy_pct) as a FROM roas_tracker WHERE d6_accuracy_pct IS NOT NULL ${ghostFilter}`).get();
    const verified = await d.prepare(`SELECT COUNT(*) as c FROM roas_tracker WHERE d6_accuracy_pct IS NOT NULL ${ghostFilter}`).get();
    const ghosts = await d.prepare('SELECT COUNT(*) as c FROM roas_tracker WHERE is_ghost = 1').get();
    return {
        total_tracked: total.c,
        low_spend: lowSpend.c,
        predicted: predicted.c,
        active: active.c,
        avg_accuracy: avgAcc.a,
        verified: verified.c,
        ghosts: ghosts.c,
    };
}

async function getUnpredictedTrackerAds() {
    const d = await getCiDb();
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
