---
description: 'Plan 03-02 — microphone and mixing: what shipped'
type: PlanSummary
closed: 2026-09-22
---

# 03-02 — Microphone and mixing

**Ceremony note:** executed without a separate PLAN document, per the user's standing request to
move faster. Verified by driving the built app, not by harness.

## What was built

- `AudioMode` gains `microphone` and `both`; the picker shows all four in its 2×2 grid, as 03-01
  laid it out to do.
- `MicPicker.tsx`: "Windows default" first, then real devices (the `default`/`communications`
  aliases are hidden as duplicates), refreshed on `devicechange`. Stored as `micDevice` in
  settings v3.
- `acquireMic()` never throws: echo cancellation, noise suppression and AGC on; falls back once from
  a missing stored device to the default.
- `composeStream()`: two sources mixed through Web Audio into one track, each via its own GainNode.
- `audioShortfallNote()` replaces the single fixed warning and names what failed.

## Verification (built app, driven over CDP, 440 Hz tone playing)

| mode | audio track | rms | 440 Hz |
| ---- | ----------- | --- | ------ |
| none | none | — | — |
| system | 1 | 0.042 | 0.047 |
| microphone | 1 | 0.045 | 0.0004 |
| both | 1 (mixed) | 0.041 | 0.056 |

Footer named the right sources in all four modes; every file finalized.

## Not exercised

- A mic blocked by Windows privacy settings — the fallback and its message are correct by
  construction only.
- An unplugged stored device.

## Measurement trap found

The first signal check read all zeros, including for computer audio the user had already heard.
Cause: Web Audio silences cross-origin media, and `recording:` is a different origin from the app.
Recorded in CLAUDE.md.
