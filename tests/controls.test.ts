// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import * as fullscreen from '../client/src/ui/fullscreen';
import { PlayerController } from '../client/src/world/controls';

function setupEnv(queued = false) {
  const pointerEvents: (() => void)[] = [];
  const deliver = (fn: () => void) => queued ? pointerEvents.push(fn) : fn();
  const listeners = new Map<string, Set<EventListener>>();
  const add = (key: string, fn: EventListener) => {
    let s = listeners.get(key);
    if (!s) {
      s = new Set();
      listeners.set(key, s);
    }
    s.add(fn);
  };
  const remove = (key: string, fn: EventListener) => listeners.get(key)?.delete(fn);
  const emit = (prefix: string, type: string, ev: Record<string, unknown> = {}) => {
    const e = {
      type,
      button: 0,
      clientX: 400,
      clientY: 300,
      movementX: 0,
      movementY: 0,
      repeat: false,
      preventDefault: vi.fn(),
      ...ev,
    };
    for (const fn of listeners.get(`${prefix}:${type}`) ?? []) fn(e as unknown as Event);
    return e;
  };

  let lockedEl: unknown = null;
  const dom = {
    addEventListener: (t: string, fn: EventListener) => add(`dom:${t}`, fn),
    removeEventListener: (t: string, fn: EventListener) => remove(`dom:${t}`, fn),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
    classList: {
      classes: new Set<string>(),
      add(...names: string[]) {
        for (const n of names) this.classes.add(n);
      },
      remove(...names: string[]) {
        for (const n of names) this.classes.delete(n);
      },
      toggle(name: string, force?: boolean) {
        const on = force ?? !this.classes.has(name);
        if (on) this.classes.add(name);
        else this.classes.delete(name);
        return on;
      },
      contains(name: string) {
        return this.classes.has(name);
      },
    },
    requestPointerLock: vi.fn<() => Promise<void> | void>(() => {
      deliver(() => { lockedEl = dom; emit('doc', 'pointerlockchange'); });
      return Promise.resolve();
    }),
    closest: () => null,
  };

  const doc = {
    get pointerLockElement() {
      return lockedEl;
    },
    activeElement: null as unknown,
    hasFocus: () => true,
    hidden: false,
    addEventListener: (t: string, fn: EventListener) => add(`doc:${t}`, fn),
    removeEventListener: (t: string, fn: EventListener) => remove(`doc:${t}`, fn),
    exitPointerLock: vi.fn(() => {
      deliver(() => { lockedEl = null; emit('doc', 'pointerlockchange'); });
    }),
  };

  const win = {
    addEventListener: (t: string, fn: EventListener) => add(`win:${t}`, fn),
    removeEventListener: (t: string, fn: EventListener) => remove(`win:${t}`, fn),
  };

  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);

  const camera = new THREE.PerspectiveCamera(72, 800 / 600, 0.05, 260);
  const cursorChanges: boolean[] = [];
  const onClick = vi.fn(() => false);
  const onPointerRelease = vi.fn();
  const controller = new PlayerController(
    dom as unknown as HTMLElement,
    camera,
    [],
    [],
    { minX: 0, maxX: 20, minZ: 0, maxZ: 20 },
    {
      onCycleCamera: vi.fn(),
      onInteractKey: vi.fn(),
      onClick,
      onPointerRelease,
      onCursorModeChange: (m) => cursorChanges.push(m),
    },
  );

  return { controller, dom, doc, emit, cursorChanges, flushPointer: () => pointerEvents.shift()?.(), onClick, onPointerRelease, lockOn: (el: unknown) => { lockedEl = el; } };
}

