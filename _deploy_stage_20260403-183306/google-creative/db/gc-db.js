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
