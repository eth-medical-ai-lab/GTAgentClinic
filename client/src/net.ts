/**
 * WebSocket client. One connection per tab; actions are request/response via reqId.
 */
import { cancelStartupLook } from './startupLook';
import type { NpcSelection } from '../../shared/llm';
import type { Action, ActionResult, ClientMsg, GameSettings, ServerMsg } from '../../shared/types';
import { isObserving, store } from './store';
import { DemoTransport } from './demo/transport';
import { browserDemo } from './demo/mode';

import { setTtsMode, speakNpc, stopSpeaking } from './ui/speech';
import { transcriptKey } from './ui/captions';
import { applyWatcherMsg, watcherRefusal } from './ui/watcher';

type Pending = { resolve: (r: ActionResult) => void; timer: ReturnType<typeof setTimeout> };


import { recoverRadioClues } from '../../shared/nightRadio';
import { finishRotation, type SlotInfo } from '../../shared/saveGame';
import { restoredPanel, soloRadioClue, recordBedsideAction, finishHandAction, lostAndFound, returnedBelonging, newCareer, nightSouvenir, playerSave, reconnectRotation, rememberRotation, saveOwner } from './rotation';

class GameClient {
  private demo = browserDemo ? new DemoTransport(msg => this.onMessage(msg)) : null;
  /** the shift these messages belong to: a loaded save names it before its first state arrives */
  private sessionId: string | null = null;
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private queue: ClientMsg[] = [];
  private retry = 0;
  private actions = new Set<Promise<ActionResult>>();
  /** true between start/resume and the first state message — otherwise stray states are ignored on the menu */
  private awaiting = false;

