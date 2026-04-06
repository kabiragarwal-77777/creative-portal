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
