/**
 * People moving: footsteps for the player and every walking NPC (soft soles on sheet vinyl indoors,
 * gritty asphalt outside, harder concrete in the stair core; heavier when running or landing a
 * jump), and the automatic sliding doors, whose operators whir open when someone comes within
 * reach and close again a few seconds after the last person has passed.
 */
import { roomAt, type LayoutDef } from '../../../shared/layout';
import { onUpperFloor } from '../../../shared/floors';
import type { NpcView } from '../../../shared/types';
import { Emitter, dB, type Engine, type Vec3 } from './engine';
import { footstep, mulberry, slidingDoor, type Surface } from './synth';

/** steps per second at a speed (m/s): ~1.9 walking at 1.3 m/s, ~2.8 running at 5 m/s */
export function cadence(speed: number): number {
  return Math.max(1.6, Math.min(2.9, 1.55 + 0.25 * speed));
}

const VARIANTS = 6;
const LEVEL = { player: dB(-31), npc: dB(-29), run: dB(4), door: dB(-24) };
const NPC_RANGE = 14;

interface Walker {
  em?: Emitter;
  x: number;
  z: number;
  phase: number;
  seen: number;
}

interface Door {
  pos: Vec3;
  exterior: boolean;
  open: boolean;
  clearSince: number;
  em: Emitter;
  /** who is in the sensor field (debug) */
  by: string;
}

export interface PlayerPose {
  x: number;
  z: number;
  /** feet height (stairs, jumps) */
  y: number;
  grounded: boolean;
  /** rolling in a wheelchair: no footsteps (the doors still open) */
  rolling?: boolean;
}

export class Movement {
  private walkers = new Map<string, Walker>();
  private me = { x: NaN, z: NaN, phase: 0.5, airborneSince: 0, grounded: true };
  private meEm: Emitter;
  private doors: Door[] = [];
  private rand = mulberry(29);
  private last = 0;
  private steps = new Map<string, (() => AudioBuffer)[]>();
  private meMoving = false;
  private doorOpenBuf: () => AudioBuffer;
  private doorCloseBuf: () => AudioBuffer;

  constructor(private eng: Engine, private layout: LayoutDef) {
    const sr = eng.sr;
    for (const s of ['vinyl', 'asphalt', 'concrete'] as Surface[])
      for (const heavy of [false, true])
        this.steps.set(`${s}:${heavy}`, Array.from({ length: VARIANTS }, (_, k) => eng.sound(`step:${s}:${heavy ? 'h' : 'n'}:${k}`, () => footstep(sr, mulberry(100 + k * 7 + (heavy ? 3 : 0)), s, heavy))));
    this.doorOpenBuf = eng.sound('door:open', () => slidingDoor(sr, mulberry(31), true));
    this.doorCloseBuf = eng.sound('door:close', () => slidingDoor(sr, mulberry(37), false));
    this.meEm = new Emitter(eng, { x: 0, y: 0, z: 0 }, { occlude: false, ref: 1, rolloff: 0, range: 1e9 });
    for (const r of layout.rooms) {
      for (const d of r.doors) {
        if (d.kind !== 'sliding') continue;
        const along = d.offset + d.width / 2;
        const x = d.side === 'n' || d.side === 's' ? r.rect.x + along : d.side === 'w' ? r.rect.x : r.rect.x + r.rect.w;
        const z = d.side === 'e' || d.side === 'w' ? r.rect.z + along : d.side === 'n' ? r.rect.z : r.rect.z + r.rect.d;
        const pos = { x, y: 2.4, z };
        if (this.doors.some((o) => Math.hypot(o.pos.x - x, o.pos.z - z) < 0.5)) continue; // shared by two rooms
        this.doors.push({ pos, exterior: !!d.exterior, open: false, clearSince: 0, by: '', em: new Emitter(eng, pos, { ref: 1.2, rolloff: 1.4, range: 22 }) });
      }
    }
  }

  private surface(x: number, z: number, y: number): Surface {
    // an upper storey or an elevator car (shared/floors.ts): sheet vinyl, not the stairs' concrete
    if (onUpperFloor(this.layout, x, z, y)) return 'vinyl';
    const r = roomAt(this.layout, x, z);
    const inside = x >= 0 && x <= this.layout.width && z >= 0 && z <= this.layout.depth;
    if (r ? r.kind === 'exterior' : !inside) return 'asphalt';
    if (r?.id === 'stairs' || y > 0.12) return 'concrete';
    return 'vinyl';
  }

  private step(em: Emitter, x: number, z: number, y: number, gain: number, heavy: boolean, when = 0): void {
    const s = this.surface(x, z, y);
    const buf = this.steps.get(`${s}:${heavy}`)![Math.floor(this.rand() * VARIANTS)]();
    if (em.play(buf, when, { gain: gain * (0.8 + 0.3 * this.rand()) * (heavy ? LEVEL.run : 1), rate: 0.94 + 0.12 * this.rand() })) this.eng.count(em === this.meEm ? 'step.player' : `step.npc`);
  }

