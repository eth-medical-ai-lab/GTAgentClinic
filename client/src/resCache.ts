/**
 * Versioned URLs for the static game assets in /res (character models, animations, textures, skies,
 * audio). Their file names never change between releases, so every /res request carries the
 * asset-set version, a hash of the files built in vite.config.ts. An updated asset gets a new URL,
 * and the browser downloads it instead of reusing an old copy.
 *
 * This matters for returning players: v0.1's server marked these files cacheable for a year
 * ("immutable"). An animations file from before the run clips stayed in browsers, and running looked
 * like gliding. The server now revalidates with ETags as well (server/index.ts serveStatic).
 *
 * All three.js loaders go through THREE.DefaultLoadingManager's URL modifier. Plain fetch() calls for
 * /res files (the character index, audio) go through a thin fetch wrapper. Installed once, before
 * anything loads (main.tsx).
 */
import * as THREE from 'three';

declare const __RES_VERSION__: string | undefined;
export const RES_VERSION = typeof __RES_VERSION__ === 'string' ? __RES_VERSION__ : 'dev';

/** Resolve /res under the game's deployment directory and add its cache version. */
export function resUrl(url: string): string {
  if (typeof location === 'undefined') return url;
  let u: URL;
  try {
    u = new URL(url, location.href);
  } catch {
    return url;
  }
  if (u.origin !== location.origin || !u.pathname.startsWith('/res/')) return url;
  const base = new URL(import.meta.env.BASE_URL, location.href);
  u.pathname = base.pathname + u.pathname.slice(1);
  if (!u.searchParams.has('v')) u.searchParams.set('v', RES_VERSION);
  return /^https?:/i.test(url) ? u.href : `${u.pathname}${u.search}${u.hash}`;
}

let installed = false;
/** installs itself on import (main.tsx imports this module first); idempotent */
export function installResVersioning() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  THREE.DefaultLoadingManager.setURLModifier((url) => resUrl(url));
  const plainFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') return plainFetch(resUrl(input), init);
    if (input instanceof URL) return plainFetch(resUrl(input.href), init);
    return plainFetch(input, init);
  }) as typeof window.fetch;
}
installResVersioning();
