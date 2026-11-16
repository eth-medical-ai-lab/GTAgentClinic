import { useEffect, useState } from 'react';
import { store, useStore } from '../store';
import { ControlKeys } from './ControlKeys';
import { enterGameFullscreen, isFullscreen, leaveGameFullscreen } from './fullscreen';
import { DEFAULT_LOOK, SENSITIVITY_MAX, SENSITIVITY_MIN, clampSensitivity, saveLook, type LookSettings } from './lookSettings';

/** Esc with nothing open (App.tsx): a few settings and the keys. The mouse is free while it is open. */
export function SettingsPanel() {
  const look = useStore((s) => s.look);
  const [full, setFull] = useState(isFullscreen);
  useEffect(() => {
    const onChange = () => setFull(isFullscreen());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);
  const set = (patch: Partial<LookSettings>) => {
    const next = { ...look, ...patch };
    saveLook(next);
    store.set({ look: next });
  };
  const close = () => store.set({ panel: null });

  return (
    <aside className="panel settings-panel" role="dialog" aria-labelledby="settings-title">
      <header>
        <h2 id="settings-title">Settings</h2>
        <button className="btn small" autoFocus onClick={close}>
          Close
        </button>
      </header>
      <section>
        <label className="settings-slider">
          <span>
            Mouse sensitivity <b className="mono">{look.sensitivity.toFixed(2)}×</b>
          </span>
          <input
            type="range"
            min={SENSITIVITY_MIN}
            max={SENSITIVITY_MAX}
            step={0.05}
            value={look.sensitivity}
            onChange={(e) => set({ sensitivity: clampSensitivity(Number(e.target.value)) })}
          />
        </label>
        <div className="settings-row">
          <label>
            <input type="checkbox" checked={look.invertY} onChange={(e) => set({ invertY: e.target.checked })} /> Invert vertical look
          </label>
          <button className="btn small" disabled={look.sensitivity === DEFAULT_LOOK.sensitivity && !look.invertY} onClick={() => set(DEFAULT_LOOK)}>
            Reset
          </button>
        </div>
        <label className="settings-row" title="Holding Esc also leaves full screen">
          <span>
            <input
              type="checkbox"
              checked={full}
              onChange={(e) => (e.target.checked ? enterGameFullscreen(true) : leaveGameFullscreen())}
            />{' '}
            Full screen
          </span>
        </label>
      </section>
      <section>
        <h3>Controls</h3>
        <ControlKeys />
        <button className="btn small" onClick={() => store.set({ panel: { kind: 'help' } })}>
          More in Help (H)
        </button>
      </section>
    </aside>
  );
}
