const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CSV_PATH = path.join(ROOT, 'tmp_roas_weekly_match.csv');
const BACKTEST_PATH = path.join(ROOT, 'tmp_roas_weekly_backtest_proxy.json');
const OUT_PATH = path.join(ROOT, 'roas_backtest_report.html');

const csv = fs.readFileSync(CSV_PATH, 'utf8').trim().split(/\r?\n/);
const hdr = csv[0].split(',');
const idx = Object.fromEntries(hdr.map((h, i) => [h, i]));
const weekly = {};
for (const line of csv.slice(1)) {
  const p = line.split(',');
  const creative = p[idx.creative];
  if (!weekly[creative]) weekly[creative] = [];
  weekly[creative].push({
    week_start: p[idx.week_start],
    spend: Number(p[idx.spend] || 0),
    D6: Number(p[idx.d6_roas] || 0),
    D15: Number(p[idx.d15_roas] || 0),
    D30: Number(p[idx.d30_roas] || 0),
    D60: Number(p[idx.d60_roas] || 0),
    D180: Number(p[idx.d180_roas] || 0),
  });
}
for (const k of Object.keys(weekly)) weekly[k].sort((a, b) => a.week_start.localeCompare(b.week_start));

const backtest = JSON.parse(fs.readFileSync(BACKTEST_PATH, 'utf8')).summary;

