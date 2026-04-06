// =============================================================================
// DuckDB Adapter — drop-in replacement for better-sqlite3 sync API
// Uses duckdb-async under the hood, but exposes a synchronous-looking API
// by pre-initializing and caching prepared statements.
//
// IMPORTANT: All methods that were sync in better-sqlite3 are now async.
// Callers must use `await`.
// =============================================================================

const { Database } = require('duckdb-async');
const path = require('path');
const fs = require('fs');

// Cache of initialized DuckDB instances
const dbCache = new Map();

/**
 * Create or retrieve a DuckDB database instance.
 * Returns an adapter object that mimics better-sqlite3 API but async.
 */
async function createDb(dbPath) {
    if (dbCache.has(dbPath)) return dbCache.get(dbPath);

    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Replace .db extension with .duckdb
    const duckPath = dbPath.replace(/\.db$/, '.duckdb');
    const db = await Database.create(duckPath);

    const adapter = new DuckDbAdapter(db, duckPath);
    dbCache.set(dbPath, adapter);
    return adapter;
}

class DuckDbAdapter {
    constructor(db, dbPath) {
        this._db = db;
        this._path = dbPath;
    }

    /**
     * Execute multiple SQL statements (schema init, etc.)
     * Translates SQLite-specific syntax to DuckDB.
     */
    async exec(sql) {
        const translated = translateSql(sql);
        // Split on semicolons and run each statement
        const statements = splitStatements(translated);
        for (const stmt of statements) {
            const trimmed = stmt.trim();
            if (!trimmed) continue;
            try {
                await this._db.run(trimmed);
            } catch (err) {
                // Skip known harmless errors (duplicate index, etc.)
                if (err.message && (
                    err.message.includes('already exists') ||
                    err.message.includes('could not set')
                )) {
                    continue;
                }
                console.error(`[DuckDB exec error] ${err.message}\nSQL: ${trimmed.slice(0, 200)}`);
                throw err;
            }
        }
    }

    /**
     * Prepare a statement — returns an object with .get(), .all(), .run()
     * All return Promises.
     */
    prepare(sql) {
        const translated = translateSql(sql);
        const db = this._db;
        return new DuckStatement(db, translated);
    }

    /**
     * Run a function inside a transaction.
     * Returns an async function that wraps the callback in BEGIN/COMMIT.
     */
    transaction(fn) {
        const db = this._db;
        return async (...args) => {
            await db.run('BEGIN TRANSACTION');
            try {
                const result = await fn(...args);
                await db.run('COMMIT');
                return result;
            } catch (err) {
                await db.run('ROLLBACK');
                throw err;
            }
        };
    }

    /**
     * No-op: DuckDB doesn't use PRAGMA
     */
    pragma() {}

    async close() {
        await this._db.close();
        dbCache.delete(this._path);
    }
}

class DuckStatement {
    constructor(db, sql) {
        this._db = db;
        this._sql = sql;
    }

    /**
     * Execute and return all rows.
     * Supports both positional args and named object params.
     */
    async all(...params) {
        const { sql, values } = this._resolveParams(params);
        const rows = await this._db.all(sql, ...values);
        return rows || [];
    }

    /**
     * Execute and return first row or undefined.
     */
    async get(...params) {
        const { sql, values } = this._resolveParams(params);
        // Add LIMIT 1 if not already present for efficiency
        const rows = await this._db.all(sql, ...values);
        return rows && rows.length > 0 ? rows[0] : undefined;
    }

    /**
     * Execute a write statement (INSERT/UPDATE/DELETE).
     * Returns { changes, lastInsertRowid }.
     */
    async run(...params) {
        const { sql, values } = this._resolveParams(params);

        // For INSERT statements, try to get lastInsertRowid via RETURNING
        const isInsert = /^\s*INSERT\s/i.test(sql);

        if (isInsert && !sql.match(/RETURNING/i)) {
            // Try to add RETURNING id if table has an id column
            try {
                const sqlWithReturning = sql.replace(/\)\s*$/, ') RETURNING id');
                const rows = await this._db.all(sqlWithReturning, ...values);
                return {
                    changes: rows ? rows.length : 1,
                    lastInsertRowid: rows && rows.length > 0 ? rows[0].id : 0
                };
            } catch (e) {
                // RETURNING failed (no id column), fall back to regular run
                await this._db.run(sql, ...values);
                return { changes: 1, lastInsertRowid: 0 };
            }
        }

        await this._db.run(sql, ...values);
        return { changes: 1, lastInsertRowid: 0 };
    }

    /**
     * Resolve named params (@param style) to positional ($N) params.
     */
    _resolveParams(params) {
        // No params
        if (!params.length) return { sql: this._sql, values: [] };

        // If first param is an object (named params from better-sqlite3)
        if (params.length === 1 && typeof params[0] === 'object' && params[0] !== null && !Array.isArray(params[0])) {
            const obj = params[0];
            const keys = Object.keys(obj);
            let sql = this._sql;
            const values = [];

            // Replace @param or $param with $N positional params
            let idx = 1;
            const paramMap = {};
            for (const key of keys) {
                paramMap[key] = idx++;
                values.push(obj[key] === undefined ? null : obj[key]);
            }

            // Replace @key with $N
            sql = sql.replace(/@(\w+)/g, (match, name) => {
                if (paramMap[name] !== undefined) {
                    return '$' + paramMap[name];
                }
                return match;
            });

            return { sql, values };
        }

        // Positional params (? style) — DuckDB uses $1, $2, ...
        let sql = this._sql;
        let idx = 1;
        sql = sql.replace(/\?/g, () => '$' + (idx++));
        return { sql, values: params };
    }
}

