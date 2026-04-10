const db = require('./db');
const path = require('path');

module.exports = function (config) {
    const OPENAI_API_KEY = config.openaiApiKey || '';

    // =========================================================================
    // Helpers
    // =========================================================================

    function percentile(arr, p) {
        if (!arr.length) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const idx = (p / 100) * (sorted.length - 1);
        const lower = Math.floor(idx);
        const upper = Math.ceil(idx);
        if (lower === upper) return sorted[lower];
        return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
    }

    function median(arr) {
        return percentile(arr, 50);
    }

    /**
     * Extract concept keyword from ad name.
     * e.g. "FB_MOF_Video_HindZinc_V0_221225" => "HindZinc"
     */
    function extractConcept(adName) {
        if (!adName) return null;
        const match = adName.match(/(?:Video|Static|Image|Carousel)_([A-Za-z0-9]+)/i);
        return match ? match[1] : null;
    }

    /**
     * Normalize campaign name to a pattern by stripping dates, IDs, and version numbers.
     * e.g. "FB_MOF_Video_250314" => "FB_MOF_Video"
     */
    function normalizeCampaign(campaignName) {
        if (!campaignName) return 'UNKNOWN';
        return campaignName
            .replace(/[_-]\d{6,}$/g, '')     // trailing date codes
            .replace(/[_-]V\d+/gi, '')         // version numbers
            .replace(/[_-]\d+$/g, '')          // trailing numeric IDs
            .replace(/\s+/g, '_')
            .trim() || 'UNKNOWN';
    }

    // =========================================================================
    // AI-powered similarity prediction (replaces simple multipliers)
    // =========================================================================

    function cosineSimilarity(a, b) {
        if (!a.length || !b.length) return 0;
        const len = Math.min(a.length, b.length);
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < len; i++) {
            dot += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        magA = Math.sqrt(magA);
        magB = Math.sqrt(magB);
        if (magA === 0 || magB === 0) return 0;
        return dot / (magA * magB);
    }

    /**
     * Extract structured signals from a Meta ad snapshot for similarity matching.
     * Uses: creative type, funnel stage, concept, early performance metrics.
     */
    function extractMetaSignals(adSnapshot, cohort) {
        const creativeType = (adSnapshot.creative_type || 'UNKNOWN').toUpperCase();
        const campaignName = (adSnapshot.campaign_name || '').toUpperCase();
        const concept = extractConcept(adSnapshot.ad_name);

        // Creative type code
        const typeMap = { VIDEO: 0, STATIC: 1, CAROUSEL: 2, IMAGE: 3, UNKNOWN: 4 };
        const typeCode = typeMap[creativeType] != null ? typeMap[creativeType] : 4;

        // Funnel stage from campaign name
        let funnelCode = 1; // default MOF
        if (/TOF|AWARENESS|PROSPECTING|BROAD/i.test(campaignName)) funnelCode = 0;
        else if (/BOF|RETARGET|REMARKET|CONVERSION/i.test(campaignName)) funnelCode = 2;

        // Normalize performance metrics against cohort benchmarks (ratio to median)
        const hookRatio = (adSnapshot.hook_rate != null && cohort && cohort.benchmark_hook_rate > 0)
            ? adSnapshot.hook_rate / cohort.benchmark_hook_rate : 1;
        const holdRatio = (adSnapshot.hold_rate != null && cohort && cohort.benchmark_hold_rate > 0)
            ? adSnapshot.hold_rate / cohort.benchmark_hold_rate : 1;
        const cpiRatio = (adSnapshot.cpi != null && adSnapshot.cpi > 0 && cohort && cohort.benchmark_cpi > 0)
            ? cohort.benchmark_cpi / adSnapshot.cpi : 1; // inverted — lower CPI is better
        const ctrRatio = (adSnapshot.ctr != null && cohort && cohort.benchmark_ctr > 0)
            ? adSnapshot.ctr / cohort.benchmark_ctr : 1;

        // Signup efficiency (signups per 1000 spend)
        const signupRate = (adSnapshot.signups > 0 && adSnapshot.spend > 0)
            ? (adSnapshot.signups / adSnapshot.spend) * 1000 : 0;

        return {
            creative_type: creativeType,
            type_code: typeCode,
            funnel_code: funnelCode,
            concept: concept,
            hook_ratio: Math.min(hookRatio, 3), // cap at 3x
            hold_ratio: Math.min(holdRatio, 3),
            cpi_ratio: Math.min(cpiRatio, 3),
            ctr_ratio: Math.min(ctrRatio, 3),
            signup_rate: Math.min(signupRate, 50),
            days_live: adSnapshot.days_live || 0,
            spend: adSnapshot.spend || 0,
        };
    }

    /**
     * Convert Meta signals to a fixed-length numeric vector for cosine similarity.
     */
    function metaSignalsToVector(signals) {
        return [
            signals.type_code,
            signals.funnel_code,
            signals.hook_ratio,
            signals.hold_ratio,
            signals.cpi_ratio,
            signals.ctr_ratio,
            signals.signup_rate / 10, // normalize to ~0-5 range
        ];
    }

    /**
     * Find top-N similar historical ads by cosine similarity of signal vectors.
     * Only considers mature ads (days_live >= 14) with valid ROAS.
     */
    function findSimilarHistoricalAds(newSignals, cohort, topN) {
        topN = topN || 10;
        const d = db.getCiDb();

        // Get mature ads with valid ROAS
        const rows = d.prepare(`
            SELECT s.* FROM snapshots s
            INNER JOIN (
                SELECT ad_id, MAX(snapshot_date) as max_date
                FROM snapshots
                WHERE days_live >= 14 AND d6_roas > 0 AND d6_roas <= 5000
                GROUP BY ad_id
            ) latest ON s.ad_id = latest.ad_id AND s.snapshot_date = latest.max_date
            ORDER BY s.spend DESC
        `).all();

        if (!rows.length) return [];

        const newVec = metaSignalsToVector(newSignals);

        const scored = rows.map(row => {
            // Extract signals for historical ad (use its own metrics as ratios to cohort)
            const histSignals = {
                type_code: row.creative_type === 'Video' ? 0 : row.creative_type === 'Static' ? 1 : 4,
                funnel_code: /TOF|AWARENESS/i.test(row.campaign_name || '') ? 0 : /BOF|RETARGET/i.test(row.campaign_name || '') ? 2 : 1,
                hook_ratio: (row.hook_rate != null && cohort && cohort.benchmark_hook_rate > 0) ? row.hook_rate / cohort.benchmark_hook_rate : 1,
                hold_ratio: (row.hold_rate != null && cohort && cohort.benchmark_hold_rate > 0) ? row.hold_rate / cohort.benchmark_hold_rate : 1,
                cpi_ratio: (row.cpi > 0 && cohort && cohort.benchmark_cpi > 0) ? cohort.benchmark_cpi / row.cpi : 1,
                ctr_ratio: (row.ctr > 0 && cohort && cohort.benchmark_ctr > 0) ? row.ctr / cohort.benchmark_ctr : 1,
                signup_rate: (row.signups > 0 && row.spend > 0) ? (row.signups / row.spend) * 1000 : 0,
            };
            const histVec = metaSignalsToVector(histSignals);
            const similarity = cosineSimilarity(newVec, histVec);

            // Concept match bonus: if same concept keyword, boost similarity
            const newConcept = newSignals.concept;
            const histConcept = extractConcept(row.ad_name);
            const conceptBonus = (newConcept && histConcept && newConcept.toLowerCase() === histConcept.toLowerCase()) ? 0.15 : 0;

            return {
                ad_id: row.ad_id,
                ad_name: row.ad_name,
                campaign_name: row.campaign_name,
                creative_type: row.creative_type,
                days_live: row.days_live,
                spend: row.spend,
                cpi: row.cpi,
                ctr: row.ctr,
                hook_rate: row.hook_rate,
                hold_rate: row.hold_rate,
                d6_roas: row.d6_roas,
                d15_roas: row.d15_roas,
                d30_roas: row.d30_roas,
                d60_roas: row.d60_roas,
                overall_roas: row.overall_roas,
                similarity: Math.min(similarity + conceptBonus, 1),
                concept_match: conceptBonus > 0,
            };
        });

        scored.sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, topN);
    }

    /**
     * Fetch market signals from the Google Creative DB (gc_market_signals table).
     * Falls back to neutral values if unavailable.
     */
    function getMarketSignals() {
        try {
            let Database;
            try { Database = require('better-sqlite3'); }
            catch (e) { Database = require('../inventory-scanner/node_modules/better-sqlite3'); }

            const gcDbPath = path.join(__dirname, '..', 'google-creative', 'google-creative.db');
            const gcDb = new Database(gcDbPath, { readonly: true, fileMustExist: true });
            const row = gcDb.prepare('SELECT * FROM gc_market_signals ORDER BY date DESC LIMIT 1').get();
            gcDb.close();

            if (!row) return { sentiment: 'neutral', nifty_50: null, vix: null, dxy: null };
            return {
                sentiment: row.market_sentiment || 'neutral',
                nifty_50: row.nifty_50,
                vix: row.vix,
                dxy: row.dxy,
                roas_correlation: row.google_roas_correlation,
            };
        } catch (e) {
            // DB not available — return neutral defaults
            return { sentiment: 'neutral', nifty_50: null, vix: null, dxy: null };
        }
    }

    /**
     * Call OpenAI to predict ROAS using similar historical ads + market conditions.
     * Returns { predictions, qualitative, raw }.
     */
    async function predictWithAI(adSnapshot, signals, similarAds, marketSignals, cohort) {
        if (!OPENAI_API_KEY) return null;

        const similarForPrompt = similarAds.map(c => ({
            ad_name: c.ad_name,
            creative_type: c.creative_type,
            days_live: c.days_live,
            spend: Math.round(c.spend),
            cpi: c.cpi ? Math.round(c.cpi * 100) / 100 : null,
            ctr: c.ctr ? Math.round(c.ctr * 100) / 100 : null,
            d6_roas: c.d6_roas ? Math.round(c.d6_roas * 100) / 100 : null,
            d15_roas: c.d15_roas ? Math.round(c.d15_roas * 100) / 100 : null,
            d30_roas: c.d30_roas ? Math.round(c.d30_roas * 100) / 100 : null,
            d60_roas: c.d60_roas ? Math.round(c.d60_roas * 100) / 100 : null,
            overall_roas: c.overall_roas ? Math.round(c.overall_roas * 100) / 100 : null,
            similarity: Math.round(c.similarity * 1000) / 1000,
            concept_match: c.concept_match,
        }));

        const prompt = `You are a Meta Ads performance analyst for Univest (Indian fintech app — stock trading, mutual funds).
You predict ROAS (Return on Ad Spend) trajectories for new Meta ad creatives based on historical similar ads and market conditions.

ROAS is calculated as (revenue / spend) * 100, so 15% means ₹15 revenue per ₹100 spent.

## New Ad Being Predicted
- Ad Name: ${adSnapshot.ad_name}
- Campaign: ${adSnapshot.campaign_name}
- Creative Type: ${adSnapshot.creative_type}
- Days Live: ${adSnapshot.days_live || 0}
- Spend so far: ₹${Math.round(adSnapshot.spend || 0)}
- CPI: ${adSnapshot.cpi ? '₹' + Math.round(adSnapshot.cpi * 100) / 100 : 'N/A'}
- CTR: ${adSnapshot.ctr ? adSnapshot.ctr.toFixed(2) + '%' : 'N/A'}
- Hook Rate: ${adSnapshot.hook_rate || 'N/A'}
- Hold Rate: ${adSnapshot.hold_rate || 'N/A'}
- Installs: ${adSnapshot.installs || 0}, Signups: ${adSnapshot.signups || 0}
- Early D6 ROAS: ${adSnapshot.d6_roas ? adSnapshot.d6_roas.toFixed(2) + '%' : 'N/A'}

## ${similarAds.length} Most Similar Historical Ads (by creative content, type, funnel stage, performance)
${JSON.stringify(similarForPrompt, null, 1)}

## Cohort Benchmarks (${cohort ? cohort.cohort_key + ', n=' + cohort.sample_size : 'none'})
${cohort ? `- Median D6 ROAS: ${cohort.median_d6_roas}%, Overall: ${cohort.median_overall_roas}%
- P25 D6: ${cohort.p25_d6_roas}%, P75 D6: ${cohort.p75_d6_roas}%
- Benchmark CPI: ₹${cohort.benchmark_cpi}, CTR: ${cohort.benchmark_ctr}%
- D6-to-Overall multiplier: ${cohort.d6_to_overall_multiplier}x` : 'No cohort data available'}

## Market Conditions
- Sentiment: ${marketSignals.sentiment}
${marketSignals.nifty_50 ? '- Nifty 50: ' + marketSignals.nifty_50 : ''}
${marketSignals.vix ? '- India VIX: ' + marketSignals.vix + (marketSignals.vix > 20 ? ' (elevated — users more cautious with investments)' : ' (low — favorable for fintech)') : ''}
${marketSignals.dxy ? '- DXY: ' + marketSignals.dxy : ''}

## Instructions
1. Weight similar ads by their similarity score — closer matches matter more
2. Concept-matched ads (same creative concept) are especially predictive
3. Consider the ROAS growth curve pattern: D6 → D15 → D30 → D60 → D180
4. Factor in market conditions: high VIX = users less likely to invest = lower ROAS
5. For Univest, revenue comes from subscription renewals, so ROAS typically grows over time as users renew
6. D6 ROAS is typically 5-15% for good ads, with overall reaching 15-30% for top performers

Return ONLY valid JSON:
{
  "day_6": {"roas": X, "low": X, "high": X},
  "day_15": {"roas": X, "low": X, "high": X},
  "day_30": {"roas": X, "low": X, "high": X},
  "day_60": {"roas": X, "low": X, "high": X},
  "day_180": {"roas": X, "low": X, "high": X},
  "trajectory": "promising|average|concerning",
  "reasoning": "2-3 sentence explanation",
  "risk_factors": ["risk1", "risk2"],
  "recommended_action": "SCALE|WATCH|PAUSE"
}`;

        try {
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                    model: 'gpt-5.4-mini',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.3,
                    response_format: { type: 'json_object' },
                }),
            });

            if (!resp.ok) {
                console.error('[predictor] AI prediction API error:', resp.status);
                return null;
            }

            const data = await resp.json();
            const content = data.choices?.[0]?.message?.content;
            if (!content) return null;

            const parsed = JSON.parse(content);
            return { predictions: parsed, raw: content };
        } catch (err) {
            console.error('[predictor] AI prediction failed:', err.message);
            return null;
        }
    }

    /**
     * Compute weighted-average predictions from similar ads when AI is unavailable.
     * Better than flat multipliers — uses actual ROAS curves of similar ads.
     */
    function computeSimilarityFallback(similarAds, adSnapshot) {
        if (!similarAds.length) return null;

        // Weight by similarity score
        let totalWeight = 0;
        let wD6 = 0, wD15 = 0, wD30 = 0, wD60 = 0, wOverall = 0;

        for (const ad of similarAds) {
            const w = ad.similarity * ad.similarity; // square to emphasize closer matches
            if (ad.d6_roas > 0 && ad.d6_roas <= 5000) { wD6 += ad.d6_roas * w; }
            if (ad.d15_roas > 0 && ad.d15_roas <= 5000) { wD15 += ad.d15_roas * w; }
            if (ad.d30_roas > 0 && ad.d30_roas <= 5000) { wD30 += ad.d30_roas * w; }
            if (ad.d60_roas > 0 && ad.d60_roas <= 5000) { wD60 += ad.d60_roas * w; }
            if (ad.overall_roas > 0 && ad.overall_roas <= 5000) { wOverall += ad.overall_roas * w; }
            totalWeight += w;
        }

        if (totalWeight === 0) return null;

        const avgD6 = wD6 / totalWeight;
        const avgD15 = wD15 / totalWeight || avgD6 * 1.1;
        const avgD30 = wD30 / totalWeight || avgD6 * 1.3;
        const avgD60 = wD60 / totalWeight || avgD6 * 1.5;
        const avgD180 = wOverall / totalWeight || avgD6 * 1.8;

        // If we have actual D6 ROAS, scale predictions relative to it
        if (adSnapshot.d6_roas > 0 && avgD6 > 0) {
            const scale = adSnapshot.d6_roas / avgD6;
            return {
                d6: adSnapshot.d6_roas,
                d15: avgD15 * scale,
                d30: avgD30 * scale,
                d60: avgD60 * scale,
                d180: avgD180 * scale,
            };
        }

        return { d6: avgD6, d15: avgD15, d30: avgD30, d60: avgD60, d180: avgD180 };
    }

    // =========================================================================
    // buildCohortBenchmarks
    // =========================================================================

    function buildCohortBenchmarks() {
        const d = db.getCiDb();

        // 1. Query ads with enough data (days_live >= 3, or use all if too few)
        let rows = d.prepare(`
            SELECT * FROM snapshots
            WHERE days_live >= 14
            ORDER BY ad_id, snapshot_date DESC
        `).all();
        // Fallback: if too few mature ads, lower threshold progressively
        if (rows.length < 5) {
            rows = d.prepare(`SELECT * FROM snapshots WHERE days_live >= 3 ORDER BY ad_id, snapshot_date DESC`).all();
        }
        if (rows.length < 3) {
            rows = d.prepare(`SELECT * FROM snapshots ORDER BY ad_id, snapshot_date DESC`).all();
        }

        // Deduplicate: keep only the latest snapshot per ad_id
        const latestByAd = {};
        for (const row of rows) {
            if (!latestByAd[row.ad_id]) {
                latestByAd[row.ad_id] = row;
            }
        }
        const ads = Object.values(latestByAd);

        if (!ads.length) return { cohortsBuilt: 0 };

        // 2. Parse features and group into cohorts
        const cohortMap = {};  // cohort_key => [ads]

        for (const ad of ads) {
            const creativeType = (ad.creative_type || 'UNKNOWN').toUpperCase();
            const campaignPattern = normalizeCampaign(ad.campaign_name);
            const cohortKey = `${creativeType}::${campaignPattern}`;

            if (!cohortMap[cohortKey]) cohortMap[cohortKey] = [];
            cohortMap[cohortKey].push(ad);

            // Also add to creative-type-only group
            const typeKey = `${creativeType}::ALL`;
            if (!cohortMap[typeKey]) cohortMap[typeKey] = [];
            cohortMap[typeKey].push(ad);

            // Also add to global ALL cohort
            if (!cohortMap['ALL::ALL']) cohortMap['ALL::ALL'] = [];
            cohortMap['ALL::ALL'].push(ad);
        }

        // 3. For cohorts with < 5 ads (except type-only and global), skip them
        //    (type-only and global serve as fallbacks)
        const benchmarks = [];

        for (const [cohortKey, cohortAds] of Object.entries(cohortMap)) {
            const parts = cohortKey.split('::');
            const creativeType = parts[0];
            const campaignPattern = parts[1];
            const isTypeOnly = campaignPattern === 'ALL';
            const isGlobal = creativeType === 'ALL' && campaignPattern === 'ALL';

            // Skip specific cohorts with < 3 ads (keep fallbacks)
            if (!isTypeOnly && !isGlobal && cohortAds.length < 3) continue;

            // Filter out ROAS values > 5000% (50x) as likely matching errors
            const d6Values = cohortAds.map(a => a.d6_roas).filter(v => v != null && v > 0 && v <= 5000);
            const overallValues = cohortAds.map(a => a.overall_roas).filter(v => v != null && v > 0 && v <= 5000);
            const hookValues = cohortAds.map(a => a.hook_rate).filter(v => v != null);
            const cpiValues = cohortAds.map(a => a.cpi).filter(v => v != null && v > 0);
            const ctrValues = cohortAds.map(a => a.ctr).filter(v => v != null);
            const holdValues = cohortAds.map(a => a.hold_rate).filter(v => v != null);

            // Growth multipliers: overall_roas / d6_roas for ads where both > 0 and valid
            const multipliers = cohortAds
                .filter(a => a.d6_roas > 0 && a.d6_roas <= 5000 && a.overall_roas > 0 && a.overall_roas <= 5000)
                .map(a => a.overall_roas / a.d6_roas);

            benchmarks.push({
                cohort_key: cohortKey,
                creative_type: creativeType,
                campaign_pattern: campaignPattern,
                sample_size: cohortAds.length,
                median_d6_roas: median(d6Values),
                p25_d6_roas: percentile(d6Values, 25),
                p75_d6_roas: percentile(d6Values, 75),
                median_overall_roas: median(overallValues),
                p25_overall_roas: percentile(overallValues, 25),
                p75_overall_roas: percentile(overallValues, 75),
                benchmark_hook_rate: median(hookValues),
                benchmark_cpi: median(cpiValues),
                benchmark_ctr: median(ctrValues),
                benchmark_hold_rate: median(holdValues),
                d6_to_overall_multiplier: median(multipliers),
            });
        }

        // 4. Save to DB
        if (benchmarks.length) {
            db.saveCohortBenchmarks(benchmarks);
        }

        return { cohortsBuilt: benchmarks.length };
    }

    // =========================================================================
    // predictNewAd
    // =========================================================================

    async function predictNewAd(adSnapshot) {
        const creativeType = (adSnapshot.creative_type || 'UNKNOWN').toUpperCase();
        const campaignPattern = normalizeCampaign(adSnapshot.campaign_name);

        // 1. Match to cohort
        const specificKey = `${creativeType}::${campaignPattern}`;
        const typeKey = `${creativeType}::ALL`;
        const globalKey = 'ALL::ALL';

        let cohort = db.getCohortBenchmarks(specificKey);
        if (!cohort) cohort = db.getCohortBenchmarks(typeKey);
        if (!cohort) cohort = db.getCohortBenchmarks(globalKey);

        const daysLive = adSnapshot.days_live || 0;

        // Base prediction output (shared fields)
        const basePrediction = {
            ad_id: adSnapshot.ad_id,
            ad_name: adSnapshot.ad_name,
            campaign_name: adSnapshot.campaign_name,
            adset_name: adSnapshot.adset_name,
            creative_type: adSnapshot.creative_type,
            days_live_at_prediction: daysLive,
            early_spend: adSnapshot.spend || null,
            early_cpi: adSnapshot.cpi || null,
            early_ctr: adSnapshot.ctr || null,
            early_hook_rate: adSnapshot.hook_rate || null,
            early_hold_rate: adSnapshot.hold_rate || null,
            early_installs: adSnapshot.installs || null,
            early_signups: adSnapshot.signups || null,
            early_d6_roas: adSnapshot.d6_roas || null,
            early_overall_roas: adSnapshot.overall_roas || null,
            cohort_key: cohort ? cohort.cohort_key : null,
            cohort_sample_size: cohort ? cohort.sample_size : 0,
        };

        // If no cohorts at all, return a minimal prediction
        if (!cohort) {
            return {
                ...basePrediction,
                predicted_d6_roas: null, predicted_d6_low: null, predicted_d6_high: null,
                predicted_d15_roas: null, predicted_d15_low: null, predicted_d15_high: null,
                predicted_d30_roas: null, predicted_d30_low: null, predicted_d30_high: null,
                predicted_d60_roas: null, predicted_d60_low: null, predicted_d60_high: null,
                predicted_d180_roas: null, predicted_d180_low: null, predicted_d180_high: null,
                prediction_method: 'no_cohort',
                confidence_score: 0,
                gpt_qualitative: null,
                trajectory: 'too_early',
                recommended_action: 'WATCH',
                reasoning: 'No cohort benchmarks available for comparison.',
            };
        }

        // 2. Extract signals and find similar historical ads
        const metaSignals = extractMetaSignals(adSnapshot, cohort);
        const similarAds = findSimilarHistoricalAds(metaSignals, cohort, 10);
        const marketSignals = getMarketSignals();

        // 3. Score early signals (still needed for confidence + trajectory)
        const signals = {};
        let signalCount = 0;

        if (adSnapshot.hook_rate != null && cohort.benchmark_hook_rate > 0) {
            signals.hook_rate = adSnapshot.hook_rate / cohort.benchmark_hook_rate;
            signalCount++;
        }
        if (adSnapshot.cpi != null && adSnapshot.cpi > 0 && cohort.benchmark_cpi > 0) {
            signals.cpi = cohort.benchmark_cpi / adSnapshot.cpi;
            signalCount++;
        }
        if (adSnapshot.ctr != null && cohort.benchmark_ctr > 0) {
            signals.ctr = adSnapshot.ctr / cohort.benchmark_ctr;
            signalCount++;
        }
        if (adSnapshot.hold_rate != null && cohort.benchmark_hold_rate > 0) {
            signals.hold_rate = adSnapshot.hold_rate / cohort.benchmark_hold_rate;
            signalCount++;
        }

        const weights = { hook_rate: 0.3, cpi: 0.3, ctr: 0.2, hold_rate: 0.2 };
        let weightedSum = 0, weightTotal = 0;
        for (const [metric, weight] of Object.entries(weights)) {
            if (signals[metric] != null) { weightedSum += signals[metric] * weight; weightTotal += weight; }
        }
        const rawRatio = weightTotal > 0 ? weightedSum / weightTotal : 0.5;
        const signalScore = Math.min(100, Math.max(0, rawRatio * 50));

        // 4. AI-powered prediction (primary method)
        let predicted_d6, predicted_d6_low, predicted_d6_high;
        let predicted_d15, predicted_d15_low, predicted_d15_high;
        let predicted_d30, predicted_d30_low, predicted_d30_high;
        let predicted_d60, predicted_d60_low, predicted_d60_high;
        let predicted_d180, predicted_d180_low, predicted_d180_high;
        let predictionMethod;
        let gptQualitative = null;
        let trajectory, recommendedAction;

        const aiResult = await predictWithAI(adSnapshot, metaSignals, similarAds, marketSignals, cohort);

        if (aiResult && aiResult.predictions) {
            const p = aiResult.predictions;
            const d6 = p.day_6 || {};
            const d15 = p.day_15 || {};
            const d30 = p.day_30 || {};
            const d60 = p.day_60 || {};
            const d180 = p.day_180 || {};

            predicted_d6 = d6.roas || 0;
            predicted_d6_low = d6.low || predicted_d6 * 0.7;
            predicted_d6_high = d6.high || predicted_d6 * 1.3;
            predicted_d15 = d15.roas || 0;
            predicted_d15_low = d15.low || predicted_d15 * 0.7;
            predicted_d15_high = d15.high || predicted_d15 * 1.3;
            predicted_d30 = d30.roas || 0;
            predicted_d30_low = d30.low || predicted_d30 * 0.7;
            predicted_d30_high = d30.high || predicted_d30 * 1.3;
            predicted_d60 = d60.roas || 0;
            predicted_d60_low = d60.low || predicted_d60 * 0.7;
            predicted_d60_high = d60.high || predicted_d60 * 1.3;
            predicted_d180 = d180.roas || 0;
            predicted_d180_low = d180.low || predicted_d180 * 0.7;
            predicted_d180_high = d180.high || predicted_d180 * 1.3;

            predictionMethod = 'ai_similarity';
            trajectory = p.trajectory || (signalScore >= 70 ? 'promising' : signalScore >= 40 ? 'average' : 'concerning');
            recommendedAction = p.recommended_action || (trajectory === 'promising' ? 'SCALE' : trajectory === 'average' ? 'WATCH' : 'PAUSE');

            gptQualitative = aiResult.raw;
            console.log(`[predictor] AI prediction for ${adSnapshot.ad_name}: D6=${predicted_d6.toFixed(1)}%, D30=${predicted_d30.toFixed(1)}% (${similarAds.length} similar ads, market: ${marketSignals.sentiment})`);
        } else {
            // 5. Fallback: try similarity-weighted average from historical ads
            const simFallback = computeSimilarityFallback(similarAds, adSnapshot);

            if (simFallback) {
                predictionMethod = 'similarity_weighted';
                predicted_d6 = simFallback.d6;
                predicted_d6_low = predicted_d6 * 0.7;
                predicted_d6_high = predicted_d6 * 1.3;
                predicted_d15 = simFallback.d15;
                predicted_d15_low = predicted_d15 * 0.7;
                predicted_d15_high = predicted_d15 * 1.3;
                predicted_d30 = simFallback.d30;
                predicted_d30_low = predicted_d30 * 0.7;
                predicted_d30_high = predicted_d30 * 1.3;
                predicted_d60 = simFallback.d60;
                predicted_d60_low = predicted_d60 * 0.7;
                predicted_d60_high = predicted_d60 * 1.3;
                predicted_d180 = simFallback.d180;
                predicted_d180_low = predicted_d180 * 0.7;
                predicted_d180_high = predicted_d180 * 1.3;

                console.log(`[predictor] Similarity-weighted prediction for ${adSnapshot.ad_name}: D6=${predicted_d6.toFixed(1)}% (${similarAds.length} similar ads)`);
            } else {
                // 6. Last resort: old multiplier-based fallback
                const rawMult = cohort.d6_to_overall_multiplier || 1;
                const d6Mult = Math.max(rawMult, 1.5);

                if (daysLive >= 6 && adSnapshot.d6_roas > 0 && adSnapshot.d6_roas <= 5000) {
                    predictionMethod = 'd6_extrapolation';
                    predicted_d6 = adSnapshot.d6_roas;
                    predicted_d6_low = cohort.p25_d6_roas || predicted_d6 * 0.7;
                    predicted_d6_high = cohort.p75_d6_roas || predicted_d6 * 1.3;
                } else {
                    predictionMethod = 'early_signal_interpolation';
                    const scoreFraction = signalScore / 100;
                    const p25d6 = cohort.p25_d6_roas || 0;
                    const p75d6 = cohort.p75_d6_roas || 0;
                    predicted_d6 = p25d6 + scoreFraction * (p75d6 - p25d6);
                    predicted_d6_low = p25d6 * Math.max(0.5, scoreFraction);
                    predicted_d6_high = p75d6 * Math.min(2, scoreFraction + 0.5);
                }

                const d15M = d6Mult > 1 ? 1 + (d6Mult - 1) * 0.15 : d6Mult;
                predicted_d15 = predicted_d6 * d15M;
                predicted_d15_low = (predicted_d6_low || predicted_d6 * 0.7) * d15M;
                predicted_d15_high = (predicted_d6_high || predicted_d6 * 1.3) * d15M;

                const d30M = d6Mult > 1 ? 1 + (d6Mult - 1) * 0.5 : d6Mult;
                predicted_d30 = predicted_d6 * d30M;
                predicted_d30_low = (predicted_d6_low || predicted_d6 * 0.7) * d30M;
                predicted_d30_high = (predicted_d6_high || predicted_d6 * 1.3) * d30M;

                const d60M = d6Mult > 1 ? 1 + (d6Mult - 1) * 0.75 : d6Mult;
                predicted_d60 = predicted_d6 * d60M;
                predicted_d60_low = (predicted_d6_low || predicted_d6 * 0.7) * d60M;
                predicted_d60_high = (predicted_d6_high || predicted_d6 * 1.3) * d60M;

                predicted_d180 = predicted_d6 * d6Mult;
                predicted_d180_low = (predicted_d6_low || predicted_d6 * 0.7) * d6Mult;
                predicted_d180_high = (predicted_d6_high || predicted_d6 * 1.3) * d6Mult;
            }

            // Trajectory from signal score
            if (daysLive === 0 && signalCount === 0) { trajectory = 'too_early'; recommendedAction = 'WATCH'; }
            else if (signalScore >= 70) { trajectory = 'promising'; recommendedAction = 'SCALE'; }
            else if (signalScore >= 40) { trajectory = 'average'; recommendedAction = 'WATCH'; }
            else { trajectory = 'concerning'; recommendedAction = 'PAUSE'; }
        }

        // 7. Confidence score — factor in similarity quality
        const sampleFactor = Math.min(cohort.sample_size || 0, 50) / 50;
        const daysFactor = Math.min(daysLive, 14) / 14;
        const signalFactor = signalCount / 4;
        const similarityFactor = similarAds.length > 0
            ? Math.min(similarAds[0].similarity, 1) * 0.5 + Math.min(similarAds.length, 10) / 10 * 0.5
            : 0;
        const confidenceScore = Math.round((
            sampleFactor * 0.25 +
            daysFactor * 0.25 +
            signalFactor * 0.2 +
            similarityFactor * 0.3
        ) * 100);

        // 8. Build reasoning string
        const reasonParts = [];
        reasonParts.push(`Method: ${predictionMethod}`);
        reasonParts.push(`${similarAds.length} similar ads found (top sim: ${similarAds.length > 0 ? (similarAds[0].similarity * 100).toFixed(0) + '%' : 'none'})`);
        if (marketSignals.sentiment !== 'neutral') reasonParts.push(`Market: ${marketSignals.sentiment}`);
        if (marketSignals.vix) reasonParts.push(`VIX: ${marketSignals.vix}`);
        reasonParts.push(`Signal score: ${signalScore.toFixed(1)}/100 (cohort: ${cohort.cohort_key}, n=${cohort.sample_size})`);
        if (signals.hook_rate != null) reasonParts.push(`Hook rate ${(signals.hook_rate * 100).toFixed(0)}% of cohort median`);
        if (signals.cpi != null) reasonParts.push(`CPI efficiency ${(signals.cpi * 100).toFixed(0)}% of cohort median`);
        if (signals.ctr != null) reasonParts.push(`CTR ${(signals.ctr * 100).toFixed(0)}% of cohort median`);
        if (signals.hold_rate != null) reasonParts.push(`Hold rate ${(signals.hold_rate * 100).toFixed(0)}% of cohort median`);

        return {
            ...basePrediction,
            predicted_d6_roas: round4(predicted_d6),
            predicted_d6_low: round4(predicted_d6_low),
            predicted_d6_high: round4(predicted_d6_high),
            predicted_d15_roas: round4(predicted_d15),
            predicted_d15_low: round4(predicted_d15_low),
            predicted_d15_high: round4(predicted_d15_high),
            predicted_d30_roas: round4(predicted_d30),
            predicted_d30_low: round4(predicted_d30_low),
            predicted_d30_high: round4(predicted_d30_high),
            predicted_d60_roas: round4(predicted_d60),
            predicted_d60_low: round4(predicted_d60_low),
            predicted_d60_high: round4(predicted_d60_high),
            predicted_d180_roas: round4(predicted_d180),
            predicted_d180_low: round4(predicted_d180_low),
            predicted_d180_high: round4(predicted_d180_high),
            prediction_method: predictionMethod,
            confidence_score: confidenceScore,
            gpt_qualitative: gptQualitative,
            trajectory,
            recommended_action: recommendedAction,
            reasoning: reasonParts.join('. '),
        };
    }

    function round4(v) {
        if (v == null || isNaN(v)) return null;
        return Math.round(v * 10000) / 10000;
    }

    // =========================================================================
    // detectAndPredictNewAds
    // =========================================================================

    async function detectAndPredictNewAds() {
        // 1. Get latest snapshots
        const snapshots = db.getLatestSnapshots();

        // 2. Filter to early-stage ads (days_live <= 7)
        const earlyAds = snapshots.filter(s => (s.days_live || 0) <= 7);

        const predictions = [];
        let predicted = 0;

        for (const ad of earlyAds) {
            // 3. Check if a recent prediction already exists
            const existing = db.getPrediction(ad.ad_id);
            if (existing) {
                const predAge = Date.now() - new Date(existing.predicted_at + 'Z').getTime();
                const oneDayMs = 24 * 60 * 60 * 1000;
                if (predAge < oneDayMs) continue; // skip if prediction < 24h old
            }

            // 4. Run prediction
            const prediction = await predictNewAd(ad);

            // 5. Mark old predictions as not latest
            db.markOldPredictions(ad.ad_id);

            // 6. Insert new prediction
            db.savePrediction(prediction);

            predictions.push(prediction);
            predicted++;
        }

        return { predicted, predictions };
    }

    // =========================================================================
    // trackPredictionAccuracy
    // =========================================================================

    function trackPredictionAccuracy() {
        const unverified = db.getUnverifiedPredictions();
        let tracked = 0;

        for (const pred of unverified) {
            // Get latest snapshot for this ad
            const snapshots = db.getSnapshotHistory(pred.ad_id, 180);
            if (!snapshots.length) continue;

            const latest = snapshots[snapshots.length - 1]; // most recent
            const daysLive = latest.days_live || 0;

            const actuals = {};
            let hasUpdate = false;

            // D6 accuracy — only after 14+ days (matured) and actual D6 ROAS exists, > 0, and <= 5000 (valid)
            if (daysLive >= 14 && pred.predicted_d6_roas != null) {
                const actualD6 = latest.d6_roas;
                if (actualD6 != null && actualD6 > 0 && actualD6 <= 5000) {
                    actuals.actual_d6_roas = actualD6;
                    // Accuracy = 100 - error%. Higher = better.
                    const errorPct = Math.abs(pred.predicted_d6_roas - actualD6) / actualD6 * 100;
                    actuals.d6_accuracy_pct = Math.max(0, Math.round(100 - errorPct));
                    hasUpdate = true;
                }
            }

            // D30 accuracy — only after 30+ days
            if (daysLive >= 30 && pred.predicted_d30_roas != null) {
                const actualD30 = latest.overall_roas;
                if (actualD30 != null && actualD30 > 0 && actualD30 <= 5000) {
                    actuals.actual_d30_roas = actualD30;
                    const errorPct = Math.abs(pred.predicted_d30_roas - actualD30) / actualD30 * 100;
                    actuals.d30_accuracy_pct = Math.max(0, Math.round(100 - errorPct));
                    hasUpdate = true;
                }
            }

            if (hasUpdate) {
                db.updatePredictionActuals(pred.id, actuals);
                tracked++;
            }
        }

        return { tracked };
    }

    // =========================================================================
    // enhanceWithGpt
    // =========================================================================

    async function enhanceWithGpt(prediction, adSnapshot) {
        if (!OPENAI_API_KEY) return prediction;

        const cohort = prediction.cohort_key ? db.getCohortBenchmarks(prediction.cohort_key) : null;

        const prompt = `You are an expert performance marketing analyst. Analyze this ad prediction and provide qualitative insights.

## Ad Snapshot
- Ad Name: ${adSnapshot.ad_name}
- Campaign: ${adSnapshot.campaign_name}
- Creative Type: ${adSnapshot.creative_type}
- Days Live: ${adSnapshot.days_live}
- Spend: ${adSnapshot.spend}
- CPI: ${adSnapshot.cpi}, CTR: ${adSnapshot.ctr}
- Hook Rate: ${adSnapshot.hook_rate}, Hold Rate: ${adSnapshot.hold_rate}
- D6 ROAS: ${adSnapshot.d6_roas}, Overall ROAS: ${adSnapshot.overall_roas}
- Installs: ${adSnapshot.installs}, Signups: ${adSnapshot.signups}

## Prediction
- Trajectory: ${prediction.trajectory} (signal score: ${prediction.confidence_score})
- Predicted D6 ROAS: ${prediction.predicted_d6_roas} (${prediction.predicted_d6_low} - ${prediction.predicted_d6_high})
- Predicted D30 ROAS: ${prediction.predicted_d30_roas} (${prediction.predicted_d30_low} - ${prediction.predicted_d30_high})
- Recommendation: ${prediction.recommended_action}
- Reasoning: ${prediction.reasoning}
${cohort ? `\n## Cohort Benchmarks (${cohort.cohort_key}, n=${cohort.sample_size})\n- Median D6 ROAS: ${cohort.median_d6_roas}, Overall ROAS: ${cohort.median_overall_roas}\n- Benchmark CPI: ${cohort.benchmark_cpi}, CTR: ${cohort.benchmark_ctr}\n- Hook Rate: ${cohort.benchmark_hook_rate}, Hold Rate: ${cohort.benchmark_hold_rate}` : ''}

Respond in JSON with these fields:
- narrative: 2-3 sentence assessment of this ad's potential
- risk_factors: array of specific risks
- opportunities: array of specific opportunities
- naming_pattern_analysis: what the ad naming reveals about creative strategy
- confidence_note: how reliable this prediction is and why`;

        try {
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                    model: 'gpt-5.4',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.3,
                    response_format: { type: 'json_object' },
                }),
            });

            if (!resp.ok) {
                console.error('[predictor] GPT API error:', resp.status, await resp.text());
                return prediction;
            }

            const data = await resp.json();
            const content = data.choices?.[0]?.message?.content;
            if (content) {
                prediction.gpt_qualitative = content;
            }
        } catch (err) {
            console.error('[predictor] GPT enhancement failed:', err.message);
        }

        return prediction;
    }

    // =========================================================================
    // Public API
    // =========================================================================

    return {
        buildCohortBenchmarks,
        predictNewAd,
        detectAndPredictNewAds,
        trackPredictionAccuracy,
        enhanceWithGpt,
    };
};
