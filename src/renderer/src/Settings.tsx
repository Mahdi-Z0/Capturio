import { useEffect, useState } from 'react';
import MicPicker from './MicPicker.js';
import { DEFAULT_QUALITY, QUALITY_PRESETS, type QualityPreset } from '../../shared/types.js';
import { FolderIcon } from './icons.js';

/**
 * The settings that do not belong on the bar.
 *
 * The bar keeps what you change *while* recording — what to capture, and the two
 * sound switches. Quality and the microphone moved here: they are set once and
 * then left alone, and a floating strip is a poor place for a list of radio
 * buttons. There is deliberately one copy of each control, not one here and one
 * on the bar.
 */
export default function Settings(): React.JSX.Element {
  const [quality, setQuality] = useState<QualityPreset>(DEFAULT_QUALITY);
  const [dir, setDir] = useState('');
  const [free, setFree] = useState<number | null>(null);

  useEffect(() => {
    window.api
      .getQuality()
      .then(setQuality)
      .catch(() => undefined);
    window.api
      .getRecordingsDir()
      .then(setDir)
      .catch(() => undefined);
    window.api
      .getFreeSpace()
      .then(setFree)
      .catch(() => undefined);
  }, []);

  return (
    <section className="page">
      <fieldset className="picker picker--quality">
        <legend className="picker__legend">Quality</legend>
        <div className="picker__options">
          {(['balanced', 'high', 'maximum'] as QualityPreset[]).map((key) => {
            const preset = QUALITY_PRESETS[key];
            return (
              <label key={key} className={`picker__option ${quality === key ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="quality"
                  value={key}
                  checked={quality === key}
                  onChange={() => {
                    setQuality(key);
                    void window.api.setQuality(key).catch(() => undefined);
                  }}
                />
                <span className="picker__name">{preset.label}</span>
                <span className="picker__note">{preset.blurb}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Shown whatever the sound switches are set to: choosing the microphone
          before turning it on is the sensible order, and the bar no longer has
          room to ask. */}
      <div className="page__group">
        <h2 className="page__heading">Microphone</h2>
        <MicPicker disabled={false} />
      </div>

      <div className="page__group">
        <h2 className="page__heading">Where recordings are saved</h2>
        <p className="page__path">{dir || '…'}</p>
        <p className="page__note">
          {free === null
            ? 'Recordings are saved here as they are made, so nothing is lost if the app closes.'
            : `${(free / 1e9).toFixed(1)} GB free on this drive.`}
        </p>
        <button
          type="button"
          className="link"
          onClick={() => void window.api.revealFolder('').catch(() => undefined)}
        >
          <FolderIcon />
          Open in Explorer
        </button>
      </div>
    </section>
  );
}
