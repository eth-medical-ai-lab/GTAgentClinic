/**
 * Off-the-record small talk (server/npc/smalltalk.ts, content/smalltalk.ts): everyone who walks around
 * can be stopped for a word, and it never moves the simulation. With or without the chats, a shift has
 * the same log, score, AI-agent observations, clock and random stream; nobody takes an order, and
 * nobody knows anything about the patients on the board (offline and LLM alike).
 */
import { describe, expect, it } from 'vitest';
import { AMBIENT, FLOAT_RN, PERSONAS } from '../content/ambient';
import { CASES, SCENARIOS, STAFF } from '../content/scenarios';
import { CHAT_VOICES, SMALL_TALK } from '../content/smalltalk';
import { NpcBrain } from '../server/npc/brain';
import { isSmallTalk, scriptedReply, smallTalkIntent, type ScriptState } from '../server/npc/smalltalk';
import type { ChatRequest, LlmProvider } from '../server/llm/provider';
import { observationText } from '../server/sim/agentText';
import { debrief } from '../server/sim/scoring';
import { GameSession } from '../server/sim/session';
import { buildView } from '../server/sim/views';
import { castVoice } from '../server/tts/casting';
import type { Action, LlmStatus } from '../shared/types';
import { voiceTraits } from '../shared/voices';

const brain = new NpcBrain(null);
const LLM: LlmStatus = { provider: 'offline', label: 'offline', ok: true };
const ROSTER = [...Object.keys(PERSONAS), FLOAT_RN.id, ...STAFF.filter((s) => !s.talkable).map((s) => s.id)];

/** what nobody off the record may ever say: the shift's patients, their families, their diagnoses */
const CASE_NAMES = Object.values(CASES).flatMap((c) => [c.patient.firstName, c.patient.lastName, ...(c.family ? c.family.name.split(' ') : [])]);
const DIAGNOSES = /stemi|myocardial|infarct|sepsis|septic|esbl|pyelo|appendic|fibrillation|thyro|levothyrox|sprain|rca\b/i;
const leaks = (say: string) => CASE_NAMES.filter((n) => new RegExp(`\\b${n}\\b`, 'i').test(say)).concat(DIAGNOSES.test(say) ? [say.match(DIAGNOSES)![0]] : []);

const PROBES = [
  'Hi!',
  "Hello, I'm Dr. Lee, one of the residents.",
  'What brings you in?',
  'How long have you been waiting?',
  'How are you feeling?',
  'Does it hurt?',
  'Where are the restrooms?',
  'Where can I get a coffee?',
  'What do you do here?',
  'How busy is it tonight?',
  'What are you reading?',
  'Do you know what is wrong with the lady in bed 4?',
  'Is Robert Keller having a heart attack?',
  'Give 1 mg epinephrine IV now.',
  'Can you get a 12-lead ECG on bed 2, stat?',
  'Do you want some painkillers?',
  'Let me take a look.',
  "What's your name?",
  'Thanks, take care.',
  'Purple elephants?',
];
const ORDERS = ['Give 1 mg epinephrine IV now.', 'Can you get a 12-lead ECG on bed 2, stat?', 'Please draw a troponin and hang a liter of saline.'];
const DECLINE = /not|can't|ask|nurse|just waiting|registration|clinic|break|grab/i;

function state(npcId: string, o: Partial<ScriptState> = {}): ScriptState {
  return { npcId, turn: 0, crowd: 11, night: true, room: 'waiting', woke: false, names: CASE_NAMES.map((n) => n.toLowerCase()), ...o };
}

