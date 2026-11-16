/**
 * Observe mode: the AI resident as an NPC (spot/posture/activity from its last action),
 * the think-aloud narration endpoint, watch pacing, and the agents' feed formatting.
 */
import { describe, expect, it } from 'vitest';
import { describeToolCall, npcLabel, parseDirectory, summarizeToolResult } from '../agents/narration';
import { NpcBrain } from '../server/npc/brain';
import { readRunFile, validateObserve } from '../server/observe';
import {
  AI_DOCTOR_ID,
  aiDoctorNpc,
  attachAiDoctor,
  cleanNarrationText,
  currentPose,
  describeAction,
  feedFromEvent,
  gapMs,
  NARRATION_BURST,
  NARRATION_MAX_CHARS,
  NARRATION_RING,
  narrationEntries,
  narrationRequest,
  orderShort,
  paced,
  recordAction,
  setPace,
  snippet,
} from '../server/sim/aiDoctor';
import { GameSession, M } from '../server/sim/session';
import { buildView } from '../server/sim/views';
import type { Action, GameEvent } from '../shared/types';

const brain = new NpcBrain(null); // offline, deterministic

function shift(agent = true, seed = 7) {
  const s = new GameSession({ scenarioId: 'night_shift', seed, playerName: agent ? 'Claude sonnet' : 'Human', mode: 'step', brain });
  if (agent) attachAiDoctor(s, { label: 'Claude Sonnet', model: 'sonnet' });
  return s;
}

/** run an action the way server/index.ts does (s.act, then the AI doctor's bookkeeping) */
async function act(s: GameSession, a: Action) {
  const r = await s.act(a);
  recordAction(s, a, r);
  return r;
}

const doctor = (s: GameSession) => buildView(s, s.brain.status).npcs.find((n) => n.id === AI_DOCTOR_ID);

describe('who drives the session', () => {
  it('human sessions have no ai_doctor and say so in the view', () => {
    const s = shift(false);
    const v = buildView(s, s.brain.status);
    expect(v.driver).toEqual({ kind: 'human' });
    expect(v.npcs.some((n) => n.id === AI_DOCTOR_ID)).toBe(false);
    expect(aiDoctorNpc(s)).toBeNull();
  });

  it('agent sessions show the AI resident at the player location', () => {
    const s = shift();
    const v = buildView(s, s.brain.status);
    expect(v.driver).toMatchObject({ kind: 'agent', label: 'Claude Sonnet', model: 'sonnet' });
    const d = v.npcs.find((n) => n.id === AI_DOCTOR_ID)!;
    expect(d).toMatchObject({ role: 'resident', title: 'AI resident', location: 'station', spot: 'desk-3', posture: 'sit', visible: true, talkable: true });
    expect(d.appearance.outfit).toBe('coat');
  });
});

