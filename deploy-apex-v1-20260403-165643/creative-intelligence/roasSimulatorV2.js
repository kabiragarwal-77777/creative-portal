const { getCiDb } = require('./db');
const createPredictor = require('./predictor');

module.exports = function(config) {
    const predictor = createPredictor(config);

    const SIMULATOR_START_DATE = '2026-03-25';
    const IMMATURE_MAX_DAYS = 180;
    const CHECKPOINTS = [
        { code: 'P0', day: 0, label: 'Day 0' },
        { code: 'P2', day: 2, label: 'Day 2' },
        { code: 'P8', day: 8, label: 'Day 8' },
        { code: 'P14', day: 14, label: 'Day 14' },
    ];
    const HORIZONS = [
        { code: 'd6', day: 6, label: 'D6', revenueField: 'd6_overall_revenue', roasField: 'd6_roas', actualField: 'actual_d6_roas', predictedField: 'predicted_d6_roas', lowField: 'predicted_d6_low', highField: 'predicted_d6_high' },
        { code: 'd15', day: 15, label: 'D15', revenueField: 'd15_overall_revenue', roasField: 'd15_roas', actualField: 'actual_d15_roas', predictedField: 'predicted_d15_roas', lowField: 'predicted_d15_low', highField: 'predicted_d15_high' },
        { code: 'd30', day: 30, label: 'D30', revenueField: 'd30_overall_revenue', roasField: 'd30_roas', actualField: 'actual_d30_roas', predictedField: 'predicted_d30_roas', lowField: 'predicted_d30_low', highField: 'predicted_d30_high' },
        { code: 'd60', day: 60, label: 'D60', revenueField: 'd60_overall_revenue', roasField: 'd60_roas', actualField: 'actual_d60_roas', predictedField: 'predicted_d60_roas', lowField: 'predicted_d60_low', highField: 'predicted_d60_high' },
        { code: 'd180', day: 180, label: 'D180', revenueField: 'd180_overall_revenue', roasField: 'd180_roas', actualField: 'actual_d180_roas', predictedField: 'predicted_d180_roas', lowField: 'predicted_d180_low', highField: 'predicted_d180_high' },
    ];

    let schedulerHandle = null;

    function round4(value) {
        if (value == null || Number.isNaN(Number(value))) return null;
        return Math.round(Number(value) * 10000) / 10000;
    }

    function safeRoas(spend, revenue) {
        const sp = Number(spend) || 0;
        const rev = Number(revenue) || 0;
        if (sp <= 0 || rev < 0) return null;
        const ratio = rev / sp;
        if (!Number.isFinite(ratio) || ratio > 50) return null;
        return round4(ratio * 100);
    }

    function actualRoas(snapshot, horizon) {
        if (!snapshot) return null;
        const direct = snapshot[horizon.roasField];
        if (direct != null) return round4(direct);
        return safeRoas(snapshot.spend, snapshot[horizon.revenueField]);
    }

    function currentAnchorRoas(snapshot) {
        if (!snapshot) return null;
        if (snapshot.overall_roas != null) return round4(snapshot.overall_roas);
        return safeRoas(snapshot.spend, snapshot.overall_revenue);
    }

    function accuracyPct(predicted, actual) {
        const p = Number(predicted);
        const a = Number(actual);
        if (!Number.isFinite(p) || !Number.isFinite(a) || a <= 0) return null;
        const errorPct = Math.abs(p - a) / a * 100;
        return round4(Math.max(0, 100 - errorPct));
    }

    function buildCheckpointAccuracy(run, latestSnapshot) {
        if (!run || !latestSnapshot) {
            return { verified_horizons: 0, average_accuracy_pct: null, by_horizon: {} };
        }

        let verified = 0;
        let total = 0;
        const byHorizon = {};

        for (const horizon of HORIZONS) {
            const actual = actualRoas(latestSnapshot, horizon);
            const predicted = run[horizon.predictedField];
            const isMature = (Number(latestSnapshot.days_live) || 0) >= (horizon.day + 1);
            const accuracy = isMature ? accuracyPct(predicted, actual) : null;

            byHorizon[horizon.code] = {
                mature: isMature,
                actual_roas: actual != null ? round4(actual) : null,
                predicted_roas: predicted != null ? round4(predicted) : null,
                accuracy_pct: accuracy,
            };

            if (accuracy != null) {
                verified++;
                total += accuracy;
            }
        }

        return {
            verified_horizons: verified,
            average_accuracy_pct: verified ? round4(total / verified) : null,
            by_horizon: byHorizon,
        };
    }

    function getLatestSnapshots() {
        const d = getCiDb();
        return d.prepare(`
            SELECT s.*
            FROM snapshots s
            INNER JOIN (
                SELECT ad_id, MAX(snapshot_date) AS max_date
                FROM snapshots
                GROUP BY ad_id
            ) latest
                ON latest.ad_id = s.ad_id AND latest.max_date = s.snapshot_date
            WHERE s.go_live_date >= ?
              AND COALESCE(s.days_live, 0) <= ?
              AND (s.is_ghost != 1 OR s.is_ghost IS NULL)
            ORDER BY COALESCE(s.days_live, 0) ASC, COALESCE(s.spend, 0) ASC, s.ad_name ASC
        `).all(SIMULATOR_START_DATE, IMMATURE_MAX_DAYS);
    }

    function getSnapshotHistory(adId) {
        const d = getCiDb();
        return d.prepare(`
            SELECT *
            FROM snapshots
            WHERE ad_id = ?
            ORDER BY snapshot_date ASC
        `).all(adId);
    }

    function getCheckpointRuns(adId) {
        const d = getCiDb();
        if (adId) {
            return d.prepare(`
                SELECT *
                FROM simulator_checkpoint_runs
                WHERE ad_id = ?
                ORDER BY checkpoint_day ASC
            `).all(adId);
        }
        return d.prepare(`
            SELECT *
            FROM simulator_checkpoint_runs
            ORDER BY checkpoint_day ASC, created_at ASC
        `).all();
    }

    function getCheckpointSnapshot(history, checkpointDay) {
        return history.find(row => (Number(row.spend) || 0) > 0 && (Number(row.days_live) || 0) >= checkpointDay) || null;
    }

    function getRunPoint(run, horizon) {
        const lockedActual = horizon.day <= (run.checkpoint_day || 0);
        const lockedValue = run[horizon.actualField];
        const predictedValue = run[horizon.predictedField];
        return {
            horizon: horizon.label,
            day: horizon.day,
            value: lockedActual && lockedValue != null ? round4(lockedValue) : round4(predictedValue),
            low: lockedActual && lockedValue != null ? round4(lockedValue) : round4(run[horizon.lowField]),
            high: lockedActual && lockedValue != null ? round4(lockedValue) : round4(run[horizon.highField]),
            pointType: lockedActual && lockedValue != null ? 'locked_actual' : 'forecast',
        };
    }

    function buildCheckpointSeries(run) {
        const points = [];
        const checkpointDay = Number(run.checkpoint_day) || 0;

        HORIZONS.forEach(horizon => {
            if (horizon.day > checkpointDay) return;
            const actualValue = run[horizon.actualField];
            if (actualValue == null) return;
            points.push({
                horizon: horizon.label,
                day: horizon.day,
                value: round4(actualValue),
                low: round4(actualValue),
                high: round4(actualValue),
                pointType: 'locked_actual',
            });
        });

        if (run.actual_roas_at_creation != null && !points.some(point => point.day === checkpointDay)) {
            points.push({
                horizon: `D${checkpointDay}`,
                day: checkpointDay,
                value: round4(run.actual_roas_at_creation),
                low: round4(run.actual_roas_at_creation),
                high: round4(run.actual_roas_at_creation),
                pointType: 'checkpoint_anchor',
            });
        }

        HORIZONS.forEach(horizon => {
            if (horizon.day <= checkpointDay) return;
            points.push(getRunPoint(run, horizon));
        });

        points.sort((a, b) => a.day - b.day);
        return points;
    }

    async function ensureCheckpointRuns() {
        predictor.buildCohortBenchmarks();

        const d = getCiDb();
        const latestSnapshots = getLatestSnapshots();
        const insertRun = d.prepare(`
            INSERT OR IGNORE INTO simulator_checkpoint_runs (
                ad_id, ad_name, campaign_name, adset_name, creative_type, go_live_date,
                checkpoint_code, checkpoint_day, created_snapshot_date, days_live_at_creation,
                spend_at_creation, installs_at_creation, signups_at_creation,
                actual_roas_at_creation, actual_revenue_at_creation,
                actual_d6_roas, actual_d15_roas, actual_d30_roas, actual_d60_roas, actual_d180_roas,
                predicted_d6_roas, predicted_d6_low, predicted_d6_high,
                predicted_d15_roas, predicted_d15_low, predicted_d15_high,
                predicted_d30_roas, predicted_d30_low, predicted_d30_high,
                predicted_d60_roas, predicted_d60_low, predicted_d60_high,
                predicted_d180_roas, predicted_d180_low, predicted_d180_high,
                prediction_method, confidence_score, trajectory, recommended_action, reasoning, gpt_qualitative
            ) VALUES (
                @ad_id, @ad_name, @campaign_name, @adset_name, @creative_type, @go_live_date,
                @checkpoint_code, @checkpoint_day, @created_snapshot_date, @days_live_at_creation,
                @spend_at_creation, @installs_at_creation, @signups_at_creation,
                @actual_roas_at_creation, @actual_revenue_at_creation,
                @actual_d6_roas, @actual_d15_roas, @actual_d30_roas, @actual_d60_roas, @actual_d180_roas,
                @predicted_d6_roas, @predicted_d6_low, @predicted_d6_high,
                @predicted_d15_roas, @predicted_d15_low, @predicted_d15_high,
                @predicted_d30_roas, @predicted_d30_low, @predicted_d30_high,
                @predicted_d60_roas, @predicted_d60_low, @predicted_d60_high,
                @predicted_d180_roas, @predicted_d180_low, @predicted_d180_high,
                @prediction_method, @confidence_score, @trajectory, @recommended_action, @reasoning, @gpt_qualitative
            )
        `);

        let created = 0;
        let existing = 0;
        let skipped = 0;

        for (const latest of latestSnapshots) {
            const history = getSnapshotHistory(latest.ad_id);
            if (!history.length) {
                skipped++;
                continue;
            }

            const existingSet = new Set(getCheckpointRuns(latest.ad_id).map(row => row.checkpoint_code));

            for (const checkpoint of CHECKPOINTS) {
                if (existingSet.has(checkpoint.code)) {
                    existing++;
                    continue;
                }

                if ((Number(latest.days_live) || 0) < checkpoint.day) {
                    skipped++;
                    continue;
                }

                const checkpointSnapshot = getCheckpointSnapshot(history, checkpoint.day);
                if (!checkpointSnapshot) {
                    skipped++;
                    continue;
                }

                const prediction = await predictor.predictNewAd(checkpointSnapshot);
                if (!prediction) {
                    skipped++;
                    continue;
                }

                var insertResult = insertRun.run({
                    ad_id: checkpointSnapshot.ad_id,
                    ad_name: checkpointSnapshot.ad_name,
                    campaign_name: checkpointSnapshot.campaign_name || null,
                    adset_name: checkpointSnapshot.adset_name || null,
                    creative_type: checkpointSnapshot.creative_type || null,
                    go_live_date: checkpointSnapshot.go_live_date || null,
                    checkpoint_code: checkpoint.code,
                    checkpoint_day: checkpoint.day,
                    created_snapshot_date: checkpointSnapshot.snapshot_date,
                    days_live_at_creation: checkpointSnapshot.days_live || 0,
                    spend_at_creation: checkpointSnapshot.spend || 0,
                    installs_at_creation: checkpointSnapshot.installs || 0,
                    signups_at_creation: checkpointSnapshot.signups || 0,
                    actual_roas_at_creation: currentAnchorRoas(checkpointSnapshot),
                    actual_revenue_at_creation: round4(checkpointSnapshot.overall_revenue || 0),
                    actual_d6_roas: actualRoas(checkpointSnapshot, HORIZONS[0]),
                    actual_d15_roas: actualRoas(checkpointSnapshot, HORIZONS[1]),
                    actual_d30_roas: actualRoas(checkpointSnapshot, HORIZONS[2]),
                    actual_d60_roas: actualRoas(checkpointSnapshot, HORIZONS[3]),
                    actual_d180_roas: actualRoas(checkpointSnapshot, HORIZONS[4]),
                    predicted_d6_roas: round4(prediction.predicted_d6_roas),
                    predicted_d6_low: round4(prediction.predicted_d6_low),
                    predicted_d6_high: round4(prediction.predicted_d6_high),
                    predicted_d15_roas: round4(prediction.predicted_d15_roas),
                    predicted_d15_low: round4(prediction.predicted_d15_low),
                    predicted_d15_high: round4(prediction.predicted_d15_high),
                    predicted_d30_roas: round4(prediction.predicted_d30_roas),
                    predicted_d30_low: round4(prediction.predicted_d30_low),
                    predicted_d30_high: round4(prediction.predicted_d30_high),
                    predicted_d60_roas: round4(prediction.predicted_d60_roas),
                    predicted_d60_low: round4(prediction.predicted_d60_low),
                    predicted_d60_high: round4(prediction.predicted_d60_high),
                    predicted_d180_roas: round4(prediction.predicted_d180_roas),
                    predicted_d180_low: round4(prediction.predicted_d180_low),
                    predicted_d180_high: round4(prediction.predicted_d180_high),
                    prediction_method: prediction.prediction_method || null,
                    confidence_score: prediction.confidence_score || null,
                    trajectory: prediction.trajectory || null,
                    recommended_action: prediction.recommended_action || null,
                    reasoning: prediction.reasoning || null,
                    gpt_qualitative: prediction.gpt_qualitative || null,
                });

                if (insertResult.changes > 0) {
                    created++;
                    existingSet.add(checkpoint.code);
                } else {
                    existing++;
                }
            }
        }

        return { adsEvaluated: latestSnapshots.length, created, existing, skipped };
    }

    function getDashboardData() {
        const latestSnapshots = getLatestSnapshots();
        const checkpointRows = getCheckpointRuns();
        const checkpointMap = {};
        const accuracySummary = {};

        checkpointRows.forEach(row => {
            if (!checkpointMap[row.ad_id]) checkpointMap[row.ad_id] = {};
            checkpointMap[row.ad_id][row.checkpoint_code] = row;
        });

        const ads = latestSnapshots.map(snapshot => {
            const runs = checkpointMap[snapshot.ad_id] || {};
            const checkpoints = CHECKPOINTS.map(checkpoint => {
                const run = runs[checkpoint.code] || null;
                const accuracy = run ? buildCheckpointAccuracy(run, snapshot) : null;

                if (run && accuracy && accuracy.average_accuracy_pct != null) {
                    if (!accuracySummary[checkpoint.code]) accuracySummary[checkpoint.code] = [];
                    accuracySummary[checkpoint.code].push(accuracy.average_accuracy_pct);
                }

                return {
                    code: checkpoint.code,
                    day: checkpoint.day,
                    exists: !!run,
                    created_snapshot_date: run ? run.created_snapshot_date : null,
                    anchor_roas: run ? round4(run.actual_roas_at_creation) : null,
                    confidence_score: run ? run.confidence_score : null,
                    accuracy_summary: accuracy,
                };
            });

            return {
                ad_id: snapshot.ad_id,
                ad_name: snapshot.ad_name,
                campaign_name: snapshot.campaign_name,
                adset_name: snapshot.adset_name,
                creative_type: snapshot.creative_type,
                go_live_date: snapshot.go_live_date,
                latest_snapshot_date: snapshot.snapshot_date,
                days_live: snapshot.days_live || 0,
                spend: snapshot.spend || 0,
                signups: snapshot.signups || 0,
                installs: snapshot.installs || 0,
                actual_anchor_roas: currentAnchorRoas(snapshot),
                actual_d6_roas: actualRoas(snapshot, HORIZONS[0]),
                actual_d15_roas: actualRoas(snapshot, HORIZONS[1]),
                actual_d30_roas: actualRoas(snapshot, HORIZONS[2]),
                actual_d60_roas: actualRoas(snapshot, HORIZONS[3]),
                actual_d180_roas: actualRoas(snapshot, HORIZONS[4]),
                checkpoints,
                has_spend: (Number(snapshot.spend) || 0) > 0,
            };
        });

        const summary = {
            total_ads: ads.length,
            with_spend: ads.filter(ad => ad.has_spend).length,
            checkpoint_p0: ads.filter(ad => ad.checkpoints.some(cp => cp.code === 'P0' && cp.exists)).length,
            checkpoint_p2: ads.filter(ad => ad.checkpoints.some(cp => cp.code === 'P2' && cp.exists)).length,
            checkpoint_p8: ads.filter(ad => ad.checkpoints.some(cp => cp.code === 'P8' && cp.exists)).length,
            checkpoint_p14: ads.filter(ad => ad.checkpoints.some(cp => cp.code === 'P14' && cp.exists)).length,
            matured_d6: ads.filter(ad => (ad.days_live || 0) >= 7).length,
            avg_accuracy_p0: accuracySummary.P0 && accuracySummary.P0.length ? round4(accuracySummary.P0.reduce((sum, value) => sum + value, 0) / accuracySummary.P0.length) : null,
            avg_accuracy_p2: accuracySummary.P2 && accuracySummary.P2.length ? round4(accuracySummary.P2.reduce((sum, value) => sum + value, 0) / accuracySummary.P2.length) : null,
            avg_accuracy_p8: accuracySummary.P8 && accuracySummary.P8.length ? round4(accuracySummary.P8.reduce((sum, value) => sum + value, 0) / accuracySummary.P8.length) : null,
            avg_accuracy_p14: accuracySummary.P14 && accuracySummary.P14.length ? round4(accuracySummary.P14.reduce((sum, value) => sum + value, 0) / accuracySummary.P14.length) : null,
            verified_accuracy_p0: accuracySummary.P0 ? accuracySummary.P0.length : 0,
            verified_accuracy_p2: accuracySummary.P2 ? accuracySummary.P2.length : 0,
            verified_accuracy_p8: accuracySummary.P8 ? accuracySummary.P8.length : 0,
            verified_accuracy_p14: accuracySummary.P14 ? accuracySummary.P14.length : 0,
        };

        return {
            summary,
            ads,
            horizons: HORIZONS.map(horizon => ({
                label: horizon.label,
                day: horizon.day,
            })),
            checkpoints: CHECKPOINTS,
            startDate: SIMULATOR_START_DATE,
        };
    }

    function getTrendlineData(adId) {
        const latest = getLatestSnapshots().find(row => row.ad_id === adId);
        if (!latest) return null;

        const history = getSnapshotHistory(adId);
        const checkpointRuns = getCheckpointRuns(adId);
        const horizons = HORIZONS.map(horizon => ({
            label: horizon.label,
            day: horizon.day,
            actual_roas: actualRoas(latest, horizon),
            actual_revenue: round4(latest[horizon.revenueField]),
            mature: (Number(latest.days_live) || 0) >= (horizon.day + 1),
        }));

        const checkpointLines = checkpointRuns.map(run => ({
            checkpoint_code: run.checkpoint_code,
            checkpoint_day: run.checkpoint_day,
            created_snapshot_date: run.created_snapshot_date,
            days_live_at_creation: run.days_live_at_creation,
            spend_at_creation: run.spend_at_creation,
            signups_at_creation: run.signups_at_creation,
            actual_roas_at_creation: round4(run.actual_roas_at_creation),
            actual_revenue_at_creation: round4(run.actual_revenue_at_creation),
            confidence_score: run.confidence_score,
            prediction_method: run.prediction_method,
            trajectory: run.trajectory,
            recommended_action: run.recommended_action,
            reasoning: run.reasoning,
            gpt_qualitative: run.gpt_qualitative,
            accuracy_summary: buildCheckpointAccuracy(run, latest),
            points: buildCheckpointSeries(run),
        }));

        return {
            ad: {
                ad_id: latest.ad_id,
                ad_name: latest.ad_name,
                campaign_name: latest.campaign_name,
                adset_name: latest.adset_name,
                creative_type: latest.creative_type,
                go_live_date: latest.go_live_date,
                latest_snapshot_date: latest.snapshot_date,
                days_live: latest.days_live || 0,
                spend: latest.spend || 0,
                signups: latest.signups || 0,
                installs: latest.installs || 0,
                actual_anchor_roas: currentAnchorRoas(latest),
            },
            horizons,
            actualLine: history
                .filter(row => (Number(row.spend) || 0) > 0 && currentAnchorRoas(row) != null)
                .map(row => ({
                    horizon: `D${row.days_live || 0}`,
                    day: row.days_live || 0,
                    value: currentAnchorRoas(row),
                    revenue: round4(row.overall_revenue),
                    mature: true,
                    snapshot_date: row.snapshot_date,
                })),
            checkpoints: checkpointLines,
            history: history.map(row => ({
                snapshot_date: row.snapshot_date,
                days_live: row.days_live || 0,
                spend: row.spend || 0,
                overall_roas: currentAnchorRoas(row),
            })),
        };
    }

    function startScheduler(intervalMinutes) {
        const minutes = Number(intervalMinutes) || 15;
        if (schedulerHandle) clearInterval(schedulerHandle);

        setTimeout(() => {
            ensureCheckpointRuns().catch(err => {
                console.error('[roas-simulator-v2] Initial checkpoint sync failed:', err.message);
            });
        }, 30000);

        schedulerHandle = setInterval(() => {
            ensureCheckpointRuns().catch(err => {
                console.error('[roas-simulator-v2] Scheduled checkpoint sync failed:', err.message);
            });
        }, minutes * 60000);
    }

    function stopScheduler() {
        if (schedulerHandle) {
            clearInterval(schedulerHandle);
            schedulerHandle = null;
        }
    }

    return {
        CHECKPOINTS,
        HORIZONS,
        SIMULATOR_START_DATE,
        ensureCheckpointRuns,
        getDashboardData,
        getTrendlineData,
        startScheduler,
        stopScheduler,
    };
};
