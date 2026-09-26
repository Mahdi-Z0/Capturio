/**
 * Types for recordingPath.cjs.
 *
 * The implementation is plain CommonJS so that scripts/verify-guards.cjs can
 * require it without a build step -- that is what keeps the verifier and the
 * shipped handler on one implementation. This declaration gives the TypeScript
 * side full typing without needing `allowJs`.
 */

export type Refused = { ok: false; reason: string };

export type RecordingRequestResult =
  | { ok: true; filePath: string; fileName: string; relativePath: string }
  | Refused;

export type ValidatedPath = { ok: true; segments: string[]; relativePath: string } | Refused;

export declare function resolveRecordingRequest(
  requestUrl: string,
  recordingsDir: string,
): RecordingRequestResult;

/**
 * The same name rules the protocol applies, for folders the user creates and
 * for moves. Folders pass `requireExtension: false`; they have no extension.
 */
export declare function validateRelativePath(
  relativePath: string,
  options?: { requireExtension?: boolean },
): ValidatedPath;

export declare function resolveInside(
  segments: string[],
  recordingsDir: string,
): { ok: true; filePath: string } | Refused;

export declare const PLAYABLE_EXTENSIONS: string[];
export declare const MAX_DEPTH: number;
