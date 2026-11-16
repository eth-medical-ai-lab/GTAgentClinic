/**
 * Bed positions (server/sim/bedPosition.ts): each case's default as its case file sets it, the general
 * rules (flat for an abdominal exam and back up after, flat while hypotensive, sat up when short of
 * breath, a catheter going in, CPR), the ankle's position after ice and elevation; and that it is view
 * only: the same seed and actions give the same positions, and building views changes nothing in the
 * session (its event log, its debrief).
 */
import { describe, expect, it } from 'vitest';
import { NpcBrain } from '../server/npc/brain';
import { bedPositionFor } from '../server/sim/bedPosition';
import { debrief } from '../server/sim/scoring';
import { GameSession, M, type PatientState } from '../server/sim/session';
import { buildView } from '../server/sim/views';

const brain = new NpcBrain(null); // offline, deterministic

const night = (seed = 2024) => new GameSession({ scenarioId: 'night_shift', seed, playerName: 'Test', mode: 'step', brain });
const pt = (s: GameSession, last: string) => [...s.patients.values()].find((x) => x.c.patient.lastName === last)!;
const npcOf = (s: GameSession, p: PatientState) => buildView(s, s.brain.status).npcs.find((n) => n.patientId === p.id)!;

describe('bed position: the cases’ defaults', () => {
  it('Night Shift: STEMI 45°, AF 60° while fast, urosepsis 35°, the ankle on the stretcher’s edge', () => {
    const s = night();
    s.advance(35 * M);
    const keller = bedPositionFor(s, pt(s, 'Keller'));
    expect(keller).toMatchObject({ headDeg: 45, reason: 'case default' });
    const kellner = bedPositionFor(s, pt(s, 'Kellner'));
    expect(kellner).toMatchObject({ headDeg: 60, reason: 'symptomatic (hr > 110)' });
    expect(bedPositionFor(s, pt(s, 'Brunner')).headDeg).toBe(35);
    expect(bedPositionFor(s, pt(s, 'Okafor'))).toMatchObject({ headDeg: 30, sitting: 'edge' });
    // the view: posture follows (on the edge: sitting; in bed: lying), the position rides along
    const ok = npcOf(s, pt(s, 'Okafor'));
    expect(ok.posture).toBe('sit');
    expect(ok.bedPosition).toMatchObject({ sitting: 'edge' });
    expect(npcOf(s, pt(s, 'Kellner')).posture).toBe('lie');
  });

  it('Orientation: appendicitis 30° with the knees bent', () => {
    const s = new GameSession({ scenarioId: 'orientation', seed: 7, playerName: 'Test', mode: 'step', brain });
    s.advance(10 * M);
    expect(bedPositionFor(s, pt(s, 'Thompson'))).toMatchObject({ headDeg: 30, knees: true, reason: 'case default' });
  });
});

