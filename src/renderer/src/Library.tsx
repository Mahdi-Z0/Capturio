import { useCallback, useEffect, useRef, useState } from 'react';
import type { FolderEntry, FolderListing, RecordingListItem } from '../../shared/types.js';
import {
  BackIcon,
  FolderIcon,
  FolderPlusIcon,
  ForwardIcon,
  UpIcon,
} from './icons.js';

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

/** Tile art: wide enough to stay sharp on a high-DPI screen, small enough to cache. */
const THUMB_WIDTH = 320;

/**
 * Grab a still from a loaded video element.
 *
 * Taken from the probe that is already open for the duration, so a tile costs
 * one decode rather than two. Returns null whenever the frame cannot be read --
 * a thumbnail is decoration, and no tile art is fine.
 */
async function captureFrame(video: HTMLVideoElement): Promise<ArrayBuffer | null> {
  const ratio = video.videoHeight / video.videoWidth;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = Math.max(1, Math.round(THUMB_WIDTH * ratio));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.72),
  );
  return blob ? await blob.arrayBuffer() : null;
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
  thumbs: Record<string, string>;
  observe: (path: string, el: HTMLElement | null) => void;
} {
  const [durations, setDurations] = useState<Record<string, number>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
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
      // Without this the canvas is tainted by a cross-origin source and toBlob
      // throws; the protocol answers with Access-Control-Allow-Origin to match.
      probe.crossOrigin = 'anonymous';
      // 'metadata' is not enough to draw a frame; the seek below needs pixels.
      probe.preload = 'auto';
      probe.muted = true;
      const done = (value?: number): void => {
        if (value !== undefined) setDurations((d) => ({ ...d, [next]: value }));
        probe.removeAttribute('src');
        probe.load(); // release the decoder
        running.current -= 1;
        pumpRef.current();
      };

      probe.onloadedmetadata = () => {
        const duration = probe.duration;
        window.api
          .getThumbnail(next)
          .then(async (cached) => {
            if (cached) {
              setThumbs((t) => ({ ...t, [next]: cached }));
              done(duration);
              return;
            }
            // A little way in: the first frame of a screen recording is often
            // the moment before anything happened.
            const at = Number.isFinite(duration) ? Math.min(1.5, duration * 0.15) : 0;
            const seeked = new Promise<void>((resolve) => {
              probe.onseeked = () => resolve();
              probe.onerror = () => resolve();
              setTimeout(resolve, 4000);
              probe.currentTime = at;
            });
            await seeked;
            const jpeg = await captureFrame(probe);
            if (jpeg) {
              await window.api.putThumbnail(next, jpeg).catch(() => undefined);
              const stored = await window.api.getThumbnail(next).catch(() => null);
              if (stored) setThumbs((t) => ({ ...t, [next]: stored }));
            }
            done(duration);
          })
          .catch(() => done(duration));
      };
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

  return { durations, thumbs, observe };
}


export interface LibraryProps {
  /** Changes when a recording finishes saving; the existing signal, not a new one. */
  refreshKey: unknown;
}

/**
 * Where the browser is looking.
 *
 * `null` is the top: a single card for the recordings folder, which is what the
 * app has instead of showing someone their whole Videos folder. Everything else
 * is a path relative to the recordings folder, `''` being the folder itself.
 * There is deliberately no way to express anything above it.
 */
type Place = string | null;

const HOME: Place = null;

/** `Lectures/Week 1` -> `Lectures`; the recordings folder -> the top. */
function parentOf(place: Place): Place {
  if (place === null) return null;
  if (place === '') return HOME;
  const cut = place.lastIndexOf('/');
  return cut === -1 ? '' : place.slice(0, cut);
}

