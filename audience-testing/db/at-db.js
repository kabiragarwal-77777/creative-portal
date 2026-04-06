const { createDb } = require('../../lib/duckdb-adapter');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'audience-testing.db');
let db;
let initPromise;

async function getAtDb() {
    if (db) return db;
    if (!initPromise) {
        initPromise = (async () => {
            db = await createDb(DB_PATH);
            const schemaSQL = fs.readFileSync(path.join(__dirname, 'at-schema.sql'), 'utf8');
            await db.exec(schemaSQL);
            return db;
        })();
    }
    return initPromise;
}

async function logSchedulerRun(jobType, details) {
    const d = await getAtDb();
    const result = await d.prepare(
        `INSERT INTO at_scheduler_log (job_type, details) VALUES (?, ?)`
    ).run(jobType, typeof details === 'string' ? details : JSON.stringify(details));
    return result.lastInsertRowid;
}

async function updateSchedulerRun(id, status, details, error) {
    const d = await getAtDb();
    await d.prepare(
        `UPDATE at_scheduler_log SET status = ?, completed_at = CURRENT_TIMESTAMP, details = ?, error = ? WHERE id = ?`
    ).run(status, typeof details === 'string' ? details : JSON.stringify(details), error || null, id);
}

module.exports = { getAtDb, logSchedulerRun, updateSchedulerRun };
