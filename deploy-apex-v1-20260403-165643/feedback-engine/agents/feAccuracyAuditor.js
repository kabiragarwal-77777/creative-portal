// =============================================================================
// Feedback Engine — Accuracy Auditor Agent
// Deep-audits prediction model accuracy, identifies signal value vs noise,
// proposes weight recalibration
// =============================================================================

const { callAI, callAIJson } = require('./feAI');
const { getFeDb, insert, update, getOne, getAll, count, query, run, logSchedulerStart, logSchedulerEnd } = require('../db/fe-db');

const META_CPS_WEIGHTS = {
    roas: 0.30,
    ltv_90d: 0.25,
    ctr: 0.15,
    completion_rate: 0.10,
    cpa_efficiency: 0.10,
    frequency: 0.05,
    reach: 0.05
};

const GOOGLE_CPS_WEIGHTS = {
    roas: 0.30,
    ltv_90d: 0.25,
    ctr: 0.15,
    conversion_rate: 0.10,
    cpa_efficiency: 0.10,
    quality_score: 0.05,
    impression_share: 0.05
};

module.exports = function (config) {

    // ── Parse JSON from Claude response ──
    function parseJsonResponse(text) {
        let cleaned = text.trim();
        if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
        else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
        if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
        cleaned = cleaned.trim();
        return JSON.parse(cleaned);
    }

    // ── Collect ground truth grouped by source + tag ──
    function collectGroundTruth() {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        const rows = query(
            `SELECT source, accuracy_tag, COUNT(*) as cnt,
                    AVG(error_d7) as avg_error_d7,
                    AVG(error_d30) as avg_error_d30,
                    AVG(error_d60) as avg_error_d60,
                    AVG(predicted_roas_d7) as avg_predicted_d7,
                    AVG(actual_roas_d7) as avg_actual_d7,
                    MIN(error_d7) as min_error_d7,
                    MAX(error_d7) as max_error_d7
             FROM fe_prediction_accuracy
             WHERE checked_at > ?
               AND accuracy_tag IS NOT NULL
             GROUP BY source, accuracy_tag
             ORDER BY source, accuracy_tag`,
            [thirtyDaysAgo]
        );

        // Also get per-source totals
        const totals = query(
            `SELECT source, COUNT(*) as total,
                    AVG(ABS(error_d7)) as mae_d7,
                    AVG(error_d7) as bias_d7
             FROM fe_prediction_accuracy
             WHERE checked_at > ?
               AND error_d7 IS NOT NULL
             GROUP BY source`,
            [thirtyDaysAgo]
        );

        // Get individual records for detailed analysis
        const details = query(
            `SELECT source, simulation_id, predicted_roas_d7, actual_roas_d7,
                    error_d7, accuracy_tag
             FROM fe_prediction_accuracy
             WHERE checked_at > ?
               AND error_d7 IS NOT NULL
             ORDER BY ABS(error_d7) DESC
             LIMIT 100`,
            [thirtyDaysAgo]
        );

        return {
            grouped: rows,
            totals: totals,
            worst_predictions: details.slice(0, 20),
            best_predictions: details.filter(d => Math.abs(d.error_d7) < 10).slice(0, 20),
            record_count: details.length
        };
    }

    // ── Call Claude for signal contribution analysis ──
    async function analyzeSignalContribution(groundTruth, weights) {
        const accuracyJson = JSON.stringify(groundTruth, null, 2);
        const weightsJson = JSON.stringify(weights, null, 2);

        try {
            const result = await callAIJson(
                'Perform the analysis and return the JSON result.',
                {
                    system: `You are a quantitative analyst auditing a creative ROAS prediction model for Univest, Indian fintech.\nHere is prediction accuracy data grouped by input signal values: ${accuracyJson}\nCurrent model signal weights: ${weightsJson}\nAnalyze: 1) Which signals correlate with accuracy? 2) Which add noise? 3) Recommended weight adjustments 4) Systematically over/undervalued attributes? 5) Market conditions where model fails?\nReturn valid JSON: { signal_analysis: [], weight_recommendations: {}, failure_conditions: [], confidence_score: number }`,
                    maxTokens: 2048,
                    fallback: null
                }
            );
            if (result) return result;
            return {
                signal_analysis: [{ signal: 'all', note: 'AI analysis unavailable', impact: 'unknown' }],
                weight_recommendations: { ...weights },
                failure_conditions: ['Unable to perform automated analysis'],
                confidence_score: 0
            };
        } catch (err) {
            console.error('[FE:AccuracyAuditor] AI analysis failed:', err.message);
            return {
                signal_analysis: [{ signal: 'all', note: 'AI analysis unavailable', impact: 'unknown' }],
                weight_recommendations: { ...weights },
                failure_conditions: ['Unable to perform automated analysis'],
                confidence_score: 0
            };
        }
    }

    // ── Check if any weight change exceeds threshold ──
    function detectSignificantWeightChanges(currentWeights, proposedWeights, threshold = 0.10) {
        const changes = [];
        for (const key of Object.keys(currentWeights)) {
            const current = currentWeights[key];
            const proposed = proposedWeights[key] !== undefined ? proposedWeights[key] : current;
            const delta = Math.abs(proposed - current);
            if (delta > threshold) {
                changes.push({
                    signal: key,
                    current_weight: current,
                    proposed_weight: proposed,
                    delta: Math.round(delta * 1000) / 1000,
                    direction: proposed > current ? 'increase' : 'decrease'
                });
            }
        }
        // Also check for any new signals proposed
        for (const key of Object.keys(proposedWeights)) {
            if (!(key in currentWeights) && proposedWeights[key] > threshold) {
                changes.push({
                    signal: key,
                    current_weight: 0,
                    proposed_weight: proposedWeights[key],
                    delta: proposedWeights[key],
                    direction: 'new'
                });
            }
        }
        return changes;
    }

    // ── Backtest: simulate applying proposed weights to historical data ──
    function backtestWeights(proposedMetaWeights, proposedGoogleWeights) {
        // Collect all records with actuals
        const records = query(
            `SELECT source, predicted_roas_d7, actual_roas_d7, error_d7
             FROM fe_prediction_accuracy
             WHERE actual_roas_d7 IS NOT NULL
               AND predicted_roas_d7 IS NOT NULL
               AND error_d7 IS NOT NULL`
        );

        if (records.length === 0) {
            return { improvement_pct: 0, sample_size: 0, note: 'No historical records with actuals' };
        }

        // Current MAE
        let currentMaeSum = 0;
        let count = 0;
        for (const r of records) {
            currentMaeSum += Math.abs(r.error_d7);
            count++;
        }
        const currentMae = currentMaeSum / count;

        // Simulated MAE with proposed weights
        // The weight adjustment is simulated as a scaling factor on the prediction
        // For each source, compute the weight ratio (proposed / current) and
        // apply as a correction factor to the predicted value
        let proposedMaeSum = 0;
        for (const r of records) {
            const weights = r.source === 'meta' ? META_CPS_WEIGHTS : GOOGLE_CPS_WEIGHTS;
            const proposed = r.source === 'meta' ? proposedMetaWeights : proposedGoogleWeights;

            // Calculate aggregate weight shift as a correction factor
            let totalShift = 0;
            let signalCount = 0;
            for (const key of Object.keys(weights)) {
                const currW = weights[key];
                const propW = proposed[key] !== undefined ? proposed[key] : currW;
                totalShift += (propW - currW);
                signalCount++;
            }
            const avgShift = signalCount > 0 ? totalShift / signalCount : 0;

            // Apply correction: if model overestimates, a downward shift in dominant weights helps
            const correctionFactor = 1 + avgShift;
            const adjustedPredicted = r.predicted_roas_d7 * correctionFactor;
            const adjustedError = r.actual_roas_d7 !== 0
                ? ((r.actual_roas_d7 - adjustedPredicted) / Math.abs(adjustedPredicted)) * 100
                : 0;

            proposedMaeSum += Math.abs(adjustedError);
        }
        const proposedMae = proposedMaeSum / count;

        const improvement = currentMae > 0
            ? ((currentMae - proposedMae) / currentMae) * 100
            : 0;

        return {
            current_mae: Math.round(currentMae * 100) / 100,
            proposed_mae: Math.round(proposedMae * 100) / 100,
            improvement_pct: Math.round(improvement * 100) / 100,
            sample_size: count,
            note: improvement > 0
                ? `Proposed weights reduce MAE by ${Math.round(improvement * 100) / 100}%`
                : `Proposed weights do not improve MAE (delta: ${Math.round(improvement * 100) / 100}%)`
        };
    }

    // ── 1. Run Audit ──
    async function runAudit() {
        console.log('[FE:AccuracyAuditor] Starting weekly audit...');
        const logId = logSchedulerStart('feAccuracyAuditor.runAudit');

        try {
            // Step 1: Collect ground truth
            const groundTruth = collectGroundTruth();
            console.log(`[FE:AccuracyAuditor] Step 1: Collected ${groundTruth.record_count} prediction records`);

            if (groundTruth.record_count === 0) {
                console.log('[FE:AccuracyAuditor] No prediction records to audit');
                logSchedulerEnd(logId, 0, null);
                return {
                    audit_date: new Date().toISOString(),
                    status: 'skipped',
                    reason: 'No prediction records available'
                };
            }

            // Step 2: Claude analysis for both Meta and Google
            console.log('[FE:AccuracyAuditor] Step 2: Running signal contribution analysis...');

            const allWeights = {
                meta: META_CPS_WEIGHTS,
                google: GOOGLE_CPS_WEIGHTS
            };

            const analysis = await analyzeSignalContribution(groundTruth, allWeights);
            console.log(`[FE:AccuracyAuditor] Step 2: Analysis confidence=${analysis.confidence_score}`);

            // Extract proposed weights (separate meta/google if provided)
            const proposedMetaWeights = analysis.weight_recommendations.meta
                || analysis.weight_recommendations
                || META_CPS_WEIGHTS;
            const proposedGoogleWeights = analysis.weight_recommendations.google
                || analysis.weight_recommendations
                || GOOGLE_CPS_WEIGHTS;

            // Step 3: Check for significant weight changes, generate proposals
            console.log('[FE:AccuracyAuditor] Step 3: Checking weight change significance...');

            const metaChanges = detectSignificantWeightChanges(META_CPS_WEIGHTS, proposedMetaWeights);
            const googleChanges = detectSignificantWeightChanges(GOOGLE_CPS_WEIGHTS, proposedGoogleWeights);
            let proposalsGenerated = 0;

            if (metaChanges.length > 0) {
                insert('fe_proposals', {
                    proposal_type: 'WEIGHT_RECALIBRATION',
                    title: `Meta CPS weight recalibration: ${metaChanges.length} signals adjusted`,
                    description: `Audit detected ${metaChanges.length} Meta CPS weight(s) requiring >10% adjustment based on ${groundTruth.record_count} prediction accuracy records.`,
                    rationale: metaChanges.map(c =>
                        `${c.signal}: ${c.current_weight} -> ${c.proposed_weight} (${c.direction} by ${c.delta})`
                    ).join('; '),
                    evidence_json: JSON.stringify({
                        source: 'meta',
                        changes: metaChanges,
                        current_weights: META_CPS_WEIGHTS,
                        proposed_weights: proposedMetaWeights,
                        ground_truth_summary: groundTruth.totals.filter(t => t.source === 'meta'),
                        analysis_confidence: analysis.confidence_score
                    }),
                    expected_impact_metric: 'meta_prediction_mae',
                    expected_impact_delta: null,
                    risk_level: metaChanges.some(c => c.delta > 0.20) ? 'high' : 'medium',
                    is_reversible: 1,
                    generated_by_agent: 'feAccuracyAuditor',
                    generated_at: new Date().toISOString(),
                    rollback_available: 1,
                    expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
                });
                proposalsGenerated++;
                console.log(`[FE:AccuracyAuditor] Created Meta WEIGHT_RECALIBRATION proposal`);
            }

            if (googleChanges.length > 0) {
                insert('fe_proposals', {
                    proposal_type: 'WEIGHT_RECALIBRATION',
                    title: `Google CPS weight recalibration: ${googleChanges.length} signals adjusted`,
                    description: `Audit detected ${googleChanges.length} Google CPS weight(s) requiring >10% adjustment based on ${groundTruth.record_count} prediction accuracy records.`,
                    rationale: googleChanges.map(c =>
                        `${c.signal}: ${c.current_weight} -> ${c.proposed_weight} (${c.direction} by ${c.delta})`
                    ).join('; '),
                    evidence_json: JSON.stringify({
                        source: 'google',
                        changes: googleChanges,
                        current_weights: GOOGLE_CPS_WEIGHTS,
                        proposed_weights: proposedGoogleWeights,
                        ground_truth_summary: groundTruth.totals.filter(t => t.source === 'google'),
                        analysis_confidence: analysis.confidence_score
                    }),
                    expected_impact_metric: 'google_prediction_mae',
                    expected_impact_delta: null,
                    risk_level: googleChanges.some(c => c.delta > 0.20) ? 'high' : 'medium',
                    is_reversible: 1,
                    generated_by_agent: 'feAccuracyAuditor',
                    generated_at: new Date().toISOString(),
                    rollback_available: 1,
                    expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
                });
                proposalsGenerated++;
                console.log(`[FE:AccuracyAuditor] Created Google WEIGHT_RECALIBRATION proposal`);
            }

            // Step 4: Backtest
            console.log('[FE:AccuracyAuditor] Step 4: Running backtest...');
            const backtestResult = backtestWeights(proposedMetaWeights, proposedGoogleWeights);
            console.log(`[FE:AccuracyAuditor] Step 4: Backtest improvement=${backtestResult.improvement_pct}%`);

            // Update proposals with backtest delta
            if (proposalsGenerated > 0 && backtestResult.improvement_pct !== 0) {
                const recentProposals = query(
                    `SELECT id FROM fe_proposals WHERE generated_by_agent = 'feAccuracyAuditor' AND proposal_type = 'WEIGHT_RECALIBRATION' ORDER BY id DESC LIMIT ?`,
                    [proposalsGenerated]
                );
                for (const p of recentProposals) {
                    update('fe_proposals', p.id, {
                        expected_impact_delta: backtestResult.improvement_pct
                    });
                }
            }

            // Compute accuracy percentages per source
            const metaTotals = groundTruth.totals.find(t => t.source === 'meta');
            const googleTotals = groundTruth.totals.find(t => t.source === 'google');
            const metaAccurate = groundTruth.grouped.find(g => g.source === 'meta' && g.accuracy_tag === 'accurate');
            const googleAccurate = groundTruth.grouped.find(g => g.source === 'google' && g.accuracy_tag === 'accurate');

            const metaAccuracyPct = metaTotals && metaAccurate
                ? Math.round((metaAccurate.cnt / metaTotals.total) * 10000) / 100
                : null;
            const googleAccuracyPct = googleTotals && googleAccurate
                ? Math.round((googleAccurate.cnt / googleTotals.total) * 10000) / 100
                : null;

            // Store audit report
            const reportId = insert('fe_audit_reports', {
                audit_date: new Date().toISOString(),
                meta_accuracy_pct: metaAccuracyPct,
                google_accuracy_pct: googleAccuracyPct,
                signal_analysis_json: JSON.stringify({
                    signal_analysis: analysis.signal_analysis,
                    failure_conditions: analysis.failure_conditions,
                    confidence_score: analysis.confidence_score,
                    ground_truth: {
                        grouped: groundTruth.grouped,
                        totals: groundTruth.totals,
                        record_count: groundTruth.record_count
                    }
                }),
                current_weights_json: JSON.stringify(allWeights),
                proposed_weights_json: JSON.stringify({
                    meta: proposedMetaWeights,
                    google: proposedGoogleWeights
                }),
                backtest_improvement_pct: backtestResult.improvement_pct,
                proposals_generated: proposalsGenerated
            });

            // Save rollback snapshot if proposals were generated
            if (proposalsGenerated > 0) {
                const recentProposals = query(
                    `SELECT id FROM fe_proposals WHERE generated_by_agent = 'feAccuracyAuditor' AND proposal_type = 'WEIGHT_RECALIBRATION' ORDER BY id DESC LIMIT ?`,
                    [proposalsGenerated]
                );
                for (const p of recentProposals) {
                    insert('fe_rollback_snapshots', {
                        proposal_id: p.id,
                        snapshot_type: 'cps_weights',
                        snapshot_data_json: JSON.stringify(allWeights)
                    });
                }
            }

            const report = {
                id: reportId,
                audit_date: new Date().toISOString(),
                meta_accuracy_pct: metaAccuracyPct,
                google_accuracy_pct: googleAccuracyPct,
                record_count: groundTruth.record_count,
                signal_analysis: analysis.signal_analysis,
                failure_conditions: analysis.failure_conditions,
                confidence_score: analysis.confidence_score,
                meta_weight_changes: metaChanges,
                google_weight_changes: googleChanges,
                backtest: backtestResult,
                proposals_generated: proposalsGenerated
            };

            console.log(`[FE:AccuracyAuditor] Audit complete: report_id=${reportId}, proposals=${proposalsGenerated}`);
            logSchedulerEnd(logId, groundTruth.record_count, null);
            return report;
        } catch (err) {
            console.error('[FE:AccuracyAuditor] runAudit failed:', err.message);
            logSchedulerEnd(logId, 0, err.message);
            throw err;
        }
    }

    // ── 2. Get Latest Report ──
    async function getLatestReport() {
        try {
            const rows = query(
                `SELECT * FROM fe_audit_reports ORDER BY id DESC LIMIT 1`
            );
            if (rows.length === 0) return null;

            const report = rows[0];
            return {
                ...report,
                signal_analysis_json: report.signal_analysis_json ? JSON.parse(report.signal_analysis_json) : null,
                current_weights_json: report.current_weights_json ? JSON.parse(report.current_weights_json) : null,
                proposed_weights_json: report.proposed_weights_json ? JSON.parse(report.proposed_weights_json) : null
            };
        } catch (err) {
            console.error('[FE:AccuracyAuditor] getLatestReport error:', err.message);
            return null;
        }
    }

    // ── 3. Get History ──
    async function getHistory() {
        try {
            const rows = getAll('fe_audit_reports', {}, 'id DESC', 100);
            return rows.map(report => ({
                ...report,
                signal_analysis_json: report.signal_analysis_json ? JSON.parse(report.signal_analysis_json) : null,
                current_weights_json: report.current_weights_json ? JSON.parse(report.current_weights_json) : null,
                proposed_weights_json: report.proposed_weights_json ? JSON.parse(report.proposed_weights_json) : null
            }));
        } catch (err) {
            console.error('[FE:AccuracyAuditor] getHistory error:', err.message);
            return [];
        }
    }

    return {
        runAudit,
        getLatestReport,
        getHistory
    };
};
