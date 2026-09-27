import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
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
import {
  accessSync,
  constants as fsConstants,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  statSync,
  type WriteStream,
} from 'node:fs';
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
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse as parsePath,
  relative,
  resolve,
  sep,
  extname,
} from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  resolveRecordingRequest,
  validateRelativePath,
  resolveInside,
  MAX_DEPTH,
} from './recordingPath.cjs';
import { createRangeResponse } from './byteRange.cjs';
import { finalizeWebm } from './webmFinalize.cjs';
import * as log from './log.cjs';
import { normalizeAccelerator } from './accelerator.cjs';
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
  FolderEntry,
  FolderListing,
  RevealRequest,
  LibraryTab,
  ShortcutAction,
  ShortcutState,
  ShortcutSetting,
  ShortcutStatus,
  ShortcutUpdate,
  RecordingsFolder,
  RecordingsFolderUpdate,
} from '../shared/types.js';
import {
  DEFAULT_AUDIO_MODE,
  DEFAULT_QUALITY,
  isAudioMode,
  isQualityPreset,
  PLAYABLE_EXTENSIONS,
  RECORDING_SCHEME,
  DEFAULT_MIC_DEVICE,
  SCREEN_TARGET,
  isWindowSourceId,
  isRegionRect,
  DEFAULT_SHORTCUTS,
  SHORTCUT_LABELS,
  SHORTCUT_ORDER,
  acceleratorKeys,
  isShortcutAction,
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
/** The folder chosen in Settings, or null for the default. Set from settings at startup. */
let chosenRecordingsDir: string | null = null;
/**
 * A chosen folder that could not be used at startup -- a drive not connected,
 * say. Recordings go to the default meanwhile, and Settings says so. The choice
 * itself is kept, so the folder is used again once it is back.
 */
let unavailableRecordingsDir: string | null = null;

function defaultRecordingsDir(): string {
  const preferred = join(app.getPath('videos'), 'Capturio');
  // Renaming the app must not orphan recordings already made: if the new
  // folder does not exist yet but the old one does, keep using the old one.
  // Rename it in Explorer and this picks the new one up on the next launch.
  const legacy = join(app.getPath('videos'), 'ScreenRecorder');
  return !existsSync(preferred) && existsSync(legacy) ? legacy : preferred;
}

function getRecordingsDir(): string {
  if (!recordingsDir) {
    recordingsDir = chosenRecordingsDir ?? defaultRecordingsDir();
    mkdirSync(recordingsDir, { recursive: true });
  }
  return recordingsDir;
}

/**
 * Apply the stored folder choice. Must run before anything reads the folder:
 * crash recovery, the protocol and the first free-space check all do.
 *
 * A chosen folder that is missing is *not* recreated: on a drive that is not
 * connected that would fail, and on a drive that is, it may be the wrong one.
 */
function configureRecordingsDir(stored: string | null): void {
  recordingsDir = null;
  chosenRecordingsDir = null;
  unavailableRecordingsDir = null;
  if (stored === null) return;
  try {
    if (!statSync(stored).isDirectory()) throw new Error('not a folder');
    accessSync(stored, fsConstants.W_OK);
    chosenRecordingsDir = stored;
  } catch {
    unavailableRecordingsDir = stored;
    console.error('[recordings] the chosen folder is not available; saving to the default for now');
  }
}

function recordingsFolderState(): RecordingsFolder {
  return {
    path: getRecordingsDir(),
    isDefault: chosenRecordingsDir === null,
    unavailable: unavailableRecordingsDir,
  };
}

/** Why a folder cannot hold recordings, in the user's terms, or null when it can. */
async function folderProblem(folder: string): Promise<string | null> {
  if (!isAbsolute(folder)) return 'Choose a folder on this computer.';
  if (parsePath(folder).root === folder) return 'Choose a folder rather than a whole drive.';
  const own = resolve(app.getPath('userData'));
  if (folder === own || folder.startsWith(own + sep)) {
    return 'That folder holds Capturio’s own settings. Choose another.';
  }
  // Proven by writing, not by asking: permissions on Windows are too layered for
  // a mode check to be the truth.
  const probe = join(folder, `.capturio-${randomUUID()}.tmp`);
  try {
    await writeFile(probe, '');
    await unlink(probe);
  } catch {
    return 'Capturio cannot save files in that folder. Choose another.';
  }
  return null;
}

/**
 * Point new recordings somewhere else. Recordings already made are left where
 * they are: moving someone's files is not what "change folder" asks for.
 */
async function setRecordingsFolder(folder: string | null): Promise<RecordingsFolderUpdate> {
  const before = getRecordingsDir();
  const stored = folder !== null && folder === resolve(defaultRecordingsDir()) ? null : folder;
  const current = await readSettings();
  await writeSettings({ ...current, version: SETTINGS_VERSION, recordingsDir: stored });
  configureRecordingsDir(stored);
  const after = getRecordingsDir();
  if (after !== before) console.log('[recordings] folder changed');
  return { folder: recordingsFolderState(), problem: null, changed: after !== before };
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
// v4 added `shortcuts`; v5 gives each one keys plus an on/off switch and adds
// `recordingsDir`; v6 adds `tourSeen` and moves start/stop off Ctrl+Shift+R.
// Older files gain the defaults.
const SETTINGS_VERSION = 6;

/** Start/stop's keys before v6: a browser's hard reload, so no longer the default. */
const OLD_RECORD_KEYS = 'Control+Shift+R';

type Shortcuts = Record<ShortcutAction, ShortcutSetting>;

interface SettingsFile {
  version: number;
  quality: QualityPreset;
  audio: AudioMode;
  /** deviceId of the chosen microphone; '' means the Windows default. */
  micDevice: string;
  shortcuts: Shortcuts;
  /** Where new recordings go; null means the default folder under Videos. */
  recordingsDir: string | null;
  /** Whether the first-run tour of the bar has been shown. */
  tourSeen: boolean;
}

/** A deviceId is an opaque token; bound its length rather than trusting it. */
const isMicDevice = (v: unknown): v is string => typeof v === 'string' && v.length <= 512;

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json');

/**
 * Carry settings across the rename.
 *
 * `userData` is derived from the app name, so becoming Capturio moves it from
 * `.../screenrecorder` to `.../Capturio` and the stored quality, sound and
 * microphone choices would silently read as defaults. Copies the old file once,
 * and only when there is nothing at the new location to overwrite.
 */
function migrateSettingsFromOldName(): void {
  const current = settingsPath();
  if (existsSync(current)) return;
  const old = join(app.getPath('appData'), 'screenrecorder', 'settings.json');
  if (!existsSync(old)) return;
  try {
    mkdirSync(dirname(current), { recursive: true });
    copyFileSync(old, current);
    console.log('[settings] carried settings over from the previous app name');
  } catch (err) {
    console.error('[settings] could not carry settings over:', err);
  }
}

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
    shortcuts: defaultShortcuts(),
    recordingsDir: null,
    // Only a missing file is a first run. A corrupt one belongs to someone who has
    // used the app, and should not greet them with a tour.
    tourSeen: true,
  };

  let raw: string;
  try {
    raw = await readFile(settingsPath(), 'utf8');
  } catch {
    const firstRun: SettingsFile = { ...fallback, tourSeen: false };
    void writeSettings(firstRun).catch(() => undefined);
    return firstRun;
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
    shortcuts?: unknown;
    recordingsDir?: unknown;
    tourSeen?: unknown;
  };

  // Each field is validated independently, so one bad value never discards the
  // other. A v1 file has no `audio` at all -- that is a migration, not corruption.
  const quality = isQualityPreset(obj.quality) ? obj.quality : DEFAULT_QUALITY;
  const audio = isAudioMode(obj.audio) ? obj.audio : DEFAULT_AUDIO_MODE;
  const micDevice = isMicDevice(obj.micDevice) ? obj.micDevice : DEFAULT_MIC_DEVICE;
  const { shortcuts, healed: shortcutsHealed } = readShortcuts(obj.shortcuts, obj.version);
  const recordingsDir = isStoredFolder(obj.recordingsDir) ? obj.recordingsDir : null;
  const folderHealed = obj.recordingsDir !== undefined && obj.recordingsDir !== recordingsDir;
  // Absent means an install from before the tour existed: not a first run.
  const tourSeen = typeof obj.tourSeen === 'boolean' ? obj.tourSeen : true;

  if (!isQualityPreset(obj.quality)) {
    console.error(`[settings] unknown quality ${String(obj.quality)}; using ${DEFAULT_QUALITY}`);
  }
  const migrating = obj.version !== SETTINGS_VERSION;
  if (migrating) {
    console.log(`[settings] migrating v${String(obj.version)} -> v${SETTINGS_VERSION}`);
  }

  const settings: SettingsFile = {
    version: SETTINGS_VERSION,
    quality,
    audio,
    micDevice,
    shortcuts,
    recordingsDir,
    tourSeen,
  };
  // Rewrite on migration or on any rejected field, so a stale or broken file
  // heals once rather than being re-read and re-patched on every launch.
  if (
    migrating ||
    !isQualityPreset(obj.quality) ||
    !isAudioMode(obj.audio) ||
    !isMicDevice(obj.micDevice) ||
    shortcutsHealed ||
    folderHealed
  ) {
    void writeSettings(settings).catch(() => undefined);
  }
  return settings;
}

