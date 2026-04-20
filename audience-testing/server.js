/**
 * Audience Testing — Express Router
 * Mounts all AT agent endpoints under the /at prefix.
 */

let express;
try { express = require('express'); } catch (e) { express = require('../uploader/node_modules/express'); }
let OpenAI;
try { OpenAI = require('openai'); } catch (e) { try { OpenAI = require('../uploader/node_modules/openai'); } catch (_) { OpenAI = null; } }

module.exports = function(config) {
    const router = express.Router();
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
    const AT_AUDIENCE_BRAIN_CACHE = new Map();
    const AT_AUDIENCE_BRAIN_CACHE_TTL_MS = 10 * 60 * 1000;

    // Initialize all agents
    const metaScanner = require('./agents/atMetaScanner')(config);
    const googleScanner = require('./agents/atGoogleScanner')(config);
    const enricher = require('./agents/atMetabaseEnricher')(config);
    const learningEngine = require('./agents/atLearningEngine')(config);
    const recommendationEngine = require('./agents/atRecommendationEngine')(config);
    const testDesigner = require('./agents/atTestDesigner')(config);
    const optimizer = require('./agents/atCurrentOptimizer')(config);

    // Start scheduler
    const scheduler = require('./agents/atScheduler');

    // Helper: get DB instance
    function db() {
        const { getAtDb } = require('./db/at-db');
        return getAtDb();
    }

    function toNum(value) {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }

    function safeJsonParse(text, fallback) {
        try { return JSON.parse(String(text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()); }
        catch (e) { return fallback; }
    }

    function countPattern(text, regex) {
        const matches = String(text || '').match(regex);
        return matches ? matches.length : 0;
    }

    function getBrainCacheKey(platform, body, summary) {
        const payload = {
            platform,
            feedback: String(body && body.feedback || '').trim().toLowerCase(),
            user_request: String(body && body.user_request || '').trim().toLowerCase(),
            source_label: summary && summary.source_label || '',
            date_label: summary && summary.date_label || '',
            top: (summary && summary.best_audiences || []).slice(0, 3).map(x => [x.audience, x.spend, x.d6_cac, x.d6_roas, x.sample_count].join('|')),
            weak: (summary && summary.weak_audiences || []).slice(0, 3).map(x => [x.audience, x.spend, x.d6_cac, x.d6_roas, x.sample_count].join('|')),
            flags: (summary && summary.live_flags || []).slice(0, 8).map(f => [f.flag_type, f.severity, f.adset_name || f.adgroup_name || ''].join('|'))
        };
        return require('crypto').createHash('sha1').update(JSON.stringify(payload)).digest('hex');
    }

    function getBrainCache(cacheKey) {
        const item = AT_AUDIENCE_BRAIN_CACHE.get(cacheKey);
        if (!item) return null;
        if ((Date.now() - item.ts) > AT_AUDIENCE_BRAIN_CACHE_TTL_MS) {
            AT_AUDIENCE_BRAIN_CACHE.delete(cacheKey);
            return null;
        }
        return item.value;
    }

    function setBrainCache(cacheKey, value) {
        AT_AUDIENCE_BRAIN_CACHE.set(cacheKey, { ts: Date.now(), value });
    }

    const MIN_AUDIENCE_TEST_SPEND = 20000;

    function safeJsonArray(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        try { return JSON.parse(value) || []; } catch (e) { return []; }
    }

    function normalizeToken(value) {
        return String(value == null ? '' : value).trim().toLowerCase();
    }

    function normalizeTokenList(value) {
        return Array.from(new Set(safeJsonArray(value).map(normalizeToken).filter(Boolean))).sort();
    }

    function hashAudienceShape(shape) {
        return require('crypto').createHash('sha1').update(JSON.stringify(shape)).digest('hex');
    }

    function buildMetaAudienceExactKey(row) {
        return hashAudienceShape({
            age_min: toNum(row && row.age_min) || 18,
            age_max: toNum(row && row.age_max) || 65,
            genders: normalizeTokenList(row && row.genders_json),
            geo_locations: normalizeTokenList(row && row.geo_locations_json),
            interests: normalizeTokenList(row && row.interests_json),
            behaviors: normalizeTokenList(row && row.behaviors_json),
            custom_audiences: normalizeTokenList(row && row.custom_audiences_json),
            lookalike_audiences: normalizeTokenList(row && row.lookalike_audiences_json),
            excluded_audiences: normalizeTokenList(row && row.excluded_audiences_json),
            device_platforms: normalizeTokenList(row && row.device_platforms_json),
            publisher_platforms: normalizeTokenList(row && row.publisher_platforms_json),
            facebook_positions: normalizeTokenList(row && row.facebook_positions_json),
            instagram_positions: normalizeTokenList(row && row.instagram_positions_json),
            is_broad: !!toNum(row && row.is_broad),
            is_advantage_plus: !!toNum(row && row.is_advantage_plus)
        });
    }

    function buildGoogleCriterionLabel(row) {
        const parts = [];
        if (row && row.audience_name) parts.push(String(row.audience_name));
        if (row && row.criterion_type) parts.push(String(row.criterion_type));
        if (row && row.age_range) parts.push(`Age ${row.age_range}`);
        if (row && row.gender) parts.push(`Gender ${row.gender}`);
        if (row && row.device_type) parts.push(`Device ${row.device_type}`);
        return parts.filter(Boolean).join(' | ');
    }

    function buildGoogleAudienceExactKey(rows) {
        const criteria = (rows || [])
            .map(row => ({
                criterion_type: normalizeToken(row && row.criterion_type),
                audience_name: normalizeToken(row && row.audience_name),
                audience_id: normalizeToken(row && row.audience_id),
                age_range: normalizeToken(row && row.age_range),
                gender: normalizeToken(row && row.gender),
                device_type: normalizeToken(row && row.device_type)
            }))
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        return hashAudienceShape({ criteria });
    }

    function platformLabel(platform) {
        return String(platform || 'meta').toLowerCase() === 'google' ? 'Google' : 'Meta';
    }

    function buildMetaAudienceLabel(row) {
        const lookalikes = safeJsonArray(row.lookalike_audiences_json);
        const customs = safeJsonArray(row.custom_audiences_json);
        const interests = safeJsonArray(row.interests_json);
        const geo = safeJsonArray(row.geo_locations_json);
        const genders = safeJsonArray(row.genders_json);
        const genderLabel = (!genders.length || (genders.includes(1) && genders.includes(2))) ? 'All Genders' :
            (genders.includes(1) ? 'Male' : genders.includes(2) ? 'Female' : 'All Genders');
        const audienceKind = row.is_advantage_plus ? 'Advantage+' :
            (lookalikes.length ? 'Lookalike' : customs.length ? 'Custom' : interests.length ? 'Interest' : (row.is_broad ? 'Broad' : 'Targeted'));
        const specificity = [lookalikes[0], customs[0], interests[0]].find(Boolean);
        return [
            `Age ${row.age_min || 18}-${row.age_max || 65}`,
            genderLabel,
            geo.length ? geo.slice(0, 2).join(', ') : 'India',
            audienceKind,
            specificity || null
        ].filter(Boolean).join(' | ');
    }

    function buildGoogleAudienceLabel(row, audienceRows) {
        const labels = (audienceRows || []).map(buildGoogleCriterionLabel);
        return [
            labels.length ? labels.slice(0, 3).join(' | ') : 'All traffic'
        ].filter(Boolean).join(' | ');
    }

    function buildAudienceLineage(row, platform) {
        const campaign = String(row && row.campaign_name || '').trim();
        const entity = String(row && (row.name || row.adset_name || row.adgroup_name || row.entity_name || row.audience_label || row.audience || row.label || 'Unknown audience')).trim();
        const scope = String(platform || 'meta').toLowerCase() === 'google' ? 'Google adgroup' : 'Meta adset';
        return [campaign || 'Unknown campaign', entity || 'Unknown audience', scope].filter(Boolean).join(' > ');
    }

    function pickTopPatternSummary(patterns) {
        return (patterns || [])
            .filter(p => p && p.pattern_type === 'top_combo' && (p.total_spend || 0) >= MIN_AUDIENCE_TEST_SPEND && (p.avg_d6_roas > 0 || p.avg_d6_cac > 0))
            .sort((a, b) => {
                const roasDelta = toNum(b.avg_d6_roas) - toNum(a.avg_d6_roas);
                if (Math.abs(roasDelta) > 0.0001) return roasDelta;
                return toNum(a.avg_d6_cac) - toNum(b.avg_d6_cac);
            })
            .slice(0, 5);
    }

    function buildCardMeta(row, platform) {
        const spend = toNum(row.total_spend);
        const mature = spend >= MIN_AUDIENCE_TEST_SPEND;
        const hasMetrics = toNum(row.d6_cac) > 0 || toNum(row.d6_roas) > 0 || toNum(row.d6_conversions) > 0 || toNum(row.conversions) > 0 || toNum(row.signups) > 0;
        const sourceDetail = String(platform || 'meta').toLowerCase() === 'google' ? 'Google Ads + AT' : 'Meta + Metabase';
        return {
            source_label: sourceDetail,
            date_label: 'Selected scan window',
            maturity_label: mature ? 'Mature' : 'Immature',
            sanity_status: mature && hasMetrics ? 'PASS' : 'WATCH',
            sanity_detail: mature && hasMetrics ? 'Spend floor met; metrics present' : 'Below threshold or incomplete metrics'
        };
    }

    function audienceFamilyKey(row, platform) {
        return String((row && row.exact_audience_key) || buildAudienceExactKey(row, platform) || 'unknown').toLowerCase();
    }

    function buildAudienceExactKey(row, platform) {
        const isGoogle = String(platform || 'meta').toLowerCase() === 'google';
        if (isGoogle) {
            return String(row && (row.exact_audience_key || row.audience_signature || row.audience_key) || '').trim().toLowerCase();
        }
        return buildMetaAudienceExactKey(row);
    }

    function computeAudienceQualityMeta(row, platform) {
        const spend = toNum(row && (row.spend != null ? row.spend : row.total_spend));
        const cac = toNum(row && row.d6_cac);
        const roas = toNum(row && row.d6_roas);
        const conversions = toNum(row && (row.conversions || row.d6_conversions || row.signups || row.sample_count));
        const sampleCount = toNum(row && row.sample_count);
        const label = String(row && (row.audience_label || row.audience || row.title || row.entity_name || row.label || '')).trim();
        let score = 35;

        if (spend >= MIN_AUDIENCE_TEST_SPEND) score += 15;
        if (conversions > 0) score += Math.min(15, 6 + Math.round(Math.log10(conversions + 1) * 5));
        else score -= 10;

        if (sampleCount >= 3) score += 8;
        else if (sampleCount <= 1) score -= 5;

        if (roas > 1.75) score += 25;
        else if (roas > 1.25) score += 18;
        else if (roas > 0.9) score += 8;
        else if (roas > 0) score -= 8;
        else score -= 15;

        if (cac > 0) {
            if (cac < 5000) score += 15;
            else if (cac < 10000) score += 8;
            else if (cac > 25000) score -= 18;
            else if (cac > 15000) score -= 10;
        }

        if (isGenericAudienceLabel(label)) score -= 20;
        if (String(label).toLowerCase().includes('broad') && roas < 1 && conversions < 3) score -= 8;
        if (String(label).toLowerCase().includes('all traffic') && String(platform || 'meta').toLowerCase() !== 'google') score -= 8;

        score = Math.max(0, Math.min(100, Math.round(score)));
        const tier = score >= 75 ? 'High' : (score >= 50 ? 'Medium' : 'Low');
        return {
            quality_score: score,
            quality_tier: tier
        };
    }

    function detectAudienceOverlap(items) {
        const families = new Map();
        (items || []).forEach(item => {
            const key = audienceFamilyKey(item, item && item.platform);
            let family = families.get(key);
            if (!family) {
                family = { key, items: [], spend: 0 };
                families.set(key, family);
            }
            family.items.push(item);
            family.spend += toNum(item && item.spend);
        });

        const familySignals = Array.from(families.values()).map(f => {
            const sorted = f.items.slice().sort((a, b) => toNum(b.spend) - toNum(a.spend));
            const count = sorted.length;
            const avgSpend = count > 0 ? f.spend / count : 0;
            const overlapRisk = count >= 4 || (count >= 2 && avgSpend >= MIN_AUDIENCE_TEST_SPEND) ? (count >= 4 ? 'HIGH' : 'MEDIUM') : 'LOW';
            const fragmentationRisk = count >= 3 && avgSpend < (MIN_AUDIENCE_TEST_SPEND * 1.5) ? 'HIGH' : (count >= 2 && avgSpend < (MIN_AUDIENCE_TEST_SPEND * 2) ? 'MEDIUM' : 'LOW');
            const mergeCandidates = sorted.slice(0, 3).map(x => x.audience || x.label || x.title || x.entity_name || '--');
            return {
                key: f.key,
                label: sorted[0] ? (sorted[0].audience || sorted[0].label || sorted[0].title || sorted[0].entity_name || f.key) : f.key,
                count,
                spend: Math.round(f.spend * 100) / 100,
                avg_spend: Math.round(avgSpend * 100) / 100,
                overlap_risk: overlapRisk,
                fragmentation_risk: fragmentationRisk,
                merge_candidates: mergeCandidates
            };
        });

        const familyMap = new Map(familySignals.map(s => [s.key, s]));
        (items || []).forEach(item => {
            const family = familyMap.get(audienceFamilyKey(item, item && item.platform));
            if (!family) return;
            item.family_key = family.key;
            item.family_size = family.count;
            item.family_spend = family.spend;
            item.overlap_risk = family.overlap_risk;
            item.fragmentation_risk = family.fragmentation_risk;
            item.merge_candidates = family.merge_candidates.filter(x => x !== (item.audience || item.label || item.title || item.entity_name || '--')).slice(0, 2);
        });

        return familySignals;
    }

    function buildSummaryCards(rows, labelFn, platform, exactKeyFn) {
        const eligible = (rows || []).filter(r => toNum(r.total_spend) > 0);
        const groups = new Map();

        for (const row of eligible) {
            const label = labelFn(row) || 'Unknown Audience';
            const lineage = buildAudienceLineage(row, platform);
            const key = String((exactKeyFn ? exactKeyFn(row) : buildAudienceExactKey(row, platform) || label)).toLowerCase();
            let g = groups.get(key);
            if (!g) {
                g = {
                    label,
                    audience: label,
                    lineage,
                    exact_key: key,
                    spend: 0,
                    d6_conversions: 0,
                    d6_revenue: 0,
                    conversions: 0,
                    signups: 0,
                    sample_count: 0,
                    members: [],
                    representative: row
                };
                groups.set(key, g);
            }
            g.spend += toNum(row.total_spend);
            g.d6_conversions += toNum(row.d6_conversions || row.d6_overall_con || row.conversions);
            g.d6_revenue += toNum(row.d6_revenue || row.d6_overall_revenue || row.revenue);
            g.conversions += toNum(row.conversions || row.d6_conversions || row.metabase_signups || row.signups);
            g.signups += toNum(row.signups || row.metabase_signups);
            g.sample_count += 1;
            const memberLabel = String(row.name || row.adset_name || row.adgroup_name || row.entity_name || row.audience_label || row.audience || row.label || '').trim();
            if (memberLabel && !g.members.includes(memberLabel)) g.members.push(memberLabel);
            if (toNum(row.total_spend) > toNum(g.representative.total_spend || 0)) g.representative = row;
        }

        const aggregated = Array.from(groups.values()).map(g => {
            const rep = g.representative || {};
            const d6_cac = g.d6_conversions > 0 ? Math.round((g.spend / g.d6_conversions) * 100) / 100 : toNum(rep.d6_cac);
            const d6_roas = g.spend > 0 ? Math.round((g.d6_revenue / g.spend) * 1000) / 1000 : toNum(rep.d6_roas);
            const exactBucketId = g.exact_key.slice(0, 10);
            const qualityMeta = computeAudienceQualityMeta({
                audience_label: g.label,
                audience: g.label,
                spend: g.spend,
                d6_cac,
                d6_roas,
                conversions: g.d6_conversions || g.conversions || g.signups,
                sample_count: g.sample_count
            }, platform);
            return {
                exact_audience_key: g.exact_key,
                exact_bucket_id: exactBucketId,
                exact_bucket_label: `${g.label} [${exactBucketId}]`,
                label: g.label,
                audience: g.label,
                audience_lineage: g.lineage,
                spend: Math.round(g.spend * 100) / 100,
                d6_cac,
                d6_roas,
                conversions: g.d6_conversions || g.conversions || g.signups,
                sample_count: g.sample_count,
                audience_bucket: rep.audience_bucket || inferAudienceBucket(g.label, platform),
                intent_cluster: rep.intent_cluster || inferIntentCluster(g.label),
                strategic_role: rep.strategic_role || inferStrategicRole({ spend: g.spend, d6_cac, d6_roas, sample_count: g.sample_count }, null),
                member_count: g.members.length,
                members: g.members.slice(0, 3),
                ...qualityMeta,
                ...buildCardMeta(rep, platform)
            };
        }).filter(g => toNum(g.spend) >= MIN_AUDIENCE_TEST_SPEND);

        const familySignals = detectAudienceOverlap(aggregated);
        const familyMap = new Map(familySignals.map(s => [s.key, s]));
        aggregated.forEach(item => {
            const family = familyMap.get(item.family_key || audienceFamilyKey(item, platform));
            if (!family) return;
            item.overlap_risk = family.overlap_risk;
            item.fragmentation_risk = family.fragmentation_risk;
            item.family_size = family.count;
            item.family_spend = family.spend;
            item.merge_candidates = family.merge_candidates.filter(x => x !== item.audience).slice(0, 2);
        });

        const winners = aggregated
            .slice()
            .sort((a, b) => {
                const qDelta = toNum(b.quality_score) - toNum(a.quality_score);
                if (Math.abs(qDelta) > 0.0001) return qDelta;
                const roasDelta = toNum(b.d6_roas) - toNum(a.d6_roas);
                if (Math.abs(roasDelta) > 0.0001) return roasDelta;
                const cacDelta = toNum(a.d6_cac) - toNum(b.d6_cac);
                if (Math.abs(cacDelta) > 0.0001) return cacDelta;
                return toNum(b.spend) - toNum(a.spend);
            })
            .slice(0, 5);
        const winnerKeys = new Set(winners.map(a => String(a.exact_audience_key || a.audience || a.label || '').toLowerCase()));

        const losers = aggregated
            .slice()
            .sort((a, b) => {
                const qDelta = toNum(a.quality_score) - toNum(b.quality_score);
                if (Math.abs(qDelta) > 0.0001) return qDelta;
                const noConvA = toNum(a.conversions) <= 0 ? 1 : 0;
                const noConvB = toNum(b.conversions) <= 0 ? 1 : 0;
                if (noConvA !== noConvB) return noConvB - noConvA;
                const roasDelta = toNum(a.d6_roas) - toNum(b.d6_roas);
                if (Math.abs(roasDelta) > 0.0001) return roasDelta;
                return toNum(b.spend) - toNum(a.spend);
            })
            .filter(a => !winnerKeys.has(String(a.exact_audience_key || a.audience || a.label || '').toLowerCase()))
            .slice(0, 5);

        const totalSpend = aggregated.reduce((sum, item) => sum + toNum(item && item.spend), 0);
        const dominant = aggregated.slice().sort((a, b) => toNum(b.spend) - toNum(a.spend))[0] || null;
        const spendConcentration = totalSpend > 0 && dominant ? dominant.spend / totalSpend : 0;

        return {
            winners,
            losers,
            family_signals: familySignals,
            spend_concentration: Math.round(spendConcentration * 1000) / 1000,
            dominant_audience: dominant ? {
                audience: dominant.audience || dominant.label || '--',
                exact_audience_key: dominant.exact_audience_key || '',
                exact_bucket_id: dominant.exact_bucket_id || String(dominant.exact_audience_key || '').slice(0, 10),
                exact_bucket_label: dominant.exact_bucket_label || dominant.label || dominant.audience || '--',
                spend: dominant.spend || 0,
                spend_share: Math.round(spendConcentration * 1000) / 1000,
                quality_score: dominant.quality_score,
                quality_tier: dominant.quality_tier,
                audience_bucket: dominant.audience_bucket,
                intent_cluster: dominant.intent_cluster,
                strategic_role: dominant.strategic_role
            } : null
        };
    }

    function buildAudienceBrainEvidence(platform, summary, extras) {
        const isGoogle = String(platform || 'meta').toLowerCase() === 'google';
        const top = (summary.best_audiences || []).slice(0, 6);
        const weak = (summary.weak_audiences || []).slice(0, 6);
        const tests = (summary.test_ideas || []).slice(0, 6);
        const formulas = (summary.learned_formulas || []).slice(0, 6);
        const liveFlags = (summary.live_flags || []).slice(0, 12);
        const families = Array.isArray(summary.family_signals) ? summary.family_signals : [];
        const clusterCounts = {};
        const bucketCounts = {};
        const qualityCounts = { high: 0, medium: 0, low: 0 };
        const overlapCounts = { high: 0, medium: 0, low: 0 };
        const fragmentationCounts = { high: 0, medium: 0, low: 0 };
        const bump = (map, key) => { const k = String(key || 'Unknown'); map[k] = (map[k] || 0) + 1; };
        top.forEach(x => {
            bump(clusterCounts, x.intent_cluster);
            bump(bucketCounts, x.audience_bucket);
            bump(qualityCounts, String(x.quality_tier || 'Low').toLowerCase());
            bump(overlapCounts, String(x.overlap_risk || 'LOW').toLowerCase());
            bump(fragmentationCounts, String(x.fragmentation_risk || 'LOW').toLowerCase());
        });
        weak.forEach(x => {
            bump(clusterCounts, x.intent_cluster);
            bump(bucketCounts, x.audience_bucket);
            bump(qualityCounts, String(x.quality_tier || 'Low').toLowerCase());
            bump(overlapCounts, String(x.overlap_risk || 'LOW').toLowerCase());
            bump(fragmentationCounts, String(x.fragmentation_risk || 'LOW').toLowerCase());
        });
        return {
            platform: isGoogle ? 'google' : 'meta',
            source_label: summary.source_label || (isGoogle ? 'Google Ads + AT' : 'Meta + Metabase'),
            date_label: summary.date_label || 'Selected scan window',
            minimum_test_spend: MIN_AUDIENCE_TEST_SPEND,
            best_audiences: top,
            weak_audiences: weak,
            test_ideas: tests,
            learned_formulas: formulas,
            live_flags: liveFlags,
            live_flag_counts: summary.flag_counts || {},
            audience_bucket_counts: bucketCounts,
            intent_cluster_counts: clusterCounts,
            quality_tier_counts: qualityCounts,
            overlap_risk_counts: overlapCounts,
            fragmentation_risk_counts: fragmentationCounts,
            overlap_signals: families,
            spend_concentration: summary.spend_concentration || 0,
            dominant_audience: summary.dominant_audience || null,
            dominance_flag: (summary.spend_concentration || 0) >= 0.9 && summary.dominant_audience ? 'HIGH' : 'LOW',
            optimizer_style_notes: [
            'Spend floor: only audiences with at least 20k spend are eligible for winner/loser decisions.',
            'Best and weak audiences are grouped by exact audience definition, not campaign lineage.',
                (summary.spend_concentration && summary.spend_concentration >= 0.9 && summary.dominant_audience)
                    ? `One exact audience bucket owns ${Math.round(summary.spend_concentration * 100)}% of spend; prioritize adjacent tests instead of recycling the same pocket.`
                    : 'Spend is distributed enough to compare exact buckets directly.',
                'Quality tier ranks audiences by downstream value, stability, and spend sufficiency.',
                'Overlap and fragmentation signals indicate when similar audiences should be merged or split more cleanly.',
                'Mature/Immature labels reflect spend floor and metric completeness.',
                'Prioritize downstream quality and intent fit over cheap top-funnel volume.',
                'Prefer fewer, cleaner tests over many noisy micro-audience splits.',
                isGoogle ? 'Google budget changes are campaign-level only.' : 'Meta recommendations can act at adset level.'
            ],
            current_recommendations: extras && extras.current_recommendations ? extras.current_recommendations : [],
            request_scope: extras && extras.request_scope ? extras.request_scope : null
        };
    }

    function isGenericAudienceLabel(label) {
        const text = String(label || '').toLowerCase().trim();
        if (!text) return true;
        if (/^(all|unknown|n\/a|na)$/.test(text)) return true;
        return /all traffic|clone of|app install|all genders|unknown audience|default audience/.test(text);
    }

    function buildAudienceSanityMeta(item, summary, evidence) {
        const spend = toNum(item && item.spend);
        const sampleCount = toNum(item && item.sample_count);
        const label = String(item && (item.audience_label || item.audience || item.title || item.entity_name || item.label || '')).trim();
        const hasMetrics = toNum(item && (item.d6_cac || item.d6_roas || item.conversions || item.sample_count)) > 0;
        const mature = spend >= (evidence && evidence.minimum_test_spend ? evidence.minimum_test_spend : MIN_AUDIENCE_TEST_SPEND);
        const generic = isGenericAudienceLabel(label);
        const sanityStatus = mature && hasMetrics && !generic ? 'PASS' : 'WATCH';
        const detail = generic
            ? 'Audience label is too generic; verify the exact targeting source before acting.'
            : (mature && hasMetrics ? 'Spend floor met; metrics present' : 'Below threshold or incomplete metrics');
        const qualityMeta = computeAudienceQualityMeta(item, summary && summary.platform);
        return {
            source_label: (summary && summary.source_label) || item.source_label || '',
            date_label: (summary && summary.date_label) || item.date_label || 'Selected scan window',
            maturity_label: mature ? 'Mature' : 'Immature',
            sanity_status: sanityStatus,
            sanity_detail: detail,
            sample_count: sampleCount || toNum(item && item.conversions) || 0,
            ...qualityMeta,
            overlap_risk: item && item.overlap_risk ? item.overlap_risk : 'LOW',
            fragmentation_risk: item && item.fragmentation_risk ? item.fragmentation_risk : 'LOW',
            merge_candidates: Array.isArray(item && item.merge_candidates) ? item.merge_candidates : []
        };
    }

    function inferAudienceBucket(label, platform) {
        const text = String(label || '').toLowerCase();
        if (!text) return 'Unknown';
        if (/(retarget|remarket|site visitor|visitor|engager|video viewer|page engager|trialist|lead|crm|customer|purchaser|signup)/.test(text)) return 'Retargeting / High Intent';
        if (/(lookalike|similar|lal|seed)/.test(text)) return 'Lookalike';
        if (/(custom|customer match|customer list|uploaded|crm)/.test(text)) return 'Customer / CRM';
        if (/(broad|advantage\+|adv\+|all traffic|all users)/.test(text)) return 'Broad';
        if (platform === 'google' && /(search|query|keyword|custom segment|in-market|affinity|observation)/.test(text)) return 'Google Signal / Segment';
        if (/(interest|behavior|in-market|affinity|detailed targeting|stacked)/.test(text)) return 'Detailed Targeting';
        return 'Mixed / Layered';
    }

    function inferIntentCluster(label) {
        const text = String(label || '').toLowerCase();
        if (!text) return 'Unknown intent';
        if (/(trading|options|futures|derivatives|intraday)/.test(text)) return 'Active traders';
        if (/(sip|mutual fund|wealth|invest|long term|portfolio|financial planning)/.test(text)) return 'Long-term wealth builders';
        if (/(demat|broker|brokerage|account opening|onboarding)/.test(text)) return 'First-time market starters';
        if (/(education|learn|course|masterclass|webinar|workshop)/.test(text)) return 'Education seekers';
        if (/(tax|saving|retirement|insurance|planning)/.test(text)) return 'Planning / tax intent';
        if (/(hni|premium|high net worth|affluent|advisor|advisory)/.test(text)) return 'High-value advisory prospects';
        if (/(news|market news|updates|watchlist)/.test(text)) return 'Market followers';
        if (/(trust|authority|expert|safe|secure|credible|proof)/.test(text)) return 'Trust-seeking users';
        if (/(trial|signup|lead|demo|form|quote|pricing)/.test(text)) return 'High-intent converters';
        if (/(retarget|remarket|return|dormant|lapsed|reactivation)/.test(text)) return 'Reactivation / retargeting';
        return 'Mixed intent';
    }

    function inferStrategicRole(row, summary) {
        const spend = toNum(row && row.spend);
        const cac = toNum(row && row.d6_cac);
        const roas = toNum(row && row.d6_roas);
        const sample = toNum(row && row.sample_count);
        const mature = spend >= MIN_AUDIENCE_TEST_SPEND;
        if (!mature || sample < 2) return 'Test / learn';
        if (roas > 1.1 && cac > 0 && roas > 1.5) return 'Scale';
        if (roas > 0.9 || cac > 0) return 'Maintain';
        return 'Prune / rework';
    }

    function enrichAudienceObject(item, summary, evidence, platform) {
        const label = String(item && (item.audience_label || item.audience || item.title || item.entity_name || item.label || '')).trim();
        return {
            ...item,
            audience_bucket: item.audience_bucket || inferAudienceBucket(label, platform),
            intent_cluster: item.intent_cluster || inferIntentCluster(label),
            strategic_role: item.strategic_role || inferStrategicRole(item, summary),
            audience_label: label || item.audience_label || item.title || item.entity_name || item.label || '--',
            exact_bucket_id: item.exact_bucket_id || String(item.exact_audience_key || '').slice(0, 10),
            exact_bucket_label: item.exact_bucket_label || (label ? `${label} [${String(item.exact_audience_key || '').slice(0, 10)}]` : ''),
            ...buildAudienceSanityMeta(item, summary, evidence)
        };
    }

    function normalizeAudienceItems(items, summary, evidence) {
        return (Array.isArray(items) ? items : []).map(item => enrichAudienceObject(item, summary, evidence, summary && summary.platform));
    }

    function normalizeAudiencePlan(plan, summary, evidence) {
        const normalized = plan && typeof plan === 'object' ? { ...plan } : {};
        normalized.audience_actions = normalizeAudienceItems(normalized.audience_actions || normalized.actions || [], summary, evidence);
        normalized.what_worked_best = normalizeAudienceItems(normalized.what_worked_best || [], summary, evidence);
        normalized.what_is_weak = normalizeAudienceItems(normalized.what_is_weak || [], summary, evidence);
        normalized.new_tests_to_try = normalizeAudienceItems(normalized.new_tests_to_try || [], summary, evidence);
        normalized.do_not_touch = Array.isArray(normalized.do_not_touch) ? normalized.do_not_touch : [];
        normalized.watch_list = Array.isArray(normalized.watch_list) ? normalized.watch_list : [];
        normalized.morning_brief = normalized.morning_brief || {};
        normalized.morning_brief.what_to_do_right_now = Array.isArray(normalized.morning_brief.what_to_do_right_now) ? normalized.morning_brief.what_to_do_right_now : [];
        normalized.morning_brief.what_to_leave_alone = Array.isArray(normalized.morning_brief.what_to_leave_alone) ? normalized.morning_brief.what_to_leave_alone : [];
        normalized.morning_brief.campaign_insights = Array.isArray(normalized.morning_brief.campaign_insights) ? normalized.morning_brief.campaign_insights : [];
        normalized.morning_brief.audience_insights = Array.isArray(normalized.morning_brief.audience_insights) ? normalized.morning_brief.audience_insights : [];
        normalized.morning_brief.this_weeks_moves = Array.isArray(normalized.morning_brief.this_weeks_moves) ? normalized.morning_brief.this_weeks_moves : [];
        return normalized;
    }

    function buildConcentrationTestIdeas(platform, summary) {
        const isGoogle = String(platform || 'meta').toLowerCase() === 'google';
        const dominant = summary && summary.dominant_audience;
        if (!dominant) return [];
        const label = dominant.exact_bucket_label || dominant.audience || '--';
        const bucket = dominant.audience_bucket || inferAudienceBucket(label, platform);
        const intent = dominant.intent_cluster || inferIntentCluster(label);
        const share = Math.round((summary.spend_concentration || 0) * 100);
        const shared = {
            audience_bucket: bucket,
            intent_cluster: intent,
            strategic_role: 'Test / learn',
            exact_bucket_id: dominant.exact_bucket_id || '',
            exact_bucket_label: label,
            source_label: summary.source_label,
            date_label: summary.date_label,
            maturity_label: 'Mature',
            sanity_status: 'PASS',
            sanity_detail: 'Derived from spend concentration guard'
        };

        const tests = [];
        if (isGoogle) {
            tests.push({
                title: `Split the dominant Google bucket by query theme (${share}% spend)`,
                reason: `Exact audience bucket ${label} owns ${share}% of spend.`,
                action: 'Create a nearby custom segment / search-theme test and keep only one variable different.',
                what_to_change: 'Custom segment / query theme',
                why_this_change: 'The current bucket is too concentrated to learn from recycled tests.',
                ...shared
            });
            tests.push({
                title: 'Test the dominant bucket with a cleaner signal',
                reason: `The dominant Google bucket should be re-tested with a cleaner signal, not repeated as-is.`,
                action: 'Shift to a cleaner audience signal or observation setup and compare D6 CAC / ROAS.',
                what_to_change: 'Audience signal / observation vs targeting',
                why_this_change: 'A cleaner signal should reveal whether the winner is real or just overfit.',
                ...shared
            });
        } else {
            tests.push({
                title: `Split the dominant Meta bucket by age or geo (${share}% spend)`,
                reason: `Exact audience bucket ${label} owns ${share}% of spend.`,
                action: 'Clone the dominant audience into one adjacent age band or geo slice and keep creative constant.',
                what_to_change: 'Age band / geo / exclusions',
                why_this_change: 'Adjacent Meta slices will tell you whether the current winner is truly broad or just overfit.',
                ...shared
            });
            tests.push({
                title: 'Test the dominant bucket with one new creative angle',
                reason: 'The current winner should be challenged with a new hook, not a recycled bucket.',
                action: 'Keep the same audience shape but change the hook or creative angle in one challenger.',
                what_to_change: 'Creative angle',
                why_this_change: 'This isolates whether the audience is strong or just matched to one creative.',
                ...shared
            });
        }
        return tests;
    }

    function getAudienceRecommendationSnapshot(platform) {
        const d = db();
        const isGoogle = String(platform || 'meta').toLowerCase() === 'google';
        const rows = d.prepare(`
            SELECT id, platform, rec_type, title, hypothesis, priority, urgency, status, vertical, action_type, rationale, specific_change
            FROM at_recommendations
            WHERE platform = ? AND status = 'pending'
            ORDER BY generated_at DESC
            LIMIT 12
        `).all(isGoogle ? 'google' : 'meta');
        return rows.map(r => ({
            id: r.id,
            title: r.title || '',
            rec_type: r.rec_type || '',
            priority: r.priority || '',
            urgency: r.urgency || '',
            action_type: r.action_type || '',
            rationale: r.rationale || r.hypothesis || '',
            specific_change: r.specific_change || '',
            vertical: r.vertical || '',
            status: r.status || ''
        }));
    }

    function buildAudienceFallbackPlan(platform, summary, evidence, feedback) {
        const isGoogle = String(platform || 'meta').toLowerCase() === 'google';
        const dominant = summary && summary.dominant_audience;
        const concentrated = (summary && summary.spend_concentration || 0) >= 0.9 && dominant;
        const winners = (summary.best_audiences || []).slice(0, concentrated ? 1 : 4);
        const losers = concentrated ? [] : (summary.weak_audiences || []).slice(0, 4);
        const tests = (summary.test_ideas || []).slice(0, 4);
        const fmt = (n) => Math.round(toNum(n) * 100) / 100;
        const bucketOf = (a) => a.audience_bucket || inferAudienceBucket(a.audience || a.label || '', platform);
        const intentOf = (a) => a.intent_cluster || inferIntentCluster(a.audience || a.label || '');
        const roleOf = (a) => a.strategic_role || inferStrategicRole(a, summary);
        const actions = [];

        if (concentrated && dominant) {
            const label = dominant.exact_bucket_label || dominant.audience || '--';
            actions.push({
                action_id: 'AT-CONC-1',
                priority: 'P1',
                action_type: 'TEST_ADJACENT_AUDIENCE',
                audience_label: label,
                audience_bucket: dominant.audience_bucket || inferAudienceBucket(label, platform),
                intent_cluster: dominant.intent_cluster || inferIntentCluster(label),
                strategic_role: 'Scale / test',
                campaign_name: dominant.campaign_name || '',
                adset_name: dominant.adset_name || '',
                diagnosis: `One exact audience bucket owns ${Math.round((summary.spend_concentration || 0) * 100)}% of spend. Stop recycling the same pocket; test adjacent audience definitions.`,
                action_detail: isGoogle
                    ? 'Create adjacent Google audience or signal tests that change one targeting variable at a time.'
                    : 'Create adjacent Meta audience tests that change one targeting variable at a time.',
                what_to_change: isGoogle ? 'Audience signal / query theme' : 'Age band / geo / exclusions / seed',
                why_this_change: 'The account is too concentrated to learn from more of the same; adjacent buckets will give cleaner signal.',
                expected_impact: 'More distinct learning and clearer scale/prune decisions.',
                risk: 'Adjacent tests may underperform if the dominant bucket is the only strong pocket.',
                success_metric: 'd6_roas',
                confidence: 'HIGH',
                spend: dominant.spend || 0,
                d6_cac: dominant.d6_cac || 0,
                d6_roas: dominant.d6_roas || 0,
                sample_count: dominant.sample_count || 0
            });
        }

        winners.forEach((a, idx) => {
            const label = a.audience || a.label || '--';
            actions.push({
                action_id: `AT-FB-${idx + 1}`,
                priority: idx === 0 ? 'P1' : 'P2',
                action_type: isGoogle ? 'SCALE_AUDIENCE' : 'CLONE_WITH_NEW_CREATIVE',
                audience_label: label,
                audience_bucket: bucketOf(a),
                intent_cluster: intentOf(a),
                strategic_role: roleOf(a),
                campaign_name: a.campaign_name || '',
                adset_name: a.adset_name || '',
                diagnosis: `Winner: ${label} spent ${fmt(a.spend)} and is leading on D6 output at ${a.d6_roas ? a.d6_roas.toFixed(2) + 'x ROAS' : '--'} / ${a.d6_cac ? '₹' + Math.round(a.d6_cac) : '--'} CAC.`,
                action_detail: isGoogle
                    ? 'Scale only budget on this audience bucket and keep the signal stable.'
                    : 'Keep the audience shape, refresh the creative angle, and test one challenger against the winner.',
                what_to_change: isGoogle ? 'Budget only' : 'Creative angle + challenger audience',
                why_this_change: isGoogle ? 'The intent pocket is already proven; budget is the least risky lever.' : 'The audience is working, so the next change should isolate creative fit, not audience fit.',
                expected_impact: 'Protect the current winner and extend the pocket carefully.',
                risk: 'Over-scaling could flatten efficiency if delivery broadens too fast.',
                success_metric: 'd6_roas',
                confidence: a.sample_count >= 3 ? 'HIGH' : 'MEDIUM',
                spend: a.spend || 0,
                d6_cac: a.d6_cac || 0,
                d6_roas: a.d6_roas || 0,
                sample_count: a.sample_count || 0
            });
        });

        losers.forEach((a, idx) => {
            const label = a.audience || a.label || '--';
            actions.push({
                action_id: `AT-FB-W-${idx + 1}`,
                priority: idx === 0 ? 'P1' : 'P2',
                action_type: 'PAUSE_AUDIENCE',
                audience_label: label,
                audience_bucket: bucketOf(a),
                intent_cluster: intentOf(a),
                strategic_role: roleOf(a),
                campaign_name: a.campaign_name || '',
                adset_name: a.adset_name || '',
                diagnosis: `Weak pocket: ${label} spent ${fmt(a.spend)} with ${a.conversions || 0} conversions and poor D6 output.`,
                action_detail: isGoogle
                    ? 'Reduce spend or narrow the signal, then test a cleaner query/audience mix.'
                    : 'Pause or narrow the pocket, keep spend concentrated in winners, and launch a cleaner audience variant.',
                what_to_change: isGoogle ? 'Query theme / audience signal' : 'Audience exclusions / layering / creative fit',
                why_this_change: isGoogle ? 'The current traffic mix is too broad or too weakly intended.' : 'The current pocket is likely too loose, overlapping, or misaligned with the offer.',
                expected_impact: 'Reduce waste and shift budget into stronger pockets.',
                risk: 'If the label is under-grouped, pausing too hard may remove a valid segment.',
                success_metric: 'd6_cac',
                confidence: a.sample_count >= 3 ? 'HIGH' : 'MEDIUM',
                spend: a.spend || 0,
                d6_cac: a.d6_cac || 0,
                d6_roas: a.d6_roas || 0,
                sample_count: a.sample_count || 0
            });
        });

        tests.forEach((a, idx) => {
            const label = a.title || a.audience || a.label || '--';
            actions.push({
                action_id: `AT-FB-T-${idx + 1}`,
                priority: idx === 0 ? 'P1' : 'P2',
                action_type: 'TEST_ADJACENT_AUDIENCE',
                audience_label: label,
                audience_bucket: bucketOf(a),
                intent_cluster: intentOf(a),
                strategic_role: 'Test / learn',
                campaign_name: a.campaign_name || '',
                adset_name: a.adset_name || '',
                diagnosis: a.reason || 'Adjacent audience test based on a winning historical pattern.',
                action_detail: a.action || (isGoogle ? 'Test a nearby signal / custom segment against the current winner.' : 'Test the adjacent audience slice with the same creative theme.'),
                what_to_change: isGoogle ? 'Signal quality / custom segment' : 'Audience seed / layering / exclusions',
                why_this_change: isGoogle ? 'Keep intent close to the winner while stripping out weak traffic sources.' : 'Preserve the winning audience logic while probing a cleaner pocket.',
                expected_impact: 'Find a cheaper or broader pocket without losing the winning signal.',
                risk: 'New test may underperform until enough spend accrues.',
                success_metric: 'd6_cac',
                confidence: a.conversions >= 3 ? 'HIGH' : 'MEDIUM',
                spend: 0,
                d6_cac: 0,
                d6_roas: 0,
                sample_count: a.conversions || 0
            });
        });

        const doNow = [];
        if (winners[0]) doNow.push(`Scale ${winners[0].audience || winners[0].label} in small steps`);
        if (losers[0]) doNow.push(`Reduce or pause ${losers[0].audience || losers[0].label}`);
        if (tests[0]) doNow.push(`Launch ${tests[0].title || tests[0].audience || tests[0].label}`);

        const operatorSummary = concentrated && dominant
            ? `Spend is concentrated in one exact audience bucket (${dominant.exact_bucket_label || dominant.audience || '--'}) at ${Math.round((summary.spend_concentration || 0) * 100)}% of spend. Focus on adjacent audience tests instead of repeating the same bucket.`
            : [
                `Audience strategy built from ${winners.length} winners, ${losers.length} weak pockets, and ${tests.length} test ideas.`,
                feedback ? `Feedback applied: ${feedback}` : null,
                evidence && evidence.minimum_test_spend ? `Spend floor: ₹${evidence.minimum_test_spend}` : null
            ].filter(Boolean).join(' ');

        const diagnostics = {
            broad_vs_narrow: [
                `${winners[0] ? 'Winner cluster is' : 'Current cluster is'} ${bucketOf(winners[0] || {}) || 'unknown'}; only widen if quality holds.`
            ],
            overlap_risk: ['Merge closely related pockets before creating new variants.'],
            saturation_risk: ['Use the spend floor to avoid calling small pockets saturated too early.'],
            quality_vs_volume_tradeoff: ['Protect higher-quality D6 outcomes over cheap but weak volume.'],
            creative_fit_issues: ['If winners are strong but challengers fail, the issue may be creative fit rather than audience fit.'],
            funnel_fit_issues: ['If top-funnel looks strong but downstream CAC is weak, the audience is likely curiosity-driven.']
        };

        const roadmap = {
            immediate_actions: [
                winners[0] ? `Scale ${winners[0].audience || winners[0].label} carefully` : null,
                losers[0] ? `Reduce or pause ${losers[0].audience || losers[0].label}` : null
            ].filter(Boolean),
            this_week: [
                tests[0] ? `Launch adjacent test: ${tests[0].title || tests[0].audience || tests[0].label}` : null,
                'Consolidate overlapping audience pockets'
            ].filter(Boolean),
            next_test_cycle: [
                'Test one cleaner audience variant around the winner',
                'Split by higher-intent seed / narrower signal where quality is weak'
            ],
            prioritized_testing_roadmap: [
                { priority: 'P1', action: doNow[0] || 'Scale current winner carefully' },
                { priority: 'P2', action: doNow[1] || 'Fix the weakest pocket' },
                { priority: 'P3', action: doNow[2] || 'Launch the adjacent audience test' }
            ]
        };

        return {
            executive_summary: operatorSummary,
            operator_answer: operatorSummary,
            audience_actions: actions.slice(0, 8),
            what_worked_best: winners.map(a => ({
                audience: a.audience || a.label,
                exact_bucket_id: a.exact_bucket_id || '',
                exact_bucket_label: a.exact_bucket_label || '',
                audience_bucket: bucketOf(a),
                intent_cluster: intentOf(a),
                strategic_role: 'Scale',
                spend: a.spend,
                d6_cac: a.d6_cac,
                d6_roas: a.d6_roas,
                sample_count: a.sample_count,
                source_label: summary.source_label,
                date_label: summary.date_label,
                maturity_label: 'Mature',
                sanity_status: 'PASS',
                sanity_detail: 'Spend floor met; metrics present'
            })),
            what_is_weak: losers.map(a => ({
                audience: a.audience || a.label,
                exact_bucket_id: a.exact_bucket_id || '',
                exact_bucket_label: a.exact_bucket_label || '',
                audience_bucket: bucketOf(a),
                intent_cluster: intentOf(a),
                strategic_role: 'Prune / rework',
                spend: a.spend,
                d6_cac: a.d6_cac,
                d6_roas: a.d6_roas,
                sample_count: a.sample_count,
                source_label: summary.source_label,
                date_label: summary.date_label,
                maturity_label: 'Mature',
                sanity_status: 'PASS',
                sanity_detail: 'Spend floor met; metrics present'
            })),
            new_tests_to_try: tests.map(a => ({
                title: a.title || a.audience || a.label,
                exact_bucket_id: a.exact_bucket_id || '',
                exact_bucket_label: a.exact_bucket_label || '',
                audience_bucket: bucketOf(a),
                intent_cluster: intentOf(a),
                strategic_role: 'Test / learn',
                reason: a.reason || '',
                action: a.action || '',
                what_to_change: isGoogle ? 'Signal / query theme' : 'Audience seed / layering / exclusions',
                why_this_change: a.reason || 'Adjacent test should preserve the winning signal while reducing waste.',
                sample_count: a.conversions || 0,
                source_label: summary.source_label,
                date_label: summary.date_label,
                maturity_label: 'Mature',
                sanity_status: 'PASS',
                sanity_detail: 'Derived from historical winners and live flags'
            })),
            do_not_touch: winners.slice(0, 2).map(a => a.audience || a.label).filter(Boolean),
            watch_list: losers.slice(0, 2).map(a => a.audience || a.label).filter(Boolean),
            diagnostics,
            roadmap,
            morning_brief: {
                executive_summary: operatorSummary,
                what_to_do_right_now: doNow,
                what_to_leave_alone: winners.slice(0, 2).map(a => a.audience || a.label).filter(Boolean),
                campaign_insights: losers.slice(0, 2).map(a => a.reason || a.action || 'Weak audience pocket').filter(Boolean),
                audience_insights: winners.slice(0, 2).map(a => a.reason || a.action || 'Winner audience pocket').filter(Boolean),
                this_weeks_moves: tests.slice(0, 2).map(a => a.action || a.reason || 'Adjacent audience test').filter(Boolean),
                thirty_day_horizon: {
                    risks: ['Audience fatigue if winners are scaled too fast', 'False negatives if weak pockets are under-spent'],
                    opportunities: ['Clone winners with a new angle', 'Test adjacent pockets around proven winners']
                }
            },
            feedback_used: feedback || '',
            request_scope: evidence && evidence.request_scope ? evidence.request_scope : null
        };
    }

    function analyzeAudienceDraftQuality(draft) {
        const plan = draft && draft.optimizer_plan ? draft.optimizer_plan : (draft || {});
        const actions = Array.isArray(plan.audience_actions) ? plan.audience_actions : (Array.isArray(plan.actions) ? plan.actions : []);
        const operatorAnswer = String(plan.operator_answer || plan.executive_summary || '');
        const brief = plan.morning_brief || {};
        const doNow = Array.isArray(brief.what_to_do_right_now) ? brief.what_to_do_right_now : [];
        const genericLabels = actions.filter(item => isGenericAudienceLabel(item && (item.audience_label || item.audience || item.title || item.entity_name || item.label))).length;
        const weakVerbCount = countPattern(operatorAnswer, /\b(check|review|look at|monitor|assess)\b/gi);
        const concreteVerbCount = countPattern(operatorAnswer, /\b(pause|scale|increase|decrease|cut|refresh|replace|duplicate|narrow|broaden|split|clone|test|shift|hold|reactivate|fix|launch|exclude)\b/gi);
        const repeated = actions.reduce((acc, item) => {
            const key = String(item && (item.action_detail || item.action_type || '')).toLowerCase().trim();
            if (!key) return acc;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const maxRepeated = Object.values(repeated).reduce((m, v) => Math.max(m, v), 0);
        const actionCount = actions.length;
        const weakActions = actions.filter(item => !String(item && (item.action_detail || '')).trim() || /\b(check|review|look at|monitor)\b/i.test(String(item && (item.action_detail || ''))));
        const errors = [];
        if (!actionCount && !doNow.length) errors.push('No actionable audience recommendations were produced.');
        if (weakVerbCount >= 3 && concreteVerbCount < Math.max(2, Math.floor(weakVerbCount / 2))) errors.push('Answer is too vague and does not use enough audience actions.');
        if (actionCount >= 4 && maxRepeated >= Math.ceil(actionCount * 0.7)) errors.push('Actions repeat too much across audiences.');
        if (weakActions.length >= Math.max(2, Math.floor(actionCount * 0.5))) errors.push('Many actions lack a concrete do-line.');
        if (operatorAnswer && !/\b(pause|scale|increase|decrease|refresh|replace|clone|split|narrow|broaden|test|exclude|reactivate|fix|launch)\b/i.test(operatorAnswer)) errors.push('Operator answer lacks explicit audience-action verbs.');
        if (genericLabels >= Math.max(2, Math.floor(Math.max(1, actionCount) * 0.5))) errors.push('Audience labels are too generic to be trusted.');
        return { passed: errors.length === 0, errors, stats: { action_count: actionCount, weak_verb_count: weakVerbCount, concrete_verb_count: concreteVerbCount, max_repeated_action_pattern: maxRepeated, weak_action_count: weakActions.length } };
    }

    function buildAudienceBrainPrompt(platform, userRequest, evidence, feedback) {
        const audienceVerbsMeta = ['PAUSE_AUDIENCE', 'SCALE_AUDIENCE', 'CLONE_WITH_NEW_CREATIVE', 'NARROW_AUDIENCE', 'BROADEN_AUDIENCE', 'SPLIT_AUDIENCE', 'TEST_ADJACENT_AUDIENCE', 'REFRESH_CREATIVE_FOR_AUDIENCE', 'KEEP'];
        const audienceVerbsGoogle = ['PAUSE_AUDIENCE', 'SCALE_AUDIENCE', 'CHANGE_QUERY_THEME', 'NARROW_AUDIENCE', 'BROADEN_AUDIENCE', 'SPLIT_AUDIENCE', 'TEST_ADJACENT_AUDIENCE', 'AUDIENCE_REFRESH', 'KEEP'];
        const verbs = platform === 'google' ? audienceVerbsGoogle : audienceVerbsMeta;
        return JSON.stringify({
            platform,
            user_request: userRequest,
            feedback: feedback || '',
            evidence,
            required_output: {
                optimizer_plan: {
                    executive_summary: 'short audience operator summary',
                    operator_answer: 'readable audience decision document',
                    audience_actions: [
                        {
                            action_id: 'AT-001',
                            priority: 'P1|P2|P3',
                            action_type: verbs[0],
                            audience_label: 'exact audience label',
                            audience_bucket: 'Broad | Lookalike | Customer / CRM | Detailed Targeting | Retargeting / High Intent | Google Signal / Segment',
                            intent_cluster: 'one of the financial advisory intent clusters',
                            strategic_role: 'Scale | Maintain | Prune / rework | Test / learn',
                            quality_score: 0,
                            quality_tier: 'High | Medium | Low',
                            overlap_risk: 'LOW | MEDIUM | HIGH',
                            fragmentation_risk: 'LOW | MEDIUM | HIGH',
                            merge_candidates: [],
                            campaign_name: '',
                            adset_name: '',
                            diagnosis: 'exact why this audience is strong or weak',
                            action_detail: 'exact do-line for this audience',
                            what_to_change: 'specific lever the media buyer should change',
                            why_this_change: 'why the change should work',
                            expected_impact: 'what should change',
                            risk: 'main risk',
                            success_metric: 'd6_cac|d6_roas|signups',
                            confidence: 'HIGH|MEDIUM|LOW',
                            spend: 0,
                            d6_cac: 0,
                            d6_roas: 0,
                            sample_count: 0
                        }
                    ],
                    what_worked_best: [],
                    what_is_weak: [],
                    new_tests_to_try: [],
                    do_not_touch: [],
                    watch_list: [],
                    diagnostics: {
                        broad_vs_narrow: [],
                        overlap_risk: [],
                        fragmentation_risk: [],
                        merge_candidates: [],
                        saturation_risk: [],
                        quality_tier_mix: [],
                        quality_vs_volume_tradeoff: [],
                        creative_fit_issues: [],
                        funnel_fit_issues: []
                    },
                    morning_brief: {
                        executive_summary: '',
                        what_to_do_right_now: [],
                        what_to_leave_alone: [],
                        campaign_insights: [],
                        audience_insights: [],
                        this_weeks_moves: [],
                        thirty_day_horizon: { risks: [], opportunities: [] }
                    },
                    roadmap: {
                        immediate_actions: [],
                        this_week: [],
                        next_test_cycle: [],
                        prioritized_testing_roadmap: []
                    }
                }
            }
        });
    }

    function buildMetaTestIdeas(winners, losers, patterns, flags, summary) {
        if (summary && (summary.spend_concentration || 0) >= 0.9 && summary.dominant_audience) {
            return buildConcentrationTestIdeas('meta', summary).slice(0, 5);
        }
        const ideas = [];
        const best = winners[0];
        const worst = losers[0];
        const topPattern = patterns[0];
        const scaleFlag = (flags || []).find(f => f.flag_type === 'SCALE_SIGNAL');
        const fatigueFlag = (flags || []).find(f => f.flag_type === 'AUDIENCE_FATIGUE');
        const badDeliveryFlag = (flags || []).find(f => f.flag_type === 'DELIVERY_ISSUE');

        if (best) {
            ideas.push({
                title: 'Clone the current winner with one new creative angle',
                reason: `Best pocket is ${best.audience || best.label} at ${platformLabel('meta')} D6 CAC ${best.d6_cac ? '₹' + Math.round(best.d6_cac) : '--'} and D6 ROAS ${best.d6_roas ? best.d6_roas.toFixed(2) + 'x' : '--'}.`,
                action: 'Keep the audience shape, change the hook/creative angle, and test one challenger against the winner.',
                conversions: best.conversions
            });
        }
        if (topPattern) {
            ideas.push({
                title: 'Test the winning formula on an adjacent audience slice',
                reason: `Historical pattern ${topPattern.pattern_key} is the strongest learned combo with D6 CAC ${topPattern.avg_d6_cac ? '₹' + Math.round(topPattern.avg_d6_cac) : '--'} and D6 ROAS ${topPattern.avg_d6_roas ? topPattern.avg_d6_roas.toFixed(2) + 'x' : '--'}.`,
                action: 'Keep the creative theme, move to the nearest adjacent audience bucket, and watch CAC against the learned median.',
                conversions: topPattern.sample_conversions
            });
        }
        if (worst) {
            ideas.push({
                title: 'Replace the weakest live audience pocket',
                reason: `Weak pocket ${worst.audience || worst.label} is spending ${worst.spend ? '₹' + Math.round(worst.spend) : '--'} with poor D6 output.`,
                action: 'Pause the weakest pocket, keep spend concentrated in winners, and launch a cleaner audience variant.',
                conversions: worst.conversions
            });
        }
        if (scaleFlag) {
            ideas.push({
                title: 'Scale the current scale candidate carefully',
                reason: scaleFlag.message,
                action: 'Increase budget only on the scale candidate by a small step and do not disturb the rest of the mix.',
                conversions: 30
            });
        }
        if (fatigueFlag) {
            ideas.push({
                title: 'Refresh the audience or creative to break fatigue',
                reason: fatigueFlag.message,
                action: 'Keep the pocket live only if it still has a clear winner; otherwise rotate creative or narrow the audience.',
                conversions: 15
            });
        }
        if (badDeliveryFlag) {
            ideas.push({
                title: 'Test delivery headroom before calling the audience bad',
                reason: badDeliveryFlag.message,
                action: 'Loosen the constraint that is choking delivery, then recheck CAC and ROAS before cutting the audience.',
                conversions: 10
            });
        }
        return ideas.slice(0, 5);
    }

    function buildGoogleTestIdeas(winners, losers, patterns, flags, summary) {
        if (summary && (summary.spend_concentration || 0) >= 0.9 && summary.dominant_audience) {
            return buildConcentrationTestIdeas('google', summary).slice(0, 5);
        }
        const ideas = [];
        const best = winners[0];
        const worst = losers[0];
        const topPattern = patterns[0];
        const scaleFlag = (flags || []).find(f => f.flag_type === 'SCALE_SIGNAL');
        const fatigueFlag = (flags || []).find(f => f.flag_type === 'AUDIENCE_FATIGUE');
        const highSpendFlag = (flags || []).find(f => f.flag_type === 'HIGH_SPEND_NO_CONV');

        if (best) {
            ideas.push({
                title: 'Clone the winning Google pocket with a fresh challenger',
                reason: `Best live pocket ${best.audience || best.label} is carrying the strongest D6 output at ROAS ${best.d6_roas ? best.d6_roas.toFixed(2) + 'x' : '--'} and CAC ${best.d6_cac ? '₹' + Math.round(best.d6_cac) : '--'}.`,
                action: 'Keep the winning search/audience shape and test one new challenger with a distinct creative or target CPA.',
                conversions: best.conversions
            });
        }
        if (topPattern) {
            ideas.push({
                title: 'Test the strongest learned Google pattern again',
                reason: `Learned combo ${topPattern.pattern_key} is the strongest historical pattern with ROAS ${topPattern.avg_d6_roas ? topPattern.avg_d6_roas.toFixed(2) + 'x' : '--'}.`,
                action: 'Recreate the winning pocket with a tighter query or audience filter and keep budget disciplined.',
                conversions: topPattern.sample_conversions
            });
        }
        if (worst) {
            ideas.push({
                title: 'Replace the weakest Google pocket before scaling',
                reason: `Weak pocket ${worst.audience || worst.label} is spending ${worst.spend ? '₹' + Math.round(worst.spend) : '--'} with weak downstream D6 output.`,
                action: 'Cut or pause the loser, then test a cleaner ad group, audience, or search-term mix.',
                conversions: worst.conversions
            });
        }
        if (highSpendFlag) {
            ideas.push({
                title: 'Fix the no-conversion spend leak first',
                reason: highSpendFlag.message,
                action: 'Use this pocket as a test for query cleanup, audience refinement, or target CPA reset before adding budget.',
                conversions: 10
            });
        }
        if (scaleFlag) {
            ideas.push({
                title: 'Scale the proven Google pocket slowly',
                reason: scaleFlag.message,
                action: 'Increase only the strongest pocket and keep the rest unchanged until the next review.',
                conversions: 30
            });
        }
        if (fatigueFlag) {
            ideas.push({
                title: 'Refresh the audience / query shape',
                reason: fatigueFlag.message,
                action: 'Rotate the asset or tighten the query set before the pocket deteriorates further.',
                conversions: 15
            });
        }
        return ideas.slice(0, 5);
    }

    function buildAudienceSummary(platform) {
        const d = db();
        const isGoogle = String(platform || 'meta').toLowerCase() === 'google';
        const normalizedPlatform = isGoogle ? 'google' : 'meta';
        const patterns = learningEngine.getPatterns(normalizedPlatform) || [];
        const liveFlags = optimizer.getFlags({ platform: normalizedPlatform }) || [];
        const patternHighlights = pickTopPatternSummary(patterns);

        if (!isGoogle) {
            const rows = d.prepare(`
                SELECT a.*, mc.name AS campaign_name, mc.vertical, mc.objective
                FROM at_meta_adsets a
                LEFT JOIN at_meta_campaigns mc ON mc.meta_campaign_id = a.meta_campaign_id
                WHERE a.total_spend > 0
                ORDER BY a.total_spend DESC
                LIMIT 2000
            `).all();
            const summary = buildSummaryCards(rows, buildMetaAudienceLabel, normalizedPlatform, buildMetaAudienceExactKey);
            return {
                platform: normalizedPlatform,
                platform_label: platformLabel(normalizedPlatform),
                source_label: 'Meta + Metabase',
                date_label: 'Selected scan window',
                best_audiences: summary.winners,
                weak_audiences: summary.losers,
                family_signals: summary.family_signals || [],
                spend_concentration: summary.spend_concentration || 0,
                dominant_audience: summary.dominant_audience || null,
                test_ideas: buildMetaTestIdeas(summary.winners, summary.losers, patternHighlights, liveFlags, summary),
                learned_formulas: patternHighlights,
                live_flags: liveFlags.slice(0, 8),
                flag_counts: {
                    critical: liveFlags.filter(f => (f.severity || '').toUpperCase() === 'CRITICAL').length,
                    warning: liveFlags.filter(f => (f.severity || '').toUpperCase() === 'WARNING').length,
                    opportunity: liveFlags.filter(f => (f.severity || '').toUpperCase() === 'OPPORTUNITY').length
                }
            };
        }

        const adgroups = d.prepare(`
            SELECT ag.*, gc.name AS campaign_name, gc.vertical, gc.channel_type
            FROM at_google_adgroups ag
            LEFT JOIN at_google_campaigns gc ON gc.google_campaign_id = ag.google_campaign_id
            WHERE ag.total_spend > 0
            ORDER BY ag.total_spend DESC
            LIMIT 2000
        `).all();
        const audienceRows = d.prepare(`
            SELECT
                a.adgroup_id,
                a.criterion_type,
                a.audience_name,
                a.audience_id,
                a.age_range,
                a.gender,
                a.device_type
            FROM at_google_audiences a
            ORDER BY a.adgroup_id, a.criterion_type, a.audience_name, a.audience_id, a.age_range, a.gender, a.device_type
        `).all();
        const audienceMap = {};
        audienceRows.forEach(r => {
            if (!audienceMap[r.adgroup_id]) audienceMap[r.adgroup_id] = [];
            audienceMap[r.adgroup_id].push(r);
        });

        const exactKeyByAdgroup = {};
        Object.keys(audienceMap).forEach(adgroupId => {
            exactKeyByAdgroup[adgroupId] = buildGoogleAudienceExactKey(audienceMap[adgroupId]);
        });

        const summary = buildSummaryCards(adgroups.map(row => {
            const exactRows = audienceMap[row.google_adgroup_id] || [];
            const label = buildGoogleAudienceLabel(row, exactRows);
            const exactKey = exactKeyByAdgroup[row.google_adgroup_id] || buildAudienceExactKey(row, normalizedPlatform);
            return Object.assign({}, row, {
                exact_audience_key: exactKey,
                exact_bucket_id: String(exactKey || '').slice(0, 10),
                exact_bucket_label: `${label} [${String(exactKey || '').slice(0, 10)}]`,
                audience_label: label
            });
        }), function(row) {
            return row.audience_label || buildGoogleAudienceLabel(row, audienceMap[row.google_adgroup_id] || []);
        }, normalizedPlatform, function(row) {
            return row.exact_audience_key || exactKeyByAdgroup[row.google_adgroup_id] || buildAudienceExactKey(row, normalizedPlatform);
        });
        return {
            platform: normalizedPlatform,
            platform_label: platformLabel(normalizedPlatform),
            source_label: 'Google Ads + AT',
            date_label: 'Selected scan window',
            best_audiences: summary.winners,
            weak_audiences: summary.losers,
            family_signals: summary.family_signals || [],
            spend_concentration: summary.spend_concentration || 0,
            dominant_audience: summary.dominant_audience || null,
            test_ideas: buildGoogleTestIdeas(summary.winners, summary.losers, patternHighlights, liveFlags, summary),
            learned_formulas: patternHighlights,
            live_flags: liveFlags.slice(0, 8),
            flag_counts: {
                critical: liveFlags.filter(f => (f.severity || '').toUpperCase() === 'CRITICAL').length,
                warning: liveFlags.filter(f => (f.severity || '').toUpperCase() === 'WARNING').length,
                opportunity: liveFlags.filter(f => (f.severity || '').toUpperCase() === 'OPPORTUNITY').length
            }
        };
    }

    // ==================== META SCANNER ====================

    // GET /meta/scan/trigger — Trigger a full Meta scan
    router.get('/meta/scan/trigger', async (req, res) => {
        try {
            const resultPromise = metaScanner.runFullScan();
            resultPromise.catch(err => console.error('[AT] meta scan error:', err.message));
            res.json({ success: true, data: { status: 'started', message: 'Full Meta scan triggered' } });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /meta/scan/status — Get Meta scan status
    router.get('/meta/scan/status', (req, res) => {
        try {
            const status = metaScanner.getScanStatus();
            res.json({ success: true, data: status });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /meta/adsets — Query adsets with optional filters
    router.get('/meta/adsets', (req, res) => {
        try {
            const d = db();
            const conditions = ['1=1'];
            const params = [];

            if (req.query.vertical) {
                conditions.push(`mc.vertical = ?`);
                params.push(req.query.vertical);
            }
            if (req.query.status) {
                conditions.push(`a.status = ?`);
                params.push(req.query.status.toUpperCase());
            }
            if (req.query.min_spend) {
                conditions.push(`a.total_spend >= ?`);
                params.push(parseFloat(req.query.min_spend));
            }

            const sql = `
                SELECT a.*, mc.name AS campaign_name, mc.vertical, mc.objective
                FROM at_meta_adsets a
                LEFT JOIN at_meta_campaigns mc ON mc.meta_campaign_id = a.meta_campaign_id
                WHERE ${conditions.join(' AND ')}
                ORDER BY a.total_spend DESC
                LIMIT 500
            `;
            const rows = d.prepare(sql).all(...params);
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /meta/campaigns — Query Meta campaigns
    router.get('/meta/campaigns', (req, res) => {
        try {
            const d = db();
            const rows = d.prepare(`
                SELECT * FROM at_meta_campaigns ORDER BY total_spend DESC
            `).all();
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== GOOGLE SCANNER ====================

    // GET /google/scan/trigger — Trigger a full Google scan
    router.get('/google/scan/trigger', async (req, res) => {
        try {
            const resultPromise = googleScanner.runFullScan();
            resultPromise.catch(err => console.error('[AT] google scan error:', err.message));
            res.json({ success: true, data: { status: 'started', message: 'Full Google scan triggered' } });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /google/scan/status — Get Google scan status
    router.get('/google/scan/status', (req, res) => {
        try {
            const status = googleScanner.getScanStatus();
            res.json({ success: true, data: status });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /google/adgroups — Query Google adgroups
    router.get('/google/adgroups', (req, res) => {
        try {
            const d = db();
            const conditions = ['1=1'];
            const params = [];

            if (req.query.status) {
                conditions.push(`ag.status = ?`);
                params.push(req.query.status.toUpperCase());
            }
            if (req.query.min_spend) {
                conditions.push(`ag.total_spend >= ?`);
                params.push(parseFloat(req.query.min_spend));
            }

            const sql = `
                SELECT ag.*, gc.name AS campaign_name, gc.vertical, gc.channel_type
                FROM at_google_adgroups ag
                LEFT JOIN at_google_campaigns gc ON gc.google_campaign_id = ag.google_campaign_id
                WHERE ${conditions.join(' AND ')}
                ORDER BY ag.total_spend DESC
                LIMIT 500
            `;
            const rows = d.prepare(sql).all(...params);
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /google/campaigns — Query Google campaigns
    router.get('/google/campaigns', (req, res) => {
        try {
            const d = db();
            const rows = d.prepare(`
                SELECT * FROM at_google_campaigns ORDER BY total_spend DESC
            `).all();
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    router.get('/google/audiences', (req, res) => {
        try {
            const d = db();
            const rows = d.prepare(`SELECT * FROM at_google_audiences ORDER BY impressions DESC, spend DESC LIMIT 2000`).all();
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    router.get('/google/breakdowns', (req, res) => {
        try {
            const d = db();
            const rows = d.prepare(`SELECT * FROM at_google_breakdowns ORDER BY spend DESC, impressions DESC LIMIT 5000`).all();
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    router.get('/google/keywords', (req, res) => {
        try {
            const d = db();
            const rows = d.prepare(`SELECT * FROM at_google_keywords ORDER BY spend DESC, impressions DESC LIMIT 5000`).all();
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    router.get('/google/search-terms', (req, res) => {
        try {
            const d = db();
            const rows = d.prepare(`SELECT * FROM at_google_search_terms ORDER BY spend DESC, impressions DESC LIMIT 5000`).all();
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    router.get('/google/asset-groups', (req, res) => {
        try {
            const d = db();
            const rows = d.prepare(`SELECT * FROM at_google_asset_groups ORDER BY name ASC`).all();
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== ENRICHMENT ====================

    // POST /enrich/meta — Trigger Meta enrichment from Metabase
    router.post('/enrich/meta', async (req, res) => {
        try {
            const result = await enricher.enrichMeta();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /enrich/google — Trigger Google enrichment from Metabase
    router.post('/enrich/google', async (req, res) => {
        try {
            const result = await enricher.enrichGoogle();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /enrich/status — Get enrichment status
    router.get('/enrich/status', (req, res) => {
        try {
            const status = enricher.getEnrichmentStatus();
            res.json({ success: true, data: status });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== LEARNING ====================

    // POST /learn/meta — Trigger Meta pattern analysis
    router.post('/learn/meta', async (req, res) => {
        try {
            const result = await learningEngine.runMetaAnalysis();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /learn/google — Trigger Google pattern analysis
    router.post('/learn/google', async (req, res) => {
        try {
            const result = await learningEngine.runGoogleAnalysis();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /patterns/meta — Get Meta patterns
    router.get('/patterns/meta', (req, res) => {
        try {
            const patterns = learningEngine.getPatterns('meta');
            res.json({ success: true, data: patterns });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /patterns/google — Get Google patterns
    router.get('/patterns/google', (req, res) => {
        try {
            const patterns = learningEngine.getPatterns('google');
            res.json({ success: true, data: patterns });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /patterns/summary — Top findings from both platforms
    router.get('/patterns/summary', (req, res) => {
        try {
            const metaPatterns = learningEngine.getPatterns('meta');
            const googlePatterns = learningEngine.getPatterns('google');

            // Take top 5 from each by confidence then sample size
            const topMeta = (Array.isArray(metaPatterns) ? metaPatterns : []).slice(0, 5);
            const topGoogle = (Array.isArray(googlePatterns) ? googlePatterns : []).slice(0, 5);

            res.json({
                success: true,
                data: {
                    meta: { total: (Array.isArray(metaPatterns) ? metaPatterns.length : 0), top: topMeta },
                    google: { total: (Array.isArray(googlePatterns) ? googlePatterns.length : 0), top: topGoogle }
                }
            });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /audience/summary — Optimizer-grade audience intelligence for a platform
    router.get('/audience/summary', (req, res) => {
        try {
            const platform = String(req.query.platform || 'meta').toLowerCase() === 'google' ? 'google' : 'meta';
            const summary = buildAudienceSummary(platform);
            res.json({ success: true, data: summary });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    router.post('/audience/brain', async (req, res) => {
        try {
            const platform = String((req.body && req.body.platform) || req.query.platform || 'meta').toLowerCase() === 'google' ? 'google' : 'meta';
            const userRequest = String((req.body && req.body.user_request) || 'Give optimizer-level audience insights and actions.').trim();
            const feedback = String((req.body && req.body.feedback) || '').trim();
            const summary = buildAudienceSummary(platform);
            const currentRecommendations = Array.isArray(req.body && req.body.current_recommendations) && req.body.current_recommendations.length
                ? req.body.current_recommendations
                : getAudienceRecommendationSnapshot(platform);
            const evidence = buildAudienceBrainEvidence(platform, summary, {
                request_scope: req.body && req.body.request_scope ? req.body.request_scope : null,
                current_recommendations: currentRecommendations
            });
            const cacheKey = getBrainCacheKey(platform, { feedback, user_request: userRequest }, summary);
            const cached = getBrainCache(cacheKey);
            if (cached) {
                return res.json({ success: true, cached: true, ...cached });
            }

            const fallbackPlan = buildAudienceFallbackPlan(platform, summary, evidence, feedback);
            const normalizedFallbackPlan = normalizeAudiencePlan(fallbackPlan, summary, evidence);
            if (!OpenAI || !OPENAI_API_KEY) {
                const payload = {
                    success: true,
                    platform,
                    evidence,
                    feedback_used: feedback || 'fallback:no_openai',
                    qa_gate: { passed: true, errors: [], stats: { fallback: true } },
                    optimizer_plan: normalizedFallbackPlan,
                    raw: { optimizer_plan: normalizedFallbackPlan, fallback: true }
                };
                setBrainCache(cacheKey, payload);
                return res.json(payload);
            }

            const openai = new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 240000 });
            const system = [
                'You are an expert performance marketer and audience strategist.',
                'You are optimizing audiences, not creatives broadly and not account budgets broadly.',
                'Return JSON only.',
                'Be concrete. Every recommendation must name an audience shape, reason, action, risk, and success metric.',
                'Use only the provided evidence.',
                platform === 'google'
                    ? 'Google decisions must stay campaign-budget-level; do not recommend adgroup budgets.'
                    : 'Meta decisions may act at the adset level.',
                'Prefer optimizer-level output: what worked, what is weak, what to test next, what to do now, what to leave alone.'
            ].join('\n');

            const prompt = buildAudienceBrainPrompt(platform, userRequest, evidence, feedback);
            const first = await openai.chat.completions.create({
                model: 'gpt-4.1',
                max_completion_tokens: 7000,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: prompt }
                ]
            });
            let parsed = safeJsonParse(first.choices[0].message.content, {}) || {};
            let quality = analyzeAudienceDraftQuality(parsed);
            let feedbackUsed = feedback || '';

            if (!quality.passed) {
                const fixPrompt = buildAudienceBrainPrompt(platform, userRequest, evidence, [
                    'Previous answer was too generic.',
                    ...quality.errors,
                    'Make the next answer more specific to audiences.',
                    'Use distinct actions per audience group.',
                    'Include direct do-lines and do-not-touch guidance.'
                ].filter(Boolean).join(' '));
                const repair = await openai.chat.completions.create({
                    model: 'gpt-4.1',
                    max_completion_tokens: 7000,
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: system },
                        { role: 'user', content: fixPrompt }
                    ]
                });
                parsed = safeJsonParse(repair.choices[0].message.content, parsed) || parsed;
                quality = analyzeAudienceDraftQuality(parsed);
                feedbackUsed = 'auto-feedback:' + quality.errors.join(' | ');
            }

            if (!quality.passed) {
                parsed = { optimizer_plan: normalizedFallbackPlan };
                quality = { passed: true, errors: [], stats: { fallback: true } };
                feedbackUsed = (feedbackUsed ? feedbackUsed + ' | ' : '') + 'fallback:deterministic_plan';
            }

            const normalizedPlan = normalizeAudiencePlan(parsed.optimizer_plan || parsed, summary, evidence);
            if ((summary.spend_concentration || 0) >= 0.9 && summary.dominant_audience) {
                const concentrationTests = buildConcentrationTestIdeas(platform, summary);
                normalizedPlan.new_tests_to_try = normalizeAudienceItems(concentrationTests.concat(normalizedPlan.new_tests_to_try || []), summary, evidence);
                normalizedPlan.roadmap = normalizedPlan.roadmap || {};
                normalizedPlan.roadmap.next_test_cycle = Array.isArray(normalizedPlan.roadmap.next_test_cycle) ? normalizedPlan.roadmap.next_test_cycle : [];
                const dominantLabel = summary.dominant_audience.exact_bucket_label || summary.dominant_audience.audience || '--';
                if (!normalizedPlan.roadmap.next_test_cycle.length) {
                    normalizedPlan.roadmap.next_test_cycle = [
                        `Split the dominant bucket ${dominantLabel} into adjacent tests`,
                        'Keep one variable different per test so you can isolate audience quality'
                    ];
                } else if (!normalizedPlan.roadmap.next_test_cycle.some(x => String(x).includes(dominantLabel))) {
                    normalizedPlan.roadmap.next_test_cycle.unshift(`Split the dominant bucket ${dominantLabel} into adjacent tests`);
                }
                normalizedPlan.morning_brief = normalizedPlan.morning_brief || {};
                normalizedPlan.morning_brief.what_to_do_right_now = Array.isArray(normalizedPlan.morning_brief.what_to_do_right_now) ? normalizedPlan.morning_brief.what_to_do_right_now : [];
                if (!normalizedPlan.morning_brief.what_to_do_right_now.some(x => /split|adjacent|dominant/i.test(String(x)))) {
                    normalizedPlan.morning_brief.what_to_do_right_now.unshift(`Do not recycle ${dominantLabel}; test adjacent audience slices instead`);
                }
            }

            const payload = {
                success: true,
                platform,
                evidence,
                feedback_used: feedbackUsed,
                qa_gate: quality,
                optimizer_plan: normalizedPlan,
                raw: parsed
            };
            setBrainCache(cacheKey, payload);
            return res.json(payload);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== RECOMMENDATIONS ====================

    // POST /recommendations/generate — Generate all recommendations
    router.post('/recommendations/generate', async (req, res) => {
        try {
            const platform = String((req.body && req.body.platform) || req.query.platform || 'all').toLowerCase();
            const result = platform === 'meta' || platform === 'google'
                ? await recommendationEngine.generatePlatformRecommendations(platform)
                : await recommendationEngine.generateAll();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /recommendations/tests — Get test recommendations
    router.get('/recommendations/tests', (req, res) => {
        try {
            const d = db();
            const conditions = ["rec_type = 'test'"];
            const params = [];

            if (req.query.platform) {
                conditions.push('platform = ?');
                params.push(req.query.platform.toLowerCase());
            }
            if (req.query.vertical) {
                conditions.push('vertical = ?');
                params.push(req.query.vertical);
            }
            if (req.query.priority) {
                conditions.push('priority = ?');
                params.push(req.query.priority.toLowerCase());
            }

            const sql = `
                SELECT * FROM at_recommendations
                WHERE ${conditions.join(' AND ')} AND status = 'pending'
                ORDER BY
                    CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
                    generated_at DESC
            `;
            const rows = d.prepare(sql).all(...params);
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /recommendations/optimizations — Get optimization recommendations
    router.get('/recommendations/optimizations', (req, res) => {
        try {
            const d = db();
            const conditions = ["rec_type = 'optimization'"];
            const params = [];

            if (req.query.platform) {
                conditions.push('platform = ?');
                params.push(req.query.platform.toLowerCase());
            }
            if (req.query.urgency) {
                conditions.push('urgency = ?');
                params.push(req.query.urgency.toLowerCase());
            }

            const sql = `
                SELECT * FROM at_recommendations
                WHERE ${conditions.join(' AND ')} AND status = 'pending'
                ORDER BY
                    CASE urgency WHEN 'immediate' THEN 1 WHEN 'this_week' THEN 2 WHEN 'this_month' THEN 3 ELSE 4 END,
                    generated_at DESC
            `;
            const rows = d.prepare(sql).all(...params);
            res.json({ success: true, data: rows, total: rows.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /recommendations/:id/mark-implemented — Mark recommendation as implemented
    router.post('/recommendations/:id/mark-implemented', (req, res) => {
        try {
            const d = db();
            const id = parseInt(req.params.id);
            const result = d.prepare(`
                UPDATE at_recommendations SET status = 'implemented', implemented_at = datetime('now')
                WHERE id = ?
            `).run(id);

            if (result.changes === 0) {
                return res.status(404).json({ success: false, error: 'Recommendation not found' });
            }
            res.json({ success: true, data: { id, status: 'implemented' } });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /recommendations/:id/dismiss — Dismiss a recommendation
    router.post('/recommendations/:id/dismiss', (req, res) => {
        try {
            const d = db();
            const id = parseInt(req.params.id);
            const reason = (req.body && req.body.reason) || 'No reason given';
            const result = d.prepare(`
                UPDATE at_recommendations SET status = 'dismissed', dismissed_reason = ?
                WHERE id = ?
            `).run(reason, id);

            if (result.changes === 0) {
                return res.status(404).json({ success: false, error: 'Recommendation not found' });
            }
            res.json({ success: true, data: { id, status: 'dismissed', reason } });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== TEST DESIGNER ====================

    // GET /tests/:id/spec — Generate test spec for a recommendation
    router.get('/tests/:id/spec', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const spec = await testDesigner.generateSpec(id);
            res.json({ success: true, data: spec });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /tests/all-specs — Get all test specs
    router.get('/tests/all-specs', async (req, res) => {
        try {
            const platform = req.query.platform || null;
            const specs = await testDesigner.getAllSpecs(platform);
            res.json({ success: true, data: specs });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== OPTIMIZER (LIVE FLAGS) ====================

    // GET /live/flags — Get live flags with optional filters
    router.get('/live/flags', (req, res) => {
        try {
            const flags = optimizer.getFlags(req.query);
            res.json({ success: true, data: flags, total: flags.length });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /live/health — Run health check and return flags with summary
    router.get('/live/health', async (req, res) => {
        try {
            const result = await optimizer.refreshFlags();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /live/refresh — Run health check and return flags with summary
    router.post('/live/refresh', async (req, res) => {
        try {
            const result = await optimizer.refreshFlags();
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ==================== SCHEDULER ====================

    // GET /scheduler/status — Get scheduler status
    router.get('/scheduler/status', (req, res) => {
        try {
            const status = scheduler.getSchedulerStatus();
            res.json({ success: true, data: status });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /scheduler/:job/trigger — Trigger a specific scheduler job
    router.post('/scheduler/:job/trigger', (req, res) => {
        try {
            const jobName = req.params.job;
            const result = scheduler.triggerJob(jobName);
            if (!result.success) {
                return res.status(400).json(result);
            }
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
