import { useEffect, useState } from 'react';
import { Keys } from './Shortcuts.js';
import { SHORTCUT_LABELS, type ShortcutStatus } from '../../shared/types.js';

/**
 * Only what is not obvious from the bar itself. Anyone who has used a screen
 * recorder knows what a record button does; these are the things that behave
 * differently from what they would guess.
 */
const WORTH_KNOWING: { name: string; what: string }[] = [
  {
    name: 'Recording a window',
    what: 'Only that window is recorded, even when something covers it. A minimised window records nothing.',
  },
  {
    name: 'Recording a region',
    what: 'The red outline marks the area. It never appears in the recording, and neither does the bar.',
  },
  {
    name: 'Sound',
    what: 'Computer sound and microphone are separate switches, mixed into one track. Pick the microphone in Settings.',
  },
  {
    name: 'While recording',
    what: 'The recordings window steps aside so it is not recorded. Open it again from the bar.',
  },
  {
    name: 'Hidden bar',
    what: 'The tray icon brings it back, and so does opening Capturio again.',
  },
  {
    name: 'Several at once',
    what: 'Ctrl-click or Shift-click to select several recordings. Drag them onto a folder, or onto the path above the list.',
  },
  {
    name: 'Deleting',
    what: 'Recordings and folders go to the Recycle Bin, unless you choose Delete permanently.',
  },
  {
    name: 'Interrupted recordings',
    what: 'If Capturio or the PC stops mid-recording, what was recorded is recovered the next time it starts.',
  },
];

export default function Help(): React.JSX.Element {
  // The real combinations and whether they work, not the defaults: a key that
  // someone has changed, switched off, or lost to another program must not be
  // listed as if it works.
  const [shortcuts, setShortcuts] = useState<ShortcutStatus[]>([]);
  useEffect(() => {
    window.api
      .getShortcuts()
      .then(setShortcuts)
      .catch(() => undefined);
  }, []);

  return (
    <section className="page">
      <div className="page__group">
        <h2 className="page__heading">Shortcuts</h2>
        <ul className="keys">
          {shortcuts.map((s) => (
            <li key={s.action} className="keys__row">
              <span className="keys__name">
                <Keys accelerator={s.accelerator} />
              </span>
              <span className="keys__what">
                {SHORTCUT_LABELS[s.action]}
                {s.state === 'off' && <span className="keys__off"> · Off</span>}
                {s.state === 'taken' && (
                  <span className="keys__warn"> · In use by Windows or another program</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="page__group">
        <h2 className="page__heading">Worth knowing</h2>
        <ul className="keys">
          {WORTH_KNOWING.map((item) => (
            <li key={item.name} className="keys__row">
              <span className="keys__name">{item.name}</span>
              <span className="keys__what">{item.what}</span>
            </li>
          ))}
        </ul>
        {/* The same tour a fresh install opens with, on the live bar. */}
        <button
          type="button"
          className="link"
          onClick={() => void window.api.startTour().catch(() => undefined)}
        >
          Show me around the bar
        </button>
      </div>
    </section>
  );
}
