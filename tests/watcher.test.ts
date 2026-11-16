/**
 * Watcher chats (server/npc/watcher.ts): while an AI doctor plays, the person watching can talk to
 * anyone, off the record. The AI run must stay untouched and reproducible, so these tests replay the
 * scripted demo's shifts (agents/demo-agent.ts, ported in-process) three ways — no watcher, a watcher
 * chatting between every action, and a watcher chatting while each action runs — and require the
 * same action results, observations, views, session events, event log, debrief, AI conversations,
 * clock and random stream. The watcher is adversarial: it gives verbal orders, stops the nurse's
 * wrong-patient medication, asks for cultures first, asks family to step out, asks for consent,
 * takes a history and counsels. None of it may count.
 */
import { describe, expect, it } from 'vitest';
import type { ChatRequest, ChatResult, LlmProvider } from '../server/llm/provider';
import { NpcBrain } from '../server/npc/brain';
import { STUDENT_FRAME, WATCHER_BURST, watcherMessage, watcherTalk, watcherThread, watcherThreadCount } from '../server/npc/watcher';
import { observationText } from '../server/sim/agentText';
import { attachAiDoctor, feedFromEvent, narrationEntries, recordAction } from '../server/sim/aiDoctor';
import { debrief } from '../server/sim/scoring';
import { GameSession } from '../server/sim/session';
import { buildView } from '../server/sim/views';
import type { SpeechEvent } from '../server/tts/casting';
import { UsageLedger } from '../server/usage';
import type { Action, ActionResult, LlmStatus, PlayerView, ServerMsg } from '../shared/types';

const WATCHER = 'watcher-test-0001';
const OTHER = 'watcher-test-0002';

/** what a med student says to everyone, round-robin: questions, but also every kind of action */
const SAY = [
  "Hi, I'm a medical student with the doctor's team. The doctor will be with you shortly.",
  'When did this start? Any medications, allergies, sildenafil or Viagra? Any blood thinners?',
  'Stop! Check the wristband, that metoprolol is for Kellner in Bed 3, not Keller.',
  'Please draw blood cultures first, before the antibiotics.',
  'Give aspirin 324 mg and start heparin for bed 2, and recheck vitals with a temperature, please.',
  'Could you step out and give us a moment of privacy?',
  'Do you consent to the procedure and the catheter? We need your agreement.',
  "Good news: you don't need an X-ray or MRI. Brace, ibuprofen, early exercises; come back if the pain gets worse or you can't walk.",
  'Please fax the culture records over, and accept this patient to the ICU.',
  "What's going on with your patients? Any update?",
  'Is the doctor coming soon? Do you need anything?',
];

type Act = (a: Action) => Promise<ActionResult>;
type Mode = 'none' | 'between' | 'during';

interface Run {
  s: GameSession;
  results: string[];
  obs: string[];
  views: string[];
  events: string[];
  /** the end state, taken once: event log, debrief, conversations, feed, patients, and where the random stream is */
  final: Record<string, string>;
  chats: { ok: number; refused: number; replies: { npcId: string; say: string; text: string }[] };
}

/** session ids carry the wall clock, narration entries a wall-clock `at`: everything else must match */
const scrub = (s: GameSession, x: unknown) => JSON.stringify(x, (k, v) => (k === 'at' && typeof v === 'number' ? undefined : v)).split(s.id).join('<session>');

/**
 * Conversation line ids ("l17") are numbered across the whole process (server/npc/dialogue.ts), so
 * two runs in one process start at different numbers. Compare them relative to each run's first
 * line: a watcher line taking a number from that counter would still show up as a gap.
 */
function relativeLineIds(r: Run): (x: string) => string {
  const ids = [...r.s.conversations.values()].flatMap((c) => c.lines.map((l) => /^l(\d+)$/.exec(l.id)?.[1])).filter((x): x is string => !!x).map(Number);
  const base = ids.length ? Math.min(...ids) : 0;
  return (x) => x.replace(/"id":"l(\d+)"/g, (_, n: string) => `"id":"l+${Number(n) - base}"`);
}

