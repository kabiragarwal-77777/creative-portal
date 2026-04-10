# DATA PIPELINE AUDIT: Meta <-> Metabase Broken Joins

**Date:** 2026-03-26
**Auditor:** Agent 0 (Codebase Auditor)

---

## ROOT CAUSE

Metabase's `tracker_name` field (sourced from `user_additional_details.creative`) has the format:

```
{ad_name}:{meta_campaign_id}
```

For example: `FB_MOF_Video_HookTest_V1_100326:23854329875432`

The Metabase SQL queries correctly strip the `:` suffix using:
```sql
regexp_replace(ud.tracker_name, ':.*$', '', 'g') AS tracker_name
```

This yields the **ad name** portion only. The code then tries to JOIN Meta ad data to Metabase funnel data by **matching ad names as strings**. This is WRONG because:

1. **Name collisions**: Different ads across campaigns/adsets can share the same ad name
2. **Name normalization fragility**: The join relies on `.toLowerCase().trim().replace(/:.*$/, '')` which is brittle and loses data
3. **No campaign ID in the join**: The `tracker_name` contains the campaign ID after the colon, but this is stripped and discarded instead of being used as the join key

**CORRECT approach**: Extract the campaign ID via `SPLIT_PART(tracker_name, ':', 2)` in SQL, and join on `campaign_id` (numeric) instead of string name matching.

---

## BROKEN JOINS BY FILE

---

### FILE: `app.js` (Main Dashboard — fetchLiveData)

**BROKEN JOIN LINE 49:**
```js
const key = d + '|||' + (row.campaign_name || '') + '|||' + (row.ad_set_name || '').toLowerCase().trim() + '|||' + (row.tracker_name || '').replace(/:.*$/, '');
```
**FIX NEEDED:** The Metabase lookup key uses `tracker_name` with the colon suffix stripped (= ad name). This should instead extract the campaign ID from `tracker_name` via `SPLIT_PART(tracker_name, ':', 2)` in the SQL query, and build the key using `campaign_id` + `ad_id` or `campaign_id` + `adset_id`.

**BROKEN JOIN LINE 106:**
```js
const mbKey = (row.date_start || '') + '|||' + (row.campaign_name || '') + '|||' + (row.adset_name || '').toLowerCase().trim() + '|||' + (row.ad_name || '').replace(/:.*$/, '');
```
**FIX NEEDED:** The Meta-side key uses `ad_name` stripped of colon suffix to match against `tracker_name`. This is a string-name join. Should instead use `campaign_id` from Meta and match against the ID extracted from `tracker_name`.

**BROKEN JOIN LINE 327** (computeWoWTrends):
```js
const mbKey = d + '|||' + (row.campaign_name || '') + '|||' + (row.adset_name || '').toLowerCase().trim() + '|||' + (row.ad_name || '').replace(/:.*$/, '');
```
**FIX NEEDED:** Same pattern. Weekly trend computation uses the same broken string-name join.

**BROKEN JOIN LINE 831-836** (Metabase Import index — sheet fallback):
```js
const trackerName = (row['tracker_name'] || '').trim().toLowerCase();
// ... indexed by tracker_name string
```
**FIX NEEDED:** The sheet-based Metabase import indexes by `tracker_name` as a string. Should extract and index by campaign ID.

**BROKEN JOIN LINE 2072** (buildMetaKey for Campaign Tree):
```js
return serial + campaignName + adsetName.toLowerCase().trim() + adName.replace(/:.*$/, '');
```
**FIX NEEDED:** Campaign tree builds composite keys using string campaign name + ad name. Should use numeric campaign_id + ad_id.

**BROKEN JOIN LINE 2075-2080** (buildMetabaseKey):
```js
return serial + campaignName + adsetName + trackerName;
```
**FIX NEEDED:** Uses string campaign name + tracker name. Should use campaign_id extracted from the tracker_name colon suffix.

**BROKEN JOIN LINE 2123** (Campaign Tree Metabase lookup):
```js
const key = d + '|||' + row.campaign_name + '|||' + (row.ad_set_name || '').toLowerCase().trim() + '|||' + (row.tracker_name || '').replace(/:.*$/, '');
```
**FIX NEEDED:** Same broken pattern — string campaign_name + stripped tracker_name.

