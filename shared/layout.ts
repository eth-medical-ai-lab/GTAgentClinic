/**
 * Building layouts (geometry only — safe to ship to clients).
 *
 * Coordinates are meters. x grows east, z grows south, y is up. A room rect is
 * {x, z} = north-west corner, w along x, d along z. Prop `rot` is a yaw in
 * radians; rot = 0 means the prop's front faces +z (south). For beds the head
 * end is at −z (north) when rot = 0.
 */
import { hygienePlan } from './hygiene';
import type { LocationId } from './types';

export type Side = 'n' | 's' | 'e' | 'w';

export interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface DoorDef {
  side: Side;
  /** distance from the wall's start (west end for n/s walls, north end for e/w walls) */
  offset: number;
  width: number;
  kind: 'open' | 'door' | 'sliding' | 'double';
  /** leads outside the building */
  exterior?: boolean;
  /** 'sliding' only: the leaves run into wall pockets, so none are drawn stacked beside the opening (a corridor no wider than the door) */
  pocket?: boolean;
  /** sill height above the room's floor: a double-height stair core's door onto an upper floor (shared/floors.ts) */
  y?: number;
}

export type RoomKind = 'bay' | 'room' | 'corridor' | 'waiting' | 'station' | 'imaging' | 'resus' | 'triage' | 'office' | 'exterior' | 'utility';

export interface Spot {
  x: number;
  z: number;
  /** facing yaw (0 = facing +z/south) */
  rot?: number;
}

export interface RoomDef {
  id: LocationId;
  label: string;
  kind: RoomKind;
  rect: Rect;
  doors: DoorDef[];
  /** sides that have no wall at all (e.g. a corridor bordered by other rooms) */
  openSides?: Side[];
  /** sides closed by a hospital curtain (walkable) instead of a wall */
  curtainSides?: Side[];
  floor: string;
  wall: string;
  /** sign text mounted above the main entrance */
  sign?: string;
  signSide?: Side;
  spots: Record<string, Spot>;
  /** the point an NPC/agent walks to when "entering" the room */
  entry: Spot;
  /** ceiling height in meters (default: layout.wallHeight). A taller room (e.g. a double-height stair core) rises through the roof as a tower. */
  ceilingHeight?: number;
  /** opening hours [from, to) in clock hours; outside them the room is closed (lights dimmed). Omit = 24/7 */
  hours?: [number, number];
}

/**
 * A straight flight of stairs the player can walk (NPCs path on the floor and don't use them).
 * The flight rises from `base` at its low edge to `base + rise` meters at the edge facing `up`.
 * The builder generates solid steps (filled down to the floor) and handrails on sides that
 * aren't against a wall; the player controller follows the height.
 */
export interface RampDef {
  id: string;
  room: LocationId;
  rect: Rect;
  up: Side;
  rise: number;
  /** height of the low edge (default 0); e.g. a second flight starting at a half-landing */
  base?: number;
  /** number of steps (default: rise / 0.17) */
  steps?: number;
}

/** A flat raised platform, solid down to the floor (e.g. a half-landing). Open edges get a guardrail unless a flight or another landing joins there. */
export interface LandingDef {
  id: string;
  room: LocationId;
  rect: Rect;
  y: number;
}

export type PropKind =
  | 'bed'
  | 'stretcher'
  | 'monitor'
  | 'computer'
  | 'counter'
  | 'desk'
  | 'chair'
  | 'stool'
  | 'phone'
  | 'board'
  | 'ctScanner'
  | 'xrayTable'
  | 'sink'
  | 'cart'
  | 'crashCart'
  | 'plant'
  | 'cabinet'
  | 'ivPole'
  | 'trash'
  | 'vending'
  | 'sofa'
  | 'ambulance'
  | 'medDispenser'
  /** the medication room's locked controlled-drug cupboard (wall-mounted: y is its bottom) */
  | 'cdCupboard'
  | 'ultrasound'
  | 'whiteboard'
  | 'tv'
  | 'coffee'
  | 'lamp'
  | 'sign'
  | 'vitalsMachine'
  | 'fridge'
  | 'printer'
  // east wing: signage + exterior
  | 'hangingSign'
  | 'wallSign'
  | 'poster'
  | 'litSign'
  | 'canopy'
  | 'parking'
  | 'handrail'
  // stairs + elevators
  | 'elevatorDoor'
  | 'callPanel'
  | 'fireDoor'
  | 'aed'
  // cafeteria
  | 'cafeTable'
  | 'cafeChair'
  | 'servingCounter'
  | 'till'
  | 'coffeeStation'
  | 'drinksFridge'
  | 'trayRack'
  | 'wasteStation'
  | 'menuBoard'
  // restrooms
  | 'toiletStall'
  | 'toilet'
  | 'vanity'
  | 'handDryer'
  | 'babyChange'
  | 'handRub'
  // hand hygiene and masks, placed by rule (shared/hygiene.ts)
  | 'soapDispenser'
  | 'towelDispenser'
  | 'gloveHolder'
  | 'pedalBin'
  | 'maskBox'
  | 'maskStation'
  // outpatient clinic
  | 'examTable'
  | 'diagSet'
  | 'scale'
  // Resus 1 + 2 by the ambulance entrance (client/src/world/resusGear.ts)
  | 'pendant'
  | 'resusMonitor'
  | 'procLight'
  | 'ventilator'
  | 'pumpTower'
  | 'defibCart'
  | 'airwayCart'
  | 'suctionRail'
  | 'gloveStation'
  | 'pocus'
  | 'rapidInfuser'
  | 'warmer'
  | 'cprDevice'
  | 'resusClock'
  | 'teamBoard'
  | 'mobileXray'
  | 'binShelf'
  | 'bumperRail'
  // CT suite and X-ray room (client/src/world/imaging.ts)
  | 'ctInjector'
  | 'ctConsole'
  | 'contrastWarmer'
  | 'apronRack'
  | 'radSign'
  | 'xrayWarn'
  | 'gasPanel'
  | 'stepStool'
  | 'xrayTube'
  | 'wallStand'
  | 'xrayConsole'
  | 'xrayGenerator'
  | 'detectorRack'
  | 'aidShelf'
  | 'changeCubicle';

export type Interact = 'computer' | 'phone' | 'board' | 'monitor';

export interface PropDef {
  id: string;
  kind: PropKind;
  room: LocationId;
  x: number;
  z: number;
  /** height of the prop's base above the floor (e.g. computer on a counter) */
  y?: number;
  rot?: number;
  /** optional size override (w along local x, d along local z, h up) */
  w?: number;
  d?: number;
  h?: number;
  color?: string;
  label?: string;
  interact?: Interact;
  /** for monitors/beds: the bay they belong to */
  bay?: LocationId;
  /** blocks walking (used for collision + NPC pathfinding) */
  solid?: boolean;
}

export interface LayoutDef {
  id: string;
  name: string;
  /** building footprint (exterior extends beyond) */
  width: number;
  depth: number;
  wallHeight: number;
  rooms: RoomDef[];
  /** Bedside zones inside existing rooms. They have clinical addresses but no additional walls or floors. */
  treatmentSpaces?: RoomDef[];
  baseLayoutId?: string;
  props: PropDef[];
  /** walkable stair flights and landings (see RampDef) */
  ramps?: RampDef[];
  landings?: LandingDef[];
  playerSpawn: Spot;
  exterior: { rect: Rect; ground: string };
}

// ───────────────────────────── helpers ─────────────────────────────

export function roomAt(layout: LayoutDef, x: number, z: number): RoomDef | undefined {
  const bedside = layout.treatmentSpaces?.find(({ rect }) => x >= rect.x && x <= rect.x + rect.w && z >= rect.z && z <= rect.z + rect.d);
  if (bedside) return bedside;
  // prefer non-corridor rooms (rooms take precedence over the hub they open onto)
  let hit: RoomDef | undefined;
  for (const r of layout.rooms) {
    if (x >= r.rect.x && x <= r.rect.x + r.rect.w && z >= r.rect.z && z <= r.rect.z + r.rect.d) {
      if (!hit || (hit.kind === 'corridor' && r.kind !== 'corridor')) hit = r;
    }
  }
  return hit;
}

export function roomById(layout: LayoutDef, id: LocationId): RoomDef | undefined {
  return layout.rooms.find((r) => r.id === id) ?? layout.treatmentSpaces?.find(r => r.id === id);
}

export function spotFor(layout: LayoutDef, room: LocationId, spot: string): Spot | undefined {
  const r = roomById(layout, room);
  if (!r) return undefined;
  return r.spots[spot] ?? r.entry;
}

/** Free floor beside the patient's bed for standing up or transferring to a wheelchair. */
export function dischargePickup(layout: LayoutDef, bed: LocationId): Spot | undefined {
  const spots = roomById(layout, bed)?.spots;
  return spots?.discharge ?? spots?.bedside;
}

/** End the trip outside the public entrance, clear of the open sliding doors. */
export function dischargeExit(layout: LayoutDef) {
  const door = spotFor(layout, 'waiting', 'door')!;
  const rot = (door.rot ?? Math.PI) + Math.PI;
  return { x: door.x + 4.4 * Math.sin(rot), z: door.z + 4.4 * Math.cos(rot), rot };
}

/** Distance from the rider's centre to the nurse at the wheelchair handles (metres). */
export const PUSH_GAP = 0.7;

/** Approximate walking time (seconds) between room entries, via a Manhattan path through the hub. */
export function walkSeconds(layout: LayoutDef, from: LocationId, to: LocationId, speed = 1.3): number {
  if (from === to) return 0;
  const a = roomById(layout, from)?.entry;
  const b = roomById(layout, to)?.entry;
  if (!a || !b) return 30;
  const dist = Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
  return Math.round(dist / speed + 4);
}

// ───────────────────────────── the ED layout ─────────────────────────────

const FLOOR_BAY = '#cfd8d6';
const FLOOR_HUB = '#d9dde0';
const FLOOR_ROOM = '#d6d2c8';
const WALL = '#eef1ef';
const WALL_ACCENT = '#dfe8ef';
const PI = Math.PI;

