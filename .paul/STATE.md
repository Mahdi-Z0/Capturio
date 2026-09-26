---
description: 'Capturio — current position and accumulated context'
type: ProjectState
about: 'Capturio'
---

# Project State

**If you are picking this project up cold, read in this order:** `AGENTS.md` (5 minutes, orientation)
→ this file (where things stand) → `CLAUDE.md` (the engineering knowledge base; read the sections
relevant to what you are about to touch).

## Project Reference

See: .paul/PROJECT.md (updated 2026-09-27)

**Core value:** Record any part of a Windows screen with the right audio, and find, play, organise or
delete the result without leaving the app.
**Current focus:** v0.7 — global shortcuts, then a short optional tour.

## Current Position

Milestone: **v0.6 "A library worth using" shipped 2026-09-27.** v0.1–v0.6 all shipped.
Phase: **7 complete.** Phase 8 (shortcuts and a tour) is next and not yet planned.
Plan: none open. 07-01 closed.
Status: **Feature-complete for personal use.** The installer builds and has been tested outside the
dev setup. Every declared feature is verified against the *built* app.
Last activity: 2026-09-27 — the recordings window gained three views (Recordings / Settings / Help),
and the documentation was brought up to date (this update).

Progress:

- Declared features: [██████████] 100%
- Remaining work is **new** scope (shortcuts, tour) plus Store packaging, not unfinished scope.

## Loop Position

```
PLAN ──▶ APPLY ──▶ UNIFY
  —        ✓        ✓     [Phases 6 and 7 were built conversationally; SUMMARYs written at close]
```

Phases 1–5 went through the full loop with PLAN and AUDIT files. Phases 6 and 7 did not: the user
drove them as a running list of requests, each item verified against the built app and committed
separately. Their SUMMARY files were written afterwards. **This is deliberate, not a gap** — but if
the next phase is larger than a handful of requests, plan it properly.

## What exists, in one screen

| Area | State |
| --- | --- |
| Capture | Full screen, one window, dragged region. 60 fps target, ~54 delivered, `resizeMode: 'none'` |
| Audio | None / computer / microphone / both mixed, with a device picker. Mute mid-recording |
| Save | Streamed to a `.part` file, renamed on completion, recovered at startup after a crash |
| Playback | Finalized after save (duration + keyframe cue index), served over `recording:` with `Range` |
| The app | A floating bar (`#bar`), always on top, excluded from capture, resizes to its content |
| The window | Recordings / Settings / Help. Folders, multi-select, drag-and-drop, right-click menus |
| Packaging | `npm run dist` → per-user NSIS installer. Generated multi-size icons. Tray icon. Persisted log |
| Verification | `npm run verify` — path guards, byte ranges, finalizer, all against the shipped modules |

## Accumulated Context

### Decisions

Only the ones that still constrain new work. Full history in `.paul/PROJECT.md` and the phase
SUMMARYs.

| Decision | Phase | Impact |
| --- | --- | --- |
| Electron + React + TS via electron-vite | Init | Sets the architecture; system-audio loopback works natively |
| Main/preload are CommonJS | Init | Do not add `"type": "module"` without re-verifying the app opens |
| TypeScript pinned to 5.9.3 | Init | Bumping it silently kills language-server diagnostics |
| Library reads the folder on demand | Init | No index file; removes a whole class of sync bugs |
| WebM/VP9, not MP4 | 1 | H.264 ignores the bitrate here; Chromium's MP4 muxer emits nothing until stop, so a power cut loses everything |
| Recordings are finalized after save, never re-encoded | 5 | Seekability is added by rewriting the header and appending cues; a finalize failure must still leave the recording |
| The protocol must answer `Range`, and send CORS headers | 5, 2 | Without ranges every seek lands at zero; without `Access-Control-Allow-Origin` the thumbnail canvas is tainted and `toBlob` returns null |
| The app is a floating bar, not a window | 5 | A recorder is never the task. Recording must never require opening anything |
| Region crop uses the breakout box, not canvas | 4 | Better on fps, jitter and CPU; forwards each frame with its own timestamp |
| Every always-on-top window sets `setContentProtection(true)` | 5 | Verified: 3919 matching pixels captured without it, **0** with it |
| The recordings window hides while recording | 7 | It is the one window capture can see, and hiding does not stop its media — pause *and* mute |
| One validator for every path | 7 | A name that cannot be served must not be creatable either; `verify-guards.cjs` exercises the shipped function |
| Settings live in the window, not on the bar | 7 | One copy of each control. The bar keeps only what changes mid-recording |
| Recordings folder falls back to `Videos/ScreenRecorder` | 6 | Renaming the app must never orphan existing recordings. **The live folder on this machine is the old one** |

