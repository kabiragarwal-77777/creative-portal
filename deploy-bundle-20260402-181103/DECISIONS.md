# Decisions Log

## Architecture Decisions

### D1: Inventory Scanner Context
The inventory scanner tracks ad inventory CHANNELS (social, search, video platforms), not individual Meta adsets. The "inventory IDs" in the prompt refer to Meta adset IDs from the Creative Portal (app.js), but the inventory scanner uses SQLite UUIDs for channel tracking.

**Decision:** Agent 1 (Inventory Math Engine) will create a new backend module that pulls data from Meta API + Metabase for Univest's own campaign performance. This is separate from the existing inventory scanner DB. Agent 2 (Name Resolver) will resolve Meta adset IDs to names for the Creative Portal context. Agent 9 will add D6 CAC display to inventory scanner cards.

### D2: AI Model Selection
Prompt specifies Claude (claude-sonnet-4-20250514) for recommendations. Existing codebase uses OpenAI (gpt-5.4).

**Decision:** New AI features (Agent 3 recommendations, Agent 7/8 scripts) will use Anthropic Claude API as specified. Existing OpenAI calls remain untouched.

### D3: Competitor Brief Separation
Current briefs are generic (not per-competitor). Agent 4 requires per-competitor × per-vertical briefs.

**Decision:** Extend competitor-creative-briefs.js to support competitor+vertical filtering. Add new generateCompetitorBrief() function alongside existing generic brief generation.

### D4: Where to Add New Routes
Inventory scanner routes are in inventory-scanner/routes.js. Competitor routes are in competitor-routes.js (factory pattern). Trend scanner routes are in trend-scanner/routes.js.

**Decision:** Add new inventory engine routes to inventory-scanner/routes.js. Add new competitor brief routes to competitor-routes.js. Add trend scanner production context to trend-scanner/routes.js.

### D5: Anthropic SDK
The project has OpenAI SDK installed. Need to add @anthropic-ai/sdk for Claude API calls.

**Decision:** Will use axios for Claude API calls to avoid adding a new dependency, since ANTHROPIC_API_KEY is in .env.

### D6: Frontend Architecture
inventory-scanner/public/index.html uses js/app-bundle.js. ci.html is self-contained with inline JS. trend-scanner.html is self-contained with inline JS.

**Decision:** Add new UI elements inline to existing HTML files to match existing patterns. No new JS files for frontend.

---

## Audience Testing Module Decisions (2026-03-27)

### D7: Sidebar nav item vs ci-subtab-bar
creative.html had no existing ci-subtab-bar (CSS existed but was unused). Added Audience Testing as a sidebar `nav-item` with `data-view="audienceTesting"` — consistent with Intelligence, Simulator, Recommendations, Optimizer.

### D8: Module pattern follows google-creative
All agents use `module.exports = function(config) { ... return { ... }; }` matching the gc* agent pattern. Config object passed from server.js carries all credentials.

### D9: Claude API via axios
Existing inventory-engine.js uses direct axios calls to Anthropic API. Followed same pattern. Model: claude-sonnet-4-20250514.

### D10: Frontend without Chart.js
Used pure CSS bar charts instead of adding Chart.js dependency. Keeps bundle light.

### D11: Scheduler bootstrap
atScheduler.js self-initializes on require() with 45s delay. Auto-triggers first full scan if DB is empty. Matches feScheduler pattern.
