/**
 * Escalate to the attending (server/sim/escalation.ts): to the bedside (she walks over, says an
 * opener, is talkable there, stays while the patient is unstable, then goes back) and by phone (her
 * line heads the directory, same persona and context). The debrief lists every escalation.
 */
import { describe, expect, it } from 'vitest';
import { NpcBrain } from '../server/npc/brain';
import type { NpcSpec } from '../server/npc/prompts';
import { catalogText, contactsText, observationText } from '../server/sim/agentText';
import { assess, escalate, escalationSituation } from '../server/sim/escalation';
import { debrief } from '../server/sim/scoring';
import { GameSession, M, type Conversation } from '../server/sim/session';
import { buildView } from '../server/sim/views';
import type { OfflineCtx } from '../server/npc/offline';

/** offline brain that records what each NPC was told (system prompt + [Situation]) */
class SpyBrain extends NpcBrain {
  turns: { spec: NpcSpec; situation: string }[] = [];
  constructor() {
    super(null);
  }
  override reply(spec: NpcSpec, conv: Conversation, situation: string, text: string, offline: OfflineCtx) {
    this.turns.push({ spec, situation });
    return super.reply(spec, conv, situation, text, offline);
  }
}

function night(seed = 7, brain: NpcBrain = new NpcBrain(null)) {
  return new GameSession({ scenarioId: 'night_shift', seed, playerName: 'Test', mode: 'step', brain });
}

const byName = (s: GameSession, last: string) => [...s.patients.values()].find((x) => x.c.patient.lastName === last)!;

