/**
 * Everything you can log into, planned from the floor plan: each `kind: 'computer'` layout prop, the
 * automated medication dispensing cabinet (`medDispenser`), and the workstations on wheels in the
 * corridor (details.ts). For each: where its screen is, the chair that faces it (or where to stand),
 * the badge reader, the bay it serves at the bedside, and which AgentChart section it opens on.
 * Pure data, no three.js: workstation.ts builds the readers and runs the login from it, and
 * tests/workstation.test.ts checks that every computer has a way in.
 *
 * Angles follow the rest of the world: a yaw r faces (sin r, cos r) in (x, z).
 */
import type { LayoutDef, PropDef, RoomDef } from '../../../shared/layout';

/** 'clinical': a doctor's badge opens AgentChart here; 'staff': front desks and admin screens refuse it */
export type WsAccess = 'clinical' | 'staff';

/**
 * Who may log in, by prop id, where the default below would be wrong. Everything else: clinical in
 * clinical rooms (station, triage, bays, resus, imaging, exam and patient rooms, the physicians'
 * workroom, the med room), and staff-only elsewhere or on a desk that serves the public
 * (registration, reception, information, security, tills).
 */
export const ACCESS: Record<string, WsAccess> = {
  // the outpatient clinic's nurse workstation by its vitals alcove (the room is a corridor)
  clh_pc: 'clinical',
};

const STAFF_DESK = /regist|recept|inform|welcome|security|cashier|till|admin|billing|front desk/i;
const CLINICAL_KINDS = new Set(['station', 'triage', 'bay', 'resus', 'imaging']);
const CLINICAL_NAME = /physician|doctor|resident|attending|clinician|nurs|medication/i;

function accessOf(p: PropDef, room: RoomDef | undefined, desk: PropDef | undefined): WsAccess {
  const set = ACCESS[p.id];
  if (set) return set;
  if (desk?.label && STAFF_DESK.test(desk.label)) return 'staff';
  if (!room) return 'staff';
  if (CLINICAL_KINDS.has(room.kind)) return 'clinical';
  if (room.kind === 'room' && (room.spots.bed || room.spots.exam)) return 'clinical';
  if ((room.kind === 'office' || room.kind === 'utility') && CLINICAL_NAME.test(room.label)) return 'clinical';
  return 'staff';
}

/** a staff-only screen: what to call it, and what whoever works it says when a doctor tries to log in */
export function staffDesk(label: string): { name: string; line: string } {
  if (/regist/i.test(label)) return { name: 'Registration workstation', line: "Sorry, Doc, that one's registration only." };
  if (/inform|welcome/i.test(label)) return { name: 'Information desk computer', line: "Sorry, this one's just for visitor check-in." };
  if (/recept|front desk/i.test(label)) return { name: `${label.replace(/\s*computer$/i, '')} workstation`, line: "Sorry, Doctor, that's the front desk's computer." };
  if (/security/i.test(label)) return { name: 'Security workstation', line: "Sorry, Doc, that's the security system." };
  if (/cashier|till/i.test(label)) return { name: 'Till', line: "Sorry, that's just the till." };
  return { name: label, line: "Sorry, Doc, that one's staff only." };
}

export interface WsPoint {
  x: number;
  y: number;
  z: number;
}

export interface WsPlan {
  /** prop id, or the cart's id ('wow0') */
  id: string;
  /** "Workstation 3", "Registration computer", "Workstation on wheels" */
  label: string;
  room: string;
  kind: 'desk' | 'wow' | 'cabinet';
  /** the device: origin on its base, its front (screen side) faces yaw `rot` */
  x: number;
  y: number;
  z: number;
  rot: number;
  /** screen centre (world) and size (m); the screen faces yaw `rot` */
  screen: WsPoint & { w: number; h: number };
  /**
   * the badge reader: 'flat' lies on the work surface right of the keyboard (point = its bottom
   * centre); 'wall' is mounted on the front face beside the screen (point = its back centre)
   */
  reader: WsPoint & { mount: 'flat' | 'wall' };
  keyboard: WsPoint;
  /** the chair that faces this screen: y = seat height above its floor, yaw = facing the screen (null: you stand) */
  seat: { id: string; x: number; z: number; y: number; yaw: number } | null;
  /** where to stand in front of the screen (World moves it clear of furniture and people) */
  stand: { x: number; z: number; yaw: number };
  /** a bedside workstation: the bay or exam room whose patient it opens on */
  bedside?: string;
  /** AgentChart section to open on (Ehr.tsx aliases), e.g. 'mar' at the medication cabinet */
  section?: string;
  /** FIXTURE_INFO subject for F (inspect) on devices that used to be look-only */
  inspect?: string;
  /** who may log in; staff-only screens refuse a doctor's badge (name and the owner's line in `staff`) */
  access: WsAccess;
  staff?: { name: string; line: string };
}

/** a cart placed by details.ts */
export interface WowPlacement {
  id: string;
  x: number;
  z: number;
  rot: number;
}

