/**
 * gcForecast.js — Tracks predicted vs actual ROAS daily for Google ad simulations.
 * Pulls actuals from gc_adset_performance, interpolates predicted curves,
 * stores timeseries in gc_forecast_timeseries, and fires divergence alerts.
 */

const { getGcDb } = require('../db/gc-db');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pullActuals(simulation) {
    const db = getGcDb();
    const startDate = (simulation.simulated_at || simulation.created_at || '').slice(0, 10);
    if (!startDate) return [];
    const rows = db.prepare(`
        SELECT date, SUM(spend) as spend, SUM(conversions) as conversions,
               SUM(conversion_value) as conversion_value
        FROM gc_adset_performance
        WHERE campaign_id = ? AND adgroup_id = ?
          AND date >= ?
        GROUP BY date ORDER BY date
    `).all(simulation.campaign_id, simulation.adgroup_id, startDate);
    return rows || [];
}

function computeActualRoas(rows) {
    let totalSpend = 0;
    let totalValue = 0;
    return rows.map((r, i) => {
        totalSpend += (r.spend || 0);
        totalValue += (r.conversion_value || 0);
        return {
            date: r.date,
            day_number: i + 1,
            spend: totalSpend,
            conversions: r.conversions || 0,
            conversion_value: totalValue,
            actual_roas: totalSpend > 0 ? (totalValue / totalSpend) * 100 : 0
        };
    });
}

function interpolatePredictedRoas(dayNumber, simulation) {
    const points = [
        { day: 7,   roas: simulation.predicted_d7_roas },
        { day: 30,  roas: simulation.predicted_d30_roas },
        { day: 60,  roas: simulation.predicted_d60_roas },
        { day: 120, roas: simulation.predicted_d120_roas },
        { day: 365, roas: simulation.predicted_d365_roas },
    ].filter(p => p.roas != null);

    if (points.length === 0) return null;
    if (points.length === 1) return points[0].roas;

    // Clamp to boundaries
    if (dayNumber <= points[0].day) return points[0].roas;
    if (dayNumber >= points[points.length - 1].day) return points[points.length - 1].roas;

    // Find surrounding pair and linearly interpolate
    for (let i = 0; i < points.length - 1; i++) {
        const lo = points[i];
        const hi = points[i + 1];
        if (dayNumber >= lo.day && dayNumber <= hi.day) {
            const t = (dayNumber - lo.day) / (hi.day - lo.day);
            return lo.roas + t * (hi.roas - lo.roas);
        }
    }
    return points[points.length - 1].roas;
}

function checkDivergence(timeseries, simulation) {
    const recent = timeseries.slice(-3);
    if (recent.length < 3) return null;

    // Check underperforming: actual >25% below predicted for 3 consecutive days
    const allBelow = recent.every(r =>
        r.predicted_roas != null && r.predicted_roas > 0 &&
        r.actual_roas < r.predicted_roas * 0.75
    );
    if (allBelow) {
        const last = recent[recent.length - 1];
        return {
            alert_type: 'underperforming',
            message: `Simulation ${simulation.id} actual ROAS ${last.actual_roas.toFixed(1)}% is >25% below predicted ${last.predicted_roas.toFixed(1)}% for 3 consecutive days`,
            severity: 'high'
        };
    }

    // Check overperforming: actual >25% above predicted for 3 consecutive days
    const allAbove = recent.every(r =>
        r.predicted_roas != null && r.predicted_roas > 0 &&
        r.actual_roas > r.predicted_roas * 1.25
    );
    if (allAbove) {
        return {
            alert_type: 'overperforming',
            message: `Simulation ${simulation.id} actual ROAS is >25% above predicted for 3 days - consider scaling`,
            severity: 'medium'
        };
    }

    return null;
}

// ---------------------------------------------------------------------------
// Exported module
// ---------------------------------------------------------------------------

