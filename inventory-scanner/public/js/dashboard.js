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
