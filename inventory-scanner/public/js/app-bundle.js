(function () {
  const root = document.getElementById('scanner-root');
  const STORAGE_KEY = 'univest.inventoryScanner.selectedInventories.v1';
  const CATALOG_PATHS = [
    '/inventory-scanner/scanner-catalog.json',
    '/inventory-scanner/public/data/scanner-catalog.json'
  ];
  const ROUTES = {
    discovery: '/inventory-scanner/',
    budget: '/inventory-scanner/budget-planner/'
  };
  function resolveAuthHeader() {
    if (window.PortalAuth && typeof window.PortalAuth.getHeaders === 'function') {
      const helperHeaders = window.PortalAuth.getHeaders() || {};
      if (helperHeaders.Authorization) return helperHeaders.Authorization;
    }
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
  function buildAuthHeaders(extra = {}) {
    const headers = { ...(extra || {}) };
    const authHeader = resolveAuthHeader();
    if (authHeader && !headers.Authorization) headers.Authorization = authHeader;
    return headers;
  }
  const COMPETITORS = ['Motilal Oswal', 'ICICI Direct', 'Mirae Asset', 'Axis MF', 'SBI MF'];
  const MODELS = ['CPM', 'CPC', 'CPL', 'CPV', 'Fixed'];
  const CURATED = [
    ['google-search', 'Google Search', 'Google', 'CPC', 10, 'self-serve'],
    ['google-demand-gen', 'Google Discovery / Demand Gen', 'Google', 'CPM', 8, 'self-serve'],
    ['google-display-network', 'Google Display Network (financial content placements only)', 'Google', 'CPM', 7, 'self-serve'],
    ['youtube-skippable', 'YouTube Skippable In-Stream', 'Google', 'CPV', 8, 'self-serve'],
    ['youtube-bumper', 'YouTube Non-Skippable (6s Bumper)', 'Google', 'CPM', 7, 'self-serve'],
    ['youtube-shorts', 'YouTube Shorts', 'Google', 'CPM', 6, 'self-serve'],
    ['facebook-feed', 'Meta Facebook Feed', 'Meta', 'CPM', 8, 'self-serve'],
    ['instagram-feed', 'Meta Instagram Feed', 'Meta', 'CPM', 7, 'self-serve'],
    ['instagram-reels', 'Instagram Reels', 'Meta', 'CPM', 7, 'self-serve'],
    ['meta-audience-network', 'Meta Audience Network (whitelisted placements only)', 'Meta', 'CPM', 5, 'self-serve'],
    ['linkedin-sponsored-content', 'LinkedIn Sponsored Content (financial professionals targeting)', 'LinkedIn', 'CPC', 9, 'self-serve'],
    ['linkedin-message-ads', 'LinkedIn Message Ads (InMail)', 'LinkedIn', 'CPC', 8, 'self-serve'],
    ['moneycontrol', 'Moneycontrol Display & Native', 'Direct Buy', 'CPM', 10, 'direct'],
    ['economic-times', 'Economic Times (ET) Display & Sponsored Content', 'Direct Buy', 'CPM', 9, 'direct'],
    ['mint-display', 'Mint (HT Media) Display', 'Direct Buy', 'CPM', 9, 'direct'],
    ['business-standard', 'Business Standard Digital', 'Direct Buy', 'CPM', 8, 'direct'],
    ['ndtv-profit', 'NDTV Profit Display', 'Direct Buy', 'CPM', 8, 'direct'],
    ['value-research-online', 'Value Research Online (direct buy)', 'Direct Buy', 'CPM', 10, 'direct'],
    ['livemint-newsletter', 'Livemint Newsletter Sponsorship', 'Direct Buy', 'Fixed', 9, 'direct'],
    ['jiocinema-preroll', 'JioCinema Pre-Roll (financial content adjacency)', 'Direct Buy', 'CPM', 6, 'direct'],
    ['hotstar-preroll', 'Hotstar / Disney+ Hotstar Pre-Roll', 'Direct Buy', 'CPM', 7, 'direct'],
    ['spotify-audio', 'Spotify Audio Ads (India)', 'Direct Buy', 'CPM', 6, 'direct'],
    ['times-of-india', 'Times of India Digital Display', 'Direct Buy', 'CPM', 6, 'direct'],
    ['bse-nse-investor-portal', 'BSE/NSE Investor Portal (if available for direct buy)', 'Direct Buy', 'Fixed', 10, 'direct'],
    ['google-performance-max', 'Google Performance Max', 'Google', 'CPM', 8, 'self-serve'],
    ['meta-advantage-plus', 'Meta Advantage+ Shopping (configured for lead gen)', 'Meta', 'CPM', 7, 'self-serve'],
    ['taboola', 'Taboola (financial content sites whitelist)', 'Programmatic', 'CPC', 7, 'programmatic'],
    ['outbrain', 'OutBrain (financial content sites whitelist)', 'Programmatic', 'CPC', 7, 'programmatic']
  ].map(([inventory_id, name, platform, primary_cost_model, audience_quality_score, buy_type]) => ({
    inventory_id, name, platform, primary_cost_model, audience_quality_score, buy_type,
    cost_model: [primary_cost_model], status: 'available', competitors_active: COMPETITORS.slice(),
    pricing: null, predicted_cac_range: { low: 0, mid: 0, high: 0 }, predicted_roas_d6: { low: 0, high: 0 },
    live_data: null, observed_cvr: 0.032, confidence_level: 'Low', min_budget: 0, time_to_go_live: '24-48 hours'
  }));

  const state = {
    route: getRoute(),
    loading: true,
    syncing: false,
    warning: false,
    lastSyncedAt: localStorage.getItem('univest.inventoryScanner.lastSyncedAt') || '',
    discovery: [],
    catalog: { inventories: [], watchlist: [] },
    inventories: CURATED,
    drawerId: '',
    filters: { costModel: 'ALL', platform: 'ALL', audienceScore: 1, buyType: 'ALL', sortBy: 'cac' },
    search: '',
    selectedIds: loadSelected(),
    budget: { totalBudget: '250000', durationDays: '14', goal: 'balanced' },
    plan: null
  };

  init();

  function getRoute() {
    const route = window.__SCANNER_INITIAL_ROUTE__ || new URLSearchParams(location.search).get('route') || '';
    return String(route).includes('budget') || location.pathname.includes('/budget-planner') ? 'budget' : 'discovery';
  }

  function loadSelected() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return Array.isArray(JSON.parse(raw || '[]')) ? JSON.parse(raw || '[]') : [];
    } catch {
      return [];
    }
  }

  function saveSelected() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.selectedIds));
  }

  function fmtINR(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '\u2014';
    return `\u20b9${Math.round(n).toLocaleString('en-IN')}`;
  }

  function fmtNum(value, digits = 1) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits).replace(/\.0+$/, '') : '0';
  }

  function round(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const scale = 10 ** digits;
    return Math.round(n * scale) / scale;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function priceFromCpm(cpm, ctrPercent) {
    if (!cpm || !ctrPercent) return 0;
    return cpm / (10 * ctrPercent);
  }

  function cpmFromCpc(cpc, ctrPercent) {
    if (!cpc || !ctrPercent) return 0;
    return cpc * 10 * ctrPercent;
  }

  function normalizePricing(basePricing, ctrBenchmark, cvr) {
    const pricing = JSON.parse(JSON.stringify(basePricing || {}));
    if (!pricing.CPC && pricing.CPM && ctrBenchmark) {
      pricing.CPC = {
        low: round(priceFromCpm(pricing.CPM.low, ctrBenchmark.high)),
        mid: round(priceFromCpm(pricing.CPM.mid, ctrBenchmark.mid)),
        high: round(priceFromCpm(pricing.CPM.high, ctrBenchmark.low))
      };
    }
    if (!pricing.CPM && pricing.CPC && ctrBenchmark) {
      pricing.CPM = {
        low: round(cpmFromCpc(pricing.CPC.low, ctrBenchmark.low)),
        mid: round(cpmFromCpc(pricing.CPC.mid, ctrBenchmark.mid)),
        high: round(cpmFromCpc(pricing.CPC.high, ctrBenchmark.high))
      };
    }
    if (!pricing.CPL && pricing.CPC) {
      pricing.CPL = {
        low: round(pricing.CPC.low / cvr),
        mid: round(pricing.CPC.mid / cvr),
        high: round(pricing.CPC.high / cvr)
      };
    }
    return pricing;
  }

  function predictionSpreadFor(entry, overlay) {
    if (overlay?.spend > 0) return 0.12;
    if (entry.benchmark_confidence === 'high') return 0.16;
    if (entry.benchmark_confidence === 'medium') return 0.22;
    return 0.28;
  }

  function buildPredictions(pricing, entry, overlay) {
    const leadToClient = 0.18;
    const revenuePerClient = 8000;
    const effectiveCpc = Number(overlay?.current_cpc || pricing.CPC?.mid || 0);
    const effectiveCpl = effectiveCpc > 0 ? effectiveCpc / (entry.observed_cvr || 0.032) : Number(pricing.CPL?.mid || 0);
    const midCac = effectiveCpl ? effectiveCpl / leadToClient : 0;
    const spread = predictionSpreadFor(entry, overlay);
    const lowCac = midCac ? midCac * (1 - spread) : 0;
    const highCac = midCac ? midCac * (1 + spread) : 0;
    const revenuePerLead = revenuePerClient * leadToClient;
    return {
      predicted_cac_range: { low: round(lowCac), mid: round(midCac), high: round(highCac) },
      predicted_roas_d6: {
        low: highCac ? round(revenuePerLead / highCac, 2) : 0,
        high: lowCac ? round(revenuePerLead / lowCac, 2) : 0
      }
    };
  }

  function buildInventoryEntry(entry, overlay) {
    const cvr = Number(entry.observed_cvr) > 0 ? Number(entry.observed_cvr) : 0.032;
    const pricing = normalizePricing(entry.pricing, entry.ctr_benchmark, cvr);
    const predictions = buildPredictions(pricing, { ...entry, observed_cvr: cvr }, overlay);
    return {
      ...entry,
      pricing,
      ...predictions,
      observed_cvr: cvr,
      status: overlay?.spend > 0 ? 'active' : entry.status || 'available',
      live_data: overlay ? {
        monthly_spend: round(overlay.spend || 0),
        current_cpm: round(overlay.current_cpm || 0),
        current_cpc: round(overlay.current_cpc || 0),
        efficiency_vs_benchmark_pct: overlay.efficiency_vs_benchmark_pct ?? null
      } : null
    };
  }

  function fmtDate(value) {
    if (!value) return 'Not synced yet';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return 'Not synced yet';
    return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function midPrice(item) {
    const pricing = item.pricing || {};
    const primary = pricing[item.primary_cost_model]?.mid;
    if (Number(primary) > 0) return Number(primary);
    for (const model of MODELS) {
      const v = pricing[model]?.mid;
      if (Number(v) > 0) return Number(v);
    }
    return 0;
  }

  function priceLabel(item) {
    const mid = midPrice(item);
    return mid ? `${item.primary_cost_model} ${fmtINR(mid)}` : `${item.primary_cost_model} loading`;
  }

  function cacObjectiveLabel(item) {
    const name = String(item?.name || '').toLowerCase();
    const buyType = String(item?.buy_type || '').toLowerCase();
    const costModel = String(item?.primary_cost_model || '').toUpperCase();
    if (/(shopping|purchase|commerce|retail)/.test(name)) return 'Purchase';
    if (buyType === 'programmatic') return 'Purchase';
    if (costModel === 'CPL' || costModel === 'CPC' || buyType === 'self-serve' || /lead|signup|lead gen/.test(name)) return 'Signup';
    if (buyType === 'direct') return 'Purchase';
    return 'Signup';
  }

  function cacLabel(item) {
    return `Predicted CAC (${cacObjectiveLabel(item)})`;
  }

  function rangeText(range) {
    if (!range) return '\u2014';
    return `${fmtINR(range.low)} \u2013 ${fmtINR(range.high)}`;
  }

  function roasText(range) {
    if (!range) return '\u2014';
    return `${fmtNum(range.low, 2)} \u2013 ${fmtNum(range.high, 2)}`;
  }

  function scoreClass(score) {
    if (score >= 8) return 'h';
    if (score >= 5) return 'm';
    return 'l';
  }

  function currentSpend(item) {
    return fmtINR(item.live_data?.monthly_spend || item.current_monthly_spend || 0);
  }

  function filterInventories() {
    return state.inventories.filter(item => {
      if (state.filters.costModel !== 'ALL' && item.primary_cost_model !== state.filters.costModel) return false;
      if (state.filters.platform !== 'ALL' && item.platform !== state.filters.platform) return false;
      if (state.filters.buyType !== 'ALL' && item.buy_type !== state.filters.buyType) return false;
      if (Number(item.audience_quality_score) < Number(state.filters.audienceScore)) return false;
      return true;
    }).sort((a, b) => {
      if (state.filters.sortBy === 'roas') return (b.predicted_roas_d6.high || 0) - (a.predicted_roas_d6.high || 0);
      if (state.filters.sortBy === 'cpm') return midPrice(a) - midPrice(b);
      if (state.filters.sortBy === 'audience') return b.audience_quality_score - a.audience_quality_score;
      return (a.predicted_cac_range.mid || 1e9) - (b.predicted_cac_range.mid || 1e9);
    });
  }

  function selectedInventories() {
    const map = new Map(state.inventories.map(item => [item.inventory_id, item]));
    return state.selectedIds.map(id => map.get(id)).filter(Boolean);
  }

  async function fetchSnapshot(force = false) {
    state.syncing = force;
    render();
    try {
      const res = await fetch(force ? '/api/inventories/sync' : '/api/inventories/discovery', {
        method: force ? 'POST' : 'GET',
        credentials: 'include',
        headers: buildAuthHeaders(force ? { 'Content-Type': 'application/json' } : {}),
        body: force ? '{}' : undefined
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'scanner');
      const map = new Map((json.data?.inventories || []).map(item => [item.inventory_id, item]));
      state.inventories = state.catalog.inventories.length
        ? state.catalog.inventories.map(item => buildInventoryEntry(item, map.get(item.inventory_id)))
        : CURATED.map(item => buildInventoryEntry(item, map.get(item.inventory_id)));
      state.warning = Boolean(json.data?.warning);
      state.lastSyncedAt = json.data?.lastSyncedAt || json.data?.generatedAt || state.lastSyncedAt;
      if (state.lastSyncedAt) localStorage.setItem('univest.inventoryScanner.lastSyncedAt', state.lastSyncedAt);
      state.discovery = Array.isArray(json.data?.discovery?.candidates) ? json.data.discovery.candidates : [];
      state.loading = false;
      state.syncing = false;
      saveSelected();
      render();
    } catch {
      state.loading = false;
      state.syncing = false;
      state.warning = true;
      render();
    }
  }

  function addSelected(id) {
    if (!state.selectedIds.includes(id)) state.selectedIds.push(id);
    saveSelected();
  }

  function removeSelected(id) {
    state.selectedIds = state.selectedIds.filter(v => v !== id);
    saveSelected();
    state.plan = null;
    render();
  }

  function setRoute(route, replace = false) {
    state.route = route === 'budget' ? 'budget' : 'discovery';
    const path = ROUTES[state.route];
    if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState']({}, '', path);
    render();
  }

  function openDrawer(id) {
    state.drawerId = id;
    render();
  }

  function closeDrawer() {
    state.drawerId = '';
    render();
  }

  function drawerItem() {
    return state.inventories.find(item => item.inventory_id === state.drawerId) || null;
  }

  function renderSidebar() {
    return `
      <aside class="sidebar">
        <div class="brand">
          <div class="kicker">Univest</div>
          <div class="title">Inventory Scanner</div>
          <div class="sub">Daily discovery and budget planning for financial advisory inventory.</div>
        </div>
        <nav class="nav">
          <button type="button" class="nav-item ${state.route === 'discovery' ? 'active' : ''}" data-action="route" data-route="discovery">Inventory Discovery</button>
          <button type="button" class="nav-item ${state.route === 'budget' ? 'active' : ''}" data-action="route" data-route="budget">Budget Planner</button>
          <div class="nav-item locked">🔒 Competitor Map<small>Coming soon</small></div>
          <div class="nav-item locked">🔒 Discovery Log<small>Coming soon</small></div>
          <div class="nav-item locked">🔒 Live Ad Monitor<small>Coming soon</small></div>
          <div class="nav-item locked">🔒 Keyword Intel<small>Coming soon</small></div>
          <div class="nav-item locked">🔒 Competitive Timeline<small>Coming soon</small></div>
        </nav>
        <div class="foot">
          <div>Daily discovery watchlist enabled</div>
          <div>Live Google Ads + Meta API overlay</div>
        </div>
      </aside>
    `;
  }

  function renderDiscoverySuggestions() {
    const discovery = (state.discovery.length ? state.discovery : state.catalog.watchlist).filter(item => item.status !== 'error').slice(0, 6);
    return `
      <section class="section">
        <h3>Daily Discovery Watchlist</h3>
        ${discovery.length
          ? `<ul class="bullets">${discovery.map(item => `<li><strong>${esc(item.name || item.id)}</strong> - ${esc(item.status || 'watching')}</li>`).join('')}</ul>`
          : '<div class="empty compact">No new suggestions right now. The watchlist is checking finance publishers and ad surfaces daily.</div>'}
      </section>
    `;
  }

  function renderDiscovery() {
    const cards = filterInventories();
    const cachedLabel = state.lastSyncedAt ? fmtDate(state.lastSyncedAt) : 'Not synced yet';
    return `
      <section class="page">
        <header class="header">
          <div>
            <div class="page-kicker">Inventory Discovery</div>
            <h1>Inventory Discovery</h1>
            <p>Inventories where Univest can run paid ads - updated from live API data.</p>
          </div>
          <div class="header-right">
            <div class="synced">Last synced: <strong>${esc(fmtDate(state.lastSyncedAt))}</strong></div>
            <div class="synced" style="opacity:.85">Cached version: <strong>${esc(cachedLabel)}</strong></div>
            <button type="button" class="btn primary" data-action="sync" ${state.syncing ? 'disabled' : ''}>${state.syncing ? 'Syncing...' : 'Sync with Google & Meta'}</button>
          </div>
        </header>
        ${state.warning ? `<div class="banner">API unavailable - showing cached data from ${esc(cachedLabel)} while fresh data loads.</div>` : ''}
        ${renderDiscoverySuggestions()}
        <div class="filters">
          ${filterSelect('costModel', 'Cost Model', ['ALL', ...MODELS])}
          ${filterSelect('platform', 'Platform', ['ALL', 'Google', 'Meta', 'LinkedIn', 'Direct Buy', 'Programmatic'])}
          ${sliderFilter()}
          ${filterSelect('buyType', 'Buy Type', ['ALL', 'self-serve', 'direct', 'programmatic'], { selfServeLabel: true })}
          ${filterSelect('sortBy', 'Sort by', ['cac', 'roas', 'cpm', 'audience'], {
            labelMap: { cac: 'CAC low to high', roas: 'ROAS high to low', cpm: 'CPM low to high', audience: 'Audience Score' }
          })}
        </div>
        <div class="grid">
          ${cards.map(cardMarkup).join('')}
        </div>
        ${cards.length ? '' : '<div class="empty">No inventories match the current filters.</div>'}
      </section>
    `;
  }

  function filterSelect(key, label, values, opts = {}) {
    return `
      <label class="pill">
        <span>${label}</span>
        <select data-action="filter" data-filter="${key}">
          ${values.map(value => {
            const display = opts.labelMap?.[value] || (opts.selfServeLabel && value === 'self-serve' ? 'Self-Serve' : value === 'direct' ? 'Direct' : value === 'programmatic' ? 'Programmatic' : value);
            return `<option value="${esc(value)}"${state.filters[key] === value ? ' selected' : ''}>${esc(display)}</option>`;
          }).join('')}
        </select>
      </label>
    `;
  }

  function sliderFilter() {
    return `
      <label class="pill range">
        <span>Audience Score ${state.filters.audienceScore}+</span>
        <input type="range" min="1" max="10" step="1" value="${state.filters.audienceScore}" data-action="audience">
      </label>
    `;
  }

  function cardMarkup(item) {
    const active = item.status === 'active';
    return `
      <button type="button" class="card" data-action="open" data-id="${esc(item.inventory_id)}">
        <div class="top">
          <div>
            <div class="name">${esc(item.name)}</div>
            <div class="platform">${esc(item.platform)}</div>
          </div>
          <span class="status ${active ? 'active' : 'avail'}">${active ? 'active' : 'available'}</span>
        </div>
        <div class="price">${esc(priceLabel(item))}</div>
        <div class="meta">
          <span class="score ${scoreClass(item.audience_quality_score)}">${item.audience_quality_score}/10</span>
          <span>${esc(cacLabel(item))} ${esc(rangeText(item.predicted_cac_range))}</span>
        </div>
        <div class="meta">
          <span>${String(item.competitors_active?.length || 0)} competitors active</span>
          ${active ? `<span>Monthly spend ${esc(currentSpend(item))}</span>` : '<span>Not yet active</span>'}
        </div>
      </button>
    `;
  }

  function renderDrawer() {
    const item = drawerItem();
    if (!item) return '';
    return `
      <aside class="drawer open">
        <div class="drawer-head">
          <div>
            <div class="drawer-title">${esc(item.name)}</div>
            <div class="drawer-sub">${esc(item.platform)} · ${esc(priceLabel(item))}</div>
          </div>
          <button type="button" class="icon" data-action="close">×</button>
        </div>
        <div class="drawer-body">
          <section>
            <h3>Pricing Breakdown</h3>
            <div class="table">
              <table>
                <thead><tr><th>Model</th><th>Low</th><th>Mid</th><th>High</th></tr></thead>
                <tbody>${pricingRows(item)}</tbody>
              </table>
            </div>
            <div class="line">Minimum budget: <strong>${esc(fmtINR(item.min_budget))}</strong></div>
            <div class="line">Buy type: <strong>${esc(capitalize(item.buy_type))}</strong></div>
          </section>
          <section>
            <h3>Competitor Intelligence</h3>
            <div class="line">${String(item.competitors_active?.length || 0)} financial advisory brands confirmed active</div>
            <ul class="bullets">${(item.competitors_active || COMPETITORS).map(name => `<li>${esc(name)}</li>`).join('')}</ul>
            ${item.status === 'active' ? `
              <div class="info-grid">
                <div class="info"><span>Current CPM</span><strong>${esc(fmtINR(item.live_data?.current_cpm || 0))}</strong></div>
                <div class="info"><span>Monthly spend</span><strong>${esc(currentSpend(item))}</strong></div>
                <div class="info"><span>Efficiency vs benchmark</span><strong>${item.live_data?.efficiency_vs_benchmark_pct != null ? `${fmtNum(item.live_data.efficiency_vs_benchmark_pct, 1)}%` : '—'}</strong></div>
              </div>
            ` : ''}
          </section>
          <section>
            <h3>Predicted Performance (D6 estimates)</h3>
            <div class="metric"><span>${esc(cacLabel(item))}</span><strong>${esc(rangeText(item.predicted_cac_range))}</strong></div>
            <div class="metric"><span>Predicted ROAS (D6)</span><strong>${esc(roasText(item.predicted_roas_d6))}x</strong></div>
            <div class="line">Basis: Calculated using Univest's observed CVR of ${fmtNum((item.observed_cvr || 0.032) * 100, 1)}% and ₹8,000 avg D6 revenue.</div>
            <div class="line">Confidence level: <strong>${esc(item.confidence_level || 'Low')}</strong></div>
          </section>
          <section>
            <h3>How to Start</h3>
            <ol class="bullets num">
              <li>${esc(item.how_to_start || 'Open the campaign creation flow and set the inventory-specific targeting.')}</li>
              <li>${esc(item.access_notes || 'Use the correct self-serve or direct-buy access path.')}</li>
              <li>${esc(item.start_url ? `Start here: ${item.start_url}` : 'Use the publisher or platform booking path.')}</li>
            </ol>
            <div class="line">Estimated time to go live: <strong>${esc(item.time_to_go_live || '24-48 hours')}</strong></div>
            <div class="line">SEBI compliance note: ${esc(item.sebi_compliance_note || 'Keep disclosures visible and avoid assured-return claims.')}</div>
          </section>
          <section>
            <button type="button" class="btn primary full" data-action="add-to-planner" data-id="${esc(item.inventory_id)}">Add to Budget Planner</button>
          </section>
        </div>
      </aside>
    `;
  }

  function pricingRows(item) {
    const pricing = item.pricing || {};
    const rows = MODELS.filter(model => pricing[model]).map(model => {
      const band = pricing[model];
      return `<tr><td>${esc(model)}</td><td>${esc(fmtINR(band.low))}</td><td>${esc(fmtINR(band.mid))}</td><td>${esc(fmtINR(band.high))}</td></tr>`;
    });
    return rows.length ? rows.join('') : '<tr><td colspan="4">Pricing data unavailable.</td></tr>';
  }

  function capitalize(value) {
    return String(value || '').replace(/(^|\s)\S/g, bit => bit.toUpperCase());
  }

  function renderBudget() {
    const selected = selectedInventories();
    return `
      <section class="page">
        <header class="header">
          <div>
            <div class="page-kicker">Budget Planner</div>
            <h1>Budget Planner</h1>
            <p>Take selected inventories and a test budget, then output a complete launch plan.</p>
          </div>
        </header>
        <div class="planner">
          <section class="panel">
            <div class="head"><h2>Inventory Selection</h2><span>${selected.length} selected</span></div>
            <div class="search">
              <input type="text" list="inventory-options" placeholder="Search inventory name" value="${esc(state.search)}" data-action="search">
              <button type="button" class="btn" data-action="add-search">Add</button>
              <datalist id="inventory-options">${state.inventories.map(item => `<option value="${esc(item.name)}"></option>`).join('')}</datalist>
            </div>
            ${selected.length > 5 ? '<div class="banner">More than 5 inventories selected. The top 5 will be used in the plan.</div>' : ''}
            <div class="selected">
              ${selected.length ? selected.map(item => `
                <div class="row">
                  <div>
                    <div class="sel-name">${esc(item.name)}</div>
                    <div class="sel-meta">${esc(item.primary_cost_model)} · ${esc(cacLabel(item))} ${esc(rangeText(item.predicted_cac_range))}</div>
                  </div>
                  <button type="button" class="icon small" data-action="remove" data-id="${esc(item.inventory_id)}">×</button>
                </div>
              `).join('') : '<div class="empty compact">Add inventories from the search field or from discovery cards.</div>'}
            </div>
          </section>
          <section class="panel">
            <div class="head"><h2>Budget Input</h2><span>Test budget and launch goal</span></div>
            <label class="input"><span>Total Test Budget (₹)</span><input type="number" min="0" step="1" value="${esc(state.budget.totalBudget)}" data-action="budget" data-field="totalBudget"></label>
            <div class="radio">
              <span>Duration</span>
              ${radio('durationDays', '14', '14 days')}${radio('durationDays', '21', '21 days')}${radio('durationDays', '30', '30 days')}
            </div>
            <div class="radio">
              <span>Goal</span>
              ${radio('goal', 'maximize-leads', 'Maximize Leads')}${radio('goal', 'minimize-cac', 'Minimize CAC')}${radio('goal', 'balanced', 'Balanced')}
            </div>
            <button type="button" class="btn primary full" data-action="plan">Generate Plan</button>
            ${selected.length ? '' : '<div class="line">Select at least one inventory to generate a plan.</div>'}
          </section>
          <section class="panel">
            <div class="head"><h2>Generated Plan</h2><span>${state.plan ? 'Ready' : 'Waiting for generation'}</span></div>
            <div data-plan-output>${state.plan ? planMarkup() : '<div class="empty">Click Generate Plan to build allocation, initiation, watch metrics, and compliance guidance.</div>'}</div>
          </section>
        </div>
      </section>
    `;
  }

  function radio(field, value, label) {
    return `<label><input type="radio" name="${field}" value="${value}" ${state.budget[field] === value ? 'checked' : ''} data-action="budget-radio" data-field="${field}"> ${label}</label>`;
  }

  function planMarkup() {
    const plan = state.plan;
    const rows = (plan.budget_allocation_table || []).map(row => `
      <tr>
        <td data-label="Inventory">${esc(row.inventory)}</td>
        <td data-label="Allocation %">${esc(fmtNum(row.allocation_pct, 1))}%</td>
        <td data-label="Allocated Budget">${esc(fmtINR(row.allocated_budget))}</td>
        <td data-label="Expected Conversions">${esc(fmtNum(row.expected_conversions, 1))}</td>
        <td data-label="Expected CAC">${esc(fmtINR(row.expected_cac))}</td>
        <td data-label="Expected D6 ROAS">${esc(fmtNum(row.expected_roas_d6, 2))}x</td>
        <td data-label="Rationale">${esc(row.rationale)}</td>
      </tr>
    `).join('');
    const c = plan.compliance_checklist || {};
    return `
      <div class="stack">
        ${plan.selection_warning ? `<div class="banner">${esc(plan.selection_warning)}</div>` : ''}
        <section class="section">
          <h3>Budget Allocation Table</h3>
          <div class="table">
            <table>
              <thead><tr><th>Inventory</th><th>Allocation %</th><th>Allocated Budget</th><th>Expected Conversions</th><th>Expected CAC</th><th>Expected D6 ROAS</th><th>Rationale</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </section>
        <section class="section">
          <h3>Initiation Sequence</h3>
          <div class="line">${esc(plan.initiation_sequence.phase_1)}</div>
          <div class="line">${esc(plan.initiation_sequence.phase_2)}</div>
          <div class="line">${esc(plan.initiation_sequence.phase_3)}</div>
        </section>
        <section class="section">
          <h3>Watch Metrics</h3>
          <div class="line">Primary KPI: ${esc(plan.watch_metrics.primary_kpi)}</div>
          <div class="line">Secondary: ${esc(plan.watch_metrics.secondary_kpi)}</div>
          <div class="line">Red flag: ${esc(plan.watch_metrics.red_flag || '—')}</div>
        </section>
        <section class="section">
          <h3>Compliance Checklist</h3>
          <div class="line">SEBI disclaimer required on: ${esc((c.sebi_disclaimer_required_on || []).join(', '))}</div>
          <div class="line">Google financial services verification: ${esc(c.google_financial_services_verification || '—')}</div>
          <div class="line">Meta financial products policy: ${esc(c.meta_financial_products_policy || '—')}</div>
        </section>
      </div>
    `;
  }

  function generatePlan() {
    const selected = selectedInventories();
    if (!selected.length) {
      state.plan = {
        selection_warning: 'Select at least one inventory before generating a plan.',
        budget_allocation_table: [],
        initiation_sequence: { phase_1: 'No plan generated yet.', phase_2: '', phase_3: '' },
        watch_metrics: { primary_kpi: 'Cost per Lead', secondary_kpi: 'Lead-to-meeting rate', red_flag: 'Unavailable' },
        compliance_checklist: { sebi_disclaimer_required_on: [], google_financial_services_verification: 'Unavailable', meta_financial_products_policy: 'Unavailable' }
      };
      render();
      scrollToPlan();
      return;
    }
    state.plan = buildLocalPlan(selected, {
      totalBudget: Number(state.budget.totalBudget || 0),
      durationDays: Number(state.budget.durationDays || 14),
      goal: state.budget.goal
    });
    render();
    scrollToPlan();
  }

  function scrollToPlan() {
    window.requestAnimationFrame(() => {
      const target = document.querySelector('[data-plan-output]');
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  function buildLocalPlan(selected, budget) {
    const topFive = [...selected]
      .sort((a, b) => (b.audience_quality_score || 0) - (a.audience_quality_score || 0) || (a.predicted_cac_range.mid || 1e9) - (b.predicted_cac_range.mid || 1e9))
      .slice(0, 5);
    const totalBudget = Math.max(0, Number(budget.totalBudget || 0));
    const goal = budget.goal || 'balanced';
    const durationDays = Number(budget.durationDays || 14);
    const activeAnchor = topFive.find(item => item.status === 'active' && (item.platform === 'Google' || item.platform === 'Meta')) || null;
    const weights = topFive.map(item => goalWeight(item, goal));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0) || topFive.length || 1;
    let allocations = topFive.map((item, idx) => Math.max(totalBudget * 0.15, totalBudget * (weights[idx] / totalWeight)));
    if (activeAnchor && totalBudget > 0) {
      const anchorIndex = topFive.findIndex(item => item.inventory_id === activeAnchor.inventory_id);
      allocations[anchorIndex] = Math.max(allocations[anchorIndex], totalBudget * 0.2);
    }
    const allocatedTotal = allocations.reduce((sum, value) => sum + value, 0) || 1;
    const scale = totalBudget > 0 ? totalBudget / allocatedTotal : 0;
    allocations = allocations.map(value => round(value * scale));
    const budget_allocation_table = topFive.map((item, idx) => {
      const allocatedBudget = allocations[idx];
      const midCac = Number(item.predicted_cac_range?.mid || 0);
      const expectedConversions = midCac ? round((allocatedBudget / midCac) * 0.85, 1) : 0;
      const expectedRoasD6 = midCac ? round((8000 * 0.18) / midCac, 2) : 0;
      return {
        inventory: item.name,
        allocation_pct: totalBudget ? round((allocatedBudget / totalBudget) * 100, 1) : 0,
        allocated_budget: round(allocatedBudget),
        expected_conversions: expectedConversions,
        expected_cac: midCac ? round(midCac) : 0,
        expected_roas_d6: expectedRoasD6,
        rationale: goalRationale(item, goal)
      };
    });
    const highestCac = budget_allocation_table.length ? Math.max(...budget_allocation_table.map(row => Number(row.expected_cac || 0))) : 0;
    return {
      budget_allocation_table,
      initiation_sequence: {
        phase_1: `Day 1-3: Launch ${budget_allocation_table.slice(0, 2).map(row => row.inventory).join(' and ')} first because they have the strongest fit and fastest signal.`,
        phase_2: `Day 4-7: Add the next ${Math.max(0, budget_allocation_table.length - 2)} inventories once CPC/CPL trendlines settle.`,
        phase_3: `Day 8-${durationDays}: Scale the best 1-2 inventories if CPL stays below threshold and lead quality holds.`
      },
      watch_metrics: {
        primary_kpi: 'Cost per Lead',
        secondary_kpi: 'Lead-to-meeting rate',
        red_flag: highestCac ? `CPL > ${fmtINR(round(highestCac * 1.25))} for more than 3 days -> pause the weakest inventory.` : 'CPL spiking for more than 3 days -> pause the weakest inventory.'
      },
      compliance_checklist: {
        sebi_disclaimer_required_on: topFive.map(item => item.name),
        google_financial_services_verification: topFive.some(item => item.platform === 'Google') ? 'Check current verification status before launch.' : 'Not required for selected set.',
        meta_financial_products_policy: topFive.some(item => item.platform === 'Meta') ? 'Confirm finance-policy copy, disclaimers, and forbidden-claim rules.' : 'Not required for selected set.'
      },
      selection_warning: selected.length > 5 ? 'More than 5 inventories selected. The top 5 were used in this plan.' : ''
    };
  }

  function goalWeight(inventory, goal) {
    const audience = (inventory.audience_quality_score || 0) / 10;
    const cacComponent = inventory.predicted_cac_range?.mid ? 1 / inventory.predicted_cac_range.mid : 0;
    const cpmComponent = midPrice(inventory) ? 1 / midPrice(inventory) : 0;
    if (goal === 'maximize-leads') return cacComponent * 0.7 + audience * 0.3;
    if (goal === 'minimize-cac') return audience * 0.5 + cpmComponent * 0.5;
    return audience * 0.5 + cacComponent * 0.5;
  }

  function goalRationale(inventory, goal) {
    if (goal === 'maximize-leads') return 'Weighted toward lower predicted CAC to maximize lead volume.';
    if (goal === 'minimize-cac') return 'Weighted toward audience quality and lower CPM to protect CAC.';
    return 'Balanced allocation between audience quality and predicted CAC.';
  }

  function render() {
    document.body.className = state.route === 'budget' ? 'route-budget' : 'route-discovery';
    root.innerHTML = `
      <div class="shell">
        ${renderSidebar()}
        <main class="main">${state.route === 'discovery' ? renderDiscovery() : renderBudget()}</main>
        ${renderDrawer()}
      </div>
    `;
  }

  function init() {
    document.addEventListener('click', event => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      const type = action.dataset.action;
      if (type === 'route') setRoute(action.dataset.route);
      if (type === 'sync') fetchSnapshot(true);
      if (type === 'open') openDrawer(action.dataset.id);
      if (type === 'close') closeDrawer();
      if (type === 'add-to-planner') {
        addSelected(action.dataset.id);
        render();
      }
      if (type === 'add-search') {
        const match = state.inventories.find(item => item.name.toLowerCase() === state.search.trim().toLowerCase() || item.inventory_id.toLowerCase() === state.search.trim().toLowerCase());
        if (match) addSelected(match.inventory_id);
      }
      if (type === 'remove') removeSelected(action.dataset.id);
      if (type === 'plan') generatePlan();
    });

    document.addEventListener('input', event => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'audience') {
        state.filters.audienceScore = Number(event.target.value || 1);
        render();
      }
      if (action.dataset.action === 'search') {
        state.search = event.target.value;
      }
    });

    document.addEventListener('change', event => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'filter') {
        state.filters[action.dataset.filter] = event.target.value;
        render();
      }
      if (action.dataset.action === 'budget-radio') {
        state.budget[action.dataset.field] = event.target.value;
        state.plan = null;
        render();
      }
      if (action.dataset.action === 'budget') {
        state.budget[action.dataset.field] = event.target.value;
        state.plan = null;
      }
    });

    window.addEventListener('popstate', () => {
      state.route = getRoute();
      render();
    });

    loadCatalog().then(() => fetchSnapshot(false));
  }

  async function loadCatalog() {
    try {
      let json = null;
      for (const url of CATALOG_PATHS) {
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (res.ok) {
            json = await res.json();
            break;
          }
        } catch (_) {
          // try next path
        }
      }
      if (!json && window.__SCANNER_CATALOG__) json = window.__SCANNER_CATALOG__;
      if (!json) throw new Error('catalog');
      state.catalog = {
        inventories: Array.isArray(json.inventories) ? json.inventories : [],
        watchlist: Array.isArray(json.watchlist) ? json.watchlist : []
      };
      state.inventories = state.catalog.inventories.length
        ? state.catalog.inventories.map(item => buildInventoryEntry(item))
        : CURATED.map(item => buildInventoryEntry(item));
      state.loading = false;
      render();
    } catch {
      state.catalog = { inventories: [], watchlist: [] };
      state.inventories = CURATED.map(item => buildInventoryEntry(item));
      state.loading = false;
      render();
    }
  }
})();
