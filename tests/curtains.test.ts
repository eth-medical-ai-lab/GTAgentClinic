/**
 * Bay curtains (client/src/world/curtains.ts), headless, with the real NPC steering (steering.ts) on
 * the ED's nav grid (tests/navWorld.ts) plus the curtains' doorway walls:
 * - privacy rules: a bay with its patient in bed is closed, an empty bay open, a critical patient open
 * - a nurse walking into a closed bay stops at the curtain, pulls it open, steps in and draws it
 *   closed behind her; walking out again she does the same; nobody crosses a curtain line where the
 *   fabric hangs (every position, every frame, against the curtain's edge at that moment)
 * - late or urgent: the hand goes out on the move, no stop, still never through the fabric
 * - an empty bay's open curtain is walked through without a pull
 * - a curtain closing stops short of someone standing in the doorway; the cloth's gliders keep the
 *   fabric between them (gathered ≥ 2.8 cm, never stretched past the 17.5 cm of fabric)
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAYOUTS } from '../shared/layout';
import type { PlayerView } from '../shared/types';
import { NavGrid } from '../client/src/world/pathfinding';
import { NpcSteering } from '../client/src/world/steering';
import { CARRIERS, CurtainSim, Curtains, GAP, PASS, curtainDefs, type CurtainNpc } from '../client/src/world/curtains';
import { navWorld } from './navWorld';

const L = LAYOUTS.ed;
const DT = 1 / 60;

class Npc implements CurtainNpc {
  v: { id: string; posture: string; role: string; location: string; visible: boolean };
  pos: THREE.Vector2;
  path: unknown[] | null = null;
  ch = { posture: 'stand', root: new THREE.Object3D() };
  animAcc = 0;
  constructor(id: string, role: string, location: string, x: number, z: number, public yaw = 0, posture = 'stand') {
    this.v = { id, role, location, visible: true, posture };
    this.ch.posture = posture;
    this.pos = new THREE.Vector2(x, z);
  }
}

function view(o: { monitors?: Record<string, unknown>; board?: unknown[] } = {}): PlayerView {
  return { board: o.board ?? [], monitors: o.monitors ?? {}, settings: { timeScale: 1 } } as unknown as PlayerView;
}

/** a world: bays with patients in bed (given), the nav grid with the curtains' doorway walls, steering wired to them */
function setup(patients: string[], v: PlayerView = view()) {
  const nw = navWorld(L);
  const npcs: Npc[] = [];
  const byId = new Map<string, Npc>();
  const add = (n: Npc) => {
    npcs.push(n);
    byId.set(n.v.id, n);
    return n;
  };
  for (const bay of patients) {
    const r = L.rooms.find((x) => x.id === bay)!;
    add(new Npc(`pt_${bay}`, 'patient', bay, r.spots.bed.x, r.spots.bed.z, 0, 'lie'));
  }
  const curtains = new Curtains(curtainDefs(L).map((def) => ({ def, view: null })), { npcs: () => npcs, npc: (id) => byId.get(id), player: () => null, audit: true });
  const grid = new NavGrid([...nw.colliders, ...curtains.navBlockers], { minX: -1, maxX: L.width + 1, minZ: -1, maxZ: L.depth + 9 });
  const steer = new NpcSteering(grid, nw.footprints);
  steer.gate = curtains.gate;
  steer.gateFace = curtains.gateFace;
  curtains.view(v);
  const dbg = curtains.debugApi();
  const state = (id: string) => dbg.curtains().find((c) => c.id === id)!;
  /** World.frame in miniature: curtains, then everyone steps */
  const run = (secs: number, each?: (t: number) => void) => {
    for (let t = 0; t < secs; t += DT) {
      curtains.update(DT);
      steer.update(DT, npcs, null);
      for (const n of npcs) {
        if (!n.path) continue;
        if (steer.step(n, DT).arrived) n.path = null;
      }
      each?.(t);
    }
  };
  const walk = (n: Npc, x: number, z: number, face?: number) => {
    steer.walk(n, { x, z }, { pace: 1.3, face });
    n.path = [new THREE.Vector2(x, z)];
  };
  /** run until n arrives (or the time is up); seconds taken */
  const until = (n: Npc, max: number, each?: (t: number) => void) => {
    for (let t = 0; t < max; t += DT) {
      run(DT);
      each?.(t);
      if (!n.path) return t;
    }
    return max;
  };
  run(0.1);
  return { npcs, add, curtains, dbg, state, run, walk, until, steer };
}

const bay = (id: string) => L.rooms.find((r) => r.id === id)!;

