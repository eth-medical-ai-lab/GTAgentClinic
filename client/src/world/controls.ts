/**
 * Player controller: first-person (pointer lock), third-person over-the-shoulder and
 * top-down bird's-eye (screen-relative WASD + click-to-move). Handles collisions.
 */
import * as THREE from 'three';
import type { CameraMode } from '../../../shared/types';
import type { Disc } from './pathfinding';
import { JUMP_V, jumpWind } from './jump';
import { browserDemo } from '../demo/mode';
import { isFullscreen, isFullscreenTransitioning } from '../ui/fullscreen';

export interface ControllerHooks {
  onCycleCamera(): void;
  onInteractKey(): void;
  /** Screen picking; touch/top-down clicks can also walk to a distant target. False permits pointer lock. */
  onClick(ndc?: THREE.Vector2, walkToTarget?: boolean): boolean | void;
  /** [F] inspect the object in hand */
  onInspectKey?(): void;
  /** [G] put down the object in hand */
  onDropKey?(): void;
  /**
   * pointer lock ended without the controller asking: the browser took it back (Esc, which it may
   * keep from the page, or the window losing focus). The app opens the settings menu (App.tsx).
   */
  onPointerRelease?(): void;
  /** called when switching between glancing mode (false) and free-cursor mode for margin panels (true) */
  onCursorModeChange?(cursorMode: boolean): void;
}

/** the look speeds at sensitivity 1 (radians per pixel): pointer lock, and dragging on the view */
const LOCK_LOOK = 0.0023;
const DRAG_LOOK = 0.0042;

const EYE = 1.65;
const RADIUS = 0.3;
/** brisk hospital walk; run with Shift or by double-tapping (and holding) W */
const WALK = 2.1;
// Run speeds sit near the natural speed of a mocap cycle (avatars.ts picks the clip by speed), so
// cadence and stride stay human: Shift/double-tap W runs on the fast-run cycle (≈5.4–5.8 m/s at
// 1×, played at ~0.86–0.93×: ~165 steps/min); tagging along catches up at a jog (the ≈2.9 m/s cycle).
const SPRINT = 5.0;
const JOG = 2.9;
// a jump (jump.ts): JUMP_V = 3.1 m/s → ~0.42 m standing jump, after a 0.1 s push-off (0.06 s out of a run)
/** over-the-shoulder camera: the longest boom (m), and how high above the ground it may sit where there's no ceiling */
const THIRD_MAX_DIST = 4.5;
const THIRD_MAX_HEIGHT = 4.0;
const GRAVITY = 11.5;
const TOP_PITCH = THREE.MathUtils.degToRad(58);

/**
 * Something the player rides (wheelchair.ts). While set it moves you instead of walking: drive()
 * gets the keys every frame and sets pos, y and facing (and turns yaw along with you). No jumping.
 */
export interface Ride {
  /** per frame: forward −1..1 (W/S), turn −1..1 (A = +1, to the left), fast = Shift (or double-tap W) */
  drive(dt: number, forward: number, turn: number, fast: boolean): void;
  /** the first-person eye in the body's frame (m): x to its left, y above the feet, z ahead */
  readonly eye: THREE.Vector3;
  /** third person: height of the camera boom's pivot above the feet (m) */
  readonly pivot: number;
}

