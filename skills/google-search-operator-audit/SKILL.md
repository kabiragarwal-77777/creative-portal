---
name: google-search-operator-audit
description: Use when Search campaign decisions depend on search terms, keyword match types, negative keywords, Quality Score, impression share, and brand defense. This is the Google equivalent of true operator-level Search account management.
---

# Google Search Operator Audit

## Purpose

This skill handles Search-specific Google optimization logic.

## Core rule

Do not diagnose Search performance without checking query quality and quality score context.

## Required surfaces

- search term drift
- keyword match type hygiene
- negative keyword gaps
- quality score
- expected CTR
- ad relevance
- landing page experience
- impression share
- lost impression share due to rank
- lost impression share due to budget
- brand defense

## Diagnosis priority

1. Attribution truth
2. Query quality
3. CPC vs CVR split
4. QS component weakness
5. Rank vs budget pressure

## Output behavior

Recommendations should be concrete:
- `add these negative themes`
- `tighten broad match exposure`
- `fix LP mismatch before touching bids`
- `defend brand impression share now`
