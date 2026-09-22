---
description: 'Plan 05-02 — recording indicator and live controls: what shipped'
type: PlanSummary
closed: 2026-09-18
---

# 05-02 — Recording indicator and live controls

**Trigger:** user request — "when recording I want an on screen symbol shows that the screen is
recording and one shows the audio little icons, also there should be options for stop recording, and
pause recording also for audio start stop."

Scope confirmed with the user: stop, pause/resume, mute/unmute, elapsed time with audio level, and
drag-anywhere.

## What was built

A frameless, always-on-top indicator window created only while recording, rendered by
`Overlay.tsx` from the same renderer bundle via the `#overlay` hash. It shows a pulsing record dot,
the elapsed time, a live audio level meter, and buttons for mute, pause/resume and stop. The whole
pill is a drag handle; the controls opt out so a click never starts a drag.

The same pause and mute controls appear in the main window while recording, for when the app itself
is in front.

## The part that mattered most

**The indicator must not appear in the recordings it describes.** `setContentProtection(true)` maps
to WDA_EXCLUDEFROMCAPTURE on Windows 10 2004+. Verified rather than assumed, by putting a known
colour on screen and capturing it:

| | matching pixels captured |
| --- | --- |
| protection off | 3919 |
| protection on | **0** |

## Acceptance criteria

| AC | Result |
| -- | ------ |
| Indicator is visible while recording, gone otherwise | **Met** — created on the first recording state, closed when recording ends or the main window closes |
| Indicator never appears in a recording | **Met** — measured above |
| Pause and resume work, and the clock excludes paused time | **Met in code** — paused span credited on resume; needs the human check |
| Audio can be muted and unmuted mid-recording | **Met in code** — `track.enabled`, never `track.stop()` |
| Audio state is visible | **Met** — meter greys out when muted or absent |
| Indicator can be moved | **Met** — `-webkit-app-region: drag` |

## Decisions

- **The overlay holds no recording state.** It renders what the recorder pushes and sends commands
  back, relayed through main. Two sources of truth about whether a recording is running is how a
  stop button ends up lying.
- **State is pushed on its own 15 Hz interval,** not through React render. Re-rendering the app to
  animate a level meter would be the most expensive thing on the screen.
- **Mute sets `track.enabled = false`** rather than stopping the track, because MediaRecorder cannot
  add a track back mid-recording — stopping it would make unmuting impossible.
- **One bundle, two windows,** selected by hash, because `electron.vite.config.ts` is a protected
  boundary and this is a single small component.
- **The overlay CSS is scoped to `.overlay-mode`.** Both windows share the bundle, so an unscoped
  `body { background: transparent }` would have stripped the main window's background.

## Files

`src/renderer/src/Overlay.tsx` (new), `src/renderer/src/overlay.css` (new),
`src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts`,
`src/renderer/src/useRecorder.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/main.tsx`,
`src/renderer/src/index.css`
