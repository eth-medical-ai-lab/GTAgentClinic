/**
 * Clinical catalog: lab analytes, orderables (labs, imaging, meds, nursing,
 * consults), order sets and exam maneuvers. Values are adult reference ranges in
 * conventional (US) units with SI conversion factors. Costs are rough US
 * charge-master–style figures used for stewardship scoring only.
 */
import type { ExamManeuverDef, LabAnalyteDef, MedDef, OrderDef, OrderSetDef } from './types';

// ───────────────────────────── lab analytes ─────────────────────────────

import { additionalAnalytes, additionalOrders } from './extendedStudies';
import { POCUS_WINDOWS, pocusManeuver } from './pocus';

const A = (d: LabAnalyteDef) => d;

export const ANALYTES: Record<string, LabAnalyteDef> = Object.fromEntries(
  [
    // Hematology
    A({ code: 'wbc', name: 'White blood cell count', short: 'WBC', section: 'Hematology', unit: 'x10³/µL', unitSI: 'x10⁹/L', toSI: 1, ref: [4.5, 11.0], critLow: 1.5, critHigh: 30, decimals: 1 }),
    A({ code: 'rbc', name: 'Red blood cell count', short: 'RBC', section: 'Hematology', unit: 'x10⁶/µL', unitSI: 'x10¹²/L', toSI: 1, ref: { M: [4.5, 5.9], F: [4.1, 5.1] }, decimals: 2 }),
    A({ code: 'hgb', name: 'Hemoglobin', short: 'Hgb', section: 'Hematology', unit: 'g/dL', unitSI: 'g/L', toSI: 10, ref: { M: [13.5, 17.5], F: [12.0, 15.5] }, critLow: 7.0, critHigh: 20, decimals: 1, decimalsSI: 0 }),
    A({ code: 'hct', name: 'Hematocrit', short: 'Hct', section: 'Hematology', unit: '%', unitSI: 'L/L', toSI: 0.01, ref: { M: [41, 53], F: [36, 46] }, decimals: 1, decimalsSI: 2 }),
    A({ code: 'mcv', name: 'Mean corpuscular volume', short: 'MCV', section: 'Hematology', unit: 'fL', unitSI: 'fL', toSI: 1, ref: [80, 100], decimals: 0 }),
    A({ code: 'plt', name: 'Platelet count', short: 'Plt', section: 'Hematology', unit: 'x10³/µL', unitSI: 'x10⁹/L', toSI: 1, ref: [150, 400], critLow: 30, critHigh: 1000, decimals: 0 }),
    A({ code: 'neut', name: 'Neutrophils', short: 'Neut %', section: 'Hematology', unit: '%', toSI: 1, unitSI: '%', ref: [40, 70], decimals: 0 }),
    A({ code: 'bands', name: 'Bands', short: 'Bands %', section: 'Hematology', unit: '%', toSI: 1, unitSI: '%', ref: [0, 5], decimals: 0 }),
    A({ code: 'lymph', name: 'Lymphocytes', short: 'Lymph %', section: 'Hematology', unit: '%', toSI: 1, unitSI: '%', ref: [20, 40], decimals: 0 }),
    A({ code: 'mono', name: 'Monocytes', short: 'Mono %', section: 'Hematology', unit: '%', toSI: 1, unitSI: '%', ref: [2, 8], decimals: 0 }),
    A({ code: 'eos', name: 'Eosinophils', short: 'Eos %', section: 'Hematology', unit: '%', toSI: 1, unitSI: '%', ref: [1, 4], decimals: 0 }),

    // Chemistry
    A({ code: 'na', name: 'Sodium', short: 'Na', section: 'Chemistry', unit: 'mEq/L', unitSI: 'mmol/L', toSI: 1, ref: [135, 145], critLow: 120, critHigh: 160, decimals: 0 }),
    A({ code: 'k', name: 'Potassium', short: 'K', section: 'Chemistry', unit: 'mEq/L', unitSI: 'mmol/L', toSI: 1, ref: [3.5, 5.1], critLow: 2.8, critHigh: 6.2, decimals: 1 }),
    A({ code: 'cl', name: 'Chloride', short: 'Cl', section: 'Chemistry', unit: 'mEq/L', unitSI: 'mmol/L', toSI: 1, ref: [98, 107], decimals: 0 }),
    A({ code: 'hco3', name: 'Bicarbonate (total CO2)', short: 'CO2', section: 'Chemistry', unit: 'mEq/L', unitSI: 'mmol/L', toSI: 1, ref: [22, 29], critLow: 10, critHigh: 40, decimals: 0 }),
    A({ code: 'bun', name: 'Blood urea nitrogen', short: 'BUN', section: 'Chemistry', unit: 'mg/dL', unitSI: 'mmol/L (urea)', toSI: 0.357, ref: [7, 20], decimals: 0, decimalsSI: 1 }),
    A({ code: 'creat', name: 'Creatinine', short: 'Creat', section: 'Chemistry', unit: 'mg/dL', unitSI: 'µmol/L', toSI: 88.4, ref: { M: [0.74, 1.35], F: [0.59, 1.04] }, decimals: 2, decimalsSI: 0 }),
    A({ code: 'glu', name: 'Glucose', short: 'Glu', section: 'Chemistry', unit: 'mg/dL', unitSI: 'mmol/L', toSI: 0.0555, ref: [70, 140], critLow: 50, critHigh: 450, decimals: 0, decimalsSI: 1 }),
    A({ code: 'ca', name: 'Calcium', short: 'Ca', section: 'Chemistry', unit: 'mg/dL', unitSI: 'mmol/L', toSI: 0.2495, ref: [8.6, 10.3], critLow: 6.5, critHigh: 13, decimals: 1, decimalsSI: 2 }),
    A({ code: 'agap', name: 'Anion gap', short: 'AG', section: 'Chemistry', unit: 'mEq/L', unitSI: 'mmol/L', toSI: 1, ref: [8, 16], decimals: 0 }),
    A({ code: 'mg', name: 'Magnesium', short: 'Mg', section: 'Chemistry', unit: 'mg/dL', unitSI: 'mmol/L', toSI: 0.4114, ref: [1.7, 2.2], critLow: 1.0, decimals: 1, decimalsSI: 2 }),
    A({ code: 'phos', name: 'Phosphorus', short: 'Phos', section: 'Chemistry', unit: 'mg/dL', unitSI: 'mmol/L', toSI: 0.3229, ref: [2.5, 4.5], decimals: 1, decimalsSI: 2 }),
    A({ code: 'tprot', name: 'Total protein', short: 'T Prot', section: 'Chemistry', unit: 'g/dL', unitSI: 'g/L', toSI: 10, ref: [6.0, 8.3], decimals: 1, decimalsSI: 0 }),
    A({ code: 'alb', name: 'Albumin', short: 'Alb', section: 'Chemistry', unit: 'g/dL', unitSI: 'g/L', toSI: 10, ref: [3.5, 5.0], decimals: 1, decimalsSI: 0 }),
    A({ code: 'tbili', name: 'Bilirubin, total', short: 'T Bili', section: 'Chemistry', unit: 'mg/dL', unitSI: 'µmol/L', toSI: 17.1, ref: [0.1, 1.2], decimals: 1, decimalsSI: 0 }),
    A({ code: 'dbili', name: 'Bilirubin, direct', short: 'D Bili', section: 'Chemistry', unit: 'mg/dL', unitSI: 'µmol/L', toSI: 17.1, ref: [0.0, 0.3], decimals: 1, decimalsSI: 0 }),
    A({ code: 'alp', name: 'Alkaline phosphatase', short: 'ALP', section: 'Chemistry', unit: 'U/L', unitSI: 'U/L', toSI: 1, ref: [44, 147], decimals: 0 }),
    A({ code: 'ast', name: 'Aspartate aminotransferase', short: 'AST', section: 'Chemistry', unit: 'U/L', unitSI: 'U/L', toSI: 1, ref: [10, 40], decimals: 0 }),
    A({ code: 'alt', name: 'Alanine aminotransferase', short: 'ALT', section: 'Chemistry', unit: 'U/L', unitSI: 'U/L', toSI: 1, ref: [7, 56], decimals: 0 }),
    A({ code: 'lipase', name: 'Lipase', short: 'Lipase', section: 'Chemistry', unit: 'U/L', unitSI: 'U/L', toSI: 1, ref: [10, 60], decimals: 0 }),
    A({ code: 'chol', name: 'Cholesterol, total', short: 'Chol', section: 'Chemistry', unit: 'mg/dL', unitSI: 'mmol/L', toSI: 0.02586, ref: [0, 200], decimals: 0, decimalsSI: 1 }),
    A({ code: 'ldl', name: 'LDL cholesterol (calc)', short: 'LDL', section: 'Chemistry', unit: 'mg/dL', unitSI: 'mmol/L', toSI: 0.02586, ref: [0, 100], decimals: 0, decimalsSI: 1 }),
    A({ code: 'hdl', name: 'HDL cholesterol', short: 'HDL', section: 'Chemistry', unit: 'mg/dL', unitSI: 'mmol/L', toSI: 0.02586, ref: [40, 200], decimals: 0, decimalsSI: 1 }),
    A({ code: 'tg', name: 'Triglycerides', short: 'TG', section: 'Chemistry', unit: 'mg/dL', unitSI: 'mmol/L', toSI: 0.01129, ref: [0, 150], decimals: 0, decimalsSI: 1 }),

    // Cardiac
    A({ code: 'trop', name: 'Troponin T, high-sensitivity', short: 'hs-TnT', section: 'Cardiac', unit: 'ng/L', unitSI: 'ng/L', toSI: 1, ref: [0, 14], critHigh: 52, decimals: 0 }),
    A({ code: 'ck', name: 'Creatine kinase', short: 'CK', section: 'Cardiac', unit: 'U/L', unitSI: 'U/L', toSI: 1, ref: [30, 200], decimals: 0 }),
    A({ code: 'ntprobnp', name: 'NT-proBNP', short: 'NT-proBNP', section: 'Cardiac', unit: 'pg/mL', unitSI: 'ng/L', toSI: 1, ref: [0, 125], decimals: 0 }),
    A({ code: 'ddimer', name: 'D-dimer', short: 'D-dimer', section: 'Coagulation', unit: 'µg/mL FEU', unitSI: 'mg/L FEU', toSI: 1, ref: [0, 0.5], decimals: 2 }),

    // Coagulation
    A({ code: 'pt', name: 'Prothrombin time', short: 'PT', section: 'Coagulation', unit: 's', unitSI: 's', toSI: 1, ref: [11.0, 13.5], decimals: 1 }),
    A({ code: 'inr', name: 'INR', short: 'INR', section: 'Coagulation', unit: '', unitSI: '', toSI: 1, ref: [0.8, 1.1], critHigh: 5, decimals: 1 }),
    A({ code: 'ptt', name: 'aPTT', short: 'aPTT', section: 'Coagulation', unit: 's', unitSI: 's', toSI: 1, ref: [25, 35], critHigh: 100, decimals: 0 }),
    A({ code: 'fib', name: 'Fibrinogen', short: 'Fib', section: 'Coagulation', unit: 'mg/dL', unitSI: 'g/L', toSI: 0.01, ref: [200, 400], critLow: 100, decimals: 0, decimalsSI: 1 }),

    // Blood gas
    A({ code: 'ph_v', name: 'pH, venous', short: 'pH (v)', section: 'Blood Gas', unit: '', unitSI: '', toSI: 1, ref: [7.31, 7.41], critLow: 7.2, critHigh: 7.6, decimals: 2 }),
    A({ code: 'pco2_v', name: 'pCO2, venous', short: 'pCO2 (v)', section: 'Blood Gas', unit: 'mmHg', unitSI: 'kPa', toSI: 0.1333, ref: [41, 51], decimals: 0, decimalsSI: 1 }),
    A({ code: 'hco3_v', name: 'Bicarbonate, venous (calc)', short: 'HCO3 (v)', section: 'Blood Gas', unit: 'mEq/L', unitSI: 'mmol/L', toSI: 1, ref: [22, 29], decimals: 0 }),
    A({ code: 'lactate', name: 'Lactate', short: 'Lactate', section: 'Blood Gas', unit: 'mmol/L', unitSI: 'mmol/L', toSI: 1, ref: [0.5, 2.0], critHigh: 4.0, decimals: 1 }),

    // Inflammatory
    A({ code: 'crp', name: 'C-reactive protein', short: 'CRP', section: 'Inflammatory', unit: 'mg/L', unitSI: 'mg/L', toSI: 1, ref: [0, 10], decimals: 0 }),
    A({ code: 'pct', name: 'Procalcitonin', short: 'PCT', section: 'Inflammatory', unit: 'ng/mL', unitSI: 'µg/L', toSI: 1, ref: [0, 0.1], decimals: 2 }),
    A({ code: 'esr', name: 'Erythrocyte sedimentation rate', short: 'ESR', section: 'Inflammatory', unit: 'mm/h', unitSI: 'mm/h', toSI: 1, ref: [0, 20], decimals: 0 }),

    // Urinalysis
    A({ code: 'ua_appear', name: 'Appearance', short: 'UA Appear', section: 'Urinalysis', unit: '', text: true, normalText: 'Clear' }),
    A({ code: 'ua_color', name: 'Color', short: 'UA Color', section: 'Urinalysis', unit: '', text: true, normalText: 'Yellow' }),
    A({ code: 'ua_sg', name: 'Specific gravity', short: 'UA SG', section: 'Urinalysis', unit: '', unitSI: '', toSI: 1, ref: [1.005, 1.03], decimals: 3 }),
    A({ code: 'ua_ph', name: 'pH, urine', short: 'UA pH', section: 'Urinalysis', unit: '', unitSI: '', toSI: 1, ref: [5.0, 8.0], decimals: 1 }),
    A({ code: 'ua_prot', name: 'Protein, urine', short: 'UA Prot', section: 'Urinalysis', unit: '', text: true, normalText: 'Negative' }),
    A({ code: 'ua_glu', name: 'Glucose, urine', short: 'UA Glu', section: 'Urinalysis', unit: '', text: true, normalText: 'Negative' }),
    A({ code: 'ua_ket', name: 'Ketones, urine', short: 'UA Ket', section: 'Urinalysis', unit: '', text: true, normalText: 'Negative' }),
    A({ code: 'ua_blood', name: 'Blood, urine', short: 'UA Blood', section: 'Urinalysis', unit: '', text: true, normalText: 'Negative' }),
    A({ code: 'ua_nit', name: 'Nitrite', short: 'UA Nitrite', section: 'Urinalysis', unit: '', text: true, normalText: 'Negative' }),
    A({ code: 'ua_le', name: 'Leukocyte esterase', short: 'UA LE', section: 'Urinalysis', unit: '', text: true, normalText: 'Negative' }),
    A({ code: 'ua_wbc', name: 'WBC, urine', short: 'UA WBC', section: 'Urinalysis', unit: '/hpf', unitSI: '/hpf', toSI: 1, ref: [0, 5], decimals: 0 }),
    A({ code: 'ua_rbc', name: 'RBC, urine', short: 'UA RBC', section: 'Urinalysis', unit: '/hpf', unitSI: '/hpf', toSI: 1, ref: [0, 2], decimals: 0 }),
    A({ code: 'ua_bact', name: 'Bacteria, urine', short: 'UA Bact', section: 'Urinalysis', unit: '', text: true, normalText: 'None seen' }),
    A({ code: 'ua_epi', name: 'Squamous epithelial cells', short: 'UA Epi', section: 'Urinalysis', unit: '', text: true, normalText: 'Few' }),

    // Endocrine / pregnancy / tox
    A({ code: 'hcg_u', name: 'hCG, urine (qualitative)', short: 'UPT', section: 'Point of Care', unit: '', text: true, normalText: 'Negative' }),
    A({ code: 'hcg_q', name: 'hCG, quantitative (serum)', short: 'β-hCG', section: 'Endocrine', unit: 'mIU/mL', unitSI: 'IU/L', toSI: 1, ref: [0, 5], decimals: 0 }),
    A({ code: 'tsh', name: 'Thyroid-stimulating hormone', short: 'TSH', section: 'Endocrine', unit: 'mIU/L', unitSI: 'mIU/L', toSI: 1, ref: [0.4, 4.0], decimals: 2 }),
    A({ code: 'ft4', name: 'Free T4', short: 'fT4', section: 'Endocrine', unit: 'ng/dL', unitSI: 'pmol/L', toSI: 12.87, ref: [0.8, 1.8], decimals: 2, decimalsSI: 0 }),
    A({ code: 'a1c', name: 'Hemoglobin A1c', short: 'HbA1c', section: 'Endocrine', unit: '%', unitSI: 'mmol/mol', toSI: 10.93, ref: [4.0, 5.6], decimals: 1, decimalsSI: 0 }),
    A({ code: 'etoh', name: 'Ethanol, serum', short: 'EtOH', section: 'Toxicology', unit: 'mg/dL', unitSI: 'mmol/L', toSI: 0.2171, ref: [0, 10], decimals: 0 }),
    A({ code: 'uds', name: 'Urine drug screen (immunoassay)', short: 'UDS', section: 'Toxicology', unit: '', text: true, normalText: 'Negative for all classes tested' }),
    A({ code: 'glu_poc', name: 'Glucose, point of care', short: 'POC Glu', section: 'Point of Care', unit: 'mg/dL', unitSI: 'mmol/L', toSI: 0.0555, ref: [70, 140], critLow: 50, critHigh: 450, decimals: 0, decimalsSI: 1 }),

    // Microbiology
    A({ code: 'bcx1', name: 'Blood culture, set 1', short: 'BCx #1', section: 'Microbiology', unit: '', text: true, normalText: 'No growth to date' }),
    A({ code: 'bcx2', name: 'Blood culture, set 2', short: 'BCx #2', section: 'Microbiology', unit: '', text: true, normalText: 'No growth to date' }),
    A({ code: 'ucx', name: 'Urine culture', short: 'UCx', section: 'Microbiology', unit: '', text: true, normalText: 'No growth' }),

    ...additionalAnalytes,

    // Blood bank
    A({ code: 'abo', name: 'ABO/Rh type', short: 'ABO/Rh', section: 'Blood Bank', unit: '', text: true }),
    A({ code: 'abscreen', name: 'Antibody screen', short: 'Ab screen', section: 'Blood Bank', unit: '', text: true, normalText: 'Negative' }),
  ].map((a) => [a.code, a]),
);

