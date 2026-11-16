// Additional investigations used by the broader ED case catalog. Result values and radiology
// reports live only in the server-side cases.
import type { LabAnalyteDef, OrderDef } from './types';

export const additionalAnalytes: LabAnalyteDef[] = [
  { code: 'ferritin', short: 'Ferritin', name: 'Ferritin', section: 'Hematology', unit: 'ng/mL', ref: { F: [15,150], M: [30,400] }, decimals: 0 },
  { code: 'smear', short: 'Smear', name: 'Peripheral blood film', section: 'Hematology', unit: '', text: true, normalText: 'Unremarkable morphology' },
  { code: 'cohb', short: 'COHb', name: 'Carboxyhemoglobin', section: 'Blood Gas', unit: '%', ref: [0, 2], decimals: 1 },
  { code: 'methb', short: 'MetHb', name: 'Methemoglobin', section: 'Blood Gas', unit: '%', ref: [0, 1.5], decimals: 1 },
  { code: 'bhb', short: 'BHB', name: 'Beta-hydroxybutyrate', section: 'Chemistry', unit: 'mmol/L', ref: [0, 0.6], decimals: 1 },
];
const study = (code: string, name: string, modality: 'CT' | 'MRI' | 'US', synonyms: string[]): OrderDef => ({
  code, name, modality, category: 'imaging', acquireMin: modality === 'MRI' ? [45, 90] : [15, 35], readMin: [15, 30],
  costUSD: modality === 'MRI' ? 1500 : modality === 'US' ? 350 : 900, synonyms,
});

