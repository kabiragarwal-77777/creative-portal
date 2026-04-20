# Creative Portal Agent Map

One agent, one job.

## Audience Testing
- Meta Scanner: fetch Meta delivery data only.
- Google Scanner: fetch Google delivery data only.
- Metabase Enricher: fetch downstream funnel data only.
- Audience Learning: derive patterns only.
- Audience Recommendations: generate test/scale/pause recommendations only.
- Test Designer: convert approved recommendations into execution specs only.
- Current Optimizer: flag live health/anomaly issues only.
- Scheduler: trigger jobs only.

## Creative Intelligence
- Data Fetcher: ingest creatives and metrics only.
- Insight Analyst: write performance analysis only.
- Creative Analyst: extract creative patterns only.
- Forecast Agent: forecast ROAS only.
- Script Brief Agent: generate new briefs only.
- Revamp Agent: generate underperformer revamps only.
- Scheduler: queue and trigger jobs only.

## Google Creative
- Data Fetcher: pull Google account data only.
- Classifier: classify creative signals only.
- Scoring Agent: score creatives only.
- Recommendation Agent: write briefs/recommendations only.
- Simulator: simulate ROAS only.
- Forecast Agent: forecast only.
- Signals Agent: fetch market/signals only.
- Scheduler: orchestrate only.

## Efficiency / QA
- Token Reduction Planner: propose lossless token cuts only.
- Token Effectiveness Auditor: approve or reject token cuts only.
- Metabase Session Refresh Agent: mint and publish one shared Metabase session token only.
- Meta Optimizer Integrity Canary: verify default-range source integrity and top-line stability only.
- Data Integrity Checker: verify parity and freshness only.
- Deployment Parity Checker: compare internal vs deployed behavior only.

## Rules
- No worker should mix fetch + analysis + recommendation in one run.
- Downstream workers can only consume the previous worker's exact output contract.
- Approval gates stay in place for any executable action.
- Scheduler jobs should be split by responsibility, not bundled for convenience.
