/** Shared IPC contract between main and renderer. Keep this the single source of truth. */

export type CaptureKind = 'screen' | 'window';

export interface CaptureSource {
  id: string;
  name: string;
  kind: CaptureKind;
  thumbnailDataUrl: string;
}

/**
 * What the next recording captures.
 *
 * Not persisted: a window id is only meaningful for as long as that window
 * exists, so restoring one across restarts would point at nothing.
 */
export type CaptureTarget =
  | { kind: 'screen' }
  | { kind: 'window'; id: string; name: string }
  | { kind: 'region'; rect: RegionRect };

/**
 * A screen region, in display-independent points relative to the primary
 * display's top-left -- the same units `screen.getPrimaryDisplay().bounds` uses.
 *
 * Not pixels: the capture is in physical pixels and the selector window works in
 * points, so one of them has to be converted, and points are what both Electron
 * and the DOM hand us.
 */
export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Smaller than this and a drag was a stray click, not a selection. */
export const MIN_REGION_SIZE = 16;

/** Warn below this much free space; main refuses below 300 MB. */
export const LOW_SPACE_BYTES = 2 * 1024 * 1024 * 1024;

export function isRegionRect(v: unknown): v is RegionRect {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    ['x', 'y', 'width', 'height'].every((k) => typeof r[k] === 'number' && Number.isFinite(r[k])) &&
    (r.width as number) >= MIN_REGION_SIZE &&
    (r.height as number) >= MIN_REGION_SIZE
  );
}

export const SCREEN_TARGET: CaptureTarget = { kind: 'screen' };

/** desktopCapturer window ids look like `window:394124:1`. */
export function isWindowSourceId(v: unknown): v is string {
  return typeof v === 'string' && /^window:\d+:\d+$/.test(v);
}

/**
 * A recording that has been fully written and renamed into place.
 * Only fields the code actually populates are declared here — a field that is
 * never set is a lie the type system will happily repeat.
 */
export interface Recording {
  fileName: string;
  filePath: string;
  createdAt: string;
  sizeBytes: number;
}

/**
 * A recording as the library sees it.
 *
 * Separate from `Recording` (what the save path returns) because the library adds
 * fields the save path never sets: `modifiedAt` is the sort key, and `playbackUrl`
 * is a custom-protocol URL rather than a filesystem path. Duration is absent here
 * on purpose -- `stat` cannot supply it, so the renderer fills it in later.
 */
export interface RecordingListItem {
  fileName: string;
  filePath: string;
  /**
   * Where it sits under the recordings folder, `/`-separated — `Intro.webm` at
   * the top, `Lectures/Intro.webm` in a subfolder. This, not the absolute path,
   * is what the folder UI and the move action work in.
   */
  relativePath: string;
  /** Custom-protocol URL. The renderer CSP forbids file://, so never build one. */
  playbackUrl: string;
  modifiedAt: string;
  sizeBytes: number;
}

/** A subfolder of the recordings folder, as the library shows it. */
export interface FolderEntry {
  name: string;
  /** Relative to the recordings folder, `/`-separated. `''` is the folder itself. */
  path: string;
  /** Recordings inside, counted through nested folders. */
  itemCount: number;
  sizeBytes: number;
  /** Newest recording inside, or the folder's own time when it is empty. */
  modifiedAt: string;
}

/**
 * "Show me this recording": the bar's saved card asking the recordings window to
 * go to a recording, rather than handing it to Explorer or another player.
 */
export interface RevealRequest {
  /** Relative to the recordings folder, `/`-separated. */
  relativePath: string;
  /** Start playing it, rather than only selecting it. */
  play: boolean;
}

/** One folder's contents: what the recordings window shows at a given level. */
export interface FolderListing {
  /** Relative to the recordings folder; `''` is the folder itself. */
  path: string;
  /** What to call this level on screen. */
  name: string;
  folders: FolderEntry[];
  files: RecordingListItem[];
}

/** Extensions the library lists and the protocol handler is willing to serve. */
export const PLAYABLE_EXTENSIONS: readonly string[] = ['.webm', '.mp4'];

/** Scheme used to stream recordings to the renderer without loosening the CSP. */
export const RECORDING_SCHEME = 'recording';

/**
 * Recording quality presets.
 *
 * Values come from the 01-02 capture benchmark, not from guesswork:
 * 60 fps roughly halves interval jitter versus 30 (5.4 ms vs 8.4 ms), and VP9
 * honours `videoBitsPerSecond` where H.264 ignores it.
 *
 * Each preset pairs a frame rate with a bitrate that suits it, so there is no way
 * to select a combination that wastes bits on a frame rate that judders.
 */
export type QualityPreset = 'balanced' | 'high' | 'maximum';

export interface QualityPresetSpec {
  label: string;
  /** What choosing this actually costs or gains, in the user's terms. */
  blurb: string;
  frameRate: number;
  videoBitsPerSecond: number;
  recommended?: boolean;
}

