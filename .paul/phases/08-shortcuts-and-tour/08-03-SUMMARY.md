---
description: 'Capturio — 08-03 summary: the user''s revisions after trying 08-01/08-02, plus a choosable recordings folder'
type: PlanSummary
about: 'Capturio'
---

# 08-03 SUMMARY — Revisions after use, and a recordings folder of your own

**Status:** ✅ Complete — 2026-09-27, verified against the built app
**Plan:** none; a list of requests from the user after trying the build, handled conversationally.

## The user's requests, and what happened to each

| # | Request | Outcome |
| - | ------- | ------- |
| 1 | Make the recordings folder changeable | ✅ Settings → **Change…** / **Use the default folder** |
| 2 | Start/stop: assigned keys, three at most, **off** by default | ✅ `Ctrl+Shift+R`, switched off. Every shortcut is now keys **plus a switch** |
| 3 | Record a region: **Win+Shift+Q**, on by default | ✅ |
| 4 | Remove the show/hide shortcut entirely | ✅ gone from settings, main, tray, Help and the tour |
| 5 | Help: shortcuts first; only the tricky things, briefly | ✅ two groups: *Shortcuts*, *Worth knowing* (8 lines) |
| 6 | Remove the text under the shortcuts | ✅ in Help and in Settings |
| 7 | Any text written for release, not for a test setup | ✅ Help rewritten; no historical or test-environment notes |

## Shortcuts, v5

- Settings file **v4 → v5**: each shortcut is `{ keys, enabled }`. v4 entries were bare strings and
  their defaults had four keys, which v5 refuses, so they start again from the defaults. (On this
  machine the user's own v4 choices were exactly the new defaults.)
- **Three keys at most** — `accelerator.cjs` refuses a third modifier (`more than three keys`). The
  verifier now asserts 10 accepted and 17 refused.
- **Win first** in the canonical spelling (`Super+Shift+Q`), matching how Windows writes it.
- **Keys and switch are independent.** Changing keys while off stays off; choosing new keys by
  pressing them switches it on; switching on probes first. Clashes are refused whatever the switch.
- Settings row: name, the keys (click and press), a switch, and a state only when it matters (*Esc
  cancels* while listening, *In use by Windows or another program* when taken). Backspace-to-turn-off
  is gone; the switch replaces it.

## The recordings folder

- Stored as `recordingsDir`, null for the default. Settings are now read **before** anything touches
  the folder at startup.
- Refused: a whole drive, Capturio's own settings folder, a folder a probe file cannot be written to,
  and any change while a recording is in progress.
- **Existing recordings are never moved.** The footer updates and the library remounts at the new
  folder's top level.
- A chosen folder missing at startup (a drive not connected) is **not recreated**: recordings go to
  the default meanwhile, the choice is kept, it is logged, and Settings says so.

## Verified (built app)

| Check | Result |
| --- | --- |
| v4 → v5 migration; region on and registered, start/stop off and not registered | ✅ |
| Keys changed while off stay off; switch on registers; switch off releases and keeps keys | ✅ |
| Win key recorded from key events (`Win + Alt + …` preview) | ✅ |
| Win+Alt+K refused — Windows 11 reserves it | ✅ honest refusal |
| Four keys refused; clash with the region shortcut refused | ✅ |
| **Ctrl+Shift+R reported as in use** — an older installed Capturio was running and held it | ✅ the honest path, in the wild |
| Restore the defaults | ✅ |
| Folder: drive root refused, own settings folder refused | ✅ |
| Folder change: footer, library remount (4 tiles → 0), recording lands in the new folder | ✅ then recycled |
| Change while recording refused | ✅ |
| Use the default folder | ✅ stored null |
| Chosen folder unavailable at startup | ✅ default used, choice kept, logged, warned in Settings |
| `npm run build`, `lint`, `verify:guards`/`range`/`shortcuts` (28/28) | ✅ |

The native folder dialog was stubbed in main over `--inspect`; CDP cannot click it. The user's
settings file was backed up and restored.

## Found

- **The user has an older installed Capturio running — two copies**, started 03:34 and 03:37, from
  before the single-instance lock existed. It holds Ctrl+Shift+R. Left alone; the user should quit it
  (it has no tray icon: Task Manager) before relying on the new build's shortcuts.
