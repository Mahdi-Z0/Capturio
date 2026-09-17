import { useCallback, useEffect, useRef, useState } from 'react';
import type { QualityPreset, Recording } from '../../shared/types.js';
import { DEFAULT_QUALITY, QUALITY_PRESETS } from '../../shared/types.js';

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
 * Dev-only failure simulation.
 *
 * AC-5 and AC-7 were carried unexercised through two plans because neither
 * failure has a user-reachable trigger: `setDisplayMediaRequestHandler` auto-grants,
 * so no permission prompt appears to cancel, and Chromium's "Stop sharing" bar is
 * never shown. These hooks make both paths reachable. They are stripped from
 * production builds by the `import.meta.env.DEV` guard.
 */
let simFailNextCapture = false;

/**
 * Acquire the screen capture stream.
 *
 * Standard `getDisplayMedia`. A legacy `getUserMedia` path was tried and reverted:
 * measured 2026-09-17 with `npm run bench:capture`, at a 60 fps target the two are
 * indistinguishable (54.4 vs 54.6 fps, jitter 5.38 vs 5.14 ms), and at a 30 fps
 * target legacy had twice the jitter and four times the hitch rate. It won on
 * average frame rate while losing on the thing that actually looks like smooth
 * motion, so the non-standard API bought nothing.
 */
async function acquireCapture(frameRate: number): Promise<MediaStream> {
  if (import.meta.env.DEV && simFailNextCapture) {
    // One-shot: cleared here, before the throw, so a latched flag can never make
    // every subsequent recording fail with no visible cause.
    simFailNextCapture = false;
    console.warn('[__sim] simulating capture failure (this is a test hook, not a real fault)');
    throw new DOMException('Simulated capture failure', 'NotAllowedError');
  }
  return navigator.mediaDevices.getDisplayMedia({
    video: videoConstraints(frameRate),
    audio: false,
  });
}

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
}

export interface RecorderState {
  status: RecorderStatus;
  elapsedMs: number;
  lastSaved: Recording | null;
  error: string | null;
  captureInfo: CaptureInfo | null;
  /** The preset the in-flight recording is actually using, not the stored setting. */
  activePreset: QualityPreset | null;
  start: () => Promise<void>;
  stop: () => void;
}

export function useRecorder(): RecorderState {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [lastSaved, setLastSaved] = useState<Recording | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captureInfo, setCaptureInfo] = useState<CaptureInfo | null>(null);
  const [activePreset, setActivePreset] = useState<QualityPreset | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const idRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  // Chunks are appended one at a time, in order. Without this the writes race.
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    if (status !== 'recording') return;
    const t = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200);
    return () => clearInterval(t);
  }, [status]);

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

    let stream: MediaStream;
    try {
      stream = await acquireCapture(preset.frameRate);
    } catch (err) {
      setStatus('idle');
      setError(message(err));
      return;
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

  return { status, elapsedMs, lastSaved, error, captureInfo, activePreset, start, stop };
}