const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ROAS Backtest Report</title>
  <style>
    :root { --bg:#09090f; --panel:#11111a; --panel2:#151521; --line:#2a2a3a; --text:#e9e9f6; --muted:#9ea0b7; --good:#31d07f; --warn:#ffb84d; --bad:#ff5b67; --p0:#7c6cff; --p2:#4da3ff; --p8:#ffb000; --p14:#ff5c5c; }
    body { margin:0; font-family: Inter, Segoe UI, Arial, sans-serif; background:linear-gradient(180deg,#09090f,#07070c); color:var(--text); }
    .wrap { max-width: 1500px; margin:0 auto; padding:24px; }
    h1 { margin:0 0 6px; font-size:30px; }
    .sub { color:var(--muted); margin-bottom:18px; }
    .summary { display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; margin-bottom:18px; }
    .card { background:linear-gradient(180deg,var(--panel),var(--panel2)); border:1px solid var(--line); border-radius:18px; padding:14px 16px; }
    .k { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    .v { font-size:26px; font-weight:700; margin-top:6px; }
    .grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap:14px; }
    .creative { background:linear-gradient(180deg,var(--panel),#12121c); border:1px solid var(--line); border-radius:18px; padding:14px; }
    .title { display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom:8px; }
    .title h2 { font-size:16px; margin:0; }
    .title .meta { color:var(--muted); font-size:12px; }
    svg { width:100%; height:240px; overflow:visible; }
    .legend { display:flex; gap:10px; flex-wrap:wrap; font-size:12px; color:var(--muted); margin-top:6px; }
    .dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:5px; vertical-align:middle; }
    .foot { margin-top:18px; color:var(--muted); font-size:12px; }
    .stage { background:rgba(255,255,255,.03); border:1px solid var(--line); border-radius:12px; padding:10px; }
    .stage h3 { margin:0 0 8px; font-size:14px; }
    pre { white-space:pre-wrap; word-break:break-word; margin:0; color:#d9dcff; font-size:12px; line-height:1.5; }
    @media (max-width: 980px){ .summary,.grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>ROAS Backtest Report</h1>
    <div class="sub">11 creatives, weekly ROAS curves across D6 / D15 / D30 / D60 / D180. Open this file locally in Chrome.</div>
    <div class="summary" id="summary"></div>
    <div class="stage card">
      <h3>Proxy backtest summary</h3>
      <pre id="backtest"></pre>
    </div>
    <div style="height:14px"></div>
    <div class="grid" id="grid"></div>
    <div class="foot">Data source: tmp_roas_weekly_match.csv and tmp_roas_weekly_backtest_proxy.json. This is a local analysis artifact only; no portal data was changed.</div>
  </div>
  <script>
    const DATA = ${JSON.stringify({ weekly, backtest })};
    const COLORS = { D6: '#7c6cff', D15: '#4da3ff', D30: '#31d07f', D60: '#ffb000', D180: '#ff5c5c' };
    const summary = document.getElementById('summary');
    const avg = Object.values(DATA.backtest).flatMap(stage => Object.values(stage)).reduce((a, b) => { a.n += b.n; a.m += b.mape * b.n; return a; }, { n:0, m:0 });
    const cards = [
      ['Creatives', Object.keys(DATA.weekly).length],
      ['Total Weeks', Object.values(DATA.weekly).reduce((s, v) => s + v.length, 0)],
      ['Proxy Checks', avg.n],
      ['Proxy Avg MAPE', avg.n ? (avg.m / avg.n).toFixed(2) + '%' : '--'],
    ];
    summary.innerHTML = cards.map(function(pair) {
      return '<div class="card"><div class="k">' + pair[0] + '</div><div class="v">' + pair[1] + '</div></div>';
    }).join('');
    document.getElementById('backtest').textContent = JSON.stringify(DATA.backtest, null, 2);

    function linePath(points, w, h, pad) {
      const xs = points.map(p => p.x), ys = points.map(p => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = 0, maxY = Math.max(1, ...ys);
      const sx = x => pad + (x - minX) / Math.max(1, maxX - minX) * (w - pad * 2);
      const sy = y => h - pad - (y - minY) / Math.max(1, maxY - minY) * (h - pad * 2);
      return points.map(function(p, i) {
        return (i ? 'L' : 'M') + sx(p.x).toFixed(1) + ',' + sy(p.y).toFixed(1);
      }).join(' ');
    }
    function renderChart(el, rows) {
      const w = 680, h = 240, pad = 30;
      const xs = rows.map((r, i) => i);
      const series = ['D6','D15','D30','D60','D180'].map(k => ({ k, pts: rows.map((r,i)=>({x:i,y:r[k]})) }));
      const maxY = Math.max(1, ...series.flatMap(s => s.pts.map(p => p.y)));
      const minY = 0;
      const sx = x => pad + x / Math.max(1, xs.length - 1) * (w - pad * 2);
      const sy = y => h - pad - (y - minY) / Math.max(1, maxY - minY) * (h - pad * 2);
      const grid = [];
      for (let i = 0; i <= 4; i++) {
        const y = pad + (i / 4) * (h - pad * 2);
        const val = (maxY * (1 - i / 4)).toFixed(0);
        grid.push('<line x1="' + pad + '" y1="' + y + '" x2="' + (w - pad) + '" y2="' + y + '" stroke="#232334" />');
        grid.push('<text x="4" y="' + (y + 4) + '" fill="#8b8da6" font-size="10">' + val + '</text>');
      }
      const xlabels = rows.map(function(r, i) { return '<text x="' + sx(i) + '" y="' + (h - 8) + '" text-anchor="middle" fill="#8b8da6" font-size="10">' + r.week_start + '</text>'; }).join('');
      const paths = series.map(function(s) { return '<path d="' + linePath(s.pts, w, h, pad) + '" fill="none" stroke="' + COLORS[s.k] + '" stroke-width="2.5" />'; }).join('');
      const dots = series.map(function(s) { return s.pts.map(function(p) { return '<circle cx="' + sx(p.x) + '" cy="' + sy(p.y) + '" r="2.7" fill="' + COLORS[s.k] + '" />'; }).join(''); }).join('');
      el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '"><rect x="0" y="0" width="' + w + '" height="' + h + '" rx="16" fill="rgba(255,255,255,0.02)" stroke="#262639"/>' + grid.join('') + paths + dots + xlabels + '</svg>';
    }
    const grid = document.getElementById('grid');
    for (const [creative, rows] of Object.entries(DATA.weekly)) {
      const div = document.createElement('div');
      div.className = 'creative';
      const last = rows[rows.length - 1];
      const first = rows[0];
      div.innerHTML = '<div class="title"><h2>' + creative + '</h2><div class="meta">' + rows.length + ' weekly points | D180 ' + first.D180.toFixed(2) + ' → ' + last.D180.toFixed(2) + '</div></div><div class="chart"></div><div class="legend">' + Object.keys(COLORS).map(function(k){ return '<span><span class="dot" style="background:' + COLORS[k] + '"></span>' + k + '</span>'; }).join('') + '</div>';
      grid.appendChild(div);
      renderChart(div.querySelector('.chart'), rows);
    }
  </script>
</body>
</html>`;

fs.writeFileSync(OUT_PATH, html, 'utf8');
console.log(OUT_PATH);
