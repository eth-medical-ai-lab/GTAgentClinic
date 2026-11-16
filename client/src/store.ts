/**
 * Tiny external store (no dependency). Components subscribe with useStore(selector).
 */
import { newRotation, type Rotation, type WorldSave, type SlotInfo } from '../../shared/saveGame';
import { useSyncExternalStore } from 'react';
import type { CameraMode, Debrief, LlmStatus, MapSummary, NarrationEntry, PatientChart, PlayerView, TtsMode } from '../../shared/types';

import type { SavedPanel } from '../../shared/saveGame';
import { loadLook, type LookSettings } from './ui/lookSettings';
export type Panel = SavedPanel;

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'warn' | 'bad';
  at: number;
}

export interface AppState {
  rotation: Rotation;
  solo: boolean;
  loadedWorld: WorldSave | null;
  slotDialog: 'load' | 'save' | null;
  slots: (SlotInfo | null)[] | null;
  slotBusy: boolean;
  lastSave: SlotInfo | null;
  slotError: string;
  continuing: boolean;
  connected: boolean;
  serverVersion?: string;
  llm?: LlmStatus;
  /** the server's online/offline switch (title screen): false = no LLM anywhere; undefined until the server says */
  online?: boolean;
  /** the server's NPC voices (welcome message), and why they differ from what was asked for */
  tts?: TtsMode;
  ttsNote?: string;
  maps: MapSummary[];
  screen: 'menu' | 'game' | 'debrief';
  view: PlayerView | null;
  charts: Record<string, PatientChart>;
  debrief: Debrief | null;
  panel: Panel | null;
  camera: CameraMode;
  /** interaction prompt shown at screen center, e.g. "[E] Talk to Robert Keller" */
  prompt: string | null;
  toasts: Toast[];
  /** real-time ms when each npc last spoke (for speech bubbles) */
  speech: Record<string, { text: string; at: number }>;
  /** meters from the player to each NPC (updated by the 3D world a few times per second) */
  distances: Record<string, number>;
  /** an object or piece of equipment being inspected (3D world → inspect card) */
  inspect: { title: string; desc: string; caseItemId?: string; closeUp: boolean } | null;
  /** observe mode: the AI resident's think-aloud transcript (narration events, deduplicated by id) */
  feed: NarrationEntry[];
  /** observe mode: the watcher (a med student) tags along behind the ai_doctor; false = walks freely */
  follow: boolean;
  /** the patient/staff tablet is tucked away at the screen edge (two-finger swipe down or right-drag) */
  tabletMin: boolean;
  /** mouse look sensitivity and invert-Y (the in-game settings, Esc; saved in localStorage) */
  look: LookSettings;
  mock: boolean;
}

type Listener = () => void;

const initial: AppState = {
  rotation: newRotation(), solo: false, loadedWorld: null, slotDialog: null, slots: null,
  slotBusy: false, lastSave: null, slotError: '', continuing: false,
  connected: false,
  maps: [],
  screen: 'menu',
  view: null,
  charts: {},
  debrief: null,
  panel: null,
  camera: 'first',
  prompt: null,
  toasts: [],
  speech: {},
  distances: {},
  inspect: null,
  feed: [],
  follow: false,
  tabletMin: false,
  look: loadLook(),
  mock: false,
};

let state: AppState = initial;
const listeners = new Set<Listener>();

export const store = {
  get: () => state,
  set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
    const p = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...p };
    listeners.forEach((l) => l());
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  toast(text: string, tone: Toast['tone'] = 'info') {
    const t: Toast = { id: Math.random(), text, tone, at: Date.now() };
    store.set((s) => ({ toasts: [...s.toasts.slice(-4), t] }));
    setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), 6000);
  },
};

/** watching an agent's shift (observe mode / ?spectate=): the view says an AI doctor drives it */
export const isObserving = (s: AppState = state) => s.view?.driver?.kind === 'agent';

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state));
}
