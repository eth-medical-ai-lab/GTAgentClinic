/** Belongings at the bedside: same `inspect` action for humans and agents, facts count as history. */
import { describe, expect, it } from 'vitest';
import { NpcBrain } from '../server/npc/brain';
import { patientSituation } from '../server/npc/dialogue';
import { observationText } from '../server/sim/agentText';
import { GameSession } from '../server/sim/session';
import { buildView } from '../server/sim/views';

const brain = new NpcBrain(null);
const session = () => new GameSession({ scenarioId: 'night_shift', seed: 7, playerName: 'Test', mode: 'step', brain });

describe('inspect belongings', () => {
  it("finds the sildenafil in Keller's medication bag (brought by his wife) and credits the statin history", async () => {
    const s = session();
    await s.act({ type: 'wait', minutes: 14 }); // Keller arrives at +12 min
    const keller = s.patients.get('p_keller')!;
    // the bag comes with his wife: wait for her if she isn't there yet
    for (let i = 0; i < 12 && keller.family?.status !== 'present'; i++) await s.act({ type: 'wait', minutes: 5 });
    expect(keller.family?.status).toBe('present');
    expect(buildView(s, brain.status).items?.map((i) => i.id)).toContain('keller_medbag');

    // step mode: you have to be in the bay
    const far = await s.act({ type: 'inspect', itemId: 'keller_medbag' });
    expect(far.ok).toBe(false);

    await s.act({ type: 'move', to: 'bed_2' });
    expect(observationText(s)).toContain('itemId: keller_medbag');
    const r = await s.act({ type: 'inspect', itemId: 'keller_medbag' });
    expect(r.ok).toBe(true);
    expect(r.text).toMatch(/SILDENAFIL/);
    expect(keller.revealed.has('meds')).toBe(true);
    // the bag shows he uses sildenafil, not when he last took it: that still has to be asked
    expect(keller.revealed.has('pde5')).toBe(false);
    expect(buildView(s, brain.status).items?.find((i) => i.id === 'keller_medbag')?.inspected).toBe(true);
  });

  it("hands Mrs. Brunner her handbag back: she has it in bed, says thank you and knows it", async () => {
    const s = session();
    const lines: string[] = [];
    s.on((e) => {
      if (e.kind === 'speech' && e.npcId === 'pt_p_brunner') lines.push(e.text);
    });
    await s.act({ type: 'wait', minutes: 6 }); // she arrives at +4 min
    const brunner = s.patients.get('p_brunner')!;
    expect(buildView(s, brain.status).items?.find((i) => i.id === 'brunner_handbag')?.given).toBe(false);
    // step mode: you have to be in the bay
    expect((await s.act({ type: 'give_item', itemId: 'brunner_handbag' })).ok).toBe(false);
    await s.act({ type: 'move', to: 'bed_4' });
    const r = await s.act({ type: 'give_item', itemId: 'brunner_handbag' });
    expect(r.ok).toBe(true);
    expect(r.costMin ?? 0).toBe(0);
    expect(brunner.given.has('brunner_handbag')).toBe(true);
    expect(buildView(s, brain.status).items?.find((i) => i.id === 'brunner_handbag')?.given).toBe(true);
    expect(observationText(s)).toMatch(/handbag \(EMS brought it along\) with the patient, in bed/);
    expect(patientSituation(s, brunner)).toMatch(/handed you your handbag/);
    // awake enough to say so, once
    expect(lines.join(' ')).toMatch(/My handbag/);
    expect((await s.act({ type: 'give_item', itemId: 'brunner_handbag' })).message).toMatch(/already has it/);
    expect(lines).toHaveLength(1);
    // handing it back is not looking inside: the GP letter is still unread
    expect(brunner.revealed.has('gp_esbl')).toBe(false);
    expect((await s.act({ type: 'give_item', itemId: 'nope' })).ok).toBe(false);
  });

  it('unknown items and items of absent patients are refused', async () => {
    const s = session();
    expect((await s.act({ type: 'inspect', itemId: 'nope' })).ok).toBe(false);
    // Kellner (AF) only arrives at +30 min
    expect((await s.act({ type: 'inspect', itemId: 'kellner_bottle' })).ok).toBe(false);
  });
});
