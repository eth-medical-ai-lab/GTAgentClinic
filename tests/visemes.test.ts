/**
 * Mouth shapes from words (client/src/ui/visemes.ts): the lips close where a word has a b, p or m,
 * round on o, u and w, and rest between sentences; the row of shapes spans the whole line.
 */
import { describe, expect, it } from 'vitest';
import { mouthAt, visemeTimeline } from '../client/src/ui/visemes';

const shapes = (text: string) => visemeTimeline(text).map((k) => k.shape ?? '_');

describe('visemeTimeline', () => {
  it('reads letters as mouth shapes', () => {
    expect(shapes('map')).toEqual(['PP', 'aa', 'PP']);
    expect(shapes('fever')).toEqual(['FF', 'E', 'FF', 'E', 'U']);
    expect(shapes('who')).toEqual(['U', 'O']);
  });

  it('closes the lips fully on b, p and m, with the jaw up', () => {
    for (const k of visemeTimeline('baby mama pop').filter((x) => x.shape === 'PP')) {
      expect(k.weight).toBeGreaterThan(0.8);
      expect(k.jaw).toBe(0);
    }
  });

  it('drops a silent final e and doubled consonants', () => {
    expect(shapes('home')).toEqual(['O', 'O', 'PP']);
    expect(shapes('better')).toEqual(shapes('beter'));
    // but not the only vowel of a short word
    expect(shapes('me')).toEqual(['PP', 'E']);
  });

  it('gives k, g and h the lips of the vowel next to them', () => {
    expect(shapes('go')).toEqual(['O', 'O']);
    expect(shapes('key')[0]).toBe('E');
  });

  it('rests between words, longer at a full stop than at a space', () => {
    const keys = visemeTimeline('No. No no');
    const rests = keys.map((k, i) => (k.shape === null ? keys[i + 1].t - k.t : 0)).filter((d) => d > 0);
    expect(rests).toHaveLength(2);
    expect(rests[0]).toBeGreaterThan(rests[1] * 3);
  });

  it('spans the line: starts at 0, ordered, ends on a sound', () => {
    const keys = visemeTimeline('It burns when I pass water, and I feel so weak...');
    expect(keys[0].t).toBe(0);
    for (let i = 1; i < keys.length; i++) expect(keys[i].t).toBeGreaterThan(keys[i - 1].t);
    expect(keys[keys.length - 1].shape).not.toBeNull();
    expect(keys[keys.length - 1].t).toBeLessThan(1);
  });

  it('handles digits, names from other languages and empty text', () => {
    expect(shapes('1987').length).toBe(8);
    expect(shapes('Müller')).toEqual(['PP', 'U', 'SS', 'E', 'U']);
    expect(visemeTimeline('')).toEqual([]);
    expect(visemeTimeline('…?!')).toEqual([]);
  });
});

describe('mouthAt', () => {
  it('returns the shape in force at a moment, and rest outside the line', () => {
    const keys = visemeTimeline('map');
    expect(mouthAt(keys, 0).shape).toBe('PP');
    expect(mouthAt(keys, 0.5).shape).toBe('aa');
    expect(mouthAt(keys, 0.99).shape).toBe('PP');
    expect(mouthAt(keys, 1).shape).toBeNull();
    expect(mouthAt(keys, -0.1).shape).toBeNull();
    expect(mouthAt([], 0.5).jaw).toBe(0);
  });
});