// ───────────────────────────── orderables ─────────────────────────────

const lab = (code: string, name: string, analytes: string[], tatMin: [number, number], costUSD: number, extra: Partial<OrderDef> = {}): OrderDef => ({
  code,
  name,
  category: 'lab',
  analytes,
  specimen: 'Blood',
  tatMin,
  costUSD,
  ...extra,
});

const med = (code: string, name: string, m: MedDef, costUSD: number, extra: Partial<OrderDef> = {}): OrderDef => ({
  code,
  name,
  category: 'med',
  med: m,
  costUSD,
  ...extra,
});

const ORDER_LIST: OrderDef[] = [
  // ── Labs ──
  lab('cbc', 'CBC with differential', ['wbc', 'rbc', 'hgb', 'hct', 'mcv', 'plt', 'neut', 'bands', 'lymph', 'mono', 'eos'], [20, 45], 25, { synonyms: ['blood count', 'full blood count', 'fbc', 'hemogram'] }),
  lab('bmp', 'Basic metabolic panel', ['na', 'k', 'cl', 'hco3', 'bun', 'creat', 'glu', 'ca', 'agap'], [30, 60], 30, { synonyms: ['chem 7', 'chem7', 'electrolytes', 'lytes', 'renal panel', 'u&e'] }),
  lab('cmp', 'Comprehensive metabolic panel', ['na', 'k', 'cl', 'hco3', 'bun', 'creat', 'glu', 'ca', 'agap', 'tprot', 'alb', 'tbili', 'alp', 'ast', 'alt'], [35, 65], 45, { synonyms: ['chem 14', 'cmp', 'liver and kidney'] }),
  lab('lfts', 'Hepatic function panel', ['tprot', 'alb', 'tbili', 'dbili', 'alp', 'ast', 'alt'], [35, 65], 35, { synonyms: ['lft', 'liver function'] }),
  lab('mg', 'Magnesium', ['mg'], [30, 60], 15),
  lab('phos', 'Phosphorus', ['phos'], [30, 60], 15),
  lab('lipase', 'Lipase', ['lipase'], [30, 60], 30, { synonyms: ['pancreas'] }),
  lab('trop', 'Troponin T, high-sensitivity', ['trop'], [35, 60], 40, { synonyms: ['troponin', 'hs-trop', 'hstnt', 'cardiac enzymes', 'trop'] , description: 'ESC 0/1h algorithm: rule-in ≥52 ng/L or Δ1h ≥5 ng/L; rule-out <5 ng/L (if symptoms >3 h) or <12 ng/L with Δ1h <3.' }),
  lab('ck', 'Creatine kinase', ['ck'], [35, 60], 25, { synonyms: ['cpk'] }),
  lab('ntprobnp', 'NT-proBNP', ['ntprobnp'], [40, 70], 60, { synonyms: ['bnp', 'natriuretic peptide'] }),
  lab('ddimer', 'D-dimer', ['ddimer'], [35, 60], 45, { synonyms: ['dimer'] }),
  lab('coags', 'PT/INR and aPTT', ['pt', 'inr', 'ptt'], [30, 55], 25, { synonyms: ['coagulation', 'inr', 'ptt', 'pt/inr'] }),
  lab('fib', 'Fibrinogen', ['fib'], [40, 70], 30),
  lab('lactate', 'Lactic acid, venous', ['lactate'], [15, 30], 20, { synonyms: ['lactic acid', 'lactate'] }),
  lab('vbg', 'Venous blood gas with lactate (POC)', ['ph_v', 'pco2_v', 'hco3_v', 'lactate'], [4, 8], 35, { synonyms: ['blood gas', 'vbg', 'istat', 'gas'], specimen: 'Venous blood' }),
  lab('crp', 'C-reactive protein', ['crp'], [35, 60], 20, { synonyms: ['crp', 'inflammation'] }),
  lab('pct', 'Procalcitonin', ['pct'], [45, 80], 55, { synonyms: ['procal'] }),
  lab('esr', 'Sedimentation rate', ['esr'], [45, 75], 15, { synonyms: ['esr', 'sed rate'] }),
  lab('ua', 'Urinalysis with microscopy', ['ua_appear', 'ua_color', 'ua_sg', 'ua_ph', 'ua_prot', 'ua_glu', 'ua_ket', 'ua_blood', 'ua_nit', 'ua_le', 'ua_wbc', 'ua_rbc', 'ua_bact', 'ua_epi'], [20, 45], 15, { specimen: 'Urine', synonyms: ['urine', 'urinalysis', 'u/a', 'dipstick'] }),
  lab('hcg_u', 'Pregnancy test, urine (POC)', ['hcg_u'], [5, 10], 10, { specimen: 'Urine', synonyms: ['pregnancy', 'upt', 'hcg', 'beta'] }),
  lab('hcg_q', 'hCG, quantitative serum', ['hcg_q'], [40, 70], 35, { synonyms: ['beta hcg', 'quant', 'pregnancy blood'] }),
  lab('tsh', 'TSH (reflex free T4)', ['tsh', 'ft4'], [45, 90], 35, { synonyms: ['thyroid'] }),
  lab('a1c', 'Hemoglobin A1c', ['a1c'], [60, 120], 30, { synonyms: ['a1c', 'glycated'] }),
  lab('lipids', 'Lipid panel', ['chol', 'ldl', 'hdl', 'tg'], [60, 120], 35, { synonyms: ['cholesterol', 'lipid'] }),
  lab('etoh', 'Ethanol level', ['etoh'], [30, 60], 25, { synonyms: ['alcohol', 'etoh'] }),
  lab('uds', 'Urine drug screen', ['uds'], [40, 70], 60, { specimen: 'Urine', synonyms: ['tox', 'drug screen'] }),
  lab('bcx', 'Blood cultures x2 (aerobic + anaerobic)', ['bcx1', 'bcx2'], [24 * 60, 48 * 60], 120, { specimen: 'Blood culture', synonyms: ['blood culture', 'cultures', 'bcx'], description: 'Two sets from two separate sites. Draw BEFORE antibiotics. Preliminary growth typically 12–48 h.' }),
  lab('ucx', 'Urine culture', ['ucx'], [24 * 60, 48 * 60], 45, { specimen: 'Urine', synonyms: ['urine culture'] }),
  lab('type_screen', 'Type and screen', ['abo', 'abscreen'], [40, 70], 80, { synonyms: ['type and cross', 'crossmatch', 't&s'] }),
  lab('glu_poc', 'Glucose, point of care', ['glu_poc'], [1, 3], 5, { specimen: 'POC', synonyms: ['fingerstick', 'accucheck', 'bsl', 'bm'] }),

  // ── ECG ──
  { code: 'ecg12', name: 'ECG 12-lead', category: 'ecg', modality: 'ECG', durationMin: 5, costUSD: 50, synonyms: ['ecg', 'ekg', '12-lead', '12 lead', 'electrocardiogram'] },
  { code: 'ecg_right', name: 'ECG right-sided (V4R)', category: 'ecg', modality: 'ECG', durationMin: 5, costUSD: 50, synonyms: ['right sided ekg', 'right sided ecg', 'v4r', 'right-sided'] },

  // ── Imaging ──
  { code: 'xr_chest_port', name: 'XR chest, portable (1 view)', category: 'imaging', modality: 'XR', acquireMin: [10, 25], readMin: [15, 35], costUSD: 120, synonyms: ['cxr', 'chest x-ray', 'chest xray', 'portable'] },
  { code: 'xr_chest', name: 'XR chest PA and lateral', category: 'imaging', modality: 'XR', acquireMin: [20, 40], readMin: [15, 35], costUSD: 150, synonyms: ['cxr', 'chest x-ray', 'pa lateral'] },
  { code: 'xr_ankle', name: 'XR ankle, 3 views (affected side)', category: 'imaging', modality: 'XR', acquireMin: [20, 40], readMin: [20, 45], costUSD: 130, synonyms: ['ankle x-ray', 'ankle xray', 'ankle film'] },
  { code: 'xr_foot', name: 'XR foot, 3 views (affected side)', category: 'imaging', modality: 'XR', acquireMin: [20, 40], readMin: [20, 45], costUSD: 130, synonyms: ['foot x-ray', 'foot xray'] },
  { code: 'ct_head', name: 'CT head without contrast', category: 'imaging', modality: 'CT', acquireMin: [15, 35], readMin: [15, 35], costUSD: 600, synonyms: ['head ct', 'cth', 'brain ct'] },
  { code: 'ct_abd_iv', name: 'CT abdomen/pelvis with IV contrast', category: 'imaging', modality: 'CT', contrast: true, acquireMin: [35, 75], readMin: [20, 45], costUSD: 1200, synonyms: ['ct abdomen', 'ct a/p', 'abdominal ct', 'ct belly', 'ct abd pelvis'] },
  { code: 'cta_chest', name: 'CT angiography chest (PE protocol)', category: 'imaging', modality: 'CT', contrast: true, acquireMin: [25, 50], readMin: [20, 40], costUSD: 1300, synonyms: ['ctpa', 'pe study', 'cta chest', 'pulmonary angiogram'] },
  { code: 'cta_aorta', name: 'CT angiography chest/abdomen/pelvis (aorta)', category: 'imaging', modality: 'CT', contrast: true, acquireMin: [25, 50], readMin: [20, 40], costUSD: 1500, synonyms: ['dissection', 'cta aorta', 'aortogram'] },
  { code: 'us_appendix', name: 'US appendix (graded compression)', category: 'imaging', modality: 'US', acquireMin: [40, 90], readMin: [10, 25], costUSD: 400, synonyms: ['appendix ultrasound', 'us rlq'] },
  { code: 'us_ruq', name: 'US abdomen, right upper quadrant', category: 'imaging', modality: 'US', acquireMin: [40, 90], readMin: [10, 25], costUSD: 400, synonyms: ['gallbladder ultrasound', 'ruq us'] },
  { code: 'us_pelvis_tv', name: 'US pelvis, transvaginal', category: 'imaging', modality: 'US', acquireMin: [40, 90], readMin: [10, 25], costUSD: 450, synonyms: ['tvus', 'pelvic ultrasound', 'transvaginal'] },
  { code: 'us_renal', name: 'US renal / bladder', category: 'imaging', modality: 'US', acquireMin: [40, 90], readMin: [10, 25], costUSD: 350, synonyms: ['renal ultrasound', 'kidney ultrasound', 'hydronephrosis'] },
  { code: 'mri_ankle', name: 'MRI ankle without contrast', category: 'imaging', modality: 'MRI', acquireMin: [180, 360], readMin: [60, 180], costUSD: 1800, synonyms: ['ankle mri', 'mri'] },

  // ── Nursing ──
  { code: 'vitals_now', name: 'Vital signs now (full set incl. temperature)', category: 'nursing', durationMin: 4, costUSD: 0, synonyms: ['vitals', 'temperature', 'temp', 'recheck vitals'] },
  { code: 'vitals_q15', name: 'Vital signs every 15 min', category: 'nursing', durationMin: 3, costUSD: 0, synonyms: ['q15 vitals'] },
  { code: 'vitals_q1h', name: 'Vital signs every 1 h', category: 'nursing', durationMin: 3, costUSD: 0, synonyms: ['hourly vitals'] },
  { code: 'monitor', name: 'Continuous cardiac monitoring + pulse oximetry', category: 'nursing', durationMin: 3, costUSD: 0, synonyms: ['tele', 'telemetry', 'cardiac monitor', 'monitor', 'pulse ox'] },
  { code: 'iv_access', name: 'Peripheral IV access (2 large-bore)', category: 'nursing', durationMin: 6, costUSD: 25, synonyms: ['iv', 'cannula', 'line', 'access'] },
  { code: 'o2_nc', name: 'Oxygen via nasal cannula, titrate SpO2 92–96%', category: 'nursing', durationMin: 2, costUSD: 15, synonyms: ['oxygen', 'o2', 'nasal cannula'] },
  { code: 'npo', name: 'NPO (nothing by mouth)', category: 'nursing', durationMin: 1, costUSD: 0, synonyms: ['npo', 'nil by mouth', 'fasting'] },
  { code: 'foley', name: 'Indwelling urinary catheter + strict I/O', category: 'nursing', durationMin: 10, costUSD: 60, synonyms: ['catheter', 'foley', 'urinary output', 'i/o'] },
  { code: 'bladder_scan', name: 'Bladder scan (post-void residual)', category: 'nursing', durationMin: 4, costUSD: 20, synonyms: ['pvr', 'bladder'] },
  { code: 'orthostatics', name: 'Orthostatic vital signs', category: 'nursing', durationMin: 8, costUSD: 0, synonyms: ['orthostatic'] },
  { code: 'ice_elevate', name: 'Ice, elevation and compression', category: 'nursing', durationMin: 3, costUSD: 5, synonyms: ['rice', 'ice', 'elevate'] },
  { code: 'fall_precautions', name: 'Fall precautions', category: 'nursing', durationMin: 1, costUSD: 0, synonyms: ['falls'] },
  { code: 'delirium_bundle', name: 'Delirium prevention bundle (reorient, glasses/hearing aids, family)', category: 'nursing', durationMin: 2, costUSD: 0, synonyms: ['delirium', 'reorient'] },

  // ── Supplies / procedures ──
  { code: 'ankle_brace', name: 'Ankle brace (air stirrup)', category: 'supply', durationMin: 5, costUSD: 45, synonyms: ['aircast', 'brace', 'stirrup'] },
  { code: 'crutches', name: 'Crutches with gait training', category: 'supply', durationMin: 8, costUSD: 40, synonyms: ['crutches'] },
  { code: 'splint_posterior', name: 'Posterior short-leg splint', category: 'procedure', durationMin: 20, costUSD: 150, synonyms: ['splint', 'cast'] },

  // ── Consults ──
  { code: 'consult_cardiology', name: 'Consult: Cardiology / cath lab activation', category: 'consult', costUSD: 0, synonyms: ['cardiology', 'cath lab', 'stemi', 'pci', 'interventional'], description: 'Place the order AND call the cardiology fellow to discuss.' },
  { code: 'consult_surgery', name: 'Consult: General surgery', category: 'consult', costUSD: 0, synonyms: ['surgery', 'surgeon', 'general surgery', 'acute care surgery'] },
  { code: 'consult_medicine', name: 'Consult: Hospitalist (admission)', category: 'consult', costUSD: 0, synonyms: ['hospitalist', 'medicine', 'admit', 'internal medicine'] },
  { code: 'consult_icu', name: 'Consult: Critical care / ICU', category: 'consult', costUSD: 0, synonyms: ['icu', 'critical care', 'intensivist'] },
  { code: 'consult_obgyn', name: 'Consult: Obstetrics & gynecology', category: 'consult', costUSD: 0, synonyms: ['ob', 'gyn', 'obgyn'] },
  { code: 'consult_ortho', name: 'Consult: Orthopedics', category: 'consult', costUSD: 0, synonyms: ['ortho', 'orthopedic'] },

  // ── Medications ──
  med('aspirin', 'Aspirin chewable', { generic: 'aspirin', drugClass: 'Antiplatelet (COX inhibitor)', doses: ['324 mg', '162 mg', '81 mg'], routes: ['PO (chewed)'], frequencies: ['once'], tags: ['aspirin', 'antiplatelet'], allergyGroups: ['nsaid', 'aspirin'] }, 1, { synonyms: ['asa', 'aspirin'] }),
  med('ntg_sl', 'Nitroglycerin sublingual', { generic: 'nitroglycerin', drugClass: 'Nitrate', doses: ['0.4 mg'], routes: ['SL'], frequencies: ['q5min PRN chest pain, max 3'], tags: ['nitrate'] }, 5, { synonyms: ['nitro', 'ntg', 'gtn', 'nitroglycerin'] }),
  med('ntg_iv', 'Nitroglycerin infusion', { generic: 'nitroglycerin', drugClass: 'Nitrate', doses: ['10 mcg/min, titrate'], routes: ['IV infusion'], frequencies: ['continuous'], tags: ['nitrate'], highAlert: true }, 60, { synonyms: ['nitro drip', 'ntg drip'] }),
  med('heparin', 'Heparin (UFH) bolus + infusion, ACS nomogram', { generic: 'heparin', drugClass: 'Anticoagulant', doses: ['60 units/kg bolus (max 4000) + 12 units/kg/h'], routes: ['IV'], frequencies: ['continuous'], tags: ['anticoagulant'], highAlert: true }, 40, { synonyms: ['ufh', 'heparin drip'] }),
  med('enoxaparin', 'Enoxaparin', { generic: 'enoxaparin', drugClass: 'Anticoagulant (LMWH)', doses: ['1 mg/kg', '40 mg'], routes: ['SC'], frequencies: ['q12h', 'once daily'], tags: ['anticoagulant'], highAlert: true }, 30, { synonyms: ['lovenox', 'lmwh'] }),
  med('ticagrelor', 'Ticagrelor', { generic: 'ticagrelor', drugClass: 'P2Y12 inhibitor', doses: ['180 mg load'], routes: ['PO'], frequencies: ['once'], tags: ['antiplatelet', 'p2y12'] }, 40, { synonyms: ['brilinta', 'p2y12'] }),
  med('clopidogrel', 'Clopidogrel', { generic: 'clopidogrel', drugClass: 'P2Y12 inhibitor', doses: ['600 mg load', '300 mg load', '75 mg'], routes: ['PO'], frequencies: ['once'], tags: ['antiplatelet', 'p2y12'] }, 10, { synonyms: ['plavix'] }),
  med('atorvastatin', 'Atorvastatin', { generic: 'atorvastatin', drugClass: 'Statin', doses: ['80 mg', '40 mg'], routes: ['PO'], frequencies: ['once'], tags: ['statin'] }, 2, { synonyms: ['lipitor', 'statin'] }),
  med('metoprolol_iv', 'Metoprolol tartrate IV', { generic: 'metoprolol', drugClass: 'Beta-blocker', doses: ['5 mg', '2.5 mg'], routes: ['IV push over 2 min'], frequencies: ['q5min x3 PRN HR >110', 'once'], tags: ['beta_blocker', 'rate_control'] }, 5, { synonyms: ['lopressor', 'beta blocker', 'metoprolol'] }),
  med('metoprolol_po', 'Metoprolol tartrate PO', { generic: 'metoprolol', drugClass: 'Beta-blocker', doses: ['25 mg', '12.5 mg', '50 mg'], routes: ['PO'], frequencies: ['BID', 'once'], tags: ['beta_blocker', 'rate_control'] }, 1, { synonyms: ['lopressor po'] }),
  med('diltiazem_iv', 'Diltiazem IV', { generic: 'diltiazem', drugClass: 'Non-dihydropyridine CCB', doses: ['0.25 mg/kg (max 25 mg)', '10 mg'], routes: ['IV push over 2 min'], frequencies: ['once'], tags: ['ccb', 'rate_control'] }, 15, { synonyms: ['cardizem', 'dilt'] }),
  med('amiodarone_iv', 'Amiodarone IV', { generic: 'amiodarone', drugClass: 'Class III antiarrhythmic', doses: ['150 mg over 10 min'], routes: ['IV'], frequencies: ['once'], tags: ['antiarrhythmic', 'rate_control'], highAlert: true }, 30, { synonyms: ['cordarone'] }),
  med('apixaban', 'Apixaban', { generic: 'apixaban', drugClass: 'Direct oral anticoagulant', doses: ['5 mg', '2.5 mg'], routes: ['PO'], frequencies: ['BID'], tags: ['anticoagulant'] }, 15, { synonyms: ['eliquis', 'doac', 'noac'] }),
  med('morphine', 'Morphine IV', { generic: 'morphine', drugClass: 'Opioid analgesic', doses: ['4 mg', '2 mg', '6 mg'], routes: ['IV'], frequencies: ['once', 'q2h PRN'], tags: ['opioid', 'analgesic'], allergyGroups: ['opioid'], highAlert: true }, 5, { synonyms: ['morphine', 'mso4'] }),
  med('fentanyl', 'Fentanyl IV', { generic: 'fentanyl', drugClass: 'Opioid analgesic', doses: ['50 mcg', '25 mcg', '1 mcg/kg'], routes: ['IV'], frequencies: ['once', 'q1h PRN'], tags: ['opioid', 'analgesic'], allergyGroups: ['opioid'], highAlert: true }, 5, { synonyms: ['fentanyl'] }),
  med('hydromorphone', 'Hydromorphone IV', { generic: 'hydromorphone', drugClass: 'Opioid analgesic', doses: ['0.5 mg', '1 mg'], routes: ['IV'], frequencies: ['once', 'q3h PRN'], tags: ['opioid', 'analgesic'], allergyGroups: ['opioid'], highAlert: true }, 5, { synonyms: ['dilaudid'] }),
  med('apap_po', 'Acetaminophen PO', { generic: 'acetaminophen', drugClass: 'Analgesic / antipyretic', doses: ['1000 mg', '650 mg'], routes: ['PO'], frequencies: ['once', 'q6h PRN'], tags: ['antipyretic', 'analgesic_mild'] }, 1, { synonyms: ['tylenol', 'paracetamol', 'apap'] }),
  med('apap_iv', 'Acetaminophen IV', { generic: 'acetaminophen', drugClass: 'Analgesic / antipyretic', doses: ['1000 mg'], routes: ['IV over 15 min'], frequencies: ['once'], tags: ['antipyretic', 'analgesic_mild'] }, 30, { synonyms: ['ofirmev', 'iv paracetamol'] }),
  med('ibuprofen', 'Ibuprofen', { generic: 'ibuprofen', drugClass: 'NSAID', doses: ['600 mg', '400 mg', '800 mg'], routes: ['PO'], frequencies: ['once', 'q8h PRN with food'], tags: ['nsaid', 'analgesic_mild'], allergyGroups: ['nsaid'] }, 1, { synonyms: ['advil', 'motrin', 'nsaid'] }),
  med('ketorolac', 'Ketorolac IV', { generic: 'ketorolac', drugClass: 'NSAID', doses: ['15 mg', '10 mg'], routes: ['IV'], frequencies: ['once'], tags: ['nsaid', 'analgesic'], allergyGroups: ['nsaid'] }, 5, { synonyms: ['toradol'] }),
  med('ondansetron', 'Ondansetron', { generic: 'ondansetron', drugClass: 'Antiemetic (5-HT3)', doses: ['4 mg'], routes: ['IV', 'ODT'], frequencies: ['once', 'q8h PRN'], tags: ['antiemetic'] }, 3, { synonyms: ['zofran', 'antiemetic', 'nausea'] }),
  med('ns_bolus', 'Sodium chloride 0.9% bolus', { generic: 'normal saline', drugClass: 'Crystalloid', doses: ['1000 mL', '500 mL', '30 mL/kg'], routes: ['IV over 30 min'], frequencies: ['once'], tags: ['fluids'], volumeMl: 1000 }, 25, { synonyms: ['saline', 'ns', 'fluids', 'bolus', 'crystalloid'] }),
  med('lr_bolus', "Lactated Ringer's bolus", { generic: "lactated Ringer's", drugClass: 'Balanced crystalloid', doses: ['1000 mL', '500 mL', '30 mL/kg'], routes: ['IV over 30 min'], frequencies: ['once'], tags: ['fluids'], volumeMl: 1000 }, 25, { synonyms: ['lr', 'ringers', 'hartmann', 'fluids', 'bolus', 'balanced'] }),
  med('ceftriaxone', 'Ceftriaxone', { generic: 'ceftriaxone', drugClass: '3rd-gen cephalosporin', doses: ['1 g', '2 g'], routes: ['IV'], frequencies: ['q24h', 'once'], tags: ['abx', 'abx_ceftriaxone'], allergyGroups: ['cephalosporin'] }, 15, { synonyms: ['rocephin', 'ctx', 'antibiotic'] }),
  med('cefepime', 'Cefepime', { generic: 'cefepime', drugClass: '4th-gen cephalosporin', doses: ['2 g', '1 g'], routes: ['IV'], frequencies: ['q8h', 'q12h'], tags: ['abx', 'abx_cefepime'], allergyGroups: ['cephalosporin'] }, 30, { synonyms: ['maxipime', 'antibiotic'] }),
  med('pip_tazo', 'Piperacillin-tazobactam', { generic: 'piperacillin-tazobactam', drugClass: 'Penicillin + beta-lactamase inhibitor', doses: ['4.5 g', '3.375 g'], routes: ['IV'], frequencies: ['q6h', 'q8h extended infusion'], tags: ['abx', 'abx_piptazo'], allergyGroups: ['penicillin'] }, 40, { synonyms: ['zosyn', 'tazocin', 'pip tazo', 'antibiotic'] }),
  med('meropenem', 'Meropenem', { generic: 'meropenem', drugClass: 'Carbapenem', doses: ['1 g', '2 g'], routes: ['IV'], frequencies: ['q8h'], tags: ['abx', 'abx_carbapenem'], allergyGroups: ['carbapenem'] }, 60, { synonyms: ['merrem', 'carbapenem', 'antibiotic'] }),
  med('ertapenem', 'Ertapenem', { generic: 'ertapenem', drugClass: 'Carbapenem', doses: ['1 g'], routes: ['IV'], frequencies: ['q24h'], tags: ['abx', 'abx_carbapenem'], allergyGroups: ['carbapenem'] }, 70, { synonyms: ['invanz', 'carbapenem', 'antibiotic'] }),
  med('vancomycin', 'Vancomycin', { generic: 'vancomycin', drugClass: 'Glycopeptide', doses: ['25 mg/kg load', '1.5 g', '1 g'], routes: ['IV'], frequencies: ['once', 'per pharmacy'], tags: ['abx', 'abx_vanc'] }, 30, { synonyms: ['vanc', 'vanco', 'antibiotic'] }),
  med('metronidazole', 'Metronidazole', { generic: 'metronidazole', drugClass: 'Nitroimidazole', doses: ['500 mg'], routes: ['IV', 'PO'], frequencies: ['q8h', 'q12h'], tags: ['abx', 'abx_metro'] }, 10, { synonyms: ['flagyl', 'metro', 'antibiotic'] }),
  med('cefoxitin', 'Cefoxitin', { generic: 'cefoxitin', drugClass: '2nd-gen cephalosporin (cephamycin)', doses: ['2 g'], routes: ['IV'], frequencies: ['q6h', 'once'], tags: ['abx', 'abx_cefoxitin'], allergyGroups: ['cephalosporin'] }, 20, { synonyms: ['mefoxin', 'antibiotic'] }),
  med('amp_sulb', 'Ampicillin-sulbactam', { generic: 'ampicillin-sulbactam', drugClass: 'Penicillin + beta-lactamase inhibitor', doses: ['3 g'], routes: ['IV'], frequencies: ['q6h'], tags: ['abx', 'abx_ampsulb'], allergyGroups: ['penicillin'] }, 15, { synonyms: ['unasyn', 'antibiotic'] }),
  med('ciprofloxacin', 'Ciprofloxacin', { generic: 'ciprofloxacin', drugClass: 'Fluoroquinolone', doses: ['400 mg IV', '500 mg PO'], routes: ['IV', 'PO'], frequencies: ['q12h'], tags: ['abx', 'abx_fq'] }, 10, { synonyms: ['cipro', 'fluoroquinolone', 'antibiotic'] }),
  med('norepinephrine', 'Norepinephrine infusion', { generic: 'norepinephrine', drugClass: 'Vasopressor', doses: ['0.05 mcg/kg/min, titrate to MAP ≥65'], routes: ['IV infusion (peripheral OK short-term)'], frequencies: ['continuous'], tags: ['pressor'], highAlert: true }, 80, { synonyms: ['levophed', 'pressor', 'noradrenaline', 'vasopressor'] }),
  med('pantoprazole', 'Pantoprazole IV', { generic: 'pantoprazole', drugClass: 'Proton pump inhibitor', doses: ['40 mg', '80 mg'], routes: ['IV'], frequencies: ['once', 'q12h'], tags: ['ppi'] }, 10, { synonyms: ['protonix', 'ppi'] }),
  med('haloperidol', 'Haloperidol', { generic: 'haloperidol', drugClass: 'Antipsychotic', doses: ['0.5 mg', '1 mg', '2.5 mg'], routes: ['IV', 'IM'], frequencies: ['once'], tags: ['antipsychotic', 'sedative'] }, 5, { synonyms: ['haldol'] }),
  med('lorazepam', 'Lorazepam', { generic: 'lorazepam', drugClass: 'Benzodiazepine', doses: ['0.5 mg', '1 mg', '2 mg'], routes: ['IV', 'PO'], frequencies: ['once'], tags: ['benzodiazepine', 'sedative'] }, 5, { synonyms: ['ativan', 'benzo'] }),
  med('diphenhydramine', 'Diphenhydramine', { generic: 'diphenhydramine', drugClass: 'Antihistamine', doses: ['25 mg', '50 mg'], routes: ['IV', 'PO'], frequencies: ['once'], tags: ['antihistamine'] }, 3, { synonyms: ['benadryl'] }),
  med('tdap', 'Tetanus/diphtheria/pertussis (Tdap)', { generic: 'Tdap', drugClass: 'Vaccine', doses: ['0.5 mL'], routes: ['IM'], frequencies: ['once'], tags: ['vaccine'] }, 45, { synonyms: ['tetanus', 'boostrix', 'adacel'] }),
];