**BROKEN JOIN LINE 2179** (Campaign Tree Meta-side key):
```js
const mbKey = row.date_start + '|||' + row.campaign_name + '|||' + row.adset_name.toLowerCase().trim() + '|||' + row.ad_name.replace(/:.*$/, '');
```
**FIX NEEDED:** Uses string ad_name to match tracker_name. Should use campaign_id.

**BROKEN JOIN LINE 2756** (Weekly Breakdown Metabase lookup):
```js
const key = row.campaign_name + '|||' + (row.ad_set_name || '').toLowerCase().trim() + '|||' + (row.tracker_name || '').replace(/:.*$/, '');
```
**FIX NEEDED:** Same broken string name join for weekly breakdown.

**BROKEN JOIN LINE 2788** (Weekly Breakdown Meta-side key):
```js
const mbKey = row.campaign_name + '|||' + row.adset_name.toLowerCase().trim() + '|||' + row.ad_name.replace(/:.*$/, '');
```
**FIX NEEDED:** Same broken string name join.

---

### FILE: `optimizer.js` (Campaign Optimizer)

**BROKEN JOIN LINE 120:**
```js
var key = d + '|||' + row.campaign_name + '|||' + (row.ad_set_name || '').toLowerCase().trim() + '|||' + (row.tracker_name || '').replace(/:.*$/, '');
```
**FIX NEEDED:** Metabase-side key uses string campaign_name + stripped tracker_name.

**BROKEN JOIN LINE 171:**
```js
var mbKey = mr.date_start + '|||' + mr.campaign_name + '|||' + mr.adset_name.toLowerCase().trim() + '|||' + mr.ad_name.replace(/:.*$/, '');
```
**FIX NEEDED:** Meta-side key uses string ad_name to match tracker_name.

---

### FILE: `creative-intelligence/engine.js` (CI Engine — collectSnapshots)

**BROKEN JOIN LINE 204** (Metabase SQL):
```sql
regexp_replace(ud.tracker_name, ':.*$', '', 'g') AS tracker_name
```
**FIX NEEDED:** The SQL strips the campaign ID from tracker_name and discards it. Should also extract it: `SPLIT_PART(ud.tracker_name, ':', 2) AS tracker_campaign_id`.

**BROKEN JOIN LINE 225-226** (SQL SELECT):
```sql
sm.tracker_name,
sm.tracker_campaign_name AS campaign_name,
```
**FIX NEEDED:** Should also SELECT `sm.tracker_campaign_id` (the extracted ID from tracker_name).

**BROKEN JOIN LINE 279-294** (JavaScript merge — ad_name <-> tracker_name):
```js
function normAdName(name) {
    return name.toLowerCase().trim().replace(/:.*$/, '').replace('statics_', 'static_');
}
// ...
const key = normAdName(row.tracker_name);
funnelLookup[key] = row;
```
**FIX NEEDED:** The funnel lookup is built using normalized ad name strings. Should be keyed by campaign_id (extracted from tracker_name).

**BROKEN JOIN LINES 345-347** (Meta-side funnel matching):
```js
const funnelKey = normAdName(a.ad_name);
const funnelKeyStripped = stripPrefix(a.ad_name);
const funnel = funnelLookup[funnelKey] || funnelLookup[funnelKeyStripped] || {};
```
**FIX NEEDED:** Matches Meta ad_name against Metabase tracker_name via string comparison. Should match on campaign_id.

**BROKEN JOIN LINE 1050** (ROAS Tracker — Metabase lookup key):
```js
const key = d + '|||' + (row.campaign_name || '') + '|||' + (row.ad_set_name || '').toLowerCase().trim() + '|||' + (row.tracker_name || '').replace(/:.*$/, '');
```
**FIX NEEDED:** Same broken string-name join pattern as app.js.