export class PlayerController {
  pos = new THREE.Vector2();
  readonly people: Disc[] = [];
  yaw = 0;
  pitch = -0.05;
  mode: CameraMode = 'first';
  enabled = true;
  moving = false;
  speed = 0;
  facing = 0; // avatar yaw
  path: THREE.Vector2[] | null = null;
  /** follow `path` at a jog (tagging along with someone far ahead) */
  pathRun = false;
  /**
   * first-person head bob from the (hidden) avatar's mocap head motion, in meters (y up, x to the
   * right), so the view bounces in step with the footfalls; null = a simple sine bob
   */
  headBob: { x: number; y: number } | null = null;
  /** feet height (stairs, landings, jumps) */
  y = 0;
  private vy = 0;
  /** false from the jump key until the feet are down again (the push-off counts: the avatar crouches) */
  grounded = true;
  /** a jump's push-off: seconds left with the feet still on the floor (< 0: none), and its length */
  private windT = -1;
  private windLen = 0;
  /** the last landing: seconds since, and how hard (m/s down) */
  private landT = Infinity;
  private impact = 0;
  /** first person: how far the eyes sink (m) in a push-off and as the knees take a landing */
  dip = 0;
  /**
   * floor height at (x, z) for someone whose feet are at y: stairs, landings, an upper storey's floor
   * (within reach of y), an elevator car's floor; set by the world (floors.ts)
   */
  groundAt: (x: number, z: number, y?: number) => number = () => 0;
  /** floor under the player at the start of this frame: colliders are solid only from there up (storeys) */
  private floorY = 0;
  /** ceiling height at (x, z): a third-person camera pulled above it switches the world to a cutaway view */
  ceilingAt: (x: number, z: number) => number = () => 3.0;
  private runLatch = false;
  private lastWDown = 0;
  /** true while the player steers with the keyboard (lets the world cancel tag-along following) */
  steering = false;
  /** riding something (a wheelchair: wheelchair.ts); null = on foot */
  ride: Ride | null = null;
  /** rolling, not walking: no footsteps (the soundscape reads this) */
  get rolling(): boolean {
    return !!this.ride;
  }
  readonly mouse = new THREE.Vector2(0, 0);
  mouseInside = false;
  /**
   * When false (default in first/third person), a scene click captures the mouse for looking.
   * Right-clicking (or pressing Esc) sets `cursorMode = true`,
   * releasing pointer lock so the cursor can click HUD panels at the margin.
   * Returns to false (glancing mode) on right-click again, a click on empty scenery,
   * or walking (WASD/arrows). Waiting does not change the mode.
   */
  cursorMode = false;
  private lostFocus = false;
  private suspendedMode: 'look' | 'cursor' | 'uncaptured' | null = null;
  private escapeHeld = false;
  private startupCaptureDone = false;
  private captureCancelled = false;
  private lockRequest: { legacy: boolean } | null = null;
  private recaptureAfterRelease = false;
  private rightDown: { x: number; y: number; ignore: boolean } | null = null;
  private keys = new Set<string>();
  private locked = false;
  private startupTarget: HTMLElement | null = null;
  /** the controller itself asked to leave pointer lock (so it is not the browser taking it) */
  private releasing = false;
  /** mouse look: sensitivity multiplier and inverted vertical axis (the in-game settings) */
  private lookScale = 1;
  private lookSignY = 1;
  private topZoom = 21;
  thirdDist = 2.7;
  private camPos = new THREE.Vector3();
  private camInit = false;
  private bob = 0;
  private listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];

  constructor(
    private dom: HTMLElement,
    private camera: THREE.PerspectiveCamera,
    private colliders: THREE.Box3[],
    private cameraBlockers: THREE.Box3[],
    private bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    private hooks: ControllerHooks,
  ) {
    this.updateCursorVisibility();
    const on = (t: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn, opts);
      this.listeners.push([t, type, fn, opts]);
    };
    on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    on(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    on(window, 'blur', () => {
      this.keys.clear(); this.drag = null; this.lostFocus = true; this.startupCaptureDone = true;
      this.escapeHeld = false; this.suspendedMode = null; this.recaptureAfterRelease = false; this.captureCancelled = true;
    });
    const fullscreenChanged = () => {
      if (!isFullscreen()) { this.suspendedMode = null; this.recaptureAfterRelease = false; this.captureCancelled = true; }
    };
    on(document, 'fullscreenchange', fullscreenChanged);
    on(document, 'webkitfullscreenchange', fullscreenChanged);
    on(document, 'pointerlockerror', () => {
      // Older browsers return void and report denial only through this event.
      if (this.lockRequest?.legacy) this.lockRequest = null;
    });
    on(document, 'pointerlockchange', () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.dom || (!!this.startupTarget && document.pointerLockElement === this.startupTarget);
      if (!this.locked) this.startupTarget = null;
      const asked = this.releasing;
      // A grant event can arrive while our exit request is still queued.
      if (!this.locked) this.releasing = false;
      this.drag = null;
      const requested = !!this.lockRequest;
      this.lockRequest = null;
      // A delayed grant must not take the cursor from a panel or another window.
      if (this.locked && requested && (this.captureCancelled || !this.enabled || this.walkOnly || this.mode === 'top' || this.cursorMode || this.lostFocus || document.hidden || !document.hasFocus())) {
        this.unlock();
        this.updateCursorVisibility();
        return;
      }
      if (this.locked && asked) { this.updateCursorVisibility(); return; }
      if (this.locked) this.lostFocus = false;
      if (this.locked && this.cursorMode) {
        this.setCursorMode(false);
      } else if (wasLocked && !this.locked && !asked) {
        // Browser release (Esc) opens settings; our own cursor toggle must not.
        if (this.enabled && !this.walkOnly && this.mode !== 'top' && !this.lostFocus && !isFullscreenTransitioning()) this.suspendedMode ??= 'look';
        if (this.enabled && this.mode !== 'top' && !this.walkOnly) this.setCursorMode(true);
        if (this.enabled && !this.walkOnly && this.mode !== 'top' && !this.lostFocus && !isFullscreenTransitioning()) this.hooks.onPointerRelease?.();
      }
      this.updateCursorVisibility();
      if (!this.locked && this.recaptureAfterRelease) {
        this.recaptureAfterRelease = false;
        this.tryLock();
      }
    });
    on(window, 'ac-doctor-look', (event) => {
      if (!this.enabled || this.mode === 'top') return;
      const { dx, dy } = (event as CustomEvent<{ dx: number; dy: number }>).detail;
      this.mouseLook(dx, dy);
    });
    on(document, 'mousemove', (e) => this.onMouseMove(e as MouseEvent));
    on(this.dom, 'mouseleave', () => {
      this.mouseInside = false;
    });
    on(this.dom, 'mousedown', (e) => this.onMouseDown(e as MouseEvent));
    on(window, 'mousedown', (e) => this.onWindowMouseDown(e as MouseEvent));
    on(window, 'mouseup', (e) => this.onMouseUp(e as MouseEvent));
    if (browserDemo) {
      let finger: { id: number; x: number; y: number; travel: number } | null = null;
      on(this.dom, 'pointerdown', (ev) => {
        const e = ev as PointerEvent;
        if (e.pointerType !== 'touch' || !this.enabled) return;
        e.preventDefault(); // suppress the compatibility mousedown that requests pointer lock
        if (!e.isPrimary) { finger = null; return; }
        finger = { id: e.pointerId, x: e.clientX, y: e.clientY, travel: 0 };
        this.dom.setPointerCapture(e.pointerId);
      });
      on(this.dom, 'pointermove', (ev) => {
        const e = ev as PointerEvent;
        if (finger?.id !== e.pointerId) return;
        const dx = e.clientX - finger.x;
        const dy = e.clientY - finger.y;
        finger.x = e.clientX;
        finger.y = e.clientY;
        finger.travel += Math.hypot(dx, dy);
        if (this.enabled && this.mode !== 'top' && finger.travel > 6) this.mouseLook(dx * 2, dy * 2);
      });
      on(this.dom, 'pointerup', (ev) => {
        const e = ev as PointerEvent;
        if (finger?.id !== e.pointerId) return;
        const tap = finger.travel <= 6;
        finger = null;
        if (this.enabled && tap) this.clickAt(e.clientX, e.clientY);
      });
      on(this.dom, 'pointercancel', () => { finger = null; });
    }
    on(this.dom, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });
    on(window, 'wheel', (e) => {
      if (this.locked && e.target === this.startupTarget) this.onWheel(e as WheelEvent);
    }, { passive: false });
    on(window, 'contextmenu', (e) => {
      if (this.enabled && !this.typingTarget(e)) e.preventDefault();
    });
  }

  get zoom() { return { third: this.thirdDist, top: this.topZoom }; }
  set zoom(saved: { third: number; top: number }) {
    this.thirdDist = saved.third;
    this.topZoom = saved.top;
  }

  isLocked() {
    return this.locked;
  }

  private unlock() {
    if (this.releasing) return;
    this.releasing = true;
    document.exitPointerLock();
  }

  setLook(look: { sensitivity: number; invertY: boolean }) {
    this.lookScale = look.sensitivity;
    this.lookSignY = look.invertY ? -1 : 1;
  }

  resetLookTracking() {
    this.drag = null;
  }

  private rememberInputMode() {
    if (this.suspendedMode === null && this.enabled && !this.walkOnly) {
      this.suspendedMode = this.locked ? 'look' : this.cursorMode ? 'cursor' : 'uncaptured';
    }
  }

  private restoreInputMode() {
    if (!this.enabled || this.walkOnly || this.escapeHeld) return;
    const previous = this.suspendedMode;
    this.suspendedMode = null;
    if (this.mode === 'top' || this.lostFocus || document.hidden || !document.hasFocus() || isFullscreenTransitioning()) return;
    if (previous === 'cursor') this.setCursorMode(true);
    if (previous === 'look') {
      this.setCursorMode(false);
      this.captureCancelled = false;
      this.tryLock();
    }
  }

  /** Apply panel transitions together, so switching panels cannot briefly recapture the mouse. */
  setInputMode(mode: 'full' | 'walk' | 'none') {
    this.setEnabled(mode !== 'none', false);
    this.setWalkOnly(mode === 'walk', false);
    if (mode === 'full') this.restoreInputMode();
  }

  /** Adopt the Start click's lock without making a second browser request. */
  adoptStartupCapture(target: HTMLElement | null) {
    this.startupCaptureDone = true;
    this.startupTarget = target;
    this.locked = !!target && document.pointerLockElement === target;
    this.updateCursorVisibility();
  }

  /** Called after loading; later releases must always remain under the player's control. */
  captureOnStart() {
    if (this.startupCaptureDone) return;
    if (!this.enabled || this.walkOnly || this.mode === 'top' || this.cursorMode || this.lostFocus || document.hidden || !document.hasFocus()) {
      this.startupCaptureDone = true;
      return;
    }
    if (isFullscreenTransitioning()) return;
    this.startupCaptureDone = true;
    if (this.locked) return;
    this.tryLock();
  }

  private tryLock() {
    if (!this.enabled || this.mode === 'top' || this.walkOnly || this.cursorMode || isFullscreenTransitioning()) return;
    // Panels may close before the browser delivers its queued release event.
    if (this.releasing) { this.recaptureAfterRelease = true; return; }
    if (this.locked || this.lockRequest) return;
    const request = { legacy: true };
    this.lockRequest = request;
    this.lostFocus = false; // a new explicit gesture can capture after the window regains focus
    this.captureCancelled = false;
    const failed = () => {
      if (this.lockRequest !== request) return;
      this.lockRequest = null;
    };
    try {
      const p = this.dom.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') { request.legacy = false; p.catch(failed); }
      if (!this.dom.requestPointerLock) failed();
    } catch {
      failed(); // pointer lock may be refused outside a click gesture
    }
  }

  private updateCursorVisibility() {
    // Hide the cursor only after capture succeeds; an unlocked cursor still hits screen edges.
    this.dom.classList.toggle('mouse-look', this.locked && !this.releasing && this.enabled && this.mode !== 'top' && !this.walkOnly && !this.cursorMode);
  }

  setCursorMode(on: boolean, notify = true) {
    this.drag = null;
    const next = on && this.enabled && this.mode !== 'top' && !this.walkOnly;
    const changed = this.cursorMode !== next;
    this.cursorMode = next;
    if (next) { this.startupCaptureDone = true; this.captureCancelled = true; }
    this.dom.classList.toggle('cursor-mode', next);
    this.updateCursorVisibility();
    if (next) {
      if (this.locked || document.pointerLockElement === this.dom) this.unlock();
    }
    if (changed && notify) this.hooks.onCursorModeChange?.(next);
  }

  /**
   * Walk-only mode (a tablet/panel is open): WASD still moves, but looking is click-and-drag on
   * the 3D view instead of pointer lock, so the mouse stays free for the panel. A click without
   * dragging still interacts (like E).
   */
  walkOnly = false;
  /** F/G still reach the item system while movement is disabled (3D close-up of a held object) */
  allowItemKeys = false;
  private drag: { x: number; y: number; moved: number } | null = null;
  setWalkOnly(v: boolean, restore = true) {
    if (v) this.rememberInputMode();
    if (v && this.lockRequest) this.captureCancelled = true;
    this.walkOnly = v;
    this.updateCursorVisibility();
    if (v) {
      this.setCursorMode(false, false);
      if (this.locked) this.unlock();
    }
    this.drag = null;
    if (!v && restore) this.restoreInputMode();
  }

  private ndcAt(e: MouseEvent): THREE.Vector2 {
    return this.screenNdc(e.clientX, e.clientY);
  }

  private screenNdc(x: number, y: number, r = this.dom.getBoundingClientRect()) {
    return new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  private onWindowMouseDown(e: MouseEvent) {
    // The first lock belongs to the page root, so its clicks do not hit the scene element.
    if (this.locked && e.target === this.startupTarget && e.button === 0) this.onMouseDown(e);
    if (!this.enabled || this.mode === 'top' || this.walkOnly || this.typingTarget(e)) return;
    if (e.button === 2) {
      if (this.locked && !this.releasing) {
        // Right-click while pointer-locked immediately frees the cursor for margin panels
        this.rightDown = { x: e.clientX, y: e.clientY, ignore: true };
        this.setCursorMode(true);
        return;
      }
      this.rightDown = { x: e.clientX, y: e.clientY, ignore: false };
    }
  }

  private onMouseUp(e: MouseEvent) {
    if (e.button === 2 && this.rightDown) {
      const rd = this.rightDown;
      this.rightDown = null;
      if (!rd.ignore && this.enabled && this.mode !== 'top' && !this.walkOnly && Math.hypot(e.clientX - rd.x, e.clientY - rd.y) < 12) {
        if (this.cursorMode) {
          this.setCursorMode(false);
          this.tryLock();
        } else {
          this.setCursorMode(true);
        }
      }
      return;
    }
    if (!this.drag || e.button !== 0) return;
    const click = this.drag.moved < 5;
    this.drag = null;
    this.dom.classList.remove('dragging');
    if (click && this.enabled && this.walkOnly) this.hooks.onClick(this.ndcAt(e));
  }

  setEnabled(v: boolean, restore = true) {
    if (!v) this.rememberInputMode();
    if (!v && this.lockRequest) this.captureCancelled = true;
    this.enabled = v;
    this.updateCursorVisibility();
    if (!v) {
      this.keys.clear();
      this.path = null;
      this.setCursorMode(false, false);
      if (this.locked) this.unlock();
    }
    if (v && restore) this.restoreInputMode();
  }

  setMode(m: CameraMode) {
    if (m === this.mode) return;
    if (m === 'top') this.suspendedMode = null;
    if (m === 'top' && this.lockRequest) this.captureCancelled = true;
    const wasTop = this.mode === 'top';
    this.mode = m;
    this.camInit = false;
    this.setCursorMode(false, false);
    if (m === 'top') {
      if (this.locked) this.unlock();
      this.dom.classList.add('top-mode');
    } else {
      this.dom.classList.remove('top-mode');
      if (wasTop) {
        this.yaw = this.facing - Math.PI;
        this.pitch = -0.05;
      }
    }
  }

  private typingTarget(e: Event) {
    const t = e.target as HTMLElement | null;
    return !!t?.closest?.('input, textarea, select, [contenteditable="true"]');
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (e.code === 'Escape') {
      this.escapeHeld = down;
      // Wait for release: holding Esc to leave fullscreen must never capture the mouse again.
      if (!down) this.restoreInputMode();
    }
    if (down && !this.typingTarget(e) && !e.repeat && (e.code === 'KeyF' || e.code === 'KeyG') && !this.enabled && this.allowItemKeys) {
      if (e.code === 'KeyF') this.hooks.onInspectKey?.();
      else this.hooks.onDropKey?.();
      return;
    }
    if (down && (!this.enabled || this.typingTarget(e))) return;
    const code = e.code;
    if (down) {
      if (code === 'KeyV' && !e.repeat) {
        this.hooks.onCycleCamera();
        return;
      }
      if (code === 'KeyE' && !e.repeat) {
        // E opens a chat whose text box takes focus during this same key event (React flushes
        // effects synchronously for key input), so without this the "e" would be typed into it
        e.preventDefault();
        this.hooks.onInteractKey();
        return;
      }
      if (code === 'KeyF' && !e.repeat) {
        this.hooks.onInspectKey?.();
        return;
      }
      if (code === 'KeyG' && !e.repeat) {
        this.hooks.onDropKey?.();
        return;
      }
      if (code === 'Space') {
        e.preventDefault();
        if (!e.repeat && this.grounded && !this.ride) {
          // the legs push off the floor first (the avatar dips and extends, jump.ts); then the body flies
          this.windLen = this.windT = jumpWind(this.speed);
          this.vy = 0;
          this.grounded = false;
        }
        return;
      }
      if ((code === 'KeyW' || code === 'ArrowUp') && !e.repeat) {
        // double-tap W (and hold) = run
        const now = performance.now();
        if (now - this.lastWDown < 320) this.runLatch = true;
        this.lastWDown = now;
      }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(code)) {
        this.keys.add(code);
        if (code.startsWith('Arrow')) e.preventDefault();
        if (!code.startsWith('Shift')) {
          this.path = null;
          if (this.cursorMode) {
            this.setCursorMode(false);
            this.tryLock();
          }
        }
      }
    } else {
      this.keys.delete(code);
      if (code === 'KeyW' || code === 'ArrowUp') this.runLatch = false;
    }
  }

  private mouseLook(dx: number, dy: number) {
    const k = LOCK_LOOK * this.lookScale;
    this.yaw -= dx * k;
    this.pitch = Math.max(-1.35, Math.min(1.25, this.pitch - dy * k * this.lookSignY));
  }

  private onMouseMove(e: MouseEvent) {
    if (this.drag && this.enabled && this.mode !== 'top') {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      const k = DRAG_LOOK * this.lookScale;
      this.yaw -= dx * k;
      this.pitch -= dy * k * this.lookSignY;
      this.pitch = Math.max(-1.35, Math.min(1.25, this.pitch));
      return;
    }
    if (this.locked && !this.releasing && this.enabled && this.mode !== 'top') {
      this.mouseLook(e.movementX, e.movementY);
      return;
    }
    const r = this.dom.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    this.mouseInside = inside;
    if (inside) this.mouse.copy(this.screenNdc(e.clientX, e.clientY, r));
  }

  private clickAt(x: number, y: number) {
    this.mouse.copy(this.screenNdc(x, y));
    this.hooks.onClick(this.mouse.clone(), true);
  }

  private onMouseDown(e: MouseEvent) {
    if (!this.enabled || e.button !== 0) return;
    if (this.mode === 'top') {
      this.clickAt(e.clientX, e.clientY);
      return;
    }
    if (this.walkOnly) {
      // leave any text field so WASD moves the doctor, then look by dragging
      (document.activeElement as HTMLElement | null)?.blur?.();
      this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
      this.dom.classList.add('dragging');
      return;
    }
    if (!this.locked || this.releasing) {
      if (this.hooks.onClick(this.ndcAt(e)) === false) {
        if (this.cursorMode) this.setCursorMode(false);
        this.tryLock();
        // If capture is denied, this press can still drag the view. A later click retries.
        if (!this.locked) this.drag = { x: e.clientX, y: e.clientY, moved: 0 };
      }
      return;
    }
    this.hooks.onClick();
  }

  private onWheel(e: WheelEvent) {
    if (!this.enabled) return;
    if (this.mode === 'top') {
      e.preventDefault();
      this.topZoom = Math.max(8, Math.min(42, this.topZoom * (e.deltaY > 0 ? 1.1 : 0.9)));
    } else if (this.mode === 'third') {
      e.preventDefault();
      // over-the-shoulder stays over the shoulder: a short boom (the top-down camera is for overviews)
      this.thirdDist = Math.max(1.4, Math.min(THIRD_MAX_DIST, this.thirdDist * (e.deltaY > 0 ? 1.1 : 0.9)));
    }
  }

  /** Ray for aiming: screen center (first/third) or mouse (top). */
  aimNdc(): THREE.Vector2 | null {
    if (this.mode === 'top') return this.mouseInside ? this.mouse : null;
    return new THREE.Vector2(0, 0);
  }

  private collide(x: number, z: number): [number, number] {
    let px = x;
    let pz = z;
    // a box blocks only the storey it stands on: the floor below's walls end where this floor starts
    const y0 = this.floorY + 0.05;
    const y1 = this.floorY + 2.0;
    for (let iter = 0; iter < 2; iter++) {
      for (const person of this.people) {
        const dx = px - person.x;
        const dz = pz - person.z;
        const clearance = RADIUS + person.r;
        if (Math.abs(dx) >= clearance || Math.abs(dz) >= clearance) continue;
        const startX = this.pos.x - person.x;
        const startZ = this.pos.y - person.z;
        const startDist = Math.hypot(startX, startZ);
        if (startDist < clearance) {
          // A moving NPC or a restored pose can already overlap us. Allow stepping
          // out or sideways without snapping the player across the overlap in one frame.
          const inward = (px - this.pos.x) * startX + (pz - this.pos.y) * startZ;
          if (inward < 0 && startDist > 1e-6) {
            px -= startX * inward / (startDist * startDist);
            pz -= startZ * inward / (startDist * startDist);
          }
          continue;
        }
        const dist = Math.hypot(dx, dz);
        if (dist >= clearance) continue;
        const nx = dist > 1e-6 ? dx / dist : startX / startDist;
        const nz = dist > 1e-6 ? dz / dist : startZ / startDist;
        px = person.x + nx * clearance;
        pz = person.z + nz * clearance;
      }
      for (const b of this.colliders) {
        if (px < b.min.x - RADIUS || px > b.max.x + RADIUS || pz < b.min.z - RADIUS || pz > b.max.z + RADIUS) continue;
        if (b.max.y <= y0 || b.min.y >= y1) continue;
        const cx = Math.max(b.min.x, Math.min(px, b.max.x));
        const cz = Math.max(b.min.z, Math.min(pz, b.max.z));
        const dx = px - cx;
        const dz = pz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          px = cx + (dx / d) * RADIUS;
          pz = cz + (dz / d) * RADIUS;
        } else {
          // inside the box: push out along the smallest penetration axis
          const left = px - b.min.x;
          const right = b.max.x - px;
          const top = pz - b.min.z;
          const bottom = b.max.z - pz;
          const m = Math.min(left, right, top, bottom);
          if (m === left) px = b.min.x - RADIUS;
          else if (m === right) px = b.max.x + RADIUS;
          else if (m === top) pz = b.min.z - RADIUS;
          else pz = b.max.z + RADIUS;
        }
      }
    }
    px = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, px));
    pz = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, pz));
    return [px, pz];
  }

  /** riding: the ride moves you from the keys (W/S push, A/D turn), the camera comes along */
  private rideUpdate(dt: number, ride: Ride) {
    const k = this.keys;
    const on = this.enabled;
    const forward = on ? (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) : 0;
    const turn = on ? (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) : 0;
    this.steering = forward !== 0 || turn !== 0;
    const x0 = this.pos.x;
    const z0 = this.pos.y;
    ride.drive(dt, forward, turn, k.has('ShiftLeft') || k.has('ShiftRight') || this.runLatch);
    const moved = Math.hypot(this.pos.x - x0, this.pos.y - z0);
    this.moving = moved > 0.0015;
    this.speed = moved / Math.max(dt, 1e-3);
    this.vy = 0;
    this.grounded = true;
    this.windT = -1;
    this.dip = 0;
    this.updateCamera(dt);
  }

  update(dt: number) {
    if (this.ride) return this.rideUpdate(dt, this.ride);
    let fx = 0;
    let fz = 0;
    if (this.enabled) {
      const k = this.keys;
      const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      if (this.mode === 'top') {
        fx = s;
        fz = -f;
      } else {
        const fwdX = -Math.sin(this.yaw);
        const fwdZ = -Math.cos(this.yaw);
        const rtX = Math.cos(this.yaw);
        const rtZ = -Math.sin(this.yaw);
        fx = fwdX * f + rtX * s;
        fz = fwdZ * f + rtZ * s;
      }
    }
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.runLatch;
    this.steering = fx !== 0 || fz !== 0;
    let vx = 0;
    let vz = 0;
    const len = Math.hypot(fx, fz);
    if (len > 0.01) {
      const sp = sprint ? SPRINT : WALK;
      vx = (fx / len) * sp;
      vz = (fz / len) * sp;
    } else if (this.path && this.path.length) {
      const target = this.path[0];
      const dx = target.x - this.pos.x;
      const dz = target.y - this.pos.y;
      const d = Math.hypot(dx, dz);
      if (d < 0.12) {
        this.path.shift();
        if (!this.path.length) this.path = null;
      } else {
        const sp = Math.min(this.pathRun ? JOG : WALK, d / Math.max(dt, 1e-3));
        vx = (dx / d) * sp;
        vz = (dz / d) * sp;
      }
    }
    const before = this.pos.clone();
    this.floorY = this.grounded ? this.y : this.groundAt(this.pos.x, this.pos.y, this.y);
    if (vx || vz) {
      const [nx, nz] = this.collide(this.pos.x + vx * dt, this.pos.y + vz * dt);
      // a raised edge (landing side, top of a wall of steps) is a wall unless you're up there already
      if (this.groundAt(nx, nz, this.y) - this.y > 0.45) {
        if (this.groundAt(nx, this.pos.y, this.y) - this.y <= 0.45) this.pos.x = nx;
        else if (this.groundAt(this.pos.x, nz, this.y) - this.y <= 0.45) this.pos.y = nz;
      } else this.pos.set(nx, nz);
      // stuck on a path segment → drop the path
      if (this.path && this.pos.distanceTo(before) < 0.002) this.path = null;
    }
    // vertical: stairs/landings follow the ground, jumps and drops use gravity
    const ground = this.groundAt(this.pos.x, this.pos.y, this.y);
    if (this.windT >= 0 && this.grounded) this.windT = -1; // (put down by something else mid push-off)
    this.landT += dt;
    if (this.windT >= 0) {
      // pushing off: the feet stay on the floor (following it up or down a stair) until the legs have extended
      this.windT -= dt;
      if (ground < this.y - 0.3) {
        this.windT = -1; // stepped off an edge mid push-off: just fall
      } else {
        this.y = ground;
        if (this.windT < 0) {
          // leave the floor, the rest of this frame already in the air
          const air = -this.windT;
          this.windT = -1;
          this.vy = JUMP_V - GRAVITY * air;
          this.y = ground + JUMP_V * air - 0.5 * GRAVITY * air * air;
        }
      }
    } else if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= ground) {
        this.y = ground;
        this.impact = -this.vy;
        this.landT = 0;
        this.vy = 0;
        this.grounded = true;
      }
    } else if (ground < this.y - 0.3) {
      this.grounded = false; // walked off a ledge
      this.vy = 0;
    } else this.y = ground;
    const moved = this.pos.distanceTo(before);
    this.moving = moved > 0.0015;
    this.speed = moved / Math.max(dt, 1e-3);
    if (this.moving) {
      // third-person/top-down: the body turns toward where it is going (strafing or backing up
      // with the camera fixed would otherwise slide a forward walk cycle sideways)
      const targetYaw = Math.atan2(this.pos.x - before.x, this.pos.y - before.y);
      if (this.mode !== 'first') this.facing = lerpAngle(this.facing, targetYaw, Math.min(1, dt * (this.mode === 'third' ? 9 : 12)));
    }
    if (this.mode === 'first') this.facing = this.yaw + Math.PI;
    this.dip = this.jumpDip();
    this.updateCamera(dt);
  }

  /**
   * First person: the eyes sink a little as the legs dip for a push-off, and as the knees take a
   * landing (deeper the harder it was: ~4 cm for a jump, up to 9 cm off a high step), down in
   * ~0.07 s and back up over ~0.25 s. On the move the hidden avatar's own head motion (World's head
   * bob) carries its landing absorb already, so this fades out with speed.
   */
  private jumpDip(): number {
    let dip = 0;
    if (this.windT >= 0 && this.windLen > 0) dip = 0.03 * Math.sin(Math.PI * Math.min(1, 1 - this.windT / this.windLen));
    const lt = this.landT;
    const tc = 0.07;
    const tr = 0.2 + 0.02 * this.impact;
    if (lt < tc + tr) {
      const depth = Math.min(0.09, Math.max(0.02, 0.014 * this.impact));
      dip = Math.max(dip, depth * (lt < tc ? Math.sin((Math.PI / 2) * (lt / tc)) : 0.5 * (1 + Math.cos((Math.PI * (lt - tc)) / tr))));
    }
    return dip * (this.headBob ? 1 - Math.min(1, this.speed / 1.4) : 1);
  }

  private updateCamera(dt: number) {
    const cam = this.camera;
    if (this.mode === 'first' && this.ride) {
      // seated: the eye where the avatar's eyes are (body frame: x to its left, z ahead), no walking bob
      const e = this.ride.eye;
      const s = Math.sin(this.facing);
      const c = Math.cos(this.facing);
      cam.position.set(this.pos.x + s * e.z + c * e.x, this.y + e.y, this.pos.y + c * e.z - s * e.x);
      cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      return;
    }
    if (this.mode === 'first') {
      let bobY = 0;
      let bobX = 0;
      if (this.headBob) {
        bobY = this.headBob.y;
        bobX = this.headBob.x;
      } else {
        this.bob += this.moving ? dt * this.speed * 2.2 : 0;
        bobY = this.moving ? Math.sin(this.bob * 2) * 0.025 : 0;
      }
      const rtX = Math.cos(this.yaw);
      const rtZ = -Math.sin(this.yaw);
      cam.position.set(this.pos.x + rtX * bobX, this.y + EYE + bobY - this.dip, this.pos.y + rtZ * bobX);
      // the head rolls a little with the side-to-side sway of a run
      cam.rotation.set(this.pitch, this.yaw, -bobX * 0.35, 'YXZ');
      return;
    }
    if (this.mode === 'third') {
      const pitch = Math.max(-0.9, Math.min(0.75, this.pitch));
      const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(this.yaw) * Math.cos(pitch));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const pivot = new THREE.Vector3(this.pos.x, this.y + (this.ride ? this.ride.pivot : 1.62), this.pos.y).addScaledVector(right, 0.5);
      // Pull the camera in if a wall, the floor, a stair podium or the ceiling is between the shoulder
      // and the desired position. The ceiling counts as a wall: the camera never rises through the roof
      // indoors. Outdoors (no ceiling) it stays under THIRD_MAX_HEIGHT, so it never becomes a bird's-eye view.
      let dist = this.thirdDist;
      for (let d = 0.3; d <= this.thirdDist; d += 0.1) {
        const p = pivot.clone().addScaledVector(fwd, -d);
        // (the floor and ceiling of the storey you are on: floors.ts answers per storey)
        const floor = this.groundAt(p.x, p.z, this.y);
        const ceiling = Math.min(this.ceilingAt(p.x, p.z) - 0.18, floor + THIRD_MAX_HEIGHT);
        if (this.insideCollider(p.x, p.z, 0.12, p.y) || p.y < floor + 0.25 || p.y > ceiling) {
          dist = Math.max(0.35, d - 0.15);
          break;
        }
      }
      const desired = pivot.clone().addScaledVector(fwd, -dist);
      if (!this.camInit) {
        this.camPos.copy(desired);
        this.camInit = true;
      } else this.camPos.lerp(desired, Math.min(1, dt * 14));
      cam.position.copy(this.camPos);
      cam.rotation.set(pitch, this.yaw, 0, 'YXZ');
      return;
    }
    // top-down
    const h = this.topZoom;
    const back = h / Math.tan(TOP_PITCH);
    const desired = new THREE.Vector3(this.pos.x, h, this.pos.y + back);
    if (!this.camInit) {
      this.camPos.copy(desired);
      this.camInit = true;
    } else this.camPos.lerp(desired, Math.min(1, dt * 6));
    cam.position.copy(this.camPos);
    cam.rotation.set(-TOP_PITCH, 0, 0, 'YXZ');
  }

  private insideCollider(x: number, z: number, pad: number, y?: number) {
    for (const b of this.cameraBlockers) {
      // (walls of another storey don't stop the boom)
      if (y !== undefined && (y < b.min.y - pad || y > b.max.y + pad)) continue;
      if (x > b.min.x - pad && x < b.max.x + pad && z > b.min.z - pad && z < b.max.z + pad) return true;
    }
    return false;
  }

  dispose() {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.listeners = [];
    if (this.locked) this.unlock();
    this.dom.classList.remove('top-mode', 'cursor-mode', 'mouse-look');
  }
}

export function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
