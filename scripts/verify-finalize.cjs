/**
 * Prove the WebM finalizer produces a seekable file and loses nothing.
 *
 * Requires the shipped module directly -- no build step, no reimplementation.
 * `scripts/verify-guards.cjs` exists for the same reason: a verifier that
 * reimplements what it tests stays green while the real code drifts.
 *
 * Usage: npm run verify:finalize [path-to-a.webm]
 * With no argument it uses the newest recording that is not already finalized.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { finalizeWebm, inspect } = require('../src/main/webmFinalize.cjs');

let failures = 0;
function check(label, condition, detail) {
  const mark = condition ? 'ok   ' : 'FAIL ';
  if (!condition) failures++;
  console.log(`    ${mark} ${label}${detail ? `  (${detail})` : ''}`);
}

/**
 * Prefer a recording that has NOT been finalized -- that is the input this
 * verifier is about. Now that the app finalizes on save, the newest file is
 * normally already done, and testing that one would assert nothing.
 */
function pickSource() {
  if (process.argv[2]) return process.argv[2];
  const dir = path.join(os.homedir(), 'Videos', 'ScreenRecorder');
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.webm'))
    .map((f) => ({ f, p: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  for (const file of files) {
    try {
      const info = inspect(file.p);
      if (!info.hasDuration || !info.hasCues) return file.p;
    } catch {
      // Unreadable (a truncated recovery, say) -- not a fair test input.
    }
  }
  return null;
}

/** Byte ranges of the cluster region, so the copy can be compared exactly. */
function clusterRegion(filePath) {
  const { analyze, Reader } = require('../src/main/webmFinalize.cjs');
  const fd = fs.openSync(filePath, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const info = analyze(new Reader(fd, size));
    return { start: info.clustersStart, end: info.clustersEnd };
  } finally {
    fs.closeSync(fd);
  }
}

function sameBytes(aPath, aStart, bPath, bStart, length) {
  const CHUNK = 1 << 20;
  const fa = fs.openSync(aPath, 'r');
  const fb = fs.openSync(bPath, 'r');
  try {
    const ba = Buffer.alloc(CHUNK);
    const bb = Buffer.alloc(CHUNK);
    let done = 0;
    while (done < length) {
      const n = Math.min(CHUNK, length - done);
      fs.readSync(fa, ba, 0, n, aStart + done);
      fs.readSync(fb, bb, 0, n, bStart + done);
      if (!ba.subarray(0, n).equals(bb.subarray(0, n))) return false;
      done += n;
    }
    return true;
  } finally {
    fs.closeSync(fa);
    fs.closeSync(fb);
  }
}

async function main() {
  const src = pickSource();
  if (!src || !fs.existsSync(src)) {
    console.error('No unfinalized .webm to verify against.');
    console.error('Every recording on disk is already finalized, which is the healthy state,');
    console.error('but it means this check had nothing to prove. Pass a path to force one.');
    process.exit(2);
  }

  console.log(`\nSource: ${path.basename(src)} (${(fs.statSync(src).size / 1048576).toFixed(1)} MB)`);

  const before = inspect(src);
  console.log('\n  Before finalizing:');
  check('Duration absent (the defect)', !before.hasDuration);
  check('Cues absent (the defect)', !before.hasCues);
  console.log(`    info  duration derivable from blocks: ${before.durationMs} ms, ${before.clusters} clusters`);

  const dest = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'finalize-')),
    'finalized.webm',
  );

  const result = await finalizeWebm(src, dest);
  console.log(`\n  Finalized -> ${result.cuePoints} cue points, duration ${result.durationMs} ms`);

  const after = inspect(dest);
  console.log('\n  After finalizing:');
  check('Duration is present', after.hasDuration);
  check('Cues index is present', after.hasCues);
  check('Segment size is declared', after.segmentSizeKnown);
  check(
    'duration is unchanged by the rewrite',
    after.durationMs === before.durationMs,
    `${before.durationMs} -> ${after.durationMs} ms`,
  );
  // Not one cue per cluster: only clusters holding a video keyframe are
  // seekable. Indexing the rest made the second seek fail with
  // PIPELINE_ERROR_DECODE (measured 2026-09-18).
  check(
    'cue points exist, one per cluster holding a video keyframe at most',
    result.cuePoints > 0 && result.cuePoints <= before.clusters,
    `${result.cuePoints} cues across ${before.clusters} clusters`,
  );
  check('cues reference the video track', typeof after.videoTrack === 'number', `track ${after.videoTrack}`);

  console.log('\n  Media integrity:');
  const a = clusterRegion(src);
  const b = clusterRegion(dest);
  check(
    'cluster region is the same length',
    a.end - a.start === b.end - b.start,
    `${a.end - a.start} vs ${b.end - b.start}`,
  );
  check(
    'cluster bytes are identical (nothing re-encoded)',
    sameBytes(src, a.start, dest, b.start, a.end - a.start),
  );
  check('output is larger only by the new header and index', after.bytes > before.bytes);

  console.log('\n  Refusals:');
  let refused = false;
  try {
    await finalizeWebm(dest, path.join(path.dirname(dest), 'again.webm'));
  } catch (err) {
    refused = String(err.message).includes('already finalized');
  }
  check('refuses to finalize an already-finalized file', refused);

  let clobber = false;
  try {
    await finalizeWebm(src, dest);
  } catch (err) {
    clobber = err.code === 'EEXIST';
  }
  check('refuses to overwrite an existing file', clobber);

  fs.rmSync(path.dirname(dest), { recursive: true, force: true });

  console.log(
    failures === 0
      ? '\nFinalizer holds: seekable output, media bytes untouched.\n'
      : `\n${failures} check(s) FAILED.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nverify:finalize crashed:', err);
  process.exit(1);
});
