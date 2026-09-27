import { useLayoutEffect, useRef } from 'react';
import { Keys } from './Shortcuts.js';
import type { ShortcutAction, ShortcutStatus } from '../../shared/types.js';
import { CloseIcon } from './icons.js';

/** What a step points at. Bar elements carry the matching `data-tour`. */
export type TourTarget = 'source' | 'sound' | 'record' | 'bar' | 'windows' | 'hide';

interface TourStep {
  target: TourTarget;
  title: string;
  /** Given a shortcut that works right now, or null -- never a default it may not have. */
  body: (combo: (action: ShortcutAction) => React.JSX.Element | null) => React.ReactNode;
}

/**
 * A walk along the live bar, one group of buttons at a time.
 *
 * On the real controls rather than a picture of them, so what is learned is
 * where things actually are. Short on purpose: Help already says everything in
 * prose, and this is only the "show me" version of it.
 */
export const TOUR_STEPS: TourStep[] = [
  {
    target: 'source',
    title: 'What to record',
    body: () =>
      'The whole screen, one window, or a region you drag out. Window and region ask you to choose first.',
  },
  {
    target: 'sound',
    title: 'Sound',
    body: () =>
      'Computer sound and your microphone are separate switches — either, both or neither. Both are mixed into one track.',
  },
  {
    target: 'record',
    title: 'Record',
    body: (combo) => {
      const record = combo('record');
      const region = combo('region');
      return (
        <>
          Starts recording what is selected.
          {record && <> {record} does the same from anywhere, even with the bar hidden.</>}
          {region && <> {region} drags out a region and starts straight away.</>}
        </>
      );
    },
  },
  {
    target: 'bar',
    title: 'While it records',
    body: () =>
      'The bar becomes a timer with mute, pause and stop. Neither the bar nor a region’s outline ever appears in the recording.',
  },
  {
    target: 'windows',
    title: 'Settings and recordings',
    body: () =>
      'Quality, microphone and shortcuts are in Settings. Your recordings open in their own window, which steps aside while you record.',
  },
  {
    target: 'hide',
    title: 'Out of the way',
    body: () =>
      'Hides the bar without quitting. The tray icon brings it back, and so does opening Capturio again.',
  },
];

interface Props {
  index: number;
  shortcuts: ShortcutStatus[];
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}

/** The card under the bar: which step, what it is, and the way on. */
export default function TourCard({
  index,
  shortcuts,
  onBack,
  onNext,
  onClose,
}: Props): React.JSX.Element | null {
  const step = TOUR_STEPS[index];
  const target = step?.target;
  const last = index === TOUR_STEPS.length - 1;
  const cardRef = useRef<HTMLDivElement>(null);

  // Point the caret at what is highlighted. Measured from the rendered bar,
  // written straight to a CSS variable: it is layout, not state.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !target) return;
    const targets = [...document.querySelectorAll(`[data-tour="${target}"]`)];
    if (targets.length === 0) return;
    const rects = targets.map((t) => t.getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const box = card.getBoundingClientRect();
    const x = Math.max(16, Math.min(box.width - 16, (left + right) / 2 - box.left));
    card.style.setProperty('--caret-x', `${x}px`);
  }, [target]);

  if (!step) return null;

  const combo = (action: ShortcutAction): React.JSX.Element | null => {
    const s = shortcuts.find((item) => item.action === action);
    return s?.accelerator && s.state === 'on' ? <Keys accelerator={s.accelerator} /> : null;
  };

  return (
    <div className="tour" ref={cardRef} role="dialog" aria-label="A tour of the bar">
      <div className="tour__head">
        <span className="tour__count">
          {index + 1} of {TOUR_STEPS.length}
        </span>
        <button
          type="button"
          className="icon tour__close"
          onClick={onClose}
          title="End the tour"
          aria-label="End the tour"
        >
          <CloseIcon />
        </button>
      </div>
      <p className="tour__title">{step.title}</p>
      <p className="tour__body">{step.body(combo)}</p>
      <div className="tour__nav">
        {index > 0 && (
          <button type="button" className="saved__action" onClick={onBack}>
            Back
          </button>
        )}
        <button
          type="button"
          className="saved__action tour__next"
          onClick={last ? onClose : onNext}
        >
          {last ? 'Done' : 'Next'}
        </button>
      </div>
    </div>
  );
}
