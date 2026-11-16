/**
 * Observe mode: the AI resident's transcript panel (Observer.tsx) is open at its normal width,
 * maximized (wide, for reading), or minimized to a chip at the screen edge. R toggles minimized,
 * Shift+R wide; the choice is remembered in this browser (localStorage, if it is available).
 */
import { useSyncExternalStore } from 'react';

export type ObPanelSize = 'normal' | 'max' | 'min';
type OpenSize = Exclude<ObPanelSize, 'min'>;

const KEY = 'ac.observer.panel';
const OPEN_KEY = 'ac.observer.open';

function load<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback; // private mode, blocked storage
  }
}

function save(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode, blocked storage: it just isn't remembered */
  }
}

let size: ObPanelSize = load(KEY, ['normal', 'max', 'min'] as const, 'normal');
/** what minimize returns to */
let lastOpen: OpenSize = size === 'min' ? load(OPEN_KEY, ['normal', 'max'] as const, 'normal') : size;
const listeners = new Set<() => void>();

export function setObPanel(next: ObPanelSize) {
  if (next === size) return;
  size = next;
  if (next !== 'min') {
    lastOpen = next;
    save(OPEN_KEY, next);
  }
  save(KEY, next);
  listeners.forEach((l) => l());
}

export const obPanelSize = () => size;
export const minimizeObPanel = () => setObPanel('min');
export const restoreObPanel = () => setObPanel(lastOpen);
export const toggleObPanelMin = () => setObPanel(size === 'min' ? lastOpen : 'min');
export const toggleObPanelMax = () => setObPanel(size === 'max' ? 'normal' : 'max');

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useObPanel(): ObPanelSize {
  return useSyncExternalStore(subscribe, () => size);
}
