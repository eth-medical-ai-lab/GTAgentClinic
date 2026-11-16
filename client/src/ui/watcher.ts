/**
 * Observe mode: the watcher is a med student on the floor of an AI doctor's shift. They can talk to
 * anyone, off the record (server/npc/watcher.ts), and read the tracking board, charts and bedside
 * monitors. They never act: no orders, notes, signatures, exams, calls or escalations.
 *
 *  - their threads live here, one per NPC, never in the session's conversations;
 *  - watcherPanelFor / watcherPrompt decide what pressing E (or a click) on something does;
 *  - watcherRefusal is what client.act answers while watching (the server refuses too).
 */
import { useSyncExternalStore } from 'react';
import type { Action, ActionResult, ChatLine, ServerMsg } from '../../../shared/types';
import { store, type Panel } from '../store';
import type { InteractTarget } from '../world';
import { restoreObPanel } from './obPanel';

export interface WatcherThread {
  npcId: string;
  title: string;
  lines: ChatLine[];
  typing: boolean;
  /** the last refusal (rate limit, nobody there, shift over): shown under the chat */
  error?: string;
}

let sessionId: string | null = null;
let threads: Record<string, WatcherThread> = {};
let localSeq = 0;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

function forSession(sid: string) {
  if (sid === sessionId) return;
  sessionId = sid;
  threads = {};
}

/** a random id for this tab, so a reload finds the same threads (sessionStorage, if available) */
export function watcherId(): string {
  const make = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
  try {
    let id = sessionStorage.getItem('ac.watcherId');
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) sessionStorage.setItem('ac.watcherId', (id = make()));
    return id;
  } catch {
    return (memoryId ??= make());
  }
}
let memoryId: string | undefined;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useWatcherThread(sid: string | undefined, npcId: string): WatcherThread | undefined {
  return useSyncExternalStore(subscribe, () => (sid && sid === sessionId ? threads[npcId] : undefined));
}

/** what the watcher just said, shown at once (the server's thread replaces it) */
export function watcherSaid(sid: string, npcId: string, title: string, text: string) {
  forSession(sid);
  const th = threads[npcId] ?? { npcId, title, lines: [], typing: false };
  threads = { ...threads, [npcId]: { ...th, lines: [...th.lines, { id: `local-${++localSeq}`, t: store.get().view?.t ?? 0, speaker: 'player', name: 'You', text }], typing: true, error: undefined } };
  changed();
}

/** net.ts: the server's answer to watcher_talk / watcher_thread */
export function applyWatcherMsg(msg: Extract<ServerMsg, { type: 'watcher_chat' }>) {
  const t = msg.thread;
  if (!t.sessionId) return;
  forSession(t.sessionId);
  const prev = threads[t.npcId];
  // nothing on the server yet (a tablet opened just now): keep what we show, e.g. a line on its way
  if (!t.lines.length && prev && !msg.error) return;
  // a refusal carries the thread as the server has it: the line we showed early was not said
  const lines = t.lines.length || !prev ? t.lines : prev.lines.filter((l) => !l.id.startsWith('local-'));
  threads = { ...threads, [t.npcId]: { npcId: t.npcId, title: t.title || prev?.title || '', lines, typing: t.typing, error: msg.error } };
  changed();
}

// ───────────────────────────── what E / a click does while watching ─────────────────────────────

/** the panel to open for a target, or null (and maybe a note): talk, read, look, but never act */
export function watcherPanelFor(t: InteractTarget): Panel | null {
  switch (t.kind) {
    case 'npc':
      if (t.npcId === 'ai_doctor') {
        // the AI resident can't be interrupted: its thinking is in the transcript panel
        restoreObPanel();
        return null;
      }
      return { kind: 'npc', npcId: t.npcId, tab: 'talk' };
    case 'computer':
      return { kind: 'ehr' };
    case 'board':
      return { kind: 'board' };
    case 'monitor':
      return { kind: 'monitor', bay: t.bay };
    case 'phone':
      store.toast("The phones are for the AI doctor's calls. You're watching this shift.", 'info');
      return null;
    default:
      return null; // objects are picked up and looked at inside the 3D world
  }
}

/** the "[E] …" prompt while watching (null: nothing to do there) */
export function watcherPrompt(t: InteractTarget): string | null {
  if (t.kind === 'phone') return null;
  if (t.kind === 'npc' && t.npcId === 'ai_doctor') return "[E] Follow the AI resident's reasoning";
  if (t.kind === 'computer') return '[E] Read AgentChart (read-only)';
  return `[E] ${t.label}`;
}

// ───────────────────────────── actions while watching ─────────────────────────────

const READ_ONLY = "Read-only: you're watching the AI doctor. Only it orders, charts and decides.";
const REFUSE: Partial<Record<Action['type'], string>> = {
  inspect: "Only the doctor goes through a patient's belongings.",
  examine: 'Only the doctor examines patients. Watch the AI resident do it.',
  talk: 'Talk to people from your tablet: off the record, so the AI doctor never hears it.',
  call: "The phones are for the AI doctor's calls.",
  escalate: "Only the doctor can call the attending in. You're watching.",
  move: 'Walk anywhere you like: the AI doctor moves on its own.',
};

/** client.act while watching: reading marks are a no-op, everything else is refused with a reason */
export function watcherRefusal(a: Action): ActionResult {
  if (a.type === 'mark_read' || a.type === 'ack_page') return { ok: true };
  return { ok: false, message: REFUSE[a.type] ?? READ_ONLY };
}
