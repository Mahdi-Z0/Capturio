import {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  net,
  protocol,
  screen,
  session,
  shell,
} from 'electron';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { stat, rename, unlink, readdir, access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolveRecordingRequest } from './recordingPath.cjs';
import type {
  CaptureSource,
  DisplayInfo,
  QualityPreset,
  Recording,
  RecordingListItem,
} from '../shared/types.js';
import {
  DEFAULT_QUALITY,
  isQualityPreset,
  PLAYABLE_EXTENSIONS,
  RECORDING_SCHEME,
} from '../shared/types.js';

/**
 * Privileged scheme registration MUST happen before app ready.
 * `stream: true` enables range requests, without which seeking in a long
 * recording does not work; `supportFetchAPI` lets the handler use net.fetch.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: RECORDING_SCHEME,
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
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
        await rename(partPath, target);
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

const SETTINGS_VERSION = 1;

interface SettingsFile {
  version: number;
  quality: QualityPreset;
}

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
async function readQuality(): Promise<QualityPreset> {
  let raw: string;
  try {
    raw = await readFile(settingsPath(), 'utf8');
  } catch {
    void writeSettings({ version: SETTINGS_VERSION, quality: DEFAULT_QUALITY }).catch(() => undefined);
    return DEFAULT_QUALITY;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const quality = (parsed as { quality?: unknown } | null)?.quality;
    if (isQualityPreset(quality)) return quality;
    console.error(`[settings] unknown quality ${String(quality)}; resetting to ${DEFAULT_QUALITY}`);
  } catch {
    console.error('[settings] unparseable settings.json; resetting to defaults');
  }
  void writeSettings({ version: SETTINGS_VERSION, quality: DEFAULT_QUALITY }).catch(() => undefined);
  return DEFAULT_QUALITY;
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

    try {
      await access(decision.filePath);
    } catch {
      console.error(`[${RECORDING_SCHEME}] no such recording: ${decision.fileName}`);
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(decision.filePath).toString());
  });
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

function registerDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const source = pickPrimaryScreen(sources);
        if (!source) {
          console.error('[displayMedia] no screen sources available');
          // Reject rather than hang, so the renderer can return to idle.
          callback({});
          return;
        }
        // Audio stays out of this phase entirely.
        callback({ video: source, audio: undefined });
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
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnailDataUrl: s.thumbnail.toDataURL(),
    }));
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

  ipcMain.handle('settings:get-quality', (): Promise<QualityPreset> => readQuality());

  ipcMain.handle('settings:set-quality', async (_e, preset: unknown): Promise<void> => {
    if (!isQualityPreset(preset)) {
      fail('settings:set-quality', new Error(`Unknown quality preset: ${String(preset)}`));
    }
    try {
      await writeSettings({ version: SETTINGS_VERSION, quality: preset });
    } catch (err) {
      fail('settings:set-quality', err);
    }
  });

  ipcMain.handle('recordings:dir', () => getRecordingsDir());

  ipcMain.handle('recordings:begin', async (_e, ext: unknown): Promise<string> => {
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
      // The rename is what makes this atomic. Until it lands, a crash leaves a
      // .part file rather than a truncated file wearing a valid name.
      await rename(rec.partPath, rec.finalPath);
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

// --- Window --------------------------------------------------------------------

function createWindow(): void {
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

  win.on('ready-to-show', () => win.show());

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

app.whenReady().then(() => {
  registerDisplayMediaHandler();
  registerRecordingProtocol();
  registerIpc();
  // Reclaim anything a previous crash left behind, before a new recording starts.
  void recoverOrphanedParts();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

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
        await rename(rec.partPath, rec.finalPath);
      } catch (err) {
        console.error('[before-quit] failed to finalize recording:', err);
      }
    }),
  ).finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
