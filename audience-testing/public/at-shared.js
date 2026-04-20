(function() {
    'use strict';
    window.AT = window.AT || {};

    AT.esc = function(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; };
    AT.fmtINR = function(v) { if (v == null || isNaN(v)) return '--'; v = Number(v); if (v >= 10000000) return '\u20B9' + (v/10000000).toFixed(1) + 'Cr'; if (v >= 100000) return '\u20B9' + (v/100000).toFixed(1) + 'L'; if (v >= 1000) return '\u20B9' + (v/1000).toFixed(1) + 'K'; return '\u20B9' + Math.round(v); };
    AT.fmtPct = function(v) { if (v == null || isNaN(v)) return '--'; return Number(v).toFixed(1) + '%'; };
    AT.fmtROAS = function(v) { if (v == null || isNaN(v) || v <= 0) return '--'; return Number(v).toFixed(2) + 'x'; };

    AT.api = async function(path, opts) {
        try {
            var res = await fetch('api/at' + path.replace(/^\//, ''), opts || {});
            return await res.json();
        } catch(e) { console.error('[AT]', e); return { success: false, error: e.message }; }
    };

    AT.apiPost = async function(path, body) {
        return AT.api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    };

    // Drawer management
    AT.openDrawer = function(html) {
        var overlay = document.getElementById('atDrawerOverlay');
        var drawer = document.getElementById('atDrawer');
        if (!overlay || !drawer) return;
        drawer.querySelector('.at-drawer-body').innerHTML = html;
        overlay.classList.add('open');
        drawer.classList.add('open');
    };
    AT.closeDrawer = function() {
        var overlay = document.getElementById('atDrawerOverlay');
        var drawer = document.getElementById('atDrawer');
        if (overlay) overlay.classList.remove('open');
        if (drawer) drawer.classList.remove('open');
    };

    // Loading state
    AT.showLoading = function(container, msg) {
        if (typeof container === 'string') container = document.getElementById(container);
        if (!container) return;
        container.innerHTML = '<div class="at-loading"><div class="at-loading-spinner"></div>' + AT.esc(msg || 'Loading...') + '</div>';
    };

    AT.showEmpty = function(container, icon, text, sub, showScan) {
        if (typeof container === 'string') container = document.getElementById(container);
        if (!container) return;
        container.innerHTML = '<div class="at-empty"><div class="at-empty-icon">' + (icon || '\uD83C\uDFAF') + '</div><div class="at-empty-text">' + AT.esc(text || 'No data yet') + '</div><div class="at-empty-sub">' + AT.esc(sub || '') + '</div>' + (showScan ? '<button class="at-scan-btn" onclick="AT.triggerScan()">Run First Scan</button>' : '') + '</div>';
    };

    AT.triggerScan = function() {
        var platform = AT.currentPlatform || 'meta';
        // Fire and forget — don't block the UI
        AT.api('/' + platform + '/scan/trigger');
        // Show a non-blocking banner instead of replacing content
        var banner = document.getElementById('atScanBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'atScanBanner';
            banner.style.cssText = 'position:fixed;top:12px;right:12px;z-index:9999;background:#1e1e2e;border:1px solid var(--accent,#6366f1);border-radius:10px;padding:10px 18px;font-size:12px;color:var(--text,#e4e4e7);display:flex;align-items:center;gap:8px;box-shadow:0 4px 20px rgba(0,0,0,0.4)';
            document.body.appendChild(banner);
        }
        banner.innerHTML = '<div class="at-loading-spinner" style="width:14px;height:14px;border-width:2px"></div> Scanning ' + platform + ' audiences... (runs in background)';
        banner.style.display = 'flex';
        // Poll scan status and auto-refresh when done
        var pollCount = 0;
        var poll = setInterval(async function() {
            pollCount++;
            var r = await AT.api('/' + platform + '/scan/status');
            if (r.success && r.data) {
                var count = platform === 'meta' ? (r.data.adsetCount || 0) : (r.data.adgroupCount || 0);
                banner.innerHTML = '<div class="at-loading-spinner" style="width:14px;height:14px;border-width:2px"></div> Scanning... ' + count + ' items found so far';
            }
            if (pollCount > 60) { // 5 min max
                clearInterval(poll);
                banner.innerHTML = '&#x2705; Scan running in background. Refresh the tab when ready.';
                setTimeout(function() { banner.style.display = 'none'; }, 5000);
            }
        }, 5000);
        // Also try refreshing after 30s and 60s
        setTimeout(function() { AT.refreshCurrentView(); }, 30000);
        setTimeout(function() { AT.refreshCurrentView(); clearInterval(poll); banner.innerHTML = '&#x2705; Scan complete'; setTimeout(function(){ banner.style.display = 'none'; }, 3000); }, 120000);
    };

    AT.refreshCurrentView = function() {
        if (AT.currentPlatform === 'google') { if (window.ATGoogle) ATGoogle.refresh(); }
        else { if (window.ATMeta) ATMeta.refresh(); }
    };

    // Confidence badge
    AT.confidenceBadge = function(conversions) {
        if (conversions > 50) return '<span class="at-confidence high">HIGH</span>';
        if (conversions > 20) return '<span class="at-confidence medium">MEDIUM</span>';
        return '<span class="at-confidence low">LOW</span>';
    };

    // Status badge
    AT.statusBadge = function(status) {
        var s = (status || '').toUpperCase();
        if (s === 'ACTIVE' || s === 'ENABLED') return '<span class="at-status active">Active</span>';
        return '<span class="at-status paused">Paused</span>';
    };

    AT.getRefreshStampKey = function() {
        return 'at_last_refresh_' + String(AT.currentPlatform || 'meta');
    };

    AT.formatRefreshStamp = function(value) {
        if (!value) return '--';
        var dt = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(dt.getTime())) return String(value);
        return dt.toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    AT.readRefreshStamp = function() {
        try {
            var raw = localStorage.getItem(AT.getRefreshStampKey());
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            return parsed && parsed.ts ? parsed.ts : null;
        } catch (e) {
            return null;
        }
    };

    AT.writeRefreshStamp = function(value, source) {
        var ts = value || new Date().toISOString();
        try {
            localStorage.setItem(AT.getRefreshStampKey(), JSON.stringify({ ts: ts, source: source || 'manual' }));
        } catch (e) {}
        var el = document.getElementById('atLastRefreshed');
        if (el) el.textContent = AT.formatRefreshStamp(ts);
        return ts;
    };

    AT.bootstrapRefreshStamp = function(value, source) {
        var ts = value || AT.readRefreshStamp() || new Date().toISOString();
        AT.writeRefreshStamp(ts, source || 'bootstrap');
        return ts;
    };

    AT.touchRefreshStamp = function(source) {
        return AT.writeRefreshStamp(new Date().toISOString(), source || 'manual');
    };
})();
