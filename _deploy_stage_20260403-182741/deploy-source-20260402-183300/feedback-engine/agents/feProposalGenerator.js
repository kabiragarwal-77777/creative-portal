// =============================================================================
// Feedback Engine — Proposal Generator Agent
// Synthesizes signals from all other agents into structured improvement proposals.
// Runs every 6 hours via scheduler.
// =============================================================================

const { callAI, callAIJson } = require('./feAI');
const { insert, update, getOne, getAll, query, run, logSchedulerStart, logSchedulerEnd } = require('../db/fe-db');
const TAG = '[FE:ProposalGenerator]';

const VALID_PROPOSAL_TYPES = [
    'WEIGHT_RECALIBRATION',
    'NEW_SIGNAL',
    'TAXONOMY_EXPANSION',
    'SOURCE_ADDITION',
    'RECOMMENDATION_IMPROVEMENT',
    'ARCHETYPE_SPLIT',
    'SCORING_FORMULA_UPDATE',
    'KNOWLEDGE_PURGE'
];

module.exports = function (config = {}) {

    // ── 1. generateProposals ───────────────────────────────────────────────
    async function generateProposals() {
        const logId = logSchedulerStart('proposal_generator_generate');
        try {
            console.log(TAG, 'Generating improvement proposals...');

            const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

            // Pull recent prediction errors
            const recentErrors = query(
                `SELECT source, accuracy_tag, error_d7, error_d30, error_d60,
                        predicted_roas_d7, actual_roas_d7, ad_id, created_at
                 FROM fe_prediction_accuracy
                 ORDER BY created_at DESC
                 LIMIT 30`
            );

            // Pull high-urgency knowledge items from last 6h
            const recentKnowledge = query(
                `SELECT signal_type, key_insight, action_implication, urgency, source_type, ingested_at
                 FROM fe_knowledge_items
                 WHERE ingested_at >= ? OR urgency = 'high'
                 ORDER BY ingested_at DESC
                 LIMIT 20`,
                [sixHoursAgo]
            );

            // Pull recent hypothesis test results
            const recentTests = query(
                `SELECT ht.result, ht.confidence_pct, ht.effect_size, ht.evidence_summary,
                        h.hypothesis_text, h.type
                 FROM fe_hypothesis_tests ht
                 JOIN fe_hypotheses h ON h.id = ht.hypothesis_id
                 ORDER BY ht.completed_at DESC
                 LIMIT 15`
            );

            // Pull active anomalies
            const activeAnomalies = getAll('fe_anomalies', { is_resolved: 0 }, 'detected_at DESC', 20);

            // Pull recommendation adoption rates
            const adoptionStats = query(
                `SELECT source, adoption_status, COUNT(*) as cnt
                 FROM fe_recommendation_tracking
                 GROUP BY source, adoption_status
                 ORDER BY source, cnt DESC`
            );

            const dataPayload = {
                recent_errors: recentErrors,
                knowledge_items: recentKnowledge,
                hypothesis_results: recentTests,
                active_anomalies: activeAnomalies.map(a => ({
                    type: a.anomaly_type,
                    severity: a.severity,
                    title: a.title,
                    description: a.description,
                    detected_value: a.detected_value,
                    expected_value: a.expected_value
                })),
                adoption_rates: adoptionStats
            };

            const prompt = `You are the self-improvement engine for Univest's Creative Intelligence Portal. This portal predicts ad creative performance and recommends new creatives. Your job is to generate specific improvement proposals.

New signals from the last cycle:
${JSON.stringify(dataPayload, null, 2).substring(0, 8000)}

Valid proposal types: ${VALID_PROPOSAL_TYPES.join(', ')}

Generate improvement proposals. Each must be:
- Specific and implementable (not vague)
- Include expected impact with a measurable metric
- Include risk assessment
- Be reversible (preferably)
- Address the most impactful issues first

Return ONLY a valid JSON array. Each element must have:
- proposal_type: one of the valid types listed above
- title: short descriptive title
- description: detailed description of what to change
- rationale: why this change is needed, citing specific data
- expected_impact_metric: which metric will improve (e.g., "meta_accuracy_pct", "adoption_rate")
- expected_impact_delta: expected numeric improvement (e.g., 5.0 for +5%)
- risk_level: "low", "medium", or "high"
- is_reversible: true or false
- dependencies: array of strings (what must be in place first, empty array if none)

Generate 2-6 proposals ranked by priority. Return valid JSON array only, no markdown fences.`;

            const proposals = await callAIJson(prompt, { maxTokens: 3000, fallback: [] });

            if (!Array.isArray(proposals) || proposals.length === 0) {
                console.warn(`${TAG} AI returned empty or no response — skipping proposal generation`);
                return [];
            }

            const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
            const insertedIds = [];

            for (const p of proposals) {
                // Validate proposal_type
                const pType = VALID_PROPOSAL_TYPES.includes(p.proposal_type)
                    ? p.proposal_type
                    : 'RECOMMENDATION_IMPROVEMENT';

                const id = insert('fe_proposals', {
                    proposal_type: pType,
                    title: p.title || 'Untitled proposal',
                    description: p.description || '',
                    rationale: p.rationale || '',
                    evidence_json: JSON.stringify(dataPayload).substring(0, 10000),
                    expected_impact_metric: p.expected_impact_metric || 'unknown',
                    expected_impact_delta: p.expected_impact_delta || 0,
                    risk_level: ['low', 'medium', 'high'].includes(p.risk_level) ? p.risk_level : 'low',
                    is_reversible: p.is_reversible === false ? 0 : 1,
                    dependencies_json: JSON.stringify(p.dependencies || []),
                    status: 'pending',
                    generated_by_agent: 'feProposalGenerator',
                    generated_at: new Date().toISOString(),
                    expires_at: expiresAt
                });

                insertedIds.push(id);
                console.log(TAG, `Proposal #${id}: [${pType}] ${(p.title || '').substring(0, 60)}`);
            }

            logSchedulerEnd(logId, insertedIds.length);
            console.log(TAG, `Generated ${insertedIds.length} proposals (expire ${expiresAt})`);
            return { generated: insertedIds.length, ids: insertedIds };

        } catch (err) {
            console.error(TAG, 'generateProposals error:', err.message);
            logSchedulerEnd(logId, 0, err.message);
            throw err;
        }
    }

    // ── 2. getProposals ────────────────────────────────────────────────────
    async function getProposals(filters = {}) {
        try {
            const where = {};
            if (filters.status) where.status = filters.status;
            if (filters.proposal_type) where.proposal_type = filters.proposal_type;
            if (filters.risk_level) where.risk_level = filters.risk_level;

            const rows = getAll('fe_proposals', where, 'id DESC', filters.limit || 100);

            // Parse JSON fields for convenience
            const parsed = rows.map(r => ({
                ...r,
                dependencies: r.dependencies_json ? JSON.parse(r.dependencies_json) : [],
                is_reversible: !!r.is_reversible
            }));

            console.log(TAG, `getProposals: returned ${parsed.length} rows`);
            return parsed;
        } catch (err) {
            console.error(TAG, 'getProposals error:', err.message);
            throw err;
        }
    }

    // ── 3. getProposal ────────────────────────────────────────────────────
    async function getProposal(id) {
        try {
            const row = getOne('fe_proposals', id);
            if (!row) return null;

            const parsed = {
                ...row,
                dependencies: row.dependencies_json ? JSON.parse(row.dependencies_json) : [],
                evidence: row.evidence_json ? JSON.parse(row.evidence_json) : null,
                is_reversible: !!row.is_reversible
            };

            console.log(TAG, `getProposal #${id}: ${row.title}`);
            return parsed;
        } catch (err) {
            console.error(TAG, `getProposal error for #${id}:`, err.message);
            throw err;
        }
    }

    // ── 4. expireOldProposals ──────────────────────────────────────────────
    async function expireOldProposals() {
        try {
            const now = new Date().toISOString();
            const result = run(
                `UPDATE fe_proposals SET status = 'expired'
                 WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < ?`,
                [now]
            );
            const expired = result.changes || 0;
            if (expired > 0) {
                console.log(TAG, `Expired ${expired} old proposals`);
            }
            return { expired };
        } catch (err) {
            console.error(TAG, 'expireOldProposals error:', err.message);
            throw err;
        }
    }

    return {
        generateProposals,
        getProposals,
        getProposal,
        expireOldProposals
    };
};
