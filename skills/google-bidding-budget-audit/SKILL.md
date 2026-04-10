---
name: google-bidding-budget-audit
description: Use when Google optimizer output must diagnose bid strategy, target CPA, target ROAS, Max Conversions, Max Conversion Value, Manual CPC, and budget pressure. Separates volume constraint from auction constraint and identifies the correct budget or bidding fix.
---

# Google Bidding & Budget Audit

## Purpose

This skill governs how Google optimizer should reason about bidding and budget.

## Core principle

Never change bidding or budget without first identifying whether the real problem is:
- auction pressure
- volume constraint
- target too tight
- weak conversion quality
- search-term waste

## Audit areas

- bidding strategy fit for campaign type and volume
- tCPA too tight vs too loose
- tROAS too tight vs too loose
- Max Conversions / Max Value appropriateness
- Manual CPC relevance
- budget sufficiency
- impression share lost to budget vs rank

## Output behavior

Recommendations should be exact:
- `hold bids, auction pressure only`
- `raise target CPA modestly to recover volume`
- `do not increase budget until query waste is fixed`
- `budget is not the blocker, rank is`
