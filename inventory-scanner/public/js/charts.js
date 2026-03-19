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
