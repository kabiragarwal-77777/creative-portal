(function() {
    'use strict';

    window.GC = window.GC || {};

    var _currentTab = 'gcDashboard';
    var _loadedTabs = {};

    var ALL_VIEWS = ['gcDashboard', 'gcCampaignTree', 'gcIntelligence', 'gcSimulator', 'gcRecommendations'];

    // ── Utilities ──────────────────────────────────────────────

    window.GC.esc = function(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    };

    window.GC.fmtINR = function(val) {
        if (val == null || isNaN(val)) return '--';
        var v = Number(val);
        if (v >= 10000000) return '\u20B9' + (v / 10000000).toFixed(1) + 'Cr';
        if (v >= 100000)   return '\u20B9' + (v / 100000).toFixed(1) + 'L';
        if (v >= 1000)     return '\u20B9' + (v / 1000).toFixed(1) + 'K';
        return '\u20B9' + Math.round(v);
    };

    window.GC.fmtPct = function(val) {
        if (val == null || isNaN(val)) return '--';
        return Number(val).toFixed(1) + '%';
    };

    window.GC.roasColor = function(val) {
        if (!val || val <= 0) return 'var(--text-dim, #71717a)';
        var v = parseFloat(val);
        if (v > 25) return '#00d4aa';
        if (v >= 10) return 'var(--orange, #f59e0b)';
        return 'var(--red, #ef4444)';
    };

    window.GC.typeBadgeClass = function(adType) {
        if (!adType) return 'gc-badge-rsa';
        var t = adType.toUpperCase();
        if (t === 'RSA' || t === 'RESPONSIVE SEARCH') return 'gc-badge-rsa';
        if (t === 'VIDEO')                             return 'gc-badge-video';
        if (t === 'PMAX' || t === 'PERFORMANCE MAX')   return 'gc-badge-pmax';
        if (t === 'DISPLAY')                           return 'gc-badge-display';
        return 'gc-badge-rsa';
    };

    window.GC.perfBadgeClass = function(label) {
        if (!label) return 'gc-badge-learning';
        var l = label.toUpperCase();
        if (l === 'BEST') return 'gc-badge-best';
        if (l === 'GOOD') return 'gc-badge-good';
        if (l === 'LOW')  return 'gc-badge-low';
        return 'gc-badge-learning';
    };

    window.GC.shortName = function(name, maxLen) {
        maxLen = maxLen || 45;
        if (!name) return '';
        return name.length > maxLen ? name.slice(0, maxLen - 3) + '...' : name;
    };

    // ── Loading overlay ────────────────────────────────────────

    window.GC.showLoading = function(show, text) {
        var overlay = document.getElementById('gcLoadingOverlay');
        if (!overlay) return;
        if (show) {
            overlay.classList.remove('gc-hidden');
            var msgEl = overlay.querySelector('.gc-loading-text, .gc-overlay-text, p');
            if (msgEl && text) msgEl.textContent = text;
        } else {
            overlay.classList.add('gc-hidden');
        }
    };

    // ── Pipeline status / last updated ─────────────────────────

    window.GC.updateLastUpdated = function() {
        fetch('api/gc/pipeline/status')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                var tsEl = document.getElementById('gcLastUpdated');
                var stEl = document.getElementById('gcStatus');
                if (tsEl) {
                    if (data.lastRun) {
                        var d = new Date(data.lastRun);
                        tsEl.textContent = d.toLocaleString('en-IN', {
                            day: 'numeric', month: 'short',
                            hour: '2-digit', minute: '2-digit'
                        });
                    } else {
                        tsEl.textContent = 'Never';
                    }
                }
                if (stEl) {
                    var status = (data.status || 'idle').toLowerCase();
                    stEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
                    stEl.className = '';
                    if (status === 'running')  stEl.classList.add('gc-status-running');
                    else if (status === 'error') stEl.classList.add('gc-status-error');
                    else stEl.classList.add('gc-status-idle');
                }
            })
            .catch(function() {
                var tsEl = document.getElementById('gcLastUpdated');
                if (tsEl) tsEl.textContent = '--';
            });
    };

    // ── Trigger refresh ────────────────────────────────────────

    window.GC.triggerRefresh = function() {
        GC.showLoading(true, 'Refreshing Google Ads data...');
        var stEl = document.getElementById('gcStatus');
        if (stEl) {
            stEl.textContent = 'Running';
            stEl.className = 'gc-status-running';
        }

        fetch('api/gc/fetch/trigger', { method: 'POST' })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                GC.showLoading(false);
                GC.updateLastUpdated();
                // Re-fire the current tab so it reloads data
                activateTab(_currentTab);
            })
            .catch(function(err) {
                GC.showLoading(false);
                console.error('GC refresh error:', err);
                if (stEl) {
                    stEl.textContent = 'Error';
                    stEl.className = 'gc-status-error';
                }
            });
    };

    // ── Tab navigation ─────────────────────────────────────────

    function switchView(tabName) {
        ALL_VIEWS.forEach(function(v) {
            var el = document.getElementById(v + 'View');
            if (!el) return;
            if (v === tabName) {
                el.style.display = '';
                el.classList.add('active');
            } else {
                el.style.display = 'none';
                el.classList.remove('active');
            }
        });
    }

    function activateTab(tabName) {
        _currentTab = tabName;
        switchView(tabName);
        _loadedTabs[tabName] = true;
        document.dispatchEvent(new CustomEvent('gc-tab-activated', { detail: { tab: tabName } }));
    }

    function hookSidebarNav() {
        document.querySelectorAll('[data-view]').forEach(function(item) {
            item.addEventListener('click', function() {
                var view = this.getAttribute('data-view');
                if (!view) return;

                // Update active state on nav items
                document.querySelectorAll('[data-view]').forEach(function(n) {
                    n.classList.remove('active');
                });
                this.classList.add('active');

                activateTab(view);
            });
        });
    }

    // ── Dashboard view builder ─────────────────────────────────

    function buildDashboard() {
        var container = document.getElementById('gcDashboardView');
        if (!container) return;

        container.innerHTML =
            '<div class="gc-dashboard-loading" style="text-align:center;padding:60px 0;">' +
                '<div class="gc-spinner" style="margin:0 auto 16px;width:36px;height:36px;border:3px solid rgba(255,255,255,.1);border-top-color:#7c3aed;border-radius:50%;animation:gc-spin .8s linear infinite;"></div>' +
                '<p style="color:var(--text-dim,#71717a);">Loading dashboard...</p>' +
            '</div>';

        var pipelineP = fetch('api/gc/pipeline/status').then(function(r) { return r.json(); }).catch(function() { return {}; });
        var creativesP = fetch('api/gc/creatives?days=90').then(function(r) { return r.json(); }).catch(function() { return { creatives: [] }; });
        var forecastP  = fetch('api/gc/forecast/summary').then(function(r) { return r.json(); }).catch(function() { return {}; });

        Promise.all([pipelineP, creativesP, forecastP]).then(function(results) {
            var pipeline  = results[0] || {};
            var cData     = results[1] || {};
            var forecast  = results[2] || {};

            var creatives = cData.creatives || cData.data || [];
            var totalCreatives = Array.isArray(creatives) ? creatives.length : 0;
            var forecastAlerts = forecast.alerts ? forecast.alerts.length : (forecast.alertCount || 0);

            // Pipeline info
            var pipelineStatus = (pipeline.status || 'idle').toLowerCase();
            var pipelineStatusLabel = pipelineStatus.charAt(0).toUpperCase() + pipelineStatus.slice(1);
            var lastRunStr = '--';
            if (pipeline.lastRun) {
                var d = new Date(pipeline.lastRun);
                lastRunStr = d.toLocaleString('en-IN', {
                    day: 'numeric', month: 'short',
                    hour: '2-digit', minute: '2-digit'
                });
            }

            // Zero-state
            if (totalCreatives === 0) {
                container.innerHTML = buildGettingStartedCard(pipelineStatusLabel, lastRunStr);
                return;
            }

            // Compute quick stats from creatives
            var totalSpend = 0, totalConversions = 0, totalImpressions = 0;
            var typeCount = {};
            creatives.forEach(function(c) {
                totalSpend       += Number(c.spend || c.cost || 0);
                totalConversions += Number(c.conversions || 0);
                totalImpressions += Number(c.impressions || 0);
                var t = (c.ad_type || c.adType || 'RSA').toUpperCase();
                typeCount[t] = (typeCount[t] || 0) + 1;
            });

            var typeSummaryHTML = '';
            Object.keys(typeCount).forEach(function(t) {
                typeSummaryHTML +=
                    '<span class="gc-type-pill ' + GC.typeBadgeClass(t) + '">' +
                        GC.esc(t) + ' <strong>' + typeCount[t] + '</strong>' +
                    '</span> ';
            });

            container.innerHTML =
                '<div class="gc-dashboard-grid">' +

                    // Row 1: KPI cards
                    '<div class="gc-kpi-row">' +
                        buildKpiCard('Total Creatives', totalCreatives, '', 'gc-kpi-purple') +
                        buildKpiCard('Impressions', formatCompact(totalImpressions), '', 'gc-kpi-blue') +
                        buildKpiCard('Spend (90d)', GC.fmtINR(totalSpend), '', 'gc-kpi-amber') +
                        buildKpiCard('Conversions', formatCompact(totalConversions), '', 'gc-kpi-green') +
                    '</div>' +

                    // Row 2: Pipeline + Type Breakdown + Forecast
                    '<div class="gc-dash-row2">' +
                        '<div class="gc-card gc-card-pipeline">' +
                            '<h3>Pipeline</h3>' +
                            '<div class="gc-pipeline-info">' +
                                '<p><span class="gc-label">Status:</span> <span class="gc-status-dot gc-status-' + pipelineStatus + '"></span> ' + GC.esc(pipelineStatusLabel) + '</p>' +
                                '<p><span class="gc-label">Last Run:</span> ' + GC.esc(lastRunStr) + '</p>' +
                            '</div>' +
                        '</div>' +
                        '<div class="gc-card gc-card-types">' +
                            '<h3>Ad Types</h3>' +
                            '<div class="gc-type-pills">' + typeSummaryHTML + '</div>' +
                        '</div>' +
                        '<div class="gc-card gc-card-forecast">' +
                            '<h3>Forecast Alerts</h3>' +
                            '<div class="gc-forecast-count">' +
                                '<span class="gc-big-num ' + (forecastAlerts > 0 ? 'gc-alert-active' : '') + '">' + forecastAlerts + '</span>' +
                                '<span class="gc-forecast-label">' + (forecastAlerts === 0 ? 'No alerts' : (forecastAlerts === 1 ? 'alert' : 'alerts')) + '</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +

                '</div>';
        }).catch(function(err) {
            console.error('Dashboard load error:', err);
            container.innerHTML =
                '<div class="gc-card" style="text-align:center;padding:40px;">' +
                    '<p style="color:var(--red,#ef4444);">Failed to load dashboard data.</p>' +
                    '<p style="color:var(--text-dim,#71717a);font-size:13px;margin-top:8px;">' + GC.esc(String(err)) + '</p>' +
                '</div>';
        });
    }

    function buildGettingStartedCard(statusLabel, lastRunStr) {
        return (
            '<div class="gc-card gc-getting-started" style="max-width:640px;margin:60px auto;text-align:center;padding:48px 32px;">' +
                '<div style="font-size:48px;margin-bottom:16px;">&#128640;</div>' +
                '<h2 style="margin-bottom:12px;">Getting Started with Google Creative Intelligence</h2>' +
                '<p style="color:var(--text-dim,#71717a);margin-bottom:24px;line-height:1.6;">' +
                    'No Google Ads creatives found yet. To get started, ensure your Google Ads API credentials are configured ' +
                    'and run a data fetch. The pipeline will pull your ad creatives, performance metrics, and forecasting data.' +
                '</p>' +
                '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">' +
                    '<div class="gc-card" style="padding:16px 20px;min-width:140px;">' +
                        '<div style="font-size:13px;color:var(--text-dim,#71717a);">Pipeline Status</div>' +
                        '<div style="font-size:18px;font-weight:600;margin-top:4px;">' + GC.esc(statusLabel) + '</div>' +
                    '</div>' +
                    '<div class="gc-card" style="padding:16px 20px;min-width:140px;">' +
                        '<div style="font-size:13px;color:var(--text-dim,#71717a);">Last Run</div>' +
                        '<div style="font-size:18px;font-weight:600;margin-top:4px;">' + GC.esc(lastRunStr) + '</div>' +
                    '</div>' +
                '</div>' +
                '<button onclick="window.GC.triggerRefresh()" class="gc-btn gc-btn-primary" style="margin-top:24px;">Fetch Google Ads Data</button>' +
            '</div>'
        );
    }

    function buildKpiCard(title, value, subtitle, colorClass) {
        return (
            '<div class="gc-card gc-kpi-card ' + (colorClass || '') + '">' +
                '<div class="gc-kpi-title">' + GC.esc(title) + '</div>' +
                '<div class="gc-kpi-value">' + GC.esc(String(value)) + '</div>' +
                (subtitle ? '<div class="gc-kpi-sub">' + GC.esc(subtitle) + '</div>' : '') +
            '</div>'
        );
    }

    function formatCompact(n) {
        if (n == null || isNaN(n)) return '--';
        var v = Number(n);
        if (v >= 10000000) return (v / 10000000).toFixed(1) + 'Cr';
        if (v >= 100000)   return (v / 100000).toFixed(1) + 'L';
        if (v >= 1000)     return (v / 1000).toFixed(1) + 'K';
        return String(Math.round(v));
    }

    // ── Init ───────────────────────────────────────────────────

    function init() {
        hookSidebarNav();

        // Show only the dashboard view initially
        switchView('gcDashboard');

        // Mark dashboard nav as active
        var dashNav = document.querySelector('[data-view="gcDashboard"]');
        if (dashNav) dashNav.classList.add('active');

        // Load dashboard data
        buildDashboard();

        // Update header status
        GC.updateLastUpdated();

        // Let other tab scripts know the dashboard is active
        document.dispatchEvent(new CustomEvent('gc-tab-activated', { detail: { tab: 'gcDashboard' } }));
    }

    // Listen for gc-tab-activated to rebuild dashboard when user returns to it
    document.addEventListener('gc-tab-activated', function(e) {
        if (e.detail && e.detail.tab === 'gcDashboard') {
            buildDashboard();
        }
    });

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
