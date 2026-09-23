import { useCallback, useEffect, useState } from 'react';
import { useRecorder } from './useRecorder.js';
import Library from './Library.js';
import MicPicker from './MicPicker.js';
import WindowPicker from './WindowPicker.js';
import type { CaptureInfo } from './useRecorder.js';
import {
  AUDIO_MODES,
  AUDIO_ORDER,
  DEFAULT_AUDIO_MODE,
  DEFAULT_QUALITY,
  QUALITY_PRESETS,
  SCREEN_TARGET,
  type AudioMode,
  type CaptureTarget,
  type RegionRect,
  type QualityPreset,
} from '../../shared/types.js';

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const PRESET_ORDER: QualityPreset[] = ['balanced', 'high', 'maximum'];

/** The footer's audio clause: the sources that exist, never the setting chosen. */
function describeAudio(info: CaptureInfo): string {
  const { system, microphone } = info.audioSources;
  if (system && microphone) return 'with computer audio and microphone';
  if (system) return 'with computer audio';
  if (microphone) return 'with microphone';
  return info.audioRequested ? 'with no sound (audio was unavailable)' : 'with no sound';
}

export default function App(): React.JSX.Element {
  const {
    status,
    elapsedMs,
    lastSaved,
    error,
    captureInfo,
    activePreset,
    paused,
    muted,
    start,
    stop,
    pause,
    resume,
    toggleMute,
  } = useRecorder();
  const [dir, setDir] = useState('');
  const [quality, setQuality] = useState<QualityPreset>(DEFAULT_QUALITY);
  const [audio, setAudio] = useState<AudioMode>(DEFAULT_AUDIO_MODE);
  const [sourceKind, setSourceKind] = useState<'screen' | 'window' | 'region'>('screen');
  const [windowTarget, setWindowTarget] = useState<CaptureTarget | null>(null);
  const [region, setRegion] = useState<RegionRect | null>(null);

  useEffect(() => {
    window.api
      .getRecordingsDir()
      .then(setDir)
      .catch(() => undefined);
    window.api
      .getQuality()
      .then(setQuality)
      .catch(() => undefined);
    window.api
      .getAudioMode()
      .then(setAudio)
      .catch(() => undefined);
  }, []);

  const recording = status === 'recording';
  const busy = status === 'starting' || status === 'saving';
  // Locked on anything but idle: a change during 'starting' would race the
  // constraint read, and during 'saving' would imply it affected a finished file.
  const locked = status !== 'idle';

  const choose = useCallback((next: QualityPreset) => {
    setQuality(next);
    void window.api.setQuality(next).catch(() => undefined);
  }, []);

  const chooseAudio = useCallback((next: AudioMode) => {
    setAudio(next);
    void window.api.setAudioMode(next).catch(() => undefined);
  }, []);

  // A requested source did not arrive. Worth saying while it is still happening --
  // at idle the readout carries the same sentence as the error, so this covers
  // the gap where the clock is showing and the error line is not.
  const audioNote = captureInfo?.audioNote ?? null;

  const target: CaptureTarget | null =
    sourceKind === 'screen'
      ? SCREEN_TARGET
      : sourceKind === 'window'
        ? windowTarget
        : region
          ? { kind: 'region', rect: region }
          : null;
  const pickWindow = useCallback((t: CaptureTarget | null) => setWindowTarget(t), []);
  const idleText =
    target === null
      ? sourceKind === 'region'
        ? 'Choose a region below to record it.'
        : 'Pick a window below to record it.'
      : target.kind === 'window'
        ? `Ready to record “${target.name}”.`
        : target.kind === 'region'
          ? `Ready to record a ${target.rect.width} × ${target.rect.height} region.`
          : 'Ready to record your main screen.';

  const chooseRegion = useCallback(() => {
    window.api
      .selectRegion()
      // Cancelling keeps whatever was chosen before, so an accidental Esc does
      // not discard a region that was already set.
      .then((r) => r && setRegion(r))
      .catch(() => undefined);
  }, []);

  return (
    <main className="shell">
      <div className="stage">
        <button
          type="button"
          className={`trigger ${recording ? 'is-recording' : ''}`}
          onClick={() => (recording ? stop() : target && void start(target))}
          // Nothing to record yet is a reason to disable, not to fail on click.
          disabled={busy || (!recording && target === null)}
          aria-label={recording ? 'Stop recording' : 'Start recording'}
        >
          <span className="trigger__glyph" aria-hidden="true" />
        </button>

        <p className="readout" role="status">
          {status === 'starting' && 'Waiting for the screen…'}
          {status === 'saving' && 'Writing the file…'}
          {recording && (
            <span className={`clock ${paused ? 'is-paused' : ''}`}>
              {formatElapsed(elapsedMs)}
              {paused && <span className="clock__note">paused</span>}
            </span>
          )}
          {status === 'idle' && (error ? error : idleText)}
          {locked && audioNote && <span className="readout__warn">{audioNote}</span>}
        </p>
        {/* Mirrors the overlay indicator. The overlay is reachable while other
            windows are in front; this is reachable when the app itself is. */}
        {recording && (
          <div className="liveControls">
            <button type="button" className="liveBtn" onClick={() => (paused ? resume() : pause())}>
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              className="liveBtn"
              onClick={toggleMute}
              disabled={!captureInfo?.audioObtained}
              title={
                captureInfo?.audioObtained ? undefined : 'This recording has no audio track to mute'
              }
            >
              {muted ? 'Unmute audio' : 'Mute audio'}
            </button>
          </div>
        )}
      </div>

      <fieldset className="picker picker--source" disabled={locked}>
        <legend className="picker__legend">
          What to record
          {locked && <span className="picker__lockNote">locked while recording</span>}
        </legend>
        <div className="picker__options">
          {(
            [
              ['screen', 'Entire screen', 'Everything on your main display'],
              ['window', 'One window', 'Only the app you pick'],
              ['region', 'A region', 'Any rectangle you drag'],
            ] as const
          ).map(([key, label, blurb]) => (
            <label key={key} className={`picker__option ${sourceKind === key ? 'is-selected' : ''}`}>
              <input
                type="radio"
                name="source"
                value={key}
                checked={sourceKind === key}
                onChange={() => setSourceKind(key)}
              />
              <span className="picker__name">{label}</span>
              <span className="picker__note">{blurb}</span>
            </label>
          ))}
        </div>
        {sourceKind === 'region' && (
          <div className="region__choice">
            <button type="button" className="liveBtn" onClick={chooseRegion} disabled={locked}>
              {region ? 'Choose a different region' : 'Choose region…'}
            </button>
            {region && (
              <span className="region__chosen">
                {region.width} × {region.height} at ({region.x}, {region.y})
              </span>
            )}
          </div>
        )}
        {sourceKind === 'window' && (
          <WindowPicker
            selectedId={windowTarget?.kind === 'window' ? windowTarget.id : null}
            onSelect={pickWindow}
            disabled={locked}
          />
        )}
      </fieldset>

      <fieldset className="picker picker--quality" disabled={locked}>
        <legend className="picker__legend">
          Recording quality
          {locked && <span className="picker__lockNote">locked while recording</span>}
        </legend>
        <div className="picker__options">
          {PRESET_ORDER.map((key) => {
            const p = QUALITY_PRESETS[key];
            return (
              <label key={key} className={`picker__option ${quality === key ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="quality"
                  value={key}
                  checked={quality === key}
                  onChange={() => choose(key)}
                />
                <span className="picker__name">
                  {p.label}
                  {p.recommended && <span className="picker__rec">recommended</span>}
                </span>
                <span className="picker__note">{p.blurb}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="picker picker--audio" disabled={locked}>
        <legend className="picker__legend">
          Sound
          {locked && <span className="picker__lockNote">locked while recording</span>}
        </legend>
        <div className="picker__options">
          {AUDIO_ORDER.map((key) => {
            const a = AUDIO_MODES[key];
            return (
              <label key={key} className={`picker__option ${audio === key ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="audio"
                  value={key}
                  checked={audio === key}
                  onChange={() => chooseAudio(key)}
                />
                <span className="picker__name">{a.label}</span>
                <span className="picker__note">{a.blurb}</span>
              </label>
            );
          })}
        </div>
        {AUDIO_MODES[audio].microphone && <MicPicker disabled={locked} />}
      </fieldset>

      {/* The saved-file row was removed with the library: a new recording now
          appears at the top of the list, which is the same confirmation without
          a second element competing for the same job. */}
      <Library refreshKey={lastSaved?.filePath ?? null} />

      <footer className="where">
        {captureInfo && activePreset ? (
          <span>
            Recording {captureInfo.width}×{captureInfo.height} at {captureInfo.frameRate} fps{' '}
            {describeAudio(captureInfo)}
            , using the {QUALITY_PRESETS[activePreset].label} preset (
            {Math.round(QUALITY_PRESETS[activePreset].videoBitsPerSecond / 1_000_000)} Mbps ceiling)
          </span>
        ) : (
          <span>Recordings are saved to {dir}</span>
        )}
      </footer>
    </main>
  );
}
