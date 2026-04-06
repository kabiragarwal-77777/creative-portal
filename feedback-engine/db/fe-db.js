// =============================================================================
// Feedback Engine — SQLite Database Helper
// Separate DB file: feedback-engine.db (never touches existing DBs)
// =============================================================================

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'feedback-engine.db');
const SCHEMA_PATH = path.join(__dirname, 'fe-schema.sql');

let db = null;

function getFeDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        initSchema();
    }
    return db;
}

function initSchema() {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
    console.log('[FeedbackEngine] Database initialized at', DB_PATH);
}

// ── Helper: insert row and return lastInsertRowid ──
function insert(table, data) {
    const keys = Object.keys(data);
    const placeholders = keys.map(() => '?').join(', ');
    const stmt = getFeDb().prepare(
        `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`
    );
    return stmt.run(...keys.map(k => data[k])).lastInsertRowid;
}

// ── Helper: update row by id ──
function update(table, id, data) {
    const sets = Object.keys(data).map(k => `${k} = ?`).join(', ');
    const stmt = getFeDb().prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`);
    return stmt.run(...Object.values(data), id).changes;
}

// ── Helper: get single row ──
function getOne(table, id) {
    return getFeDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

// ── Helper: get all rows with optional where ──
function getAll(table, where = {}, orderBy = 'id DESC', limit = 500) {
    const keys = Object.keys(where);
    let sql = `SELECT * FROM ${table}`;
    if (keys.length) {
        sql += ' WHERE ' + keys.map(k => `${k} = ?`).join(' AND ');
    }
    sql += ` ORDER BY ${orderBy} LIMIT ${limit}`;
    return keys.length
        ? getFeDb().prepare(sql).all(...keys.map(k => where[k]))
        : getFeDb().prepare(sql).all();
}

// ── Helper: count rows ──
function count(table, where = {}) {
    const keys = Object.keys(where);
    let sql = `SELECT COUNT(*) as cnt FROM ${table}`;
    if (keys.length) {
        sql += ' WHERE ' + keys.map(k => `${k} = ?`).join(' AND ');
    }
    return keys.length
        ? getFeDb().prepare(sql).get(...keys.map(k => where[k])).cnt
        : getFeDb().prepare(sql).get().cnt;
}

// ── Helper: raw query ──
function query(sql, params = []) {
    return getFeDb().prepare(sql).all(...params);
}

function run(sql, params = []) {
    return getFeDb().prepare(sql).run(...params);
}

// ── Scheduler log helpers ──
function logSchedulerStart(jobName) {
    return insert('fe_scheduler_log', {
        job_name: jobName,
        started_at: new Date().toISOString(),
        status: 'running'
    });
}

function logSchedulerEnd(logId, recordsProcessed, errors = null) {
    const startRow = getOne('fe_scheduler_log', logId);
    const startTime = startRow ? new Date(startRow.started_at).getTime() : Date.now();
    const duration = Date.now() - startTime;
    update('fe_scheduler_log', logId, {
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
