/* ============================================================================
   fe-proposals.js — Proposals sub-tab for Feedback Engine
   Renders into #feView-proposals, registers as FE.refresh_proposals
   ============================================================================ */
(function () {
  'use strict';

  const TABS = ['pending', 'approved', 'applied', 'rejected', 'expired'];
  const TAB_LABELS = { pending: 'Pending', approved: 'Approved', applied: 'Applied', rejected: 'Rejected', expired: 'Expired' };
  const TYPE_COLORS = {
    SCORING_FORMULA_UPDATE: '#6c5ce7',
    BUDGET_REALLOCATION: '#0984e3',
    CREATIVE_BRIEF: '#00b894',
    AUDIENCE_SHIFT: '#fdcb6e',
    SCHEDULE_CHANGE: '#e17055',
    KNOWLEDGE_INTEGRATION: '#a29bfe'
  };

  let activeTab = 'pending';
  let selectedIds = new Set();

  function typeColor(t) {
    return TYPE_COLORS[t] || '#636e72';
  }

  function typeBadge(t) {
    const label = (t || 'unknown').replace(/_/g, ' ').toLowerCase();
    return `<span class="fe-badge" style="background:${typeColor(t)}22;color:${typeColor(t)};border:1px solid ${typeColor(t)}44">${label}</span>`;
  }

  // ---- Rendering ----

  async function refresh() {
    const root = document.getElementById('feView-proposals');
    if (!root) return;
    root.innerHTML = '<div class="fe-loading">Loading proposals...</div>';

    try {
      const res = await FE.fetch(`/proposals?status=${activeTab}`);
      const proposals = Array.isArray(res) ? res : [];

      let changesHtml = '';
      if (activeTab === 'applied') {
        const cRes = await FE.fetch('/changes');
        const changes = Array.isArray(cRes) ? cRes : [];
        changesHtml = renderChangesTable(changes);
      }

      root.innerHTML = renderTabBar() + renderBulkBar() + renderProposalList(proposals) + changesHtml;
      bindTabEvents(root);
      bindBulkEvents(root, proposals);
      bindCardEvents(root, proposals);
    } catch (e) {
      root.innerHTML = `<div class="fe-error">Failed to load proposals: ${e.message || e}</div>`;
    }
  }

  // ---- Tab bar ----

  function renderTabBar() {
    return `<div class="fe-tab-bar">${TABS.map(t =>
      `<button class="fe-tab-btn ${t === activeTab ? 'fe-tab-active' : ''}" data-tab="${t}">${TAB_LABELS[t]}</button>`
    ).join('')}</div>`;
  }

  function bindTabEvents(root) {
    root.querySelectorAll('.fe-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        selectedIds.clear();
        refresh();
      });
    });
  }

  // ---- Bulk action bar ----

  function renderBulkBar() {
    if (activeTab !== 'pending') return '';
    return `<div class="fe-bulk-bar">
      <label class="fe-check-label"><input type="checkbox" id="feBulkSelectLow"> Select All LOW Risk</label>
      <button class="fe-btn fe-btn-green" id="feBulkApprove" disabled>Approve Selected (<span id="feBulkCount">0</span>)</button>
    </div>`;
  }

  function bindBulkEvents(root, proposals) {
    const selAllCb = root.querySelector('#feBulkSelectLow');
    const approveBtn = root.querySelector('#feBulkApprove');
    if (!selAllCb) return;

    selAllCb.addEventListener('change', () => {
      const lowIds = proposals.filter(p => (p.risk_level || '').toLowerCase() === 'low').map(p => p.id);
      if (selAllCb.checked) {
        lowIds.forEach(id => selectedIds.add(id));
      } else {
        lowIds.forEach(id => selectedIds.delete(id));
      }
      syncCheckboxes(root);
    });

    approveBtn.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      approveBtn.disabled = true;
      approveBtn.textContent = 'Approving...';
      try {
        await FE.post('/proposals/approve-batch', { ids: Array.from(selectedIds) });
        FE.toast(`${selectedIds.size} proposal(s) approved`, 'success');
        selectedIds.clear();
        refresh();
      } catch (e) {
        FE.toast('Bulk approve failed: ' + (e.message || e), 'error');
        approveBtn.disabled = false;
        approveBtn.textContent = 'Approve Selected';
      }
    });
  }

  function syncCheckboxes(root) {
    root.querySelectorAll('.fe-proposal-cb').forEach(cb => {
      cb.checked = selectedIds.has(Number(cb.dataset.id));
    });
    const countEl = root.querySelector('#feBulkCount');
    const btn = root.querySelector('#feBulkApprove');
    if (countEl) countEl.textContent = selectedIds.size;
    if (btn) btn.disabled = selectedIds.size === 0;
  }

  // ---- Proposal cards ----

  function renderProposalList(proposals) {
    if (!proposals.length) {
      return `<div class="fe-empty">No ${activeTab} proposals</div>`;
    }
    return `<div class="fe-proposal-list">${proposals.map(p => renderProposalCard(p)).join('')}</div>`;
  }

  function renderProposalCard(p) {
    const riskLower = (p.risk_level || 'low').toLowerCase();
    const riskColors = { low: '#00b894', medium: '#fdcb6e', high: '#d63031' };
    const riskColor = riskColors[riskLower] || '#636e72';
    const delta = p.expected_impact_delta != null ? (p.expected_impact_delta > 0 ? '+' : '') + FE.formatPct(p.expected_impact_delta) : '--';
    const age = p.generated_at ? FE.timeAgo(p.generated_at) : '';

    return `<div class="fe-proposal-card" data-id="${p.id}">
      <div class="fe-proposal-left">
        ${activeTab === 'pending' ? `<input type="checkbox" class="fe-proposal-cb" data-id="${p.id}" ${selectedIds.has(p.id) ? 'checked' : ''}>` : ''}
        ${typeBadge(p.proposal_type)}
        <span class="fe-proposal-title">${esc(p.title)}</span>
      </div>
      <div class="fe-proposal-center">
        <span class="fe-proposal-desc">${esc(p.description || '')}</span>
        <span class="fe-proposal-impact">${esc(p.expected_impact_metric || '')} <strong>${delta}</strong></span>
      </div>
      <div class="fe-proposal-right">
        ${FE.riskBadge(riskLower)}
        <span class="fe-proposal-age">${age}</span>
        <button class="fe-btn fe-btn-sm fe-btn-outline" data-review="${p.id}">Review</button>
      </div>
    </div>`;
  }

  function bindCardEvents(root, proposals) {
    // Checkbox toggles
    root.querySelectorAll('.fe-proposal-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = Number(cb.dataset.id);
        if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
        syncCheckboxes(root);
      });
    });

    // Review buttons
    root.querySelectorAll('[data-review]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.review);
        const p = proposals.find(x => x.id === id);
        if (p) openReviewDrawer(p);
      });
    });
  }

  // ---- Review Drawer ----

  function openReviewDrawer(p) {
    const riskLower = (p.risk_level || 'low').toLowerCase();
    const delta = p.expected_impact_delta != null ? (p.expected_impact_delta > 0 ? '+' : '') + FE.formatPct(p.expected_impact_delta) : '--';

    let evidenceHtml = '';
    try {
      const ev = typeof p.evidence_json === 'string' ? JSON.parse(p.evidence_json) : (p.evidence_json || []);
      if (Array.isArray(ev) && ev.length) {
        evidenceHtml = `<div class="fe-drawer-section">
          <h4 class="fe-drawer-toggle fe-expandable" data-target="feEvidenceList">Evidence Chain <span class="fe-caret">&#9656;</span></h4>
          <ul id="feEvidenceList" class="fe-hidden fe-evidence-list">
            ${ev.map((item, i) => `<li class="fe-evidence-item"><strong>${i + 1}.</strong> ${esc(typeof item === 'string' ? item : (item.text || item.summary || JSON.stringify(item)))}</li>`).join('')}
          </ul>
        </div>`;
      }
    } catch (_) { /* ignore parse errors */ }

    // Impact bar visual
    const absDelta = Math.abs(p.expected_impact_delta || 0);
    const barWidth = Math.min(absDelta * 100, 100);
    const barColor = (p.expected_impact_delta || 0) >= 0 ? '#00b894' : '#d63031';

    const html = `<div class="fe-drawer-content">
      <div class="fe-drawer-header">
        ${typeBadge(p.proposal_type)}
        <h3>${esc(p.title)}</h3>
      </div>

      <div class="fe-drawer-section">
        <h4 class="fe-drawer-toggle fe-expandable" data-target="feRationale">Rationale <span class="fe-caret">&#9656;</span></h4>
        <div id="feRationale" class="fe-hidden">
          <p class="fe-rationale-text">${esc(p.rationale || 'No rationale provided.')}</p>
        </div>
      </div>

      ${evidenceHtml}

      <div class="fe-drawer-section">
        <h4>Expected Impact</h4>
        <div class="fe-impact-row">
          <span class="fe-impact-metric">${esc(p.expected_impact_metric || 'N/A')}</span>
          <span class="fe-impact-delta" style="color:${barColor}">${delta}</span>
        </div>
        <div class="fe-impact-bar-bg">
          <div class="fe-impact-bar" style="width:${barWidth}%;background:${barColor}"></div>
        </div>
      </div>

      <div class="fe-drawer-section">
        <h4>Risk Assessment</h4>
        <div class="fe-risk-row">
          ${FE.riskBadge(riskLower)}
          <span>${p.is_reversible ? 'Reversible' : 'Irreversible'}</span>
        </div>
      </div>

      <div class="fe-drawer-actions">
        <button class="fe-btn fe-btn-green" id="feDrawerApprove">Approve</button>
        <div class="fe-reject-group">
          <button class="fe-btn fe-btn-red" id="feDrawerReject">Reject</button>
          <div class="fe-reject-dropdown fe-hidden" id="feRejectDropdown">
            <button class="fe-reject-reason" data-reason="Not relevant">Not relevant</button>
            <button class="fe-reject-reason" data-reason="Too risky">Too risky</button>
            <button class="fe-reject-reason" data-reason="Timing wrong">Timing wrong</button>
            <button class="fe-reject-reason" data-reason="Other">Other</button>
          </div>
        </div>
        <button class="fe-btn fe-btn-gray" id="feDrawerDefer">Defer</button>
      </div>
    </div>`;

    FE.openDrawer(html);

    // Expandable toggles
    setTimeout(() => {
      document.querySelectorAll('.fe-drawer-toggle').forEach(tog => {
        tog.addEventListener('click', () => {
          const target = document.getElementById(tog.dataset.target);
          if (target) {
            target.classList.toggle('fe-hidden');
            const caret = tog.querySelector('.fe-caret');
            if (caret) caret.textContent = target.classList.contains('fe-hidden') ? '\u25B8' : '\u25BE';
          }
        });
      });

      // Approve
      const approveBtn = document.getElementById('feDrawerApprove');
      if (approveBtn) {
        approveBtn.addEventListener('click', async () => {
          approveBtn.disabled = true;
          approveBtn.textContent = 'Approving...';
          try {
            await FE.post(`/proposals/${p.id}/approve`);
            FE.toast('Proposal approved', 'success');
            FE.closeDrawer();
            refresh();
          } catch (e) {
            FE.toast('Approve failed: ' + (e.message || e), 'error');
            approveBtn.disabled = false;
            approveBtn.textContent = 'Approve';
          }
        });
      }

      // Reject
      const rejectBtn = document.getElementById('feDrawerReject');
      const dropdown = document.getElementById('feRejectDropdown');
      if (rejectBtn && dropdown) {
        rejectBtn.addEventListener('click', () => {
          dropdown.classList.toggle('fe-hidden');
        });
        dropdown.querySelectorAll('.fe-reject-reason').forEach(rb => {
          rb.addEventListener('click', async () => {
            dropdown.classList.add('fe-hidden');
            rejectBtn.disabled = true;
            rejectBtn.textContent = 'Rejecting...';
            try {
              await FE.post(`/proposals/${p.id}/reject`, { reason: rb.dataset.reason });
              FE.toast('Proposal rejected', 'success');
              FE.closeDrawer();
              refresh();
            } catch (e) {
              FE.toast('Reject failed: ' + (e.message || e), 'error');
              rejectBtn.disabled = false;
              rejectBtn.textContent = 'Reject';
            }
          });
        });
      }

      // Defer — just close drawer
      const deferBtn = document.getElementById('feDrawerDefer');
      if (deferBtn) {
        deferBtn.addEventListener('click', () => {
          FE.toast('Proposal deferred', 'info');
          FE.closeDrawer();
        });
      }
    }, 50);
  }

  // ---- Applied Changes Table ----

  function renderChangesTable(changes) {
    if (!changes.length) return '<div class="fe-empty" style="margin-top:24px">No applied changes yet</div>';

    const rows = changes.map(c => {
      const before = parseMetric(c.before_state_json);
      const after = parseMetric(c.after_state_json);
      const improv = before !== null && after !== null && before !== 0
        ? FE.formatPct((after - before) / Math.abs(before))
        : '--';
      const improvColor = after >= before ? '#00b894' : '#d63031';

      return `<tr>
        <td>${FE.formatDate(c.applied_at)}</td>
        <td>${esc(c.change_type || '')}</td>
        <td>${esc(c.change_description || '')}</td>
        <td>${before !== null ? before.toFixed(2) : '--'}</td>
        <td>${after !== null ? after.toFixed(2) : '--'}</td>
        <td style="color:${improvColor}">${improv}</td>
        <td>${c.was_rolled_back ? '<span class="fe-badge" style="background:#d6303122;color:#d63031">Rolled back</span>'
          : `<button class="fe-btn fe-btn-sm fe-btn-red fe-rollback-btn" data-pid="${c.proposal_id}">Rollback</button>`}</td>
      </tr>`;
    }).join('');

    return `<div class="fe-changes-section">
      <h3 class="fe-section-title">Applied Changes</h3>
      <table class="fe-table">
        <thead><tr>
          <th>Date</th><th>Type</th><th>Description</th><th>Before</th><th>After</th><th>Improvement</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  function parseMetric(json) {
    if (!json) return null;
    try {
      const obj = typeof json === 'string' ? JSON.parse(json) : json;
      if (typeof obj === 'number') return obj;
      if (obj.value != null) return Number(obj.value);
      const keys = Object.keys(obj);
      if (keys.length) return Number(obj[keys[0]]);
    } catch (_) {}
    return null;
  }

  // After rendering changes table, bind rollback buttons
  const origRefresh = refresh;
  async function refreshWithRollback() {
    await origRefresh.call(this);
    const root = document.getElementById('feView-proposals');
    if (!root) return;
    root.querySelectorAll('.fe-rollback-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pid = btn.dataset.pid;
        if (!confirm('Are you sure you want to rollback this change? This will revert to the previous state.')) return;
        btn.disabled = true;
        btn.textContent = 'Rolling back...';
        try {
          await FE.post(`/proposals/${pid}/rollback`);
          FE.toast('Change rolled back successfully', 'success');
          refresh();
        } catch (e) {
          FE.toast('Rollback failed: ' + (e.message || e), 'error');
          btn.disabled = false;
          btn.textContent = 'Rollback';
        }
      });
    });
  }

  // Escape HTML
  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // Register
  FE.refresh_proposals = refreshWithRollback;
})();
