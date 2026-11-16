/**
 * NPC walking (client/src/world/pathfinding.ts NPC layer + steering.ts), headless:
 * - routes never enter blocked cells and keep 0.3 m from furniture and people, with no sharp
 *   corners and bounded turning per metre
 * - walkers keep a capped turn rate and eased speed, pass each other keeping right, wait for and
 *   then re-plan round someone in the way
 * - the waiting room's called patients (the real choreography, server/sim/ambient.ts) keep 0.3 m
 *   from every chair and person, and reach the nurse before she greets them
 * - about 30 walkers steer in well under 0.5 ms a frame
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LAYOUTS } from '../shared/layout';
import { NPC_CLEARANCE, ROUTE_DS, routeAt, type Disc, type Route } from '../client/src/world/pathfinding';
import { NpcSteering, type SteerNpc } from '../client/src/world/steering';
import { routeLength, routeWalkSecs } from '../server/sim/route';
import { walkSecs } from '../server/sim/ambient';
import { navWorld } from './navWorld';
import { callScenes, WaitingRoomSim } from './navSim';

const world = navWorld(LAYOUTS.ed);
const nav = world.grid.npcLayer(world.footprints);

/** a small deterministic PRNG */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    s = Math.imul(s ^ (s >>> 13), 3266489909) >>> 0;
    return ((s ^ (s >>> 16)) >>> 0) / 4294967296;
  };
}

/** a random free spot in the ED's west half (hub, waiting room, triage, fast track, bays) */
function freeSpot(rand: () => number): [number, number] {
  for (;;) {
    const x = 0.5 + rand() * 34;
    const z = 0.5 + rand() * 23;
    if (nav.cellFree(x, z, false) && nav.clearance(x, z) >= 0.36) return [x, z];
  }
}

/** points along a route's main part (not the steps out of / into a seat or obstacle), every 1 cm, exactly on its curve */
function* along(r: Route): Generator<[number, number, number]> {
  const p = { x: 0, z: 0, tx: 0, tz: 0 };
  for (let s = r.head; s <= Math.min(r.tail, r.length); s += 0.01) {
    routeAt(r, s, p);
    yield [p.x, p.z, s];
  }
}

class Npc implements SteerNpc {
  v: SteerNpc['v'];
  pos: THREE.Vector2;
  ch = { posture: 'stand' };
  path: unknown[] | null = null;
  constructor(id: string, x: number, z: number, public yaw = 0, role = 'visitor') {
    this.v = { id, posture: 'stand', role };
    this.pos = new THREE.Vector2(x, z);
  }
}

/** World.stepNpcs in miniature: everyone steps, arrivals stop */
function run(steer: NpcSteering, npcs: Npc[], secs: number, each?: (t: number) => void, dt = 1 / 60) {
  for (let t = 0; t < secs; t += dt) {
    steer.update(dt, npcs, null);
    for (const n of npcs) {
      if (!n.path) continue;
      if (steer.step(n, dt).arrived) n.path = null;
    }
    each?.(t);
  }
}

