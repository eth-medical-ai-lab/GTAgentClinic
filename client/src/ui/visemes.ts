/**
 * Mouth shapes from the words being spoken (no three.js, no audio: pure, and tested).
 *
 * The voices give us sound and its length, not phoneme timing. So a line's letters are read as a row
 * of mouth units (lips shut on p, b, m; teeth on the lip for f and v; rounded for o, u and w; wide for
 * e and i; open for a; a short rest between words, a longer one at a comma or a full stop), each
 * with a relative length, and the row is stretched over the time the line takes to say. That is a
 * guess at the timing, but the lips close where the word has a b and round where it has an o, which
 * is what reads as speech: a random vowel every tenth of a second read as chewing.
 *
 * English spelling rules of thumb, kept loose enough that a German name or phrase comes out sane.
 * The shapes are the eight viseme blendshapes the avatars keep (scripts/assets/convert-rocketbox.mjs).
 */
export type MouthShape = 'PP' | 'FF' | 'SS' | 'aa' | 'E' | 'I' | 'O' | 'U';

/** the mouth at one moment: a viseme and how strongly, and how far the jaw is down (0..1; 'aa' is 0.5) */
export interface Mouth {
  shape: MouthShape | null;
  weight: number;
  jaw: number;
}

/** a mouth unit and where it starts (0..1 of the line) */
export interface MouthKey extends Mouth {
  t: number;
}

interface Unit {
  /** 'near': made at the back of the mouth (k, g, h): the lips keep the neighbouring vowel's shape */
  shape: MouthShape | 'near' | null;
  weight: number;
  jaw: number;
  /** relative length (a short vowel = 1) */
  dur: number;
  vowel?: boolean;
}

const REST: Mouth = { shape: null, weight: 0, jaw: 0 };
const v = (shape: MouthShape, jaw: number, dur = 1): Unit => ({ shape, weight: 0.75, jaw, dur, vowel: true });
const c = (shape: Unit['shape'], weight: number, jaw: number, dur: number): Unit => ({ shape, weight, jaw, dur });

const LIPS = c('PP', 0.9, 0, 0.7);
const LIP_TEETH = c('FF', 0.8, 0.05, 0.7);
const HISS = c('SS', 0.7, 0.05, 0.75);
/** t, d, n, l, th: the tongue does the work, the teeth just part */
const TONGUE = c('SS', 0.35, 0.1, 0.55);
const ROUND = c('U', 0.7, 0.08, 0.6);
const BACK = c('near', 0.4, 0.14, 0.5);

const E_I = [v('E', 0.35, 0.8), v('I', 0.2, 0.6)];
const A_U = [v('aa', 0.45, 0.8), v('U', 0.2, 0.7)];
const O_I = [v('O', 0.4, 0.8), v('I', 0.2, 0.6)];
const LONG_I = [v('I', 0.2, 1.3)];

/** longest match first: three letters, then two, then one */
const SOUNDS: Record<string, Unit[]> = {
  sch: [HISS],
  tch: [HISS],
  th: [TONGUE],
  sh: [HISS],
  ch: [HISS],
  ph: [LIP_TEETH],
  wh: [ROUND],
  ck: [BACK],
  ng: [BACK],
  qu: [BACK, ROUND],
  ee: LONG_I,
  ea: LONG_I,
  ie: LONG_I,
  oo: [v('U', 0.2, 1.3)],
  ou: A_U,
  ow: A_U,
  ai: E_I,
  ay: E_I,
  ei: E_I,
  ey: E_I,
  oi: O_I,
  oy: O_I,
  eu: O_I,
  au: [v('O', 0.45, 1.2)],
  aw: [v('O', 0.45, 1.2)],
  a: [v('aa', 0.5)],
  e: [v('E', 0.3)],
  i: [v('I', 0.2)],
  o: [v('O', 0.4)],
  u: [v('U', 0.2)],
  y: [v('I', 0.2)],
  ä: [v('E', 0.35)],
  ö: [v('O', 0.3)],
  ü: [v('U', 0.2)],
  p: [LIPS],
  b: [LIPS],
  m: [LIPS],
  f: [LIP_TEETH],
  v: [LIP_TEETH],
  w: [ROUND],
  s: [HISS],
  z: [HISS],
  x: [BACK, HISS],
  j: [HISS],
  ß: [HISS],
  t: [TONGUE],
  d: [TONGUE],
  n: [TONGUE],
  l: [TONGUE],
  r: [c('U', 0.25, 0.12, 0.5)],
  k: [BACK],
  g: [BACK],
  q: [BACK],
  h: [BACK],
};
const VOWELS = 'aeiouyäöü';
const LETTER = /\p{L}/u;
const pause = (dur: number): Unit => ({ shape: null, weight: 0, jaw: 0, dur });

