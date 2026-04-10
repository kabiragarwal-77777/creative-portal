let Database;
try {
    Database = require('better-sqlite3');
} catch (e) {
    Database = require('../../inventory-scanner/node_modules/better-sqlite3');
}
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'google-creative.db');
let db;

function getGcDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        initSchema();
    }
    return db;
}

function initSchema() {
    const schemaSQL = fs.readFileSync(path.join(__dirname, 'gc-schema.sql'), 'utf8');
    db.exec(schemaSQL);
    runMigrations();
}

function ensureColumn(table, column, definition) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some(col => col.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

function runMigrations() {
    ensureColumn('gc_ads_raw', 'impressions', 'INTEGER DEFAULT 0');
    ensureColumn('gc_ads_raw', 'clicks', 'INTEGER DEFAULT 0');
    ensureColumn('gc_ads_raw', 'cost_micros', 'INTEGER DEFAULT 0');
    ensureColumn('gc_ads_raw', 'conversions', 'REAL DEFAULT 0');
    ensureColumn('gc_ads_raw', 'conversion_value', 'REAL DEFAULT 0');

    ensureColumn('gc_creatives', 'ad_impressions', 'INTEGER DEFAULT 0');
    ensureColumn('gc_creatives', 'ad_clicks', 'INTEGER DEFAULT 0');
    ensureColumn('gc_creatives', 'ad_spend', 'REAL DEFAULT 0');
    ensureColumn('gc_creatives', 'ad_conversions', 'REAL DEFAULT 0');
    ensureColumn('gc_creatives', 'ad_conversion_value', 'REAL DEFAULT 0');
    ensureColumn('gc_creatives', 'ad_ctr', 'REAL DEFAULT 0');
    ensureColumn('gc_creatives', 'ad_cpc', 'REAL DEFAULT 0');
    ensureColumn('gc_creatives', 'ad_cpa', 'REAL DEFAULT 0');
}

function logPipelineRun(runType, details) {
    const stmt = getGcDb().prepare(
        `INSERT INTO gc_pipeline_runs (run_type, details) VALUES (?, ?)`
    );
    const result = stmt.run(runType, typeof details === 'string' ? details : JSON.stringify(details));
    return result.lastInsertRowid;
}

function updatePipelineRun(id, status, details) {
    getGcDb().prepare(
        `UPDATE gc_pipeline_runs SET status = ?, completed_at = datetime('now'), details = ? WHERE id = ?`
    ).run(status, typeof details === 'string' ? details : JSON.stringify(details), id);
}

module.exports = { getGcDb, logPipelineRun, updatePipelineRun };
