const SHEET_ID = '15cUn1ykWCttlk4G1y2SvT2yKoceRqsHRYJEnWeqzEIk';
const SHEET_NAME = 'Creative Performance Tracker-Auto';

let allData = [];
let filteredData = [];
let sheetsData = []; // Preserved copy of sheets-only data for merging

const META_ADS_DUMP_SHEET = 'Meta Ads Dump';
const METABASE_IMPORT_SHEET = 'Metabase Meta Ad Level Import';

let metaAdsDumpRaw = []; // Raw rows from 'Meta Ads Dump' tab
let metabaseImportRaw = []; // Raw rows from 'Metabase Meta Ad Level Import' tab

// ---- Data Fetch using Google Visualization JSONP (bypasses CORS) ----
async function fetchData() {
    showLoading(true);
    try {
        // Load main sheet first (fast, small)
        const mainData = await fetchViaJSONP();
        allData = mainData;
        normalizeData();
        document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();
        applyFilters();
        renderCurrentView();
        showLoading(false);

        // Then load raw data tabs in background (large, slower)
        console.log('Loading raw data tabs in background...');
        Promise.all([
            fetchSheetTab(META_ADS_DUMP_SHEET).catch(e => { console.warn('Meta Ads Dump fetch failed:', e); return []; }),
            fetchSheetTab(METABASE_IMPORT_SHEET).catch(e => { console.warn('Metabase Import fetch failed:', e); return []; })
        ]).then(([adsDump, metabaseImport]) => {
            metaAdsDumpRaw = adsDump;
            metabaseImportRaw = metabaseImport;
            console.log(`Raw tabs loaded: ${adsDump.length} ads dump rows, ${metabaseImport.length} metabase rows`);
            // Build fast lookup indexes (used when date filter is applied)
            buildRawIndexes();
        });
    } catch (err) {
        console.error('Fetch error:', err);
        document.getElementById('loadingOverlay').innerHTML = `
            <p style="color:var(--red);">Failed to load data: ${err.message}</p>
            <p style="font-size:11px;color:var(--text-muted);margin-top:8px;">Make sure the sheet is shared as "Anyone with the link"</p>
            <button onclick="fetchData()" style="margin-top:12px;padding:8px 20px;background:var(--accent);border:none;color:white;border-radius:6px;cursor:pointer;">Retry</button>
        `;
        return;
    }
}

function fetchViaJSONP() {
    return new Promise((resolve, reject) => {
        const callbackName = 'sheetCallback_' + Date.now();
        const script = document.createElement('script');
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('Request timed out'));
        }, 60000);

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

