# Capturio

Capturio — a simple Windows screen recorder for personal use, heading for the Microsoft Store.
Design goal: **minimal surface, complete basics.** Every feature must be reachable in one or two
clicks. When a choice arises between "powerful" and "obvious", pick obvious.

**The app is named Capturio.** `productName` drives `userData`, so the settings folder is
`AppData/Roaming/Capturio`; `migrateSettingsFromOldName()` copies settings once from the former
`screenrecorder` folder. Recordings go to `Videos/Capturio`, **except** when that folder does not
exist and `Videos/ScreenRecorder` does — renaming the app must never orphan recordings already made.

## Status

**Working:** full-screen, single-window and region capture to disk, quality presets, system (loopback) audio, the recordings
library (browse by folder, play, reveal, move, delete), user-made subfolders, crash recovery of
`.part` files, seekable output, and pause/resume and mute while recording.

The app **is** a floating control bar, not a window someone visits. Recording never requires opening
anything.

Audio: none, computer, microphone, and computer + microphone mixed, with a microphone picker.

Everything in the declared feature set is built.

## Stack

Electron 44 + React 19 + TypeScript 5.9 (strict), bundled by electron-vite.

TypeScript is pinned to **5.9.3**, not 7.x. TypeScript 7 is the native port and ships no
`lib/tsserver.js`, which breaks `typescript-language-server`. Do not bump it without re-verifying
the language server still starts.

## Commands

| Task          | Command              |
| ------------- | -------------------- |
| Dev (HMR)     | `npm run dev`        |
| Type check    | `npm run typecheck`  |
| Lint          | `npm run lint`       |
| Autofix lint  | `npm run lint:fix`   |
| Format        | `npm run format`     |
| Production    | `npm run build`      |
| Installer     | `npm run dist`       |
| App icons     | `npm run icons`      |
| Store package | `npm run dist:store` |
| Verify all    | `npm run verify` |
| Verify guards | `npm run verify:guards` |
| Verify ranges | `npm run verify:range` |
| Verify finalize | `npm run verify:finalize` |
| Progress report | `npm run progress` |

`npm run build` runs `typecheck` first and fails the build on a type error. Keep it that way.

### Running from inside VS Code

VS Code exports `ELECTRON_RUN_AS_NODE=1` to its child shells. Electron inherits it, runs as plain
Node, and `require('electron')` then returns the **path string** instead of the API object — so
`ipcMain`, `BrowserWindow`, etc. are all `undefined`. Symptoms are a top-level
`TypeError: Cannot read properties of undefined (reading 'handle')`, or under ESM
`does not provide an export named 'BrowserWindow'`.

This is an environment artifact, not an app bug. Run `npm run dev` from a normal PowerShell or
Windows Terminal window, or unset the variable first:

```bash
unset ELECTRON_RUN_AS_NODE && npm run dev   # bash
$env:ELECTRON_RUN_AS_NODE=$null; npm run dev  # PowerShell
```

Before diagnosing any "Electron API is undefined" error, check this variable first.

### Main and preload are CommonJS

`package.json` deliberately has **no** `"type": "module"`. Electron's ESM mode requires preload
scripts to be `.mjs` *and* unsandboxed, and adds CJS-interop pitfalls on the `electron` builtin.
Renderer code is still ESM (Vite bundles it). Do not add `"type": "module"` without re-verifying
`npm run dev` actually opens a window.

## Architecture

```
src/
  main/      Electron main process: windows, IPC handlers, file system, desktopCapturer
  preload/   Context bridge. The ONLY channel between main and renderer
  renderer/  React UI. No Node APIs, no direct fs access
  shared/    Types used by both sides. Single source of truth for the IPC contract
```

Rules:

- `contextIsolation: true`, `nodeIntegration: false`. Never relax these.
- The preload exposes a **named, explicit** API surface. Never expose `ipcRenderer` itself.
- Every new IPC channel gets its types in `src/shared/types.ts` first, then main handler, then
  preload method. Keep all three in sync.
- The renderer never touches the file system directly. It asks main.

## Capture and audio (the hard part)

