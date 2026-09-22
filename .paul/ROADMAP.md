---
description: 'ScreenRecorder — milestone and phase structure'
type: Roadmap
about: 'ScreenRecorder'
---

# Roadmap: ScreenRecorder

## Overview

A Windows desktop screen recorder built with Electron. It captures the full screen, a single
window, or a selected region, with system audio, microphone, both, or none, and manages the
resulting files from a built-in library.

## Milestones

| Version | Name               | Phases | Status         | Completed  |
| ------- | ------------------ | ------ | -------------- | ---------- |
| v0.1    | Full-Screen Capture | 1      | ✅ Shipped     | 2026-09-17 |
| v0.2    | Recordings Library  | 1      | ✅ Shipped     | 2026-09-18 |
| v0.3    | Audio               | 1      | 🚧 In Progress | -          |

## 🚧 Current Milestone: v0.3 Audio

**Goal:** Record sound alongside the picture — system audio, the microphone, or both mixed.

This is 11 of the 16 remaining feature points, and it is next because window capture is blocked.
The approach was written into `CLAUDE.md` during the first planning session and has not changed.

## Phases

| Phase | Name               | Plans | Status      | Completed  |
| ----- | ------------------ | ----- | ----------- | ---------- |
| 1     | Capture to Disk    | 3     | ✅ Complete | 2026-09-17 |
| 2     | Recordings Library | 1     | ✅ Complete | 2026-09-18 |
| 3     | Audio              | 2     | Planning    | -          |
| 4     | Window and region  | TBD   | ⛔ Blocked  | -          |
| 5     | Playback and controls | 2  | ✅ Applied  | 2026-09-18 |

## Phase Details

### Phase 2: Recordings Library

**Goal:** Browse recordings in-app, play them inline or in the system player, and delete them
safely.
**Depends on:** Phase 1 (recordings directory, save pipeline, reveal handler)
**Research:** Unlikely — one known constraint, handled below

**Scope:**

- List recordings by reading the folder, with name, date, size and duration
- Inline playback, plus "open in default player"
- Delete to the Recycle Bin, with a permanent option
- Thumbnail tiles

**Known constraint:** the renderer's CSP is `media-src 'self' blob:`, so a `<video>` cannot load
`file://`. Playback needs a custom protocol handler registered in main. Loosening the CSP instead
would be the wrong trade.

**Plans:**

- [x] 02-01: Library core — browse, play, delete — _complete 2026-09-17_
- [~] 02-02: Thumbnail generation and caching — **PARKED 2026-09-18**

### Why 02-02 is parked, not cancelled

Thumbnails add **zero feature points**. "Browse recordings in-app" was already counted as shipped
in 02-01, so 02-02 is polish on a feature that already works — while audio is 11 points and window
capture is blocked. Parking it is a sequencing decision, not a judgement on the work.

Already built and committed from 02-02 (kept, not reverted):

- `src/main/recordingPath.cjs` — request validation, single source of truth
- `scripts/verify-guards.cjs` — `npm run verify:guards`, 16 refusals + 3 allowances asserted

Still to do if resumed: the thumbnail cache (Task 1), generation and display (Task 2), and the two
dev-only `__sim` hooks (Task 3b). The plan and its audit remain in place and stay valid — the tile
placeholders in `Library.tsx` are already sized, so resuming causes no relayout.

Split because combined this is 4+ tasks, past the 2-3 guidance. 02-01 ships a usable library with
placeholder tiles; 02-02 fills them. A thumbnail **cache** keyed by path and mtime does not violate
the "no index file" decision: an index is authoritative metadata that drifts from reality, while a
cache is derived, disposable, and regenerates itself when deleted.

## Phase Details

### Phase 1: Capture to Disk

**Goal:** Record the primary screen with no audio and save a playable file to the user's Videos
folder.
**Depends on:** Nothing (first phase)
**Research:** Unlikely (approach already documented in `CLAUDE.md`)

**Scope:**

- Recordings directory under `app.getPath('videos')`, created on first use
- `setDisplayMediaRequestHandler` auto-selecting the primary screen (no picker)
- Save and reveal IPC handlers
- Renderer record/stop control with runtime container selection

**Plans:**

- [x] 01-01: Full-screen capture saved to disk — _complete 2026-09-16_
- [x] 01-02: Capture frame-rate research — judder root-caused, 60 fps applied — _complete 2026-09-17_
- [x] 01-03: Recording quality picker — three presets, persisted — _complete 2026-09-17_

Plans 01-02 and 01-03 both came out of 01-01's checkpoint.

The user asked for a quality setting, which 01-01's boundaries explicitly excluded ("no settings
screen"), so it was deferred rather than smuggled in. It then moved again — to 01-03 — to investigate capture frame rate first.

01-02 resolved that: the "~12 fps" figure was an artifact of the benchmark's own motion source, and
real capture runs ~29 fps at a 30 fps target. The actual cause of the laggy motion was **interval
jitter**, not frame rate — sampling a 60 Hz display at ~29 fps spans a non-integer number of
refreshes. Raising the target to 60 fps halved the jitter and the user confirmed it resolved.

### Phase 3: Audio

**Goal:** Record system audio, the microphone, or both mixed, selectable before recording starts.
**Depends on:** Phase 1 (capture path, save pipeline, quality presets)
**Research:** Unlikely — the approach is documented in `CLAUDE.md`

**Plans:**

- [ ] 03-01: System audio — loopback capture and the audio-source control
- [ ] 03-02: Microphone and mixing — device selection, Web Audio mix, level control

Split because `MediaRecorder` accepts only one audio track: system audio alone is a straight
addition to the existing capture call, while mic and mixing require a Web Audio graph. 03-01 ships
a working system-audio recording; 03-02 adds the other two modes.

### Phase 4: Window and region — ⛔ blocked

Window capture measures **1.1 fps** through both capture paths (`npm run bench:capture --config
window-capture`). Region capture additionally needs a crop pipeline, since `getDisplayMedia` cannot
capture a sub-region. Neither is buildable on the current capture stack; a native Windows Graphics
Capture module is the likely unblock, which is a much larger piece of work than any phase so far.

**Reordering note:** audio was originally sequenced last, on the grounds that it was most likely to
force a rewrite. Window capture turned out to be the blocked one instead, so audio moved up.

---

_Roadmap created: 2026-09-16_
