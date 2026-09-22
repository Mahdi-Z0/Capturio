---
description: 'Plan 04-01 — window capture: what shipped'
type: PlanSummary
closed: 2026-09-22
---

# 04-01 — Record one window

**Ceremony note:** no separate PLAN document, per the user's standing request. Verified by driving
the built app against a separate program's animated window.

## The unblock

Phase 4 had been marked blocked since Phase 1 on "window capture measures 1.1 fps". Re-measured
against a window that is actually moving: **58.7 fps, 2.5 ms jitter** — smoother than full-screen
capture (53.0 fps, 5.9 ms). The benchmark had captured `sources[0]`, an arbitrary and usually static
window, and Windows Graphics Capture only delivers frames on change. `bench-capture.cjs` now captures
its own motion window by `getMediaSourceId()`.

This is the second time a test source, not the capture, produced the number (the first was the
12 fps "limit" in 01-02).

## What was built

- "What to record": Entire screen / One window, in the shared picker style, two columns so a
  third option ("A region") wraps without redesign.
- `WindowPicker.tsx`: thumbnail grid (titles alone are ambiguous), refreshed on focus and every 3 s
  while choosing; a closed window is deselected and the trigger disarms.
- `capture:set-target` IPC; main's display-media handler captures the chosen window, and refuses
  rather than falling back to the full screen if it is gone — recording the whole desktop when
  someone asked for one window would capture what they chose to leave out.
- This app's own windows are never offered.
- The footer's size readout now tracks the live track settings.

## Verification (built app, driven over CDP)

| check | result |
| ----- | ------ |
| trigger disabled until a window is picked | yes |
| file size matches the window, not the screen | 984×620 |
| motion preserved | ~56 frames/s on playback |
| seeks | exact |
| record right after the window closed | "“motion-source” could not be recorded. It may have been closed; pick it again." |
| after the next refresh | deselected, trigger disabled |

## Found and fixed during verification

- Footer showed 1920×1080 for a 984×620 window: capture settings report the screen size until the
  first frame. Now re-read every 200 ms.
- A closed window stayed selected: focus-only refresh never fired while the app was in front.

## Known limits

- Audio is whole-system loopback even in window mode; Windows has no per-window loopback here.
- A minimized window delivers no frames.
- Invisible system windows (e.g. "NVIDIA GeForce Overlay") are listed; harmless, but noise.