/**
 * Waiting-room seats along the walls (backs ~0.45 m off the wall, clear of the 0.9 m handrail):
 * four east of the corridor door facing south, two on the west wall facing east, and two either
 * side of the walk-in door facing north (its first metre left clear). With the two centre rows: 22.
 * Their prop ids are w_chair_d0…9 (client/src/world/items.ts seeds the odd magazine on a chair by
 * prop id; server/sim/ambient.ts keeps people off those chairs).
 */
const WAITING_WALL_CHAIRS: Spot[] = [
  ...[6.55, 7.3, 8.05, 8.8].map((x) => ({ x, z: 15.55, rot: 0 })),
  ...[15.85, 16.6].map((z) => ({ x: 0.55, z, rot: PI / 2 })),
  ...[1.75, 2.5, 7.5, 8.25].map((x) => ({ x, z: 23.45, rot: PI })),
];

function bay(i: number): { room: RoomDef; props: PropDef[] } {
  const x0 = (i - 1) * 4;
  const id = `bed_${i}`;
  const room: RoomDef = {
    id,
    label: `Bed ${i}`,
    kind: 'bay',
    rect: { x: x0, z: 0, w: 4, d: 7 },
    doors: [],
    curtainSides: ['s'],
    floor: FLOOR_BAY,
    wall: i % 2 ? WALL : WALL_ACCENT,
    sign: `BED ${i}`,
    signSide: 's',
    spots: {
      bed: { x: x0 + 2, z: 2.3, rot: 0 },
      bedside: { x: x0 + 3.2, z: 3.2, rot: -PI / 2 },
      bedside_l: { x: x0 + 0.8, z: 3.0, rot: PI / 2 },
      foot: { x: x0 + 2, z: 4.4, rot: PI },
      chair: { x: x0 + 0.75, z: 5.3, rot: PI / 2 + 0.3 },
      entry: { x: x0 + 2, z: 6.2, rot: PI },
    },
    entry: { x: x0 + 2, z: 6.2, rot: PI },
  };
  const props: PropDef[] = [
    { id: `${id}_bed`, kind: 'bed', room: id, x: x0 + 2, z: 2.3, rot: 0, bay: id, solid: true },
    { id: `${id}_monitor`, kind: 'monitor', room: id, x: x0 + 3.35, z: 0.35, y: 1.55, rot: 0, interact: 'monitor', bay: id },
    { id: `${id}_iv`, kind: 'ivPole', room: id, x: x0 + 0.7, z: 1.2, solid: false },
    { id: `${id}_chair`, kind: 'chair', room: id, x: x0 + 0.6, z: 5.3, rot: PI / 2 + 0.3, solid: true },
    { id: `${id}_sink`, kind: 'sink', room: id, x: x0 + 3.55, z: 5.6, rot: -PI / 2 },
  ];
  return { room, props };
}

/**
 * East wing, x 48–72 × z 0–24 (tiles the block completely: the roof, parapet and boundary
 * walls assume a rectangular footprint).
 *   north (z 0–9):   Stair 1 (48–51) · elevator lobby (51–56) · cafeteria (56–67) · restrooms (67–72)
 *   middle (z 9–13): hospital street (48–69.5) · accessible restroom at its east end (69.5–72)
 *   south (z 13–24): outpatient clinic reception (48–60) · clinic hallway (60–72, z 13–18.5) ·
 *                    exam rooms 1–3 (60–64, 64–68, 68–72; z 18.5–24)
 */
