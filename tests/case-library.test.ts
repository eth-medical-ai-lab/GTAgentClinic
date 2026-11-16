/**
 * The case library (content/library/*.json, schema in shared/caseLibrary.ts): structure, citation and
 * licence, grounding (every fact is backed by a short source quote in `evidence` or flagged augmented),
 * quiz questions, physiological plausibility, reference-range flags, and up-to-date reviewer sheets.
 *
 * - LIBRARY_ONLY=<id-prefix>[,<id-prefix>] limits the per-case checks to some files (handy while authoring).
 * - When the Europe PMC cache is present (scripts/library/fetch-europepmc.mjs), every evidence quote is also
 *   looked up in the cached source text; without the cache that check is skipped.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_PATHS, LIBRARY_CATEGORIES, LIBRARY_DIR, byCategory, grounding, libraryFiles, loadLibrary, readLibraryCase } from '../content/library';
import { cachePath, formatCaseJson, licenseOf, quoteFound } from '../scripts/library/fetch-europepmc.mjs';
import { checkLibrarySheets } from '../scripts/library/sheets';
import type { LibraryCase, LibraryFinding } from '../shared/caseLibrary';
import { ANALYTES, refRange } from '../shared/catalog';
import { computeFlag } from '../shared/units';

const ONLY = process.env.LIBRARY_ONLY?.split(',').map((s) => s.trim()).filter(Boolean);
const FILES = libraryFiles().filter((f) => !ONLY || ONLY.some((o) => f.startsWith(o)));
const CASES: [string, LibraryCase][] = FILES.map((f) => [f, readLibraryCase(path.join(LIBRARY_DIR, f))]);

const TOP_KEYS = ['id', 'title', 'category', 'acuity', 'source', 'patient', 'presentation', 'vitals', 'exam', 'investigations', 'imaging', 'ecg', 'diagnosis', 'management', 'outcome', 'teachingPoints', 'questions', 'evidence', 'augmented'];
const FINDING_KEYS = ['name', 'value', 'unit', 'flag', 'augmented'];
const QUESTION_KEYS = ['kind', 'q', 'extra', 'options', 'answer', 'explanation'];
const KINDS = ['diagnosis', 'next-step', 'interpretation', 'management', 'risk'];
/** words in a quote; elision marks and table-cell separators do not count */
const words = (s: string) => s.split(/\s+/).filter((w) => w && !['…', '...', '|'].includes(w)).length;
const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;

/** numbers written in a quote ("12,500" → 12500; dashes and slashes split: "170/110" → 170, 110) */
function numbersIn(s: string): number[] {
  return (s.normalize('NFKC').match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? []).map((x) => Number(x.replace(/,/g, '')));
}

/** a finding's numeric value ("7.8", "<0.01", "1,450"), or undefined for text results */
function numericValue(v: string): number | undefined {
  const m = v.trim().match(/^[<>≤≥~]?\s*(\d+(?:,\d{3})*(?:\.\d+)?)$/);
  return m ? Number(m[1].replace(/,/g, '')) : undefined;
}

