import { PUSH_GAP } from '../../../shared/layout';
import { footprintDistance, routeAt, type Disc, type NpcNav, type Route } from './pathfinding';

type Point = { x: number; z: number; tx: number; tz: number };
export const STRETCHER_PUSH_GAP = 1.44;
const trailing: Point = { x: 0, z: 0, tx: 0, tz: 0 };

const wheelchairBody = [
  { name: 'wheelchair', offset: 0, r: 0.32 }, { name: 'footrests', offset: 0.40, r: 0.22 },
  { name: 'escorting nurse', offset: -PUSH_GAP, r: 0.24 },
];
const stretcherBody = [
  { name: 'head of trolley', offset: 0.76, r: 0.41 }, { name: 'trolley', offset: 0, r: 0.43 },
  { name: 'foot of trolley', offset: -0.76, r: 0.41 }, { name: 'ambulance crew', offset: -STRETCHER_PUSH_GAP, r: 0.24 },
];
const headings = new WeakMap<Route, Float32Array>();
const circle = Math.PI * 2;
const turn = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Swivel casters let the crew turn the trolley before a doorway or back it into position.
 * Work along the centreline, keeping only orientations reachable from the previous sample.
 * The caller then sweeps the resulting turns against the actual meshes' footprints. */
export function fitTransportHeadings(nav: NpcNav, route: Route, startYaw: number, endYaw: number, parked: Disc[], stretcher: boolean) {
  const bins = 32, angle = circle / bins;
  const steps = Math.max(1, Math.ceil(route.length / 0.16));
  const body = stretcher ? stretcherBody : wheelchairBody;
  const previous = new Int8Array((steps + 1) * bins).fill(-1);
  let costs = new Float64Array(bins);
  const p = { x: 0, z: 0, tx: 0, tz: 0 };
  const sin = Array.from({length: bins}, (_, i) => Math.sin(i * angle + startYaw));
  const cos = Array.from({length: bins}, (_, i) => Math.cos(i * angle + startYaw));
  for (let i = 0; i <= steps; i++) {
    routeAt(route, i * route.length / steps, p);
    const next = new Float64Array(bins).fill(Infinity);
    for (let h = 0; h < bins; h++) {
      const fits = body.every(b => {
        const x = p.x + b.offset * sin[h], z = p.z + b.offset * cos[h];
        return nav.clearance(x, z) >= b.r + 0.035 && !parked.some(o => Math.hypot(x-o.x, z-o.z) < o.r + b.r + 0.035);
      });
      if (!fits) continue;
      const facing = h * angle + startYaw;
      const deviation = 1 - (p.tx * sin[h] + p.tz * cos[h]);
      if (!i) { next[h] = 15 * Math.abs(turn(facing - startYaw)); continue; }
      for (let d = -2; d <= 2; d++) {
        const prev = (h + d + bins) % bins;
        const cost = costs[prev] + 0.7 * d * d + deviation + (i === steps ? 4 * Math.abs(turn(facing-endYaw)) : 0);
        if (cost < next[h]) { next[h] = cost; previous[i*bins+h] = prev; }
      }
    }
    if (!next.some(Number.isFinite)) return false;
    costs = next;
  }
  let best = costs.indexOf(Math.min(...costs));
  const result = new Float32Array(steps+1);
  for (let i = steps; i >= 0; i--) {
    result[i] = startYaw + best * angle;
    best = previous[i*bins+best];
  }
  headings.set(route, result);
  return true;
}

/** The chair turns with the pusher behind it on the same curve. An instantaneous tangent
 * at a tight corner swings the nurse off the route and can put them inside the door. */
export function dischargePose(route: Route, s: number, wheel: boolean, startYaw: number, out: Point, gap = PUSH_GAP) {
  routeAt(route, s, out);
  const turns = headings.get(route);
  if (turns) {
    const at = Math.max(0, Math.min(1, s / Math.max(0.001, route.length))) * (turns.length - 1);
    const i = Math.floor(at);
    const yaw = turns[i] + (at - i) * turn(turns[Math.min(i+1, turns.length-1)] - turns[i]);
    out.tx = Math.sin(yaw); out.tz = Math.cos(yaw);
    return;
  }
  if (!wheel) return;
  routeAt(route, Math.max(0, s - gap), trailing);
  const beforeStart = Math.max(0, gap - s);
  const dx = out.x - trailing.x + beforeStart * Math.sin(startYaw);
  const dz = out.z - trailing.z + beforeStart * Math.cos(startYaw);
  const length = Math.hypot(dx, dz);
  if (length > 0.001) {
    out.tx = dx / length;
    out.tz = dz / length;
  }
}

/** Sweep the whole exit, including corners between storyboard frames and the ends of the
 * route that ordinary NPC navigation exempts for sitting down/getting up. */
export function dischargeOverlap(nav: NpcNav, route: Route, wheel: boolean, startYaw: number, parked: Disc[], from = 0, stretcher = false): string | undefined {
  const p: Point = { x: 0, z: 0, tx: 0, tz: 0 };
  // Limit exact geometry checks to obstacles near this route.
  const pad = stretcher ? 1.8 : 1.2;
  const x0 = Math.min(...route.px) - pad, x1 = Math.max(...route.px) + pad;
  const z0 = Math.min(...route.pz) - pad, z1 = Math.max(...route.pz) + pad;
  const boxes = nav.grid.colliders.filter(b => !b.isEmpty() && b.min.y < 1.6 && b.max.y > 0.05 &&
    b.max.x >= x0 && b.min.x <= x1 && b.max.z >= z0 && b.min.z <= z1);
  const furniture = nav.footprints.filter(f => {
    const radius = Math.hypot(f.hw, f.hd);
    return f.x + radius >= x0 && f.x - radius <= x1 && f.z + radius >= z0 && f.z - radius <= z1;
  });
  const bodies = stretcher ? stretcherBody : wheel ? wheelchairBody : [{ name: 'walking patient', offset: 0, r: 0.25 }];
  const remaining = route.length - from;
  const steps = Math.max(1, Math.ceil(remaining / 0.04));
  for (let i = 0; i <= steps; i++) {
    const s = from + remaining * i / steps;
    dischargePose(route, s, wheel || stretcher, startYaw, p, stretcher ? STRETCHER_PUSH_GAP : PUSH_GAP);
    for (const body of bodies) {
      const x = p.x + body.offset * p.tx, z = p.z + body.offset * p.tz;
      const box = boxes.find(b => Math.hypot(Math.max(0, b.min.x - x, x - b.max.x), Math.max(0, b.min.z - z, z - b.max.z)) < body.r);
      const prop = !box && furniture.find(f => footprintDistance(f, x, z) < body.r);
      const chair = !box && !prop && parked.some(d => Math.hypot(x - d.x, z - d.z) < d.r + body.r);
      if (box || prop || chair) {
        const object = box ? ('name' in box ? box.name : 'wall or solid fixture') : prop ? (prop.name ?? 'furniture') : 'parked wheelchair';
        return `Overlap between ${body.name} and ${object} at (${x.toFixed(2)}, ${z.toFixed(2)}), ${s.toFixed(2)} m along exit route`;
      }
    }
  }
}