describe('NPC routes (pathfinding.ts NPC layer)', () => {
  const rand = rng(7);
  const routes: { r: Route; people: Disc[] }[] = [];
  for (let k = 0; k < 220; k++) {
    const [sx, sz] = freeSpot(rand);
    const [tx, tz] = freeSpot(rand);
    // a few people standing about, never on the start or the goal
    const people: Disc[] = [];
    while (people.length < 8) {
      const [px, pz] = freeSpot(rand);
      if (Math.hypot(px - sx, pz - sz) > 0.9 && Math.hypot(px - tx, pz - tz) > 0.9) people.push({ x: px, z: pz, r: 0.25 });
    }
    const r = nav.route(sx, sz, tx, tz, { people });
    if (r) routes.push({ r, people });
  }

  it('finds routes between free spots', () => {
    expect(routes.length).toBeGreaterThan(200);
  });

  it('never enters a blocked cell, and keeps 0.3 m from furniture, walls and people', () => {
    let blocked = '';
    let worst = Infinity;
    let worstPeople = Infinity;
    for (const { r, people } of routes) {
      for (const [x, z] of along(r)) {
        if (!blocked && !nav.cellFree(x, z, false)) blocked = `${x.toFixed(3)},${z.toFixed(3)}`;
        worst = Math.min(worst, nav.clearance(x, z));
        for (const p of people) worstPeople = Math.min(worstPeople, Math.hypot(x - p.x, z - p.z) - p.r);
      }
    }
    expect(blocked, 'a point in a blocked cell').toBe('');
    expect(worst).toBeGreaterThanOrEqual(NPC_CLEARANCE - 0.002);
    expect(worstPeople).toBeGreaterThanOrEqual(NPC_CLEARANCE - 0.002);
  });

  it('turns smoothly: rounded corners (no kinks), turning per metre bounded', () => {
    let sharp = 0;
    let maxK = 0;
    let maxPerM = 0;
    for (const { r } of routes) {
      const i0 = Math.ceil(r.head / ROUTE_DS) + 1;
      const i1 = Math.floor(Math.min(r.tail, r.length) / ROUTE_DS) - 1;
      for (let i = i0 + 1; i <= i1; i++) {
        const turn = Math.acos(Math.max(-1, Math.min(1, r.tx[i] * r.tx[i - 1] + r.tz[i] * r.tz[i - 1])));
        // a kink: the heading changes more than the arcs there explain (+3°)
        if (turn > Math.max(r.k[i], r.k[i - 1]) * ROUTE_DS * 1.02 + 0.05) sharp++;
        maxK = Math.max(maxK, turn / ROUTE_DS);
      }
      // over any metre of the main part, no more than a half turn (a jog round a bed end is two quarter turns)
      for (let a = i0; a + 10 <= i1; a += 2) {
        let sum = 0;
        for (let i = a + 1; i <= a + 10; i++) sum += Math.acos(Math.max(-1, Math.min(1, r.tx[i] * r.tx[i - 1] + r.tz[i] * r.tz[i - 1])));
        maxPerM = Math.max(maxPerM, sum);
        expect(sum, 'turning within one metre').toBeLessThanOrEqual(Math.PI + 0.05);
      }
      // every corner got an arc of 0.22–0.8 m
      for (const rad of r.radii) expect(rad === 0 || (rad >= 0.22 && rad <= 0.8)).toBe(true);
    }
    expect(sharp).toBe(0);
    // curvature ≤ 1 / 0.22 m
    expect(maxK).toBeLessThanOrEqual(1 / 0.22 + 0.05);
    console.log(`routes: ${routes.length}, max curvature ${maxK.toFixed(2)} rad/m (${((maxK * 180) / Math.PI).toFixed(0)}°/m), max turning in a metre ${((maxPerM * 180) / Math.PI).toFixed(0)}°`);
    const arcs = routes.flatMap(({ r }) => r.radii);
    expect(arcs.filter((x) => x === 0).length / Math.max(1, arcs.length)).toBeLessThan(0.02);
    // mostly the generous radii
    expect(arcs.filter((x) => x >= 0.4).length / Math.max(1, arcs.length)).toBeGreaterThan(0.8);
  });

  it('routes out of a seat go straight out of its front, and into one end at its approach point', () => {
    const chair = LAYOUTS.ed.props.find((p) => p.id === 'w_chair_a2')!;
    const meet = { x: 4.3, z: 16.55 };
    const out = nav.route(chair.x, chair.z, meet.x, meet.z, { fromSeat: { x: chair.x, z: chair.z, rot: 0 } })!;
    expect(out.head).toBeGreaterThan(0.5);
    // the first step is straight forward (+z for this row)
    expect(Math.abs(out.tx[1])).toBeLessThan(0.01);
    expect(out.tz[1]).toBeGreaterThan(0.99);
    const back = nav.route(meet.x, meet.z, chair.x, chair.z, { seat: { x: chair.x, z: chair.z, rot: 0 } })!;
    expect(Math.hypot(back.end.x - chair.x, back.end.z - (chair.z + 0.62))).toBeLessThan(0.02);
  });
});

