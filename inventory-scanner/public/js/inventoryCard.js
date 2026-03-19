// Inventory Explorer
async function loadExplorer() {
  const search = document.getElementById('global-search')?.value || '';
  const category = document.getElementById('filter-category')?.value || '';
  const pricing = document.getElementById('filter-pricing')?.value || '';
  const fintech = document.getElementById('filter-fintech')?.value || '';
  const minCpm = document.getElementById('filter-min-cpm')?.value || '';
  const maxCpm = document.getElementById('filter-max-cpm')?.value || '';
  const minFit = document.getElementById('filter-min-fit')?.value || '';

  let params = new URLSearchParams();
  if (search) params.set('search', search);
  if (category) params.set('category', category);
  if (pricing) params.set('pricing_model', pricing);
  if (fintech) params.set('fintech_friendly', fintech);
  if (minCpm) params.set('min_cpm', minCpm);
  if (maxCpm) params.set('max_cpm', maxCpm);
  if (minFit) params.set('min_fit', minFit);

  const inventories = await api(`/inventories?${params.toString()}`);
  if (!inventories) return;

  state.inventories = inventories;

  // Sort
  const sortBy = document.getElementById('sort-by')?.value || 'target_audience_fit';
  inventories.sort((a, b) => {
    if (sortBy === 'min_cpm') return (a.min_cpm || 0) - (b.min_cpm || 0);
    if (sortBy === 'max_cpm') return (b.max_cpm || 0) - (a.max_cpm || 0);
    if (sortBy === 'estimated_monthly_reach') return (b.estimated_monthly_reach || 0) - (a.estimated_monthly_reach || 0);
    if (sortBy === 'competitor_count') return (b.competitor_count || 0) - (a.competitor_count || 0);
    if (sortBy === 'created_at') return new Date(b.created_at) - new Date(a.created_at);
    return (b.target_audience_fit || 0) - (a.target_audience_fit || 0);
  });

  renderInventoryGrid(inventories);
  renderInventoryTable(inventories);

  // Attach filter listeners
  initExplorerFilters();
}