function defaultShortcuts(): Shortcuts {
  return {
    record: { ...DEFAULT_SHORTCUTS.record },
    region: { ...DEFAULT_SHORTCUTS.region },
  };
}

/**
 * Each shortcut on its own, so one bad entry never discards the other. An absent
 * field is an older file, not corruption: it gets the defaults quietly.
 */
function readShortcuts(raw: unknown, version: unknown): { shortcuts: Shortcuts; healed: boolean } {
  const shortcuts = defaultShortcuts();
  if (typeof raw !== 'object' || raw === null) return { shortcuts, healed: raw !== undefined };
  const stored = raw as Record<string, unknown>;
  let healed = false;
  for (const action of SHORTCUT_ORDER) {
    const entry = stored[action];
    // Before v5 an entry was a bare string, and its defaults had four keys, which
    // this version refuses. Those start again from the defaults.
    if (typeof entry !== 'object' || entry === null) {
      healed = true;
      continue;
    }
    const { keys, enabled } = entry as { keys?: unknown; enabled?: unknown };
    const check = normalizeAccelerator(keys);
    if (check.ok) shortcuts[action].keys = check.value;
    else healed = true;
    if (typeof enabled === 'boolean') shortcuts[action].enabled = enabled;
    else healed = true;
  }
  // Before v6, start/stop defaulted to Ctrl+Shift+R, switched off. Left exactly
  // like that it was never a choice, just the old default: move it to the new
  // one. Switched on, someone chose it, and it stays.
  const record = shortcuts.record;
  if (
    typeof version === 'number' &&
    version < 6 &&
    record.keys === OLD_RECORD_KEYS &&
    !record.enabled
  ) {
    shortcuts.record = { ...DEFAULT_SHORTCUTS.record };
    healed = true;
  }
  // Two on one combination: the later one goes back to its own default keys and
  // is switched off, rather than one press doing two things.
  const seen = new Set<string>();
  for (const action of SHORTCUT_ORDER) {
    if (seen.has(shortcuts[action].keys)) {
      console.error(`[settings] ${action} shortcut duplicated another; reset and switched off`);
      shortcuts[action] = { keys: DEFAULT_SHORTCUTS[action].keys, enabled: false };
      healed = true;
    }
    seen.add(shortcuts[action].keys);
  }
  return { shortcuts, healed };
}

