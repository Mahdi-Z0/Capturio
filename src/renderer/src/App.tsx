import { useEffect, useState } from 'react';
import Library from './Library.js';
import Settings from './Settings.js';
import Help from './Help.js';
import { RecordIcon } from './icons.js';
import type { LibraryTab } from '../../shared/types.js';

const TABS: { id: LibraryTab; label: string }[] = [
  { id: 'recordings', label: 'Recordings' },
  { id: 'settings', label: 'Settings' },
  { id: 'help', label: 'Help' },
];

/**
 * The recordings window.
 *
 * Opened from the control bar and closed when it is not wanted; recording lives
 * entirely in the bar, so this window can come and go while a capture runs. It is
 * never opened on launch — the app starts as the bar alone.
 *
 * Three views, because there are exactly three things that do not fit on a
 * floating strip: what you have recorded, the settings you set once, and an
 * explanation of the buttons.
 *
 * It carries one recording control and no more: a way back. Browsing a recording
 * used to be a dead end — nothing on screen led back to recording, and if the bar
 * was hidden or buried there was no way to reach it at all.
 */
export default function App(): React.JSX.Element {
  const [dir, setDir] = useState('');
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [tab, setTab] = useState<LibraryTab>('recordings');

  useEffect(() => {
    window.api
      .getRecordingsDir()
      .then(setDir)
      .catch(() => undefined);
    // A recording finished in the bar's window, not this one, so the list is
    // told rather than noticing by itself.
    return window.api.onRecordingsChanged((filePath) => setSavedKey(filePath));
  }, []);

  // Which view the bar asked for. A request made while this window was being
  // created is waiting to be collected; later ones arrive as events.
  useEffect(() => {
    void (async () => {
      const waiting = await window.api.takePendingTab().catch(() => null);
      if (waiting) setTab(waiting);
    })();
    return window.api.onLibraryTab(setTab);
  }, []);

  return (
    <main className="shell shell--library">
      <header className="libraryBar">
        <nav className="tabs" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tabs__tab ${tab === t.id ? 'is-current' : ''}`}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              {t.label}
            </button>
          ))}
        </nav>
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

      {/* The library is kept mounted across views: it holds a folder, a
          selection and a player, and losing those on a trip to Settings would
          be its own small annoyance. */}
      <div className={`view ${tab === 'recordings' ? '' : 'is-hidden'}`}>
        <Library refreshKey={savedKey} />
      </div>
      {tab === 'settings' && <Settings />}
      {tab === 'help' && <Help />}

      <footer className="where">
        <span>Saved to {dir}</span>
      </footer>
    </main>
  );
}
