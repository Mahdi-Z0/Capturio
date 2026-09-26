import {
  CloseIcon,
  LibraryIcon,
  MicIcon,
  PauseIcon,
  RegionIcon,
  ScreenIcon,
  SlidersIcon,
  SpeakerIcon,
  StopIcon,
  WindowIcon,
} from './icons.js';

/**
 * What the bar's buttons do.
 *
 * The same icons as the bar itself, so this reads as a key to the thing on screen
 * rather than a manual written about it. Whatever is true of the app belongs
 * here; nothing aspirational.
 */
const CONTROLS: { icon: React.JSX.Element; name: string; what: string }[] = [
  { icon: <ScreenIcon />, name: 'Whole screen', what: 'Records everything on the main display.' },
  {
    icon: <WindowIcon />,
    name: 'A window',
    what: 'Pick one window. Only that window is recorded, even if something covers it — but a minimised window gives Windows no frames to record.',
  },
  {
    icon: <RegionIcon />,
    name: 'A region',
    what: 'Drag out a rectangle. A red outline marks it while it records, and the outline itself never appears in the recording.',
  },
  {
    icon: <SpeakerIcon />,
    name: 'Computer sound',
    what: 'Records what you hear. Independent of the microphone: either, both or neither.',
  },
  {
    icon: <MicIcon />,
    name: 'Microphone',
    what: 'Records what you say. Both sources are mixed into one track. Choose which microphone in Settings.',
  },
  {
    icon: <PauseIcon />,
    name: 'Pause',
    what: 'While recording. Picks up where it left off — one file, no gap.',
  },
  {
    icon: <StopIcon />,
    name: 'Stop',
    what: 'Finishes the recording and saves it. A card appears with the name, Play, and Show in library.',
  },
  { icon: <SlidersIcon />, name: 'Settings', what: 'Quality, microphone, and where files go.' },
  { icon: <LibraryIcon />, name: 'Recordings', what: 'Opens this window.' },
  {
    icon: <CloseIcon />,
    name: 'Hide the bar',
    what: 'Hides it without closing the app. The tray icon brings it back.',
  },
];

export default function Help(): React.JSX.Element {
  return (
    <section className="page">
      <div className="page__group">
        <h2 className="page__heading">The bar is the app</h2>
        <p className="page__note">
          Capturio is the floating bar, not a window you visit. Choose what to record, switch sound
          on or off, press the red button. Nothing else has to be open, and neither the bar nor the
          region outline appears in what you record.
        </p>
      </div>

      <div className="page__group">
        <h2 className="page__heading">Every button</h2>
        <ul className="keys">
          {CONTROLS.map((control) => (
            <li key={control.name} className="keys__row">
              <span className="keys__icon" aria-hidden="true">
                {control.icon}
              </span>
              <span className="keys__name">{control.name}</span>
              <span className="keys__what">{control.what}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="page__group">
        <h2 className="page__heading">Without touching the bar</h2>
        <p className="page__note">
          <kbd className="kbd">Ctrl</kbd> + <kbd className="kbd">Shift</kbd> +{' '}
          <kbd className="kbd">R</kbd> starts and stops a recording from anywhere, using whatever the
          bar currently has selected. The tray icon does the same, and brings the bar back when it is
          hidden.
        </p>
      </div>

      <div className="page__group">
        <h2 className="page__heading">Your recordings</h2>
        <p className="page__note">
          Click one to select it, double-click to play it here, right-click for everything else.
          Ctrl-click adds to the selection and shift-click takes a run, so a morning's recordings can
          be filed or binned in one go. Make folders with <strong>New folder</strong> and drag
          recordings into them — or onto the breadcrumb to move them back out. Deleting sends things
          to the Recycle Bin unless you choose <strong>Delete permanently</strong>.
        </p>
      </div>

      <div className="page__group">
        <h2 className="page__heading">Worth knowing</h2>
        <ul className="page__list">
          <li>
            Recordings are finished off the moment they are saved, which is what lets you scrub
            through them. A recording made before that was added reports no length, and the player
            says so when you open one.
          </li>
          <li>
            If the app or the machine stops mid-recording, the part that was written is kept and
            reclaimed the next time Capturio starts.
          </li>
          <li>
            Dark gradients can show faint banding. That comes from how browsers encode video and
            cannot be turned off here; a higher quality setting reduces it.
          </li>
        </ul>
      </div>
    </section>
  );
}
