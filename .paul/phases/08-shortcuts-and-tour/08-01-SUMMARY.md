---
description: 'Capturio — 08-01 summary: configurable global shortcuts, a tray that exists, one instance'
type: PlanSummary
about: 'Capturio'
---

# 08-01 SUMMARY — Configurable global shortcuts

**Status:** ✅ Complete — 2026-09-27, verified against the built app
**Plan:** `08-01-PLAN.md`, written before the work; went through PLAN → APPLY → UNIFY.
**Commits:** not yet committed at the time of writing. See `git log` for this phase.

v0.7 item 1. Item 2 (the tour) is **not** built and needs the user's decision; see the end.

## What shipped

| Action | Default | Behaviour |
| --- | --- | --- |
| Start or stop recording | `Ctrl+Shift+R` | Unchanged from 05-02. The bar decides, using what it has selected |
| Show or hide the bar | `Ctrl+Alt+Shift+B` | Same as a click on the tray icon |
| Record a region | `Ctrl+Alt+Shift+R` | Opens the selector; recording starts the moment the drag ends. Esc starts nothing |

- **Settings → Shortcuts.** Each combination is a button: click it, press the new keys. Held modifiers
  preview as they are pressed. Esc cancels, Backspace turns that shortcut off, a click elsewhere or
  leaving the window cancels. **Restore the defaults** appears only when something differs.
- **Honest state.** Main reports each shortcut as `on`, `off` or `taken`. A new combination is
  **probed before it is saved**; if another process holds it the old one keeps working and the page
  says which combination was refused. One taken before launch shows as *Not working* in Settings and
  Help and is logged once (`[shortcut] Ctrl+Alt+Shift+B is taken; …`).
- **Help** lists the real combinations and their state, not the defaults.
- **Tray menu** shows the combination beside *Show the bar* and *Start recording*, only when it works.
- **`src/main/accelerator.cjs`** is the one validator (canonical spelling, one key, a key that types
  or moves needs Ctrl/Alt/Win, no punctuation because Electron resolves it through the layout).
  `scripts/verify-shortcuts.cjs` requires the shipped file: 10 accepted, 15 refused by the *right*
  rule, and one spelling per combination. It runs in `npm run verify`.
- **Settings file v3 → v4** adds `shortcuts`, each field validated on its own; a clash on read gives
  the later action its default or nothing.

## Found and fixed on the way

1. **The tray icon had never existed.** `createTray()` was called only inside `toggleBar()`, whose only
   callers were the tray's own click and menu (since `6213266`). Windows 11's
   `HKCU\Control Panel\NotifyIconSettings` had no entry for the app, although the installer had been
   run. So **Hide the bar stranded the app**: running, no window, no tray. It is now created at launch,
   and the registry entry appeared on the first run afterwards.
2. **No single-instance lock.** A second launch started a second recorder and a second bar. The second
   process now exits (466 ms measured) and the running one brings its bar back and logs
   `[app] launched again; bringing the bar back`.
3. **A stale `start()` could open a second recorder.** The region selector resolves long after the
   shortcut that opened it. If Ctrl+Shift+R started a recording meanwhile, the closure's `start()`
   still saw `status === 'idle'`. The bar now reads `start`/`locked` through a ref at resolve time.
   Verified: exactly two files, no stray `.part`.
4. **Key capture listened on the button, which need not hold focus** — found by the verification
   driver, not in review. The control sat at "Press the keys…" with every shortcut suspended. It now
   listens on the window (capture phase) while recording a combination.

## Verification (built app, CDP + main over `--inspect`)

| Check | Result |
| --- | --- |
| Defaults registered at launch; v3 settings migrated keeping quality/audio/mic | ✅ |
| `Ctrl+Alt+Shift+B` via real keystrokes (SendKeys), bar visible → hidden → visible, and from a bar hidden by its own button | ✅ |
| `record-region` with the bar hidden: Esc → nothing; chosen 640×360 → recording with no click, bar reappears | ✅ file 800×450 at 1.25 scale |
| Toggle during selection, then a region chosen | ✅ one recorder, whole screen, region ignored |
| Held by another process (`RegisterHotKey` from PowerShell) when chosen | ✅ refused, old still registered |
| Held before launch | ✅ `taken`, logged, *Not working* in Settings and Help |
| Clash / Shift+letter / punctuation / numpad key | ✅ each refused with its own reason |
| Suspended while listening; resumed on set, Esc, click elsewhere | ✅ via `globalShortcut.isRegistered` |
| Alt while listening does not raise the window's menu bar | ✅ `isMenuBarVisible()` false |
| Backspace turns off and releases the key; restore defaults | ✅ |
| Tray exists from launch | ✅ NotifyIconSettings entry created |
| Second launch | ✅ exits, bar back |
| `npm run build`, `npm run lint`, `verify:guards`/`range`/`shortcuts` | ✅ |

**Not verified with real keystrokes:** `Ctrl+Shift+R` and `Ctrl+Alt+Shift+R`. Partway through, a
full-screen game held the foreground, and Windows drops input injected by a lower-integrity process
(UIPI), so SendKeys reached nothing, including the `B` shortcut that had just passed. Those two were
driven with the exact message their handlers send (`hud:command`), and registration was confirmed
with `isRegistered`. The handler table differs from `B` only in which message it sends. **Real key
presses need no injection and are not affected by this.** A human pressing the three keys once
closes the gap.

The user's settings file was backed up before testing and restored afterwards. Both test recordings
went to the Recycle Bin.

## Decisions

- **Defaults add Alt.** A global shortcut takes its combination from every program;
  `Ctrl+Shift+<letter>` is routinely bound, `Ctrl+Alt+Shift` hardly ever. The region shortcut is the
  record shortcut plus Alt.
- **Probe, then save**, rather than save and report. A refused combination should change nothing.
- **Setting a shortcut ends listening in main, on every path.** The renderer cannot leave the app
  with its shortcuts suspended by forgetting to resume; the recordings window's `blur`, `hide` and
  `closed` are a second guarantee.
- **Show *or hide*,** matching the tray click, rather than show-only.

## Deferred

- **`npm run verify:finalize` has nothing to check on this machine.** It needs an unfinalized
  recording at the top of `Videos/ScreenRecorder` and exits 2 without one, which stops `npm run
  verify`. Existing behaviour, not caused here; the new pure check was placed before it so it always
  runs. A committed fixture would remove the dependency.
- `src/main/index.ts` has **two `window-all-closed` handlers**: a no-op with a comment saying the app
  must not end, and a later one that quits. Hiding never closes a window so neither fires today, but
  they contradict each other.

## The tour — needs the user

> **Outcome:** the user asked to see it before deciding, so it was built as 08-02, on trial.

v0.7 item 2 was always optional. Help now lists every button with the bar's own icons, plus the live
shortcuts. The recommendation is **drop it**: a second explanation of the same eleven controls is surface
without new capability, which is the trade this project's design goal says to refuse.
