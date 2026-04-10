# Integration Checklist

## Required implementation order

1. Copy `src/meta-metabase-contract.js`
2. Use its normalizers and `buildJoinKey` unchanged
3. Fetch Meta daily ad rows
4. Fetch Metabase daily funnel rows
5. Match through `matchMetaAndMetabaseData(...)`
6. Use matched leaf records as the only source for rollups
7. Use `src/weighted-benchmarks.js` for weighted medians

## Do not change

- join key separator
- tracker-name normalization
- raw field names unless you map them exactly
- ROAS formulation
- mature-only rule
- raw-first aggregation rule

## Verify parity

Before trusting the target project, compare against this portal on the same date range:

- total spend
- signups
- d0_trial
- d6_overall_revenue
- signup cost
- d0 trial cost
- d6 ROAS
- d15 ROAS
- d30 ROAS
- matched row count
- unmatched row count

## Benchmark parity

Benchmark population should:

- prefer matched rows only
- exclude zero/invalid metric values
- use spend as the weight

## If parity fails

Check in this order:

1. date filter mismatch
2. join key mismatch
3. tracker-name normalization mismatch
4. GST/spend basis mismatch
5. KPI derived before aggregation
6. benchmark population mismatch
