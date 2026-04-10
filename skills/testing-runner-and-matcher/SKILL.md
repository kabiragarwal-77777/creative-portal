---
name: testing-runner-and-matcher
description: Use when Google and Meta optimizer outputs, templates, command renderers, or analytics surfaces must be compared for parity. Create or run repeatable prompt suites, compare command routing, section order, cards, tables, warnings, and action blocks, and keep iterating until only intentional platform-specific differences remain.
---

# Testing Runner And Matcher

Use this skill when a platform surface must replicate another platform's behavior closely, especially:

- Meta optimizer vs Google optimizer
- command output template parity
- ask-bar behavior parity
- analytics card/section parity
- renderer regressions after refactors

## Goal

Prove parity structurally, not by intuition.

For every tested prompt:
- both platforms should hit the intended command class
- both platforms should render the same template shape
- only data, settings, benchmarks, and platform-specific reasoning should differ

## Workflow

1. Identify the canonical source surface.
- Usually Meta optimizer is the template source.

2. Freeze the parity contract before editing.
- prompt class
- command type
- shell layout
- section order
- table presence
- card presence
- warnings and basis labels
- action block names

3. Build a prompt suite.
- broad commands:
  - `daily analysis`
  - `deep dive`
  - `why is performance weak`
  - `what should I change today`
  - `should we scale`
  - `predict next 30 days`
- deterministic commands:
  - WoW trend
  - reduce metric
  - improve metric
  - mature-only
  - precise conditional query

4. For each prompt, compare:
- command routing
- top-level title
- basis/integrity section
- KPI card block
- narrative/AI block
- action block names
- tables and ordering
- watch/risk/do-not-touch sections

5. Treat these as allowed differences only:
- platform-specific metrics
- platform-specific settings and audits
- benchmark values
- channel/playbook logic

6. Treat these as failures:
- extra buttons or panels not present in the canonical surface
- missing ask bar parity
- missing section blocks
- different section ordering
- weaker renderer path for the same prompt class
- fallback/generic answers where the canonical surface gives a real optimizer document

7. Fix renderer/template parity first.
- do not tune insights before the shell matches

8. Re-run the prompt suite after every parity patch.
- continue until only intentional platform differences remain

## Output Expectations

When using this skill, produce:
- parity checklist
- failing prompt list
- exact renderer mismatch
- fix applied
- retest result
- residual intentional differences

## Guardrails

- Do not accept “logic is similar” if the shell is different.
- Do not compare outputs without aligning date range, filters, and command class.
- Do not mark parity as passed while one platform still uses a legacy renderer.
- Keep platform-specific playbook logic, but remove template drift.
