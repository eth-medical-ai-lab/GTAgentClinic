import { describe, expect, it } from 'vitest';
import { NpcBrain } from '../server/npc/brain';
import { caseDebrief } from '../server/sim/scoring';
import { GameSession, M } from '../server/sim/session';
import { practiceId } from '../server/sim/shiftRoster';
import { UNAVAILABLE_RESULT } from '../shared/units';

function practice(id: string) {
  const s = new GameSession({ scenarioId: practiceId(id), mode: 'step', playerName: 'Resident', brain: new NpcBrain(null), seed: 32 });
  return { s, p: s.presentPatients()[0] };
}

describe('case bank bedside care', () => {
  it('treats anaphylactic shock through the ordinary medication queue', async () => {
    const id = 'pmc-PMC13539018-tirzepatide-biphasic-anaphylaxis';
    const untreated = practice(id);
    untreated.s.advance(45 * M);
    const { s, p } = practice(id);
    s.placeOrder(p.id, 'epi_im', undefined, 'STAT', 'You');
    s.placeOrder(p.id, 'lr_bolus', undefined, 'STAT', 'You');
    s.advance(45 * M);
    expect(p.physio.value('sbp', 45)).toBeGreaterThan(95);
    expect(untreated.p.physio.value('sbp', 45)).toBeLessThan(80);
    expect(caseDebrief(s, p).items.find(i => i.label === 'Give intramuscular epinephrine')?.ok).toBe(true);
    await s.act({ type: 'escalate', patientId: p.id, mode: 'bedside', reason: 'Airway edema and shock' });
    expect(caseDebrief(s, p).items.find(i => i.label === 'Request attending assistance')?.ok).toBe(true);
  });

  it('returns source blood counts in catalog units and never makes an unreported study look normal', () => {
    const { s, p } = practice('pmc-PMC10332752-immune-ttp-word-finding');
    for (const code of ['cbc','blood_film','xr_chest','tsh']) s.placeOrder(p.id,code,undefined,'STAT','You');
    s.advance(120 * M);
    expect(p.labs.find(l => l.analyte === 'plt')?.value).toBe(10);
    expect(p.labs.find(l => l.analyte === 'smear')?.value).toMatch(/schistocytes/i);
    expect(p.labs.find(l => l.analyte === 'tsh')?.value).toBe(UNAVAILABLE_RESULT);
    expect(p.imaging.find(i => i.code === 'xr_chest')?.impression).toBe('Unavailable.');
  });

  it('shows glucose recovery on repeat bedside measurements after oral carbohydrate', () => {
    const { s, p } = practice('missed_lunch');
    s.placeOrder(p.id,'glu_poc',undefined,'STAT','You');
    s.advance(12 * M);
    expect(p.labs.find(l => l.analyte === 'glu_poc')?.value).toBe(52);
    s.placeOrder(p.id,'oral_glucose',undefined,'STAT','You');
    s.advance(30 * M);
    s.placeOrder(p.id,'glu_poc',undefined,'STAT','You');
    s.advance(12 * M);
    expect(p.labs.filter(l => l.analyte === 'glu_poc').at(-1)?.value).toBeGreaterThan(75);
  });

  it('holds CT after unavailable serum hCG, then releases it after the urine screen results', () => {
    const { s, p } = practice('pmc-PMC9197740-vertebral-dissection-massage-gun');
    s.placeOrder(p.id, 'hcg_q', undefined, 'STAT', 'You');
    s.placeOrder(p.id, 'cta_head_neck', undefined, 'STAT', 'You');
    s.advance(90 * M);
    expect(p.labs.find(l => l.analyte === 'hcg_q')?.value).toBe(UNAVAILABLE_RESULT);
    const scan = p.imaging.find(i => i.code === 'cta_head_neck')!;
    expect(scan.status).toBe('Scheduled');
    expect(p.orders.find(o => o.id === scan.orderId)?.statusText).toMatch(/on hold/i);

    s.placeOrder(p.id, 'hcg_u', undefined, 'STAT', 'You');
    s.advance(90 * M);
    const screen = p.labs.find(l => l.analyte === 'hcg_u')!;
    expect(screen.value).toBe('Negative');
    expect(scan.status).toBe('Final');
    expect(scan.performedAt).toBeGreaterThan(screen.resultedAt);
  });
});
