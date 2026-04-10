/* ============================================================================
   fe-memory.js — Knowledge Base sub-tab for Feedback Engine
   Renders into #feView-memory, registers as FE.refresh_memory
   ============================================================================ */
(function () {
  'use strict';

  const CONTEXT_COLORS = {
    market: '#6c5ce7',
    creative: '#00b894',
    competitor: '#e17055',
    timing: '#0984e3',
    audience: '#fdcb6e',
    budget: '#a29bfe',
    platform: '#00cec9'
  };

  function ctxColor(ctx) {
    return CONTEXT_COLORS[(ctx || '').toLowerCase()] || '#636e72';
  }

  async function refresh() {
    const root = document.getElementById('feView-memory');
    if (!root) return;
    root.innerHTML = '<div class="fe-loading">Loading knowledge base...</div>';

    try {
      const [episodicRes, semanticRes, sourcesRes] = await Promise.all([
        FE.fetch('/memory/episodic?days=90'),
        FE.fetch('/memory/semantic'),
        FE.fetch('/knowledge/sources')
      ]);

      const episodic = Array.isArray(episodicRes) ? episodicRes : [];
      const semantic = Array.isArray(semanticRes) ? semanticRes : [];
      const sources = Array.isArray(sourcesRes) ? sourcesRes : [];

      root.innerHTML = renderSearchBar() +
        '<div class="fe-memory-panels">' +
          renderEpisodicPanel(episodic) +
          renderSemanticPanel(semantic) +
          renderSourcesPanel(sources) +
        '</div>';

      bindSearchEvents(root);
      bindEpisodicFilters(root, episodic);
      bindSemanticSort(root, semantic);
      bindChallengeButtons(root);
      bindSourceEvents(root, sources);
    } catch (e) {
      root.innerHTML = `<div class="fe-error">Failed to load knowledge base: ${e.message || e}</div>`;
    }
  }

  // ---- Search Bar ----

  function renderSearchBar() {
    return `<div class="fe-search-bar">
      <input type="text" id="feMemorySearch" class="fe-input" placeholder="Search across all memory...">
      <button class="fe-btn fe-btn-primary" id="feMemorySearchBtn">Search</button>
    </div>`;
  }

  function bindSearchEvents(root) {
    const input = root.querySelector('#feMemorySearch');
    const btn = root.querySelector('#feMemorySearchBtn');
    if (!input || !btn) return;

    async function doSearch() {
      const q = input.value.trim();
      if (!q) return;
      btn.disabled = true;
      btn.textContent = 'Searching...';
      try {
        const res = await FE.fetch(`/memory/search?q=${encodeURIComponent(q)}`);
        const results = Array.isArray(res) ? res : [];
        showSearchResults(q, results);
      } catch (e) {
        FE.toast('Search failed: ' + (e.message || e), 'error');
      }
      btn.disabled = false;
      btn.textContent = 'Search';
    }

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  }

  function showSearchResults(query, results) {
    let html = `<div class="fe-search-results">
      <h3>Search results for "${esc(query)}" (${results.length} found)</h3>`;
    if (!results.length) {
      html += '<p class="fe-empty">No results found</p>';
    } else {
      html += '<div class="fe-search-list">';
      results.forEach(r => {
        const type = r.type || r.memory_type || 'unknown';
        const text = r.text || r.observation || r.rule_text || r.description || JSON.stringify(r);
        const conf = r.confidence_pct != null ? `<span class="fe-conf-badge">${r.confidence_pct}%</span>` : '';
        html += `<div class="fe-search-item">
          <span class="fe-badge" style="background:#6c5ce722;color:#6c5ce7">${esc(type)}</span>
          ${conf}
          <span class="fe-search-text">${esc(text)}</span>
        </div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    FE.openModal(html);
  }

  // ---- Panel A: Episodic Timeline ----

  function renderEpisodicPanel(items) {
    const ctxTypes = [...new Set(items.map(i => i.context_type).filter(Boolean))];
    const ctxOptions = ctxTypes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

    return `<div class="fe-panel fe-panel-episodic">
      <div class="fe-panel-header">
        <h3>Episodic Memory</h3>
        <div class="fe-panel-filters">
          <select id="feEpiDays" class="fe-select">
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90" selected>90 days</option>
          </select>
          <select id="feEpiCtx" class="fe-select">
            <option value="">All contexts</option>
            ${ctxOptions}
          </select>
        </div>
      </div>
      <div class="fe-timeline-scroll" id="feEpiList">
        ${renderEpisodicItems(items)}
      </div>
    </div>`;
  }

  function renderEpisodicItems(items) {
    if (!items.length) return '<div class="fe-empty">No episodic memories</div>';
    return items.map(item => {
      const color = ctxColor(item.context_type);
      const confPct = item.confidence_pct != null ? item.confidence_pct : 0;
      let adCount = 0;
      try {
        const ids = item.supporting_ad_ids ? (typeof item.supporting_ad_ids === 'string' ? JSON.parse(item.supporting_ad_ids) : item.supporting_ad_ids) : [];
        adCount = Array.isArray(ids) ? ids.length : 0;
      } catch (_) {
        adCount = item.supporting_ad_ids ? String(item.supporting_ad_ids).split(',').length : 0;
      }

      return `<div class="fe-epi-item">
        <div class="fe-epi-date-chip" style="background:${color}22;color:${color}">${FE.formatDate(item.event_date)}</div>
        <span class="fe-badge fe-epi-ctx" style="background:${color}18;color:${color};border:1px solid ${color}33">${esc(item.context_type || 'general')}</span>
        <p class="fe-epi-text">${esc(item.observation)}</p>
        <div class="fe-epi-meta">
          <div class="fe-confidence-bar-wrap" title="Confidence: ${confPct}%">
            <div class="fe-confidence-bar" style="width:${confPct}%;background:${confPct > 70 ? '#00b894' : confPct > 40 ? '#fdcb6e' : '#d63031'}"></div>
          </div>
          <span class="fe-epi-ads">${adCount} ad${adCount !== 1 ? 's' : ''}</span>
        </div>
      </div>`;
    }).join('');
  }

  function bindEpisodicFilters(root, allItems) {
    const daysSelect = root.querySelector('#feEpiDays');
    const ctxSelect = root.querySelector('#feEpiCtx');
    const list = root.querySelector('#feEpiList');
    if (!daysSelect || !ctxSelect || !list) return;

    function filterAndRender() {
      const days = Number(daysSelect.value);
      const ctx = ctxSelect.value;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const filtered = allItems.filter(item => {
        if (item.event_date && new Date(item.event_date) < cutoff) return false;
        if (ctx && item.context_type !== ctx) return false;
        return true;
      });
      list.innerHTML = renderEpisodicItems(filtered);
    }

    daysSelect.addEventListener('change', filterAndRender);
    ctxSelect.addEventListener('change', filterAndRender);
  }

  // ---- Panel B: Semantic Rules ----

  function renderSemanticPanel(rules) {
    return `<div class="fe-panel fe-panel-semantic">
      <div class="fe-panel-header">
        <h3>Learned Rules</h3>
        <select id="feSemanticSort" class="fe-select">
          <option value="confidence">Confidence</option>
          <option value="evidence">Evidence count</option>
          <option value="recency">Recency</option>
        </select>
      </div>
      <div class="fe-semantic-grid" id="feSemanticGrid">
        ${renderSemanticCards(rules)}
      </div>
    </div>`;
  }

  function renderSemanticCards(rules) {
    if (!rules.length) return '<div class="fe-empty">No learned rules</div>';
    return rules.map(r => {
      const confPct = r.confidence_pct != null ? r.confidence_pct : 0;
      const confColor = confPct > 70 ? '#00b894' : confPct > 40 ? '#fdcb6e' : '#d63031';
      const validated = r.last_validated ? FE.timeAgo(r.last_validated) : 'never';

      return `<div class="fe-semantic-card">
        <p class="fe-semantic-rule">${esc(r.rule_text)}</p>
        <div class="fe-semantic-conf">
          <span class="fe-semantic-conf-label">${confPct}%</span>
          <div class="fe-progress-bar">
            <div class="fe-progress-fill" style="width:${confPct}%;background:${confColor}"></div>
          </div>
        </div>
        <div class="fe-semantic-meta">
          <span class="fe-badge" style="background:#0984e322;color:#0984e3">${r.evidence_count || 0} evidence</span>
          <span class="fe-semantic-validated">Validated ${validated}</span>
        </div>
        <button class="fe-btn fe-btn-sm fe-btn-outline fe-challenge-btn" data-rule-id="${r.id}">Challenge</button>
      </div>`;
    }).join('');
  }

  function bindSemanticSort(root, allRules) {
    const sortSelect = root.querySelector('#feSemanticSort');
    const grid = root.querySelector('#feSemanticGrid');
    if (!sortSelect || !grid) return;

    sortSelect.addEventListener('change', () => {
      const sorted = [...allRules];
      const mode = sortSelect.value;
      if (mode === 'confidence') {
        sorted.sort((a, b) => (b.confidence_pct || 0) - (a.confidence_pct || 0));
      } else if (mode === 'evidence') {
        sorted.sort((a, b) => (b.evidence_count || 0) - (a.evidence_count || 0));
      } else {
        sorted.sort((a, b) => {
          const da = a.last_validated ? new Date(a.last_validated).getTime() : 0;
          const db = b.last_validated ? new Date(b.last_validated).getTime() : 0;
          return db - da;
        });
      }
      grid.innerHTML = renderSemanticCards(sorted);
      bindChallengeButtons(root);
    });
  }

  function bindChallengeButtons(root) {
    root.querySelectorAll('.fe-challenge-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Queuing...';
        try {
          await FE.post('/hypotheses/generate', { rule_id: btn.dataset.ruleId });
          FE.toast('Counter-hypothesis queued', 'success');
        } catch (e) {
          FE.toast('Challenge failed: ' + (e.message || e), 'error');
        }
        btn.disabled = false;
        btn.textContent = 'Challenge';
      });
    });
  }

  // ---- Panel C: Knowledge Sources ----

  function renderSourcesPanel(sources) {
    return `<div class="fe-panel fe-panel-sources">
      <div class="fe-panel-header">
        <h3>Sources</h3>
        <button class="fe-btn fe-btn-primary fe-btn-sm" id="feAddSource">+ Add Source</button>
      </div>
      <div class="fe-sources-scroll">
        <table class="fe-table fe-table-compact">
          <thead><tr>
            <th>Name</th><th>Type</th><th>Last Crawled</th><th>Items</th><th>Health</th><th>Active</th>
          </tr></thead>
          <tbody id="feSourcesTbody">
            ${renderSourceRows(sources)}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function renderSourceRows(sources) {
    if (!sources.length) return '<tr><td colspan="6" class="fe-empty">No sources configured</td></tr>';
    return sources.map(s => {
      const health = getSourceHealth(s);
      const healthDot = `<span class="fe-health-dot" style="background:${health.color}" title="${health.label}"></span> ${health.label}`;
      const checked = s.is_active ? 'checked' : '';

      return `<tr>
        <td>${esc(s.source_name)}</td>
        <td><span class="fe-badge" style="background:#63727222;color:#b2bec3">${esc(s.source_type || 'web')}</span></td>
        <td>${s.last_crawled_at ? FE.timeAgo(s.last_crawled_at) : 'Never'}</td>
        <td>${s.last_item_count || 0}</td>
        <td>${healthDot}</td>
        <td><label class="fe-switch">
          <input type="checkbox" class="fe-source-toggle" data-id="${s.id}" data-name="${esc(s.source_name)}" ${checked}>
          <span class="fe-switch-slider"></span>
        </label></td>
      </tr>`;
    }).join('');
  }

  function getSourceHealth(s) {
    if (!s.last_crawled_at) return { color: '#d63031', label: 'Never crawled' };
    const freqMs = (s.crawl_frequency_hours || 6) * 3600000;
    const elapsed = Date.now() - new Date(s.last_crawled_at).getTime();
    if (elapsed < freqMs * 2) return { color: '#00b894', label: 'Healthy' };
    if (elapsed < freqMs * 3) return { color: '#fdcb6e', label: 'Overdue' };
    return { color: '#d63031', label: 'Critical' };
  }

  function bindSourceEvents(root, sources) {
    // Active toggle
    root.querySelectorAll('.fe-source-toggle').forEach(tog => {
      tog.addEventListener('change', async () => {
        const id = Number(tog.dataset.id);
        const src = sources.find(s => s.id === id);
        if (!src) return;
        try {
          await FE.put('/knowledge/sources', { id: src.id, source_name: src.source_name, source_url: src.source_url, source_type: src.source_type, crawl_frequency_hours: src.crawl_frequency_hours, is_active: tog.checked ? 1 : 0 });
          FE.toast(`${src.source_name} ${tog.checked ? 'activated' : 'deactivated'}`, 'success');
        } catch (e) {
          FE.toast('Toggle failed: ' + (e.message || e), 'error');
          tog.checked = !tog.checked;
        }
      });
    });

    // Add source button
    const addBtn = root.querySelector('#feAddSource');
    if (addBtn) {
      addBtn.addEventListener('click', () => openAddSourceModal());
    }
  }

  function openAddSourceModal() {
    const html = `<div class="fe-modal-content">
      <h3>Add Knowledge Source</h3>
      <div class="fe-form">
        <div class="fe-form-group">
          <label class="fe-label">Source Name</label>
          <input type="text" id="feNewSrcName" class="fe-input" placeholder="e.g. AdAge RSS">
        </div>
        <div class="fe-form-group">
          <label class="fe-label">Source URL</label>
          <input type="text" id="feNewSrcUrl" class="fe-input" placeholder="https://...">
        </div>
        <div class="fe-form-group">
          <label class="fe-label">Source Type</label>
          <select id="feNewSrcType" class="fe-select">
            <option value="rss">RSS Feed</option>
            <option value="web">Web Page</option>
            <option value="api">API Endpoint</option>
          </select>
        </div>
        <div class="fe-form-group">
          <label class="fe-label">Crawl Frequency</label>
          <select id="feNewSrcFreq" class="fe-select">
            <option value="1">Every hour</option>
            <option value="3">Every 3 hours</option>
            <option value="6" selected>Every 6 hours</option>
            <option value="12">Every 12 hours</option>
            <option value="24">Daily</option>
          </select>
        </div>
        <div class="fe-form-actions">
          <button class="fe-btn fe-btn-primary" id="feNewSrcSave">Add Source</button>
          <button class="fe-btn fe-btn-gray" id="feNewSrcCancel">Cancel</button>
        </div>
      </div>
    </div>`;

    FE.openModal(html);

    setTimeout(() => {
      const saveBtn = document.getElementById('feNewSrcSave');
      const cancelBtn = document.getElementById('feNewSrcCancel');

      if (cancelBtn) cancelBtn.addEventListener('click', () => FE.closeModal());
      if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
          const name = (document.getElementById('feNewSrcName').value || '').trim();
          const url = (document.getElementById('feNewSrcUrl').value || '').trim();
          const type = document.getElementById('feNewSrcType').value;
          const freq = Number(document.getElementById('feNewSrcFreq').value);

          if (!name || !url) {
            FE.toast('Name and URL are required', 'error');
            return;
          }

          saveBtn.disabled = true;
          saveBtn.textContent = 'Adding...';
          try {
            await FE.put('/knowledge/sources', {
              source_name: name,
              source_url: url,
              source_type: type,
              crawl_frequency_hours: freq,
              is_active: 1
            });
            FE.toast('Source added successfully', 'success');
            FE.closeModal();
            refresh();
          } catch (e) {
            FE.toast('Failed to add source: ' + (e.message || e), 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Add Source';
          }
        });
      }
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
  FE.refresh_memory = refresh;
})();
