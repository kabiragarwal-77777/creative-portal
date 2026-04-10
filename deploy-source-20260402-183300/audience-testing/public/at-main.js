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
        }

        document.addEventListener('click', function(e) {
            if (e.target.closest(navSelector)) {
                setTimeout(onTabActivated, 50);
            }
        });
    }

    var _initialized = false;

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
                '<button class="at-scan-btn" style="margin:0 0 0 6px;padding:4px 12px;font-size:11px" onclick="AT.apiPost(\'/recommendations/generate\').then(function(){AT.refreshCurrentView()})">&#x1f9e0; Generate Recommendations</button>' +
            '</div>' +
            '<div id="' + viewId + '" class="at-container" style="overflow-y:auto;max-height:calc(100vh - 140px)"></div>' +
            '<div id="atDrawerOverlay" class="at-drawer-overlay"></div>' +
            '<div id="atDrawer" class="at-drawer">' +
                '<button class="at-drawer-close" onclick="AT.closeDrawer()">&#x2715;</button>' +
                '<div class="at-drawer-body"></div>' +
            '</div>';
    }
})();
