---
description: 'ScreenRecorder — current position and accumulated context'
type: ProjectState
about: 'ScreenRecorder'
---

# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-09-16)

**Core value:** Record any part of a Windows screen with the right audio, and find, play, or
delete the result without leaving the app.
**Current focus:** v0.2 Recordings Library — Phase 2, plan 02-02

## Current Position

Milestone: v0.2 Recordings Library (v0.1 shipped 2026-09-17)
Phase: 2 (Recordings Library) — In progress
Plan: 02-02 created + audited, awaiting approval (1 of 2 complete)
Status: PLAN created and audited, ready for APPLY
Last activity: 2026-09-18 — Enterprise audit applied to 02-02-PLAN.md (3 must-have, 5 strongly-recommended)

Progress:

- v0.2 milestone: [█████░░░░░] 50%
- Phase 2: [█████░░░░░] 50%

## Loop Position

Current loop state:

```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ○        ○     [Plan 02-02 created, awaiting approval]
```

## Accumulated Context

### Decisions

| Decision                                 | Phase | Impact                                                          |
| ---------------------------------------- | ----- | --------------------------------------------------------------- |
| Electron + React + TS via electron-vite   | Init  | Sets the whole architecture; system-audio loopback works natively |
| Main/preload are CommonJS                 | Init  | Do not add `"type": "module"` without re-verifying the app opens  |
| TypeScript pinned to 5.9.3                | Init  | Bumping it silently kills language-server diagnostics             |
| MS Store deferred                         | Init  | Only binding rule: never write user data beside the executable     |
| Library reads folder on demand            | Init  | No index file; removes a whole class of sync bugs                  |
| 2026-09-18: Enterprise audit on 02-02-PLAN.md. Applied 3 must-have, 5 strongly-recommended. Deferred 5. Verdict: conditionally acceptable | Phase 2 | Caught that `verify-guards.cjs` would have reimplemented the validation it tests — a green test of a copy, ending three plans of unverified guards with a false claim rather than a real one |
| 2026-09-17: CSP boundary stop resolved. Added `recording:` to `media-src` with user authorisation | Phase 2 | `'self'` does not cover a custom scheme, so the protocol handler alone could not play anything. Measured alternatives: blob: would load whole recordings into memory (~750 MB for 5 min), undoing 01-01's streaming design. `file:` stays forbidden |
| 2026-09-17: Enterprise audit on 02-01-PLAN.md. Applied 3 must-have, 5 strongly-recommended. Deferred 5. Verdict: conditionally acceptable | Phase 2 | First plan that deletes user files and serves bytes to the renderer. Caught that a failed Recycle Bin move would naturally fall back to permanent deletion, and that the protocol handler's path derivation was unspecified |
| 2026-09-17: Enterprise audit on 01-03-PLAN.md. Applied 3 must-have, 6 strongly-recommended. Deferred 5. Verdict: conditionally acceptable | Phase 1 | Caught that the Balanced preset would ship the fixed judder behind a "smaller files" label, and that AC-6's memory sampling could not identify the right process |
| 2026-09-17: Enterprise audit on 01-02-PLAN.md. Applied 4 must-have, 5 strongly-recommended. Deferred 5. Verdict: conditionally acceptable | Phase 1 | Measurement now has decision rules, per-window statistics and baseline control — a research plan's failure mode is a false conclusion |
| 2026-09-16: Enterprise audit on 01-01-PLAN.md. Applied 4 must-have, 6 strongly-recommended. Deferred 6. Verdict: conditionally acceptable | Phase 1 | Save path is now streaming + atomic; IPC contract that Phases 2-4 inherit was corrected before it shipped |

### Deferred Issues

| Issue                                    | Origin | Effort | Revisit                        |
| ---------------------------------------- | ------ | ------ | ------------------------------ |
| Container choice (mp4/avc1 vs webm/vp9)   | Init   | S      | During v0.1 — affects save path |
| Region-capture crop strategy              | Init   | M      | When region phase begins        |
| Persisted log file (console-only today)   | Audit  | S      | Before any non-personal release |
| Free-space pre-check before recording     | Audit  | S      | UX polish phase                 |
| Pin container format for Store builds     | Audit  | S      | If/when MS Store is pursued     |

