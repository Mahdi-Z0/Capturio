import { useEffect, useState } from 'react';
import MicPicker from './MicPicker.js';
import Shortcuts from './Shortcuts.js';
import {
  DEFAULT_QUALITY,
  QUALITY_PRESETS,
  type QualityPreset,
  type RecordingsFolder,
  type RecordingsFolderUpdate,
} from '../../shared/types.js';
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
export default function Settings({
  onFolderChanged,
}: {
  /** The recordings folder moved: the window's footer and library follow it. */
  onFolderChanged: (path: string) => void;
}): React.JSX.Element {
  const [quality, setQuality] = useState<QualityPreset>(DEFAULT_QUALITY);
  const [folder, setFolder] = useState<RecordingsFolder | null>(null);
  const [folderProblem, setFolderProblem] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [free, setFree] = useState<number | null>(null);

  useEffect(() => {
    window.api
      .getQuality()
      .then(setQuality)
      .catch(() => undefined);
    window.api
      .getRecordingsFolder()
      .then(setFolder)
      .catch(() => undefined);
    window.api
      .getFreeSpace()
      .then(setFree)
      .catch(() => undefined);
  }, []);

  const changeFolder = (ask: () => Promise<RecordingsFolderUpdate>): void => {
    setFolderProblem(null);
    setChoosing(true);
    ask()
      .then((update) => {
        setFolder(update.folder);
        setFolderProblem(update.problem);
        if (!update.changed) return;
        onFolderChanged(update.folder.path);
        // Free space is per drive, and the new folder may be on another one.
        return window.api.getFreeSpace().then(setFree);
      })
      .catch(() => setFolderProblem('The folder could not be changed.'))
      .finally(() => setChoosing(false));
  };

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

      <Shortcuts />

      <div className="page__group">
        <h2 className="page__heading">Where recordings are saved</h2>
        <p className="page__path">{folder?.path ?? '…'}</p>
        {folder?.unavailable && (
          <p className="page__note is-warn">
            {folder.unavailable} is not available, so recordings are saved here until it is.
          </p>
        )}
        <p className="page__note">
          {free !== null && `${(free / 1e9).toFixed(1)} GB free on this drive. `}
          Changing the folder does not move recordings already made.
        </p>
        <div className="page__actions">
          <button
            type="button"
            className="link"
            disabled={choosing}
            onClick={() => changeFolder(() => window.api.chooseRecordingsFolder())}
          >
            Change…
          </button>
          {folder && !folder.isDefault && (
            <button
              type="button"
              className="link"
              disabled={choosing}
              onClick={() => changeFolder(() => window.api.useDefaultRecordingsFolder())}
            >
              Use the default folder
            </button>
          )}
          <button
            type="button"
            className="link"
            onClick={() => void window.api.revealFolder('').catch(() => undefined)}
          >
            <FolderIcon />
            Open in Explorer
          </button>
        </div>
        {folderProblem && (
          <p className="page__note is-warn" role="alert">
            {folderProblem}
          </p>
        )}
      </div>
    </section>
  );
}
