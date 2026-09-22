/**
 * Make a MediaRecorder WebM seekable.
 *
 * MediaRecorder writes WebM in its live-streaming profile: the Segment size is
 * left unknown, no `Duration` is written (it cannot be known while recording),
 * and no `Cues` index is produced. Measured 2026-09-18 across every recording on
 * disk -- all four had Segment=UNKNOWN, Duration=ABSENT, Cues=ABSENT.
 *
 * The consequences are not cosmetic: `video.duration` resolves to `Infinity`, so
 * a scrubber maps to a fabricated timeline, and a seek has no index to seek with,
 * so Chromium linearly scans and appears to hang. Every player is affected, not
 * just this app's.
 *
 * Switching container was considered and rejected on measurement: Chromium's MP4
 * muxer emits nothing until stop (2 chunks, both at 6006 ms for a 6 s recording,
 * versus WebM's 6 chunks at ~1 s intervals). That would hold the entire recording
 * in renderer memory and lose all of it to a power cut -- the exact failure this
 * project already suffered. WebM streams; it just needs finishing afterwards.
 *
 * So: rewrite once, after the bytes are safely on disk. Cluster payloads are
 * copied byte-for-byte and never re-encoded; only the header gains a Duration and
 * the file gains a Cues index at the end.
 *
 * Plain CommonJS with no Electron import, matching `recordingPath.cjs`, so
 * `scripts/verify-finalize.cjs` exercises this same code with no build step. A
 * verifier that reimplements what it tests is worse than none.
 */

const fs = require('node:fs');

/* ---------------------------------------------------------------- EBML ids */

const ID = {
  SEGMENT: Buffer.from([0x18, 0x53, 0x80, 0x67]),
  SEEK_HEAD: Buffer.from([0x11, 0x4d, 0x9b, 0x74]),
  SEEK: Buffer.from([0x4d, 0xbb]),
  SEEK_ID: Buffer.from([0x53, 0xab]),
  SEEK_POSITION: Buffer.from([0x53, 0xac]),
  INFO: Buffer.from([0x15, 0x49, 0xa9, 0x66]),
  DURATION: Buffer.from([0x44, 0x89]),
  TRACKS: Buffer.from([0x16, 0x54, 0xae, 0x6b]),
  TRACK_ENTRY: Buffer.from([0xae]),
  TRACK_NUMBER: Buffer.from([0xd7]),
  TRACK_TYPE: Buffer.from([0x83]),
  CLUSTER: Buffer.from([0x1f, 0x43, 0xb6, 0x75]),
  TIMECODE: Buffer.from([0xe7]),
  SIMPLE_BLOCK: Buffer.from([0xa3]),
  BLOCK_GROUP: Buffer.from([0xa0]),
  CUES: Buffer.from([0x1c, 0x53, 0xbb, 0x6b]),
  CUE_POINT: Buffer.from([0xbb]),
  CUE_TIME: Buffer.from([0xb3]),
  CUE_TRACK_POSITIONS: Buffer.from([0xb7]),
  CUE_TRACK: Buffer.from([0xf7]),
  CUE_CLUSTER_POSITION: Buffer.from([0xf1]),
};

const HEX = Object.fromEntries(Object.entries(ID).map(([k, v]) => [k, v.toString('hex')]));

/* ------------------------------------------------------- buffered reading */

/**
 * Sequential reader over a file descriptor with a sliding window.
 *
 * Recordings reach hundreds of megabytes, so the file is never loaded whole.
 * Parsing only ever inspects element headers, which are a handful of bytes each,
 * and it moves forward, so one window serves nearly every read.
 */
class Reader {
  constructor(fd, size, windowSize = 1 << 20) {
    this.fd = fd;
    this.size = size;
    this.buf = Buffer.alloc(windowSize);
    this.start = 0;
    this.filled = 0;
  }

