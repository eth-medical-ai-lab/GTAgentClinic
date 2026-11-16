/**
 * The case library: emergency-medicine vignettes grounded in published case reports (PMC /
 * Europe PMC open access), with structured questions. A curated subset is adapted for 3D play.
 *
 * Grounding rules (enforced by tests/case-library.test.ts):
 * - every case cites its source (PMCID or DOI, citation, licence, URL);
 * - core facts (presentation, key findings, diagnosis, management, outcome) come from the source,
 *   each traceable through `evidence` (short quotes, under 30 words);
 * - anything added for realism (unreported normal labs, social details, exact vitals the report
 *   only describes) is flagged `augmented: true` or listed in `augmented`;
 * - no verbatim copying beyond those short evidence quotes; text is paraphrased.
 * Library files live in content/library/*.json (one case per file), loaded by content/library.ts.
 */

export type LibraryCategory =
  | 'cardiology'
  | 'pulmonology'
  | 'infectious'
  | 'neurology'
  | 'gastroenterology'
  | 'toxicology'
  | 'trauma'
  | 'endocrine'
  | 'renal'
  | 'hematology'
  | 'obstetrics'
  | 'pediatrics'
  | 'psychiatry'
  | 'dermatology'
  | 'vascular'
  | 'environmental'
  | 'other';

export interface LibrarySource {
  pmcid?: string;
  pmid?: string;
  doi?: string;
  /** "Authors. Title. Journal. Year;vol(issue):pages." */
  citation: string;
  /** e.g. "CC BY 4.0" (prefer CC BY / CC0 sources) */
  license: string;
  url: string;
}

export interface LibraryFinding {
  name: string;
  value: string;
  unit?: string;
  /** H / L / critical, against usual adult reference ranges */
  flag?: 'H' | 'L' | 'critical';
  /** added for realism, not reported in the source */
  augmented?: boolean;
}

/**
 * one question built from this case. The stem a player sees is the vignette: patient, presentation,
 * vitals and exam (not investigations, imaging, ECG or diagnosis); whatever else the question needs is in
 * `extra`. A case's questions are meant to be asked in order: a later `extra` may reveal an earlier answer.
 */
export interface LibraryQuestion {
  kind: 'diagnosis' | 'next-step' | 'interpretation' | 'management' | 'risk';
  /** the question, answerable from the vignette (plus the extra info given here, if any) */
  q: string;
  /** shown with the question (e.g. "ECG: ST elevation in II, III, aVF"); optional */
  extra?: string;
  /** 4 options, plausible distractors */
  options: [string, string, string, string];
  /** index of the correct option */
  answer: 0 | 1 | 2 | 3;
  /** why, in 1–3 sentences; cite a guideline by name where relevant */
  explanation: string;
}

export interface LibraryCase {
  /** stable id, e.g. "pmc-PMC7012345-aortic-dissection" */
  id: string;
  /** short teaching title, no spoilers (e.g. "Back pain after the gym") */
  title: string;
  category: LibraryCategory;
  /** ESI triage level 1–5 on arrival */
  acuity: 1 | 2 | 3 | 4 | 5;
  source: LibrarySource;
  /** age in years; under 2 years also give `ageMonths` (age is then months / 12, e.g. 0.67) */
  patient: { age: number; ageMonths?: number; sex: 'F' | 'M'; arrival?: 'walk-in' | 'ems' | 'transfer' };
  presentation: {
    chiefComplaint: string;
    hpi: string;
    pmh: string[];
    meds: string[];
    allergies: string[];
    social?: string;
    family?: string;
  };
  /** first ED vitals; flag fields the source didn't report in `augmented` */
  vitals: { hr: number; sbp: number; dbp: number; rr: number; spo2: number; tempC: number; gcs?: number };
  exam: string[];
  investigations: LibraryFinding[];
  imaging?: { modality: string; finding: string; augmented?: boolean }[];
  ecg?: string;
  diagnosis: { primary: string; icd10?: string; differentials: string[] };
  management: string[];
  outcome?: string;
  teachingPoints: string[];
  questions: LibraryQuestion[];
  /** facts traced to the source: field path → short quote */
  evidence: { field: string; quote: string }[];
  /** what was added for realism (field paths or short notes) */
  augmented: string[];
}
