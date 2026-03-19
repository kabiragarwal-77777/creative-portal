const { getDb } = require('../database/db');
const { v4: uuidv4 } = require('uuid');

function getExistingInventories() {
  const db = getDb();
  return db.prepare(`
    SELECT ei.*, i.name, i.category, i.platform_parent, i.min_cpm as benchmark_min_cpm,
           i.max_cpm as benchmark_max_cpm, i.pricing_model, i.estimated_monthly_reach
    FROM existing_inventories ei
    JOIN inventories i ON ei.inventory_id = i.id
  `).all();
}

function compareWithBenchmark(inventoryId) {
  const db = getDb();
  const existing = db.prepare(`
    SELECT ei.*, i.name, i.min_cpm as benchmark_min_cpm, i.max_cpm as benchmark_max_cpm
    FROM existing_inventories ei
    JOIN inventories i ON ei.inventory_id = i.id
    WHERE ei.inventory_id = ?
  `).get(inventoryId);

  if (!existing) return null;

  const benchmarkAvg = (existing.benchmark_min_cpm + existing.benchmark_max_cpm) / 2;
  const performanceRatio = existing.current_cpm / benchmarkAvg;

  return {
    ...existing,
    benchmark_avg_cpm: benchmarkAvg,
    performance_ratio: performanceRatio,
    status: performanceRatio < 0.9 ? 'outperforming' : performanceRatio > 1.1 ? 'underperforming' : 'on_par',
    efficiency_score: Math.round((1 / performanceRatio) * 100)
  };
}

function getAllBenchmarks() {
  const db = getDb();
  const existing = db.prepare(`
    SELECT ei.*, i.name, i.category, i.min_cpm as benchmark_min_cpm, i.max_cpm as benchmark_max_cpm
    FROM existing_inventories ei
    JOIN inventories i ON ei.inventory_id = i.id
  `).all();

  return existing.map(inv => {
    const benchmarkAvg = (inv.benchmark_min_cpm + inv.benchmark_max_cpm) / 2;
    const performanceRatio = inv.current_cpm / benchmarkAvg;
    return {
      ...inv,
      benchmark_avg_cpm: benchmarkAvg,
      performance_ratio: performanceRatio,
      status: performanceRatio < 0.9 ? 'outperforming' : performanceRatio > 1.1 ? 'underperforming' : 'on_par',
      efficiency_score: Math.round((1 / performanceRatio) * 100)
    };
  });
}

module.exports = { getExistingInventories, compareWithBenchmark, getAllBenchmarks };