/** a line's letters as mouth units */
function units(text: string): Unit[] {
  const s = text.toLowerCase();
  const out: Unit[] = [];
  /** a rest between words or at punctuation: one per gap, as long as its longest mark asks */
  const rest = (dur: number) => {
    const last = out[out.length - 1];
    if (!last) return;
    if (last.shape === null && !last.vowel) last.dur = Math.max(last.dur, dur);
    else out.push(pause(dur));
  };
  let wordStart = 0;
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    if (!LETTER.test(ch)) {
      if (/\d/.test(ch)) out.push(TONGUE, v('E', 0.3)); // a digit is a word of its own: about two sounds
      else if (/\s/.test(ch)) rest(0.35);
      else if (/[,;:–—-]/.test(ch)) rest(/[-]/.test(ch) ? 0.35 : 1.6);
      else if (/[.!?…]/.test(ch)) rest(2.4);
      i++;
      wordStart = i;
      continue;
    }
    // a doubled consonant is one sound
    if (i > wordStart && ch === s[i - 1] && !VOWELS.includes(ch)) {
      i++;
      continue;
    }
    const end = i + 1 >= s.length || !LETTER.test(s[i + 1]);
    // a silent e at the end of a word (made, home): only after a consonant, and not the word's only vowel
    if (ch === 'e' && end && i - wordStart >= 2 && !VOWELS.includes(s[i - 1]) && [...s.slice(wordStart, i)].some((x) => VOWELS.includes(x))) {
      i++;
      continue;
    }
    // c is an s before e, i and y (city), else a k
    if (ch === 'c' && s[i + 1] !== 'h' && s[i + 1] !== 'k') {
      out.push('eiy'.includes(s[i + 1] ?? '') ? HISS : BACK);
      i++;
      continue;
    }
    const hit = [3, 2, 1].map((n) => s.slice(i, i + n)).find((k) => SOUNDS[k]);
    if (hit) out.push(...SOUNDS[hit]);
    i += hit ? hit.length : 1;
  }
  while (out.length && out[out.length - 1].shape === null) out.pop();
  return out;
}

const cache = new Map<string, MouthKey[]>();

/** the mouth units of a line, each with where it starts (0..1 of the time the line takes) */
export function visemeTimeline(text: string): MouthKey[] {
  const hit = cache.get(text);
  if (hit) return hit;
  const list = units(text);
  const total = list.reduce((sum, u) => sum + u.dur, 0) || 1;
  const keys: MouthKey[] = [];
  let at = 0;
  for (const [i, u] of list.entries()) {
    let shape: MouthShape | null = u.shape === 'near' ? null : u.shape;
    if (u.shape === 'near') {
      // the vowel after it in the same word, else the one before
      for (let k = i + 1; k < list.length && list[k].shape !== null && !shape; k++) if (list[k].vowel) shape = list[k].shape as MouthShape;
      for (let k = i - 1; k >= 0 && list[k].shape !== null && !shape; k--) if (list[k].vowel) shape = list[k].shape as MouthShape;
    }
    keys.push({ t: at / total, shape, weight: shape ? u.weight : 0, jaw: u.jaw });
    at += u.dur;
  }
  if (cache.size > 200) cache.clear();
  cache.set(text, keys);
  return keys;
}

/** the mouth at progress p (0..1) through a line; at rest outside it */
export function mouthAt(keys: MouthKey[], p: number): Mouth {
  if (!keys.length || p < 0 || p >= 1) return REST;
  let lo = 0;
  let hi = keys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (keys[mid].t <= p) lo = mid;
    else hi = mid - 1;
  }
  return keys[lo];
}
