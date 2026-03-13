const SHEET_ID = '15cUn1ykWCttlk4G1y2SvT2yKoceRqsHRYJEnWeqzEIk';
const SHEET_NAME = 'Creative Performance Tracker-Auto';

let allData = [];
let filteredData = [];
let sheetsData = []; // Preserved copy of sheets-only data for merging

// ---- Data Fetch using Google Visualization JSONP (bypasses CORS) ----
async function fetchData() {
    showLoading(true);
    try {
        const data = await fetchViaJSONP();
        allData = data;
        normalizeData();
        document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();
        applyFilters();
        renderCurrentView();
    } catch (err) {
        console.error('Fetch error:', err);
        document.getElementById('loadingOverlay').innerHTML = `
            <p style="color:var(--red);">Failed to load data: ${err.message}</p>
            <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">Make sure the sheet is shared as "Anyone with the link"</p>
            <button onclick="fetchData()" style="margin-top:12px;padding:8px 20px;background:var(--accent);border:none;color:white;border-radius:6px;cursor:pointer;">Retry</button>
        `;
        return;
    }
    showLoading(false);
}

function fetchViaJSONP() {
    return new Promise((resolve, reject) => {
        const callbackName = 'sheetCallback_' + Date.now();
        const script = document.createElement('script');
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Request timed out'));
        }, 15000);

        function cleanup() {
            clearTimeout(timeout);
            delete window[callbackName];
            if (script.parentNode) script.parentNode.removeChild(script);
        }

        window[callbackName] = function (response) {
            cleanup();
            try {
                const rows = parseGvizResponse(response);
                resolve(rows);
            } catch (e) {
                reject(e);
            }
        };

        const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json;responseHandler:${callbackName}&sheet=${encodeURIComponent(SHEET_NAME)}`;
        script.src = url;
        script.onerror = () => { cleanup(); reject(new Error('Script load failed')); };
        document.body.appendChild(script);
    });
}

function parseGvizResponse(response) {
    const table = response.table;
    // Build header list: use label, fallback to column id (A, B, C...)
    const headers = table.cols.map((c, i) => {
        if (c.label && c.label.trim()) return c.label.trim();
        // Column B is Type (unlabeled)
        if (c.id === 'B') return '_Type';
        return '_col_' + c.id;
    });
    console.log('Sheet headers:', headers);
    const rows = [];
    for (const row of table.rows) {
        const obj = {};
        row.c.forEach((cell, idx) => {
            if (idx >= headers.length) return;
            const key = headers[idx];
            if (cell) {
                // Prefer formatted value (f) for display, raw value (v) as fallback
                obj[key] = cell.f != null ? String(cell.f) : (cell.v != null ? String(cell.v) : '');
            } else {
                obj[key] = '';
            }
        });
        rows.push(obj);
    }
    console.log('First row parsed:', rows[0]);
    return rows;
}

// ---- Data Normalization ----
function normalizeData() {
    if (!allData.length) return;
    // Log keys for debugging
    console.log('Available keys:', Object.keys(allData[0]));
    console.log('Live? column value for row 0:', allData[0]['Live?']);
    console.log('Sample row values:', JSON.stringify(allData[0]));

    allData = allData.map((d, idx) => {
        // Flexible getter: finds first key containing any of the search terms
        const get = (keys) => {
            for (const k of keys) {
                for (const h of Object.keys(d)) {
                    if (h.toLowerCase().includes(k.toLowerCase()) && d[h]) return d[h];
                }
            }
            return '';
        };

        // Get raw live value - match "Live?" column specifically, not "Go Live"
        const liveRaw = d['Live?'] || '';
        const isLive = liveRaw.toLowerCase() === 'live';

        return {
            sno: idx + 1,
            type: d['_Type'] || get(['Type']) || detectType(get(['Creative'])),
            name: get(['Creative']) || `Row ${idx + 1}`,
            date: get(['Date - Go', 'Go Live']),
            spent: parseNum(get(['Spent'])),
            impressions: parseNum(get(['Impr'])),
            cpm: parseNum(get(['CPM'])),
            clicks: parseNum(get(['Click'])),
            ctr: parsePercent(get(['CTR'])),
            installs: parseNum(get(['Install'])),
            cpi: parseNum(get(['CPI'])),
            signups: parseNum(get(['Signup'])),
            signupCost: parseNum(get(['Signup Cost'])),
            signupPct: parsePercent(get(['Signup%'])),
            d6: parseNum(get(['D6 '])),
            d6CAC: parseNum(get(['D6 CAC'])),
            d6ROAS: parsePercent(get(['D6 ROAS'])),
            overallROAS: parsePercent(get(['Overall ROAS'])),
            overallRevenue: parseNum(get(['Overall revenue'])),
            p0p1: parseNum(get(['P0P1'])),
            p0p1Pct: parsePercent(get(['P0P1%'])),
            p0p1Cost: parseNum(get(['P0P1 Cost'])),
            d0Trials: parseNum(get(['D0_Trial', 'D0 Trial'])),
            d0TrialCost: parseNum(get(['D0 Trial Cost'])),
            d0: parseNum(get(['D0'])),
            d0CAC: parseNum(get(['D0 CAC'])),
            hook: parsePercent(get(['Hook'])),
            hold: parsePercent(get(['Hold'])),
            fullPlay: parsePercent(get(['Full'])),
            thruPlays: parseNum(get(['ThruPlay'])),
            threeSecViews: parseNum(get(['3-Sec', '3 Sec'])),
            nextSteps: get(['Next']),
            live: isLive ? 'Live' : 'Paused',
            testPerf: get(['Test Perf']),
            week: get(['Week']),
            year: get(['Year']),
            _raw: d,
            _source: 'sheets'
        };
    }).filter(d => d.name && d.name !== 'Row 0' && d.name.includes('FB_'));
    // Preserve sheets data for merge with Meta
    sheetsData = allData.map(d => ({ ...d }));
}

function detectType(name) {
    if (!name) return '';
    if (name.toLowerCase().includes('video')) return 'Video';
    if (name.toLowerCase().includes('static')) return 'Static';
    return '';
}

function parseNum(val) {
    if (!val) return 0;
    const cleaned = String(val).replace(/[₹,%\s]/g, '').replace(/,/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
}

function parsePercent(val) {
    if (!val) return 0;
    const cleaned = String(val).replace(/[%\s]/g, '').replace(/,/g, '');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
}

function formatINR(n) {
    if (n >= 10000000) return '₹' + (n / 10000000).toFixed(1) + 'Cr';
    if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L';
    if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'K';
    return '₹' + Math.round(n);
}

function formatNum(n) {
    if (n >= 10000000) return (n / 10000000).toFixed(1) + 'Cr';
    if (n >= 100000) return (n / 100000).toFixed(1) + 'L';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return Math.round(n).toLocaleString();
}

// ---- Data Merging (Meta API + Google Sheets) ----
function normalizeCreativeName(name) {
    if (!name) return '';
    return name.trim().toLowerCase().replace(/\s+/g, '_');
}

function stripCreativePrefix(name) {
    if (!name) return '';
    return name.replace(/^FB_MOF_(Video_|Static_)?/i, '').trim().toLowerCase().replace(/\s+/g, '_');
}

function mergeDataSources() {
    if (!metaData.length) {
        allData = sheetsData.slice();
        return;
    }

    // Build lookup from sheets data by normalized name
    const sheetsMap = new Map();
    sheetsData.forEach(d => {
        sheetsMap.set(normalizeCreativeName(d.name), d);
    });

    // Also build a fallback map with prefix stripped
    const sheetsFallbackMap = new Map();
    sheetsData.forEach(d => {
        const stripped = stripCreativePrefix(d.name);
        if (stripped) sheetsFallbackMap.set(stripped, d);
    });

    const merged = [];
    const matchedSheetNames = new Set();

    // Match each Meta ad against sheets data
    metaData.forEach(metaAd => {
        const metaKey = normalizeCreativeName(metaAd.name);
        const metaStripped = stripCreativePrefix(metaAd.name);

        // Primary match: exact normalized name
        let sheetsRow = sheetsMap.get(metaKey);
        // Fallback: stripped prefix match
        if (!sheetsRow && metaStripped) {
            sheetsRow = sheetsFallbackMap.get(metaStripped);
        }

        if (sheetsRow) {
            matchedSheetNames.add(normalizeCreativeName(sheetsRow.name));
            // Merged record: Meta real-time + Sheets enrichment
            merged.push({
                sno: 0,
                name: metaAd.name,
                type: metaAd.type || sheetsRow.type,
                date: sheetsRow.date || metaAd.date,
                // Real-time from Meta
                spent: metaAd.spent,
                impressions: metaAd.impressions,
                cpm: metaAd.cpm,
                clicks: metaAd.clicks,
                ctr: metaAd.ctr,
                installs: metaAd.installs,
                cpi: metaAd.cpi,
                live: metaAd.live,
                // Enrichment from Sheets
                signups: sheetsRow.signups,
                signupCost: sheetsRow.signupCost,
                signupPct: sheetsRow.signupPct,
                d6: sheetsRow.d6,
                d6CAC: sheetsRow.d6CAC,
                d6ROAS: sheetsRow.d6ROAS,
                overallROAS: sheetsRow.overallROAS,
                overallRevenue: sheetsRow.overallRevenue,
                p0p1: sheetsRow.p0p1,
                p0p1Pct: sheetsRow.p0p1Pct,
                p0p1Cost: sheetsRow.p0p1Cost,
                d0Trials: sheetsRow.d0Trials,
                d0TrialCost: sheetsRow.d0TrialCost,
                d0: sheetsRow.d0,
                d0CAC: sheetsRow.d0CAC,
                hook: sheetsRow.hook,
                hold: sheetsRow.hold,
                fullPlay: sheetsRow.fullPlay,
                thruPlays: sheetsRow.thruPlays || metaAd.thruPlays,
                threeSecViews: sheetsRow.threeSecViews,
                nextSteps: sheetsRow.nextSteps,
                testPerf: sheetsRow.testPerf,
                week: sheetsRow.week,
                year: sheetsRow.year,
                campaignId: metaAd.campaignId,
                campaignName: metaAd.campaignName,
                _raw: metaAd._raw,
                _rawSheets: sheetsRow._raw,
                _source: 'merged'
            });
        } else {
            // Unmatched Meta ad
            merged.push({ ...metaAd, _source: 'meta' });
        }
    });

    // Add unmatched sheets rows
    sheetsData.forEach(d => {
        if (!matchedSheetNames.has(normalizeCreativeName(d.name))) {
            merged.push({ ...d, _source: 'sheets' });
        }
    });

    // Re-number
    merged.forEach((d, i) => { d.sno = i + 1; });

    const matchedCount = merged.filter(d => d._source === 'merged').length;
    const metaOnly = merged.filter(d => d._source === 'meta').length;
    const sheetsOnly = merged.filter(d => d._source === 'sheets').length;
    console.log(`Merge: ${matchedCount} matched, ${metaOnly} meta-only, ${sheetsOnly} sheets-only (total: ${merged.length})`);

    allData = merged;
}

// ---- Filters ----
function applyFilters() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const type = document.getElementById('typeFilter').value;
    const status = document.getElementById('statusFilter').value;
    const perf = document.getElementById('perfFilter').value;
    const source = document.getElementById('sourceFilter').value;
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    const dateFromTs = dateFrom ? new Date(dateFrom).getTime() : 0;
    const dateToTs = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : Infinity;

    filteredData = allData.filter(d => {
        if (search && !d.name.toLowerCase().includes(search)) return false;
        if (type !== 'all' && d.type !== type) return false;
        if (status !== 'all' && d.live !== status) return false;
        if (perf !== 'all' && d.testPerf !== perf) return false;
        if (dateFrom || dateTo) {
            const dTs = parseDate(d.date);
            if (dTs && (dTs < dateFromTs || dTs > dateToTs)) return false;
            if (!dTs && (dateFrom || dateTo)) return false;
        }
        if (source !== 'all') {
            const s = d._source || 'sheets';
            if (source === 'meta' && s !== 'meta') return false;
            if (source === 'sheets' && s !== 'sheets') return false;
            if (source === 'merged' && s !== 'merged') return false;
        }
        return true;
    });
}

// ---- Navigation ----
const views = {
    dashboard: { title: 'Dashboard', subtitle: 'Overview of all Meta ad creatives' },
    creatives: { title: 'All Creatives', subtitle: 'Complete creative database' },
    new: { title: 'New This Week', subtitle: 'Recently launched creatives' },
    top: { title: 'Top Performers', subtitle: 'Best performing creatives by key metrics' },
    failures: { title: 'Underperformers', subtitle: 'Creatives that need attention or removal' },
    scorecard: { title: 'Scorecard', subtitle: 'Detailed performance scorecard per creative' },
    alerts: { title: 'Alerts', subtitle: 'Live creative alerts based on performance thresholds' },
    accounts: { title: 'Accounts', subtitle: 'Manage connected ad platform accounts' }
};

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(view + 'View').classList.add('active');
        document.getElementById('pageTitle').textContent = views[view].title;
        document.getElementById('pageSubtitle').textContent = views[view].subtitle;
        renderCurrentView();
    });
});

function getCurrentView() {
    const active = document.querySelector('.nav-item.active');
    return active ? active.dataset.view : 'dashboard';
}

function renderCurrentView() {
    applyFilters();
    const view = getCurrentView();
    if (view === 'dashboard') renderDashboard();
    else if (view === 'creatives') renderTable();
    else if (view === 'new') renderNew();
    else if (view === 'top') renderTop();
    else if (view === 'failures') renderFailures();
    else if (view === 'scorecard') renderScorecardView();
    else if (view === 'alerts') renderAlertsPage();
    else if (view === 'accounts') renderAccountsView();
}

// ---- Dashboard ----
function renderDashboard() {
    const data = filteredData;
    const totalSpend = data.reduce((s, d) => s + d.spent, 0);
    const totalInstalls = data.reduce((s, d) => s + d.installs, 0);
    const totalSignups = data.reduce((s, d) => s + d.signups, 0);
    const liveCount = data.filter(d => d.live === 'Live').length;
    const withCPI = data.filter(d => d.cpi > 0);
    const avgCPI = withCPI.length ? withCPI.reduce((s, d) => s + d.cpi, 0) / withCPI.length : 0;
    const withCTR = data.filter(d => d.ctr > 0);
    const avgCTR = withCTR.length ? withCTR.reduce((s, d) => s + d.ctr, 0) / withCTR.length : 0;
    const withROAS = data.filter(d => d.d6ROAS > 0);
    const avgROAS = withROAS.length ? withROAS.reduce((s, d) => s + d.d6ROAS, 0) / withROAS.length : 0;
    const withOverallROAS = data.filter(d => d.overallROAS > 0);
    const avgOverallROAS = withOverallROAS.length ? withOverallROAS.reduce((s, d) => s + d.overallROAS, 0) / withOverallROAS.length : 0;
    const withSignupCost = data.filter(d => d.signupCost > 0);
    const avgSignupCost = withSignupCost.length ? withSignupCost.reduce((s, d) => s + d.signupCost, 0) / withSignupCost.length : 0;
    const withP0P1Cost = data.filter(d => d.p0p1Cost > 0);
    const avgP0P1Cost = withP0P1Cost.length ? withP0P1Cost.reduce((s, d) => s + d.p0p1Cost, 0) / withP0P1Cost.length : 0;
    const withD0CAC = data.filter(d => d.d0CAC > 0);
    const avgD0CAC = withD0CAC.length ? withD0CAC.reduce((s, d) => s + d.d0CAC, 0) / withD0CAC.length : 0;
    const withD0TrialCost = data.filter(d => d.d0TrialCost > 0);
    const avgD0TrialCost = withD0TrialCost.length ? withD0TrialCost.reduce((s, d) => s + d.d0TrialCost, 0) / withD0TrialCost.length : 0;
    const withD6CAC = data.filter(d => d.d6CAC > 0);
    const avgD6CAC = withD6CAC.length ? withD6CAC.reduce((s, d) => s + d.d6CAC, 0) / withD6CAC.length : 0;

    const mergedCount = data.filter(d => d._source === 'merged').length;
    const metaOnlyCount = data.filter(d => d._source === 'meta').length;
    const sheetsOnlyCount = data.filter(d => d._source === 'sheets').length;

    document.getElementById('kpiTotal').textContent = data.length;
    document.getElementById('kpiTotalSub').textContent = mergedCount
        ? `${mergedCount} merged, ${metaOnlyCount} meta, ${sheetsOnlyCount} sheets`
        : `${data.filter(d => d.type === 'Video').length} video, ${data.filter(d => d.type === 'Static').length} static`;
    document.getElementById('kpiLive').textContent = liveCount;
    document.getElementById('kpiLiveSub').textContent = `${data.length - liveCount} paused`;
    document.getElementById('kpiSpend').textContent = formatINR(totalSpend);
    document.getElementById('kpiSpendSub').textContent = `Avg ${formatINR(totalSpend / (data.length || 1))} per creative`;
    document.getElementById('kpiInstalls').textContent = formatNum(totalInstalls);
    document.getElementById('kpiInstallsSub').textContent = `${formatNum(totalSignups)} signups`;
    document.getElementById('kpiCPI').textContent = '₹' + Math.round(avgCPI);
    document.getElementById('kpiCPISub').textContent = `Across ${withCPI.length} creatives`;
    document.getElementById('kpiCTR').textContent = avgCTR.toFixed(2) + '%';
    document.getElementById('kpiCTRSub').textContent = `Across ${withCTR.length} creatives`;
    document.getElementById('kpiSignups').textContent = formatNum(totalSignups);
    document.getElementById('kpiSignupsSub').textContent = `${totalInstalls ? ((totalSignups / totalInstalls) * 100).toFixed(1) : 0}% of installs`;
    document.getElementById('kpiROAS').textContent = avgROAS.toFixed(1) + '%';
    document.getElementById('kpiROASSub').textContent = `Across ${withROAS.length} creatives`;
    document.getElementById('kpiOverallROAS').textContent = avgOverallROAS.toFixed(1) + '%';
    document.getElementById('kpiOverallROASSub').textContent = `Across ${withOverallROAS.length} creatives`;
    document.getElementById('kpiSignupCost').textContent = '₹' + Math.round(avgSignupCost);
    document.getElementById('kpiSignupCostSub').textContent = `Across ${withSignupCost.length} creatives`;
    document.getElementById('kpiP0P1Cost').textContent = '₹' + Math.round(avgP0P1Cost);
    document.getElementById('kpiP0P1CostSub').textContent = `Across ${withP0P1Cost.length} creatives`;
    document.getElementById('kpiD0CAC').textContent = '₹' + Math.round(avgD0CAC);
    document.getElementById('kpiD0CACSub').textContent = `Across ${withD0CAC.length} creatives`;
    document.getElementById('kpiD0TrialCost').textContent = '₹' + Math.round(avgD0TrialCost);
    document.getElementById('kpiD0TrialCostSub').textContent = `Across ${withD0TrialCost.length} creatives`;
    document.getElementById('kpiD6CAC').textContent = '₹' + Math.round(avgD6CAC);
    document.getElementById('kpiD6CACSub').textContent = `Across ${withD6CAC.length} creatives`;

    // Performance distribution
    const perfCounts = {};
    ['Exceptional', 'Performed', 'Try', 'Failed', 'Drop', ''].forEach(p => {
        perfCounts[p || 'Untagged'] = data.filter(d => (d.testPerf || 'Untagged') === (p || 'Untagged')).length;
    });
    const perfColors = { Exceptional: 'var(--green)', Performed: 'var(--blue)', Try: 'var(--orange)', Failed: 'var(--red)', Drop: '#f87171', Untagged: 'var(--text-muted)' };
    const maxPerf = Math.max(...Object.values(perfCounts), 1);
    document.getElementById('perfDistribution').innerHTML = `<div class="bar-chart">${
        Object.entries(perfCounts).map(([k, v]) => `
            <div class="bar-row">
                <span class="bar-label">${k}</span>
                <div class="bar-track"><div class="bar-fill" style="width:${(v / maxPerf) * 100}%;background:${perfColors[k]}">${v}</div></div>
                <span class="bar-count">${v}</span>
            </div>
        `).join('')
    }</div>`;

    // Type split
    const videoCount = data.filter(d => d.type === 'Video').length;
    const staticCount = data.filter(d => d.type === 'Static').length;
    const otherCount = data.length - videoCount - staticCount;
    document.getElementById('typeSplit').innerHTML = `<div class="bar-chart">
        <div class="bar-row"><span class="bar-label">Video</span><div class="bar-track"><div class="bar-fill" style="width:${(videoCount / (data.length || 1)) * 100}%;background:var(--accent)">${videoCount}</div></div><span class="bar-count">${((videoCount / (data.length || 1)) * 100).toFixed(0)}%</span></div>
        <div class="bar-row"><span class="bar-label">Static</span><div class="bar-track"><div class="bar-fill" style="width:${(staticCount / (data.length || 1)) * 100}%;background:var(--orange)">${staticCount}</div></div><span class="bar-count">${((staticCount / (data.length || 1)) * 100).toFixed(0)}%</span></div>
        ${otherCount ? `<div class="bar-row"><span class="bar-label">Other</span><div class="bar-track"><div class="bar-fill" style="width:${(otherCount / (data.length || 1)) * 100}%;background:var(--text-muted)">${otherCount}</div></div><span class="bar-count">${otherCount}</span></div>` : ''}
    </div>`;

    // Top 5 ROAS
    const topROAS = [...data].filter(d => d.d6ROAS > 0 && d.spent > 15000).sort((a, b) => b.d6ROAS - a.d6ROAS).slice(0, 5);
    document.getElementById('topROAS').innerHTML = topROAS.map((d, i) => `
        <div class="rank-item">
            <span class="rank-num">#${i + 1}</span>
            <div class="rank-info">
                <div class="rank-name">${shortName(d.name)}</div>
                <div class="rank-meta">${d.type} | Spend: ${formatINR(d.spent)}</div>
            </div>
            <span class="rank-value">${d.d6ROAS.toFixed(0)}%</span>
        </div>
    `).join('');

    // Top 5 CPI
    const topCPI = [...data].filter(d => d.cpi > 0 && d.installs >= 10).sort((a, b) => a.cpi - b.cpi).slice(0, 5);
    document.getElementById('topCPI').innerHTML = topCPI.map((d, i) => `
        <div class="rank-item">
            <span class="rank-num">#${i + 1}</span>
            <div class="rank-info">
                <div class="rank-name">${shortName(d.name)}</div>
                <div class="rank-meta">${d.type} | Installs: ${formatNum(d.installs)}</div>
            </div>
            <span class="rank-value" style="color:var(--teal)">₹${Math.round(d.cpi)}</span>
        </div>
    `).join('');

    // Recent table
    const recent = [...data].sort((a, b) => parseDate(b.date) - parseDate(a.date)).slice(0, 10);
    document.getElementById('recentTable').innerHTML = `
        <table>
            <thead><tr>
                <th>Creative</th><th>Type</th><th>Date</th><th>Spend</th><th>CTR</th><th>CPI</th><th>Signups</th><th>D6 ROAS</th><th>Signup Cost</th><th>D0 Trial Cost</th><th>Status</th>
            </tr></thead>
            <tbody>${recent.map(d => `<tr>
                <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis">${shortName(d.name)}</td>
                <td><span class="cc-badge ${d.type === 'Video' ? 'badge-video' : 'badge-static'}">${d.type}</span></td>
                <td>${d.date || '-'}</td>
                <td>${formatINR(d.spent)}</td>
                <td>${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</td>
                <td>${d.cpi ? '₹' + Math.round(d.cpi) : '-'}</td>
                <td>${d.signups || 0}</td>
                <td style="color:${d.d6ROAS > 25 ? 'var(--green)' : d.d6ROAS > 10 ? 'var(--orange)' : 'var(--red)'}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</td>
                <td>${d.signupCost ? '₹' + Math.round(d.signupCost) : '-'}</td>
                <td>${d.d0TrialCost ? '₹' + Math.round(d.d0TrialCost) : '-'}</td>
                <td>${perfBadge(d.testPerf)}</td>
            </tr>`).join('')}</tbody>
        </table>
    `;

    // Render alerts
    renderAlerts();

    // Render live dashboard below
    renderLiveDashboard();
}

function renderAlerts() {
    const live = filteredData.filter(d => d.live === 'Live');

    // Red alerts: signup cost > 1000 OR d0 trial cost > 3500
    const redAlerts = live.filter(d =>
        (d.signupCost > 1000) || (d.d0TrialCost > 3500)
    );

    // Green alerts: d6 ROAS > 25% OR d0 trial cost < 2000 (and > 0)
    const greenAlerts = live.filter(d =>
        (d.d6ROAS > 25) || (d.d0TrialCost > 0 && d.d0TrialCost < 2000)
    );

    const alertsContainer = document.getElementById('alertsSection');
    if (!alertsContainer) return;

    let html = '';

    // Red alerts
    html += `<div class="alerts-panel alerts-red">
        <div class="alerts-header">
            <span class="alerts-icon">&#9888;</span>
            <h3>Red Alerts</h3>
            <span class="alerts-count">${redAlerts.length}</span>
        </div>
        <div class="alerts-body">`;

    if (redAlerts.length) {
        html += redAlerts.map(d => {
            const reasons = [];
            if (d.signupCost > 1000) reasons.push(`Signup Cost: ₹${Math.round(d.signupCost)}`);
            if (d.d0TrialCost > 3500) reasons.push(`D0 Trial Cost: ₹${Math.round(d.d0TrialCost)}`);
            return `<div class="alert-item alert-item-red">
                <div class="alert-name">${shortName(d.name)}</div>
                <div class="alert-reasons">${reasons.join(' | ')}</div>
                <div class="alert-extra">${d.type} | Spend: ${formatINR(d.spent)} | CPI: ${d.cpi ? '₹' + Math.round(d.cpi) : '-'}</div>
            </div>`;
        }).join('');
    } else {
        html += '<p class="alerts-empty">No red alerts. All live creatives within thresholds.</p>';
    }

    html += `</div></div>`;

    // Green alerts
    html += `<div class="alerts-panel alerts-green">
        <div class="alerts-header">
            <span class="alerts-icon">&#10004;</span>
            <h3>Green Alerts</h3>
            <span class="alerts-count">${greenAlerts.length}</span>
        </div>
        <div class="alerts-body">`;

    if (greenAlerts.length) {
        html += greenAlerts.map(d => {
            const reasons = [];
            if (d.d6ROAS > 25) reasons.push(`D6 ROAS: ${d.d6ROAS.toFixed(1)}%`);
            if (d.d0TrialCost > 0 && d.d0TrialCost < 2000) reasons.push(`D0 Trial Cost: ₹${Math.round(d.d0TrialCost)}`);
            return `<div class="alert-item alert-item-green">
                <div class="alert-name">${shortName(d.name)}</div>
                <div class="alert-reasons">${reasons.join(' | ')}</div>
                <div class="alert-extra">${d.type} | Spend: ${formatINR(d.spent)} | D6 ROAS: ${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</div>
            </div>`;
        }).join('');
    } else {
        html += '<p class="alerts-empty">No green alerts among live creatives.</p>';
    }

    html += `</div></div>`;

    alertsContainer.innerHTML = html;
}

// ---- Alerts Page ----
function renderAlertsPage() {
    const live = filteredData.filter(d => d.live === 'Live');

    const redAlerts = live.filter(d =>
        (d.signupCost > 1000) || (d.d0TrialCost > 3500)
    );

    const greenAlerts = live.filter(d =>
        (d.d6ROAS > 25) || (d.d0TrialCost > 0 && d.d0TrialCost < 2000)
    );

    const container = document.getElementById('alertsPageContent');
    if (!container) return;

    function alertMetricsRow(d) {
        return `<div class="alert-metrics">
            <div class="alert-metric"><span class="alert-metric-label">Spend</span><span class="alert-metric-value">${formatINR(d.spent)}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">CPI</span><span class="alert-metric-value" style="color:${cpiColor(d.cpi)}">${d.cpi ? '₹' + Math.round(d.cpi) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">CTR</span><span class="alert-metric-value">${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Installs</span><span class="alert-metric-value">${d.installs || '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Signups</span><span class="alert-metric-value">${d.signups || '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Signup Cost</span><span class="alert-metric-value">${d.signupCost ? '₹' + Math.round(d.signupCost) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Signup%</span><span class="alert-metric-value">${d.signupPct ? d.signupPct.toFixed(1) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">P0P1 Cost</span><span class="alert-metric-value">${d.p0p1Cost ? '₹' + Math.round(d.p0p1Cost) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">D0 Trial Cost</span><span class="alert-metric-value">${d.d0TrialCost ? '₹' + Math.round(d.d0TrialCost) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">D0 CAC</span><span class="alert-metric-value">${d.d0CAC ? '₹' + Math.round(d.d0CAC) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">D6 CAC</span><span class="alert-metric-value">${d.d6CAC ? '₹' + Math.round(d.d6CAC) : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">D6 ROAS</span><span class="alert-metric-value" style="color:${roasColor(d.d6ROAS)}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Overall ROAS</span><span class="alert-metric-value" style="color:${roasColor(d.overallROAS)}">${d.overallROAS ? d.overallROAS.toFixed(1) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Hook%</span><span class="alert-metric-value">${d.hook ? d.hook.toFixed(1) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Hold%</span><span class="alert-metric-value">${d.hold ? d.hold.toFixed(1) + '%' : '-'}</span></div>
            <div class="alert-metric"><span class="alert-metric-label">Perf.</span><span class="alert-metric-value">${perfBadge(d.testPerf)}</span></div>
        </div>`;
    }

    let html = '';

    // Red alerts panel
    html += `<div class="alerts-page-panel alerts-red">
        <div class="alerts-header">
            <span class="alerts-icon">&#9888;</span>
            <h3>Red Alerts</h3>
            <span class="alerts-count">${redAlerts.length}</span>
        </div>
        <div class="alerts-page-body">`;

    if (redAlerts.length) {
        html += redAlerts.map(d => {
            const reasons = [];
            if (d.signupCost > 1000) reasons.push(`Signup Cost: ₹${Math.round(d.signupCost)} (> ₹1,000)`);
            if (d.d0TrialCost > 3500) reasons.push(`D0 Trial Cost: ₹${Math.round(d.d0TrialCost)} (> ₹3,500)`);
            return `<div class="alert-page-item alert-item-red">
                <div class="alert-page-top">
                    <div>
                        <div class="alert-name">${shortName(d.name)}</div>
                        <div class="alert-reasons">${reasons.join(' | ')}</div>
                    </div>
                    <div style="display:flex;gap:4px;align-items:center;">
                        <span class="cc-badge ${d.type === 'Video' ? 'badge-video' : 'badge-static'}">${d.type}</span>
                        ${sourceBadge(d._source)}
                    </div>
                </div>
                ${alertMetricsRow(d)}
            </div>`;
        }).join('');
    } else {
        html += '<p class="alerts-empty">No red alerts. All live creatives within thresholds.</p>';
    }

    html += `</div></div>`;

    // Green alerts panel
    html += `<div class="alerts-page-panel alerts-green">
        <div class="alerts-header">
            <span class="alerts-icon">&#10004;</span>
            <h3>Green Alerts</h3>
            <span class="alerts-count">${greenAlerts.length}</span>
        </div>
        <div class="alerts-page-body">`;

    if (greenAlerts.length) {
        html += greenAlerts.map(d => {
            const reasons = [];
            if (d.d6ROAS > 25) reasons.push(`D6 ROAS: ${d.d6ROAS.toFixed(1)}% (> 25%)`);
            if (d.d0TrialCost > 0 && d.d0TrialCost < 2000) reasons.push(`D0 Trial Cost: ₹${Math.round(d.d0TrialCost)} (< ₹2,000)`);
            return `<div class="alert-page-item alert-item-green">
                <div class="alert-page-top">
                    <div>
                        <div class="alert-name">${shortName(d.name)}</div>
                        <div class="alert-reasons">${reasons.join(' | ')}</div>
                    </div>
                    <div style="display:flex;gap:4px;align-items:center;">
                        <span class="cc-badge ${d.type === 'Video' ? 'badge-video' : 'badge-static'}">${d.type}</span>
                        ${sourceBadge(d._source)}
                    </div>
                </div>
                ${alertMetricsRow(d)}
            </div>`;
        }).join('');
    } else {
        html += '<p class="alerts-empty">No green alerts among live creatives.</p>';
    }

    html += `</div></div>`;

    container.innerHTML = html;
}

// ---- Live Creatives Dashboard ----
function renderLiveDashboard() {
    const live = filteredData.filter(d => d.live === 'Live');

    const liveSpend = live.reduce((s, d) => s + d.spent, 0);
    const liveInstalls = live.reduce((s, d) => s + d.installs, 0);
    const liveSignups = live.reduce((s, d) => s + d.signups, 0);
    const liveCPI = live.filter(d => d.cpi > 0);
    const avgLiveCPI = liveCPI.length ? liveCPI.reduce((s, d) => s + d.cpi, 0) / liveCPI.length : 0;
    const liveCTR = live.filter(d => d.ctr > 0);
    const avgLiveCTR = liveCTR.length ? liveCTR.reduce((s, d) => s + d.ctr, 0) / liveCTR.length : 0;
    const liveROAS = live.filter(d => d.d6ROAS > 0);
    const avgLiveROAS = liveROAS.length ? liveROAS.reduce((s, d) => s + d.d6ROAS, 0) / liveROAS.length : 0;
    const liveHook = live.filter(d => d.hook > 0);
    const avgLiveHook = liveHook.length ? liveHook.reduce((s, d) => s + d.hook, 0) / liveHook.length : 0;

    document.getElementById('liveKpiCount').textContent = live.length;
    document.getElementById('liveKpiCountSub').textContent = `${live.filter(d => d.type === 'Video').length} video, ${live.filter(d => d.type === 'Static').length} static`;
    document.getElementById('liveKpiSpend').textContent = formatINR(liveSpend);
    document.getElementById('liveKpiSpendSub').textContent = `Avg ${formatINR(liveSpend / (live.length || 1))} per creative`;
    document.getElementById('liveKpiInstalls').textContent = formatNum(liveInstalls);
    document.getElementById('liveKpiInstallsSub').textContent = `${formatNum(liveSignups)} signups`;
    document.getElementById('liveKpiCPI').textContent = avgLiveCPI ? '₹' + Math.round(avgLiveCPI) : '--';
    document.getElementById('liveKpiCPISub').textContent = `Across ${liveCPI.length} creatives`;
    document.getElementById('liveKpiCTR').textContent = avgLiveCTR ? avgLiveCTR.toFixed(2) + '%' : '--';
    document.getElementById('liveKpiCTRSub').textContent = `Across ${liveCTR.length} creatives`;
    document.getElementById('liveKpiSignups').textContent = formatNum(liveSignups);
    document.getElementById('liveKpiSignupsSub').textContent = liveInstalls ? `${((liveSignups / liveInstalls) * 100).toFixed(1)}% of installs` : '';
    document.getElementById('liveKpiROAS').textContent = avgLiveROAS ? avgLiveROAS.toFixed(1) + '%' : '--';
    document.getElementById('liveKpiROASSub').textContent = `Across ${liveROAS.length} creatives`;
    document.getElementById('liveKpiHook').textContent = avgLiveHook ? avgLiveHook.toFixed(1) + '%' : '--';
    document.getElementById('liveKpiHookSub').textContent = `Across ${liveHook.length} videos`;

    // Live table
    document.getElementById('liveCreativesTable').innerHTML = live.length ? `
        <table>
            <thead><tr>
                <th>#</th><th>Creative</th><th>Type</th><th>Date</th><th>Spend</th><th>CTR</th><th>CPI</th><th>Installs</th><th>Signups</th><th>Signup%</th><th>Hook%</th><th>Hold%</th><th>D6 ROAS</th><th>Overall ROAS</th><th>Signup Cost</th><th>P0P1 Cost</th><th>D0 Trial Cost</th><th>D0 CAC</th><th>D6 CAC</th><th>Perf.</th><th>Source</th>
            </tr></thead>
            <tbody>${live.map((d, i) => `<tr>
                <td>${i + 1}</td>
                <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${d.name}">${shortName(d.name)}</td>
                <td><span class="cc-badge ${d.type === 'Video' ? 'badge-video' : 'badge-static'}">${d.type}</span></td>
                <td>${d.date || '-'}</td>
                <td>${formatINR(d.spent)}</td>
                <td>${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</td>
                <td style="color:${cpiColor(d.cpi)}">${d.cpi ? '₹' + Math.round(d.cpi) : '-'}</td>
                <td>${d.installs || '-'}</td>
                <td>${d.signups || '-'}</td>
                <td>${d.signupPct ? d.signupPct.toFixed(1) + '%' : '-'}</td>
                <td>${d.hook ? d.hook.toFixed(1) + '%' : '-'}</td>
                <td>${d.hold ? d.hold.toFixed(1) + '%' : '-'}</td>
                <td style="color:${roasColor(d.d6ROAS)}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</td>
                <td style="color:${roasColor(d.overallROAS)}">${d.overallROAS ? d.overallROAS.toFixed(1) + '%' : '-'}</td>
                <td>${d.signupCost ? '₹' + Math.round(d.signupCost) : '-'}</td>
                <td>${d.p0p1Cost ? '₹' + Math.round(d.p0p1Cost) : '-'}</td>
                <td>${d.d0TrialCost ? '₹' + Math.round(d.d0TrialCost) : '-'}</td>
                <td>${d.d0CAC ? '₹' + Math.round(d.d0CAC) : '-'}</td>
                <td>${d.d6CAC ? '₹' + Math.round(d.d6CAC) : '-'}</td>
                <td>${perfBadge(d.testPerf)}</td>
                <td>${sourceBadge(d._source)}</td>
            </tr>`).join('')}</tbody>
        </table>
    ` : '<p style="color:var(--text-dim);padding:20px;">No live creatives found.</p>';

    // Live top ROAS
    const liveTopROAS = [...live].filter(d => d.d6ROAS > 0).sort((a, b) => b.d6ROAS - a.d6ROAS).slice(0, 5);
    document.getElementById('liveTopROAS').innerHTML = liveTopROAS.length ? liveTopROAS.map((d, i) => `
        <div class="rank-item">
            <span class="rank-num">#${i + 1}</span>
            <div class="rank-info">
                <div class="rank-name">${shortName(d.name)}</div>
                <div class="rank-meta">${d.type} | Spend: ${formatINR(d.spent)}</div>
            </div>
            <span class="rank-value">${d.d6ROAS.toFixed(0)}%</span>
        </div>
    `).join('') : '<p style="color:var(--text-dim);">No ROAS data yet.</p>';

    // Live top CPI
    const liveTopCPI = [...live].filter(d => d.cpi > 0 && d.installs >= 5).sort((a, b) => a.cpi - b.cpi).slice(0, 5);
    document.getElementById('liveTopCPI').innerHTML = liveTopCPI.length ? liveTopCPI.map((d, i) => `
        <div class="rank-item">
            <span class="rank-num">#${i + 1}</span>
            <div class="rank-info">
                <div class="rank-name">${shortName(d.name)}</div>
                <div class="rank-meta">${d.type} | Installs: ${formatNum(d.installs)}</div>
            </div>
            <span class="rank-value" style="color:var(--teal)">₹${Math.round(d.cpi)}</span>
        </div>
    `).join('') : '<p style="color:var(--text-dim);">No CPI data yet.</p>';
}

// ---- All Creatives Table ----
function renderTable() {
    const data = filteredData;
    document.getElementById('tableCount').textContent = `${data.length} creatives`;
    const thead = document.querySelector('#creativesTable thead');
    const tbody = document.querySelector('#creativesTable tbody');
    const cols = ['#', 'Name', 'Type', 'Date', 'Spend', 'Impr.', 'CPM', 'CTR', 'Installs', 'CPI', 'Signups', 'Signup%', 'Hook%', 'Hold%', 'D6 ROAS', 'Overall ROAS', 'Signup Cost', 'P0P1 Cost', 'D0 Trial Cost', 'D0 CAC', 'D6 CAC', 'Status', 'Perf.', 'Source'];
    thead.innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`;
    tbody.innerHTML = data.map((d, i) => `<tr>
        <td>${i + 1}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis" title="${d.name}">${shortName(d.name)}</td>
        <td><span class="cc-badge ${d.type === 'Video' ? 'badge-video' : 'badge-static'}">${d.type || '-'}</span></td>
        <td>${d.date || '-'}</td>
        <td>${formatINR(d.spent)}</td>
        <td>${formatNum(d.impressions)}</td>
        <td>${d.cpm ? Math.round(d.cpm) : '-'}</td>
        <td>${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</td>
        <td>${d.installs || '-'}</td>
        <td style="color:${cpiColor(d.cpi)}">${d.cpi ? '₹' + Math.round(d.cpi) : '-'}</td>
        <td>${d.signups || '-'}</td>
        <td>${d.signupPct ? d.signupPct.toFixed(1) + '%' : '-'}</td>
        <td>${d.hook ? d.hook.toFixed(1) + '%' : '-'}</td>
        <td>${d.hold ? d.hold.toFixed(1) + '%' : '-'}</td>
        <td style="color:${roasColor(d.d6ROAS)}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</td>
        <td style="color:${roasColor(d.overallROAS)}">${d.overallROAS ? d.overallROAS.toFixed(1) + '%' : '-'}</td>
        <td>${d.signupCost ? '₹' + Math.round(d.signupCost) : '-'}</td>
        <td>${d.p0p1Cost ? '₹' + Math.round(d.p0p1Cost) : '-'}</td>
        <td>${d.d0TrialCost ? '₹' + Math.round(d.d0TrialCost) : '-'}</td>
        <td>${d.d0CAC ? '₹' + Math.round(d.d0CAC) : '-'}</td>
        <td>${d.d6CAC ? '₹' + Math.round(d.d6CAC) : '-'}</td>
        <td><span class="cc-badge ${d.live === 'Live' ? 'badge-live' : 'badge-paused'}">${d.live}</span></td>
        <td>${perfBadge(d.testPerf)}</td>
        <td>${sourceBadge(d._source)}</td>
    </tr>`).join('');
}

// ---- New This Week ----
function renderNew() {
    const maxWeek = Math.max(...allData.map(d => parseInt(d.week) || 0));
    const maxYear = Math.max(...allData.map(d => parseInt(d.year) || 0));
    const newOnes = filteredData.filter(d => (parseInt(d.week) === maxWeek && parseInt(d.year) === maxYear));
    const container = document.getElementById('newCreativeCards');
    if (!newOnes.length) {
        container.innerHTML = '<p style="color:var(--text-dim);">No new creatives found for the latest week.</p>';
        return;
    }
    container.innerHTML = newOnes.map(d => creativeCard(d)).join('');
}

// ---- Top Performers ----
function renderTop() {
    const top = [...filteredData]
        .filter(d => d.spent > 15000)
        .sort((a, b) => {
            const scoreA = computeScore(a);
            const scoreB = computeScore(b);
            return scoreB - scoreA;
        }).slice(0, 20);
    document.getElementById('topCreativeCards').innerHTML = top.map(d => creativeCard(d, true)).join('');
}

// ---- Failures ----
function renderFailures() {
    const fails = filteredData.filter(d =>
        d.testPerf === 'Failed' || d.testPerf === 'Drop' ||
        (d.spent > 20000 && d.signups === 0) ||
        (d.spent > 50000 && d.d6ROAS === 0)
    );
    document.getElementById('failureCreativeCards').innerHTML = fails.length
        ? fails.map(d => creativeCard(d)).join('')
        : '<p style="color:var(--text-dim);">No underperformers found with current filters.</p>';
}

// ---- Scorecard ----
function renderScorecardView() {
    const select = document.getElementById('scorecardSelect');
    if (select.options.length <= 1) {
        select.innerHTML = '<option value="">Select a creative...</option>' +
            allData.map((d, i) => `<option value="${i}">${d.name}</option>`).join('');
    }
}

document.getElementById('scorecardSelect')?.addEventListener('change', (e) => {
    const idx = parseInt(e.target.value);
    if (isNaN(idx)) return;
    renderScorecard(allData[idx]);
});

function renderScorecard(d) {
    const container = document.getElementById('scorecardContent');
    const metrics = [
        { label: 'CPM', value: d.cpm, format: v => '₹' + Math.round(v), rate: rateCPM },
        { label: 'CTR', value: d.ctr, format: v => v.toFixed(2) + '%', rate: rateCTR },
        { label: 'CPI', value: d.cpi, format: v => '₹' + Math.round(v), rate: rateCPI },
        { label: 'Signup %', value: d.signupPct, format: v => v.toFixed(1) + '%', rate: rateSignup },
        { label: 'Hook %', value: d.hook, format: v => v.toFixed(1) + '%', rate: rateHook },
        { label: 'Hold %', value: d.hold, format: v => v.toFixed(1) + '%', rate: rateHold },
        { label: 'Full Play %', value: d.fullPlay, format: v => v.toFixed(1) + '%', rate: rateFullPlay },
        { label: 'D6 ROAS', value: d.d6ROAS, format: v => v.toFixed(1) + '%', rate: rateROAS },
        { label: 'Overall ROAS', value: d.overallROAS, format: v => v.toFixed(1) + '%', rate: rateOverallROAS }
    ];

    const score = computeScore(d);
    const grade = score >= 80 ? 'EXCEPTIONAL' : score >= 60 ? 'GOOD' : score >= 40 ? 'AVERAGE' : 'POOR';
    const gradeColor = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--blue)' : score >= 40 ? 'var(--orange)' : 'var(--red)';

    container.innerHTML = `
        <div class="sc-overall" style="margin-bottom:20px;">
            <div class="sc-overall-score" style="color:${gradeColor}">${Math.round(score)}/100</div>
            <div class="sc-overall-label">${grade} | ${d.type} | Spend: ${formatINR(d.spent)}</div>
        </div>
        <div class="scorecard-grid">
            ${metrics.map(m => {
                const r = m.value > 0 ? m.rate(m.value) : 'N/A';
                return `<div class="sc-metric">
                    <div class="sc-label">${m.label}</div>
                    <div class="sc-value">${m.value > 0 ? m.format(m.value) : '-'}</div>
                    <span class="sc-rating ${r !== 'N/A' ? 'rating-' + r.toLowerCase() : ''}">${r}</span>
                </div>`;
            }).join('')}
        </div>
    `;
}

// ---- Scoring ----
function computeScore(d) {
    let score = 0;
    let factors = 0;
    if (d.cpi > 0) { score += scoreCPI(d.cpi); factors++; }
    if (d.ctr > 0) { score += scoreCTR(d.ctr); factors++; }
    if (d.signupPct > 0) { score += scoreSignup(d.signupPct); factors++; }
    if (d.d6ROAS > 0) { score += scoreROAS(d.d6ROAS) * 2; factors += 2; }
    if (d.hook > 0) { score += scoreHook(d.hook); factors++; }
    if (d.hold > 0) { score += scoreHold(d.hold); factors++; }
    return factors > 0 ? score / factors : 0;
}

function scoreCPI(v) { return v < 300 ? 100 : v < 500 ? 75 : v < 800 ? 50 : 25; }
function scoreCTR(v) { return v > 0.7 ? 100 : v > 0.5 ? 75 : v > 0.3 ? 50 : 25; }
function scoreSignup(v) { return v > 45 ? 100 : v > 25 ? 75 : v > 10 ? 50 : 25; }
function scoreROAS(v) { return v > 50 ? 100 : v > 25 ? 75 : v > 10 ? 50 : 25; }
function scoreHook(v) { return v > 30 ? 100 : v > 20 ? 75 : v > 12 ? 50 : 25; }
function scoreHold(v) { return v > 40 ? 100 : v > 25 ? 75 : v > 15 ? 50 : 25; }

function rateCPM(v) { return v < 100 ? 'Exceptional' : v < 200 ? 'Good' : v < 350 ? 'Average' : 'Poor'; }
function rateCTR(v) { return v > 0.7 ? 'Exceptional' : v > 0.5 ? 'Good' : v > 0.3 ? 'Average' : 'Poor'; }
function rateCPI(v) { return v < 300 ? 'Exceptional' : v < 500 ? 'Good' : v < 800 ? 'Average' : 'Poor'; }
function rateSignup(v) { return v > 45 ? 'Exceptional' : v > 25 ? 'Good' : v > 10 ? 'Average' : 'Poor'; }
function rateHook(v) { return v > 30 ? 'Exceptional' : v > 20 ? 'Good' : v > 12 ? 'Average' : 'Poor'; }
function rateHold(v) { return v > 40 ? 'Exceptional' : v > 25 ? 'Good' : v > 15 ? 'Average' : 'Poor'; }
function rateFullPlay(v) { return v > 10 ? 'Exceptional' : v > 5 ? 'Good' : v > 3 ? 'Average' : 'Poor'; }
function rateROAS(v) { return v > 50 ? 'Exceptional' : v > 25 ? 'Good' : v > 10 ? 'Average' : 'Poor'; }
function rateOverallROAS(v) { return v > 60 ? 'Exceptional' : v > 35 ? 'Good' : v > 15 ? 'Average' : 'Poor'; }

// ---- Helpers ----
function shortName(name) {
    return (name || '').replace(/^FB_MOF_(Video_|Static_)?/, '').replace(/_/g, ' ');
}

function parseDate(str) {
    if (!str) return 0;
    const parts = str.split('/');
    if (parts.length === 3) return new Date(parts[2], parts[1] - 1, parts[0]).getTime();
    return new Date(str).getTime() || 0;
}

function cpiColor(v) {
    if (!v) return 'var(--text-dim)';
    return v < 300 ? 'var(--green)' : v < 500 ? 'var(--blue)' : v < 800 ? 'var(--orange)' : 'var(--red)';
}

function roasColor(v) {
    if (!v) return 'var(--text-dim)';
    return v > 50 ? 'var(--green)' : v > 25 ? 'var(--blue)' : v > 10 ? 'var(--orange)' : 'var(--red)';
}

function perfBadge(perf) {
    if (!perf) return '<span style="color:var(--text-muted)">-</span>';
    const cls = {
        Exceptional: 'badge-exceptional', Performed: 'badge-performed',
        Try: 'badge-try', Failed: 'badge-failed', Drop: 'badge-drop'
    };
    return `<span class="cc-badge ${cls[perf] || ''}">${perf}</span>`;
}

function sourceBadge(source) {
    if (source === 'merged') return '<span class="cc-badge badge-merged">MERGED</span>';
    if (source === 'meta') return '<span class="cc-badge badge-meta">META</span>';
    return '<span class="cc-badge badge-sheets">SHEETS</span>';
}

function creativeCard(d, showScore = false) {
    const score = computeScore(d);
    return `
        <div class="creative-card">
            <div class="cc-header">
                <div>
                    <div class="cc-name">${shortName(d.name)}</div>
                    ${showScore ? `<div style="margin-top:4px;font-size:11px;color:var(--text-muted)">Score: <strong style="color:${score >= 70 ? 'var(--green)' : score >= 50 ? 'var(--blue)' : 'var(--orange)'}">${Math.round(score)}/100</strong></div>` : ''}
                </div>
                <div style="display:flex;gap:4px;">
                    <span class="cc-badge ${d.type === 'Video' ? 'badge-video' : 'badge-static'}">${d.type}</span>
                    ${perfBadge(d.testPerf)}
                </div>
            </div>
            <div class="cc-metrics">
                <div class="cc-metric"><div class="cc-metric-label">Spend</div><div class="cc-metric-value">${formatINR(d.spent)}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">CPI</div><div class="cc-metric-value" style="color:${cpiColor(d.cpi)}">${d.cpi ? '₹' + Math.round(d.cpi) : '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">CTR</div><div class="cc-metric-value">${d.ctr ? d.ctr.toFixed(2) + '%' : '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">Signups</div><div class="cc-metric-value">${d.signups || '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">D6 ROAS</div><div class="cc-metric-value" style="color:${roasColor(d.d6ROAS)}">${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">${d.type === 'Video' ? 'Hook%' : 'Signup%'}</div><div class="cc-metric-value">${d.type === 'Video' ? (d.hook ? d.hook.toFixed(1) + '%' : '-') : (d.signupPct ? d.signupPct.toFixed(1) + '%' : '-')}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">Signup Cost</div><div class="cc-metric-value">${d.signupCost ? '₹' + Math.round(d.signupCost) : '-'}</div></div>
                <div class="cc-metric"><div class="cc-metric-label">D0 Trial Cost</div><div class="cc-metric-value">${d.d0TrialCost ? '₹' + Math.round(d.d0TrialCost) : '-'}</div></div>
            </div>
            <div class="cc-date">${d.date || ''} | <span class="cc-badge ${d.live === 'Live' ? 'badge-live' : 'badge-paused'}">${d.live}</span> ${sourceBadge(d._source)}</div>
        </div>
    `;
}

function showLoading(show) {
    document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}

// ---- CSV Export ----
document.getElementById('exportBtn')?.addEventListener('click', () => {
    const headers = ['Name', 'Type', 'Date', 'Spend', 'Impressions', 'CPM', 'CTR', 'Installs', 'CPI', 'Signups', 'Signup Cost', 'Signup%', 'Hook%', 'Hold%', 'D6 ROAS', 'Overall ROAS', 'P0P1', 'P0P1%', 'P0P1 Cost', 'D0 Trials', 'D0 Trial Cost', 'D0', 'D0 CAC', 'D6 CAC', 'Status', 'Performance', 'Source'];
    const csvRows = [headers.join(',')];
    filteredData.forEach(d => {
        csvRows.push([
            `"${d.name}"`, d.type, d.date, d.spent, d.impressions, d.cpm,
            d.ctr, d.installs, d.cpi, d.signups, d.signupCost, d.signupPct,
            d.hook, d.hold, d.d6ROAS, d.overallROAS, d.p0p1, d.p0p1Pct, d.p0p1Cost, d.d0Trials, d.d0TrialCost, d.d0, d.d0CAC, d.d6CAC, d.live, d.testPerf, d._source
        ].join(','));
    });
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'creative_data_export.csv';
    a.click();
});

// ---- Event Listeners ----
document.getElementById('searchInput').addEventListener('input', () => renderCurrentView());
document.getElementById('typeFilter').addEventListener('change', () => renderCurrentView());
document.getElementById('statusFilter').addEventListener('change', () => renderCurrentView());
document.getElementById('perfFilter').addEventListener('change', () => renderCurrentView());
document.getElementById('sourceFilter').addEventListener('change', () => renderCurrentView());
// Flatpickr calendar date pickers
function initDatePickers() {
    if (typeof flatpickr === 'undefined') {
        // Fallback: use change events if flatpickr not loaded
        document.getElementById('dateFrom').addEventListener('change', () => renderCurrentView());
        document.getElementById('dateTo').addEventListener('change', () => renderCurrentView());
        return;
    }
    const fpConfig = {
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd M Y',
        theme: 'dark',
        allowInput: false,
        onChange: () => renderCurrentView()
    };
    flatpickr('#dateFrom', fpConfig);
    flatpickr('#dateTo', fpConfig);
}
initDatePickers();
document.getElementById('clearDates').addEventListener('click', () => {
    const fromEl = document.getElementById('dateFrom');
    const toEl = document.getElementById('dateTo');
    if (fromEl._flatpickr) { fromEl._flatpickr.clear(); } else { fromEl.value = ''; }
    if (toEl._flatpickr) { toEl._flatpickr.clear(); } else { toEl.value = ''; }
    renderCurrentView();
});
document.getElementById('refreshBtn').addEventListener('click', fetchData);

// ---- Meta Ads Integration ----
const META_ACCESS_TOKEN = 'EAAHDBv0GZCRYBQyK7aPCLInqIH1BCZAl5p3CLHZAngLOWT00ZAcXe84uW9CHogplylkwyovDH9473hg6CMEArA9ZAyR6wKJK3MIrLvb9YHqQDiLVSDw08MMSEBu5kucQr9TNZClZATU8FvB8XHVHuDyEKzZBhjFYA4saidojpVmZAQYpwd1ukGsGkuCvg56MDLwZDZD';
const META_AD_ACCOUNT_ID = 'act_725019929189148';
const TARGET_CAMPAIGNS = [
    'Test2-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_051225',
    'Test-Campaign_FB_MOF_Manual-App_Android_Pro-Sub_Pan-India_131125'
];
let metaData = [];
let metaUserName = '';
let metaConnected = false;
let metaCampaignIds = []; // { id, name } pairs

function getMetaDateRange() {
    const rangeEl = document.getElementById('metaDateRange');
    const range = rangeEl ? rangeEl.value : 'last_30d';
    const now = new Date();
    const end = now.toISOString().split('T')[0];
    let start;
    switch (range) {
        case 'last_7d': start = new Date(now - 7 * 86400000); break;
        case 'last_14d': start = new Date(now - 14 * 86400000); break;
        case 'last_90d': start = new Date(now - 90 * 86400000); break;
        default: start = new Date(now - 30 * 86400000);
    }
    return { since: start.toISOString().split('T')[0], until: end };
}

// Step 1: Look up campaign IDs by name
async function fetchTargetCampaignIds() {
    const url = `https://graph.facebook.com/v21.0/${META_AD_ACCOUNT_ID}/campaigns?fields=id,name&limit=100&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`;
    const allCampaigns = await fetchMetaPage(url, []);
    const matched = allCampaigns.filter(c => TARGET_CAMPAIGNS.includes(c.name.trim()));
    console.log(`Meta: found ${matched.length}/${TARGET_CAMPAIGNS.length} target campaigns`, matched.map(c => c.name));
    if (!matched.length) throw new Error('No target campaigns found in this ad account');
    return matched.map(c => ({ id: c.id, name: c.name }));
}

// Step 2: Fetch ads from a specific campaign
async function fetchAdsFromCampaign(campaignId) {
    const { since, until } = getMetaDateRange();
    const fields = 'name,status,created_time,campaign_id,campaign{name},creative{title,body,thumbnail_url},insights.time_range({"since":"' + since + '","until":"' + until + '"}){spend,impressions,cpm,clicks,ctr,actions,cost_per_action_type,video_thruplay_watched_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions}';
    const url = `https://graph.facebook.com/v21.0/${campaignId}/ads?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`;
    return fetchMetaPage(url, []);
}

// Main Meta fetch: validate token, find campaigns, fetch ads
async function fetchMetaData() {
    try {
        // Validate token & get user info
        const meResp = await fetch(`https://graph.facebook.com/me?access_token=${encodeURIComponent(META_ACCESS_TOKEN)}`);
        const meData = await meResp.json();
        if (meData.error) {
            console.error('Meta token invalid:', meData.error.message);
            updateMetaStatus(false, meData.error.message);
            return;
        }
        metaUserName = meData.name || 'Connected';
        metaConnected = true;

        // Find target campaign IDs
        metaCampaignIds = await fetchTargetCampaignIds();

        // Fetch ads from all target campaigns in parallel
        const adArrays = await Promise.all(
            metaCampaignIds.map(c => fetchAdsFromCampaign(c.id))
        );
        const allAds = adArrays.flat();

        // Find campaign name for each ad
        const campaignNameMap = {};
        metaCampaignIds.forEach(c => { campaignNameMap[c.id] = c.name; });

        metaData = allAds.map(ad => normalizeMetaAd(ad, campaignNameMap));
        console.log(`Meta: loaded ${metaData.length} ads from ${metaCampaignIds.length} campaigns`);

        // Merge with sheets data
        mergeDataSources();

        updateMetaStatus(true);
        renderCurrentView();
    } catch (err) {
        console.error('Meta fetch error:', err);
        updateMetaStatus(false, err.message);
    }
}

function updateMetaStatus(connected, errorMsg) {
    const statusEl = document.getElementById('metaAccountStatus');
    const detailsEl = document.getElementById('metaAccountDetails');
    const connectBtn = document.getElementById('metaConnectBtn');
    const disconnectBtn = document.getElementById('metaDisconnectBtn');
    const fetchBtn = document.getElementById('metaFetchBtn');

    if (!statusEl) return;

    if (connected) {
        statusEl.innerHTML = '<span class="status-dot connected"></span><span class="status-text">Connected as ' + metaUserName + '</span>';
        detailsEl.style.display = 'block';
        connectBtn.style.display = 'none';
        disconnectBtn.style.display = 'inline-block';
        fetchBtn.style.display = 'inline-block';
        fetchBtn.textContent = 'Refresh Meta Data';
        fetchBtn.disabled = false;
        document.getElementById('metaUserName').textContent = metaUserName;
        document.getElementById('metaCreativeCount').textContent = metaData.length;
        const campaignInfoEl = document.getElementById('metaCampaignInfo');
        if (campaignInfoEl) {
            campaignInfoEl.textContent = metaCampaignIds.length + ' targeted (' + metaCampaignIds.map(c => c.name.split('_')[0]).join(', ') + ')';
        }
        const matchedEl = document.getElementById('metaMatchedCount');
        if (matchedEl) {
            matchedEl.textContent = allData.filter(d => d._source === 'merged').length;
        }
    } else {
        statusEl.innerHTML = '<span class="status-dot disconnected"></span><span class="status-text">Error: ' + (errorMsg || 'Not connected') + '</span>';
        detailsEl.style.display = 'none';
        connectBtn.style.display = 'inline-block';
        disconnectBtn.style.display = 'none';
        fetchBtn.style.display = 'none';
    }
}

function metaConnect() {
    fetchMetaData();
}

function metaDisconnect() {
    allData = sheetsData.slice();
    metaData = [];
    metaConnected = false;
    updateMetaStatus(false, 'Disconnected');
    renderCurrentView();
}

function metaFetchAds() {
    const fetchBtn = document.getElementById('metaFetchBtn');
    if (fetchBtn) {
        fetchBtn.textContent = 'Fetching...';
        fetchBtn.disabled = true;
    }
    fetchMetaData();
}

// Generic paginated Meta API fetch
function fetchMetaPage(url, accumulated) {
    return fetch(url)
        .then(r => r.json())
        .then(data => {
            if (data.error) throw new Error(data.error.message);
            const items = accumulated.concat(data.data || []);
            if (data.paging && data.paging.next && items.length < 500) {
                return fetchMetaPage(data.paging.next, items);
            }
            return items;
        });
}

function normalizeMetaAd(ad, campaignNameMap) {
    const insights = (ad.insights && ad.insights.data && ad.insights.data[0]) || {};
    const actions = insights.actions || [];

    const getAction = (type) => {
        const a = actions.find(x => x.action_type === type);
        return a ? parseFloat(a.value) : 0;
    };

    const installs = getAction('app_install') || getAction('omni_app_install');
    const signups = getAction('complete_registration') || getAction('omni_complete_registration');
    const spendRaw = parseFloat(insights.spend) || 0;
    const spend = spendRaw * 1.18; // 18% tax multiplier
    const impressions = parseFloat(insights.impressions) || 0;
    const clicks = parseFloat(insights.clicks) || 0;

    const isVideo = ad.name && (ad.name.toLowerCase().includes('video') || ad.name.includes('VID'));
    const isActive = ad.status === 'ACTIVE';

    let dateStr = '';
    if (ad.created_time) {
        const dt = new Date(ad.created_time);
        dateStr = dt.toLocaleDateString('en-GB');
    }

    const campaignName = (ad.campaign && ad.campaign.name) || (campaignNameMap && campaignNameMap[ad.campaign_id]) || '';

    return {
        sno: 0,
        type: isVideo ? 'Video' : 'Static',
        name: ad.name || 'Untitled Ad',
        date: dateStr,
        spent: spend,
        impressions: impressions,
        cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
        clicks: clicks,
        ctr: parseFloat(insights.ctr) || 0,
        installs: installs,
        cpi: installs > 0 ? spend / installs : 0,
        signups: signups,
        signupCost: signups > 0 ? spend / signups : 0,
        signupPct: installs > 0 ? (signups / installs) * 100 : 0,
        d6: 0,
        d6CAC: 0,
        d6ROAS: 0,
        overallROAS: 0,
        overallRevenue: 0,
        p0p1: 0,
        p0p1Pct: 0,
        p0p1Cost: 0,
        d0Trials: 0,
        d0TrialCost: 0,
        d0: 0,
        d0CAC: 0,
        hook: 0,
        hold: 0,
        fullPlay: 0,
        thruPlays: parseFloat((insights.video_thruplay_watched_actions || [{}])[0].value) || 0,
        threeSecViews: 0,
        nextSteps: '',
        live: isActive ? 'Live' : 'Paused',
        testPerf: '',
        week: '',
        year: '',
        campaignId: ad.campaign_id || '',
        campaignName: campaignName,
        _raw: ad,
        _source: 'meta'
    };
}

function renderAccountsView() {
    updateMetaStatus(metaConnected, metaConnected ? null : 'Click Connect to fetch');
    const campaignInfoEl = document.getElementById('metaCampaignInfo');
    const matchedEl = document.getElementById('metaMatchedCount');
    if (campaignInfoEl) {
        campaignInfoEl.textContent = metaCampaignIds.length
            ? metaCampaignIds.map(c => c.name.split('_')[0]).join(', ')
            : TARGET_CAMPAIGNS.length + ' targeted';
    }
    if (matchedEl) {
        matchedEl.textContent = allData.filter(d => d._source === 'merged').length;
    }
}

// ---- Init ----
async function init() {
    await fetchData();
    fetchMetaData();
}
init();