module.exports = function (config) {
    const PREDICTION_VERSION = (config && config.predictionVersion) || 'v1';

    /**
     * Pull actuals for every active simulation, compute rolling ROAS,
     * persist to gc_forecast_timeseries, and fire divergence alerts.
     */
    async function updateForecasts() {
        const db = getGcDb();

        // 1. Get all active simulations
        const simulations = db.prepare(
            `SELECT * FROM gc_simulations WHERE status = 'active'`
        ).all() || [];

        if (simulations.length === 0) return { updated: 0, alerts: 0 };

        const upsertTs = db.prepare(`
            INSERT INTO gc_forecast_timeseries
                (simulation_id, date, spend, conversions, conversion_value,
                 actual_roas, predicted_roas, prediction_version, day_number)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(simulation_id, date) DO UPDATE SET
                spend = excluded.spend,
                conversions = excluded.conversions,
                conversion_value = excluded.conversion_value,
                actual_roas = excluded.actual_roas,
                predicted_roas = excluded.predicted_roas,
                prediction_version = excluded.prediction_version,
                day_number = excluded.day_number
        `);

        const insertAlert = db.prepare(`
            INSERT INTO gc_forecast_alerts
                (simulation_id, alert_type, message, severity, is_read, triggered_at)
            VALUES (?, ?, ?, ?, 0, datetime('now'))
        `);

        // Avoid duplicate alerts: check if same alert_type already exists unread
        const existingAlert = db.prepare(`
            SELECT id FROM gc_forecast_alerts
            WHERE simulation_id = ? AND alert_type = ? AND is_read = 0
            LIMIT 1
        `);

        let totalUpdated = 0;
        let totalAlerts = 0;

        const runAll = db.transaction(() => {
            for (const sim of simulations) {
                // 2. Pull actuals
                const rawRows = pullActuals(sim);
                if (rawRows.length === 0) continue;

                // 3. Compute rolling ROAS
                const series = computeActualRoas(rawRows);

                // 4. Store in gc_forecast_timeseries with predicted ROAS
                const enriched = series.map(row => {
                    const predicted = interpolatePredictedRoas(row.day_number, sim);
                    return { ...row, predicted_roas: predicted };
                });

                for (const row of enriched) {
                    upsertTs.run(
                        sim.id,
                        row.date,
                        row.spend,
                        row.conversions,
                        row.conversion_value,
                        row.actual_roas,
                        row.predicted_roas,
                        PREDICTION_VERSION,
                        row.day_number
                    );
                }
                totalUpdated += enriched.length;

                // 5. Check divergence
                const alert = checkDivergence(enriched, sim);
                if (alert) {
                    const dup = existingAlert.get(sim.id, alert.alert_type);
                    if (!dup) {
                        insertAlert.run(sim.id, alert.alert_type, alert.message, alert.severity);
                        totalAlerts++;
                    }
                }
            }
        });

        runAll();

        return { updated: totalUpdated, alerts: totalAlerts, simulations: simulations.length };
    }

    /**
     * Retrieve forecast alerts, optionally only unread ones.
     */
    async function getAlerts(unreadOnly = false) {
        const db = getGcDb();
        const sql = unreadOnly
            ? `SELECT * FROM gc_forecast_alerts WHERE is_read = 0 ORDER BY triggered_at DESC`
            : `SELECT * FROM gc_forecast_alerts ORDER BY triggered_at DESC`;
        return db.prepare(sql).all() || [];
    }

    /**
     * Mark a single alert as read.
     */
    async function markAlertRead(alertId) {
        const db = getGcDb();
        const result = db.prepare(
            `UPDATE gc_forecast_alerts SET is_read = 1 WHERE id = ?`
        ).run(alertId);
        return { changed: result.changes };
    }

    /**
     * High-level summary: how many simulations are active, on-track,
     * underperforming, or overperforming.
     */
    async function getForecastSummary() {
        const db = getGcDb();

        const active = db.prepare(
            `SELECT COUNT(*) as cnt FROM gc_simulations WHERE status = 'active'`
        ).get();

        const underperforming = db.prepare(`
            SELECT COUNT(DISTINCT simulation_id) as cnt FROM gc_forecast_alerts
            WHERE alert_type = 'underperforming' AND is_read = 0
        `).get();

        const overperforming = db.prepare(`
            SELECT COUNT(DISTINCT simulation_id) as cnt FROM gc_forecast_alerts
            WHERE alert_type = 'overperforming' AND is_read = 0
        `).get();

        const activeCount = (active && active.cnt) || 0;
        const underCount = (underperforming && underperforming.cnt) || 0;
        const overCount = (overperforming && overperforming.cnt) || 0;
        const onTrack = Math.max(0, activeCount - underCount - overCount);

        return {
            active: activeCount,
            on_track: onTrack,
            underperforming: underCount,
            overperforming: overCount
        };
    }

    return { updateForecasts, getAlerts, markAlertRead, getForecastSummary };
};
