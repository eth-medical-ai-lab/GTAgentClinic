import type { CaseDef } from '../types';
import { compileBrief, type CaseBrief } from './brief';
import { codexAuthor } from './provenance';

// In these encounters the patient cannot supply the whole history. The witness, bottle or
// dispensing record is a separate source that a resident can actually interview or inspect.
function encounter(b: CaseBrief): CaseDef {
  return compileBrief(b, { kind: 'original', author: codexAuthor, review: 'unreviewed',
    file: 'content/cases/collateral.ts', method: 'Fictional patient, witness or dispensing record written for this simulation. The references inform the clinical decisions; none describes this patient.' });
}

const amnesia = encounter({
  id: 'transient_global_amnesia', specialty: 'neurology', age: 64, sex: 'M', difficulty: 2, esi: 2,
  complaint: 'Keeps asking why he is here', opening: 'Is something wrong? I remember my morning walk. Did I drive us here?',
  facts: [['Preserved identity and remote memory', ['name', 'who', 'work', 'remember', 'partner'], 'Of course I know my partner. We met teaching at the same school. I just cannot tell you how we got here.']],
  exam: { neuro_focal: 'Names objects, follows two-part commands and moves all four limbs equally. No field cut or dysarthria.',
    neuro_cam: 'Attentive; registers three words immediately but recalls none five minutes later. Asks again why he is here.' },
  diagnosis: 'Transient global amnesia', synonyms: ['TGA'], icd10: 'G45.4', disposition: 'observation', acceptable: ['admit_floor'],
  steps: [['Establish the onset with the witness', { type: 'fact', factIds: ['witness_sequence'] }],
    ['Check for a glucose disturbance', { type: 'order', codes: ['glu_poc'] }]],
  teaching: 'Witnessed isolated amnesia with preserved identity and attention supports this diagnosis. Observe until recovery; focal deficits or persistent symptoms require investigation for another cause.',
  capacity: 'impaired', labs: { glu: 98 }, imaging: { ct_head: 'No acute hemorrhage or mass effect. A normal noncontrast scan does not exclude acute ischemia.' },
  outcome: 'No focal signs emerged on serial examinations. He could retain new memories again that evening, but never recalled the trip to the ED.',
  references: ['German Society of Neurology. Guideline: transient global amnesia. https://doi.org/10.1186/s42466-023-00240-0'],
});
amnesia.presentation.initialEmotion = 'confused';
amnesia.family = {
  npcId: 'fam_morgan', name: 'Morgan Vale', relation: 'Partner', voice: { id: 'bf_emma' },
  appearance: { age: 'adult', height: 1.68, build: 'average', skin: '#b68369', hair: '#736253', hairStyle: 'bun', outfit: 'casual', outfitColor: '#586b79' },
  persona: { healthLiteracy: 'average', capacity: 'intact', voice: 'Matter of fact until asked about the drive.',
    personality: 'A retired teacher who watched the whole event and is afraid this is a stroke.',
    opening: 'At breakfast he had just finished the crossword. An hour and a half ago something changed.',
    facts: [{ id: 'witness_sequence', key: true, label: 'Witnessed onset and repetitive questioning',
      keywords: ['onset', 'last well', 'when', 'sudden', 'happened', 'repeat', 'memory'],
      text: 'He suddenly asked what day it was. I answered, and two minutes later he asked the very same thing. He knew me throughout.' },
      { id: 'witness_negatives', key: true, label: 'No loss of consciousness or focal symptoms',
        keywords: ['collapse', 'shake', 'seizure', 'speech', 'weak', 'fall', 'injury'],
        text: 'He stayed awake, never shook or fell, and kept speaking clearly. Both hands worked normally when he put on his jacket.' }],
    unknowns: ['test results', 'the diagnosis'], behavior: ['Describe what you saw; let him speak for himself about how it feels.'],
    fallback: 'I was there the whole time. Which part would you like me to describe?' },
};

