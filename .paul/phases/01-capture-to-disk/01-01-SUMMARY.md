---
phase: 01-capture-to-disk
plan: 01
subsystem: capture
tags: [electron, mediarecorder, desktopcapturer, vp9, ipc, streaming-io]

requires: []
provides:
  - Streaming recording IPC contract (begin/append/finish/abort)
  - Atomic .part -> rename save path with collision-safe filenames
  - Primary-display capture with no picker dialog
  - Record/stop UI with live capture readout
affects: [library-phase, window-region-selection, audio-phase]

tech-stack:
  added: []
  patterns:
    - 'Streamed IPC for large binary payloads instead of single-message transfer'
    - 'Atomic write via temp file + rename'
    - 'Runtime codec negotiation driven by measurement, not assumption'

key-files:
  created:
    - src/renderer/src/useRecorder.ts
    - src/renderer/src/index.css
    - src/renderer/src/dom-augment.d.ts
  modified:
    - src/main/index.ts
    - src/preload/index.ts
    - src/shared/types.ts
    - src/renderer/src/App.tsx
    - CLAUDE.md

key-decisions:
  - 'VP9 preferred over H.264: H.264 ignores videoBitsPerSecond on this hardware'
  - "resizeMode 'none': Chromium resamples every frame by default, softening text"
  - 'No width/height constraints: unconstrained capture already returns native resolution'
  - 'Streaming IPC replaced single-buffer save before any code was written (audit M1)'

patterns-established:
  - 'Never resolve a save unless bytes were fully written and the rename succeeded'
  - 'Measure encoder behaviour before trusting an API hint'

duration: ~75min
started: 2026-09-16T05:20:00Z
completed: 2026-09-16T06:15:00Z
description: 'Primary-screen recording streamed atomically to disk as VP9 webm at native resolution'
type: Summary
about: 'ScreenRecorder'
---

# Phase 1 Plan 01: Capture to Disk — Summary

**Primary-screen recording streamed atomically to disk as VP9/webm at native 1920×1080, with a
record/stop UI and a live capture readout.**

## Performance

| Metric         | Value                    |
| -------------- | ------------------------ |
| Duration       | ~75 min                  |
| Tasks          | 3 auto + 1 checkpoint    |
| Files modified | 8 (6 planned, 2 added)   |
| Qualify cycles | 2 GAP fixes, 0 DRIFT     |

## Acceptance Criteria Results

Reported honestly: several criteria are **implemented but not exercised**. They are not claimed as
passing.

| Criterion                              | Status       | Evidence                                                                 |
| -------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| AC-1: Primary screen, no picker         | **Pass**     | No picker observed; `display_id` correlation implemented. Single-monitor machine, so multi-monitor selection is untested |
| AC-2: Playable file in Videos folder    | **Pass**     | 4 recordings written to `Videos\ScreenRecorder`; decoded at 1920×1080     |
| AC-3: App reports where it went         | **Pass**     | Filename shown; "Show in folder" wired to `revealRecording`               |
| AC-4: Failed capture leaves UI idle     | _Unverified_ | Implemented; cancel path never exercised                                  |
| AC-5: Failed write surfaces, no partial | **Partial**  | `.part` cleanup verified (zero leftovers); write-failure path not exercised |
| AC-6: Long recording bounded in memory  | _Unverified_ | Streaming implemented; no 5-minute recording made                         |
| AC-7: External capture end handled      | _Unverified_ | `track.onended` implemented; "Stop sharing" path not tested               |
| AC-8: Legible at native resolution      | **Pass\***   | 1920×1080, `resizeMode: none`, extracted frame visually sharp. \*Motion smoothness — the user's main complaint — remains unconfirmed |

## Accomplishments

- Replaced a single-buffer save with a streaming IPC contract before any code shipped, correcting
  the foundation Phases 2–4 inherit.
- Diagnosed low output quality by measurement rather than assumption: proved H.264 discards
  `videoBitsPerSecond` and that Chromium resamples frames by default.
- Atomic write path verified end-to-end — no `.part` files leaked across four recordings.

## Files Created/Modified

