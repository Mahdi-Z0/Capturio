import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FolderEntry, FolderListing, RecordingListItem } from '../../shared/types.js';
import {
  BackIcon,
  CheckIcon,
  CloseIcon,
  ExternalIcon,
  FolderIcon,
  FolderPlusIcon,
  ForwardIcon,
  MoveIcon,
  PlayIcon,
  TrashIcon,
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
 * `Lectures/Week 1` -> `Lectures`; the recordings folder itself -> `null`.
 *
 * `''` is the top and there is deliberately no way to express anything above it.
 * The Videos folder is not shown: it holds exactly one folder and nothing can be
 * saved into it, so a level that only ever contains one card is a level in the
 * way.
 */
function parentOf(place: string): string | null {
  if (place === '') return null;
  const cut = place.lastIndexOf('/');
  return cut === -1 ? '' : place.slice(0, cut);
}

/** The drag payload: the recordings being dragged, by absolute path, as JSON. */
const DRAG_TYPE = 'application/x-capturio-recording';

/** Where a right-click menu was asked for, and what it was asked about. */
interface MenuState {
  x: number;
  y: number;
  kind: 'recording' | 'folder' | 'background';
  /** The recording or folder the click landed on; empty for the background. */
  target: string;
}

const fileNameOf = (p: string): string => p.split(/[\\/]/).pop() ?? p;

export default function Library({ refreshKey }: LibraryProps): React.JSX.Element {
  // Browser history, not a single path: back and forward mean what they mean
  // everywhere else, and the first entry being the recordings folder is what
  // stops back from ever climbing out of it.
  const [history, setHistory] = useState<string[]>(['']);
  const [cursor, setCursor] = useState(0);
  const place = history[cursor] ?? '';

  const [listing, setListing] = useState<FolderListing | null>(null);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  // Selecting and opening are different acts: clicks pick recordings and offer
  // what can be done with them, a double-click plays one. Several can be picked
  // at once -- ctrl for one more, shift for a run -- because deleting or filing
  // a morning's recordings one at a time is the thing that makes a library
  // tedious.
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingPermanent, setConfirmingPermanent] = useState(false);
  const [confirmingFolder, setConfirmingFolder] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // Which folder a dragged recording is currently over, so the target is visible
  // before the drop rather than after it.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Remembered, because the crumb for the recordings folder has to be nameable
  // from inside a subfolder, where the listing describes the subfolder instead.
  const [rootName, setRootName] = useState('Capturio');
  const { durations, thumbs, observe } = useDurations(listing?.files ?? []);
  // Derived from the element itself, not from the file name: the only reliable
  // signal is what the decoder reports once metadata is in.
  const [unindexed, setUnindexed] = useState(false);
  const playerRef = useRef<HTMLVideoElement>(null);
  const newFolderRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
        const next = await window.api.browseRecordings(place);
        if (cancelled) return;
        setListing(next);
        if (next.path === '') setRootName(next.name);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setListing({ path: place, name: 'Recordings', folders: [], files: [] });
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

  /** Everything a navigation or a change to the folder invalidates. */
  const clearSelection = useCallback(() => {
    setSelected([]);
    setAnchor(null);
    setPlaying(null);
    setConfirmingPermanent(false);
    setConfirmingFolder(null);
    setNewFolder(null);
    setMenu(null);
  }, []);

  const go = useCallback(
    (next: string) => {
      clearSelection();
      setHistory((h) => [...h.slice(0, cursor + 1), next]);
      setCursor((c) => c + 1);
    },
    [clearSelection, cursor],
  );

  const step = useCallback(
    (delta: number) => {
      clearSelection();
      setCursor((c) => Math.min(history.length - 1, Math.max(0, c + delta)));
    },
    [clearSelection, history.length],
  );

  // Memoised because the click and keyboard handlers depend on it; a fresh
  // array each render would rebuild them every time.
  const files = useMemo(() => listing?.files ?? [], [listing]);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const picked = files.filter((f) => chosen.has(f.filePath));
  const one = picked.length === 1 ? picked[0] : null;
  const playingItem = files.find((f) => f.filePath === playing) ?? null;
  const up = parentOf(place);

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

  /**
   * Apply something to every selected recording.
   *
   * One failure does not stop the rest -- a folder that cannot take one file is
   * no reason to leave the other nine where they were -- and what failed is
   * reported rather than swallowed.
   */
  const runOnSelection = useCallback(
    async (verb: string, paths: string[], fn: (filePath: string) => Promise<unknown>) => {
      setError(null);
      setMenu(null);
      const failures: string[] = [];
      for (const filePath of paths) {
        try {
          await fn(filePath);
        } catch (err) {
          failures.push(`${fileNameOf(filePath)} — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (failures.length > 0) {
        setError(
          failures.length === paths.length
            ? `Could not ${verb}: ${failures[0]}`
            : `${failures.length} of ${paths.length} could not be ${verb}d. First: ${failures[0]}`,
        );
      }
      clearSelection();
      reload();
    },
    [clearSelection, reload],
  );

  const removeSelected = useCallback(
    (permanent: boolean, paths: string[] = selected) =>
      runOnSelection(permanent ? 'delete' : 'move to the Recycle Bin', paths, (filePath) =>
        window.api.deleteRecording(filePath, permanent),
      ),
    [runOnSelection, selected],
  );

  const moveTo = useCallback(
    (dir: string, paths: string[] = selected) =>
      runOnSelection('move', paths, (filePath) => window.api.moveRecording(filePath, dir)),
    [runOnSelection, selected],
  );

  const createFolder = useCallback(async () => {
    const name = (newFolder ?? '').trim();
    if (name.length === 0) {
      setNewFolder(null);
      return;
    }
    setNewFolder(null);
    await runAction(() => window.api.createFolder(place, name));
  }, [newFolder, place, runAction]);

  /** Click, ctrl-click and shift-click, as every file list has worked for years. */
  const clickTile = useCallback(
    (e: React.MouseEvent, filePath: string) => {
      setConfirmingPermanent(false);
      if (e.shiftKey && anchor) {
        const from = files.findIndex((f) => f.filePath === anchor);
        const to = files.findIndex((f) => f.filePath === filePath);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          setSelected(files.slice(lo, hi + 1).map((f) => f.filePath));
          return;
        }
      }
      if (e.ctrlKey || e.metaKey) {
        setSelected((s) => (s.includes(filePath) ? s.filter((p) => p !== filePath) : [...s, filePath]));
        setAnchor(filePath);
        return;
      }
      setSelected([filePath]);
      setAnchor(filePath);
    },
    [anchor, files],
  );

  // Escape clears, Ctrl+A takes the folder. Delete is deliberately not bound:
  // recoverable or not, a stray keypress should not empty a folder.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMenu(null);
        setSelected([]);
        setConfirmingPermanent(false);
        setConfirmingFolder(null);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        const target = e.target as HTMLElement | null;
        // Not while typing a folder name.
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
        e.preventDefault();
        setSelected(files.map((f) => f.filePath));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [files]);

  // A menu that survives a click elsewhere, a scroll or a resize is a menu
  // pointing at something that has moved.
  useEffect(() => {
    if (!menu) return undefined;
    const close = (): void => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  const openMenu = useCallback(
    (e: React.MouseEvent, kind: MenuState['kind'], target: string) => {
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY, kind, target });
    },
    [],
  );

  /**
   * Keep the menu inside the window.
   *
   * Measured rather than estimated: how tall it is depends on how many folders
   * there are to move into, and a guessed height put it off the bottom edge
   * exactly when the list was long enough to be worth right-clicking. A layout
   * effect runs before paint, so the corrected position is the first one drawn.
   */
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const box = el.getBoundingClientRect();
    const margin = 8;
    el.style.left = `${Math.max(margin, Math.min(menu.x, window.innerWidth - box.width - margin))}px`;
    el.style.top = `${Math.max(margin, Math.min(menu.y, window.innerHeight - box.height - margin))}px`;
  }, [menu]);

  /* --- Dragging recordings onto folders ---------------------------------------
   * The same move as the menu, reached the way a file manager would do it. Every
   * drop target is a folder path, so the crumb trail works as one too: dragging
   * onto the first crumb moves a recording back out of a subfolder. */

  const dropProps = useCallback(
    (dir: string) => ({
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        // Without preventDefault the browser refuses the drop entirely.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move' as const;
        setDropTarget(dir);
      },
      onDragLeave: () => setDropTarget((t) => (t === dir ? null : t)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setDropTarget(null);
        const raw = e.dataTransfer.getData(DRAG_TYPE);
        if (!raw) return;
        const paths = JSON.parse(raw) as string[];
        if (paths.length > 0) void moveTo(dir, paths);
      },
    }),
    [moveTo],
  );

  if (listing === null) return <section className="library" aria-busy="true" />;

  const crumbs = place === '' ? [] : place.split('/');
  const moveTargets = [
    ...(place === '' ? [] : [{ path: '', label: rootName }]),
    ...folders.filter((f) => f.path !== place).map((f) => ({ path: f.path, label: f.path })),
  ];

  return (
    <section
      className="library"
      onContextMenu={(e) => openMenu(e, 'background', '')}
      onClick={(e) => {
        // A click on the background, not on a tile, means "never mind".
        if (e.target === e.currentTarget) {
          setSelected([]);
          setAnchor(null);
        }
      }}
    >
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
            onClick={() => up !== null && go(up)}
            disabled={up === null}
            title="Up one level"
            aria-label="Up one level"
          >
            <UpIcon />
          </button>
        </div>

        <nav className="crumbs" aria-label="Location">
          <button
            type="button"
            className={`crumbs__item ${dropTarget === '' ? 'is-dropTarget' : ''}`}
            onClick={() => go('')}
            aria-current={place === '' ? 'page' : undefined}
            {...dropProps('')}
          >
            {rootName}
          </button>
          {crumbs.map((part, i) => {
            const path = crumbs.slice(0, i + 1).join('/');
            return (
              <span key={path}>
                <span className="crumbs__sep" aria-hidden="true">
                  ›
                </span>
                <button
                  type="button"
                  className={`crumbs__item ${dropTarget === path ? 'is-dropTarget' : ''}`}
                  onClick={() => go(path)}
                  aria-current={i === crumbs.length - 1 ? 'page' : undefined}
                  {...dropProps(path)}
                >
                  {part}
                </button>
              </span>
            );
          })}
        </nav>

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

      {/* Sticky, because the actions belong to the selection and the selection
          can be at the bottom of a long folder. Scrolling back up to reach a
          button is the kind of small tax that makes a list annoying to use. */}
      {picked.length > 0 && (
        <div className="actions" role="toolbar" aria-label="What to do with the selection">
          <span className="actions__count">
            {picked.length} selected
            <span className="actions__size">
              {formatSize(picked.reduce((n, f) => n + f.sizeBytes, 0))}
            </span>
          </span>

          {one && (
            <button
              type="button"
              className="actions__item"
              onClick={() => setPlaying(playing === one.filePath ? null : one.filePath)}
            >
              {playing === one.filePath ? <CloseIcon /> : <PlayIcon />}
              {playing === one.filePath ? 'Close' : 'Play'}
            </button>
          )}

          <label className="actions__item actions__move">
            <MoveIcon />
            Move to
            <select
              className="actions__select"
              value=""
              aria-label={`Move ${picked.length} recordings to a folder`}
              onChange={(e) => {
                if (e.target.value === '') return;
                void moveTo(e.target.value === '/' ? '' : e.target.value);
              }}
            >
              <option value="">Folder…</option>
              {moveTargets.map((t) => (
                <option key={t.path} value={t.path === '' ? '/' : t.path}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          {one && (
            <button
              type="button"
              className="actions__item"
              onClick={() => void runAction(() => window.api.openRecordingExternally(one.filePath))}
            >
              <ExternalIcon />
              Open
            </button>
          )}

          {one && (
            <button
              type="button"
              className="actions__item"
              onClick={() => void runAction(() => window.api.revealRecording(one.filePath))}
            >
              <FolderIcon />
              In folder
            </button>
          )}

          <button
            type="button"
            className="actions__item"
            onClick={() => void removeSelected(false)}
          >
            <TrashIcon />
            Recycle Bin
          </button>

          <button
            type="button"
            className={`actions__item actions__item--danger ${confirmingPermanent ? 'is-confirming' : ''}`}
            onClick={() => {
              if (confirmingPermanent) void removeSelected(true);
              else setConfirmingPermanent(true);
            }}
            onBlur={() => setConfirmingPermanent(false)}
          >
            <TrashIcon />
            {confirmingPermanent ? 'Confirm — cannot be undone' : 'Delete'}
          </button>

          <button
            type="button"
            className="actions__clear"
            onClick={() => {
              setSelected([]);
              setAnchor(null);
            }}
            title="Clear the selection"
            aria-label="Clear the selection"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {error && (
        <p className="library__error" role="alert">
          {error}
        </p>
      )}

      {playingItem && (
        <div className="player">
          {/* Custom protocol, never file:// -- the CSP forbids it. */}
          <video
            key={playingItem.filePath}
            ref={playerRef}
            className="player__video"
            src={playingItem.playbackUrl}
            controls
            autoPlay
            onLoadedMetadata={(e) => setUnindexed(!Number.isFinite(e.currentTarget.duration))}
            onError={() =>
              setError(`${playingItem.fileName} could not be played. It may have been moved.`)
            }
          />
          {/* Recordings made before the finalize step carry no duration and no
              seek index, so the browser reports Infinity and the scrubber is
              meaningless. Say so, rather than let it look like a live bug. */}
          {unindexed && (
            <p className="player__note">
              This recording was saved before seeking was fixed, so its length is unknown and the
              scrubber will not work. New recordings seek normally.
            </p>
          )}
          <div className="player__bar">
            <span className="player__name">{playingItem.fileName}</span>
            <button type="button" className="link" onClick={() => setPlaying(null)}>
              Close player
            </button>
          </div>
        </div>
      )}

      {listing.folders.length > 0 && (
        <ul className="folders">
          {listing.folders.map((folder) => (
            <li
              key={folder.path}
              className={`folderCell ${dropTarget === folder.path ? 'is-dropTarget' : ''}`}
              onContextMenu={(e) => openMenu(e, 'folder', folder.path)}
              {...dropProps(folder.path)}
            >
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
              <button
                type="button"
                className={`folder__delete ${confirmingFolder === folder.path ? 'is-confirming' : ''}`}
                onClick={() => {
                  if (confirmingFolder === folder.path) {
                    setConfirmingFolder(null);
                    void runAction(() => window.api.deleteFolder(folder.path));
                  } else {
                    setConfirmingFolder(folder.path);
                  }
                }}
                onBlur={() => setConfirmingFolder((f) => (f === folder.path ? null : f))}
                title={
                  confirmingFolder === folder.path
                    ? `Confirm: move "${folder.name}" and everything in it to the Recycle Bin`
                    : `Delete "${folder.name}"`
                }
                aria-label={
                  confirmingFolder === folder.path
                    ? `Confirm deleting ${folder.name}`
                    : `Delete ${folder.name}`
                }
              >
                {confirmingFolder === folder.path ? 'Confirm' : <TrashIcon />}
              </button>
            </li>
          ))}
        </ul>
      )}

      {listing.files.length === 0 && listing.folders.length === 0 ? (
        <p className="library__empty">
          {place === ''
            ? 'Nothing recorded yet. Press the red button on the bar, and your recordings will show up here.'
            : 'This folder is empty. Recordings you drag or move here will show up in it.'}
        </p>
      ) : (
        <ul className="tiles">
          {listing.files.map((item) => {
            const dur = durations[item.filePath];
            const isChosen = chosen.has(item.filePath);
            return (
              <li key={item.filePath} ref={(el) => observe(item.filePath, el)}>
                <button
                  type="button"
                  className={`tile ${isChosen ? 'is-selected' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    // Dragging something already selected takes the whole
                    // selection; dragging anything else takes just that one.
                    const paths = isChosen ? selected : [item.filePath];
                    if (!isChosen) {
                      setSelected([item.filePath]);
                      setAnchor(item.filePath);
                    }
                    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDropTarget(null)}
                  onClick={(e) => clickTile(e, item.filePath)}
                  onDoubleClick={() => {
                    setSelected([item.filePath]);
                    setAnchor(item.filePath);
                    setPlaying(item.filePath);
                  }}
                  onContextMenu={(e) => {
                    // Right-clicking outside the selection moves it here first,
                    // so the menu always acts on what is highlighted.
                    if (!isChosen) {
                      setSelected([item.filePath]);
                      setAnchor(item.filePath);
                    }
                    openMenu(e, 'recording', item.filePath);
                  }}
                  aria-pressed={isChosen}
                  title="Click to select, double-click to play, right-click for more"
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

      {menu && (
        <div
          className="menu"
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          // The window-level mousedown listener closes this; clicks inside it
          // must not travel there before the item they landed on runs.
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.kind === 'recording' && (
            <>
              <p className="menu__title">
                {picked.length > 1 ? `${picked.length} recordings` : fileNameOf(menu.target)}
              </p>
              {one && (
                <button
                  type="button"
                  className="menu__item"
                  onClick={() => {
                    setPlaying(one.filePath);
                    setMenu(null);
                  }}
                >
                  <PlayIcon />
                  Play here
                </button>
              )}
              {one && (
                <button
                  type="button"
                  className="menu__item"
                  onClick={() => {
                    setMenu(null);
                    void runAction(() => window.api.openRecordingExternally(one.filePath));
                  }}
                >
                  <ExternalIcon />
                  Open in your player
                </button>
              )}
              {one && (
                <button
                  type="button"
                  className="menu__item"
                  onClick={() => {
                    setMenu(null);
                    void runAction(() => window.api.revealRecording(one.filePath));
                  }}
                >
                  <FolderIcon />
                  Show in Explorer
                </button>
              )}

              {moveTargets.length > 0 && (
                <>
                  <p className="menu__label">Move to</p>
                  <div className="menu__scroll">
                    {moveTargets.map((t) => (
                      <button
                        key={t.path}
                        type="button"
                        className="menu__item"
                        onClick={() => void moveTo(t.path)}
                      >
                        <MoveIcon />
                        {t.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="menu__rule" />
              <button
                type="button"
                className="menu__item"
                onClick={() => void removeSelected(false)}
              >
                <TrashIcon />
                Move to Recycle Bin
              </button>
              <button
                type="button"
                className={`menu__item menu__item--danger ${confirmingPermanent ? 'is-confirming' : ''}`}
                onClick={() => {
                  if (confirmingPermanent) void removeSelected(true);
                  else setConfirmingPermanent(true);
                }}
              >
                <TrashIcon />
                {confirmingPermanent ? 'Confirm — cannot be undone' : 'Delete permanently'}
              </button>
            </>
          )}

          {menu.kind === 'folder' && (
            <>
              <p className="menu__title">{menu.target.split('/').pop()}</p>
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  const target = menu.target;
                  setMenu(null);
                  go(target);
                }}
              >
                <FolderIcon />
                Open
              </button>
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  const target = menu.target;
                  setMenu(null);
                  void runAction(() => window.api.revealFolder(target));
                }}
              >
                <ExternalIcon />
                Show in Explorer
              </button>
              <div className="menu__rule" />
              <button
                type="button"
                className={`menu__item menu__item--danger ${confirmingFolder === menu.target ? 'is-confirming' : ''}`}
                onClick={() => {
                  if (confirmingFolder === menu.target) {
                    const target = menu.target;
                    setConfirmingFolder(null);
                    setMenu(null);
                    void runAction(() => window.api.deleteFolder(target));
                  } else {
                    setConfirmingFolder(menu.target);
                  }
                }}
              >
                <TrashIcon />
                {confirmingFolder === menu.target
                  ? 'Confirm — folder and contents'
                  : 'Delete folder'}
              </button>
            </>
          )}

          {menu.kind === 'background' && (
            <>
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  setMenu(null);
                  setNewFolder('');
                }}
              >
                <FolderPlusIcon />
                New folder
              </button>
              <button
                type="button"
                className="menu__item"
                disabled={files.length === 0}
                onClick={() => {
                  setSelected(files.map((f) => f.filePath));
                  setMenu(null);
                }}
              >
                <CheckIcon />
                Select all
              </button>
              <button
                type="button"
                className="menu__item"
                onClick={() => {
                  setMenu(null);
                  void runAction(() => window.api.revealFolder(place));
                }}
              >
                <ExternalIcon />
                Open in Explorer
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
