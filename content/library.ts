/**
 * Case library loader: content/library/*.json, one LibraryCase per file (schema and grounding rules in
 * shared/caseLibrary.ts, workflow in docs/CASE_LIBRARY.md).
 *
 * Node-only: files are read at runtime, so adding a case means dropping in a JSON file. Order is
 * deterministic (by id; categories in LIBRARY_CATEGORIES order). Also exports the field-path helpers
 * that tie `evidence` and `augmented` entries to case fields (used by tests/case-library.test.ts and
 * scripts/library/sheets.ts):
 *
 *   "presentation.chiefComplaint", "vitals.hr", "exam[2]", "investigations[3]" or "investigations[Potassium]"
 *   (array elements by index, or by `name` / `modality`), several paths comma-separated in one evidence field;
 *   `augmented` entries are a path optionally followed by ": note" ("vitals.rr: report says tachypneic").
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LibraryCase, LibraryCategory } from '../shared/caseLibrary';

export const LIBRARY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'library');

/** display order of categories (every LibraryCategory, in the order of the union) */
export const LIBRARY_CATEGORIES: readonly LibraryCategory[] = [
  'cardiology', 'pulmonology', 'infectious', 'neurology', 'gastroenterology', 'toxicology', 'trauma', 'endocrine',
  'renal', 'hematology', 'obstetrics', 'pediatrics', 'psychiatry', 'dermatology', 'vascular', 'environmental', 'other',
];

/** sorted case file names (*.json) in the library directory */
export function libraryFiles(dir = LIBRARY_DIR): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

export function readLibraryCase(file: string): LibraryCase {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as LibraryCase;
  } catch (e) {
    throw new Error(`${path.basename(file)}: ${(e as Error).message}`);
  }
}

let cached: LibraryCase[] | undefined;

/** every library case, sorted by id (cached; `fresh` re-reads the directory) */
export function loadLibrary(opts: { dir?: string; fresh?: boolean } = {}): LibraryCase[] {
  if (cached && !opts.fresh && !opts.dir) return cached;
  const dir = opts.dir ?? LIBRARY_DIR;
  const cases = libraryFiles(dir)
    .map((f) => readLibraryCase(path.join(dir, f)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!opts.dir) cached = cases;
  return cases;
}

/** cases grouped by category; only non-empty categories, in LIBRARY_CATEGORIES order, cases by id */
export function byCategory(cases: LibraryCase[] = loadLibrary()): Map<LibraryCategory, LibraryCase[]> {
  const out = new Map<LibraryCategory, LibraryCase[]>();
  for (const cat of LIBRARY_CATEGORIES) {
    const xs = cases.filter((c) => c.category === cat);
    if (xs.length) out.set(cat, xs);
  }
  return out;
}

export function libraryCase(id: string, cases: LibraryCase[] = loadLibrary()): LibraryCase | undefined {
  return cases.find((c) => c.id === id);
}

// ───────────────────────────── field paths ─────────────────────────────

/** "a, b" → ["a", "b"]; for `augmented` entries the path is the part before ": " */
export const splitFields = (field: string): string[] => field.split(',').map((s) => s.trim()).filter(Boolean);
export const augmentedPath = (entry: string): string => entry.split(/:\s/)[0].trim();

/**
 * Canonical form of a path ("investigations[Potassium]" → "investigations[4]"), or undefined if it does not
 * resolve to a defined value in the case.
 */
export function canonicalPath(c: LibraryCase, p: string): string | undefined {
  const segs = p.match(/[^.[\]]+|\[[^\]]*\]/g);
  if (!segs) return undefined;
  let cur: unknown = c;
  const out: string[] = [];
  for (const seg of segs) {
    if (seg.startsWith('[')) {
      if (!Array.isArray(cur)) return undefined;
      const key = seg.slice(1, -1).trim();
      let i = /^\d+$/.test(key) ? Number(key) : -1;
      if (i < 0) {
        const k = key.toLowerCase();
        i = cur.findIndex((x) => x && typeof x === 'object' && [(x as { name?: string }).name, (x as { modality?: string }).modality].some((v) => v?.toLowerCase() === k));
      }
      if (i < 0 || i >= cur.length) return undefined;
      cur = cur[i];
      out.push(`[${i}]`);
    } else {
      if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[seg];
      out.push(out.length ? `.${seg}` : seg);
    }
    if (cur === undefined || cur === null) return undefined;
  }
  return out.join('');
}

export function resolvePath(c: LibraryCase, p: string): unknown {
  const canon = canonicalPath(c, p);
  if (canon === undefined) return undefined;
  let cur: unknown = c;
  for (const seg of canon.match(/[^.[\]]+|\[\d+\]/g) ?? []) cur = seg.startsWith('[') ? (cur as unknown[])[Number(seg.slice(1, -1))] : (cur as Record<string, unknown>)[seg];
  return cur;
}

/** is `p` the path itself or a descendant of `ancestor`? (both canonical) */
export const covers = (ancestor: string, p: string): boolean => p === ancestor || p.startsWith(ancestor + '.') || p.startsWith(ancestor + '[');

// ───────────────────────────── grounding ─────────────────────────────