ORDER_LIST.push(...additionalOrders);

export const ORDERS: Record<string, OrderDef> = Object.fromEntries(ORDER_LIST.map((o) => [o.code, o]));

export const ORDER_SETS: OrderSetDef[] = [
  {
    code: 'set_chest_pain',
    name: 'ED Chest Pain',
    items: [
      { code: 'ecg12', defaultChecked: true },
      { code: 'monitor', defaultChecked: true },
      { code: 'iv_access', defaultChecked: true },
      { code: 'trop', defaultChecked: true },
      { code: 'cbc', defaultChecked: true },
      { code: 'bmp', defaultChecked: true },
      { code: 'coags', defaultChecked: false },
      { code: 'xr_chest_port', defaultChecked: true },
      { code: 'aspirin', params: { dose: '324 mg', route: 'PO (chewed)', frequency: 'once' }, defaultChecked: false },
      { code: 'lipids', defaultChecked: false },
    ],
  },
  {
    code: 'set_sepsis',
    name: 'ED Sepsis (adult) — Hour-1 bundle',
    items: [
      { code: 'lactate', defaultChecked: true },
      { code: 'bcx', defaultChecked: true },
      { code: 'cbc', defaultChecked: true },
      { code: 'cmp', defaultChecked: true },
      { code: 'ua', defaultChecked: true },
      { code: 'ucx', defaultChecked: true },
      { code: 'coags', defaultChecked: false },
      { code: 'pct', defaultChecked: false },
      { code: 'xr_chest_port', defaultChecked: true },
      { code: 'iv_access', defaultChecked: true },
      { code: 'monitor', defaultChecked: true },
      { code: 'lr_bolus', params: { dose: '30 mL/kg', route: 'IV over 30 min', frequency: 'once' }, defaultChecked: false },
    ],
  },
  {
    code: 'set_abd_pain',
    name: 'ED Abdominal Pain',
    items: [
      { code: 'iv_access', defaultChecked: true },
      { code: 'cbc', defaultChecked: true },
      { code: 'cmp', defaultChecked: true },
      { code: 'lipase', defaultChecked: true },
      { code: 'ua', defaultChecked: true },
      { code: 'hcg_u', defaultChecked: true },
      { code: 'crp', defaultChecked: false },
      { code: 'ondansetron', params: { dose: '4 mg', route: 'IV', frequency: 'once' }, defaultChecked: false },
      { code: 'morphine', params: { dose: '4 mg', route: 'IV', frequency: 'once' }, defaultChecked: false },
    ],
  },
  {
    code: 'set_afib',
    name: 'ED Atrial Fibrillation',
    items: [
      { code: 'ecg12', defaultChecked: true },
      { code: 'monitor', defaultChecked: true },
      { code: 'iv_access', defaultChecked: true },
      { code: 'cbc', defaultChecked: true },
      { code: 'bmp', defaultChecked: true },
      { code: 'mg', defaultChecked: true },
      { code: 'tsh', defaultChecked: true },
      { code: 'trop', defaultChecked: false },
      { code: 'coags', defaultChecked: false },
      { code: 'xr_chest_port', defaultChecked: false },
    ],
  },
  {
    code: 'set_minor_injury',
    name: 'ED Minor Extremity Injury',
    items: [
      { code: 'ice_elevate', defaultChecked: true },
      { code: 'ibuprofen', params: { dose: '600 mg', route: 'PO', frequency: 'once' }, defaultChecked: true },
      { code: 'xr_ankle', defaultChecked: false },
      { code: 'ankle_brace', defaultChecked: false },
      { code: 'crutches', defaultChecked: false },
    ],
  },
];

