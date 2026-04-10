const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEEKLY_PATH = path.join(ROOT, 'tmp_roas_weekly_match.csv');
const BACKTEST_PATH = path.join(ROOT, 'tmp_roas_backtest_curves.csv');
const OUT_PATH = path.join(ROOT, 'roas_aggregate_report.html');

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const parts = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h] = parts[i]);
    return obj;
  });
}

const weekly = readCsv(WEEKLY_PATH);
const backtest = readCsv(BACKTEST_PATH);

const byWeek = {};
for (const r of weekly) {
  const wk = r.week_start;
  if (!byWeek[wk]) byWeek[wk] = { count: 0, D6: 0, D15: 0, D30: 0, D60: 0, D180: 0 };
  const b = byWeek[wk];
  b.count++;
  b.D6 += Number(r.d6_roas || 0);
  b.D15 += Number(r.d15_roas || 0);
  b.D30 += Number(r.d30_roas || 0);
  b.D60 += Number(r.d60_roas || 0);
  b.D180 += Number(r.d180_roas || 0);
}
const weekSeries = Object.keys(byWeek).sort().map(wk => ({
  week: wk,
  D6: +(byWeek[wk].D6 / byWeek[wk].count).toFixed(2),
  D15: +(byWeek[wk].D15 / byWeek[wk].count).toFixed(2),
  D30: +(byWeek[wk].D30 / byWeek[wk].count).toFixed(2),
  D60: +(byWeek[wk].D60 / byWeek[wk].count).toFixed(2),
  D180: +(byWeek[wk].D180 / byWeek[wk].count).toFixed(2),
  count: byWeek[wk].count
}));

