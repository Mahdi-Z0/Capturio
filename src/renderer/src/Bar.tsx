import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecorder } from './useRecorder.js';
import WindowPicker from './WindowPicker.js';
import MicPicker from './MicPicker.js';
import {
  AUDIO_MODES,
  DEFAULT_AUDIO_MODE,
  DEFAULT_QUALITY,
  QUALITY_PRESETS,
  SCREEN_TARGET,
  type AudioMode,
  type CaptureTarget,
  type QualityPreset,
  type RegionRect,
} from '../../shared/types.js';
import {
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

type Panel = 'none' | 'window' | 'settings';
type SourceKind = 'screen' | 'window' | 'region';

const BAR_HEIGHT = 64;

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
  const [quality, setQuality] = useState<QualityPreset>(DEFAULT_QUALITY);
  const [panel, setPanel] = useState<Panel>('none');
  const shellRef = useRef<HTMLDivElement>(null);

  const recording = status === 'recording';
  const busy = status === 'starting' || status === 'saving';
  const locked = status !== 'idle';
  // Derived, not stored: recording closes any open panel, and an effect that
  // wrote that back into state would render the dead panel for one frame first.
  const openPanel: Panel = locked ? 'none' : panel;

  useEffect(() => {
    window.api
      .getAudioMode()
      .then(setAudio)
      .catch(() => undefined);
    window.api
      .getQuality()
      .then(setQuality)
      .catch(() => undefined);
  }, []);


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

  // Ctrl+Shift+R, relayed by main. The bar answers it rather than the recorder,
  // because only the bar knows what is currently chosen to record.
  useEffect(() => {
    return window.api.onHudCommand((command) => {
      if (command !== 'toggle') return;
      if (recording) stop();
      else if (!busy && target) void start(target);
    });
  }, [recording, busy, target, start, stop]);

  const spec = AUDIO_MODES[audio];

  // One line, under the bar, only when there is something to say. Priority:
  // a failure, then a missing audio source, then what will be recorded.
  const note =
    error ??
    captureInfo?.audioNote ??
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
    const height = openPanel === 'none' ? BAR_HEIGHT : (shellRef.current?.scrollHeight ?? BAR_HEIGHT);
    window.api.resizeBar(Math.ceil(height));
  }, [openPanel, source, windowTarget, audio, quality, recording, note]);

  return (
    <div className="barShell" ref={shellRef}>
      <div className={`bar ${recording ? 'is-recording' : ''}`}>
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
            <div className="bar__group" role="radiogroup" aria-label="What to record">
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

            <div className="bar__group">
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
                className={`icon ${openPanel === 'settings' ? 'is-on' : ''}`}
                onClick={() => setPanel(openPanel === 'settings' ? 'none' : 'settings')}
                title="Settings"
                aria-label="Settings"
                aria-expanded={openPanel === 'settings'}
              >
                <SlidersIcon />
              </button>
              <button
                type="button"
                className="icon"
                onClick={() => void window.api.openLibrary()}
                title="Recordings"
                aria-label="Recordings"
              >
                <LibraryIcon />
              </button>
              <button
                type="button"
                className="icon icon--quit"
                onClick={() => void window.api.quitApp()}
                title="Close ScreenRecorder"
                aria-label="Close ScreenRecorder"
              >
                <CloseIcon />
              </button>
            </div>
          </>
        )}
      </div>

      {note && (
        <p className={`note ${error ?? captureInfo?.audioNote ? 'is-warn' : ''}`} role="status">
          {note}
        </p>
      )}

      {lastSaved && !recording && !note && (
        <p className="note" role="status">
          Saved {lastSaved.fileName}
        </p>
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

      {openPanel === 'settings' && (
        <div className="panel">
          <fieldset className="picker picker--quality">
            <legend className="picker__legend">Quality</legend>
            <div className="picker__options">
              {(['balanced', 'high', 'maximum'] as QualityPreset[]).map((key) => {
                const p = QUALITY_PRESETS[key];
                return (
                  <label
                    key={key}
                    className={`picker__option ${quality === key ? 'is-selected' : ''}`}
                  >
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
                    <span className="picker__name">{p.label}</span>
                    <span className="picker__note">{p.blurb}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {spec.microphone && <MicPicker disabled={false} />}
        </div>
      )}
    </div>
  );
}
