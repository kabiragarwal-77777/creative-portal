// App State
const state = {
  currentView: 'dashboard',
  inventories: [],
  competitors: [],
  selectedInventories: new Set(),
  insights: [],
  filters: {},
  viewMode: 'grid'
};

// API helper
async function api(path, options = {}) {
  try {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'API error');
    return json.data;
  } catch (err) {
    console.error(`API Error [${path}]:`, err);
    showToast(err.message, 'error');
    return null;
  }
}

// ==================== NAVIGATION ====================
function initNav() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(link.dataset.view);
    });
  });
}

function navigateTo(view) {
  state.currentView = view;
  // Clear active from all nav links
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelector(`.nav-link[data-view="${view}"]`)?.classList.add('active');
  // Show view
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const viewEl = document.getElementById(`view-${view}`);
  if (viewEl) {
    viewEl.classList.add('active');
    loadView(view);
  }
}

async function loadView(view) {
  switch(view) {
    case 'dashboard': await loadDashboard(); break;
    case 'explorer': await loadExplorer(); break;
    case 'competitors': await loadCompetitorMap(); break;
    case 'discovery': await loadDiscovery(); break;
    case 'budget': await loadBudgetPlanner(); break;
    case 'settings': await loadSettings(); break;
    case 'admonitor': await loadAdMonitor(); break;
    case 'keywords': await loadKeywords(); break;
    case 'timeline': await loadTimeline(); break;
  }
}

// Toast notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Clock
function startClock() {
  const el = document.getElementById('clock');
  function tick() {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  tick();
  setInterval(tick, 1000);
}

// Global search (Ctrl+K)
function initSearch() {
  const searchInput = document.getElementById('global-search');
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === 'r' && document.activeElement.tagName !== 'INPUT') {
      document.getElementById('btn-run-discovery').click();
    }
  });
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      if (state.currentView === 'explorer') {
        loadExplorer();
      } else {
        navigateTo('explorer');
      }
    }, 300);
  });
}

// Run Discovery button
function initDiscoveryButton() {
  document.getElementById('btn-run-discovery').addEventListener('click', async () => {
    showToast('Running discovery...', 'info');
    const result = await api('/discovery/run', { method: 'POST' });
    if (result) {
      showToast(`Discovery complete! Found ${result.inventories_found || 0} inventories`, 'success');
      if (state.currentView === 'dashboard') loadDashboard();
      if (state.currentView === 'discovery') loadDiscovery();
    }
  });
}

// Compare functionality
function toggleCompare(inventoryId) {
  if (state.selectedInventories.has(inventoryId)) {
    state.selectedInventories.delete(inventoryId);
  } else if (state.selectedInventories.size < 4) {
    state.selectedInventories.add(inventoryId);
  } else {
    showToast('Maximum 4 inventories for comparison', 'warning');
    return;
  }
  updateCompareButton();
}

function updateCompareButton() {
  const btn = document.getElementById('btn-compare');
  if (btn) {
    btn.textContent = `Compare (${state.selectedInventories.size})`;
    btn.disabled = state.selectedInventories.size < 2;
  }
}

async function showCompareModal() {
  if (state.selectedInventories.size < 2) return;
  const ids = Array.from(state.selectedInventories).join(',');
  const data = await api(`/pricing/compare?ids=${ids}`);
  const budgets = await api(`/budget/compare?ids=${ids}`);
  const modal = document.getElementById('compare-modal');
  const content = document.getElementById('compare-content');
  if (data) {
    content.innerHTML = renderCompareTable(data, budgets);
    setTimeout(() => renderCpmCompareChart(data), 100);
  }
  modal.style.display = 'flex';
}

