const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'database', 'intel.db');
// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

module.exports = {
  db,
  getAll: (sql, params = []) => db.prepare(sql).all(...(Array.isArray(params) ? params : [params])),
  getOne: (sql, params = []) => db.prepare(sql).get(...(Array.isArray(params) ? params : [params])),
  run: (sql, params = []) => db.prepare(sql).run(...(Array.isArray(params) ? params : [params])),
  getRowCount: (table) => db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get().count
};
