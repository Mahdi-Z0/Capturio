---
description: 'Plan 05-01 — seekable recordings: what shipped'
type: PlanSummary
closed: 2026-09-18
---

# 05-01 — Seekable recordings

**Trigger:** user report — "the inline video player is broken, cannot skip forward it just freezes
the video and it reads wrong duration too, the video progress line at the bottom when moving it
reaches a time amount video duration have never reached."

**Ceremony note:** executed without a separate PLAN document, at the user's standing request to move
faster. Acceptance criteria and their measured results are recorded here instead.

## Root cause

Three reported symptoms, one cause. Every recording on disk was inspected before any code changed:

| File | Segment size | Duration | Cues |
| ---- | ------------ | -------- | ---- |
| all four | UNKNOWN | ABSENT | ABSENT |

MediaRecorder writes WebM in its live-streaming profile. It cannot know the duration while
recording, so it writes none, and it produces no cue index. `video.duration` therefore resolves to
`Infinity` — the scrubber maps to a fabricated timeline (the "time the video never reached"), and a
seek has no index to use, so Chromium scans and appears to freeze.

This affected every player, not just the in-app one.

## Alternative rejected on measurement

MP4 is seekable by construction, and `video/mp4;codecs=vp9,opus` records correctly here with a
proper `mvhd` duration and `mfra` index. It was rejected on delivery timing:

| container | chunks over 6 s | arrivals |
| --------- | --------------- | -------- |
| mp4 | 2 | **both at 6006 ms — nothing until stop** |
| webm | 6 | 1077, 2097, 3117, 4169, 5250, 6001 ms |

Chromium's MP4 muxer holds the whole file in renderer memory until stop. That is ~750 MB for five
minutes at 20 Mbps, and a power cut loses all of it — the exact failure this project already
suffered on a flat battery. Seeking is not worth trading crash safety for.

## What was built

`src/main/webmFinalize.cjs` — declares the Segment size, inserts the true `Duration` derived from
the last block timestamp, and appends a `Cues` index with one cue point per cluster. Plain CommonJS
so `scripts/verify-finalize.cjs` requires the shipped module directly, matching `recordingPath.cjs`.

`placeRecording()` in `src/main/index.ts` replaces the bare `rename` on both the finish path and the
crash-recovery path.

## Acceptance criteria

| AC | Result |
| -- | ------ |
| Duration is correct after finalizing | **Met** — 20.673 s reported for a file that measured 20673 ms |
| Seeking works | **Met** — seek completed in 63 ms vs 561 ms, landing at 15.5047 s of 20.673 s |
| No media is re-encoded | **Met** — 13,251,971 cluster bytes identical before and after |
| A finalize failure never costs the recording | **Met by construction** — falls back to plain rename; not exercised against a forced failure |
| Recovered `.part` files are finalized too | **Met** — same helper on both paths |
| Refuses to clobber or double-finalize | **Met** — `wx` flag, and an "already finalized" refusal |

## Decisions

- **Finalize after the bytes are on disk, never during.** Streaming and crash recovery are
  preserved exactly; the rewrite is a separate pass over a file that already exists.
- **Existing recordings are left alone,** at the user's choice. The player names the condition
  instead: a recording with no duration shows a note saying it predates the fix.
- **On `EEXIST` the destination is not deleted.** An earlier draft unlinked the destination on any
  failure, which would have turned a name collision into deletion of somebody else's recording.

## Files

`src/main/webmFinalize.cjs` (new), `src/main/webmFinalize.d.cts` (new),
`scripts/verify-finalize.cjs` (new), `src/main/index.ts`, `src/renderer/src/Library.tsx`,
`src/renderer/src/index.css`, `package.json`, `eslint.config.mjs`

## Reopened 2026-09-18 — the first fix was not enough

The user reported the inline player still broken after the checkpoint. The first round had been
verified over `file://`, a path the app never uses. Two further causes, both found by testing
through `recording://` with the shipped modules:

1. **No range support in the protocol handler.** It returned the whole file via `net.fetch` for
   every request. `seekable.end(0)` was 0 and a seek to 15.5 s landed at 0. `stream: true` on the
   scheme only *permits* ranges. Fixed in `src/main/byteRange.cjs` (`parseRange`,
   `createRangeResponse`), verified by `npm run verify:range` (22 cases).
2. **Cue points on non-keyframes.** Every cluster was indexed, but most open with audio and continue
   video mid-GOP. First seek worked; the second raised `PIPELINE_ERROR_DECODE` and all later seeks
   hung. Cues now go only on clusters holding a video keyframe, timed at that keyframe: 7 cues
   across 17 clusters on the test file.

Result, one `<video>` element, shipped modules behind the real scheme: seeks to 15.5, 3.25, 19.9,
0.5 and 10 s all landed exactly.

**Also:** a slice-based edit during this work deleted `pickPrimaryScreen`, `registerDisplayMediaHandler`
and `registerIpc` from `src/main/index.ts`. Caught by typecheck, restored from HEAD, 03-01's changes
re-applied, and every preload channel confirmed handled.

**Known casualty:** `Recording-2026-09-18_05-12-47.webm`, made during the first checkpoint, was
finalized with the faulty per-cluster index. The finalizer refuses already-finalized files, so it
will not be corrected automatically.
