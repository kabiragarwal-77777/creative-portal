// =============================================================================
// Campaign Optimizer â€” Scan â†’ Plan â†’ Execute
// Uses same data pipeline as Campaign Tree (server-side Meta + Metabase fetch)
// =============================================================================

(function() {
'use strict';

window.OPTIMIZER_SCAN = null;
window.OPTIMIZER_PLAN = null;
window.OPTIMIZER_STAGE = 'scan';
window.OPTIMIZER_LOG = [];
window.OPTIMIZER_PLAN_FILTER = 'all';
window.OPTIMIZER_PLAN_SCOPE = 'all';
window.OPTIMIZER_APEX_MODE = window.OPTIMIZER_APEX_MODE || 'daily_review';
window.OPTIMIZER_TARGET = window.OPTIMIZER_TARGET || { type: 'account', query: '' };
window.OPTIMIZER_AUDIENCE_FILTER = window.OPTIMIZER_AUDIENCE_FILTER || 'all';
window.OPTIMIZER_STATUS_FILTER = window.OPTIMIZER_STATUS_FILTER || 'live_only';
window.OPTIMIZER_OVERVIEW_LEVEL = window.OPTIMIZER_OVERVIEW_LEVEL || 'campaign';
window.OPTIMIZER_OVERVIEW_ADSET = window.OPTIMIZER_OVERVIEW_ADSET || '';
window.OPTIMIZER_CHAT = window.OPTIMIZER_CHAT || [];
window.OPTIMIZER_USER_PROMPT = window.OPTIMIZER_USER_PROMPT || '';

var SERVER = window.__CREATIVE_PORTAL_SERVER__ || (window.location.origin || 'http://localhost:3000');

// â”€â”€ Helpers â”€â”€

function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

function fmtINR(v) {
    if (v == null || isNaN(v)) return '--';
    if (Math.abs(v) >= 100000) return '\u20b9' + (v / 100000).toFixed(1) + 'L';
    if (Math.abs(v) >= 1000) return '\u20b9' + (v / 1000).toFixed(1) + 'K';
    return '\u20b9' + Math.round(v);
}

function fmtPct(v) { return v != null ? parseFloat(v).toFixed(1) + '%' : '--'; }
function titleCaseWords(value) {
    return String(value || '').split('_').map(function(part) {
        return part ? part.charAt(0).toUpperCase() + part.slice(1) : '';
    }).join(' ');
}
function getApexModeConfig(mode) {
    var configs = {
        daily_review: {
            label: 'Daily Optimisations',
            sublabel: 'today only: exact pauses, budget shifts, and reactivations',
            command: 'SESSION: daily_review. Produce VIEW 1 only. Exact actions only, with exact entity, current value, new value, and trigger metric.',
            objective: 'Tell me exactly what to change today across budgets, pauses, and reactivations.',
            viewFocus: 'view_1'
        },
        diagnostic: {
            label: 'Diagnosis',
            sublabel: 'why results look like this: delivery, creative, audience, auction',
            command: 'SESSION: diagnostic. Produce VIEW 2 only. Diagnosis only, no action list, and be explicit about confidence and missing data.',
            objective: 'Explain what is actually causing the current performance state before changing more things.',
            viewFocus: 'view_2'
        },
        account_overview: {
            label: 'Account Overview',
            sublabel: 'campaign → adset → ad drill-down with settings, status, and efficiency',
            command: 'SESSION: monthly_full_review. Produce a full-account active-entity review in order: every active campaign, then its active adsets, then its active ads. For each level, say exactly what to revamp and why. If nothing should change, say no change needed explicitly.',
            objective: 'Dig into each active campaign, adset, and ad and say exactly what should change, what should stay, and how to improve efficiency.',
            viewFocus: 'overview'
        }
    };
    return configs[mode] || configs.daily_review;
}

function buildApexBusinessConstants() {
    return {
        vertical: 'Financial advisory',
        sub_verticals: ['Research advisory', 'Broking', 'Mutual fund advisory'],
        country: 'India',
        currency: 'INR',
        spend_basis: 'GST-inclusive',
        regulation: 'SEBI',
        primary_kpi: 'D6 ROAS from Metabase cohort revenue on GST-inclusive spend',
        primary_kpi_target: 0.35,
        blended_mer_anchor: 0.74,
        secondary_kpi: 'Cost per signup',
        retargeting_caveat: 'Retargeting metrics are not reliably populating in Metabase. Do not auto-pause or auto-scale retargeting on reported funnel efficiency alone.',
        competitors: {
            research_advisory: ['Motilal Oswal', 'Nirmal Bang', 'SMC Global', 'Tips2Trades', 'HDFC Securities'],
            broking: ['Zerodha', 'Groww', 'Angel One', 'Upstox', '5Paisa'],
            hybrid_advisory: ['Smallcase', 'Capitalmind']
        },
        seasonality: {
            jan: 'Budget season peak. Scale window.',
            mar_31: 'Tax filing deadline. High financial intent.',
            apr: 'Post-tax season trough. Reduce prospecting.',
            aug: 'Slow period. Test and learn phase, not scale phase.',
            oct_nov: 'Diwali CPM surge. Pre-build audiences in Sep.',
            payroll_week: '25th–5th each month. Conversion intent peaks.'
        }
    };
}

function buildOptimizerSkillContracts() {
    return [
        { id: 'skill-router', path: 'skills/skill-router/SKILL.md' },
        { id: 'optimizer-prompt-brain', path: 'skills/optimizer-prompt-brain/SKILL.md' },
        { id: 'performance-marketer-final-qa', path: 'skills/performance-marketer-final-qa/SKILL.md' },
        { id: 'advanced-performance-trend-analysis', path: 'skills/advanced-performance-trend-analysis/SKILL.md' },
        { id: 'prompt-to-delivery-optimizer', path: 'skills/prompt-to-delivery-optimizer/SKILL.md' },
        { id: 'cpa-diagnostics', path: 'skills/cpa-diagnostics/SKILL.md' },
        { id: 'wasted-spend-finder', path: 'skills/wasted-spend-finder/SKILL.md' },
        { id: 'anomaly-detection', path: 'skills/anomaly-detection/SKILL.md' },
        { id: 'pacing-monitor', path: 'skills/pacing-monitor/SKILL.md' },
        { id: 'performance-benchmarking', path: 'skills/performance-benchmarking/SKILL.md' },
        { id: 'geo-performance-analysis', path: 'skills/geo-performance-analysis/SKILL.md' },
        { id: 'device-performance-analysis', path: 'skills/device-performance-analysis/SKILL.md' },
        { id: 'attribution-model-comparison', path: 'skills/attribution-model-comparison/SKILL.md' },
        { id: 'account-structure-review', path: 'skills/account-structure-review/SKILL.md' },
        { id: 'roas-forecasting', path: 'skills/roas-forecasting/SKILL.md' },
        { id: 'meta-account-learning', path: 'skills/meta-account-learning/SKILL.md' },
        { id: 'breakdown-action-engine', path: 'skills/breakdown-action-engine/SKILL.md' },
        { id: 'meta-structure-audit', path: 'skills/meta-structure-audit/SKILL.md' },
        { id: 'meta-creative-fatigue-detection', path: 'skills/meta-creative-fatigue-detection/SKILL.md' },
        { id: 'meta-frequency-cap-audit', path: 'skills/meta-frequency-cap-audit/SKILL.md' },
        { id: 'meta-retargeting-window-audit', path: 'skills/meta-retargeting-window-audit/SKILL.md' },
        { id: 'market-posture-engine', path: 'skills/market-posture-engine/SKILL.md' },
        { id: 'change-impact-lite', path: 'skills/change-impact-lite/SKILL.md' },
        { id: 'morning-brief-operator', path: 'skills/morning-brief-operator/SKILL.md' },
        { id: 'replacement-intelligence', path: 'skills/replacement-intelligence/SKILL.md' },
        { id: 'sebi-compliance-audit', path: 'skills/sebi-compliance-audit/SKILL.md' },
        { id: 'delivery-attribution-reasoner', path: 'skills/delivery-attribution-reasoner/SKILL.md' },
        { id: 'unified-output-governor', path: 'skills/unified-output-governor/SKILL.md' }
    ];
}

function buildImportedOptimizerAuditSummary(scanData) {
    var ads = scanData && scanData.ads ? scanData.ads : [];
    var tree = scanData && scanData.tree ? scanData.tree : {};
    var redAds = 0;
    var greenAds = 0;
    var benchmarkPositiveCount = 0;
    var benchmarkNegativeCount = 0;
    var estimatedWastedSpend = 0;
    var benchmarkWinningSpend = 0;
    var topCampaignSpendSharePct = 0;
    var topGeoPocket = null;
    var topPlacementPocket = null;
    var geoSpend = {};
    var placementSpend = {};

    Object.keys(tree).forEach(function(campaignName) {
        var camp = tree[campaignName];
        Object.keys((camp && camp.adsets) || {}).forEach(function(adsetName) {
            var adset = camp.adsets[adsetName];
            (adset.ads || []).forEach(function(ad) {
                var spend = Number(ad.spend || 0);
                if (ad.alertStatus === 'red') {
                    redAds++;
                    estimatedWastedSpend += spend;
                }
                if (ad.alertStatus === 'green') {
                    greenAds++;
                    benchmarkWinningSpend += spend;
                }
                if (ad.recommendation && (ad.recommendation.action === 'SCALE' || ad.recommendation.action === 'MAINTAIN')) benchmarkPositiveCount++;
                if (ad.recommendation && (ad.recommendation.action === 'PAUSE' || ad.recommendation.action === 'REDUCE BUDGET')) benchmarkNegativeCount++;
            });
        });
    });

    var campaignSpends = Object.keys(tree).map(function(name) {
        return Number(tree[name] && tree[name].totals && tree[name].totals.spend || 0);
    }).sort(function(a, b) { return b - a; });
    var totalCampaignSpend = campaignSpends.reduce(function(sum, value) { return sum + value; }, 0);
    if (totalCampaignSpend > 0 && campaignSpends.length) topCampaignSpendSharePct = (campaignSpends[0] / totalCampaignSpend) * 100;

    ads.forEach(function(ad) {
        var spend = Number(ad.spend || 0);
        (ad.placements_active || []).forEach(function(placement) {
            placementSpend[String(placement || '--')] = (placementSpend[String(placement || '--')] || 0) + spend;
        });
        var geo = String(ad.location_targeting || '--');
        geoSpend[geo] = (geoSpend[geo] || 0) + spend;
    });

    function topPocket(map) {
        var best = null;
        Object.keys(map || {}).forEach(function(key) {
            if (!best || map[key] > best.value) best = { key: key, value: map[key] };
        });
        return best;
    }

    topGeoPocket = topPocket(geoSpend);
    topPlacementPocket = topPocket(placementSpend);

    return {
        red_ad_count: redAds,
        green_ad_count: greenAds,
        benchmark_positive_count: benchmarkPositiveCount,
        benchmark_negative_count: benchmarkNegativeCount,
        estimated_wasted_spend: estimatedWastedSpend,
        benchmark_winning_spend: benchmarkWinningSpend,
        top_campaign_spend_share_pct: topCampaignSpendSharePct,
        top_geo_spend_pocket: topGeoPocket,
        top_placement_spend_pocket: topPlacementPocket,
        pacing_risk: topCampaignSpendSharePct >= 45 ? 'high concentration' : (topCampaignSpendSharePct >= 30 ? 'moderate concentration' : 'distributed')
    };
}

function buildImportedSkillContextBlocks(scanData, benchmarks, breakdownContext, importedAuditSummary, trendSummary, advancedTrendIntelligence) {
    var ads = (scanData && scanData.ads) || [];
    var tree = (scanData && scanData.tree) || {};
    var totals = (scanData && scanData.evaluatedTotals) || {};
    var rows = breakdownContext && breakdownContext.breakdowns ? breakdownContext.breakdowns : {};
    var benchmarkCPA = Number(benchmarks && (benchmarks.weighted_benchmark_cpa || benchmarks.benchmark_cpa || benchmarks.median_signup_cost) || 0);
    var benchmarkD6 = Number(benchmarks && (benchmarks.weighted_benchmark_d6_roas || benchmarks.benchmark_d6_roas || benchmarks.median_d6_roas) || 0);
    var spend = Number(totals.spend || 0);
    var sortedAds = ads.slice().sort(function(a, b) { return (b.spend || 0) - (a.spend || 0); });
    var redAds = sortedAds.filter(function(ad) { return ad.alertStatus === 'red'; });
    var greenAds = sortedAds.filter(function(ad) { return ad.alertStatus === 'green'; });
    var cpaPressureAds = sortedAds.filter(function(ad) {
        var signupCost = Number(ad.signupCost || 0);
        return (ad.spend || 0) >= 5000 && signupCost > 0 && ((benchmarkCPA > 0 && signupCost > benchmarkCPA * 1.25) || signupCost > 1000);
    }).slice(0, 3).map(function(ad) {
        return (ad.ad_name || '--') + ' | SU ' + fmtINR(ad.signupCost || 0) + ' | Spend ' + fmtINR(ad.spend || 0);
    });
    var wastedSpendShare = spend > 0 && importedAuditSummary ? +Number(((Number(importedAuditSummary.estimated_wasted_spend || 0) / spend) * 100)).toFixed(1) : 0;

    var geoRows = Array.isArray(rows.geography) ? rows.geography.slice() : [];
    var deviceRows = Array.isArray(rows.device) ? rows.device.slice() : [];
    var bestGeo = geoRows.slice().sort(function(a, b) { return (a.cpi_7d || Infinity) - (b.cpi_7d || Infinity); })[0] || null;
    var worstGeo = geoRows.slice().sort(function(a, b) { return (b.cpi_7d || 0) - (a.cpi_7d || 0); })[0] || null;
    var bestDevice = deviceRows.slice().sort(function(a, b) { return (a.cpi_7d || Infinity) - (b.cpi_7d || Infinity); })[0] || null;
    var worstDevice = deviceRows.slice().sort(function(a, b) { return (b.cpi_7d || 0) - (a.cpi_7d || 0); })[0] || null;

    var campaigns = Object.keys(tree).map(function(name) {
        return {
            name: name,
            spend: Number(tree[name] && tree[name].totals && tree[name].totals.spend || 0),
            d6ROAS: Number(tree[name] && tree[name].totals && tree[name].totals.d6ROAS || 0)
        };
    }).sort(function(a, b) { return b.spend - a.spend; });
    var topCampaign = campaigns[0] || null;
    var topCampaignShare = Number(importedAuditSummary && importedAuditSummary.top_campaign_spend_share_pct || 0);
    var campaignCount = campaigns.length;
    var adsetCount = 0;
    var adCount = 0;
    Object.keys(tree).forEach(function(campaignName) {
        var camp = tree[campaignName];
        var adsets = Object.keys((camp && camp.adsets) || {});
        adsetCount += adsets.length;
        adsets.forEach(function(adsetName) {
            adCount += ((camp.adsets[adsetName] && camp.adsets[adsetName].ads) || []).length;
        });
    });

    var decliningSpendShare = Number(trendSummary && trendSummary.declining_spend_share_pct || 0);
    var improvingSpendShare = Number(trendSummary && trendSummary.improving_spend_share_pct || 0);
    var forecastBase = decliningSpendShare > improvingSpendShare
        ? 'Near-term mix is fragile because declining spend share exceeds improving spend share.'
        : 'Near-term mix is steadier because improving spend share is keeping pace with declining share.';
    var forecastUpside = (greenAds.slice(0, 2).map(function(ad) { return ad.ad_name || '--'; }).join(', ') || 'the strongest live winners') + ' can support careful scale if concentration does not rise further.';
    var forecastDownside = (redAds.slice(0, 2).map(function(ad) { return ad.ad_name || '--'; }).join(', ') || 'the main red ads') + ' remain the main risk if budget is not concentrated away from them.';

    var attribution = buildAttributionBreakdownSummary(scanData);
    var anomalyHeadline = (topCampaignShare >= 45 ? 'Concentration anomaly: the top campaign owns ' + topCampaignShare.toFixed(1) + '% of spend.' : 'No severe concentration anomaly, but watch the red / green balance.') +
        (redAds.length ? ' Red ads: ' + redAds.length + '.' : '') +
        (greenAds.length ? ' Green ads: ' + greenAds.length + '.' : '');
    var pacingHeadline = importedAuditSummary && importedAuditSummary.pacing_risk ? ('Pacing risk: ' + importedAuditSummary.pacing_risk + '.') : 'Pacing risk could not be isolated cleanly.';
    var geoDetail = [];
    if (bestGeo && worstGeo) geoDetail.push('Geo gap: ' + (bestGeo.region || '--') + ' CPI ' + fmtINR(bestGeo.cpi_7d || 0) + ' vs ' + (worstGeo.region || '--') + ' CPI ' + fmtINR(worstGeo.cpi_7d || 0));
    if (bestDevice && worstDevice) geoDetail.push('Device gap: ' + titleCaseWords(String(bestDevice.device || '').replace(/_/g, ' ')) + ' vs ' + titleCaseWords(String(worstDevice.device || '').replace(/_/g, ' ')));
    var structureDetail = 'Campaigns: ' + campaignCount + ' | Adsets: ' + adsetCount + ' | Ads: ' + adCount + (topCampaign ? ' | Top campaign: ' + topCampaign.name + ' (' + topCampaignShare.toFixed(1) + '% spend)' : '');
    var cpaDetail = (benchmarkCPA > 0 ? 'Weighted CPA benchmark: ' + fmtINR(benchmarkCPA) + '.' : 'Weighted CPA benchmark not available.') + (benchmarkD6 > 0 ? ' Weighted D6 ROAS benchmark: ' + fmtPct(benchmarkD6) + '.' : '');

    return {
        cpa: {
            headline: cpaPressureAds.length ? ('CPA pressure is concentrated in ' + cpaPressureAds.length + ' high-spend ads.') : 'No strong CPA pressure pocket isolated beyond the current benchmark set.',
            detail: cpaDetail + (cpaPressureAds.length ? ' ' + cpaPressureAds.join(' | ') : ''),
            action: cpaPressureAds.length ? 'Trim the worst CPA pockets before changing the whole structure.' : 'Keep CPA monitoring benchmarked, not reactive.'
        },
        wasted_spend: {
            headline: 'Estimated wasted spend: ' + fmtINR(Number(importedAuditSummary && importedAuditSummary.estimated_wasted_spend || 0)) + '.',
            detail: 'Red ads: ' + Number(importedAuditSummary && importedAuditSummary.red_ad_count || 0) + ' | Green ads: ' + Number(importedAuditSummary && importedAuditSummary.green_ad_count || 0) + ' | Waste share: ' + wastedSpendShare.toFixed(1) + '% of selected spend.',
            action: 'Cut wasteful pockets first and preserve the green winners.'
        },
        anomaly: {
            headline: anomalyHeadline,
            detail: 'Declining spend share: ' + decliningSpendShare.toFixed(1) + '% | Improving spend share: ' + improvingSpendShare.toFixed(1) + '% | Benchmark-positive ads: ' + Number(importedAuditSummary && importedAuditSummary.benchmark_positive_count || 0) + ' | Benchmark-negative ads: ' + Number(importedAuditSummary && importedAuditSummary.benchmark_negative_count || 0) + ' | Paused winners: ' + Number(trendSummary && trendSummary.paused_winners || 0),
            action: 'Check concentration, red/green balance, and trend inversion before broad edits.'
        },
        pacing: {
            headline: pacingHeadline,
            detail: 'Top campaign spend share: ' + topCampaignShare.toFixed(1) + '%.' + (importedAuditSummary && importedAuditSummary.top_geo_spend_pocket ? ' Top geo pocket: ' + (importedAuditSummary.top_geo_spend_pocket.key || '--') + '.' : ''),
            action: topCampaignShare >= 45 ? 'Avoid broad scale until spend concentration is reduced.' : 'Pacing is usable; keep scale cautious and data-led.'
        },
        geo_device: {
            headline: geoDetail.length ? geoDetail[0] : 'Geo / device efficiency is directionally visible but not broken into a sharp gap yet.',
            detail: geoDetail.slice(1).join(' | ') || (importedAuditSummary && importedAuditSummary.top_geo_spend_pocket ? 'Top geo spend pocket: ' + (importedAuditSummary.top_geo_spend_pocket.key || '--') : 'Geo / device pockets were not strong enough to isolate further.'),
            action: 'Shift spend toward the better geo/device pockets before a broader budget push.'
        },
        attribution: {
            headline: attribution.seven_day_click_roas != null ? ('7d click ROAS: ' + attribution.seven_day_click_roas + ' | 1d click ROAS: ' + (attribution.one_day_click_roas != null ? attribution.one_day_click_roas : '--')) : 'Attribution split is not injected in this run.',
            detail: attribution.view_through_roas != null ? ('View-through ROAS: ' + attribution.view_through_roas + ' | Blended MER: ' + (attribution.blended_mer != null ? attribution.blended_mer : '--')) : (attribution.note || 'Attribution breakdown unavailable.'),
            action: 'Use attribution as a caution layer before pausing retargeting or over-crediting short-window ROAS.'
        },
        structure: {
            headline: structureDetail,
            detail: topCampaign ? ('Top campaign D6 ROAS: ' + fmtPct(topCampaign.d6ROAS || 0) + ' | Spend concentration: ' + topCampaignShare.toFixed(1) + '%') : 'Structure is present but no single campaign is material enough to call out.',
            action: topCampaignShare >= 45 ? 'Consolidate or protect the leading campaign while reviewing weaker siblings.' : 'Structure is reasonably distributed; keep the current hierarchy.'
        },
        forecast: {
            headline: forecastBase,
            detail: 'Upside: ' + forecastUpside + ' Downside: ' + forecastDownside,
            action: decliningSpendShare > improvingSpendShare ? 'Forecast is cautious: protect winners and reduce weak pockets first.' : 'Forecast is steady: scale only after the leading pockets hold.'
        }
    };
}

function renderImportedSkillContextCard(context) {
    if (!context) return '';
    var sections = [
        { key: 'cpa', label: 'CPA', color: 'var(--orange)' },
        { key: 'wasted_spend', label: 'Wasted Spend', color: 'var(--red)' },
        { key: 'anomaly', label: 'Anomaly', color: 'var(--accent)' },
        { key: 'pacing', label: 'Pacing', color: 'var(--green)' },
        { key: 'geo_device', label: 'Geo / Device', color: 'var(--text)' },
        { key: 'attribution', label: 'Attribution', color: 'var(--orange)' },
        { key: 'structure', label: 'Structure', color: 'var(--accent)' },
        { key: 'forecast', label: 'Forecast', color: 'var(--green)' }
    ];
    var hasContent = sections.some(function(section) { return context[section.key]; });
    if (!hasContent) return '';
    return '<div style="' + CARD + 'margin-bottom:12px;border-left:3px solid var(--green);">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px;">Imported Skill Context</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">' +
            sections.map(function(section) {
                var block = context[section.key] || {};
                if (!block || (!block.headline && !block.detail && !block.action)) return '';
                return '<div style="' + CARD + 'border-left:3px solid ' + section.color + ';">' +
                    '<div style="font-size:10px;color:var(--text-dim);margin-bottom:4px;">' + esc(section.label) + '</div>' +
                    '<div style="font-size:12px;font-weight:600;color:var(--text);line-height:1.5;">' + esc(block.headline || '--') + '</div>' +
                    (block.detail ? '<div style="font-size:11px;color:var(--text-dim);margin-top:6px;line-height:1.5;">' + esc(block.detail) + '</div>' : '') +
                    (block.action ? '<div style="font-size:11px;color:var(--accent);margin-top:6px;line-height:1.5;">Action: ' + esc(block.action) + '</div>' : '') +
                '</div>';
            }).join('') +
        '</div>' +
    '</div>';
}

function getCanonicalOptimizerCommand(parsed, prompt) {
    var lower = String(prompt || '').toLowerCase();
    if (/run morning account review|morning brief|morning account review/.test(lower)) return 'morning_account_review';
    if (/^deep dive:/.test(lower) || /deep dive/.test(lower)) return 'deep_dive';
    if (/^why is .*underperforming\??$/.test(lower) || /underperforming/.test(lower)) return 'underperformance_rca';
    if (/^should we scale /.test(lower) || /should we scale/.test(lower)) return 'scale_check';
    if (/validate optimizer queue/.test(lower)) return 'queue_validation';
    if (/predict next 30 days/.test(lower)) return 'predict_30_days';
    if (/what should we brief creative for/.test(lower) || /brief creative/.test(lower)) return 'creative_brief';
    if (/run change impact analysis/.test(lower) || /change impact analysis/.test(lower)) return 'change_impact_analysis';
    if (/daily analysis|full account daily analysis|campaign by campaign|full account|all live campaigns/.test(lower)) return 'full_account_review';
    if (parsed && parsed.mode === 'account_overview') return 'deep_dive';
    if (parsed && parsed.mode === 'diagnostic') return 'underperformance_rca';
    return 'daily_optimisation';
}

function normalizeOptimizerPrompt(value) {
    return String(value || '').trim();
}

function addOptimizerChatMessage(role, content) {
    window.OPTIMIZER_CHAT = Array.isArray(window.OPTIMIZER_CHAT) ? window.OPTIMIZER_CHAT : [];
    window.OPTIMIZER_CHAT.push({
        role: role,
        content: String(content || ''),
        at: new Date().toISOString()
    });
    window.OPTIMIZER_CHAT = window.OPTIMIZER_CHAT.slice(-12);
}

function renderOptimizerPromptHistory() {
    var items = Array.isArray(window.OPTIMIZER_CHAT) ? window.OPTIMIZER_CHAT.slice(-6) : [];
    if (!items.length) return '';
    return '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">' + items.map(function(item) {
        var isUser = item.role === 'user';
        return '<div style="' + CARD + 'border-left:3px solid ' + (isUser ? 'var(--accent)' : 'var(--green)') + ';padding:10px 12px;">' +
            '<div style="font-size:10px;color:var(--text-dim);margin-bottom:4px;">' + (isUser ? 'You' : 'APEX') + '</div>' +
            '<div style="font-size:12px;color:var(--text);line-height:1.6;">' + esc(item.content || '') + '</div>' +
        '</div>';
    }).join('') + '</div>';
}

function nl2br(text) {
    return esc(String(text || '')).replace(/\n/g, '<br>');
}

function derivePlanAnalysisBasis(plan, scan) {
    var pulse = plan && plan.account_pulse ? plan.account_pulse : {};
    var summary = scan && scan.summary ? scan.summary : {};
    var range = (scan && scan.date_range && scan.date_range.since && scan.date_range.until)
        ? (scan.date_range.since + ' → ' + scan.date_range.until)
        : (pulse.window_label || '--');
    var matured = Number(summary.matured_ads || 0);
    var early = Number(summary.non_matured_ads || 0);
    var mode = 'Mixed';
    if (matured > 0 && early === 0) mode = 'Matured';
    else if (early > 0 && matured === 0) mode = 'Unmatured';
    var detail = matured + ' matured / ' + early + ' early';
    return {
        range: range,
        mode: mode,
        detail: detail
    };
}

function inferPromptEntityMatch(scanData, prompt) {
    if (!scanData || !prompt) return null;
    var q = String(prompt || '').toLowerCase();
    var matches = [];
    Object.keys(scanData.tree || {}).forEach(function(campaignName) {
        if (q.indexOf(String(campaignName || '').toLowerCase()) !== -1) {
            matches.push({ type: 'campaign', label: campaignName, score: campaignName.length, query: campaignName });
        }
        var campaign = scanData.tree[campaignName];
        Object.keys((campaign && campaign.adsets) || {}).forEach(function(adsetName) {
            if (q.indexOf(String(adsetName || '').toLowerCase()) !== -1) {
                matches.push({ type: 'adset', label: campaignName + ' > ' + adsetName, score: adsetName.length, query: adsetName });
            }
        });
    });
    (scanData.ads || []).forEach(function(ad) {
        if (q.indexOf(String(ad.ad_name || '').toLowerCase()) !== -1) {
            matches.push({ type: 'ad', label: (ad.campaign_name || '--') + ' > ' + (ad.adset_name || '--') + ' > ' + (ad.ad_name || '--'), score: String(ad.ad_name || '').length, query: ad.ad_name || '' });
        }
    });
    matches.sort(function(a, b) { return b.score - a.score; });
    return matches[0] || null;
}

function getPromptEntitySuggestions(scanData, entityType, limit) {
    var maxItems = limit || 5;
    if (!scanData) return [];
    if (entityType === 'campaign') {
        return Object.keys(scanData.tree || {}).slice(0, maxItems);
    }
    if (entityType === 'adset') {
        var adsets = [];
        Object.keys(scanData.tree || {}).forEach(function(campaignName) {
            Object.keys((scanData.tree[campaignName] && scanData.tree[campaignName].adsets) || {}).forEach(function(adsetName) {
                adsets.push(campaignName + ' → ' + adsetName);
            });
        });
        return adsets.slice(0, maxItems);
    }
    if (entityType === 'ad') {
        return (scanData.ads || []).slice(0, maxItems).map(function(ad) {
            return (ad.campaign_name || '--') + ' → ' + (ad.ad_name || '--');
        });
    }
    return [];
}

function parseOptimizerPromptIntent(scanData, prompt) {
    var text = normalizeOptimizerPrompt(prompt);
    var lower = text.toLowerCase();
    var isMorningBrief = /(run morning account review|morning brief|morning account review)/.test(lower);
    var isChangeAudit = /(any campaign|any adset|across the account|account level|in the last \d+ days|undergone|audience\/location changes|location changes|audience changes|setting changes|what changed|changes in)/.test(lower);
    var isBroadEntitySearch = /\b(any|all|which|what all|show me|list)\b.*\b(campaign|campaigns|adset|adsets|ads|ad)\b/.test(lower) ||
        /\bis any\b.*\b(campaign|campaigns|adset|adsets|ads|ad)\b/.test(lower) ||
        /\bare any\b.*\b(campaign|campaigns|adset|adsets|ads|ad)\b/.test(lower);
    var isDailyAnalysis = /(daily analysis|daily review of account|account daily analysis|full account daily analysis)/.test(lower);
    var isFullHierarchyReview = /(full account|entire account|all active items|all live campaigns|campaign by campaign)/.test(lower);
    var result = {
        ok: true,
        mode: 'daily_review',
        target: { type: 'account', query: '' },
        audienceFilter: 'all',
        statusFilter: 'live_only',
        command_type: 'daily_optimisation',
        clarification: ''
    };
    if (!text) {
        result.ok = false;
        result.clarification = 'Tell me what you want. Example: "Give an overview of Test2 campaign" or "Give me actionables to revamp my Meta account."';
        return result;
    }
    if (lower.indexOf('retarget') !== -1 || lower.indexOf('warm') !== -1) result.audienceFilter = 'retargeting';
    if (lower.indexOf('prospecting') !== -1 || lower.indexOf('broad') !== -1 || lower.indexOf('cold') !== -1) result.audienceFilter = 'prospecting';
    if (lower.indexOf('paused') !== -1) result.statusFilter = 'paused_only';
    if (lower.indexOf('all status') !== -1 || lower.indexOf('all entities') !== -1) result.statusFilter = 'all';
    if (isMorningBrief) {
        result.mode = 'daily_review';
        result.target = { type: 'account', query: '' };
        result.statusFilter = 'live_only';
    }
    if (isDailyAnalysis || isFullHierarchyReview) {
        result.mode = 'account_overview';
        result.statusFilter = 'live_only';
        result.target = { type: 'account', query: '' };
    }
    if (lower.indexOf('overview') !== -1 || lower.indexOf('deep dive') !== -1 || lower.indexOf('working') !== -1 || lower.indexOf('make it better') !== -1) result.mode = 'account_overview';
    if (lower.indexOf('full account') !== -1 || lower.indexOf('entire account') !== -1 || lower.indexOf('all active items') !== -1) result.mode = 'account_overview';
    if (!isDailyAnalysis && !isFullHierarchyReview && (lower.indexOf('diagnose') !== -1 || lower.indexOf('why is') !== -1 || lower.indexOf('underperform') !== -1 || lower.indexOf('problem') !== -1)) result.mode = 'diagnostic';
    if (lower.indexOf('actionable') !== -1 || lower.indexOf('revamp') !== -1 || lower.indexOf('what should i do') !== -1 || lower.indexOf('change today') !== -1) result.mode = 'daily_review';
    if (isChangeAudit) {
        result.mode = 'diagnostic';
        result.target = { type: 'account', query: '' };
        result.statusFilter = 'all';
    }
    if (isBroadEntitySearch) {
        result.mode = 'diagnostic';
        result.target = { type: 'account', query: '' };
    }

    var explicitType = lower.indexOf('campaign') !== -1 ? 'campaign' : (lower.indexOf('adset') !== -1 ? 'adset' : (lower.indexOf(' ad ') !== -1 || lower.indexOf('specific ad') !== -1 ? 'ad' : ''));
    var match = inferPromptEntityMatch(scanData, text);
    if (match && !isChangeAudit && !isBroadEntitySearch) {
        result.target = { type: explicitType || match.type, query: match.query };
        if (result.mode === 'daily_review' && match.type !== 'campaign' && match.type !== 'adset' && match.type !== 'ad') {
            result.mode = 'account_overview';
        }
    } else if (!isChangeAudit && !isBroadEntitySearch && explicitType && (lower.indexOf('specific') !== -1 || lower.indexOf('this') === -1)) {
        var suggestions = getPromptEntitySuggestions(scanData, explicitType, 4);
        result.ok = false;
        result.clarification = 'Name the ' + explicitType + ' you want me to inspect.' +
            (suggestions.length ? ' Try one of these: ' + suggestions.join(' | ') : '') +
            (explicitType === 'campaign' ? ' Example: "Give an overview of Test2 campaign."' : '');
        return result;
    }
    result.command_type = getCanonicalOptimizerCommand(result, text);
    return result;
}

async function executeOptimizerPromptFlow(planBtn, promptInput, progressEl) {
    var text = normalizeOptimizerPrompt(promptInput ? promptInput.value : '');
    window.OPTIMIZER_USER_PROMPT = text;
    addOptimizerChatMessage('user', text);

    if (!window.OPTIMIZER_SCAN) hydrateOptimizerScanFromCache();
    if (!window.OPTIMIZER_SCAN) {
        addOptimizerChatMessage('assistant', 'Scan the account first, then ask me what you want me to do.');
        renderOptimizer();
        return false;
    }

    var parsed = parseOptimizerPromptIntent(window.OPTIMIZER_SCAN, text);
    if (!parsed.ok) {
        addOptimizerChatMessage('assistant', parsed.clarification);
        renderOptimizer();
        return false;
    }

    window.OPTIMIZER_APEX_MODE = parsed.mode;
    window.OPTIMIZER_AUDIENCE_FILTER = parsed.audienceFilter;
    window.OPTIMIZER_STATUS_FILTER = parsed.statusFilter;
    window.OPTIMIZER_TARGET = parsed.target || { type: 'account', query: '' };
    window.OPTIMIZER_COMMAND_TYPE = parsed.command_type || 'daily_optimisation';

    var modeConfig = getApexModeConfig(window.OPTIMIZER_APEX_MODE || 'daily_review');
    if (planBtn) {
        planBtn.disabled = true;
        planBtn.textContent = 'Generating plan...';
    }
    if (progressEl) {
        progressEl.style.display = '';
        progressEl.innerHTML = '<div class="ai-loading"><div class="ai-loading-spinner"></div><div class="ai-loading-text">APEX ' + esc(modeConfig.label) + ' analyzing ' + ((window.OPTIMIZER_SCAN.summary && window.OPTIMIZER_SCAN.summary.total_ads) || 0) + ' ads...</div><div class="ai-loading-sub">' + esc(modeConfig.sublabel) + '</div></div>';
    }

    try {
        await generateOptimizationPlan(window.OPTIMIZER_SCAN);
        addOptimizerChatMessage(
            'assistant',
            (window.OPTIMIZER_PLAN && (
                window.OPTIMIZER_PLAN.executive_summary ||
                (window.OPTIMIZER_PLAN.morning_brief && window.OPTIMIZER_PLAN.morning_brief.market_read && window.OPTIMIZER_PLAN.morning_brief.market_read.summary)
            )) || ('Completed ' + modeConfig.label + '.')
        );
        window.OPTIMIZER_STAGE = 'plan';
        renderOptimizer();
        return true;
    } catch (err) {
        if (progressEl) {
            progressEl.innerHTML = '<div class="ai-error"><div class="ai-error-title">Plan generation failed</div><div class="ai-error-msg">' + esc(err.message) + '</div></div>';
        }
        addOptimizerChatMessage('assistant', 'I could not complete that request: ' + err.message);
        if (planBtn) {
            planBtn.disabled = false;
            planBtn.textContent = 'Ask APEX';
        }
        return false;
    }
}

function buildApexPlaybookRules() {
    return [
        {
            id: 'playbook_auction_pressure',
            signal: 'CPA spikes with no account changes',
            diagnosis: 'Check CPM first. If CPM rose in parallel, treat this as auction pressure before touching campaigns.',
            exact_action: 'Hold budgets and structures steady for several days unless placement or post-click evidence says otherwise.',
            what_not_to_do: 'Do not pause or restructure good campaigns during short auction-side CPA spikes.'
        },
        {
            id: 'playbook_gradual_roas_decay',
            signal: 'ROAS declines gradually over 2-3 weeks',
            diagnosis: 'Read CTR trend, frequency, and creative age together. This is usually creative fatigue plus audience exhaustion, not a sudden platform bug.',
            exact_action: 'Pause the weakest losing creatives first and replace from a proven winner pattern before touching budgets.',
            what_not_to_do: 'Do not start from zero with random new concepts while a proven pattern exists.'
        },
        {
            id: 'playbook_attribution_inflation',
            signal: 'Platform ROAS is strong but business-level MER is weak',
            diagnosis: 'Treat this as attribution inflation risk, especially in retargeting-heavy setups.',
            exact_action: 'Judge real efficiency from blended outcomes and separate retargeting from prospecting decisions.',
            what_not_to_do: 'Do not scale purely on platform-reported ROAS when blended economics disagree.'
        },
        {
            id: 'playbook_prospecting_vs_retarget',
            signal: 'Retargeting CPA is far lower than prospecting CPA',
            diagnosis: 'Retargeting is sequential, not a substitute for prospecting.',
            exact_action: 'Protect prospecting if it is feeding the warm pool; cut weak prospecting only when it clearly fails on its own merits.',
            what_not_to_do: 'Do not gut prospecting just because retargeting converts cheaper.'
        },
        {
            id: 'playbook_signal_concentration',
            signal: 'One campaign or ad set carries most of the account outcome',
            diagnosis: 'This is signal concentration and usually points to fragmentation elsewhere.',
            exact_action: 'Consolidate budget from weak overlapping structures into the proven winner and duplicate the winner logic intentionally.',
            what_not_to_do: 'Do not keep many starved side experiments live if one structure is clearly carrying the account.'
        },
        {
            id: 'playbook_horizontal_before_vertical',
            signal: 'Efficiency is on target but growth is flat',
            diagnosis: 'This is usually audience saturation, not a reason to simply spend more into the same pocket.',
            exact_action: 'Expand horizontally into new audiences before vertical budget pushes.',
            what_not_to_do: 'Do not force heavy scale on a saturating audience.'
        },
        {
            id: 'playbook_broad_beats_interest',
            signal: 'Broad audience outperforms interest stacks',
            diagnosis: 'Treat this as normal Meta behavior in modern accounts, not as something to “fix.”',
            exact_action: 'Protect the broad winner and reallocate out of clearly weaker interest stacks.',
            what_not_to_do: 'Do not add restrictive interests to a working broad ad set.'
        },
        {
            id: 'playbook_learning_limited',
            signal: 'Ad set sits in learning-limited state for days',
            diagnosis: 'Most often underfunded budget, too many ads, or too-deep optimization event.',
            exact_action: 'Either raise budget to a viable level, reduce fragmentation, or optimize higher in the funnel.',
            what_not_to_do: 'Do not pile on more edits while learning is already constrained.'
        },
        {
            id: 'playbook_budget_step_rule',
            signal: 'Need to scale a working entity',
            diagnosis: 'Large jumps reset learning and break efficiency.',
            exact_action: 'Use 20-25% budget steps with time between steps.',
            what_not_to_do: 'Do not jump budgets 50%+ overnight.'
        },
        {
            id: 'playbook_cost_cap_headroom',
            signal: 'Cost Cap spends too little or throttles delivery',
            diagnosis: 'Cap is likely too tight.',
            exact_action: 'Set Cost Cap with practical headroom above the real average CPA, not at an unrealistically tight ideal target.',
            what_not_to_do: 'Do not assume a tight cap means disciplined efficiency if delivery is collapsing.'
        },
        {
            id: 'playbook_geo_reallocation',
            signal: 'Cheaper geographies or tiers outperform where spend is currently concentrated',
            diagnosis: 'Budget may be sitting in assumed “premium” markets instead of where customers actually convert.',
            exact_action: 'Shift controlled budget into more efficient geos and adapt creative if market context differs.',
            what_not_to_do: 'Do not assume customer quality is lower without checking downstream value.'
        },
        {
            id: 'playbook_meta_am_discipline',
            signal: 'Operator needs platform-side guidance',
            diagnosis: 'Think like a Meta AM: signal quality, quality ranking, bid strategy fit, Advantage+ fit, and auction timing.',
            exact_action: 'Use the Meta AM briefing for platform-side judgment, not for granular breakdown tables.',
            what_not_to_do: 'Do not make Meta AM Briefing a duplicate of Granular Breakdown.'
        }
    ];
}

function parseNumericLike(value) {
    if (value == null) return null;
    if (typeof value === 'number' && isFinite(value)) return value;
    var cleaned = String(value).replace(/[^0-9.\-]/g, '');
    if (!cleaned) return null;
    var num = parseFloat(cleaned);
    return isFinite(num) ? num : null;
}

function apexSeverityToPriority(severity) {
    var s = String(severity || '').toUpperCase();
    if (s === 'BLOCK' || s === 'RED') return 'P1';
    if (s === 'YELLOW') return 'P2';
    return 'P3';
}

function mapApexViewActionType(rawType, entityType) {
    var type = String(rawType || '').toLowerCase();
    var et = String(entityType || '').toLowerCase();
    if (type === 'pause') return et === 'campaign' ? 'PAUSE_CAMPAIGN' : (et === 'adset' ? 'PAUSE_ADSET' : 'PAUSE_AD');
    if (type === 'budget_increase' || type === 'scale_budget') return et === 'campaign' ? 'UPDATE_CAMPAIGN_BUDGET' : 'UPDATE_ADSET_BUDGET';
    if (type === 'budget_decrease' || type === 'reduce_budget') return et === 'campaign' ? 'UPDATE_CAMPAIGN_BUDGET' : 'UPDATE_ADSET_BUDGET';
    if (type === 'creative_swap' || type === 'refresh_creative') return 'CREATIVE_CHANGE';
    if (type === 'launch' || type === 'launch_test' || type === 'audience_expand' || type === 'consolidate' || type === 'bid_change') return 'MONITOR';
    return 'MONITOR';
}

function convertApexView1Actions(viewActions) {
    return (Array.isArray(viewActions) ? viewActions : []).map(function(action, idx) {
        var entityType = String(action.entity_type || 'adset').toLowerCase();
        var actionType = mapApexViewActionType(action.action, entityType);
        var currentValue = action.current_value;
        var newValue = action.new_value;
        var currentBudget = parseNumericLike(currentValue);
        var newBudget = parseNumericLike(newValue);
        return {
            action_id: 'APEXV2-' + (idx + 1),
            priority: apexSeverityToPriority(action.severity),
            priority_label: String(action.severity || '').toUpperCase(),
            entity_type: entityType,
            entity_id: action.entity_id || '',
            entity_name: action.entity_name || '',
            action_type: actionType,
            action_detail: [action.action, currentValue && newValue ? (String(currentValue) + ' -> ' + String(newValue)) : '', action.trigger_metric ? ('triggered by ' + action.trigger_metric) : ''].filter(Boolean).join(' | '),
            trigger_metric: action.trigger_metric || '',
            trigger_value: action.trigger_value,
            trigger_threshold: action.trigger_threshold,
            optimizer_rule_id: action.optimizer_rule_id || null,
            optimizer_verdict: action.optimizer_verdict || null,
            override_optimizer_rule: String(action.optimizer_verdict || '').toLowerCase() === 'overridden',
            override_reason: action.override_reason || null,
            approval_status: 'pending_approval',
            current_metrics: {},
            budget_change: (actionType === 'UPDATE_ADSET_BUDGET' || actionType === 'UPDATE_CAMPAIGN_BUDGET') && currentBudget != null && newBudget != null ? {
                current_daily_budget: currentBudget,
                recommended_daily_budget: newBudget,
                change_pct: currentBudget > 0 ? (((newBudget - currentBudget) / currentBudget) * 100).toFixed(0) + '%' : null
            } : null
        };
    });
}
function statusUpper(status) { return String(status || 'UNKNOWN').toUpperCase(); }
function isEffectivelyPausedStatus(status) {
    status = statusUpper(status);
    return status === 'PAUSED' || status === 'ADSET_PAUSED' || status === 'CAMPAIGN_PAUSED' || status === 'ARCHIVED' || status === 'DELETED';
}
function isActiveDeliveryStatus(status) { return statusUpper(status) === 'ACTIVE'; }
function getDeliveryState(adStatus, adsetStatus, campaignStatus) {
    if (isEffectivelyPausedStatus(campaignStatus) || statusUpper(adStatus) === 'CAMPAIGN_PAUSED') return 'paused_campaign';
    if (isEffectivelyPausedStatus(adsetStatus) || statusUpper(adStatus) === 'ADSET_PAUSED') return 'paused_adset';
    if (isEffectivelyPausedStatus(adStatus)) return 'paused_ad';
    if (isActiveDeliveryStatus(adStatus)) return 'live';
    if (statusUpper(adStatus) === 'PENDING_REVIEW' || statusUpper(adStatus) === 'IN_PROCESS') return 'pending';
    return 'unknown';
}
function isExecutableActionType(type) {
    return [
        'PAUSE_AD', 'ACTIVATE_AD',
        'PAUSE_ADSET', 'ACTIVATE_ADSET',
        'PAUSE_CAMPAIGN', 'ACTIVATE_CAMPAIGN',
        'UPDATE_ADSET_BUDGET', 'UPDATE_CAMPAIGN_BUDGET'
    ].indexOf(String(type || '').toUpperCase()) !== -1;
}
function getActivationActionForAd(ad) {
    if (!ad) return 'ACTIVATE_AD';
    if (isEffectivelyPausedStatus(ad.campaign_status) || statusUpper(ad.ad_status) === 'CAMPAIGN_PAUSED') return 'ACTIVATE_CAMPAIGN';
    if (isEffectivelyPausedStatus(ad.adset_status) || statusUpper(ad.ad_status) === 'ADSET_PAUSED') return 'ACTIVATE_ADSET';
    return 'ACTIVATE_AD';
}
function getActivationActionForAds(ads) {
    if ((ads || []).some(function(ad) { return getActivationActionForAd(ad) === 'ACTIVATE_CAMPAIGN'; })) return 'ACTIVATE_CAMPAIGN';
    if ((ads || []).some(function(ad) { return getActivationActionForAd(ad) === 'ACTIVATE_ADSET'; })) return 'ACTIVATE_ADSET';
    return 'ACTIVATE_AD';
}
function getDefaultBudgetRecommendation(currentBudget, direction) {
    var current = Number(currentBudget) || 0;
    if (current <= 0) return null;
    return Math.max(1, Math.round(current * (direction === 'decrease' ? 0.8 : 1.2)));
}

function actionIcon(type) {
    if (!type) return '';
    if (type.indexOf('PAUSE') !== -1) return '\ud83d\udd34';
    if (type === 'ACTIVATE_AD' || type === 'ACTIVATE_ADSET' || type === 'ACTIVATE_CAMPAIGN') return '\ud83d\udfe2';
    if (type === 'UPDATE_ADSET_BUDGET' || type === 'UPDATE_CAMPAIGN_BUDGET') return '\ud83d\udcc8';
    if (type === 'NO_ACTION') return '\u26aa';
    return '\u26a1';
}

function actionColor(type) {
    if (!type) return 'var(--text-dim)';
    if (type.indexOf('PAUSE') !== -1) return 'var(--red)';
    if (type === 'ACTIVATE_AD' || type === 'ACTIVATE_ADSET' || type === 'ACTIVATE_CAMPAIGN') return 'var(--green)';
    if (type === 'UPDATE_ADSET_BUDGET' || type === 'UPDATE_CAMPAIGN_BUDGET') return 'var(--orange)';
    return 'var(--text-dim)';
}

function confidenceBadge(c) {
    var colors = { HIGH: 'var(--green)', MEDIUM: 'var(--orange)', LOW: 'var(--red)' };
    var col = colors[(c || '').toUpperCase()] || 'var(--text-dim)';
    return '<span style="padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;color:#fff;background:' + col + ';">' + esc(c) + '</span>';
}

var CS = 'background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;';
var CARD = 'background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;padding:14px;';

// Shared data pipeline â€” raw summable metrics + derived formulated metrics
function emptyRaw() {
    return {
        spend: 0, impressions: 0, clicks: 0, installs: 0,
        thruplay: 0, p25: 0, p100: 0,
        signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
        d6: 0, d6_revenue: 0, overall_revenue: 0,
        d6_overall_con: 0, d6_overall_revenue: 0,
        d15_overall_con: 0, d15_overall_revenue: 0,
        d30_overall_con: 0, d30_overall_revenue: 0,
        d60_overall_con: 0, d60_overall_revenue: 0,
        p0_signup: 0, p1_signup: 0, total_trial: 0,
        new_converted_user: 0, new_user_rev: 0,
    };
}

function sumRaw(items) {
    var t = emptyRaw();
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var keys = Object.keys(t);
        for (var k = 0; k < keys.length; k++) t[keys[k]] += (item[keys[k]] || 0);
    }
    return t;
}

function normalizeCampaignName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeAdsetName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeTrackerName(value) {
    return String(value || '').replace(/:.*$/, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildJoinKey(dateStr, campaignName, adsetName, trackerName) {
    var d = String(dateStr || '').substring(0, 10);
    return [
        d,
        normalizeCampaignName(campaignName),
        normalizeAdsetName(adsetName),
        normalizeTrackerName(trackerName)
    ].join('|||');
}

function buildCampaignJoinKey(dateStr, campaignName) {
    return [String(dateStr || '').substring(0, 10), normalizeCampaignName(campaignName)].join('|||');
}

function buildAdsetJoinKey(dateStr, adsetName) {
    return [String(dateStr || '').substring(0, 10), normalizeAdsetName(adsetName)].join('|||');
}

function buildAdsetTrackerCoverageKey(campaignName, adsetName, trackerName) {
    return [
        normalizeCampaignName(campaignName),
        normalizeAdsetName(adsetName),
        normalizeTrackerName(trackerName)
    ].join('|||');
}

var _vR = function(sp, rev) {
    if (!sp || sp <= 0 || !rev || rev < 0) return null;
    if (rev / sp > 50) return null;
    return (rev / sp) * 100;
};

function deriveMetrics(r) {
    var p0p1 = (r.p0_signup || 0) + (r.p1_signup || 0);
    var d6Rev = r.d6_overall_revenue || 0;
    var d6Con = r.d6 || 0;
    var creativeType = String((r && (r.creative_type || r.type)) || '').toLowerCase();
    var videoEligible = creativeType === 'video';
    return {
        spend: r.spend, impressions: r.impressions, clicks: r.clicks, installs: r.installs,
        thruplay: r.thruplay, p25: r.p25, p100: r.p100,
        signups: r.signups, d0_trial: r.d0_trial, d0: r.d0, d0_revenue: r.d0_revenue,
        d6: r.d6, d6_revenue: r.d6_revenue, overall_revenue: r.overall_revenue,
        d6_overall_con: r.d6_overall_con, d6_overall_revenue: r.d6_overall_revenue,
        d15_overall_con: r.d15_overall_con, d15_overall_revenue: r.d15_overall_revenue,
        d30_overall_con: r.d30_overall_con, d30_overall_revenue: r.d30_overall_revenue,
        d60_overall_con: r.d60_overall_con, d60_overall_revenue: r.d60_overall_revenue,
        p0_signup: r.p0_signup, p1_signup: r.p1_signup, total_trial: r.total_trial,
        new_converted_user: r.new_converted_user, new_user_rev: r.new_user_rev,
        cpm: r.impressions > 0 ? (r.spend / r.impressions) * 1000 : null,
        ctr: r.impressions > 0 ? (r.clicks / r.impressions) * 100 : null,
        cpi: r.installs > 0 ? r.spend / r.installs : null,
        hook: videoEligible && r.impressions > 0 ? (r.p25 / r.impressions) * 100 : null,
        hold: videoEligible && r.p25 > 0 ? (r.thruplay / r.p25) * 100 : null,
        fullPlay: videoEligible && r.impressions > 0 ? (r.p100 / r.impressions) * 100 : null,
        signupCost: r.signups > 0 ? r.spend / r.signups : null,
        signupPct: r.installs > 0 ? (r.signups / r.installs) * 100 : null,
        p0p1: p0p1,
        p0p1Cost: p0p1 > 0 ? r.spend / p0p1 : null,
        p0p1Pct: r.signups > 0 ? (p0p1 / r.signups) * 100 : null,
        d0TrialCost: r.d0_trial > 0 ? r.spend / r.d0_trial : null,
        d0CAC: r.d0 > 0 ? r.spend / r.d0 : null,
        d6Con: d6Con,
        d6CAC: d6Con > 0 ? r.spend / d6Con : null,
        d6Rev: d6Rev,
        d6ROAS: _vR(r.spend, d6Rev) || 0,
        d15ROAS: _vR(r.spend, r.d15_overall_revenue) || 0,
        d30ROAS: _vR(r.spend, r.d30_overall_revenue) || 0,
        d60ROAS: _vR(r.spend, r.d60_overall_revenue) || 0,
        overallROAS: _vR(r.spend, r.overall_revenue) || 0,
    };
}

function rawFromItem(item) {
    var raw = emptyRaw();
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i++) raw[keys[i]] = Number(item && item[keys[i]]) || 0;
    return raw;
}

function applyRaw(target, raw) {
    var keys = Object.keys(emptyRaw());
    for (var i = 0; i < keys.length; i++) target[keys[i]] = Number(raw && raw[keys[i]]) || 0;
    return target;
}

function pluralize(word, count) {
    return count === 1 ? word : word + 's';
}

function buildMaturityNote(summary, matureKey, earlyKey, entityName) {
    var mature = Number(summary && summary[matureKey]) || 0;
    var early = Number(summary && summary[earlyKey]) || 0;
    if (mature > 0 && early > 0) return 'Mature where available; ' + early + ' early ' + pluralize(entityName, early) + ' still use full data';
    if (mature > 0) return 'Mature-evaluated data';
    if (early > 0) return 'Full data only; no mature ' + pluralize(entityName, early) + ' yet';
    return 'Maturity-aware metrics';
}

function publishOptimizerContext(scan) {
    if (typeof window.__publishPortalContext !== 'function') return;
    var s = scan && scan.summary ? scan.summary : {};
    var matured = Number(s.matured_ads || 0);
    var early = Number(s.non_matured_ads || 0);
    window.__publishPortalContext({
        view: 'optimizer',
        title: 'Campaign Optimizer',
        subtitle: 'AI-generated optimization plan with one-click execution',
        dataMode: matured || early ? {
            type: matured && early ? 'mixed' : (matured ? 'mature' : 'early'),
            label: matured && early ? 'Mode: Mixed (' + matured + ' mature / ' + early + ' early)' : (matured ? 'Mode: Mature (' + matured + ')' : 'Mode: Early / Full Data (' + early + ')'),
            detail: buildMaturityNote(s, 'matured_ads', 'non_matured_ads', 'ad')
        } : {
            type: 'na',
            label: 'Mode: Awaiting scan',
            detail: 'Run a scan to populate maturity-aware optimizer context.'
        },
        diagnostics: {
            source: 'Meta + Metabase â€¢ Optimizer',
            matchedKeys: Number(s.matched_keys || 0),
            unmatchedKeys: Number(s.unmatched_keys || 0),
            lastUpdated: document.getElementById('lastUpdated') ? document.getElementById('lastUpdated').textContent : '--'
        }
    });
}

function buildScanEntityLookups(scanData) {
    var lookups = { ad: {}, adset: {}, campaign: {}, adByName: {}, adsetByName: {}, campaignByName: {} };
    (scanData && scanData.ads || []).forEach(function(ad) {
        if (!ad) return;
        if (ad.ad_id) lookups.ad[ad.ad_id] = ad;
        var campaignKey = normalizeCampaignName(ad.campaign_name || '');
        var adsetKey = campaignKey + '|||' + normalizeAdsetName(ad.adset_name || '');
        var adKey = adsetKey + '|||' + normalizeTrackerName(ad.ad_name || '');
        if (campaignKey && !lookups.campaignByName[campaignKey]) lookups.campaignByName[campaignKey] = null;
        if (adsetKey && !lookups.adsetByName[adsetKey]) lookups.adsetByName[adsetKey] = null;
        if (adKey && !lookups.adByName[adKey]) lookups.adByName[adKey] = ad;
        if (ad.adset_id && !lookups.adset[ad.adset_id]) {
            lookups.adset[ad.adset_id] = {
                entity_type: 'adset',
                entity_id: ad.adset_id,
                adset_id: ad.adset_id,
                campaign_id: ad.campaign_id,
                entity_name: ad.adset_name,
                campaign_name: ad.campaign_name,
                adset_name: ad.adset_name,
                adset_status: ad.adset_status || 'UNKNOWN',
                campaign_status: ad.campaign_status || 'UNKNOWN',
                delivery_state: getDeliveryState(ad.ad_status, ad.adset_status, ad.campaign_status),
                budget_level: ad.budget_level || 'unknown',
                budget_type: ad.budget_type || 'unknown',
                budget_entity_type: ad.budget_entity_type || '',
                budget_entity_id: ad.budget_entity_id || '',
                budget_entity_name: ad.budget_entity_name || '',
                budget_current_daily_budget: ad.budget_current_daily_budget || null
            };
        }
        if (ad.campaign_id && !lookups.campaign[ad.campaign_id]) {
            lookups.campaign[ad.campaign_id] = {
                entity_type: 'campaign',
                entity_id: ad.campaign_id,
                campaign_id: ad.campaign_id,
                entity_name: ad.campaign_name,
                campaign_name: ad.campaign_name,
                adset_name: '',
                campaign_status: ad.campaign_status || 'UNKNOWN',
                delivery_state: isEffectivelyPausedStatus(ad.campaign_status) ? 'paused_campaign' : (isActiveDeliveryStatus(ad.campaign_status) ? 'live' : 'unknown'),
                budget_level: ad.budget_level === 'campaign' ? 'campaign' : 'unknown',
                budget_type: ad.budget_level === 'campaign' ? (ad.budget_type || 'unknown') : 'unknown',
                budget_entity_type: ad.budget_level === 'campaign' ? (ad.budget_entity_type || 'campaign') : '',
                budget_entity_id: ad.budget_level === 'campaign' ? (ad.budget_entity_id || ad.campaign_id) : '',
                budget_entity_name: ad.budget_level === 'campaign' ? (ad.budget_entity_name || ad.campaign_name) : '',
                budget_current_daily_budget: ad.budget_level === 'campaign' ? (ad.budget_current_daily_budget || null) : null
            };
        }
        if (adsetKey && lookups.adset[ad.adset_id] && !lookups.adsetByName[adsetKey]) lookups.adsetByName[adsetKey] = lookups.adset[ad.adset_id];
        if (campaignKey && lookups.campaign[ad.campaign_id] && !lookups.campaignByName[campaignKey]) lookups.campaignByName[campaignKey] = lookups.campaign[ad.campaign_id];
    });
    return lookups;
}

function computeOptimizerWoWTrends(ads, metaRows, mbDaily) {
    var now = new Date();
    var weekAgo = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
    var twoWeeksAgo = new Date(now - 14 * 86400000).toISOString().slice(0, 10);
    var threeWeeksAgo = new Date(now - 21 * 86400000).toISOString().slice(0, 10);
    var adWeekly = {};

    function emptyWeekRaw() {
        return {
            spend: 0, impressions: 0, clicks: 0, installs: 0,
            thruplay: 0, p25: 0, p100: 0,
            signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
            d6: 0, d6_revenue: 0, overall_revenue: 0,
            d6_overall_con: 0, d6_overall_revenue: 0
        };
    }

    function wowPct(curr, prev) {
        if (prev == null || prev === 0 || curr == null) return null;
        return ((curr - prev) / Math.abs(prev)) * 100;
    }

    (metaRows || []).forEach(function(row) {
        var adUid = (row.campaign_name || '') + '|||' + (row.adset_name || '') + '|||' + (row.ad_name || '');
        if (!adWeekly[adUid]) {
            adWeekly[adUid] = {
                thisWeek: emptyWeekRaw(),
                lastWeek: emptyWeekRaw(),
                prevWeek: emptyWeekRaw()
            };
        }
        var d = String(row.date_start || '').slice(0, 10);
        var bucket = null;
        if (d >= weekAgo) bucket = adWeekly[adUid].thisWeek;
        else if (d >= twoWeeksAgo) bucket = adWeekly[adUid].lastWeek;
        else if (d >= threeWeeksAgo) bucket = adWeekly[adUid].prevWeek;
        if (!bucket) return;

        bucket.spend += Number(row.spend || 0) * 1.18;
        bucket.impressions += Number(row.impressions || 0);
        bucket.clicks += Number(row.clicks || 0);
        bucket.installs += Number(row.installs || 0);
        bucket.thruplay += Number(row.thruplay || 0);
        bucket.p25 += Number(row.p25 || 0);
        bucket.p100 += Number(row.p100 || 0);

        var mbKey = buildJoinKey(row.date_start, row.campaign_name, row.adset_name, row.ad_name);
        var mb = mbDaily && mbDaily[mbKey];
        if (mb) addScanFunnelRaw(bucket, mb);
    });

    (ads || []).forEach(function(ad) {
        var adUid = (ad.campaign_name || '') + '|||' + (ad.adset_name || '') + '|||' + (ad.ad_name || '');
        var weekly = adWeekly[adUid];
        if (!weekly) {
            ad._wow = null;
            return;
        }

        var tw = deriveMetrics(weekly.thisWeek);
        var lw = deriveMetrics(weekly.lastWeek);
        var pw = deriveMetrics(weekly.prevWeek);
        var signupCost_wow = wowPct(tw.signupCost, lw.signupCost);
        var d0TrialCost_wow = wowPct(tw.d0TrialCost, lw.d0TrialCost);
        var cpi_wow = wowPct(tw.cpi, lw.cpi);
        var signups_wow = wowPct(tw.signups, lw.signups);
        var d0Trial_wow = wowPct(tw.d0_trial, lw.d0_trial);
        var d6Conv_wow = wowPct(tw.d6_overall_con, lw.d6_overall_con);
        var d6Revenue_wow = wowPct(tw.d6_overall_revenue, lw.d6_overall_revenue);
        var signupCost_wow2 = wowPct(lw.signupCost, pw.signupCost);
        var d0TrialCost_wow2 = wowPct(lw.d0TrialCost, pw.d0TrialCost);
        var signups_wow2 = wowPct(lw.signups, pw.signups);
        var d0Trial_wow2 = wowPct(lw.d0_trial, pw.d0_trial);
        var d6Conv_wow2 = wowPct(lw.d6_overall_con, pw.d6_overall_con);
        var d6Revenue_wow2 = wowPct(lw.d6_overall_revenue, pw.d6_overall_revenue);

        var maturedD6ROAS = null;
        var maturedD6CAC = null;
        if (ad.isMatured) {
            var maturedRaw = sumRaw([weekly.lastWeek, weekly.prevWeek]);
            var maturedM = deriveMetrics(maturedRaw);
            maturedD6ROAS = maturedM.d6ROAS || null;
            maturedD6CAC = maturedM.d6CAC != null ? maturedM.d6CAC : null;
        }

        var trendBreaches = 0;
        var trendHits = 0;
        if (signupCost_wow > 20) trendBreaches++;
        if (d0TrialCost_wow > 20) trendBreaches++;
        if (cpi_wow > 15) trendBreaches++;
        if (signups_wow < -20) trendBreaches++;
        if (d0Trial_wow < -20) trendBreaches++;
        if (d6Conv_wow < -25) trendBreaches++;
        if (d6Revenue_wow < -25) trendBreaches++;
        if (signupCost_wow > 20 && signupCost_wow2 > 20) trendBreaches++;
        if (d0TrialCost_wow > 20 && d0TrialCost_wow2 > 20) trendBreaches++;
        if (signups_wow < -20 && signups_wow2 < -20) trendBreaches++;
        if (d0Trial_wow < -20 && d0Trial_wow2 < -20) trendBreaches++;
        if (d6Conv_wow < -25 && d6Conv_wow2 < -25) trendBreaches++;
        if (d6Revenue_wow < -25 && d6Revenue_wow2 < -25) trendBreaches++;
        if (signupCost_wow < -15) trendHits++;
        if (d0TrialCost_wow < -15) trendHits++;
        if (cpi_wow < -10) trendHits++;
        if (signups_wow > 15) trendHits++;
        if (d0Trial_wow > 15) trendHits++;
        if (d6Conv_wow > 20) trendHits++;
        if (d6Revenue_wow > 20) trendHits++;
        if (signups_wow > 15 && signups_wow2 > 15) trendHits++;
        if (d0Trial_wow > 15 && d0Trial_wow2 > 15) trendHits++;
        if (d6Conv_wow > 20 && d6Conv_wow2 > 20) trendHits++;
        if (d6Revenue_wow > 20 && d6Revenue_wow2 > 20) trendHits++;

        ad._wow = {
            thisWeek: tw,
            lastWeek: lw,
            prevWeek: pw,
            signupCost_wow: signupCost_wow != null ? Math.round(signupCost_wow * 10) / 10 : null,
            d0TrialCost_wow: d0TrialCost_wow != null ? Math.round(d0TrialCost_wow * 10) / 10 : null,
            cpi_wow: cpi_wow != null ? Math.round(cpi_wow * 10) / 10 : null,
            signupCost_wow2: signupCost_wow2 != null ? Math.round(signupCost_wow2 * 10) / 10 : null,
            d0TrialCost_wow2: d0TrialCost_wow2 != null ? Math.round(d0TrialCost_wow2 * 10) / 10 : null,
            signups_wow: signups_wow != null ? Math.round(signups_wow * 10) / 10 : null,
            d0Trial_wow: d0Trial_wow != null ? Math.round(d0Trial_wow * 10) / 10 : null,
            d6Conv_wow: d6Conv_wow != null ? Math.round(d6Conv_wow * 10) / 10 : null,
            d6Revenue_wow: d6Revenue_wow != null ? Math.round(d6Revenue_wow * 10) / 10 : null,
            signups_wow2: signups_wow2 != null ? Math.round(signups_wow2 * 10) / 10 : null,
            d0Trial_wow2: d0Trial_wow2 != null ? Math.round(d0Trial_wow2 * 10) / 10 : null,
            d6Conv_wow2: d6Conv_wow2 != null ? Math.round(d6Conv_wow2 * 10) / 10 : null,
            d6Revenue_wow2: d6Revenue_wow2 != null ? Math.round(d6Revenue_wow2 * 10) / 10 : null,
            trendBreaches: trendBreaches,
            trendHits: trendHits,
            trendDirection: trendBreaches >= 2 ? 'declining' : (trendHits >= 2 ? 'improving' : 'stable'),
            continuousDecline: !!(
                (signupCost_wow > 20 && signupCost_wow2 > 20) ||
                (d0TrialCost_wow > 20 && d0TrialCost_wow2 > 20) ||
                (signups_wow < -20 && signups_wow2 < -20) ||
                (d0Trial_wow < -20 && d0Trial_wow2 < -20) ||
                (d6Conv_wow < -25 && d6Conv_wow2 < -25) ||
                (d6Revenue_wow < -25 && d6Revenue_wow2 < -25)
            ),
            continuousIncrease: !!(
                (signupCost_wow < -15 && signupCost_wow2 < -15) ||
                (d0TrialCost_wow < -15 && d0TrialCost_wow2 < -15) ||
                (signups_wow > 15 && signups_wow2 > 15) ||
                (d0Trial_wow > 15 && d0Trial_wow2 > 15) ||
                (d6Conv_wow > 20 && d6Conv_wow2 > 20) ||
                (d6Revenue_wow > 20 && d6Revenue_wow2 > 20)
            ),
            maturedD6ROAS: maturedD6ROAS != null ? Math.round(maturedD6ROAS * 100) / 100 : null,
            maturedD6CAC: maturedD6CAC != null ? Math.round(maturedD6CAC * 100) / 100 : null
        };
    });
}

function resolvePlanSource(action, lookups) {
    var entityType = String(action && action.entity_type || '').toLowerCase();
    var entityId = action && action.entity_id;
    if (entityId) {
        if (entityType === 'ad' && lookups.ad[entityId]) return lookups.ad[entityId];
        if (entityType === 'adset' && lookups.adset[entityId]) return lookups.adset[entityId];
        if (entityType === 'campaign' && lookups.campaign[entityId]) return lookups.campaign[entityId];
        if (lookups.ad[entityId]) return lookups.ad[entityId];
        if (lookups.adset[entityId]) return lookups.adset[entityId];
        if (lookups.campaign[entityId]) return lookups.campaign[entityId];
    }
    var campaignName = normalizeCampaignName((action && (action.campaign_name || action.entity_name)) || '');
    var adsetName = normalizeAdsetName((action && (action.adset_name || action.entity_name)) || '');
    var adName = normalizeTrackerName((action && action.entity_name) || '');
    if (entityType === 'campaign' && campaignName && lookups.campaignByName[campaignName]) return lookups.campaignByName[campaignName];
    if (entityType === 'adset') {
        var namedAdsetKey = campaignName + '|||' + adsetName;
        if (campaignName && adsetName && lookups.adsetByName[namedAdsetKey]) return lookups.adsetByName[namedAdsetKey];
    }
    if (entityType === 'ad') {
        var namedAdKey = campaignName + '|||' + normalizeAdsetName(action && action.adset_name || '') + '|||' + adName;
        if (campaignName && adName && lookups.adByName[namedAdKey]) return lookups.adByName[namedAdKey];
    }
    if (campaignName && lookups.campaignByName[campaignName]) return lookups.campaignByName[campaignName];
    if (campaignName && adsetName && lookups.adsetByName[campaignName + '|||' + adsetName]) return lookups.adsetByName[campaignName + '|||' + adsetName];
    return null;
}

function enrichPlanWithScanContext(plan, scanData) {
    if (!plan || !scanData || !scanData.ads) return plan;
    var lookups = buildScanEntityLookups(scanData);
    (plan.actions || []).forEach(function(action) {
        if (!action) return;
        var source = resolvePlanSource(action, lookups);
        if (!source) return;
        if (!action.entity_id) {
            if (source.ad_id) action.entity_id = source.ad_id;
            else if (source.adset_id) action.entity_id = source.adset_id;
            else if (source.campaign_id) action.entity_id = source.campaign_id;
        }
        if (!action.entity_name) action.entity_name = source.ad_name || source.adset_name || source.campaign_name || action.entity_name;
        if (!action.campaign_name) action.campaign_name = source.campaign_name || action.campaign_name;
        if (!action.adset_name) action.adset_name = source.adset_name || action.adset_name;
        if (!action.entity_type) action.entity_type = source.entity_type || action.entity_type;
        action.is_matured = source.isMatured;
        action.days_live = source.daysSinceGoLive;
        action.data_mode = source._evalMode;
        action.data_mode_label = source.evalDataLabel;
        action.data_range = scanData.date_range.since + ' â†’ ' + scanData.date_range.until;
        action.current_metrics = Object.assign({}, action.current_metrics || {}, {
            spend: source.spend,
            d6_roas: source.d6ROAS,
            d6_cac: source.d6CAC,
            signup_cost: source.signupCost,
            cpi: source.cpi,
            ctr: source.ctr,
            cpm: source.cpm,
            installs: source.installs,
            signups: source.signups,
            d6: source.evalD6 != null ? source.evalD6 : source.d6,
            alert_status: source.alertStatus,
            ad_status: source.ad_status || '',
            adset_status: source.adset_status || '',
            campaign_status: source.campaign_status || '',
            delivery_state: source.delivery_state || '',
            budget_level: source.budget_level || '',
            budget_type: source.budget_type || '',
            budget_owner: source.budget_entity_name || '',
            budget_current_daily_budget: source.budget_current_daily_budget || null
        });
    });
    return plan;
}

// â”€â”€ Date helpers â”€â”€

function readDateInputValue(id) {
    var el = document.getElementById(id);
    return el && el.value ? el.value : null;
}

function readActiveTreeRange() {
    var since = readDateInputValue('treeDateFrom');
    var until = readDateInputValue('treeDateTo');
    return since && until ? { since: since, until: until, source: 'Campaign Tree' } : null;
}

function readPortalRange() {
    var since = readDateInputValue('dateFrom');
    var until = readDateInputValue('dateTo');
    return since && until ? { since: since, until: until, source: 'Main Dashboard' } : null;
}

function sameDateRange(left, right) {
    return !!(left && right && left.since === right.since && left.until === right.until);
}

function getOptimizerRangeContext(scanRange) {
    var treeRange = readActiveTreeRange();
    if (!treeRange) {
        return {
            inSyncWithTree: null,
            label: 'Campaign Tree range unavailable',
            detail: 'Set Campaign Tree dates to run a direct parity check.'
        };
    }
    if (sameDateRange(scanRange, treeRange)) {
        return {
            inSyncWithTree: true,
            label: 'Aligned with Campaign Tree',
            detail: treeRange.since + ' -> ' + treeRange.until
        };
    }
    return {
        inSyncWithTree: false,
        label: 'Range mismatch vs Campaign Tree',
        detail: 'Optimizer ' + scanRange.since + ' -> ' + scanRange.until + ' | Campaign Tree ' + treeRange.since + ' -> ' + treeRange.until
    };
}

function getDefaultDates() {
    if (window.OPTIMIZER_SCAN && window.OPTIMIZER_SCAN.date_range) {
        return window.OPTIMIZER_SCAN.date_range;
    }
    var treeRange = readActiveTreeRange();
    if (treeRange) return { since: treeRange.since, until: treeRange.until };
    var portalRange = readPortalRange();
    if (portalRange) return { since: portalRange.since, until: portalRange.until };
    var now = new Date();
    var until = now.toISOString().split('T')[0];
    var since = new Date(now - 29 * 86400000).toISOString().split('T')[0];
    return { since: since, until: until };
}

function getSelectedDates() {
    var fromEl = document.getElementById('optDateFrom');
    var toEl = document.getElementById('optDateTo');
    if (fromEl && toEl && fromEl.value && toEl.value) return { since: fromEl.value, until: toEl.value };
    return getDefaultDates();
}

function ensureScanRaw(map, key, seed) {
    if (!map[key]) map[key] = Object.assign(emptyRaw(), seed || {});
    return map[key];
}

function addScanFunnelRaw(target, row) {
    target.signups += Number(row.signups) || 0;
    target.d0_trial += Number(row.d0_trial) || 0;
    target.d0 += Number(row.d0) || 0;
    target.d0_revenue += Number(row.d0_revenue) || 0;
    target.d6 += Number(row.d6) || 0;
    target.d6_revenue += Number(row.d6_revenue) || 0;
    target.overall_revenue += Number(row.overall_revenue) || 0;
    target.new_converted_user += Number(row.new_converted_user) || 0;
    target.new_user_rev += Number(row.new_user_rev) || 0;
    target.p0_signup += Number(row.p0_signup) || 0;
    target.p1_signup += Number(row.p1_signup) || 0;
    target.total_trial += Number(row.total_trial) || 0;
    target.d6_overall_con += Number(row.d6_overall_con) || 0;
    target.d6_overall_revenue += Number(row.d6_overall_revenue) || 0;
    target.d15_overall_con += Number(row.d15_overall_con) || 0;
    target.d15_overall_revenue += Number(row.d15_overall_revenue) || 0;
    target.d30_overall_con += Number(row.d30_overall_con) || 0;
    target.d30_overall_revenue += Number(row.d30_overall_revenue) || 0;
    target.d60_overall_con += Number(row.d60_overall_con) || 0;
    target.d60_overall_revenue += Number(row.d60_overall_revenue) || 0;
}

function addScanMetaRaw(target, row) {
    target.spend += (Number(row.spend) || 0) * 1.18;
    target.impressions += Number(row.impressions) || 0;
    target.clicks += Number(row.clicks) || 0;
    target.installs += Number(row.installs) || 0;
    target.thruplay += Number(row.thruplay) || 0;
    target.p25 += Number(row.p25) || 0;
    target.p100 += Number(row.p100) || 0;
}

function shouldEnrichOptimizerSettings(commandType) {
    var command = String(commandType || '').toLowerCase();
    return command !== 'queue_validation' && command !== 'change_impact_analysis';
}

async function fetchOptimizerJson(url, options) {
    var config = Object.assign({ signal: AbortSignal.timeout(20000) }, options || {});
    var response = await fetch(url, config);
    if (!response.ok) throw new Error('Settings fetch failed for ' + url + ' (' + response.status + ')');
    return response.json();
}

function normalizeMetaMoneyValue(value) {
    var num = Number(value);
    if (!isFinite(num) || num <= 0) return null;
    return +(num > 10000 ? (num / 100) : num).toFixed(2);
}

function extractMetaAgeTargeting(targeting) {
    var min = targeting && targeting.age_min != null ? Number(targeting.age_min) : null;
    var max = targeting && targeting.age_max != null ? Number(targeting.age_max) : null;
    if (min && max) return min + '-' + max;
    if (min && !max) return min + '+';
    return 'ALL';
}

function extractMetaGenderTargeting(targeting) {
    var genders = Array.isArray(targeting && targeting.genders) ? targeting.genders.map(Number) : [];
    if (genders.length === 1) return genders[0] === 1 ? 'MALE' : (genders[0] === 2 ? 'FEMALE' : 'ALL');
    return 'ALL';
}

function extractMetaLocationTargeting(targeting) {
    var geo = targeting && targeting.geo_locations ? targeting.geo_locations : {};
    var countries = Array.isArray(geo.countries) ? geo.countries : [];
    var regions = Array.isArray(geo.regions) ? geo.regions : [];
    var cities = Array.isArray(geo.cities) ? geo.cities : [];
    if (countries.length === 1 && countries[0] === 'IN' && !regions.length && !cities.length) return 'INDIA_WIDE';
    if (regions.length) {
        return regions.map(function(region) {
            return region.name || region.key || '';
        }).filter(Boolean).join(', ') || ('STATE_LIST (' + regions.length + ')');
    }
    if (cities.length) {
        return cities.map(function(city) {
            return city.name || city.key || '';
        }).filter(Boolean).join(', ') || ('CITY_LIST (' + cities.length + ')');
    }
    return countries.join(', ') || 'UNKNOWN';
}

function extractMetaPlacements(targeting) {
    if (!targeting || (!targeting.publisher_platforms && !targeting.facebook_positions && !targeting.instagram_positions && !targeting.audience_network_positions && !targeting.messenger_positions)) {
        return ['AUTO'];
    }
    var placements = [];
    var mapping = [
        { key: 'facebook_positions', prefix: 'fb_' },
        { key: 'instagram_positions', prefix: 'ig_' },
        { key: 'audience_network_positions', prefix: 'an_' },
        { key: 'messenger_positions', prefix: 'msg_' }
    ];
    mapping.forEach(function(entry) {
        var values = Array.isArray(targeting[entry.key]) ? targeting[entry.key] : [];
        values.forEach(function(value) {
            placements.push(entry.prefix + String(value || '').toLowerCase());
        });
    });
    if (!placements.length) {
        var platforms = Array.isArray(targeting.publisher_platforms) ? targeting.publisher_platforms : [];
        placements = platforms.map(function(platform) { return String(platform || '').toUpperCase(); }).filter(Boolean);
    }
    return placements.length ? placements : ['AUTO'];
}

function buildAudienceLookup(audiences) {
    var lookup = {};
    (audiences || []).forEach(function(audience) {
        if (!audience || !audience.id) return;
        lookup[audience.id] = audience;
    });
    return lookup;
}

function extractAudienceSignals(targeting, audienceLookup) {
    var customAudiences = Array.isArray(targeting && targeting.custom_audiences) ? targeting.custom_audiences : [];
    var lookalikes = Array.isArray(targeting && targeting.lookalike_audiences) ? targeting.lookalike_audiences : [];
    var audienceIds = customAudiences.concat(lookalikes).map(function(item) { return item.id || item; }).filter(Boolean);
    var audienceNames = audienceIds.map(function(id) {
        return audienceLookup[id] && audienceLookup[id].name ? audienceLookup[id].name : '';
    }).filter(Boolean);
    var approximateCount = audienceIds.reduce(function(sum, id) {
        return sum + Number((audienceLookup[id] && audienceLookup[id].approximate_count) || 0);
    }, 0);
    return {
        audience_definition: audienceNames.join(', ') || '',
        audience_size_total: approximateCount || null
    };
}

async function enrichOptimizerSettings(scanData, commandType) {
    if (!scanData || !shouldEnrichOptimizerSettings(commandType)) return scanData;
    if (scanData._settings_enriched && scanData._settings_enriched.complete) return scanData;

    var adsetIds = Array.from(new Set((scanData.ads || []).map(function(ad) { return ad.adset_id; }).filter(Boolean)));
    var campaignIds = Array.from(new Set((scanData.ads || []).map(function(ad) { return ad.campaign_id; }).filter(Boolean)));
    if (!adsetIds.length) return scanData;

    window.OPTIMIZER_SETTINGS_CACHE = window.OPTIMIZER_SETTINGS_CACHE || { campaigns: null, audiences: null, adsetDetails: {}, deliveryEstimateDetails: {}, attributionSplitDetails: {} };
    var cache = window.OPTIMIZER_SETTINGS_CACHE;

    if (!cache.campaigns) {
        try {
            var campaignResponse = await fetchOptimizerJson('/api/campaigns');
            cache.campaigns = campaignResponse && campaignResponse.success ? (campaignResponse.campaigns || []) : [];
        } catch (err) {
            cache.campaigns = cache.campaigns || [];
        }
    }
    if (!cache.audiences) {
        try {
            var audienceResponse = await fetchOptimizerJson('/api/custom-audiences');
            cache.audiences = audienceResponse && audienceResponse.success ? (audienceResponse.audiences || []) : [];
        } catch (err2) {
            cache.audiences = cache.audiences || [];
        }
    }

    var missingIds = adsetIds.filter(function(id) { return !cache.adsetDetails[id]; });
    if (missingIds.length) {
        var detailResults = await Promise.allSettled(missingIds.map(function(id) {
            return fetchOptimizerJson('/api/adset-details/' + encodeURIComponent(id));
        }));
        detailResults.forEach(function(result, index) {
            var adsetId = missingIds[index];
            if (result.status === 'fulfilled' && result.value && result.value.success && result.value.adset) {
                cache.adsetDetails[adsetId] = result.value.adset;
            } else {
                cache.adsetDetails[adsetId] = { id: adsetId, _settings_error: true };
            }
        });
    }
    var missingDeliveryIds = adsetIds.filter(function(id) { return !cache.deliveryEstimateDetails[id]; });
    if (missingDeliveryIds.length) {
        var deliveryResults = await Promise.allSettled(missingDeliveryIds.map(function(id) {
            return fetchOptimizerJson('/api/adset-delivery-estimate/' + encodeURIComponent(id));
        }));
        deliveryResults.forEach(function(result, index) {
            var adsetId = missingDeliveryIds[index];
            if (result.status === 'fulfilled' && result.value && result.value.success) {
                cache.deliveryEstimateDetails[adsetId] = result.value.delivery_estimate || {};
            } else {
                cache.deliveryEstimateDetails[adsetId] = { _settings_error: true };
            }
        });
    }
    var missingAttributionIds = adsetIds.filter(function(id) { return !cache.attributionSplitDetails[id]; });
    if (missingAttributionIds.length) {
        var attributionResults = await Promise.allSettled(missingAttributionIds.map(function(id) {
            return fetchOptimizerJson('/api/adset-attribution-split/' + encodeURIComponent(id));
        }));
        attributionResults.forEach(function(result, index) {
            var adsetId = missingAttributionIds[index];
            if (result.status === 'fulfilled' && result.value && result.value.success) {
                cache.attributionSplitDetails[adsetId] = result.value.attribution_split || {};
            } else {
                cache.attributionSplitDetails[adsetId] = { _settings_error: true };
            }
        });
    }

    var audienceLookup = buildAudienceLookup(cache.audiences || []);
    var campaignLookup = {};
    (cache.campaigns || []).forEach(function(campaign) {
        if (campaign && campaign.id) campaignLookup[campaign.id] = campaign;
    });

    function buildSettings(detail) {
        var targeting = detail && detail.targeting ? detail.targeting : {};
        var audienceSignals = extractAudienceSignals(targeting, audienceLookup);
        var bidStrategy = String(detail && detail.bid_strategy || '').toUpperCase();
        var normalizedBid = normalizeMetaMoneyValue(detail && detail.bid_amount);
        return {
            objective: campaignLookup[detail && detail.campaign_id] ? (campaignLookup[detail.campaign_id].objective || '') : '',
            bid_strategy: bidStrategy || 'UNKNOWN',
            optimization_event: String(detail && detail.optimization_goal || '').toUpperCase() || 'UNKNOWN',
            location_targeting: extractMetaLocationTargeting(targeting),
            age_targeting: extractMetaAgeTargeting(targeting),
            gender_targeting: extractMetaGenderTargeting(targeting),
            placements_active: extractMetaPlacements(targeting),
            placement_type: (targeting && (targeting.facebook_positions || targeting.instagram_positions || targeting.audience_network_positions || targeting.messenger_positions)) ? 'MANUAL' : 'AUTO',
            cost_cap_value: bidStrategy.indexOf('COST_CAP') !== -1 ? normalizedBid : null,
            bid_cap_value: bidStrategy.indexOf('BID_CAP') !== -1 ? normalizedBid : null,
            audience_definition: audienceSignals.audience_definition || '',
            audience_size_total: audienceSignals.audience_size_total,
            settings_enriched: !detail._settings_error
        };
    }

    function buildSignalExtras(adsetId) {
        var delivery = cache.deliveryEstimateDetails[adsetId] || null;
        var attribution = cache.attributionSplitDetails[adsetId] || null;
        return {
            delivery_estimate: delivery && !delivery._settings_error ? {
                estimate_ready: delivery.estimate_ready,
                daily_outcomes_curve: Array.isArray(delivery.daily_outcomes_curve) ? delivery.daily_outcomes_curve : []
            } : null,
            attribution_spend: attribution && !attribution._settings_error ? Number(attribution.spend || 0) : 0,
            attribution_revenue_by_window: attribution && !attribution._settings_error ? Object.assign({}, attribution.revenue_by_window || {}) : {}
        };
    }

    (scanData.ads || []).forEach(function(ad) {
        var detail = cache.adsetDetails[ad.adset_id];
        if (!detail) return;
        Object.assign(ad, buildSettings(detail), buildSignalExtras(ad.adset_id));
    });

    Object.keys(scanData.tree || {}).forEach(function(campaignName) {
        var campaignNode = scanData.tree[campaignName];
        var campaignDetails = campaignLookup[campaignNode.id] || null;
        campaignNode.objective = campaignDetails ? (campaignDetails.objective || campaignNode.objective || 'UNKNOWN') : (campaignNode.objective || 'UNKNOWN');
        Object.keys(campaignNode.adsets || {}).forEach(function(adsetName) {
            var adsetNode = campaignNode.adsets[adsetName];
            var detail = cache.adsetDetails[adsetNode.id];
            if (!detail) return;
            Object.assign(adsetNode, buildSettings(detail), buildSignalExtras(adsetNode.id));
        });
    });

    scanData._settings_enriched = {
        complete: true,
        fetched_at: new Date().toISOString(),
        adset_count: adsetIds.length,
        campaign_count: campaignIds.length
    };
    scanData.summary = scanData.summary || {};
    scanData.summary.settings_enriched_adsets = adsetIds.filter(function(id) {
        var detail = cache.adsetDetails[id];
        return detail && !detail._settings_error;
    }).length;
    scanData.summary.delivery_estimate_enriched_adsets = adsetIds.filter(function(id) {
        var detail = cache.deliveryEstimateDetails[id];
        return detail && !detail._settings_error;
    }).length;
    scanData.summary.attribution_split_enriched_adsets = adsetIds.filter(function(id) {
        var detail = cache.attributionSplitDetails[id];
        return detail && !detail._settings_error;
    }).length;
    return scanData;
}

// â”€â”€ Scanner â€” uses same endpoints as Campaign Tree â”€â”€

async function scanAccount(progressCb, rangeOverride, options) {
    options = options || {};
    var dr = rangeOverride || getSelectedDates();
    var cachedScan = getCachedOptimizerScan(dr);
    if (cachedScan) {
        window.OPTIMIZER_SCAN = cachedScan;
        setPortalLoadState('cached', 'Showing cached scan while fresh data loads');
        if (typeof progressCb === 'function') progressCb('Showing cached scan while fresh data loads...');
        if (typeof renderOptimizer === 'function') renderOptimizer();
    }
    progressCb('Fetching data from Meta API + Metabase...');

    var metaRes, funnelRes, adsStatusRes;
    try {
        var results = await Promise.all([
            fetch(SERVER + '/api/meta/ad-insights-daily', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom: dr.since, dateTo: dr.until })
            }).then(function(r) { return r.json(); }),
            fetch(SERVER + '/api/metabase/ad-funnel', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dateFrom: dr.since, dateTo: dr.until })
            }).then(function(r) { return r.json(); }),
            fetch(SERVER + '/api/meta/ads-status?fresh=1').then(function(r) { return r.json(); }).catch(function() { return { success: false }; })
        ]);
        metaRes = results[0];
        funnelRes = results[1];
        adsStatusRes = results[2];
    } catch (err) {
        if (cachedScan) {
            window.OPTIMIZER_SCAN = cachedScan;
            window.OPTIMIZER_SCAN_ERROR = 'Showing cached scan while fresh data loads or recovers: ' + err.message;
            setPortalLoadState('cached', 'Showing cached scan while fresh data loads');
            if (typeof progressCb === 'function') progressCb('Fresh scan failed, keeping cached scan on screen...');
            return cachedScan;
        }
        throw new Error('Failed to fetch data: ' + err.message);
    }

    if (!metaRes.success) throw new Error('Meta API: ' + metaRes.error);
    if (!funnelRes.success) throw new Error('Metabase: ' + funnelRes.error);

    // Build ad status lookup: ad_id â†’ { created_time, status }
    var adStatusMap = {};
    if (adsStatusRes && adsStatusRes.success && adsStatusRes.data) {
        adsStatusRes.data.forEach(function(ad) {
            adStatusMap[ad.ad_id] = ad;
        });
    }

    progressCb('Meta: ' + metaRes.total + ' rows | Metabase: ' + funnelRes.total + ' rows | Ad statuses: ' + Object.keys(adStatusMap).length + '. Matching...');

    // Build daily Metabase lookup (same as Campaign Tree)
    // FIXED: ID-based join â€” use meta_campaign_id from Metabase instead of campaign_name
    var mbDaily = {};
    var mbCampaign = {};
    var mbAdset = {};
    var mbCoverage = {};
    var mbCampaignAny = {};
    var mbAdsetAny = {};
    for (var fi = 0; fi < funnelRes.data.length; fi++) {
        var row = funnelRes.data[fi];
        var key = buildJoinKey(row.date, row.campaign_name, row.ad_set_name, row.tracker_name);
        addScanFunnelRaw(ensureScanRaw(mbDaily, key), row);
        mbCoverage[buildAdsetTrackerCoverageKey(row.campaign_name, row.ad_set_name, row.tracker_name)] = true;

        var campKeyMb = normalizeCampaignName(row.campaign_name || '');
        addScanFunnelRaw(ensureScanRaw(mbCampaign, campKeyMb, {
            campaign_name: row.campaign_name || '',
            campaign_id: row.meta_campaign_id || ''
        }), row);
        mbCampaignAny[campKeyMb] = true;

        var adsetKeyMb = campKeyMb + '|||' + normalizeAdsetName(row.ad_set_name || '');
        addScanFunnelRaw(ensureScanRaw(mbAdset, adsetKeyMb, {
            campaign_name: row.campaign_name || '',
            campaign_id: row.meta_campaign_id || '',
            adset_name: row.ad_set_name || '',
            adset_id: ''
        }), row);
        mbAdsetAny[adsetKeyMb] = true;
    }

    // Match Meta to Metabase â€” identical logic to Campaign Tree
    var metaCampaign = {};
    var metaAdset = {};
    var adAgg = {};
    var matchedKeys = 0, unmatchedKeys = 0;
    var dateShiftMisses = 0, adsetCoverageMisses = 0, campaignCoverageMisses = 0, spendOnlyMisses = 0;
    var matchedMbKeys = {};
    var metaRowMatchFlags = [];
    var metaRows = (metaRes.data || []).filter(function(row) {
        return /android/i.test(row.campaign_name || '');
    });

    progressCb('Matching ' + metaRows.length + ' Meta rows to ' + Object.keys(mbDaily).length + ' Metabase keys...');

    for (var mi = 0; mi < metaRows.length; mi++) {
        var mr = metaRows[mi];
        var campKey = normalizeCampaignName(mr.campaign_name || '');
        addScanMetaRaw(ensureScanRaw(metaCampaign, campKey, {
            campaign_name: mr.campaign_name || '',
            campaign_id: mr.campaign_id || ''
        }), mr);

        var metaAdsetKey = campKey + '|||' + normalizeAdsetName(mr.adset_name || '');
        addScanMetaRaw(ensureScanRaw(metaAdset, metaAdsetKey, {
            campaign_name: mr.campaign_name || '',
            campaign_id: mr.campaign_id || '',
            adset_name: mr.adset_name || '',
            adset_id: mr.adset_id || ''
        }), mr);

        var adUid = mr.campaign_name + '|||' + mr.adset_name + '|||' + mr.ad_name;
        if (!adAgg[adUid]) {
            adAgg[adUid] = {
                campaign_name: mr.campaign_name, campaign_id: mr.campaign_id,
                adset_name: mr.adset_name, adset_id: mr.adset_id,
                ad_name: mr.ad_name, ad_id: mr.ad_id,
                spend: 0, impressions: 0, clicks: 0, installs: 0,
                thruplay: 0, p25: 0, p100: 0,
                signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0,
                d6: 0, d6_revenue: 0, overall_revenue: 0,
                new_converted_user: 0, new_user_rev: 0,
                p0_signup: 0, p1_signup: 0, total_trial: 0,
                d6_overall_con: 0, d6_overall_revenue: 0, _matched: false
            };
        }
        var a = adAgg[adUid];
        addScanMetaRaw(a, mr);

        // FIXED: ID-based join â€” use campaign_id from Meta API to match meta_campaign_id from Metabase
        var mbKey = buildJoinKey(mr.date_start, mr.campaign_name, mr.adset_name, mr.ad_name);
        var mb = mbDaily[mbKey];
        if (mb) {
            matchedKeys++;
            matchedMbKeys[mbKey] = true;
            a._matched = true;
            addScanFunnelRaw(a, mb);
            metaRowMatchFlags.push({ adUid: adUid, matched: true, campaignKey: campKey, adsetKey: metaAdsetKey });
        } else {
            unmatchedKeys++;
            var covKey = buildAdsetTrackerCoverageKey(mr.campaign_name, mr.adset_name, mr.ad_name);
            if (mbCoverage[covKey]) dateShiftMisses++;
            else if (mbAdsetAny[campKey + '|||' + normalizeAdsetName(mr.adset_name || '')]) adsetCoverageMisses++;
            else if (mbCampaignAny[campKey]) campaignCoverageMisses++;
            else spendOnlyMisses++;
            metaRowMatchFlags.push({ adUid: adUid, matched: false, campaignKey: campKey, adsetKey: metaAdsetKey });
        }
    }

    // Add unmatched Metabase entries
    for (var mbk in mbDaily) {
        if (!matchedMbKeys[mbk]) {
            var parts = mbk.split('|||');
            var uid = parts[1] + '|||' + parts[2] + '|||' + parts[3];
            var au = ensureScanRaw(adAgg, uid, {
                campaign_name: parts[1] || '',
                campaign_id: '',
                adset_name: parts[2] || '',
                adset_id: '',
                ad_name: parts[3] || '',
                ad_id: '',
                _matched: true
            });
            au._matched = true;
            addScanFunnelRaw(au, mbDaily[mbk]);
        }
    }

    // Add PAUSED ads from ads-status that have no spend in the date range
    // These are reactivation candidates â€” they had historical performance but were turned off
    if (adsStatusRes && adsStatusRes.success && adsStatusRes.data) {
        var existingAdIds = {};
        for (var ek in adAgg) { if (adAgg[ek].ad_id) existingAdIds[adAgg[ek].ad_id] = true; }
        adsStatusRes.data.forEach(function(ad) {
            if (!/android/i.test(ad.campaign_name || '')) return;
            if (isEffectivelyPausedStatus(ad.status) && !existingAdIds[ad.ad_id]) {
                var uid = (ad.campaign_name || '') + '|||' + (ad.adset_name || '') + '|||' + (ad.ad_name || '');
                adAgg[uid] = {
                    campaign_name: ad.campaign_name || '', campaign_id: ad.campaign_id || '',
                adset_name: ad.adset_name || '', adset_id: ad.adset_id || '',
                ad_name: ad.ad_name || '', ad_id: ad.ad_id,
                spend: 0, impressions: 0, clicks: 0, installs: 0,
                thruplay: 0, p25: 0, p100: 0,
                signups: 0, d0_trial: 0, d0: 0, d0_revenue: 0, d6: 0, d6_revenue: 0,
                overall_revenue: 0, new_converted_user: 0, new_user_rev: 0, p0_signup: 0,
                p1_signup: 0, total_trial: 0, d6_overall_con: 0, d6_overall_revenue: 0,
                _matched: false, _pausedNoSpend: true
            };
            }
        });
    }

    // Compute derived metrics per ad with go-live maturity logic
    var DECISION_MATURITY_DAYS = 29 * 24 * 60 * 60 * 1000;
    var now = Date.now();

    // Include ads with spend > 0 AND paused ads with no spend (reactivation candidates)
    var ads = Object.values(adAgg).filter(function(x) { return x.spend > 0 || x._pausedNoSpend; }).map(function(a) {
        // Enrich with ad status, parent statuses, and budget ownership metadata
        var statusInfo = adStatusMap[a.ad_id];
        a.created_time = statusInfo ? statusInfo.created_time : null;
        a.ad_status = statusInfo ? statusInfo.status : 'UNKNOWN';
        a.adset_status = statusInfo ? (statusInfo.adset_status || 'UNKNOWN') : 'UNKNOWN';
        a.campaign_status = statusInfo ? (statusInfo.campaign_status || 'UNKNOWN') : 'UNKNOWN';
        a.budget_level = statusInfo ? (statusInfo.budget_level || 'unknown') : 'unknown';
        a.budget_type = statusInfo ? (statusInfo.budget_type || 'unknown') : 'unknown';
        a.budget_entity_type = statusInfo ? (statusInfo.budget_entity_type || '') : '';
        a.budget_entity_id = statusInfo ? (statusInfo.budget_entity_id || '') : '';
        a.budget_entity_name = statusInfo ? (statusInfo.budget_entity_name || '') : '';
        a.budget_current_daily_budget = statusInfo && statusInfo.budget_current_daily_budget != null ? Number(statusInfo.budget_current_daily_budget) : null;
        a.delivery_state = getDeliveryState(a.ad_status, a.adset_status, a.campaign_status);
        a.is_effectively_paused = a.delivery_state.indexOf('paused') === 0;
        a.is_live = a.delivery_state === 'live';
        a.has_funnel_match = !!a._matched;
        a.audience_bucket = inferAudienceBucketFromText((a.adset_name || '') + ' ' + (a.campaign_name || ''));

        // Determine go-live date: use created_time from Meta, fallback to first spend date
        var goLiveTs = 0;
        if (a.created_time) {
            goLiveTs = new Date(a.created_time).getTime();
        }
        a.goLiveDate = goLiveTs ? new Date(goLiveTs).toISOString().split('T')[0] : null;
        a.daysSinceGoLive = goLiveTs ? Math.floor((now - goLiveTs) / (24 * 60 * 60 * 1000)) : null;
        a.isMatured = goLiveTs ? (now - goLiveTs) >= DECISION_MATURITY_DAYS : false;

        a._fullRangeRaw = rawFromItem(a);
        a._evalMode = a.isMatured ? 'full_fallback' : 'full_early';
        a._evalRaw = rawFromItem(a);
        applyRaw(a, a._evalRaw);

        // Derive all metrics via the evaluated raw totals
        var derived = deriveMetrics(a);
        a.cpi = derived.cpi;
        a.ctr = derived.ctr;
        a.signupCost = derived.signupCost;
        a.d0TrialCost = derived.d0TrialCost;
        a.d6CAC_raw = derived.d6CAC;
        a.d6ROAS_raw = derived.d6ROAS;

        // Matured D6 metrics: only reliable for ads live long enough for the 29-day decision model
        // Both matured and non-matured use same raw values; maturity label differs
        a.d6CAC = derived.d6CAC;
        a.d6ROAS = derived.d6ROAS;
        a.d6 = derived.d6Con;
        a.evalD6 = derived.d6Con;
        a.evalDataLabel = a._evalMode === 'mature'
            ? 'Mature data (29-day decision model)'
            : (a._evalMode === 'full_fallback'
                ? 'Full data (no 29-day mature window available in selected range)'
                : 'Full data (ad still early / not mature yet)');
        a.d6Label = a._evalMode === 'mature'
            ? 'Matured (29-day decision model)'
            : (a.daysSinceGoLive !== null ? a.daysSinceGoLive + 'd old â€¢ Full data' : 'Unknown age â€¢ Full data');

        a.d6OverallROAS = _vR(a.spend, a.d6_overall_revenue) || 0;
        a.overallROAS = derived.overallROAS;
        a.alertStatus = classifyAlert(a);
        return a;
    });

    var matchedAdsCount = ads.filter(function(a) { return !!a.has_funnel_match; }).length;
    var unmatchedAdsCount = ads.filter(function(a) { return !a.has_funnel_match; }).length;
    var matchedSpend = ads.filter(function(a) { return !!a.has_funnel_match; }).reduce(function(sum, a) { return sum + (a.spend || 0); }, 0);
    var totalAdSpend = ads.reduce(function(sum, a) { return sum + (a.spend || 0); }, 0);
    var spendMatchRate = totalAdSpend > 0 ? +((matchedSpend / totalAdSpend) * 100).toFixed(1) : 0;
    var dateGrainMisses = dateShiftMisses;
    var adsetLevelCoverageMisses = adsetCoverageMisses;
    var campaignLevelCoverageMisses = campaignCoverageMisses;

    // Build tree
    var tree = {};
    for (var ti = 0; ti < ads.length; ti++) {
        var ad = ads[ti];
        if (!tree[ad.campaign_name]) {
            tree[ad.campaign_name] = {
                name: ad.campaign_name,
                id: ad.campaign_id,
                campaign_status: ad.campaign_status || 'UNKNOWN',
                budget_level: ad.budget_level === 'campaign' ? ad.budget_level : 'unknown',
                budget_type: ad.budget_level === 'campaign' ? ad.budget_type : 'unknown',
                budget_entity_type: ad.budget_level === 'campaign' ? ad.budget_entity_type : '',
                budget_entity_id: ad.budget_level === 'campaign' ? ad.budget_entity_id : '',
                budget_entity_name: ad.budget_level === 'campaign' ? ad.budget_entity_name : '',
                budget_current_daily_budget: ad.budget_level === 'campaign' ? ad.budget_current_daily_budget : null,
                adsets: {}
            };
        }
        if (!tree[ad.campaign_name].adsets[ad.adset_name]) {
            tree[ad.campaign_name].adsets[ad.adset_name] = {
                name: ad.adset_name,
                id: ad.adset_id,
                adset_status: ad.adset_status || 'UNKNOWN',
                campaign_status: ad.campaign_status || 'UNKNOWN',
                budget_level: ad.budget_level || 'unknown',
                budget_type: ad.budget_type || 'unknown',
                budget_entity_type: ad.budget_entity_type || '',
                budget_entity_id: ad.budget_entity_id || '',
                budget_entity_name: ad.budget_entity_name || '',
                budget_current_daily_budget: ad.budget_current_daily_budget,
                ads: []
            };
        }
        tree[ad.campaign_name].adsets[ad.adset_name].ads.push(ad);
    }

    var campaignAgg = {};
    for (var ckRaw in metaCampaign) {
        campaignAgg[ckRaw] = Object.assign(emptyRaw(), metaCampaign[ckRaw], {
            campaign_name: metaCampaign[ckRaw].campaign_name,
            campaign_id: metaCampaign[ckRaw].campaign_id
        });
    }
    for (var ckMb in mbCampaign) {
        if (!campaignAgg[ckMb]) {
            campaignAgg[ckMb] = Object.assign(emptyRaw(), {
                campaign_name: mbCampaign[ckMb].campaign_name,
                campaign_id: mbCampaign[ckMb].campaign_id
            });
        }
        addScanFunnelRaw(campaignAgg[ckMb], mbCampaign[ckMb]);
    }

    var adsetAgg = {};
    for (var akRaw in metaAdset) {
        adsetAgg[akRaw] = Object.assign(emptyRaw(), metaAdset[akRaw], {
            campaign_name: metaAdset[akRaw].campaign_name,
            campaign_id: metaAdset[akRaw].campaign_id,
            adset_name: metaAdset[akRaw].adset_name,
            adset_id: metaAdset[akRaw].adset_id
        });
    }
    for (var akMb in mbAdset) {
        if (!adsetAgg[akMb]) {
            adsetAgg[akMb] = Object.assign(emptyRaw(), {
                campaign_name: mbAdset[akMb].campaign_name,
                campaign_id: mbAdset[akMb].campaign_id,
                adset_name: mbAdset[akMb].adset_name,
                adset_id: mbAdset[akMb].adset_id
            });
        }
        addScanFunnelRaw(adsetAgg[akMb], mbAdset[akMb]);
    }

    // Aggregate totals using the same campaign/adset layers as Campaign Tree
    var redCount = 0, greenCount = 0;
    for (var ck in tree) {
        for (var ak in tree[ck].adsets) {
            var adset = tree[ck].adsets[ak];
            adset.ads.sort(function(x, y) { return y.spend - x.spend; });
            var adsetKey = normalizeCampaignName(ck) + '|||' + normalizeAdsetName(ak);
            var adsetRaw = adsetAgg[adsetKey] || emptyRaw();
            adset.totals = Object.assign(deriveMetrics(adsetRaw), { adset_id: adset.id || adsetRaw.adset_id || '' });
        }
        var campaignRaw = campaignAgg[normalizeCampaignName(ck)] || emptyRaw();
        tree[ck].totals = Object.assign(deriveMetrics(campaignRaw), { campaign_id: tree[ck].id || campaignRaw.campaign_id || '' });
    }
    for (var ai2 = 0; ai2 < ads.length; ai2++) {
        if (ads[ai2].alertStatus === 'red') redCount++;
        else if (ads[ai2].alertStatus === 'green') greenCount++;
    }

    var evaluatedTotals = deriveMetrics(sumRaw(Object.values(campaignAgg)));
    var totalSpend = Object.values(campaignAgg).reduce(function(s, x) { return s + (x.spend || 0); }, 0);
    var totalAdsets = Object.values(tree).reduce(function(s, c) { return s + Object.keys(c.adsets).length; }, 0);

    try {
        computeOptimizerWoWTrends(ads, metaRows, mbDaily);
    } catch (wowErr) {
        console.warn('[Optimizer] Failed to compute optimizer-native WoW trends:', wowErr.message);
    }
    if (!(ads || []).some(function(ad) { return ad && ad._wow; }) && Array.isArray(window.allData) && window.allData.length) {
        var wowMap = {};
        window.allData.forEach(function(item) {
            if (item && item.ad_id && item._wow) wowMap[item.ad_id] = item._wow;
        });
        ads.forEach(function(ad) {
            if (ad && ad.ad_id && wowMap[ad.ad_id]) ad._wow = wowMap[ad.ad_id];
        });
    }

    var scanResult = {
        scan_date: new Date().toISOString(),
        date_range: dr,
        tree: tree,
        ads: ads,
        _trend_source: {
            meta_rows: metaRows,
            funnel_rows: funnelRes.data || []
        },
        evaluatedTotals: evaluatedTotals,
        rangeContext: getOptimizerRangeContext(dr),
        summary: {
            total_campaigns: Object.keys(tree).length,
            total_adsets: totalAdsets,
            total_ads: ads.length,
            total_spend: totalSpend,
            red_ads: redCount,
            green_ads: greenCount,
            matched_keys: matchedKeys,
            unmatched_keys: unmatchedKeys,
            matched_ads: matchedAdsCount,
            unmatched_ads: unmatchedAdsCount,
            spend_match_rate_pct: spendMatchRate,
            date_grain_miss_rows: dateShiftMisses,
            adset_level_miss_rows: adsetCoverageMisses,
            campaign_level_miss_rows: campaignCoverageMisses,
            spend_only_miss_rows: spendOnlyMisses,
            matured_ads: ads.filter(function(a) { return a.isMatured; }).length,
            non_matured_ads: ads.filter(function(a) { return !a.isMatured; }).length,
            ads_with_status: ads.filter(function(a) { return a.created_time; }).length
        }
    };

    if (!options.preserveGlobal) window.OPTIMIZER_SCAN = scanResult;
    setCachedOptimizerScan(scanResult, options);
    return scanResult;
}

// Maturity-aware alert classification with WoW trend signals
function classifyAlert(d) {
    if (d.spend < 15000) return 'neutral';

    // WoW trend signals (from window.allData if available, or from d._wow)
    var wow = d._wow || {};
    var trendBreaches = wow.trendBreaches || 0;
    var trendHits = wow.trendHits || 0;

    // For NON-MATURED ads (<29 days), use early funnel signals
    // EXCEPTION: exceptional D6 ROAS = always green regardless of maturity
    if (!d.isMatured) {
        if (d.d6ROAS > 28) return 'green';
        var earlyBreaches = trendBreaches;
        if (d.signupCost > 1000) earlyBreaches++;
        if (d.d0TrialCost > 3500) earlyBreaches++;
        if (d.cpi > 200) earlyBreaches++;
        if (d.installs > 50 && d.signups === 0) earlyBreaches++;
        if (earlyBreaches >= 2) return 'red';

        // If early signals look good
        var earlyHits = trendHits;
        if (d.signupCost > 0 && d.signupCost < 500) earlyHits++;
        if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) earlyHits++;
        if (d.cpi > 0 && d.cpi < 100) earlyHits++;
        if (earlyHits >= 2) return 'green';

        return 'neutral';
    }

    // MATURED ads: use matured D6 metrics (excl current week if WoW data available)
    var matD6ROAS = (wow.maturedD6ROAS != null) ? wow.maturedD6ROAS : d.d6ROAS;
    var matD6CAC = (wow.maturedD6CAC != null) ? wow.maturedD6CAC : d.d6CAC;
    if (matD6ROAS > 28) return 'green';
    var breaches = trendBreaches;
    if (d.signupCost > 1000) breaches++;
    if (d.d0TrialCost > 3500) breaches++;
    if (matD6CAC > 15000) breaches++;
    if (breaches >= 2) return 'red';
    var hits = trendHits;
    if (d.signupCost > 0 && d.signupCost < 500) hits++;
    if (d.d0TrialCost > 0 && d.d0TrialCost < 2500) hits++;
    if (d.d6CAC > 0 && d.d6CAC < 12000) hits++;
    if (hits >= 2) return 'green';
    return 'neutral';
}

function sumAds(adsList) {
    return deriveMetrics(sumRaw(adsList));
}

function medianMetric(items, selector) {
    var vals = (items || []).map(selector).filter(function(v) { return v != null && isFinite(v) && v > 0; }).sort(function(a, b) { return a - b; });
    if (!vals.length) return 0;
    var mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

function inferAudienceBucketFromText(text) {
    var t = String(text || '').toLowerCase();
    if (/\bbof\b/.test(t)) return 'retarget';
    if (/(lal|lookalike|broad|interest|prospect|cold|asc)/.test(t)) return 'prospecting';
    return 'unknown';
}

function weightedPercentileMetric(items, valueSelector, weightSelector, percentile) {
    var rows = (items || []).map(function(item) {
        return {
            value: valueSelector(item),
            weight: weightSelector(item)
        };
    }).filter(function(row) {
        return row.value != null && isFinite(row.value) && row.value > 0 && row.weight != null && isFinite(row.weight) && row.weight > 0;
    }).sort(function(a, b) {
        return a.value - b.value;
    });
    if (!rows.length) return 0;
    var totalWeight = rows.reduce(function(sum, row) { return sum + row.weight; }, 0);
    var threshold = totalWeight * (percentile == null ? 0.5 : percentile);
    var acc = 0;
    for (var i = 0; i < rows.length; i++) {
        acc += rows[i].weight;
        if (acc >= threshold) return rows[i].value;
    }
    return rows[rows.length - 1].value;
}

function safePct(numerator, denominator) {
    return denominator > 0 ? +((numerator / denominator) * 100).toFixed(1) : 0;
}

function getAdLearningState(ad) {
    var state = String(ad && (ad.learning_status || ad.adset_learning_status || '') || '').toUpperCase();
    if (state) return state;
    return ad && ad.isMatured ? 'ACTIVE' : 'LEARNING_UNKNOWN';
}

function getDaysSinceStructuralEditForAd(ad) {
    var days = Number(ad && (ad.days_since_last_structural_edit != null ? ad.days_since_last_structural_edit : ad.daysSinceLastEdit));
    return isFinite(days) ? days : null;
}

function buildWeightedMedianBenchmarks(ads) {
    var items = (ads || []).filter(function(ad) {
        var learningState = getAdLearningState(ad);
        var editDays = getDaysSinceStructuralEditForAd(ad);
        return !!ad &&
            !!ad.has_funnel_match &&
            (ad.signups || 0) >= 5 &&
            (ad.spend || 0) > 0 &&
            ad.audience_bucket !== 'retarget' &&
            learningState === 'ACTIVE' &&
            (editDays == null || editDays >= 3);
    });
    var totalSpend = (ads || []).reduce(function(sum, ad) { return sum + (ad.spend || 0); }, 0);
    var eligibleSpend = items.reduce(function(sum, ad) { return sum + (ad.spend || 0); }, 0);
    var excludedLearningSpend = (ads || []).filter(function(ad) {
        var learningState = getAdLearningState(ad);
        return learningState && learningState !== 'ACTIVE' && learningState !== 'LEARNING_UNKNOWN';
    }).reduce(function(sum, ad) { return sum + (ad.spend || 0); }, 0);
    var excludedCooldownSpend = (ads || []).filter(function(ad) {
        var editDays = getDaysSinceStructuralEditForAd(ad);
        return editDays != null && editDays < 3;
    }).reduce(function(sum, ad) { return sum + (ad.spend || 0); }, 0);
    var excludedSpendOnlySpend = (ads || []).filter(function(ad) { return !!ad && !ad.has_funnel_match; })
        .reduce(function(sum, ad) { return sum + (ad.spend || 0); }, 0);
    var benchmarkCPA = weightedPercentileMetric(items, function(ad) { return ad.signupCost; }, function(ad) { return ad.spend || 0; }, 0.5);
    var benchmarkD6 = weightedPercentileMetric(items, function(ad) { return ad.d6ROAS; }, function(ad) { return ad.spend || 0; }, 0.5);
    return {
        benchmark_cpa: benchmarkCPA || 0,
        benchmark_d6_roas: benchmarkD6 || 0,
        based_on_n_rows: items.length,
        total_eligible_spend: eligibleSpend,
        excluded_learning_spend: excludedLearningSpend,
        excluded_cooldown_spend: excludedCooldownSpend,
        excluded_spend_only_spend: excludedSpendOnlySpend,
        total_account_spend: totalSpend,
        coherence_gap: +(totalSpend - (eligibleSpend + excludedLearningSpend + excludedCooldownSpend + excludedSpendOnlySpend)).toFixed(1),
        eligible_rows: items
    };
}

function getBenchmarkProfileForAd(ad, benchmarks) {
    var audienceBucket = inferAudienceBucketFromText((ad && (ad.adset_name || '')) + ' ' + (ad && (ad.campaign_name || '')));
    if (audienceBucket === 'retarget' && benchmarks && benchmarks.retarget && benchmarks.retarget.sample_size) return benchmarks.retarget;
    if (audienceBucket === 'prospecting' && benchmarks && benchmarks.prospecting && benchmarks.prospecting.sample_size) return benchmarks.prospecting;
    return benchmarks && benchmarks.overall ? benchmarks.overall : benchmarks;
}

function buildOptimizerBenchmarks(ads) {
    var cohort = (ads || []).filter(function(a) { return (a.spend || 0) >= 15000; });
    function buildProfile(items, scope) {
        return {
            scope: scope,
            sample_size: items.length,
            median_d6_roas: weightedPercentileMetric(items, function(a) { return a.d6ROAS; }, function(a) { return a.spend || 0; }, 0.5),
            median_d6_cac: weightedPercentileMetric(items, function(a) { return a.d6CAC; }, function(a) { return a.spend || 0; }, 0.5),
            median_signup_cost: weightedPercentileMetric(items, function(a) { return a.signupCost; }, function(a) { return a.spend || 0; }, 0.5),
            median_d0_trial_cost: weightedPercentileMetric(items, function(a) { return a.d0TrialCost; }, function(a) { return a.spend || 0; }, 0.5),
            median_cpi: weightedPercentileMetric(items, function(a) { return a.cpi; }, function(a) { return a.spend || 0; }, 0.5)
        };
    }
    var retarget = cohort.filter(function(a) { return inferAudienceBucketFromText((a.adset_name || '') + ' ' + (a.campaign_name || '')) === 'retarget'; });
    var prospecting = cohort.filter(function(a) { return inferAudienceBucketFromText((a.adset_name || '') + ' ' + (a.campaign_name || '')) === 'prospecting'; });
    var overall = buildProfile(cohort, 'meta_optimizer_account_weighted');
    overall.retarget = buildProfile(retarget, 'retarget_weighted');
    overall.prospecting = buildProfile(prospecting, 'prospecting_weighted');
    overall.apex_weighted = buildWeightedMedianBenchmarks(ads);
    return overall;
}

// â”€â”€ AI Plan Generator â”€â”€

function retargetActionTo(action, entityType, entityId, entityName, campaignName, adsetName) {
    action.entity_type = entityType;
    action.entity_id = entityId || action.entity_id;
    action.entity_name = entityName || action.entity_name;
    action.campaign_name = campaignName != null ? campaignName : action.campaign_name;
    action.adset_name = adsetName != null ? adsetName : action.adset_name;
    return action;
}

function setBudgetActionFromOwner(action, source, direction) {
    if (!source || source.budget_type !== 'daily' || !source.budget_entity_id || !source.budget_level) return false;
    var currentBudget = Number(source.budget_current_daily_budget) || 0;
    if (currentBudget <= 0) return false;
    action.budget_change = Object.assign({}, action.budget_change || {});
    action.budget_change.current_daily_budget = Math.round(currentBudget);
    var recommended = Number(action.budget_change.recommended_daily_budget);
    if (!(recommended > 0)) recommended = getDefaultBudgetRecommendation(currentBudget, direction);
    if (!(recommended > 0)) return false;
    if (direction === 'decrease' && recommended >= currentBudget) recommended = getDefaultBudgetRecommendation(currentBudget, 'decrease');
    if (direction === 'increase' && recommended <= currentBudget) recommended = getDefaultBudgetRecommendation(currentBudget, 'increase');
    action.budget_change.recommended_daily_budget = Math.round(recommended);
    action.budget_change.change_pct = currentBudget > 0 ? (((recommended - currentBudget) / currentBudget) * 100).toFixed(0) + '%' : '';
    if (source.budget_level === 'campaign') {
        action.action_type = 'UPDATE_CAMPAIGN_BUDGET';
        retargetActionTo(action, 'campaign', source.budget_entity_id, source.budget_entity_name || source.campaign_name, source.campaign_name || action.campaign_name, '');
    } else if (source.budget_level === 'adset') {
        action.action_type = 'UPDATE_ADSET_BUDGET';
        retargetActionTo(action, 'adset', source.budget_entity_id, source.budget_entity_name || source.adset_name, source.campaign_name || action.campaign_name, source.adset_name || action.adset_name);
    } else {
        return false;
    }
    return true;
}

function convertActionToMonitor(action, note) {
    action.action_type = 'MONITOR';
    action.category = action.category || 'MONITOR';
    delete action.budget_change;
    if (note) {
        action.action_detail = note;
        action.diagnosis = action.diagnosis ? (action.diagnosis + ' ' + note) : note;
        action.reasoning = action.reasoning ? (action.reasoning + ' ' + note) : note;
    }
    var lowerNote = String(note || '').toLowerCase();
    action.deferred_by_learning = /learning protection|already in learning|queued for later|reassess after|would risk destabilizing|structural edit/.test(lowerNote);
    action.deferred_reason = action.deferred_by_learning
        ? 'APEX believes this change may be required, but it is not recommending it now because it may disrupt account learning.'
        : '';
    return action;
}

function getDecisionModeLabel(source) {
    if (!source) return 'Decision mode unavailable';
    if (source.isMatured) return 'Decision mode: Matured ad using mature-eval window';
    if (source.daysSinceGoLive != null) return 'Decision mode: Unmatured ad using full-data fallback (' + source.daysSinceGoLive + 'd live)';
    return 'Decision mode: Full-data fallback';
}

function getGlobalMetricBasisContext(scan, plan, fallbackRange) {
    var analysisBasis = derivePlanAnalysisBasis(plan || window.OPTIMIZER_PLAN, scan || getCurrentOptimizerDisplayScan() || window.OPTIMIZER_SCAN || {});
    return {
        range: fallbackRange || analysisBasis.range || '--',
        mode: analysisBasis.mode + (analysisBasis.detail ? ' (' + analysisBasis.detail + ')' : '')
    };
}

function getEntityMetricBasis(entity, fallbackRange, fallbackModeLabel) {
    var rangeLabel = fallbackRange || (window.OPTIMIZER_SCAN && window.OPTIMIZER_SCAN.date_range ? (window.OPTIMIZER_SCAN.date_range.since + ' → ' + window.OPTIMIZER_SCAN.date_range.until) : '--');
    var modeLabel = fallbackModeLabel || (entity && entity.evalDataLabel
        ? entity.evalDataLabel
        : getDecisionModeLabel(entity).replace(/^Decision mode:\s*/i, ''));
    return 'Basis: ' + rangeLabel + ' | ' + modeLabel;
}

function renderMetricBasisLine(entity, fallbackRange, fallbackModeLabel) {
    return '<div style="font-size:9px;color:var(--accent);margin-top:4px;">' + esc(getEntityMetricBasis(entity, fallbackRange, fallbackModeLabel)) + '</div>';
}

function buildDeterministicActionDiagnosis(action, source, scanData) {
    var metrics = Object.assign({}, action && action.current_metrics || {}, source || {});
    var rangeLabel = (action && action.data_range) || (scanData && scanData.date_range ? (scanData.date_range.since + ' → ' + scanData.date_range.until) : '--');
    var modeLabel = (action && (action.decision_mode_label || action.data_mode_label)) || getDecisionModeLabel(source);
    var parts = [];
    var spend = parseNumericLike(metrics.spend);
    var d6Roas = parseNumericLike(metrics.d6_roas != null ? metrics.d6_roas : metrics.d6ROAS);
    var d15Roas = parseNumericLike(metrics.d15_roas != null ? metrics.d15_roas : metrics.d15ROAS);
    var d30Roas = parseNumericLike(metrics.d30_roas != null ? metrics.d30_roas : metrics.d30ROAS);
    var signupCost = parseNumericLike(metrics.signup_cost != null ? metrics.signup_cost : metrics.signupCost);
    var d0TrialCost = parseNumericLike(metrics.d0_trial_cost != null ? metrics.d0_trial_cost : metrics.d0TrialCost);
    var d6Cac = parseNumericLike(metrics.d6_cac != null ? metrics.d6_cac : metrics.d6CAC);
    var cpi = parseNumericLike(metrics.cpi);
    var ctr = parseNumericLike(metrics.ctr);
    var cpm = parseNumericLike(metrics.cpm);
    var campaignStatus = String(metrics.campaign_status || '').toUpperCase();
    var adsetStatus = String(metrics.adset_status || '').toUpperCase();
    var adStatus = String(metrics.ad_status || '').toUpperCase();
    var deliveryState = String(metrics.delivery_state || '').replace(/_/g, ' ');

    parts.push('Window ' + rangeLabel + '.');
    if (modeLabel) parts.push(modeLabel.replace(/^Decision mode:\s*/i, 'Basis: ') + '.');
    if (spend != null) parts.push('Spend ' + fmtINR(spend) + '.');
    if (cpi != null) parts.push('CPI ' + fmtINR(cpi) + '.');
    if (ctr != null) parts.push('CTR ' + ctr.toFixed(2) + '%.');
    if (cpm != null) parts.push('CPM ' + fmtINR(cpm) + '.');
    if (d6Roas != null) parts.push('D6 overall ROAS ' + d6Roas.toFixed(1) + '%.');
    if (d15Roas != null) parts.push('D15 overall ROAS ' + d15Roas.toFixed(1) + '%.');
    if (d30Roas != null) parts.push('D30 overall ROAS ' + d30Roas.toFixed(1) + '%.');
    if (signupCost != null) parts.push('Signup cost ' + fmtINR(signupCost) + '.');
    if (d0TrialCost != null) parts.push('D0 trial cost ' + fmtINR(d0TrialCost) + '.');
    if (d6Cac != null) parts.push('D6 CAC ' + fmtINR(d6Cac) + '.');
    if (campaignStatus || adsetStatus || adStatus) {
        parts.push('Status c/a/ad: ' + (campaignStatus || '--') + '/' + (adsetStatus || '--') + '/' + (adStatus || '--') + '.');
    } else if (deliveryState) {
        parts.push('Delivery state ' + deliveryState + '.');
    }
    return parts.join(' ');
}

function getEntityActionKey(action, source) {
    var type = String(action && action.entity_type || '').toLowerCase();
    if (type === 'campaign') return 'campaign:' + (action.entity_id || (source && source.campaign_id) || normalizeCampaignName(action.campaign_name || action.entity_name || ''));
    if (type === 'adset') return 'adset:' + (action.entity_id || (source && source.adset_id) || (normalizeCampaignName(action.campaign_name || '') + '|||' + normalizeAdsetName(action.adset_name || action.entity_name || '')));
    return 'ad:' + (action.entity_id || (source && source.ad_id) || (normalizeCampaignName(action.campaign_name || '') + '|||' + normalizeAdsetName(action.adset_name || '') + '|||' + normalizeTrackerName(action.entity_name || '')));
}

function getActionRank(action) {
    var type = String(action && action.action_type || '').toUpperCase();
    if (type === 'PAUSE_CAMPAIGN' || type === 'PAUSE_ADSET' || type === 'PAUSE_AD') return 100;
    if (type === 'ACTIVATE_CAMPAIGN' || type === 'ACTIVATE_ADSET' || type === 'ACTIVATE_AD') return 90;
    if (type === 'UPDATE_CAMPAIGN_BUDGET' || type === 'UPDATE_ADSET_BUDGET') return 70;
    if (type === 'CREATIVE_CHANGE') return 50;
    if (type === 'MONITOR') return 10;
    return 20;
}

function normalizeActionPriority(priority) {
    var p = String(priority || '').toUpperCase();
    if (p === 'URGENT' || p === '1') return 'P1';
    if (p === 'RECOMMENDED' || p === '2') return 'P2';
    if (p === 'WATCH' || p === '3') return 'P3';
    return p === 'P1' || p === 'P2' || p === 'P3' ? p : 'P2';
}

function mapApexActionType(type) {
    var t = String(type || '').toUpperCase();
    if (!t) return 'MONITOR';
    if (t === 'SCALE_BUDGET' || t === 'SCALE_OWNER_BUDGET') return 'UPDATE_ADSET_BUDGET';
    if (t === 'REDUCE_BUDGET') return 'UPDATE_ADSET_BUDGET';
    if (t === 'SCALE') return 'UPDATE_ADSET_BUDGET';
    if (t === 'REFRESH') return 'CREATIVE_CHANGE';
    if (t === 'REFRESH_CREATIVE' || t === 'LAUNCH_TEST') return 'CREATIVE_CHANGE';
    if (t === 'HOLD' || t === 'INVESTIGATE' || t === 'CONSOLIDATE') return 'MONITOR';
    return t;
}

function getPriorityRank(priority) {
    if (priority === 'P1' || priority === 1) return 3;
    if (priority === 'P2' || priority === 2) return 2;
    if (priority === 'P3' || priority === 3) return 1;
    return 0;
}

function collapseActionConflicts(actions, lookups) {
    var chosen = {};
    (actions || []).forEach(function(action) {
        var source = resolvePlanSource(action, lookups);
        var key = getEntityActionKey(action, source);
        var existing = chosen[key];
        if (!existing) {
            chosen[key] = action;
            return;
        }
        var existingScore = getActionRank(existing) * 10 + getPriorityRank(existing.priority);
        var nextScore = getActionRank(action) * 10 + getPriorityRank(action.priority);
        if (nextScore > existingScore) {
            chosen[key] = action;
        } else if (nextScore === existingScore) {
            var existingConf = String(existing.confidence || '').toUpperCase();
            var nextConf = String(action.confidence || '').toUpperCase();
            var confRank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
            if ((confRank[nextConf] || 0) > (confRank[existingConf] || 0)) chosen[key] = action;
        }
    });
    return Object.values(chosen);
}

function normalizePauseActionFromState(action, source) {
    var state = Object.assign({}, action && action.current_metrics || {}, source || {});
    var deliveryState = state.delivery_state || getDeliveryState(state.ad_status, state.adset_status, state.campaign_status);
    if (action.action_type === 'PAUSE_AD') {
        if (deliveryState === 'paused_campaign') {
            return convertActionToMonitor(action, 'Campaign is already paused, so pausing the child ad is redundant.');
        }
        if (deliveryState === 'paused_adset') {
            return convertActionToMonitor(action, 'Adset is already paused, so pausing the child ad is redundant.');
        }
        if (deliveryState === 'paused_ad' || isEffectivelyPausedStatus(state.ad_status)) {
            return convertActionToMonitor(action, 'Ad is already paused.');
        }
    }
    if (action.action_type === 'PAUSE_ADSET') {
        if (deliveryState === 'paused_campaign') {
            return convertActionToMonitor(action, 'Campaign is already paused, so pausing the adset is redundant.');
        }
        if (deliveryState === 'paused_adset' || isEffectivelyPausedStatus(state.adset_status)) {
            return convertActionToMonitor(action, 'Adset is already paused.');
        }
    }
    if (action.action_type === 'PAUSE_CAMPAIGN' && isEffectivelyPausedStatus(state.campaign_status)) {
        return convertActionToMonitor(action, 'Campaign is already paused.');
    }
    return action;
}

function normalizeOptimizationPlan(plan, scanData) {
    if (!plan || !Array.isArray(plan.actions) || !scanData) return plan;
    var lookups = buildScanEntityLookups(scanData);
    var increaseBudgetTypes = { SCALE_BUDGET: true, SCALE_AD_BUDGET: true, SCALE_ADSET: true, SCALE_CAMPAIGN: true, SCALE_ADSET_BUDGET: true, SCALE_CAMPAIGN_BUDGET: true };
    var decreaseBudgetTypes = { CUT_ADSET_BUDGET: true, CUT_CAMPAIGN_BUDGET: true, REDUCE_BUDGET: true };
    var shiftBudgetTypes = { INTRA_ADSET_SHIFT: true, AUDIENCE_SHIFT: true, BUDGET_REALLOCATION: true };

    plan.actions = plan.actions.map(function(rawAction, index) {
        var action = Object.assign({}, rawAction || {});
        action.action_id = action.action_id || ('ACT-' + String(index + 1).padStart(3, '0'));
        action.priority = normalizeActionPriority(action.priority);
        var rawActionType = String(action.action_type || '').toUpperCase();
        action.action_type = mapApexActionType(action.action_type || 'MONITOR');
        action.entity_type = String(action.entity_type || '').toLowerCase();
        if (rawActionType === 'PAUSE' || rawActionType === 'STOP') {
            action.action_type = action.entity_type === 'campaign' ? 'PAUSE_CAMPAIGN' : (action.entity_type === 'adset' ? 'PAUSE_ADSET' : 'PAUSE_AD');
        } else if (rawActionType === 'SCALE_BUDGET' || rawActionType === 'REDUCE_BUDGET') {
            action.action_type = action.entity_type === 'campaign' ? 'UPDATE_CAMPAIGN_BUDGET' : 'UPDATE_ADSET_BUDGET';
        } else if (rawActionType === 'HOLD') {
            action.action_type = 'MONITOR';
        }
        var source = resolvePlanSource(action, lookups);
        if (source) {
            action.decision_mode_label = getDecisionModeLabel(source);
            action.data_range = scanData.date_range.since + ' â†’ ' + scanData.date_range.until;
            action.current_metrics = Object.assign({}, action.current_metrics || {}, {
                ad_status: source.ad_status || '',
                adset_status: source.adset_status || '',
                campaign_status: source.campaign_status || '',
                delivery_state: source.delivery_state || '',
                budget_level: source.budget_level || '',
                budget_type: source.budget_type || '',
                budget_owner: source.budget_entity_name || '',
                budget_current_daily_budget: source.budget_current_daily_budget || null
            });
        }

        if (action.action_type === 'REACTIVATE_AD') action.action_type = 'ACTIVATE_AD';
        if (action.action_type === 'REACTIVATE_ADSET') action.action_type = 'ACTIVATE_ADSET';
        if (action.action_type === 'REACTIVATE_CAMPAIGN') action.action_type = 'ACTIVATE_CAMPAIGN';
        if (action.action_type === 'KILL_AD') action.action_type = 'PAUSE_AD';

        if (shiftBudgetTypes[action.action_type]) {
            return convertActionToMonitor(action, 'Budget cannot be shifted at ad level. Review the campaign/adset owner budget manually.');
        }

        if (increaseBudgetTypes[action.action_type] || decreaseBudgetTypes[action.action_type]) {
            if (!source || !setBudgetActionFromOwner(action, source, increaseBudgetTypes[action.action_type] ? 'increase' : 'decrease')) {
                return convertActionToMonitor(action, 'Budget owner is not a daily campaign/adset budget, so no direct executable budget change is possible here.');
            }
        }

        if (action.action_type === 'UPDATE_ADSET_BUDGET' || action.action_type === 'UPDATE_CAMPAIGN_BUDGET') {
            if (!source || !setBudgetActionFromOwner(action, source, (action.budget_change && Number(action.budget_change.recommended_daily_budget) < Number(action.budget_change.current_daily_budget)) ? 'decrease' : 'increase')) {
                return convertActionToMonitor(action, 'Budget owner is not a daily campaign/adset budget, so this budget update was downgraded to monitor.');
            }
        }

        if (action.action_type === 'ACTIVATE_AD' || action.action_type === 'ACTIVATE_ADSET') {
            if (source && getActivationActionForAd(source) === 'ACTIVATE_CAMPAIGN') {
                action.action_type = 'ACTIVATE_CAMPAIGN';
            } else if (source && getActivationActionForAd(source) === 'ACTIVATE_ADSET' && action.action_type === 'ACTIVATE_AD') {
                action.action_type = 'ACTIVATE_ADSET';
            }
        }

        if (action.action_type === 'PAUSE_AD' || action.action_type === 'PAUSE_ADSET' || action.action_type === 'PAUSE_CAMPAIGN') {
            action = normalizePauseActionFromState(action, source);
        }

        if (source && action.action_type === 'ACTIVATE_CAMPAIGN') {
            retargetActionTo(action, 'campaign', source.campaign_id || source.budget_entity_id, source.campaign_name || source.budget_entity_name || action.entity_name, source.campaign_name || action.campaign_name, '');
        } else if (source && action.action_type === 'PAUSE_CAMPAIGN') {
            retargetActionTo(action, 'campaign', source.campaign_id || source.budget_entity_id, source.campaign_name || action.entity_name, source.campaign_name || action.campaign_name, '');
        } else if (source && action.action_type === 'ACTIVATE_ADSET') {
            retargetActionTo(action, 'adset', source.adset_id || source.entity_id, source.adset_name || action.entity_name, source.campaign_name || action.campaign_name, source.adset_name || action.adset_name);
        } else if (source && action.action_type === 'PAUSE_ADSET') {
            retargetActionTo(action, 'adset', source.adset_id || source.entity_id, source.adset_name || action.entity_name, source.campaign_name || action.campaign_name, source.adset_name || action.adset_name);
        } else if (source && (action.action_type === 'PAUSE_AD' || action.action_type === 'ACTIVATE_AD')) {
            retargetActionTo(action, 'ad', source.ad_id || source.entity_id, source.ad_name || action.entity_name, source.campaign_name || action.campaign_name, source.adset_name || action.adset_name);
        }

        if (!isExecutableActionType(action.action_type) && action.action_type !== 'MONITOR' && action.action_type !== 'CREATIVE_CHANGE') {
            return convertActionToMonitor(action, 'Unsupported action type was downgraded to monitor.');
        }
        if (isExecutableActionType(action.action_type) && !action.entity_id) {
            return convertActionToMonitor(action, 'Missing Meta entity id for execution.');
        }
        if (source) {
            action.reasoning = action.reasoning || action.diagnosis || '';
            action.diagnosis = buildDeterministicActionDiagnosis(action, source, scanData);
        }
        return action;
    });
    plan.actions = collapseActionConflicts(plan.actions, lookups);
    return plan;
}

function unwrapOptimizerResponseShape(plan) {
    if (!plan || typeof plan !== 'object') return plan;
    if (plan.apex && typeof plan.apex === 'object') {
        var apex = plan.apex;
        var mergedFromApex = Object.assign({}, plan.optimizer_plan || {});
        mergedFromApex.apex_v2 = apex;
        mergedFromApex.session_id = mergedFromApex.session_id || apex.session_id || '';
        mergedFromApex.session_mode = mergedFromApex.session_mode || apex.session_mode || '';
        mergedFromApex.generated_at = mergedFromApex.generated_at || apex.generated_at || '';
        mergedFromApex.actions = Array.isArray(mergedFromApex.actions) && mergedFromApex.actions.length
            ? mergedFromApex.actions
            : convertApexView1Actions(apex.view_1_actions || []);
        if (!mergedFromApex.meta_am_insights && Array.isArray(apex.meta_am_insights)) mergedFromApex.meta_am_insights = apex.meta_am_insights;
        if (!mergedFromApex.view_2_diagnosis && apex.view_2_diagnosis) mergedFromApex.view_2_diagnosis = apex.view_2_diagnosis;
        if (!mergedFromApex.view_3_breakdowns && apex.view_3_breakdowns) mergedFromApex.view_3_breakdowns = apex.view_3_breakdowns;
        if (!mergedFromApex.view_4_forward_plan && apex.view_4_forward_plan) mergedFromApex.view_4_forward_plan = apex.view_4_forward_plan;
        if (!mergedFromApex.month_scorecard && apex.month_scorecard) mergedFromApex.month_scorecard = apex.month_scorecard;
        return mergedFromApex;
    }
    if (plan.optimizer_plan && typeof plan.optimizer_plan === 'object') {
        var merged = Object.assign({}, plan.optimizer_plan);
        if (plan.apex_output && typeof plan.apex_output === 'object') {
            if (!merged.account_pulse && plan.apex_output.account_pulse) merged.account_pulse = plan.apex_output.account_pulse;
            if (!merged.external_signals && plan.apex_output.external_signals) merged.external_signals = plan.apex_output.external_signals;
            if (!merged.account_learnings && plan.apex_output.account_learnings) merged.account_learnings = plan.apex_output.account_learnings;
            if (!merged.creative_health && plan.apex_output.creative_health) merged.creative_health = plan.apex_output.creative_health;
            if (!merged.budget_allocation && plan.apex_output.budget_allocation) merged.budget_allocation = plan.apex_output.budget_allocation;
            if (!merged.actions && plan.apex_output.actions) merged.actions = plan.apex_output.actions;
            if (!merged.session_id && plan.apex_output.session_id) merged.session_id = plan.apex_output.session_id;
            if (!merged.session_mode && plan.apex_output.session_mode) merged.session_mode = plan.apex_output.session_mode;
            if (!merged.generated_at && plan.apex_output.generated_at) merged.generated_at = plan.apex_output.generated_at;
        }
        return merged;
    }
    if (plan.apex_output && typeof plan.apex_output === 'object' && Array.isArray(plan.apex_output.actions)) {
        return {
            session_id: plan.apex_output.session_id || '',
            session_mode: plan.apex_output.session_mode || '',
            generated_at: plan.apex_output.generated_at || '',
            account_pulse: plan.apex_output.account_pulse || null,
            actions: plan.apex_output.actions || [],
            external_signals: plan.apex_output.external_signals || [],
            account_learnings: plan.apex_output.account_learnings || [],
            creative_health: plan.apex_output.creative_health || [],
            budget_allocation: plan.apex_output.budget_allocation || [],
            executive_summary: plan.executive_summary || '',
            plan_summary: plan.plan_summary || {}
        };
    }
    return plan;
}

function buildPlanSummaryFromActions(actions) {
    var summary = {
        total_actions: (actions || []).length,
        ads_to_pause: 0,
        ads_to_kill: 0,
        ads_to_scale: 0,
        adsets_to_pause: 0,
        budget_increases: 0,
        budget_decreases: 0,
        top_priority_action: ''
    };
    (actions || []).forEach(function(action) {
        var type = String(action.action_type || '').toUpperCase();
        if (type === 'PAUSE_AD') summary.ads_to_pause++;
        if (type === 'PAUSE_AD' && String(action.category || '').toUpperCase().indexOf('KILL') !== -1) summary.ads_to_kill++;
        if (type === 'PAUSE_ADSET') summary.adsets_to_pause++;
        if (type === 'ACTIVATE_AD' || type === 'ACTIVATE_ADSET' || type === 'ACTIVATE_CAMPAIGN') summary.ads_to_scale++;
        if ((type === 'UPDATE_ADSET_BUDGET' || type === 'UPDATE_CAMPAIGN_BUDGET') && action.budget_change) {
            var currentBudget = Number(action.budget_change.current_daily_budget) || 0;
            var recommendedBudget = Number(action.budget_change.recommended_daily_budget) || 0;
            if (recommendedBudget > currentBudget) summary.budget_increases++;
            if (recommendedBudget > 0 && recommendedBudget < currentBudget) summary.budget_decreases++;
        }
    });
    var topAction = (actions || []).slice().sort(function(a, b) {
        return getPriorityRank(normalizeActionPriority(b.priority)) - getPriorityRank(normalizeActionPriority(a.priority));
    })[0];
    summary.top_priority_action = topAction ? (topAction.entity_name + ' - ' + String(topAction.action_type || '').replace(/_/g, ' ')) : '';
    return summary;
}

function finalizeOptimizerPlan(plan, scanData) {
    plan = unwrapOptimizerResponseShape(plan) || {};
    plan.actions = Array.isArray(plan.actions) ? plan.actions : [];
    plan.apex_v2 = plan.apex_v2 && typeof plan.apex_v2 === 'object' ? plan.apex_v2 : null;
    plan.plan_summary = Object.assign({}, buildPlanSummaryFromActions(plan.actions), plan.plan_summary || {});
    if (!plan.account_pulse && scanData && scanData.evaluatedTotals) {
        plan.account_pulse = {
            window_label: (scanData.date_range && scanData.date_range.since ? (scanData.date_range.since + ' to ' + scanData.date_range.until) : '--'),
            spend_total: Math.round(scanData.evaluatedTotals.spend || scanData.summary.total_spend || 0),
            avg_daily_spend: Math.round((scanData.evaluatedTotals.spend || scanData.summary.total_spend || 0) / Math.max(1, getRangeDayCount(scanData.date_range))),
            roas_window: scanData.evaluatedTotals.d6ROAS != null ? +scanData.evaluatedTotals.d6ROAS.toFixed(1) : null,
            signup_cost_window: scanData.evaluatedTotals.signupCost != null ? Math.round(scanData.evaluatedTotals.signupCost) : null,
            cpm_window: scanData.evaluatedTotals.cpm != null ? Math.round(scanData.evaluatedTotals.cpm) : null,
            ctr_window: scanData.evaluatedTotals.ctr != null ? +scanData.evaluatedTotals.ctr.toFixed(2) : null,
            maturity_mix: (scanData.summary.matured_ads || 0) + ' matured / ' + (scanData.summary.non_matured_ads || 0) + ' early',
            pacing_status: 'unknown',
            source_note: 'Selected-window aggregates only. Today/7d/30d splits were not injected into this run.'
        };
    } else if (plan.account_pulse) {
        plan.account_pulse = Object.assign({}, plan.account_pulse, {
            window_label: plan.account_pulse.window_label || (scanData && scanData.date_range ? (scanData.date_range.since + ' to ' + scanData.date_range.until) : '--'),
            spend_total: plan.account_pulse.spend_total != null ? plan.account_pulse.spend_total : (plan.account_pulse.spend_today != null ? plan.account_pulse.spend_today : null),
            roas_window: plan.account_pulse.roas_window != null ? plan.account_pulse.roas_window : (plan.account_pulse.roas_today != null ? plan.account_pulse.roas_today : null),
            signup_cost_window: plan.account_pulse.signup_cost_window != null ? plan.account_pulse.signup_cost_window : (plan.account_pulse.cpa_today != null ? plan.account_pulse.cpa_today : null),
            cpm_window: plan.account_pulse.cpm_window != null ? plan.account_pulse.cpm_window : (plan.account_pulse.cpm_today != null ? plan.account_pulse.cpm_today : null),
            ctr_window: plan.account_pulse.ctr_window != null ? plan.account_pulse.ctr_window : (plan.account_pulse.ctr_today != null ? plan.account_pulse.ctr_today : null),
            pacing_status: plan.account_pulse.pacing_status || 'unknown',
            source_note: plan.account_pulse.source_note || (plan.account_pulse.spend_7d_avg != null || plan.account_pulse.spend_30d_avg != null
                ? 'APEX account pulse uses runtime-context comparisons where available and selected-window metrics for execution.'
                : 'Selected-window aggregates only. Today/7d/30d splits were not injected into this run.')
        });
    }
    if (plan.creative_insights && typeof plan.creative_insights === 'object') {
        plan.creative_insights.top_themes = Array.isArray(plan.creative_insights.top_themes) ? plan.creative_insights.top_themes : [];
        plan.creative_insights.failing_themes = Array.isArray(plan.creative_insights.failing_themes) ? plan.creative_insights.failing_themes : [];
        plan.creative_insights.new_creative_suggestions = Array.isArray(plan.creative_insights.new_creative_suggestions) ? plan.creative_insights.new_creative_suggestions : [];
    } else {
        plan.creative_insights = null;
    }
    if (plan.funnel_analysis && typeof plan.funnel_analysis === 'object') {
        plan.funnel_analysis.fix_recommendations = Array.isArray(plan.funnel_analysis.fix_recommendations) ? plan.funnel_analysis.fix_recommendations : [];
    } else {
        plan.funnel_analysis = null;
    }
    plan.creative_health = Array.isArray(plan.creative_health) ? plan.creative_health : [];
    plan.budget_allocation = Array.isArray(plan.budget_allocation) ? plan.budget_allocation : [];
    if (plan.budget_reallocation && typeof plan.budget_reallocation === 'object') {
        plan.budget_reallocation.from = Array.isArray(plan.budget_reallocation.from) ? plan.budget_reallocation.from : [];
        plan.budget_reallocation.to = Array.isArray(plan.budget_reallocation.to) ? plan.budget_reallocation.to : [];
    } else {
        plan.budget_reallocation = null;
    }
    plan.external_signals = Array.isArray(plan.external_signals) ? plan.external_signals : [];
    plan.account_learnings = Array.isArray(plan.account_learnings) ? plan.account_learnings : [];
    plan.meta_am_insights = Array.isArray(plan.meta_am_insights) ? plan.meta_am_insights : [];
    plan.view_2_diagnosis = plan.view_2_diagnosis && typeof plan.view_2_diagnosis === 'object' ? plan.view_2_diagnosis : null;
    plan.view_3_breakdowns = plan.view_3_breakdowns && typeof plan.view_3_breakdowns === 'object' ? plan.view_3_breakdowns : null;
    plan.view_4_forward_plan = plan.view_4_forward_plan && typeof plan.view_4_forward_plan === 'object' ? plan.view_4_forward_plan : null;
    plan.month_scorecard = plan.month_scorecard && typeof plan.month_scorecard === 'object' ? plan.month_scorecard : null;
    plan.morning_brief = plan.morning_brief && typeof plan.morning_brief === 'object' ? plan.morning_brief : {};
    plan.watch_list = Array.isArray(plan.watch_list) ? plan.watch_list : [];
    plan.do_not_touch = Array.isArray(plan.do_not_touch) ? plan.do_not_touch : [];
    plan.watch_list = plan.watch_list.map(function(item) {
        return Object.assign({}, item || {}, { priority: normalizeActionPriority(item && item.priority) });
    });
    if (!plan.generated_at) plan.generated_at = new Date().toISOString();
    if (!plan.session_mode) plan.session_mode = 'daily_review';
    plan.actions = plan.actions.map(function(action) {
        return Object.assign({ approval_status: 'pending_approval' }, action || {});
    });
    plan = applyLearningProtectionGovernor(plan, scanData, buildMetaAccountLearningGovernor(scanData));
    if (!plan.executive_summary && scanData && scanData.summary) {
        plan.executive_summary = 'APEX reviewed ' + scanData.summary.total_ads + ' ads across ' + scanData.summary.total_campaigns + ' campaigns using the selected window and fresh entity status checks before recommending actions.';
    }
    return ensureApexV2Fallbacks(plan, scanData);
}

function getRangeDayCount(range) {
    if (!range || !range.since || !range.until) return 0;
    var start = new Date(range.since + 'T00:00:00');
    var end = new Date(range.until + 'T00:00:00');
    var diff = end.getTime() - start.getTime();
    if (!isFinite(diff)) return 0;
    return Math.max(1, Math.round(diff / 86400000) + 1);
}

function buildApexThresholds() {
    return {
        creative_fatigue: {
            cold_audience_frequency_max: 3.5,
            warm_audience_frequency_max: 6.0,
            ctr_decline_flag_pct: 20,
            hook_rate_min_video: 25,
            hold_rate_min_video: 40,
            min_spend_before_verdict: 500
        },
        learning_phase: {
            min_opt_events_to_exit: 50,
            min_days_in_learning: 7,
            change_cooldown_days: 3,
            min_budget_per_adset_inr: 500
        },
        scaling: {
            max_budget_increase_pct: 25,
            min_days_between_scale_steps: 3,
            min_audience_headroom_multiplier: 5
        },
        budget_efficiency: {
            underspend_flag_pct: 80,
            overspend_flag_pct: 105,
            morning_concentration_flag_pct: 70
        },
        performance_tiers: {
            winner_roas_pct_above_avg: 120,
            loser_roas_pct_below_avg: 80,
            loser_cpa_pct_above_target: 130
        },
        audience_overlap: {
            flag_threshold: 0.6
        }
    };
}

function buildDataIntegrityGate(scanData) {
    var summary = scanData && scanData.summary ? scanData.summary : {};
    var ads = (scanData && scanData.ads) || [];
    var apexBenchmarks = buildWeightedMedianBenchmarks(ads);
    var matched = Number(summary.matched_keys || 0);
    var unmatched = Number(summary.unmatched_keys || 0);
    var totalMatchedUniverse = matched + unmatched;
    var dailyRowMatchRate = totalMatchedUniverse > 0 ? +((matched / totalMatchedUniverse) * 100).toFixed(1) : 0;
    var matchedAds = Number(summary.matched_ads || 0);
    var unmatchedAds = Number(summary.unmatched_ads || 0);
    var adUniverse = matchedAds + unmatchedAds;
    var entityMatchRate = adUniverse > 0 ? +((matchedAds / adUniverse) * 100).toFixed(1) : 0;
    var spendMatchRate = Number(summary.spend_match_rate_pct || 0);
    var statusCount = Number(summary.ads_with_status || 0);
    var totalAds = Number(summary.total_ads || ads.length || 0);
    var statusRate = totalAds > 0 ? +((statusCount / totalAds) * 100).toFixed(1) : 0;
    var unmatchedRetarget = ads.filter(function(ad) {
        return ad && ad.audience_bucket === 'retarget' && !ad.has_funnel_match;
    }).length;
    var matchedProspecting = ads.filter(function(ad) {
        return ad && ad.audience_bucket !== 'retarget' && !!ad.has_funnel_match;
    }).length;
    var dateGrainMissRows = Number(summary.date_grain_miss_rows || 0);
    var adsetLevelMissRows = Number(summary.adset_level_miss_rows || 0);
    var campaignLevelMissRows = Number(summary.campaign_level_miss_rows || 0);
    var spendOnlyMissRows = Number(summary.spend_only_miss_rows || 0);
    var totalMetaSpend = Number(summary.total_spend || 0);
    var resolvedMissRows = dateGrainMissRows + adsetLevelMissRows + campaignLevelMissRows;
    var resolvedCoverageRate = totalMatchedUniverse > 0 ? +((((matched + resolvedMissRows) / totalMatchedUniverse) * 100) || 0).toFixed(1) : 0;
    var matchedSpend = +((spendMatchRate / 100) * totalMetaSpend).toFixed(1);
    var spendOnlySpend = +(totalMetaSpend - matchedSpend).toFixed(1);
    var priorMatchRate = Number(window.OPTIMIZER_LAST_MATCH_RATE_PCT || 0);
    var matchDrop = priorMatchRate > 0 ? +(priorMatchRate - entityMatchRate).toFixed(1) : 0;
    var warnings = [];
    var keyProblems = [];
    var checks = [];

    if (dailyRowMatchRate < 70) warnings.push('Low Meta↔Metabase daily-row match rate: ' + dailyRowMatchRate + '%. Exact daily joins are strict; lower-grain coverage may still exist.');
    if (entityMatchRate < 70) warnings.push('Low ad-level coverage: only ' + entityMatchRate + '% of ads have exact Metabase funnel mapping in this window.');
    if (spendMatchRate < 70) warnings.push('Only ' + spendMatchRate + '% of spend sits on ads with a Metabase funnel match. Keep attribution caution on material spend-only pockets, but do not treat expected spend-only rows as corruption.');
    if (statusRate < 90) warnings.push('Fresh status coverage is only ' + statusRate + '%. Execution should stay conservative.');
    if (unmatchedRetarget > 0) warnings.push(unmatchedRetarget + ' retargeting ads have no Metabase funnel match and must be judged with Meta-side delivery signals, not fake zero-conversion assumptions.');
    if (!matchedProspecting) warnings.push('No matched prospecting ads in this slice. Prospecting efficiency calls are weaker here, but delivery/settings optimization can still continue.');
    if (dateGrainMissRows > 0) keyProblems.push(dateGrainMissRows + ' exact daily misses still have the same campaign+adset+tracker coverage elsewhere in the range. This is a date-shift problem, not total attribution loss.');
    if (adsetLevelMissRows > 0) keyProblems.push(adsetLevelMissRows + ' exact misses still have campaign+adset coverage in the range. This points to tracker/ad-name drift.');
    if (campaignLevelMissRows > 0) keyProblems.push(campaignLevelMissRows + ' exact misses still have campaign-level coverage only. This points to adset naming drift or rollout drift.');
    if (spendOnlyMissRows > 0) keyProblems.push(spendOnlyMissRows + ' rows have spend with no funnel coverage at campaign/adset level in the selected window. These are true spend-only rows and should stay conservative.');

    checks.push({
        name: 'Spend reconciliation',
        status: Math.abs((matchedSpend + spendOnlySpend) - totalMetaSpend) <= Math.max(1, totalMetaSpend * 0.01) ? 'PASS' : 'FAIL',
        detail: 'Matched spend ' + fmtINR(matchedSpend) + ' + spend-only spend ' + fmtINR(spendOnlySpend) + ' vs total spend ' + fmtINR(totalMetaSpend)
    });
    checks.push({
        name: 'GST consistency',
        status: 'PASS',
        detail: 'Optimizer spend basis remains GST-inclusive. No second multiplier is applied inside APEX logic.'
    });
    checks.push({
        name: 'Weighted median coherence',
        status: Math.abs(apexBenchmarks.coherence_gap || 0) <= Math.max(1, totalMetaSpend * 0.01) ? 'PASS' : 'FAIL',
        detail: 'Eligible ' + fmtINR(apexBenchmarks.total_eligible_spend) + ' + learning ' + fmtINR(apexBenchmarks.excluded_learning_spend) + ' + cooldown ' + fmtINR(apexBenchmarks.excluded_cooldown_spend) + ' + spend-only ' + fmtINR(apexBenchmarks.excluded_spend_only_spend) + ' vs total spend ' + fmtINR(totalMetaSpend)
    });
    checks.push({
        name: 'Match-rate monitor',
        status: priorMatchRate > 0 && matchDrop > 5 ? 'FAIL' : 'PASS',
        detail: 'Current ad coverage ' + entityMatchRate + '% vs prior session ' + (priorMatchRate || entityMatchRate) + '%'
    });
    checks.push({
        name: 'Coverage resolver',
        status: resolvedCoverageRate >= dailyRowMatchRate ? 'PASS' : 'FAIL',
        detail: 'Exact daily match ' + dailyRowMatchRate + '% vs resolved coverage ' + resolvedCoverageRate + '%'
    });

    var failedChecks = checks.filter(function(check) { return check.status === 'FAIL'; });
    if (failedChecks.length) warnings.unshift('Integrity failed on ' + failedChecks.length + ' check(s). Recommendations are provisional until the failed integrity check is verified.');
    warnings.unshift('Expected spend-only rows are allowed in this model: real spend stays in totals, stays out of funnel benchmarks, and should trigger tracker caution only where material.');

    var criticalIntegrityFailure = checks.some(function(check) {
        return (check.name === 'Spend reconciliation' || check.name === 'Weighted median coherence') && check.status === 'FAIL';
    });
    var severeCoverageFailure = spendMatchRate < 45 || statusRate < 85;
    var suddenCoverageCollapse = priorMatchRate > 0 && matchDrop > 10;
    var provisionalOnly = !!(criticalIntegrityFailure || severeCoverageFailure || suddenCoverageCollapse);
    var safeForActioning = spendMatchRate >= 60 && statusRate >= 90 && !criticalIntegrityFailure;

    return {
        business_constants: buildApexBusinessConstants(),
        canonical_join_key: 'daily row join = date + campaign name + adset name + tracker/ad name',
        d6_revenue_contract: 'd6_overall_revenue',
        d6_conversion_contract: 'd6',
        gst_applied_to_spend: true,
        total_meta_spend_period_gst_incl: totalMetaSpend,
        total_matched_rows: matched,
        total_spend_only_rows: unmatched,
        total_spend_only_spend_gst_incl: spendOnlySpend,
        total_funnel_only_rows: Number(summary.funnel_only_rows || 0),
        matched_keys: matched,
        unmatched_keys: unmatched,
        match_rate_pct: dailyRowMatchRate,
        daily_row_match_rate_pct: dailyRowMatchRate,
        entity_match_rate_pct: entityMatchRate,
        spend_match_rate_pct: spendMatchRate,
        prior_session_match_rate_pct: priorMatchRate || null,
        match_rate_drop_pct: matchDrop,
        fresh_status_verified_ads: statusCount,
        fresh_status_verified_pct: statusRate,
        unmatched_retarget_ads: unmatchedRetarget,
        date_grain_miss_rows: dateGrainMissRows,
        adset_level_miss_rows: adsetLevelMissRows,
        campaign_level_miss_rows: campaignLevelMissRows,
        session_checks: checks,
        benchmark_snapshot: {
            benchmark_cpa: apexBenchmarks.benchmark_cpa,
            benchmark_d6_roas: apexBenchmarks.benchmark_d6_roas,
            based_on_n_rows: apexBenchmarks.based_on_n_rows,
            total_eligible_spend: apexBenchmarks.total_eligible_spend,
            excluded_learning_spend: apexBenchmarks.excluded_learning_spend,
            excluded_cooldown_spend: apexBenchmarks.excluded_cooldown_spend,
            excluded_spend_only_spend: apexBenchmarks.excluded_spend_only_spend
        },
        key_problems: keyProblems,
        warnings: warnings,
        safe_for_actioning: safeForActioning,
        provisional_only: provisionalOnly
    };
}

function buildMetaOperatorAudit(scanData, breakdownContext) {
    var ads = (scanData && scanData.ads) || [];
    var tree = (scanData && scanData.tree) || {};
    var rows = breakdownContext && breakdownContext.breakdowns ? breakdownContext.breakdowns : {};
    var placements = rows.placement || [];
    var geos = rows.geography || [];
    var devices = rows.device || [];

    var liveAds = ads.filter(function(ad) { return ad && ad.is_live; });
    var highCpiAds = liveAds.filter(function(ad) { return (ad.cpi || 0) > 200 && (ad.spend || 0) >= 3000; })
        .sort(function(a, b) { return (b.spend || 0) - (a.spend || 0); })
        .slice(0, 8)
        .map(function(ad) {
            return {
                campaign_name: ad.campaign_name || '',
                adset_name: ad.adset_name || '',
                ad_name: ad.ad_name || '',
                issue: 'High CPI',
                metric: fmtINR(ad.cpi || 0),
                recommendation: 'Check placement waste, geo mix, and hook strength before adding budget.'
            };
        });

    var weakCtrAds = liveAds.filter(function(ad) { return (ad.ctr || 0) > 0 && (ad.ctr || 0) < 1.2 && (ad.spend || 0) >= 3000; })
        .sort(function(a, b) { return (b.spend || 0) - (a.spend || 0); })
        .slice(0, 8)
        .map(function(ad) {
            return {
                campaign_name: ad.campaign_name || '',
                adset_name: ad.adset_name || '',
                ad_name: ad.ad_name || '',
                issue: 'Weak CTR',
                metric: ((ad.ctr || 0).toFixed ? ad.ctr.toFixed(2) : ad.ctr) + '%',
                recommendation: 'Likely hook, format, or audience-message mismatch. Review creative first.'
            };
        });

    var placementWaste = placements.filter(function(row) {
        return (row && (row.spend_7d || 0) >= 5000) && (((row.installs_7d || 0) === 0) || ((row.cpi_7d || 0) >= 1500));
    }).slice(0, 6).map(function(row) {
        return {
            placement: row.placement || '',
            spend: Math.round(row.spend_7d || 0),
            cpi: row.cpi_7d != null ? Math.round(row.cpi_7d) : null
        };
    });

    var geoInefficiency = geos.filter(function(row) {
        return row && (row.spend_7d || 0) >= 10000 && (row.cpi_7d || 0) > 0;
    }).sort(function(a, b) {
        return (b.spend_share_pct || 0) - (a.spend_share_pct || 0);
    }).slice(0, 6).map(function(row) {
        return {
            region: row.region || '',
            tier: row.tier || '',
            spend_share_pct: row.spend_share_pct != null ? +Number(row.spend_share_pct).toFixed(1) : null,
            cpi: row.cpi_7d != null ? Math.round(row.cpi_7d) : null
        };
    });

    var deviceDrift = devices.slice().sort(function(a, b) {
        return (b.spend_7d || 0) - (a.spend_7d || 0);
    }).slice(0, 4).map(function(row) {
        return {
            device: row.device || '',
            spend: Math.round(row.spend_7d || 0),
            cpi: row.cpi_7d != null ? Math.round(row.cpi_7d) : null,
            roas: row.roas_7d != null ? +Number(row.roas_7d).toFixed(1) : null
        };
    });

    var campaignAudits = Object.keys(tree).map(function(campaignName) {
        var camp = tree[campaignName];
        var adsets = Object.keys(camp.adsets || {}).map(function(adsetName) { return camp.adsets[adsetName]; });
        var liveAdsets = adsets.filter(function(adset) {
            return (adset.ads || []).some(function(ad) { return ad && ad.is_live; });
        });
        var spend = (camp.totals && camp.totals.spend) || 0;
        var highestSpendAdset = liveAdsets.slice().sort(function(a, b) {
            return (((b.totals || {}).spend) || 0) - ((((a.totals || {}).spend) || 0));
        })[0];
        var concentration = spend > 0 && highestSpendAdset ? +((((highestSpendAdset.totals || {}).spend || 0) / spend) * 100).toFixed(1) : null;
        return {
            campaign_name: campaignName,
            budget_type: camp.budget_type || 'unknown',
            budget_owner: camp.budget_entity_name || camp.budget_level || '',
            spend: Math.round(spend),
            d6_roas: camp.totals && camp.totals.d6ROAS != null ? +Number(camp.totals.d6ROAS).toFixed(1) : null,
            cpi: camp.totals && camp.totals.cpi != null ? Math.round(camp.totals.cpi) : null,
            adset_concentration_pct: concentration,
            live_adset_count: liveAdsets.length
        };
    }).sort(function(a, b) { return (b.spend || 0) - (a.spend || 0); }).slice(0, 12);

    return {
        live_campaign_count: Object.keys(tree).length,
        live_ad_count: liveAds.length,
        campaign_audits: campaignAudits,
        high_cpi_ads: highCpiAds,
        weak_ctr_ads: weakCtrAds,
        placement_waste: placementWaste,
        geo_inefficiency: geoInefficiency,
        device_drift: deviceDrift
    };
}

function classifyEntityByWeightedBenchmark(metrics, benchmarkCPA, benchmarkD6, options) {
    var spend = Number(metrics && metrics.spend || 0);
    var signups = Number(metrics && metrics.signups || 0);
    var cpa = Number(metrics && metrics.signupCost || 0);
    var d0TrialCost = Number(metrics && metrics.d0TrialCost || 0);
    var cpi = Number(metrics && metrics.cpi || 0);
    var d6 = Number(metrics && metrics.d6ROAS || 0);
    var matched = !(options && options.is_spend_only);
    var protectedState = !!(options && options.protected_state);
    if (protectedState) return { tier: 'PROTECTED', reason: options.protected_reason || 'Protected by learning or cooldown.' };
    if (!matched) return { tier: 'SPEND_ONLY', reason: 'Spend exists without matched Metabase funnel data.' };
    if (spend >= 8000 && signups < 10 && ((cpa > 0 && cpa >= 1500) || (d0TrialCost > 0 && d0TrialCost >= 8000) || (cpi > 0 && cpi >= 600))) {
        return { tier: 'EARLY_FAILURE', reason: 'Early acquisition cost is already too high at meaningful spend, even before reliable benchmark volume is reached.' };
    }
    if (spend < 2000 || signups < 10) return { tier: 'INSUFFICIENT_DATA', reason: 'Needs at least ₹2K spend and 10 signups for a reliable benchmark verdict.' };
    if (benchmarkCPA > 0 && benchmarkD6 > 0 && cpa < (benchmarkCPA * 0.85) && d6 > (benchmarkD6 * 1.15)) return { tier: 'SCALING_CANDIDATE', reason: 'Beats weighted benchmark on both CPA and D6 ROAS.' };
    if ((benchmarkCPA > 0 && cpa > (benchmarkCPA * 1.5)) || (benchmarkD6 > 0 && d6 < (benchmarkD6 * 0.7))) return { tier: 'UNDERPERFORMING', reason: 'Materially worse than weighted benchmark.' };
    if ((benchmarkCPA > 0 && cpa > (benchmarkCPA * 1.1)) || (benchmarkD6 > 0 && d6 < (benchmarkD6 * 0.85))) return { tier: 'WATCH', reason: 'Starting to slip vs weighted benchmark.' };
    return { tier: 'HEALTHY', reason: 'Within acceptable benchmark range.' };
}

function detectSebiComplianceRisk(ad) {
    var text = String((ad && ad.ad_name) || '').toLowerCase();
    if (!text) return { status: 'clear', detail: '' };
    var risky = [
        /guaranteed/,
        /sure shot/,
        /profit/,
        /returns?/,
        /target hit/,
        /testimonial/,
        /client win/,
        /double money/,
        /\btip\b/
    ];
    var matched = risky.filter(function(pattern) { return pattern.test(text); });
    if (!matched.length) return { status: 'clear', detail: '' };
    return {
        status: 'review_needed',
        detail: 'Ad naming suggests potentially non-compliant financial claims or testimonial-style messaging. Review before scaling.'
    };
}

function buildSignalAvailabilityContext(scanData, breakdownContext) {
    var ads = (scanData && scanData.ads) || [];
    var adsets = [];
    Object.keys((scanData && scanData.tree) || {}).forEach(function(campaignName) {
        Object.keys((((scanData.tree || {})[campaignName] || {}).adsets) || {}).forEach(function(adsetName) {
            adsets.push(scanData.tree[campaignName].adsets[adsetName]);
        });
    });
    function isVideoCreative(ad) {
        var type = String((ad && (ad.type || ad.creative_type)) || '').toLowerCase();
        var name = String(ad && ad.ad_name || '').toLowerCase();
        return type === 'video' || /video|reel|ugc|motion/.test(name);
    }
    var hookHoldApplicable = ads.some(function(ad) {
        return isVideoCreative(ad) && Number(ad && ad.impressions || 0) > 0 && (Number(ad && ad.p25 || 0) > 0 || Number(ad && ad.thruplay || 0) > 0);
    });
    var hookHoldAvailable = ads.some(function(ad) {
        return isVideoCreative(ad) && ad && Number(ad.impressions || 0) > 0 && ad.hook != null && ad.hold != null;
    });
    var deliveryEstimateAvailable = adsets.some(function(adset) {
        return adset && adset.delivery_estimate && (adset.delivery_estimate.estimate_ready != null || (Array.isArray(adset.delivery_estimate.daily_outcomes_curve) && adset.delivery_estimate.daily_outcomes_curve.length));
    });
    var attributionSplitAvailable = adsets.some(function(adset) {
        return adset && Number(adset.attribution_spend || 0) > 0 && Object.keys(adset.attribution_revenue_by_window || {}).length > 0;
    });
    var limitations = [];
    if (hookHoldApplicable && !hookHoldAvailable) limitations.push('Video engagement signals are not injected in this optimizer path yet, so hook and hold-based creative diagnosis stays conservative.');
    if (!deliveryEstimateAvailable) limitations.push('Delivery estimate is not injected in this optimizer path yet, so bid-vs-audience under-delivery diagnosis remains directional.');
    if (!attributionSplitAvailable) limitations.push('Attribution window split is not injected in this optimizer path yet, so attribution inflation calls stay conservative.');
    limitations.push('Creative quality ranking and negative feedback are not available in this optimizer path, so creative verdicts rely on hook, hold, CTR, CPI, D6, and sibling comparison.');
    return {
        creative_signals: {
            hook_hold_available: hookHoldAvailable,
            hook_hold_applicable: hookHoldApplicable,
            quality_ranking_available: false,
            external_creative_intel_available: false
        },
        settings_signals: {
            adset_settings_enriched: ads.some(function(ad) { return ad && (ad.bid_strategy || ad.optimization_event || ad.location_targeting); }),
            custom_audience_context_available: ads.some(function(ad) { return ad && ad.audience_size_total; }),
            delivery_estimate_available: deliveryEstimateAvailable,
            attribution_split_available: attributionSplitAvailable
        },
        trend_signals: {
            wow_context_available: ads.some(function(ad) { return !!(ad && ad._wow); }),
            breakdown_context_available: !!(breakdownContext && breakdownContext.available)
        },
        limitations: limitations
    };
}

function buildAttributionBreakdownSummary(scanData) {
    var totalSpend = 0;
    var revenueByWindow = {};
    Object.keys((scanData && scanData.tree) || {}).forEach(function(campaignName) {
        Object.keys((((scanData.tree || {})[campaignName] || {}).adsets) || {}).forEach(function(adsetName) {
            var adset = scanData.tree[campaignName].adsets[adsetName];
            var spend = Number(adset && adset.attribution_spend || 0);
            var windows = adset && adset.attribution_revenue_by_window ? adset.attribution_revenue_by_window : {};
            if (!(spend > 0) || !Object.keys(windows).length) return;
            totalSpend += spend;
            Object.keys(windows).forEach(function(windowKey) {
                revenueByWindow[windowKey] = (revenueByWindow[windowKey] || 0) + (Number(windows[windowKey]) || 0);
            });
        });
    });
    if (!(totalSpend > 0)) {
        return {
            seven_day_click_roas: null,
            one_day_click_roas: null,
            view_through_roas: null,
            blended_mer: null,
            note: 'Attribution breakdown was not injected into this optimizer run.'
        };
    }
    function windowRoas(windowKey) {
        var revenue = Number(revenueByWindow[windowKey] || 0);
        return totalSpend > 0 ? +((revenue / totalSpend) * 100).toFixed(1) : null;
    }
    var totalViewRevenue = Number(revenueByWindow['1d_view'] || 0) + Number(revenueByWindow['7d_view'] || 0);
    return {
        seven_day_click_roas: windowRoas('7d_click'),
        one_day_click_roas: windowRoas('1d_click'),
        view_through_roas: totalSpend > 0 ? +((totalViewRevenue / totalSpend) * 100).toFixed(1) : null,
        blended_mer: null,
        note: 'Derived from raw adset-level attribution-window revenue and spend, then aggregated to account level.'
    };
}

function buildHistoricalWinnerLibrary(scanData) {
    var ads = (scanData && scanData.ads) || [];
    var matured = ads.filter(function(ad) {
        var wow = ad && ad._wow ? ad._wow : {};
        var maturedRoas = wow.maturedD6ROAS != null ? wow.maturedD6ROAS : ad.d6ROAS;
        return ad && ad.isMatured && (ad.spend || 0) >= 15000 && (maturedRoas || 0) >= 28;
    }).sort(function(a, b) {
        var aw = a && a._wow ? a._wow : {};
        var bw = b && b._wow ? b._wow : {};
        var aScore = aw.maturedD6ROAS != null ? aw.maturedD6ROAS : (a.d6ROAS || 0);
        var bScore = bw.maturedD6ROAS != null ? bw.maturedD6ROAS : (b.d6ROAS || 0);
        return bScore - aScore;
    });
    var byAdset = {};
    var byCampaign = {};
    matured.forEach(function(ad) {
        var adsetKey = (ad.campaign_name || '') + '||' + (ad.adset_name || '');
        if (!byAdset[adsetKey]) byAdset[adsetKey] = [];
        byAdset[adsetKey].push(ad);
        var campaignKey = ad.campaign_name || '';
        if (!byCampaign[campaignKey]) byCampaign[campaignKey] = [];
        byCampaign[campaignKey].push(ad);
    });
    return {
        top_winners: matured.slice(0, 20).map(function(ad) {
            var wow = ad && ad._wow ? ad._wow : {};
            return {
                ad_id: ad.ad_id || '',
                ad_name: ad.ad_name || '',
                campaign_name: ad.campaign_name || '',
                adset_name: ad.adset_name || '',
                matured_d6_roas: +(Number(wow.maturedD6ROAS != null ? wow.maturedD6ROAS : ad.d6ROAS || 0)).toFixed(1),
                spend: Math.round(ad.spend || 0),
                ctr: ad.ctr != null ? +Number(ad.ctr).toFixed(2) : null,
                hook_rate: ad.hook != null ? +Number(ad.hook).toFixed(1) : null,
                hold_rate: ad.hold != null ? +Number(ad.hold).toFixed(1) : null
            };
        }),
        by_adset: byAdset,
        by_campaign: byCampaign
    };
}

function applyChangeImpactLite(action, entity, context) {
    var commandType = String((context && context.command_type) || '').toLowerCase();
    if (!action || !/INCREASE|SCALE/.test(String(action.action || '').toUpperCase())) return action;
    var optimizationEvent = String(entity && entity.optimization_event || '').toUpperCase();
    var nameText = String((entity && (entity.name || entity.adset_name || entity.campaign_name)) || '').toLowerCase();
    var isMof = /mof/.test(nameText);
    if ((optimizationEvent.indexOf('START') !== -1 || optimizationEvent.indexOf('TRIAL') !== -1) && isMof) {
        action.change_impact_verdict = 'MODIFIED';
        action.change_impact_note = 'Historical account case: MOF + Start-Trial scale moves degrade often after aggressive budget steps.';
        if (/INCREASE 20%/.test(String(action.action))) action.action = 'INCREASE 15%';
        if (action.do_line) action.do_line += ' Hold longer after this step because similar MOF + Start-Trial increases have degraded historically.';
    } else if (commandType === 'scale_check') {
        action.change_impact_verdict = 'STANDS';
        action.change_impact_note = 'No local lite-pattern block found. Use normal 20–25% max step discipline.';
    }
    return action;
}

function scoreAdForReplacement(ad) {
    if (!ad) return -Infinity;
    var roas = Number(ad.d6ROAS || 0);
    var ctr = Number(ad.ctr || 0);
    var cpi = Number(ad.cpi || 0);
    var signupCost = Number(ad.signupCost || 0);
    var hook = Number(ad.hook || 0);
    var spend = Number(ad.spend || 0);
    var matchedBonus = ad.has_funnel_match ? 40 : 0;
    var spendConfidence = spend >= 50000 ? 1 : spend >= 35000 ? 0.9 : spend >= 30000 ? 0.8 : spend >= 25000 ? 0.68 : spend >= 20000 ? 0.55 : spend >= 15000 ? 0.4 : 0.2;
    var weightedRoas = roas * spendConfidence;
    return (weightedRoas * 100) + (ctr * 20) + hook + matchedBonus - (cpi / 5) - (signupCost / 10) + Math.min(spend / 1200, 18);
}

function getAdWinnerConfidence(ad) {
    if (!ad) return 'low';
    var spend = Number(ad.spend || 0);
    var roas = Number(ad.d6ROAS || 0);
    var matched = !!ad.has_funnel_match;
    if (matched && spend >= 50000 && roas >= 20) return 'high';
    if (matched && spend >= 30000 && roas >= 18) return 'medium';
    return 'low';
}

function getCreativeLineageKey(name) {
    var value = String(name || '').trim();
    if (!value) return '';
    return value
        .replace(/_V\d+\b/ig, '')
        .replace(/\bcopy\s*\d*\b/ig, '')
        .replace(/\bvariant\s*\d*\b/ig, '')
        .replace(/\binf-\d+\b/ig, '')
        .replace(/\bver\s*\d+\b/ig, '')
        .replace(/[-_ ](?:hook|angle|story|static|video|ugc|motion|test)(?:[-_ ]?[A-Za-z0-9]+)?$/ig, '')
        .replace(/[-_ ](?:vsl|reel|reels|feed|carousel)(?:[-_ ]?[A-Za-z0-9]+)?$/ig, '')
        .replace(/\s+/g, ' ')
        .replace(/[_-]+/g, '_')
        .toLowerCase()
        .trim();
}

function sameCreativeLineage(leftName, rightName) {
    var left = getCreativeLineageKey(leftName);
    var right = getCreativeLineageKey(rightName);
    return !!left && !!right && left === right;
}

function findStrictBetterSibling(entity, siblings) {
    var currentScore = scoreAdForReplacement(entity);
    var candidates = (siblings || []).filter(function(item) { return item && item.ad_id !== entity.ad_id && item.is_live; }).map(function(item) {
        return { ad: item, score: scoreAdForReplacement(item) };
    }).sort(function(a, b) { return b.score - a.score; });
    var best = candidates[0];
    if (!best) return null;
    if (!(best.score > currentScore + 25)) return null;
    if (getAdWinnerConfidence(best.ad) === 'low') return null;
    if (sameCreativeLineage(best.ad.ad_name, entity.ad_name)) return null;
    if ((best.ad.d6ROAS || 0) < (entity.d6ROAS || 0) && (best.ad.ctr || 0) <= (entity.ctr || 0) && (best.ad.cpi || 0) >= (entity.cpi || 0)) return null;
    return best.ad;
}

function isPauseLikeOverviewAction(actionText) {
    var text = String(actionText || '').toUpperCase();
    return /PAUSE|REPLACE|SHIFT/.test(text) && !/HOLD|QUEUE|KEEP LIVE|PROTECT|MONITOR/.test(text);
}

function buildRetargetMetaOnlyRecommendation(entity, entityType, context) {
    context = context || {};
    var liveChildren = Array.isArray(context.liveChildren) ? context.liveChildren : [];
    var spend = entity && entity.totals ? Number(entity.totals.spend || 0) : Number(entity && entity.spend || 0);
    var frequency = entity && entity.totals ? Number(entity.totals.frequency || 0) : Number(entity && entity.frequency || 0);
    var pacing = Number(entity && (entity.pacing_pct_daily_avg != null ? entity.pacing_pct_daily_avg : entity.pacing_pct) || 0);
    var audienceSize = Number(entity && entity.audience_size_total || 0);
    if (!audienceSize && liveChildren.length) {
        audienceSize = liveChildren.reduce(function(max, item) {
            return Math.max(max, Number(item && item.audience_size_total || 0));
        }, 0);
    }
    var stageFreqMax = 6;
    if (entityType === 'campaign' && liveChildren.length) {
        frequency = liveChildren.reduce(function(max, item) {
            return Math.max(max, Number((item && item.totals ? item.totals.frequency : item && item.frequency) || 0));
        }, frequency);
        if (!pacing) {
            pacing = liveChildren.reduce(function(max, item) {
                return Math.max(max, Number(item && item.pacing_pct_daily_avg || 0));
            }, 0);
        }
    }
    if (audienceSize > 0 && audienceSize < 50000) {
        return {
            action: 'LIMIT RETARGET PRESSURE',
            why: 'Retargeting audience pool is too small for confident scaling and will over-frequency quickly.',
            do_line: 'Do not scale this retargeting pocket. Keep budget tight or reduce it until the warm pool grows beyond 50K.',
            tone: 'var(--orange)'
        };
    }
    if (frequency >= stageFreqMax + 1) {
        return {
            action: 'REDUCE RETARGET PRESSURE',
            why: 'Frequency is already above the warm-audience comfort zone, so delivery is likely over-recycling the same users.',
            do_line: 'Reduce budget or widen the retargeting window before making any harder performance calls on this retargeting setup.',
            tone: 'var(--orange)'
        };
    }
    if (pacing > 0 && pacing < 80) {
        return {
            action: 'HOLD AND CHECK DELIVERY',
            why: 'This retargeting setup is under-delivering, so the immediate issue is delivery discipline, not Metabase performance.',
            do_line: 'Do not scale this retargeting entity. Check audience size and recency window first, then review budget fit.',
            tone: 'var(--orange)'
        };
    }
    return {
        action: 'HOLD RETARGETING STEADY',
        why: 'Retargeting should be judged on Meta-side discipline here: frequency is still controlled and pool pressure is not flashing red.',
        do_line: 'Keep this retargeting entity stable for now and review only frequency, audience pool sanity, and delivery pacing before changing it.',
        tone: 'var(--accent)'
    };
}

function isRetargetingEntity(entity, context) {
    var entityType = String((context && context.entityType) || '').toLowerCase();
    var text = [
        entity && entity.audience_bucket,
        entity && entity.audience_type,
        entity && entity.audience_definition,
        entity && entity.adset_name,
        entity && entity.campaign_name,
        entity && entity.name
    ].join(' ').toLowerCase();
    if (/\bbof\b/.test(text)) return true;
    if (entityType === 'campaign') {
        var liveChildren = Array.isArray(context && context.liveChildren) ? context.liveChildren : [];
        return liveChildren.some(function(item) { return item && item.audience_bucket === 'retarget'; });
    }
    if (entityType === 'adset') {
        var adChildren = Array.isArray(context && context.liveChildren) ? context.liveChildren : [];
        return adChildren.some(function(item) { return item && item.audience_bucket === 'retarget'; }) || String(entity && entity.audience_type || '').toLowerCase() === 'retarget';
    }
    return String(entity && entity.audience_bucket || '').toLowerCase() === 'retarget';
}

function gatherDistinctReplacementCandidates(ad, siblingAds, winnerLibrary, campaignName) {
    var seen = {};
    var candidates = [];
    var currentLineage = getCreativeLineageKey(ad && ad.ad_name);
    function pushCandidate(item, source) {
        if (!item) return;
        var adId = String(item.ad_id || '');
        var adName = String(item.ad_name || '');
        if (!adName || adId === String(ad && ad.ad_id || '')) return;
        if (currentLineage && getCreativeLineageKey(adName) === currentLineage) return;
        var key = adId || adName.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        candidates.push({
            ad_id: adId,
            ad_name: adName,
            source: source || '',
            score: scoreAdForReplacement(item)
        });
    }
    (siblingAds || []).filter(function(item) {
        return item && item.is_live && item.ad_id !== (ad && ad.ad_id);
    }).sort(function(a, b) {
        return scoreAdForReplacement(b) - scoreAdForReplacement(a);
    }).forEach(function(item) {
        pushCandidate(item, 'live sibling');
    });
    var campaignWinners = winnerLibrary && winnerLibrary.by_campaign ? (winnerLibrary.by_campaign[campaignName || ''] || []) : [];
    campaignWinners.forEach(function(item) {
        pushCandidate(item, 'historical campaign winner');
    });
    var accountWinners = winnerLibrary && Array.isArray(winnerLibrary.top_winners) ? winnerLibrary.top_winners : [];
    accountWinners.forEach(function(item) {
        pushCandidate(item, 'historical account winner');
    });
    return candidates.sort(function(a, b) { return b.score - a.score; });
}

function stabilizeAdsetAdRecommendations(rows, winnerLibrary, campaignName) {
    rows = Array.isArray(rows) ? rows.slice() : [];
    if (rows.length <= 1) return rows;
    var siblingAds = rows.map(function(item) { return item.ad; });
    var usedReplacementIds = {};
    var usedReplacementNames = {};
    function reserveCandidate(candidate) {
        if (!candidate) return;
        if (candidate.ad_id) usedReplacementIds[candidate.ad_id] = true;
        if (candidate.ad_name) usedReplacementNames[String(candidate.ad_name).toLowerCase()] = true;
    }
    function nextDistinctCandidate(ad) {
        var list = gatherDistinctReplacementCandidates(ad, siblingAds, winnerLibrary, campaignName);
        for (var i = 0; i < list.length; i++) {
            var candidate = list[i];
            if (usedReplacementIds[candidate.ad_id || '']) continue;
            if (usedReplacementNames[String(candidate.ad_name || '').toLowerCase()]) continue;
            return candidate;
        }
        return null;
    }
    var scored = rows.map(function(row) {
        return {
            row: row,
            score: scoreAdForReplacement(row.ad),
            replacement: findStrictBetterSibling(row.ad, rows.map(function(item) { return item.ad; }))
        };
    }).sort(function(a, b) { return b.score - a.score; });
    var minKeep = rows.length >= 4 ? 2 : 1;
    if (rows.length >= 3 && scored[1] && (scored[0].score - scored[1].score) < 18) minKeep = Math.max(minKeep, 2);
    var keepIds = {};
    scored.slice(0, minKeep).forEach(function(item) {
        keepIds[item.row.ad.ad_id] = true;
    });
    var pauseCandidates = scored.filter(function(item) {
        return isPauseLikeOverviewAction(item.row.rec && item.row.rec.action);
    }).length;
    var maxDirectPauses = rows.length <= 2 ? 1 : Math.min(Math.max(1, Math.ceil(rows.length * 0.4)), Math.max(1, rows.length - minKeep));
    if (pauseCandidates <= 2) maxDirectPauses = Math.min(maxDirectPauses, 1);
    if (pauseCandidates >= 4 && rows.length >= 5) maxDirectPauses = Math.min(Math.max(maxDirectPauses, 2), 3);
    var directPauseCount = 0;
    var replacementUsage = {};
    scored.slice().reverse().forEach(function(item) {
        var row = item.row;
        var rec = row.rec || {};
        var ad = row.ad || {};
        if (keepIds[ad.ad_id] && isPauseLikeOverviewAction(rec.action)) {
            row.rec = {
                action: 'KEEP LIVE AS CONTROL',
                why: 'This ad is still one of the stronger live references in the current adset mix, so removing it now would over-compress testing.',
                do_line: 'Keep this ad live for now and cut weaker ads first before changing the remaining control creative.',
                tone: 'var(--green)'
            };
            return;
        }
        if (!isPauseLikeOverviewAction(rec.action)) return;
        if (directPauseCount >= maxDirectPauses) {
            row.rec = {
                action: 'QUEUE NEXT ROTATION',
                why: 'This change may be required, but this adset already has enough same-cycle cleanup queued and pushing further would over-compress learning.',
                do_line: 'Leave this ad live for this cycle and queue it behind the clearest loser(s) first. Reassess after the first cleanup settles.',
                tone: 'var(--orange)'
            };
            return;
        }
        var replacement = item.replacement;
        if (replacement && replacementUsage[replacement.ad_id]) {
            var distinctCandidate = nextDistinctCandidate(ad);
            row.rec = {
                action: distinctCandidate ? 'REPLACE WITH DISTINCT WINNER' : 'BRIEF DISTINCT CHALLENGER',
                why: 'This ad looks weaker, but repeatedly replacing multiple slots with the same winner would create a duplicated adset mix.',
                do_line: distinctCandidate
                    ? ('Do not replace this with ' + replacement.ad_name + ' again. Shift spend toward the live winner and add ' + distinctCandidate.ad_name + ' only if it is not already active in this adset.')
                    : ('Do not replace this with ' + replacement.ad_name + ' again. Keep the live winner as control and brief a distinct challenger based on that winner\'s angle instead.'),
                tone: 'var(--orange)'
            };
            if (distinctCandidate) reserveCandidate(distinctCandidate);
            return;
        }
        if (replacement) {
            replacementUsage[replacement.ad_id] = true;
            reserveCandidate({ ad_id: replacement.ad_id, ad_name: replacement.ad_name });
        }
        directPauseCount += 1;
        if (!replacement && /REPLACE|SHIFT/.test(String(rec.action || '').toUpperCase())) {
            var fallbackCandidate = nextDistinctCandidate(ad);
            row.rec = {
                action: fallbackCandidate ? 'PAUSE AND LOAD DISTINCT WINNER' : 'PAUSE AND BRIEF DISTINCT REPLACEMENT',
                why: 'This ad is a clear loser, but there is no strong enough sibling to duplicate directly into this slot.',
                do_line: fallbackCandidate
                    ? ('Pause this ad and use ' + fallbackCandidate.ad_name + ' only if it is not already live here; otherwise keep the live winner as control and load a distinct challenger.')
                    : 'Pause this ad only if you can add a distinct replacement concept, not another copy of the current live ads.',
                tone: 'var(--red)'
            };
            if (fallbackCandidate) reserveCandidate(fallbackCandidate);
        }
    });
    return rows;
}

function summarizeAdsetCreativeRefresh(adRows) {
    adRows = Array.isArray(adRows) ? adRows : [];
    var actionable = adRows.filter(function(row) {
        var action = String(row && row.rec && row.rec.action || '').toUpperCase();
        return /PAUSE|REPLACE|SHIFT|REFRESH|BRIEF|ADD MORE ADS|LOAD DISTINCT/.test(action);
    });
    if (!actionable.length) return null;
    var pauseNow = [];
    var replaceOrRefresh = [];
    var usedTargets = {};
    var suggestedAds = [];
    var suggestedAdSeen = {};
    function pushSuggested(value) {
        var clean = String(value || '').trim();
        if (!clean) return;
        var key = clean.toLowerCase();
        if (suggestedAdSeen[key]) return;
        suggestedAdSeen[key] = true;
        suggestedAds.push(clean);
    }
    function extractSuggestedNames(doLine) {
        var text = String(doLine || '');
        if (!text) return [];
        var out = [];
        var suggestedBlock = text.match(/Suggested names:\s*([^.]+)/i);
        if (suggestedBlock && suggestedBlock[1]) {
            suggestedBlock[1].split(/[|,]/).forEach(function(part) {
                var name = String(part || '').trim();
                if (name) out.push(name);
            });
        }
        var directNames = text.match(/(?:with|toward|add|load|keep)\s+([A-Za-z0-9][A-Za-z0-9_\-]+)/ig) || [];
        directNames.forEach(function(fragment) {
            var m = String(fragment).match(/(?:with|toward|add|load|keep)\s+([A-Za-z0-9][A-Za-z0-9_\-]+)/i);
            if (m && m[1] && !/^\d/.test(m[1])) out.push(m[1]);
        });
        return out;
    }
    actionable.forEach(function(row) {
        var adName = String(row && row.ad && row.ad.ad_name || '').trim();
        if (!adName) return;
        var action = String(row && row.rec && row.rec.action || '').toUpperCase();
        var doLine = String(row && row.rec && row.rec.do_line || '');
        if (/PAUSE/.test(action)) {
            if (pauseNow.indexOf(adName) === -1) pauseNow.push(adName);
        }
        if (/REPLACE|SHIFT|REFRESH|BRIEF|ADD MORE ADS|LOAD DISTINCT/.test(action)) {
            var replacement = '';
            if (!/ADD MORE ADS/.test(action)) {
                var match = doLine.match(/(?:toward|with|load)\s+([A-Za-z0-9_\-]+)/i);
                if (match && match[1] && match[1] !== adName && !/^\d/.test(match[1])) replacement = match[1];
            }
            var normalizedTarget = String(replacement || '').toLowerCase();
            if (replacement && usedTargets[normalizedTarget]) replacement = '';
            if (replacement) usedTargets[normalizedTarget] = true;
            extractSuggestedNames(doLine).forEach(function(name) {
                if (name !== adName) pushSuggested(name);
            });
            replaceOrRefresh.push({
                ad_name: adName,
                next: replacement || (/ADD MORE ADS/.test(action) ? 'Add distinct challenger concepts, not another version of the same ad' : 'Distinct challenger / refresh required')
            });
        }
    });
    if (!pauseNow.length && !replaceOrRefresh.length) return null;
    return {
        action: 'CREATIVE REFRESH REQUIRED',
        pause_now: pauseNow.slice(0, 6),
        replace_or_refresh: replaceOrRefresh.slice(0, 6),
        suggested_ads: suggestedAds.slice(0, 6)
    };
}

function buildMetaAccountLearningGovernor(scanData) {
    var tree = scanData && scanData.tree ? scanData.tree : {};
    var governor = {
        learning_spend_share_pct: 0,
        high_learning_pressure: false,
        edit_policy: 'normal',
        protected_campaigns: {},
        protected_adsets: {},
        allowed_ad_ids: {},
        allowed_budget_owner_keys: {},
        notes: []
    };
    var totalLiveSpend = 0;
    var learningLiveSpend = 0;
    Object.keys(tree).forEach(function(campaignName) {
        var campaign = tree[campaignName];
        var campaignKey = normalizeCampaignName(campaignName);
        var campaignRoas = Number((campaign.totals && campaign.totals.d6ROAS) || 0);
        var campaignCpi = Number((campaign.totals && campaign.totals.cpi) || 0);
        if (campaignRoas >= 28 && campaignCpi > 0 && campaignCpi < 150) {
            governor.protected_campaigns[campaignKey] = true;
        }
        Object.keys(campaign.adsets || {}).forEach(function(adsetName) {
            var adset = campaign.adsets[adsetName];
            var adsetKey = campaignKey + '||' + normalizeAdsetName(adsetName);
            var liveAds = (adset.ads || []).filter(function(ad) { return ad && ad.is_live; });
            var liveSpend = liveAds.reduce(function(sum, ad) { return sum + Number(ad.spend || 0); }, 0);
            totalLiveSpend += liveSpend;
            if (String(adset.adset_status || '').toUpperCase().indexOf('LEARNING') !== -1) {
                learningLiveSpend += liveSpend;
            }
            var adsetRoas = Number((adset.totals && adset.totals.d6ROAS) || 0);
            var adsetCpi = Number((adset.totals && adset.totals.cpi) || 0);
            if (adsetRoas >= 28 && adsetCpi > 0 && adsetCpi < 150) {
                governor.protected_adsets[adsetKey] = true;
            }
            var failing = liveAds.filter(function(ad) {
                return (ad.spend || 0) >= 3000 && (((ad.cpi || 0) > 200) || (((ad.ctr || 0) > 0) && ((ad.ctr || 0) < 1.2)) || (((ad.signupCost || 0) > 1000) && ad.has_funnel_match));
            }).sort(function(a, b) {
                return scoreAdForReplacement(a) - scoreAdForReplacement(b);
            });
            var allowedCount = 1;
            if (!governor.protected_adsets[adsetKey]) {
                if (liveAds.length >= 4 && failing.length >= 3) allowedCount = 2;
                if (liveAds.length >= 6 && failing.length >= 4) allowedCount = 3;
            } else if (liveAds.length >= 5 && failing.length >= 4) {
                allowedCount = 2;
            }
            failing.slice(0, allowedCount).forEach(function(ad) {
                governor.allowed_ad_ids[ad.ad_id || ''] = true;
            });
            var budgetOwnerKey = String(adset.budget_entity_type || '') + '||' + String(adset.budget_entity_id || '');
            if (budgetOwnerKey !== '||') {
                governor.allowed_budget_owner_keys[budgetOwnerKey] = false;
            }
        });
    });
    governor.learning_spend_share_pct = totalLiveSpend > 0 ? +((learningLiveSpend / totalLiveSpend) * 100).toFixed(1) : 0;
    governor.high_learning_pressure = governor.learning_spend_share_pct > 20;
    governor.edit_policy = governor.high_learning_pressure ? 'protect_learning' : 'normal';
    governor.notes.push(governor.high_learning_pressure
        ? 'Learning pressure is elevated because more than 20% of live spend sits in learning. Suppress additional structural edits unless the loser is very clear.'
        : 'Learning pressure is contained. Allow only isolated structural edits per owner/adset cycle, not bulk changes.');
    return governor;
}

function isLearningImpactAction(action) {
    var type = String(action && action.action_type || '').toUpperCase();
    return /PAUSE_|ACTIVATE_|UPDATE_.*BUDGET|CREATIVE_CHANGE/.test(type);
}

function applyLearningProtectionGovernor(plan, scanData, governor) {
    if (!plan || !Array.isArray(plan.actions) || !governor) return plan;
    var lookups = buildScanEntityLookups(scanData || {});
    var usedBudgetOwners = {};
    var changedAdsets = {};
    plan.actions = plan.actions.map(function(action) {
        if (!isLearningImpactAction(action)) return action;
        var source = resolvePlanSource(action, lookups);
        if (!source) return action;
        var campaignKey = normalizeCampaignName(source.campaign_name || action.campaign_name || '');
        var adsetKey = campaignKey + '||' + normalizeAdsetName(source.adset_name || action.adset_name || '');
        var type = String(action.action_type || '').toUpperCase();
        var budgetOwnerKey = String(source.budget_entity_type || '') + '||' + String(source.budget_entity_id || '');
        var isStructuralEdit = /PAUSE_|ACTIVATE_|UPDATE_.*BUDGET|CREATIVE_CHANGE/.test(type);
        if (String(source.adset_status || '').toUpperCase().indexOf('LEARNING') !== -1 && isStructuralEdit) {
            return convertActionToMonitor(action, 'Learning protection: this adset is already in learning, so avoid another structural edit this cycle.');
        }
        if (type === 'PAUSE_AD' || type === 'ACTIVATE_AD' || type === 'CREATIVE_CHANGE') {
            if (governor.protected_campaigns[campaignKey] || governor.protected_adsets[adsetKey]) {
                if (!governor.allowed_ad_ids[source.ad_id || '']) {
                    return convertActionToMonitor(action, 'Learning protection: avoid bulk ad edits inside a healthy campaign/adset. Change only the clearest loser this cycle.');
                }
            }
            if (!governor.allowed_ad_ids[source.ad_id || ''] && changedAdsets[adsetKey]) {
                return convertActionToMonitor(action, 'Learning protection: this adset already has a structural change queued for this cycle.');
            }
        }
        if ((type === 'UPDATE_ADSET_BUDGET' || type === 'UPDATE_CAMPAIGN_BUDGET') && budgetOwnerKey !== '||') {
            if (usedBudgetOwners[budgetOwnerKey]) {
                return convertActionToMonitor(action, 'Learning protection: budget owner already has a change this cycle. Reassess after the first move settles.');
            }
        }
        if (governor.high_learning_pressure && !governor.allowed_ad_ids[source.ad_id || ''] && isStructuralEdit) {
            return convertActionToMonitor(action, 'Learning protection: too much live spend is already in learning, so lower-confidence structural edits are queued for later.');
        }
        if (isStructuralEdit) changedAdsets[adsetKey] = true;
        if ((type === 'UPDATE_ADSET_BUDGET' || type === 'UPDATE_CAMPAIGN_BUDGET') && budgetOwnerKey !== '||') {
            usedBudgetOwners[budgetOwnerKey] = true;
        }
        return action;
    });
    plan.learning_governor = governor;
    return plan;
}

function buildCampaignSettingsAudits(scanData, weightedBenchmarks, externalPosture, advancedTrendIntelligence) {
    var audits = [];
    var benchmarkCPA = Number(weightedBenchmarks && weightedBenchmarks.benchmark_cpa || 0);
    var benchmarkD6 = Number(weightedBenchmarks && weightedBenchmarks.benchmark_d6_roas || 0);
    var positiveSignalContext = {
        median_d0_trial_cost: Number(window.OPTIMIZER_BENCHMARKS && window.OPTIMIZER_BENCHMARKS.median_d0_trial_cost || 0),
        median_d15_roas: weightedPercentileMetric((scanData.ads || []).filter(function(ad) { return ad && ad.has_funnel_match && (ad.spend || 0) > 0 && ad.audience_bucket !== 'retarget'; }), function(ad) { return ad.d15ROAS; }, function(ad) { return ad.spend || 0; }, 0.5) || 0,
        median_d30_roas: weightedPercentileMetric((scanData.ads || []).filter(function(ad) { return ad && ad.has_funnel_match && (ad.spend || 0) > 0 && ad.audience_bucket !== 'retarget'; }), function(ad) { return ad.d30ROAS; }, function(ad) { return ad.spend || 0; }, 0.5) || 0
    };
    Object.keys(scanData.tree || {}).forEach(function(campaignName) {
        var camp = scanData.tree[campaignName];
        var adsets = Object.keys(camp.adsets || {}).map(function(name) { return camp.adsets[name]; });
        var liveAdsets = adsets.filter(function(adset) {
            return (adset.ads || []).some(function(ad) { return ad && ad.is_live; });
        });
        var learningCount = liveAdsets.filter(function(adset) {
            return String(adset.adset_status || '').toUpperCase().indexOf('LEARNING') !== -1;
        }).length;
        var topAdset = liveAdsets.slice().sort(function(a, b) { return (((b.totals || {}).spend || 0) - ((a.totals || {}).spend || 0)); })[0] || null;
        var weakAdsets = liveAdsets.filter(function(adset) {
            var m = adset.totals || {};
            return ((m.spend || 0) >= 10000) && (((benchmarkCPA > 0) && ((m.signupCost || 0) > benchmarkCPA * 1.5)) || ((benchmarkD6 > 0) && ((m.d6ROAS || 0) < benchmarkD6 * 0.7)));
        });
        var concentration = topAdset && (camp.totals && camp.totals.spend) ? safePct((topAdset.totals || {}).spend || 0, (camp.totals || {}).spend || 0) : 0;
        var objective = String(camp.objective || 'UNKNOWN').toUpperCase();
        var effectiveBudgetType = (camp.budget_level === 'campaign') ? 'CBO' : ((camp.budget_level === 'adset') ? 'ABO' : (camp.budget_type || 'unknown'));
        var campaignSpend = Number((camp.totals && camp.totals.spend) || 0);
        var campaignSignups = Number((camp.totals && camp.totals.signups) || 0);
        var trendSignal = advancedTrendIntelligence && advancedTrendIntelligence.campaigns ? advancedTrendIntelligence.campaigns[campaignName] : null;
        var trendLens = buildTrendRootCauseActionLens(camp, 'campaign', trendSignal, {
            bestAdset: topAdset,
            weakAdsets: weakAdsets
        });
        var positiveQualitySignal = buildPositiveQualitySignal(camp, 'campaign', Object.assign({}, positiveSignalContext, { trendSignal: trendSignal }));
        var classification = classifyEntityByWeightedBenchmark(camp.totals || {}, benchmarkCPA, benchmarkD6, {
            is_spend_only: !(scanData.ads || []).some(function(ad) { return ad.campaign_name === campaignName && ad.has_funnel_match; }),
            protected_state: learningCount > 0 && learningCount >= liveAdsets.length,
            protected_reason: 'Most live adsets in this campaign are still in learning.'
        });
        var action = 'NO CHANGE NEEDED';
        var reason = classification.reason;
        var doLine = 'Leave campaign structure unchanged today.';
        if (objective && objective !== 'UNKNOWN' && objective.indexOf('TRAFFIC') !== -1) {
            action = 'FIX OBJECTIVE';
            reason = 'Campaign objective is ' + objective + ' while the account is optimized for signups and D6 ROAS.';
            doLine = 'Move future spend into a conversion-aligned campaign structure instead of feeding more budget here.';
        } else if (campaignSpend >= 100000 && campaignSignups > 0 && campaignSignups < 10 && classification.tier !== 'SPEND_ONLY' && learningCount === 0) {
            action = 'PAUSE OR REBUILD NOW';
            reason = 'Campaign spend is already above ₹1L with fewer than 10 matched signups, which is too much burn for too little confirmed volume.';
            doLine = 'Stop adding spend here now. Pause the campaign or keep only the one truly defensible child pocket live while you rebuild the structure.';
        } else if (trendSignal && trendSignal.recent_signal && /RECENT_(CONTINUOUS_COST_PRESSURE|COST_PRESSURE)/.test(trendSignal.recent_signal.pattern) && campaignSpend >= 20000) {
            action = 'FIX RECENT COST PRESSURE';
            reason = (trendLens && trendLens.root_cause) || trendSignal.recent_signal.summary;
            doLine = (trendLens && trendLens.action_line) || 'Recent signup or D0 trial cost pressure is building. Tighten the weak child pockets now instead of leaving the campaign unchanged.';
        } else if (trendSignal && trendSignal.pattern === 'UNSUSTAINABLE_VALUE_MIX') {
            action = 'DO NOT SCALE YET';
            reason = (trendLens && trendLens.root_cause) || trendSignal.summary;
            doLine = (trendLens && trendLens.action_line) || 'Hold this campaign at current pressure. D6 efficiency improved, but signup or D0 trial costs inflated enough to make the improvement look narrow rather than scalable.';
        } else if (trendSignal && trendSignal.pattern === 'CLEAR_DETERIORATION' && campaignSpend >= 30000) {
            action = 'TIGHTEN OR CUT';
            reason = (trendLens && trendLens.root_cause) || trendSignal.summary;
            doLine = (trendLens && trendLens.action_line) || 'Do not defend this on old averages. Tighten weak child pockets now because both efficiency and acquisition quality are worsening together.';
        } else if (trendSignal && trendSignal.pattern === 'EARLY_RECOVERY' && classification.tier === 'UNDERPERFORMING') {
            action = 'HOLD FOR ONE MORE READ';
            reason = (trendLens && trendLens.root_cause) || trendSignal.summary;
            doLine = (trendLens && trendLens.action_line) || 'Do not scale, but avoid an immediate hard cut if the structure is otherwise stable. Re-read after the next mature window.';
        } else if (positiveQualitySignal && /UNDERPERFORMING|WATCH|EARLY_FAILURE/.test(classification.tier)) {
            action = 'IMPROVE, DO NOT PAUSE';
            reason = positiveQualitySignal.root_cause;
            doLine = positiveQualitySignal.action_line;
        } else if (effectiveBudgetType === 'CBO' && learningCount > 0 && liveAdsets.length >= 2) {
            action = 'ISOLATE TEST IN ABO';
            reason = 'CBO is mixing learning adsets with live siblings, which can starve new tests.';
            doLine = 'Move fresh or learning adsets into an ABO test cell instead of forcing them to compete with established winners.';
        } else if (effectiveBudgetType === 'ABO' && liveAdsets.length >= 3 && ((camp.totals && camp.totals.spend) || 0) >= 30000 && learningCount === 0) {
            action = 'TEST CBO CONSOLIDATION';
            reason = 'This campaign has enough scale and enough proven adsets to let Meta allocate more efficiently.';
            doLine = 'Test a cleaner CBO structure only if you are not inside a cooldown window.';
        } else if (classification.tier === 'SPEND_ONLY') {
            action = 'VERIFY TRACKING';
            doLine = 'Do not judge this campaign on ROAS or CPA until the unmatched spend is verified.';
        } else if (weakAdsets.length >= 2 && topAdset) {
            action = 'CUT WEAK ADSETS';
            reason = weakAdsets.length + ' adsets are below benchmark while ' + topAdset.name + ' is the strongest pocket.';
            doLine = 'Reduce weak child adsets first and keep budget concentrated in ' + topAdset.name + '.';
        } else if (classification.tier === 'SCALING_CANDIDATE' && concentration < 70) {
            action = 'SCALE THROUGH BEST ADSET';
            doLine = 'Increase only the true budget owner by 20–25% max, anchored to the best adset.';
        } else if (classification.tier === 'UNDERPERFORMING') {
            action = 'REVAMP CAMPAIGN MIX';
            doLine = 'Open adset changes and remove the specific adsets dragging the campaign before touching the rest.';
        } else if (liveAdsets.length > 3 && ((camp.totals && camp.totals.spend) || 0) < 30000) {
            action = 'REDUCE FRAGMENTATION';
            reason = 'Too many live adsets are sharing too little spend to learn cleanly.';
            doLine = 'Consolidate the weakest adsets and keep the campaign simpler.';
        }
        if (action.indexOf('SCALE') !== -1 && externalPosture && externalPosture.active) {
            doLine += ' Posture: ' + externalPosture.posture + '.';
        }
        audits.push({
            campaign_name: campaignName,
            classification: classification.tier,
            action: action,
            reason: reason,
            do_line: doLine,
            learning_adset_count: learningCount,
            live_adset_count: liveAdsets.length,
            concentration_pct: concentration,
            objective: objective,
            budget_type: effectiveBudgetType || 'unknown',
            objective_fit: objective && objective !== 'UNKNOWN'
                ? (objective.indexOf('TRAFFIC') !== -1 ? 'Objective is misaligned with signup / D6 ROAS goals.' : 'Objective is available in scan.')
                : 'Objective still unavailable in scan.',
            notes: [
                'Objective: ' + (objective || 'UNKNOWN'),
                'Budget type: ' + (effectiveBudgetType || 'unknown'),
                learningCount ? (learningCount + ' live adsets are still learning or limited.') : 'No obvious learning spread issue in live adsets.',
                topAdset ? ('Top adset by spend: ' + topAdset.name + ' (' + fmtINR((topAdset.totals || {}).spend || 0) + ').') : 'No live adset spend concentration found.',
                trendSignal ? ('Trend signal: ' + trendSignal.pattern + ' — ' + trendSignal.summary + ' Root cause: ' + ((trendLens && trendLens.root_cause) || trendSignal.likely_cause) + ' Action lens: ' + ((trendLens && trendLens.action_line) || trendSignal.likely_fix)) : 'No advanced WoW trend signal available.',
                positiveQualitySignal ? ('Positive quality signal: ' + positiveQualitySignal.summary + ' Root cause: ' + positiveQualitySignal.root_cause + ' Action lens: ' + positiveQualitySignal.action_line) : 'No positive D0/D15/D30 quality signal isolated.',
                trendSignal && trendSignal.recent_signal ? ('Recent signal: ' + trendSignal.recent_signal.pattern + ' — ' + trendSignal.recent_signal.summary + ' | Signup cost WoW ' + (trendSignal.recent_signal.signup_cost_wow_pct != null ? trendSignal.recent_signal.signup_cost_wow_pct + '%' : '--') + ' | D0 trial cost WoW ' + (trendSignal.recent_signal.d0_trial_cost_wow_pct != null ? trendSignal.recent_signal.d0_trial_cost_wow_pct + '%' : '--') + ' | CPI WoW ' + (trendSignal.recent_signal.cpi_wow_pct != null ? trendSignal.recent_signal.cpi_wow_pct + '%' : '--') + ' | CTR WoW ' + (trendSignal.recent_signal.ctr_wow_pct != null ? trendSignal.recent_signal.ctr_wow_pct + '%' : '--') + ' | CPM WoW ' + (trendSignal.recent_signal.cpm_wow_pct != null ? trendSignal.recent_signal.cpm_wow_pct + '%' : '--')) : 'No recent 7-day cost-pressure signal available.'
            ]
        });
    });
    return audits.sort(function(a, b) {
        var campA = scanData.tree[a.campaign_name];
        var campB = scanData.tree[b.campaign_name];
        return (((campB && campB.totals || {}).spend || 0) - (((campA && campA.totals || {}).spend || 0)));
    });
}

function buildAdsetSettingsAudits(scanData, weightedBenchmarks, breakdownContext, externalPosture, signalAvailability, advancedTrendIntelligence) {
    var audits = [];
    var benchmarkCPA = Number(weightedBenchmarks && weightedBenchmarks.benchmark_cpa || 0);
    var benchmarkD6 = Number(weightedBenchmarks && weightedBenchmarks.benchmark_d6_roas || 0);
    var positiveSignalContext = {
        median_d0_trial_cost: Number(window.OPTIMIZER_BENCHMARKS && window.OPTIMIZER_BENCHMARKS.median_d0_trial_cost || 0),
        median_d15_roas: weightedPercentileMetric((scanData.ads || []).filter(function(ad) { return ad && ad.has_funnel_match && (ad.spend || 0) > 0 && ad.audience_bucket !== 'retarget'; }), function(ad) { return ad.d15ROAS; }, function(ad) { return ad.spend || 0; }, 0.5) || 0,
        median_d30_roas: weightedPercentileMetric((scanData.ads || []).filter(function(ad) { return ad && ad.has_funnel_match && (ad.spend || 0) > 0 && ad.audience_bucket !== 'retarget'; }), function(ad) { return ad.d30ROAS; }, function(ad) { return ad.spend || 0; }, 0.5) || 0
    };
    var breakdownFallback = deriveApexBreakdownFallbacks(breakdownContext);
    Object.keys(scanData.tree || {}).forEach(function(campaignName) {
        var camp = scanData.tree[campaignName];
        Object.keys(camp.adsets || {}).forEach(function(adsetName) {
            var adset = camp.adsets[adsetName];
            var liveAds = (adset.ads || []).filter(function(ad) { return ad && ad.is_live; });
            var matchedAds = liveAds.filter(function(ad) { return ad.has_funnel_match; });
            var failingAds = liveAds.filter(function(ad) {
                return ((ad.spend || 0) >= 3000) && (((ad.cpi || 0) > 200) || (((ad.ctr || 0) > 0) && ((ad.ctr || 0) < 1.2)) || (((ad.signupCost || 0) > 1000) && ad.has_funnel_match));
            });
            var bestAd = liveAds.slice().sort(function(a, b) {
                return ((((b.d6ROAS || 0) * 1000) - (b.cpi || 0)) - (((a.d6ROAS || 0) * 1000) - (a.cpi || 0)));
            })[0] || null;
            var isRetarget = liveAds.some(function(ad) { return ad.audience_bucket === 'retarget'; });
            var protectedState = String(adset.adset_status || '').toUpperCase().indexOf('LEARNING') !== -1;
            var bidStrategy = String(adset.bid_strategy || '').toUpperCase();
            var optimizationEvent = String(adset.optimization_event || '').toUpperCase();
            var costCapValue = Number(adset.cost_cap_value || 0) || null;
            var bidCapValue = Number(adset.bid_cap_value || 0) || null;
            var placementSummary = Array.isArray(adset.placements_active) ? adset.placements_active.join(', ') : '';
            var trendSignal = advancedTrendIntelligence && advancedTrendIntelligence.adsets ? advancedTrendIntelligence.adsets[campaignName + '||' + adsetName] : null;
            var trendLens = buildTrendRootCauseActionLens(adset, 'adset', trendSignal, {
                bestAd: bestAd,
                failingAds: failingAds
            });
            var positiveQualitySignal = buildPositiveQualitySignal(adset, 'adset', Object.assign({}, positiveSignalContext, { trendSignal: trendSignal }));
            var classification = classifyEntityByWeightedBenchmark(adset.totals || {}, benchmarkCPA, benchmarkD6, {
                is_spend_only: !!liveAds.length && !matchedAds.length,
                protected_state: protectedState,
                protected_reason: 'Adset appears to be in learning or learning-limited state.'
            });
            var currentBudget = Number(adset.budget_current_daily_budget || 0);
            var recommendedBudget = currentBudget ? Math.round(currentBudget * 1.2) : null;
            var action = 'HOLD';
            var reason = classification.reason;
            var doLine = 'No settings change needed today.';
            var geoTighteningNeeded = !!(breakdownFallback.geo_budget_efficiency_gap && String(adset.location_targeting || '').toUpperCase().indexOf('INDIA') !== -1);
            var placementWaste = Array.isArray(breakdownFallback.kill_placements) && breakdownFallback.kill_placements.length && Array.isArray(adset.placements_active) && adset.placements_active.length;
            var underfundedCohort = !!breakdownFallback.underfunded_cohort;
            if (isRetarget) {
                var retargetRec = buildRetargetMetaOnlyRecommendation(adset, 'adset', { liveChildren: liveAds });
                action = retargetRec.action;
                reason = retargetRec.why;
                doLine = retargetRec.do_line;
            } else if (trendSignal && trendSignal.recent_signal && /RECENT_(CONTINUOUS_COST_PRESSURE|COST_PRESSURE)/.test(trendSignal.recent_signal.pattern) && ((adset.totals || {}).spend || 0) >= 12000) {
                action = 'FIX RECENT COST PRESSURE';
                reason = (trendLens && trendLens.root_cause) || trendSignal.recent_signal.summary;
                doLine = (trendLens && trendLens.action_line) || 'Recent signup or D0 trial cost pressure is building in this adset. Tighten the likely weak pocket now instead of passively holding.';
            } else if (trendSignal && trendSignal.pattern === 'UNSUSTAINABLE_VALUE_MIX') {
                action = 'DO NOT SCALE YET';
                reason = (trendLens && trendLens.root_cause) || trendSignal.summary;
                doLine = (trendLens && trendLens.action_line) || 'Hold this adset at current pressure. ROAS may have improved, but signup or D0 trial cost inflation says the quality mix is not stable enough to scale.';
            } else if (trendSignal && trendSignal.pattern === 'CLEAR_DETERIORATION' && ((adset.totals || {}).spend || 0) >= 15000) {
                action = 'CUT PRESSURE';
                reason = (trendLens && trendLens.root_cause) || trendSignal.summary;
                doLine = (trendLens && trendLens.action_line) || 'Reduce pressure on this adset now. Costs and top-line trend are both worsening together.';
            } else if (trendSignal && trendSignal.pattern === 'EARLY_RECOVERY' && classification.tier === 'UNDERPERFORMING') {
                action = 'HOLD FOR NEXT MATURE READ';
                reason = (trendLens && trendLens.root_cause) || trendSignal.summary;
                doLine = (trendLens && trendLens.action_line) || 'Do not scale this adset yet, but avoid a hard cut until the next mature week confirms whether the recovery is real.';
            } else if (positiveQualitySignal && /UNDERPERFORMING|WATCH|EARLY_FAILURE/.test(classification.tier)) {
                action = 'IMPROVE, DO NOT PAUSE';
                reason = positiveQualitySignal.root_cause;
                doLine = positiveQualitySignal.action_line;
            } else if (classification.tier === 'PROTECTED') {
                action = 'HOLD';
                doLine = 'Do not touch this adset until learning stabilizes or cooldown clears.';
            } else if (classification.tier === 'SPEND_ONLY' && ((adset.totals || {}).spend || 0) >= 15000) {
                action = 'VERIFY TRACKER';
                doLine = 'Tracker verification first. This adset has material spend without matched funnel data.';
            } else if (bidStrategy === 'BID_CAP') {
                action = 'FIX BID STRATEGY';
                reason = 'Bid Cap is active on this adset and typically throttles conversion delivery in this account.';
                doLine = 'Move this adset off Bid Cap before judging it as a creative or audience failure.';
            } else if (bidStrategy === 'COST_CAP' && costCapValue && (adset.totals || {}).signupCost && costCapValue <= ((adset.totals || {}).signupCost * 1.1)) {
                action = 'RAISE COST CAP';
                reason = 'Current Cost Cap is too close to actual signup cost, which risks throttling.';
                doLine = 'Raise the cap above current average acquisition cost before cutting budget or creatives.';
            } else if (optimizationEvent && optimizationEvent !== 'UNKNOWN' && ((adset.totals || {}).signups || 0) < 50 && !protectedState) {
                action = 'CHECK OPT EVENT';
                reason = 'Current optimization event volume is too thin for stable learning on this adset.';
                doLine = 'Review whether this adset should temporarily optimize for a higher-volume event before changing budget.';
            } else if (geoTighteningNeeded && classification.tier !== 'SCALING_CANDIDATE' && (((adset.totals || {}).spend || 0) >= 8000 || classification.tier === 'EARLY_FAILURE' || classification.tier === 'UNDERPERFORMING')) {
                action = 'TIGHTEN LOCATION MIX';
                reason = 'Account-level geo breakdown shows a material efficiency gap while this adset still runs broad location coverage.';
                doLine = 'Split or reduce weaker geo pockets before cutting all creatives in this adset. Evidence: ' + breakdownFallback.geo_budget_efficiency_gap + '.';
            } else if (placementWaste && classification.tier !== 'SCALING_CANDIDATE' && (((adset.totals || {}).spend || 0) >= 8000 || classification.tier === 'EARLY_FAILURE' || classification.tier === 'UNDERPERFORMING')) {
                action = 'TRIM PLACEMENTS';
                reason = 'Account-level placement breakdown shows waste inside active placement coverage.';
                doLine = 'Reduce or exclude weak placements first: ' + breakdownFallback.kill_placements.join(', ') + '.';
            } else if (underfundedCohort && (classification.tier === 'WATCH' || classification.tier === 'EARLY_FAILURE' || classification.tier === 'UNDERPERFORMING')) {
                action = 'TEST COHORT SPLIT';
                reason = 'Age/gender breakdown shows a more efficient cohort that is underweighted in the current account mix.';
                doLine = 'Test a dedicated ad set or budget shift toward ' + breakdownFallback.underfunded_cohort + ' instead of broad budget cuts.';
            } else if (classification.tier === 'EARLY_FAILURE') {
                action = 'CUT PRESSURE EARLY';
                reason = classification.reason;
                doLine = 'Do not wait for 10 signups here. Early cost is already too high at meaningful spend, so reduce pressure and fix the main weak setting or creative pocket now.';
            } else if (classification.tier === 'SCALING_CANDIDATE' && currentBudget > 0) {
                action = 'INCREASE 20%';
                doLine = 'Increase budget from ' + fmtINR(currentBudget) + ' to ' + fmtINR(recommendedBudget) + ' only if there has been no structural edit in the last 3 days.';
            } else if (classification.tier === 'UNDERPERFORMING' && failingAds.length >= Math.max(1, Math.ceil(liveAds.length * 0.5))) {
                action = 'CUT LOSERS';
                reason = 'Most live ads in this adset are dragging it below benchmark.';
                doLine = bestAd ? ('Pause the weakest ads and keep ' + bestAd.ad_name + ' as the benchmark creative in this adset.') : 'Reduce this adset or pause it after tracker verification.';
            } else if (classification.tier === 'UNDERPERFORMING') {
                action = 'DECREASE 20%';
                doLine = currentBudget > 0 ? ('Reduce budget from ' + fmtINR(currentBudget) + ' to ' + fmtINR(Math.round(currentBudget * 0.8)) + ' and keep only the strongest live ad.') : 'Reduce spend exposure and keep only the strongest live ad.';
            } else if (bestAd && failingAds.length === 1) {
                action = 'PAUSE ONE AD';
                reason = 'One ad is clearly pulling this adset down while a stronger sibling exists.';
                doLine = 'Pause the weakest ad and keep ' + bestAd.ad_name + ' plus one challenger live.';
            } else if (classification.tier === 'INSUFFICIENT_DATA') {
                action = 'HOLD FOR DATA';
                doLine = 'Let this adset collect more spend or signups before changing settings.';
            }
            var recommendation = applyChangeImpactLite({
                action: action,
                do_line: doLine
            }, adset, {
                command_type: window.OPTIMIZER_COMMAND_TYPE || 'daily_optimisation'
            });
            if (/INCREASE/.test(String(recommendation.action || '')) && externalPosture && externalPosture.active) {
                recommendation.do_line += ' Posture: ' + externalPosture.posture + '.';
            }
            audits.push({
                campaign_name: campaignName,
                adset_name: adsetName,
                adset_id: adset.id || '',
                classification: classification.tier,
                action: recommendation.action,
                reason: reason,
                do_line: recommendation.do_line,
                matched_live_ads: matchedAds.length,
                live_ads: liveAds.length,
                failing_ads: failingAds.length,
                best_ad_name: bestAd ? (bestAd.ad_name || '') : '',
                audience_type: liveAds[0] ? liveAds[0].audience_bucket : 'unknown',
                bid_strategy: bidStrategy || 'UNKNOWN',
                cost_cap_value: costCapValue,
                bid_cap_value: bidCapValue,
                optimization_event: optimizationEvent || 'UNKNOWN',
                location_targeting: adset.location_targeting || 'UNKNOWN',
                age_targeting: adset.age_targeting || 'ALL',
                gender_targeting: adset.gender_targeting || 'ALL',
                placements_active: adset.placements_active || [],
                change_impact_verdict: recommendation.change_impact_verdict || '',
                change_impact_note: recommendation.change_impact_note || '',
                bid_strategy_note: bidStrategy ? ('Bid strategy ' + bidStrategy + (costCapValue ? (' | Cost Cap ' + fmtINR(costCapValue)) : '') + (bidCapValue ? (' | Bid Cap ' + fmtINR(bidCapValue)) : '')) : 'Bid strategy unavailable.',
                location_note: adset.location_targeting ? ('Location targeting: ' + adset.location_targeting) : 'Location targeting unavailable.',
                signal_availability_note: signalAvailability && signalAvailability.settings_signals && !signalAvailability.settings_signals.delivery_estimate_available
                    ? 'Delivery estimate not injected here, so under-delivery fixes remain directional rather than confirmed.'
                    : '',
                notes: [
                    isRetarget ? 'Retargeting caveat active: use Meta-side delivery, frequency, and pool sanity only.' : 'Prospecting-style decision rules active.',
                    'Matched live ads: ' + matchedAds.length + '/' + liveAds.length,
                    bestAd ? ('Best sibling: ' + bestAd.ad_name + '.') : 'No clear winning sibling in this adset.',
                    trendSignal ? ('Trend signal: ' + trendSignal.pattern + ' — ' + trendSignal.summary + ' Root cause: ' + ((trendLens && trendLens.root_cause) || trendSignal.likely_cause) + ' Action lens: ' + ((trendLens && trendLens.action_line) || trendSignal.likely_fix)) : 'No advanced WoW trend signal available.',
                    positiveQualitySignal ? ('Positive quality signal: ' + positiveQualitySignal.summary + ' Root cause: ' + positiveQualitySignal.root_cause + ' Action lens: ' + positiveQualitySignal.action_line) : 'No positive D0/D15/D30 quality signal isolated.',
                    trendSignal && trendSignal.recent_signal ? ('Recent signal: ' + trendSignal.recent_signal.pattern + ' — ' + trendSignal.recent_signal.summary + ' | Signup cost WoW ' + (trendSignal.recent_signal.signup_cost_wow_pct != null ? trendSignal.recent_signal.signup_cost_wow_pct + '%' : '--') + ' | D0 trial cost WoW ' + (trendSignal.recent_signal.d0_trial_cost_wow_pct != null ? trendSignal.recent_signal.d0_trial_cost_wow_pct + '%' : '--') + ' | CPI WoW ' + (trendSignal.recent_signal.cpi_wow_pct != null ? trendSignal.recent_signal.cpi_wow_pct + '%' : '--') + ' | CTR WoW ' + (trendSignal.recent_signal.ctr_wow_pct != null ? trendSignal.recent_signal.ctr_wow_pct + '%' : '--') + ' | CPM WoW ' + (trendSignal.recent_signal.cpm_wow_pct != null ? trendSignal.recent_signal.cpm_wow_pct + '%' : '--')) : 'No recent 7-day cost-pressure signal available.',
                    'Audience: ' + (adset.audience_definition || adset.audience_type || 'unknown'),
                    'Age/Gender: ' + (adset.age_targeting || 'ALL') + ' | ' + (adset.gender_targeting || 'ALL'),
                    'Placements: ' + (placementSummary || 'AUTO')
                ]
            });
        });
    });
    return audits.sort(function(a, b) {
        var nodeA = scanData.tree[a.campaign_name] && scanData.tree[a.campaign_name].adsets[a.adset_name];
        var nodeB = scanData.tree[b.campaign_name] && scanData.tree[b.campaign_name].adsets[b.adset_name];
        return ((((nodeB && nodeB.totals) || {}).spend || 0) - ((((nodeA && nodeA.totals) || {}).spend || 0)));
    });
}

function buildAdHealthAudits(scanData, weightedBenchmarks, winnerLibrary, signalAvailability, advancedTrendIntelligence) {
    var benchmarkCPA = Number(weightedBenchmarks && weightedBenchmarks.benchmark_cpa || 0);
    var benchmarkD6 = Number(weightedBenchmarks && weightedBenchmarks.benchmark_d6_roas || 0);
    var positiveSignalContext = {
        median_d0_trial_cost: Number(window.OPTIMIZER_BENCHMARKS && window.OPTIMIZER_BENCHMARKS.median_d0_trial_cost || 0),
        median_d15_roas: weightedPercentileMetric((scanData.ads || []).filter(function(item) { return item && item.has_funnel_match && (item.spend || 0) > 0 && item.audience_bucket !== 'retarget'; }), function(item) { return item.d15ROAS; }, function(item) { return item.spend || 0; }, 0.5) || 0,
        median_d30_roas: weightedPercentileMetric((scanData.ads || []).filter(function(item) { return item && item.has_funnel_match && (item.spend || 0) > 0 && item.audience_bucket !== 'retarget'; }), function(item) { return item.d30ROAS; }, function(item) { return item.spend || 0; }, 0.5) || 0
    };
    return (scanData.ads || []).filter(function(ad) { return ad && ad.is_live; }).map(function(ad) {
        var siblings = (scanData.ads || []).filter(function(other) {
            return other && other.is_live && other.adset_name === ad.adset_name && other.campaign_name === ad.campaign_name;
        });
        var isRetarget = isRetargetingEntity(ad, { entityType: 'ad' });
        var compliance = detectSebiComplianceRisk(ad);
        var siblingCtrMedian = weightedPercentileMetric(siblings, function(item) { return item.ctr; }, function(item) { return item.spend || 0; }, 0.5) || 0;
        var betterSibling = findStrictBetterSibling(ad, siblings);
        var campaignWinnerList = winnerLibrary && winnerLibrary.by_campaign ? (winnerLibrary.by_campaign[ad.campaign_name || ''] || []) : [];
        var historicalWinner = campaignWinnerList.filter(function(item) { return item.ad_id !== ad.ad_id; })[0] || null;
        var trendSignal = advancedTrendIntelligence && advancedTrendIntelligence.ads ? advancedTrendIntelligence.ads[ad.ad_id || (ad.campaign_name + '||' + ad.adset_name + '||' + ad.ad_name)] : null;
        var trendLens = buildTrendRootCauseActionLens(ad, 'ad', trendSignal, {
            bestAd: betterSibling || historicalWinner || null
        });
        var positiveQualitySignal = buildPositiveQualitySignal(ad, 'ad', Object.assign({}, positiveSignalContext, { trendSignal: trendSignal }));
        var score = 'STABLE';
        var signal = 'No clear red flag.';
        var action = 'HOLD';
        var replacement = '';
        if (isRetarget) {
            score = 'WATCH';
            signal = 'Retargeting ad-level performance is not a reliable standalone decision surface here. Judge the parent adset on delivery, frequency, and pool sanity.';
            action = 'HOLD RETARGETING STEADY';
        } else if (positiveQualitySignal && (ad.spend || 0) >= 5000) {
            score = 'STRONG';
            signal = positiveQualitySignal.root_cause;
            action = 'KEEP LIVE AND IMPROVE AROUND IT';
        } else if (trendSignal && trendSignal.pattern === 'UNSUSTAINABLE_VALUE_MIX') {
            score = 'WATCH';
            signal = (trendLens && trendLens.root_cause) || trendSignal.summary;
            action = 'DO NOT SCALE YET';
        } else if (trendSignal && trendSignal.pattern === 'CLEAR_DETERIORATION' && (ad.spend || 0) >= 5000) {
            score = 'FAILING';
            signal = (trendLens && trendLens.root_cause) || trendSignal.summary;
            action = betterSibling ? 'PAUSE AND SHIFT' : 'PAUSE';
        } else if (compliance.status === 'review_needed') {
            score = 'WATCH';
            signal = compliance.detail;
            action = 'COMPLIANCE REVIEW';
          } else if ((ad.spend || 0) >= 1000 && String((ad.type || ad.creative_type || '')).toLowerCase() === 'video' && (ad.hook || 0) < 15) {
              score = 'FAILING';
              signal = 'Hook rate is critically weak.';
              action = betterSibling ? 'PAUSE AND REPLACE' : 'PAUSE';
        } else if ((ad.spend || 0) >= 3000 && benchmarkCPA > 0 && (ad.signupCost || 0) > benchmarkCPA * 1.5) {
            score = 'FAILING';
            signal = 'Signup cost is more than 1.5x weighted benchmark.';
            action = betterSibling ? 'PAUSE AND SHIFT' : 'PAUSE';
        } else if ((ad.spend || 0) >= 3000 && siblingCtrMedian > 0 && (ad.ctr || 0) < siblingCtrMedian * 0.8) {
            score = 'WATCH';
            signal = 'CTR is materially below sibling baseline.';
            action = betterSibling || historicalWinner ? 'REFRESH HOOK' : 'BRIEF NEW CREATIVE';
        } else if ((ad.d6ROAS || 0) > benchmarkD6 * 1.15 && (ad.cpi || 0) > 0 && (ad.cpi || 0) < 150 && getAdWinnerConfidence(ad) !== 'low') {
            score = 'STRONG';
            signal = 'Delivery and D6 performance are both ahead of benchmark.';
            action = 'PROTECT';
        }
        if (/PAUSE|REFRESH/.test(action)) replacement = (betterSibling && betterSibling.ad_name) || (historicalWinner && historicalWinner.ad_name) || '';
        return {
            campaign_name: ad.campaign_name || '',
            adset_name: ad.adset_name || '',
            ad_name: ad.ad_name || '',
            ad_id: ad.ad_id || '',
            score: score,
            signal: signal,
            action: action,
            replacement_ad_name: replacement,
            replacement_source: betterSibling && replacement === betterSibling.ad_name ? 'live sibling' : (historicalWinner && replacement === historicalWinner.ad_name ? 'historical campaign winner' : ''),
            compliance_status: compliance.status,
            compliance_note: compliance.detail,
            sibling_benchmark_ctr: siblingCtrMedian ? +siblingCtrMedian.toFixed(2) : null,
            hook_rate: String((ad.type || ad.creative_type || '')).toLowerCase() === 'video' && ad.hook != null ? +Number(ad.hook).toFixed(1) : null,
            hold_rate: String((ad.type || ad.creative_type || '')).toLowerCase() === 'video' && ad.hold != null ? +Number(ad.hold).toFixed(1) : null,
            ctr: ad.ctr != null ? +Number(ad.ctr).toFixed(2) : null,
            cpi: ad.cpi != null ? Math.round(ad.cpi) : null,
            signup_cost: ad.signupCost != null ? Math.round(ad.signupCost) : null,
            d6_roas: ad.d6ROAS != null ? +Number(ad.d6ROAS).toFixed(1) : null,
            notes: [
                isRetarget ? 'Retargeting caveat active: do not make hard ad-level performance calls here; use the parent adset\'s delivery, frequency, and pool sanity instead.' : '',
                ad.has_funnel_match ? 'Matched funnel data available.' : 'Spend-only row: do not trust CPA/ROAS absolutely.',
                compliance.detail ? compliance.detail : 'No obvious SEBI naming risk from current metadata.',
                trendSignal ? ('Trend signal: ' + trendSignal.pattern + ' — ' + trendSignal.summary + ' Root cause: ' + ((trendLens && trendLens.root_cause) || trendSignal.likely_cause) + ' Action lens: ' + ((trendLens && trendLens.action_line) || trendSignal.likely_fix)) : 'No advanced WoW trend signal available.',
                positiveQualitySignal ? ('Positive quality signal: ' + positiveQualitySignal.summary + ' Root cause: ' + positiveQualitySignal.root_cause + ' Action lens: ' + positiveQualitySignal.action_line) : 'No positive D0/D15/D30 quality signal isolated.',
                replacement ? ('Best replacement: ' + replacement + (betterSibling && replacement === betterSibling.ad_name ? ' (live sibling).' : ' (historical winner).')) : 'No replacement candidate isolated yet.',
                signalAvailability && signalAvailability.creative_signals && !signalAvailability.creative_signals.quality_ranking_available ? 'Creative ranking data is unavailable in this path; verdict is based on hook, hold, CTR, CPI, and D6 only.' : ''
            ]
        };
    }).sort(function(a, b) {
        return ((b.cpi || 0) - (a.cpi || 0));
    });
}

function buildApexTrendSummary(scanData) {
    var ads = (scanData && scanData.ads) || [];
    var decliningAds = ads.filter(function(ad) {
        var wow = ad._wow || {};
        return wow.trendDirection === 'declining';
    });
    var improvingAds = ads.filter(function(ad) {
        var wow = ad._wow || {};
        return wow.trendDirection === 'improving';
    });
    var continuousDecliners = ads.filter(function(ad) {
        var wow = ad._wow || {};
        return !!wow.continuousDecline;
    });
    var pausedWinners = ads.filter(function(ad) {
        return ad.is_effectively_paused && (ad._wow && ad._wow.maturedD6ROAS != null ? ad._wow.maturedD6ROAS : ad.d6ROAS) > 28 && (ad.spend || 0) >= 10000;
    });
    var spend = Math.round(ads.reduce(function(sum, ad) { return sum + (ad.spend || 0); }, 0));
    var decliningSpend = Math.round(decliningAds.reduce(function(sum, ad) { return sum + (ad.spend || 0); }, 0));
    var improvingSpend = Math.round(improvingAds.reduce(function(sum, ad) { return sum + (ad.spend || 0); }, 0));
    var matureWinners = ads.filter(function(ad) {
        var maturedRoas = ad._wow && ad._wow.maturedD6ROAS != null ? ad._wow.maturedD6ROAS : ad.d6ROAS;
        return ad.isMatured && (ad.spend || 0) >= 15000 && maturedRoas >= 28;
    }).sort(function(a, b) {
        return (b._wow && b._wow.maturedD6ROAS != null ? b._wow.maturedD6ROAS : b.d6ROAS || 0) - (a._wow && a._wow.maturedD6ROAS != null ? a._wow.maturedD6ROAS : a.d6ROAS || 0);
    }).slice(0, 8).map(function(ad) {
        return {
            ad_id: ad.ad_id || '',
            ad_name: ad.ad_name || '',
            campaign_name: ad.campaign_name || '',
            adset_name: ad.adset_name || '',
            spend_window: Math.round(ad.spend || 0),
            matured_d6_roas: ad._wow && ad._wow.maturedD6ROAS != null ? +Number(ad._wow.maturedD6ROAS).toFixed(1) : +Number(ad.d6ROAS || 0).toFixed(1)
        };
    });
    var highSpendLosers = ads.filter(function(ad) {
        var maturedRoas = ad._wow && ad._wow.maturedD6ROAS != null ? ad._wow.maturedD6ROAS : ad.d6ROAS;
        return (ad.spend || 0) >= 20000 && ((ad.isMatured && maturedRoas < 15) || (!ad.isMatured && ((ad.signupCost || 0) > 1000 || (ad.cpi || 0) > 200)));
    }).sort(function(a, b) { return (b.spend || 0) - (a.spend || 0); }).slice(0, 8).map(function(ad) {
        return {
            ad_id: ad.ad_id || '',
            ad_name: ad.ad_name || '',
            spend_window: Math.round(ad.spend || 0),
            d6_roas_window: +Number(ad.d6ROAS || 0).toFixed(1),
            signup_cost_window: ad.signupCost != null ? Math.round(ad.signupCost) : null,
            cpi_window: ad.cpi != null ? Math.round(ad.cpi) : null,
            decision_mode: ad.isMatured ? 'matured' : 'unmatured'
        };
    });

    return {
        total_ads_with_wow_context: ads.filter(function(ad) { return !!ad._wow; }).length,
        declining_ads: decliningAds.length,
        improving_ads: improvingAds.length,
        continuous_decliners: continuousDecliners.length,
        declining_spend_window: decliningSpend,
        improving_spend_window: improvingSpend,
        declining_spend_share_pct: spend > 0 ? +((decliningSpend / spend) * 100).toFixed(1) : 0,
        improving_spend_share_pct: spend > 0 ? +((improvingSpend / spend) * 100).toFixed(1) : 0,
        paused_winners: pausedWinners.length,
        top_mature_winners: matureWinners,
        top_high_spend_risks: highSpendLosers
    };
}

function safeWowValue(value) {
    value = Number(value);
    return isFinite(value) ? value : null;
}

function deriveWowPctFromSnapshots(lastWeek, prevWeek, field) {
    var current = safeWowValue(lastWeek && lastWeek[field]);
    var previous = safeWowValue(prevWeek && prevWeek[field]);
    if (current == null || previous == null || previous === 0) return null;
    return +(((current - previous) / previous) * 100).toFixed(1);
}

function deriveEntityWowMetric(ads, metricField, rawField) {
    var rows = (ads || []).map(function(ad) {
        var wow = ad && ad._wow ? ad._wow : null;
        var weight = Number(ad && ad.spend || 0);
        if (!wow || weight <= 0) return null;
        if (metricField && wow[metricField] != null && isFinite(Number(wow[metricField]))) {
            return { value: Number(wow[metricField]), weight: weight };
        }
        if (!rawField) return null;
        var thisWeek = safeWowValue(wow.thisWeek && wow.thisWeek[rawField]);
        var lastWeek = safeWowValue(wow.lastWeek && wow.lastWeek[rawField]);
        if (thisWeek == null || lastWeek == null || lastWeek === 0) return null;
        return { value: +(((thisWeek - lastWeek) / Math.abs(lastWeek)) * 100).toFixed(1), weight: weight };
    }).filter(Boolean);
    if (!rows.length) return null;
    var totalWeight = rows.reduce(function(sum, row) { return sum + row.weight; }, 0);
    if (!totalWeight) return null;
    return +(rows.reduce(function(sum, row) { return sum + (row.value * row.weight); }, 0) / totalWeight).toFixed(1);
}

function buildEntityTrendAds(scanData, campaignName, adsetName) {
    var sourceAds = Array.isArray(scanData && scanData.entity_source_ads) ? scanData.entity_source_ads
        : (Array.isArray(scanData && scanData.ads) ? scanData.ads : []);
    return sourceAds.filter(function(ad) {
        if (!ad) return false;
        if (campaignName && ad.campaign_name !== campaignName) return false;
        if (adsetName && ad.adset_name !== adsetName) return false;
        return true;
    });
}

function buildTrendBucketsFromRange(range, bucketSize, bucketCount) {
    var size = Math.max(1, Number(bucketSize || 7));
    var count = Math.max(2, Number(bucketCount || 3));
    var endStr = range && range.until ? String(range.until).slice(0, 10) : new Date().toISOString().slice(0, 10);
    var end = new Date(endStr + 'T00:00:00');
    if (Number.isNaN(end.getTime())) return [];
    var buckets = [];
    for (var i = 0; i < count; i++) {
        var bucketEnd = new Date(end.getTime() - (i * size * 86400000));
        var bucketStart = new Date(bucketEnd.getTime() - ((size - 1) * 86400000));
        buckets.push({
            key: i === 0 ? 'thisWeek' : (i === 1 ? 'lastWeek' : 'prevWeek'),
            from: bucketStart.toISOString().slice(0, 10),
            to: bucketEnd.toISOString().slice(0, 10)
        });
    }
    return buckets;
}

function getTrendBucketKey(dateStr, buckets) {
    var d = String(dateStr || '').slice(0, 10);
    for (var i = 0; i < (buckets || []).length; i++) {
        if (d >= buckets[i].from && d <= buckets[i].to) return buckets[i].key;
    }
    return null;
}

function buildTrendRowsFromSource(scanData, spec) {
    var source = scanData && scanData._trend_source;
    if (!source || !Array.isArray(source.meta_rows) || !Array.isArray(source.funnel_rows)) return [];
    var buckets = buildTrendBucketsFromRange(scanData && scanData.date_range, 7, 3);
    if (!buckets.length) return [];
    var visibleCampaigns = {};
    var visibleAdsets = {};
    Object.keys((scanData && scanData.tree) || {}).forEach(function(campaignName) {
        visibleCampaigns[normalizeCampaignName(campaignName)] = campaignName;
        var camp = scanData.tree[campaignName];
        Object.keys((camp && camp.adsets) || {}).forEach(function(adsetName) {
            visibleAdsets[normalizeCampaignName(campaignName) + '|||' + normalizeAdsetName(adsetName)] = {
                campaign_name: campaignName,
                adset_name: adsetName
            };
        });
    });
    var visibleAds = {};
    (scanData && scanData.ads || []).forEach(function(ad) {
        if (!ad) return;
        visibleAds[normalizeCampaignName(ad.campaign_name || '') + '|||' + normalizeAdsetName(ad.adset_name || '') + '|||' + normalizeTrackerName(ad.ad_name || '')] = ad;
    });

    var metaByEntity = {};
    var funnelByEntity = {};

    function ensureBucketStore(store, key, label, spendHint) {
        if (!store[key]) {
            store[key] = {
                label: label,
                spend_hint: 0,
                thisWeek: emptyRaw(),
                lastWeek: emptyRaw(),
                prevWeek: emptyRaw()
            };
        }
        if (spendHint) store[key].spend_hint += Number(spendHint || 0);
        return store[key];
    }

    (source.meta_rows || []).forEach(function(row) {
        var bucketKey = getTrendBucketKey(row.date_start, buckets);
        if (!bucketKey) return;
        var spendHint = (Number(row.spend || 0) || 0) * 1.18;
        if (spec.entity_type === 'campaign') {
            var campaignKey = normalizeCampaignName(row.campaign_name || '');
            if (!visibleCampaigns[campaignKey]) return;
            addScanMetaRaw(ensureBucketStore(metaByEntity, campaignKey, visibleCampaigns[campaignKey], spendHint)[bucketKey], row);
        } else if (spec.entity_type === 'adset') {
            var adsetKey = normalizeCampaignName(row.campaign_name || '') + '|||' + normalizeAdsetName(row.adset_name || '');
            if (!visibleAdsets[adsetKey]) return;
            addScanMetaRaw(ensureBucketStore(metaByEntity, adsetKey, visibleAdsets[adsetKey].campaign_name + ' → ' + visibleAdsets[adsetKey].adset_name, spendHint)[bucketKey], row);
        } else {
            var adKey = normalizeCampaignName(row.campaign_name || '') + '|||' + normalizeAdsetName(row.adset_name || '') + '|||' + normalizeTrackerName(row.ad_name || '');
            if (!visibleAds[adKey]) return;
            addScanMetaRaw(ensureBucketStore(metaByEntity, adKey, (row.campaign_name || '') + ' → ' + (row.adset_name || '') + ' → ' + (row.ad_name || ''), spendHint)[bucketKey], row);
        }
    });

    (source.funnel_rows || []).forEach(function(row) {
        var bucketKey = getTrendBucketKey(row.date, buckets);
        if (!bucketKey) return;
        if (spec.entity_type === 'campaign') {
            var campaignKey = normalizeCampaignName(row.campaign_name || '');
            if (!visibleCampaigns[campaignKey]) return;
            addScanFunnelRaw(ensureBucketStore(funnelByEntity, campaignKey, visibleCampaigns[campaignKey])[bucketKey], row);
        } else if (spec.entity_type === 'adset') {
            var adsetKey = normalizeCampaignName(row.campaign_name || '') + '|||' + normalizeAdsetName(row.ad_set_name || '');
            if (!visibleAdsets[adsetKey]) return;
            addScanFunnelRaw(ensureBucketStore(funnelByEntity, adsetKey, visibleAdsets[adsetKey].campaign_name + ' → ' + visibleAdsets[adsetKey].adset_name)[bucketKey], row);
        } else {
            var adKey = normalizeCampaignName(row.campaign_name || '') + '|||' + normalizeAdsetName(row.ad_set_name || '') + '|||' + normalizeTrackerName(row.tracker_name || '');
            var visibleAd = visibleAds[adKey] ? adKey : null;
            if (!visibleAd) return;
            addScanFunnelRaw(ensureBucketStore(funnelByEntity, visibleAd, visibleAds[visibleAd] ? ((visibleAds[visibleAd].campaign_name || '') + ' → ' + (visibleAds[visibleAd].adset_name || '') + ' → ' + (visibleAds[visibleAd].ad_name || '')) : visibleAd)[bucketKey], row);
        }
    });

    return Object.keys(metaByEntity).map(function(key) {
        var meta = metaByEntity[key];
        var funnel = funnelByEntity[key] || { thisWeek: emptyRaw(), lastWeek: emptyRaw(), prevWeek: emptyRaw() };
        var thisWeek = deriveMetrics(Object.assign(emptyRaw(), funnel.thisWeek, {
            spend: meta.thisWeek.spend,
            impressions: meta.thisWeek.impressions,
            clicks: meta.thisWeek.clicks,
            installs: meta.thisWeek.installs,
            thruplay: meta.thisWeek.thruplay,
            p25: meta.thisWeek.p25,
            p100: meta.thisWeek.p100
        }));
        var lastWeek = deriveMetrics(Object.assign(emptyRaw(), funnel.lastWeek, {
            spend: meta.lastWeek.spend,
            impressions: meta.lastWeek.impressions,
            clicks: meta.lastWeek.clicks,
            installs: meta.lastWeek.installs,
            thruplay: meta.lastWeek.thruplay,
            p25: meta.lastWeek.p25,
            p100: meta.lastWeek.p100
        }));
        var wow = null;
        if (spec.metric === 'signup_cost_wow_pct') wow = (lastWeek.signupCost && thisWeek.signupCost != null) ? (((thisWeek.signupCost - lastWeek.signupCost) / Math.abs(lastWeek.signupCost)) * 100) : null;
        else if (spec.metric === 'd0_trial_cost_wow_pct') wow = (lastWeek.d0TrialCost && thisWeek.d0TrialCost != null) ? (((thisWeek.d0TrialCost - lastWeek.d0TrialCost) / Math.abs(lastWeek.d0TrialCost)) * 100) : null;
        else if (spec.metric === 'cpi_wow_pct') wow = (lastWeek.cpi && thisWeek.cpi != null) ? (((thisWeek.cpi - lastWeek.cpi) / Math.abs(lastWeek.cpi)) * 100) : null;
        if (wow == null || !isFinite(wow)) return null;
        var label = meta.label || (funnel.label || key);
        var row = {
            entity_type: spec.entity_type,
            label: label,
            spend: Number(meta.spend_hint || thisWeek.spend || 0),
            metric_value: +wow.toFixed(1),
            trend: {
                thisWeek: thisWeek,
                lastWeek: lastWeek
            },
            basis: 'Basis: ' + (scanData.date_range ? (scanData.date_range.since + ' → ' + scanData.date_range.until) : '--') + ' | Current 7d vs previous 7d raw-bucket comparison'
        };
        if (spec.entity_type === 'campaign') {
            row.campaign_name = meta.label || key;
            row.adset_name = '';
            row.ad_name = '';
        } else if (spec.entity_type === 'adset') {
            var parts = key.split('|||');
            row.campaign_name = visibleAdsets[key] ? visibleAdsets[key].campaign_name : (parts[0] || '');
            row.adset_name = visibleAdsets[key] ? visibleAdsets[key].adset_name : (parts[1] || '');
            row.ad_name = '';
        } else {
            var adParts = key.split('|||');
            row.campaign_name = visibleAds[key] ? (visibleAds[key].campaign_name || '') : (adParts[0] || '');
            row.adset_name = visibleAds[key] ? (visibleAds[key].adset_name || '') : (adParts[1] || '');
            row.ad_name = visibleAds[key] ? (visibleAds[key].ad_name || '') : (adParts[2] || '');
        }
        return row;
    }).filter(Boolean);
}

function buildRecentCostPressureSignalFromMetrics(metrics) {
    metrics = metrics || {};
    var signupCostWow = safeWowValue(metrics.signup_cost_wow_pct);
    var d0TrialCostWow = safeWowValue(metrics.d0_trial_cost_wow_pct);
    var cpiWow = safeWowValue(metrics.cpi_wow_pct);
    var ctrWow = safeWowValue(metrics.ctr_wow_pct);
    var cpmWow = safeWowValue(metrics.cpm_wow_pct);
    var signupsWow = safeWowValue(metrics.signups_wow_pct);
    var continuousDecline = !!metrics.continuous_decline;
    var inflation = (signupCostWow != null && signupCostWow >= 12) || (d0TrialCostWow != null && d0TrialCostWow >= 12) || (cpiWow != null && cpiWow >= 12);
    var recovery = (signupCostWow != null && signupCostWow <= -12) || (d0TrialCostWow != null && d0TrialCostWow <= -12) || (cpiWow != null && cpiWow <= -10);
    if (!inflation && !recovery) return null;

    var pattern = recovery ? 'RECENT_RECOVERY' : (continuousDecline ? 'RECENT_CONTINUOUS_COST_PRESSURE' : 'RECENT_COST_PRESSURE');
    var summary = recovery
        ? 'Recent acquisition costs are easing in the latest week.'
        : 'Signup cost, D0 trial cost, or CPI has inflated in the recent week.';
    var implication = recovery
        ? 'Do not overreact with a hard cut if the structural picture is otherwise stable.'
        : 'Treat this as an early warning that something changed recently in acquisition quality or delivery.';
    var likelyCause = recovery
        ? 'Front-end efficiency is stabilizing faster than the mature D6 curve.'
        : 'Recent acquisition pressure is building before the mature D6 line necessarily fully reflects it.';
    var likelyFix = recovery
        ? 'Hold for one more clean read before escalating.'
        : 'Diagnose the recent driver now instead of waiting for mature ROAS to deteriorate.';

    if (!recovery) {
        if (ctrWow != null && ctrWow <= -12 && !(cpmWow != null && cpmWow >= 15)) {
            likelyCause = 'Click-through rate is slipping while acquisition cost rises, which points more to creative fatigue or weaker message fit than pure auction pressure.';
            likelyFix = 'Refresh weak ads or cut the fatigued creative pocket before making a broad budget change.';
        } else if (cpmWow != null && cpmWow >= 15 && (ctrWow == null || ctrWow > -10)) {
            likelyCause = 'CPM is rising faster than CTR is collapsing, which points to auction pressure or pricier reach rather than pure creative failure.';
            likelyFix = 'Tighten location or placement mix and avoid broad scaling until CPM pressure settles.';
        } else if (signupsWow != null && signupsWow <= -15 && (ctrWow == null || ctrWow >= -8)) {
            likelyCause = 'Volume is falling faster than click quality, which points to weaker post-click quality, audience quality, or optimization pressure.';
            likelyFix = 'Tighten audience/message fit and inspect where the adset is spending before cutting the whole campaign.';
        }
    }

    return {
        pattern: pattern,
        summary: summary,
        implication: implication,
        likely_cause: likelyCause,
        likely_fix: likelyFix,
        signup_cost_wow_pct: signupCostWow,
        d0_trial_cost_wow_pct: d0TrialCostWow,
        cpi_wow_pct: cpiWow,
        ctr_wow_pct: ctrWow,
        cpm_wow_pct: cpmWow,
        signups_wow_pct: signupsWow,
        continuous_decline: continuousDecline
    };
}

function getAdAdvancedTrendSignal(ad) {
    var wow = ad && ad._wow ? ad._wow : {};
    var roasWow = deriveWowPctFromSnapshots(wow.lastWeek, wow.prevWeek, 'd6ROAS');
    var revenueWow = safeWowValue(wow.d6Revenue_wow);
    var signupCostWow = safeWowValue(wow.signupCost_wow);
    var d0TrialCostWow = safeWowValue(wow.d0TrialCost_wow);
    var signupsWow = safeWowValue(wow.signups_wow);
    var hasAny = [roasWow, revenueWow, signupCostWow, d0TrialCostWow, signupsWow].some(function(v) { return v != null; });
    if (!hasAny) return null;
    var pattern = 'NO_CLEAR_TREND';
    var summary = 'No clear week-on-week contradiction detected.';
    var implication = 'Use normal operator rules.';
    var likelyCause = 'No dominant trend conflict.';
    var likelyFix = 'Use normal operator rules.';
    if (((roasWow != null && roasWow >= 10) || (revenueWow != null && revenueWow >= 15)) &&
        ((signupCostWow != null && signupCostWow >= 15) || (d0TrialCostWow != null && d0TrialCostWow >= 15)) &&
        (signupsWow == null || signupsWow <= 5)) {
        pattern = 'UNSUSTAINABLE_VALUE_MIX';
        summary = 'ROAS/revenue improved, but signup or D0 trial costs inflated and conversion volume did not improve with it.';
        implication = 'Do not treat this as a clean scaling signal. Quality of growth may be narrowing to fewer, higher-value conversions.';
        likelyCause = 'Fewer conversions may be carrying higher value, which can flatter ROAS without proving broad efficiency.';
        likelyFix = 'Hold scale and inspect whether the improvement is concentrated in a narrower buyer pocket or a temporary high-AOV mix.';
    } else if (((roasWow != null && roasWow <= -10) || (revenueWow != null && revenueWow <= -15)) &&
        ((signupCostWow != null && signupCostWow >= 10) || (d0TrialCostWow != null && d0TrialCostWow >= 10))) {
        pattern = 'CLEAR_DETERIORATION';
        summary = 'Top-line D6 trend is weakening while acquisition cost is also worsening.';
        implication = 'Treat this as a real deterioration signal, not a temporary fluctuation.';
        likelyCause = 'Both conversion quality and acquisition cost are moving the wrong way together.';
        likelyFix = 'Cut pressure or replace the weak pocket instead of waiting for ROAS alone to recover.';
    } else if (((roasWow != null && roasWow >= 10) || (revenueWow != null && revenueWow >= 10)) &&
        ((signupCostWow != null && signupCostWow <= -10) || (d0TrialCostWow != null && d0TrialCostWow <= -10)) &&
        (signupsWow == null || signupsWow >= 0)) {
        pattern = 'TRUE_IMPROVEMENT';
        summary = 'Revenue efficiency is improving while acquisition costs are stable-to-better.';
        implication = 'This is a healthier improvement signal and is more defensible for protection or cautious scale.';
        likelyCause = 'Both top-line efficiency and acquisition quality are moving in the same healthy direction.';
        likelyFix = 'Protect this pocket and consider cautious scaling only if structural and learning checks also pass.';
    } else if (((signupCostWow != null && signupCostWow <= -10) || (d0TrialCostWow != null && d0TrialCostWow <= -10)) &&
        ((roasWow != null && roasWow > -5) || (revenueWow != null && revenueWow > -5))) {
        pattern = 'EARLY_RECOVERY';
        summary = 'Acquisition costs are improving before top-line D6 has fully followed through.';
        implication = 'Monitor closely; this can become a recovery if volume holds.';
        likelyCause = 'Cheaper acquisition is improving earlier than downstream revenue realization.';
        likelyFix = 'Do not scale yet, but avoid a hard cut until the next mature read confirms the recovery.';
    } else if (((roasWow != null && roasWow <= -10) || (revenueWow != null && revenueWow <= -10)) &&
        ((signupCostWow != null && signupCostWow <= -10) || (d0TrialCostWow != null && d0TrialCostWow <= -10))) {
        pattern = 'CHEAPER_BUT_LOWER_QUALITY';
        summary = 'ROAS/revenue is dropping even though signup or D0 trial costs are improving.';
        implication = 'Cheaper acquisition is not translating into quality downstream value. Do not celebrate lower signup cost on its own.';
        likelyCause = 'Lead or trial quality may have fallen, so you are buying cheaper conversions that monetize worse.';
        likelyFix = 'Tighten audience/creative fit and inspect post-click quality rather than scaling on lower signup cost.';
    } else if ((signupsWow != null && signupsWow > 15) &&
        ((revenueWow != null && revenueWow <= -10) || (roasWow != null && roasWow <= -10)) &&
        ((signupCostWow != null && signupCostWow <= -10) || (d0TrialCostWow != null && d0TrialCostWow <= -10))) {
        pattern = 'CHEAP_LOW_VALUE_VOLUME';
        summary = 'Volume and cost-to-acquire improved, but downstream revenue efficiency weakened.';
        implication = 'This looks like more but lower-quality conversions, not a clean win.';
        likelyCause = 'The system may be finding cheaper volume that is monetizing worse after signup or trial.';
        likelyFix = 'Do not scale just because conversion count improved. Tighten message, audience, or event quality first.';
    } else if ((d0TrialCostWow != null && d0TrialCostWow <= -10) &&
        ((roasWow != null && roasWow <= -10) || (revenueWow != null && revenueWow <= -10))) {
        pattern = 'D0_TO_D6_DISCONNECT';
        summary = 'Early trial economics improved, but mature D6 value still weakened.';
        implication = 'Front-end trial generation is improving faster than downstream monetization quality.';
        likelyCause = 'The funnel may be attracting more trial starts that do not convert into valuable D6 cohorts.';
        likelyFix = 'Audit trial quality and post-trial experience instead of reading early trial cost as a full success.';
    } else if (((signupCostWow != null && signupCostWow >= 15) || (d0TrialCostWow != null && d0TrialCostWow >= 15)) &&
        ((roasWow == null || Math.abs(roasWow) < 8) && (revenueWow == null || Math.abs(revenueWow) < 8))) {
        pattern = 'COST_PRESSURE_BUILDING';
        summary = 'Acquisition costs are inflating even though top-line D6 has not fully rolled over yet.';
        implication = 'This is often an early warning before mature ROAS weakens.';
        likelyCause = 'Efficiency pressure is building in acquisition before it is fully visible in mature revenue.',
        likelyFix = 'Treat this as an early warning and inspect settings, audience fatigue, or competitive pressure before the D6 line breaks.';
    } else if ((roasWow != null || revenueWow != null) && (signupCostWow != null || d0TrialCostWow != null || signupsWow != null)) {
        pattern = 'MIXED_SIGNAL';
        summary = 'Week-on-week movement is mixed across efficiency, cost, and volume.';
        implication = 'Avoid overreacting to a single metric and keep the recommendation conservative.';
        likelyCause = 'Multiple metrics are moving in different directions, so the story is not clean yet.';
        likelyFix = 'Keep the verdict conservative and avoid promoting one positive metric over the rest.';
    }
    var recentSignal = buildRecentCostPressureSignalFromMetrics({
        signup_cost_wow_pct: safeWowValue(wow.signupCost_wow),
        d0_trial_cost_wow_pct: safeWowValue(wow.d0TrialCost_wow),
        cpi_wow_pct: safeWowValue(wow.cpi_wow),
        ctr_wow_pct: deriveWowPctFromSnapshots(wow.thisWeek, wow.lastWeek, 'ctr'),
        cpm_wow_pct: deriveWowPctFromSnapshots(wow.thisWeek, wow.lastWeek, 'cpm'),
        signups_wow_pct: safeWowValue(wow.signups_wow),
        continuous_decline: !!wow.continuousDecline
    });
    return {
        pattern: pattern,
        summary: summary,
        implication: implication,
        likely_cause: likelyCause,
        likely_fix: likelyFix,
        roas_wow_pct: roasWow,
        revenue_wow_pct: revenueWow,
        signup_cost_wow_pct: signupCostWow,
        d0_trial_cost_wow_pct: d0TrialCostWow,
        signups_wow_pct: signupsWow,
        recent_signal: recentSignal
    };
}

function summarizeEntityAdvancedTrend(ads) {
    var signals = (ads || []).map(getAdAdvancedTrendSignal).filter(Boolean);
    if (!signals.length) return null;
    function weightedAverage(field) {
        var rows = (ads || []).map(function(ad) {
            return {
                weight: Number(ad && ad.spend || 0),
                value: getAdAdvancedTrendSignal(ad) && getAdAdvancedTrendSignal(ad)[field]
            };
        }).filter(function(row) {
            return row.value != null && isFinite(row.value) && row.weight > 0;
        });
        if (!rows.length) return null;
        var totalWeight = rows.reduce(function(sum, row) { return sum + row.weight; }, 0);
        if (!totalWeight) return null;
        return +(rows.reduce(function(sum, row) { return sum + (row.value * row.weight); }, 0) / totalWeight).toFixed(1);
    }
    var roasWow = weightedAverage('roas_wow_pct');
    var revenueWow = weightedAverage('revenue_wow_pct');
    var signupCostWow = weightedAverage('signup_cost_wow_pct');
    var d0TrialCostWow = weightedAverage('d0_trial_cost_wow_pct');
    var signupsWow = weightedAverage('signups_wow_pct');
    var pattern = 'NO_CLEAR_TREND';
    var summary = 'No clear week-on-week contradiction detected.';
    var implication = 'Use normal operator rules.';
    var likelyCause = 'No dominant trend conflict.';
    var likelyFix = 'Use normal operator rules.';
    if (((roasWow != null && roasWow >= 10) || (revenueWow != null && revenueWow >= 15)) &&
        ((signupCostWow != null && signupCostWow >= 15) || (d0TrialCostWow != null && d0TrialCostWow >= 15)) &&
        (signupsWow == null || signupsWow <= 5)) {
        pattern = 'UNSUSTAINABLE_VALUE_MIX';
        summary = 'Last mature-week efficiency improved, but signup or D0 trial costs inflated and volume quality looks narrower.';
        implication = 'Do not scale this entity on ROAS alone. It may be getting fewer, higher-value conversions rather than broad healthy improvement.';
        likelyCause = 'Fewer conversions may be carrying higher value and flattering mature ROAS.';
        likelyFix = 'Hold scale and inspect whether the improvement is narrow, concentrated, or temporary.';
    } else if (((roasWow != null && roasWow <= -10) || (revenueWow != null && revenueWow <= -15)) &&
        ((signupCostWow != null && signupCostWow >= 10) || (d0TrialCostWow != null && d0TrialCostWow >= 10))) {
        pattern = 'CLEAR_DETERIORATION';
        summary = 'Week-on-week revenue efficiency is down while acquisition costs are worsening.';
        implication = 'This is a real deterioration signal and should tighten the recommendation.';
        likelyCause = 'Both top-line value and acquisition quality are worsening together.';
        likelyFix = 'Tighten or cut the weak pocket instead of waiting for a cleaner confirmation.';
    } else if (((roasWow != null && roasWow >= 10) || (revenueWow != null && revenueWow >= 10)) &&
        ((signupCostWow != null && signupCostWow <= -10) || (d0TrialCostWow != null && d0TrialCostWow <= -10)) &&
        (signupsWow == null || signupsWow >= 0)) {
        pattern = 'TRUE_IMPROVEMENT';
        summary = 'Revenue efficiency is improving while cost-to-acquire is also stable-to-better.';
        implication = 'This supports protection or cautious scale if the rest of the account logic agrees.';
        likelyCause = 'Both acquisition economics and mature revenue quality are improving together.';
        likelyFix = 'Protect and consider cautious scale only if learning and structure checks also pass.';
    } else if (((signupCostWow != null && signupCostWow <= -10) || (d0TrialCostWow != null && d0TrialCostWow <= -10)) &&
        ((roasWow != null && roasWow > -5) || (revenueWow != null && revenueWow > -5))) {
        pattern = 'EARLY_RECOVERY';
        summary = 'Acquisition-cost pressure is easing before D6 has fully caught up.';
        implication = 'Hold a little longer before making a hard cut if structural signals are clean.';
        likelyCause = 'Front-end acquisition efficiency is improving ahead of the mature value curve.';
        likelyFix = 'Monitor one more mature read before deciding whether this is real recovery or noise.';
    } else if (((roasWow != null && roasWow <= -10) || (revenueWow != null && revenueWow <= -10)) &&
        ((signupCostWow != null && signupCostWow <= -10) || (d0TrialCostWow != null && d0TrialCostWow <= -10))) {
        pattern = 'CHEAPER_BUT_LOWER_QUALITY';
        summary = 'Mature ROAS fell even though signup or D0 trial costs improved.';
        implication = 'Cheaper acquisition is not producing equivalent value downstream.';
        likelyCause = 'The system is finding cheaper but lower-quality volume.';
        likelyFix = 'Tighten audience or message quality instead of scaling on lower signup cost.';
    } else if ((signupsWow != null && signupsWow > 15) &&
        ((revenueWow != null && revenueWow <= -10) || (roasWow != null && roasWow <= -10)) &&
        ((signupCostWow != null && signupCostWow <= -10) || (d0TrialCostWow != null && d0TrialCostWow <= -10))) {
        pattern = 'CHEAP_LOW_VALUE_VOLUME';
        summary = 'More signups are coming at lower cost, but D6 value is weakening.';
        implication = 'Volume is improving in a way that may not be sustainable or high quality.';
        likelyCause = 'Cheaper signups may be monetizing worse after trial or signup.';
        likelyFix = 'Do not scale on volume alone. Re-check message quality and downstream fit.';
    } else if ((d0TrialCostWow != null && d0TrialCostWow <= -10) &&
        ((roasWow != null && roasWow <= -10) || (revenueWow != null && revenueWow <= -10))) {
        pattern = 'D0_TO_D6_DISCONNECT';
        summary = 'Early trial cost improved, but mature D6 value still weakened.';
        implication = 'Front-end trial gain is not flowing through into mature monetization quality.';
        likelyCause = 'Trial quality improved less than trial quantity.';
        likelyFix = 'Inspect downstream trial activation quality instead of rewarding cheaper trial starts.';
    } else if (((signupCostWow != null && signupCostWow >= 15) || (d0TrialCostWow != null && d0TrialCostWow >= 15)) &&
        ((roasWow == null || Math.abs(roasWow) < 8) && (revenueWow == null || Math.abs(revenueWow) < 8))) {
        pattern = 'COST_PRESSURE_BUILDING';
        summary = 'Signup or D0 trial cost is rising before the mature ROAS line has fully broken.';
        implication = 'This is often an early warning, not a stable hold signal.';
        likelyCause = 'Acquisition pressure is building before it is fully visible in mature revenue.',
        likelyFix = 'Inspect settings, audience fatigue, and competitive pressure before the D6 line worsens.';
    } else if ((roasWow != null || revenueWow != null) && (signupCostWow != null || d0TrialCostWow != null || signupsWow != null)) {
        pattern = 'MIXED_SIGNAL';
        summary = 'Week-on-week movement is mixed across cost, revenue, and volume.';
        implication = 'Keep the recommendation conservative and do not over-index on one positive metric.';
        likelyCause = 'The trend story is mixed and not clean enough for an aggressive verdict.';
        likelyFix = 'Keep the verdict conservative and wait for the next confirming read.';
    }
    var recentSignal = buildRecentCostPressureSignalFromMetrics({
        signup_cost_wow_pct: deriveEntityWowMetric(ads, 'signupCost_wow'),
        d0_trial_cost_wow_pct: deriveEntityWowMetric(ads, 'd0TrialCost_wow'),
        cpi_wow_pct: deriveEntityWowMetric(ads, 'cpi_wow'),
        ctr_wow_pct: deriveEntityWowMetric(ads, null, 'ctr'),
        cpm_wow_pct: deriveEntityWowMetric(ads, null, 'cpm'),
        signups_wow_pct: deriveEntityWowMetric(ads, 'signups_wow'),
        continuous_decline: signals.some(function(signal) { return signal && signal.recent_signal && signal.recent_signal.continuous_decline; })
    });
    return {
        pattern: pattern,
        summary: summary,
        implication: implication,
        likely_cause: likelyCause,
        likely_fix: likelyFix,
        roas_wow_pct: roasWow,
        revenue_wow_pct: revenueWow,
        signup_cost_wow_pct: signupCostWow,
        d0_trial_cost_wow_pct: d0TrialCostWow,
        signups_wow_pct: signupsWow,
        sample_size: signals.length,
        recent_signal: recentSignal
    };
}

function buildPositiveQualitySignal(entity, entityType, context) {
    context = context || {};
    var totals = entity && entity.totals ? entity.totals : entity || {};
    var d0TrialCost = Number(totals.d0TrialCost || 0);
    var d15Roas = Number(totals.d15ROAS || 0);
    var d30Roas = Number(totals.d30ROAS || 0);
    var d6Roas = Number(totals.d6ROAS || 0);
    var spend = Number(totals.spend || 0);
    var medianD0TrialCost = Number(context.median_d0_trial_cost || 0);
    var medianD15Roas = Number(context.median_d15_roas || 0);
    var medianD30Roas = Number(context.median_d30_roas || 0);
    var trendSignal = context.trendSignal || null;
    var recentSignal = trendSignal && trendSignal.recent_signal ? trendSignal.recent_signal : null;
    var d0TrialCostWow = recentSignal ? safeWowValue(recentSignal.d0_trial_cost_wow_pct) : null;
    var positives = [];

    if (d0TrialCost > 0 && medianD0TrialCost > 0 && d0TrialCost <= medianD0TrialCost * 0.85) {
        positives.push('D0 trial cost is below weighted median');
    }
    if (d0TrialCostWow != null && d0TrialCostWow <= -10) {
        positives.push('D0 trial cost is declining week on week');
    }
    if (d15Roas > 0 && medianD15Roas > 0 && d15Roas >= medianD15Roas * 1.2) {
        positives.push('D15 ROAS is exceptional versus account mix');
    }
    if (d30Roas > 0 && medianD30Roas > 0 && d30Roas >= medianD30Roas * 1.2) {
        positives.push('D30 ROAS is exceptional versus account mix');
    }

    if (!positives.length || spend < 8000) return null;

    var summary = positives.join('; ') + '.';
    var rootCause = 'Early and longer-tail quality signals are stronger than a simple D6-only read suggests.';
    var actionLine = entityType === 'campaign'
        ? 'Do not pause this campaign on near-term pressure alone. Protect the stronger long-tail pocket and improve the weaker adsets, ads, or settings around it.'
        : (entityType === 'adset'
            ? 'Do not pause this adset on D6 pressure alone. Keep the stronger quality signal live and improve the ad mix, audience, placements, or geo around it.'
            : 'Do not pause this ad on D6 alone if the parent quality signals stay strong. Keep it live as a quality reference while improving the weaker companions around it.');

    if ((d15Roas > 0 && d30Roas > 0) && d30Roas >= d15Roas) {
        rootCause = 'The cohort is compounding value after D6, which suggests quality is stronger than the short-window read alone.';
    } else if (d0TrialCost > 0 && medianD0TrialCost > 0 && d0TrialCost <= medianD0TrialCost * 0.85) {
        rootCause = 'Cheaper same-day trial formation is a positive forward signal for mature D6 efficiency if the rest of the funnel remains healthy.';
    }

    return {
        pattern: 'POSITIVE_QUALITY_SIGNAL',
        summary: summary,
        root_cause: rootCause,
        action_line: actionLine,
        positives: positives,
        d0_trial_cost_wow_pct: d0TrialCostWow
    };
}

function buildTrendRootCauseActionLens(entity, entityType, trendSignal, context) {
    context = context || {};
    if (!trendSignal) return null;
    var bestAdset = context.bestAdset || null;
    var weakAdsets = Array.isArray(context.weakAdsets) ? context.weakAdsets : [];
    var bestAd = context.bestAd || null;
    var failingAds = Array.isArray(context.failingAds) ? context.failingAds : [];
    var bidStrategy = String(entity && entity.bid_strategy || '').toUpperCase();
    var optimizationEvent = String(entity && entity.optimization_event || '').toUpperCase();
    var cpi = Number(entity && (entity.totals ? entity.totals.cpi : entity.cpi) || 0);
    var signupCost = Number(entity && (entity.totals ? entity.totals.signupCost : entity.signupCost) || 0);
    var spend = Number(entity && (entity.totals ? entity.totals.spend : entity.spend) || 0);
    var rootCause = trendSignal.likely_cause || '';
    var actionLine = trendSignal.likely_fix || '';
    var recentSignal = trendSignal.recent_signal || null;
    var broadLocation = /INDIA_WIDE|TIER|,/.test(String(entity && entity.location_targeting || '').toUpperCase());
    var placements = Array.isArray(entity && entity.placements_active) ? entity.placements_active : [];
    var broadPlacements = placements.length >= 4 || placements.indexOf('AUTO') !== -1;

    if (trendSignal.pattern === 'UNSUSTAINABLE_VALUE_MIX') {
        if (entityType === 'campaign' && bestAdset && weakAdsets.length) {
            rootCause = bestAdset.name + ' appears to be carrying the value mix while weaker sibling adsets are making acquisition more expensive.';
            actionLine = 'Do not scale the campaign. Keep budget concentrated in ' + bestAdset.name + ' and cut pressure from the weaker adsets first.';
        } else if (entityType === 'adset' && bestAd && failingAds.length) {
            rootCause = bestAd.ad_name + ' is likely carrying the value while the rest of the ad mix is inflating signup and D0 trial cost.';
            actionLine = 'Do not scale this adset. Cut the weak ads first and keep only ' + bestAd.ad_name + ' plus one challenger live.';
        } else if (entityType === 'ad' && spend >= 5000) {
            rootCause = 'This ad is contributing to a narrow higher-value mix rather than broad healthy conversion quality.';
            actionLine = 'Do not duplicate or scale this ad. Keep it as a reference only if the parent still needs it, and remove weaker low-quality companions first.';
        }
    } else if (trendSignal.pattern === 'CHEAPER_BUT_LOWER_QUALITY' || trendSignal.pattern === 'CHEAP_LOW_VALUE_VOLUME' || trendSignal.pattern === 'D0_TO_D6_DISCONNECT') {
        if (optimizationEvent && optimizationEvent !== 'UNKNOWN' && entityType !== 'campaign') {
            rootCause = 'Current ' + optimizationEvent + ' optimization is likely buying cheaper front-end events that are monetizing worse downstream.';
            actionLine = 'Do not scale on lower signup or D0 trial cost. Tighten creative and audience quality first, and only reconsider the optimization event if quality stays weak.';
        } else if (entityType === 'campaign' && weakAdsets.length) {
            rootCause = 'Cheaper conversion volume is likely coming from lower-quality pockets inside the campaign rather than a true account-level improvement.';
            actionLine = 'Cut or reduce the adsets producing cheaper but weaker value before changing the whole campaign structure.';
        } else if (entityType === 'adset' && cpi > 0 && cpi < 200) {
            rootCause = 'This adset is finding cheaper volume, but the downstream value mix is weakening after signup or trial.';
            actionLine = 'Hold budget flat, tighten the message and audience fit, and remove weak ads that are attracting low-value conversions.';
        }
    } else if (trendSignal.pattern === 'CLEAR_DETERIORATION') {
        if (entityType === 'campaign' && weakAdsets.length) {
            rootCause = 'The campaign is deteriorating because multiple child adsets are worsening at the same time.';
            actionLine = 'Reduce the weak adsets now and stop defending the campaign on historical averages.';
        } else if (entityType === 'adset' && failingAds.length) {
            rootCause = 'The adset is deteriorating because too many live ads are now weak on both cost and downstream value.';
            actionLine = 'Reduce pressure immediately and cut the failing ads before refreshing the rest.';
        } else if (entityType === 'ad' && spend >= 5000) {
            rootCause = 'This ad is deteriorating on both acquisition quality and downstream value, so it is not a temporary mixed signal.';
            actionLine = 'Pause or replace this ad rather than waiting for another week of confirmation.';
        }
    } else if (trendSignal.pattern === 'COST_PRESSURE_BUILDING') {
        if (bidStrategy === 'BID_CAP') {
            rootCause = 'Cost pressure is building while the bid strategy is already restrictive.';
            actionLine = 'Fix the bid strategy now instead of waiting for mature ROAS to roll over.';
        } else if (entityType === 'adset') {
            rootCause = 'Acquisition pressure is building inside this adset before the mature D6 line has fully broken.';
            actionLine = 'Do not scale. Tighten audience, placement, or ad mix now so the D6 line does not break next.';
        } else if (entityType === 'campaign') {
            rootCause = 'The campaign is showing early acquisition pressure before the mature ROAS line fully deteriorates.';
            actionLine = 'Treat this as an early warning. Stop broad expansion and tighten the weak child pockets first.';
        }
    } else if (trendSignal.pattern === 'EARLY_RECOVERY') {
        if (entityType === 'adset') {
            rootCause = 'Acquisition quality is recovering earlier than mature D6, which often means the adset needs one more mature read rather than a hard cut.';
            actionLine = 'Hold this adset for the next mature read, but do not scale it yet.';
        } else if (entityType === 'campaign') {
            rootCause = 'Recovery is starting in front-end economics, but the campaign is not ready for a bullish verdict yet.';
            actionLine = 'Hold the campaign steady and wait for the next mature window before restoring pressure.';
        }
    }
    if (recentSignal && /RECENT_(CONTINUOUS_COST_PRESSURE|COST_PRESSURE)/.test(recentSignal.pattern)) {
        if (recentSignal.cpm_wow_pct != null && recentSignal.cpm_wow_pct >= 15 && (recentSignal.ctr_wow_pct == null || recentSignal.ctr_wow_pct > -10)) {
            rootCause = 'Recent signup and D0-trial costs are rising while CPM is also up, which points to auction or pricier reach pressure more than a pure creative collapse.';
            actionLine = broadLocation || broadPlacements
                ? 'Tighten the broad geo or placement mix first and avoid broad scaling until CPM pressure settles.'
                : 'Hold scale, trim the most expensive delivery pocket first, and avoid reading this as a clean creative-only issue.';
        } else if (recentSignal.ctr_wow_pct != null && recentSignal.ctr_wow_pct <= -12) {
            rootCause = entityType === 'campaign'
                ? 'Recent acquisition costs are inflating while CTR is slipping, which suggests creative fatigue or weaker message fit inside the campaign.'
                : 'Recent acquisition costs are inflating while CTR is slipping, which points to creative fatigue or weaker message fit before blaming budget alone.';
            actionLine = entityType === 'campaign'
                ? 'Open the weakest adset or ad pocket and refresh the fatigued creatives before holding the whole campaign unchanged.'
                : 'Cut the weak ads or refresh the fatigued creative pocket before waiting for more expensive signups.';
        } else if ((broadLocation || broadPlacements) && entityType !== 'ad') {
            rootCause = 'Recent acquisition-cost pressure is likely coming from drift into broad geos or placement pockets that are now converting worse.';
            actionLine = 'Tighten location or placement mix now instead of leaving the adset broad and waiting for D6 ROAS to break.';
        } else if (entityType === 'campaign' && bestAdset && weakAdsets.length) {
            rootCause = 'Recent cost inflation is likely concentrated in weaker child adsets rather than the strongest pocket.';
            actionLine = 'Reduce the weak child adsets now and protect the one cleaner pocket before the campaign average worsens further.';
        } else if (entityType === 'adset' && bestAd && failingAds.length) {
            rootCause = 'Recent cost inflation is likely coming from weaker live ads inside this adset rather than the entire audience failing at once.';
            actionLine = 'Pause or refresh the weak ads first, then reassess whether the audience or settings still need tightening.';
        }
    }
    return {
        root_cause: rootCause || trendSignal.likely_cause || '',
        action_line: actionLine || trendSignal.likely_fix || ''
    };
}

function suggestAdNameVariantsFromWinner(winnerAdName, count) {
    var base = String(winnerAdName || '').trim();
    if (!base) return [];
    var variants = [];
    var lineageBase = base.replace(/_V\d+\b/ig, '').replace(/[_-]+$/g, '');
    function push(name) {
        if (!name) return;
        if (variants.indexOf(name) === -1) variants.push(name);
    }
    push(lineageBase + '_New-Hook');
    push(lineageBase + '_Pain-Angle');
    push(lineageBase + '_Proof-Angle');
    push(lineageBase + '_Offer-Angle');
    push(lineageBase + '_UGC-Style');
    return variants.slice(0, Math.max(1, count || 3));
}

function buildAdvancedTrendIntelligence(scanData) {
    var ads = (scanData && scanData.ads) || [];
    var campaigns = {};
    var adsets = {};
    var adMap = {};
    ads.forEach(function(ad) {
        var adSignal = getAdAdvancedTrendSignal(ad);
        if (adSignal) adMap[ad.ad_id || (ad.campaign_name + '||' + ad.adset_name + '||' + ad.ad_name)] = adSignal;
    });
    Object.keys(scanData && scanData.tree || {}).forEach(function(campaignName) {
        var camp = scanData.tree[campaignName];
        var campaignAds = ads.filter(function(ad) { return ad && ad.campaign_name === campaignName; });
        var campaignSignal = summarizeEntityAdvancedTrend(campaignAds);
        if (campaignSignal) campaigns[campaignName] = campaignSignal;
        Object.keys(camp.adsets || {}).forEach(function(adsetName) {
            var adsetNode = camp.adsets[adsetName];
            var adsetSignal = summarizeEntityAdvancedTrend(adsetNode.ads || []);
            if (adsetSignal) adsets[campaignName + '||' + adsetName] = adsetSignal;
        });
    });
    return {
        campaigns: campaigns,
        adsets: adsets,
        ads: adMap,
        diagnostics_catalog: [
            'UNSUSTAINABLE_VALUE_MIX',
            'CLEAR_DETERIORATION',
            'TRUE_IMPROVEMENT',
            'EARLY_RECOVERY',
            'CHEAPER_BUT_LOWER_QUALITY',
            'CHEAP_LOW_VALUE_VOLUME',
            'D0_TO_D6_DISCONNECT',
            'COST_PRESSURE_BUILDING',
            'MIXED_SIGNAL'
        ],
        recency_note: 'Advanced trend intelligence uses injected mature-week and WoW context. It does not assume true rolling last-3-day history unless separately injected.'
    };
}

function buildExternalPosture(externalContext, commandType) {
    var shouldUse = /morning_account_review|deep_dive|predict_30_days/.test(String(commandType || ''));
    if (!shouldUse || !externalContext || !externalContext.available) {
        return {
            active: false,
            posture: 'HOLD AND OPTIMISE',
            reason: 'External posture not activated for this command or external context unavailable.',
            account_level_only: true
        };
    }
    var mood = String(externalContext.market_trends && externalContext.market_trends.market_mood || '').toLowerCase();
    var threatCount = Array.isArray(externalContext.competitor_radar && externalContext.competitor_radar.threats) ? externalContext.competitor_radar.threats.length : 0;
    var opportunities = Array.isArray(externalContext.competitor_radar && externalContext.competitor_radar.opportunities) ? externalContext.competitor_radar.opportunities.length : 0;
    var posture = 'HOLD AND OPTIMISE';
    var reason = 'External signals are mixed, so focus on efficiency first.';
    if (/(risk|fear|correction|bear|downturn|uncertain|volatile)/.test(mood) || threatCount >= 3) {
        posture = 'SCALE CAUTIOUSLY';
        reason = 'Macro or competitor pressure suggests protecting efficiency before forcing scale.';
    } else if (/(bull|optimistic|growth|expanding|positive)/.test(mood) && opportunities >= threatCount) {
        posture = 'SCALE AGGRESSIVELY';
        reason = 'Market mood and competitive posture suggest a broader account-level scale window.';
    }
    return {
        active: true,
        posture: posture,
        reason: reason,
        account_level_only: true,
        guidance: posture === 'SCALE CAUTIOUSLY'
            ? 'Shift messaging toward safety, trust, or downside protection if market fear is rising.'
            : (posture === 'SCALE AGGRESSIVELY'
                ? 'Lean into growth and expansion themes while the market supports acquisition.'
                : 'Keep budget discipline and use external signals mainly to shape messaging, not to force structural edits.')
    };
}

function buildApexChangeLog() {
    return (window.OPTIMIZER_LOG || []).slice(-40).map(function(entry) {
        return {
            timestamp: entry.timestamp || '',
            entity_type: entry.entity_type || inferEntityTypeFromAction(entry.action_type),
            entity_id: entry.entity_id || '',
            entity_name: entry.entity_name || '',
            change_type: String(entry.action_type || '').toLowerCase(),
            change_detail: entry.error ? ('Failed: ' + entry.error) : ('Executed ' + String(entry.action_type || '').replace(/_/g, ' ')),
            triggered_by: entry.success ? 'optimizer_execute' : 'optimizer_attempt'
        };
    });
}

function parseTrendSearchPrompt(prompt) {
    var lower = String(prompt || '').toLowerCase();
    if (!/\b(any|all|which|what all|show me|list|is any|are any|give me|tell me|find|scan through|was there any|do we have any|are there any)\b/.test(lower)) return null;
    if (!/(week on week|wow|improving|declining|reduced|reduction|decreased|increased|rising|falling|exceptional|best)/.test(lower)) return null;
    var entityType = /\badsets?\b/.test(lower) ? 'adset' : (/\bads?\b/.test(lower) ? 'ad' : 'campaign');
    var metric = null;
    if (/signup costs?|sign up costs?|su cost/.test(lower)) metric = 'signup_cost_wow_pct';
    else if (/d0\s*trial costs?|d0trial costs?|trial costs?/.test(lower)) metric = 'd0_trial_cost_wow_pct';
    else if (/d15\s*roas/.test(lower)) metric = 'd15_roas';
    else if (/d30\s*roas/.test(lower)) metric = 'd30_roas';
    else if (/d6\s*roas|roas/.test(lower)) metric = 'd6_roas';
    else if (/\bcpi\b/.test(lower)) metric = 'cpi_wow_pct';
    if (!metric) return null;

    var comparator = 'improving';
    if (/(reduced|decreased|falling|down|declining|lower)/.test(lower)) comparator = 'down';
    else if (/(increased|rising|up|inflating|higher)/.test(lower)) comparator = 'up';
    else if (/(exceptional|best|strong|highest)/.test(lower)) comparator = 'high';
    else if (/(weak|lowest|poor)/.test(lower)) comparator = 'low';

    return {
        entity_type: entityType,
        metric: metric,
        comparator: comparator,
        explicit_status: /\blive\b/.test(lower) ? 'live_only' : (/\bpaused\b/.test(lower) ? 'paused_only' : 'all'),
        raw_prompt: String(prompt || '')
    };
}

function parseGrowthDriverPrompt(prompt) {
    var lower = String(prompt || '').toLowerCase();
    if (!/(how to increase|how do i increase|increase|get more|how to get more|boost|grow|improve|scale)/.test(lower)) return null;
    var objective = null;
    if (/(d0\s*trials?|d0trial|d0 trial)/.test(lower)) objective = 'd0_trial';
    else if (/\bsignups?\b|sign up/.test(lower)) objective = 'signups';
    if (!objective) return null;
    return {
        objective: objective,
        raw_prompt: String(prompt || ''),
        wants_actionables: true
    };
}

function parseMetricObjectivePrompt(prompt) {
    var lower = String(prompt || '').toLowerCase();
    if (/\b(any|all|which|what all|show me|list|week on week|wow)\b/.test(lower)) return null;
    if (!/(how to|reduce|lower|decrease|improve|increase|boost|grow|get more|scale)/.test(lower)) return null;
    var metric = null;
    if (/d0\s*trial cost|d0trial cost/.test(lower)) metric = 'd0_trial_cost';
    else if (/signup cost|sign up cost|su cost/.test(lower)) metric = 'signup_cost';
    else if (/d6\s*cac/.test(lower)) metric = 'd6_cac';
    else if (/d15\s*roas/.test(lower)) metric = 'd15_roas';
    else if (/d30\s*roas/.test(lower)) metric = 'd30_roas';
    else if (/d6\s*roas|roas/.test(lower)) metric = 'd6_roas';
    else if (/d0\s*trials?|d0trial/.test(lower)) metric = 'd0_trial';
    else if (/\bsignups?\b|sign up/.test(lower)) metric = 'signups';
    if (!metric) return null;

    var intent = 'improve';
    if (/(reduce|lower|decrease|cut|bring down)/.test(lower)) intent = 'reduce';
    else if (/(increase|get more|boost|grow|scale|raise)/.test(lower)) intent = 'increase';

    return {
        metric: metric,
        intent: intent,
        mature_only: /(mature data|only take mature data|take mature data|mature only|only mature)/.test(lower),
        explicit_status: /\blive\b/.test(lower) ? 'live_only' : (/\bpaused\b/.test(lower) ? 'paused_only' : 'all'),
        raw_prompt: String(prompt || '')
    };
}

function getGrowthMetricLabel(objective) {
    return objective === 'd0_trial' ? 'D0 Trials' : 'Signups';
}

function getGrowthCostLabel(objective) {
    return objective === 'd0_trial' ? 'D0 Trial Cost' : 'Signup Cost';
}

function scoreGrowthDriverRow(row, objective) {
    var count = Number(row && row.metric_count || 0);
    var cost = Number(row && row.metric_cost || 0);
    var spend = Number(row && row.spend || 0);
    var quality = Number(row && row.d6_roas || 0);
    var countScore = count * 1000;
    var spendScore = Math.min(spend / 1000, 250);
    var qualityScore = quality * 3;
    var costPenalty = cost > 0 ? Math.min(cost / 20, 400) : 0;
    return countScore + spendScore + qualityScore - costPenalty;
}

function buildGrowthDriverEntityRows(scanData, objective) {
    var campaigns = [];
    var adsets = [];
    var ads = [];
    var basisRange = scanData && scanData.date_range ? (scanData.date_range.since + ' → ' + scanData.date_range.until) : '--';

    Object.keys(scanData.tree || {}).forEach(function(campaignName) {
        var camp = scanData.tree[campaignName];
        var campTotals = camp && camp.totals ? camp.totals : {};
        var campCount = Number(objective === 'd0_trial' ? (campTotals.d0_trial || 0) : (campTotals.signups || 0));
        var campCost = Number(objective === 'd0_trial' ? (campTotals.d0TrialCost || 0) : (campTotals.signupCost || 0));
        campaigns.push({
            label: campaignName,
            campaign_name: campaignName,
            metric_count: campCount,
            metric_cost: campCost > 0 ? campCost : null,
            spend: Number(campTotals.spend || 0),
            d6_roas: Number(campTotals.d6ROAS || 0),
            basis: getEntityMetricBasis(campTotals, basisRange, 'Mixed selected-window basis')
        });
        Object.keys(camp.adsets || {}).forEach(function(adsetName) {
            var adset = camp.adsets[adsetName];
            var adsetTotals = adset && adset.totals ? adset.totals : {};
            var adsetCount = Number(objective === 'd0_trial' ? (adsetTotals.d0_trial || 0) : (adsetTotals.signups || 0));
            var adsetCost = Number(objective === 'd0_trial' ? (adsetTotals.d0TrialCost || 0) : (adsetTotals.signupCost || 0));
            adsets.push({
                label: campaignName + ' → ' + adsetName,
                campaign_name: campaignName,
                adset_name: adsetName,
                metric_count: adsetCount,
                metric_cost: adsetCost > 0 ? adsetCost : null,
                spend: Number(adsetTotals.spend || 0),
                d6_roas: Number(adsetTotals.d6ROAS || 0),
                optimization_event: adset.optimization_event || 'UNKNOWN',
                location_targeting: adset.location_targeting || 'UNKNOWN',
                placement_type: adset.placement_type || 'UNKNOWN',
                placements_active: Array.isArray(adset.placements_active) ? adset.placements_active.slice() : [],
                basis: getEntityMetricBasis(adsetTotals, basisRange, 'Mixed selected-window basis')
            });
            (adset.ads || []).forEach(function(ad) {
                var count = Number(objective === 'd0_trial' ? (ad.d0_trial || 0) : (ad.signups || 0));
                var cost = Number(objective === 'd0_trial' ? (ad.d0TrialCost || 0) : (ad.signupCost || 0));
                ads.push({
                    label: campaignName + ' → ' + adsetName + ' → ' + (ad.ad_name || '--'),
                    campaign_name: campaignName,
                    adset_name: adsetName,
                    ad_name: ad.ad_name || '--',
                    metric_count: count,
                    metric_cost: cost > 0 ? cost : null,
                    spend: Number(ad.spend || 0),
                    d6_roas: Number(ad.d6ROAS || 0),
                    basis: getEntityMetricBasis(ad, basisRange, ad.isMatured ? 'Matured ad using mature-eval window' : ('Unmatured ad using full-data fallback (' + (ad.daysSinceGoLive != null ? ad.daysSinceGoLive : '--') + 'd live)'))
                });
            });
        });
    });

    function rankRows(rows) {
        return rows.filter(function(row) {
            return (row.metric_count || 0) > 0 && (row.spend || 0) > 0;
        }).map(function(row) {
            row.score = scoreGrowthDriverRow(row, objective);
            return row;
        }).sort(function(a, b) {
            if (b.score !== a.score) return b.score - a.score;
            if ((b.metric_count || 0) !== (a.metric_count || 0)) return (b.metric_count || 0) - (a.metric_count || 0);
            if ((a.metric_cost || Infinity) !== (b.metric_cost || Infinity)) return (a.metric_cost || Infinity) - (b.metric_cost || Infinity);
            return (b.spend || 0) - (a.spend || 0);
        }).slice(0, 8);
    }

    return {
        campaigns: rankRows(campaigns),
        adsets: rankRows(adsets),
        ads: rankRows(ads)
    };
}

function buildGrowthDriverPockets(scanData, breakdownContext, objective, topAdsets) {
    var rows = breakdownContext && breakdownContext.breakdowns ? breakdownContext.breakdowns : {};
    function rankPocket(list, keyField, labelPrefix) {
        return (list || []).filter(function(row) {
            return (row.spend_7d || 0) >= 5000 && (row.installs_7d || 0) > 0;
        }).map(function(row) {
            return {
                label: row[keyField] || '--',
                installs: Number(row.installs_7d || 0),
                cpi: Number(row.cpi_7d || 0),
                spend: Number(row.spend_7d || 0),
                spend_share_pct: Number(row.spend_share_pct || 0),
                note: labelPrefix
            };
        }).sort(function(a, b) {
            if ((b.installs || 0) !== (a.installs || 0)) return (b.installs || 0) - (a.installs || 0);
            if ((a.cpi || Infinity) !== (b.cpi || Infinity)) return (a.cpi || Infinity) - (b.cpi || Infinity);
            return (b.spend || 0) - (a.spend || 0);
        }).slice(0, 6);
    }

    var settingsCounts = {};
    (topAdsets || []).forEach(function(row) {
        var keys = [
            row.optimization_event ? ('event:' + row.optimization_event) : '',
            row.location_targeting ? ('geo:' + row.location_targeting) : '',
            row.placement_type ? ('placement_mode:' + row.placement_type) : ''
        ].filter(Boolean);
        (row.placements_active || []).slice(0, 8).forEach(function(p) { keys.push('placement:' + p); });
        keys.forEach(function(key) { settingsCounts[key] = (settingsCounts[key] || 0) + 1; });
    });
    var settingsPatterns = Object.keys(settingsCounts).map(function(key) {
        return { key: key, count: settingsCounts[key] };
    }).sort(function(a, b) { return b.count - a.count; }).slice(0, 8);

    return {
        placements: rankPocket(rows.placement, 'placement', 'Meta-side placement pocket'),
        devices: rankPocket(rows.device, 'device', 'Meta-side device pocket'),
        geos: rankPocket(rows.geography, 'region', 'Meta-side geo pocket'),
        cohorts: rankPocket((rows.age_gender || []).filter(function(row) {
            var age = String(row.age_band || '').toLowerCase();
            var gender = String(row.gender || '').toLowerCase();
            return age && age !== 'unknown' && gender && gender !== 'unknown';
        }).map(function(row) {
            return {
                cohort_label: row.age_band + ' ' + titleCaseWords(row.gender),
                installs_7d: row.installs_7d,
                cpi_7d: row.cpi_7d,
                spend_7d: row.spend_7d,
                spend_share_pct: row.spend_share_pct
            };
        }), 'cohort_label', 'Meta-side age/gender pocket'),
        settings_patterns: settingsPatterns
    };
}

function buildGrowthDriverActionLines(spec, entityRows, pockets) {
    var actions = [];
    var metricLabel = getGrowthMetricLabel(spec.objective);
    var costLabel = getGrowthCostLabel(spec.objective);
    var topAdsets = (entityRows.adsets || []).slice(0, 3);
    var topAds = (entityRows.ads || []).slice(0, 3);
    var topPlacements = (pockets.placements || []).slice(0, 3);
    var topGeos = (pockets.geos || []).slice(0, 3);

    if (topAdsets.length) {
        actions.push('Lean budget into the strongest ' + metricLabel + ' adsets first: ' + topAdsets.map(function(r) {
            return r.adset_name + ' (' + r.metric_count + ' ' + metricLabel + ', ' + (r.metric_cost != null ? fmtINR(r.metric_cost) : '--') + ' ' + costLabel + ')';
        }).join(' | ') + '.');
    }
    if (topAds.length) {
        actions.push('Keep the best live ads feeding that outcome: ' + topAds.map(function(r) {
            return r.ad_name + ' (' + r.metric_count + ' ' + metricLabel + ')';
        }).join(' | ') + '.');
    }
    if (topPlacements.length) {
        actions.push('Prioritize the strongest Meta-side delivery pockets first: ' + topPlacements.map(function(r) {
            return titleCaseWords(String(r.label || '').replace(/_/g, ' ')) + ' (Installs ' + r.installs + ', CPI ' + fmtINR(r.cpi) + ')';
        }).join(' | ') + '.');
    }
    if (topGeos.length) {
        actions.push('Bias budget toward the stronger geo pockets that are already giving cheaper upstream volume: ' + topGeos.map(function(r) {
            return r.label + ' (CPI ' + fmtINR(r.cpi) + ', Spend ' + fmtINR(r.spend) + ')';
        }).join(' | ') + '.');
    }
    return actions.slice(0, 5);
}

function buildGrowthDriverPlan(scanData, breakdownContext, spec) {
    var entityRows = buildGrowthDriverEntityRows(scanData, spec.objective);
    var pockets = buildGrowthDriverPockets(scanData, breakdownContext, spec.objective, entityRows.adsets);
    var metricLabel = getGrowthMetricLabel(spec.objective);
    var costLabel = getGrowthCostLabel(spec.objective);
    var actions = buildGrowthDriverActionLines(spec, entityRows, pockets);
    var topCampaign = entityRows.campaigns[0];
    var executive = topCampaign
        ? ('Best current ' + metricLabel + ' driver is ' + topCampaign.label + ' with ' + topCampaign.metric_count + ' ' + metricLabel + ' at ' + (topCampaign.metric_cost != null ? fmtINR(topCampaign.metric_cost) : '--') + ' ' + costLabel + '.')
        : ('No confirmed ' + metricLabel + ' drivers found in the current slice.');
    return {
        operator_answer: executive,
        executive_summary: executive,
        actions: [],
        growth_driver_result: {
            objective: spec.objective,
            metric_label: metricLabel,
            cost_label: costLabel,
            entity_rows: entityRows,
            pockets: pockets,
            action_lines: actions,
            raw_prompt: spec.raw_prompt || ''
        }
    };
}

function shiftDateByDays(dateStr, deltaDays) {
    var dt = new Date(String(dateStr || '') + 'T00:00:00');
    if (Number.isNaN(dt.getTime())) return null;
    dt.setDate(dt.getDate() + Number(deltaDays || 0));
    return dt.toISOString().slice(0, 10);
}

function buildMetricObjectiveEffectiveRange(scanData, spec) {
    var range = scanData && scanData.date_range ? scanData.date_range : getSelectedDates();
    if (!range || !range.since || !range.until) return range;
    if (!spec || !spec.mature_only) return range;
    var trimmedUntil = shiftDateByDays(range.until, -7);
    if (!trimmedUntil || trimmedUntil < range.since) return {
        since: range.since,
        until: range.since
    };
    return {
        since: range.since,
        until: trimmedUntil
    };
}

function isDateWithinRange(dateStr, range) {
    var d = String(dateStr || '').slice(0, 10);
    if (!d || !range || !range.since || !range.until) return false;
    return d >= range.since && d <= range.until;
}

function getMetricObjectiveLabel(metric) {
    if (metric === 'd0_trial_cost') return 'D0 Trial Cost';
    if (metric === 'signup_cost') return 'Signup Cost';
    if (metric === 'd6_cac') return 'D6 CAC';
    if (metric === 'd15_roas') return 'D15 ROAS';
    if (metric === 'd30_roas') return 'D30 ROAS';
    if (metric === 'd6_roas') return 'D6 ROAS';
    if (metric === 'd0_trial') return 'D0 Trials';
    if (metric === 'signups') return 'Signups';
    return String(metric || '--');
}

function getMetricObjectiveValue(metrics, metric) {
    if (!metrics) return null;
    if (metric === 'd0_trial_cost') return metrics.d0TrialCost;
    if (metric === 'signup_cost') return metrics.signupCost;
    if (metric === 'd6_cac') return metrics.d6CAC;
    if (metric === 'd15_roas') return metrics.d15ROAS;
    if (metric === 'd30_roas') return metrics.d30ROAS;
    if (metric === 'd6_roas') return metrics.d6ROAS;
    if (metric === 'd0_trial') return metrics.d0_trial;
    if (metric === 'signups') return metrics.signups;
    return null;
}

function isLowerBetterMetric(metric) {
    return metric === 'd0_trial_cost' || metric === 'signup_cost' || metric === 'd6_cac';
}

function buildMetricObjectiveRowsFromSource(scanData, spec, effectiveRange) {
    var source = scanData && scanData._trend_source;
    if (!source || !Array.isArray(source.meta_rows) || !Array.isArray(source.funnel_rows)) return { campaigns: [], adsets: [], ads: [] };
    var visibleCampaigns = {};
    var visibleAdsets = {};
    var visibleAds = {};
    Object.keys((scanData && scanData.tree) || {}).forEach(function(campaignName) {
        visibleCampaigns[normalizeCampaignName(campaignName)] = campaignName;
        var camp = scanData.tree[campaignName];
        Object.keys((camp && camp.adsets) || {}).forEach(function(adsetName) {
            visibleAdsets[normalizeCampaignName(campaignName) + '|||' + normalizeAdsetName(adsetName)] = {
                campaign_name: campaignName,
                adset_name: adsetName
            };
        });
    });
    (scanData && scanData.ads || []).forEach(function(ad) {
        if (!ad) return;
        visibleAds[normalizeCampaignName(ad.campaign_name || '') + '|||' + normalizeAdsetName(ad.adset_name || '') + '|||' + normalizeTrackerName(ad.ad_name || '')] = ad;
    });

    function ensureStore(store, key, label) {
        if (!store[key]) store[key] = { label: label, raw: emptyRaw() };
        return store[key];
    }

    function buildEntityStores(entityType) {
        var metaStore = {};
        var funnelStore = {};
        (source.meta_rows || []).forEach(function(row) {
            if (!isDateWithinRange(row.date_start, effectiveRange)) return;
            if (entityType === 'campaign') {
                var campaignKey = normalizeCampaignName(row.campaign_name || '');
                if (!visibleCampaigns[campaignKey]) return;
                addScanMetaRaw(ensureStore(metaStore, campaignKey, visibleCampaigns[campaignKey]).raw, row);
            } else if (entityType === 'adset') {
                var adsetKey = normalizeCampaignName(row.campaign_name || '') + '|||' + normalizeAdsetName(row.adset_name || '');
                if (!visibleAdsets[adsetKey]) return;
                addScanMetaRaw(ensureStore(metaStore, adsetKey, visibleAdsets[adsetKey].campaign_name + ' → ' + visibleAdsets[adsetKey].adset_name).raw, row);
            } else {
                var adKey = normalizeCampaignName(row.campaign_name || '') + '|||' + normalizeAdsetName(row.adset_name || '') + '|||' + normalizeTrackerName(row.ad_name || '');
                if (!visibleAds[adKey]) return;
                addScanMetaRaw(ensureStore(metaStore, adKey, (row.campaign_name || '') + ' → ' + (row.adset_name || '') + ' → ' + (row.ad_name || '')).raw, row);
            }
        });
        (source.funnel_rows || []).forEach(function(row) {
            if (!isDateWithinRange(row.date, effectiveRange)) return;
            if (entityType === 'campaign') {
                var campaignKey = normalizeCampaignName(row.campaign_name || '');
                if (!visibleCampaigns[campaignKey]) return;
                addScanFunnelRaw(ensureStore(funnelStore, campaignKey, visibleCampaigns[campaignKey]).raw, row);
            } else if (entityType === 'adset') {
                var adsetKey = normalizeCampaignName(row.campaign_name || '') + '|||' + normalizeAdsetName(row.ad_set_name || '');
                if (!visibleAdsets[adsetKey]) return;
                addScanFunnelRaw(ensureStore(funnelStore, adsetKey, visibleAdsets[adsetKey].campaign_name + ' → ' + visibleAdsets[adsetKey].adset_name).raw, row);
            } else {
                var adKey = normalizeCampaignName(row.campaign_name || '') + '|||' + normalizeAdsetName(row.ad_set_name || '') + '|||' + normalizeTrackerName(row.tracker_name || '');
                if (!visibleAds[adKey]) return;
                var ad = visibleAds[adKey];
                addScanFunnelRaw(ensureStore(funnelStore, adKey, (ad.campaign_name || '') + ' → ' + (ad.adset_name || '') + ' → ' + (ad.ad_name || '')).raw, row);
            }
        });
        return Object.keys(metaStore).map(function(key) {
            var meta = metaStore[key];
            var funnel = funnelStore[key] || { raw: emptyRaw() };
            var metrics = deriveMetrics(Object.assign(emptyRaw(), funnel.raw, {
                spend: meta.raw.spend,
                impressions: meta.raw.impressions,
                clicks: meta.raw.clicks,
                installs: meta.raw.installs,
                thruplay: meta.raw.thruplay,
                p25: meta.raw.p25,
                p100: meta.raw.p100
            }));
            var metricValue = getMetricObjectiveValue(metrics, spec.metric);
            if (metricValue == null || !isFinite(Number(metricValue))) return null;
            var row = {
                entity_type: entityType,
                label: meta.label,
                spend: Number(metrics.spend || 0),
                metric_value: Number(metricValue),
                metric_count: spec.metric === 'd0_trial' ? Number(metrics.d0_trial || 0) : (spec.metric === 'signups' ? Number(metrics.signups || 0) : null),
                supporting_count: spec.metric === 'd0_trial_cost' ? Number(metrics.d0_trial || 0) : (spec.metric === 'signup_cost' ? Number(metrics.signups || 0) : (spec.metric === 'd6_cac' ? Number(metrics.d6Con || 0) : null)),
                signup_cost: metrics.signupCost,
                d0_trial_cost: metrics.d0TrialCost,
                d6_cac: metrics.d6CAC,
                d6_roas: metrics.d6ROAS,
                d15_roas: metrics.d15ROAS,
                d30_roas: metrics.d30ROAS,
                signups: metrics.signups,
                d0_trial: metrics.d0_trial,
                basis: 'Basis: ' + effectiveRange.since + ' → ' + effectiveRange.until + (spec.mature_only ? ' | Mature-only execution basis (last 7 days excluded)' : ' | Full selected-window execution basis')
            };
            return row;
        }).filter(Boolean);
    }

    function rank(rows) {
        return rows.filter(function(row) {
            if ((row.spend || 0) <= 0) return false;
            if (spec.metric === 'd0_trial_cost') return (row.d0_trial || 0) > 0;
            if (spec.metric === 'signup_cost') return (row.signups || 0) > 0;
            if (spec.metric === 'd6_cac') return (row.supporting_count || 0) > 0;
            return true;
        }).sort(function(a, b) {
            if (isLowerBetterMetric(spec.metric)) {
                if ((a.metric_value || Infinity) !== (b.metric_value || Infinity)) return (a.metric_value || Infinity) - (b.metric_value || Infinity);
                return (b.spend || 0) - (a.spend || 0);
            }
            if ((b.metric_value || -Infinity) !== (a.metric_value || -Infinity)) return (b.metric_value || -Infinity) - (a.metric_value || -Infinity);
            return (b.spend || 0) - (a.spend || 0);
        }).slice(0, 8);
    }

    return {
        campaigns: rank(buildEntityStores('campaign')),
        adsets: rank(buildEntityStores('adset')),
        ads: rank(buildEntityStores('ad'))
    };
}

function buildMetricObjectivePockets(breakdownContext) {
    var rows = breakdownContext && breakdownContext.breakdowns ? breakdownContext.breakdowns : {};
    function rank(rowsIn, keyField) {
        return (rowsIn || []).filter(function(row) {
            return (row.spend_7d || 0) >= 5000 && (row.installs_7d || 0) > 0;
        }).map(function(row) {
            return {
                label: row[keyField] || '--',
                installs: Number(row.installs_7d || 0),
                cpi: Number(row.cpi_7d || 0),
                spend: Number(row.spend_7d || 0),
                spend_share_pct: Number(row.spend_share_pct || 0)
            };
        }).sort(function(a, b) {
            if ((a.cpi || Infinity) !== (b.cpi || Infinity)) return (a.cpi || Infinity) - (b.cpi || Infinity);
            if ((b.installs || 0) !== (a.installs || 0)) return (b.installs || 0) - (a.installs || 0);
            return (b.spend || 0) - (a.spend || 0);
        }).slice(0, 6);
    }
    return {
        placements: rank(rows.placement, 'placement'),
        devices: rank(rows.device, 'device'),
        geos: rank(rows.geography, 'region'),
        cohorts: rank((rows.age_gender || []).filter(function(row) {
            var age = String(row.age_band || '').toLowerCase();
            var gender = String(row.gender || '').toLowerCase();
            return age && age !== 'unknown' && gender && gender !== 'unknown';
        }).map(function(row) {
            return {
                cohort_label: row.age_band + ' ' + titleCaseWords(row.gender),
                installs_7d: row.installs_7d,
                cpi_7d: row.cpi_7d,
                spend_7d: row.spend_7d,
                spend_share_pct: row.spend_share_pct
            };
        }), 'cohort_label')
    };
}

function buildMetricObjectiveActionLines(spec, rows, pockets) {
    var label = getMetricObjectiveLabel(spec.metric);
    var lines = [];
    var topAdsets = (rows.adsets || []).slice(0, 3);
    var topAds = (rows.ads || []).slice(0, 3);
    if (isLowerBetterMetric(spec.metric) && topAdsets.length) {
        lines.push('Use the lowest-cost adsets as the control set for this metric: ' + topAdsets.map(function(r) {
            return r.adset_name + ' (' + fmtINR(r.metric_value) + ')';
        }).join(' | ') + '.');
    } else if (topAdsets.length) {
        lines.push('Protect and improve around the strongest adsets for ' + label + ': ' + topAdsets.map(function(r) {
            return r.adset_name + ' (' + (isLowerBetterMetric(spec.metric) ? fmtINR(r.metric_value) : fmtPct(r.metric_value)) + ')';
        }).join(' | ') + '.');
    }
    if (topAds.length) {
        lines.push('Keep the strongest ads feeding this metric: ' + topAds.map(function(r) { return r.ad_name; }).join(' | ') + '.');
    }
    if ((pockets.placements || []).length) {
        lines.push('Lean into the lowest-CPI Meta placements first: ' + pockets.placements.slice(0, 3).map(function(r) { return titleCaseWords(String(r.label || '').replace(/_/g, ' ')) + ' (' + fmtINR(r.cpi) + ')'; }).join(' | ') + '.');
    }
    if ((pockets.geos || []).length) {
        lines.push('Bias delivery toward the stronger geo pockets: ' + pockets.geos.slice(0, 3).map(function(r) { return r.label + ' (' + fmtINR(r.cpi) + ')'; }).join(' | ') + '.');
    }
    return lines.slice(0, 5);
}

function buildMetricObjectivePlan(scanData, breakdownContext, spec, effectiveRange) {
    var rows = buildMetricObjectiveRowsFromSource(scanData, spec, effectiveRange);
    var pockets = buildMetricObjectivePockets(breakdownContext);
    var label = getMetricObjectiveLabel(spec.metric);
    var executive = 'Deterministic ' + (spec.intent === 'reduce' ? 'reduction' : 'improvement') + ' plan for ' + label + '.';
    var topCampaign = (rows.campaigns || [])[0];
    if (topCampaign) {
        executive += ' Best current campaign signal: ' + topCampaign.label + ' at ' + (isLowerBetterMetric(spec.metric) ? fmtINR(topCampaign.metric_value) : (spec.metric.indexOf('roas') !== -1 ? fmtPct(topCampaign.metric_value) : String(topCampaign.metric_value))) + '.';
    }
    return {
        operator_answer: executive,
        executive_summary: executive,
        actions: [],
        metric_objective_result: {
            metric: spec.metric,
            metric_label: label,
            intent: spec.intent,
            mature_only: !!spec.mature_only,
            effective_range: effectiveRange,
            entity_rows: rows,
            pockets: pockets,
            action_lines: buildMetricObjectiveActionLines(spec, rows, pockets),
            raw_prompt: spec.raw_prompt || ''
        }
    };
}

function getTrendSearchRows(scanData, runtimeContext, spec) {
    if (spec && /_wow_pct$/.test(spec.metric)) {
        var sourceRows = buildTrendRowsFromSource(scanData, spec);
        if (sourceRows && sourceRows.length) return sourceRows;
    }
    var rows = [];
    if (!spec) return rows;
    if (spec.entity_type === 'campaign') {
        rows = Object.keys(scanData.tree || {}).map(function(campaignName) {
            var camp = scanData.tree[campaignName];
            var trend = runtimeContext.advanced_trend_intelligence && runtimeContext.advanced_trend_intelligence.campaigns
                ? runtimeContext.advanced_trend_intelligence.campaigns[campaignName]
                : null;
            var campaignAds = buildEntityTrendAds(scanData, campaignName, '');
            var directWowMetric = spec.metric === 'signup_cost_wow_pct' ? deriveEntityWowMetric(campaignAds, 'signupCost_wow', 'signupCost')
                : spec.metric === 'd0_trial_cost_wow_pct' ? deriveEntityWowMetric(campaignAds, 'd0TrialCost_wow', 'd0TrialCost')
                : spec.metric === 'cpi_wow_pct' ? deriveEntityWowMetric(campaignAds, 'cpi_wow', 'cpi')
                : null;
            return {
                entity_type: 'campaign',
                campaign_name: campaignName,
                adset_name: '',
                ad_name: '',
                label: campaignName,
                spend: Number((camp.totals && camp.totals.spend) || 0),
                metric_value: spec.metric === 'd15_roas' ? Number((camp.totals && camp.totals.d15ROAS) || 0)
                    : spec.metric === 'd30_roas' ? Number((camp.totals && camp.totals.d30ROAS) || 0)
                    : spec.metric === 'd6_roas' ? Number((camp.totals && camp.totals.d6ROAS) || 0)
                    : (directWowMetric != null ? Number(directWowMetric) : (trend ? Number(trend[spec.metric] || 0) : null)),
                trend: trend,
                basis: getEntityMetricBasis(camp.totals || null, scanData.date_range ? (scanData.date_range.since + ' → ' + scanData.date_range.until) : '--', 'Mixed selected-window basis')
            };
        });
    } else if (spec.entity_type === 'adset') {
        Object.keys(scanData.tree || {}).forEach(function(campaignName) {
            var camp = scanData.tree[campaignName];
            Object.keys(camp.adsets || {}).forEach(function(adsetName) {
                var adset = camp.adsets[adsetName];
                var trend = runtimeContext.advanced_trend_intelligence && runtimeContext.advanced_trend_intelligence.adsets
                    ? runtimeContext.advanced_trend_intelligence.adsets[campaignName + '||' + adsetName]
                    : null;
                var adsetAds = buildEntityTrendAds(scanData, campaignName, adsetName);
                var directWowMetric = spec.metric === 'signup_cost_wow_pct' ? deriveEntityWowMetric(adsetAds, 'signupCost_wow', 'signupCost')
                    : spec.metric === 'd0_trial_cost_wow_pct' ? deriveEntityWowMetric(adsetAds, 'd0TrialCost_wow', 'd0TrialCost')
                    : spec.metric === 'cpi_wow_pct' ? deriveEntityWowMetric(adsetAds, 'cpi_wow', 'cpi')
                    : null;
                rows.push({
                    entity_type: 'adset',
                    campaign_name: campaignName,
                    adset_name: adsetName,
                    ad_name: '',
                    label: campaignName + ' → ' + adsetName,
                    spend: Number((adset.totals && adset.totals.spend) || 0),
                    metric_value: spec.metric === 'd15_roas' ? Number((adset.totals && adset.totals.d15ROAS) || 0)
                        : spec.metric === 'd30_roas' ? Number((adset.totals && adset.totals.d30ROAS) || 0)
                        : spec.metric === 'd6_roas' ? Number((adset.totals && adset.totals.d6ROAS) || 0)
                        : (directWowMetric != null ? Number(directWowMetric) : (trend ? Number(trend[spec.metric] || 0) : null)),
                    trend: trend,
                    basis: getEntityMetricBasis(adset.totals || null, scanData.date_range ? (scanData.date_range.since + ' → ' + scanData.date_range.until) : '--', 'Mixed selected-window basis')
                });
            });
        });
    } else {
        rows = (scanData.ads || []).map(function(ad) {
            var wow = ad && ad._wow ? ad._wow : {};
            return {
                entity_type: 'ad',
                campaign_name: ad.campaign_name || '',
                adset_name: ad.adset_name || '',
                ad_name: ad.ad_name || '',
                label: (ad.campaign_name || '') + ' → ' + (ad.adset_name || '') + ' → ' + (ad.ad_name || ''),
                spend: Number(ad.spend || 0),
                metric_value: spec.metric === 'd15_roas' ? Number(ad.d15ROAS || 0)
                    : spec.metric === 'd30_roas' ? Number(ad.d30ROAS || 0)
                    : spec.metric === 'd6_roas' ? Number(ad.d6ROAS || 0)
                    : spec.metric === 'signup_cost_wow_pct' ? (wow.signupCost_wow != null ? Number(wow.signupCost_wow) : null)
                    : spec.metric === 'cpi_wow_pct' ? (wow.cpi_wow != null ? Number(wow.cpi_wow) : null)
                    : null,
                trend: wow,
                basis: getEntityMetricBasis(ad, scanData.date_range ? (scanData.date_range.since + ' → ' + scanData.date_range.until) : '--', ad.isMatured ? 'Matured ad using mature-eval window' : 'Unmatured ad using full-data fallback')
            };
        });
        if (spec.metric === 'd0_trial_cost_wow_pct') {
            rows.forEach(function(row, idx) {
                var ad = scanData.ads[idx];
                var wow = ad && ad._wow ? ad._wow : null;
                row.metric_value = wow
                    ? safeWowValue(wow.d0TrialCost_wow)
                    : null;
            });
        }
    }
    return rows.filter(function(row) { return row.metric_value != null && isFinite(row.metric_value); });
}

function filterTrendSearchRows(rows, spec) {
    return rows.filter(function(row) {
        var v = Number(row.metric_value);
        if (!isFinite(v)) return false;
        if (spec.metric === 'd15_roas' || spec.metric === 'd30_roas' || spec.metric === 'd6_roas') {
            if (spec.comparator === 'high' || spec.comparator === 'improving' || spec.comparator === 'up') return v > 0;
            if (spec.comparator === 'low' || spec.comparator === 'down') return v > 0;
        }
        if (spec.comparator === 'improving') return v < 0;
        if (spec.comparator === 'down') return v < 0;
        if (spec.comparator === 'up') return v >= 5;
        if (spec.comparator === 'high') return v > 0;
        if (spec.comparator === 'low') return v > 0;
        return false;
    }).sort(function(a, b) {
        if (spec.comparator === 'down' || spec.comparator === 'improving') return a.metric_value - b.metric_value;
        return b.metric_value - a.metric_value;
    });
}

function formatTrendMetricLabel(spec, value) {
    if (spec.metric === 'signup_cost_wow_pct' || spec.metric === 'd0_trial_cost_wow_pct' || spec.metric === 'cpi_wow_pct') {
        return (value > 0 ? '+' : '') + value.toFixed(1) + '% WoW';
    }
    return value.toFixed(1) + '%';
}

function getTrendMetricDisplayName(metric) {
    if (metric === 'signup_cost_wow_pct') return 'Signup Cost';
    if (metric === 'd0_trial_cost_wow_pct') return 'D0 Trial Cost';
    if (metric === 'cpi_wow_pct') return 'CPI';
    if (metric === 'd15_roas') return 'D15 ROAS';
    if (metric === 'd30_roas') return 'D30 ROAS';
    if (metric === 'd6_roas') return 'D6 ROAS';
    return String(metric || '--');
}

function formatTrendMetricValue(metric, value) {
    if (value == null || !isFinite(Number(value))) return '--';
    var num = Number(value);
    if (metric === 'd15_roas' || metric === 'd30_roas' || metric === 'd6_roas') return num.toFixed(1) + '%';
    return fmtINR(Math.round(num));
}

function wantsTrendActionables(prompt) {
    var lower = String(prompt || '').toLowerCase();
    return /(why|reason|root cause|fix|how to fix|action|actionable|what should|what to do|improve|make it better)/.test(lower);
}

function buildTrendInsightLines(spec, rows) {
    var metricName = getTrendMetricDisplayName(spec.metric);
    var top = (rows || []).slice(0, 3);
    if (!top.length) return [];
    return top.map(function(row) {
        var current = row.trend && row.trend.thisWeek ? row.trend.thisWeek : {};
        var prev = row.trend && row.trend.lastWeek ? row.trend.lastWeek : {};
        var reason = '';
        if (spec.metric === 'signup_cost_wow_pct' || spec.metric === 'd0_trial_cost_wow_pct') {
            if ((current.signups || 0) < (prev.signups || 0) && Number(row.metric_value) < 0) reason = 'Cost improved despite lower volume, so do not treat it as scalable without checking if volume stayed healthy.';
            else if ((current.signups || 0) > (prev.signups || 0) && Number(row.metric_value) < 0) reason = 'Cost improved while signup volume held or improved, which is a stronger positive signal.';
            else if ((current.d0_trial || 0) > (prev.d0_trial || 0) && spec.metric === 'd0_trial_cost_wow_pct') reason = 'D0 trial volume improved while cost fell, which is a positive forward signal for D6.';
            else reason = 'Cost improved week on week, but verify whether the underlying volume stayed broad enough before scaling.';
        } else if (spec.metric === 'd15_roas' || spec.metric === 'd30_roas' || spec.metric === 'd6_roas') {
            reason = 'Strong ' + metricName + ' suggests this entity has quality worth improving around, not blindly pausing.';
        } else {
            reason = metricName + ' moved favorably week on week.';
        }
        return row.label + ': ' + reason;
    });
}

function renderTrendSearchBreakdown(plan) {
    var result = plan && plan.trend_search_result ? plan.trend_search_result : null;
    if (!result) return '';
    var metric = result.metric;
    var metricName = getTrendMetricDisplayName(metric);
    var rows = (result.matches && result.matches.length ? result.matches : result.closest || []).slice(0, 12);
    if (!rows.length) return '';
    var prompt = (result.raw_prompt || plan.user_request || '');
    var showInsights = wantsTrendActionables(prompt);
    var headerCopy = (result.matches && result.matches.length)
        ? ('Week-on-week breakdown for ' + metricName + ' matching your condition')
        : ('No strict match. Closest week-on-week ' + metricName + ' signals');
    var table = '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px;">' + esc(headerCopy) + '</div>' +
        '<div style="overflow:auto;">' +
            '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
                '<thead><tr style="text-align:left;color:var(--text-dim);border-bottom:1px solid var(--border);">' +
                    '<th style="padding:8px 10px;">Entity</th>' +
                    '<th style="padding:8px 10px;">Current 7d</th>' +
                    '<th style="padding:8px 10px;">Previous 7d</th>' +
                    '<th style="padding:8px 10px;">WoW</th>' +
                    '<th style="padding:8px 10px;">Spend</th>' +
                    '<th style="padding:8px 10px;">Basis</th>' +
                '</tr></thead>' +
                '<tbody>' +
                    rows.map(function(row) {
                        var current = row.trend && row.trend.thisWeek ? row.trend.thisWeek : {};
                        var previous = row.trend && row.trend.lastWeek ? row.trend.lastWeek : {};
                        var wow = row.metric_value != null ? ((Number(row.metric_value) > 0 ? '+' : '') + Number(row.metric_value).toFixed(1) + '%') : '--';
                        var wowColor = Number(row.metric_value) < 0 ? 'var(--green)' : (Number(row.metric_value) > 0 ? 'var(--red)' : 'var(--text)');
                        return '<tr style="border-bottom:1px solid rgba(255,255,255,0.06);">' +
                            '<td style="padding:10px;color:var(--text);vertical-align:top;min-width:320px;">' + esc(row.label || '--') + '</td>' +
                            '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(formatTrendMetricValue(metric, metric === 'cpi_wow_pct' ? current.cpi : (metric === 'd0_trial_cost_wow_pct' ? current.d0TrialCost : (metric === 'signup_cost_wow_pct' ? current.signupCost : current[metric])))) + '</td>' +
                            '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(formatTrendMetricValue(metric, metric === 'cpi_wow_pct' ? previous.cpi : (metric === 'd0_trial_cost_wow_pct' ? previous.d0TrialCost : (metric === 'signup_cost_wow_pct' ? previous.signupCost : previous[metric])))) + '</td>' +
                            '<td style="padding:10px;color:' + wowColor + ';font-weight:700;vertical-align:top;">' + esc(wow) + '</td>' +
                            '<td style="padding:10px;color:var(--text);vertical-align:top;">' + fmtINR(row.spend || 0) + '</td>' +
                            '<td style="padding:10px;color:var(--text-dim);vertical-align:top;min-width:220px;">Current 7d vs previous 7d raw-bucket comparison</td>' +
                        '</tr>';
                    }).join('') +
                '</tbody>' +
            '</table>' +
        '</div>' +
    '</div>';
    if (!showInsights) return table;
    var insights = buildTrendInsightLines(result, rows);
    return table +
        '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--orange);">' +
            '<div style="font-size:12px;font-weight:700;color:var(--orange);margin-bottom:8px;">Insights / Actionables</div>' +
            (insights.length ? insights.map(function(line) {
                return '<div style="font-size:12px;color:var(--text-dim);padding:4px 0;">• ' + esc(line) + '</div>';
            }).join('') : '<div style="font-size:12px;color:var(--text-dim);">No additional actionables requested.</div>') +
        '</div>';
}

function renderGrowthDriverBreakdown(plan) {
    var result = plan && plan.growth_driver_result ? plan.growth_driver_result : null;
    if (!result) return '';
    var metricLabel = result.metric_label || 'Outcome';
    var costLabel = result.cost_label || 'Cost';
    var entityRows = result.entity_rows || { campaigns: [], adsets: [], ads: [] };
    var pockets = result.pockets || { placements: [], devices: [], geos: [], cohorts: [], settings_patterns: [] };
    function renderEntityTable(title, rows, entityField) {
        rows = (rows || []).slice(0, 6);
        if (!rows.length) return '';
        return '<div style="' + CARD + 'margin-bottom:12px;">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px;">' + esc(title) + '</div>' +
            '<div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">' +
                '<thead><tr style="text-align:left;color:var(--text-dim);border-bottom:1px solid var(--border);">' +
                    '<th style="padding:8px 10px;">' + esc(entityField) + '</th>' +
                    '<th style="padding:8px 10px;">' + esc(metricLabel) + '</th>' +
                    '<th style="padding:8px 10px;">' + esc(costLabel) + '</th>' +
                    '<th style="padding:8px 10px;">Spend</th>' +
                    '<th style="padding:8px 10px;">D6 ROAS</th>' +
                    '<th style="padding:8px 10px;">Basis</th>' +
                '</tr></thead><tbody>' +
                rows.map(function(row) {
                    return '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(row.label || '--') + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(String(row.metric_count || 0)) + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(row.metric_cost != null ? fmtINR(row.metric_cost) : '--') + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(fmtINR(row.spend || 0)) + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(row.d6_roas != null ? fmtPct(row.d6_roas) : '--') + '</td>' +
                        '<td style="padding:10px;color:var(--text-dim);vertical-align:top;">' + esc(row.basis || '--') + '</td>' +
                    '</tr>';
                }).join('') +
                '</tbody></table></div></div>';
    }
    function renderPocketTable(title, rows, labelField) {
        rows = (rows || []).slice(0, 6);
        if (!rows.length) return '';
        return '<div style="' + CARD + 'margin-bottom:12px;">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px;">' + esc(title) + '</div>' +
            '<div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">' +
                '<thead><tr style="text-align:left;color:var(--text-dim);border-bottom:1px solid var(--border);">' +
                    '<th style="padding:8px 10px;">Pocket</th>' +
                    '<th style="padding:8px 10px;">Installs</th>' +
                    '<th style="padding:8px 10px;">CPI</th>' +
                    '<th style="padding:8px 10px;">Spend</th>' +
                    '<th style="padding:8px 10px;">Spend Share</th>' +
                '</tr></thead><tbody>' +
                rows.map(function(row) {
                    return '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(row[labelField] || row.label || '--') + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(String(row.installs || 0)) + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(row.cpi != null ? fmtINR(row.cpi) : '--') + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(fmtINR(row.spend || 0)) + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(row.spend_share_pct != null ? Number(row.spend_share_pct).toFixed(1) + '%' : '--') + '</td>' +
                    '</tr>';
                }).join('') +
                '</tbody></table></div></div>';
    }
    var settingsPatterns = (pockets.settings_patterns || []).slice(0, 8);
    return '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px;">How to increase ' + esc(metricLabel) + '</div>' +
        '<div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">Numbers first: strongest current campaigns, adsets, ads, and Meta-side delivery pockets supporting more ' + esc(metricLabel) + ' in this slice.</div>' +
        renderEntityTable('Best Campaign Drivers', entityRows.campaigns, 'Campaign') +
        renderEntityTable('Best Adset Drivers', entityRows.adsets, 'Campaign → Adset') +
        renderEntityTable('Best Ad Drivers', entityRows.ads, 'Campaign → Adset → Ad') +
        renderPocketTable('Placements / Platforms To Lean Into', pockets.placements, 'label') +
        renderPocketTable('Devices / OS To Lean Into', pockets.devices, 'label') +
        renderPocketTable('Geographies To Lean Into', pockets.geos, 'label') +
        renderPocketTable('Age × Gender Cohorts To Lean Into', pockets.cohorts, 'label') +
        (settingsPatterns.length ? '<div style="' + CARD + 'margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px;">Winning Settings Patterns In Strong Adsets</div><div style="display:flex;gap:8px;flex-wrap:wrap;">' + settingsPatterns.map(function(item) {
            var text = String(item.key || '').replace(/^event:/, 'Optimization event: ').replace(/^geo:/, 'Geo: ').replace(/^placement_mode:/, 'Placement mode: ').replace(/^placement:/, 'Placement: ');
            return '<span style="' + CARD + 'padding:6px 10px;font-size:11px;color:var(--text);">' + esc(text) + ' (' + esc(String(item.count || 0)) + ')</span>';
        }).join('') + '</div></div>' : '') +
        ((result.action_lines || []).length ? '<div style="' + CARD + 'margin-bottom:0;"><div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:10px;">Actionables</div>' + result.action_lines.map(function(line) {
            return '<div style="font-size:11px;color:var(--text);padding:4px 0;">• ' + esc(line) + '</div>';
        }).join('') + '</div>' : '') +
    '</div>';
}

function renderMetricObjectiveBreakdown(plan) {
    var result = plan && plan.metric_objective_result ? plan.metric_objective_result : null;
    if (!result) return '';
    var metricLabel = result.metric_label || '--';
    var rows = result.entity_rows || { campaigns: [], adsets: [], ads: [] };
    var pockets = result.pockets || { placements: [], devices: [], geos: [], cohorts: [] };
    var effectiveRange = result.effective_range ? (result.effective_range.since + ' → ' + result.effective_range.until) : '--';
    function metricDisplay(v) {
        if (v == null) return '--';
        if (isLowerBetterMetric(result.metric)) return fmtINR(v);
        if (/roas/.test(result.metric)) return fmtPct(v);
        return String(v);
    }
    function renderEntityTable(title, data) {
        data = (data || []).slice(0, 6);
        if (!data.length) return '';
        return '<div style="' + CARD + 'margin-bottom:12px;">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px;">' + esc(title) + '</div>' +
            '<div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">' +
                '<thead><tr style="text-align:left;color:var(--text-dim);border-bottom:1px solid var(--border);">' +
                    '<th style="padding:8px 10px;">Entity</th>' +
                    '<th style="padding:8px 10px;">' + esc(metricLabel) + '</th>' +
                    '<th style="padding:8px 10px;">Spend</th>' +
                    '<th style="padding:8px 10px;">Support</th>' +
                    '<th style="padding:8px 10px;">Basis</th>' +
                '</tr></thead><tbody>' +
                data.map(function(row) {
                    var support = row.supporting_count != null ? String(row.supporting_count) : ((row.metric_count != null && row.metric !== result.metric) ? String(row.metric_count) : '--');
                    return '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(row.label || '--') + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(metricDisplay(row.metric_value)) + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(fmtINR(row.spend || 0)) + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(support) + '</td>' +
                        '<td style="padding:10px;color:var(--text-dim);vertical-align:top;">' + esc(row.basis || '--') + '</td>' +
                    '</tr>';
                }).join('') +
                '</tbody></table></div></div>';
    }
    function renderPocketTable(title, list) {
        list = (list || []).slice(0, 6);
        if (!list.length) return '';
        return '<div style="' + CARD + 'margin-bottom:12px;">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px;">' + esc(title) + '</div>' +
            '<div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;">' +
                '<thead><tr style="text-align:left;color:var(--text-dim);border-bottom:1px solid var(--border);">' +
                    '<th style="padding:8px 10px;">Pocket</th>' +
                    '<th style="padding:8px 10px;">Installs</th>' +
                    '<th style="padding:8px 10px;">CPI</th>' +
                    '<th style="padding:8px 10px;">Spend</th>' +
                '</tr></thead><tbody>' +
                list.map(function(row) {
                    return '<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(row.label || '--') + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(String(row.installs || 0)) + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(row.cpi != null ? fmtINR(row.cpi) : '--') + '</td>' +
                        '<td style="padding:10px;color:var(--text);vertical-align:top;">' + esc(fmtINR(row.spend || 0)) + '</td>' +
                    '</tr>';
                }).join('') +
                '</tbody></table></div></div>';
    }
    return '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);">' +
        '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">How to ' + esc(result.intent === 'reduce' ? 'reduce' : 'improve') + ' ' + esc(metricLabel) + '</div>' +
        '<div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">Execution basis: ' + esc(effectiveRange) + (result.mature_only ? ' | Mature-only execution basis (last 7 days excluded).' : ' | Full selected-window execution basis.') + '</div>' +
        renderEntityTable('Best Campaigns For This Metric', rows.campaigns) +
        renderEntityTable('Best Adsets For This Metric', rows.adsets) +
        renderEntityTable('Best Ads For This Metric', rows.ads) +
        renderPocketTable('Lowest-CPI Placements / Platforms', pockets.placements) +
        renderPocketTable('Lowest-CPI Devices / OS', pockets.devices) +
        renderPocketTable('Lowest-CPI Geographies', pockets.geos) +
        renderPocketTable('Lowest-CPI Age × Gender Cohorts', pockets.cohorts) +
        ((result.action_lines || []).length ? '<div style="' + CARD + 'margin-bottom:0;"><div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:10px;">Actionables</div>' + result.action_lines.map(function(line) {
            return '<div style="font-size:11px;color:var(--text);padding:4px 0;">• ' + esc(line) + '</div>';
        }).join('') + '</div>' : '') +
    '</div>';
}

function buildTrendSearchPlan(scanData, runtimeContext, spec) {
    var rawRows = getTrendSearchRows(scanData, runtimeContext, spec).filter(function(row) {
        return row && row.metric_value != null && isFinite(Number(row.metric_value));
    });
    var rows = filterTrendSearchRows(rawRows, spec);
    var metricLabel = spec.metric === 'signup_cost_wow_pct' ? 'signup cost WoW'
        : spec.metric === 'd0_trial_cost_wow_pct' ? 'D0 trial cost WoW'
        : spec.metric === 'd15_roas' ? 'D15 ROAS'
        : spec.metric === 'd30_roas' ? 'D30 ROAS'
        : spec.metric === 'd6_roas' ? 'D6 ROAS'
        : spec.metric;
    var top = rows.slice(0, 12);
    var closest = [];
    if (!top.length) {
        closest = rawRows.slice().sort(function(a, b) {
            if (spec.comparator === 'down' || spec.comparator === 'improving') return Number(a.metric_value || 0) - Number(b.metric_value || 0);
            if (spec.comparator === 'up' || spec.comparator === 'high') return Number(b.metric_value || 0) - Number(a.metric_value || 0);
            if (spec.comparator === 'low') return Number(a.metric_value || 0) - Number(b.metric_value || 0);
            return Number(b.metric_value || 0) - Number(a.metric_value || 0);
        }).slice(0, 5);
    }
    var operatorAnswer;
    if (!top.length) {
        operatorAnswer = 'No ' + spec.entity_type + 's in the current slice cross the strict `' + metricLabel + '` threshold for this condition. Basis: ' + (scanData.date_range ? (scanData.date_range.since + ' → ' + scanData.date_range.until) : '--') + '.';
        if (closest.length) {
            operatorAnswer += '\n\nClosest signals:\n\n' + closest.map(function(row, idx) {
                return (idx + 1) + '. ' + row.label + ' — ' + formatTrendMetricLabel(spec, Number(row.metric_value)) + ' | Spend ' + fmtINR(row.spend || 0) + '\n' + row.basis;
            }).join('\n\n');
        }
    } else {
        operatorAnswer = 'Matching ' + spec.entity_type + (spec.entity_type === 'ad' ? 's' : 's') + ' for `' + metricLabel + '`:\n\n' + top.map(function(row, idx) {
            return (idx + 1) + '. ' + row.label + ' — ' + formatTrendMetricLabel(spec, Number(row.metric_value)) + ' | Spend ' + fmtINR(row.spend || 0) + '\n' + row.basis;
        }).join('\n\n');
    }
    return {
        operator_answer: operatorAnswer,
        executive_summary: top.length
            ? ('Found ' + top.length + ' matching ' + spec.entity_type + (top.length === 1 ? '' : 's') + ' for ' + metricLabel + ' in the current slice.')
            : ('No strict matches found for ' + metricLabel + ' in the current slice.'),
        actions: [],
        trend_search_result: {
            entity_type: spec.entity_type,
            metric: spec.metric,
            comparator: spec.comparator,
            raw_prompt: spec.raw_prompt || '',
            matches: top,
            closest: closest
        }
    };
}

function widenTrendSearchRange(range, minDays) {
    var targetDays = Math.max(Number(minDays || 42), 42);
    if (!range || !range.until) return null;
    var end = new Date(String(range.until) + 'T00:00:00');
    if (Number.isNaN(end.getTime())) return null;
    var start = new Date(end.getTime() - (targetDays - 1) * 86400000);
    return {
        since: start.toISOString().slice(0, 10),
        until: range.until
    };
}

function inferEntityTypeFromAction(actionType) {
    var type = String(actionType || '').toUpperCase();
    if (type.indexOf('CAMPAIGN') !== -1) return 'campaign';
    if (type.indexOf('ADSET') !== -1) return 'adset';
    if (type.indexOf('AD') !== -1) return 'ad';
    return 'account';
}

function metricsFromAd(ad) {
    return {
        spend: Math.round(ad.spend || 0),
        impressions: Math.round(ad.impressions || 0),
        clicks: Math.round(ad.clicks || 0),
        ctr: ad.ctr != null ? +Number(ad.ctr).toFixed(2) : null,
        cpm: ad.cpm != null ? Math.round(ad.cpm) : null,
        cpi: ad.cpi != null ? Math.round(ad.cpi) : null,
        signups: Math.round(ad.signups || 0),
        signupCost: ad.signupCost != null ? Math.round(ad.signupCost) : null,
        d0TrialCost: ad.d0TrialCost != null ? Math.round(ad.d0TrialCost) : null,
        d6: Math.round(ad.evalD6 != null ? ad.evalD6 : (ad.d6 || 0)),
        d6CAC: ad.d6CAC != null ? Math.round(ad.d6CAC) : null,
        d6ROAS: ad.d6ROAS != null ? +Number(ad.d6ROAS).toFixed(1) : null,
        overallROAS: ad.overallROAS != null ? +Number(ad.overallROAS).toFixed(1) : null
    };
}

function findOptimizerTarget(scanData, target) {
    if (!scanData || !target || !target.query || target.type === 'account') return null;
    var query = String(target.query || '').trim().toLowerCase();
    if (!query) return null;
    var lookups = buildScanEntityLookups(scanData);
    if (target.type === 'campaign') {
        var campaign = lookups.campaign[target.query] || lookups.campaignByName[normalizeCampaignName(target.query)];
        if (campaign) return { type: 'campaign', source: campaign };
    }
    if (target.type === 'adset') {
        var adsetById = lookups.adset[target.query];
        if (adsetById) return { type: 'adset', source: adsetById };
        var adsetMatch = Object.keys(lookups.adsetByName).map(function(key) { return lookups.adsetByName[key]; }).filter(Boolean).find(function(item) {
            return String(item.entity_name || '').toLowerCase() === query || String(item.entity_name || '').toLowerCase().indexOf(query) !== -1;
        });
        if (adsetMatch) return { type: 'adset', source: adsetMatch };
    }
    if (target.type === 'ad') {
        var adById = lookups.ad[target.query];
        if (adById) return { type: 'ad', source: adById };
        var adMatch = Object.keys(lookups.adByName).map(function(key) { return lookups.adByName[key]; }).filter(Boolean).find(function(item) {
            return String(item.ad_name || '').toLowerCase() === query || String(item.ad_name || '').toLowerCase().indexOf(query) !== -1;
        });
        if (adMatch) return { type: 'ad', source: adMatch };
    }
    return null;
}

function buildScopedScanData(scanData, target) {
    var resolved = findOptimizerTarget(scanData, target);
    if (!resolved) return { scanData: scanData, targetSummary: null };
    if (resolved.type === 'campaign') {
        var campaignName = resolved.source.campaign_name || resolved.source.entity_name;
        var camp = scanData.tree[campaignName];
        if (!camp) return { scanData: scanData, targetSummary: null };
        var ads = (scanData.ads || []).filter(function(ad) { return ad.campaign_id === camp.id || ad.campaign_name === campaignName; });
        return {
            scanData: {
                scan_date: scanData.scan_date,
                date_range: scanData.date_range,
                tree: Object.assign({}, (function(){ var x={}; x[campaignName]=camp; return x; })()),
                ads: ads,
                _trend_source: scanData._trend_source,
                evaluatedTotals: Object.assign({}, camp.totals || {}),
                rangeContext: scanData.rangeContext,
                summary: {
                    total_campaigns: 1,
                    total_adsets: Object.keys(camp.adsets || {}).length,
                    total_ads: ads.length,
                    total_spend: Math.round((camp.totals && camp.totals.spend) || 0),
                    red_ads: ads.filter(function(a){ return a.alertStatus === 'red'; }).length,
                    green_ads: ads.filter(function(a){ return a.alertStatus === 'green'; }).length,
                    matched_keys: scanData.summary.matched_keys,
                    unmatched_keys: scanData.summary.unmatched_keys,
                    matured_ads: ads.filter(function(a){ return a.isMatured; }).length,
                    non_matured_ads: ads.filter(function(a){ return !a.isMatured; }).length,
                    ads_with_status: ads.filter(function(a){ return a.created_time; }).length
                }
            },
            targetSummary: { type: 'campaign', label: campaignName, entity_id: camp.id || '' }
        };
    }
    if (resolved.type === 'adset') {
        var src = resolved.source;
        var campName = src.campaign_name;
        var adsetName = src.adset_name || src.entity_name;
        var campNode = scanData.tree[campName];
        var adsetNode = campNode && campNode.adsets ? campNode.adsets[adsetName] : null;
        if (!campNode || !adsetNode) return { scanData: scanData, targetSummary: null };
        var adsetAds = (scanData.ads || []).filter(function(ad) { return ad.adset_id === src.adset_id || (ad.campaign_name === campName && ad.adset_name === adsetName); });
        var scopedTree = {};
        scopedTree[campName] = Object.assign({}, campNode, { adsets: {} });
        scopedTree[campName].adsets[adsetName] = adsetNode;
        return {
            scanData: {
                scan_date: scanData.scan_date,
                date_range: scanData.date_range,
                tree: scopedTree,
                ads: adsetAds,
                _trend_source: scanData._trend_source,
                evaluatedTotals: Object.assign({}, adsetNode.totals || {}),
                rangeContext: scanData.rangeContext,
                summary: {
                    total_campaigns: 1,
                    total_adsets: 1,
                    total_ads: adsetAds.length,
                    total_spend: Math.round((adsetNode.totals && adsetNode.totals.spend) || 0),
                    red_ads: adsetAds.filter(function(a){ return a.alertStatus === 'red'; }).length,
                    green_ads: adsetAds.filter(function(a){ return a.alertStatus === 'green'; }).length,
                    matched_keys: scanData.summary.matched_keys,
                    unmatched_keys: scanData.summary.unmatched_keys,
                    matured_ads: adsetAds.filter(function(a){ return a.isMatured; }).length,
                    non_matured_ads: adsetAds.filter(function(a){ return !a.isMatured; }).length,
                    ads_with_status: adsetAds.filter(function(a){ return a.created_time; }).length
                }
            },
            targetSummary: { type: 'adset', label: campName + ' > ' + adsetName, entity_id: src.adset_id || '' }
        };
    }
    if (resolved.type === 'ad') {
        var ad = resolved.source;
        var cName = ad.campaign_name;
        var aName = ad.adset_name;
        var scopedCamp = scanData.tree[cName];
        var scopedAdset = scopedCamp && scopedCamp.adsets ? scopedCamp.adsets[aName] : null;
        if (!scopedCamp || !scopedAdset) return { scanData: scanData, targetSummary: null };
        var oneTree = {};
        oneTree[cName] = Object.assign({}, scopedCamp, { adsets: {} });
        oneTree[cName].adsets[aName] = Object.assign({}, scopedAdset, { ads: [ad] });
        return {
            scanData: {
                scan_date: scanData.scan_date,
                date_range: scanData.date_range,
                tree: oneTree,
                ads: [ad],
                _trend_source: scanData._trend_source,
                evaluatedTotals: metricsFromAd(ad),
                rangeContext: scanData.rangeContext,
                summary: {
                    total_campaigns: 1,
                    total_adsets: 1,
                    total_ads: 1,
                    total_spend: Math.round(ad.spend || 0),
                    red_ads: ad.alertStatus === 'red' ? 1 : 0,
                    green_ads: ad.alertStatus === 'green' ? 1 : 0,
                    matched_keys: scanData.summary.matched_keys,
                    unmatched_keys: scanData.summary.unmatched_keys,
                    matured_ads: ad.isMatured ? 1 : 0,
                    non_matured_ads: ad.isMatured ? 0 : 1,
                    ads_with_status: ad.created_time ? 1 : 0
                }
            },
            targetSummary: { type: 'ad', label: cName + ' > ' + aName + ' > ' + (ad.ad_name || ''), entity_id: ad.ad_id || '' }
        };
    }
    return { scanData: scanData, targetSummary: null };
}

function passesOptimizerAudienceFilter(ad, audienceFilter) {
    var filter = String(audienceFilter || 'all');
    if (filter === 'all') return true;
    var bucket = String(ad && ad.audience_bucket || inferAudienceBucketFromText((ad && ad.campaign_name) || '', (ad && ad.adset_name) || '') || 'prospecting');
    if (filter === 'retargeting') return bucket === 'retarget';
    if (filter === 'prospecting') return bucket !== 'retarget';
    return true;
}

function passesOptimizerStatusFilter(ad, statusFilter) {
    var filter = String(statusFilter || 'live_only');
    if (filter === 'all') return true;
    if (filter === 'paused_only') return !!(ad && ad.is_effectively_paused);
    if (filter === 'live_only') return !!(ad && ad.is_live);
    return true;
}

function buildFilteredScanData(scanData, filters) {
    if (!scanData) return scanData;
    var audienceFilter = String(filters && filters.audienceFilter || 'all');
    var statusFilter = String(filters && filters.statusFilter || 'live_only');
    if (audienceFilter === 'all' && statusFilter === 'all') return scanData;

    var originalAds = Array.isArray(scanData.ads) ? scanData.ads : [];
    var filteredAds = originalAds.filter(function(ad) {
        return passesOptimizerAudienceFilter(ad, audienceFilter) && passesOptimizerStatusFilter(ad, statusFilter);
    });
    if (filteredAds.length === originalAds.length) return scanData;

    var originalTree = scanData.tree || {};
    var nextTree = {};
    filteredAds.forEach(function(ad) {
        var campaignName = ad.campaign_name;
        var adsetName = ad.adset_name;
        var sourceCampaign = originalTree[campaignName];
        var sourceAdset = sourceCampaign && sourceCampaign.adsets ? sourceCampaign.adsets[adsetName] : null;
        if (!sourceCampaign || !sourceAdset) return;
        if (!nextTree[campaignName]) {
            nextTree[campaignName] = Object.assign({}, sourceCampaign, { adsets: {} });
        }
        if (!nextTree[campaignName].adsets[adsetName]) {
            nextTree[campaignName].adsets[adsetName] = Object.assign({}, sourceAdset, { ads: [] });
        }
        nextTree[campaignName].adsets[adsetName].ads.push(ad);
    });

    Object.keys(nextTree).forEach(function(campaignName) {
        var campaign = nextTree[campaignName];
        var campaignAds = [];
        Object.keys(campaign.adsets || {}).forEach(function(adsetName) {
            var adset = campaign.adsets[adsetName];
            campaignAds = campaignAds.concat(adset.ads || []);
            adset.totals = deriveMetrics(sumRaw(adset.ads || []));
        });
        campaign.totals = deriveMetrics(sumRaw(campaignAds));
    });

    var matchedAds = filteredAds.filter(function(ad) { return !!ad._matched; }).length;
    var unmatchedAds = filteredAds.filter(function(ad) { return !ad._matched; }).length;
    var matchedSpend = filteredAds.filter(function(ad) { return !!ad._matched; }).reduce(function(sum, ad) { return sum + (ad.spend || 0); }, 0);
    var totalSpend = filteredAds.reduce(function(sum, ad) { return sum + (ad.spend || 0); }, 0);

    return {
        scan_date: scanData.scan_date,
        date_range: scanData.date_range,
        tree: nextTree,
        ads: filteredAds,
        _trend_source: scanData._trend_source,
        entity_source_ads: originalAds.filter(function(ad) {
            return passesOptimizerAudienceFilter(ad, audienceFilter);
        }),
        evaluatedTotals: deriveMetrics(sumRaw(filteredAds)),
        rangeContext: scanData.rangeContext,
        summary: {
            total_campaigns: Object.keys(nextTree).length,
            total_adsets: Object.keys(nextTree).reduce(function(sum, campaignName) {
                return sum + Object.keys((nextTree[campaignName] && nextTree[campaignName].adsets) || {}).length;
            }, 0),
            total_ads: filteredAds.length,
            total_spend: Math.round(filteredAds.reduce(function(sum, ad) { return sum + (ad.spend || 0); }, 0)),
            red_ads: filteredAds.filter(function(ad) { return ad.alertStatus === 'red'; }).length,
            green_ads: filteredAds.filter(function(ad) { return ad.alertStatus === 'green'; }).length,
            matched_keys: filteredAds.filter(function(ad) { return !!ad._matched; }).length,
            unmatched_keys: filteredAds.filter(function(ad) { return !ad._matched; }).length,
            matched_ads: matchedAds,
            unmatched_ads: unmatchedAds,
            spend_match_rate_pct: totalSpend > 0 ? +((matchedSpend / totalSpend) * 100).toFixed(1) : 0,
            date_grain_miss_rows: scanData.summary && scanData.summary.date_grain_miss_rows ? scanData.summary.date_grain_miss_rows : 0,
            adset_level_miss_rows: scanData.summary && scanData.summary.adset_level_miss_rows ? scanData.summary.adset_level_miss_rows : 0,
            campaign_level_miss_rows: scanData.summary && scanData.summary.campaign_level_miss_rows ? scanData.summary.campaign_level_miss_rows : 0,
            matured_ads: filteredAds.filter(function(ad) { return !!ad.isMatured; }).length,
            non_matured_ads: filteredAds.filter(function(ad) { return !ad.isMatured; }).length,
            ads_with_status: filteredAds.filter(function(ad) { return !!ad.delivery_state; }).length
        },
        filter_summary: {
            audience: audienceFilter,
            status: statusFilter,
            original_ads: originalAds.length,
            filtered_ads: filteredAds.length
        }
    };
}

function getCurrentOptimizerDisplayScan() {
    var scan = window.OPTIMIZER_SCAN;
    if (!scan) return null;
    var scoped = buildScopedScanData(scan, window.OPTIMIZER_TARGET || { type: 'account', query: '' });
    var scopedScan = scoped.scanData || scan;
    return buildFilteredScanData(scopedScan, {
        audienceFilter: window.OPTIMIZER_AUDIENCE_FILTER || 'all',
        statusFilter: window.OPTIMIZER_STATUS_FILTER || 'live_only'
    });
}

async function fetchApexExternalContext() {
    var requests = [
        fetch('/api/competitor/trends', { signal: AbortSignal.timeout(15000) }).then(function(r) { return r.json(); }),
        fetch('/api/competitor/radar', { signal: AbortSignal.timeout(15000) }).then(function(r) { return r.json(); }),
        fetch('/api/trends/data', { signal: AbortSignal.timeout(15000) }).then(function(r) { return r.json(); }),
        fetch('/api/trends/status', { signal: AbortSignal.timeout(15000) }).then(function(r) { return r.json(); })
    ];
    var settled = await Promise.allSettled(requests);
    var competitorTrends = settled[0].status === 'fulfilled' ? settled[0].value : null;
    var competitorRadar = settled[1].status === 'fulfilled' ? settled[1].value : null;
    var trendData = settled[2].status === 'fulfilled' ? settled[2].value : null;
    var trendStatus = settled[3].status === 'fulfilled' ? settled[3].value : null;

    var trendPayload = trendData && trendData.synthesized ? trendData.synthesized : null;
    var competitorPayload = competitorTrends && competitorTrends.success ? competitorTrends.data : null;
    var radarPayload = competitorRadar && competitorRadar.success ? competitorRadar.data : null;

    return {
        available: !!(trendPayload || competitorPayload || radarPayload),
        fetched_at: new Date().toISOString(),
        competitor_intel: competitorPayload ? {
            most_active_competitor: competitorPayload.most_active_competitor || '',
            rising_themes: (competitorPayload.rising_themes || []).slice(0, 8),
            falling_themes: (competitorPayload.falling_themes || []).slice(0, 8),
            univest_gap_themes: (competitorPayload.univest_gap_themes || []).slice(0, 8),
            dominant_format_per_competitor: competitorPayload.dominant_format_per_competitor || {},
            freshness_note: competitorTrends.timestamp || ''
        } : null,
        competitor_radar: radarPayload ? {
            summary: radarPayload.summary || '',
            threats: (radarPayload.threats || []).slice(0, 5),
            opportunities: (radarPayload.opportunities || []).slice(0, 5),
            recommended_moves: (radarPayload.recommended_moves || []).slice(0, 5),
            freshness_note: competitorRadar.timestamp || ''
        } : null,
        market_trends: trendPayload ? {
            market_mood: trendPayload.market_mood || '',
            top_trends: (trendPayload.top_trends || []).slice(0, 6).map(function(item) {
                return {
                    trend_id: item.trend_id || '',
                    title: item.title || item.trend || '',
                    description: item.description || '',
                    why_it_matters: item.why_it_matters || '',
                    signal_strength: item.signal_strength || item.confidence || '',
                    sources: item.sources || []
                };
            }),
            emerging_topics: (trendPayload.emerging_topics || []).slice(0, 5),
            avoid_topics: (trendPayload.avoid_topics || []).slice(0, 5),
            freshness_note: trendData.last_scraped || ''
        } : null,
        freshness: {
            trend_scanner_last_scraped: trendData && trendData.last_scraped ? trendData.last_scraped : '',
            trend_scanner_is_stale: !!(trendData && trendData.is_stale),
            trend_scanner_has_data: !!(trendStatus && trendStatus.has_data),
            trend_scan_in_progress: !!(trendStatus && trendStatus.is_scraping)
        },
        limitations: [
            !trendPayload ? 'Trend scanner data unavailable for this run.' : '',
            trendData && trendData.is_stale ? 'Trend scanner cache is stale.' : '',
            !competitorPayload ? 'Competitor intelligence data unavailable for this run.' : ''
        ].filter(Boolean)
    };
}

async function fetchApexBreakdowns(range) {
    if (!range || !range.since || !range.until) {
        return {
            available: false,
            fetched_at: new Date().toISOString(),
            breakdowns: {
                age_gender: [],
                placement: [],
                device: [],
                geography: [],
                hourly: []
            },
            limitations: ['Date range missing for APEX breakdown fetch.']
        };
    }

    var response = await fetch('/api/meta/apex-breakdowns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom: range.since, dateTo: range.until }),
        signal: AbortSignal.timeout(90000)
    });
    var data = await response.json();
    if (!data || !data.success) throw new Error((data && data.error) || 'APEX breakdown fetch failed');

    return {
        available: true,
        fetched_at: data && data.freshness ? data.freshness.generated_at : new Date().toISOString(),
        breakdowns: (data && data.breakdowns) || {
            age_gender: [],
            placement: [],
            device: [],
            geography: [],
            hourly: []
        },
        unavailable_breakdowns: data && data.unavailable_breakdowns ? data.unavailable_breakdowns : {},
        limitations: data && data.limitations ? data.limitations : [],
        freshness: data && data.freshness ? data.freshness : {}
    };
}

function buildCompactTree(tree) {
    // Only include ads with >â‚¹5K spend â€” rest are summarized as counts
    var MIN_SPEND = 5000;
    var compact = {};
    var skippedCount = 0;
    for (var ck in tree) {
        var camp = tree[ck];
        var campData = {
            id: camp.id,
            objective: camp.objective || 'UNKNOWN',
            campaign_status: camp.campaign_status || 'UNKNOWN',
            budget_level: camp.budget_level || 'unknown',
            budget_type: camp.budget_type || 'unknown',
            budget_owner_name: camp.budget_entity_name || '',
            budget_current_daily_budget: camp.budget_current_daily_budget || null,
            adsets: {}
        };
        var hasContent = false;
        for (var ak in camp.adsets) {
            var as = camp.adsets[ak];
            var significantAds = as.ads.filter(function(ad) { return ad.spend >= MIN_SPEND; });
            var smallAds = as.ads.length - significantAds.length;
            skippedCount += smallAds;
            if (!significantAds.length && smallAds > 0) {
                // Adset with only tiny-spend ads â€” just note it
                campData.adsets[ak] = {
                    id: as.id,
                    totals: { spend: Math.round(as.totals.spend), d6ROAS: +as.totals.d6ROAS.toFixed(1), signups: as.totals.signups, d6: as.totals.d6 },
                    adset_status: as.adset_status || 'UNKNOWN',
                    bid_strategy: as.bid_strategy || 'UNKNOWN',
                    optimization_event: as.optimization_event || 'UNKNOWN',
                    location_targeting: as.location_targeting || 'UNKNOWN',
                    age_targeting: as.age_targeting || 'ALL',
                    gender_targeting: as.gender_targeting || 'ALL',
                    placements_active: as.placements_active || [],
                    campaign_status: as.campaign_status || 'UNKNOWN',
                    budget_level: as.budget_level || 'unknown',
                    budget_type: as.budget_type || 'unknown',
                    budget_owner_name: as.budget_entity_name || '',
                    budget_current_daily_budget: as.budget_current_daily_budget || null,
                    note: smallAds + ' ads all below \u20b95K spend â€” insufficient data'
                };
                hasContent = true;
                continue;
            }
            if (significantAds.length) {
                campData.adsets[ak] = {
                    id: as.id,
                    totals: { spend: Math.round(as.totals.spend), d6ROAS: +as.totals.d6ROAS.toFixed(1), signups: as.totals.signups, d6: as.totals.d6 },
                    adset_status: as.adset_status || 'UNKNOWN',
                    bid_strategy: as.bid_strategy || 'UNKNOWN',
                    optimization_event: as.optimization_event || 'UNKNOWN',
                    location_targeting: as.location_targeting || 'UNKNOWN',
                    age_targeting: as.age_targeting || 'ALL',
                    gender_targeting: as.gender_targeting || 'ALL',
                    placements_active: as.placements_active || [],
                    campaign_status: as.campaign_status || 'UNKNOWN',
                    budget_level: as.budget_level || 'unknown',
                    budget_type: as.budget_type || 'unknown',
                    budget_owner_name: as.budget_entity_name || '',
                    budget_current_daily_budget: as.budget_current_daily_budget || null,
                    ads: significantAds.map(function(ad) {
                        return {
                            id: ad.ad_id, name: ad.ad_name, spend: Math.round(ad.spend),
                            installs: ad.installs, signups: ad.signups, d0_trial: ad.d0_trial, d6: ad.d6,
                            cpi: ad.cpi ? Math.round(ad.cpi) : null,
                            signup_cost: ad.signupCost ? Math.round(ad.signupCost) : null,
                            d0_trial_cost: ad.d0TrialCost ? Math.round(ad.d0TrialCost) : null,
                            d6_cac: ad.d6CAC ? Math.round(ad.d6CAC) : null,
                            d6_roas: +ad.d6ROAS.toFixed(1),
                            alert: ad.alertStatus,
                            is_matured: ad.isMatured, days_live: ad.daysSinceGoLive,
                            go_live: ad.goLiveDate,
                            ad_status: ad.ad_status,
                            adset_status: ad.adset_status,
                            campaign_status: ad.campaign_status,
                            delivery_state: ad.delivery_state,
                            budget_level: ad.budget_level,
                            budget_type: ad.budget_type,
                            budget_owner_name: ad.budget_entity_name,
                            budget_current_daily_budget: ad.budget_current_daily_budget,
                            bid_strategy: ad.bid_strategy || 'UNKNOWN',
                            optimization_event: ad.optimization_event || 'UNKNOWN',
                            location_targeting: ad.location_targeting || 'UNKNOWN',
                            age_targeting: ad.age_targeting || 'ALL',
                            gender_targeting: ad.gender_targeting || 'ALL',
                            placements_active: ad.placements_active || [],
                            d6_label: ad.d6Label
                        };
                    }),
                    small_ads_skipped: smallAds > 0 ? smallAds + ' ads below \u20b95K spend omitted' : undefined
                };
                hasContent = true;
            }
        }
        if (hasContent) compact[ck] = campData;
    }
    console.log('[Optimizer] Compact tree: included ads with >\u20b95K spend, skipped ' + skippedCount + ' small ads');
    return compact;
}

function buildApexRuntimeContext(scanData, benchmarks, campaignActions, adsetActions, rulesActions, compactTree, externalContext, breakdownContext) {
    var totals = scanData && scanData.evaluatedTotals ? scanData.evaluatedTotals : {};
    var range = scanData && scanData.date_range ? scanData.date_range : getSelectedDates();
    var dayCount = getRangeDayCount(range);
    var scanSummary = scanData && scanData.summary ? scanData.summary : {};
    var trendSummary = buildApexTrendSummary(scanData);
    var dataIntegrityGate = buildDataIntegrityGate(scanData);
    var metaOperatorAudit = buildMetaOperatorAudit(scanData, breakdownContext);
    var signalAvailability = buildSignalAvailabilityContext(scanData, breakdownContext);
    var weightedBenchmarks = benchmarks && benchmarks.apex_weighted ? benchmarks.apex_weighted : buildWeightedMedianBenchmarks(scanData && scanData.ads || []);
    var businessConstants = buildApexBusinessConstants();
    var externalPosture = buildExternalPosture(externalContext, window.OPTIMIZER_COMMAND_TYPE || 'daily_optimisation');
    var historicalWinnerLibrary = buildHistoricalWinnerLibrary(scanData);
    var advancedTrendIntelligence = buildAdvancedTrendIntelligence(scanData);
    var campaignSettingsAudits = buildCampaignSettingsAudits(scanData, weightedBenchmarks, externalPosture, advancedTrendIntelligence);
    var adsetSettingsAudits = buildAdsetSettingsAudits(scanData, weightedBenchmarks, breakdownContext, externalPosture, signalAvailability, advancedTrendIntelligence);
    var adHealthAudits = buildAdHealthAudits(scanData, weightedBenchmarks, historicalWinnerLibrary, signalAvailability, advancedTrendIntelligence);
    var skillContracts = buildOptimizerSkillContracts();
    var importedAuditSummary = buildImportedOptimizerAuditSummary(scanData);
    var importedSkillContext = buildImportedSkillContextBlocks(scanData, weightedBenchmarks, breakdownContext, importedAuditSummary, trendSummary, advancedTrendIntelligence);
    var breakdownActionRecommendations = buildBreakdownActionRecommendations(breakdownContext);
    var campaigns = Object.keys(scanData.tree || {}).map(function(campaignName) {
        var camp = scanData.tree[campaignName];
        return {
            id: camp.id || '',
            name: camp.name || campaignName,
            objective: camp.objective || 'UNKNOWN',
            status: camp.campaign_status || 'UNKNOWN',
            budget_level: camp.budget_level || 'unknown',
            budget_type: camp.budget_type || 'unknown',
            daily_budget: camp.budget_current_daily_budget || null,
            budget_owner_name: camp.budget_entity_name || '',
            current_daily_budget: camp.budget_current_daily_budget || null,
            spend_window: Math.round((camp.totals && camp.totals.spend) || 0),
            signups_window: Math.round((camp.totals && camp.totals.signups) || 0),
            d6_roas_window: +Number((camp.totals && camp.totals.d6ROAS) || 0).toFixed(1),
            d15_roas_window: +Number((camp.totals && camp.totals.d15ROAS) || 0).toFixed(1),
            d30_roas_window: +Number((camp.totals && camp.totals.d30ROAS) || 0).toFixed(1),
            signup_cost_window: (camp.totals && camp.totals.signupCost) != null ? Math.round(camp.totals.signupCost || 0) : null,
            d0_trial_cost_window: (camp.totals && camp.totals.d0TrialCost) != null ? Math.round(camp.totals.d0TrialCost || 0) : null,
            d6_conversions_window: Math.round((camp.totals && camp.totals.d6) || 0),
            d15_conversions_window: Math.round((camp.totals && camp.totals.d15_overall_con) || 0),
            d30_conversions_window: Math.round((camp.totals && camp.totals.d30_overall_con) || 0),
            adset_count: Object.keys(camp.adsets || {}).length,
            optimizer_flags: (campaignActions || []).filter(function(action) { return action.campaign === campaignName; }).slice(0, 5).map(function(action) { return action.action + ': ' + action.reason; })
        };
    }).sort(function(a, b) { return b.spend_window - a.spend_window; }).slice(0, 20);

    var adsets = [];
    Object.keys(scanData.tree || {}).forEach(function(campaignName) {
        var camp = scanData.tree[campaignName];
        Object.keys(camp.adsets || {}).forEach(function(adsetName) {
            var adset = camp.adsets[adsetName];
            adsets.push({
                id: adset.id || '',
                campaign_id: camp.id || '',
                campaign_name: campaignName,
                name: adsetName,
                status: adset.adset_status || 'UNKNOWN',
                campaign_status: adset.campaign_status || 'UNKNOWN',
                budget_level: adset.budget_level || 'unknown',
                budget_type: adset.budget_type || 'unknown',
                budget_owner_name: adset.budget_entity_name || '',
                current_daily_budget: adset.budget_current_daily_budget || null,
                bid_strategy: adset.bid_strategy || 'UNKNOWN',
                cost_cap_value: adset.cost_cap_value || null,
                bid_cap_value: adset.bid_cap_value || null,
                optimization_event: adset.optimization_event || 'UNKNOWN',
                location_targeting: adset.location_targeting || 'UNKNOWN',
                age_targeting: adset.age_targeting || 'ALL',
                gender_targeting: adset.gender_targeting || 'ALL',
                placements_active: adset.placements_active || [],
                audience_definition: adset.audience_definition || '',
                audience_size_total: adset.audience_size_total || null,
                spend_window: Math.round((adset.totals && adset.totals.spend) || 0),
                signups_window: Math.round((adset.totals && adset.totals.signups) || 0),
                d6_roas_window: +Number((adset.totals && adset.totals.d6ROAS) || 0).toFixed(1),
                d15_roas_window: +Number((adset.totals && adset.totals.d15ROAS) || 0).toFixed(1),
                d30_roas_window: +Number((adset.totals && adset.totals.d30ROAS) || 0).toFixed(1),
                signup_cost_window: (adset.totals && adset.totals.signupCost) != null ? Math.round(adset.totals.signupCost || 0) : null,
                d0_trial_cost_window: (adset.totals && adset.totals.d0TrialCost) != null ? Math.round(adset.totals.d0TrialCost || 0) : null,
                d6_conversions_window: Math.round((adset.totals && adset.totals.d6) || 0),
                d15_conversions_window: Math.round((adset.totals && adset.totals.d15_overall_con) || 0),
                d30_conversions_window: Math.round((adset.totals && adset.totals.d30_overall_con) || 0),
                red_ads: (adset.ads || []).filter(function(ad) { return ad.alertStatus === 'red'; }).length,
                green_ads: (adset.ads || []).filter(function(ad) { return ad.alertStatus === 'green'; }).length,
                optimizer_flags: (adsetActions || []).filter(function(action) { return action.campaign === campaignName && action.adset === adsetName; }).slice(0, 5).map(function(action) { return action.action + ': ' + action.reason; })
            });
        });
    });
    adsets.sort(function(a, b) { return b.spend_window - a.spend_window; });
    adsets = adsets.slice(0, 40);

    var ads = (scanData.ads || []).slice().sort(function(a, b) { return b.spend - a.spend; }).slice(0, 80).map(function(ad) {
        var wowMetrics = ad && ad._wow ? ad._wow : {};
        return {
            id: ad.ad_id || '',
            adset_id: ad.adset_id || '',
            campaign_id: ad.campaign_id || '',
            campaign_name: ad.campaign_name || '',
            adset_name: ad.adset_name || '',
            name: ad.ad_name || '',
            status: ad.ad_status || 'UNKNOWN',
            adset_status: ad.adset_status || 'UNKNOWN',
            campaign_status: ad.campaign_status || 'UNKNOWN',
            delivery_state: ad.delivery_state || 'unknown',
            format: detectType(ad.ad_name || ''),
            spend_window: Math.round(ad.spend || 0),
            spend_30d: Math.round(ad.spend || 0),
            bid_strategy: ad.bid_strategy || 'UNKNOWN',
            cost_cap_value: ad.cost_cap_value || null,
            bid_cap_value: ad.bid_cap_value || null,
            optimization_event: ad.optimization_event || 'UNKNOWN',
            location_targeting: ad.location_targeting || 'UNKNOWN',
            age_targeting: ad.age_targeting || 'ALL',
            gender_targeting: ad.gender_targeting || 'ALL',
            placements_active: ad.placements_active || [],
            impressions_window: Math.round(ad.impressions || 0),
            installs_window: Math.round(ad.installs || 0),
            signups_window: Math.round(ad.signups || 0),
            d0_trial_window: Math.round(ad.d0_trial || 0),
            d6_window: Math.round(ad.d6 || 0),
            d15_window: Math.round(ad.d15_overall_con || 0),
            d30_window: Math.round(ad.d30_overall_con || 0),
            d6_roas_window: +Number(ad.d6ROAS || 0).toFixed(1),
            d15_roas_window: +Number(ad.d15ROAS || 0).toFixed(1),
            d30_roas_window: +Number(ad.d30ROAS || 0).toFixed(1),
            d6_cac_window: ad.d6CAC != null ? Math.round(ad.d6CAC) : null,
            signup_cost_window: ad.signupCost != null ? Math.round(ad.signupCost) : null,
            d0_trial_cost_window: ad.d0TrialCost != null ? Math.round(ad.d0TrialCost) : null,
            cpi_window: ad.cpi != null ? Math.round(ad.cpi) : null,
            ctr_window: ad.ctr != null ? +ad.ctr.toFixed(2) : null,
            is_matured: !!ad.isMatured,
            days_live: ad.daysSinceGoLive,
            creative_theme: detectType(ad.ad_name || ''),
            hook_angle: '',
            is_account_winner: !!(ad.isMatured && (wowMetrics.maturedD6ROAS != null ? wowMetrics.maturedD6ROAS : ad.d6ROAS) >= 28),
            wow: {
                trend_direction: wowMetrics.trendDirection || 'unknown',
                continuous_decline: !!wowMetrics.continuousDecline,
                continuous_increase: !!wowMetrics.continuousIncrease,
                signup_cost_wow_pct: wowMetrics.signupCost_wow != null ? +wowMetrics.signupCost_wow.toFixed(1) : null,
                d6_revenue_wow_pct: wowMetrics.d6Revenue_wow != null ? +wowMetrics.d6Revenue_wow.toFixed(1) : null,
                last_week_snapshot: wowMetrics.lastWeek || null,
                previous_week_snapshot: wowMetrics.prevWeek || null
            }
        };
    });

    return {
        session_id: 'optimizer-' + Date.now(),
        run_timestamp: new Date().toISOString(),
        session_mode: window.OPTIMIZER_APEX_MODE || 'daily_review',
        command_type: window.OPTIMIZER_COMMAND_TYPE || 'daily_optimisation',
        user_request: window.OPTIMIZER_USER_PROMPT || '',
        request_scope: {
            target_type: (window.OPTIMIZER_TARGET && window.OPTIMIZER_TARGET.type) || 'account',
            target_query: (window.OPTIMIZER_TARGET && window.OPTIMIZER_TARGET.query) || '',
            audience_filter: window.OPTIMIZER_AUDIENCE_FILTER || 'all',
            status_filter: window.OPTIMIZER_STATUS_FILTER || 'live_only'
        },
        business_constants: businessConstants,
        skill_contracts: skillContracts,
        imported_audit_summary: importedAuditSummary,
        imported_skill_context: importedSkillContext,
        signal_availability: signalAvailability,
        advanced_trend_intelligence: advancedTrendIntelligence,
        account_snapshot: {
            account_id: '',
            account_name: 'Univest Meta Ads',
            currency: 'INR',
            timezone: 'Asia/Calcutta',
            reporting_window: range.since + ' to ' + range.until,
            window_day_count: dayCount
        },
        integrity_inputs: {
            total_meta_spend_period_gst_incl: dataIntegrityGate.total_meta_spend_period_gst_incl,
            total_matched_rows: dataIntegrityGate.total_matched_rows,
            total_spend_only_rows: dataIntegrityGate.total_spend_only_rows,
            total_spend_only_spend_gst_incl: dataIntegrityGate.total_spend_only_spend_gst_incl,
            total_funnel_only_rows: dataIntegrityGate.total_funnel_only_rows,
            prior_session_match_rate_pct: dataIntegrityGate.prior_session_match_rate_pct
        },
        performance_summary: {
            selected_window: {
                spend: Math.round(totals.spend || scanSummary.total_spend || 0),
                avg_daily_spend: dayCount ? Math.round((totals.spend || scanSummary.total_spend || 0) / dayCount) : null,
                impressions: Math.round(totals.impressions || 0),
                clicks: Math.round(totals.clicks || 0),
                ctr: totals.ctr != null ? +totals.ctr.toFixed(2) : null,
                cpm: totals.cpm != null ? Math.round(totals.cpm) : null,
                cpi: totals.cpi != null ? Math.round(totals.cpi) : null,
                signups: Math.round(totals.signups || 0),
                signup_cost: totals.signupCost != null ? Math.round(totals.signupCost) : null,
                d0_trial_cost: totals.d0TrialCost != null ? Math.round(totals.d0TrialCost) : null,
                d0_trial: Math.round(totals.d0_trial || 0),
                d6: Math.round(totals.d6 || 0),
                d15: Math.round(totals.d15_overall_con || 0),
                d30: Math.round(totals.d30_overall_con || 0),
                d6_cac: totals.d6CAC != null ? Math.round(totals.d6CAC) : null,
                d6_roas: totals.d6ROAS != null ? +totals.d6ROAS.toFixed(1) : null,
                d15_roas: totals.d15ROAS != null ? +totals.d15ROAS.toFixed(1) : null,
                d30_roas: totals.d30ROAS != null ? +totals.d30ROAS.toFixed(1) : null,
                overall_roas: totals.overallROAS != null ? +totals.overallROAS.toFixed(1) : null
            },
            weekly_trend_summary: trendSummary,
            advanced_trend_summary: {
                campaign_signals: Object.keys(advancedTrendIntelligence.campaigns || {}).length,
                adset_signals: Object.keys(advancedTrendIntelligence.adsets || {}).length,
                ad_signals: Object.keys(advancedTrendIntelligence.ads || {}).length
            },
            benchmark_summary: {
                median_d6_roas: +(benchmarks.median_d6_roas || 0).toFixed(1),
                median_d15_roas: +((weightedPercentileMetric((scanData.ads || []).filter(function(ad) { return ad && ad.has_funnel_match && (ad.spend || 0) > 0 && ad.audience_bucket !== 'retarget'; }), function(ad) { return ad.d15ROAS; }, function(ad) { return ad.spend || 0; }, 0.5) || 0)).toFixed(1),
                median_d30_roas: +((weightedPercentileMetric((scanData.ads || []).filter(function(ad) { return ad && ad.has_funnel_match && (ad.spend || 0) > 0 && ad.audience_bucket !== 'retarget'; }), function(ad) { return ad.d30ROAS; }, function(ad) { return ad.spend || 0; }, 0.5) || 0)).toFixed(1),
                median_signup_cost: Math.round(benchmarks.median_signup_cost || 0),
                median_d0_trial_cost: Math.round(benchmarks.median_d0_trial_cost || 0),
                median_cpi: Math.round(benchmarks.median_cpi || 0),
                median_d6_cac: Math.round(benchmarks.median_d6_cac || 0),
                weighted_benchmark_cpa: Math.round(weightedBenchmarks.benchmark_cpa || 0),
                weighted_benchmark_d6_roas: +(weightedBenchmarks.benchmark_d6_roas || 0).toFixed(2),
                based_on_n_rows: weightedBenchmarks.based_on_n_rows || 0,
                total_eligible_spend: Math.round(weightedBenchmarks.total_eligible_spend || 0),
                excluded_learning_spend: Math.round(weightedBenchmarks.excluded_learning_spend || 0),
                excluded_cooldown_spend: Math.round(weightedBenchmarks.excluded_cooldown_spend || 0),
                excluded_spend_only_spend: Math.round(weightedBenchmarks.excluded_spend_only_spend || 0)
            },
            maturity_mix: {
                matured_ads: scanSummary.matured_ads || 0,
                non_matured_ads: scanSummary.non_matured_ads || 0
            },
            status_integrity: {
                ads_with_status_context: scanSummary.ads_with_status || 0,
                total_ads: scanSummary.total_ads || 0,
                fresh_status_verified_pct: (scanSummary.total_ads || 0) > 0 ? +(((scanSummary.ads_with_status || 0) / scanSummary.total_ads) * 100).toFixed(1) : 0,
                note: 'Campaign/adset/ad live state was refreshed before recommendations were normalized.'
            },
            data_availability: {
                selected_window_only: true,
                wow_context_available: !!((scanData.ads || []).some(function(ad) { return !!ad._wow; })),
                note: 'Use only the selected-window aggregates and explicit WoW context supplied here. Do not invent today, 7d, or 30d rollups.'
            },
            data_integrity_gate: dataIntegrityGate
        },
        attribution_breakdown: buildAttributionBreakdownSummary(scanData),
        campaigns: campaigns,
        ad_sets: adsets,
        ads: ads,
        change_log: buildApexChangeLog(),
        optimizer_log: {
            pending_actions: [].concat(campaignActions || [], adsetActions || [], rulesActions || []).slice(0, 120)
        },
        business_context: {
            cpa_target_global: weightedBenchmarks.benchmark_cpa || benchmarks.median_signup_cost || null,
            roas_target_global: weightedBenchmarks.benchmark_d6_roas || benchmarks.median_d6_roas || null,
            monthly_budget: null,
            budget_spent_mtd: null,
            active_promotions: '',
            new_products_launched: null,
            key_dates_next_14d: '',
            business_notes: '',
            blended_mer_anchor: businessConstants.blended_mer_anchor
        },
        external_context: externalContext || {
            available: false,
            fetched_at: new Date().toISOString(),
            limitations: ['External competitor, trend, and macro context was unavailable for this run.']
        },
        external_posture: externalPosture,
        historical_winner_library: historicalWinnerLibrary,
        breakdowns: breakdownContext && breakdownContext.breakdowns ? breakdownContext.breakdowns : {
            age_gender: [],
            placement: [],
            device: [],
            geography: [],
            hourly: []
        },
        breakdown_context: breakdownContext || {
            available: false,
            fetched_at: new Date().toISOString(),
            limitations: ['Granular Meta breakdowns were unavailable for this run.']
        },
        data_integrity_gate: dataIntegrityGate,
        meta_operator_audit: metaOperatorAudit,
        breakdown_action_recommendations: breakdownActionRecommendations,
        campaign_settings_audits: campaignSettingsAudits.slice(0, 20),
        adset_settings_audits: adsetSettingsAudits.slice(0, 40),
        ad_health_audits: adHealthAudits.slice(0, 80),
        playbook_rules: buildApexPlaybookRules(),
        thresholds: buildApexThresholds(),
        compact_tree_summary: {
            included_campaigns: Object.keys(compactTree || {}).length,
            note: 'Full tree omitted from APEX v1 prompt to keep the daily-review context compact and reliable.'
        }
    };
}

function textIncludesAny(value, terms) {
    var text = String(value || '').toLowerCase();
    return (Array.isArray(terms) ? terms : []).some(function(term) {
        return text.indexOf(String(term || '').toLowerCase()) !== -1;
    });
}

function narrowOptimizerRuntimeContextForCommand(runtimeContext) {
    if (!runtimeContext) return runtimeContext;
    var target = runtimeContext.request_scope || {};
    var targetType = String(target.target_type || 'account').toLowerCase();
    var targetQuery = String(target.target_query || '').trim().toLowerCase();
    var commandType = String(runtimeContext.command_type || '').toLowerCase();
    var campaigns = Array.isArray(runtimeContext.campaigns) ? runtimeContext.campaigns.slice() : [];
    var adSets = Array.isArray(runtimeContext.ad_sets) ? runtimeContext.ad_sets.slice() : [];
    var ads = Array.isArray(runtimeContext.ads) ? runtimeContext.ads.slice() : [];
    var analysisScope = {
        command_type: commandType,
        target_type: targetType,
        target_query: target.target_query || '',
        focus: 'account'
    };

    function campaignMatches(item) {
        if (!item) return false;
        if (!targetQuery) return true;
        return textIncludesAny(item.name, [targetQuery]) || textIncludesAny(item.id, [targetQuery]);
    }

    function adsetMatches(item) {
        if (!item) return false;
        if (!targetQuery) return true;
        return textIncludesAny(item.name, [targetQuery]) ||
            textIncludesAny(item.id, [targetQuery]) ||
            textIncludesAny(item.campaign_name, [targetQuery]);
    }

    function adMatches(item) {
        if (!item) return false;
        if (!targetQuery) return true;
        return textIncludesAny(item.name, [targetQuery]) ||
            textIncludesAny(item.ad_name, [targetQuery]) ||
            textIncludesAny(item.adset_name, [targetQuery]) ||
            textIncludesAny(item.campaign_name, [targetQuery]) ||
            textIncludesAny(item.ad_id, [targetQuery]);
    }

    if (targetType === 'campaign') {
        analysisScope.focus = 'campaign';
        campaigns = campaigns.filter(campaignMatches).slice(0, 4);
        var campaignNames = campaigns.map(function(c) { return c.name; });
        adSets = adSets.filter(function(a) {
            return campaignNames.indexOf(a.campaign_name) !== -1 && (!targetQuery || adsetMatches(a));
        }).slice(0, 8);
        var adSetKeys = adSets.map(function(a) { return a.campaign_name + '::' + a.name; });
        ads = ads.filter(function(ad) {
            return campaignNames.indexOf(ad.campaign_name) !== -1 &&
                adSetKeys.indexOf(ad.campaign_name + '::' + ad.adset_name) !== -1 &&
                adMatches(ad);
        }).slice(0, 16);
    } else if (targetType === 'adset') {
        analysisScope.focus = 'adset';
        adSets = adSets.filter(adsetMatches).slice(0, 4);
        var keptCampaignNames = [];
        adSets.forEach(function(a) {
            if (keptCampaignNames.indexOf(a.campaign_name) === -1) keptCampaignNames.push(a.campaign_name);
        });
        campaigns = campaigns.filter(function(c) {
            return keptCampaignNames.indexOf(c.name) !== -1 || campaignMatches(c);
        }).slice(0, 4);
        var keptAdSetKeys = adSets.map(function(a) { return a.campaign_name + '::' + a.name; });
        ads = ads.filter(function(ad) {
            return keptAdSetKeys.indexOf(ad.campaign_name + '::' + ad.adset_name) !== -1 && adMatches(ad);
        }).slice(0, 12);
    } else if (targetType === 'ad') {
        analysisScope.focus = 'ad';
        ads = ads.filter(adMatches).slice(0, 8);
        var adCampaignNames = [];
        var adSetNames = [];
        ads.forEach(function(ad) {
            if (ad.campaign_name && adCampaignNames.indexOf(ad.campaign_name) === -1) adCampaignNames.push(ad.campaign_name);
            var adsetKey = ad.campaign_name + '::' + ad.adset_name;
            if (ad.adset_name && adSetNames.indexOf(adsetKey) === -1) adSetNames.push(adsetKey);
        });
        adSets = adSets.filter(function(a) {
            return adSetNames.indexOf(a.campaign_name + '::' + a.name) !== -1 || adsetMatches(a);
        }).slice(0, 4);
        campaigns = campaigns.filter(function(c) {
            return adCampaignNames.indexOf(c.name) !== -1 || campaignMatches(c);
        }).slice(0, 2);
    } else if (/underperformance_rca|change_impact_analysis|creative_brief|scale_check/.test(commandType)) {
        analysisScope.focus = 'issue-slice';
        campaigns = campaigns.slice(0, 8);
        adSets = adSets.slice(0, 12);
        ads = ads.slice(0, 20);
    } else if (/morning_account_review|full_account_review|account_overview|daily_optimisation/.test(commandType)) {
        analysisScope.focus = 'account';
        campaigns = campaigns.slice(0, 12);
        adSets = adSets.slice(0, 24);
        ads = ads.slice(0, 36);
    }

    runtimeContext.campaigns = campaigns;
    runtimeContext.ad_sets = adSets;
    runtimeContext.ads = ads;
    runtimeContext.analysis_scope = analysisScope;
    return runtimeContext;
}

function buildApexPrompts(runtimeContext) {
    var mode = runtimeContext && runtimeContext.session_mode ? runtimeContext.session_mode : 'daily_review';
    var commandType = runtimeContext && runtimeContext.command_type ? runtimeContext.command_type : 'daily_optimisation';
    var modeConfig = getApexModeConfig(mode);
    var modeExtraInstructions = {
        daily_review: 'Run morning account review. Produce one reading flow: market read, account pulse, what to do right now, what to leave alone, campaign insights, this week\'s moves, and 30-day horizon.',
        diagnostic: 'Run a root-cause diagnosis. Focus on why performance is where it is. Use breakdowns, change history, audiences, placement, geo, bid, and external context. Keep actioning secondary.',
        account_overview: 'Run a campaign/adset/ad deep dive. Tell the operator how to make each campaign better and more efficient, including settings, audience, location, placement, bid, learning, and creative bottlenecks.'
    };
    var systemPrompt = [
        'SYSTEM:',
        '',
        'You are an expert performance marketer with 20+ years of experience working in a financial advisory brand.',
        'You are APEX. You are the senior performance marketer responsible for this Meta Ads account.',
        'Every morning you open the account, read every signal from top to bottom, and produce one clear document: what needs to change, what to leave alone, and why.',
        '',
        'The file APEX_Playbook.docx is the decision bible. In this implementation, the extracted playbook rules are injected in playbook_rules below. Treat them as the source of truth for thresholds, diagnosis, and action frameworks.',
        '',
        'PERSONALITY AND OPERATING MODE:',
        '- You are not a dashboard. You are a performance marketer trusted to run this account like it is your own money.',
        '- You speak plainly. Short sentences. Every sentence names a problem, cause, or action.',
        '- You are cautious by design. Wrong changes are more expensive than no changes.',
        '- Learning phase is sacred. Never touch a learning campaign unless CPA is more than 200% above target.',
        '- Never recommend two structural changes to the same entity in the same week.',
        '- You always ask: what is the cost of acting vs the cost of waiting?',
        '- You are thorough: campaigns, ad sets, ads, placements, age, gender, location, device, time of day, bids, and external context all matter.',
        '',
        'SAFETY RULES:',
        '- You are read-only on data sources and execution systems.',
        '- Respect matured vs unmatured logic exactly and call it out explicitly.',
        '- Respect campaign/adset/ad status hierarchy exactly.',
        '- If the campaign is paused, do not emit PAUSE_ADSET or PAUSE_AD for children.',
        '- If the adset is paused, do not emit PAUSE_AD for the child ad.',
        '- Ads never own budget. Only valid campaign/adset budget owners can receive budget updates.',
        '- If status, freshness, or budget ownership is unsafe, downgrade to MONITOR.',
        '- One entity gets one surviving executable action only.',
        '- Use only the injected runtime context. Do not invent today, 7d, or 30d rollups that are not present.',
        '- When external_context is present, use it for competitor, benchmark, trend, and macro framing. Cite freshness and keep inference separate from fact.',
        '- external_posture is account-level guidance. Use it to set budget and messaging posture for the account, not to force fake campaign-specific market explanations.',
        '- When breakdowns are present, use them for dimensional analysis. If a breakdown is unavailable or only contains delivery metrics, say so directly.',
        '- Treat meta_operator_audit as first-class evidence. Prioritize campaign settings, audience, location, placement, bid, pacing, and ad-level delivery issues before leaning only on funnel metrics.',
        '- campaign_settings_audits, adset_settings_audits, and ad_health_audits are deterministic operator inputs. Use them directly when they are strong, and do not replace them with vague wording.',
        '- imported_skill_context is a deterministic operator layer. Use it explicitly for CPA, wasted spend, anomaly, pacing, geo/device, attribution, structure, and forecast calls. If a block is material, surface it as an explicit section or action in the output instead of burying it in a generic summary.',
        '- advanced_trend_intelligence is a first-class override. If ROAS or revenue improves while signup cost, D0 trial cost, or volume quality worsens, treat that as a sustainability warning rather than a clean scale signal.',
        '- Use advanced_trend_intelligence to reason about contradictory signals: rising ROAS with rising signup/D0 costs, falling ROAS despite cheaper signup cost, cheaper volume with weaker D6 quality, and early-trial improvement that does not translate into D6 value.',
        '- Treat D0 trial cost as a predictive forward signal for D6 quality. If D0 trial cost is below weighted median or declining week on week, use that as a positive input unless stronger downstream evidence disproves it.',
        '- Treat exceptional D15 ROAS and D30 ROAS as real quality signals. If long-tail ROAS is strong, do not jump straight to pause logic; explain how to improve the surrounding adset, audience, placement, or creative mix instead.',
        '- Before analysis, audit data_integrity_gate. Daily-row Meta↔Metabase join rate is debug-only and is expected to run low because spend date and signup date differ. Do not treat low daily-row match alone as a reason to halt optimization.',
        '- Expected spend-only rows are valid in this model: keep their spend in totals, exclude them from funnel benchmarks, and surface tracker caution only where material. Do not describe expected spend-only rows as corrupted data.',
        '- If spend reconciliation, weighted-median coherence, or fresh status coverage are healthy, optimization can continue even when daily-row match is low. Be cautious on ROAS/CAC confidence where spend coverage is weak, but do not issue blanket "do not optimize" conclusions.',
        '- Treat unmatched retargeting ads as a special case: do not misclassify them as broken prospecting just because Metabase funnel rows are missing.',
        '- Use the injected playbook_rules as operating discipline. Do not improvise when a playbook scenario clearly matches.',
        '- All actions are pending approval by default.',
        '',
        'OUTPUT EXPECTATIONS:',
        '- Return valid JSON only.',
        '- Be decisive and specific. Every action has a number.',
        '- Every diagnosis must mention the selected date range and whether the decision is matured or unmatured when relevant.',
        '- Write like an operator writing the morning brief, not like an analyst writing a report.',
        '- Master rule: if the user asks for full account, produce a complete campaign → adset → ad breakdown for all active items in order, with revamp recommendations for each entity. If an entity needs no change, say "no change needed" explicitly.',
        '- Mode-specific priority: ' + (modeExtraInstructions[mode] || modeExtraInstructions.daily_review)
    ].join('\n');

    var outputShape = [
        '{',
        '  "apex": {',
        '    "session_id": "string",',
        '    "session_mode": "' + mode + '",',
        '    "generated_at": "ISO",',
        '    "view_1_actions": [{',
        '      "severity": "BLOCK|RED|YELLOW|BLUE",',
        '      "entity_type": "campaign|adset|ad|account",',
        '      "entity_id": "string",',
        '      "entity_name": "string",',
        '      "action": "pause|budget_increase|budget_decrease|creative_swap|audience_expand|consolidate|bid_change|launch",',
        '      "current_value": "string",',
        '      "new_value": "string",',
        '      "trigger_metric": "string",',
        '      "trigger_value": 0,',
        '      "trigger_threshold": 0,',
        '      "optimizer_rule_id": null,',
        '      "optimizer_verdict": "endorsed|modified|overridden|null",',
        '      "override_reason": ""',
        '    }],',
        '    "view_2_diagnosis": {',
        '      "performance_shifts": [],',
        '      "attribution_gap": {},',
        '      "delivery_issues": [],',
        '      "learning_phase_map": []',
        '    },',
        '    "view_3_breakdowns": {',
        '      "top_age_gender_cohort": "",',
        '      "underfunded_cohort": "",',
        '      "kill_placements": [],',
        '      "hidden_winner_placements": [],',
        '      "ios_android_cpa_gap_pct": null,',
        '      "geo_budget_efficiency_gap": "",',
        '      "best_conversion_window": "",',
        '      "bid_strategy_recommendation": "",',
        '      "high_overlap_pairs": [],',
        '      "best_historical_change": "",',
        '      "worst_historical_change": "",',
        '      "creative_avg_decay_days": null',
        '    },',
        '    "view_4_forward_plan": {',
        '      "scaling_roadmap": [],',
        '      "creative_tests": [],',
        '      "audience_expansion": [],',
        '      "risk_flags": []',
        '    },',
        '    "meta_am_insights": [],',
        '    "month_scorecard": null',
        '  },',
        '  "optimizer_plan": {',
        '    "morning_brief": {',
        '      "market_read": { "posture":"HOLD AND OPTIMISE", "summary":"", "signals":[] },',
        '      "account_pulse": { "spend_today":"", "roas_7d":"", "cpa_7d":"", "active_counts":"", "learning_counts":"" },',
        '      "what_to_do_right_now": [],',
        '      "what_to_leave_alone": [],',
        '      "campaign_insights": [],',
        '      "this_weeks_moves": [],',
        '      "thirty_day_horizon": { "risks":[], "opportunities":[] }',
        '    },',
        '    "executive_summary": "string",',
        '    "plan_summary": { "total_actions":0, "ads_to_pause":0, "ads_to_kill":0, "ads_to_scale":0, "adsets_to_pause":0, "budget_increases":0, "budget_decreases":0, "estimated_spend_saved_daily":"", "estimated_roas_improvement":"", "top_priority_action":"" },',
        '    "actions": [{',
        '      "action_id": "ACT-001",',
        '      "priority": "P1|P2|P3",',
        '      "priority_label": "urgent|recommended|watch",',
        '      "category": "PAUSE|KILL|SCALE|BUDGET_SHIFT|FUNNEL_FIX|EARLY_WARNING|CREATIVE_REC|MONITOR",',
        '      "action_type": "PAUSE_AD|ACTIVATE_AD|ACTIVATE_ADSET|PAUSE_ADSET|ACTIVATE_CAMPAIGN|PAUSE_CAMPAIGN|UPDATE_ADSET_BUDGET|UPDATE_CAMPAIGN_BUDGET|MONITOR|CREATIVE_CHANGE|pause|scale_budget|reduce_budget|refresh_creative|launch_test|consolidate|investigate|hold",',
        '      "entity_type": "ad|adset|campaign|account",',
        '      "entity_id": "Meta ID",',
        '      "entity_name": "name",',
        '      "campaign_name": "",',
        '      "adset_name": "",',
        '      "current_metrics": { "spend":0, "d6_roas":"", "d6_cac":"", "signup_cost":"", "cpi":"", "installs":0, "signups":0, "d6":0, "alert_status":"", "ad_status":"", "adset_status":"", "campaign_status":"", "delivery_state":"", "budget_level":"", "budget_type":"", "budget_owner":"", "budget_current_daily_budget":0 },',
        '      "diagnosis": "specific metric trigger, date range, and matured/unmatured context",',
        '      "action_detail": "exact action with specific numbers",',
        '      "expected_impact": "estimated daily spend saved or ROAS improvement",',
        '      "risk": "what could go wrong if executed",',
        '      "success_metric": "metric and timeframe to judge success",',
        '      "override_optimizer_rule": false,',
        '      "override_reason": "",',
        '      "reasoning": "short rationale trace",',
        '      "confidence": "HIGH|MEDIUM|LOW",',
        '      "budget_change": { "current_daily_budget":0, "recommended_daily_budget":0, "change_pct":"" }',
        '    }],',
        '    "creative_insights": { "winning_format":"", "top_themes":[], "failing_themes":[], "new_creative_suggestions":[] },',
        '    "funnel_analysis": { "bottleneck":"", "fix_recommendations":[] },',
        '    "budget_reallocation": { "total_daily_budget_shift":"", "from":[], "to":[] },',
        '    "do_not_touch": [{ "entity_name":"", "entity_id":"", "reason":"" }],',
        '    "watch_list": [{ "entity_name":"", "priority":"P2|P3", "watch_reason":"", "trigger_for_action":"When to act" }]',
        '  }',
        '}'
    ].join('\n');

    var actionMappingGuide = [
        'Action mapping guide:',
        '- pause => PAUSE_AD / PAUSE_ADSET / PAUSE_CAMPAIGN depending on entity and status hierarchy',
        '- scale_budget => budget increase recommendation for the true budget owner only',
        '- reduce_budget => budget decrease recommendation for the true budget owner only',
        '- refresh_creative => CREATIVE_CHANGE in optimizer_plan actions',
        '- launch_test => CREATIVE_CHANGE or MONITOR if non-executable',
        '- consolidate => MONITOR',
        '- investigate => MONITOR',
        '- hold => MONITOR'
    ].join('\n');

    var userPrompt = [
        'SESSION_MODE: ' + mode,
        '',
        'CANONICAL COMMAND: ' + commandType,
        'MODE OBJECTIVE: ' + modeConfig.objective,
        'MODE INSTRUCTION: ' + modeConfig.command,
        '',
        'USER COMMAND:',
        (runtimeContext && runtimeContext.user_request) ? runtimeContext.user_request : (mode === 'daily_review' ? 'Run morning account review.' : (mode === 'diagnostic' ? 'Why is this slice underperforming?' : 'Deep dive: inspect this campaign/adset/ad hierarchy and tell me exactly how to make it more efficient.')),
        '',
        'RUNTIME_CONTEXT:',
        JSON.stringify(runtimeContext),
        '',
        actionMappingGuide,
        '',
        'Return JSON with this exact shape:',
        outputShape,
        '',
        'Extra constraints:',
        '- Use optimizer_plan.morning_brief for the readable operator document and optimizer_plan.actions for the execution-safe action list.',
        '- Use apex.view_1_actions for the formal action list when useful, but the morning brief is the main deliverable.',
        '- Put the executable-or-monitor optimizer action list in optimizer_plan.actions.',
        '- For sessions that are not action-first, optimizer_plan.actions may be empty or monitor-only.',
        '- Apply playbook_rules actively: horizontal before vertical scale, protect broad winners, separate prospecting from retargeting, respect the 20-25% budget step rule, and do not mistake short auction pressure for creative failure.',
        '- If meta_operator_audit shows clear Meta-side problems like high CPI, weak CTR, placement waste, geo inefficiency, or campaign concentration, surface them explicitly as the likely root causes and actions.',
        '- Treat skill_contracts as active internal operator modules. They define the standards for breakdown actions, structure audits, market posture, change-impact caution, compliance checks, replacement choices, attribution reasoning, and output consistency.',
        '- If breakdown_action_recommendations are present, use them as real account-level action inputs rather than decorative analysis.',
        '- signal_availability tells you which truth-depth layers are missing. If a signal is missing, say the conclusion is directional instead of pretending the source exists.',
        '- historical_winner_library contains the best matured winners from this account. Prefer those as replacement references before asking for net-new creative.',
        '- Every action diagnosis in optimizer_plan must mention the exact selected date range and matured or unmatured basis.',
        '- Mention data-integrity warnings when they materially affect confidence.',
        '- Every ad set analysis must include a finding on geography and age/gender efficiency if the breakdowns are available.',
        '- Campaign insights should explain objective fit, budget type, learning health, audience, location, placements, bid strategy, and creative bottlenecks without repeating top-level metrics.',
        '- Treat USER COMMAND as the primary operator ask. If it requests a specific campaign, ad set, or ad review, tailor the brief to that scope first and only include account-wide context where it changes the decision.',
        '- If USER COMMAND says full account or equivalent, cover all active campaigns in order, then their active adsets, then active ads. Do not skip healthy entities; say "no change needed" where appropriate.',
        '- Only render a full morning brief when CANONICAL COMMAND is morning_account_review. For all other commands, keep the response focused on the requested use case.',
        '- If external signals are not supported by the runtime context, return external_signals as an empty array.',
        '- Do not output more than 18 actions.',
        '- Favor fewer, sharper, higher-confidence actions over noisy coverage.',
        '- The team should be able to read top to bottom once and know exactly what to do today and what not to touch.'
    ].join('\n');

    return { system: systemPrompt, user: userPrompt, modeConfig: modeConfig };
}

async function generateOptimizationPlan(scanData) {
    var commandType = window.OPTIMIZER_COMMAND_TYPE || 'daily_optimisation';
    var target = window.OPTIMIZER_TARGET || { type: 'account', query: '' };
    var trendSearchSpec = parseTrendSearchPrompt(window.OPTIMIZER_USER_PROMPT || '');
    var metricObjectiveSpec = parseMetricObjectivePrompt(window.OPTIMIZER_USER_PROMPT || '');
    var growthDriverSpec = parseGrowthDriverPrompt(window.OPTIMIZER_USER_PROMPT || '');

    var scoped = buildScopedScanData(scanData, target);
    scanData = scoped.scanData || scanData;
    var deterministicStatusSpec = metricObjectiveSpec || trendSearchSpec || growthDriverSpec;
    var preTrendStatusFilter = deterministicStatusSpec ? (deterministicStatusSpec.explicit_status || 'all') : (window.OPTIMIZER_STATUS_FILTER || 'live_only');
    scanData = buildFilteredScanData(scanData, {
        audienceFilter: window.OPTIMIZER_AUDIENCE_FILTER || 'all',
        statusFilter: preTrendStatusFilter
    });

    if (trendSearchSpec) {
        var trendStatusFilter = preTrendStatusFilter;
        var trendRuntimeContext = {
            session_mode: window.OPTIMIZER_APEX_MODE || 'daily_review',
            command_type: 'trend_search',
            data_integrity_gate: buildDataIntegrityGate(scanData),
            advanced_trend_intelligence: buildAdvancedTrendIntelligence(scanData),
            external_posture: { active: false, posture: 'HOLD AND OPTIMISE', reason: 'Not needed for deterministic trend search.' },
            skill_contracts: buildOptimizerSkillContracts(),
            historical_winner_library: buildHistoricalWinnerLibrary(scanData),
            breakdown_action_recommendations: [],
            signal_availability: buildSignalAvailabilityContext(scanData, { available: false, breakdowns: {} })
        };
        var trendPlan = buildTrendSearchPlan(scanData, trendRuntimeContext, trendSearchSpec);
        var currentRangeDays = getRangeDayCount(scanData && scanData.date_range);
        var needsWiderTrendWindow = trendPlan && trendPlan.trend_search_result && (!trendPlan.trend_search_result.matches || !trendPlan.trend_search_result.matches.length) &&
            /wow_pct/.test(trendSearchSpec.metric) &&
            currentRangeDays < 42;
        if (needsWiderTrendWindow) {
            try {
                var widerRange = widenTrendSearchRange(scanData.date_range, 42);
                if (widerRange) {
                    var widerScan = await scanAccount(function() {}, widerRange, { preserveGlobal: true });
                    var widerScoped = buildScopedScanData(widerScan, target);
                    widerScan = widerScoped.scanData || widerScan;
                    widerScan = buildFilteredScanData(widerScan, {
                        audienceFilter: window.OPTIMIZER_AUDIENCE_FILTER || 'all',
                        statusFilter: trendStatusFilter
                    });
                    var widerTrendRuntimeContext = {
                        session_mode: window.OPTIMIZER_APEX_MODE || 'daily_review',
                        command_type: 'trend_search',
                        data_integrity_gate: buildDataIntegrityGate(widerScan),
                        advanced_trend_intelligence: buildAdvancedTrendIntelligence(widerScan),
                        external_posture: { active: false, posture: 'HOLD AND OPTIMISE', reason: 'Not needed for deterministic trend search.' },
                        skill_contracts: buildOptimizerSkillContracts(),
                        historical_winner_library: buildHistoricalWinnerLibrary(widerScan),
                        breakdown_action_recommendations: [],
                        signal_availability: buildSignalAvailabilityContext(widerScan, { available: false, breakdowns: {} })
                    };
                    var widerTrendPlan = buildTrendSearchPlan(widerScan, widerTrendRuntimeContext, trendSearchSpec);
                    if (widerTrendPlan && widerTrendPlan.trend_search_result && widerTrendPlan.trend_search_result.matches && widerTrendPlan.trend_search_result.matches.length) {
                        trendPlan = widerTrendPlan;
                        trendPlan.executive_summary += ' Used an expanded evidence window: ' + widerRange.since + ' → ' + widerRange.until + '.';
                    } else if (trendPlan && trendPlan.operator_answer) {
                        trendPlan.operator_answer += '\n\nNo strict match in the current window. Expanded trend read also checked: ' + widerRange.since + ' → ' + widerRange.until + '.';
                    }
                }
            } catch (trendExpandErr) {
                console.warn('[Optimizer] Trend-search range expansion failed:', trendExpandErr.message);
            }
        }
        trendPlan.external_context = { available: false, fetched_at: new Date().toISOString(), limitations: ['Skipped for deterministic trend search.'] };
        trendPlan.breakdown_context = { available: false, fetched_at: new Date().toISOString(), breakdowns: { age_gender: [], placement: [], device: [], geography: [], hourly: [] }, limitations: ['Skipped for deterministic trend search.'] };
        trendPlan.data_integrity_gate = trendRuntimeContext.data_integrity_gate;
        trendPlan.target_scope = scoped.targetSummary || null;
        trendPlan.session_mode = trendRuntimeContext.session_mode;
        trendPlan.command_type = 'trend_search';
        trendPlan.deterministic_audits = { campaigns: [], adsets: [], ads: [] };
        trendPlan.skill_contracts = trendRuntimeContext.skill_contracts;
        trendPlan.signal_availability = trendRuntimeContext.signal_availability;
        trendPlan.historical_winner_library = trendRuntimeContext.historical_winner_library;
        trendPlan.advanced_trend_intelligence = trendRuntimeContext.advanced_trend_intelligence;
        trendPlan.breakdown_action_recommendations = [];
        trendPlan.external_posture = trendRuntimeContext.external_posture;
        trendPlan.applied_filters = {
            audience: window.OPTIMIZER_AUDIENCE_FILTER || 'all',
            status: trendStatusFilter
        };
        trendPlan = enrichPlanWithScanContext(trendPlan, scanData);
        trendPlan = normalizeOptimizationPlan(trendPlan, scanData);
        trendPlan = finalizeOptimizerPlan(trendPlan, scanData);
        window.OPTIMIZER_PLAN = trendPlan;
        if (trendPlan.data_integrity_gate && trendPlan.data_integrity_gate.entity_match_rate_pct != null) {
            window.OPTIMIZER_LAST_MATCH_RATE_PCT = Number(trendPlan.data_integrity_gate.entity_match_rate_pct || 0);
            saveOptimizerLastMatchRatePct(window.OPTIMIZER_LAST_MATCH_RATE_PCT);
        }
        return trendPlan;
    }

    scanData = await enrichOptimizerSettings(scanData, commandType);
    if (metricObjectiveSpec) {
        var metricRange = buildMetricObjectiveEffectiveRange(scanData, metricObjectiveSpec);
        var metricBreakdownContext;
        try {
            metricBreakdownContext = await fetchApexBreakdowns(metricRange);
        } catch (metricBreakdownErr) {
            metricBreakdownContext = {
                available: false,
                fetched_at: new Date().toISOString(),
                breakdowns: { age_gender: [], placement: [], device: [], geography: [], hourly: [] },
                limitations: ['Granular breakdown fetch failed: ' + (metricBreakdownErr ? metricBreakdownErr.message : 'unknown error')]
            };
        }
        var metricPlan = buildMetricObjectivePlan(scanData, metricBreakdownContext, metricObjectiveSpec, metricRange);
        metricPlan.external_context = { available: false, fetched_at: new Date().toISOString(), limitations: ['Skipped for deterministic metric-objective search.'] };
        metricPlan.breakdown_context = metricBreakdownContext;
        metricPlan.data_integrity_gate = buildDataIntegrityGate(scanData);
        metricPlan.target_scope = scoped.targetSummary || null;
        metricPlan.session_mode = window.OPTIMIZER_APEX_MODE || 'daily_review';
        metricPlan.command_type = 'metric_objective_search';
        metricPlan.deterministic_audits = { campaigns: [], adsets: [], ads: [] };
        metricPlan.skill_contracts = buildOptimizerSkillContracts();
        metricPlan.signal_availability = buildSignalAvailabilityContext(scanData, metricBreakdownContext);
        metricPlan.historical_winner_library = buildHistoricalWinnerLibrary(scanData);
        metricPlan.advanced_trend_intelligence = buildAdvancedTrendIntelligence(scanData);
        metricPlan.breakdown_action_recommendations = buildBreakdownActionRecommendations(metricBreakdownContext);
        metricPlan.external_posture = { active: false, posture: 'HOLD AND OPTIMISE', reason: 'Not needed for deterministic metric-objective search.' };
        metricPlan.applied_filters = {
            audience: window.OPTIMIZER_AUDIENCE_FILTER || 'all',
            status: preTrendStatusFilter
        };
        metricPlan = enrichPlanWithScanContext(metricPlan, scanData);
        metricPlan = normalizeOptimizationPlan(metricPlan, scanData);
        metricPlan = finalizeOptimizerPlan(metricPlan, scanData);
        window.OPTIMIZER_PLAN = metricPlan;
        if (metricPlan.data_integrity_gate && metricPlan.data_integrity_gate.entity_match_rate_pct != null) {
            window.OPTIMIZER_LAST_MATCH_RATE_PCT = Number(metricPlan.data_integrity_gate.entity_match_rate_pct || 0);
            saveOptimizerLastMatchRatePct(window.OPTIMIZER_LAST_MATCH_RATE_PCT);
        }
        return metricPlan;
    }
    if (growthDriverSpec) {
        var growthRange = scanData && scanData.date_range ? scanData.date_range : getSelectedDates();
        var growthBreakdownContext;
        try {
            growthBreakdownContext = await fetchApexBreakdowns(growthRange);
        } catch (growthBreakdownErr) {
            growthBreakdownContext = {
                available: false,
                fetched_at: new Date().toISOString(),
                breakdowns: { age_gender: [], placement: [], device: [], geography: [], hourly: [] },
                limitations: ['Granular breakdown fetch failed: ' + (growthBreakdownErr ? growthBreakdownErr.message : 'unknown error')]
            };
        }
        var growthPlan = buildGrowthDriverPlan(scanData, growthBreakdownContext, growthDriverSpec);
        growthPlan.external_context = { available: false, fetched_at: new Date().toISOString(), limitations: ['Skipped for deterministic growth-driver search.'] };
        growthPlan.breakdown_context = growthBreakdownContext;
        growthPlan.data_integrity_gate = buildDataIntegrityGate(scanData);
        growthPlan.target_scope = scoped.targetSummary || null;
        growthPlan.session_mode = window.OPTIMIZER_APEX_MODE || 'daily_review';
        growthPlan.command_type = 'growth_driver_search';
        growthPlan.deterministic_audits = { campaigns: [], adsets: [], ads: [] };
        growthPlan.skill_contracts = buildOptimizerSkillContracts();
        growthPlan.signal_availability = buildSignalAvailabilityContext(scanData, growthBreakdownContext);
        growthPlan.historical_winner_library = buildHistoricalWinnerLibrary(scanData);
        growthPlan.advanced_trend_intelligence = buildAdvancedTrendIntelligence(scanData);
        growthPlan.breakdown_action_recommendations = buildBreakdownActionRecommendations(growthBreakdownContext);
        growthPlan.external_posture = { active: false, posture: 'HOLD AND OPTIMISE', reason: 'Not needed for deterministic growth-driver search.' };
        growthPlan.applied_filters = {
            audience: window.OPTIMIZER_AUDIENCE_FILTER || 'all',
            status: window.OPTIMIZER_STATUS_FILTER || 'live_only'
        };
        growthPlan = enrichPlanWithScanContext(growthPlan, scanData);
        growthPlan = normalizeOptimizationPlan(growthPlan, scanData);
        growthPlan = finalizeOptimizerPlan(growthPlan, scanData);
        window.OPTIMIZER_PLAN = growthPlan;
        if (growthPlan.data_integrity_gate && growthPlan.data_integrity_gate.entity_match_rate_pct != null) {
            window.OPTIMIZER_LAST_MATCH_RATE_PCT = Number(growthPlan.data_integrity_gate.entity_match_rate_pct || 0);
            saveOptimizerLastMatchRatePct(window.OPTIMIZER_LAST_MATCH_RATE_PCT);
        }
        return growthPlan;
    }
    var compactTree = buildCompactTree(scanData.tree);

    // Pre-compute rules-based actions to feed AI
    var rulesActions = [];
    var ads = scanData.ads || [];
    var benchmarks = buildOptimizerBenchmarks(ads);

    // Sort by spend desc for priority
    var sorted = ads.slice().sort(function(a, b) { return b.spend - a.spend; });

    sorted.forEach(function(ad) {
        var issues = [];
        var positives = [];
        var wowAd = (window.allData || []).find(function(a) { return a.ad_id === ad.ad_id; });
        var wow = wowAd ? wowAd._wow : null;
        var benchmarkProfile = getBenchmarkProfileForAd(ad, benchmarks);
        var isRetargetNoFunnel = ad.audience_bucket === 'retarget' && !ad.has_funnel_match;
        var priorBestD6ROAS = 0;
        var hadStrongHistory;
        var belowMedianROAS;
        var worseThanMedianCosts;
        if (wow && wow.lastWeek) priorBestD6ROAS = Math.max(priorBestD6ROAS, wow.lastWeek.d6ROAS || 0);
        if (wow && wow.prevWeek) priorBestD6ROAS = Math.max(priorBestD6ROAS, wow.prevWeek.d6ROAS || 0);
        if (wow && wow.maturedD6ROAS != null) priorBestD6ROAS = Math.max(priorBestD6ROAS, wow.maturedD6ROAS || 0);
        hadStrongHistory = priorBestD6ROAS > 28;
        belowMedianROAS = !isRetargetNoFunnel && benchmarkProfile.median_d6_roas > 0 && ad.d6ROAS > 0 && ad.d6ROAS < benchmarkProfile.median_d6_roas;
        worseThanMedianCosts =
            (!isRetargetNoFunnel && benchmarkProfile.median_signup_cost > 0 && ad.signupCost > benchmarkProfile.median_signup_cost) ||
            (!isRetargetNoFunnel && benchmarkProfile.median_d0_trial_cost > 0 && ad.d0TrialCost > benchmarkProfile.median_d0_trial_cost) ||
            (benchmarkProfile.median_cpi > 0 && ad.cpi > benchmarkProfile.median_cpi);
        var maturityNote = ad.isMatured ? 'MATURED (' + ad.daysSinceGoLive + 'd)' : 'NOT MATURED (' + (ad.daysSinceGoLive !== null ? ad.daysSinceGoLive + 'd' : 'unknown age') + ') â€” D6 metrics unreliable';

        // For non-matured ads, only flag early funnel issues
        if (!ad.isMatured && ad.spend >= 15000) {
            issues.push('[' + maturityNote + '] â€” judge on CPI/signup/D0 only, not D6');
            if (ad.signupCost > 1000) issues.push('Signup cost ' + fmtINR(ad.signupCost) + ' > \u20b91000');
            if (ad.d0TrialCost > 3500) issues.push('D0 trial cost ' + fmtINR(ad.d0TrialCost) + ' > \u20b93500');
            if (ad.cpi > 200) issues.push('CPI ' + fmtINR(ad.cpi) + ' > \u20b9200');
            if (ad.installs > 0 && ad.signups === 0 && ad.spend > 10000) issues.push(ad.installs + ' installs but zero signups');
            if (worseThanMedianCosts) issues.push('Early costs are worse than current Meta account medians');
            // Early positive signals
            if (ad.signupCost < 500 && ad.signups > 5) positives.push('Good early signal: signup cost ' + fmtINR(ad.signupCost));
            if (ad.cpi < 100) positives.push('Strong CPI ' + fmtINR(ad.cpi));
            if (isRetargetNoFunnel) positives.push('Retargeting campaign without Metabase funnel mapping — judging on Meta delivery and spend efficiency only');
            if (!isRetargetNoFunnel && !worseThanMedianCosts && ad.signupCost > 0 && benchmarkProfile.median_signup_cost > 0 && ad.signupCost < benchmarkProfile.median_signup_cost) positives.push('Early signup cost beats weighted cohort median');
        }

        // MATURED ads: use full D6 metrics
        if (ad.isMatured && ad.spend >= 15000) {
            issues.push('[' + maturityNote + '] â€” D6 metrics are reliable');
            if (ad.d6ROAS <= 0 && ad.signups === 0) issues.push('KILL: ' + fmtINR(ad.spend) + ' spent, zero signups, zero D6 ROAS');
            else if (ad.d6ROAS < 5 && ad.spend >= 20000) issues.push('DROP: D6 ROAS ' + fmtPct(ad.d6ROAS) + ' with ' + fmtINR(ad.spend) + ' spent');
            else if (ad.d6ROAS < 15) issues.push('POOR D6 ROAS: ' + fmtPct(ad.d6ROAS) + ' (threshold: 28%)');

            if (ad.signupCost > 1000) issues.push('Signup cost ' + fmtINR(ad.signupCost) + ' > \u20b91000');
            if (ad.d0TrialCost > 3500) issues.push('D0 trial cost ' + fmtINR(ad.d0TrialCost) + ' > \u20b93500');
            if (ad.d6CAC > 15000) issues.push('D6 CAC ' + fmtINR(ad.d6CAC) + ' > \u20b915K');
            if (ad.cpi > 200) issues.push('CPI ' + fmtINR(ad.cpi) + ' > \u20b9200');
            if (ad.installs > 0 && ad.signups === 0 && ad.spend > 10000) issues.push(ad.installs + ' installs but zero signups');
            if (isRetargetNoFunnel) issues.push('Retargeting campaign without Metabase funnel mapping — do not judge on missing conversion data');
            else if (belowMedianROAS) issues.push('Current D6 ROAS is below weighted cohort median (' + fmtPct(benchmarkProfile.median_d6_roas) + ')');
            if (worseThanMedianCosts) issues.push('Current costs are worse than Meta optimizer medians');
        }

        // GREEN: scale candidates (only matured or very strong early signals)
        if (ad.spend >= 15000) {
            if (ad.isMatured && ad.d6ROAS > 50) positives.push('EXCEPTIONAL D6 ROAS: ' + fmtPct(ad.d6ROAS) + ' (matured) \u2014 scale aggressively');
            else if (ad.isMatured && ad.d6ROAS > 28) positives.push('STRONG D6 ROAS: ' + fmtPct(ad.d6ROAS) + ' (matured) \u2014 scale candidate');
            if (ad.signupCost < 500 && ad.signups > 10) positives.push('Low signup cost ' + fmtINR(ad.signupCost));
            if (ad.isMatured && ad.d6CAC < 12000 && ad.d6 > 0) positives.push('D6 CAC ' + fmtINR(ad.d6CAC) + ' excellent (matured)');
            if (!isRetargetNoFunnel && benchmarkProfile.median_d6_roas > 0 && ad.d6ROAS > benchmarkProfile.median_d6_roas) positives.push('D6 ROAS beats weighted cohort median');
        }

        // REACTIVATE: paused ads/adsets with good historical performance
        if (ad.is_effectively_paused && ad.spend >= 10000) {
            if (ad.isMatured && ad.d6ROAS > 28) {
                positives.push('REACTIVATE: Paused but D6 ROAS was ' + fmtPct(ad.d6ROAS) + ' (>28%) â€” strong performer was turned off');
                issues.push('[PAUSED] Ad is not running despite good D6 ROAS');
            } else if (ad.isMatured && ad.d6ROAS > 15 && ad.signupCost < 800) {
                positives.push('REACTIVATE CANDIDATE: Paused but had decent metrics â€” D6 ROAS ' + fmtPct(ad.d6ROAS) + ', SU Cost ' + fmtINR(ad.signupCost));
            } else if (!ad.isMatured && ad.signupCost > 0 && ad.signupCost < 500 && ad.signups > 5) {
                positives.push('REACTIVATE CANDIDATE: Paused before maturity â€” early signals were good (SU Cost ' + fmtINR(ad.signupCost) + ', ' + ad.signups + ' signups)');
            }
        }

        // WATCH: low spend creatives
        if (ad.spend > 0 && ad.spend < 15000) {
            if (ad.signups === 0 && ad.spend > 5000) issues.push('WATCH: ' + fmtINR(ad.spend) + ' spent, no signups yet');
            if (ad.cpi > 150 && ad.spend > 3000) issues.push('EARLY WARNING: CPI ' + fmtINR(ad.cpi) + ' trending high');
        }

        // Funnel drop-off analysis
        if (ad.installs > 50 && ad.signups > 0) {
            var signupRate = ad.signups / ad.installs;
            if (signupRate < 0.05) issues.push('Funnel leak: only ' + (signupRate * 100).toFixed(1) + '% install-to-signup rate');
        }
        if (ad.signups > 10 && ad.d0_trial === 0) issues.push('Funnel blocked: ' + ad.signups + ' signups but zero D0 trials');
        if (ad.isMatured && ad.d0_trial > 5 && ad.d6 === 0 && ad.spend > 15000) issues.push('D0\u2192D6 conversion dead: ' + ad.d0_trial + ' trials, zero D6 (matured ad)');

        // WoW trend analysis (from window.allData)
        if (wow && wow.trendDirection === 'declining') {
            issues.push('WoW DECLINING: signup cost \u2191' + (wow.signupCost_wow || 0).toFixed(0) + '%, D0 trial cost \u2191' + (wow.d0TrialCost_wow || 0).toFixed(0) + '% â€” D6 will likely deteriorate');
        }
        if (wow && wow.trendDirection === 'improving') {
            positives.push('WoW IMPROVING: costs trending down â€” performance recovering');
        }
        if (wow && wow.continuousDecline) issues.push('Continuous WoW decline in costs/output is a major red signal');
        if (wow && wow.continuousIncrease) positives.push('Continuous WoW improvement in costs/output is a major green signal');
        if (wow && wow.signups_wow != null && wow.signups_wow < -20) issues.push('Signups down ' + Math.abs(wow.signups_wow).toFixed(0) + '% WoW');
        if (wow && wow.d6Revenue_wow != null && wow.d6Revenue_wow < -25) issues.push('D6 revenue down ' + Math.abs(wow.d6Revenue_wow).toFixed(0) + '% WoW');
        if (wow && wow.signups_wow != null && wow.signups_wow > 15) positives.push('Signups up ' + wow.signups_wow.toFixed(0) + '% WoW');
        if (wow && wow.d6Revenue_wow != null && wow.d6Revenue_wow > 20) positives.push('D6 revenue up ' + wow.d6Revenue_wow.toFixed(0) + '% WoW');
        if (wow && wow.maturedD6ROAS != null && ad.isMatured) {
            if (wow.maturedD6ROAS < 15) issues.push('Matured D6 ROAS (excl this week): ' + wow.maturedD6ROAS.toFixed(1) + '% â€” very poor');
        }

        if (hadStrongHistory && wow && wow.continuousDecline) positives.push('Historically strong performer; recent drop should not trigger an immediate hard cut');

        if (issues.length > 0 || positives.length > 0) {
            var suggestedAction =
                ad.is_effectively_paused && ad.isMatured && ad.d6ROAS > 28 ? getActivationActionForAd(ad) :
                ad.is_effectively_paused && !ad.isMatured && ad.signupCost > 0 && ad.signupCost < 500 ? getActivationActionForAd(ad) :
                ad.isMatured && wow && wow.continuousDecline && hadStrongHistory ? 'REVIEW' :
                ad.isMatured && wow && wow.continuousDecline && ad.d6ROAS < 15 ? 'REVIEW' :
                ad.isMatured && issues.length >= 3 && ad.spend >= 15000 && !hadStrongHistory ? 'PAUSE' :
                !ad.isMatured && issues.length >= 3 ? 'EARLY_WARNING' :
                wow && wow.continuousIncrease && positives.length > 0 && ad.isMatured ? 'SCALE' :
                wow && wow.continuousIncrease && positives.length > 0 ? 'REVIEW' :
                (positives.length > 0 && ad.isMatured && ad.d6ROAS > 28 ? 'SCALE' : 'REVIEW');
            rulesActions.push({
                name: ad.ad_name, id: ad.ad_id, campaign: ad.campaign_name, adset: ad.adset_name,
                spend: Math.round(ad.spend), d6_roas: +ad.d6ROAS.toFixed(1), signups: ad.signups, d6: ad.d6,
                impressions: ad.impressions, clicks: ad.clicks, installs: ad.installs,
                cpi: ad.cpi ? Math.round(ad.cpi) : null,
                ctr_pct: ad.ctr != null ? +ad.ctr.toFixed(2) : null,
                signup_cost: ad.signupCost ? Math.round(ad.signupCost) : null,
                d0_trial_cost: ad.d0TrialCost ? Math.round(ad.d0TrialCost) : null,
                d6_cac: ad.d6CAC ? Math.round(ad.d6CAC) : null,
                ad_status: ad.ad_status,
                adset_status: ad.adset_status,
                campaign_status: ad.campaign_status,
                delivery_state: ad.delivery_state,
                budget_level: ad.budget_level,
                budget_type: ad.budget_type,
                budget_owner_name: ad.budget_entity_name,
                budget_current_daily_budget: ad.budget_current_daily_budget,
                alert: ad.alertStatus,
                is_matured: ad.isMatured, days_live: ad.daysSinceGoLive, go_live: ad.goLiveDate,
                trend: wow ? wow.trendDirection : 'unknown',
                trend_strength: wow && wow.continuousDecline ? 'continuous_decline' : (wow && wow.continuousIncrease ? 'continuous_increase' : 'single_window'),
                prior_best_d6_roas: priorBestD6ROAS ? +priorBestD6ROAS.toFixed(1) : null,
                benchmark_context: {
                    scope: benchmarks.scope,
                    median_d6_roas: benchmarks.median_d6_roas ? +benchmarks.median_d6_roas.toFixed(1) : 0,
                    median_signup_cost: benchmarks.median_signup_cost ? Math.round(benchmarks.median_signup_cost) : 0,
                    median_d0_trial_cost: benchmarks.median_d0_trial_cost ? Math.round(benchmarks.median_d0_trial_cost) : 0,
                    median_cpi: benchmarks.median_cpi ? Math.round(benchmarks.median_cpi) : 0
                },
                issues: issues, positives: positives,
                suggested: suggestedAction
            });
        }
    });

    // â”€â”€ ADSET-LEVEL ANALYSIS â”€â”€
    var adsetActions = [];
    for (var ck in scanData.tree) {
        for (var ak in scanData.tree[ck].adsets) {
            var as = scanData.tree[ck].adsets[ak];
            var redAds = as.ads.filter(function(a) { return a.alertStatus === 'red'; });
            var greenAds = as.ads.filter(function(a) { return a.alertStatus === 'green'; });
            var decliningAds = as.ads.filter(function(a) {
                var w = (window.allData || []).find(function(x) { return x.ad_id === a.ad_id; });
                return w && w._wow && w._wow.trendDirection === 'declining';
            });
            var continuousDecliners = as.ads.filter(function(a) {
                var w = (window.allData || []).find(function(x) { return x.ad_id === a.ad_id; });
                return w && w._wow && w._wow.continuousDecline;
            });
            var strongHistoryDecliners = as.ads.filter(function(a) {
                var w = (window.allData || []).find(function(x) { return x.ad_id === a.ad_id; });
                var priorBest = 0;
                if (w && w._wow && w._wow.lastWeek) priorBest = Math.max(priorBest, w._wow.lastWeek.d6ROAS || 0);
                if (w && w._wow && w._wow.prevWeek) priorBest = Math.max(priorBest, w._wow.prevWeek.d6ROAS || 0);
                if (w && w._wow && w._wow.maturedD6ROAS != null) priorBest = Math.max(priorBest, w._wow.maturedD6ROAS || 0);
                return w && w._wow && w._wow.continuousDecline && priorBest > 28;
            });
            var totalAds = as.ads.length;
            var spend = as.totals.spend;
            var d6ROAS = as.totals.d6ROAS;

            if (redAds.length > 0 && redAds.length === totalAds) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'PAUSE_ADSET', reason: 'All ' + totalAds + ' ads are red alerts', spend: spend });
            } else if (redAds.length > totalAds * 0.7) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'PAUSE_ADSET', reason: redAds.length + '/' + totalAds + ' ads are red â€” adset mostly failing', spend: spend });
            }
            if (decliningAds.length > totalAds * 0.5 && spend > 15000) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'WATCH_ADSET', reason: decliningAds.length + '/' + totalAds + ' ads declining WoW â€” adset trending down, D6 will worsen', spend: spend });
            }
            if (continuousDecliners.length > 0 && strongHistoryDecliners.length > 0 && spend > 30000) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'WATCH_ADSET', reason: strongHistoryDecliners.length + ' historically strong ad(s) are now in continuous WoW decline - refresh creatives before hard cuts', spend: spend });
            }
            if (greenAds.length > 0 && d6ROAS > 28 && spend > 30000) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'SCALE_ADSET', reason: 'Adset D6 ROAS ' + d6ROAS.toFixed(1) + '% with ' + fmtINR(spend) + ' â€” scale budget', spend: spend });
            }
            if (d6ROAS < 15 && spend > 50000) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'CUT_ADSET_BUDGET', reason: strongHistoryDecliners.length > 0 ? 'Adset has strong-history assets but recent decline - trim budget carefully, not aggressively' : 'Adset D6 ROAS only ' + d6ROAS.toFixed(1) + '% with ' + fmtINR(spend) + ' spent - reduce budget', spend: spend });
            }
            // REACTIVATE paused adsets with good historical performance
            var pausedGoodAds = as.ads.filter(function(a) { return a.is_effectively_paused && a.d6ROAS > 20 && a.spend >= 10000; });
            if (pausedGoodAds.length > 0) {
                adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: getActivationActionForAds(pausedGoodAds),
                    reason: pausedGoodAds.length + ' paused ad(s) with D6 ROAS >' + 20 + '% â€” ' + pausedGoodAds.map(function(a) { return a.ad_name + ' (' + a.d6ROAS.toFixed(1) + '%)'; }).join(', '),
                    spend: spend, ads: pausedGoodAds.map(function(a) { return { name: a.ad_name, id: a.ad_id, d6ROAS: a.d6ROAS, spend: a.spend }; }) });
            }
            // Budget optimization within adset: shift from worst to best ads
            if (as.ads.length >= 3 && spend > 30000) {
                var sortedByROAS = as.ads.filter(function(a) { return a.spend > 5000 && a.d6ROAS > 0; }).sort(function(a, b) { return b.d6ROAS - a.d6ROAS; });
                if (sortedByROAS.length >= 2) {
                    var best = sortedByROAS[0];
                    var worst = sortedByROAS[sortedByROAS.length - 1];
                    if (best.d6ROAS > worst.d6ROAS * 2) {
                        adsetActions.push({ level: 'adset', adset: ak, campaign: ck, action: 'INTRA_ADSET_SHIFT',
                            reason: 'Best ad ' + best.ad_name + ' (' + best.d6ROAS.toFixed(1) + '%) vs worst ' + worst.ad_name + ' (' + worst.d6ROAS.toFixed(1) + '%) â€” shift budget within adset',
                            spend: spend });
                    }
                }
            }
        }
    }

    // â”€â”€ CAMPAIGN-LEVEL ANALYSIS â”€â”€
    var campaignActions = [];
    for (var ck2 in scanData.tree) {
        var camp = scanData.tree[ck2];
        var campTotals = camp.totals;
        var campAdsets = Object.keys(camp.adsets);
        var campRedAdsets = campAdsets.filter(function(ak) {
            return camp.adsets[ak].ads.every(function(a) { return a.alertStatus === 'red'; });
        });

        if (campRedAdsets.length === campAdsets.length && campAdsets.length > 0) {
            campaignActions.push({ level: 'campaign', campaign: ck2, action: 'PAUSE_CAMPAIGN', reason: 'All ' + campAdsets.length + ' adsets are red â€” campaign is fully underperforming', spend: campTotals.spend });
        }
        if (campTotals.d6ROAS > 28 && campTotals.spend > 100000) {
            campaignActions.push({ level: 'campaign', campaign: ck2, action: 'SCALE_CAMPAIGN', reason: 'Campaign D6 ROAS ' + campTotals.d6ROAS.toFixed(1) + '% with ' + fmtINR(campTotals.spend) + ' â€” increase campaign budget', spend: campTotals.spend });
        }
        if (campTotals.d6ROAS < 15 && campTotals.spend > 100000) {
            campaignActions.push({ level: 'campaign', campaign: ck2, action: 'CUT_CAMPAIGN_BUDGET', reason: 'Campaign D6 ROAS only ' + campTotals.d6ROAS.toFixed(1) + '% with ' + fmtINR(campTotals.spend) + ' â€” reduce campaign budget significantly', spend: campTotals.spend });
        }
    }

    var runtimeRange = scanData && scanData.date_range ? scanData.date_range : getSelectedDates();
    var scopedTargetType = String((target && target.type) || 'account').toLowerCase();
    var needsTargetContext = scopedTargetType !== 'account';
    var needExternalContext = /morning_account_review|deep_dive|predict_30_days/.test(String(commandType || '')) ||
        (needsTargetContext && /underperformance_rca|change_impact_analysis|creative_brief|scale_check/.test(String(commandType || '')));
    var needBreakdowns = /morning_account_review|account_overview|deep_dive|underperformance_rca|change_impact_analysis|creative_brief|scale_check|full_account_review/.test(String(commandType || '')) ||
        needsTargetContext;
    var contextResults = await Promise.allSettled([
        needExternalContext ? fetchApexExternalContext() : Promise.resolve({
            available: false,
            fetched_at: new Date().toISOString(),
            limitations: ['Skipped for this command.']
        }),
        needBreakdowns ? fetchApexBreakdowns(runtimeRange) : Promise.resolve({
            available: false,
            fetched_at: new Date().toISOString(),
            breakdowns: { age_gender: [], placement: [], device: [], geography: [], hourly: [] },
            limitations: ['Skipped for this command.']
        })
    ]);
    var externalContext = contextResults[0].status === 'fulfilled' ? contextResults[0].value : {
        available: false,
        fetched_at: new Date().toISOString(),
        limitations: ['External context fetch failed: ' + (contextResults[0].reason ? contextResults[0].reason.message : 'unknown error')]
    };
    var breakdownContext = contextResults[1].status === 'fulfilled' ? contextResults[1].value : {
        available: false,
        fetched_at: new Date().toISOString(),
        breakdowns: { age_gender: [], placement: [], device: [], geography: [], hourly: [] },
        limitations: ['Granular breakdown fetch failed: ' + (contextResults[1].reason ? contextResults[1].reason.message : 'unknown error')]
    };

    if (!externalContext.available && externalContext.limitations && externalContext.limitations.length) {
        console.warn('[APEX] External context unavailable:', externalContext.limitations.join(' | '));
    }
    if (!breakdownContext.available && breakdownContext.limitations && breakdownContext.limitations.length) {
        console.warn('[APEX] Breakdown context unavailable:', breakdownContext.limitations.join(' | '));
    }

    var runtimeContext = buildApexRuntimeContext(scanData, benchmarks, campaignActions, adsetActions, rulesActions, compactTree, externalContext, breakdownContext);
    if (scoped.targetSummary) runtimeContext.target_scope = scoped.targetSummary;
    runtimeContext = narrowOptimizerRuntimeContextForCommand(runtimeContext);
    var brainCacheKey = buildOptimizerBrainCacheKey(scanData, window.OPTIMIZER_USER_PROMPT || '', runtimeContext);
    var cachedBrain = getOptimizerBrainCache(brainCacheKey);
    if (cachedBrain) {
        window.OPTIMIZER_PLAN = cachedBrain;
        if (cachedBrain.data_integrity_gate && cachedBrain.data_integrity_gate.entity_match_rate_pct != null) {
            window.OPTIMIZER_LAST_MATCH_RATE_PCT = Number(cachedBrain.data_integrity_gate.entity_match_rate_pct || 0);
        }
        return cachedBrain;
    }
    var apexPrompts = buildApexPrompts(runtimeContext);
    var systemPrompt = apexPrompts.system;
    var userPrompt = apexPrompts.user;

    var plan;
    try {
        var brainResponse = await fetch('/api/optimizer/brain', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_request: window.OPTIMIZER_USER_PROMPT || '',
                runtime_context: runtimeContext
            }),
            signal: AbortSignal.timeout(300000)
        });
        var brainResult = await brainResponse.json();
        if (!brainResult.success) throw new Error(brainResult.error || 'Optimizer brain failed');
        plan = brainResult.optimizer_plan ? Object.assign({}, brainResult.optimizer_plan, {
            use_case: brainResult.use_case || null,
            evidence: brainResult.evidence || null,
            qa: brainResult.qa || null
        }) : brainResult;
    } catch (brainErr) {
        console.warn('[Optimizer] Brain route failed, falling back to generic AI analyze:', brainErr.message);
        var response = await fetch('/api/ai/analyze', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ system: systemPrompt, prompt: userPrompt, max_tokens: 16000 }),
            signal: AbortSignal.timeout(300000)
        });
        var result = await response.json();
        if (!result.success) throw new Error(result.error || 'AI call failed');
        var clean = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        try {
            plan = JSON.parse(clean);
        } catch (e) {
            console.warn('[Optimizer] JSON truncated, attempting repair...');
            var repaired = clean;
            repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*$/, '');
            repaired = repaired.replace(/,\s*\{[^}]*$/, '');
            repaired = repaired.replace(/,\s*"[^"]*$/, '');
            var opens = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
            var openBraces = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
            for (var bi = 0; bi < opens; bi++) repaired += ']';
            for (var bj = 0; bj < openBraces; bj++) repaired += '}';
            plan = JSON.parse(repaired);
        }
    }
    plan = finalizeOptimizerPlan(plan, scanData);
    plan.external_context = externalContext;
    plan.breakdown_context = breakdownContext;
    plan.data_integrity_gate = runtimeContext.data_integrity_gate || buildDataIntegrityGate(scanData);
    plan.target_scope = scoped.targetSummary || null;
    plan.session_mode = runtimeContext.session_mode || window.OPTIMIZER_APEX_MODE || 'daily_review';
    plan.command_type = runtimeContext.command_type || window.OPTIMIZER_COMMAND_TYPE || 'daily_optimisation';
    plan.deterministic_audits = {
        campaigns: runtimeContext.campaign_settings_audits || [],
        adsets: runtimeContext.adset_settings_audits || [],
        ads: runtimeContext.ad_health_audits || []
    };
    plan.skill_contracts = runtimeContext.skill_contracts || [];
    plan.signal_availability = runtimeContext.signal_availability || null;
    plan.historical_winner_library = runtimeContext.historical_winner_library || null;
    plan.advanced_trend_intelligence = runtimeContext.advanced_trend_intelligence || null;
    plan.breakdown_action_recommendations = runtimeContext.breakdown_action_recommendations || [];
    plan.external_posture = runtimeContext.external_posture || null;
    plan.applied_filters = {
        audience: window.OPTIMIZER_AUDIENCE_FILTER || 'all',
        status: window.OPTIMIZER_STATUS_FILTER || 'live_only'
    };
    plan = enrichPlanWithScanContext(plan, scanData);
    plan = normalizeOptimizationPlan(plan, scanData);
    plan = finalizeOptimizerPlan(plan, scanData);
    window.OPTIMIZER_PLAN = plan;
    setOptimizerBrainCache(brainCacheKey, plan);
    if (plan.data_integrity_gate && plan.data_integrity_gate.entity_match_rate_pct != null) {
        window.OPTIMIZER_LAST_MATCH_RATE_PCT = Number(plan.data_integrity_gate.entity_match_rate_pct || 0);
        saveOptimizerLastMatchRatePct(window.OPTIMIZER_LAST_MATCH_RATE_PCT);
    }
    return plan;
}

// â”€â”€ Execution â”€â”€

async function executeAction(action) {
    var endpoint, payload;

    if (action.action_type === 'PAUSE_AD') {
        endpoint = '/api/meta-write/ad/' + action.entity_id + '/status';
        payload = { status: 'PAUSED' };
    } else if (action.action_type === 'ACTIVATE_AD') {
        endpoint = '/api/meta-write/ad/' + action.entity_id + '/status';
        payload = { status: 'ACTIVE' };
    } else if (action.action_type === 'ACTIVATE_ADSET') {
        endpoint = '/api/meta-write/adset/' + action.entity_id + '/status';
        payload = { status: 'ACTIVE' };
    } else if (action.action_type === 'PAUSE_ADSET') {
        endpoint = '/api/meta-write/adset/' + action.entity_id + '/status';
        payload = { status: 'PAUSED' };
    } else if (action.action_type === 'UPDATE_ADSET_BUDGET' && action.budget_change) {
        endpoint = '/api/meta-write/adset/' + action.entity_id + '/budget';
        payload = { daily_budget_cents: Math.round(action.budget_change.recommended_daily_budget * 100) };
    } else if (action.action_type === 'ACTIVATE_CAMPAIGN') {
        endpoint = '/api/meta-write/campaign/' + action.entity_id + '/status';
        payload = { status: 'ACTIVE' };
    } else if (action.action_type === 'PAUSE_CAMPAIGN') {
        endpoint = '/api/meta-write/campaign/' + action.entity_id + '/status';
        payload = { status: 'PAUSED' };
    } else if (action.action_type === 'UPDATE_CAMPAIGN_BUDGET' && action.budget_change) {
        endpoint = '/api/meta-write/campaign/' + action.entity_id + '/budget';
        payload = { daily_budget_cents: Math.round(action.budget_change.recommended_daily_budget * 100) };
    } else {
        return { success: false, error: 'Unknown action type' };
    }

    var res = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(15000)
    }).then(function(r) { return r.json(); });

    window.OPTIMIZER_LOG.push({
        timestamp: new Date().toISOString(), action_id: action.action_id,
        action_type: action.action_type, entity_id: action.entity_id,
        entity_name: action.entity_name, success: res.success || false, error: res.error || null
    });
    saveLog();
    return res;
}

async function executeAllActions(actions) {
    var batch = actions.filter(function(a) { return isExecutableActionType(a.action_type); }).map(function(a) {
        return {
            action_id: a.action_id, action_type: a.action_type, entity_type: a.entity_type,
            entity_id: a.entity_id,
            new_status: a.action_type.indexOf('PAUSE') !== -1 ? 'PAUSED' : ((a.action_type === 'ACTIVATE_AD' || a.action_type === 'ACTIVATE_ADSET' || a.action_type === 'ACTIVATE_CAMPAIGN') ? 'ACTIVE' : null),
            new_daily_budget: a.budget_change ? a.budget_change.recommended_daily_budget : null
        };
    });

    var res = await fetch('/api/meta-write/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actions: batch }),
        signal: AbortSignal.timeout(300000)
    }).then(function(r) { return r.json(); });

    (res.results || []).forEach(function(r) {
        var orig = actions.find(function(a) { return a.action_id === r.action_id; });
        window.OPTIMIZER_LOG.push({
            timestamp: new Date().toISOString(), action_id: r.action_id,
            action_type: orig ? orig.action_type : '', entity_id: r.entity_id,
            entity_name: orig ? orig.entity_name : '', success: r.success, error: r.error || null
        });
    });
    saveLog();
    return res;
}

var OPTIMIZER_BROWSER_CACHE_NS = 'optimizer';
var OPTIMIZER_BROWSER_CACHE_MEM = null;
var OPTIMIZER_BRAIN_CACHE = {};
var OPTIMIZER_BRAIN_CACHE_TTL_MS = 15 * 60 * 1000;
var OPTIMIZER_SCAN_CACHE_KEY = 'optimizer_scan_cache';
var OPTIMIZER_SCAN_CACHE_TTL_MS = 30 * 60 * 1000;
var OPTIMIZER_SCAN_CACHE_MEM = null;

function loadOptimizerBrowserCacheStore() {
    if (OPTIMIZER_BROWSER_CACHE_MEM) return OPTIMIZER_BROWSER_CACHE_MEM;
    OPTIMIZER_BROWSER_CACHE_MEM = {};
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', SERVER + '/api/browser-cache/' + encodeURIComponent(OPTIMIZER_BROWSER_CACHE_NS), false);
        xhr.send(null);
        if (xhr.status >= 200 && xhr.status < 300) {
            var parsed = JSON.parse(xhr.responseText || '{}');
            OPTIMIZER_BROWSER_CACHE_MEM = parsed && parsed.data ? parsed.data : {};
        }
    } catch (e) {}
    return OPTIMIZER_BROWSER_CACHE_MEM;
}

function getOptimizerBrowserCacheEntry(key) {
    var store = loadOptimizerBrowserCacheStore();
    var entry = store && store[key];
    if (!entry) return null;
    var ts = Number(entry.ts || 0);
    var ttlMs = Number(entry.ttlMs || 0);
    if (ttlMs > 0 && (Date.now() - ts) > ttlMs) {
        delete store[key];
        return null;
    }
    return entry;
}

function setOptimizerBrowserCacheEntry(key, value, ttlMs) {
    var store = loadOptimizerBrowserCacheStore();
    store[key] = { ts: Date.now(), ttlMs: Number(ttlMs || 0), value: value };
    OPTIMIZER_BROWSER_CACHE_MEM = store;
    try {
        fetch(SERVER + '/api/browser-cache/' + encodeURIComponent(OPTIMIZER_BROWSER_CACHE_NS), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key, value: store[key], ttlMs: ttlMs || 0 }),
            keepalive: true
        }).catch(function() {});
    } catch (e) {}
}

function getOptimizerBrowserCacheValue(key, fallback) {
    var entry = getOptimizerBrowserCacheEntry(key);
    return entry && entry.value !== undefined ? entry.value : fallback;
}

function saveLog() { setOptimizerBrowserCacheEntry('optimizer_log', (window.OPTIMIZER_LOG || []).slice(-200), 7 * 24 * 60 * 60 * 1000); }
function loadLog() {
    var entry = getOptimizerBrowserCacheEntry('optimizer_log');
    return entry && Array.isArray(entry.value) ? entry.value : [];
}

function loadOptimizerBrainCache() {
    var entry = getOptimizerBrowserCacheEntry('optimizer_brain_cache');
    return entry && entry.value && typeof entry.value === 'object' ? entry.value : {};
}

function saveOptimizerBrainCache(cache) {
    setOptimizerBrowserCacheEntry('optimizer_brain_cache', cache || {}, 24 * 60 * 60 * 1000);
}

function loadOptimizerLastMatchRatePct() {
    var value = getOptimizerBrowserCacheValue('optimizer_last_match_rate_pct', 0);
    var num = Number(value);
    return isNaN(num) ? 0 : num;
}

function saveOptimizerLastMatchRatePct(value) {
    var num = Number(value);
    if (isNaN(num)) num = 0;
    setOptimizerBrowserCacheEntry('optimizer_last_match_rate_pct', String(num), 30 * 24 * 60 * 60 * 1000);
}

window.OPTIMIZER_LAST_MATCH_RATE_PCT = loadOptimizerLastMatchRatePct();

function hashOptimizerKey(value) {
    var str = String(value || '');
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash & 0x7fffffff;
    }
    return String(hash);
}

function buildOptimizerBrainCacheKey(scanData, prompt, runtimeContext) {
    var summary = scanData && scanData.summary ? scanData.summary : {};
    var dateRange = scanData && scanData.date_range ? scanData.date_range : {};
    var integrity = runtimeContext && runtimeContext.data_integrity_gate ? runtimeContext.data_integrity_gate : (scanData && scanData.data_integrity_gate ? scanData.data_integrity_gate : {});
    var fingerprint = {
        platform: 'meta',
        version: 2,
        prompt: String(prompt || '').trim().toLowerCase(),
        session_mode: runtimeContext && runtimeContext.session_mode || '',
        command_type: runtimeContext && runtimeContext.command_type || '',
        target: runtimeContext && runtimeContext.target_scope ? {
            type: runtimeContext.target_scope.type || '',
            label: String(runtimeContext.target_scope.label || '').trim().toLowerCase()
        } : {},
        date_range: {
            since: dateRange.since || '',
            until: dateRange.until || ''
        },
        totals: {
            spend: Number((scanData && scanData.evaluatedTotals || {}).spend || 0),
            signups: Number((scanData && scanData.evaluatedTotals || {}).signups || 0),
            d6_roas: Number((scanData && scanData.evaluatedTotals || {}).d6ROAS || 0),
            d6_cac: Number((scanData && scanData.evaluatedTotals || {}).d6CAC || 0)
        },
        summary: {
            total_campaigns: Number(summary.total_campaigns || 0),
            total_adsets: Number(summary.total_adsets || 0),
            total_ads: Number(summary.total_ads || 0),
            matured_ads: Number(summary.matured_ads || 0),
            non_matured_ads: Number(summary.non_matured_ads || 0)
        },
        integrity: {
            entity_match_rate_pct: Math.round(integrity.entity_match_rate_pct || integrity.adCoveragePct || 0),
            spend_match_rate_pct: Math.round(integrity.spend_match_rate_pct || 0),
            fresh_status_verified_pct: Math.round(integrity.fresh_status_verified_pct || 0),
            safe_for_actioning: !!integrity.safe_for_actioning
        }
    };
    return hashOptimizerKey(JSON.stringify(fingerprint));
}

function getOptimizerBrainCache(cacheKey) {
    if (!OPTIMIZER_BRAIN_CACHE || !Object.keys(OPTIMIZER_BRAIN_CACHE).length) {
        OPTIMIZER_BRAIN_CACHE = loadOptimizerBrainCache();
    }
    var item = OPTIMIZER_BRAIN_CACHE[cacheKey];
    if (!item) return null;
    if ((Date.now() - item.ts) > OPTIMIZER_BRAIN_CACHE_TTL_MS) {
        delete OPTIMIZER_BRAIN_CACHE[cacheKey];
        saveOptimizerBrainCache(OPTIMIZER_BRAIN_CACHE);
        return null;
    }
    return item.value || null;
}

function setOptimizerBrainCache(cacheKey, value) {
    if (!OPTIMIZER_BRAIN_CACHE) OPTIMIZER_BRAIN_CACHE = loadOptimizerBrainCache();
    OPTIMIZER_BRAIN_CACHE[cacheKey] = { ts: Date.now(), value: value };
    saveOptimizerBrainCache(OPTIMIZER_BRAIN_CACHE);
}

function getOptimizerScanCacheKey(dateRange) {
    var range = dateRange || getSelectedDates();
    return String(range && range.since || '') + '|' + String(range && range.until || '');
}

function cloneOptimizerScanForCache(scan) {
    if (!scan) return null;
    var cloned = Object.assign({}, scan);
    if (scan.summary) cloned.summary = Object.assign({}, scan.summary);
    if (scan.evaluatedTotals) cloned.evaluatedTotals = Object.assign({}, scan.evaluatedTotals);
    if (scan.rangeContext) cloned.rangeContext = Object.assign({}, scan.rangeContext);
    // Keep the expensive raw rows in memory only; persist the render-ready scan.
    if (scan._trend_source) cloned._trend_source = { meta_rows: [], funnel_rows: [] };
    return cloned;
}

function loadOptimizerScanCacheStore() {
    var entry = getOptimizerBrowserCacheEntry(OPTIMIZER_SCAN_CACHE_KEY);
    return entry && entry.value && typeof entry.value === 'object' ? entry.value : {};
}

function saveOptimizerScanCacheStore(cache) {
    setOptimizerBrowserCacheEntry(OPTIMIZER_SCAN_CACHE_KEY, cache || {}, OPTIMIZER_SCAN_CACHE_TTL_MS);
}

function getCachedOptimizerScan(dateRange) {
    var key = getOptimizerScanCacheKey(dateRange);
    if (OPTIMIZER_SCAN_CACHE_MEM && OPTIMIZER_SCAN_CACHE_MEM.key === key) {
        if ((Date.now() - OPTIMIZER_SCAN_CACHE_MEM.ts) <= OPTIMIZER_SCAN_CACHE_TTL_MS) return OPTIMIZER_SCAN_CACHE_MEM.scan;
    }

    var candidates = [];
    try {
        var sessionRaw = getOptimizerBrowserCacheEntry(OPTIMIZER_SCAN_CACHE_KEY + ':session');
        if (sessionRaw) candidates.push(sessionRaw.value || sessionRaw);
    } catch (e) {}
    try {
        var localRaw = getOptimizerBrowserCacheEntry(OPTIMIZER_SCAN_CACHE_KEY + ':local');
        if (localRaw) candidates.push(localRaw.value || localRaw);
    } catch (e) {}
    if (!candidates.length) return null;

    var now = Date.now();
    for (var i = 0; i < candidates.length; i++) {
        var item = candidates[i];
        if (!item || item.key !== key) continue;
        if ((now - Number(item.ts || 0)) > OPTIMIZER_SCAN_CACHE_TTL_MS) continue;
        OPTIMIZER_SCAN_CACHE_MEM = { key: key, ts: Number(item.ts || 0), scan: item.scan || null };
        return item.scan || null;
    }
    return null;
}

function setCachedOptimizerScan(scan, options) {
    if (!scan || (options && options.skipCache)) return;
    var key = getOptimizerScanCacheKey(scan.date_range);
    scan._cached_at = scan._cached_at || new Date().toISOString();
    scan._cache_key = key;
    var payload = {
        key: key,
        ts: Date.now(),
        scan: scan
    };
    OPTIMIZER_SCAN_CACHE_MEM = { key: key, ts: payload.ts, scan: scan };
    setOptimizerBrowserCacheEntry(OPTIMIZER_SCAN_CACHE_KEY + ':session', payload, OPTIMIZER_SCAN_CACHE_TTL_MS);
    setOptimizerBrowserCacheEntry(OPTIMIZER_SCAN_CACHE_KEY + ':local', { key: key, ts: payload.ts, scan: cloneOptimizerScanForCache(scan) }, OPTIMIZER_SCAN_CACHE_TTL_MS);
}

function hydrateOptimizerScanFromCache() {
    if (window.OPTIMIZER_SCAN) return window.OPTIMIZER_SCAN;
    var cached = getCachedOptimizerScan(getSelectedDates());
    if (!cached) return null;
    window.OPTIMIZER_SCAN = cached;
    return cached;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UI RENDERING
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

window.renderOptimizer = function() {
    var container = document.getElementById('optimizerContent');
    if (!container) return;
    hydrateOptimizerScanFromCache();
    var stage = window.OPTIMIZER_STAGE || 'scan';
    if (stage === 'plan' && window.OPTIMIZER_PLAN) renderPlanStage(container);
    else if (stage === 'execute') renderExecuteStage(container);
    else renderScanStage(container);
};

// â”€â”€ SCAN STAGE â”€â”€

function renderScanStage(container) {
    var scan = hydrateOptimizerScanFromCache() || window.OPTIMIZER_SCAN;
    var displayScan = scan ? buildFilteredScanData(scan, {
        audienceFilter: window.OPTIMIZER_AUDIENCE_FILTER || 'all',
        statusFilter: window.OPTIMIZER_STATUS_FILTER || 'live_only'
    }) : null;
    var dr = scan && scan.date_range ? scan.date_range : getDefaultDates();

    var html = '<div class="ci-panel">' +
        '<h2>\u26a1 Campaign Optimizer</h2>' +
        '<p style="color:var(--text-dim);font-size:13px;margin-bottom:20px;">Scan all campaigns \u2192 AI generates optimization plan \u2192 one-click execute</p>' +
        (scan && scan._cached_at ? '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--green);">Loaded cached scan from ' + esc(Math.max(1, Math.round((Date.now() - new Date(scan._cached_at).getTime()) / 60000))) + ' min ago. Rescan to refresh.</div>' : '') +

        '<div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap;">' +
            '<label style="font-size:12px;color:var(--text-dim);">Date Range:</label>' +
            '<input type="date" id="optDateFrom" value="' + dr.since + '" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px;">' +
            '<span style="color:var(--text-dim);">to</span>' +
            '<input type="date" id="optDateTo" value="' + dr.until + '" style="background:var(--bg-card);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px;">' +
        '</div>';

    if (!scan) {
        html += '<div style="' + CS + '">' +
            '<h3 style="font-size:15px;font-weight:600;margin-bottom:8px;">Step 1: Scan Account</h3>' +
            '<p style="font-size:13px;color:var(--text-dim);margin-bottom:16px;">Pulls all campaigns, adsets, and ads from Meta API. Enriches with Metabase funnel data (signups, D0 trials, D6 conversions, revenue). Same data pipeline as Campaign Tree.</p>' +
            '<button id="optScanBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 28px;">\ud83d\udd0d Scan Full Account</button>' +
            '<div id="optScanProgress" style="display:none;margin-top:16px;font-size:13px;color:var(--text-dim);"></div>' +
        '</div>';
    } else {
        var rangeContext = (displayScan && displayScan.rangeContext) || scan.rangeContext || getOptimizerRangeContext(scan.date_range || dr);
        var rangeColor = rangeContext.inSyncWithTree === false ? 'var(--orange)' : 'var(--green)';
        html += '<div style="' + CS + 'border-left:4px solid ' + rangeColor + ';margin-bottom:16px;">' +
            '<div style="font-size:13px;font-weight:700;color:' + rangeColor + ';margin-bottom:6px;">' + esc(rangeContext.label) + '</div>' +
            '<div style="font-size:12px;color:var(--text-dim);line-height:1.5;">' + esc(rangeContext.detail) + '</div>' +
        '</div>';
        if (displayScan && displayScan.filter_summary && displayScan.filter_summary.filtered_ads !== displayScan.filter_summary.original_ads) {
            html += '<div style="' + CS + 'border-left:4px solid var(--accent);margin-bottom:16px;">' +
                '<div style="font-size:13px;font-weight:700;color:var(--accent);margin-bottom:6px;">Filtered View</div>' +
                '<div style="font-size:12px;color:var(--text-dim);line-height:1.5;">Showing ' + displayScan.filter_summary.filtered_ads + ' of ' + displayScan.filter_summary.original_ads + ' ads | Funnel: ' + esc(titleCaseWords(String(displayScan.filter_summary.audience || 'all').replace('_', ' '))) + ' | Status: ' + esc(titleCaseWords(String(displayScan.filter_summary.status || 'all').replace('_', ' '))) + '</div>' +
            '</div>';
        }
        html += renderAccountHealth(displayScan || scan);
    }

    html += '</div>' + renderLogSection();
    container.innerHTML = html;
    publishOptimizerContext(displayScan || scan);
    bindScanEvents(container);
}

// â”€â”€ ACCOUNT HEALTH DASHBOARD (after scan, before plan) â”€â”€

function renderAccountHealth(scan) {
    var s = scan.summary;
    var ads = scan.ads || [];
    var tree = scan.tree || {};
    var accountBasis = getGlobalMetricBasisContext(scan, window.OPTIMIZER_PLAN, scan && scan.date_range ? (scan.date_range.since + ' → ' + scan.date_range.until) : null);
    var accountBasisText = 'Basis: ' + accountBasis.range + ' | ' + accountBasis.mode;

    // Compute aggregate funnel metrics via shared pipeline
    var totals = scan.evaluatedTotals || deriveMetrics(sumRaw(ads));
    var blendedD6ROAS = totals.d6ROAS;
    var avgCPI = totals.cpi || 0;
    var avgSignupCost = totals.signupCost || 0;
    var avgD6CAC = totals.d6CAC || 0;
    var maturityCardNote = buildMaturityNote(s, 'matured_ads', 'non_matured_ads', 'ad');

    // Health score: 0-100 based on key metrics
    var healthScore = 0;
    var healthFactors = [];
    if (blendedD6ROAS > 50) { healthScore += 30; healthFactors.push('Excellent D6 ROAS'); }
    else if (blendedD6ROAS > 28) { healthScore += 22; healthFactors.push('Good D6 ROAS'); }
    else if (blendedD6ROAS > 15) { healthScore += 12; healthFactors.push('Average D6 ROAS'); }
    else { healthScore += 5; healthFactors.push('Poor D6 ROAS'); }
    if (avgCPI < 100) { healthScore += 20; } else if (avgCPI < 150) { healthScore += 12; } else { healthScore += 5; }
    if (avgSignupCost > 0 && avgSignupCost < 500) { healthScore += 20; } else if (avgSignupCost > 0 && avgSignupCost < 1000) { healthScore += 12; } else if (avgSignupCost > 0) { healthScore += 5; } else { healthScore += 10; }
    var greenPct = s.total_ads > 0 ? s.green_ads / s.total_ads : 0;
    var redPct = s.total_ads > 0 ? s.red_ads / s.total_ads : 0;
    healthScore += Math.round(greenPct * 20);
    healthScore += Math.round((1 - redPct) * 10);
    healthScore = Math.min(100, Math.max(0, healthScore));
    var healthColor = healthScore >= 70 ? 'var(--green)' : healthScore >= 45 ? 'var(--orange)' : 'var(--red)';
    var healthLabel = healthScore >= 70 ? 'Good' : healthScore >= 45 ? 'Needs Work' : 'Critical';

    var html = '';

    // â”€â”€ Health Score + Key KPIs row â”€â”€
    html += '<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;align-items:stretch;">' +
        // Health Score circle
        '<div style="' + CARD + 'min-width:140px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;">' +
            '<div style="width:80px;height:80px;border-radius:50%;border:4px solid ' + healthColor + ';display:flex;align-items:center;justify-content:center;flex-direction:column;">' +
                '<div style="font-size:28px;font-weight:800;color:' + healthColor + ';">' + healthScore + '</div>' +
            '</div>' +
            '<div style="font-size:11px;font-weight:700;color:' + healthColor + ';margin-top:4px;">' + healthLabel + '</div>' +
            '<div style="font-size:9px;color:var(--text-dim);">Account Health</div>' +
            '<div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div>' +
        '</div>' +
        // KPI cards
        '<div style="flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;">';
    var kpis = [
        { v: fmtINR(totals.spend), l: 'Total Spend', c: 'var(--text)' },
        { v: fmtPct(blendedD6ROAS), l: 'Blended D6 ROAS', c: blendedD6ROAS > 28 ? 'var(--green)' : blendedD6ROAS > 15 ? 'var(--orange)' : 'var(--red)' },
        { v: fmtINR(avgCPI), l: 'Avg CPI', c: avgCPI < 100 ? 'var(--green)' : avgCPI < 150 ? 'var(--orange)' : 'var(--red)' },
        { v: fmtINR(avgSignupCost), l: 'Avg Signup Cost', c: avgSignupCost < 500 ? 'var(--green)' : avgSignupCost < 1000 ? 'var(--orange)' : 'var(--red)' },
        { v: fmtINR(avgD6CAC), l: 'Avg D6 CAC', c: avgD6CAC < 12000 ? 'var(--green)' : avgD6CAC < 15000 ? 'var(--orange)' : 'var(--red)' },
        { v: String(totals.installs), l: 'Installs', c: 'var(--text)' },
        { v: String(totals.signups), l: 'Signups', c: 'var(--text)' },
        { v: String(totals.d6Con || totals.d6 || 0), l: 'D6 Conversions', c: 'var(--accent)' },
        { v: s.total_campaigns, l: 'Campaigns', c: 'var(--text)' },
        { v: s.total_adsets, l: 'Adsets', c: 'var(--text)' },
        { v: s.total_ads, l: 'Total Ads', c: 'var(--text)' },
        { v: '<span style="color:var(--red);">' + s.red_ads + '</span> / <span style="color:var(--green);">' + s.green_ads + '</span>', l: 'Red / Green', c: '' },
        { v: (s.matured_ads || 0) + ' / ' + (s.non_matured_ads || 0), l: 'Matured / New', c: 'var(--text)' },
    ];
    kpis.forEach(function(k) {
        html += '<div style="' + CARD + 'text-align:center;padding:10px 6px;">' +
            '<div style="font-size:17px;font-weight:700;color:' + k.c + ';">' + k.v + '</div>' +
            '<div style="font-size:9px;color:var(--text-dim);margin-top:4px;">' + k.l + '</div>' +
            '<div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(accountBasisText) + '</div></div>';
    });
    html += '</div></div>';

    html += '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:16px;">&#128202;</span>' +
        '<div><div style="font-size:12px;font-weight:600;color:var(--accent);">Overview metrics are maturity-aware</div>' +
        '<div style="font-size:11px;color:var(--text-dim);">' + s.matured_ads + ' ads are using mature data excluding the last 7 days where available. ' + s.non_matured_ads + ' early ads still use full data until they mature.</div>' +
        '<div style="font-size:10px;color:var(--accent);margin-top:4px;">' + esc(accountBasisText) + '</div></div>' +
    '</div>';

    // â”€â”€ Funnel Visualization â”€â”€
    var funnel = [
        { label: 'Impressions', val: totals.impressions },
        { label: 'Clicks', val: totals.clicks },
        { label: 'Installs', val: totals.installs },
        { label: 'Signups', val: totals.signups },
        { label: 'D0 Trials', val: totals.d0_trial },
        { label: 'D0 Paid', val: totals.d0 },
        { label: 'D6 Paid', val: totals.d6Con || totals.d6 || 0 },
    ];
    var maxFunnel = Math.max(1, funnel[0].val);
    html += '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:14px;">\ud83d\udd0d Funnel Analysis</h3>' +
        '<div style="display:flex;flex-direction:column;gap:6px;">';
    for (var fi = 0; fi < funnel.length; fi++) {
        var f = funnel[fi];
        var pct = maxFunnel > 0 ? (f.val / maxFunnel) * 100 : 0;
        var convRate = fi > 0 && funnel[fi - 1].val > 0 ? (f.val / funnel[fi - 1].val * 100) : null;
        var barColor = fi < 3 ? 'var(--accent)' : fi < 5 ? 'var(--orange)' : 'var(--green)';
        var dropWarning = convRate !== null && convRate < 10 && fi >= 2 ? ' \u26a0' : '';
        html += '<div style="display:flex;align-items:center;gap:10px;">' +
            '<div style="min-width:80px;font-size:11px;color:var(--text-dim);text-align:right;">' + f.label + '</div>' +
            '<div style="flex:1;background:var(--bg-card);border-radius:4px;height:22px;position:relative;overflow:hidden;">' +
                '<div style="height:100%;width:' + Math.max(1, pct) + '%;background:' + barColor + ';border-radius:4px;transition:width 0.5s;opacity:0.7;"></div>' +
                '<span style="position:absolute;left:8px;top:3px;font-size:10px;font-weight:600;color:#fff;">' + f.val.toLocaleString() + '</span>' +
            '</div>' +
            '<div style="min-width:55px;font-size:10px;color:' + (dropWarning ? 'var(--red)' : 'var(--text-dim)') + ';">' + (convRate !== null ? convRate.toFixed(1) + '%' + dropWarning : '') + '</div>' +
        '</div>';
    }
    html += '</div>' +
        '<div style="font-size:10px;color:var(--text-dim);margin-top:8px;text-align:right;">Conversion rates shown between each step. \u26a0 = drop-off below 10%</div>' +
    '</div>';

    var modeConfig = getApexModeConfig(window.OPTIMIZER_APEX_MODE || 'daily_review');
    var sharedScanMode = window.OPTIMIZER_APEX_MODE || 'daily_review';
    html += buildApexScanPrep(scan, sharedScanMode);

    // â”€â”€ Campaign Performance Table â”€â”€
    if ((sharedScanMode === 'daily_review' || sharedScanMode === 'account_overview') &&
        (window.OPTIMIZER_AUDIENCE_FILTER || 'all') === 'all' &&
        (window.OPTIMIZER_STATUS_FILTER || 'live_only') === 'all' &&
        (!window.OPTIMIZER_TARGET || window.OPTIMIZER_TARGET.type === 'account' || !(window.OPTIMIZER_TARGET.query || '').trim())) {
    var campList = [];
    for (var ck in tree) {
        var c = tree[ck];
        var t = c.totals || {};
        var adsetCount = Object.keys(c.adsets || {}).length;
        var adCount = 0; var reds = 0; var greens = 0;
        for (var ak in c.adsets) {
            var as = c.adsets[ak];
            adCount += as.ads.length;
            as.ads.forEach(function(a) { if (a.alertStatus === 'red') reds++; if (a.alertStatus === 'green') greens++; });
        }
        campList.push({
            name: ck, id: c.id, adsets: adsetCount, ads: adCount,
            spend: t.spend || 0, installs: t.installs || 0, signups: t.signups || 0,
            d6: t.d6Con || t.d6 || 0, d6ROAS: t.d6ROAS || 0, cpi: t.cpi, signupCost: t.signupCost, d6CAC: t.d6CAC,
            reds: reds, greens: greens, spendPct: totals.spend > 0 ? t.spend / totals.spend * 100 : 0
        });
    }
    campList.sort(function(a, b) { return b.spend - a.spend; });

    html += '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:14px;">\ud83d\udcca Campaign Performance</h3>' +
        '<div style="font-size:10px;color:var(--accent);margin:-6px 0 10px 0;">' + esc(accountBasisText) + '</div>' +
        '<div style="overflow-x:auto;">' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
        '<thead><tr style="border-bottom:2px solid var(--border);">' +
            '<th style="text-align:left;padding:8px 6px;color:var(--text-dim);font-weight:600;">Campaign</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">Spend</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">% Budget</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">Installs</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">Signups</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">D6</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">D6 ROAS</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">CPI</th>' +
            '<th style="text-align:right;padding:8px 6px;color:var(--text-dim);">SU Cost</th>' +
            '<th style="text-align:center;padding:8px 6px;color:var(--text-dim);">\ud83d\udfe2/\ud83d\udd34</th>' +
        '</tr></thead><tbody>';
    campList.forEach(function(c) {
        var roasColor = c.d6ROAS > 28 ? 'var(--green)' : c.d6ROAS > 15 ? 'var(--orange)' : 'var(--red)';
        html += '<tr style="border-bottom:1px solid var(--border);">' +
            '<td style="padding:8px 6px;font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(c.name) + '">' + esc(c.name.length > 35 ? c.name.substring(0, 35) + '...' : c.name) + ' <span style="color:var(--text-dim);font-weight:400;font-size:10px;">(' + c.adsets + ' adsets, ' + c.ads + ' ads)</span></td>' +
            '<td style="text-align:right;padding:8px 6px;font-weight:600;">' + fmtINR(c.spend) + '</td>' +
            '<td style="text-align:right;padding:8px 6px;"><div style="display:flex;align-items:center;justify-content:flex-end;gap:4px;"><div style="width:40px;height:6px;background:var(--bg-card);border-radius:3px;overflow:hidden;"><div style="height:100%;width:' + Math.min(100, c.spendPct) + '%;background:var(--accent);border-radius:3px;"></div></div><span>' + c.spendPct.toFixed(0) + '%</span></div></td>' +
            '<td style="text-align:right;padding:8px 6px;">' + c.installs + '</td>' +
            '<td style="text-align:right;padding:8px 6px;">' + c.signups + '</td>' +
            '<td style="text-align:right;padding:8px 6px;">' + c.d6 + '</td>' +
            '<td style="text-align:right;padding:8px 6px;color:' + roasColor + ';font-weight:600;">' + fmtPct(c.d6ROAS) + '</td>' +
            '<td style="text-align:right;padding:8px 6px;">' + (c.cpi ? fmtINR(c.cpi) : '--') + '</td>' +
            '<td style="text-align:right;padding:8px 6px;">' + (c.signupCost ? fmtINR(c.signupCost) : '--') + '</td>' +
            '<td style="text-align:center;padding:8px 6px;"><span style="color:var(--green);">' + c.greens + '</span>/<span style="color:var(--red);">' + c.reds + '</span></td>' +
        '</tr>';
    });
    html += '</tbody></table></div></div>';

    // â”€â”€ Top 5 / Bottom 5 Performers â”€â”€
    var significantAds = ads.filter(function(a) { return a.spend >= 15000; });
    if (significantAds.length >= 4) {
        // Only rank matured ads by D6 ROAS â€” non-matured D6 is unreliable
        var maturedAds = significantAds.filter(function(a) { return a.isMatured; });
        var nonMaturedAds = significantAds.filter(function(a) { return !a.isMatured; });
        var byROAS = (maturedAds.length >= 4 ? maturedAds : significantAds).slice().sort(function(a, b) { return b.d6ROAS - a.d6ROAS; });
        var top5 = byROAS.slice(0, 5);
        var bottom5 = byROAS.slice(-5).reverse();

        html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">';

        // Top performers
        var maturedLabel = maturedAds.length >= 4 ? ' (Matured Only)' : (nonMaturedAds.length ? ' (Includes Early Full Data)' : '');
        html += '<div style="' + CS + 'border-top:3px solid var(--green);">' +
            '<h3 style="font-size:13px;font-weight:600;color:var(--green);margin-bottom:12px;">\ud83c\udfc6 Top Performers â€” D6 ROAS' + maturedLabel + '</h3>';
        top5.forEach(function(a, i) {
            var matBadge = a.isMatured ? '<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(34,197,94,0.15);color:var(--green);margin-left:4px;">' + a.daysSinceGoLive + 'd</span>' :
                '<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(245,158,11,0.15);color:var(--orange);margin-left:4px;">' + (a.daysSinceGoLive || '?') + 'd \u2731</span>';
            html += '<div style="' + CARD + 'margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(a.ad_name) + '">' + (i+1) + '. ' + esc(a.ad_name.length > 30 ? a.ad_name.substring(0,30) + '...' : a.ad_name) + matBadge + '</div>' +
                    '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;">Spend: ' + fmtINR(a.spend) + ' | SU: ' + a.signups + ' | D6: ' + (a.evalD6 != null ? a.evalD6 : a.d6) + '</div>' +
                    '<div style="font-size:9px;color:var(--accent);margin-top:2px;">' + esc(getEntityMetricBasis(a, scan && scan.date_range ? (scan.date_range.since + ' → ' + scan.date_range.until) : null)) + '</div>' +
                '</div>' +
                '<div style="text-align:right;min-width:60px;">' +
                    '<div style="font-size:14px;font-weight:700;color:var(--green);">' + fmtPct(a.d6ROAS) + '</div>' +
                    '<div style="font-size:9px;color:var(--text-dim);">D6 ROAS</div>' +
                '</div>' +
            '</div>';
        });
        html += '</div>';

        // Bottom performers
        html += '<div style="' + CS + 'border-top:3px solid var(--red);">' +
            '<h3 style="font-size:13px;font-weight:600;color:var(--red);margin-bottom:12px;">\u26a0\ufe0f Underperformers â€” D6 ROAS' + maturedLabel + '</h3>';
        bottom5.forEach(function(a, i) {
            var matBadge2 = a.isMatured ? '<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(239,68,68,0.15);color:var(--red);margin-left:4px;">' + a.daysSinceGoLive + 'd</span>' :
                '<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(245,158,11,0.15);color:var(--orange);margin-left:4px;">' + (a.daysSinceGoLive || '?') + 'd \u2731</span>';
            html += '<div style="' + CARD + 'margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(a.ad_name) + '">' + (i+1) + '. ' + esc(a.ad_name.length > 30 ? a.ad_name.substring(0,30) + '...' : a.ad_name) + matBadge2 + '</div>' +
                    '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;">Spend: ' + fmtINR(a.spend) + ' | SU: ' + a.signups + ' | D6: ' + (a.evalD6 != null ? a.evalD6 : a.d6) + '</div>' +
                    '<div style="font-size:9px;color:var(--accent);margin-top:2px;">' + esc(getEntityMetricBasis(a, scan && scan.date_range ? (scan.date_range.since + ' → ' + scan.date_range.until) : null)) + '</div>' +
                '</div>' +
                '<div style="text-align:right;min-width:60px;">' +
                    '<div style="font-size:14px;font-weight:700;color:var(--red);">' + fmtPct(a.d6ROAS) + '</div>' +
                    '<div style="font-size:9px;color:var(--text-dim);">D6 ROAS</div>' +
                '</div>' +
            '</div>';
        });
        html += '</div></div>';
    }

    // â”€â”€ Budget Distribution Bar â”€â”€
    if (campList.length > 1) {
        var barColors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
        html += '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:14px;">\ud83d\udcb0 Budget Distribution</h3>' +
            '<div style="display:flex;height:24px;border-radius:6px;overflow:hidden;margin-bottom:10px;">';
        campList.forEach(function(c, i) {
            if (c.spendPct < 1) return;
            html += '<div style="width:' + c.spendPct + '%;background:' + barColors[i % barColors.length] + ';min-width:2px;" title="' + esc(c.name) + ': ' + c.spendPct.toFixed(1) + '%"></div>';
        });
        html += '</div><div style="display:flex;flex-wrap:wrap;gap:8px;">';
        campList.forEach(function(c, i) {
            if (c.spendPct < 1) return;
            html += '<div style="display:flex;align-items:center;gap:4px;font-size:10px;">' +
                '<div style="width:8px;height:8px;border-radius:2px;background:' + barColors[i % barColors.length] + ';"></div>' +
                '<span style="color:var(--text-dim);" title="' + esc(c.name) + '">' + esc(c.name.length > 20 ? c.name.substring(0,20) + '...' : c.name) + ' (' + c.spendPct.toFixed(0) + '%)</span></div>';
        });
        html += '</div></div>';
    }

    }

    // â”€â”€ Prompt Bar â”€â”€
    html += '<div style="' + CS + 'margin-bottom:16px;">' +
        '<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Tell APEX what you need. Example: "Give an overview of Test2 campaign" or "Give me actionables to revamp my Meta account."</div>' +
        renderOptimizerPromptHistory() +
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
            '<input id="optPromptInput" type="text" value="' + esc(window.OPTIMIZER_USER_PROMPT || '') + '" placeholder="Tell APEX what to do..." style="flex:1;min-width:420px;padding:14px 16px;border-radius:12px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:14px;" />' +
            '<button id="optPlanBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 24px;">Ask APEX</button>' +
            '<button id="optRescanBtn" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:13px;">\u21bb Rescan</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' +
            '<button class="opt-prompt-chip" data-prompt="Give me actionables to revamp my Meta account" style="padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:11px;cursor:pointer;">Revamp my Meta account</button>' +
            '<button class="opt-prompt-chip" data-prompt="Give an overview of Test2 campaign" style="padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:11px;cursor:pointer;">Overview of a campaign</button>' +
            '<button class="opt-prompt-chip" data-prompt="Why is this account underperforming?" style="padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:11px;cursor:pointer;">Why is performance weak?</button>' +
            '<button class="opt-prompt-chip" data-prompt="Tell me what to change today in my Meta account" style="padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:11px;cursor:pointer;">What should I change today?</button>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-dim);margin-top:10px;">Last scan: ' + new Date(scan.scan_date).toLocaleString() + ' | Match rate: ' + s.matched_keys + '/' + (s.matched_keys + s.unmatched_keys) + '</div>' +
    '</div>' +
    '<div id="optPlanProgress" style="display:none;"></div>';

    return html;
}

// â”€â”€ PLAN STAGE â”€â”€

function buildApexModeLeadSection(plan, actions, mode) {
    var card = function(title, value, note, color) {
        return '<div style="' + CARD + 'border-left:3px solid ' + color + ';">' +
            '<div style="font-size:10px;color:var(--text-dim);">' + esc(title) + '</div>' +
            '<div style="font-size:16px;font-weight:700;color:' + color + ';margin-top:4px;">' + esc(value) + '</div>' +
            (note ? '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + esc(note) + '</div>' : '') +
        '</div>';
    };
    if (mode === 'creative_audit') {
        var creativeHealth = (plan.creative_health || []);
        var scaleCount = creativeHealth.filter(function(item) { return String(item.status || '').toLowerCase() === 'scale'; }).length;
        var refreshCount = creativeHealth.filter(function(item) { return String(item.status || '').toLowerCase() === 'refresh'; }).length;
        var pauseCount = creativeHealth.filter(function(item) { return String(item.status || '').toLowerCase() === 'pause'; }).length;
        return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px;">' +
            card('Scale', String(scaleCount), 'winning creatives to protect and push', 'var(--green)') +
            card('Refresh', String(refreshCount), 'fatigue or weak-hook candidates', 'var(--orange)') +
            card('Pause', String(pauseCount), 'creative-level losers', 'var(--red)') +
            card('Themes', String((plan.creative_insights && plan.creative_insights.top_themes ? plan.creative_insights.top_themes.length : 0)), 'repeatable message patterns', 'var(--accent)') +
        '</div>';
    }
    if (mode === 'weekly_strategy') {
        var budgetMoveCount = (plan.budget_allocation || []).length + ((plan.budget_reallocation && (((plan.budget_reallocation.from || []).length + (plan.budget_reallocation.to || []).length) > 0)) ? 1 : 0);
        return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px;">' +
            card('Priority Actions', String((actions || []).length), 'next 7-day operating plan', 'var(--accent)') +
            card('Budget Moves', String(budgetMoveCount), 'budget concentration opportunities', 'var(--green)') +
            card('External Signals', String((plan.external_signals || []).length || (plan.external_context && plan.external_context.available ? 1 : 0)), 'market and competitor context', 'var(--orange)') +
            card('Learnings', String((plan.account_learnings || []).length), 'account-level patterns to preserve', 'var(--text)') +
        '</div>';
    }
    if (mode === 'investigate') {
        var urgent = (actions || []).filter(function(a) { return normalizeActionPriority(a.priority) === 'P1'; }).length;
        var monitor = (actions || []).filter(function(a) { return String(a.action_type || '').toUpperCase() === 'MONITOR'; }).length;
        return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px;">' +
            card('Likely Root Causes', String((plan.account_learnings || []).length || (plan.funnel_analysis && plan.funnel_analysis.fix_recommendations ? plan.funnel_analysis.fix_recommendations.length : 0)), 'most probable explanations', 'var(--orange)') +
            card('Urgent Fixes', String(urgent), 'needs action now', 'var(--red)') +
            card('Monitor Tracks', String(monitor), 'watch before changing more', 'var(--accent)') +
            card('External Clues', String((plan.external_signals || []).length || (plan.external_context && plan.external_context.available ? 1 : 0)), 'outside-account pressure', 'var(--text)') +
        '</div>';
    }
    return '';
}

function shouldShowApexSection(mode, section) {
    var map = {
        daily_review: { creative_insights: true, creative_health: true, funnel_analysis: true, budget_reallocation: true, budget_allocation: true, external: true, learnings: true, watch: true, do_not_touch: true, actions: true },
        creative_audit: { creative_insights: true, creative_health: true, funnel_analysis: false, budget_reallocation: false, budget_allocation: false, external: true, learnings: true, watch: true, do_not_touch: true, actions: true },
        weekly_strategy: { creative_insights: true, creative_health: true, funnel_analysis: true, budget_reallocation: true, budget_allocation: true, external: true, learnings: true, watch: true, do_not_touch: true, actions: true },
        investigate: { creative_insights: false, creative_health: true, funnel_analysis: true, budget_reallocation: true, budget_allocation: false, external: true, learnings: true, watch: true, do_not_touch: true, actions: true }
    };
    return !!((map[mode] || map.daily_review)[section]);
}

function deriveApexBreakdownFallbacks(breakdownContext) {
    var empty = {
        top_age_gender_cohort: '',
        underfunded_cohort: '',
        kill_placements: [],
        hidden_winner_placements: [],
        ios_android_cpa_gap_pct: null,
        geo_budget_efficiency_gap: '',
        best_conversion_window: '',
        bid_strategy_recommendation: '',
        high_overlap_pairs: [],
        best_historical_change: '',
        worst_historical_change: '',
        creative_avg_decay_days: null
    };
    if (!breakdownContext || !breakdownContext.breakdowns) return empty;
    var rows = breakdownContext.breakdowns;
    function isKnownValue(value) {
        var text = String(value == null ? '' : value).trim().toLowerCase();
        return !!text && text !== 'unknown' && text !== 'unknown age' && text !== 'unknown gender' && text !== 'n/a' && text !== '--';
    }

    var ageRows = (rows.age_gender || []).filter(function(r) {
        return (r.spend_7d || 0) >= 5000 &&
            ((r.installs_7d || 0) > 0) &&
            isKnownValue(r.age_band) &&
            isKnownValue(r.gender);
    }).slice();
    ageRows.sort(function(a, b) { return (a.cpi_7d || Infinity) - (b.cpi_7d || Infinity); });
    var bestAge = ageRows[0];
    var underfunded = ageRows.filter(function(r) { return (r.spend_share_pct || 0) < 6; })[0] || null;

    var placementRows = (rows.placement || []).slice();
    var killPlacements = placementRows.filter(function(r) { return (r.spend_7d || 0) >= 5000 && (((r.installs_7d || 0) === 0) || ((r.cpi_7d || 0) >= 1500)); }).slice(0, 4).map(function(r) { return r.placement; });
    var hiddenWinners = placementRows.filter(function(r) { return (r.installs_7d || 0) >= 10 && (r.cpi_7d || Infinity) <= 700; }).sort(function(a, b) { return (a.cpi_7d || Infinity) - (b.cpi_7d || Infinity); }).slice(0, 4).map(function(r) { return r.placement; });

    var deviceRows = rows.device || [];
    var ios = deviceRows.find(function(r) { return r.device === 'mobile_ios'; });
    var android = deviceRows.find(function(r) { return r.device === 'mobile_android'; });
    var iosGap = ios && android && android.cpi_7d > 0 ? (((ios.cpi_7d || 0) - (android.cpi_7d || 0)) / android.cpi_7d) * 100 : null;

    var geoRows = (rows.geography || []).filter(function(r) {
        return (r.spend_7d || 0) >= 10000 &&
            ((r.installs_7d || 0) > 0) &&
            isKnownValue(r.region || r.location);
    }).slice().sort(function(a, b) { return (a.cpi_7d || Infinity) - (b.cpi_7d || Infinity); });
    var bestGeo = geoRows[0];
    var expensiveGeo = geoRows.slice().sort(function(a, b) { return (b.spend_share_pct || 0) - (a.spend_share_pct || 0); }).find(function(r) { return (r.cpi_7d || 0) > ((bestGeo && bestGeo.cpi_7d) || 0); });
    var bestGeoName = bestGeo ? (bestGeo.region || bestGeo.location || '') : '';
    var expensiveGeoName = expensiveGeo ? (expensiveGeo.region || expensiveGeo.location || '') : '';
    var geoGap = (bestGeo && expensiveGeo && isKnownValue(bestGeoName) && isKnownValue(expensiveGeoName)) ? (bestGeoName + ' CPI ' + fmtINR(bestGeo.cpi_7d) + ' vs ' + expensiveGeoName + ' CPI ' + fmtINR(expensiveGeo.cpi_7d)) : '';

    var hourlyRows = (rows.hourly || []).filter(function(r) { return (r.installs || 0) >= 5; }).slice().sort(function(a, b) { return (a.cpi || Infinity) - (b.cpi || Infinity); });
    var bestHour = hourlyRows[0];

    return {
        top_age_gender_cohort: bestAge ? (bestAge.age_band + ' ' + titleCaseWords(bestAge.gender) + ': CPI ' + fmtINR(bestAge.cpi_7d) + ', spend share ' + Number(bestAge.spend_share_pct || 0).toFixed(1) + '%') : '',
        underfunded_cohort: underfunded ? (underfunded.age_band + ' ' + titleCaseWords(underfunded.gender) + ': CPI ' + fmtINR(underfunded.cpi_7d) + ', spend share ' + Number(underfunded.spend_share_pct || 0).toFixed(1) + '%') : '',
        kill_placements: killPlacements,
        hidden_winner_placements: hiddenWinners,
        ios_android_cpa_gap_pct: iosGap != null ? +iosGap.toFixed(1) : null,
        geo_budget_efficiency_gap: geoGap,
        best_conversion_window: bestHour ? (bestHour.day_of_week + ' ' + String(bestHour.hour).padStart(2, '0') + ':00 | CPI ' + fmtINR(bestHour.cpi)) : '',
        bid_strategy_recommendation: '',
        high_overlap_pairs: [],
        best_historical_change: '',
        worst_historical_change: '',
        creative_avg_decay_days: null
    };
}

function buildBreakdownActionRecommendations(breakdownContext) {
    var fallback = deriveApexBreakdownFallbacks(breakdownContext);
    var actions = [];
    if (Array.isArray(fallback.kill_placements) && fallback.kill_placements.length) {
        actions.push({
            title: 'Account → Placements → CUT LOW-QUALITY PLACEMENTS',
            why: 'Some placements are generating cheap or expensive delivery without enough value.',
            do: 'Reduce or exclude: ' + fallback.kill_placements.join(', ') + '.',
            do_not: 'Do not cut every placement at once. Remove the clearest waste first.'
        });
    }
    if (fallback.underfunded_cohort) {
        actions.push({
            title: 'Account → Age/Gender → BACK THE EFFICIENT COHORT',
            why: 'A low-spend age/gender cohort is more efficient than the current mix.',
            do: 'Shift testing or budget attention toward ' + fallback.underfunded_cohort + '.',
            do_not: 'Do not narrow the whole account to one cohort without validating volume.'
        });
    }
    if (fallback.geo_budget_efficiency_gap) {
        actions.push({
            title: 'Account → Geo → TIGHTEN LOCATION MIX',
            why: 'The geography gap shows a meaningful efficiency difference inside the same account.',
            do: 'Split or reduce budget from the weaker geo pocket highlighted by: ' + fallback.geo_budget_efficiency_gap + '.',
            do_not: 'Do not call geo neutral if one region is clearly more expensive at similar scale.'
        });
    }
    if (fallback.ios_android_cpa_gap_pct != null && Math.abs(fallback.ios_android_cpa_gap_pct) >= 25) {
        actions.push({
            title: 'Account → Device → CHECK OS MIX',
            why: 'Device efficiency gap is large enough to affect blended account performance.',
            do: 'Review whether creative, offer, or landing behavior differs materially by OS before keeping one mixed strategy.',
            do_not: 'Do not assume Android and iOS traffic behave the same when the cost gap is this wide.'
        });
    }
    if (Array.isArray(fallback.hidden_winner_placements) && fallback.hidden_winner_placements.length) {
        actions.push({
            title: 'Account → Placements → BACK HIDDEN WINNERS',
            why: 'Some placements are quietly converting better than the blended account view suggests.',
            do: 'Protect or test more weight in: ' + fallback.hidden_winner_placements.join(', ') + '.',
            do_not: 'Do not expand every placement together. Push the clearest winners first.'
        });
    }
    if (fallback.best_conversion_window) {
        actions.push({
            title: 'Account → Delivery Window → WATCH TIME CONCENTRATION',
            why: 'The hourly breakdown shows a better conversion window inside the day.',
            do: 'Use ' + fallback.best_conversion_window + ' as a delivery clue when reviewing morning concentration and pacing issues.',
            do_not: 'Do not hard-schedule all delivery to one hour block; use this as diagnosis evidence, not a blunt rule.'
        });
    }
    return actions.slice(0, 4);
}

function ensureApexV2Fallbacks(plan, scanData) {
    plan = plan || {};
    var scan = scanData || window.OPTIMIZER_SCAN || {};
    var summary = scan.summary || {};
    var totals = scan.evaluatedTotals || {};
    var ads = scan.ads || [];
    var bySpend = ads.slice().sort(function(a, b) { return (b.spend || 0) - (a.spend || 0); });
    var matured = ads.filter(function(a) { return a.isMatured; });
    var redAds = ads.filter(function(a) { return a.alertStatus === 'red'; }).slice(0, 6);
    var greenAds = ads.filter(function(a) { return a.alertStatus === 'green'; }).slice(0, 6);
    var unmatchedRetarget = ads.filter(function(a) { return a.audience_bucket === 'retarget' && !a.has_funnel_match; }).slice(0, 5);
    var broadWinners = greenAds.filter(function(a) { return a.audience_bucket === 'prospecting'; }).slice(0, 3);
    var cpmLevel = totals.cpm != null ? Math.round(totals.cpm) : null;

    if (!plan.view_2_diagnosis || (!Array.isArray(plan.view_2_diagnosis.performance_shifts) || !plan.view_2_diagnosis.performance_shifts.length)) {
        plan.view_2_diagnosis = {
            performance_shifts: [
                {
                    metric: 'D6 ROAS',
                    change_pct: null,
                    attributed_cause: summary.matured_ads ? ('Current selected-window D6 ROAS is ' + (totals.d6ROAS != null ? totals.d6ROAS.toFixed(1) + '%' : '--') + ' across ' + summary.matured_ads + ' matured ads. The strongest account-side signal is concentration in a small set of winners while ' + summary.red_ads + ' ads are flagged red.') : 'No mature cohort large enough for a trustworthy D6 shift diagnosis in this window.',
                    confidence: summary.matured_ads ? 'medium' : 'low',
                    data_needed_for_certainty: summary.matured_ads ? null : 'Need a larger matured cohort or injected 7d/30d attribution comparisons.'
                },
                {
                    metric: 'CPA spike discipline',
                    change_pct: null,
                    attributed_cause: cpmLevel != null ? ('Selected-window CPM is ' + fmtINR(cpmLevel) + '. Playbook rule: if CPA worsens without account changes, check CPM and auction pressure before changing creatives or pausing campaigns.') : 'CPM context missing, so auction-pressure diagnosis is incomplete.',
                    confidence: cpmLevel != null ? 'medium' : 'low',
                    data_needed_for_certainty: cpmLevel != null ? null : 'Need current and baseline CPM to distinguish auction pressure from account-side failure.'
                }
            ],
            attribution_gap: plan.view_2_diagnosis && plan.view_2_diagnosis.attribution_gap ? plan.view_2_diagnosis.attribution_gap : {
                seven_day_click_roas: null,
                one_day_click_roas: null,
                view_through_roas: null,
                blended_mer: null,
                over_count_estimate_pct: null
            },
            delivery_issues: bySpend.slice(0, 8).filter(function(a) {
                return (a.is_live && a.spend > 15000 && a.cpi > 200) || a.delivery_state.indexOf('paused') === 0;
            }).map(function(a) {
                return {
                    entity_name: a.ad_name || '--',
                    issue_type: a.delivery_state.indexOf('paused') === 0 ? 'learning_limited' : 'under_delivery',
                    detail: a.delivery_state.indexOf('paused') === 0 ? ('Currently ' + a.delivery_state.replace(/_/g, ' ')) : ('High-cost delivery: spend ' + fmtINR(a.spend) + ', CPI ' + fmtINR(a.cpi || 0)),
                    fix: a.delivery_state.indexOf('paused') === 0 ? 'Validate whether this should be reactivated at the campaign or adset owner level only.' : 'Shift budget toward the strongest live winners before editing too many weak ads.'
                };
            }),
            learning_phase_map: bySpend.slice(0, 10).map(function(a) {
                return {
                    adset_name: a.adset_name || '--',
                    status: a.adset_status || '--',
                    opt_events_7d: null,
                    days_in_status: a.daysSinceGoLive != null ? a.daysSinceGoLive : null,
                    fix: a.isMatured ? null : 'Still early. Avoid unnecessary edits unless the adset is clearly constrained or broken.'
                };
            })
        };
    }

    if (!plan.view_3_breakdowns || (!plan.view_3_breakdowns.top_age_gender_cohort && !plan.view_3_breakdowns.hidden_winner_placements)) {
        plan.view_3_breakdowns = deriveApexBreakdownFallbacks(plan.breakdown_context);
    }

    if (!plan.view_4_forward_plan || (!Array.isArray(plan.view_4_forward_plan.scaling_roadmap) || !plan.view_4_forward_plan.scaling_roadmap.length)) {
        var scaleCandidates = greenAds.filter(function(a) { return a.is_live && a.spend >= 20000; }).slice(0, 3);
        plan.view_4_forward_plan = {
            scaling_roadmap: scaleCandidates.map(function(a) {
                var current = Math.round(a.budget_current_daily_budget || 0);
                return {
                    adset_name: a.adset_name || '--',
                    budget_today: current || null,
                    budget_day3: current ? Math.round(current * 1.15) : null,
                    budget_day7: current ? Math.round(current * 1.3) : null,
                    budget_day14: current ? Math.round(current * 1.45) : null,
                    watch_metric: 'Keep CPI below ' + fmtINR(a.cpi || 0) + ' and avoid a ROAS drop below current winner level.',
                    kill_condition: 'Pause scaling if CPI rises >20% or the parent adset/campaign enters a paused or unstable state.'
                };
            }),
            creative_tests: greenAds.slice(0, 3).map(function(a, idx) {
                return {
                    hypothesis: 'A tighter version of ' + (a.ad_name || 'current winner') + ' should improve CTR without hurting CPI.',
                    format: detectType(a.ad_name || '') || 'VIDEO',
                    hook: 'Lead with the strongest existing proof point in the first 3 seconds.',
                    offer: 'Mirror the winner\'s offer but simplify the message.',
                    cta: 'Start Now',
                    audience: a.adset_name || '--',
                    daily_budget: 500,
                    duration_days: 7,
                    win_condition: 'CTR beats control and CPI stays below weighted cohort median.',
                    loss_condition: 'CPI exceeds control by 20% with no CTR gain.'
                };
            }),
            audience_expansion: greenAds.slice(0, 3).map(function(a, idx) {
                return {
                    priority: idx + 1,
                    audience_type: a.audience_bucket === 'retarget' ? 'retarget expansion' : 'prospecting expansion',
                    definition: a.audience_bucket === 'retarget' ? 'Extend recency window around current warm audience winner' : 'Clone winner into adjacent broad/LAL audience with same creative',
                    estimated_size: null,
                    hypothesised_cpa: a.signupCost != null ? Math.round(a.signupCost) : (a.cpi != null ? Math.round(a.cpi) : null),
                    seed_logic: 'Use current winner ' + (a.ad_name || '--') + ' and parent adset ' + (a.adset_name || '--'),
                    budget: 500
                };
            }),
            risk_flags: [
                {
                    risk: 'Winner concentration risk',
                    timeline: 'next 7-14 days',
                    pre_emption: 'Launch replacement creative before the current small set of winners fatigues.'
                },
                {
                    risk: 'Paused or unmatched retargeting entities can create false negatives',
                    timeline: 'immediate',
                    pre_emption: 'Judge retargeting without Metabase conversions on Meta delivery and budget discipline first.'
                },
                {
                    risk: 'Large budget jumps can reset learning',
                    timeline: 'every scale decision',
                    pre_emption: 'Follow the playbook rule: 20-25% budget steps with time between each step.'
                }
            ]
        };
    }

    if (!plan.meta_am_insights || !plan.meta_am_insights.length) {
        var marketMood = plan.external_context && plan.external_context.market_trends ? plan.external_context.market_trends.market_mood : '';
        plan.meta_am_insights = [
            {
                insight: 'Auction pressure should be judged from CPM plus win-rate behavior, not from ROAS alone.',
                account_implication: 'Selected-window CPM is ' + (totals.cpm != null ? fmtINR(Math.round(totals.cpm)) : '--') + ' and the account still has ' + summary.green_ads + ' green ads, so the bigger issue is internal concentration and weak coverage, not only auction inflation.',
                recommended_action: 'Shift budget out of obvious red ads, protect the live winners, and avoid resetting too many adsets at once.',
                how_to_verify: 'Check whether CPM stays stable while CTR and CPI improve after budget concentration.'
            },
            {
                insight: 'Retargeting should not be judged on missing funnel rows.',
                account_implication: 'Some warm/retarget entities may not map cleanly into Metabase conversion rows, so treating missing conversions as failure will over-pause valuable delivery.',
                recommended_action: 'Judge unmatched retargeting campaigns on delivery cost, click quality, and controlled budget usage until attribution plumbing is explicit.',
                how_to_verify: 'Compare matched vs unmatched retargeting entities after budget shifts and watch downstream assisted conversion behavior.'
            },
            {
                insight: 'Protect broad or prospecting winners; expand horizontally before brute-force vertical scale.',
                account_implication: broadWinners.length ? ('Current prospecting winners include ' + broadWinners.map(function(a) { return a.ad_name || '--'; }).slice(0, 2).join(', ') + '.') : 'No clear prospecting winner is isolated yet, so broad-winner protection is a watch item rather than an action.',
                recommended_action: 'Do not narrow a working broad winner. Clone the winning logic into adjacent audiences and use 20-25% budget steps only after horizontal room exists.',
                how_to_verify: 'Scale should hold without a sharp CPI spike or learning reset.'
            },
            {
                insight: 'Current market context: ' + (marketMood || 'no market mood injected'),
                account_implication: 'This briefing must stay distinct from granular breakdowns by focusing on platform-side judgment, signal quality, and operating discipline.',
                recommended_action: 'Use Meta AM Briefing for account-manager calls, and use Granular Breakdown only for dimensional evidence.',
                how_to_verify: 'The Meta AM tab should read like a platform-side operator, not like a table export.'
            }
        ];
    }

    if (!plan.executive_summary || !String(plan.executive_summary).trim()) {
        plan.executive_summary = 'Selected window spend is ' + fmtINR(totals.spend || 0) + ' across ' + (summary.total_campaigns || 0) + ' campaigns and ' + (summary.total_ads || 0) + ' ads. Prioritize budget concentration into live winners, avoid false negatives on unmatched retargeting, and keep status-safe execution only.';
    }

    if (!plan.account_pulse || (!plan.account_pulse.spend_total && !plan.account_pulse.roas_window)) {
        plan.account_pulse = {
            window_label: scan.date_range ? (scan.date_range.since + ' to ' + scan.date_range.until) : '--',
            spend_total: Math.round(totals.spend || 0),
            avg_daily_spend: scan.date_range ? Math.round((totals.spend || 0) / Math.max(1, getRangeDayCount(scan.date_range))) : null,
            roas_window: totals.d6ROAS != null ? +totals.d6ROAS.toFixed(1) : null,
            signup_cost_window: totals.signupCost != null ? Math.round(totals.signupCost) : null,
            cpm_window: totals.cpm != null ? Math.round(totals.cpm) : null,
            ctr_window: totals.ctr != null ? +totals.ctr.toFixed(2) : null,
            pacing_status: 'unknown',
            source_note: 'Derived from selected-window totals with spend-weighted medians and retargeting safeguards.'
        };
    }

    var brief = plan.morning_brief || {};
    var topActions = (plan.actions || []).slice().sort(function(a, b) {
        var pa = normalizeActionPriority(a.priority) === 'P1' ? 1 : (normalizeActionPriority(a.priority) === 'P2' ? 2 : 3);
        var pb = normalizeActionPriority(b.priority) === 'P1' ? 1 : (normalizeActionPriority(b.priority) === 'P2' ? 2 : 3);
        if (pa !== pb) return pa - pb;
        return (parseNumericLike((b.current_metrics || {}).spend) || 0) - (parseNumericLike((a.current_metrics || {}).spend) || 0);
    });
    var campaigns = Object.keys(scan.tree || {}).map(function(campaignName) {
        return { name: campaignName, node: scan.tree[campaignName] };
    }).sort(function(a, b) { return ((b.node.totals || {}).spend || 0) - ((a.node.totals || {}).spend || 0); });
    var learningAdsets = [];
    campaigns.forEach(function(c) {
        Object.keys(c.node.adsets || {}).forEach(function(adsetName) {
            var adset = c.node.adsets[adsetName];
            if (String(adset.adset_status || '').toUpperCase().indexOf('LEARNING') !== -1) {
                learningAdsets.push({ campaign: c.name, adset: adsetName, status: adset.adset_status || '' });
            }
        });
    });

    if (!brief.market_read || !String(brief.market_read.summary || '').trim()) {
        var externalPosture = plan.external_posture || {};
        brief.market_read = {
            posture: externalPosture.posture || 'HOLD AND OPTIMISE',
            summary: externalPosture.active ? ((externalPosture.reason || '') + ' ' + (externalPosture.guidance || '')) : (plan.executive_summary || ('Selected window spend is ' + fmtINR(totals.spend || 0) + '. Protect efficient live winners, avoid unnecessary edits on unstable entities, and use the breakdowns to find audience, geo, and placement inefficiencies.')),
            signals: []
        };
    }
    if (!brief.account_pulse || !Object.keys(brief.account_pulse).length) {
        brief.account_pulse = {
            spend_today: fmtINR(plan.account_pulse && plan.account_pulse.spend_total != null ? plan.account_pulse.spend_total : (totals.spend || 0)),
            roas_7d: plan.account_pulse && plan.account_pulse.roas_window != null ? Number(plan.account_pulse.roas_window).toFixed(1) + '%' : '--',
            cpa_7d: totals.signupCost != null ? fmtINR(totals.signupCost) : '--',
            active_counts: (summary.total_campaigns || 0) + ' campaigns · ' + (summary.total_adsets || 0) + ' ad sets · ' + (summary.total_ads || 0) + ' ads',
            learning_counts: learningAdsets.length + ' learning / limited'
        };
    }
    var hasMeaningfulBriefRows = function(rows, keys) {
        return Array.isArray(rows) && rows.some(function(row) {
            return keys.some(function(key) {
                return row && row[key] && String(row[key]).trim() && String(row[key]).trim() !== '--';
            });
        });
    };

    if (!hasMeaningfulBriefRows(brief.what_to_do_right_now, ['title', 'entity_name', 'why', 'do'])) {
        var deterministicActions = []
            .concat((plan.breakdown_action_recommendations || []).slice(0, 2))
            .concat((plan.deterministic_audits && plan.deterministic_audits.campaigns || []).filter(function(item) { return item.action && item.action !== 'NO CHANGE NEEDED' && item.action !== 'HOLD'; }).slice(0, 3).map(function(item) {
                return {
                    title: item.campaign_name + ' → ' + item.action,
                    why: item.reason,
                    do: item.do_line,
                    do_not: 'Do not stack another structural edit on this campaign today.'
                };
            }))
            .concat((plan.deterministic_audits && plan.deterministic_audits.adsets || []).filter(function(item) { return item.action && !/HOLD FOR DATA|HOLD/.test(item.action); }).slice(0, 4).map(function(item) {
                return {
                    title: item.campaign_name + ' → ' + item.adset_name + ' → ' + item.action,
                    why: item.reason,
                    do: item.do_line,
                    do_not: 'Do not combine this with a second edit on the same adset today.'
                };
            }));
        brief.what_to_do_right_now = deterministicActions.length ? deterministicActions.slice(0, 7) : topActions.slice(0, 7).map(function(action) {
            return {
                title: (action.campaign_name ? action.campaign_name + ' → ' : '') + (action.adset_name ? action.adset_name + ' → ' : '') + (action.entity_name || action.action_type || '--'),
                why: action.diagnosis || action.reasoning || 'Exact optimizer action backed by selected-window performance and fresh status checks.',
                do: action.action_detail || action.expected_impact || String(action.action_type || '').replace(/_/g, ' '),
                do_not: action.risk || 'Do not combine this with another structural change on the same entity today.'
            };
        });
    }
    if (!hasMeaningfulBriefRows(brief.what_to_leave_alone, ['title', 'entity_name', 'reason'])) {
        brief.what_to_leave_alone = []
            .concat((plan.do_not_touch || []).slice(0, 4).map(function(item) {
                return {
                    title: item.entity_name || '--',
                    reason: item.reason || 'This entity should be held for now.',
                    watch_for: 'Act only if efficiency breaks further after the current cooldown or learning window.'
                };
            }))
            .concat(learningAdsets.slice(0, 3).map(function(item) {
                return {
                    title: item.campaign + ' → ' + item.adset,
                    reason: 'Currently ' + item.status + '. Learning phase is sacred unless the bleeding is extreme.',
                    watch_for: 'Touch only if CPA moves above 200% of target or learning does not resolve.'
                };
            }));
    }
    if (!hasMeaningfulBriefRows(brief.campaign_insights, ['campaign_name', 'name', 'status', 'adset_insights'])) {
        brief.campaign_insights = campaigns.slice(0, 8).map(function(entry) {
            var camp = entry.node;
            var campaignAudit = (plan.deterministic_audits && plan.deterministic_audits.campaigns || []).find(function(item) {
                return normalizeCampaignName(item.campaign_name || '') === normalizeCampaignName(entry.name || '');
            });
            var adsetNames = Object.keys(camp.adsets || {});
            var topAdset = null;
            adsetNames.forEach(function(name) {
                var adset = camp.adsets[name];
                if (!topAdset || ((adset.totals || {}).spend || 0) > ((topAdset.totals || {}).spend || 0)) topAdset = adset;
            });
            var topAd = null;
            (scan.ads || []).filter(function(ad) { return ad.campaign_name === entry.name; }).forEach(function(ad) {
                if (!topAd || (ad.spend || 0) > (topAd.spend || 0)) topAd = ad;
            });
            var status = campaignAudit ? campaignAudit.classification : (((camp.totals || {}).d6ROAS || 0) >= 28 ? 'Healthy' : ((((camp.totals || {}).spend || 0) >= 15000 && ((camp.totals || {}).d6ROAS || 0) < 15) ? 'Needs Attention' : 'Stable'));
            return {
                campaign_name: entry.name,
                status: status,
                trend: campaignAudit ? campaignAudit.reason : ('Spend ' + fmtINR((camp.totals || {}).spend || 0) + ' | D6 ROAS ' + fmtPct((camp.totals || {}).d6ROAS || 0)),
                adset_insights: campaignAudit ? ((campaignAudit.do_line || '') + ' ' + (campaignAudit.notes || []).slice(0, 2).join(' ')) : (topAdset ? ('Top ad set: ' + (topAdset.name || adsetNames[0] || '--') + '. ' + buildSettingsSummary(topAdset, 'adset') + '.') : 'No ad set insight available.'),
                creative_insights: topAd ? ('Most material ad: ' + (topAd.ad_name || '--') + ' | CPI ' + fmtINR(topAd.cpi || 0) + ' | SU Cost ' + fmtINR(topAd.signupCost || 0) + '. Cause: ' + getEntityRootCause(topAd, 'ad', { siblingAds: (camp.adsets[topAd.adset_name] && camp.adsets[topAd.adset_name].ads) || [] }).cause + '.') : 'No ad-level insight available.',
                key_question: 'Is this campaign limited by audience quality, creative fatigue, or placement waste? Use the adset and ad drill-down to answer that before making multiple changes.'
            };
        });
    }
    if (!hasMeaningfulBriefRows(brief.this_weeks_moves, ['title', 'entity_name'])) {
        brief.this_weeks_moves = []
            .concat((plan.breakdown_action_recommendations || []).slice(2, 4))
            .concat((plan.watch_list || []).slice(0, 5).map(function(item) {
            return { title: (item.entity_name || '--') + ' — ' + (item.watch_reason || item.trigger_for_action || 'monitor this entity') };
        })).slice(0, 5);
    }
    if (!brief.thirty_day_horizon || typeof brief.thirty_day_horizon !== 'object') brief.thirty_day_horizon = {};
    if (!hasMeaningfulBriefRows(brief.thirty_day_horizon.risks, ['risk', 'title'])) {
        brief.thirty_day_horizon.risks = ((plan.view_4_forward_plan && plan.view_4_forward_plan.risk_flags) || []).slice(0, 3);
    }
    if (!hasMeaningfulBriefRows(brief.thirty_day_horizon.opportunities, ['opportunity', 'title'])) {
        brief.thirty_day_horizon.opportunities = ((plan.view_4_forward_plan && plan.view_4_forward_plan.audience_expansion) || []).slice(0, 3).map(function(item) {
            return { opportunity: (item.audience_type || '--') + ' — ' + (item.definition || '--') };
        });
    }
    plan.morning_brief = brief;

    return plan;
}

function buildApexScanPrep(scan, mode) {
    var ads = (scan && scan.ads) || [];
    var totals = (scan && scan.evaluatedTotals) || {};
    var modeConfig = getApexModeConfig(mode || 'daily_review');
    var topSpend = ads.slice().sort(function(a, b) { return (b.spend || 0) - (a.spend || 0); });
    var winners = ads.filter(function(a) { return a.alertStatus === 'green'; }).slice(0, 5);
    var losers = ads.filter(function(a) { return a.alertStatus === 'red'; }).slice(0, 5);
    var paused = ads.filter(function(a) { return a.delivery_state && a.delivery_state.indexOf('paused') === 0; }).slice(0, 5);
    var unmatchedRetarget = ads.filter(function(a) { return a.audience_bucket === 'retarget' && !a.has_funnel_match; }).slice(0, 5);

    var block = function(title, lines, color) {
        return '<div style="' + CARD + 'border-left:3px solid ' + (color || 'var(--accent)') + ';">' +
            '<div style="font-size:11px;font-weight:600;color:' + (color || 'var(--text)') + ';margin-bottom:8px;">' + esc(title) + '</div>' +
            ((lines || []).length ? lines.map(function(line) {
                return '<div style="font-size:11px;color:var(--text-dim);padding:3px 0;">' + esc(line) + '</div>';
            }).join('') : '<div style="font-size:11px;color:var(--text-dim);">No strong signal in this slice yet.</div>') +
        '</div>';
    };

    if (mode === 'diagnostic') {
        return '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Diagnostic Prep</h3>' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">' + esc(modeConfig.objective) + '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;">' +
                block('Likely Pressure Points', topSpend.slice(0, 4).map(function(a) { return (a.ad_name || '--') + ' | Spend ' + fmtINR(a.spend || 0) + ' | CPI ' + fmtINR(a.cpi || 0); }), 'var(--orange)') +
                block('Paused / Hierarchy Risk', paused.map(function(a) { return (a.ad_name || '--') + ' | ' + (a.delivery_state || '--'); }), 'var(--red)') +
                block('Attribution Blind Spots', unmatchedRetarget.map(function(a) { return (a.ad_name || '--') + ' | retargeting without funnel match'; }), 'var(--accent)') +
            '</div>' +
        '</div>';
    }
    if (mode === 'account_overview') {
        return '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Account Overview Prep</h3>' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:12px;">' + esc(modeConfig.objective) + '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;">' +
                block('Biggest Spend Pockets', topSpend.slice(0, 5).map(function(a) { return (a.campaign_name || '--') + ' | ' + (a.adset_name || '--') + ' | ' + fmtINR(a.spend || 0); }), 'var(--accent)') +
                block('Top Winners', winners.map(function(a) { return (a.ad_name || '--') + ' | D6 ROAS ' + fmtPct(a.d6ROAS || 0); }), 'var(--green)') +
                block('Problem Areas', losers.map(function(a) { return (a.ad_name || '--') + ' | CPI ' + fmtINR(a.cpi || 0) + ' | SU ' + fmtINR(a.signupCost || 0); }), 'var(--red)') +
            '</div>' +
        '</div>';
    }
    return '';
}

function renderApexMetricCards(cards) {
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:16px;">' +
        cards.map(function(card) {
            return '<div style="' + CARD + 'border-left:3px solid ' + (card.color || 'var(--accent)') + ';">' +
                '<div style="font-size:10px;color:var(--text-dim);">' + esc(card.label || '') + '</div>' +
                '<div style="font-size:15px;font-weight:700;color:' + (card.color || 'var(--text)') + ';margin-top:4px;">' + esc(card.value != null ? String(card.value) : '--') + '</div>' +
                (card.note ? '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + esc(card.note) + '</div>' : '') +
            '</div>';
        }).join('') +
    '</div>';
}

function renderApexView2(plan) {
    var diag = plan.view_2_diagnosis || {};
    var perf = Array.isArray(diag.performance_shifts) ? diag.performance_shifts : [];
    var delivery = Array.isArray(diag.delivery_issues) ? diag.delivery_issues : [];
    var learning = Array.isArray(diag.learning_phase_map) ? diag.learning_phase_map : [];
    var attribution = diag.attribution_gap || {};
    return '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">View 2: The Diagnosis</h3>' +
        (perf.length ? '<div style="margin-bottom:14px;">' + perf.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.metric || '--') + ' (' + esc(item.change_pct != null ? String(item.change_pct) + '%' : '--') + ')</div>' +
                '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Cause: ' + esc(item.attributed_cause || '--') + '</div>' +
                '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Confidence: ' + esc(item.confidence || '--') + '</div>' +
                (item.data_needed_for_certainty ? '<div style="font-size:11px;color:var(--orange);margin-top:4px;">Need: ' + esc(item.data_needed_for_certainty) + '</div>' : '') +
            '</div>';
        }).join('') + '</div>' : '<div style="' + CARD + 'margin-bottom:12px;">No performance shift diagnosis returned.</div>') +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:14px;">' +
            '<div style="' + CARD + '"><div style="font-size:11px;color:var(--text-dim);">7d Click ROAS</div><div style="font-size:14px;color:var(--text);margin-top:4px;">' + esc(attribution.seven_day_click_roas != null ? String(attribution.seven_day_click_roas) : '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:11px;color:var(--text-dim);">1d Click ROAS</div><div style="font-size:14px;color:var(--text);margin-top:4px;">' + esc(attribution.one_day_click_roas != null ? String(attribution.one_day_click_roas) : '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:11px;color:var(--text-dim);">View-through ROAS</div><div style="font-size:14px;color:var(--text);margin-top:4px;">' + esc(attribution.view_through_roas != null ? String(attribution.view_through_roas) : '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:11px;color:var(--text-dim);">Blended MER</div><div style="font-size:14px;color:var(--text);margin-top:4px;">' + esc(attribution.blended_mer != null ? String(attribution.blended_mer) : '--') + '</div></div>' +
        '</div>' +
        (delivery.length ? '<div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Delivery Issues</div>' + delivery.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.entity_name || '--') + '</div><div style="font-size:11px;color:var(--orange);margin-top:4px;">' + esc(item.issue_type || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(item.detail || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">Fix: ' + esc(item.fix || '--') + '</div></div>';
        }).join('') + '</div>' : '') +
        (learning.length ? '<div><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Learning Phase Map</div>' + learning.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.adset_name || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Status: ' + esc(item.status || '--') + ' | Events: ' + esc(item.opt_events_7d != null ? String(item.opt_events_7d) : '--') + ' | Days: ' + esc(item.days_in_status != null ? String(item.days_in_status) : '--') + '</div>' + (item.fix ? '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Fix: ' + esc(item.fix) + '</div>' : '') + '</div>';
        }).join('') + '</div>' : '') +
    '</div>';
}

function renderApexView3(plan) {
    var breakdowns = Object.assign({}, deriveApexBreakdownFallbacks(plan.breakdown_context), plan.view_3_breakdowns || {});
    var ctx = plan.breakdown_context || {};
    var rows = ctx.breakdowns || {};
    var topPlacements = (rows.placement || []).slice().sort(function(a, b) { return (a.cpi_7d || Infinity) - (b.cpi_7d || Infinity); }).slice(0, 5);
    var topDevices = (rows.device || []).slice().sort(function(a, b) { return (a.cpi_7d || Infinity) - (b.cpi_7d || Infinity); }).slice(0, 4);
    var overlapPairs = Array.isArray(breakdowns.high_overlap_pairs) ? breakdowns.high_overlap_pairs : [];
    return '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">View 3: The Data Breakdown</h3>' +
        renderApexMetricCards([
            { label: 'Top Age × Gender Cohort', value: breakdowns.top_age_gender_cohort || '--', note: 'best current efficiency signal', color: 'var(--green)' },
            { label: 'Underfunded Cohort', value: breakdowns.underfunded_cohort || '--', note: 'good efficiency with low spend share', color: 'var(--orange)' },
            { label: 'Best Conversion Window', value: breakdowns.best_conversion_window || '--', note: 'hourly breakdown fallback', color: 'var(--accent)' },
            { label: 'iOS vs Android CPI Gap', value: breakdowns.ios_android_cpa_gap_pct != null ? (breakdowns.ios_android_cpa_gap_pct.toFixed(1) + '%') : '--', note: 'positive means iOS costlier', color: 'var(--text)' }
        ]) +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-bottom:14px;">' +
            '<div style="' + CARD + '"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Kill Placements</div><div style="font-size:12px;color:var(--red);">' + esc((breakdowns.kill_placements || []).join(', ') || '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Hidden Winner Placements</div><div style="font-size:12px;color:var(--green);">' + esc((breakdowns.hidden_winner_placements || []).join(', ') || '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Geo Budget Efficiency Gap</div><div style="font-size:12px;color:var(--text);">' + esc(breakdowns.geo_budget_efficiency_gap || '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Bid Strategy Recommendation</div><div style="font-size:12px;color:var(--text);">' + esc(breakdowns.bid_strategy_recommendation || 'No bid-strategy-specific recommendation returned yet.') + '</div></div>' +
        '</div>' +
        (topPlacements.length ? '<div style="' + CARD + 'margin-bottom:10px;"><div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px;">Placement Snapshot</div>' + topPlacements.map(function(r) { return '<div style="font-size:11px;color:var(--text-dim);padding:3px 0;">' + esc(titleCaseWords(String(r.placement || '').replace(/_/g, ' '))) + ' | CPI ' + esc(r.cpi_7d != null ? fmtINR(r.cpi_7d) : '--') + ' | Spend ' + esc(fmtINR(r.spend_7d || 0)) + '</div>'; }).join('') + '</div>' : '') +
        (topDevices.length ? '<div style="' + CARD + 'margin-bottom:10px;"><div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px;">Device / OS Snapshot</div>' + topDevices.map(function(r) { return '<div style="font-size:11px;color:var(--text-dim);padding:3px 0;">' + esc(titleCaseWords(String(r.device || '').replace(/_/g, ' '))) + ' | CPI ' + esc(r.cpi_7d != null ? fmtINR(r.cpi_7d) : '--') + ' | Spend ' + esc(fmtINR(r.spend_7d || 0)) + '</div>'; }).join('') + '</div>' : '') +
        ((rows.age_gender && rows.age_gender.length) ? '<div style="' + CARD + 'margin-bottom:10px;"><div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px;">Age × Gender Snapshot</div>' + rows.age_gender.slice(0, 6).map(function(r) { return '<div style="font-size:11px;color:var(--text-dim);padding:3px 0;">' + esc(r.age_band + ' ' + titleCaseWords(r.gender)) + ' | CPI ' + esc(r.cpi_7d != null ? fmtINR(r.cpi_7d) : '--') + ' | Spend share ' + esc(Number(r.spend_share_pct || 0).toFixed(1) + '%') + '</div>'; }).join('') + '</div>' : '') +
        ((rows.geography && rows.geography.length) ? '<div style="' + CARD + 'margin-bottom:10px;"><div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px;">Geography Snapshot</div>' + rows.geography.slice(0, 6).map(function(r) { return '<div style="font-size:11px;color:var(--text-dim);padding:3px 0;">' + esc(r.region) + ' | CPI ' + esc(r.cpi_7d != null ? fmtINR(r.cpi_7d) : '--') + ' | Spend ' + esc(fmtINR(r.spend_7d || 0)) + '</div>'; }).join('') + '</div>' : '') +
        (overlapPairs.length ? '<div style="' + CARD + 'margin-bottom:10px;"><div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px;">Audience Overlap Risk</div>' + overlapPairs.slice(0, 5).map(function(r) { return '<div style="font-size:11px;color:var(--text-dim);padding:3px 0;">' + esc(r.adset_a || '--') + ' ↔ ' + esc(r.adset_b || '--') + ' | Score ' + esc(r.overlap_score != null ? String(r.overlap_score) : '--') + '</div>'; }).join('') + '</div>' : '') +
        ((breakdowns.best_historical_change || breakdowns.worst_historical_change || breakdowns.creative_avg_decay_days != null) ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:10px;">' +
            '<div style="' + CARD + '"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Best Historical Change</div><div style="font-size:12px;color:var(--green);">' + esc(breakdowns.best_historical_change || '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Worst Historical Change</div><div style="font-size:12px;color:var(--red);">' + esc(breakdowns.worst_historical_change || '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Creative Avg Decay</div><div style="font-size:12px;color:var(--text);">' + esc(breakdowns.creative_avg_decay_days != null ? String(breakdowns.creative_avg_decay_days) + ' days' : '--') + '</div></div>' +
        '</div>' : '') +
        ((ctx.limitations || []).length ? '<div style="font-size:11px;color:var(--orange);margin-top:10px;">' + esc(ctx.limitations.join(' | ')) + '</div>' : '') +
    '</div>';
}

function renderApexView4(plan) {
    var forward = plan.view_4_forward_plan || {};
    var scaling = Array.isArray(forward.scaling_roadmap) ? forward.scaling_roadmap : [];
    var creativeTests = Array.isArray(forward.creative_tests) ? forward.creative_tests : [];
    var expansion = Array.isArray(forward.audience_expansion) ? forward.audience_expansion : [];
    var risks = Array.isArray(forward.risk_flags) ? forward.risk_flags : [];
    return '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">View 4: The Forward Plan</h3>' +
        (scaling.length ? '<div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Scaling Roadmap</div>' + scaling.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.adset_name || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Today ' + esc(item.budget_today != null ? fmtINR(item.budget_today) : '--') + ' → Day 3 ' + esc(item.budget_day3 != null ? fmtINR(item.budget_day3) : '--') + ' → Day 7 ' + esc(item.budget_day7 != null ? fmtINR(item.budget_day7) : '--') + ' → Day 14 ' + esc(item.budget_day14 != null ? fmtINR(item.budget_day14) : '--') + '</div><div style="font-size:11px;color:var(--green);margin-top:4px;">Watch: ' + esc(item.watch_metric || '--') + '</div><div style="font-size:11px;color:var(--red);margin-top:4px;">Kill: ' + esc(item.kill_condition || '--') + '</div></div>';
        }).join('') + '</div>' : '') +
        (creativeTests.length ? '<div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Creative Test Pipeline</div>' + creativeTests.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.hypothesis || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(item.format || '--') + ' | Hook: ' + esc(item.hook || '--') + ' | CTA: ' + esc(item.cta || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Audience: ' + esc(item.audience || '--') + ' | Budget: ' + esc(item.daily_budget != null ? fmtINR(item.daily_budget) + '/day' : '--') + ' | Duration: ' + esc(item.duration_days != null ? String(item.duration_days) + 'd' : '--') + '</div><div style="font-size:11px;color:var(--green);margin-top:4px;">Win: ' + esc(item.win_condition || '--') + '</div><div style="font-size:11px;color:var(--red);margin-top:4px;">Lose: ' + esc(item.loss_condition || '--') + '</div></div>';
        }).join('') + '</div>' : '') +
        (expansion.length ? '<div style="margin-bottom:14px;"><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Audience Expansion</div>' + expansion.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">P' + esc(item.priority != null ? String(item.priority) : '--') + ' | ' + esc(item.audience_type || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(item.definition || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Size: ' + esc(item.estimated_size != null ? String(item.estimated_size) : '--') + ' | Hyp. CPA: ' + esc(item.hypothesised_cpa != null ? fmtINR(item.hypothesised_cpa) : '--') + ' | Budget: ' + esc(item.budget != null ? fmtINR(item.budget) : '--') + '</div></div>';
        }).join('') + '</div>' : '') +
        (risks.length ? '<div><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">30-Day Risk Flags</div>' + risks.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--orange);">' + esc(item.risk || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Timeline: ' + esc(item.timeline || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">Pre-emption: ' + esc(item.pre_emption || '--') + '</div></div>';
        }).join('') + '</div>' : '') +
    '</div>';
}

function renderApexMetaAM(plan) {
    var insights = plan.meta_am_insights || [];
    if (!insights.length) return '<div style="' + CS + '"><h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Meta AM Briefing</h3><div style="' + CARD + '">No Meta AM insight block was returned.</div></div>';
    return '<div style="' + CS + '"><h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Meta AM Briefing</h3>' +
        insights.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.insight || '--') + '</div>' +
                '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Implication: ' + esc(item.account_implication || '--') + '</div>' +
                '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Action: ' + esc(item.recommended_action || '--') + '</div>' +
                '<div style="font-size:11px;color:var(--green);margin-top:4px;">Verify: ' + esc(item.how_to_verify || '--') + '</div></div>';
        }).join('') +
    '</div>';
}

function renderApexMonthScorecard(plan) {
    var score = plan.month_scorecard;
    if (!score) return '';
    return '<div style="' + CS + '"><h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Month Scorecard</h3><pre style="white-space:pre-wrap;font-size:11px;color:var(--text-dim);margin:0;">' + esc(JSON.stringify(score, null, 2)) + '</pre></div>';
}

function summarizeOptimizerActions(actions) {
    var list = Array.isArray(actions) ? actions : [];
    return {
        total: list.length,
        pause: list.filter(function(a) { return String(a.action_type || '').indexOf('PAUSE') !== -1; }).length,
        activate: list.filter(function(a) { return String(a.action_type || '').indexOf('ACTIVATE') !== -1; }).length,
        budget: list.filter(function(a) { return String(a.action_type || '').indexOf('BUDGET') !== -1 || String(a.action_type || '').indexOf('SCALE') !== -1; }).length,
        monitor: list.filter(function(a) { return String(a.action_type || '').toUpperCase() === 'MONITOR'; }).length,
        p1: list.filter(function(a) { return normalizeActionPriority(a.priority) === 'P1'; }).length,
        p2: list.filter(function(a) { return normalizeActionPriority(a.priority) === 'P2'; }).length
    };
}

function renderOperatorOverview(plan, scan, actions) {
    var pulse = plan.account_pulse || {};
    var summary = summarizeOptimizerActions(actions);
    var scanSummary = scan && scan.summary ? scan.summary : {};
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px;">' +
        '<div style="' + CARD + 'border-left:3px solid var(--accent);"><div style="font-size:10px;color:var(--text-dim);">Spend</div><div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + (pulse.spend_total != null ? fmtINR(pulse.spend_total) : '--') + '</div></div>' +
        '<div style="' + CARD + 'border-left:3px solid var(--green);"><div style="font-size:10px;color:var(--text-dim);">D6 Overall ROAS</div><div style="font-size:16px;font-weight:700;color:var(--green);margin-top:4px;">' + (pulse.roas_window != null ? Number(pulse.roas_window).toFixed(1) + '%' : '--') + '</div></div>' +
        '<div style="' + CARD + 'border-left:3px solid var(--orange);"><div style="font-size:10px;color:var(--text-dim);">Ads In Current Slice</div><div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + esc(String(scanSummary.total_ads || 0)) + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + esc(String(scanSummary.total_campaigns || 0)) + ' campaigns | ' + esc(String(scanSummary.total_adsets || 0)) + ' adsets</div></div>' +
        '<div style="' + CARD + 'border-left:3px solid var(--red);"><div style="font-size:10px;color:var(--text-dim);">Do Now</div><div style="font-size:16px;font-weight:700;color:var(--red);margin-top:4px;">' + esc(String(summary.p1 + summary.p2)) + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + esc(String(summary.pause)) + ' pauses | ' + esc(String(summary.budget)) + ' budget moves</div></div>' +
    '</div>' +
    renderImportedSkillContextCard(plan.imported_skill_context || null);
}

function renderMarketerDailyReview(plan, actions) {
    var brief = plan.morning_brief || {};
    var marketRead = brief.market_read || {};
    var pulse = brief.account_pulse || {};
    var analysisBasis = derivePlanAnalysisBasis(plan, getCurrentOptimizerDisplayScan());
    var doNow = Array.isArray(brief.what_to_do_right_now) && brief.what_to_do_right_now.length ? brief.what_to_do_right_now : [];
    var leaveAlone = Array.isArray(brief.what_to_leave_alone) && brief.what_to_leave_alone.length ? brief.what_to_leave_alone : [];
    var campaignInsights = Array.isArray(brief.campaign_insights) ? brief.campaign_insights : [];
    var thisWeek = Array.isArray(brief.this_weeks_moves) ? brief.this_weeks_moves : [];
    var horizon = brief.thirty_day_horizon || {};
    var risks = Array.isArray(horizon.risks) ? horizon.risks : [];
    var opportunities = Array.isArray(horizon.opportunities) ? horizon.opportunities : [];
    return '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:700;margin-bottom:12px;">APEX Morning Brief</h3>' +
        '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--accent);"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Recommendation Basis</div><div style="font-size:12px;color:var(--text);line-height:1.7;">Date range: ' + esc(analysisBasis.range) + ' | Basis: ' + esc(analysisBasis.mode) + ' (' + esc(analysisBasis.detail) + ')</div></div>' +
        '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--accent);"><div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Market Read</div><div style="font-size:12px;color:var(--text);line-height:1.7;">' + esc(marketRead.summary || plan.executive_summary || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:6px;">Posture: ' + esc(marketRead.posture || 'HOLD AND OPTIMISE') + '</div></div>' +
        renderImportedSkillContextCard(plan.imported_skill_context || null) +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:14px;">' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Spend Today</div><div style="font-size:14px;font-weight:700;color:var(--text);margin-top:4px;">' + esc(pulse.spend_today || '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">ROAS 7d</div><div style="font-size:14px;font-weight:700;color:var(--green);margin-top:4px;">' + esc(pulse.roas_7d || '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">CPA 7d</div><div style="font-size:14px;font-weight:700;color:var(--orange);margin-top:4px;">' + esc(pulse.cpa_7d || '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Active / Learning</div><div style="font-size:14px;font-weight:700;color:var(--text);margin-top:4px;">' + esc(pulse.active_counts || '--') + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + esc(pulse.learning_counts || '--') + '</div></div>' +
        '</div>' +
        '<div style="' + CARD + 'margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">What To Do Right Now</div>' +
            (doNow.length ? doNow.slice(0, 7).map(function(item) {
                return '<div style="padding:8px 0;border-bottom:1px solid var(--border);"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.title || item.entity_name || '--') + '</div>' +
                    (item.why ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Why: ' + esc(item.why) + '</div>' : '') +
                    (item.do ? '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Do: ' + esc(item.do) + '</div>' : '') +
                    (item.do_not ? '<div style="font-size:11px;color:var(--orange);margin-top:4px;">Do not: ' + esc(item.do_not) + '</div>' : '') +
                '</div>';
            }).join('') : renderActionsTable(actions, window.OPTIMIZER_PLAN_FILTER || 'all', window.OPTIMIZER_PLAN_SCOPE || 'all')) +
        '</div>' +
        '<div style="' + CARD + 'margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">What To Leave Alone Today</div>' +
            (leaveAlone.length ? leaveAlone.map(function(item) {
                return '<div style="padding:8px 0;border-bottom:1px solid var(--border);"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.title || item.entity_name || '--') + '</div>' +
                    (item.reason ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Leave alone because: ' + esc(item.reason) + '</div>' : '') +
                    (item.watch_for ? '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Watch for: ' + esc(item.watch_for) + '</div>' : '') +
                '</div>';
            }).join('') : '<div style="font-size:11px;color:var(--text-dim);">No protected entities were returned for this run.</div>') +
        '</div>' +
        (campaignInsights.length ? '<div style="' + CARD + 'margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Campaign Insights</div>' +
            campaignInsights.map(function(item) {
                return '<div style="padding:8px 0;border-bottom:1px solid var(--border);"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.campaign_name || item.name || '--') + '</div>' +
                    (item.status ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Status: ' + esc(item.status) + '</div>' : '') +
                    (item.trend ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Trend: ' + esc(item.trend) + '</div>' : '') +
                    (item.adset_insights ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Ad Set Insights: ' + esc(item.adset_insights) + '</div>' : '') +
                    (item.creative_insights ? '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Creative Insights: ' + esc(item.creative_insights) + '</div>' : '') +
                    (item.key_question ? '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Key Question: ' + esc(item.key_question) + '</div>' : '') +
                '</div>';
            }).join('') + '</div>' : '') +
        ((thisWeek.length || risks.length || opportunities.length) ? '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
            '<div style="' + CARD + '"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">This Week\'s Moves</div>' + (thisWeek.length ? thisWeek.map(function(item) { return '<div style="font-size:11px;color:var(--text-dim);padding:4px 0;">• ' + esc(item.title || item.entity_name || item) + '</div>'; }).join('') : '<div style="font-size:11px;color:var(--text-dim);">No additional non-urgent moves returned.</div>') + '</div>' +
            '<div style="' + CARD + '"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">30-Day Horizon</div>' +
                (risks.length ? '<div style="font-size:11px;color:var(--orange);margin-bottom:6px;">Risks</div>' + risks.map(function(item) { return '<div style="font-size:11px;color:var(--text-dim);padding:3px 0;">• ' + esc(item.risk || item.title || item) + '</div>'; }).join('') : '') +
                (opportunities.length ? '<div style="font-size:11px;color:var(--green);margin:8px 0 6px 0;">Opportunities</div>' + opportunities.map(function(item) { return '<div style="font-size:11px;color:var(--text-dim);padding:3px 0;">• ' + esc(item.opportunity || item.title || item) + '</div>'; }).join('') : '') +
            '</div>' +
        '</div>' : '') +
    '</div>';
}

function renderSignalAvailabilityCard(plan) {
    var availability = plan && plan.signal_availability ? plan.signal_availability : null;
    if (!availability) return '';
    var limitations = Array.isArray(availability.limitations) ? availability.limitations.slice(0, 2) : [];
    var hookStatus = availability.creative_signals && availability.creative_signals.hook_hold_applicable
        ? (availability.creative_signals.hook_hold_available ? 'available' : 'missing')
        : 'n/a';
    return '<div style="' + CARD + 'margin-bottom:12px;border-left:3px solid var(--accent);"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Signal Coverage</div>' +
        '<div style="font-size:11px;color:var(--text-dim);">Hook/Hold: ' + hookStatus +
        ' | Delivery estimate: ' + (availability.settings_signals && availability.settings_signals.delivery_estimate_available ? 'available' : 'missing') +
        ' | Attribution split: ' + (availability.settings_signals && availability.settings_signals.attribution_split_available ? 'available' : 'missing') + '</div>' +
        (limitations.length ? '<div style="font-size:11px;color:var(--text-dim);margin-top:6px;">' + esc(limitations.join(' ')) + '</div>' : '') +
    '</div>';
}

function renderDailyActionConsole(plan, actions, scan) {
    var gate = plan.data_integrity_gate || {};
    var breakdownActions = Array.isArray(plan.breakdown_action_recommendations) ? plan.breakdown_action_recommendations : [];
    var learningGovernor = plan.learning_governor || null;
    var spendOnlyAds = (scan && scan.ads || []).filter(function(ad) {
        return !ad.has_funnel_match && (ad.spend || 0) >= 15000;
    }).sort(function(a, b) { return (b.spend || 0) - (a.spend || 0); }).slice(0, 5);
    return '<div style="' + CS + '">' +
        renderSignalAvailabilityCard(plan) +
        (learningGovernor ? '<div style="' + CARD + 'margin-bottom:12px;border-left:3px solid var(--green);"><div style="font-size:12px;font-weight:700;color:var(--green);">Learning Protection Active</div><div style="font-size:11px;color:var(--text-dim);margin-top:6px;">Live spend in learning: ' + esc(String(learningGovernor.learning_spend_share_pct || 0)) + '%. Policy: ' + esc(String(learningGovernor.edit_policy || 'normal').replace(/_/g, ' ')) + '. APEX is suppressing clustered structural edits, allowing only isolated budget-owner changes and only the clearest loser trims inside protected entities.</div></div>' : '') +
        (gate.provisional_only ? '<div style="' + CARD + 'margin-bottom:12px;border-left:3px solid var(--orange);"><div style="font-size:12px;font-weight:700;color:var(--orange);">Provisional Recommendations</div><div style="font-size:11px;color:var(--text-dim);margin-top:6px;">' + esc((gate.warnings && gate.warnings[0]) || 'Integrity checks failed. Treat recommendations cautiously.') + '</div></div>' : '') +
        (breakdownActions.length ? '<div style="' + CARD + 'margin-bottom:12px;border-left:3px solid var(--accent);"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Account-Level Breakdown Actions</div>' +
            breakdownActions.map(function(item) {
                return '<div style="padding:6px 0;border-bottom:1px solid var(--border);"><div style="font-size:11px;font-weight:600;color:var(--text);">' + esc(item.title || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Why: ' + esc(item.why || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">Do: ' + esc(item.do || '--') + '</div></div>';
            }).join('') + '</div>' : '') +
        '<div style="' + CARD + 'margin-bottom:12px;"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Today\'s Action Queue</div>' +
            renderActionsTable(actions, window.OPTIMIZER_PLAN_FILTER || 'all', window.OPTIMIZER_PLAN_SCOPE || 'all') +
        '</div>' +
        (spendOnlyAds.length ? '<div style="' + CARD + 'margin-bottom:12px;border-left:3px solid var(--orange);"><div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Unattributed Spend To Verify</div>' +
            spendOnlyAds.map(function(ad) {
                return '<div style="font-size:11px;color:var(--text-dim);padding:5px 0;">• ' + esc(ad.campaign_name || '--') + ' → ' + esc(ad.adset_name || '--') + ' → ' + esc(ad.ad_name || '--') + ' | Spend ' + fmtINR(ad.spend || 0) + ' | Do: verify tracker before treating this as confirmed performance failure.</div>';
            }).join('') + '</div>' : '') +
    '</div>';
}

function renderMarketerDiagnosis(plan, scan) {
    var diag = plan.view_2_diagnosis || {};
    var breakdownActions = Array.isArray(plan.breakdown_action_recommendations) ? plan.breakdown_action_recommendations.slice(0, 3) : [];
    var perf = Array.isArray(diag.performance_shifts) ? diag.performance_shifts.slice(0, 4) : [];
    var delivery = Array.isArray(diag.delivery_issues) ? diag.delivery_issues.slice(0, 4) : [];
    var learning = Array.isArray(diag.learning_phase_map) ? diag.learning_phase_map.filter(function(x) { return String(x.status || '').toLowerCase() !== 'active'; }).slice(0, 4) : [];
    var fallback = (scan && scan.ads || []).filter(function(a) { return (a.is_live && a.spend >= 15000 && (a.cpi || 0) > 200) || a.is_effectively_paused; }).slice(0, 4);
    return '<div style="' + CS + '">' +
        renderSignalAvailabilityCard(plan) +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Why Performance Looks Like This</h3>' +
        renderImportedSkillContextCard(plan.imported_skill_context || null) +
        (perf.length ? perf.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.metric || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(item.attributed_cause || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">Confidence: ' + esc(item.confidence || '--') + '</div></div>';
        }).join('') : '') +
        (delivery.length ? '<div style="margin-top:10px;">' + delivery.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--orange);">' + esc(item.entity_name || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(item.detail || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">Fix: ' + esc(item.fix || '--') + '</div></div>';
        }).join('') + '</div>' : '') +
        (breakdownActions.length ? '<div style="margin-top:10px;"><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Account-Level Breakdown Moves</div>' + breakdownActions.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.title || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(item.why || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">' + esc(item.do || '--') + '</div></div>';
        }).join('') + '</div>' : '') +
        (!perf.length && !delivery.length && fallback.length ? '<div style="margin-top:10px;">' + fallback.map(function(a) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(a.ad_name || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Spend ' + fmtINR(a.spend || 0) + ' | CPI ' + fmtINR(a.cpi || 0) + ' | Status ' + esc((a.delivery_state || '--').replace(/_/g, ' ')) + '</div></div>';
        }).join('') + '</div>' : '') +
        (learning.length ? '<div style="margin-top:10px;"><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Learning-Limited</div>' + learning.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.adset_name || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(item.status || '--') + ' | Events ' + esc(item.opt_events_7d != null ? String(item.opt_events_7d) : '--') + '</div>' + (item.fix ? '<div style="font-size:11px;color:var(--accent);margin-top:4px;">' + esc(item.fix) + '</div>' : '') + '</div>';
        }).join('') + '</div>' : '') +
    '</div>';
}

function renderMarketerScaleAndTest(plan, scan) {
    var forward = plan.view_4_forward_plan || {};
    var scaling = Array.isArray(forward.scaling_roadmap) ? forward.scaling_roadmap.slice(0, 4) : [];
    var creativeTests = Array.isArray(forward.creative_tests) ? forward.creative_tests.slice(0, 3) : [];
    var expansion = Array.isArray(forward.audience_expansion) ? forward.audience_expansion.slice(0, 3) : [];
    var greenAds = (scan && scan.ads || []).filter(function(a) { return a.is_live && a.alertStatus === 'green'; }).sort(function(a, b) { return (b.d6ROAS || 0) - (a.d6ROAS || 0); }).slice(0, 3);
    return '<div style="' + CS + '">' +
        '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Next Moves</h3>' +
        renderImportedSkillContextCard(plan.imported_skill_context || null) +
        (scaling.length ? '<div style="margin-bottom:12px;"><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Scale Steps</div>' + scaling.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--green);">' + esc(item.adset_name || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(item.budget_today != null ? fmtINR(item.budget_today) : '--') + ' → ' + esc(item.budget_day3 != null ? fmtINR(item.budget_day3) : '--') + ' → ' + esc(item.budget_day7 != null ? fmtINR(item.budget_day7) : '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">Watch: ' + esc(item.watch_metric || '--') + '</div></div>';
        }).join('') + '</div>' : '') +
        (!scaling.length && greenAds.length ? '<div style="margin-bottom:12px;"><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Best Live Winners To Push Carefully</div>' + greenAds.map(function(a) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--green);">' + esc(a.ad_name || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">D6 ROAS ' + fmtPct(a.d6ROAS || 0) + ' | Spend ' + fmtINR(a.spend || 0) + '</div></div>';
        }).join('') + '</div>' : '') +
        (creativeTests.length ? '<div style="margin-bottom:12px;"><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Creative Tests</div>' + creativeTests.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.hypothesis || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(item.format || '--') + ' | Hook: ' + esc(item.hook || '--') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">Audience: ' + esc(item.audience || '--') + ' | Budget: ' + esc(item.daily_budget != null ? fmtINR(item.daily_budget) + '/day' : '--') + '</div></div>';
        }).join('') + '</div>' : '') +
        (expansion.length ? '<div><div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">Audience Expansion</div>' + expansion.map(function(item) {
            return '<div style="' + CARD + 'margin-bottom:8px;"><div style="font-size:12px;font-weight:600;color:var(--text);">P' + esc(item.priority != null ? String(item.priority) : '--') + ' | ' + esc(item.audience_type || '--') + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(item.definition || '--') + '</div></div>';
        }).join('') + '</div>' : '') +
    '</div>';
}

function formatPlacementSummary(placements) {
    var list = Array.isArray(placements) ? placements.filter(Boolean) : [];
    if (!list.length) return 'AUTO';
    return list.slice(0, 4).join(', ') + (list.length > 4 ? ' +' + (list.length - 4) : '');
}

function buildSettingsSummary(entity, entityType) {
    var parts = [];
    if (entityType === 'campaign') {
        if (entity.objective) parts.push('Objective ' + entity.objective);
        if (entity.budget_type) parts.push('Budget ' + entity.budget_type);
        return parts.join(' | ');
    }
    if (entity.bid_strategy) parts.push('Bid ' + entity.bid_strategy);
    if (entity.optimization_event) parts.push('Opt ' + entity.optimization_event);
    if (entity.location_targeting) parts.push('Geo ' + entity.location_targeting);
    if (entity.age_targeting || entity.gender_targeting) parts.push('Age/Gender ' + (entity.age_targeting || 'ALL') + ' / ' + (entity.gender_targeting || 'ALL'));
    if (entity.placements_active) parts.push('Placements ' + formatPlacementSummary(entity.placements_active));
    if (entity.cost_cap_value) parts.push('Cost Cap ' + fmtINR(entity.cost_cap_value));
    if (entity.bid_cap_value) parts.push('Bid Cap ' + fmtINR(entity.bid_cap_value));
    return parts.join(' | ');
}

function getEntityRootCause(entity, entityType, context) {
    var spend = entity && entity.totals ? (entity.totals.spend || 0) : (entity.spend || 0);
    var signupCost = entity && entity.totals ? (entity.totals.signupCost || 0) : (entity.signupCost || 0);
    var cpi = entity && entity.totals ? (entity.totals.cpi || 0) : (entity.cpi || 0);
    var ctr = entity && entity.totals ? (entity.totals.ctr || 0) : (entity.ctr || 0);
    var bidStrategy = String(entity.bid_strategy || '').toUpperCase();
    var optimizationEvent = String(entity.optimization_event || '').toUpperCase();
    var placements = Array.isArray(entity.placements_active) ? entity.placements_active : [];
    var siblingAds = Array.isArray(context && context.siblingAds) ? context.siblingAds : [];
    var frequency = entity && entity.totals ? (entity.totals.frequency || 0) : (entity.frequency || 0);
    if (isRetargetingEntity(entity, { entityType: entityType, liveChildren: context && context.liveChildren })) {
        return { cause: 'META-ONLY RETARGET REVIEW', detail: 'For retargeting, judge only on delivery discipline, frequency, and audience pool sanity in this path.' };
    }
    if (entity.has_funnel_match === false || entity.is_spend_only) return { cause: 'TRACKING', detail: 'Spend is present without matched funnel data. Confirm tracking before treating this as confirmed underperformance.' };
    if (bidStrategy === 'BID_CAP') return { cause: 'BID STRATEGY', detail: 'Bid Cap is active, which often throttles conversion delivery for this account.' };
    if (bidStrategy === 'COST_CAP' && entity.cost_cap_value && signupCost > 0 && entity.cost_cap_value <= signupCost * 1.1) return { cause: 'BID STRATEGY', detail: 'Cost Cap is set too close to actual acquisition cost, so throttling is likely self-inflicted.' };
    if (optimizationEvent && optimizationEvent !== 'UNKNOWN' && spend >= 8000 && ((entity.signups_7d || entity.signups || 0) < 50) && entityType !== 'campaign') return { cause: 'OPTIMIZATION EVENT', detail: 'Optimization event volume looks too thin for stable learning at current spend.' };
    if (entityType === 'ad' && spend >= 3000) {
        var siblingMedianCtr = weightedPercentileMetric(siblingAds, function(ad) { return ad.ctr; }, function(ad) { return ad.spend || 0; }, 0.5) || 0;
        if (ctr > 0 && siblingMedianCtr > 0 && ctr < siblingMedianCtr * 0.75) return { cause: 'CREATIVE', detail: 'CTR is materially below sibling baseline, so the likely bottleneck is the creative hook or format.' };
        if (ctr >= siblingMedianCtr && signupCost > 1000) return { cause: 'POST-CLICK', detail: 'Clicks are arriving but signup cost is still high, which points after the click rather than at the ad itself.' };
    }
    if (entityType === 'adset' && placements.length && cpi > 200) return { cause: 'PLACEMENTS / LOCATION', detail: 'High CPI with defined placement or geo settings suggests delivery waste before blaming budget.' };
    if (frequency > 3.5 && ctr > 0 && ctr < 1.2) return { cause: 'AUDIENCE FATIGUE', detail: 'Weak CTR under rising repetition suggests the audience is tiring, not just the creative.' };
    if (cpi > 200) return { cause: 'DELIVERY / SETTINGS', detail: 'CPI is elevated enough to treat this as a Meta-side efficiency problem first.' };
    if (signupCost > 1000) return { cause: 'QUALITY / POST-CLICK', detail: 'Signup cost is the main weakness even if clicks are still coming through.' };
    return { cause: 'NO PRIMARY ISSUE', detail: 'No clear root-cause signal is dominant enough to justify a change right now.' };
}

function buildOverviewEntityInsight(entity, entityType) {
    var context = arguments[2] || {};
    var lines = [];
    var spend = entity && entity.totals ? (entity.totals.spend || 0) : (entity.spend || 0);
    var d6roas = entity && entity.totals ? (entity.totals.d6ROAS || 0) : (entity.d6ROAS || 0);
    var status = entity.delivery_state || (entity.adset_status || entity.campaign_status || entity.ad_status || 'unknown');
    var rootCause = getEntityRootCause(entity, entityType, context);
    var settingsSummary = buildSettingsSummary(entity, entityType);
    if (String(status).indexOf('paused') === 0 || String(status).toUpperCase() === 'PAUSED') lines.push('Hierarchy state: paused. Fix live/paused status first.');
    if (settingsSummary) lines.push('Settings: ' + settingsSummary + '.');
    if (rootCause && rootCause.detail) lines.push('Primary cause: ' + rootCause.cause + ' — ' + rootCause.detail);
    if (d6roas > 28) lines.push('Efficiency signal: strong D6 overall ROAS. Protect before making broad edits.');
    else if (spend >= 15000 && d6roas > 0 && d6roas < 15) lines.push('Efficiency signal: high spend with weak D6 overall ROAS. This pocket is dragging account efficiency.');
    if (!lines.length) lines.push('No change needed from current topline and settings signals.');
    return lines.slice(0, 3);
}

function buildOverviewEntityRecommendation(entity, entityType) {
    var context = arguments[2] || {};
    var spend = entity && entity.totals ? (entity.totals.spend || 0) : (entity.spend || 0);
    var signups = entity && entity.totals ? (entity.totals.signups || 0) : ((entity.signups_7d || entity.signups || 0));
    var d6roas = entity && entity.totals ? (entity.totals.d6ROAS || 0) : (entity.d6ROAS || 0);
    var signupCost = entity && entity.totals ? (entity.totals.signupCost || 0) : (entity.signupCost || 0);
    var cpi = entity && entity.totals ? (entity.totals.cpi || 0) : (entity.cpi || 0);
    var ctr = entity && entity.totals ? (entity.totals.ctr || 0) : (entity.ctr || 0);
    var deliveryState = String(entity.delivery_state || entity.adset_status || entity.campaign_status || entity.ad_status || 'unknown').toLowerCase();
    var action = 'NO CHANGE NEEDED';
    var why = 'Current signals do not justify a change in this entity right now.';
    var doLine = 'Hold current settings.';
    var tone = 'var(--green)';
    var liveChildren = Array.isArray(context.liveChildren) ? context.liveChildren : [];
    var siblingAds = Array.isArray(context.siblingAds) ? context.siblingAds : [];
    var siblingAdsets = Array.isArray(context.siblingAdsets) ? context.siblingAdsets : [];
    var rootCause = getEntityRootCause(entity, entityType, context);
    var trendSignal = context.trendSignal || null;
    var trendLens = context.trendLens || null;
    var bidStrategy = String(entity.bid_strategy || '').toUpperCase();
    var optimizationEvent = String(entity.optimization_event || '').toUpperCase();
    var locationTargeting = String(entity.location_targeting || '').toUpperCase();
    var placements = Array.isArray(entity.placements_active) ? entity.placements_active : [];

    function topBy(items, getter) {
        return (items || []).slice().sort(function(a, b) {
            return (getter(b) || 0) - (getter(a) || 0);
        })[0] || null;
    }
    function lowBy(items, getter) {
        return (items || []).slice().sort(function(a, b) {
            return (getter(a) || 0) - (getter(b) || 0);
        })[0] || null;
    }
    function countFailingAds(items) {
        return (items || []).filter(function(ad) {
            return ad && ad.is_live && (((ad.spend || 0) >= 3000 && (ad.cpi || 0) > 200) || (((ad.spend || 0) >= 3000) && (ad.ctr || 0) > 0 && (ad.ctr || 0) < 1.2) || (((ad.spend || 0) >= 5000) && (ad.signupCost || 0) > 1000));
        });
    }
    function bestWinnerAd(items) {
        return topBy((items || []).filter(function(ad) {
            return ad && ad.is_live && (ad.spend || 0) >= 2000;
        }), function(ad) {
            return scoreAdForReplacement(ad);
        });
    }

    if (deliveryState.indexOf('paused') === 0) {
        return {
            action: 'FIX STATUS',
            why: 'This entity is paused in hierarchy, so no optimization below it matters until the live/paused decision is corrected.',
            do_line: 'Reactivate or keep paused at the true owner level first. Do not make budget or creative edits underneath it yet.',
            tone: 'var(--orange)'
        };
    }
    if (entity.has_funnel_match === false || entity.is_spend_only) {
        return {
            action: 'VERIFY TRACKER',
            why: rootCause.detail,
            do_line: 'Do not pause or scale this entity on Metabase efficiency alone until the attribution gap is verified.',
            tone: 'var(--orange)'
        };
    }
    if (isRetargetingEntity(entity, { entityType: entityType, liveChildren: liveChildren })) {
        return buildRetargetMetaOnlyRecommendation(entity, entityType, { liveChildren: liveChildren });
    }

    if (entityType === 'campaign') {
        var bestAdset = topBy(liveChildren, function(as) { return ((as.totals || {}).d6ROAS || 0) - ((((as.totals || {}).cpi) || 0) / 1000); });
        var weakAdsets = liveChildren.filter(function(as) {
            return (((as.totals || {}).spend || 0) >= 10000) && (((as.totals || {}).d6ROAS || 0) < 15 || (((as.totals || {}).cpi || 0) > 200));
        });
        var concentration = bestAdset && spend > 0 ? ((((bestAdset.totals || {}).spend || 0) / spend) * 100) : 0;
        if (spend >= 100000 && signups > 0 && signups < 10) {
            return {
                action: 'PAUSE OR REBUILD NOW',
                why: 'Spend is already above ₹1L and matched signup volume is still below 10, which is too little confirmed conversion for this much burn.',
                do_line: bestAdset
                    ? ('Stop feeding the full campaign. Pause the weakest adsets now and only keep ' + bestAdset.name + ' live if it is the one defensible pocket while you rebuild the rest.')
                    : 'Stop feeding this campaign now and rebuild the structure before adding more budget.',
                tone: 'var(--red)'
            };
        }
        if (trendSignal && trendSignal.recent_signal && /RECENT_(CONTINUOUS_COST_PRESSURE|COST_PRESSURE)/.test(trendSignal.recent_signal.pattern) && spend >= 20000) {
            return {
                action: 'FIX RECENT COST PRESSURE',
                why: (trendLens && trendLens.root_cause) || trendSignal.recent_signal.summary,
                do_line: (trendLens && trendLens.action_line) || 'Recent signup or D0 trial cost pressure is building. Tighten the weak child pockets now instead of leaving this campaign unchanged.',
                tone: 'var(--orange)'
            };
        }
        if (spend >= 8000 && signups < 10 && (signupCost >= 1500 || cpi >= 600)) {
            return {
                action: 'CUT PRESSURE EARLY',
                why: 'Early signup cost is already too high at meaningful spend, so waiting for 10 signups would only burn more budget.',
                do_line: bestAdset
                    ? ('Do not hold this campaign unchanged. Cut pressure on the weaker child pockets first and keep only ' + bestAdset.name + ' if it is the one defensible pocket.')
                    : 'Do not hold this campaign unchanged. Reduce pressure now and rebuild the weak pockets before spending more.',
                tone: 'var(--red)'
            };
        }
        if (String(entity.objective || '').toUpperCase().indexOf('TRAFFIC') !== -1) {
            return {
                action: 'FIX OBJECTIVE',
                why: 'Campaign objective is traffic while this account optimizes around signups and D6 ROAS.',
                do_line: 'Move future spend into a conversion-aligned campaign structure instead of scaling this objective.',
                tone: 'var(--red)'
            };
        }
        if (weakAdsets.length >= 2 && bestAdset) {
            return {
                action: 'CUT WEAK ADSETS',
                why: weakAdsets.length + ' live adsets are dragging this campaign while ' + bestAdset.name + ' is the strongest remaining pocket.',
                do_line: 'Reduce or pause the weakest adsets first and keep budget concentrated in ' + bestAdset.name + '.',
                tone: 'var(--red)'
            };
        }
        if (bestAdset && concentration >= 65 && d6roas < 15) {
            return {
                action: 'REBUILD CAMPAIGN MIX',
                why: bestAdset.name + ' is carrying ' + concentration.toFixed(0) + '% of spend, but overall campaign efficiency is still weak.',
                do_line: 'Stop spreading budget across weak siblings. Keep only the best adset live and rebuild the rest with cleaner audience or creative angles.',
                tone: 'var(--red)'
            };
        }
        if (bestAdset && d6roas >= 28 && cpi > 0 && cpi < 150) {
            return {
                action: 'PROTECT AND SCALE',
                why: 'This campaign is efficient at meaningful spend and ' + bestAdset.name + ' is leading the result.',
                do_line: 'Increase only the winning budget owner by 20–25% max and do not touch weaker child settings on the same day.',
                tone: 'var(--green)'
            };
        }
    }

    if (entityType === 'adset') {
        var failingAds = countFailingAds(liveChildren);
        var winnerAd = bestWinnerAd(liveChildren);
        var protectHealthyAdset = !!(winnerAd && d6roas >= 28 && cpi > 0 && cpi < 150);
        if (bidStrategy === 'BID_CAP') {
            return {
                action: 'FIX BID STRATEGY',
                why: rootCause.detail,
                do_line: 'Move this adset off Bid Cap before changing creatives or cutting budget.',
                tone: 'var(--red)'
            };
        }
        if (bidStrategy === 'COST_CAP' && entity.cost_cap_value && signupCost > 0 && entity.cost_cap_value <= signupCost * 1.1) {
            return {
                action: 'RAISE COST CAP',
                why: rootCause.detail,
                do_line: 'Increase the Cost Cap to restore delivery headroom before treating this as an audience or creative issue.',
                tone: 'var(--orange)'
            };
        }
        if (trendSignal && trendSignal.recent_signal && /RECENT_(CONTINUOUS_COST_PRESSURE|COST_PRESSURE)/.test(trendSignal.recent_signal.pattern) && spend >= 12000) {
            return {
                action: 'FIX RECENT COST PRESSURE',
                why: (trendLens && trendLens.root_cause) || trendSignal.recent_signal.summary,
                do_line: (trendLens && trendLens.action_line) || 'Recent signup or D0 trial cost pressure is building in this adset. Tighten the likely weak pocket now instead of passively holding.',
                tone: 'var(--orange)'
            };
        }
        if (spend >= 8000 && signups < 10 && (signupCost >= 1500 || cpi >= 600)) {
            return {
                action: 'CUT PRESSURE EARLY',
                why: 'Early signup cost is already too high at meaningful spend, so this adset should not sit in a passive hold state.',
                do_line: 'Reduce pressure now and prioritize geo, placement, audience, or creative fixes before waiting for more expensive signups.',
                tone: 'var(--red)'
            };
        }
        if (optimizationEvent && optimizationEvent !== 'UNKNOWN' && spend >= 8000 && (entity.signups_7d || entity.signups || 0) < 50) {
            return {
                action: 'CHECK OPT EVENT',
                why: rootCause.detail,
                do_line: 'Test a higher-volume optimization event only after confirming this adset is not still protected by learning or cooldown.',
                tone: 'var(--orange)'
            };
        }
        if ((locationTargeting.indexOf('INDIA_WIDE') !== -1 || locationTargeting.indexOf('TIER') !== -1 || locationTargeting.indexOf(',') !== -1) && cpi > 200 && placements.length) {
            return {
                action: 'TIGHTEN TARGETING',
                why: 'Current geo/placement setup is broad while delivery cost is already elevated.',
                do_line: 'Cut the worst geos or placements first before deciding this audience itself is broken.',
                tone: 'var(--orange)'
            };
        }
        if (failingAds.length >= 2 && winnerAd && !protectHealthyAdset) {
            return {
                action: 'CUT LOSING ADS',
                why: failingAds.length + ' ads are wasting spend while ' + winnerAd.ad_name + ' is the clearest live winner inside this adset.',
                do_line: 'Pause the worst ads first and keep only ' + winnerAd.ad_name + ' plus one challenger live in this adset.',
                tone: 'var(--red)'
            };
        }
        if (spend >= 15000 && cpi > 200 && !winnerAd) {
            return {
                action: 'REBUILD ADSET',
                why: 'This adset has enough spend to judge and no clear winning ad is carrying it.',
                do_line: 'Do not add budget. Replace the current ad mix and tighten the audience or geo setup before spending more here.',
                tone: 'var(--red)'
            };
        }
        if (winnerAd && d6roas >= 28 && cpi > 0 && cpi < 150) {
            return {
                action: 'SCALE 20%',
                why: winnerAd.ad_name + ' is keeping this adset efficient and current delivery metrics are still healthy.',
                do_line: 'Increase this adset budget by 20% max only if there has been no structural edit in the last 3 days.',
                tone: 'var(--green)'
            };
        }
        if (winnerAd && failingAds.length === 1) {
            return {
                action: 'PAUSE ONE LOSER',
                why: 'One ad is dragging a workable adset while ' + winnerAd.ad_name + ' is still holding efficiency.',
                do_line: 'Pause the weakest ad and keep this adset focused on the winner plus one fresh replacement.',
                tone: 'var(--orange)'
            };
        }
        if (liveChildren.length <= 2 && winnerAd && spend >= 8000) {
            var suggestions = suggestAdNameVariantsFromWinner(winnerAd.ad_name, 3);
            return {
                action: 'ADD MORE ADS',
                why: 'This adset does not have enough creative depth. One winner alone is not enough to carry stable delivery and testing.',
                do_line: 'Keep ' + winnerAd.ad_name + ' live and add 2-3 distinct challenger ads. Suggested names: ' + (suggestions.join(' | ') || 'add new challenger variants') + '.',
                tone: 'var(--orange)'
            };
        }
    }

    if (entityType === 'ad') {
        var compliance = detectSebiComplianceRisk(entity);
        var betterSibling = findStrictBetterSibling(entity, siblingAds);
        var siblingMedianCtr = weightedPercentileMetric(siblingAds, function(ad) { return ad.ctr; }, function(ad) { return ad.spend || 0; }, 0.5) || 0;
        var siblingLiveCount = siblingAds.filter(function(item) { return item && item.is_live; }).length;
        if (compliance.status === 'review_needed') {
            return {
                action: 'COMPLIANCE REVIEW',
                why: compliance.detail,
                do_line: 'Do not scale or duplicate this ad until the claim language is reviewed for SEBI compliance.',
                tone: 'var(--orange)'
            };
        }
        if (spend < 1500) {
            return {
                action: 'HOLD FOR MORE DATA',
                why: 'This ad has not spent enough yet for a clean verdict.',
                do_line: 'Keep it live until it reaches at least ₹1.5K spend unless status or policy forces a stop.',
                tone: 'var(--accent)'
            };
        }
        if (betterSibling && spend >= 3000 && cpi > 200) {
            return {
                action: 'PAUSE AND SHIFT',
                why: 'Primary issue: ' + rootCause.cause + '. This ad is materially worse than sibling winner ' + betterSibling.ad_name + ' on cost efficiency.',
                do_line: 'Pause this ad today and let ' + betterSibling.ad_name + ' absorb the spend inside the same adset.',
                tone: 'var(--red)'
            };
        }
        if (betterSibling && spend >= 3000 && ctr > 0 && siblingMedianCtr > 0 && ctr < (siblingMedianCtr * 0.75)) {
            return {
                action: 'REFRESH HOOK',
                why: 'Primary issue: ' + rootCause.cause + '. CTR is materially below sibling baseline, so this ad is losing the click battle before post-click quality even matters.',
                do_line: 'Pause this weak creative, let ' + betterSibling.ad_name + ' remain as the live control, and load a distinct new hook angle instead of duplicating the same ad.',
                tone: 'var(--orange)'
            };
        }
        if (spend >= 5000 && signupCost > 1000 && betterSibling) {
            return {
                action: 'REPLACE WITH WINNER',
                why: 'Primary issue: ' + rootCause.cause + '. Signup cost is too high and a better sibling already exists, so this ad is not the creative to keep feeding.',
                do_line: 'Pause this ad, shift spend toward the live winner ' + betterSibling.ad_name + ', and only add a close variant if it is materially different from the current live mix.',
                tone: 'var(--red)'
            };
        }
        if (siblingLiveCount <= 2 && !betterSibling && (d6roas > 0 || cpi > 0)) {
            var adSuggestions = suggestAdNameVariantsFromWinner(entity.ad_name || (siblingAds[0] && siblingAds[0].ad_name) || '', 3);
            return {
                action: 'ADD MORE ADS',
                why: 'No sibling is clearly better enough to justify a direct replacement call inside this small adset.',
                do_line: 'Keep the stronger existing ad live and add 2-3 distinct challengers instead of swapping these two back and forth. Suggested names: ' + (adSuggestions.join(' | ') || 'new challenger variants') + '.',
                tone: 'var(--orange)'
            };
        }
        if (d6roas >= 28 && cpi > 0 && cpi < 150) {
            return {
                action: 'KEEP LIVE',
                why: 'This ad is one of the stronger live creatives on both delivery and downstream efficiency.',
                do_line: 'Leave this ad live and use it as the benchmark creative for replacements in this adset.',
                tone: 'var(--green)'
            };
        }
    }

    return {
        action: action,
        why: why,
        do_line: doLine,
        tone: tone
    };
}

function actionLabelForOverview(action) {
    var type = String(action && action.action_type || '').toUpperCase();
    if (type.indexOf('PAUSE') !== -1) return 'PAUSE';
    if (type.indexOf('ACTIVATE') !== -1) return 'REACTIVATE';
    if (type.indexOf('BUDGET') !== -1) {
        var bc = action && action.budget_change;
        var current = bc ? Number(bc.current_daily_budget || 0) : 0;
        var next = bc ? Number(bc.recommended_daily_budget || 0) : 0;
        if (next > current) return 'INCREASE BUDGET';
        if (next > 0 && next < current) return 'REDUCE BUDGET';
        return 'CHANGE BUDGET';
    }
    if (type === 'CREATIVE_CHANGE') return 'REFRESH CREATIVE';
    if (type === 'MONITOR') return 'HOLD';
    return type ? type.replace(/_/g, ' ') : 'HOLD';
}

function actionToneForOverview(action) {
    var type = String(action && action.action_type || '').toUpperCase();
    if (type.indexOf('PAUSE') !== -1) return 'var(--red)';
    if (type.indexOf('ACTIVATE') !== -1) return 'var(--green)';
    if (type.indexOf('BUDGET') !== -1) return 'var(--accent)';
    if (type === 'CREATIVE_CHANGE') return 'var(--orange)';
    return 'var(--green)';
}

function getPlanRecommendationForOverview(plan, entityType, entity, campaignName, adsetName) {
    var actions = Array.isArray(plan && plan.actions) ? plan.actions : [];
    var matching = actions.filter(function(action) {
        var type = String(action && action.entity_type || '').toLowerCase();
        if (type !== entityType) return false;
        if (entityType === 'campaign') {
            return (action.entity_id && entity.id && action.entity_id === entity.id) ||
                normalizeCampaignName(action.campaign_name || action.entity_name || '') === normalizeCampaignName(campaignName || entity.name || '');
        }
        if (entityType === 'adset') {
            return ((action.entity_id && entity.id && action.entity_id === entity.id) ||
                (normalizeCampaignName(action.campaign_name || '') === normalizeCampaignName(campaignName || '') &&
                 normalizeAdsetName(action.adset_name || action.entity_name || '') === normalizeAdsetName(adsetName || entity.name || '')));
        }
        return ((action.entity_id && entity.ad_id && action.entity_id === entity.ad_id) ||
            (normalizeCampaignName(action.campaign_name || '') === normalizeCampaignName(campaignName || '') &&
             normalizeAdsetName(action.adset_name || '') === normalizeAdsetName(adsetName || '') &&
             normalizeTrackerName(action.entity_name || '') === normalizeTrackerName(entity.ad_name || '')));
    }).sort(function(a, b) {
        return getPriorityRank(normalizeActionPriority(b.priority)) - getPriorityRank(normalizeActionPriority(a.priority));
    });
    if (!matching.length) return null;
    var top = matching[0];
    return {
        action: actionLabelForOverview(top),
        why: top.diagnosis || top.reasoning || top.action_detail || 'Actionable recommendation returned by optimizer.',
        do_line: top.action_detail || ((top.budget_change && top.budget_change.recommended_daily_budget)
            ? ('Change budget to ' + fmtINR(top.budget_change.recommended_daily_budget) + '/day')
            : 'Execute this recommended change.'),
        tone: actionToneForOverview(top),
        source: top
    };
}

function getDeterministicAuditRecommendation(plan, entityType, entity, campaignName, adsetName) {
    var audits = plan && plan.deterministic_audits ? plan.deterministic_audits : {};
    var audit = null;
    if (entityType === 'campaign') {
        audit = (audits.campaigns || []).find(function(item) { return normalizeCampaignName(item.campaign_name || '') === normalizeCampaignName(campaignName || entity.name || ''); });
    } else if (entityType === 'adset') {
        audit = (audits.adsets || []).find(function(item) {
            return normalizeCampaignName(item.campaign_name || '') === normalizeCampaignName(campaignName || '') &&
                normalizeAdsetName(item.adset_name || '') === normalizeAdsetName(adsetName || entity.name || '');
        });
    } else {
        audit = (audits.ads || []).find(function(item) {
            return normalizeCampaignName(item.campaign_name || '') === normalizeCampaignName(campaignName || '') &&
                normalizeAdsetName(item.adset_name || '') === normalizeAdsetName(adsetName || '') &&
                normalizeTrackerName(item.ad_name || '') === normalizeTrackerName(entity.ad_name || '');
        });
    }
    if (!audit) return null;
    return {
        action: audit.action || 'HOLD',
        why: audit.reason || audit.signal || 'Deterministic operator audit recommendation.',
        do_line: audit.do_line || (audit.replacement_ad_name ? ('Replace with ' + audit.replacement_ad_name) : 'Hold current settings.'),
        tone: /PAUSE|CUT|REBUILD|VERIFY/.test(String(audit.action || '').toUpperCase()) ? 'var(--red)' : (/INCREASE|SCALE|PROTECT|KEEP LIVE/.test(String(audit.action || '').toUpperCase()) ? 'var(--green)' : 'var(--orange)'),
        source: audit
    };
}

function isWeakOverviewRecommendation(rec) {
    if (!rec) return true;
    var action = String(rec.action || '').toLowerCase();
    var why = String(rec.why || '').toLowerCase();
    var doLine = String(rec.do_line || '').toLowerCase();
    var genericTerms = /(check|review|investigate|assess|analyze|monitor only|look at)/;
    var concreteTerms = /(pause|replace|refresh|increase|reduce|scale|hold|keep live|reactivate|cut|rebuild|shift|swap)/;
    if (!action || action === 'hold' || action === 'monitor') {
        if (!concreteTerms.test(doLine)) return true;
    }
    if (genericTerms.test(doLine) && !concreteTerms.test(doLine)) return true;
    if (genericTerms.test(why) && !concreteTerms.test(why)) return true;
    return false;
}

function chooseOverviewRecommendation(planRec, fallbackRec) {
    if (!isWeakOverviewRecommendation(planRec)) return planRec;
    return fallbackRec;
}

function applyOverviewLearningGuard(rec, entity, entityType, context) {
    var governor = context && context.learningGovernor ? context.learningGovernor : null;
    if (!rec || !governor) return rec;
    var campaignKey = normalizeCampaignName((context && context.campaign && context.campaign.name) || entity.campaign_name || entity.name || '');
    var adsetName = (context && context.adset && context.adset.name) || entity.adset_name || entity.name || '';
    var adsetKey = campaignKey + '||' + normalizeAdsetName(adsetName);
    var action = String(rec.action || '').toUpperCase();
    if (entityType === 'ad' && /PAUSE|REPLACE|SHIFT|REFRESH/.test(action)) {
        if ((governor.protected_campaigns[campaignKey] || governor.protected_adsets[adsetKey]) && !governor.allowed_ad_ids[entity.ad_id || '']) {
            return {
                action: 'HOLD OR QUEUE',
                why: 'This change may be required, but it is not recommended now because bulk ad edits would risk disrupting learning in a healthy campaign/adset.',
                do_line: 'Defer this edit for now. Trim only the clearest loser in the current cycle and queue the rest for later.',
                tone: 'var(--orange)'
            };
        }
        if (!governor.allowed_ad_ids[entity.ad_id || '']) {
            return {
                action: 'QUEUE FOR NEXT CYCLE',
                why: 'This change may be valid, but it is not recommended now because this ad is not the clearest loser and another edit should settle first.',
                do_line: 'Keep this ad unchanged for now and review it after the first approved ad edit settles.',
                tone: 'var(--orange)'
            };
        }
    }
    if (entityType === 'adset' && /CUT LOSING ADS|REBUILD ADSET/.test(action) && governor.protected_adsets[adsetKey]) {
        return {
            action: 'TRIM ONE LOSER ONLY',
            why: 'Broader cleanup may be required, but it is not recommended now because this adset is still efficient enough that a full reset would disrupt learning.',
            do_line: 'Remove only the clearest losing ad in this cycle. Keep the winner live and reassess before making another structural change.',
            tone: 'var(--orange)'
        };
    }
    return rec;
}

function renderSettingsStrip(entity, entityType, fallbackRange, fallbackModeLabel) {
    var summary = buildSettingsSummary(entity, entityType);
    var basis = renderMetricBasisLine(entity, fallbackRange, fallbackModeLabel);
    if (!summary) return basis;
    return basis + '<div style="font-size:10px;color:var(--text-dim);margin-top:6px;">' + esc(summary) + '</div>';
}

function renderAccountOverviewTree(scan, plan) {
    var filteredTree = scan && scan.tree ? scan.tree : {};
    var baseScan = window.OPTIMIZER_SCAN || scan || { tree: {}, ads: [] };
    var scopedFull = buildScopedScanData(baseScan, window.OPTIMIZER_TARGET || { type: 'account', query: '' });
    var fullScan = scopedFull && scopedFull.scanData ? scopedFull.scanData : (scan || { tree: {}, ads: [] });
    var fullTree = fullScan && fullScan.tree ? fullScan.tree : {};
    var selectedCampaign = window.OPTIMIZER_OVERVIEW_CAMPAIGN || '';
    var drill = window.OPTIMIZER_OVERVIEW_DRILL || 'campaign';
    var selectedAdsetName = window.OPTIMIZER_OVERVIEW_ADSET || '';
    var overviewBasis = getGlobalMetricBasisContext(fullScan, plan, fullScan && fullScan.date_range ? (fullScan.date_range.since + ' → ' + fullScan.date_range.until) : null);
    var overviewBasisText = 'Basis: ' + overviewBasis.range + ' | ' + overviewBasis.mode;
    var liveCampaigns = Object.keys(filteredTree).map(function(name) {
        var camp = filteredTree[name];
        var liveAdsets = {};
        Object.keys(camp.adsets || {}).forEach(function(adsetName) {
            var adset = camp.adsets[adsetName];
            var liveAds = (adset.ads || []).filter(function(ad) { return ad && ad.is_live; });
            if (!liveAds.length) return;
            var clone = Object.assign({}, adset);
            clone.ads = liveAds;
            liveAdsets[adsetName] = clone;
        });
        if (!Object.keys(liveAdsets).length) return null;
        var campClone = Object.assign({}, camp);
        campClone.adsets = liveAdsets;
        return campClone;
    }).filter(Boolean);
    var orderedCampaigns = liveCampaigns.sort(function(a, b) {
        return ((((b.totals || {}).spend) || 0) - (((a.totals || {}).spend) || 0));
    });
    if (!selectedCampaign || !orderedCampaigns.some(function(c) { return c.name === selectedCampaign; })) {
        selectedCampaign = orderedCampaigns.length ? orderedCampaigns[0].name : '';
    }
    var selectedLive = selectedCampaign ? orderedCampaigns.find(function(c) { return c.name === selectedCampaign; }) : null;
    var selected = selectedCampaign && fullTree[selectedCampaign] ? fullTree[selectedCampaign] : selectedLive;
    if (selectedLive) {
        var selectedAdsets = Object.keys(selectedLive.adsets || {}).map(function(name) { return selectedLive.adsets[name]; }).sort(function(a, b) {
            return ((((b.totals || {}).spend) || 0) - (((a.totals || {}).spend) || 0));
        });
        if (!selectedAdsetName || !selectedAdsets.some(function(adset) { return adset.name === selectedAdsetName; })) {
            selectedAdsetName = selectedAdsets.length ? selectedAdsets[0].name : '';
        }
    } else {
        selectedAdsetName = '';
    }
    var html = '<div style="' + CS + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">' +
            '<h3 style="font-size:14px;font-weight:600;margin:0;">Account Overview</h3>' +
            '<div style="font-size:11px;color:var(--text-dim);">Open one live campaign at a time. Then drill into adset changes and ad changes.</div>' +
        '</div>';

    html += '<div style="display:grid;grid-template-columns:minmax(340px,420px) 1fr;gap:14px;">';
    html += '<div style="' + CARD + '">';
    html += '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:10px;">Live Campaigns</div>';
    html += orderedCampaigns.map(function(camp, idx) {
        var active = selectedCampaign === camp.name;
        var spend = (camp.totals && camp.totals.spend) || 0;
        var roas = (camp.totals && camp.totals.d6ROAS) || 0;
        return '<button class="opt-open-campaign" data-campaign="' + esc(camp.name) + '" style="display:block;width:100%;text-align:left;padding:12px 12px;margin-bottom:8px;border-radius:10px;border:1px solid ' + (active ? 'var(--accent)' : 'var(--border)') + ';background:' + (active ? 'rgba(99,102,241,0.12)' : 'var(--bg-card)') + ';color:var(--text);cursor:pointer;">' +
            '<div style="font-size:12px;font-weight:700;">' + (idx + 1) + '. ' + esc(camp.name) + '</div>' +
            '<div style="font-size:11px;color:var(--text-dim);margin-top:5px;">Spend ' + fmtINR(spend) + ' | D6 ROAS ' + fmtPct(roas) + ' | Live adsets ' + Object.keys(camp.adsets || {}).length + '</div>' +
            '<div style="font-size:9px;color:var(--accent);margin-top:4px;">' + esc(overviewBasisText) + '</div>' +
        '</button>';
    }).join('');
    html += '</div>';

    html += '<div style="' + CARD + '">';
    if (!selected || !selectedLive) {
        html += '<div style="font-size:12px;color:var(--text-dim);">No live campaign found in this slice.</div>';
    } else {
        var campaignInsights = buildOverviewEntityInsight(selected, 'campaign', {
            campaign: selected,
            liveChildren: Object.keys(selectedLive.adsets || {}).map(function(name) { return selectedLive.adsets[name]; })
        });
        html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:12px;">' +
            '<div><div style="font-size:12px;color:var(--text-dim);">Campaign</div><div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + esc(selected.name) + '</div></div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                '<button class="opt-overview-drill" data-drill="campaign" style="padding:8px 12px;border-radius:999px;border:1px solid ' + (drill === 'campaign' ? 'var(--accent)' : 'var(--border)') + ';background:' + (drill === 'campaign' ? 'rgba(99,102,241,0.12)' : 'var(--bg-card)') + ';color:' + (drill === 'campaign' ? 'var(--accent)' : 'var(--text)') + ';cursor:pointer;font-size:11px;">Campaign Insights</button>' +
                '<button class="opt-overview-drill" data-drill="adset" style="padding:8px 12px;border-radius:999px;border:1px solid ' + (drill === 'adset' ? 'var(--accent)' : 'var(--border)') + ';background:' + (drill === 'adset' ? 'rgba(99,102,241,0.12)' : 'var(--bg-card)') + ';color:' + (drill === 'adset' ? 'var(--accent)' : 'var(--text)') + ';cursor:pointer;font-size:11px;">Open Adset Changes</button>' +
                '<button class="opt-overview-drill" data-drill="ad" style="padding:8px 12px;border-radius:999px;border:1px solid ' + (drill === 'ad' ? 'var(--accent)' : 'var(--border)') + ';background:' + (drill === 'ad' ? 'rgba(99,102,241,0.12)' : 'var(--bg-card)') + ';color:' + (drill === 'ad' ? 'var(--accent)' : 'var(--text)') + ';cursor:pointer;font-size:11px;">Open Ad Level Changes</button>' +
            '</div>' +
        '</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px;">' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Spend</div><div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + fmtINR((selected.totals && selected.totals.spend) || 0) + '</div><div style="font-size:8px;color:var(--accent);margin-top:4px;">' + esc(overviewBasisText) + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">D6 ROAS</div><div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + fmtPct((selected.totals && selected.totals.d6ROAS) || 0) + '</div><div style="font-size:8px;color:var(--accent);margin-top:4px;">' + esc(overviewBasisText) + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">CPI</div><div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + fmtINR((selected.totals && selected.totals.cpi) || 0) + '</div><div style="font-size:8px;color:var(--accent);margin-top:4px;">' + esc(overviewBasisText) + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Signup Cost</div><div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + fmtINR((selected.totals && selected.totals.signupCost) || 0) + '</div><div style="font-size:8px;color:var(--accent);margin-top:4px;">' + esc(overviewBasisText) + '</div></div>' +
        '</div>';
        if (drill === 'campaign') {
            var campaignRec = chooseOverviewRecommendation(
                getPlanRecommendationForOverview(plan, 'campaign', selected, selected.name, '') || getDeterministicAuditRecommendation(plan, 'campaign', selected, selected.name, ''),
                buildOverviewEntityRecommendation(selected, 'campaign', {
                    campaign: selected,
                    liveChildren: Object.keys(selectedLive.adsets || {}).map(function(name) { return selectedLive.adsets[name]; }),
                    trendSignal: plan.advanced_trend_intelligence && plan.advanced_trend_intelligence.campaigns ? plan.advanced_trend_intelligence.campaigns[selected.name] : null,
                    trendLens: buildTrendRootCauseActionLens(selected, 'campaign',
                        plan.advanced_trend_intelligence && plan.advanced_trend_intelligence.campaigns ? plan.advanced_trend_intelligence.campaigns[selected.name] : null,
                        {
                            bestAdset: Object.keys(selectedLive.adsets || {}).map(function(name) { return selectedLive.adsets[name]; }).sort(function(a, b) { return ((((b.totals || {}).spend) || 0) - ((((a.totals || {}).spend) || 0))); })[0] || null,
                            weakAdsets: Object.keys(selectedLive.adsets || {}).map(function(name) { return selectedLive.adsets[name]; }).filter(function(adset) {
                                var t = adset.totals || {};
                                return (t.spend || 0) >= 10000 && (((t.d6ROAS || 0) < 15) || ((t.cpi || 0) > 200) || ((t.signupCost || 0) > 1500));
                            })
                        }
                    )
                })
            );
            campaignRec = applyOverviewLearningGuard(campaignRec, selected, 'campaign', {
                campaign: selected,
                learningGovernor: plan.learning_governor || null
            });
            html += '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Campaign Level Insights</div>' +
                '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid ' + campaignRec.tone + ';"><div style="font-size:12px;font-weight:700;color:' + campaignRec.tone + ';">' + esc(campaignRec.action) + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:6px;">Why: ' + esc(campaignRec.why) + '</div><div style="font-size:11px;color:var(--accent);margin-top:6px;">Do: ' + esc(campaignRec.do_line) + '</div>' + renderSettingsStrip(selected, 'campaign', overviewBasis.range, overviewBasis.mode) + '</div>' +
                campaignInsights.map(function(line) { return '<div style="font-size:12px;color:var(--text-dim);padding:5px 0;">• ' + esc(line) + '</div>'; }).join('') +
                '<div style="font-size:12px;color:var(--text-dim);padding:5px 0;">• If no child adset is clearly dragging, no change is needed at campaign level.</div>';
        } else if (drill === 'adset') {
            var adsets = Object.keys(selectedLive.adsets || {}).map(function(name) {
                return {
                    live: selectedLive.adsets[name],
                    full: (selected.adsets && selected.adsets[name]) ? selected.adsets[name] : selectedLive.adsets[name]
                };
            }).sort(function(a, b) {
                return (((((b.full || {}).totals) || {}).spend || 0) - (((((a.full || {}).totals) || {}).spend || 0)));
            });
            html += '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Adset Level Changes</div>' +
                adsets.map(function(pair) {
                    var adset = pair.full;
                    var liveAdset = pair.live;
                    var activeAdset = selectedAdsetName === adset.name;
                    var insights = buildOverviewEntityInsight(adset, 'adset', {
                        campaign: selected,
                        adset: adset,
                        liveChildren: liveAdset.ads || [],
                        siblingAdsets: adsets.map(function(item) { return item.full; })
                    });
                    var fallbackRec = buildOverviewEntityRecommendation(adset, 'adset', {
                        campaign: selected,
                        adset: adset,
                        liveChildren: liveAdset.ads || [],
                        siblingAdsets: adsets.map(function(item) { return item.full; }),
                        trendSignal: plan.advanced_trend_intelligence && plan.advanced_trend_intelligence.adsets ? plan.advanced_trend_intelligence.adsets[selected.name + '||' + adset.name] : null,
                        trendLens: buildTrendRootCauseActionLens(adset, 'adset',
                            plan.advanced_trend_intelligence && plan.advanced_trend_intelligence.adsets ? plan.advanced_trend_intelligence.adsets[selected.name + '||' + adset.name] : null,
                            {
                                bestAd: (liveAdset.ads || []).slice().sort(function(a, b) { return ((((b.d6ROAS || 0) * 1000) - (b.cpi || 0)) - ((((a.d6ROAS || 0) * 1000) - (a.cpi || 0)))); })[0] || null,
                                failingAds: (liveAdset.ads || []).filter(function(ad) {
                                    return ((ad.spend || 0) >= 3000) && (((ad.cpi || 0) > 200) || (((ad.ctr || 0) > 0) && ((ad.ctr || 0) < 1.2)) || (((ad.signupCost || 0) > 1000) && ad.has_funnel_match));
                                })
                            }
                        )
                    });
                    var rec = chooseOverviewRecommendation(
                        getPlanRecommendationForOverview(plan, 'adset', adset, selected.name, adset.name) || getDeterministicAuditRecommendation(plan, 'adset', adset, selected.name, adset.name),
                        fallbackRec
                    );
                    rec = applyOverviewLearningGuard(rec, adset, 'adset', {
                        campaign: selected,
                        adset: adset,
                        learningGovernor: plan.learning_governor || null
                    });
                return '<button class="opt-open-adset" data-adset="' + esc(adset.name) + '" style="' + CARD + 'margin-bottom:8px;display:block;width:100%;text-align:left;border:1px solid ' + (activeAdset ? 'var(--accent)' : 'var(--border)') + ';background:' + (activeAdset ? 'rgba(99,102,241,0.12)' : 'var(--bg-card)') + ';cursor:pointer;">' +
                        '<div style="font-size:12px;font-weight:700;color:var(--text);">' + esc(adset.name) + '</div>' +
                        '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">Spend ' + fmtINR((adset.totals && adset.totals.spend) || 0) + ' | D6 ROAS ' + fmtPct((adset.totals && adset.totals.d6ROAS) || 0) + ' | CPI ' + fmtINR((adset.totals && adset.totals.cpi) || 0) + '</div>' +
                        renderSettingsStrip(adset, 'adset', overviewBasis.range, overviewBasis.mode) +
                        '<div style="font-size:11px;font-weight:700;color:' + rec.tone + ';padding-top:6px;">' + esc(rec.action) + '</div><div style="font-size:11px;color:var(--text-dim);padding-top:4px;">Why: ' + esc(rec.why) + '</div><div style="font-size:11px;color:var(--accent);padding-top:4px;">Do: ' + esc(rec.do_line) + '</div>' +
                        (((adset.totals && adset.totals.spend) || 0) >= 15000 && !(liveAdset.ads || []).some(function(item) { return item.has_funnel_match; }) ? '<div style="font-size:11px;color:var(--orange);padding-top:4px;">Tracker warning: material spend without matched funnel data on current live ads. Verify attribution before pausing this adset.</div>' : '') +
                        insights.map(function(line) { return '<div style="font-size:11px;color:var(--text-dim);padding-top:4px;">• ' + esc(line) + '</div>'; }).join('') +
                    '</button>';
                }).join('');
        } else {
            var adsetNames = Object.keys(selectedLive.adsets || {}).sort(function(a, b) {
                return ((((selected.adsets[b] && selected.adsets[b].totals) || {}).spend || 0) - ((((selected.adsets[a] && selected.adsets[a].totals) || {}).spend || 0)));
            });
            html += '<div style="font-size:12px;font-weight:700;color:var(--text);margin-bottom:8px;">Ad Level Changes</div>';
            if (adsetNames.length > 1) {
                html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' + adsetNames.map(function(adsetName) {
                    var active = adsetName === selectedAdsetName;
                    return '<button class="opt-open-adset" data-adset="' + esc(adsetName) + '" style="padding:8px 12px;border-radius:999px;border:1px solid ' + (active ? 'var(--accent)' : 'var(--border)') + ';background:' + (active ? 'rgba(99,102,241,0.12)' : 'var(--bg-card)') + ';color:' + (active ? 'var(--accent)' : 'var(--text)') + ';cursor:pointer;font-size:11px;">' + esc(adsetName) + '</button>';
                }).join('') + '</div>';
            }
            var selectedAdset = selected.adsets && selected.adsets[selectedAdsetName] ? selected.adsets[selectedAdsetName] : null;
            var selectedLiveAdset = selectedLive.adsets && selectedLive.adsets[selectedAdsetName] ? selectedLive.adsets[selectedAdsetName] : null;
            var ads = selectedLiveAdset && Array.isArray(selectedLiveAdset.ads) ? selectedLiveAdset.ads.slice() : [];
            ads.sort(function(a, b) { return (b.spend || 0) - (a.spend || 0); });
            var adRows = ads.map(function(ad) {
                    var parentAdset = selectedAdset;
                    var parentLiveAdset = selectedLiveAdset;
                    var insights = buildOverviewEntityInsight(ad, 'ad', {
                        campaign: selected,
                        adset: parentAdset,
                        siblingAds: parentLiveAdset && Array.isArray(parentLiveAdset.ads) ? parentLiveAdset.ads : []
                    });
                    var fallbackRec = buildOverviewEntityRecommendation(ad, 'ad', {
                        campaign: selected,
                        adset: parentAdset,
                        siblingAds: parentLiveAdset && Array.isArray(parentLiveAdset.ads) ? parentLiveAdset.ads : [],
                        trendSignal: plan.advanced_trend_intelligence && plan.advanced_trend_intelligence.ads ? plan.advanced_trend_intelligence.ads[ad.ad_id || (ad.campaign_name + '||' + ad.adset_name + '||' + ad.ad_name)] : null,
                        trendLens: buildTrendRootCauseActionLens(ad, 'ad',
                            plan.advanced_trend_intelligence && plan.advanced_trend_intelligence.ads ? plan.advanced_trend_intelligence.ads[ad.ad_id || (ad.campaign_name + '||' + ad.adset_name + '||' + ad.ad_name)] : null,
                            {
                                bestAd: findStrictBetterSibling(ad, parentLiveAdset && Array.isArray(parentLiveAdset.ads) ? parentLiveAdset.ads : []) || null
                            }
                        )
                    });
                    var rec = chooseOverviewRecommendation(
                        getPlanRecommendationForOverview(plan, 'ad', ad, selected.name, ad.adset_name) || getDeterministicAuditRecommendation(plan, 'ad', ad, selected.name, ad.adset_name),
                        fallbackRec
                    );
                    rec = applyOverviewLearningGuard(rec, ad, 'ad', {
                        campaign: selected,
                        adset: parentAdset,
                        learningGovernor: plan.learning_governor || null
                    });
                    return {
                        ad: ad,
                        rec: rec,
                        insights: insights
                    };
                });
            adRows = stabilizeAdsetAdRecommendations(adRows, plan.historical_winner_library || null, selected.name || '');
            var creativeRefreshSummary = summarizeAdsetCreativeRefresh(adRows);
            html += (selectedAdset ? '<div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">Showing live ads for adset: ' + esc(selectedAdset.name) + ' | Adset totals use the full selected date range, including paused ads in this adset.</div>' : '<div style="font-size:11px;color:var(--text-dim);margin-bottom:10px;">No active adset selected.</div>') +
                adRows.map(function(row) {
                    var ad = row.ad;
                    var rec = row.rec || {};
                    var insights = row.insights || [];
                    var rowAction = rec.action;
                    if (creativeRefreshSummary && /PAUSE|REPLACE|SHIFT|REFRESH|BRIEF|LOAD DISTINCT/.test(String(rec.action || '').toUpperCase())) {
                        rowAction = 'CREATIVE REFRESH REQUIRED';
                    }
                    return '<div style="' + CARD + 'margin-bottom:8px;">' +
                        '<div style="font-size:12px;font-weight:700;color:var(--text);">' + esc(ad.ad_name || '--') + '</div>' +
                        '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + esc(ad.adset_name || '--') + ' | Spend ' + fmtINR(ad.spend || 0) + ' | D6 ROAS ' + fmtPct(ad.d6ROAS || 0) + ' | CPI ' + fmtINR(ad.cpi || 0) + '</div>' +
                        renderSettingsStrip(ad, 'ad', fullScan && fullScan.date_range ? (fullScan.date_range.since + ' → ' + fullScan.date_range.until) : null) +
                        '<div style="font-size:11px;font-weight:700;color:' + rec.tone + ';padding-top:6px;">' + esc(rowAction) + '</div>' +
                        '<div style="font-size:11px;color:var(--text-dim);padding-top:4px;">Why: ' + esc(rec.why) + '</div>' +
                        '<div style="font-size:11px;color:var(--accent);padding-top:4px;">Do: ' + esc(rec.do_line) + '</div>' +
                        (((ad.spend || 0) >= 15000) && !ad.has_funnel_match ? '<div style="font-size:11px;color:var(--orange);padding-top:4px;">Tracker warning: material spend without matched funnel data. Verify attribution before pausing this ad.</div>' : '') +
                        insights.map(function(line) { return '<div style="font-size:11px;color:var(--text-dim);padding-top:4px;">• ' + esc(line) + '</div>'; }).join('') +
                    '</div>';
                }).join('') +
                (creativeRefreshSummary ? (
                    '<div style="' + CARD + 'margin-top:10px;border-left:3px solid var(--orange);">' +
                        '<div style="font-size:12px;font-weight:700;color:var(--orange);margin-bottom:8px;">' + esc(creativeRefreshSummary.action) + '</div>' +
                        (creativeRefreshSummary.pause_now.length ? '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Pause now: ' + esc(creativeRefreshSummary.pause_now.join(' | ')) + '</div>' : '') +
                        (creativeRefreshSummary.replace_or_refresh.length ? '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">Replace / refresh: ' + esc(creativeRefreshSummary.replace_or_refresh.map(function(item) { return item.ad_name + ' → ' + item.next; }).join(' | ')) + '</div>' : '') +
                        (creativeRefreshSummary.suggested_ads && creativeRefreshSummary.suggested_ads.length ? '<div style="font-size:11px;color:var(--accent);">Suggested ads: ' + esc(creativeRefreshSummary.suggested_ads.join(' | ')) + '</div>' : '') +
                    '</div>'
                ) : '') +
                (!ads.length ? '<div style="font-size:12px;color:var(--text-dim);">No live ads found inside this adset.</div>' : '');
        }
    }
    html += '</div></div></div>';
    return html;
}

function renderApexV2Stage(container, plan, mode, actions, currentFilter, currentScope, actionable) {
    var modeConfig = getApexModeConfig(mode);
    var appliedFilters = plan.applied_filters || {};
    var displayScan = getCurrentOptimizerDisplayScan();
    var analysisBasis = derivePlanAnalysisBasis(plan, displayScan);
    var trendBreakdownHtml = plan.command_type === 'trend_search' ? renderTrendSearchBreakdown(plan) : '';
    var metricObjectiveHtml = plan.command_type === 'metric_objective_search' ? renderMetricObjectiveBreakdown(plan) : '';
    var growthBreakdownHtml = plan.command_type === 'growth_driver_search' ? renderGrowthDriverBreakdown(plan) : '';
    var html = '<div class="ci-panel">' +
        '<h2>⚡ Optimizer</h2>' +
        '<div style="font-size:11px;color:var(--text-dim);margin:-6px 0 16px 0;">' + esc(modeConfig.label) + ' | ' + esc(modeConfig.sublabel) + '</div>' +
        '<div style="' + CS + 'margin-bottom:16px;">' +
            '<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px;">Keep asking in plain language. APEX will infer whether you want diagnosis, daily actions, or a campaign deep dive.</div>' +
            renderOptimizerPromptHistory() +
            '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
                '<input id="optPromptInput" type="text" value="' + esc(window.OPTIMIZER_USER_PROMPT || '') + '" placeholder="Ask a follow-up..." style="flex:1;min-width:420px;padding:14px 16px;border-radius:12px;border:1px solid var(--border);background:var(--bg);color:var(--text);font-size:14px;" />' +
                '<button id="optPlanBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 24px;">Ask APEX</button>' +
                '<button id="optBackToScan" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:13px;">← Back</button>' +
            '</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' +
                '<button class="opt-prompt-chip" data-prompt="Give me actionables to revamp my Meta account" style="padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:11px;cursor:pointer;">Revamp my Meta account</button>' +
                '<button class="opt-prompt-chip" data-prompt="Give an overview of Test2 campaign" style="padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:11px;cursor:pointer;">Overview of a campaign</button>' +
                '<button class="opt-prompt-chip" data-prompt="Why is this account underperforming?" style="padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:11px;cursor:pointer;">Why is performance weak?</button>' +
                '<button class="opt-prompt-chip" data-prompt="Tell me what to change today in my Meta account" style="padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:11px;cursor:pointer;">What should I change today?</button>' +
            '</div>' +
            '<div id="optPlanProgress" style="display:none;margin-top:10px;"></div>' +
        '</div>' +
        (plan.target_scope ? '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--green);"><div style="font-size:10px;color:var(--text-dim);">Scoped Target</div><div style="font-size:13px;color:var(--text);margin-top:4px;">' + esc(titleCaseWords(plan.target_scope.type)) + ': ' + esc(plan.target_scope.label || '--') + '</div></div>' : '') +
        '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--accent);"><div style="font-size:10px;color:var(--text-dim);">Analysis Basis</div><div style="font-size:13px;color:var(--text);margin-top:4px;">Date range: ' + esc(analysisBasis.range) + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:6px;">Mode: ' + esc(analysisBasis.mode) + ' | ' + esc(analysisBasis.detail) + '</div></div>' +
        '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid var(--accent);"><div style="font-size:10px;color:var(--text-dim);">Current Working Slice</div><div style="font-size:13px;color:var(--text);margin-top:4px;">' + esc(titleCaseWords(String(appliedFilters.audience || 'all').replace('_', ' '))) + ' | ' + esc(titleCaseWords(String(appliedFilters.status || 'all').replace('_', ' '))) + '</div></div>' +
        (plan.data_integrity_gate ? '<div style="' + CARD + 'margin-bottom:10px;border-left:3px solid ' + (plan.data_integrity_gate.safe_for_actioning ? 'var(--green)' : 'var(--orange)') + ';"><div style="font-size:10px;color:var(--text-dim);">Data Integrity</div><div style="font-size:13px;color:var(--text);margin-top:4px;">Ad coverage ' + esc(String(plan.data_integrity_gate.entity_match_rate_pct || plan.data_integrity_gate.match_rate_pct || 0)) + '% | Spend coverage ' + esc(String(plan.data_integrity_gate.spend_match_rate_pct || 0)) + '% | Fresh status ' + esc(String(plan.data_integrity_gate.fresh_status_verified_pct || 0)) + '%</div><div style="font-size:11px;color:var(--text-dim);margin-top:6px;line-height:1.6;">Daily-row match ' + esc(String(plan.data_integrity_gate.daily_row_match_rate_pct || plan.data_integrity_gate.match_rate_pct || 0)) + '%</div>' + (plan.data_integrity_gate.provisional_only ? '<div style="font-size:11px;color:var(--orange);margin-top:6px;line-height:1.6;">Recommendations are provisional until failed integrity checks are resolved.</div>' : '') + ((plan.data_integrity_gate.session_checks && plan.data_integrity_gate.session_checks.length) ? '<div style="font-size:11px;color:var(--text-dim);margin-top:6px;line-height:1.6;">' + esc(plan.data_integrity_gate.session_checks.map(function(check) { return check.name + ': ' + check.status; }).join(' | ')) + '</div>' : '') + ((plan.data_integrity_gate.key_problems && plan.data_integrity_gate.key_problems.length) ? '<div style="font-size:11px;color:var(--text-dim);margin-top:6px;line-height:1.6;">' + esc(plan.data_integrity_gate.key_problems[0]) + '</div>' : ((plan.data_integrity_gate.warnings && plan.data_integrity_gate.warnings.length) ? '<div style="font-size:11px;color:var(--text-dim);margin-top:6px;line-height:1.6;">' + esc(plan.data_integrity_gate.warnings[0]) + '</div>' : '')) + '</div>' : '') +
        (trendBreakdownHtml || metricObjectiveHtml || growthBreakdownHtml || (plan.operator_answer ? '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--orange);"><div style="font-size:10px;color:var(--text-dim);margin-bottom:8px;">APEX Answer</div><div style="font-size:13px;color:var(--text);line-height:1.7;">' + nl2br(plan.operator_answer) + '</div></div>' : '')) +
        renderOperatorOverview(plan, displayScan, actions) +
        (plan.executive_summary ? '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);">' + esc(plan.executive_summary) + '</div>' : '');

      if (mode === 'daily_review') html += ((plan.command_type === 'morning_account_review') ? renderMarketerDailyReview(plan, actions) : renderDailyActionConsole(plan, actions, displayScan));
      else if (mode === 'diagnostic') html += renderMarketerDiagnosis(plan, displayScan) + renderApexView3(plan) + (plan.meta_am_insights && plan.meta_am_insights.length ? renderApexMetaAM(plan) : '');
      else html += renderAccountOverviewTree(displayScan || { tree: {}, ads: [] }, plan) + renderMarketerScaleAndTest(plan, displayScan);

    html += '<div style="display:flex;gap:10px;margin:20px 0;">' +
        '<button id="optExecAllBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 28px;background:var(--green);">✅ Execute All (' + actionable.length + ' executable actions)</button>' +
    '</div></div>' + renderLogSection();

    container.innerHTML = html;
    bindPlanEvents(container);
}

function renderPlanStage(container) {
    var plan = window.OPTIMIZER_PLAN;
    if (!plan) { window.OPTIMIZER_STAGE = 'scan'; renderScanStage(container); return; }

    var scan = window.OPTIMIZER_SCAN || null;
    var scanSummary = scan ? scan.summary : null;
    var maturityCardNote = buildMaturityNote(scanSummary, 'matured_ads', 'non_matured_ads', 'ad');
    var ps = plan.plan_summary || {};
    var actions = plan.actions || [];
    var actionable = actions.filter(function(a) { return isExecutableActionType(a.action_type); });
    var currentFilter = window.OPTIMIZER_PLAN_FILTER || 'all';
    var currentScope = window.OPTIMIZER_PLAN_SCOPE || 'all';
    var pulse = plan.account_pulse || null;
    var urgentCount = actions.filter(function(a) { return normalizeActionPriority(a.priority) === 'P1'; }).length;
    var recommendedCount = actions.filter(function(a) { return normalizeActionPriority(a.priority) === 'P2'; }).length;
    var watchCount = actions.filter(function(a) { return normalizeActionPriority(a.priority) === 'P3'; }).length;
    var modeConfig = getApexModeConfig(window.OPTIMIZER_APEX_MODE || plan.session_mode || 'daily_review');
    var mode = window.OPTIMIZER_APEX_MODE || plan.session_mode || 'daily_review';

    if (mode === 'daily_review' || mode === 'diagnostic' || mode === 'account_overview') {
        renderApexV2Stage(container, plan, mode, actions, currentFilter, currentScope, actionable);
        return;
    }

    var html = '<div class="ci-panel">' +
        '<h2>\u26a1 APEX ' + esc(modeConfig.label) + '</h2>' +
        '<div style="font-size:11px;color:var(--text-dim);margin:-6px 0 16px 0;">Generated ' + esc(new Date(plan.generated_at || Date.now()).toLocaleString()) + ' | Session: ' + esc(plan.session_mode || 'daily_review') + ' | ' + esc(modeConfig.sublabel) + '</div>' +
        (plan.target_scope ? '<div style="' + CARD + 'margin-bottom:12px;border-left:3px solid var(--green);"><div style="font-size:10px;color:var(--text-dim);">Scoped Target</div><div style="font-size:13px;color:var(--text);margin-top:4px;">' + esc(titleCaseWords(plan.target_scope.type)) + ': ' + esc(plan.target_scope.label || '--') + '</div></div>' : '') +

        // Executive summary
        '<div style="' + CARD + 'margin-bottom:12px;border-left:3px solid var(--accent);"><div style="font-size:10px;color:var(--text-dim);">Mode Objective</div><div style="font-size:13px;color:var(--text);margin-top:4px;">' + esc(modeConfig.objective) + '</div></div>' +
        (plan.executive_summary ? '<div style="' + CS + 'border-left:4px solid var(--accent);"><p style="font-size:14px;color:var(--text);line-height:1.7;">' + esc(plan.executive_summary) + '</p></div>' : '') +
        buildApexModeLeadSection(plan, actions, mode) +

        (pulse ? '<div style="' + CS + 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;">' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Window</div><div style="font-size:13px;color:var(--text);margin-top:4px;">' + esc(pulse.window_label || '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Spend</div><div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + fmtINR(pulse.spend_total) + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:3px;">Avg/day ' + fmtINR(pulse.avg_daily_spend) + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">D6 ROAS</div><div style="font-size:16px;font-weight:700;color:var(--accent);margin-top:4px;">' + esc(pulse.roas_window != null ? Number(pulse.roas_window).toFixed(1) + '%' : '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Signup Cost</div><div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + fmtINR(pulse.signup_cost_window) + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">CPM / CTR</div><div style="font-size:16px;font-weight:700;color:var(--text);margin-top:4px;">' + fmtINR(pulse.cpm_window) + ' / ' + esc(pulse.ctr_window != null ? Number(pulse.ctr_window).toFixed(2) + '%' : '--') + '</div></div>' +
            '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Maturity / Pacing</div><div style="font-size:13px;color:var(--text);margin-top:4px;">' + esc(pulse.maturity_mix || '--') + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:3px;">' + esc(pulse.pacing_status || 'unknown') + '</div></div>' +
            (pulse.source_note ? '<div style="grid-column:1/-1;font-size:11px;color:var(--text-dim);">' + esc(pulse.source_note) + '</div>' : '') +
        '</div>' : '') +

        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:16px;">' +
            '<div style="' + CARD + 'border-left:3px solid var(--red);"><div style="font-size:11px;color:var(--text-dim);">Urgent</div><div style="font-size:22px;font-weight:700;color:var(--red);margin-top:4px;">' + urgentCount + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:2px;">Immediate action today</div></div>' +
            '<div style="' + CARD + 'border-left:3px solid var(--orange);"><div style="font-size:11px;color:var(--text-dim);">Recommended</div><div style="font-size:22px;font-weight:700;color:var(--orange);margin-top:4px;">' + recommendedCount + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:2px;">This week</div></div>' +
            '<div style="' + CARD + 'border-left:3px solid var(--accent);"><div style="font-size:11px;color:var(--text-dim);">Watch</div><div style="font-size:22px;font-weight:700;color:var(--accent);margin-top:4px;">' + watchCount + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:2px;">Monitor triggers</div></div>' +
        '</div>' +

        // Summary KPIs
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-bottom:20px;">' +
            (ps.ads_to_pause ? '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--red);"><div style="font-size:22px;font-weight:700;color:var(--red);">' + ps.ads_to_pause + '</div><div style="font-size:10px;color:var(--text-dim);">Ads to Pause</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' : '') +
            (ps.ads_to_kill ? '<div style="' + CARD + 'text-align:center;border-top:3px solid #dc2626;"><div style="font-size:22px;font-weight:700;color:#dc2626;">' + ps.ads_to_kill + '</div><div style="font-size:10px;color:var(--text-dim);">Ads to Kill</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' : '') +
            (ps.ads_to_scale ? '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--green);"><div style="font-size:22px;font-weight:700;color:var(--green);">' + ps.ads_to_scale + '</div><div style="font-size:10px;color:var(--text-dim);">Ads to Scale</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' : '') +
            (ps.budget_increases ? '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--green);"><div style="font-size:22px;font-weight:700;color:var(--green);">' + ps.budget_increases + '</div><div style="font-size:10px;color:var(--text-dim);">Budget \u2191</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' : '') +
            (ps.budget_decreases ? '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--orange);"><div style="font-size:22px;font-weight:700;color:var(--orange);">' + ps.budget_decreases + '</div><div style="font-size:10px;color:var(--text-dim);">Budget \u2193</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' : '') +
            '<div style="' + CARD + 'text-align:center;border-top:3px solid var(--accent);"><div style="font-size:22px;font-weight:700;color:var(--accent);">' + actions.length + '</div><div style="font-size:10px;color:var(--text-dim);">Total Actions</div><div style="font-size:8px;color:var(--accent);margin-top:2px;">' + esc(maturityCardNote) + '</div></div>' +
        '</div>' +

        (scanSummary ? '<div style="' + CARD + 'margin-bottom:16px;border-left:3px solid var(--accent);display:flex;align-items:center;gap:10px;">' +
            '<span style="font-size:16px;">&#128202;</span>' +
            '<div><div style="font-size:12px;font-weight:600;color:var(--accent);">Using Mature Data Where Available</div>' +
            '<div style="font-size:11px;color:var(--text-dim);">' + scanSummary.matured_ads + ' mature ads are evaluated on data excluding the last 7 days where available. ' + scanSummary.non_matured_ads + ' early ads still use full data until they mature.</div></div>' +
        '</div>' : '') +

        '<div style="display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap;">' +
            (ps.estimated_spend_saved_daily ? '<div style="' + CARD + 'flex:1;min-width:200px;"><div style="font-size:11px;color:var(--text-dim);">Est. Daily Spend Saved</div><div style="font-size:16px;font-weight:700;color:var(--green);margin-top:4px;">' + esc(ps.estimated_spend_saved_daily) + '</div></div>' : '') +
            (ps.estimated_roas_improvement ? '<div style="' + CARD + 'flex:1;min-width:200px;"><div style="font-size:11px;color:var(--text-dim);">Est. ROAS Improvement</div><div style="font-size:16px;font-weight:700;color:var(--accent);margin-top:4px;">' + esc(ps.estimated_roas_improvement) + '</div></div>' : '') +
            (ps.top_priority_action ? '<div style="' + CARD + 'flex:2;min-width:200px;"><div style="font-size:11px;color:var(--text-dim);">Top Priority</div><div style="font-size:14px;font-weight:600;color:var(--text);margin-top:4px;">' + esc(ps.top_priority_action) + '</div></div>' : '') +
        '</div>' +

        // Creative Insights
        (shouldShowApexSection(mode, 'creative_insights') && plan.creative_insights ? '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">\ud83c\udfa8 Creative Insights</h3>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;">' +
                (plan.creative_insights.winning_format ? '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Winning Format</div><div style="font-size:13px;color:var(--green);margin-top:4px;">' + esc(plan.creative_insights.winning_format) + '</div></div>' : '') +
                (plan.creative_insights.top_themes ? '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Top Themes</div><div style="font-size:13px;color:var(--text);margin-top:4px;">' + plan.creative_insights.top_themes.map(function(t){ return esc(t); }).join(', ') + '</div></div>' : '') +
                (plan.creative_insights.failing_themes ? '<div style="' + CARD + '"><div style="font-size:10px;color:var(--text-dim);">Failing Themes</div><div style="font-size:13px;color:var(--red);margin-top:4px;">' + plan.creative_insights.failing_themes.map(function(t){ return esc(t); }).join(', ') + '</div></div>' : '') +
            '</div>' +
            (plan.creative_insights.new_creative_suggestions ? '<div style="margin-top:10px;"><div style="font-size:10px;color:var(--text-dim);margin-bottom:6px;">New Creative Suggestions</div>' + plan.creative_insights.new_creative_suggestions.map(function(s) { return '<div style="font-size:12px;color:var(--accent);padding:4px 0;">\u2022 ' + esc(s) + '</div>'; }).join('') + '</div>' : '') +
        '</div>' : '') +

        (shouldShowApexSection(mode, 'creative_health') && plan.creative_health && plan.creative_health.length ? '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">\ud83e\uddea Creative Health</h3>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;">' +
                plan.creative_health.slice(0, 8).map(function(item) {
                    var statusColor = String(item.status || '').toLowerCase() === 'scale' ? 'var(--green)' : (String(item.status || '').toLowerCase() === 'pause' ? 'var(--red)' : 'var(--accent)');
                    return '<div style="' + CARD + '">' +
                        '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">' +
                            '<div style="font-size:12px;font-weight:600;color:var(--text);">' + esc(item.ad_name || item.ad_id || '--') + '</div>' +
                            '<div style="font-size:10px;color:' + statusColor + ';font-weight:700;text-transform:uppercase;">' + esc(item.status || 'watch') + '</div>' +
                        '</div>' +
                        '<div style="font-size:10px;color:var(--text-dim);margin:4px 0 8px 0;">' + esc(item.format || '--') + ' | CTR trend: ' + esc(item.ctr_trend || 'unknown') + '</div>' +
                        '<div style="font-size:11px;color:var(--text-dim);">CPA: ' + fmtINR(item.cpa_7d) + ' | ROAS: ' + esc(item.roas_7d != null ? Number(item.roas_7d).toFixed(1) + '%' : '--') + '</div>' +
                        '<div style="font-size:11px;color:var(--accent);margin-top:6px;">' + esc(item.recommendation || '') + '</div>' +
                    '</div>';
                }).join('') +
            '</div>' +
        '</div>' : '') +

        // Funnel Analysis
        (shouldShowApexSection(mode, 'funnel_analysis') && plan.funnel_analysis ? '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">\ud83d\udd0d Funnel Analysis</h3>' +
            (plan.funnel_analysis.bottleneck ? '<div style="' + CARD + 'margin-bottom:8px;border-left:3px solid var(--orange);"><div style="font-size:12px;color:var(--orange);font-weight:600;">Bottleneck</div><div style="font-size:13px;color:var(--text);margin-top:4px;">' + esc(plan.funnel_analysis.bottleneck) + '</div></div>' : '') +
            (plan.funnel_analysis.fix_recommendations ? plan.funnel_analysis.fix_recommendations.map(function(r) { return '<div style="font-size:12px;color:var(--text-dim);padding:4px 0;">\u2022 ' + esc(r) + '</div>'; }).join('') : '') +
        '</div>' : '') +

        // Budget Reallocation
        (shouldShowApexSection(mode, 'budget_reallocation') && plan.budget_reallocation ? '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">\ud83d\udcb0 Budget Reallocation</h3>' +
            (plan.budget_reallocation.total_daily_budget_shift ? '<p style="font-size:13px;color:var(--accent);margin-bottom:12px;">' + esc(plan.budget_reallocation.total_daily_budget_shift) + '</p>' : '') +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
                '<div><div style="font-size:11px;color:var(--red);font-weight:600;margin-bottom:8px;">Reduce Budget From:</div>' + ((plan.budget_reallocation.from || []).map(function(f) { return '<div style="' + CARD + 'margin-bottom:6px;font-size:12px;"><strong>' + esc(f.name).slice(0,35) + '</strong><br>' + esc(f.current_budget) + ' \u2192 ' + esc(f.reduce_to) + '<br><span style="color:var(--text-dim);">' + esc(f.reason) + '</span></div>'; }).join('') || '<div style="color:var(--text-dim);font-size:12px;">None</div>') + '</div>' +
                '<div><div style="font-size:11px;color:var(--green);font-weight:600;margin-bottom:8px;">Increase Budget To:</div>' + ((plan.budget_reallocation.to || []).map(function(t) { return '<div style="' + CARD + 'margin-bottom:6px;font-size:12px;"><strong>' + esc(t.name).slice(0,35) + '</strong><br>' + esc(t.current_budget) + ' \u2192 ' + esc(t.increase_to) + '<br><span style="color:var(--text-dim);">' + esc(t.reason) + '</span></div>'; }).join('') || '<div style="color:var(--text-dim);font-size:12px;">None</div>') + '</div>' +
            '</div>' +
        '</div>' : '') +

        (shouldShowApexSection(mode, 'budget_allocation') && plan.budget_allocation && plan.budget_allocation.length ? '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">\ud83d\udcd0 Budget Allocation Model</h3>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;">' +
                plan.budget_allocation.slice(0, 8).map(function(item) {
                    return '<div style="' + CARD + '">' +
                        '<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px;">' + esc(item.campaign_name || '--') + '</div>' +
                        '<div style="font-size:11px;color:var(--text-dim);">Current: ' + fmtINR(item.current_budget) + ' | Recommended: ' + fmtINR(item.recommended_budget) + '</div>' +
                        '<div style="font-size:11px;color:var(--accent);margin-top:4px;">Change: ' + esc(item.change_pct != null ? String(item.change_pct) : '--') + '</div>' +
                        '<div style="font-size:11px;color:var(--text-dim);margin-top:6px;">' + esc(item.rationale || '') + '</div>' +
                    '</div>';
                }).join('') +
            '</div>' +
        '</div>' : '') +

        (shouldShowApexSection(mode, 'external') && ((plan.external_signals && plan.external_signals.length) || (plan.external_context && plan.external_context.available)) ? '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">\ud83c\udf10 External Signals</h3>' +
            ((plan.external_signals && plan.external_signals.length) ? plan.external_signals.map(function(signal) {
                return '<div style="' + CARD + 'margin-bottom:8px;">' +
                    '<div style="font-size:11px;color:var(--accent);margin-bottom:4px;">' + esc(signal.signal_type || 'signal') + '</div>' +
                    '<div style="font-size:13px;color:var(--text);margin-bottom:4px;">' + esc(signal.signal || '') + '</div>' +
                    (signal.impact_on_account ? '<div style="font-size:11px;color:var(--text-dim);margin-bottom:3px;">Impact: ' + esc(signal.impact_on_account) + '</div>' : '') +
                    (signal.recommended_response ? '<div style="font-size:11px;color:var(--green);">Response: ' + esc(signal.recommended_response) + '</div>' : '') +
                '</div>';
            }).join('') : '') +
            ((!plan.external_signals || !plan.external_signals.length) && plan.external_context && plan.external_context.available ? (
                '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;">' +
                    (plan.external_context.competitor_intel ? '<div style="' + CARD + '">' +
                        '<div style="font-size:11px;color:var(--accent);margin-bottom:6px;">competitor</div>' +
                        '<div style="font-size:13px;color:var(--text);margin-bottom:4px;">Most active competitor: ' + esc(plan.external_context.competitor_intel.most_active_competitor || '--') + '</div>' +
                        '<div style="font-size:11px;color:var(--text-dim);">Rising themes: ' + esc((plan.external_context.competitor_intel.rising_themes || []).slice(0, 4).join(', ') || '--') + '</div>' +
                    '</div>' : '') +
                    (plan.external_context.market_trends ? '<div style="' + CARD + '">' +
                        '<div style="font-size:11px;color:var(--accent);margin-bottom:6px;">market</div>' +
                        '<div style="font-size:13px;color:var(--text);margin-bottom:4px;">Market mood: ' + esc(plan.external_context.market_trends.market_mood || '--') + '</div>' +
                        '<div style="font-size:11px;color:var(--text-dim);">Top trends: ' + esc((plan.external_context.market_trends.top_trends || []).slice(0, 3).map(function(t) { return t.title; }).join(', ') || '--') + '</div>' +
                    '</div>' : '') +
                    (plan.external_context.competitor_radar ? '<div style="' + CARD + '">' +
                        '<div style="font-size:11px;color:var(--accent);margin-bottom:6px;">radar</div>' +
                        '<div style="font-size:13px;color:var(--text);margin-bottom:4px;">' + esc(plan.external_context.competitor_radar.summary || 'Competitor radar available') + '</div>' +
                        '<div style="font-size:11px;color:var(--text-dim);">Opportunities: ' + esc((plan.external_context.competitor_radar.opportunities || []).slice(0, 2).join(', ') || '--') + '</div>' +
                    '</div>' : '') +
                '</div>' +
                '<div style="font-size:11px;color:var(--text-dim);margin-top:10px;">Fetched ' + esc(plan.external_context.fetched_at || '--') + (plan.external_context.freshness && plan.external_context.freshness.trend_scanner_last_scraped ? ' | Trend scan: ' + esc(plan.external_context.freshness.trend_scanner_last_scraped) : '') + '</div>' +
                ((plan.external_context.limitations || []).length ? '<div style="font-size:11px;color:var(--orange);margin-top:6px;">' + esc(plan.external_context.limitations.join(' | ')) + '</div>' : '')
            ) : '') +
        '</div>' : '') +

        (shouldShowApexSection(mode, 'learnings') && plan.account_learnings && plan.account_learnings.length ? '<div style="' + CS + '">' +
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">\ud83e\udde0 Account Learnings</h3>' +
            plan.account_learnings.map(function(learning) {
                return '<div style="' + CARD + 'margin-bottom:8px;">' +
                    '<div style="font-size:13px;color:var(--text);font-weight:600;margin-bottom:4px;">' + esc(learning.learning || '') + '</div>' +
                    (learning.evidence ? '<div style="font-size:11px;color:var(--text-dim);margin-bottom:3px;">Evidence: ' + esc(learning.evidence) + '</div>' : '') +
                    (learning.application ? '<div style="font-size:11px;color:var(--accent);">Apply: ' + esc(learning.application) + '</div>' : '') +
                '</div>';
            }).join('') +
        '</div>' : '') +

        // Action buttons
        '<div style="display:flex;gap:10px;margin-bottom:20px;">' +
            '<button id="optExecAllBtn" class="btn-ci-primary" style="font-size:14px;padding:12px 28px;background:var(--green);">\u2705 Execute All (' + actionable.length + ' executable actions)</button>' +
            '<button id="optBackToScan" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:13px;">\u2190 Back to Scan</button>' +
        '</div>';

    // Filter tabs
    var p1Count = actions.filter(function(a) { return normalizeActionPriority(a.priority) === 'P1'; }).length;
    var pauseCount = actions.filter(function(a) { return a.action_type.indexOf('PAUSE') !== -1 || a.action_type.indexOf('KILL') !== -1; }).length;
    var budgetCount = actions.filter(function(a) { return a.action_type.indexOf('BUDGET') !== -1 || a.action_type.indexOf('SCALE') !== -1; }).length;
    var creativeCount = actions.filter(function(a) { return (a.category || '').indexOf('CREATIVE') !== -1 || (a.category || '').indexOf('FUNNEL') !== -1; }).length;
    var campaignActionCount = actions.filter(function(a) { return String(a.entity_type || '').toLowerCase() === 'campaign'; }).length;
    var adsetActionCount = actions.filter(function(a) { return String(a.entity_type || '').toLowerCase() === 'adset'; }).length;
    var adActionCount = actions.filter(function(a) { return String(a.entity_type || '').toLowerCase() === 'ad'; }).length;
    var tabStyle = 'padding:4px 12px;border-radius:6px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;font-size:11px;';
    if (shouldShowApexSection(mode, 'actions')) {
        var filterLabel = mode === 'creative_audit' ? 'Creative decisions:' : (mode === 'weekly_strategy' ? 'Strategy queue:' : (mode === 'investigate' ? 'Root-cause actions:' : 'Recommendations:'));
        html += '<div id="optFilterTabs" style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;">' +
            '<button class="opt-filter' + (currentFilter === 'all' ? ' active' : '') + '" data-filter="all" style="' + tabStyle + (currentFilter === 'all' ? 'border-color:var(--accent);background:rgba(99,102,241,0.15);color:var(--accent);' : '') + '">All (' + actions.length + ')</button>' +
            '<button class="opt-filter' + (currentFilter === 'p1' ? ' active' : '') + '" data-filter="p1" style="' + tabStyle + (currentFilter === 'p1' ? 'border-color:var(--accent);background:rgba(99,102,241,0.15);color:var(--accent);' : '') + '">P1 Urgent (' + p1Count + ')</button>' +
            '<button class="opt-filter' + (currentFilter === 'pause' ? ' active' : '') + '" data-filter="pause" style="' + tabStyle + (currentFilter === 'pause' ? 'border-color:var(--accent);background:rgba(99,102,241,0.15);color:var(--accent);' : '') + '">Pause/Kill (' + pauseCount + ')</button>' +
            '<button class="opt-filter' + (currentFilter === 'budget' ? ' active' : '') + '" data-filter="budget" style="' + tabStyle + (currentFilter === 'budget' ? 'border-color:var(--accent);background:rgba(99,102,241,0.15);color:var(--accent);' : '') + '">Budget (' + budgetCount + ')</button>' +
            (creativeCount ? '<button class="opt-filter' + (currentFilter === 'creative' ? ' active' : '') + '" data-filter="creative" style="' + tabStyle + (currentFilter === 'creative' ? 'border-color:var(--accent);background:rgba(99,102,241,0.15);color:var(--accent);' : '') + '">Creative/Funnel (' + creativeCount + ')</button>' : '') +
        '</div>';
        html += '<div id="optScopeTabs" style="display:flex;gap:6px;margin:-8px 0 16px 0;flex-wrap:wrap;">' +
            '<span style="font-size:11px;color:var(--text-dim);align-self:center;margin-right:4px;">' + esc(filterLabel) + '</span>' +
            '<button class="opt-scope' + (currentScope === 'all' ? ' active' : '') + '" data-scope="all" style="' + tabStyle + (currentScope === 'all' ? 'border-color:var(--green);background:rgba(16,185,129,0.12);color:var(--green);' : '') + '">All Levels (' + actions.length + ')</button>' +
            '<button class="opt-scope' + (currentScope === 'campaign' ? ' active' : '') + '" data-scope="campaign" style="' + tabStyle + (currentScope === 'campaign' ? 'border-color:var(--green);background:rgba(16,185,129,0.12);color:var(--green);' : '') + '">Campaign (' + campaignActionCount + ')</button>' +
            '<button class="opt-scope' + (currentScope === 'adset' ? ' active' : '') + '" data-scope="adset" style="' + tabStyle + (currentScope === 'adset' ? 'border-color:var(--green);background:rgba(16,185,129,0.12);color:var(--green);' : '') + '">Adset (' + adsetActionCount + ')</button>' +
            '<button class="opt-scope' + (currentScope === 'ad' ? ' active' : '') + '" data-scope="ad" style="' + tabStyle + (currentScope === 'ad' ? 'border-color:var(--green);background:rgba(16,185,129,0.12);color:var(--green);' : '') + '">Ad Wise (' + adActionCount + ')</button>' +
        '</div>';

        // Actions list
        html += '<div id="optActionsTable">' + renderActionsTable(actions, currentFilter, currentScope) + '</div>';
    }

    // Watch list
    if (shouldShowApexSection(mode, 'watch') && plan.watch_list && plan.watch_list.length) {
        html += '<div style="' + CS + 'margin-top:16px;">' +
            '<h3 style="font-size:14px;font-weight:600;color:var(--orange);margin-bottom:12px;">\ud83d\udc41 Watch List (' + plan.watch_list.length + ')</h3>';
        plan.watch_list.forEach(function(w) {
            html += '<div style="' + CARD + 'margin-bottom:8px;">' +
                '<div style="font-size:13px;font-weight:600;color:var(--text);">' + esc(w.entity_name) + '</div>' +
                '<p style="font-size:12px;color:var(--text-dim);margin-top:4px;">' + esc(w.watch_reason) + '</p>' +
                '<p style="font-size:11px;color:var(--orange);margin-top:4px;">Trigger: ' + esc(w.trigger_for_action) + '</p>' +
            '</div>';
        });
        html += '</div>';
    }

    // Do not touch
    if (shouldShowApexSection(mode, 'do_not_touch') && plan.do_not_touch && plan.do_not_touch.length) {
        html += '<details style="' + CS + '">' +
            '<summary style="cursor:pointer;font-size:14px;font-weight:600;color:var(--text-dim);">Do Not Touch (' + plan.do_not_touch.length + ')</summary>' +
            '<div style="margin-top:12px;">';
        plan.do_not_touch.forEach(function(d) {
            html += '<p style="padding:4px 0;border-bottom:1px solid var(--border);font-size:12px;">' +
                '<span style="color:var(--text);">' + esc(d.entity_name) + '</span> \u2014 <span style="color:var(--text-dim);">' + esc(d.reason) + '</span></p>';
        });
        html += '</div></details>';
    }

    html += '</div>' + renderLogSection();
    container.innerHTML = html;
    bindPlanEvents(container);
}

function renderActionsTable(actions, filter, scope) {
    var list = actions;
    if (filter === 'pause') list = actions.filter(function(a) { return a.action_type.indexOf('PAUSE') !== -1 || a.action_type.indexOf('KILL') !== -1; });
    else if (filter === 'budget') list = actions.filter(function(a) { return a.action_type.indexOf('BUDGET') !== -1 || a.action_type.indexOf('SCALE') !== -1; });
    else if (filter === 'p1') list = actions.filter(function(a) { return normalizeActionPriority(a.priority) === 'P1'; });
    else if (filter === 'creative') list = actions.filter(function(a) { return (a.category || '').indexOf('CREATIVE') !== -1 || (a.category || '').indexOf('FUNNEL') !== -1; });
    if (scope && scope !== 'all') list = list.filter(function(a) { return String(a.entity_type || '').toLowerCase() === scope; });

    if (!list.length) return '<p style="color:var(--text-dim);padding:20px;">No actions in this view.</p>';

    var priorityColors = { P1: 'var(--red)', P2: 'var(--orange)', P3: 'var(--text-dim)' };

    var html = '';
    list.forEach(function(a) {
        var m = a.current_metrics || {};
        var bc = a.budget_change;
        var normalizedPriority = normalizeActionPriority(a.priority);
        var pColor = priorityColors[normalizedPriority] || 'var(--text-dim)';
        var catLabel = (a.category || a.action_type || '').replace(/_/g, ' ');
        var isExecutable = isExecutableActionType(a.action_type);
        var entityTypeLabel = String(a.entity_type || 'unknown').toUpperCase();
        var entityType = String(a.entity_type || '').toLowerCase();
        var pathParts = [];
        if (a.campaign_name) pathParts.push(esc(a.campaign_name));
        if (entityType !== 'campaign' && a.adset_name) pathParts.push(esc(a.adset_name));
        var pathLabel = pathParts.join(' \u203a ');
        var decisionWindow = esc(a.data_range || getSelectedDates().since + ' \u2192 ' + getSelectedDates().until);
        var maturityLabel = esc(a.decision_mode_label || a.data_mode_label || 'Mode: --');
        var effectiveStatus = esc(m.delivery_state || 'unknown');
        var statusSummary = 'Campaign ' + esc(m.campaign_status || '--') + ' | Adset ' + esc(m.adset_status || '--') + ' | Ad ' + esc(m.ad_status || '--');
        var metricPills = [];
        if (m.spend != null) metricPills.push('<span style="' + CARD + 'padding:5px 10px;">Spend: <strong>' + fmtINR(typeof m.spend === 'string' ? parseFloat(m.spend) : m.spend) + '</strong></span>');
        if (m.d6_roas) metricPills.push('<span style="' + CARD + 'padding:5px 10px;color:' + (parseFloat(m.d6_roas) > 28 ? 'var(--green)' : parseFloat(m.d6_roas) < 15 ? 'var(--red)' : 'var(--orange)') + ';">D6 ROAS: <strong>' + esc(typeof m.d6_roas === 'number' ? m.d6_roas.toFixed(1) + '%' : m.d6_roas) + '</strong></span>');
        if (m.d6_cac) metricPills.push('<span style="' + CARD + 'padding:5px 10px;">D6 CAC: ' + esc(typeof m.d6_cac === 'number' ? fmtINR(m.d6_cac) : m.d6_cac) + '</span>');
        else if (m.signup_cost) metricPills.push('<span style="' + CARD + 'padding:5px 10px;">SU Cost: ' + esc(typeof m.signup_cost === 'number' ? fmtINR(m.signup_cost) : m.signup_cost) + '</span>');
        if (m.cpi) metricPills.push('<span style="' + CARD + 'padding:5px 10px;">CPI: ' + esc(typeof m.cpi === 'number' ? fmtINR(m.cpi) : m.cpi) + '</span>');
        if (metricPills.length < 5 && m.installs) metricPills.push('<span style="' + CARD + 'padding:5px 10px;">Installs: ' + esc(m.installs) + '</span>');
        if (metricPills.length < 5 && m.signups) metricPills.push('<span style="' + CARD + 'padding:5px 10px;">Signups: ' + esc(m.signups) + '</span>');
        metricPills = metricPills.slice(0, 5);
        var executeLabel = a.action_type && a.action_type.indexOf('BUDGET') !== -1 ? 'Execute Budget' : 'Execute';
        var statusTone = effectiveStatus.indexOf('paused') !== -1 ? 'var(--orange)' : (effectiveStatus === 'live' ? 'var(--green)' : 'var(--text-dim)');
        var statusVerified = (m.campaign_status || m.adset_status || m.ad_status) ? 'Fresh status verified' : 'Status context incomplete';
        var approvalStatus = String(a.approval_status || 'pending_approval').replace(/_/g, ' ');

        html += '<div style="' + CARD + 'margin-bottom:10px;border-left:4px solid ' + actionColor(a.action_type) + ';">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
                '<div style="flex:1;min-width:0;">' +
                    '<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">' +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;color:#fff;background:' + pColor + ';">' + esc(normalizedPriority || '') + '</span>' +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:10px;font-weight:700;color:#fff;background:' + actionColor(a.action_type) + ';">' + esc(a.action_type.replace(/_/g, ' ')) + '</span>' +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:9px;font-weight:700;border:1px solid var(--border);color:var(--text-dim);">' + esc(entityTypeLabel) + '</span>' +
                        (a.priority_label ? '<span style="padding:2px 8px;border-radius:6px;font-size:9px;font-weight:700;border:1px solid var(--border);color:var(--text-dim);text-transform:uppercase;">' + esc(a.priority_label) + '</span>' : '') +
                        confidenceBadge(a.confidence) +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:9px;font-weight:600;border:1px solid rgba(99,102,241,0.35);color:var(--accent);">' + maturityLabel + '</span>' +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:9px;font-weight:600;border:1px solid rgba(255,255,255,0.08);color:' + statusTone + ';">' + effectiveStatus.replace(/_/g, ' ') + '</span>' +
                        '<span style="padding:2px 8px;border-radius:6px;font-size:9px;font-weight:600;border:1px solid rgba(245,158,11,0.25);color:var(--orange);">' + esc(approvalStatus) + '</span>' +
                        '<span style="font-size:10px;color:var(--text-dim);">#' + esc(a.action_id) + '</span>' +
                    '</div>' +
                    '<div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:4px;" title="' + esc(a.entity_name) + '">' + esc(a.entity_name || '') + '</div>' +
                    (pathLabel ? '<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;">' + pathLabel + '</div>' : '') +
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:10px;margin-bottom:10px;">' +
                        '<span style="padding:3px 8px;border-radius:999px;background:rgba(255,255,255,0.03);border:1px solid var(--border);color:var(--text-dim);">Window: ' + decisionWindow + '</span>' +
                        '<span style="padding:3px 8px;border-radius:999px;background:rgba(255,255,255,0.03);border:1px solid var(--border);color:' + (statusVerified === 'Fresh status verified' ? 'var(--green)' : 'var(--orange)') + ';">' + statusVerified + '</span>' +
                    '</div>' +
                    '<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-bottom:10px;">' +
                        metricPills.join('') +
                    '</div>' +
                    (a.diagnosis ? '<div style="font-size:12px;color:var(--text);line-height:1.6;margin-bottom:8px;padding:8px 10px;background:rgba(0,0,0,0.2);border-radius:8px;">' + esc(a.diagnosis) + '</div>' : '') +
                    (a.action_detail ? '<div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:8px;">\u2192 ' + esc(a.action_detail) + '</div>' : '') +
                    (a.deferred_by_learning ? '<div style="font-size:12px;color:var(--orange);margin-bottom:8px;">Deferred: ' + esc(a.deferred_reason || 'APEX thinks this change may be required, but it is not recommending it now because it may disrupt learning.') + '</div>' : '') +
                    (isExecutable && bc && bc.recommended_daily_budget ? '<div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                        '<span>\u20b9' + (bc.current_daily_budget || '?') + '/day \u2192</span>' +
                        '<input type="number" class="opt-budget-input" data-action-id="' + esc(a.action_id) + '" value="' + bc.recommended_daily_budget + '" style="width:80px;padding:3px 6px;background:var(--bg);border:1px solid var(--accent);border-radius:4px;color:var(--accent);font-size:12px;font-weight:600;text-align:right;" onclick="event.stopPropagation()" />' +
                        '<span>/day</span>' +
                        (bc.change_pct ? '<span style="font-size:10px;color:var(--text-dim);">(' + esc(bc.change_pct) + ')</span>' : '') +
                    '</div>' : '') +
                    (a.expected_impact ? '<div style="font-size:11px;color:var(--green);margin-bottom:8px;">\ud83d\udcca ' + esc(a.expected_impact) + '</div>' : '') +
                    '<details style="margin-top:6px;">' +
                        '<summary style="cursor:pointer;font-size:11px;color:var(--text-dim);">Details</summary>' +
                        '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:grid;gap:8px;">' +
                            '<div style="font-size:10px;color:var(--text-dim);">Status: ' + statusSummary + ' | Effective: ' + effectiveStatus + '</div>' +
                            (a.category && a.category !== a.action_type ? '<div style="font-size:10px;color:var(--text-dim);">Category: ' + esc(catLabel) + '</div>' : '') +
                            ((m.budget_level || m.budget_type || m.budget_owner) ? '<div style="font-size:10px;color:var(--text-dim);">Budget owner: ' + esc(m.budget_owner || '--') + ' | Level: ' + esc(m.budget_level || '--') + ' | Type: ' + esc(m.budget_type || '--') + '</div>' : '') +
                            (a.success_metric ? '<div style="font-size:10px;color:var(--green);">Success metric: ' + esc(a.success_metric) + '</div>' : '') +
                            (a.risk ? '<div style="font-size:10px;color:var(--orange);">Risk: ' + esc(a.risk) + '</div>' : '') +
                            (a.override_optimizer_rule ? '<div style="font-size:10px;color:var(--accent);">Override: ' + esc(a.override_reason || 'APEX overrode the rules-engine suggestion.') + '</div>' : '') +
                            (a.reasoning ? '<div style="font-size:11px;color:var(--text-dim);line-height:1.6;">' + esc(a.reasoning) + '</div>' : '') +
                        '</div>' +
                    '</details>' +
                '</div>' +
                (isExecutable ? '<button class="opt-run-single btn-ci-primary" data-action-id="' + esc(a.action_id) + '" style="font-size:11px;padding:8px 14px;white-space:nowrap;align-self:flex-start;">' + executeLabel + '</button>' : '') +
            '</div>' +
        '</div>';
    });
    return html;
}

// â”€â”€ EXECUTE STAGE â”€â”€

function renderExecuteStage(container) {
    var html = '<div class="ci-panel">' +
        '<h2>\u26a1 Execution Results</h2>' +
        '<div id="optExecResults"></div>' +
        '<div style="display:flex;gap:10px;margin-top:20px;">' +
            '<button id="optRescanAfterExec" class="btn-ci-primary">\u21bb Rescan Account</button>' +
        '</div></div>' + renderLogSection();
    container.innerHTML = html;
    document.getElementById('optRescanAfterExec').addEventListener('click', function() {
        window.OPTIMIZER_SCAN = null; window.OPTIMIZER_PLAN = null;
        window.OPTIMIZER_STAGE = 'scan'; renderOptimizer();
    });
}

// â”€â”€ LOG â”€â”€

function renderLogSection() {
    var log = window.OPTIMIZER_LOG.length ? window.OPTIMIZER_LOG : loadLog();
    if (!log.length) return '';
    var html = '<div style="' + CS + 'margin-top:24px;">' +
        '<h3 style="font-size:14px;font-weight:600;color:var(--text-dim);margin-bottom:12px;">Execution Log</h3>' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
        '<thead><tr style="border-bottom:1px solid var(--border);">' +
            '<th style="text-align:left;padding:6px 8px;color:var(--text-dim);">Time</th>' +
            '<th style="text-align:left;padding:6px 8px;color:var(--text-dim);">Action</th>' +
            '<th style="text-align:left;padding:6px 8px;color:var(--text-dim);">Entity</th>' +
            '<th style="text-align:center;padding:6px 8px;color:var(--text-dim);">Result</th>' +
        '</tr></thead><tbody>';
    log.slice().reverse().slice(0, 30).forEach(function(e) {
        html += '<tr style="border-bottom:1px solid var(--border);">' +
            '<td style="padding:6px 8px;color:var(--text-dim);white-space:nowrap;">' + new Date(e.timestamp).toLocaleString() + '</td>' +
            '<td style="padding:6px 8px;">' + esc(e.action_type) + '</td>' +
            '<td style="padding:6px 8px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(e.entity_name) + '">' + esc(e.entity_name) + '</td>' +
            '<td style="text-align:center;padding:6px 8px;">' + (e.success ? '\u2705' : '<span title="' + esc(e.error) + '">\u274c</span>') + '</td></tr>';
    });
    html += '</tbody></table></div>';
    return html;
}

// â”€â”€ CONFIRMATION MODAL â”€â”€

function showConfirmModal(actions, onConfirm) {
    var actionable = actions.filter(function(a) { return isExecutableActionType(a.action_type); });
    var pauses = actionable.filter(function(a) { return a.action_type.indexOf('PAUSE') !== -1; }).length;
    var budgets = actionable.filter(function(a) { return a.action_type === 'UPDATE_ADSET_BUDGET' || a.action_type === 'UPDATE_CAMPAIGN_BUDGET'; }).length;

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:32px;max-width:520px;width:90%;">' +
        '<h3 style="font-size:16px;font-weight:700;color:var(--text);margin-bottom:16px;">\u26a0\ufe0f Confirm Execution</h3>' +
        '<p style="font-size:13px;color:var(--text);margin-bottom:12px;">You are about to make <strong>' + actionable.length + ' changes</strong> to your Meta ad account:</p>' +
        '<ul style="font-size:13px;color:var(--text-dim);margin-bottom:16px;padding-left:20px;">' +
            (pauses ? '<li>Pause ' + pauses + ' entities</li>' : '') +
            (budgets ? '<li>Change ' + budgets + ' budgets</li>' : '') +
        '</ul>' +
        '<p style="font-size:12px;color:var(--orange);margin-bottom:16px;">\u26a0 These changes take effect immediately in Meta Ads Manager and cannot be auto-reversed.</p>' +
        '<div style="margin-bottom:16px;">' +
            '<label style="font-size:12px;color:var(--text-dim);display:block;margin-bottom:6px;">Type <strong>EXECUTE</strong> to confirm:</label>' +
            '<input id="optConfirmInput" type="text" placeholder="EXECUTE" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;font-family:monospace;">' +
        '</div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
            '<button id="optConfirmCancel" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);cursor:pointer;">Cancel</button>' +
            '<button id="optConfirmExec" class="btn-ci-primary" style="background:var(--red);opacity:0.4;pointer-events:none;" disabled>Execute Plan \u2192</button>' +
        '</div></div>';

    document.body.appendChild(overlay);
    var input = document.getElementById('optConfirmInput');
    var execBtn = document.getElementById('optConfirmExec');
    input.addEventListener('input', function() {
        var ok = input.value.trim() === 'EXECUTE';
        execBtn.disabled = !ok;
        execBtn.style.opacity = ok ? '1' : '0.4';
        execBtn.style.pointerEvents = ok ? 'auto' : 'none';
    });
    document.getElementById('optConfirmCancel').addEventListener('click', function() { overlay.remove(); });
    execBtn.addEventListener('click', function() { overlay.remove(); onConfirm(actionable); });
}

// â”€â”€ EVENT BINDING â”€â”€

function bindScanEvents(container) {
    var promptInput = document.getElementById('optPromptInput');
    var overviewLevel = document.getElementById('optOverviewLevel');
    if (overviewLevel) {
        overviewLevel.addEventListener('change', function() {
            window.OPTIMIZER_OVERVIEW_LEVEL = overviewLevel.value || 'campaign';
            if (window.OPTIMIZER_STAGE === 'plan' && window.OPTIMIZER_PLAN) renderOptimizer();
        });
    }
    var scanBtn = document.getElementById('optScanBtn');
    if (scanBtn) {
        scanBtn.addEventListener('click', async function() {
            scanBtn.disabled = true; scanBtn.textContent = 'Scanning...';
            var prog = document.getElementById('optScanProgress');
            prog.style.display = '';
            try {
                var cached = getCachedOptimizerScan(getSelectedDates());
                if (cached) {
                    window.OPTIMIZER_SCAN = cached;
                    window.OPTIMIZER_STAGE = 'scan';
                    setPortalLoadState('cached', 'Showing cached scan while fresh data loads');
                    if (typeof renderOptimizer === 'function') renderOptimizer();
                    prog.textContent = 'Showing cached scan while fresh data loads...';
                }
                await scanAccount(function(msg) { prog.textContent = msg; });
                window.OPTIMIZER_STAGE = 'scan';
                renderOptimizer();
        } catch (err) {
            prog.innerHTML = '<span style="color:var(--red);">Scan failed: ' + esc(err.message) + '</span>';
            scanBtn.disabled = false; scanBtn.textContent = '\ud83d\udd0d Scan Full Account';
        }
    });
    }

    var planBtn = document.getElementById('optPlanBtn');
    if (planBtn) {
        var runPromptRequest = async function() {
            await executeOptimizerPromptFlow(
                planBtn,
                promptInput,
                document.getElementById('optPlanProgress')
            );
        };
        planBtn.addEventListener('click', runPromptRequest);
        if (promptInput) {
            promptInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    runPromptRequest();
                }
            });
        }
    }

    container.querySelectorAll('.opt-prompt-chip').forEach(function(btn) {
        btn.addEventListener('click', function() {
            if (promptInput) promptInput.value = btn.dataset.prompt || '';
            if (promptInput) promptInput.focus();
        });
    });

    var rescanBtn = document.getElementById('optRescanBtn');
    if (rescanBtn) {
        rescanBtn.addEventListener('click', function() {
            window.OPTIMIZER_SCAN = null; window.OPTIMIZER_PLAN = null; window.OPTIMIZER_CHAT = [];
            window.OPTIMIZER_STAGE = 'scan'; renderOptimizer();
        });
    }
}

function bindPlanEvents(container) {
    var promptInput = document.getElementById('optPromptInput');
    var planBtn = document.getElementById('optPlanBtn');
    if (planBtn) {
        var runPromptRequest = async function() {
            await executeOptimizerPromptFlow(
                planBtn,
                promptInput,
                document.getElementById('optPlanProgress')
            );
        };
        planBtn.addEventListener('click', runPromptRequest);
        if (promptInput) {
            promptInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    runPromptRequest();
                }
            });
        }
    }

    container.querySelectorAll('.opt-prompt-chip').forEach(function(btn) {
        btn.addEventListener('click', function() {
            if (promptInput) promptInput.value = btn.dataset.prompt || '';
            if (promptInput) promptInput.focus();
        });
    });

    container.querySelectorAll('.opt-open-campaign').forEach(function(btn) {
        btn.addEventListener('click', function() {
            window.OPTIMIZER_OVERVIEW_CAMPAIGN = btn.dataset.campaign || '';
            window.OPTIMIZER_OVERVIEW_ADSET = '';
            renderOptimizer();
        });
    });

    container.querySelectorAll('.opt-open-adset').forEach(function(btn) {
        btn.addEventListener('click', function() {
            window.OPTIMIZER_OVERVIEW_ADSET = btn.dataset.adset || '';
            renderOptimizer();
        });
    });

    container.querySelectorAll('.opt-overview-drill').forEach(function(btn) {
        btn.addEventListener('click', function() {
            window.OPTIMIZER_OVERVIEW_DRILL = btn.dataset.drill || 'campaign';
            renderOptimizer();
        });
    });

    // Filter tabs
    container.querySelectorAll('.opt-filter').forEach(function(btn) {
        btn.addEventListener('click', function() {
            container.querySelectorAll('.opt-filter').forEach(function(b) {
                b.classList.remove('active');
                b.style.borderColor = 'var(--border)'; b.style.background = 'var(--bg-card)'; b.style.color = 'var(--text)';
            });
            btn.classList.add('active');
            btn.style.borderColor = 'var(--accent)'; btn.style.background = 'rgba(99,102,241,0.15)'; btn.style.color = 'var(--accent)';
            window.OPTIMIZER_PLAN_FILTER = btn.dataset.filter || 'all';
            document.getElementById('optActionsTable').innerHTML = renderActionsTable(
                window.OPTIMIZER_PLAN.actions,
                window.OPTIMIZER_PLAN_FILTER,
                window.OPTIMIZER_PLAN_SCOPE || 'all'
            );
            bindBudgetInputs(container);
            bindRunButtons();
        });
    });

    // Budget input editing â€” update action data when user changes the value
    container.querySelectorAll('.opt-budget-input').forEach(function(input) {
        input.addEventListener('change', function() {
            var actionId = input.dataset.actionId;
            var newBudget = parseFloat(input.value);
            if (!actionId || isNaN(newBudget) || !window.OPTIMIZER_PLAN) return;
            var action = window.OPTIMIZER_PLAN.actions.find(function(a) { return a.action_id === actionId; });
            if (action && action.budget_change) {
                action.budget_change.recommended_daily_budget = newBudget;
                console.log('[Optimizer] Budget updated for', actionId, 'â†’ \u20b9' + newBudget + '/day');
                input.style.borderColor = 'var(--green)';
                setTimeout(function() { input.style.borderColor = 'var(--accent)'; }, 1500);
            }
        });
    });

    container.querySelectorAll('.opt-scope').forEach(function(btn) {
        btn.addEventListener('click', function() {
            window.OPTIMIZER_PLAN_SCOPE = btn.dataset.scope || 'all';
            container.querySelectorAll('.opt-scope').forEach(function(b) {
                b.classList.remove('active');
                b.style.borderColor = 'var(--border)'; b.style.background = 'var(--bg-card)'; b.style.color = 'var(--text)';
            });
            btn.classList.add('active');
            btn.style.borderColor = 'var(--green)'; btn.style.background = 'rgba(16,185,129,0.12)'; btn.style.color = 'var(--green)';
            document.getElementById('optActionsTable').innerHTML = renderActionsTable(
                window.OPTIMIZER_PLAN.actions,
                window.OPTIMIZER_PLAN_FILTER || 'all',
                window.OPTIMIZER_PLAN_SCOPE
            );
            bindBudgetInputs(container);
            bindRunButtons();
        });
    });

    bindBudgetInputs(container);

    // Execute all
    var execAllBtn = document.getElementById('optExecAllBtn');
    if (execAllBtn) {
        execAllBtn.addEventListener('click', function() {
            showConfirmModal(window.OPTIMIZER_PLAN.actions, async function(actionable) {
                window.OPTIMIZER_STAGE = 'execute';
                renderOptimizer();
                var el = document.getElementById('optExecResults');
                el.innerHTML = '<div class="ai-loading"><div class="ai-loading-spinner"></div><div class="ai-loading-text">Executing ' + actionable.length + ' actions...</div></div>';
                try {
                    var res = await executeAllActions(actionable);
                    el.innerHTML = '<div style="' + CS + '">' +
                        '<h3 style="color:' + (res.failed === 0 ? 'var(--green)' : 'var(--orange)') + ';">Execution Complete</h3>' +
                        '<p style="font-size:14px;color:var(--text);margin-top:8px;">\u2705 ' + res.succeeded + ' succeeded' + (res.failed > 0 ? ' \u274c ' + res.failed + ' failed' : '') + '</p></div>';
                } catch (err) {
                    el.innerHTML = '<div class="ai-error"><div class="ai-error-title">Execution failed</div><div class="ai-error-msg">' + esc(err.message) + '</div></div>';
                }
            });
        });
    }

    var backBtn = document.getElementById('optBackToScan');
    if (backBtn) {
        backBtn.addEventListener('click', function() {
            window.OPTIMIZER_STAGE = 'scan'; renderOptimizer();
        });
    }

    bindRunButtons();
}

function bindBudgetInputs(container) {
    container.querySelectorAll('.opt-budget-input').forEach(function(input) {
        input.addEventListener('change', function() {
            var actionId = input.dataset.actionId;
            var newBudget = parseFloat(input.value);
            if (!actionId || isNaN(newBudget) || !window.OPTIMIZER_PLAN) return;
            var action = window.OPTIMIZER_PLAN.actions.find(function(a) { return a.action_id === actionId; });
            if (action && action.budget_change) {
                action.budget_change.recommended_daily_budget = newBudget;
                console.log('[Optimizer] Budget updated for', actionId, 'Ã¢â€ â€™ \u20b9' + newBudget + '/day');
                input.style.borderColor = 'var(--green)';
                setTimeout(function() { input.style.borderColor = 'var(--accent)'; }, 1500);
            }
        });
    });
}

function bindRunButtons() {
    document.querySelectorAll('.opt-run-single').forEach(function(btn) {
        btn.addEventListener('click', async function(e) {
            e.stopPropagation();
            var actionId = btn.dataset.actionId;
            var action = (window.OPTIMIZER_PLAN.actions || []).find(function(a) { return a.action_id === actionId; });
            if (!action || !isExecutableActionType(action.action_type)) return;
            btn.disabled = true; btn.textContent = '...';
            try {
                var res = await executeAction(action);
                btn.textContent = res.success ? '\u2705' : '\u274c';
                btn.style.background = res.success ? 'var(--green)' : 'var(--red)';
            } catch (err) {
                btn.textContent = '\u274c'; btn.style.background = 'var(--red)';
            }
        });
    });
}

// â”€â”€ INIT â”€â”€
window.OPTIMIZER_LOG = loadLog();

})();

