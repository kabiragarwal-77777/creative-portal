(function() {
    'use strict';
    window.ATMeta = window.ATMeta || {};

    var _data = { flags: [], patterns: [], recommendations: [], adsets: [] };
    var _recTab = 'tests';
    var _sortCol = 'total_spend';
    var _sortDir = 'desc';
    var _filters = { vertical: 'all', priority: 'all', urgency: 'all', status: 'all', audienceType: 'all' };

    ATMeta.init = async function() {
        var container = document.getElementById('atMetaView');
        if (!container) { console.warn('[ATMeta] atMetaView not found'); return; }

        // Build layout immediately so sections are visible
        container.innerHTML = buildLayout();

        // Load all data in parallel
        try {
            await Promise.all([loadFlags(), loadPatterns(), loadRecommendations(), loadAdsets()]);
        } catch(e) { console.error('[ATMeta] data load error:', e); }

        renderAll();

        // If completely empty, show a helpful empty state at top
        if (!_data.adsets.length && !_data.patterns.length && !_data.recommendations.tests?.length) {
            var emptyBanner = document.createElement('div');
            emptyBanner.className = 'at-empty';
            emptyBanner.style.cssText = 'margin-bottom:16px';
            emptyBanner.innerHTML = '<div class="at-empty-icon">\uD83C\uDFAF</div><div class="at-empty-text">No Meta audience data yet</div><div class="at-empty-sub">Click "Scan Now" above to pull all campaign & adset targeting data from Meta</div>';
            container.insertBefore(emptyBanner, container.firstChild);
        }

        // Auto-refresh flags every 5 min
        setInterval(loadFlags, 5 * 60 * 1000);
    };

    ATMeta.refresh = async function() {
        await Promise.all([loadFlags(), loadPatterns(), loadRecommendations(), loadAdsets()]);
        renderAll();
    };

    function buildLayout() {
        return '' +
            '<!-- Section 1: Live Health Monitor -->' +
            '<div class="at-section">' +
                '<div class="at-section-title">Live Health Monitor</div>' +
                '<div id="atMetaFlagsSummary" class="at-flags-strip"></div>' +
                '<div id="atMetaFlags" class="at-flags-strip" style="margin-top:8px"></div>' +
            '</div>' +

            '<!-- Section 2: Audience Intelligence -->' +
            '<div class="at-section">' +
                '<div class="at-section-title">Audience Intelligence</div>' +
                '<div id="atMetaInsights" class="at-insights-grid"></div>' +
                '<div id="atMetaCharts" class="at-charts-grid" style="margin-top:16px"></div>' +
            '</div>' +

            '<!-- Section 3: Recommendations -->' +
            '<div class="at-section">' +
                '<div class="at-section-title">Recommendations</div>' +
                '<div class="at-rec-tabs">' +
                    '<button class="at-rec-tab active" data-tab="tests" onclick="ATMeta.switchRecTab(\'tests\')">Future Tests</button>' +
                    '<button class="at-rec-tab" data-tab="optimizations" onclick="ATMeta.switchRecTab(\'optimizations\')">Current Optimizations</button>' +
                '</div>' +
                '<div id="atMetaRecFilters" class="at-filter-bar"></div>' +
                '<div id="atMetaRecs" class="at-rec-list"></div>' +
            '</div>' +

            '<!-- Section 4: Audience Explorer -->' +
            '<div class="at-section">' +
                '<div class="at-section-title">Audience Explorer</div>' +
                '<div class="at-explorer">' +
                    '<div id="atMetaTableControls" class="at-table-controls"></div>' +
                    '<div id="atMetaTable" class="at-table-wrapper"></div>' +
                '</div>' +
            '</div>';
    }

    async function loadFlags() { var r = await AT.api('/live/flags?platform=meta'); if (r.success) _data.flags = r.data || []; }
    async function loadPatterns() { var r = await AT.api('/patterns/meta'); if (r.success) _data.patterns = r.data || []; }
    async function loadRecommendations() {
        var testsR = await AT.api('/recommendations/tests?platform=meta');
        var optsR = await AT.api('/recommendations/optimizations?platform=meta');
        _data.recommendations = { tests: (testsR.success ? testsR.data : []) || [], optimizations: (optsR.success ? optsR.data : []) || [] };
    }
    async function loadAdsets() { var r = await AT.api('/meta/adsets'); if (r.success) _data.adsets = r.data || []; }

    function renderAll() { renderFlags(); renderInsights(); renderCharts(); renderRecFilters(); renderRecs(); renderExplorer(); }

    // ── Flags ──
    function renderFlags() {
        var critical = _data.flags.filter(function(f) { return f.severity === 'critical' || f.severity === 'CRITICAL'; });
        var warning = _data.flags.filter(function(f) { return f.severity === 'warning' || f.severity === 'WARNING'; });
        var opp = _data.flags.filter(function(f) { return f.severity === 'opportunity' || f.severity === 'OPPORTUNITY'; });

        var summary = document.getElementById('atMetaFlagsSummary');
        if (summary) {
            summary.innerHTML =
                (critical.length ? '<span class="at-flag-badge critical">' + critical.length + ' Critical</span>' : '') +
                (warning.length ? '<span class="at-flag-badge warning">' + warning.length + ' Warning' + (warning.length > 1 ? 's' : '') + '</span>' : '') +
                (opp.length ? '<span class="at-flag-badge opportunity">' + opp.length + ' Opportunit' + (opp.length > 1 ? 'ies' : 'y') + '</span>' : '') +
                (!_data.flags.length ? '<span style="color:var(--text-dim);font-size:12px">No active flags \u2014 all healthy</span>' : '');
        }

        var container = document.getElementById('atMetaFlags');
        if (!container) return;
        if (!_data.flags.length) { container.innerHTML = ''; return; }
        container.innerHTML = _data.flags.slice(0, 12).map(function(f) {
            var sev = (f.severity || 'info').toLowerCase();
            return '<div class="at-flag-card ' + sev + '">' +
                '<div class="at-flag-card-title">' + AT.esc(f.flag_type || f.flag) + ': ' + AT.esc(f.adset_name) + '</div>' +
                '<div class="at-flag-card-msg">' + AT.esc(f.message) + '</div></div>';
        }).join('');
    }

    // ── Insights ──
    function renderInsights() {
        var container = document.getElementById('atMetaInsights');
        if (!container) return;

        var aiSynthesis = _data.patterns.find(function(p) { return p.pattern_type === 'ai_synthesis'; });
        var byCAC = _data.patterns.filter(function(p) { return p.pattern_type === 'combination' && p.avg_d6_cac > 0; }).sort(function(a,b) { return a.avg_d6_cac - b.avg_d6_cac; });
        var worstCAC = _data.patterns.filter(function(p) { return p.pattern_type === 'combination' && p.avg_d6_cac > 0; }).sort(function(a,b) { return b.avg_d6_cac - a.avg_d6_cac; });

        var bestHtml = '<div class="at-insight-panel"><h3>Best Audiences (by D6 CAC)</h3>';
        if (byCAC.length) {
            bestHtml += byCAC.slice(0, 5).map(function(p) {
                return '<div class="at-insight-item"><span class="at-insight-name">' + AT.esc(p.pattern_key) + '</span>' +
                    '<span class="at-insight-metric good">' + AT.fmtINR(p.avg_d6_cac) + '</span>' +
                    '<span class="at-insight-metric" style="color:var(--teal)">' + AT.fmtROAS(p.avg_d6_roas) + '</span>' +
                    AT.confidenceBadge(p.sample_conversions) + '</div>';
            }).join('');
        } else { bestHtml += '<div class="at-empty-sub" style="padding:20px">Run learning engine to see patterns</div>'; }
        bestHtml += '</div>';

        var worstHtml = '<div class="at-insight-panel"><h3>Worst Audiences (by D6 CAC)</h3>';
        if (worstCAC.length) {
            worstHtml += worstCAC.slice(0, 5).map(function(p) {
                return '<div class="at-insight-item"><span class="at-insight-name">' + AT.esc(p.pattern_key) + '</span>' +
                    '<span class="at-insight-metric bad">' + AT.fmtINR(p.avg_d6_cac) + '</span>' +
                    '<span class="at-insight-metric" style="color:var(--red)">' + AT.fmtROAS(p.avg_d6_roas) + '</span></div>';
            }).join('');
        } else { worstHtml += '<div class="at-empty-sub" style="padding:20px">Run learning engine to see patterns</div>'; }
        worstHtml += '</div>';

        var sweetHtml = '<div class="at-insight-panel">';
        if (aiSynthesis && aiSynthesis.synthesized_insight) {
            try {
                var insight = JSON.parse(aiSynthesis.synthesized_insight);
                var sweet = insight.demographic_sweet_spot || insight.sweet_spot || 'Run analysis to discover';
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
        var container = document.getElementById('atMetaCharts');
        if (!container) return;
        // Group adsets by age bucket for D6 CAC chart
        var ageBuckets = {};
        var placementBuckets = {};
        _data.adsets.forEach(function(a) {
            if (!a.d6_cac || a.d6_cac <= 0) return;
            var bucket = (a.age_min || 18) + '-' + (a.age_max || 65);
            if (!ageBuckets[bucket]) ageBuckets[bucket] = { total_cac: 0, count: 0 };
            ageBuckets[bucket].total_cac += a.d6_cac;
            ageBuckets[bucket].count++;

            try {
                var positions = JSON.parse(a.facebook_positions_json || '[]');
                positions.forEach(function(p) {
                    if (!placementBuckets[p]) placementBuckets[p] = { total_cac: 0, count: 0 };
                    placementBuckets[p].total_cac += a.d6_cac;
                    placementBuckets[p].count++;
                });
            } catch(e) {}
        });

        // Simple bar charts using divs (no Chart.js dependency)
        container.innerHTML =
            '<div class="at-chart-card"><h4>D6 CAC by Age Group</h4><div id="atMetaAgeChart" class="at-chart-area">' + renderSimpleBarChart(ageBuckets, 'cac') + '</div></div>' +
            '<div class="at-chart-card"><h4>D6 CAC by Placement</h4><div id="atMetaPlacementChart" class="at-chart-area">' + renderSimpleBarChart(placementBuckets, 'cac') + '</div></div>';
    }

    function renderSimpleBarChart(data, type) {
        var entries = Object.entries(data).map(function(e) { return { label: e[0], value: e[1].total_cac / e[1].count }; }).sort(function(a,b) { return a.value - b.value; });
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
    ATMeta.switchRecTab = function(tab) {
        _recTab = tab;
        document.querySelectorAll('.at-rec-tab').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === tab); });
        renderRecFilters();
        renderRecs();
    };

    function renderRecFilters() {
        var container = document.getElementById('atMetaRecFilters');
        if (!container) return;
        if (_recTab === 'tests') {
            container.innerHTML =
                '<select class="at-filter-select" onchange="ATMeta.setFilter(\'vertical\',this.value)"><option value="all">All Verticals</option><option value="RA">RA</option><option value="Broking">Broking</option><option value="MFA">MFA</option></select>' +
                '<select class="at-filter-select" onchange="ATMeta.setFilter(\'priority\',this.value)"><option value="all">All Priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>';
        } else {
            container.innerHTML =
                '<select class="at-filter-select" onchange="ATMeta.setFilter(\'urgency\',this.value)"><option value="all">All Urgency</option><option value="immediate">Immediate</option><option value="this_week">This Week</option><option value="next_sprint">Next Sprint</option></select>';
        }
    }

    ATMeta.setFilter = function(key, val) { _filters[key] = val; renderRecs(); };

    function renderRecs() {
        var container = document.getElementById('atMetaRecs');
        if (!container) return;

        var items = _recTab === 'tests' ? (_data.recommendations.tests || []) : (_data.recommendations.optimizations || []);

        // Apply filters
        if (_filters.vertical !== 'all') items = items.filter(function(r) { return (r.vertical || '').toLowerCase() === _filters.vertical.toLowerCase(); });
        if (_recTab === 'tests' && _filters.priority !== 'all') items = items.filter(function(r) { return (r.priority || '').toLowerCase() === _filters.priority; });
        if (_recTab === 'optimizations' && _filters.urgency !== 'all') items = items.filter(function(r) { return (r.urgency || '').toLowerCase() === _filters.urgency; });

        if (!items.length) {
            container.innerHTML = '<div class="at-empty"><div class="at-empty-icon">' + (_recTab === 'tests' ? '\uD83E\uDDEA' : '\u26A1') + '</div><div class="at-empty-text">No ' + _recTab + ' yet</div><div class="at-empty-sub">Generate recommendations to see actionable insights</div><button class="at-scan-btn" onclick="AT.apiPost(\'/recommendations/generate\').then(function(){ATMeta.refresh()})">Generate Recommendations</button></div>';
            return;
        }

        if (_recTab === 'tests') {
            container.innerHTML = items.map(function(r) {
                return '<div class="at-rec-card">' +
                    '<div class="at-rec-card-header"><span class="at-rec-priority ' + (r.priority || 'medium').toLowerCase() + '">' + (r.priority || 'MEDIUM').toUpperCase() + '</span><span class="at-rec-title">' + AT.esc(r.title) + '</span></div>' +
                    '<div class="at-rec-hypothesis">' + AT.esc(r.hypothesis) + '</div>' +
                    '<div class="at-rec-metrics">' +
                        '<span class="at-rec-metric">Expected D6 CAC: <strong>' + AT.fmtINR(r.expected_d6_cac) + '</strong></span>' +
                        '<span class="at-rec-metric">Expected ROAS: <strong>' + AT.fmtROAS(r.expected_d6_roas) + '</strong></span>' +
                        '<span class="at-rec-metric">Vertical: <strong>' + AT.esc(r.vertical || '--') + '</strong></span>' +
                    '</div>' +
                    '<div class="at-rec-actions">' +
                        '<button class="at-rec-btn primary" onclick="ATMeta.viewSpec(' + r.id + ')">View Full Spec</button>' +
                        '<button class="at-rec-btn success" onclick="ATMeta.markDone(' + r.id + ')">Implemented</button>' +
                        '<button class="at-rec-btn danger" onclick="ATMeta.dismissRec(' + r.id + ')">Dismiss</button>' +
                    '</div></div>';
            }).join('');
        } else {
            container.innerHTML = items.map(function(r) {
                return '<div class="at-rec-card">' +
                    '<div class="at-rec-card-header">' +
                        '<span class="at-urgency ' + (r.urgency || 'this_week').toLowerCase() + '">' + (r.urgency || 'THIS WEEK').toUpperCase().replace('_', ' ') + '</span>' +
                        '<span class="at-action-type ' + (r.action_type === 'PAUSE' ? 'pause' : r.action_type === 'SCALE' ? 'scale' : 'keep') + '">' + AT.esc(r.action_type) + '</span>' +
                        '<span class="at-rec-title">' + AT.esc(r.adset_name || r.title) + '</span>' +
                    '</div>' +
                    '<div class="at-rec-metrics">' +
                        '<span class="at-rec-metric">D6 CAC: <strong>' + AT.fmtINR(r.current_d6_cac) + '</strong></span>' +
                        '<span class="at-rec-metric">D6 ROAS: <strong>' + AT.fmtROAS(r.current_d6_roas) + '</strong></span>' +
                    '</div>' +
                    '<div class="at-rec-hypothesis">' + AT.esc(r.rationale || r.specific_change) + '</div>' +
                    '<div class="at-rec-actions">' +
                        '<button class="at-rec-btn success" onclick="ATMeta.markDone(' + r.id + ')">Done</button>' +
                        '<button class="at-rec-btn danger" onclick="ATMeta.dismissRec(' + r.id + ')">Disagree</button>' +
                    '</div></div>';
            }).join('');
        }
    }

    ATMeta.viewSpec = async function(id) {
        var r = await AT.api('/tests/' + id + '/spec');
        if (!r.success || !r.data) { alert('Could not load spec'); return; }
        var spec = r.data;
        var html = '<h3>' + AT.esc(spec.adset_name || 'Test Spec') + '</h3>';
        html += '<div class="at-drawer-section"><h4>Targeting</h4>';
        var tgt = spec.targeting || {};
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Age</span><span class="at-drawer-value">' + (tgt.age_min || 18) + '\u2013' + (tgt.age_max || 65) + '</span></div>';
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Gender</span><span class="at-drawer-value">' + AT.esc(JSON.stringify(tgt.genders || [])) + '</span></div>';
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Interests</span><span class="at-drawer-value">' + AT.esc((tgt.interests || []).join(', ') || 'None') + '</span></div>';
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Custom Audiences</span><span class="at-drawer-value">' + AT.esc((tgt.custom_audiences || []).join(', ') || 'None') + '</span></div>';
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Placements</span><span class="at-drawer-value">' + AT.esc((tgt.facebook_positions || []).concat(tgt.instagram_positions || []).join(', ') || 'Auto') + '</span></div>';
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Devices</span><span class="at-drawer-value">' + AT.esc((tgt.device_platforms || []).join(', ') || 'All') + '</span></div>';
        html += '</div>';
        html += '<div class="at-drawer-section"><h4>Budget & Bidding</h4>';
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Daily Budget</span><span class="at-drawer-value">' + AT.fmtINR(spec.daily_budget ? spec.daily_budget / 100 : 0) + '</span></div>';
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Bid Strategy</span><span class="at-drawer-value">' + AT.esc(spec.bid_strategy) + '</span></div>';
        html += '<div class="at-drawer-row"><span class="at-drawer-label">Optimization</span><span class="at-drawer-value">' + AT.esc(spec.optimization_goal) + '</span></div>';
        html += '</div>';
        if (spec.setup_checklist) {
            html += '<div class="at-drawer-section"><h4>Setup Checklist</h4><ul class="at-checklist">';
            spec.setup_checklist.forEach(function(item) { html += '<li>' + AT.esc(item) + '</li>'; });
            html += '</ul></div>';
        }
        AT.openDrawer(html);
    };

    ATMeta.markDone = async function(id) { await AT.apiPost('/recommendations/' + id + '/mark-implemented'); ATMeta.refresh(); };
    ATMeta.dismissRec = async function(id) { var reason = prompt('Reason for dismissal?') || 'No reason'; await AT.apiPost('/recommendations/' + id + '/dismiss', { reason: reason }); ATMeta.refresh(); };

    // ── Explorer Table ──
    function renderExplorer() {
        var controls = document.getElementById('atMetaTableControls');
        var tableContainer = document.getElementById('atMetaTable');
        if (!controls || !tableContainer) return;

        controls.innerHTML =
            '<span style="font-size:12px;color:var(--text-dim)">' + _data.adsets.length + ' adsets</span>' +
            '<select class="at-filter-select" onchange="ATMeta.setFilter(\'vertical\',this.value);ATMeta.reRenderExplorer()"><option value="all">All Verticals</option><option value="RA">RA</option><option value="Broking">Broking</option><option value="MFA">MFA</option></select>' +
            '<select class="at-filter-select" onchange="ATMeta.setFilter(\'status\',this.value);ATMeta.reRenderExplorer()"><option value="all">All Status</option><option value="ACTIVE">Active</option><option value="PAUSED">Paused</option></select>';

        ATMeta.reRenderExplorer();
    }

    ATMeta.reRenderExplorer = function() {
        var tableContainer = document.getElementById('atMetaTable');
        if (!tableContainer) return;

        var filtered = _data.adsets.slice();
        if (_filters.status !== 'all') filtered = filtered.filter(function(a) { return (a.status || '').toUpperCase() === _filters.status; });

        // Sort
        filtered.sort(function(a, b) {
            var va = a[_sortCol] || 0, vb = b[_sortCol] || 0;
            return _sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
        });

        var cols = [
            { key: 'name', label: 'Adset Name' },
            { key: 'status', label: 'Status' },
            { key: 'age_min', label: 'Age' },
            { key: 'is_broad', label: 'Type' },
            { key: 'total_spend', label: 'Spend' },
            { key: 'd6_cac', label: 'D6 CAC' },
            { key: 'd6_roas', label: 'D6 ROAS' },
            { key: 'd6_cvr_pct', label: 'D6 CVR%' },
            { key: 'd6_conversions', label: 'D6 Conv' }
        ];

        var html = '<table class="at-table"><thead><tr>';
        cols.forEach(function(c) {
            var cls = _sortCol === c.key ? ('sorted-' + _sortDir) : '';
            html += '<th class="' + cls + '" onclick="ATMeta.sortBy(\'' + c.key + '\')">' + c.label + '</th>';
        });
        html += '</tr></thead><tbody>';

        filtered.slice(0, 200).forEach(function(a) {
            var audienceType = a.is_broad ? 'Broad' : 'Targeted';
            html += '<tr>' +
                '<td title="' + AT.esc(a.name) + '">' + AT.esc((a.name || '').slice(0, 40)) + '</td>' +
                '<td>' + AT.statusBadge(a.status) + '</td>' +
                '<td>' + (a.age_min || 18) + '\u2013' + (a.age_max || 65) + '</td>' +
                '<td>' + audienceType + '</td>' +
                '<td>' + AT.fmtINR(a.total_spend) + '</td>' +
                '<td style="color:' + (a.d6_cac > 2000 ? 'var(--red)' : a.d6_cac > 0 ? 'var(--green)' : 'var(--text-dim)') + '">' + AT.fmtINR(a.d6_cac) + '</td>' +
                '<td style="color:' + (a.d6_roas > 1 ? 'var(--green)' : a.d6_roas > 0 ? 'var(--orange)' : 'var(--text-dim)') + '">' + AT.fmtROAS(a.d6_roas) + '</td>' +
                '<td>' + AT.fmtPct(a.d6_cvr_pct) + '</td>' +
                '<td>' + (a.d6_conversions || 0) + '</td>' +
                '</tr>';
        });
        html += '</tbody></table>';
        tableContainer.innerHTML = html;
    };

    ATMeta.sortBy = function(col) {
        if (_sortCol === col) { _sortDir = _sortDir === 'asc' ? 'desc' : 'asc'; }
        else { _sortCol = col; _sortDir = 'desc'; }
        ATMeta.reRenderExplorer();
    };
})();
