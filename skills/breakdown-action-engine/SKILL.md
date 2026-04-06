---
name: breakdown-action-engine
description: Turn placement, geography, age-gender, device, and hourly breakdowns into exact optimization actions instead of descriptive summaries.
---

# Breakdown Action Engine

Use this skill when breakdown tables exist and the optimizer must convert them into actions.

## Required behavior

- Name the exact breakdown pocket.
- State whether it is:
  - cut
  - isolate
  - scale
  - watch
  - no change needed
- Do not summarize a breakdown without an operator implication.

## Priority outputs

- placement exclusions
- geo tightening
- age-gender narrowing
- device / OS warnings
- daypart or delivery concentration notes

## Guardrails

- Do not recommend exclusions on trivial spend.
- Do not recommend multiple conflicting cuts for the same entity.
- Prefer one dominant breakdown action per entity.
