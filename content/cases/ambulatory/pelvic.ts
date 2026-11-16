import type { CaseBrief } from '../brief';
import type { CaseDef, FactDef, Rule } from '../../types';
import { examine, given, order, unsafeDischarge } from './checkpoints';

const earlyPregnancy = 'NICE NG126. Ectopic pregnancy and miscarriage. https://www.nice.org.uk/guidance/ng126';
const pid = 'CDC. Pelvic inflammatory disease. https://www.cdc.gov/std/treatment-guidelines/pid.htm';

export const pelvic: CaseBrief[] = [
  {
    id: 'uncomplicated_cystitis', walkToBed: true, specialty: 'urology', age: 27, sex: 'F', difficulty: 1, esi: 4,
    complaint: 'Frequent painful urination', opening: 'I keep running to the bathroom for just a few drops.',
    facts: [['Lower tract symptoms', ['burn', 'urine', 'frequency', 'when'], 'It burns at the end of my stream. For two days I have felt the urge every hour.'],
      ['Upper tract and gynecologic symptoms', ['fever', 'flank', 'discharge', 'back'], 'No fever, pain in my side, or vaginal discharge.']],
    exam: { back_cva: 'No costovertebral angle tenderness.', abd_palpate: 'Slight suprapubic discomfort without peritonism.' },
    diagnosis: 'Acute uncomplicated cystitis', synonyms: ['cystitis', 'lower urinary tract infection', 'uti'], icd10: 'N30.00', disposition: 'discharge',
    vitals: { pain: 3 }, labs: { ua_nit: 'Positive', ua_le: '2+', ua_wbc: 45, ua_bact: 'Many', ucx: 'Escherichia coli, susceptible to nitrofurantoin.', hcg_u: 'Negative' },
    steps: [examine('Assess suprapubic and flank tenderness', 'abd_palpate', 'back_cva'), order('Select an oral antibiotic for lower tract infection', 'nitrofurantoin', 'cephalexin')],
    counseling: ['Discuss oral treatment and upper tract warning signs', ['antibiotic', 'fever', 'flank', 'kidney'], 'Discuss an appropriate oral antibiotic and reassessment for fever, vomiting or flank pain.'],
    teaching: 'New dysuria and frequency without vaginal symptoms support lower urinary tract infection. Systemic or flank symptoms change the workup.',
    references: ['NICE NG109. Lower urinary tract infection. https://www.nice.org.uk/guidance/ng109'],
  },
  {
    id: 'pyelonephritis_in_pregnancy', specialty: 'obstetrics', age: 31, sex: 'F', difficulty: 2, esi: 3,
    complaint: 'Fever and flank pain at 19 weeks of pregnancy', opening: 'I thought the bladder pain would pass. Today I cannot stop shivering.',
    facts: [['Ascending symptoms', ['urine', 'burn', 'when', 'dysuria'], 'It burned to pass urine two days before my right side began aching.'],
      ['Obstetric symptoms', ['bleed', 'fluid', 'cramp', 'pregnan'], 'I am nineteen weeks along. No bleeding, contractions or gush of fluid.']],
    exam: { back_cva: 'Marked right flank percussion tenderness.', abd_palpate: 'Gravid uterus, nontender. No rebound.' },
    diagnosis: 'Acute pyelonephritis in pregnancy', synonyms: ['pyelonephritis', 'upper urinary tract infection', 'kidney infection'], icd10: 'O23.02',
    disposition: 'admit_floor', consultant: 'obgyn', vitals: { hr: 111, temp: 38.7, pain: 6 },
    labs: { ua_le: '3+', ua_nit: 'Positive', ua_wbc: 90, ua_bact: 'Many', wbc: 15.7, hcg_u: 'Positive', ucx: 'Escherichia coli, susceptible to ceftriaxone.' },
    imaging: { us_renal: 'No obstructing stone or perinephric collection.' },
    steps: [order('Send urine for culture and susceptibility', 'ucx'), given('Begin a suitable parenteral antibiotic', 'ceftriaxone', 'cefepime')],
    teaching: 'Pyelonephritis in pregnancy merits initial inpatient parenteral treatment and obstetric assessment.',
    references: ['ACOG. Urinary tract infections in pregnant individuals. https://www.acog.org/clinical/clinical-guidance/clinical-consensus/articles/2023/08/urinary-tract-infections-in-pregnant-individuals'],
  },
  {
    id: 'pelvic_inflammatory_disease', walkToBed: true, specialty: 'gynecology', age: 24, sex: 'F', difficulty: 2, esi: 3,
    complaint: 'Lower abdominal aching and painful intercourse', opening: 'Could we talk about this somewhere private?',
    facts: [['Vaginal symptoms', ['discharge', 'bleed', 'sex', 'intercourse'], 'I have had unusual discharge and sex feels painful deep inside.'],
      ['Exposure and pregnancy risk', ['partner', 'unprotect', 'condom', 'pregnan'], 'I have a new partner. We did not always use condoms.']],
    exam: { gu_pelvic: 'With consent and a chaperone, mucopurulent cervical discharge and cervical motion tenderness. No adnexal mass.',
      abd_palpate: 'Mild bilateral lower tenderness without rebound.' },
    diagnosis: 'Acute pelvic inflammatory disease', synonyms: ['pelvic inflammatory disease', 'pid', 'salpingitis'], icd10: 'N73.0', disposition: 'discharge', vitals: { pain: 4 },
    labs: { hcg_u: 'Negative', hcg_q: 1 }, imaging: { us_pelvis_tv: 'No adnexal abscess, free fluid or ovarian enlargement.' },
    steps: [order('Assess for pregnancy', 'hcg_u', 'hcg_q'), given('Give the single-dose IM cephalosporin', 'ceftriaxone_im'),
      order('Cover chlamydia', 'doxycycline'), order('Include anaerobic coverage', 'metronidazole')],
    counseling: ['Discuss complete antimicrobial treatment, partner care and early review', ['antibiotic', 'partner', '72 hours', 'three days'], 'Explain empiric multidrug treatment, partner evaluation, abstinence during treatment and reassessment within 72 hours.'],
    teaching: 'A negative pregnancy test and cervical motion tenderness in this clinical context support empiric treatment. Arrange STI testing and review.', references: [pid],
  },
  {
    id: 'tubo_ovarian_abscess', specialty: 'gynecology', age: 35, sex: 'F', difficulty: 3, esi: 2,
    complaint: 'Pelvic pain with fever and vomiting', opening: 'Walking was painful yesterday. Now I cannot keep anything down.',
    facts: [['Recent symptoms', ['discharge', 'partner', 'sex', 'when'], 'The unusual discharge started last week, and then the pain settled on the left.'],
      ['Systemic illness', ['fever', 'chills', 'vomit', 'drink'], 'I have shaking chills and vomit even after a sip of water.']],
    exam: { gu_pelvic: 'With consent and a chaperone, cervical motion tenderness and a tender left adnexal fullness.', abd_palpate: 'Lower left abdominal tenderness without rigidity.' },
    diagnosis: 'Left tubo-ovarian abscess', synonyms: ['tubo ovarian abscess', 'tubo-ovarian abscess', 'toa', 'adnexal abscess'], icd10: 'N70.93',
    disposition: 'admit_floor', consultant: 'obgyn', vitals: { hr: 116, temp: 39.1, pain: 7 }, labs: { hcg_u: 'Negative', hcg_q: 1, wbc: 19.4, crp: 146 },
    imaging: { us_pelvis_tv: 'A 6 cm thick-walled multiloculated left adnexal collection with internal debris. The left tube and ovary are inseparable.' },
    steps: [order('Assess pregnancy status', 'hcg_q', 'hcg_u'), order('Define the adnexal collection', 'us_pelvis_tv'),
      ['Start broad coverage including anaerobes', { type: 'any', rules: [
        { type: 'order', codes: ['amp_sulb', 'cefoxitin'] },
        { type: 'all', rules: [{ type: 'order', codes: ['ceftriaxone'] }, { type: 'order', codes: ['metronidazole'] }] },
      ] }], order('Include treatment for chlamydia', 'doxycycline')],
    teaching: 'A tubo-ovarian abscess requires inpatient broad-spectrum antimicrobial therapy and gynecology review for possible drainage.', references: [pid],
  },
  {
    id: 'adnexal_torsion', specialty: 'gynecology', age: 19, sex: 'F', difficulty: 3, esi: 2,
    complaint: 'Sudden one-sided pelvic pain with vomiting', opening: 'It woke me from sleep. I cannot sit still when it grabs me.',
    facts: [['Intermittent preceding pain', ['start', 'onset', 'before', 'when'], 'I had two shorter attacks this week. This one is much worse.'],
      ['Associated symptoms', ['vomit', 'bleed', 'discharge', 'fever'], 'I vomited as soon as the pain hit. No bleeding, discharge or fever.']],
    exam: { abd_palpate: 'Focal right lower tenderness.', gu_pelvic: 'With consent and a chaperone, marked right adnexal tenderness without cervical discharge.' },
    diagnosis: 'Right ovarian torsion', synonyms: ['ovarian torsion', 'adnexal torsion', 'torsion of ovary'], icd10: 'N83.511', disposition: 'or', consultant: 'obgyn',
    vitals: { hr: 102, pain: 9 }, labs: { hcg_u: 'Negative', hcg_q: 1 },
    imaging: { us_pelvis_tv: 'Enlarged edematous right ovary with peripheral follicles and a twisted vascular pedicle. Arterial flow is still detectable.' },
    steps: [order('Check pregnancy status', 'hcg_u', 'hcg_q'), order('Keep fasting for urgent operative assessment', 'npo')],
    teaching: 'Preserved arterial flow does not exclude torsion. Discuss urgent laparoscopy with gynecology when the clinical picture fits.',
    harms: [unsafeDischarge('Loss of ovarian perfusion requires emergency gynecology assessment even when some Doppler flow remains.')],
    references: ['ACOG. Adnexal torsion in adolescents. https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2019/08/adnexal-torsion-in-adolescents'],
  },
  {
    id: 'ruptured_ovarian_cyst', specialty: 'gynecology', age: 28, sex: 'F', difficulty: 2, esi: 3,
    complaint: 'Pelvic pain after exercise', opening: 'I had a sudden stab on the left while stretching. It is easing now.',
    facts: [['Improving symptoms', ['when', 'worse', 'pain', 'faint'], 'The pain peaked immediately two hours ago. It has faded and I never felt faint.'],
      ['Cycle timing', ['period', 'cycle', 'pregnan', 'bleed'], 'My period started about two weeks ago. I have a little spotting now.']],
    exam: { abd_palpate: 'Mild left pelvic tenderness without guarding.', gu_pelvic: 'With consent and a chaperone, mild left adnexal tenderness. Scant spotting.' },
    diagnosis: 'Ruptured hemorrhagic ovarian cyst', synonyms: ['ruptured ovarian cyst', 'ruptured corpus luteum', 'hemorrhagic cyst'], icd10: 'N83.202', disposition: 'discharge',
    vitals: { pain: 3 }, labs: { hcg_u: 'Negative', hcg_q: 1, hgb: 13.1, hct: 39.5 },
    imaging: { us_pelvis_tv: 'Collapsing left corpus luteal cyst and a small volume of complex pelvic fluid. Ovaries otherwise normal in size and position.' },
    pocus: { pelvic: { text: 'Trace free fluid in the rectouterine pouch.' } },
    steps: [order('Exclude pregnancy', 'hcg_u', 'hcg_q'), order('Characterize the adnexa and pelvic fluid', 'us_pelvis_tv')],
    counseling: ['Review bleeding precautions', ['faint', 'dizz', 'worsen', 'heavy bleeding'], 'Reassess immediately for worsening pain, heavier bleeding or presyncope.'],
    teaching: 'Improving pain and stable hemodynamics support conservative care after excluding ectopic pregnancy and assessing for torsion.',
    references: ['RCOG. Ovarian cysts before the menopause. https://www.rcog.org.uk/for-the-public/browse-our-patient-information/ovarian-cysts-before-the-menopause/'],
  },
  {
    id: 'threatened_miscarriage', walkToBed: true, specialty: 'obstetrics', age: 32, sex: 'F', difficulty: 1, esi: 3,
    complaint: 'Spotting at eight weeks of pregnancy', opening: 'There was blood on the paper. Have I lost the pregnancy?',
    facts: [['Amount of bleeding', ['much', 'pad', 'bleed', 'clot'], 'It was only on the paper twice. I have not filled a pad or passed tissue.'],
      ['Obstetric history', ['pregnan', 'period', 'prior', 'miscarriage'], 'This is my first pregnancy. My last period was eight weeks ago.']],
    exam: { abd_palpate: 'Soft, nontender abdomen.', gu_pelvic: 'With consent and a chaperone, a closed cervical os and scant old blood.' },
    diagnosis: 'Threatened miscarriage with viable intrauterine pregnancy', synonyms: ['threatened miscarriage', 'threatened abortion', 'first trimester bleeding'], icd10: 'O20.0', disposition: 'discharge',
    labs: { hcg_u: 'Positive', hcg_q: 65200, abo: 'O positive' }, imaging: { us_pelvis_tv: 'Single intrauterine embryo, crown-rump length consistent with eight weeks, cardiac activity 157/min. No adnexal mass.' },
    steps: [order('Establish pregnancy location and viability', 'us_pelvis_tv')],
    counseling: ['Explain the scan and when to return', ['heartbeat', 'cardiac activity', 'heavy', 'worsen'], 'Explain the reassuring scan without promising an outcome. Review heavy bleeding, dizziness or pain.'],
    teaching: 'Bleeding can occur with a viable intrauterine pregnancy. Acknowledge the uncertainty and give explicit follow-up instructions.', references: [earlyPregnancy],
  },
  {
    id: 'pregnancy_unknown_location', walkToBed: true, specialty: 'obstetrics', age: 26, sex: 'F', difficulty: 3, esi: 3,
    complaint: 'Positive home pregnancy test and light bleeding', opening: 'My dates are uncertain. I was hoping the scan could tell me what is happening.',
    facts: [['Uncertain dating', ['period', 'date', 'cycle', 'when'], 'My periods are irregular. My first positive test was three days ago.'],
      ['Safe follow-up', ['home', 'return', 'follow', 'phone'], 'I have transport and a phone. I can come back to the early pregnancy clinic in two days.']],
    exam: { abd_palpate: 'Soft and nontender. No guarding.', gu_pelvic: 'With consent and a chaperone, minimal spotting. Os closed, no adnexal tenderness.' },
    diagnosis: 'Pregnancy of unknown location', synonyms: ['pregnancy of unknown location', 'pul', 'pregnancy of undetermined location'], icd10: 'O36.80X0', disposition: 'discharge',
    labs: { hcg_u: 'Positive', hcg_q: 620, abo: 'A positive' }, imaging: { us_pelvis_tv: 'No definite intrauterine or extrauterine gestational sac. No adnexal mass or free fluid.' },
    steps: [order('Establish baseline quantitative hCG', 'hcg_q'), order('Assess pregnancy location by ultrasound', 'us_pelvis_tv')],
    counseling: ['Arrange serial assessment and ectopic precautions', ['48 hours', 'two days', 'repeat hcg', 'serial hcg'], 'Arrange repeat quantitative hCG in about 48 hours with early pregnancy follow-up. Seek urgent care for pain, presyncope or increased bleeding.'],
    teaching: 'A single hCG value and an empty uterus do not establish the pregnancy location. Continue follow-up until the outcome is clear.', references: [earlyPregnancy],
  },
  {
    id: 'hyperemesis_gravidarum', specialty: 'obstetrics', age: 30, sex: 'F', difficulty: 2, esi: 3,
    complaint: 'Unable to keep fluids down in early pregnancy', opening: 'Even the smell of water makes me retch. I have barely passed urine.',
    facts: [['Weight loss and failed oral treatment', ['weight', 'medicine', 'eat', 'drink'], 'I lost four kilos in two weeks. I vomit the tablets the clinic gave me.'],
      ['Pregnancy context', ['weeks', 'scan', 'pain', 'bleed'], 'The dating scan showed one pregnancy at nine weeks. No bleeding or abdominal pain.']],
    exam: { heent_mucosa: 'Very dry mucous membranes.', abd_palpate: 'Soft abdomen without focal tenderness.' },
    diagnosis: 'Hyperemesis gravidarum with dehydration', synonyms: ['hyperemesis gravidarum', 'hyperemesis of pregnancy'], icd10: 'O21.1',
    disposition: 'admit_floor', consultant: 'obgyn', vitals: { hr: 109, sbp: 102, dbp: 65 }, labs: { glu: 77, na: 132, k: 3.0, cl: 89, hco3: 32, bun: 27, hcg_u: 'Positive', ua_ket: '2+' },
    imaging: { us_pelvis_tv: 'Single live intrauterine pregnancy measuring nine weeks.' },
    steps: [order('Assess electrolytes and renal function', 'bmp', 'cmp'), given('Restore intravascular volume', 'ns_bolus', 'lr_bolus')],
    physiology: { effects: [{ tag: 'fluids', tauMin: 10, maxUnits: 1, delta: { hr: -13, sbp: 8 } }] },
    teaching: 'Persistent vomiting with dehydration and electrolyte loss can require admission, parenteral antiemetics and thiamine before dextrose.',
    references: ['RCOG Green-top Guideline 69. Nausea and vomiting of pregnancy and hyperemesis gravidarum. https://doi.org/10.1111/1471-0528.17739'],
  },
  {
    id: 'uterine_fibroid_bleeding', walkToBed: true, specialty: 'gynecology', age: 41, sex: 'F', difficulty: 2, esi: 3,
    complaint: 'Heavier periods and fatigue', opening: 'I plan my shifts around my periods. Yesterday I bled through my uniform.',
    facts: [['Cyclic heavy bleeding', ['period', 'cycle', 'pad', 'bleed'], 'My periods are still regular, but each one has been heavier for six months. It is settling today.'],
      ['Anemia symptoms', ['breath', 'tired', 'faint', 'energy'], 'I get tired on stairs. No fainting, chest pain or breathlessness at rest.']],
    exam: { gu_pelvic: 'With consent and a chaperone, irregular enlarged mobile uterus with scant bleeding from the os.', skin_inspect: 'Mild pallor, warm peripheries.' },
    diagnosis: 'Heavy menstrual bleeding due to uterine leiomyomas', synonyms: ['uterine fibroids', 'uterine leiomyoma', 'fibroid bleeding', 'leiomyomas'], icd10: 'D25.9', disposition: 'discharge',
    labs: { hgb: 10.1, hct: 31, mcv: 74, hcg_u: 'Negative', hcg_q: 1 }, imaging: { us_pelvis_tv: 'Multiple well-circumscribed uterine masses including one submucosal fibroid. Adnexa unremarkable.' },
    steps: [order('Measure hemoglobin', 'cbc'), order('Assess pregnancy status', 'hcg_u', 'hcg_q')],
    counseling: ['Discuss outpatient bleeding control and follow-up', ['iron', 'gynecology', 'gynaecology', 'follow-up'], 'Discuss anemia treatment, follow-up for fibroid management and return for ongoing heavy bleeding or presyncope.'],
    teaching: 'Assess the impact of menstrual bleeding on function, check a blood count and discuss treatment choices with the patient.',
    references: ['NICE NG88. Heavy menstrual bleeding. https://www.nice.org.uk/guidance/ng88'],
  },
];

