/**
 * HTTP byte-range parsing — the single source of truth.
 *
 * Plain CommonJS with no Electron import, so `scripts/verify-range.cjs` exercises
 * this exact code with no build step, the same arrangement as `recordingPath.cjs`
 * and `webmFinalize.cjs`.
 *
 * This exists because seeking silently did not work. `stream: true` on the
 * privileged scheme *permits* range responses; it does not produce them, and the
 * handler returned the whole file for every request. Measured 2026-09-18 on a
 * finalized recording: `seekable.end(0)` was 0 and a seek to 15.5 s landed at 0.
 * With ranges answered, the same file seeks to 15.5 s.
 *
 * Parsing is separated from serving because this is where the mistakes live:
 * suffix ranges, open-ended ranges, and the off-by-one at the end of the file.
 */

const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');

/**
 * @typedef {{ kind: 'whole' }} Whole
 * @typedef {{ kind: 'partial', start: number, end: number }} Partial
 * @typedef {{ kind: 'unsatisfiable' }} Unsatisfiable
 */

/**
 * Decide what to serve for a `Range` header.
 *
 * Only a single byte range is supported. Multi-range requests are answered with
 * the whole file, which is legal and is what media elements fall back to; they
 * never ask for more than one range anyway.
 *
 * @param {string | null | undefined} header Raw `Range` header, if any
 * @param {number} size Total file size in bytes
 * @returns {Whole | Partial | Unsatisfiable}
 */
function parseRange(header, size) {
  if (!header) return { kind: 'whole' };

  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return { kind: 'whole' };

  const hasStart = match[1] !== '';
  const hasEnd = match[2] !== '';
  if (!hasStart && !hasEnd) return { kind: 'whole' };

  // An empty file can satisfy no range at all.
  if (size <= 0) return { kind: 'unsatisfiable' };

  if (!hasStart) {
    // `bytes=-N`: the final N bytes. How a player reaches a trailing index --
    // which, now that recordings carry a Cues element at the end, is exactly the
    // request that makes seeking work.
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: 'unsatisfiable' };
    return { kind: 'partial', start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(match[1]);
  if (!Number.isFinite(start) || start >= size) return { kind: 'unsatisfiable' };

  // `bytes=N-` means "from N to the end". An end past the file is clamped rather
  // than refused: the spec says to serve what exists.
  const end = hasEnd ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(end) || end < start) return { kind: 'unsatisfiable' };

  return { kind: 'partial', start, end };
}

/**
 * Let the app's own pages READ these bytes, not merely play them.
 *
 * `recording:` is a different origin from the app page, so a <video> drawn into
 * a canvas taints it and `toBlob` throws -- which is why thumbnails silently
 * produced nothing. The scheme is registered by this app alone and is not
 * reachable from a browser or another program, so declaring it readable grants
 * nothing that playing the file did not already.
 *
 * Elements that need this must also set `crossOrigin = 'anonymous'`.
 */
const CORS = { 'Access-Control-Allow-Origin': '*' };

/**
 * Build the response for a recording request, honouring `Range`.
 *
 * Lives here rather than in index.ts so the verifier and the shipped protocol
 * handler run the same serving code, not two versions that can drift.
 *
 * @param {string | null | undefined} rangeHeader
 * @param {string} filePath Already validated by recordingPath.cjs
 * @param {number} size
 * @param {string} contentType
 * @returns {Response}
 */
function createRangeResponse(rangeHeader, filePath, size, contentType) {
  const decision = parseRange(rangeHeader, size);

  if (decision.kind === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  if (decision.kind === 'whole') {
    // Whole file, but advertise that ranges are available. Without Accept-Ranges
    // the element will not attempt to seek at all.
    return new Response(Readable.toWeb(createReadStream(filePath)), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        ...CORS,
      },
    });
  }

  const { start, end } = decision;
  return new Response(Readable.toWeb(createReadStream(filePath, { start, end })), {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      ...CORS,
    },
  });
}

module.exports = { parseRange, createRangeResponse };
