import type { LibraryCase } from '../../shared/caseLibrary';
import type { CaseDef } from '../types';

// Exact admission analyte names only. A later peak, a post-treatment draw or a different assay
// must never become an initial ED result. Unmapped findings remain available in the source record.
const names: Record<string, string> = {
  'White cell count': 'wbc', 'White blood cell count': 'wbc', 'White blood cells': 'wbc', Hemoglobin: 'hgb', Hematocrit: 'hct',
  'Packed cell volume': 'hct', Platelets: 'plt', Neutrophils: 'neut', Bands: 'bands', Lymphocytes: 'lymph',
  Sodium: 'na', Potassium: 'k', Chloride: 'cl', Bicarbonate: 'hco3', 'Bicarbonate (serum)': 'hco3', 'Anion gap': 'agap',
  Creatinine: 'creat', Glucose: 'glu', Magnesium: 'mg', Calcium: 'ca', Phosphorus: 'phos', BUN: 'bun', 'Blood urea nitrogen': 'bun',
  AST: 'ast', ALT: 'alt', Albumin: 'alb', 'Total bilirubin': 'tbili', 'C-reactive protein': 'crp', CRP: 'crp', ESR: 'esr',
  'Creatine kinase': 'ck', INR: 'inr', 'Prothrombin time': 'pt', PT: 'pt', PTT: 'ptt', aPTT: 'ptt', TSH: 'tsh', 'Free T4': 'ft4',
  'Peripheral blood smear': 'smear', 'Urine pregnancy test': 'hcg_u', 'Urine drug screen': 'uds',
  'Lactic acid': 'lactate', Lactate: 'lactate', 'pH (venous blood gas)': 'ph_v',
};

// Converts only the units explicitly supported here. The clinical catalog uses conventional units.
const units: Record<string, Record<string, number>> = {
  wbc: { 'x10⁹/L': 1, 'x10³/µL': 1, '/mm³': 0.001, '/µL': 0.001 }, plt: { 'x10⁹/L': 1, 'x10³/µL': 1, 'x10⁴/µL': 10, '/mm³': 0.001, '/µL': 0.001 },
  hgb: { 'g/dL': 1, 'g/L': 0.1 }, alb: { 'g/dL': 1, 'g/L': 0.1 }, creat: { 'mg/dL': 1, 'µmol/L': 1 / 88.4 },
  glu: { 'mg/dL': 1, 'mmol/L': 18.018 }, ca: { 'mg/dL': 1, 'mmol/L': 4.008 }, mg: { 'mg/dL': 1, 'mmol/L': 2.43 },
  crp: { 'mg/L': 1, 'mg/dL': 10 }, tbili: { 'mg/dL': 1, 'µmol/L': 1 / 17.1 }, ft4: { 'ng/dL': 1, 'pmol/L': 1 / 12.87 },
};
export function admissionLabs(c: LibraryCase): CaseDef['labs'] {
  const result: CaseDef['labs'] = {};
  for (const lab of c.investigations) {
    const code = names[lab.name];
    if (!code) continue;
    if (['smear', 'hcg_u', 'uds'].includes(code)) { result[code] = lab.value; continue; }
    const m = /^([<>]?)(-?[\d.]+)$/.exec(lab.value.replaceAll(',', ''));
    if (!m) continue;
    const k = units[code] ? units[code][lab.unit ?? ''] : 1;
    if (k === undefined) continue;
    const n = Number((Number(m[2]) * k).toFixed(3));
    if (Number.isFinite(n)) result[code] = m[1] ? m[1] + n : n;
  }
  return result;
}