/** A stored recordings folder: an absolute path of sane length, or nothing. */
const isStoredFolder = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length < 1024 && isAbsolute(v);

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
 * sibling such as ...\Capturio-elsewhere\x.mp4.
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

const isPlayable = (p: string): boolean => PLAYABLE_EXTENSIONS.includes(extname(p).toLowerCase());

/* --- Folders inside the recordings folder -------------------------------------
 *
 * Recordings used to be one flat folder. They are now the user's to organise,
 * which means the renderer names things by a path relative to the recordings
 * folder rather than by filename, and every one of those paths goes through the
 * same validator the playback protocol uses -- so a name that cannot be served
 * cannot be created either. */

/** `C:\...\Capturio\Lectures\Intro.webm` -> `Lectures/Intro.webm`. */
function relativeOf(absolutePath: string): string {
  const rel = relative(getRecordingsDir(), absolutePath);
  return rel.split(sep).join('/');
}

/** The protocol URL for a relative path. Each segment is encoded on its own,
 * or a `/` inside a name would silently become a folder boundary. */
function playbackUrlFor(relativePath: string): string {
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
  return `${RECORDING_SCHEME}://f/${encoded}`;
}

/**
 * Turn a renderer-supplied relative path into an absolute one, or fail.
 *
 * `''` means the recordings folder itself, which is legitimate for browsing and
 * as a move target, and is the only case that skips the name rules.
 */
function resolveRelative(
  channel: string,
  input: unknown,
  options: { requireExtension?: boolean } = {},
): string {
  if (typeof input !== 'string') {
    fail(channel, new Error('Path must be a string'));
  }
  const rel = input.replace(/^\/+|\/+$/g, '');
  if (rel.length === 0) {
    if (options.requireExtension) fail(channel, new Error('No recording named'));
    return resolve(getRecordingsDir());
  }
  const valid = validateRelativePath(rel, options);
  if (!valid.ok) fail(channel, new Error(valid.reason));
  const inside = resolveInside(valid.segments, getRecordingsDir());
  if (!inside.ok) fail(channel, new Error(inside.reason));
  return inside.filePath;
}

/** Recordings, bytes and newest time inside a folder, counted through nesting. */
async function folderTotals(
  dir: string,
  depth = 0,
): Promise<{ count: number; size: number; newest: number }> {
  const totals = { count: 0, size: 0, newest: 0 };
  // The validator caps creatable depth; this cap is for folders that arrived
  // some other way, so a symlink loop cannot hang the listing.
  if (depth > MAX_DEPTH) return totals;

  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await folderTotals(full, depth + 1);
      totals.count += sub.count;
      totals.size += sub.size;
      totals.newest = Math.max(totals.newest, sub.newest);
    } else if (entry.isFile() && isPlayable(entry.name)) {
      const info = await stat(full).catch(() => null);
      if (!info) continue;
      totals.count += 1;
      totals.size += info.size;
      totals.newest = Math.max(totals.newest, info.mtimeMs);
    }
  }
  return totals;
}

