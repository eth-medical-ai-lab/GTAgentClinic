import { PTT_KEY_LABEL } from './Chat';

/**
 * The keys at a glance, for the in-game settings (Esc). The full explanations stay in the help
 * panel (H, ui/HelpPanel.tsx). Bindings: world/controls.ts (move, E, F, G, V), World.ts (M), App.tsx.
 */
const KEYS: [keys: string[], what: string][] = [
  [['W', 'A', 'S', 'D'], 'walk'],
  [['Shift'], 'hold to run (or double-tap W)'],
  [['Space'], 'jump'],
  [['Mouse'], 'look; right-click frees the cursor'],
  [['E'], 'talk, use, pick up'],
  [['F'], 'inspect what you hold or face'],
  [['G'], 'put it down'],
  [['Tab'], 'tablet, and the mouse for buttons (e.g. camera)'],
  [['V'], 'camera: eyes, shoulder, top'],
  [['M'], 'take your mask off'],
  [[PTT_KEY_LABEL], 'hold to speak'],
  [['P'], 'pause'],
  [['H'], 'help'],
  [['Esc'], 'close, or these settings'],
];

export function ControlKeys() {
  return (
    <dl className="control-keys" aria-label="Controls">
      {KEYS.map(([keys, what]) => (
        <div key={what}>
          <dt>
            {keys.map((k) => (
              <kbd key={k}>{k}</kbd>
            ))}
          </dt>
          <dd>{what}</dd>
        </div>
      ))}
    </dl>
  );
}