**Video.** Prefer `session.setDisplayMediaRequestHandler` in main plus
`navigator.mediaDevices.getDisplayMedia()` in the renderer over the legacy
`chromeMediaSource: 'desktop'` constraints. The handler receives the chosen source and can return
`{ video: source, audio: 'loopback' }`.

**System audio.** On Windows, `audio: 'loopback'` in the display-media handler gives real WASAPI
loopback. This is Windows-only behaviour — it does not work the same way on macOS. Since this app
targets Windows, that is fine, but do not write code that assumes it works everywhere.

**Microphone.** Separate `getUserMedia({ audio: { deviceId } })` call. Enumerate devices with
`navigator.mediaDevices.enumerateDevices()`.

**Both at once.** Do not try to pass two audio tracks to `MediaRecorder` — it records only the
first. Mix them in the Web Audio API:

```
AudioContext
  -> createMediaStreamSource(systemStream) -> GainNode ┐
  -> createMediaStreamSource(micStream)    -> GainNode ┴-> createMediaStreamDestination()
```

Then build the final stream as `new MediaStream([videoTrack, mixedAudioTrack])`. The separate gain
nodes are what later allow independent system/mic level sliders, so wire them in even at 1.0.

**Audio modes** the UI must support: system only, mic only, both, none. "None" means omit the audio
track entirely, not a muted track.

All four ship. `composeStream()` in `useRecorder.ts` builds the recorded stream: one source passes
straight through; two are mixed in Web Audio into a **single** track, each through its own
`GainNode` at 1.0. Verified 2026-09-22 by decoding saved files with a 440 Hz tone playing: `none` has
no audio track; `system` carries the tone; `microphone` carries room sound with the tone at ~0
(echo cancellation keeps the speakers out); `both` carries both, in one track.

The mic opens with echo cancellation, noise suppression and auto gain on. A stored device that has
gone falls back once to the Windows default; a blocked mic costs the narration, never the
recording, and `audioShortfallNote()` names which source failed and points at the Windows privacy
setting.

**Measuring recorded audio:** Web Audio outputs silence for media from another origin, and
`recording:` is one. Routing the in-app player into an analyser reads all zeros even when the file
is fine. Decode the file bytes directly instead.

**Muting mid-recording sets `track.enabled = false`,** which records silence. Never stop the track
instead: MediaRecorder cannot add one back, so unmuting would be impossible.

**Region capture.** `getDisplayMedia` cannot capture a sub-region, so the full display is captured
and cropped in the renderer by `cropTrack()` in `useRecorder.ts`.

This uses the **breakout box** (`MediaStreamTrackProcessor` -> `new VideoFrame(frame, {visibleRect})`
-> `MediaStreamTrackGenerator`), not the canvas pipeline this file used to prescribe. Measured
2026-09-23 on an 876x376 crop of a 60 fps source:

| crop | fps | jitter | CPU |
| --- | --- | --- | --- |
| canvas (`drawImage` + `captureStream`) | 53.2 | 5.7 ms | 9% |
| **breakout box** | **55.3** | **4.8 ms** | **5.5%** |

Better on all three, and lower jitter than the *uncropped* feed, because it forwards each source
frame with its own timestamp instead of redrawing on a callback. Declarations live in
`dom-augment.d.ts` -- neither class is in TypeScript's DOM lib.

**The crop rect must be even.** Chroma is subsampled 2x2, so an odd offset or size is not
representable and Chromium rejects the frame. `cropTrack` rounds to even and clamps to the capture.

**Scale by the track, not the display.** The rect arrives in display points; the capture is in
physical pixels. Divide by what the track reports (`settings.width / displayWidthInPoints`), since
the capture is not always the display's full resolution. Verified: a 600x400 region on a 1.25-scale
display produces a 750x500 file.

`onended` must watch the **source** track, not the cropped one: a capture that stops externally
would otherwise go unnoticed. The live size readout is likewise suppressed while cropping, because
the track's own settings describe the whole screen.

**Container.** Check `MediaRecorder.isTypeSupported()` at runtime rather than hardcoding, and
prefer **webm/vp9**, falling back to mp4/avc1.

