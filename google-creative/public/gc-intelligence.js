(function() {
    'use strict';

    var GC = window.GC || {};
    var _data = null;
    var _learningData = null;
    var _filterType = 'all';
    var _filterPerf = 'all';
    var _loaded = false;
    var _chartInstances = {};
    var _lastPortalSignature = '';

    function getSelectedDays() {
        try {
            var ctx = window.getPortalAssistantContext ? window.getPortalAssistantContext() : null;
            var range = ctx && ctx.dateRange ? ctx.dateRange : null;
            if (range && range.since && range.until) {
                var start = new Date(range.since + 'T00:00:00');
                var end = new Date(range.until + 'T23:59:59');
                var days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
                if (days > 0) return days;
            }
        } catch (e) {}
        return 90;
    }

    function getSelectedRangeLabel() {
        try {
            var ctx = window.getPortalAssistantContext ? window.getPortalAssistantContext() : null;
            if (ctx && ctx.dateRange && ctx.dateRange.label) return ctx.dateRange.label;
        } catch (e) {}
        return 'Selected Range';
    }

    // Listen for tab activation
    document.addEventListener('gc-tab-activated', function(e) {
        if (e.detail && e.detail.tab === 'intelligence') {
            loadIntelligence();
        }
    });

    function loadIntelligence() {
        var container = document.getElementById('gcIntelligenceView');
        if (!container) return;

        if (!_loaded) {
            _loaded = true;
            container.innerHTML = buildShell();
            bindEvents();
        }

        fetchData();
    }

    function buildShell() {
        var rangeLabel = getSelectedRangeLabel();
        return '' +
            '<div class="gc-panel">' +
                // Header
                '<div class="gc-header">' +
                    '<h2>Google Ads Creative Intelligence</h2>' +
                    '<p>Performance analysis of Google ad creatives for ' + GC.esc(rangeLabel) + ' across RSA, Video, PMax, and Display formats</p>' +
                '</div>' +

                // KPI Strip
                '<div id="gcIntKpis" class="gc-kpi-strip">' +
                    kpiPlaceholder('Total Creatives') +
                    kpiPlaceholder('Best Ad Type') +
                    kpiPlaceholder('Avg ROAS (Selected)') +
                    kpiPlaceholder('Top Campaign') +
                '</div>' +

                // Filters
                '<div class="gc-filter-bar">' +
                    '<select id="gcIntTypeFilter" class="gc-filter-select">' +
                        '<option value="all">All Ad Types</option>' +
                        '<option value="RSA">RSA</option>' +
                        '<option value="Video">Video</option>' +
                        '<option value="PMax">PMax</option>' +
                        '<option value="Display">Display</option>' +
                    '</select>' +
                    '<select id="gcIntPerfFilter" class="gc-filter-select">' +
                        '<option value="all">All Performance</option>' +
                        '<option value="BEST">Best</option>' +
                        '<option value="GOOD">Good</option>' +
                        '<option value="LOW">Low</option>' +
                    '</select>' +
                    '<button id="gcIntRefreshBtn" class="gc-btn-secondary" style="margin-left:auto;">&#8635; Refresh</button>' +
                '</div>' +

                // Creative Cards
                '<div id="gcIntCards" class="gc-cards-grid"></div>' +

                // Charts Row
                '<div class="gc-chart-row">' +
                    '<div class="gc-chart-card">' +
                        '<h4>ROAS by Ad Type</h4>' +
                        '<canvas id="gcChartRoasByType" class="gc-chart-canvas"></canvas>' +
                    '</div>' +
                    '<div class="gc-chart-card">' +
                        '<h4>Performance Label Distribution</h4>' +
                        '<canvas id="gcChartPerfDist" class="gc-chart-canvas"></canvas>' +
                    '</div>' +
                    '<div class="gc-chart-card">' +
                        '<h4>ROAS Trend (Selected Range)</h4>' +
                        '<canvas id="gcChartRoasTrend" class="gc-chart-canvas"></canvas>' +
                    '</div>' +
                '</div>' +

                // Learning Report
                '<div class="gc-section">' +
                    '<div class="gc-section-title">&#128218; Learning Report</div>' +
                    '<div id="gcIntLearning"></div>' +
                '</div>' +
            '</div>';
    }

    function kpiPlaceholder(label) {
        return '<div class="gc-kpi-card">' +
            '<div class="gc-kpi-value" style="color:var(--text-dim);">--</div>' +
            '<div class="gc-kpi-label">' + label + '</div>' +
        '</div>';
    }

    function bindEvents() {
        var typeFilter = document.getElementById('gcIntTypeFilter');
        var perfFilter = document.getElementById('gcIntPerfFilter');
        var refreshBtn = document.getElementById('gcIntRefreshBtn');

        if (typeFilter) typeFilter.addEventListener('change', function() {
            _filterType = this.value;
            renderCards();
        });
        if (perfFilter) perfFilter.addEventListener('change', function() {
            _filterPerf = this.value;
            renderCards();
        });
        if (refreshBtn) refreshBtn.addEventListener('click', function() {
            fetchData();
        });
    }

    function fetchData() {
        showCardsLoading();
        var days = getSelectedDays();

        Promise.all([
            fetch('api/gc/creatives?days=' + days + '&type=all&performance=all')
                .then(function(r) { return r.json(); }),
            fetch('api/gc/learning/report')
                .then(function(r) { return r.json(); })
                .catch(function() { return { success: false, data: null }; })
        ]).then(function(results) {
            var creativesRes = results[0];
            var learningRes = results[1];

            if (creativesRes.success && creativesRes.data) {
                _data = creativesRes.data;
                renderKpis();
                renderCards();
                renderCharts();
            } else {
                showCardsError(creativesRes.error || 'Failed to load Google creatives data');
            }

            if (learningRes.success && learningRes.data) {
                _learningData = learningRes.data;
                renderLearning();
            } else {
                renderLearningEmpty();
            }
        }).catch(function(err) {
            showCardsError('Network error: ' + err.message);
        });
    }

    window.gcIntelligenceRefresh = fetchData;

    window.addEventListener('portal-data-updated', function() {
        var ctx = window.getPortalAssistantContext ? window.getPortalAssistantContext() : null;
        var range = ctx && ctx.dateRange ? ctx.dateRange : {};
        var diag = ctx && ctx.diagnostics ? ctx.diagnostics : {};
        var signature = [
            ctx && ctx.app || 'google',
            ctx && ctx.view || 'gcIntelligence',
            range.since || '',
            range.until || '',
            range.label || '',
            diag.source || '',
            diag.matchedKeys || 0,
            diag.unmatchedKeys || 0
        ].join('::');
        if (signature === _lastPortalSignature) return;
        _lastPortalSignature = signature;
        if (_loaded && document.getElementById('gcIntelligenceView') && document.getElementById('gcIntelligenceView').classList.contains('active')) {
            fetchData();
        }
    });

    function showCardsLoading() {
        var el = document.getElementById('gcIntCards');
        if (el) {
            el.innerHTML = '<div class="gc-loading">' +
                '<div class="gc-spinner"></div>' +
                '<div class="gc-loading-text">Fetching Google Ads creative data...</div>' +
            '</div>';
        }
    }

    function showCardsError(msg) {
        var el = document.getElementById('gcIntCards');
        if (el) {
            el.innerHTML = '<div class="gc-error">' + GC.esc(msg) + '</div>';
        }
    }

    // ---- KPI Rendering ----

    function renderKpis() {
        var el = document.getElementById('gcIntKpis');
        if (!el || !_data) return;

        var creatives = _data.creatives || [];
        var total = creatives.length;

        // Best ad type by avg ROAS
        var typeRoas = {};
        var typeCounts = {};
        creatives.forEach(function(c) {
            var t = c.ad_type || 'Unknown';
            if (!typeRoas[t]) { typeRoas[t] = 0; typeCounts[t] = 0; }
            typeRoas[t] += (c.roas || 0);
            typeCounts[t]++;
        });
        var bestType = '--';
        var bestTypeRoas = 0;
        Object.keys(typeRoas).forEach(function(t) {
            var avg = typeCounts[t] > 0 ? typeRoas[t] / typeCounts[t] : 0;
            if (avg > bestTypeRoas) {
                bestTypeRoas = avg;
                bestType = t;
            }
        });

        // Avg ROAS
        var totalRoas = 0;
        var roasCount = 0;
        creatives.forEach(function(c) {
            if (c.roas && c.roas > 0) {
                totalRoas += c.roas;
                roasCount++;
            }
        });
        var avgRoas = roasCount > 0 ? totalRoas / roasCount : 0;

        // Top campaign
        var campRoas = {};
        var campCounts = {};
        creatives.forEach(function(c) {
            var cn = c.campaign_name || 'Unknown';
            if (!campRoas[cn]) { campRoas[cn] = 0; campCounts[cn] = 0; }
            campRoas[cn] += (c.roas || 0);
            campCounts[cn]++;
        });
        var topCamp = '--';
        var topCampRoas = 0;
        Object.keys(campRoas).forEach(function(cn) {
            var avg = campCounts[cn] > 0 ? campRoas[cn] / campCounts[cn] : 0;
            if (avg > topCampRoas) {
                topCampRoas = avg;
                topCamp = cn;
            }
        });

        el.innerHTML = '' +
            '<div class="gc-kpi-card">' +
                '<div class="gc-kpi-value" style="color:#6c5ce7;">' + total + '</div>' +
                '<div class="gc-kpi-label">Total Creatives</div>' +
                '<div class="gc-kpi-sub">' + Object.keys(typeCounts).map(function(t) { return t + ': ' + typeCounts[t]; }).join(' | ') + '</div>' +
            '</div>' +
            '<div class="gc-kpi-card">' +
                '<div class="gc-kpi-value" style="color:#00d4aa;">' + GC.esc(bestType) + '</div>' +
                '<div class="gc-kpi-label">Best Ad Type</div>' +
                '<div class="gc-kpi-sub">Avg ROAS: ' + GC.fmtPct(bestTypeRoas) + '</div>' +
            '</div>' +
            '<div class="gc-kpi-card">' +
                '<div class="gc-kpi-value" style="color:' + GC.roasColor(avgRoas) + ';">' + GC.fmtPct(avgRoas) + '</div>' +
                '<div class="gc-kpi-label">Avg ROAS (90d)</div>' +
                '<div class="gc-kpi-sub">' + roasCount + ' creatives with data</div>' +
            '</div>' +
            '<div class="gc-kpi-card">' +
                '<div class="gc-kpi-value" style="color:var(--text);font-size:16px;">' + GC.esc(GC.shortName(topCamp, 22)) + '</div>' +
                '<div class="gc-kpi-label">Top Campaign</div>' +
                '<div class="gc-kpi-sub">ROAS: ' + GC.fmtPct(topCampRoas) + '</div>' +
            '</div>';
    }

    // ---- Cards Rendering ----

    function getFilteredCreatives() {
        if (!_data || !_data.creatives) return [];
        return _data.creatives.filter(function(c) {
            if (_filterType !== 'all' && (c.ad_type || '').toUpperCase() !== _filterType.toUpperCase()) return false;
            if (_filterPerf !== 'all' && (c.performance_label || '').toUpperCase() !== _filterPerf.toUpperCase()) return false;
            return true;
        });
    }

    function renderCards() {
        var el = document.getElementById('gcIntCards');
        if (!el) return;

        var items = getFilteredCreatives();

        if (items.length === 0) {
            el.innerHTML = '<div class="gc-empty">' +
                '<div class="gc-empty-icon">&#128269;</div>' +
                '<div class="gc-empty-text">No creatives match the current filters</div>' +
            '</div>';
            return;
        }

        // Sort by ROAS descending
        items.sort(function(a, b) { return (b.roas || 0) - (a.roas || 0); });

        var html = '';
        items.forEach(function(c) {
            var typeBadge = '<span class="gc-badge ' + GC.typeBadgeClass(c.ad_type) + '">' + GC.esc(c.ad_type || 'Unknown') + '</span>';
            var perfBadge = c.performance_label ?
                '<span class="gc-badge ' + GC.perfBadgeClass(c.performance_label) + '">' + GC.esc(c.performance_label) + '</span>' : '';

            var preview = '';
            var adType = (c.ad_type || '').toUpperCase();
            if (adType === 'VIDEO' && c.thumbnail_url) {
                preview = '<img class="gc-thumbnail" src="' + GC.esc(c.thumbnail_url) + '" alt="Video thumbnail" onerror="this.style.display=\'none\'">';
            } else if (adType === 'VIDEO') {
                preview = '<div class="gc-thumbnail-placeholder">&#9654;</div>';
            } else if (adType === 'RSA' || adType === 'RESPONSIVE SEARCH') {
                var headlines = c.headlines || [];
                if (headlines.length > 0) {
                    preview = '<div style="margin-bottom:10px;">';
                    headlines.slice(0, 3).forEach(function(h) {
                        preview += '<div style="font-size:12px;color:var(--text);padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);">' + GC.esc(h) + '</div>';
                    });
                    if (headlines.length > 3) {
                        preview += '<div style="font-size:11px;color:var(--text-dim);padding-top:3px;">+' + (headlines.length - 3) + ' more headlines</div>';
                    }
                    preview += '</div>';
                }
            }

            html += '<div class="gc-creative-card">' +
                '<div class="gc-card-header">' +
                    '<div style="display:flex;gap:6px;align-items:center;">' + typeBadge + perfBadge + '</div>' +
                '</div>' +
                preview +
                '<div class="gc-card-headline">' + GC.esc(GC.shortName(c.ad_name || c.headline || 'Untitled', 60)) + '</div>' +
                '<div class="gc-card-metrics">' +
                    metricCell('ROAS', GC.fmtPct(c.roas), GC.roasColor(c.roas)) +
                    metricCell('G-CPS', c.g_cps != null ? c.g_cps.toFixed(1) : '--', '#6c5ce7') +
                    metricCell('Spend', GC.fmtINR(c.spend), 'var(--text)') +
                    metricCell('Conversions', c.conversions != null ? c.conversions : '--', '#00d4aa') +
                '</div>' +
                '<div class="gc-card-campaign" title="' + GC.esc(c.campaign_name) + '">&#128204; ' + GC.esc(GC.shortName(c.campaign_name, 50)) + '</div>' +
            '</div>';
        });

        el.innerHTML = html;
    }

    function metricCell(label, value, color) {
        return '<div class="gc-card-metric">' +
            '<div class="gc-card-metric-val" style="color:' + color + ';">' + value + '</div>' +
            '<div class="gc-card-metric-label">' + label + '</div>' +
        '</div>';
    }

    // ---- Charts ----

    function renderCharts() {
        if (!_data || !_data.creatives) return;
        renderRoasByTypeChart();
        renderPerfDistChart();
        renderRoasTrendChart();
    }

    function renderRoasByTypeChart() {
        var canvas = document.getElementById('gcChartRoasByType');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.parentElement.getBoundingClientRect();
        var w = rect.width - 40;
        var h = 200;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        var creatives = _data.creatives || [];
        var types = {};
        var counts = {};
        creatives.forEach(function(c) {
            var t = c.ad_type || 'Unknown';
            if (!types[t]) { types[t] = 0; counts[t] = 0; }
            types[t] += (c.roas || 0);
            counts[t]++;
        });

        var labels = Object.keys(types);
        var values = labels.map(function(t) { return counts[t] > 0 ? types[t] / counts[t] : 0; });
        var maxVal = Math.max.apply(null, values.concat([1]));

        var colors = { RSA: '#6c5ce7', Video: '#ec4899', PMax: '#00d4aa', Display: '#f59e0b', Unknown: '#71717a' };
        var barW = Math.min(60, (w - 80) / labels.length - 10);
        var chartLeft = 50;
        var chartBottom = h - 30;
        var chartHeight = chartBottom - 20;

        // Y axis
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.fillStyle = '#71717a';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        for (var i = 0; i <= 4; i++) {
            var yVal = (maxVal / 4) * i;
            var y = chartBottom - (chartHeight * (i / 4));
            ctx.beginPath();
            ctx.moveTo(chartLeft, y);
            ctx.lineTo(w - 10, y);
            ctx.stroke();
            ctx.fillText(yVal.toFixed(1) + '%', chartLeft - 6, y + 3);
        }

        // Bars
        var totalBarArea = w - chartLeft - 20;
        var gap = totalBarArea / labels.length;
        labels.forEach(function(label, idx) {
            var x = chartLeft + gap * idx + (gap - barW) / 2;
            var barH = maxVal > 0 ? (values[idx] / maxVal) * chartHeight : 0;
            var y = chartBottom - barH;

            ctx.fillStyle = colors[label] || '#71717a';
            ctx.beginPath();
            roundedRect(ctx, x, y, barW, barH, 4);
            ctx.fill();

            // Label
            ctx.fillStyle = '#71717a';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(label, x + barW / 2, chartBottom + 14);

            // Value on top
            ctx.fillStyle = colors[label] || '#71717a';
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.fillText(values[idx].toFixed(1) + '%', x + barW / 2, y - 6);
        });
    }

    function renderPerfDistChart() {
        var canvas = document.getElementById('gcChartPerfDist');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.parentElement.getBoundingClientRect();
        var w = rect.width - 40;
        var h = 200;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        var creatives = _data.creatives || [];
        var dist = { BEST: 0, GOOD: 0, LOW: 0, LEARNING: 0 };
        creatives.forEach(function(c) {
            var label = (c.performance_label || 'LEARNING').toUpperCase();
            if (dist[label] !== undefined) dist[label]++;
            else dist.LEARNING++;
        });

        var slices = [
            { label: 'Best', value: dist.BEST, color: '#00d4aa' },
            { label: 'Good', value: dist.GOOD, color: '#6c5ce7' },
            { label: 'Low', value: dist.LOW, color: '#ef4444' },
            { label: 'Learning', value: dist.LEARNING, color: '#f59e0b' }
        ];

        var total = slices.reduce(function(s, sl) { return s + sl.value; }, 0);
        if (total === 0) {
            ctx.fillStyle = '#71717a';
            ctx.font = '13px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data', w / 2, h / 2);
            return;
        }

        var cx = w * 0.35;
        var cy = h / 2;
        var r = Math.min(cx - 20, cy - 10, 75);
        var innerR = r * 0.55;
        var startAngle = -Math.PI / 2;

        slices.forEach(function(sl) {
            if (sl.value === 0) return;
            var sliceAngle = (sl.value / total) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx + innerR * Math.cos(startAngle), cy + innerR * Math.sin(startAngle));
            ctx.arc(cx, cy, r, startAngle, startAngle + sliceAngle);
            ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = sl.color;
            ctx.fill();
            startAngle += sliceAngle;
        });

        // Center text
        ctx.fillStyle = 'var(--text, #e4e4e7)';
        ctx.font = 'bold 22px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(total), cx, cy - 6);
        ctx.fillStyle = '#71717a';
        ctx.font = '10px Inter, sans-serif';
        ctx.fillText('Total', cx, cy + 12);

        // Legend
        var legendX = w * 0.65;
        var legendY = h / 2 - (slices.length * 24) / 2;
        slices.forEach(function(sl, i) {
            var ly = legendY + i * 24;
            ctx.fillStyle = sl.color;
            ctx.beginPath();
            ctx.arc(legendX, ly + 6, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#e4e4e7';
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(sl.label + ' (' + sl.value + ')', legendX + 14, ly + 10);
        });
    }

    function renderRoasTrendChart() {
        var canvas = document.getElementById('gcChartRoasTrend');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.parentElement.getBoundingClientRect();
        var w = rect.width - 40;
        var h = 200;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        var trend = (_data && _data.roas_trend) || [];
        if (trend.length === 0) {
            ctx.fillStyle = '#71717a';
            ctx.font = '13px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No trend data available', w / 2, h / 2);
            return;
        }

        var values = trend.map(function(p) { return p.roas || 0; });
        var dates = trend.map(function(p) { return p.date || ''; });
        var maxVal = Math.max.apply(null, values.concat([1]));
        var minVal = Math.min.apply(null, values.concat([0]));
        var range = maxVal - minVal || 1;

        var chartLeft = 50;
        var chartRight = w - 20;
        var chartTop = 20;
        var chartBottom = h - 30;
        var chartWidth = chartRight - chartLeft;
        var chartHeight = chartBottom - chartTop;

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.fillStyle = '#71717a';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        for (var g = 0; g <= 4; g++) {
            var gVal = minVal + (range / 4) * g;
            var gy = chartBottom - (chartHeight * (g / 4));
            ctx.beginPath();
            ctx.moveTo(chartLeft, gy);
            ctx.lineTo(chartRight, gy);
            ctx.stroke();
            ctx.fillText(gVal.toFixed(1) + '%', chartLeft - 6, gy + 3);
        }

        // X axis labels (show ~6 labels)
        ctx.textAlign = 'center';
        var labelInterval = Math.max(1, Math.floor(dates.length / 6));
        for (var li = 0; li < dates.length; li += labelInterval) {
            var lx = chartLeft + (li / (dates.length - 1 || 1)) * chartWidth;
            var dateStr = dates[li];
            if (dateStr.length >= 10) dateStr = dateStr.substring(5, 10); // MM-DD
            ctx.fillText(dateStr, lx, chartBottom + 14);
        }

        // Line
        ctx.beginPath();
        ctx.strokeStyle = '#6c5ce7';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        values.forEach(function(v, i) {
            var x = chartLeft + (i / (values.length - 1 || 1)) * chartWidth;
            var y = chartBottom - ((v - minVal) / range) * chartHeight;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Area fill
        ctx.lineTo(chartLeft + chartWidth, chartBottom);
        ctx.lineTo(chartLeft, chartBottom);
        ctx.closePath();
        var gradient = ctx.createLinearGradient(0, chartTop, 0, chartBottom);
        gradient.addColorStop(0, 'rgba(108, 92, 231, 0.15)');
        gradient.addColorStop(1, 'rgba(108, 92, 231, 0)');
        ctx.fillStyle = gradient;
        ctx.fill();

        // Dots on last point
        if (values.length > 0) {
            var lastIdx = values.length - 1;
            var lastX = chartLeft + (lastIdx / (values.length - 1 || 1)) * chartWidth;
            var lastY = chartBottom - ((values[lastIdx] - minVal) / range) * chartHeight;
            ctx.beginPath();
            ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#6c5ce7';
            ctx.fill();
            ctx.fillStyle = '#e4e4e7';
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(values[lastIdx].toFixed(1) + '%', lastX, lastY - 10);
        }
    }

    function roundedRect(ctx, x, y, w, h, r) {
        if (h < r * 2) r = h / 2;
        if (w < r * 2) r = w / 2;
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h);
        ctx.lineTo(x, y + h);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
    }

    // ---- Learning Report ----

    function renderLearning() {
        var el = document.getElementById('gcIntLearning');
        if (!el) return;

        var items = _learningData;
        if (!items || !Array.isArray(items) || items.length === 0) {
            // If learningData is an object with items property
            if (_learningData && _learningData.items) items = _learningData.items;
            else if (_learningData && _learningData.learnings) items = _learningData.learnings;
            else { renderLearningEmpty(); return; }
        }

        var html = '';
        items.forEach(function(item) {
            var icon = '&#128161;';
            var iconBg = 'rgba(108, 92, 231, 0.1)';
            var type = (item.type || '').toLowerCase();
            if (type === 'warning' || type === 'alert') { icon = '&#9888;'; iconBg = 'rgba(245, 158, 11, 0.1)'; }
            else if (type === 'success' || type === 'win') { icon = '&#9989;'; iconBg = 'rgba(0, 212, 170, 0.1)'; }
            else if (type === 'danger' || type === 'risk') { icon = '&#9888;'; iconBg = 'rgba(239, 68, 68, 0.1)'; }

            html += '<div class="gc-learning-item">' +
                '<div class="gc-learning-icon" style="background:' + iconBg + ';">' + icon + '</div>' +
                '<div class="gc-learning-text">' +
                    '<h5>' + GC.esc(item.title || item.heading || 'Insight') + '</h5>' +
                    '<p>' + GC.esc(item.description || item.text || item.body || '') + '</p>' +
                '</div>' +
            '</div>';
        });

        el.innerHTML = html;
    }

    function renderLearningEmpty() {
        var el = document.getElementById('gcIntLearning');
        if (!el) return;
        el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:13px;">' +
            'No learning report data available yet. Data will appear once enough Google Ads creatives are analyzed.' +
        '</div>';
    }

})();