export const additionalOrders: OrderDef[] = [
  { code: 'oxygen_nrb', name: 'High-concentration oxygen via nonrebreather reservoir mask', category: 'nursing', durationMin: 1, costUSD: 20, synonyms: ['high flow oxygen', 'NRB', 'reservoir mask', '100% oxygen'] },
  { code: 'iron_stores', name: 'Serum ferritin', category: 'lab', specimen: 'Blood', analytes: ['ferritin'], tatMin: [45, 90], costUSD: 30, synonyms: ['iron stores', 'iron deficiency'] },
  { code: 'reposition_canalith', name: 'Canalith repositioning with a trained clinician', category: 'procedure', durationMin: 6, costUSD: 25, synonyms: ['Epley maneuver', 'BPPV repositioning'] },
  { code: 'magnesium_iv', name: 'Magnesium sulfate replacement', category: 'med', costUSD: 10, med: { generic: 'magnesium sulfate', drugClass: 'Electrolyte', doses: ['per monitored replacement protocol'], routes: ['IV infusion'], frequencies: ['per protocol'], tags: ['magnesium_replacement'] } },
  { code: 'methylpred_iv', name: 'Methylprednisolone IV', category: 'med', costUSD: 25, med: { generic: 'methylprednisolone', drugClass: 'Glucocorticoid', doses: ['per specialty protocol'], routes: ['IV infusion'], frequencies: ['per protocol'], tags: ['corticosteroid'] } },
  { code: 'blood_film', name: 'Peripheral blood film', category: 'lab', specimen: 'Blood', analytes: ['smear'], tatMin: [30, 55], costUSD: 30, synonyms: ['blood smear', 'schistocytes'] },
  { code: 'coox', name: 'Blood gas co-oximetry', category: 'lab', specimen: 'Venous blood', analytes: ['cohb', 'methb'], tatMin: [8, 15], costUSD: 40, synonyms: ['carboxyhemoglobin', 'methemoglobin', 'cooximetry'] },
  { code: 'ketones', name: 'Serum beta-hydroxybutyrate', category: 'lab', specimen: 'Blood', analytes: ['bhb'], tatMin: [15, 30], costUSD: 35, synonyms: ['blood ketones', 'bhb'] },
  study('ct_cspine', 'CT cervical spine without contrast', 'CT', ['neck CT', 'c-spine']),
  study('mri_spine', 'MRI spine, targeted to symptomatic level', 'MRI', ['cord compression', 'spine MRI']),
  study('mri_brain', 'MRI brain', 'MRI', ['brain MRI']),
  study('cta_head_neck', 'CT angiography head and neck', 'CT', ['cerebral angiogram', 'neck CTA']),
  study('ct_venogram', 'CT venography of the head', 'CT', ['CTV', 'venous sinuses']),
  study('us_scrotum', 'US scrotum with Doppler', 'US', ['testicular ultrasound', 'scrotal flow']),
  study('ct_neck_chest', 'CT soft tissues of neck and chest with IV contrast', 'CT', ['deep neck infection','neck and chest CT']),
  study('cta_mesenteric', 'CT angiography abdomen and pelvis, mesenteric vessels', 'CT', ['mesenteric CTA']),
  study('ct_esophagram', 'CT chest with water-soluble oral contrast', 'CT', ['esophagram', 'esophageal leak']),
  { code: 'epi_im', name: 'Epinephrine IM for anaphylaxis (adult)', category: 'med', costUSD: 10,
    med: { generic: 'epinephrine', drugClass: 'Adrenergic agonist', doses: ['0.5 mg (1 mg/mL)'], routes: ['IM outer thigh'], frequencies: ['once, reassess at 5 min'], highAlert: true, tags: ['im_epinephrine'] } },
  { code: 'oral_glucose', name: 'Oral glucose for hypoglycemia', category: 'med', costUSD: 3,
    med: { generic: 'glucose', drugClass: 'Carbohydrate', doses: ['15 g'], routes: ['PO when able to swallow safely'], frequencies: ['once, recheck at 15 min'], tags: ['oral_glucose'] } },
  { code: 'thiamine_iv', name: 'Parenteral thiamine', category: 'med', costUSD: 8,
    med: { generic: 'thiamine', drugClass: 'Vitamin', doses: ['per deficiency protocol'], routes: ['IV'], frequencies: ['per protocol'], tags: ['thiamine'] } },
  { code: 'furosemide_iv', name: 'Furosemide IV', category: 'med', costUSD: 6,
    med: { generic: 'furosemide', drugClass: 'Loop diuretic', doses: ['40 mg', '20 mg', '80 mg'], routes: ['IV'], frequencies: ['once, reassess response'], tags: ['diuretic'] } },
  { code: 'cefazolin', name: 'Cefazolin IV', category: 'med', costUSD: 9,
    med: { generic: 'cefazolin', drugClass: 'First-generation cephalosporin', doses: ['2 g', '1 g'], routes: ['IV'], frequencies: ['once', 'per prophylaxis protocol'], tags: ['abx', 'abx_cefazolin'], allergyGroups: ['cephalosporin'] } },
  { code: 'azithromycin', name: 'Azithromycin', category: 'med', costUSD: 10,
    med: { generic: 'azithromycin', drugClass: 'Macrolide', doses: ['500 mg'], routes: ['PO', 'IV infusion'], frequencies: ['once daily'], tags: ['abx', 'abx_macrolide'], allergyGroups: ['macrolide'] } },
  { code: 'nitrofurantoin', name: 'Nitrofurantoin monohydrate/macrocrystals', category: 'med', costUSD: 3,
    med: { generic: 'nitrofurantoin', drugClass: 'Urinary antibacterial', doses: ['100 mg'], routes: ['PO'], frequencies: ['q12h'], tags: ['abx', 'abx_nitrofurantoin'] } },
  { code: 'cephalexin', name: 'Cephalexin', category: 'med', costUSD: 3,
    med: { generic: 'cephalexin', drugClass: 'First-generation cephalosporin', doses: ['500 mg'], routes: ['PO'], frequencies: ['q6h'], tags: ['abx', 'abx_cephalexin'], allergyGroups: ['cephalosporin'] } },
  { code: 'valacyclovir', name: 'Valacyclovir', category: 'med', costUSD: 6,
    med: { generic: 'valacyclovir', drugClass: 'Antiviral', doses: ['1 g'], routes: ['PO'], frequencies: ['q8h'], tags: ['antiviral'] } },
  { code: 'ceftriaxone_im', name: 'Ceftriaxone IM', category: 'med', costUSD: 6,
    med: { generic: 'ceftriaxone', drugClass: 'Third-generation cephalosporin', doses: ['500 mg'], routes: ['IM'], frequencies: ['once'], tags: ['abx', 'abx_ceftriaxone'], allergyGroups: ['cephalosporin'] } },
  { code: 'doxycycline', name: 'Doxycycline', category: 'med', costUSD: 4,
    med: { generic: 'doxycycline', drugClass: 'Tetracycline', doses: ['100 mg'], routes: ['PO', 'IV infusion'], frequencies: ['q12h'], tags: ['abx', 'abx_doxycycline'], allergyGroups: ['tetracycline'] } },
];
