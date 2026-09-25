import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  screen,
  session,
  shell,
  Tray,
} from 'electron';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import {
  stat,
  statfs,
  rename,
  unlink,
  readdir,
  access,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveRecordingRequest } from './recordingPath.cjs';
import { createRangeResponse } from './byteRange.cjs';
import { finalizeWebm } from './webmFinalize.cjs';
import * as log from './log.cjs';
import type {
  AudioMode,
  CaptureTarget,
  RegionRect,
  HudState,
  CaptureSource,
  DisplayInfo,
  QualityPreset,
  Recording,
  RecordingListItem,
} from '../shared/types.js';
import {
  DEFAULT_AUDIO_MODE,
  DEFAULT_QUALITY,
  isAudioMode,
  isQualityPreset,
  PLAYABLE_EXTENSIONS,
  RECORDING_SCHEME, DEFAULT_MIC_DEVICE, SCREEN_TARGET, isWindowSourceId, isRegionRect,
} from '../shared/types.js';

/**
 * Privileged scheme registration MUST happen before app ready.
 *
 * `stream: true` *permits* range responses; it does not produce them. The handler
 * has to answer `Range` itself, and until it did (2026-09-18) `seekable.end(0)`
 * was 0 and every seek landed back at zero. See `serveRange`.
 *
 * `supportFetchAPI` lets the renderer fetch this scheme at all.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: RECORDING_SCHEME,
    // corsEnabled: a CORS request to a custom scheme is rejected outright
    // without it, which showed up as the library's thumbnail probe failing to
    // load at all ("Format error") the moment it set crossOrigin.
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

// --- Recordings directory ------------------------------------------------------
//
// Never derive this from __dirname or app.getAppPath(). MSIX installs the app
// read-only into WindowsApps, so anything written beside the executable fails
// the moment this ships to the Store.

let recordingsDir: string | null = null;

function getRecordingsDir(): string {
  if (!recordingsDir) {
    recordingsDir = join(app.getPath('videos'), 'ScreenRecorder');
    mkdirSync(recordingsDir, { recursive: true });
  }
  return recordingsDir;
}

/** Local time, filesystem-safe, sorts chronologically: 2026-09-16_14-05-33 */
function timestampSlug(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}

/**
 * Open a .part stream, never overwriting an existing file.
 *
 * Timestamps only resolve to the second, so a rapid stop/start can collide.
 * 'wx' turns that collision into EEXIST instead of silently destroying the
 * previous recording; we then walk suffixes until one is free.
 */
function openExclusive(partPath: string): Promise<WriteStream> {
  return new Promise((res, rej) => {
    const stream = createWriteStream(partPath, { flags: 'wx' });
    // createWriteStream reports EEXIST via an async 'error' event, not a throw,
    // so the collision check has to live here rather than in a try/catch.
    const onError = (err: Error): void => {
      stream.destroy();
      rej(err);
    };
    stream.once('error', onError);
    stream.once('open', () => {
      stream.removeListener('error', onError);
      res(stream);
    });
  });
}

