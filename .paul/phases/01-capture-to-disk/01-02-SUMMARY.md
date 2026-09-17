---
phase: 01-capture-to-disk
plan: 02
subsystem: capture
tags: [electron, getdisplaymedia, framerate, jitter, benchmark, vp9, recovery]

requires:
  - phase: 01-capture-to-disk
    provides: Streaming save pipeline and display-media capture from plan 01-01
provides:
  - Repeatable capture benchmark (`npm run bench:capture`) measuring rate AND interval stability
  - 60 fps capture target, replacing 30
  - Orphaned .part recovery at startup
  - Measured rejection of the WGC-flag and legacy-path hypotheses
affects: [window-region-selection, audio-phase, quality-picker]

tech-stack:
  added: []
  patterns:
    - 'Judge capture by interval jitter, not average frame rate'
    - 'A benchmark must measure its own test source, or it measures itself'
    - 'Crash artifacts are reclaimed, never abandoned'

key-files:
  created:
    - scripts/bench-capture.cjs
    - .paul/phases/01-capture-to-disk/01-02-FINDINGS.md
  modified:
    - src/renderer/src/useRecorder.ts
    - src/main/index.ts
    - src/shared/types.ts
    - src/preload/index.ts
    - eslint.config.mjs
    - package.json
    - CLAUDE.md

key-decisions:
  - 'Capture target 60 fps, not 30: halves interval jitter and removes judder'
  - 'Standard getDisplayMedia retained; legacy getUserMedia path tried and reverted'
  - 'WGC feature flags rejected on measurement — no effect on this hardware'
  - 'Orphaned .part files recovered by rename at startup, never overwriting'

patterns-established:
  - 'Average fps can look healthy while motion looks broken — measure interval spacing'
  - 'Re-measure before trusting a prior conclusion; three earlier claims were artifacts'

duration: ~90min
started: 2026-09-17T04:30:00Z
completed: 2026-09-17T06:20:00Z
description: 'Root-caused judder to interval jitter, raised capture to 60 fps, added a capture benchmark and .part recovery'
type: Summary
about: 'ScreenRecorder'
---

# Phase 1 Plan 02: Capture Frame Rate — Summary

**Root-caused the reported "snapping" to frame-interval jitter rather than frame rate, bitrate or
codec; raised the capture target to 60 fps (jitter 8.4 → 5.4 ms), and shipped a repeatable
benchmark plus recovery for recordings interrupted by crash or power loss.**

## Performance

| Metric         | Value                          |
| -------------- | ------------------------------ |
| Duration       | ~90 min                        |
| Tasks          | 3 auto + 1 checkpoint          |
| Files modified | 9 (7 planned, 2 unplanned)     |
| Benchmark runs | 17 across 9 configurations     |

## Acceptance Criteria Results

| Criterion                                         | Status       | Evidence                                                                                |
| ------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| AC-1: Benchmark separates source from capture rate | **Pass**     | Source rate reported per run with a ≥2× admissibility rule; **the confound was real** — "12 fps" was the test animation, actual capture is ~25–29 fps |
| AC-2: Configurations tested and recorded           | **Pass**     | 9 configurations, 17 runs, all in `01-02-FINDINGS.md` including errors and the 1.1 fps window-capture result |
| AC-3: Outcome conclusive either way                | **Pass**     | Positive: 60 fps target applied. Negative: WGC flags and legacy path both measured and rejected |
| AC-4: 01-01 save pipeline still works              | **Pass**     | Recordings continued throughout; atomic `.part` → rename intact; user recorded successfully post-change |
| AC-5: Cancelled capture leaves UI idle             | _Not exercised_ | See "unreachable as written" below                                                    |
| AC-6: Long recording bounded in memory             | **Partial**  | User recorded 5+ minutes successfully (42 MB, played back fine). Memory was **not** sampled — the `getProcessMemoryInfo` method the audit required was never wired up |
| AC-7: Capture ended outside the app handled        | _Not exercised_ | See "unreachable as written" below                                                    |

### AC-5 and AC-7 became unreachable

Both were written against `getDisplayMedia`: AC-5 assumed a permission prompt to cancel, AC-7
assumed Chromium's floating "Stop sharing" bar. Task 3 temporarily switched to the legacy path,
which has neither, and the verification steps were not rewritten — the user correctly reported not
recognising either. The legacy path was later reverted, so both surfaces exist again, but neither
criterion was actually tested. **They remain open, now for the second consecutive plan.**

An unplanned real-world test did exercise the adjacent failure path: a flat battery killed a
recording mid-write, and the atomic write behaved exactly as designed — a `.part` file rather than a
corrupt recording.

## Accomplishments

- **Found the actual cause of the user's complaint after five rounds of fixes had missed it.**
  Bitrate, codec, and scaler were all quality fixes aimed at a timing problem. Sampling a 60 Hz
  display at ~29 fps spans a non-integer number of refreshes, so motion is sampled unevenly and
  moving objects appear to snap. Average fps looks healthy throughout.
- **Disproved three of my own earlier claims** — the "12 fps capture limit", "requesting 60 delivers
  no more than 30", and the value of the legacy capture path. All three were artifacts of a
  benchmark whose motion source could not exceed ~12 fps.
