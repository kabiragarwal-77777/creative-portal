/**
 * gcSignals.js — Market context signals for Google creative performance
 *
 * Layers Nifty 50, VIX, DXY data onto Google ad ROAS.
 * Smart reuse: reads from Meta CI DB (ci.db) if today's signals exist,
 * otherwise fetches independently from public APIs.
 */

const { getGcDb } = require('../db/gc-db');
const path = require('path');
const fs = require('fs');
const https = require('https');

let Database;
try {
    Database = require('better-sqlite3');
} catch (e) {
    Database = require('../../inventory-scanner/node_modules/better-sqlite3');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function httpsGet(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    });
}

function classifySentiment(vix) {
    if (vix == null) return 'Unknown';
    if (vix < 15) return 'Low Volatility/Bullish';
    if (vix <= 20) return 'Moderate';
    return 'High Volatility/Bearish';
}

function sentimentToScore(sentiment) {
    switch (sentiment) {
        case 'Low Volatility/Bullish': return 1;
        case 'Moderate': return 0;
        case 'High Volatility/Bearish': return -1;
        default: return 0;
    }
}

/**
 * Pearson correlation coefficient between two arrays.
 * Returns null if insufficient data.
 */
function pearsonCorrelation(xs, ys) {
    if (!xs || !ys || xs.length < 3 || xs.length !== ys.length) return null;
    const n = xs.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - meanX;
        const dy = ys[i] - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    if (den === 0) return 0;
    return Math.round((num / den) * 1000) / 1000;
}

// ── Meta CI DB reader (read-only) ───────────────────────────────────────────

function readMetaCiSignals() {
    try {
        const ciDbPath = path.join(__dirname, '../../creative-intelligence/ci.db');
        if (!fs.existsSync(ciDbPath)) return null;
        const ciDb = new Database(ciDbPath, { readonly: true });
        const today = todayISO();
        // Check if market_signals table exists
        const tableCheck = ciDb.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='market_signals'"
        ).get();
        if (!tableCheck) {
            ciDb.close();
            return null;
        }
        const row = ciDb.prepare(
            'SELECT * FROM market_signals WHERE date = ? ORDER BY id DESC LIMIT 1'
        ).get(today);
        ciDb.close();
        return row || null;
    } catch (e) {
        console.warn('[GC Signals] Could not read Meta CI signals:', e.message);
        return null;
    }
}

// ── Independent market data fetch ───────────────────────────────────────────

async function fetchNiftyVix() {
    // Try Yahoo Finance v8 API for ^NSEI (Nifty 50) and ^INDIAVIX
    const symbols = ['^NSEI', '^INDIAVIX'];
    const results = { nifty_50: null, vix: null };

    for (const symbol of symbols) {
        try {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
            const raw = await httpsGet(url);
            const json = JSON.parse(raw);
            const meta = json.chart?.result?.[0]?.meta;
            const price = meta?.regularMarketPrice ?? null;
            if (symbol === '^NSEI') results.nifty_50 = price;
            if (symbol === '^INDIAVIX') results.vix = price;
        } catch (e) {
            console.warn(`[GC Signals] Failed to fetch ${symbol}:`, e.message);
        }
    }
    return results;
}

async function fetchDxy() {
    try {
        const url = 'https://query1.finance.yahoo.com/v8/finance/chart/DX-Y.NYB?range=1d&interval=1d';
        const raw = await httpsGet(url);
        const json = JSON.parse(raw);
        return json.chart?.result?.[0]?.meta?.regularMarketPrice ?? null;
    } catch (e) {
        console.warn('[GC Signals] Failed to fetch DXY:', e.message);
        return null;
    }
}

async function fetchMarketDataIndependently() {
    const [niftyVix, dxy] = await Promise.all([fetchNiftyVix(), fetchDxy()]);
    return {
        nifty_50: niftyVix.nifty_50,
        vix: niftyVix.vix,
        dxy: dxy
    };
}

// ── Google ROAS correlation ─────────────────────────────────────────────────