async function openPartStream(
  ext: string,
): Promise<{ stream: WriteStream; partPath: string; finalPath: string }> {
  const dir = getRecordingsDir();
  const base = `Recording-${timestampSlug(new Date())}`;

  for (let n = 1; n <= 100; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    const finalPath = join(dir, `${name}.${ext}`);
    const partPath = `${finalPath}.part`;
    try {
      const stream = await openExclusive(partPath);
      return { stream, partPath, finalPath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error('Could not find a free recording filename after 100 attempts');
}

// --- In-flight recordings ------------------------------------------------------

interface ActiveRecording {
  stream: WriteStream;
  partPath: string;
  finalPath: string;
}

const active = new Map<string, ActiveRecording>();

function fail(channel: string, err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${channel}] ${message}`);
  throw new Error(message);
}

/** Discard an in-flight recording and its partial file. Never throws. */
async function discard(rec: ActiveRecording): Promise<void> {
  await new Promise<void>((res) => {
    if (rec.stream.destroyed) {
      res();
      return;
    }
    rec.stream.once('close', () => res());
    rec.stream.destroy();
  });
  await unlink(rec.partPath).catch(() => undefined);
}

/**
 * Free space on the drive the recordings folder lives on.
 *
 * Checked before recording rather than discovered during it: a disk that fills
 * mid-capture ends the recording at an arbitrary point, and the person only
 * finds out afterwards. Returns null if the platform will not say, which is a
 * reason to proceed rather than to block.
 */
async function freeSpaceBytes(): Promise<number | null> {
  try {
    const stats = await statfs(getRecordingsDir());
    return stats.bsize * stats.bavail;
  } catch (err) {
    console.error('[space] could not read free space:', err);
    return null;
  }
}

/**
 * Move a finished .part into place, making it seekable on the way.
 *
 * MediaRecorder leaves WebM in its live-streaming profile: no Duration, no Cues,
 * Segment size unknown. The result plays but reports `Infinity` for its duration
 * and cannot be scrubbed -- in this app or any other player. `finalizeWebm`
 * rewrites the header and appends a cue index, copying every cluster byte
 * unchanged.
 *
 * The fallback is the point. If finalizing fails for any reason, the recording
 * still lands under its final name by plain rename -- exactly today's behaviour.
 * A seek index is a convenience; the recording is not. Never trade the second for
 * the first.
 */
async function placeRecording(partPath: string, finalPath: string): Promise<void> {
  if (extname(finalPath).toLowerCase() === '.webm') {
    try {
      const result = await finalizeWebm(partPath, finalPath);
      await unlink(partPath).catch(() => undefined);
      console.log(
        `[finalize] ${result.durationMs} ms, ${result.cuePoints} cue points, ` +
          `${result.bytesCopied} bytes copied unchanged`,
      );
      return;
    } catch (err) {
      console.error('[finalize] failed; saving the recording unindexed instead:', err);
      // Clear a partial output so the rename below can land -- but only one this
      // call created. On EEXIST nothing was written and the file at that name is
      // somebody else's; deleting it here would turn a naming collision into
      // data loss. The rename then carries the pre-existing overwrite semantics,
      // which is what this path did before finalizing existed.
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') {
        await unlink(finalPath).catch(() => undefined);
      }
    }
  }
  await rename(partPath, finalPath);
}

/**
 * Reclaim .part files left by a crash, power loss, or force-quit.
 *
 * The atomic write path deliberately leaves a .part behind rather than a final-named
 * file that might be truncated -- but nothing reclaimed them, so a recording
 * interrupted by a flat battery was stranded as an unplayable file the user could
 * not open. WebM is a streaming container: a truncated one still decodes up to the
 * point it stops, so these are recoverable by renaming.
 *
 * Runs at startup, when no recording can be in flight.
 */
async function recoverOrphanedParts(): Promise<number> {
  const dir = getRecordingsDir();
  let recovered = 0;
  try {
    const entries = await readdir(dir);
    for (const name of entries) {
      if (!name.endsWith('.part')) continue;
      const partPath = join(dir, name);
      try {
        const info = await stat(partPath);
        // A zero-byte part holds nothing worth keeping.
        if (info.size === 0) {
          await unlink(partPath).catch(() => undefined);
          continue;
        }
        let target = join(dir, name.slice(0, -'.part'.length));
        const ext = extname(target);
        const stem = target.slice(0, target.length - ext.length);
        let n = 1;
        // Never clobber an existing recording while recovering one.
        for (;;) {
          try {
            await access(target);
            n += 1;
            target = `${stem}-recovered-${n}${ext}`;
          } catch {
            break;
          }
        }
        // Recovered recordings get the same treatment: a file rescued from a
        // power loss is the one you can least afford to leave unscrubbable.
        await placeRecording(partPath, target);
        recovered += 1;
        console.log(`[recover] reclaimed ${name} -> ${target}`);
      } catch (err) {
        console.error(`[recover] could not reclaim ${name}:`, err);
      }
    }
  } catch (err) {
    console.error('[recover] scan failed:', err);
  }
  return recovered;
}

// --- Settings ------------------------------------------------------------------
//
// userData, not the recordings folder. That folder holds the user's media; config
// does not belong in it.

// v2 adds `audio`. A v1 file -- which is what is on disk today -- must keep its
// quality preset and gain an audio default, then be rewritten. Bumping without
// handling that would either throw on read or silently reset the user's choice.
/** Below this, a recording is not worth starting. */
const MIN_FREE_BYTES = 300 * 1024 * 1024;
const SETTINGS_VERSION = 3;

interface SettingsFile {
  version: number;
  quality: QualityPreset;
  audio: AudioMode;
  /** deviceId of the chosen microphone; '' means the Windows default. */
  micDevice: string;
}

/** A deviceId is an opaque token; bound its length rather than trusting it. */
const isMicDevice = (v: unknown): v is string => typeof v === 'string' && v.length <= 512;

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json');

/**
 * Serializes writes.
 *
 * Clicking through presets quickly fires overlapping writes. Sharing one temp
 * filename means two in-flight writes race: one rename can fail, or rename a file
 * the other is still writing. A torn settings file is exactly the corruption the
 * read-path fallback exists to survive — no reason to manufacture it ourselves.
 */
let writeChain: Promise<void> = Promise.resolve();

async function writeSettings(data: SettingsFile): Promise<void> {
  const run = async (): Promise<void> => {
    const target = settingsPath();
    // Unique temp name as well as serialization: belt and braces, and it also
    // protects against a second app instance.
    const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, target);
  };
  writeChain = writeChain.then(run, run);
  return writeChain;
}

/**
 * Read the stored preset, healing the file when it is unusable.
 *
 * Never throws: a corrupt config must not stop the app from starting. And it is
 * rewritten on detection rather than "on the next write" — if the user never
 * changes the preset, that write never comes and the file stays broken forever.
 */
async function readSettings(): Promise<SettingsFile> {
  const fallback: SettingsFile = {
    version: SETTINGS_VERSION,
    quality: DEFAULT_QUALITY,
    audio: DEFAULT_AUDIO_MODE,
    micDevice: DEFAULT_MIC_DEVICE,
  };

  let raw: string;
  try {
    raw = await readFile(settingsPath(), 'utf8');
  } catch {
    void writeSettings(fallback).catch(() => undefined);
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[settings] unparseable settings.json; resetting to defaults');
    void writeSettings(fallback).catch(() => undefined);
    return fallback;
  }

  const obj = (parsed ?? {}) as {
    version?: unknown;
    quality?: unknown;
    audio?: unknown;
    micDevice?: unknown;
  };

  // Each field is validated independently, so one bad value never discards the
  // other. A v1 file has no `audio` at all -- that is a migration, not corruption.
  const quality = isQualityPreset(obj.quality) ? obj.quality : DEFAULT_QUALITY;
  const audio = isAudioMode(obj.audio) ? obj.audio : DEFAULT_AUDIO_MODE;
  const micDevice = isMicDevice(obj.micDevice) ? obj.micDevice : DEFAULT_MIC_DEVICE;

  if (!isQualityPreset(obj.quality)) {
    console.error(`[settings] unknown quality ${String(obj.quality)}; using ${DEFAULT_QUALITY}`);
  }
  const migrating = obj.version !== SETTINGS_VERSION;
  if (migrating) {
    console.log(`[settings] migrating v${String(obj.version)} -> v${SETTINGS_VERSION}`);
  }

  const settings: SettingsFile = { version: SETTINGS_VERSION, quality, audio, micDevice };
  // Rewrite on migration or on any rejected field, so a stale or broken file
  // heals once rather than being re-read and re-patched on every launch.
  if (
    migrating ||
    !isQualityPreset(obj.quality) ||
    !isAudioMode(obj.audio) ||
    !isMicDevice(obj.micDevice)
  ) {
    void writeSettings(settings).catch(() => undefined);
  }
  return settings;
}

// --- Memory sampling (AC-6) ----------------------------------------------------
//
// getAppMetrics() returns every process: main, GPU, utility, and one renderer per
// window -- including a second one whenever DevTools is open, which the
// verification steps explicitly ask for. Sampling "the renderer" without pinning
// the pid could track the GPU process and report a flat, meaningless series.

interface MemorySample {
  atMs: number;
  workingSetKb: number;
}

let memoryTimer: NodeJS.Timeout | null = null;
let memorySamples: MemorySample[] = [];
let memoryStartedAt = 0;
let recordingPid: number | null = null;

function sampleMemory(): void {
  if (recordingPid === null) return;
  const metric = app.getAppMetrics().find((m) => m.pid === recordingPid);
  if (!metric) {
    console.error(`[memory] no metric for recording renderer pid ${recordingPid} — sample skipped`);
    return;
  }
  memorySamples.push({
    atMs: Date.now() - memoryStartedAt,
    workingSetKb: metric.memory.workingSetSize,
  });
}

function startMemorySampling(pid: number): void {
  stopMemorySampling();
  recordingPid = pid;
  memorySamples = [];
  memoryStartedAt = Date.now();
  sampleMemory();
  memoryTimer = setInterval(sampleMemory, 15_000);
}

function stopMemorySampling(): void {
  if (memoryTimer) clearInterval(memoryTimer);
  memoryTimer = null;
  recordingPid = null;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/**
 * Report the series. Compares per-minute medians rather than single samples: one
 * reading can land before the first major GC and another just after, which makes
 * a point-to-point ratio arbitrary.
 */
function reportMemory(): void {
  if (memorySamples.length === 0) return;
  const inMinute = (n: number): number[] =>
    memorySamples
      .filter((s) => s.atMs >= (n - 1) * 60_000 && s.atMs < n * 60_000)
      .map((s) => s.workingSetKb);

  const first = median(inMinute(1));
  const lastMinute = Math.max(1, Math.ceil(memorySamples[memorySamples.length - 1]!.atMs / 60_000));
  const last = median(inMinute(lastMinute));
  const peak = Math.max(...memorySamples.map((s) => s.workingSetKb));
  const ratio = first > 0 ? last / first : 0;

  console.log(
    `[memory] ${memorySamples.length} samples over ${(memorySamples[memorySamples.length - 1]!.atMs / 60000).toFixed(1)} min`,
  );
  console.log(
    `[memory] minute-1 median ${(first / 1024).toFixed(1)} MB, minute-${lastMinute} median ${(last / 1024).toFixed(1)} MB, peak ${(peak / 1024).toFixed(1)} MB`,
  );
  console.log(
    `[memory] growth ratio ${ratio.toFixed(2)}x (AC-6 requires < 1.5x) -> ${ratio > 0 && ratio < 1.5 ? 'PASS' : 'REVIEW'}`,
  );
  console.log(
    `[memory] series (MB): ${memorySamples.map((s) => (s.workingSetKb / 1024).toFixed(0)).join(', ')}`,
  );
}

// --- Path safety ---------------------------------------------------------------

/**
 * Resolve a caller-supplied path and confirm it sits inside the recordings folder.
 *
 * Four handlers now accept a path from the renderer. One shared check is the only
 * way they stay consistent as that number grows.
 *
 * Separator-aware: a bare startsWith on the directory string would also accept a
 * sibling such as ...\ScreenRecorder-elsewhere\x.mp4.
 */
function resolveInsideRecordings(channel: string, filePath: unknown): string {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    fail(channel, new Error('Path must be a non-empty string'));
  }
  const target = resolve(filePath);
  const root = resolve(getRecordingsDir()) + sep;
  if (!target.startsWith(root)) {
    fail(channel, new Error('Refusing to act on a path outside the recordings folder'));
  }
  return target;
}

const isPlayable = (p: string): boolean =>
  PLAYABLE_EXTENSIONS.includes(extname(p).toLowerCase());

// --- Playback protocol ---------------------------------------------------------
//
// The renderer CSP is `media-src 'self' blob:`, so a <video> cannot load file://.
// Widening the CSP would let any renderer content read arbitrary local files
// forever, purely to make a video player work -- a bad trade. This scheme serves
// recordings and nothing else.
//
// It is reachable from renderer content, so its input is untrusted.

function registerRecordingProtocol(): void {
  protocol.handle(RECORDING_SCHEME, async (request) => {
    // Thin wrapper. All validation lives in recordingPath.cjs, which
    // scripts/verify-guards.cjs imports directly -- one implementation, so the
    // verifier cannot drift from what actually ships.
    const decision = resolveRecordingRequest(request.url, getRecordingsDir());

    if (!decision.ok) {
      console.error(`[${RECORDING_SCHEME}] refused (${decision.reason}): ${request.url}`);
      // Deliberately opaque: a descriptive error would report filesystem layout
      // back to whatever made the request.
      return new Response('Not found', { status: 404 });
    }

    let size: number;
    try {
      size = (await stat(decision.filePath)).size;
    } catch {
      console.error(`[${RECORDING_SCHEME}] no such recording: ${decision.fileName}`);
      return new Response('Not found', { status: 404 });
    }

    return serveRange(request, decision.filePath, size);
  });
}

/** Content type from the extension. The list is the one the validator allows. */
function mediaTypeFor(filePath: string): string {
  return extname(filePath).toLowerCase() === '.mp4' ? 'video/mp4' : 'video/webm';
}

/**
 * Serve a recording with HTTP range support.
 *
 * This is what makes the scrubber work. A <video> element seeks by asking for a
 * byte range; a handler that always returns the whole file gives it nothing to
 * seek with. Measured 2026-09-18 on a finalized 12.6 MB recording:
 *
 *   net.fetch passthrough : seekable.end(0) = 0, a seek to 15.5 s landed at 0
 *   range-aware           : seekable.end(0) = 20.673, the seek landed at 15.5
 *
 * The duration fix in webmFinalize.cjs was necessary but not sufficient -- both
 * are required, and testing over file:// hid this because file URLs carry range
 * support of their own.
 */
function serveRange(request: Request, filePath: string, size: number): Response {
  // Parsing and serving both live in byteRange.cjs, which scripts/verify-range.cjs
  // requires directly -- one implementation, so the verifier cannot drift from
  // what ships.
  return createRangeResponse(request.headers.get('Range'), filePath, size, mediaTypeFor(filePath));
}

// --- Capture source selection --------------------------------------------------

/**
 * Pick the source for the primary display.
 *
 * sources[0] is NOT the primary display. Electron makes no ordering guarantee,
 * so on a multi-monitor machine "record my screen" would capture an arbitrary
 * one. Correlate through display_id instead, which maps to the Screen API's id.
 */
function pickPrimaryScreen(
  sources: Electron.DesktopCapturerSource[],
): Electron.DesktopCapturerSource | null {
  if (sources.length === 0) return null;

  const primaryId = String(screen.getPrimaryDisplay().id);
  const matched = sources.find((s) => s.display_id === primaryId);
  if (matched) return matched;

  // display_id is documented as possibly empty. Falling back is better than
  // failing, but it is worth knowing when the correlation did not hold.
  console.error(
    `[displayMedia] no source matched primary display ${primaryId}; falling back to first of ${sources.length}`,
  );
  return sources[0] ?? null;
}

/**
 * What the next capture request should capture. Set by the renderer immediately
 * before it calls getDisplayMedia; the handler below reads it.
 */
let captureTarget: CaptureTarget = SCREEN_TARGET;

function registerDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const target = captureTarget;
    // A region is a screen capture that the renderer crops; only a window needs
    // a different source list.
    const types: ('screen' | 'window')[] = target.kind === 'window' ? ['window'] : ['screen'];
    desktopCapturer
      .getSources({ types, thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const source =
          target.kind === 'window'
            ? (sources.find((s) => s.id === target.id) ?? null)
            : pickPrimaryScreen(sources);
        if (!source) {
          // A closed window is the usual cause. Reject rather than fall back to
          // the screen: recording the whole desktop when someone asked for one
          // window would capture exactly what they chose to leave out.
          console.error(`[displayMedia] no source for target ${target.kind}`);
          callback({});
          return;
        }
        // 'loopback' is real WASAPI system audio on Windows. Only when the
        // renderer actually asked: requesting it unconditionally would attach a
        // track to recordings the user chose to keep silent. It is whole-system
        // audio even for window capture -- Windows offers no per-window loopback.
        callback({ video: source, audio: request.audioRequested ? 'loopback' : undefined });
      })
      .catch((err: unknown) => {
        console.error('[displayMedia] getSources failed:', err);
        callback({});
      });
  });
}

// --- IPC -----------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle('sources:list', async (): Promise<CaptureSource[]> => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false,
    });
    // Never offer this app's own windows: recording the recorder is never what
    // anyone meant, and the overlay is excluded from capture anyway.
    //
    // Compared on the window handle (the middle segment of `window:<hwnd>:<n>`)
    // rather than the whole id, so a difference in the trailing segment between
    // getMediaSourceId() and desktopCapturer can never let this app through.
    const handle = (id: string): string => id.split(':')[1] ?? id;
    const own = new Set(
      BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed())
        .map((w) => handle(w.getMediaSourceId())),
    );
    return sources
      .filter((s) => !(s.id.startsWith('window:') && own.has(handle(s.id))))
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumbnailDataUrl: s.thumbnail.toDataURL(),
      }));
  });

  ipcMain.handle('library:open', (): void => openLibrary());

  ipcMain.handle('app:quit', (): void => app.quit());

  // Renderer failures belong in the same file as main's, in order.
  ipcMain.on('log:renderer', (_e, level: unknown, message: unknown) => {
    if (typeof message === 'string') {
      log.fromRenderer(level === 'error' ? 'error' : 'warn', message.slice(0, 2000));
    }
  });

  ipcMain.handle('log:open', async (): Promise<void> => {
    const p = log.currentPath();
    if (p) await shell.openPath(p);
  });

  ipcMain.handle('bar:hide', (): void => {
    barWindow?.hide();
    trayRefresh?.();
  });

  ipcMain.handle('region:select', (): Promise<RegionRect | null> => selectRegion());

  ipcMain.handle('capture:set-target', (_e, target: unknown): void => {
    const t = target as { kind?: unknown; id?: unknown; name?: unknown; rect?: unknown } | null;
    if (t?.kind === 'screen') {
      captureTarget = SCREEN_TARGET;
    } else if (t?.kind === 'window' && isWindowSourceId(t.id)) {
      captureTarget = { kind: 'window', id: t.id, name: typeof t.name === 'string' ? t.name : '' };
    } else if (t?.kind === 'region' && isRegionRect(t.rect)) {
      captureTarget = { kind: 'region', rect: t.rect };
    } else {
      fail('capture:set-target', new Error('Invalid capture target'));
    }
  });

  ipcMain.handle('display:primary', (): DisplayInfo => {
    const d = screen.getPrimaryDisplay();
    // size is in logical points; multiply by scaleFactor for real pixels, or a
    // HiDPI display gets captured at a fraction of its true resolution.
    return {
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
      scaleFactor: d.scaleFactor,
    };
  });

  ipcMain.handle(
    'settings:get-quality',
    async (): Promise<QualityPreset> => (await readSettings()).quality,
  );

  ipcMain.handle('settings:set-quality', async (_e, preset: unknown): Promise<void> => {
    if (!isQualityPreset(preset)) {
      fail('settings:set-quality', new Error(`Unknown quality preset: ${String(preset)}`));
    }
    try {
      // Merged, not replaced: writing only the quality would silently drop the
      // audio mode stored alongside it.
      const current = await readSettings();
      await writeSettings({ ...current, version: SETTINGS_VERSION, quality: preset });
    } catch (err) {
      fail('settings:set-quality', err);
    }
  });

  ipcMain.handle('settings:get-audio', async (): Promise<AudioMode> => (await readSettings()).audio);

  ipcMain.handle(
    'settings:get-mic',
    async (): Promise<string> => (await readSettings()).micDevice,
  );

  ipcMain.handle('settings:set-mic', async (_e, deviceId: unknown): Promise<void> => {
    if (!isMicDevice(deviceId)) {
      fail('settings:set-mic', new Error('Invalid microphone device id'));
    }
    try {
      const current = await readSettings();
      await writeSettings({ ...current, version: SETTINGS_VERSION, micDevice: deviceId });
    } catch (err) {
      fail('settings:set-mic', err);
    }
  });

  ipcMain.handle('settings:set-audio', async (_e, mode: unknown): Promise<void> => {
    if (!isAudioMode(mode)) {
      fail('settings:set-audio', new Error(`Unknown audio mode: ${String(mode)}`));
    }
    try {
      const current = await readSettings();
      await writeSettings({ ...current, version: SETTINGS_VERSION, audio: mode });
    } catch (err) {
      fail('settings:set-audio', err);
    }
  });

  ipcMain.handle('recordings:dir', () => getRecordingsDir());

  ipcMain.handle('recordings:free-space', (): Promise<number | null> => freeSpaceBytes());

  ipcMain.handle('thumbs:get', async (_e, filePath: unknown): Promise<string | null> => {
    const target = resolveInsideRecordings('thumbs:get', filePath);
    const info = await stat(target).catch(() => null);
    if (!info) return null;
    const cached = join(thumbsDir(), `${thumbKey(target, info.size, info.mtimeMs)}.jpg`);
    const bytes = await readFile(cached).catch(() => null);
    return bytes ? `data:image/jpeg;base64,${bytes.toString('base64')}` : null;
  });

  ipcMain.handle('thumbs:put', async (_e, filePath: unknown, data: unknown): Promise<void> => {
    const target = resolveInsideRecordings('thumbs:put', filePath);
    if (!(data instanceof ArrayBuffer) || data.byteLength === 0) {
      fail('thumbs:put', new Error('Expected image bytes'));
    }
    if (data.byteLength > THUMB_MAX_BYTES) {
      fail('thumbs:put', new Error('Thumbnail too large'));
    }
    const bytes = Buffer.from(data);
    // These bytes come from the renderer and are written to the user's profile,
    // then served back as image/jpeg. Size alone does not make them an image.
    if (!looksLikeJpeg(bytes)) {
      fail('thumbs:put', new Error('Not a JPEG'));
    }

    const info = await stat(target).catch(() => null);
    if (!info) fail('thumbs:put', new Error('That recording is gone'));

    const dir = thumbsDir();
    mkdirSync(dir, { recursive: true });
    const finalPath = join(dir, `${thumbKey(target, info.size, info.mtimeMs)}.jpg`);
    // Same atomic write as everything else here: a torn image is worse than none.
    const tmp = `${finalPath}.${randomUUID()}.part`;
    try {
      await writeFile(tmp, bytes);
      await rename(tmp, finalPath);
    } catch (err) {
      await unlink(tmp).catch(() => undefined);
      fail('thumbs:put', err);
    }
    void trimThumbCache();
  });

  ipcMain.handle('recordings:begin', async (_e, ext: unknown): Promise<string> => {
    // Refusing here beats a recording that dies at an arbitrary point. The
    // floor is deliberately low: this blocks the hopeless case only, and the
    // renderer warns well before it.
    const free = await freeSpaceBytes();
    if (free !== null && free < MIN_FREE_BYTES) {
      fail(
        'recordings:begin',
        new Error(
          `Only ${(free / 1e6).toFixed(0)} MB free where recordings are saved. Free up some space first.`,
        ),
      );
    }
    if (typeof ext !== 'string' || !/^[a-z0-9]{2,5}$/i.test(ext)) {
      fail('recordings:begin', new Error(`Invalid extension: ${String(ext)}`));
    }
    try {
      const { stream, partPath, finalPath } = await openPartStream(ext);
      const id = randomUUID();
      active.set(id, { stream, partPath, finalPath });
      // Pin sampling to the renderer that asked, not to "a" renderer (AC-6).
      const pid = _e.sender.getOSProcessId();
      startMemorySampling(pid);
      return id;
    } catch (err) {
      fail('recordings:begin', err);
    }
  });

  ipcMain.handle('recordings:append', async (_e, id: unknown, chunk: unknown): Promise<void> => {
    const rec = typeof id === 'string' ? active.get(id) : undefined;
    if (!rec) fail('recordings:append', new Error('Unknown recording id'));
    if (!(chunk instanceof ArrayBuffer)) {
      fail('recordings:append', new Error('Chunk must be an ArrayBuffer'));
    }

    try {
      // Respect backpressure: if the buffer is full, wait for drain rather than
      // queueing the whole recording in memory, which is the thing we are avoiding.
      const ok = rec.stream.write(Buffer.from(chunk));
      if (!ok) {
        await new Promise<void>((res, rej) => {
          rec.stream.once('drain', res);
          rec.stream.once('error', rej);
        });
      }
    } catch (err) {
      active.delete(id as string);
      await discard(rec);
      fail('recordings:append', err);
    }
  });

  ipcMain.handle('recordings:finish', async (_e, id: unknown): Promise<Recording> => {
    const rec = typeof id === 'string' ? active.get(id) : undefined;
    if (!rec) fail('recordings:finish', new Error('Unknown recording id'));
    active.delete(id as string);

    try {
      await new Promise<void>((res, rej) => {
        rec.stream.end((err?: Error | null) => (err ? rej(err) : res()));
      });
      // A capture that produced nothing must not become a file. It happens when
      // a recording is stopped in the same instant it starts, and it leaves an
      // unplayable 0-byte entry in the library forever.
      const part = await stat(rec.partPath).catch(() => null);
      if (!part || part.size === 0) {
        await discard(rec);
        stopMemorySampling();
        fail('recordings:finish', new Error('Nothing was recorded'));
      }

      // Placing the file is what makes this atomic. Until it lands, a crash
      // leaves a .part file rather than a truncated file wearing a valid name.
      await placeRecording(rec.partPath, rec.finalPath);
      reportMemory();
      stopMemorySampling();
      const info = await stat(rec.finalPath);
      return {
        fileName: rec.finalPath.split(sep).pop() ?? rec.finalPath,
        filePath: rec.finalPath,
        createdAt: new Date().toISOString(),
        sizeBytes: info.size,
      };
    } catch (err) {
      await discard(rec);
      fail('recordings:finish', err);
    }
  });

  ipcMain.handle('recordings:abort', async (_e, id: unknown): Promise<void> => {
    const rec = typeof id === 'string' ? active.get(id) : undefined;
    if (!rec) return;
    active.delete(id as string);
    stopMemorySampling();
    await discard(rec);
  });

  ipcMain.handle('recordings:reveal', (_e, filePath: unknown): void => {
    shell.showItemInFolder(resolveInsideRecordings('recordings:reveal', filePath));
  });

  /**
   * List the folder. No index: a file added or removed outside the app shows up
   * on the next read, and there is nothing to migrate or repair.
   */
  ipcMain.handle('recordings:list', async (): Promise<RecordingListItem[]> => {
    const dir = getRecordingsDir();
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      // A missing folder is an empty library, not an error (AC-2).
      return [];
    }

    const items: RecordingListItem[] = [];
    for (const name of names) {
      // .part files are in-flight or unrecovered, not library content.
      if (!isPlayable(name)) continue;
      const filePath = join(dir, name);
      try {
        const info = await stat(filePath);
        if (!info.isFile()) continue;
        items.push({
          fileName: name,
          filePath,
          playbackUrl: `${RECORDING_SCHEME}://f/${encodeURIComponent(name)}`,
          modifiedAt: info.mtime.toISOString(),
          sizeBytes: info.size,
        });
      } catch {
        // Vanished between readdir and stat. Skip it rather than fail the list.
      }
    }

    // Modified time, not birth time: a recovered recording was renamed from .part,
    // so its birth time predates the content while mtime reflects when it finished.
    items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return items;
  });

  ipcMain.handle(
    'recordings:delete',
    async (_e, filePath: unknown, permanent: unknown): Promise<void> => {
      const target = resolveInsideRecordings('recordings:delete', filePath);

      // The .part exclusion in the list is a UI convenience, not a guarantee --
      // this handler is callable regardless of what the UI offers, and a delete
      // landing mid-write would corrupt a live recording.
      for (const rec of active.values()) {
        if (resolve(rec.finalPath) === target || resolve(rec.partPath) === target) {
          fail('recordings:delete', new Error('That recording is still being written'));
        }
      }

      if (permanent === true) {
        try {
          await unlink(target);
        } catch (err) {
          fail('recordings:delete', err);
        }
        return;
      }

      try {
        await shell.trashItem(target);
      } catch (err) {
        // Never fall back to unlink. trashItem rejects on network drives and
        // volumes without a Recycle Bin; silently destroying the file instead
        // would defeat the entire reason the recoverable path is the default.
        const detail = err instanceof Error ? err.message : String(err);
        fail(
          'recordings:delete',
          new Error(
            `Could not move the recording to the Recycle Bin (${detail}). The file was left in place.`,
          ),
        );
      }
    },
  );

  ipcMain.handle('recordings:open-external', async (_e, filePath: unknown): Promise<void> => {
    const target = resolveInsideRecordings('recordings:open-external', filePath);
    const err = await shell.openPath(target);
    // openPath resolves with an error STRING rather than rejecting.
    if (err) fail('recordings:open-external', new Error(err));
  });
}

