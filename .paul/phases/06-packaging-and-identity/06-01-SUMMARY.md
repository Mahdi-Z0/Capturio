---
description: 'Capturio — 06-01 summary: rename, icons, licence, README, installer'
type: PlanSummary
about: 'Capturio'
---

# 06-01 SUMMARY — Packaging and identity

**Status:** ✅ Complete — 2026-09-25
**Commits:** `058906d`, `2f978f7`, `78bdecf`, and `301b024` (the AC-6 evidence that unblocked it)

> **No PLAN file exists for this.** It was built conversationally: the user asked "what else have we
> left to do", chose to do the small things first, chose the name, and asked for a build to test
> outside the dev setup. This summary was written afterwards so the record is complete.

## What was built

**The rename.** ScreenRecorder → **Capturio**. The user asked for an opinion on the name with the
Store in mind; Capturio was chosen for being short, pronounceable, plausibly available and not a
generic noun. `productName` drives `userData`, so:

- Settings now live in `AppData/Roaming/Capturio`, copied once from `screenrecorder` by
  `migrateSettingsFromOldName()`.
- Recordings go to `Videos/Capturio` **except** when that folder does not exist and
  `Videos/ScreenRecorder` does. On the user's machine the old folder exists, so that is still the
  live location. Renaming an app must never orphan recordings already made.

**Icons, generated rather than committed as binaries.** `npm run icons` draws the mark as maths
(rounded-rect SDF plus a circle) and writes the tray PNGs, the app PNGs and a **multi-size
`icon.ico`** (16 → 256). Handing Windows one size means Windows scales, which is the first thing that
makes an app look unfinished.

**The licence.** All rights reserved to the author, at the user's request, with an explicit line that
making the source publicly readable grants no rights.

**The README.** Written for someone finding the repo: what it records, how to use it, how to install,
and a "How it works, where it is not obvious" section covering the four things that are genuinely
surprising (finalizing, streaming to disk, `.part` recovery, and measuring before believing).

**The installer.** `npm run dist` → `release/Capturio-Setup-0.1.0.exe`, per-user NSIS, no elevation.
Tray icons are copied by `extraResources` because they are read from `process.resourcesPath` at
runtime — without that the tray is blank in an installed build and fine in development, which is the
worst way to find out.

**A persisted log** (`src/main/log.cjs`): wraps console output into `userData/logs/app.log`, rolls at
1 MB, and captures `uncaughtException` / `unhandledRejection`. A crash in a packaged app otherwise
leaves the same silence this exists to remove.

## Acceptance

Verified by driving the **installed** app over the Chrome DevTools Protocol: it runs from the asar,
keeps its settings, finds the existing recordings, records, saves, plays with a seek landing exactly,
draws thumbnails, and shows a tray icon.

**AC-6, open since Phase 1, was closed here** (`301b024`): five minutes at Maximum quality with
computer audio, 105 MB file, 20 memory samples — minute-1 median 333.0 MB, minute-5 median 332.2 MB,
peak 334.6 MB, growth ratio **1.00×**. The streaming save path holds nothing per minute, which is what
it was built for.

## Decisions made during the work

| Decision | Why |
| --- | --- |
| Name: Capturio | Short, pronounceable, Store-plausible; the user asked for a recommendation and took it |
| All rights reserved, not MIT | The user's explicit instruction |
| Icons as code, not committed PNGs | Regenerable at any size; no binary blobs in review |
| Installer unsigned for now | Signing needs a certificate; the Store signs its own packages |

## Deferred

- **MSIX for the Store** — needs a Partner Center publisher identity, which is the user's to obtain.
- **Code signing for direct distribution** — only matters outside the Store.

## Files

- `electron-builder.yml`, `LICENSE`, `README.md` (new)
- `scripts/make-icons.cjs`, `resources/*` (new, generated)
- `src/main/log.cjs` (new)
- `src/main/index.ts` — settings migration, recordings-dir fallback, tray, free-space check
- `package.json` — `dist`, `dist:store`, `icons` scripts