  connect() {
    if (store.get().mock) return;
    if (this.demo) {
      this.demo.connect();
      store.set({ connected: true });
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      store.set({ connected: true });
      const sid = sessionStorage.getItem('ac.sessionId');
      if (sid) {
        reconnectRotation(sid);
        this.awaiting = true;
        this.send({ type: 'resume', sessionId: sid, driverToken: sessionStorage.getItem('ac.driverToken') ?? undefined });
      }
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onclose = () => {
      store.set({ connected: false, slotBusy: false, slotError: 'Disconnected. Reopen the slots after reconnecting.' });
      const delay = Math.min(5000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data as string) as ServerMsg);
  }

  send(msg: ClientMsg) {
    if (this.demo) this.demo.send(msg);
    else if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  act(action: Action): Promise<ActionResult> {
    if (store.get().mock) return Promise.resolve({ ok: true, message: '(mock) ' + action.type });
    // watching an AI doctor: the shift is the agent's (the server refuses spectator actions too); reading is fine
    if (isObserving()) return Promise.resolve(watcherRefusal(action));
    if (action.type === 'talk') {
      const clue = soloRadioClue();
      if (clue?.npc === action.npcId && clue.words.test(action.text)) action = { ...action, topic: 'night-radio' };
    }
    const reqId = String(++this.seq);
    const reply = new Promise<ActionResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        resolve({ ok: false, message: 'Timed out waiting for the server.' });
      }, 60000);
      this.pending.set(reqId, { resolve, timer });
      this.send({ type: 'action', action, reqId });
    });
    const sourceId = store.get().view?.sessionId;
    const completed = reply.then((r) => {
      if (r.ok && sourceId === store.get().view?.sessionId) {
        recordBedsideAction(action, r);
        if (action.type === 'talk') {
          nightSouvenir(action.npcId, r);
          lostAndFound(action.npcId, action.text);
        } else if (action.type === 'give_item') returnedBelonging(action.itemId);
      }
      return r;
    });
    this.actions.add(completed);
    void completed.finally(() => this.actions.delete(completed));
    return completed;
  }

  start(mapId: string, playerName: string, settings?: Partial<GameSettings>, seed?: number, npc?: NpcSelection, continueRotation = false) {
    if (this.demo) {
      stopSpeaking();
      store.set({ solo: false, loadedWorld: null, speech: {}, distances: {}, inspect: null, prompt: null, toasts: [], tabletMin: false });
    } else {
      newCareer(continueRotation);
      sessionStorage.removeItem('ac.sessionId');
    }
    this.awaiting = true;
    this.sessionId = null;
    store.set({ charts: {}, debrief: null, panel: null, view: null, feed: [], screen: 'game' });
    this.send({ type: 'start', owner: this.demo ? undefined : saveOwner(), mapId, playerName, settings, seed, npc });
  }

  openSlots(mode: 'load' | 'save') {
    store.set({ slotDialog: mode, slots: null, slotBusy: true, slotError: '' });
    this.send({ type: 'slots', owner: saveOwner() });
  }

  async saveSlot(slot: number, name: string, info: SlotInfo | null) {
    try {
      const sessionId = store.get().view?.sessionId;
      store.set({ slotBusy: true, slotError: '' });
      await finishHandAction();
      await Promise.all(this.actions);
      if (!store.get().connected || store.get().view?.sessionId !== sessionId) throw new Error('The active shift changed. Reopen the save slots.');
      const player = playerSave();
      this.send({ type: 'save_slot', owner: saveOwner(), slot, revision: info?.revision ?? null, name, player });
    } catch (e) {
      store.set({ slotBusy: false, slotError: (e as Error).message });
    }
  }

  loadSlot(slot: number) {
    store.set({ slotBusy: true, slotError: '' });
    this.send({ type: 'load_slot', owner: saveOwner(), slot });
  }

  leaveSolo(continuing = false) {
    if (this.demo) stopSpeaking();
    else sessionStorage.removeItem('ac.sessionId');
    this.send({ type: 'leave_solo' });
    this.awaiting = false;
    store.set({ screen: 'menu', view: null, debrief: null, panel: null, slotDialog: null, solo: false, continuing });
  }

  /** observe mode: attach this tab to an AI doctor's shift as a spectator (POST /api/observe gave the id) */
  watch(sessionId: string) {
    store.set({ solo: false });
    sessionStorage.setItem('ac.sessionId', sessionId);
    this.awaiting = true;
    // the watcher starts on their own as a med student; T (or the panel) tags along behind the AI doctor
    store.set({ charts: {}, debrief: null, panel: null, view: null, feed: [], follow: false, screen: 'game' });
    this.send({ type: 'resume', sessionId });
  }

  settings(settings: Partial<GameSettings>) {
    this.send({ type: 'settings', settings });
  }

  focus(focus: 'chat' | 'ehr' | 'phone' | null) {
    this.send({ type: 'focus', focus });
  }

  /**
   * A staff member's off-the-record line from the 3D world (the cafeteria's cashier): the server voices
   * it and sends it back as a speech event (bubble, voice, lips). False when offline: show it yourself.
   */
  aside(npcId: string, text: string): boolean {
    if (this.demo) {
      this.demo.send({ type: 'aside', npcId, text });
      return true;
    }
    if (store.get().mock || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: 'aside', npcId, text } satisfies ClientMsg));
    return true;
  }

  requestChart(patientId: string) {
    this.send({ type: 'chart', patientId });
  }

  private onMessage(msg: ServerMsg) {
    switch (msg.type) {
      case 'slots':
        store.set({ slots: msg.slots, slotBusy: false });
        break;
      case 'slot_error':
        store.set({ slotBusy: false, slotError: msg.message });
        break;
      case 'slot_saved':
        store.set({ slotBusy: false, slotError: '', slotDialog: null, lastSave: msg.info });
        store.toast('Saved to slot ' + msg.info.slot + ' · ' + msg.info.name, 'good');
        break;
      case 'slot_loaded':
        this.awaiting = true;
        this.sessionId = msg.sessionId;
        rememberRotation(msg.player.rotation, msg.sessionId);
        store.set({ solo: true, continuing: false, screen: 'game', lastSave: null, slotDialog: null, slotBusy: false, slotError: '',
          camera: msg.player.camera, loadedWorld: msg.player.world, view: null, debrief: null,
          charts: {}, panel: restoredPanel(msg.player.panel), tabletMin: !!msg.player.tabletMin, feed: [], inspect: null, speech: {}, prompt: null, toasts: [] });
        break;
      case 'welcome':
        // (an older server sends no `online`: offline then means its NPCs are)
        store.set({ serverVersion: msg.version, llm: msg.llm, online: msg.online ?? msg.llm.provider !== 'offline', maps: msg.maps, tts: msg.tts, ttsNote: msg.ttsNote });
        setTtsMode(msg.tts);
        break;
      case 'llm':
        // online/offline switched on the title screen (this tab or another): new shifts follow it
        store.set({ llm: msg.llm, online: msg.online });
        break;
      case 'state': {
        // ignore a stale session's states after leaving to the menu
        if (store.get().screen === 'menu' && !this.awaiting) break;
        const prev = store.get().view;
        if (prev && prev.sessionId !== msg.view.sessionId && !this.awaiting) break;
        if (!this.demo && !msg.view.ended) sessionStorage.setItem('ac.sessionId', msg.view.sessionId);
        if (this.awaiting && store.get().solo && !msg.view.driver) {
          rememberRotation(recoverRadioClues(store.get().rotation, msg.view.conversations), msg.view.sessionId);
        }
        const wasAwaiting = this.awaiting;
        this.awaiting = false;
        store.set((s) => ({ view: msg.view, screen: wasAwaiting && s.screen !== 'debrief' ? 'game' : s.screen === 'menu' ? 'game' : s.screen }));
        // refresh any chart we already hold when its version moved
        const charts = store.get().charts;
        for (const [pid, v] of Object.entries(msg.view.chartVersions)) {
          if (charts[pid] && charts[pid].version !== v) this.requestChart(pid);
        }
        break;
      }
      case 'chart':
        store.set((s) => ({ charts: { ...s.charts, [msg.chart.id]: msg.chart } }));
        break;
      case 'actionResult': {
        const p = msg.reqId ? this.pending.get(msg.reqId) : undefined;
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.reqId!);
          p.resolve(msg.result);
        } else if (!msg.result.ok && msg.result.message) store.toast(msg.result.message, 'warn');
        break;
      }
      case 'event': {
        const e = msg.event;
        if (e.kind === 'narration') {
          // the AI resident's feed; a re-attach resends the backlog, so dedupe by id
          const entry = e.entry;
          store.set((s) => (s.feed.some((x) => x.id === entry.id) ? {} : { feed: [...s.feed, entry].sort((a, b) => a.id - b.id).slice(-400) }));
          break;
        }
        // observe mode: pages, results and arrivals are in the AI resident's feed instead of toasts
        if (isObserving() && e.kind !== 'speech' && e.kind !== 'ended') break;
        if (e.kind === 'toast') store.toast(e.text, e.tone ?? 'info');
        else if (e.kind === 'page') store.toast(`📟 ${e.page.from}: ${e.page.text}`, e.page.priority === 'critical' ? 'bad' : e.page.priority === 'urgent' ? 'warn' : 'info');
        else if (e.kind === 'arrival') store.toast(`🚑 ${e.text}`, 'info');
        else if (e.kind === 'result') store.toast(`🧪 ${e.text}`, e.critical ? 'bad' : 'info');
        else if (e.kind === 'alarm') store.toast(`🔔 ${e.text}`, 'bad');
        else if (e.kind === 'speech') {
          const key = e.npcId ?? `phone:${e.contactId}`;
          store.set((s) => ({ speech: { ...s.speech, [key]: { text: e.text, at: Date.now() } } }));
          // (after a save is loaded the view is empty until its first state: the slot named the shift)
          const sessionId = store.get().view?.sessionId ?? this.sessionId;
          const lineKey = sessionId && e.lineId ? transcriptKey(sessionId, e.lineId) : undefined;
          speakNpc(key, e.name, e.text, e.voice, { gain: e.volume, transcriptKey: lineKey });
        } else if (e.kind === 'ended') store.set({ panel: null });
        break;
      }
      case 'debrief':
        sessionStorage.removeItem('ac.sessionId');
        if (store.get().screen === 'menu') break;
        // observe mode: stay in the ED — the feed panel shows the result and the AI's reflection, with a link to the full debrief
        if (store.get().solo && !isObserving()) {
          if (store.get().screen === 'game' && store.get().view) store.set({ loadedWorld: playerSave().world });
          rememberRotation(finishRotation(store.get().rotation, msg.debrief));
        }
        if (isObserving()) store.set({ debrief: msg.debrief, panel: null });
        else store.set({ debrief: msg.debrief, screen: 'debrief', panel: null });
        break;
      case 'watcher_chat':
        // observe mode: the watcher's own off-the-record thread with an NPC (ui/watcher.ts)
        applyWatcherMsg(msg);
        break;
      case 'error':
        if (this.awaiting) cancelStartupLook();
        if (msg.message.startsWith('Session expired') && store.get().solo) this.leaveSolo();
        store.toast(msg.message, 'bad');
        if (/session/i.test(msg.message)) sessionStorage.removeItem('ac.sessionId');
        break;
    }
  }
}

export const client = new GameClient();