function computeGoogleRoasCorrelation(db, sentimentScore) {
    try {
        // Get daily ROAS from gc_adset_performance for last 30 days
        const rows = db.prepare(`
            SELECT date,
                   CASE WHEN SUM(spend) > 0
                        THEN SUM(conversion_value) / SUM(spend)
                        ELSE 0 END AS daily_roas
            FROM gc_adset_performance
            WHERE date >= date('now', '-30 days')
            GROUP BY date
            ORDER BY date ASC
        `).all();

        if (!rows || rows.length < 3) return null;

        // Get market signals for corresponding dates
        const signalRows = db.prepare(`
            SELECT date,
                   CASE market_sentiment
                       WHEN 'Low Volatility/Bullish' THEN 1
                       WHEN 'Moderate' THEN 0
                       WHEN 'High Volatility/Bearish' THEN -1
                       ELSE 0
                   END AS sentiment_score
            FROM gc_market_signals
            WHERE date >= date('now', '-30 days')
            ORDER BY date ASC
        `).all();

        const signalMap = {};
        for (const sr of signalRows) {
            signalMap[sr.date] = sr.sentiment_score;
        }

        // Build paired arrays (only dates present in both)
        const roasArr = [];
        const sentArr = [];
        for (const row of rows) {
            if (signalMap[row.date] !== undefined) {
                roasArr.push(row.daily_roas);
                sentArr.push(signalMap[row.date]);
            }
        }

        return pearsonCorrelation(sentArr, roasArr);
    } catch (e) {
        console.warn('[GC Signals] ROAS correlation calc failed:', e.message);
        return null;
    }
}

// ── Module export ───────────────────────────────────────────────────────────

module.exports = function (config) {
    const db = getGcDb();

    async function fetchMarketSignals() {
        const today = todayISO();
        console.log(`[GC Signals] Fetching market signals for ${today}...`);

        let nifty_50 = null, vix = null, dxy = null;
        let market_sentiment = 'Unknown';
        let sourceLabel = 'independent';

        // 1. Try reading from Meta CI DB first
        try {
            const metaRow = readMetaCiSignals();
            if (metaRow) {
                nifty_50 = metaRow.nifty_50 ?? null;
                vix = metaRow.vix ?? null;
                dxy = metaRow.dxy ?? null;
                market_sentiment = metaRow.market_sentiment || classifySentiment(vix);
                sourceLabel = 'meta-ci-db';
                console.log('[GC Signals] Reused signals from Meta CI DB');
            }
        } catch (e) {
            console.warn('[GC Signals] Meta CI read error:', e.message);
        }

        // 2. If not available, fetch independently
        if (nifty_50 == null && vix == null && dxy == null) {
            try {
                const data = await fetchMarketDataIndependently();
                nifty_50 = data.nifty_50;
                vix = data.vix;
                dxy = data.dxy;
                market_sentiment = classifySentiment(vix);
                sourceLabel = 'yahoo-finance';
                console.log('[GC Signals] Fetched signals independently');
            } catch (e) {
                console.warn('[GC Signals] Independent fetch failed:', e.message);
                market_sentiment = 'Unknown';
            }
        }

        // 3. Compute Google ROAS correlation
        const google_roas_correlation = computeGoogleRoasCorrelation(db, sentimentToScore(market_sentiment));

        // 4. Store in gc_market_signals
        const signals_json = JSON.stringify({
            source: sourceLabel,
            fetched_at: new Date().toISOString(),
            nifty_50,
            vix,
            dxy,
            market_sentiment,
            google_roas_correlation
        });

        try {
            // Upsert: delete today's old entry if exists, then insert fresh
            db.prepare('DELETE FROM gc_market_signals WHERE date = ?').run(today);
            db.prepare(`
                INSERT INTO gc_market_signals (date, nifty_50, vix, dxy, market_sentiment, google_roas_correlation, signals_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(today, nifty_50, vix, dxy, market_sentiment, google_roas_correlation, signals_json);

            console.log(`[GC Signals] Stored: Nifty=${nifty_50}, VIX=${vix}, DXY=${dxy}, Sentiment=${market_sentiment}, Corr=${google_roas_correlation}`);
        } catch (e) {
            console.error('[GC Signals] DB write failed:', e.message);
        }

        return {
            date: today,
            nifty_50,
            vix,
            dxy,
            market_sentiment,
            google_roas_correlation,
            source: sourceLabel
        };
    }

    async function getLatestSignals() {
        try {
            const row = db.prepare(`
                SELECT * FROM gc_market_signals ORDER BY id DESC LIMIT 1
            `).get();
            if (!row) return null;
            return {
                date: row.date,
                nifty_50: row.nifty_50,
                vix: row.vix,
                dxy: row.dxy,
                market_sentiment: row.market_sentiment,
                google_roas_correlation: row.google_roas_correlation,
                signals_json: row.signals_json ? JSON.parse(row.signals_json) : null
            };
        } catch (e) {
            console.error('[GC Signals] getLatestSignals failed:', e.message);
            return null;
        }
    }

    return { fetchMarketSignals, getLatestSignals };
};
