/**
 * Hand-hygiene fixtures, placed by rule from a storey's rooms, doors and sinks (not by hand):
 *
 * - Every patient space (a bay, a resus room, triage, imaging, a room with a bed or an exam couch)
 *   gets an alcohol hand-rub dispenser on the corridor side of its entrance and one inside near it.
 *   - A curtained bay: its doorway is the start of the curtain run (the west end of a bay's front;
 *     curtains.ts keeps the observation gap there). Outside: on the nose of the partition between
 *     two bays, facing the corridor; where the corridor's own wall carries on past the corner (Bed 1),
 *     on that wall 35 cm out. Inside: on the side wall 1.2 m in from the curtain line (`rub_<bay>`).
 *   - A door: the latch side, 30 cm past the opening (a hinged leaf stands open inside at the hinge;
 *     a sliding door's leaves park inside, so the inside one goes beyond the parked leaf, or past
 *     the other end if the wall runs out). Hand-placed dispensers already there are kept (ex1_rub,
 *     ems_rub_1, Floor 2's corridor ones), and a sink's rub dispenser within 1.6 m of the doorway
 *     counts as the inside one.
 * - Every hand-wash sink gets, on the wall behind it (the room's wall or a partition, found along
 *   the sink's back): soap and alcohol rub side by side right of the tap, the glove box left of it,
 *   a paper-towel dispenser further left (right, when the left is taken) with a pedal bin under it.
 * - Masks: a respiratory-hygiene stand (sign, mask box, hand rub) inside the walk-in entrance, beside
 *   the door on its parked-leaf side; a mask box on the wall by the ambulance entrance; a box of masks
 *   on the nurses' station's end counter. The PPE outside a room on precautions is put up at run time
 *   (client/src/world/hygiene.ts) next to its corridor-side dispenser (`entrances()`).
 *
 * A spot is free when it's clear of door openings and their frames, parked sliding leaves, room
 * corners, wall-mounted props on the same face and the fixtures placed before it (`blocked`).
 * Ids: rub_<room>_out / rub_<room> (bays) / rub_<room>_in; <sink>_soap, _rub, _gloves, _towel, _bin;
 * mask_walkin, mask_ems, mask_station. Calling it again on a storey that has them returns them as
 * they are (nothing new): the client uses that for the entrances.
 */
import type { DoorDef, PropDef, PropKind, RoomDef, Side } from './layout';

const WALL_T = 0.12;
const PART_T = 0.1;
const PI = Math.PI;

/** body sizes (m): along the wall, up, out of it; y0 = the default height of the bottom */
export const FIXTURE_SIZE: Partial<Record<PropKind, { w: number; h: number; d: number; y0: number }>> = {
  handRub: { w: 0.11, h: 0.24, d: 0.1, y0: 1.1 },
  soapDispenser: { w: 0.11, h: 0.24, d: 0.1, y0: 1.12 },
  gloveHolder: { w: 0.27, h: 0.14, d: 0.12, y0: 1.3 },
  // (its slot at 1.2 m: the towel's tail hangs where a hand reaches it standing by the sink, not at the hip)
  towelDispenser: { w: 0.3, h: 0.38, d: 0.12, y0: 1.2 },
  maskBox: { w: 0.28, h: 0.17, d: 0.13, y0: 1.24 },
  pedalBin: { w: 0.28, h: 0.45, d: 0.3, y0: 0 },
};

/** sink frame (x across, z toward its front): where the wash station's parts go */
const SINK = { soap: 0.14, rub: 0.27, gloves: -0.2, towel: -0.58, towelRight: 0.62, binOut: 0.17 };

export interface HygieneEntrance {
  room: string;
  /** the corridor-side dispenser and the one inside (prop ids, positions, facing) */
  out?: Mount;
  in?: Mount;
  /** the outward normal of the entrance (from the room to the corridor) */
  nx: number;
  nz: number;
}

interface Mount {
  id: string;
  x: number;
  z: number;
  rot: number;
}

/** one face of a wall: the plane (x = c or z = c), which way it looks, and how far it runs */
interface Face {
  axis: 'x' | 'z';
  c: number;
  /** +1 / −1: the face looks toward +axis or −axis */
  n: 1 | -1;
  a0: number;
  a1: number;
  room?: string;
}

interface Box {
  face: Face;
  a0: number;
  a1: number;
  y0: number;
  y1: number;
}

