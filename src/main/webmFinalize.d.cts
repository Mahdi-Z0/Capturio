/** Types for webmFinalize.cjs — plain CommonJS so the verifier can require it unbuilt. */

export interface FinalizeResult {
  /** True duration in milliseconds, derived from the last block timestamp. */
  durationMs: number;
  /** One cue point per cluster. */
  cuePoints: number;
  videoTrack: number;
  /** Cluster bytes copied verbatim. Nothing is re-encoded. */
  bytesCopied: number;
}

export interface WebmInfo {
  durationMs: number;
  hasDuration: boolean;
  hasCues: boolean;
  segmentSizeKnown: boolean;
  clusters: number;
  videoTrack: number | null;
  bytes: number;
}

/**
 * Rewrite a MediaRecorder WebM with a declared Segment size, a Duration, and a
 * Cues index. Never touches the source; refuses to overwrite `destPath`.
 */
export function finalizeWebm(srcPath: string, destPath: string): Promise<FinalizeResult>;

/** Re-read a file and report what it declares. */
export function inspect(filePath: string): WebmInfo;
