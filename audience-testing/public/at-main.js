(function() {
    'use strict';

    window.AT = window.AT || {};

    // Auto-detect portal: Google portal has gcDashboardView, Meta portal has dashboardView
    var isGooglePortal = !!document.getElementById('gcDashboardView');
    AT.currentPlatform = isGooglePortal ? 'google' : 'meta';

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup);
    } else {
        setup();
    }

    function setup() {
        // Meta portal: view id = audienceTestingView
        // Google portal: view id = gcAudienceTestingView
        var viewId = isGooglePortal ? 'gcAudienceTestingView' : 'audienceTestingView';
        var navSelector = isGooglePortal ? '[data-view="gcAudienceTesting"]' : '[data-view="audienceTesting"]';

        var view = document.getElementById(viewId);
        if (view) {
            var observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(m) {
                    if (m.target.classList.contains('active')) {
                        onTabActivated();
                    }
                });
            });
            observer.observe(view, { attributes: true, attributeFilter: ['class'] });

            if (view.classList.contains('active')) {
                setTimeout(onTabActivated, 0);
            }
        }

        document.addEventListener('click', function(e) {
            if (e.target.closest(navSelector)) {
                setTimeout(onTabActivated, 50);
            }
        });

        document.addEventListener('gc-tab-activated', function(e) {
            if (e.detail && (e.detail.tab === 'audienceTesting' || e.detail.tab === 'gcAudienceTesting')) {
                setTimeout(onTabActivated, 0);
            }
        });

        window.addEventListener('portal-data-updated', function() {
            var ctx = window.getPortalAssistantContext ? window.getPortalAssistantContext() : null;
            var range = ctx && ctx.dateRange ? ctx.dateRange : {};
            var diag = ctx && ctx.diagnostics ? ctx.diagnostics : {};
            var signature = [
                ctx && ctx.app || (isGooglePortal ? 'google' : 'meta'),
                ctx && ctx.view || (isGooglePortal ? 'gcAudienceTesting' : 'audienceTesting'),
                range.since || '',
                range.until || '',
                range.label || '',
                diag.source || '',
                diag.matchedKeys || 0,
                diag.unmatchedKeys || 0
            ].join('::');
            if (signature === _lastPortalSignature) return;
            _lastPortalSignature = signature;
            if (_initialized && typeof AT.refreshCurrentView === 'function') {
                AT.refreshCurrentView();
            }
        });
    }

    var _initialized = false;
    var _lastPortalSignature = '';

    function onTabActivated() {
        if (_initialized) return;
        _initialized = true;
        initAudienceTesting();
    }

    async function initAudienceTesting() {
        var container = document.getElementById('atContent');
        if (!container) return;

        container.innerHTML = buildMainHTML();

        // Bind drawer close
        var overlay = document.getElementById('atDrawerOverlay');
        if (overlay) overlay.addEventListener('click', AT.closeDrawer);

        // Initialize the correct platform view
        if (isGooglePortal) {
            if (window.ATGoogle) ATGoogle.init();
        } else {
            if (window.ATMeta) ATMeta.init();
        }
    }

    function buildMainHTML() {
        var platformLabel = isGooglePortal ? 'Google' : 'Meta';
        var viewId = isGooglePortal ? 'atGoogleView' : 'atMetaView';

        return '' +
            '<div class="at-platform-toggle">' +
                '<span style="font-size:12px;font-weight:600;color:var(--text,#e4e4e7);padding:6px 12px">' + platformLabel + ' Audience Testing</span>' +
                '<div style="flex:1"></div>' +
                '<button class="at-scan-btn" style="margin:0;padding:4px 12px;font-size:11px" onclick="AT.triggerScan()">&#x1f504; Scan Now</button>' +
                '<button class="at-scan-btn" style="margin:0 0 0 6px;padding:4px 12px;font-size:11px" onclick="AT.generateAudienceBrain()">&#x1f9e0; Generate Brain</button>' +
            '</div>' +
            '<div id="' + viewId + '" class="at-container" style="overflow-y:auto;max-height:calc(100vh - 140px)"></div>' +
            '<div id="atDrawerOverlay" class="at-drawer-overlay"></div>' +
            '<div id="atDrawer" class="at-drawer">' +
                '<button class="at-drawer-close" onclick="AT.closeDrawer()">&#x2715;</button>' +
                '<div class="at-drawer-body"></div>' +
            '</div>';
    }

    AT.generateAudienceBrain = function(feedback) {
        if (isGooglePortal && window.ATGoogle && typeof ATGoogle.loadBrain === 'function') {
            return ATGoogle.loadBrain(feedback || '');
        }
        if (!isGooglePortal && window.ATMeta && typeof ATMeta.loadBrain === 'function') {
            return ATMeta.loadBrain(feedback || '');
        }
        return AT.apiPost('/audience/brain', {
            platform: AT.currentPlatform,
            user_request: 'Optimizer-level audience insights and actions',
            feedback: feedback || ''
        }).then(function() {
            if (typeof AT.refreshCurrentView === 'function') AT.refreshCurrentView();
        });
    };
})();
