/**
 * The spoken form of an NPC line. Shared by server-side Kokoro synthesis and the browser fallback.
 *
 *  - drops stage directions (*sighs*, [pause], (coughs)), emoji and markdown
 *  - rewrites clinical shorthand that speech engines misread: Kokoro's eSpeak front end says
 *    "IV" as "roman four", "94/56" as "ninety-four slash…", "x4410" as "four thousand…",
 *    turns "555-0163" into a range ("…to…"), and reads OR/AKI/COPD/ESBL/KUB as words
 *  - splits into sentence chunks (the first one short) so audio can start quickly
 *
 * The chat panel always shows the original text; only the audio uses this.
 */

const STAGE_PAREN =
  /\(\s*(?:sigh|cough|wince|groan|laugh|chuckl|paus|gasp|moan|mumbl|whisper|sniff|hesitat|shrug|nod|cry|cries|crying|sob|yawn|grimac|mutter|smil|frown|inhal|exhal|swallow|clears?\s+(?:his|her|their)\s+throat|beat\b|silence|static|beep|hold music|typing|long pause)[^()]{0,48}\)/gi;

/** all-caps initialisms read letter by letter (hyphenated letters give eSpeak/Kokoro clean letter names) */
const SPELL = [
  'ABG', 'AF', 'AKI', 'BMP', 'BP', 'CBC', 'CHF', 'CKD', 'CMP', 'COPD', 'CPR', 'CT', 'CVA', 'CXR', 'DNI', 'DNR', 'DOB', 'DVT',
  'ECG', 'ED', 'EF', 'EHR', 'EKG', 'EMS', 'ENT', 'ER', 'ESBL', 'ESI', 'ETA', 'GCS', 'GI', 'GP', 'GU', 'HR', 'HTN', 'ICU', 'ID', 'IM',
  'INR', 'IV', 'IVF', 'KUB', 'LFT', 'LP', 'LR', 'LV', 'MAR', 'MI', 'MRI', 'MRN', 'NG', 'NPO', 'NS', 'OB', 'OR', 'PCP', 'PE',
  'PO', 'POC', 'PRN', 'PTT', 'RLQ', 'ROSC', 'RR', 'RV', 'RVR', 'SVT', 'TIA', 'TSH', 'UA', 'UTI', 'VBG', 'VF', 'VT',
];
const SPELL_RE = new RegExp(`\\b(${SPELL.join('|')})(s?)\\b`, 'g');

/** a few authored Swiss-German words, respelled so an English front end gets close */
const RESPELL: [RegExp, string][] = [
  [/\bGrüezi\b/g, 'Gruetsi'],
  [/\b[Ww]o bin ich\b/g, 'Vo bin ish'],
  [/\b([Ee])s brennt\b/g, '$1ss brennt'],
  [/(^|[.!?…]\s+)Was\?/g, '$1Vas?'],
];

const UNIT_WORDS: Record<string, string> = {
  mcg: 'micrograms',
  µg: 'micrograms',
  μg: 'micrograms',
  mg: 'milligrams',
  ml: 'milliliters',
  kg: 'kilos',
  g: 'grams',
  L: 'liters',
  min: 'minutes',
  hr: 'hours',
  hrs: 'hours',
  h: 'hours',
};

const spellOut = (s: string) =>
  s
    .split('-')
    .map((g) => g.split('').join(' '))
    .join(', ');

function stripNonSpeech(text: string): string {
  return (
    text
      // **bold** keeps its words; *single* asterisks are stage directions by prompt contract
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/\*[^*\n]{0,200}\*/g, ' ')
      .replace(/\*/g, ' ')
      .replace(/\[[^\]\n]{0,240}\]/g, ' ')
      .replace(STAGE_PAREN, ' ')
      .replace(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu, ' ')
      .replace(/[#_`|]+/g, ' ')
  );
}