/**
 * Translate SQLite-specific SQL to DuckDB-compatible SQL
 */
function translateSql(sql) {
    let s = sql;

    // datetime('now', '-N days') → CURRENT_TIMESTAMP - INTERVAL 'N' DAY
    s = s.replace(/datetime\s*\(\s*'now'\s*,\s*'(-?\d+)\s+days?'\s*\)/gi,
        (_, n) => `CURRENT_TIMESTAMP + INTERVAL '${n}' DAY`);

    // datetime('now', '-' || ? || ' days') → CURRENT_TIMESTAMP - CAST(? AS INTEGER) * INTERVAL '1' DAY
    s = s.replace(/datetime\s*\(\s*'now'\s*,\s*'-'\s*\|\|\s*\?\s*\|\|\s*'\s*days?\s*'\s*\)/gi,
        "CURRENT_TIMESTAMP - CAST(? AS INTEGER) * INTERVAL '1' DAY");

    // datetime('now') → CURRENT_TIMESTAMP
    s = s.replace(/datetime\s*\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP');

    // date('now') → CURRENT_DATE
    s = s.replace(/date\s*\(\s*'now'\s*\)/gi, 'CURRENT_DATE');

    // date('now', '-' || ? || ' days') → CURRENT_DATE - INTERVAL (?) DAY
    s = s.replace(/date\s*\(\s*'now'\s*,\s*'-'\s*\|\|\s*\?\s*\|\|\s*'\s*days?\s*'\s*\)/gi,
        "CURRENT_DATE - CAST(? AS INTEGER) * INTERVAL '1' DAY");

    // DEFAULT (datetime('now')) → DEFAULT CURRENT_TIMESTAMP
    s = s.replace(/DEFAULT\s*\(\s*datetime\s*\(\s*'now'\s*\)\s*\)/gi, 'DEFAULT CURRENT_TIMESTAMP');

    // DEFAULT (date('now')) → DEFAULT CURRENT_DATE
    s = s.replace(/DEFAULT\s*\(\s*date\s*\(\s*'now'\s*\)\s*\)/gi, 'DEFAULT CURRENT_DATE');

    // INTEGER PRIMARY KEY AUTOINCREMENT → INTEGER PRIMARY KEY DEFAULT nextval('seq')
    // Actually DuckDB supports: CREATE SEQUENCE + DEFAULT nextval
    // But simpler: just remove AUTOINCREMENT — DuckDB auto-generates for INTEGER PRIMARY KEY
    s = s.replace(/INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT/gi, 'INTEGER PRIMARY KEY');

    // INSERT OR REPLACE → INSERT OR REPLACE (DuckDB supports this)
    // INSERT OR IGNORE → INSERT OR IGNORE (DuckDB supports this)

    // PRAGMA statements → skip
    if (/^\s*PRAGMA\s/i.test(s)) return '-- ' + s;

    // sqlite_master queries → information_schema.tables with column name fixes
    if (/sqlite_master/i.test(s)) {
        s = s.replace(/sqlite_master/gi, 'information_schema.tables');
        s = s.replace(/\btype\s*=\s*'table'/gi, "table_type = 'BASE TABLE'");
        s = s.replace(/\bSELECT\s+name\b/i, 'SELECT table_name as name');
        s = s.replace(/\bAND\s+name\s*=/gi, 'AND table_name =');
        s = s.replace(/\bWHERE\s+name\s*=/gi, 'WHERE table_name =');
    }

    // PRAGMA table_info(x) → SELECT column_name as name FROM information_schema.columns WHERE table_name = 'x'
    const pragmaMatch = s.match(/PRAGMA\s+table_info\s*\(\s*(\w+)\s*\)/i);
    if (pragmaMatch) {
        s = `SELECT column_name as name, data_type as type FROM information_schema.columns WHERE table_name = '${pragmaMatch[1]}'`;
    }

    return s;
}

/**
 * Split SQL text into individual statements, respecting string literals.
 */
function splitStatements(sql) {
    const statements = [];
    let current = '';
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < sql.length; i++) {
        const c = sql[i];
        if (inString) {
            current += c;
            if (c === stringChar && sql[i + 1] !== stringChar) {
                inString = false;
            } else if (c === stringChar && sql[i + 1] === stringChar) {
                current += sql[++i]; // escaped quote
            }
        } else if (c === '\'' || c === '"') {
            inString = true;
            stringChar = c;
            current += c;
        } else if (c === ';') {
            if (current.trim()) statements.push(current.trim());
            current = '';
        } else {
            current += c;
        }
    }
    if (current.trim()) statements.push(current.trim());
    return statements;
}

module.exports = { createDb, DuckDbAdapter, translateSql };
