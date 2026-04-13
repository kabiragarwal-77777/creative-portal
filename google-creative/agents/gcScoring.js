/**
 * gcScoring.js - Google Creative Performance Score (G-CPS)
 * Computes performance scores adapted per Google ad type (RSA, Video, PMax/Display).
 */

const { getGcDb } = require('../db/gc-db');
const { cachedAsync } = require('../../utils/ai-cache');

const ASSET_LABEL_SCORES = {
    'BEST': 1.0,
    'GOOD': 0.65,
    'LEARNING': 0.4,
    'LOW': 0.1
};
const ASSET_LABEL_DEFAULT = 0.3;

function assetLabelScore(label) {
    if (!label) return ASSET_LABEL_DEFAULT;
    const upper = String(label).toUpperCase().trim();
    return ASSET_LABEL_SCORES[upper] !== undefined ? ASSET_LABEL_SCORES[upper] : ASSET_LABEL_DEFAULT;
}

function minMaxNormalize(value, min, max) {
    if (max === min) return 0.5;
    if (value == null) return 0;
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function computeGCPS(adType, scores) {
    const type = String(adType || '').toUpperCase();

    if (type === 'RSA' || type === 'RESPONSIVE_SEARCH_AD') {
        return (scores.asset_label_score * 0.35) +
               (scores.roas_normalized * 0.30) +
               (scores.ctr_normalized * 0.20) +
               (scores.cpa_efficiency * 0.15);
    }

    if (type === 'VIDEO' || type === 'VIDEO_AD') {
        return (scores.roas_normalized * 0.35) +
               (scores.asset_label_score * 0.25) +
               ((scores.view_rate_normalized || 0) * 0.20) +
               (scores.ctr_normalized * 0.20);
    }

    // PMax / Display / anything else
    return (scores.roas_normalized * 0.40) +
           (scores.asset_label_score * 0.35) +
           (scores.ctr_normalized * 0.25);
}

module.exports = function(config) {
    const openaiKey = (config && config.openaiKey) || process.env.OPENAI_API_KEY;

    /**
     * Build normalization ranges (min/max) per ad_type for ROAS, CTR, CPA.
     */
    function computeNormRanges(creatives) {
        const groups = {};
        for (const c of creatives) {
            const t = String(c.ad_type || 'OTHER').toUpperCase();
            if (!groups[t]) groups[t] = { roas: [], ctr: [], cpa: [] };
            if (c.adset_roas != null) groups[t].roas.push(Number(c.adset_roas));
            if (c.adset_ctr != null) groups[t].ctr.push(Number(c.adset_ctr));
            if (c.adset_spend != null && c.adset_conversions != null && Number(c.adset_conversions) > 0) {
                groups[t].cpa.push(Number(c.adset_spend) / Number(c.adset_conversions));
            }
        }
        const ranges = {};
        for (const [type, data] of Object.entries(groups)) {
            ranges[type] = {
                roas_min: data.roas.length ? Math.min(...data.roas) : 0,
                roas_max: data.roas.length ? Math.max(...data.roas) : 0,
                ctr_min: data.ctr.length ? Math.min(...data.ctr) : 0,
                ctr_max: data.ctr.length ? Math.max(...data.ctr) : 0,
                cpa_min: data.cpa.length ? Math.min(...data.cpa) : 0,
                cpa_max: data.cpa.length ? Math.max(...data.cpa) : 0,
            };
        }
        return ranges;
    }

    /**
     * Score a single creative given its row, signals, and normalization ranges for its type.
     */
    async function scoreCreative(creative, signals, normRanges) {
        const adType = String(creative.ad_type || 'OTHER').toUpperCase();
        const range = normRanges[adType] || { roas_min: 0, roas_max: 0, ctr_min: 0, ctr_max: 0, cpa_min: 0, cpa_max: 0 };

        const als = assetLabelScore(creative.asset_performance_label);
        const roasNorm = minMaxNormalize(Number(creative.adset_roas) || 0, range.roas_min, range.roas_max);
        const ctrNorm = minMaxNormalize(Number(creative.adset_ctr) || 0, range.ctr_min, range.ctr_max);

        // CPA: lower is better, so invert
        let cpa = null;
        if (creative.adset_spend != null && creative.adset_conversions != null && Number(creative.adset_conversions) > 0) {
            cpa = Number(creative.adset_spend) / Number(creative.adset_conversions);
        }
        const cpaNorm = cpa != null ? minMaxNormalize(cpa, range.cpa_min, range.cpa_max) : 0.5;
        const cpaEfficiency = 1 - cpaNorm;

        // View rate for video ads (parsed from signals if available)
        let viewRateNorm = 0;
        if (signals && signals.view_rate != null) {
            viewRateNorm = Math.max(0, Math.min(1, Number(signals.view_rate) || 0));
        }

        const components = {
            asset_label_score: als,
            roas_normalized: roasNorm,
            ctr_normalized: ctrNorm,
            cpa_efficiency: cpaEfficiency,
            view_rate_normalized: viewRateNorm
        };

        const gcps = computeGCPS(adType, components);

        return {
            creative_id: creative.id || creative.creative_id,
            ad_id: creative.ad_id,
            ad_type: creative.ad_type,
            gcps_score: Math.round(gcps * 1000) / 1000,
            asset_label_score: als,
            roas_normalized: Math.round(roasNorm * 1000) / 1000,
            ctr_normalized: Math.round(ctrNorm * 1000) / 1000,
            cpa_efficiency: Math.round(cpaEfficiency * 1000) / 1000,
            score_breakdown: components,
            signals
        };
    }

    /**
     * Run correlation analysis via OpenAI: top 20 vs bottom 20 by G-CPS.
     */
    async function runCorrelationAnalysis(scoredCreatives) {
        if (!openaiKey || scoredCreatives.length < 10) return null;

        const sorted = [...scoredCreatives].sort((a, b) => b.gcps_score - a.gcps_score);
        const top20 = sorted.slice(0, 20).map(s => ({
            ad_id: s.ad_id,
            ad_type: s.ad_type,
            gcps_score: s.gcps_score,
            breakdown: s.score_breakdown,
            signals: s.signals
        }));
        const bottom20 = sorted.slice(-20).map(s => ({
            ad_id: s.ad_id,
            ad_type: s.ad_type,
            gcps_score: s.gcps_score,
            breakdown: s.score_breakdown,
            signals: s.signals
        }));

        try {
            const content = await cachedAsync(
                ['gcScoring.runCorrelationAnalysis', top20, bottom20],
                async () => {
                    const response = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${openaiKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'gpt-5.4-mini',
                            messages: [
                                {
                                    role: 'system',
                                    content: 'You are a Google Ads performance analyst. Analyze correlations between creative signals and performance scores.'
                                },
                                {
                                    role: 'user',
                                    content: `Top 20 by G-CPS: ${JSON.stringify(top20)}\nBottom 20 by G-CPS: ${JSON.stringify(bottom20)}\nFind patterns. Return JSON: { "winning_patterns": [...], "losing_patterns": [...], "key_correlations": [...] }`
                                }
                            ],
                            temperature: 0.3,
                            max_completion_tokens: 2000
                        })
                    });

                    const data = await response.json();
                    return data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                }
            );
            if (!content) return null;

            // Extract JSON from response (handle markdown fences)
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            return null;
        } catch (err) {
            console.error('[gcScoring] Correlation analysis error:', err.message);
            return null;
        }
    }

    /**
     * Score all creatives: normalize, score, store, correlate.
     */
    async function scoreAll() {
        const db = getGcDb();

        // 1. Get all creatives with their signals
        const creatives = db.prepare(`
            SELECT c.*, cs.signals_json
            FROM gc_creatives c
            LEFT JOIN gc_creative_signals cs ON cs.creative_id = c.id
        `).all();

        if (!creatives || creatives.length === 0) {
            console.log('[gcScoring] No creatives found, skipping scoring.');
            return { scored: 0, correlation: null };
        }

        // 2. Compute normalization ranges per ad_type
        const normRanges = computeNormRanges(creatives);

        // 3. Score each creative
        const scored = [];
        for (const c of creatives) {
            let signals = null;
            if (c.signals_json) {
                try { signals = JSON.parse(c.signals_json); } catch (_) { signals = null; }
            }
            const result = await scoreCreative(c, signals, normRanges);
            scored.push(result);
        }

        // 4. Upsert into gc_creative_scores
        const upsert = db.prepare(`
            INSERT INTO gc_creative_scores
                (creative_id, ad_id, ad_type, gcps_score, asset_label_score, roas_normalized, ctr_normalized, cpa_efficiency, score_breakdown_json, correlation_report_json)
            VALUES
                (@creative_id, @ad_id, @ad_type, @gcps_score, @asset_label_score, @roas_normalized, @ctr_normalized, @cpa_efficiency, @score_breakdown_json, @correlation_report_json)
            ON CONFLICT(creative_id) DO UPDATE SET
                ad_id = excluded.ad_id,
                ad_type = excluded.ad_type,
                gcps_score = excluded.gcps_score,
                asset_label_score = excluded.asset_label_score,
                roas_normalized = excluded.roas_normalized,
                ctr_normalized = excluded.ctr_normalized,
                cpa_efficiency = excluded.cpa_efficiency,
                score_breakdown_json = excluded.score_breakdown_json,
                correlation_report_json = excluded.correlation_report_json
        `);

        // 5. Run correlation analysis
        const correlationReport = await runCorrelationAnalysis(scored);
        const correlationJson = correlationReport ? JSON.stringify(correlationReport) : null;

        const upsertMany = db.transaction((items) => {
            for (const s of items) {
                upsert.run({
                    creative_id: s.creative_id,
                    ad_id: s.ad_id,
                    ad_type: s.ad_type,
                    gcps_score: s.gcps_score,
                    asset_label_score: s.asset_label_score,
                    roas_normalized: s.roas_normalized,
                    ctr_normalized: s.ctr_normalized,
                    cpa_efficiency: s.cpa_efficiency,
                    score_breakdown_json: JSON.stringify(s.score_breakdown),
                    correlation_report_json: correlationJson
                });
            }
        });
        upsertMany(scored);

        console.log(`[gcScoring] Scored ${scored.length} creatives. Correlation: ${correlationReport ? 'generated' : 'skipped'}`);
        return { scored: scored.length, correlation: correlationReport };
    }

    /**
     * Return latest correlation report + score distribution stats.
     */
    async function getLearningReport() {
        const db = getGcDb();

        // Get latest correlation report
        const latestCorrelation = db.prepare(`
            SELECT correlation_report_json
            FROM gc_creative_scores
            WHERE correlation_report_json IS NOT NULL
            ORDER BY rowid DESC
            LIMIT 1
        `).get();

        let correlationReport = null;
        if (latestCorrelation && latestCorrelation.correlation_report_json) {
            try { correlationReport = JSON.parse(latestCorrelation.correlation_report_json); } catch (_) {}
        }

        // Score distribution stats per ad_type
        const stats = db.prepare(`
            SELECT
                ad_type,
                COUNT(*) as count,
                ROUND(AVG(gcps_score), 3) as avg_score,
                ROUND(MIN(gcps_score), 3) as min_score,
                ROUND(MAX(gcps_score), 3) as max_score,
                ROUND(AVG(asset_label_score), 3) as avg_asset_label,
                ROUND(AVG(roas_normalized), 3) as avg_roas,
                ROUND(AVG(ctr_normalized), 3) as avg_ctr,
                ROUND(AVG(cpa_efficiency), 3) as avg_cpa_eff
            FROM gc_creative_scores
            GROUP BY ad_type
        `).all();

        // Overall distribution buckets
        const buckets = db.prepare(`
            SELECT
                CASE
                    WHEN gcps_score >= 0.8 THEN 'elite'
                    WHEN gcps_score >= 0.6 THEN 'strong'
                    WHEN gcps_score >= 0.4 THEN 'average'
                    WHEN gcps_score >= 0.2 THEN 'weak'
                    ELSE 'poor'
                END as tier,
                COUNT(*) as count
            FROM gc_creative_scores
            GROUP BY tier
            ORDER BY MIN(gcps_score) DESC
        `).all();

        return {
            correlation: correlationReport,
            stats_by_type: stats || [],
            distribution: buckets || [],
            generated_at: new Date().toISOString()
        };
    }

    return { scoreCreative, scoreAll, getLearningReport };
};