// ── device geometry, local to the device (front = +z) ──
// props.ts 'computer': LCD on a stand, keyboard at z 0.2, mouse at x 0.3; the reader goes right of the mouse
const PC = { screen: { y: 0.32, z: -0.018, w: 0.54, h: 0.31 }, keyboard: { x: 0, y: 0.02, z: 0.2 }, reader: { x: 0.44, y: 0, z: 0.19 }, stand: 0.62 };
// details.ts workstationOnWheels: the badge reader sits to the right of the laptop.
const WOW = { screen: { y: 1.1, z: -0.09, w: 0.31, h: 0.2 }, keyboard: { x: 0, y: 0.99, z: 0.05 }, reader: { x: 0.226, y: 0.97, z: -0.005 }, stand: 0.42 };
// props.ts 'medDispenser': 1.1 × 1.9 × 0.62 cabinet, touchscreen at the front right, drawers below
const CAB = { screen: { x: 0.34, y: 1.5, z: 0.325, w: 0.3, h: 0.2 }, keyboard: { x: 0.34, y: 1.3, z: 0.33 }, reader: { x: 0.06, y: 1.47, z: 0.31 }, stand: { x: 0.22, z: 0.74 } };

/** a chair counts as this screen's when it stands this close to the spot in front of it and faces it */
const SEAT_REACH = 0.62;

const local = (x: number, z: number, rot: number, lx: number, lz: number) => ({ x: x + lx * Math.cos(rot) + lz * Math.sin(rot), z: z - lx * Math.sin(rot) + lz * Math.cos(rot) });

function inRoom(layout: LayoutDef, x: number, z: number, kinds: string[]): string | undefined {
  for (const r of layout.rooms) if (kinds.includes(r.kind) && x >= r.rect.x && x <= r.rect.x + r.rect.w && z >= r.rect.z && z <= r.rect.z + r.rect.d) return r.id;
  return undefined;
}

/**
 * How far in front of a computer (along its facing) the desk or counter it stands on ends: the badge
 * reader goes near that front edge, within reach of whoever sits or stands there (0 = no desk found).
 */
function frontEdge(layout: LayoutDef, p: PropDef): number {
  const rot = p.rot ?? 0;
  const nx = Math.sin(rot);
  const nz = Math.cos(rot);
  for (const d of layout.props) {
    if (d.kind !== 'desk' && d.kind !== 'counter') continue;
    const w = d.w ?? (d.kind === 'desk' ? 1.4 : 2);
    const dd = d.d ?? 0.7;
    const r = d.rot ?? 0;
    // the computer inside the desk's footprint (its own frame)?
    const lx = (p.x - d.x) * Math.cos(r) - (p.z - d.z) * Math.sin(r);
    const lz = (p.x - d.x) * Math.sin(r) + (p.z - d.z) * Math.cos(r);
    if (Math.abs(lx) > w / 2 || Math.abs(lz) > dd / 2) continue;
    let front = 0;
    for (const [cx, cz] of [[-w / 2, -dd / 2], [w / 2, -dd / 2], [w / 2, dd / 2], [-w / 2, dd / 2]]) {
      const wx = d.x + cx * Math.cos(r) + cz * Math.sin(r);
      const wz = d.z - cx * Math.sin(r) + cz * Math.cos(r);
      front = Math.max(front, (wx - p.x) * nx + (wz - p.z) * nz);
    }
    return front;
  }
  return 0;
}

/** the labelled desk or counter a computer stands on, if any */
function deskOf(layout: LayoutDef, p: PropDef): PropDef | undefined {
  return layout.props.find((d) => d.room === p.room && (d.kind === 'desk' || d.kind === 'counter') && d.label && Math.hypot(d.x - p.x, d.z - p.z) < 1.3);
}

function labelFor(layout: LayoutDef, p: PropDef): string {
  if (p.label) return p.label;
  // a computer on a labelled desk takes its name ("Registration computer")
  const desk = deskOf(layout, p);
  if (desk?.label) return `${desk.label} computer`;
  const room = layout.rooms.find((r) => r.id === p.room);
  return `${room?.label ?? 'Desk'} computer`;
}

function seatFor(layout: LayoutDef, sx: number, sz: number, rot: number): WsPlan['seat'] {
  // the spot a seated user's chair would stand on, ~0.72 m in front of the screen
  const fx = sx + Math.sin(rot) * 0.72;
  const fz = sz + Math.cos(rot) * 0.72;
  let best: WsPlan['seat'] = null;
  let bd = SEAT_REACH;
  for (const c of layout.props) {
    if (c.kind !== 'chair' && c.kind !== 'stool') continue;
    const d = Math.hypot(c.x - fx, c.z - fz);
    if (d >= bd) continue;
    // a stool turns; a chair must face the screen (its sitter looks along its yaw)
    const r = c.rot ?? 0;
    if (c.kind === 'chair' && Math.sin(r) * -Math.sin(rot) + Math.cos(r) * -Math.cos(rot) < 0.6) continue;
    bd = d;
    best = { id: c.id, x: c.x, z: c.z, y: c.kind === 'stool' ? 0.62 : 0.48, yaw: Math.atan2(sx - c.x, sz - c.z) };
  }
  return best;
}