/** a watcher talks to everyone the client could click on, plus the AI doctor and someone who isn't there */
async function chatter(s: GameSession, view: PlayerView, step: number, out: Run['chats'], clock: { now: number }) {
  const ids = [...view.npcs.map((n) => n.id), 'ai_doctor', 'pt_nobody'];
  for (const [k, npcId] of ids.entries()) {
    const text = SAY[(step + k) % SAY.length];
    clock.now += 10_000; // past the rate limit
    const r = await watcherTalk(s, k % 5 === 0 ? OTHER : WATCHER, npcId, text, clock.now);
    if (r.ok) {
      out.ok++;
      out.replies.push({ npcId, say: r.speech.text, text });
    } else out.refused++;
  }
}

async function play(map: 'night_shift' | 'orientation', mode: Mode, brain = new NpcBrain(null), seed = 2024): Promise<Run> {
  const s = new GameSession({ scenarioId: map, seed, playerName: 'Scripted demo', mode: 'step', brain });
  attachAiDoctor(s, { label: 'Scripted demo', observe: true });
  const run: Run = { s, results: [], obs: [], views: [], events: [], final: {}, chats: { ok: 0, refused: 0, replies: [] } };
  // like server/index.ts: every session event, and the watchers' feed lines it makes
  s.on((e) => {
    feedFromEvent(s, e);
    run.events.push(scrub(s, e));
  });
  const clock = { now: 1_000_000 };
  let view = buildView(s, s.brain.status);
  let step = 0;
  const act: Act = async (a) => {
    const during = mode === 'during' ? chatter(s, view, step, run.chats, clock) : null;
    const r = await s.act(a);
    recordAction(s, a, r);
    await during;
    run.results.push(scrub(s, r));
    run.obs.push(scrub(s, observationText(s)));
    view = buildView(s, s.brain.status);
    // the HUD's token chip also shows this server's totals for today and since start: they move with every
    // session in the process, watchers included, so only the run's own usage is part of the run
    run.views.push(scrub(s, view.usage ? { ...view, usage: { ...view.usage, today: null, process: null } } : view));
    if (mode === 'between') await chatter(s, view, step, run.chats, clock);
    step++;
    return r;
  };
  if (map === 'night_shift') await nightShift(s, act);
  else await orientation(act);
  await act({ type: 'end_shift' });
  const ids = relativeLineIds(run);
  run.views = run.views.map(ids);
  run.final = {
    log: scrub(s, s.log),
    debrief: scrub(s, debrief(s)),
    conversations: ids(scrub(s, [...s.conversations.values()])),
    feed: scrub(s, narrationEntries(s)),
    state: scrub(s, { t: s.t, flags: [...s.flags], safety: s.safety.map((x) => [x.status, x.detail]), pages: s.pages, patients: [...s.patients.values()].map((p) => [p.id, [...p.revealed], [...p.counseled], [...p.inspected], p.emotion, p.firstContactT, p.family?.status, p.flow]) }),
    // the clinical random stream is in the same place afterwards
    rng: String(s.rng.next()),
  };
  return run;
}

function expectSameRun(a: Run, b: Run) {
  expect(b.results).toEqual(a.results);
  expect(b.obs).toEqual(a.obs);
  expect(b.views).toEqual(a.views);
  expect(b.events).toEqual(a.events);
  expect(b.final).toEqual(a.final);
}

