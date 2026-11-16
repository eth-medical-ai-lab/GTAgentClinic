import type { CameraMode, Debrief } from './types';

export const SLOT_COUNT = 5;
export interface SlotInfo {
  slot: number;
  name: string;
  date: string;
  revision: string;
  map: string;
  level: number;
  clock: string;
  ended: boolean;
}

export interface Rotation {
  best: Record<string, number>;
  bedside?: Record<string, BedsideTask[]>;
  xp: number;
  clues: string[];
  radioStoryVersion?: 1;
  items: string[];
  goal?: { map: string; patient: string; label: string; objective: string; points: number; seed: number };
}

export function newRotation(): Rotation {
  return { best: {}, xp: 0, clues: [], radioStoryVersion: 1, items: [] };
}

export function level(xp: number) { return 1 + Math.floor(xp / 100); }

export const bedsideTasks = {
  history: { label: 'Learn a history detail', xp: 15 },
  exam: { label: 'Perform a bedside exam', xp: 10 },
  belonging: { label: 'Return a personal belonging', xp: 5 },
} as const;
export type BedsideTask = keyof typeof bedsideTasks;

function unlockLevelRewards(r: Rotation) {
  if (level(r.xp) >= 2 && !r.items.includes('Surgeon’s vest')) r.items.push('Surgeon’s vest');
}

/** Each milestone belongs to the patient across replays in this rotation. Older saves start with an empty record. */
export function earnBedsideXP(previous: Rotation, patientId: string, task: BedsideTask): Rotation {
  const done = previous.bedside?.[patientId] ?? [];
  if (done.includes(task)) return previous;
  const r = { ...previous, items: [...previous.items], xp: previous.xp + bedsideTasks[task].xp,
    bedside: { ...previous.bedside, [patientId]: [...done, task] } };
  unlockLevelRewards(r);
  return r;
}

export function finishRotation(previous: Rotation, d: Debrief): Rotation {
  const r = structuredClone(previous);
  for (const c of d.cases) {
    if (!c.disposition || !c.maxScore) continue;
    const key = c.caseId ?? d.mapId + '/' + c.patientId;
    const best = r.best[key];
    const percent = Math.max(0, Math.floor(100 * c.score / c.maxScore));
    if (best === undefined) r.xp += 50;
    r.xp += Math.max(0, percent - (best ?? 0));
    r.best[key] = Math.max(best ?? 0, percent);
  }
  unlockLevelRewards(r);
  return r;
}

export interface SavedItem {
  key: string;
  kind: string;
  label: string;
  desc: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hand?: 'L' | 'R' | 'both';
  order: number;
}
export interface WorldSave {
  x: number; y: number; z: number;
  yaw: number; pitch: number; facing: number;
  items: SavedItem[];
  npcs: { id: string; x: number; z: number; yaw: number; destKey: string; wanderIn: number; wandering: boolean; walkingTo?: { x: number; z: number } }[];
  ward?: { id: string; x: number; z: number; yaw: number; stop: number; path?: [number, number][]; wait: number; nextLine: number; lineIx: number }[];
  cabinets: SavedCabinet[];
  curtains: { id: string; side: 'open' | 'closed' | null; goal: number | null; sticky: boolean }[];
  amenities: SavedAmenities;
  usedGloves: boolean;
  zoom: { third: number; top: number };
  wheelchair: { x: number; y: number; z: number; heading: number; riding: boolean; lent: boolean };
  lift?: import('../client/src/world/elevatorModel').BankSave;
}
export interface SavedCabinet {
  id: string;
  away: number;
  lock?: { state: 'locked' | 'tried' | 'asked' | 'open'; outFor: number };
  seal?: { intact: boolean; n: number; gone: number };
  parts: { goal: 0 | 1; t: number; contents: SavedItem[] }[];
}
export interface SavedAmenities {
  seated?: { seat: { kind: 'chair' | 'sofa'; id: string; x: number; y: number; z: number; rot: number; seatY: number; lx: number; out: { x: number; z: number } }; furniture: string; nextSip: number;
    spots: { item: string; x: number; y: number; z: number; yaw: number; side: 'R' | 'L' }[] };
  seq: number;
  sold: number;
  bills: { id: string; what: string; amount: number }[];
  drinks: { id: string; vessel: 'mug' | 'paper' | 'can'; soda?: string; fill: number; temp: number; sips: number; sipsTotal: number; opened: boolean; lid: boolean }[];
  machines: { id: string; drink?: string; state: 'idle' | 'ready' | 'brewing'; t: number; cups?: number; lids?: number; rack?: boolean[] }[];
}
export type SavedPanel =
  | { kind: 'npc'; npcId: string; tab?: 'talk' | 'exam' | 'decide' }
  | { kind: 'ehr'; patientId?: string; section?: string }
  | { kind: 'phone'; contactId?: string }
  | { kind: 'board' }
  /** the doctor's tablet with nobody to talk to (Tab): the patient list (ui/TabletHome.tsx) */
  | { kind: 'tablet' }
  | { kind: 'monitor'; bay: string }
  | { kind: 'help' }
  | { kind: 'locker' }
  | { kind: 'settings' };

export interface PlayerSave {
  panel?: SavedPanel | null;
  tabletMin?: boolean;
  rotation: Rotation;
  camera: CameraMode;
  world: WorldSave | null;
}
