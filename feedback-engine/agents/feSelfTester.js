// =============================================================================
// Feedback Engine — Self Tester Agent
// Generates hypotheses about what might improve portal performance,
// designs micro-tests, tracks outcomes.
// =============================================================================

const { callAI, callAIJson } = require('./feAI');
const { insert, update, getOne, getAll, query, logSchedulerStart, logSchedulerEnd } = require('../db/fe-db');
const METABASE_URL = process.env.METABASE_URL || 'https://analytics.univest.in';
const METABASE_TOKEN = process.env.METABASE_SESSION_TOKEN;
const TAG = '[FE:SelfTester]';

module.exports = function (config = {}) {

    // ── 1. generateHypotheses ──────────────────────────────────────────────
    async function generateHypotheses() {
        const logId = logSchedulerStart('self_tester_generate_hypotheses');
        try {
            console.log(TAG, 'Generating hypotheses...');

            // Pull historical performance summary
            const perfRows = query(
                `SELECT source, accuracy_tag, COUNT(*) as cnt,
                        AVG(error_d7) as avg_err7,
                        AVG(error_d30) as avg_err30,
                        AVG(error_d60) as avg_err60
                 FROM fe_prediction_accuracy
                 GROUP BY source, accuracy_tag
                 ORDER BY cnt DESC
                 LIMIT 50`
            );
            const summary = perfRows.length
                ? perfRows.map(r => `${r.source} ${r.accuracy_tag}: n=${r.cnt}, avgErr7=${(r.avg_err7 || 0).toFixed(2)}, avgErr30=${(r.avg_err30 || 0).toFixed(2)}, avgErr60=${(r.avg_err60 || 0).toFixed(2)}`).join('\n')
                : 'No historical performance data yet.';

            // Pull accuracy gaps from latest audit
            const latestAudit = query(
                `SELECT * FROM fe_audit_reports ORDER BY id DESC LIMIT 1`
            );
            const gaps = latestAudit.length
                ? `Meta accuracy: ${latestAudit[0].meta_accuracy_pct || 'N/A'}%, Google accuracy: ${latestAudit[0].google_accuracy_pct || 'N/A'}%, Signal analysis: ${latestAudit[0].signal_analysis_json || 'none'}`
                : 'No audit reports available yet.';

            // Pull recent knowledge items
            const knowledgeRows = getAll('fe_knowledge_items', {}, 'id DESC', 20);
            const signals = knowledgeRows.length
                ? knowledgeRows.map(k => `[${k.urgency}] ${k.signal_type}: ${k.key_insight || k.raw_content_preview || ''}`).join('\n')
                : 'No recent knowledge items.';

            const prompt = `You are a growth scientist for Univest's performance marketing team. Given historical creative performance data:
${summary}

Accuracy gaps:
${gaps}

Market signals:
${signals}

Generate 3-5 testable hypotheses about what might improve creative performance prediction and ad selection. Each hypothesis should be one of these types: creative (signal hypotheses about what creative elements drive performance), timing (launch day/market timing hypotheses), or competitor (response hypotheses about competitor actions).

Return ONLY a valid JSON array. Each element must have:
- hypothesis (string: clear, testable statement)
- type (string: "creative", "timing", or "competitor")
- test_method (string: how to retrospectively test this using historical data)
- success_metric (string: what metric proves/disproves it)
- data_needed (string: what data is required)
- estimated_confidence (number 0-100: how confident you are before testing)
- priority (number 1-5: 1 = highest priority)

Return valid JSON array only, no markdown fences.`;

            const hypotheses = await callAIJson(prompt, { maxTokens: 2048, fallback: [] });

            if (!Array.isArray(hypotheses) || hypotheses.length === 0) {
                console.warn('[FE:SelfTester] AI returned empty or no response — skipping');
                return [];
            }

            const insertedIds = [];
            for (const h of hypotheses) {
                const id = insert('fe_hypotheses', {
                    hypothesis_text: h.hypothesis,
                    type: h.type,
                    test_method: h.test_method,
                    success_metric: h.success_metric,
                    status: 'pending',
                    generated_at: new Date().toISOString()
                });
                insertedIds.push(id);
                console.log(TAG, `Hypothesis #${id}: [${h.type}] ${h.hypothesis.substring(0, 80)}...`);
            }

            logSchedulerEnd(logId, insertedIds.length);
            console.log(TAG, `Generated ${insertedIds.length} hypotheses`);
            return { generated: insertedIds.length, ids: insertedIds, hypotheses };

        } catch (err) {
            console.error(TAG, 'generateHypotheses error:', err.message);
            logSchedulerEnd(logId, 0, err.message);
            throw err;
        }
    }

    // ── 2. runRetrospectiveTest ────────────────────────────────────────────
    async function runRetrospectiveTest(hypothesisId) {
        try {
            console.log(TAG, `Running retrospective test for hypothesis #${hypothesisId}`);

            const hypothesis = getOne('fe_hypotheses', hypothesisId);
            if (!hypothesis) throw new Error(`Hypothesis #${hypothesisId} not found`);
            if (hypothesis.status === 'completed') {
                console.log(TAG, `Hypothesis #${hypothesisId} already tested, skipping`);
                return getAll('fe_hypothesis_tests', { hypothesis_id: hypothesisId }, 'id DESC', 1)[0];
            }

            // Mark as testing
            update('fe_hypotheses', hypothesisId, { status: 'testing' });

            // Fetch relevant historical data from Metabase
            let metabaseData = null;
            if (METABASE_TOKEN) {
                try {
                    const fetch = (await import('node-fetch')).default;
                    // Query historical ad performance for retrospective analysis
                    const mbResponse = await fetch(`${METABASE_URL}/api/dataset`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Metabase-Session': METABASE_TOKEN
                        },
                        body: JSON.stringify({
                            database: 1,
                            type: 'native',
                            native: {
                                query: `SELECT
                                    date_trunc('week', created_at) as week,
                                    COUNT(*) as ad_count,
                                    AVG(roas_d7) as avg_roas_d7,
                                    AVG(ctr) as avg_ctr,
                                    AVG(spend) as avg_spend
                                FROM ad_performance
                                WHERE created_at >= NOW() - INTERVAL '90 days'
                                GROUP BY 1
                                ORDER BY 1 DESC
                                LIMIT 13`
                            }
                        })
                    });
                    if (mbResponse.ok) {
                        const mbJson = await mbResponse.json();
                        metabaseData = mbJson.data ? mbJson.data.rows : null;
                    }
                } catch (mbErr) {
                    console.warn(TAG, 'Metabase fetch failed (non-fatal):', mbErr.message);
                }
            }

            // Also pull local accuracy data
            const localPerf = query(
                `SELECT source, accuracy_tag, error_d7, error_d30, actual_roas_d7, predicted_roas_d7, created_at
                 FROM fe_prediction_accuracy
                 ORDER BY created_at DESC
                 LIMIT 100`
            );

            const dataPayload = {
                metabase_weekly: metabaseData,
                local_accuracy: localPerf.slice(0, 50),
                hypothesis: hypothesis.hypothesis_text,
                test_method: hypothesis.test_method,
                success_metric: hypothesis.success_metric,
                type: hypothesis.type
            };

            const prompt = `You are a data analyst testing a hypothesis for Univest's ad performance system.

Hypothesis: "${hypothesis.hypothesis_text}"
Type: ${hypothesis.type}
Test method: ${hypothesis.test_method}
Success metric: ${hypothesis.success_metric}

Available data:
${JSON.stringify(dataPayload, null, 2).substring(0, 6000)}

Analyze the data and determine if this hypothesis is supported, rejected, or inconclusive. Be rigorous.

Return ONLY valid JSON with:
- result: "supported", "rejected", or "inconclusive"
- confidence_pct: number 0-100
- effect_size: number (estimated effect size, 0 if inconclusive)
- evidence_summary: string (2-3 sentence explanation of your finding)

Return valid JSON only, no markdown fences.`;

            const testResult = await callAIJson(prompt, { maxTokens: 1024, fallback: null });
            if (!testResult) {
                throw new Error('AI did not return valid JSON for test result');
            }

            const testId = insert('fe_hypothesis_tests', {
                hypothesis_id: hypothesisId,
                test_method: hypothesis.test_method,
                data_used_json: JSON.stringify(dataPayload).substring(0, 10000),
                result: testResult.result,
                confidence_pct: testResult.confidence_pct || 50,
                effect_size: testResult.effect_size || 0,
                evidence_summary: testResult.evidence_summary || 'No summary provided',
                completed_at: new Date().toISOString()
            });

            // Update hypothesis status
            update('fe_hypotheses', hypothesisId, {
                status: 'completed',
                tested_at: new Date().toISOString()
            });

            console.log(TAG, `Hypothesis #${hypothesisId} test complete: ${testResult.result} (confidence: ${testResult.confidence_pct}%)`);
            return getOne('fe_hypothesis_tests', testId);

        } catch (err) {
            console.error(TAG, `runRetrospectiveTest error for hypothesis #${hypothesisId}:`, err.message);
            // Mark hypothesis back to pending so it can be retried
            update('fe_hypotheses', hypothesisId, { status: 'pending' });
            throw err;
        }
    }

    // ── 3. getHypotheses ───────────────────────────────────────────────────
    async function getHypotheses(filters = {}) {
        try {
            const where = {};
            if (filters.status) where.status = filters.status;
            if (filters.type) where.type = filters.type;
            const rows = getAll('fe_hypotheses', where, 'id DESC', filters.limit || 100);
            console.log(TAG, `getHypotheses: returned ${rows.length} rows`);
            return rows;
        } catch (err) {
            console.error(TAG, 'getHypotheses error:', err.message);
            throw err;
        }
    }

    // ── 4. getTestResults ──────────────────────────────────────────────────
    async function getTestResults(hypothesisId) {
        try {
            const rows = getAll('fe_hypothesis_tests', { hypothesis_id: hypothesisId }, 'id DESC', 50);
            console.log(TAG, `getTestResults for hypothesis #${hypothesisId}: ${rows.length} results`);
            return rows;
        } catch (err) {
            console.error(TAG, `getTestResults error for hypothesis #${hypothesisId}:`, err.message);
            throw err;
        }
    }

    return {
        generateHypotheses,
        runRetrospectiveTest,
        getHypotheses,
        getTestResults
    };
};
