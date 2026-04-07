#!/usr/bin/env node
// =============================================================================
// One-time migration: SQLite (.db) → DuckDB (.duckdb)
// Run this on any machine where the old .db files exist and .duckdb files are empty.
// Usage: node migrate-sqlite-to-duckdb.js
// =============================================================================

const Database = require('better-sqlite3');
const { Database: DuckDatabase } = require('duckdb-async');
const path = require('path');
const fs = require('fs');

const DB_PAIRS = [
    {
        name: 'creative-intelligence',
        sqlite: path.join(__dirname, 'creative-intelligence', 'ci.db'),
        duckdb: path.join(__dirname, 'creative-intelligence', 'ci.duckdb'),
    },
    {
        name: 'feedback-engine',
        sqlite: path.join(__dirname, 'feedback-engine', 'feedback-engine.db'),
        duckdb: path.join(__dirname, 'feedback-engine', 'feedback-engine.duckdb'),
    },
    {
        name: 'google-creative',
        sqlite: path.join(__dirname, 'google-creative', 'google-creative.db'),
        duckdb: path.join(__dirname, 'google-creative', 'google-creative.duckdb'),
    },
    {
        name: 'audience-testing',
        sqlite: path.join(__dirname, 'audience-testing', 'audience-testing.db'),
        duckdb: path.join(__dirname, 'audience-testing', 'audience-testing.duckdb'),
    },
    {
        name: 'inventory-scanner',
        sqlite: path.join(__dirname, 'inventory-scanner', 'database', 'scanner.db'),
        duckdb: path.join(__dirname, 'inventory-scanner', 'database', 'scanner.duckdb'),
    },
];

// SQLite internal tables to skip
const SKIP_TABLES = new Set(['sqlite_sequence', 'sqlite_master', 'sync_log']);

async function migrate() {
    console.log('=== SQLite → DuckDB Migration ===\n');

    for (const pair of DB_PAIRS) {
        if (!fs.existsSync(pair.sqlite)) {
            console.log(`[${pair.name}] No SQLite file found at ${pair.sqlite}, skipping.`);
            continue;
        }

        console.log(`\n[${pair.name}] Migrating...`);

        const sqlite = new Database(pair.sqlite, { readonly: true });
        const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();

        if (!tables.length) {
            console.log(`  No tables found, skipping.`);
            sqlite.close();
            continue;
        }

        // Delete and recreate the duckdb file to start fresh
        if (fs.existsSync(pair.duckdb)) {
            fs.unlinkSync(pair.duckdb);
            // Also remove WAL if present
            const walPath = pair.duckdb + '.wal';
            if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        }

        const duck = await DuckDatabase.create(pair.duckdb);

        // Install and load the SQLite extension in DuckDB
        await duck.run('INSTALL sqlite;');
        await duck.run('LOAD sqlite;');

        // Attach the SQLite file directly
        await duck.run(`ATTACH '${pair.sqlite}' AS sqlite_src (TYPE SQLITE, READ_ONLY)`);

        // Get tables from the SQLite source
        let totalRows = 0;
        for (const t of tables) {
            if (SKIP_TABLES.has(t.name)) continue;

            const countRow = sqlite.prepare(`SELECT COUNT(*) as c FROM "${t.name}"`).get();
            if (countRow.c === 0) {
                // Still create the table structure even if empty
                try {
                    await duck.run(`CREATE TABLE IF NOT EXISTS "${t.name}" AS SELECT * FROM sqlite_src."${t.name}" LIMIT 0`);
                    console.log(`  ${t.name}: 0 rows (schema only)`);
                } catch (e) {
                    console.log(`  ${t.name}: skipped (${e.message.slice(0, 80)})`);
                }
                continue;
            }

            try {
                // Drop if exists (fresh migration)
                await duck.run(`DROP TABLE IF EXISTS "${t.name}"`);
                // Copy entire table from SQLite into DuckDB
                await duck.run(`CREATE TABLE "${t.name}" AS SELECT * FROM sqlite_src."${t.name}"`);
                console.log(`  ${t.name}: ${countRow.c} rows migrated`);
                totalRows += countRow.c;
            } catch (e) {
                console.error(`  ${t.name}: FAILED — ${e.message}`);
            }
        }

        // Detach and close
        await duck.run('DETACH sqlite_src');
        await duck.close();
        sqlite.close();

        console.log(`[${pair.name}] Done — ${totalRows} total rows migrated.`);
    }

    console.log('\n=== Migration complete ===');
    console.log('You can now delete the old .db files once verified.');
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
