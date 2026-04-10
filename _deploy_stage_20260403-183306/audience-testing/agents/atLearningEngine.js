/**
 * AT Learning Engine
 * Analyzes scanned + enriched audience data to extract patterns.
 * Uses Claude API for AI-powered synthesis of performance patterns.
 */

module.exports = function(config) {
    const { getAtDb } = require('../db/at-db');
    const axios = require('axios');

    const ANTHROPIC_API_KEY = config.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
    const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

    // --------------- helpers ---------------

    function log(...args) {
        console.log('[AT Learning]', ...args);
    }

    function confidenceLevel(sampleSize) {
        if (sampleSize >= 100) return 'HIGH';
        if (sampleSize >= 30) return 'MEDIUM';
        if (sampleSize >= 10) return 'LOW';
        return 'INSUFFICIENT';
    }

    function safeDivide(num, denom) {
        if (!denom || denom <= 0 || num == null) return 0;
        return Math.round((num / denom) * 100) / 100;
    }

    function getAgeBucket(ageMin, ageMax) {
        if (ageMin <= 24) return '18-24';
        if (ageMin <= 34) return '25-34';
        if (ageMin <= 44) return '35-44';
        if (ageMin <= 54) return '45-54';
        return '55+';
    }

    function getGenderLabel(gendersJson) {
        try {
            const genders = JSON.parse(gendersJson || '[]');
            if (genders.length === 0 || (genders.includes(1) && genders.includes(2))) return 'All';
            if (genders.includes(1)) return 'Male';
            if (genders.includes(2)) return 'Female';
            return 'All';
        } catch (e) { return 'All'; }
    }

    function getAudienceType(row) {
        try {
            const lookalikes = JSON.parse(row.lookalike_audiences_json || '[]');
            const customs = JSON.parse(row.custom_audiences_json || '[]');
            const interests = JSON.parse(row.interests_json || '[]');
            if (lookalikes.length > 0) return 'lookalike';
            if (customs.length > 0) return 'custom';
            if (interests.length > 0) return 'interest';
            return 'broad';
        } catch (e) { return 'broad'; }
    }

    function getVertical(row, campaignMap) {
        const campaign = campaignMap[row.meta_campaign_id];
        return (campaign && campaign.vertical) || 'Unknown';
    }

    function getPlacement(row) {
        try {
            const platforms = JSON.parse(row.publisher_platforms_json || '[]');
            if (platforms.length === 0) return 'all';
            return platforms.sort().join('+');
        } catch (e) { return 'all'; }
    }

    function getDevice(row) {
        try {
            const devices = JSON.parse(row.device_platforms_json || '[]');
            if (devices.length === 0) return 'all';
            return devices.sort().join('+');
        } catch (e) { return 'all'; }
    }

    // --------------- Claude API ---------------

    async function callClaudeAPI(prompt, maxTokens) {
        if (!ANTHROPIC_API_KEY) { console.warn('[AT Learning] No ANTHROPIC_API_KEY'); return null; }
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
        } catch(err) { console.error('[AT Learning] Claude API error:', err.message); return null; }
    }

    // --------------- groupAndAggregate ---------------

    function groupAndAggregate(adsets, campaignMap, dimensionFn) {
        const groups = {};
        for (const row of adsets) {
            const key = dimensionFn(row, campaignMap);
            if (!groups[key]) {
                groups[key] = { key, totalSpend: 0, totalD6Cac: 0, totalD6Roas: 0, totalConversions: 0, count: 0 };
            }
            const g = groups[key];
            g.totalSpend += row.total_spend || 0;
            g.totalD6Cac += row.d6_cac || 0;
            g.totalD6Roas += row.d6_roas || 0;
            g.totalConversions += row.d6_conversions || 0;
            g.count++;
        }
        return Object.values(groups).map(g => ({
            key: g.key,
            avg_d6_cac: safeDivide(g.totalD6Cac, g.count),
            avg_d6_roas: safeDivide(g.totalD6Roas, g.count),
            total_spend: Math.round(g.totalSpend),
            sample_size: g.count,
            conversions: g.totalConversions
        }));
    }

    // --------------- runMetaAnalysis ---------------

    async function runMetaAnalysis() {
        log('Starting Meta pattern analysis...');
        const db = getAtDb();

        const adsets = db.prepare(`
            SELECT * FROM at_meta_adsets
            WHERE d6_cac IS NOT NULL AND d6_cac > 0 AND total_spend > 5000
            ORDER BY d6_cac ASC
        `).all();

        log(`Found ${adsets.length} qualifying adsets for analysis.`);

        if (adsets.length === 0) {
            log('No qualifying adsets found. Skipping Meta analysis.');
            return { patterns: 0, synthesis: false };
        }

        // Build campaign lookup for verticals
        const campaigns = db.prepare('SELECT meta_campaign_id, vertical FROM at_meta_campaigns').all();
        const campaignMap = {};
        for (const c of campaigns) { campaignMap[c.meta_campaign_id] = c; }

        // Group by each dimension
        const ageBuckets = groupAndAggregate(adsets, campaignMap, (r) => getAgeBucket(r.age_min, r.age_max));
        const genderGroups = groupAndAggregate(adsets, campaignMap, (r) => getGenderLabel(r.genders_json));
        const audienceTypeGroups = groupAndAggregate(adsets, campaignMap, (r) => getAudienceType(r));
        const verticalGroups = groupAndAggregate(adsets, campaignMap, (r, cm) => getVertical(r, cm));
        const placementGroups = groupAndAggregate(adsets, campaignMap, (r) => getPlacement(r));
        const deviceGroups = groupAndAggregate(adsets, campaignMap, (r) => getDevice(r));

        // Find top 10 best combinations (unique combo of age_range + gender + audience_type + vertical)
        const combos = {};
        for (const row of adsets) {
            const age = getAgeBucket(row.age_min, row.age_max);
            const gender = getGenderLabel(row.genders_json);
            const audienceType = getAudienceType(row);
            const vertical = getVertical(row, campaignMap);
            const comboKey = `${age}|${gender}|${audienceType}|${vertical}`;

            if (!combos[comboKey]) {
                combos[comboKey] = {
                    age_range: age, gender, audience_type: audienceType, vertical,
                    totalSpend: 0, totalD6Cac: 0, totalD6Roas: 0, totalConversions: 0, count: 0
                };
            }
            const c = combos[comboKey];
            c.totalSpend += row.total_spend || 0;
            c.totalD6Cac += row.d6_cac || 0;
            c.totalD6Roas += row.d6_roas || 0;
            c.totalConversions += row.d6_conversions || 0;
            c.count++;
        }

        const comboList = Object.values(combos)
            .filter(c => c.count >= 2)
            .map(c => ({
                age_range: c.age_range,
                gender: c.gender,
                audience_type: c.audience_type,
                vertical: c.vertical,
                avg_d6_cac: safeDivide(c.totalD6Cac, c.count),
                avg_d6_roas: safeDivide(c.totalD6Roas, c.count),
                total_spend: Math.round(c.totalSpend),
                sample_size: c.count,
                conversions: c.totalConversions,
                confidence: confidenceLevel(c.count)
            }))
            .sort((a, b) => a.avg_d6_cac - b.avg_d6_cac)
            .slice(0, 10);

        log(`Found ${comboList.length} top combinations.`);

        // Clear old patterns
        db.prepare('DELETE FROM at_meta_patterns').run();

        // Store dimension-level patterns
        const insertPattern = db.prepare(`
            INSERT INTO at_meta_patterns
                (pattern_type, pattern_key, pattern_value_json, avg_d6_cac, avg_d6_roas, total_spend,
                 sample_adsets, sample_conversions, confidence, generated_at)
            VALUES (@pattern_type, @pattern_key, @pattern_value_json, @avg_d6_cac, @avg_d6_roas,
                    @total_spend, @sample_adsets, @sample_conversions, @confidence, datetime('now'))
        `);

        const storeDimensionPatterns = db.transaction((dimName, groups) => {
            for (const g of groups) {
                insertPattern.run({
                    pattern_type: dimName,
                    pattern_key: g.key,
                    pattern_value_json: JSON.stringify(g),
                    avg_d6_cac: g.avg_d6_cac,
                    avg_d6_roas: g.avg_d6_roas,
                    total_spend: g.total_spend,
                    sample_adsets: g.sample_size,
                    sample_conversions: g.conversions,
                    confidence: confidenceLevel(g.sample_size)
                });
            }
        });

        storeDimensionPatterns('age_bucket', ageBuckets);
        storeDimensionPatterns('gender', genderGroups);
        storeDimensionPatterns('audience_type', audienceTypeGroups);
        storeDimensionPatterns('vertical', verticalGroups);
        storeDimensionPatterns('placement', placementGroups);
        storeDimensionPatterns('device', deviceGroups);

        // Store top combos
        const storeComboPatterns = db.transaction((combos) => {
            for (const c of combos) {
                insertPattern.run({
                    pattern_type: 'top_combo',
                    pattern_key: `${c.age_range}|${c.gender}|${c.audience_type}|${c.vertical}`,
                    pattern_value_json: JSON.stringify(c),
                    avg_d6_cac: c.avg_d6_cac,
                    avg_d6_roas: c.avg_d6_roas,
                    total_spend: c.total_spend,
                    sample_adsets: c.sample_size,
                    sample_conversions: c.conversions,
                    confidence: c.confidence
                });
            }
        });
        storeComboPatterns(comboList);

        let patternCount = db.prepare('SELECT COUNT(*) as cnt FROM at_meta_patterns').get().cnt;
        log(`Stored ${patternCount} Meta patterns.`);

        // Claude AI synthesis
        const synthesisPrompt = `You are a performance marketing analyst. Analyze these Meta Ads audience performance patterns and return JSON.

DIMENSION BREAKDOWNS:
- Age buckets: ${JSON.stringify(ageBuckets)}
- Gender: ${JSON.stringify(genderGroups)}
- Audience type: ${JSON.stringify(audienceTypeGroups)}
- Vertical: ${JSON.stringify(verticalGroups)}
- Placement: ${JSON.stringify(placementGroups)}
- Device: ${JSON.stringify(deviceGroups)}

TOP 10 COMBINATIONS (by lowest D6 CAC):
${JSON.stringify(comboList, null, 2)}

Return JSON with these keys:
{
  "top_5_by_cac": [{ "combo": "...", "avg_d6_cac": N, "insight": "..." }],
  "top_5_by_roas": [{ "combo": "...", "avg_d6_roas": N, "insight": "..." }],
  "worst_3": [{ "combo": "...", "avg_d6_cac": N, "insight": "..." }],
  "surprise_findings": ["..."],
  "vertical_insights": { "MFA": "...", "Broking": "...", "RA": "..." },
  "placement_insights": "...",
  "demographic_sweet_spot": "..."
}`;

        log('Calling Claude API for Meta synthesis...');
        const synthesis = await callClaudeAPI(synthesisPrompt, 4000);

        if (synthesis) {
            db.prepare(`
                INSERT INTO at_meta_patterns
                    (pattern_type, pattern_key, pattern_value_json, synthesized_insight, generated_at)
                VALUES ('ai_synthesis', 'full_synthesis', ?, ?, datetime('now'))
            `).run(JSON.stringify(synthesis), JSON.stringify(synthesis));
            log('Meta AI synthesis stored successfully.');
        } else {
            log('Meta AI synthesis failed or returned null.');
        }

        patternCount = db.prepare('SELECT COUNT(*) as cnt FROM at_meta_patterns').get().cnt;
        log(`Meta analysis complete. Total patterns stored: ${patternCount}`);
        return { patterns: patternCount, synthesis: !!synthesis };
    }

    // --------------- runGoogleAnalysis ---------------

    async function runGoogleAnalysis() {
        log('Starting Google pattern analysis...');
        const db = getAtDb();

        const adgroups = db.prepare(`
            SELECT ag.*, gc.vertical, gc.name as campaign_name
            FROM at_google_adgroups ag
            LEFT JOIN at_google_campaigns gc ON ag.google_campaign_id = gc.google_campaign_id
            WHERE ag.d6_cac IS NOT NULL AND ag.d6_cac > 0 AND ag.total_spend > 5000
            ORDER BY ag.d6_cac ASC
        `).all();

        log(`Found ${adgroups.length} qualifying Google adgroups for analysis.`);

        if (adgroups.length === 0) {
            log('No qualifying Google adgroups found. Skipping Google analysis.');
            return { patterns: 0, synthesis: false };
        }

        // Fetch audience data for each adgroup
        const audienceStmt = db.prepare('SELECT * FROM at_google_audiences WHERE adgroup_id = ?');

        // Build enriched adgroup records with audience info
        const enriched = adgroups.map(ag => {
            const audiences = audienceStmt.all(ag.google_adgroup_id);
            const ageAudiences = audiences.filter(a => a.criterion_type === 'AGE_RANGE' || a.age_range);
            const genderAudiences = audiences.filter(a => a.criterion_type === 'GENDER' || a.gender);
            const deviceAudiences = audiences.filter(a => a.criterion_type === 'DEVICE' || a.device_type);
            const namedAudiences = audiences.filter(a => a.audience_name);

            let audienceType = 'broad';
            if (namedAudiences.some(a => (a.audience_name || '').toLowerCase().includes('lookalike') || (a.audience_name || '').toLowerCase().includes('similar'))) {
                audienceType = 'lookalike';
            } else if (namedAudiences.some(a => (a.criterion_type || '').includes('CUSTOM') || (a.criterion_type || '').includes('REMARKETING'))) {
                audienceType = 'custom';
            } else if (namedAudiences.some(a => (a.criterion_type || '').includes('AFFINITY') || (a.criterion_type || '').includes('IN_MARKET'))) {
                audienceType = 'interest';
            }

            let ageRange = 'all';
            if (ageAudiences.length > 0) {
                const ages = ageAudiences.map(a => a.age_range).filter(Boolean);
                ageRange = ages.length > 0 ? ages[0] : 'all';
            }

            let gender = 'All';
            if (genderAudiences.length > 0) {
                const g = genderAudiences.map(a => a.gender).filter(Boolean);
                gender = g.length > 0 ? g[0] : 'All';
            }

            let device = 'all';
            if (deviceAudiences.length > 0) {
                const d = deviceAudiences.map(a => a.device_type).filter(Boolean);
                device = d.length > 0 ? d.sort().join('+') : 'all';
            }

            return {
                ...ag,
                audience_type: audienceType,
                age_range: ageRange,
                gender: gender,
                device: device,
                vertical: ag.vertical || 'Unknown'
            };
        });

        // Group by dimensions
        const ageGroups = {};
        const genderGrps = {};
        const audienceTypeGrps = {};
        const verticalGrps = {};
        const deviceGrps = {};

        for (const row of enriched) {
            const dims = {
                age_range: row.age_range,
                gender: row.gender,
                audience_type: row.audience_type,
                vertical: row.vertical,
                device: row.device
            };

            for (const [dimName, dimValue] of Object.entries(dims)) {
                const target = dimName === 'age_range' ? ageGroups :
                               dimName === 'gender' ? genderGrps :
                               dimName === 'audience_type' ? audienceTypeGrps :
                               dimName === 'vertical' ? verticalGrps : deviceGrps;
                if (!target[dimValue]) {
                    target[dimValue] = { key: dimValue, totalSpend: 0, totalD6Cac: 0, totalD6Roas: 0, totalConversions: 0, count: 0 };
                }
                const g = target[dimValue];
                g.totalSpend += row.total_spend || 0;
                g.totalD6Cac += row.d6_cac || 0;
                g.totalD6Roas += row.d6_roas || 0;
                g.totalConversions += row.d6_conversions || 0;
                g.count++;
            }
        }

        function finalize(groupObj) {
            return Object.values(groupObj).map(g => ({
                key: g.key,
                avg_d6_cac: safeDivide(g.totalD6Cac, g.count),
                avg_d6_roas: safeDivide(g.totalD6Roas, g.count),
                total_spend: Math.round(g.totalSpend),
                sample_size: g.count,
                conversions: g.totalConversions
            }));
        }

        const ageBuckets = finalize(ageGroups);
        const genderResults = finalize(genderGrps);
        const audienceTypeResults = finalize(audienceTypeGrps);
        const verticalResults = finalize(verticalGrps);
        const deviceResults = finalize(deviceGrps);

        // Top 10 combos (age_range + gender + audience_type + vertical)
        const combos = {};
        for (const row of enriched) {
            const comboKey = `${row.age_range}|${row.gender}|${row.audience_type}|${row.vertical}`;
            if (!combos[comboKey]) {
                combos[comboKey] = {
                    age_range: row.age_range, gender: row.gender,
                    audience_type: row.audience_type, vertical: row.vertical,
                    totalSpend: 0, totalD6Cac: 0, totalD6Roas: 0, totalConversions: 0, count: 0
                };
            }
            const c = combos[comboKey];
            c.totalSpend += row.total_spend || 0;
            c.totalD6Cac += row.d6_cac || 0;
            c.totalD6Roas += row.d6_roas || 0;
            c.totalConversions += row.d6_conversions || 0;
            c.count++;
        }

        const comboList = Object.values(combos)
            .filter(c => c.count >= 2)
            .map(c => ({
                age_range: c.age_range,
                gender: c.gender,
                audience_type: c.audience_type,
                vertical: c.vertical,
                avg_d6_cac: safeDivide(c.totalD6Cac, c.count),
                avg_d6_roas: safeDivide(c.totalD6Roas, c.count),
                total_spend: Math.round(c.totalSpend),
                sample_size: c.count,
                conversions: c.totalConversions,
                confidence: confidenceLevel(c.count)
            }))
            .sort((a, b) => a.avg_d6_cac - b.avg_d6_cac)
            .slice(0, 10);

        log(`Found ${comboList.length} top Google combinations.`);

        // Clear old Google patterns
        db.prepare('DELETE FROM at_google_patterns').run();

        // Store patterns
        const insertPattern = db.prepare(`
            INSERT INTO at_google_patterns
                (pattern_type, pattern_key, pattern_value_json, avg_d6_cac, avg_d6_roas, total_spend,
                 sample_adsets, sample_conversions, confidence, generated_at)
            VALUES (@pattern_type, @pattern_key, @pattern_value_json, @avg_d6_cac, @avg_d6_roas,
                    @total_spend, @sample_adsets, @sample_conversions, @confidence, datetime('now'))
        `);

        const storeDimensionPatterns = db.transaction((dimName, groups) => {
            for (const g of groups) {
                insertPattern.run({
                    pattern_type: dimName,
                    pattern_key: g.key,
                    pattern_value_json: JSON.stringify(g),
                    avg_d6_cac: g.avg_d6_cac,
                    avg_d6_roas: g.avg_d6_roas,
                    total_spend: g.total_spend,
                    sample_adsets: g.sample_size,
                    sample_conversions: g.conversions,
                    confidence: confidenceLevel(g.sample_size)
                });
            }
        });

        storeDimensionPatterns('age_range', ageBuckets);
        storeDimensionPatterns('gender', genderResults);
        storeDimensionPatterns('audience_type', audienceTypeResults);
        storeDimensionPatterns('vertical', verticalResults);
        storeDimensionPatterns('device', deviceResults);

        const storeComboPatterns = db.transaction((combos) => {
            for (const c of combos) {
                insertPattern.run({
                    pattern_type: 'top_combo',
                    pattern_key: `${c.age_range}|${c.gender}|${c.audience_type}|${c.vertical}`,
                    pattern_value_json: JSON.stringify(c),
                    avg_d6_cac: c.avg_d6_cac,
                    avg_d6_roas: c.avg_d6_roas,
                    total_spend: c.total_spend,
                    sample_adsets: c.sample_size,
                    sample_conversions: c.conversions,
                    confidence: c.confidence
                });
            }
        });
        storeComboPatterns(comboList);

        let patternCount = db.prepare('SELECT COUNT(*) as cnt FROM at_google_patterns').get().cnt;
        log(`Stored ${patternCount} Google patterns.`);

        // Claude AI synthesis
        const synthesisPrompt = `You are a performance marketing analyst. Analyze these Google Ads audience performance patterns and return JSON.

DIMENSION BREAKDOWNS:
- Age ranges: ${JSON.stringify(ageBuckets)}
- Gender: ${JSON.stringify(genderResults)}
- Audience type: ${JSON.stringify(audienceTypeResults)}
- Vertical: ${JSON.stringify(verticalResults)}
- Device: ${JSON.stringify(deviceResults)}

TOP 10 COMBINATIONS (by lowest D6 CAC):
${JSON.stringify(comboList, null, 2)}

Return JSON with these keys:
{
  "top_5_by_cac": [{ "combo": "...", "avg_d6_cac": N, "insight": "..." }],
  "top_5_by_roas": [{ "combo": "...", "avg_d6_roas": N, "insight": "..." }],
  "worst_3": [{ "combo": "...", "avg_d6_cac": N, "insight": "..." }],
  "surprise_findings": ["..."],
  "vertical_insights": { "MFA": "...", "Broking": "...", "RA": "..." },
  "device_insights": "...",
  "demographic_sweet_spot": "..."
}`;

        log('Calling Claude API for Google synthesis...');
        const synthesis = await callClaudeAPI(synthesisPrompt, 4000);

        if (synthesis) {
            db.prepare(`
                INSERT INTO at_google_patterns
                    (pattern_type, pattern_key, pattern_value_json, synthesized_insight, generated_at)
                VALUES ('ai_synthesis', 'full_synthesis', ?, ?, datetime('now'))
            `).run(JSON.stringify(synthesis), JSON.stringify(synthesis));
            log('Google AI synthesis stored successfully.');
        } else {
            log('Google AI synthesis failed or returned null.');
        }

        patternCount = db.prepare('SELECT COUNT(*) as cnt FROM at_google_patterns').get().cnt;
        log(`Google analysis complete. Total patterns stored: ${patternCount}`);
        return { patterns: patternCount, synthesis: !!synthesis };
    }

    // --------------- getPatterns ---------------

    function getPatterns(platform) {
        const db = getAtDb();
        const table = platform === 'google' ? 'at_google_patterns' : 'at_meta_patterns';
        const rows = db.prepare(`SELECT * FROM ${table} ORDER BY pattern_type, avg_d6_cac ASC`).all();
        log(`Retrieved ${rows.length} patterns for ${platform}.`);

        return rows.map(r => ({
            id: r.id,
            pattern_type: r.pattern_type,
            pattern_key: r.pattern_key,
            pattern_value: safeParseJSON(r.pattern_value_json),
            avg_d6_cac: r.avg_d6_cac,
            avg_d6_roas: r.avg_d6_roas,
            avg_d6_cvr: r.avg_d6_cvr,
            total_spend: r.total_spend,
            sample_adsets: r.sample_adsets,
            sample_conversions: r.sample_conversions,
            confidence: r.confidence,
            synthesized_insight: safeParseJSON(r.synthesized_insight),
            generated_at: r.generated_at
        }));
    }

    function safeParseJSON(str) {
        if (!str) return null;
        try { return JSON.parse(str); } catch (e) { return str; }
    }

    // --------------- public API ---------------

    return {
        runMetaAnalysis,
        runGoogleAnalysis,
        getPatterns
    };
};
