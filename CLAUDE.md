# ScreenRecorder

A simple Windows screen recorder for personal use, possibly shipped to the Microsoft Store.
Design goal: **minimal surface, complete basics.** Every feature must be reachable in one or two
clicks. When a choice arises between "powerful" and "obvious", pick obvious.

## Status

Scaffold. The build tooling, IPC bridge, and source enumeration work. Recording, audio mixing,
region select, and the library view are **not implemented yet**. Do not describe unbuilt features
as working.

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
| Store package | `npm run dist:store` |

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

**Region capture.** `getDisplayMedia` cannot capture a sub-region. Capture the full display, then
crop. Start with a canvas pipeline (`drawImage` the video into a cropped canvas,
`canvas.captureStream()`); move to `MediaStreamTrackProcessor` + `VideoFrame` only if the canvas
approach costs too much CPU.

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

**Window capture is broken at ~1.1 fps** on this hardware via both paths. Phase 3 (window/region
selection) cannot use it as-is. Measure before building on it.

**Benchmark before believing.** `npm run bench:capture` exists because three separate quality
"fixes" (bitrate, codec, scaler) were shipped against a frame-rate problem. It reports the motion
source's own rate alongside capture delivery, so a slow test source can no longer masquerade as a
capture limit. Re-run it after any Electron upgrade or capture change.

`resizeMode` is missing from TypeScript's DOM lib; the augmentation lives in
`src/renderer/src/dom-augment.d.ts`.

**Known limit.** Gradient banding (most visible in dark gradients) comes from 8-bit 4:2:0 chroma
subsampling, which `MediaRecorder` does not let us avoid in either codec. Raising bitrate reduces
but does not eliminate it. Fixing it properly needs a different capture/encode path.

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