const rotFor = (nx: number, nz: number) => Math.atan2(nx, nz);
const round = (v: number) => Math.round(v * 1000) / 1000;

/** start point, direction along the wall, length, inward normal (builder.ts sideFrame) */
function sideFrame(r: RoomDef, side: Side) {
  const { x, z, w, d } = r.rect;
  switch (side) {
    case 'n':
      return { sx: x, sz: z, dx: 1, dz: 0, len: w, nx: 0, nz: 1 };
    case 's':
      return { sx: x, sz: z + d, dx: 1, dz: 0, len: w, nx: 0, nz: -1 };
    case 'w':
      return { sx: x, sz: z, dx: 0, dz: 1, len: d, nx: 1, nz: 0 };
    case 'e':
      return { sx: x + w, sz: z, dx: 0, dz: 1, len: d, nx: -1, nz: 0 };
  }
}

const walled = (r: RoomDef, s: Side) => !r.openSides?.includes(s) && !r.curtainSides?.includes(s);

/** a room's wall face on one side, inner (the room side) or outer */
function face(r: RoomDef, side: Side, outer: boolean): Face {
  const f = sideFrame(r, side);
  const axis = f.nx !== 0 ? 'x' : 'z';
  const n = (f.nx !== 0 ? f.nx : f.nz) as 1 | -1;
  const at = axis === 'x' ? f.sx : f.sz;
  const a0 = axis === 'x' ? f.sz : f.sx;
  return { axis, c: outer ? at : at + n * WALL_T, n: (outer ? -n : n) as 1 | -1, a0, a1: a0 + f.len, room: r.id };
}

/** a point on a face at `along`, `out` metres in front of it */
function onFace(f: Face, along: number, out = 0): { x: number; z: number; rot: number } {
  const p = f.c + f.n * out;
  return f.axis === 'x' ? { x: p, z: along, rot: rotFor(f.n, 0) } : { x: along, z: p, rot: rotFor(0, f.n) };
}

const sameFace = (a: Face, b: Face) => a.axis === b.axis && a.n === b.n && Math.abs(a.c - b.c) < 0.03;

export const isPatientSpace = (r: RoomDef) =>
  r.kind === 'bay' || r.kind === 'resus' || r.kind === 'triage' || r.kind === 'imaging' || (r.kind === 'room' && (!!r.spots.bed || !!r.spots.exam));

export interface HygieneOptions {
  /** full-height partitions on the storey (shared/floors.ts PartitionDef), as wall faces */
  partitions?: { room: string; x1: number; z1: number; x2: number; z2: number }[];
  /** ground floor: the entrance mask stations and the station's box */
  masks?: boolean;
}

export interface HygienePlan {
  /** the fixtures this storey didn't have yet */
  props: PropDef[];
  entrances: HygieneEntrance[];
}

/** where a wall-mounted prop sits: the face behind it, the stretch it covers, how high */
function propBox(p: PropDef, faces: Face[]): Box | null {
  if ((p.y ?? 0) < 0.3 && p.kind !== 'pedalBin') return null;
  const rot = p.rot ?? 0;
  const nx = Math.round(Math.sin(rot));
  const nz = Math.round(Math.cos(rot));
  if (Math.abs(nx) + Math.abs(nz) !== 1) return null;
  const axis = nx !== 0 ? 'x' : 'z';
  const n = (nx !== 0 ? nx : nz) as 1 | -1;
  const c = axis === 'x' ? p.x : p.z;
  const along = axis === 'x' ? p.z : p.x;
  const fz = faces.find((f) => f.axis === axis && f.n === n && Math.abs(f.c - c) < 0.2 && along >= f.a0 - 0.01 && along <= f.a1 + 0.01);
  if (!fz) return null;
  const s = FIXTURE_SIZE[p.kind];
  const w = s?.w ?? p.w ?? 0.5;
  const h = s?.h ?? p.h ?? 0.5;
  const y = p.y ?? 0;
  // (signs and posters are placed by their middle or their bottom: take both)
  return { face: fz, a0: along - w / 2, a1: along + w / 2, y0: s ? y : y - h / 2, y1: y + h };
}

/**
 * The fixtures a storey still needs, and its entrances. `rooms`/`props`: the storey's own (the
 * ground floor: layout.rooms / layout.props).
 */