function renderCompareTable(pricingData, budgetData) {
  if (!pricingData || !pricingData.length) return '<p class="muted">No data available</p>';
  const headers = pricingData.map(p => `<th>${p.name || 'Unknown'}</th>`).join('');
  const rows = [
    { label: 'Category', key: 'category' },
    { label: 'Min CPM (₹)', key: 'min_cpm', format: v => `₹${v || 0}` },
    { label: 'Max CPM (₹)', key: 'max_cpm', format: v => `₹${v || 0}` },
    { label: 'Avg CPM (₹)', key: 'avg_cpm', format: v => `₹${Math.round(v || 0)}` },
    { label: 'Pricing Model', key: 'pricing_model' },
    { label: 'Monthly Reach', key: 'estimated_monthly_reach', format: v => formatNumber(v) },
    { label: 'Audience Fit', key: 'target_audience_fit', format: v => `${v}/10` },
    { label: 'Fintech Friendly', key: 'fintech_friendly', format: v => v ? '✓' : '✗' },
    { label: 'Price Trend', key: 'price_trend' },
    { label: 'vs Google', key: 'benchmark_vs_google' }
  ];
  const rowsHtml = rows.map(r => {
    const cells = pricingData.map(p => {
      const val = p[r.key];
      return `<td>${r.format ? r.format(val) : (val || '—')}</td>`;
    }).join('');
    return `<tr><td class="row-label">${r.label}</td>${cells}</tr>`;
  }).join('');
  return `
    <table class="compare-table"><thead><tr><th>Metric</th>${headers}</tr></thead><tbody>${rowsHtml}</tbody></table>
    <canvas id="cpm-compare-chart" height="200" style="margin-top:20px"></canvas>
  `;
}

// Inventory Detail Modal
async function showInventoryDetail(inventoryId) {
  const modal = document.getElementById('inventory-detail-modal');
  const headerEl = document.getElementById('detail-header');
  const bodyEl = document.getElementById('detail-body');
  headerEl.innerHTML = '<div class="skeleton" style="height:40px;width:300px"></div>';
  bodyEl.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  modal.style.display = 'flex';

  const data = await api(`/inventories/${inventoryId}`);
  if (!data) return;

  headerEl.innerHTML = `
    <h2>${data.name}</h2>
    <div class="detail-meta">
      <span class="category-badge cat-${data.category}">${data.category}</span>
      ${data.platform_parent ? `<span class="muted">by ${data.platform_parent}</span>` : ''}
      ${data.fintech_friendly ? '<span class="badge teal">Fintech Friendly</span>' : '<span class="badge red">Restricted</span>'}
      <span class="badge">${data.status}</span>
    </div>
  `;
  initDetailTabs(data, inventoryId);
  renderDetailTab('overview', data, inventoryId);
}

function initDetailTabs(data, inventoryId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderDetailTab(btn.dataset.tab, data, inventoryId);
    };
  });
}

async function renderDetailTab(tab, data, inventoryId) {
  const bodyEl = document.getElementById('detail-body');
  switch(tab) {
    case 'overview':
      bodyEl.innerHTML = renderOverviewTab(data); break;
    case 'pricing':
      const pricing = await api(`/pricing/${inventoryId}`);
      bodyEl.innerHTML = renderPricingTab(pricing || data);
      setTimeout(() => renderPriceTrendChart(pricing || data), 100); break;
    case 'competitors':
      bodyEl.innerHTML = renderCompetitorsTab(data.competitors || []);
      setTimeout(() => renderCompetitorDonut(data.competitors || []), 100); break;
    case 'formats':
      let formats = data.formats;
      if (!formats || formats.length === 0) formats = await api(`/formats/${inventoryId}`);
      bodyEl.innerHTML = renderFormatsTab(formats || []); break;
    case 'budget':
      const budget = await api(`/budget/${inventoryId}`);
      bodyEl.innerHTML = renderBudgetTab(budget); break;
    case 'onboarding':
      const guide = await api(`/onboarding/${inventoryId}`);
      bodyEl.innerHTML = renderOnboardingTab(guide || []); break;
    case 'detail-insights':
      const insights = await api(`/insights/inventory/${inventoryId}`);
      bodyEl.innerHTML = renderInsightsTab(insights || []); break;
  }
}

