---
name: google-channel-logic
description: Use when one Google optimizer shell must apply different rules to Search, PMax, Display, Video, and UAC/App campaigns. Prevents Search logic from bleeding into channels where it does not fit.
---

# Google Channel Logic

## Purpose

This skill makes the Google optimizer channel-aware.

## Core rule

One optimizer shell can cover all Google campaigns, but each channel must be judged by the signals that actually matter for that channel.

## Channel branches

- `Search`
  - query quality, QS, impression share, CPC/CVR logic
- `PMax`
  - asset groups, goal alignment, audience signals, budget and asset coverage
- `Display`
  - placement waste, audience fit, asset fatigue, conversion quality
- `Video`
  - hook/hold support signals, view quality, assisted trial-driving behavior
- `UAC/App`
  - install-to-signup, signup-to-trial, D0/D6 quality, audience signal quality

## Repair rule

If the optimizer is about to give a Search-style fix to a non-Search campaign,
stop and switch to the correct channel branch.