**BROKEN JOIN LINE 1101** (ROAS Tracker — Meta-side key):
```js
const mbKey = (row.date_start || '') + '|||' + (row.campaign_name || '') + '|||' + (row.adset_name || '').toLowerCase().trim() + '|||' + (row.ad_name || '').replace(/:.*$/, '');
```
**FIX NEEDED:** Same broken string-name join.

---

### FILE: `uploader/server.js` — MULTIPLE ENDPOINTS

#### Endpoint: `/api/metabase/creative-metrics` (~line 1737)

**BROKEN JOIN LINE 1796** (Metabase SQL):
```sql
regexp_replace(ud.tracker_name, ':.*$', '', 'g') AS tracker_name
```
**FIX NEEDED:** Strips campaign ID from tracker_name. Should also extract it via `SPLIT_PART`.

**BROKEN JOIN LINE 1817-1818** (SQL SELECT):
```sql
sm.tracker_name,
sm.tracker_campaign_name AS campaign_name,
```
**FIX NEEDED:** Should also return `SPLIT_PART(tracker_name, ':', 2) AS tracker_campaign_id`.

#### Endpoint: `/api/metabase/ad-funnel` (~line 2369)

**BROKEN JOIN LINE 2428** (Metabase SQL):
```sql
regexp_replace(ud.tracker_name, ':.*$', '', 'g') AS tracker_name
```
**FIX NEEDED:** Same — strips campaign ID.

**BROKEN JOIN LINE 2456-2458** (SQL SELECT):
```sql
sm.tracker_campaign_name AS campaign_name,
sm.tracker_sub_campaign_name AS ad_set_name,
sm.tracker_name,
```
**FIX NEEDED:** Should also return the extracted campaign ID from tracker_name.

#### Endpoint: CI Learn route (~line 2659)

**BROKEN JOIN LINE 2689-2690** (SQL — no regexp_replace at all in signup_metrics!):
```sql
ud.tracker_name,
ud.tracker_campaign_name,
```
**FIX NEEDED:** This query does NOT strip the `:` suffix from tracker_name in the SQL itself — it passes the raw `creative` field. The JavaScript code at line 3040 then does:
```js
const key = row.tracker_name.toLowerCase().trim();
```
This means the key includes the `:campaign_id` suffix, which will NEVER match Meta ad names. This is a **double bug**: no ID extraction AND no colon stripping in SQL.

**BROKEN JOIN LINE 3039-3044** (JavaScript — funnel lookup):
```js
if (row.tracker_name) {
    const key = row.tracker_name.toLowerCase().trim();
    funnelLookup[key] = row;
    const stripped = key.replace(/^fb_mof_(video_|static_)?/i, '');
    if (stripped && stripped !== key) funnelLookup[stripped] = row;
}
```
**FIX NEEDED:** The lookup key is built from the raw tracker_name (which includes `:campaign_id`). Then the Meta-side matching at line 3107-3110 does:
```js
const funnelKey = a.ad_name.toLowerCase().trim();
const funnelKeyNoColon = funnelKey.replace(/:.*$/, '');
const funnel = funnelLookup[funnelKey] || funnelLookup[funnelKeyStripped] || funnelLookup[funnelKeyNoColon] || {};
```
This is a mess — it tries multiple string heuristics instead of using IDs.

#### Endpoint: CI Simulate-all route (~line 2906)

**BROKEN JOIN LINE 2961** (SQL):
```sql
regexp_replace(ud.tracker_name, ':.*$', '', 'g') AS tracker_name
```
**FIX NEEDED:** Same — strips campaign ID.

**BROKEN JOIN LINE 3928-3932** (JavaScript — funnel lookup):
```js
if (row.tracker_name) {
    const key = row.tracker_name.toLowerCase().trim();
    funnelLookup[key] = row;
    const stripped = key.replace(/^fb_mof_(video_|static_)?/i, '');
}
```
**FIX NEEDED:** Same string-name lookup.

#### Endpoint: Simulate-all ad matching (~line 3948):
```js
const funnelKey = a.ad_name.toLowerCase().trim();
const funnelKeyStripped = funnelKey.replace(/^fb_mof_(video_|static_)?/i, '');
```
**FIX NEEDED:** String-name matching.

