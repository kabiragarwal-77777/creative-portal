---
name: advanced-performance-trend-analysis
description: Detect week-on-week performance contradictions and sustainability risks across campaigns, adsets, and ads using matured D6 ROAS, signup cost, D0 trial cost, signups, revenue, and spend-weighted trend context. Use when optimizer output should move beyond static metrics into quality-of-growth analysis.
---

# Advanced Performance Trend Analysis

## Purpose

This skill exists to stop the optimizer from treating every ROAS increase as healthy progress.

It should detect cases like:
- D6 ROAS up, but signup cost also up sharply
- D6 revenue up, but signups down materially
- D0 trial cost inflating while top-line ROAS looks better
- apparent efficiency improvement driven by fewer, higher-value conversions

## Core Principle

Performance improvement is only trustworthy when:
- revenue quality improves
- acquisition cost stays stable or improves
- signup / trial volume is not collapsing

If ROAS improves while cost-to-acquire worsens and volume weakens, the system should treat that as:
- potentially unsustainable
- not a clean scale signal

## Required Outputs

For each entity where WoW context exists, classify one of:
- `TRUE_IMPROVEMENT`
- `UNSUSTAINABLE_VALUE_MIX`
- `CLEAR_DETERIORATION`
- `EARLY_RECOVERY`
- `MIXED_SIGNAL`
- `NO_CLEAR_TREND`

And provide:
- one-line explanation
- one operator implication

## Repair Rule

If the optimizer is about to say:
- `scale`
- `protect and scale`
- `no change needed`

while the trend pattern is `UNSUSTAINABLE_VALUE_MIX` or `CLEAR_DETERIORATION`,
the trend classification should override the naive recommendation.
