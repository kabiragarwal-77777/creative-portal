---
name: google-structure-audit
description: Use when Google optimizer output must judge campaign and ad group structure quality. Covers brand vs non-brand separation, Search/PMax/Display/Video/UAC role clarity, budget ownership, and structural fragmentation.
---

# Google Structure Audit

## Purpose

This skill defines how the Google optimizer should think about structure.

## Core principles

- One campaign should have one clear job.
- Brand and non-brand should not be mixed casually.
- Search logic should not be applied blindly to PMax, Display, Video, or UAC.
- New tests should not be buried inside crowded structures where they cannot earn signal.

## What to audit

- brand vs non-brand separation
- campaign-type role clarity
- budget ownership clarity
- duplicate or overlapping ad group intent
- fragmentation that spreads spend too thin
- crowded structures that hide winners

## Output behavior

Recommendations should sound like:
- `separate brand from non-brand`
- `reduce structural fragmentation`
- `split this intent into its own campaign`
- `do not mix this test into the main scale structure`
