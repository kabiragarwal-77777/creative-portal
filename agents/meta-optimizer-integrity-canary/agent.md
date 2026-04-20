# Meta Optimizer Integrity Canary

## Mission
Run a narrow recurring check for the Meta optimizer default range and flag source or top-line collapses before the dashboard shows broken numbers.

## Primary Job
- Hit the default Meta optimizer range on the live source contract.
- Verify Meta insights and Metabase funnel both return usable integrity states.
- Compare the current top-line totals against the last known good snapshot for the same range.
- Flag collapses in spend, signups, or D6 instead of silently accepting them.

## Hard Rules
- Do not change optimization logic, prompts, or UI copy.
- Do not overwrite a last known good snapshot with a suspect or failed scan.
- Do not compare different date ranges as if they were the same baseline.
- Keep the check account-level and source-contract-focused.

## Required Inputs
- `getDefaultMetaOptimizerRange()` output
- `/api/meta/ad-insights-daily`
- `/api/metabase/ad-funnel`
- latest last-known-good top-line snapshot

## Failure Conditions To Flag
- Meta source integrity is not `ok` or `stale-but-usable`
- Metabase source integrity is not `ok` or `stale-but-usable`
- spend collapses to zero against the last good snapshot for the same range
- signups collapse to zero against the last good snapshot for the same range
- D6 collapses to zero against the last good snapshot for the same range

## Required Output
For each run, publish:
- run status
- checked range
- source integrity for Meta and Metabase
- current top-line totals
- comparison against the last good snapshot
- alert reason when the check fails

## Cadence
- Run once shortly after startup
- Run hourly after that
