---
name: attribution-model-comparison
description: Use when optimizer reasoning must compare attribution windows or platform-vs-warehouse views across Meta or Google. Prevent false pause/scale decisions caused by attribution inflation, lag, or mismatched windows.
---

# Attribution Model Comparison

Use this skill for:
- integrity warnings
- attribution inflation
- platform vs Metabase disagreement
- retargeting caution

## Rules

- Treat attribution mismatches as confidence modifiers, not automatic blockers.
- Explain whether the issue is lag, inflation, or join mismatch.
- Never collapse attribution caveats into generic "data is wrong" language.
