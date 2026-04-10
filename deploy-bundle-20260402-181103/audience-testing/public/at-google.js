(function() {
    'use strict';
    window.ATGoogle = window.ATGoogle || {};

    var _data = { flags: [], patterns: [], recommendations: [], adgroups: [], campaigns: [] };
    var _recTab = 'tests';
    var _sortCol = 'cost';
    var _sortDir = 'desc';
    var _filters = { campaignType: 'all', priority: 'all', urgency: 'all', status: 'all' };

    ATGoogle.init = async function() {
        var container = document.getElementById('atGoogleView');
        if (!container) { console.warn('[ATGoogle] atGoogleView not found'); return; }

        // Build layout immediately so sections are visible
        container.innerHTML = buildLayout();

        // Load all data in parallel
        try {
            await Promise.all([loadFlags(), loadPatterns(), loadRecommendations(), loadAdgroups(), loadCampaigns()]);
        } catch(e) { console.error('[ATGoogle] data load error:', e); }

        renderAll();

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
        await Promise.all([loadFlags(), loadPatterns(), loadRecommendations(), loadAdgroups(), loadCampaigns()]);
        renderAll();
    };

    function buildLayout() {
        return '' +
            '<!-- Section 1: Live Health Monitor -->' +
            '<div class="at-section">' +
                '<div class="at-section-title">Live Health Monitor</div>' +
                '<div id="atGoogleFlagsSummary" class="at-flags-strip"></div>' +
                '<div id="atGoogleFlags" class="at-flags-strip" style="margin-top:8px"></div>' +
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
    async function loadRecommendations() {
        var testsR = await AT.api('/recommendations/tests?platform=google');
        var optsR = await AT.api('/recommendations/optimizations?platform=google');
        _data.recommendations = { tests: (testsR.success ? testsR.data : []) || [], optimizations: (optsR.success ? optsR.data : []) || [] };
    }
    async function loadAdgroups() { var r = await AT.api('/google/adgroups'); if (r.success) _data.adgroups = r.data || []; }
    async function loadCampaigns() { var r = await AT.api('/google/campaigns'); if (r.success) _data.campaigns = r.data || []; }

    function renderAll() { renderFlags(); renderInsights(); renderCharts(); renderRecFilters(); renderRecs(); renderExplorer(); }

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
            container.innerHTML = '<div class="at-empty"><div class="at-empty-icon">' + (_recTab === 'tests' ? '\uD83E\uDDEA' : '\u26A1') + '</div><div class="at-empty-text">No ' + _recTab + ' yet</div><div class="at-empty-sub">Generate recommendations to see actionable insights</div><button class="at-scan-btn" onclick="AT.apiPost(\'/recommendations/generate?platform=google\').then(function(){ATGoogle.refresh()})">Generate Recommendations</button></div>';
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
