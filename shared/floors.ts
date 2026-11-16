/**
 * Upper floors and the elevators that serve them (geometry only — safe to ship to clients).
 *
 * The ground floor is `layout.rooms` / `layout.props`. Each upper level keeps its own rooms and
 * props here, outside the LayoutDef, so everything that lists the map's rooms (the AI agents' move
 * tool and observation text, scoring, the waiting-room crowd) is unchanged. Room ids are unique
 * across levels; `roomAnyLevel`, `locationLabel` and `walkSecondsAny` resolve both.
 *
 * Floor 2 of the ED layout ("Ward 2 East", a medical inpatient unit) sits over the east wing:
 * x 48–72 × z 0–20 at y 3.0 (a 3.0 m storey: Stair 1's upper landing is its floor). It repeats the
 * ground floor's plan where it can: the elevator lobby over the lobby, the ward corridor over the
 * hospital street (same 4 m), Stair 1 (a double-height core) rising through both. Elevators A and B
 * serve both floors from shafts behind the lobby's north wall (z < 0).
 *
 *   north (z 0–9):   Stair 1 · elevator lobby (51–56) · rooms 201–204 (56–72, north windows)
 *   corridor (z 9–13): end windows west (over the ED roof) and east
 *   south (z 13–20): staff lounge (48–53.5) · clean utility (53.5–57.5) · nurses' station
 *                    (57.5–63.5, open to the corridor, the medication room behind it) · rooms 205–206
 */
import type { LayoutDef, PropDef, Rect, RoomDef, Side, Spot } from './layout';
import { roomAt, roomById, walkSeconds } from './layout';
import { hygienePlan } from './hygiene';
import type { LocationId } from './types';

/** a window in a room's exterior wall (sill/head at SILL/HEAD above that floor) */
export interface WindowDef {
  room: LocationId;
  side: Side;
  /** from the wall's start (west end for n/s walls, north end for e/w) */
  offset: number;
  width: number;
}

/** an interior partition (a patient room's bathroom), 0.1 m thick, centred on the line; door gaps along it */
export interface PartitionDef {
  room: LocationId;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** door gaps: distance from (x1, z1) and width */
  doors?: { offset: number; width: number }[];
}

export interface LevelDef {
  /** 0 = ground floor (the layout itself), 1 = the floor above */
  index: number;
  /** "Floor 2" */
  name: string;
  /** finished floor level (m) */
  y: number;
  /** floor to ceiling (m) */
  height: number;
  /** outer footprint: façade lines, roof and parapet */
  outline: Rect;
  /** parts of the outline without a slab: a ground-floor room that rises through (Stair 1) */
  holes: Rect[];
  /** extra walkable strips at this level outside the rooms (door thresholds, elevator sills) */
  thresholds: Rect[];
  rooms: RoomDef[];
  props: PropDef[];
  windows: WindowDef[];
  partitions: PartitionDef[];
}

/** a bank of elevators: entrances in one wall line, a shaft behind it (z < wall line) */
export interface ElevatorBankDef {
  id: string;
  /** car ids and the x of each entrance's centre */
  cars: { id: string; x: number }[];
  /** the shafts' side of the lobby wall (its outer face, z) and its lobby face */
  wallZ: number;
  faceZ: number;
  /** hall call station between the entrances */
  callX: number;
  /** level index → that level's elevator lobby */
  lobbies: Record<number, LocationId>;
  /** clear entrance (bed elevator: 1.3 × 2.2 m) and the car's inside (w along x, d along −z, h) */
  door: { width: number; height: number };
  car: { w: number; d: number; h: number };
}

export const SILL = 0.95;
export const HEAD = 2.62;
const PI = Math.PI;

/** layout props the elevator bank builds itself (animated doors, lit buttons): the builder skips them */
export const ELEVATOR_PROPS = new Set<string>(['elevatorDoor', 'callPanel']);

// ───────────────────────────── Ward 2 East ─────────────────────────────

const Y2 = 3.0;
const WARD = '#e7ece6';
const WARD_ACCENT = '#e4ebf1';
const WARD_FLOOR = '#d5dad3';

type Out = { rooms: RoomDef[]; props: PropDef[]; windows: WindowDef[]; partitions: PartitionDef[] };

/**
 * A single patient room with an inboard bathroom by the corridor. `win` is the window wall (n or
 * s); the door is in the opposite wall. Bed head against the west wall (headwall services), facing
 * the TV on the east wall; a sofa bed for family under the window; wardrobe; hand-wash sink by the door.
 */
