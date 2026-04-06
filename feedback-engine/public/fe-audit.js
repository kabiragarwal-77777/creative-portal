/* ============================================================================
   fe-audit.js — Accuracy Audit sub-tab for Feedback Engine
   Renders into #feView-audit, registers as FE.refresh_audit
   ============================================================================ */
(function () {
  'use strict';

  const META_COLOR = '#a29bfe';
  const GOOGLE_COLOR = '#74b9ff';
  const HYPO_TABS = ['all', 'pending', 'supported', 'rejected', 'inconclusive'];
  const HYPO_LABELS = { all: 'All', pending: 'Pending', supported: 'Supported', rejected: 'Rejected', inconclusive: 'Inconclusive' };

  let hypoFilter = 'all';

  async function refresh() {
    const root = document.getElementById('feView-audit');
    if (!root) return;
    root.innerHTML = '<div class="fe-loading">Loading audit data...</div>';

    try {
      const [predRes, reportRes, historyRes, hypoRes] = await Promise.all([
        FE.fetch('/watcher/predictions'),
        FE.fetch('/audit/report'),
        FE.fetch('/audit/history'),
        FE.fetch('/hypotheses')
      ]);

      const predictions = Array.isArray(predRes) ? predRes : [];
      const report = (reportRes && !reportRes.error) ? reportRes : {};
      const history = Array.isArray(historyRes) ? historyRes : [];
      const hypotheses = Array.isArray(hypoRes) ? hypoRes : [];

      root.innerHTML =
        renderAccuracyDashboard(predictions) +
        renderSignalPerformance(report, history) +
        renderHypothesisLab(hypotheses);

      bindRunAudit(root);
      bindHypoTabs(root, hypotheses);
      bindHypoActions(root, hypotheses);
    } catch (e) {
      root.innerHTML = `<div class="fe-error">Failed to load audit: ${e.message || e}</div>`;
    }
  }

  // ======================================================================
  //  SECTION 1 — Prediction Accuracy Dashboard
  // ======================================================================

  function renderAccuracyDashboard(predictions) {
    const metaPreds = predictions.filter(p => p.source === 'meta');
    const googlePreds = predictions.filter(p => p.source === 'google');

    // Compute rolling 7-day accuracy series
    const metaSeries = rollingAccuracy(metaPreds, 7);
    const googleSeries = rollingAccuracy(googlePreds, 7);

    // Breakdown stats
    const metaStats = computeBreakdown(metaPreds);
    const googleStats = computeBreakdown(googlePreds);

    // Worst predictions
    const worst = [...predictions]
      .filter(p => p.error_d7 != null)
      .sort((a, b) => Math.abs(b.error_d7) - Math.abs(a.error_d7))
      .slice(0, 10);

    return `<div class="fe-audit-section">
      <div class="fe-section-header">
        <h3>Prediction Accuracy</h3>
        <button class="fe-btn fe-btn-primary fe-btn-sm" id="feRunAudit">Run Audit</button>
      </div>
      ${renderAccuracyChart(metaSeries, googleSeries)}
      ${renderBreakdownTable(metaStats, googleStats)}
      ${renderWorstTable(worst)}
    </div>`;
  }

  function rollingAccuracy(preds, window) {
    // Group by date
    const byDate = {};
    preds.forEach(p => {
      const d = (p.checked_at || p.created_at || '').slice(0, 10);
      if (!d) return;
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(p);
    });
    const dates = Object.keys(byDate).sort();
    const series = [];
    for (let i = 0; i < dates.length; i++) {
      const windowDates = dates.slice(Math.max(0, i - window + 1), i + 1);
      let total = 0, accurate = 0;
      windowDates.forEach(d => {
        byDate[d].forEach(p => {
          total++;
          if (p.accuracy_tag === 'accurate') accurate++;
        });
      });
      series.push({ date: dates[i], pct: total ? (accurate / total) * 100 : 0 });
    }
    return series;
  }

  function renderAccuracyChart(metaSeries, googleSeries) {
    // Merge all dates
    const allDates = [...new Set([...metaSeries.map(s => s.date), ...googleSeries.map(s => s.date)])].sort();
    if (!allDates.length) return '<div class="fe-empty">No prediction data for chart</div>';

    const W = 700, H = 220, PAD_L = 45, PAD_R = 15, PAD_T = 15, PAD_B = 35;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;

    function xPos(i) { return PAD_L + (allDates.length > 1 ? (i / (allDates.length - 1)) * chartW : chartW / 2); }
    function yPos(v) { return PAD_T + chartH - (v / 100) * chartH; }

    function toPolyline(series) {
      const map = {};
      series.forEach(s => { map[s.date] = s.pct; });
      return allDates.map((d, i) => {
        const v = map[d] != null ? map[d] : null;
        return v != null ? `${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}` : null;
      }).filter(Boolean).join(' ');
    }

    // Y-axis gridlines
    let gridLines = '';
    for (let v = 0; v <= 100; v += 25) {
      const y = yPos(v);
      gridLines += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="#2d3436" stroke-width="0.5"/>`;
      gridLines += `<text x="${PAD_L - 5}" y="${y + 4}" fill="#636e72" font-size="10" text-anchor="end">${v}%</text>`;
    }

    // X-axis labels (show ~6 labels)
    let xLabels = '';
    const step = Math.max(1, Math.floor(allDates.length / 6));
    for (let i = 0; i < allDates.length; i += step) {
      const label = allDates[i].slice(5); // MM-DD
      xLabels += `<text x="${xPos(i)}" y="${H - 5}" fill="#636e72" font-size="10" text-anchor="middle">${label}</text>`;
    }

    return `<div class="fe-chart-container">
      <svg viewBox="0 0 ${W} ${H}" class="fe-accuracy-svg" preserveAspectRatio="xMidYMid meet">
        ${gridLines}
        ${xLabels}
        <polyline points="${toPolyline(metaSeries)}" fill="none" stroke="${META_COLOR}" stroke-width="2" stroke-linejoin="round"/>
        <polyline points="${toPolyline(googleSeries)}" fill="none" stroke="${GOOGLE_COLOR}" stroke-width="2" stroke-linejoin="round"/>
      </svg>
      <div class="fe-chart-legend">
        <span class="fe-legend-item"><span class="fe-legend-dot" style="background:${META_COLOR}"></span> Meta (7d rolling)</span>
        <span class="fe-legend-item"><span class="fe-legend-dot" style="background:${GOOGLE_COLOR}"></span> Google (7d rolling)</span>
      </div>
    </div>`;
  }

  function computeBreakdown(preds) {
    const total = preds.length;
    if (!total) return { total: 0, accurate: 0, over: 0, under: 0 };
    let accurate = 0, over = 0, under = 0;
    preds.forEach(p => {
      if (p.accuracy_tag === 'accurate') accurate++;
      else if (p.accuracy_tag === 'overestimate') over++;
      else if (p.accuracy_tag === 'underestimate') under++;
    });
    return {
      total,
      accurate: ((accurate / total) * 100).toFixed(1),
      over: ((over / total) * 100).toFixed(1),
      under: ((under / total) * 100).toFixed(1)
    };
  }

  function renderBreakdownTable(meta, google) {
    return `<table class="fe-table fe-table-compact" style="margin-top:12px">
      <thead><tr><th>Source</th><th>Total</th><th>Accurate %</th><th>Overestimate %</th><th>Underestimate %</th></tr></thead>
      <tbody>
        <tr><td><span class="fe-legend-dot" style="background:${META_COLOR};display:inline-block"></span> Meta</td>
          <td>${meta.total}</td><td>${meta.accurate}%</td><td>${meta.over}%</td><td>${meta.under}%</td></tr>
        <tr><td><span class="fe-legend-dot" style="background:${GOOGLE_COLOR};display:inline-block"></span> Google</td>
          <td>${google.total}</td><td>${google.accurate}%</td><td>${google.over}%</td><td>${google.under}%</td></tr>
      </tbody>
    </table>`;
  }

  function renderWorstTable(worst) {
    if (!worst.length) return '';
    const rows = worst.map(w => {
      const errPct = w.error_d7 != null ? (w.error_d7 * 100).toFixed(1) + '%' : '--';
      const errColor = Math.abs(w.error_d7 || 0) > 0.3 ? '#d63031' : '#fdcb6e';
      return `<tr>
        <td>${esc(w.ad_name || w.ad_id || '--')}</td>
        <td>${esc(w.source)}</td>
        <td>${w.predicted_roas_d7 != null ? w.predicted_roas_d7.toFixed(2) : '--'}</td>
        <td>${w.actual_roas_d7 != null ? w.actual_roas_d7.toFixed(2) : '--'}</td>
        <td style="color:${errColor}">${errPct}</td>
        <td>${FE.formatDate(w.checked_at || w.created_at)}</td>
      </tr>`;
    }).join('');

    return `<div class="fe-subsection">
      <h4>Worst Predictions (Top 10)</h4>
      <table class="fe-table fe-table-compact">
        <thead><tr><th>Ad ID</th><th>Source</th><th>Predicted</th><th>Actual</th><th>Error %</th><th>Date</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  function bindRunAudit(root) {
    const btn = root.querySelector('#feRunAudit');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Running...';
      try {
        await FE.post('/audit/run');
        FE.toast('Audit completed', 'success');
        refresh();
      } catch (e) {
        FE.toast('Audit failed: ' + (e.message || e), 'error');
        btn.disabled = false;
        btn.textContent = 'Run Audit';
      }
    });
  }

  // ======================================================================
  //  SECTION 2 — Signal Performance
  // ======================================================================

  function renderSignalPerformance(report, history) {
    let currentWeights = {};
    let proposedWeights = {};
    try {
      currentWeights = report.current_weights_json
        ? (typeof report.current_weights_json === 'string' ? JSON.parse(report.current_weights_json) : report.current_weights_json)
        : {};
    } catch (_) {}
    try {
      proposedWeights = report.proposed_weights_json
        ? (typeof report.proposed_weights_json === 'string' ? JSON.parse(report.proposed_weights_json) : report.proposed_weights_json)
        : {};
    } catch (_) {}

    const signals = [...new Set([...Object.keys(currentWeights), ...Object.keys(proposedWeights)])];
    const hasProposed = Object.keys(proposedWeights).length > 0;
    const maxW = Math.max(1, ...signals.map(s => Math.max(currentWeights[s] || 0, proposedWeights[s] || 0)));

    let barsHtml = '';
    if (!signals.length) {
      barsHtml = '<div class="fe-empty">No signal weights available. Run an audit first.</div>';
    } else {
      barsHtml = signals.map(s => {
        const cur = currentWeights[s] || 0;
        const prop = proposedWeights[s] || 0;
        const curW = (cur / maxW) * 100;
        const propW = (prop / maxW) * 100;

        let bar = `<div class="fe-signal-row">
          <span class="fe-signal-name">${esc(s)}</span>
          <div class="fe-signal-bars">
            <div class="fe-signal-bar-wrap">
              <div class="fe-signal-bar" style="width:${curW}%;background:${META_COLOR}" title="Current: ${cur.toFixed(3)}"></div>
              <span class="fe-signal-val">${cur.toFixed(3)}</span>
            </div>`;
        if (hasProposed) {
          const delta = prop - cur;
          const deltaColor = delta > 0 ? '#00b894' : delta < 0 ? '#d63031' : '#636e72';
          bar += `<div class="fe-signal-bar-wrap fe-signal-proposed">
              <div class="fe-signal-bar" style="width:${propW}%;background:#fdcb6e" title="Proposed: ${prop.toFixed(3)}"></div>
              <span class="fe-signal-val">${prop.toFixed(3)} <span style="color:${deltaColor}">(${delta >= 0 ? '+' : ''}${delta.toFixed(3)})</span></span>
            </div>`;
        }
        bar += `</div></div>`;
        return bar;
      }).join('');
    }

    // Weight history
    let historyHtml = '';
    if (history.length > 1) {
      historyHtml = renderWeightHistory(history, signals);
    }

    const legendHtml = hasProposed
      ? `<div class="fe-chart-legend" style="margin-top:8px">
          <span class="fe-legend-item"><span class="fe-legend-dot" style="background:${META_COLOR}"></span> Current</span>
          <span class="fe-legend-item"><span class="fe-legend-dot" style="background:#fdcb6e"></span> Proposed</span>
        </div>`
      : '';

    return `<div class="fe-audit-section">
      <h3>Signal Performance</h3>
      <div class="fe-signal-chart">${barsHtml}</div>
      ${legendHtml}
      ${historyHtml}
    </div>`;
  }

  function renderWeightHistory(history, signals) {
    // Show a small table of how weights changed across audits
    const recent = history.slice(-5);
    const headers = recent.map(h => `<th>${FE.formatDate(h.audit_date || h.created_at)}</th>`).join('');

    const rows = signals.map(s => {
      const cells = recent.map(h => {
        let w = {};
        try {
          w = h.current_weights_json
            ? (typeof h.current_weights_json === 'string' ? JSON.parse(h.current_weights_json) : h.current_weights_json)
            : {};
        } catch (_) {}
        const v = w[s];
        return `<td>${v != null ? v.toFixed(3) : '--'}</td>`;
      }).join('');
      return `<tr><td class="fe-signal-name-cell">${esc(s)}</td>${cells}</tr>`;
    }).join('');

    return `<div class="fe-subsection">
      <h4>Weight History</h4>
      <div class="fe-table-scroll">
        <table class="fe-table fe-table-compact">
          <thead><tr><th>Signal</th>${headers}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  }

  // ======================================================================
  //  SECTION 3 — Hypothesis Lab
  // ======================================================================

  function renderHypothesisLab(hypotheses) {
    return `<div class="fe-audit-section">
      <h3>Hypothesis Lab</h3>
      ${renderHypoTabs()}
      <div id="feHypoList">
        ${renderHypoCards(filterHypotheses(hypotheses))}
      </div>
    </div>`;
  }

  function renderHypoTabs() {
    return `<div class="fe-tab-bar fe-tab-bar-sm">${HYPO_TABS.map(t =>
      `<button class="fe-tab-btn fe-tab-sm ${t === hypoFilter ? 'fe-tab-active' : ''}" data-hypo-tab="${t}">${HYPO_LABELS[t]}</button>`
    ).join('')}</div>`;
  }

  function filterHypotheses(hypotheses) {
    if (hypoFilter === 'all') return hypotheses;
    return hypotheses.filter(h => {
      const st = (h.status || '').toLowerCase();
      if (hypoFilter === 'supported') return st === 'completed' && hasResult(h, 'supported');
      if (hypoFilter === 'rejected') return st === 'rejected' || (st === 'completed' && hasResult(h, 'rejected'));
      if (hypoFilter === 'inconclusive') return st === 'completed' && hasResult(h, 'inconclusive');
      return st === hypoFilter;
    });
  }

  function hasResult(h, result) {
    // Check if hypothesis has a specific test result — approximate check
    if (h.latest_result === result) return true;
    if (h.result === result) return true;
    return false;
  }

  function renderHypoCards(hypotheses) {
    if (!hypotheses.length) return '<div class="fe-empty">No hypotheses match this filter</div>';
    return `<div class="fe-hypo-grid">${hypotheses.map(h => {
      const typeColors = { creative: '#00b894', timing: '#0984e3', competitor: '#e17055' };
      const tColor = typeColors[(h.type || '').toLowerCase()] || '#636e72';
      const status = h.status || 'pending';
      const resultSummary = h.evidence_summary || h.result || '';

      const isSupported = status === 'completed' && (h.latest_result === 'supported' || h.result === 'supported');

      return `<div class="fe-hypo-card">
        <div class="fe-hypo-header">
          <span class="fe-badge" style="background:${tColor}22;color:${tColor}">${esc(h.type || 'general')}</span>
          ${FE.statusBadge(status)}
        </div>
        <p class="fe-hypo-text">${esc(h.hypothesis_text)}</p>
        ${resultSummary ? `<p class="fe-hypo-result">${esc(resultSummary)}</p>` : ''}
        <div class="fe-hypo-actions">
          <button class="fe-btn fe-btn-sm fe-btn-outline fe-hypo-detail-btn" data-hypo-id="${h.id}">Details</button>
          ${isSupported ? `<button class="fe-btn fe-btn-sm fe-btn-green fe-hypo-propose-btn" data-hypo-id="${h.id}">Propose Integration</button>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  function bindHypoTabs(root, hypotheses) {
    root.querySelectorAll('[data-hypo-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        hypoFilter = btn.dataset.hypoTab;
        // Update active state
        root.querySelectorAll('[data-hypo-tab]').forEach(b => b.classList.remove('fe-tab-active'));
        btn.classList.add('fe-tab-active');
        const list = root.querySelector('#feHypoList');
        if (list) {
          list.innerHTML = renderHypoCards(filterHypotheses(hypotheses));
          bindHypoActions(root, hypotheses);
        }
      });
    });
  }

  function bindHypoActions(root, hypotheses) {
    // Detail buttons
    root.querySelectorAll('.fe-hypo-detail-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.hypoId;
        btn.disabled = true;
        try {
          const res = await FE.fetch(`/hypotheses/${id}/results`);
          const results = (res && !res.error) ? res : {};
          const h = hypotheses.find(x => String(x.id) === String(id));
          openHypoDrawer(h, results);
        } catch (e) {
          FE.toast('Failed to load results: ' + (e.message || e), 'error');
        }
        btn.disabled = false;
      });
    });

    // Propose integration buttons
    root.querySelectorAll('.fe-hypo-propose-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Generating...';
        try {
          await FE.post('/proposals/generate', { type: 'SCORING_FORMULA_UPDATE' });
          FE.toast('Proposal generated from hypothesis', 'success');
        } catch (e) {
          FE.toast('Failed: ' + (e.message || e), 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Propose Integration';
      });
    });
  }

  function openHypoDrawer(h, results) {
    if (!h) return;

    // Results can be a single object or array
    const testList = Array.isArray(results) ? results : (results.tests || [results]);

    let testsHtml = '';
    if (testList.length && testList[0] && testList[0].test_method) {
      testsHtml = `<div class="fe-drawer-section">
        <h4>Test Results</h4>
        <div class="fe-test-list">
          ${testList.map(t => {
            const resColor = t.result === 'supported' ? '#00b894' : t.result === 'rejected' ? '#d63031' : '#fdcb6e';
            return `<div class="fe-test-item">
              <div class="fe-test-header">
                <span class="fe-badge" style="background:${resColor}22;color:${resColor}">${esc(t.result || 'pending')}</span>
                <span>${esc(t.test_method || '')}</span>
                ${t.confidence_pct != null ? `<span class="fe-conf-badge">${t.confidence_pct.toFixed(0)}% conf</span>` : ''}
              </div>
              ${t.effect_size != null ? `<p class="fe-test-effect">Effect size: ${t.effect_size.toFixed(4)}</p>` : ''}
              ${t.evidence_summary ? `<p class="fe-test-evidence">${esc(t.evidence_summary)}</p>` : ''}
              ${t.completed_at ? `<p class="fe-test-date">${FE.formatDate(t.completed_at)}</p>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>`;
    } else {
      testsHtml = '<div class="fe-empty" style="margin:12px 0">No test results yet</div>';
    }

    // Parse data_used if present on first test
    let dataHtml = '';
    const firstTest = testList[0];
    if (firstTest && firstTest.data_used_json) {
      try {
        const data = typeof firstTest.data_used_json === 'string' ? JSON.parse(firstTest.data_used_json) : firstTest.data_used_json;
        if (data && typeof data === 'object') {
          const entries = Object.entries(data).slice(0, 10);
          dataHtml = `<div class="fe-drawer-section">
            <h4 class="fe-drawer-toggle fe-expandable" data-target="feHypoData">Data Used <span class="fe-caret">&#9656;</span></h4>
            <div id="feHypoData" class="fe-hidden">
              <table class="fe-table fe-table-compact">
                ${entries.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join('')}
              </table>
            </div>
          </div>`;
        }
      } catch (_) {}
    }

    const html = `<div class="fe-drawer-content">
      <div class="fe-drawer-header">
        <span class="fe-badge" style="background:#6c5ce722;color:#6c5ce7">${esc(h.type || 'general')}</span>
        ${FE.statusBadge(h.status || 'pending')}
        <h3>${esc(h.hypothesis_text)}</h3>
      </div>
      <div class="fe-drawer-section">
        <p><strong>Test method:</strong> ${esc(h.test_method || 'N/A')}</p>
        <p><strong>Success metric:</strong> ${esc(h.success_metric || 'N/A')}</p>
        ${h.generated_at ? `<p><strong>Generated:</strong> ${FE.formatDate(h.generated_at)}</p>` : ''}
        ${h.tested_at ? `<p><strong>Last tested:</strong> ${FE.formatDate(h.tested_at)}</p>` : ''}
      </div>
      ${testsHtml}
      ${dataHtml}
    </div>`;

    FE.openDrawer(html);

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
    }, 50);
  }

  // ---- Helpers ----

  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  // Register
  FE.refresh_audit = refresh;
})();
