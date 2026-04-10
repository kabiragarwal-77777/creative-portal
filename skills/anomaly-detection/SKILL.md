---
name: anomaly-detection
description: Use when optimizer logic needs to detect unusual day-over-day or week-over-week changes in spend, CPA, ROAS, volume, or conversion quality across Meta or Google. Flag real operational anomalies and avoid normalizing sudden breaks.
---

# Anomaly Detection

Use this skill for:
- daily analysis
- morning review
- why did performance suddenly change
- alert generation

## Rules

- Compare against recent account/entity history, not only absolute thresholds.
- Distinguish:
  - traffic anomaly
  - cost anomaly
  - conversion anomaly
  - attribution anomaly
  - status/settings anomaly
- Escalate sudden breaks even when the latest absolute KPI is still acceptable.
