import type { CaseBrief } from './brief';
import type { EffectDef } from '../types';
import { digestive } from './ambulatory/digestive';
import { pelvic } from './ambulatory/pelvic';
import { injuries } from './ambulatory/injuries';
import { skin } from './ambulatory/skin';
import { cardiorespiratory } from './ambulatory/cardiorespiratory';

// Preserve the individual authoring module on each compiled record.
const packs: Record<string, CaseBrief[]> = { digestive, pelvic, injuries, skin, cardiorespiratory };
function symptomRelief(c: CaseBrief): EffectDef[] {
  const effects: EffectDef[] = [...(c.physiology?.effects ?? [])];
  if ((c.vitals?.pain ?? 0) > 0) {
    effects.push(
      { tag: 'analgesic_mild', tauMin: 20, durationMin: 180, maxUnits: 1, delta: { pain: -2 } },
      { tag: 'analgesic', tauMin: 6, durationMin: 100, maxUnits: 1, delta: { pain: -3 } },
    );
  }
  if ((c.vitals?.temp ?? 0) >= 38 && !effects.some(e => e.tag === 'antipyretic')) {
    effects.push({ tag: 'antipyretic', tauMin: 18, durationMin: 180, maxUnits: 1, delta: { temp: -0.7 } });
  }
  return effects;
}
export const ambulatory: CaseBrief[] = Object.entries(packs).flatMap(([module, cases]) =>
  cases.map(c => ({ ...c, file: `content/cases/ambulatory/${module}.ts`,
    physiology: { ...c.physiology, effects: symptomRelief(c) } })));