function patientRoom(num: number, x0: number, z0: number, W: number, D: number, win: 'n' | 's', out: Out, extraWindow?: WindowDef) {
  const id = `f2_room_${num}`;
  const door: Side = win === 'n' ? 's' : 'n';
  /** depth from the window wall (u) → z */
  const Z = (u: number) => (win === 'n' ? z0 + u : z0 + D - u);
  const along = win === 'n' ? 1 : -1; // +u direction in z
  const bath = 2.65; // bathroom + entry, by the corridor
  const bw = 1.85; // bathroom width (east side)
  const xb = x0 + W - bw; // bathroom's west partition
  const ub = D - bath;
  const uBed = Math.min(3.2, ub - 2.0);
  const bedZ = Z(uBed);
  // the visitor's chair: a metre toward the window from the bed where the room is deep enough (9 m);
  // in the 7 m rooms that put it 5 cm off the sofa's front and 37 cm off the bed's foot (you couldn't
  // get to the sofa, nor round the bed's foot to its window side): there it stands against the TV
  // wall by the bed's foot, facing the bed, and the window side stays open
  const chair = uBed - 1.0 >= 2.2 ? { x: x0 + W - 1.25, z: Z(uBed - 1.0), rot: -PI / 2 - along * 0.5 } : { x: x0 + W - 0.42, z: Z(uBed + 0.25), rot: -PI / 2 };
  const towardRoom = win === 'n' ? 0 : PI; // yaw facing away from the window wall (sofa's back to the glass)
  const room: RoomDef = {
    id,
    label: `Room ${num}`,
    kind: 'room',
    rect: { x: x0, z: z0, w: W, d: D },
    doors: [{ side: door, offset: 0.25, width: 1.3, kind: 'door' }],
    floor: WARD_FLOOR,
    wall: num % 2 ? WARD : WARD_ACCENT,
    sign: String(num),
    signSide: door,
    spots: {
      bed: { x: x0 + 1.22, z: bedZ, rot: PI / 2 },
      bedside: { x: x0 + 1.25, z: bedZ - along * 0.95, rot: along > 0 ? PI : 0 },
      chair,
      sofa: { x: x0 + W / 2 + 0.55, z: Z(0.55), rot: towardRoom },
      sink: { x: xb - 0.35, z: Z(D - 0.8), rot: -PI / 2 },
      entry: { x: x0 + 0.9, z: Z(D - 0.9), rot: win === 'n' ? PI : 0 },
    },
    entry: { x: x0 + 0.9, z: Z(D - 0.9), rot: win === 'n' ? PI : 0 },
  };
  out.rooms.push(room);
  out.windows.push({ room: id, side: win, offset: W / 2 - 1.2, width: 2.4 });
  if (extraWindow) out.windows.push(extraWindow);
  // bathroom: the corridor-side 2.65 m of the east part; its door from the entry (west face)
  out.partitions.push(
    { room: id, x1: xb, z1: Z(ub), x2: x0 + W, z2: Z(ub) },
    { room: id, x1: xb, z1: Z(ub), x2: xb, z2: Z(D), doors: [{ offset: 0.2, width: 0.9 }] },
  );
  // the corridor face of the door wall (hand rub and handrail go there)
  const zc = win === 'n' ? z0 + D : z0;
  out.props.push(
    { id: `${id}_bed`, kind: 'bed', room: id, x: x0 + 1.22, z: bedZ, rot: PI / 2, bay: id, solid: true },
    { id: `${id}_iv`, kind: 'ivPole', room: id, x: x0 + 0.42, z: bedZ - along * 0.95 },
    { id: `${id}_chair`, kind: 'chair', room: id, ...chair, color: '#6f8f86', solid: true },
    { id: `${id}_sofa`, kind: 'sofa', room: id, x: x0 + W / 2 + 0.55, z: Z(0.55), rot: towardRoom, solid: true },
    { id: `${id}_tv`, kind: 'tv', room: id, x: x0 + W - 0.13, z: bedZ, y: 1.6, rot: -PI / 2 },
    { id: `${id}_care`, kind: 'poster', room: id, x: x0 + W - 0.126, z: bedZ + 1.15, y: 1.2, rot: -PI / 2, w: 0.42, h: 0.56, color: '#1f6f8b', label: `YOUR CARE TEAM|Room ${num}|Nurse: ________|Doctor: ________|Today is: ________|Goal for today:` },
    { id: `${id}_wardrobe`, kind: 'cabinet', room: id, x: xb + 0.9, z: Z(ub) - along * 0.33, rot: win === 'n' ? PI : 0, w: 1.4, d: 0.55, h: 2.05, solid: true },
    { id: `${id}_sink`, kind: 'sink', room: id, x: xb - 0.38, z: Z(D - 0.75), rot: -PI / 2, solid: true },
    { id: `${id}_rub`, kind: 'handRub', room: 'f2_corridor', x: x0 + 1.85, z: zc, y: 1.1, rot: win === 'n' ? 0 : PI },
    { id: `${id}_rail`, kind: 'handrail', room: 'f2_corridor', x: x0 + 2.05 + (W - 2.15) / 2, z: zc, rot: win === 'n' ? 0 : PI, w: W - 2.3 },
    // bathroom: wall-hung WC on the outer wall, basin by the corridor wall
    { id: `${id}_wc`, kind: 'toilet', room: id, x: x0 + W - 0.12, z: Z(ub + 0.85), rot: -PI / 2, label: 'accessible' },
    { id: `${id}_basin`, kind: 'vanity', room: id, x: xb + 1.0, z: Z(D - 0.12), w: 0.7, rot: win === 'n' ? PI : 0 },
  );
}