#### Endpoint: Live creative status (~line 3869)

**BROKEN JOIN LINE 3870** (SQL):
```sql
regexp_replace(uad.creative, ':.*$', '', 'g') AS tracker_name
```
**FIX NEEDED:** Same — strips campaign ID.

**BROKEN JOIN LINE 3891** (SQL):
```sql
SELECT regexp_replace(ud.tracker_name, ':.*$', '', 'g') AS tracker_name, ud.tracker_campaign_name,
```
**FIX NEEDED:** Same — no ID extraction.

#### Endpoint: `/api/metabase/gc-ad-funnel` (Google Ads funnel, ~line 4465)

**BROKEN JOIN LINE 4524** (SQL):
```sql
regexp_replace(ud.tracker_name, ':.*$', '', 'g') AS tracker_name
```
**FIX NEEDED:** Same — strips campaign ID. (Note: this is for Google Ads, where the same tracker_name format applies.)

---

### FILE: `intelligence/agents/forecastAgent.js`

**BROKEN JOIN LINES 21-32** (buildLTVCohorts SQL):
```sql
SELECT campaign_name, adset_name, ... FROM raw_metabase GROUP BY campaign_name, adset_name
```
And lines 36-48:
```sql
SELECT campaign_name, adset_name, SUM(spend) ... FROM raw_creatives GROUP BY campaign_name, adset_name
```
With the join at line 44:
```js
spendMap[`${r.campaign_name}||${r.adset_name}`] = { total_spend, installs };
```
And line 66:
```js
const key = `${r.campaign_name}||${r.adset_name}`;
const meta = spendMap[key] || { total_spend: 0, installs: 0 };
```
**FIX NEEDED:** The LTV cohort builder joins `raw_metabase` to `raw_creatives` using string `campaign_name||adset_name`. Should use `campaign_id||adset_id` for reliable matching.

---

### FILE: `google-creative/agents/gcDataFetcher.js`

