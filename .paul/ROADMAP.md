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
| v0.2    | Recordings Library  | 2      | 🚧 In Progress | -          |

## 🚧 Current Milestone: v0.2 Recordings Library

**Goal:** Find, play, and delete recordings without leaving the app — the second half of the core
value, and the last piece that does not depend on the blocked window-capture path.

## Phases

| Phase | Name               | Plans | Status      | Completed  |
| ----- | ------------------ | ----- | ----------- | ---------- |
| 1     | Capture to Disk    | 3     | ✅ Complete | 2026-09-17 |
| 2     | Recordings Library | 2     | In progress | -          |

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
- [ ] 02-02: Thumbnail generation and caching

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

**Expected build order beyond v0.1** (not yet committed to phases):

1. Full-screen capture → save to disk
2. Recordings library — browse, play, delete, reveal
3. Window and region selection
4. Audio — system, then microphone, then mixed

Audio is sequenced last on purpose: it is the piece most likely to force a rewrite, and the
approach is already documented in `CLAUDE.md` so the knowledge survives between sessions.

---

_Roadmap created: 2026-09-16_
