// =============================================================================
// Feedback Engine — Anomaly Detector Agent
// Watches for unexpected patterns: model drift, data quality issues,
// external shocks, competitor anomalies, portal health.
// =============================================================================

const fs = require('fs');
const path = require('path');
const { insert, update, getAll, count, query, getFeDb } = require('../db/fe-db');

const PREFIX = '[FE:AnomalyDetector]';
const DB_FILE = path.join(__dirname, '..', 'feedback-engine.db');

module.exports = function (config = {}) {

    // ── Helper: store anomaly and auto-generate proposal if critical ─────
    async function storeAnomaly(anomalyType, severity, title, description, detectedValue, expectedValue, threshold) {
        // Check for duplicate: either unresolved OR resolved within last 24h (prevent re-alerting)
        const existing = await query(
            `SELECT id FROM fe_anomalies
             WHERE anomaly_type = ? AND title = ?
             AND (is_resolved = 0 OR resolved_at >= CURRENT_TIMESTAMP - INTERVAL 24 HOUR)
             LIMIT 1`,
            [anomalyType, title]
        );

        if (existing.length > 0) {
            console.log(`${PREFIX} Duplicate anomaly "${title}" (unresolved or recently resolved) — skipping.`);
            return null;
        }

        const anomalyId = await insert('fe_anomalies', {
            anomaly_type: anomalyType,
            severity: severity,
            title: title,
            description: description,
            detected_value: detectedValue,
            expected_value: expectedValue,
            threshold_violated: threshold,
            is_resolved: 0,
            detected_at: new Date().toISOString()
        });

        console.log(`${PREFIX} [${severity.toUpperCase()}] ${title}`);

        // Auto-generate proposal for critical anomalies
        if (severity === 'critical') {
            const proposalId = await insert('fe_proposals', {
                proposal_type: 'anomaly_response',
                title: `[AUTO] Respond to: ${title}`,
                description: `Automatically generated proposal in response to critical anomaly: ${description}`,
                rationale: `Critical anomaly detected — ${anomalyType}. Detected value: ${detectedValue}, Expected: ${expectedValue}.`,
                evidence_json: JSON.stringify({ anomaly_id: anomalyId, anomaly_type: anomalyType }),
                expected_impact_metric: 'system_health',
                risk_level: 'high',
                is_reversible: 0,
                status: 'pending',
                generated_by_agent: 'feAnomalyDetector',
                generated_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            });

            await update('fe_anomalies', anomalyId, { proposal_id_generated: proposalId });
            console.log(`${PREFIX} Auto-generated proposal #${proposalId} for critical anomaly.`);
        }

        return anomalyId;
    }

    // ── 1. runAllChecks() ────────────────────────────────────────────────
    async function runAllChecks() {
        try {
            console.log(`${PREFIX} Running all anomaly detection checks...`);
            const anomalies = [];

            const driftResults = await checkModelDrift();
            anomalies.push(...driftResults);

            const dataResults = await checkDataQuality();
            anomalies.push(...dataResults);

            const healthResults = await checkPortalHealth();
            anomalies.push(...healthResults);

            const competitorResults = await checkCompetitorAnomalies();
            anomalies.push(...competitorResults);

            console.log(`${PREFIX} All checks complete. ${anomalies.length} new anomalies detected.`);
            return anomalies;
        } catch (err) {
            console.error(`${PREFIX} runAllChecks() error:`, err.message);
            throw err;
        }
    }

    // ── 2. checkModelDrift() ─────────────────────────────────────────────
    async function checkModelDrift() {
        try {
            const anomalies = [];

            // 7-day rolling accuracy
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

            for (const source of ['meta', 'google']) {
                const recent7d = await query(
                    `SELECT AVG(ABS(error_d7)) as avg_error
                     FROM fe_prediction_accuracy
                     WHERE source = ? AND checked_at >= ?`,
                    [source, sevenDaysAgo]
                );

                const baseline30d = await query(
                    `SELECT AVG(ABS(error_d7)) as avg_error
                     FROM fe_prediction_accuracy
                     WHERE source = ? AND checked_at >= ?`,
                    [source, thirtyDaysAgo]
                );

                const recentError = recent7d[0]?.avg_error;
                const baselineError = baseline30d[0]?.avg_error;

                if (recentError == null || baselineError == null || baselineError === 0) {
                    continue;
                }

                // If 7d error is >15% worse than 30d baseline
                const degradationPct = ((recentError - baselineError) / baselineError) * 100;

                if (degradationPct > 15) {
                    const id = await storeAnomaly(
                        'MODEL_DRIFT',
                        'warning',
                        `Model drift detected for ${source} predictions`,
                        `7-day avg error (${recentError.toFixed(2)}) is ${degradationPct.toFixed(1)}% worse than 30-day baseline (${baselineError.toFixed(2)}).`,
                        recentError,
                        baselineError,
                        '15% degradation threshold'
                    );
                    if (id) anomalies.push({ id, type: 'MODEL_DRIFT', source });
                }
            }

            return anomalies;
        } catch (err) {
            console.error(`${PREFIX} checkModelDrift() error:`, err.message);
            return [];
        }
    }

    // ── 3. checkDataQuality() ────────────────────────────────────────────
    async function checkDataQuality() {
        try {
            const anomalies = [];
            const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

            // Check if any new knowledge items have been ingested in 48h
            const recentItems = await query(
                `SELECT COUNT(*) as cnt FROM fe_knowledge_items
                 WHERE ingested_at >= ?`,
                [fortyEightHoursAgo]
            );

            if (recentItems[0].cnt === 0) {
                const id = await storeAnomaly(
                    'DATA_GAP',
                    'warning',
                    'No new knowledge items in 48 hours',
                    'Zero new knowledge items have been ingested in the last 48 hours. Crawlers may be failing or sources may be down.',
                    0,
                    null,
                    '48h data gap threshold'
                );
                if (id) anomalies.push({ id, type: 'DATA_GAP' });
            }

            // Check if any new predictions in 48h
            const recentPredictions = await query(
                `SELECT COUNT(*) as cnt FROM fe_prediction_accuracy
                 WHERE created_at >= ?`,
                [fortyEightHoursAgo]
            );

            if (recentPredictions[0].cnt === 0) {
                const id = await storeAnomaly(
                    'DATA_GAP',
                    'warning',
                    'No new predictions tracked in 48 hours',
                    'Zero new prediction accuracy records in the last 48 hours. The watcher may not be running.',
                    0,
                    null,
                    '48h prediction gap threshold'
                );
                if (id) anomalies.push({ id, type: 'DATA_GAP' });
            }

            // Check scheduler for missed runs (failed status)
            const recentFailures = await query(
                `SELECT * FROM fe_scheduler_log
                 WHERE status = 'failed' AND started_at >= ?
                 ORDER BY started_at DESC`,
                [fortyEightHoursAgo]
            );

            if (recentFailures.length > 0) {
                const failedJobs = [...new Set(recentFailures.map(f => f.job_name))];
                const id = await storeAnomaly(
                    'SCHEDULER_FAILURE',
                    'critical',
                    `Scheduler failures: ${failedJobs.join(', ')}`,
                    `${recentFailures.length} scheduler failures in last 48h for jobs: ${failedJobs.join(', ')}. Errors: ${recentFailures.map(f => f.errors).filter(Boolean).join('; ').slice(0, 500)}`,
                    recentFailures.length,
                    0,
                    'Any scheduler failure'
                );
                if (id) anomalies.push({ id, type: 'SCHEDULER_FAILURE', jobs: failedJobs });
            }

            return anomalies;
        } catch (err) {
            console.error(`${PREFIX} checkDataQuality() error:`, err.message);
            return [];
        }
    }

    // ── 4. checkPortalHealth() ───────────────────────────────────────────
    async function checkPortalHealth() {
        try {
            const anomalies = [];

            // Check for missed consecutive scheduler runs
            // Get distinct job names and their last 3 runs
            const jobNames = await query(
                `SELECT DISTINCT job_name FROM fe_scheduler_log ORDER BY job_name`
            );

            for (const row of jobNames) {
                const lastRuns = await query(
                    `SELECT status FROM fe_scheduler_log
                     WHERE job_name = ?
                     ORDER BY started_at DESC
                     LIMIT 3`,
                    [row.job_name]
                );

                const consecutiveFails = lastRuns.filter(r => r.status === 'failed').length;
                if (consecutiveFails > 2) {
                    const id = await storeAnomaly(
                        'SCHEDULER_CONSECUTIVE_FAILURE',
                        'critical',
                        `Job "${row.job_name}" failed ${consecutiveFails} consecutive runs`,
                        `The scheduler job "${row.job_name}" has failed its last ${consecutiveFails} runs. Requires immediate investigation.`,
                        consecutiveFails,
                        0,
                        '>2 consecutive failures'
                    );
                    if (id) anomalies.push({ id, type: 'SCHEDULER_CONSECUTIVE_FAILURE', job: row.job_name });
                }
            }

            // Check DB file size
            try {
                const stats = fs.statSync(DB_FILE);
                const sizeMB = stats.size / (1024 * 1024);

                if (sizeMB > 500) {
                    const id = await storeAnomaly(
                        'DB_SIZE',
                        'warning',
                        `Database size exceeds 500MB (${sizeMB.toFixed(1)}MB)`,
                        `The feedback-engine.db file has grown to ${sizeMB.toFixed(1)}MB. Consider archiving old records or running VACUUM.`,
                        sizeMB,
                        500,
                        '500MB DB size threshold'
                    );
                    if (id) anomalies.push({ id, type: 'DB_SIZE', sizeMB });
                }
            } catch (fsErr) {
                // DB file may not exist yet — not an anomaly
                console.log(`${PREFIX} Could not stat DB file: ${fsErr.message}`);
            }

            return anomalies;
        } catch (err) {
            console.error(`${PREFIX} checkPortalHealth() error:`, err.message);
            return [];
        }
    }

    // ── 5. checkCompetitorAnomalies() ────────────────────────────────────
    async function checkCompetitorAnomalies() {
        try {
            const anomalies = [];

            // Check if competitor signal accuracy table has data
            const totalSignals = await count('fe_competitor_signal_accuracy');
            if (totalSignals === 0) {
                console.log(`${PREFIX} No competitor signal data available. Skipping competitor checks.`);
                return anomalies;
            }

            // Check for volume spikes: compare last 7d vs prior 30d weekly average
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const thirtySevenDaysAgo = new Date(Date.now() - 37 * 24 * 60 * 60 * 1000).toISOString();

            const recentVolume = await query(
                `SELECT COUNT(*) as cnt FROM fe_competitor_signal_accuracy
                 WHERE predicted_at >= ?`,
                [sevenDaysAgo]
            );

            const priorVolume = await query(
                `SELECT COUNT(*) as cnt FROM fe_competitor_signal_accuracy
                 WHERE predicted_at >= ? AND predicted_at < ?`,
                [thirtySevenDaysAgo, sevenDaysAgo]
            );

            const recentCount = recentVolume[0].cnt;
            // Average weekly volume over prior 30 days (approx 4.3 weeks)
            const priorWeeklyAvg = priorVolume[0].cnt / 4.3;

            if (priorWeeklyAvg > 0 && recentCount > priorWeeklyAvg * 3) {
                const id = await storeAnomaly(
                    'COMPETITOR_SURGE',
                    'info',
                    'Competitor signal volume spike (>3x)',
                    `${recentCount} competitor signals in last 7 days vs ${priorWeeklyAvg.toFixed(1)} weekly average. Possible major competitor campaign launch.`,
                    recentCount,
                    priorWeeklyAvg,
                    '3x volume spike threshold'
                );
                if (id) anomalies.push({ id, type: 'COMPETITOR_SURGE' });
            }

            // Check for competitor going dark (no signals in 14 days)
            const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
            const lastSignal = await query(
                `SELECT MAX(predicted_at) as last_at FROM fe_competitor_signal_accuracy`
            );

            if (lastSignal[0].last_at && lastSignal[0].last_at < fourteenDaysAgo) {
                const daysSilent = Math.floor(
                    (Date.now() - new Date(lastSignal[0].last_at).getTime()) / (24 * 60 * 60 * 1000)
                );
                const id = await storeAnomaly(
                    'COMPETITOR_DARK',
                    'info',
                    `Competitor signals silent for ${daysSilent} days`,
                    `No new competitor signals since ${lastSignal[0].last_at}. Competitors may have paused campaigns or data source may be broken.`,
                    daysSilent,
                    14,
                    '14-day silence threshold'
                );
                if (id) anomalies.push({ id, type: 'COMPETITOR_DARK', daysSilent });
            }

            return anomalies;
        } catch (err) {
            console.error(`${PREFIX} checkCompetitorAnomalies() error:`, err.message);
            return [];
        }
    }

    // ── 6. getAnomalies(filters) ─────────────────────────────────────────
    async function getAnomalies(filters = {}) {
        try {
            const conditions = [];
            const params = [];

            if (filters.severity) {
                conditions.push('severity = ?');
                params.push(filters.severity);
            }

            if (filters.resolved !== undefined) {
                conditions.push('is_resolved = ?');
                params.push(filters.resolved ? 1 : 0);
            }

            if (filters.type) {
                conditions.push('anomaly_type = ?');
                params.push(filters.type);
            }

            if (filters.days) {
                const since = new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000).toISOString();
                conditions.push('detected_at >= ?');
                params.push(since);
            }

            let sql = 'SELECT * FROM fe_anomalies';
            if (conditions.length) {
                sql += ' WHERE ' + conditions.join(' AND ');
            }
            sql += ' ORDER BY detected_at DESC LIMIT 200';

            return await query(sql, params);
        } catch (err) {
            console.error(`${PREFIX} getAnomalies() error:`, err.message);
            throw err;
        }
    }

    // ── 7. getActive() — unresolved anomalies ───────────────────────────
    async function getActive() {
        try {
            return await query(
                `SELECT * FROM fe_anomalies
                 WHERE is_resolved = 0
                 ORDER BY
                    CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                    detected_at DESC`
            );
        } catch (err) {
            console.error(`${PREFIX} getActive() error:`, err.message);
            throw err;
        }
    }

    // ── 8. resolve(id) — mark anomaly as resolved ───────────────────────
    async function resolve(id) {
        try {
            const changes = await update('fe_anomalies', id, {
                is_resolved: 1,
                resolved_at: new Date().toISOString()
            });

            if (changes > 0) {
                console.log(`${PREFIX} Anomaly #${id} marked as resolved.`);
            } else {
                console.log(`${PREFIX} Anomaly #${id} not found.`);
            }

            return { resolved: changes > 0 };
        } catch (err) {
            console.error(`${PREFIX} resolve() error:`, err.message);
            throw err;
        }
    }

    return {
        runAllChecks,
        checkModelDrift,
        checkDataQuality,
        checkPortalHealth,
        checkCompetitorAnomalies,
        getAnomalies,
        getActive,
        resolve
    };
};
