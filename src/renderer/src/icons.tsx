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

/** The record dot, matching the bar's one bold element and the app's own mark. */
export function RecordIcon(): React.JSX.Element {
  return (
    <svg {...base} stroke="none">
      <circle cx="10" cy="10" r="6" fill="#ff4d4d" />
    </svg>
  );
}

/** A tick: the recording landed. */
export function CheckIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M4 10.5 8 14.5 16 5.5" />
    </svg>
  );
}

/** A folder. The tab is what makes it read as one at 20px. */
export function FolderIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M2.5 6V4.75A1.25 1.25 0 0 1 3.75 3.5h3.1c.4 0 .78.19 1.01.51l.78 1.07" />
      <rect x="2.5" y="5.75" width="15" height="10.75" rx="1.5" />
    </svg>
  );
}

/** A new folder: the same shape with a plus where the contents would be. */
export function FolderPlusIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M2.5 6V4.75A1.25 1.25 0 0 1 3.75 3.5h3.1c.4 0 .78.19 1.01.51l.78 1.07" />
      <rect x="2.5" y="5.75" width="15" height="10.75" rx="1.5" />
      <path d="M10 8.9v4.7M7.65 11.25h4.7" />
    </svg>
  );
}

/** Back and forward, as a browser draws them. */
export function BackIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M12.5 4.5 7 10l5.5 5.5" />
    </svg>
  );
}

export function ForwardIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M7.5 4.5 13 10l-5.5 5.5" />
    </svg>
  );
}

/** Up one level. */
export function UpIcon(): React.JSX.Element {
  return (
    <svg {...base}>
      <path d="M10 16V5M5.5 9.5 10 5l4.5 4.5" />
    </svg>
  );
}
