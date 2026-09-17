---
description: 'Record any part of a Windows screen with the right audio, then find or delete the result without leaving the app'
type: Project
about: 'ScreenRecorder'
---

# ScreenRecorder

## What This Is

A Windows desktop screen recorder built with Electron. It captures the full screen, a single
application window, or a user-selected region, with audio from the system, the microphone, both
mixed, or none at all. Recordings are written to disk and managed from a built-in library where
they can be browsed, played, and deleted. The product goal is a small, obvious tool for personal
use — every feature reachable in one or two clicks — with the Microsoft Store as a possible later
distribution channel.

## Core Value

Record any part of a Windows screen with the right audio, and find, play, or delete the result
without leaving the app.

## Current State

| Attribute    | Value        |
| ------------ | ------------ |
| Type         | Application  |
| Version      | 0.1.0        |
| Status       | Initializing |
| Last Updated | 2026-09-16   |

## Requirements

### Core Features

- Capture full screen, a specific application window, or a user-selected region
- Audio selection: system (WASAPI loopback), microphone, both mixed, or none
- Save recordings to a user-writable location on disk
- Browse recorded files in an in-app library
- Delete a recording, or reveal it in Explorer

### Validated (Shipped)

None yet.

### Active (In Progress)

None yet.

### Planned (Next)

- v0.1: full-screen capture saved to disk and replayable

### Out of Scope

- Facecam / webcam overlay — deliberately excluded to keep the surface small
- Live streaming — not a recording concern
- Cloud upload or accounts — recordings stay local
- Editing beyond trim — this is a recorder, not an editor

## Target Users

**Primary:** The developer, recording their own Windows screen.

- Wants the tool to open and record without configuration
- Values obvious controls over configurable ones
- May later publish to the Microsoft Store for general Windows users

## Context

**Technical Context:** Greenfield. The build tooling, IPC bridge, and capture-source enumeration
are scaffolded and verified; no recording functionality exists yet. See `CLAUDE.md` in the repo
root for architecture rules and the capture/audio approach.

## Constraints

### Technical Constraints

- Windows-only: system-audio loopback depends on Electron's `audio: 'loopback'`, which does not
  behave the same way on macOS
- `getDisplayMedia` cannot capture a sub-region; region capture requires a crop pipeline
- `MediaRecorder` records only the first audio track — multi-source audio must be mixed through
  the Web Audio API before recording
- Main and preload must remain CommonJS; Electron's ESM mode requires an `.mjs`, unsandboxed
  preload and adds CJS-interop pitfalls
- TypeScript is pinned to 5.9.3 — TS 7 ships no `lib/tsserver.js` and breaks the language server
- MSIX installs read-only to `WindowsApps`, so user data must never be written beside the executable
- `npm run dev` must run outside VS Code, or with `ELECTRON_RUN_AS_NODE` unset

### Business Constraints

- Solo developer; personal use is the first and only hard requirement
- Microsoft Store is a possible later target, not a current commitment

## Key Decisions

| Decision                                            | Rationale                                                                                                         | Date       | Status |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| Electron + React + TypeScript via electron-vite      | Windows system-audio loopback is the hardest requirement and Chromium handles it natively; Tauri would need Rust plus third-party capture crates | 2026-09-15 | Active |
| Main and preload are CommonJS                        | Electron ESM requires an `.mjs` unsandboxed preload and breaks named imports from the `electron` builtin            | 2026-09-16 | Active |
| TypeScript pinned to 5.9.3                           | TS 7 is the native port and ships no `tsserver.js`, breaking `typescript-language-server`                          | 2026-09-15 | Active |
| Microsoft Store deferred, not designed around        | AppX/MSIX identity and publisher are build config, and the Store re-signs on submission — no rebuild needed later  | 2026-09-16 | Active |
| Recordings library reads the folder on demand        | No index file to corrupt or migrate; self-heals when files are moved or deleted outside the app                     | 2026-09-16 | Active |
| User data lives in `app.getPath('videos'/'userData')` | Keeps the MSIX path open at zero cost, since the install directory is read-only                                   | 2026-09-16 | Active |

## Success Metrics

| Metric                                                    | Target  | Current | Status      |
| --------------------------------------------------------- | ------- | ------- | ----------- |
| v0.1: full-screen capture saved to disk and replayable     | Works   | -       | Not started |
| Recording start is reachable within two clicks of launch   | ≤2      | -       | Not started |
| A recording plays back correctly in Windows Media Player   | Plays   | -       | Not started |

## Tech Stack / Tools

| Layer      | Technology             | Notes                                                        |
| ---------- | ---------------------- | ------------------------------------------------------------ |
| Shell      | Electron 44            | `desktopCapturer` + display-media loopback audio              |
| UI         | React 19               | Renderer only; no Node access                                 |
| Language   | TypeScript 5.9.3       | Strict; pinned for language-server compatibility              |
| Build      | electron-vite 5 + Vite 7 | Main/preload CJS, renderer ESM                              |
| Packaging  | electron-builder 26    | NSIS installer now; `appx` target available for the Store     |
| Recording  | MediaRecorder + Web Audio | Container chosen at runtime via `isTypeSupported()`        |
| Quality    | ESLint 9, Prettier 3   | Prettier runs automatically via a Claude Code hook            |

## Specialized Flows

See: .paul/SPECIAL-FLOWS.md

Quick Reference:

- `frontend-design` → UI and visual design work
- `/code-review` → quality gate before UNIFY
- `/security-review` → before any packaging or release

## Links

| Resource   | URL                                            |
| ---------- | ---------------------------------------------- |
| Repository | local only — `C:\Users\master\Projects\vsc\ScreenRecorder` |

---

_PROJECT.md — Updated when requirements or context change_
_Last updated: 2026-09-16_
