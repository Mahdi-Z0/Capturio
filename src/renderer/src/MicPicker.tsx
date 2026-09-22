import { useEffect, useState } from 'react';
import { DEFAULT_MIC_DEVICE } from '../../shared/types.js';

interface Mic {
  deviceId: string;
  label: string;
}

/**
 * Choose which microphone to record.
 *
 * Only rendered for modes that use a microphone. "Windows default" is first and
 * is the default: it follows whatever the user sets in Windows, which is right for
 * most people and survives plugging a headset in and out.
 *
 * Re-enumerates on `devicechange`, so plugging in an external mic shows it here
 * without restarting the app.
 */
export default function MicPicker({ disabled }: { disabled: boolean }): React.JSX.Element {
  const [mics, setMics] = useState<Mic[]>([]);
  const [selected, setSelected] = useState(DEFAULT_MIC_DEVICE);

  useEffect(() => {
    let alive = true;
    window.api
      .getMicDevice()
      .then((id) => alive && setSelected(id))
      .catch(() => undefined);

    const load = (): void => {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (!alive) return;
          const inputs = devices.filter(
            // 'default' and 'communications' are Windows aliases for a real device
            // that is also listed; showing them duplicates every entry.
            (d) =>
              d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications',
          );
          setMics(
            inputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
          );
        })
        .catch(() => undefined);
    };

    load();
    navigator.mediaDevices.addEventListener('devicechange', load);
    return () => {
      alive = false;
      navigator.mediaDevices.removeEventListener('devicechange', load);
    };
  }, []);

  const choose = (deviceId: string): void => {
    setSelected(deviceId);
    void window.api.setMicDevice(deviceId).catch(() => undefined);
  };

  // A stored device that is not plugged in: say so rather than silently showing
  // "Windows default", which would misreport what the next recording will try.
  const missing = selected !== DEFAULT_MIC_DEVICE && !mics.some((m) => m.deviceId === selected);

  return (
    <label className="micPicker">
      <span className="micPicker__label">Microphone</span>
      <select
        className="micPicker__select"
        value={missing ? DEFAULT_MIC_DEVICE : selected}
        disabled={disabled}
        onChange={(e) => choose(e.target.value)}
      >
        <option value={DEFAULT_MIC_DEVICE}>Windows default</option>
        {mics.map((m) => (
          <option key={m.deviceId} value={m.deviceId}>
            {m.label}
          </option>
        ))}
      </select>
      {missing && (
        <span className="micPicker__note">
          Your chosen microphone is not connected, so Windows default will be used.
        </span>
      )}
    </label>
  );
}
