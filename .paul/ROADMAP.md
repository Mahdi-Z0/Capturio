---
description: 'Capturio — milestone and phase structure'
type: Roadmap
about: 'Capturio'
---

# Roadmap: Capturio

## Overview

A Windows desktop screen recorder built with Electron. It captures the full screen, a single window,
or a selected region, with system audio, microphone, both, or none, and manages the resulting files
from a built-in recordings window. The app itself is a floating control bar.

## Milestones

| Version | Name                      | Phases | Status     | Completed  |
| ------- | ------------------------- | ------ | ---------- | ---------- |
| v0.1    | Full-Screen Capture       | 1      | ✅ Shipped | 2026-09-17 |
| v0.2    | Recordings Library        | 1      | ✅ Shipped | 2026-09-18 |
| v0.3    | Audio                     | 1      | ✅ Shipped | 2026-09-22 |
| v0.4    | Window, region and the bar | 2     | ✅ Shipped | 2026-09-23 |
| v0.5    | Identity and shipping     | 1      | ✅ Shipped | 2026-09-25 |
| v0.6    | A library worth using     | 1      | ✅ Shipped | 2026-09-27 |
| v0.7    | Shortcuts and a tour      | 1      | ⬜ Next    | -          |
| v1.0    | Microsoft Store           | 1      | ⬜ Blocked on the user's Partner Center identity | - |

## ⬜ Next Milestone: v0.7 Shortcuts and a tour

**Goal:** Reach the bar without finding it, and explain it once on demand.

Agreed with the user, in this order:

1. **Configurable global shortcuts.** One to show the bar, one to record a region immediately.
   Defaults are shipped rather than left unset. The hard part is honesty: Windows reserves most
   `Win+` combinations and `globalShortcut.register` returns false, so the UI must report a shortcut
   that did not take instead of displaying it as if it works. Ctrl+Shift+R already exists and already
   logs `[shortcut] Ctrl+Shift+R is taken` when it loses the race — that is the precedent to follow.
2. **A short "show me around" tour.** Highlights the real buttons on the live bar, launched from
   Settings and from Help. Explicitly **not** shown on first run — the user decided against that
   ("bar only window on first run, no tutorial"). The Help view now covers the same ground in prose,
   so this is a small addition rather than onboarding, and it may reasonably be dropped.

## Phases

| Phase | Name                    | Plans | Status      | Completed  |
| ----- | ----------------------- | ----- | ----------- | ---------- |
| 1     | Capture to Disk         | 3     | ✅ Complete | 2026-09-17 |
| 2     | Recordings Library      | 2     | ✅ Complete | 2026-09-25 |
| 3     | Audio                   | 2     | ✅ Complete | 2026-09-22 |
| 4     | Window and region       | 2     | ✅ Complete | 2026-09-23 |
| 5     | Playback and controls   | 2     | ✅ Complete | 2026-09-23 |
| 6     | Packaging and identity  | 1     | ✅ Complete | 2026-09-25 |
| 7     | Library and window UX   | 1     | ✅ Complete | 2026-09-27 |
| 8     | Shortcuts and a tour    | TBD   | ⬜ Next     | -          |
| 9     | Microsoft Store (MSIX)  | TBD   | ⬜ Waiting  | -          |

Phases 6 and 7 were built **conversationally**, not through PLAN → APPLY → UNIFY: the user drove them
as a running list of requests, each verified against the built app and committed on its own. Their
SUMMARY files were written afterwards so the journey is complete; there are no PLAN files for them,
and that is deliberate rather than missing.

## Phase Details

### Phase 1: Capture to Disk — ✅ complete

**Goal:** Record the primary screen with no audio and save a playable file to the user's Videos
folder.

**Plans:**

- [x] 01-01: Full-screen capture saved to disk — _complete 2026-09-16_
- [x] 01-02: Capture frame-rate research — judder root-caused, 60 fps applied — _complete 2026-09-17_
- [x] 01-03: Recording quality picker — three presets, persisted — _complete 2026-09-17_

01-02 resolved the "~12 fps" scare: it was an artifact of the benchmark's own motion source. The real
cause of laggy motion was **interval jitter**, not frame rate — sampling a 60 Hz display at ~29 fps
spans a non-integer number of refreshes. Raising the target to 60 halved the jitter.

### Phase 2: Recordings Library — ✅ complete

