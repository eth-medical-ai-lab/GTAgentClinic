import { loadLibrary } from '../library';
import type { CaseDef } from '../types';
import { compileBrief, type CaseBrief, type Consultant, type Step } from './brief';
import { codexAuthor } from './provenance';
import { reportHistory } from './reportHistory';
import { admissionLabs } from './reportLabs';

// Explicit map of bedside findings and diagnostic studies to the original library record.
// A study from days later must not appear as an ED result simply because its modality matches.
interface Adaptation {
  pmcid: string;
  diagnosis: string;
  synonyms?: string[];
  opening: string;
  clue: string;
  ask: string[];
  exams: Record<string, number[]>;
  studies?: Record<string, number | { index: number; initialRead: string }>;
  /** Counterfactual early investigations inferred from the report's eventual findings. */
  simulatedImaging?: Record<string, { finding: string; basis: string }>;
  simulatedExam?: Record<string, string>;
  consultant: Consultant;
  disposition: CaseBrief['disposition'];
  steps: Step[];
  extra?: Partial<Pick<CaseBrief, 'ecg' | 'pocus' | 'labs' | 'vitals' | 'physiology' | 'capacity' | 'acceptable' | 'precautions'>>;
}
const order = (label: string, ...codes: string[]): Step => [label, { type: 'order', codes }];
const given = (label: string, ...codes: string[]): Step => [label, { type: 'given', codes }];
const examine = (label: string, ...maneuvers: string[]): Step => [label, { type: 'exam', maneuvers }];
const senior: Step = ['Request attending assistance', { type: 'escalated' }];
const ecgRead: Step = ['Review and sign the 12-lead ECG', { type: 'ecg_signed' }];
const ED_REPORTS: Adaptation[] = [
  { pmcid: 'PMC10332752', diagnosis: 'Thrombotic thrombocytopenic purpura', synonyms: ['TTP', 'immune TTP'],
    opening: 'My head is pounding and my heart keeps racing.', clue: 'My gums have bled for days, and my urine has been dark for a week.', ask: ['bleed', 'gums', 'urine', 'bruise'],
    exams: { heent_mucosa: [1], skin_inspect: [0], abd_palpate: [2], neuro_focal: [4] }, consultant: 'icu', disposition: 'admit_icu',
    steps: [order('Check for anemia and thrombocytopenia', 'cbc'), order('Look for red cell fragmentation', 'blood_film'), senior] },
  { pmcid: 'PMC10630999', diagnosis: 'Carbon monoxide poisoning', synonyms: ['CO poisoning', 'carboxyhemoglobinemia'],
    opening: 'Everything spun and I passed out for a moment.', clue: 'I was smoking a waterpipe indoors when the headache started.', ask: ['smok', 'exposure', 'indoors', 'headache', 'doing'],
    exams: { gen_mental: [0], gen_appearance: [1] }, consultant: 'transfer', disposition: 'transfer',
    steps: [order('Measure carboxyhemoglobin', 'coox'), order('Give high-concentration oxygen', 'oxygen_nrb'), senior],
    extra: { ecg: { params: { rate: 125, rhythm: 'sinus' }, machineRead: 'Sinus tachycardia with frequent ventricular extrasystoles.', readKeywords: ['ectopy','extrasystoles','pvc','sinus tachycardia'] }, labs: { cohb: 30.4 }, acceptable: ['admit_icu'] } },
  { pmcid: 'PMC10966501', diagnosis: 'Thyroid storm with antithyroid drug agranulocytosis', synonyms: ['thyroid storm', 'thyrotoxic crisis'],
    opening: 'My throat hurts so much I can hardly swallow.', clue: 'I stopped my thyroid tablets nine days ago because swallowing hurt. I have had diarrhea since then.', ask: ['thyroid', 'tablet', 'medic', 'swallow', 'diarr'],
    exams: { heent_mucosa: [1], skin_inspect: [4], gen_appearance: [0] }, consultant: 'icu', disposition: 'admit_icu',
    steps: [order('Check the white count in a febrile patient on methimazole', 'cbc'), order('Check thyroid function', 'tsh'), senior] },
  { pmcid: 'PMC11259184', diagnosis: 'Spontaneous esophageal rupture', synonyms: ['Boerhaave', 'esophageal perforation', 'oesophageal rupture'],
    opening: 'It hurts in my chest and I can barely catch my breath.', clue: 'I vomited hard several times before the pain started. It has spread through my back.', ask: ['vomit', 'retch', 'onset', 'before', 'back'],
    exams: { pulm_auscultate: [1], pulm_effort: [0] }, studies: { ct_esophagram: 1, cta_aorta: 0 }, consultant: 'surg', disposition: 'or',
    steps: [order('Look for an esophageal leak', 'ct_esophagram'), order('Keep nil by mouth', 'npo'), senior],
    extra: { ecg: { params: { rate: 120, rhythm: 'sinus', st: { V1: 2, V2: 2, V3: 2, V4: 2, V5: 2, II: 1 } }, machineRead: 'Diffuse ST elevation, most marked anteriorly.', readKeywords: ['st elevation', 'diffuse'] } } },
  { pmcid: 'PMC11345038', diagnosis: 'Wellens syndrome', synonyms: ['Wellens', 'critical LAD stenosis', 'NSTEMI'],
    opening: 'I keep getting chest pain, but it’s stopped for now.', clue: 'It comes even when I am resting. The last spell was a few hours ago in the shower.', ask: ['exert', 'rest', 'last', 'when', 'trigger'],
    exams: { cv_auscultate: [1], pulm_auscultate: [2] }, studies: { xr_chest: 0, cta_chest: 1 }, consultant: 'cards', disposition: 'cath_lab',
    steps: [ecgRead, order('Obtain cardiac biomarkers', 'trop'), given('Give an antiplatelet for suspected ACS', 'aspirin')],
    extra: { labs: { trop: { kind: 'series', points: [[0,220],[120,182]] } }, acceptable: ['admit_telemetry'],
      ecg: { params: { rate: 66, rhythm: 'sinus', pr: 220, tInversion: ['V3','V4','V5','V6','II','III','aVF'] }, machineRead: 'Anterior biphasic and inverted T waves. Prolonged PR interval.', readKeywords: ['wellens', 't wave', 't-wave', 'ischemia'] } } },
  { pmcid: 'PMC11460308', diagnosis: 'Unstable cervical fracture with cord injury', synonyms: ['cervical fracture', 'cervical spine fracture', 'chalk stick fracture'],
    opening: 'I fell. My neck hurts and my left side won’t work.', clue: 'I had been standing when I fell and hit my head. I have ankylosing spondylitis.', ask: ['fall', 'trauma', 'history', 'spine', 'ankylosing'],
    exams: { neuro_focal: [2,3,4], gen_appearance: [0,1] }, studies: { ct_cspine: 1, mri_spine: 2 }, consultant: 'transfer', disposition: 'transfer',
    steps: [order('Image the cervical spine', 'ct_cspine'), senior], extra: { acceptable: ['or','admit_icu'] } },
  { pmcid: 'PMC11661250', diagnosis: 'Wernicke encephalopathy in hyperemesis gravidarum', synonyms: ['Wernicke', 'thiamine deficiency'],
    opening: 'My eyes won’t focus and I need help walking.', clue: 'I am thirteen weeks pregnant. I was just in hospital for vomiting and I fell in the shower today.', ask: ['pregnan', 'vomit', 'intake', 'fall', 'eating'],
    exams: { neuro_focal: [2,3], neuro_gait: [4], gen_mental: [1] }, studies: { mri_brain: 1 }, consultant: 'hosp', disposition: 'admit_floor',
    steps: [given('Start parenteral thiamine', 'thiamine_iv'), order('Check glucose in a confused patient', 'glu_poc')], extra: { capacity: 'impaired', labs: { hcg_u: 'Positive' } } },
  { pmcid: 'PMC12315597', diagnosis: 'High-risk pulmonary embolism with shock', synonyms: ['pulmonary embolism', 'PE'],
    opening: 'I fainted twice. It happened without warning.', clue: 'The first time I was on the toilet. I didn’t have pain in my chest and I’m not short of breath.', ask: ['chest', 'breath', 'prodrome', 'warning', 'when'],
    exams: { skin_capref: [0], cv_edema: [2], cv_auscultate: [1] }, studies: { cta_chest: 1 }, consultant: 'icu', disposition: 'admit_icu',
    steps: [examine('Scan the heart with bedside ultrasound in undifferentiated shock', 'pocus_cardiac'), senior],
    extra: { labs: { lactate: 6.33 }, pocus: { cardiac: { text: 'Dilated and hypokinetic right ventricle.' } } } },
  { pmcid: 'PMC12333903', diagnosis: 'Postoperative staphylococcal toxic shock syndrome', synonyms: ['toxic shock', 'TSS'],
    opening: 'I was fine after the operation. Now I am hot, sick and covered in this rash.', clue: 'They operated on my nose two days ago. The vomiting and rash started yesterday.', ask: ['operation', 'surgery', 'nose', 'when', 'procedure'],
    exams: { skin_inspect: [1,3], heent_mucosa: [2] }, consultant: 'icu', disposition: 'admit_icu',
    steps: [given('Begin crystalloid resuscitation for shock', 'lr_bolus','ns_bolus'), order('Obtain blood cultures promptly', 'bcx'), senior],
    extra: { physiology: { drift: { sbp: -6 }, effects: [{ tag: 'fluids', delta: { sbp: 8 }, maxUnits: 2, tauMin: 5 }] } } },
  { pmcid: 'PMC12447112', diagnosis: 'Spontaneous cervical spinal epidural hematoma', synonyms: ['epidural hematoma', 'epidural haematoma'],
    opening: 'My neck hurt suddenly and then my right arm and leg went weak.', clue: 'This started after a massage. I take rivaroxaban.', ask: ['med', 'blood thinner', 'massage', 'injury', 'onset'],
    exams: { neuro_focal: [1,2,3], neck_stiffness: [0] }, studies: { ct_head: 0, cta_head_neck: 1 },
    simulatedImaging: { mri_spine: { finding: 'Right cervical epidural collection compresses and displaces the cord at C4; appearance favors hematoma.', basis: 'Early MRI inferred from the presenting CTA. The source MRI was obtained on day 2.' } },
    consultant: 'transfer', disposition: 'transfer',
    steps: [order('Image the cervical cord urgently', 'mri_spine'), senior] },
  { pmcid: 'PMC12661095', diagnosis: 'Ruptured abdominal aortic aneurysm', synonyms: ['ruptured AAA', 'ruptured aneurysm', 'aortic aneurysm rupture'],
    opening: 'My belly hurts on the lower right.', clue: 'It came on suddenly high up in my abdomen, then moved. Coughing makes it hurt.', ask: ['start', 'onset', 'move', 'cough', 'where'],
    exams: { abd_palpate: [1,3], abd_rebound: [1] }, studies: { ct_abd_iv: 0, cta_aorta: 0 }, consultant: 'surg', disposition: 'or',
    steps: [order('Prepare blood for hemorrhage', 'type_screen'), senior],
    extra: { pocus: { aorta: { text: 'Large infrarenal aneurysm, approximately 7 cm.' } } } },
  { pmcid: 'PMC12727365', diagnosis: 'Acute embolic mesenteric ischemia', synonyms: ['mesenteric ischemia', 'mesenteric ischaemia', 'SMA embolism'],
    opening: 'This pain low down in my belly just won’t go away.', clue: 'It began three hours ago. I feel sick and have a history of an irregular heartbeat.', ask: ['onset', 'start', 'heart', 'rhythm', 'nausea'],
    exams: { abd_palpate: [1], abd_mcburney: [2] }, studies: { ct_abd_iv: 0, cta_mesenteric: 0 }, consultant: 'surg', disposition: 'admit_icu',
    steps: [order('Look for an occluded mesenteric vessel', 'cta_mesenteric','ct_abd_iv'), senior],
    extra: { acceptable: ['transfer','or'], ecg: { params: { rate: 74, rhythm: 'afib' }, machineRead: 'Atrial fibrillation.', readKeywords: ['afib','atrial fibrillation'] } } },
  { pmcid: 'PMC12930116', diagnosis: 'Cerebral venous sinus thrombosis', synonyms: ['CVST', 'venous sinus thrombosis'],
    opening: 'My headache keeps getting worse and my vision comes and goes.', clue: 'I had a seizure yesterday. I have used anabolic steroids for bodybuilding.', ask: ['seizure', 'drug', 'supplement', 'steroid', 'bodybuilding'],
    exams: { neuro_focal: [1,2], neck_stiffness: [3] }, studies: { ct_head: 0, ct_venogram: 1 }, consultant: 'hosp', disposition: 'admit_stepdown',
    steps: [order('Investigate cerebral venous outflow', 'ct_venogram'), senior], extra: { acceptable: ['admit_icu','transfer'] } },
  { pmcid: 'PMC13062474', diagnosis: 'Benzocaine-associated methemoglobinemia', synonyms: ['methemoglobinemia','methaemoglobinaemia'],
    opening: 'Even on oxygen my fingers look blue.', clue: 'I rub a numbing gel along my gums for my dental retainers. I have done it for about a year.', ask: ['medic', 'gel', 'dental', 'exposure', 'mouth'],
    exams: { skin_inspect: [2], pulm_effort: [0] }, studies: { xr_chest_port: 0 }, consultant: 'icu', disposition: 'admit_icu',
    steps: [order('Measure abnormal hemoglobin fractions', 'coox'), senior],
    extra: { labs: { methb: 14.7 }, vitals: { o2: 'Supplemental oxygen' }, acceptable: ['admit_stepdown'] } },
  { pmcid: 'PMC13193562', diagnosis: 'Posterior myocardial infarction', synonyms: ['posterior MI', 'posterior STEMI', 'posterior OMI'],
    opening: 'The chest pain woke me up. It has almost gone now.', clue: 'It has come and gone for four days. Last night I sweated and felt sick with it.', ask: ['sweat', 'duration', 'onset', 'night', 'nausea'],
    exams: { cv_auscultate: [1], gen_appearance: [0] }, consultant: 'cards', disposition: 'cath_lab',
    steps: [ecgRead, given('Treat suspected infarction with aspirin', 'aspirin'), senior], extra: { labs: { trop: '>1000' }, pocus: { cardiac: { text:'Regional inferior and inferolateral hypokinesia on focused bedside echocardiography.' } },
      ecg: { params: { rate: 86, rhythm: 'sinus', st: { V1:-1, V2:-1, V3:-1 } }, machineRead: 'Horizontal ST depression in V1–V3. Consider posterior leads.', readKeywords: ['posterior','st depression'] } } },
  { pmcid: 'PMC13231831', diagnosis: 'Stevens–Johnson syndrome / toxic epidermal necrolysis overlap', synonyms: ['Stevens Johnson','SJS','toxic epidermal necrolysis'],
    opening: 'My skin is peeling and the sores on my lips hurt.', clue: 'I started an antibiotic last week. I kept taking it after the rash appeared.', ask: ['drug', 'medic', 'antibiotic', 'when', 'new'],
    exams: { skin_inspect: [1,3], heent_mucosa: [2] }, consultant: 'icu', disposition: 'admit_icu',
    steps: [order('Secure access for fluid support', 'iv_access'), senior], extra: { acceptable: ['transfer'] } },
  { pmcid: 'PMC13242071', diagnosis: 'Acute angle-closure glaucoma', synonyms: ['angle closure','angle-closure','closed angle glaucoma'],
    opening: 'My head and eyes hurt and everything is blurred.', clue: 'It started around my right eye after I sneezed, then I began vomiting. Light makes it worse.', ask: ['eye','vision','light','vomit','start'],
    exams: { heent_pupils: [2,3], neuro_focal: [1] }, simulatedExam: { heent_tonometry:'Right eye 39 mmHg, left eye 40 mmHg.' }, studies: { ct_head: 0 }, consultant: 'transfer', disposition: 'transfer',
    steps: [['Measure intraocular pressure', {type:'exam', maneuvers:['heent_tonometry']}],senior], extra: { acceptable: ['admit_floor'] } },
  { pmcid: 'PMC13397960', diagnosis: 'Spinal epidural abscess with cord compression', synonyms: ['epidural abscess','spinal abscess'],
    opening: 'My back is worse again and now my legs feel weak.', clue: 'I keep feeling as if my bladder is full but I struggle to pass urine. Both legs feel numb.', ask: ['bladder','urine','numb','weak','retention'],
    exams: { neuro_focal: [0,1,2,3], gen_appearance: [4] }, studies: { mri_spine: 3 }, consultant: 'transfer', disposition: 'transfer',
    steps: [order('Arrange emergency spinal MRI', 'mri_spine'), order('Obtain blood cultures', 'bcx'), senior], extra: { acceptable: ['or'] } },
  { pmcid: 'PMC13517984', diagnosis: 'Type A aortic dissection with spinal malperfusion', synonyms: ['aortic dissection','dissecting aorta'],
    opening: 'I can’t move either leg.', clue: 'I had chest pain and sweating first. That stopped, then both legs went numb.', ask: ['chest','pain','first','onset','before'],
    exams: { neuro_focal: [2,3,4], cv_pulses: [5] },
    simulatedImaging: {
      xr_chest: { finding: 'Widened mediastinal silhouette.', basis: 'The reported chest film followed new tachypnea about six hours after arrival.' },
      cta_aorta: { finding: 'A dissection flap extends from the ascending aorta across the arch and into the descending thoracic aorta.', basis: 'Early CTA inferred from the dissection found on contrast CT after deterioration in observation.' },
    }, consultant: 'transfer', disposition: 'transfer',
    steps: [order('Image the entire aorta', 'cta_aorta'), senior], extra: { acceptable: ['or'] } },
  { pmcid: 'PMC13539018', diagnosis: 'Anaphylaxis after tirzepatide', synonyms: ['anaphylaxis','anaphylactic shock'],
    opening: 'My face is swelling and it’s hard to breathe.', clue: 'Ten minutes before it started I used my first dose of a new injection for weight loss.', ask: ['trigger','med','inject','new','exposure'],
    exams: { pulm_auscultate: [2], skin_inspect: [0,1] }, studies: { xr_chest: 0 }, consultant: 'icu', disposition: 'admit_icu',
    steps: [given('Give intramuscular epinephrine', 'epi_im'), given('Give crystalloid for shock', 'ns_bolus','lr_bolus'), senior],
    extra: { acceptable: ['admit_stepdown'], physiology: { drift: { sbp:-8, spo2:-3 }, effects: [
      { tag: 'im_epinephrine', delta: { sbp:18, spo2:4 }, driftMult: { sbp:0, spo2:0 }, tauMin:3, maxUnits:1 },
      { tag: 'fluids', delta: { sbp:6 }, tauMin:6, maxUnits:2 }] } } },
  { pmcid: 'PMC13600141', diagnosis: 'Left-sided appendicitis with intestinal nonrotation', synonyms: ['appendicitis'],
    opening: 'The lower left side of my belly hurts.', clue: 'It has stayed on the left for two days. I vomited and had a fever once.', ask: ['side','fever','time','vomit','move'],
    exams: { abd_palpate: [0], abd_auscultate: [1] }, studies: { ct_abd_iv: 1, us_appendix: 0 }, consultant: 'surg', disposition: 'or',
    steps: [order('Localize the inflamed bowel', 'ct_abd_iv','us_appendix'), order('Keep nil by mouth for surgery', 'npo')] },
  { pmcid: 'PMC5965426', diagnosis: 'Emphysematous pyelonephritis', synonyms: ['emphysematous pyelonephritis','necrotizing pyelonephritis'],
    opening: 'My right side has hurt for days, and I can’t eat.', clue: 'It started four days ago. I have been vomiting and I have diabetes.', ask: ['diabet','history','when','sick','vomit'],
    exams: { back_cva: [1], gen_appearance: [0] }, studies: { ct_abd_iv: 1 }, consultant: 'icu', disposition: 'admit_icu',
    steps: [given('Start IV antibiotics for severe upper urinary infection', 'pip_tazo','cefepime','meropenem'), order('Assess for gas and obstruction', 'ct_abd_iv'), senior],
    extra: { labs: { ua_bact: 'Many', ua_wbc: '>50' } } },
  { pmcid: 'PMC6075496', diagnosis: 'Aneurysmal subarachnoid hemorrhage', synonyms: ['SAH','subarachnoid hemorrhage','subarachnoid haemorrhage'],
    opening: 'This headache woke me up. My usual migraines don’t feel like this.', clue: 'It hit the back of my head about two hours ago. I almost fainted and have tingling in my arms and legs.', ask: ['start','sudden','onset','different','faint'],
    exams: { neck_stiffness: [1], gen_appearance: [0] }, studies: { ct_head: 0 },
    simulatedImaging: { cta_head_neck: { finding: 'Saccular anterior cerebral artery aneurysm. In the setting of sudden headache, urgent neurosurgical assessment advised.', basis: 'The aneurysm was missed during the published ED visit. The simulated CTA uses the eventual diagnosis.' } },
    consultant: 'transfer', disposition: 'transfer',
    steps: [order('Arrange urgent noncontrast head CT', 'ct_head'), senior], extra: { acceptable: ['admit_icu'] } },
  { pmcid: 'PMC6304635', diagnosis: 'Lemierre syndrome', synonyms: ['Lemierre','septic thrombophlebitis of the internal jugular vein'],
    opening: 'It hurts above my breastbone when I breathe in.', clue: 'My throat was very sore five days ago. Then came the fevers, shaking chills and chest pain.', ask: ['throat','before','fever','chills','onset'],
    exams: { heent_mucosa: [2], gen_mental: [0], pulm_auscultate: [4] }, studies: { xr_chest: 0 },
    simulatedImaging: { ct_neck_chest: { finding: 'A right internal jugular filling defect has surrounding inflammatory change. Patchy bibasilar opacities and scattered pulmonary nodules are present.', basis: 'Early neck findings inferred from the contrast CT after cultures turned positive. Lung findings are limited to the abnormalities on the initial noncontrast chest CT.' } },
    consultant: 'icu', disposition: 'admit_icu',
    steps: [order('Obtain blood cultures during sepsis workup', 'bcx'), given('Cover invasive anaerobic infection', 'pip_tazo','amp_sulb','meropenem','metronidazole'), senior],
    extra: { labs: { bcx1: 'Fusobacterium necrophorum', bcx2: 'Fusobacterium necrophorum' } } },
  { pmcid: 'PMC7434240', diagnosis: 'Euglycemic diabetic ketoacidosis', synonyms: ['euglycemic DKA','euglycaemic ketoacidosis','diabetic ketoacidosis','DKA'],
    opening: 'My chest aches when I breathe in and my heart is pounding.', clue: 'I have been fasting during the day. I take empagliflozin for diabetes.', ask: ['med', 'food','fast','diet','diabetes'],
    exams: { cv_auscultate: [0], skin_capref: [1] }, studies: { cta_chest: 0 }, consultant: 'icu', disposition: 'admit_icu',
    steps: [order('Measure serum ketones despite near-normal glucose', 'ketones'), order('Assess acid–base status', 'vbg'), senior],
    extra: { labs: { bhb: 11.2, ph_v: 7.20, hco3_v: 9 }, vitals: { o2: '2 L NC' },
      ecg: { params: { rate: 116, rhythm:'sinus', st: { V2:2,V3:2,V4:2,II:1,aVR:-1 } }, machineRead: 'Diffuse ST elevation with PR depression.', readKeywords: ['pericarditis','diffuse st'] } } },
  { pmcid: 'PMC7676810', diagnosis: 'Ruptured ectopic pregnancy', synonyms: ['ectopic pregnancy','extrauterine pregnancy'],
    opening: 'I have had cramps and today I fainted on the toilet.', clue: 'My last period was about a month ago. I have an IUD so I didn’t think I could be pregnant.', ask: ['pregnan','period','contracept','IUD','menstr'],
    exams: { abd_palpate: [1], gen_appearance: [0] }, studies: { us_pelvis_tv: 2 }, consultant: 'obgyn', disposition: 'or',
    steps: [order('Test for pregnancy', 'hcg_u','hcg_q'), order('Prepare blood for hemorrhage', 'type_screen'), senior],
    extra: { labs: { hcg_q: 1800 }, pocus: { ruq: { text:'Free fluid in Morison’s pouch.' }, pelvic:{text:'Free fluid behind the uterus. No definite intrauterine pregnancy seen.'} } } },
  { pmcid: 'PMC8311984', diagnosis: 'Serotonin toxicity', synonyms: ['serotonin syndrome'],
    opening: 'My face and leg won’t stop twitching.', clue: 'I used a new migraine tablet this morning. I already take fluvoxamine.', ask: ['med', 'new', 'migraine', 'prescri', 'drug'],
    exams: { neuro_focal: [2,4,5], heent_pupils: [3], skin_inspect: [1] }, studies: { ct_head: 0 }, consultant: 'hosp', disposition: 'observation',
    steps: [order('Monitor rhythm and vital signs', 'monitor'), order('Check for muscle injury', 'ck')], extra: { acceptable: ['admit_floor','admit_stepdown'] } },
  { pmcid: 'PMC8885234', diagnosis: 'Fournier gangrene', synonyms: ['Fournier','perineal necrotizing fasciitis'],
    opening: 'My bottom and scrotum are so swollen I can’t get comfortable.', clue: 'The pain is getting worse despite my pain tablets. Yesterday the skin started looking bruised without an injury.', ask: ['pain','trauma','skin','bruise','change'],
    exams: { gu_testicular: [3,4,5], skin_inspect: [4], gen_appearance: [0] }, consultant: 'surg', disposition: 'or',
    steps: [given('Start broad-spectrum IV antibiotics', 'pip_tazo','meropenem'), senior] },
  { pmcid: 'PMC9197740', diagnosis: 'Vertebral artery dissection', synonyms: ['vertebral dissection','vertebral artery dissection'],
    opening: 'I keep feeling dizzy and now my neck and head hurt.', clue: 'I have been using a handheld massager on my neck for several weeks.', ask: ['injury','trauma','neck','massage','trigger'],
    exams: { neuro_focal: [2,3], neck_stiffness: [1] }, studies: { ct_head: 0, cta_head_neck: 1 }, consultant: 'hosp', disposition: 'admit_floor',
    steps: [order('Evaluate the vertebral arteries', 'cta_head_neck'), senior], extra: { acceptable: ['admit_stepdown','transfer'] } },
  { pmcid: 'PMC9197752', diagnosis: 'Testicular torsion', synonyms: ['spermatic cord torsion','torsion of testis'],
    opening: 'It started on the right side of my belly a few hours ago.', clue: 'The pain goes down into my scrotum and it hurts to touch. I am not burning when I pee.', ask: ['groin','testic','scrot','radiat','urine'],
    exams: { abd_palpate: [0] }, simulatedExam: { gu_testicular:'Right testis tender and elevated compared with the left.' },
    studies: { ct_abd_iv: { index: 0, initialRead: 'Appendix not identified. No right lower quadrant inflammation. No acute abnormality reported.' } },
    simulatedImaging: { us_scrotum: { finding: 'Marked asymmetric reduction of perfusion in the right testis. Urgent urology assessment for torsion advised.', basis: 'Early Doppler inferred from the torsion; the first genital examination and Doppler in the report were approximately 48 hours later.' } },
    consultant: 'surg', disposition: 'or',
    steps: [['Perform a genital exam for referred lower abdominal pain', { type:'exam',maneuvers:['gu_testicular'] }], senior] },
];

