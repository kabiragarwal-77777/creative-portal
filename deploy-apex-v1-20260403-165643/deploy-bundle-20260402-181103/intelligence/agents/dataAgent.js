const axios = require('axios');
const Papa = require('papaparse');
const { db, getAll, getOne, run, getRowCount } = require('../db');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SHEET_ID = '15cUn1ykWCttlk4G1y2SvT2yKoceRqsHRYJEnWeqzEIk';
const SHEETS = {
  main:     'Creative Performance Tracker-Auto',
  metaDump: 'Meta Ads Dump',
  metabase: 'Metabase Meta Ad Level Import',
};

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // exponential backoff base

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a value like "₹1,234.56", "45.2%", plain numbers, empty strings, etc.
 * Returns a float or 0.
 */
function parseNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const cleaned = String(val)
    .replace(/₹/g, '')
    .replace(/,/g, '')
    .replace(/%/g, '')
    .replace(/\s/g, '')
    .trim();
  if (cleaned === '' || cleaned === '-' || cleaned === 'N/A' || cleaned === 'NA') return 0;
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Parse various date formats → ISO date string (YYYY-MM-DD) or null.
 * Handles DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, and JS-parseable strings.
 */
function parseDate(val) {
  if (!val || typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed || trimmed === '-' || trimmed === 'N/A') return null;

  // Try ISO first (YYYY-MM-DD or full ISO)
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slashMatch) {
    const [, a, b, year] = slashMatch;
    const dayFirst = parseInt(a, 10);
    const monthFirst = parseInt(b, 10);

    // If first part > 12 it must be day
    if (dayFirst > 12) {
      const d = new Date(`${year}-${String(monthFirst).padStart(2, '0')}-${String(dayFirst).padStart(2, '0')}`);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    // If second part > 12 it must be day → first is month (MM/DD/YYYY)
    if (monthFirst > 12) {
      const d = new Date(`${year}-${String(dayFirst).padStart(2, '0')}-${String(monthFirst).padStart(2, '0')}`);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    // Ambiguous – assume DD/MM/YYYY (common in India)
    const d = new Date(`${year}-${String(monthFirst).padStart(2, '0')}-${String(dayFirst).padStart(2, '0')}`);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  // Fallback: let JS parse it
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);

  return null;
}

function nowISO() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// ---------------------------------------------------------------------------
// Fetch a Google Sheet as CSV with retry
// ---------------------------------------------------------------------------
async function fetchSheet(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await axios.get(url, {
        responseType: 'text',
        timeout: 30000,
        headers: { 'Accept': 'text/csv' },
      });

      const parsed = Papa.parse(resp.data, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false, // we do our own parsing
      });

      if (parsed.errors && parsed.errors.length > 0) {
        console.warn(`[dataAgent] CSV parse warnings for "${sheetName}":`, parsed.errors.slice(0, 3));
      }

      return parsed.data;
    } catch (err) {
      lastError = err;
      console.warn(`[dataAgent] Fetch attempt ${attempt}/${MAX_RETRIES} for "${sheetName}" failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`Failed to fetch sheet "${sheetName}" after ${MAX_RETRIES} attempts: ${lastError.message}`);
}

// ---------------------------------------------------------------------------
// Parse & Store: Creative Performance Tracker-Auto → raw_creatives
// ---------------------------------------------------------------------------
function parseAndStoreCreatives(rows) {
  const now = nowISO();

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO raw_creatives
      (creative_name, ad_id, campaign_name, adset_name,
       spend, impressions, clicks, installs, signups,
       d0_trial, d6, d6_cac, d6_roas, cpi, cpc, ctr,
       live_status, creative_type, platform,
       date_from, date_to, raw_json, fetched_at, updated_at)
    VALUES
      (@creative_name, @ad_id, @campaign_name, @adset_name,
       @spend, @impressions, @clicks, @installs, @signups,
       @d0_trial, @d6, @d6_cac, @d6_roas, @cpi, @cpc, @ctr,
       @live_status, @creative_type, @platform,
       @date_from, @date_to, @raw_json, @fetched_at, @updated_at)
  `);

  const insertMany = db.transaction((items) => {
    let count = 0;
    for (const item of items) {
      if (!item.creative_name) continue; // skip rows without a name
      upsert.run(item);
      count++;
    }
    return count;
  });

  // Fuzzy column getter — finds the first header containing the substring (case-insensitive)
  const get = (row, ...needles) => {
    for (const needle of needles) {
      for (const key of Object.keys(row)) {
        if (key.toLowerCase().includes(needle.toLowerCase()) && row[key]) return row[key];
      }
    }
    return '';
  };

  const mapped = rows.map(row => ({
    creative_name:  (get(row, 'Creative Name', 'Creative') || '').trim() || null,
    ad_id:          (get(row, 'Ad ID', 'ad_id') || '').trim() || null,
    campaign_name:  (get(row, 'Campaign') || '').trim() || null,
    adset_name:     (get(row, 'Adset') || '').trim() || null,
    spend:          parseNum(get(row, 'Spent', 'Spend')),
    impressions:    parseNum(get(row, 'Impr')),
    clicks:         parseNum(get(row, 'Click')),
    installs:       parseNum(get(row, 'Install')),
    signups:        parseNum(row['Signups'] || ''),
    d0_trial:       parseNum(row['D0_Trials'] || row['D0_Trial'] || ''),
    d6:             parseNum(row['D6'] || ''),
    d6_cac:         parseNum(row['D6 CAC'] || ''),
    d6_roas:        parseNum(row['D6 ROAS (overall)'] || row['D6 ROAS'] || ''),
    cpi:            parseNum(get(row, 'CPI')),
    cpc:            parseNum(get(row, 'CPC')),
    ctr:            parseNum(get(row, 'CTR')),
    live_status:    (row['Live?'] || '').trim() || null,
    creative_type:  (row[''] || row['Type'] || get(row, 'Type') || '').trim() || null,
    platform:       (get(row, 'Platform') || '').trim() || null,
    date_from:      parseDate(get(row, 'Start date', 'Go Live')),
    date_to:        parseDate(get(row, 'End Date')),
    raw_json:       JSON.stringify(row),
    fetched_at:     now,
    updated_at:     now,
  }));

  return insertMany(mapped);
}