This reverses the original guidance, on measurement (2026-09-16, Phase 1): H.264 **ignores**
`videoBitsPerSecond` on this hardware — 16 Mbps requested returned 63 Mbps on synthetic noise and
~0.7 Mbps on real screen content. VP9 honours it (2.5 → 22 Mbps under the same test). Controllable
bitrate matters more for screen content than the mp4 container does, and Windows 10+ plays webm
natively. Revisit only if Store submission demands mp4, and re-measure before switching back.

**Capture path.** Standard `getDisplayMedia`, targeting **60 fps**.

A legacy `getUserMedia` path was tried and reverted. Measured 2026-09-17
(`npm run bench:capture`, motion source at the 60 Hz ceiling):

| Path / target           | mean fps | interval jitter (σ) | hitches |
| ----------------------- | -------- | ------------------- | ------- |
| legacy @ 30             | 27.4     | 16.9 ms             | 17.9%   |
| `getDisplayMedia` @ 30  | 29.1     | 8.4 ms              | 4.7%    |
| legacy @ 60             | 54.6     | 5.1 ms              | 9.9%    |
| **`getDisplayMedia` @ 60** | **54.4** | **5.4 ms**       | 10.1%   |

At 60 the two paths are indistinguishable, so the non-standard API buys nothing. At 30 legacy was
*worse* where it counts: it won on average frame rate while doubling jitter.

**Judge capture by interval jitter, not average fps.** Sampling a 60 Hz display at ~29 fps means
each frame spans a non-integer number of refreshes, so motion is sampled unevenly and moving objects
appear to snap between positions. Average fps looks fine the whole time. Capturing near 1:1 with the
display is what removes it.

**Capture constraints.** Always end up with `resizeMode: 'none'`. Chromium defaults to
`'crop-and-scale'` and pushes every frame through a resampler *even when the requested size already
matches the display*, which softens text. Do **not** constrain `width`/`height`: unconstrained
capture already reports the display's native resolution, and asking for a size reintroduces the
scaler.

**Frame rate is a hint, never a floor** — `getDisplayMedia` throws on `min` and `exact` frame-rate
constraints, so `ideal` is the only option and the result is best-effort.

It is still worth requesting. An earlier note here claimed "requesting 60 delivers no more frames
than 30"; that was wrong, and came from a benchmark whose motion source could not itself exceed
~12 fps, so both targets were capped by the test rather than by capture. With a source at the
refresh ceiling, 60 delivers ~54 and 30 delivers ~29.

**Interrupted recordings.** A crash or power loss leaves a `.part` file — by design, since a
truncated file under the final name looks valid and is worse. `recoverOrphanedParts()` reclaims
them at startup by renaming, never overwriting an existing recording. WebM is a streaming
container, so a truncated one still decodes up to the cut.

**Window capture works — the old "1.1 fps" was a benchmark bug.** The benchmark captured
`sources[0]`, an arbitrary and usually static window, and Windows Graphics Capture only delivers a
frame when content changes. Measured 2026-09-22 against an animated window: **58.7 fps, 2.5 ms
jitter**, versus 53.0 fps / 5.9 ms for the full screen. A still window legitimately yields few frames;
that is not a fault, and the recording's timestamps stay correct. Always capture a *moving* source
when measuring, identified by `getMediaSourceId()`, never by list position.

**Full-screen capture can silently drop to ~12 fps — an OS state, not app code.** Seen 2026-09-22:
the same benchmark gave 53 fps in the morning and 12 fps that afternoon, window capture unaffected
(56 fps), reproduced by a bare probe with none of this app's code. Chromium's logs
(`--enable-logging=stderr --v=1 --vmodule=*desktop_capture*=2,*dxgi*=2,*wgc*=2`) showed why:
`Cannot initialize any DxgiOutputDuplicator instance` on both adapters (this is a hybrid Intel UHD
630 + GTX 1650 laptop), so Chromium fell back to WGC monitor capture, where `ProcessFrame failed,
using existing frame` fired on ~3 of every 4 ticks. Ruled out: GPU choice (`--force_low_power_gpu`
/ `--force_high_performance_gpu`), WGC feature flags, direct composition, window focus, power plan.
Before blaming code for choppy full-screen recordings, run those logs first.