describe('watcher chats leave the AI run untouched', () => {
  it('Night Shift (scripted demo, seed 2024): identical with a watcher chatting between and during every action', async () => {
    const quiet = await play('night_shift', 'none');
    const between = await play('night_shift', 'between');
    const during = await play('night_shift', 'during');
    expectSameRun(quiet, between);
    expectSameRun(quiet, during);
    // not vacuous: the watcher really talked to patients, family, nurses and the attending
    expect(between.chats.ok).toBeGreaterThan(300);
    const talkedTo = new Set(between.chats.replies.map((r) => r.npcId));
    for (const id of ['pt_p_brunner', 'pt_p_keller', 'pt_p_kellner', 'pt_p_okafor', 'rn_tom', 'rn_rosa', 'att_shaw']) expect(talkedTo, id).toContain(id);
    expect(watcherThreadCount(between.s)).toBeGreaterThan(10);
    // the scripted demo's score (the reference baseline) is unchanged
    expect(debrief(between.s).percent).toBe(debrief(quiet.s).percent);
    expect(debrief(quiet.s).percent).toBeGreaterThanOrEqual(85);
  });

  it('Orientation Day: identical, although the watcher keeps asking the boyfriend to step out', async () => {
    const quiet = await play('orientation', 'none');
    const between = await play('orientation', 'between');
    expectSameRun(quiet, between);
    expect(between.chats.replies.some((r) => r.npcId === 'fam_jake' && /step out/.test(r.text))).toBe(true);
  });

  it('a watcher never shows up in what the agent or other spectators see', async () => {
    const run = await play('night_shift', 'between');
    const agentSide = [...run.obs, ...run.views, ...run.events, JSON.stringify([...run.s.conversations.values()]), JSON.stringify(run.s.log), JSON.stringify(narrationEntries(run.s))].join('\n');
    for (const text of SAY) expect(agentSide.includes(text), text).toBe(false);
    expect(agentSide).not.toMatch(/medical student|"id":"w\d+"/i);
  });
});