/** map a finding to a catalog analyte (conventional units) so its flag can be checked against shared/catalog.ts */
function analyteOf(f: LibraryFinding): { code: string; value: number } | undefined {
  const v = numericValue(f.value);
  if (v === undefined || /^[<>≤≥~]/.test(f.value.trim())) return undefined;
  const n = f.name.toLowerCase();
  const u = (f.unit ?? '').toLowerCase().replace(/\s+/g, '').replace(/[μu]/g, 'µ');
  const mmol = u === 'mmol/l' || u === 'meq/l';
  const count = /^(x?10(\^?9|⁹)\/l|x?10(\^?3|³)\/µl|k\/µl|g\/l)$/.test(u.replace('×', 'x')) ? 1 : /^(cells)?\/(µl|mm3|mm³)$/.test(u) ? 0.001 : undefined;
  if (/urine|csf|fluid|ascit|pleural|stool/.test(n)) return undefined;
  if (/^(serum |plasma )?sodium\b|^na\b/.test(n) && mmol) return { code: 'na', value: v };
  if (/^(serum |plasma )?potassium\b|^k\b/.test(n) && mmol) return { code: 'k', value: v };
  if (/^(serum )?chloride\b/.test(n) && mmol) return { code: 'cl', value: v };
  if (/^(serum )?(bicarbonate|hco3|total co2)/.test(n) && mmol) return { code: 'hco3', value: v };
  if (/glucose/.test(n)) return u === 'mg/dl' ? { code: 'glu', value: v } : u === 'mmol/l' ? { code: 'glu', value: v / 0.0555 } : undefined;
  if (/creatinine/.test(n) && !/kinase|clearance/.test(n)) return u === 'mg/dl' ? { code: 'creat', value: v } : u === 'µmol/l' ? { code: 'creat', value: v / 88.4 } : undefined;
  if (/^(blood urea nitrogen|bun)\b/.test(n) && u === 'mg/dl') return { code: 'bun', value: v };
  if (/^urea\b/.test(n)) return u === 'mg/dl' ? { code: 'bun', value: v / 2.14 } : u === 'mmol/l' ? { code: 'bun', value: v * 2.8 } : undefined;
  if (/^(ha?emoglobin|hb|hgb)\b/.test(n) && !/a1c|glycated/.test(n)) return u === 'g/dl' ? { code: 'hgb', value: v } : u === 'g/l' ? { code: 'hgb', value: v / 10 } : undefined;
  if (/^(white (blood )?cell|wbc|leukocyte|leucocyte)/.test(n) && count && u !== 'g/l') return { code: 'wbc', value: v * count };
  if (/^platelet/.test(n) && count && u !== 'g/l') return { code: 'plt', value: v * count };
  if (/^(lactate|lactic acid)\b/.test(n) && u === 'mmol/l') return { code: 'lactate', value: v };
  if (/^(total )?calcium\b/.test(n)) return u === 'mg/dl' ? { code: 'ca', value: v } : u === 'mmol/l' ? { code: 'ca', value: v / 0.2495 } : undefined;
  if (/^(ast|aspartate)/.test(n) && u === 'u/l') return { code: 'ast', value: v };
  if (/^(alt|alanine)/.test(n) && u === 'u/l') return { code: 'alt', value: v };
  if (/^lipase/.test(n) && u === 'u/l') return { code: 'lipase', value: v };
  return undefined;
}

/** expected library flag for a catalog analyte, or "skip" when the value sits within 5% of the range width of a limit */
function expectedFlag(code: string, value: number, sex: 'F' | 'M'): 'H' | 'L' | 'critical' | undefined | 'skip' {
  const a = ANALYTES[code];
  const r = refRange(a, sex);
  const tol = r ? 0.05 * (r[1] - r[0]) : 0;
  const near = (x: number | undefined) => x !== undefined && Math.abs(value - x) <= tol;
  if (r && ((r[0] > 0 && near(r[0])) || near(r[1]) || near(a.critLow) || near(a.critHigh))) return 'skip';
  const f = computeFlag(code, value, sex);
  return f === 'LL' || f === 'HH' ? 'critical' : f === 'L' || f === 'H' ? f : undefined;
}

