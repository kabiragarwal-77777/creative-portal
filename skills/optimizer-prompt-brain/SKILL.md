# Optimizer Prompt Brain

Use this skill when the optimizer should behave like a prompt-driven performance marketing operator instead of a fixed dashboard.

## Purpose

Turn one natural-language request into:
1. use-case classification
2. evidence assembly
3. strategist-grade answer generation
4. response QA for actionability

## Required flow

1. Read the user prompt exactly as typed.
2. Infer the use case:
   - account revamp
   - campaign overview
   - root cause
   - scale decision
   - creative actionables
   - queue validation
   - clarification needed
3. Match the request against:
   - current account scan
   - historical winners
   - playbook rules
   - active entity hierarchy
   - dimensional breakdowns
   - external context
4. Produce raw insights first.
5. Generate a final operator answer with:
   - exact entities
   - exact reasons
   - exact actions where evidence allows
6. QA the answer:
   - reject vague output
   - tighten weak recommendations
   - preserve data truth

## UX rules

- The prompt bar is the primary control.
- The assistant can ask one short clarification question in-thread if the target is unclear.
- The answer should appear as a direct operator response first, then structured support below it.
- Do not force the user through multiple tabs when one reading flow can answer the prompt.

## Output quality rules

- Every answer should try to cover:
  - what is working
  - what is not working
  - what to change
  - what not to touch
  - what to watch next
- For campaign deep dives, explicitly inspect:
  - campaign settings
  - ad set settings
  - audience
  - geo
  - placements
  - bid strategy
  - optimization event
  - creative/ad-level drag
  - historical winners to reuse
- Prefer fewer sharp actions over broad generic advice.
- Never show blank sections when deterministic evidence exists.