/** paths an evidence entry may point at (canonical form) */
export const EVIDENCE_PATH =
  /^(patient(\.(age|ageMonths|sex|arrival))?|presentation\.(chiefComplaint|hpi|social|family|(pmh|meds|allergies)(\[\d+\])?)|vitals\.(hr|sbp|dbp|rr|spo2|tempC|gcs)|exam\[\d+\]|(investigations|imaging)\[\d+\](\.\w+)?|ecg|diagnosis(\.primary)?|management\[\d+\]|outcome)$/;
/** facts that must come from the source: never flagged as augmented */
export const CORE_PATHS = ['patient.age', 'patient.ageMonths', 'patient.sex', 'presentation.chiefComplaint', 'diagnosis.primary', 'outcome'] as const;
/** paths an `augmented` entry may point at: anything groundable except the core facts (a note on the HPI is fine) */
export const isAugmentablePath = (canon: string): boolean =>
  EVIDENCE_PATH.test(canon) && !/^(patient|diagnosis)$/.test(canon) && !CORE_PATHS.some((p) => covers(p, canon));

/** every fact-bearing field of a case that must be traced to the source (evidence) or flagged augmented */
export function groundableLeaves(c: LibraryCase): string[] {
  const out = ['patient.age', 'patient.sex'];
  if (c.patient.ageMonths !== undefined) out.push('patient.ageMonths');
  if (c.patient.arrival) out.push('patient.arrival');
  out.push('presentation.chiefComplaint', 'presentation.hpi');
  for (const k of ['pmh', 'meds', 'allergies'] as const) c.presentation[k].forEach((_, i) => out.push(`presentation.${k}[${i}]`));
  for (const k of ['social', 'family'] as const) if (c.presentation[k]) out.push(`presentation.${k}`);
  for (const k of Object.keys(c.vitals)) out.push(`vitals.${k}`);
  c.exam.forEach((_, i) => out.push(`exam[${i}]`));
  c.investigations.forEach((_, i) => out.push(`investigations[${i}]`));
  (c.imaging ?? []).forEach((_, i) => out.push(`imaging[${i}]`));
  if (c.ecg) out.push('ecg');
  out.push('diagnosis.primary');
  c.management.forEach((_, i) => out.push(`management[${i}]`));
  if (c.outcome) out.push('outcome');
  return out;
}

/** may an evidence/augmented path (canonical) vouch for this leaf? exact, a sub-field of it, or an allowed list/group parent */
function vouches(p: string, leaf: string): boolean {
  if (p === leaf || leaf.startsWith(p + '[') && /^presentation\.(pmh|meds|allergies)$/.test(p)) return true;
  if (p.startsWith(leaf + '.')) return true; // e.g. investigations[2].value
  if (p === 'patient') return leaf === 'patient.age' || leaf === 'patient.sex' || leaf === 'patient.ageMonths';
  if (p === 'diagnosis') return leaf === 'diagnosis.primary';
  return false;
}

export interface LeafGrounding {
  /** indices into `evidence` whose field covers this leaf */
  evidence: number[];
  /** flagged `augmented: true` inline or listed in `augmented` */
  augmented: boolean;
  /** notes from `augmented` entries ("path: note") */
  notes: string[];
}

export interface Grounding {
  leaves: Map<string, LeafGrounding>;
  /** evidence or augmented paths that do not resolve, or point somewhere they may not */
  invalid: string[];
}

export function grounding(c: LibraryCase): Grounding {
  const invalid: string[] = [];
  const ev: { path: string; idx: number }[] = [];
  c.evidence.forEach((e, idx) => {
    for (const f of splitFields(e.field)) {
      const canon = canonicalPath(c, f);
      if (canon === undefined) invalid.push(`evidence[${idx}] "${f}" does not resolve`);
      else if (!EVIDENCE_PATH.test(canon)) invalid.push(`evidence[${idx}] "${f}" is too broad or not a fact field`);
      else ev.push({ path: canon, idx });
    }
  });
  const aug: { path: string; note: string }[] = [];
  c.augmented.forEach((a, idx) => {
    const p = augmentedPath(a);
    const canon = canonicalPath(c, p);
    if (canon === undefined) invalid.push(`augmented[${idx}] "${p}" does not resolve`);
    else if (!isAugmentablePath(canon)) invalid.push(`augmented[${idx}] "${p}" is a core fact or not a fact field`);
    else aug.push({ path: canon, note: a.slice(p.length).replace(/^:\s*/, '') });
  });
  const leaves = new Map<string, LeafGrounding>();
  for (const leaf of groundableLeaves(c)) {
    const v = resolvePath(c, leaf);
    const inline = !!(v && typeof v === 'object' && (v as { augmented?: boolean }).augmented);
    const mine = aug.filter((a) => vouches(a.path, leaf));
    leaves.set(leaf, {
      evidence: [...new Set(ev.filter((e) => vouches(e.path, leaf)).map((e) => e.idx))],
      augmented: inline || mine.length > 0,
      notes: mine.map((a) => a.note).filter(Boolean),
    });
  }
  return { leaves, invalid };
}
