/** Shared IPC contract between main and renderer. Keep this the single source of truth. */

export type CaptureKind = 'screen' | 'window';

export interface CaptureSource {
  id: string;
  name: string;
  kind: CaptureKind;
  thumbnailDataUrl: string;
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
  /** Custom-protocol URL. The renderer CSP forbids file://, so never build one. */
  playbackUrl: string;
  modifiedAt: string;
  sizeBytes: number;
}

/** Extensions the library lists and the protocol handler is willing to serve. */
export const PLAYABLE_EXTENSIONS: readonly string[] = ['.webm', '.mp4'];

/** Scheme used to stream recordings to the renderer without loosening the CSP. */
export const RECORDING_SCHEME = 'recording';

/**
 * Exposed on window.api by the preload script.
 *
 * The recording lifecycle is deliberately streamed rather than a single save call:
 * begin -> append* -> finish, with abort as the failure path. Buffering a whole
 * recording in the renderer and shipping one ArrayBuffer costs several full copies
 * of the video and fails outright on long captures.
 */
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

export function isQualityPreset(v: unknown): v is QualityPreset {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(QUALITY_PRESETS, v);
}

/** Primary display measured in physical pixels, so capture is not downscaled on HiDPI. */
export interface DisplayInfo {
  width: number;
  height: number;
  scaleFactor: number;
}

export interface RecorderApi {
  listSources(): Promise<CaptureSource[]>;
  getPrimaryDisplay(): Promise<DisplayInfo>;

  getQuality(): Promise<QualityPreset>;
  setQuality(preset: QualityPreset): Promise<void>;

  beginRecording(ext: string): Promise<string>;
  appendChunk(recordingId: string, chunk: ArrayBuffer): Promise<void>;
  finishRecording(recordingId: string): Promise<Recording>;
  abortRecording(recordingId: string): Promise<void>;

  listRecordings(): Promise<RecordingListItem[]>;
  deleteRecording(filePath: string, permanent: boolean): Promise<void>;
  openRecordingExternally(filePath: string): Promise<void>;

  revealRecording(filePath: string): Promise<void>;
  getRecordingsDir(): Promise<string>;
}