/** Every folder under the recordings folder, flattened and depth-first. */
async function allFolders(relativeDir = '', depth = 0): Promise<FolderEntry[]> {
  if (depth > MAX_DEPTH) return [];
  const dir = relativeDir
    ? join(getRecordingsDir(), ...relativeDir.split('/'))
    : getRecordingsDir();
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: FolderEntry[] = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort(byName)) {
    const path = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const totals = await folderTotals(join(dir, entry.name), depth + 1);
    out.push({
      name: entry.name,
      path,
      itemCount: totals.count,
      sizeBytes: totals.size,
      modifiedAt: new Date(totals.newest || Date.now()).toISOString(),
    });
    out.push(...(await allFolders(path, depth + 1)));
  }
  return out;
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** Every recording at or below a folder, as library items. Unsorted. */
async function collectRecordings(relativeDir: string, depth = 0): Promise<RecordingListItem[]> {
  if (depth > MAX_DEPTH) return [];
  const dir = relativeDir
    ? join(getRecordingsDir(), ...relativeDir.split('/'))
    : getRecordingsDir();
  // A missing folder is an empty library, not an error (AC-2).
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: RecordingListItem[] = [];
  for (const entry of entries) {
    const rel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await collectRecordings(rel, depth + 1)));
      continue;
    }
    // .part files are in-flight or unrecovered, not library content.
    if (!entry.isFile() || !isPlayable(entry.name)) continue;
    const full = join(dir, entry.name);
    const info = await stat(full).catch(() => null);
    // Vanished between readdir and stat. Skip it rather than fail the list.
    if (!info) continue;
    out.push({
      fileName: entry.name,
      filePath: full,
      relativePath: rel,
      playbackUrl: playbackUrlFor(rel),
      modifiedAt: info.mtime.toISOString(),
      sizeBytes: info.size,
    });
  }
  return out;
}

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

  /**
   * Show a recording in the recordings window: its folder, selected, playing if
   * asked.
   *
   * The saved-recording card used to hand these off to Windows — Explorer for
   * "show in folder", the default player for "open". Both belong in the app: it
   * has a folder view and a player of its own, and sending someone out to
   * another program to look at what they just recorded is the long way round.
   *
   * A window that is still loading cannot be told anything, and the renderer's
   * listener is not attached until React has mounted. So the request is *left*
   * for the window to collect on mount, and only sent as an event when there is
   * a loaded window already there to receive it.
   */
  ipcMain.handle('library:reveal', (_e, filePath: unknown, play: unknown): void => {
    const target = resolveInsideRecordings('library:reveal', filePath);
    const request: RevealRequest = { relativePath: relativeOf(target), play: play === true };
    // The recordings view as well as the recording: the window may have been
    // left on Settings, where selecting a file would be invisible.
    tellLibrary('library:tab', 'recordings' as LibraryTab, (held) => (pendingTab = held));
    tellLibrary('library:show', request, (held) => (pendingReveal = held));
  });

  ipcMain.handle('library:open-at', (_e, tab: unknown): void => {
    const wanted: LibraryTab =
      tab === 'settings' || tab === 'help' || tab === 'recordings' ? tab : 'recordings';
    tellLibrary('library:tab', wanted, (held) => (pendingTab = held));
  });

  ipcMain.handle('library:take-pending-tab', (): LibraryTab | null => {
    const tab = pendingTab;
    pendingTab = null;
    return tab;
  });

  ipcMain.handle('library:take-pending', (): RevealRequest | null => {
    const request = pendingReveal;
    pendingReveal = null;
    return request;
  });

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

  ipcMain.handle('bar:show', (): void => {
    // The way back from the recordings window. Without it, browsing recordings
    // was a dead end: nothing on screen led back to recording.
    if (!barWindow || barWindow.isDestroyed()) createBar();
    else {
      barWindow.show();
      barWindow.focus();
    }
    trayRefresh?.();
  });

  // The tour happens on the bar, so the bar comes forward even when hidden.
  // Held for collection when the bar is still loading, for the same reason as
  // tellLibrary: a window being created has no listener yet.
  ipcMain.handle('tour:start', (): void => {
    const listening = barWindow && !barWindow.isDestroyed() && !barWindow.webContents.isLoading();
    createBar();
    if (listening && barWindow) {
      pendingTour = false;
      barWindow.webContents.send('tour:show');
    } else {
      pendingTour = true;
    }
    trayRefresh?.();
  });

  ipcMain.handle('tour:take-pending', (): boolean => {
    const asked = pendingTour;
    pendingTour = false;
    return asked;
  });

  ipcMain.handle('bar:hide', (): void => {
    barWindow?.hide();
    trayRefresh?.();
  });

  ipcMain.handle('region:select', (): Promise<RegionRect | null> => selectRegion());

  ipcMain.handle('shortcuts:get', (): ShortcutStatus[] => shortcutStatuses());
  ipcMain.handle('shortcuts:set', (_e, action: unknown, change: unknown): Promise<ShortcutUpdate> =>
    setShortcut(action, change),
  );
  ipcMain.on('shortcuts:suspend', (_e, suspended: unknown) => suspendShortcuts(suspended === true));

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

  ipcMain.handle(
    'settings:get-audio',
    async (): Promise<AudioMode> => (await readSettings()).audio,
  );

  ipcMain.handle('settings:get-mic', async (): Promise<string> => (await readSettings()).micDevice);

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

  ipcMain.handle('recordings:folder', (): RecordingsFolder => recordingsFolderState());

  ipcMain.handle('recordings:choose-folder', async (): Promise<RecordingsFolderUpdate> => {
    const unchanged = (problem: string | null): RecordingsFolderUpdate => ({
      folder: recordingsFolderState(),
      problem,
      changed: false,
    });
    // A recording in progress is writing into the current folder.
    if (active.size > 0) return unchanged('Finish the current recording first.');
    const options: Electron.OpenDialogOptions = {
      title: 'Choose where recordings are saved',
      defaultPath: getRecordingsDir(),
      properties: ['openDirectory', 'createDirectory'],
    };
    const parent = libraryWindow && !libraryWindow.isDestroyed() ? libraryWindow : null;
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    const picked = result.filePaths[0];
    if (result.canceled || !picked) return unchanged(null);
    const folder = resolve(picked);
    const problem = await folderProblem(folder);
    if (problem) return unchanged(problem);
    try {
      return await setRecordingsFolder(folder);
    } catch (err) {
      fail('recordings:choose-folder', err);
    }
  });

  ipcMain.handle('recordings:default-folder', async (): Promise<RecordingsFolderUpdate> => {
    if (active.size > 0) {
      return {
        folder: recordingsFolderState(),
        problem: 'Finish the current recording first.',
        changed: false,
      };
    }
    try {
      return await setRecordingsFolder(null);
    } catch (err) {
      fail('recordings:default-folder', err);
    }
  });

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
   * Every recording, through subfolders, newest first.
   *
   * No index: a file added or removed outside the app shows up on the next read,
   * and there is nothing to migrate or repair. The folder UI reads one level at
   * a time through `recordings:browse`; this flat view is what anything wanting
   * "the newest recording" should ask for.
   */
  ipcMain.handle('recordings:list', async (): Promise<RecordingListItem[]> => {
    const items = await collectRecordings('');
    // Modified time, not birth time: a recovered recording was renamed from .part,
    // so its birth time predates the content while mtime reflects when it finished.
    items.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return items;
  });

  /**
   * One folder's contents: what the recordings window shows at a given level.
   *
   * Folders first and alphabetical, recordings newest first -- folders are a
   * place you are looking for, recordings are something you just made.
   */
  ipcMain.handle('recordings:browse', async (_e, relativeDir: unknown): Promise<FolderListing> => {
    const dir = resolveRelative('recordings:browse', relativeDir ?? '');
    const rel = dir === resolve(getRecordingsDir()) ? '' : relativeOf(dir);

    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (entries === null) {
      // A missing folder is an empty listing, not an error (AC-2). It also
      // happens when a folder is deleted in Explorer while the UI sits in it.
      return {
        path: rel,
        name: rel ? (rel.split('/').pop() ?? rel) : basename(getRecordingsDir()),
        folders: [],
        files: [],
      };
    }

    const folders: FolderEntry[] = [];
    const files: RecordingListItem[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const totals = await folderTotals(full);
        folders.push({
          name: entry.name,
          path: rel ? `${rel}/${entry.name}` : entry.name,
          itemCount: totals.count,
          sizeBytes: totals.size,
          modifiedAt: new Date(totals.newest || Date.now()).toISOString(),
        });
        continue;
      }
      // .part files are in-flight or unrecovered, not library content.
      if (!entry.isFile() || !isPlayable(entry.name)) continue;
      const info = await stat(full).catch(() => null);
      // Vanished between readdir and stat. Skip it rather than fail the listing.
      if (!info) continue;
      const relativePath = rel ? `${rel}/${entry.name}` : entry.name;
      files.push({
        fileName: entry.name,
        filePath: full,
        relativePath,
        playbackUrl: playbackUrlFor(relativePath),
        modifiedAt: info.mtime.toISOString(),
        sizeBytes: info.size,
      });
    }

    folders.sort(byName);
    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    return {
      path: rel,
      name: rel ? (rel.split('/').pop() ?? rel) : basename(getRecordingsDir()),
      folders,
      files,
    };
  });

  ipcMain.handle('recordings:folders', (): Promise<FolderEntry[]> => allFolders());

  ipcMain.handle(
    'recordings:create-folder',
    async (_e, parent: unknown, name: unknown): Promise<string> => {
      if (typeof name !== 'string' || name.trim().length === 0) {
        fail('recordings:create-folder', new Error('Give the folder a name'));
      }
      const parentRel = typeof parent === 'string' ? parent.replace(/^\/+|\/+$/g, '') : '';
      // Joined and validated as one path, so a name containing a separator is
      // refused rather than quietly creating two levels.
      const rel = parentRel ? `${parentRel}/${name.trim()}` : name.trim();
      const target = resolveRelative('recordings:create-folder', rel);
      if (existsSync(target)) {
        fail(
          'recordings:create-folder',
          new Error(`There is already something called "${name}" here`),
        );
      }
      try {
        mkdirSync(target, { recursive: true });
      } catch (err) {
        fail('recordings:create-folder', err);
      }
      return relativeOf(target);
    },
  );

  /**
   * Move a recording into a folder.
   *
   * Never overwrites, and never touches a recording being written -- the same
   * two rules the delete handler lives by, for the same reasons.
   */
  ipcMain.handle(
    'recordings:move',
    async (_e, filePath: unknown, targetDir: unknown): Promise<string> => {
      const source = resolveInsideRecordings('recordings:move', filePath);
      const dir = resolveRelative('recordings:move', targetDir ?? '');
      for (const rec of active.values()) {
        if (resolve(rec.finalPath) === source || resolve(rec.partPath) === source) {
          fail('recordings:move', new Error('That recording is still being written'));
        }
      }
      if (!existsSync(dir)) {
        fail('recordings:move', new Error('That folder is gone'));
      }
      const destination = join(dir, basename(source));
      if (destination === source) return source;
      if (existsSync(destination)) {
        fail('recordings:move', new Error('A recording with that name is already in that folder'));
      }
      try {
        await rename(source, destination);
      } catch (err) {
        fail('recordings:move', err);
      }
      return destination;
    },
  );

  /**
   * Delete a folder, with whatever is inside it, to the Recycle Bin.
   *
   * Recoverable only. A folder holds recordings that cannot be remade, so this
   * never falls back to a real delete when the Recycle Bin refuses -- the same
   * rule, for the same reason, as deleting a single recording.
   */
  ipcMain.handle('recordings:delete-folder', async (_e, relativeDir: unknown): Promise<void> => {
    const dir = resolveRelative('recordings:delete-folder', relativeDir ?? '');
    if (dir === resolve(getRecordingsDir())) {
      fail('recordings:delete-folder', new Error('The recordings folder itself cannot be deleted'));
    }
    // A recording is written at the top level, but it can be moved, and this
    // handler is callable whatever the UI happens to offer.
    for (const rec of active.values()) {
      const inside = (p: string): boolean => resolve(p).startsWith(dir + sep);
      if (inside(rec.finalPath) || inside(rec.partPath)) {
        fail(
          'recordings:delete-folder',
          new Error('A recording in that folder is still being written'),
        );
      }
    }
    try {
      await shell.trashItem(dir);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      fail(
        'recordings:delete-folder',
        new Error(
          `Could not move that folder to the Recycle Bin (${detail}). It was left in place.`,
        ),
      );
    }
  });

  ipcMain.handle('recordings:reveal-folder', (_e, relativeDir: unknown): void => {
    const dir = resolveRelative('recordings:reveal-folder', relativeDir ?? '');
    // openPath rather than showItemInFolder: this opens the folder itself,
    // where showItemInFolder would open its parent with it selected.
    void shell.openPath(dir);
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

  // Before the overlay, not after the recording starts: a region is dragged out
  // over whatever is on screen, and the recordings window sitting in the middle
  // of it would be part of what there is to choose from.
  hideLibrary();

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
  tray.setToolTip('Capturio');

  trayRefresh = (): void => {
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: barWindow?.isVisible() ? 'Hide the bar' : 'Show the bar',
          click: () => toggleBar(),
        },
        {
          label: recordingNow ? 'Stop recording' : 'Start recording',
          ...shownShortcut('record'),
          // The bar decides what this means -- it holds the recorder and knows
          // what is currently selected.
          click: () => barWindow?.webContents.send('hud:command', 'toggle'),
        },
        { type: 'separator' },
        { label: 'Recordings', click: () => openLibrary() },
        { type: 'separator' },
        { label: 'Quit Capturio', click: () => app.quit() },
      ]),
    );
  };

  trayRefresh();
  // A single click is the gesture people expect from a tray icon.
  tray.on('click', () => toggleBar());
}

