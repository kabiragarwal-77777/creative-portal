---
name: google-benchmark-engine
description: Use when Google optimizer metrics, classifications, or recommendations need weighted medians, weighted averages, maturity-aware benchmark eligibility, and account-relative efficiency judgments. Mirrors the Meta benchmark philosophy but for Google campaign and ad group economics.
---

# Google Benchmark Engine

## Purpose

This skill defines how Google optimizer benchmarks should be built.

Core principle:
- Use raw-first aggregation.
- Derive metrics only after summing raw values.
- Benchmark Google with Google data, not Meta medians.

## Primary benchmark metrics

Use weighted benchmarks for:
- `signup cost`
- `d0 trial cost`
- `d6 CAC`
- `d6 ROAS`
- `d15 ROAS`
- `d30 ROAS`

## Eligibility rules

Include only rows that are:
- matched at campaign or ad group level
- materially spent
- not obviously noisy or tracker-broken
- mature where the metric requires maturity
- structurally active enough to represent real account performance

Exclude:
- spend-only pockets from efficiency benchmarks
- thin-volume rows that can distort medians
- clearly corrupted or stale rows

## Output behavior

Every classified Google campaign/ad group should resolve to:
- `scale_candidate`
- `healthy`
- `watch`
- `underperforming`
- `insufficient_data`

## Repair rule

If the optimizer is about to make a strong Google recommendation without a benchmark basis,
downgrade confidence and say so explicitly.