describe('bed position: the general rules', () => {
  it('flat for an abdominal exam (knees bent), back up two game minutes after', () => {
    const s = night();
    s.advance(20 * M);
    const b = pt(s, 'Brunner');
    expect(bedPositionFor(s, b).headDeg).toBe(35);
    s.examine(b.id, 'abd_palpate');
    expect(bedPositionFor(s, b)).toMatchObject({ headDeg: 0, knees: true, reason: 'abdominal exam' });
    s.advance(1 * M);
    expect(bedPositionFor(s, b).headDeg).toBe(0);
    s.advance(1.5 * M);
    expect(bedPositionFor(s, b).headDeg).toBe(35);
    // a heart exam leaves her as she is
    s.examine(b.id, 'cv_auscultate');
    expect(bedPositionFor(s, b).headDeg).toBe(35);
  });

  it('flat while hypotensive (the nitrate in the RV infarct), as the monitor shows it', () => {
    const s = night(2);
    s.advance(14 * M);
    const k = pt(s, 'Keller');
    s.placeOrder(k.id, 'monitor', undefined, 'STAT', 'You');
    s.advance(8 * M);
    expect(k.onMonitor).toBe(true);
    expect(bedPositionFor(s, k).headDeg).toBe(45);
    s.placeOrder(k.id, 'ntg_sl', undefined, 'STAT', 'You');
    s.advance(25 * M);
    expect(s.trueVitals(k).sbp).toBeLessThan(85);
    expect(bedPositionFor(s, k)).toMatchObject({ headDeg: 0, reason: 'hypotension' });
  });

  it('sat up when short of breath; flat while a catheter goes in', () => {
    const s = night();
    s.advance(20 * M);
    const b = pt(s, 'Brunner');
    // her charted rate climbs (as the nurse would chart it)
    b.vitals.push({ id: 'vx', t: s.t, source: 'Nurse', hr: 120, sbp: 104, rr: 30, spo2: 91 });
    expect(bedPositionFor(s, b)).toMatchObject({ headDeg: 70, sitting: 'upright', reason: 'short of breath' });
    b.vitals.push({ id: 'vy', t: s.t, source: 'Nurse', hr: 104, sbp: 112, rr: 20, spo2: 95 });
    expect(bedPositionFor(s, b).headDeg).toBe(35);
    s.placeOrder(b.id, 'foley', undefined, 'STAT', 'You');
    let flat = false;
    for (let i = 0; i < 40 && !flat; i++) {
      s.advance(30);
      flat = bedPositionFor(s, b).reason === 'urinary catheter';
    }
    expect(flat).toBe(true);
    expect(bedPositionFor(s, b).headDeg).toBe(0);
    s.advance(15 * M);
    expect(bedPositionFor(s, b).headDeg).toBe(35);
  });

  it('the ankle: off the edge, reclined with the injured right leg on a pillow once ice and elevation are done', () => {
    const s = night();
    s.advance(5 * M);
    const o = pt(s, 'Okafor');
    expect(bedPositionFor(s, o).sitting).toBe('edge');
    s.placeOrder(o.id, 'ice_elevate', undefined, 'STAT', 'You');
    s.advance(20 * M);
    expect(bedPositionFor(s, o)).toMatchObject({ headDeg: 40, legUp: 'R' });
    expect(npcOf(s, o).posture).toBe('lie');
  });

  it('flat for CPR (the untreated STEMI’s VF), then back up after ROSC', () => {
    const s = night(3);
    const k = pt(s, 'Keller');
    let saw = false;
    for (let i = 0; i < 400 && !saw; i++) {
      s.advance(30);
      saw = bedPositionFor(s, k).reason === 'CPR';
    }
    expect(saw).toBe(true);
    expect(bedPositionFor(s, k).headDeg).toBe(0);
    s.advance(4 * M);
    expect(bedPositionFor(s, k).reason).not.toBe('CPR');
  });

  it('in imaging, on the table: flat', () => {
    const s = night();
    s.advance(20 * M);
    const b = pt(s, 'Brunner');
    b.location = 'ct';
    expect(bedPositionFor(s, b)).toMatchObject({ headDeg: 0, reason: 'imaging table' });
  });
});

describe('bed position: view only', () => {
  it('is deterministic, and building views changes nothing in the session', async () => {
    const run = async (views: boolean) => {
      const s = night(99);
      const seen: string[] = [];
      for (let i = 0; i < 24; i++) {
        const b = pt(s, 'Brunner');
        const r = await s.act(i === 7 ? { type: 'move', to: b.bed } : i === 8 ? { type: 'examine', patientId: b.id, maneuver: 'abd_palpate' } : { type: 'wait', minutes: 5 });
        if (i === 8) expect(r.ok, r.message).toBe(true);
        if (views) seen.push(JSON.stringify(buildView(s, s.brain.status).npcs.filter((n) => n.role === 'patient').map((n) => [n.id, n.bedPosition])));
      }
      return { s, seen };
    };
    const a = await run(true);
    const b = await run(true);
    const c = await run(false);
    expect(a.seen).toEqual(b.seen);
    expect(a.seen.some((x) => x.includes('abdominal exam'))).toBe(true);
    // the event log and the debrief: the same whether or not views (with bed positions) were built
    expect(JSON.stringify(a.s.log)).toBe(JSON.stringify(c.s.log));
    expect(JSON.stringify(debrief(a.s))).toBe(JSON.stringify(debrief(c.s)));
  });
});