const stageMap = { P0: 0, P2: 1, P8: 2, P14: 3 };
const stageSeries = { P0: { D60: [], D180: [] }, P2: { D60: [], D180: [] }, P8: { D60: [], D180: [] }, P14: { D60: [], D180: [] } };
for (const r of backtest) {
  if (!stageMap.hasOwnProperty(r.checkpoint)) continue;
  if (r.horizon !== 'D60' && r.horizon !== 'D180') continue;
  const s = stageSeries[r.checkpoint][r.horizon];
  s.push({ pred: Number(r.predicted_final || 0), act: Number(r.actual_final || 0) });
}
const stageAgg = {};
for (const stage of Object.keys(stageSeries)) {
  stageAgg[stage] = {};
  for (const horizon of ['D60', 'D180']) {
    const arr = stageSeries[stage][horizon];
    const n = arr.length || 1;
    stageAgg[stage][horizon] = {
      pred: +(arr.reduce((a, b) => a + b.pred, 0) / n).toFixed(2),
      act: +(arr.reduce((a, b) => a + b.act, 0) / n).toFixed(2),
      n: arr.length
    };
  }
}

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ROAS Aggregate Backtest</title>
  <style>
    :root { --bg:#09090f; --panel:#11111a; --panel2:#151521; --line:#2a2a3a; --text:#e9e9f6; --muted:#9ea0b7; --p0:#7c6cff; --p2:#4da3ff; --p8:#ffb000; --p14:#ff5c5c; --a:#31d07f; }
    body { margin:0; background:linear-gradient(180deg,#09090f,#07070c); color:var(--text); font-family: Inter, Segoe UI, Arial, sans-serif; }
    .wrap { max-width:1400px; margin:0 auto; padding:24px; }
    h1 { margin:0 0 6px; font-size:30px; }
    .sub { color:var(--muted); margin-bottom:16px; }
    .grid { display:grid; grid-template-columns:1fr; gap:14px; }
    .card { background:linear-gradient(180deg,var(--panel),var(--panel2)); border:1px solid var(--line); border-radius:18px; padding:16px; }
    .kpirow { display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; margin-bottom:14px; }
    .kpi { padding:14px; border:1px solid var(--line); border-radius:14px; background:rgba(255,255,255,0.02); }
    .k { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em; }
    .v { font-size:24px; font-weight:700; margin-top:6px; }
    svg { width:100%; height:320px; overflow:visible; }
    .legend { display:flex; gap:14px; flex-wrap:wrap; color:var(--muted); font-size:12px; margin-top:8px; }
    .dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:6px; }
    pre { margin:0; white-space:pre-wrap; word-break:break-word; color:#dfe2ff; font-size:12px; }
    @media (max-width: 900px) { .kpirow { grid-template-columns:1fr 1fr; } }
  </style>
</head>
<body>
<div class="wrap">
  <h1>ROAS Aggregate Backtest</h1>
  <div class="sub">Week-on-week average ROAS across the 11 creatives, plus stage-level P0/P2/P8/P14 backtest rollups. No portal changes were made.</div>
  <div class="kpirow" id="kpis"></div>
  <div class="grid">
    <div class="card">
      <h2 style="margin:0 0 6px;font-size:16px;">Weekly average ROAS by horizon</h2>
      <div id="weekChart"></div>
      <div class="legend" id="weekLegend"></div>
    </div>
    <div class="card">
      <h2 style="margin:0 0 6px;font-size:16px;">Backtest summary for D60 and D180</h2>
      <div id="stageChart"></div>
      <div class="legend" id="stageLegend"></div>
      <div style="margin-top:10px;"><pre id="stageText"></pre></div>
    </div>
  </div>
</div>
<script>
const weekSeries = ${JSON.stringify(weekSeries)};
const stageAgg = ${JSON.stringify(stageAgg)};
const COLORS = { D6:'#7c6cff', D15:'#4da3ff', D30:'#31d07f', D60:'#ffb000', D180:'#ff5c5c', ACT:'#18d39e' };
const kpis = document.getElementById('kpis');
kpis.innerHTML = [
  ['Weeks', weekSeries.length],
  ['Creatives', 11],
  ['Stage Checks', Object.values(stageAgg).reduce((s,v)=>s+v.D60.n+v.D180.n,0)],
  ['Avg D180 (latest week)', weekSeries.length ? weekSeries[weekSeries.length-1].D180.toFixed(2)+'%' : '--']
].map(function(x){ return '<div class="kpi"><div class="k">'+x[0]+'</div><div class="v">'+x[1]+'</div></div>'; }).join('');

function drawChart(el, rows, keys, width, height) {
  width = width || 1200; height = height || 320;
  const padL = 54, padR = 16, padT = 18, padB = 42;
  const maxY = Math.max(1, ...rows.flatMap(r => keys.map(k => r[k])));
  const minY = 0;
  const sx = i => padL + (rows.length <= 1 ? 0 : i / (rows.length - 1)) * (width - padL - padR);
  const sy = v => padT + (height - padT - padB) - (v - minY) / (maxY - minY) * (height - padT - padB);
  let svg = '<svg viewBox="0 0 ' + width + ' ' + height + '">';
  for (let i = 0; i <= 4; i++) {
    const y = padT + i * (height - padT - padB) / 4;
    const val = (maxY * (1 - i / 4)).toFixed(0);
    svg += '<line x1="' + padL + '" y1="' + y + '" x2="' + (width - padR) + '" y2="' + y + '" stroke="#222338" />';
    svg += '<text x="6" y="' + (y + 4) + '" fill="#8b8da6" font-size="10">' + val + '</text>';
  }
  rows.forEach(function(r, i) {
    svg += '<text x="' + sx(i) + '" y="' + (height - 10) + '" text-anchor="middle" fill="#8b8da6" font-size="10">' + (r.week || r.stage) + '</text>';
  });
  keys.forEach(function(k) {
    const pts = rows.map(function(r, i) { return sx(i) + ',' + sy(r[k]); }).join(' ');
    svg += '<polyline points="' + pts + '" fill="none" stroke="' + COLORS[k] + '" stroke-width="3" />';
    rows.forEach(function(r, i) {
      svg += '<circle cx="' + sx(i) + '" cy="' + sy(r[k]) + '" r="3.5" fill="' + COLORS[k] + '" />';
    });
  });
  svg += '</svg>';
  el.innerHTML = svg;
}

drawChart(document.getElementById('weekChart'), weekSeries, ['D6','D15','D30','D60','D180']);
document.getElementById('weekLegend').innerHTML = ['D6','D15','D30','D60','D180'].map(function(k){ return '<span><span class="dot" style="background:' + COLORS[k] + '"></span>' + k + '</span>'; }).join('');

const stageRows = ['P0','P2','P8','P14'].map(function(stage) {
  return { stage: stage, D60: stageAgg[stage].D60.pred, D180: stageAgg[stage].D180.pred, ACT_D60: stageAgg[stage].D60.act, ACT_D180: stageAgg[stage].D180.act };
});
drawChart(document.getElementById('stageChart'), stageRows, ['D60','D180']);
document.getElementById('stageLegend').innerHTML = '<span><span class="dot" style="background:' + COLORS.D60 + '"></span>Predicted D60</span>' +
  '<span><span class="dot" style="background:' + COLORS.D180 + '"></span>Predicted D180</span>' +
  '<span><span class="dot" style="background:' + COLORS.ACT + '"></span>Actual reference</span>';
document.getElementById('stageText').textContent = JSON.stringify(stageAgg, null, 2);
</script>
</body>
</html>`;

fs.writeFileSync(OUT_PATH, html, 'utf8');
console.log(OUT_PATH);
