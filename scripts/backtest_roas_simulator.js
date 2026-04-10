const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(ROOT, 'creative-intelligence', 'ci.db');
const CSV_PATH = path.join(ROOT, 'tmp_roas_weekly_match.csv');
const TARGETS = new Set([
  'FB_MOF_Baby-AI_V0_211125',
  'FB_MOF_Election-Day_V1_261125',
  'FB_MOF_Selfie-Girl-BlackF_0_261125',
  'FB_MOF_Static_Performance-20th-Nov_V0_261125',
  'FB_MOF_Video_Monkey-AI_V2_181125',
  'FB_MOF_Video_Monkey-AI_V1_181125',
  'FB_MOF_Black-Friday-AI_V1_201125',
  'FB_MOF_Black-Friday-Fire_0_201125',
  'FB_MOF_Video_AS-Sebi_V0_171125',
  'FB_MOF_Video_AS-Anchor_V0_161125',
  'FB_MOF_Video_Buddhu-Ladki-Test_V0_131125',
]);

function readCsv() {
  const text = fs.readFileSync(CSV_PATH, 'utf8').trim().split(/\r?\n/);
  const rows = [];
  const headers = text[0].split(',');
  for (const line of text.slice(1)) {
    const parts = line.split(',');
    const row = {};
    headers.forEach((h, i) => row[h] = parts[i]);
    rows.push(row);
  }
  return rows;
}

function pctErr(pred, actual) {
  if (actual == null || actual === 0 || pred == null) return null;
  return Math.abs(pred - actual) / actual * 100;
}

const db = new Database(DB_PATH, { readonly: true });
const tableInfo = db.prepare('PRAGMA table_info(simulator_checkpoint_runs)').all();
const colNames = tableInfo.map(r => r.name);
console.log('checkpoint_columns=' + colNames.join(','));

const preds = db.prepare(`
  SELECT *
  FROM simulator_checkpoint_runs
  WHERE ad_name IN (${Array.from(TARGETS).map(() => '?').join(',')})
  ORDER BY ad_name, checkpoint_code, created_snapshot_date
`).all(...Array.from(TARGETS));

console.log('checkpoint_rows=' + preds.length);
console.log(JSON.stringify(preds.slice(0, 10), null, 2));

const actualRows = readCsv().filter(r => TARGETS.has(r.creative));
const actualByCreative = {};
for (const r of actualRows) {
  const arr = actualByCreative[r.creative] || (actualByCreative[r.creative] = []);
  arr.push({
    week_start: r.week_start,
    spend: Number(r.spend) || 0,
    d6: Number(r.d6_roas) || 0,
    d15: Number(r.d15_roas) || 0,
    d30: Number(r.d30_roas) || 0,
    d60: Number(r.d60_roas) || 0,
    d180: Number(r.d180_roas) || 0,
  });
}
for (const key of Object.keys(actualByCreative)) {
  actualByCreative[key].sort((a, b) => a.week_start.localeCompare(b.week_start));
}

const horizonFields = [
  ['d6', 'predicted_d6_roas'],
  ['d15', 'predicted_d15_roas'],
  ['d30', 'predicted_d30_roas'],
  ['d60', 'predicted_d60_roas'],
  ['d180', 'predicted_d180_roas'],
];

const summary = {};
for (const p of preds) {
  const creative = p.ad_name;
  const actualSeries = actualByCreative[creative] || [];
  const actualFinal = actualSeries.length ? actualSeries[actualSeries.length - 1] : null;
  const s = summary[creative] || (summary[creative] = { runs: 0, mae: 0, mape: 0, n: 0, byHorizon: {} });
  s.runs += 1;
  for (const [actualKey, predKey] of horizonFields) {
    const pred = p[predKey];
    const act = actualFinal ? actualFinal[actualKey] : null;
    const err = pctErr(Number(pred), Number(act));
    if (!s.byHorizon[actualKey]) s.byHorizon[actualKey] = { n: 0, mape: 0 };
    if (err != null) {
      s.byHorizon[actualKey].n += 1;
      s.byHorizon[actualKey].mape += err;
      s.n += 1;
      s.mape += err;
    }
  }
}

console.log('summary=' + JSON.stringify(summary, null, 2));

const snapCols = db.prepare('PRAGMA table_info(snapshots)').all().map(r => r.name);
console.log('snapshot_columns=' + snapCols.join(','));
const snapSample = db.prepare(`
  SELECT ad_name, snapshot_date, spend, d6_overall_revenue, d15_overall_revenue, d30_overall_revenue, d60_overall_revenue, d180_overall_revenue
  FROM snapshots
  WHERE ad_name LIKE 'FB_MOF_%'
  ORDER BY snapshot_date DESC
  LIMIT 25
`).all();
console.log('snapshot_sample=' + JSON.stringify(snapSample, null, 2));