/* ---------------------------------------------------------------- shortcuts */

/**
 * What each global shortcut does. The bar decides what "start or stop" means,
 * since only it knows what is selected to record.
 */
const SHORTCUT_HANDLERS: Record<ShortcutAction, () => void> = {
  record: () => barWindow?.webContents.send('hud:command', 'toggle'),
  region: () => barWindow?.webContents.send('hud:command', 'record-region'),
};

let shortcuts: Shortcuts = defaultShortcuts();
const shortcutStates: Record<ShortcutAction, ShortcutState> = { record: 'off', region: 'off' };
/** True while Settings is listening for a new combination. */
let shortcutsSuspended = false;

const keysOf = (accelerator: string): string => acceleratorKeys(accelerator).join('+');

/**
 * Register every shortcut that is switched on, from scratch, and record what
 * really happened.
 *
 * `register` returns false when Windows or another program already holds the
 * combination. That is reported as `taken`, never displayed as working: a
 * shortcut that silently does nothing is the failure this list exists to avoid.
 */
function applyShortcuts(): void {
  globalShortcut.unregisterAll();
  for (const action of SHORTCUT_ORDER) {
    const { keys, enabled } = shortcuts[action];
    if (!enabled) {
      shortcutStates[action] = 'off';
      continue;
    }
    // Suspended: the state still describes what comes back afterwards.
    if (shortcutsSuspended) continue;
    const ok = globalShortcut.register(keys, SHORTCUT_HANDLERS[action]);
    if (!ok && shortcutStates[action] !== 'taken') {
      console.error(
        `[shortcut] ${keysOf(keys)} is taken; "${SHORTCUT_LABELS[action]}" will not work until another is chosen`,
      );
    }
    shortcutStates[action] = ok ? 'on' : 'taken';
  }
  trayRefresh?.();
}