export function hygienePlan(rooms: RoomDef[], props: PropDef[], opts: HygieneOptions = {}): HygienePlan {
  const out: PropDef[] = [];
  const all = () => [...props, ...out];
  const byId = (id: string) => all().find((p) => p.id === id);
  // every wall face of the storey: room walls (both faces) and partitions
  const faces: Face[] = [];
  for (const r of rooms) {
    if (r.kind === 'exterior') continue;
    for (const s of ['n', 's', 'e', 'w'] as Side[]) if (walled(r, s)) faces.push(face(r, s, false), face(r, s, true));
  }
  for (const pt of opts.partitions ?? []) {
    const alongX = Math.abs(pt.z2 - pt.z1) < 1e-6;
    const axis = alongX ? 'z' : 'x';
    const c = alongX ? pt.z1 : pt.x1;
    const a0 = alongX ? Math.min(pt.x1, pt.x2) : Math.min(pt.z1, pt.z2);
    const a1 = alongX ? Math.max(pt.x1, pt.x2) : Math.max(pt.z1, pt.z2);
    faces.push({ axis, c: c + PART_T / 2, n: 1, a0, a1, room: pt.room }, { axis, c: c - PART_T / 2, n: -1, a0, a1, room: pt.room });
  }
  // what's on the walls already: props, the fixtures placed here, door openings and parked leaves
  const taken: Box[] = [];
  const doorBoxes = (r: RoomDef, d: DoorDef) => {
    const inner = face(r, d.side, false);
    const outer = face(r, d.side, true);
    const a = inner.a0 + d.offset;
    const b = a + d.width;
    for (const f of [inner, outer]) taken.push({ face: f, a0: a - 0.07, a1: b + 0.07, y0: 0, y1: 3 });
    // sliding leaves stand parked inside, beside the opening
    if (d.kind === 'sliding' && !d.pocket) for (const [p0, p1] of [[a - d.width / 2, a], [b, b + d.width / 2]]) taken.push({ face: inner, a0: p0 - 0.06, a1: p1 + 0.06, y0: 0, y1: 2.2 });
    // a hinged leaf stands open inside at its hinge (the start of the opening)
    if (d.kind === 'door' || d.kind === 'double') taken.push({ face: inner, a0: a - 0.25, a1: a + 0.05, y0: 0, y1: 2.2 });
    if (d.kind === 'double') taken.push({ face: inner, a0: b - 0.05, a1: b + 0.25, y0: 0, y1: 2.2 });
  };
  for (const r of rooms) for (const d of r.doors) doorBoxes(r, d);
  for (const p of props) {
    const b = propBox(p, faces);
    if (b) taken.push(b);
  }
  /** inside a wall (a room's walled side, or a partition): a face pressed against another room's wall is no place for anything */
  const inWall = (x: number, z: number) =>
    rooms.some((r) => {
      if (r.kind === 'exterior') return false;
      const { x: rx, z: rz, w, d } = r.rect;
      if (x < rx - 1e-3 || x > rx + w + 1e-3 || z < rz - 1e-3 || z > rz + d + 1e-3) return false;
      return (walled(r, 'n') && z < rz + WALL_T) || (walled(r, 's') && z > rz + d - WALL_T) || (walled(r, 'w') && x < rx + WALL_T) || (walled(r, 'e') && x > rx + w - WALL_T);
    }) ||
    (opts.partitions ?? []).some((pt) => x >= Math.min(pt.x1, pt.x2) - PART_T / 2 && x <= Math.max(pt.x1, pt.x2) + PART_T / 2 && z >= Math.min(pt.z1, pt.z2) - PART_T / 2 && z <= Math.max(pt.z1, pt.z2) + PART_T / 2);
  const blocked = (f: Face, a0: number, a1: number, y0: number, y1: number, corner = 0.15) => {
    if (a0 < f.a0 + (f.room ? WALL_T : 0) + corner || a1 > f.a1 - (f.room ? WALL_T : 0) - corner) return true;
    // the face has to be open air in front, at both ends of the fixture
    for (const a of [a0, a1]) {
      const p = onFace(f, a, 0.03);
      if (inWall(p.x, p.z)) return true;
    }
    return taken.some((t) => sameFace(t.face, f) && t.a0 < a1 && t.a1 > a0 && t.y0 < y1 && t.y1 > y0);
  };
  const place = (id: string, kind: PropKind, room: string, f: Face, along: number, y?: number, extra: Partial<PropDef> = {}): PropDef => {
    const s = FIXTURE_SIZE[kind]!;
    const at = onFace(f, along, kind === 'pedalBin' ? s.d / 2 + 0.02 : 0);
    const p: PropDef = { id, kind, room, x: round(at.x), z: round(at.z), y: kind === 'pedalBin' ? undefined : (y ?? s.y0), rot: round(at.rot), ...extra };
    out.push(p);
    const b = propBox(p, faces);
    if (b) taken.push(b);
    return p;
  };
  /** a free stretch for a fixture of width w near `along`, sliding away from `away` (±1) in 5 cm steps */
  const freeNear = (f: Face, along: number, w: number, y0: number, h: number, away: number, max = 1.0): number | null => {
    for (let k = 0; k <= max / 0.05; k++) {
      const a = along + away * k * 0.05;
      if (!blocked(f, a - w / 2, a + w / 2, y0, y0 + h)) return a;
    }
    return null;
  };
  const near = (kind: PropKind, x: number, z: number, r: number, room?: string) =>
    all().find((p) => p.kind === kind && Math.hypot(p.x - x, p.z - z) <= r && (!room || p.room === room));

  // ── sinks first (their rub dispenser can be a room's inside one) ──
  for (const sink of props.filter((p) => p.kind === 'sink')) {
    const room = rooms.find((r) => r.id === sink.room);
    if (!room) continue;
    const rot = sink.rot ?? 0;
    const bx = -Math.round(Math.sin(rot));
    const bz = -Math.round(Math.cos(rot));
    // the wall face right behind it: facing the sink, within 0.6 m of its middle
    const axis = bx !== 0 ? 'x' : 'z';
    const n = -(bx !== 0 ? bx : bz) as 1 | -1;
    const c0 = axis === 'x' ? sink.x : sink.z;
    const along0 = axis === 'x' ? sink.z : sink.x;
    const back = faces
      .filter((f) => f.axis === axis && f.n === n && along0 > f.a0 && along0 < f.a1 && (f.c - c0) * -n >= 0.2 && (f.c - c0) * -n <= 0.6)
      .sort((a, b) => Math.abs(a.c - c0) - Math.abs(b.c - c0))[0];
    if (!back) continue;
    // the sink's local x along that face
    const at = (lx: number) => along0 + sinkAlong(rot, axis) * lx;
    const ok = (kind: PropKind, lx: number) => {
      const s = FIXTURE_SIZE[kind]!;
      return !blocked(back, at(lx) - s.w / 2, at(lx) + s.w / 2, s.y0, s.y0 + s.h);
    };
    if (!byId(`${sink.id}_soap`) && ok('soapDispenser', SINK.soap)) place(`${sink.id}_soap`, 'soapDispenser', sink.room, back, at(SINK.soap));
    // (level with the soap: the two side by side)
    if (!byId(`${sink.id}_rub`) && ok('handRub', SINK.rub)) place(`${sink.id}_rub`, 'handRub', sink.room, back, at(SINK.rub), FIXTURE_SIZE.soapDispenser!.y0);
    if (!byId(`${sink.id}_gloves`) && ok('gloveHolder', SINK.gloves)) place(`${sink.id}_gloves`, 'gloveHolder', sink.room, back, at(SINK.gloves));
    if (!byId(`${sink.id}_towel`)) {
      const lx = ok('towelDispenser', SINK.towel) ? SINK.towel : ok('towelDispenser', SINK.towelRight) ? SINK.towelRight : null;
      if (lx !== null) {
        place(`${sink.id}_towel`, 'towelDispenser', sink.room, back, at(lx));
        // a pedal bin under it, unless a bin is already there
        const bin = onFace(back, at(lx), FIXTURE_SIZE.pedalBin!.d / 2 + 0.02);
        if (!byId(`${sink.id}_bin`) && !near('trash', bin.x, bin.z, 0.6) && !near('pedalBin', bin.x, bin.z, 0.6)) place(`${sink.id}_bin`, 'pedalBin', sink.room, back, at(lx));
      }
    }
  }

  // ── entrances of patient spaces ──
  const entrances: HygieneEntrance[] = [];
  const corridorRub = (f: Face, along: number, id: string, room: string): Mount | undefined => {
    const at = onFace(f, along);
    const have = all().find((p) => p.kind === 'handRub' && Math.hypot(p.x - at.x, p.z - at.z) < 0.8 && Math.abs(Math.sin(((p.rot ?? 0) - at.rot) / 2)) < 0.1);
    if (have) return { id: have.id, x: have.x, z: have.z, rot: have.rot ?? 0 };
    const s = FIXTURE_SIZE.handRub!;
    if (blocked(f, along - s.w / 2, along + s.w / 2, s.y0, s.y0 + s.h)) return undefined;
    const p = place(id, 'handRub', room, f, along);
    return { id: p.id, x: p.x, z: p.z, rot: p.rot ?? 0 };
  };
  for (const r of rooms.filter(isPatientSpace)) {
    const curtain = r.curtainSides?.[0];
    if (curtain) {
      // ── a curtained bay: the doorway is the start of the run ──
      const fr = sideFrame(r, curtain);
      const startSide: Side = curtain === 'n' || curtain === 's' ? 'w' : 'n';
      const outN = { x: -fr.nx, z: -fr.nz };
      const e: HygieneEntrance = { room: r.id, nx: outN.x, nz: outN.z };
      // outside: does a corridor's wall carry on past the corner, in line with our side wall?
      const sw = face(r, startSide, false);
      const corner = { x: fr.sx, z: fr.sz };
      const cornerAlong = sw.axis === 'x' ? corner.z : corner.x;
      const outAlong = sw.axis === 'x' ? outN.z : outN.x;
      const beyond = cornerAlong + outAlong * 0.3;
      const carry = faces.find((f) => f.room !== r.id && f.axis === sw.axis && f.n === sw.n && Math.abs(f.c - sw.c) < 0.01 && beyond >= f.a0 && beyond <= f.a1);
      if (carry) e.out = corridorRub(carry, cornerAlong + outAlong * 0.35, `rub_${r.id}_out`, carry.room ?? r.id);
      else {
        // the partition's nose, facing the corridor
        const nose: Face = { axis: outN.x !== 0 ? 'x' : 'z', c: outN.x !== 0 ? corner.x : corner.z, n: (outN.x !== 0 ? outN.x : outN.z) as 1 | -1, a0: -1e9, a1: 1e9 };
        const along = outN.x !== 0 ? corner.z : corner.x;
        e.out = corridorRub(nose, along, `rub_${r.id}_out`, r.id);
      }
      // inside: on the start side's wall, 1.2 m in from the curtain line
      e.in = corridorRub(sw, cornerAlong - outAlong * 1.2, `rub_${r.id}`, r.id);
      entrances.push(e);
      continue;
    }
    for (const d of r.doors) {
      if ((d.y ?? 0) > 0) continue;
      const inner = face(r, d.side, false);
      const outer = face(r, d.side, true);
      const fr = sideFrame(r, d.side);
      const e: HygieneEntrance = { room: r.id, nx: -fr.nx, nz: -fr.nz };
      const a = inner.a0 + d.offset;
      const b = a + d.width;
      const s = FIXTURE_SIZE.handRub!;
      // outside: the latch side, 30 cm past the opening (else the other side)
      const outAt = freeNear(outer, b + 0.3, s.w, s.y0, s.h, 1, 0.4) ?? freeNear(outer, a - 0.3, s.w, s.y0, s.h, -1, 0.4);
      const existingOut = all().find((p) => p.kind === 'handRub' && p.room !== r.id && Math.abs((outer.axis === 'x' ? p.x : p.z) - outer.c) < 0.05 && (outer.axis === 'x' ? p.z : p.x) > a - 0.9 && (outer.axis === 'x' ? p.z : p.x) < b + 0.9);
      if (existingOut) e.out = { id: existingOut.id, x: existingOut.x, z: existingOut.z, rot: existingOut.rot ?? 0 };
      else if (outAt !== null) {
        const corridor = rooms.find((o) => o.id !== r.id && o.kind !== 'exterior' && inRect(o, onFace(outer, outAt, 0.3)))?.id ?? r.id;
        e.out = corridorRub(outer, outAt, `rub_${r.id}_out`, corridor);
      }
      // inside: a dispenser within 1.6 m of the doorway already (a sink's)?
      const edgeDist = (p: PropDef) => {
        const along = inner.axis === 'x' ? p.z : p.x;
        const across = Math.abs((inner.axis === 'x' ? p.x : p.z) - inner.c);
        const da = along < a ? a - along : along > b ? along - b : 0;
        return Math.hypot(da, across);
      };
      const inside = all().find((p) => p.kind === 'handRub' && p.room === r.id && edgeDist(p) <= 1.6);
      if (inside) e.in = { id: inside.id, x: inside.x, z: inside.z, rot: inside.rot ?? 0 };
      else {
        const parked = d.kind === 'sliding' && !d.pocket ? d.width / 2 + 0.25 : 0.3;
        const inAt = freeNear(inner, b + parked, s.w, s.y0, s.h, 1, 0.5) ?? (d.kind === 'door' ? null : freeNear(inner, a - parked, s.w, s.y0, s.h, -1, 0.5));
        if (inAt !== null) e.in = corridorRub(inner, inAt, `rub_${r.id}_in`, r.id);
      }
      entrances.push(e);
    }
  }

  // ── masks: the walk-in entrance, the ambulance entrance, the nurses' station ──
  if (opts.masks) {
    for (const r of rooms) {
      for (const d of r.doors.filter((x) => x.exterior)) {
        const inner = face(r, d.side, false);
        const fr = sideFrame(r, d.side);
        const a = inner.a0 + d.offset;
        if (r.kind === 'waiting') {
          // a respiratory-hygiene stand inside, beside the door (in front of its parked leaf), facing the way in
          if (byId('mask_walkin')) continue;
          const at = onFace(inner, a - 0.55, 0.75);
          out.push({ id: 'mask_walkin', kind: 'maskStation', room: r.id, x: round(at.x), z: round(at.z), rot: round(rotFor(fr.dx, fr.dz)) });
        } else if (!byId(`mask_${r.id}`)) {
          // a box on a side wall, inside, 75 cm in from the door's wall: the room's own wall, or (a corridor
          // between two rooms) the neighbour's face toward it
          const sideAxis = inner.axis === 'z' ? 'x' : 'z';
          const lo = sideAxis === 'x' ? r.rect.x : r.rect.z;
          const hi = sideAxis === 'x' ? r.rect.x + r.rect.w : r.rect.z + r.rect.d;
          const from = inner.c;
          const dir = inner.n;
          const s = FIXTURE_SIZE.maskBox!;
          const sides = faces.filter((f) => f.axis === sideAxis && ((f.n === -1 && f.c > lo && f.c <= hi + 0.001) || (f.n === 1 && f.c >= lo - 0.001 && f.c < hi)) && from + dir * 0.75 > f.a0 && from + dir * 0.75 < f.a1);
          for (const wf of sides.sort((p, q) => q.c - p.c)) {
            const along = freeNear(wf, from + dir * 0.75, s.w, s.y0, s.h, dir, 1.2);
            if (along === null) continue;
            place(`mask_${r.id}`, 'maskBox', r.id, wf, along);
            break;
          }
        }
      }
      if (r.kind === 'station' && !byId('mask_station')) {
        // a box of masks on the end counter (the shortest), toward its outer face
        const end = props.filter((p) => p.room === r.id && p.kind === 'counter').sort((p, q) => (p.w ?? 1) - (q.w ?? 1))[0];
        if (!end) continue;
        const w = end.w ?? 1;
        const dd = end.d ?? 0.7;
        const west = end.x < r.rect.x + r.rect.w / 2;
        out.push({ id: 'mask_station', kind: 'maskBox', room: r.id, x: round(end.x + (west ? -1 : 1) * (w / 2 - 0.13)), z: round(end.z + dd / 2 - 0.3), y: (end.h ?? 1.05) + 0.002, rot: west ? -PI / 2 : PI / 2, label: 'counter' });
      }
    }
  }
  return { props: out, entrances };
}

const inRect = (r: RoomDef, p: { x: number; z: number }) => p.x >= r.rect.x && p.x <= r.rect.x + r.rect.w && p.z >= r.rect.z && p.z <= r.rect.z + r.rect.d;

/** which way a sink's local +x runs along the face behind it (+1 / −1 along the face's axis) */
function sinkAlong(rot: number, faceAxis: 'x' | 'z'): number {
  // local +x in world: (cos rot, −sin rot)
  const wx = Math.round(Math.cos(rot));
  const wz = Math.round(-Math.sin(rot));
  return faceAxis === 'x' ? wz : wx;
}
