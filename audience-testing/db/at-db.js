let Database;
try {
    Database = require('better-sqlite3');
} catch (e) {
    Database = require('../../inventory-scanner/node_modules/better-sqlite3');
}
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'audience-testing.db');
let db;

function getAtDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        initSchema();
    }
    return db;
}

function initSchema() {
    const schemaSQL = fs.readFileSync(path.join(__dirname, 'at-schema.sql'), 'utf8');
    db.exec(schemaSQL);
    runMigrations();
}

function ensureColumn(table, column, definition) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    const exists = cols.some(c => String(c.name).toLowerCase() === String(column).toLowerCase());
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function runMigrations() {
    ensureColumn('at_google_campaigns', 'budget_amount', 'REAL');
    ensureColumn('at_google_campaigns', 'budget_type', 'TEXT');
    ensureColumn('at_google_campaigns', 'start_date', 'TEXT');
    ensureColumn('at_google_campaigns', 'end_date', 'TEXT');
    ensureColumn('at_google_campaigns', 'geo_targeting_json', "TEXT DEFAULT '[]'");
    ensureColumn('at_google_campaigns', 'language_targeting_json', "TEXT DEFAULT '[]'");
    ensureColumn('at_google_campaigns', 'network_settings_json', "TEXT DEFAULT '{}'");
    ensureColumn('at_google_campaigns', 'search_impression_share', 'REAL');
    ensureColumn('at_google_campaigns', 'search_rank_lost_impression_share', 'REAL');
    ensureColumn('at_google_campaigns', 'search_budget_lost_impression_share', 'REAL');
    ensureColumn('at_google_adgroups', 'quality_score', 'REAL');
    ensureColumn('at_google_adgroups', 'expected_ctr', 'TEXT');
    ensureColumn('at_google_adgroups', 'ad_relevance', 'TEXT');
    ensureColumn('at_google_adgroups', 'landing_page_experience', 'TEXT');
    ensureColumn('at_google_adgroups', 'search_impression_share', 'REAL');
    ensureColumn('at_google_adgroups', 'search_rank_lost_impression_share', 'REAL');
    ensureColumn('at_google_adgroups', 'search_budget_lost_impression_share', 'REAL');
}

function logSchedulerRun(jobType, details) {
    const stmt = getAtDb().prepare(
        `INSERT INTO at_scheduler_log (job_type, details) VALUES (?, ?)`
    );
    const result = stmt.run(jobType, typeof details === 'string' ? details : JSON.stringify(details));
    return result.lastInsertRowid;
}

function updateSchedulerRun(id, status, details, error) {
    getAtDb().prepare(
        `UPDATE at_scheduler_log SET status = ?, completed_at = datetime('now'), details = ?, error = ? WHERE id = ?`
    ).run(status, typeof details === 'string' ? details : JSON.stringify(details), error || null, id);
}

module.exports = { getAtDb, logSchedulerRun, updateSchedulerRun };
