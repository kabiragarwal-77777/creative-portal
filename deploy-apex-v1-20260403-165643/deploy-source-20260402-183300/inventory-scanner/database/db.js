const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'scanner.db');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

function isSeeded() {
  try {
    const row = db.prepare("SELECT value FROM seed_status WHERE key = 'seeded'").get();
    return row && row.value === 'true';
  } catch {
    return false;
  }
}

function markSeeded() {
  db.prepare("INSERT OR REPLACE INTO seed_status (key, value) VALUES ('seeded', 'true')").run();
}

module.exports = { getDb, isSeeded, markSeeded };