function fetchSheetTab(sheetName) {
    return new Promise((resolve, reject) => {
        const callbackName = 'sheetCb_' + sheetName.replace(/\W/g, '') + '_' + Date.now();
        const script = document.createElement('script');
        const timeout = setTimeout(() => { cleanup(); reject(new Error('Timeout fetching ' + sheetName)); }, 90000);
        function cleanup() { clearTimeout(timeout); delete window[callbackName]; if (script.parentNode) script.parentNode.removeChild(script); }
        window[callbackName] = function(response) {
            cleanup();
            try { resolve(parseGvizResponse(response, true)); } catch(e) { reject(e); }
        };
        const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json;responseHandler:${callbackName}&sheet=${encodeURIComponent(sheetName)}`;
        script.src = url;
        script.onerror = () => { cleanup(); reject(new Error('Failed to load ' + sheetName)); };
        document.body.appendChild(script);
    });
}

function parseGvizResponse(response, useRawValues) {
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
                if (useRawValues) {
                    // For raw data tabs: use raw value (v) for numbers/dates
                    // Convert gviz Date(y,m,d) strings to ISO format
                    let val = cell.v;
                    if (typeof val === 'string' && val.startsWith('Date(')) {
                        const parts = val.match(/Date\((\d+),(\d+),(\d+)/);
                        if (parts) val = `${parts[1]}-${String(+parts[2]+1).padStart(2,'0')}-${parts[3].padStart(2,'0')}`;
                    }
                    obj[key] = val != null ? val : '';
                } else {
                    // For main sheet: prefer formatted value (f) for display
                    obj[key] = cell.f != null ? String(cell.f) : (cell.v != null ? String(cell.v) : '');
                }
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
    console.log('Available keys:', Object.keys(allData[0]));

    // Get date filter values for aggregation
    const dateFromEl = document.getElementById('dateFrom');
    const dateToEl = document.getElementById('dateTo');
    const dateFrom = dateFromEl ? dateFromEl.value : '';
    const dateTo = dateToEl ? dateToEl.value : '';
    const hasRawData = metaAdsDumpRaw.length > 0 || metabaseImportRaw.length > 0;

    allData = allData.map((d, idx) => {
        const get = (keys) => {
            for (const k of keys) {
                for (const h of Object.keys(d)) {
                    if (h.toLowerCase().includes(k.toLowerCase()) && d[h]) return d[h];
                }
            }
            return '';
        };

        const liveRaw = d['Live?'] || '';
        const isLive = liveRaw.toLowerCase() === 'live';
        const creativeName = get(['Creative']) || `Row ${idx + 1}`;

        // Base record from main sheet (metadata only)
        const record = {
            sno: idx + 1,
            type: d['_Type'] || get(['Type']) || detectType(creativeName),
            name: creativeName,
            date: get(['Date - Go', 'Go Live']),
            startDate: get(['Start date', 'Test Metrics']),
            endDate: get(['End Date']),
            maturedDate: get(['Matured Date']),
            live: isLive ? 'Live' : 'Paused',
            testPerf: get(['Test Perf']),
            nextSteps: get(['Next']),
            week: d['Week'] || get(['Week']),
            year: d['Year'] || get(['Year']),
            _raw: d,
            _source: 'sheets'
        };

        // Always start with pre-aggregated values from main sheet
        record.spent = parseNum(get(['Spent']));
        record.impressions = parseNum(get(['Impr']));
        record.cpm = parseNum(get(['CPM']));
        record.clicks = parseNum(get(['Click']));
        record.ctr = parsePercent(get(['CTR']));
        record.installs = parseNum(get(['Install']));
        record.cpi = parseNum(get(['CPI']));
        record.signups = parseNum(get(['Signup']));
        record.signupCost = parseNum(get(['Signup Cost']));
        record.signupPct = parsePercent(get(['Signup%']));
        record.d6 = parseNum(get(['D6 ']));
        record.d6CAC = parseNum(get(['D6 CAC']));
        record.d6ROAS = parsePercent(get(['D6 ROAS']));
        record.overallROAS = parsePercent(get(['Overall ROAS']));
        record.overallRevenue = parseNum(get(['Overall revenue']));
        record.p0p1 = parseNum(get(['P0P1']));
        record.p0p1Pct = parsePercent(get(['P0P1%']));
        record.p0p1Cost = parseNum(get(['P0P1 Cost']));
        record.d0Trials = parseNum(get(['D0_Trial', 'D0 Trial']));
        record.d0TrialCost = parseNum(get(['D0 Trial Cost']));
        record.d0 = parseNum(get(['D0']));
        record.d0CAC = parseNum(get(['D0 CAC']));
        record.hook = parsePercent(get(['Hook']));
        record.hold = parsePercent(get(['Hold']));
        record.fullPlay = parsePercent(get(['Full']));
        record.thruPlays = parseNum(get(['ThruPlay']));
        record.threeSecViews = parseNum(get(['3-Sec', '3 Sec']));
        record.maturedSpend = parseNum(get(['Matured spends']));
        record.d6Matured = parseNum(get(['D6 matured']));
        record.d6CACMatured = parseNum(get(['D6 CAC matured']));
        record.d6RevenueMatured = parseNum(get(['D6 revenue overall (matured)']));
        record.d6ROASMatured = parsePercent(get(['D6 ROAS overall (matured)']));
        record.overallRevenueMatured = parseNum(get(['Overall revenue matured']));
        record.overallROASMatured = parsePercent(get(['Overall ROAS matured']));

        // If raw data loaded AND date filter is active, override with aggregated values
        if (hasRawData && (dateFrom || dateTo)) {
            const agg = aggregateMetrics(creativeName, dateFrom, dateTo);
            if (agg.spent > 0 || agg.signups > 0 || agg.impressions > 0) {
                Object.assign(record, agg);
            }
            // Matured metrics from raw data
            if (record.maturedDate && record.startDate) {
                const toISO = (str) => {
                    const parts = str.split('/');
                    if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
                    return str;
                };
                const maturedFrom = parseDate(record.startDate) ? toISO(record.startDate) : '';
                const maturedTo = parseDate(record.maturedDate) ? toISO(record.maturedDate) : '';
                if (maturedFrom && maturedTo) {
                    const matAgg = aggregateMetrics(creativeName, maturedFrom, maturedTo);
                    if (matAgg.spent > 0 || matAgg.signups > 0) {
                        record.maturedSpend = matAgg.spent;
                        record.d6RevenueMatured = matAgg.d6OverallRevenue;
                        record.d6ROASMatured = matAgg.spent > 0 ? (matAgg.d6OverallRevenue / matAgg.spent * 100) : 0;
                        record.overallRevenueMatured = matAgg.overallRevenue;
                        record.overallROASMatured = matAgg.spent > 0 ? (matAgg.overallRevenue / matAgg.spent * 100) : 0;
                    }
                }
            }
        }
        return record;
    }).filter(d => d.name && d.name !== 'Row 0' && d.name.includes('FB_'));

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

// Pre-built lookup maps for fast aggregation (built once when raw data loads)
let adsDumpIndex = new Map();   // adName -> [{day, spend, impr, clicks, installs, thru, threeSec}]
let metabaseIndex = new Map();  // trackerName -> [{day, signups, p0, p1, d0Trial, d0, d6, ...}]

function buildRawIndexes() {
    console.time('buildRawIndexes');
    // Index Meta Ads Dump by Ad Name
    adsDumpIndex = new Map();
    metaAdsDumpRaw.forEach(row => {
        const adName = (row['Ad Name'] || '').trim().toLowerCase();
        if (!adName) return;
        const dayStr = row['Day'] || '';
        if (!dayStr) return;
        const dayTs = new Date(dayStr).getTime();
        if (isNaN(dayTs)) return;
        if (!adsDumpIndex.has(adName)) adsDumpIndex.set(adName, []);
        adsDumpIndex.get(adName).push({
            dayTs,
            spend: parseFloat(row['Amount Spent']) || 0,
            impr: parseFloat(row['Impressions']) || 0,
            clicks: parseFloat(row['Link Clicks']) || 0,
            installs: parseFloat(row['App Installs']) || 0,
            thru: parseFloat(row['ThruPlays']) || 0,
            threeSec: parseFloat(row['3-Second Video Views']) || 0
        });
    });

    // Index Metabase Import by tracker_name (only "Test" campaigns)
    metabaseIndex = new Map();
    metabaseImportRaw.forEach(row => {
        const campaign = row['campaign_name'] || '';
        if (!campaign.includes('Test')) return;
        const trackerName = (row['tracker_name'] || '').trim().toLowerCase();
        if (!trackerName) return;
        const dateStr = row['date'] || '';
        if (!dateStr) return;
        const dayTs = new Date(dateStr).getTime();
        if (isNaN(dayTs)) return;
        const pn = (v) => parseFloat(v) || 0;
        if (!metabaseIndex.has(trackerName)) metabaseIndex.set(trackerName, []);
        metabaseIndex.get(trackerName).push({
            dayTs,
            signups: pn(row['signups']),
            p0: pn(row['p0_signup']),
            p1: pn(row['p1_signup']),
            d0Trial: pn(row['d0_trial']),
            d0: pn(row['d0']),
            d0Revenue: pn(row['d0_revenue']),
            d6: pn(row['d0_2d_d6'] || row['d0-d6']),
            d6Revenue: pn(row['d0_2d_d6_revenue'] || row['d0-d6_revenue']),
            newConv: pn(row['new_converted_user']),
            newUserRev: pn(row['new_user_rev']),
            overallRev: pn(row['overall_revenue']),
            d6OverallCon: pn(row['d0_d6_overall']),
            d6OverallRev: pn(row['d0_d6_revenue_overall'])
        });
    });
    console.timeEnd('buildRawIndexes');
    console.log(`Indexed: ${adsDumpIndex.size} ad names, ${metabaseIndex.size} tracker names`);
}

function aggregateMetrics(creativeName, dateFrom, dateTo) {
    const nameNorm = creativeName.trim().toLowerCase();
    const fromTs = dateFrom ? new Date(dateFrom).getTime() : 0;
    const toTs = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : Infinity;

    // --- Meta Ads Dump (fast lookup) ---
    let spend = 0, impressions = 0, clicks = 0, installs = 0, thruPlays = 0, threeSecViews = 0;
    const adsRows = adsDumpIndex.get(nameNorm);
    if (adsRows) {
        for (const r of adsRows) {
            if (r.dayTs < fromTs || r.dayTs > toTs) continue;
            spend += r.spend;
            impressions += r.impr;
            clicks += r.clicks;
            installs += r.installs;
            thruPlays += r.thru;
            threeSecViews += r.threeSec;
        }
    }
    spend *= 1.18;
    thruPlays *= 1.18;
    threeSecViews *= 1.18;

    // --- Metabase Import (fast lookup) ---
    let signups = 0, p0 = 0, p1 = 0, d0Trials = 0, d0 = 0, d0Revenue = 0;
    let d6 = 0, d6Revenue = 0, newConversions = 0, newUserRev = 0, overallRevenue = 0;
    let d6OverallCon = 0, d6OverallRevenue = 0;
    const mbRows = metabaseIndex.get(nameNorm);
    if (mbRows) {
        for (const r of mbRows) {
            if (r.dayTs < fromTs || r.dayTs > toTs) continue;
            signups += r.signups;
            p0 += r.p0;
            p1 += r.p1;
            d0Trials += r.d0Trial;
            d0 += r.d0;
            d0Revenue += r.d0Revenue;
            d6 += r.d6;
            d6Revenue += r.d6Revenue;
            newConversions += r.newConv;
            newUserRev += r.newUserRev;
            overallRevenue += r.overallRev;
            d6OverallCon += r.d6OverallCon;
            d6OverallRevenue += r.d6OverallRev;
        }
    }
    const p0p1 = p0 + p1;

    return {
        spent: spend, impressions, clicks, installs, thruPlays, threeSecViews,
        cpm: impressions > 0 ? (spend / impressions * 1000) : 0,
        ctr: impressions > 0 ? (clicks / impressions) : 0,
        cpi: installs > 0 ? (spend / installs) : 0,
        hook: impressions > 0 ? (threeSecViews / impressions) : 0,
        hold: threeSecViews > 0 ? (thruPlays / threeSecViews) : 0,
        fullPlay: impressions > 0 ? (thruPlays / impressions) : 0,
        signups, p0p1, d0Trials, d0, d6, newConversions,
        overallRevenue, d6Revenue, d6OverallRevenue,
        signupCost: signups > 0 ? (spend / signups) : 0,
        signupPct: installs > 0 ? (signups / installs) : 0,
        p0p1Pct: signups > 0 ? (p0p1 / signups) : 0,
        p0p1Cost: p0p1 > 0 ? (spend / p0p1) : 0,
        d0TrialCost: d0Trials > 0 ? (spend / d0Trials) : 0,
        d0CAC: d0 > 0 ? (spend / d0) : 0,
        d6CAC: d6 > 0 ? (spend / d6) : 0,
        d6ROAS: spend > 0 ? (d6OverallRevenue / spend * 100) : 0,
        newUserCAC: newConversions > 0 ? (spend / newConversions) : 0,
        overallROAS: spend > 0 ? (overallRevenue / spend * 100) : 0
    };
}

// ---- Filters ----
function applyFilters() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const type = document.getElementById('typeFilter').value;
    const status = document.getElementById('statusFilter').value;
    const perf = document.getElementById('perfFilter').value;
    const source = document.getElementById('sourceFilter').value;
    filteredData = allData.filter(d => {
        if (search && !d.name.toLowerCase().includes(search)) return false;
        if (type !== 'all' && d.type !== type) return false;
        if (status !== 'all' && d.live !== status) return false;
        if (perf !== 'all' && d.testPerf !== perf) return false;
        // Date filter controls aggregation period (in normalizeData), not creative filtering
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
    accounts: { title: 'Accounts', subtitle: 'Manage connected ad platform accounts' },
    campaignTree: { title: 'Campaign Tree', subtitle: 'Hierarchical campaign → adset → ad analysis with alerts' }
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
    else if (view === 'campaignTree') { /* rendered on-demand via fetchCampaignTree */ }
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

// Shared alert classification logic
// Determine if a creative is "matured" (go-live 14+ days ago)
function isMatured(d) {
    const goLive = parseDate(d.date);
    if (!goLive) return false;
    const daysSinceGoLive = (Date.now() - goLive) / (1000 * 60 * 60 * 24);
    return daysSinceGoLive >= 14;
}

// Pick the right D6 CAC and D6 ROAS based on maturity
function getAlertMetrics(d) {
    if (isMatured(d)) {
        return {
            d6CAC: d.d6CACMatured || d.d6CAC,
            d6ROAS: d.d6ROASMatured || d.d6ROAS,
            label: 'Matured'
        };
    }
    return { d6CAC: d.d6CAC, d6ROAS: d.d6ROAS, label: 'Current' };
}

function classifyAlerts(creatives) {
    const eligible = creatives.filter(d => d.spent >= 15000);

    const redAlerts = eligible.filter(d => {
        const m = getAlertMetrics(d);
        // D6 ROAS > 28% = never red
        if (m.d6ROAS > 28) return false;
        // Count breaches: signup cost > 1000, d0 trial cost > 3500, d6 CAC > 15000
        let breaches = 0;
        if (d.signupCost > 1000) breaches++;
        if (d.d0TrialCost > 3500) breaches++;
        if (m.d6CAC > 15000) breaches++;
        return breaches >= 2;
    });

    const greenAlerts = eligible.filter(d => {
        const m = getAlertMetrics(d);
        // D6 ROAS > 28% = always green
        if (m.d6ROAS > 28) return true;
        // Count green hits: signup cost < 500, d0 trial cost < 2500, d6 CAC < 12000
        let hits = 0;
        if (d.signupCost > 0 && d.signupCost < 500) hits++;
        if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) hits++;
        if (m.d6CAC > 0 && m.d6CAC < 12000) hits++;
        return hits >= 2;
    });

    return { redAlerts, greenAlerts };
}

function getAlertReasons(d, type) {
    const reasons = [];
    const m = getAlertMetrics(d);
    const d6Label = m.label === 'Matured' ? 'D6 CAC (Mat.)' : 'D6 CAC';
    const roasLabel = m.label === 'Matured' ? 'D6 ROAS (Mat.)' : 'D6 ROAS';
    if (type === 'red') {
        if (d.signupCost > 1000) reasons.push(`Signup Cost: ₹${Math.round(d.signupCost)} (> ₹1,000)`);
        if (d.d0TrialCost > 3500) reasons.push(`D0 Trial Cost: ₹${Math.round(d.d0TrialCost)} (> ₹3,500)`);
        if (m.d6CAC > 15000) reasons.push(`${d6Label}: ₹${Math.round(m.d6CAC)} (> ₹15,000)`);
    } else {
        if (m.d6ROAS > 28) reasons.push(`${roasLabel}: ${m.d6ROAS.toFixed(1)}% (> 28%)`);
        if (d.signupCost > 0 && d.signupCost < 500) reasons.push(`Signup Cost: ₹${Math.round(d.signupCost)} (< ₹500)`);
        if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) reasons.push(`D0 Trial Cost: ₹${Math.round(d.d0TrialCost)} (< ₹2,500)`);
        if (m.d6CAC > 0 && m.d6CAC < 12000) reasons.push(`${d6Label}: ₹${Math.round(m.d6CAC)} (< ₹12,000)`);
    }
    return reasons;
}

function renderAlerts() {
    const live = filteredData.filter(d => d.live === 'Live');
    const { redAlerts, greenAlerts } = classifyAlerts(live);

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
            const reasons = getAlertReasons(d, 'red');
            return `<div class="alert-item alert-item-red">
                <div class="alert-name">${shortName(d.name)}</div>
                <div class="alert-reasons">${reasons.join(' | ')}</div>
                <div class="alert-extra">${d.type} | Spend: ${formatINR(d.spent)} | D6 ROAS: ${d.d6ROAS ? d.d6ROAS.toFixed(1) + '%' : '-'}</div>
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
            const reasons = getAlertReasons(d, 'green');
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
    const { redAlerts, greenAlerts } = classifyAlerts(live);

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
            const reasons = getAlertReasons(d, 'red');
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
            const reasons = getAlertReasons(d, 'green');
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
    const cols = ['#', 'Name', 'Type', 'Date', 'Spend', 'Impr.', 'CPM', 'CTR', 'Installs', 'CPI', 'Signups', 'Signup%', 'Hook%', 'Hold%', 'D6 ROAS', 'Overall ROAS', 'Signup Cost', 'P0P1 Cost', 'D0 Trial Cost', 'D0 CAC', 'D6 CAC', 'Mat. Spend', 'D6 Rev (Mat)', 'D6 ROAS (Mat)', 'Rev (Mat)', 'ROAS (Mat)', 'Status', 'Perf.', 'Source'];
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
        <td>${d.maturedSpend ? formatINR(d.maturedSpend) : '-'}</td>
        <td>${d.d6RevenueMatured ? formatINR(d.d6RevenueMatured) : '-'}</td>
        <td style="color:${roasColor(d.d6ROASMatured)}">${d.d6ROASMatured ? d.d6ROASMatured.toFixed(1) + '%' : '-'}</td>
        <td>${d.overallRevenueMatured ? formatINR(d.overallRevenueMatured) : '-'}</td>
        <td style="color:${roasColor(d.overallROASMatured)}">${d.overallROASMatured ? d.overallROASMatured.toFixed(1) + '%' : '-'}</td>
        <td><span class="cc-badge ${d.live === 'Live' ? 'badge-live' : 'badge-paused'}">${d.live}</span></td>
        <td>${perfBadge(d.testPerf)}</td>
        <td>${sourceBadge(d._source)}</td>
    </tr>`).join('');
}

// ---- New This Week ----
function renderNew() {
    // Show creatives that went live in the last 7 days (including today)
    const now = new Date();
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime();
    const newOnes = filteredData.filter(d => {
        const ts = parseDate(d.date);
        return ts && ts >= sevenDaysAgo;
    });
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
        document.getElementById('dateFrom').addEventListener('change', () => { normalizeData(); renderCurrentView(); });
        document.getElementById('dateTo').addEventListener('change', () => { normalizeData(); renderCurrentView(); });
        return;
    }
    const fpConfig = {
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd M Y',
        theme: 'dark',
        allowInput: false,
        onChange: () => { normalizeData(); renderCurrentView(); }
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
    normalizeData();
    renderCurrentView();
});
document.getElementById('refreshBtn').addEventListener('click', fetchData);

// ---- Meta Ads Integration ----
const META_ACCESS_TOKEN = 'EAAHDBv0GZCRYBQ79GPcDBCVPZCAbpSFyK0gMBr3MZAiwxS1ZABaTR1m52pYVzSznFzW7uAcmVMZAKQkUEEfau6hD4Lr2GHTIicKlAWTZCSN2pGR7jfhaqZAMePxj5B5FAnhsbnbZAkliHtFN8G3sz2ZB05b6HnwlVQlQZBwN60COYhjeIzYHY4Vg6PFMvQddtKAD0N';
const META_APP_SECRET_PROOF = 'bd732bb6efaa55bed93840ec4a3d302a3de1134a82fe698620890a703ab38388';
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
    const url = `https://graph.facebook.com/v21.0/${META_AD_ACCOUNT_ID}/campaigns?fields=id,name&limit=100&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}&appsecret_proof=${META_APP_SECRET_PROOF}`;
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
    const url = `https://graph.facebook.com/v21.0/${campaignId}/ads?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(META_ACCESS_TOKEN)}&appsecret_proof=${META_APP_SECRET_PROOF}`;
    return fetchMetaPage(url, []);
}

// Main Meta fetch: find campaigns, fetch ads
async function fetchMetaData() {
    try {
        metaUserName = 'App Connected';
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
    // Ensure appsecret_proof is on every request (pagination URLs may lack it)
    if (!url.includes('appsecret_proof')) {
        url += (url.includes('?') ? '&' : '?') + 'appsecret_proof=' + META_APP_SECRET_PROOF;
    }
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
    // Meta API fetch disabled — all data now comes from sheet tabs
    // (Meta Ads Dump + Metabase Meta Ad Level Import)
    // fetchMetaData();
}
init();

// =========================================================================
// CAMPAIGN TREE — Hierarchical campaign → adset → ad analysis
// =========================================================================
const TREE_SERVER = 'http://localhost:3000';

function dateToExcelSerial(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const epochDays = Date.UTC(y, m - 1, d) / 86400000;
    return Math.round(epochDays + 25569);
}

function buildMetaKey(dateStr, campaignName, adsetName, adName) {
    const serial = dateToExcelSerial(dateStr);
    return serial + campaignName + adsetName.toLowerCase().trim() + adName.replace(/:.*$/, '');
}

function buildMetabaseKey(dateStr, campaignName, adsetName, trackerName) {
    // Metabase dates come as ISO strings e.g. "2026-03-18T00:00:00+05:30"
    const d = dateStr.substring(0, 10);
    const serial = dateToExcelSerial(d);
    // adsetName is already lowered in the SQL
    return serial + campaignName + adsetName + trackerName;
}

window.fetchCampaignTree = async function () {
    const dateFrom = document.getElementById('treeDateFrom').value;
    const dateTo = document.getElementById('treeDateTo').value;
    const status = document.getElementById('treeStatus');
    const container = document.getElementById('treeContainer');
    const summaryEl = document.getElementById('treeSummary');
    const btn = document.getElementById('treeAnalyzeBtn');

    if (!dateFrom || !dateTo) { status.textContent = 'Please select both dates.'; return; }

    btn.disabled = true;
    status.textContent = 'Fetching data from Meta API + Metabase...';
    container.innerHTML = '';
    summaryEl.style.display = 'none';

    try {
        // Fetch both sources in parallel
        const [metaRes, funnelRes] = await Promise.all([
            fetch(`${TREE_SERVER}/api/meta/ad-insights-daily`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom, dateTo }),
            }).then(r => r.json()),
            fetch(`${TREE_SERVER}/api/metabase/ad-funnel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom, dateTo }),
            }).then(r => r.json()),
        ]);

        if (!metaRes.success) throw new Error('Meta API: ' + metaRes.error);
        if (!funnelRes.success) throw new Error('Metabase: ' + funnelRes.error);

        status.textContent = `Meta: ${metaRes.total} rows | Metabase: ${funnelRes.total} rows. Matching...`;

        // ── Step 1: Build daily Metabase lookup ──
        // Key = date(YYYY-MM-DD) + '|||' + campaign + '|||' + lowered(adset) + '|||' + tracker_name
        const mbDaily = {};
        for (const row of funnelRes.data) {
            const d = String(row.date).substring(0, 10); // "2026-03-18T00:00:00+05:30" → "2026-03-18"
            const key = d + '|||' + row.campaign_name + '|||' + row.ad_set_name + '|||' + row.tracker_name;
            if (!mbDaily[key]) {
                mbDaily[key] = { signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0, d6: 0, d6_revenue: 0, overall_revenue: 0, new_converted_user: 0, new_user_rev: 0, p0_signup: 0, p1_signup: 0, total_trial: 0, d6_overall_con: 0, d6_overall_revenue: 0 };
            }
            const m = mbDaily[key];
            m.signups += Number(row.signups) || 0;
            m.d0_trial += Number(row.d0_trial) || 0;
            m.d0 += Number(row.d0) || 0;
            m.d0_revenue += Number(row.d0_revenue) || 0;
            m.d6 += Number(row.d6) || 0;
            m.d6_revenue += Number(row.d6_revenue) || 0;
            m.overall_revenue += Number(row.overall_revenue) || 0;
            m.new_converted_user += Number(row.new_converted_user) || 0;
            m.new_user_rev += Number(row.new_user_rev) || 0;
            m.p0_signup += Number(row.p0_signup) || 0;
            m.p1_signup += Number(row.p1_signup) || 0;
            m.total_trial += Number(row.total_trial) || 0;
            m.d6_overall_con += Number(row.d6_overall_con) || 0;
            m.d6_overall_revenue += Number(row.d6_overall_revenue) || 0;
        }

        // ── Step 2: Match Meta daily rows to Metabase daily rows, aggregate into per-ad totals ──
        const adAgg = {};
        let matchedKeys = 0;
        let unmatchedKeys = 0;
        const matchedMbKeys = new Set();

        // Filter to Android only (Metabase query only has Android data)
        const metaRows = metaRes.data.filter(r => /android/i.test(r.campaign_name));
        console.log(`[Tree] Filtered to Android: ${metaRows.length}/${metaRes.data.length} Meta rows`);

        for (const row of metaRows) {
            const adUid = row.campaign_name + '|||' + row.adset_name + '|||' + row.ad_name;
            if (!adAgg[adUid]) {
                adAgg[adUid] = {
                    campaign_name: row.campaign_name, campaign_id: row.campaign_id,
                    adset_name: row.adset_name, adset_id: row.adset_id,
                    ad_name: row.ad_name, ad_id: row.ad_id,
                    spend: 0, impressions: 0, clicks: 0, installs: 0,
                    signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
                    d6: 0, d6_revenue: 0, overall_revenue: 0,
                    new_converted_user: 0, new_user_rev: 0,
                    p0_signup: 0, p1_signup: 0, total_trial: 0,
                    d6_overall_con: 0, d6_overall_revenue: 0,
                    _matched: false,
                };
            }
            const a = adAgg[adUid];

            // Sum Meta raw metrics
            a.spend += row.spend * 1.18; // tax adjustment
            a.impressions += row.impressions;
            a.clicks += row.clicks;
            a.installs += row.installs;

            // Try daily key match to Metabase
            const mbKey = row.date_start + '|||' + row.campaign_name + '|||' + row.adset_name.toLowerCase().trim() + '|||' + row.ad_name.replace(/:.*$/, '');
            const mb = mbDaily[mbKey];
            if (mb) {
                matchedKeys++;
                matchedMbKeys.add(mbKey);
                a._matched = true;
                a.signups += mb.signups;
                a.d0_trial += mb.d0_trial;
                a.d0 += mb.d0;
                a.d0_revenue += mb.d0_revenue;
                a.d6 += mb.d6;
                a.d6_revenue += mb.d6_revenue;
                a.overall_revenue += mb.overall_revenue;
                a.new_converted_user += mb.new_converted_user;
                a.new_user_rev += mb.new_user_rev;
                a.p0_signup += mb.p0_signup;
                a.p1_signup += mb.p1_signup;
                a.total_trial += mb.total_trial;
                a.d6_overall_con += mb.d6_overall_con;
                a.d6_overall_revenue += mb.d6_overall_revenue;
            } else {
                unmatchedKeys++;
            }
        }

        // ── Step 3: Add unmatched Metabase entries (no Meta spend) ──
        for (const [key, mb] of Object.entries(mbDaily)) {
            if (!matchedMbKeys.has(key)) {
                const parts = key.split('|||');
                const adUid = parts[1] + '|||' + parts[2] + '|||' + parts[3];
                if (!adAgg[adUid]) {
                    adAgg[adUid] = {
                        campaign_name: parts[1], campaign_id: '',
                        adset_name: parts[2], adset_id: '',
                        ad_name: parts[3], ad_id: '',
                        spend: 0, impressions: 0, clicks: 0, installs: 0,
                        signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
                        d6: 0, d6_revenue: 0, overall_revenue: 0,
                        new_converted_user: 0, new_user_rev: 0,
                        p0_signup: 0, p1_signup: 0, total_trial: 0,
                        d6_overall_con: 0, d6_overall_revenue: 0,
                        _matched: true,
                    };
                }
                const a = adAgg[adUid];
                a._matched = true;
                a.signups += mb.signups;
                a.d0_trial += mb.d0_trial;
                a.d0 += mb.d0;
                a.d0_revenue += mb.d0_revenue;
                a.d6 += mb.d6;
                a.d6_revenue += mb.d6_revenue;
                a.overall_revenue += mb.overall_revenue;
                a.new_converted_user += mb.new_converted_user;
                a.new_user_rev += mb.new_user_rev;
            }
        }

        const totalMbKeys = Object.keys(mbDaily).length;
        console.log(`[Tree] Meta rows: ${metaRows.length} (Android) | MB daily keys: ${totalMbKeys} | Matched: ${matchedKeys}/${matchedKeys + unmatchedKeys} | Unmatched MB: ${totalMbKeys - matchedMbKeys.size}`);

        // Filter by spend if checkbox is checked
        const spendOnly = document.getElementById('treeSpendFilter').checked;
        const adEntries = spendOnly ? Object.values(adAgg).filter(a => a.spend > 0) : Object.values(adAgg);

        // Compute derived metrics per ad
        const ads = adEntries.map(a => {
            const cpi = a.installs > 0 ? a.spend / a.installs : null;
            const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
            const signupCost = a.signups > 0 ? a.spend / a.signups : null;
            const d0TrialCost = a.d0_trial > 0 ? a.spend / a.d0_trial : null;
            const d6CAC = a.d6 > 0 ? a.spend / a.d6 : null;
            const d6ROAS = a.spend > 0 ? ((a.d6_overall_revenue || a.d6_revenue) / a.spend) * 100 : 0;
            const d6OverallCAC = a.d6_overall_con > 0 ? a.spend / a.d6_overall_con : null;
            const d6OverallROAS = a.spend > 0 ? (a.d6_overall_revenue / a.spend) * 100 : 0;
            return { ...a, cpi, ctr, signupCost, d0TrialCost, d6CAC, d6ROAS, d6OverallCAC, d6OverallROAS };
        });

        // Build tree: campaign → adset → ad
        const tree = {};
        for (const ad of ads) {
            if (!tree[ad.campaign_name]) {
                tree[ad.campaign_name] = { name: ad.campaign_name, id: ad.campaign_id, adsets: {}, totals: null };
            }
            const camp = tree[ad.campaign_name];
            if (!camp.adsets[ad.adset_name]) {
                camp.adsets[ad.adset_name] = { name: ad.adset_name, id: ad.adset_id, ads: [], totals: null };
            }
            camp.adsets[ad.adset_name].ads.push(ad);
        }

        // Aggregate totals at adset and campaign level
        function sumAds(adsList) {
            const t = { spend: 0, impressions: 0, clicks: 0, installs: 0, signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0, d6: 0, d6_revenue: 0, overall_revenue: 0, d6_overall_con: 0, d6_overall_revenue: 0 };
            for (const a of adsList) {
                t.spend += a.spend; t.impressions += a.impressions; t.clicks += a.clicks; t.installs += a.installs;
                t.signups += a.signups; t.d0_trial += a.d0_trial; t.d0 += a.d0; t.d0_revenue += a.d0_revenue;
                t.d6 += a.d6; t.d6_revenue += a.d6_revenue; t.overall_revenue += a.overall_revenue;
                t.d6_overall_con += a.d6_overall_con; t.d6_overall_revenue += a.d6_overall_revenue;
            }
            t.cpi = t.installs > 0 ? t.spend / t.installs : null;
            t.ctr = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0;
            t.signupCost = t.signups > 0 ? t.spend / t.signups : null;
            t.d0TrialCost = t.d0_trial > 0 ? t.spend / t.d0_trial : null;
            t.d6CAC = t.d6 > 0 ? t.spend / t.d6 : null;
            t.d6ROAS = t.spend > 0 ? ((t.d6_overall_revenue || t.d6_revenue) / t.spend) * 100 : 0;
            t.d6OverallCAC = t.d6_overall_con > 0 ? t.spend / t.d6_overall_con : null;
            t.d6OverallROAS = t.spend > 0 ? (t.d6_overall_revenue / t.spend) * 100 : 0;
            return t;
        }

        let totalSpend = 0, totalSignups = 0, totalD6 = 0, totalD6Rev = 0, totalInstalls = 0;
        let redCount = 0, greenCount = 0;

        for (const camp of Object.values(tree)) {
            const allCampAds = [];
            for (const adset of Object.values(camp.adsets)) {
                adset.ads.sort((a, b) => b.spend - a.spend);
                adset.totals = sumAds(adset.ads);
                allCampAds.push(...adset.ads);
            }
            camp.totals = sumAds(allCampAds);
            totalSpend += camp.totals.spend;
            totalSignups += camp.totals.signups;
            totalD6 += camp.totals.d6;
            totalD6Rev += camp.totals.d6_revenue;
            totalInstalls += camp.totals.installs;
        }

        // Classify alerts per ad
        function classifyTreeAlert(d) {
            if (d.spend < 15000) return 'neutral';
            // D6 ROAS > 28% = green
            if (d.d6ROAS > 28) return 'green';
            // Count breaches
            let breaches = 0;
            if (d.signupCost > 1000) breaches++;
            if (d.d0TrialCost > 3500) breaches++;
            if (d.d6CAC > 15000) breaches++;
            if (breaches >= 2) return 'red';
            // Count green hits
            let hits = 0;
            if (d.signupCost > 0 && d.signupCost < 500) hits++;
            if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) hits++;
            if (d.d6CAC > 0 && d.d6CAC < 12000) hits++;
            if (hits >= 2) return 'green';
            return 'neutral';
        }

        // Count alerts
        for (const ad of ads) {
            const alert = classifyTreeAlert(ad);
            if (alert === 'red') redCount++;
            else if (alert === 'green') greenCount++;
        }

        // Render summary
        const overallROAS = totalSpend > 0 ? (totalD6Rev / totalSpend * 100).toFixed(1) : '0';
        summaryEl.style.display = 'block';
        summaryEl.innerHTML = `
            <div class="tree-summary-cards">
                <div class="tree-summary-card"><div class="val" style="color:#6c5ce7;">${Object.keys(tree).length}</div><div class="lbl">Campaigns</div></div>
                <div class="tree-summary-card"><div class="val">${cur(totalSpend)}</div><div class="lbl">Total Spend</div></div>
                <div class="tree-summary-card"><div class="val">${num(totalInstalls)}</div><div class="lbl">Installs</div></div>
                <div class="tree-summary-card"><div class="val">${num(totalSignups)}</div><div class="lbl">Signups</div></div>
                <div class="tree-summary-card"><div class="val">${totalD6}</div><div class="lbl">D6 Conversions</div></div>
                <div class="tree-summary-card"><div class="val">${overallROAS}%</div><div class="lbl">D6 ROAS</div></div>
                <div class="tree-summary-card"><div class="val" style="color:#ef4444;">${redCount}</div><div class="lbl">Red Alerts</div></div>
                <div class="tree-summary-card"><div class="val" style="color:#10b981;">${greenCount}</div><div class="lbl">Green Alerts</div></div>
                <div class="tree-summary-card"><div class="val" style="color:#888;">${matchedKeys}/${matchedKeys + unmatchedKeys}</div><div class="lbl">Keys Matched</div></div>
            </div>`;

        // Render tree
        const sortedCampaigns = Object.values(tree).sort((a, b) => b.totals.spend - a.totals.spend);
        let html = '';
        for (const camp of sortedCampaigns) {
            const campAlert = classifyTreeAlert(camp.totals);
            html += renderTreeNode(camp.name, 'campaign', camp.totals, campAlert, () => {
                let inner = '';
                const sortedAdsets = Object.values(camp.adsets).sort((a, b) => b.totals.spend - a.totals.spend);
                for (const adset of sortedAdsets) {
                    const adsetAlert = classifyTreeAlert(adset.totals);
                    inner += renderTreeNode(adset.name, 'adset', adset.totals, adsetAlert, () => {
                        let adHtml = '';
                        for (const ad of adset.ads) {
                            const adAlert = classifyTreeAlert(ad);
                            const noFunnel = !ad._matched ? ' tree-no-funnel' : '';
                            adHtml += renderTreeNode(ad.ad_name, 'ad', ad, adAlert, null, noFunnel);
                        }
                        return adHtml;
                    });
                }
                return inner;
            });
        }
        container.innerHTML = html;

        status.textContent = `Done. ${Object.keys(tree).length} campaigns, ${ads.length} ads. ${matchedKeys} key matches, ${unmatchedKeys} unmatched.`;

    } catch (err) {
        status.textContent = 'Error: ' + err.message;
        console.error('Campaign tree error:', err);
    } finally {
        btn.disabled = false;
    }
};

function renderTreeNode(name, level, metrics, alertType, childrenFn, extraClass) {
    const id = 'tree-' + Math.random().toString(36).substr(2, 9);
    const hasChildren = !!childrenFn;
    const toggle = hasChildren ? `<span class="tree-toggle" onclick="toggleTreeNode('${id}')">&#9654;</span>` : '<span style="width:16px;display:inline-block;"></span>';
    const badge = alertType !== 'neutral' ? `<span class="tree-badge ${alertType}">${alertType === 'red' ? 'RED' : 'GREEN'}</span>` : '';

    const m = metrics;
    const metricsHtml = `
        <div class="tree-metrics">
            <div class="tree-metric"><div class="label">Spend</div><div class="value">${cur(m.spend)}</div></div>
            <div class="tree-metric"><div class="label">Installs</div><div class="value">${num(m.installs)}</div></div>
            <div class="tree-metric"><div class="label">CPI</div><div class="value">${m.cpi ? '₹' + Math.round(m.cpi) : '-'}</div></div>
            <div class="tree-metric"><div class="label">Signups</div><div class="value">${num(m.signups)}</div></div>
            <div class="tree-metric"><div class="label">SU Cost</div><div class="value" style="color:${m.signupCost ? (m.signupCost < 500 ? '#10b981' : m.signupCost > 1000 ? '#ef4444' : '#e0e0e0') : '#888'}">${m.signupCost ? '₹' + Math.round(m.signupCost) : '-'}</div></div>
            <div class="tree-metric"><div class="label">D0 Trial</div><div class="value">${m.d0TrialCost ? '₹' + Math.round(m.d0TrialCost) : '-'}</div></div>
            <div class="tree-metric"><div class="label">D6 CAC</div><div class="value" style="color:${m.d6CAC ? (m.d6CAC < 12000 ? '#10b981' : m.d6CAC > 15000 ? '#ef4444' : '#e0e0e0') : '#888'}">${m.d6CAC ? '₹' + Math.round(m.d6CAC) : '-'}</div></div>
            <div class="tree-metric"><div class="label">D6 ROAS</div><div class="value" style="color:${m.d6ROAS > 28 ? '#10b981' : m.d6ROAS > 0 ? '#ef4444' : '#888'}">${m.d6ROAS ? m.d6ROAS.toFixed(1) + '%' : '-'}</div></div>
        </div>`;

    const childrenHtml = hasChildren ? `<div class="tree-children collapsed" id="${id}-children">${childrenFn()}</div>` : '';

    return `<div class="tree-node${extraClass || ''}">
        <div class="tree-header ${level}" onclick="${hasChildren ? `toggleTreeNode('${id}')` : ''}">
            ${toggle}
            <span class="tree-name">${esc(name)}</span>
            ${badge}
            ${metricsHtml}
        </div>
        ${childrenHtml}
    </div>`;
}

window.toggleTreeNode = function (id) {
    const children = document.getElementById(id + '-children');
    if (!children) return;
    children.classList.toggle('collapsed');
    const header = children.previousElementSibling;
    const toggle = header.querySelector('.tree-toggle');
    if (toggle) toggle.classList.toggle('open');
};

// Helper formatters
function cur(v) { return '₹' + Math.round(v).toLocaleString('en-IN'); }
function curK(v) { return v >= 100000 ? '₹' + (v/100000).toFixed(1) + 'L' : v >= 1000 ? '₹' + (v/1000).toFixed(1) + 'K' : '₹' + Math.round(v); }
function num(v) { return v.toLocaleString('en-IN'); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// =========================================================================
// WEEKLY BREAKDOWN
// =========================================================================
function localDateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function getWeekBuckets() {
    const today = new Date(); today.setHours(12, 0, 0, 0); // noon to avoid DST issues
    const buckets = [];
    // Bucket 0: Today
    const todayStr = localDateStr(today);
    buckets.push({ label: 'Today', from: todayStr, to: todayStr, dates: new Set([todayStr]) });
    // Buckets 1-4: last 4 weeks (7 days each, going backwards from yesterday)
    for (let w = 0; w < 4; w++) {
        const endDay = new Date(today); endDay.setDate(endDay.getDate() - 1 - (w * 7));
        const startDay = new Date(endDay); startDay.setDate(startDay.getDate() - 6);
        const dates = new Set();
        for (const dt = new Date(startDay); dt <= endDay; dt.setDate(dt.getDate() + 1)) {
            dates.add(localDateStr(dt));
        }
        const fromStr = localDateStr(startDay);
        const toStr = localDateStr(endDay);
        const fmtFrom = startDay.getDate() + ' ' + startDay.toLocaleString('en', { month: 'short' });
        const fmtTo = endDay.getDate() + ' ' + endDay.toLocaleString('en', { month: 'short' });
        buckets.push({ label: fmtFrom + ' - ' + fmtTo, from: fromStr, to: toStr, dates });
    }
    return buckets;
}

function emptyRaw() {
    return { spend: 0, impressions: 0, clicks: 0, installs: 0, signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0, d6: 0, d6_revenue: 0, overall_revenue: 0, d6_overall_con: 0, d6_overall_revenue: 0 };
}

function deriveMetrics(r) {
    return {
        ...r,
        cpi: r.installs > 0 ? r.spend / r.installs : null,
        signupCost: r.signups > 0 ? r.spend / r.signups : null,
        d0TrialCost: r.d0_trial > 0 ? r.spend / r.d0_trial : null,
        d6CAC: r.d6 > 0 ? r.spend / r.d6 : null,
        d6ROAS: r.spend > 0 ? ((r.d6_overall_revenue || r.d6_revenue) / r.spend) * 100 : 0,
        overallROAS: r.spend > 0 ? (r.overall_revenue / r.spend) * 100 : 0,
    };
}

function sumRawBuckets(items, bucketCount) {
    const result = [];
    for (let b = 0; b < bucketCount; b++) {
        const sum = emptyRaw();
        for (const item of items) {
            const src = item.buckets[b];
            for (const k of Object.keys(sum)) sum[k] += src[k] || 0;
        }
        result.push(sum);
    }
    return result;
}

window.fetchWeeklyBreakdown = async function () {
    const status = document.getElementById('treeStatus');
    const treeContainer = document.getElementById('treeContainer');
    const weeklyContainer = document.getElementById('weeklyTreeContainer');
    const btn = document.getElementById('weeklyBtn');

    btn.disabled = true;
    treeContainer.style.display = 'none';
    weeklyContainer.style.display = 'block';
    weeklyContainer.innerHTML = '';
    document.getElementById('treeSummary').style.display = 'none';
    status.textContent = 'Fetching last 28 days + today...';

    const buckets = getWeekBuckets();
    const dateFrom = buckets[buckets.length - 1].from; // oldest week start
    const dateTo = buckets[0].to; // today

    try {
        // Fetch Meta + Metabase for EACH bucket in parallel (5 buckets × 2 sources = 10 calls)
        // Each Meta call is aggregated (no time_increment=1), so returns 1 row per ad per bucket
        status.textContent = 'Fetching 5 weekly buckets from Meta + Metabase...';

        const bucketResults = await Promise.all(buckets.map(async (bkt, idx) => {
            const [metaRes, mbRes] = await Promise.all([
                fetch(`${TREE_SERVER}/api/meta/ad-insights-daily`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dateFrom: bkt.from, dateTo: bkt.to }),
                }).then(r => r.json()),
                fetch(`${TREE_SERVER}/api/metabase/ad-funnel`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dateFrom: bkt.from, dateTo: bkt.to }),
                }).then(r => r.json()),
            ]);
            console.log(`[Weekly] Bucket ${idx} (${bkt.label}): Meta=${metaRes.total || 0} MB=${mbRes.total || 0}`);
            return { meta: metaRes, mb: mbRes, bucketIdx: idx };
        }));

        // Build per-ad bucketed data + direct campaign/adset Metabase aggregates
        const adWeekly = {};
        const campMB = {};   // campaign → buckets (direct from Metabase)
        const adsetMB = {};  // campaign|||adset → buckets (direct from Metabase)
        let matched = 0, unmatched = 0;

        function addMBToRaw(target, row) {
            target.signups += Number(row.signups) || 0;
            target.d0_trial += Number(row.d0_trial) || 0;
            target.d0 += Number(row.d0) || 0;
            target.d0_revenue += Number(row.d0_revenue) || 0;
            target.d6 += Number(row.d6) || 0;
            target.d6_revenue += Number(row.d6_revenue) || 0;
            target.overall_revenue += Number(row.overall_revenue) || 0;
            target.d6_overall_con += Number(row.d6_overall_con) || 0;
            target.d6_overall_revenue += Number(row.d6_overall_revenue) || 0;
        }

        for (const { meta, mb, bucketIdx } of bucketResults) {
            if (!meta.success || !mb.success) continue;

            // ── Direct Metabase aggregates by campaign and adset (no ad-level matching) ──
            for (const row of mb.data) {
                // Campaign level
                if (!campMB[row.campaign_name]) campMB[row.campaign_name] = buckets.map(() => emptyRaw());
                addMBToRaw(campMB[row.campaign_name][bucketIdx], row);
                // Adset level
                const asKey = row.campaign_name + '|||' + row.ad_set_name;
                if (!adsetMB[asKey]) adsetMB[asKey] = buckets.map(() => emptyRaw());
                addMBToRaw(adsetMB[asKey][bucketIdx], row);
            }

            // ── Ad-level: Meta spend + matched Metabase funnel ──
            const mbLookup = {};
            for (const row of mb.data) {
                const key = row.campaign_name + '|||' + row.ad_set_name + '|||' + row.tracker_name;
                if (!mbLookup[key]) mbLookup[key] = emptyRaw();
                addMBToRaw(mbLookup[key], row);
            }

            const metaRows = meta.data.filter(r => /android/i.test(r.campaign_name));
            const metaByAd = {};
            for (const row of metaRows) {
                const adUid = row.campaign_name + '|||' + row.adset_name + '|||' + row.ad_name;
                if (!metaByAd[adUid]) {
                    metaByAd[adUid] = { ...row, spend: 0, impressions: 0, clicks: 0, installs: 0 };
                }
                metaByAd[adUid].spend += row.spend;
                metaByAd[adUid].impressions += row.impressions;
                metaByAd[adUid].clicks += row.clicks;
                metaByAd[adUid].installs += row.installs;
            }

            for (const [adUid, row] of Object.entries(metaByAd)) {
                if (!adWeekly[adUid]) {
                    adWeekly[adUid] = {
                        campaign_name: row.campaign_name, adset_name: row.adset_name, ad_name: row.ad_name,
                        campaign_id: row.campaign_id, adset_id: row.adset_id, ad_id: row.ad_id,
                        buckets: buckets.map(() => emptyRaw()),
                    };
                }
                const b = adWeekly[adUid].buckets[bucketIdx];
                b.spend += row.spend * 1.18;
                b.impressions += row.impressions;
                b.clicks += row.clicks;
                b.installs += row.installs;

                const mbKey = row.campaign_name + '|||' + row.adset_name.toLowerCase().trim() + '|||' + row.ad_name.replace(/:.*$/, '');
                const mbRow = mbLookup[mbKey];
                if (mbRow) {
                    matched++;
                    addMBToRaw(b, mbRow);
                } else { unmatched++; }
            }
        }

        // Filter spend-only if checked
        const spendOnly = document.getElementById('treeSpendFilter').checked;
        const adList = Object.values(adWeekly).filter(a => !spendOnly || a.buckets.some(b => b.spend > 0));

        // Build tree: campaign → adset → ad
        const tree = {};
        for (const ad of adList) {
            if (!tree[ad.campaign_name]) tree[ad.campaign_name] = { name: ad.campaign_name, adsets: {} };
            const camp = tree[ad.campaign_name];
            if (!camp.adsets[ad.adset_name]) camp.adsets[ad.adset_name] = { name: ad.adset_name, ads: [] };
            camp.adsets[ad.adset_name].ads.push(ad);
        }

        // Campaign/adset buckets: use Meta spend from ads + direct Metabase funnel (not ad rollup)
        for (const camp of Object.values(tree)) {
            // Campaign: sum Meta spend from ads, funnel from direct Metabase
            const spendBuckets = sumRawBuckets(Object.values(camp.adsets).flatMap(as => as.ads), buckets.length);
            const mbBuckets = campMB[camp.name] || buckets.map(() => emptyRaw());
            camp.buckets = spendBuckets.map((sb, i) => ({
                ...mbBuckets[i],
                spend: sb.spend, impressions: sb.impressions, clicks: sb.clicks, installs: sb.installs,
            }));

            for (const adset of Object.values(camp.adsets)) {
                adset.ads.sort((a, b) => b.buckets.reduce((s, x) => s + x.spend, 0) - a.buckets.reduce((s, x) => s + x.spend, 0));
                const asSpendBuckets = sumRawBuckets(adset.ads, buckets.length);
                const asKey = camp.name + '|||' + adset.name.toLowerCase().trim();
                const asMbBuckets = adsetMB[asKey] || buckets.map(() => emptyRaw());
                adset.buckets = asSpendBuckets.map((sb, i) => ({
                    ...asMbBuckets[i],
                    spend: sb.spend, impressions: sb.impressions, clicks: sb.clicks, installs: sb.installs,
                }));
            }
        }

        // Sort campaigns by total spend
        const sortedCampaigns = Object.values(tree).sort((a, b) =>
            b.buckets.reduce((s, x) => s + x.spend, 0) - a.buckets.reduce((s, x) => s + x.spend, 0));

        // Metric column headers (shared for all weekly tables)
        const metricCols = ['Spend', 'Installs', 'CPI', 'Signups', 'SU Cost', 'D0 Trial', 'D6', 'D6 CAC', 'D6 ROAS'];

        // Render tree: campaign → (weekly rows + adsets) → (weekly rows + ads) → weekly rows
        let html = '';
        for (const camp of sortedCampaigns) {
            const totalSpend = camp.buckets.reduce((s, b) => s + b.spend, 0);
            const totalSignups = camp.buckets.reduce((s, b) => s + b.signups, 0);
            const cId = 'wk-' + Math.random().toString(36).substr(2, 8);
            html += wkHeader(camp.name, 'campaign', totalSpend, totalSignups, cId);
            html += `<div class="wk-children collapsed" id="${cId}-children">`;
            html += wkTable(camp.buckets, buckets, metricCols);
            // Adsets
            const sortedAdsets = Object.values(camp.adsets).sort((a, b) =>
                b.buckets.reduce((s, x) => s + x.spend, 0) - a.buckets.reduce((s, x) => s + x.spend, 0));
            for (const adset of sortedAdsets) {
                const asSpend = adset.buckets.reduce((s, b) => s + b.spend, 0);
                const asSignups = adset.buckets.reduce((s, b) => s + b.signups, 0);
                const aId = 'wk-' + Math.random().toString(36).substr(2, 8);
                html += wkHeader(adset.name, 'adset', asSpend, asSignups, aId);
                html += `<div class="wk-children collapsed" id="${aId}-children">`;
                html += wkTable(adset.buckets, buckets, metricCols);
                // Ads
                for (const ad of adset.ads) {
                    const adSpend = ad.buckets.reduce((s, b) => s + b.spend, 0);
                    const adSignups = ad.buckets.reduce((s, b) => s + b.signups, 0);
                    const adNodeId = 'wk-' + Math.random().toString(36).substr(2, 8);
                    html += wkHeader(ad.ad_name, 'ad', adSpend, adSignups, adNodeId);
                    html += `<div class="wk-children collapsed" id="${adNodeId}-children">`;
                    html += wkTable(ad.buckets, buckets, metricCols);
                    html += '</div>';
                }
                html += '</div>';
            }
            html += '</div>';
        }

        weeklyContainer.innerHTML = html;
        status.textContent = `Weekly: ${sortedCampaigns.length} campaigns, ${adList.length} ads. Matched: ${matched}/${matched + unmatched}`;

    } catch (err) {
        status.textContent = 'Error: ' + err.message;
        console.error('Weekly breakdown error:', err);
    } finally {
        btn.disabled = false;
    }
};

