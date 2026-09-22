import { useCallback, useEffect, useState } from 'react';
import type { CaptureSource, CaptureTarget } from '../../shared/types.js';

interface Props {
  selectedId: string | null;
  onSelect: (target: CaptureTarget | null) => void;
  disabled: boolean;
}

/**
 * Pick one open window to record.
 *
 * Thumbnails, because window titles alone are ambiguous -- three browser windows
 * all called "Google Chrome" are only distinguishable by what they show.
 *
 * Refreshes when this app regains focus: the usual flow is "open the thing I
 * want to record, come back, pick it", and a stale list would not contain it.
 */
export default function WindowPicker({ selectedId, onSelect, disabled }: Props): React.JSX.Element {
  const [windows, setWindows] = useState<CaptureSource[] | null>(null);

  const refresh = useCallback(() => {
    window.api
      .listSources()
      .then((sources) => setWindows(sources.filter((s) => s.kind === 'window')))
      .catch(() => setWindows([]));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    // Also poll while choosing: a window can close while this app is still in
    // front, and focus alone would never notice (seen 2026-09-22 -- a closed
    // window stayed selected and the trigger stayed armed). Stopped while
    // recording, when the list is locked anyway.
    const timer = disabled ? undefined : setInterval(refresh, 3000);
    return () => {
      window.removeEventListener('focus', refresh);
      if (timer) clearInterval(timer);
    };
  }, [refresh, disabled]);

  // A picked window that has since closed must not stay selected: the trigger
  // would promise a recording that can only fail.
  useEffect(() => {
    if (windows && selectedId && !windows.some((w) => w.id === selectedId)) onSelect(null);
  }, [windows, selectedId, onSelect]);

  if (windows === null) return <p className="windows__empty">Looking for open windows…</p>;

  if (windows.length === 0) {
    return (
      <p className="windows__empty">
        No windows to record. Open the app you want to record, then come back here.
      </p>
    );
  }

  return (
    <fieldset className="windows" disabled={disabled}>
      <legend className="windows__legend">
        Choose a window
        <button type="button" className="link" onClick={refresh} disabled={disabled}>
          Refresh
        </button>
      </legend>
      <div className="windows__grid">
        {windows.map((w) => (
          <label key={w.id} className={`windows__item ${selectedId === w.id ? 'is-selected' : ''}`}>
            <input
              type="radio"
              name="window"
              value={w.id}
              checked={selectedId === w.id}
              onChange={() => onSelect({ kind: 'window', id: w.id, name: w.name })}
            />
            <img className="windows__thumb" src={w.thumbnailDataUrl} alt="" />
            <span className="windows__name" title={w.name}>
              {w.name}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