function buildEastWing(rooms: RoomDef[], props: PropDef[]): { ramps: RampDef[]; landings: LandingDef[] } {
  const ramps: RampDef[] = [];
  const landings: LandingDef[] = [];
  const room = (r: RoomDef) => rooms.push(r);
  const prop = (...p: PropDef[]) => props.push(...p);

  // ── hospital street: joins the ED hub (its east wall opens at z 9.85–13) ──
  room({
    id: 'street',
    label: 'Hospital street',
    kind: 'corridor',
    rect: { x: 48, z: 9, w: 21.5, d: 4 },
    doors: [],
    // every side is closed by a neighbour's wall (their doors + signs face the street)
    openSides: ['n', 's', 'w', 'e'],
    floor: FLOOR_HUB,
    wall: WALL,
    spots: {
      west: { x: 50.2, z: 11.4, rot: -PI / 2 },
      center: { x: 58.5, z: 11.2 },
      east: { x: 67.0, z: 11.2, rot: PI / 2 },
    },
    entry: { x: 58.5, z: 11.2, rot: PI / 2 },
  });
  // ceiling-hung blade signs across the street: rot −π/2 puts the front face (label before '||') toward
  // people walking east from the ED, so ← = north, → = south there; the back face reads for westbound walkers
  prop(
    { id: 'st_way_1', kind: 'hangingSign', room: 'street', x: 50.3, z: 11.4, y: 2.3, w: 1.6, h: 0.46, rot: -PI / 2, label: '← Stair 1 · Elevators|→ Outpatient clinic|↑ Cafeteria · Restrooms||↑ Emergency department' },
    { id: 'st_way_2', kind: 'hangingSign', room: 'street', x: 61.0, z: 11.0, y: 2.3, w: 1.6, h: 0.46, rot: -PI / 2, label: '↑ Restrooms|All-gender · Accessible||↑ Emergency department|→ Cafeteria · Elevators|← Outpatient clinic' },
    // corridor handrails on the neighbours' walls (wall props: origin on the wall face, length w)
    { id: 'st_rail_n1', kind: 'handrail', room: 'street', x: 50.4, z: 9.0, rot: 0, w: 1.9 },
    { id: 'st_rail_n2', kind: 'handrail', room: 'street', x: 63.0, z: 9.0, rot: 0, w: 7.6 },
    { id: 'st_rail_s1', kind: 'handrail', room: 'street', x: 50.0, z: 13.0, rot: PI, w: 3.6 },
    { id: 'st_rail_s2', kind: 'handrail', room: 'street', x: 57.2, z: 13.0, rot: PI, w: 5.2 },
    { id: 'st_rail_s3', kind: 'handrail', room: 'street', x: 64.75, z: 13.0, rot: PI, w: 9.1 },
  );

  // ── accessible restroom (single-user, wheelchair turning circle) closing the street's east end ──
  room({
    id: 'restroom_acc',
    label: 'Accessible restroom',
    kind: 'utility',
    rect: { x: 69.5, z: 9, w: 2.5, d: 4 },
    // an open gap in the wall; the leaf that shuts it swings on its own hinge (client/src/world/swingDoors.ts)
    doors: [{ side: 'w', offset: 1.45, width: 1.1, kind: 'open' }],
    floor: '#cdd5d8',
    wall: '#e6edf0',
    sign: 'RESTROOM',
    signSide: 'w',
    spots: { entry: { x: 70.4, z: 11.0, rot: PI / 2 } },
    entry: { x: 70.4, z: 11.0, rot: PI / 2 },
  });

  // ── Stair 1: enclosed dog-leg stair core, double height (rises through Floor 2, shared/floors.ts) ──
  // inner faces x 48.12–50.88, z 0.12–8.88; flight 1 (west, 1.28 m) climbs north to the half-landing,
  // flight 2 (east, 1.28 m, 0.2 m gap) climbs back south to the upper landing at the Level 2 fire door
  // (its leaf swings and closes itself: floors.ts)
  room({
    id: 'stairs',
    label: 'Stair 1',
    kind: 'utility',
    rect: { x: 48, z: 0, w: 3, d: 9 },
    doors: [
      { side: 's', offset: 0.2, width: 1.1, kind: 'door' },
      { side: 'e', offset: 4.02, width: 1.1, kind: 'open', y: 3.0 },
    ],
    floor: '#cfd2d2',
    wall: '#e9e6df',
    sign: 'STAIR 1',
    signSide: 's',
    ceilingHeight: 6.0,
    spots: {
      foot: { x: 48.76, z: 4.5, rot: PI },
      entry: { x: 48.76, z: 7.8, rot: PI },
    },
    entry: { x: 48.76, z: 7.8, rot: PI },
  });
  ramps.push(
    { id: 'stair1_flight1', room: 'stairs', rect: { x: 48.12, z: 1.42, w: 1.28, d: 2.5 }, up: 'n', base: 0, rise: 1.5, steps: 9 },
    { id: 'stair1_flight2', room: 'stairs', rect: { x: 49.6, z: 1.42, w: 1.28, d: 2.5 }, up: 's', base: 1.5, rise: 1.5, steps: 9 },
  );
  landings.push(
    { id: 'stair1_half', room: 'stairs', rect: { x: 48.12, z: 0.12, w: 2.76, d: 1.3 }, y: 1.5 },
    { id: 'stair1_upper', room: 'stairs', rect: { x: 49.6, z: 3.92, w: 1.28, d: 1.3 }, y: 3.0 },
  );
  prop(
    // stairway identification signs (floor, stair, terminus, roof access): at the foot, and on the upper landing
    { id: 'stair1_id', kind: 'wallSign', room: 'stairs', x: 48.12, z: 6.7, y: 1.25, rot: PI / 2, w: 0.42, h: 0.5, color: '#1d3f6e', label: 'STAIR 1|LEVEL 1|Up: Level 2|Ward 2 East|NO ROOF ACCESS' },
    { id: 'stair1_id_l2', kind: 'wallSign', room: 'stairs', x: 50.88, z: 3.7, y: 4.25, rot: -PI / 2, w: 0.34, h: 0.46, color: '#1d3f6e', label: 'STAIR 1|LEVEL 2|Down: Level 1|Exit to the street|NO ROOF ACCESS' },
  );

  // ── elevator lobby: two bed-sized cars on the north wall (shafts behind it, z < 0), open to the street ──
  room({
    id: 'lobby',
    label: 'Elevator lobby',
    kind: 'room',
    rect: { x: 51, z: 0, w: 5, d: 9 },
    doors: [
      // the entrances of elevators A and B (client/src/world/elevator.ts builds the frames and doors)
      { side: 'n', offset: 0.64, width: 1.42, kind: 'open' },
      { side: 'n', offset: 2.94, width: 1.42, kind: 'open' },
      { side: 's', offset: 0.5, width: 4.0, kind: 'open' },
    ],
    floor: '#d8dbd6',
    wall: '#e7ece9',
    sign: 'ELEVATORS',
    signSide: 's',
    spots: {
      'elevator-1': { x: 52.35, z: 1.4, rot: PI },
      'elevator-2': { x: 54.65, z: 1.4, rot: PI },
      entry: { x: 53.5, z: 6.6, rot: PI },
    },
    entry: { x: 53.5, z: 6.6, rot: PI },
  });
  prop(
    { id: 'lob_elev_a', kind: 'elevatorDoor', room: 'lobby', x: 52.35, z: 0.12, rot: 0, label: 'A' },
    { id: 'lob_elev_b', kind: 'elevatorDoor', room: 'lobby', x: 54.65, z: 0.12, rot: 0, label: 'B' },
    { id: 'lob_call', kind: 'callPanel', room: 'lobby', x: 53.5, z: 0.12, y: 1.0, rot: 0 },
    { id: 'lob_dir', kind: 'wallSign', room: 'lobby', x: 55.88, z: 4.2, y: 1.15, rot: -PI / 2, w: 1.2, h: 0.85, color: '#0f4c5c', label: 'BUILDING DIRECTORY|L1  Emergency department · Imaging|L1  Outpatient clinic · Cafeteria|L1  Restrooms · Stair 1|L2  Ward 2 East — medical inpatients|L2  Visiting 10:00–20:00' },
    { id: 'lob_aed', kind: 'aed', room: 'lobby', x: 51.12, z: 7.3, y: 1.15, rot: PI / 2 },
    { id: 'lob_plant', kind: 'plant', room: 'lobby', x: 55.5, z: 7.4, solid: true },
  );

  // ── cafeteria (24/7): servery along the north wall, 8 tables, coffee, cold drinks ──
  // inner faces x 56.12–66.88, z 0.12–8.88; entrance x 56.6–59.0 from the street
  const cafSpots: Record<string, Spot> = {
    till: { x: 62.75, z: 0.8, rot: 0 },
    counter: { x: 60.2, z: 2.75, rot: PI },
    coffee: { x: 65.8, z: 1.45, rot: PI },
    fridge: { x: 64.15, z: 1.45, rot: PI },
    entry: { x: 58.2, z: 7.9, rot: PI },
  };
  // 4-tops (0.8 m) east of the entrance aisle, 2-tops (0.7 m) along the west wall
  const tables: [number, number, number][] = [
    [60.6, 4.4, 4], [63.1, 4.4, 4], [65.6, 4.4, 4],
    [60.6, 6.9, 4], [63.1, 6.9, 4], [65.6, 6.9, 4],
    [56.85, 4.6, 2], [56.85, 6.6, 2],
  ];
  let seat = 0;
  tables.forEach(([tx, tz, n], i) => {
    const size = n === 4 ? 0.8 : 0.7;
    prop({ id: `caf_table_${i + 1}`, kind: 'cafeTable', room: 'cafeteria', x: tx, z: tz, w: size, d: size, solid: true });
    const off = size / 2 + 0.22;
    const chairs: [number, number, number][] = [[tx, tz - off, 0], [tx, tz + off, PI]];
    if (n === 4) chairs.push([tx - off, tz, PI / 2], [tx + off, tz, -PI / 2]);
    for (const [cx, cz, cr] of chairs) {
      seat++;
      prop({ id: `caf_chair_${seat}`, kind: 'cafeChair', room: 'cafeteria', x: cx, z: cz, rot: cr });
      cafSpots[`chair-${seat}`] = { x: cx, z: cz, rot: cr };
    }
    // standing spot beside the table, on its aisle side
    cafSpots[`table-${i + 1}`] = n === 4 ? { x: tx - 0.95, z: tz + 0.95, rot: (3 * PI) / 4 } : { x: tx + 0.75, z: tz, rot: -PI / 2 };
  });
  room({
    id: 'cafeteria',
    label: 'Cafeteria',
    kind: 'room',
    rect: { x: 56, z: 0, w: 11, d: 9 },
    doors: [{ side: 's', offset: 0.6, width: 2.4, kind: 'open' }],
    floor: '#cdb99c',
    wall: '#f0e7da',
    sign: 'CAFETERIA',
    signSide: 's',
    spots: cafSpots,
    entry: cafSpots.entry,
  });
  prop(
    { id: 'caf_counter', kind: 'servingCounter', room: 'cafeteria', x: 60.4, z: 1.75, w: 5.6, d: 0.8, h: 0.92, rot: 0, solid: true },
    { id: 'caf_till', kind: 'till', room: 'cafeteria', x: 62.75, z: 1.62, y: 0.92, rot: 0 },
    { id: 'caf_menu', kind: 'menuBoard', room: 'cafeteria', x: 60.4, z: 0.12, y: 1.72, w: 3.0, h: 0.95, rot: 0 },
    { id: 'caf_trays', kind: 'trayRack', room: 'cafeteria', x: 56.45, z: 2.9, rot: PI / 2, solid: true },
    { id: 'caf_fridge', kind: 'drinksFridge', room: 'cafeteria', x: 64.15, z: 0.5, rot: 0, solid: true },
    { id: 'caf_coffee', kind: 'coffeeStation', room: 'cafeteria', x: 65.8, z: 0.47, w: 1.6, d: 0.7, rot: 0, solid: true },
    { id: 'caf_waste', kind: 'wasteStation', room: 'cafeteria', x: 59.9, z: 8.63, w: 1.2, d: 0.5, rot: PI, solid: true },
    { id: 'caf_poster', kind: 'poster', room: 'cafeteria', x: 66.88, z: 2.6, y: 1.25, rot: -PI / 2, color: '#3f8f4a', label: 'BUILD A HEALTHY PLATE|½ vegetables and fruit|¼ whole grains|¼ protein: beans, fish, chicken|Water instead of sugary drinks|♥ marks lower-salt choices' },
    { id: 'caf_plant', kind: 'plant', room: 'cafeteria', x: 66.45, z: 8.45, solid: true },
  );

  // ── all-gender restrooms: full-height stalls along the east wall, basins + mirror on the west wall ──
  // inner faces x 67.12–71.88, z 0.12–8.88; door x 67.6–68.8 (its leaf swings in along x ≈ 67.63)
  room({
    id: 'restrooms',
    label: 'Restrooms (all-gender)',
    kind: 'utility',
    rect: { x: 67, z: 0, w: 5, d: 9 },
    // an open gap; the leaf that shuts it swings on its own hinge (client/src/world/swingDoors.ts)
    doors: [{ side: 's', offset: 0.6, width: 1.2, kind: 'open' }],
    floor: '#c6d0d3',
    wall: '#e3ebed',
    sign: 'RESTROOMS',
    signSide: 's',
    spots: {
      sink: { x: 68.05, z: 3.35, rot: -PI / 2 },
      entry: { x: 68.4, z: 7.4, rot: PI },
    },
    entry: { x: 68.4, z: 7.4, rot: PI },
  });
  prop(
    { id: 'rr_stalls', kind: 'toiletStall', room: 'restrooms', x: 71.08, z: 2.62, w: 5.0, d: 1.6, rot: -PI / 2, solid: true },
    { id: 'rr_vanity', kind: 'vanity', room: 'restrooms', x: 67.12, z: 3.35, w: 2.7, rot: PI / 2 },
    { id: 'rr_dryer', kind: 'handDryer', room: 'restrooms', x: 67.12, z: 5.35, y: 0.95, rot: PI / 2 },
    { id: 'rr_baby', kind: 'babyChange', room: 'restrooms', x: 68.7, z: 0.12, y: 0.82, rot: 0 },
    { id: 'rr_trash', kind: 'trash', room: 'restrooms', x: 67.45, z: 6.2, solid: true },
    // door-side signs on the street (neutral wording + pictograms)
    { id: 'rr_sign', kind: 'wallSign', room: 'street', x: 69.12, z: 9.0, y: 1.2, rot: 0, w: 0.34, h: 0.46, color: '#0f4c5c', label: 'ALL-GENDER|RESTROOM|@wc' },
    { id: 'rra_sign', kind: 'wallSign', room: 'street', x: 69.5, z: 12.3, y: 1.2, rot: -PI / 2, w: 0.34, h: 0.46, color: '#1f5fa8', label: 'ACCESSIBLE|RESTROOM|@isa|Baby change' },
  );
  // accessible restroom fit-out: wall-hung WC with grab bars + pull cord, basin with knee space, 1.5 m turning circle
  prop(
    { id: 'rra_wc', kind: 'toilet', room: 'restroom_acc', x: 71.43, z: 9.12, rot: 0, label: 'accessible' },
    { id: 'rra_basin', kind: 'vanity', room: 'restroom_acc', x: 70.35, z: 12.88, w: 0.7, rot: PI },
    { id: 'rra_baby', kind: 'babyChange', room: 'restroom_acc', x: 71.88, z: 12.05, y: 0.82, rot: -PI / 2 },
    { id: 'rra_dryer', kind: 'handDryer', room: 'restroom_acc', x: 71.45, z: 12.88, y: 0.95, rot: PI },
  );

  // ── outpatient clinic (08–17): reception + waiting, own entrance from the parking lot ──
  // inner faces x 48.12–59.88, z 13.12–23.88; doors: street x 52–54.4, lot x 53.4–55.8, hallway z 16.6–18.4
  const CLINIC_HOURS: [number, number] = [8, 17];
  const clinicSpots: Record<string, Spot> = {
    desk: { x: 58.85, z: 20.0, rot: -PI / 2 },
    counter: { x: 57.15, z: 20.0, rot: PI / 2 },
    door: { x: 54.6, z: 23.2, rot: 0 },
    entry: { x: 53.2, z: 14.3, rot: 0 },
  };
  let wc = 0;
  const waitChair = (x: number, z: number, rot: number) => {
    wc++;
    prop({ id: `cl_chair_${wc}`, kind: 'chair', room: 'clinic', x, z, rot, color: '#5a7f73' });
    clinicSpots[`chair-${wc}`] = { x, z, rot };
  };
  for (let i = 0; i < 8; i++) waitChair(48.55, 14.3 + i * 0.7, PI / 2); // along the west wall, facing east
  for (let i = 0; i < 6; i++) waitChair(50.85, 14.65 + i * 0.7, -PI / 2); // facing them across a low table
  for (let i = 0; i < 4; i++) waitChair(49.0 + i * 0.7, 23.45, PI); // by the window, facing north
  for (let i = 0; i < 6; i++) waitChair(51.55, 14.65 + i * 0.7, PI / 2); // back to back with them, facing reception
  room({
    id: 'clinic',
    label: 'Outpatient clinic',
    kind: 'room',
    rect: { x: 48, z: 13, w: 12, d: 11 },
    doors: [
      { side: 'n', offset: 4.0, width: 2.4, kind: 'sliding' },
      { side: 's', offset: 5.4, width: 2.4, kind: 'sliding', exterior: true },
      { side: 'e', offset: 3.6, width: 1.8, kind: 'open' },
    ],
    floor: '#d3d8cf',
    wall: '#eef0e6',
    sign: 'OUTPATIENT CLINIC',
    signSide: 'n',
    spots: clinicSpots,
    entry: clinicSpots.entry,
    hours: CLINIC_HOURS,
  });
  prop(
    { id: 'cl_desk', kind: 'desk', room: 'clinic', x: 58.0, z: 20.0, w: 2.4, d: 0.9, h: 1.05, rot: -PI / 2, label: 'Clinic reception', solid: true },
    { id: 'cl_pc', kind: 'computer', room: 'clinic', x: 58.15, z: 19.7, y: 0.775, rot: PI / 2 },
    { id: 'cl_desk_chair', kind: 'chair', room: 'clinic', x: 58.85, z: 20.0, rot: -PI / 2 },
    { id: 'cl_table', kind: 'cafeTable', room: 'clinic', x: 49.7, z: 16.5, w: 0.55, d: 1.6, h: 0.42, solid: true },
    { id: 'cl_tv', kind: 'tv', room: 'clinic', x: 49.7, z: 13.15, y: 1.95, rot: 0 },
    { id: 'cl_plant_1', kind: 'plant', room: 'clinic', x: 48.55, z: 21.4, solid: true },
    { id: 'cl_plant_2', kind: 'plant', room: 'clinic', x: 59.45, z: 23.45, solid: true },
    { id: 'cl_trash', kind: 'trash', room: 'clinic', x: 51.9, z: 23.5, solid: true },
    { id: 'cl_sign_desk', kind: 'wallSign', room: 'clinic', x: 59.88, z: 20.0, y: 1.6, rot: -PI / 2, w: 1.2, h: 0.32, color: '#2f7f86', label: 'RECEPTION|Please check in here' },
    { id: 'cl_poster_1', kind: 'poster', room: 'clinic', x: 50.2, z: 13.12, y: 1.25, rot: 0, color: '#1f6f8b', label: 'FLU SEASON|One shot a year, every year|from 6 months of age.|Ask at reception —|it takes five minutes.' },
    { id: 'cl_poster_2', kind: 'poster', room: 'clinic', x: 50.05, z: 23.88, y: 1.25, rot: PI, color: '#6b4fb3', label: 'ASK ME 3|1. What is my main problem?|2. What do I need to do?|3. Why is it important|   for me to do this?' },
    // entrance from the parking lot: canopy with a lit sign on its fascia, opening hours by the door
    { id: 'ext_cl_canopy', kind: 'canopy', room: 'exterior', x: 54.6, z: 24.12, w: 6.4, d: 2.8, rot: 0 },
    { id: 'ext_cl_sign', kind: 'litSign', room: 'exterior', x: 54.6, z: 26.965, y: 2.77, w: 4.4, h: 0.4, rot: 0, color: '#d8f6ff', label: 'OUTPATIENT CLINIC' },
    { id: 'ext_cl_hours', kind: 'wallSign', room: 'exterior', x: 56.32, z: 24.12, y: 1.15, rot: 0, w: 0.4, h: 0.56, color: '#2f7f86', label: 'OUTPATIENT|CLINIC|Mon–Fri 08:00–17:00|After hours:|← Emergency entrance' },
    { id: 'ext_lamp_3', kind: 'lamp', room: 'exterior', x: 60.5, z: 27.5 },
    { id: 'ext_lamp_4', kind: 'lamp', room: 'exterior', x: 76, z: 27.5 },
    { id: 'ext_parking_e', kind: 'parking', room: 'exterior', x: 73.5, z: 31.5, w: 12 },
    { id: 'ext_parking_acc', kind: 'parking', room: 'exterior', x: 54.0, z: 31.5, w: 3, label: 'accessible' },
  );

  // ── clinic hallway: nurse workstation, vitals alcove, exam room doors on its south side ──
  // inner faces x 60–71.88 (west side opens onto reception), z 13.12–18.5
  room({
    id: 'clinic_hall',
    label: 'Clinic hallway',
    kind: 'corridor',
    rect: { x: 60, z: 13, w: 12, d: 5.5 },
    doors: [],
    openSides: ['w', 's'],
    floor: '#d3d8cf',
    wall: '#eef0e6',
    spots: {
      desk: { x: 63.0, z: 14.1, rot: PI },
      vitals: { x: 65.9, z: 14.45, rot: PI },
      'chair-1': { x: 68.7, z: 13.56, rot: 0 },
      'chair-2': { x: 69.4, z: 13.56, rot: 0 },
      'chair-3': { x: 70.1, z: 13.56, rot: 0 },
      entry: { x: 61.2, z: 17.3, rot: PI / 2 },
    },
    entry: { x: 61.2, z: 17.3, rot: PI / 2 },
    hours: CLINIC_HOURS,
  });
  prop(
    { id: 'clh_desk', kind: 'desk', room: 'clinic_hall', x: 63.0, z: 13.47, w: 1.4, d: 0.7, rot: 0, solid: true },
    { id: 'clh_pc', kind: 'computer', room: 'clinic_hall', x: 63.1, z: 13.35, y: 0.78, rot: 0 },
    { id: 'clh_desk_chair', kind: 'chair', room: 'clinic_hall', x: 63.0, z: 14.1, rot: PI },
    { id: 'clh_scale', kind: 'scale', room: 'clinic_hall', x: 65.2, z: 13.62, rot: 0, solid: true },
    { id: 'clh_vitals', kind: 'vitalsMachine', room: 'clinic_hall', x: 66.4, z: 13.6, solid: true },
    { id: 'clh_chair_1', kind: 'chair', room: 'clinic_hall', x: 68.7, z: 13.56, rot: 0, color: '#5a7f73' },
    { id: 'clh_chair_2', kind: 'chair', room: 'clinic_hall', x: 69.4, z: 13.56, rot: 0, color: '#5a7f73' },
    { id: 'clh_chair_3', kind: 'chair', room: 'clinic_hall', x: 70.1, z: 13.56, rot: 0, color: '#5a7f73' },
    { id: 'clh_poster', kind: 'poster', room: 'clinic_hall', x: 61.3, z: 13.12, y: 1.25, rot: 0, color: '#c0392b', label: 'KNOW YOUR NUMBERS|Blood pressure goal: < 130/80|Sit 5 minutes, feet flat,|back supported, arm at|heart level — then measure.' },
  );

  // ── exam rooms 1–3 (4 × 5.5 m): door at the north-west corner, table along the east wall ──
  const posters: [string, string][] = [
    ['#2a8f86', 'WASH, THEN TOUCH|Clean hands before and after|every patient contact.|Gloves are not a substitute —|soap and water for C. diff.'],
    ['#1f5f99', 'VACCINES FOR ADULTS|Flu: every autumn|Tdap/Td: every 10 years|Shingles: from 50|Pneumococcal: from 65'],
    ['#b5651d', 'READY TO QUIT?|Nicotine replacement doubles|your chances — combining|patch + gum works best.|Ask us about support.'],
  ];
  for (let i = 1; i <= 3; i++) {
    const x0 = 60 + (i - 1) * 4;
    const id = `exam_${i}`;
    room({
      id,
      label: `Exam room ${i}`,
      kind: 'room',
      rect: { x: x0, z: 18.5, w: 4, d: 5.5 },
      doors: [{ side: 'n', offset: 0.4, width: 1.1, kind: 'door' }],
      floor: '#d6d2c8',
      wall: i === 2 ? '#e6eef2' : '#eef0e4',
      sign: `EXAM ${i}`,
      signSide: 'n',
      spots: {
        exam: { x: x0 + 2.45, z: 21.5, rot: PI / 2 },
        desk: { x: x0 + 1.05, z: 21.0, rot: -PI / 2 },
        'chair-1': { x: x0 + 0.55, z: 22.25, rot: 2.7 },
        sink: { x: x0 + 2.3, z: 19.45, rot: PI },
        entry: { x: x0 + 0.95, z: 19.45, rot: 0 },
      },
      entry: { x: x0 + 0.95, z: 19.45, rot: 0 },
      hours: CLINIC_HOURS,
    });
    const [accent, text] = posters[i - 1];
    prop(
      { id: `ex${i}_table`, kind: 'examTable', room: id, x: x0 + 3.3, z: 21.4, rot: PI, solid: true },
      { id: `ex${i}_desk`, kind: 'desk', room: id, x: x0 + 0.42, z: 21.0, w: 1.2, d: 0.6, rot: PI / 2, solid: true },
      { id: `ex${i}_pc`, kind: 'computer', room: id, x: x0 + 0.32, z: 21.15, y: 0.78, rot: PI / 2 },
      { id: `ex${i}_desk_chair`, kind: 'chair', room: id, x: x0 + 1.05, z: 21.0, rot: -PI / 2 },
      { id: `ex${i}_chair`, kind: 'chair', room: id, x: x0 + 0.55, z: 22.25, rot: 2.7, color: '#4d6f84' },
      { id: `ex${i}_stool`, kind: 'stool', room: id, x: x0 + 2.45, z: 22.4 },
      { id: `ex${i}_sink`, kind: 'sink', room: id, x: x0 + 2.3, z: 18.89, rot: 0 },
      { id: `ex${i}_cab`, kind: 'cabinet', room: id, x: x0 + 1.1, z: 23.63, w: 1.0, d: 0.45, h: 1.9, rot: PI, solid: true },
      { id: `ex${i}_diag`, kind: 'diagSet', room: id, x: x0 + 3.88, z: 23.0, y: 1.05, rot: -PI / 2 },
      { id: `ex${i}_poster`, kind: 'poster', room: id, x: x0 + 3.3, z: 18.62, y: 1.25, rot: 0, color: accent, label: text },
      { id: `ex${i}_trash`, kind: 'trash', room: id, x: x0 + 3.45, z: 19.2, solid: true },
      { id: `ex${i}_rub`, kind: 'handRub', room: 'clinic_hall', x: x0 + 1.75, z: 18.5, y: 1.1, rot: PI },
    );
  }

  return { ramps, landings };
}

