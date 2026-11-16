/**
 * Full screen for the game. The click on Start shift (or Watch the AI doctor) is a user gesture,
 * so it may ask the browser for full screen on the whole page. Where the Keyboard Lock API exists
 * (Chrome, Edge), or through the Fullscreen API (Safari, Firefox), Escape is locked while in full
 * screen: a short Esc closes panels and frees the mouse; holding Esc leaves full screen. Browsers
 * without keyboard locking retain their normal exit gesture. Refusals are ignored.
 *
 * A reload during a full-screen shift (the 🖥 quality button reloads the page) has no click to
 * piggyback on, so the first click back in the game re-enters full screen, unless the player had
 * left it. Setting: "ac.fullscreen" in localStorage (default on), the main menu's checkbox.
 */
const KEY = 'ac.fullscreen';
/** sessionStorage: this tab was in full screen (survives the 🖥 reload, not a closed tab) */
const WAS_FULL = 'ac.fullscreen.on';

type KeyboardLock = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void };
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };

const keyboard = (): KeyboardLock | undefined => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
export const isFullscreen = () => !!(document.fullscreenElement ?? (document as FsDocument).webkitFullscreenElement);

export function autoFullscreen(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : JSON.parse(v) !== false;
  } catch {
    return true;
  }
}

export function setAutoFullscreen(on: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify(on));
  } catch {
    /* private mode: the default (on) applies */
  }
}

function lockEscape() {
  try {
    void keyboard()
      ?.lock?.(['Escape'])
      ?.catch(() => undefined);
  } catch {
    /* no Keyboard Lock API: Esc leaves full screen, as browsers do */
  }
}

let enteringFullscreen = false;
export const isFullscreenTransitioning = () => enteringFullscreen;

async function requestFullscreen(el: FsElement) {
  enteringFullscreen = true;
  try {
    await requestFullscreenWithKeyboard(el);
  } finally { enteringFullscreen = false; }
}

async function requestFullscreenWithKeyboard(el: FsElement) {
  // Chrome/Edge already use navigator.keyboard.lock. Safari/Firefox request the lock on entry.
  const options: FullscreenOptions & { keyboardLock?: 'browser' } = { navigationUI: 'hide' };
  if (typeof keyboard()?.lock !== 'function') options.keyboardLock = 'browser';
  try {
    await el.requestFullscreen(options);
  } catch (error) {
    // Some older browsers reject the new option rather than ignoring it. Permission denials
    // must not trigger another request, nor should we re-enter after the user exits.
    if (!options.keyboardLock || (error as { name?: string })?.name !== 'NotSupportedError') return;
    try {
      await el.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      return;
    }
  }
  lockEscape();
}

/**
 * Call from a click handler. Does nothing when the page is already in full screen, or when the
 * setting is off (unless always: the player asked for it now, in the in-game settings).
 */
export function enterGameFullscreen(always = false): void {
  if ((!always && !autoFullscreen()) || isFullscreen()) return;
  const el = document.documentElement as FsElement;
  try {
    if (typeof el.requestFullscreen === 'function') {
      void requestFullscreen(el);
    } else el.webkitRequestFullscreen?.(); // older Safari
  } catch {
    /* not allowed here (an iframe without allowfullscreen, a policy): play in the window */
  }
}

/** leave full screen again, e.g. when the shift we entered it for could not start */
export function leaveGameFullscreen(): void {
  if (!isFullscreen()) return;
  try {
    const d = document as FsDocument;
    if (typeof d.exitFullscreen === 'function') void d.exitFullscreen().catch(() => undefined);
    else d.webkitExitFullscreen?.();
  } catch {
    /* ignore */
  }
}

function remember(on: boolean) {
  try {
    if (on) sessionStorage.setItem(WAS_FULL, '1');
    else sessionStorage.removeItem(WAS_FULL);
  } catch {
    /* ignore */
  }
}

function wasFullscreen(): boolean {
  try {
    return sessionStorage.getItem(WAS_FULL) === '1';
  } catch {
    return false;
  }
}

let started = false;

/** Once at startup. inGame: is a shift on screen (for the re-entry after a reload)? */
export function initFullscreen(inGame: () => boolean) {
  if (started) return;
  started = true;
  // back after a reload in full screen: the first click in the game goes full screen again
  const rearm = (e: PointerEvent) => {
    if (e.isPrimary && inGame()) {
      disarm();
      enterGameFullscreen();
    }
  };
  const disarm = () => removeEventListener('pointerdown', rearm, true);
  if (wasFullscreen() && autoFullscreen()) addEventListener('pointerdown', rearm, true);

  let unloading = false;
  addEventListener('pagehide', () => (unloading = true));
  const onChange = () => {
    if (unloading) return; // a reload leaves full screen without the player asking
    const full = isFullscreen();
    remember(full);
    if (full) return disarm();
    try {
      keyboard()?.unlock?.();
    } catch {
      /* ignore */
    }
  };
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
  // with Escape locked, the browser no longer frees the mouse on Esc: do it here (panels close in App.tsx)
  addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !isFullscreen() || !inGame()) return;
      // Safari's fullscreen lock requires cancellation, including when a focused control or
      // dialog handles Esc before App does. The browser still owns the long-press exit gesture.
      e.preventDefault();
      if (!e.repeat && document.pointerLockElement) document.exitPointerLock();
    },
    true,
  );
}