**Memory is flat over a long recording.** Measured 2026-09-25, five minutes at Maximum (60 fps,
40 Mbps) with computer audio, producing a 105 MB file: 20 samples, minute-1 median 333.0 MB,
minute-5 median 332.2 MB, peak 334.6 MB — a growth ratio of 1.00x. The streaming save path holds
nothing per-minute, which is what it was built for. The finished file reported 297.67 s and a seek
to 267.90 s landed exactly. Re-run with `scripts/` driving the built app if the save path changes.

**Benchmark before believing.** `npm run bench:capture` exists because three separate quality
"fixes" (bitrate, codec, scaler) were shipped against a frame-rate problem. It reports the motion
source's own rate alongside capture delivery, so a slow test source can no longer masquerade as a
capture limit. Re-run it after any Electron upgrade or capture change.

`resizeMode` is missing from TypeScript's DOM lib; the augmentation lives in
`src/renderer/src/dom-augment.d.ts`.

## Recordings must be finalized before they are usable

MediaRecorder writes WebM in its **live-streaming profile**: the Segment size is left unknown, no
`Duration` is written, and no `Cues` index is produced. Measured 2026-09-18 across every file on
disk — every one was Segment=UNKNOWN, Duration=ABSENT, Cues=ABSENT.

The result plays but `video.duration` is `Infinity`, so a scrubber maps to a fabricated timeline and
seeking has no index and stalls. **This affects every player, not just this app.**

`src/main/webmFinalize.cjs` rewrites the file once, after the bytes are safely on disk: it declares
the Segment size, inserts the true `Duration` derived from the last block timestamp, and appends a
`Cues` index. **Cluster payloads are copied byte for byte — nothing is ever re-encoded.**

**Cue points go only on clusters that contain a video keyframe, timed at that keyframe.** Audio
blocks are all keyframes, and most clusters open with audio and then continue video mid-GOP. An
earlier version indexed every cluster: the first seek worked, the second failed with
`PIPELINE_ERROR_DECODE` and every later seek hung. On a real 20.7 s recording that is 7 cue points
across 17 clusters.

**Finalizing is not enough on its own — the `recording:` protocol must answer `Range`.**
`stream: true` on the privileged scheme *permits* range responses; it does not produce them. A
handler that returns the whole file leaves `seekable.end(0)` at 0 and every seek lands at zero.
Parsing and serving live in `src/main/byteRange.cjs`. Testing over `file://` hides this, because
file URLs have range support of their own — always test through `recording://`.

Measured end to end through the shipped modules, one `<video>` element, seeking 15.5 → 3.25 →
19.9 → 0.5 → 10 s: every seek landed exactly on its target.

`placeRecording()` in `src/main/index.ts` is the only caller, and **its fallback is the point**: if
finalizing fails for any reason the recording still lands by plain rename. A seek index is a
convenience; the recording is not. Never reorder that so a finalize failure can lose the file.

Run `npm run verify` after touching any of it — guards, range parsing, and finalizing, each against
the shipped module directly. `verify:finalize` asserts the cluster bytes are identical before and
after.

### Why not MP4, which is seekable by construction

Tested 2026-09-18. `video/mp4;codecs=vp9,opus` records and produces a correct `mvhd` duration plus an
`mfra` index. It was rejected on **delivery timing**, not quality:

| container | chunks over 6 s | arrival times |
| --- | --- | --- |
| mp4 | 2 | both at 6006 ms — nothing until stop |
| webm | 6 | 1077, 2097, 3117, 4169, 5250, 6001 ms |

Chromium's MP4 muxer emits nothing until the recording stops, so the whole file sits in renderer
memory (~750 MB for 5 minutes at 20 Mbps) and a power cut loses all of it — the exact failure this
project already suffered. WebM streams; it just needs finishing afterwards. Re-measure before
revisiting.

## Folders, and the one validator