/* ------------------------------------------------------------------ region */

let regionWindow: BrowserWindow | null = null;
let outlineWindow: BrowserWindow | null = null;

/**
 * Full-screen selector for choosing a region by dragging.
 *
 * Transparent and frameless over the whole primary display, so the drag happens
 * against what is actually on screen rather than a preview of it. Resolves the
 * chosen rect in display points, or null when cancelled.
 */
function selectRegion(): Promise<RegionRect | null> {
  if (regionWindow && !regionWindow.isDestroyed()) {
    regionWindow.focus();
    return Promise.resolve(null);
  }

  const { bounds } = screen.getPrimaryDisplay();
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      fullscreenable: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    regionWindow = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    // Excluded from capture like the indicator: the selector is scaffolding, and
    // a recording that starts while it is still fading out must not contain it.
    win.setContentProtection(true);

    let settled = false;
    const finish = (rect: RegionRect | null): void => {
      if (settled) return;
      settled = true;
      resolve(rect);
      if (!win.isDestroyed()) win.close();
    };

    ipcMain.once('region:result', (_e, rect: unknown) => finish(isRegionRect(rect) ? rect : null));
    // Closed by any other means (Alt+F4, focus loss) is a cancel, not a hang.
    win.on('closed', () => {
      regionWindow = null;
      finish(null);
    });

    const url = process.env['ELECTRON_RENDERER_URL'];
    if (url) void win.loadURL(`${url}#region`);
    else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'region' });
    win.once('ready-to-show', () => win.show());
  });
}

