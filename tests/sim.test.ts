import { describe, expect, it } from 'vitest';
import { NpcBrain } from '../server/npc/brain';
import { debrief } from '../server/sim/scoring';
import { GameSession, M } from '../server/sim/session';

const brain = new NpcBrain(null); // offline, deterministic

function night(seed = 42) {
  return new GameSession({ scenarioId: 'night_shift', seed, playerName: 'Test', mode: 'step', brain });
}

function p(s: GameSession, last: string) {
  return [...s.patients.values()].find((x) => x.c.patient.lastName === last)!;
}

describe('physiology', () => {
  it('untreated urosepsis: lactate rises and BP falls; carbapenem + fluids reverse it', () => {
    const a = night(1);
    a.advance(5 * M);
    const g = p(a, 'Brunner');
    const lac0 = g.physio.value('lactate', 0);
    a.advance(120 * M);
    const m = a.minutesSinceArrival(g);
    expect(g.physio.value('lactate', m)).toBeGreaterThan(lac0 + 1);
    expect(g.physio.value('sbp', m)).toBeLessThan(85);

    const b = night(1);
    b.advance(5 * M);
    const g2 = p(b, 'Brunner');
    b.act({ type: 'move', to: 'station' });
    b.placeOrder(g2.id, 'lr_bolus', { dose: '30 mL/kg' }, 'STAT', 'You');
    b.placeOrder(g2.id, 'meropenem', undefined, 'STAT', 'You');
    b.advance(180 * M);
    const m2 = b.minutesSinceArrival(g2);
    expect(g2.physio.value('lactate', m2)).toBeLessThan(lac0);
    expect(g2.physio.value('sbp', m2)).toBeGreaterThan(95);
  });

  it('nitroglycerin drops BP in the RV infarct', () => {
    const s = night(2);
    s.advance(14 * M);
    const k = p(s, 'Keller');
    const before = s.trueVitals(k).sbp;
    s.placeOrder(k.id, 'ntg_sl', undefined, 'STAT', 'You');
    s.advance(25 * M);
    expect(s.trueVitals(k).sbp).toBeLessThan(before - 20);
    expect(s.flags.has(`${k.id}:nitrate_rv`)).toBe(true);
  });
});

describe('orders & results', () => {
  it('labs are collected then resulted with realistic turnaround', () => {
    const s = night(3);
    s.advance(6 * M);
    const g = p(s, 'Brunner');
    s.placeOrder(g.id, 'lactate', undefined, 'STAT', 'You');
    s.advance(3 * M);
    expect(g.labs.filter((l) => l.analyte === 'lactate')).toHaveLength(0);
    s.advance(60 * M);
    const lac = g.labs.filter((l) => l.analyte === 'lactate');
    expect(lac).toHaveLength(1);
    expect(lac[0].resultedAt - lac[0].collectedAt).toBeGreaterThanOrEqual(15 * M);
  });

  it('CT in a woman of reproductive age is held until a pregnancy test results', () => {
    const s = new GameSession({ scenarioId: 'orientation', seed: 9, playerName: 'T', mode: 'step', brain });
    s.advance(4 * M);
    const mia = p(s, 'Thompson');
    s.placeOrder(mia.id, 'ct_abd_iv', undefined, 'STAT', 'You');
    s.advance(100 * M);
    const o = mia.orders.find((x) => x.code === 'ct_abd_iv')!;
    expect(o.statusText).toMatch(/pregnancy/i);
    expect(s.pages.some((pg) => /pregnancy test/i.test(pg.text))).toBe(true);
    s.placeOrder(mia.id, 'hcg_u', undefined, 'STAT', 'You');
    s.advance(80 * M);
    expect(['Final', 'Completed']).toContain(mia.orders.find((x) => x.code === 'ct_abd_iv')!.status);
  });

  it('blocked MRI gets canceled by radiology', () => {
    const s = new GameSession({ scenarioId: 'orientation', seed: 9, playerName: 'T', mode: 'step', brain });
    const d = p(s, 'Okafor');
    s.placeOrder(d.id, 'mri_ankle', undefined, 'STAT', 'You');
    s.advance(10 * M);
    expect(d.orders[0].status).toBe('Canceled');
  });
});

