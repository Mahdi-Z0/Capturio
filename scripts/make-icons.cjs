/**
 * Draw the app mark and write it out as PNGs.
 *
 * No image dependency and no binary blobs in the repo: the mark is defined here
 * as maths, so it can be regenerated at any size. Run `npm run icons` after
 * changing it.
 *
 * The mark is the record dot — the one thing this app does, and the only place
 * it spends red — inside a soft dark square that matches the control bar. At
 * 16px the square and dot are all that survive, which is the point: a tray icon
 * has to be legible at the size Windows actually draws it.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const GROUND = [20, 21, 28];
const RED = [255, 77, 77];

/** Signed distance to a rounded rectangle, for anti-aliased edges. */
function roundedRectDistance(px, py, halfW, halfH, radius) {
  const dx = Math.abs(px) - (halfW - radius);
  const dy = Math.abs(py) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Coverage from a signed distance: 1 inside, 0 outside, smooth across one pixel. */
function coverage(distance, softness = 1) {
  return Math.min(1, Math.max(0, 0.5 - distance / softness));
}

function blend(dst, i, rgb, alpha) {
  if (alpha <= 0) return;
  const a = Math.min(1, alpha);
  dst[i] = Math.round(dst[i] * (1 - a) + rgb[0] * a);
  dst[i + 1] = Math.round(dst[i + 1] * (1 - a) + rgb[1] * a);
  dst[i + 2] = Math.round(dst[i + 2] * (1 - a) + rgb[2] * a);
  dst[i + 3] = Math.round(Math.min(255, dst[i + 3] + 255 * a));
}

/**
 * @param {number} size
 * @param {{ plate: boolean }} options `plate: false` draws the dot alone, for a
 *   tray icon that should read against any taskbar colour.
 */
function drawMark(size, { plate }) {
  const px = Buffer.alloc(size * size * 4, 0);
  const c = (size - 1) / 2;
  const plateHalf = size * 0.46;
  const plateRadius = size * 0.22;
  const dotRadius = plate ? size * 0.22 : size * 0.38;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - c;
      const dy = y - c;

      if (plate) {
        blend(px, i, GROUND, coverage(roundedRectDistance(dx, dy, plateHalf, plateHalf, plateRadius)));
      }
      blend(px, i, RED, coverage(Math.hypot(dx, dy) - dotRadius));
    }
  }
  return px;
}

/* ------------------------------------------------------------------ PNG out */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'resources');
fs.mkdirSync(outDir, { recursive: true });

const written = [];
// Tray: the bare dot, so it reads on a light or dark taskbar. Windows picks the
// size it wants from what is offered.
for (const size of [16, 24, 32, 48]) {
  const file = path.join(outDir, `tray-${size}.png`);
  fs.writeFileSync(file, encodePng(size, drawMark(size, { plate: false })));
  written.push(path.basename(file));
}
// App icon: the dot on its plate. 512 is what electron-builder wants as a source.
for (const size of [256, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, encodePng(size, drawMark(size, { plate: true })));
  written.push(path.basename(file));
}

console.log(`resources/: ${written.join(', ')}`);
