import type { CaseDef } from '../types';
import { afibRvr } from './afib_rvr';
import { ankleSprain } from './ankle_sprain';
import { appendicitis } from './appendicitis';
import { stemiInferior } from './stemi_inferior';
import { urosepsis } from './urosepsis';
import { compileBrief, type CaseBrief } from './brief';
import { codexAuthor } from './provenance';
import { adaptations } from './reports';
import { acute, completeAcute } from './acute';
import { completeCardiorespiratory } from './ambulatory/cardiorespiratory';
import { completeDigestive } from './ambulatory/digestive';
import { completeInjuries } from './ambulatory/injuries';
import { completeSkin } from './ambulatory/skin';
import { completePelvic } from './ambulatory/pelvic';
import { ambulatory } from './ambulatory';
import { collateral } from './collateral';

function original(b: CaseBrief, file: string): CaseDef {
  const c = compileBrief(b, { kind: 'original', author: codexAuthor, file: b.file ?? file, review: 'unreviewed',
    method: 'AI-authored fictional adult encounter. Clinical clues, dialogue, test results, scoring and simulated course were written for this game.' });
  completeAcute(c);
  completeCardiorespiratory(c);
  completeDigestive(c);
  completeInjuries(c);
  completeSkin(c);
  completePelvic(c);
  // A receiving team can accept an assessed patient before the ED workup is complete.
  // Preserve that existing handoff route; completion of care is evaluated by case scoring.
  const firstExam = Object.keys(c.exam)[0];
  if (firstExam) for (const consult of c.consults) {
    if (consult.guard) consult.guard = { type: 'any', rules: [consult.guard, { type: 'exam', maneuvers: [firstExam] }] };
  }
  return c;
}

const roster = [stemiInferior, urosepsis, afibRvr, appendicitis, ankleSprain,
  ...acute.map(b => original(b, 'content/cases/acute.ts')),
  ...ambulatory.map(b => original(b, 'content/cases/ambulatory.ts')), ...collateral, ...adaptations()];

export const CASES: Record<string, CaseDef> = Object.create(null);
for (const c of roster) {
  if (CASES[c.id]) throw new Error(`Duplicate playable case id: ${c.id}`);
  CASES[c.id] = c;
}