/**
 * Ambulance entrance, x 35–48 × z 15–24: a 3.2 m corridor ('ems') from the ambulance bay's sliding
 * door straight through to the hub's double door, and Resus 1 (x 35–40) and Resus 2 (x 43.2–48) on
 * either side of it, the German "Schockraum" pair. Each room's 2.4 m sliding door opens 1.4–3.8 m
 * inside the ambulance door, so a stretcher rolls straight in and parks alongside the trolley.
 * The rooms are mirror images of one ICU-grade bed space: trolley head to the outer wall between two
 * ceiling supply pendants (the patient monitor on the airway-side one), ventilator and airway trolley
 * at the head, infusion tower, headwall suction, crash cart with defibrillator by the door, team-roles
 * board, mechanical CPR device and forced-air warmer on the north wall, rapid infuser, gloves/sharps,
 * supply shelves and ultrasound on the south wall, a clock with an elapsed timer over the head and a procedure light
 * over the chest. The mobile X-ray is parked in the corridor. Geometry: client/src/world/resusGear.ts.
 */
function buildResusSuite(rooms: RoomDef[], props: PropDef[]) {
  const H = PI / 2;
  rooms.push({
    id: 'ems',
    label: 'Ambulance entrance',
    kind: 'room',
    rect: { x: 40, z: 15, w: 3.2, d: 9 },
    doors: [
      { side: 'n', offset: 0.2, width: 2.8, kind: 'double' },
      // a 3.2 m corridor leaves no wall beside the opening for stacked leaves: pocket doors
      { side: 's', offset: 0.2, width: 2.8, kind: 'sliding', exterior: true, pocket: true },
    ],
    // the resus rooms' walls, with their doors, close the long sides
    openSides: ['e', 'w'],
    floor: '#cbd0d4',
    wall: '#e3e7ea',
    sign: 'AMBULANCE ENTRANCE',
    signSide: 'n',
    spots: {
      stretcher: { x: 41.6, z: 20.6, rot: PI },
      medic: { x: 42.4, z: 20.9, rot: -H },
      door: { x: 41.6, z: 23.2, rot: 0 },
      entry: { x: 41.4, z: 16.4, rot: 0 },
    },
    entry: { x: 41.4, z: 16.4, rot: 0 },
  });
  props.push(
    { id: 'ems_xray', kind: 'mobileXray', room: 'ems', x: 40.45, z: 17.4, rot: PI },
    // EMS restock cabinet
    { id: 'ems_cab', kind: 'cabinet', room: 'ems', x: 42.97, z: 18.9, rot: -H, w: 1.4, d: 0.45, h: 2.0, solid: true },
    { id: 'ems_sign', kind: 'hangingSign', room: 'ems', x: 41.6, z: 18.55, y: 2.3, w: 1.5, h: 0.36, rot: 0, label: '← RESUS 1|→ RESUS 2||→ RESUS 1|← RESUS 2' },
    { id: 'ems_rub_1', kind: 'handRub', room: 'ems', x: 40.0, z: 19.9, y: 1.1, rot: H },
    { id: 'ems_rub_2', kind: 'handRub', room: 'ems', x: 43.2, z: 19.9, y: 1.1, rot: -H },
    { id: 'ems_rail_w1', kind: 'bumperRail', room: 'ems', x: 40.0, z: 18.35, rot: H, w: 3.5 },
    { id: 'ems_rail_w2', kind: 'bumperRail', room: 'ems', x: 40.0, z: 23.3, rot: H, w: 1.1 },
    { id: 'ems_rail_e1', kind: 'bumperRail', room: 'ems', x: 43.2, z: 18.35, rot: -H, w: 3.5 },
    { id: 'ems_rail_e2', kind: 'bumperRail', room: 'ems', x: 43.2, z: 23.3, rot: -H, w: 1.1 },
  );
  for (const n of [1, 2]) {
    const west = n === 1;
    const id = `resus_${n}`;
    // u: metres from the head (outer) wall's inner face into the room; v: from the door wall's inner face
    const head = west ? 35.12 : 47.88;
    const doorWall = west ? 39.88 : 43.32;
    const s = west ? 1 : -1;
    const U = (u: number) => Math.round((head + s * u) * 1000) / 1000;
    const V = (v: number) => Math.round((doorWall - s * v) * 1000) / 1000;
    /** mirror a facing for the east room */
    const R = (rot: number) => (west ? rot : -rot);
    rooms.push({
      id,
      label: `Resus ${n}`,
      kind: 'resus',
      rect: west ? { x: 35, z: 15, w: 5, d: 9 } : { x: 43.2, z: 15, w: 4.8, d: 9 },
      doors: [{ side: west ? 'e' : 'w', offset: 5.2, width: 2.4, kind: 'sliding' }],
      floor: '#c9d4dc',
      wall: '#e8eef0',
      sign: `RESUS ${n}`,
      signSide: west ? 'e' : 'w',
      spots: {
        bed: { x: U(2.25), z: 19.0, rot: R(H) },
        bedside: { x: U(2.48), z: 20.2, rot: PI },
        bedside_l: { x: U(2.48), z: 17.85, rot: 0 },
        head: { x: U(0.68), z: 19.0, rot: R(H) },
        foot: { x: V(0.78), z: 19.0, rot: R(-H) },
        entry: { x: V(0.53), z: 21.4, rot: R(-H) },
      },
      entry: { x: V(0.53), z: 21.4, rot: R(-H) },
    });
    props.push(
      // trolley, head to the outer wall
      { id: `${id}_bed`, kind: 'stretcher', room: id, x: U(2.25), z: 19.0, rot: R(H), bay: id, solid: true },
      // ceiling pendants either side of the head; each arm runs back (w m) to a pivot clear of the troffers
      { id: `${id}_pendant_n`, kind: 'pendant', room: id, x: U(1.25), z: 17.65, rot: R(-0.77), w: 1.05, label: 'gas' },
      { id: `${id}_pendant_s`, kind: 'pendant', room: id, x: U(1.25), z: 20.35, rot: R(-2.37), w: 1.05, label: 'infusion' },
      { id: `${id}_monitor`, kind: 'resusMonitor', room: id, x: U(1.25), z: 17.65, y: 1.92, rot: R(1.14), interact: 'monitor', bay: id },
      // procedure light: mount over the trolley, lamp head over the chest (its arm points at the head wall)
      { id: `${id}_light`, kind: 'procLight', room: id, x: U(2.33), z: 19.0, rot: west ? PI : 0 },
      { id: `${id}_vent`, kind: 'ventilator', room: id, x: U(0.45), z: 17.55, rot: R(0.2) },
      { id: `${id}_airway`, kind: 'airwayCart', room: id, x: U(0.42), z: 20.45, rot: PI },
      { id: `${id}_pumps`, kind: 'pumpTower', room: id, x: U(1.15), z: 21.2, rot: PI },
      { id: `${id}_suction`, kind: 'suctionRail', room: id, x: head, z: 19.0, y: 1.15, rot: R(H), w: 2.0 },
      { id: `${id}_clock`, kind: 'resusClock', room: id, x: head, z: 19.0, y: 1.75, rot: R(H) },
      { id: `${id}_crash`, kind: 'defibCart', room: id, x: V(0.3), z: 16.1, rot: R(-H) },
      { id: `${id}_sink`, kind: 'sink', room: id, x: V(0.26), z: 17.6, rot: R(-H) },
      { id: `${id}_board`, kind: 'teamBoard', room: id, x: U(1.9), z: 15.12, y: 1.0, rot: 0, w: 1.5, label: `RESUS ${n}` },
      { id: `${id}_cpr`, kind: 'cprDevice', room: id, x: V(1.55), z: 15.12, rot: 0, label: west ? undefined : 'mirror' },
      { id: `${id}_warmer`, kind: 'warmer', room: id, x: U(0.4), z: 15.5, rot: 0 },
      { id: `${id}_rapid`, kind: 'rapidInfuser', room: id, x: U(0.55), z: 23.35, rot: PI },
      { id: `${id}_gloves`, kind: 'gloveStation', room: id, x: U(1.5), z: 23.88, y: 1.0, rot: PI },
      { id: `${id}_us`, kind: 'pocus', room: id, x: U(2.85), z: 23.3, rot: PI },
      { id: `${id}_shelves`, kind: 'binShelf', room: id, x: U(3.1), z: 23.88, y: 1.66, rot: PI, w: 1.3 },
    );
  }
}