/**
 * A thin outline around the region being recorded.
 *
 * Click-through and excluded from capture, so it shows the boundary without
 * appearing in the file or blocking the work underneath. Drawn just outside the
 * region, or it would cover the edge pixels it is describing.
 */
let outlineRect: RegionRect | null = null;

function showOutline(rect: RegionRect): void {
  // Idempotent on purpose. The recorder republishes its state four times a
  // second, and an earlier version rebuilt this window on every one of them --
  // which read as a rectangle flickering on and off for the whole recording.
  if (
    outlineWindow &&
    !outlineWindow.isDestroyed() &&
    outlineRect &&
    outlineRect.x === rect.x &&
    outlineRect.y === rect.y &&
    outlineRect.width === rect.width &&
    outlineRect.height === rect.height
  ) {
    return;
  }
  hideOutline();
  outlineRect = { ...rect };
  const { bounds } = screen.getPrimaryDisplay();
  const pad = 2;
  const win = new BrowserWindow({
    x: Math.round(bounds.x + rect.x - pad),
    y: Math.round(bounds.y + rect.y - pad),
    width: Math.round(rect.width + pad * 2),
    height: Math.round(rect.height + pad * 2),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setContentProtection(true);
  void win.loadURL(
    'data:text/html,' +
      encodeURIComponent(
        `<body style="margin:0;background:transparent">
           <div style="position:fixed;inset:0;border:${pad}px solid #ff4d4d;border-radius:2px"></div>
         </body>`,
      ),
  );
  win.showInactive();
  outlineWindow = win;
}

function hideOutline(): void {
  if (outlineWindow && !outlineWindow.isDestroyed()) outlineWindow.close();
  outlineWindow = null;
  outlineRect = null;
}

/* --------------------------------------------------------------- thumbnails */

/**
 * Cached tile images, under userData -- never beside the recordings, which hold
 * the user's media and nothing of ours.
 *
 * **The cache is disposable.** Nothing but tile display may read it: delete the
 * directory and listing, playback, duration and delete all still work. The
 * moment it holds authoritative metadata it has become an index, and then losing
 * it loses something.
 */
const THUMB_MAX_BYTES = 256 * 1024;
const THUMB_CACHE_BYTES = 64 * 1024 * 1024;

function thumbsDir(): string {
  return join(app.getPath('userData'), 'thumbnails');
}

/**
 * Cache key: name, size and modified time together.
 *
 * Replacing a file at the same path changes its size or mtime, so it gets a new
 * key and the stale image can never be served for new content.
 */
function thumbKey(filePath: string, size: number, mtimeMs: number): string {
  return createHash('sha1').update(`${filePath}:${size}:${mtimeMs}`).digest('hex');
}

/** JPEG starts FF D8 FF and ends FF D9. */
function looksLikeJpeg(bytes: Buffer): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  );
}