export function adaptations(): CaseDef[] {
  const records = new Map(loadLibrary().map(c => [c.source.pmcid, c]));
  return ED_REPORTS.map(a => {
    const c = records.get(a.pmcid);
    if (!c) throw new Error('Missing library record ' + a.pmcid);
    const exams: CaseDef['exam'] = {};
    for (const [maneuver, indices] of Object.entries(a.exams)) {
      exams[maneuver] = indices.map(i => {
        if (!c.exam[i]) throw new Error(`${c.id}: missing exam[${i}]`);
        return c.exam[i];
      }).join(' ');
    }
    const imagingNotes: string[] = [];
    const images = Object.fromEntries(Object.entries(a.studies ?? {}).map(([code, study]) => {
      const i = typeof study === 'number' ? study : study.index;
      const finding = c.imaging?.[i]?.finding;
      if (!finding) throw new Error(`${c.id}: missing imaging[${i}]`);
      if (typeof study === 'number') return [code, finding];
      imagingNotes.push(`${code}: initial interpretation only, from imaging[${i}].`);
      return [code, study.initialRead];
    }));
    for (const [code, study] of Object.entries(a.simulatedImaging ?? {})) {
      images[code] = study.finding;
      imagingNotes.push(`Simulated early study ${code}: ${study.basis}`);
      if (code === 'xr_chest') imagingNotes.push('xr_chest_port uses the same simulated report.');
    }
    const { tempC: temp, ...vitals } = c.vitals;
    const recordLabel = 'Published case report: ' + c.source.citation + ' ' + c.source.url;
    const labs = { ...admissionLabs(c), ...a.extra?.labs };
    const b: CaseBrief = { id:c.id, specialty:({PMC13242071:'ophthalmology', PMC13539018:'allergy', PMC9197752:'urology'} as Record<string,string>)[a.pmcid] ?? (c.category === 'infectious' ? 'infectious diseases' : c.category), age:c.patient.age, sex:c.patient.sex,
      difficulty:3, esi:c.acuity, complaint:c.presentation.chiefComplaint, opening:a.opening,
      diagnosis:a.diagnosis, synonyms:a.synonyms ?? [], icd10:c.diagnosis.icd10 ?? (a.pmcid === 'PMC12447112' ? 'G95.19' : ''), steps:a.steps,
      facts:[['History of present illness', a.ask, a.clue], reportHistory[a.pmcid]],
      problems:c.presentation.pmh.filter(m => !/^(no (significant|documented|known|prior)|previously healthy)/i.test(m)),
      meds:c.presentation.meds.filter(m => !/^(no |unknown|medication history not)/i.test(m)).map(m => ({ name:m.replace(/ \(Orajel\)/g,''),dose:'',sig:'' })),
      exam:{ ...exams, ...a.simulatedExam }, imaging:images, consultant:a.consultant, disposition:a.disposition, teaching:c.teachingPoints[0],
      references:[recordLabel], arrivalMode:c.patient.arrival === 'ems' || c.patient.arrival === 'transfer' ? 'EMS' : c.patient.arrival === 'walk-in' ? 'Walk-in' : undefined,
      ...a.extra, vitals:{ ...vitals,temp,...a.extra?.vitals }, labs };
    // Model the triage-time history only. Later inpatient diagnoses and outcomes stay in the debrief.
    const method = [
      'Adapted in content/cases/reports.ts. Record evidence and augmented fields are in the linked JSON. Selected presentation, vitals, investigations and exam come from that record. Dialogue, casting, default tests, additional findings, compressed test timing, treatment effects, acceptance criteria, disposition and scoring are simulation additions.',
      ...imagingNotes,
    ];
    if (a.simulatedExam) method.push('Simulated early exam maneuvers: ' + Object.keys(a.simulatedExam).join(', ') + '.');
    if (c.patient.sex === 'F' && c.patient.age <= 55 && labs.hcg_u === undefined) {
      labs.hcg_u = 'Negative';
      method.push('hcg_u: simulated negative pregnancy screen for the imaging workflow.');
    }
    const result = compileBrief(b, { kind:'adapted', dataset:'GTAgentClinic PMC case library', recordId:c.id, source:c.source,
      file:`content/library/${c.id}.json`, author:codexAuthor, review:'unreviewed',
      method:method.join(' ') });
    if (!c.ecg && !a.extra?.ecg) result.ecg.unavailable = true;
    result.teaching = c.teachingPoints;
    return result;
  });
}
