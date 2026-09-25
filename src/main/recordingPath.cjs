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
 * @typedef {{ ok: true, filePath: string, fileName: string }} Allowed
 * @typedef {{ ok: false, reason: string }} Refused
 */

/**
 * Decide whether a `recording:` request may be served, and resolve it.
 *
 * @param {string} requestUrl Full request URL, e.g. recording://f/Name.webm
 * @param {string} recordingsDir Absolute path to the recordings directory
 * @returns {Allowed | Refused}
 */
function resolveRecordingRequest(requestUrl, recordingsDir) {
  let name;
  try {
    // The name lives in the PATH, behind a fixed dummy authority. A standard
    // scheme parses like http, so `recording:///Name.webm` collapses to
    // `recording://name.webm/` and lowercases it -- which survives on NTFS by
    // luck and breaks anywhere case-sensitive.
    //
    // Decode exactly once. Double-decoding is how %252e%252e becomes traversal.
    name = decodeURIComponent(new URL(requestUrl).pathname.replace(/^\/+/, ''));
  } catch {
    return { ok: false, reason: 'undecodable url' };
  }

  if (name.length === 0) {
    return { ok: false, reason: 'empty name' };
  }

  // Everything below is a rejection, never a sanitisation. Quietly stripping
  // characters is how the next bypass gets found.
  if (name.includes('/') || name.includes('\\')) {
    return { ok: false, reason: 'contains a path separator' };
  }
  // Defence-in-depth only: for a standard scheme the URL parser normalises `..`
  // away before this runs -- literal and percent-encoded alike -- so this branch
  // is unreachable through the protocol today. It is kept because the scheme's
  // `standard: true` registration, not this function, is what makes that true,
  // and that could change. verify-guards.cjs asserts the normalised outcome
  // rather than claiming to exercise this line.
  if (name.includes('..')) {
    return { ok: false, reason: 'contains a traversal sequence' };
  }
  if (name.includes('\0')) {
    return { ok: false, reason: 'contains a null byte' };
  }
  if (/^[a-zA-Z]:/.test(name)) {
    return { ok: false, reason: 'looks like a drive-qualified path' };
  }

  const ext = path.extname(name).toLowerCase();
  if (!PLAYABLE_EXTENSIONS.includes(ext)) {
    // Also excludes `.part`: mid-write, and a torn read looks like corruption.
    return { ok: false, reason: `extension not allowed: ${ext || '(none)'}` };
  }

  // Resolution happens after decoding and validation, never before.
  const filePath = path.resolve(path.join(recordingsDir, name));
  const root = path.resolve(recordingsDir) + path.sep;
  if (!filePath.startsWith(root)) {
    // Separator-aware: a bare startsWith on the directory string would also
    // accept a sibling such as ...\Capturio-elsewhere\x.webm.
    return { ok: false, reason: 'resolves outside the recordings folder' };
  }

  return { ok: true, filePath, fileName: name };
}

module.exports = { resolveRecordingRequest, PLAYABLE_EXTENSIONS };
