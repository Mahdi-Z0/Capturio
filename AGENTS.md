# Working on Capturio

Orientation for anyone — human or AI — picking this project up without prior context. Read this
first; it should take five minutes and tell you where everything else is.

> `CLAUDE.md` is the **engineering knowledge base** and applies whatever tool you are using. The name
> is historical: it is loaded automatically by Claude Code. Nothing in it is Claude-specific.

## What this is

A Windows screen recorder built with Electron 44 + React 19 + TypeScript 5.9 (strict), bundled by
electron-vite. Personal-use tool for the author, heading for the Microsoft Store. All rights reserved
(`LICENSE`); the public repo grants no licence to use the code.

**The app is a floating control bar, not a window.** That is the central design commitment: recording
never requires opening anything. A separate recordings window holds what does not fit on a floating
strip — the recordings themselves, settings, and help.

## Read in this order

| Order | File | What it gives you |
| --- | --- | --- |
| 1 | **this file** | Orientation, commands, the rules that bind |
| 2 | **`.paul/STATE.md`** | Where the project stands right now, what is next, what is deferred |
| 3 | **`CLAUDE.md`** | The engineering knowledge base: what was measured, what was tried and reverted, and the traps. Read the sections covering what you are about to touch |
| 4 | `.paul/PROJECT.md` | Requirements, constraints, key decisions with rationale |
| 5 | `.paul/ROADMAP.md` | Milestones and phases, shipped and planned |
| 6 | `.paul/phases/*/**-SUMMARY.md` | What each piece of work actually did, in order |
| 7 | `PROGRESS.md` | Generated feature inventory — never edit it, edit `.paul/progress.json` |
| — | `README.md` | Written for a user of the app, not a maintainer |

`.paul/` is the project's journal, managed by the PAUL framework (PLAN → APPLY → UNIFY). You do not
need the framework installed to read it, and you do not have to use the loop — but **if you do
substantial work, write a SUMMARY for it**, so the next session inherits the reasoning rather than
re-deriving it. Phases 6 and 7 were built conversationally and their SUMMARYs were written at the
close; that is an acceptable pattern for a list of small requests, not for a large change.

## Commands

| Task | Command |
| --- | --- |
| Dev, with hot reload | `npm run dev` |
| Type check | `npm run typecheck` |
| Lint | `npm run lint` |
| Production build | `npm run build` (runs typecheck first, and fails on a type error — keep it that way) |
| Installer | `npm run dist` → `release/Capturio-Setup-<version>.exe` |
| All verifiers | `npm run verify` |
| Capture benchmark | `npm run bench:capture` |
| Regenerate icons | `npm run icons` |
| Regenerate PROGRESS.md | `npm run progress` |

**`npm run dev` must not be launched from inside VS Code's terminal.** VS Code exports
`ELECTRON_RUN_AS_NODE=1`, Electron then runs as plain Node, and `require('electron')` returns a path
string instead of the API — every Electron API appears `undefined`. Unset it first
(`unset ELECTRON_RUN_AS_NODE`) or use a normal terminal. Check this variable before diagnosing any
"Electron API is undefined" error; it has wasted time here before.

## How work is verified in this project

**By driving the built app, not by testing in development.** Development-only verification has been
wrong often enough here that it does not count as evidence — playback over `file://` hid a broken
`Range` handler, and a tray icon that worked in dev was blank when installed.

The pattern: `npm run build`, launch `node_modules/electron/dist/electron.exe . --remote-debugging-port=<port>`,
then drive it from a small Node script over the Chrome DevTools Protocol (`Runtime.evaluate` on the
page whose URL matches `#bar` for the control bar, or no hash for the recordings window). Several of
these scripts appear in the phase summaries; they are throwaway by design.

`npm run verify` is the standing suite, and each part deliberately imports the **shipped** module
rather than a copy of its logic:

- `verify:guards` — every path rule (23 refusals, 6 allowances, 11 folder names)
- `verify:range` — byte-range parsing and the CORS headers playback and thumbnails depend on
- `verify:finalize` — the WebM finalizer, asserting the media bytes are identical before and after

## Architecture in one screen

```
src/
  main/      Electron main: windows, IPC handlers, file system, desktopCapturer, protocol
  preload/   Context bridge. The ONLY channel between main and renderer
  renderer/  React UI. No Node APIs, no direct fs access. Three windows, one bundle, chosen by hash
  shared/    Types used by both sides. Single source of truth for the IPC contract
```

Three windows come from one bundle, selected by URL hash: `#bar` (the control bar — the app),
`#region` (the region selector), and no hash (the recordings window). **CSS class names therefore
collide across windows**; scope anything window-specific.

Adding an IPC channel means touching three files in this order: `src/shared/types.ts`, then the main
handler, then the preload method. Keep them in sync.

## Rules that bind

From `CLAUDE.md` § Safety and the user's standing instructions:

- **Ask before `git push`**, before publishing, and before anything that writes outside this folder.
  There are unpushed commits; see `.paul/STATE.md`.
- **Recordings are personal data.** Never log file contents or full paths to a remote service, and
  never add telemetry without asking.
- **Never commit anything from `recordings/`** (gitignored — keep it that way).
- Confirm `git rev-parse --show-toplevel` points at this folder before any `git add -A`.
- **Do not add a dependency** without saying why in the commit body. Prefer platform APIs.
- `contextIsolation: true`, `nodeIntegration: false`, and `file:` forbidden in the renderer CSP.
  None of these are negotiable.
- **The user's recordings folder is real data.** It is `Videos/ScreenRecorder` on this machine (the
  pre-rename name, kept deliberately so the rename could not orphan anything). Never delete anything
  there you did not create, and send your own test recordings to the Recycle Bin when finished.
- Deleting anything defaults to the Recycle Bin and must never fall back to a permanent delete.
- A failure path must never be able to lose a recording. `placeRecording()`'s fallback exists for
  exactly this reason: if finalizing fails, the file still lands by plain rename.

## The five things most likely to surprise you

Each is documented with its measurement in `CLAUDE.md`; this is only a pointer so you know to look.

1. **A saved recording is not usable until it is finalized.** `MediaRecorder` writes WebM with no
   duration and no seek index, in every browser. `src/main/webmFinalize.cjs` rewrites the header and
   appends a cue index after the bytes are safely on disk. Nothing is re-encoded.
2. **Finalizing is not enough — the `recording:` protocol must answer `Range`**, and must send
   `Access-Control-Allow-Origin`, or seeking lands at zero and thumbnail canvases come back blank
   with no error.
3. **Judge capture by interval jitter, not average frame rate.** An uneven 29 fps looks broken while
   a steady one looks fine. Two separate "capture is broken" conclusions here turned out to be bugs
   in the measurement, not in the app.
4. **Windows and OS state lie to you.** Full-screen capture silently dropped to 12 fps for an
   afternoon because DXGI duplication failed on both GPUs; `document.visibilityState` reports `hidden`
   for a window that is merely covered. Check the environment before blaming the code.
5. **Every always-on-top window must call `setContentProtection(true)`.** A recorder that films its
   own UI is worse than one with no indicator. Verified: 3919 matching pixels captured without it, 0
   with it.

## What is next

See `.paul/STATE.md` § Session Continuity for the authoritative answer. As of 2026-09-27:
**Phase 8 — configurable global shortcuts**, then a decision on whether the short guided tour is
still worth building now that the Help view exists. After that, MSIX packaging for the Microsoft
Store, which is waiting on the user's Partner Center publisher identity.
