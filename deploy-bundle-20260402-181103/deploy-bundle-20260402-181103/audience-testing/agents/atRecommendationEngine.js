/**
 * AT Recommendation Engine
 * Generates audience test recommendations and live optimization actions
 * based on learned patterns from the Learning Engine.
 */

module.exports = function(config) {
    const { getAtDb } = require('../db/at-db');
    const axios = require('axios');

    const ANTHROPIC_API_KEY = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
    const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

    const VERTICALS = ['MFA', 'Broking', 'RA'];

    // --------------- helpers ---------------

    function log(...args) {
        console.log('[AT Recommendations]', ...args);
    }

    function safeParseJSON(str) {
        if (!str) return null;
        try { return JSON.parse(str); } catch (e) { return str; }
    }

    // --------------- Claude API ---------------

    async function callClaudeAPI(prompt, maxTokens) {
        if (!ANTHROPIC_API_KEY) { console.warn('[AT Recommendations] No ANTHROPIC_API_KEY'); return null; }
        try {
            const resp = await axios.post('https://api.anthropic.com/v1/messages', {
                model: CLAUDE_MODEL, max_tokens: maxTokens || 3000,
                messages: [{ role: 'user', content: prompt }]
            }, {
                headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
                timeout: 60000
            });
            const content = resp.data?.content?.[0]?.text;
            if (!content) return null;
            let cleaned = content.trim();
            if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
            return JSON.parse(cleaned);
        } catch(err) { console.error('[AT Recommendations] Claude API error:', err.message); return null; }
    }

    // --------------- generateFutureTests ---------------

    async function generateFutureTests(platform, vertical) {
        log(`Generating future test recommendations for ${platform} / ${vertical}...`);
        const db = getAtDb();

        // Get top patterns for this platform
        const patternTable = platform === 'google' ? 'at_google_patterns' : 'at_meta_patterns';
        const patterns = db.prepare(`
            SELECT * FROM ${patternTable}
            WHERE confidence IN ('HIGH', 'MEDIUM')
            ORDER BY avg_d6_cac ASC
            LIMIT 30
        `).all();

        // Get live adsets for context
        let liveAdsets;
        if (platform === 'meta') {
            liveAdsets = db.prepare(`
                SELECT a.*, c.vertical FROM at_meta_adsets a
                LEFT JOIN at_meta_campaigns c ON a.meta_campaign_id = c.meta_campaign_id
                WHERE a.status IN ('ACTIVE', 'PAUSED') AND (c.vertical = ? OR ? = 'All')
                ORDER BY a.total_spend DESC
                LIMIT 50
            `).all(vertical, vertical);
        } else {
            liveAdsets = db.prepare(`
                SELECT ag.*, gc.vertical FROM at_google_adgroups ag
                LEFT JOIN at_google_campaigns gc ON ag.google_campaign_id = gc.google_campaign_id
                WHERE ag.status IN ('ENABLED', 'PAUSED') AND (gc.vertical = ? OR ? = 'All')
                ORDER BY ag.total_spend DESC
                LIMIT 50
            `).all(vertical, vertical);
        }

        const patternsFormatted = patterns.map(p => ({
            type: p.pattern_type,
            key: p.pattern_key,
            avg_d6_cac: p.avg_d6_cac,
            avg_d6_roas: p.avg_d6_roas,
            spend: p.total_spend,
            sample: p.sample_adsets,
            confidence: p.confidence
        }));

        const liveFormatted = liveAdsets.map(a => ({
            name: a.name,
            status: a.status,
            spend: a.total_spend,
            d6_cac: a.d6_cac,
            d6_roas: a.d6_roas,
            vertical: a.vertical
        }));

        const prompt = `You are a performance marketing strategist for a fintech app (Univest) in India. Platform: ${platform}. Vertical: ${vertical}.

LEARNED PATTERNS (from historical data):
${JSON.stringify(patternsFormatted, null, 2)}

CURRENT LIVE ADSETS/ADGROUPS:
${JSON.stringify(liveFormatted, null, 2)}

Design 5-8 NEW audience tests that explore untested combinations or double down on winning patterns. Avoid duplicating what's already live.

Return JSON array of tests:
[
  {
    "test_name": "descriptive name",
    "hypothesis": "what we expect and why",
    "targeting_spec": {
      "age_min": 18,
      "age_max": 35,
      "genders": [1, 2],
      "geo": "India",
      "interests": ["list of interests or empty"],
      "custom_audiences": ["list or empty"],
      "excluded_audiences": ["list or empty"],
      "publisher_platforms": ["facebook", "instagram"],
      "device_platforms": ["mobile"]
    },
    "recommended_daily_budget_inr": 1500,
    "success_metric": "d6_cac",
    "success_threshold": 500,
    "expected_d6_cac_range": [300, 600],
    "kill_criteria": "Pause if D6 CAC > 800 after 10000 INR spend",
    "priority": "high",
    "vertical": "${vertical}"
  }
]`;

        const tests = await callClaudeAPI(prompt, 4000);

        if (!tests || !Array.isArray(tests)) {
            log(`Failed to generate test recommendations for ${platform}/${vertical}.`);
            return 0;
        }

        const insertRec = db.prepare(`
            INSERT INTO at_recommendations
                (platform, rec_type, vertical, title, hypothesis, targeting_spec_json,
                 expected_d6_cac, priority, urgency, status, generated_at)
            VALUES (@platform, 'test', @vertical, @title, @hypothesis, @targeting_spec_json,
                    @expected_d6_cac, @priority, 'this_week', 'pending', datetime('now'))
        `);

        const insertAll = db.transaction((items) => {
            for (const item of items) {
                insertRec.run(item);
            }
        });

        const rows = tests.map(t => ({
            platform,
            vertical: t.vertical || vertical,
            title: t.test_name || 'Untitled Test',
            hypothesis: t.hypothesis || '',
            targeting_spec_json: JSON.stringify({
                ...t.targeting_spec,
                recommended_daily_budget_inr: t.recommended_daily_budget_inr,
                success_metric: t.success_metric,
                success_threshold: t.success_threshold,
                expected_d6_cac_range: t.expected_d6_cac_range,
                kill_criteria: t.kill_criteria
            }),
            expected_d6_cac: t.expected_d6_cac_range ? (t.expected_d6_cac_range[0] + t.expected_d6_cac_range[1]) / 2 : null,
            priority: t.priority || 'medium'
        }));

        insertAll(rows);
        log(`Stored ${rows.length} test recommendations for ${platform}/${vertical}.`);
        return rows.length;
    }

    // --------------- generateCurrentOptimizations ---------------

    async function generateCurrentOptimizations(platform) {
        log(`Generating optimization recommendations for ${platform}...`);
        const db = getAtDb();

        // Get patterns
        const patternTable = platform === 'google' ? 'at_google_patterns' : 'at_meta_patterns';
        const patterns = db.prepare(`
            SELECT * FROM ${patternTable}
            ORDER BY avg_d6_cac ASC
        `).all();

        // Get live adsets
        let liveAdsets;
        if (platform === 'meta') {
            liveAdsets = db.prepare(`
                SELECT a.*, c.vertical, c.name as campaign_name FROM at_meta_adsets a
                LEFT JOIN at_meta_campaigns c ON a.meta_campaign_id = c.meta_campaign_id
                WHERE a.status = 'ACTIVE' AND a.total_spend > 0
                ORDER BY a.total_spend DESC
            `).all();
        } else {
            liveAdsets = db.prepare(`
                SELECT ag.*, gc.vertical, gc.name as campaign_name FROM at_google_adgroups ag
                LEFT JOIN at_google_campaigns gc ON ag.google_campaign_id = gc.google_campaign_id
                WHERE ag.status = 'ENABLED' AND ag.total_spend > 0
                ORDER BY ag.total_spend DESC
            `).all();
        }

        if (liveAdsets.length === 0) {
            log(`No active adsets found for ${platform}. Skipping optimizations.`);
            return 0;
        }

        const patternsFormatted = patterns.map(p => ({
            type: p.pattern_type,
            key: p.pattern_key,
            avg_d6_cac: p.avg_d6_cac,
            avg_d6_roas: p.avg_d6_roas,
            confidence: p.confidence
        }));

        const liveFormatted = liveAdsets.map(a => {
            const base = {
                id: platform === 'meta' ? a.meta_adset_id : a.google_adgroup_id,
                name: a.name,
                campaign: a.campaign_name,
                vertical: a.vertical,
                spend: a.total_spend,
                d6_cac: a.d6_cac,
                d6_roas: a.d6_roas
            };
            if (platform === 'meta') {
                base.age_min = a.age_min;
                base.age_max = a.age_max;
                base.genders = a.genders_json;
                base.interests = a.interests_json;
                base.custom_audiences = a.custom_audiences_json;
                base.placements = a.publisher_platforms_json;
                base.devices = a.device_platforms_json;
                base.impressions = a.impressions;
                base.ctr = a.ctr;
                base.cpm = a.cpm;
                base.frequency = a.frequency;
            } else {
                base.conversions = a.conversions;
                base.ctr = a.ctr;
                base.avg_cpc = a.avg_cpc;
                base.cost_per_conversion = a.cost_per_conversion;
            }
            return base;
        });

        const prompt = `You are a performance marketing optimizer for Univest (fintech, India). Platform: ${platform}.

LEARNED PATTERNS:
${JSON.stringify(patternsFormatted, null, 2)}

CURRENTLY ACTIVE ADSETS/ADGROUPS:
${JSON.stringify(liveFormatted, null, 2)}

For EACH active adset/adgroup, recommend ONE action. Actions: PAUSE, SCALE, AUDIENCE_NARROW, AUDIENCE_BROADEN, BID_ADJUST, PLACEMENT_EXCLUDE, AGE_ADJUST, GENDER_SPLIT, KEEP.

Return JSON array:
[
  {
    "adset_id": "id",
    "adset_name": "name",
    "action_type": "PAUSE",
    "rationale": "why this action",
    "specific_change": "detailed instruction for what to change",
    "expected_impact": "what improvement we expect",
    "priority": "high|medium|low",
    "urgency": "immediate|this_week|next_week",
    "current_d6_cac": N,
    "current_d6_roas": N
  }
]`;

        const optimizations = await callClaudeAPI(prompt, 6000);

        if (!optimizations || !Array.isArray(optimizations)) {
            log(`Failed to generate optimizations for ${platform}.`);
            return 0;
        }

        const insertRec = db.prepare(`
            INSERT INTO at_recommendations
                (platform, rec_type, vertical, title, action_type, rationale, specific_change,
                 expected_impact, priority, urgency, status, adset_id, adset_name,
                 current_d6_cac, current_d6_roas, generated_at)
            VALUES (@platform, 'optimization', @vertical, @title, @action_type, @rationale,
                    @specific_change, @expected_impact, @priority, @urgency, 'pending',
                    @adset_id, @adset_name, @current_d6_cac, @current_d6_roas, datetime('now'))
        `);

        // Build a vertical lookup from live adsets
        const verticalLookup = {};
        for (const a of liveAdsets) {
            const id = platform === 'meta' ? a.meta_adset_id : a.google_adgroup_id;
            verticalLookup[id] = a.vertical || 'Unknown';
        }

        const insertAll = db.transaction((items) => {
            for (const item of items) {
                insertRec.run(item);
            }
        });

        const rows = optimizations.map(o => ({
            platform,
            vertical: verticalLookup[o.adset_id] || 'Unknown',
            title: `${o.action_type}: ${o.adset_name || o.adset_id}`,
            action_type: o.action_type || 'KEEP',
            rationale: o.rationale || '',
            specific_change: o.specific_change || '',
            expected_impact: o.expected_impact || '',
            priority: o.priority || 'medium',
            urgency: o.urgency || 'this_week',
            adset_id: o.adset_id || '',
            adset_name: o.adset_name || '',
            current_d6_cac: o.current_d6_cac || null,
            current_d6_roas: o.current_d6_roas || null
        }));

        insertAll(rows);
        log(`Stored ${rows.length} optimization recommendations for ${platform}.`);
        return rows.length;
    }

    // --------------- generateAll ---------------

    async function generateAll() {
        log('=== Generating all recommendations ===');
        const db = getAtDb();
        const startTime = Date.now();

        // Clear old pending recommendations
        const deleted = db.prepare("DELETE FROM at_recommendations WHERE status = 'pending'").run();
        log(`Cleared ${deleted.changes} old pending recommendations.`);

        let totalTests = 0;
        let totalOptimizations = 0;

        // Generate tests for all verticals on both platforms
        for (const vertical of VERTICALS) {
            const metaTests = await generateFutureTests('meta', vertical);
            totalTests += metaTests;

            const googleTests = await generateFutureTests('google', vertical);
            totalTests += googleTests;
        }

        // Generate optimizations for both platforms
        const metaOpts = await generateCurrentOptimizations('meta');
        totalOptimizations += metaOpts;

        const googleOpts = await generateCurrentOptimizations('google');
        totalOptimizations += googleOpts;

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const summary = {
            tests: totalTests,
            optimizations: totalOptimizations,
            total: totalTests + totalOptimizations,
            elapsedSeconds: parseFloat(elapsed)
        };

        log(`=== All recommendations generated in ${elapsed}s ===`, JSON.stringify(summary));
        return summary;
    }

    // --------------- getRecommendations ---------------

    function getRecommendations(filters) {
        const db = getAtDb();
        const conditions = [];
        const params = {};

        if (filters && filters.platform) {
            conditions.push('platform = @platform');
            params.platform = filters.platform;
        }
        if (filters && filters.rec_type) {
            conditions.push('rec_type = @rec_type');
            params.rec_type = filters.rec_type;
        }
        if (filters && filters.vertical) {
            conditions.push('vertical = @vertical');
            params.vertical = filters.vertical;
        }
        if (filters && filters.priority) {
            conditions.push('priority = @priority');
            params.priority = filters.priority;
        }
        if (filters && filters.urgency) {
            conditions.push('urgency = @urgency');
            params.urgency = filters.urgency;
        }
        if (filters && filters.status) {
            conditions.push('status = @status');
            params.status = filters.status;
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        const sql = `SELECT * FROM at_recommendations ${whereClause} ORDER BY
            CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
            CASE urgency WHEN 'immediate' THEN 1 WHEN 'this_week' THEN 2 WHEN 'next_week' THEN 3 ELSE 4 END,
            generated_at DESC`;

        const rows = db.prepare(sql).all(params);
        log(`Retrieved ${rows.length} recommendations with filters: ${JSON.stringify(filters || {})}`);

        return rows.map(r => ({
            ...r,
            targeting_spec: safeParseJSON(r.targeting_spec_json)
        }));
    }

    // --------------- markImplemented ---------------

    function markImplemented(id) {
        const db = getAtDb();
        const result = db.prepare(`
            UPDATE at_recommendations
            SET status = 'implemented', implemented_at = datetime('now')
            WHERE id = ?
        `).run(id);
        log(`Marked recommendation ${id} as implemented. Changes: ${result.changes}`);
        return result.changes > 0;
    }

    // --------------- dismiss ---------------

    function dismiss(id, reason) {
        const db = getAtDb();
        const result = db.prepare(`
            UPDATE at_recommendations
            SET status = 'dismissed', dismissed_reason = ?
            WHERE id = ?
        `).run(reason || '', id);
        log(`Dismissed recommendation ${id}. Reason: ${reason || 'none'}. Changes: ${result.changes}`);
        return result.changes > 0;
    }

    // --------------- public API ---------------

    return {
        generateAll,
        getRecommendations,
        markImplemented,
        dismiss
    };
};
