---
name: wasted-spend-finder
description: Use when optimizer outputs must identify where spend is being wasted across Meta or Google. Surface entities or breakdown pockets with material spend and weak downstream efficiency, then rank the highest-confidence cut/fix opportunities.
---

# Wasted Spend Finder

Use this skill for:
- wasted spend analysis
- budget reduction priorities
- underperformance RCA
- daily optimization actions

## Rules

- Only call spend "wasted" when it is both material and benchmark-negative.
- Rank by recoverable spend, not just by bad ROAS.
- Separate:
  - true waste to cut
  - weak-but-fixable spend
  - early/learning spend
  - spend blocked by tracking uncertainty
