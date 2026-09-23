import { useEffect, useState } from 'react';
import Library from './Library.js';

/**
 * The recordings window.
 *
 * Opened from the control bar and closed when it is not wanted; recording lives
 * entirely in the bar, so this window can come and go while a capture runs.
 *
 * It does one job — find, watch and delete what was recorded — so it carries no
 * recording controls at all.
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
      <Library refreshKey={savedKey} />

      <footer className="where">
        <span>Recordings are saved to {dir}</span>
      </footer>
    </main>
  );
}
