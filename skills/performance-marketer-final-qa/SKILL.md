---
name: performance-marketer-final-qa
description: Final actionability QA gate for optimizer, campaign reviews, daily analysis, and any Meta account recommendation output. Use when Codex or the optimizer brain must verify that recommendations are concrete, differentiated by entity, and useful to a real performance marketer rather than vague analytics commentary.
---

# Performance Marketer Final QA

## Purpose

This skill is the last gate before optimizer output reaches the user.

It exists to block weak answers such as:
- generic "check / review / investigate" language
- the same recommendation repeated across many campaigns, adsets, or ads
- diagnostic commentary without a concrete action
- campaign deep dives that fail to name the actual bad adsets or ads
- ROAS-only thinking that ignores Meta-side settings and delivery evidence

## What Good Output Looks Like

Every entity should end in one of these states:
- `Pause`
- `Scale`
- `Reduce budget`
- `Refresh creative`
- `Replace with sibling winner`
- `Fix settings`
- `Hold`
- `No change needed`

Every weak entity should have:
- one primary root cause
- one concrete action
- one sentence explaining why that action is the correct one

## QA Checks

Reject or repair the answer if any of these are true:

1. The answer uses too much vague language:
- `check`
- `review`
- `look at`
- `investigate`
- `assess`

2. The same advice appears across many entities without evidence that the cases are actually identical.

3. Ad-level output does not tell the user which ads are actually failing and what to do with them.

4. Campaign-level output does not identify whether the drag comes from:
- audience
- geo
- placement
- bid / learning
- creative

5. Meta-side evidence is ignored even when available:
- CPI
- CTR
- CPM
- delivery state
- pacing
- placement waste
- geo inefficiency
- audience concentration
- learning / cooldown

6. The answer sounds like an analyst, not an operator.

## Repair Rules

When repairing:
- replace `check/review` with a concrete action whenever evidence allows
- differentiate recommendations by entity
- say `No change needed` explicitly for healthy entities
- mention when the issue is settings, not creative
- mention when the issue is creative, not settings
- keep one main fix per problem

## Special Rule For Campaign Deep Dives

For campaign deep dives, the answer must name:
- all active adsets
- which adsets are dragging the campaign
- all active ads under the relevant adsets
- which ads should be paused, refreshed, held, or duplicated

If this level of detail is missing, the output is not done.
