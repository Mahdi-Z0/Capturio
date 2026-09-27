import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecorder } from './useRecorder.js';
import WindowPicker from './WindowPicker.js';
import TourCard, { TOUR_STEPS } from './Tour.js';
import {
  AUDIO_MODES,
  DEFAULT_AUDIO_MODE,
  LOW_SPACE_BYTES,
  SCREEN_TARGET,
  type AudioMode,
  type CaptureTarget,
  type Recording,
  type RegionRect,
  type ShortcutStatus,
} from '../../shared/types.js';
import {
  CheckIcon,
  CloseIcon,
  SlidersIcon,
  LibraryIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  RegionIcon,
  ScreenIcon,
  SpeakerIcon,
  StopIcon,
  WindowIcon,
} from './icons.js';

function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Sound is two independent switches; the four audio modes are their combinations. */
function modeFrom(system: boolean, microphone: boolean): AudioMode {
  if (system && microphone) return 'both';
  if (system) return 'system';
  if (microphone) return 'microphone';
  return 'none';
}

type Panel = 'none' | 'window';
type SourceKind = 'screen' | 'window' | 'region';

const BAR_HEIGHT = 64;

/** How long the "saved" card stays up. Long enough to read and act on, short
 * enough that the bar is back to its own size before it is next needed. */
const SAVED_NOTICE_MS = 12_000;

/**
 * The floating control bar.
 *
 * This is the whole app in the common case: pick what to record, switch sound
 * on or off, press record. It sits over the work being recorded rather than
 * asking anyone to visit a window, which is the point — a recorder is never the
 * task, only the thing that captures it.
 *
 * It also holds the recorder itself, so the recordings window can be opened and
 * closed freely without touching a capture in progress.
 */