function buildWard2(): LevelDef {
  const rooms: RoomDef[] = [];
  const props: PropDef[] = [];
  const windows: WindowDef[] = [];
  const partitions: PartitionDef[] = [];
  const out: Out = { rooms, props, windows, partitions };

  // ── elevator lobby (over the ground-floor lobby): cars on the north wall, Stair 1's door on the west ──
  rooms.push({
    id: 'f2_lobby',
    label: 'Elevator lobby',
    kind: 'room',
    rect: { x: 51, z: 0, w: 5, d: 9 },
    doors: [
      // entrances of elevators A and B (the bank builds frames and doors) and Stair 1's door
      { side: 'n', offset: 0.64, width: 1.42, kind: 'open' },
      { side: 'n', offset: 2.94, width: 1.42, kind: 'open' },
      { side: 'w', offset: 4.02, width: 1.1, kind: 'open' },
      { side: 's', offset: 0.5, width: 4.0, kind: 'open' },
    ],
    floor: '#d8dbd6',
    wall: '#e7ece9',
    sign: 'ELEVATORS',
    signSide: 's',
    spots: {
      'elevator-1': { x: 52.35, z: 1.4, rot: PI },
      'elevator-2': { x: 54.65, z: 1.4, rot: PI },
      stair: { x: 51.7, z: 4.57, rot: -PI / 2 },
      entry: { x: 53.5, z: 6.6, rot: PI },
    },
    entry: { x: 53.5, z: 6.6, rot: PI },
  });
  props.push(
    { id: 'f2_lob_dir', kind: 'wallSign', room: 'f2_lobby', x: 55.88, z: 3.4, y: 1.15, rot: -PI / 2, w: 1.2, h: 0.85, color: '#0f4c5c', label: 'LEVEL 2 · WARD 2 EAST|Medical inpatients|Rooms 201–206 · Nurses\' station|Stair 1 · Elevators A + B|Visiting 10:00–20:00|Quiet hours 22:00–07:00' },
    { id: 'f2_lob_level', kind: 'wallSign', room: 'f2_lobby', x: 55.88, z: 1.35, y: 1.4, rot: -PI / 2, w: 0.5, h: 0.62, color: '#1d3f6e', label: '2|LEVEL' },
    { id: 'f2_lob_aed', kind: 'aed', room: 'f2_lobby', x: 51.12, z: 7.3, y: 1.15, rot: PI / 2 },
    { id: 'f2_lob_bench_1', kind: 'chair', room: 'f2_lobby', x: 55.45, z: 5.6, rot: -PI / 2, color: '#5a7f73', solid: true },
    { id: 'f2_lob_bench_2', kind: 'chair', room: 'f2_lobby', x: 55.45, z: 6.3, rot: -PI / 2, color: '#5a7f73', solid: true },
    { id: 'f2_lob_plant', kind: 'plant', room: 'f2_lobby', x: 55.45, z: 7.6, solid: true },
    { id: 'f2_lob_rub', kind: 'handRub', room: 'f2_lobby', x: 51.12, z: 6.2, y: 1.1, rot: PI / 2 },
    { id: 'f2_lob_quiet', kind: 'poster', room: 'f2_lobby', x: 51.12, z: 2.0, y: 1.25, rot: PI / 2, color: '#4b5d8c', label: 'QUIET PLEASE|Patients are resting.|Night-time quiet hours|22:00 – 07:00.|Thank you.' },
  );

  // ── the ward corridor, over the hospital street: end windows over the ED roof (west) and east ──
  rooms.push({
    id: 'f2_corridor',
    label: 'Ward corridor',
    kind: 'corridor',
    rect: { x: 48, z: 9, w: 24, d: 4 },
    doors: [],
    // north and south are closed by the neighbours' walls (their doors and signs face the corridor)
    openSides: ['n', 's'],
    floor: WARD_FLOOR,
    wall: WARD,
    spots: {
      west: { x: 49.8, z: 11.0, rot: -PI / 2 },
      center: { x: 60.5, z: 11.0 },
      east: { x: 70.2, z: 11.0, rot: PI / 2 },
    },
    entry: { x: 53.5, z: 11.0, rot: PI / 2 },
  });
  windows.push({ room: 'f2_corridor', side: 'w', offset: 0.8, width: 2.4 }, { room: 'f2_corridor', side: 'e', offset: 0.8, width: 2.4 });
  props.push(
    // ceiling-hung blade signs (front face toward people walking east from the lobby, as on the street)
    { id: 'f2_way_1', kind: 'hangingSign', room: 'f2_corridor', x: 56.3, z: 11.0, y: 2.3, w: 1.6, h: 0.46, rot: -PI / 2, label: '← Rooms 201–204|→ Nurses\' station · Meds|↑ Rooms 205–206||→ Elevators · Stair 1|← Staff lounge' },
    { id: 'f2_way_2', kind: 'hangingSign', room: 'f2_corridor', x: 66.0, z: 11.0, y: 2.3, w: 1.6, h: 0.46, rot: -PI / 2, label: '← 203 · 204|→ 205 · 206||↑ Elevators · Stair 1|← Nurses\' station' },
    // handrails on the neighbours' walls (the room templates add theirs)
    { id: 'f2_rail_n1', kind: 'handrail', room: 'f2_corridor', x: 49.5, z: 9.0, rot: 0, w: 2.6 },
    { id: 'f2_rail_s1', kind: 'handrail', room: 'f2_corridor', x: 50.0, z: 13.0, rot: PI, w: 3.4 },
    { id: 'f2_rail_s2', kind: 'handrail', room: 'f2_corridor', x: 56.3, z: 13.0, rot: PI, w: 1.9 },
    // resuscitation trolley in reach of the station, linen cart, a vital-signs stand
    { id: 'f2_crash', kind: 'crashCart', room: 'f2_corridor', x: 63.3, z: 9.38, rot: 0, solid: true },
    { id: 'f2_linen', kind: 'cart', room: 'f2_corridor', x: 70.9, z: 9.4, rot: 0, solid: true },
    { id: 'f2_wow', kind: 'vitalsMachine', room: 'f2_corridor', x: 49.6, z: 12.55, solid: true },
  );

  // ── patient rooms around the station: 201–204 on the north façade, 205–206 on the south (206 a corner room) ──
  for (let i = 0; i < 4; i++) patientRoom(201 + i, 56 + 4 * i, 0, 4, 9, 'n', out, i === 3 ? { room: 'f2_room_204', side: 'e', offset: 1.4, width: 2.4 } : undefined);
  patientRoom(205, 63.5, 13, 4.25, 7, 's', out);
  patientRoom(206, 67.75, 13, 4.25, 7, 's', out, { room: 'f2_room_206', side: 'e', offset: 3.6, width: 2.4 });

  // ── nurses' station: an open bay off the corridor at the heart of the ward ──
  // inner faces x 57.62–63.38, z 13–16.28; the counter leaves a way in at its east end
  rooms.push({
    id: 'f2_station',
    label: "Nurses' station",
    kind: 'station',
    rect: { x: 57.5, z: 13, w: 6, d: 3.4 },
    doors: [{ side: 's', offset: 4.4, width: 1.0, kind: 'open' }],
    openSides: ['n'],
    floor: '#cfd5d0',
    wall: '#e3ebe6',
    spots: {
      'desk-1': { x: 58.9, z: 14.42, rot: PI },
      'desk-2': { x: 60.2, z: 14.42, rot: PI },
      'desk-3': { x: 61.5, z: 14.42, rot: PI },
      board: { x: 59.8, z: 15.7, rot: PI },
      cart: { x: 62.9, z: 15.5, rot: PI },
      entry: { x: 62.9, z: 12.4, rot: 0 },
    },
    entry: { x: 62.9, z: 12.4, rot: 0 },
  });
  props.push(
    // reception counter facing the corridor: raised transaction top, work surface behind
    { id: 'f2_st_desk', kind: 'desk', room: 'f2_station', x: 60.2, z: 13.6, w: 4.4, d: 1.1, h: 1.05, rot: PI, label: 'Ward 2 East', solid: true },
    { id: 'f2_st_pc_1', kind: 'computer', room: 'f2_station', x: 58.9, z: 13.75, y: 0.775, rot: 0 },
    { id: 'f2_st_pc_2', kind: 'computer', room: 'f2_station', x: 60.2, z: 13.75, y: 0.775, rot: 0 },
    { id: 'f2_st_pc_3', kind: 'computer', room: 'f2_station', x: 61.5, z: 13.75, y: 0.775, rot: 0 },
    { id: 'f2_st_desk_chair_1', kind: 'chair', room: 'f2_station', x: 58.9, z: 14.42, rot: PI },
    { id: 'f2_st_desk_chair_2', kind: 'chair', room: 'f2_station', x: 60.2, z: 14.42, rot: PI },
    { id: 'f2_st_desk_chair_3', kind: 'chair', room: 'f2_station', x: 61.5, z: 14.42, rot: PI },
    { id: 'f2_st_side', kind: 'desk', room: 'f2_station', x: 57.97, z: 15.5, w: 1.2, d: 0.7, rot: PI / 2, solid: true },
    { id: 'f2_st_printer', kind: 'printer', room: 'f2_station', x: 57.95, z: 15.75, y: 0.78, rot: PI / 2 },
    { id: 'f2_st_phone', kind: 'phone', room: 'f2_station', x: 58.0, z: 15.2, y: 0.78, rot: PI / 2 },
    { id: 'f2_st_files', kind: 'cabinet', room: 'f2_station', x: 63.15, z: 14.55, rot: -PI / 2, w: 0.9, d: 0.45, h: 1.15, solid: true },
    { id: 'f2_st_rub', kind: 'handRub', room: 'f2_corridor', x: 57.62, z: 13.6, y: 1.1, rot: PI / 2 },
  );

  // ── medication room behind the station ──
  rooms.push({
    id: 'f2_meds',
    label: 'Medication room',
    kind: 'utility',
    rect: { x: 57.5, z: 16.4, w: 6, d: 3.6 },
    doors: [{ side: 'n', offset: 4.4, width: 1.0, kind: 'door' }],
    floor: '#d0d4d8',
    wall: '#e4e9ee',
    sign: 'MEDS',
    signSide: 'n',
    spots: { dispenser: { x: 59.7, z: 18.7, rot: PI }, entry: { x: 62.4, z: 17.2, rot: 0 } },
    entry: { x: 62.4, z: 17.2, rot: 0 },
  });
  props.push(
    { id: 'f2_med_disp', kind: 'medDispenser', room: 'f2_meds', x: 59.7, z: 19.57, rot: PI, solid: true },
    { id: 'f2_med_fridge', kind: 'fridge', room: 'f2_meds', x: 57.95, z: 19.35, rot: PI / 2, solid: true },
    { id: 'f2_med_bench', kind: 'desk', room: 'f2_meds', x: 63.08, z: 18.6, w: 1.8, d: 0.6, h: 0.92, rot: -PI / 2, solid: true },
    // the ward's controlled-drug cupboard over the bench (its key: the nurse in charge)
    { id: 'f2_med_cd', kind: 'cdCupboard', room: 'f2_meds', x: 63.23, z: 18.95, y: 1.35, w: 0.6, h: 0.65, d: 0.3, rot: -PI / 2 },
    { id: 'f2_med_sink', kind: 'sink', room: 'f2_meds', x: 57.88, z: 17.6, rot: PI / 2, solid: true },
    { id: 'f2_med_poster', kind: 'poster', room: 'f2_meds', x: 61.4, z: 19.88, y: 1.25, rot: PI, color: '#b3261e', label: 'SIX RIGHTS|Right patient · right drug|Right dose · right route|Right time|Right documentation|Two IDs, every time.' },
  );

  // ── staff lounge: windows over the ED roof (west) and south; kitchenette, table, sofa, lockers ──
  rooms.push({
    id: 'f2_lounge',
    label: 'Staff lounge',
    kind: 'office',
    rect: { x: 48, z: 13, w: 5.5, d: 7 },
    doors: [{ side: 'n', offset: 3.9, width: 1.1, kind: 'door' }],
    floor: '#cfc8bb',
    wall: '#ece6dc',
    sign: 'STAFF LOUNGE',
    signSide: 'n',
    spots: {
      couch: { x: 48.75, z: 16.4, rot: PI / 2 },
      'table-1': { x: 50.6, z: 18.4, rot: PI },
      coffee: { x: 52.7, z: 14.2, rot: -PI / 2 },
      entry: { x: 52.4, z: 14.0, rot: 0 },
    },
    entry: { x: 52.4, z: 14.0, rot: 0 },
  });
  windows.push({ room: 'f2_lounge', side: 'w', offset: 2.2, width: 2.4 }, { room: 'f2_lounge', side: 's', offset: 1.4, width: 2.4 });
  props.push(
    { id: 'f2_lng_sofa', kind: 'sofa', room: 'f2_lounge', x: 48.6, z: 16.4, rot: PI / 2, solid: true },
    { id: 'f2_lng_table', kind: 'cafeTable', room: 'f2_lounge', x: 50.6, z: 18.4, w: 0.8, d: 0.8, solid: true },
    { id: 'f2_lng_chair_1', kind: 'cafeChair', room: 'f2_lounge', x: 50.6, z: 17.78, rot: 0 },
    { id: 'f2_lng_chair_2', kind: 'cafeChair', room: 'f2_lounge', x: 50.6, z: 19.02, rot: PI },
    { id: 'f2_lng_chair_3', kind: 'cafeChair', room: 'f2_lounge', x: 51.22, z: 18.4, rot: -PI / 2 },
    { id: 'f2_lng_counter', kind: 'counter', room: 'f2_lounge', x: 53.05, z: 16.4, w: 2.4, d: 0.65, h: 0.92, rot: -PI / 2, solid: true },
    { id: 'f2_lng_coffee', kind: 'coffee', room: 'f2_lounge', x: 53.13, z: 14.2, rot: -PI / 2, solid: true },
    { id: 'f2_lng_fridge', kind: 'fridge', room: 'f2_lounge', x: 53.05, z: 18.6, rot: -PI / 2, solid: true },
    { id: 'f2_lng_lockers', kind: 'cabinet', room: 'f2_lounge', x: 49.5, z: 13.37, rot: 0, w: 2.4, d: 0.5, h: 1.95, solid: true },
    { id: 'f2_lng_board', kind: 'poster', room: 'f2_lounge', x: 51.2, z: 13.124, y: 1.25, rot: 0, w: 0.6, h: 0.5, color: '#3f8f4a', label: 'STAFF NOTICES|Rota swaps: ask Ana|Flu jabs Thursday 14:00|Fire drill next week|Whose mug is this?' },
    { id: 'f2_lng_plant', kind: 'plant', room: 'f2_lounge', x: 48.5, z: 19.5, solid: true },
  );

  // ── clean utility: linen, supplies, IV poles ──
  rooms.push({
    id: 'f2_utility',
    label: 'Clean utility',
    kind: 'utility',
    rect: { x: 53.5, z: 13, w: 4, d: 7 },
    doors: [{ side: 'n', offset: 0.4, width: 1.2, kind: 'door' }],
    floor: '#d0d4d8',
    wall: '#e4e9ee',
    sign: 'CLEAN UTILITY',
    signSide: 'n',
    spots: { entry: { x: 54.5, z: 14.0, rot: 0 } },
    entry: { x: 54.5, z: 14.0, rot: 0 },
  });
  props.push(
    { id: 'f2_ut_shelf_1', kind: 'cabinet', room: 'f2_utility', x: 57.07, z: 16.5, rot: -PI / 2, w: 2.4, d: 0.6, h: 2.0, label: 'linen', solid: true },
    { id: 'f2_ut_shelf_2', kind: 'cabinet', room: 'f2_utility', x: 55.5, z: 19.57, rot: PI, w: 2.6, d: 0.6, h: 2.0, solid: true },
    { id: 'f2_ut_cart', kind: 'cart', room: 'f2_utility', x: 53.98, z: 17.8, rot: PI / 2, solid: true },
    { id: 'f2_ut_iv_1', kind: 'ivPole', room: 'f2_utility', x: 54.0, z: 15.5 },
    { id: 'f2_ut_iv_2', kind: 'ivPole', room: 'f2_utility', x: 54.35, z: 15.3 },
    { id: 'f2_ut_vitals', kind: 'vitalsMachine', room: 'f2_utility', x: 56.7, z: 14.0, solid: true },
  );
  // soap, hand rub, towels and a bin at every sink; a dispenser inside each patient room by the door
  // (the corridor ones are above): by rule, as on the ground floor (shared/hygiene.ts)
  props.push(...hygienePlan(rooms, props, { partitions }).props);

  return {
    index: 1,
    name: 'Floor 2',
    y: Y2,
    height: 3.0,
    outline: { x: 48, z: 0, w: 24, d: 20 },
    holes: [{ x: 48, z: 0, w: 3, d: 9 }],
    // Stair 1's door (through the core's 0.12 m wall + the lobby's) and the elevator sills (to the car doors)
    thresholds: [
      { x: 50.8, z: 4.02, w: 0.35, d: 1.1 },
      { x: 51.7, z: -0.24, w: 1.3, d: 0.36 },
      { x: 54.0, z: -0.24, w: 1.3, d: 0.36 },
    ],
    rooms,
    props,
    windows,
    partitions,
  };
}

