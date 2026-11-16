/**
 * Bedside ultrasound as exam maneuvers (shared/pocus.ts, server/sim/pocus.ts): nine views in the
 * Examine list for every patient; the case's read where it has one, else a normal study (or "No
 * finding recorded" for a case adapted from a case report); an examination at the bedside (time, the
 * finding, the log, a hand-hygiene contact) that is never scored on its own and never draws from the
 * session's random stream.
 */
import { describe, expect, it } from 'vitest';
import { CASES } from '../content/scenarios';
import { NpcBrain } from '../server/npc/brain';
import { catalogText } from '../server/sim/agentText';
import { ultrasoundRead } from '../server/sim/pocus';
import { caseDebrief, debrief } from '../server/sim/scoring';
import { GameSession, M } from '../server/sim/session';
import { practiceId } from '../server/sim/shiftRoster';
import { EXAM_BY_ID, EXAM_MANEUVERS } from '../shared/catalog';
import { POCUS_WINDOWS, type PocusWindow } from '../shared/pocus';
import type { Action } from '../shared/types';

const brain = new NpcBrain(null);
const session = (map: 'orientation' | 'night_shift', seed = 11) => new GameSession({ scenarioId: map, seed, playerName: 'T', mode: 'step', brain });
const practice = (id: string) => {
  const s = new GameSession({ scenarioId: practiceId(id), mode: 'step', playerName: 'T', brain, seed: 32 });
  return { s, p: s.presentPatients()[0] };
};
const byName = (s: GameSession, last: string) => [...s.patients.values()].find((p) => p.c.patient.lastName === last)!;

describe('the views', () => {
  it('are nine exam maneuvers under "Bedside ultrasound", FAST first, RLQ 2 min and the rest 1', () => {
    const us = EXAM_MANEUVERS.filter((m) => m.system === 'Bedside ultrasound');
    expect(us.map((m) => m.id)).toEqual(['pocus_ruq', 'pocus_luq', 'pocus_pelvic', 'pocus_cardiac', 'pocus_aorta', 'pocus_rlq', 'pocus_bladder', 'pocus_ivc', 'pocus_lung']);
    expect(EXAM_BY_ID.pocus_rlq.minutes).toBe(2);
    expect(us.filter((m) => m.id !== 'pocus_rlq').every((m) => m.minutes === 1)).toBe(true);
  });

  it('every patient of both fixed maps reads in every view', () => {
    for (const map of ['orientation', 'night_shift'] as const) {
      const s = session(map);
      s.advance(40 * M);
      for (const p of s.presentPatients()) {
        for (const w of POCUS_WINDOWS) {
          const text = ultrasoundRead(s, p, w.id);
          expect(text.length, `${p.c.id} ${w.id}`).toBeGreaterThan(40);
          expect(text).not.toMatch(/\{(rate|hr|sbp)\}/);
        }
      }
    }
  });
});

describe('the reads', () => {
  it('appendicitis: a non-compressible appendix with an appendicolith in the RLQ; FAST negative', () => {
    const s = session('orientation');
    s.advance(10 * M);
    const mia = byName(s, 'Thompson');
    const rlq = ultrasoundRead(s, mia, 'rlq');
    for (const x of [/non-compressible/, /blind-ending/, /appendicolith/, /10 mm/]) expect(rlq).toMatch(x);
    // the case's own formal ultrasound agrees
    expect(CASES.appendicitis.imaging.us_appendix.findings).toMatch(/10 mm/);
    for (const w of ['ruq', 'luq', 'pelvic'] as PocusWindow[]) expect(ultrasoundRead(s, mia, w), w).toMatch(/No free fluid/);
    expect(ultrasoundRead(s, mia, 'pelvic')).toMatch(/rectouterine/);
  });

  it('patients without an appendix finding read a normal RLQ', () => {
    const s = session('night_shift');
    s.advance(40 * M);
    for (const last of ['Keller', 'Brunner', 'Kellner', 'Okafor']) {
      const text = ultrasoundRead(s, byName(s, last), 'rlq');
      expect(text, last).toMatch(/not visualized/);
      expect(text, last).not.toMatch(/non-compressible, blind-ending/);
    }
  });

  it('urosepsis: the IVC fills with fluid (a physiology variant) and a catheter shows in the bladder (a flag variant)', () => {
    const s = session('night_shift', 3);
    s.advance(6 * M);
    const g = byName(s, 'Brunner');
    expect(ultrasoundRead(s, g, 'ivc')).toMatch(/IVC small, 0\.9 cm/);
    expect(ultrasoundRead(s, g, 'bladder')).toMatch(/nearly empty/);
    s.placeOrder(g.id, 'lr_bolus', { dose: '30 mL/kg' }, 'STAT', 'You');
    s.placeOrder(g.id, 'meropenem', undefined, 'STAT', 'You');
    s.advance(150 * M);
    expect(ultrasoundRead(s, g, 'ivc')).toMatch(/better filled after fluid/);
    s.flags.add(`${g.id}:foley`);
    expect(ultrasoundRead(s, g, 'bladder')).toMatch(/Catheter balloon/);
  });

  it('atrial fibrillation: the heart reads fast and irregular', () => {
    const s = session('night_shift');
    s.advance(40 * M);
    expect(ultrasoundRead(s, byName(s, 'Kellner'), 'cardiac')).toMatch(/irregularly irregular/);
  });

  it('a case adapted from a report: its own finding, and "No finding recorded" in the other views', () => {
    const { s, p } = practice('pmc-PMC12661095-ruptured-aaa-appendicitis-mimic');
    expect(ultrasoundRead(s, p, 'aorta')).toMatch(/infrarenal aneurysm, approximately 7 cm/);
    expect(ultrasoundRead(s, p, 'lung')).toBe('No finding recorded for this maneuver.');
  });
});

