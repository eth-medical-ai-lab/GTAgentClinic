/**
 * Graphics quality preference (no three.js import, so UI code can use it cheaply).
 *   low     direct render, MSAA, no post-processing (integrated GPUs / old laptops)
 *   medium  ambient occlusion (½ res) + bloom + temporal AA
 *   high    + soft shadows from exam lights, finer AO, 1.5× pixel ratio (default on a fast GPU)
 *   ultra   + native pixel ratio
 * URL ?quality=… overrides the saved choice for one load.
 */
export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export const QUALITIES: Quality[] = ['low', 'medium', 'high', 'ultra'];
const STORAGE_KEY = 'ac.quality';

export function preferredQuality(): Quality | null {
  const q = new URLSearchParams(location.search).get('quality') as Quality | null;
  if (q && QUALITIES.includes(q)) return q;
  try {
    const s = localStorage.getItem(STORAGE_KEY) as Quality | null;
    if (s && QUALITIES.includes(s)) return s;
  } catch {
    /* storage blocked */
  }
  return null;
}

export function saveQuality(q: Quality) {
  try {
    localStorage.setItem(STORAGE_KEY, q);
  } catch {
    /* storage blocked */
  }
}

/** quality the running world actually uses (set by the renderer once it starts) */
let active: Quality | null = null;
export function setActiveQuality(q: Quality) {
  active = q;
}
export function activeQuality(): Quality | null {
  return active;
}