describe('what the NPCs say to a student', () => {
  async function shift(map = 'night_shift', minutes = 30) {
    const s = new GameSession({ scenarioId: map, seed: 2024, playerName: 'Scripted demo', mode: 'step', brain: new NpcBrain(null) });
    attachAiDoctor(s, { label: 'Scripted demo' });
    await s.act({ type: 'wait', minutes });
    return s;
  }

  it('patients tell a student their story, but nothing counts as history taken', async () => {
    const s = await shift();
    const p = s.patients.get('p_keller')!;
    const r = await watcherTalk(s, WATCHER, 'pt_p_keller', "Hi, I'm a medical student with the doctor's team. The doctor will be with you shortly.", 1);
    expect(r.ok && r.speech.text).toMatch(/^Oh, a student\. Okay\. /);
    const h = await watcherTalk(s, WATCHER, 'pt_p_keller', 'Have you taken sildenafil or Viagra? Any medications?', 20_000);
    expect(h.ok).toBe(true);
    expect(p.revealed.size).toBe(0);
    expect(p.firstContactT).toBeUndefined();
    expect(s.log.some((e) => e.kind === 'talk' || e.kind === 'fact')).toBe(false);
  });

  it('nurses take no orders from a student and do not stop the wrong-patient medication', async () => {
    const s = await shift('night_shift', 30);
    const before = JSON.stringify({ log: s.log, flags: [...s.flags], safety: s.safety.map((x) => x.status) });
    for (const [i, text] of ['Stop — check the wristband, wrong patient!', 'Draw blood cultures before the antibiotics, please.', 'Give 324 mg of aspirin to bed 2.'].entries()) {
      const r = await watcherTalk(s, WATCHER, 'rn_tom', text, 10_000 * (i + 1));
      expect(r.ok && r.speech.text).toMatch(/I take orders from the doctor/);
    }
    expect(JSON.stringify({ log: s.log, flags: [...s.flags], safety: s.safety.map((x) => x.status) })).toBe(before);
  });

  it('the attending teaches; staff greet a student; the waiting room makes small talk', async () => {
    const s = await shift();
    const a = await watcherTalk(s, WATCHER, 'att_shaw', "Hi, I'm the medical student shadowing tonight.", 1);
    expect(a.ok && a.speech.text).toMatch(/Watch how your resident works the board/);
    const n = await watcherTalk(s, WATCHER, 'rn_rosa', 'Hello! What is going on tonight?', 20_000);
    expect(n.ok && n.speech.text).toMatch(/shadowing the AI resident/);
    const crowd = buildView(s, s.brain.status).npcs.find((x) => x.ambient?.crowd);
    if (crowd) expect((await watcherTalk(s, WATCHER, crowd.id, 'Hi, how are you doing?', 40_000)).ok).toBe(true);
  });

  it('refuses what is not a watcher chat', async () => {
    const human = new GameSession({ scenarioId: 'night_shift', seed: 1, playerName: 'Human', mode: 'step', brain: new NpcBrain(null) });
    expect(await watcherTalk(human, WATCHER, 'rn_rosa', 'Hi', 1)).toMatchObject({ ok: false });
    const s = await shift();
    expect(await watcherTalk(s, WATCHER, 'ai_doctor', 'What are you thinking?', 1)).toMatchObject({ ok: false, error: expect.stringMatching(/transcript/) });
    expect(await watcherTalk(s, WATCHER, 'pt_nobody', 'Hi', 2)).toMatchObject({ ok: false });
    expect(await watcherTalk(s, 'x', 'rn_rosa', 'Hi', 3)).toMatchObject({ ok: false, error: 'Bad watcher id.' });
    expect(await watcherTalk(s, WATCHER, 'rn_rosa', '   ', 4)).toMatchObject({ ok: false });
    // a burst, then the rate limit
    for (let i = 0; i < WATCHER_BURST; i++) expect((await watcherTalk(s, OTHER, 'rn_rosa', `Question ${i}?`, 100_000)).ok).toBe(true);
    expect(await watcherTalk(s, OTHER, 'rn_rosa', 'One more?', 100_000)).toMatchObject({ ok: false });
    await s.act({ type: 'end_shift' });
    expect(await watcherTalk(s, WATCHER, 'rn_rosa', 'Hi', 500_000)).toMatchObject({ ok: false, error: 'The shift is over.' });
  });

  it('each watcher has their own threads', async () => {
    const s = await shift();
    await watcherTalk(s, WATCHER, 'rn_rosa', 'Hi Rosa!', 1);
    expect(watcherThread(s, WATCHER, 'rn_rosa')?.lines.map((l) => l.speaker)).toEqual(['player', 'npc']);
    expect(watcherThread(s, OTHER, 'rn_rosa')).toBeNull();
    expect(s.conversations.size).toBe(0);
  });

  it('the WebSocket handler answers only the watcher: the thread, and the line as speech', async () => {
    const s = await shift();
    const sent: ServerMsg[] = [];
    const out = { send: (m: ServerMsg) => void sent.push(m), voice: (e: SpeechEvent): SpeechEvent => ({ ...e, voice: { id: 'af_test', speed: 1 } }) };
    await watcherMessage(s, { type: 'watcher_talk', watcherId: WATCHER, npcId: 'rn_aisha', text: 'Hi!' }, out);
    expect(sent.map((m) => m.type)).toEqual(['event', 'watcher_chat']);
    expect(sent[0]).toMatchObject({ type: 'event', event: { kind: 'speech', npcId: 'rn_aisha', voice: { id: 'af_test' } } });
    expect(sent[1]).toMatchObject({ type: 'watcher_chat', thread: { npcId: 'rn_aisha', typing: false, lines: [{ speaker: 'player', text: 'Hi!' }, { speaker: 'npc' }] } });
    await watcherMessage(s, { type: 'watcher_thread', watcherId: WATCHER, npcId: 'rn_aisha' }, out);
    expect(sent[2]).toMatchObject({ type: 'watcher_chat', thread: { lines: [{}, {}] } });
    await watcherMessage(s, { type: 'watcher_talk', watcherId: WATCHER, npcId: 'ai_doctor', text: 'Hi' }, out);
    expect(sent[3]).toMatchObject({ type: 'watcher_chat', error: expect.any(String) });
  });
});

// ───────────────────────────── with an LLM ─────────────────────────────

/**
 * A deterministic stand-in for the NPC model: a pure function of the request. For the AI doctor's
 * NPC turns it reveals a fact; for watcher turns it tries everything a reply could do — facts,
 * counseling and actions — none of which the watcher path may apply.
 */
