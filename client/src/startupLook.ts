/** Keep the Start click's pointer capture across asynchronous checks and world loading. */
export interface StartupLook {
  finish(allow: boolean): HTMLElement | null;
  cancel(): void;
}

let pending: StartupLook | undefined;

export const startupLook = () => pending;
export const cancelStartupLook = () => pending?.cancel();

export function beginStartupLook(): void {
  cancelStartupLook();
  // The world does not exist yet. The page root survives menu and world replacement.
  const target = document.documentElement;
  let cancelled = false;
  let acquired = false;
  let settled = false;
  const removeListeners = () => {
    document.removeEventListener('pointerlockchange', changed);
    document.removeEventListener('pointerlockerror', failed);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('keydown', key);
    window.removeEventListener('mousedown', mouse);
  };
  const release = () => {
    if (document.pointerLockElement === target) document.exitPointerLock();
  };
  const cancel = () => {
    cancelled = true;
    release();
    // Keep the grant/error listeners until an outstanding browser request settles.
    if (settled) removeListeners();
  };
  const changed = () => {
    if (document.pointerLockElement === target) {
      acquired = settled = true;
      if (cancelled) { release(); removeListeners(); }
    } else if (acquired) cancel();
  };
  const failed = () => { settled = true; cancel(); };
  const key = (event: KeyboardEvent) => { if (event.code === 'Escape') cancel(); };
  const mouse = (event: MouseEvent) => { if (event.button === 2) cancel(); };
  const request: StartupLook = {
    finish(allow) {
      if (pending === request) pending = undefined;
      if (!allow || cancelled || document.hidden || !document.hasFocus() || document.pointerLockElement !== target) {
        cancel();
        return null;
      }
      removeListeners();
      return target;
    },
    cancel,
  };
  pending = request;
  document.addEventListener('pointerlockchange', changed);
  document.addEventListener('pointerlockerror', failed);
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', key);
  window.addEventListener('mousedown', mouse);
  try {
    if (!target.requestPointerLock) { failed(); return; }
    const result = target.requestPointerLock() as Promise<void> | undefined;
    result?.then(() => { settled = true; if (cancelled) { release(); removeListeners(); } }, failed);
  } catch { failed(); }
}
