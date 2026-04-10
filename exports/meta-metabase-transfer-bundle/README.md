# Meta ↔ Metabase Matching Transfer Bundle

This bundle contains the exact matching contract used in this portal for Meta spend + Metabase funnel attribution.

Use this bundle when you want another project to:

- fetch Meta daily ad spend/delivery rows
- fetch Metabase daily funnel rows
- join them with the same key contract used here
- aggregate raw metrics first
- derive KPI metrics only after aggregation
- preserve the same date bucketing and benchmark behavior

The goal is parity with this portal, not an approximation.

## Included files

- `src/meta-metabase-contract.js`
  - canonical shared matcher from this portal
- `src/meta-metabase-contract.example.js`
  - example usage pattern from this portal
- `src/weighted-benchmarks.js`
  - weighted median helper extracted from the optimizer
- `docs/matching-contract.md`
  - exact join, normalization, and metric rules
- `docs/date-bucketing-rules.md`
  - raw-first bucketing rules for date filters, WoW, and mature-only windows
- `docs/integration-checklist.md`
  - implementation checklist for the target project

## What the target project must replicate exactly

1. Join key:
   - `date + normalized campaign_name + normalized adset_name + normalized tracker_name`

2. Normalization:
   - lowercase
   - trim outer spaces
   - collapse repeated spaces
   - tracker name strips any suffix after `:`

3. Aggregation contract:
   - sum raw spend/delivery/funnel numerators first
   - derive `signupCost`, `d0TrialCost`, `d6ROAS`, `d15ROAS`, `d30ROAS`, etc only after aggregation
   - never sum percentages or precomputed KPI values

4. Metabase rows are signup-date keyed, not spend-date keyed:
   - low same-day row match can happen
   - this is a debug signal, not automatic data corruption

5. Benchmarks:
   - spend-weighted medians
   - benchmark population should use matched rows only

## Important limitation

This bundle gives you the matching and metric contract. It does not include live secrets or environment values.

You still need to provide:

- Meta API auth
- Metabase URL/session/auth
- your own request plumbing in the target project

## Recommended use

In the target project:

1. use `meta-metabase-contract.js` as the source of truth
2. call:
   - Meta daily fetch
   - Metabase funnel fetch
   - optional ad status fetch
3. run the matcher
4. use the returned leaf records for:
   - campaign rollups
   - adset rollups
   - ad rollups
   - date buckets
   - trend windows
5. use `weighted-benchmarks.js` for benchmark parity

If you diverge from the join key, tracker normalization, or raw-first derivation, your numbers will drift from this portal.
