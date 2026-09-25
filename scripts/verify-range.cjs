/**
 * Prove the byte-range parser answers what a media element actually asks for.
 *
 * Requires the shipped module directly, like verify-guards and verify-finalize:
 * a verifier with its own copy of the logic stays green while the real handler
 * drifts.
 *
 * This exists because seeking was broken twice for two different reasons. The
 * first fix (writing a Duration and Cues) was necessary but not sufficient: the
 * protocol handler still returned the whole file for every request, so
 * `seekable.end(0)` was 0 and every seek landed back at zero.
 */

const { parseRange, createRangeResponse } = require('../src/main/byteRange.cjs');

const SIZE = 1000;
let failures = 0;

function expect(header, size, want, why) {
  const got = parseRange(header, size);
  const ok =
    got.kind === want.kind &&
    (want.kind !== 'partial' || (got.start === want.start && got.end === want.end));
  if (!ok) failures++;
  const shown =
    got.kind === 'partial' ? `partial ${got.start}-${got.end}` : got.kind;
  const wanted =
    want.kind === 'partial' ? `partial ${want.start}-${want.end}` : want.kind;
  console.log(
    `  ${ok ? 'ok   ' : 'FAIL '} ${String(header ?? '(no header)').padEnd(22)} -> ${shown.padEnd(20)}${ok ? '' : ` want ${wanted}`}`,
  );
  if (why && !ok) console.log(`         ${why}`);
}

console.log('\nWhole-file responses:');
expect(null, SIZE, { kind: 'whole' });
expect(undefined, SIZE, { kind: 'whole' });
expect('bytes=-', SIZE, { kind: 'whole' });
// Multi-range is legal to answer with the whole file, and media elements never
// ask for one. Better whole than wrong.
expect('bytes=0-99,200-299', SIZE, { kind: 'whole' });
expect('items=0-99', SIZE, { kind: 'whole' });

console.log('\nNormal ranges:');
expect('bytes=0-99', SIZE, { kind: 'partial', start: 0, end: 99 });
expect('bytes=500-999', SIZE, { kind: 'partial', start: 500, end: 999 });
expect('bytes=0-0', SIZE, { kind: 'partial', start: 0, end: 0 });
expect(' bytes=10-20 ', SIZE, { kind: 'partial', start: 10, end: 20 });

console.log('\nOpen-ended (bytes=N-):');
expect('bytes=0-', SIZE, { kind: 'partial', start: 0, end: 999 });
expect('bytes=999-', SIZE, { kind: 'partial', start: 999, end: 999 });

console.log('\nSuffix (bytes=-N) — how a player reaches the trailing Cues index:');
expect('bytes=-100', SIZE, { kind: 'partial', start: 900, end: 999 });
expect('bytes=-1', SIZE, { kind: 'partial', start: 999, end: 999 });
// A suffix longer than the file means the whole file, not a negative offset.
expect('bytes=-5000', SIZE, { kind: 'partial', start: 0, end: 999 });

console.log('\nClamping and refusals:');
// An end past the file is clamped, not refused: serve what exists.
expect('bytes=900-99999', SIZE, { kind: 'partial', start: 900, end: 999 });
expect('bytes=1000-', SIZE, { kind: 'unsatisfiable' }, 'start at EOF must be 416');
expect('bytes=5000-6000', SIZE, { kind: 'unsatisfiable' });
expect('bytes=500-499', SIZE, { kind: 'unsatisfiable' }, 'end before start is not a range');
expect('bytes=0-99', 0, { kind: 'unsatisfiable' }, 'an empty file satisfies no range');

console.log('\nOff-by-one guards:');
const last = parseRange('bytes=-1', SIZE);
if (last.kind !== 'partial' || last.start !== SIZE - 1 || last.end !== SIZE - 1) failures++;
console.log(
  `  ${last.kind === 'partial' && last.start === SIZE - 1 ? 'ok   ' : 'FAIL '} last byte is ${SIZE - 1}, not ${SIZE}`,
);
const whole = parseRange('bytes=0-', SIZE);
const length = whole.kind === 'partial' ? whole.end - whole.start + 1 : -1;
if (length !== SIZE) failures++;
console.log(`  ${length === SIZE ? 'ok   ' : 'FAIL '} bytes=0- covers all ${SIZE} bytes (got ${length})`);

console.log('\nResponse headers:');
{
  const fsx = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fsx.mkdtempSync(path.join(os.tmpdir(), 'range-'));
  const file = path.join(dir, 'x.webm');
  fsx.writeFileSync(file, Buffer.alloc(SIZE, 7));

  const whole = createRangeResponse(null, file, SIZE, 'video/webm');
  const partial = createRangeResponse('bytes=10-19', file, SIZE, 'video/webm');
  const checks = [
    ['whole response is 200 and advertises ranges',
      whole.status === 200 && whole.headers.get('accept-ranges') === 'bytes'],
    ['partial response is 206', partial.status === 206],
    ['partial names its range', partial.headers.get('content-range') === 'bytes 10-19/' + SIZE],
    ['partial length is the slice', partial.headers.get('content-length') === '10'],
    // Without this the library cannot draw a frame into a canvas: the source is
    // cross-origin, the canvas is tainted, and toBlob throws. Thumbnails failed
    // silently until this header was added (2026-09-25).
    ['both allow reading, for thumbnails',
      whole.headers.get('access-control-allow-origin') === '*' &&
        partial.headers.get('access-control-allow-origin') === '*'],
  ];
  for (const [label, ok] of checks) {
    if (!ok) failures++;
    console.log('  ' + (ok ? 'ok   ' : 'FAIL ') + label);
  }
  fsx.rmSync(dir, { recursive: true, force: true });
}

console.log(
  failures === 0
    ? '\nRange parsing holds.\n'
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
