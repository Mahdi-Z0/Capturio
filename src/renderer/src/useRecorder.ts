import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioMode, QualityPreset, Recording } from '../../shared/types.js';
import {
  AUDIO_UNAVAILABLE_NOTE,
  IDLE_HUD_STATE,
  DEFAULT_AUDIO_MODE,
  DEFAULT_QUALITY,
  QUALITY_PRESETS,
} from '../../shared/types.js';

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'saving';

/**
 * Preferred first. The first supported entry wins.
 *
 * VP9 leads despite mp4 being more portable, because measurement on this machine
 * showed H.264 ignores videoBitsPerSecond entirely (16 Mbps requested, 63 Mbps
 * delivered on noise, ~0.7 Mbps on real screen content) while VP9 honours it
 * (2.5 -> 22 Mbps). Screen content needs controllable, generous bitrate far more
 * than it needs the mp4 container. Windows 10+ plays webm natively.
 */
const CANDIDATES: ReadonlyArray<{ mimeType: string; ext: string }> = [
  { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
  { mimeType: 'video/mp4;codecs=avc1', ext: 'mp4' },
  { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
  { mimeType: 'video/webm', ext: 'webm' },
];

/** Never hardcode a container -- support varies by machine and Chromium build. */
function pickContainer(): { mimeType: string; ext: string } {
  for (const c of CANDIDATES) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: '', ext: 'webm' };
}

const CHUNK_MS = 2000;

/**
 * Capture constraints for a given frame rate.
 *
 * resizeMode 'none' is the important one. Chromium defaults to 'crop-and-scale',
 * which pushes every frame through a resampler even when the requested size
 * already matches the display -- measured on this machine as 1920x1080 in,
 * 1920x1080 out, still flagged crop-and-scale. Resampling softens text edges.
 *
 * Width and height are deliberately NOT constrained: with no size constraint the
 * capture already reports the display's native 1920x1080, and asking for a size
 * is what invites the scaler back in.
 */
function videoConstraints(frameRate: number): MediaTrackConstraints {
  return { frameRate: { ideal: frameRate }, resizeMode: 'none' };
}

/**
 * Acquire capture, degrading to video-only rather than failing.
 *
 * If audio was requested and the whole call throws, retry once without it. A
 * driver that refuses audio capture should cost the narration, not the entire
 * recording -- losing a capture you cannot repeat is far worse than losing its
 * sound. Only a video failure is fatal.
 *
 * Returns what was actually obtained, so callers can report the truth.
 */
async function acquireWithAudio(
  frameRate: number,
  wantAudio: boolean,
): Promise<{ stream: MediaStream; audioRequested: boolean; audioObtained: boolean }> {
  if (import.meta.env.DEV && simFailNextCapture) {
    simFailNextCapture = false;
    console.warn('[__sim] simulating capture failure (this is a test hook, not a real fault)');
    throw new DOMException('Simulated capture failure', 'NotAllowedError');
  }

  const video = videoConstraints(frameRate);

  if (!wantAudio) {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
    return { stream, audioRequested: false, audioObtained: false };
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: true });
    // The quiet failure: the request is accepted, no audio track arrives, and the
    // app reports success. The user finds out on playback, when the moment has
    // gone. Check what came back rather than what was asked for.
    return {
      stream,
      audioRequested: true,
      audioObtained: stream.getAudioTracks().length > 0,
    };
  } catch (err) {
    console.error('[capture] audio request failed, retrying without audio:', err);
    const stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: false });
    return { stream, audioRequested: true, audioObtained: false };
  }
}

/**
 * Dev-only failure simulation.
 *
 * AC-5 and AC-7 were carried unexercised through two plans because neither
 * failure has a user-reachable trigger: `setDisplayMediaRequestHandler` auto-grants,
 * so no permission prompt appears to cancel, and Chromium's "Stop sharing" bar is
 * never shown. These hooks make both paths reachable. They are stripped from
 * production builds by the `import.meta.env.DEV` guard.
 */
let simFailNextCapture = false;