const diuretic = encounter({
  id: 'thiazide_hyponatremia', specialty: 'renal', age: 74, sex: 'F', difficulty: 2, esi: 3, mobility: 'wheelchair',
  complaint: 'Nausea and feeling unsteady', opening: 'Yesterday I felt fine on the stairs. Today I had to grab the rail.',
  facts: [['Recently changed blood pressure medicine', ['medicine', 'medication', 'pill', 'change', 'blood pressure'], 'My clinic added a little tablet about a week ago. The label is in my bag.'],
    ['Free water intake', ['drink', 'water', 'fluid', 'thirst'], 'A neighbor suggested drinking more water so the tablet would not dry me out. I have been doing that.']],
  exam: { neuro_focal: 'Alert, attentive and fully oriented. Speech, strength and sensation are symmetric.', neuro_gait: 'Needs support on turning; independent at baseline.' },
  diagnosis: 'Thiazide-associated hyponatremia', synonyms: ['hyponatremia', 'hyponatraemia'], icd10: 'E87.1', disposition: 'observation', acceptable: ['admit_floor'],
  labs: { na: 126, k: 3.2, cl: 89, hco3: 25, bun: 14, creat: 0.8, glu: 92, agap: 12 },
  items: [{ id: 'recent_prescription', kind: 'pillBottle', where: 'bedside', label: 'New prescription bottle', text: 'Hydrochlorothiazide. First dispensed eight days ago for high blood pressure.', facts: ['recent_fill'] }],
  steps: [['Measure serum electrolytes', { type: 'order', codes: ['bmp', 'cmp'] }], ['Identify the newly dispensed drug', { type: 'fact', factIds: ['recent_fill'] }]],
  teaching: 'Compare sodium with its baseline and reconcile recent prescriptions. Withhold the suspected drug and observe symptoms, urine output and serial electrolytes; correction can accelerate after stopping a thiazide.',
  references: ['European clinical practice guideline on diagnosis and treatment of hyponatraemia. https://doi.org/10.1530/EJE-13-1020'],
});
diuretic.presentation.priorLabs = [{ analyte: 'na', value: 139, daysAgo: 12 }];
diuretic.persona.facts.push({ id: 'recent_fill', label: 'Hydrochlorothiazide started eight days ago', key: true,
  text: 'I kept the label. It says hydrochlorothiazide; that is the new one from last week.', keywords: ['label', 'which tablet', 'thiazide', 'water pill', 'name of the drug'] });

const seizure = encounter({
  id: 'breakthrough_seizure_refill', specialty: 'neurology', age: 36, sex: 'M', difficulty: 2, esi: 3, arrivalMode: 'EMS',
  complaint: 'Recovered after a witnessed convulsion', opening: 'I feel like myself again. I really thought the new pharmacy would have my refill.',
  facts: [['Usual seizure pattern', ['usual', 'before', 'typical', 'seizure', 'witness'], 'My housemate told the crew it looked like my old seizures. Just one, about a minute. No fall or head injury.'],
    ['Refill gap', ['dose', 'miss', 'medicine', 'refill', 'pharmacy'], 'I missed the last two doses after switching pharmacies. It was not a decision to stop treatment.']],
  exam: { neuro_focal: 'Converses normally. No focal deficit.', neuro_gcs: 'E4 V5 M6; back at baseline.' },
  problems: ['Epilepsy'], diagnosis: 'Breakthrough seizure after interruption of antiseizure medication', synonyms: ['breakthrough seizure', 'epileptic seizure', 'seizure due to missed medication'],
  icd10: 'G40.909', disposition: 'discharge', acceptable: ['observation'], labs: { glu: 97, na: 140 },
  steps: [['Exclude hypoglycemia', { type: 'order', codes: ['glu_poc'] }], ['Verify the ongoing regimen with the pharmacy', { type: 'fact', factIds: ['verified_regimen'] }]],
  counseling: ['Agree a safe restart and refill plan', ['refill', 'supply', 'pharmacy has', 'pick up', 'bridge prescription'], 'Arrange access to the verified regular medication today; explain driving and seizure precautions, indications to return and early follow-up.'],
  teaching: 'Confirm the event, return to baseline and medication access before discharge. Arrange the regular regimen, a supply in hand, safety advice and follow-up.',
  references: ['NICE NG217: principles of treatment and monitoring. https://www.nice.org.uk/guidance/ng217/chapter/4-Principles-of-treatment-safety-monitoring-and-withdrawal',
    'NICE CG76: medicines adherence. https://www.nice.org.uk/guidance/cg76/chapter/Recommendations'],
});
seizure.phoneContacts = [{
  contact: { id: 'rx_counter', kind: 'external', name: 'Dispensing pharmacist', org: 'Community pharmacy', role: 'Pharmacist', phone: '555-0116' },
  requiresIdentifiers: true, voice: { id: 'am_echo' },
  persona: { personality: 'Checks the dispensing record and transfer request before answering.', healthLiteracy: 'high', capacity: 'intact', voice: 'Precise and unhurried.',
    opening: 'Dispensary here. May I verify who you are calling about?', behavior: ['Verify identifiers before discussing prescriptions.'],
    facts: [{ id: 'verified_regimen', label: 'Verified regimen and same-day supply', key: true, keywords: ['regimen', 'refill', 'dose', 'dispens', 'medication', 'supply'],
      text: 'His regular prescription is levetiracetam 500 mg twice daily. The transfer is complete now. I can supply his usual tablets today.' }],
    unknowns: ['what happened during the seizure'], fallback: 'I can confirm his refill and regular regimen from our record.' },
}];