describe('escalate to the bedside', () => {
  it('a stable patient: she walks over, opens, is talkable there, then goes back after ~10 min', async () => {
    const s = night();
    s.advance(10 * M);
    const ft = byName(s, 'Okafor');
    await s.act({ type: 'move', to: 'ft_1' });
    const shaw = s.staff.get('att_shaw')!;
    expect(shaw.location).toBe('workroom');

    const r = await s.act({ type: 'escalate', patientId: ft.id, mode: 'bedside', reason: 'Wants to go home, can you check my plan' });
    expect(r.ok).toBe(true);
    expect(r.costMin).toBe(0.5);
    expect(s.pages.at(-1)).toMatchObject({ from: 'Dr. Shaw (attending)', text: 'On my way to Fast Track 1.', patientId: ft.id });
    const esc = s.escalations[0];
    expect(esc).toMatchObject({ mode: 'bedside', pid: ft.id, status: 'en_route', reason: 'Wants to go home, can you check my plan' });
    // she dropped what she was doing and set off through the staff queue: the 3D client walks her there
    expect(shaw.location).toBe('ft_1');
    expect(shaw.current?.kind).toBe('escalate');
    expect(shaw.activity).toBe('Coming to Fast Track 1 — escalation');
    expect(buildView(s, s.brain.status).escalations?.[0]).toMatchObject({ status: 'en_route', bedLabel: 'Fast Track 1', attendingName: 'Dr. Evelyn Shaw' });

    // not talkable while she walks over
    const early = await s.act({ type: 'talk', npcId: 'att_shaw', text: 'Thanks for coming' });
    expect(early.ok).toBe(false);
    expect(early.message).toMatch(/on her way to Fast Track 1/);

    // she arrives about a minute (getting up) plus the walk later and says her opener aloud
    expect(esc.etaT! - esc.t).toBeGreaterThanOrEqual(60);
    expect(esc.etaT! - esc.t).toBeLessThanOrEqual(150);
    await s.act({ type: 'wait', minutes: 3 });
    expect(esc.status).toBe('at_bedside');
    expect(esc.arrivedT! - esc.etaT!).toBeGreaterThanOrEqual(0); // on the sim's next 15-s step
    expect(esc.arrivedT! - esc.etaT!).toBeLessThan(15);
    expect(shaw.bark?.text).toBe("What's going on with Mr. Okafor?");
    expect(shaw.spot).toBe('bedside_l'); // Fast Track: the free side of the stretcher
    expect(buildView(s, s.brain.status).npcs.find((n) => n.id === 'att_shaw')).toMatchObject({ location: 'ft_1', talkable: true });

    // ...and is talkable there; her opener heads the transcript
    const talk = await s.act({ type: 'talk', npcId: 'att_shaw', text: '31M, inversion ankle injury, Ottawa negative. Plan: brace, crutches, home.' });
    expect(talk.ok).toBe(true);
    const conv = s.conversations.get('att_shaw')!;
    expect(conv.lines[0]).toMatchObject({ speaker: 'npc', text: "What's going on with Mr. Okafor?" });
    expect(conv.lines.at(-1)!.speaker).toBe('npc');

    // after ~10 min with a stable patient she goes back to her desk
    await s.act({ type: 'wait', minutes: 11 });
    expect(esc.status).toBe('done');
    expect(shaw).toMatchObject({ location: 'workroom', spot: 'desk-a', posture: 'sit' });
    expect(shaw.bark?.text).toBe('Call me if anything changes with Mr. Okafor.');

    // the debrief lists it: time, patient, vitals then, stable
    const d = debrief(s).escalations!;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ t: esc.t, patientId: ft.id, bedLabel: 'Fast Track 1', name: 'Daniel Okafor', mode: 'bedside', unstable: false, why: [], arrivedAt: esc.arrivedT });
    expect(d[0].vitals.sbp).toBeGreaterThan(90);
    expect(d[0].vitals.hr).toBeGreaterThan(0);
    expect(debrief(s).cases.find((c) => c.patientId === ft.id)!.timeline.some((x) => x.text.startsWith('Escalated to the attending (bedside)'))).toBe(true);
  });

  it('an unstable patient: a direct opener, stabilization-first context, and she stays past 10 min', async () => {
    const brain = new SpyBrain();
    const s = night(7, brain);
    s.advance(80 * M); // untreated urosepsis: SBP in the low 80s, a critical page; board rounds have started
    const g = byName(s, 'Brunner');
    expect(assess(s, g).unstable).toBe(true);
    const shaw = s.staff.get('att_shaw')!;
    expect(shaw.activity).toBe('Board rounds — waiting for you');
    await s.act({ type: 'move', to: 'bed_4' });
    const r = await s.act({ type: 'escalate', patientId: g.id, mode: 'bedside', reason: 'BP falling' });
    expect(r.ok).toBe(true);
    await s.act({ type: 'wait', minutes: 3 });
    const esc = s.escalations[0];
    expect(esc.status).toBe('at_bedside');
    expect(esc.returnTo).toMatchObject({ location: 'station', activity: 'Board rounds — waiting for you' });
    expect(shaw.bark?.text).toMatch(/^I'm here\. .+ — let's stabilize her first\. What's running so far\?$/);

    // her LLM context: the escalation, the vitals and alarms at that moment, and "stabilize first"
    await s.act({ type: 'talk', npcId: 'att_shaw', text: 'She is hypotensive, what should I do first?' });
    const turn = brain.turns.at(-1)!;
    expect(turn.spec.name).toBe('Dr. Evelyn Shaw');
    expect(turn.spec.system).toMatch(/stop teaching Socratically/);
    expect(turn.situation).toMatch(/ESCALATION at \d\d:\d\d: the resident asked you to come to the bedside about Bed 4, Margarethe Brunner/);
    expect(turn.situation).toContain('reason given: "BP falling"');
    expect(turn.situation).toMatch(/At that moment: HR \d+, BP \d+\/\d+ \(MAP \d+\)/);
    expect(turn.situation).toMatch(/UNSTABLE \(.*SBP \d+ < 90/);
    expect(turn.situation).toContain('drop the Socratic teaching');

    // still unstable after 10 min: she stays
    await s.act({ type: 'wait', minutes: 12 });
    expect(esc.status).toBe('at_bedside');
    expect(shaw.location).toBe('bed_4');
    expect(shaw.activity).toBe('Staying at Bed 4 — not stable yet');

    const rec = debrief(s).escalations![0];
    expect(rec.unstable).toBe(true);
    expect(rec.why.some((w) => /^SBP \d+ < 90$/.test(w))).toBe(true);
    expect(rec.vitals.sbp).toBeLessThan(90);
  });

  it('board rounds wait until she is done at the bedside, then she goes to the station', async () => {
    const s = night();
    s.advance(72 * M); // rounds start at 75 min
    const ft = byName(s, 'Okafor');
    await s.act({ type: 'escalate', patientId: ft.id, mode: 'bedside' });
    await s.act({ type: 'wait', minutes: 5 });
    const shaw = s.staff.get('att_shaw')!;
    expect(s.flags.has('rounds_started')).toBe(true);
    expect(shaw.location).toBe('ft_1');
    expect(s.pages.some((pg) => pg.text.endsWith("(Once I'm done at the bedside.)"))).toBe(true);
    await s.act({ type: 'wait', minutes: 12 });
    expect(shaw).toMatchObject({ location: 'station', spot: 'desk-6', posture: 'sit', activity: 'Board rounds — waiting for you' });
  });

  it('a second bedside escalation takes her on to the new patient', async () => {
    const s = night();
    s.advance(20 * M);
    await s.act({ type: 'escalate', patientId: byName(s, 'Okafor').id, mode: 'bedside' });
    const again = await s.act({ type: 'escalate', patientId: byName(s, 'Okafor').id, mode: 'bedside' });
    expect(again.message).toMatch(/already on her way/);
    expect(s.escalations).toHaveLength(1);
    await s.act({ type: 'escalate', patientId: byName(s, 'Brunner').id, mode: 'bedside' });
    expect(s.escalations.map((e) => e.status)).toEqual(['done', 'en_route']);
    await s.act({ type: 'wait', minutes: 3 });
    expect(s.staff.get('att_shaw')!.location).toBe('bed_4');
    expect(s.escalations[1].status).toBe('at_bedside');
  });

  it('the patient leaving first sends her back (before she sets off, or on her way)', () => {
    for (const leaveWhen of ['queued', 'walking'] as const) {
      const s = night();
      s.advance(10 * M);
      const ft = byName(s, 'Okafor');
      expect(escalate(s, { type: 'escalate', patientId: ft.id, mode: 'bedside' }).ok).toBe(true);
      if (leaveWhen === 'walking') s.advance(30); // her task has started: she is walking over
      s.depart(ft); // cancels queued tasks for the patient
      s.advance(10 * M);
      const shaw = s.staff.get('att_shaw')!;
      expect(s.escalations[0].status, leaveWhen).toBe('done');
      expect(s.escalations[0].arrivedT, leaveWhen).toBeUndefined();
      expect(shaw.location, leaveWhen).toBe('workroom');
      expect(buildView(s, s.brain.status).escalations?.some((e) => e.status === 'en_route'), leaveWhen).toBe(false);
    }
  });

  it('refuses unknown patients and modes', async () => {
    const s = night();
    s.advance(10 * M);
    expect((await s.act({ type: 'escalate', patientId: 'p_nobody', mode: 'bedside' })).ok).toBe(false);
    expect((await s.act({ type: 'escalate', patientId: byName(s, 'Okafor').id, mode: 'shout' as 'call' })).ok).toBe(false);
    expect(s.escalations).toHaveLength(0);
  });
});