export const QUALITY_PRESETS: Record<QualityPreset, QualityPresetSpec> = {
  balanced: {
    label: 'Balanced',
    // Must name the motion cost. 30 fps is the setting whose jitter caused the
    // "snapping" complaint; labelling it only "smaller files" would hand back a
    // fixed bug with no hint of the tradeoff.
    blurb: 'Smaller files, but motion is less smooth',
    frameRate: 30,
    videoBitsPerSecond: 8_000_000,
  },
  high: {
    label: 'High',
    blurb: 'Smooth motion, sensible file size',
    frameRate: 60,
    videoBitsPerSecond: 20_000_000,
    recommended: true,
  },
  maximum: {
    label: 'Maximum',
    blurb: 'Best quality, large files',
    frameRate: 60,
    videoBitsPerSecond: 40_000_000,
  },
};

export const DEFAULT_QUALITY: QualityPreset = 'high';

/**
 * What sound, if any, is recorded alongside the picture.
 *
 * `both` is a Web Audio mix, not two tracks: MediaRecorder silently records only
 * the first audio track it is given, so two tracks would drop one without error.
 */
export type AudioMode = 'none' | 'system' | 'microphone' | 'both';

export interface AudioModeSpec {
  label: string;
  blurb: string;
  /** Which sources this mode draws on. Drives capture, the footer and warnings. */
  system: boolean;
  microphone: boolean;
}

export const AUDIO_MODES: Record<AudioMode, AudioModeSpec> = {
  none: {
    label: 'No audio',
    blurb: 'Picture only',
    system: false,
    microphone: false,
  },
  system: {
    label: 'Computer audio',
    // Names what is captured, not the mechanism. "WASAPI loopback" means
    // nothing to the person choosing.
    blurb: 'Whatever your computer is playing',
    system: true,
    microphone: false,
  },
  microphone: {
    label: 'Microphone',
    blurb: 'Your voice, nothing from the computer',
    system: false,
    microphone: true,
  },
  both: {
    label: 'Computer and microphone',
    blurb: 'Talk over whatever is playing',
    system: true,
    microphone: true,
  },
};

/** Display order in the picker: a 2x2 grid reading none/system, mic/both. */
export const AUDIO_ORDER: AudioMode[] = ['none', 'system', 'microphone', 'both'];

/** Empty string means "whatever Windows has set as the default microphone". */
export const DEFAULT_MIC_DEVICE = '';

/** Matches today's behaviour, so existing recordings do not silently change. */
export const DEFAULT_AUDIO_MODE: AudioMode = 'none';

const MIC_PRIVACY_HINT =
  'Check that microphone access is on in Windows Settings > Privacy & security > Microphone.';

/**
 * What to tell the user when some requested audio did not arrive, or null when
 * everything asked for was obtained.
 *
 * Names the source that failed and what the recording carries instead. Never an
 * apology, and never implies the recording failed -- the picture is fine.
 */
export function audioShortfallNote(
  requested: { system: boolean; microphone: boolean },
  obtained: { system: boolean; microphone: boolean },
): string | null {
  const lostSystem = requested.system && !obtained.system;
  const lostMic = requested.microphone && !obtained.microphone;
  if (!lostSystem && !lostMic) return null;

  if (lostSystem && lostMic) {
    return `No audio could be captured. Recording video only. ${MIC_PRIVACY_HINT}`;
  }
  if (lostSystem) {
    return obtained.microphone
      ? 'Computer audio could not be captured. Recording the microphone only.'
      : 'Computer audio could not be captured. Recording video only.';
  }
  return obtained.system
    ? `The microphone could not be used. Recording computer audio only. ${MIC_PRIVACY_HINT}`
    : `The microphone could not be used. Recording video only. ${MIC_PRIVACY_HINT}`;
}

export function isAudioMode(v: unknown): v is AudioMode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(AUDIO_MODES, v);
}

export function isQualityPreset(v: unknown): v is QualityPreset {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(QUALITY_PRESETS, v);
}

/** Primary display measured in physical pixels, so capture is not downscaled on HiDPI. */
export interface DisplayInfo {
  width: number;
  height: number;
  scaleFactor: number;
}

/**
 * What the overlay indicator shows while a recording runs.
 *
 * Pushed from the recorder to the overlay through main, rather than the overlay
 * asking: the recorder is the only place that knows the truth, and a poller would
 * show a stale timer at exactly the moment someone is deciding whether to stop.
 */
export interface HudState {
  recording: boolean;
  paused: boolean;
  elapsedMs: number;
  /** Whether an audio track exists at all -- not what was requested. */
  hasAudio: boolean;
  muted: boolean;
}

export const IDLE_HUD_STATE: HudState = {
  recording: false,
  paused: false,
  elapsedMs: 0,
  hasAudio: false,
  muted: false,
};

/**
 * Commands the bar can receive from main -- today only the global hotkey.
 * 'toggle' means start or stop, whichever applies.
 */
export type HudCommand = 'toggle' | 'stop' | 'pause' | 'resume' | 'toggle-mute';

export function isHudCommand(v: unknown): v is HudCommand {
  return (
    v === 'toggle' || v === 'stop' || v === 'pause' || v === 'resume' || v === 'toggle-mute'
  );
}