describe('spot and activity selection', () => {
  it('follows the agent: bedside for talk/examine, a desk for orders/EHR, the phone for calls', async () => {
    const s = shift();
    await act(s, { type: 'wait', minutes: 6 }); // Brunner arrives in Bed 4
    expect(doctor(s)).toMatchObject({ location: 'station', spot: 'desk-3', posture: 'sit', activity: 'Waiting 6 min' });

    await act(s, { type: 'move', to: 'bed_4' });
    expect(doctor(s)).toMatchObject({ location: 'bed_4', spot: 'foot', posture: 'stand', activity: 'Walking to Bed 4' });

    await act(s, { type: 'talk', npcId: 'pt_p_brunner', text: 'Hello Mrs. Brunner, does it burn when you pass urine?' });
    expect(doctor(s)).toMatchObject({ location: 'bed_4', spot: 'bedside', posture: 'stand', activity: 'Talking with Margarethe Brunner (Bed 4)' });

    await act(s, { type: 'examine', patientId: 'p_brunner', maneuver: 'back_cva' });
    expect(doctor(s)).toMatchObject({ spot: 'bedside', activity: 'Examining Bed 4 — back: Costovertebral angle tenderness' });

    // orders need a workstation: at the bedside they fail and the doctor stays put
    await act(s, { type: 'order', patientId: 'p_brunner', code: 'lactate' });
    expect(doctor(s)).toMatchObject({ location: 'bed_4', spot: 'bedside', activity: 'Ordering lactic acid (Bed 4) — failed' });

    await act(s, { type: 'move', to: 'station' });
    expect(doctor(s)).toMatchObject({ location: 'station', spot: 'board', posture: 'stand' });
    await act(s, { type: 'order', patientId: 'p_brunner', code: 'lactate' });
    await act(s, { type: 'order', patientId: 'p_brunner', code: 'bcx' });
    expect(doctor(s)).toMatchObject({ location: 'station', spot: 'desk-3', posture: 'sit', activity: 'Ordering lactic acid, blood cultures x2 (Bed 4)' });

    await act(s, { type: 'ehr_view', patientId: 'p_brunner', section: 'labs', query: 'lact' });
    expect(doctor(s)).toMatchObject({ spot: 'desk-3', posture: 'sit', activity: 'Reading Bed 4 chart — labs “lact”' });

    await act(s, { type: 'call', contactId: 'cards', text: 'Quick question about Bed 4.' });
    expect(doctor(s)).toMatchObject({ location: 'station', spot: 'phone', posture: 'stand', activity: 'Calling cardiology' });

    await act(s, { type: 'move', to: 'workroom' });
    await act(s, { type: 'set_diagnoses', patientId: 'p_brunner', diagnoses: ['Urosepsis'] });
    expect(doctor(s)).toMatchObject({ location: 'workroom', spot: 'desk-b', posture: 'sit', activity: 'Working diagnosis Bed 4: Urosepsis' });
    await act(s, { type: 'call', contactId: 'gp_whitfield', text: 'Margarethe Brunner, DOB 02/11/1945 — prior cultures?' });
    expect(doctor(s)).toMatchObject({ location: 'workroom', spot: 'desk-c', posture: 'sit', activity: 'Calling Maple Street Family Medicine' });
  });

  it('keeps long order bursts short and labels the rest of the action space', () => {
    const s = shift();
    s.advance(14 * M);
    expect(orderShort('bcx')).toBe('blood cultures x2');
    expect(orderShort('cbc')).toBe('CBC with differential');
    expect(orderShort('hcg_u')).toBe('pregnancy test');
    expect(orderShort('lr_bolus', '30 mL/kg')).toBe("lactated Ringer's bolus 30 mL/kg");
    const burst = ['lactic acid', 'blood cultures x2', 'CBC with differential', 'comprehensive metabolic panel', 'urinalysis with microscopy'];
    const a = describeAction(s, { type: 'order', patientId: 'p_brunner', code: 'ua' }, burst);
    expect(a.length).toBeLessThanOrEqual(58);
    expect(a).toMatch(/^Ordering lactic acid, .* \+\d \(Bed 4\)$/);
    expect(describeAction(s, { type: 'disposition', patientId: 'p_keller', decision: 'cath_lab', diagnoses: [] })).toBe('Disposition Bed 2: To cardiac cath lab');
    expect(describeAction(s, { type: 'ehr_view', patientId: 'p_keller', section: 'board' })).toBe('Reading the tracking board');
    expect(describeAction(s, { type: 'call', contactId: 'hosp', text: 'x' })).toBe('Calling the hospitalist');
    expect(describeAction(s, { type: 'talk', npcId: 'rn_tom', text: 'x' })).toMatch(/^Talking with Tom .*\(RN\)$/);
  });

  it('leaves the doctor at the bedside for bedside documentation and inspects belongings at the bay', async () => {
    const s = shift();
    await act(s, { type: 'wait', minutes: 6 });
    await act(s, { type: 'move', to: 'bed_4' });
    await act(s, { type: 'talk', npcId: 'pt_p_brunner', text: 'Hello' });
    await act(s, { type: 'disposition', patientId: 'p_brunner', decision: 'admit_stepdown', diagnoses: ['Sepsis'] });
    expect(currentPose(s)).toMatchObject({ location: 'bed_4', spot: 'bedside' });
    await act(s, { type: 'inspect', itemId: 'brunner_handbag' });
    expect(doctor(s)).toMatchObject({ location: 'bed_4', spot: 'foot', activity: "Looking at Margarethe Brunner's handbag" });
  });
});

