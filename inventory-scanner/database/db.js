const { createDb } = require('../../lib/duckdb-adapter');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'scanner.db');
let db;
let initPromise;

async function getDb() {
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
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.exec(schema);
}

async function isSeeded() {
    try {
        const d = await getDb();
        const row = await d.prepare("SELECT value FROM seed_status WHERE key = 'seeded'").get();
        return row && row.value === 'true';
    } catch {
        return false;
    }
}

async function markSeeded() {
    const d = await getDb();
    await d.prepare("INSERT OR REPLACE INTO seed_status (key, value) VALUES ('seeded', 'true')").run();
}

module.exports = { getDb, isSeeded, markSeeded };