/**
 * Exposed on window.api by the preload script.
 *
 * The recording lifecycle is deliberately streamed rather than a single save call:
 * begin -> append* -> finish, with abort as the failure path. Buffering a whole
 * recording in the renderer and shipping one ArrayBuffer costs several full copies
 * of the video and fails outright on long captures.
 */
export interface RecorderApi {
  listSources(): Promise<CaptureSource[]>;
  /** Set what the next getDisplayMedia call captures. Read by main's handler. */
  setCaptureTarget(target: CaptureTarget): Promise<void>;
  /** Open the region selector. Resolves null if cancelled. */
  selectRegion(): Promise<RegionRect | null>;
  /** Region selector window only: report the chosen rect, or null to cancel. */
  reportRegion(rect: RegionRect | null): void;
  getPrimaryDisplay(): Promise<DisplayInfo>;

  getQuality(): Promise<QualityPreset>;
  setQuality(preset: QualityPreset): Promise<void>;

  getAudioMode(): Promise<AudioMode>;
  setAudioMode(mode: AudioMode): Promise<void>;

  /** Stored microphone deviceId; '' means the Windows default. */
  getMicDevice(): Promise<string>;
  setMicDevice(deviceId: string): Promise<void>;

  beginRecording(ext: string): Promise<string>;
  appendChunk(recordingId: string, chunk: ArrayBuffer): Promise<void>;
  finishRecording(recordingId: string): Promise<Recording>;
  abortRecording(recordingId: string): Promise<void>;

  listRecordings(): Promise<RecordingListItem[]>;
  deleteRecording(filePath: string, permanent: boolean): Promise<void>;
  openRecordingExternally(filePath: string): Promise<void>;

  /** One folder's contents. `''` is the recordings folder itself. */
  browseRecordings(relativeDir: string): Promise<FolderListing>;
  /** Every folder, flattened — what the "move to" menu offers. */
  listFolders(): Promise<FolderEntry[]>;
  /** Create a subfolder. Returns its path relative to the recordings folder. */
  createFolder(parent: string, name: string): Promise<string>;
  /** Move a recording into a folder. Returns its new absolute path. */
  moveRecording(filePath: string, targetDir: string): Promise<string>;
  /** Send a folder and everything in it to the Recycle Bin. Never the root. */
  deleteFolder(relativeDir: string): Promise<void>;
  /** Show a folder in Explorer, so the parts this app does not do are one click away. */
  revealFolder(relativeDir: string): Promise<void>;

  /** Recorder -> recordings window: a new recording landed. */
  announceRecording(filePath: string): void;
  /** Recordings window: listen for new recordings. Returns an unsubscribe. */
  onRecordingsChanged(handler: (filePath: string) => void): () => void;
  /**
   * Recordings window: stop playing, a recording is about to start. Returns an
   * unsubscribe. The window is hidden at the same moment, and a hidden window
   * keeps playing — its sound would land in the recording being made.
   */
  onSuspendPlayback(handler: () => void): () => void;

  /** Control-bar window: grow or shrink to fit what it is showing. */
  resizeBar(height: number): void;
  /** Open (or focus) the recordings window. */
  openLibrary(): Promise<void>;
  /** Open it *at* a recording: its folder, selected, playing if asked. */
  revealInLibrary(filePath: string, play: boolean): Promise<void>;
  /**
   * Recordings window, on mount: collect a request made before it could listen.
   * Returns null when there is none, and clears it either way.
   */
  takePendingReveal(): Promise<RevealRequest | null>;
  /** Recordings window: a request that arrived while it was already open. */
  onShowRecording(handler: (request: RevealRequest) => void): () => void;
  /** Cached tile image as a data: URL, or null when there is none yet. */
  getThumbnail(filePath: string): Promise<string | null>;
  /** Store a tile image. Rejects anything that is not a small JPEG. */
  putThumbnail(filePath: string, jpeg: ArrayBuffer): Promise<void>;

  /** Free bytes where recordings are saved, or null if unknown. */
  getFreeSpace(): Promise<number | null>;

  /** Report a renderer failure into the app log. */
  reportProblem(level: 'error' | 'warn', message: string): void;
  /** Open the log file in whatever the system uses for text. */
  openLog(): Promise<void>;

  /** Bring the control bar back and focus it. */
  showBar(): Promise<void>;
  /** Hide the bar. It comes back from the tray icon. */
  hideBar(): Promise<void>;
  /** Quit outright. Offered from the tray, not the bar. */
  quitApp(): Promise<void>;

  revealRecording(filePath: string): Promise<void>;
  getRecordingsDir(): Promise<string>;

  /** Recorder -> overlay. Sent by the main window only. */
  publishHudState(state: HudState): void;
  /** Overlay -> recorder. Returns an unsubscribe function. */
  onHudCommand(handler: (command: HudCommand) => void): () => void;

  /** Overlay -> recorder. Sent by the overlay window only. */
  sendHudCommand(command: HudCommand): void;
  /** Recorder -> overlay. Returns an unsubscribe function. */
  onHudState(handler: (state: HudState) => void): () => void;
}
