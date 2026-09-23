/**
 * Line icons, drawn here rather than pulled from a set.
 *
 * Two reasons: no dependency for a dozen 20px glyphs, and the source icons need
 * to say something specific — "a window" and "a region you drag" are not stock
 * shapes. They share one stroke weight and cap style so they read as a family.
 */

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function ScreenIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <rect x="2" y="3.5" width="16" height="11" rx="1.5" />
      <path d="M7 17h6" />
    </svg>
  );
}

/** Two stacked frames: the front one is the window you pick. */
export function WindowIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <rect x="2.5" y="2.5" width="11" height="9" rx="1.5" />
      <path d="M6.5 15.5h9a1.5 1.5 0 0 0 1.5-1.5V7" />
    </svg>
  );
}

/** Dashed frame with corner handles: something you draw, not something that exists. */
export function RegionIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M2.5 6.5v-4h4M13.5 2.5h4v4M17.5 13.5v4h-4M6.5 17.5h-4v-4" />
      <path d="M2.5 10h1.5M8 10h4M16 10h1.5" opacity="0.55" />
    </svg>
  );
}

export function SpeakerIcon({ off = false }: { off?: boolean }): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M4 7.5h2.5L10 4.5v11L6.5 12.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
      {off ? (
        <path d="M13 7.5l4 5M17 7.5l-4 5" />
      ) : (
        <path d="M12.8 7a4 4 0 0 1 0 6M15.2 5a7 7 0 0 1 0 10" />
      )}
    </svg>
  );
}

export function MicIcon({ off = false }: { off?: boolean }): React.JSX.Element {
  return (
    <svg {...base}>
      <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
      {off && <path d="M3 3l14 14" />}
    </svg>
  );
}

/**
 * Sliders, not a gear: a cogwheel at 20px loses its teeth and reads as a sun or
 * an asterisk. Two tracks with handles say "adjust these" at any size.
 */
export function SlidersIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M3 6.5h9M15.5 6.5h1.5M3 13.5h3M9.5 13.5h7.5" />
      <circle cx="13.7" cy="6.5" r="2" />
      <circle cx="7.7" cy="13.5" r="2" />
    </svg>
  );
}

/** Stack of recordings, not a generic folder. */
export function LibraryIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <rect x="2.5" y="5.5" width="15" height="11" rx="1.5" />
      <path d="M5.5 5.5v-2h9v2M8 9.5l4.5 2.5L8 14.5v-5Z" />
    </svg>
  );
}

export function PauseIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M7.5 4v12M12.5 4v12" />
    </svg>
  );
}

export function PlayIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M5.5 3.5l11 6.5-11 6.5v-13Z" />
    </svg>
  );
}

export function StopIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <rect x="4.5" y="4.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function CloseIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}
