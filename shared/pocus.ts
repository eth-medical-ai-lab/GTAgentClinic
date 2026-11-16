/**
 * Bedside ultrasound (POCUS): the windows a doctor can scan. Each is an exam maneuver `pocus_<window>`
 * (shared/catalog.ts EXAM_MANEUVERS, group "Bedside ultrasound"); the read comes from the case
 * (CaseDef.pocus) or a normal study (server/sim/pocus.ts), as text in the Examine tab.
 */

export type PocusWindow = 'ruq' | 'luq' | 'pelvic' | 'cardiac' | 'aorta' | 'rlq' | 'bladder' | 'ivc' | 'lung';

export interface PocusWindowDef {
  id: PocusWindow;
  /** full name, e.g. "RUQ / Morison's pouch" */
  label: string;
  /** game minutes for one view (charged in step mode, like any exam) */
  minutes: number;
}

/** the four FAST views first */
export const POCUS_WINDOWS: PocusWindowDef[] = [
  { id: 'ruq', label: "RUQ / Morison's pouch", minutes: 1 },
  { id: 'luq', label: 'LUQ / splenorenal', minutes: 1 },
  { id: 'pelvic', label: 'Pelvic / suprapubic', minutes: 1 },
  { id: 'cardiac', label: 'Subxiphoid cardiac', minutes: 1 },
  { id: 'aorta', label: 'Abdominal aorta', minutes: 1 },
  { id: 'rlq', label: 'RLQ / appendix', minutes: 2 },
  { id: 'bladder', label: 'Bladder', minutes: 1 },
  { id: 'ivc', label: 'IVC', minutes: 1 },
  { id: 'lung', label: 'Lung (anterior)', minutes: 1 },
];

export const POCUS_BY_ID = Object.fromEntries(POCUS_WINDOWS.map((w) => [w.id, w])) as Record<PocusWindow, PocusWindowDef>;

export const isPocusWindow = (w: unknown): w is PocusWindow => typeof w === 'string' && w in POCUS_BY_ID;

/** the exam maneuver for a window, and back */
export const POCUS_PREFIX = 'pocus_';
export const pocusManeuver = (w: PocusWindow) => `${POCUS_PREFIX}${w}`;
export const pocusWindowOf = (maneuver: string): PocusWindow | null => {
  const w = maneuver.startsWith(POCUS_PREFIX) ? maneuver.slice(POCUS_PREFIX.length) : null;
  return isPocusWindow(w) ? w : null;
};