function shortcutStatuses(): ShortcutStatus[] {
  return SHORTCUT_ORDER.map((action) => ({
    action,
    accelerator: shortcuts[action].keys,
    enabled: shortcuts[action].enabled,
    state: shortcutStates[action],
  }));
}

/** Shown beside a tray item only when pressing it would actually work. */
function shownShortcut(action: ShortcutAction): {
  accelerator?: string;
  registerAccelerator?: boolean;
} {
  return shortcutStates[action] === 'on'
    ? { accelerator: shortcuts[action].keys, registerAccelerator: false }
    : {};
}

function suspendShortcuts(suspended: boolean): void {
  if (shortcutsSuspended === suspended) return;
  shortcutsSuspended = suspended;
  applyShortcuts();
}

/** Why the validator refused, in the terms of the person pressing keys. */
function acceleratorProblem(reason: string): string {
  if (reason === 'needs Ctrl, Alt or Win') {
    return 'Add Ctrl, Alt or Win. On its own that key would stop working in every other program.';
  }
  if (reason === 'more than three keys') return 'Use three keys at most, such as Win + Shift + Q.';
  if (reason === 'unknown key') {
    return 'That key cannot be used. Letters, numbers, F1–F24 and the arrow and page keys can.';
  }
  return 'That combination cannot be used.';
}

