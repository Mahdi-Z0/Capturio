---
description: 'Capturio — 07-01 summary: the recordings window the user asked for'
type: PlanSummary
about: 'Capturio'
---

# 07-01 SUMMARY — Library and window UX

**Status:** ✅ Complete — 2026-09-27
**Commits:** `3e26928`, `29a4dc8`, `23a0ba2`, `8876027`, `8ecbf58`, `32d4d62`, `cc82af5`

> **No PLAN file exists for this.** The user sent a six-item list of UX requests and asked to discuss
> them one at a time rather than plan them as a batch, then added three rounds of refinement after
> using each build. This summary was written afterwards so the record is complete.

## The user's six items, and what happened to each

The user's list, and the order they agreed to work it (**5 → 3 → 4 → 2 → 1 → 6**):

| # | Request | Outcome |
| - | ------- | ------- |
| 5 | No way back to recording while browsing | ✅ `3e26928` — the window got a header and a **Record** button that shows the bar, even when it was hidden entirely |
| 3 | Recording should hide the recordings page | ✅ `29a4dc8` — it hides on record **and** before the region overlay, and does not come back on its own |
| 4 | A save notification with Open / Show in folder, and a real folder UI | ✅ `23a0ba2`, refined by `8876027` and `32d4d62` |
| 2 | Three views, opened from the settings button; bar-only launch | ✅ `cc82af5` |
| 1 | First-run tutorial overlay | ⬜ **Phase 8**, and reduced in scope: the user decided against showing it on first run, and the Help view now covers the same ground in prose |
| 6 | Configurable global shortcuts | ⬜ **Phase 8** |

## Refinements the user asked for after using it

Each of these arrived after testing a build, and each is now the shipped behaviour:

1. **Click should select, not play**; double-click plays. Selecting used to mount the player with
   `autoPlay`, so every glance at the list started a video.
2. **Select several** — ctrl-click adds, shift-click takes a run, Ctrl+A takes the folder.
3. **The action bar must follow the scroll** — it is `position: sticky`, with icons and small labels.
4. **Right-click should offer something useful** — three menus (recording, folder, background).
5. **Drag recordings into folders**, and onto the breadcrumb to move them back out.
6. **Delete a folder from inside the app.**
7. **Do not show the Videos folder** — it holds exactly one folder and nothing can be saved into it,
   so the window opens *in* the recordings folder and Up is disabled there.
8. **Play and Show in folder should act in-app**, not hand off to Explorer and an external player.

## What was built

- **`hideLibrary()`** — the recordings window is the only window here that capture can see (the bar,
  region selector and outline are all content-protected, which an ordinary window cannot be). It hides
  for the duration, pauses playback over `library:suspend`, **and** mutes its `webContents` as a
  backstop.
- **Subfolders** — `recordings:browse` reads one level; `relativePath` on `RecordingListItem` is how
  the renderer names a recording. `validateRelativePath` in `recordingPath.cjs` now allows nesting and
  refuses everything else by name, and folder creation and moves go through the *same* validator, so a
  name that cannot be served cannot be created.
- **The saved card** under the bar — name, **Play**, **Show in library**, the body doing the same as
  the latter. Derived from `lastSaved`, not copied into state.
- **`tellLibrary()`** — one way for main to talk to this window, for the view and for "show me this
  recording". A window being created cannot be told anything, so messages are held for collection on
  mount and only sent as events when a loaded window is already listening.
- **Three views** — Recordings / Settings / Help. Quality and the microphone picker moved off the bar
  into Settings; the library stays mounted behind the other views so a folder, selection and player
  survive the trip.

## Acceptance

Every change was verified by driving the **built** app over CDP, not in development:

| What | Result |
| --- | --- |
| Hiding the window while recording | 9 checks; audio bleed measured at peak **0.0000** across the file, against **0.2726** for a recorded 440 Hz tone (so the zero is silence, not a broken measurement) |
| Folders, notification card, nested playback | 19 checks, including a seek inside a subfolder landing at 1.80 s exactly |
| Select vs play, drag, folder delete, no Videos level | 17 checks, plus a second pass on drag highlighting |
| Multi-select, sticky bar, right-click | 13 + 4 checks; the sticky bar still pinned 874 px down a scrolled page; the menu fits from all four corners |
| The card's in-app actions | 10 checks across cold, warm and hidden windows |
| Three views | 17 checks, including a selection surviving a trip to Settings |
| `npm run verify` | Guards **23** refused / 6 served / 11 folder names; ranges hold; finalizer holds |

## Traps worth remembering

Written into `CLAUDE.md` in full; the short version:

- **`document.visibilityState` is not "is this window on screen".** Electron reports `hidden` for a
  window that is merely covered. Ask Windows (`IsWindowVisible` over `EnumWindows`).
- **A guessed menu height is wrong exactly when it matters.** The right-click menu now measures its
  rendered box in a `useLayoutEffect` and clamps before paint.
- **`position: sticky` leaves with its container, by design.** A test that stretched `document.body`
  instead of the list "failed" correctly.
- **Read DOM state after React has re-rendered.** A drag-highlight assertion read the class in the
  same tick and reported a bug that did not exist.
- **Ten assertions failed on the first multi-select run; two were the app's.** The rest were the test
  — worth remembering before trusting a red result.

## Deferred

- **Phase 8**: configurable global shortcuts, and the short tour (may be dropped — Help covers it).
- **Folder rename** is not implemented. Delete and create are; rename was never asked for, and
  Explorer is one click away via **Open in Explorer**.
- **The Delete key is deliberately unbound** in the recordings list. Recoverable or not, a stray
  keypress should not empty a folder.

## Files

- `src/main/index.ts` — `hideLibrary`, `tellLibrary`, browse/folders/create/move/delete-folder/reveal
  handlers, `library:reveal`, pending-message holds
- `src/main/recordingPath.cjs` + `.d.cts` — `validateRelativePath`, `resolveInside`, `MAX_DEPTH`
- `scripts/verify-guards.cjs` — 16 → 23 refusals, plus folder-name cases
- `src/renderer/src/Library.tsx` — the browser: history, selection, drag, menus
- `src/renderer/src/App.tsx` — three views and the way back
- `src/renderer/src/Settings.tsx`, `Help.tsx` (new)
- `src/renderer/src/Bar.tsx` — the saved card; settings button opens the window
- `src/renderer/src/icons.tsx`, `index.css`, `bar.css`
- `src/shared/types.ts`, `src/preload/index.ts` — the IPC contract for all of the above