class FakeLlm implements LlmProvider {
  readonly status: LlmStatus = { provider: 'anthropic-api', label: 'Fake LLM', model: 'fake', ok: true };
  readonly requests: ChatRequest[] = [];
  async chat(req: ChatRequest): Promise<ChatResult> {
    this.requests.push(JSON.parse(JSON.stringify(req)));
    await new Promise((r) => setTimeout(r, 0)); // a little latency, so turns interleave
    const props = (req.schema as { properties: Record<string, { items?: { enum?: string[]; properties?: { id?: { enum?: string[] } } } }> }).properties;
    const facts = props.revealed?.items?.enum ?? [];
    const last = req.message.split('\n').pop() ?? '';
    const json = req.key.endsWith(':watch')
      ? { say: `(to the student) ${last.slice(0, 60)}`, emotion: 'happy', revealed: ['any_fact'], counseled: ['any'], actions: [{ id: 'stop_med' }, { id: 'cultures_first', patient: 'bed_4' }, { id: 'verbal_order', code: 'aspirin', patient: 'bed_2' }, { id: 'step_out' }, { id: 'consent' }, { id: 'accept', patient: 'bed_2' }] }
      : { say: `Reply #${req.history.length / 2}: ${last.slice(0, 60)}`, emotion: 'neutral', revealed: facts.slice(0, 1), counseled: [], actions: [] };
    return { json, text: '', latencyMs: 1, usage: { model: 'fake', inputTokens: 1000, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, costUSD: 0.001, costSource: 'price-table', requests: 1, latencyMs: 1 } };
  }
  forget() {}
  dispose() {}
}

describe('watcher chats with LLM NPCs', () => {
  it('the AI run, its NPC conversations and its usage are the same with or without a chatting watcher', async () => {
    const llmA = new FakeLlm();
    const llmB = new FakeLlm();
    const ledgerA = new UsageLedger();
    const ledgerB = new UsageLedger();
    const quiet = await play('night_shift', 'none', new NpcBrain(llmA, ledgerA));
    const chatty = await play('night_shift', 'during', new NpcBrain(llmB, ledgerB));
    expectSameRun(quiet, chatty);
    // the AI doctor's NPCs got exactly the same requests: no watcher turn in any history or prompt
    const ai = (l: FakeLlm, s: GameSession) => l.requests.filter((r) => !r.key.endsWith(':watch')).map((r) => scrub(s, r));
    expect(ai(llmB, chatty.s)).toEqual(ai(llmA, quiet.s));
    for (const r of ai(llmB, chatty.s)) expect(r).not.toMatch(/Student:|medical student/i);
    // watcher turns: their own key, the student frame, a reply schema without facts or actions
    const watch = llmB.requests.filter((r) => r.key.endsWith(':watch'));
    expect(watch.length).toBeGreaterThan(100);
    for (const r of watch) {
      expect(r.key).toBe(`${chatty.s.id}:watch`);
      expect(r.system.endsWith(STUDENT_FRAME)).toBe(true);
      expect(Object.keys((r.schema as { properties: object }).properties)).toEqual(['say', 'emotion']);
      expect(r.message).toMatch(/\nStudent: /);
    }
    expect(chatty.chats.replies.some((r) => r.say.startsWith('(to the student)'))).toBe(true);
    // usage: the run's own NPC usage is the same; watcher turns only count in the process totals
    const view = (l: UsageLedger, s: GameSession) => l.sessionView(s.id, 'anthropic-api');
    expect(view(ledgerB, chatty.s).session).toEqual(view(ledgerA, quiet.s).session);
    expect(view(ledgerB, chatty.s).byNpc.some((n) => n.key.includes('watch'))).toBe(false);
    expect(view(ledgerB, chatty.s).process.calls).toBeGreaterThan(view(ledgerA, quiet.s).process.calls);
  });

  it('with an NPC budget set, watchers get scripted replies and never spend it', async () => {
    const llm = new FakeLlm();
    const ledger = new UsageLedger().configure({ maxUsd: 100 });
    const s = new GameSession({ scenarioId: 'night_shift', seed: 2024, playerName: 'Claude', mode: 'step', brain: new NpcBrain(llm, ledger) });
    attachAiDoctor(s, { label: 'Claude Sonnet', model: 'sonnet' });
    await s.act({ type: 'wait', minutes: 20 });
    const r = await watcherTalk(s, WATCHER, 'rn_rosa', 'Hi!', 1);
    expect(r).toMatchObject({ ok: true, source: 'offline' });
    expect(llm.requests.length).toBe(0);
  });
});

// ───────────────────────────── the scripted demo's policy (agents/demo-agent.ts), in-process ─────────────────────────────

const order = (act: Act, patientId: string, code: string, params?: Record<string, string>) => act({ type: 'order', patientId, code, params });