/** Keep the cache bounded: oldest entries go first. */
async function trimThumbCache(): Promise<void> {
  const dir = thumbsDir();
  try {
    const names = await readdir(dir);
    const entries = await Promise.all(
      names.map(async (name) => {
        const p = join(dir, name);
        const info = await stat(p).catch(() => null);
        return info ? { p, size: info.size, mtimeMs: info.mtimeMs } : null;
      }),
    );
    const live = entries.filter((e): e is NonNullable<typeof e> => e !== null);
    let total = live.reduce((a, e) => a + e.size, 0);
    if (total <= THUMB_CACHE_BYTES) return;

    live.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const entry of live) {
      if (total <= THUMB_CACHE_BYTES) break;
      await unlink(entry.p).catch(() => undefined);
      total -= entry.size;
    }
  } catch {
    // No cache directory yet, or an unreadable one: nothing to trim.
  }
}

/** Drop images whose recording is gone. Runs at startup beside part recovery. */
async function pruneThumbs(): Promise<void> {
  const dir = thumbsDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }

  const wanted = new Set<string>();
  try {
    for (const name of await readdir(getRecordingsDir())) {
      if (!isPlayable(name)) continue;
      const p = join(getRecordingsDir(), name);
      const info = await stat(p).catch(() => null);
      if (info) wanted.add(`${thumbKey(p, info.size, info.mtimeMs)}.jpg`);
    }
  } catch {
    // Recordings folder unreadable: leave the cache alone rather than wipe it.
    return;
  }

  let removed = 0;
  for (const name of names) {
    if (wanted.has(name)) continue;
    await unlink(join(dir, name)).catch(() => undefined);
    removed += 1;
  }
  if (removed > 0) console.log(`[thumbs] pruned ${removed} stale image(s)`);
}