function normalizeClinical(text: string): string {
  let t = text;
  for (const [re, to] of RESPELL) t = t.replace(re, to);
  t = t
    // lab units are not read aloud ("creatinine two point one")
    .replace(/\s?(?:mg\/dL|mmol\/L|[µμ]mol\/L|g\/dL|mmHg|m?Eq\/L|I?U\/L|ng\/mL|ng\/L|pg\/mL|x\s?10\^?9\/L|(?:K|cells)?\/[µμ]L)(?![\w/])/g, '')
    .replace(/\/kg\b/g, ' per kilo')
    .replace(/\/min\b/g, ' per minute')
    .replace(/\/(?:hr|h)\b/g, ' per hour')
    // dosing intervals: q8h → "every 8 hours", q15min → "every 15 minutes"
    .replace(/\bq(\d+)\s?(?:h|hr|hrs|hours?)\b/g, (_, n: string) => `every ${n} ${n === '1' ? 'hour' : 'hours'}`)
    .replace(/\bq(\d+)\s?min\b/g, (_, n: string) => `every ${n} minutes`)
    .replace(/(?<![\w.])(\d+(?:\.\d+)?)\s?(mcg|[µμ]g|mg|m[lL]|kg|g|L|min|hrs?|h)\b/g, (_, n: string, u: string) => {
      const word = UNIT_WORDS[u] ?? UNIT_WORDS[u.toLowerCase()];
      return word ? `${n} ${n === '1' ? word.replace(/s$/, '') : word}` : `${n} ${u}`;
    })
    .replace(/(\d)\s?°\s?[CF]\b/g, '$1 degrees')
    // blood pressure 94/56 → "94 over 56" (not dates like 12/14/2026)
    .replace(/(?<![\d/])(\d{2,3})\/(\d{2,3})(?![\d/])/g, '$1 over $2')
    // phone extension x4410, phone numbers, member/reference codes: digit by digit
    .replace(/\bx(\d{3,5})\b/g, (_, d: string) => `extension ${d.split('').join(' ')}`)
    .replace(/\b911\b/g, '9 1 1')
    .replace(/\b(?:1-)?(?:\d{3}-)?\d{3}-\d{4}\b/g, spellOut)
    .replace(/\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9]{1,6}(?:-[A-Z0-9]{1,8}){1,4}\b/g, (m) =>
      /\d{3}|[A-Z]\d|\d[A-Z]/.test(m) ? spellOut(m) : m,
    )
    .replace(SPELL_RE, (_, abbr: string, plural: string) => abbr.split('').join('-') + plural)
    .replace(/\bACE\b/g, 'ace')
    .replace(/\bw\/o\b/gi, 'without')
    .replace(/\bw\/(?=\s|\w)/gi, 'with ')
    .replace(/\bvs\.?(?=\s)/gi, 'versus')
    .replace(/\be\.g\.(?=\s|,)/gi, 'for example')
    .replace(/\bi\.e\.(?=\s|,)/gi, 'that is')
    .replace(/\bapprox\.(?=\s)/gi, 'about')
    .replace(/~\s?(?=\d)/g, 'about ')
    .replace(/\s?(?:->|→)\s?/g, ', then ')
    .replace(/&/g, ' and ')
    .replace(/[~^<>]+/g, ' ');
  return t;
}

/** The text an engine should actually say ('' = nothing speakable, e.g. "*coughs*"). */
export function speechText(text: string): string {
  const t = normalizeClinical(stripNonSpeech(text))
    .replace(/\s+([,.!?;:…])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  // nothing left but punctuation?
  return /[\p{L}\p{N}]/u.test(t) ? t.replace(/^[,;:.\s]+/, '') : '';
}

const ABBREV = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'sr', 'jr', 'vs', 'etc', 'approx', 'no', 'vol', 'fig', 'dept', 'inc', 'co', 'mt', 'lt', 'sgt', 'capt']);

/** Sentence boundaries that survive "Dr. Shaw", "E. coli", "38.7", "approx. five" and "I... I don't know". */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /([.!?…]+)(["'”’)\]]*)(\s+|$)/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const end = m.index + m[1].length + m[2].length;
    const next = text.charAt(re.lastIndex);
    if (next) {
      const lastWord = /(\S+)$/.exec(text.slice(start, m.index))?.[1] ?? '';
      if (m[1] === '.' && ABBREV.has(lastWord.toLowerCase().replace(/^[("'“]+/, ''))) continue;
      if (m[1] === '.' && /^[A-Z]$/.test(lastWord)) continue;
      if (/\p{Ll}/u.test(next)) continue;
    }
    const s = text.slice(start, end).trim();
    if (s) out.push(s);
    start = re.lastIndex;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** break a very long sentence at a clause boundary (Kokoro truncates beyond ~510 phonemes) */
function splitLong(s: string, max: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' — '), window.lastIndexOf(' – '), window.lastIndexOf(': '));
    if (cut < max * 0.3) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Chunks for synthesis: the first is a single short sentence (fast first audio), later ones may
 * merge sentences with a growing budget so synthesis stays ahead of playback.
 */
export function splitSpeech(text: string, firstMax = 80, max = 240, hardMax = 280): string[] {
  const chunks: string[] = [];
  for (const sentence of splitSentences(text)) {
    for (const s of splitLong(sentence, hardMax)) {
      const i = chunks.length - 1;
      const budget = Math.min(max, firstMax * 2 ** Math.max(0, i));
      if (i >= 0 && chunks[i].length + 1 + s.length <= budget) chunks[i] += ' ' + s;
      else chunks.push(s);
    }
  }
  return chunks;
}

/** speechText + splitSpeech */
export function speechChunks(text: string): string[] {
  const t = speechText(text);
  return t ? splitSpeech(t) : [];
}
