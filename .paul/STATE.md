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
**Current focus:** v0.3 — playback correctness and recording controls

## Current Position

Milestone: v0.3 Audio (v0.1 and v0.2 shipped)
Phase: 5 (Playback and controls) — 05-01 and 05-02 applied, awaiting human verification
Plan: 03-01 closed; 05-01 and 05-02 applied
Status: APPLY complete for both, at the blocking human-verify checkpoint
Last activity: 2026-09-18 — seekable recordings (duration + cues) and the recording indicator with
pause/resume and mute

Progress:

- Features: [████████░░] 80% (37/46 pts)
- v0.3 Audio: [██████████] 100% (none, computer, microphone, both)

## Loop Position

Current loop state:

```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ✓     [Plan 03-01 closed — system audio shipped]
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
| 2026-09-18: 03-01 shipped system audio; picker CSS generalised rather than copied | Phase 3 | `.quality__*` became a shared `.picker__*` block used by both controls. A copied second style would have drifted; the audio control also now has a shape that absorbs 03-02's two extra options |
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
| ~~Persisted log file~~ — **shipped 2026-09-25** (userData/logs/app.log) | Audit | S | Done |
| ~~Free-space pre-check~~ — **shipped 2026-09-25** (warns at 2 GB, refuses at 300 MB) | Audit | S | Done |
| Pin container format for Store builds     | Audit  | S      | If/when MS Store is pursued     |

### Blockers/Concerns

| Concern                                                                                      | Impact                          | Resolution Path                       |
| -------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------- |
| ~~CLAUDE.md contradicted the code on container choice~~ | Resolved | **Closed at UNIFY** — CLAUDE.md now documents VP9 preference with the measured evidence |
| ~~Motion smoothness unconfirmed~~ | **Root cause found 2026-09-17**: interval jitter, not frame rate or bitrate. Capturing 60 Hz content at ~29 fps samples unevenly and reads as "snapping" | Target raised to 60 fps; jitter 8.4 -> 5.4 ms. **User confirmed resolved** |
| Legacy capture path applied then reverted same day | It won on average fps while doubling jitter — the metric that actually matters | Reverted to getDisplayMedia; CLAUDE.md corrected |
| Orphaned .part files were never reclaimed | User lost a recording to a flat battery; 31.4s was recoverable but stranded | `recoverOrphanedParts()` — **verified 2026-09-17**: reclaimed the 11.2 MB orphan intact |
| ~~AC-5/AC-7 unexercised~~ | **Closed 2026-09-17** via dev-only `__sim` hooks, after three plans | Root cause was diagnostic: both were written against UI this app never shows |
| ~~AC-6 unevidenced~~ — **closed 2026-09-25**: 5 min at Maximum, 105 MB file, memory 333.0 -> 332.2 MB median (growth 1.00x), duration and seek exact | Evidence captured by driving the built app; the new log file made the `[memory]` series retrievable |
| Defensive criteria keep shipping unexercised — AC-2, AC-5b, AC-5c, AC-8 refusals | Third plan with this pattern | **Folded into 02-02** as AC-6..AC-9, with an automated `verify:guards` script for the protocol refusals |
| ~~Recordings carry no Duration and no Cues~~ | **Fixed 2026-09-18 in 05-01**: duration 20.673 s recovered, seek 561 ms → 63 ms, cluster bytes identical | Existing recordings deliberately left alone at the user's choice; the player names the condition instead |
| MP4 cannot replace WebM | Chromium's MP4 muxer emits nothing until stop — 750 MB in memory for 5 min, and a power cut loses everything | Measured 2026-09-18. Re-measure before revisiting |
| Finalize fallback is unexercised | If `finalizeWebm` throws, the recording should still land by plain rename — correct by construction, never forced | A dev-only `__sim` hook, as was done for AC-5/AC-7 |
| `frontend-design` was not invocable in a resumed session | A plan marked it **blocking** | Guidance read from the installed plugin on disk instead. If a future plan blocks on a skill, check it resolves before APPLY |
| ~~Window capture measures 1.1 fps~~ — **benchmark bug, fixed 2026-09-22**: 58.7 fps on an animated window | **Blocks Phase 4** (window/region), which was reordered behind audio | A native Windows Graphics Capture module is the likely unblock — much larger than any phase so far |
| ~~02-02 thumbnails parked~~ — **shipped 2026-09-25** | Adds 0 feature points; browse was already counted in 02-01 | Plan and audit remain valid; tile placeholders already sized, so resuming causes no relayout |
| Ceremony reduced by request | Audit skipped for plans that do not touch data safety or security | 03-01 adds no delete path and no new CSP source, so the audit's usual targets are absent |
| ~~Full-screen capture at ~12 fps~~ — **cleared by a reboot 2026-09-23** (48 fps) | Real recordings affected (measured 13 frames/s on playback); region capture would inherit it | OS state: DXGI duplication fails on both adapters, WGC monitor capture starved. Not app code. Reboot, then re-measure |
| Gradient banding root cause is 8-bit 4:2:0 chroma, which MediaRecorder cannot avoid | May persist despite higher bitrate | Needs a different capture path if it matters |
| ~~Quality picker deferred~~ | **Shipped 01-03**: three presets, persisted, Balanced states its motion cost | Closed |
| 12 fps measurement may be confounded by the test animation own render rate | Root-cause claim unproven | **AC-1 of 01-02**, now with an explicit ≥2x decision rule |
| Findings will be single-machine, single-session | Cannot generalise to "Electron limitation" | Audit requires scope stated explicitly in FINDINGS |

## Boundaries (Active)

Protected for Plan 03-01:

- `package.json` — no `"type": "module"`; `typescript` stays pinned at 5.9.3
- `electron.vite.config.ts` — build targets and output formats
- `webPreferences` — `contextIsolation: true`, `nodeIntegration: false`
- `tsconfig.*.json` — strictness flags
- Streaming save pipeline + `.part` atomic write + `recoverOrphanedParts()`
- Capture path: `getDisplayMedia`, `resizeMode: 'none'`, no width/height constraints
- Codec preference (webm/vp9 first)
- Quality preset model and `settings.json` handling from 01-03
- **Renderer CSP: `file:` forbidden.** `recording:` added to `media-src` 2026-09-17 with user authorisation after a boundary stop — one validated handler, not filesystem access
- `recordingPath.cjs` validation and `verify-guards.cjs` — audio changes nothing here
- Codec preference (webm/vp9) — VP9 carries Opus audio; changing it affects both streams
- Out of scope: microphone and mixing (03-02), window/region, thumbnails, new dependencies

## Session Continuity

Last session: 2026-09-18
Stopped at: renamed to Capturio (settings and recordings carried over); README written
Next action: packaging — electron-builder config, icon, first npm run dist, then install and verify outside the dev environment
Resume file: .paul/phases/05-playback-and-controls/05-02-SUMMARY.md

**Repository:** committed at 3546d68. Phases 1 and 2 tracked; working tree clean at commit.

**Committed:** 03-01, 05-01, 05-02 at 7fbcde2 (not pushed). **Uncommitted:** 03-02.

**Parked:** 02-02 thumbnails. Its validator and verifier shipped and are committed; the cache,
generation and `__sim` hooks remain unbuilt. Plan and audit stay in place.

---

_STATE.md — Updated after every significant action_