/**
 * Change one shortcut's keys, switch it on or off, or both.
 *
 * A combination about to be registered is *probed* first: if Windows or another
 * program holds it, nothing changes and the page is told why.
 *
 * Choosing a combination is the end of listening for one, so this also lifts the
 * suspension -- on every path, refusals included, or a refused choice would
 * leave every shortcut switched off behind it.
 */
async function setShortcut(action: unknown, change: unknown): Promise<ShortcutUpdate> {
  shortcutsSuspended = false;
  if (!isShortcutAction(action) || typeof change !== 'object' || change === null) {
    applyShortcuts();
    fail('shortcuts:set', new Error(`Bad shortcut change for ${String(action)}`));
  }
  const refuse = (problem: string): ShortcutUpdate => {
    applyShortcuts();
    return { shortcuts: shortcutStatuses(), problem };
  };

  const current = shortcuts[action];
  const asked = change as { keys?: unknown; enabled?: unknown };
  let keys = current.keys;
  if (asked.keys !== undefined) {
    const check = normalizeAccelerator(asked.keys);
    if (!check.ok) return refuse(acceleratorProblem(check.reason));
    keys = check.value;
  }
  const enabled = typeof asked.enabled === 'boolean' ? asked.enabled : current.enabled;

  const clash = SHORTCUT_ORDER.find((other) => other !== action && shortcuts[other].keys === keys);
  if (clash) return refuse(`${keysOf(keys)} is already set for “${SHORTCUT_LABELS[clash]}”.`);

  if (enabled && (keys !== current.keys || !current.enabled)) {
    // Our own registrations go first, or one of them would look like the thief.
    globalShortcut.unregisterAll();
    const free = globalShortcut.register(keys, () => undefined);
    if (free) globalShortcut.unregister(keys);
    if (!free) {
      return refuse(
        `${keysOf(keys)} is already used by Windows or another program. Choose another.`,
      );
    }
  }

  const next: Shortcuts = { ...shortcuts, [action]: { keys, enabled } };
  try {
    const stored = await readSettings();
    await writeSettings({ ...stored, version: SETTINGS_VERSION, shortcuts: next });
  } catch (err) {
    applyShortcuts();
    fail('shortcuts:set', err);
  }
  shortcuts = next;
  applyShortcuts();
  return { shortcuts: shortcutStatuses(), problem: null };
}