Recordings started as one flat folder and are now the user's to organise, so the renderer names a
recording by its path **relative to the recordings folder** (`Intro.webm`, `Lectures/Intro.webm`),
never by an absolute path it composed itself. `relativePath` on `RecordingListItem` is that name, and
`recordings:browse` reads one level at a time; `recordings:list` still returns everything, through
subfolders, for anything that just wants the newest recording.

**Every path goes through `validateRelativePath` in `recordingPath.cjs`** — playback requests, folders
the user creates, and moves. One set of rules, so a name that cannot be served cannot be created
either, and `scripts/verify-guards.cjs` exercises the same function the handlers call. It refuses
`..` segments, backslashes, drive-qualified and absolute paths, empty segments, null bytes, the
characters Windows forbids, names ending in a dot or space (Windows trims those, so two different
names become one file), reserved device names (`CON`, `NUL`, `COM1`…), segments over 100 characters
and nesting deeper than 8. 23 refusals and 6 allowances are asserted, plus 11 folder names.

**Decode URL segments one at a time.** Decoding the whole path at once lets `%2F` inside a name become
a separator after the split; `%2F` survives URL parsing untouched, so a segment that contains a slash
only *after* decoding was hiding one, and it is refused rather than kept. The `..` branch itself is
unreachable through the protocol — a standard scheme normalises it away first — so the verifier
exercises it directly against the validator rather than pretending the URL path reaches it.

**The recordings window is a browser now**: back, forward, up, and a breadcrumb. It opens *in* the
recordings folder and cannot go above it — `parentOf('')` is `null`, which disables Up. It does not
show the Videos folder: that level holds exactly one folder and nothing can be saved into it, so it
was a level that only ever contained one card.

**One click selects, two clicks play.** Selecting used to open the player with `autoPlay`, so every
glance at the list started a video. Only a double-click mounts the `<video>`.

**Selection is a list, not a value.** Click picks one, ctrl-click adds or removes one, shift-click
takes the run from the anchor, Ctrl+A takes the folder, Escape clears. The anchor moves to whatever
was last clicked, including a ctrl-click, which is what Explorer does. Delete is deliberately *not*
bound to a key: recoverable or not, a stray keypress should not empty a folder.

Actions apply to the whole selection and one failure does not stop the rest — a folder that cannot
take one file is no reason to leave the other nine behind — so `runOnSelection` collects failures and
reports how many of how many failed. Play, Open and Show in folder appear only when exactly one is
selected; there is no sensible meaning for six.

**The action bar is `position: sticky`.** The selection is often at the bottom of a long folder, and
scrolling back up to reach a button was the complaint that produced it. It sticks within `.library`,
which is right: it should leave with the list it belongs to, not float over the window forever.

**The right-click menu is drawn in the renderer, not `Menu.popup()`.** It has to list the folders a
recording can move to, and it should look like this window rather than a system menu dropped on it.
Right-clicking outside the selection moves the selection there first, so the menu always acts on what
is highlighted. There are three menus: a recording, a folder, and the background (new folder, select
all, open in Explorer).

**Its position is measured, never estimated.** A guessed height put the menu off the bottom edge
exactly when the folder list was long enough to be worth right-clicking. A `useLayoutEffect` reads the
rendered box and clamps it to the window before paint, and the menu itself is capped at
`100vh - 16px` with its own scrolling. Verified from all four corners.

**Recordings can be dragged onto folders, and onto the breadcrumb.** Every drop target is a folder
path, so dragging onto a crumb moves a recording back out of a subfolder. The drag carries a private
type (`application/x-capturio-recording`), and `onDragOver` checks for it before calling
`preventDefault`, so a file dragged in from the desktop does not light the folders up. The cell holds
the drop handlers rather than the card, because the delete button sits in the cell too.

**Deleting a folder goes to the Recycle Bin, never further.** It takes two clicks (the second says
"Confirm"), refuses the recordings folder itself, refuses a folder holding a recording still being
written, and — like deleting a single recording — never falls back to a real delete when the Recycle
Bin refuses.

## Saying where the recording went

