---
name: skill-router
description: Select and apply the most relevant existing Codex skills before solving a task. Use when a request spans multiple domains, needs higher accuracy, or explicitly asks to use relevant skills, parity checks, analytics validation, optimizer work, or repeated workflows.
---

# Skill Router

Use this skill as a routing pass before substantive work.

## Core Rule

- Inspect the request first.
- Identify the smallest set of existing skills that materially improve the task.
- Load and use those skills before editing, analyzing, or answering.
- Prefer deterministic, domain-specific skills over generic reasoning when one exists.

## Selection Order

1. Choose the primary domain skill.
2. Add validation/parity skills when output must match another surface.
3. Add analytics/data-matching skills when any metric, KPI, or recommendation is involved.
4. Add implementation-specific skills when the task is repetitive or tool-driven.

## Default Skill Picks

- Analytics surfaces: `analytics-design-planner`, `data-matching-analysis`
- Meta optimizer work: `optimizer.js` context plus any relevant Meta audit skill
- Google optimizer work: `gc-optimizer.js` context plus Google-specific audit skills
- Renderer/template parity: `testing-runner-and-matcher`
- Skill creation or updates: `skill-creator`

## Operating Rules

- Use only skills that genuinely improve accuracy, output quality, or validation.
- Do not load unrelated skills just because they exist.
- Announce the skill choices briefly when the task is complex or multi-domain.
- If no skill adds value, proceed without forcing one.
- Re-check the chosen skills if the task shifts domains midstream.

## Output Discipline

- Let the selected skills shape the workflow, checklist, and validation.
- Keep the final answer aligned with the chosen skills' contracts.
- For analytics or optimizer work, preserve raw-first, validation-first behavior.
