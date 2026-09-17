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

## Current Milestone

**v0.1 Full-Screen Capture** (v0.1.0)
Status: ✅ Shipped 2026-09-17
Phases: 1 of 1 complete

**Milestone goal:** Record the full screen with no audio and save a playable file to disk.

This deliberately narrow slice forces the three decisions everything else depends on: the capture
stream, the container/codec choice, and the save path.

## Phases

| Phase | Name            | Plans | Status      | Completed |
| ----- | --------------- | ----- | ----------- | --------- |
| 1     | Capture to Disk | 3     | Complete    | 2026-09-17 |

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

**Expected build order beyond v0.1** (not yet committed to phases):

1. Full-screen capture → save to disk
2. Recordings library — browse, play, delete, reveal
3. Window and region selection
4. Audio — system, then microphone, then mixed

Audio is sequenced last on purpose: it is the piece most likely to force a rewrite, and the
approach is already documented in `CLAUDE.md` so the knowledge survives between sessions.

---

_Roadmap created: 2026-09-16_
