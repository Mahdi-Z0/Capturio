---
phase: 02-recordings-library
plan: 01
subsystem: library
tags: [electron, custom-protocol, csp, recycle-bin, react, intersection-observer]

requires:
  - phase: 01-capture-to-disk
    provides: Recordings directory, streaming save pipeline, reveal handler
provides:
  - In-app recordings library with inline playback
  - Custom `recording:` protocol for serving files without file:// access
  - Recycle Bin delete with a two-step permanent option
  - Shared separator-aware containment helper used by four path handlers
affects: [thumbnails, audio-phase, packaging]

tech-stack:
  added: []
  patterns:
    - 'Serve app files through a validated custom protocol, never file://'
    - 'A failed safe-delete stops; it never escalates to an unsafe one'
    - 'Derived state is computed, not synchronised in effects'

key-files:
  created:
    - src/renderer/src/Library.tsx
  modified:
    - src/shared/types.ts
    - src/main/index.ts
    - src/preload/index.ts
    - src/renderer/src/App.tsx
    - src/renderer/src/index.css
    - src/renderer/index.html
    - .paul/progress.json

key-decisions:
  - 'Added `recording:` to media-src under a raised and authorised boundary exception; `file:` stays forbidden'
  - 'Filename travels in the URL path behind a dummy authority, never the host'
  - 'Three most recent shown by default, expanding in place rather than into tabs'
  - 'Delete actions named by what they do: "Move to Recycle Bin" / "Delete permanently"'

patterns-established:
  - 'When a boundary fires, measure both sides before asking'
  - 'Screenshot the UI before asking a person to be its first viewer'

duration: ~100min
started: 2026-09-17T09:00:00Z
completed: 2026-09-17T10:30:00Z
description: 'In-app recordings library with protocol-served inline playback and Recycle Bin delete'
type: Summary
about: 'ScreenRecorder'
---

# Phase 2 Plan 01: Recordings Library — Summary

**An in-app library that lists recordings, plays them inline through a validated custom protocol,
opens them externally, and deletes them to the Recycle Bin — completing the "find, play, or delete
without leaving the app" half of the core value.**

## Performance

| Metric         | Value                                  |
| -------------- | -------------------------------------- |
| Duration       | ~100 min                               |
| Tasks          | 3 auto + 1 checkpoint                  |
| Files modified | 8 (7 planned, 1 unplanned)             |
| Qualify cycles | 3 PASS; Task 3 needed a 4-error lint fix |
| Boundary stops | 1 — raised, authorised, resolved        |

## Acceptance Criteria Results

| Criterion                                  | Status       | Evidence                                                        |
| ------------------------------------------- | ------------ | ----------------------------------------------------------------- |
| AC-1: All recordings listed, newest first    | **Pass**     | Checkpoint. Now 3 by default — see deviation 3                    |
| AC-2: Empty library explains itself          | _Unverified_ | Implemented; the folder has recordings, so never seen              |
| AC-3: Plays inside the app                   | **Pass**     | Measured both CSP configurations, then confirmed at checkpoint     |
| AC-4: Opens in the system player             | **Pass**     | Checkpoint                                                        |
| AC-5: Recycle Bin by default                 | **Pass**     | Checkpoint — file restorable from the Recycle Bin                 |
| AC-5b: Failed trash never escalates          | _Unverified_ | Implemented; requires a network drive or disabled Recycle Bin      |
| AC-5c: Cannot delete an in-flight recording  | _Unverified_ | Implemented; not reachable through the UI by design                |
| AC-6: Deleting while playing                 | **Pass**     | Checkpoint                                                        |
| AC-7: Externally removed file                | **Pass**     | Checkpoint                                                        |
| AC-8: Containment on every path handler      | **Partial**  | Happy path exercised; the refusal cases (traversal, UNC, encoded, `.part`) are implemented but untested |

### The recurring pattern, named

Four criteria are again **implemented but unexercised**, and all four are defensive paths. This is
the third plan where that has happened. In 01-03 the fix was dev-only `__sim` hooks, which closed
two criteria that had survived two plans. The same approach would close AC-5b, AC-5c, and AC-8's
refusals here. Worth doing deliberately rather than carrying them.

## Accomplishments

- **Completed the core value.** Every verb in "find, play, or delete the result without leaving the
  app" now works.
- **Raised a boundary instead of quietly crossing it.** The CSP blocked playback; the plan said stop
  and raise, so execution stopped, both configurations were measured, and the change was made only
  after authorisation — then recorded in three places.
- **Caught a case-sensitivity bug before it shipped**, visible only in the text of a CSP error.