async function ankle(act: Act, analgesiaGiven = false) {
  await act({ type: 'move', to: 'ft_1' });
  await act({ type: 'talk', npcId: 'pt_p_okafor', text: 'Hi, I am one of the doctors. How did you hurt it and could you walk on it afterwards?' });
  await act({ type: 'talk', npcId: 'pt_p_okafor', text: 'Can you point to where it hurts most? Any numbness or tingling in your foot or toes?' });
  for (const m of ['msk_lat_malleolus', 'msk_med_malleolus', 'msk_5th_mt', 'msk_navicular', 'msk_weight_bearing', 'msk_neurovascular']) await act({ type: 'examine', patientId: 'p_okafor', maneuver: m });
  await act({ type: 'talk', npcId: 'pt_p_okafor', text: "Good news: by the Ottawa ankle rules you don't need an X-ray or MRI. Brace, ibuprofen, early exercises — expect a few weeks before you return to play; come back if pain worsens or you can't walk." });
  await act({ type: 'move', to: 'station' });
  for (const code of analgesiaGiven ? ['ankle_brace', 'ice_elevate'] : ['ibuprofen', 'ankle_brace', 'ice_elevate']) await order(act, 'p_okafor', code);
  await act({ type: 'disposition', patientId: 'p_okafor', decision: 'discharge', diagnoses: ['Right lateral ankle sprain'] });
}

const labSeries = (text: string | undefined, code: string) => {
  const m = new RegExp(`\\(${code}\\) \\[[^\\]]*\\]: (.+)$`, 'm').exec(text ?? '');
  return m ? m[1].split(' → ').filter((v) => !v.includes('(historical)')).map((v) => v.replace(/\s*@.*$/, '').trim()) : [];
};