const UPPER: Record<string, LevelDef[]> = { ed: [buildWard2()] };

const ELEVATORS: Record<string, ElevatorBankDef[]> = {
  ed: [
    {
      id: 'east',
      cars: [
        { id: 'A', x: 52.35 },
        { id: 'B', x: 54.65 },
      ],
      wallZ: 0,
      faceZ: 0.12,
      callX: 53.5,
      lobbies: { 0: 'lobby', 1: 'f2_lobby' },
      door: { width: 1.3, height: 2.2 },
      car: { w: 1.6, d: 2.5, h: 2.4 },
    },
  ],
};

// ───────────────────────────── lookups ─────────────────────────────

/** the floors above the ground floor (none for most layouts) */
export function upperLevels(layout: LayoutDef): LevelDef[] {
  return UPPER[layout.baseLayoutId ?? layout.id] ?? [];
}

export function elevatorBanks(layout: LayoutDef): ElevatorBankDef[] {
  return ELEVATORS[layout.baseLayoutId ?? layout.id] ?? [];
}

/** the hoistway enclosure built against the bank's wall (outer faces): x0…x1 along the wall, z0…z1 behind it */
export function shaftExtent(bank: ElevatorBankDef): { x0: number; x1: number; z0: number; z1: number; top: number } {
  const xs = bank.cars.map((c) => c.x);
  const half = bank.car.w / 2 + 0.55;
  return { x0: Math.min(...xs) - half, x1: Math.max(...xs) + half, z0: bank.wallZ - bank.car.d - 0.6, z1: bank.wallZ, top: 7.4 };
}

