(function() {
    'use strict';
    window.ATGoogle = window.ATGoogle || {};

    var _data = { flags: [], patterns: [], recommendations: [], adgroups: [], audiences: [], campaigns: [], summary: null, brain: null, brainFeedback: '' };
    var _recTab = 'tests';
    var _sortCol = 'cost';
    var _sortDir = 'desc';
    var _filters = { campaignType: 'all', priority: 'all', urgency: 'all', status: 'all' };

    ATGoogle.init = async function() {
        var container = document.getElementById('atGoogleView');
        if (!container) { console.warn('[ATGoogle] atGoogleView not found'); return; }

        // Build layout immediately so sections are visible
        container.innerHTML = buildLayout();
        if (typeof AT.bootstrapRefreshStamp === 'function') {
            AT.bootstrapRefreshStamp();
        }

        // Load all data in parallel
        try {
            await Promise.all([loadFlags(), loadPatterns(), loadRecommendations(), loadAdgroups(), loadAudiences(), loadCampaigns(), loadSummary()]);
        } catch(e) { console.error('[ATGoogle] data load error:', e); }

        renderAll();
        loadBrain();
        if (typeof AT.touchRefreshStamp === 'function') {
            AT.touchRefreshStamp('google:init');
        }

        // If completely empty, show a helpful empty state at top
        if (!_data.adgroups.length && !_data.patterns.length && !_data.recommendations.tests?.length) {
            var emptyBanner = document.createElement('div');
            emptyBanner.className = 'at-empty';
            emptyBanner.style.cssText = 'margin-bottom:16px';
            emptyBanner.innerHTML = '<div class="at-empty-icon">\uD83C\uDFAF</div><div class="at-empty-text">No Google audience data yet</div><div class="at-empty-sub">Click "Scan Now" above to pull all campaign & ad group targeting data from Google Ads</div>';
            container.insertBefore(emptyBanner, container.firstChild);
        }

        // Auto-refresh flags every 5 min
        setInterval(loadFlags, 5 * 60 * 1000);
    };

    ATGoogle.refresh = async function() {
        await Promise.all([loadFlags(), loadPatterns(), loadRecommendations(), loadAdgroups(), loadAudiences(), loadCampaigns(), loadSummary()]);
        renderAll();
        loadBrain();
        if (typeof AT.touchRefreshStamp === 'function') {
            AT.touchRefreshStamp('google:refresh');
        }
    };

    function buildLayout() {
        return '' +
            '<!-- Section 1: Live Health Monitor -->' +
            '<div class="at-section">' +
                '<div class="at-section-title">Live Health Monitor</div>' +
                '<div id="atGoogleFlagsSummary" class="at-flags-strip"></div>' +
                '<div id="atGoogleFlags" class="at-flags-strip" style="margin-top:8px"></div>' +
            '</div>' +

            '<div class="at-section">' +
                '<div class="at-section-title">Audience Strategy</div>' +
                '<div id="atGoogleBrain" class="at-insights-grid" style="margin-bottom:16px"></div>' +
                '<div id="atGoogleSummary" class="at-insights-grid"></div>' +
            '</div>' +

            '<!-- Section 2: Audience Intelligence -->' +
            '<div class="at-section">' +
                '<div class="at-section-title">Audience Intelligence</div>' +
                '<div id="atGoogleInsights" class="at-insights-grid"></div>' +
                '<div id="atGoogleCharts" class="at-charts-grid" style="margin-top:16px"></div>' +
            '</div>' +

            '<!-- Section 3: Recommendations -->' +
            '<div class="at-section">' +
                '<div class="at-section-title">Recommendations</div>' +
                '<div class="at-rec-tabs">' +
                    '<button class="at-rec-tab active" data-tab="tests" onclick="ATGoogle.switchRecTab(\'tests\')">Future Tests</button>' +
                    '<button class="at-rec-tab" data-tab="optimizations" onclick="ATGoogle.switchRecTab(\'optimizations\')">Current Optimizations</button>' +
                '</div>' +
                '<div id="atGoogleRecFilters" class="at-filter-bar"></div>' +
                '<div id="atGoogleRecs" class="at-rec-list"></div>' +
            '</div>' +

            '<!-- Section 4: Ad Group Explorer -->' +
            '<div class="at-section">' +
                '<div class="at-section-title">Ad Group Explorer</div>' +
                '<div class="at-explorer">' +
                    '<div id="atGoogleTableControls" class="at-table-controls"></div>' +
                    '<div id="atGoogleTable" class="at-table-wrapper"></div>' +
                '</div>' +
            '</div>';
    }

    async function loadFlags() { var r = await AT.api('/live/flags?platform=google'); if (r.success) _data.flags = r.data || []; }
    async function loadPatterns() { var r = await AT.api('/patterns/google'); if (r.success) _data.patterns = r.data || []; }
    async function loadSummary() {
        try {
            var r = await AT.api('/audience/summary?platform=google');
            if (r.success && r.data) {
                _data.summary = r.data;
                return;
            }
        } catch (e) {}
        _data.summary = buildLocalSummary();
    }
    async function loadRecommendations() {
        var testsR = await AT.api('/recommendations/tests?platform=google');
        var optsR = await AT.api('/recommendations/optimizations?platform=google');
        _data.recommendations = { tests: (testsR.success ? testsR.data : []) || [], optimizations: (optsR.success ? optsR.data : []) || [] };
    }
    async function loadAdgroups() { var r = await AT.api('/google/adgroups'); if (r.success) _data.adgroups = r.data || []; }
    async function loadAudiences() { var r = await AT.api('/google/audiences'); if (r.success) _data.audiences = r.data || []; }
    async function loadCampaigns() { var r = await AT.api('/google/campaigns'); if (r.success) _data.campaigns = r.data || []; }
    function getBrainRequestScope() {
        return { audience_only: true, minimum_test_spend: 20000, portal: 'google' };
    }

    function getBrainRecommendationsSnapshot() {
        var tests = (_data.recommendations && _data.recommendations.tests ? _data.recommendations.tests : []).slice(0, 6);
        var opts = (_data.recommendations && _data.recommendations.optimizations ? _data.recommendations.optimizations : []).slice(0, 6);
        return tests.concat(opts).map(function(r) {
            return {
                id: r.id,
                title: r.title || '',
                rec_type: r.rec_type || '',
                priority: r.priority || '',
                urgency: r.urgency || '',
                action_type: r.action_type || '',
                rationale: r.rationale || r.hypothesis || '',
                specific_change: r.specific_change || '',
                vertical: r.vertical || ''
            };
        });
    }

    async function loadBrain(feedback) {
        _data.brain = { loading: true };
        renderBrain();
        try {
            var r = await AT.apiPost('/audience/brain', {
                platform: 'google',
                user_request: 'Optimizer-level audience insights and actions',
                feedback: feedback || '',
                request_scope: getBrainRequestScope(),
                current_recommendations: getBrainRecommendationsSnapshot()
            });
            if (r && r.success && r.optimizer_plan) {
                _data.brain = r;
                _data.brainFeedback = feedback || '';
                renderBrain();
                return;
            }
        } catch (e) {}
        _data.brain = null;
        renderBrain();
    }

    ATGoogle.loadBrain = loadBrain;

    function renderAll() { renderFlags(); renderBrain(); renderSummary(); renderInsights(); renderCharts(); renderRecFilters(); renderRecs(); renderExplorer(); }

    function getPortalDateLabel() {
        var ctx = window.getPortalAssistantContext ? window.getPortalAssistantContext() : null;
        var range = ctx && ctx.dateRange ? ctx.dateRange : null;
        if (range && range.label) return range.label;
        if (range && range.since && range.until) return range.since + ' → ' + range.until;
        return 'Selected scan window';
    }

    function getSourceLabel() {
        return 'Google Ads + AT';
    }

    function getCardMeta(item, kind) {
        var spend = Number(item && (item.spend != null ? item.spend : item.total_spend));
        var maturity = item && item.maturity_label ? item.maturity_label :
            (kind === 'patterns' || kind === 'tests' ? 'Mature' : (spend >= 20000 ? 'Mature' : 'Immature'));
        var sanity = item && item.sanity_status ? item.sanity_status :
            (kind === 'patterns' || kind === 'tests' ? 'PASS' : ((spend > 0 && ((item.d6_roas || item.d6_cac || item.conversions || item.sample_conversions || 0) > 0)) ? 'PASS' : 'WATCH'));
        return {
            source: item && item.source_label ? item.source_label : getSourceLabel(),
            date: item && item.date_label ? item.date_label : (kind === 'patterns' ? 'Historical pattern library' : getPortalDateLabel()),
            maturity: maturity,
            sanity: sanity,
            detail: item && item.sanity_detail ? item.sanity_detail : (sanity === 'PASS' ? 'Source + metrics aligned' : 'Needs source/metric review')
        };
    }

    // ── Flags ──
    function renderFlags() {
        var critical = _data.flags.filter(function(f) { return f.severity === 'critical' || f.severity === 'CRITICAL'; });
        var warning = _data.flags.filter(function(f) { return f.severity === 'warning' || f.severity === 'WARNING'; });
        var opp = _data.flags.filter(function(f) { return f.severity === 'opportunity' || f.severity === 'OPPORTUNITY'; });

        var summary = document.getElementById('atGoogleFlagsSummary');
        if (summary) {
            summary.innerHTML =
                (critical.length ? '<span class="at-flag-badge critical">' + critical.length + ' Critical</span>' : '') +
                (warning.length ? '<span class="at-flag-badge warning">' + warning.length + ' Warning' + (warning.length > 1 ? 's' : '') + '</span>' : '') +
                (opp.length ? '<span class="at-flag-badge opportunity">' + opp.length + ' Opportunit' + (opp.length > 1 ? 'ies' : 'y') + '</span>' : '') +
                (!_data.flags.length ? '<span style="color:var(--text-dim);font-size:12px">No active flags \u2014 all healthy</span>' : '');
        }

        var container = document.getElementById('atGoogleFlags');
        if (!container) return;
        if (!_data.flags.length) { container.innerHTML = ''; return; }
        container.innerHTML = _data.flags.slice(0, 12).map(function(f) {
            var sev = (f.severity || 'info').toLowerCase();
            return '<div class="at-flag-card ' + sev + '">' +
                '<div class="at-flag-card-title">' + AT.esc(f.flag_type || f.flag) + ': ' + AT.esc(f.adgroup_name || f.campaign_name || f.adset_name) + '</div>' +
                '<div class="at-flag-card-msg">' + AT.esc(f.message) + '</div></div>';
        }).join('');
    }

    function renderBrain() {
        var container = document.getElementById('atGoogleBrain');
        if (!container) return;
        var brain = _data.brain && _data.brain.optimizer_plan ? _data.brain.optimizer_plan : null;
        if (_data.brain && _data.brain.loading) {
            container.innerHTML = '<div class="at-insight-panel"><h3>Audience Brain</h3><div class="at-empty-sub" style="padding:20px">Building optimizer-level audience actions...</div></div>';
            return;
        }
        if (!brain) {
            container.innerHTML = '<div class="at-insight-panel"><h3>Audience Brain</h3><div class="at-empty-sub" style="padding:20px">Run the brain to get optimizer-level audience actions.</div><textarea id="atGoogleBrainFeedback" placeholder="Add feedback if the answer is too vague or not actionable..." style="width:100%;min-height:72px;margin-top:10px;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px;font-size:12px"></textarea><button class="at-scan-btn" style="margin-top:10px" onclick="ATGoogle.loadBrain((document.getElementById(\'atGoogleBrainFeedback\') || {}).value || \'\')">Generate Brain</button></div>';
            return;
        }
        var actions = Array.isArray(brain.audience_actions) ? brain.audience_actions : [];
        container.innerHTML = '<div class="at-insight-panel"><h3>Audience Brain</h3>' +
            '<div class="at-sweet-spot"><div class="at-sweet-spot-label">Executive Summary</div><div class="at-sweet-spot-value">' + AT.esc(brain.executive_summary || brain.operator_answer || '--') + '</div></div>' +
            (brain.morning_brief && Array.isArray(brain.morning_brief.what_to_do_right_now) && brain.morning_brief.what_to_do_right_now.length ? '<div style="margin-top:12px;font-size:11px;color:var(--text-dim)">Do now: ' + AT.esc(brain.morning_brief.what_to_do_right_now.join(' • ')) + '</div>' : '') +
            (brain.morning_brief && Array.isArray(brain.morning_brief.what_to_leave_alone) && brain.morning_brief.what_to_leave_alone.length ? '<div style="margin-top:6px;font-size:11px;color:var(--text-dim)">Leave alone: ' + AT.esc(brain.morning_brief.what_to_leave_alone.join(' • ')) + '</div>' : '') +
            (brain.diagnostics ? '<div style="margin-top:12px;font-size:10px;color:var(--text-dim)"><b>Diagnostics</b> ' +
                ['broad_vs_narrow','overlap_risk','saturation_risk','quality_vs_volume_tradeoff','creative_fit_issues','funnel_fit_issues'].map(function(k) {
                    return brain.diagnostics[k] && brain.diagnostics[k].length ? k.replace(/_/g, ' ') + ': ' + brain.diagnostics[k].join(' • ') : '';
                }).filter(Boolean).join(' | ') +
            '</div>' : '') +
            (brain.roadmap ? '<div style="margin-top:12px;font-size:10px;color:var(--text-dim)"><b>Roadmap</b> ' +
                ['immediate_actions','this_week','next_test_cycle'].map(function(k) {
                    return brain.roadmap[k] && brain.roadmap[k].length ? k.replace(/_/g, ' ') + ': ' + brain.roadmap[k].join(' • ') : '';
                }).filter(Boolean).join(' | ') +
            '</div>' : '') +
            (brain.feedback_used ? '<div style="margin-top:6px;font-size:10px;color:var(--text-dim)">Feedback loop: ' + AT.esc(brain.feedback_used) + '</div>' : '') +
            '<textarea id="atGoogleBrainFeedback" placeholder="Add feedback if the answer is too vague or not actionable..." style="width:100%;min-height:72px;margin-top:10px;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:10px;font-size:12px">' + AT.esc(_data.brainFeedback || '') + '</textarea><button class="at-scan-btn" style="margin-top:10px" onclick="ATGoogle.loadBrain((document.getElementById(\'atGoogleBrainFeedback\') || {}).value || \'\')">Refine with Feedback</button></div>' +
            (actions.length ? '<div class="at-insight-panel"><h3>Audience Actions</h3>' + actions.slice(0, 5).map(function(a) {
                return '<div class="at-insight-item" style="align-items:flex-start;gap:10px"><div style="flex:1;min-width:0"><div class="at-insight-name">' + AT.esc((a.action_type || 'ACTION') + ': ' + (a.audience_label || a.adgroup_name || a.entity_name || '--')) + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + AT.esc((a.audience_bucket || '--') + ' | ' + (a.intent_cluster || '--') + ' | ' + (a.strategic_role || '--')) + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:2px;">' + AT.esc('Quality: ' + (a.quality_score != null ? a.quality_score : '--') + ' | ' + (a.quality_tier || '--') + ' | Overlap: ' + (a.overlap_risk || '--') + ' | Fragmentation: ' + (a.fragmentation_risk || '--')) + '</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + AT.esc(a.diagnosis || '') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">' + AT.esc(a.action_detail || '') + '</div><div style="font-size:11px;color:var(--accent);margin-top:4px;">Change: ' + AT.esc(a.what_to_change || '--') + ' | Why: ' + AT.esc(a.why_this_change || '--') + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Impact: ' + AT.esc(a.expected_impact || '--') + ' | Risk: ' + AT.esc(a.risk || '--') + ' | Metric: ' + AT.esc(a.success_metric || '--') + '</div><div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Source: ' + AT.esc(a.source_label || getSourceLabel()) + ' | Data: ' + AT.esc(a.date_label || getPortalDateLabel()) + ' | ' + AT.esc(a.maturity_label || 'Mature') + ' | Sanity: ' + AT.esc(a.sanity_status || 'WATCH') + (a.sanity_detail ? ' | ' + AT.esc(a.sanity_detail) : '') + (a.sample_count != null ? ' | Based on ' + AT.esc(a.sample_count) + ' adgroups' : '') + '</div></div><div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;white-space:nowrap">' + (a.confidence ? '<span class="at-confidence ' + String(a.confidence).toLowerCase() + '">' + AT.esc(a.confidence) + '</span>' : '') + '</div></div>';
            }).join('') + '</div>' : '');
    }

    function renderSummary() {
        var container = document.getElementById('atGoogleSummary');
        if (!container) return;

        var summary = _data.summary || {};
        var winners = summary.best_audiences || [];
        var losers = summary.weak_audiences || [];
        var tests = summary.test_ideas || [];
        var formulas = summary.learned_formulas || [];
        var families = summary.family_signals || [];

        function panel(title, items, emptyText, toneClass, kind) {
            var html = '<div class="at-insight-panel"><h3>' + AT.esc(title) + '</h3>';
            if (!items.length) {
                html += '<div class="at-empty-sub" style="padding:20px">' + AT.esc(emptyText) + '</div>';
            } else {
                html += items.slice(0, 3).map(function(item) {
                    var meta = getCardMeta(item, kind);
                    var exactLabel = item.exact_bucket_label || (item.exact_bucket_id ? ((item.label || item.title || '--') + ' [' + item.exact_bucket_id + ']') : '');
                    return '<div class="at-insight-item" style="align-items:flex-start;gap:10px">' +
                        '<div style="flex:1;min-width:0">' +
                            '<div class="at-insight-name">' + AT.esc(exactLabel || item.label || item.title || '--') + '</div>' +
                            (item.audience_lineage ? '<div style="font-size:10px;color:var(--text-dim);margin-top:3px;">' + AT.esc(item.audience_lineage) + '</div>' : '') +
                            '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + AT.esc(item.reason || ('Spend ' + AT.fmtINR(item.spend || 0))) + '</div>' +
                            (item.action ? '<div style="font-size:11px;color:var(--accent);margin-top:4px;">' + AT.esc(item.action) + '</div>' : '') +
                            '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + AT.esc((item.audience_bucket || '--') + ' | ' + (item.intent_cluster || '--') + ' | ' + (item.strategic_role || '--')) + '</div>' +
                            '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;">' + AT.esc('Quality: ' + (item.quality_score != null ? item.quality_score : '--') + ' | ' + (item.quality_tier || '--') + ' | Overlap: ' + (item.overlap_risk || '--') + ' | Fragmentation: ' + (item.fragmentation_risk || '--')) + '</div>' +
                            (item.members && item.members.length ? '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;">Used in: ' + AT.esc(item.members.slice(0, 3).join(' • ')) + '</div>' : '') +
                            (Array.isArray(item.merge_candidates) && item.merge_candidates.length ? '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;">Merge with: ' + AT.esc(item.merge_candidates.slice(0, 2).join(' • ')) + '</div>' : '') +
                            '<div style="font-size:10px;color:var(--text-dim);margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">' +
                                '<span>Source: ' + AT.esc(meta.source) + '</span>' +
                                '<span>Data: ' + AT.esc(meta.date) + '</span>' +
                                '<span>' + AT.esc(meta.maturity) + '</span>' +
                                '<span>Sanity: ' + AT.esc(meta.sanity) + '</span>' +
                                (item.sample_count ? '<span>Based on ' + AT.esc(item.sample_count) + ' adgroups</span>' : '') +
                            '</div>' +
                            (meta.detail ? '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;">' + AT.esc(meta.detail) + '</div>' : '') +
                        '</div>' +
                        '<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;white-space:nowrap">' +
                            (item.d6_cac ? '<span class="at-insight-metric ' + toneClass + '">' + AT.fmtINR(item.d6_cac) + '</span>' : '') +
                            (item.d6_roas ? '<span class="at-insight-metric" style="color:var(--teal)">' + AT.fmtROAS(item.d6_roas) + '</span>' : '') +
                            (item.conversions != null ? AT.confidenceBadge(item.conversions) : '') +
                        '</div>' +
                    '</div>';
                }).join('');
            }
            html += '</div>';
            return html;
        }

        var concentrationHtml = '';
        if (summary.spend_concentration && summary.spend_concentration >= 0.9 && summary.dominant_audience) {
            concentrationHtml = '<div class="at-insight-panel"><h3>Spend Concentration</h3>' +
                '<div class="at-empty-sub" style="padding:20px">' + AT.esc((summary.dominant_audience.exact_bucket_label || summary.dominant_audience.audience || '--') + ' owns ' + Math.round(summary.spend_concentration * 100) + '% of spend. Use adjacent audience tests, not the same bucket again.') + '</div>' +
            '</div>';
        }

        container.innerHTML =
            concentrationHtml +
            (families.length ? '<div class="at-insight-panel"><h3>Exact Audience Buckets Used</h3>' +
                families.slice(0, 4).map(function(f) {
                    return '<div class="at-insight-item"><span class="at-insight-name">' + AT.esc(f.label || f.key || '--') + '</span>' +
                        '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">Bucket: ' + AT.esc(f.key || '--') + ' | Count: ' + AT.esc(f.count != null ? f.count : '--') + ' | Spend: ' + AT.fmtINR(f.spend || 0) + ' | Overlap: ' + AT.esc(f.overlap_risk || '--') + ' | Fragmentation: ' + AT.esc(f.fragmentation_risk || '--') + '</div>' +
                        (Array.isArray(f.merge_candidates) && f.merge_candidates.length ? '<div style="font-size:10px;color:var(--text-dim);margin-top:2px;">Members: ' + AT.esc(f.merge_candidates.slice(0, 3).join(' • ')) + '</div>' : '') +
                    '</div>';
                }).join('') + '</div>' : '') +
            panel('What Worked Best', winners, 'No strong pockets yet. Run scan and learning to build winners.', 'good', 'winners') +
            panel('What Is Weak', losers, 'No weak pockets found yet.', 'bad', 'losers') +
            panel('New Tests To Try', tests, 'No test ideas yet.', 'good', 'tests');

        if (formulas.length) {
            container.insertAdjacentHTML('beforeend',
                '<div class="at-insight-panel"><h3>Winning Formula Library</h3>' +
                formulas.slice(0, 4).map(function(p) {
                    var meta = getCardMeta({ source_label: getSourceLabel(), date_label: 'Historical pattern library', maturity_label: 'Mature', sanity_status: 'PASS' }, 'patterns');
                    return '<div class="at-insight-item">' +
                        '<span class="at-insight-name">' + AT.esc(p.pattern_key) + '</span>' +
                        '<span class="at-insight-metric good">' + AT.fmtINR(p.avg_d6_cac) + '</span>' +
                        '<span class="at-insight-metric" style="color:var(--teal)">' + AT.fmtROAS(p.avg_d6_roas) + '</span>' +
                        AT.confidenceBadge(p.sample_conversions) +
                        '<div style="font-size:10px;color:var(--text-dim);margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;align-items:center">' +
                            '<span>Source: ' + AT.esc(meta.source) + '</span>' +
                            '<span>Data: ' + AT.esc(meta.date) + '</span>' +
                            '<span>' + AT.esc(meta.maturity) + '</span>' +
                            '<span>Sanity: ' + AT.esc(meta.sanity) + '</span>' +
                        '</div></div>';
                }).join('') + '</div>');
        }
    }

    function buildLocalSummary() {
        var rows = (_data.adgroups || []).slice().filter(function(a) { return (a.total_spend || 0) >= 20000; });
        var audienceRows = _data.audiences || [];
        var patterns = (_data.patterns || []).filter(function(p) { return p.pattern_type === 'top_combo'; }).slice().sort(function(a, b) {
            var roas = (b.avg_d6_roas || 0) - (a.avg_d6_roas || 0);
            if (Math.abs(roas) > 0.0001) return roas;
            return (a.avg_d6_cac || 0) - (b.avg_d6_cac || 0);
        });
        var flags = _data.flags || [];
        function norm(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
        function exactKey(rows, fallbackId) {
            var criteria = (rows || []).map(function(r) {
                return {
                    criterion_type: norm(r.criterion_type),
                    audience_name: norm(r.audience_name),
                    audience_id: norm(r.audience_id),
                    age_range: norm(r.age_range),
                    gender: norm(r.gender),
                    device_type: norm(r.device_type)
                };
            }).sort(function(a, b) { return JSON.stringify(a).localeCompare(JSON.stringify(b)); });
            if (!criteria.length) return String(fallbackId || 'unknown-google-audience').toLowerCase();
            return JSON.stringify({ criteria: criteria });
        }
        function audienceLabel(rows) {
            var labels = (rows || []).map(function(r) {
                var parts = [];
                if (r.audience_name) parts.push(String(r.audience_name));
                if (r.criterion_type) parts.push(String(r.criterion_type));
                if (r.age_range) parts.push('Age ' + r.age_range);
                if (r.gender) parts.push('Gender ' + r.gender);
                if (r.device_type) parts.push('Device ' + r.device_type);
                return parts.join(' | ');
            }).filter(Boolean);
            return labels.length ? labels.slice(0, 3).join(' | ') : 'All traffic';
        }
        var audienceMap = {};
        audienceRows.forEach(function(a) {
            if (!audienceMap[a.adgroup_id]) audienceMap[a.adgroup_id] = [];
            audienceMap[a.adgroup_id].push(a);
        });

        function aggregateByAudience(items) {
            var groups = {};
            (items || []).forEach(function(a) {
                var exactRows = audienceMap[a.google_adgroup_id] || [];
                var label = audienceLabel(exactRows);
                var key = exactKey(exactRows, a.google_adgroup_id);
                if (!groups[key]) {
                    groups[key] = { label: label, audience: label, spend: 0, conversions: 0, revenue: 0, sample_count: 0 };
                }
                groups[key].spend += (a.total_spend || 0);
                groups[key].conversions += (a.d6_conversions || a.conversions || 0);
                groups[key].revenue += ((a.d6_roas || 0) * (a.total_spend || 0));
                groups[key].sample_count += 1;
                groups[key].members = groups[key].members || [];
                var member = a.name || a.adgroup_name || a.entity_name || a.campaign_name || '';
                if (member && groups[key].members.indexOf(member) === -1) groups[key].members.push(member);
            });
            return Object.keys(groups).map(function(k) {
                var g = groups[k];
            return {
                label: g.label,
                audience: g.label,
                audience_lineage: [g.label, 'Google adgroup'].join(' > '),
                exact_bucket_id: String(k).slice(0, 10),
                exact_bucket_label: g.label + ' [' + String(k).slice(0, 10) + ']',
                spend: g.spend,
                d6_cac: g.conversions > 0 ? (g.spend / g.conversions) : 0,
                d6_roas: g.spend > 0 ? (g.revenue / g.spend) : 0,
                conversions: g.conversions,
                sample_count: g.sample_count,
                    members: g.members || [g.label],
                    source_label: 'Google Ads + AT',
                    date_label: 'Selected scan window',
                    maturity_label: 'Mature',
                    sanity_status: 'PASS'
                };
            }).filter(function(g) { return g.spend >= 20000; });
        }

        var grouped = aggregateByAudience(rows);
        var totalSpend = grouped.reduce(function(sum, a) { return sum + (a.spend || 0); }, 0);
        var dominant = grouped.slice().sort(function(a, b) { return (b.spend || 0) - (a.spend || 0); })[0] || null;
        var spendConcentration = totalSpend > 0 && dominant ? (dominant.spend || 0) / totalSpend : 0;
        var winners = grouped.slice().sort(function(a, b) {
            var roas = (b.d6_roas || 0) - (a.d6_roas || 0);
            if (Math.abs(roas) > 0.0001) return roas;
            return (a.d6_cac || 0) - (b.d6_cac || 0);
        }).slice(0, 5).map(function(a) {
            return {
                label: a.label,
                audience: a.label,
                audience_lineage: a.audience_lineage,
                exact_bucket_id: a.exact_bucket_id,
                exact_bucket_label: a.exact_bucket_label,
                reason: 'Best current Google pocket by D6 CAC / D6 ROAS.',
                action: 'Keep the search/audience shape and test one new challenger.',
                spend: a.spend || 0,
                d6_cac: a.d6_cac || 0,
                d6_roas: a.d6_roas || 0,
                conversions: a.conversions || 0,
                sample_count: a.sample_count || 0,
                members: a.members || [],
                source_label: 'Google Ads + AT',
                date_label: 'Selected scan window',
                maturity_label: 'Mature',
                sanity_status: 'PASS'
            };
        });
        var losers = grouped.slice().sort(function(a, b) {
            var convA = (a.conversions || 0) > 0 ? 0 : 1;
            var convB = (b.conversions || 0) > 0 ? 0 : 1;
            if (convA !== convB) return convB - convA;
            var roas = (a.d6_roas || 0) - (b.d6_roas || 0);
            if (Math.abs(roas) > 0.0001) return roas;
            return (b.spend || 0) - (a.spend || 0);
        }).slice(0, 5).map(function(a) {
            return {
                label: a.label,
                audience: a.label,
                audience_lineage: a.audience_lineage,
                exact_bucket_id: a.exact_bucket_id,
                exact_bucket_label: a.exact_bucket_label,
                reason: 'Weak pocket with lower D6 output and spend to fix.',
                action: 'Cut or pause the loser, then test a cleaner adgroup or query mix.',
                spend: a.spend || 0,
                d6_cac: a.d6_cac || 0,
                d6_roas: a.d6_roas || 0,
                conversions: a.conversions || 0,
                sample_count: a.sample_count || 0,
                members: a.members || [],
                source_label: 'Google Ads + AT',
                date_label: 'Selected scan window',
                maturity_label: 'Mature',
                sanity_status: 'PASS'
            };
        });
        var tests = [];
        if (winners[0]) tests.push({ title: 'Clone the winning Google pocket with a fresh challenger', reason: winners[0].exact_bucket_label || winners[0].audience || winners[0].label, action: 'Keep the winning search/audience shape and test one new challenger.', conversions: winners[0].conversions, exact_bucket_id: winners[0].exact_bucket_id, exact_bucket_label: winners[0].exact_bucket_label });
        if (patterns[0]) tests.push({ title: 'Test the strongest learned Google pattern again', reason: patterns[0].pattern_key, action: 'Recreate the winning pocket with a tighter query or audience filter.', conversions: patterns[0].sample_conversions || 0, exact_bucket_id: patterns[0].pattern_key ? String(patterns[0].pattern_key).slice(0, 10) : '', exact_bucket_label: patterns[0].pattern_key });
        if (losers[0]) tests.push({ title: 'Replace the weakest Google pocket before scaling', reason: losers[0].exact_bucket_label || losers[0].audience || losers[0].label, action: 'Cut or pause the loser and test a cleaner mix.', conversions: losers[0].conversions, exact_bucket_id: losers[0].exact_bucket_id, exact_bucket_label: losers[0].exact_bucket_label });
        if ((flags || []).some(function(f) { return f.flag_type === 'SCALE_SIGNAL'; })) tests.push({ title: 'Scale the proven Google pocket slowly', reason: 'Live scale signal is present.', action: 'Increase only the strongest pocket and keep the rest unchanged.', conversions: 30, exact_bucket_id: '', exact_bucket_label: '' });
        return {
            best_audiences: winners,
            weak_audiences: losers,
            test_ideas: tests.slice(0, 5),
            learned_formulas: patterns.filter(function(p) { return (p.total_spend || 0) >= 20000; }).slice(0, 4),
            spend_concentration: Math.round(spendConcentration * 1000) / 1000,
            dominant_audience: dominant ? {
                audience: dominant.audience || dominant.label || '--',
                exact_bucket_id: dominant.exact_bucket_id || '',
                exact_bucket_label: dominant.exact_bucket_label || dominant.label || dominant.audience || '--',
                spend: dominant.spend || 0,
                spend_share: Math.round(spendConcentration * 1000) / 1000
            } : null
        };
    }

    // ── Insights ──
    function renderInsights() {
        var container = document.getElementById('atGoogleInsights');
        if (!container) return;

        var aiSynthesis = _data.patterns.find(function(p) { return p.pattern_type === 'ai_synthesis'; });
        var byCPA = _data.patterns.filter(function(p) { return p.pattern_type === 'combination' && p.avg_cpa > 0; }).sort(function(a,b) { return a.avg_cpa - b.avg_cpa; });
        var worstCPA = _data.patterns.filter(function(p) { return p.pattern_type === 'combination' && p.avg_cpa > 0; }).sort(function(a,b) { return b.avg_cpa - a.avg_cpa; });

        // Best audiences panel
        var bestHtml = '<div class="at-insight-panel"><h3>Best Audiences (by CPA)</h3>';
        if (byCPA.length) {
            bestHtml += byCPA.slice(0, 5).map(function(p) {
                return '<div class="at-insight-item"><span class="at-insight-name">' + AT.esc(p.pattern_key) + '</span>' +
                    '<span class="at-insight-metric good">' + AT.fmtINR(p.avg_cpa) + '</span>' +
                    '<span class="at-insight-metric" style="color:var(--teal)">' + AT.fmtROAS(p.avg_roas) + '</span>' +
                    AT.confidenceBadge(p.sample_conversions) + '</div>';
            }).join('');
        } else { bestHtml += '<div class="at-empty-sub" style="padding:20px">Run learning engine to see patterns</div>'; }
        bestHtml += '</div>';

        // Worst audiences panel
        var worstHtml = '<div class="at-insight-panel"><h3>Worst Audiences (by CPA)</h3>';
        if (worstCPA.length) {
            worstHtml += worstCPA.slice(0, 5).map(function(p) {
                return '<div class="at-insight-item"><span class="at-insight-name">' + AT.esc(p.pattern_key) + '</span>' +
                    '<span class="at-insight-metric bad">' + AT.fmtINR(p.avg_cpa) + '</span>' +
                    '<span class="at-insight-metric" style="color:var(--red)">' + AT.fmtROAS(p.avg_roas) + '</span></div>';
            }).join('');
        } else { worstHtml += '<div class="at-empty-sub" style="padding:20px">Run learning engine to see patterns</div>'; }
        worstHtml += '</div>';

        // Sweet spot / AI synthesis panel
        var sweetHtml = '<div class="at-insight-panel">';
        if (aiSynthesis && aiSynthesis.synthesized_insight) {
            try {
                var insight = JSON.parse(aiSynthesis.synthesized_insight);
                var sweet = insight.audience_sweet_spot || insight.sweet_spot || 'Run analysis to discover';
                sweetHtml += '<div class="at-sweet-spot"><div class="at-sweet-spot-label">Winning Formula</div>' +
                    '<div class="at-sweet-spot-value">' + AT.esc(typeof sweet === 'string' ? sweet : JSON.stringify(sweet)) + '</div></div>';
            } catch(e) { sweetHtml += '<div class="at-sweet-spot"><div class="at-sweet-spot-label">AI Synthesis</div><div class="at-sweet-spot-value">' + AT.esc(aiSynthesis.synthesized_insight).slice(0, 300) + '</div></div>'; }
        } else {
            sweetHtml += '<div class="at-sweet-spot"><div class="at-sweet-spot-label">Winning Formula</div><div class="at-sweet-spot-value">Run learning engine to discover the sweet spot</div></div>';
        }
        sweetHtml += '</div>';

        container.innerHTML = bestHtml + worstHtml + sweetHtml;
    }

    // ── Charts ──
    function renderCharts() {
        var container = document.getElementById('atGoogleCharts');
        if (!container) return;

        // Build campaign type lookup from campaigns
        var campaignTypeMap = {};
        _data.campaigns.forEach(function(c) {
            campaignTypeMap[c.campaign_id] = c.campaign_type || c.advertising_channel_type || 'UNKNOWN';
        });

        // Group adgroups by campaign type for CPA chart
        var typeBuckets = {};
        var deviceBuckets = {};
        _data.adgroups.forEach(function(a) {
            var cpa = a.cpa || a.cost_per_conversion;
            if (!cpa || cpa <= 0) return;

            var cType = campaignTypeMap[a.campaign_id] || a.campaign_type || 'UNKNOWN';
            if (!typeBuckets[cType]) typeBuckets[cType] = { total_cpa: 0, count: 0 };
            typeBuckets[cType].total_cpa += cpa;
            typeBuckets[cType].count++;

            // Device breakdown if available
            var device = a.device || 'UNKNOWN';
            if (!deviceBuckets[device]) deviceBuckets[device] = { total_cpa: 0, count: 0 };
            deviceBuckets[device].total_cpa += cpa;
            deviceBuckets[device].count++;
        });

        container.innerHTML =
            '<div class="at-chart-card"><h4>CPA by Campaign Type</h4><div id="atGoogleTypeChart" class="at-chart-area">' + renderSimpleBarChart(typeBuckets) + '</div></div>' +
            '<div class="at-chart-card"><h4>CPA by Device</h4><div id="atGoogleDeviceChart" class="at-chart-area">' + renderSimpleBarChart(deviceBuckets) + '</div></div>';
    }

    function renderSimpleBarChart(data) {
        var entries = Object.entries(data).map(function(e) { return { label: e[0], value: e[1].total_cpa / e[1].count }; }).sort(function(a,b) { return a.value - b.value; });
        if (!entries.length) return '<div class="at-empty-sub" style="padding:40px">No data available</div>';
        var max = Math.max.apply(null, entries.map(function(e) { return e.value; }));
        return '<div style="display:flex;flex-direction:column;gap:6px;padding:8px 0">' + entries.slice(0, 8).map(function(e) {
            var pct = max > 0 ? (e.value / max * 100) : 0;
            return '<div style="display:flex;align-items:center;gap:8px">' +
                '<span style="font-size:11px;color:var(--text-dim);width:80px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + AT.esc(e.label) + '</span>' +
                '<div style="flex:1;height:18px;background:rgba(255,255,255,0.03);border-radius:4px;overflow:hidden">' +
                '<div style="height:100%;width:' + pct.toFixed(0) + '%;background:linear-gradient(90deg,rgba(99,102,241,0.5),rgba(99,102,241,0.2));border-radius:4px;transition:width 0.5s"></div></div>' +
                '<span style="font-size:11px;font-weight:600;color:var(--text);width:60px">' + AT.fmtINR(e.value) + '</span></div>';
        }).join('') + '</div>';
    }

    // ── Recommendations ──
    ATGoogle.switchRecTab = function(tab) {
        _recTab = tab;
        document.querySelectorAll('#atGoogleView .at-rec-tab').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === tab); });
        renderRecFilters();
        renderRecs();
    };

    function renderRecFilters() {
        var container = document.getElementById('atGoogleRecFilters');
        if (!container) return;
        if (_recTab === 'tests') {
            container.innerHTML =
                '<select class="at-filter-select" onchange="ATGoogle.setFilter(\'campaignType\',this.value)"><option value="all">All Types</option><option value="SEARCH">Search</option><option value="DISPLAY">Display</option><option value="VIDEO">Video</option><option value="PERFORMANCE_MAX">PMax</option></select>' +
                '<select class="at-filter-select" onchange="ATGoogle.setFilter(\'priority\',this.value)"><option value="all">All Priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>';
        } else {
            container.innerHTML =
                '<select class="at-filter-select" onchange="ATGoogle.setFilter(\'urgency\',this.value)"><option value="all">All Urgency</option><option value="immediate">Immediate</option><option value="this_week">This Week</option><option value="next_sprint">Next Sprint</option></select>' +
                '<select class="at-filter-select" onchange="ATGoogle.setFilter(\'campaignType\',this.value)"><option value="all">All Types</option><option value="SEARCH">Search</option><option value="DISPLAY">Display</option><option value="VIDEO">Video</option><option value="PERFORMANCE_MAX">PMax</option></select>';
        }
    }

    ATGoogle.setFilter = function(key, val) { _filters[key] = val; renderRecs(); };

    function renderRecs() {
        var container = document.getElementById('atGoogleRecs');
        if (!container) return;

        var items = _recTab === 'tests' ? (_data.recommendations.tests || []) : (_data.recommendations.optimizations || []);

        // Apply filters
        if (_filters.campaignType !== 'all') items = items.filter(function(r) { return (r.campaign_type || '').toUpperCase() === _filters.campaignType.toUpperCase(); });
        if (_recTab === 'tests' && _filters.priority !== 'all') items = items.filter(function(r) { return (r.priority || '').toLowerCase() === _filters.priority; });
        if (_recTab === 'optimizations' && _filters.urgency !== 'all') items = items.filter(function(r) { return (r.urgency || '').toLowerCase() === _filters.urgency; });

        if (!items.length) {
            container.innerHTML = '<div class="at-empty"><div class="at-empty-icon">' + (_recTab === 'tests' ? '\uD83E\uDDEA' : '\u26A1') + '</div><div class="at-empty-text">No ' + _recTab + ' yet</div><div class="at-empty-sub">Generate brain output to see actionable insights</div><button class="at-scan-btn" onclick="AT.apiPost(\'/audience/brain\', { platform: \'google\', user_request: \'Optimizer-level audience insights and actions\' }).then(function(){ATGoogle.refresh()})">Generate Brain</button></div>';
            return;
        }

        if (_recTab === 'tests') {
            container.innerHTML = items.map(function(r) {
                return '<div class="at-rec-card">' +
                    '<div class="at-rec-card-header"><span class="at-rec-priority ' + (r.priority || 'medium').toLowerCase() + '">' + (r.priority || 'MEDIUM').toUpperCase() + '</span><span class="at-rec-title">' + AT.esc(r.title) + '</span></div>' +
                    '<div class="at-rec-hypothesis">' + AT.esc(r.hypothesis) + '</div>' +
                    '<div class="at-rec-metrics">' +
                        '<span class="at-rec-metric">Expected CPA: <strong>' + AT.fmtINR(r.expected_cpa) + '</strong></span>' +
                        '<span class="at-rec-metric">Expected ROAS: <strong>' + AT.fmtROAS(r.expected_roas) + '</strong></span>' +
                        '<span class="at-rec-metric">Campaign Type: <strong>' + AT.esc(r.campaign_type || '--') + '</strong></span>' +
                    '</div>' +
                    '<div class="at-rec-actions">' +
                        '<button class="at-rec-btn primary" onclick="ATGoogle.viewSpec(' + r.id + ')">View Full Spec</button>' +
                        '<button class="at-rec-btn success" onclick="ATGoogle.markDone(' + r.id + ')">Implemented</button>' +
                        '<button class="at-rec-btn danger" onclick="ATGoogle.dismissRec(' + r.id + ')">Dismiss</button>' +
                    '</div></div>';
            }).join('');
        } else {
            container.innerHTML = items.map(function(r) {
                return '<div class="at-rec-card">' +
                    '<div class="at-rec-card-header">' +
                        '<span class="at-urgency ' + (r.urgency || 'this_week').toLowerCase() + '">' + (r.urgency || 'THIS WEEK').toUpperCase().replace('_', ' ') + '</span>' +
                        '<span class="at-action-type ' + (r.action_type === 'PAUSE' ? 'pause' : r.action_type === 'SCALE' ? 'scale' : 'keep') + '">' + AT.esc(r.action_type) + '</span>' +
                        '<span class="at-rec-title">' + AT.esc(r.adgroup_name || r.campaign_name || r.title) + '</span>' +
                    '</div>' +
                    '<div class="at-rec-metrics">' +
                        '<span class="at-rec-metric">CPA: <strong>' + AT.fmtINR(r.current_cpa) + '</strong></span>' +
                        '<span class="at-rec-metric">ROAS: <strong>' + AT.fmtROAS(r.current_roas) + '</strong></span>' +
                        '<span class="at-rec-metric">Conv Value: <strong>' + AT.fmtINR(r.conversion_value) + '</strong></span>' +
                    '</div>' +
                    '<div class="at-rec-hypothesis">' + AT.esc(r.rationale || r.specific_change) + '</div>' +
                    '<div class="at-rec-actions">' +
                        '<button class="at-rec-btn success" onclick="ATGoogle.markDone(' + r.id + ')">Done</button>' +
                        '<button class="at-rec-btn danger" onclick="ATGoogle.dismissRec(' + r.id + ')">Disagree</button>' +
                    '</div></div>';
            }).join('');
        }
    }

    ATGoogle.viewSpec = async function(id) {
        var r = await AT.api('/tests/' + id + '/spec');
        if (!r.success || !r.data) { alert('Could not load spec'); return; }
        var spec = r.data;
        var html = '<h3>' + AT.esc(spec.adgroup_name || spec.campaign_name || 'Test Spec') + '</h3>';

        // Targeting section
        html += '<div class="at-drawer-section"><h4>Targeting</h4>';
        var tgt = spec.targeting || {};
        if (tgt.audience_lists && tgt.audience_lists.length) {
            html += '<div class="at-drawer-row"><span class="at-drawer-label">Audience Lists</span><span class="at-drawer-value">' + AT.esc(tgt.audience_lists.join(', ')) + '</span></div>';
        }
        if (tgt.in_market_segments && tgt.in_market_segments.length) {
            html += '<div class="at-drawer-row"><span class="at-drawer-label">In-Market Segments</span><span class="at-drawer-value">' + AT.esc(tgt.in_market_segments.join(', ')) + '</span></div>';
        }
        if (tgt.custom_intent_keywords && tgt.custom_intent_keywords.length) {
            html += '<div class="at-drawer-row"><span class="at-drawer-label">Custom Intent Keywords</span><span class="at-drawer-value">' + AT.esc(tgt.custom_intent_keywords.join(', ')) + '</span></div>';
        }
        if (tgt.affinity_segments && tgt.affinity_segments.length) {
            html += '<div class="at-drawer-row"><span class="at-drawer-label">Affinity Segments</span><span class="at-drawer-value">' + AT.esc(tgt.affinity_segments.join(', ')) + '</span></div>';
        }
        if (tgt.demographics) {
            var demo = tgt.demographics;
            if (demo.age_ranges) html += '<div class="at-drawer-row"><span class="at-drawer-label">Age Ranges</span><span class="at-drawer-value">' + AT.esc(demo.age_ranges.join(', ')) + '</span></div>';
            if (demo.genders) html += '<div class="at-drawer-row"><span class="at-drawer-label">Genders</span><span class="at-drawer-value">' + AT.esc(demo.genders.join(', ')) + '</span></div>';
            if (demo.household_income) html += '<div class="at-drawer-row"><span class="at-drawer-label">Household Income</span><span class="at-drawer-value">' + AT.esc(demo.household_income.join(', ')) + '</span></div>';
        }
        if (tgt.locations && tgt.locations.length) {
            html += '<div class="at-drawer-row"><span class="at-drawer-label">Locations</span><span class="at-drawer-value">' + AT.esc(tgt.locations.join(', ')) + '</span></div>';
        }
        if (tgt.device_targeting && tgt.device_targeting.length) {
            html += '<div class="at-drawer-row"><span class="at-drawer-label">Devices</span><span class="at-drawer-value">' + AT.esc(tgt.device_targeting.join(', ')) + '</span></div>';
        }
        html += '</div>';

        // Budget & Bidding section
        html += '<div class="at-drawer-section"><h4>Budget & Bidding</h4>';
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Campaign Type</span><span class="at-drawer-value">' + AT.esc(spec.campaign_type || '--') + '</span></div>';
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Daily Budget</span><span class="at-drawer-value">' + AT.fmtINR(spec.daily_budget || 0) + '</span></div>';
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Bidding Strategy</span><span class="at-drawer-value">' + AT.esc(spec.bidding_strategy || '--') + '</span></div>';
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Target CPA</span><span class="at-drawer-value">' + AT.fmtINR(spec.target_cpa || 0) + '</span></div>';
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Target ROAS</span><span class="at-drawer-value">' + AT.fmtROAS(spec.target_roas) + '</span></div>';
        html += '</div>';

        // Setup checklist
        if (spec.setup_checklist) {
            html += '<div class="at-drawer-section"><h4>Setup Checklist</h4><ul class="at-checklist">';
            spec.setup_checklist.forEach(function(item) { html += '<li>' + AT.esc(item) + '</li>'; });
            html += '</ul></div>';
        }

        AT.openDrawer(html);
    };

    ATGoogle.markDone = async function(id) { await AT.apiPost('/recommendations/' + id + '/mark-implemented'); ATGoogle.refresh(); };
    ATGoogle.dismissRec = async function(id) { var reason = prompt('Reason for dismissal?') || 'No reason'; await AT.apiPost('/recommendations/' + id + '/dismiss', { reason: reason }); ATGoogle.refresh(); };

    // ── Explorer Table ──
    function renderExplorer() {
        var controls = document.getElementById('atGoogleTableControls');
        var tableContainer = document.getElementById('atGoogleTable');
        if (!controls || !tableContainer) return;

        // Build campaign type lookup
        var campaignTypeMap = {};
        _data.campaigns.forEach(function(c) {
            campaignTypeMap[c.campaign_id] = c.campaign_type || c.advertising_channel_type || 'UNKNOWN';
        });

        controls.innerHTML =
            '<span style="font-size:12px;color:var(--text-dim)">' + _data.adgroups.length + ' ad groups</span>' +
            '<select class="at-filter-select" onchange="ATGoogle.setFilter(\'campaignType\',this.value);ATGoogle.reRenderExplorer()"><option value="all">All Types</option><option value="SEARCH">Search</option><option value="DISPLAY">Display</option><option value="VIDEO">Video</option><option value="PERFORMANCE_MAX">PMax</option></select>' +
            '<select class="at-filter-select" onchange="ATGoogle.setFilter(\'status\',this.value);ATGoogle.reRenderExplorer()"><option value="all">All Status</option><option value="ENABLED">Enabled</option><option value="PAUSED">Paused</option></select>';

        ATGoogle.reRenderExplorer();
    }

    ATGoogle.reRenderExplorer = function() {
        var tableContainer = document.getElementById('atGoogleTable');
        if (!tableContainer) return;

        // Build campaign lookups
        var campaignTypeMap = {};
        var campaignNameMap = {};
        _data.campaigns.forEach(function(c) {
            campaignTypeMap[c.campaign_id] = c.campaign_type || c.advertising_channel_type || 'UNKNOWN';
            campaignNameMap[c.campaign_id] = c.name || c.campaign_name || '';
        });

        var filtered = _data.adgroups.slice();

        // Filter by campaign type
        if (_filters.campaignType !== 'all') {
            filtered = filtered.filter(function(a) {
                var cType = (campaignTypeMap[a.campaign_id] || a.campaign_type || '').toUpperCase();
                return cType === _filters.campaignType.toUpperCase();
            });
        }
        if (_filters.status !== 'all') filtered = filtered.filter(function(a) { return (a.status || '').toUpperCase() === _filters.status; });

        // Sort
        filtered.sort(function(a, b) {
            var va = a[_sortCol] || 0, vb = b[_sortCol] || 0;
            if (typeof va === 'string') va = va.toLowerCase();
            if (typeof vb === 'string') vb = vb.toLowerCase();
            return _sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
        });

        var cols = [
            { key: 'name', label: 'Ad Group' },
            { key: 'status', label: 'Status' },
            { key: 'campaign_type', label: 'Campaign Type' },
            { key: 'bidding_strategy', label: 'Bidding' },
            { key: 'target_cpa', label: 'Target CPA' },
            { key: 'cost', label: 'Cost' },
            { key: 'cpa', label: 'CPA' },
            { key: 'conversions', label: 'Conv' },
            { key: 'conversion_value', label: 'Conv Value' },
            { key: 'roas', label: 'ROAS' }
        ];

        var html = '<table class="at-table"><thead><tr>';
        cols.forEach(function(c) {
            var cls = _sortCol === c.key ? ('sorted-' + _sortDir) : '';
            html += '<th class="' + cls + '" onclick="ATGoogle.sortBy(\'' + c.key + '\')">' + c.label + '</th>';
        });
        html += '</tr></thead><tbody>';

        filtered.slice(0, 200).forEach(function(a) {
            var cType = campaignTypeMap[a.campaign_id] || a.campaign_type || '--';
            var cpa = a.cpa || a.cost_per_conversion || 0;
            var roas = a.roas || (a.conversion_value && a.cost ? a.conversion_value / a.cost : 0);

            html += '<tr>' +
                '<td title="' + AT.esc(a.name) + '">' + AT.esc((a.name || '').slice(0, 40)) + '</td>' +
                '<td>' + AT.statusBadge(a.status) + '</td>' +
                '<td>' + AT.esc(cType) + '</td>' +
                '<td style="font-size:11px">' + AT.esc(a.bidding_strategy || a.bid_strategy || '--') + '</td>' +
                '<td>' + AT.fmtINR(a.target_cpa) + '</td>' +
                '<td>' + AT.fmtINR(a.cost) + '</td>' +
                '<td style="color:' + (cpa > 2000 ? 'var(--red)' : cpa > 0 ? 'var(--green)' : 'var(--text-dim)') + '">' + AT.fmtINR(cpa) + '</td>' +
                '<td>' + (a.conversions || 0) + '</td>' +
                '<td>' + AT.fmtINR(a.conversion_value) + '</td>' +
                '<td style="color:' + (roas > 1 ? 'var(--green)' : roas > 0 ? 'var(--orange)' : 'var(--text-dim)') + '">' + AT.fmtROAS(roas) + '</td>' +
                '</tr>';
        });
        html += '</tbody></table>';
        tableContainer.innerHTML = html;
    };

    ATGoogle.sortBy = function(col) {
        if (_sortCol === col) { _sortDir = _sortDir === 'asc' ? 'desc' : 'asc'; }
        else { _sortCol = col; _sortDir = 'desc'; }
        ATGoogle.reRenderExplorer();
    };
})();
