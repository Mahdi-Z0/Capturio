import { useEffect, useState } from 'react';
import { IDLE_HUD_STATE, type HudState } from '../../shared/types.js';

function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * The on-screen recording indicator.
 *
 * Lives in its own always-on-top window that is excluded from screen capture, so
 * it can say "you are recording" without appearing in the recording.
 *
 * It holds no recording state of its own and makes no decisions: it renders what
 * the recorder pushes and sends back button presses. Two sources of truth about
 * whether a recording is running is exactly how a stop button ends up lying.
 */
export default function Overlay(): React.JSX.Element {
  const [state, setState] = useState<HudState>(IDLE_HUD_STATE);

  useEffect(() => window.api.onHudState(setState), []);

  const audioLabel = !state.hasAudio
    ? 'This recording has no audio'
    : state.muted
      ? 'Unmute audio'
      : 'Mute audio';

  return (
    <div className={`hud ${state.paused ? 'is-paused' : ''}`}>
      {/* The pill body is the drag handle; every control opts out, or a click
          would start a drag instead. */}
      <span className="hud__dot" aria-hidden="true" />

      <span className="hud__time">
        {formatElapsed(state.elapsedMs)}
        {state.paused && <span className="hud__paused">paused</span>}
      </span>

      <div className="hud__actions">
        <button
          type="button"
          className={`hud__btn ${state.muted ? 'is-off' : ''}`}
          disabled={!state.hasAudio}
          onClick={() => window.api.sendHudCommand('toggle-mute')}
          aria-label={audioLabel}
          title={audioLabel}
        >
          {state.muted || !state.hasAudio ? '🔇' : '🔊'}
        </button>

        <button
          type="button"
          className="hud__btn"
          onClick={() => window.api.sendHudCommand(state.paused ? 'resume' : 'pause')}
          aria-label={state.paused ? 'Resume recording' : 'Pause recording'}
          title={state.paused ? 'Resume recording' : 'Pause recording'}
        >
          {state.paused ? '▶' : '❚❚'}
        </button>

        <button
          type="button"
          className="hud__btn hud__btn--stop"
          onClick={() => window.api.sendHudCommand('stop')}
          aria-label="Stop recording and save"
          title="Stop recording and save"
        >
          ■
        </button>
      </div>
    </div>
  );
}