/** number of storeys (1 = ground floor only) */
export function levelCount(layout: LayoutDef): number {
  return 1 + upperLevels(layout).length;
}

/** floor level (m) of a level index */
export function levelY(layout: LayoutDef, level: number): number {
  return level <= 0 ? 0 : (upperLevels(layout).find((l) => l.index === level)?.y ?? 0);
}

export function levelName(layout: LayoutDef, level: number): string {
  return level <= 0 ? 'Floor 1' : (upperLevels(layout).find((l) => l.index === level)?.name ?? `Floor ${level + 1}`);
}

const inRect = (r: Rect, x: number, z: number, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && z >= r.z - pad && z <= r.z + r.d + pad;

/** the level whose floor someone standing (feet) at height y is on: the highest within 1.2 m below */
export function levelAtHeight(layout: LayoutDef, y: number): number {
  let best = 0;
  for (const l of upperLevels(layout)) if (y >= l.y - 1.2 && l.index > best) best = l.index;
  return best;
}

/** is (x, z) on an upper level's slab (rooms and thresholds, not the holes)? */
export function onSlab(level: LevelDef, x: number, z: number): boolean {
  if (level.thresholds.some((t) => inRect(t, x, z))) return true;
  if (level.holes.some((h) => inRect(h, x, z))) return false;
  return level.rooms.some((r) => inRect(r.rect, x, z));
}

/** standing (feet at y) on an upper storey's floor or in an elevator car (sheet vinyl underfoot) */
export function onUpperFloor(layout: LayoutDef, x: number, z: number, y: number): boolean {
  if (upperLevels(layout).some((l) => y > l.y - 0.1 && onSlab(l, x, z))) return true;
  return elevatorBanks(layout).some((b) => {
    const s = shaftExtent(b);
    return x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1 + 0.15;
  });
}

/** union of the upper levels' outlines (roofs, parapets and rooftop units of the ground floor give way here) */
export function upperOutlines(layout: LayoutDef): Rect[] {
  return upperLevels(layout).map((l) => l.outline);
}

/**
 * Holes in the ground floor's roof slab for the upper levels: each outline, carried out over the
 * slab's overhang (`eave`) where it stands on an outer wall (no strip of roof left inside that
 * floor's wall, nor across its elevator entrances)
 */
export function upperRoofHoles(layout: LayoutDef, eave = 0.25): Rect[] {
  return upperOutlines(layout).map((o) => {
    const x0 = Math.abs(o.x) < 0.01 ? o.x - eave : o.x;
    const z0 = Math.abs(o.z) < 0.01 ? o.z - eave : o.z;
    const x1 = Math.abs(o.x + o.w - layout.width) < 0.01 ? o.x + o.w + eave : o.x + o.w;
    const z1 = Math.abs(o.z + o.d - layout.depth) < 0.01 ? o.z + o.d + eave : o.z + o.d;
    return { x: x0, z: z0, w: x1 - x0, d: z1 - z0 };
  });
}

/** is (x, z) under (or inside) an upper level's footprint? */
export function underUpper(layout: LayoutDef, x: number, z: number, pad = 0): boolean {
  return upperLevels(layout).some((l) => inRect(l.outline, x, z, pad));
}

/** does a wall line from (x1, z1) to (x2, z2) run wholly under an upper level (its façade build-up stops at the slab)? */
export function wallUnderUpper(layout: LayoutDef, x1: number, z1: number, x2: number, z2: number): boolean {
  return underUpper(layout, x1, z1, 0.01) && underUpper(layout, x2, z2, 0.01);
}

/**
 * The room at (x, z) on a level. Upper levels prefer rooms over the corridor they open onto (as
 * roomAt does); where a ground-floor room rises through the level (Stair 1), that room is returned.
 */
export function roomAtLevel(layout: LayoutDef, x: number, z: number, level: number): RoomDef | undefined {
  const l = level > 0 ? upperLevels(layout).find((u) => u.index === level) : undefined;
  if (!l) return roomAt(layout, x, z);
  let hit: RoomDef | undefined;
  for (const r of l.rooms) {
    if (!inRect(r.rect, x, z)) continue;
    if (!hit || (hit.kind === 'corridor' && r.kind !== 'corridor')) hit = r;
  }
  if (hit) return hit;
  if (l.holes.some((h) => inRect(h, x, z))) return roomAt(layout, x, z);
  return undefined;
}

/** an upper-level room by id, with its level */
export function upperRoom(layout: LayoutDef, id: LocationId): { room: RoomDef; level: LevelDef } | undefined {
  for (const level of upperLevels(layout)) {
    const room = level.rooms.find((r) => r.id === id);
    if (room) return { room, level };
  }
  return undefined;
}

/** a room by id on any level */
export function roomAnyLevel(layout: LayoutDef, id: LocationId): RoomDef | undefined {
  return roomById(layout, id) ?? upperRoom(layout, id)?.room;
}

/** the level a room id is on (0 for ground-floor or unknown ids) */
export function levelOfRoom(layout: LayoutDef, id: LocationId): number {
  return upperRoom(layout, id)?.level.index ?? 0;
}

/** how a location reads in the HUD: "Floor 2 · Nurses' station" upstairs, the plain label downstairs */
export function locationLabel(layout: LayoutDef | undefined, id: LocationId): string {
  if (!layout) return id;
  const up = upperRoom(layout, id);
  if (up) return `${up.level.name} · ${up.room.label}`;
  return roomById(layout, id)?.label ?? id;
}

/** a spot in a room on any level */
export function spotAnyLevel(layout: LayoutDef, room: LocationId, spot: string): Spot | undefined {
  const r = roomAnyLevel(layout, room);
  return r ? (r.spots[spot] ?? r.entry) : undefined;
}

/**
 * Walking time (s) between rooms on any levels: as walkSeconds on one floor; between floors via the
 * elevator lobby (Manhattan legs, plus ~25 s for the elevator or the stairs).
 */
export function walkSecondsAny(layout: LayoutDef, from: LocationId, to: LocationId, speed = 1.3): number {
  if (from === to) return 0;
  const la = levelOfRoom(layout, from);
  const lb = levelOfRoom(layout, to);
  if (la === 0 && lb === 0) return walkSeconds(layout, from, to, speed);
  const a = roomAnyLevel(layout, from)?.entry;
  const b = roomAnyLevel(layout, to)?.entry;
  if (!a || !b) return 30;
  if (la === lb) return Math.round((Math.abs(a.x - b.x) + Math.abs(a.z - b.z)) / speed + 4);
  const bank = elevatorBanks(layout)[0];
  const la0 = bank ? roomAnyLevel(layout, bank.lobbies[la] ?? '')?.entry : undefined;
  const lb0 = bank ? roomAnyLevel(layout, bank.lobbies[lb] ?? '')?.entry : undefined;
  const via = (p: Spot, q: Spot | undefined) => (q ? Math.abs(p.x - q.x) + Math.abs(p.z - q.z) : 20);
  return Math.round((via(a, la0) + via(b, lb0)) / speed + 25 + 4);
}
