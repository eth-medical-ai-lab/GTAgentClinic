/**
 * How the mouse turns the view: a sensitivity multiplier on both look paths (pointer lock and
 * drag-to-look, world/controls.ts) and an optional inverted vertical axis. Set in the in-game
 * settings (Esc, ui/SettingsPanel.tsx). Setting: "ac.look" in localStorage.
 */
export interface LookSettings {
  /** 1 = the built-in speed */
  sensitivity: number;
  /** mouse forward looks down */
  invertY: boolean;
}

const KEY = 'ac.look';
export const SENSITIVITY_MIN = 0.25;
export const SENSITIVITY_MAX = 3;
export const DEFAULT_LOOK: LookSettings = { sensitivity: 1, invertY: false };

export function clampSensitivity(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_LOOK.sensitivity;
  return Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, v));
}

/** a stored value from an older or hand-edited setting falls back field by field */
export function parseLook(raw: string | null): LookSettings {
  if (!raw) return { ...DEFAULT_LOOK };
  try {
    const v = JSON.parse(raw) as Partial<LookSettings> | null;
    return {
      sensitivity: typeof v?.sensitivity === 'number' ? clampSensitivity(v.sensitivity) : DEFAULT_LOOK.sensitivity,
      invertY: v?.invertY === true,
    };
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export function loadLook(): LookSettings {
  try {
    return parseLook(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export function saveLook(look: LookSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    /* private mode: the setting lasts until the page closes */
  }
}