**NO BROKEN META<->METABASE JOIN:** This file joins Google Ads API data with Metabase using `campaign_id + adgroup_id` (numeric IDs). The join at line 434 is:
```js
const key = `${ag.campaign_id}|${ag.adgroup_id}`;
```
And line 454:
```js
const key = `${ad.campaign_id}|${ad.adgroup_id}`;
const perf = adsetMap[key] || {};
```
This is CORRECT — it uses numeric IDs. However, the Metabase SQL at line 107-127 queries a `google_ads_daily` table (with a TODO comment saying it's a placeholder), not the `user_additional_details` tracker system. This is a separate data source and not affected by the tracker_name bug.

---

### FILE: `feedback-engine/agents/feWatcher.js`

**NO DIRECT BROKEN JOIN:** This file reads from CI and GC SQLite databases (predictions, simulations) — it does not perform Meta<->Metabase tracker_name joins itself. It inherits whatever data quality those upstream systems produce.

**MINOR ISSUE LINE 271-278** (Recommendation tracking — Metabase SQL):
```sql
SELECT ad_id, ad_name FROM meta_ads
WHERE ... AND (LOWER(ad_name) LIKE '%${theme}%' OR LOWER(ad_body) LIKE '%${theme}%')
```
This queries a `meta_ads` table directly — it does not use tracker_name joins, so it is not affected by the root cause bug. However, it has SQL injection risk from unescaped theme content.

---

## SUMMARY TABLE

| File | Location | Join Type | Broken? | Fix Priority |
|------|----------|-----------|---------|-------------|
| `app.js` | fetchLiveData L49,106 | date+campaign_name+adset+ad_name | YES | **P0 — Main dashboard** |
| `app.js` | computeWoWTrends L327 | date+campaign_name+adset+ad_name | YES | **P0 — WoW trends** |
| `app.js` | Campaign Tree L2072-2179 | serial+campaign_name+adset+ad_name | YES | **P0 — Campaign tree** |
| `app.js` | Weekly Breakdown L2756,2788 | campaign_name+adset+ad_name | YES | **P0 — Weekly view** |
| `app.js` | Metabase Import L831-836 | tracker_name string | YES | P1 — Sheet fallback |
| `optimizer.js` | scanAccount L120,171 | date+campaign_name+adset+ad_name | YES | **P0 — Optimizer** |
| `creative-intelligence/engine.js` | collectSnapshots L279-347 | normAdName(tracker_name) | YES | **P0 — CI engine** |
| `creative-intelligence/engine.js` | ROAS Tracker L1050,1101 | date+campaign_name+adset+ad_name | YES | **P0 — ROAS tracker** |
| `uploader/server.js` | creative-metrics L1796 | SQL tracker_name strip | YES | P1 — API endpoint |
| `uploader/server.js` | ad-funnel L2428 | SQL tracker_name strip | YES | **P0 — Core API** |
| `uploader/server.js` | CI learn L2689,3040 | raw tracker_name (NO strip) | YES | **P0 — Double bug** |
| `uploader/server.js` | simulate-all L2961,3928 | tracker_name strip + string match | YES | P1 — Simulator |
| `uploader/server.js` | live-status L3870,3891 | SQL tracker_name strip | YES | P1 — Live status |
| `uploader/server.js` | gc-ad-funnel L4524 | SQL tracker_name strip | YES | P1 — Google funnel |
| `intelligence/agents/forecastAgent.js` | LTV cohorts L21-66 | campaign_name+adset_name string | YES | P1 — Forecaster |
| `google-creative/agents/gcDataFetcher.js` | mergeData L434 | campaign_id+adgroup_id (numeric) | NO | N/A — Already correct |
| `feedback-engine/agents/feWatcher.js` | all | Reads upstream SQLite DBs | INDIRECT | Inherits upstream bugs |

---

## RECOMMENDED FIX STRATEGY

### Step 1: Fix the SQL queries (all Metabase endpoints)

In every Metabase SQL query that touches `tracker_name`, add a column that extracts the campaign ID:

```sql
-- In user_data CTE:
uad.creative AS tracker_name,
SPLIT_PART(uad.creative, ':', 2) AS tracker_meta_campaign_id,

-- In signup_metrics CTE:
regexp_replace(ud.tracker_name, ':.*$', '', 'g') AS tracker_name,
ud.tracker_meta_campaign_id,

-- In final SELECT:
sm.tracker_meta_campaign_id,
```

### Step 2: Fix the JavaScript join keys

Replace all string-name matching with ID-based matching:

```js
// BEFORE (broken):
const key = d + '|||' + row.campaign_name + '|||' + adset + '|||' + row.tracker_name.replace(/:.*$/, '');
const mbKey = row.date_start + '|||' + row.campaign_name + '|||' + adset + '|||' + row.ad_name.replace(/:.*$/, '');

// AFTER (correct):
// Metabase side: use campaign_id extracted from tracker_name
const key = d + '|||' + row.tracker_meta_campaign_id + '|||' + adset + '|||' + row.tracker_name;
// Meta side: use campaign_id from Meta API
const mbKey = row.date_start + '|||' + row.campaign_id + '|||' + adset + '|||' + row.ad_name;
```

### Step 3: Fix forecastAgent.js

Change the raw_metabase <-> raw_creatives join from `campaign_name||adset_name` to `campaign_id||adset_id`.

### Step 4: Fix the CI engine collectSnapshots

Change the funnel lookup from `normAdName(tracker_name)` to a lookup by campaign_id extracted from the Metabase response.

---

## FILES THAT NEED CHANGES (ordered by priority)

1. **`uploader/server.js`** — 6 Metabase SQL queries need `SPLIT_PART` added, especially the ad-funnel and CI learn endpoints
2. **`app.js`** — 5 join key constructions need to use campaign_id instead of campaign_name
3. **`creative-intelligence/engine.js`** — 2 SQL queries + 2 JavaScript join sections
4. **`optimizer.js`** — 2 join key constructions
5. **`intelligence/agents/forecastAgent.js`** — 2 join key constructions

**Total broken joins found: 28 across 5 files (+ 1 file with indirect impact)**
**Total SQL queries needing SPLIT_PART: 8**
**Total JavaScript join keys needing campaign_id: 20**