// These fields complete the synthetic encounters using the existing full case schema.
// Numerical trajectories are illustrative ED courses, not predictions for an individual patient.
interface PelvicDetail {
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
const hx = (id: string, label: string, keywords: string[], text: string, key = false): FactDef => ({ id, label, keywords, text, key });
const pelvicDetails: Record<string, PelvicDetail> = {
  uncomplicated_cystitis: {
    personality: 'A graduate student who has had one previous bladder infection. Comfortable discussing symptoms privately and keen to avoid unnecessary tests.',
    facts: [
      hx('cys_course', 'Dysuria and urgency without systemic illness', ['start', 'severity', 'onset', 'pain'], 'It started two days ago. The burning is worst right at the end, and my lower belly feels uncomfortable.', true),
      hx('cys_pregnancy', 'Recent normal period and reliable contraception', ['period', 'pregnant', 'contraception', 'lmp'], 'My normal period ended a week ago. I take my contraceptive pill regularly.', true),
      hx('cys_sex', 'No vaginal irritation or new sexual exposure', ['itch', 'vaginal', 'partner', 'sex'], 'No itching or discharge. I have the same partner and neither of us has had a recent STI.'),
      hx('cys_hematuria', 'No gross hematuria or retention', ['blood', 'red urine', 'retention', 'empty'], 'No red urine, and I can empty my bladder; I just need to go again soon afterward.'),
      hx('cys_intake', 'Normal oral intake', ['vomit', 'drink', 'dizzy', 'appetite'], 'I can eat and drink normally. No vomiting or dizziness.'),
      hx('cys_history', 'No upper tract or complicated UTI history', ['kidney', 'stone', 'diabetes', 'medical', 'catheter'], 'No kidney disease, stones, diabetes or catheter. I had one bladder infection two years ago.'),
      hx('cys_antibiotics', 'No recent resistant infection or antibiotic exposure', ['antibiotic', 'resistant', 'treatment', 'previous'], 'The last infection cleared with nitrofurantoin. No antibiotics or hospital stay since then.'),
      hx('cys_meds', 'Contraception only and no drug allergy', ['medicine', 'medication', 'allerg'], 'A combined contraceptive pill each day. I have no medicine allergies.'),
      hx('cys_follow', 'Can collect treatment and return if worse', ['home', 'pharmacy', 'follow', 'support'], 'I can collect a prescription today and contact my GP if it is not improving.'),
    ],
    presentation: { documentedHomeMeds: [{ name: 'Ethinylestradiol/levonorgestrel', dose: '30 micrograms/150 micrograms', sig: 'PO daily according to contraceptive schedule' }],
      encounters: [{ id: 'cys_old', date: '2024-08-16', type: 'Clinic', department: 'Primary care', reason: 'Uncomplicated cystitis', summary: 'Symptoms resolved after oral nitrofurantoin. No recurrent infection or renal abnormality documented.' }] },
    labs: { creat: 0.75, ua_rbc: 3, ua_sg: 1.015, wbc: 7.9 },
    exam: { heent_mucosa: 'Moist mucous membranes.', gen_mental: 'Alert and comfortable at rest.' },
    counseling: [{ id: 'cys_treatment', label: 'Explain the antibiotic and review plan', keywords: ['nitrofurantoin', 'antibiotic', '48 hours', 'two days', 'finish'], description: 'Discuss an appropriate oral regimen using local guidance and advise reassessment if not improving within 48 hours.' },
      { id: 'cys_redflags', label: 'Explain upper tract warning signs', keywords: ['fever', 'flank pain', 'vomiting', 'kidney'], description: 'Seek prompt reassessment for fever, flank pain, vomiting or systemic illness; nitrofurantoin is not a kidney-infection treatment.' }],
    critical: [{ id: 'cys_treatment', label: 'Explain treatment and follow-up', points: 6, rule: { type: 'counseled', ids: ['cys_treatment'] } }, { id: 'cys_redflags', label: 'Explain upper tract warning signs', points: 6, rule: { type: 'counseled', ids: ['cys_redflags'] } }],
    teaching: ['Dysuria and frequency without vaginal or systemic symptoms support a lower urinary infection.', 'Check pregnancy possibility and factors that make the infection complicated before selecting oral treatment.', 'Choose the regimen and duration using local resistance guidance; explain when lack of improvement or new systemic symptoms need review.'],
  },
  pyelonephritis_in_pregnancy: {
    personality: 'A pregnant teacher who fears the fever has harmed the baby. Provides the history clearly between shivers and wants the obstetric team involved.',
    facts: [
      hx('pregpyelo_course', 'Right flank pain and fever for one day', ['onset', 'duration', 'when', 'where'], 'The burning began three days ago; my right back started aching yesterday and I developed a fever overnight.', true),
      hx('pregpyelo_intake', 'Vomiting and reduced fluid intake', ['vomit', 'drink', 'urine', 'dizzy'], 'I vomited twice and could not finish breakfast. I have passed less urine today.', true),
      hx('pregpyelo_obhistory', 'G2P1 with uncomplicated current pregnancy', ['previous pregnancy', 'birth', 'scan', 'obstetric'], 'One previous term vaginal birth. My booking scan and tests were reassuring this time.'),
      hx('pregpyelo_fetal', 'No new obstetric symptoms', ['movement', 'baby', 'contraction', 'fluid'], 'I only started noticing movements recently, so I cannot judge a pattern yet. No contractions or leaking fluid.'),
      hx('pregpyelo_history', 'No renal anomaly or recurrent pyelonephritis', ['kidney', 'stone', 'medical', 'diabetes'], 'No stones, kidney problems or diabetes. I had a bladder infection years ago.'),
      hx('pregpyelo_meds', 'Prenatal supplements only', ['medicine', 'medication', 'tablet', 'allerg'], 'Only my prenatal vitamin. No drug allergies or recent antibiotic.'),
      hx('pregpyelo_sepsis', 'No syncope or breathlessness', ['faint', 'breath', 'chest', 'confused'], 'No fainting, chest pain or trouble breathing. I just feel very cold and tired.'),
      hx('pregpyelo_support', 'Family support for admission', ['home', 'child', 'support', 'work'], 'My partner can look after our child. I will stay if that is safest.'),
    ],
    presentation: { documentedHomeMeds: [{ name: 'Prenatal multivitamin', dose: 'One tablet', sig: 'PO daily' }], problemList: ['Pregnancy at 19 weeks; G2P1'],
      encounters: [{ id: 'pregpyelo_booking', date: 'At 12 weeks gestation', type: 'Clinic', department: 'Obstetrics', reason: 'Antenatal booking', summary: 'Singleton intrauterine pregnancy. Screening urine culture negative; no chronic medical condition reported.' }], priorLabs: [{ analyte: 'creat', value: 0.55, daysAgo: 49 }] },
    labs: { creat: 0.7, bun: 14, na: 134, k: 3.6, hgb: 11.3, hct: 33.9, rbc: 3.85, mcv: 88, lactate: 1.7 },
    exam: { heent_mucosa: 'Dry lips and tongue.', pulm_auscultate: 'Clear bilateral breath sounds.', skin_capref: 'Warm extremities, capillary refill two seconds.' },
    physiology: { drift: { hr: 1.5, sbp: -1 }, limits: { hr: [75, 130], sbp: [90, 145] }, effects: [{ tag: 'fluids', delta: { hr: -8, sbp: 5 }, tauMin: 15, maxUnits: 1 }, { tag: 'abx_ceftriaxone', onsetMin: 45, driftMult: { hr: 0, sbp: 0 }, maxUnits: 1 }, { tag: 'abx_cefepime', onsetMin: 45, driftMult: { hr: 0, sbp: 0 }, maxUnits: 1 }] },
    critical: [{ id: 'pregpyelo_renal', label: 'Assess blood count and renal function', points: 6, rule: { type: 'all', rules: [{ type: 'order', codes: ['cbc'] }, { type: 'order', codes: ['bmp', 'cmp'] }] } },
      { id: 'pregpyelo_fluids', label: 'Replace the fluid deficit', points: 4, rule: { type: 'given', codes: ['lr_bolus', 'ns_bolus'] } }],
    harms: [unsafeDischarge('Febrile pyelonephritis in this pregnant patient warrants initial inpatient parenteral treatment and obstetric assessment.')],
    consult: { criteria: 'Accept suspected pyelonephritis in pregnancy with fever and flank findings. Review urine culture, antibiotic given, perfusion and obstetric symptoms; do not wait for culture finalization.', guard: { type: 'any', rules: [{ type: 'exam', maneuvers: ['back_cva'] }, { type: 'order', codes: ['ucx'] }, { type: 'escalated' }] }, note: 'Admit for pregnancy-associated pyelonephritis, parenteral therapy and obstetric assessment. Tailor to culture and complete a suitable total course after clinical improvement. Renal ultrasound if obstruction or poor response is suspected.' },
    teaching: ['Fever, flank tenderness and pyuria support pyelonephritis rather than isolated cystitis.', 'Pregnancy changes disposition: initial inpatient parenteral treatment and obstetric review are appropriate.', 'Follow renal function, fluid balance and response, then tailor treatment to the culture; a falling temperature alone is not a discharge criterion.'],
  },
  pelvic_inflammatory_disease: {
    personality: 'A barista who is worried about stigma and future fertility. Will discuss partners when asked respectfully and privately.',
    facts: [
      hx('pid_time', 'Gradual bilateral pelvic pain for four days', ['when', 'onset', 'where', 'duration'], 'It built gradually over four days, low on both sides, rather than starting as a sudden sharp pain.', true),
      hx('pid_period', 'Recent menstrual period with intermenstrual spotting', ['period', 'lmp', 'spotting', 'cycle'], 'My normal period was about two weeks ago. I have had a little spotting after sex.', true),
      hx('pid_severity', 'No systemic illness or oral intolerance', ['fever', 'vomit', 'drink', 'faint'], 'No fever, vomiting or fainting. I can eat and take tablets.'),
      hx('pid_sex', 'New partner and no recent STI testing', ['new partner', 'test', 'sti', 'gonorrhea', 'chlamydia'], 'We started seeing each other two months ago. I have not had a sexual health test since then.'),
      hx('pid_contraception', 'No IUD or recent instrumentation', ['coil', 'iud', 'procedure', 'contraception'], 'No coil, recent procedure or pregnancy. We use condoms, but not every time.'),
      hx('pid_urinary', 'No predominant urinary or bowel symptoms', ['urine', 'burn', 'diarrhea', 'bowel'], 'No burning urine or diarrhea. It feels deeper in my pelvis.'),
      hx('pid_history', 'No prior PID, operations or regular medicines', ['medical', 'past', 'surgery', 'medicine', 'allerg'], 'No previous infection like this, no operations, regular medication or drug allergies.'),
      hx('pid_safety', 'Safe home situation and able to return', ['safe', 'home', 'support', 'follow'], 'I feel safe at home. I can collect medicines and come back in three days. Please contact me directly about results.'),
      hx('pid_concern', 'Fertility concern', ['worry', 'concern', 'fertility', 'children'], 'Could this affect having children later? I am embarrassed, but I want to treat it properly.'),
    ],
    presentation: { encounters: [{ id: 'pid_screen', date: '2025-08-14', type: 'Clinic', department: 'Sexual health', reason: 'Routine screening', summary: 'Gonorrhea and chlamydia tests negative at that time. No previous PID recorded. This does not exclude a new infection.' }] },
    labs: { wbc: 10.4, crp: 24, hgb: 12.8, creat: 0.7, ua_nit: 'Negative', ua_wbc: 3 },
    exam: { back_cva: 'No flank tenderness.', gen_mental: 'Alert and well perfused, concerned but not systemically unwell.' },
    counseling: [{ id: 'pid_course', label: 'Explain the full antimicrobial course', keywords: ['14 days', 'two weeks', 'doxycycline', 'metronidazole'], description: 'Explain the single IM ceftriaxone dose plus oral doxycycline 100 mg twice daily and metronidazole 500 mg twice daily for 14 days; check tolerance and adherence.' },
      { id: 'pid_partner', label: 'Discuss partner care, testing and abstinence', keywords: ['partner', 'abstain', 'no sex', 'sexual health', 'sti test'], description: 'Arrange STI testing and partner evaluation/treatment; avoid intercourse until treatment is complete, symptoms resolve and partners are treated.' },
      { id: 'pid_review', label: 'Arrange review within 72 hours and earlier if worse', keywords: ['72 hours', 'three days', 'worsening pain', 'fever', 'vomiting'], description: 'Reassess within 72 hours; seek earlier review for fever, increasing pain, vomiting or inability to take treatment.' }],
    critical: [{ id: 'pid_course', label: 'Explain the complete treatment course', points: 6, rule: { type: 'counseled', ids: ['pid_course'] } }, { id: 'pid_partner', label: 'Discuss partner care and STI testing', points: 6, rule: { type: 'counseled', ids: ['pid_partner'] } }, { id: 'pid_review', label: 'Arrange early reassessment', points: 6, rule: { type: 'counseled', ids: ['pid_review'] } }],
    teaching: ['Pelvic tenderness with compatible symptoms supports empiric treatment while assessing pregnancy and competing diagnoses.', 'Treatment needs a complete multidrug course, not only the ceftriaxone injection.', 'Clinical improvement should occur promptly; partner care, STI testing and early review are part of the plan.'],
  },
  tubo_ovarian_abscess: {
    personality: 'A childcare worker in considerable pain, worried that she will be judged for delaying assessment. Wants clear explanations before intimate examination.',
    facts: [
      hx('toa_course', 'Pelvic pain progressing over five days', ['when', 'duration', 'onset', 'where'], 'Five days of lower pain, now mostly on the left. The fever and vomiting became bad yesterday.', true),
      hx('toa_period', 'Recent period without known pregnancy', ['period', 'pregnant', 'lmp', 'cycle'], 'My period was normal three weeks ago. I have not done a pregnancy test.', true),
      hx('toa_sex', 'New sexual exposure without regular barrier protection', ['partner', 'condom', 'sti', 'sex'], 'A new partner over the last few months; we have not always used condoms and have not been tested.'),
      hx('toa_intake', 'Poor intake and urine output', ['drink', 'urine', 'dizzy', 'last ate'], 'Nothing solid since yesterday. Very little urine today, and I feel dizzy when I stand.'),
      hx('toa_bowel', 'No diarrhea or obstipation', ['bowel', 'stool', 'diarrhea', 'gas'], 'No diarrhea, and I still pass wind.'),
      hx('toa_history', 'No recent pelvic procedure or IUD', ['coil', 'iud', 'procedure', 'surgery', 'past'], 'No coil, recent operation or abortion. No previous abscess.'),
      hx('toa_meds', 'No antibiotic treatment yet', ['medicine', 'antibiotic', 'tablet', 'allerg'], 'Only paracetamol, which I vomited. No antibiotics or medicine allergies.'),
      hx('toa_support', 'Support for inpatient treatment', ['home', 'work', 'family', 'support'], 'My sister can help at home. I cannot look after myself like this and am willing to stay.'),
    ],
    presentation: { encounters: [{ id: 'toa_primary', date: '2026-01-09', type: 'Clinic', department: 'Primary care', reason: 'Routine review', summary: 'No chronic disease, regular medicines or prior abdominal surgery recorded.' }] },
    labs: { creat: 1.0, bun: 25, na: 134, k: 3.4, lactate: { var: 'lactate' }, hgb: 12.2 },
    exam: { heent_mucosa: 'Dry mucosa.', skin_capref: 'Warm peripheries with capillary refill about three seconds.', abd_rebound: 'Localized percussion tenderness without generalized rigidity.' },
    physiology: { baseline: { lactate: 2.3 }, drift: { hr: 2, sbp: -2, lactate: 0.15 }, limits: { sbp: [80, 145], hr: [70, 140], lactate: [0.8, 5] }, effects: [{ tag: 'fluids', delta: { hr: -8, sbp: 6 }, tauMin: 12, maxUnits: 1.5 }] },
    critical: [{ id: 'toa_fluids', label: 'Replace losses while arranging inpatient treatment', points: 6, rule: { type: 'given', codes: ['lr_bolus', 'ns_bolus'] } },
      { id: 'toa_antibiotics_given', label: 'Start an appropriate parenteral PID regimen', points: 8, rule: { type: 'all', rules: [{ type: 'given', codes: ['doxycycline'] }, { type: 'any', rules: [{ type: 'given', codes: ['amp_sulb', 'cefoxitin'] }, { type: 'all', rules: [{ type: 'given', codes: ['ceftriaxone'] }, { type: 'given', codes: ['metronidazole'] }] }] }] } }],
    harms: [unsafeDischarge('A tubo-ovarian abscess with systemic illness and oral intolerance requires inpatient therapy and drainage assessment.')],
    consult: { criteria: 'Accept suspected tubo-ovarian abscess with pelvic findings and systemic illness, even while ultrasound is pending. Review pregnancy testing, perfusion, parenteral antibiotics and potential drainage.', guard: { type: 'any', rules: [{ type: 'exam', maneuvers: ['gu_pelvic'] }, { type: 'order', codes: ['us_pelvis_tv'] }, { type: 'escalated' }] }, note: 'Admit for parenteral PID treatment including anaerobic cover and review for drainage. Reassess urgently if rupture or generalized peritonitis is suspected; do not expect abscess resolution during a brief ED observation.' },
    teaching: ['An adnexal collection plus systemic illness changes uncomplicated PID into an inpatient problem.', 'Begin a complete parenteral regimen, including the required organism coverage, and review drainage with gynecology.', 'Ongoing shock, generalized peritonitis or deterioration requires urgent reassessment for rupture or uncontrolled infection.'],
  },
  adnexal_torsion: {
    personality: 'A university student who is frightened by the sudden pain and worried about future fertility. Wants a chaperone and explanations before examination.',
    facts: [
      hx('torsion_time', 'Severe attack began three hours ago', ['when', 'duration', 'onset'], 'This attack woke me three hours ago. The earlier attacks lasted about twenty minutes.', true),
      hx('torsion_site', 'Focal right pelvic pain', ['where', 'radiate', 'move', 'pain'], 'Low on the right, sometimes into my groin. It did not start around my belly button.'),
      hx('torsion_cycle', 'Cycle and pregnancy risk', ['period', 'lmp', 'pregnant', 'contraception'], 'My period was normal twelve days ago. I use condoms but know that is not a guarantee.', true),
      hx('torsion_cyst', 'Known right ovarian cyst', ['cyst', 'scan', 'previous', 'past'], 'An ultrasound six weeks ago found a cyst on the right. They planned another scan, not surgery.'),
      hx('torsion_urine', 'No urinary or bowel symptoms', ['urine', 'burn', 'diarrhea', 'bowel'], 'No burning urine or diarrhea, and I passed a normal stool yesterday.'),
      hx('torsion_intake', 'Recent oral intake', ['last ate', 'last meal', 'drink'], 'Dinner last night was my last meal. I tried water after waking and vomited it.'),
      hx('torsion_meds', 'No fertility medication or drug allergy', ['medicine', 'medication', 'fertility', 'allerg'], 'No regular medicines or fertility treatment and no drug allergies.'),
      hx('torsion_history', 'No previous abdominal operation', ['surgery', 'operation', 'medical'], 'No operations or long-term medical problems.'),
      hx('torsion_concern', 'Fertility and consent concerns', ['worry', 'fertility', 'ovary', 'operation'], 'If I need an operation, will they be able to save my ovary? Please tell me what is happening.'),
    ],
    presentation: { problemList: ['Right ovarian cyst'], encounters: [{ id: 'torsion_us', date: 'Six weeks before arrival', type: 'Imaging', department: 'Gynecology', reason: 'Intermittent pelvic discomfort', summary: 'Right ovary contains a 5.4 cm simple-appearing cyst. No acute symptoms at that visit. Follow-up ultrasound planned.' }] },
    labs: { wbc: 12.1, hgb: 13.0, crp: 7, creat: 0.7, na: 138, k: 3.7, ua_nit: 'Negative', ua_wbc: 2 },
    exam: { back_cva: 'No costovertebral angle tenderness.', abd_rebound: 'Localized right lower tenderness without generalized rigidity.' },
    critical: [{ id: 'torsion_analgesia', label: 'Treat severe pain while arranging urgent review', points: 4, rule: { type: 'given', tags: ['analgesic', 'analgesic_mild'] } }],
    consult: { criteria: 'Accept immediately for suspected adnexal torsion based on abrupt unilateral pain with vomiting and relevant findings. Doppler arterial flow does not exclude torsion; neither a completed scan nor all laboratory results are prerequisites for urgent review.', guard: { type: 'any', rules: [{ type: 'exam', maneuvers: ['abd_palpate', 'gu_pelvic'], min: 1 }, { type: 'escalated' }] }, note: 'Urgent gynecologic operative assessment for suspected right adnexal torsion. Keep fasting, provide analgesia and explain fertility-preserving management when feasible. Preserved Doppler flow is not reassuring enough to discharge.' },
    teaching: ['Sudden unilateral pelvic pain with vomiting and intermittent preceding attacks warrants concern for torsion.', 'A negative pregnancy test narrows the differential but does not establish the diagnosis.', 'Urgent specialist assessment should not be delayed by preserved Doppler flow or temporary relief after analgesia.'],
  },
  ruptured_ovarian_cyst: {
    personality: 'A dance instructor who is reassured by improving pain but wants to know whether exercise caused serious bleeding.',
    facts: [
      hx('roc_site', 'Left-sided pelvic pain after activity', ['where', 'radiate', 'location'], 'Low on the left. It does not go to my shoulder or chest.'),
      hx('roc_bleeding', 'Only scant spotting', ['pad', 'blood', 'clot', 'bleeding'], 'Just a few spots on a liner; no clots or soaked pads.', true),
      hx('roc_perf', 'No presyncope or systemic symptoms', ['dizzy', 'faint', 'weak', 'fever'], 'No dizziness, fainting, fever or shaking chills.', true),
      hx('roc_pregnancy', 'Pregnancy possible despite condom use', ['pregnant', 'contraception', 'sex', 'partner'], 'I use condoms with my partner. I have not taken a pregnancy test.'),
      hx('roc_intake', 'Oral tolerance maintained', ['vomit', 'drink', 'eat', 'nausea'], 'A little nausea at first, but no vomiting. I can drink normally.'),
      hx('roc_history', 'No prior ectopic pregnancy or surgery', ['ectopic', 'past', 'surgery', 'medical'], 'No pregnancies, pelvic infection or operations. I have not had a cyst diagnosed before.'),
      hx('roc_meds', 'No anticoagulation or bleeding disorder', ['medicine', 'medication', 'blood thinner', 'bleed disorder', 'allerg'], 'No medicines, blood thinners, bleeding problem or drug allergies.'),
      hx('roc_support', 'Reliable support and access to review', ['home', 'support', 'follow', 'transport'], 'My partner can stay tonight. I have a phone, transport and a GP appointment available this week.'),
    ],
    presentation: { encounters: [{ id: 'roc_primary', date: '2026-04-05', type: 'Clinic', department: 'Primary care', reason: 'Routine review', summary: 'Regular cycles, no prior pelvic surgery, no regular medication. No bleeding disorder recorded.' }] },
    labs: { hgb: { kind: 'series', points: [[0, 13.1], [120, 13.0], [240, 13.0]] }, hct: { kind: 'series', points: [[0, 39.5], [120, 39.2], [240, 39.2]] }, rbc: { kind: 'series', points: [[0, 4.39], [120, 4.36], [240, 4.36]] }, mcv: 90, plt: 264, wbc: 8.6, creat: 0.75 },
    physiology: { drift: { pain: -0.4 }, limits: { pain: [0, 10] } },
    exam: { skin_capref: 'Warm extremities and capillary refill under two seconds.', abd_rebound: 'No rebound or involuntary guarding.' },
    counseling: [{ id: 'roc_safety', label: 'Explain bleeding and torsion warning signs', keywords: ['faint', 'dizzy', 'severe pain', 'worsening pain', 'heavy bleeding'], description: 'Return urgently for presyncope, increasing or severe pain, shoulder pain or heavy bleeding.' },
      { id: 'roc_review', label: 'Arrange follow-up and symptom care', keywords: ['follow-up', 'follow up', 'gynecology', 'analgesia', 'review'], description: 'Explain the likely cyst-related event, symptom control and follow-up; observation or admission remains reasonable if pain, hemoglobin or hemodynamics are concerning.' }],
    critical: [{ id: 'roc_cbc', label: 'Assess hemoglobin in possible intra-abdominal bleeding', points: 6, rule: { type: 'order', codes: ['cbc'] } }, { id: 'roc_safety', label: 'Give explicit return precautions', points: 6, rule: { type: 'counseled', ids: ['roc_safety'] } }, { id: 'roc_review', label: 'Agree follow-up and symptom care', points: 4, rule: { type: 'counseled', ids: ['roc_review'] } }],
    teaching: ['Pregnancy must be excluded and torsion considered before attributing acute pelvic pain to a cyst.', 'The improving symptoms, stable perfusion and stable short-term hemoglobin support conservative care in this encounter.', 'New instability or worsening pain overrides a reassuring earlier scan; give specific return instructions and accessible follow-up.'],
  },
  threatened_miscarriage: {
    personality: 'A first-time parent who is very anxious about the pregnancy. Needs clear, compassionate explanations without false promises.',
    facts: [
      hx('tm_time', 'Small-volume spotting began this morning', ['when', 'duration', 'start'], 'I first noticed it this morning. It has stayed light rather than getting heavier.', true),
      hx('tm_pain', 'No abdominal pain or presyncope', ['pain', 'cramp', 'shoulder', 'dizzy', 'faint'], 'No abdominal or shoulder pain and no dizziness or fainting.', true),
      hx('tm_tissue', 'No tissue passage or fluid loss', ['tissue', 'clot', 'fluid'], 'No tissue, clots or gush of fluid.'),
      hx('tm_dating', 'Certain last menstrual period and spontaneous conception', ['dates', 'cycle', 'fertility', 'ivf'], 'My cycles were regular and I know the date of my last period. No fertility treatment.'),
      hx('tm_infection', 'No infectious symptoms', ['fever', 'discharge', 'urine', 'burn'], 'No fever, abnormal discharge or burning urine.'),
      hx('tm_history', 'No previous pregnancy or pelvic disease', ['past', 'ectopic', 'surgery', 'medical'], 'This is my first pregnancy. No pelvic infection, operations or chronic illness.'),
      hx('tm_meds', 'Folic acid only', ['medicine', 'medication', 'allerg'], 'Folic acid four hundred micrograms daily, nothing else. No drug allergies.'),
      hx('tm_worry', 'Concern about causing the bleeding', ['worry', 'cause', 'exercise', 'work'], 'I walked a lot yesterday. I keep wondering whether I caused this.'),
      hx('tm_support', 'Support and scheduled antenatal care', ['home', 'support', 'follow', 'appointment'], 'My partner can stay with me. I have my booking appointment next week and can contact the early pregnancy service.'),
    ],
    presentation: { documentedHomeMeds: [{ name: 'Folic acid', dose: '400 micrograms', sig: 'PO daily' }], problemList: ['First pregnancy, approximately eight weeks'],
      encounters: [{ id: 'tm_gp', date: 'Two weeks before arrival', type: 'Clinic', department: 'Primary care', reason: 'Positive pregnancy test', summary: 'First spontaneous pregnancy. Folic acid advised and antenatal booking arranged. No prior miscarriage.' }] },
    labs: { hgb: 12.6, hct: 37.8, plt: 249, wbc: 8.4 },
    exam: { skin_capref: 'Warm peripheries, prompt capillary refill.', gen_mental: 'Alert and anxious, with no signs of hemodynamic compromise.' },
    counseling: [{ id: 'tm_explain', label: 'Explain present viability without guaranteeing the outcome', keywords: ['heartbeat', 'cardiac activity', 'viable', 'reassuring'], description: 'Explain that the scan shows a currently viable intrauterine pregnancy, while acknowledging uncertainty and the patient’s distress.' },
      { id: 'tm_safety', label: 'Explain return precautions and follow-up', keywords: ['heavy bleeding', 'dizzy', 'faint', 'pain', '14 days', 'two weeks'], description: 'Seek review for heavier bleeding, pain or presyncope; contact the pregnancy service if bleeding persists, and continue antenatal care if it stops.' }],
    critical: [{ id: 'tm_explain', label: 'Explain the scan with appropriate reassurance', points: 6, rule: { type: 'counseled', ids: ['tm_explain'] } }, { id: 'tm_safety', label: 'Explain follow-up and warning signs', points: 6, rule: { type: 'counseled', ids: ['tm_safety'] } }],
    teaching: ['Bleeding does not establish pregnancy loss; assess location and viability.', 'This first pregnancy has a heartbeat and only scant bleeding. Avoid implying certainty about the eventual outcome.', 'Give a clear follow-up plan and discuss new pain, heavier bleeding or presyncope. Treatment recommendations differ when there is a previous miscarriage.'],
  },
  pregnancy_unknown_location: {
    personality: 'A shop assistant with an unexpected but wanted pregnancy. Anxious about uncertainty and willing to attend serial assessment.',
    facts: [
      hx('pul_bleeding', 'Scant spotting without tissue', ['bleeding', 'pad', 'clot', 'tissue'], 'A little pink spotting on a liner since yesterday; no clots, tissue or soaked pads.', true),
      hx('pul_symptoms', 'No current rupture symptoms', ['pain', 'shoulder', 'dizzy', 'faint'], 'No abdominal or shoulder pain, dizziness or fainting.', true),
      hx('pul_cycles', 'Irregular cycles make dating unreliable', ['cycle length', 'last period', 'lmp', 'regular'], 'My cycles can be five or six weeks long. I cannot be sure when the last proper period started.'),
      hx('pul_risk', 'No previous ectopic pregnancy or tubal surgery', ['ectopic', 'tube', 'surgery', 'pid', 'infection'], 'No previous pregnancy, pelvic infection or operation on my tubes.'),
      hx('pul_conception', 'Spontaneous conception without IUD', ['fertility', 'ivf', 'coil', 'contraception'], 'No fertility treatment or coil. We stopped using condoms a few months ago.'),
      hx('pul_medical', 'No chronic illness or medicine allergy', ['medical', 'illness', 'allerg'], 'No long-term illness or medicine allergies.'),
      hx('pul_meds', 'Recently started folic acid', ['medicine', 'medication', 'folic'], 'I started folic acid four hundred micrograms daily after the positive test.'),
      hx('pul_support', 'Reliable access to serial follow-up', ['support', 'work', 'transport', 'phone'], 'My manager can let me attend and my partner can drive me. I can answer calls privately.'),
      hx('pul_concern', 'Understands that location remains uncertain', ['worry', 'concern', 'want', 'pregnancy'], 'We want the pregnancy. I need to understand what we know today and what the next test can tell us.'),
    ],
    presentation: { documentedHomeMeds: [{ name: 'Folic acid', dose: '400 micrograms', sig: 'PO daily; started three days ago' }], problemList: ['Irregular menstrual cycles'],
      encounters: [{ id: 'pul_primary', date: '2026-02-17', type: 'Clinic', department: 'Primary care', reason: 'Irregular menstrual cycles', summary: 'Cycles 35–45 days; no previous pelvic surgery or known tubal disease.' }] },
    labs: { hgb: 12.8, hct: 38.4, plt: 273, creat: 0.7 },
    exam: { skin_capref: 'Warm and well perfused.', gen_mental: 'Alert and oriented.' },
    counseling: [{ id: 'pul_serial', label: 'Arrange a concrete serial hCG and pregnancy-service review', keywords: ['48 hours', 'two days', 'repeat hcg', 'serial hcg'], description: 'Arrange quantitative hCG about 48 hours later with pregnancy-service review and subsequent ultrasound as indicated; continue follow-up until the location or outcome is established.' },
      { id: 'pul_uncertainty', label: 'Explain ectopic risk and immediate return precautions', keywords: ['ectopic', 'location unknown', 'shoulder pain', 'faint', 'one-sided pain', 'heavy bleeding'], description: 'Explain that ectopic pregnancy remains possible despite a low hCG and an empty scan. Return immediately for new pain, shoulder pain, presyncope or heavier bleeding.' }],
    critical: [{ id: 'pul_serial', label: 'Arrange serial hCG and review', points: 8, rule: { type: 'counseled', ids: ['pul_serial'] } }, { id: 'pul_uncertainty', label: 'Explain uncertainty and ectopic precautions', points: 8, rule: { type: 'counseled', ids: ['pul_uncertainty'] } }],
    harms: [{ id: 'pul_no_follow', label: 'Discharge without arranging serial assessment', penalty: 12, rule: { type: 'all', rules: [{ type: 'dispo', decisions: ['discharge'] }, { type: 'not', rule: { type: 'counseled', ids: ['pul_serial'] } }] }, teaching: 'Safe outpatient management depends on a concrete follow-up plan while ectopic pregnancy remains possible.' }],
    teaching: ['A single hCG and nondiagnostic scan do not establish pregnancy location or viability.', 'Symptoms take priority over reassuring numbers; new pain or instability needs immediate reassessment.', 'Arrange serial assessment and clear access to urgent care. Do not invent an hourly hCG trajectory that resolves a question requiring follow-up over days.'],
  },
  hyperemesis_gravidarum: {
    personality: 'An exhausted first-time parent who worries that vomiting is being dismissed as normal pregnancy sickness. Wants relief and a plan she can actually tolerate.',
    facts: [
      hx('hg_timing', 'Persistent vomiting over two weeks', ['when', 'duration', 'how often', 'vomit'], 'It started at about seven weeks. Now I retch or vomit ten times a day and cannot keep fluids down.', true),
      hx('hg_dehydration', 'Oliguria and orthostatic symptoms', ['urine', 'dizzy', 'thirst', 'faint'], 'Only a small amount of dark urine since last night. I feel light-headed when I stand.', true),
      hx('hg_weight', 'Four-kilogram loss from baseline', ['weight', 'baseline', 'lost'], 'I was sixty-two kilos before pregnancy and was fifty-eight at the clinic yesterday.'),
      hx('hg_regimen', 'Failed oral antiemetic because of vomiting', ['which tablet', 'antiemetic', 'dose', 'medicine'], 'Doxylamine ten milligrams with pyridoxine ten milligrams, two tablets at night. Lately the tablets come straight back up.'),
      hx('hg_negatives', 'No alternative infectious or abdominal symptoms', ['fever', 'diarrhea', 'urine burn', 'headache'], 'No fever, diarrhea, burning urine or headache.'),
      hx('hg_bleeding', 'No gastrointestinal bleeding or neurologic symptoms', ['blood', 'vision', 'confused', 'walk'], 'No blood in the vomit, double vision or confusion. I can walk, but feel weak.'),
      hx('hg_medical', 'No diabetes, thyroid disease or prior surgery', ['medical', 'diabetes', 'thyroid', 'surgery'], 'No medical problems or operations before pregnancy.'),
      hx('hg_supplements', 'Unable to retain supplements', ['folic', 'vitamin', 'allerg', 'supplement'], 'I have not kept my folic acid down this week. No medicine allergies.'),
      hx('hg_support', 'Support but unable to function at home', ['home', 'work', 'support', 'mood'], 'My partner is helping but I cannot work or manage meals. I feel overwhelmed and need help.'),
    ],
    presentation: { documentedHomeMeds: [{ name: 'Doxylamine/pyridoxine', dose: '10 mg/10 mg per tablet; two tablets', sig: 'PO at night; not retaining recent doses' }, { name: 'Folic acid', dose: '400 micrograms', sig: 'PO daily; not retaining recent doses' }], problemList: ['Singleton pregnancy at nine weeks'],
      encounters: [{ id: 'hg_antenatal', date: 'Yesterday', type: 'Clinic', department: 'Obstetrics', reason: 'Persistent vomiting', summary: 'Weight 58 kg, down from 62 kg before pregnancy. Unable to retain oral medication; advised ED reassessment if fluid intake fails.' }], priorLabs: [{ analyte: 'creat', value: 0.55, daysAgo: 14 }] },
    labs: { creat: 0.95, glu: 77, hgb: 13.6, hct: 40.8, rbc: 4.53, mcv: 90, mg: 1.7, ph_v: 7.46, pco2_v: 46, hco3_v: 32 },
    exam: { neuro_focal: 'No focal deficit, abnormal eye movements or ataxia.', skin_capref: 'Capillary refill about three seconds.', gen_mental: 'Exhausted but attentive and fully oriented.' },
    critical: [{ id: 'hg_thiamine', label: 'Give thiamine for prolonged poor intake', points: 6, rule: { type: 'given', codes: ['thiamine_iv'] } }, { id: 'hg_antiemetic', label: 'Treat vomiting with an antiemetic that can be retained', points: 6, rule: { type: 'given', tags: ['antiemetic'] } }],
    consult: { criteria: 'Accept dehydration and persistent inability to retain fluids or oral medicines in pregnancy. Review electrolytes, thiamine, antiemetics and nutritional risk. Ketonuria is not required to establish severity.', guard: { type: 'any', rules: [{ type: 'order', codes: ['bmp', 'cmp'] }, { type: 'exam', maneuvers: ['heent_mucosa'] }, { type: 'escalated' }] }, note: 'Admit for monitored rehydration, electrolyte replacement and parenteral antiemetic treatment. Give thiamine before carbohydrate-containing nutrition; assess nutrition and thrombosis risk. Potassium replacement and antiemetic selection require a receiving-team plan beyond the limited ED catalog.' },
    harms: [unsafeDischarge('This patient remains unable to retain fluids or treatment and has dehydration with electrolyte loss.')],
    teaching: ['Judge severity by oral tolerance, function, hydration and weight loss, not ketonuria alone.', 'Use monitored fluid and electrolyte replacement, a tolerable antiemetic route and thiamine for prolonged poor intake.', 'Reassess nutritional, psychological and thrombosis risks; a brief improvement in pulse does not establish safe oral intake.'],
  },
  uterine_fibroid_bleeding: {
    personality: 'A hospital porter whose menstrual bleeding interferes with shifts and family life. Wants treatment that takes her preferences into account.',
    facts: [
      hx('fibroid_quantity', 'Heavy cyclic flow with clots, now easing', ['pad', 'how much', 'clot', 'bleeding'], 'On the heaviest day I changed a soaked pad every hour for several hours and passed small clots. Today one pad has lasted four hours.', true),
      hx('fibroid_cycle', 'Regular cycles without intermenstrual bleeding', ['cycle', 'between periods', 'after sex', 'regular'], 'Every twenty-eight days, lasting seven days. No bleeding between periods or after sex.', true),
      hx('fibroid_pressure', 'Pelvic pressure without acute pain', ['pain', 'pressure', 'bladder', 'bowel'], 'A heavy feeling low down and sometimes needing the toilet more often. No sudden or severe pain.'),
      hx('fibroid_pregnancy', 'Pregnancy possible but no missed period', ['pregnant', 'contraception', 'lmp'], 'No missed period. We use condoms; I know a pregnancy test is still sensible.'),
      hx('fibroid_bleedhistory', 'No lifelong or family bleeding tendency', ['bruise', 'nosebleed', 'family bleeding', 'since first period'], 'My periods used to be ordinary. I do not bruise easily, have nosebleeds or know of bleeding disorders in the family.'),
      hx('fibroid_meds', 'No anticoagulation or regular treatment', ['medicine', 'medication', 'blood thinner', 'allerg'], 'No regular medicines, blood thinners or drug allergies. I have not started iron.'),
      hx('fibroid_medical', 'No other chronic disease', ['medical', 'thyroid', 'surgery', 'past'], 'No thyroid disease, major illness or surgery. I have had two normal births.'),
      hx('fibroid_fertility', 'Treatment preferences and fertility goals', ['fertility', 'children', 'preference', 'operation'], 'I do not plan another pregnancy, but would prefer to discuss medicines before major surgery.'),
      hx('fibroid_support', 'Access to outpatient review', ['home', 'follow', 'work', 'support'], 'I can see my GP this week and attend gynecology. My partner can help if I feel worse.'),
    ],
    presentation: { problemList: ['Progressively heavy menstrual bleeding'], encounters: [{ id: 'fibroid_gp', date: 'Six months before arrival', type: 'Clinic', department: 'Primary care', reason: 'Heavier periods', summary: 'Regular cycles, no intermenstrual bleeding. Hb 12.4 g/dL. Advised review if bleeding persisted; no treatment started.' }], priorLabs: [{ analyte: 'hgb', value: 12.4, daysAgo: 180 }] },
    labs: { ferritin: 8, rbc: 4.19, plt: 358, wbc: 7.2, creat: 0.8, inr: 1.0 },
    exam: { abd_palpate: 'Mild suprapubic fullness without tenderness or guarding.', skin_capref: 'Warm peripheries, capillary refill under two seconds.' },
    counseling: [{ id: 'fibroid_anemia', label: 'Discuss iron replacement and hemoglobin follow-up', keywords: ['iron', 'anemia', 'anaemia', 'blood count'], description: 'Explain likely iron deficiency, replacement and follow-up blood count, while addressing the bleeding source.' },
      { id: 'fibroid_options', label: 'Arrange gynecology review around patient preferences', keywords: ['gynecology', 'gynaecology', 'options', 'fertility', 'bleeding control'], description: 'Discuss outpatient bleeding-control options and gynecology review, considering the submucosal lesion, symptoms and fertility preferences.' },
      { id: 'fibroid_safety', label: 'Explain when bleeding requires urgent review', keywords: ['faint', 'dizzy', 'heavy bleeding', 'chest pain', 'breathless'], description: 'Return urgently for sustained heavy bleeding, presyncope, chest pain or breathlessness at rest.' }],
    critical: [{ id: 'fibroid_anemia', label: 'Address anemia and follow-up', points: 6, rule: { type: 'counseled', ids: ['fibroid_anemia'] } }, { id: 'fibroid_options', label: 'Discuss bleeding control and gynecology follow-up', points: 6, rule: { type: 'counseled', ids: ['fibroid_options'] } }, { id: 'fibroid_safety', label: 'Explain urgent return precautions', points: 6, rule: { type: 'counseled', ids: ['fibroid_safety'] } }],
    teaching: ['Assess bleeding burden, hemodynamic symptoms and impact on daily life, not only the hemoglobin.', 'The microcytosis and low ferritin support iron deficiency from chronic loss; also exclude pregnancy and assess the structural cause.', 'Stable slowing bleeding can be managed with accessible follow-up, anemia treatment and an individualized bleeding-control plan.'],
  },
};

const pelvicOutcomes: Record<string, [string, string]> = {
  uncomplicated_cystitis: ['An appropriate oral treatment and review plan is agreed, with instructions to seek care for upper tract symptoms.', 'Lower urinary symptoms remain without a treatment plan or instructions for worsening illness.'],
  pyelonephritis_in_pregnancy: ['Obstetrics accepts the patient for parenteral treatment, hydration and maternal/fetal assessment.', 'Febrile upper urinary infection in pregnancy remains without adequate inpatient antimicrobial and obstetric care.'],
  pelvic_inflammatory_disease: ['Empiric multidrug treatment, partner care, STI testing arrangements and review within 72 hours are agreed.', 'Treatment or follow-up is incomplete, leaving risk of persistent infection and untreated partners.'],
  tubo_ovarian_abscess: ['Gynecology accepts the patient for parenteral antibiotics, observation and assessment of abscess drainage.', 'The abscess and systemic illness remain without adequate antimicrobial treatment and specialist source-control assessment.'],
  adnexal_torsion: ['The patient is handed over urgently for operative assessment with an explanation of the fertility-preserving aim.', 'Suspected torsion remains without urgent operative assessment; symptom relief does not establish restored ovarian perfusion.'],
  ruptured_ovarian_cyst: ['Improving pain, stable perfusion and appropriate investigation support conservative care with explicit bleeding precautions.', 'The assessment or safety plan is incomplete; worsening bleeding, ectopic pregnancy or torsion may not have been adequately addressed.'],
  threatened_miscarriage: ['The currently viable intrauterine pregnancy is explained sensitively, with antenatal follow-up and clear return instructions.', 'The patient is left without a clear explanation of current viability, uncertainty or symptoms that require review.'],
  pregnancy_unknown_location: ['Location remains uncertain, but a concrete serial hCG and early-pregnancy review plan and ectopic precautions are in place.', 'Pregnancy location remains unknown without adequate follow-up or ectopic precautions.'],
  hyperemesis_gravidarum: ['The patient is admitted for monitored hydration, electrolyte and nutritional care, and antiemetics she can retain.', 'Persistent oral intolerance, dehydration and nutritional risk remain without adequate inpatient support.'],
  uterine_fibroid_bleeding: ['The stable patient has an anemia-treatment and gynecology review plan that addresses bleeding burden and her preferences.', 'Chronic blood loss and its functional impact remain without an anemia or bleeding-control follow-up plan.'],
};

export function completePelvic(c: CaseDef): void {
  const d = pelvicDetails[c.id];
  if (!d) return;
  c.persona.personality = d.personality;
  c.persona.behavior = ['Use everyday language and give only the information asked for; do not announce the hidden diagnosis.', 'Discuss reproductive and sexual history respectfully in private. Agree to a chaperoned examination after the clinician explains it.', 'Do not invent test results, medication use or a treatment response not supplied in the current situation.'];
  c.persona.facts.push(...d.facts);
  Object.assign(c.presentation, d.presentation);
  Object.assign(c.labs, d.labs);
  Object.assign(c.exam, d.exam);
  if (d.physiology) {
    const effects = [...c.physiology.effects, ...(d.physiology.effects ?? [])];
    c.physiology = { ...c.physiology, ...d.physiology, baseline: { ...c.physiology.baseline, ...d.physiology.baseline }, effects };
  }
  c.teaching = d.teaching;
  [c.truth.outcomeGood, c.truth.outcomeBad] = pelvicOutcomes[c.id];
  if (c.id === 'tubo_ovarian_abscess') {
    c.scoring.critical = c.scoring.critical.filter(x => !['Start broad coverage including anaerobes', 'Include treatment for chlamydia'].includes(x.label));
  }
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
    consult.declineHint = 'Describe the patient, relevant findings and concern. Urgent review remains possible before all investigations are complete.';
    consult.onAccept.departAfterMin = 30;
    consult.onAccept.note = { title: 'Receiving team plan', text: d.consult.note };
  }
  if (c.id === 'hyperemesis_gravidarum') c.patient.weightKg = 58;
  // Full assessment remains possible with observation instead of immediate home discharge.
  if (['ruptured_ovarian_cyst', 'pregnancy_unknown_location', 'threatened_miscarriage'].includes(c.id)) c.truth.acceptableDispositions = ['observation'];
}