describe('examining with a view', () => {
  it('is an examination at the bedside: time, the labelled finding, the log, a hand-hygiene contact', async () => {
    const s = session('orientation');
    await s.act({ type: 'wait', minutes: 5 });
    const mia = byName(s, 'Thompson');
    const far = await s.act({ type: 'examine', patientId: mia.id, maneuver: 'pocus_rlq' });
    expect(far.ok).toBe(false);
    expect(far.message).toMatch(/bedside/);
    await s.act({ type: 'move', to: mia.bed });
    const t0 = s.t;
    const r = await s.act({ type: 'examine', patientId: mia.id, maneuver: 'pocus_rlq' });
    expect(r.ok).toBe(true);
    expect(s.t - t0).toBe(2 * M);
    expect(r.text).toMatch(/^Ultrasound — RLQ \/ appendix: .*non-compressible/);
    expect(mia.exam.at(-1)).toMatchObject({ maneuver: 'pocus_rlq', label: 'Ultrasound — RLQ / appendix', system: 'Bedside ultrasound' });
    expect(s.log.at(-1)).toMatchObject({ kind: 'exam', pid: mia.id, maneuver: 'pocus_rlq' });
    expect(s.ic.at(-1)).toMatchObject({ kind: 'contact', pid: mia.id });
    const t1 = s.t;
    expect((await s.act({ type: 'examine', patientId: mia.id, maneuver: 'pocus_ivc' })).ok).toBe(true);
    expect(s.t - t1).toBe(1 * M);
  });

  it('draws nothing from the random stream: the same log, debrief and labs as waiting instead', async () => {
    const play = async (scan: boolean) => {
      const s = session('orientation', 2024);
      const steps: Action[] = [
        { type: 'wait', minutes: 5 },
        { type: 'move', to: 'bed_5' },
        { type: 'examine', patientId: 'p_thompson', maneuver: 'abd_mcburney' },
        scan ? { type: 'examine', patientId: 'p_thompson', maneuver: 'pocus_rlq' } : { type: 'wait', minutes: 2 },
        scan ? { type: 'examine', patientId: 'p_thompson', maneuver: 'pocus_ruq' } : { type: 'wait', minutes: 1 },
        { type: 'move', to: 'station' },
        { type: 'order', patientId: 'p_thompson', code: 'hcg_u' },
        { type: 'order', patientId: 'p_thompson', code: 'cbc' },
        { type: 'order', patientId: 'p_thompson', code: 'us_appendix' },
        { type: 'wait', minutes: 90 },
        { type: 'end_shift' },
      ];
      for (const a of steps) await s.act(a);
      return s;
    };
    const a = await play(true);
    const b = await play(false);
    const strip = (s: GameSession) => JSON.stringify(s.log.filter((e) => !(e.kind === 'exam' && e.maneuver?.startsWith('pocus_'))));
    expect(strip(a)).toBe(strip(b));
    const da = debrief(a);
    const db = debrief(b);
    expect(da.score).toBe(db.score);
    expect(JSON.stringify(da.cases.map((c) => c.items))).toBe(JSON.stringify(db.cases.map((c) => c.items)));
    expect(JSON.stringify(a.patients.get('p_thompson')!.labs)).toBe(JSON.stringify(b.patients.get('p_thompson')!.labs));
    expect(a.rng.next()).toBe(b.rng.next());
  });

  it('scores the scan where a case asks for one (high-risk PE: the heart; pleural effusion: the RUQ)', async () => {
    for (const [id, maneuver, label] of [
      ['pmc-PMC12315597-syncope-high-risk-pe', 'pocus_cardiac', 'Scan the heart with bedside ultrasound in undifferentiated shock'],
      ['symptomatic_pleural_effusion', 'pocus_ruq', 'Scan the effusion with bedside ultrasound to plan sampling'],
    ]) {
      const { s, p } = practice(id);
      const item = () => caseDebrief(s, p).items.find((i) => i.label === label);
      expect(item()?.ok, id).toBe(false);
      await s.act({ type: 'move', to: p.bed });
      expect((await s.act({ type: 'examine', patientId: p.id, maneuver })).ok, id).toBe(true);
      expect(item()?.ok, id).toBe(true);
    }
  });

  it('agents: the catalog lists the views as exam maneuvers, and there is no separate ultrasound action', async () => {
    const text = catalogText();
    expect(text).toContain('pocus_rlq = Bedside ultrasound: RLQ / appendix');
    expect(text).toContain('{"type":"examine","patientId":"p_…","maneuver":"pocus_rlq"}');
    expect(text).not.toContain('{"type":"pocus"');
    // the old action is refused with a pointer to the new one, and takes no time
    const s = session('orientation');
    const t0 = s.t;
    const old = await s.act({ type: 'pocus', patientId: 'p_thompson', window: 'rlq' } as unknown as Action);
    expect(old.ok).toBe(false);
    expect(old.message).toMatch(/examine with maneuver pocus_<window>/);
    expect((await s.act({ type: 'scan' } as unknown as Action)).message).toBe('Unknown action "scan".');
    expect(s.t).toBe(t0);
  });
});
