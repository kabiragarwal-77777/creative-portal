/* ============================================================
   Self-Learning Engine — fe-main.js
   Tab controller, shared utilities, polling, drawer/modal/toast
   ============================================================ */

window.FE = {
    API_BASE: '/api/fe',
    pollInterval: null,
    currentView: 'dashboard',

    // ---- Fetch helpers ----

    async fetch(endpoint, options = {}) {
        const url = this.API_BASE + endpoint;
        try {
            const res = await fetch(url, {
                headers: { 'Content-Type': 'application/json', ...options.headers },
                ...options
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            // Unwrap { success, data } envelope — return data directly
            if (json && json.success && json.data !== undefined) return json.data;
            return json;
        } catch (err) {
            console.error('[FE] fetch error:', endpoint, err);
            return { error: err.message };
        }
    },

    async post(endpoint, body = {}) {
        return this.fetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
    },

    async put(endpoint, body = {}) {
        return this.fetch(endpoint, { method: 'PUT', body: JSON.stringify(body) });
    },

    async del(endpoint) {
        return this.fetch(endpoint, { method: 'DELETE' });
    },

    // ---- View switching ----

    switchView(view) {
        this.currentView = view;
        document.querySelectorAll('.fe-view').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.fe-nav-item').forEach(n => n.classList.remove('active'));
        const viewEl = document.getElementById('feView-' + view);
        if (viewEl) viewEl.classList.add('active');
        const navEl = document.querySelector(`[data-view="${view}"]`);
        if (navEl) navEl.classList.add('active');
        // Trigger view-specific refresh
        const refreshFn = this['refresh_' + view];
        if (typeof refreshFn === 'function') refreshFn.call(this);
    },

    // ---- Toast notification ----

    toast(message, type = 'info') {
        const container = document.getElementById('feToasts');
        if (!container) return;
        const t = document.createElement('div');
        t.className = `fe-toast fe-toast-${type}`;
        t.textContent = message;
        container.appendChild(t);
        // Trigger show animation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => t.classList.add('fe-toast-show'));
        });
        setTimeout(() => {
            t.classList.remove('fe-toast-show');
            setTimeout(() => t.remove(), 300);
        }, 3500);
    },

    // ---- Drawer ----

    openDrawer(html) {
        const d = document.getElementById('feDrawer');
        if (!d) return;
        d.innerHTML = `<div class="fe-drawer-content"><button class="fe-drawer-close" onclick="FE.closeDrawer()">&times;</button>${html}</div>`;
        d.classList.add('open');
    },

    closeDrawer() {
        const d = document.getElementById('feDrawer');
        if (d) d.classList.remove('open');
    },

    // ---- Modal ----

    openModal(html) {
        const m = document.getElementById('feModal');
        if (!m) return;
        m.innerHTML = `<div class="fe-modal-content">${html}</div>`;
        m.style.display = 'flex';
    },

    closeModal() {
        const m = document.getElementById('feModal');
        if (m) m.style.display = 'none';
    },

    // ---- Critical Banner ----

    showBanner(text) {
        const b = document.getElementById('feCriticalBanner');
        if (!b) return;
        b.innerHTML = `
            <span class="fe-banner-icon">&#9888;</span>
            <span class="fe-banner-text">${this.escapeHtml(text)}</span>
            <button class="fe-banner-close" onclick="FE.hideBanner()">&times;</button>
        `;
        b.style.display = 'flex';
    },

    hideBanner() {
        const b = document.getElementById('feCriticalBanner');
        if (b) b.style.display = 'none';
    },

    // ---- Format helpers ----

    timeAgo(dateStr) {
        if (!dateStr) return '--';
        const now = Date.now();
        const then = new Date(dateStr).getTime();
        const diff = Math.max(0, now - then);
        const seconds = Math.floor(diff / 1000);
        if (seconds < 5) return 'just now';
        if (seconds < 60) return seconds + 's ago';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + 'm ago';
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + 'h ago';
        const days = Math.floor(hours / 24);
        if (days < 30) return days + 'd ago';
        const months = Math.floor(days / 30);
        if (months < 12) return months + 'mo ago';
        return Math.floor(months / 12) + 'y ago';
    },

    formatPct(n) {
        return n != null ? n.toFixed(1) + '%' : '--';
    },

    formatDate(d) {
        if (!d) return '--';
        const dt = new Date(d);
        return dt.toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
        });
    },

    formatDateShort(d) {
        if (!d) return '--';
        return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    },

    severityColor(s) {
        return { critical: '#ef4444', warning: '#f59e0b', info: '#3b82f6' }[s] || '#71717a';
    },

    riskBadge(level) {
        if (!level) return '';
        return `<span class="fe-badge fe-badge-${level}">${level.toUpperCase()}</span>`;
    },

    statusBadge(status) {
        if (!status) return '';
        const s = status.toLowerCase().replace(/\s+/g, '_');
        const label = status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
        return `<span class="fe-badge fe-badge-${s}">${label}</span>`;
    },

    typeBadge(type) {
        if (!type) return '';
        const colorMap = {
            anomaly: 'high',
            proposal: 'medium',
            knowledge: 'low',
            rule: 'teal',
            accuracy: 'info',
            scheduler: 'gray',
            budget_rule: 'purple',
            creative_rule: 'info',
            audience_rule: 'teal'
        };
        const cls = colorMap[type] || 'gray';
        return `<span class="fe-badge fe-badge-${cls}">${type.replace(/_/g, ' ')}</span>`;
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // ---- Polling ----

    startPolling() {
        this.poll();
        this.pollInterval = setInterval(() => this.poll(), 30000);
    },

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    },

    async poll() {
        try {
            // Update last poll timestamp
            const pollEl = document.getElementById('feLastPoll');
            if (pollEl) pollEl.textContent = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

            // Check for critical anomalies
            const anomalyRes = await this.fetch('/anomalies/active');
            const anomalies = Array.isArray(anomalyRes) ? anomalyRes : [];
            if (anomalies.length >= 0) {
                const critical = anomalies.filter(a => a.severity === 'critical');
                if (critical.length > 0) {
                    this.showBanner(`${critical.length} critical anomal${critical.length === 1 ? 'y' : 'ies'} detected — ${critical[0].description || 'Check anomaly feed'}`);
                    // Update system status to red
                    const statusDot = document.querySelector('#feSystemStatus .fe-status-dot');
                    if (statusDot) {
                        statusDot.className = 'fe-status-dot fe-status-red fe-pulse';
                        statusDot.nextElementSibling && (statusDot.nextElementSibling.textContent = 'Critical Alert');
                    }
                } else {
                    this.hideBanner();
                    const statusDot = document.querySelector('#feSystemStatus .fe-status-dot');
                    if (statusDot) {
                        statusDot.className = 'fe-status-dot fe-status-green fe-pulse';
                        const label = statusDot.nextElementSibling;
                        if (label) label.textContent = 'System Active';
                    }
                }
            }

            // Refresh current view
            const refreshFn = this['refresh_' + this.currentView];
            if (typeof refreshFn === 'function') refreshFn.call(this);

        } catch (err) {
            console.error('[FE] poll error:', err);
        }
    },

    // ---- Init ----

    init() {
        // Wire up nav clicks
        document.querySelectorAll('.fe-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchView(item.dataset.view);
            });
        });

        // Close modal on backdrop click
        const modal = document.getElementById('feModal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === e.currentTarget) this.closeModal();
            });
        }

        // Close drawer on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeDrawer();
                this.closeModal();
            }
        });

        // Load dashboard
        this.switchView('dashboard');
        this.startPolling();
    }
};

document.addEventListener('DOMContentLoaded', () => FE.init());