/* ---------------------------------------------------------------------- bar */

let barWindow: BrowserWindow | null = null;
let libraryWindow: BrowserWindow | null = null;

/**
 * A "show me this recording" request waiting to be collected.
 *
 * Held rather than sent when the window is being created for it: the renderer's
 * listener does not exist until React has mounted, and an event sent before that
 * goes nowhere.
 */
let pendingReveal: RevealRequest | null = null;
let pendingTab: LibraryTab | null = null;
let pendingTour = false;

/**
 * Say something to the recordings window, opening it if it is not there.
 *
 * A window being created cannot be told anything: the renderer's listener does
 * not exist until React has mounted, and `did-finish-load` is no guarantee of
 * that. So the message is *held* for the window to collect on mount, and only
 * sent as an event when a loaded window is already listening.
 */
function tellLibrary<T>(channel: string, payload: T, hold: (held: T | null) => void): void {
  const listening =
    libraryWindow && !libraryWindow.isDestroyed() && !libraryWindow.webContents.isLoading();
  openLibrary();
  if (listening && libraryWindow) {
    libraryWindow.webContents.send(channel, payload);
    hold(null);
  } else {
    hold(payload);
  }
}

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
    title: 'Capturio',
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
      // The recordings window is the one window capture can see. It goes away
      // for the duration, and the bar's library button brings it back.
      if (recordingNow) hideLibrary();
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
    suspendShortcuts(false);
  });
  // Settings suspends every shortcut while it listens for a new one. The page
  // resumes them itself; these are the guarantee for a page that never does.
  win.on('blur', () => suspendShortcuts(false));
  win.on('hide', () => suspendShortcuts(false));

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
    // It may be hidden rather than closed, since recording hides it, and neither
    // restore() nor focus() brings a hidden window back.
    libraryWindow.webContents.setAudioMuted(false);
    if (libraryWindow.isMinimized()) libraryWindow.restore();
    if (!libraryWindow.isVisible()) libraryWindow.show();
    libraryWindow.focus();
    return;
  }
  createLibraryWindow();
}

/**
 * Get the recordings window out of the way of a recording.
 *
 * Not tidiness. Every always-on-top window here is excluded from capture, but
 * this one is an ordinary window and cannot be: left open it would be filmed,
 * and a recorder that films its own library is worse than one with no library.
 *
 * Playback stops too. A hidden window keeps playing, so the recording someone
 * was watching would be heard inside the one they just started.
 *
 * It is not brought back afterwards: a window appearing by itself the moment a
 * recording stops is the interruption this bar exists to avoid. The bar's
 * library button is the way back.
 */
function hideLibrary(): void {
  if (!libraryWindow || libraryWindow.isDestroyed() || !libraryWindow.isVisible()) return;
  libraryWindow.webContents.send('library:suspend');
  // The pause is what the user sees; the mute is the guarantee, because a
  // renderer that never received that message must still be silent in the file.
  libraryWindow.webContents.setAudioMuted(true);
  libraryWindow.hide();
}

// One recorder at a time. A second launch -- from the Start menu, say, while the
// bar is hidden -- is someone looking for the bar, so the running app brings it
// back and the new process leaves before it has touched anything.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

app.on('second-instance', () => {
  console.log('[app] launched again; bringing the bar back');
  createBar();
  trayRefresh?.();
});

// Before anything else: from here on, whatever the app reports also lands on
// disk. Errors during startup are exactly the ones with no console present.
if (primaryInstance) log.start(join(app.getPath('userData'), 'logs'));

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  migrateSettingsFromOldName();
  // First, because the recordings folder may be the user's choice, and crash
  // recovery, the protocol and the bar's first free-space check all read it.
  const settings = await readSettings();
  configureRecordingsDir(settings.recordingsDir);
  shortcuts = settings.shortcuts;
  // A fresh install opens with the tour of the bar, once. The bar collects it on
  // mount; it is marked seen now, so closing the app mid-tour does not repeat it.
  if (!settings.tourSeen) {
    pendingTour = true;
    void writeSettings({ ...settings, tourSeen: true }).catch(() => undefined);
  }

  registerDisplayMediaHandler();
  registerRecordingProtocol();
  registerIpc();
  registerHudRelay();
  // Reclaim anything a previous crash left behind, before a new recording starts.
  void recoverOrphanedParts();
  void pruneThumbs();
  createBar();
  // From launch, not on first use: hiding the bar is only safe because the tray
  // can bring it back.
  createTray();

  // Reach the recorder without reaching for the bar, which is the point of a
  // hotkey on a recorder: the moment worth capturing rarely waits.
  applyShortcuts();

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
