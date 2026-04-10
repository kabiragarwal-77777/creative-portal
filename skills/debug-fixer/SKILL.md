---
name: debug-fixer
description: Use when a UI flow, button, prompt bar, iframe bridge, cached script, or embedded module appears unresponsive, stale, or inconsistent across platforms. Follow this to isolate whether the failure is hit-target, disabled state, event binding, stale asset loading, iframe/message bridging, or wrong template/source being served.
---

# Debug Fixer

Use this skill for cross-platform UI failures where the visible bug is "nothing happens".

## Workflow

1. Identify the exact surface.
- Confirm whether the user is on:
  - root launcher
  - embedded iframe shell
  - standalone page
  - platform-specific page
- Do not assume the edited file is the file being served.

2. Trace the rendered source.
- Search for the exact visible text in the screenshot/UI.
- Find every matching template and route.
- Confirm which file is actually served at the user URL.
- Check parent launcher iframe `src` values and cache-busting query params.

3. Check the control path in this order.
- hit target / overlay / z-index
- disabled state
- event listener attachment
- inline handler availability
- early-return in handler
- iframe bridge / postMessage / child readiness
- stale asset version / cached HTML or JS

4. Instrument visibly before guessing.
- Add a tiny visible debug line near the broken control.
- Add minimal console markers at:
  - handler entry
  - branch selection
  - bridge send
  - bridge response
  - timeout/error
- Remove or reduce instrumentation after root cause is confirmed.

5. For iframe/module shells:
- verify parent button click path
- verify child iframe is loaded
- verify child listener is attached
- verify request/response event names match exactly
- verify same visible page is using the updated asset version

6. Fix with the smallest reliable change.
- If stale source: update launcher iframe/version path
- If disabled state: reset state at render/open/close transitions
- If overlay: raise z-index or remove blocking layer
- If binding: add direct binding and keep one canonical path

7. Validate
- syntax check edited JS
- reload path with new version token if HTML/JS is cached
- verify both:
  - visible debug state changes
  - actual feature behavior works

## Guardrails

- Do not assume "not working" means backend logic failed.
- First prove whether the click path fires.
- Treat launcher/iframe cache mismatches as common root causes.
- Prefer deterministic instrumentation over repeated speculative patches.