describe('narration endpoint', () => {
  it('rejects narration for human sessions', () => {
    expect(narrationRequest(shift(false), { text: 'hi' }).status).toBe(409);
  });

  it('validates the body', () => {
    const s = shift();
    expect(narrationRequest(s, null).status).toBe(400);
    expect(narrationRequest(s, [1, 2]).status).toBe(400);
    expect(narrationRequest(s, { kind: 'thought' }).status).toBe(400);
    expect(narrationRequest(s, { text: '   \n\t ' }).status).toBe(400);
    expect(narrationRequest(s, { text: 'x', kind: 'system' }).status).toBe(400); // server-only kinds
    expect(narrationRequest(s, { text: 'x', kind: 'event' }).status).toBe(400);
    expect(narrationRequest(s, { text: 'x', patientId: 4 }).status).toBe(400);
  });

  it('stores, caps, cleans and emits lines; thoughts become the speech bubble', () => {
    const s = shift();
    s.advance(6 * M);
    const events: GameEvent[] = [];
    s.on((e) => events.push(e));
    const before = narrationEntries(s).length;
    const r = narrationRequest(s, { text: 'Lactate 4.1 + hypotension → septic shock; 30 mL/kg fluids now.\u0007', patientId: 'p_brunner' });
    expect(r.status).toBe(201);
    const e = narrationEntries(s).at(-1)!;
    expect(e).toMatchObject({ id: r.body.id, kind: 'thought', patientId: 'p_brunner', text: 'Lactate 4.1 + hypotension → septic shock; 30 mL/kg fluids now.' });
    expect(narrationEntries(s).length).toBe(before + 1);
    expect(events).toContainEqual({ kind: 'narration', entry: e });
    const bark1 = doctor(s)!.bark!;
    expect(bark1.text).toBe('Lactate 4.1 + hypotension → septic shock; 30 mL/kg fluids now.');
    // a second line at the same game time still pops a new bubble (bark.t must change)
    narrationRequest(s, { text: 'Cultures before antibiotics.' });
    expect(doctor(s)!.bark!.t).not.toBe(bark1.t);
    // actions and results stay in the feed only
    narrationRequest(s, { text: '→ order Lactic acid, venous', kind: 'action', patientId: 'p_nobody' });
    expect(narrationEntries(s).at(-1)!.patientId).toBeUndefined();
    expect(doctor(s)!.bark!.text).toBe('Cultures before antibiotics.');
    // size cap
    narrationRequest(s, { text: 'a'.repeat(5000), kind: 'result' });
    const long = narrationEntries(s).at(-1)!.text;
    expect(long.length).toBe(NARRATION_MAX_CHARS);
    expect(long.endsWith('…')).toBe(true);
  });

  it('rate-limits per session and refills over time', () => {
    const s = shift();
    const t0 = Date.now();
    const codes = Array.from({ length: NARRATION_BURST + 5 }, () => narrationRequest(s, { text: 'tick' }, t0).status);
    expect(codes.filter((c) => c === 201).length).toBe(NARRATION_BURST);
    const limited = narrationRequest(s, { text: 'tick' }, t0);
    expect(limited.status).toBe(429);
    expect(limited.body.retryAfterMs).toBeGreaterThan(0);
    expect(narrationRequest(s, { text: 'later' }, t0 + 1000).status).toBe(201);
  });

  it('keeps a bounded ring buffer and supports ?since=', () => {
    const s = shift();
    let now = Date.now();
    for (let i = 0; i < NARRATION_RING + 50; i++) narrationRequest(s, { text: `line ${i}` }, (now += 1000));
    const all = narrationEntries(s);
    expect(all.length).toBe(NARRATION_RING);
    expect(all.at(-1)!.text).toBe(`line ${NARRATION_RING + 49}`);
    expect(narrationEntries(s, all.at(-3)!.id).map((e) => e.text)).toEqual([`line ${NARRATION_RING + 48}`, `line ${NARRATION_RING + 49}`]);
  });

  it('turns notable events into feed lines (and the intro pages are in the transcript)', () => {
    const s = shift();
    expect(narrationEntries(s).some((e) => e.kind === 'event' && /Dr\. Evelyn Shaw/.test(e.text))).toBe(true);
    feedFromEvent(s, { kind: 'result', patientId: 'p_brunner', text: 'CRITICAL Bed 4: lactate 4.4', critical: true });
    expect(narrationEntries(s).at(-1)).toMatchObject({ kind: 'event', tone: 'bad', patientId: 'p_brunner', text: '🧪 CRITICAL Bed 4: lactate 4.4' });
    s.end('test');
    const n = narrationEntries(s).length;
    feedFromEvent(s, { kind: 'toast', text: 'preparing your debrief…' });
    expect(narrationEntries(s).length).toBe(n);
  });

  it('cleans text and makes short bubbles', () => {
    expect(cleanNarrationText('a\r\nb\n\n\n\nc‮')).toBe('a\nb\n\nc');
    expect(snippet('**Bed 4** is septic. The next sentence is long enough to be cut off somewhere along the way, because speech bubbles are short and the doctor talks a lot.')).toBe('Bed 4 is septic.');
    expect(snippet('x'.repeat(300)).length).toBe(140);
  });
});

