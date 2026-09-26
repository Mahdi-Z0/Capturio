---
description: 'Record any part of a Windows screen with the right audio, then find, organise or delete the result without leaving the app'
type: Project
about: 'Capturio'
---

# Capturio

## What This Is

A Windows desktop screen recorder built with Electron. It captures the full screen, a single
application window, or a user-selected region, with audio from the system, the microphone, both
mixed, or none at all. Recordings are written to disk and managed from a built-in window where they
can be browsed by folder, played, organised and deleted.

The product goal is a small, obvious tool for personal use — every feature reachable in one or two
clicks — with the Microsoft Store as the intended distribution channel.

**The app is the floating control bar.** Recording never requires opening a window. That is the
central design commitment; see `CLAUDE.md` § "The control bar is the app".

**Renamed from ScreenRecorder to Capturio on 2026-09-25.** `productName` drives `userData`, so
settings live in `AppData/Roaming/Capturio` and are migrated once from the old folder. Recordings go
to `Videos/Capturio` **unless** `Videos/ScreenRecorder` already exists — on this machine it does, so
that is where they are.

## Core Value

Record any part of a Windows screen with the right audio, and find, play, organise or delete the
result without leaving the app.

## Current State

| Attribute    | Value                                     |
| ------------ | ----------------------------------------- |
| Type         | Application                               |
| Version      | 0.1.0                                     |
| Status       | Feature-complete for personal use; installer ships |
| Last Updated | 2026-09-27                                |

Every feature in the declared inventory is built and verified against the **built** app, not only in
development. What remains is Store packaging (MSIX + a Partner Center identity, an account matter)
and two agreed UX items — see **Planned** below.

## Requirements

### Core Features

- Capture full screen, a specific application window, or a user-selected region
- Audio selection: system (WASAPI loopback), microphone, both mixed, or none
- Save recordings to a user-writable location on disk, streamed, surviving a crash
- Browse, play, organise and delete recordings in-app
- Reveal a recording or its folder in Explorer

### Validated (Shipped)

**v0.1 Full-Screen Capture — 2026-09-17**

- [x] Record the primary screen and save a playable file — _01-01_
- [x] Capture at 60 fps with stable frame intervals — _01-02_
- [x] Recordings survive crash or power loss, reclaimed at startup — _01-02_
- [x] Choose recording quality from three presets, persisted — _01-03_
- [x] Reveal a recording in Explorer — _01-01_

**v0.2 Recordings Library — 2026-09-18**

- [x] Browse recordings, play inline, open in the system player, delete safely — _02-01_
- [x] Path validation shared by the protocol handler and its verifier — _02-01/02-02_
- [x] Thumbnail tiles, cached and disposable — _02-02_

**v0.3 Audio — 2026-09-22**

- [x] System audio via WASAPI loopback — _03-01_
- [x] Microphone with a device picker, falling back when a device disappears — _03-02_
- [x] System + microphone mixed into one track through Web Audio — _03-02_
- [x] Seekable recordings: duration and a keyframe cue index written after save — _05-01_
- [x] Pause/resume and mute mid-recording — _05-02_

**v0.4 Window, region and the bar — 2026-09-23**

- [x] Single-window capture — _04-01_
- [x] Region capture, cropped with the breakout box — _04-02_
- [x] The app became the floating bar; the window became the recordings window — _05-02_

**v0.5 Identity and shipping — 2026-09-25**

- [x] Renamed to Capturio, generated icons, README, all-rights-reserved licence — _06-01_
- [x] NSIS per-user installer, tray icon outside the asar, persisted log — _06-01_
- [x] Memory evidence for AC-6: flat across a five-minute recording — _06-01_

**v0.6 A library worth using — 2026-09-27**

- [x] The recordings window hides itself while recording, and has a way back to the bar — _07-01_
- [x] A saved card under the bar: Play and Show in library, both in-app — _07-01_
- [x] Folders the user makes, with move, drag-and-drop, and folder delete — _07-01_
- [x] Select one or many; act on the selection from a bar that follows the scroll — _07-01_
- [x] Right-click menus for a recording, a folder and the background — _07-01_
- [x] Three views: Recordings, Settings, Help — _07-01_

### Active (In Progress)

None. The loop is closed at 07-01.

### Planned (Next)

Agreed with the user, in this order:

1. **Configurable global shortcuts** — one to show the bar, one to record a region immediately.
   Defaults shipped rather than unset. Windows reserves most `Win+` combinations, so registration
   can fail silently; the UI must report a shortcut that did not take rather than pretend it did.
2. **A short "show me around" tour** — highlights the real buttons on the live bar, launched from
   Settings and Help. Explicitly **not** shown on first run (the user decided against that); the
   Help view already covers the same ground in prose, so this is a small addition, not onboarding.

Then, when the user wants it: **MSIX for the Microsoft Store**, which needs a Partner Center
publisher identity.

### Out of Scope

- Facecam / webcam overlay — deliberately excluded to keep the surface small
- Live streaming — not a recording concern
- Cloud upload or accounts — recordings stay local
- Editing beyond trim — this is a recorder, not an editor
- Telemetry of any kind without asking first

## Target Users

**Primary:** The developer, recording their own Windows screen.

