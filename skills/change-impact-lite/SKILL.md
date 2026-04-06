---
name: change-impact-lite
description: Predict likely risk from repeating budget or structural changes using local historical patterns and known account examples without backend pipeline changes.
---

# Change Impact Lite

Use this skill before recommending scaling or major structural changes.

## Required behavior

- look for similar prior winners or degradations in local scan context
- reduce step size when similar moves have degraded
- block aggressive changes when current state is unstable

## Output states

- stands
- modified
- blocked
