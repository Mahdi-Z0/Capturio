import { useCallback, useEffect, useState } from 'react';
import { useRecorder } from './useRecorder.js';
import { DEFAULT_QUALITY, QUALITY_PRESETS, type QualityPreset } from '../../shared/types.js';

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const PRESET_ORDER: QualityPreset[] = ['balanced', 'high', 'maximum'];

export default function App(): React.JSX.Element {
  const { status, elapsedMs, lastSaved, error, captureInfo, activePreset, start, stop } =
    useRecorder();
  const [dir, setDir] = useState('');
  const [quality, setQuality] = useState<QualityPreset>(DEFAULT_QUALITY);

  useEffect(() => {
    window.api
      .getRecordingsDir()
      .then(setDir)
      .catch(() => undefined);
    window.api
      .getQuality()
      .then(setQuality)
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

  return (
    <main className="shell">
      <div className="stage">
        <button
          type="button"
          className={`trigger ${recording ? 'is-recording' : ''}`}
          onClick={() => (recording ? stop() : void start())}
          disabled={busy}
          aria-label={recording ? 'Stop recording' : 'Start recording'}
        >
          <span className="trigger__glyph" aria-hidden="true" />
        </button>

        <p className="readout" role="status">
          {status === 'starting' && 'Waiting for the screen…'}
          {status === 'saving' && 'Writing the file…'}
          {recording && <span className="clock">{formatElapsed(elapsedMs)}</span>}
          {status === 'idle' && (error ? error : 'Ready to record your main screen.')}
        </p>
      </div>

      <fieldset className="quality" disabled={locked}>
        <legend className="quality__legend">
          Recording quality
          {locked && <span className="quality__lockNote">locked while recording</span>}
        </legend>
        <div className="quality__options">
          {PRESET_ORDER.map((key) => {
            const p = QUALITY_PRESETS[key];
            return (
              <label key={key} className={`quality__option ${quality === key ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="quality"
                  value={key}
                  checked={quality === key}
                  onChange={() => choose(key)}
                />
                <span className="quality__name">
                  {p.label}
                  {p.recommended && <span className="quality__rec">recommended</span>}
                </span>
                <span className="quality__note">{p.blurb}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {lastSaved && (
        <div className="saved">
          <span className="saved__name">{lastSaved.fileName}</span>
          <button
            type="button"
            className="link"
            onClick={() => void window.api.revealRecording(lastSaved.filePath)}
          >
            Show in folder
          </button>
        </div>
      )}

      <footer className="where">
        {captureInfo && activePreset ? (
          <span>
            Recording {captureInfo.width}×{captureInfo.height} at {captureInfo.frameRate} fps, using
            the {QUALITY_PRESETS[activePreset].label} preset (
            {Math.round(QUALITY_PRESETS[activePreset].videoBitsPerSecond / 1_000_000)} Mbps ceiling)
          </span>
        ) : (
          <span>Recordings are saved to {dir}</span>
        )}
      </footer>
    </main>
  );
}
