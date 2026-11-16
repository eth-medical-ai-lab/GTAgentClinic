/**
 * A player that plays like a person, for the browser checks that must not take shortcuts
 * (tests/interact-audit-e2e.ts, tests/playthrough-e2e.ts).
 *
 * Acting is input only: the mouse looks (pointer lock: a click on the 3D view captures it, then
 * relative moves turn the head, 0.0023 rad a pixel; with the tablet open, click-and-drag on the
 * view, 0.0042 rad a pixel: controls.ts), WASD/Shift walk, E/F/G/M/Esc/P are keys, panels are
 * clicked and typed into. The debug teleports (`__acWorld.teleport*`) are used only to set up the
 * start of a test segment, and every use goes into the step log as "setup".
 *
 * Reading is what a person could see or know: the HUD prompt and panels on screen, and positions
 * (`__acWorld.state()`, `npc()`, `listItems()`, `focus()`, `floors()`). For what no debug getter
 * lists (every interactable with its box, the nav grid to plan a walk, the camera), installReader()
 * takes read-only references to the world's own objects out of createWorld's closure through the
 * DevTools protocol (no game code changed) and parks them on window.__acRead. Nothing there is ever
 * called to make something happen: only getters and pure planning (NavGrid.findPath).
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright';

export type V3 = [number, number, number];
export interface Box {
  min: V3;
  max: V3;
}

/** pointer lock: radians per pixel of mouse movement; drag-to-look (tablet open) likewise (controls.ts) */
const LOCK_K = 0.0023;
const DRAG_K = 0.0042;
/** the controller clamps the pitch here (controls.ts) */
const PITCH_MIN = -1.35;
const PITCH_MAX = 1.25;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const wrap = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** the view yaw that looks along (dx, dz) (the controller looks along −sin yaw, −cos yaw) */
export const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);

// ───────────────────────────── step log ─────────────────────────────

export interface Step {
  /** ms since the log started */
  t: number;
  at: string;
  kind: 'input' | 'setup' | 'see' | 'check' | 'finding' | 'note' | 'error';
  text: string;
}