function wkHeader(name, level, totalSpend, totalSignups, nodeId) {
    return `<div class="tree-header ${level}" onclick="toggleTreeNode('${nodeId}')">
        <span class="tree-toggle">&#9654;</span>
        <span class="tree-name">${esc(name)}</span>
        <div class="tree-metrics">
            <div class="tree-metric"><div class="label">Spend</div><div class="value">${cur(totalSpend)}</div></div>
            <div class="tree-metric"><div class="label">Signups</div><div class="value">${num(totalSignups)}</div></div>
        </div>
    </div>`;
}

function wkTable(rawBuckets, bucketDefs, metricCols) {
    let html = '<table class="wk-tbl"><thead><tr><th class="wk-tbl-period">Period</th>';
    for (const col of metricCols) html += `<th>${col}</th>`;
    html += '</tr></thead><tbody>';
    for (let i = 0; i < rawBuckets.length; i++) {
        const raw = rawBuckets[i];
        const m = deriveMetrics(raw);
        const label = bucketDefs[i].label;
        const roasColor = m.d6ROAS > 28 ? '#10b981' : m.d6ROAS > 0 ? '#ef4444' : '#888';
        const suCostColor = m.signupCost ? (m.signupCost < 500 ? '#10b981' : m.signupCost > 1000 ? '#ef4444' : '#e0e0e0') : '#888';
        const d6CACColor = m.d6CAC ? (m.d6CAC < 12000 ? '#10b981' : m.d6CAC > 15000 ? '#ef4444' : '#e0e0e0') : '#888';
        html += `<tr>
            <td class="wk-tbl-period">${label}</td>
            <td>${raw.spend > 0 ? curK(raw.spend) : '-'}</td>
            <td>${raw.installs || '-'}</td>
            <td>${m.cpi ? '₹' + Math.round(m.cpi) : '-'}</td>
            <td>${raw.signups || '-'}</td>
            <td style="color:${suCostColor}">${m.signupCost ? '₹' + Math.round(m.signupCost) : '-'}</td>
            <td>${raw.d0_trial || '-'}</td>
            <td>${raw.d6 || '-'}</td>
            <td style="color:${d6CACColor}">${m.d6CAC ? '₹' + Math.round(m.d6CAC) : '-'}</td>
            <td style="color:${roasColor}">${m.d6ROAS ? m.d6ROAS.toFixed(1) + '%' : '-'}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    return html;
}