/**
 * The CT suite (x 32–40) and the X-ray room (x 40–48), both z 0–7, north of the hub.
 *
 * CT: one room with a lead-lined partition at x 37.2 (client/src/world/imaging.ts builds it, with a
 * lead-glass window and a connecting door) between the scan room and the control room. The scan
 * room's door (1.4 m, a stretcher's width) opens from the hub; the control room keeps the old wide
 * doorway (a pocket slider) and the room's entry, so walking times to "CT" are what they were. Scan
 * room: gantry and couch (head of the patient toward the gantry), a power injector at the patient's
 * right arm, oxygen and suction, a supply cabinet, a hand-wash sink, lead aprons on the partition.
 * Control room: the console along the window (radiographer facing the gantry), a contrast warmer,
 * supplies and the contrast-reaction card.
 *
 * X-ray: a floating-top table, a ceiling-mounted tube on rails, a chest wall stand on the east wall, a
 * lead-screened control booth in the south-east corner, the generator cabinet, a changing cubicle,
 * positioning aids, portable detectors and aprons. Outside both: the "X-RAY IN USE" light and the
 * radiation and pregnancy signs. The scan-room table spot is the patient's hips at the couch's
 * loading position (imagingPlan.ts moves the couch from there).
 */
function buildImagingSuites(rooms: RoomDef[], props: PropDef[]) {
  const H = PI / 2;
  rooms.push({
    id: 'ct',
    label: 'CT',
    kind: 'imaging',
    rect: { x: 32, z: 0, w: 8, d: 7 },
    doors: [
      // the scan room's (the room sign goes over it), then the control room's
      { side: 's', offset: 2.8, width: 1.4, kind: 'door' },
      { side: 's', offset: 5.5, width: 1.8, kind: 'sliding', pocket: true },
    ],
    floor: '#d3d6dc',
    wall: '#e9ecf2',
    sign: 'CT',
    signSide: 's',
    spots: {
      table: { x: 34.55, z: 3.16, rot: 0 },
      tech: { x: 38.6, z: 2.05, rot: -H },
      entry: { x: 38.4, z: 6.2, rot: PI },
    },
    entry: { x: 38.4, z: 6.2, rot: PI },
  });
  props.push(
    // gantry (origin: the scan plane on the floor) and couch, its foot toward the door
    { id: 'ct_scanner', kind: 'ctScanner', room: 'ct', x: 34.55, z: 1.7, rot: 0 },
    { id: 'ct_injector', kind: 'ctInjector', room: 'ct', x: 33.3, z: 2.8, rot: H },
    { id: 'ct_gas', kind: 'gasPanel', room: 'ct', x: 32.12, z: 2.0, y: 1.2, rot: H },
    { id: 'ct_cab', kind: 'cabinet', room: 'ct', x: 32.37, z: 4.6, rot: H, w: 1.3, d: 0.5, h: 2.0, solid: true },
    { id: 'ct_sink', kind: 'sink', room: 'ct', x: 33.3, z: 6.55, rot: PI },
    { id: 'ct_stool', kind: 'stepStool', room: 'ct', x: 35.25, z: 4.05, rot: -H },
    { id: 'ct_aprons', kind: 'apronRack', room: 'ct', x: 37.13, z: 3.75, y: 1.12, rot: -H, w: 0.9 },
    // control room
    { id: 'ct_console', kind: 'ctConsole', room: 'ct', x: 37.67, z: 2.0, rot: H, w: 2.6, d: 0.8 },
    { id: 'ctc_cab', kind: 'cabinet', room: 'ct', x: 39.63, z: 0.9, rot: -H, w: 1.2, d: 0.5, h: 2.0, solid: true },
    { id: 'ctc_warmer', kind: 'contrastWarmer', room: 'ct', x: 39.6, z: 2.5, rot: -H, solid: true },
    { id: 'ctc_card', kind: 'poster', room: 'ct', x: 39.88, z: 3.95, y: 1.15, rot: -H, w: 0.42, h: 0.56, color: '#b8231f', label: 'CONTRAST REACTION|Stop the injection. Call for help.|Hives only: antihistamine, watch|Wheeze or BP drop: anaphylaxis|Adrenaline 0.5 mg IM (1 mg/mL)|O₂ 15 L, legs up, fluid bolus|Emergency team: x2222' },
    // the hub side: warning light, radiation and pregnancy signs, the control room's sign
    { id: 'ct_warn', kind: 'xrayWarn', room: 'hub', x: 36.3, z: 7.0, y: 2.52, rot: 0 },
    { id: 'ct_rad', kind: 'radSign', room: 'hub', x: 34.35, z: 7.0, y: 1.45, rot: 0, w: 0.3, h: 0.4, label: 'rad' },
    { id: 'ct_preg', kind: 'radSign', room: 'hub', x: 33.65, z: 7.0, y: 1.45, rot: 0, w: 0.42, h: 0.32, label: 'preg' },
    { id: 'ctc_sign', kind: 'wallSign', room: 'hub', x: 38.4, z: 7.0, y: 2.47, rot: 0, w: 1.2, h: 0.3, label: 'CT CONTROL' },
    // the control room's hand rub, outside and in (shared/hygiene.ts places the scan room's)
    { id: 'ctc_rub_out', kind: 'handRub', room: 'hub', x: 39.6, z: 7.0, y: 1.1, rot: 0 },
    { id: 'ctc_rub_in', kind: 'handRub', room: 'ct', x: 39.6, z: 6.88, y: 1.1, rot: PI },
  );

  rooms.push({
    id: 'xray',
    label: 'X-Ray',
    kind: 'imaging',
    rect: { x: 40, z: 0, w: 8, d: 7 },
    doors: [{ side: 's', offset: 0.6, width: 1.8, kind: 'door' }],
    floor: '#d3d6dc',
    wall: '#e9ecf2',
    sign: 'X-RAY',
    signSide: 's',
    spots: {
      // on the table, head west; standing at the chest stand, facing it
      table: { x: 43.3, z: 2.35, rot: H },
      wallStand: { x: 47.25, z: 3.6, rot: H },
      tech: { x: 46.7, z: 5.95, rot: PI },
      entry: { x: 41.5, z: 6.2, rot: PI },
    },
    entry: { x: 41.5, z: 6.2, rot: PI },
  });
  props.push(
    { id: 'xray_table', kind: 'xrayTable', room: 'xray', x: 43.3, z: 2.35, rot: H, solid: true },
    // ceiling rails (origin: the middle of the rail system, on the floor)
    { id: 'xray_tube', kind: 'xrayTube', room: 'xray', x: 44.25, z: 2.6 },
    { id: 'xray_stand', kind: 'wallStand', room: 'xray', x: 47.88, z: 3.6, rot: -H },
    { id: 'xray_console', kind: 'xrayConsole', room: 'xray', x: 46.74, z: 5.08, rot: 0, w: 2.1, d: 0.55 },
    { id: 'xray_gen', kind: 'xrayGenerator', room: 'xray', x: 47.53, z: 0.95, rot: -H, solid: true },
    { id: 'xray_aprons', kind: 'apronRack', room: 'xray', x: 40.12, z: 3.7, y: 1.12, rot: H, w: 0.9 },
    { id: 'xray_aids', kind: 'aidShelf', room: 'xray', x: 45.0, z: 0.12, rot: 0 },
    { id: 'xray_det', kind: 'detectorRack', room: 'xray', x: 46.25, z: 0.12, y: 0.75, rot: 0 },
    { id: 'xray_cubicle', kind: 'changeCubicle', room: 'xray', x: 40.72, z: 0.77, rot: 0 },
    { id: 'xray_stool', kind: 'stepStool', room: 'xray', x: 42.45, z: 3.2, rot: 0 },
    { id: 'xray_warn', kind: 'xrayWarn', room: 'hub', x: 42.45, z: 7.0, y: 2.52, rot: 0 },
    { id: 'xray_rad', kind: 'radSign', room: 'hub', x: 43.25, z: 7.0, y: 1.45, rot: 0, w: 0.3, h: 0.4, label: 'rad' },
    { id: 'xray_preg', kind: 'radSign', room: 'hub', x: 43.95, z: 7.0, y: 1.45, rot: 0, w: 0.42, h: 0.32, label: 'preg' },
  );
}

