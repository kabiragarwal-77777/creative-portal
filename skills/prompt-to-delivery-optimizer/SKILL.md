---
name: prompt-to-delivery-optimizer
description: Use when replacing selector-heavy optimizer UX with a single marketer prompt bar that accepts natural-language requests, infers campaign/adset/ad scope, asks short clarifying follow-ups when needed, and returns actionable Meta account analysis and fixes from the existing data pipeline.
---

# Prompt To Delivery Optimizer

Build the optimizer like an operating console, not a dashboard.

## Primary UX

- One prompt bar is the main control surface.
- The marketer types a request in plain language.
- The system infers:
  - intent
  - scope
  - entity target
  - funnel filter
  - status filter
- If the request is underspecified, ask one short clarifying question in the same thread.

## Supported intents

- `account_actionables`
  - Examples:
    - `give me actionables to revamp my meta account`
    - `what should I change today`
- `diagnose`
  - Examples:
    - `why is this account underperforming`
    - `diagnose test2 campaign`
- `deep_dive`
  - Examples:
    - `give an overview of test2 campaign`
    - `what is working what is not and how to make it better`

## Required behavior

- Prefer deterministic parsing first.
- Match campaign, adset, and ad names against the scanned account tree before asking the user.
- If a likely entity match exists, use it.
- If multiple likely matches exist, ask a short clarification instead of guessing.
- Keep clarifications short and operational.
- Reuse the accurate scan pipeline already in the optimizer.
- Do not bypass status hierarchy, maturity logic, or budget-owner rules.

## Output style

- Short operator language.
- Name the entity.
- Name the problem.
- Name the most likely cause.
- Give the exact action or say hold.

## UI rules

- Keep the prompt bar visible in both pre-run and post-run states.
- Show recent user/assistant turns above the bar.
- Add 3-5 suggested prompts as chips.
- Do not force the user through dropdowns for common requests.

## Fallback rules

- If the AI answer is thin, backfill from deterministic scan logic.
- Never render blank rows when a deterministic fallback exists.
