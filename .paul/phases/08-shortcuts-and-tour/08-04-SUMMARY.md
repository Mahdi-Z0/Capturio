---
description: 'Capturio — 08-04 summary: the tour approved and shown on first launch; start/stop off Ctrl+Shift+R'
type: PlanSummary
about: 'Capturio'
---

# 08-04 SUMMARY — The tour on first launch, and a start/stop default that takes nothing

**Status:** ✅ Complete — 2026-09-27. Closes Phase 8 and milestone v0.7.

## The user's decisions

1. **The tour is approved**, and should **show on a fresh install's first launch**, then stay
   available from Help. This reverses the milestone's original "no tutorial on first run".
2. **Start/stop must not be Ctrl+Shift+R** — browsers use it to hard-reload, and the two should not
   be mixed. Pick another default.

## What changed

- **Settings v6** adds `tourSeen`. Only a **missing** settings file is a first run; a file without the
  field (an existing install) or a corrupt one does not get the tour, and neither does a file carried
  over from the old app name. The flag is written `true` as the tour is scheduled.
- Startup holds the tour for the bar (`pendingTour`), which collects it on mount through the existing
  `tour:take-pending`.
- **Start/stop default → Win+Shift+Z**, still off. Chosen by probing with `globalShortcut.register`:

  | Taken on this machine | Free |
  | --- | --- |
  | Win+Shift+R (Snipping Tool recording), Win+Shift+W, Win+Shift+A, Win+Alt+R (Game Bar), Ctrl+Alt+R, Alt+Shift+R | **Win+Shift+Z**, Win+Shift+X, Win+Shift+D, Win+Shift+E, Shift+F9, Ctrl+F9 |

  Win combinations take nothing from apps or browsers; Z sits in Q's left-hand column.
- v6 migration moves a stored start/stop that is still the untouched old default (Ctrl+Shift+R, off)
  to Win+Shift+Z; one that was switched on stays.

## Verified (built app, isolated profile)

| Check | Result |
| --- | --- |
| Profile with `tourSeen: false` → tour opens at launch on step 1, flag saved `true` | ✅ |
| Same profile relaunched → no tour | ✅ |
| v5 file, Ctrl+Shift+R **off** → becomes Win+Shift+Z, off | ✅ |
| v5 file, Ctrl+Shift+R **on** → kept | ✅ |
| Carried-over old-name settings → treated as an existing user, no tour | ✅ |
| `typecheck`, `lint`, `build`, `verify:shortcuts` 29/29 | ✅ |

**Not driven end to end:** a launch with *no* settings file at all. On this machine
`migrateSettingsFromOldName()` always copies the old-name file first, Electron ignores `%APPDATA%`,
and stubbing `fs.existsSync` over the inspector did not reach the bundle. The untested part is the
single branch "file missing → `tourSeen: false`"; everything after it was verified.

Tests ran in a separate `--user-data-dir` profile, because the user had the new build running and the
single-instance lock would otherwise hand the launch to it. One attempt through `%APPDATA%` did reach
the real profile and handed over to the user's running bar — harmless, but it will have brought their
bar forward once.
