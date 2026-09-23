---
description: 'Plan 04-02 — region capture: what shipped'
type: PlanSummary
closed: 2026-09-23
---

# 04-02 — Record a region

## What was built

- Third source option, "A region", with a **Choose region…** button.
- `RegionSelector.tsx` in its own transparent full-screen window (`#region`): drag over the real
  desktop, live size readout, Esc or a click-without-drag cancels, and a drag under 16 px is
  treated as a stray click.
- `cropTrack()` crops the capture with the breakout box.
- A red outline window marks the region while recording — click-through and excluded from capture.
- Both new windows call `setContentProtection(true)`, like the indicator.

## The crop decision, on measurement

CLAUDE.md prescribed canvas first, breakout only if canvas proved expensive. Measured on an
876×376 crop of a 60 fps source (2026-09-23):

| crop | fps | jitter | CPU |
| ---- | --- | ------ | --- |
| canvas | 53.2 | 5.7 ms | 9% |
| **breakout box** | **55.3** | **4.8 ms** | **5.5%** |

Breakout won on all three, and beat even the uncropped feed on jitter, so the guidance was updated
rather than followed.

## Verification (built app, driven over CDP, including the drag)

| check | result |
| ----- | ------ |
| trigger disabled until a region is chosen | yes |
| live size during the drag | 600 × 400 |
| readout after choosing | "Ready to record a 600 × 400 region." |
| file dimensions | **750 × 500** — 600×400 at the display's 1.25 scale |
| motion | ~47 frames/s on playback (screen feed itself ~48) |
| seek, finalize | exact; 2 cue points |

## Notes

- Cancelling the selector keeps the previously chosen region, so a stray Esc costs nothing.
- The crop rect is rounded to even numbers: chroma is subsampled 2×2 and Chromium rejects odd rects.
- `onended` watches the source track, not the cropped one, or an externally stopped capture would
  go unnoticed.

## Not exercised

- A region spanning multiple monitors (single-display machine).
- Changing display scale or resolution mid-recording.