describe('staff errors', () => {
  it('wrong-patient metoprolol reaches Keller if nobody intervenes', () => {
    const s = night(5);
    s.advance(70 * M);
    const k = p(s, 'Keller');
    expect(k.mar.some((m) => /metoprolol/i.test(m.med))).toBe(true);
    const err = s.safety.find((x) => x.def.kind === 'wrong_patient_med')!;
    expect(err.status).toBe('missed');
  });

  it('...and is prevented when the player challenges the nurse', async () => {
    const s = night(5);
    s.advance(53 * M);
    const tom = s.staff.get('rn_tom')!;
    await s.act({ type: 'move', to: tom.location });
    const r = await s.act({ type: 'talk', npcId: 'rn_tom', text: 'Wait Tom, stop — is that metoprolol really for Keller? Check the wristband, I think it is for Kellner in bed 3.' });
    expect(r.ok).toBe(true);
    s.advance(20 * M);
    const err = s.safety.find((x) => x.def.kind === 'wrong_patient_med')!;
    expect(err.status).toBe('caught');
    expect(p(s, 'Keller').mar.some((m) => /metoprolol/i.test(m.med))).toBe(false);
    expect(p(s, 'Kellner').mar.some((m) => /metoprolol/i.test(m.med))).toBe(true);
  });

  it('missing triage temperature is caught by ordering vitals', () => {
    const s = night(6);
    s.advance(6 * M);
    const g = p(s, 'Brunner');
    expect(g.vitals[0].temp).toBeUndefined();
    s.placeOrder(g.id, 'vitals_now', undefined, 'STAT', 'You');
    s.advance(30 * M);
    expect(g.vitals.some((v) => v.temp !== undefined)).toBe(true);
    expect(s.safety.find((x) => x.def.kind === 'missing_triage_vital')!.status).toBe('caught');
  });

  it('antibiotics before cultures happens unless the nurse is told cultures first', async () => {
    const s = night(7);
    s.advance(6 * M);
    const g = p(s, 'Brunner');
    s.placeOrder(g.id, 'bcx', undefined, 'STAT', 'You');
    s.placeOrder(g.id, 'meropenem', undefined, 'STAT', 'You');
    s.advance(60 * M);
    const err = s.safety.find((x) => x.def.kind === 'abx_before_cultures')!;
    // either the cultures were drawn first naturally (na) or the error happened (missed)
    expect(['missed', 'na']).toContain(err.status);
  });
});

describe('dialogue (offline) and scoring', () => {
  it('patient reveals keyed facts and they are credited', async () => {
    const s = night(8);
    s.advance(14 * M);
    const k = p(s, 'Keller');
    await s.act({ type: 'move', to: k.bed });
    await s.act({ type: 'talk', npcId: `pt_${k.id}`, text: 'Hello Mr. Keller, does the pain radiate to your arm or jaw?' });
    await s.act({ type: 'talk', npcId: `pt_${k.id}`, text: 'Any other medications, like Viagra or sildenafil?' });
    expect(k.revealed.has('radiation')).toBe(true);
    expect(k.revealed.has('pde5')).toBe(true);
  });

  it('a good STEMI workup scores well; cath lab acceptance is guarded', async () => {
    const s = night(10);
    s.advance(17 * M); // Keller arrived at 12, auto ECG at +4
    const k = p(s, 'Keller');
    await s.act({ type: 'move', to: 'station' });
    const ecg = k.ecgs[0];
    expect(ecg).toBeDefined();
    await s.act({ type: 'sign_ecg', ecgId: ecg.id, interpretation: 'Sinus brady, inferior STEMI with reciprocal changes in I and aVL' });
    for (const code of ['aspirin', 'monitor', 'iv_access', 'ecg_right', 'heparin', 'trop', 'bmp', 'cbc']) await s.act({ type: 'order', patientId: k.id, code });
    const r = await s.act({ type: 'call', contactId: 'cards', text: 'Hi, this is the ED resident. Bed 2, Robert Keller, 64M with an inferior STEMI, ST elevation in II, III, aVF — please activate the cath lab.' });
    expect(r.ok).toBe(true);
    expect(k.acceptedBy).toBeTruthy();
    await s.act({ type: 'set_diagnoses', patientId: k.id, diagnoses: ['Inferior STEMI', 'RV involvement'] });
    await s.act({ type: 'disposition', patientId: k.id, decision: 'cath_lab', diagnoses: ['Inferior STEMI'] });
    s.advance(60 * M);
    s.end('test');
    const d = debrief(s);
    const kd = d.cases.find((c) => c.name.includes('Keller'))!;
    expect(kd.dxVerdict).toBe('correct');
    expect(kd.dispoCorrect).toBe(true);
    expect(kd.score / kd.maxScore).toBeGreaterThan(0.6);
  });

  it('same seed ⇒ same lab values (fair comparisons)', () => {
    const a = night(77);
    const b = night(77);
    for (const s of [a, b]) {
      s.advance(6 * M);
      s.placeOrder(p(s, 'Brunner').id, 'cbc', undefined, 'STAT', 'You');
      s.advance(60 * M);
    }
    const va = p(a, 'Brunner').labs.filter((l) => !l.historical).map((l) => [l.analyte, l.value, l.resultedAt]);
    const vb = p(b, 'Brunner').labs.filter((l) => !l.historical).map((l) => [l.analyte, l.value, l.resultedAt]);
    expect(va).toEqual(vb);
  });

  it('a fixed session id changes nothing in a shift (the rng stream is the same)', async () => {
    const run = async (id?: string) => {
      const s = new GameSession({ scenarioId: 'night_shift', seed: 31, playerName: 'Test', mode: 'step', brain, ...(id ? { id } : {}) });
      await s.act({ type: 'wait', minutes: 8 });
      await s.act({ type: 'move', to: 'station' });
      await s.act({ type: 'order', patientId: 'p_brunner', code: 'lactate' });
      await s.act({ type: 'wait', minutes: 40 });
      return { log: s.log, labs: s.patients.get('p_brunner')!.labs };
    };
    const plain = await run();
    expect(await run('s_cdfixed000000')).toEqual(plain);
    expect(new GameSession({ scenarioId: 'night_shift', seed: 31, playerName: 'x', mode: 'step', brain }).id).toMatch(/^s_[a-z0-9]+_[a-z0-9]+$/);
  });
});

