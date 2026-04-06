---
name: meta-account-learning
description: Use when optimizer recommendations for Meta campaigns, adsets, or ads need learning-safe change discipline. Applies limits on simultaneous pauses, budget edits, activations, and creative swaps so the account is not destabilized by bulk changes inside the same campaign or adset.
---

# Meta Account Learning

Use this skill when generating or validating Meta optimizer actions.

Core rule:
- Do not recommend so many simultaneous changes that the account loses learning stability.

Guardrails:
- Significant edits can re-enter learning, so cluster fewer structural edits rather than touching many entities at once.
- Use learning-spend share as the main account-level control. If too much spend is already in learning, suppress additional structural edits.
- Do not recommend bulk pausing most live ads in a healthy or protected campaign/adset.
- If there is no clearly superior replacement, hold and brief a new challenger instead of swapping creatives back and forth.
- If a campaign or adset is efficient, protect the winner and trim only the clearest loser.
- Convert excess low-confidence structural changes into monitor/hold guidance.
- Prefer one meaningful structural change per budget owner or adset cycle, then reassess after the next observation window.

Priority order:
1. Protect efficient entities.
2. Remove one clear loser where evidence is strong.
3. Avoid multi-edit chains in the same campaign on the same day.
4. If several ads look weak, queue the rest for later rather than editing them all now.

Expected output behavior:
- Fewer actions, higher confidence.
- No contradictory sibling replacement calls.
- No “pause almost everything” recommendation pattern.
