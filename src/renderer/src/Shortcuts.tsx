import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acceleratorKeys,
  DEFAULT_SHORTCUTS,
  SHORTCUT_LABELS,
  SHORTCUT_ORDER,
  type ShortcutAction,
  type ShortcutChange,
  type ShortcutStatus,
} from '../../shared/types.js';

/** A combination drawn as the keys someone presses. */
export function Keys({ accelerator }: { accelerator: string }): React.JSX.Element {
  return (
    <span className="combo">
      {acceleratorKeys(accelerator).map((key, i) => (
        <span key={key}>
          {i > 0 && <span className="combo__plus">+</span>}
          <kbd className="kbd">{key}</kbd>
        </span>
      ))}
    </span>
  );
}

/**
 * The key a KeyboardEvent names, as main's validator spells it, or null.
 *
 * By `code`, not `key`, so a letter is the same key whatever it types in the
 * current layout. Punctuation and the numeric keypad are left out on purpose:
 * Electron resolves those through the layout, so what Settings shows and what
 * fires could differ.
 */
function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  const named: Record<string, string> = {
    Space: 'Space',
    Insert: 'Insert',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    PrintScreen: 'PrintScreen',
  };
  return named[code] ?? null;
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'OS']);

/** Held modifiers in the order main writes them: Win first, as Windows does. */
function modifiersOf(e: KeyboardEvent): string[] {
  return [
    e.metaKey && 'Super',
    e.ctrlKey && 'Control',
    e.altKey && 'Alt',
    e.shiftKey && 'Shift',
  ].filter((m): m is string => Boolean(m));
}

const KEY_PROBLEM =
  'That key cannot be used. Letters, numbers, F1–F24 and the arrow and page keys can.';

/**
 * The global shortcuts: keys set by clicking and pressing them, and a switch.
 *
 * The state shown is main's, not what was asked for: a combination Windows or
 * another program holds is marked as not working rather than displayed as if it
 * were, because a shortcut that silently does nothing is worse than none.
 */
export default function Shortcuts(): React.JSX.Element {
  const [items, setItems] = useState<ShortcutStatus[]>([]);
  const [listening, setListening] = useState<ShortcutAction | null>(null);
  const [held, setHeld] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.api
      .getShortcuts()
      .then(setItems)
      .catch(() => undefined);
  }, []);

  const listen = (action: ShortcutAction): void => {
    setProblem(null);
    setHeld([]);
    setListening(action);
    // Otherwise pressing the current combination fires it instead of arriving here.
    window.api.suspendShortcuts(true);
  };

  const cancel = useCallback((): void => {
    setListening(null);
    setHeld([]);
    window.api.suspendShortcuts(false);
  }, []);

  // Main lifts the suspension itself when a shortcut is set, on every path.
  const apply = useCallback((action: ShortcutAction, change: ShortcutChange): void => {
    setListening(null);
    setHeld([]);
    setSaving(true);
    window.api
      .setShortcut(action, change)
      .then((update) => {
        setItems(update.shortcuts);
        setProblem(update.problem);
      })
      .catch(() => setProblem('The shortcut could not be saved.'))
      .finally(() => setSaving(false));
  }, []);

  // The whole window listens, not the button: a clicked button does not always
  // hold focus, and one that missed the keys would sit at "Press the keys…" with
  // every shortcut suspended behind it.
  const listeningButton = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!listening) return undefined;
    const action = listening;

    const onKeyDown = (e: KeyboardEvent): void => {
      // Everything, while listening: Space must not click a button, Tab must not
      // move focus, and Alt must not raise the window's menu.
      e.preventDefault();
      e.stopPropagation();
      const mods = modifiersOf(e);
      if (MODIFIER_KEYS.has(e.key)) return setHeld(mods);
      if (mods.length === 0 && e.key === 'Escape') return cancel();
      // Windows delivers Print Screen on release only; it is handled on keyup.
      if (e.code === 'PrintScreen') return;
      const key = keyFromCode(e.code);
      if (!key) return setProblem(KEY_PROBLEM);
      // Setting new keys switches the shortcut on: nobody picks keys to leave unused.
      apply(action, { keys: [...mods, key].join('+'), enabled: true });
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'PrintScreen') {
        apply(action, { keys: [...modifiersOf(e), 'PrintScreen'].join('+'), enabled: true });
      } else {
        setHeld(modifiersOf(e));
      }
    };

    // A click anywhere else, or leaving the window, is a cancel. The button
    // itself is left to its own click, which cancels too.
    const onPointerDown = (e: PointerEvent): void => {
      if (!listeningButton.current?.contains(e.target as Node)) cancel();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', cancel);
    };
  }, [listening, cancel, apply]);

  const isDefault = items.every((item) => {
    const d = DEFAULT_SHORTCUTS[item.action];
    return item.accelerator === d.keys && item.enabled === d.enabled;
  });

  // Everything off first, so keys swapped between the two cannot collide on
  // the way back to the defaults.
  const restoreDefaults = async (): Promise<void> => {
    setListening(null);
    setProblem(null);
    setSaving(true);
    try {
      for (const action of SHORTCUT_ORDER) {
        await window.api.setShortcut(action, { enabled: false });
      }
      const problems: string[] = [];
      for (const action of SHORTCUT_ORDER) {
        const d = DEFAULT_SHORTCUTS[action];
        const update = await window.api.setShortcut(action, { keys: d.keys, enabled: d.enabled });
        setItems(update.shortcuts);
        if (update.problem) problems.push(update.problem);
      }
      setProblem(problems.length > 0 ? problems.join(' ') : null);
    } catch {
      setProblem('The shortcuts could not be restored.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page__group">
      <h2 className="page__heading">Shortcuts</h2>

      <ul className="shortcuts">
        {items.map((item) => {
          const on = listening === item.action;
          const label = SHORTCUT_LABELS[item.action];
          return (
            <li key={item.action} className="shortcuts__row">
              <span className="shortcuts__name">{label}</span>
              <button
                type="button"
                className={`shortcuts__keys ${on ? 'is-listening' : ''} ${
                  item.enabled ? '' : 'is-disabled'
                }`}
                ref={on ? listeningButton : undefined}
                disabled={saving}
                onClick={() => (on ? cancel() : listen(item.action))}
                title="Click, then press the new keys"
                aria-label={`${label}: ${acceleratorKeys(item.accelerator).join(' ')}. Press to change.`}
              >
                {on ? (
                  held.length > 0 ? (
                    <>
                      <Keys accelerator={held.join('+')} />
                      <span className="combo__plus">+ …</span>
                    </>
                  ) : (
                    'Press the keys…'
                  )
                ) : (
                  <Keys accelerator={item.accelerator} />
                )}
              </button>
              <button
                type="button"
                role="switch"
                aria-checked={item.enabled}
                aria-label={`${label} shortcut`}
                className={`switch ${item.enabled ? 'is-on' : ''}`}
                disabled={saving || on}
                onClick={() => apply(item.action, { enabled: !item.enabled })}
              >
                <span className="switch__knob" />
              </button>
              <span className={`shortcuts__state ${item.state === 'taken' ? 'is-warn' : ''}`}>
                {on
                  ? 'Esc cancels'
                  : item.state === 'taken'
                    ? 'In use by Windows or another program'
                    : null}
              </span>
            </li>
          );
        })}
      </ul>

      {problem && (
        <p className="page__note is-warn" role="alert">
          {problem}
        </p>
      )}
      {!isDefault && (
        <button
          type="button"
          className="link"
          disabled={saving}
          onClick={() => void restoreDefaults()}
        >
          Restore the defaults
        </button>
      )}
    </div>
  );
}
