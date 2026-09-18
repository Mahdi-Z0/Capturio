/**
 * Types for recordingPath.cjs.
 *
 * The implementation is plain CommonJS so that scripts/verify-guards.cjs can
 * require it without a build step -- that is what keeps the verifier and the
 * shipped handler on one implementation. This declaration gives the TypeScript
 * side full typing without needing `allowJs`.
 */

export type RecordingRequestResult =
  | { ok: true; filePath: string; fileName: string }
  | { ok: false; reason: string };

export declare function resolveRecordingRequest(
  requestUrl: string,
  recordingsDir: string,
): RecordingRequestResult;

export declare const PLAYABLE_EXTENSIONS: string[];
