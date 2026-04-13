// Filter state management
const filterState = {
  category: '',
  pricingModel: '',
  fintechFriendly: '',
  minCpm: null,
  maxCpm: null,
  minFit: null,
  search: '',
  sortBy: 'target_audience_fit'
};

// Debounce utility
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Initialize all filter listeners (called once)
function initFilters() {
  // Number input filters with debounce
  const debouncedLoad = debounce(() => {
    if (state.currentView === 'explorer') loadExplorer();
  });

  ['filter-min-cpm', 'filter-max-cpm', 'filter-min-fit'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', debouncedLoad);
    }
  });
}

// Category color mapping for consistent badge colors
function getCategoryBadgeHTML(category) {
  return `<span class="category-badge cat-${category}">${category}</span>`;
}

// Pricing model display
function getPricingModelDisplay(model) {
  const displays = {
    cpm: 'CPM', cpc: 'CPC', cpa: 'CPA', cpl: 'CPL',
    cpv: 'CPV', cpd: 'CPD', flat: 'Flat Rate'
  };
  return displays[model] || model || '—';
}

// Audience fit color
function getFitColor(fit) {
  if (fit >= 8) return '#51cf66';
  if (fit >= 6) return '#38d9a9';
  if (fit >= 4) return '#f0b429';
  return '#ff6b6b';
}

// Price trend indicator
function getTrendIndicator(trend) {
  switch(trend) {
    case 'increasing': return '<span class="trend-up">↑ Increasing</span>';
    case 'decreasing': return '<span class="trend-down">↓ Decreasing</span>';
    default: return '<span class="trend-stable">→ Stable</span>';
  }
}

// Format large numbers with Indian numbering
function formatINR(num) {
  if (!num) return '—';
  return '₹' + num.toLocaleString('en-IN');
}

// Confidence level styling
function getConfidenceBadge(level) {
  const colors = { high: '#51cf66', medium: '#f0b429', low: '#ff6b6b' };
  return `<span class="confidence-badge" style="color:${colors[level] || '#7c7d8a'}">${level}</span>`;
}

// Generate skeleton loading HTML
function skeletonCards(count = 6) {
  return Array(count).fill('').map(() => `
    <div class="inventory-card skeleton-card">
      <div class="skeleton" style="height:20px;width:70%;margin-bottom:12px"></div>
      <div class="skeleton" style="height:14px;width:40%;margin-bottom:8px"></div>
      <div class="skeleton" style="height:14px;width:90%;margin-bottom:8px"></div>
      <div class="skeleton" style="height:14px;width:60%"></div>
    </div>
  `).join('');
}

function skeletonTable(rows = 5) {
  return `
    <table class="data-table">
      <thead><tr>${Array(6).fill('<th><div class="skeleton" style="height:14px"></div></th>').join('')}</tr></thead>
      <tbody>
        ${Array(rows).fill('').map(() => `
          <tr>${Array(6).fill('<td><div class="skeleton" style="height:14px"></div></td>').join('')}</tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// Initialize filters on DOM ready
document.addEventListener('DOMContentLoaded', initFilters);
// Chart.js defaults — wrapped to avoid crash if CDN hasn't loaded
function initChartDefaults() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.color = '#7c7d8a';
  Chart.defaults.borderColor = '#252630';
  Chart.defaults.font.family = "'IBM Plex Sans', sans-serif";
}
document.addEventListener('DOMContentLoaded', initChartDefaults);

let chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