export function planWorkstations(layout: LayoutDef, wows: WowPlacement[] = []): WsPlan[] {
  const out: WsPlan[] = [];
  for (const p of layout.props) {
    const rot = p.rot ?? 0;
    if (p.kind === 'computer') {
      // its base height is the work surface it stands on
      const y = p.y ?? 0;
      const s = local(p.x, p.z, rot, 0, PC.screen.z);
      const k = local(p.x, p.z, rot, PC.keyboard.x, PC.keyboard.z);
      // right of the mouse, toward the desk's front edge (a deep desk would put it out of reach)
      const front = frontEdge(layout, p);
      const rd = local(p.x, p.z, rot, PC.reader.x, Math.max(PC.reader.z, Math.min(0.45, front - 0.07)));
      const room = layout.rooms.find((r) => r.id === p.room);
      const label = labelFor(layout, p);
      const access = accessOf(p, room, deskOf(layout, p));
      out.push({
        id: p.id,
        label,
        access,
        staff: access === 'staff' ? staffDesk(label) : undefined,
        room: p.room,
        kind: 'desk',
        x: p.x,
        y,
        z: p.z,
        rot,
        screen: { x: s.x, y: y + PC.screen.y, z: s.z, w: PC.screen.w, h: PC.screen.h },
        reader: { x: rd.x, y: y + PC.reader.y, z: rd.z, mount: 'flat' },
        keyboard: { x: k.x, y: y + PC.keyboard.y, z: k.z },
        seat: seatFor(layout, s.x, s.z, rot),
        stand: { x: s.x + Math.sin(rot) * PC.stand, z: s.z + Math.cos(rot) * PC.stand, yaw: rot + Math.PI },
        // the computer in a patient room charts on that room's patient
        bedside: room && (room.kind === 'bay' || room.kind === 'resus' || (room.kind === 'room' && (room.spots.bed || room.spots.exam))) ? room.id : undefined,
      });
    } else if (p.kind === 'medDispenser') {
      const y = p.y ?? 0;
      const s = local(p.x, p.z, rot, CAB.screen.x, CAB.screen.z);
      const k = local(p.x, p.z, rot, CAB.keyboard.x, CAB.keyboard.z);
      const rd = local(p.x, p.z, rot, CAB.reader.x, CAB.reader.z);
      const st = local(p.x, p.z, rot, CAB.stand.x, CAB.stand.z);
      const room = layout.rooms.find((r) => r.id === p.room);
      const access = accessOf(p, room, undefined);
      out.push({
        id: p.id,
        label: p.label ?? 'Medication dispenser',
        access,
        staff: access === 'staff' ? staffDesk(p.label ?? 'Medication dispenser') : undefined,
        room: p.room,
        kind: 'cabinet',
        x: p.x,
        y,
        z: p.z,
        rot,
        screen: { x: s.x, y: y + CAB.screen.y, z: s.z, w: CAB.screen.w, h: CAB.screen.h },
        reader: { x: rd.x, y: y + CAB.reader.y, z: rd.z, mount: 'wall' },
        keyboard: { x: k.x, y: y + CAB.keyboard.y, z: k.z },
        seat: null,
        stand: { ...st, yaw: rot + Math.PI },
        // physicians review the MAR and med orders here; the nurse pulls verified doses
        section: 'mar',
        inspect: 'medDispenser',
      });
    }
  }
  for (const w of wows) {
    const s = local(w.x, w.z, w.rot, 0, WOW.screen.z);
    const k = local(w.x, w.z, w.rot, WOW.keyboard.x, WOW.keyboard.z);
    const rd = local(w.x, w.z, w.rot, WOW.reader.x, WOW.reader.z);
    const st = local(w.x, w.z, w.rot, 0, WOW.stand);
    // a cart parked outside a bay is that bay's bedside computer
    const ahead = local(w.x, w.z, w.rot, 0, 1.2);
    out.push({
      id: w.id,
      label: 'Workstation on wheels',
      // a clinical cart wherever it is parked
      access: 'clinical',
      room: inRoom(layout, w.x, w.z, ['corridor']) ?? 'hub',
      kind: 'wow',
      x: w.x,
      y: 0,
      z: w.z,
      rot: w.rot,
      screen: { x: s.x, y: WOW.screen.y, z: s.z, w: WOW.screen.w, h: WOW.screen.h },
      reader: { x: rd.x, y: WOW.reader.y, z: rd.z, mount: 'flat' },
      keyboard: { x: k.x, y: WOW.keyboard.y, z: k.z },
      seat: null,
      stand: { ...st, yaw: w.rot + Math.PI },
      bedside: inRoom(layout, ahead.x, ahead.z, ['bay', 'resus', 'room']),
      inspect: 'wow',
    });
  }
  return out;
}

/** reader size (m): w across, h tall (flat) or deep (wall), d deep (flat) or tall (wall) */
export const READER = { w: 0.068, h: 0.022, d: 0.088 };