describe('small talk: who can be talked to', () => {
  it('everyone who walks around has a persona: the crowd, the stand-in nurse and every non-gameplay staff member', () => {
    for (const id of ROSTER) expect(SMALL_TALK[id], id).toBeDefined();
    for (const st of STAFF.filter((s) => s.talkable)) expect(SMALL_TALK[st.id], st.id).toBeUndefined();
    expect(Object.keys(SMALL_TALK).sort()).toEqual([...new Set(ROSTER)].sort());
  });

  it("each has a voice of their own sex: the crowd's ambient voice, a chat voice, or their staff casting", () => {
    for (const id of ROSTER) {
      const st = STAFF.find((s) => s.id === id);
      for (const map of Object.keys(AMBIENT)) {
        const v = st?.voice ?? AMBIENT[map].voices[id] ?? CHAT_VOICES[id];
        expect(v, `${map}: ${id}`).toBeDefined();
        expect(voiceTraits(v!.id)!.sex, `${map}: ${id}`).toBe(SMALL_TALK[id].sex === 'f' ? 'F' : 'M');
      }
    }
    // and the server casts them (no "uncast" fallback)
    const s = new GameSession({ scenarioId: 'night_shift', seed: 3, playerName: 'T', mode: 'step', brain });
    for (const id of Object.keys(CHAT_VOICES)) expect(castVoice(s, { kind: 'speech', npcId: id, name: 'x', text: 'Hi.' }).id).toBe(CHAT_VOICES[id].id);
  });

  it('companions and visitors are never named like anyone in the cases', () => {
    for (const p of Object.values(SMALL_TALK)) expect(CASE_NAMES.map((n) => n.toLowerCase()), p.name).not.toContain(p.name.toLowerCase());
  });

  it('the view marks them talkable, off the record; gameplay staff and patients are unchanged', async () => {
    const s = new GameSession({ scenarioId: 'night_shift', seed: 42, playerName: 'T', mode: 'step', brain });
    await s.act({ type: 'wait', minutes: 15 });
    const npcs = buildView(s, LLM).npcs;
    for (const id of ['clerk_paul', 'sec_dave', 'hk_ines', 'vis_1', 'caf_luis', 'caf_rn_mei', 'caf_visitor']) expect(npcs.find((n) => n.id === id), id).toMatchObject({ talkable: true, offRecord: true });
    for (const v of npcs.filter((n) => n.ambient?.crowd)) expect(v, v.id).toMatchObject({ talkable: true, offRecord: true });
    for (const id of ['rn_rosa', 'rn_lena', 'att_shaw', 'tech_marcus']) expect(npcs.find((n) => n.id === id)!.offRecord, id).toBeUndefined();
    for (const v of npcs.filter((n) => n.role === 'patient')) expect(v.offRecord).toBeUndefined();
  });
});

