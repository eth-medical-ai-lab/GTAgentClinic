import { describe, expect, it } from 'vitest';
import { lengthOfStay, type Action, type DischargeProgress } from '../shared/types';
import { NpcBrain } from '../server/npc/brain';
import { caseDebrief } from '../server/sim/scoring';
import { GameSession, M, type PatientState } from '../server/sim/session';
import { buildChart, buildView } from '../server/sim/views';

function shift(scenarioId = 'orientation') {
  return new GameSession({ scenarioId, mode: 'step', seed: 9, playerName: 'Resident', brain: new NpcBrain(null) });
}

function advanceTo(s: GameSession, p: PatientState, phase: DischargeProgress['phase']) {
  for (let i = 0; i < 240 && p.discharge?.phase !== phase; i++) s.advance(15);
  expect(p.discharge?.phase).toBe(phase);
}

describe('home discharge', () => {
  it('pushes the wheelchair at walking pace at 1× and preserves its position when the clock changes', () => {
    const s = new GameSession({ scenarioId: 'orientation', mode: 'realtime', settings: { timeScale: 1 }, seed: 9, playerName: 'Resident', brain: new NpcBrain(null) });
    const p = s.patients.get('p_okafor')!;
    s.disposition(p.id, 'discharge', undefined, ['Ankle sprain'], undefined, true);
    advanceTo(s, p, 'leaving');
    const start = p.discharge!.since;
    const seconds = p.discharge!.until! - start;
    // Fast Track is a few dozen metres from the public exit.
    expect(seconds).toBeGreaterThan(15);
    expect(seconds).toBeLessThan(45);
    s.tick(5);
    const fraction = () => (s.t - (p.discharge!.travelStart ?? start)) / (p.discharge!.until! - (p.discharge!.travelStart ?? start));
    const before = fraction();
    s.settings.timeScale = 6;
    s.tick(0);
    expect(fraction()).toBeCloseTo(before);
    s.tick(2);
    expect(fraction() - before).toBeCloseTo(2 / seconds);
    s.settings.timeScale = 1;
    s.tick(0);
    expect(p.discharge!.until! - s.t).toBeCloseTo(seconds - 7);
    s.settings.paused = true;
    s.tick(12);
    expect(p.discharge!.until! - s.t).toBeCloseTo(seconds - 7);
    s.settings.paused = false;
    s.tick(seconds - 8);
    expect(s.staff.get(p.nurseId)!.current?.kind).toBe('discharge');
    s.tick(2);
    expect(p.departed).toBe(true);
    expect(s.staff.get(p.nurseId)!.current?.kind).not.toBe('discharge');
  });
  it('prints the signed instructions, waits for the assigned nurse, then frees the bay after the walk', async () => {
    const s = shift();
    const p = s.patients.get('p_okafor')!;
    const nurse = s.staff.get(p.nurseId)!;
    // The same nurse has a higher-priority bedside job on the other patient.
    s.enqueue(nurse.def.id, { kind: 'assess', pid: 'p_thompson', orderIds: [], location: 'bed_5', durationMin: 8, priority: 1, label: 'Assess Bed 5', done: () => {} });
    const instructions = 'Bring your brace to follow-up.';
    const sign: Action = { type: 'disposition', patientId: p.id, decision: 'discharge', diagnoses: ['Ankle sprain'], instructions };
    expect((await s.act(sign)).ok).toBe(true);
    expect(buildChart(s, p).discharge).toMatchObject({ phase: 'paperwork', mobility: 'walking', nurseId: p.nurseId });
    expect(p.notes.filter(n => n.title === 'Discharge paperwork')).toHaveLength(0);
    expect(caseDebrief(s, p).outcome).toContain('still in the ED (preparing discharge paperwork)');
    // Double submitting the same signed discharge cannot print or start a second handoff.
    expect((await s.act(sign)).ok).toBe(true);
    s.advance(3 * M);
    expect(p.discharge?.phase).toBe('awaiting_nurse');
    expect(p.discharge?.until).toBeUndefined();
    expect(nurse.current?.pid).toBe('p_thompson');
    const paperwork = p.notes.filter(n => n.title === 'Discharge paperwork');
    expect(paperwork).toHaveLength(1);
    expect(paperwork[0].text).toContain(instructions);
    expect(s.disposition(p.id, 'observation', undefined, []).ok).toBe(false);
    for (let i = 0; i < 120 && !p.discharge?.until; i++) s.advance(5);
    const trip = p.discharge!;
    expect(trip.phase).toBe('awaiting_nurse');
    expect(trip.from).toBeDefined();
    expect(trip.until! - trip.since).toBeGreaterThan(15);
    expect(buildView(s, s.brain.status).npcs.find(n => n.id === nurse.def.id)?.discharge).toEqual(trip);
    advanceTo(s, p, 'handoff');
    expect(p.discharge!.since).toBeGreaterThanOrEqual(trip.until!);
    expect(nurse.current).toMatchObject({ kind: 'discharge', pid: p.id, location: p.bed });
    const handoff = buildView(s, s.brain.status);
    expect(handoff.npcs.find(n => n.id === nurse.def.id)?.discharge).toEqual(p.discharge);
    expect(handoff.board.find(r => r.id === p.id)?.discharge).toEqual(p.discharge);
    advanceTo(s, p, 'leaving');
    expect(p.departed).toBe(false);
    expect(nurse.current?.kind).not.toBe('discharge');
    expect(p.notes.filter(n => n.title === 'Discharge handoff')).toHaveLength(1);
    expect(s.placeOrder(p.id, 'ankle_brace', undefined, undefined, 'You').ok).toBe(false);
    advanceTo(s, p, 'departed');
    expect(p.flow).toBe('Departed');
    const chart = buildChart(s, p);
    expect(chart.departedAt).toBe(p.discharge?.since);
    expect(lengthOfStay(chart, s.t + 10 * M)).toBe(p.departT! - p.arrivalT);
    expect(buildView(s, s.brain.status).npcs.find(n => n.id === `pt_${p.id}`)?.visible).toBe(false);
    expect(s.log.filter(e => e.kind === 'dispo' && e.pid === p.id)).toHaveLength(1);
    expect(s.pages.filter(pg => pg.patientId === p.id && pg.text.includes('has left the ED for home'))).toHaveLength(1);
  });

  it('rejects invalid discharge fields before starting the paperwork timer', async () => {
    const s = shift();
    const sign = { type: 'disposition', patientId: 'p_okafor', decision: 'discharge', diagnoses: ['Ankle sprain'] };
    for (const invalid of [{ instructions: 42 }, { wheelchair: 'false' }]) {
      expect((await s.act({ ...sign, ...invalid } as unknown as Action)).ok).toBe(false);
    }
    s.advance(3 * M);
    expect(s.patients.get('p_okafor')!.dispo).toBeUndefined();
  });

  it.each([
    { map: 'orientation', id: 'p_okafor', at: 0, wheelchair: true },
    { map: 'night_shift', id: 'p_brunner', at: 5, wheelchair: false },
  ])('reserves the same escort through the wheelchair exit for $id', async ({ map, id, at, wheelchair }) => {
    const s = shift(map);
    s.advance(at * M);
    const p = s.patients.get(id)!;
    await s.act({ type: 'disposition', patientId: id, decision: 'discharge', diagnoses: ['Test'], wheelchair });
    expect(p.discharge?.mobility).toBe('wheelchair');
    advanceTo(s, p, 'leaving');
    const nurse = s.staff.get(p.nurseId)!;
    expect(nurse.current).toMatchObject({ pid: p.id, kind: 'discharge' });
    expect(buildView(s, s.brain.status).npcs.find(n => n.id === nurse.def.id)?.discharge).toEqual(p.discharge);
    expect(s.disposition(p.id, 'ama', undefined, []).ok).toBe(false);
    s.advance((p.discharge!.until! - s.t) / 2);
    expect(nurse.current).toMatchObject({ pid: p.id, kind: 'discharge' });
    advanceTo(s, p, 'departed');
    expect(nurse.current?.kind).not.toBe('discharge');
  });

  it('keeps a signed discharge separate from a surgical acceptance and transport', () => {
    const s = shift();
    s.advance(3 * M);
    const p = s.patients.get('p_thompson')!;
    s.acceptConsult(p, 'surg', 'Surgery');
    expect(s.disposition(p.id, 'discharge', undefined, []).ok).toBe(false);
    expect(p.discharge).toBeUndefined();
    s.advance(80 * M);
    expect(p.departed).toBe(true);
    expect(p.dispo?.decision).toBe('or');
    expect(p.notes.some(n => n.title === 'Discharge paperwork')).toBe(false);
  });

  it('stops unperformed ED orders at exit but delivers outstanding specimen results', () => {
    const s = shift();
    const p = s.patients.get('p_okafor')!;
    s.placeOrder(p.id, 'tsh', undefined, 'Routine', 'You');
    const lab = p.orders[0];
    for (let i = 0; i < 120 && lab.collectedAt === undefined; i++) s.advance(15);
    expect(lab.collectedAt).toBeDefined();
    s.disposition(p.id, 'discharge', undefined, ['Ankle sprain']);
    advanceTo(s, p, 'handoff');
    s.placeOrder(p.id, 'ibuprofen', undefined, 'Routine', 'You');
    s.placeOrder(p.id, 'xr_ankle', undefined, 'Routine', 'You');
    advanceTo(s, p, 'departed');
    s.advance(100 * M);
    expect(p.orders.find(o => o.code === 'ibuprofen')).toMatchObject({ status: 'Canceled' });
    expect(p.mar).toHaveLength(0);
    expect(p.imaging[0].status).toBe('Canceled');
    expect(lab.status).toBe('Resulted');
    expect(p.labs.some(l => l.orderId === lab.id)).toBe(true);
    expect(s.log.some(e => e.pid === p.id && e.kind === 'cancel')).toBe(false);
  });

  it('releases the attending and takes bedside interactions and belongings out of reach on exit', async () => {
    const s = shift();
    const p = s.patients.get('p_okafor')!;
    await s.act({ type: 'move', to: p.bed });
    await s.act({ type: 'disposition', patientId: p.id, decision: 'discharge', diagnoses: ['Ankle sprain'] });
    advanceTo(s, p, 'handoff');
    expect(s.items().some(it => it.p === p)).toBe(true);
    expect((await s.act({ type: 'escalate', patientId: p.id, mode: 'bedside' })).ok).toBe(true);
    advanceTo(s, p, 'leaving');
    expect(s.escalations[0].status).toBe('done');
    expect(s.staff.get('att_shaw')!.location).not.toBe(p.bed);
    expect(s.items().some(it => it.p === p)).toBe(false);
    const bedside: Action[] = [
      { type: 'talk', npcId: `pt_${p.id}`, text: 'What brought you in?' },
      { type: 'examine', patientId: p.id, maneuver: 'pocus_ivc' },
      { type: 'escalate', patientId: p.id, mode: 'bedside' },
    ];
    for (const action of bedside) {
      const result = await s.act(action);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/exit|leaving/);
      expect(p.departed).toBe(false);
    }
    expect(s.inspect('okafor_gym_bag').ok).toBe(false);
    expect(s.giveItem('okafor_gym_bag').ok).toBe(false);
  });

  it('holds the handoff until a patient already in imaging returns to the bay', () => {
    const s = shift();
    const p = s.patients.get('p_okafor')!;
    s.placeOrder(p.id, 'xr_ankle', undefined, 'STAT', 'You');
    for (let i = 0; i < 240 && !p.scan; i++) s.advance(15);
    expect(p.location).toBe('xray');
    s.disposition(p.id, 'discharge', undefined, ['Ankle sprain']);
    s.advance(3 * M);
    expect(p.discharge?.phase).toBe('awaiting_nurse');
    expect(s.staff.get(p.nurseId)?.queue.some(t => t.kind === 'discharge')).toBe(false);
    advanceTo(s, p, 'handoff');
    expect(p.location).toBe(p.bed);
    expect(p.imaging[0].performedAt).toBeDefined();
    advanceTo(s, p, 'departed');
  });
});