/* --------------------------------------------------------------------- tray */

let tray: Tray | null = null;
let trayRefresh: (() => void) | null = null;
let recordingNow = false;

/** Icons live outside the asar in a packaged build, beside it in development. */
function resourcePath(file: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, file)
    : join(__dirname, '..', '..', 'resources', file);
}

function toggleBar(): void {
  if (!barWindow || barWindow.isDestroyed()) {
    createBar();
  createTray();
  } else if (barWindow.isVisible()) {
    barWindow.hide();
  } else {
    barWindow.show();
  }
  trayRefresh?.();
}

/**
 * The tray icon is what makes hiding the bar safe.
 *
 * Without it, closing the only window would strand the app: still running with
 * no way back, or gone when a recording might still be in progress. From here
 * the bar can be summoned, a recording stopped, and the app actually quit.
 */
function createTray(): void {
  if (tray) return;

  const image = nativeImage.createFromPath(resourcePath('tray-16.png'));
  // createFromPath returns an EMPTY image for a missing file rather than
  // throwing, which would ship as a blank tray icon nobody can click.
  if (image.isEmpty()) {
    console.error(`[tray] icon missing at ${resourcePath('tray-16.png')}; run npm run icons`);
  }
  // Windows draws the tray at 16px logical; the 32px art is the 200% variant.
  image.addRepresentation({
    scaleFactor: 2,
    buffer: nativeImage.createFromPath(resourcePath('tray-32.png')).toPNG(),
  });
  tray = new Tray(image);
  tray.setToolTip('ScreenRecorder');

  trayRefresh = (): void => {
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: barWindow?.isVisible() ? 'Hide the bar' : 'Show the bar',
          click: () => toggleBar(),
        },
        {
          label: recordingNow ? 'Stop recording' : 'Start recording',
          // The bar decides what this means -- it holds the recorder and knows
          // what is currently selected.
          click: () => barWindow?.webContents.send('hud:command', 'toggle'),
        },
        { type: 'separator' },
        { label: 'Recordings', click: () => openLibrary() },
        { type: 'separator' },
        { label: 'Quit ScreenRecorder', click: () => app.quit() },
      ]),
    );
  };

  trayRefresh();
  // A single click is the gesture people expect from a tray icon.
  tray.on('click', () => toggleBar());
}