describe('small talk: off the record', () => {
  /** a short shift with orders, results and dialogue; `chat` adds small talk in the waiting room and the cafeteria */
  async function shift(seed: number, chat: boolean) {
    const s = new GameSession({ scenarioId: 'night_shift', seed, playerName: 'T', mode: 'step', brain });
    const obs: string[] = [];
    const results: unknown[] = [];
    const say = async (npcId: string, text: string) => {
      const t = s.t;
      const r = await s.act({ type: 'talk', npcId, text });
      expect(r, `${npcId}: ${text}`).toMatchObject({ ok: true, costMin: 0, data: { offRecord: true } });
      expect(s.t).toBe(t);
      results.push(r);
    };
    const steps: (Action | 'waiting' | 'cafeteria')[] = [
      { type: 'wait', minutes: 13 },
      { type: 'move', to: 'bed_2' },
      { type: 'talk', npcId: 'pt_p_keller', text: 'Hi, I am the resident. What brings you in?' },
      { type: 'move', to: 'station' },
      { type: 'order', patientId: 'p_keller', code: 'ecg12' },
      { type: 'order', patientId: 'p_keller', code: 'trop' },
      { type: 'wait', minutes: 20 },
      { type: 'move', to: 'waiting' },
      'waiting',
      { type: 'wait', minutes: 40 },
      { type: 'move', to: 'cafeteria' },
      'cafeteria',
      { type: 'move', to: 'station' },
      { type: 'order', patientId: 'p_brunner', code: 'lactate' },
      { type: 'wait', minutes: 90 },
    ];
    for (const step of steps) {
      if (step === 'waiting') {
        if (!chat) continue;
        const crowd = s.ambient.crowdAt(s.t).find((id) => s.ambient.plan!.people.get(id)!.at(s.t)!.room === 'waiting')!;
        expect(crowd).toBeDefined();
        await say(crowd, 'Hi, how are you doing?');
        await say(crowd, 'Give 1 mg epinephrine IV now.');
        await say(crowd, 'What brings you in?');
        await say('clerk_paul', 'How busy is it?');
        await say('clerk_paul', 'Please draw a troponin on bed 2, stat.');
        await say('sec_dave', 'Hi Dave, where are the restrooms?');
        continue;
      }
      if (step === 'cafeteria') {
        if (!chat) continue;
        await say('caf_luis', "What's the soup?");
        await say('caf_luis', 'Can you get a 12-lead ECG on Keller, stat?');
        await say('caf_rn_mei', 'Can you hang a liter of saline in bed 4?');
        continue;
      }
      await s.act(step);
      obs.push(observationText(s));
    }
    return { s, obs, results };
  }

  it('identical log, score, observations, clock and random stream with and without the chats', async () => {
    const a = await shift(2024, true);
    const b = await shift(2024, false);
    expect(a.results.length).toBe(9);
    expect(JSON.stringify(a.s.log)).toBe(JSON.stringify(b.s.log));
    expect(JSON.stringify(debrief(a.s))).toBe(JSON.stringify(debrief(b.s)));
    expect(a.obs).toEqual(b.obs);
    expect(a.s.t).toBe(b.s.t);
    expect(a.s.rng.next()).toBe(b.s.rng.next());
    // nothing was ordered, and the session's own conversations (what agents read) never saw the chats
    for (const [pid, p] of a.s.patients) expect(p.orders.map((o) => o.code)).toEqual(b.s.patients.get(pid)!.orders.map((o) => o.code));
    expect([...a.s.conversations.keys()]).toEqual([...b.s.conversations.keys()]);
    for (const o of a.obs) expect(o).not.toMatch(/epinephrine|soup|restrooms/i);
    // the player's view carries them, keyed by who they talked to
    const view = buildView(a.s, LLM);
    for (const id of ['clerk_paul', 'sec_dave', 'caf_luis', 'caf_rn_mei']) expect(view.conversations.find((c) => c.key === id)?.lines.length, id).toBeGreaterThanOrEqual(2);
  });

  it('nobody takes an order, offline: no order placed, a polite no', async () => {
    const s = new GameSession({ scenarioId: 'night_shift', seed: 7, playerName: 'T', mode: 'realtime', brain });
    s.advance(20 * 60);
    const before = JSON.stringify([...s.patients.values()].map((p) => p.orders));
    // (not the man about to faint: he can barely answer anything)
    for (const id of ['clerk_paul', 'sec_dave', 'hk_ines', 'caf_luis', 'caf_rn_mei', 'vis_2', ...s.ambient.crowdAt(s.t).filter((x) => x !== 'amb_faint')]) {
      for (const text of ORDERS) {
        const r = await s.act({ type: 'talk', npcId: id, text });
        expect(r.ok, `${id}: ${r.message}`).toBe(true);
        expect(r.text, `${id}: ${text}`).toMatch(DECLINE);
        expect(leaks(r.text!), `${id}: ${r.text}`).toEqual([]);
      }
    }
    expect(JSON.stringify([...s.patients.values()].map((p) => p.orders))).toBe(before);
    expect(s.log.some((e) => e.kind === 'talk' && ROSTER.includes(e.npcId ?? ''))).toBe(false);
  });

  it('someone who is not here (yet) cannot be talked to, and that costs nothing either', async () => {
    const s = new GameSession({ scenarioId: 'night_shift', seed: 7, playerName: 'T', mode: 'step', brain });
    s.playerLocation = 'waiting';
    const late = AMBIENT.night_shift.arrivals.at(-1)!.persona;
    expect(s.ambient.crowdAt(0)).not.toContain(late);
    const r = await s.act({ type: 'talk', npcId: late, text: 'Hi!' });
    expect(r).toMatchObject({ ok: false, costMin: 0 });
    // the clinic is closed at night: its staff aren't on duty
    expect(isSmallTalk(s, 'cl_carmen')).toBe(true);
    expect(await s.act({ type: 'talk', npcId: 'cl_carmen', text: 'Hi!' })).toMatchObject({ ok: false, costMin: 0 });
    // and in step mode you have to be in the same room
    expect(await s.act({ type: 'talk', npcId: 'caf_luis', text: 'Hi!' })).toMatchObject({ ok: false, costMin: 0 });
    expect(s.t).toBe(0);
  });
});