/** a timestamped log of what the player did and saw (written as it goes, so a crash keeps it) */
export class StepLog {
  readonly t0 = Date.now();
  readonly steps: Step[] = [];
  constructor(private file?: string, private quiet = false) {
    if (file) writeFileSync(file, '');
  }
  add(kind: Step['kind'], text: string): Step {
    const s: Step = { t: Date.now() - this.t0, at: new Date().toISOString(), kind, text };
    this.steps.push(s);
    const line = `${fmtT(s.t)}  ${kind.padEnd(7)} ${text}`;
    if (this.file) appendFileSync(this.file, line + '\n');
    if (!this.quiet || kind === 'finding' || kind === 'error' || kind === 'check') console.log(line);
    return s;
  }
}
export const fmtT = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${((ms % 60000) / 1000).toFixed(1).padStart(4, '0')}`;

// ───────────────────────────── the read-only bridge ─────────────────────────────

/** what installReader() parks on window.__acRead (references into the running world, read only) */
const READ_VARS = ['built', 'items', 'amenities', 'hygiene', 'wheelchair', 'npcs', 'floors', 'curtains', 'ws', 'nav', 'controller', 'camera', 'care', 'layout', 'THREE'];

/**
 * Takes read-only references to the world's objects out of createWorld's closure (DevTools
 * protocol: the [[Scopes]] of a debug hook's function) and puts them on window.__acRead. Call it
 * again after a reload (it checks).
 */
export async function installReader(page: Page): Promise<void> {
  const fresh = await page.evaluate(() => {
    const w = window as unknown as { __acRead?: { world: unknown }; __acWorld?: unknown };
    return !!w.__acRead && w.__acRead.world === w.__acWorld;
  });
  if (fresh) return;
  const cdp = await page.context().newCDPSession(page);
  try {
    const fn = (await cdp.send('Runtime.evaluate', { expression: '__acWorld.focus' })).result;
    if (!fn.objectId) throw new Error('no __acWorld (?debug=1)');
    const props = await cdp.send('Runtime.getProperties', { objectId: fn.objectId, ownProperties: false });
    const scopesId = props.internalProperties?.find((p) => p.name === '[[Scopes]]')?.value?.objectId;
    if (!scopesId) throw new Error('no [[Scopes]] on __acWorld.focus');
    const scopes = (await cdp.send('Runtime.getProperties', { objectId: scopesId, ownProperties: true })).result;
    const found = new Map<string, string>();
    for (const s of scopes) {
      if (!s.value?.objectId) continue;
      const vars = (await cdp.send('Runtime.getProperties', { objectId: s.value.objectId, ownProperties: true })).result;
      for (const v of vars) if (READ_VARS.includes(v.name) && v.value?.objectId && !found.has(v.name)) found.set(v.name, v.value.objectId);
    }
    const missing = READ_VARS.filter((n) => !found.has(n));
    if (missing.length) throw new Error(`world closure: missing ${missing.join(', ')}`);
    const names = [...found.keys()];
    const win = (await cdp.send('Runtime.evaluate', { expression: 'window' })).result.objectId!;
    await cdp.send('Runtime.callFunctionOn', {
      objectId: win,
      functionDeclaration: `function(${names.join(',')}) { this.__acRead = Object.freeze({ world: this.__acWorld, ${names.join(',')} }); }`,
      arguments: names.map((n) => ({ objectId: found.get(n)! })),
    });
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

// ───────────────────────────── the player ─────────────────────────────

export interface St {
  x: number;
  z: number;
  y: number;
  yaw: number;
  pitch: number;
  /** the camera (eye) */
  cx: number;
  cy: number;
  cz: number;
  moving: boolean;
  speed: number;
  level: number;
  room: string | null;
}

export interface WalkOpts {
  /** stop within this distance of the goal (m) */
  arrive?: number;
  /** run (Shift) on long straight legs */
  run?: boolean;
  /** give up after this long (ms) */
  timeout?: number;
  /** waypoints instead of planning (stairs, elevator cars: places the floor's nav grid doesn't cover) */
  via?: { x: number; z: number }[];
  /** what to call it in the log */
  name?: string;
}

/**
 * The player's hands and eyes: input only, reading what is on screen and where things are.
 */
export class Human {
  /** the virtual mouse (pointer lock: only differences matter, so it may wander off screen) */
  private mx = 640;
  private my = 360;
  private held = new Set<string>();
  constructor(
    readonly page: Page,
    readonly log: StepLog,
    readonly view = { width: 1280, height: 720 },
  ) {
    this.mx = view.width / 2;
    this.my = view.height / 2;
  }

  // ── reading ──

  async st(): Promise<St> {
    return this.page.evaluate(() => {
      const w = window as unknown as { __acWorld: { state(): Record<string, number> }; __acRead: { camera: { position: { x: number; y: number; z: number } }; floors: { viewLevel: number; roomAt(x: number, z: number): string } } };
      const s = w.__acWorld.state();
      const c = w.__acRead.camera.position;
      return { x: s.x, z: s.z, y: s.y, yaw: s.yaw, pitch: s.pitch, cx: c.x, cy: c.y, cz: c.z, moving: !!s.moving, speed: s.speed, level: w.__acRead.floors.viewLevel, room: w.__acRead.floors.roomAt(s.x, s.z) };
    });
  }

  /** the HUD's center prompt, as on screen ("[E] Talk to …"), or null */
  prompt(): Promise<string | null> {
    return this.page.evaluate(() => document.querySelector('.hud-prompt')?.textContent ?? null);
  }

  /** the world's focus (the key names what the crosshair is on) */
  focus(): Promise<{ key: string; label: string } | null> {
    return this.page.evaluate(() => (window as unknown as { __acWorld: { focus(): { key: string; label: string } | null } }).__acWorld.focus());
  }

  /** the hint line at the bottom of the 3D view, when shown */
  hint(): Promise<string | null> {
    return this.page.evaluate(() => {
      const el = document.querySelector('.wl-hint') as HTMLElement | null;
      return el && Number(getComputedStyle(el).opacity) > 0.05 ? el.textContent : null;
    });
  }

  /** what the game takes from the mouse now: 'lock' (captured), 'free' (not captured: a click captures it), 'drag' (tablet open), 'none' */
  async lookMode(): Promise<'lock' | 'free' | 'drag' | 'none'> {
    return this.page.evaluate(() => {
      const c = (window as unknown as { __acRead: { controller: { enabled: boolean; walkOnly: boolean; mode: string } } }).__acRead.controller;
      if (!c.enabled || c.mode === 'top') return 'none';
      if (c.walkOnly) return 'drag';
      return document.pointerLockElement ? 'lock' : 'free';
    });
  }

  // ── keys ──

  async press(key: string, why = '') {
    this.log.add('input', `press ${key}${why ? ` (${why})` : ''}`);
    await this.page.keyboard.press(key);
  }
  async down(key: string) {
    if (this.held.has(key)) return;
    this.held.add(key);
    await this.page.keyboard.down(key);
  }
  async up(key: string) {
    if (!this.held.has(key)) return;
    this.held.delete(key);
    await this.page.keyboard.up(key);
  }
  async releaseAll() {
    for (const k of [...this.held]) await this.up(k);
  }
  /** hold a key for ms (a step, a strafe) */
  async hold(key: string, ms: number, why = '') {
    this.log.add('input', `hold ${key} ${ms} ms${why ? ` (${why})` : ''}`);
    await this.down(key);
    await sleep(ms);
    await this.up(key);
  }

  // ── looking ──

  /** capture the mouse with a click on the 3D view (only when it isn't captured: a click then would interact) */
  async capture(): Promise<boolean> {
    if ((await this.lookMode()) !== 'free') return (await this.lookMode()) === 'lock';
    const pt = await this.viewPoint();
    if (!pt) return false;
    await this.page.mouse.move(pt.x, pt.y);
    this.mx = pt.x;
    this.my = pt.y;
    for (let attempt = 0; attempt < 3; attempt++) {
      this.log.add('input', 'click the 3D view (capture the mouse to look around)');
      await this.page.mouse.down();
      await this.page.mouse.up();
      for (let i = 0; i < 20; i++) {
        const m = await this.lookMode();
        if (m === 'lock') return true;
        if (m !== 'free') return false;
        await sleep(25);
      }
      // (the browser refuses a re-capture right after one was let go: try again in a moment)
      await sleep(700);
    }
    return false;
  }

  /** a point on the bare 3D view (not on a panel or HUD element), for a click or a drag */
  private async viewPoint(dx = 0): Promise<{ x: number; y: number } | null> {
    const W = this.view.width;
    const H = this.view.height;
    const cands: [number, number][] = [
      [W / 2, H / 2],
      [W * 0.35, H * 0.5],
      [W * 0.3, H * 0.62],
      [W * 0.45, H * 0.38],
      [W * 0.25, H * 0.45],
      [W * 0.55, H * 0.7],
    ];
    // a drag of dx pixels must stay on the view: start where it fits
    if (dx) cands.unshift([dx > 0 ? W * 0.12 : W * 0.6, H * 0.55], [dx > 0 ? W * 0.18 : W * 0.55, H * 0.42]);
    for (const [x, y] of cands) {
      const ok = await this.page.evaluate(([px, py]) => {
        const el = document.elementFromPoint(px, py) as HTMLElement | null;
        return !!el && el.classList.contains('wl-input');
      }, [x, y] as [number, number]);
      if (ok && x + dx >= 4 && x + dx <= W - 4) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
  }

  /** turn the head by (dyaw, dpitch) radians with the mouse; false if the game takes no look input now */
  async turn(dyaw: number, dpitch: number): Promise<boolean> {
    let mode = await this.lookMode();
    if (mode === 'free') mode = (await this.capture()) ? 'lock' : 'free';
    if (mode === 'lock') {
      const dx = Math.round(-dyaw / LOCK_K);
      const dy = Math.round(-dpitch / LOCK_K);
      if (!dx && !dy) return true;
      // a hand on a mouse: a quick, smooth movement (a few events per tens of pixels)
      const steps = clamp(Math.ceil(Math.hypot(dx, dy) / 30), 1, 24);
      this.mx += dx;
      this.my += dy;
      await this.page.mouse.move(this.mx, this.my, { steps });
      return true;
    }
    if (mode === 'drag') {
      let dx = Math.round(-dyaw / DRAG_K);
      const dy = Math.round(-dpitch / DRAG_K);
      if (!dx && !dy) return true;
      // long turns as several drags (each must stay on the 3D view, left of the tablet)
      let dyLeft = dy;
      while (dx !== 0 || dyLeft !== 0) {
        const part = clamp(dx, -420, 420);
        const py = clamp(dyLeft, -200, 200);
        const from = await this.viewPoint(part);
        if (!from) return false;
        await this.page.mouse.move(from.x, from.y);
        await this.page.mouse.down();
        if (Math.abs(part) + Math.abs(py) < 7) {
          // a short correction still has to be a drag (under 5 px of travel it is a click: it would interact)
          await this.page.mouse.move(from.x + part, from.y + py + 5);
          await this.page.mouse.move(from.x + part, from.y + py);
        } else await this.page.mouse.move(from.x + part, from.y + py, { steps: clamp(Math.ceil(Math.hypot(part, py) / 30), 2, 16) });
        await this.page.mouse.up();
        dx -= part;
        dyLeft -= py;
      }
      return true;
    }
    return false;
  }

  /** turn to look at yaw/pitch (radians), closed loop on what the view says */
  async face(yaw: number, pitch: number, tol = 0.004): Promise<boolean> {
    pitch = clamp(pitch, PITCH_MIN + 0.01, PITCH_MAX - 0.01);
    for (let i = 0; i < 6; i++) {
      const s = await this.st();
      const dy = wrap(yaw - s.yaw);
      const dp = pitch - s.pitch;
      if (Math.abs(dy) < tol && Math.abs(dp) < tol) return true;
      if (!(await this.turn(dy, dp))) return false;
      await sleep(30);
    }
    const s = await this.st();
    return Math.abs(wrap(yaw - s.yaw)) < tol * 3 && Math.abs(pitch - s.pitch) < tol * 3;
  }

  /** put the crosshair on a point in the world (from wherever the eye is) */
  async aimAt(p: V3, tol = 0.004): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
      const s = await this.st();
      const dx = p[0] - s.cx;
      const dy = p[1] - s.cy;
      const dz = p[2] - s.cz;
      const yaw = yawTo(dx, dz);
      const pitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), PITCH_MIN + 0.01, PITCH_MAX - 0.01);
      const ey = wrap(yaw - s.yaw);
      const ep = pitch - s.pitch;
      if (Math.abs(ey) < tol && Math.abs(ep) < tol) return true;
      if (!(await this.turn(ey, ep))) return false;
      await sleep(30);
    }
    return false;
  }

  // ── walking ──

  /** a route from here to (x, z) on the storey's own nav grid (read only: NavGrid.findPath is pure) */
  async plan(x: number, z: number): Promise<{ x: number; z: number }[] | null> {
    return this.page.evaluate(
      ([tx, tz]) => {
        const R = (window as unknown as { __acRead: { controller: { pos: { x: number; y: number } }; floors: { navFor(): { findPath(a: number, b: number, c: number, d: number): { x: number; y: number }[] | null } | null }; nav: { findPath(a: number, b: number, c: number, d: number): { x: number; y: number }[] | null } } }).__acRead;
        const nv = R.floors.navFor() ?? R.nav;
        const p = nv.findPath(R.controller.pos.x, R.controller.pos.y, tx, tz);
        return p ? p.map((v) => ({ x: v.x, z: v.y })) : null;
      },
      [x, z] as [number, number],
    );
  }

  /**
   * Walk to (x, z) like a person: look toward the next waypoint (mouse), hold W, correct the heading
   * on the way, slow down (short steps) near the goal, and re-plan when stuck. True when there.
   */
  async walkTo(x: number, z: number, opts: WalkOpts = {}): Promise<boolean> {
    const arrive = opts.arrive ?? 0.35;
    const t0 = Date.now();
    const timeout = opts.timeout ?? 40000;
    let route = opts.via ? [...opts.via, { x, z }] : await this.plan(x, z);
    if (!route) {
      this.log.add('note', `no route to (${x.toFixed(2)}, ${z.toFixed(2)}): walking straight at it`);
      route = [{ x, z }];
    }
    const s0 = await this.st();
    this.log.add('input', `walk${opts.name ? ` to ${opts.name}` : ''} (${x.toFixed(1)}, ${z.toFixed(1)}) from (${s0.x.toFixed(1)}, ${s0.z.toFixed(1)}): ${route.length} leg(s), mouse to steer + W`);
    let i = 0;
    let lastProgress = Date.now();
    let best = Infinity;
    let replans = 0;
    let sidestep = 1;
    try {
      while (i < route.length) {
        if (Date.now() - t0 > timeout) {
          this.log.add('note', `walk timed out ${(timeout / 1000).toFixed(0)} s`);
          return false;
        }
        const wp = route[i];
        const last = i === route.length - 1;
        const s = await this.st();
        const d = Math.hypot(wp.x - s.x, wp.z - s.z);
        if (d < (last ? arrive : 0.45)) {
          i++;
          best = Infinity;
          lastProgress = Date.now();
          continue;
        }
        // stuck: no progress for a while → stop, re-plan from here (then a side step)
        if (d < best - 0.05) {
          best = d;
          lastProgress = Date.now();
        } else if (Date.now() - lastProgress > 1300) {
          await this.up('KeyW');
          await this.up('ShiftLeft');
          replans++;
          this.log.add('note', `stuck at (${s.x.toFixed(2)}, ${s.z.toFixed(2)}), ${d.toFixed(2)} m from the waypoint: ${replans % 2 ? 're-planning' : 'side step'}`);
          if (replans > 6) return false;
          if (replans % 2 === 0) {
            await this.hold(sidestep > 0 ? 'KeyD' : 'KeyA', 350, 'side step round it');
            sidestep = -sidestep;
          }
          if (!opts.via) {
            const r = await this.plan(x, z);
            if (r) {
              route = r;
              i = 0;
            }
          }
          best = Infinity;
          lastProgress = Date.now();
          continue;
        }
        const want = yawTo(wp.x - s.x, wp.z - s.z);
        const err = wrap(want - s.yaw);
        if (Math.abs(err) > 0.7) {
          // a sharp turn: stop and look the new way first
          await this.up('KeyW');
          await this.up('ShiftLeft');
          await this.turn(err, -0.08 - s.pitch);
          await sleep(30);
          continue;
        }
        // keep the head on the waypoint as you go (and the eyes a little down, as one walks)
        if (Math.abs(err) > 0.02 || Math.abs(s.pitch + 0.08) > 0.06) await this.turn(err * 0.85, -0.08 - s.pitch);
        if (last && d < 1.0) {
          // nearly there: short steps
          await this.up('ShiftLeft');
          await this.up('KeyW');
          const ms = clamp(((d - arrive * 0.6) / 2.1) * 1000, 40, 300);
          await this.down('KeyW');
          await sleep(ms);
          await this.up('KeyW');
          await sleep(60);
          continue;
        }
        if (opts.run && d > 4 && Math.abs(err) < 0.25) await this.down('ShiftLeft');
        else await this.up('ShiftLeft');
        await this.down('KeyW');
        await sleep(45);
      }
      return true;
    } finally {
      await this.up('KeyW');
      await this.up('ShiftLeft');
      const s = await this.st().catch(() => null);
      if (s) this.log.add('see', `stopped at (${s.x.toFixed(2)}, ${s.z.toFixed(2)}) y ${s.y.toFixed(2)} · ${s.room ?? '?'}${Math.hypot(s.x - x, s.z - z) > arrive + 0.1 ? ` · ${Math.hypot(s.x - x, s.z - z).toFixed(2)} m short` : ''}`);
    }
  }

  // ── setup (not play) ──

  /** debug teleport for the start of a test segment (logged as setup, never used to perform the action under test) */
  async teleport(x: number, z: number, y: number, yawDeg: number, pitchDeg: number, why: string) {
    this.log.add('setup', `teleport (${x.toFixed(2)}, ${z.toFixed(2)}, y ${y}) facing ${yawDeg.toFixed(0)}°: ${why}`);
    await this.releaseAll();
    await this.page.evaluate(([a, b, c, d, e]) => (window as unknown as { __acWorld: { teleportY(x: number, z: number, y: number, yaw: number, pitch: number): void } }).__acWorld.teleportY(a, b, c, d, e), [x, z, y, yawDeg, pitchDeg] as [number, number, number, number, number]);
  }

  async shot(path: string) {
    await this.page.screenshot({ path });
    this.log.add('note', `screenshot ${path}`);
  }
}

/** the world's yaw convention for a teleport (degrees; the body faces yawDeg, the view looks the same way) */
export const teleportYawDeg = (viewYaw: number) => ((viewYaw + Math.PI) * 180) / Math.PI;