function message(err: unknown): string {
  if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
    return 'Screen capture was cancelled.';
  }
  return err instanceof Error ? err.message : String(err);
}

/** What the capture actually negotiated, as opposed to what was requested. */
export interface CaptureInfo {
  width: number;
  height: number;
  frameRate: number;
  resizeMode: string;
  codec: string;
  /** What the user asked for, and what the stream actually carried. */
  audioRequested: boolean;
  audioObtained: boolean;
}

export interface RecorderState {
  status: RecorderStatus;
  elapsedMs: number;
  lastSaved: Recording | null;
  error: string | null;
  captureInfo: CaptureInfo | null;
  /** The preset the in-flight recording is actually using, not the stored setting. */
  activePreset: QualityPreset | null;
  paused: boolean;
  muted: boolean;
  start: () => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  toggleMute: () => void;
}

export function useRecorder(): RecorderState {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastSaved, setLastSaved] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captureInfo, setCaptureInfo] = useState<CaptureInfo | null>(null);
  const [activePreset, setActivePreset] = useState<QualityPreset | null>(null);

  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const idRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  // Paused time is excluded from the clock: a 10-minute timer on a 6-minute file
  // is a lie, and the timer is what people trust to know how long they have run.
  const pausedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);
  // Chunks are appended one at a time, in order. Without this the writes race.
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setPaused(false);
    setMuted(false);
    pausedAtRef.current = 0;
    pausedTotalRef.current = 0;
    window.api.publishHudState(IDLE_HUD_STATE);
  }, []);

  const elapsedNow = useCallback((): number => {
    if (!startedAtRef.current) return 0;
    const frozenAt = pausedAtRef.current || Date.now();
    return frozenAt - startedAtRef.current - pausedTotalRef.current;
  }, []);

  useEffect(() => {
    if (status !== 'recording') return;
    const t = setInterval(() => setElapsedMs(elapsedNow()), 200);
    return () => clearInterval(t);
  }, [status, elapsedNow]);

  /*
   * Push state to the overlay indicator.
   *
   * Its own interval rather than a React render: only the clock changes, so
   * re-rendering the whole app to advance it would be wasteful.
   */
  useEffect(() => {
    if (status !== 'recording') return;
    const publish = (): void => {
      const track = streamRef.current?.getAudioTracks()[0];
      window.api.publishHudState({
        recording: true,
        paused: Boolean(pausedAtRef.current),
        elapsedMs: elapsedNow(),
        hasAudio: Boolean(track),
        muted: track ? !track.enabled : false,
      });
    };
    publish();
    const t = setInterval(publish, 250);
    return () => clearInterval(t);
  }, [status, elapsedNow]);

  // Release the capture if the window closes mid-recording.
  useEffect(() => releaseStream, [releaseStream]);

  // Dev-only test hooks for AC-5 and AC-7. Neither failure has a user-reachable
  // trigger in this app, which is why both criteria went unexercised for two plans.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const sim = {
      failCapture: (): string => {
        simFailNextCapture = true;
        return 'Armed: the next Record will fail once, then clear.';
      },
      endTrack: (): string => {
        const track = streamRef.current?.getVideoTracks()[0];
        if (!track) return 'No active recording.';
        // Dispatch rather than stop(): stop() does not fire onended, and onended
        // is the handler AC-7 exists to exercise.
        track.dispatchEvent(new Event('ended'));
        return 'Ended the capture track without pressing Stop.';
      },
    };
    (window as unknown as { __sim?: typeof sim }).__sim = sim;
    return () => {
      delete (window as unknown as { __sim?: typeof sim }).__sim;
    };
  }, []);

  const start = useCallback(async () => {
    // Guard re-entry: a double-click must not open two recorders on two .part files.
    if (status !== 'idle') return;

    setError(null);
    setLastSaved(null);
    setStatus('starting');

    // Read at start(), not module load, so a change applies to the next recording
    // without a restart. Held for the whole recording (AC-3).
    const presetKey = await window.api.getQuality().catch(() => DEFAULT_QUALITY);
    const preset = QUALITY_PRESETS[presetKey];
    const audioMode: AudioMode = await window.api.getAudioMode().catch(() => DEFAULT_AUDIO_MODE);

    let stream: MediaStream;
    let audioRequested = false;
    let audioObtained = false;
    try {
      const got = await acquireWithAudio(preset.frameRate, audioMode === 'system');
      stream = got.stream;
      audioRequested = got.audioRequested;
      audioObtained = got.audioObtained;
    } catch (err) {
      setStatus('idle');
      setError(message(err));
      return;
    }

    // Requested but absent: keep the recording, say so plainly (AC-5, AC-6).
    if (audioRequested && !audioObtained) {
      setError(AUDIO_UNAVAILABLE_NOTE);
    }

    const { mimeType, ext } = pickContainer();
    let recordingId: string;
    try {
      recordingId = await window.api.beginRecording(ext);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      setStatus('idle');
      setError(message(err));
      return;
    }

    streamRef.current = stream;

    idRef.current = recordingId;
    queueRef.current = Promise.resolve();

    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: preset.videoBitsPerSecond,
    });
    recorderRef.current = recorder;
    setActivePreset(presetKey);

    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      // Chain rather than await: ondataavailable is not awaited by the browser,
      // so chaining is what keeps chunk order stable.
      queueRef.current = queueRef.current
        .then(async () => {
          const buf = await event.data.arrayBuffer();
          await window.api.appendChunk(recordingId, buf);
        })
        .catch((err: unknown) => {
          setError(message(err));
          try {
            recorder.stop();
          } catch {
            /* already stopped */
          }
        });
    };

    recorder.onstop = () => {
      setStatus('saving');
      void queueRef.current
        .then(() => window.api.finishRecording(recordingId))
        .then((saved) => {
          setLastSaved(saved);
          setError(null);
        })
        .catch(async (err: unknown) => {
          setError(message(err));
          await window.api.abortRecording(recordingId).catch(() => undefined);
        })
        .finally(() => {
          idRef.current = null;
          releaseStream();
          setStatus('idle');
          setElapsedMs(0);
          setActivePreset(null);
        });
    };

    // Capture can end outside the app: Windows' own "Stop sharing" control, or a
    // display being disconnected. Without this the UI keeps claiming to record.
    const [track] = stream.getVideoTracks();
    if (track) {
      track.onended = () => {
        if (recorder.state !== 'inactive') recorder.stop();
      };
    }

    if (track) {
      const s = track.getSettings();
      setCaptureInfo({
        width: s.width ?? 0,
        height: s.height ?? 0,
        frameRate: Math.round(s.frameRate ?? 0),
        resizeMode: s.resizeMode ?? 'unknown',
        codec: mimeType || 'default',
        audioRequested,
        audioObtained,
      });
    }

    startedAtRef.current = Date.now();
    setElapsedMs(0);
    recorder.start(CHUNK_MS);
    setStatus('recording');
  }, [status, releaseStream]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    pausedAtRef.current = Date.now();
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    // Credit the paused span before clearing it, or the clock jumps forward by
    // however long the pause lasted.
    pausedTotalRef.current += Date.now() - pausedAtRef.current;
    pausedAtRef.current = 0;
    recorder.resume();
    setPaused(false);
  }, []);

  /**
   * Silence the audio without removing the track.
   *
   * `track.enabled = false` records silence for the muted stretch. Stopping the
   * track instead would end it permanently -- MediaRecorder cannot add one back
   * mid-recording, so unmuting would be impossible.
   */
  const toggleMute = useCallback(() => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  // Commands from the overlay indicator.
  useEffect(() => {
    return window.api.onHudCommand((command) => {
      if (command === 'stop') stop();
      else if (command === 'pause') pause();
      else if (command === 'resume') resume();
      else if (command === 'toggle-mute') toggleMute();
    });
  }, [stop, pause, resume, toggleMute]);

  return {
    status,
    elapsedMs,
    lastSaved,
    error,
    captureInfo,
    activePreset,
    paused,
    muted,
    start,
    stop,
    pause,
    resume,
    toggleMute,
  };
}
