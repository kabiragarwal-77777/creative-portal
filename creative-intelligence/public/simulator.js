(function() {
    'use strict';

    var _dashboardData = null;
    var _expandedAdId = null;
    var _trendlineCache = {};
    var _refreshInterval = null;
    var _lastRefreshRequestAt = 0;

    var CHECKPOINT_META = {
        P0: { color: '#8b5cf6', label: 'P0', checkpointLabel: 'Day 0' },
        P2: { color: '#3b82f6', label: 'P2', checkpointLabel: 'Day 2' },
        P8: { color: '#f59e0b', label: 'P8', checkpointLabel: 'Day 8' },
        P14: { color: '#ef4444', label: 'P14', checkpointLabel: 'Day 14' },
        Actual: { color: '#10b981', label: 'Actual' }
    };

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function fmtINR(val) {
        if (val == null) return '-';
        if (typeof formatINR === 'function') return formatINR(val);
        if (val >= 100000) return '\u20B9' + (val / 100000).toFixed(1) + 'L';
        if (val >= 1000) return '\u20B9' + (val / 1000).toFixed(1) + 'K';
        return '\u20B9' + Math.round(val);
    }

    function fmtRoas(val) {
        if (val == null) return '-';
        return Number(val).toFixed(1) + '%';
    }

    function fmtAccuracy(val) {
        if (val == null) return '-';
        return Number(val).toFixed(1) + '%';
    }

    function accuracyCardValue(val, verifiedCount) {
        if (val == null) {
            return verifiedCount > 0 ? 'Pending' : 'No data';
        }
        return fmtAccuracy(val);
    }

    function fmtDate(val) {
        if (!val) return '-';
        return val;
    }

    function roasColor(val) {
        if (val == null) return 'var(--text-dim)';
        var num = Number(val);
        if (num >= 25) return 'var(--green, #10b981)';
        if (num >= 10) return 'var(--orange, #f59e0b)';
        if (num > 0) return 'var(--red, #ef4444)';
        return 'var(--text-dim)';
    }

    function shortName(name) {
        if (!name) return '';
        return name.length > 52 ? name.slice(0, 49) + '...' : name;
    }

    function checkpointCell(checkpoint, daysLive) {
        var meta = CHECKPOINT_META[checkpoint.code] || CHECKPOINT_META.P0;
        if (checkpoint.exists) {
            return '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">' +
                '<span style="display:inline-block;padding:4px 8px;border-radius:999px;background:' + meta.color + ';color:#fff;font-size:10px;font-weight:700;">' + meta.label + '</span>' +
                '<span style="font-size:9px;color:var(--text-dim);">' + fmtDate(checkpoint.created_snapshot_date) + '</span>' +
            '</div>';
        }
        if ((daysLive || 0) >= checkpoint.day) {
            return '<span style="font-size:10px;color:var(--text-dim);">Queued</span>';
        }
        return '<span style="font-size:10px;color:var(--text-dim);">D' + checkpoint.day + '</span>';
    }

    function init() {
        var container = document.getElementById('simulatorView');
        if (!container) return;

        container.innerHTML = buildHTML();
        bindEvents();
        fetchDashboard();
        _refreshInterval = setInterval(fetchDashboard, 5 * 60 * 1000);
    }

    function buildHTML() {
        return '' +
            '<div class="ci-panel">' +
                '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px;flex-wrap:wrap;">' +
                    '<div>' +
                        '<h2 style="margin-bottom:4px;">ROAS Simulator</h2>' +
                        '<p style="font-size:13px;color:var(--text-dim);max-width:760px;">Actual portal ROAS vs frozen checkpoint forecasts for immature ad cohorts. P0, P2, P8, and P14 now start from the exact achieved ROAS at that checkpoint day, then forecast only the remaining path to D6, D15, D30, D60, and D180.</p>' +
                    '</div>' +
                    '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                        '<button id="rtRefreshBtn" class="btn-ci-primary" style="font-size:12px;padding:8px 16px;">Refresh View</button>' +
                        '<button id="rtSnapshotBtn" class="btn-ci-primary" style="font-size:12px;padding:8px 16px;background:var(--green, #10b981);border-color:var(--green, #10b981);">Run Live Refresh</button>' +
                    '</div>' +
                '</div>' +

                '<div style="padding:14px 16px;border:1px solid var(--border);border-radius:12px;background:rgba(99,102,241,0.08);margin-bottom:18px;">' +
                    '<div style="font-size:12px;font-weight:700;color:var(--accent, #6366f1);margin-bottom:6px;">Forecast contract</div>' +
                    '<div style="font-size:12px;color:var(--text-dim);line-height:1.6;">Actuals reuse the current portal snapshot logic. Each checkpoint line shows the achieved ROAS on that day as the anchor. Any horizon that had already passed when the checkpoint was created is shown as locked actual, and later horizons remain frozen forecasts. Accuracy is measured against the latest mature actuals at D6, D15, D30, D60, and D180.</div>' +
                '</div>' +

                '<div id="rtStats" style="margin-bottom:20px;"></div>' +
                '<div id="rtProgress" style="display:none;margin-bottom:16px;"></div>' +
                '<div id="rtFlash" style="display:none;margin-bottom:16px;"></div>' +
                '<div id="rtTable"></div>' +
            '</div>' +
            '<style>' +
                '.sim-row:hover { background: rgba(99,102,241,0.04) !important; }' +
                '.sim-chip { display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:4px 8px;font-size:10px;font-weight:700; }' +
            '</style>';
    }

    function bindEvents() {
        var refreshBtn = document.getElementById('rtRefreshBtn');
        var snapshotBtn = document.getElementById('rtSnapshotBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', fetchDashboard);
        if (snapshotBtn) snapshotBtn.addEventListener('click', function() { runRefresh(true); });
    }

    function fetchDashboard() {
        fetch('/creative-portal/api/ci2/roas-simulator/dashboard')
            .then(function(res) { return res.json(); })
            .then(function(result) {
                if (!result.success || !result.data) return;
                _dashboardData = result.data;
                renderStats(result.data.summary);
                renderTable(result.data.ads || []);
            })
            .catch(function(err) {
                showFlash('Simulator fetch failed: ' + err.message, 'var(--red, #ef4444)');
            });

        if (Date.now() - _lastRefreshRequestAt > 15 * 60 * 1000) {
            runRefresh(false);
        }
    }

    function runRefresh(manual) {
        _lastRefreshRequestAt = Date.now();

        var progress = document.getElementById('rtProgress');
        var snapshotBtn = document.getElementById('rtSnapshotBtn');
        if (progress) {
            progress.style.display = '';
            progress.innerHTML = '<div style="padding:12px 16px;border:1px solid var(--border);border-radius:10px;background:var(--bg-card);font-size:12px;color:var(--text-dim);">Refreshing Meta + Metabase snapshots and checkpoint forecasts...</div>';
        }
        if (manual && snapshotBtn) snapshotBtn.disabled = true;

        fetch('/creative-portal/api/ci2/roas-simulator/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        })
            .then(function(res) { return res.json(); })
            .then(function(result) {
                if (progress) progress.style.display = 'none';
                if (manual && snapshotBtn) snapshotBtn.disabled = false;

                if (!result.success) {
                    showFlash('Refresh failed: ' + (result.error || 'Unknown error'), 'var(--red, #ef4444)');
                    return;
                }

                if (manual) {
                    var snap = result.data && result.data.snapshots ? result.data.snapshots : {};
                    var checkpoints = result.data && result.data.checkpoints ? result.data.checkpoints : {};
                    showFlash('Refresh complete: ' + (snap.tracked || 0) + ' ads tracked, ' + (checkpoints.created || 0) + ' checkpoint lines created.', 'var(--green, #10b981)');
                }
                fetchDashboard();
            })
            .catch(function(err) {
                if (progress) progress.style.display = 'none';
                if (manual && snapshotBtn) snapshotBtn.disabled = false;
                if (manual) showFlash('Refresh failed: ' + err.message, 'var(--red, #ef4444)');
            });
    }

    function showFlash(msg, color) {
        var el = document.getElementById('rtFlash');
        if (!el) return;
        el.style.display = '';
        el.innerHTML = '<div style="padding:12px 16px;border:1px solid ' + color + ';border-radius:10px;background:var(--bg-card);color:' + color + ';font-size:12px;font-weight:700;">' + escapeHtml(msg) + '</div>';
        setTimeout(function() { el.style.display = 'none'; }, 8000);
    }

    function renderStats(summary) {
        var el = document.getElementById('rtStats');
        if (!el || !summary) return;

        var cards = [
            { value: summary.total_ads || 0, label: 'Immature Ads', color: 'var(--accent, #6366f1)' },
            { value: summary.with_spend || 0, label: 'Spend Started', color: 'var(--green, #10b981)' },
            { value: summary.checkpoint_p0 || 0, label: 'P0 Frozen', color: CHECKPOINT_META.P0.color },
            { value: summary.checkpoint_p2 || 0, label: 'P2 Frozen', color: CHECKPOINT_META.P2.color },
            { value: summary.checkpoint_p8 || 0, label: 'P8 Frozen', color: CHECKPOINT_META.P8.color },
            { value: summary.checkpoint_p14 || 0, label: 'P14 Frozen', color: CHECKPOINT_META.P14.color }
        ];
        var accuracyCards = [
            { value: accuracyCardValue(summary.avg_accuracy_p0, summary.verified_accuracy_p0), label: 'P0 Accuracy', sublabel: (summary.verified_accuracy_p0 || 0) + ' verified', color: CHECKPOINT_META.P0.color },
            { value: accuracyCardValue(summary.avg_accuracy_p2, summary.verified_accuracy_p2), label: 'P2 Accuracy', sublabel: (summary.verified_accuracy_p2 || 0) + ' verified', color: CHECKPOINT_META.P2.color },
            { value: accuracyCardValue(summary.avg_accuracy_p8, summary.verified_accuracy_p8), label: 'P8 Accuracy', sublabel: (summary.verified_accuracy_p8 || 0) + ' verified', color: CHECKPOINT_META.P8.color },
            { value: accuracyCardValue(summary.avg_accuracy_p14, summary.verified_accuracy_p14), label: 'P14 Accuracy', sublabel: (summary.verified_accuracy_p14 || 0) + ' verified', color: CHECKPOINT_META.P14.color }
        ];

        el.innerHTML = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">' +
            cards.map(function(card) {
                return '<div style="flex:1;min-width:120px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px;text-align:center;">' +
                    '<div style="font-size:24px;font-weight:700;color:' + card.color + ';">' + card.value + '</div>' +
                    '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + card.label + '</div>' +
                '</div>';
            }).join('') +
        '</div>' +
        '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            accuracyCards.map(function(card) {
                return '<div style="flex:1;min-width:140px;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px;text-align:center;">' +
                    '<div style="font-size:22px;font-weight:700;color:' + card.color + ';">' + card.value + '</div>' +
                    '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' + card.label + '</div>' +
                    '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + card.sublabel + '</div>' +
                '</div>';
            }).join('') +
        '</div>';
    }

    function renderTable(ads) {
        var container = document.getElementById('rtTable');
        if (!container) return;

        if (!ads || !ads.length) {
            container.innerHTML = '<div class="ci-empty" style="padding:40px;text-align:center;color:var(--text-dim);font-size:14px;">No simulator cohorts found yet. Run a live refresh to backfill checkpoints.</div>';
            return;
        }

        var html = '<div style="overflow-x:auto;">' +
            '<table style="width:100%;border-collapse:collapse;font-size:12px;">' +
            '<thead><tr style="border-bottom:2px solid var(--border);">' +
                th('Creative', 'left', '220px') +
                th('Status', 'center', '70px') +
                th('Days', 'center', '48px') +
                th('Spend', 'right', '80px') +
                th('Actual Now', 'right', '84px') +
                th('D6', 'right', '64px') +
                th('D15', 'right', '64px') +
                th('D30', 'right', '64px') +
                th('D60', 'right', '64px') +
                th('D180', 'right', '72px') +
                th('P0', 'center', '60px') +
                th('P2', 'center', '60px') +
                th('P8', 'center', '60px') +
                th('P14', 'center', '64px') +
            '</tr></thead><tbody>';

        ads.forEach(function(ad) {
            var isExpanded = _expandedAdId === ad.ad_id;
            var status = ad.meta_status === 'ACTIVE'
                ? '<span style="color:#10b981;font-weight:700;">LIVE</span>'
                : '<span style="color:var(--text-dim);font-weight:700;">' + escapeHtml((ad.meta_status || 'UNKNOWN').replace(/_/g, ' ')) + '</span>';

            html += '<tr class="sim-row" style="border-bottom:1px solid var(--border);cursor:pointer;" data-ad-id="' + escapeHtml(ad.ad_id) + '">' +
                '<td style="padding:10px 8px;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + escapeHtml(ad.ad_name) + '">' + escapeHtml(shortName(ad.ad_name)) + '</td>' +
                '<td style="text-align:center;padding:10px 8px;">' + status + '</td>' +
                '<td style="text-align:center;padding:10px 8px;color:var(--text-dim);">' + escapeHtml(String(ad.days_live || 0)) + '</td>' +
                '<td style="text-align:right;padding:10px 8px;">' + fmtINR(ad.spend) + '</td>' +
                '<td style="text-align:right;padding:10px 8px;color:' + roasColor(ad.actual_anchor_roas) + ';font-weight:700;">' + fmtRoas(ad.actual_anchor_roas) + '</td>' +
                '<td style="text-align:right;padding:10px 8px;color:' + roasColor(ad.actual_d6_roas) + ';">' + fmtRoas(ad.actual_d6_roas) + '</td>' +
                '<td style="text-align:right;padding:10px 8px;color:' + roasColor(ad.actual_d15_roas) + ';">' + fmtRoas(ad.actual_d15_roas) + '</td>' +
                '<td style="text-align:right;padding:10px 8px;color:' + roasColor(ad.actual_d30_roas) + ';">' + fmtRoas(ad.actual_d30_roas) + '</td>' +
                '<td style="text-align:right;padding:10px 8px;color:' + roasColor(ad.actual_d60_roas) + ';">' + fmtRoas(ad.actual_d60_roas) + '</td>' +
                '<td style="text-align:right;padding:10px 8px;color:' + roasColor(ad.actual_d180_roas) + ';">' + fmtRoas(ad.actual_d180_roas) + '</td>' +
                '<td style="text-align:center;padding:10px 4px;">' + checkpointCell(ad.checkpoints[0], ad.days_live) + '</td>' +
                '<td style="text-align:center;padding:10px 4px;">' + checkpointCell(ad.checkpoints[1], ad.days_live) + '</td>' +
                '<td style="text-align:center;padding:10px 4px;">' + checkpointCell(ad.checkpoints[2], ad.days_live) + '</td>' +
                '<td style="text-align:center;padding:10px 4px;">' + checkpointCell(ad.checkpoints[3], ad.days_live) + '</td>' +
            '</tr>';

            html += '<tr id="rt-trendline-' + escapeHtml(ad.ad_id) + '" style="display:' + (isExpanded ? 'table-row' : 'none') + ';">' +
                '<td colspan="14" style="padding:0 8px 18px 8px;">' +
                    '<div id="rt-chart-' + escapeHtml(ad.ad_id) + '" style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:18px;margin-top:6px;">' +
                        (isExpanded ? '' : '<div style="font-size:12px;color:var(--text-dim);">Loading simulator line chart...</div>') +
                    '</div>' +
                '</td>' +
            '</tr>';
        });

        html += '</tbody></table></div>';
        html += '<p style="font-size:11px;color:var(--text-dim);margin-top:10px;">Click a row to compare the live actual curve with frozen P0, P2, P8, and P14 forecasts. The table only shows cohorts in the immature simulator range.</p>';

        container.innerHTML = html;

        var rows = container.querySelectorAll('.sim-row');
        rows.forEach(function(row) {
            row.addEventListener('click', function() {
                toggleTrendline(row.getAttribute('data-ad-id'));
            });
        });
    }

    function th(label, align, width) {
        return '<th style="text-align:' + align + ';padding:10px 8px;color:var(--text-dim);font-size:11px;font-weight:700;width:' + width + ';">' + label + '</th>';
    }

    function toggleTrendline(adId) {
        var trendlineRow = document.getElementById('rt-trendline-' + adId);
        if (!trendlineRow) return;

        if (_expandedAdId === adId) {
            trendlineRow.style.display = 'none';
            _expandedAdId = null;
            return;
        }

        if (_expandedAdId) {
            var prev = document.getElementById('rt-trendline-' + _expandedAdId);
            if (prev) prev.style.display = 'none';
        }

        _expandedAdId = adId;
        trendlineRow.style.display = 'table-row';

        var chartContainer = document.getElementById('rt-chart-' + adId);
        if (!chartContainer) return;

        if (_trendlineCache[adId]) {
            renderTrendline(chartContainer, _trendlineCache[adId]);
            return;
        }

        chartContainer.innerHTML = '<div style="font-size:12px;color:var(--text-dim);">Loading simulator line chart...</div>';

        fetch('/creative-portal/api/ci2/roas-simulator/trendline/' + encodeURIComponent(adId))
            .then(function(res) { return res.json(); })
            .then(function(result) {
                if (!result.success || !result.data) {
                    chartContainer.innerHTML = '<div style="font-size:12px;color:var(--red);">Failed to load simulator details.</div>';
                    return;
                }
                _trendlineCache[adId] = result.data;
                renderTrendline(chartContainer, result.data);
            })
            .catch(function(err) {
                chartContainer.innerHTML = '<div style="font-size:12px;color:var(--red);">Error: ' + escapeHtml(err.message) + '</div>';
            });
    }

    function buildLineSeries(data) {
        var lines = [];

        lines.push({
            key: 'Actual',
            label: 'Actual',
            color: CHECKPOINT_META.Actual.color,
            dash: '',
            points: (data.actualLine || []).map(function(point) {
                return {
                    horizon: point.horizon,
                    day: point.day,
                    value: point.value,
                    pointType: 'actual',
                    title: 'Actual ' + point.horizon + ': ' + fmtRoas(point.value) + (point.snapshot_date ? ' (' + point.snapshot_date + ')' : '')
                };
            })
        });

        (data.checkpoints || []).forEach(function(run) {
            var meta = CHECKPOINT_META[run.checkpoint_code] || CHECKPOINT_META.P0;
            lines.push({
                key: run.checkpoint_code,
                label: run.checkpoint_code,
                color: meta.color,
                dash: '8,5',
                checkpoint: run,
                points: (run.points || []).map(function(point) {
                    var title = run.checkpoint_code + ' ' + point.horizon + ': ' + fmtRoas(point.value) +
                        ' (' + (
                            point.pointType === 'locked_actual'
                                ? 'locked actual'
                                : point.pointType === 'checkpoint_anchor'
                                    ? 'actual checkpoint anchor'
                                    : 'forecast'
                        ) + ')';
                    return {
                        horizon: point.horizon,
                        day: point.day,
                        value: point.value,
                        low: point.low,
                        high: point.high,
                        pointType: point.pointType,
                        title: title
                    };
                })
            });
        });

        return lines;
    }

    function renderTrendline(container, data) {
        var lines = buildLineSeries(data);
        var W = 760;
        var H = 320;
        var PAD_L = 54;
        var PAD_R = 24;
        var PAD_T = 24;
        var PAD_B = 44;
        var chartW = W - PAD_L - PAD_R;
        var chartH = H - PAD_T - PAD_B;
        var horizonCount = (data.horizons || []).length || 5;
        var horizonDayIndex = {};
        (data.horizons || []).forEach(function(horizon, idx) {
            horizonDayIndex[horizon.day] = idx;
        });

        var allValues = [];
        lines.forEach(function(line) {
            (line.points || []).forEach(function(point) {
                if (point.value != null) allValues.push(Number(point.value));
                if (point.high != null) allValues.push(Number(point.high));
            });
        });
        var maxY = allValues.length ? Math.max.apply(Math, allValues) : 5;
        maxY = Math.max(5, Math.ceil(maxY * 1.2));

        function xPos(day) {
            var numericDay = Number(day) || 0;
            if (horizonDayIndex[numericDay] != null) {
                return PAD_L + ((horizonDayIndex[numericDay] + 0.5) / horizonCount) * chartW;
            }

            var prior = null;
            var next = null;
            (data.horizons || []).forEach(function(horizon) {
                if (horizon.day <= numericDay) prior = horizon;
                if (!next && horizon.day >= numericDay) next = horizon;
            });

            if (!prior && next) {
                return PAD_L + ((0.15) / horizonCount) * chartW;
            }
            if (prior && !next) {
                return PAD_L + (((horizonCount - 1) + 0.5) / horizonCount) * chartW;
            }
            if (!prior || !next || prior.day === next.day) {
                return PAD_L + ((0.5) / horizonCount) * chartW;
            }

            var priorIdx = horizonDayIndex[prior.day];
            var nextIdx = horizonDayIndex[next.day];
            var ratio = (numericDay - prior.day) / (next.day - prior.day);
            var slot = (priorIdx + 0.5) + ((nextIdx - priorIdx) * ratio);
            return PAD_L + (slot / horizonCount) * chartW;
        }

        function yPos(value) {
            return PAD_T + chartH - (Number(value) / maxY) * chartH;
        }

        var svg = '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" style="font-family:Inter,sans-serif;">';

        for (var g = 0; g <= 4; g++) {
            var gy = PAD_T + (g / 4) * chartH;
            var gv = Math.round(maxY * (1 - g / 4));
            svg += '<line x1="' + PAD_L + '" y1="' + gy + '" x2="' + (W - PAD_R) + '" y2="' + gy + '" stroke="var(--border, #333)" stroke-width="0.5" opacity="0.45" />';
            svg += '<text x="' + (PAD_L - 8) + '" y="' + (gy + 4) + '" text-anchor="end" fill="var(--text-dim, #888)" font-size="10">' + gv + '%</text>';
        }

        svg += '<line x1="' + PAD_L + '" y1="' + (PAD_T + chartH) + '" x2="' + (W - PAD_R) + '" y2="' + (PAD_T + chartH) + '" stroke="var(--border, #444)" stroke-width="1" />';

        (data.horizons || []).forEach(function(horizon) {
            svg += '<line x1="' + xPos(horizon.day) + '" y1="' + (PAD_T + chartH) + '" x2="' + xPos(horizon.day) + '" y2="' + (PAD_T + chartH + 4) + '" stroke="var(--border, #444)" stroke-width="1" />';
            svg += '<text x="' + xPos(horizon.day) + '" y="' + (PAD_T + chartH + 22) + '" text-anchor="middle" fill="var(--text-dim, #aaa)" font-size="11" font-weight="700">' + horizon.label + '</text>';
        });

        lines.forEach(function(line) {
            var plotted = [];
            (line.points || []).forEach(function(point, idx) {
                if (point.value == null) return;
                plotted.push({
                    x: xPos(point.day),
                    y: yPos(point.value),
                    value: point.value,
                    pointType: point.pointType,
                    title: point.title
                });
            });

            if (plotted.length > 1) {
                svg += '<polyline points="' + plotted.map(function(point) { return point.x + ',' + point.y; }).join(' ') + '" fill="none" stroke="' + line.color + '" stroke-width="2.5"' + (line.dash ? ' stroke-dasharray="' + line.dash + '"' : '') + ' />';
            }

            plotted.forEach(function(point) {
                var radius = point.pointType === 'locked_actual' ? 4.5 : point.pointType === 'checkpoint_anchor' ? 5 : 4;
                var fill = point.pointType === 'locked_actual' || point.pointType === 'checkpoint_anchor' ? '#ffffff' : line.color;
                var stroke = point.pointType === 'locked_actual' || point.pointType === 'checkpoint_anchor' ? line.color : '#121212';
                svg += '<circle cx="' + point.x + '" cy="' + point.y + '" r="' + radius + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2">' +
                    '<title>' + escapeHtml(point.title) + '</title></circle>';
            });
        });

        svg += '</svg>';

        var legend = '<div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:11px;">' +
            lines.map(function(line) {
                return '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<span style="display:inline-block;width:20px;height:0;border-top:3px ' + (line.dash ? 'dashed' : 'solid') + ' ' + line.color + ';"></span>' +
                    '<span style="color:' + line.color + ';font-weight:700;">' + line.label + '</span>' +
                '</div>';
            }).join('') +
        '</div>';

        var horizonCards = '<div style="margin-top:18px;">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:8px;">Live actuals by horizon</div>' +
            '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
            (data.horizons || []).map(function(horizon) {
                return '<div style="min-width:96px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;">' +
                    '<div style="font-size:10px;color:var(--text-dim);font-weight:700;">' + horizon.label + '</div>' +
                    '<div style="font-size:18px;font-weight:700;color:' + roasColor(horizon.actual_roas) + ';margin-top:4px;">' + fmtRoas(horizon.actual_roas) + '</div>' +
                    '<div style="font-size:10px;color:var(--text-dim);margin-top:4px;">' + fmtINR(horizon.actual_revenue) + ' rev</div>' +
                    '<div style="font-size:10px;color:' + (horizon.mature ? 'var(--green, #10b981)' : 'var(--orange, #f59e0b)') + ';margin-top:4px;">' + (horizon.mature ? 'Mature' : 'Immature') + '</div>' +
                '</div>';
            }).join('') +
            '</div>' +
        '</div>';

        var checkpointCards = '<div style="margin-top:18px;">' +
            '<div style="font-size:12px;font-weight:700;color:var(--text-dim);margin-bottom:8px;">Frozen checkpoint lines</div>' +
            ((data.checkpoints || []).length ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">' +
                data.checkpoints.map(function(run) {
                    var meta = CHECKPOINT_META[run.checkpoint_code] || CHECKPOINT_META.P0;
                    return '<div style="border:1px solid var(--border);border-top:3px solid ' + meta.color + ';border-radius:12px;padding:12px;background:var(--bg);">' +
                        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">' +
                            '<div style="font-size:14px;font-weight:700;color:' + meta.color + ';">' + run.checkpoint_code + '</div>' +
                            '<div style="font-size:10px;color:var(--text-dim);">Frozen</div>' +
                        '</div>' +
                        '<div style="font-size:11px;color:var(--text-dim);margin-bottom:4px;">Created from ' + meta.checkpointLabel + ' actuals on ' + fmtDate(run.created_snapshot_date) + '</div>' +
                        '<div style="font-size:18px;font-weight:700;color:' + roasColor(run.actual_roas_at_creation) + ';margin-bottom:6px;">' + fmtRoas(run.actual_roas_at_creation) + '</div>' +
                        '<div style="font-size:11px;color:var(--text-dim);line-height:1.6;">' +
                            'Anchor spend: ' + fmtINR(run.spend_at_creation) + '<br>' +
                            'Confidence: ' + (run.confidence_score != null ? Math.round(run.confidence_score) + '%' : '-') + '<br>' +
                            'Method: ' + escapeHtml(run.prediction_method || '-') + '<br>' +
                            'Accuracy now: ' + fmtAccuracy(run.accuracy_summary && run.accuracy_summary.average_accuracy_pct) + ' across ' + ((run.accuracy_summary && run.accuracy_summary.verified_horizons) || 0) + ' mature horizons.' +
                        '</div>' +
                        '<div style="font-size:11px;color:var(--text-dim);line-height:1.6;margin-top:8px;">' + escapeHtml(run.reasoning || 'Fresh forecast from the actual checkpoint base.') + '</div>' +
                    '</div>';
                }).join('') +
            '</div>' : '<div style="font-size:12px;color:var(--text-dim);">No frozen checkpoint lines exist yet for this cohort.</div>') +
        '</div>';

        var header = '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:10px;">' +
            '<div>' +
                '<div style="font-size:15px;font-weight:700;">' + escapeHtml(shortName(data.ad.ad_name)) + '</div>' +
                '<div style="font-size:11px;color:var(--text-dim);margin-top:4px;">' +
                    'Days live: ' + escapeHtml(String(data.ad.days_live || 0)) + ' | Spend: ' + fmtINR(data.ad.spend) + ' | Current actual base: ' + fmtRoas(data.ad.actual_anchor_roas) +
                '</div>' +
            '</div>' +
            '<div style="font-size:11px;color:var(--text-dim);text-align:right;">' +
                'Snapshot: ' + fmtDate(data.ad.latest_snapshot_date) + '<br>' +
                'Spend-driven cohorts only' +
            '</div>' +
        '</div>';

        container.innerHTML = header + svg + legend + horizonCards + checkpointCards;
    }

    window.ciSimulatorInit = init;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
