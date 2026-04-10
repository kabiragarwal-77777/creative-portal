# Enhancement Audit — Agent 0 Output

## INVENTORY SCANNER
- **Current budget planner logic:** Uses `agents.compareBudgets(ids)` and `agents.getBudgetRecommendation(inventoryId)` from consolidated agents.js. Budget allocation based on audience fit score, CPM range, competitor density. No D6 CAC calculation exists in inventory scanner.
- **Current CAC calculation:** NOT implemented in inventory scanner. D6 CAC is calculated only in app.js (Creative Portal) via `deriveMetrics()` — `d6CAC = spend / d6_overall_con`. The inventory scanner has NO financial metrics from Metabase.
- **Current inventory naming:** Uses human-readable names from SQLite DB (e.g., "Zerodha", "StockGro") — these are competitor/platform names, NOT Meta adset IDs. The inventory scanner tracks ad inventory channels (social, search, video, etc.), not individual Meta adsets.
- **Backend routes:** /api/inventories/, /api/budget/, /api/competitors/, /api/discovery/, /api/formats/, /api/insights/, /api/pricing/, /api/meta/, /api/google/, /api/synthesis/, /api/onboarding/
- **Server:** inventory-scanner/server.js (Express, port 3000, SQLite via better-sqlite3)
- **Frontend:** inventory-scanner/public/index.html + js/app-bundle.js
- **Key files:** inventory-scanner/agents.js (consolidated 12 agent modules), inventory-scanner/routes.js (11 route modules)

## COMPETITOR INTELLIGENCE
- **Current creative generation:** competitor-creative-briefs.js generates 3 static + 3 video briefs using OpenAI gpt-5.4-mini. Briefs are generic (not per-competitor or per-vertical). Context built from trends, classified ads, and radar.
- **Current link structure:** Ad cards use `ad_snapshot_url` from Meta API. Demo data has `ad_snapshot_url: null`. No direct Meta Ad Library links. `.ad-library-link` CSS class exists but links are basic.
- **Current filters available:** Vertical (RA/Broking/Both), Competitors (multi-select dropdown), Date Range (7d/30d/90d/6m/Custom), Mode (Overview/Deep Dive). Theme pills in module-a for ad filtering.
- **Backend routes:** /api/competitor/ads, /api/competitor/classified, /api/competitor/trends, /api/competitor/radar, /api/competitor/briefs, /api/competitor/briefs/refresh, /api/competitor/scheduler/status, /api/competitor/scheduler/run/:jobName, /api/competitor/cache-status
- **Key files:** competitor-routes.js (factory), competitor-meta-fetcher.js, competitor-classifier.js, competitor-trends.js, competitor-radar.js, competitor-creative-briefs.js, competitor-scheduler.js

## TREND SCANNER
- **Current script generation prompt:** In trend-scanner/agents/scriptAgent.js. System prompt defines Univest brand (purple #6c5ce7, teal #00d4aa), performance ad principles (D6 ROAS >28%), video/static rules. User prompt sends trend context (topic, description, univest_angle, emotion, signal, urgency, market_mood, hook_ideas).
- **Current context fields:** trend_id, topic, description, sources, signal_strength, trend_longevity, univest_angle, audience_emotion, ad_opportunity, urgency, hook_ideas, supporting_data, market_mood
- **Missing fields:** No script_style, talent_direction, shooting_setup, hinglish toggle. No production notes section.
- **Backend routes:** /api/trends/status, /api/trends/data, /api/trends/scan, /api/trends/concepts/:trendId/:format, /api/trends/raw
- **Key files:** trend-scanner/routes.js, trend-scanner/agents/scriptAgent.js, trend-scanner/agents/synthAgent.js, trend-scanner.html (self-contained with inline CSS/JS)
