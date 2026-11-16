import type { CaseBrief } from '../brief';
import type { CaseDef, FactDef, Rule } from '../../types';
import { examine, given, order, senior, unsafeDischarge, viralStewardship } from './checkpoints';

const gallstones = 'NICE CG188. Gallstone disease. https://www.nice.org.uk/guidance/cg188';
const obstruction = 'WSES Bologna guidelines for adhesive small bowel obstruction. https://doi.org/10.1186/s13017-018-0185-2';
const diverticular = 'NICE NG147. Diverticular disease. https://www.nice.org.uk/guidance/ng147';

export const digestive: CaseBrief[] = [
  {
    id: 'biliary_colic', walkToBed: true, specialty: 'gastroenterology', age: 43, sex: 'F', difficulty: 1, esi: 3,
    complaint: 'Pain below the right ribs after dinner', opening: 'It squeezed fiercely for an hour. Now I can almost forget it happened.',
    facts: [['Recurrent post-meal attacks', ['meal', 'food', 'before', 'when'], 'This is the third time after a rich dinner. Each time it goes away completely.'],
      ['No obstructive symptoms', ['yellow', 'urine', 'fever', 'chills'], 'No fever, shaking, dark urine or yellow eyes.']],
    exam: { abd_murphy: 'No inspiratory arrest. The pain has subsided.', abd_palpate: 'Soft, with mild right subcostal tenderness.' },
    diagnosis: 'Biliary colic', synonyms: ['symptomatic cholelithiasis', 'gallstone colic'], icd10: 'K80.20', disposition: 'discharge',
    vitals: { pain: 2 }, labs: { tbili: 0.6, alp: 85, alt: 24, wbc: 7.1, lipase: 32 },
    imaging: { us_ruq: 'Mobile shadowing calculi. Thin gallbladder wall, no pericholecystic fluid, normal caliber ducts.' },
    pocus: { ruq: { text: 'Mobile shadowing stones with a thin gallbladder wall.' } },
    steps: [order('Look for gallstones by ultrasound', 'us_ruq'), order('Check for biliary obstruction', 'lfts', 'cmp')],
    counseling: ['Surgery follow-up and return precautions', ['surgery', 'surgical', 'fever', 'jaundice'], 'Arrange surgical follow-up and discuss fever, jaundice or pain that persists.'],
    teaching: 'A self-limited attack with uncomplicated stones can be managed with outpatient surgical follow-up.', references: [gallstones],
  },
  {
    id: 'acute_cholecystitis', specialty: 'general surgery', age: 55, sex: 'M', difficulty: 2, esi: 3,
    complaint: 'Persistent right upper abdominal pain', opening: 'My ribs ache when I try to take a full breath.',
    facts: [['Persistent focal pain', ['when', 'duration', 'onset', 'where'], 'It began after supper yesterday. Unlike the other attacks it never stopped.'],
      ['Systemic symptoms', ['fever', 'chills', 'vomit'], 'I was shivering this morning and brought my tea straight back up.']],
    exam: { abd_murphy: 'Palpation beneath the right costal margin arrests inspiration.', abd_palpate: 'Tender right upper quadrant with focal guarding.' },
    diagnosis: 'Acute calculous cholecystitis', synonyms: ['cholecystitis', 'gallbladder inflammation'], icd10: 'K80.00', disposition: 'admit_floor', consultant: 'surg',
    vitals: { temp: 38.2, hr: 102, pain: 7 }, labs: { wbc: 14.6, tbili: 1.0, crp: 56 },
    imaging: { us_ruq: 'Impacted stone at the gallbladder neck with wall thickening, pericholecystic fluid and a sonographic Murphy sign.' },
    pocus: { ruq: { text: 'Stone at the gallbladder neck with a thickened 5 mm wall. Tender over the gallbladder.' } },
    steps: [order('Obtain right upper quadrant ultrasound', 'us_ruq'), order('Keep fasting for surgical assessment', 'npo')],
    teaching: 'Persistent pain, fever and inflammatory changes on ultrasound support early surgical management.', references: [gallstones],
  },
  {
    id: 'adhesive_bowel_obstruction', specialty: 'general surgery', age: 64, sex: 'F', difficulty: 2, esi: 3,
    complaint: 'Abdominal distention and repeated vomiting', opening: 'It comes in waves. I have had nothing left to bring up since lunch.',
    facts: [['Previous open surgery', ['operation', 'surgery', 'scar', 'past'], 'My bowel was repaired through a long incision after a crash years ago.'],
      ['Obstipation', ['gas', 'wind', 'stool', 'bowel'], 'I have passed neither stool nor gas since last night.']],
    exam: { abd_inspect: 'Distended abdomen with a healed midline scar.', abd_palpate: 'Tympanitic, mildly tender throughout without guarding.' },
    diagnosis: 'Adhesive small bowel obstruction', synonyms: ['small bowel obstruction', 'sbo', 'intestinal obstruction'], icd10: 'K56.50',
    disposition: 'admit_floor', consultant: 'surg', vitals: { hr: 105, pain: 6 }, labs: { k: 3.2, cl: 94, hco3: 31, bun: 28, creat: 1.25 },
    imaging: { ct_abd_iv: 'Dilated proximal small bowel and collapsed distal ileum with one transition point near the old incision. No ischemia or free air.' },
    physiology: { drift: { hr: 2, sbp: -2 }, effects: [{ tag: 'fluids', tauMin: 12, maxUnits: 1, delta: { hr: -10, sbp: 7 }, driftMult: { hr: 0, sbp: 0 } }] },
    steps: [order('Identify the transition point and complications', 'ct_abd_iv'), order('Keep fasting', 'npo'), given('Replace volume lost to vomiting', 'lr_bolus', 'ns_bolus')],
    teaching: 'Resuscitate, decompress when indicated and discuss obstruction with surgery. Peritoneal signs or ischemia change the urgency.', references: [obstruction],
  },
  {
    id: 'incarcerated_groin_hernia', specialty: 'general surgery', age: 69, sex: 'M', difficulty: 2, esi: 2,
    complaint: 'Painful right groin lump and vomiting', opening: 'I usually lie down and the lump goes away. This morning it stayed put.',
    facts: [['Previously reducible bulge', ['lump', 'bulge', 'reduce', 'before'], 'For years it came out when I coughed and disappeared in bed.'],
      ['Obstructive symptoms', ['vomit', 'bowel', 'gas', 'stool'], 'I am vomiting green liquid and have stopped passing wind.']],
    exam: { abd_inspect: 'Tender, firm right inguinal mass with dusky overlying skin.', abd_palpate: 'The mass is irreducible and exquisitely tender. The abdomen is distended.' },
    diagnosis: 'Incarcerated inguinal hernia with bowel obstruction', synonyms: ['incarcerated hernia', 'strangulated hernia', 'obstructed inguinal hernia', 'incarcerated inguinal hernia'], icd10: 'K40.30',
    disposition: 'or', consultant: 'surg', vitals: { hr: 113, temp: 37.9, pain: 8 }, labs: { lactate: 3.2, wbc: 15.2 },
    imaging: { ct_abd_iv: 'Small bowel in the right inguinal canal, a transition point at the neck, reduced enhancement and fluid in the sac.' },
    steps: [order('Keep fasting for emergency surgery', 'npo'), order('Obtain IV access', 'iv_access')],
    teaching: 'Skin changes and obstruction raise concern for compromised bowel. Obtain urgent surgical assessment and avoid forceful reduction.',
    references: ['WSES emergency repair of complicated abdominal wall hernias. https://doi.org/10.1186/s13017-017-0149-y'],
  },
  {
    id: 'gallstone_pancreatitis', specialty: 'gastroenterology', age: 49, sex: 'F', difficulty: 2, esi: 3,
    complaint: 'Upper abdominal pain radiating to the back', opening: 'I cannot get comfortable on my back. Even water comes right back up.',
    facts: [['Pain pattern', ['where', 'radiat', 'back', 'pain'], 'It feels as though the pain goes straight through from my stomach to my back.'],
      ['Gallstone history', ['gall', 'stone', 'past', 'alcohol'], 'A scan last year showed gallstones. I do not drink alcohol.']],
    exam: { abd_palpate: 'Epigastrium tender, without rigidity or rebound.', heent_mucosa: 'Dry mouth and cracked lips.' },
    diagnosis: 'Acute biliary pancreatitis', synonyms: ['acute pancreatitis', 'gallstone pancreatitis', 'biliary pancreatitis'], icd10: 'K85.10',
    disposition: 'admit_floor', consultant: 'hosp', vitals: { hr: 106, pain: 8 }, labs: { lipase: 1140, alt: 184, ast: 139, bun: 29, hct: 46, hgb: 15.4, rbc: 5.11, mcv: 90 },
    imaging: { us_ruq: 'Multiple gallstones, no wall thickening. Common bile duct is not dilated.', ct_abd_iv: 'Edematous pancreas with peripancreatic stranding. No necrosis.' },
    pocus: { ruq: { text: 'Several mobile gallstones with a thin wall.' } },
    physiology: { effects: [{ tag: 'fluids', tauMin: 12, maxUnits: 1, delta: { hr: -10, sbp: 5 } }] },
    steps: [order('Check lipase', 'lipase'), order('Look for biliary etiology', 'us_ruq'), given('Start crystalloid and reassess volume status', 'lr_bolus', 'ns_bolus')],
    teaching: 'Characteristic pain and a lipase above three times the upper limit support the diagnosis. Reassess hydration and oral tolerance.',
    references: ['NICE NG104. Pancreatitis. https://www.nice.org.uk/guidance/ng104', 'ACG. Management of acute pancreatitis (2024). https://webfiles.gi.org/links/journals/AJG-Clinical-Guidelines-Highlights-Acute-Pancreatitis-2024-FINAL.pdf'],
  },
  {
    id: 'uncomplicated_diverticulitis', walkToBed: true, specialty: 'gastroenterology', age: 59, sex: 'M', difficulty: 1, esi: 3,
    complaint: 'Left lower abdominal ache', opening: 'The same little patch on the left has hurt since yesterday.',
    facts: [['Localised time course', ['when', 'where', 'onset', 'pain'], 'It started gradually yesterday, stayed low on the left and never moved.'],
      ['Oral tolerance and support', ['drink', 'eat', 'home', 'vomit'], 'I kept breakfast down. My partner can bring me back if things change.']],
    exam: { abd_palpate: 'Focal left lower quadrant tenderness. Abdomen otherwise soft.', abd_rebound: 'No guarding or peritoneal signs.' },
    diagnosis: 'Acute uncomplicated sigmoid diverticulitis', synonyms: ['diverticulitis', 'sigmoid diverticulitis'], icd10: 'K57.32', disposition: 'discharge',
    vitals: { pain: 4 }, labs: { wbc: 11.9, crp: 37 }, imaging: { ct_abd_iv: 'Inflamed sigmoid diverticulum with adjacent fat stranding. No abscess, perforation or obstruction.' },
    steps: [examine('Assess for focal tenderness and peritonitis', 'abd_palpate', 'abd_rebound')],
    counseling: ['Reassessment for worsening illness', ['fever', 'worsen', 'vomit', 'return'], 'Explain reassessment for fever, worsening pain or inability to drink.'],
    teaching: 'Clinical stability, oral intake and the absence of complications support outpatient management in this immunocompetent patient.', references: [diverticular],
  },
  {
    id: 'diverticular_abscess', specialty: 'general surgery', age: 71, sex: 'F', difficulty: 2, esi: 3,
    complaint: 'Persistent pain and chills despite outpatient treatment', opening: 'The tablets have not helped. Now it hurts even when I take a step.',
    facts: [['Treatment failure', ['medicine', 'tablet', 'antibiotic', 'treatment'], 'I took every dose for three days after the clinic visit for bowel inflammation.'],
      ['Systemic progression', ['worse', 'fever', 'chills', 'drink'], 'I have chills now and hardly managed a cup of water today.']],
    exam: { abd_palpate: 'Marked left lower quadrant tenderness with a sense of fullness.', abd_rebound: 'Focal percussion tenderness, no generalized rigidity.' },
    diagnosis: 'Sigmoid diverticulitis with pelvic abscess', synonyms: ['diverticular abscess', 'complicated diverticulitis', 'diverticulitis with abscess'], icd10: 'K57.20',
    disposition: 'admit_floor', consultant: 'surg', vitals: { hr: 106, temp: 38.4, pain: 7 }, labs: { wbc: 17.8, crp: 165 },
    imaging: { ct_abd_iv: 'Sigmoid inflammation with a 5 cm rim-enhancing pelvic collection. No diffuse free air.' },
    steps: [order('Define the collection on CT', 'ct_abd_iv'), order('Place IV access for inpatient treatment', 'iv_access')],
    teaching: 'A large abscess calls for inpatient antibiotics and surgical or interventional review for drainage.', references: [diverticular],
  },
  {
    id: 'viral_gastroenteritis', walkToBed: true, specialty: 'gastroenterology', age: 33, sex: 'M', difficulty: 1, esi: 4,
    complaint: 'Vomiting and watery diarrhea', opening: 'The whole house seems to have this. Do I need antibiotics?',
    facts: [['Household cluster', ['sick', 'contact', 'family', 'exposure'], 'My housemate had exactly this two days ago and was better the next day.'],
      ['No red flags', ['blood', 'drink', 'fever', 'travel'], 'No blood or fever. I am keeping small sips down and am still making urine.']],
    exam: { abd_palpate: 'Soft abdomen with mild diffuse cramping, no focal tenderness.', heent_mucosa: 'Mucosa moist.' },
    diagnosis: 'Acute viral gastroenteritis', synonyms: ['viral gastroenteritis', 'gastroenteritis', 'norovirus'], icd10: 'A08.4', disposition: 'discharge',
    vitals: { pain: 2 }, steps: [examine('Check hydration and examine for a surgical abdomen', 'heent_mucosa', 'abd_palpate')],
    precautions: { kind: 'contact', reason: 'Acute vomiting and diarrhea in a household cluster.' },
    counseling: ['Hydration and household precautions', ['small sips', 'rehydrat', 'handwash', 'wash your hands'], 'Discuss oral rehydration and handwashing with soap and water.'],
    lowValue: viralStewardship,
    teaching: 'Brief nonbloody diarrhea in a household cluster usually responds to oral rehydration.',
    references: ['CDC. Norovirus. https://www.cdc.gov/yellow-book/hcp/travel-associated-infections-diseases/norovirus.html', 'CDC. How to prevent norovirus. https://www.cdc.gov/norovirus/prevention/'],
  },
  {
    id: 'perforated_peptic_ulcer', specialty: 'general surgery', age: 62, sex: 'M', difficulty: 3, esi: 2,
    complaint: 'Sudden severe pain throughout the abdomen', opening: 'Please leave me still. Even the trolley going over a bump hurt.',
    facts: [['Abrupt deterioration', ['start', 'when', 'onset', 'before'], 'For weeks my upper belly burned. An hour ago it suddenly felt completely different.'],
      ['NSAID exposure', ['medicine', 'painkiller', 'ibuprofen', 'tablet'], 'I have been taking ibuprofen most days for my shoulder.']],
    exam: { abd_palpate: 'Rigid abdomen with generalized involuntary guarding.', abd_rebound: 'Marked tenderness with gentle percussion throughout.' },
    diagnosis: 'Perforated peptic ulcer', synonyms: ['perforated ulcer', 'perforated duodenal ulcer', 'perforated gastric ulcer', 'perforated viscus'], icd10: 'K27.5',
    disposition: 'or', consultant: 'surg', vitals: { hr: 117, sbp: 100, dbp: 61, rr: 24, pain: 9 }, labs: { lactate: { var: 'lactate' }, wbc: 16.5 },
    imaging: { ct_abd_iv: 'Free intraperitoneal gas and fluid with a focal defect in the anterior duodenal bulb.', xr_chest: 'Free subdiaphragmatic air.', xr_chest_port: 'Gas beneath the right hemidiaphragm on the upright portable view.' },
    steps: [given('Begin crystalloid resuscitation', 'lr_bolus', 'ns_bolus'), order('Keep fasting', 'npo'), senior],
    physiology: { drift: { sbp: -6, hr: 4, lactate: 0.4 }, baseline: { lactate: 3.4 }, effects: [{ tag: 'fluids', tauMin: 8, maxUnits: 1.5, delta: { hr: -8, sbp: 9 } }],
      triggers: [{ id: 'perfusion', when: { var: 'sbp', op: '<', value: 90 }, page: { from: 'nurse', priority: 'critical', text: 'Pressure is falling. The abdomen is still rigid. Please reassess now.' } }] },
    teaching: 'An acute rigid abdomen after preceding dyspepsia warrants urgent resuscitation, broad antimicrobial cover and surgical source control.',
    harms: [unsafeDischarge('This patient has peritonitis and a perforated viscus. Resuscitation and source control are time-critical.')],
    references: ['WSES. Perforated and bleeding peptic ulcer. https://doi.org/10.1186/s13017-019-0283-9'],
  },
  {
    id: 'sigmoid_volvulus', specialty: 'general surgery', age: 77, sex: 'M', difficulty: 2, esi: 3,
    complaint: 'A swollen abdomen and no bowel movement', opening: 'My belt would not close this morning. I keep trying to go with no result.',
    facts: [['Obstipation', ['gas', 'bowel', 'stool', 'wind'], 'Usually I go every few days. This time not even air is coming through.'],
      ['Progressive distention', ['when', 'swelling', 'bloat', 'previous'], 'The swelling built over two days. A similar spell went away on its own last year.']],
    exam: { abd_inspect: 'Markedly distended asymmetric abdomen.', abd_palpate: 'Tympanitic with mild discomfort, no guarding or rigidity.' },
    diagnosis: 'Sigmoid volvulus', synonyms: ['sigmoid volvulus', 'colonic volvulus'], icd10: 'K56.2',
    disposition: 'admit_floor', consultant: 'surg', vitals: { hr: 98, pain: 4 }, labs: { k: 3.4, lactate: 1.5 },
    imaging: { ct_abd_iv: 'Severely dilated sigmoid colon with a mesenteric swirl and tapering at the rectosigmoid. Wall enhancement preserved. No free air.' },
    steps: [order('Identify the obstruction and assess bowel viability', 'ct_abd_iv'), order('Keep fasting pending urgent decompression', 'npo')],
    teaching: 'Urgent endoscopic detorsion is appropriate in uncomplicated sigmoid volvulus. The team should plan definitive treatment to prevent recurrence.',
    references: ['WSES. Sigmoid volvulus management. https://doi.org/10.1186/s13017-023-00502-x'],
  },
  {
    id: 'esophageal_food_impaction', specialty: 'gastroenterology', age: 48, sex: 'M', difficulty: 2, esi: 2,
    complaint: 'Cannot swallow after a bite of meat', opening: 'I can breathe. It is my spit I cannot swallow.',
    facts: [['Abrupt solid food obstruction', ['eat', 'food', 'meal', 'start'], 'One bite of beef stuck behind my breastbone. Water comes straight back up.'],
      ['Prior intermittent dysphagia', ['before', 'previous', 'swallow', 'prior'], 'Bread and meat have stuck before, but have always gone down eventually.']],
    exam: { heent_mucosa: 'Pooling saliva. He spits into a cup. No visible oropharyngeal foreign body.', pulm_effort: 'Speaks clearly with unlabored breathing. No stridor.' },
    diagnosis: 'Esophageal food bolus impaction', synonyms: ['food bolus', 'food impaction', 'esophageal obstruction'], icd10: 'T18.128A',
    disposition: 'transfer', consultant: 'transfer', vitals: { pain: 4 }, steps: [order('Keep fasting and protect against aspiration', 'npo')],
    counseling: ['Explain emergency endoscopy', ['endoscopy', 'endoscop', 'transfer'], 'The local endoscopy unit is closed. Explain transfer for emergent endoscopy.'],
    teaching: 'Inability to handle secretions suggests complete esophageal obstruction. Arrange emergent endoscopy at the receiving center.',
    references: ['ESGE. Removal of foreign bodies in the upper gastrointestinal tract in adults. https://doi.org/10.1055/s-0042-100456'],
  },
];

