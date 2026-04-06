// =============================================================================
// Feedback Engine — DuckDB Database Helper
// Separate DB file: feedback-engine.duckdb (never touches existing DBs)
// =============================================================================

const { createDb } = require('../../lib/duckdb-adapter');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'feedback-engine.db');
const SCHEMA_PATH = path.join(__dirname, 'fe-schema.sql');

let db = null;
let initPromise = null;

async function getFeDb() {
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

async function initSchema() {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    await db.exec(schema);
    console.log('[FeedbackEngine] Database initialized at', DB_PATH);
}

// ── Helper: insert row and return lastInsertRowid ──
async function insert(table, data) {
    const d = await getFeDb();
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const result = await d.prepare(
        `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
    ).run(...keys.map(k => data[k]));
    return result.lastInsertRowid;
}

// ── Helper: update row by id ──
async function update(table, id, data) {
    const d = await getFeDb();
    const sets = Object.keys(data).map(k => `${k} = ?`).join(', ');
    const result = await d.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...Object.values(data), id);
    return result.changes;
}

// ── Helper: get single row ──
async function getOne(table, id) {
    const d = await getFeDb();
    return d.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

// ── Helper: get all rows with optional where ──
async function getAll(table, where = {}, orderBy = 'id DESC', limit = 500) {
    const d = await getFeDb();
    const keys = Object.keys(where);
    let sql = `SELECT * FROM ${table}`;
    if (keys.length) {
        sql += ' WHERE ' + keys.map(k => `${k} = ?`).join(' AND ');
    }
    sql += ` ORDER BY ${orderBy} LIMIT ${limit}`;
    return keys.length
        ? d.prepare(sql).all(...keys.map(k => where[k]))
        : d.prepare(sql).all();
}

// ── Helper: count rows ──
async function count(table, where = {}) {
    const d = await getFeDb();
    const keys = Object.keys(where);
    let sql = `SELECT COUNT(*) as cnt FROM ${table}`;
    if (keys.length) {
        sql += ' WHERE ' + keys.map(k => `${k} = ?`).join(' AND ');
    }
    const row = keys.length
        ? await d.prepare(sql).get(...keys.map(k => where[k]))
        : await d.prepare(sql).get();
    return row ? row.cnt : 0;
}

// ── Helper: raw query ──
async function query(sql, params = []) {
    const d = await getFeDb();
    return d.prepare(sql).all(...params);
}

async function run(sql, params = []) {
    const d = await getFeDb();
    return d.prepare(sql).run(...params);
}

// ── Scheduler log helpers ──
async function logSchedulerStart(jobName) {
    return insert('fe_scheduler_log', {
        job_name: jobName,
        started_at: new Date().toISOString(),
        status: 'running'
    });
}

async function logSchedulerEnd(logId, recordsProcessed, errors = null) {
    const startRow = await getOne('fe_scheduler_log', logId);
    const startTime = startRow ? new Date(startRow.started_at).getTime() : Date.now();
    const duration = Date.now() - startTime;
    await update('fe_scheduler_log', logId, {
        completed_at: new Date().toISOString(),
        duration_ms: duration,
        records_processed: recordsProcessed,
        errors: errors ? String(errors) : null,
        status: errors ? 'failed' : 'completed'
    });
}

module.exports = {
    getFeDb,
    insert,
    update,
    getOne,
    getAll,
    count,
    query,
    run,
    logSchedulerStart,
    logSchedulerEnd
};