export const collateral = [amnesia, diuretic, seizure];

// Full encounter detail stays with the three fictional collateral cases. The witness and
// pharmacy records remain necessary: the patient's chart does not silently reveal their facts.
amnesia.persona.personality = 'Polite retired teacher, frightened by the unexplained gap in recent memory. Recognizes partner and own identity.';
amnesia.persona.behavior = ['Repeat a recent question naturally, without inventing memories of the journey.', 'Answer remote-history questions consistently. Refer questions about the episode to the partner.'];
amnesia.persona.facts.push(
  { id: 'remote_history', label: 'Reliable remote history', text: 'I taught mathematics for years. I take amlodipine for blood pressure. I do not usually have memory trouble.', keywords: ['history', 'work', 'medicine', 'background'], key: false },
  { id: 'current_symptoms', label: 'No current pain or focal complaint', text: 'Nothing hurts. Both arms feel normal. I just do not understand why we are here.', keywords: ['pain', 'headache', 'weakness', 'feel'], key: false },
  { id: 'allergies', label: 'Allergy history', text: 'I have never had a reaction to a medicine.', keywords: ['allerg'], key: false },
);
amnesia.family!.persona.facts.push(
  { id: 'witness_baseline', label: 'Independent cognition before this event', key: true, keywords: ['baseline', 'usual', 'memory', 'dementia'], text: 'Yesterday he did the shopping, paid our bills and remembered everything normally. This is not a gradual memory decline.' },
  { id: 'witness_time', label: 'Continuous witnessed episode', key: true, keywords: ['last well', 'time', 'duration', 'alone'], text: 'He was entirely normal at breakfast. I have been with him since the repetitive questions started ninety minutes ago; there has not been a second separate episode.' },
  { id: 'witness_trigger', label: 'Preceding exertion without trauma', keywords: ['trigger', 'doing', 'exercise', 'injury'], text: 'He had just returned from a brisk walk and a shower. No fall, head injury or loss of consciousness.' },
  { id: 'witness_neuro', label: 'No additional neurological symptoms', key: true, keywords: ['vision', 'headache', 'balance', 'numb'], text: 'No severe headache, double vision, numbness or staggering. He walked into the car normally.' },
  { id: 'witness_meds', label: 'Medication and toxin review', keywords: ['med', 'alcohol', 'drug', 'new'], text: 'Amlodipine 5 mg daily, no sedatives or new tablets. No alcohol today or recreational drugs.' },
  { id: 'witness_seizure', label: 'No prior seizures or brief recurrent spells', key: true, keywords: ['seizure', 'before', 'automatis', 'stare'], text: 'No epilepsy, staring spells, lip smacking or previous brief attacks like this.' },
  { id: 'witness_support', label: 'Supervision after recovery', keywords: ['home', 'support', 'supervis'], text: 'I can stay with him, but I would not feel safe taking him home while he is still unable to remember new information.' },
);
amnesia.presentation.problemList = ['Hypertension'];
amnesia.presentation.documentedHomeMeds = [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily' }];
amnesia.presentation.encounters = [{ id: 'amnesia_baseline', date: 'Three months before this encounter', type: 'Clinic', department: 'Primary care', reason: 'Hypertension review', summary: 'Independent daily function; no reported cognitive concerns or seizure history.' }];
amnesia.labs = { ...amnesia.labs, na: 139, k: 4.1, cl: 104, hco3: 24, creat: 0.9, hgb: 14.0, wbc: 6.9 };
amnesia.exam.neuro_gait = 'Steady independent gait without limb or truncal ataxia.';
amnesia.exam.gen_mental = 'Alert and attentive, recognizes self and partner, but cannot retain new information and repeatedly asks why he is here.';
amnesia.scoring.critical.find(x => x.label === 'Perform the focused examination')!.rule = { type: 'exam', maneuvers: ['neuro_focal', 'neuro_cam'] };
amnesia.scoring.critical.push({ id: 'baseline', label: 'Establish normal baseline cognition from the witness', points: 6, rule: { type: 'fact', factIds: ['witness_baseline'] } });
amnesia.consults[0].guard = { type: 'any', rules: [{ type: 'all', rules: [{ type: 'fact', factIds: ['witness_sequence'] }, { type: 'exam', maneuvers: ['neuro_focal'] }] }, { type: 'escalated' }] };
amnesia.consults[0].onAccept.note = { title: 'Observation plan', text: 'Observe serial cognition and neurological findings until recovery. Reconsider stroke, seizure or another cause for atypical signs or persistence. MRI timing should follow neurology assessment.' };
amnesia.truth.outcomeGood = 'The patient remains under observation with witness-supported history and serial neurological assessment; recovery must be confirmed before discharge.';
amnesia.teaching.push('Do not infer this diagnosis from amnesia alone: confirm witnessed onset, preserved identity, no focal deficit and an appropriate course.', 'The patient cannot reliably reconstruct the episode. The game does not automatically restore memory after a fixed interval; the observation handoff must include recovery assessment.');
amnesia.scoring.harms.push({ id: 'premature_home', label: 'Sent home while unable to retain new information', penalty: 12, rule: { type: 'dispo', decisions: ['discharge'] }, teaching: 'The authored encounter occurs during persistent amnesia; observation is required rather than assuming recovery.' });

diuretic.persona.personality = 'Independent older adult who followed well-meant hydration advice and wants to understand the new tablet.';
diuretic.persona.behavior = ['Give the name and dose from the bottle only when it is inspected or discussed.', 'Describe unsteadiness without inventing seizures or confusion.'];
diuretic.persona.facts.push(
  { id: 'onset', label: 'New symptoms after medication change', key: true, keywords: ['when', 'start', 'timeline', 'onset'], text: 'The tablet started eight days ago; nausea began yesterday and I was unsteady this morning.' },
  { id: 'water_volume', label: 'Increased hypotonic intake', key: true, keywords: ['amount', 'litre', 'liter', 'water'], text: 'About three to four litres of water each day, more than I normally drink. I have eaten less because of nausea.' },
  { id: 'severity', label: 'No severe neurological symptoms', key: true, keywords: ['seizure', 'confus', 'headache', 'vomit'], text: 'No seizure, confusion or severe headache. Nauseated but not vomiting.' },
  { id: 'other_losses', label: 'No gastrointestinal fluid loss', keywords: ['diarr', 'stool', 'sweat', 'loss'], text: 'No diarrhea, heavy sweating or other fluid loss.' },
  { id: 'other_drugs', label: 'Other medication review', keywords: ['other medicine', 'antidepress', 'carbamazepine', 'usual'], text: 'Amlodipine 5 mg daily is my old tablet. No antidepressant, seizure medicine or herbal remedy.' },
  { id: 'volume_symptoms', label: 'No overt congestion', keywords: ['swelling', 'breath', 'heart', 'kidney'], text: 'No swollen legs or breathlessness. No known heart, kidney or liver disease.' },
  { id: 'baseline_function', label: 'Independent baseline mobility', keywords: ['baseline', 'usual', 'walk', 'home'], text: 'Normally I walk to the shops alone. Today my neighbor had to help me down the stairs.' },
  { id: 'allergies', label: 'No drug allergies', keywords: ['allerg'], text: 'No known medicine allergies.' },
);
diuretic.presentation.documentedHomeMeds = [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily' }];
diuretic.presentation.problemList = ['Hypertension'];
diuretic.presentation.encounters = [{ id: 'diuretic_baseline', date: 'Twelve days before this encounter', type: 'Clinic', department: 'Primary care', reason: 'Hypertension review', summary: 'Sodium 139 mmol/L, potassium 4.0 mmol/L and creatinine 0.8 mg/dL. Planned blood-pressure treatment review; updated prescription not reconciled in this chart.' }];
diuretic.items![0].text = 'Hydrochlorothiazide 12.5 mg once daily. First dispensed eight days ago for high blood pressure.';
diuretic.persona.facts.find(f => f.id === 'recent_fill')!.text = 'The label says hydrochlorothiazide 12.5 mg once each morning, started eight days ago.';
diuretic.exam.heent_mucosa = 'Moist oral mucosa; no marked clinical dehydration.';
diuretic.exam.cv_edema = 'No peripheral edema.';
diuretic.exam.pulm_auscultate = 'Clear lungs bilaterally.';
diuretic.persona.counseling = [{ id: 'hold_thiazide', label: 'Explain withholding the new thiazide and monitored correction', keywords: ['stop hydrochlorothiazide', 'hold thiazide', 'withhold', 'sodium', 'water intake'], description: 'Explain that the suspected thiazide should be withheld, excess water intake addressed and sodium rechecked under supervision; avoid rapid correction.' }];
diuretic.scoring.critical.push({ id: 'drug_plan', label: 'Discuss withholding the suspected drug and monitored correction', points: 6, rule: { type: 'counseled', ids: ['hold_thiazide'] } });
diuretic.scoring.critical.push({ id: 'serial_sodium', label: 'Arrange serial electrolyte monitoring through admission or repeat sampling', points: 6, rule: { type: 'any', rules: [{ type: 'consult', contactId: 'hosp' }, { type: 'collected', codes: ['bmp', 'cmp'], count: 2 }] }, teaching: 'An early handoff can transfer serial monitoring to the receiving team. The collection rule cannot measure the sodium correction rate.' });
diuretic.consults[0].guard = { type: 'any', rules: [{ type: 'order', codes: ['bmp', 'cmp'] }, { type: 'escalated' }] };
diuretic.consults[0].onAccept.note = { title: 'Observation plan', text: 'Withhold hydrochlorothiazide, assess tonicity and volume status, review intake and arrange serial sodium/potassium monitoring. Use a symptom- and cause-directed correction plan.' };
diuretic.teaching.push('A recent normal sodium and new thiazide exposure are useful clues, but evaluate other contributors and the severity of symptoms.', 'Sodium is not a treatment-responsive variable in this engine. No automatic correction is scripted; the clinical plan must include serial monitoring and avoidance of overcorrection.');

seizure.persona.personality = 'Frustrated by a pharmacy transfer, wants practical help rather than blame for missed treatment.';
seizure.persona.behavior = ['Say the interruption was caused by supply, not a decision to stop.', 'Do not supply a confidently verified dose before the pharmacy confirms it.'];
seizure.persona.facts.push(
  { id: 'event_timing', label: 'Single brief event with complete recovery', key: true, keywords: ['when', 'duration', 'recover', 'confus'], text: 'About two hours ago. My housemate said the shaking lasted a minute. I was confused for fifteen minutes, then completely myself.' },
  { id: 'witness_contact', label: 'Witness description relayed by EMS', keywords: ['witness', 'housemate', 'crew', 'description'], text: 'My housemate told the ambulance crew both arms and legs shook, just like my usual seizures. The crew wrote it down.' },
  { id: 'no_red_flags', label: 'No new headache, fever or focal symptoms', key: true, keywords: ['headache', 'fever', 'weak', 'numb'], text: 'No new headache, fever, weakness or numbness.' },
  { id: 'prior_control', label: 'Previously controlled epilepsy', keywords: ['before', 'last seizure', 'control', 'usual'], text: 'No seizure for eighteen months while taking the regular tablets.' },
  { id: 'other_triggers', label: 'No competing substance or sleep trigger', keywords: ['alcohol', 'drug', 'sleep', 'ill'], text: 'Normal sleep, no recent illness, binge drinking or recreational drugs.' },
  { id: 'regular_medicine', label: 'Dose requires verification', keywords: ['name', 'dose', 'tablet', 'med'], text: 'Levetiracetam twice a day, but please check the strength with the pharmacy. I do not have the box with me.' },
  { id: 'allergies', label: 'No drug allergies', keywords: ['allerg'], text: 'No known medicine allergies.' },
  { id: 'safety_support', label: 'Home supervision and transport', key: true, keywords: ['home', 'support', 'drive', 'work'], text: 'My housemate can stay with me and collect the tablets. I will not drive; I need advice about work and driving restrictions.' },
);
seizure.presentation.emsNote = 'Housemate witnessed one approximately 60-second generalized convulsion without fall or head strike. Postictal confusion resolved in about 15 minutes. No recurrence during transport; glucose normal.';
seizure.presentation.encounters = [{ id: 'epilepsy_followup', date: 'Six months before this encounter', type: 'Clinic', department: 'Neurology', reason: 'Epilepsy follow-up', summary: 'Seizure-free on monotherapy. Medication name and current dose require reconciliation with the dispensing record.' }];
seizure.labs = { ...seizure.labs, k: 4.1, cl: 104, hco3: 24, creat: 0.9, ca: 9.3, mg: 1.9 };
seizure.exam.gen_mental = 'Fully oriented, attentive and able to recount events after the postictal period.';
seizure.phoneContacts![0].persona.facts.push(
  { id: 'refill_timing', label: 'Supply interruption rather than prescribed cessation', keywords: ['gap', 'last supply', 'transfer', 'stop'], text: 'The prior supply ran out yesterday. There was no instruction to stop treatment; the transfer request delayed dispensing.' },
  { id: 'refill_access', label: 'Collection arrangements', key: true, keywords: ['collect', 'open', 'today', 'delivery'], text: 'The usual tablets are ready for collection today. His nominated housemate can collect them after identity checks.' },
  { id: 'no_dose_change', label: 'No recent regimen change', keywords: ['change', 'increase', 'new dose'], text: 'No recent dose change is recorded. The prescription remains levetiracetam 500 mg twice daily.' },
);
seizure.persona.counseling!.push({ id: 'seizure_safety', label: 'Explain seizure safety and return precautions', keywords: ['driving', 'do not drive', 'swimming', 'bath', 'another seizure', 'five minutes'], description: 'Discuss no driving until local clearance, avoiding unsupervised water/heights, supervision and emergency help for a prolonged or recurrent seizure without recovery.' });
seizure.scoring.critical.push({ id: 'safety', label: 'Discuss seizure safety and emergency return precautions', points: 6, rule: { type: 'counseled', ids: ['seizure_safety'] } });
seizure.scoring.critical.find(x => x.label === 'Perform the focused examination')!.rule = { type: 'exam', maneuvers: ['neuro_focal', 'neuro_gcs'] };
seizure.scoring.lowValue = [{ codes: ['ct_head'], penalty: 3, why: 'This is a single usual-pattern seizure in known epilepsy with full recovery and no injury or new neurological red flag; imaging indications change if those features change.' }];
seizure.teaching.push('Distinguish a brief usual-pattern breakthrough seizure from status, injury or an acute provoking illness. Reconcile the regimen and solve the supply problem.', 'Levetiracetam is not an available ED medication order. The game credits a verified restart/access plan and safety discussion, not an invented administration.');

// Admission for ongoing assessment does not require finishing the diagnostic workup first.
for (const c of [amnesia, diuretic]) for (const consult of c.consults) {
  if (consult.guard) consult.guard = { type: 'any', rules: [consult.guard, { type: 'exam', maneuvers: [Object.keys(c.exam)[0]] }] };
}