  /** Returns a buffer containing [off, off+len), and the index where it begins. */
  at(off, len) {
    if (off < this.start || off + len > this.start + this.filled) {
      if (len > this.buf.length) this.buf = Buffer.alloc(len);
      this.start = off;
      this.filled = fs.readSync(this.fd, this.buf, 0, Math.min(this.buf.length, this.size - off), off);
      if (this.filled < len) throw new Error(`truncated read at ${off}`);
    }
    return { buf: this.buf, i: off - this.start };
  }

  byte(off) {
    const { buf, i } = this.at(off, 1);
    return buf[i];
  }

  slice(off, len) {
    const { buf, i } = this.at(off, len);
    return buf.subarray(i, i + len);
  }
}

/* -------------------------------------------------------- EBML primitives */

/** Element ids keep their marker bit; sizes strip it. */
function readVint(reader, off, strip) {
  const first = reader.byte(off);
  if (first === undefined) return null;
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(first & mask)) {
    mask >>= 1;
    len++;
  }
  if (len > 8) return null;

  let value = strip ? first & (mask - 1) : first;
  // An all-ones value means "unknown size" -- MediaRecorder uses it for Segment
  // and for every Cluster, which is exactly why this file needs finishing.
  let unknown = strip && (first & (mask - 1)) === (mask - 1);
  for (let i = 1; i < len; i++) {
    const b = reader.byte(off + i);
    value = value * 256 + b;
    if (b !== 0xff) unknown = false;
  }
  return { value, length: len, unknown };
}

function readUint(reader, off, len) {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + reader.byte(off + i);
  return v;
}