### Blockers/Concerns

| Concern                                                                                      | Impact                          | Resolution Path                       |
| -------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------- |
| ~~CLAUDE.md contradicted the code on container choice~~ | Resolved | **Closed at UNIFY** — CLAUDE.md now documents VP9 preference with the measured evidence |
| ~~Motion smoothness unconfirmed~~ | **Root cause found 2026-09-17**: interval jitter, not frame rate or bitrate. Capturing 60 Hz content at ~29 fps samples unevenly and reads as "snapping" | Target raised to 60 fps; jitter 8.4 -> 5.4 ms. **User confirmed resolved** |
| Legacy capture path applied then reverted same day | It won on average fps while doubling jitter — the metric that actually matters | Reverted to getDisplayMedia; CLAUDE.md corrected |
| Orphaned .part files were never reclaimed | User lost a recording to a flat battery; 31.4s was recoverable but stranded | `recoverOrphanedParts()` — **verified 2026-09-17**: reclaimed the 11.2 MB orphan intact |
| ~~AC-5/AC-7 unexercised~~ | **Closed 2026-09-17** via dev-only `__sim` hooks, after three plans | Root cause was diagnostic: both were written against UI this app never shows |
| AC-6 still unevidenced after four plans | Instrumentation correct and pid-pinned, but no `[memory]` series captured | One 5-minute recording with console output pasted back |
| Defensive criteria keep shipping unexercised — AC-2, AC-5b, AC-5c, AC-8 refusals | Third plan with this pattern | **Folded into 02-02** as AC-6..AC-9, with an automated `verify:guards` script for the protocol refusals |
| Window capture measures 1.1 fps | **Blocks Phase 3** (window/region selection) | Measure alternatives before planning that phase |
| Gradient banding root cause is 8-bit 4:2:0 chroma, which MediaRecorder cannot avoid | May persist despite higher bitrate | Needs a different capture path if it matters |
| ~~Quality picker deferred~~ | **Shipped 01-03**: three presets, persisted, Balanced states its motion cost | Closed |
| 12 fps measurement may be confounded by the test animation own render rate | Root-cause claim unproven | **AC-1 of 01-02**, now with an explicit ≥2x decision rule |
| Findings will be single-machine, single-session | Cannot generalise to "Electron limitation" | Audit requires scope stated explicitly in FINDINGS |

## Boundaries (Active)

Protected for Plan 02-02:

- `package.json` — no `"type": "module"`; `typescript` stays pinned at 5.9.3
- `electron.vite.config.ts` — build targets and output formats
- `webPreferences` — `contextIsolation: true`, `nodeIntegration: false`
- `tsconfig.*.json` — strictness flags
- Streaming save pipeline + `.part` atomic write + `recoverOrphanedParts()`
- Capture path: `getDisplayMedia`, `resizeMode: 'none'`, no width/height constraints
- Codec preference (webm/vp9 first)
- Quality preset model and `settings.json` handling from 01-03
- **Renderer CSP: `file:` forbidden.** `recording:` added to `media-src` 2026-09-17 with user authorisation after a boundary stop — one validated handler, not filesystem access
- **Thumbnails use `data:`** — already allowed by `img-src`; do not extend `recording:` to `img-src`
- Protocol handler validation rules: 02-02 tests them, never relaxes them
- Out of scope: audio, window/region selection, rename/trim/search, ffmpeg, new dependencies

## Session Continuity

Last session: 2026-09-17
Stopped at: Plan 02-02 created
Next action: Approve, then /paul:apply .paul/phases/02-recordings-library/02-02-PLAN.md
Resume file: .paul/phases/02-recordings-library/02-02-PLAN.md

**Repository:** committed at c4edabb. Phase 1 tracked; working tree was clean at transition.

---

_STATE.md — Updated after every significant action_
