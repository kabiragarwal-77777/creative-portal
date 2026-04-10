---
name: google-query-engine
description: Use when Google optimizer must answer precise deterministic questions about trends, metric reduction/increase, mature-only performance, best/worst pockets, or filtered entity conditions without falling back to generic AI reasoning.
---

# Google Query Engine

## Purpose

This skill governs deterministic Google optimizer queries.

## Core principle

If the user is asking for a measurable filtered answer, do not route to broad narrative reasoning first.

## Supported query classes

- week-on-week trend questions
- reduce/increase/improve metric questions
- best/worst entity searches
- mature-only questions
- filtered condition searches

## Required execution order

1. parse the metric and conditions
2. fetch the right raw rows
3. bucket raw rows into the requested windows
4. sum raw values first
5. derive metrics after aggregation
6. rank and filter entities
7. render a table first
8. add insights only if asked

## Output behavior

The first output should usually be:
- campaigns
- ad groups
- ads
- supporting pockets

not a generic strategist paragraph.
