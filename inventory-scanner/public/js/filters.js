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