/** Encode an integer as an EBML size vint of an exact width, so layout is stable. */
function sizeVint(value, width) {
  const out = Buffer.alloc(width);
  let v = value;
  for (let i = width - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 1 << (8 - width);
  return out;
}

/** Shortest big-endian encoding of an unsigned integer, minimum one byte. */
function uintBytes(value) {
  const out = [];
  let v = Math.max(0, Math.round(value));
  do {
    out.unshift(v % 256);
    v = Math.floor(v / 256);
  } while (v > 0);
  return Buffer.from(out);
}

function minimalSizeVint(value) {
  for (let width = 1; width <= 8; width++) {
    const max = Math.pow(2, 7 * width) - 1;
    if (value < max) return sizeVint(value, width);
  }
  throw new Error('element too large');
}

function elem(id, payload) {
  return Buffer.concat([id, minimalSizeVint(payload.length), payload]);
}

function uintElem(id, value) {
  return elem(id, uintBytes(value));
}

/** Fixed 8-byte position, so adding a SeekHead never shifts what follows it. */
function positionElem(id, value) {
  const payload = Buffer.alloc(8);
  let v = Math.round(value);
  for (let i = 7; i >= 0; i--) {
    payload[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return elem(id, payload);
}

/* ------------------------------------------------------------- inspection */

/**
 * Walk the file structure without decoding any media.
 *
 * Returns the byte ranges the rewrite needs, one entry per cluster for the cue
 * index, and the true duration derived from the last block's timestamp.
 */
function analyze(reader) {
  const out = {
    segmentStart: null,
    segmentDataStart: null,
    info: null,
    tracks: null,
    clusters: [],
    clustersStart: null,
    clustersEnd: null,
    durationMs: 0,
    videoTrack: null,
    hasDuration: false,
    hasCues: false,
    segmentSizeKnown: false,
  };

  // Top level: EBML header, then Segment.
  let off = 0;
  while (off < reader.size) {
    const id = readVint(reader, off, false);
    if (!id) break;
    const hex = reader.slice(off, id.length).toString('hex');
    const size = readVint(reader, off + id.length, true);
    if (!size) break;
    const dataOff = off + id.length + size.length;
    if (hex === HEX.SEGMENT) {
      out.segmentStart = off;
      out.segmentDataStart = dataOff;
      out.segmentSizeKnown = !size.unknown;
      break;
    }
    off = dataOff + size.value;
  }
  if (out.segmentDataStart === null) throw new Error('no Segment element');

  // Level 1 inside the Segment.
  off = out.segmentDataStart;
  while (off < reader.size) {
    const id = readVint(reader, off, false);
    if (!id || id.length > 4) break;
    const hex = reader.slice(off, id.length).toString('hex');
    const size = readVint(reader, off + id.length, true);
    if (!size) break;
    const dataOff = off + id.length + size.length;

    if (hex === HEX.CLUSTER) {
      if (out.clustersStart === null) out.clustersStart = off;
      // `keyTime` stays undefined for a cluster whose video starts mid-GOP. Those
      // must not become cue points -- see the cue construction below.
      const cluster = { start: off, timecode: 0, keyTime: undefined };
      const end = scanCluster(reader, dataOff, size, cluster, out);
      out.clusters.push(cluster);
      out.clustersEnd = end;
      off = end;
      continue;
    }

    if (size.unknown) break; // nothing but a Cluster should be unknown-size

    if (hex === HEX.INFO) {
      out.info = { start: off, dataStart: dataOff, dataLength: size.value };
      scanInfo(reader, dataOff, size.value, out);
    } else if (hex === HEX.TRACKS) {
      out.tracks = { start: off, length: dataOff + size.value - off };
      scanTracks(reader, dataOff, size.value, out);
    } else if (hex === HEX.CUES) {
      out.hasCues = true;
    }
    off = dataOff + size.value;
  }

  if (!out.info) throw new Error('no Info element');
  if (!out.tracks) throw new Error('no Tracks element');
  if (!out.clusters.length) throw new Error('no Clusters');
  return out;
}

function scanInfo(reader, dataOff, length, out) {
  let off = dataOff;
  const end = dataOff + length;
  while (off < end) {
    const id = readVint(reader, off, false);
    if (!id) return;
    const hex = reader.slice(off, id.length).toString('hex');
    const size = readVint(reader, off + id.length, true);
    if (!size) return;
    if (hex === HEX.DURATION) out.hasDuration = true;
    off = off + id.length + size.length + size.value;
  }
}

function scanTracks(reader, dataOff, length, out) {
  const end = dataOff + length;
  let off = dataOff;
  while (off < end) {
    const id = readVint(reader, off, false);
    if (!id) return;
    const hex = reader.slice(off, id.length).toString('hex');
    const size = readVint(reader, off + id.length, true);
    if (!size) return;
    const entryData = off + id.length + size.length;
    if (hex === HEX.TRACK_ENTRY) {
      let number = null;
      let type = null;
      let p = entryData;
      const entryEnd = entryData + size.value;
      while (p < entryEnd) {
        const cid = readVint(reader, p, false);
        if (!cid) break;
        const chex = reader.slice(p, cid.length).toString('hex');
        const csz = readVint(reader, p + cid.length, true);
        if (!csz) break;
        const cdata = p + cid.length + csz.length;
        if (chex === HEX.TRACK_NUMBER) number = readUint(reader, cdata, csz.value);
        if (chex === HEX.TRACK_TYPE) type = readUint(reader, cdata, csz.value);
        p = cdata + csz.value;
      }
      // Type 1 is video. Cues index the video track: seeking to an audio packet
      // would land the player between video keyframes.
      if (type === 1 && out.videoTrack === null) out.videoTrack = number;
    }
    off = entryData + size.value;
  }
}

/**
 * Find where an unknown-size cluster ends, and the newest timestamp inside it.
 *
 * An unknown-size cluster ends where the next level-1 element begins, so its
 * children must be walked. Block payloads are skipped by their declared size --
 * never parsed.
 */
function scanCluster(reader, dataOff, size, cluster, out) {
  if (!size.unknown) {
    const end = dataOff + size.value;
    walkClusterChildren(reader, dataOff, end, cluster, out);
    return end;
  }
  let off = dataOff;
  while (off < reader.size) {
    const id = readVint(reader, off, false);
    if (!id) break;
    const hex = reader.slice(off, id.length).toString('hex');
    if (hex === HEX.CLUSTER || hex === HEX.CUES || hex === HEX.TRACKS || hex === HEX.INFO) break;
    const csz = readVint(reader, off + id.length, true);
    if (!csz || csz.unknown) break;
    const cdata = off + id.length + csz.length;
    readClusterChild(reader, hex, cdata, csz.value, cluster, out);
    off = cdata + csz.value;
  }
  return off;
}

function walkClusterChildren(reader, from, to, cluster, out) {
  let off = from;
  while (off < to) {
    const id = readVint(reader, off, false);
    if (!id) return;
    const hex = reader.slice(off, id.length).toString('hex');
    const csz = readVint(reader, off + id.length, true);
    if (!csz || csz.unknown) return;
    const cdata = off + id.length + csz.length;
    readClusterChild(reader, hex, cdata, csz.value, cluster, out);
    off = cdata + csz.value;
  }
}

function readClusterChild(reader, hex, dataOff, length, cluster, out) {
  if (hex === HEX.TIMECODE) {
    cluster.timecode = readUint(reader, dataOff, length);
    if (cluster.timecode > out.durationMs) out.durationMs = cluster.timecode;
    return;
  }
  if (hex === HEX.SIMPLE_BLOCK) {
    const track = readVint(reader, dataOff, true);
    if (!track) return;
    // Block header: track vint, signed 16-bit relative timestamp, then flags.
    const header = reader.slice(dataOff + track.length, 3);
    const rel = header.readInt16BE(0);
    const keyframe = (header[2] & 0x80) !== 0;
    const abs = cluster.timecode + rel;
    if (abs > out.durationMs) out.durationMs = abs;

    // The first decodable video point in this cluster, if there is one.
    //
    // Audio blocks are all keyframes, so keying off "any keyframe" would happily
    // index a cluster whose video starts mid-GOP. Seeking there hands the decoder
    // a frame whose references are missing, which surfaces as
    // PIPELINE_ERROR_DECODE and kills playback for every later seek.
    if (track.value === out.videoTrack && keyframe && cluster.keyTime === undefined) {
      cluster.keyTime = abs;
    }
  }
}

/* ---------------------------------------------------------------- rewrite */

/**
 * Rewrite `srcPath` to `destPath` with a declared Segment size, a Duration, and
 * a Cues index.
 *
 * Never modifies the source. The caller keeps it until this resolves, so a
 * failure here costs the seek index, never the recording.
 */
async function finalizeWebm(srcPath, destPath) {
  const fd = fs.openSync(srcPath, 'r');
  let plan;
  try {
    const { size } = fs.fstatSync(fd);
    const reader = new Reader(fd, size);
    const info = analyze(reader);

    if (info.hasDuration && info.hasCues && info.segmentSizeKnown) {
      throw new Error('already finalized');
    }
    if (!info.durationMs) throw new Error('no timestamps found');

    const header = Buffer.from(reader.slice(0, info.segmentStart));
    const infoPayload = Buffer.from(reader.slice(info.info.dataStart, info.info.dataLength));
    const tracks = Buffer.from(reader.slice(info.tracks.start, info.tracks.length));

    // TimecodeScale is 1 ms per tick in everything MediaRecorder writes, and
    // Duration is expressed in those ticks, so the millisecond count goes in as-is.
    const durationPayload = Buffer.alloc(8);
    durationPayload.writeDoubleBE(info.durationMs);
    const newInfo = elem(ID.INFO, Buffer.concat([infoPayload, elem(ID.DURATION, durationPayload)]));

    // Fixed-width positions keep the SeekHead a constant size, so it can be
    // built before the offsets it points at are known.
    const seekEntry = (id, position) =>
      elem(ID.SEEK, Buffer.concat([elem(ID.SEEK_ID, id), positionElem(ID.SEEK_POSITION, position)]));
    const seekHeadSize = elem(
      ID.SEEK_HEAD,
      Buffer.concat([seekEntry(ID.INFO, 0), seekEntry(ID.TRACKS, 0), seekEntry(ID.CUES, 0)]),
    ).length;

    const clusterBytes = info.clustersEnd - info.clustersStart;
    const infoPos = seekHeadSize;
    const tracksPos = infoPos + newInfo.length;
    const clustersPos = tracksPos + tracks.length;
    const cuesPos = clustersPos + clusterBytes;

    const seekHead = elem(
      ID.SEEK_HEAD,
      Buffer.concat([
        seekEntry(ID.INFO, infoPos),
        seekEntry(ID.TRACKS, tracksPos),
        seekEntry(ID.CUES, cuesPos),
      ]),
    );
    if (seekHead.length !== seekHeadSize) throw new Error('seek head size drifted');

    const track = info.videoTrack ?? 1;

    // Only clusters that actually contain a video keyframe. A cue is a promise
    // that playback can start at that point; one pointing anywhere else is worse
    // than no cue at all.
    const seekable = info.clusters.filter((c) => c.keyTime !== undefined);
    if (seekable.length === 0) throw new Error('no video keyframes found to index');

    const cues = elem(
      ID.CUES,
      Buffer.concat(
        seekable.map((c) =>
          elem(
            ID.CUE_POINT,
            Buffer.concat([
              // The keyframe's own timestamp, not the cluster's: they differ
              // whenever the cluster opens with audio.
              uintElem(ID.CUE_TIME, c.keyTime),
              elem(
                ID.CUE_TRACK_POSITIONS,
                Buffer.concat([
                  uintElem(ID.CUE_TRACK, track),
                  // Positions are relative to the start of Segment *data*.
                  uintElem(ID.CUE_CLUSTER_POSITION, clustersPos + (c.start - info.clustersStart)),
                ]),
              ),
            ]),
          ),
        ),
      ),
    );

    const segmentDataLength = seekHead.length + newInfo.length + tracks.length + clusterBytes + cues.length;

    await writeOut(destPath, {
      header,
      segmentSize: sizeVint(segmentDataLength, 8),
      prefix: Buffer.concat([seekHead, newInfo, tracks]),
      srcPath,
      clustersStart: info.clustersStart,
      clusterBytes,
      cues,
    });

    plan = {
      durationMs: info.durationMs,
      cuePoints: seekable.length,
      clusters: info.clusters.length,
      videoTrack: track,
      bytesCopied: clusterBytes,
    };
  } finally {
    fs.closeSync(fd);
  }
  return plan;
}

function writeOut(destPath, parts) {
  return new Promise((resolve, reject) => {
    // 'wx': refuse to clobber. A finalized file landing on an existing recording
    // would be a data-loss bug wearing a success message.
    const out = fs.createWriteStream(destPath, { flags: 'wx' });
    out.on('error', reject);

    out.write(parts.header);
    out.write(ID.SEGMENT);
    out.write(parts.segmentSize);
    out.write(parts.prefix);

    const clusters = fs.createReadStream(parts.srcPath, {
      start: parts.clustersStart,
      end: parts.clustersStart + parts.clusterBytes - 1,
    });
    clusters.on('error', reject);
    clusters.pipe(out, { end: false });
    clusters.on('end', () => {
      out.end(parts.cues, () => resolve());
    });
  });
}

/** Re-read a finalized file and confirm it carries what it claims. */
function inspect(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const info = analyze(new Reader(fd, size));
    return {
      durationMs: info.durationMs,
      hasDuration: info.hasDuration,
      hasCues: info.hasCues,
      segmentSizeKnown: info.segmentSizeKnown,
      clusters: info.clusters.length,
      videoTrack: info.videoTrack,
      bytes: size,
    };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { finalizeWebm, inspect, analyze, Reader };
