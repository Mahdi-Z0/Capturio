---
description: 'Plan 03-01 — system audio capture: what shipped'
type: PlanSummary
plan: .paul/phases/03-audio/03-01-PLAN.md
closed: 2026-09-18
---

# 03-01 — System audio

**Status: shipped.** User verified on 2026-09-18: "audio is great".

## What was built

System (WASAPI loopback) audio capture, selectable in the UI and persisted across restarts, with
a video-only fallback when audio cannot be acquired.

| Task | Outcome |
| ---- | ------- |
| 1. Settings + main | `SETTINGS_VERSION` 1 → 2; `readQuality()` replaced by `readSettings()`, validating each field independently; `settings:get-audio` / `settings:set-audio` IPC; display handler returns `audio: 'loopback'` only when audio was requested |
| 2. Preload + recorder | `getAudioMode`/`setAudioMode` on the bridge; `acquireWithAudio()` reports the track that **arrived**, not the one requested |
| 3. Audio control UI | Shared `picker` block, two columns, laid out to take 03-02's two extra options without redesign |

## Acceptance criteria

| AC | Result |
| -- | ------ |
| AC-1 Computer audio is actually recorded | **Met** — user confirmed playback carries the sound |
| AC-3 UI round-trip, locked while recording | **Met** — selection persists across restart; both pickers disable on any non-idle status |
| AC-4 Version-1 settings migrate | **Met** — hand-written v1 file loaded, kept its quality, rewrote at v2 with both fields |
| AC-5 Audio failure costs the sound, not the recording | **Met in code** — one retry with `audio:false`; warning shown in the readout. Not exercised against a real failing driver |
| AC-6 Report what actually arrived | **Met** — `getAudioTracks().length` checked after acquisition; footer states the track that exists |

## Decisions

- **Two modes, not four.** `AudioMode` ships only `none` and `system`. Microphone and mixing need
  the Web Audio graph that 03-02 brings; a mode the UI offers but the code cannot honour is worse
  than one that is simply absent.
- **The picker CSS was generalised rather than copied.** `.quality__*` became `.picker__*`, shared
  by both controls, with only the column count differing per modifier. A second copied style block
  would have drifted the moment either control changed.
- **`AUDIO_UNAVAILABLE_NOTE` lives in `shared/types.ts`** because the recorder and the UI both say
  it, and two string literals drift.

## Deviations from plan

- The plan made `frontend-design` a **blocking** skill load before Task 3. It was not registered as
  invocable in the resumed session; its guidance was read directly from the installed plugin
  instead. Same content, different route — recorded here rather than silently skipped.
- Task 1 also removed an orphaned JSDoc block left above the quality presets by an earlier edit and
  restored it to the interface it describes. Tidying, unrelated to audio.

## Discovered, not fixed here

**Inline playback is broken, and the cause is in the files, not the player.** Reported by the user
at this plan's checkpoint. Every recording on disk was inspected: `Segment` size **unknown**,
`Duration` element **absent**, `Cues` index **absent** — MediaRecorder's live-streaming WebM
profile. Consequences: `video.duration` resolves to `Infinity`, the scrubber maps to a fabricated
timeline, and seeking has no index so Chromium scans and appears to hang. This affects every
player, not only the in-app one. Carried forward as its own plan; `library-browse` downgraded to
**partial** in `progress.json` rather than left claiming a feature that does not work.

## Files changed

`src/shared/types.ts`, `src/main/index.ts`, `src/preload/index.ts`,
`src/renderer/src/useRecorder.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/index.css`

## Verification run

`npm run lint`, `npm run typecheck`, `npm run build`, `npm run verify:guards` (16 refused, 3
served) — all pass.
