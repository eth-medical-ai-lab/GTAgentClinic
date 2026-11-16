import { describe, expect, it } from 'vitest';
import { CASES } from '../content/scenarios';
import type { ScenarioDef } from '../content/types';
import { NpcBrain } from '../server/npc/brain';
import { debrief } from '../server/sim/scoring';
import { GameSession, M } from '../server/sim/session';
import type { Action } from '../shared/types';
import { mapSummaries, practiceId, resolveScenario } from '../server/sim/shiftRoster';
import { ShiftJournal } from '../server/sim/shiftJournal';
import { buildChart, buildView } from '../server/sim/views';

const brain = new NpcBrain(null);
const opts = { brain, mode: 'step' as const, playerName: 'Resident', seed: 314 };
const run = (scenarioId: string, scenario?: ScenarioDef) => new GameSession({ ...opts, scenarioId, scenario });

describe('composed shifts', () => {
  it('starts every practice map at a staffed bedside using its presentation as the public title', () => {
    const options = mapSummaries.filter(m => m.kind === 'practice');
    expect(options).toHaveLength(Object.keys(CASES).length);
    for (const c of Object.values(CASES)) {
      const id = practiceId(c.id);
      const m = options.find(m => m.id === id)!;
      expect(m.title).toBe(c.presentation.chiefComplaint);
      expect(m.specialty).toBe(c.specialty);
      expect(m.learningGoals).toEqual([]);
      const s = run(id);
      const [p] = s.presentPatients();
      expect(s.patients.size).toBe(1);
      expect(p.c).toBe(c);
      expect(s.staff.get(p.nurseId)?.def.assigned).toContain(p.bed);
      expect(buildView(s, brain.status).npcs.some(n => n.visible && n.role === 'patient' && n.patientId === p.id)).toBe(true);
    }
  });

  it('draws distinct cases, rooms and times reproducibly and supports a full shuffled catalog', () => {
    const a = resolveScenario('mixed_shift', 72)!;
    expect(resolveScenario('mixed_shift', 72)!.patients).toEqual(a.patients);
    expect(resolveScenario('mixed_shift', 73)!.patients).not.toEqual(a.patients);
    expect(new Set(a.patients.map(p => p.caseId)).size).toBe(Math.min(12, Object.keys(CASES).length));
    expect(a.patients.filter(p => p.arriveAtMin === 0)).toHaveLength(2);
    expect(a.bedPool).toHaveLength(6);
    expect(resolveScenario('mixed_roster', 72)!.patients.map(p => p.caseId).sort()).toEqual(Object.keys(CASES).sort());
    expect(resolveScenario('__proto__', 72)).toBeUndefined();
  });

  it('keeps a bed reserved during imaging, rooms the next encounter when free, and preserves separate charts', () => {
    const scenario = resolveScenario('mixed_shift', opts.seed)!;
    const room = scenario.bedPool![0];
    scenario.bedPool = [room];
    scenario.patients = ['stemi_inferior', 'afib_rvr'].map((caseId, i) => ({ caseId, arriveAtMin: i, ...room }));
    const s = run(scenario.id, scenario);
    const [first] = s.presentPatients();
    first.location = 'ct';
    s.advance(2 * M);
    const before = buildView(s, brain.status);
    expect(before.board).toHaveLength(1);
    expect(Object.keys(before.examFindings)).toEqual([first.id]);
    expect(s.patientByBedOrName('Kellner')).toBeUndefined();
    s.depart(first);
    const [next] = s.presentPatients();
    expect(next.bed).toBe(first.bed);
    expect(next.arrivalT).toBe(s.t);
    expect(next.c.id).toBe('afib_rvr');
    expect(s.patientByBedOrName(first.bed)).toBe(next);
    expect(s.patients.get(first.id)).toBe(first);
    const after = buildView(s, brain.status);
    expect(after.board).toHaveLength(2);
    expect(after.npcs.filter(n => n.role === 'patient').map(n => n.patientId)).toEqual([next.id]);
    s.depart(next);
    expect(s.ended).toBe(true);
    expect(debrief(s).cases.map(c => c.caseId)).toEqual(['stemi_inferior', 'afib_rvr']);
  });

  it('restores the drawn lineup and its pending arrivals from a save', async () => {
    const original = run('mixed_shift');
    const j = new ShiftJournal(original, 'owner');
    await j.act({ type: 'wait', minutes: 25 });
    const h = j.history;
    expect(h.roster).toEqual(original.scenario.patients);
    const restored = new GameSession({ ...opts, scenarioId: h.mapId, roster: h.roster, settings: h.settings, seed: h.seed });
    const replay = new ShiftJournal(restored, 'owner');
    await replay.restore(h);
    expect(replay.digest()).toBe(j.digest());
  });

  it('opens every ED bed and three hallway stretchers, and adds unique patients immediately while paused', async () => {
    const s = run('mixed_roster'), original = s.presentPatients();
    expect(original).toHaveLength(14);
    expect(original.map(p => p.bed).sort()).toEqual(['bed_1','bed_2','bed_3','bed_4','bed_5','bed_6',
      'resus','resus_1','resus_2','ft_1','ft_2','hall_1','hall_2','hall_3'].sort());
    for (const p of original) expect(s.staff.get(p.nurseId)?.queue.some(q => q.pid === p.id)).toBe(true);
    expect(buildView(s, brain.status).npcs.filter(n => n.location.startsWith('hall_') && n.role === 'patient').every(n => n.posture === 'lie')).toBe(true);
    const journal = new ShiftJournal(s, 'test');
    for (let i = 0; i < 3; i++) expect((await journal.act({ type: 'add_roster_patient' })).ok).toBe(true);
    expect(s.t).toBe(0);
    expect((await journal.act({ type: 'add_roster_patient' })).ok).toBe(false);
    expect(s.rosterCapacity()).toMatchObject({ occupied: 17, available: 0 });
    expect(new Set(s.presentPatients().map(p => p.c.id)).size).toBe(17);
    s.advance(45 * M);
    const waiting = [...s.holding.values()];
    expect(waiting.map(p => p.entrance).sort()).toEqual(['ems', 'public']);
    expect(waiting.every(p => p.walker.arrival <= s.t)).toBe(true);
    expect(s.incoming.size).toBe(0);
    const first = waiting[0], oldBed = original[0].bed;
    s.depart(original[0]);
    expect(s.incoming.get(first.patient.id)?.patient.bed).toBe(oldBed);
    s.advance(Math.ceil(s.incoming.get(first.patient.id)!.walker.arrival - s.t) + 1);
    expect(s.patients.get(first.patient.id)?.bed).toBe(oldBed);
    expect((await run('mixed_shift').act({ type: 'add_roster_patient' })).ok).toBe(false);
  });

  it('opens with talkable family, working overflow nurses and a visitor who goes to the restroom and returns', async () => {
    const s = run('mixed_roster'), first = buildView(s, brain.status);
    const relatives = first.npcs.filter(n => n.role === 'family' && n.talkable);
    expect(relatives.length).toBeGreaterThanOrEqual(2);
    const relative = relatives[0];
    await s.act({ type: 'move', to: relative.location });
    expect((await s.act({ type: 'talk', npcId: relative.id, text: 'What happened today?' })).ok).toBe(true);
    for (const id of ['rn_resus','rn_hall','rn_fast']) {
      const nurse = s.staff.get(id)!;
      expect(nurse.current?.pid || nurse.queue[0]?.pid).toBeTruthy();
    }
    expect(first.npcs.filter(n => n.ambient?.crowd).length).toBeGreaterThanOrEqual(8);
    const visits = s.ambient.plan!.people.get('vis_3')!.segs;
    const stop = visits.find(v => v.room === 'restrooms')!;
    s.advance(stop.t0 - s.t + 1);
    expect(buildView(s, brain.status).npcs.find(n => n.id === 'vis_3')?.location).toBe('restrooms');
    const back = visits.find(v => v.t0 > stop.t1 && v.room === 'waiting' && v.posture === 'sit')!;
    s.advance(back.t0 - s.t + 1);
    expect(buildView(s, brain.status).npcs.find(n => n.id === 'vis_3')).toMatchObject({ location: 'waiting', posture: 'sit' });
  });

  it('replays a manually advanced roster and preserves an older six-bay Full Roster save', async () => {
    const s = run('mixed_roster');
    const log = new ShiftJournal(s, 'owner');
    await log.act({ type: 'add_roster_patient' });
    await log.act({ type: 'wait', minutes: 16 });
    await log.act({ type: 'add_roster_patient' });
    const restored = new GameSession({ ...opts, scenarioId: s.scenario.id, roster: log.history.roster });
    const replay = new ShiftJournal(restored, 'owner');
    await replay.restore(log.history);
    expect(replay.digest()).toBe(log.digest());
    const legacy = resolveScenario('mixed_shift', 314)!.patients;
    const old = new GameSession({ ...opts, scenarioId: 'mixed_roster', roster: legacy });
    expect(old.presentPatients()).toHaveLength(2);
    expect(old.layout.id).toBe('ed');
  });

  it('clears a full roster through discharge and accepted handoffs, reusing rooms and hallway stretchers without losing a chart', async () => {
    const s = new GameSession({ ...opts, scenarioId: 'mixed_roster', seed: 6131, mode: 'realtime' });
    const beds = s.scenario.bedPool!.length;
    const mrns = new Set<string>();
    const count = Object.keys(CASES).length;
    const act = async (action: Action) => {
      const result = await s.act(action);
      expect(result.ok, result.message).toBe(true);
    };
    // There is no real-time timer in a standalone session: only wait advances the queues.
    await act({ type: 'wait', minutes: 80 });
    expect(s.presentPatients()).toHaveLength(beds);
    while (!s.ended) {
      const roomed = s.presentPatients();
      const occupied = [...roomed.map(p => p.bed), ...Array.from(s.incoming.values(), i => i.patient.bed)];
      expect(new Set(occupied).size).toBe(occupied.length);
      expect(occupied.length).toBeLessThanOrEqual(beds);
      for (const p of roomed.filter(p => !p.dispo)) {
        const mrn = buildChart(s, p).mrn;
        expect(mrns.has(mrn)).toBe(false);
        mrns.add(mrn);
        const patientId = p.id, dx = p.c.truth.diagnosis;
        const services = p.c.consults.filter(c => c.onAccept.departAfterMin != null);
        const consult = services.find(c => !c.guard) ?? services[0];
        if (consult) {
          await act({ type: 'examine', patientId, maneuver: Object.keys(p.c.exam)[0] });
          if (p.c.id === 'appendicitis') await act({ type: 'order', patientId, code: 'us_appendix' });
          if (p.c.id === 'stemi_inferior') await act({ type: 'order', patientId, code: 'ecg12' });
          await act({ type: 'call', patientId, contactId: consult.contactId, text: [p.bedLabel, dx.label, ...dx.accept].join('. ') });
          expect(p.acceptedBy, p.c.id).toBeTruthy();
        } else {
          expect(p.c.truth.dispositions).toContain('discharge');
          await act({ type: 'disposition', patientId, decision: 'discharge', diagnoses: [dx.label], instructions: 'Review follow-up and return precautions.' });
        }
      }
      await act({ type: 'wait', minutes: 15 });
    }
    expect(mrns.size).toBe(count);
    expect([...s.patients.values()].every(p => p.departed)).toBe(true);
    expect(debrief(s).cases.map(c => c.caseId).sort()).toEqual(Object.keys(CASES).sort());
  });

  it('reserves a bay for an independent walk-in, then opens the encounter at the bedside', async () => {
    const scenario = resolveScenario('mixed_shift', 1)!;
    const room = scenario.bedPool![0];
    scenario.bedPool = [room];
    scenario.patients = ['uncomplicated_cystitis', 'stemi_inferior'].map(caseId => ({ caseId, arriveAtMin: 1, ...room }));
    const s = run(scenario.id, scenario);
    s.advance(60);
    const approaching = buildView(s, brain.status);
    const actor = approaching.npcs.find(n => n.walkIn)!;
    expect(actor.talkable).toBe(false);
    expect(approaching.board).toHaveLength(0);
    expect(s.patients.size).toBe(0);
    expect((await s.act({ type: 'talk', npcId: actor.id, text: 'Hello' })).ok).toBe(false);
    s.advance(actor.walkIn!.until - s.t + 1);
    const roomed = buildView(s, brain.status);
    expect(roomed.board).toHaveLength(1);
    expect(roomed.npcs.find(n => n.id === actor.id)).toMatchObject({ location: room.bed, spot: 'bed', talkable: true });
    s.depart(s.presentPatients()[0]);
    expect(s.incoming.size).toBe(0);
    expect(s.presentPatients()[0].c.id).toBe('stemi_inferior');
  });

  it('keeps an in-flight verbal order tied to the patient the nurse saw', async () => {
    const scenario = resolveScenario('mixed_shift', 7)!;
    const room = scenario.bedPool![0];
    scenario.bedPool = [room];
    scenario.patients = ['ankle_sprain', 'appendicitis'].map(caseId => ({ caseId, arriveAtMin: 0, ...room }));
    const s = run(scenario.id, scenario);
    const [original] = s.presentPatients();
    s.reply = async () => {
      s.depart(original); // the first patient leaves while the reply is being generated
      return { say: 'I heard the order.', emotion: 'neutral', revealed: [], counseled: [],
        actions: [{ id: 'verbal_order', code: 'cbc', patient: room.bed }] };
    };
    await s.act({ type: 'talk', npcId: 'rn_rosa', text: 'Please draw blood.' });
    const [replacement] = s.presentPatients();
    expect(replacement.bed).toBe(original.bed);
    expect(replacement.id).not.toBe(original.id);
    expect(replacement.orders).toHaveLength(0);
  });
});