describe('escalate by phone', () => {
  it('opens her line at the top of the directory; she picks up with the same character and context', async () => {
    const brain = new SpyBrain();
    const s = night(7, brain);
    s.advance(20 * M);
    const g = byName(s, 'Brunner');
    await s.act({ type: 'move', to: 'bed_4' });
    expect(buildView(s, s.brain.status).contacts.some((c) => c.id === 'attending')).toBe(false);

    const r = await s.act({ type: 'escalate', patientId: g.id, mode: 'call', reason: 'Septic? Want to run my plan by you' });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ contactId: 'attending' });
    const view = buildView(s, s.brain.status);
    expect(view.contacts[0]).toMatchObject({ id: 'attending', name: 'ED attending — Dr. Shaw', kind: 'internal', patientId: g.id });
    expect(view.escalations?.[0]).toMatchObject({ mode: 'call', status: 'on_call', contactId: 'attending' });
    const conv = s.conversations.get('phone:attending')!;
    expect(conv.lines[0].text).toBe('Calling ED attending — Dr. Shaw (x4000)…');
    expect(conv.lines.at(-1)!.text).toMatch(/^Shaw\. What's going on with Mrs\. Brunner/);

    // her line rings your own phone: it works from the bedside
    const c = await s.act({ type: 'call', contactId: 'attending', text: '81F, confused, febrile, SBP in the 90s. Cultures, lactate, fluids, meropenem for prior ESBL?' });
    expect(c.ok).toBe(true);
    expect(conv.lines.at(-1)!.speaker).toBe('npc');
    const turn = brain.turns.at(-1)!;
    expect(turn.spec.name).toBe('Dr. Evelyn Shaw'); // her staff persona, not a generic phone contact
    expect(turn.spec.system).toContain('Attending brief');
    expect(turn.situation).toMatch(/ESCALATION at \d\d:\d\d: the resident called you on the phone about Bed 4/);
    expect(turn.situation).toContain('reason given: "Septic? Want to run my plan by you"');
    expect(turn.situation).toContain('You are on the PHONE with the resident');
    // she stays where she is
    expect(s.staff.get('att_shaw')!.location).toBe('workroom');

    // hang up and call back from the directory: she picks up again
    await s.act({ type: 'hangup', contactId: 'attending' });
    const redial = await s.act({ type: 'call', contactId: 'attending', text: '__dial__' });
    expect(redial.ok).toBe(true);
    expect(conv.lines.at(-1)!.text).toMatch(/^Shaw\./);

    const d = debrief(s).escalations!;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ mode: 'call', patientId: g.id, bedLabel: 'Bed 4', reason: 'Septic? Want to run my plan by you' });
    expect(d[0].arrivedAt).toBeUndefined();
  });

  it('is closed until a patient is escalated by phone', async () => {
    const s = night();
    s.advance(10 * M);
    await s.act({ type: 'move', to: 'station' });
    const r = await s.act({ type: 'call', contactId: 'attending', text: 'Hello?' });
    expect(r.ok).toBe(false);
  });
});