// These are full case fields, kept beside the brief so chart, dialogue and debrief share one history.
// Times and treatment responses below are authored simulation assumptions, not guideline predictions.
interface DigestiveDetail {
  personality: string;
  facts: FactDef[];
  presentation: Partial<CaseDef['presentation']>;
  teaching: string[];
  counseling?: NonNullable<CaseDef['persona']['counseling']>;
  labs?: CaseDef['labs'];
  exam?: CaseDef['exam'];
  physiology?: Partial<CaseDef['physiology']>;
  critical?: CaseDef['scoring']['critical'];
  harms?: CaseDef['scoring']['harms'];
  consult?: { criteria: string; guard: Rule; note: string };
}
const history = (id: string, label: string, keywords: string[], text: string, key = false): FactDef => ({ id, label, keywords, text, key });
const gutAntibiotics: Rule = { type: 'any', rules: [
  { type: 'given', codes: ['pip_tazo', 'meropenem', 'ertapenem'] },
  { type: 'all', rules: [{ type: 'given', codes: ['ceftriaxone', 'cefepime', 'ciprofloxacin'] }, { type: 'given', codes: ['metronidazole'] }] },
] };
const digestiveDetails: Record<string, DigestiveDetail> = {
  biliary_colic: {
    personality: 'A school caterer who worries the pain will recur at work. Calm now, but describes how severe the attack was without calling it a diagnosis.',
    facts: [
      history('bc_site', 'Right upper quadrant pain radiating to the shoulder blade', ['where', 'radiate', 'shoulder', 'back'], 'It was just below my right ribs and went around to my right shoulder blade.', true),
      history('bc_course', 'Attack resolved within two hours', ['duration', 'constant', 'better', 'severity'], 'It was a steady squeeze, eight out of ten for about an hour, then faded. It has been almost gone for two hours.', true),
      history('bc_nausea', 'Nausea without persistent vomiting', ['nausea', 'vomit', 'appetite'], 'I felt sick during the pain but did not vomit. I can drink water now.'),
      history('bc_bowel', 'No stool changes or gastrointestinal bleeding', ['stool', 'bowel', 'black', 'pale', 'blood'], 'My stools have been their usual brown. No black stool or blood.'),
      history('bc_pregnancy', 'Normal recent period and contraception', ['period', 'pregnant', 'contraception', 'lmp'], 'My period was normal ten days ago. I use a copper coil and have not missed a period.'),
      history('bc_history', 'No previous operations or pancreatitis', ['medical', 'surgery', 'hospital', 'pancreatitis'], 'I have never had surgery or been admitted with stomach trouble. I had not asked anyone about the earlier attacks.'),
      history('bc_meds', 'No regular medicine or drug allergies', ['medicine', 'medication', 'allerg'], 'I do not take regular tablets and have no medicine allergies. I have not taken a painkiller today.'),
      history('bc_cardiac', 'No exertional or cardiopulmonary symptoms', ['chest', 'breath', 'exercise', 'exertion'], 'No chest pressure or breathlessness. It came after eating, not while walking.'),
      history('bc_support', 'Reliable outpatient access', ['home', 'work', 'support', 'follow'], 'My partner is collecting me. I can see my GP this week and arrange a surgical appointment.'),
    ],
    presentation: { triageNote: 'Recurrent postprandial RUQ pain, now largely resolved; afebrile and drinking. No jaundice or systemic symptoms reported.',
      encounters: [{ id: 'bc_primary', date: '2026-02-12', type: 'Clinic', department: 'Primary care', reason: 'Routine preventive visit', summary: 'No chronic disease or regular medication recorded. Normal abdominal examination.' }] },
    labs: { ast: 23, dbili: 0.1, creat: 0.78, hgb: 13.2, hcg_u: 'Negative', crp: 3 },
    exam: { skin_inspect: 'No jaundice or pallor.', pulm_auscultate: 'Clear lung fields.', cv_auscultate: 'Regular heart sounds, no murmur.', abd_rebound: 'No guarding or percussion tenderness.' },
    physiology: { drift: { pain: -0.4 }, limits: { pain: [0, 10] } },
    counseling: [{ id: 'bc_follow', label: 'Arrange elective surgical review', keywords: ['elective', 'surgeon', 'surgical appointment', 'gallbladder removal'], description: 'Explain symptomatic stones and arrange elective surgical assessment; avoiding personal food triggers can reduce attacks while waiting.' },
      { id: 'bc_return', label: 'Give biliary warning signs', keywords: ['persistent pain', 'fever', 'yellow eyes', 'jaundice', 'cannot drink'], description: 'Return for persistent or recurrent severe pain, fever, jaundice or inability to drink.' }],
    critical: [{ id: 'bc_follow', label: 'Arrange elective surgical follow-up', rule: { type: 'counseled', ids: ['bc_follow'] }, points: 6 },
      { id: 'bc_return', label: 'Explain when urgent reassessment is needed', rule: { type: 'counseled', ids: ['bc_return'] }, points: 6 }],
    teaching: ['The pain pattern, its substantial improvement and uncomplicated ultrasound distinguish this encounter from ongoing gallbladder inflammation.', 'Check for duct obstruction or pancreatitis when the history or laboratory results suggest them.', 'A comfortable patient who can drink may leave with elective surgical follow-up and clear return precautions.'],
  },
  acute_cholecystitis: {
    personality: 'A bus mechanic who delayed attending because he hoped another attack would settle. Answers briefly when the pain catches his breath.',
    facts: [
      history('ac_duration', 'Continuous pain for eighteen hours', ['duration', 'constant', 'how long', 'better'], 'It has stayed there for eighteen hours. The old attacks lasted an hour or two; this has not let up.', true),
      history('ac_site', 'RUQ pain radiating to the right scapula', ['where', 'radiate', 'shoulder', 'back'], 'Under the right ribs, then around to my shoulder blade. A deep breath pulls at it.'),
      history('ac_obstruction', 'No jaundice or dark urine', ['yellow', 'jaundice', 'dark urine', 'pale stool'], 'My eyes look normal and my urine and stools have not changed color.', true),
      history('ac_intake', 'Poor intake and reduced urine', ['last ate', 'last meal', 'drink', 'urine', 'dizzy'], 'Supper yesterday was my last meal. I vomited twice today and only passed a small amount of urine.'),
      history('ac_bowel', 'No gastrointestinal bleeding or diarrhea', ['diarrhea', 'blood', 'black stool', 'bowel'], 'No diarrhea, blood or black stools. I passed a normal stool yesterday.'),
      history('ac_pmh', 'Hypertension without prior abdominal surgery', ['medical', 'history', 'surgery', 'diabetes'], 'I take a tablet for blood pressure. No diabetes, heart trouble or operations.'),
      history('ac_meds', 'Amlodipine only; no drug allergies', ['medicine', 'medication', 'allerg', 'blood thinner'], 'Amlodipine five milligrams each morning. No blood thinners and no medicine allergies.'),
      history('ac_social', 'Low alcohol use and independent function', ['alcohol', 'smoke', 'home', 'work'], 'A beer or two at the weekend. I do not smoke. I live with my wife and usually work full time.'),
      history('ac_concern', 'Concern about an operation', ['worry', 'concern', 'operation', 'surgery plan'], 'If it needs an operation, please explain why it cannot wait. I have never had an anesthetic.'),
    ],
    presentation: { documentedHomeMeds: [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily', lastTaken: 'Yesterday morning' }], problemList: ['Hypertension'],
      encounters: [{ id: 'ac_gp', date: '2026-07-03', type: 'Clinic', department: 'Primary care', reason: 'Blood pressure review', summary: 'Blood pressure controlled on amlodipine. Independent mobility; no known cardiopulmonary disease.' }] },
    labs: { alt: 39, ast: 34, alp: 104, lipase: 31, creat: 0.95, bun: 22, na: 137, k: 3.7, lactate: 1.6 },
    exam: { heent_mucosa: 'Slightly dry tongue.', skin_inspect: 'Warm, no jaundice.', pulm_auscultate: 'Clear lungs; shallow inspiration because of abdominal pain.' },
    physiology: { drift: { hr: 1, temp: 0.03 }, limits: { hr: [70, 125], temp: [36.5, 39] }, effects: [{ tag: 'fluids', delta: { hr: -7 }, tauMin: 15, maxUnits: 1 }, ...['abx_ceftriaxone', 'abx_cefoxitin', 'abx_ampsulb', 'abx_piptazo', 'abx_carbapenem'].map(tag => ({ tag, onsetMin: 60, driftMult: { hr: 0.5, temp: 0.5 }, maxUnits: 1 }))] },
    critical: [{ id: 'ac_abx', label: 'Begin appropriate biliary antimicrobial treatment', points: 6, rule: { type: 'any', rules: [gutAntibiotics, { type: 'given', codes: ['ceftriaxone', 'amp_sulb', 'cefoxitin'] }] } },
      { id: 'ac_analgesia', label: 'Treat significant pain', points: 4, rule: { type: 'given', tags: ['analgesic', 'analgesic_mild'] } }],
    harms: [unsafeDischarge('Persistent focal pain, fever and imaging-confirmed cholecystitis require inpatient surgical care in this encounter.')],
    consult: { criteria: 'Accept persistent RUQ pain with fever and focal findings; review ultrasound, liver tests, fluids, analgesia and antibiotics. Arrange early cholecystectomy, not an arbitrary immediate operation deadline.', guard: { type: 'any', rules: [{ type: 'exam', maneuvers: ['abd_murphy'] }, { type: 'order', codes: ['us_ruq'] }, { type: 'escalated' }] }, note: 'Admit under surgery for acute cholecystitis, symptom control and early cholecystectomy. Review antimicrobial choice against local policy and allergy history.' },
    teaching: ['Persistent pain with fever and gallbladder inflammation differs from a resolved biliary colic attack.', 'Give analgesia, replace losses and begin appropriate antibiotics while arranging surgical care.', 'Early cholecystectomy is definitive management when the patient is fit; liver-test abnormalities may prompt assessment for duct stones.'],
  },
  adhesive_bowel_obstruction: {
    personality: 'A retired administrator who can describe prior surgery clearly. Worried about needing another operation but willing to stay.',
    facts: [
      history('sbo_onset', 'Colic progressing over sixteen hours', ['when', 'onset', 'constant', 'pain'], 'The cramps started yesterday evening, every ten minutes or so. Between waves it aches but is not continuously severe.', true),
      history('sbo_vomit', 'Repeated bilious vomiting', ['vomit', 'green', 'blood', 'nausea'], 'Six lots of green vomit today. No blood or coffee-ground material.', true),
      history('sbo_hydration', 'Dehydration symptoms', ['urine', 'drink', 'dizzy', 'thirst'], 'I cannot keep water down. I last passed a small amount of dark urine this morning.'),
      history('sbo_previous', 'Prior conservatively managed obstruction', ['previous', 'similar', 'before', 'tube'], 'Three years ago I had the same problem. A tube through my nose and fluids helped; I did not need surgery.'),
      history('sbo_redflags', 'No fever, bleeding or hernia symptoms', ['fever', 'blood stool', 'groin', 'lump'], 'No fever, rectal bleeding or new groin lump.'),
      history('sbo_meds', 'No opioid or anticholinergic exposure', ['medicine', 'medication', 'opioid', 'painkiller'], 'Only amlodipine five milligrams a day. I do not take strong painkillers or laxatives.'),
      history('sbo_allergy', 'No drug allergy', ['allerg'], 'No medicine allergies.'),
      history('sbo_baseline', 'Independent baseline and no weight loss', ['weight', 'appetite', 'home', 'cancer'], 'My weight and appetite were normal before this. I manage at home with my husband and have not had cancer.'),
      history('sbo_lastmeal', 'Last oral intake', ['last ate', 'last meal', 'food'], 'A little soup last night; nothing has stayed down today.'),
    ],
    presentation: { documentedHomeMeds: [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily' }], problemList: ['Prior laparotomy after abdominal trauma', 'Previous adhesive small bowel obstruction', 'Hypertension'],
      encounters: [{ id: 'sbo_old', date: '2023-09-18', type: 'Inpatient', department: 'General surgery', reason: 'Small bowel obstruction', summary: 'CT showed a single adhesive transition point without ischemia. Resolved with nasogastric decompression, IV fluids and observation; no resection.' }], priorLabs: [{ analyte: 'creat', value: 0.8, daysAgo: 90 }] },
    labs: { na: 137, wbc: 10.7, hgb: 14.8, lactate: 1.4 },
    exam: { abd_auscultate: 'Intermittent high-pitched sounds; this finding alone cannot assess bowel viability.', heent_mucosa: 'Dry tongue.', skin_capref: 'Capillary refill about two seconds.', abd_rebound: 'No involuntary guarding or percussion tenderness.' },
    critical: [{ id: 'sbo_electrolytes', label: 'Assess electrolyte losses and kidney function', points: 6, rule: { type: 'order', codes: ['bmp', 'cmp'] } },
      { id: 'sbo_peritoneal', label: 'Assess for peritoneal signs', points: 6, rule: { type: 'exam', maneuvers: ['abd_palpate', 'abd_rebound'], min: 1 } }],
    harms: [unsafeDischarge('Ongoing vomiting and mechanical obstruction require admission, replacement of losses and surgical observation.')],
    consult: { criteria: 'Accept suspected obstruction with obstipation, prior surgery and distention. Review CT for ischemia, arrange nasogastric decompression and serial abdominal assessments. Do not require a completed CT before reviewing an unstable patient.', guard: { type: 'any', rules: [{ type: 'exam', maneuvers: ['abd_palpate'] }, { type: 'order', codes: ['ct_abd_iv'] }, { type: 'escalated' }] }, note: 'Admit to surgery. Initially nonoperative treatment with fasting, IV fluid and electrolyte replacement, decompression and repeated assessment for ischemia. Decompression is a receiving-team action, not a playable ED procedure.' },
    teaching: ['Prior surgery and a transition point support adhesive obstruction, but do not exclude strangulation.', 'Fasting, IV replacement of losses and decompression accompany surgical assessment.', 'New continuous pain, peritonitis or instability warrants urgent reassessment rather than continued routine observation.'],
  },
  incarcerated_groin_hernia: {
    personality: 'A former delivery driver who has avoided hernia surgery. Distressed by the persistent pain and afraid he caused it by lifting.',
    facts: [
      history('hernia_time', 'Acute irreducibility for five hours', ['when', 'duration', 'start'], 'It became stuck about five hours ago after I carried a heavy box.', true),
      history('hernia_skin', 'Increasing tenderness and skin discoloration', ['skin', 'color', 'worse', 'red'], 'It has become much sorer and the skin looks darker than this morning.', true),
      history('hernia_attempt', 'No forceful reduction attempted', ['push', 'reduce', 'massage', 'tried'], 'I lay down once as usual, but it hurt too much to touch, so I stopped.'),
      history('hernia_intake', 'Vomiting and last oral intake', ['last meal', 'last ate', 'drink', 'vomit'], 'Toast six hours ago. Since then I have vomited three times and cannot keep water down.'),
      history('hernia_systemic', 'No syncope or GI bleeding', ['faint', 'blood', 'black', 'chest'], 'No fainting, chest pain or blood in the vomit or stool.'),
      history('hernia_history', 'No prior repair or anticoagulation', ['surgery', 'operation', 'blood thinner', 'medical'], 'I have not had it repaired. I have blood pressure trouble but no previous abdominal operation or blood thinner.'),
      history('hernia_meds', 'Regular antihypertensive only', ['medicine', 'medication', 'allerg'], 'Amlodipine five milligrams daily. No allergies I know of.'),
      history('hernia_baseline', 'Independent mobility', ['home', 'walk', 'support', 'smoke'], 'I walk to the shops every day and live with my partner. I stopped smoking ten years ago.'),
    ],
    presentation: { documentedHomeMeds: [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily' }], problemList: ['Right inguinal hernia', 'Hypertension'],
      encounters: [{ id: 'hernia_clinic', date: '2026-01-20', type: 'Clinic', department: 'General surgery', reason: 'Reducible right inguinal hernia', summary: 'Elective repair discussed. Patient chose to defer. Advised to return urgently if painful, irreducible or associated with vomiting.' }] },
    labs: { lactate: { var: 'lactate' }, creat: 1.2, bun: 28, na: 137, k: 3.6, hco3: 20, hgb: 14.5 },
    physiology: { baseline: { lactate: 3.2 }, drift: { hr: 3, sbp: -4, lactate: 0.3 }, limits: { hr: [70, 140], sbp: [75, 150], lactate: [0.8, 7] }, effects: [{ tag: 'fluids', delta: { hr: -7, sbp: 7 }, tauMin: 10, maxUnits: 1.5 }] },
    critical: [{ id: 'hernia_fluids', label: 'Begin IV crystalloid for vomiting and compromised perfusion', points: 6, rule: { type: 'given', codes: ['lr_bolus', 'ns_bolus'] } },
      { id: 'hernia_abx', label: 'Give antimicrobial cover for suspected compromised bowel', points: 6, rule: gutAntibiotics },
      { id: 'hernia_escalate', label: 'Escalate suspected strangulation', points: 6, rule: { type: 'escalated' } }],
    harms: [unsafeDischarge('Irreducibility, skin changes and reduced bowel enhancement indicate a threatened bowel segment requiring emergency surgery.')],
    consult: { criteria: 'Accept immediately for a painful irreducible hernia with skin changes and obstruction. Imaging may define anatomy but must not delay review or source control. Ask about perfusion, last meal, fluids and antibiotic cover.', guard: { type: 'any', rules: [{ type: 'exam', maneuvers: ['abd_inspect', 'abd_palpate'], min: 1 }, { type: 'escalated' }] }, note: 'Emergency operative assessment for obstructed inguinal hernia with suspected strangulation. Continue resuscitation and antimicrobial cover. Avoid forceful bedside reduction.' },
    teaching: ['An acutely irreducible hernia with skin changes and obstruction may contain ischemic bowel.', 'Resuscitation and urgent surgical review proceed together; CT is not a reason to postpone treatment in a clear emergency.', 'Analgesia does not restore bowel viability. Do not interpret symptom relief as resolution.'],
  },
  gallstone_pancreatitis: {
    personality: 'A salon owner who has been putting off surgical follow-up. Worried that eating caused permanent damage.',
    facts: [
      history('pancreas_time', 'Continuous epigastric pain for twelve hours', ['when', 'duration', 'onset', 'constant'], 'It started twelve hours ago after dinner and stayed severe rather than coming in short waves.', true),
      history('pancreas_vomit', 'Repeated vomiting and poor intake', ['vomit', 'drink', 'urine', 'dizzy'], 'I vomited five times and have barely passed urine. I get light-headed standing up.', true),
      history('pancreas_cholangitis', 'No rigors or jaundice', ['fever', 'chills', 'yellow', 'jaundice'], 'I have not had shivering, yellow eyes or dark urine.'),
      history('pancreas_bleeding', 'No bleeding or bowel obstruction symptoms', ['blood', 'black stool', 'gas', 'bowel'], 'No blood or black stools, and I can still pass wind.'),
      history('pancreas_history', 'No previous pancreatitis', ['medical', 'past', 'pancreatitis', 'surgery'], 'I had gallstone pain last year, but never this kind of pain and never an operation.'),
      history('pancreas_meds', 'No newly started medicine', ['medicine', 'medication', 'new tablet', 'allerg'], 'No regular tablets, new medicines or allergies. I took paracetamol once last night.'),
      history('pancreas_lmp', 'Recent normal menstrual period', ['period', 'pregnan', 'lmp'], 'My last period was two weeks ago and normal. Pregnancy is possible but unlikely.'),
      history('pancreas_support', 'Concern about time off work', ['home', 'work', 'support', 'worry'], 'My sister can run the salon, but I need to know how long I may be in hospital.'),
    ],
    presentation: { problemList: ['Symptomatic gallstones'], encounters: [{ id: 'pancreas_us', date: '2025-12-08', type: 'Clinic', department: 'General surgery', reason: 'Symptomatic gallstones', summary: 'Ultrasound: mobile gallstones without duct dilatation. Elective cholecystectomy offered; patient deferred because of work.' }], priorLabs: [{ analyte: 'creat', value: 0.75, daysAgo: 180 }] },
    labs: { creat: 1.05, na: 137, k: 3.5, tbili: 0.9, alp: 119, wbc: 12.8, ca: 9.1, hcg_u: 'Negative' },
    exam: { pulm_auscultate: 'Clear lungs without crackles.', skin_capref: 'Capillary refill two to three seconds.', abd_rebound: 'No involuntary guarding or rebound.' },
    critical: [{ id: 'pancreas_renal', label: 'Assess renal function and electrolyte losses', points: 6, rule: { type: 'order', codes: ['bmp', 'cmp'] } },
      { id: 'pancreas_pain', label: 'Provide analgesia', points: 4, rule: { type: 'given', tags: ['analgesic', 'analgesic_mild'] } }],
    consult: { criteria: 'Accept pancreatitis with persistent pain, vomiting and dehydration. Review hydration, urine output, organ dysfunction and biliary cause. Plan cholecystectomy during the admission if the course remains mild; no cholangitis is present here.', guard: { type: 'any', rules: [{ type: 'order', codes: ['lipase'] }, { type: 'exam', maneuvers: ['abd_palpate'] }, { type: 'escalated' }] }, note: 'Admit for reassessed crystalloid treatment, analgesia and early oral feeding as tolerated. Coordinate definitive biliary management. No prophylactic antibiotics or routine urgent ERCP without an additional indication.' },
    teaching: ['Typical pain and a sufficiently elevated lipase establish pancreatitis without routine early CT.', 'Replace volume deficits with repeated reassessment rather than an unlimited fluid target; watch breathing, urine output and renal function.', 'Resume oral intake as tolerated and plan definitive gallstone management. Fever or organ dysfunction requires reassessment, not automatic attribution to sterile inflammation.'],
  },
  uncomplicated_diverticulitis: {
    personality: 'An office manager who wants to understand why a stable bowel problem can be managed at home.',
    facts: [
      history('ud_course', 'Gradual localized pain without migration', ['severity', 'constant', 'movement', 'radiate'], 'About four out of ten, in the same spot. I can walk and it does not shoot anywhere.'),
      history('ud_bowel', 'Mild constipation without obstruction', ['stool', 'bowel', 'gas', 'wind'], 'A little constipated, but I passed stool yesterday and still pass wind.', true),
      history('ud_redflags', 'No systemic illness or bleeding', ['fever', 'chills', 'blood', 'black', 'weight'], 'No fever, chills, bleeding or weight loss.', true),
      history('ud_urinary', 'No urinary or testicular symptoms', ['urine', 'burn', 'testicle', 'groin'], 'No burning urine, groin lump or testicular pain.'),
      history('ud_immunity', 'No immunosuppression or major comorbidity', ['immune', 'steroid', 'diabetes', 'medical'], 'No diabetes, immune problems or steroids. I am usually well.'),
      history('ud_meds', 'No regular medication or allergies', ['medicine', 'medication', 'allerg', 'nsaid'], 'No regular tablets or drug allergies. I have not taken ibuprofen.'),
      history('ud_previous', 'Known diverticulosis without prior complicated disease', ['previous', 'before', 'scope', 'colonoscopy'], 'A bowel screening examination last year found little pockets but no tumor.'),
      history('ud_support', 'Reliable follow-up and oral intake', ['follow', 'transport', 'phone', 'drink'], 'I can drink normally, have a phone and can get back here. My GP can review me in two days.'),
    ],
    presentation: { problemList: ['Diverticulosis'], encounters: [{ id: 'ud_colon', date: '2025-11-21', type: 'Procedure', department: 'Gastroenterology', reason: 'Screening colonoscopy', summary: 'Good preparation, complete examination. Sigmoid diverticulosis; no polyps or mass.' }] },
    labs: { creat: 0.9, hgb: 14.1, na: 138, k: 4.0 },
    counseling: [{ id: 'ud_safety', label: 'Provide specific return precautions', keywords: ['fever', 'worsening pain', 'cannot drink', 'vomiting', 'return'], description: 'Return urgently for worsening pain, fever, vomiting or inability to drink.' },
      { id: 'ud_plan', label: 'Explain symptom care and planned reassessment', keywords: ['paracetamol', 'acetaminophen', 'fluids', 'two days', 'reassessment'], description: 'Discuss simple analgesia, fluids and prompt review if symptoms persist. Antibiotics are not obligatory for this systemically well immunocompetent patient.' }],
    critical: [{ id: 'ud_safety', label: 'Explain return precautions', points: 6, rule: { type: 'counseled', ids: ['ud_safety'] } }, { id: 'ud_plan', label: 'Agree a home care and review plan', points: 6, rule: { type: 'counseled', ids: ['ud_plan'] } }],
    teaching: ['This patient is systemically well, drinking and has no CT complication.', 'Selective antibiotic use is reasonable in uncomplicated disease; do not penalize a defensible local treatment choice.', 'Outpatient care requires clear deterioration advice and accessible reassessment.'],
  },
  diverticular_abscess: {
    personality: 'A retired nurse who reports the chronology accurately but worries that she should have returned sooner.',
    facts: [
      history('da_course', 'Five days of worsening focal pain', ['onset', 'when', 'duration', 'pain'], 'It started five days ago in the lower left abdomen. It is now constant and much worse.', true),
      history('da_antibiotic', 'Confirmed outpatient regimen and adherence', ['which antibiotic', 'dose', 'co amoxiclav', 'medicine name'], 'Amoxicillin with clavulanic acid, 500/125 milligrams three times a day. I have taken it for three days without missing a dose.', true),
      history('da_hydration', 'Poor intake and reduced urine', ['urine', 'drink', 'dizzy', 'thirst'], 'Only a cup of water and a small amount of dark urine today. I feel light-headed standing.'),
      history('da_bowel', 'No complete obstruction or hemorrhage', ['stool', 'wind', 'gas', 'blood'], 'I can still pass wind and a little loose stool. No blood.'),
      history('da_history', 'Prior diverticulosis; no immunosuppression', ['medical', 'immune', 'steroid', 'past'], 'I have diverticulosis and blood pressure tablets. No steroids, chemotherapy or bowel surgery.'),
      history('da_meds', 'Amlodipine and recent antibiotics only', ['regular medication', 'allerg', 'blood thinner'], 'Amlodipine five milligrams daily and the new antibiotic. No drug allergies or blood thinner.'),
      history('da_urinary', 'No pneumaturia or urinary symptoms', ['urine bubbles', 'air urine', 'burn', 'urinary'], 'No burning or bubbles in my urine.'),
      history('da_support', 'Lives alone but daughter can help', ['home', 'support', 'family'], 'I live alone. My daughter brought me and has my medication list.'),
    ],
    presentation: { documentedHomeMeds: [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily' }, { name: 'Amoxicillin-clavulanate', dose: '500/125 mg', sig: 'PO three times daily; started three days ago', lastTaken: 'This morning' }], problemList: ['Diverticulosis', 'Hypertension'],
      encounters: [{ id: 'da_clinic', date: 'Three days before arrival', type: 'Clinic', department: 'Primary care', reason: 'Suspected diverticulitis', summary: 'Left lower quadrant pain, still drinking, no guarding at that visit. Oral antibiotics started with advice to return if worsening.' }] },
    labs: { creat: 1.1, bun: 27, lactate: { var: 'lactate' }, hgb: 12.1, na: 135, k: 3.5 },
    // A brief ED trajectory does not model abscess resolution or distinguish adequate antibiotic regimens; source control is still pending.
    physiology: { baseline: { lactate: 2.1 }, drift: { hr: 2, sbp: -2, lactate: 0.15 }, limits: { sbp: [85, 150], hr: [70, 130], lactate: [0.8, 5] }, effects: [{ tag: 'fluids', delta: { hr: -7, sbp: 5 }, tauMin: 15, maxUnits: 1 }] },
    critical: [{ id: 'da_abx', label: 'Begin IV treatment with enteric and anaerobic coverage', points: 8, rule: gutAntibiotics }, { id: 'da_fluids', label: 'Replace fluid losses', points: 6, rule: { type: 'given', codes: ['lr_bolus', 'ns_bolus'] } }],
    harms: [unsafeDischarge('A 5 cm abscess with systemic illness and oral treatment failure needs inpatient source-control assessment.')],
    consult: { criteria: 'Accept complicated diverticulitis with a pelvic collection and systemic illness. Arrange IV antibiotics and interventional radiology or surgical drainage assessment.', guard: { type: 'any', rules: [{ type: 'order', codes: ['ct_abd_iv'] }, { type: 'escalated' }, { type: 'exam', maneuvers: ['abd_palpate'] }] }, note: 'Admit for IV antibiotics and review of drainability of the 5 cm pelvic abscess. Reassess perfusion and peritoneal signs while awaiting source control.' },
    teaching: ['Failure of outpatient treatment and systemic illness warrant evaluation for an abscess or other complication.', 'CT defines the collection and guides source control; a large drainable abscess often needs more than antibiotics.', 'Initial improvement with fluids does not remove the need for inpatient care.'],
  },
  viral_gastroenteritis: {
    personality: 'A nursery cook who is mainly worried about infecting colleagues and losing pay. Wants practical advice rather than unnecessary medication.',
    facts: [
      history('vg_course', 'Abrupt short illness', ['when', 'start', 'duration'], 'It started twelve hours ago. I vomited twice early on and have had five watery stools.', true),
      history('vg_pain', 'Cramping improves after passing stool', ['pain', 'where', 'constant', 'cramp'], 'Mild cramps all over before I go to the toilet. They ease afterward; no fixed painful spot.'),
      history('vg_hydration', 'Preserved urine output and oral tolerance', ['urine', 'thirst', 'dizzy', 'drink'], 'I passed pale urine a couple of hours ago and can keep small drinks down. No dizziness.'),
      history('vg_exposures', 'No antibiotics or travel', ['antibiotic', 'hospital', 'travel', 'water'], 'No recent antibiotics, hospital stay or travel. We all use the same household bathroom.', true),
      history('vg_medical', 'No immune compromise or chronic bowel illness', ['medical', 'immune', 'bowel disease', 'diabetes'], 'No long-term illness, bowel disease or immune problems.'),
      history('vg_meds', 'No regular medicines or allergies', ['medicine', 'medication', 'allerg'], 'No regular medicine and no drug allergies. I have not tried anything for the diarrhea.'),
      history('vg_work', 'Food handling occupation', ['work', 'job', 'food handler', 'nursery'], 'I prepare food at a nursery. I was supposed to be back tomorrow.', true),
      history('vg_home', 'Able to isolate and obtain fluids', ['home', 'help', 'support'], 'I can stay home and my sister can bring rehydration sachets and food.'),
    ],
    presentation: { encounters: [{ id: 'vg_health', date: '2026-03-04', type: 'Clinic', department: 'Primary care', reason: 'Routine review', summary: 'No chronic disease or regular prescription medication recorded.' }] },
    exam: { skin_capref: 'Warm peripheries, capillary refill under two seconds.', gen_mental: 'Alert and converses normally.', abd_rebound: 'No guarding or rebound.' },
    physiology: { drift: { pain: -0.2 }, limits: { pain: [0, 10] } },
    counseling: [{ id: 'vg_fluids', label: 'Discuss oral rehydration and dehydration warning signs', keywords: ['rehydration', 'small sips', 'less urine', 'dizzy', 'cannot keep fluids'], description: 'Use frequent small drinks, preferably oral rehydration solution; return for reduced urine, dizziness, persistent vomiting or inability to drink.' },
      { id: 'vg_hygiene', label: 'Discuss hand hygiene and time away from food handling', keywords: ['soap', 'wash your hands', '48 hours', 'two days', 'prepare food'], description: 'Wash hands with soap and water and avoid food preparation while ill and for at least 48 hours after symptoms end, following local workplace rules.' }],
    critical: [{ id: 'vg_fluids', label: 'Explain oral rehydration and reassessment', points: 6, rule: { type: 'counseled', ids: ['vg_fluids'] } }, { id: 'vg_hygiene', label: 'Explain transmission precautions for a food handler', points: 6, rule: { type: 'counseled', ids: ['vg_hygiene'] } }],
    teaching: ['The short nonbloody illness and household cluster favor an infectious gastroenteritis; focal pain or systemic illness would change the assessment.', 'Oral rehydration is appropriate while drinking and urine output are maintained.', 'Discuss transmission and food-handling precautions; antibiotics do not treat a viral infection.'],
  },
  perforated_peptic_ulcer: {
    personality: 'A warehouse supervisor who minimizes weeks of dyspepsia but cannot hide the new pain. Lies still and gives short answers.',
    facts: [
      history('ppu_change', 'Sudden change to generalized peritoneal pain', ['where', 'radiate', 'move', 'constant'], 'It began high in the middle, then spread everywhere. It never lets up and any movement is awful.', true),
      history('ppu_dose', 'Regular NSAID exposure without gastroprotection', ['dose', 'how much', 'ibuprofen', 'stomach tablet'], 'Four hundred milligrams of ibuprofen three times a day for a month. No tablet to protect my stomach.', true),
      history('ppu_bleed', 'No hematemesis or melena', ['blood', 'vomit', 'black stool', 'tarry'], 'I retched once but there was no blood. No black stool.'),
      history('ppu_meal', 'Last intake two hours before onset', ['last ate', 'last meal', 'drink'], 'A sandwich about three hours ago, then a sip of water when the pain started.'),
      history('ppu_perf', 'New presyncope and reduced urine', ['dizzy', 'faint', 'urine', 'weak'], 'I felt faint getting out of the car. I have not passed urine since this morning.'),
      history('ppu_pmh', 'No previous surgery or known ulcer diagnosis', ['medical', 'history', 'ulcer', 'surgery'], 'No operations or diagnosed ulcer. I kept treating the burning with milk.'),
      history('ppu_meds', 'No anticoagulation or allergy', ['other medicine', 'allerg', 'blood thinner', 'steroid'], 'No other tablets, steroids or blood thinners. No drug allergies.'),
      history('ppu_smoke', 'Smoking history', ['smoke', 'alcohol', 'social'], 'I smoke ten cigarettes a day and have a beer on weekends.'),
      history('ppu_support', 'Partner available for history and decisions', ['family', 'home', 'support'], 'My partner brought me and knows what I take. Please tell them what is happening.'),
    ],
    presentation: { documentedHomeMeds: [{ name: 'Ibuprofen', dose: '400 mg', sig: 'PO three times daily for shoulder pain', lastTaken: 'This morning' }], problemList: ['Shoulder pain', 'Recent dyspepsia'],
      encounters: [{ id: 'ppu_shoulder', date: 'One month before arrival', type: 'Clinic', department: 'Primary care', reason: 'Shoulder pain', summary: 'Mechanical shoulder pain; conservative measures discussed. Patient subsequently used nonprescription ibuprofen most days.' }] },
    labs: { creat: 1.35, bun: 32, hgb: 14.2, hct: 43, na: 137, k: 4.1, cl: 103, hco3: 19, inr: 1.1 },
    exam: { skin_capref: [{ when: { var: 'sbp', op: '<', value: 90 }, text: 'Cool mottled extremities and capillary refill four seconds.' }, { text: 'Cool fingers, capillary refill about three seconds.' }], heent_mucosa: 'Dry mucous membranes.', pulm_auscultate: 'Clear lungs with shallow breathing.' },
    critical: [{ id: 'ppu_abx', label: 'Give broad enteric and anaerobic antimicrobial cover', points: 8, rule: gutAntibiotics }, { id: 'ppu_monitor', label: 'Monitor a patient at risk of shock', points: 4, rule: { type: 'order', codes: ['monitor'] } }],
    harms: [{ id: 'ppu_nsaid', label: 'Give further NSAID despite suspected ulcer perforation', penalty: 10, rule: { type: 'given', tags: ['nsaid'] }, teaching: 'Use an alternative analgesic in this patient with NSAID exposure and perforated ulcer.' }],
    consult: { criteria: 'Accept immediately for generalized peritonitis and suspected perforation. CT helps locate the source if the patient is stable enough; do not postpone surgical review for imaging or laboratory completion.', guard: { type: 'any', rules: [{ type: 'exam', maneuvers: ['abd_palpate', 'abd_rebound'], min: 1 }, { type: 'escalated' }] }, note: 'Emergency surgery for perforated viscus. Continue reassessed resuscitation, antibiotics, fasting and monitoring. Arrange source control; ED fluids and analgesia alone cannot resolve this condition.' },
    teaching: ['The abrupt change from dyspepsia to generalized movement-sensitive pain and rigidity is a surgical emergency.', 'Resuscitation, antibiotics and urgent source-control planning proceed in parallel.', 'Pain relief and a transient blood-pressure response do not establish recovery; the perforation remains until treated.'],
  },
  sigmoid_volvulus: {
    personality: 'A retired gardener embarrassed by his constipation. Alert, independent and concerned about a tube or operation.',
    facts: [
      history('sv_pain', 'Distention with intermittent rather than severe continuous pain', ['pain', 'constant', 'severity'], 'Mostly pressure and occasional cramps. It is not a continuous stabbing pain.', true),
      history('sv_timing', 'No stool or flatus for two days', ['last stool', 'last gas', 'duration', 'when'], 'Two days without stool or wind; usually I can pass wind even when constipated.', true),
      history('sv_vomit', 'Nausea without repeated vomiting', ['vomit', 'nausea', 'drink'], 'I feel sick and have not wanted food, but only brought up a little once.'),
      history('sv_redflags', 'No bleeding, fever or collapse', ['fever', 'blood', 'faint', 'black stool'], 'No fever, blood or fainting.'),
      history('sv_bowel', 'Chronic constipation', ['laxative', 'constipation', 'usual', 'bowel habit'], 'I often wait three or four days. I take macrogol only when I remember.'),
      history('sv_history', 'No abdominal operation or known malignancy', ['medical', 'surgery', 'cancer', 'weight'], 'No abdominal operation or cancer and no recent weight loss.'),
      history('sv_meds', 'Intermittent laxative without constipating drugs', ['medicine', 'medication', 'opioid', 'allerg'], 'Only macrogol sachets as needed. No strong painkillers or drug allergies.'),
      history('sv_home', 'Independent baseline', ['home', 'walk', 'support', 'family'], 'I live with my wife and normally do the shopping and garden myself.'),
    ],
    presentation: { documentedHomeMeds: [{ name: 'Macrogol', dose: 'One sachet', sig: 'PO as needed for constipation' }], problemList: ['Chronic constipation'],
      encounters: [{ id: 'sv_gp', date: '2026-05-10', type: 'Clinic', department: 'Primary care', reason: 'Constipation', summary: 'No rectal bleeding or weight loss. Macrogol and regular bowel routine advised.' }] },
    labs: { wbc: 9.8, hgb: 13.4, creat: 1.0, na: 138, cl: 102, hco3: 25 },
    exam: { abd_rebound: 'No guarding or percussion tenderness.', heent_mucosa: 'Mildly dry mucosa.' },
    physiology: { drift: { hr: 1, pain: 0.15 }, limits: { hr: [70, 115], pain: [0, 7] } },
    harms: [unsafeDischarge('An unresolved mechanical large bowel obstruction requires urgent decompression and inpatient review.')],
    consult: { criteria: 'Accept CT-confirmed sigmoid volvulus or a strongly suggestive distended obstipated patient. Arrange urgent endoscopic detorsion if there is no ischemia or perforation; reassess urgently for any peritoneal signs.', guard: { type: 'any', rules: [{ type: 'order', codes: ['ct_abd_iv'] }, { type: 'exam', maneuvers: ['abd_inspect'] }, { type: 'escalated' }] }, note: 'Admit for urgent endoscopic decompression with assessment of bowel viability, then discuss definitive treatment to reduce recurrence. Endoscopic detorsion is performed by the receiving team, not an ED menu action.' },
    teaching: ['Distention and obstipation with a twisted sigmoid on CT require urgent treatment even without severe pain.', 'Endoscopic detorsion is appropriate when there is no suspected ischemia or perforation; these findings instead require surgery.', 'Decompression does not eliminate recurrence risk. The receiving team should discuss definitive management.'],
  },
  esophageal_food_impaction: {
    personality: 'A builder with longstanding slow eating habits who is now alarmed by inability to swallow saliva. Speaks clearly between spitting into a cup.',
    facts: [
      history('efi_time', 'Complete obstruction for ninety minutes', ['when', 'duration', 'start'], 'It happened an hour and a half ago. Nothing has passed since, not even my saliva.', true),
      history('efi_airway', 'No airway obstruction', ['breathe', 'choke', 'voice', 'stridor'], 'I can speak and breathe normally. I did not inhale the meat.', true),
      history('efi_perforation', 'No severe chest pain, fever or forceful retching', ['chest pain', 'neck pain', 'fever', 'retch'], 'Just pressure where it is stuck. No tearing pain, fever or repeated retching.'),
      history('efi_food', 'Soft meat without bone or intentional ingestion', ['bone', 'object', 'what ate', 'foreign body'], 'Beef without bones. No tablets or other objects.'),
      history('efi_atopy', 'Atopic background', ['asthma', 'eczema', 'allergy', 'hay fever'], 'I have hay fever and eczema. No medication allergies.'),
      history('efi_history', 'Intermittent solid-only dysphagia without prior workup', ['liquid', 'weight', 'endoscopy', 'before'], 'Liquids were fine before today. For about a year I have chewed meat very carefully. My weight is stable and I have never had a scope.'),
      history('efi_meds', 'Occasional antihistamine only', ['medicine', 'medication', 'blood thinner'], 'Cetirizine ten milligrams sometimes for hay fever. No blood thinner.'),
      history('efi_support', 'Understands need for transfer', ['home', 'family', 'transport', 'transfer'], 'My partner is here. If I need another hospital, please tell us where and why.'),
    ],
    presentation: { documentedHomeMeds: [{ name: 'Cetirizine', dose: '10 mg', sig: 'PO as needed for hay fever' }], problemList: ['Atopic eczema', 'Seasonal allergic rhinitis'],
      encounters: [{ id: 'efi_gp', date: '2026-04-11', type: 'Clinic', department: 'Primary care', reason: 'Hay fever', summary: 'Seasonal symptoms; intermittent cetirizine. Swallowing difficulty was not mentioned at this visit.' }] },
    exam: { gen_appearance: 'Sitting upright, spitting saliva into a cup. No visible neck swelling.', pulm_auscultate: 'Clear bilateral breath sounds.', gen_mental: 'Alert, speaking clearly and managing secretions by spitting.' },
    critical: [{ id: 'efi_airway', label: 'Assess airway and breathing', points: 6, rule: { type: 'exam', maneuvers: ['pulm_effort'] } }],
    harms: [unsafeDischarge('Inability to swallow secretions requires emergency endoscopic assessment and a safe transfer, not outpatient observation.')],
    consult: { criteria: 'Accept complete esophageal obstruction with inability to handle secretions. Arrange emergency endoscopy and appropriate airway precautions. Do not require a contrast swallow or routine imaging to accept uncomplicated food impaction.', guard: { type: 'any', rules: [{ type: 'exam', maneuvers: ['heent_mucosa', 'pulm_effort'], min: 1 }, { type: 'escalated' }] }, note: 'Transfer accepted for emergency endoscopy. Keep fasting, monitor airway and transport appropriately. Investigate underlying dysphagia, including eosinophilic disease or stricture, after bolus removal.' },
    teaching: ['Salivary obstruction distinguishes complete food impaction from an intermittent swallowing complaint.', 'Protect the airway and arrange emergency endoscopy; attempts at oral dislodgement must not delay it.', 'Recurrent solid-food dysphagia and atopy warrant evaluation of the underlying esophageal disease after the acute obstruction is treated.'],
  },
};

// Describe the encounter endpoint, not an unobserved long-term cure.
const digestiveOutcomes: Record<string, [string, string]> = {
  biliary_colic: ['The attack has settled, oral intake is possible, and elective surgical review and warning signs are agreed.', 'Recurrent symptoms remain unexplained or follow-up is absent; persistent pain, fever or jaundice would require urgent reassessment.'],
  acute_cholecystitis: ['Surgery accepts the patient for inpatient treatment and early definitive gallbladder management.', 'Persistent inflammation and poor intake remain without an adequate inpatient surgical plan.'],
  adhesive_bowel_obstruction: ['The patient is admitted for replacement of losses, decompression and serial surgical assessment of the obstruction.', 'Vomiting and mechanical obstruction remain unresolved, with risk of aspiration, electrolyte loss and missed bowel compromise.'],
  incarcerated_groin_hernia: ['Resuscitation and urgent operative handoff are arranged for threatened bowel in the irreducible hernia.', 'The irreducible painful hernia remains untreated, leaving threatened bowel and worsening perfusion without a source-control plan.'],
  gallstone_pancreatitis: ['The receiving team continues monitored hydration, symptom treatment and assessment of oral tolerance, with definitive biliary management planned.', 'Persistent pain, vomiting and dehydration remain without a monitored treatment or biliary follow-up plan.'],
  uncomplicated_diverticulitis: ['The stable patient can drink and leaves with symptom care, accessible reassessment and clear deterioration advice.', 'The patient leaves without a workable symptom or review plan; new systemic symptoms or oral intolerance could be missed.'],
  diverticular_abscess: ['The patient is admitted for IV antimicrobial therapy and assessment of drainage or surgical source control.', 'A large abscess and systemic illness remain without a satisfactory antimicrobial and source-control plan.'],
  viral_gastroenteritis: ['Oral hydration, household precautions and appropriate time away from food handling are agreed.', 'The patient lacks a hydration or transmission-prevention plan and does not know which changes require reassessment.'],
  perforated_peptic_ulcer: ['Emergency surgery accepts the patient while resuscitation, antimicrobial treatment and monitoring continue.', 'Peritonitis and impaired perfusion persist without adequate resuscitation and urgent surgical source-control planning.'],
  sigmoid_volvulus: ['The surgical team arranges urgent decompression and later definitive management, with bowel viability reassessed during the handoff.', 'The large bowel obstruction remains unresolved without an urgent decompression plan.'],
  esophageal_food_impaction: ['A receiving center accepts the patient for emergency endoscopy, with fasting and airway precautions during transfer.', 'Complete obstruction and inability to handle saliva remain without a safe emergency endoscopy pathway.'],
};

/** Complete only this module's synthetic encounters; legacy and source adaptations never enter here. */
export function completeDigestive(c: CaseDef): void {
  const d = digestiveDetails[c.id];
  if (!d) return;
  c.persona.personality = d.personality;
  c.persona.behavior = ['Describe symptoms and concerns in everyday language; do not announce a diagnosis.', 'Give the chronology when asked, then answer the specific question. Do not invent tests, treatment or information not in the chart or history.'];
  c.persona.facts.push(...d.facts);
  Object.assign(c.presentation, d.presentation);
  Object.assign(c.labs, d.labs);
  Object.assign(c.exam, d.exam);
  if (d.physiology) {
    const effects = [...c.physiology.effects, ...(d.physiology.effects ?? [])];
    c.physiology = { ...c.physiology, ...d.physiology, baseline: { ...c.physiology.baseline, ...d.physiology.baseline }, effects };
  }
  c.teaching = d.teaching;
  [c.truth.outcomeGood, c.truth.outcomeBad] = digestiveOutcomes[c.id];
  c.scoring.critical.push(...(d.critical ?? []));
  c.scoring.harms.push(...(d.harms ?? []));
  if (d.counseling) {
    c.persona.counseling = d.counseling;
    c.scoring.critical = c.scoring.critical.filter(x => !(x.rule.type === 'counseled' && x.rule.ids.includes('counsel')));
  }
  if (d.consult && c.consults[0]) {
    const consult = c.consults[0];
    consult.criteria = d.consult.criteria;
    consult.guard = d.consult.guard;
    consult.declineHint = 'Describe the patient, relevant examination and concern. Urgent bedside assessment remains available while investigations are pending.';
    consult.onAccept.departAfterMin = 30;
    consult.onAccept.note = { title: 'Receiving team plan', text: d.consult.note };
  }
}
