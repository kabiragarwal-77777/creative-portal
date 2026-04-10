/* ============================================================
   Self-Learning Engine — fe-dashboard.js
   Live Feed view: KPI strip, activity stream, system health
   ============================================================ */

(function () {

    // Current activity filter
    let activityFilter = 'all';
    // Cached data
    let cachedActivities = [];
    let cachedAgents = [];

    // ---- Build skeleton on first load ----

    function buildDashboardHTML() {
        return `
            <div class="fe-header">
                <div>
                    <h1>Live Feed</h1>
                    <div class="fe-header-subtitle">Real-time self-learning engine activity</div>
                </div>
                <div class="fe-header-actions">
                    <button class="fe-btn fe-btn-sm" onclick="FE.refresh_dashboard()">&#8635; Refresh</button>
                </div>
            </div>

            <!-- KPI strip -->
            <div class="fe-kpi-grid" id="feDashKpis">
                <div class="fe-kpi-card" data-color="purple">
                    <div class="fe-kpi-label">Pending Proposals</div>
                    <div class="fe-kpi-value" id="feKpi-proposals"><span class="fe-spinner fe-spinner-sm"></span></div>
                    <div class="fe-kpi-change" id="feKpiSub-proposals">loading...</div>
                </div>
                <div class="fe-kpi-card" data-color="red">
                    <div class="fe-kpi-label">Active Anomalies</div>
                    <div class="fe-kpi-value" id="feKpi-anomalies"><span class="fe-spinner fe-spinner-sm"></span></div>
                    <div class="fe-kpi-change" id="feKpiSub-anomalies">loading...</div>
                </div>
                <div class="fe-kpi-card" data-color="teal">
                    <div class="fe-kpi-label">Knowledge Items Today</div>
                    <div class="fe-kpi-value" id="feKpi-knowledge"><span class="fe-spinner fe-spinner-sm"></span></div>
                    <div class="fe-kpi-change" id="feKpiSub-knowledge">loading...</div>
                </div>
                <div class="fe-kpi-card" data-color="green">
                    <div class="fe-kpi-label">7d Prediction Accuracy</div>
                    <div class="fe-kpi-value" id="feKpi-accuracy"><span class="fe-spinner fe-spinner-sm"></span></div>
                    <div class="fe-kpi-change" id="feKpiSub-accuracy">loading...</div>
                </div>
            </div>

            <!-- Body: stream + health -->
            <div class="fe-dashboard-body">
                <!-- Left: Activity Stream -->
                <div class="fe-dashboard-left">
                    <div class="fe-section-title">
                        Activity Stream <span class="fe-count" id="feActivityCount">0</span>
                    </div>
                    <div class="fe-filter-bar" id="feActivityFilters">
                        <button class="fe-filter-btn active" data-filter="all">All</button>
                        <button class="fe-filter-btn" data-filter="anomaly">Anomalies</button>
                        <button class="fe-filter-btn" data-filter="proposal">Proposals</button>
                        <button class="fe-filter-btn" data-filter="knowledge">Knowledge</button>
                        <button class="fe-filter-btn" data-filter="accuracy">Accuracy</button>
                    </div>
                    <div class="fe-activity-stream" id="feActivityStream">
                        <div class="fe-loading"><span class="fe-spinner"></span> Loading activity...</div>
                    </div>
                </div>

                <!-- Right: System Health -->
                <div class="fe-dashboard-right">
                    <div class="fe-section-title">System Health</div>
                    <div class="fe-agent-status" id="feAgentStatus">
                        <div class="fe-loading"><span class="fe-spinner fe-spinner-sm"></span> Loading...</div>
                    </div>
                </div>
            </div>
        `;
    }

    // ---- KPI Fetchers ----

    async function fetchKpis() {
        // Pending proposals count
        FE.fetch('/proposals?status=pending').then(res => {
            const el = document.getElementById('feKpi-proposals');
            const sub = document.getElementById('feKpiSub-proposals');
            if (!el) return;
            const arr = Array.isArray(res) ? res : [];
            el.textContent = arr.length;
            const highRisk = arr.filter(p => p.risk_level === 'high').length;
            sub.textContent = highRisk > 0 ? `${highRisk} high risk` : (arr.length > 0 ? 'awaiting review' : 'none pending');
            sub.className = 'fe-kpi-change' + (highRisk > 0 ? ' negative' : '');
        });

        // Active anomalies
        FE.fetch('/anomalies/active').then(res => {
            const el = document.getElementById('feKpi-anomalies');
            const sub = document.getElementById('feKpiSub-anomalies');
            if (!el) return;
            const arr = Array.isArray(res) ? res : [];
            el.textContent = arr.length;
            const crit = arr.filter(a => a.severity === 'critical').length;
            sub.textContent = crit > 0 ? `${crit} critical` : (arr.length > 0 ? `${arr.length} warnings` : 'all nominal');
            sub.className = 'fe-kpi-change' + (crit > 0 ? ' negative' : ' positive');
        });

        // Knowledge items today
        FE.fetch('/knowledge/items?days=1').then(res => {
            const el = document.getElementById('feKpi-knowledge');
            const sub = document.getElementById('feKpiSub-knowledge');
            if (!el) return;
            const arr = Array.isArray(res) ? res : [];
            el.textContent = arr.length;
            const highUrg = arr.filter(k => k.urgency === 'high').length;
            sub.textContent = highUrg > 0 ? `${highUrg} high urgency` : 'signals ingested';
            sub.className = 'fe-kpi-change' + (arr.length > 0 ? ' positive' : '');
        });

        // 7d prediction accuracy
        FE.fetch('/watcher/summary').then(res => {
            const el = document.getElementById('feKpi-accuracy');
            const sub = document.getElementById('feKpiSub-accuracy');
            if (!el) return;
            if (res && res.total > 0) {
                el.textContent = FE.formatPct(res.accurate_pct);
                sub.textContent = `${res.total} predictions tracked`;
                sub.className = 'fe-kpi-change' + (res.accurate_pct > 50 ? ' positive' : '');
            } else {
                el.textContent = '--';
                sub.textContent = 'no predictions yet';
            }
        });
    }

    // ---- Activity Stream ----

    const ACTIVITY_ICONS = {
        anomaly:   { icon: '&#9888;', label: 'Anomaly' },
        proposal:  { icon: '&#9654;', label: 'Proposal' },
        knowledge: { icon: '&#9670;', label: 'Knowledge' },
        accuracy:  { icon: '&#9733;', label: 'Accuracy' },
        scheduler: { icon: '&#9881;', label: 'Scheduler' }
    };

    async function fetchActivities() {
        const results = await Promise.allSettled([
            FE.fetch('/anomalies'),
            FE.fetch('/proposals'),
            FE.fetch('/knowledge/items?days=7'),
            FE.fetch('/watcher/predictions')
        ]);

        const items = [];

        // Anomalies
        const anomalies = results[0].status === 'fulfilled' && Array.isArray(results[0].value) ? results[0].value : [];
        anomalies.forEach(a => {
            items.push({
                type: 'anomaly',
                timestamp: a.detected_at,
                text: `<strong>${FE.escapeHtml(a.title || a.anomaly_type)}</strong> — ${FE.escapeHtml(a.description || '')}`,
                agent: 'anomaly-detector',
                severity: a.severity
            });
        });

        // Proposals
        const proposals = results[1].status === 'fulfilled' && Array.isArray(results[1].value) ? results[1].value : [];
        proposals.forEach(p => {
            items.push({
                type: 'proposal',
                timestamp: p.generated_at,
                text: `<strong>${FE.escapeHtml(p.title || p.proposal_type)}</strong> ${p.status} — ${FE.escapeHtml(p.description || '')}`,
                agent: p.generated_by_agent || 'proposal-generator',
                severity: p.risk_level
            });
        });

        // Knowledge
        const knowledge = results[2].status === 'fulfilled' && Array.isArray(results[2].value) ? results[2].value : [];
        knowledge.forEach(k => {
            items.push({
                type: 'knowledge',
                timestamp: k.ingested_at,
                text: `<strong>${FE.escapeHtml(k.source_name || k.source_type)}</strong> — ${FE.escapeHtml(k.key_insight || k.raw_content_preview || '')}`,
                agent: 'knowledge-crawler',
                severity: null
            });
        });

        // Accuracy (show only ones with actuals)
        const predictions = results[3].status === 'fulfilled' && Array.isArray(results[3].value) ? results[3].value : [];
        predictions.filter(a => a.accuracy_tag).slice(0, 20).forEach(a => {
            items.push({
                type: 'accuracy',
                timestamp: a.checked_at,
                text: `<strong>${a.source.toUpperCase()}</strong> ${FE.escapeHtml(a.ad_name || a.ad_id)} — Predicted: ${a.predicted_roas_d7 ? a.predicted_roas_d7.toFixed(2) : '--'}x, Actual: ${a.actual_roas_d7 ? a.actual_roas_d7.toFixed(2) : '--'}x (${a.accuracy_tag})`,
                agent: 'watcher',
                severity: null
            });
        });

        // Sort by timestamp descending
        items.sort((a, b) => {
            const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return tB - tA;
        });

        cachedActivities = items;
        renderActivities();
    }

    function renderActivities() {
        const container = document.getElementById('feActivityStream');
        const countEl = document.getElementById('feActivityCount');
        if (!container) return;

        const filtered = activityFilter === 'all'
            ? cachedActivities
            : cachedActivities.filter(a => a.type === activityFilter);

        if (countEl) countEl.textContent = filtered.length;

        if (filtered.length === 0) {
            container.innerHTML = `
                <div class="fe-empty">
                    <div class="fe-empty-icon">&#9673;</div>
                    <div class="fe-empty-title">No activity</div>
                    <div class="fe-empty-text">No recent events match the current filter. The system will populate as agents run.</div>
                </div>
            `;
            return;
        }

        container.innerHTML = filtered.map(item => {
            const iconInfo = ACTIVITY_ICONS[item.type] || ACTIVITY_ICONS.scheduler;
            return `
                <div class="fe-activity-item">
                    <div class="fe-activity-icon ${item.type}">${iconInfo.icon}</div>
                    <div class="fe-activity-body">
                        <div class="fe-activity-text">${item.text}</div>
                        <div class="fe-activity-meta">
                            <span class="fe-activity-agent ${item.type}">${FE.escapeHtml(item.agent)}</span>
                            <span>${FE.timeAgo(item.timestamp)}</span>
                            ${item.severity ? FE.riskBadge(item.severity) : ''}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function wireFilterButtons() {
        const bar = document.getElementById('feActivityFilters');
        if (!bar) return;
        bar.addEventListener('click', (e) => {
            const btn = e.target.closest('.fe-filter-btn');
            if (!btn) return;
            bar.querySelectorAll('.fe-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activityFilter = btn.dataset.filter;
            renderActivities();
        });
    }

    // ---- System Health ----

    const KNOWN_AGENTS = [
        { key: 'watcher-refresh', name: 'Performance Watcher', intervalMin: 60 },
        { key: 'anomaly-check', name: 'Anomaly Detector', intervalMin: 180 },
        { key: 'data-quality-check', name: 'Data Quality Monitor', intervalMin: 60 },
        { key: 'proposal-generate', name: 'Proposal Generator', intervalMin: 360 },
        { key: 'knowledge-crawl-tier1', name: 'Knowledge Crawler T1', intervalMin: 360 },
        { key: 'knowledge-crawl-all', name: 'Knowledge Crawler All', intervalMin: 720 },
        { key: 'hypothesis-generate', name: 'Self Tester', intervalMin: 1440 },
        { key: 'memory-consolidate', name: 'Memory Engine', intervalMin: 1440 },
        { key: 'accuracy-audit', name: 'Accuracy Auditor', intervalMin: 10080 }
    ];

    async function fetchAgentStatus() {
        const container = document.getElementById('feAgentStatus');
        if (!container) return;

        const res = await FE.fetch('/scheduler/status');

        if (!res || res.error) {
            cachedAgents = KNOWN_AGENTS.map(a => ({
                key: a.key, name: a.name, status: 'unknown',
                last_run: null, next_run: null, intervalMin: a.intervalMin
            }));
        } else {
            // res is an object keyed by job name, each with { description, schedule, is_running, last_run, last_run_cached }
            cachedAgents = KNOWN_AGENTS.map(a => {
                const s = res[a.key] || {};
                const lastRunTime = s.last_run_cached || (s.last_run && s.last_run.completed_at) || null;
                const lastError = s.last_run && s.last_run.errors;
                return {
                    key: a.key,
                    name: a.name,
                    description: s.description || '',
                    last_run: lastRunTime,
                    next_run: s.next_cron || null,
                    is_running: s.is_running || false,
                    status: s.is_running ? 'green' : computeAgentHealth(lastRunTime, a.intervalMin, lastError),
                    last_error: lastError || null,
                    intervalMin: a.intervalMin
                };
            });
        }

        renderAgentStatus();
    }

    function computeAgentHealth(lastRun, expectedIntervalMin, lastError) {
        if (lastError) return 'red';
        if (!lastRun) return 'amber';
        const elapsed = (Date.now() - new Date(lastRun).getTime()) / 60000;
        if (elapsed <= expectedIntervalMin * 1.5) return 'green';
        if (elapsed <= expectedIntervalMin * 3) return 'amber';
        return 'red';
    }

    function renderAgentStatus() {
        const container = document.getElementById('feAgentStatus');
        if (!container) return;

        if (cachedAgents.length === 0) {
            container.innerHTML = `
                <div class="fe-empty">
                    <div class="fe-empty-icon">&#9881;</div>
                    <div class="fe-empty-title">No agents</div>
                    <div class="fe-empty-text">Scheduler status unavailable.</div>
                </div>
            `;
            return;
        }

        container.innerHTML = cachedAgents.map(agent => {
            const dotClass = `fe-status-${agent.status}`;
            return `
                <div class="fe-agent-card" onclick="FE._openAgentDrawer('${agent.key}', '${FE.escapeHtml(agent.name)}')">
                    <div class="fe-agent-card-header">
                        <span class="fe-agent-name">
                            <span class="fe-status-dot ${dotClass}"></span>
                            ${FE.escapeHtml(agent.name)}
                        </span>
                    </div>
                    <div class="fe-agent-times">
                        <span>Last: ${FE.timeAgo(agent.last_run)}</span>
                        <span>Next: ${agent.next_run ? FE.timeAgo(agent.next_run) : 'scheduled'}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    // Agent detail drawer
    FE._openAgentDrawer = async function (agentKey, agentName) {
        FE.openDrawer(`
            <div class="fe-drawer-title">${FE.escapeHtml(agentName)}</div>
            <div class="fe-drawer-subtitle">Agent key: ${FE.escapeHtml(agentKey)}</div>
            <div class="fe-drawer-section">
                <div class="fe-drawer-section-title">Recent Runs</div>
                <div id="feAgentRuns" class="fe-loading"><span class="fe-spinner fe-spinner-sm"></span> Loading runs...</div>
            </div>
        `);

        const res = await FE.fetch(`/scheduler/runs/${agentKey}?limit=10`);
        const runsEl = document.getElementById('feAgentRuns');
        if (!runsEl) return;

        if (!res || res.error || !Array.isArray(res) || res.length === 0) {
            runsEl.innerHTML = `
                <div class="fe-empty">
                    <div class="fe-empty-icon">&#128196;</div>
                    <div class="fe-empty-title">No run history</div>
                    <div class="fe-empty-text">No recorded runs for this agent yet.</div>
                </div>
            `;
            return;
        }

        runsEl.innerHTML = `
            <div class="fe-timeline">
                ${res.map(run => {
                    const dotClass = run.status === 'success' ? 'success' : (run.status === 'error' ? 'error' : 'warning');
                    const duration = run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : '--';
                    return `
                        <div class="fe-timeline-item">
                            <div class="fe-timeline-dot ${dotClass}"></div>
                            <div class="fe-timeline-content">
                                <div class="fe-timeline-time">${FE.formatDate(run.started_at || run.ran_at)}</div>
                                <div class="fe-timeline-text">
                                    ${FE.statusBadge(run.status)} &mdash; Duration: ${duration}
                                    ${run.items_processed != null ? ` &middot; ${run.items_processed} items` : ''}
                                    ${run.error ? `<br><span style="color:var(--fe-red);font-size:12px;">${FE.escapeHtml(run.error)}</span>` : ''}
                                </div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    };

    // ---- Refresh entry point ----

    FE.refresh_dashboard = function () {
        const view = document.getElementById('feView-dashboard');
        if (!view) return;

        // Build skeleton if empty
        if (!view.querySelector('.fe-header')) {
            view.innerHTML = buildDashboardHTML();
            wireFilterButtons();
        }

        // Fetch all data in parallel
        fetchKpis();
        fetchActivities();
        fetchAgentStatus();
    };

})();