describe('steering (steering.ts)', () => {
  it('a walker eases in and out, turns no faster than its cap, and stays on free floor', () => {
    const rand = rng(11);
    const steer = new NpcSteering(world.grid, world.footprints);
    let maxRate = 0;
    let maxAcc = 0;
    let worst = Infinity;
    for (let k = 0; k < 25; k++) {
      const [sx, sz] = freeSpot(rand);
      const [tx, tz] = freeSpot(rand);
      const n = new Npc(`w${k}`, sx, sz, rand() * 6);
      steer.walk(n, { x: tx, z: tz }, { pace: 1.3, face: 0 });
      n.path = [];
      let yaw = n.yaw;
      let px = sx;
      let pz = sz;
      let v = 0;
      run(steer, [n], 40, () => {
        const dy = Math.abs(Math.atan2(Math.sin(n.yaw - yaw), Math.cos(n.yaw - yaw)));
        maxRate = Math.max(maxRate, dy * 60);
        yaw = n.yaw;
        const sp = Math.hypot(n.pos.x - px, n.pos.y - pz) * 60;
        // (the last few cm/s onto the spot are a stop, not braking)
        if (sp > 0.06 || v > 0.06) maxAcc = Math.max(maxAcc, Math.abs(sp - v) * 60);
        v = sp;
        px = n.pos.x;
        pz = n.pos.y;
        const r = steer.routeOf(n.v.id);
        if (n.path && r && !r.fallback) worst = Math.min(worst, nav.clearance(n.pos.x, n.pos.y));
      });
      expect(n.path, `walker ${k} arrived`).toBeNull();
      expect(Math.hypot(n.pos.x - tx, n.pos.y - tz)).toBeLessThan(0.05);
      expect(Math.abs(Math.atan2(Math.sin(n.yaw), Math.cos(n.yaw)))).toBeLessThan(0.06);
    }
    expect(maxRate).toBeLessThanOrEqual(4.6);
    // speed changes: ≤ 1 m/s² up, ≤ 2.4 m/s² down (plus a frame's rounding)
    expect(maxAcc).toBeLessThan(2.6);
    expect(worst).toBeGreaterThanOrEqual(NPC_CLEARANCE - 0.02);
  });

  it('two people meeting head-on in the corridor keep right and pass with room to spare', () => {
    const steer = new NpcSteering(world.grid, world.footprints);
    // the hub corridor south of the nurses' station: x 14 … 30, z ≈ 13.8
    const a = new Npc('a_walker', 14, 13.8, Math.PI / 2);
    const b = new Npc('b_walker', 30, 13.8, -Math.PI / 2);
    steer.walk(a, { x: 30, z: 13.8 }, { pace: 1.3 });
    steer.walk(b, { x: 14, z: 13.8 }, { pace: 1.3 });
    a.path = [];
    b.path = [];
    let minD = Infinity;
    let aSide = 0;
    run(steer, [a, b], 25, () => {
      const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y);
      if (d < minD) {
        minD = d;
        // a walks +x: its right is +z… (right of (1, 0) is (−0, 1))
        aSide = a.pos.y - b.pos.y;
      }
    });
    expect(a.path).toBeNull();
    expect(b.path).toBeNull();
    // centre to centre ≥ two bodies (0.5 m) + 0.15 m
    expect(minD).toBeGreaterThan(0.65);
    // a passed b with b on its left: a is on the +z side (its right)
    expect(aSide).toBeGreaterThan(0.3);
  });

  it('waits for someone standing in the way, then re-plans round them', () => {
    const steer = new NpcSteering(world.grid, world.footprints);
    // the waiting room's aisle between the two rows of chairs; someone stands in the middle of it
    const w = new Npc('walker', 1.4, 19.55, Math.PI / 2);
    const s = new Npc('stander', 3.2, 19.55, -Math.PI / 2);
    steer.walk(w, { x: 6.4, z: 19.55 }, { pace: 1.25 });
    w.path = [];
    let minD = Infinity;
    let t = 0;
    run(steer, [w, s], 20, (tt) => {
      t = tt;
      minD = Math.min(minD, Math.hypot(w.pos.x - s.pos.x, w.pos.y - s.pos.y));
      if (!w.path && t > 1) return;
    });
    expect(w.path).toBeNull();
    expect(Math.hypot(w.pos.x - 6.4, w.pos.y - 19.55)).toBeLessThan(0.05);
    // never closer than 0.3 m from the stander's footprint (r 0.25)
    expect(minD - 0.25).toBeGreaterThanOrEqual(NPC_CLEARANCE - 0.01);
  });

  it('about 30 walkers steer in well under 0.5 ms a frame (spatial hash)', () => {
    const rand = rng(5);
    const steer = new NpcSteering(world.grid, world.footprints);
    const npcs: Npc[] = [];
    for (let k = 0; k < 30; k++) {
      const [x, z] = freeSpot(rand);
      npcs.push(new Npc(`p${k}`, x, z, rand() * 6));
    }
    // a few minutes of people criss-crossing (each sent somewhere new on arrival)
    const dt = 1 / 60;
    const times: number[] = [];
    for (let f = 0; f < 60 * 20; f++) {
      for (const n of npcs) {
        if (n.path) continue;
        const [x, z] = freeSpot(rand);
        steer.walk(n, { x, z }, { pace: 1.1 + rand() * 0.4 });
        n.path = [];
      }
      steer.update(dt, npcs, null);
      const t0 = performance.now();
      for (const n of npcs) if (n.path && steer.step(n, dt).arrived) n.path = null;
      times.push(performance.now() - t0);
    }
    const st = steer.stats();
    // the steering's own measure: hash + avoidance + integration, planning apart
    expect(st.meanWalkers).toBeGreaterThan(20);
    expect(st.meanMs).toBeLessThan(0.5);
    expect(st.p95Ms).toBeLessThan(1.0);
    expect(st.failed).toBe(0);
  });
});

