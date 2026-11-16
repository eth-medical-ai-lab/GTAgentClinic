import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('fullscreen keyboard compatibility', () => {
  let api: typeof import('../client/src/ui/fullscreen');
  let win: EventTarget;
  let doc: EventTarget & { documentElement: { requestFullscreen: ReturnType<typeof vi.fn> }; fullscreenElement: object | null; pointerLockElement: object | null; exitPointerLock: ReturnType<typeof vi.fn> };
  let nav: { keyboard?: { lock: ReturnType<typeof vi.fn>; unlock: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    vi.resetModules();
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), {
      documentElement: { requestFullscreen: vi.fn().mockResolvedValue(undefined) },
      fullscreenElement: null as object | null,
      pointerLockElement: null as object | null,
      exitPointerLock: vi.fn(),
    });
    nav = {};
    vi.stubGlobal('document', doc);
    vi.stubGlobal('navigator', nav);
    vi.stubGlobal('addEventListener', win.addEventListener.bind(win));
    vi.stubGlobal('removeEventListener', win.removeEventListener.bind(win));
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    api = await import('../client/src/ui/fullscreen');
  });
  afterEach(() => vi.unstubAllGlobals());

  const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

  it('marks fullscreen entry until the request settles, including a refusal', async () => {
    let reject!: (e: Error) => void;
    doc.documentElement.requestFullscreen.mockReturnValue(new Promise((_, r) => { reject = r; }));
    api.enterGameFullscreen();
    expect(api.isFullscreenTransitioning()).toBe(true);
    reject(new DOMException('Denied', 'NotAllowedError'));
    await settle(); await settle();
    expect(api.isFullscreenTransitioning()).toBe(false);
  });

  it('preserves Chrome/Edge entry and Escape-only keyboard locking', async () => {
    nav.keyboard = { lock: vi.fn().mockResolvedValue(undefined), unlock: vi.fn() };
    api.enterGameFullscreen();
    await settle();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledExactlyOnceWith({ navigationUI: 'hide' });
    expect(nav.keyboard.lock).toHaveBeenCalledExactlyOnceWith(['Escape']);
  });

  it('requests Safari/Firefox fullscreen keyboard locking', async () => {
    api.enterGameFullscreen();
    await settle();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledExactlyOnceWith({ navigationUI: 'hide', keyboardLock: 'browser' });
  });

  it('falls back to normal fullscreen only when the keyboard option is unsupported', async () => {
    doc.documentElement.requestFullscreen.mockRejectedValueOnce(new DOMException('Unsupported option', 'NotSupportedError'));
    api.enterGameFullscreen();
    await settle();
    expect(doc.documentElement.requestFullscreen.mock.calls).toEqual([
      [{ navigationUI: 'hide', keyboardLock: 'browser' }], [{ navigationUI: 'hide' }],
    ]);
  });

  it('does not retry fullscreen after a permission denial', async () => {
    doc.documentElement.requestFullscreen.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    api.enterGameFullscreen();
    await settle();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it('keeps fullscreen usable when Chrome keyboard permission is denied', async () => {
    nav.keyboard = { lock: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')), unlock: vi.fn() };
    api.enterGameFullscreen();
    await settle();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(nav.keyboard.lock).toHaveBeenCalledTimes(1);
  });

  it('honors the opt-out, explicit toggle and already-fullscreen state', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'false' });
    api.enterGameFullscreen();
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
    api.enterGameFullscreen(true);
    await settle();
    doc.fullscreenElement = doc.documentElement;
    api.enterGameFullscreen(true);
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  function escape(repeat = false) {
    return Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', repeat });
  }

  it('cancels Safari native Esc while in game fullscreen and releases the mouse once', () => {
    api.initFullscreen(() => true);
    doc.fullscreenElement = doc.documentElement;
    doc.pointerLockElement = {};
    const press = escape();
    win.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1);
    const repeat = escape(true);
    win.dispatchEvent(repeat);
    expect(repeat.defaultPrevented).toBe(true);
    expect(doc.exitPointerLock).toHaveBeenCalledTimes(1);
    // A native long-press exit is authoritative: never request fullscreen again.
    doc.fullscreenElement = null;
    doc.dispatchEvent(new Event('fullscreenchange'));
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
  });

  it('leaves browser Escape alone outside fullscreen or outside a shift', () => {
    let inGame = true;
    api.initFullscreen(() => inGame);
    const windowed = escape();
    win.dispatchEvent(windowed);
    expect(windowed.defaultPrevented).toBe(false);
    doc.fullscreenElement = doc.documentElement;
    inGame = false;
    const menu = escape();
    win.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
  });
});