// ───────────────────────────── exam ─────────────────────────────

const X = (id: string, system: string, label: string, normal: string, minutes = 1, chaperone = false): ExamManeuverDef => ({ id, system, label, normal, minutes, chaperone });

export const EXAM_MANEUVERS: ExamManeuverDef[] = [
  X('gen_appearance', 'General', 'General appearance', 'Well-appearing, in no acute distress.', 0.5),
  X('gen_mental', 'General', 'Mental status & orientation', 'Alert and oriented to person, place, time and situation. Attention intact. Speech fluent.', 1),
  X('skin_inspect', 'Skin', 'Skin color, moisture, rash', 'Warm and dry, normal color. No rash, no mottling.', 0.5),
  X('skin_capref', 'Skin', 'Capillary refill', 'Capillary refill < 2 s.', 0.5),
  X('heent_mucosa', 'HEENT', 'Mucous membranes', 'Moist mucous membranes.', 0.5),
  X('heent_pupils', 'HEENT', 'Pupils', 'PERRL, 3 → 2 mm, brisk.', 0.5),
  X('heent_vision', 'HEENT', 'Visual acuity and fields', 'Vision at reported baseline in each eye. Confrontation fields full.', 2),
  X('heent_fundus', 'HEENT', 'Fundoscopy', 'Visible retina flat with sharp disc margins.', 2),
  X('heent_fluorescein', 'HEENT', 'Fluorescein examination', 'No epithelial stain uptake or aqueous leak.', 2),
  X('heent_otoscopy', 'HEENT', 'Otoscopy', 'Canals clear. Tympanic membranes intact without effusion.', 1),
  X('neck_jvp', 'Neck', 'Jugular venous pressure', 'JVP not elevated (~6 cm H2O). No hepatojugular reflux.', 1),
  X('neck_stiffness', 'Neck', 'Neck stiffness / meningismus', 'Neck supple, no meningismus.', 0.5),
  X('cv_auscultate', 'Cardiovascular', 'Heart auscultation', 'Regular rate and rhythm. Normal S1 and S2. No murmurs, rubs or gallops.', 1),
  X('cv_pulses', 'Cardiovascular', 'Peripheral pulses (bilateral)', 'Radial, femoral and dorsalis pedis pulses 2+ and symmetric.', 1),
  X('cv_bp_both_arms', 'Cardiovascular', 'Blood pressure in both arms', 'Right and left arm systolic pressures within 10 mmHg.', 2),
  X('cv_edema', 'Cardiovascular', 'Peripheral edema', 'No lower-extremity edema. Calves soft and non-tender.', 0.5),
  X('pulm_effort', 'Pulmonary', 'Work of breathing', 'Unlabored breathing, speaks in full sentences, no accessory muscle use.', 0.5),
  X('pulm_auscultate', 'Pulmonary', 'Lung auscultation', 'Clear to auscultation bilaterally. No wheezes, crackles or rhonchi.', 1),
  X('pulm_percuss', 'Pulmonary', 'Chest percussion', 'Resonant bilaterally.', 1),
  X('abd_inspect', 'Abdomen', 'Inspection', 'Flat, no distension, no scars or hernias.', 0.5),
  X('abd_auscultate', 'Abdomen', 'Bowel sounds', 'Normoactive bowel sounds.', 0.5),
  X('abd_palpate', 'Abdomen', 'Palpation (all quadrants)', 'Soft, non-tender, non-distended. No guarding, no masses.', 1),
  X('abd_rebound', 'Abdomen', 'Rebound / percussion tenderness', 'No rebound or percussion tenderness.', 0.5),
  X('abd_mcburney', 'Abdomen', "McBurney's point", "No tenderness at McBurney's point.", 0.5),
  X('abd_rovsing', 'Abdomen', "Rovsing's sign", "Rovsing's sign negative.", 0.5),
  X('abd_psoas', 'Abdomen', 'Psoas sign', 'Psoas sign negative.', 0.5),
  X('abd_obturator', 'Abdomen', 'Obturator sign', 'Obturator sign negative.', 0.5),
  X('abd_murphy', 'Abdomen', "Murphy's sign", "Murphy's sign negative.", 0.5),
  X('back_cva', 'Back', 'Costovertebral angle tenderness', 'No CVA tenderness bilaterally.', 0.5),
  X('gu_pelvic', 'GU', 'Pelvic exam (chaperoned)', 'Normal external genitalia. No cervical motion tenderness, no adnexal tenderness or masses. No discharge or bleeding.', 5, true),
  X('gu_testicular', 'GU', 'Testicular exam', 'Testes descended, non-tender, no masses. Cremasteric reflex present.', 2, true),
  X('neuro_gcs', 'Neuro', 'Glasgow Coma Scale', 'GCS 15 (E4 V5 M6).', 0.5),
  X('neuro_focal', 'Neuro', 'Focal neuro exam (CN, strength, sensation)', 'Cranial nerves II–XII intact. Strength 5/5 and sensation intact in all four extremities. No pronator drift.', 2),
  X('heent_tonometry', 'HEENT', 'Intraocular pressure (tonometry)', 'Intraocular pressures within the reference interval in both eyes.', 2),
  X('vestibular_position', 'Neuro', 'Positional testing (Dix–Hallpike)', 'No positional nystagmus elicited.', 2),
  X('neuro_cam', 'Neuro', 'Delirium screen (CAM)', 'CAM negative — attention intact (months of the year backwards without errors).', 1),
  X('neuro_gait', 'Neuro', 'Gait', 'Normal, steady gait.', 1),
  X('msk_ankle_inspect', 'Ankle/Foot', 'Ankle inspection', 'No swelling, ecchymosis or deformity.', 0.5),
  X('msk_lat_malleolus', 'Ankle/Foot', 'Posterior edge/tip of lateral malleolus (distal 6 cm)', 'No bony tenderness.', 0.5),
  X('msk_med_malleolus', 'Ankle/Foot', 'Posterior edge/tip of medial malleolus (distal 6 cm)', 'No bony tenderness.', 0.5),
  X('msk_5th_mt', 'Ankle/Foot', 'Base of 5th metatarsal', 'No bony tenderness.', 0.5),
  X('msk_navicular', 'Ankle/Foot', 'Navicular bone', 'No bony tenderness.', 0.5),
  X('msk_weight_bearing', 'Ankle/Foot', 'Weight bearing (4 steps)', 'Able to bear weight and take four steps unassisted.', 1),
  X('msk_ant_drawer', 'Ankle/Foot', 'Anterior drawer test', 'Negative, firm endpoint, symmetric with the other side.', 0.5),
  X('msk_squeeze', 'Ankle/Foot', 'Squeeze test (syndesmosis)', 'Negative.', 0.5),
  X('msk_thompson', 'Ankle/Foot', 'Thompson test (Achilles)', 'Negative — plantarflexion with calf squeeze.', 0.5),
  X('msk_neurovascular', 'Ankle/Foot', 'Distal neurovascular status', 'DP/PT pulses 2+, sensation intact, capillary refill < 2 s.', 0.5),
  // bedside ultrasound, one view each: the read is the case's or a normal study for this patient (server/sim/pocus.ts)
  ...POCUS_WINDOWS.map((w) => X(pocusManeuver(w.id), 'Bedside ultrasound', w.label, 'Normal study.', w.minutes)),
];