function renderOverviewTab(data) {
  const avgCpm = data.min_cpm && data.max_cpm ? Math.round((data.min_cpm + data.max_cpm) / 2) : '—';
  const fitPercent = (data.target_audience_fit || 0) * 10;
  const fitColor = fitPercent >= 70 ? '#51cf66' : fitPercent >= 40 ? '#f0b429' : '#ff6b6b';
  return `
    <div class="overview-grid"><div class="overview-stats">
      <div class="stat-card"><div class="stat-label">CPM Range</div><div class="stat-value">₹${data.min_cpm || '?'} — ₹${data.max_cpm || '?'}</div></div>
      <div class="stat-card"><div class="stat-label">Avg CPM</div><div class="stat-value price-tag ${getPriceClass(avgCpm)}">₹${avgCpm}</div></div>
      <div class="stat-card"><div class="stat-label">Monthly Reach</div><div class="stat-value">${formatNumber(data.estimated_monthly_reach)}</div></div>
      <div class="stat-card"><div class="stat-label">Pricing Model</div><div class="stat-value">${(data.pricing_model || '—').toUpperCase()}</div></div>
      <div class="stat-card"><div class="stat-label">Audience Fit</div><div class="stat-value">${data.target_audience_fit}/10</div><div class="fit-bar"><div class="fit-fill" style="width:${fitPercent}%;background:${fitColor}"></div></div></div>
      <div class="stat-card"><div class="stat-label">Competitors Active</div><div class="stat-value">${data.competitors?.length || 0}</div></div>
    </div>
    ${data.benchmark ? `<div class="benchmark-section"><h3>Performance vs Benchmark</h3><div class="benchmark-status ${data.benchmark.status}">${data.benchmark.status === 'outperforming' ? '▲ Outperforming' : data.benchmark.status === 'underperforming' ? '▼ Underperforming' : '● On Par'}</div><div class="muted">Efficiency Score: ${data.benchmark.efficiency_score}%</div></div>` : ''}
    </div>`;
}

function renderPricingTab(pricing) {
  return `<div class="pricing-grid">
    <div class="stat-card"><div class="stat-label">Min CPM</div><div class="stat-value">₹${pricing.min_cpm || '—'}</div></div>
    <div class="stat-card"><div class="stat-label">Max CPM</div><div class="stat-value">₹${pricing.max_cpm || '—'}</div></div>
    <div class="stat-card"><div class="stat-label">Avg CPM</div><div class="stat-value">₹${pricing.avg_cpm || Math.round(((pricing.min_cpm||0)+(pricing.max_cpm||0))/2)}</div></div>
    <div class="stat-card"><div class="stat-label">Pricing Model</div><div class="stat-value">${(pricing.pricing_model||'—').toUpperCase()}</div></div>
    <div class="stat-card"><div class="stat-label">Price Trend</div><div class="stat-value trend-${pricing.price_trend||'stable'}">${pricing.price_trend||'stable'}</div></div>
    <div class="stat-card"><div class="stat-label">vs Google</div><div class="stat-value">${pricing.benchmark_vs_google||'—'}</div></div>
  </div><canvas id="price-trend-chart" height="200" style="margin-top:20px"></canvas>`;
}

function renderCompetitorsTab(competitors) {
  if (!competitors.length) return '<p class="muted">No competitor data available for this inventory.</p>';
  const rows = competitors.map(c => `<tr><td>${c.competitor_name}</td><td>₹${formatNumber(c.estimated_monthly_spend)}</td><td><span class="confidence-badge conf-${c.confidence_level}">${c.confidence_level}</span></td><td>${c.source || '—'}</td><td class="muted">${c.last_updated ? new Date(c.last_updated).toLocaleDateString() : '—'}</td></tr>`).join('');
  return `<table class="data-table"><thead><tr><th>Competitor</th><th>Est. Monthly Spend</th><th>Confidence</th><th>Source</th><th>Last Updated</th></tr></thead><tbody>${rows}</tbody></table><canvas id="competitor-donut" height="250" style="margin-top:20px"></canvas>`;
}