export default function Library({ refreshKey }: LibraryProps): React.JSX.Element {
  // Browser history, not a single path: back and forward mean what they mean
  // everywhere else, and the first entry being HOME is what stops back from
  // ever climbing out of the recordings folder.
  const [history, setHistory] = useState<Place[]>([HOME]);
  const [cursor, setCursor] = useState(0);
  const place = history[cursor] ?? HOME;

  const [listing, setListing] = useState<FolderListing | null>(null);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingPermanent, setConfirmingPermanent] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  // Remembered, because the crumb for the recordings folder has to be nameable
  // from inside a subfolder, where the listing describes the subfolder instead.
  const [rootName, setRootName] = useState('Capturio');
  const { durations, thumbs, observe } = useDurations(listing?.files ?? []);
  // Derived from the element itself, not from the file name: the only reliable
  // signal is what the decoder reports once metadata is in.
  const [unindexed, setUnindexed] = useState(false);
  const playerRef = useRef<HTMLVideoElement>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);

  // A recording is starting and this window is being hidden. Hiding does not
  // stop playback, and whatever is playing here would be recorded.
  useEffect(() => window.api.onSuspendPlayback(() => playerRef.current?.pause()), []);

  // Bumped by anything that changes the folder, so one effect owns the read and
  // there is no second path that can leave the view stale.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // The top still reads the recordings folder: its card shows what is inside.
        const next = await window.api.browseRecordings(place ?? '');
        if (cancelled) return;
        setListing(next);
        if (next.path === '') setRootName(next.name);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setListing({ path: place ?? '', name: 'Recordings', folders: [], files: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [place, refreshKey, reloadKey]);

  // Only for the "move to" menu, so it is read when the folders could have
  // changed rather than on every navigation.
  useEffect(() => {
    window.api
      .listFolders()
      .then(setFolders)
      .catch(() => undefined);
  }, [listing]);

  useEffect(() => {
    if (newFolder !== null) newFolderRef.current?.focus();
  }, [newFolder]);

  const go = useCallback(
    (next: Place) => {
      setSelected(null);
      setNewFolder(null);
      setHistory((h) => [...h.slice(0, cursor + 1), next]);
      setCursor((c) => c + 1);
    },
    [cursor],
  );

  const step = useCallback(
    (delta: number) => {
      setSelected(null);
      setNewFolder(null);
      setCursor((c) => Math.min(history.length - 1, Math.max(0, c + delta)));
    },
    [history.length],
  );

  const current = listing?.files.find((f) => f.filePath === selected) ?? null;

  const runAction = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (permanent: boolean) => {
      if (!current) return;
      setSelected(null);
      await runAction(() => window.api.deleteRecording(current.filePath, permanent));
    },
    [current, runAction],
  );

  const createFolder = useCallback(async () => {
    const name = (newFolder ?? '').trim();
    if (name.length === 0) {
      setNewFolder(null);
      return;
    }
    setNewFolder(null);
    await runAction(() => window.api.createFolder(place ?? '', name));
  }, [newFolder, place, runAction]);

  const totals = listing
    ? {
        count: listing.files.length + listing.folders.reduce((n, f) => n + f.itemCount, 0),
        size: listing.files.reduce((n, f) => n + f.sizeBytes, 0) +
          listing.folders.reduce((n, f) => n + f.sizeBytes, 0),
      }
    : { count: 0, size: 0 };

  if (listing === null) return <section className="library" aria-busy="true" />;

  const crumbs = place === null || place === '' ? [] : place.split('/');

  return (
    <section className="library">
      <div className="browser">
        <div className="browser__nav">
          <button
            type="button"
            className="icon"
            onClick={() => step(-1)}
            disabled={cursor === 0}
            title="Back"
            aria-label="Back"
          >
            <BackIcon />
          </button>
          <button
            type="button"
            className="icon"
            onClick={() => step(1)}
            disabled={cursor >= history.length - 1}
            title="Forward"
            aria-label="Forward"
          >
            <ForwardIcon />
          </button>
          <button
            type="button"
            className="icon"
            onClick={() => go(parentOf(place))}
            disabled={place === null}
            title="Up one level"
            aria-label="Up one level"
          >
            <UpIcon />
          </button>
        </div>

        <nav className="crumbs" aria-label="Location">
          <button type="button" className="crumbs__item" onClick={() => go(HOME)}>
            Recordings
          </button>
          {place !== null && (
            <>
              <span className="crumbs__sep" aria-hidden="true">
                ›
              </span>
              <button type="button" className="crumbs__item" onClick={() => go('')}>
                {rootName}
              </button>
            </>
          )}
          {crumbs.map((part, i) => (
            <span key={crumbs.slice(0, i + 1).join('/')}>
              <span className="crumbs__sep" aria-hidden="true">
                ›
              </span>
              <button
                type="button"
                className="crumbs__item"
                onClick={() => go(crumbs.slice(0, i + 1).join('/'))}
                aria-current={i === crumbs.length - 1 ? 'page' : undefined}
              >
                {part}
              </button>
            </span>
          ))}
        </nav>

        {place !== null && (
          <div className="browser__actions">
            <button
              type="button"
              className="link"
              onClick={() => setNewFolder('')}
              title="Create a folder here"
            >
              <FolderPlusIcon />
              New folder
            </button>
            <button
              type="button"
              className="link"
              onClick={() => void runAction(() => window.api.revealFolder(place))}
            >
              Open in Explorer
            </button>
          </div>
        )}
      </div>

      {newFolder !== null && (
        <form
          className="newFolder"
          onSubmit={(e) => {
            e.preventDefault();
            void createFolder();
          }}
        >
          <input
            ref={newFolderRef}
            className="newFolder__input"
            value={newFolder}
            placeholder="Folder name"
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNewFolder(null);
            }}
            aria-label="Folder name"
          />
          <button type="submit" className="link">
            Create
          </button>
          <button type="button" className="link" onClick={() => setNewFolder(null)}>
            Cancel
          </button>
        </form>
      )}

      {error && (
        <p className="library__error" role="alert">
          {error}
        </p>
      )}

      {/* The top is one card, not a file list: the recordings folder is the only
          thing in it, and showing it as a folder is what makes the level below
          make sense. */}
      {place === null ? (
        totals.count === 0 ? (
          <p className="library__empty">
            Nothing recorded yet. Press the red button on the bar, and your recordings will show up
            here.
          </p>
        ) : (
          <ul className="folders folders--home">
            <li>
              <button type="button" className="folder" onClick={() => go('')}>
                <span className="folder__icon" aria-hidden="true">
                  <FolderIcon />
                </span>
                <span className="folder__name">{listing.name}</span>
                <span className="folder__meta">
                  {totals.count} {totals.count === 1 ? 'recording' : 'recordings'}
                  <span className="tile__sep" aria-hidden="true" />
                  {formatSize(totals.size)}
                </span>
              </button>
            </li>
          </ul>
        )
      ) : (
        <>
          {current && (
            <div className="player">
              {/* Custom protocol, never file:// -- the CSP forbids it. */}
              <video
                key={current.filePath}
                ref={playerRef}
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
                  {/* Moving is a menu rather than a drag: a drag needs a target on
                      screen, and the folder you want is usually not the one you
                      are looking at. */}
                  <label className="moveTo">
                    Move to
                    <select
                      className="moveTo__select"
                      value=""
                      onChange={(e) => {
                        const target = e.target.value;
                        if (target === '') return;
                        const dir = target === '/' ? '' : target;
                        void runAction(async () => {
                          await window.api.moveRecording(current.filePath, dir);
                          setSelected(null);
                        });
                      }}
                    >
                      <option value="">Choose a folder…</option>
                      {place !== '' && <option value="/">{rootName}</option>}
                      {folders
                        .filter((f) => f.path !== place)
                        .map((f) => (
                          <option key={f.path} value={f.path}>
                            {f.path}
                          </option>
                        ))}
                    </select>
                  </label>
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
                    onClick={() =>
                      void runAction(() => window.api.revealRecording(current.filePath))
                    }
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

          {listing.folders.length > 0 && (
            <ul className="folders">
              {listing.folders.map((folder) => (
                <li key={folder.path}>
                  <button type="button" className="folder" onClick={() => go(folder.path)}>
                    <span className="folder__icon" aria-hidden="true">
                      <FolderIcon />
                    </span>
                    <span className="folder__name">{folder.name}</span>
                    <span className="folder__meta">
                      {folder.itemCount} {folder.itemCount === 1 ? 'recording' : 'recordings'}
                      {folder.itemCount > 0 && (
                        <>
                          <span className="tile__sep" aria-hidden="true" />
                          {formatSize(folder.sizeBytes)}
                        </>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {listing.files.length === 0 && listing.folders.length === 0 ? (
            <p className="library__empty">
              This folder is empty. Recordings you move here will show up in it.
            </p>
          ) : (
            <ul className="tiles">
              {listing.files.map((item) => {
                const dur = durations[item.filePath];
                return (
                  <li key={item.filePath} ref={(el) => observe(item.filePath, el)}>
                    <button
                      type="button"
                      className={`tile ${selected === item.filePath ? 'is-selected' : ''}`}
                      onClick={() => {
                        setSelected(item.filePath);
                        setConfirmingPermanent(false);
                      }}
                      aria-pressed={selected === item.filePath}
                    >
                      {/* The placeholder keeps its size when no image exists, so
                          tiles never reflow as thumbnails arrive. */}
                      {thumbs[item.filePath] ? (
                        <img className="tile__thumb" src={thumbs[item.filePath]} alt="" />
                      ) : (
                        <span className="tile__thumb" aria-hidden="true" />
                      )}
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
          )}
        </>
      )}
    </section>
  );
}
