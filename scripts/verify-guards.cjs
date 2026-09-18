/**
 * Assert the recording protocol refuses hostile inputs.
 *
 * Imports the SAME module the shipped handler uses. That is the whole point:
 * a verifier with its own copy of the checks stays green while the real handler
 * drifts, which converts "unverified" into a false claim of "verified".
 *
 * Plain Node, no Electron needed -- recordingPath.cjs is deliberately pure.
 *
 * Run: npm run verify:guards
 */

const path = require('node:path');
const { resolveRecordingRequest } = require('../src/main/recordingPath.cjs');

const RECORDINGS = path.resolve('C:/Users/Example/Videos/ScreenRecorder');
const url = (name) => `recording://f/${name}`;

/**
 * Inputs that must never be served.
 *
 * Several use a legitimate `.webm` extension on purpose. With `.txt`, the
 * extension check fires first and the traversal or drive-letter check is never
 * reached -- so the suite would pass while those guards were broken. Each entry
 * below also asserts WHICH guard refused it.
 */
const MUST_REFUSE = [
  // Isolating cases: legitimate extension, so only the intended guard can fire.
  ['traversal, valid ext', url('..%2Fsecret.webm'), 'separator'],
  // `..` is normalised away by the URL parser for a standard scheme -- both the
  // literal and percent-encoded forms. The traversal check in the validator is
  // therefore unreachable through this entry point and is defence-in-depth only.
  // What actually protects us here is that normalisation yields an empty name,
  // which is refused. Asserting that, rather than pretending to test the branch.
  ['dotdot, literal', url('..'), 'empty'],
  ['dotdot, encoded', url('%2e%2e'), 'empty'],
  ['drive letter, no sep', url('C%3Asecret.webm'), 'drive'],
  ['null byte, valid ext', url('Recording%00.webm'), 'null'],
  // Realistic hostile inputs. These may be caught by whichever guard fires
  // first; what matters is that none is served.
  ['parent traversal', url('../secret.txt'), null],
  ['encoded traversal', url('..%2f..%2fsecret.txt'), null],
  ['double-encoded traversal', url('%252e%252e%252fsecret.txt'), null],
  ['forward-slash path', url('sub/dir/file.webm'), 'separator'],
  ['backslash path', url('sub%5Cdir%5Cfile.webm'), 'separator'],
  ['drive-qualified path', url('C%3A%2FWindows%2Fhosts'), null],
  ['UNC path', url('%5C%5Cserver%5Cshare%5Cfile.webm'), 'separator'],
  ['part file mid-write', url('Recording-2026-01-01_00-00-00.webm.part'), 'extension'],
  ['unknown extension', url('notes.txt'), 'extension'],
  ['no extension', url('Recording'), 'extension'],
  ['empty name', 'recording://f/', 'empty'],
];

/**
 * A legitimate request must still be SERVED. Without this, a handler that
 * refused everything would pass every assertion above.
 */
const MUST_ALLOW = [
  ['mixed-case webm', url('Recording-2026-09-17_05-37-40.webm'), 'Recording-2026-09-17_05-37-40.webm'],
  ['mp4', url('Recording-2026-09-16_05-34-13.mp4'), 'Recording-2026-09-16_05-34-13.mp4'],
  ['spaces, encoded', url('My%20Recording.webm'), 'My Recording.webm'],
];

let failures = 0;

console.log('Verifying recording-protocol guards\n');
console.log('  Must refuse:');
for (const [label, input, expectGuard] of MUST_REFUSE) {
  const r = resolveRecordingRequest(input, RECORDINGS);
  if (r.ok) {
    console.log(`    FAIL  ${label.padEnd(26)} SERVED ${r.filePath}`);
    failures++;
  } else if (expectGuard && !r.reason.includes(expectGuard)) {
    // Refused, but by the wrong guard -- the one under test may be broken.
    console.log(`    FAIL  ${label.padEnd(26)} wrong guard: "${r.reason}" (wanted ${expectGuard})`);
    failures++;
  } else {
    console.log(`    ok    ${label.padEnd(26)} refused (${r.reason})`);
  }
}

console.log('\n  Must allow:');
for (const [label, input, expectedName] of MUST_ALLOW) {
  const r = resolveRecordingRequest(input, RECORDINGS);
  if (!r.ok) {
    console.log(`    FAIL  ${label.padEnd(26)} refused (${r.reason})`);
    failures++;
  } else if (r.fileName !== expectedName) {
    // Catches the case-normalisation bug that shipped in 02-01: the name rode in
    // the URL host, which a standard scheme lowercases.
    console.log(`    FAIL  ${label.padEnd(26)} name mangled: ${r.fileName} != ${expectedName}`);
    failures++;
  } else if (!r.filePath.startsWith(RECORDINGS + path.sep)) {
    console.log(`    FAIL  ${label.padEnd(26)} resolved outside: ${r.filePath}`);
    failures++;
  } else {
    console.log(`    ok    ${label.padEnd(26)} served as ${r.fileName}`);
  }
}

// A sibling directory sharing the name prefix must not be reachable.
console.log('\n  Containment:');
const sibling = resolveRecordingRequest(url('x.webm'), RECORDINGS + '-elsewhere');
if (sibling.ok && sibling.filePath.startsWith(RECORDINGS + path.sep)) {
  console.log('    FAIL  sibling-prefix directory leaked into the recordings folder');
  failures++;
} else {
  console.log('    ok    sibling-prefix directory stays separate');
}

console.log(
  failures === 0
    ? `\nAll guards hold (${MUST_REFUSE.length} refused, ${MUST_ALLOW.length} served).`
    : `\n${failures} guard failure(s).`,
);
process.exit(failures === 0 ? 0 : 1);
