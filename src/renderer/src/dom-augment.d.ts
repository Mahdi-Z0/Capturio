/**
 * `resizeMode` is part of the Media Capture spec and is implemented by Chromium,
 * but TypeScript's DOM lib does not declare it yet. It matters here: the default
 * 'crop-and-scale' pushes every captured frame through a resampler, which softens
 * text. No imports/exports in this file, so these merge with the global lib types.
 */

interface MediaTrackConstraintSet {
  resizeMode?: ConstrainDOMString;
}

interface MediaTrackSettings {
  resizeMode?: string;
}

interface MediaTrackSupportedConstraints {
  resizeMode?: boolean;
}

/**
 * Chromium's legacy desktop-capture constraints. Not in any current spec, and
 * therefore not in the DOM lib, but measurably faster than `getDisplayMedia`:
 * ~28 fps versus ~24.5 against a 30 fps target on this hardware.
 */
interface MediaTrackConstraints {
  mandatory?: {
    chromeMediaSource?: string;
    chromeMediaSourceId?: string;
    maxFrameRate?: number;
    minFrameRate?: number;
    maxWidth?: number;
    maxHeight?: number;
  };
}

/**
 * Breakout box: MediaStreamTrackProcessor / MediaStreamTrackGenerator.
 *
 * Chromium ships these in window scope but TypeScript's DOM lib does not declare
 * them. Region capture crops with them rather than a canvas, on measurement
 * (2026-09-23): 55.3 fps / 4.8 ms jitter / 5.5% CPU versus canvas at 53.2 fps /
 * 5.7 ms / 9%. They forward the source's own frames instead of redrawing on a
 * timer, which is why the jitter is lower.
 */
declare class MediaStreamTrackProcessor<T = VideoFrame> {
  constructor(init: { track: MediaStreamTrack; maxBufferSize?: number });
  readonly readable: ReadableStream<T>;
}

declare class MediaStreamTrackGenerator<T = VideoFrame> extends MediaStreamTrack {
  constructor(init: { kind: 'video' | 'audio' });
  readonly writable: WritableStream<T>;
}
