/** Diagnosis synonyms match whole words/phrases (with simple inflections), never inside other words. */
import { describe, expect, it } from 'vitest';
import { hasTerm } from '../server/sim/scoring';

const n = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ')} `;

describe('diagnosis synonym matching', () => {
  it.each([
    ['family history of cad', 'ami', false],
    ['dynamic ecg changes', 'ami', false],
    ['taking metformin', 'aki', false],
    ['routine labs', 'uti', false],
    ['nstemi', 'stemi', false],
    ['inferior ami', 'ami', true],
    ['aki on ckd', 'aki', true],
    ['inferior st-elevation mi', 'st elevation', true],
    ['right sprained ankle', 'sprain', true],
    ['a fib with rvr', 'a-fib', true],
    ['acute coronary syndromes', 'acute coronary syndrome', true],
  ] as const)('%s ~ %s → %s', (text, term, want) => {
    expect(hasTerm(n(text), term)).toBe(want);
  });
});