/** words of the main diagnosis that would give the case away if they appear in the title or the stem */
function spoilerTerm(primary: string): string | undefined {
  const main = primary
    .split(/\s+(?:with|due to|secondary to|from|complicated by|after|in|and|of|on|at|following|triggered by|caused by|induced by|presenting as)\s+|[,;(]/i)[0]
    .toLowerCase()
    .replace(/^((acute|chronic|severe|suspected|massive|ruptured|left|right|bilateral|early|late|atypical|isolated)\s+)+/, '')
    .trim();
  const ws = main.split(/\s+/);
  return ws.length >= 2 ? ws.slice(-2).join(' ') : ws[0] && ws[0].length >= 6 ? ws[0] : undefined;
}

function schemaErrors(file: string, c: LibraryCase): string[] {
  const e: string[] = [];
  const need = (ok: unknown, msg: string) => { if (!ok) e.push(msg); };
  for (const k of Object.keys(c)) need(TOP_KEYS.includes(k), `unknown top-level key "${k}"`);
  need(/^pmc-PMC\d+-[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id), `id "${c.id}" must look like pmc-PMC123-short-slug`);
  need(file === `${c.id}.json`, `file name must be ${c.id}.json`);
  need(c.id.split('-')[1] === c.source?.pmcid, 'id must embed source.pmcid');
  need(nonEmpty(c.title) && c.title.length <= 80, 'title: 1–80 characters');
  need(LIBRARY_CATEGORIES.includes(c.category), `unknown category "${c.category}"`);
  need([1, 2, 3, 4, 5].includes(c.acuity), 'acuity must be ESI 1–5');
  need(typeof c.patient?.age === 'number' && c.patient.age >= 0 && c.patient.age <= 110, 'patient.age 0–110');
  need(c.patient?.sex === 'F' || c.patient?.sex === 'M', 'patient.sex F|M');
  need(c.patient?.ageMonths === undefined || (c.patient.age < 2 && Math.abs(c.patient.age * 12 - c.patient.ageMonths) < 1), 'patient.ageMonths only under 2 years, consistent with age');
  need(c.patient?.age >= 2 || c.patient?.ageMonths !== undefined, 'patients under 2 years need ageMonths');
  need(c.patient?.arrival === undefined || ['walk-in', 'ems', 'transfer'].includes(c.patient.arrival), 'patient.arrival walk-in|ems|transfer');
  const p = c.presentation ?? ({} as LibraryCase['presentation']);
  need(nonEmpty(p.chiefComplaint) && nonEmpty(p.hpi), 'presentation.chiefComplaint and hpi required');
  for (const k of ['pmh', 'meds', 'allergies'] as const) need(Array.isArray(p[k]) && p[k].every(nonEmpty), `presentation.${k} must be an array of strings`);
  for (const k of ['social', 'family'] as const) need(p[k] === undefined || nonEmpty(p[k]), `presentation.${k} must be a non-empty string if present`);
  for (const k of ['hr', 'sbp', 'dbp', 'rr', 'spo2', 'tempC'] as const) need(typeof c.vitals?.[k] === 'number', `vitals.${k} required`);
  need(Array.isArray(c.exam) && c.exam.length >= 2 && c.exam.every(nonEmpty), 'exam: at least 2 findings');
  need(Array.isArray(c.investigations) && c.investigations.length >= 1, 'investigations: at least 1');
  for (const [i, f] of (c.investigations ?? []).entries()) {
    for (const k of Object.keys(f)) need(FINDING_KEYS.includes(k), `investigations[${i}]: unknown key "${k}"`);
    need(nonEmpty(f.name) && nonEmpty(f.value), `investigations[${i}]: name and value required`);
    need(f.flag === undefined || ['H', 'L', 'critical'].includes(f.flag), `investigations[${i}]: flag H|L|critical`);
    need(f.augmented === undefined || typeof f.augmented === 'boolean', `investigations[${i}]: augmented must be boolean`);
  }
  for (const [i, im] of (c.imaging ?? []).entries()) need(nonEmpty(im.modality) && nonEmpty(im.finding) && Object.keys(im).every((k) => ['modality', 'finding', 'augmented'].includes(k)), `imaging[${i}]: modality, finding (+ augmented)`);
  need(c.ecg === undefined || nonEmpty(c.ecg), 'ecg must be a non-empty string if present');
  need(nonEmpty(c.diagnosis?.primary), 'diagnosis.primary required');
  need(c.diagnosis?.icd10 === undefined || /^[A-Z]\d[\dAB](\.[\dA-Z]{1,4})?( \/ [A-Z]\d[\dAB](\.[\dA-Z]{1,4})?)*$/.test(c.diagnosis.icd10), 'diagnosis.icd10: ICD-10-CM code(s), " / "-separated');
  need(Array.isArray(c.diagnosis?.differentials) && c.diagnosis.differentials.length >= 2 && c.diagnosis.differentials.every(nonEmpty), 'diagnosis.differentials: at least 2');
  need(Array.isArray(c.management) && c.management.length >= 1 && c.management.every(nonEmpty), 'management: at least 1 step');
  need(nonEmpty(c.outcome), 'outcome required (it is a core fact)');
  need(Array.isArray(c.teachingPoints) && c.teachingPoints.length >= 2 && c.teachingPoints.every(nonEmpty), 'teachingPoints: at least 2');
  need(Array.isArray(c.questions) && c.questions.length >= 2 && c.questions.length <= 4, 'questions: 2–4');
  need(Array.isArray(c.evidence) && c.evidence.length >= 5, 'evidence: at least 5 quotes');
  need(Array.isArray(c.augmented) && c.augmented.every(nonEmpty), 'augmented: array of strings');
  return e;
}

describe('case library: collection', () => {
  it.skipIf(!!ONLY)('loads every file, deterministically ordered and grouped by category', () => {
    const all = loadLibrary({ fresh: true });
    expect(all.map((c) => c.id)).toEqual([...all.map((c) => c.id)].sort());
    const groups = byCategory(all);
    expect([...groups.keys()]).toEqual(LIBRARY_CATEGORIES.filter((k) => groups.has(k)));
    expect([...groups.values()].flat().length).toBe(all.length);
  });

  it.skipIf(!!ONLY)('has unique ids and PMCIDs', () => {
    const all = loadLibrary({ fresh: true });
    const dup = (xs: (string | undefined)[]) => xs.filter((x, i) => x !== undefined && xs.indexOf(x) !== i);
    expect(dup(all.map((c) => c.id))).toEqual([]);
    expect(dup(all.map((c) => c.source.pmcid))).toEqual([]);
    expect(dup(all.map((c) => c.source.doi?.toLowerCase()))).toEqual([]);
  });

  it.skipIf(!!ONLY)('spreads correct answers across option positions', () => {
    const answers = loadLibrary({ fresh: true }).flatMap((c) => c.questions.map((q) => q.answer));
    if (answers.length < 20) return;
    for (const pos of [0, 1, 2, 3]) {
      const share = answers.filter((a) => a === pos).length / answers.length;
      expect(share, `option ${pos} is correct in ${(share * 100).toFixed(0)}% of questions`).toBeGreaterThan(0.12);
      expect(share, `option ${pos} is correct in ${(share * 100).toFixed(0)}% of questions`).toBeLessThan(0.4);
    }
  });

  it.skipIf(!!ONLY)('has up-to-date reviewer sheets in docs/library (run `npm run library` if this fails)', () => {
    expect(checkLibrarySheets()).toEqual([]);
  });
});

describe.each(CASES)('%s', (file, c) => {
  it('matches the schema', () => {
    expect(schemaErrors(file, c)).toEqual([]);
  });

  it('cites an openly licensed source (CC BY or CC0) with a resolvable link', () => {
    const s = c.source;
    expect(s.pmcid, 'pmcid').toMatch(/^PMC\d+$/);
    expect(s.pmid === undefined || /^\d+$/.test(s.pmid), 'pmid digits').toBe(true);
    expect(s.doi === undefined || /^10\.\d{4,9}\/\S+$/.test(s.doi), 'doi 10.xxxx/...').toBe(true);
    expect(s.citation, 'citation "Authors. Title. Journal. Year;vol(issue):pages."').toMatch(/^.+\. .+[.?!] .+\. (19|20)\d\d.*\.$/);
    expect(s.license, 'licence must be CC BY or CC0').toMatch(/^(CC BY( \d\.\d)?|CC0( 1\.0)?)$/);
    expect(s.url, 'url').toMatch(/^https:\/\/\S+$/);
    expect(s.url.includes(s.pmcid ?? '') || (!!s.doi && s.url.includes(s.doi)), 'url points at the PMCID or DOI').toBe(true);
  });

  it('has well-formed quiz questions', () => {
    const kinds = new Set<string>();
    for (const [i, q] of c.questions.entries()) {
      const at = `questions[${i}]`;
      expect(Object.keys(q).filter((k) => !QUESTION_KEYS.includes(k)), `${at}: unknown keys`).toEqual([]);
      expect(KINDS, `${at}.kind`).toContain(q.kind);
      kinds.add(q.kind);
      expect(nonEmpty(q.q) && q.q.trim().endsWith('?'), `${at}.q must be a question ending in "?"`).toBe(true);
      expect(q.extra === undefined || nonEmpty(q.extra), `${at}.extra non-empty if present`).toBe(true);
      expect(q.options?.length, `${at}: exactly 4 options`).toBe(4);
      expect(q.options.every(nonEmpty), `${at}: options non-empty`).toBe(true);
      expect(new Set(q.options.map((o) => o.trim().toLowerCase())).size, `${at}: options distinct`).toBe(4);
      expect(q.options.some((o) => /\b(all|none) of the above\b/i.test(o)), `${at}: no "all/none of the above"`).toBe(false);
      expect([0, 1, 2, 3], `${at}.answer`).toContain(q.answer);
      const longestOther = Math.max(...q.options.filter((_, j) => j !== q.answer).map((o) => o.length));
      expect(q.options[q.answer].length, `${at}: the correct option should not stand out by length`).toBeLessThanOrEqual(longestOther * 1.8 + 10);
      expect(q.explanation?.length ?? 0, `${at}.explanation 20–600 characters`).toBeGreaterThanOrEqual(20);
      expect(q.explanation.length, `${at}.explanation 20–600 characters`).toBeLessThanOrEqual(600);
    }
    expect(kinds.size, 'mix at least two question kinds').toBeGreaterThanOrEqual(2);
  });

  it('does not give the diagnosis away in the title or the stem', () => {
    const term = spoilerTerm(c.diagnosis.primary);
    if (!term) return;
    for (const [where, text] of [['title', c.title], ['chiefComplaint', c.presentation.chiefComplaint], ['hpi', c.presentation.hpi]] as const) {
      expect(text.toLowerCase().includes(term), `${where} mentions "${term}"`).toBe(false);
    }
  });

  it('traces every fact to a short source quote or flags it as augmented', () => {
    expect(c.evidence.length).toBeGreaterThanOrEqual(5);
    for (const [i, ev] of c.evidence.entries()) {
      expect(nonEmpty(ev.field) && nonEmpty(ev.quote), `evidence[${i}]: field and quote`).toBe(true);
      expect(words(ev.quote), `evidence[${i}] has ${words(ev.quote)} words (under 30): "${ev.quote}"`).toBeLessThan(30);
    }
    expect(new Set(c.evidence.map((e) => e.quote)).size, 'evidence quotes are distinct').toBe(c.evidence.length);
    const g = grounding(c);
    expect(g.invalid).toEqual([]);
    const missing = [...g.leaves].filter(([, s]) => !s.evidence.length && !s.augmented).map(([leaf]) => leaf);
    expect(missing, 'facts with neither evidence nor an augmented flag').toEqual([]);
    const core = [...CORE_PATHS, 'presentation.hpi'].filter((p) => g.leaves.has(p) && !g.leaves.get(p)!.evidence.length);
    expect(core, 'core facts must be quoted from the source').toEqual([]);
  });

  it('uses the same numbers as the quotes it cites (or flags the value as augmented)', () => {
    const g = grounding(c);
    const bad: string[] = [];
    const quoted = (leaf: string) => g.leaves.get(leaf)!.evidence.flatMap((i) => numbersIn(c.evidence[i].quote));
    for (const [k, v] of Object.entries(c.vitals)) {
      const s = g.leaves.get(`vitals.${k}`)!;
      if (s.augmented || !s.evidence.length) continue;
      const ns = quoted(`vitals.${k}`);
      const ok = ns.some((n) => Math.abs(n - v) < 1e-9) || (k === 'tempC' && ns.some((n) => Math.abs(((n - 32) * 5) / 9 - v) <= 0.11));
      if (!ok) bad.push(`vitals.${k} = ${v} not in its quote(s)`);
    }
    for (const [i, f] of c.investigations.entries()) {
      const s = g.leaves.get(`investigations[${i}]`)!;
      const v = numericValue(f.value);
      if (s.augmented || !s.evidence.length || v === undefined) continue;
      if (!quoted(`investigations[${i}]`).some((n) => Math.abs(n - v) < 1e-9)) bad.push(`investigations[${i}] ${f.name} = ${f.value} not in its quote(s)`);
    }
    expect(bad).toEqual([]);
  });

  it('has physiologically plausible first vitals', () => {
    const v = c.vitals;
    expect(v.hr).toBeGreaterThanOrEqual(20); expect(v.hr).toBeLessThanOrEqual(250);
    expect(v.sbp).toBeGreaterThanOrEqual(40); expect(v.sbp).toBeLessThanOrEqual(280);
    expect(v.dbp).toBeGreaterThanOrEqual(15); expect(v.dbp).toBeLessThanOrEqual(v.sbp - 5);
    expect(v.rr).toBeGreaterThanOrEqual(4); expect(v.rr).toBeLessThanOrEqual(80);
    expect(v.spo2).toBeGreaterThanOrEqual(40); expect(v.spo2).toBeLessThanOrEqual(100);
    expect(v.tempC).toBeGreaterThanOrEqual(15); expect(v.tempC).toBeLessThanOrEqual(45);
    if (v.gcs !== undefined) expect(Number.isInteger(v.gcs) && v.gcs >= 3 && v.gcs <= 15, 'gcs integer 3–15').toBe(true);
  });

  it('flags results against the adult reference ranges in shared/catalog.ts (5% margin at the limits)', () => {
    const bad: string[] = [];
    if (c.patient.age < 16) return; // adult ranges only
    for (const f of c.investigations) {
      const a = analyteOf(f);
      if (!a) continue;
      const want = expectedFlag(a.code, a.value, c.patient.sex);
      if (want !== 'skip' && want !== f.flag) bad.push(`${f.name} ${f.value} ${f.unit ?? ''}: flag ${f.flag ?? '(none)'}, expected ${want ?? '(none)'}`);
    }
    expect(bad).toEqual([]);
  });

  const txt = c.source.pmcid ? cachePath(c.source.pmcid, 'txt') : '';
  it.skipIf(!txt || !existsSync(txt))('quotes occur verbatim in the cached source text, and the licence matches the article', () => {
    const text = readFileSync(txt, 'utf8');
    expect(c.evidence.filter((e) => !quoteFound(text, e.quote)).map((e) => `[${e.field}] ${e.quote}`)).toEqual([]);
    const xml = cachePath(c.source.pmcid!, 'xml');
    if (existsSync(xml)) expect(c.source.license, 'licence as stated in the article').toBe(licenseOf(readFileSync(xml, 'utf8')));
  });

  it('is stored in the canonical layout (node scripts/library/fetch-europepmc.mjs fmt)', () => {
    expect(readFileSync(path.join(LIBRARY_DIR, file), 'utf8')).toBe(formatCaseJson(c) + '\n');
  });
});
