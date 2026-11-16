/**
 * The player's ambient-sound setting (off / low / medium / high), stored in this browser only
 * (localStorage "ac.ambient"). Independent of the NPC-voice toggle (🔊): ambience keeps playing with
 * voices off; only the spoken parts of it (overhead pages, TV, the radio host) need voices on.
 */
import { useSyncExternalStore } from 'react';

export type AmbientLevel = 'off' | 'low' | 'medium' | 'high';
export const AMBIENT_LEVELS: AmbientLevel[] = ['off', 'low', 'medium', 'high'];

/** linear gain of the ambience bus per level (−10, −5, 0 dB) */
export const AMBIENT_GAIN: Record<AmbientLevel, number> = { off: 0, low: 0.32, medium: 0.56, high: 1 };

const KEY = 'ac.ambient';
const listeners = new Set<() => void>();

function load(): AmbientLevel {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return v && (AMBIENT_LEVELS as string[]).includes(v) ? (v as AmbientLevel) : 'medium';
  } catch {
    return 'medium';
  }
}

let current: AmbientLevel = load();

export function ambientLevel(): AmbientLevel {
  return current;
}

export function setAmbientLevel(level: AmbientLevel): void {
  if (level === current) return;
  current = level;
  try {
    localStorage.setItem(KEY, level);
  } catch {
    /* private mode: keep it for this tab */
  }
  for (const l of listeners) l();
}

export function onAmbientLevel(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useAmbientLevel(): AmbientLevel {
  return useSyncExternalStore(onAmbientLevel, ambientLevel, ambientLevel);
}