describe('curtain lines (curtains.ts)', () => {
  const defs = curtainDefs(L);
  it('one curtain per curtained bay, doorway end at the west wall, track between the wall faces', () => {
    expect(defs.map((d) => d.id)).toEqual(['bed_1', 'bed_2', 'bed_3', 'bed_4', 'bed_5', 'bed_6']);
    for (const d of defs) {
      const r = bay(d.room);
      expect(d.ax).toBeCloseTo(r.rect.x + 0.12, 6);
      expect(d.az).toBeCloseTo(r.rect.z + r.rect.d - 0.06, 6);
      expect(d.span).toBeCloseTo(r.rect.w - 0.24, 6);
      expect([d.dx, d.dz, d.nx, d.nz]).toEqual([1, 0, 0, -1]);
    }
  });

  it('a drawn curtain leaves only its observation gap (too narrow to pass); gathered, the bay is open', () => {
    const sim = new CurtainSim({ def: defs[2], view: null });
    sim.snap(sim.eClosed);
    expect(sim.e).toBeCloseTo(GAP, 6);
    expect(GAP).toBeGreaterThan(0.18);
    expect(GAP).toBeLessThan(0.32);
    for (let u = GAP + 0.01; u < defs[2].span; u += 0.05) expect(sim.covers(u)).toBe(true);
    sim.snap(sim.eOpen);
    expect(defs[2].span - sim.eOpen).toBeLessThan(0.7);
    expect(sim.covers(1.5)).toBe(false);
  });

  it('the gliders keep the fabric between them while it is pulled to and fro', () => {
    const sim = new CurtainSim({ def: defs[0], view: null });
    sim.snap(sim.eOpen);
    let minGap = Infinity;
    let maxGap = 0;
    for (const goal of [sim.eClosed, sim.eClosed + PASS, sim.eOpen, sim.eClosed]) {
      sim.command(goal);
      for (let k = 0; k < 240; k++) {
        sim.step(DT);
        for (let i = 0; i < CARRIERS - 1; i++) {
          const g = sim.c[i + 1] - sim.c[i];
          minGap = Math.min(minGap, g);
          maxGap = Math.max(maxGap, g);
        }
      }
      expect(sim.e).toBeCloseTo(goal, 2);
    }
    expect(minGap).toBeGreaterThan(0.0279);
    expect(maxGap).toBeLessThan(0.1751);
    // settled: it stops rewriting vertices
    for (let k = 0; k < 120; k++) sim.step(DT);
    expect(sim.awake).toBe(false);
  });
});

describe('privacy rules', () => {
  it('patient in bed: closed; empty bay: open; critical (high-priority alarm): open', () => {
    const w = setup(['bed_2', 'bed_3'], view({ monitors: { bed_3: { patientId: 'p', hr: 34, sbp: 64, dbp: 40, spo2: 81, rr: 30, rhythm: 'sinus' } } }));
    expect(w.state('bed_2').state).toBe('closed');
    expect(w.state('bed_3').state).toBe('open');
    expect(w.state('bed_4').state).toBe('open');
    expect(w.state('bed_2').rule).toBe('closed');
  });

  it('a crowd of staff at the bed (a resuscitation) opens it', () => {
    const w = setup(['bed_4']);
    expect(w.state('bed_4').state).toBe('closed');
    const r = bay('bed_4');
    for (let i = 0; i < 3; i++) w.add(new Npc(`rn${i}`, 'nurse', 'bed_4', r.rect.x + 0.9 + i * 0.9, 4.6));
    w.run(2.5);
    expect(w.state('bed_4').rule).toBe('open');
    expect(['open', 'opening']).toContain(w.state('bed_4').state);
  });
});