`Bar.tsx` shows a card under the bar when a recording lands: the name, **Play**, **Show in library**,
and the card body does the same as the latter, because that is what clicking a save notification is
expected to do. It is not a Windows toast, and nothing opens on its own — a window appearing over
someone's work the moment they stop recording is the interruption the bar exists to avoid.

**Both actions stay in the app.** They used to hand off to Explorer and to whatever owns `.webm`;
this app has a folder view and a player of its own, so sending someone out to another program to look
at what they just recorded was the long way round. `library:reveal` opens the recordings window at
that recording's folder, selects it, and plays it when asked.

**A window being created cannot be told anything.** The renderer's listener does not exist until React
has mounted, and `did-finish-load` is no guarantee of that, so main *holds* the request in
`pendingReveal` and the window collects it on mount with `library:take-pending`; the event is only
sent when there is a loaded window already listening. In the window, the request is held in a **ref**
until the folder read that can satisfy it completes — the listing arrives after the navigation, so the
file does not exist to select yet — and `showRecording` calls `reload()` unconditionally, because the
recording is usually in the folder already on screen and `go()` alone would change nothing. Verified
cold (no window), warm (open, and looking at another folder) and hidden (mid-recording).

It is **derived**, not stored: `lastSaved` never clears, so the card is `lastSaved && !recording &&
not dismissed`. An effect that copied it into state would trip `react-hooks/set-state-in-effect`, and
"starting the next recording puts the card away" then costs nothing.

**The bar measures its own height on every change now**, not only when a panel is open. The old
conditional returned the bare `BAR_HEIGHT` whenever no panel was showing, which would have clipped
this card.

## Thumbnails, and why the protocol allows reading

Tile images are cached under `userData/thumbnails`, keyed by name + size + mtime, so replacing a
file can never show its predecessor's picture. The cache is **disposable**: nothing but tile display
may read it, and deleting the directory must leave listing, playback, duration and delete working.
It is capped at 64 MB, pruned at startup, and `thumbs:put` refuses anything that is not a JPEG
(`FF D8 FF` … `FF D9`), over 256 KB, or outside the recordings folder — those bytes come from the
renderer and are written into the user's profile.

Frames are taken from the probe the library already opens to read a duration, so a tile costs one
decode, not two.

**Two things had to be true before a frame could be captured at all**, and both failed silently:

1. The scheme must be registered with **`corsEnabled: true`**. Without it a CORS request to a custom
   scheme is rejected outright, which appeared as the probe failing to load with
   `MEDIA_ELEMENT_ERROR: Format error` the moment it set `crossOrigin`.
2. The protocol must answer with **`Access-Control-Allow-Origin`** (`byteRange.cjs`), and the element
   must set `crossOrigin = 'anonymous'`. `recording:` is a different origin from the app page, so
   without this the canvas is tainted and `toBlob` returns null — no error, no image.

`npm run verify:range` asserts the header on both the whole-file and partial responses. This is the
same cross-origin rule that makes Web Audio read silence from `recording:` media; see the audio
section.

## The control bar is the app

`Bar.tsx` (`#bar`) is the primary window: frameless, always on top, draggable, and excluded from
capture. **It owns the recorder**, so the recordings window can be opened and closed at any time
without touching a capture in progress. `App.tsx` is now only the recordings window, opened from the
bar's library button, and it learns about new files over `recordings:changed` because they are saved
by a different window.

**The recordings window hides itself for the duration of a recording** (`hideLibrary()`), both when
recording starts and before the region overlay opens. It is the one window here that is *not*
content-protected — an ordinary window cannot be — so leaving it open films it. It is **not** brought
back afterwards: a window appearing by itself the moment a recording stops is the interruption this
bar exists to avoid. The bar's library button is the way back, and `openLibrary()` must therefore
`show()` as well as `focus()`, since neither `focus()` nor `restore()` reveals a hidden window.

