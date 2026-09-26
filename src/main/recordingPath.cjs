/**
 * Recording request validation — the single source of truth.
 *
 * Deliberately a plain CommonJS module with no Electron or Node-path imports
 * beyond `node:path`, so that BOTH of these can use the same code:
 *
 *   - the `recording:` protocol handler in src/main/index.ts (bundled at build)
 *   - scripts/verify-guards.cjs (requires this file directly, no build step)
 *
 * The audit on 02-02 flagged that a verifier which reimplements its checks is
 * worse than no verifier: it stays green while the shipped handler drifts, and
 * turns "unverified" into a false claim of "verified". Keeping the logic here,
 * in one file, is what makes scripts/verify-guards.cjs meaningful.
 *
 * Pure: takes the recordings directory as an argument rather than reaching for
 * app.getPath(), so it can be exercised without an Electron app instance.
 */

const path = require('node:path');

/** Extensions the handler is willing to serve. Never `.part` -- mid-write. */
const PLAYABLE_EXTENSIONS = ['.webm', '.mp4'];

/**
 * How deep a recording may sit below the recordings folder.
 *
 * Subfolders are the user's to organise, but unbounded depth is a way to build
 * paths past Windows' limit, where behaviour stops being predictable.
 */
const MAX_DEPTH = 8;

/** Reserved by Windows at every level, with or without an extension. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Characters Windows forbids outright, plus control codes. */
// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARS = /[<>:"|?*\u0000-\u001f]/;

/**
 * @typedef {{ ok: true, segments: string[], relativePath: string }} ValidPath
 * @typedef {{ ok: false, reason: string }} Refused
 * @typedef {{ ok: true, filePath: string, fileName: string, relativePath: string }} Allowed
 */

/**
 * Validate a path relative to the recordings folder.
 *
 * Used for playback requests, for folders the user creates, and for moves —
 * one set of rules, so a name that cannot be served also cannot be created.
 *
 * Everything here is a rejection, never a sanitisation. Quietly stripping
 * characters is how the next bypass gets found.
 *
 * @param {string} relativePath `/`-separated, e.g. `Lectures/Week 1/Intro.webm`
 * @param {{ requireExtension?: boolean }} [options] Files must end in a playable
 *   extension; folders must not be checked for one.
 * @returns {ValidPath | Refused}
 */
function validateRelativePath(relativePath, options = {}) {
  const { requireExtension = false } = options;

  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return { ok: false, reason: 'empty name' };
  }
  if (relativePath.includes('\0')) {
    return { ok: false, reason: 'contains a null byte' };
  }
  // Backslash is a separator on Windows and is never legal inside a name, so it
  // can only be an attempt to slip past the segment rules below.
  if (relativePath.includes('\\')) {
    return { ok: false, reason: 'contains a backslash' };
  }
  if (/^[a-zA-Z]:/.test(relativePath)) {
    return { ok: false, reason: 'looks like a drive-qualified path' };
  }
  if (relativePath.startsWith('/')) {
    return { ok: false, reason: 'is an absolute path' };
  }

  const segments = relativePath.split('/');
  if (segments.length > MAX_DEPTH) {
    return { ok: false, reason: `nested deeper than ${MAX_DEPTH} levels` };
  }

  for (const segment of segments) {
    if (segment.length === 0) {
      // A trailing or doubled slash. Normalising it away would mean two URLs
      // naming one file, and the guard reasoning about the wrong one.
      return { ok: false, reason: 'empty path segment' };
    }
    if (segment === '.' || segment === '..') {
      return { ok: false, reason: 'contains a traversal sequence' };
    }
    if (segment.length > 100) {
      return { ok: false, reason: 'name segment is too long' };
    }
    if (ILLEGAL_CHARS.test(segment)) {
      return { ok: false, reason: 'contains a character Windows forbids' };
    }
    // Windows silently trims these, so `evil. ` and `evil` become the same file
    // while the checks above saw two different names.
    if (/[. ]$/.test(segment)) {
      return { ok: false, reason: 'name segment ends with a dot or space' };
    }
    if (RESERVED_NAMES.test(segment.replace(/\..*$/, ''))) {
      return { ok: false, reason: 'reserved device name' };
    }
  }

  if (requireExtension) {
    const ext = path.extname(segments[segments.length - 1]).toLowerCase();
    if (!PLAYABLE_EXTENSIONS.includes(ext)) {
      // Also excludes `.part`: mid-write, and a torn read looks like corruption.
      return { ok: false, reason: `extension not allowed: ${ext || '(none)'}` };
    }
  }

  return { ok: true, segments, relativePath: segments.join('/') };
}

/**
 * Resolve a validated relative path inside the recordings folder.
 *
 * Resolution happens after validation, never before, and containment is checked
 * separator-aware: a bare startsWith on the directory string would also accept a
 * sibling such as ...\Capturio-elsewhere\x.webm.
 *
 * @param {string[]} segments
 * @param {string} recordingsDir
 * @returns {{ ok: true, filePath: string } | Refused}
 */
function resolveInside(segments, recordingsDir) {
  const filePath = path.resolve(path.join(recordingsDir, ...segments));
  const root = path.resolve(recordingsDir) + path.sep;
  if (!filePath.startsWith(root)) {
    return { ok: false, reason: 'resolves outside the recordings folder' };
  }
  return { ok: true, filePath };
}

/**
 * Decide whether a `recording:` request may be served, and resolve it.
 *
 * @param {string} requestUrl Full request URL, e.g. recording://f/Name.webm
 * @param {string} recordingsDir Absolute path to the recordings directory
 * @returns {Allowed | Refused}
 */
function resolveRecordingRequest(requestUrl, recordingsDir) {
  let decoded;
  try {
    // The name lives in the PATH, behind a fixed dummy authority. A standard
    // scheme parses like http, so `recording:///Name.webm` collapses to
    // `recording://name.webm/` and lowercases it -- which survives on NTFS by
    // luck and breaks anywhere case-sensitive.
    //
    // Decoded per segment, exactly once. Decoding the whole path at once would
    // let an encoded %2F inside a name become a separator after the split, and
    // double-decoding is how %252e%252e becomes traversal.
    decoded = new URL(requestUrl).pathname
      .replace(/^\/+/, '')
      .split('/')
      .map((s) => decodeURIComponent(s));
  } catch {
    return { ok: false, reason: 'undecodable url' };
  }

  // A segment that contains a separator only after decoding was hiding one:
  // `%2F` survives URL parsing untouched, so it does not split the path, and
  // keeping it as part of a filename would mean two spellings of one path.
  // Backslashes fall through to the validator, which names them exactly.
  if (decoded.some((s) => s.includes('/'))) {
    return { ok: false, reason: 'encoded separator inside a name' };
  }

  const relative = decoded.join('/');
  if (relative.length === 0) return { ok: false, reason: 'empty name' };

  const valid = validateRelativePath(relative, { requireExtension: true });
  if (!valid.ok) return valid;

  const resolved = resolveInside(valid.segments, recordingsDir);
  if (!resolved.ok) return resolved;

  return {
    ok: true,
    filePath: resolved.filePath,
    fileName: valid.segments[valid.segments.length - 1],
    relativePath: valid.relativePath,
  };
}

module.exports = {
  resolveRecordingRequest,
  validateRelativePath,
  resolveInside,
  PLAYABLE_EXTENSIONS,
  MAX_DEPTH,
};