describe('NPCs and closed curtains', () => {
  /** the same walk into Bed 3 and out again: seconds in, seconds out, the curtain's widest opening */
  const inAndOut = (patient: boolean, mode: 'relaxed' | 'hurried') => {
    const w = setup(patient ? ['bed_3', 'bed_4'] : ['bed_4']);
    w.dbg.curtainMode(mode);
    const r = bay('bed_3');
    const rn = w.add(new Npc('rn_ana', 'nurse', 'hub', r.rect.x + 2.2, 9.6, Math.PI));
    const side = r.spots.bedside_l;
    const before = w.state('bed_3').state;
    w.dbg.curtainAudit(true);
    let maxEdge = 0;
    w.walk(rn, side.x, side.z, side.rot);
    const tIn = w.until(rn, 30, () => {
      maxEdge = Math.max(maxEdge, w.state('bed_3').edge);
    });
    const arrived = Math.hypot(rn.pos.x - side.x, rn.pos.y - side.z);
    w.run(3);
    const aIn = w.dbg.curtainAudit(true);
    const afterIn = w.state('bed_3').state;
    w.walk(rn, r.rect.x + 2.5, 9.8, Math.PI);
    const tOut = w.until(rn, 30);
    w.run(3);
    const aOut = w.dbg.curtainAudit();
    return { before, tIn, tOut, arrived, aIn, aOut, afterIn, afterOut: w.state('bed_3').state, maxEdge, outZ: rn.pos.y };
  };
  const plain = inAndOut(false, 'relaxed');

  it('the walk itself (empty bay, curtain open): no pull, no hold', () => {
    expect(plain.before).toBe('open');
    expect(plain.aIn.pulls + plain.aOut.pulls).toBe(0);
    expect(plain.aIn.violations).toEqual([]);
  });

  for (const mode of ['relaxed', 'hurried'] as const) {
    it(`a nurse goes in and out of a private bay through the curtain, never through the fabric (${mode})`, () => {
      const x = inAndOut(true, mode);
      expect(x.before).toBe('closed');
      // in: pulled open (about a metre), stepped through, drawn closed behind her; never through fabric
      expect(x.arrived).toBeLessThan(0.35);
      expect(x.aIn.violations).toEqual([]);
      expect(x.aIn.crossings).toBeGreaterThanOrEqual(1);
      expect(x.aIn.pulls).toBe(1);
      expect(x.aIn.closes).toBe(1);
      expect(x.maxEdge).toBeGreaterThan(GAP + 0.6);
      expect(x.maxEdge).toBeLessThan(GAP + PASS + 0.5);
      expect(x.afterIn).toBe('closed');
      // out again the same way
      expect(x.aOut.violations).toEqual([]);
      expect(x.aOut.pulls).toBe(1);
      expect(x.aOut.closes).toBe(1);
      expect(x.afterOut).toBe('closed');
      expect(x.outZ).toBeGreaterThan(9);
      // what the curtain costs a walk: stopping, pulling, stepping through, pulling closed (relaxed);
      // on the move (hurried: late or urgent)
      const extra = Math.max(x.tIn - plain.tIn, x.tOut - plain.tOut);
      expect(extra).toBeGreaterThan(mode === 'relaxed' ? 1.5 : 0.2);
      expect(extra).toBeLessThan(mode === 'relaxed' ? 4.5 : 1.8);
    });
  }

  it('an empty bay (open curtain) is walked through without a pull', () => {
    const w = setup([]);
    const r = bay('bed_5');
    expect(w.state('bed_5').state).toBe('open');
    const rn = w.add(new Npc('rn_li', 'nurse', 'hub', r.rect.x + 2, 9.5, Math.PI));
    w.dbg.curtainAudit(true);
    w.walk(rn, r.spots.bedside_l.x, r.spots.bedside_l.z, r.spots.bedside_l.rot);
    w.until(rn, 25);
    const a = w.dbg.curtainAudit();
    expect(a.violations).toEqual([]);
    expect(a.pulls).toBe(0);
    expect(w.state('bed_5').state).toBe('open');
  });

  it('two staff into the same private bay, one behind the other: one pull, closed after the last', () => {
    const w = setup(['bed_2']);
    w.dbg.curtainMode('relaxed');
    const r = bay('bed_2');
    const a1 = w.add(new Npc('rn_1', 'nurse', 'hub', r.rect.x + 1.6, 9.3, Math.PI));
    const a2 = w.add(new Npc('md_2', 'resident', 'hub', r.rect.x + 2.6, 10.6, Math.PI));
    w.dbg.curtainAudit(true);
    w.walk(a1, r.spots.bedside_l.x, r.spots.bedside_l.z, r.spots.bedside_l.rot);
    w.walk(a2, r.spots.foot.x, r.spots.foot.z, r.spots.foot.rot);
    w.run(30);
    const a = w.dbg.curtainAudit();
    expect(a.violations).toEqual([]);
    expect(a.pulls).toBeLessThanOrEqual(2);
    expect(w.state('bed_2').state).toBe('closed');
    expect(Math.hypot(a2.pos.x - r.spots.foot.x, a2.pos.y - r.spots.foot.z)).toBeLessThan(0.5);
  });

  it('closing stops short of someone standing in the doorway', () => {
    const w = setup(['bed_6']);
    const r = bay('bed_6');
    w.dbg.curtain('bed_6', 'snap-open');
    // someone standing on the line in the doorway end
    w.add(new Npc('vis', 'family', 'bed_6', r.rect.x + 0.75, 6.94));
    w.dbg.curtain('bed_6', 'closed');
    w.run(3);
    const c = w.state('bed_6');
    expect(c.edge).toBeGreaterThan(0.75 - 0.12 + 0.25);
  });
});