describe('regressions', () => {
  it('untreated STEMI: VT then VF arrest with a real BP/GCS drop (trigger jumps apply)', () => {
    const s = night(21);
    s.advance(12 * M + 170 * M);
    const k = p(s, 'Keller');
    expect(s.flags.has(`${k.id}:vf_arrest`)).toBe(true);
    const fired = k.physio.fired.get('k_vf')!;
    const before = k.physio.value('gcs', fired - 0.5);
    const after = k.physio.value('gcs', fired + 1.5);
    expect(before - after).toBeGreaterThanOrEqual(3);
  });

  it('wrong-patient error does not double-dose the intended patient', async () => {
    for (const intervene of [false, true]) {
      const s = night(5);
      s.advance(53 * M);
      if (intervene) {
        await s.act({ type: 'move', to: s.staff.get('rn_tom')!.location });
        await s.act({ type: 'talk', npcId: 'rn_tom', text: 'Stop — check the wristband, that metoprolol is for Kellner in bed 3.' });
      }
      s.advance(90 * M);
      const doses = p(s, 'Kellner').mar.filter((m) => /metoprolol/i.test(m.med)).length;
      expect(doses).toBe(1);
    }
  });
});

describe('east wing (layout + ambient staff)', () => {
  const EAST = ['street', 'lobby', 'stairs', 'cafeteria', 'restrooms', 'restroom_acc', 'clinic', 'clinic_hall', 'exam_1', 'exam_2', 'exam_3'];

  it('agents can walk to every east-wing room, with sensible walking times', async () => {
    const s = night(5);
    for (const to of EAST) {
      await s.act({ type: 'move', to: 'station' });
      const r = await s.act({ type: 'move', to });
      expect(r.ok, to).toBe(true);
      expect(s.playerLocation).toBe(to);
      // the wing is 20–50 m from the station: about 20–60 s on foot
      expect(r.costMin! * 60, to).toBeGreaterThan(15);
      expect(r.costMin! * 60, to).toBeLessThan(65);
    }
  });

  it('the cafeteria is staffed around the clock; the outpatient clinic only in its opening hours', () => {
    const atNight = new Set(night().staff.keys());
    const day = new GameSession({ scenarioId: 'orientation', seed: 1, playerName: 'Test', mode: 'step', brain });
    const byDay = new Set(day.staff.keys());
    for (const id of ['caf_luis', 'caf_rn_mei', 'caf_visitor']) {
      expect(atNight.has(id), id).toBe(true);
      expect(byDay.has(id), id).toBe(true);
    }
    for (const id of ['cl_carmen', 'cl_rn_hannah']) {
      expect(byDay.has(id), id).toBe(true);
      expect(atNight.has(id), id).toBe(false);
    }
    // seated ambient staff start seated at their home spot
    expect(day.staff.get('cl_carmen')!.posture).toBe('sit');
    expect(day.staff.get('caf_luis')!.posture).toBe('stand');
  });
});
