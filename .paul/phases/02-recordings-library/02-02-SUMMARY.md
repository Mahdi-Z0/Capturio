---
description: 'Plan 02-02 — thumbnails: what shipped'
type: PlanSummary
closed: 2026-09-25
---

# 02-02 — Library thumbnails

Parked 2026-09-18 (0 feature points), resumed and shipped 2026-09-25.

## What was built

- Cache under `userData/thumbnails`, keyed by name + size + mtime, atomic writes, capped at 64 MB
  (oldest first), pruned at startup against the recordings that still exist.
- `thumbs:get` / `thumbs:put`, both containment-validated. `put` refuses non-JPEG bytes, anything
  over 256 KB, and any path outside the recordings folder.
- Frames captured from the probe the library already opens for durations — one decode per tile.
- `object-fit: contain`, because a region recording can be any shape and cropping would hide the
  part that identifies it.

## Two silent failures found by tracing, not by reading

The first two attempts produced **zero** thumbnails with no error anywhere:

1. `recording:` was not registered `corsEnabled`, so the probe failed to load entirely
   (`MEDIA_ELEMENT_ERROR: Format error`) as soon as it set `crossOrigin`.
2. The protocol did not send `Access-Control-Allow-Origin`, so the canvas was tainted and `toBlob`
   returned null — no exception, no image.

Both now covered by `npm run verify:range`.

## Verification (built app)

| check | result |
| ----- | ------ |
| thumbnails drawn for the visible tiles | 2 of 3 |
| the third | `DEMUXER_ERROR_COULD_NOT_OPEN` — a 0-byte file, not a thumbnail fault |
| cache on disk | 2 entries, 24 KB |
| refuses non-JPEG bytes | "Not a JPEG" |
| refuses over 256 KB | "Thumbnail too large" |
| refuses a path outside the recordings folder | "Refusing to act on a path outside the recordings folder" |

## Found while verifying

A recording that captures nothing was still saved as a 0-byte file, which then sat in the library
unplayable forever. `recordings:finish` now discards an empty part and reports "Nothing was
recorded".