function renderInventoryGrid(inventories) {
  const container = document.getElementById('inventory-list');
  container.innerHTML = inventories.map(inv => {
    const avgCpm = inv.min_cpm && inv.max_cpm ? Math.round((inv.min_cpm + inv.max_cpm) / 2) : null;
    const fitPercent = (inv.target_audience_fit || 0) * 10;
    const isSelected = state.selectedInventories.has(inv.id);

    return `
      <div class="inventory-card ${isSelected ? 'selected' : ''}" data-id="${inv.id}">
        <div class="card-top">
          <div class="card-header">
            <h3 class="card-name" onclick="showInventoryDetail('${inv.id}')">${inv.name}</h3>
            <button class="btn-compare-check ${isSelected ? 'checked' : ''}" onclick="toggleCompare('${inv.id}'); this.classList.toggle('checked');" title="Add to compare">
              ${isSelected ? '✓' : '+'}
            </button>
          </div>
          <div class="card-badges">
            <span class="category-badge cat-${inv.category}">${inv.category}</span>
            ${inv.status === 'new' ? '<span class="badge teal">NEW</span>' : ''}
            ${inv.fintech_friendly ? '<span class="badge-dot green" title="Fintech Friendly"></span>' : ''}
          </div>
        </div>
        <div class="card-body" onclick="showInventoryDetail('${inv.id}')">
          <div class="card-metrics">
            <div class="metric">
              <span class="metric-label">CPM</span>
              <span class="metric-value price-tag ${getPriceClass(avgCpm)}">₹${avgCpm || '—'}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Reach</span>
              <span class="metric-value">${formatNumber(inv.estimated_monthly_reach)}</span>
            </div>
            <div class="metric">
              <span class="metric-label">Model</span>
              <span class="metric-value">${(inv.pricing_model || '—').toUpperCase()}</span>
            </div>
          </div>
          <div class="card-fit">
            <span class="fit-label">Audience Fit</span>
            <div class="fit-bar"><div class="fit-fill" style="width:${fitPercent}%"></div></div>
            <span class="fit-value">${inv.target_audience_fit}/10</span>
          </div>
          ${inv.competitor_count ? `<div class="card-competitors muted">${inv.competitor_count} competitor${inv.competitor_count > 1 ? 's' : ''} active</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderInventoryTable(inventories) {
  const container = document.getElementById('inventory-table');
  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th></th>
          <th>Name</th>
          <th>Category</th>
          <th>Model</th>
          <th>CPM Range (₹)</th>
          <th>Reach</th>
          <th>Fit</th>
          <th>Fintech</th>
          <th>Competitors</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${inventories.map(inv => `
          <tr onclick="showInventoryDetail('${inv.id}')" style="cursor:pointer">
            <td><button class="btn-compare-check ${state.selectedInventories.has(inv.id) ? 'checked' : ''}" onclick="event.stopPropagation(); toggleCompare('${inv.id}'); this.classList.toggle('checked');">${state.selectedInventories.has(inv.id) ? '✓' : '+'}</button></td>
            <td><strong>${inv.name}</strong></td>
            <td><span class="category-badge cat-${inv.category}">${inv.category}</span></td>
            <td>${(inv.pricing_model || '—').toUpperCase()}</td>
            <td class="price-tag ${getPriceClass((inv.min_cpm+inv.max_cpm)/2)}">₹${inv.min_cpm || '?'} — ₹${inv.max_cpm || '?'}</td>
            <td>${formatNumber(inv.estimated_monthly_reach)}</td>
            <td>${inv.target_audience_fit}/10</td>
            <td>${inv.fintech_friendly ? '✓' : '✗'}</td>
            <td>${inv.competitor_count || 0}</td>
            <td><span class="badge ${inv.status === 'new' ? 'teal' : ''}">${inv.status}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function initExplorerFilters() {
  const filterEls = ['filter-category', 'filter-pricing', 'filter-fintech', 'filter-min-cpm', 'filter-max-cpm', 'filter-min-fit', 'sort-by'];
  filterEls.forEach(id => {
    const el = document.getElementById(id);
    if (el && !el._listenerAdded) {
      el.addEventListener('change', () => loadExplorer());
      el._listenerAdded = true;
    }
  });
}

// Competitor Map
async function loadCompetitorMap() {
  const [competitors, inventories] = await Promise.all([
    api('/competitors'),
    api('/inventories')
  ]);

  if (!competitors || !inventories) return;

  const container = document.getElementById('competitor-grid');
  const whitespaceOnly = document.getElementById('whitespace-toggle')?.checked;

  // Get all competitor spends
  const spendMap = {};
  for (const comp of competitors) {
    const profile = await api(`/competitors/${comp.id}/spend`);
    if (profile && profile.spends) {
      profile.spends.forEach(s => {
        const key = `${comp.id}_${s.inventory_id}`;
        spendMap[key] = s;
      });
    }
  }

  // Select top 20 inventories by audience fit for the grid
  const topInvs = inventories.slice(0, 20);

  // Build grid
  const headerRow = `<div class="comp-grid-row header">
    <div class="comp-grid-cell corner">Competitor</div>
    ${topInvs.map(inv => `<div class="comp-grid-cell inv-header" title="${inv.name}">${inv.name.substring(0, 12)}</div>`).join('')}
  </div>`;

  const rows = competitors.map(comp => {
    const cells = topInvs.map(inv => {
      const key = `${comp.id}_${inv.id}`;
      const spend = spendMap[key];
      let level = 'none';
      let amount = '';

      if (spend) {
        const s = spend.estimated_monthly_spend;
        if (s > 10000000) level = 'high';
        else if (s > 1000000) level = 'medium';
        else level = 'low';
        amount = `₹${formatNumber(s)}`;
      }

      if (whitespaceOnly && level !== 'none') return '';

      return `<div class="comp-grid-cell spend-${level}" title="${comp.name} → ${inv.name}: ${amount || 'No spend'}">${level !== 'none' ? amount : ''}</div>`;
    }).join('');

    return `<div class="comp-grid-row">
      <div class="comp-grid-cell comp-name" onclick="showCompetitorSidebar('${comp.id}')">${comp.name}</div>
      ${cells}
    </div>`;
  }).join('');

  container.innerHTML = headerRow + rows;

  // Whitespace toggle
  const toggle = document.getElementById('whitespace-toggle');
  if (toggle && !toggle._listenerAdded) {
    toggle.addEventListener('change', () => loadCompetitorMap());
    toggle._listenerAdded = true;
  }
}

async function showCompetitorSidebar(competitorId) {
  const sidebar = document.getElementById('competitor-sidebar');
  const content = document.getElementById('competitor-sidebar-content');

  const profile = await api(`/competitors/${competitorId}/spend`);
  if (!profile) return;

  content.innerHTML = `
    <h3>${profile.name}</h3>
    <div class="sidebar-meta">
      <span class="badge">${profile.vertical}</span>
      <span class="muted">Est. ₹${formatNumber(profile.estimated_monthly_adspend)}/mo</span>
    </div>
    <h4>Channels: ${profile.primary_channels || '—'}</h4>
    <h4>Spend Breakdown</h4>
    ${profile.spends && profile.spends.length ? `
      <table class="data-table">
        <thead><tr><th>Inventory</th><th>Monthly Spend</th><th>Confidence</th></tr></thead>
        <tbody>
          ${profile.spends.map(s => `
            <tr>
              <td>${s.inventory_name || s.inventory_id}</td>
              <td>₹${formatNumber(s.estimated_monthly_spend)}</td>
              <td><span class="confidence-badge conf-${s.confidence_level}">${s.confidence_level}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : '<p class="muted">No spend data available.</p>'}
  `;

  sidebar.style.display = 'block';

  document.getElementById('close-competitor-sidebar').onclick = () => {
    sidebar.style.display = 'none';
  };
}

// Discovery Log
async function loadDiscovery() {
  const [newInvs, logs] = await Promise.all([
    api('/inventories/new'),
    api('/discovery/log')
  ]);

  const newContainer = document.getElementById('new-inventories');
  if (newInvs && newInvs.length) {
    newContainer.innerHTML = newInvs.map(inv => `
      <div class="inventory-card new-card" onclick="showInventoryDetail('${inv.id}')">
        <span class="badge teal">NEW</span>
        <h3>${inv.name}</h3>
        <span class="category-badge cat-${inv.category}">${inv.category}</span>
        <div class="muted">Discovered: ${new Date(inv.created_at).toLocaleDateString()}</div>
        <div class="metric-value">₹${inv.min_cpm || '?'} — ₹${inv.max_cpm || '?'} CPM</div>
      </div>
    `).join('');
  } else {
    newContainer.innerHTML = '<p class="muted">No new inventories this week. Run discovery to find new ones.</p>';
  }

  const logContainer = document.getElementById('discovery-timeline');
  if (logs && logs.length) {
    logContainer.innerHTML = logs.map(log => `
      <div class="timeline-entry">
        <div class="timeline-date">${new Date(log.run_date).toLocaleString()}</div>
        <div class="timeline-content">
          <span class="badge">${log.inventories_found || 0} found</span>
          <span class="badge teal">${log.new_inventories || 0} new</span>
          ${log.summary ? `<p>${log.summary}</p>` : ''}
          <span class="muted">Model: ${log.ai_model_used || 'fallback'}</span>
        </div>
      </div>
    `).join('');

    // Render discovery chart
    setTimeout(() => renderDiscoveryChart(logs), 100);
  } else {
    logContainer.innerHTML = '<p class="muted">No discovery runs yet.</p>';
  }
}

// Budget Planner
async function loadBudgetPlanner() {
  const inventories = await api('/inventories');
  if (!inventories) return;

  const selector = document.getElementById('budget-inventory-selector');
  selector.innerHTML = `
    <p class="muted">Select inventories for budget allocation:</p>
    <div class="budget-checkboxes">
      ${inventories.slice(0, 30).map(inv => `
        <label class="budget-checkbox">
          <input type="checkbox" value="${inv.id}" class="budget-inv-check" />
          ${inv.name} <span class="muted">(₹${Math.round((inv.min_cpm+inv.max_cpm)/2)} CPM)</span>
        </label>
      `).join('')}
    </div>
  `;

  const allocateBtn = document.getElementById('btn-allocate');
  if (allocateBtn && !allocateBtn._listenerAdded) {
    allocateBtn.addEventListener('click', allocateBudget);
    allocateBtn._listenerAdded = true;
  }

  const exportBtn = document.getElementById('btn-export-budget');
  if (exportBtn && !exportBtn._listenerAdded) {
    exportBtn.addEventListener('click', exportBudgetCSV);
    exportBtn._listenerAdded = true;
  }
}

async function allocateBudget() {
  const totalBudget = parseInt(document.getElementById('total-budget').value) || 1000000;
  const checked = document.querySelectorAll('.budget-inv-check:checked');
  const selectedIds = Array.from(checked).map(c => c.value);

  if (selectedIds.length === 0) {
    showToast('Select at least one inventory', 'warning');
    return;
  }

  showToast('Calculating optimal allocation...', 'info');

  // Fetch budget recommendations for each
  const budgets = await Promise.all(selectedIds.map(id => api(`/budget/${id}`)));
  const validBudgets = budgets.filter(b => b);

  if (!validBudgets.length) {
    showToast('Could not generate recommendations', 'error');
    return;
  }

  // Simple allocation: proportional to starter budget recommendations
  const totalRecommended = validBudgets.reduce((sum, b) => sum + (b.recommended_starting_budget || 0), 0);
  const allocations = validBudgets.map(b => {
    const share = totalRecommended > 0 ? (b.recommended_starting_budget || 0) / totalRecommended : 1 / validBudgets.length;
    const allocated = Math.round(totalBudget * share);
    const avgCpm = b.avg_cpm || ((b.min_cpm || 50) + (b.max_cpm || 150)) / 2;
    const impressions = Math.round((allocated / avgCpm) * 1000);
    const clicks = Math.round(impressions * 0.01); // 1% CTR estimate
    const conversions = Math.round(clicks * 0.02); // 2% CVR estimate

    return {
      ...b,
      allocated_budget: allocated,
      share_percent: Math.round(share * 100),
      projected_impressions: impressions,
      projected_clicks: clicks,
      projected_conversions: conversions,
      projected_cpa: conversions > 0 ? Math.round(allocated / conversions) : null
    };
  });

  renderBudgetResults(allocations, totalBudget);
  setTimeout(() => renderBudgetChart(allocations), 100);
}

function renderBudgetResults(allocations, totalBudget) {
  const resultsEl = document.getElementById('budget-results');
  resultsEl.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Inventory</th>
          <th>Allocated (₹)</th>
          <th>Share</th>
          <th>Est. Impressions</th>
          <th>Est. Clicks</th>
          <th>Est. Conversions</th>
          <th>Est. CPA (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${allocations.map(a => `
          <tr>
            <td>${a.name || a.inventory_id || '—'}</td>
            <td>₹${formatNumber(a.allocated_budget)}</td>
            <td>${a.share_percent}%</td>
            <td>${formatNumber(a.projected_impressions)}</td>
            <td>${formatNumber(a.projected_clicks)}</td>
            <td>${a.projected_conversions}</td>
            <td>₹${a.projected_cpa ? formatNumber(a.projected_cpa) : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td><strong>Total</strong></td>
          <td><strong>₹${formatNumber(totalBudget)}</strong></td>
          <td>100%</td>
          <td><strong>${formatNumber(allocations.reduce((s,a) => s + a.projected_impressions, 0))}</strong></td>
          <td><strong>${formatNumber(allocations.reduce((s,a) => s + a.projected_clicks, 0))}</strong></td>
          <td><strong>${allocations.reduce((s,a) => s + a.projected_conversions, 0)}</strong></td>
          <td>—</td>
        </tr>
      </tfoot>
    </table>
  `;

  // Store for export
  state.lastBudgetAllocations = allocations;

  const projections = document.getElementById('budget-projections');
  const totalImpressions = allocations.reduce((s,a) => s + a.projected_impressions, 0);
  const totalClicks = allocations.reduce((s,a) => s + a.projected_clicks, 0);
  const totalConversions = allocations.reduce((s,a) => s + a.projected_conversions, 0);
  const blendedCPA = totalConversions > 0 ? Math.round(totalBudget / totalConversions) : null;

  projections.innerHTML = `
    <div class="kpi-strip">
      <div class="kpi-card"><div class="kpi-value">${formatNumber(totalImpressions)}</div><div class="kpi-label">Total Impressions</div></div>
      <div class="kpi-card"><div class="kpi-value">${formatNumber(totalClicks)}</div><div class="kpi-label">Total Clicks</div></div>
      <div class="kpi-card"><div class="kpi-value">${totalConversions}</div><div class="kpi-label">Total Conversions</div></div>
      <div class="kpi-card"><div class="kpi-value">₹${blendedCPA ? formatNumber(blendedCPA) : '—'}</div><div class="kpi-label">Blended CPA</div></div>
    </div>
  `;
}

function exportBudgetCSV() {
  if (!state.lastBudgetAllocations) { showToast('No allocation data to export', 'warning'); return; }
  const rows = [['Inventory', 'Allocated Budget', 'Share %', 'Est Impressions', 'Est Clicks', 'Est Conversions', 'Est CPA']];
  state.lastBudgetAllocations.forEach(a => {
    rows.push([a.name || '', a.allocated_budget, a.share_percent, a.projected_impressions, a.projected_clicks, a.projected_conversions, a.projected_cpa || '']);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  downloadCSV(csv, 'budget_allocation.csv');
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Settings
async function loadSettings() {
  const competitors = await api('/competitors');
  const scheduler = await api('/scheduler/status');

  const compContainer = document.getElementById('settings-competitors');
  if (competitors) {
    compContainer.innerHTML = competitors.map(c => `
      <div class="settings-competitor-row">
        <span>${c.name}</span>
        <span class="badge">${c.vertical}</span>
        <span class="muted">₹${formatNumber(c.estimated_monthly_adspend)}/mo</span>
      </div>
    `).join('');
  }

  const schedContainer = document.getElementById('scheduler-status');
  if (scheduler) {
    schedContainer.innerHTML = `
      <p><span class="status-dot green"></span> Scheduler: ${scheduler.schedulerRunning ? 'Running' : 'Stopped'}</p>
      ${Object.entries(scheduler.jobs || {}).map(([name, info]) => `
        <div class="scheduler-job">
          <span>${name}</span>
          <span class="muted">Last: ${info.lastRun || 'never'}</span>
        </div>
      `).join('')}
    `;
  }

  // Export buttons
  const exportJsonBtn = document.getElementById('btn-export-json');
  if (exportJsonBtn && !exportJsonBtn._listenerAdded) {
    exportJsonBtn.addEventListener('click', async () => {
      const data = await api('/inventories');
      if (data) downloadCSV(JSON.stringify(data, null, 2), 'inventories_export.json');
    });
    exportJsonBtn._listenerAdded = true;
  }
}

// Ad Monitor (View 8)
async function loadAdMonitor() {
  const [metaAds, googleAds] = await Promise.all([
    api('/meta/ads/all'),
    api('/google/ads/all')
  ]);

  const feed = document.getElementById('ad-feed');
  const allAds = [];

  if (metaAds && Array.isArray(metaAds)) {
    metaAds.forEach(ad => allAds.push({ ...ad, source: 'meta' }));
  }
  if (googleAds && Array.isArray(googleAds)) {
    googleAds.forEach(ad => allAds.push({ ...ad, source: 'google' }));
  }

  if (!allAds.length) {
    feed.innerHTML = '<p class="muted">No ad data yet. Run Meta/Google refresh to pull competitor ads.</p>';
    return;
  }

  // Sort
  const sortBy = document.getElementById('admon-sort')?.value || 'newest';
  if (sortBy === 'newest') allAds.sort((a,b) => new Date(b.start_date || b.created_at) - new Date(a.start_date || a.created_at));
  else if (sortBy === 'longest') allAds.sort((a,b) => (b.run_days || 0) - (a.run_days || 0));
  else if (sortBy === 'spend') allAds.sort((a,b) => (b.spend_max || 0) - (a.spend_max || 0));

  feed.innerHTML = allAds.slice(0, 50).map(ad => `
    <div class="ad-card">
      <div class="ad-card-header">
        <span class="platform-badge platform-${ad.source}">${ad.source === 'meta' ? 'META' : 'GOOGLE'}</span>
        <span class="ad-competitor">${ad.competitor_name || '—'}</span>
        ${ad.run_days >= 30 ? '<span class="badge gold">🔥 30+ days</span>' : ''}
        ${ad.run_days <= 2 ? '<span class="badge teal">🆕 New</span>' : ''}
      </div>
      <div class="ad-card-body">
        ${ad.headline ? `<h4>${ad.headline}</h4>` : ''}
        ${ad.body ? `<p>${ad.body.substring(0, 200)}</p>` : ''}
      </div>
      <div class="ad-card-footer">
        ${ad.theme_tag ? `<span class="theme-tag">${ad.theme_tag}</span>` : ''}
        ${ad.media_type ? `<span class="muted">${ad.media_type}</span>` : ''}
        ${ad.spend_min ? `<span class="muted">₹${formatNumber(ad.spend_min)} - ₹${formatNumber(ad.spend_max)}</span>` : ''}
        <span class="muted">${ad.start_date ? new Date(ad.start_date).toLocaleDateString() : ''} ${ad.run_days ? `(${ad.run_days}d)` : ''}</span>
      </div>
    </div>
  `).join('');

  // Populate competitor filter
  const compFilter = document.getElementById('admon-competitor');
  if (compFilter && compFilter.options.length <= 1) {
    const competitors = await api('/competitors');
    if (competitors) {
      competitors.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name; opt.textContent = c.name;
        compFilter.appendChild(opt);
      });
    }
  }

  // Filter listeners
  ['admon-platform', 'admon-competitor', 'admon-theme', 'admon-sort'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el._listenerAdded) {
      el.addEventListener('change', () => loadAdMonitor());
      el._listenerAdded = true;
    }
  });
}

// Keywords (View 9)
async function loadKeywords() {
  const [searchAds, gaps] = await Promise.all([
    api('/google/search-ads'),
    api('/google/keyword-gaps')
  ]);

  const tableContainer = document.getElementById('keyword-table-container');
  if (searchAds && searchAds.length) {
    // Group by keyword
    const byKeyword = {};
    searchAds.forEach(ad => {
      if (!byKeyword[ad.keyword]) byKeyword[ad.keyword] = [];
      byKeyword[ad.keyword].push(ad);
    });

    tableContainer.innerHTML = `
      <table class="data-table">
        <thead><tr><th>Keyword</th><th>Competitors Bidding</th><th>Top Headline</th><th>Competition</th></tr></thead>
        <tbody>
          ${Object.entries(byKeyword).map(([kw, ads]) => {
            const level = ads.length >= 3 ? 'high' : ads.length >= 2 ? 'medium' : 'low';
            return `
              <tr class="keyword-row kw-${level}">
                <td><strong>${kw}</strong></td>
                <td>${ads.length} competitor${ads.length > 1 ? 's' : ''}</td>
                <td class="muted">${ads[0].headline1 || '—'}</td>
                <td><span class="competition-badge comp-${level}">${level}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } else {
    tableContainer.innerHTML = '<p class="muted">No search ad data yet. Run Google refresh.</p>';
  }

  const gapsContainer = document.getElementById('keyword-gaps');
  if (gaps && gaps.length) {
    gapsContainer.innerHTML = gaps.map(g => `
      <div class="keyword-gap-card">
        <span class="badge red">GAP</span>
        <strong>${g.keyword}</strong>
        <span class="muted">${g.competitor_count || 0} competitors active</span>
      </div>
    `).join('');
  } else {
    gapsContainer.innerHTML = '<p class="muted">No keyword gaps identified.</p>';
  }

  // Export
  const exportBtn = document.getElementById('btn-export-keywords');
  if (exportBtn && !exportBtn._listenerAdded) {
    exportBtn.addEventListener('click', () => {
      if (searchAds) {
        const csv = 'Keyword,Competitor,Headline1,Headline2,Position\n' +
          searchAds.map(a => `"${a.keyword}","${a.competitor_name || ''}","${a.headline1 || ''}","${a.headline2 || ''}",${a.position || ''}`).join('\n');
        downloadCSV(csv, 'keyword_intelligence.csv');
      }
    });
    exportBtn._listenerAdded = true;
  }
}

// Timeline (View 10)
async function loadTimeline() {
  // This would ideally use a horizontal bar chart
  // For now, render a simplified version
  const competitors = await api('/competitors');
  if (!competitors) return;

  renderTimelineChart(competitors);
}