/* ---------------------------------------------------------------------- bar */

let barWindow: BrowserWindow | null = null;
let libraryWindow: BrowserWindow | null = null;

const BAR_WIDTH = 468;
const BAR_HEIGHT = 64;

/**
 * The control bar: the app's primary window.
 *
 * Frameless and always on top, because the thing being recorded is someone
 * else's work and this has to sit over it without becoming a destination. It
 * holds the recorder, so the recordings window can be opened and closed at any
 * time without disturbing a capture.
 *
 * Excluded from capture like the region outline, so the bar never films itself.
 */
function createBar(): void {
  if (barWindow && !barWindow.isDestroyed()) {
    barWindow.show();
    barWindow.focus();
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    x: Math.round(workArea.x + (workArea.width - BAR_WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height - BAR_HEIGHT - 56),
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'ScreenRecorder',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  barWindow = win;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setContentProtection(true);

  win.on('closed', () => {
    barWindow = null;
    hideOutline();
  });

  const url = process.env['ELECTRON_RENDERER_URL'];
  if (url) void win.loadURL(`${url}#bar`);
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'bar' });

  win.once('ready-to-show', () => win.show());
}

/** Grow and shrink with the bar's own content; a taller window would swallow
 * clicks on the desktop through its transparent area. */
function resizeBar(height: number): void {
  if (!barWindow || barWindow.isDestroyed()) return;
  const clamped = Math.max(BAR_HEIGHT, Math.min(Math.round(height), 720));
  const [, h] = barWindow.getSize();
  if (h === clamped) return;
  const bounds = barWindow.getBounds();
  // Grows downward from where it sits, unless that would run off the work area,
  // in which case it grows up instead -- the bar normally lives near the bottom.
  const { workArea } = screen.getPrimaryDisplay();
  const overflow = bounds.y + clamped - (workArea.y + workArea.height);
  barWindow.setBounds({
    x: bounds.x,
    y: overflow > 0 ? Math.max(workArea.y, bounds.y - overflow) : bounds.y,
    // The constant, never the current size: feeding getSize() back in accumulates
    // a pixel or two per resize on a fractional-scale display (472 -> 476 after
    // four panel toggles).
    width: BAR_WIDTH,
    height: clamped,
  });
}