**Goal:** Browse recordings in-app, play them inline or in the system player, and delete them safely.

**Plans:**

- [x] 02-01: Library core — browse, play, delete — _complete 2026-09-17_
- [x] 02-02: Thumbnail generation and caching — _parked 2026-09-18, completed 2026-09-25_

02-02 was parked for sequencing (thumbnails add zero feature points while audio was 11) and finished
later. Its two lasting contributions are `src/main/recordingPath.cjs` — one validator shared by the
protocol handler and its verifier — and `scripts/verify-guards.cjs`, which now asserts **23**
refusals, 6 allowances and 11 folder names.

**Known constraint, still true:** the renderer CSP is `media-src 'self' blob: recording:`, so a
`<video>` cannot load `file://`. Playback goes through the custom protocol. `file:` stays forbidden.

### Phase 3: Audio — ✅ complete

**Goal:** Record system audio, the microphone, or both mixed, selectable before recording starts.

**Plans:**

- [x] 03-01: System audio — loopback capture and the audio-source control — _complete 2026-09-22_
- [x] 03-02: Microphone and mixing — device selection, Web Audio mix — _complete 2026-09-22_

Verified by decoding saved files with a 440 Hz tone playing: `none` has no audio track, `system`
carries the tone, `microphone` carries room sound with the tone at ~0 (echo cancellation), `both`
carries both in one track.

### Phase 4: Window and region — ✅ complete

**Goal:** Record one window, or a rectangle dragged out on screen.

**Plans:**

- [x] 04-01: Single-window capture — _complete 2026-09-22_
- [x] 04-02: Region capture with a crop pipeline — _complete 2026-09-23_

**This phase was marked ⛔ blocked for five days on a measurement that was wrong.** The "1.1 fps"
figure came from a benchmark that captured `sources[0]` — an arbitrary, usually static window — and
Windows Graphics Capture only delivers a frame when content changes. Against an animated window:
**58.7 fps, 2.5 ms jitter**. The lesson is in `CLAUDE.md`: always capture a *moving* source when
measuring, identified by `getMediaSourceId()`, never by list position.

### Phase 5: Playback and controls — ✅ complete

**Goal:** Make recordings seekable, and make a recording controllable while it runs.

**Plans:**

- [x] 05-01: Seekable recordings — duration and a keyframe cue index — _complete 2026-09-18_
- [x] 05-02: The recording indicator, pause/resume and mute — _complete 2026-09-18_

05-01 took three independent fixes before seeking actually worked, each found by testing the real
path rather than a proxy: finalize the file, answer `Range` in the protocol, and put cue points only
on clusters that hold a video keyframe. 05-02 grew into the floating bar (commit `b5ae5cb`), which
replaced the app window entirely.

### Phase 6: Packaging and identity — ✅ complete

**Goal:** Something the user can install and run outside the dev setup, under its own name.

**Plans:**

- [x] 06-01: Rename, icons, licence, README, installer, tray, log — _complete 2026-09-25_

See `.paul/phases/06-packaging-and-identity/06-01-SUMMARY.md`.

### Phase 7: Library and window UX — ✅ complete

**Goal:** Make the recordings window worth opening: folders, selection, and the things a file list is
expected to do.

**Plans:**

- [x] 07-01: The window the user asked for — six agreed items plus three rounds of refinement —
      _complete 2026-09-27_

See `.paul/phases/07-library-and-window-ux/07-01-SUMMARY.md`. The user's original six-item list was
worked in the agreed order 5 → 3 → 4 → 2, with items 1 and 6 remaining (Phase 8).

### Phase 8: Shortcuts and a tour — ⬜ next

**Goal:** As described under the v0.7 milestone above.

**Depends on:** nothing outstanding. The Settings view exists to hold the controls, and Help exists to
launch the tour from.

**Research:** none needed. `globalShortcut` is already in use for Ctrl+Shift+R; the failure mode
(a combination Windows has reserved) is already observed and logged.

### Phase 9: Microsoft Store (MSIX) — ⬜ waiting on the user

**Goal:** A submittable MSIX package.

`electron-builder.yml` already has an `appx`-capable configuration path, and `npm run dist:store` is
wired. What is missing is not build work: it is a **Partner Center publisher identity**, which only
the user can obtain. The Store re-signs on submission, so the unsigned-installer warning does not
apply there.

---

_Roadmap created: 2026-09-16 — last updated 2026-09-27_