function buildEdLayout(): LayoutDef {
  const rooms: RoomDef[] = [];
  const props: PropDef[] = [];

  // North row: six curtained bays
  for (let i = 1; i <= 6; i++) {
    const b = bay(i);
    rooms.push(b.room);
    props.push(...b.props);
  }

  // Resus 3 (id 'resus', kept for content and cases): the third resuscitation room, across the hub
  // from Resus 1 and 2 at the ambulance entrance (buildResusSuite)
  rooms.push({
    id: 'resus',
    label: 'Resus 3',
    kind: 'resus',
    rect: { x: 24, z: 0, w: 8, d: 7 },
    doors: [{ side: 's', offset: 2.5, width: 3, kind: 'sliding' }],
    floor: '#c9d4dc',
    wall: '#f3e9e6',
    sign: 'RESUS 3',
    signSide: 's',
    spots: {
      bed: { x: 28, z: 2.6, rot: 0 },
      bedside: { x: 29.3, z: 3.4, rot: -PI / 2 },
      bedside_l: { x: 26.7, z: 3.4, rot: PI / 2 },
      head: { x: 28, z: 0.9, rot: 0 },
      foot: { x: 28, z: 4.8, rot: PI },
      entry: { x: 28, z: 6.2, rot: PI },
    },
    entry: { x: 28, z: 6.2, rot: PI },
  });
  props.push(
    { id: 'resus_bed', kind: 'stretcher', room: 'resus', x: 28, z: 2.6, rot: 0, bay: 'resus', solid: true },
    { id: 'resus_monitor', kind: 'monitor', room: 'resus', x: 29.8, z: 0.35, y: 1.6, rot: 0, interact: 'monitor', bay: 'resus' },
    { id: 'resus_crash', kind: 'crashCart', room: 'resus', x: 31.2, z: 1.5, rot: -PI / 2, solid: true },
    { id: 'resus_us', kind: 'ultrasound', room: 'resus', x: 25.0, z: 1.6, rot: PI / 2, solid: true },
    { id: 'resus_cab', kind: 'cabinet', room: 'resus', x: 31.5, z: 4.8, rot: -PI / 2, w: 1.6, d: 0.5, h: 2.0, solid: true },
  );

  // CT suite and X-ray room (x 32–48 north of the hub)
  buildImagingSuites(rooms, props);

  // Central hub / corridor with the nurses' station island
  rooms.push({
    id: 'hub',
    label: 'Main corridor',
    kind: 'corridor',
    rect: { x: 0, z: 7, w: 48, d: 8 },
    // east: opening to the east wing's hospital street (starts at z 9.85, clear of the extinguisher cabinet at z 9.6)
    doors: [{ side: 'e', offset: 2.85, width: 3.15, kind: 'open' }],
    openSides: ['n', 's'],
    floor: FLOOR_HUB,
    wall: WALL,
    spots: {
      center: { x: 22, z: 8.2 },
      west: { x: 4, z: 11 },
      east: { x: 44, z: 11 },
      bays: { x: 12, z: 8.2 },
    },
    entry: { x: 14, z: 11 },
  });
  rooms.push({
    id: 'station',
    label: "Nurses' station",
    kind: 'station',
    rect: { x: 16, z: 9.4, w: 12, d: 3.2 },
    doors: [],
    openSides: ['n', 's', 'e', 'w'],
    floor: '#cdd3cf',
    wall: WALL,
    spots: {
      'desk-1': { x: 17.6, z: 10.65, rot: PI },
      'desk-2': { x: 20.0, z: 10.65, rot: PI },
      'desk-3': { x: 22.4, z: 10.65, rot: PI },
      'desk-4': { x: 24.8, z: 10.65, rot: PI },
      'desk-5': { x: 19.0, z: 11.4, rot: 0 },
      'desk-6': { x: 23.0, z: 11.4, rot: 0 },
      phone: { x: 21.0, z: 11.4, rot: 0 },
      board: { x: 22, z: 11.0 },
    },
    entry: { x: 27.2, z: 11.0, rot: -PI / 2 },
  });
  // station island: north & south counters, west end closed, east end open
  props.push(
    { id: 'st_counter_n', kind: 'counter', room: 'station', x: 21.8, z: 9.75, w: 11.6, d: 0.7, h: 1.05, rot: 0, solid: true },
    { id: 'st_counter_s', kind: 'counter', room: 'station', x: 21.8, z: 12.25, w: 11.6, d: 0.7, h: 1.05, rot: 0, solid: true },
    { id: 'st_counter_w', kind: 'counter', room: 'station', x: 16.35, z: 11.0, w: 0.7, d: 1.8, h: 1.05, rot: 0, solid: true },
    { id: 'st_pc_1', kind: 'computer', room: 'station', x: 17.6, z: 9.85, y: 1.05, rot: 0, interact: 'computer', label: 'Workstation 1' },
    { id: 'st_pc_2', kind: 'computer', room: 'station', x: 20.0, z: 9.85, y: 1.05, rot: 0, interact: 'computer', label: 'Workstation 2' },
    { id: 'st_pc_3', kind: 'computer', room: 'station', x: 22.4, z: 9.85, y: 1.05, rot: 0, interact: 'computer', label: 'Workstation 3' },
    { id: 'st_pc_4', kind: 'computer', room: 'station', x: 24.8, z: 9.85, y: 1.05, rot: 0, interact: 'computer', label: 'Workstation 4' },
    { id: 'st_pc_5', kind: 'computer', room: 'station', x: 19.0, z: 12.15, y: 1.05, rot: PI, interact: 'computer', label: 'Workstation 5' },
    { id: 'st_pc_6', kind: 'computer', room: 'station', x: 23.0, z: 12.15, y: 1.05, rot: PI, interact: 'computer', label: 'Workstation 6' },
    { id: 'st_phone', kind: 'phone', room: 'station', x: 21.0, z: 12.1, y: 1.05, rot: PI, interact: 'phone', label: 'Station phone' },
    { id: 'st_printer', kind: 'printer', room: 'station', x: 26.2, z: 12.2, y: 1.05, rot: PI },
    { id: 'st_chair_1', kind: 'chair', room: 'station', x: 17.6, z: 10.6, rot: PI },
    { id: 'st_chair_2', kind: 'chair', room: 'station', x: 20.0, z: 10.6, rot: PI },
    { id: 'st_chair_3', kind: 'chair', room: 'station', x: 22.4, z: 10.6, rot: PI },
    { id: 'st_chair_4', kind: 'chair', room: 'station', x: 24.8, z: 10.6, rot: PI },
    { id: 'st_chair_5', kind: 'chair', room: 'station', x: 19.0, z: 11.45, rot: 0 },
    { id: 'st_chair_6', kind: 'chair', room: 'station', x: 23.0, z: 11.45, rot: 0 },
    // double-sided tracking board hanging above the station
    { id: 'board_main', kind: 'board', room: 'station', x: 22, z: 11.0, y: 1.95, w: 3.2, h: 0.9, rot: 0, interact: 'board', label: 'Tracking board' },
    { id: 'hub_plant_w', kind: 'plant', room: 'hub', x: 0.6, z: 14.3, solid: true },
    { id: 'hub_trash', kind: 'trash', room: 'hub', x: 15.2, z: 14.5, solid: true },
    { id: 'hub_cart', kind: 'cart', room: 'hub', x: 33.5, z: 7.6, rot: PI / 2, solid: true },
    // parked at the station island's closed west end, out of both lanes (at x 10.5, z 7.5 it stood in
    // Bed 3's curtain opening, and against a bay partition it bent the routes into the bays)
    { id: 'hub_vitals', kind: 'vitalsMachine', room: 'hub', x: 15.6, z: 11.0, rot: -PI / 2, solid: true },
  );

  // South row
  rooms.push({
    id: 'waiting',
    label: 'Waiting room',
    kind: 'waiting',
    rect: { x: 0, z: 15, w: 10, d: 9 },
    doors: [
      { side: 'n', offset: 3.5, width: 2.4, kind: 'sliding' },
      { side: 's', offset: 3.8, width: 2.4, kind: 'sliding', exterior: true },
    ],
    floor: '#d8d0c2',
    wall: '#efe7da',
    sign: 'WAITING',
    signSide: 'n',
    spots: Object.fromEntries([
      ...Array.from({ length: 6 }, (_, i) => [`chair-${i + 1}`, { x: 1.2 + i * 0.75, z: 18.2, rot: 0 }]),
      ...Array.from({ length: 6 }, (_, i) => [`chair-${i + 7}`, { x: 1.2 + i * 0.75, z: 20.9, rot: PI }]),
      // seats along the walls (a full evening needs them): chair-13…22
      ...WAITING_WALL_CHAIRS.map((c, i) => [`chair-${i + 13}`, { x: c.x, z: c.z, rot: c.rot }]),
      // the clerk's office chair, behind the registration counter, facing the room
      ['desk', { x: 9.35, z: 20.6, rot: -PI / 2 }],
      ['door', { x: 5.0, z: 23.2, rot: PI }],
      ['entry', { x: 4.7, z: 16.2, rot: 0 }],
    ]),
    entry: { x: 4.7, z: 16.2, rot: 0 },
  });
  for (let i = 0; i < 6; i++) {
    props.push({ id: `w_chair_a${i}`, kind: 'chair', room: 'waiting', solid: true, x: 1.2 + i * 0.75, z: 18.2, rot: 0 });
    props.push({ id: `w_chair_b${i}`, kind: 'chair', room: 'waiting', solid: true, x: 1.2 + i * 0.75, z: 20.9, rot: PI });
  }
  WAITING_WALL_CHAIRS.forEach((c, i) => props.push({ id: `w_chair_d${i}`, kind: 'chair', room: 'waiting', solid: true, x: c.x, z: c.z, rot: c.rot }));
  props.push(
    // Registration counter, 1.1 m deep: a raised transaction ledge on the public (west) side,
    // x 7.89–8.35, and a 0.6 m work surface behind it, x 8.35–8.95. The clerk sits between the
    // counter and the east wall. At 2.6 m deep the work surface reached the wall, so the clerk sat
    // beside the counter with his shoulder inside it.
    { id: 'w_desk', kind: 'desk', room: 'waiting', x: 8.45, z: 20.6, w: 1.6, d: 1.1, h: 1.05, rot: -PI / 2, label: 'Registration', solid: true },
    { id: 'w_desk_chair', kind: 'chair', room: 'waiting', x: 9.35, z: 20.6, rot: -PI / 2 },
    // on the work surface (top at 0.775), screen toward the clerk
    { id: 'w_pc', kind: 'computer', room: 'waiting', x: 8.62, z: 20.85, y: 0.775, rot: PI / 2 },
    { id: 'w_tv', kind: 'tv', room: 'waiting', x: 0.16, z: 19.6, y: 2.0, rot: PI / 2 }, // on the west wall's face (wall 0–0.12, TV 5 cm deep)
    // 0.8 m deep: its back clears the wall face (x 0.12) and the handrail on it (x 0.6 had it 2 cm into both)
    { id: 'w_vending', kind: 'vending', room: 'waiting', x: 0.62, z: 23.0, rot: PI / 2, solid: true },
    { id: 'w_plant', kind: 'plant', room: 'waiting', x: 9.3, z: 23.3, solid: true },
  );

  rooms.push({
    id: 'triage',
    label: 'Triage',
    kind: 'triage',
    rect: { x: 10, z: 15, w: 5, d: 9 },
    // Only the corridor door. A west door (offset 5.6) opened onto the back of the waiting room's
    // wall: each room cuts openings only for its own doors, and the waiting room had none there.
    doors: [{ side: 'n', offset: 1.6, width: 1.4, kind: 'door' }],
    floor: FLOOR_ROOM,
    wall: '#e8efe9',
    sign: 'TRIAGE',
    signSide: 'n',
    spots: {
      // in her desk chair, at her screen
      nurse: { x: 13.6, z: 19.0, rot: PI / 2 },
      patient: { x: 11.8, z: 19.0, rot: PI / 2 },
      entry: { x: 12.3, z: 16.0, rot: 0 },
    },
    entry: { x: 12.3, z: 16.0, rot: 0 },
  });
  props.push(
    { id: 'tr_desk', kind: 'desk', room: 'triage', x: 14.2, z: 19.0, w: 1.4, d: 0.7, h: 0.78, rot: -PI / 2, solid: true },
    { id: 'tr_pc', kind: 'computer', room: 'triage', x: 14.4, z: 19.0, y: 0.78, rot: -PI / 2, interact: 'computer', label: 'Triage workstation' },
    // the triage nurse's rolling desk chair (props.ts: an id with "desk" is an office chair), facing her screen;
    // its casters clear the desk's drawer pedestal (z 19.19–19.61)
    { id: 'tr_desk_chair', kind: 'chair', room: 'triage', x: 13.6, z: 19.0, rot: PI / 2 },
    { id: 'tr_chair', kind: 'chair', room: 'triage', x: 11.8, z: 19.0, rot: PI / 2 },
    { id: 'tr_vitals', kind: 'vitalsMachine', room: 'triage', x: 11.2, z: 17.6, solid: true },
  );

  const ft = (n: number, x0: number) => {
    const id = `ft_${n}`;
    rooms.push({
      id,
      label: `Fast Track ${n}`,
      kind: 'room',
      rect: { x: x0, z: 15, w: 5, d: 9 },
      doors: [{ side: 'n', offset: 1.8, width: 1.4, kind: 'door' }],
      floor: FLOOR_ROOM,
      wall: n === 1 ? '#e6eef2' : '#eef0e4',
      sign: `FAST TRACK ${n}`,
      signSide: 'n',
      spots: {
        bed: { x: x0 + 2.5, z: 20.4, rot: PI },
        bedside: { x: x0 + 1.2, z: 19.6, rot: PI / 2 },
        // The exam stool occupies 'bedside'. The wheelchair fits just beyond it on the patient's open side.
        discharge: { x: x0 + 1.2, z: 20.65, rot: PI },
        // A long ambulance trolley parks on the open side, opposite the exam stool.
        intakeTrolley: { x: x0 + 3.65, z: 20.4, rot: PI },
        bedside_l: { x: x0 + 3.8, z: 19.6, rot: -PI / 2 },
        chair: { x: x0 + 4.2, z: 22.6, rot: -PI / 2 },
        entry: { x: x0 + 2.5, z: 16.2, rot: 0 },
      },
      entry: { x: x0 + 2.5, z: 16.2, rot: 0 },
    });
    props.push(
      { id: `${id}_bed`, kind: 'stretcher', room: id, x: x0 + 2.5, z: 20.4, rot: PI, bay: id, solid: true },
      { id: `${id}_monitor`, kind: 'monitor', room: id, x: x0 + 1.0, z: 23.65, y: 1.55, rot: PI, interact: 'monitor', bay: id },
      { id: `${id}_sink`, kind: 'sink', room: id, x: x0 + 4.55, z: 17.2, rot: -PI / 2 },
      { id: `${id}_chair`, kind: 'chair', room: id, x: x0 + 4.2, z: 22.6, rot: -PI / 2 },
      { id: `${id}_stool`, kind: 'stool', room: id, x: x0 + 1.2, z: 19.6 },
    );
  };
  ft(1, 15);
  ft(2, 20);

  rooms.push({
    id: 'workroom',
    label: 'Physician workroom',
    kind: 'office',
    rect: { x: 25, z: 15, w: 6, d: 9 },
    doors: [{ side: 'n', offset: 1.0, width: 1.4, kind: 'door' }],
    floor: '#cfc8bb',
    wall: '#ece6dc',
    sign: 'PHYSICIANS',
    signSide: 'n',
    spots: {
      'desk-a': { x: 29.6, z: 18.4, rot: -PI / 2 },
      'desk-b': { x: 27.2, z: 22.6, rot: 0 },
      'desk-c': { x: 29.0, z: 22.6, rot: 0 },
      couch: { x: 25.9, z: 21.0, rot: PI / 2 },
      entry: { x: 25.9, z: 16.2, rot: 0 },
    },
    entry: { x: 25.9, z: 16.2, rot: 0 },
  });
  props.push(
    { id: 'wr_desk_a', kind: 'desk', room: 'workroom', x: 30.4, z: 18.4, w: 1.6, d: 0.8, h: 0.78, rot: -PI / 2, solid: true },
    { id: 'wr_pc_a', kind: 'computer', room: 'workroom', x: 30.55, z: 18.4, y: 0.78, rot: -PI / 2, interact: 'computer', label: 'Attending workstation' },
    { id: 'wr_desk_b', kind: 'desk', room: 'workroom', x: 28.1, z: 23.4, w: 3.2, d: 0.8, h: 0.78, rot: 0, solid: true },
    { id: 'wr_pc_b', kind: 'computer', room: 'workroom', x: 27.2, z: 23.5, y: 0.78, rot: PI, interact: 'computer', label: 'Resident workstation 1' },
    { id: 'wr_pc_c', kind: 'computer', room: 'workroom', x: 29.0, z: 23.5, y: 0.78, rot: PI, interact: 'computer', label: 'Resident workstation 2' },
    { id: 'wr_phone', kind: 'phone', room: 'workroom', x: 30.1, z: 23.5, y: 0.78, rot: PI, interact: 'phone', label: 'Workroom phone' },
    { id: 'wr_chair_a', kind: 'chair', room: 'workroom', x: 29.6, z: 18.4, rot: -PI / 2 },
    { id: 'wr_chair_b', kind: 'chair', room: 'workroom', x: 27.2, z: 22.6, rot: 0 },
    { id: 'wr_chair_c', kind: 'chair', room: 'workroom', x: 29.0, z: 22.6, rot: 0 },
    { id: 'wr_sofa', kind: 'sofa', room: 'workroom', x: 25.55, z: 20.6, rot: PI / 2, solid: true },
    { id: 'wr_white', kind: 'whiteboard', room: 'workroom', x: 30.94, z: 21.4, y: 1.0, rot: -PI / 2 },
    { id: 'wr_coffee', kind: 'coffee', room: 'workroom', x: 30.6, z: 15.6, rot: -PI / 2, solid: true },
  );

  rooms.push({
    id: 'medroom',
    label: 'Medication room',
    kind: 'utility',
    rect: { x: 31, z: 15, w: 4, d: 9 },
    doors: [{ side: 'n', offset: 1.3, width: 1.4, kind: 'door' }],
    floor: '#d0d4d8',
    wall: '#e4e9ee',
    sign: 'MEDS',
    signSide: 'n',
    spots: {
      dispenser: { x: 33.0, z: 19.4, rot: 0 },
      entry: { x: 32.0, z: 16.2, rot: 0 },
    },
    entry: { x: 32.0, z: 16.2, rot: 0 },
  });
  props.push(
    { id: 'med_disp', kind: 'medDispenser', room: 'medroom', x: 33.0, z: 20.6, rot: PI, solid: true },
    { id: 'med_fridge', kind: 'fridge', room: 'medroom', x: 34.5, z: 22.8, rot: -PI / 2, solid: true },
    // controlled drugs: a locked steel cupboard on the east wall, the register on a shelf below it
    { id: 'med_cd', kind: 'cdCupboard', room: 'medroom', x: 34.73, z: 17.4, y: 1.25, w: 0.6, h: 0.7, d: 0.3, rot: -PI / 2 },
    { id: 'med_sink', kind: 'sink', room: 'medroom', x: 31.45, z: 22.6, rot: PI / 2 },
  );

  // Ambulance entrance with Resus 1 and 2 on either side of its corridor (x 35–48)
  buildResusSuite(rooms, props);

  // Exterior (night parking lot + ambulance bay)
  props.push(
    { id: 'ext_ambulance', kind: 'ambulance', room: 'exterior', x: 41.6, z: 28.6, rot: 0, solid: true },
    { id: 'ext_lamp_1', kind: 'lamp', room: 'exterior', x: 30, z: 27.5 },
    { id: 'ext_lamp_2', kind: 'lamp', room: 'exterior', x: 14, z: 27.5 },
    { id: 'ext_sign', kind: 'sign', room: 'exterior', x: 41.6, z: 27.58, y: 2.98, rot: 0, label: 'EMERGENCY', color: '#e0322d' },
    { id: 'ext_sign_w', kind: 'sign', room: 'exterior', x: 5.0, z: 24.32, y: 3.08, rot: 0, label: 'EMERGENCY — WALK-IN', color: '#e0322d' },
  );

  // East wing (x 48–72): hospital street, stairs + elevators, cafeteria, restrooms, outpatient clinic
  const wing = buildEastWing(rooms, props);

  // hand rub at every patient space's entrance (outside and in), soap + rub + towels + bin at every
  // sink, masks at the entrances and the station: placed by rule (shared/hygiene.ts)
  props.push(...hygienePlan(rooms, props, { masks: true }).props);

  return {
    id: 'ed',
    name: 'Grand Therapies Medical Center — Emergency Department',
    width: 72,
    depth: 24,
    wallHeight: 3,
    rooms,
    props,
    ramps: wing.ramps,
    landings: wing.landings,
    playerSpawn: { x: 11.0, z: 12.4, rot: 2.05 },
    exterior: { rect: { x: -12, z: 24, w: 96, d: 18 }, ground: '#2b2f33' },
  };
}