describe('the called patient walks the aisle (waiting room choreography)', () => {
  const seeds = [1, 2, 3, 42, 99, 2024, 31337];

  it('keeps ≥ 0.3 m from every chair and every person, and reaches the nurse before she greets', () => {
    let n = 0;
    for (const seed of seeds) {
      const { plan, scale, scenes } = callScenes(seed);
      for (const c of scenes.slice(0, 3)) {
        const sim = new WaitingRoomSim(plan, scale);
        sim.run(c.tUp - 1.5, Math.min(c.t1, c.tUp + 40), { scene: c.scene });
        const own = LAYOUTS.ed.props.find((p) => p.kind === 'chair' && Math.hypot(p.x - c.seat.at.x, p.z - c.seat.at.z) < 0.05);
        const cl = sim.clearances(c.id, c.tUp, own);
        expect(cl.chair, `seed ${seed} ${c.id}: ${cl.chairAt}`).toBeGreaterThanOrEqual(0.3);
        expect(cl.person, `seed ${seed} ${c.id}: ${cl.personAt}`).toBeGreaterThanOrEqual(0.3);
        // at the meet spot, a step in front of the nurse, before her greeting
        const greet = plan.lines.filter((l) => l.scene === c.scene.id && l.who === 'nurse')[1];
        const at = sim.frames.find((f) => {
          const p = f.pos.get(c.id);
          return p && f.t > c.tUp && Math.hypot(p.x - 4.3, p.z - 16.55) < 0.05;
        });
        expect(at, `seed ${seed} ${c.id} reaches the nurse`).toBeDefined();
        expect(at!.t, `seed ${seed} ${c.id} arrives before the greeting`).toBeLessThanOrEqual(greet.t / scale + 0.25);
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(seeds.length * 2);
  });

  it('the server times the walk to the nurse on the route round the rows, never shorter than before', () => {
    const MEET = { x: 4.3, z: 16.55, rot: Math.PI };
    for (const c of LAYOUTS.ed.props.filter((p) => p.kind === 'chair' && p.room === 'waiting' && !/desk/.test(p.id))) {
      const r = c.rot ?? 0;
      const up = { x: c.x + Math.sin(r) * 0.72, z: c.z + Math.cos(r) * 0.72, rot: r };
      expect(routeWalkSecs(LAYOUTS.ed, up, MEET, 1.25)).toBeGreaterThanOrEqual(walkSecs(up, MEET, 1.25));
      // the client's route is within ~20 % of the server's estimate
      const client = nav.route(up.x, up.z, MEET.x, MEET.z)!;
      const server = routeLength(LAYOUTS.ed, up, MEET).length;
      expect(Math.abs(server - client.length) / client.length, c.id).toBeLessThan(0.2);
    }
  });
});
