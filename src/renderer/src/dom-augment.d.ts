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