function renderFormatsTab(formats) {
  if (!formats || !formats.length) return '<p class="muted">No format data available. Click to generate.</p>';
  const sorted = [...formats].sort((a,b) => (b.score||0) - (a.score||0));
  return `<div class="formats-list">${sorted.map(f => `<div class="format-card"><div class="format-header"><span class="format-icon">${getFormatIcon(f.format)}</span><span class="format-name">${f.format}</span><span class="format-score"><span class="score-bar"><span class="score-fill" style="width:${(f.score||0)*10}%"></span></span>${f.score}/10</span></div>${f.reason ? `<p class="format-reason">${f.reason}</p>` : ''}${f.best_size_spec ? `<p class="muted">Specs: ${f.best_size_spec}</p>` : ''}</div>`).join('')}</div>`;
}

function renderBudgetTab(budget) {
  if (!budget) return '<p class="muted">No budget recommendation available.</p>';
  return `<div class="budget-tiers">
    <div class="tier-card tier-test"><h3>Test Budget</h3><div class="tier-amount">₹${formatNumber(budget.recommended_testing_budget)}</div><p class="muted">Minimum for statistically valid data</p></div>
    <div class="tier-card tier-starter"><h3>Starter Budget</h3><div class="tier-amount">₹${formatNumber(budget.recommended_starting_budget)}</div><p class="muted">Recommended for initial scale</p></div>
    <div class="tier-card tier-scale"><h3>Scale Budget</h3><div class="tier-amount">₹${formatNumber(budget.recommended_scale_budget)}</div><p class="muted">For meaningful reach & conversions</p></div>
  </div>${budget.rationale ? `<div class="budget-rationale"><h4>Rationale</h4><p>${budget.rationale}</p></div>` : ''}<div class="budget-confidence muted">Confidence: ${Math.round((budget.confidence_score||0)*100)}%</div>`;
}

function renderOnboardingTab(guide) {
  if (!guide || !guide.length) return '<p class="muted">No onboarding guide available. Generating...</p>';
  const sorted = Array.isArray(guide) ? [...guide].sort((a,b) => (a.step_number||0) - (b.step_number||0)) : [];
  return `<div class="onboarding-timeline">${sorted.map(step => `<div class="timeline-step"><div class="step-number">${step.step_number}</div><div class="step-content"><h4>${step.step_title}</h4><p>${step.step_description}</p>${step.estimated_time ? `<span class="muted">⏱ ${step.estimated_time}</span>` : ''}${step.documents_required ? `<p class="muted">📄 ${step.documents_required}</p>` : ''}${step.contact_url ? `<a href="${step.contact_url}" target="_blank" class="btn btn-outline btn-sm">Contact / Sign Up</a>` : ''}</div></div>`).join('')}</div>`;
}

function renderInsightsTab(insights) {
  if (!insights || !insights.length) return '<p class="muted">No AI insights for this inventory yet.</p>';
  return insights.map(i => renderInsightCard(i)).join('');
}

// Utility functions
function formatNumber(num) {
  if (!num) return '—';
  if (num >= 10000000) return `${(num/10000000).toFixed(1)}Cr`;
  if (num >= 100000) return `${(num/100000).toFixed(1)}L`;
  if (num >= 1000) return `${(num/1000).toFixed(1)}K`;
  return num.toLocaleString('en-IN');
}

function getPriceClass(cpm) {
  if (typeof cpm !== 'number') return '';
  if (cpm < 100) return 'price-low';
  if (cpm < 300) return 'price-mid';
  return 'price-high';
}

function getFormatIcon(format) {
  const icons = { static:'🖼', video:'🎬', carousel:'⟳', story:'📱', native:'📰', audio:'🔊', interstitial:'⬜', rewarded:'🎁', search_text:'🔍', shopping:'🛒', rich_media:'✨', interactive:'🎮' };
  return icons[format] || '◈';
}