describe('small talk: scripted replies (offline)', () => {
  it('every persona answers every probe in a sentence or three, never naming a case patient or a diagnosis, with no actions', () => {
    for (const [id, p] of Object.entries(SMALL_TALK)) {
      for (const [k, text] of PROBES.entries()) {
        const r = scriptedReply(p, text, state(id, { turn: k % 3, room: id.startsWith('caf_') ? 'cafeteria' : id.startsWith('cl_') ? 'clinic' : 'waiting' }));
        expect(r.say.length, `${id}: ${text}`).toBeGreaterThan(1);
        expect(r.say.split(/[.!?]+\s/).length, `${id}: ${r.say}`).toBeLessThanOrEqual(4);
        expect(r.actions).toEqual([]);
        expect(r.revealed).toEqual([]);
        expect(leaks(r.say), `${id}: "${text}" → ${r.say}`).toEqual([]);
        if (ORDERS.includes(text)) expect(r.say, `${id}: ${text}`).toMatch(DECLINE);
      }
    }
  });

  it('reads the intent: orders, offers, other patients, directions, the wait', () => {
    expect(smallTalkIntent('Give 1 mg epinephrine IV')).toBe('order');
    expect(smallTalkIntent('Could you start a saline bolus please')).toBe('order');
    expect(smallTalkIntent('Do you want some painkillers?')).toBe('offer');
    expect(smallTalkIntent('Who is in bed 4?')).toBe('patients');
    expect(smallTalkIntent('How is Mrs Brunner doing?', ['brunner'])).toBe('patients');
    expect(smallTalkIntent('Where is the restroom?')).toEqual({ place: 'restroom' });
    expect(smallTalkIntent('Is there any coffee around here?')).toEqual({ place: 'coffee' });
    expect(smallTalkIntent('How long have you been waiting?')).toBe('wait');
    expect(smallTalkIntent('What happened to your wrist?')).toBe('why');
  });

  it('follows what they are doing: asleep, on the phone, fainted, coming round', () => {
    const p = SMALL_TALK.amb_sleeper;
    expect(scriptedReply(p, 'Hi', state('amb_sleeper', { act: 'sleep', woke: true })).say).toMatch(/dozed off/);
    expect(scriptedReply(SMALL_TALK.amb_daughter, 'How are you?', state('amb_daughter', { act: 'phone_call' })).say).toMatch(/^\*covers the phone\*/);
    expect(scriptedReply(SMALL_TALK.amb_faint, 'Sir, can you hear me?', state('amb_faint', { act: 'floor' })).say).toMatch(/doesn't respond/);
    expect(scriptedReply(SMALL_TALK.amb_faint, 'Are you okay?', state('amb_faint', { act: 'come_round' })).emotion).toBe('confused');
    // the same question, turn and person always get the same line (no Math.random, no session rng)
    const a = scriptedReply(SMALL_TALK.amb_wrist, 'What happened?', state('amb_wrist', { turn: 2 }));
    expect(scriptedReply(SMALL_TALK.amb_wrist, 'What happened?', state('amb_wrist', { turn: 2 }))).toEqual(a);
  });
});

describe('small talk: with an LLM', () => {
  it('the prompt and [Situation] carry no case information, and any action the model returns is dropped', async () => {
    const seen: ChatRequest[] = [];
    const provider: LlmProvider = {
      status: { provider: 'anthropic-api', label: 'test', ok: true },
      async chat(req) {
        seen.push(req);
        return { json: { say: 'Sure thing.', emotion: 'neutral', revealed: ['x'], counseled: [], actions: [{ id: 'verbal_order', code: 'epi' }] }, text: '', latencyMs: 1 };
      },
      forget() {},
      dispose() {},
    };
    const s = new GameSession({ scenarioId: 'night_shift', seed: 11, playerName: 'T', mode: 'realtime', brain: new NpcBrain(provider) });
    s.advance(45 * 60);
    const before = JSON.stringify([...s.patients.values()].map((p) => p.orders));
    for (const id of ['clerk_paul', 'caf_rn_mei', ...s.ambient.crowdAt(s.t).slice(0, 4)]) {
      const r = await s.act({ type: 'talk', npcId: id, text: 'Give 1 mg epinephrine IV to bed 2 now.' });
      expect(r).toMatchObject({ ok: true, text: 'Sure thing.', data: { offRecord: true } });
    }
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const req of seen) {
      expect(leaks(req.system), req.key).toEqual([]);
      expect(leaks(req.message.replace(/Doctor:.*$/s, '')), req.message).toEqual([]);
      expect(req.key.startsWith(`${s.id}:smalltalk:`)).toBe(true);
    }
    expect(JSON.stringify([...s.patients.values()].map((p) => p.orders))).toBe(before);
  });
});

void SCENARIOS;
