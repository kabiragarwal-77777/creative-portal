const { createDb } = require('../../lib/duckdb-adapter');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'google-creative.db');
let db;
let initPromise;

async function getGcDb() {
    if (db) return db;
    if (!initPromise) {
        initPromise = (async () => {
            db = await createDb(DB_PATH);
            const schemaSQL = fs.readFileSync(path.join(__dirname, 'gc-schema.sql'), 'utf8');
            await db.exec(schemaSQL);
            return db;
        })();
    }
    return initPromise;
}

async function logPipelineRun(runType, details) {
    const d = await getGcDb();
    const result = await d.prepare(
        `INSERT INTO gc_pipeline_runs (run_type, details) VALUES (?, ?)`
    ).run(runType, typeof details === 'string' ? details : JSON.stringify(details));
    return result.lastInsertRowid;
}

async function updatePipelineRun(id, status, details) {
    const d = await getGcDb();
    await d.prepare(
        `UPDATE gc_pipeline_runs SET status = ?, completed_at = CURRENT_TIMESTAMP, details = ? WHERE id = ?`
    ).run(status, typeof details === 'string' ? details : JSON.stringify(details), id);
}

module.exports = { getGcDb, logPipelineRun, updatePipelineRun };