// ---------------------------------------------------------------------------
// Parse & Store: Meta Ads Dump → raw_meta_dump
// ---------------------------------------------------------------------------
function parseAndStoreMetaDump(rows) {
  const now = nowISO();

  const insert = db.prepare(`
    INSERT INTO raw_meta_dump
      (campaign_name, adset_name, ad_name, ad_id, campaign_id, adset_id,
       spend, impressions, clicks, installs, date, raw_json, fetched_at)
    VALUES
      (@campaign_name, @adset_name, @ad_name, @ad_id, @campaign_id, @adset_id,
       @spend, @impressions, @clicks, @installs, @date, @raw_json, @fetched_at)
  `);

  const replaceAll = db.transaction((items) => {
    db.prepare('DELETE FROM raw_meta_dump').run();
    let count = 0;
    for (const item of items) {
      insert.run(item);
      count++;
    }
    return count;
  });

  const mapped = rows.map(row => ({
    campaign_name: (row['Campaign Name'] || row['Campaign'] || row['campaign_name'] || '').trim() || null,
    adset_name:    (row['Adset Name'] || row['Adset'] || row['adset_name'] || '').trim() || null,
    ad_name:       (row['Ad Name'] || row['Ad'] || row['ad_name'] || '').trim() || null,
    ad_id:         (row['Ad ID'] || row['ad_id'] || '').trim() || null,
    campaign_id:   (row['Campaign ID'] || row['campaign_id'] || '').trim() || null,
    adset_id:      (row['Adset ID'] || row['adset_id'] || '').trim() || null,
    spend:         parseNum(row['Spend'] || row['Spent'] || row['Amount Spent'] || row['spend']),
    impressions:   parseNum(row['Impressions'] || row['impressions']),
    clicks:        parseNum(row['Clicks'] || row['Link Clicks'] || row['clicks']),
    installs:      parseNum(row['Installs'] || row['App Installs'] || row['installs']),
    date:          parseDate(row['Date'] || row['Day'] || row['date']),
    raw_json:      JSON.stringify(row),
    fetched_at:    now,
  }));

  return replaceAll(mapped);
}