async function nightShift(s: GameSession, act: Act) {
  await act({ type: 'wait', minutes: 6 });
  await act({ type: 'move', to: 'station' });
  for (const code of ['lactate', 'bcx', 'cbc', 'cmp', 'ua', 'ucx', 'vitals_now', 'monitor']) await order(act, 'p_brunner', code);
  await order(act, 'p_brunner', 'lr_bolus', { dose: '30 mL/kg' });
  await act({ type: 'call', contactId: 'gp_whitfield', text: 'ED resident calling about Margarethe Brunner, DOB 02/11/1945. Any prior urine cultures or resistant organisms? Please fax the records.' });
  await order(act, 'p_brunner', 'meropenem');
  await act({ type: 'wait', minutes: 12 });
  const ecg = await act({ type: 'ehr_view', patientId: 'p_keller', section: 'ecg' });
  const ecgId = /\b(ecg\d+)\b/.exec(ecg.text ?? '')?.[1];
  if (ecgId) await act({ type: 'sign_ecg', ecgId, interpretation: 'Sinus bradycardia 56, inferior STEMI (ST elevation II, III, aVF) with reciprocal depression I/aVL.' });
  for (const code of ['aspirin', 'monitor', 'iv_access', 'ecg_right', 'heparin', 'trop', 'bmp', 'cbc', 'coags']) await order(act, 'p_keller', code);
  await act({ type: 'call', contactId: 'cards', text: 'Bed 2, Robert Keller, 64M, chest pressure since 21:45, ECG shows inferior STEMI with ST elevation II, III, aVF, BP 104/66. Aspirin given. Please activate the cath lab.' });
  await act({ type: 'disposition', patientId: 'p_keller', decision: 'cath_lab', service: 'Interventional cardiology', diagnoses: ['Inferior STEMI', 'RV involvement'] });
  await act({ type: 'move', to: 'bed_2' });
  await act({ type: 'talk', npcId: 'pt_p_keller', text: "Mr. Keller, you're having a heart attack — one of your heart arteries is blocked. The cardiology team is coming to open it with a catheter and a stent. One important question: have you taken sildenafil, Viagra or any similar pill in the last two days?" });
  await act({ type: 'inspect', itemId: 'keller_medbag' });
  await act({ type: 'move', to: 'station' });
  const ecgs = await act({ type: 'ehr_view', patientId: 'p_keller', section: 'ecg' });
  const v4r = /- (ecg\d+) [^\n]*\n\s+Machine read: ([^\n]*)\n\s+UNSIGNED/.exec(ecgs.text ?? '');
  if (v4r) await act({ type: 'sign_ecg', ecgId: v4r[1], interpretation: 'Right-sided ECG: ST elevation 1.5 mm in V4R, consistent with right-ventricular infarction, with the known inferior STEMI.' });
  await act({ type: 'wait', minutes: 15 });
  for (const code of ['bmp', 'mg', 'tsh', 'cbc', 'trop']) await order(act, 'p_kellner', code);
  await order(act, 'p_kellner', 'metoprolol_iv');
  if (/Heading into Bed 2 with metoprolol/i.test(observationText(s))) {
    await act({ type: 'move', to: 'bed_2' });
    await act({ type: 'talk', npcId: 'rn_tom', text: 'Tom, stop — check the wristband. That metoprolol is for Kellner in Bed 3, not Keller.' });
  }
  await act({ type: 'move', to: 'bed_3' });
  await act({ type: 'inspect', itemId: 'kellner_bottle' });
  await act({ type: 'talk', npcId: 'pt_p_kellner', text: 'Mr. Kellner, I am one of the doctors. When exactly did the palpitations start, and have you had any chest pain or fainting? Since the thyroid dose went up, have you felt jittery, sweaty or lost weight?' });
  await act({ type: 'talk', npcId: 'pt_p_kellner', text: 'Do you have diabetes, heart failure, or a past stroke or mini-stroke? And any bleeding problems, ulcers, or blood thinners?' });
  await act({ type: 'talk', npcId: 'pt_p_kellner', text: 'Your heart is in atrial fibrillation, probably triggered by the higher thyroid dose — we will slow it down and get the dose adjusted. Atrial fibrillation raises the risk of stroke, so I want to start a blood thinner, apixaban, once your kidney tests are back.' });
  await act({ type: 'move', to: 'station' });
  const kEcg = await act({ type: 'ehr_view', patientId: 'p_kellner', section: 'ecg' });
  const kEcgId = /\b(ecg\d+)\b/.exec(kEcg.text ?? '')?.[1];
  if (kEcgId) await act({ type: 'sign_ecg', ecgId: kEcgId, interpretation: 'Atrial fibrillation with rapid ventricular response, rate ~134. Nonspecific, likely rate-related ST depression V5–V6.' });
  await ankle(act);
  await order(act, 'p_brunner', 'lactate');
  await act({ type: 'wait', minutes: 50 });
  const labs = await act({ type: 'ehr_view', patientId: 'p_brunner', section: 'labs', query: 'lact' });
  const lact = labSeries(labs.text, 'lactate').map((v) => parseFloat(v)).filter(Number.isFinite);
  const summary = await act({ type: 'ehr_view', patientId: 'p_brunner', section: 'summary' });
  const mapNow = Number(/\(MAP (\d+)\)/.exec(summary.text ?? '')?.[1] ?? NaN);
  if (mapNow < 65) {
    await order(act, 'p_brunner', 'norepinephrine');
    await act({ type: 'call', contactId: 'icu', text: `Bed 4, Margarethe Brunner, 81F, septic shock from pyelonephritis with prior ESBL E. coli: MAP ${mapNow} despite 30 mL/kg, lactate ${lact.join(' → ')}, norepinephrine started, meropenem after blood cultures. ICU please.` });
    await act({ type: 'disposition', patientId: 'p_brunner', decision: 'admit_icu', service: 'Medical ICU', diagnoses: ['Septic shock from acute pyelonephritis (ESBL E. coli)', 'AKI', 'Delirium'] });
  } else {
    await act({ type: 'call', contactId: 'hosp', text: `Admission: Bed 4, Margarethe Brunner, 81F, sepsis from pyelonephritis with prior ESBL E. coli, on meropenem after blood cultures, 30 mL/kg given, lactate ${lact.join(' → ')}, AKI and delirium. Step-down please.` });
    await act({ type: 'disposition', patientId: 'p_brunner', decision: 'admit_stepdown', service: 'Hospital medicine', diagnoses: ['Urosepsis / acute pyelonephritis (ESBL risk)', 'AKI', 'Delirium'] });
  }
  const kLabs = await act({ type: 'ehr_view', patientId: 'p_kellner', section: 'labs' });
  const tsh = labSeries(kLabs.text, 'tsh').pop();
  await order(act, 'p_kellner', 'apixaban');
  await act({ type: 'call', contactId: 'hosp', text: `Second one: Bed 3, Robert Kellner, 71M, new atrial fibrillation with RVR since 15:00, rate control with IV metoprolol, CHA2DS2-VASc 2, apixaban started. ${tsh ? `TSH ${tsh}` : 'TSH pending'} — levothyroxine went from 100 to 150 mcg six weeks ago. Telemetry please.` });
  await act({ type: 'disposition', patientId: 'p_kellner', decision: 'admit_telemetry', service: 'Hospital medicine', diagnoses: ['New-onset atrial fibrillation with RVR', 'Iatrogenic hyperthyroidism'] });
}

