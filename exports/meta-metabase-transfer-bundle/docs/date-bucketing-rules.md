# Date Bucketing Rules

## Selected date range

All scans start from an explicit:

- `since`
- `until`

The system fetches raw rows inside that window, then buckets locally.

## Mature-only rule

When a prompt explicitly asks for mature data:

- exclude the last 7 days from the effective analysis window

This is an analysis-layer rule, not a source-layer mutation.

## Week-on-week rule

WoW is computed from raw buckets, not from precomputed `_wow` numbers.

Standard WoW pattern:

- previous 7d bucket
- current 7d bucket

For each entity:

1. filter raw rows to each bucket
2. sum raw metrics inside each bucket
3. derive KPI from the bucket totals
4. compare current vs previous

Example:

`current signup cost = current_bucket.spend / current_bucket.signups`

not:

`average(signup_cost_per_day)`

## Wider-window fallback

If a requested trend window is too thin:

- widen raw fetch or widen local bucket horizon
- but still derive KPIs after bucket aggregation

## Daily rows vs aggregated windows

Use daily raw rows to build:

- WoW
- rolling windows
- current vs previous comparisons

Use aggregated raw rows to build:

- campaign totals
- adset totals
- account totals

## Date-source clarification

Meta:

- spend/delivery is keyed by `date_start`

Metabase:

- funnel metrics are keyed by `signup_date`

This explains why:

- same-day row matching can look weaker than total matched economics

Do not “fix” this by changing the key logic unless you intentionally want a different model.
