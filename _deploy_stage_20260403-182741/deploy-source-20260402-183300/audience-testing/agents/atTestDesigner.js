/**
 * AT Test Designer
 * Generates complete, ready-to-execute ad platform specs from recommendations.
 * Outputs Meta adset specs and Google adgroup specs with full targeting details.
 */

module.exports = function(config) {
    const { getAtDb } = require('../db/at-db');

    // --------------- helpers ---------------

    function log(...args) {
        console.log('[AT Test Designer]', ...args);
    }

    function safeParseJSON(str) {
        if (!str) return null;
        try { return JSON.parse(str); } catch (e) { return str; }
    }

    function formatDate(d) {
        const date = d || new Date();
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yy = String(date.getFullYear()).slice(-2);
        return `${dd}${mm}${yy}`;
    }

    function generateAdsetName(test) {
        const vertical = (test.vertical || 'GEN').toUpperCase().slice(0, 3);
        const objective = (test.success_metric || 'CAC').toUpperCase().slice(0, 3);
        const targeting = test.targeting_spec || {};
        const ageMin = targeting.age_min || 18;
        const ageMax = targeting.age_max || 65;
        const ageStr = `${ageMin}-${ageMax}`;

        let audienceType = 'BRD';
        if (targeting.custom_audiences && targeting.custom_audiences.length > 0) {
            const hasLookalike = targeting.custom_audiences.some(a => (a || '').toLowerCase().includes('lookalike'));
            audienceType = hasLookalike ? 'LAL' : 'CUS';
        } else if (targeting.interests && targeting.interests.length > 0) {
            audienceType = 'INT';
        }

        const dateStr = formatDate(new Date());
        return `FB_${vertical}_${objective}_${ageStr}_${audienceType}_${dateStr}`;
    }

    function generateAdgroupName(test) {
        const vertical = (test.vertical || 'GEN').toUpperCase().slice(0, 3);
        const objective = (test.success_metric || 'CAC').toUpperCase().slice(0, 3);
        const targeting = test.targeting_spec || {};

        let audienceType = 'BRD';
        if (targeting.custom_audiences && targeting.custom_audiences.length > 0) {
            audienceType = 'CUS';
        } else if (targeting.interests && targeting.interests.length > 0) {
            audienceType = 'INT';
        }

        const dateStr = formatDate(new Date());
        return `GG_${vertical}_${objective}_${audienceType}_${dateStr}`;
    }

    // --------------- generateMetaAdsetSpec ---------------

    function generateMetaAdsetSpec(test) {
        log(`Generating Meta adset spec for: ${test.title || test.test_name || 'unnamed'}`);

        const targeting = test.targeting_spec || {};
        const vertical = test.vertical || 'Unknown';
        const budget = targeting.recommended_daily_budget_inr || 1500;

        const genders = targeting.genders || [1, 2];
        const genderLabel = (genders.length === 1 && genders[0] === 1) ? 'Male' :
                            (genders.length === 1 && genders[0] === 2) ? 'Female' : 'All';

        const spec = {
            adset_name: generateAdsetName({
                vertical,
                success_metric: targeting.success_metric || test.success_metric || 'd6_cac',
                targeting_spec: targeting
            }),
            campaign_suggestion: 'Use existing ' + vertical + ' campaign or create new',
            targeting: {
                age_min: targeting.age_min || 18,
                age_max: targeting.age_max || 65,
                genders: genders,
                geo: targeting.geo || 'India',
                interests: targeting.interests || [],
                custom_audiences: targeting.custom_audiences || [],
                excluded_audiences: targeting.excluded_audiences || [],
                publisher_platforms: targeting.publisher_platforms || ['facebook', 'instagram'],
                facebook_positions: targeting.facebook_positions || ['feed', 'reels', 'story'],
                instagram_positions: targeting.instagram_positions || ['stream', 'reels', 'story'],
                device_platforms: targeting.device_platforms || ['mobile']
            },
            optimization_goal: targeting.optimization_goal || 'OFFSITE_CONVERSIONS',
            billing_event: 'IMPRESSIONS',
            bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            daily_budget: budget * 100,
            daily_budget_inr: budget,
            hypothesis: test.hypothesis || '',
            success_metric: targeting.success_metric || test.success_metric || 'd6_cac',
            success_threshold: targeting.success_threshold || null,
            expected_d6_cac_range: targeting.expected_d6_cac_range || null,
            kill_criteria: targeting.kill_criteria || `Pause if D6 CAC > ${(targeting.success_threshold || 800) * 1.5} after ${budget * 7} INR spend`,
            setup_checklist: [
                `Create or select existing ${vertical} campaign`,
                `Set adset name: ${generateAdsetName({ vertical, success_metric: targeting.success_metric || 'd6_cac', targeting_spec: targeting })}`,
                `Set age range: ${targeting.age_min || 18}-${targeting.age_max || 65}`,
                `Set gender: ${genderLabel}`,
                `Set geo: ${targeting.geo || 'India'}`,
                targeting.interests && targeting.interests.length > 0
                    ? `Add interests: ${targeting.interests.join(', ')}`
                    : 'No interest targeting (broad)',
                targeting.custom_audiences && targeting.custom_audiences.length > 0
                    ? `Add custom audiences: ${targeting.custom_audiences.join(', ')}`
                    : 'No custom audiences',
                targeting.excluded_audiences && targeting.excluded_audiences.length > 0
                    ? `Exclude audiences: ${targeting.excluded_audiences.join(', ')}`
                    : 'No audience exclusions',
                `Set placements: ${(targeting.publisher_platforms || ['facebook', 'instagram']).join(', ')}`,
                `Set device: ${(targeting.device_platforms || ['mobile']).join(', ')}`,
                `Set daily budget: INR ${budget}`,
                'Set optimization goal: Conversions (App Install or Purchase)',
                'Set billing event: Impressions',
                'Set bid strategy: Lowest Cost',
                'Assign creative (use top-performing creative from same vertical)',
                `Monitor for 7 days. Kill criteria: ${targeting.kill_criteria || 'Pause if D6 CAC exceeds 1.5x threshold'}`,
                'Tag adset in tracking sheet after launch'
            ]
        };

        log(`Meta spec generated: ${spec.adset_name}, budget INR ${budget}/day`);
        return spec;
    }

    // --------------- generateGoogleAdgroupSpec ---------------

    function generateGoogleAdgroupSpec(test) {
        log(`Generating Google adgroup spec for: ${test.title || test.test_name || 'unnamed'}`);

        const targeting = test.targeting_spec || {};
        const vertical = test.vertical || 'Unknown';
        const budget = targeting.recommended_daily_budget_inr || 1500;

        const spec = {
            adgroup_name: generateAdgroupName({
                vertical,
                success_metric: targeting.success_metric || test.success_metric || 'd6_cac',
                targeting_spec: targeting
            }),
            campaign_suggestion: 'Use existing ' + vertical + ' campaign or create new App campaign',
            targeting: {
                age_ranges: [],
                genders: targeting.genders || [],
                geo: targeting.geo || 'India',
                audiences: targeting.custom_audiences || [],
                in_market_audiences: targeting.interests || [],
                excluded_audiences: targeting.excluded_audiences || [],
                device_types: targeting.device_platforms || ['MOBILE'],
                networks: ['SEARCH', 'DISPLAY']
            },
            bidding: {
                strategy: 'TARGET_CPA',
                target_cpa_inr: targeting.success_threshold || 500,
                target_cpa_micros: (targeting.success_threshold || 500) * 1000000
            },
            daily_budget_inr: budget,
            daily_budget_micros: budget * 1000000,
            hypothesis: test.hypothesis || '',
            success_metric: targeting.success_metric || test.success_metric || 'd6_cac',
            success_threshold: targeting.success_threshold || null,
            expected_d6_cac_range: targeting.expected_d6_cac_range || null,
            kill_criteria: targeting.kill_criteria || `Pause if D6 CAC > ${(targeting.success_threshold || 800) * 1.5} after ${budget * 7} INR spend`,
            setup_checklist: [
                `Create or select existing ${vertical} campaign (App campaign or Search)`,
                `Set adgroup name: ${generateAdgroupName({ vertical, success_metric: targeting.success_metric || 'd6_cac', targeting_spec: targeting })}`,
                `Set geo targeting: ${targeting.geo || 'India'}`,
                targeting.genders && targeting.genders.length > 0
                    ? `Set gender targeting: ${targeting.genders.map(g => g === 1 ? 'Male' : g === 2 ? 'Female' : 'All').join(', ')}`
                    : 'No gender restriction',
                targeting.custom_audiences && targeting.custom_audiences.length > 0
                    ? `Add audiences: ${targeting.custom_audiences.join(', ')}`
                    : 'No custom audiences',
                targeting.interests && targeting.interests.length > 0
                    ? `Add in-market/affinity audiences: ${targeting.interests.join(', ')}`
                    : 'No in-market audience targeting (broad)',
                targeting.excluded_audiences && targeting.excluded_audiences.length > 0
                    ? `Exclude audiences: ${targeting.excluded_audiences.join(', ')}`
                    : 'No audience exclusions',
                `Set device: ${(targeting.device_platforms || ['MOBILE']).join(', ')}`,
                `Set daily budget: INR ${budget}`,
                `Set bidding: Target CPA at INR ${targeting.success_threshold || 500}`,
                'Add responsive ad creative (use top-performing assets from same vertical)',
                `Monitor for 7 days. Kill criteria: ${targeting.kill_criteria || 'Pause if D6 CAC exceeds 1.5x threshold'}`,
                'Tag adgroup in tracking sheet after launch'
            ]
        };

        // Build age ranges from targeting if available
        if (targeting.age_min || targeting.age_max) {
            const ageMin = targeting.age_min || 18;
            const ageMax = targeting.age_max || 65;
            const googleAgeRanges = [];
            if (ageMin <= 24 && ageMax >= 18) googleAgeRanges.push('AGE_RANGE_18_24');
            if (ageMin <= 34 && ageMax >= 25) googleAgeRanges.push('AGE_RANGE_25_34');
            if (ageMin <= 44 && ageMax >= 35) googleAgeRanges.push('AGE_RANGE_35_44');
            if (ageMin <= 54 && ageMax >= 45) googleAgeRanges.push('AGE_RANGE_45_54');
            if (ageMin <= 64 && ageMax >= 55) googleAgeRanges.push('AGE_RANGE_55_64');
            if (ageMax >= 65) googleAgeRanges.push('AGE_RANGE_65_UP');
            spec.targeting.age_ranges = googleAgeRanges;
        }

        log(`Google spec generated: ${spec.adgroup_name}, budget INR ${budget}/day, target CPA INR ${spec.bidding.target_cpa_inr}`);
        return spec;
    }

    // --------------- generateSpec ---------------

    function generateSpec(id) {
        const db = getAtDb();
        const rec = db.prepare('SELECT * FROM at_recommendations WHERE id = ?').get(id);

        if (!rec) {
            log(`Recommendation ${id} not found.`);
            return null;
        }

        log(`Generating spec for recommendation ${id}: ${rec.title}`);

        const targetingSpec = safeParseJSON(rec.targeting_spec_json);
        const test = {
            title: rec.title,
            hypothesis: rec.hypothesis,
            vertical: rec.vertical,
            success_metric: targetingSpec?.success_metric || 'd6_cac',
            targeting_spec: targetingSpec
        };

        let spec;
        if (rec.platform === 'meta') {
            spec = generateMetaAdsetSpec(test);
        } else {
            spec = generateGoogleAdgroupSpec(test);
        }

        return {
            recommendation_id: rec.id,
            platform: rec.platform,
            rec_type: rec.rec_type,
            vertical: rec.vertical,
            title: rec.title,
            hypothesis: rec.hypothesis,
            priority: rec.priority,
            urgency: rec.urgency,
            status: rec.status,
            spec
        };
    }

    // --------------- getAllSpecs ---------------

    function getAllSpecs(platform) {
        const db = getAtDb();
        const rows = db.prepare(`
            SELECT * FROM at_recommendations
            WHERE rec_type = 'test' AND platform = ? AND status = 'pending'
            ORDER BY
                CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
                generated_at DESC
        `).all(platform);

        log(`Generating specs for ${rows.length} pending ${platform} test recommendations.`);

        return rows.map(rec => {
            const targetingSpec = safeParseJSON(rec.targeting_spec_json);
            const test = {
                title: rec.title,
                hypothesis: rec.hypothesis,
                vertical: rec.vertical,
                success_metric: targetingSpec?.success_metric || 'd6_cac',
                targeting_spec: targetingSpec
            };

            let spec;
            if (platform === 'meta') {
                spec = generateMetaAdsetSpec(test);
            } else {
                spec = generateGoogleAdgroupSpec(test);
            }

            return {
                recommendation_id: rec.id,
                platform: rec.platform,
                rec_type: rec.rec_type,
                vertical: rec.vertical,
                title: rec.title,
                hypothesis: rec.hypothesis,
                priority: rec.priority,
                urgency: rec.urgency,
                status: rec.status,
                spec
            };
        });
    }

    // --------------- public API ---------------

    return {
        generateSpec,
        getAllSpecs
    };
};