| File                              | Change   | Purpose                                                       |
| --------------------------------- | -------- | ------------------------------------------------------------- |
| `src/shared/types.ts`             | Modified | Trimmed phantom API; added streaming contract + `DisplayInfo`  |
| `src/main/index.ts`               | Modified | Recordings dir, streaming IPC, display correlation, quit-finalize |
| `src/preload/index.ts`            | Modified | Explicit streaming surface over the context bridge             |
| `src/renderer/src/useRecorder.ts` | Created  | Recording lifecycle, codec negotiation, chunk streaming        |
| `src/renderer/src/App.tsx`        | Modified | Record/stop control, saved-file row, capture readout           |
| `src/renderer/src/index.css`      | Created  | **Undeclared.** Styling for the record control                 |
| `src/renderer/src/dom-augment.d.ts` | Created | **Undeclared.** `resizeMode` types missing from DOM lib        |
| `CLAUDE.md`                       | Modified | Container guidance reversed to match measured evidence         |

## Decisions Made

| Decision                        | Rationale                                                                     | Impact                                          |
| ------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------- |
| VP9 preferred over mp4/H.264     | H.264 ignored the bitrate hint entirely; VP9 honoured it (2.5 → 22 Mbps)       | Reverses prior CLAUDE.md guidance; mp4 is fallback |
| `resizeMode: 'none'`             | Default `crop-and-scale` resamples every frame even at matching dimensions      | Sharper text; applies to all future capture modes |
| Drop width/height constraints    | Unconstrained capture already returns native resolution                        | Removes the scaler trigger                       |
| 20 Mbps target bitrate           | Now actually binding under VP9                                                  | Becomes the validated midpoint for the 01-02 picker |

## Deviations from Plan

### Summary

| Type             | Count | Impact                                    |
| ---------------- | ----- | ----------------------------------------- |
| Auto-fixed       | 2     | Both caught by qualify; both real defects |
| Spec corrections | 1     | AC-8 added mid-execution                  |
| Scope additions  | 2     | Two undeclared files, both necessary      |

### Auto-fixed Issues

**1. [API misuse] `stream.destroy()` called with a callback**

- Found during: Task 1 qualify
- Fix: wait on the `close` event instead
- Caught by: `npm run typecheck`

**2. [Silent defect] `createWriteStream` EEXIST handling was dead code**

- Found during: Task 1 qualify, from a flagged DONE_WITH_CONCERNS
- Issue: `flags: 'wx'` reports EEXIST via an async `error` event, not a throw. The `try/catch`
  around it could never fire — meaning the collision protection that audit finding **M4** existed
  to provide did not work at all.
- Fix: rewrote as an async open resolving on `open`, rejecting on `error`
- Note: this is the strongest argument in this plan for the qualify step. The code looked correct,
  typechecked, and would have silently overwritten recordings.

### Spec Correction

**AC-8 (quality) added mid-execution.** The original plan specified no bitrate, resolution, or
frame rate, so all three fell to Chromium defaults. Classified as a **Spec** issue and routed
through the acceptance criteria before any code changed. The enterprise audit also missed this —
it reviewed integrity and failure handling, never output quality.

## Issues Encountered

| Issue                                      | Resolution                                                         |
| ------------------------------------------ | ------------------------------------------------------------------ |
| First quality fix (16 Mbps) changed nothing | H.264 discards the hint; proven by codec measurement harness        |
| Could not decode own mp4 output to inspect  | Switched to VP9; frame extraction then worked                       |
| `navigator.mediaDevices` undefined in harness | `data:` URLs are insecure origins; loaded from a file instead      |

## Skill Audit

| Expected          | Invoked | Notes                                                        |
| ----------------- | ------- | ------------------------------------------------------------ |
| `frontend-design` | ✓       | Guidance loaded and applied — one bold element (the trigger), restrained dark palette, no generic AI-design tells |
| `/code-review`    | ○       | Optional; not run                                            |

## Next Phase Readiness

**Ready:**

- Streaming IPC contract that the library, window/region, and audio phases all build on
- Atomic write path proven across four recordings
- A validated 20 Mbps midpoint for the 01-02 quality picker

**Concerns:**

- **Motion smoothness unconfirmed.** VP9 encodes in software; H.264 used the UHD 630 hardware
  encoder. If VP9 drops frames the codec decision must be revisited.
- **Four ACs implemented but unexercised** (AC-4, AC-5 partial, AC-6, AC-7). Worth a deliberate
  verification pass rather than assuming.
- **Gradient banding** is inherent to 8-bit 4:2:0 in MediaRecorder; bitrate mitigates, does not fix.

**Blockers:** None.

---

_Built with PAUL Framework v1.4 · https://chrisai.cv/skool_
_Phase: 01-capture-to-disk, Plan: 01_
_Completed: 2026-09-16_