### Deferred Issues

| Issue | Impact | Disposition |
| --- | --- | --- |
| **MSIX / Microsoft Store packaging** | Cannot submit to the Store | Needs a Partner Center publisher identity — the user's to obtain. `npm run dist:store` is wired |
| **Installer is unsigned** | SmartScreen warns on first run | Only matters for direct distribution; the Store re-signs |
| Gradient banding in dark gradients | Visible artefact | Root cause is 8-bit 4:2:0 chroma, which `MediaRecorder` cannot avoid in either codec. Needs a different capture/encode path |
| A minimised window records nothing | Documented limit | Windows supplies no frames for it. Stated in README and Help |
| Folder **rename** is not implemented | Minor | Create and delete are; rename was never asked for, and Explorer is one click away |
| Recordings made before 05-01 report no duration | Cosmetic, historical | The player says so when one is opened. Not worth a migration |
| ~~Full-screen capture at ~12 fps~~ | — | **Cleared 2026-09-23 by a reboot.** It was an OS state: DXGI duplication failed on both adapters. Before blaming code for choppy capture, run the Chromium capture logs — see `CLAUDE.md` |
| ~~Window capture "1.1 fps"~~ | — | **Not real.** A benchmark bug: it captured a static window. 58.7 fps against an animated one |
| ~~02-02 thumbnails parked~~ | — | **Shipped 2026-09-25** |

### Boundaries (Active)

These hold for **any** future plan unless the user explicitly lifts them:

- `package.json` — no `"type": "module"`; `typescript` stays pinned at 5.9.3
- `webPreferences` — `contextIsolation: true`, `nodeIntegration: false`. Never relax
- The preload exposes a named, explicit surface. Never expose `ipcRenderer` itself
- **Renderer CSP: `file:` is forbidden.** `recording:` in `media-src` is the one validated path
- Streaming save pipeline + `.part` atomic write + `recoverOrphanedParts()` — never make a failure
  path that can lose a recording
- `placeRecording()`'s fallback: if finalizing fails, the recording still lands by plain rename
- Capture path: `getDisplayMedia`, `resizeMode: 'none'`, no width/height constraints
- Codec preference (webm/vp9 first) — VP9 carries Opus; changing it affects both streams
- `recordingPath.cjs` is the single validator, and `scripts/verify-guards.cjs` must keep exercising
  the shipped function rather than a copy of its rules
- Deleting anything defaults to the Recycle Bin and **never** falls back to a permanent delete
- No new runtime dependencies without saying why. No telemetry without asking

## Session Continuity

Last session: 2026-09-27
Stopped at: Phase 7 closed and the project documentation brought up to date.
Next action: **Phase 8 — configurable global shortcuts** (show the bar; record a region immediately),
then decide whether the short tour is still worth building now that Help exists.
Resume file: `.paul/phases/07-library-and-window-ux/07-01-SUMMARY.md`

**Repository:** `https://github.com/Mahdi-Z0/Capturio.git`, branch `main`.

**Unpushed:** everything after `058906d`, which is the last commit on `origin/main`. Ask git rather
than trusting this line: `git log --oneline origin/main..HEAD` — it was **10 commits** when this was
written. The user has not authorised a push. **Ask before pushing** (a project rule in `CLAUDE.md`,
and it has been broken once — `058906d` itself was pushed unprompted).

**The user's recordings folder is `C:\Users\master\Videos\ScreenRecorder`** (the pre-rename name, kept
deliberately). It holds their own recordings, including a folder they made called `Mine`. Never delete
anything in there that you did not create; clean up your own test recordings to the Recycle Bin.

**How work is verified here:** by driving the built app over the Chrome DevTools Protocol
(`electron.exe . --remote-debugging-port=<port>`, then `Runtime.evaluate` over the WebSocket from a
small Node script). `npm run build` first. Development-only verification has been wrong often enough
in this project that it does not count as evidence — see `CLAUDE.md` for the specific cases.

---

_STATE.md — Updated after every significant action_
