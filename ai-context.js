// =============================================================================
// AI Context Preparation Engine
// Packages allData into rich, structured context for all AI calls
// =============================================================================

(function() {
    'use strict';

    function prepareAIContext() {
        var data = window.allData || [];
        if (!data.length) return null;

        // ── PORTFOLIO BENCHMARKS (min ₹5K spend for valid benchmarks) ──
        var withData = data.filter(function(d) { return d.spent > 5000; });
        var videos = withData.filter(function(d) { return d.type === 'Video'; });
        var statics = withData.filter(function(d) { return d.type === 'Static'; });

        function median(arr, fn) {
            var vals = arr.map(fn).filter(function(v) { return v > 0; }).sort(function(a, b) { return a - b; });
            if (!vals.length) return 0;
            var mid = Math.floor(vals.length / 2);
            return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
        }

        function avg(arr, fn) {
            var vals = arr.map(fn).filter(function(v) { return v > 0; });
            return vals.length ? vals.reduce(function(s, v) { return s + v; }, 0) / vals.length : 0;
        }

        function pct(n, d) {
            return d > 0 ? (n / d * 100).toFixed(1) + '%' : 'N/A';
        }

        function safeMax(arr) {
            var filtered = arr.filter(function(v) { return v > 0; });
            return filtered.length ? Math.max.apply(null, filtered) : 0;
        }

        var benchmarks = {
            portfolio: {
                median_cpi: median(withData, function(d) { return d.cpi; }),
                median_signup_cost: median(withData, function(d) { return d.signupCost; }),
                median_d6_roas: median(withData, function(d) { return d.d6ROAS; }),
                median_d6_cac: median(withData, function(d) { return d.d6CAC; }),
                median_overall_roas: median(withData, function(d) { return d.overallROAS; }),
                avg_install_to_signup_rate: avg(withData, function(d) { return d.signupPct * 100; }),
                avg_signup_to_d0trial_rate: avg(withData, function(d) {
                    return d.d0Trials > 0 && d.signups > 0 ? (d.d0Trials / d.signups * 100) : 0;
                }),
                avg_d0trial_to_d6_rate: avg(withData, function(d) {
                    return d.d0Trials > 0 && d.d6 > 0 ? (d.d6 / d.d0Trials * 100) : 0;
                }),
                total_creatives: withData.length,
                live_count: withData.filter(function(d) { return d.live === 'Live'; }).length,
                total_spend: withData.reduce(function(s, d) { return s + d.spent; }, 0),
                total_d6_revenue: withData.reduce(function(s, d) { return s + (d.d6OverallRevenue || 0); }, 0),
                total_overall_revenue: withData.reduce(function(s, d) { return s + (d.overallRevenue || 0); }, 0)
            },
            video: {
                count: videos.length,
                median_hook_rate: median(videos, function(d) { return d.hook * 100; }),
                median_hold_rate: median(videos, function(d) { return d.hold * 100; }),
                median_full_play: median(videos, function(d) { return d.fullPlay * 100; }),
                median_cpi: median(videos, function(d) { return d.cpi; }),
                median_d6_roas: median(videos, function(d) { return d.d6ROAS; }),
                best_hook_rate: safeMax(videos.map(function(d) { return d.hook * 100; })),
                best_d6_roas: safeMax(videos.map(function(d) { return d.d6ROAS; }))
            },
            static: {
                count: statics.length,
                median_ctr: median(statics, function(d) { return d.ctr * 100; }),
                median_cpi: median(statics, function(d) { return d.cpi; }),
                median_signup_rate: median(statics, function(d) { return d.signupPct * 100; }),
                median_d6_roas: median(statics, function(d) { return d.d6ROAS; }),
                best_ctr: safeMax(statics.map(function(d) { return d.ctr * 100; })),
                best_d6_roas: safeMax(statics.map(function(d) { return d.d6ROAS; }))
            }
        };

        // ── TOP 20 AND BOTTOM 20 CREATIVES (by D6 ROAS, min ₹10K spend) ──
        var scored = withData
            .filter(function(d) { return d.spent > 10000; })
            .map(function(d) {
                return {
                    name: d.name,
                    type: d.type || 'Unknown',
                    live: d.live,
                    spend: Math.round(d.spent),
                    installs: d.installs,
                    signups: d.signups,
                    install_to_signup_pct: pct(d.signups, d.installs),
                    d0_trials: d.d0Trials,
                    signup_to_d0trial_pct: pct(d.d0Trials, d.signups),
                    d0: d.d0,
                    d6: d.d6,
                    d0trial_to_d6_pct: pct(d.d6, d.d0Trials),
                    p0p1: d.p0p1,
                    p0p1_pct: pct(d.p0p1, d.signups),
                    cpi: Math.round(d.cpi),
                    cpm: Math.round(d.cpm),
                    ctr_pct: (d.ctr * 100).toFixed(2) + '%',
                    signup_cost: Math.round(d.signupCost),
                    d0trial_cost: Math.round(d.d0TrialCost),
                    d6_cac: Math.round(d.d6CAC),
                    d6_roas_pct: d.d6ROAS.toFixed(1) + '%',
                    overall_roas_pct: d.overallROAS.toFixed(1) + '%',
                    d6_revenue: Math.round(d.d6OverallRevenue || 0),
                    overall_revenue: Math.round(d.overallRevenue || 0),
                    matured_d6_roas: d.d6ROASMatured ? d.d6ROASMatured.toFixed(1) + '%' : null,
                    matured_overall_roas: d.overallROASMatured ? d.overallROASMatured.toFixed(1) + '%' : null,
                    matured_spend: d.maturedSpend ? Math.round(d.maturedSpend) : null,
                    hook_rate_pct: d.type === 'Video' ? (d.hook * 100).toFixed(1) + '%' : null,
                    hold_rate_pct: d.type === 'Video' ? (d.hold * 100).toFixed(1) + '%' : null,
                    full_play_pct: d.type === 'Video' ? (d.fullPlay * 100).toFixed(1) + '%' : null,
                    week: d.week,
                    go_live_date: d.date,
                    next_steps: d.nextSteps,
                    test_perf: d.testPerf
                };
            })
            .sort(function(a, b) { return parseFloat(b.d6_roas_pct) - parseFloat(a.d6_roas_pct); });

        var top20 = scored.slice(0, 20);
        var bottom20 = scored.slice(-20).reverse();
        var liveCreatives = scored.filter(function(d) { return d.live === 'Live'; });
        var allScored = scored;

        // ── LTV CALCULATION from actual Metabase revenue ──
        var withRevenue = withData.filter(function(d) { return d.overallRevenue > 0 && d.signups > 0; });
        var withD6Rev = withData.filter(function(d) { return (d.d6OverallRevenue || 0) > 0 && d.d6 > 0; });

        var ltv_data = {
            avg_revenue_per_signup: withRevenue.length ?
                avg(withRevenue, function(d) { return d.overallRevenue / d.signups; }) : null,
            avg_revenue_per_d6_conversion: withD6Rev.length ?
                avg(withD6Rev, function(d) { return d.d6OverallRevenue / d.d6; }) : null,
            avg_d6_to_overall_revenue_multiplier: (withRevenue.length && withD6Rev.length) ?
                avg(withData.filter(function(d) { return d.d6OverallRevenue > 0 && d.overallRevenue > 0; }),
                    function(d) { return d.overallRevenue / d.d6OverallRevenue; }) : null,
            video_avg_revenue_per_signup: avg(
                videos.filter(function(d) { return d.overallRevenue > 0 && d.signups > 0; }),
                function(d) { return d.overallRevenue / d.signups; }
            ),
            static_avg_revenue_per_signup: avg(
                statics.filter(function(d) { return d.overallRevenue > 0 && d.signups > 0; }),
                function(d) { return d.overallRevenue / d.signups; }
            ),
            sample_size_revenue: withRevenue.length,
            sample_size_d6: withD6Rev.length,
            top_by_overall_revenue: withRevenue
                .sort(function(a, b) { return b.overallRevenue - a.overallRevenue; })
                .slice(0, 10)
                .map(function(d) {
                    return {
                        name: d.name,
                        spend: Math.round(d.spent),
                        signups: d.signups,
                        d6: d.d6,
                        overall_revenue: Math.round(d.overallRevenue),
                        overall_roas: d.overallROAS.toFixed(1) + '%',
                        revenue_per_signup: Math.round(d.overallRevenue / d.signups),
                        d6_to_overall_multiplier: d.d6OverallRevenue > 0 ? (d.overallRevenue / d.d6OverallRevenue).toFixed(2) + 'x' : null
                    };
                })
        };

        return {
            univest_context: {
                company: 'Univest',
                product: 'Stock market subscription app — Research Advisory (RA) plans ₹999-₹2,999/month + Demat/Trading account',
                target_audience: 'Indian retail investors, 25-45 years, Android-heavy, Tier 1-2 cities, interested in stock market',
                ad_platform: 'Meta (Facebook + Instagram)',
                spend_includes_gst: '18% GST already included in all spend figures',
                funnel_sequence: 'Ad Impression → Install (CPI) → Signup (Signup Cost) → D0 Trial (first day trial start) → D0 Payment → D6 Payment (within 6 days) → Overall Revenue (lifetime so far)',
                metric_definitions: {
                    D0_trial: 'Users who started a free/paid trial on the day they installed',
                    D0: 'Users who paid on day 0',
                    D6: 'Users who paid within 6 days of install — PRIMARY conversion metric',
                    D6_ROAS: 'D6 revenue / total spend × 100. Target: >28% is good, >40% is excellent, <15% needs pause',
                    D6_CAC: 'Spend / D6 conversions in ₹. Target: <₹12,000 excellent, ₹12-15K acceptable, >₹15K review',
                    Overall_ROAS: 'Total revenue since launch / total spend × 100. Includes renewals and upgrades beyond D6',
                    Matured_ROAS: 'ROAS calculated over the full maturation window — more accurate for old creatives',
                    P0P1: 'High-value subscribers (premium payment tier)',
                    Hook_rate: '3-second views / impressions. Target: >25% good, >35% excellent for video',
                    Hold_rate: 'ThruPlays / 3-second views. Measures if people who stopped to watch stayed. Target: >40%',
                    Signup_pct: 'Signups / installs. Target: >15% excellent, >10% good, <7% poor',
                    D0trial_to_D6_rate: 'D6 / D0_trial — how many who trialed actually converted. Critical quality signal'
                },
                decision_principles: [
                    'Week-over-week trend direction is a major decision signal; continuous multi-week decline or improvement matters more than a single week move.',
                    'If an ad or adset was strong in prior weeks but has only recently dropped, prefer creative refresh, watch, or light budget cuts before hard pause decisions.',
                    'If performance has recently improved after weak history, prefer controlled scaling instead of immediate aggressive budget jumps.',
                    'Account median values are decision references, not universal truths; compare against the correct platform/view benchmark.'
                ],
                benchmark_policy: {
                    meta_optimizer: 'Use Meta account medians for optimizer decisions.',
                    campaign_tree: 'Campaign Tree is primarily diagnostic and may keep more fixed thresholds than the optimizer.',
                    google_portal: 'Google portal must use Google-specific medians and should not reuse Meta optimizer medians.'
                },
                current_benchmarks: benchmarks
            },
            top_20_by_d6_roas: top20,
            bottom_20_by_d6_roas: bottom20,
            live_creatives: liveCreatives,
            all_creatives_scored: allScored,
            ltv_data: ltv_data,
            data_quality: {
                total_creatives: data.length,
                with_spend_data: withData.length,
                with_revenue_data: withRevenue.length,
                with_d6_data: withData.filter(function(d) { return d.d6 > 0; }).length,
                with_matured_data: withData.filter(function(d) { return d.maturedSpend > 0; }).length,
                video_count: videos.length,
                static_count: statics.length
            }
        };
    }

    window.prepareAIContext = prepareAIContext;
})();
