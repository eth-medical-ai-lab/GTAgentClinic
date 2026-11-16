/** ECG interpretation grading: negations only count against the case's own key findings. */
import { describe, expect, it } from 'vitest';
import { ecgReadCorrect } from '../server/sim/session';

const AF = ['atrial fib', 'afib', 'a-fib', 'a fib', 'af ', 'af,', 'rvr', 'rapid ventricular', 'irregularly irregular'];
const STEMI = ['stemi', 'st elevation', 'st-elevation', 'inferior mi'];
const SEPSIS_SINUS = ['sinus tach', 'sinus tachycardia', 'nonspecific', 'no stemi', 'no acute st'];

describe('ecgReadCorrect', () => {
  it('a correct AF read that also rules out ST elevation is correct', () => {
    expect(ecgReadCorrect('Atrial fibrillation with RVR, no ST elevation', AF)).toBe(true);
  });
  it('negating the key finding is wrong', () => {
    expect(ecgReadCorrect('Sinus rhythm, no atrial fibrillation', AF)).toBe(false);
    expect(ecgReadCorrect('No ST elevation, early repolarization', STEMI)).toBe(false);
  });
  it('a STEMI read that mentions "no AF" is still correct', () => {
    expect(ecgReadCorrect('Inferior STEMI with reciprocal changes, no AF', STEMI)).toBe(true);
  });
  it('"no STEMI" can itself be the expected finding', () => {
    expect(ecgReadCorrect('Sinus tachycardia, nonspecific ST changes, no STEMI', SEPSIS_SINUS)).toBe(true);
  });
});