function registerHudRelay(): void {
  // The recorder publishes its state; main only needs it to keep the region
  // outline in step with the recording.
  ipcMain.on('hud:state', (_e, state: HudState) => {
    if (state?.recording && captureTarget.kind === 'region') showOutline(captureTarget.rect);
    else hideOutline();

    if (state?.recording !== recordingNow) {
      recordingNow = Boolean(state?.recording);
      trayRefresh?.();
      // A recording started by the hotkey while the bar was hidden needs its
      // indicator back: the bar is the only thing showing that this is recording.
      if (recordingNow && barWindow && !barWindow.isDestroyed() && !barWindow.isVisible()) {
        barWindow.showInactive();
        trayRefresh?.();
      }
    }
  });

  // Relayed, because the recorder and the recordings list live in different
  // windows now.
  ipcMain.on('recordings:changed', (_e, filePath: unknown) => {
    if (libraryWindow && !libraryWindow.isDestroyed() && typeof filePath === 'string') {
      libraryWindow.webContents.send('recordings:changed', filePath);
    }
  });

  ipcMain.on('bar:resize', (_e, height: unknown) => {
    if (typeof height === 'number' && Number.isFinite(height)) resizeBar(height);
  });
}


function createLibraryWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#12131a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  libraryWindow = win;
  win.on('ready-to-show', () => win.show());
  // Closing the recordings window is not closing the app: the bar owns the
  // recorder, and a capture in progress must survive this window going away.
  win.on('closed', () => {
    libraryWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function openLibrary(): void {
  if (libraryWindow && !libraryWindow.isDestroyed()) {
    if (libraryWindow.isMinimized()) libraryWindow.restore();
    libraryWindow.focus();
    return;
  }
  createLibraryWindow();
}

// Before anything else: from here on, whatever the app reports also lands on
// disk. Errors during startup are exactly the ones with no console present.
log.start(join(app.getPath('userData'), 'logs'));

app.whenReady().then(() => {
  registerDisplayMediaHandler();
  registerRecordingProtocol();
  registerIpc();
  registerHudRelay();
  // Reclaim anything a previous crash left behind, before a new recording starts.
  void recoverOrphanedParts();
  void pruneThumbs();
  createBar();

  // Start and stop without reaching for the bar, which is the point of a hotkey
  // on a recorder: the moment worth capturing rarely waits.
  const registered = globalShortcut.register('Control+Shift+R', () => {
    if (barWindow && !barWindow.isDestroyed()) barWindow.webContents.send('hud:command', 'toggle');
  });
  if (!registered) console.error('[shortcut] Ctrl+Shift+R is taken; the bar still works');

  app.on('activate', () => createBar());
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tray?.destroy();
  tray = null;
});

// Hiding the bar leaves no open window, which must not end the app: the tray is
// still there, and a recording may still be running.
app.on('window-all-closed', () => undefined);

/**
 * Closing the window mid-recording must not silently throw away what was captured.
 * Finalize every in-flight stream before letting the process exit.
 */
let finalizing = false;
app.on('before-quit', (event) => {
  if (finalizing || active.size === 0) return;
  event.preventDefault();
  finalizing = true;

  const pending = [...active.values()];
  active.clear();

  void Promise.all(
    pending.map(async (rec) => {
      try {
        await new Promise<void>((res, rej) => {
          rec.stream.end((err?: Error | null) => (err ? rej(err) : res()));
        });
        await placeRecording(rec.partPath, rec.finalPath);
      } catch (err) {
        console.error('[before-quit] failed to finalize recording:', err);
      }
    }),
  ).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
