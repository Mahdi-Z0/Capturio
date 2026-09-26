import { useEffect, useState } from 'react';
import Library from './Library.js';
import { RecordIcon } from './icons.js';

/**
 * The recordings window.
 *
 * Opened from the control bar and closed when it is not wanted; recording lives
 * entirely in the bar, so this window can come and go while a capture runs.
 *
 * It carries one recording control and no more: a way back. Browsing a recording
 * used to be a dead end — nothing on screen led back to recording, and if the bar
 * was hidden or buried there was no way to reach it at all.
 */
export default function App(): React.JSX.Element {
  const [dir, setDir] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(null);

  useEffect(() => {
    window.api
      .getRecordingsDir()
      .then(setDir)
      .catch(() => undefined);
    // A recording finished in the bar's window, not this one, so the list is
    // told rather than noticing by itself.
    return window.api.onRecordingsChanged((filePath) => setSavedKey(filePath));
  }, []);

  return (
    <main className="shell shell--library">
      <header className="libraryBar">
        <h1 className="libraryBar__title">Recordings</h1>
        <button
          type="button"
          className="recordBack"
          onClick={() => void window.api.showBar()}
          title="Bring the recording bar back"
        >
          <RecordIcon />
          Record
        </button>
      </header>

      <Library refreshKey={savedKey} />

      <footer className="where">
        <span>Saved to {dir}</span>
      </footer>
    </main>
  );
}