- Wants the tool to open and record without configuration
- Values obvious controls over configurable ones
- Intends to publish to the Microsoft Store for general Windows users

## Context

**Technical Context:** Mature. Capture, audio, save, playback, organisation and packaging all work
and are verified by driving the built app over the Chrome DevTools Protocol. `CLAUDE.md` in the repo
root is the engineering knowledge base — it records what was measured, what was tried and reverted,
and the traps that cost hours. Read it before changing capture, playback, paths or windows.

## Constraints

### Technical Constraints

- Windows-only: system-audio loopback depends on Electron's `audio: 'loopback'`, which does not
  behave the same way on macOS
- `getDisplayMedia` cannot capture a sub-region; region capture crops in the renderer
- `MediaRecorder` records only the first audio track — multi-source audio must be mixed through
  the Web Audio API before recording
- `MediaRecorder` writes WebM in its live-streaming profile: no duration, no seek index. Every
  recording must be finalized after save or it cannot be scrubbed **in any player**
- Main and preload must remain CommonJS; Electron's ESM mode requires an `.mjs`, unsandboxed
  preload and adds CJS-interop pitfalls
- TypeScript is pinned to 5.9.3 — TS 7 ships no `lib/tsserver.js` and breaks the language server
- MSIX installs read-only to `WindowsApps`, so user data must never be written beside the executable
- `npm run dev` must run outside VS Code, or with `ELECTRON_RUN_AS_NODE` unset

### Business Constraints

- Solo developer; personal use is the first and only hard requirement
- All rights reserved to the author (see `LICENSE`) — the public repo grants no licence
- Microsoft Store is the intended channel; the installer is unsigned, so SmartScreen warns

## Key Decisions

| Decision                                            | Rationale                                                                                                         | Date       | Status |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| Electron + React + TypeScript via electron-vite      | Windows system-audio loopback is the hardest requirement and Chromium handles it natively; Tauri would need Rust plus third-party capture crates | 2026-09-15 | Active |
| Main and preload are CommonJS                        | Electron ESM requires an `.mjs` unsandboxed preload and breaks named imports from the `electron` builtin            | 2026-09-16 | Active |
| TypeScript pinned to 5.9.3                           | TS 7 is the native port and ships no `tsserver.js`, breaking `typescript-language-server`                          | 2026-09-15 | Active |
| Recordings library reads the folder on demand        | No index file to corrupt or migrate; self-heals when files are moved or deleted outside the app                     | 2026-09-16 | Active |
| User data lives in `app.getPath('videos'/'userData')` | Keeps the MSIX path open at zero cost, since the install directory is read-only                                   | 2026-09-16 | Active |
| WebM/VP9 over MP4                                    | H.264 ignores `videoBitsPerSecond` on this hardware; Chromium's MP4 muxer emits nothing until stop, so a power cut loses everything | 2026-09-18 | Active |
| Recordings are finalized after save, never re-encoded | A rewrite of the header plus a cue index makes them seekable; cluster bytes are copied byte for byte, and a finalize failure still leaves the recording | 2026-09-18 | Active |
| The app is a floating bar, not a window              | A recorder is never the task, only the thing capturing it                                                          | 2026-09-23 | Active |
| Region crop uses the breakout box, not canvas         | Measured better on fps, jitter **and** CPU, because it forwards each source frame with its own timestamp            | 2026-09-23 | Active |
| Renamed to Capturio                                  | Pronounceable, short, available, and a plausible Store name                                                        | 2026-09-25 | Active |
| Subfolders, with one validator for every path         | The user organises their own recordings; a name that cannot be served must not be creatable either                  | 2026-09-26 | Active |
| Settings moved off the bar into the window            | A floating strip is a poor place for a list of radio buttons; one copy of each control, not two                     | 2026-09-27 | Active |

## Success Metrics

| Metric                                                    | Target  | Current | Status      |
| --------------------------------------------------------- | ------- | ------- | ----------- |
| Full-screen capture saved to disk and replayable           | Works   | Works   | **Achieved** |
| Recording start is reachable within two clicks of launch   | ≤2      | 1 click | **Achieved** |
| A recording plays back correctly in Windows Media Player   | Plays   | Plays   | **Achieved** |
| Captured frame interval jitter                             | low     | 5.4 ms  | **Achieved** (was 8.4 ms) |
| Memory growth over a five-minute recording (AC-6)          | <1.5×   | 1.00×   | **Achieved** |
| Seeking lands where the scrubber says                      | Exact   | Exact   | **Achieved** |
| Recordings folder survives the app being renamed           | No loss | No loss | **Achieved** |

## Specialized Flows

See: .paul/SPECIAL-FLOWS.md

Quick Reference:

- `frontend-design` → UI and visual design work
- `/code-review` → quality gate before UNIFY
- `/security-review` → before any packaging or release

## Links

| Resource   | URL                                            |
| ---------- | ---------------------------------------------- |
| Repository | https://github.com/Mahdi-Z0/Capturio.git       |
| Local      | `C:\Users\master\Projects\vsc\ScreenRecorder` (folder name predates the rename) |

---

_PROJECT.md — Updated when requirements or context change_
_Last updated: 2026-09-27_
