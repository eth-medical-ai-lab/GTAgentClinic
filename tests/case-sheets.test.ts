/**
 * docs/cases/ is generated from the case data by scripts/case-sheets.ts, so it cannot drift from
 * the code. If the first test fails, run `npm run cases` and commit the regenerated sheets.
 */
import { describe, expect, it } from 'vitest';
import { CASES } from '../content/scenarios';
import type { CaseDef, Rule } from '../content/types';
import { checkCaseSheets, describeRule, renderAll, renderCaseSheet } from '../scripts/case-sheets';

describe('case sheets (docs/cases)', () => {
  it('are up to date with content/ (run `npm run cases` if this fails)', () => {
    expect(checkCaseSheets()).toEqual([]);
  });

  it('cover every case plus the maps and the index, deterministically', () => {
    const a = renderAll();
    const b = renderAll();
    expect([...a.keys()].sort()).toEqual([...Object.keys(CASES).map((id) => `${id}.md`), 'README.md', 'maps.md'].sort());
    for (const [file, md] of a) expect(md, file).toBe(b.get(file));
    expect([...a.values()].join('\n')).not.toMatch(/\d{4}-\d\d-\d\dT\d\d:\d\d/); // no timestamps
  });

  it('describe rule DSL objects as readable text', () => {
    expect(describeRule({ type: 'before', first: { type: 'collected', codes: ['bcx'] }, then: { type: 'given', tags: ['abx'], withinMin: 60 } })).toBe(
      'collected `bcx` BEFORE given `abx` (any antibiotic) within 60 min of arrival',
    );
    expect(describeRule({ type: 'any', rules: [{ type: 'order', codes: ['ct_abd_iv', 'us_appendix'] }, { type: 'exam', maneuvers: ['abd_mcburney', 'abd_rovsing', 'abd_psoas'], min: 2 }] })).toBe(
      'order `ct_abd_iv` or `us_appendix` OR examined ≥ 2 of `abd_mcburney`, `abd_rovsing`, `abd_psoas`',
    );
    expect(describeRule({ type: 'if', cond: { type: 'flag', flag: 'septic_shock' }, then: { type: 'consult', contactId: 'icu', withinMin: 90 } })).toBe(
      'if flag `septic_shock`: `icu` accepts within 90 min of arrival (otherwise not scored)',
    );
    expect(describeRule({ type: 'flag', flag: '__never__' })).toMatch(/^never/);
    expect(describeRule({ type: 'timer', minutes: 5 } as unknown as Rule)).toContain('timer');
  });

  it('render belongings and unknown future fields instead of crashing', () => {
    const base = structuredClone(CASES.ankle_sprain);
    const c = {
      ...base,
      items: [{ id: 'wallet_x', kind: 'wallet', label: 'Wallet', where: 'chair', text: 'Gym membership card.', facts: ['do_prior', 'no_such_fact'], weightG: 120 }],
      futureField: { severity: 'high', tags: ['a', 'b'] },
      persona: { ...base.persona, mood: 'cheerful' },
    } as unknown as CaseDef;
    const md = renderCaseSheet(c);
    expect(md).toContain('### Belongings / inspectable items');
    expect(md).toContain('Gym membership card.');
    expect(md).toContain('weightG');
    expect(md).toContain('futureField');
    expect(md).toContain('mood');
    expect(md).toMatch(/unknown fact `no_such_fact`/);
  });
});