const ed = buildEdLayout();
export const HALL_BEDS = ['hall_1', 'hall_2', 'hall_3', 'hall_4', 'hall_5', 'hall_6'] as const;

function surgeLayout(): LayoutDef {
  // Leave the stretcher and its pusher a full unloading apron behind the ambulance.
  const props = ed.props.map(p => p.kind === 'ambulance' ? { ...p, z: p.z + 4.2 } : p);
  // Park lengthwise in the wide main corridor, clear of bay curtains, doors and the station island.
  const positions = [[2.1, 10.5], [5.35, 10.5], [8.6, 10.5], [32.3, 11.1], [35.6, 11.1], [38.9, 11.1]];
  const treatmentSpaces = HALL_BEDS.map((id, i): RoomDef => {
    const [x, z] = positions[i];
    const bed = { x, z, rot: PI / 2 };
    const bedside = { x, z: z + 0.98, rot: PI };
    props.push({ id: id + '_stretcher', kind: 'stretcher', room: 'hub', bay: id, ...bed, solid: true });
    return { id, label: 'Hall ' + (i + 1), kind: 'room', rect: { x: x - 1.53, z: z - 1.35, w: 3.06, d: 2.75 },
      doors: [], floor: FLOOR_HUB, wall: WALL, entry: bedside,
      spots: { bed, entry: bedside, bedside, bedside_l: { x, z: z - 0.98, rot: 0 },
        foot: { x: x + 1.35, z, rot: -PI / 2 }, head: { x: x - 1.35, z, rot: PI / 2 }, discharge: bedside } };
  });
  return { ...ed, id: 'ed_surge', baseLayoutId: ed.id, treatmentSpaces, props,
    playerSpawn: { x: 11.2, z: 12.7, rot: Math.atan2(5.35 - 11.2, 10.5 - 12.7) } };
}

export const LAYOUTS: Record<string, LayoutDef> = {
  ed, ed_surge: surgeLayout(),
};
