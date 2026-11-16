import type { ScenarioDef } from '../../content/types';
import { createHash } from 'node:crypto';
import { buildChart, buildView } from './views';
import type { Action, ActionResult, GameSettings } from '../../shared/types';
import type { NpcSelection } from '../../shared/llm';
import type { NpcReply } from '../npc/brain';
import type { Conversation, GameSession } from './session';

type Entry = { tick: number } | { settings: GameSettings } | { focus: GameSession['focus'] }
  | { action: Action; ok: boolean; turn?: { reply: NpcReply; ticks: number[]; history: Conversation['history'] } };
export interface ShiftHistory {
  npc?: NpcSelection;
  mapId: string;
  roster?: ScenarioDef['patients'];
  seed: number;
  playerName: string;
  settings: GameSettings;
  entries: Entry[];
}

/** The simulation schedules closures. Replaying its original inputs reconstructs those closures,
 * including partially completed tasks. Keep each tick boundary (it affects task completion times). */
export class ShiftJournal {
  readonly history: ShiftHistory;
  private pending: Promise<unknown> = Promise.resolve();
  private busy = 0;
  private duringReply?: number[];

  constructor(readonly session: GameSession, readonly owner: string, npc?: NpcSelection) {
    this.history = { npc, mapId: session.scenario.id, ...(session.scenario.bedPool ? { roster: session.scenario.patients } : {}), playerName: session.playerName, seed: session.seed, settings: { ...session.settings }, entries: [] };
  }

  sequence<T>(work: () => Promise<T> | T): Promise<T> {
    this.busy++;
    const next = this.pending.then(work).finally(() => { this.busy--; });
    this.pending = next.catch(() => undefined);
    return next;
  }

  tick(dt: number) {
    const s = this.session;
    if (s.ended || s.settings.paused || (this.busy && !this.duringReply)) return;
    s.tick(dt);
    if (this.duringReply) this.duringReply.push(dt);
    else this.history.entries.push({ tick: dt });
  }

  settings(settings: Partial<GameSettings>) {
    this.session.settings = { ...this.session.settings, ...settings };
    this.history.entries.push({ settings: this.session.settings });
  }

  focus(focus: GameSession['focus']) {
    this.session.focus = focus;
    this.history.entries.push({ focus });
  }

  async act(action: Action): Promise<ActionResult> {
    const s = this.session;
    const entry: Extract<Entry, { action: Action }> = { action, ok: false };
    s.reply = async (...args) => {
      const ticks: number[] = [];
      this.duringReply = ticks;
      try {
        const reply = await s.brain.reply(...args);
        entry.turn = { reply, ticks, history: [...args[1].history] };
        return reply;
      } finally { this.duringReply = undefined; }
    };
    try {
      const result = await s.act(action);
      entry.ok = result.ok;
      this.history.entries.push(entry);
      return result;
    } finally {
      s.reply = s.brain.reply.bind(s.brain);
    }
  }

  digest() {
    const s = this.session;
    const { sessionId: _id, llm: _llm, usage: _usage, ...view } = buildView(s, s.brain.status);
    // Older saves hashed an empty exam list for each scheduled patient. Keep that private digest
    // format while withholding unarrived patients' IDs from the view sent to players.
    view.examFindings = Object.fromEntries([...s.patients.values()].map(p => [p.id, p.exam]));
    const charts = Array.from(s.patients.values(), p => buildChart(s, p));
    return createHash('sha256').update(JSON.stringify([view, charts, s.log, s.rng])).digest('hex');
  }

  /** Restore in a fresh, unbound session. No provider calls, speech or run-log writes. */
  async restore(history: ShiftHistory) {
    const s = this.session;
    try {
      for (const entry of history.entries) {
        if ('tick' in entry) s.tick(entry.tick);
        else if ('settings' in entry) s.settings = { ...entry.settings };
        else if ('focus' in entry) s.focus = entry.focus;
        else {
          let used = false;
          s.reply = async (_spec, conv) => {
            if (!entry.turn || used) throw new Error('Missing recorded dialogue.');
            used = true;
            for (const dt of entry.turn.ticks) s.tick(dt);
            conv.history = [...entry.turn.history];
            return entry.turn.reply;
          };
          const result = await s.act(entry.action);
          if (result.ok !== entry.ok || used !== !!entry.turn) throw new Error('Incompatible shift recording.');
        }
      }
      this.history.entries = history.entries;
    } finally {
      s.reply = s.brain.reply.bind(s.brain);
    }
  }
}