describe('watch pacing', () => {
  it('is off by default and scales with the walk', () => {
    const s = shift();
    const desk = { location: 'station', spot: 'desk-3', posture: 'sit' as const, activity: '' };
    const bay = { location: 'bed_4', spot: 'foot', posture: 'stand' as const, activity: '' };
    expect(gapMs(s, 0, desk, bay, { type: 'move', to: 'bed_4' })).toBe(0);
    expect(gapMs(s, 1500, desk, desk, { type: 'order', patientId: 'p_brunner', code: 'cbc' })).toBe(900);
    expect(gapMs(s, 1500, desk, desk, { type: 'ehr_view', patientId: 'p_brunner', section: 'labs' })).toBe(1500);
    const walk = gapMs(s, 1500, desk, bay, { type: 'move', to: 'bed_4' });
    expect(walk).toBe(6000); // ~11 s walk, capped at 4× the pace
    expect(setPace(s, 99)).toBe(10);
    expect(setPace(shift(false), 1)).toBeNull();
  });

  it('runs paced actions one at a time with the gap in between', async () => {
    const s = shift();
    setPace(s, 0.12);
    const ran: number[] = [];
    const t0 = Date.now();
    const step = (i: number) =>
      paced(s, async () => {
        ran.push(Date.now() - t0);
        const r = await s.act({ type: 'ehr_view', patientId: 'p_x', section: 'board' });
        recordAction(s, { type: 'ehr_view', patientId: 'p_x', section: 'board' }, r);
        return i;
      });
    expect(await Promise.all([step(1), step(2), step(3)])).toEqual([1, 2, 3]);
    expect(ran[1] - ran[0]).toBeGreaterThanOrEqual(100);
    expect(ran[2] - ran[1]).toBeGreaterThanOrEqual(100);
    // humans are never paced
    const h = shift(false);
    const t1 = Date.now();
    await Promise.all([1, 2, 3].map(() => paced(h, () => h.act({ type: 'wait', minutes: 1 }))));
    expect(Date.now() - t1).toBeLessThan(100);
  });
});

describe('observe launcher validation', () => {
  const maps = ['night_shift', 'orientation'];
  it('requires a known agent, model and map', () => {
    expect(validateObserve({ agent: 'gpt' }, maps)).toMatchObject({ ok: false });
    expect(validateObserve({ agent: 'claude', model: 'gpt-5' }, maps)).toMatchObject({ ok: false });
    expect(validateObserve({ agent: 'demo', mapId: 'mars' }, maps)).toMatchObject({ ok: false });
    expect(validateObserve({ agent: 'demo', pace: 30 }, maps)).toMatchObject({ ok: false });
    expect(validateObserve({ agent: 'demo', seed: -1 }, maps)).toMatchObject({ ok: false });
  });
  it('defaults: Sonnet for Claude, the reference seed for the demo, 1.5 s pace', () => {
    expect(validateObserve({ agent: 'claude' }, maps)).toMatchObject({ ok: true, model: 'sonnet', mapId: 'night_shift', paceSec: 1.5 });
    expect(validateObserve({ agent: 'demo', mapId: 'orientation' }, maps)).toMatchObject({ ok: true, model: undefined, seed: 2024 });
    expect(validateObserve({ agent: 'claude', model: 'haiku', seed: '42', pace: 0 }, maps)).toMatchObject({ ok: true, model: 'haiku', seed: 42, paceSec: 0 });
  });
  it('serves run logs by session id only', () => {
    expect(readRunFile('/tmp', '../etc/passwd', 'run').status).toBe(400);
    expect(readRunFile('/tmp', 's_definitely_missing', 'run').status).toBe(404);
  });
});