- **Recovered real user data.** A recording lost to a flat battery was reclaimed intact (11.2 MB).

## Files Created/Modified

| File                             | Change   | Purpose                                                          |
| -------------------------------- | -------- | ---------------------------------------------------------------- |
| `scripts/bench-capture.cjs`      | Created  | 9-configuration capture benchmark with jitter and source-rate measurement |
| `src/renderer/src/useRecorder.ts` | Modified | 60 fps target; legacy path added then reverted                    |
| `src/main/index.ts`              | Modified | `recoverOrphanedParts()` at startup                               |
| `src/shared/types.ts`            | Modified | `getPrimarySourceId` added then removed with the legacy path      |
| `src/preload/index.ts`           | Modified | Same add/remove cycle                                             |
| `eslint.config.mjs`              | Modified | **Unplanned.** Lint coverage for `scripts/`                       |
| `package.json`                   | Modified | `bench:capture` script                                            |
| `CLAUDE.md`                      | Modified | Capture guidance corrected twice in one session                   |
| `01-02-FINDINGS.md`              | Created  | Full measurement record                                           |

## Decisions Made

| Decision                        | Rationale                                                                      | Impact                                            |
| ------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| Capture at 60 fps, not 30        | Jitter 8.4 → 5.4 ms; ~29 → ~54 fps. Near-1:1 with the display removes judder    | Resolved the user's primary complaint             |
| Keep `getDisplayMedia`           | At 60 fps the legacy path is indistinguishable (54.4 vs 54.6 fps); at 30 it had 2× the jitter | Standard API retained, no deprecation risk |
| Reject WGC feature flags         | Measured no effect — this was the leading hypothesis and it was wrong           | Documented so it is not retried                   |
| Recover `.part` by rename        | WebM decodes up to the truncation point; abandoning them loses real footage      | Interrupted recordings are no longer lost         |

## Deviations from Plan

### Summary

| Type                | Count | Impact                                              |
| ------------------- | ----- | --------------------------------------------------- |
| Applied then reverted | 1   | Legacy capture path — net zero code, real knowledge |
| Audit rule corrected | 1    | AC-1's threshold was unachievable as written        |
| Scope additions     | 2     | Jitter measurement, orphan recovery — both essential |
| Unplanned files     | 2     | `eslint.config.mjs`, `package.json`                 |

### 1. Legacy capture path applied in Task 3, reverted the same session

Applied on a 14% average-fps improvement. Reverted once jitter was measured: it had **twice the
interval jitter and four times the hitch rate** at a 30 fps target, and no advantage at 60. It won
on the metric being measured while losing on the metric that mattered. The original plan never
asked for jitter measurement; it was added mid-execution after the user described "snapping".

### 2. The audit's own AC-1 rule was unachievable

The audit required the motion source to sustain ≥ 2× the target rate. `requestAnimationFrame` is
capped by display refresh, so at a 30 fps target on a 60 Hz panel the source tops out at ~59.9 and
every run was ruled inconclusive by a rounding margin. Corrected to
`min(2 × target, 95% of refresh)`.

### 3. `.cjs` rather than the planned `.mjs`

Electron ESM is documented as broken in this project and the boundaries keep main CommonJS. A
script Electron loads as main is subject to the same constraint.

### Deferred Items

- **Window capture measures 1.1 fps** — effectively frozen, via both capture paths. Phase 3 cannot
  build on it as-is.
- **AC-5 and AC-7 still unexercised** after two plans.
- **AC-6 memory sampling never wired up** despite the audit specifying the method.
- ~54 fps is not 60, and ~10% of frames still arrive late.

## Issues Encountered

| Issue                                              | Resolution                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| First benchmark hung 400 s and printed `[object Object]` | Rewrote with `err.stack`, hard per-run timeout, forced exit    |
| `data:` URL harness could not load `file://` video   | Loaded the harness from a real file instead                       |
| Shell heredoc corrupted backslashes and `${}`        | Used the Edit tool and Python for script edits                    |
| Verification steps referenced UI that no longer existed | User could not find them; steps were stale after the Task 3 path change |

## Skill Audit

| Expected          | Invoked | Notes                                                                                   |
| ----------------- | ------- | ----------------------------------------------------------------------------------------- |
| `frontend-design` | ○       | **Gap.** The plan declared it not required (capture behaviour, not UI), but `App.tsx` did gain a capture-info footer. Minor and diagnostic rather than design work, but it is a renderer change made without the required skill |

## Next Phase Readiness

**Ready:**

- Capture pipeline delivers ~54 fps with stable intervals; the reported judder is resolved
- `npm run bench:capture` makes any future capture change measurable rather than guessed
- Save pipeline proven across ~10 recordings including a real power-loss interruption

**Concerns:**

- **Window capture at 1.1 fps blocks Phase 3** unless a different mechanism is found. Measure first.
- **Three acceptance criteria have now survived two plans unexercised.** They should be closed
  deliberately rather than carried a third time.
- Quality picker deferred twice; still queued as 01-03.

**Blockers:** None.

---

_Built with PAUL Framework v1.4 · https://chrisai.cv/skool_
_Phase: 01-capture-to-disk, Plan: 02_
_Completed: 2026-09-17_
