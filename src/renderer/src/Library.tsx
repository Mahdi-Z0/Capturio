import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordingListItem } from '../../shared/types.js';

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `Today at ${time}` : `${d.toLocaleDateString()} at ${time}`;
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Read durations without flooding the machine.
 *
 * `stat` cannot supply duration, so each one costs a decode. One <video> per
 * recording all loading at once means a folder of 100 opens 100 simultaneous
 * decodes; this probes at most 4 at a time, only for tiles that are on screen,
 * and tears each element down after reading so decoders are not held open for
 * files the user never plays.
 */
const MAX_CONCURRENT_PROBES = 4;

function useDurations(items: RecordingListItem[]): {
  durations: Record<string, number>;
  observe: (path: string, el: HTMLElement | null) => void;
} {
  const [durations, setDurations] = useState<Record<string, number>>({});
  const visible = useRef(new Set<string>());
  const queued = useRef(new Set<string>());
  const running = useRef(0);
  const observer = useRef<IntersectionObserver | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  // pump() re-enters itself as each probe finishes. A ref breaks the
  // use-before-declaration cycle that a self-referencing useCallback creates.
  const pumpRef = useRef<() => void>(() => undefined);

  const pump = useCallback(() => {
    const byPath = new Map(items.map((i) => [i.filePath, i]));
    while (running.current < MAX_CONCURRENT_PROBES) {
      const next = [...visible.current].find((p) => !queued.current.has(p) && byPath.has(p));
      if (!next) return;
      const item = byPath.get(next);
      if (!item) return;

      queued.current.add(next);
      running.current += 1;

      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.muted = true;
      const done = (value?: number): void => {
        if (value !== undefined) setDurations((d) => ({ ...d, [next]: value }));
        probe.removeAttribute('src');
        probe.load(); // release the decoder
        running.current -= 1;
        pumpRef.current();
      };
      probe.onloadedmetadata = () => done(probe.duration);
      probe.onerror = () => done();
      probe.src = item.playbackUrl;
    }
  }, [items]);

  // Assigned in an effect, not during render: both run before any probe callback
  // can fire, so the recursion target is always current.
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  useEffect(() => {
    observer.current = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const path = (e.target as HTMLElement).dataset['path'];
        if (!path) continue;
        if (e.isIntersecting) visible.current.add(path);
        else visible.current.delete(path);
      }
      pump();
    });
    for (const [, el] of elements.current) observer.current.observe(el);
    return () => observer.current?.disconnect();
  }, [pump]);

  const observe = useCallback((path: string, el: HTMLElement | null): void => {
    if (!el) {
      elements.current.delete(path);
      return;
    }
    el.dataset['path'] = path;
    elements.current.set(path, el);
    observer.current?.observe(el);
  }, []);

  return { durations, observe };
}

export interface LibraryProps {
  /** Changes when a recording finishes saving; the existing signal, not a new one. */
  refreshKey: unknown;
}