// CPM Compare Bar Chart
function renderCpmCompareChart(data) {
  const canvas = document.getElementById('cpm-compare-chart');
  if (!canvas) return;
  destroyChart('cpmCompare');

  chartInstances.cpmCompare = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.map(d => d.name || 'Unknown'),
      datasets: [
        {
          label: 'Min CPM (₹)',
          data: data.map(d => d.min_cpm || 0),
          backgroundColor: '#38d9a9'
        },
        {
          label: 'Max CPM (₹)',
          data: data.map(d => d.max_cpm || 0),
          backgroundColor: '#f0b429'
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#252630' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// Price Trend Line Chart
function renderPriceTrendChart(pricing) {
  const canvas = document.getElementById('price-trend-chart');
  if (!canvas) return;
  destroyChart('priceTrend');

  // Generate mock trend data (last 6 months)
  const months = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const baseMin = pricing.min_cpm || 50;
  const baseMax = pricing.max_cpm || 150;
  const trend = pricing.price_trend || 'stable';

  const multipliers = trend === 'increasing' ? [0.85, 0.88, 0.92, 0.95, 0.98, 1.0] :
                      trend === 'decreasing' ? [1.15, 1.12, 1.08, 1.05, 1.02, 1.0] :
                      [0.98, 1.01, 0.99, 1.02, 0.98, 1.0];

  chartInstances.priceTrend = new Chart(canvas, {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Min CPM (₹)',
          data: multipliers.map(m => Math.round(baseMin * m)),
          borderColor: '#38d9a9',
          backgroundColor: 'rgba(56, 217, 169, 0.1)',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Max CPM (₹)',
          data: multipliers.map(m => Math.round(baseMax * m)),
          borderColor: '#f0b429',
          backgroundColor: 'rgba(240, 180, 41, 0.1)',
          fill: true,
          tension: 0.4
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { beginAtZero: false, grid: { color: '#252630' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// Competitor Spend Donut
function renderCompetitorDonut(competitors) {
  const canvas = document.getElementById('competitor-donut');
  if (!canvas || !competitors.length) return;
  destroyChart('competitorDonut');

  const colors = ['#f0b429', '#38d9a9', '#4dabf7', '#ff6b6b', '#e599f7', '#ff922b', '#69db7c', '#74c0fc'];

  chartInstances.competitorDonut = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: competitors.map(c => c.competitor_name),
      datasets: [{
        data: competitors.map(c => c.estimated_monthly_spend || 0),
        backgroundColor: colors.slice(0, competitors.length),
        borderColor: '#13141a',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right' },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ₹${formatNumber(ctx.raw)}`
          }
        }
      }
    }
  });
}

// Discovery Activity Chart
function renderDiscoveryChart(logs) {
  const canvas = document.getElementById('discovery-chart');
  if (!canvas || !logs.length) return;
  destroyChart('discovery');

  const recent = logs.slice(0, 10).reverse();

  chartInstances.discovery = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: recent.map(l => new Date(l.run_date).toLocaleDateString()),
      datasets: [
        {
          label: 'Inventories Found',
          data: recent.map(l => l.inventories_found || 0),
          backgroundColor: '#4dabf7'
        },
        {
          label: 'New Inventories',
          data: recent.map(l => l.new_inventories || 0),
          backgroundColor: '#38d9a9'
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'top' } },
      scales: {
        y: { beginAtZero: true, grid: { color: '#252630' } },
        x: { grid: { display: false } }
      }
    }
  });
}

// Budget Allocation Pie
function renderBudgetChart(allocations) {
  const canvas = document.getElementById('budget-chart');
  if (!canvas) return;
  destroyChart('budget');

  const colors = ['#f0b429', '#38d9a9', '#4dabf7', '#ff6b6b', '#e599f7', '#ff922b', '#69db7c', '#74c0fc', '#ffd43b', '#845ef7'];

  chartInstances.budget = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: allocations.map(a => a.name || a.inventory_id || 'Unknown'),
      datasets: [{
        data: allocations.map(a => a.allocated_budget),
        backgroundColor: colors.slice(0, allocations.length),
        borderColor: '#13141a',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'right' },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ₹${formatNumber(ctx.raw)} (${allocations[ctx.dataIndex]?.share_percent}%)`
          }
        }
      }
    }
  });
}

// Competitive Timeline Chart (View 10)
function renderTimelineChart(competitors) {
  const canvas = document.getElementById('timeline-chart');
  if (!canvas) return;
  destroyChart('timeline');

  // Generate mock timeline data for last 90 days
  const colors = ['#f0b429', '#38d9a9', '#4dabf7', '#ff6b6b', '#e599f7', '#ff922b', '#69db7c', '#74c0fc', '#ffd43b', '#845ef7', '#f783ac', '#20c997'];

  const days = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }));
  }

  // Show every 7th day label
  const labels = days.map((d, i) => i % 7 === 0 ? d : '');

  const datasets = competitors.slice(0, 8).map((comp, idx) => {
    // Generate random activity levels
    const data = days.map(() => Math.random() > 0.3 ? Math.floor(Math.random() * 5) + 1 : 0);
    return {
      label: comp.name,
      data: data,
      backgroundColor: colors[idx],
      borderColor: 'transparent',
      borderWidth: 0,
      barPercentage: 0.8
    };
  });

  chartInstances.timeline = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw} ads`
          }
        }
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, grid: { color: '#252630' }, title: { display: true, text: 'Ad Activity' } }
      }
    }
  });
}
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

  // Build name lookup from checkbox labels
  const nameMap = {};
  checked.forEach(c => {
    const label = c.closest('label');
    if (label) {
      const text = label.textContent.trim().replace(/\s*\(.*\)\s*$/, '').trim();
      nameMap[c.value] = text;
    }
  });

  // Fetch budget recommendations for each
  const budgets = await Promise.all(selectedIds.map(id => api(`/budget/${id}`)));
  const validBudgets = budgets.map((b, i) => {
    const result = b || {};
    // Ensure name and inventory_id are always set
    if (!result.name) result.name = nameMap[selectedIds[i]] || null;
    if (!result.inventory_id) result.inventory_id = selectedIds[i];
    return result;
  }).filter(b => b);

  if (!validBudgets.length) {
    showToast('Could not generate recommendations', 'error');
    return;
  }

  // Category-specific CTR and CVR benchmarks for Indian fintech
  const CATEGORY_BENCHMARKS = {
    search:       { ctr: 3.5,  cvr: 4.0,  label: 'Search (high intent)' },
    social:       { ctr: 0.9,  cvr: 1.2,  label: 'Social (Meta/Insta)' },
    video:        { ctr: 0.6,  cvr: 0.8,  label: 'Video/OTT' },
    audio:        { ctr: 0.3,  cvr: 0.5,  label: 'Audio/Podcast' },
    gaming:       { ctr: 0.8,  cvr: 0.6,  label: 'Gaming' },
    programmatic: { ctr: 0.12, cvr: 0.4,  label: 'Programmatic display' },
    vernacular:   { ctr: 0.7,  cvr: 1.0,  label: 'Vernacular' },
    hyperlocal:   { ctr: 1.2,  cvr: 1.5,  label: 'Hyperlocal' },
    email:        { ctr: 2.5,  cvr: 1.8,  label: 'Email' },
    push:         { ctr: 1.5,  cvr: 1.0,  label: 'Push notification' },
    sms:          { ctr: 2.0,  cvr: 0.8,  label: 'SMS' },
    influencer:   { ctr: 1.0,  cvr: 1.5,  label: 'Influencer' },
    ooh:          { ctr: 0.05, cvr: 0.3,  label: 'OOH/DOOH' },
    affiliate:    { ctr: 1.8,  cvr: 3.0,  label: 'Affiliate' },
    podcast:      { ctr: 0.8,  cvr: 1.2,  label: 'Podcast' },
    ctv:          { ctr: 0.4,  cvr: 0.5,  label: 'CTV' },
    regional_ott: { ctr: 0.5,  cvr: 0.7,  label: 'Regional OTT' },
  };
  const DEFAULT_BENCH = { ctr: 0.8, cvr: 1.0 };

  // Simple allocation: proportional to starter budget recommendations
  const totalRecommended = validBudgets.reduce((sum, b) => sum + (b.recommended_starting_budget || 0), 0);
  const allocations = validBudgets.map(b => {
    const share = totalRecommended > 0 ? (b.recommended_starting_budget || 0) / totalRecommended : 1 / validBudgets.length;
    const allocated = Math.round(totalBudget * share);

    // Use actual CPM from inventory data
    const avgCpm = b.avg_cpm || ((b.min_cpm || 100) + (b.max_cpm || 300)) / 2;
    const bench = CATEGORY_BENCHMARKS[b.category] || DEFAULT_BENCH;
    const impressions = Math.round((allocated / avgCpm) * 1000);
    const clicks = Math.round(impressions * (bench.ctr / 100));
    const conversions = Math.round(clicks * (bench.cvr / 100));

    return {
      ...b,
      allocated_budget: allocated,
      share_percent: Math.round(share * 100),
      projected_impressions: impressions,
      projected_clicks: clicks,
      projected_conversions: conversions,
      projected_cpa: conversions > 0 ? Math.round(allocated / conversions) : null,
      avg_cpm_used: avgCpm,
      ctr_used: bench.ctr,
      cvr_used: bench.cvr
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
          <th>CPM (₹)</th>
          <th>CTR</th>
          <th>Est. Impressions</th>
          <th>Est. Clicks</th>
          <th>Est. Conversions</th>
          <th>Est. CPA (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${allocations.map(a => `
          <tr>
            <td>${a.name || a.inventory_name || a.inventory_id || '—'}</td>
            <td>₹${formatNumber(a.allocated_budget)}</td>
            <td>${a.share_percent}%</td>
            <td>₹${Math.round(a.avg_cpm_used || 0)}</td>
            <td>${(a.ctr_used || 0).toFixed(1)}%</td>
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
          <td>—</td>
          <td>—</td>
          <td><strong>${formatNumber(allocations.reduce((s,a) => s + a.projected_impressions, 0))}</strong></td>
          <td><strong>${formatNumber(allocations.reduce((s,a) => s + a.projected_clicks, 0))}</strong></td>
          <td><strong>${allocations.reduce((s,a) => s + a.projected_conversions, 0)}</strong></td>
          <td><strong>₹${(() => { const tc = allocations.reduce((s,a) => s + a.projected_conversions, 0); return tc > 0 ? formatNumber(Math.round(totalBudget / tc)) : '—'; })()}</strong></td>
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
async function loadDashboard() {
  await Promise.all([
    loadKPIs(),
    loadExistingInventories(),
    loadTopOpportunities(),
    loadInsightsFeed(),
    loadCompetitorActivityWidget(),
    loadTrendingHooks(),
    loadSilentCompetitors()
  ]);
  document.getElementById('last-updated').textContent = `Last updated: ${new Date().toLocaleString('en-IN')}`;
}

async function loadKPIs() {
  const stats = await api('/inventories/stats');
  if (!stats) return;

  const strip = document.getElementById('kpi-strip');
  strip.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-value">${stats.total}</div>
      <div class="kpi-label">Total Inventories</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${stats.active}</div>
      <div class="kpi-label">Active</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${stats.newThisWeek}</div>
      <div class="kpi-label">New This Week</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">₹${stats.avgCpm}</div>
      <div class="kpi-label">Avg CPM (Market)</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${stats.competitorCount}</div>
      <div class="kpi-label">Competitors Tracked</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value">${stats.categories?.length || 0}</div>
      <div class="kpi-label">Categories</div>
    </div>
  `;
}

async function loadExistingInventories() {
  const data = await api('/inventories/existing');
  const container = document.getElementById('existing-inventories');
  if (!data || !data.length) {
    container.innerHTML = '<p class="muted">No existing inventory data.</p>';
    return;
  }

  container.innerHTML = data.map(inv => `
    <div class="inventory-card existing-card" onclick="showInventoryDetail('${inv.inventory_id}')">
      <div class="card-header">
        <h3>${inv.name}</h3>
        <span class="performance-badge perf-${inv.status}">${inv.status === 'outperforming' ? '▲' : inv.status === 'underperforming' ? '▼' : '●'} ${inv.status}</span>
      </div>
      <div class="card-metrics">
        <div class="metric"><span class="metric-label">Monthly Spend</span><span class="metric-value">₹${formatNumber(inv.current_monthly_spend)}</span></div>
        <div class="metric"><span class="metric-label">CPM</span><span class="metric-value price-tag ${getPriceClass(inv.current_cpm)}">₹${inv.current_cpm}</span></div>
        <div class="metric"><span class="metric-label">CTR</span><span class="metric-value">${inv.current_ctr ? (inv.current_ctr * 100).toFixed(2) + '%' : '—'}</span></div>
        <div class="metric"><span class="metric-label">CPA</span><span class="metric-value">₹${inv.current_cpa || '—'}</span></div>
      </div>
      <div class="efficiency-bar">
        <span class="muted">Efficiency: ${inv.efficiency_score}%</span>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(inv.efficiency_score, 150)}%;background:${inv.efficiency_score >= 100 ? '#51cf66' : '#f0b429'}"></div></div>
      </div>
    </div>
  `).join('');
}

async function loadTopOpportunities() {
  const inventories = await api('/inventories?status=active');
  const container = document.getElementById('opportunities');
  if (!inventories) return;

  // Sort by audience fit, filter those not in existing
  const existing = await api('/inventories/existing');
  const existingIds = new Set((existing || []).map(e => e.inventory_id));

  const opportunities = inventories
    .filter(i => !existingIds.has(i.id) && i.target_audience_fit >= 7)
    .sort((a, b) => b.target_audience_fit - a.target_audience_fit)
    .slice(0, 5);

  container.innerHTML = opportunities.map((inv, idx) => `
    <div class="opportunity-row" onclick="showInventoryDetail('${inv.id}')">
      <span class="opp-rank">#${idx + 1}</span>
      <div class="opp-info">
        <span class="opp-name">${inv.name}</span>
        <span class="category-badge cat-${inv.category}">${inv.category}</span>
      </div>
      <div class="opp-score">
        <div class="score-bar"><div class="score-fill" style="width:${inv.target_audience_fit * 10}%"></div></div>
        <span>${inv.target_audience_fit}/10</span>
      </div>
      <span class="opp-cpm price-tag ${getPriceClass((inv.min_cpm+inv.max_cpm)/2)}">₹${Math.round((inv.min_cpm + inv.max_cpm) / 2)}</span>
    </div>
  `).join('');
}

async function loadInsightsFeed() {
  const insights = await api('/insights?unread=true');
  const container = document.getElementById('insights-feed');
  if (!insights || !insights.length) {
    container.innerHTML = '<p class="muted">No unread insights. All caught up!</p>';
    return;
  }
  container.innerHTML = insights.slice(0, 10).map(i => renderInsightCard(i)).join('');
}

async function loadCompetitorActivityWidget() {
  const container = document.getElementById('competitor-activity');
  // Fetch meta ads trends as activity proxy
  const trends = await api('/meta/trends');
  if (!trends || !trends.length) {
    container.innerHTML = '<p class="muted">No competitor activity data yet. Run a refresh to pull data.</p>';
    return;
  }
  container.innerHTML = trends.slice(0, 5).map(t => `
    <div class="activity-item">
      <span class="activity-theme">${t.theme || t.theme_tag || 'Unknown'}</span>
      <span class="activity-count">${t.count || 0} ads</span>
    </div>
  `).join('');
}

async function loadTrendingHooks() {
  const container = document.getElementById('trending-hooks');
  const trends = await api('/meta/trends');
  if (!trends || !trends.length) {
    container.innerHTML = '<p class="muted">Run Meta Ad Library refresh to see trending hooks.</p>';
    return;
  }
  const top3 = trends.slice(0, 3);
  container.innerHTML = top3.map((t, i) => `
    <div class="hook-item">
      <span class="hook-rank">#${i+1}</span>
      <span class="hook-name">${t.theme || t.theme_tag}</span>
      <span class="hook-count">${t.count} ads</span>
    </div>
  `).join('');
}

async function loadSilentCompetitors() {
  const container = document.getElementById('silent-competitors');
  const alerts = await api('/synthesis/alerts');
  if (!alerts) {
    container.innerHTML = '<p class="muted">No silent competitor data.</p>';
    return;
  }
  const silent = (alerts.silent || []);
  if (!silent.length) {
    container.innerHTML = '<p class="muted">All competitors active.</p>';
    return;
  }
  container.innerHTML = silent.map(s => `
    <div class="silent-item">
      <span class="silent-name">${s.name || s.competitor_name}</span>
      <span class="silent-days muted">${s.days_silent || '?'} days silent</span>
    </div>
  `).join('');
}
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
function resolveAuthHeader() {
  const candidates = [
    window.__ANALYTICS_AUTH_TOKEN__,
    window.__AUTH_TOKEN__,
    window.__PORTAL_AUTH_TOKEN__,
    localStorage.getItem('analytics_auth_token'),
    localStorage.getItem('auth_token'),
    localStorage.getItem('portal_auth_token'),
    localStorage.getItem('api_token'),
    sessionStorage.getItem('analytics_auth_token'),
    sessionStorage.getItem('auth_token'),
    sessionStorage.getItem('portal_auth_token')
  ];
  const token = candidates.find(v => typeof v === 'string' && v.trim());
  if (!token) return '';
  return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
}

async function api(path, options = {}) {
  try {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const authHeader = resolveAuthHeader();
    if (authHeader && !headers.Authorization) headers.Authorization = authHeader;
    const res = await fetch(`/api${path}`, {
      credentials: 'include',
      headers,
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