async function orientation(act: Act) {
  await act({ type: 'wait', minutes: 3 });
  await act({ type: 'move', to: 'bed_5' });
  await act({ type: 'talk', npcId: 'pt_p_thompson', text: "Hi Mia, I'm one of the doctors. Where did the pain start, and where is it now?" });
  await act({ type: 'talk', npcId: 'pt_p_thompson', text: 'Have you lost your appetite? When was the last time you ate, and your last drink?' });
  await act({ type: 'talk', npcId: 'fam_jake', text: 'Jake, could you give us a few minutes of privacy? I will come and find you.' });
  await act({ type: 'talk', npcId: 'pt_p_thompson', text: 'A few private questions, Mia. What was the first day of your last menstrual period, and was it normal?' });
  await act({ type: 'talk', npcId: 'pt_p_thompson', text: 'Are you sexually active, and do you use any contraception?' });
  for (const m of ['abd_palpate', 'abd_rebound', 'abd_mcburney', 'abd_rovsing', 'abd_psoas']) await act({ type: 'examine', patientId: 'p_thompson', maneuver: m });
  await act({ type: 'talk', npcId: 'pt_p_thompson', text: "This could well be appendicitis. Please don't drink or eat anything for now — nothing by mouth. I'm getting you pain medicine, fluids and a scan, and we check a pregnancy test first, as we do for every woman before a CT." });
  await act({ type: 'move', to: 'station' });
  for (const code of ['hcg_u', 'cbc', 'bmp', 'ua', 'iv_access', 'npo']) await order(act, 'p_thompson', code);
  await order(act, 'p_thompson', 'morphine', { dose: '4 mg' });
  await order(act, 'p_thompson', 'ondansetron');
  await order(act, 'p_thompson', 'lr_bolus', { dose: '1000 mL' });
  await order(act, 'p_thompson', 'ct_abd_iv');
  await order(act, 'p_okafor', 'ibuprofen');
  await ankle(act, true);
  for (let i = 0; i < 6; i++) {
    await act({ type: 'wait', minutes: i ? 15 : 20 });
    if (/IMPRESSION:/.test((await act({ type: 'ehr_view', patientId: 'p_thompson', section: 'imaging' })).text ?? '')) break;
  }
  await act({ type: 'ehr_view', patientId: 'p_thompson', section: 'labs' });
  await order(act, 'p_thompson', 'cefoxitin', { dose: '2 g', frequency: 'once' });
  await act({ type: 'call', contactId: 'surg', text: 'ED resident, Bed 5: Mia Thompson, 23F. Periumbilical pain migrating to the RLQ, anorexia, temp 38.1, RLQ guarding with rebound, Rovsing and psoas positive. CT: acute appendicitis. Cefoxitin given, NPO. Could you see her for appendectomy?' });
  await act({ type: 'disposition', patientId: 'p_thompson', decision: 'or', service: 'General surgery', diagnoses: ['Acute appendicitis with appendicolith'] });
  await act({ type: 'move', to: 'bed_5' });
  await act({ type: 'talk', npcId: 'pt_p_thompson', text: 'Mia, the scan confirms appendicitis. The surgeons will remove your appendix with keyhole surgery tonight. Still nothing to eat or drink until then.' });
  await act({ type: 'wait', minutes: 20 });
}