export default function Library({ refreshKey }: LibraryProps): React.JSX.Element {
  const [items, setItems] = useState<RecordingListItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingPermanent, setConfirmingPermanent] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { durations, observe } = useDurations(items ?? []);
  // Derived from the element itself, not from the file name: the only reliable
  // signal is what the decoder reports once metadata is in.
  const [unindexed, setUnindexed] = useState(false);

  const refresh = useCallback(async (): Promise<RecordingListItem[]> => {
    try {
      const list = await window.api.listRecordings();
      setItems(list);
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await window.api.listRecordings().catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
        return [] as RecordingListItem[];
      });
      if (!cancelled) setItems(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // A refresh is not a reset. `current` is derived, so a file that disappears
  // simply resolves to null and the player unmounts -- no effect needed, and the
  // still-present selection keeps playing across a refresh.
  const current = items?.find((i) => i.filePath === selected) ?? null;

  // Show the three most recent by default. A long folder of tiles would push the
  // record button off screen, and the newest recordings are the ones anyone
  // actually reaches for.
  const COLLAPSED_COUNT = 3;

  const select = useCallback((path: string) => {
    setSelected(path);
    setConfirmingPermanent(false);
  }, []);

  const remove = useCallback(
    async (permanent: boolean) => {
      if (!current) return;
      setError(null);
      try {
        await window.api.deleteRecording(current.filePath, permanent);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      await refresh();
    },
    [current, refresh],
  );

  const runAction = useCallback(
    async (fn: () => Promise<void>) => {
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await refresh();
      }
    },
    [refresh],
  );

  if (items === null) return <section className="library" aria-busy="true" />;

  return (
    <section className="library">
      <h2 className="library__heading">Recordings</h2>

      {error && (
        <p className="library__error" role="alert">
          {error}
        </p>
      )}

      {items.length === 0 ? (
        <p className="library__empty">
          Nothing recorded yet. Press the red button to record your screen, and it will show up
          here.
        </p>
      ) : (
        <>
          {current && (
            <div className="player">
              {/* Custom protocol, never file:// -- the CSP forbids it. */}
              <video
                key={current.filePath}
                className="player__video"
                src={current.playbackUrl}
                controls
                autoPlay
                onLoadedMetadata={(e) => setUnindexed(!Number.isFinite(e.currentTarget.duration))}
                onError={() =>
                  setError(`${current.fileName} could not be played. It may have been moved.`)
                }
              />
              {/* Recordings made before the finalize step carry no duration and no
                  seek index, so the browser reports Infinity and the scrubber is
                  meaningless. Say so, rather than let it look like a live bug. */}
              {unindexed && (
                <p className="player__note">
                  This recording was saved before seeking was fixed, so its length is unknown and
                  the scrubber will not work. New recordings seek normally.
                </p>
              )}
              <div className="player__bar">
                <span className="player__name">{current.fileName}</span>
                <div className="player__actions">
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      void runAction(() => window.api.openRecordingExternally(current.filePath))
                    }
                  >
                    Open in player
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => void runAction(() => window.api.revealRecording(current.filePath))}
                  >
                    Show in folder
                  </button>
                  <button type="button" className="link" onClick={() => void remove(false)}>
                    Move to Recycle Bin
                  </button>
                  <button
                    type="button"
                    className={`link link--danger ${confirmingPermanent ? 'is-confirming' : ''}`}
                    onClick={() => {
                      if (confirmingPermanent) void remove(true);
                      else setConfirmingPermanent(true);
                    }}
                    onBlur={() => setConfirmingPermanent(false)}
                  >
                    {confirmingPermanent ? 'Confirm — this cannot be undone' : 'Delete permanently'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <ul className="tiles">
            {(expanded ? items : items.slice(0, COLLAPSED_COUNT)).map((item) => {
              const dur = durations[item.filePath];
              return (
                <li key={item.filePath} ref={(el) => observe(item.filePath, el)}>
                  <button
                    type="button"
                    className={`tile ${selected === item.filePath ? 'is-selected' : ''}`}
                    onClick={() => select(item.filePath)}
                    aria-pressed={selected === item.filePath}
                  >
                    {/* Reserved for 02-02 thumbnails; sized now so adding them
                        later does not relayout the grid. */}
                    <span className="tile__thumb" aria-hidden="true" />
                    <span className="tile__name">{item.fileName}</span>
                    <span className="tile__meta">
                      {formatWhen(item.modifiedAt)}
                      <span className="tile__sep" aria-hidden="true" />
                      {formatSize(item.sizeBytes)}
                      {dur !== undefined && formatDuration(dur) && (
                        <>
                          <span className="tile__sep" aria-hidden="true" />
                          {formatDuration(dur)}
                        </>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {items.length > COLLAPSED_COUNT && (
            <button
              type="button"
              className="library__more"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
            >
              {expanded
                ? `Show fewer`
                : `Show all ${items.length} recordings`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