function getCategoryColor(cat) {
  const colors = { search:'#4dabf7', social:'#38d9a9', video:'#f0b429', audio:'#e599f7', gaming:'#ff922b', programmatic:'#74c0fc', vernacular:'#ffd43b', hyperlocal:'#69db7c', email:'#868e96', push:'#868e96', influencer:'#f783ac', ooh:'#ced4da', affiliate:'#20c997', podcast:'#845ef7', ctv:'#fab005', sms:'#868e96', regional_ott:'#fab005' };
  return colors[cat] || '#7c7d8a';
}

function renderInsightCard(insight) {
  const priorityColors = { high: '#ff6b6b', medium: '#f0b429', low: '#4dabf7' };
  const typeIcons = { opportunity:'💡', warning:'⚠️', trend:'📈', benchmark:'📊', whitespace:'🎯', seasonal:'📅' };
  return `<div class="insight-card ${insight.is_read ? 'read' : 'unread'}" data-id="${insight.id}">
    <div class="insight-header"><span class="insight-type">${typeIcons[insight.insight_type] || '◈'}</span><span class="insight-priority" style="color:${priorityColors[insight.priority]}">${insight.priority}</span></div>
    <h4 class="insight-title">${insight.title}</h4>
    <p class="insight-body">${insight.body ? insight.body.substring(0, 150) + '...' : ''}</p>
    <div class="insight-footer"><span class="muted">${insight.created_at ? new Date(insight.created_at).toLocaleDateString() : ''}</span>${!insight.is_read ? `<button class="btn btn-sm btn-outline" onclick="markInsightRead('${insight.id}')">Mark Read</button>` : ''}</div>
  </div>`;
}

async function markInsightRead(id) {
  await api(`/insights/${id}/read`, { method: 'PUT' });
  const card = document.querySelector(`.insight-card[data-id="${id}"]`);
  if (card) { card.classList.remove('unread'); card.classList.add('read'); }
  loadInsightCount();
}

async function loadInsightCount() {
  const insights = await api('/insights?unread=true');
  const count = insights ? insights.length : 0;
  document.getElementById('unread-count').textContent = count;
  const ib = document.getElementById('insight-badge');
  if (ib) ib.textContent = count;
  const notifBadge = document.getElementById('notif-badge');
  if (count > 0) { notifBadge.style.display = 'inline'; notifBadge.textContent = count; }
  else { notifBadge.style.display = 'none'; }
}

// Close modals
function initModals() {
  document.getElementById('close-detail').onclick = () => { document.getElementById('inventory-detail-modal').style.display = 'none'; };
  document.getElementById('close-compare').onclick = () => { document.getElementById('compare-modal').style.display = 'none'; };
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  });
  const compareBtn = document.getElementById('btn-compare');
  if (compareBtn) compareBtn.addEventListener('click', showCompareModal);
}

function initViewToggles() {
  const gridBtn = document.getElementById('btn-grid-view');
  const tableBtn = document.getElementById('btn-table-view');
  if (gridBtn) gridBtn.onclick = () => { state.viewMode = 'grid'; gridBtn.classList.add('active'); tableBtn.classList.remove('active'); toggleViewMode(); };
  if (tableBtn) tableBtn.onclick = () => { state.viewMode = 'table'; tableBtn.classList.add('active'); gridBtn.classList.remove('active'); toggleViewMode(); };
}

function toggleViewMode() {
  const grid = document.getElementById('inventory-list');
  const table = document.getElementById('inventory-table');
  if (state.viewMode === 'grid') { if(grid) grid.style.display = ''; if(table) table.style.display = 'none'; }
  else { if(grid) grid.style.display = 'none'; if(table) table.style.display = ''; }
}

// Init everything
document.addEventListener('DOMContentLoaded', () => {
  console.log('[Inventory Scanner] Initializing...');
  startClock();
  initNav();
  initSearch();
  initDiscoveryButton();
  initModals();
  initViewToggles();
  loadInsightCount();
  navigateTo('dashboard');
  console.log('[Inventory Scanner] Ready');
});