export default function Bar(): React.JSX.Element {
  const {
    status,
    elapsedMs,
    error,
    captureInfo,
    paused,
    muted,
    lastSaved,
    start,
    stop,
    pause,
    resume,
    toggleMute,
  } = useRecorder();

  const [source, setSource] = useState<SourceKind>('screen');
  const [windowTarget, setWindowTarget] = useState<CaptureTarget | null>(null);
  const [region, setRegion] = useState<RegionRect | null>(null);
  const [audio, setAudio] = useState<AudioMode>(DEFAULT_AUDIO_MODE);
  const [panel, setPanel] = useState<Panel>('none');
  const [lowSpace, setLowSpace] = useState<number | null>(null);
  // `lastSaved` never clears, so the card is derived from it plus the one thing
  // that can put it away: which save has been dismissed, by hand or by timeout.
  const [dismissedSave, setDismissedSave] = useState<string | null>(null);
  // Which tour step is showing, or null. Started once on a fresh install's first
  // launch, and from Help whenever asked for.
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [tourShortcuts, setTourShortcuts] = useState<ShortcutStatus[]>([]);
  const shellRef = useRef<HTMLDivElement>(null);

  const recording = status === 'recording';
  const busy = status === 'starting' || status === 'saving';
  const locked = status !== 'idle';
  // Derived, not stored: recording closes any open panel, and an effect that
  // wrote that back into state would render the dead panel for one frame first.
  const openPanel: Panel = locked ? 'none' : panel;
  // A recording that starts mid-tour ends it: the buttons it points at are gone.
  const touring = tourStep !== null && !locked;
  const tourTarget = touring ? (TOUR_STEPS[tourStep]?.target ?? null) : null;

  useEffect(() => {
    window.api
      .getAudioMode()
      .then(setAudio)
      .catch(() => undefined);

    // Checked when the bar appears and after each recording, not on a timer: a
    // disk does not fill while nothing is being written.
    const checkSpace = (): void => {
      window.api
        .getFreeSpace()
        .then((free) => setLowSpace(free !== null && free < LOW_SPACE_BYTES ? free : null))
        .catch(() => undefined);
    };
    checkSpace();
    window.addEventListener('focus', checkSpace);
    return () => window.removeEventListener('focus', checkSpace);
  }, [lastSaved]);

  const setAudioMode = useCallback((next: AudioMode) => {
    setAudio(next);
    void window.api.setAudioMode(next).catch(() => undefined);
  }, []);

  const chooseRegion = useCallback(() => {
    setPanel('none');
    window.api
      .selectRegion()
      .then((r) => {
        if (!r) return;
        setRegion(r);
        setSource('region');
      })
      .catch(() => undefined);
  }, []);

  const pickSource = useCallback(
    (kind: SourceKind) => {
      setSource(kind);
      if (kind === 'window') setPanel('window');
      else if (kind === 'region') chooseRegion();
      else setPanel('none');
    },
    [chooseRegion],
  );

  const target: CaptureTarget | null = useMemo(
    () =>
      source === 'screen'
        ? SCREEN_TARGET
        : source === 'window'
          ? windowTarget
          : region
            ? { kind: 'region', rect: region }
            : null,
    [source, windowTarget, region],
  );

  // Tell the recordings window, if it is open, that there is something new.
  useEffect(() => {
    if (lastSaved) window.api.announceRecording(lastSaved.filePath);
  }, [lastSaved]);

  // What happened to the recording is the one thing worth interrupting for, and
  // the recordings window is deliberately not opened to say it -- that would put
  // a window back over the work the moment the recording ended. Starting the
  // next recording is an answer to the last one, so the card goes then too.
  const savedCard: Recording | null =
    lastSaved && !recording && lastSaved.filePath !== dismissedSave ? lastSaved : null;

  useEffect(() => {
    if (!lastSaved) return undefined;
    const timer = setTimeout(() => setDismissedSave(lastSaved.filePath), SAVED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [lastSaved]);

  // The region selector resolves long after the shortcut that opened it, and in
  // between another shortcut may have started a recording. Read the recorder as
  // it is *then*, not as it was when the selector opened, or a stale start() whose
  // own guard still saw 'idle' would open a second recorder on a second file.
  const latest = useRef({ start, locked });
  useEffect(() => {
    latest.current = { start, locked };
  });

  // Global shortcuts and the tray, relayed by main. The bar answers them rather
  // than the recorder, because only the bar knows what is currently chosen.
  useEffect(() => {
    return window.api.onHudCommand((command) => {
      if (command === 'toggle') {
        if (recording) stop();
        else if (!busy && target) void start(target);
      } else if (command === 'record-region') {
        // Mid-recording it does nothing: stopping is the other shortcut's job.
        if (locked) return;
        setPanel('none');
        window.api
          .selectRegion()
          .then((rect) => {
            if (!rect || latest.current.locked) return;
            // Left selected afterwards, so the next plain start records it again.
            setRegion(rect);
            setSource('region');
            void latest.current.start({ kind: 'region', rect });
          })
          .catch(() => undefined);
      }
    });
  }, [recording, busy, locked, target, start, stop]);

  // The tour, asked for from the recordings window. Main brings the bar forward
  // first; the shortcuts are read now so the steps name the ones that work.
  useEffect(() => {
    const begin = (): void => {
      setPanel('none');
      setTourStep(0);
      window.api
        .getShortcuts()
        .then(setTourShortcuts)
        .catch(() => undefined);
    };
    window.api
      .takePendingTour()
      .then((asked) => asked && begin())
      .catch(() => undefined);
    return window.api.onTour(begin);
  }, []);

  useEffect(() => {
    if (!touring) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setTourStep(null);
      else if (e.key === 'ArrowRight')
        setTourStep((s) => (s === null ? s : Math.min(s + 1, TOUR_STEPS.length - 1)));
      else if (e.key === 'ArrowLeft') setTourStep((s) => (s === null ? s : Math.max(s - 1, 0)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [touring]);

  const spec = AUDIO_MODES[audio];

  // One line, under the bar, only when there is something to say. Priority:
  // a failure, then a missing audio source, then what will be recorded.
  const note =
    error ??
    captureInfo?.audioNote ??
    (lowSpace !== null && !recording
      ? `Only ${(lowSpace / 1e9).toFixed(1)} GB left where recordings are saved`
      : null) ??
    (recording
      ? null
      : target === null
        ? source === 'window'
          ? 'Choose a window below'
          : 'Choose a region to record'
        : target.kind === 'window'
          ? target.name
          : target.kind === 'region'
            ? `${target.rect.width} × ${target.rect.height} region`
            : null);

  // The window is only as tall as what it shows: a transparent window still
  // swallows clicks, so leaving it panel-sized would block the desktop beneath.
  useEffect(() => {
    // Measured every time, not just for panels: the note and the saved card make
    // the shell taller too, and a window shorter than its content clips them.
    const height = Math.max(BAR_HEIGHT, shellRef.current?.scrollHeight ?? BAR_HEIGHT);
    window.api.resizeBar(Math.ceil(height));
  }, [openPanel, source, windowTarget, audio, recording, note, savedCard, tourStep, touring]);

  return (
    <div className="barShell" ref={shellRef} data-touring={tourTarget ?? undefined}>
      <div className={`bar ${recording ? 'is-recording' : ''}`} data-tour="bar">
        {recording || busy ? (
          <>
            <span className={`bar__live ${paused ? 'is-paused' : ''}`} aria-hidden="true" />
            <span className="bar__clock">
              {busy && !recording ? '· · ·' : formatElapsed(elapsedMs)}
            </span>
            <span className="bar__what">
              {status === 'saving'
                ? 'Saving'
                : !recording
                  ? 'Starting'
                  : paused
                    ? 'Paused'
                    : 'Recording'}
            </span>

            <div className="bar__group">
              <button
                type="button"
                className={`icon ${muted ? 'is-off' : ''}`}
                onClick={toggleMute}
                disabled={!captureInfo?.audioObtained}
                title={muted ? 'Unmute' : 'Mute'}
                aria-label={muted ? 'Unmute' : 'Mute'}
              >
                <MicIcon off={muted} />
              </button>
              <button
                type="button"
                className="icon"
                onClick={() => (paused ? resume() : pause())}
                title={paused ? 'Resume' : 'Pause'}
                aria-label={paused ? 'Resume' : 'Pause'}
              >
                {paused ? <PlayIcon /> : <PauseIcon />}
              </button>
            </div>

            <button
              type="button"
              className="stop"
              onClick={stop}
              disabled={busy && !recording}
              title="Stop and save"
              aria-label="Stop and save"
            >
              <StopIcon />
            </button>
          </>
        ) : (
          <>
            <div
              className="bar__group"
              role="radiogroup"
              aria-label="What to record"
              data-tour="source"
            >
              {(
                [
                  ['screen', 'Whole screen', <ScreenIcon key="s" />],
                  ['window', 'A window', <WindowIcon key="w" />],
                  ['region', 'A region', <RegionIcon key="r" />],
                ] as const
              ).map(([kind, label, icon]) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={source === kind}
                  className={`icon ${source === kind ? 'is-on' : ''}`}
                  onClick={() => pickSource(kind)}
                  title={label}
                  aria-label={label}
                >
                  {icon}
                </button>
              ))}
            </div>

            <div className="bar__group" data-tour="sound">
              <button
                type="button"
                aria-pressed={spec.system}
                className={`icon ${spec.system ? 'is-on' : 'is-off'}`}
                onClick={() => setAudioMode(modeFrom(!spec.system, spec.microphone))}
                title={spec.system ? 'Computer sound on' : 'Computer sound off'}
                aria-label={spec.system ? 'Turn computer sound off' : 'Turn computer sound on'}
              >
                <SpeakerIcon off={!spec.system} />
              </button>
              <button
                type="button"
                aria-pressed={spec.microphone}
                className={`icon ${spec.microphone ? 'is-on' : 'is-off'}`}
                onClick={() => setAudioMode(modeFrom(spec.system, !spec.microphone))}
                title={spec.microphone ? 'Microphone on' : 'Microphone off'}
                aria-label={spec.microphone ? 'Turn microphone off' : 'Turn microphone on'}
              >
                <MicIcon off={!spec.microphone} />
              </button>
            </div>

            <button
              type="button"
              className="record"
              data-tour="record"
              onClick={() => target && void start(target)}
              disabled={busy || target === null}
              title={target === null ? 'Choose what to record first' : 'Start recording'}
              aria-label="Start recording"
            >
              <span className="record__dot" />
            </button>

            <div className="bar__group bar__group--end">
              <button
                type="button"
                className="icon"
                data-tour="windows"
                onClick={() => void window.api.openLibraryAt('settings').catch(() => undefined)}
                title="Settings"
                aria-label="Settings"
              >
                <SlidersIcon />
              </button>
              <button
                type="button"
                className="icon"
                data-tour="windows"
                onClick={() => void window.api.openLibrary()}
                title="Recordings"
                aria-label="Recordings"
              >
                <LibraryIcon />
              </button>
              <button
                type="button"
                className="icon icon--quit"
                data-tour="hide"
                onClick={() => void window.api.hideBar()}
                title="Hide — bring it back from the tray icon"
                aria-label="Hide the bar"
              >
                <CloseIcon />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Straight under the bar, so the caret meets what it points at. */}
      {touring && tourStep !== null && (
        <TourCard
          index={tourStep}
          shortcuts={tourShortcuts}
          onBack={() => setTourStep((s) => (s === null ? s : Math.max(s - 1, 0)))}
          onNext={() =>
            setTourStep((s) => (s === null ? s : Math.min(s + 1, TOUR_STEPS.length - 1)))
          }
          onClose={() => setTourStep(null)}
        />
      )}

      {note && (
        <p className={`note ${(error ?? captureInfo?.audioNote) ? 'is-warn' : ''}`} role="status">
          {note}
        </p>
      )}

      {savedCard && !recording && !touring && (
        <div className="saved" role="status">
          <button
            type="button"
            className="saved__main"
            onClick={() =>
              void window.api.revealInLibrary(savedCard.filePath, false).catch(() => undefined)
            }
            title="Show it in the recordings window"
          >
            <span className="saved__tick" aria-hidden="true">
              <CheckIcon />
            </span>
            <span className="saved__text">
              <span className="saved__title">Recording saved</span>
              <span className="saved__name">{savedCard.fileName}</span>
            </span>
          </button>
          <div className="saved__actions">
            {/* Both stay in the app: it has a player and a folder view of its
                own, so handing this to Explorer or to whatever owns .webm is the
                long way round to look at what you just recorded. */}
            <button
              type="button"
              className="saved__action"
              onClick={() =>
                void window.api.revealInLibrary(savedCard.filePath, true).catch(() => undefined)
              }
            >
              Play
            </button>
            <button
              type="button"
              className="saved__action"
              onClick={() =>
                void window.api.revealInLibrary(savedCard.filePath, false).catch(() => undefined)
              }
            >
              Show in library
            </button>
            <button
              type="button"
              className="icon saved__close"
              onClick={() => setDismissedSave(savedCard.filePath)}
              title="Dismiss"
              aria-label="Dismiss"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}

      {openPanel === 'window' && (
        <div className="panel">
          <WindowPicker
            selectedId={windowTarget?.kind === 'window' ? windowTarget.id : null}
            onSelect={setWindowTarget}
            disabled={false}
          />
        </div>
      )}
    </div>
  );
}
