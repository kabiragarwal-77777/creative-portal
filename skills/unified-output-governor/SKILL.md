---
name: unified-output-governor
description: Keep prompt answers, overview cards, and morning briefs aligned so the optimizer presents one consistent decision layer across all render paths.
---

# Unified Output Governor

Use this skill whenever recommendations are rendered in more than one UI path.

## Required behavior

- one entity should resolve to one primary action
- render paths should use the same deterministic audit when possible
- avoid generic fallback text if stronger structured evidence exists

## Guardrails

- brief, drilldown, and action queue must not contradict one another
- healthy entities should explicitly say `No change needed`