export const EXAM_BY_ID: Record<string, ExamManeuverDef> = Object.fromEntries(EXAM_MANEUVERS.map((m) => [m.id, m]));

// ───────────────────────────── search helpers ─────────────────────────────

/** Simple ranked order search used by the EHR and by AI agents. */
export function searchOrders(query: string, limit = 25): OrderDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { o: OrderDef; s: number }[] = [];
  for (const o of ORDER_LIST) {
    const name = o.name.toLowerCase();
    let s = 0;
    if (o.code === q) s = 100;
    else if (name.startsWith(q)) s = 80;
    else if (name.includes(q)) s = 60;
    else if (o.synonyms?.some((syn) => syn.startsWith(q))) s = 55;
    else if (o.synonyms?.some((syn) => syn.includes(q))) s = 40;
    else if (o.med?.generic.toLowerCase().includes(q) || o.med?.brand?.toLowerCase().includes(q)) s = 50;
    if (s > 0) scored.push({ o, s });
  }
  return scored.sort((a, b) => b.s - a.s || a.o.name.localeCompare(b.o.name)).slice(0, limit).map((x) => x.o);
}

export function refRange(analyte: LabAnalyteDef, sex: 'M' | 'F'): [number, number] | undefined {
  if (!analyte.ref) return undefined;
  return Array.isArray(analyte.ref) ? analyte.ref : analyte.ref[sex];
}