describe('escalation for AI agents', () => {
  it('the observation, contacts and catalog document it', async () => {
    const s = night();
    s.advance(10 * M);
    expect(catalogText()).toContain('## escalate to the attending');
    const ft = byName(s, 'Okafor');
    await s.act({ type: 'escalate', patientId: ft.id, mode: 'bedside' });
    expect(observationText(s)).toMatch(/Escalations to the attending:\n- Dr\. Evelyn Shaw is on her way to Fast Track 1 .*npcId: att_shaw/);
    await s.act({ type: 'wait', minutes: 3 });
    expect(observationText(s)).toContain('Dr. Evelyn Shaw is at Fast Track 1');
    // she is standing right there: no phone call about the same patient
    const same = await s.act({ type: 'escalate', patientId: ft.id, mode: 'call' });
    expect(same.message).toMatch(/already at Fast Track 1/);
    await s.act({ type: 'escalate', patientId: byName(s, 'Brunner').id, mode: 'call' });
    expect(observationText(s)).toContain('Her phone line is open: call contactId "attending"');
    expect(contactsText(s).split('\n')[0]).toMatch(/^- attending: ED attending — Dr\. Shaw/);
    // the attending's context names both, newest first
    expect(escalationSituation(s, 'att_shaw')).toMatch(/called you on the phone about Bed 4.*asked you to come to the bedside about Fast Track 1/s);
  });

  it('is deterministic: same seed and actions, same escalation record', async () => {
    const run = async () => {
      const s = night(11);
      s.advance(45 * M);
      await s.act({ type: 'escalate', patientId: byName(s, 'Brunner').id, mode: 'bedside', reason: 'hypotension' });
      await s.act({ type: 'wait', minutes: 15 });
      return JSON.stringify({ e: debrief(s).escalations, at: s.staff.get('att_shaw')!.location });
    };
    expect(await run()).toBe(await run());
  });
});