describe('PlayerController: glancing mode vs. margin panel cursor mode (#4)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('captures once at startup and never grabs the mouse back after a release', () => {
    const { controller, dom, doc, emit } = setupEnv();
    controller.captureOnStart();
    expect(controller.isLocked()).toBe(true);
    expect(dom.classList.contains('mouse-look')).toBe(true);
    emit('win', 'mousedown', { button: 2, target: dom });
    emit('win', 'mouseup', { button: 2, target: dom });
    controller.captureOnStart();
    controller.setCursorMode(false);
    controller.setEnabled(false); controller.setEnabled(true);
    controller.captureOnStart();
    expect(controller.isLocked()).toBe(false);
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(1);
    emit('dom', 'mousedown', { target: dom });
    doc.exitPointerLock();
    controller.captureOnStart();
    expect(controller.isLocked()).toBe(false);
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('adopts a Start-click lock, routes its clicks, and preserves explicit release and recapture', () => {
    const { controller, dom, emit, lockOn, onClick, onPointerRelease } = setupEnv();
    const root = { closest: () => null } as unknown as HTMLElement;
    lockOn(root);
    controller.adoptStartupCapture(root);
    controller.captureOnStart();
    expect(dom.requestPointerLock).not.toHaveBeenCalled();
    expect(controller.isLocked()).toBe(true);
    emit('doc', 'mousemove', { movementX: 10000 });
    expect(controller.yaw).toBeLessThan(-6 * Math.PI);
    emit('win', 'mousedown', { target: root });
    expect(onClick).toHaveBeenCalledTimes(1);
    controller.setMode('third');
    const distance = controller.thirdDist;
    emit('win', 'wheel', { target: root, deltaY: 100 });
    expect(controller.thirdDist).toBeGreaterThan(distance);
    emit('win', 'mousedown', { target: root, button: 2 });
    emit('win', 'mouseup', { target: root, button: 2 });
    expect(controller.isLocked()).toBe(false);
    expect(onPointerRelease).not.toHaveBeenCalled();
    emit('win', 'mousedown', { target: dom, button: 2 });
    emit('win', 'mouseup', { target: dom, button: 2 });
    expect(controller.isLocked()).toBe(true);
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it.each(['settings', 'cursor', 'blur'] as const)('releases a late startup grant after %s takes over', (reason) => {
    const { controller, dom, emit, onPointerRelease } = setupEnv();
    const grant = dom.requestPointerLock.getMockImplementation()!;
    dom.requestPointerLock.mockImplementationOnce(() => Promise.resolve());
    controller.captureOnStart();
    if (reason === 'settings') { controller.setEnabled(false); controller.setEnabled(true); }
    else if (reason === 'cursor') controller.setCursorMode(true);
    else emit('win', 'blur');
    grant();
    expect(controller.isLocked()).toBe(false);
    expect(onPointerRelease).not.toHaveBeenCalled();
    controller.captureOnStart();
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('keeps the click fallback after a refused startup attempt, without automatic retries', async () => {
    const { controller, dom, emit, onPointerRelease } = setupEnv();
    dom.requestPointerLock.mockRejectedValueOnce(new Error('User gesture required'));
    controller.captureOnStart();
    await Promise.resolve();
    controller.captureOnStart();
    expect(controller.isLocked()).toBe(false);
    expect(dom.classList.contains('mouse-look')).toBe(false);
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(onPointerRelease).not.toHaveBeenCalled();
    emit('dom', 'mousedown', { target: dom });
    expect(controller.isLocked()).toBe(true);
    controller.dispose();
  });

  it('hides the cursor only for captured look and restores it after panel closure', () => {
    const { controller, dom, emit } = setupEnv();
    const hidden = () => dom.classList.contains('mouse-look');
    expect(hidden()).toBe(false);
    expect(dom.requestPointerLock).not.toHaveBeenCalled();
    emit('dom', 'mousedown', { target: dom });
    expect(hidden()).toBe(true);
    controller.setWalkOnly(true);
    expect(hidden()).toBe(false);
    controller.setWalkOnly(false);
    expect(hidden()).toBe(true);
    controller.setEnabled(false);
    expect(hidden()).toBe(false);
    controller.setEnabled(true);
    expect(hidden()).toBe(true);
    controller.setMode('top');
    expect(hidden()).toBe(false);
    controller.setMode('first');
    expect(hidden()).toBe(false);
    controller.dispose();
  });

  it('does not rotate on uncaptured movement; captured movement permits repeated full turns', () => {
    const { controller, dom, emit } = setupEnv();
    const yaw = controller.yaw;
    for (const clientX of [400, 420, 445, 799]) emit('doc', 'mousemove', { clientX, target: dom });
    expect(controller.yaw).toBe(yaw);
    emit('dom', 'mousedown', { target: dom });
    // The pointer stays at the screen edge but relative movement keeps arriving.
    for (let i = 0; i < 100; i++) emit('doc', 'mousemove', { clientX: 799, movementX: 100, target: dom });
    expect(yaw - controller.yaw).toBeCloseTo(10000 * 0.0023);
    expect(yaw - controller.yaw).toBeGreaterThan(3 * Math.PI * 2);
    controller.dispose();
  });

  it('allows dragging after capture is refused and retries capture on the next click', async () => {
    const { controller, dom, emit, onPointerRelease } = setupEnv();
    dom.requestPointerLock.mockRejectedValueOnce(new Error('Permission denied'));
    const yaw = controller.yaw;
    emit('dom', 'mousedown', { clientX: 400, target: dom });
    await Promise.resolve();
    expect(dom.classList.contains('mouse-look')).toBe(false);
    emit('doc', 'mousemove', { clientX: 500, target: dom });
    expect(yaw - controller.yaw).toBeCloseTo(100 * 0.0042);
    emit('win', 'mouseup', { target: dom });
    const stopped = controller.yaw;
    emit('doc', 'mousemove', { clientX: 600, target: dom });
    expect(controller.yaw).toBe(stopped);
    expect(onPointerRelease).not.toHaveBeenCalled();
    emit('dom', 'mousedown', { target: dom });
    expect(controller.isLocked()).toBe(true);
    controller.dispose();
  });

  it('right-click switches to cursor mode for margin panels, and right-clicking again returns to glancing mode', () => {
    const { controller, dom, emit, cursorChanges } = setupEnv();
    // Start in pointer-locked glancing mode
    emit('dom', 'mousedown', { button: 0, clientX: 400, clientY: 300, target: dom });
    expect(controller.isLocked()).toBe(true);
    expect(controller.cursorMode).toBe(false);

    // Right-click frees the cursor for margin panels
    emit('win', 'mousedown', { button: 2, clientX: 400, clientY: 300, target: dom });
    emit('win', 'mouseup', { button: 2, clientX: 400, clientY: 300, target: dom });
    expect(controller.cursorMode).toBe(true);
    expect(controller.isLocked()).toBe(false);
    expect(dom.classList.contains('cursor-mode')).toBe(true);
    expect(cursorChanges).toEqual([true]);

    // While in cursor mode, moving the mouse does NOT rotate the camera
    const yawInCursor = controller.yaw;
    emit('doc', 'mousemove', { clientX: 410, clientY: 300, target: dom });
    emit('doc', 'mousemove', { clientX: 430, clientY: 300, target: dom });
    emit('doc', 'mousemove', { clientX: 460, clientY: 300, target: dom });
    expect(controller.yaw).toBe(yawInCursor);

    // Right-clicking again returns to glancing mode and re-locks the pointer
    emit('win', 'mousedown', { button: 2, clientX: 460, clientY: 300, target: dom });
    emit('win', 'mouseup', { button: 2, clientX: 460, clientY: 300, target: dom });
    expect(controller.cursorMode).toBe(false);
    expect(controller.isLocked()).toBe(true);
    expect(cursorChanges).toEqual([true, false]);
    controller.dispose();
  });

  it('double-click does not switch modes and right-drag still does not switch modes', () => {
    const { controller, dom, emit } = setupEnv();
    emit('dom', 'mousedown', { target: dom });
    emit('dom', 'dblclick', { target: dom });
    expect(controller.isLocked()).toBe(true);
    expect(controller.cursorMode).toBe(false);
    controller.setCursorMode(true);
    emit('dom', 'dblclick', { target: dom });
    expect(controller.cursorMode).toBe(true);
    emit('win', 'mousedown', { button: 2, clientY: 300, target: dom });
    emit('win', 'mouseup', { button: 2, clientY: 420, target: dom });
    expect(controller.cursorMode).toBe(true);
    controller.dispose();
  });

  it('does not defer single clicks while waiting for a possible double-click', () => {
    const { controller, dom, emit, onClick } = setupEnv();
    emit('dom', 'mousedown', { target: dom });
    expect(onClick).toHaveBeenCalledTimes(1);
    emit('dom', 'mousedown', { target: dom, detail: 2 });
    expect(onClick).toHaveBeenCalledTimes(2);
    emit('dom', 'dblclick', { target: dom });
    expect(controller.isLocked()).toBe(true);
    controller.dispose();
  });

  it('tablet clicks pick at release and dragging never interacts', () => {
    const { controller, dom, emit, onClick } = setupEnv();
    controller.setWalkOnly(true);
    emit('dom', 'mousedown', { target: dom, clientX: 200, clientY: 150 });
    expect(onClick).not.toHaveBeenCalled();
    emit('win', 'mouseup', { target: dom, clientX: 200, clientY: 150 });
    expect(onClick).toHaveBeenLastCalledWith(new THREE.Vector2(-0.5, 0.5));
    emit('dom', 'mousedown', { target: dom });
    emit('doc', 'mousemove', { clientX: 500 });
    emit('win', 'mouseup', { target: dom, clientX: 500 });
    expect(onClick).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it.each(['KeyW', 'ArrowUp'])('returns to glancing mode when starting to walk with %s', (code) => {
    const { controller, dom, emit } = setupEnv();
    emit('win', 'mousedown', { button: 2, target: dom });
    emit('win', 'mouseup', { button: 2, target: dom });
    expect(controller.cursorMode).toBe(true);

    emit('win', 'keydown', { code, target: dom });
    expect(controller.cursorMode).toBe(false);
    expect(controller.isLocked()).toBe(true);
    emit('win', 'keyup', { code, target: dom });
    controller.dispose();
  });

  it('keeps the cursor free and mouse-look stopped after inactivity', () => {
    const { controller, dom, emit, cursorChanges } = setupEnv();
    emit('dom', 'mousedown', { button: 0, target: dom });
    emit('win', 'mousedown', { button: 2, target: dom });
    emit('win', 'mouseup', { button: 2, target: dom });
    const yaw = controller.yaw;
    const pitch = controller.pitch;
    dom.requestPointerLock.mockClear();

    vi.advanceTimersByTime(60000);
    expect(controller.cursorMode).toBe(true);
    expect(controller.isLocked()).toBe(false);
    expect(dom.classList.contains('cursor-mode')).toBe(true);
    expect(cursorChanges).toEqual([true]);
    expect(dom.requestPointerLock).not.toHaveBeenCalled();

    // Moving again after the wait must not turn the camera with a visible cursor.
    for (const [clientX, clientY] of [[410, 300], [430, 310], [460, 320]]) {
      emit('doc', 'mousemove', { clientX, clientY, target: dom });
    }
    expect(controller.yaw).toBe(yaw);
    expect(controller.pitch).toBe(pitch);
    vi.advanceTimersByTime(60000);
    expect(controller.cursorMode).toBe(true);
    controller.dispose();
  });

  it('returns to glancing mode when clicking an empty part of the scene', () => {
    const { controller, dom, emit } = setupEnv();
    emit('win', 'mousedown', { button: 2, target: dom });
    emit('win', 'mouseup', { button: 2, target: dom });
    expect(controller.cursorMode).toBe(true);

    emit('dom', 'mousedown', { button: 0, target: dom });
    expect(controller.cursorMode).toBe(false);
    expect(controller.isLocked()).toBe(true);
    controller.dispose();
  });
});

// Settings and cursor mode both observe pointer lock. Only a browser release opens settings.
describe('integrated cursor and settings controls', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('restores captured look after settings, tablets and nested panel switches', () => {
    const { controller, dom } = setupEnv();
    dom.requestPointerLock();
    controller.setInputMode('none');
    controller.setInputMode('walk');
    controller.setInputMode('none');
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(1);
    controller.setInputMode('full');
    expect(controller.isLocked()).toBe(true);
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(2);
    controller.setInputMode('walk');
    controller.setInputMode('full');
    expect(controller.isLocked()).toBe(true);
    controller.dispose();
  });

  it('keeps the free cursor when that was the mode before opening a panel', () => {
    const { controller, dom } = setupEnv();
    controller.setCursorMode(true);
    controller.setInputMode('none');
    controller.setInputMode('walk');
    controller.setInputMode('full');
    expect(controller.cursorMode).toBe(true);
    expect(dom.requestPointerLock).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('remembers look when the browser releases capture for Esc, and waits for closing Esc to be released', () => {
    const { controller, dom, doc, emit } = setupEnv();
    dom.requestPointerLock();
    doc.exitPointerLock();
    controller.setInputMode('none');
    emit('win', 'keydown', { code: 'Escape' });
    controller.setInputMode('full');
    expect(controller.isLocked()).toBe(false);
    emit('win', 'keyup', { code: 'Escape' });
    expect(controller.isLocked()).toBe(true);
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it.each(['blur', 'fullscreen'] as const)('does not restore capture after %s interrupts panel closure', (reason) => {
    const { controller, dom, emit } = setupEnv();
    dom.requestPointerLock();
    controller.setInputMode('none');
    emit('win', 'keydown', { code: 'Escape' });
    controller.setInputMode('full');
    if (reason === 'blur') { emit('win', 'blur'); emit('win', 'focus'); }
    else emit('doc', 'fullscreenchange');
    emit('win', 'keyup', { code: 'Escape' });
    expect(controller.isLocked()).toBe(false);
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('rejects a late restore grant if another panel opens, and leaves a click fallback after denial', async () => {
    const { controller, dom } = setupEnv();
    dom.requestPointerLock();
    controller.setInputMode('none');
    const grant = dom.requestPointerLock.getMockImplementation()!;
    dom.requestPointerLock.mockImplementationOnce(() => Promise.resolve());
    controller.setInputMode('full');
    controller.setInputMode('walk');
    grant();
    expect(controller.isLocked()).toBe(false);
    controller.setInputMode('full');
    dom.requestPointerLock();
    controller.setInputMode('none');
    dom.requestPointerLock.mockRejectedValueOnce(new Error('Gesture required'));
    controller.setInputMode('full');
    await Promise.resolve();
    expect(controller.isLocked()).toBe(false);
    expect(dom.classList.contains('mouse-look')).toBe(false);
    controller.dispose();
  });

  it('keeps right-click release distinct from the browser taking pointer lock', () => {
    const { controller, dom, doc, emit, onPointerRelease } = setupEnv();
    dom.requestPointerLock();
    emit('win', 'mousedown', { button: 2, target: dom });
    emit('win', 'mouseup', { button: 2, target: dom });
    expect(controller.cursorMode).toBe(true);
    expect(onPointerRelease).not.toHaveBeenCalled();
    controller.setCursorMode(false);
    dom.requestPointerLock();
    doc.exitPointerLock();
    expect(controller.cursorMode).toBe(true);
    expect(onPointerRelease).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('waits for fullscreen entry once, and cancels startup capture if the player switches windows', () => {
    const { controller, dom, emit } = setupEnv();
    const transition = vi.spyOn(fullscreen, 'isFullscreenTransitioning').mockReturnValue(true);
    controller.captureOnStart();
    expect(dom.requestPointerLock).not.toHaveBeenCalled();
    transition.mockReturnValue(false);
    controller.captureOnStart();
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(1);
    controller.dispose();
    const other = setupEnv();
    other.emit('win', 'blur'); other.emit('win', 'focus');
    other.controller.captureOnStart();
    expect(other.dom.requestPointerLock).not.toHaveBeenCalled();
    other.controller.dispose();
  });

  it('ignores fullscreen releases and waits for fullscreen entry before requesting capture', () => {
    const { controller, dom, doc, emit, onPointerRelease } = setupEnv();
    dom.requestPointerLock();
    const transition = vi.spyOn(fullscreen, 'isFullscreenTransitioning').mockReturnValue(true);
    doc.exitPointerLock();
    expect(onPointerRelease).not.toHaveBeenCalled();
    dom.requestPointerLock.mockClear();
    emit('dom', 'mousedown', { target: dom });
    expect(dom.requestPointerLock).not.toHaveBeenCalled();
    transition.mockReturnValue(false);
    emit('dom', 'mousedown', { target: dom });
    expect(controller.isLocked()).toBe(true);
    doc.exitPointerLock();
    expect(onPointerRelease).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('does not treat a delayed focus-loss release as Esc', () => {
    const { controller, dom, doc, emit, onPointerRelease } = setupEnv();
    dom.requestPointerLock();
    emit('win', 'blur');
    emit('win', 'focus');
    doc.exitPointerLock();
    expect(onPointerRelease).not.toHaveBeenCalled();
    emit('dom', 'mousedown', { target: dom });
    doc.exitPointerLock();
    expect(onPointerRelease).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it.each(['tablet', 'settings', 'top'] as const)('does not open settings when %s releases the mouse', (target) => {
    const { controller, dom, onPointerRelease } = setupEnv();
    dom.requestPointerLock();
    if (target === 'tablet') controller.setWalkOnly(true);
    else if (target === 'settings') controller.setEnabled(false);
    else controller.setMode('top');
    expect(controller.isLocked()).toBe(false);
    expect(onPointerRelease).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('applies sensitivity and invert-Y to captured look', () => {
    const { controller, dom, emit } = setupEnv();
    controller.setLook({ sensitivity: 2, invertY: true });
    const yaw = controller.yaw, pitch = controller.pitch;
    emit('dom', 'mousedown', { target: dom });
    emit('doc', 'mousemove', { movementX: 20, movementY: 10, target: dom });
    expect(controller.yaw).toBeCloseTo(yaw - 20 * 0.0023 * 2);
    expect(controller.pitch).toBeCloseTo(pitch + 10 * 0.0023 * 2);
    controller.dispose();
  });
});


describe('queued browser pointer-lock events', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('permits retry after a legacy void-returning request reports pointerlockerror', () => {
    const { controller, dom, emit, flushPointer } = setupEnv(true);
    dom.requestPointerLock.mockImplementationOnce(() => undefined);
    emit('dom', 'mousedown', { target: dom });
    emit('doc', 'pointerlockerror');
    emit('dom', 'mousedown', { target: dom });
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(2);
    flushPointer();
    expect(controller.isLocked()).toBe(true);
    controller.dispose(); flushPointer();
  });

  it.each(['blur', 'fullscreen'] as const)('releases a pending manual grant after %s without recapturing', (reason) => {
    const { controller, dom, emit, flushPointer, onPointerRelease } = setupEnv(true);
    emit('dom', 'mousedown', { target: dom });
    if (reason === 'blur') emit('win', 'blur'); else emit('doc', 'fullscreenchange');
    flushPointer(); // the old click is granted after its context was cancelled
    flushPointer(); // release the late grant
    expect(controller.isLocked()).toBe(false);
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(onPointerRelease).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('does not duplicate a pending request and rejects a manual grant after a panel opens', () => {
    const { controller, dom, emit, flushPointer, onPointerRelease } = setupEnv(true);
    emit('dom', 'mousedown', { target: dom });
    emit('dom', 'mousedown', { target: dom });
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(1);
    controller.setInputMode('walk');
    flushPointer(); // the old click is granted after the tablet opens
    expect(dom.classList.contains('mouse-look')).toBe(false);
    flushPointer(); // intentional release must not open settings
    expect(controller.isLocked()).toBe(false);
    expect(onPointerRelease).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('restores look if a panel closes before its queued unlock arrives', () => {
    const { controller, dom, flushPointer, onPointerRelease } = setupEnv(true);
    controller.captureOnStart(); flushPointer();
    controller.setInputMode('none');
    controller.setInputMode('walk');
    controller.setInputMode('full');
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(1);
    flushPointer(); // complete the release, then request the remembered look mode
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(2);
    flushPointer();
    expect(controller.isLocked()).toBe(true);
    expect(onPointerRelease).not.toHaveBeenCalled();
    controller.dispose(); flushPointer();
  });

  it('does not consume the intentional release marker on an earlier grant event', () => {
    const { controller, dom, emit, flushPointer, onPointerRelease } = setupEnv(true);
    controller.captureOnStart(); flushPointer();
    controller.setCursorMode(true); // exit request queued
    emit('doc', 'pointerlockchange'); // older notification still sees the captured element
    expect(controller.cursorMode).toBe(true);
    flushPointer();
    expect(controller.cursorMode).toBe(true);
    expect(controller.isLocked()).toBe(false);
    expect(onPointerRelease).not.toHaveBeenCalled();
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('keeps right-click mode through queued release and recapture', () => {
    const { controller, dom, emit, flushPointer, onPointerRelease } = setupEnv(true);
    controller.captureOnStart(); flushPointer();
    emit('win', 'mousedown', { button: 2, target: dom });
    emit('win', 'mouseup', { button: 2, target: dom });
    expect(controller.cursorMode).toBe(true);
    flushPointer();
    expect(controller.cursorMode).toBe(true);
    emit('win', 'mousedown', { button: 2, target: dom });
    emit('win', 'mouseup', { button: 2, target: dom });
    flushPointer();
    expect(controller.isLocked()).toBe(true);
    expect(onPointerRelease).not.toHaveBeenCalled();
    controller.dispose(); flushPointer();
  });

  it('honors a second right-click before the first queued unlock completes', () => {
    const { controller, dom, emit, flushPointer, onPointerRelease } = setupEnv(true);
    controller.captureOnStart(); flushPointer();
    for (let i = 0; i < 2; i++) {
      emit('win', 'mousedown', { button: 2, target: dom });
      emit('win', 'mouseup', { button: 2, target: dom });
    }
    expect(controller.cursorMode).toBe(false);
    flushPointer(); flushPointer();
    expect(controller.isLocked()).toBe(true);
    expect(onPointerRelease).not.toHaveBeenCalled();
    controller.dispose(); flushPointer();
  });

  it.each(['blur', 'fullscreen'] as const)('does not execute deferred panel recapture after %s', (reason) => {
    const { controller, dom, emit, flushPointer } = setupEnv(true);
    controller.captureOnStart(); flushPointer();
    controller.setInputMode('none'); controller.setInputMode('full');
    if (reason === 'blur') emit('win', 'blur'); else emit('doc', 'fullscreenchange');
    flushPointer();
    expect(dom.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(controller.isLocked()).toBe(false);
    controller.dispose();
  });
});