## Files Created/Modified

| File                             | Change   | Purpose                                                       |
| -------------------------------- | -------- | --------------------------------------------------------------- |
| `src/renderer/src/Library.tsx`   | Created  | Library view, player, bounded duration probes                   |
| `src/shared/types.ts`            | Modified | `RecordingListItem`, scheme + extension constants, API surface   |
| `src/main/index.ts`              | Modified | Protocol handler, list/delete/open, shared containment helper    |
| `src/preload/index.ts`           | Modified | Three new bridge methods                                        |
| `src/renderer/src/App.tsx`       | Modified | Mounts the library; removed the redundant saved-file row         |
| `src/renderer/src/index.css`     | Modified | Library, player, tiles, expand control                          |
| `src/renderer/index.html`        | Modified | **Unplanned.** CSP `media-src` — authorised exception            |
| `.paul/progress.json`            | Modified | Two features marked shipped                                     |

## Decisions Made

| Decision                                | Rationale                                                                         | Impact                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------- |
| `recording:` added to `media-src`        | `'self'` is the document origin; a custom scheme is a different one, so the handler could never load. The alternative, blobs, means whole recordings in memory | Playback works; `file:` still forbidden  |
| Name in URL path, not host               | Standard schemes lowercase the hostname, corrupting filenames on case-sensitive filesystems | `recording://f/<name>` keeps case verbatim |
| Three most recent, expanding in place    | A long grid pushes the record button off screen; tabs would add navigation to an app with none | Record stays the first thing on screen  |
| Delete actions named by effect           | "Move to Recycle Bin" and "Delete permanently" make AC-5's distinction a naming problem rather than a dialog | No modal needed                        |

## Deviations from Plan

### Summary

| Type             | Count | Impact                                            |
| ---------------- | ----- | --------------------------------------------------- |
| Boundary stop    | 1     | Raised and authorised, not crossed silently         |
| AC amended       | 1     | AC-3 was factually unachievable as written          |
| Scope change     | 1     | User-requested collapse to 3 recent                 |
| Unplanned edits  | 2     | CSP line; removed the saved-file row                |

### 1. CSP boundary stop

The plan forbade widening `media-src` and required raising it instead. It fired exactly as intended:
playback was blocked because `'self'` does not cover a custom scheme. Execution halted, both
configurations were measured (blocked vs. plays cleanly at 1920×1080), the alternatives were costed,
and the change landed only after the user authorised it. The exception and its reasoning are now in
the HTML comment, the plan's boundary, and STATE.

This is the boundary mechanism working, not failing.

### 2. AC-3 amended

As written it required playback with the CSP unchanged — not achievable by any implementation.
Amended with the measurement rather than quietly marked pass.

### 3. Collapse to three most recent

User-requested mid-APPLY. Chose expand-in-place over tabs: tabs would introduce a navigation concept
to an app that has none and push the record trigger behind one.

### 4. Removed the saved-file row

With the library showing the newest recording at the top, a separate "last saved" row was a second
element doing the same job.

## Issues Encountered

| Issue                                                   | Resolution                                                            |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| Filename lowercased in the `recording://` URL            | It was riding in the host. Moved to the path behind a dummy authority    |
| Playback appeared broken even with the CSP fixed          | **My harness was wrong**: it attached `onloadedmetadata` after the element had already loaded. Cost three diagnostic rounds on a working configuration |
| Four lint errors in `Library.tsx`                         | All genuine: a self-referencing `useCallback`, derived state computed in effects, and a ref assigned during render. Fixed properly, not suppressed |

## Skill Audit

| Expected          | Invoked | Notes                                                                        |
| ----------------- | ------- | ------------------------------------------------------------------------------ |
| `frontend-design` | ✓       | Loaded before Task 3. Shaped the copy directly: the empty state names the action, delete actions say what they do, and meta separators are rules rather than middle dots |
| `/code-review`    | ○       | Optional; not run                                                              |

## Next Phase Readiness

**Ready:**

- Tile placeholders are sized, so 02-02 thumbnails will not relayout the grid
- Protocol handler already streams with range support, which thumbnails can reuse
- Containment helper is shared, so new path handlers inherit it

**Concerns:**

- Four defensive criteria unexercised. The `__sim` pattern from 01-03 would close them.
- Thumbnail caching in 02-02 must stay a cache, not become the index the project rejected.
- Console-only logging, fourth plan running — and this is now the code that deletes files.

**Blockers:** None.

---

_Built with PAUL Framework v1.4 · https://chrisai.cv/skool_
_Phase: 02-recordings-library, Plan: 01_
_Completed: 2026-09-17_
