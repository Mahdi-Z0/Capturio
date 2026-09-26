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
const {
  resolveRecordingRequest,
  validateRelativePath,
  MAX_DEPTH,
} = require('../src/main/recordingPath.cjs');

const RECORDINGS = path.resolve('C:/Users/Example/Videos/Capturio');
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
  //
  // `%2F` survives URL parsing, so it never splits the path; it is refused as a
  // hidden separator rather than kept as part of a filename. The `..` traversal
  // branch itself is unreachable through this entry point -- a standard scheme
  // normalises `..` away before the handler sees it -- so it is exercised
  // directly against the validator in the folder section below.
  ['traversal, valid ext', url('..%2Fsecret.webm'), 'encoded separator'],
  // What actually protects us against a literal `..` here is that normalisation
  // yields an empty name, which is refused. Asserting that, rather than
  // pretending to test the traversal branch.
  ['dotdot, literal', url('..'), 'empty'],
  ['dotdot, encoded', url('%2e%2e'), 'empty'],
  ['dotdot mid-path, encoded', url('Lectures%2F..%2Fsecret.webm'), 'encoded separator'],
  ['drive letter, no sep', url('C%3Asecret.webm'), 'drive'],
  ['null byte, valid ext', url('Recording%00.webm'), 'null'],
  ['backslash in a name', url('sub%5Cdir%5Cfile.webm'), 'backslash'],
  // Realistic hostile inputs. These may be caught by whichever guard fires
  // first; what matters is that none is served.
  ['parent traversal', url('../secret.txt'), null],
  ['encoded traversal', url('..%2f..%2fsecret.txt'), null],
  ['double-encoded traversal', url('%252e%252e%252fsecret.txt'), null],
  ['drive-qualified path', url('C%3A%2FWindows%2Fhosts'), null],
  ['UNC path', url('%5C%5Cserver%5Cshare%5Cfile.webm'), 'backslash'],
  // Subfolders are allowed now, so the rules that keep them sane are guards in
  // their own right.
  ['empty segment', url('Lectures//Intro.webm'), 'empty path segment'],
  ['segment ending in a dot', url('Lectures./Intro.webm'), 'dot or space'],
  ['segment ending in a space', url('Lectures%20/Intro.webm'), 'dot or space'],
  ['reserved device name', url('CON/Intro.webm'), 'reserved'],
  ['reserved name with extension', url('nul.webm'), 'reserved'],
  ['colon in a name', url('Lecture%3A1.webm'), 'forbids'],
  ['too deeply nested', url(`${'a/'.repeat(MAX_DEPTH)}Intro.webm`), 'deeper than'],
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
  [
    'mixed-case webm',
    url('Recording-2026-09-17_05-37-40.webm'),
    'Recording-2026-09-17_05-37-40.webm',
  ],
  ['mp4', url('Recording-2026-09-16_05-34-13.mp4'), 'Recording-2026-09-16_05-34-13.mp4'],
  ['spaces, encoded', url('My%20Recording.webm'), 'My Recording.webm'],
  // Subfolders: the user organises the recordings folder, so nesting has to be
  // servable. The name reported is the file's own, not the path.
  ['in a subfolder', url('Lectures/Intro.webm'), 'Intro.webm'],
  ['two levels deep', url('Lectures/Week%201/Intro.webm'), 'Intro.webm'],
  ['dots inside a folder name', url('v1.2/Intro.webm'), 'Intro.webm'],
];

let failures = 0;

console.log('Verifying recording-protocol guards\n');
console.log('  Must refuse:');
for (const [label, input, expectGuard] of MUST_REFUSE) {
  const r = resolveRecordingRequest(input, RECORDINGS);
  if (r.ok) {
    console.log(`    FAIL  ${label.padEnd(28)} SERVED ${r.filePath}`);
    failures++;
  } else if (expectGuard && !r.reason.includes(expectGuard)) {
    // Refused, but by the wrong guard -- the one under test may be broken.
    console.log(`    FAIL  ${label.padEnd(28)} wrong guard: "${r.reason}" (wanted ${expectGuard})`);
    failures++;
  } else {
    console.log(`    ok    ${label.padEnd(28)} refused (${r.reason})`);
  }
}

console.log('\n  Must allow:');
for (const [label, input, expectedName] of MUST_ALLOW) {
  const r = resolveRecordingRequest(input, RECORDINGS);
  if (!r.ok) {
    console.log(`    FAIL  ${label.padEnd(28)} refused (${r.reason})`);
    failures++;
  } else if (r.fileName !== expectedName) {
    // Catches the case-normalisation bug that shipped in 02-01: the name rode in
    // the URL host, which a standard scheme lowercases.
    console.log(`    FAIL  ${label.padEnd(28)} name mangled: ${r.fileName} != ${expectedName}`);
    failures++;
  } else if (!r.filePath.startsWith(RECORDINGS + path.sep)) {
    console.log(`    FAIL  ${label.padEnd(28)} resolved outside: ${r.filePath}`);
    failures++;
  } else {
    console.log(`    ok    ${label.padEnd(28)} served as ${r.fileName}`);
  }
}

/**
 * Folders the user creates and moves between go through the same validator, so
 * a name that cannot be served cannot be created either. Only the extension
 * rule differs, and only because a folder has no extension.
 */
console.log('\n  Folder names (created by the user, same rules):');
const FOLDER_CASES = [
  ['plain', 'Lectures', true],
  ['nested', 'Lectures/Week 1', true],
  ['no extension needed', 'Talks', true],
  ['traversal', 'Lectures/../..', false],
  ['absolute', '/Windows', false],
  ['drive-qualified', 'C:/Windows', false],
  ['backslash', 'Lectures\\Week 1', false],
  ['reserved', 'PRN', false],
  ['trailing space', 'Lectures ', false],
  ['illegal character', 'Week|1', false],
  ['empty', '', false],
];
for (const [label, input, shouldPass] of FOLDER_CASES) {
  const r = validateRelativePath(input, { requireExtension: false });
  if (r.ok !== shouldPass) {
    console.log(
      `    FAIL  ${label.padEnd(28)} ${r.ok ? 'accepted' : `refused (${r.reason})`}, wanted ${shouldPass ? 'accepted' : 'refused'}`,
    );
    failures++;
  } else {
    console.log(`    ok    ${label.padEnd(28)} ${r.ok ? 'accepted' : `refused (${r.reason})`}`);
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
    ? `\nAll guards hold (${MUST_REFUSE.length} refused, ${MUST_ALLOW.length} served, ${FOLDER_CASES.length} folder names).`
    : `\n${failures} guard failure(s).`,
);
process.exit(failures === 0 ? 0 : 1);