  frame(perfNow: number, me: PlayerPose, eachNpc: (fn: (v: NpcView, x: number, z: number, headY: number, moving: boolean) => void) => void): void {
    const dt = Math.min(0.25, Math.max(0, perfNow - this.last));
    this.last = perfNow;
    const l = this.eng.listener;
    // ── the player's own steps, from just below the listener ──
    this.meEm.setPosition({ x: l.x, y: l.y - 1.45, z: l.z }, true);
    this.meEm.update();
    if (Number.isFinite(this.me.x) && dt > 0) {
      const d = Math.hypot(me.x - this.me.x, me.z - this.me.z);
      const speed = d / dt;
      if (me.grounded && !this.me.grounded && perfNow - this.me.airborneSince > 0.25) {
        // landing a jump: both feet
        this.step(this.meEm, me.x, me.z, me.y, LEVEL.player, true);
        this.step(this.meEm, me.x, me.z, me.y, LEVEL.player * 0.7, true, this.eng.now + 0.05);
        this.me.phase = 0.5;
      } else if (me.grounded && d < 2 && speed > 0.3 && !me.rolling) {
        this.me.phase += dt * cadence(speed);
        if (this.me.phase >= 1) {
          this.me.phase -= Math.floor(this.me.phase);
          this.step(this.meEm, me.x, me.z, me.y, LEVEL.player, speed > 3.2);
        }
      } else if (speed <= 0.3) this.me.phase = 0.5;
      this.meMoving = speed > 0.3 && d < 2;
    }
    if (!me.grounded && this.me.grounded) this.me.airborneSince = perfNow;
    this.me.x = me.x;
    this.me.z = me.z;
    this.me.grounded = me.grounded;
    // ── NPCs ──
    const people: { x: number; z: number; id: string; moving: boolean }[] = [{ x: me.x, z: me.z, id: 'player', moving: this.meMoving }];
    eachNpc((v, x, z, _headY, moving) => {
      if (!v.visible) return;
      people.push({ x, z, id: v.id, moving });
      let w = this.walkers.get(v.id);
      if (!w) {
        w = { x, z, phase: this.rand(), seen: perfNow };
        this.walkers.set(v.id, w);
      }
      const d = Math.hypot(x - w.x, z - w.z);
      const speed = dt > 0 ? d / dt : 0;
      w.x = x;
      w.z = z;
      w.seen = perfNow;
      const near = Math.hypot(x - l.x, z - l.z) < NPC_RANGE;
      if (!moving || d > 2 || speed < 0.3 || !near) {
        if (!near && w.em && !w.em.busy) {
          w.em.dispose();
          w.em = undefined;
        }
        return;
      }
      w.em ??= new Emitter(this.eng, { x, y: 0.1, z }, { ref: 1, rolloff: 1.5, range: NPC_RANGE });
      w.em.setPosition({ x, y: 0.1, z });
      w.em.update();
      w.phase += dt * cadence(speed);
      if (w.phase >= 1) {
        w.phase -= Math.floor(w.phase);
        this.step(w.em, x, z, 0, LEVEL.npc, speed > 2.4);
      }
    });
    for (const [id, w] of this.walkers) {
      if (perfNow - w.seen > 2) {
        w.em?.dispose();
        this.walkers.delete(id);
      }
    }
    // ── sliding doors ──
    for (const door of this.doors) {
      door.em.update();
      // motion sensors open for someone approaching within ~1.5 m; the threshold sensor holds it for
      // anyone standing in the opening (not for someone waiting nearby)
      const who = people.find((p) => {
        const d = Math.hypot(p.x - door.pos.x, p.z - door.pos.z);
        return d < 0.8 || (d < 1.5 && p.moving);
      });
      door.by = who?.id ?? '';
      if (who) {
        door.clearSince = 0;
        if (!door.open) {
          door.open = true;
          this.eng.count('door.open');
          door.em.play(this.doorOpenBuf(), 0, { gain: LEVEL.door * (0.9 + 0.2 * this.rand()) });
        }
      } else if (door.open) {
        door.clearSince ||= perfNow;
        if (perfNow - door.clearSince > 2.8) {
          door.open = false;
          door.em.play(this.doorCloseBuf(), 0, { gain: LEVEL.door * 0.85 });
        }
      }
    }
  }

  /** door states, for tests and the debug hook */
  doorStates(): { x: number; z: number; open: boolean; exterior: boolean; by: string }[] {
    return this.doors.map((d) => ({ x: d.pos.x, z: d.pos.z, open: d.open, exterior: d.exterior, by: d.by }));
  }

  /** an exterior door standing open at (about) this position */
  doorOpenAt(pos: Vec3): boolean {
    return this.doors.some((d) => d.open && Math.hypot(d.pos.x - pos.x, d.pos.z - pos.z) < 1);
  }

  dispose(): void {
    this.meEm.dispose();
    for (const w of this.walkers.values()) w.em?.dispose();
    for (const d of this.doors) d.em.dispose();
    this.walkers.clear();
  }
}
