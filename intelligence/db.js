const { createDb } = require('../lib/duckdb-adapter');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'database', 'intel.db');
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

let db;
let initPromise;

async function getIntelDb() {
    if (db) return db;
    if (!initPromise) {
        initPromise = (async () => {
            db = await createDb(DB_PATH);
            const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
            await db.exec(schema);
            return db;
        })();
    }
    return initPromise;
}

module.exports = {
    getIntelDb,
    getAll: async (sql, params = []) => {
        const d = await getIntelDb();
        return d.prepare(sql).all(...(Array.isArray(params) ? params : [params]));
    },
    getOne: async (sql, params = []) => {
        const d = await getIntelDb();
        return d.prepare(sql).get(...(Array.isArray(params) ? params : [params]));
    },
    run: async (sql, params = []) => {
        const d = await getIntelDb();
        return d.prepare(sql).run(...(Array.isArray(params) ? params : [params]));
    },
    getRowCount: async (table) => {
        const d = await getIntelDb();
        const row = await d.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
        return row ? row.count : 0;
    }
};