**Hiding a window does not stop its media.** The recordings window is told to pause over
`library:suspend`, and its `webContents` is muted as well — the pause is what the user sees, the mute
is the guarantee for a renderer that never got the message. Without both, the recording someone was
watching is audible inside the one they just started. Measured 2026-09-26: recording with computer
audio on, started while a recording was playing in the library, peak amplitude **0.0000** across the
whole file; the same measurement on a recording of a 440 Hz tone reads 0.2726, so the zero is silence
and not a broken measurement.

**`document.visibilityState` is not "is this window on screen".** Electron also reports `hidden` for a
window that is merely covered by another, which made a passing implementation look broken for an hour.
Ask Windows instead — `IsWindowVisible` over `EnumWindows`, matched by window size.

Ctrl+Shift+R starts and stops. The bar decides what `toggle` means, since only it knows what is
currently selected.

**Sound is two switches, not four modes.** The speaker and microphone buttons are independent; their
combinations are the four `AudioMode` values. Do not put a four-item list back in the UI — the modes
exist in the contract, not on screen.

**Every always-on-top window calls `setContentProtection(true)`** — the bar, the region selector and
the region outline. WDA_EXCLUDEFROMCAPTURE on Windows 10 2004+. Verified with a known colour on
screen: 3919 matching pixels captured without it, **0** with it. A recorder that films its own UI is
worse than one with no indicator.

**The bar window resizes to its own content.** A transparent window still swallows clicks, so a
panel-sized window sitting over the desktop would block everything under it. `resizeBar` always sets
`width: BAR_WIDTH` rather than feeding `getSize()` back in — the latter accumulated a pixel or two
per resize on this 1.25-scale display (472 -> 476 after four toggles).

**Windows shown while recording must be idempotent.** The recorder republishes its state four times
a second. `showOutline` rebuilt its window on every one of those, which the user saw as a rectangle
flickering on and off for the whole recording; it now returns early when the rect is unchanged.

**Class names collide across windows — all three share one bundle.** The bar's wrapper is
`.barShell`, not `.shell`, because the recordings window's `.shell` in `index.css` sets
`align-items: center`, which silently centred and shrank the bar to its content (401px inside a
472px window). Scope anything window-specific, as `.bar-mode` and `.region-mode` do for the
transparent bodies.

**Known limit.** Gradient banding (most visible in dark gradients) comes from 8-bit 4:2:0 chroma
subsampling, which `MediaRecorder` does not let us avoid in either codec. Raising bitrate reduces
but does not eliminate it. Fixing it properly needs a different capture/encode path.

## Packaging

`npm run dist` builds `release/Capturio-Setup-<version>.exe` with electron-builder
(`electron-builder.yml`). Per-user NSIS install, no elevation.

**Icons are generated, never committed as opaque binaries.** `npm run icons` draws the mark as maths
and writes the tray PNGs, the app PNGs and a **multi-size `icon.ico`** (16 → 256). Windows picks a
size per context, and handing it one size means Windows scales — the first thing that makes an app
look unfinished.

**Tray icons must stay outside the asar.** They are read from `process.resourcesPath` at runtime, so
`extraResources` copies them; without that the tray is blank in an installed build and fine in
development, which is the worst way to find out.

The installer is unsigned, so SmartScreen warns on first run. Signing needs a certificate; the Store
signs its own packages, so this only matters for direct distribution.

## Out of scope

No facecam, no webcam overlay, no streaming, no cloud upload, no editor beyond trim. Reject scope
creep toward these.

## Safety

- Recordings are personal data. Never log file contents or full paths to a remote service, and
  never add telemetry without asking.
- Do not add a dependency without saying why in the PR/commit body. Prefer platform APIs.
- Never commit anything from `recordings/` (gitignored — keep it that way).
- This repo is its own git root. Confirm `git rev-parse --show-toplevel` points at this folder
  before any `git add -A`.
- Ask before `git push`, before publishing, and before anything that writes outside this folder.

## Tooling notes

Formatting is automatic: a global Claude Code hook runs Prettier on edited files because this
project has Prettier in `devDependencies`. Do not hand-format; do not fight the hook.

A TypeScript language server is active, so type errors surface immediately after edits. Trust the
diagnostics over guesswork, and fix errors in the same turn they appear.
