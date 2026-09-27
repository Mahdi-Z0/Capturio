/**
 * Assert the global shortcut validator accepts what it should and nothing else.
 *
 * Imports the SAME module the settings handlers use -- a verifier with its own
 * copy of the rules stays green while the shipped check drifts.
 *
 * Plain Node, no Electron needed: accelerator.cjs is deliberately pure. Whether
 * Windows then *lets* the app have a valid combination is a separate question,
 * answered at runtime by globalShortcut.register and reported in Settings.
 *
 * Run: npm run verify:shortcuts
 */

const { normalizeAccelerator } = require('../src/main/accelerator.cjs');

let failures = 0;

/** [label, input, canonical spelling] */
const MUST_ACCEPT = [
  ['start/stop default keys', 'Win+Shift+Z', 'Super+Shift+Z'],
  ['the pre-v6 start/stop keys', 'Control+Shift+R', 'Control+Shift+R'],
  ['record a region default', 'Shift+Super+Q', 'Super+Shift+Q'],
  ['as Windows writes it', 'Win+Shift+Q', 'Super+Shift+Q'],
  ['reordered to canonical', 'Shift+Control+B', 'Control+Shift+B'],
  ['aliases and case', 'ctrl+win+k', 'Super+Control+K'],
  ['digit', 'Alt+7', 'Alt+7'],
  ['function key alone', 'F9', 'F9'],
  ['PrintScreen alone', 'PrintScreen', 'PrintScreen'],
  ['Shift with a function key', 'Shift+F24', 'Shift+F24'],
  ['navigation, guarded', 'Control+Alt+PageDown', 'Control+Alt+PageDown'],
];

/** [label, input, reason the validator must give] */
const MUST_REFUSE = [
  ['not a string', 42, 'not a string'],
  ['empty', '', 'bad length'],
  ['absurdly long', `Control+${'A'.repeat(80)}`, 'bad length'],
  ['trailing plus', 'Control+', 'empty part'],
  ['modifiers only', 'Control+Shift', 'no key'],
  ['two keys', 'Control+A+B', 'more than one key'],
  ['repeated modifier', 'Control+Ctrl+A', 'repeated modifier'],
  // Three keys at most. Four is a chord nobody presses from muscle memory.
  ['four keys', 'Control+Alt+Shift+R', 'more than three keys'],
  ['four keys with Win', 'Win+Control+Shift+Q', 'more than three keys'],
  // A letter alone, or with only Shift, would take typing away from every app.
  ['bare letter', 'A', 'needs Ctrl, Alt or Win'],
  ['Shift and a letter', 'Shift+A', 'needs Ctrl, Alt or Win'],
  ['bare Space', 'Space', 'needs Ctrl, Alt or Win'],
  ['bare arrow', 'Left', 'needs Ctrl, Alt or Win'],
  // Punctuation resolves through the keyboard layout: shown and fired could differ.
  ['punctuation', 'Control+;', 'unknown key'],
  ['Electron-only name', 'CommandOrControl+R', 'unknown key'],
  ['F25 does not exist', 'Control+F25', 'unknown key'],
  ['media key', 'MediaPlayPause', 'unknown key'],
];

console.log('Verifying global shortcut validation\n');
console.log('  Must accept:');
for (const [label, input, expected] of MUST_ACCEPT) {
  const r = normalizeAccelerator(input);
  if (!r.ok) {
    console.log(`    FAIL  ${label.padEnd(28)} refused (${r.reason})`);
    failures++;
  } else if (r.value !== expected) {
    console.log(`    FAIL  ${label.padEnd(28)} spelled ${r.value}, wanted ${expected}`);
    failures++;
  } else {
    console.log(`    ok    ${label.padEnd(28)} ${r.value}`);
  }
}

console.log('\n  Must refuse:');
for (const [label, input, reason] of MUST_REFUSE) {
  const r = normalizeAccelerator(input);
  if (r.ok) {
    console.log(`    FAIL  ${label.padEnd(28)} ACCEPTED as ${r.value}`);
    failures++;
  } else if (r.reason !== reason) {
    // Refused, but by the wrong rule -- the one under test may be broken.
    console.log(`    FAIL  ${label.padEnd(28)} wrong rule: "${r.reason}" (wanted ${reason})`);
    failures++;
  } else {
    console.log(`    ok    ${label.padEnd(28)} refused (${r.reason})`);
  }
}

// Canonical spelling is what makes the duplicate check sound: two spellings of
// one combination must compare equal, or two actions could share it.
console.log('\n  One spelling per combination:');
const a = normalizeAccelerator('SHIFT+win+q');
const b = normalizeAccelerator('Super+Shift+Q');
if (a.ok && b.ok && a.value === b.value) {
  console.log(`    ok    both spell ${a.value}`);
} else {
  console.log('    FAIL  two spellings of one combination differ');
  failures++;
}

const total = MUST_ACCEPT.length + MUST_REFUSE.length + 1;
console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${total - failures}/${total}`);
process.exit(failures === 0 ? 0 : 1);