// ---------------------------------------------------------------------------
// Parse & Store: Metabase Meta Ad Level Import → raw_metabase
// ---------------------------------------------------------------------------
function parseAndStoreMetabase(rows) {
  const now = nowISO();

  const insert = db.prepare(`
    INSERT INTO raw_metabase
      (campaign_name, adset_name, ad_name,
       signups, d0_trial, d6, revenue, ltv_estimate,
       date, raw_json, fetched_at)
    VALUES
      (@campaign_name, @adset_name, @ad_name,
       @signups, @d0_trial, @d6, @revenue, @ltv_estimate,
       @date, @raw_json, @fetched_at)
  `);

  const replaceAll = db.transaction((items) => {
    db.prepare('DELETE FROM raw_metabase').run();
    let count = 0;
    for (const item of items) {
      insert.run(item);
      count++;
    }
    return count;
  });

  const mapped = rows.map(row => ({
    campaign_name: (row['Campaign Name'] || row['Campaign'] || row['campaign_name'] || '').trim() || null,
    adset_name:    (row['Adset Name'] || row['Adset'] || row['adset_name'] || '').trim() || null,
    ad_name:       (row['Ad Name'] || row['Ad'] || row['ad_name'] || '').trim() || null,
    signups:       parseNum(row['Signups'] || row['signups']),
    d0_trial:      parseNum(row['D0_Trial'] || row['D0 Trial'] || row['d0_trial']),
    d6:            parseNum(row['D6'] || row['d6']),
    revenue:       parseNum(row['Revenue'] || row['revenue']),
    ltv_estimate:  parseNum(row['LTV Estimate'] || row['LTV'] || row['ltv_estimate']),
    date:          parseDate(row['Date'] || row['Day'] || row['date']),
    raw_json:      JSON.stringify(row),
    fetched_at:    now,
  }));

  return replaceAll(mapped);
}

// ---------------------------------------------------------------------------
// Main: Fetch and Store All
// ---------------------------------------------------------------------------
async function fetchAndStoreAll() {
  const summary = { success: false, main: 0, metaDump: 0, metabase: 0 };
  const errors = [];

  // Fetch all three sheets in parallel
  const [mainRows, metaDumpRows, metabaseRows] = await Promise.all([
    fetchSheet(SHEETS.main).catch(err => { errors.push(`main: ${err.message}`); return null; }),
    fetchSheet(SHEETS.metaDump).catch(err => { errors.push(`metaDump: ${err.message}`); return null; }),
    fetchSheet(SHEETS.metabase).catch(err => { errors.push(`metabase: ${err.message}`); return null; }),
  ]);

  // Parse and store each (sequentially – they share the same DB)
  if (mainRows) {
    try {
      summary.main = parseAndStoreCreatives(mainRows);
      logFetch('main_creatives', mainRows.length, summary.main, 'success', null);
    } catch (err) {
      errors.push(`main store: ${err.message}`);
      logFetch('main_creatives', mainRows.length, 0, 'error', err.message);
    }
  }

  if (metaDumpRows) {
    try {
      summary.metaDump = parseAndStoreMetaDump(metaDumpRows);
      logFetch('meta_dump', metaDumpRows.length, summary.metaDump, 'success', null);
    } catch (err) {
      errors.push(`metaDump store: ${err.message}`);
      logFetch('meta_dump', metaDumpRows.length, 0, 'error', err.message);
    }
  }

  if (metabaseRows) {
    try {
      summary.metabase = parseAndStoreMetabase(metabaseRows);
      logFetch('metabase', metabaseRows.length, summary.metabase, 'success', null);
    } catch (err) {
      errors.push(`metabase store: ${err.message}`);
      logFetch('metabase', metabaseRows.length, 0, 'error', err.message);
    }
  }

  summary.success = errors.length === 0;
  if (errors.length > 0) {
    summary.errors = errors;
    console.error('[dataAgent] Errors during fetchAndStoreAll:', errors);
  }

  console.log(`[dataAgent] Sync complete — main: ${summary.main}, metaDump: ${summary.metaDump}, metabase: ${summary.metabase}`);
  return summary;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function getStatus() {
  const tables = ['raw_creatives', 'raw_meta_dump', 'raw_metabase'];
  const status = {};

  for (const table of tables) {
    const count = getRowCount(table);
    const lastFetch = getOne(
      `SELECT fetched_at FROM ${table} ORDER BY fetched_at DESC LIMIT 1`
    );
    status[table] = {
      rowCount: count,
      lastFetchedAt: lastFetch ? lastFetch.fetched_at : null,
    };
  }

  const lastLog = getOne(
    `SELECT * FROM data_fetch_log ORDER BY fetched_at DESC LIMIT 1`
  );
  status.lastFetchLog = lastLog || null;

  return status;
}

// ---------------------------------------------------------------------------
// Internal: log a fetch event
// ---------------------------------------------------------------------------
function logFetch(fetchType, rowsFetched, rowsChanged, status, errorMessage) {
  run(
    `INSERT INTO data_fetch_log (fetch_type, rows_fetched, rows_changed, status, error_message)
     VALUES (?, ?, ?, ?, ?)`,
    [fetchType, rowsFetched, rowsChanged, status, errorMessage]
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = { fetchAndStoreAll, getStatus, fetchSheet };