describe('agent feed formatting (claude-doctor)', () => {
  const dir = parseDirectory('- cards: Dr. Sara Lindqvist — Cardiology fellow on call (cath lab activation) (x4410)\n- gp_whitfield: Maple Street Family Medicine — After-hours line (555-0199) [re: p_brunner]');
  it('parses the phone directory and names NPCs', () => {
    expect(dir.get('cards')).toBe('Dr. Sara Lindqvist (Cardiology fellow on call)');
    expect(dir.get('gp_whitfield')).toBe('Maple Street Family Medicine (After-hours line)');
    expect(npcLabel('pt_p_brunner')).toBe('Brunner');
    expect(npcLabel('rn_tom')).toBe('Tom (RN)');
    expect(npcLabel('att_shaw')).toBe('Dr. Shaw');
  });
  it('writes one compact line per tool call', () => {
    expect(describeToolCall('mcp__agentclinic__order', { patient_id: 'p_brunner', code: 'lr_bolus', dose: '30 mL/kg', priority: 'STAT' })).toEqual({ text: "→ order Lactated Ringer's bolus 30 mL/kg (STAT)", patientId: 'p_brunner' });
    expect(describeToolCall('mcp__agentclinic__move', { to: 'bed_4' })!.text).toBe('→ walk to Bed 4');
    expect(describeToolCall('mcp__agentclinic__call', { contact_id: 'cards', text: 'STEMI in Bed 2, activate the lab.' }, dir)!.text).toBe('→ call Dr. Sara Lindqvist (Cardiology fellow on call): “STEMI in Bed 2, activate the lab.”');
    expect(describeToolCall('mcp__agentclinic__talk', { npc_id: 'pt_p_keller', text: 'Any sildenafil?' })).toEqual({ text: '→ to Keller: “Any sildenafil?”', patientId: 'p_keller' });
    expect(describeToolCall('mcp__agentclinic__examine', { patient_id: 'p_thompson', maneuver: 'abd_mcburney' })!.text).toBe("→ examine: abdomen · McBurney's point");
    expect(describeToolCall('mcp__agentclinic__disposition', { patient_id: 'p_keller', decision: 'cath_lab', diagnoses: ['STEMI'] })!.text).toBe('→ disposition: To cardiac cath lab');
  });
  it('keeps the key part of each result', () => {
    const labs = 'Brunner, Margarethe · 81F\nResults matching "lact":\nChemistry | Lactate (lactate) [mmol/L; ref 0.5–2.2]: 4.1 H @22:31 → 2.3 H @23:40\nPending: Lactic acid, venous (Collected)';
    expect(summarizeToolResult('read_chart', { patient_id: 'p_brunner', section: 'labs' }, labs)).toEqual({ text: '↳ Lactate 4.1 H → 2.3 H', patientId: 'p_brunner' });
    expect(summarizeToolResult('talk', { npc_id: 'pt_p_brunner' }, 'OK: Es brennt... it burns.\n\nTIME 22:10 …')).toEqual({ text: '↳ “Es brennt... it burns.”', patientId: 'p_brunner' });
    expect(summarizeToolResult('order', { patient_id: 'p_brunner' }, 'FAILED: Orders are placed at a workstation.\n\nTIME …')).toMatchObject({ text: '✗ Orders are placed at a workstation.', tone: 'warn' });
    expect(summarizeToolResult('order', { patient_id: 'p_brunner' }, 'OK: Ordered: Lactic acid, venous (STAT)\n\nTIME …')).toBeNull();
    expect(summarizeToolResult('end_shift', {}, 'DEBRIEF Night Shift: 300/437 (69%, grade C); resources $900\n\n## …')!.text).toBe('↳ DEBRIEF Night Shift: 300/437 (69%, grade C); resources $900');
  });
});
