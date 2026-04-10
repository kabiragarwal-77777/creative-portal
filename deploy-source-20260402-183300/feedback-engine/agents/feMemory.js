// =============================================================================
// Feedback Engine — Long-Term Memory Agent
// Maintains episodic, semantic, and procedural memory of everything the portal
// has learned. Nightly consolidation via Claude API.
// =============================================================================

const { callAI, callAIJson } = require('./feAI');
const { insert, update, getAll, count, query, getFeDb } = require('../db/fe-db');
const PREFIX = '[FE:Memory]';

module.exports = function (config = {}) {

    const BASELINE_SEMANTIC_RULES = [
        {
            rule_text: 'Status hierarchy rule: if a campaign is off or paused, all of its child adsets should be treated as effectively off by default.',
            category: 'status_hierarchy',
            confidence_pct: 100,
            evidence_summary: 'Manual platform rule added on 2026-03-31: campaign-off status cascades down to child adsets by default.'
        },
        {
            rule_text: 'Status hierarchy rule: if an adset is off or paused, all of its child ads should be treated as effectively off by default.',
            category: 'status_hierarchy',
            confidence_pct: 100,
            evidence_summary: 'Manual platform rule added on 2026-03-31: adset-off status cascades down to child ads by default.'
        }
    ];

    function ensureBaselineSemanticRules() {
        try {
            getFeDb();
            let insertedCount = 0;

            for (const rule of BASELINE_SEMANTIC_RULES) {
                const existing = query(
                    `SELECT id, category, confidence_pct, evidence_count, evidence_summary
                     FROM fe_memory_semantic
                     WHERE rule_text = ? AND is_active = 1
                     ORDER BY id DESC
                     LIMIT 1`,
                    [rule.rule_text]
                );

                if (!existing.length) {
                    insert('fe_memory_semantic', {
                        rule_text: rule.rule_text,
                        category: rule.category,
                        confidence_pct: rule.confidence_pct,
                        evidence_count: 1,
                        evidence_summary: rule.evidence_summary,
                        first_observed: new Date().toISOString(),
                        last_validated: new Date().toISOString(),
                        is_active: 1
                    });
                    insertedCount++;
                    continue;
                }

                const current = existing[0];
                update('fe_memory_semantic', current.id, {
                    category: current.category || rule.category,
                    confidence_pct: Math.max(Number(current.confidence_pct) || 0, rule.confidence_pct),
                    evidence_count: Math.max(Number(current.evidence_count) || 1, 1),
                    evidence_summary: current.evidence_summary || rule.evidence_summary,
                    last_validated: new Date().toISOString()
                });
            }

            if (insertedCount > 0) {
                console.log(`${PREFIX} Seeded ${insertedCount} baseline semantic rule(s).`);
            }
        } catch (err) {
            console.error(`${PREFIX} ensureBaselineSemanticRules() error:`, err.message);
        }
    }

    ensureBaselineSemanticRules();

    // ── 1. consolidate() — Nightly memory consolidation ──────────────────
    async function consolidate() {
        try {
            console.log(`${PREFIX} Starting nightly memory consolidation...`);

            // Pull new hypothesis test results from last 24h
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

            const recentTests = query(
                `SELECT ht.*, h.hypothesis_text, h.type
                 FROM fe_hypothesis_tests ht
                 LEFT JOIN fe_hypotheses h ON h.id = ht.hypothesis_id
                 WHERE ht.completed_at >= ?
                 ORDER BY ht.completed_at DESC`,
                [since]
            );

            // Pull recent accuracy audits
            const recentAudits = query(
                `SELECT * FROM fe_audit_reports
                 WHERE created_at >= ?
                 ORDER BY created_at DESC`,
                [since]
            );

            // Pull applied changes from change log
            const recentChanges = query(
                `SELECT cl.*, p.title as proposal_title, p.proposal_type
                 FROM fe_change_log cl
                 LEFT JOIN fe_proposals p ON p.id = cl.proposal_id
                 WHERE cl.applied_at >= ?
                 ORDER BY cl.applied_at DESC`,
                [since]
            );

            // If nothing new, skip
            if (recentTests.length === 0 && recentAudits.length === 0 && recentChanges.length === 0) {
                console.log(`${PREFIX} No new data to consolidate. Skipping.`);
                return { skipped: true, reason: 'no_new_data' };
            }

            // Build existing memory summary
            const existingSemantic = getAll('fe_memory_semantic', { is_active: 1 }, 'confidence_pct DESC', 50);
            const existingEpisodic = query(
                `SELECT * FROM fe_memory_episodic ORDER BY event_date DESC LIMIT 20`
            );
            const existingProcedural = query(
                `SELECT * FROM fe_memory_procedural ORDER BY applied_at DESC LIMIT 20`
            );

            const memorySummary = {
                semantic_rules: existingSemantic.map(r => ({
                    id: r.id,
                    rule: r.rule_text,
                    category: r.category,
                    confidence: r.confidence_pct,
                    evidence_count: r.evidence_count
                })),
                recent_episodic: existingEpisodic.map(e => ({
                    date: e.event_date,
                    observation: e.observation,
                    context: e.context_type
                })),
                recent_procedural: existingProcedural.map(p => ({
                    change: p.description,
                    outcome: p.outcome,
                    improvement: p.improvement_pct
                }))
            };

            const newData = {
                hypothesis_tests: recentTests.map(t => ({
                    hypothesis: t.hypothesis_text,
                    type: t.type,
                    result: t.result,
                    confidence: t.confidence_pct,
                    effect_size: t.effect_size,
                    evidence: t.evidence_summary
                })),
                accuracy_audits: recentAudits.map(a => ({
                    date: a.audit_date,
                    meta_accuracy: a.meta_accuracy_pct,
                    google_accuracy: a.google_accuracy_pct,
                    backtest_improvement: a.backtest_improvement_pct
                })),
                applied_changes: recentChanges.map(c => ({
                    type: c.change_type,
                    description: c.change_description,
                    proposal: c.proposal_title,
                    verification: c.verification_result
                }))
            };

            // Call AI for memory extraction
            const parsed = await callAIJson(
                `You are building the long-term memory of Univest's Creative Intelligence system.

New information from the last 24 hours:
${JSON.stringify(newData, null, 2)}

Existing memory summary:
${JSON.stringify(memorySummary, null, 2)}

Extract:
1) New episodic memories (specific dated events/observations worth remembering)
2) Updates to existing semantic rules (reference by id, adjust confidence or evidence_count)
3) New semantic rules discovered (general truths about ad performance)
4) Procedural lessons (what worked or didn't when the system made changes)

Return valid JSON only, no markdown:
{
  "episodic": [{ "event_date": "ISO", "context_type": "string", "market_condition": "string|null", "observation": "string", "confidence_pct": number }],
  "semantic_updates": [{ "id": number, "confidence_pct": number, "evidence_count": number, "evidence_summary": "string" }],
  "semantic_new": [{ "rule_text": "string", "category": "string", "confidence_pct": number, "evidence_summary": "string" }],
  "procedural": [{ "change_type": "string", "description": "string", "outcome": "string", "improvement_pct": number|null }]
}`,
                { maxTokens: 4096, fallback: { episodic: [], semantic_updates: [], semantic_new: [], procedural: [] } }
            );

            let stored = 0;

            // Store episodic memories
            if (parsed.episodic && Array.isArray(parsed.episodic)) {
                for (const ep of parsed.episodic) {
                    insert('fe_memory_episodic', {
                        event_date: ep.event_date || new Date().toISOString(),
                        context_type: ep.context_type || 'general',
                        market_condition: ep.market_condition || null,
                        observation: ep.observation,
                        confidence_pct: ep.confidence_pct || 50,
                        supporting_evidence_json: JSON.stringify(newData)
                    });
                    stored++;
                }
            }

            // Update existing semantic rules
            if (parsed.semantic_updates && Array.isArray(parsed.semantic_updates)) {
                for (const su of parsed.semantic_updates) {
                    if (!su.id) continue;
                    update('fe_memory_semantic', su.id, {
                        confidence_pct: su.confidence_pct,
                        evidence_count: su.evidence_count,
                        evidence_summary: su.evidence_summary,
                        last_validated: new Date().toISOString()
                    });
                    stored++;
                }
            }

            // Store new semantic rules
            if (parsed.semantic_new && Array.isArray(parsed.semantic_new)) {
                for (const sn of parsed.semantic_new) {
                    insert('fe_memory_semantic', {
                        rule_text: sn.rule_text,
                        category: sn.category || 'general',
                        confidence_pct: sn.confidence_pct || 50,
                        evidence_count: 1,
                        evidence_summary: sn.evidence_summary || null,
                        first_observed: new Date().toISOString(),
                        last_validated: new Date().toISOString()
                    });
                    stored++;
                }
            }

            // Store procedural lessons
            if (parsed.procedural && Array.isArray(parsed.procedural)) {
                for (const pr of parsed.procedural) {
                    insert('fe_memory_procedural', {
                        change_type: pr.change_type || 'unknown',
                        description: pr.description,
                        outcome: pr.outcome || null,
                        improvement_pct: pr.improvement_pct || null
                    });
                    stored++;
                }
            }

            console.log(`${PREFIX} Consolidation complete. Stored ${stored} memory items.`);
            return { stored, parsed };

        } catch (err) {
            console.error(`${PREFIX} consolidate() error:`, err.message);
            throw err;
        }
    }

    // ── 2. getEpisodic(filters) ──────────────────────────────────────────
    async function getEpisodic(filters = {}) {
        try {
            const conditions = [];
            const params = [];

            if (filters.days) {
                const since = new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000).toISOString();
                conditions.push('event_date >= ?');
                params.push(since);
            }

            if (filters.topic) {
                conditions.push('(observation LIKE ? OR context_type LIKE ?)');
                params.push(`%${filters.topic}%`, `%${filters.topic}%`);
            }

            let sql = 'SELECT * FROM fe_memory_episodic';
            if (conditions.length) {
                sql += ' WHERE ' + conditions.join(' AND ');
            }
            sql += ' ORDER BY event_date DESC LIMIT 100';

            return query(sql, params);
        } catch (err) {
            console.error(`${PREFIX} getEpisodic() error:`, err.message);
            throw err;
        }
    }

    // ── 3. getSemantic() ─────────────────────────────────────────────────
    async function getSemantic() {
        try {
            return getAll('fe_memory_semantic', { is_active: 1 }, 'confidence_pct DESC', 500);
        } catch (err) {
            console.error(`${PREFIX} getSemantic() error:`, err.message);
            throw err;
        }
    }

    // ── 4. getProcedural() ───────────────────────────────────────────────
    async function getProcedural() {
        try {
            return getAll('fe_memory_procedural', {}, 'applied_at DESC', 200);
        } catch (err) {
            console.error(`${PREFIX} getProcedural() error:`, err.message);
            throw err;
        }
    }

    // ── 5. search(searchQuery) — text search across all memory tables ───
    async function search(searchQuery) {
        try {
            if (!searchQuery || !searchQuery.trim()) {
                return { episodic: [], semantic: [], procedural: [] };
            }

            const term = `%${searchQuery.trim()}%`;

            const episodic = query(
                `SELECT *, 'episodic' as memory_type FROM fe_memory_episodic
                 WHERE observation LIKE ? OR context_type LIKE ? OR market_condition LIKE ?
                 ORDER BY event_date DESC LIMIT 50`,
                [term, term, term]
            );

            const semantic = query(
                `SELECT *, 'semantic' as memory_type FROM fe_memory_semantic
                 WHERE rule_text LIKE ? OR category LIKE ? OR evidence_summary LIKE ?
                 ORDER BY confidence_pct DESC LIMIT 50`,
                [term, term, term]
            );

            const procedural = query(
                `SELECT *, 'procedural' as memory_type FROM fe_memory_procedural
                 WHERE description LIKE ? OR outcome LIKE ? OR change_type LIKE ?
                 ORDER BY applied_at DESC LIMIT 50`,
                [term, term, term]
            );

            return { episodic, semantic, procedural };
        } catch (err) {
            console.error(`${PREFIX} search() error:`, err.message);
            throw err;
        }
    }

    // ── 6. getMemorySummary() — counts + top rules for Claude context ───
    async function getMemorySummary() {
        try {
            const episodicCount = count('fe_memory_episodic');
            const semanticCount = count('fe_memory_semantic', { is_active: 1 });
            const proceduralCount = count('fe_memory_procedural');

            const topRules = query(
                `SELECT rule_text, category, confidence_pct, evidence_count
                 FROM fe_memory_semantic
                 WHERE is_active = 1
                 ORDER BY confidence_pct DESC
                 LIMIT 10`
            );

            const recentEpisodic = query(
                `SELECT event_date, observation, context_type
                 FROM fe_memory_episodic
                 ORDER BY event_date DESC
                 LIMIT 5`
            );

            const recentProcedural = query(
                `SELECT change_type, description, outcome, improvement_pct
                 FROM fe_memory_procedural
                 ORDER BY applied_at DESC
                 LIMIT 5`
            );

            return {
                counts: {
                    episodic: episodicCount,
                    semantic: semanticCount,
                    procedural: proceduralCount
                },
                top_semantic_rules: topRules,
                recent_episodic: recentEpisodic,
                recent_procedural: recentProcedural
            };
        } catch (err) {
            console.error(`${PREFIX} getMemorySummary() error:`, err.message);
            throw err;
        }
    }

    return {
        consolidate,
        getEpisodic,
        getSemantic,
        getProcedural,
        search,
        getMemorySummary
    };
};
