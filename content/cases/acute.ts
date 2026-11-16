import type { CaseBrief, Step, History } from './brief';
import type { CaseDef, Rule } from '../types';

const test = (label: string, ...codes: string[]): Step => [label, { type: 'order', codes }];
const treat = (label: string, ...codes: string[]): Step => [label, { type: 'given', codes }];
const attending: Step = ['Ask the supervising attending for help', { type: 'escalated' }];
const ada = 'ADA Standards of Care 2026, chapter 6. https://doi.org/10.2337/dc26-S006';
const aki = 'KDIGO Clinical Practice Guideline for Acute Kidney Injury. https://kdigo.org/guidelines/acute-kidney-injury/';
const neurology = 'NICE NG127, suspected neurological conditions. https://www.nice.org.uk/guidance/ng127';

export const acute: CaseBrief[] = [
  {
    id:'missed_lunch', specialty:'endocrine', age:29, sex:'F', difficulty:1, esi:3,
    complaint:'Sweating and shaking before lunch', opening:'I feel shaky. My lunch is still sitting at home.',
    facts:[['Meal timing',['meal','ate','food','insulin'],'I took my rapid insulin expecting to eat, then we had to evacuate our building.'],
      ['Safe home plan',['home','check','monitor','help'],'My partner can stay with me and I have my glucose meter and food at home.']],
    exam:{gen_mental:'Alert, oriented and hungry. Swallows water safely.',skin_inspect:'Sweaty palms and a fine tremor.'},
    diagnosis:'Insulin-associated hypoglycemia', synonyms:['hypoglycemia','hypoglycaemia'], icd10:'E16.0', disposition:'discharge',
    vitals:{hr:101}, labs:{glu:{var:'glucose'},glu_poc:{var:'glucose'}}, physiology:{baseline:{glucose:52},effects:[{tag:'oral_glucose',delta:{glucose:38,hr:-12},tauMin:5,maxUnits:1}]},
    steps:[test('Measure bedside glucose', 'glu_poc'), treat('Give fast-acting oral carbohydrate while alert', 'oral_glucose')],
    counseling:['Prevent a recurrent low',['snack','meal','recheck','glucose meter'],'Eat after correction, verify sustained glucose recovery and discuss matching insulin to meals.'],
    teaching:'In an alert patient who can swallow, treat low glucose promptly, confirm correction and address the missed meal before discharge.', references:[ada],
  },
  {
    id:'steroid_thirst', specialty:'endocrine', age:58, sex:'M', difficulty:2, esi:3,
    complaint:'Thirst and frequent urination', opening:'I am waking up five times each night for water.',
    facts:[['New steroid course',['medicine','prednisone','steroid','new'],'Urgent care started prednisone for my wheezing a few days ago.'],
      ['Diabetes follow-up',['diabetes','meter','follow','clinic'],'I have type 2 diabetes and I can see the diabetes nurse tomorrow.']],
    exam:{heent_mucosa:'Mildly dry mucosa.',gen_mental:'Converses normally. No deep or labored breathing.'},
    diagnosis:'Glucocorticoid-associated hyperglycemia', synonyms:['steroid hyperglycemia','hyperglycemia','hyperglycaemia'], icd10:'R73.9', disposition:'discharge',
    vitals:{hr:92}, labs:{glu:326,bhb:0.2,na:136,cl:102,hco3:25,creat:0.9,ua_glu:'3+',ua_ket:'Negative',ph_v:7.38},
    steps:[test('Check glucose and electrolytes', 'bmp','cmp'), test('Assess ketosis', 'ketones','ua')],
    counseling:['Arrange a glucose and medication plan',['meter','diabetes nurse','insulin','check your sugar'],'Discuss home monitoring, tomorrow’s diabetes appointment and medication adjustment with the prescriber.'],
    teaching:'Look for ketosis, acidosis and volume depletion before arranging outpatient care for symptomatic hyperglycemia.', references:[ada],
  },
  {
    id:'stoma_losses', specialty:'renal', age:62, sex:'F', difficulty:2, esi:3,
    complaint:'Dizziness with high stoma output', opening:'I have emptied the pouch every hour since yesterday.',
    facts:[['Fluid losses',['volume','stoma','output','drink'],'The ileostomy has been pouring out watery fluid and I have barely kept up.'],
      ['Baseline renal function',['baseline','kidney','urine','creatinine'],'My kidneys were fine at my check last week. Today I have barely passed urine.']],
    exam:{heent_mucosa:'Tongue dry; no tears.',abd_palpate:'Stoma pink and patent. Soft abdomen without guarding.'},
    diagnosis:'Hypovolemic acute kidney injury from ileostomy losses', synonyms:['prerenal AKI','acute kidney injury','prerenal azotemia'], icd10:'N17.9', disposition:'admit_floor',
    vitals:{hr:112,sbp:96,dbp:62}, labs:{bun:56,creat:2.4,na:132,k:3.3,hco3:19,cl:103,mg:1.4},
    physiology:{effects:[{tag:'fluids',delta:{hr:-12,sbp:10},tauMin:10,maxUnits:2}]},
    steps:[test('Check renal function and electrolytes', 'bmp','cmp'), treat('Replace ongoing fluid losses', 'ns_bolus','lr_bolus')],
    teaching:'A high-output ileostomy can cause rapid salt and fluid depletion. Reassess urine output, electrolytes and perfusion after replacement.', references:[aki],
  },
  {
    id:'dialysis_orthopnea', specialty:'renal', age:57, sex:'M', difficulty:3, esi:2,
    complaint:'Unable to lie flat for breathlessness', opening:'I had to sleep upright. My shoes no longer fit.',
    facts:[['Missed dialysis',['dialysis','miss','session','when'],'The ride failed for two scheduled sessions. My last dialysis was six days ago.'],
      ['Anuria and target weight',['weight','urine','fluid','water'],'I do not make urine. I am five kilos above my target weight.']],
    exam:{pulm_auscultate:'Crackles throughout both lower lung fields.',cv_edema:'Bilateral pitting ankle edema.',neck_jvp:'Jugular venous column visibly elevated.'},
    diagnosis:'Pulmonary edema from missed hemodialysis', synonyms:['volume overload','fluid overload','pulmonary edema','pulmonary oedema'], icd10:'E87.70', disposition:'admit_icu', consultant:'icu',
    vitals:{hr:110,sbp:188,dbp:104,rr:30,spo2:86}, labs:{creat:10,bun:88,k:5.8,hco3:18,na:132,cl:100},
    imaging:{xr_chest_port:'Bilateral perihilar interstitial and airspace edema with small effusions.'}, pocus:{lung:{text:'Diffuse bilateral B-lines.'}},
    physiology:{effects:[{tag:'oxygen',delta:{spo2:5},tauMin:2,maxUnits:1},{tag:'high_flow_oxygen',delta:{spo2:9},tauMin:2,maxUnits:1}]},
    steps:[test('Provide oxygen while arranging definitive volume removal', 'o2_nc','oxygen_nrb'), test('Assess potassium and acid–base status', 'bmp','cmp'), attending],
    teaching:'In an anuric dialysis patient, oxygen and ventilatory support buy time while the team arranges urgent dialysis for severe pulmonary edema.', references:[aki],
  },
  {
    id:'exercise_dark_urine', specialty:'renal', age:26, sex:'F', difficulty:2, esi:3,
    complaint:'Dark urine after a cycling class', opening:'Both thighs ache so much that I have to hold the rail on the stairs.',
    facts:[['Unaccustomed exertion',['activity','workout','exercise','injury'],'It was my first long indoor cycling class. I kept pedaling even when my legs burned.'],
      ['Urine change',['urine','color','blood'],'My urine is brown like tea. Passing it does not burn.']],
    exam:{gen_appearance:'Both thighs are tender without tense compartments. Distal sensation and pulses are preserved.'},
    diagnosis:'Exertional rhabdomyolysis', synonyms:['rhabdomyolysis','rhabdo'], icd10:'M62.82', disposition:'admit_floor',
    labs:{ck:31900,creat:1.8,bun:33,k:5.2,ua_blood:'3+',ua_rbc:'0–2',ast:284,alt:86},
    steps:[test('Measure muscle injury', 'ck'), test('Check for renal injury and potassium elevation', 'bmp','cmp'), treat('Start monitored isotonic fluid replacement', 'ns_bolus','lr_bolus')],
    teaching:'Dipstick heme with few red cells suggests myoglobin. Track creatinine, potassium, urine output and compartment findings.', references:[aki],
  },
  {
    id:'cramps_long_qt', specialty:'electrolytes', age:64, sex:'F', difficulty:2, esi:2,
    complaint:'Palpitations and hand cramps', opening:'My hands keep cramping and my heart seems to skip.',
    facts:[['GI losses',['diarr','stool','vomit','loss'],'I have had diarrhea every day for the last week.'],
      ['Medication risks',['drug','med','water pill','heartburn'],'I take a water pill and a daily tablet for reflux.']],
    exam:{cv_auscultate:'Regular tachycardia with occasional premature beats.',neuro_focal:'Fine tremor and intermittent carpal spasm. Strength symmetric.'},
    diagnosis:'Symptomatic hypomagnesemia', synonyms:['hypomagnesemia','hypomagnesaemia','magnesium depletion'], icd10:'E83.42', disposition:'admit_telemetry',
    vitals:{hr:102},labs:{mg:0.7,k:2.9,ca:7.8,creat:1.0},ecg:{params:{rate:102,rhythm:'sinus',qt:416},machineRead:'Sinus tachycardia. Prolonged corrected QT interval.',readKeywords:['long qt','prolonged qt','qt prolongation']},
    steps:[test('Measure magnesium', 'mg'),test('Monitor for ventricular arrhythmia','monitor'),treat('Give monitored magnesium replacement','magnesium_iv')],
    teaching:'Severe magnesium depletion can cause cramps, refractory hypokalemia and ventricular arrhythmia. Replace magnesium and monitor rhythm and potassium.',
    references:["NHS Specialist Pharmacy Service, treating acute hypomagnesaemia in adults. https://sps.nhs.uk/articles/treating-acute-hypomagnesaemia-in-adults/"],
  },
  {
    id:'calcium_constipation', specialty:'endocrine', age:69, sex:'M', difficulty:2, esi:2,
    complaint:'Constipation, thirst and slower thinking', opening:'I can’t finish a thought. I keep wanting another glass of water.',
    facts:[['Excess calcium use',['tablet','antacid','med','calcium'],'I chew calcium antacids throughout the day for heartburn. I also take calcium supplements.'],
      ['Symptoms of hypercalcemia',['stool','bowel','urine','thirst'],'I am urinating all night but my bowels have hardly moved for a week.']],
    exam:{gen_mental:'Slow but oriented, attention drifts.',heent_mucosa:'Dry tongue.',abd_palpate:'Soft, mildly full abdomen without peritoneal signs.'},
    diagnosis:'Severe symptomatic hypercalcemia', synonyms:['hypercalcemia','hypercalcaemia','calcium alkali syndrome','milk alkali syndrome'], icd10:'E83.52', disposition:'admit_telemetry',
    labs:{ca:15.2,alb:4.0,creat:2.0,bun:38,hco3:34},steps:[test('Measure calcium and renal function','bmp','cmp'),treat('Restore intravascular volume','ns_bolus'),attending],
    teaching:'Marked symptomatic hypercalcemia warrants monitored treatment. Review calcium and alkali intake and evaluate the underlying cause.',
    references:["Society for Endocrinology, emergency management of acute hypercalcaemia in adults. https://pmc.ncbi.nlm.nih.gov/articles/PMC5314807/"],
  },
  {
    id:'heavy_periods_fatigue', specialty:'hematology', age:35, sex:'F', difficulty:1, esi:3,
    complaint:'Months of fatigue and chewing ice', opening:'I used to climb three flights easily. Now I stop for breath.',
    facts:[['Menstrual losses',['period','bleed','menstr','pad'],'My periods have been getting very heavy. I am between periods and am not bleeding today.'],
      ['Slow course',['time','when','food','ice'],'Months, really. I keep a cup of ice chips with me all day.']],
    exam:{heent_mucosa:'Conjunctivae are pale.',cv_auscultate:'Soft systolic flow murmur. Regular pulse.'},
    diagnosis:'Iron deficiency anemia from heavy menstrual bleeding', synonyms:['iron deficiency','iron-deficiency anemia'], icd10:'D50.0',disposition:'discharge',
    labs:{hgb:9.6,hct:31,mcv:68,plt:441,hcg_u:'Negative',ferritin:5},walkToBed:true,
    steps:[test('Characterize anemia on the blood count','cbc'),test('Confirm depleted iron stores','iron_stores')],
    counseling:['Address the source and iron replacement',['iron','gynecology','gynaecology','bleeding'],'Discuss iron replacement and arrange outpatient evaluation of heavy bleeding.'],
    teaching:'Microcytic anemia with low ferritin suggests iron deficiency. A stable patient also needs a plan to address the source of blood loss.',
    references:["British Society of Gastroenterology, iron deficiency anaemia in adults. https://pmc.ncbi.nlm.nih.gov/articles/PMC8515119/"],
  },
  {
    id:'hemolysis_after_infection', specialty:'hematology', age:24, sex:'M', difficulty:2, esi:3,
    complaint:'Yellow eyes and dark urine after a cold', opening:'My eyes have gone yellow and the urine is the color of tea.',
    facts:[['Family episodes',['family','before','history','relative'],'My brother became jaundiced after an illness too. I was told as a child to avoid fava beans.'],
      ['Preceding illness',['trigger','infection','fever','recent'],'I had a fever and sore throat a few days before the color changed.']],
    exam:{heent_mucosa:'Scleral icterus with conjunctival pallor.',abd_palpate:'Soft; no right upper quadrant tenderness.'},
    diagnosis:'Acute hemolysis in G6PD deficiency',synonyms:['G6PD deficiency','oxidative hemolysis','G6PD'],icd10:'D55.0',disposition:'admit_floor',
    vitals:{hr:109},labs:{hgb:8.1,hct:24,mcv:91,tbili:5.8,dbili:0.5,smear:'Polychromasia with bite cells.',ua_blood:'3+',ua_rbc:'0–2'},
    steps:[test('Review blood film for oxidative injury','blood_film'),test('Assess anemia and bilirubin','cbc'),test('Assess renal function','bmp','cmp')],
    teaching:'Bite cells, hemoglobinuria and indirect hyperbilirubinemia suggest oxidative hemolysis. Enzyme testing during reticulocytosis may need repeating after recovery.',
    references:["Royal College of Pathologists of Australasia, G-6-PD deficiency. https://www.rcpa.edu.au/Manuals/RCPA-Manual/Clinical-Presentations-and-Diagnoses/G/G-6-PD-deficiency"],
  },
  {
    id:'fever_after_infusion',specialty:'oncology',age:53,sex:'F',difficulty:3,esi:2,
    complaint:'Fever ten days after an infusion',opening:'The cancer unit told me to come straight in if I got a temperature.',
    facts:[['Recent chemotherapy',['chemo','infusion','cancer','treatment'],'I had my second cycle ten days ago. My blood counts were low at my last check.'],
      ['Subtle presentation',['chills','pain','urine','cough'],'I felt a little chilly, but I have no cough, chest or abdominal pain, or trouble passing urine.']],
    exam:{heent_mucosa:'Several shallow oral ulcers.',skin_inspect:'The port site is clean without redness.'},
    diagnosis:'Febrile neutropenia',synonyms:['neutropenic fever','neutropenic sepsis'],icd10:'D70.1',disposition:'admit_floor',
    vitals:{temp:38.6,hr:112,sbp:108,dbp:68},labs:{wbc:0.6,neut:18,bands:0,hgb:9.8,plt:88,lactate:1.5},
    steps:[test('Draw cultures promptly','bcx'),treat('Give an empiric antipseudomonal antibiotic','cefepime','pip_tazo','meropenem')],
    physiology:{drift:{sbp:-5,hr:4},effects:[{tag:'abx',onsetMin:15,driftMult:{sbp:0,hr:0},delta:{temp:-0.8},tauMin:50,maxUnits:1}]},
    teaching:'Start empiric IV antibiotics promptly in suspected neutropenic sepsis. An unimpressive local examination can accompany serious infection.',references:['NICE CG151. https://www.nice.org.uk/guidance/cg151'],
  },
  {
    id:'delayed_headache_fall',specialty:'neurosurgery',age:77,sex:'M',difficulty:2,esi:2,
    complaint:'Progressive headache after a small fall',opening:'I bumped my head a few days ago. Now I keep dropping things.',
    facts:[['Recent head trauma',['fall','injury','head','trauma'],'I caught my foot on the rug four days ago. I hit my head but did not black out.'],
      ['Anticoagulation',['med','blood thinner','anticoag','tablet'],'I take apixaban every morning and evening for an irregular heartbeat.']],
    exam:{neuro_focal:'Left pronator drift and slower left finger taps.',gen_mental:'Alert and answers appropriately, but speech is slow.'},
    diagnosis:'Traumatic subdural hematoma',synonyms:['subdural hemorrhage','subdural haematoma','subdural hematoma','SDH'],icd10:'S06.5X0A',disposition:'transfer',consultant:'transfer',
    imaging:{ct_head:'Right crescentic subdural collection with focal acute blood, local mass effect and 5 mm leftward midline shift.'},
    steps:[test('Obtain an urgent noncontrast head CT','ct_head'),attending],
    teaching:'New focal deficits after minor trauma in an anticoagulated older adult require urgent imaging, reversal assessment and neurosurgical involvement.',references:['NICE NG232, head injury. https://www.nice.org.uk/guidance/ng232'],
  },
  {
    id:'positional_spinning',specialty:'vestibular',age:48,sex:'F',difficulty:1,esi:4,
    complaint:'Brief spinning on turning over in bed',opening:'If I roll onto my right the whole room tips for a moment.',
    facts:[['Brief positional attacks',['how long','duration','position','roll'],'Each spin lasts under half a minute. If I lie still it stops completely.'],
      ['No focal symptoms',['double','vision','weak','speech'],'No double vision, weakness, hearing change or trouble speaking. I walk fine between attacks.']],
    exam:{vestibular_position:'Right Dix–Hallpike elicits a delayed, brief torsional upbeating nystagmus that fatigues.',neuro_gait:'Steady unaided between attacks.'},
    diagnosis:'Posterior canal benign paroxysmal positional vertigo',synonyms:['BPPV','benign positional vertigo','benign paroxysmal positional vertigo'],icd10:'H81.11',disposition:'discharge',walkToBed:true,
    steps:[test('Offer canalith repositioning','reposition_canalith')],
    counseling:['Explain recurrences and red flags',['recur','double vision','weakness','continuous'],'Explain recurrence and return for continuous symptoms or a focal neurologic deficit.'],
    teaching:'Use the nystagmus pattern during positional testing to select a canalith repositioning maneuver.',references:['AAO-HNS clinical practice guideline. https://www.entnet.org/quality-practice/quality-products/clinical-practice-guidelines/bppv/'],
  },
  {
    id:'cluster_attack',specialty:'neurology',age:36,sex:'M',difficulty:1,esi:3,
    complaint:'Severe one-sided pain behind the eye',opening:'I can’t sit still. It is piercing right behind my eye again.',
    facts:[['Attack timing',['when','time','before','episodes'],'Almost the same time every night for this week. It lasts about forty minutes.'],
      ['Autonomic symptoms',['nose','tear','water','eye'],'My right eye streams and my right nostril runs during every attack. This is like my previous cluster bouts.']],
    exam:{heent_pupils:'Right lacrimation and mild ptosis, pupils reactive; visual acuity preserved.',neuro_focal:'Normal speech, eye movements, power and coordination.'},
    diagnosis:'Episodic cluster headache',synonyms:['cluster headache','cluster attack'],icd10:'G44.019',disposition:'discharge',vitals:{pain:9},walkToBed:true,
    steps:[test('Abort the attack with high-concentration oxygen','oxygen_nrb')],physiology:{effects:[{tag:'high_flow_oxygen',delta:{pain:-8},tauMin:5,maxUnits:1}]},
    counseling:['Plan treatment for the next attack',['oxygen','triptan','headache clinic','prevention'],'Arrange abortive treatment access and preventive follow-up.'],
    teaching:'Cluster attacks combine severe unilateral orbital pain, agitation and ipsilateral autonomic symptoms. High-concentration oxygen can abort an attack.',references:['NICE CG150. https://www.nice.org.uk/guidance/cg150'],
  },
  {
    id:'tremor_after_stopping',specialty:'addiction medicine',age:45,sex:'M',difficulty:2,esi:2,
    complaint:'Tremor and sweating since yesterday',opening:'I cannot stop my hands shaking. I wanted to quit drinking on my own.',
    facts:[['Time since last drink',['drink','last','when','alcohol'],'My last drink was yesterday morning. Before that I drank spirits every day.'],
      ['Previous complicated withdrawal',['seizure','withdraw','before','admission'],'I had a seizure the last time I stopped suddenly.']],
    exam:{gen_mental:'Anxious but oriented, with marked tremor on extension of both arms.',skin_inspect:'Sweating despite the cool room.'},
    diagnosis:'Acute alcohol withdrawal',synonyms:['alcohol withdrawal','ethanol withdrawal'],icd10:'F10.239',disposition:'admit_telemetry',
    vitals:{hr:122,sbp:160,dbp:94},labs:{mg:1.4,k:3.3,glu:92},steps:[treat('Treat clinically significant withdrawal','lorazepam'),treat('Provide thiamine supplementation','thiamine_iv'),test('Monitor for worsening autonomic signs','monitor','vitals_q15')],
    physiology:{effects:[{tag:'benzodiazepine',delta:{hr:-20,sbp:-10},tauMin:8,maxUnits:1}]},
    teaching:'A prior withdrawal seizure increases the risk of a complicated course. Treat withdrawal and monitor mental status, breathing and vital signs.',
    references:["ASAM Clinical Practice Guideline on Alcohol Withdrawal Management. https://www.asam.org/docs/default-source/quality-science/the_asam_clinical_practice_guideline_on_alcohol-1.pdf"],
  },
  {
    id:'headache_after_lp',specialty:'neurology',age:32,sex:'F',difficulty:2,esi:3,
    complaint:'Headache that stops when lying flat',opening:'When I sit up the pounding starts. If I lie down for a while it settles.',
    facts:[['Dural puncture',['procedure','needle','hospital','recent'],'I had a diagnostic lumbar puncture three days ago. The headache started the next morning.'],
      ['Severity and red flags',['fever','weak','walk','drink'],'No fever or weakness. I cannot stay upright long enough to drink a full glass despite the tablets I tried.']],
    exam:{neuro_focal:'Normal cranial nerves, strength and sensation.',neck_stiffness:'Neck supple without fever or rash.'},
    diagnosis:'Post-dural puncture headache',synonyms:['post LP headache','post lumbar puncture headache','postdural puncture headache','spinal headache'],icd10:'G97.1',disposition:'observation',
    vitals:{pain:7},steps:[test('Provide symptom relief while arranging assessment','apap_po','apap_iv'),attending],
    counseling:['Explain the positional headache and procedural option',['blood patch','anesthesia','anaesthesia'],'Discuss anesthetic assessment for an epidural blood patch given disabling persistent symptoms.'],
    teaching:'An orthostatic headache after dural puncture warrants assessment for complications. Persistent disabling symptoms may justify an epidural blood patch.',
    references:["Multisociety international consensus guideline on postdural puncture headache. https://doi.org/10.1136/rapm-2023-104817"],
  },
  {
    id:'fatigable_swallow',specialty:'neurology',age:61,sex:'F',difficulty:3,esi:2,
    complaint:'Voice fading and choking on water',opening:'My eyelids get heavy. Now my voice gives out by the end of a sentence.',
    facts:[['Fatigability',['when','worse','tired','day'],'It is mild in the morning but much worse after I talk or eat.'],
      ['Prior neuromuscular disease',['medicine','history','pills','weak'],'I take pyridostigmine. Since a chest infection I cannot hold my head up for long.']],
    exam:{neuro_focal:'Bilateral fatigable ptosis, nasal speech, weak neck flexion. Pupils and sensation normal.',pulm_effort:'Weak cough and shallow breaths; can count to nine on one breath.'},
    diagnosis:'Myasthenic exacerbation with impending respiratory failure',synonyms:['myasthenic crisis','myasthenia gravis','myasthenic exacerbation'],icd10:'G70.01',disposition:'admit_icu',consultant:'icu',
    vitals:{rr:24,spo2:97},steps:[test('Keep nil by mouth for bulbar weakness','npo'),test('Monitor continuously','monitor'),attending],
    teaching:'Normal oxygen saturation can coexist with neuromuscular respiratory weakness. Obtain serial respiratory mechanics and involve the ICU early.',references:[neurology],
  },
  {
    id:'ascending_weakness',specialty:'neurology',age:42,sex:'M',difficulty:3,esi:2,
    complaint:'Both legs getting weaker each day',opening:'First my feet tingled. Now I cannot get out of a chair on my own.',
    facts:[['Ascending pattern',['spread','begin','feet','when'],'The tingling began three days ago in my feet and has crept up both legs.'],
      ['Antecedent illness',['ill','diarr','infection','recent'],'About two weeks ago I had several days of diarrhea. That had completely stopped.']],
    exam:{neuro_focal:'Symmetrical proximal and distal leg weakness, absent ankle and knee reflexes, weak hand grip. No sensory level.',pulm_effort:'Weak cough despite clear lungs.'},
    diagnosis:'Guillain–Barré syndrome',synonyms:['Guillain Barre','Guillain-Barré','GBS','AIDP'],icd10:'G61.0',disposition:'admit_icu',consultant:'icu',
    vitals:{rr:22,spo2:97},steps:[test('Monitor for dysautonomia','monitor'),attending],
    teaching:'Ascending areflexic weakness requires urgent respiratory and autonomic assessment. Oxygen saturation alone does not assess ventilatory reserve.',references:[neurology],
  },
  {
    id:'scalp_tenderness',specialty:'rheumatology',age:74,sex:'F',difficulty:3,esi:2,
    complaint:'New temple pain and a brief dimming of vision',opening:'Combing my hair hurts. Yesterday one eye went dark, then cleared.',
    facts:[['Jaw claudication',['jaw','chew','eat','pain'],'My jaw starts aching halfway through a meal and I have to rest it.'],
      ['Transient visual loss',['vision','eye','see','dark'],'A curtain came down over just my left eye and lifted after a few minutes.']],
    exam:{gen_appearance:'Tender thickened left temporal artery with reduced pulsation.',heent_pupils:'Pupils reactive; visual fields grossly full at this examination.'},
    diagnosis:'Giant cell arteritis with threatened vision',synonyms:['temporal arteritis','giant cell arteritis','GCA'],icd10:'M31.6',disposition:'transfer',consultant:'transfer',
    labs:{esr:94,crp:127,plt:562,hgb:10.9},steps:[test('Measure inflammatory markers','crp','esr'),treat('Start urgent glucocorticoid therapy','methylpred_iv'),attending],
    teaching:'Jaw claudication and transient visual loss warrant immediate glucocorticoid treatment and specialist assessment to protect vision.',references:['ACR guidance on giant cell arteritis. https://rheumatology.org/patients/giant-cell-arteritis'],
  },
  {
    id:'fasting_acidosis',specialty:'metabolic medicine',age:38,sex:'F',difficulty:2,esi:3,
    complaint:'Nausea and rapid breathing after poor intake',opening:'I haven’t eaten a proper meal in days. Now I cannot stop retching.',
    facts:[['Alcohol and fasting',['drink','alcohol','meal','eat'],'I drank heavily through the weekend, then stopped because of the vomiting. Since then I have barely eaten.'],
      ['Diabetes and drug history',['diabetes','insulin','med','tablet'],'No diabetes, no insulin and no regular medicines.']],
    exam:{heent_mucosa:'Dry oral mucosa.',abd_palpate:'Mild diffuse tenderness without guarding.'},
    diagnosis:'Alcoholic ketoacidosis',synonyms:['alcoholic ketoacidosis','alcohol related ketoacidosis'],icd10:'E87.29',disposition:'admit_floor',
    vitals:{hr:108,rr:24},labs:{glu:72,na:135,cl:98,hco3:12,bhb:6.4,ph_v:7.26,pco2_v:28,hco3_v:12,mg:1.4,lactate:1.9,lipase:36},
    steps:[test('Measure ketones with glucose and acid–base status','ketones'),test('Assess the acidosis','vbg'),treat('Give parenteral thiamine','thiamine_iv')],
    teaching:'Elevated ketones with low or normal glucose after alcohol use and poor intake suggest alcoholic ketoacidosis. Give thiamine and carbohydrate-containing fluids, monitor electrolytes and consider other causes of acidosis.',
    references:["Miller et al., Treatment of alcoholic acidosis: the role of dextrose and phosphorus. https://jamanetwork.com/journals/jamainternalmedicine/article-abstract/587497"],
  },
  {
    id:'warm_race_finish',specialty:'environmental',age:31,sex:'M',difficulty:1,esi:3,
    complaint:'Cramps and dizziness at the finish line',opening:'I tried to keep running in the heat, but my legs cramped and I felt faint.',
    facts:[['Heat exposure',['heat','weather','race','where'],'It was unusually hot and I missed the water stations. The volunteers moved me into the shade.'],
      ['Preserved consciousness',['confus','faint','blackout','memory'],'I remember the whole race. I never blacked out and nobody saw me act strangely.']],
    exam:{gen_mental:'Alert and oriented with clear speech.',skin_inspect:'Warm, clammy skin. Sweats freely.'},
    diagnosis:'Exertional heat exhaustion',synonyms:['heat exhaustion'],icd10:'T67.5XXA',disposition:'discharge',vitals:{hr:111,temp:38.2,sbp:106,dbp:66},labs:{na:140,k:3.8,creat:1.0,ck:180},
    steps:[test('Repeat temperature and vital signs after cooling and hydration','vitals_now','vitals_q15')],
    counseling:['Plan rest, hydration and return precautions',['cool','heat','hydration','confusion'],'Discuss hydration, a cool environment and returning for confusion or recurrent symptoms.'],
    physiology:{drift:{hr:-10,temp:-0.5},limits:{hr:[72,135],temp:[36.8,39]},effects:[{tag:'fluids',delta:{hr:-10,sbp:8},maxUnits:1,tauMin:10}]},
    teaching:'Check mentation and temperature to distinguish heat exhaustion from heat stroke. Reassess after cooling and hydration before discharge.',
    references:["National Athletic Trainers Association position statement on exertional heat illnesses. https://pmc.ncbi.nlm.nih.gov/articles/PMC4639891/"],
  },
];

// These are fictional longitudinal records and interview details, not copied source patients.
// Keep the public presentation distinct from information elicited during the encounter.
interface AcuteDetail {
  history: [...History, key?: boolean][];
  problems: string[];
  meds: CaseDef['presentation']['documentedHomeMeds'];
  record: [reason: string, summary: string];
  personality: string;
  behavior: string;
  teaching: string[];
}
const acuteDetails: Record<string, AcuteDetail> = {
  missed_lunch: {
    history: [
      ['Symptom sequence', ['start', 'onset', 'when', 'symptom'], 'About twenty minutes after my lunchtime injection I became sweaty, hungry and shaky. I walked here with a colleague.', true],
      ['Insulin regimen', ['dose', 'units', 'regimen', 'injection'], 'I use glargine 18 units at night and lispro with meals. I took my usual six units for lunch, only once.', true],
      ['Baseline diabetes', ['diabetes', 'history', 'diagnosed'], 'I have had type 1 diabetes since I was seventeen. I usually notice a low before I need help.'],
      ['No impaired awareness', ['collapse', 'seizure', 'confus', 'swallow'], 'I have stayed awake and can swallow. No seizure or fainting.'],
      ['Other precipitants', ['vomit', 'fever', 'alcohol', 'exercise'], 'No illness, vomiting, extra exercise or alcohol today. Breakfast was normal.'],
      ['Previous episodes', ['before', 'previous', 'hypo'], 'One mild low last month after a late meal; I treated that with juice. No recent severe lows.'],
      ['Other medicines and allergies', ['allerg', 'tablet', 'kidney'], 'No medicine allergies, no diabetes tablets and no known kidney disease.'],
      ['Practical safety', ['drive', 'transport', 'work', 'support'], 'My partner can collect me. I will not drive while I feel like this. I normally carry glucose tablets but used the last ones yesterday.'],
    ], problems: ['Type 1 diabetes mellitus'],
    meds: [{ name: 'Insulin glargine', dose: '18 units', sig: 'SC nightly', lastTaken: 'Last night' }, { name: 'Insulin lispro', dose: '6 units with lunch; other doses matched to meals', sig: 'SC with meals', lastTaken: 'Immediately before the missed lunch' }],
    record: ['Routine diabetes review', 'Recognizes hypoglycemia. Uses basal-bolus insulin. No severe hypoglycemia in the preceding year; renal function normal.'],
    personality: 'Embarrassed by the missed meal, cooperative and familiar with diabetes self-care.', behavior: 'Describe symptoms first. Give insulin doses when asked; do not claim recovery until the clinician explains repeat measurements.',
    teaching: ['Recheck glucose after carbohydrate and repeat treatment if it remains low; symptom relief alone is not confirmation.', 'Before discharge address food, supplies, supervision and transport. This encounter does not justify stopping basal insulin in type 1 diabetes.'],
  },
  steroid_thirst: {
    history: [
      ['Symptom timeline', ['start', 'onset', 'when', 'thirst'], 'The thirst and frequent urination started after the first couple of prednisone doses and have become worse since.', true],
      ['Steroid dose', ['dose', 'prednisone', 'course'], 'Prednisone 40 mg every morning for five days. I took the fourth dose today; my breathing is much better.', true],
      ['Regular treatment', ['metformin', 'medication', 'usual'], 'Metformin 1 gram twice daily. I have not missed it and have never used insulin.'],
      ['Hyperglycemic emergency symptoms', ['vomit', 'pain', 'confus', 'drowsy'], 'No vomiting or stomach pain. I am tired but thinking clearly, and I can keep water down.', true],
      ['Infection screen', ['fever', 'cough', 'dysuria', 'infection'], 'No fever or painful urination. The wheeze has settled and I am not bringing up sputum.'],
      ['Home measurements', ['meter', 'reading', 'sugar', 'baseline'], 'Usually my readings are around 120 to 170. Since yesterday they have been over 300.'],
      ['Comorbidities and allergies', ['history', 'kidney', 'heart', 'allerg'], 'I have asthma and diabetes. No kidney or heart disease, and no medicine allergies.'],
      ['Support and follow-up', ['home', 'support', 'appointment', 'drink'], 'My spouse is at home, I have working test strips, and the diabetes nurse can see me tomorrow morning.'],
    ], problems: ['Type 2 diabetes mellitus', 'Asthma'], meds: [{ name: 'Metformin', dose: '1 g', sig: 'PO twice daily' }, { name: 'Prednisone', dose: '40 mg', sig: 'PO daily for five days; day four' }, { name: 'Salbutamol inhaler', dose: '100 micrograms per puff', sig: 'One or two puffs as needed' }],
    record: ['Diabetes follow-up', 'Managed without insulin. HbA1c 7.1%; creatinine 0.9 mg/dL. No prior ketoacidosis.'],
    personality: 'Concerned that the new medicine has harmed him, asks whether to stop it.', behavior: 'Explain the temporal association if asked; do not label the problem as ketoacidosis or guess laboratory results.',
    teaching: ['Review the steroid course with the prescriber and arrange a temporary glucose-management plan rather than giving an arbitrary one-off insulin dose.', 'Discharge requires oral intake, reliable monitoring and prompt follow-up; vomiting, confusion or inability to hydrate warrants reassessment.'],
  },
  stoma_losses: {
    history: [
      ['Measured output', ['litre', 'liter', 'amount', 'output'], 'Usually less than a litre a day; yesterday I measured almost three litres of watery output.', true],
      ['Surgical background', ['surgery', 'operation', 'stoma', 'history'], 'My ileostomy was formed eight weeks ago after surgery for ulcerative colitis. It had been manageable until this week.'],
      ['Fluid intake', ['drink', 'water', 'solution', 'eat'], 'I drank plain water and tea, but very little of the salty rehydration drink because I dislike its taste.', true],
      ['Obstruction and infection screen', ['fever', 'pain', 'vomit', 'blood'], 'No fever, blood, vomiting or cramping pain. The stoma has never stopped draining.'],
      ['Postural symptoms', ['dizzy', 'stand', 'faint', 'urine'], 'I become lightheaded when standing. Only a few spoonfuls of dark urine today; no fainting.'],
      ['Regular medicines', ['med', 'loperamide', 'painkiller'], 'Loperamide 2 mg before meals. I skipped it yesterday because I thought it might trap an infection inside. No ibuprofen or water tablets.', true],
      ['Other risks', ['antibiotic', 'travel', 'sick', 'allerg'], 'No recent antibiotics or travel, no sick contacts and no medicine allergies.'],
      ['Self-care support', ['home', 'support', 'nurse', 'bag'], 'I live alone but the stoma nurse knows me. I brought my output diary and can measure the bag volume.'],
    ], problems: ['Ulcerative colitis after colectomy with ileostomy'], meds: [{ name: 'Loperamide', dose: '2 mg', sig: 'PO before meals per stoma team', lastTaken: 'Two days ago' }],
    record: ['Postoperative stoma review', 'Stoma healthy; usual output 800–1000 mL/day. Oral rehydration advice provided. Creatinine 0.8 mg/dL one week before this visit.'],
    personality: 'Practical about stoma care but worried she has caused damage.', behavior: 'Offer the output diary when losses are discussed; distinguish measured volume from an estimate.',
    teaching: ['Reassess perfusion after each fluid increment and replace ongoing losses; use oral glucose-saline solutions when safe.', 'Creatinine recovery lags behind better blood pressure. Check magnesium and potassium and involve the stoma team in preventing recurrence.'],
  },
  dialysis_orthopnea: {
    history: [
      ['Breathing timeline', ['onset', 'when', 'breath', 'lie'], 'Over two days I have gone from breathless on stairs to breathless sitting still. Last night I could not lie down.', true],
      ['Dialysis access', ['fistula', 'access', 'arm', 'dialysis'], 'I use the fistula in my left forearm. It buzzes as usual; no pain or redness.'],
      ['Target weight and schedule', ['dry weight', 'target', 'schedule'], 'My target is 72 kilos. I go Monday, Wednesday and Friday; I weighed 77 kilos at home this morning.'],
      ['Chest symptoms', ['pain', 'pressure', 'palpitation', 'faint'], 'No chest pain or fainting. My heart feels fast when I struggle to breathe.'],
      ['Infection and thromboembolism screen', ['fever', 'sputum', 'hemoptysis', 'leg'], 'No fever, colored sputum or coughing blood. Both ankles are swollen, not just one.'],
      ['Medicines', ['med', 'tablet', 'blood pressure'], 'Amlodipine 10 mg daily and sevelamer with meals. I took the amlodipine this morning.'],
      ['Fluid intake and transport', ['drink', 'transport', 'ride', 'miss'], 'I kept drinking my usual allowance; I did not choose to miss treatment. The transport booking failed and I could not afford a taxi.', true],
      ['Allergies and baseline function', ['allerg', 'usual', 'baseline', 'home'], 'No medicine allergies. Normally I walk to the shops without breathlessness and manage independently.'],
    ], problems: ['Dialysis-dependent kidney failure', 'Hypertension', 'Anuria'], meds: [{ name: 'Amlodipine', dose: '10 mg', sig: 'PO daily' }, { name: 'Sevelamer carbonate', dose: '800 mg', sig: 'PO with meals' }],
    record: ['Dialysis unit summary', 'Maintenance hemodialysis three times weekly through left forearm AV fistula. Target post-dialysis weight 72 kg. No meaningful residual urine output.'],
    personality: 'Frightened and speaks in short phrases, upset about the transport failure.', behavior: 'Answer one brief question at a time; make the lack of urine clear when diuretics or fluid balance are discussed.',
    teaching: ['Assess airway, work of breathing and ECG while urgently involving critical care and renal services. Oxygen saturation improvement does not remove excess volume.', 'The game has no dialysis or noninvasive ventilation order. Arrange definitive therapy through the handoff; do not interpret an oxygen response as definitive recovery.'],
  },
  exercise_dark_urine: {
    history: [
      ['Exercise and timing', ['when', 'duration', 'class', 'exercise'], 'The class lasted ninety minutes two days ago. My thighs became very sore yesterday and my urine darkened this morning.', true],
      ['Hydration', ['water', 'drink', 'urine', 'volume'], 'I barely drank during the class. Today I have passed less urine than usual.'],
      ['Compartment symptoms', ['numb', 'tingle', 'tight', 'weak'], 'Both thighs hurt, but there is no numbness, tight swelling or one spot that is suddenly much worse.', true],
      ['Other causes', ['seizure', 'crush', 'immobile', 'fall'], 'No fall, crush injury, seizure or long period lying unconscious.'],
      ['Drugs and supplements', ['med', 'statin', 'supplement', 'cocaine'], 'No regular medicines, statins, workout supplements or recreational drugs.'],
      ['Infection and heat', ['fever', 'heat', 'ill', 'confus'], 'No fever or recent illness. The studio was warm but I stayed alert throughout.'],
      ['Prior and family history', ['before', 'family', 'kidney', 'muscle'], 'Nothing like this before. No kidney disease or inherited muscle condition in the family.'],
      ['Support and allergies', ['allerg', 'home', 'work'], 'No medicine allergies. My housemate brought me; I normally work on my feet all day.'],
    ], problems: [], meds: [], record: ['Primary care review', 'Previously well, no chronic medication. Creatinine 0.7 mg/dL at a routine assessment six months ago.'],
    personality: 'Athletic beginner who is surprised normal exercise could cause illness.', behavior: 'Describe aching and urine changes; do not assume dark urine means bleeding from the bladder.',
    teaching: ['Use goal-directed fluids with repeat examination and urine-output assessment; avoid unmonitored fluid loading.', 'CK may remain high or continue rising after initial treatment. Improved perfusion does not prove muscle injury or electrolyte risk has resolved.'],
  },
  cramps_long_qt: {
    history: [
      ['Symptom timeline', ['when', 'start', 'cramp', 'palpitation'], 'The diarrhea began a week ago. Cramps started yesterday and the skipped beats began this morning.', true],
      ['Losses and intake', ['stool', 'amount', 'drink', 'blood'], 'Four to six watery stools daily, no blood. I have eaten very little and can keep drinks down.'],
      ['Exact medicines', ['name', 'dose', 'med', 'tablet'], 'Hydrochlorothiazide 25 mg daily for blood pressure and omeprazole 20 mg daily for years.', true],
      ['Arrhythmia red flags', ['faint', 'collapse', 'pain', 'seizure'], 'No fainting, seizure or chest pain, but I feel lightheaded during the flutters.'],
      ['Other medicines', ['antibiotic', 'laxative', 'supplement'], 'No recent antibiotic, laxative or magnesium supplement.'],
      ['Renal and cardiac background', ['kidney', 'heart', 'history'], 'No known kidney disease, heart failure or previous rhythm problem.'],
      ['Allergies and alcohol', ['allerg', 'alcohol', 'drink habit'], 'No medicine allergies. I rarely drink alcohol.'],
      ['Functional change', ['home', 'walk', 'usual', 'help'], 'Normally independent. Today my hands lock while holding a cup and I asked my daughter to drive me.'],
    ], problems: ['Hypertension', 'Gastroesophageal reflux'], meds: [{ name: 'Hydrochlorothiazide', dose: '25 mg', sig: 'PO daily' }, { name: 'Omeprazole', dose: '20 mg', sig: 'PO daily' }],
    record: ['Hypertension review', 'No known arrhythmia. Creatinine 0.8 mg/dL and potassium 3.8 mmol/L three months ago. Long-term PPI prescription continued.'],
    personality: 'Alert but unsettled by the cramps and irregular sensations.', behavior: 'Recall exact medicines when asked; make clear that the diarrhea preceded the cramps.',
    teaching: ['Replace magnesium under monitoring and address accompanying hypokalemia and hypocalcemia; review diuretic and PPI use.', 'Magnesium and potassium are static laboratory values in this case because the engine cannot link them to replacement. Repeat testing is still part of the clinical plan; no automatic normalization is implied.'],
  },
  calcium_constipation: {
    history: [
      ['Timeline', ['when', 'start', 'confus', 'constipation'], 'Constipation has worsened for a week. Over three days I have become very thirsty and my partner says I am slower.', true],
      ['Calcium dose', ['how many', 'dose', 'antacid', 'supplement'], 'Eight to ten 750 mg calcium carbonate antacid tablets most days, plus a calcium supplement twice daily. I thought more was harmless.', true],
      ['Volume loss', ['urine', 'drink', 'vomit'], 'Large amounts of urine despite drinking constantly. I feel nauseated but have not vomited.'],
      ['Malignancy symptoms', ['weight', 'cancer', 'bone', 'cough'], 'No known cancer, unexplained weight loss, bone pain or persistent cough.'],
      ['Medication alternatives', ['thiazide', 'lithium', 'vitamin', 'med'], 'Amlodipine for blood pressure. No lithium or water tablets; only the small vitamin D amount in the supplement.'],
      ['Renal history', ['kidney', 'stone', 'before'], 'No kidney stones or known kidney disease. Never told calcium was high.'],
      ['Neurological symptoms', ['headache', 'weak', 'faint', 'seizure'], 'No one-sided weakness, severe headache, fainting or seizure.'],
      ['Baseline and support', ['home', 'baseline', 'allerg', 'usual'], 'Usually sharp and independent at home with my partner. No medicine allergies.'],
    ], problems: ['Hypertension', 'Reflux symptoms'], meds: [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily' }, { name: 'Calcium carbonate antacid', dose: '750 mg per tablet', sig: 'Self-directed; quantity requires reconciliation' }, { name: 'Calcium/vitamin D supplement', dose: '600 mg elemental calcium/400 units vitamin D', sig: 'PO twice daily' }],
    record: ['Routine primary care', 'Creatinine 1.0 mg/dL and calcium 9.5 mg/dL six months ago. No prior malignancy or hyperparathyroidism recorded.'],
    personality: 'Answers slowly and is surprised that nonprescription tablets count as medication.', behavior: 'Disclose the antacid quantity when over-the-counter medicines are specifically discussed. Do not assert that this excludes other causes.',
    teaching: ['Stop excess calcium/alkali, restore volume with reassessment and investigate the cause, including PTH-directed evaluation.', 'The catalog lacks calcium-lowering specialist drugs and PTH measurement. Handoff must address these; serum calcium is not scripted to normalize simply with time.'],
  },
  heavy_periods_fatigue: {
    history: [
      ['Bleeding pattern', ['pad', 'duration', 'clot', 'period'], 'Periods last eight days; for the first three I change a soaked pad every two hours and pass clots.', true],
      ['Current stability', ['today', 'bleeding now', 'faint', 'chest'], 'No bleeding today, fainting or chest pain. I become winded on stairs but not at rest.', true],
      ['Other blood loss', ['black stool', 'rectal', 'blood stool', 'vomit'], 'No black stool, blood in stool or vomiting blood.'],
      ['Pregnancy possibility', ['pregnan', 'last period', 'contraception'], 'My last period finished a week ago. I use condoms; pregnancy is possible but unlikely.'],
      ['Diet and intake', ['diet', 'food', 'vegetarian', 'ice'], 'I eat a mixed diet but little red meat. The craving for ice is new over these last few months.'],
      ['Medication and bleeding tendency', ['med', 'blood thinner', 'bruise', 'nosebleed'], 'No blood thinners or regular medicines. No unusual bruising or nosebleeds, and no family bleeding disorder.'],
      ['Background', ['before', 'history', 'surgery', 'allerg'], 'No previous anemia diagnosis, surgery or medicine allergies.'],
      ['Follow-up access', ['home', 'follow', 'appointment', 'work'], 'I can attend my clinic this week, but I had put this off because I work shifts.'],
    ], problems: ['Heavy menstrual bleeding'], meds: [], record: ['Preventive visit', 'Hemoglobin 12.4 g/dL one year ago. Cervical screening up to date. No prior investigation of heavy menstrual bleeding.'],
    personality: 'Has normalized heavy periods and worries the fatigue is laziness.', behavior: 'Quantify bleeding when asked rather than only saying it is heavy. Ask how to take iron without upsetting the stomach.',
    teaching: ['A stable hemoglobin of 9.6 g/dL is not by itself an indication for transfusion. Treat iron deficiency and investigate the bleeding source.', 'Hemoglobin recovery takes weeks, not an ED shift. Oral iron is discussed in the discharge plan because it is not an available catalog order.'],
  },
  hemolysis_after_infection: {
    history: [
      ['Timing and severity', ['when', 'start', 'fatigue', 'breath'], 'The sore throat was four days ago. Yesterday the urine darkened and today I feel weak walking across the room.', true],
      ['Bleeding exclusion', ['bleed', 'stool', 'vomit', 'injury'], 'No visible bleeding, black stool, vomiting blood or injury.'],
      ['Drug and food triggers', ['med', 'antibiotic', 'fava', 'bean'], 'No new tablets or antibiotics and no fava beans. I only took paracetamol at the packet dose.', true],
      ['Prior episodes', ['before', 'child', 'jaundice', 'history'], 'I was yellow during an illness as a child, but I do not have the old test report.'],
      ['Family history', ['family', 'brother', 'relative'], 'My brother has had similar episodes. He was told an enzyme in his blood cells was low.'],
      ['Urine output and pain', ['amount', 'urine output', 'flank', 'pain'], 'Less urine than normal, no burning or colicky flank pain.'],
      ['Cardiorespiratory symptoms', ['chest', 'faint', 'palpitation', 'rest'], 'My heart races walking, but no chest pain, fainting or breathlessness at rest.'],
      ['Background and allergies', ['allerg', 'regular', 'kidney', 'transfusion'], 'No medicine allergies or regular drugs, no kidney disease and no previous transfusion.'],
    ], problems: ['Previous unexplained jaundice during infection'], meds: [], record: ['Prior routine blood count', 'Hemoglobin 14.2 g/dL and creatinine 0.9 mg/dL six months ago. Childhood records unavailable.'],
    personality: 'Worried that yellow eyes mean contagious liver disease.', behavior: 'Describe the childhood advice without claiming a confirmed enzyme test. Ask whether the illness can affect his brother.',
    teaching: ['Trend anemia and renal function, remove oxidant exposures and consider transfusion according to clinical status and ongoing hemolysis.', 'An enzyme assay can be falsely reassuring during an acute episode; arrange confirmation after recovery. The simulator does not provide G6PD assays or blood transfusion orders.'],
  },
  fever_after_infusion: {
    history: [
      ['Fever timeline', ['when', 'temperature', 'fever', 'onset'], 'I measured 38.5 an hour ago and came directly. I have not taken a fever tablet.', true],
      ['Cancer treatment', ['cancer', 'regimen', 'chemo', 'cycle'], 'Breast cancer; the second docetaxel and cyclophosphamide cycle was ten days ago. I have a chest port.'],
      ['Mucosal symptoms', ['mouth', 'swallow', 'ulcer', 'eat'], 'My mouth is sore and I have small ulcers, so eating has been harder.'],
      ['Source screen', ['abdomen', 'diarr', 'perianal', 'wound'], 'No abdominal pain, diarrhea, pain around my bottom or new skin wound.', true],
      ['Line and respiratory symptoms', ['line', 'port', 'cough', 'breath'], 'The port has not hurt or leaked. No cough or shortness of breath.'],
      ['Antibiotics and allergies', ['allerg', 'antibiotic', 'resistant'], 'No medicine allergies, no preventive antibiotics and no known resistant infection.'],
      ['Medication list', ['med', 'steroid', 'anti sickness'], 'Dexamethasone was only around the infusion. Ondansetron as needed; no steroid today.'],
      ['Safety and support', ['home', 'help', 'oncology', 'card'], 'My sister drove me. I brought the oncology alert card and the unit phone number.'],
    ], problems: ['Breast cancer receiving cytotoxic chemotherapy'], meds: [{ name: 'Docetaxel/cyclophosphamide', dose: 'Per oncology protocol', sig: 'Cycle two administered ten days ago' }, { name: 'Ondansetron', dose: '4 mg', sig: 'PO as needed for nausea' }],
    record: ['Oncology infusion', 'Second chemotherapy cycle administered ten days before presentation. Central venous port in situ. Written instructions to seek immediate assessment for fever.'],
    personality: 'Calm because she followed the alert card, does not realize an apparently mild illness can be urgent.', behavior: 'Give the treatment date promptly. Do not invent culture results or claim the absence of pain excludes infection.',
    teaching: ['Treat suspected neutropenic sepsis as an emergency; obtain cultures without delaying effective IV antibiotics.', 'ANC is approximately 0.11 × 10^9/L from WBC 0.6 and neutrophils 18%. A clean port site does not exclude bloodstream infection.'],
  },
  delayed_headache_fall: {
    history: [
      ['Progressive symptoms', ['when', 'headache', 'progress', 'weak'], 'The headache was mild at first. Since yesterday I have been clumsy with my left hand and slower getting dressed.', true],
      ['Last anticoagulant dose', ['last dose', 'apixaban', 'dose', 'time'], 'Apixaban 5 mg twice daily. The last tablet was this morning; I have not missed any.', true],
      ['Mechanism', ['fall', 'height', 'stairs', 'injury'], 'I fell from standing onto the carpet and struck the right side of my head. No stairs or vehicle accident.'],
      ['Other head injury symptoms', ['vomit', 'seizure', 'blackout', 'neck'], 'No seizure or repeated vomiting. No neck pain and I did not black out at the time.'],
      ['Baseline function', ['usual', 'baseline', 'memory', 'walk'], 'Normally I manage my own medicines and walk independently. The slow thinking is new.'],
      ['Other medicines', ['aspirin', 'med', 'ibuprofen'], 'Amlodipine 5 mg daily. No aspirin, ibuprofen or other blood thinner.'],
      ['Other risks', ['alcohol', 'allerg', 'bleed', 'surgery'], 'No medicine allergies, heavy alcohol use or prior brain surgery.'],
      ['Home support', ['home', 'family', 'support', 'alone'], 'My spouse noticed the hand problem and insisted on bringing me today.'],
    ], problems: ['Atrial fibrillation', 'Hypertension'], meds: [{ name: 'Apixaban', dose: '5 mg', sig: 'PO twice daily', lastTaken: 'This morning' }, { name: 'Amlodipine', dose: '5 mg', sig: 'PO daily' }],
    record: ['Atrial fibrillation follow-up', 'Independent baseline cognition and mobility. Apixaban prescribed for stroke prevention; renal function normal.'],
    personality: 'Minimizes the fall but is troubled by losing control of his hand.', behavior: 'Admit the new functional changes when asked. Do not confuse a normal initial period after injury with a reassuring current course.',
    teaching: ['Escalate early for neurosurgical transfer and reversal assessment; do not wait for coma.', 'The catalog lacks factor-Xa reversal therapy. State the last dose and urgency in handoff; a transfer acceptance is not proof that reversal has occurred.'],
  },
  positional_spinning: {
    history: [
      ['Onset', ['when', 'first', 'start'], 'It began when I rolled over yesterday morning. Each attack is brief, with normal periods between.'],
      ['Triggers', ['look', 'head', 'position', 'trigger'], 'Rolling right or looking up sets it off; standing still does not.', true],
      ['Auditory symptoms', ['hear', 'ring', 'ear', 'tinnitus'], 'No hearing loss, ringing, ear pain or fullness.'],
      ['Central warning symptoms', ['headache', 'neck', 'coordination', 'numb'], 'No new headache, neck pain, numbness or loss of coordination.', true],
      ['Falls and vomiting', ['fall', 'vomit', 'nausea'], 'A little nausea during a spin, but no vomiting or falls.'],
      ['History and vascular risks', ['before', 'stroke', 'diabetes', 'pressure'], 'No previous stroke, diabetes or hypertension. This has not happened before.'],
      ['Medication and allergies', ['med', 'allerg', 'alcohol'], 'No regular medicines or medicine allergies. No alcohol before the episodes.'],
      ['Function and support', ['drive', 'work', 'home', 'support'], 'I can walk normally. My partner drove me because turning to check traffic starts the spinning.'],
    ], problems: [], meds: [], record: ['Primary care review', 'Previously well, no chronic medication or documented hearing impairment.'],
    personality: 'Afraid of a stroke but able to describe the brief attacks precisely.', behavior: 'Distinguish brief triggered episodes from continuous dizziness. Do not report persistent symptoms between attacks.',
    teaching: ['A typical positional nystagmus pattern supports posterior-canal BPPV. HINTS is not a screening test for brief triggered attacks.', 'Reassess after repositioning; persistent or atypical findings warrant another diagnosis. The game records the maneuver but does not animate nystagmus resolution.'],
  },
  cluster_attack: {
    history: [
      ['Pain characteristics', ['side', 'quality', 'pain', 'radiat'], 'Always behind the right eye, drilling rather than throbbing. I pace because sitting still is unbearable.'],
      ['Bout history', ['previous', 'before', 'diagnosed', 'scan'], 'A neurologist diagnosed this three years ago. MRI was normal then. Months pass between bouts.', true],
      ['Current similarity', ['different', 'worst', 'sudden', 'thunderclap'], 'This is the same pattern, not a new explosive headache or the worst of a different kind.', true],
      ['Visual and infectious screen', ['vision', 'halo', 'fever', 'neck'], 'I can see normally; no halos, fever or neck stiffness.'],
      ['Interictal state', ['between', 'duration', 'daily'], 'Between attacks I feel normal. This week I have one each night, around forty minutes long.'],
      ['Previous treatment', ['oxygen', 'treatment', 'triptan'], 'Oxygen helped during the last bout. I ran out of the prescribed rescue injection.'],
      ['Background and medicines', ['heart', 'med', 'allerg', 'history'], 'No heart disease or medicine allergies. No regular preventive treatment at present.'],
      ['Triggers and support', ['alcohol', 'smoke', 'home', 'support'], 'Even a beer can trigger an attack during a bout, so I avoid it. My partner is here.'],
    ], problems: ['Episodic cluster headache'], meds: [{ name: 'Sumatriptan', dose: '6 mg', sig: 'SC rescue per headache clinic; supply exhausted' }],
    record: ['Headache clinic', 'Typical episodic cluster headache with right-sided autonomic symptoms. Previous brain MRI normal. Oxygen and rescue sumatriptan effective during prior bout.'],
    personality: 'Restless during pain, grateful for brief questions rather than a long interview.', behavior: 'Keep the current attack consistent with previous bouts. Do not report complete relief before treatment has had time to act.',
    teaching: ['High-concentration oxygen via reservoir mask is an available acute treatment. Subcutaneous or nasal triptan is another guideline-supported option, but absent from the game catalog.', 'Arrange access to rescue treatment and specialist prevention; a remote normal scan does not excuse ignoring a changed headache pattern.'],
  },
  tremor_after_stopping: {
    history: [
      ['Alcohol amount', ['amount', 'units', 'bottle', 'how much'], 'About half a litre of spirits each day for several years.', true],
      ['Withdrawal timeline', ['hours', 'last', 'when', 'start'], 'Last drink roughly thirty hours ago. Tremor started overnight and the sweating is getting worse.'],
      ['Prior complication detail', ['seizure', 'intensive', 'admit', 'before'], 'A withdrawal seizure two years ago, but no seizure or ICU admission this time.', true],
      ['Hallucinations and orientation', ['hear', 'see', 'halluc', 'confus'], 'I feel anxious but know where I am. No voices or insects on the walls.'],
      ['Nutrition', ['eat', 'food', 'vomit', 'weight'], 'Very little food for three days and some nausea. I have kept small drinks down.'],
      ['Other substances', ['drug', 'opioid', 'benzo', 'tablet'], 'No benzodiazepines, opioids or other recreational drugs. No regular prescriptions.'],
      ['Alternative causes', ['fever', 'pain', 'head injury', 'fall'], 'No fever, chest pain, recent fall or head injury.'],
      ['Support and goals', ['home', 'support', 'quit', 'allerg'], 'I live alone and wanted to stop for good. No medicine allergies. I would accept help rather than trying this alone again.'],
    ], problems: ['Alcohol dependence', 'Previous alcohol-withdrawal seizure'], meds: [], record: ['Previous hospital admission', 'Withdrawal seizure two years ago. Discharged with addiction-service follow-up; subsequently lost contact.'],
    personality: 'Ashamed but motivated; responds better to neutral questions than blame.', behavior: 'Quantify alcohol honestly when asked without judgment. Distinguish anxiety from hallucinations and delirium.',
    teaching: ['Prior complicated withdrawal supports monitored inpatient management. Reassess symptoms, consciousness and breathing after each sedating dose.', 'Thiamine and nutritional/electrolyte assessment accompany withdrawal treatment; medication response is not a reason to discharge a high-risk patient alone.'],
  },
  headache_after_lp: {
    history: [
      ['Positional timing', ['upright', 'flat', 'position', 'minutes'], 'Within a few minutes sitting up it hurts; lying flat for about ten minutes makes it much better.', true],
      ['Original procedure indication', ['why', 'lumbar', 'puncture', 'original'], 'The lumbar puncture investigated a different headache. They told me the scan and spinal-fluid tests were reassuring before discharge.'],
      ['Progression', ['when', 'worse', 'course'], 'This new positional headache began the following morning and has stayed disabling for two days.'],
      ['Red flags', ['vision', 'seizure', 'confus', 'weak'], 'No double vision, seizure, confusion or limb weakness.'],
      ['Infection and back symptoms', ['fever', 'back', 'bladder', 'leg'], 'No fever, severe back pain, leg numbness or bladder trouble.'],
      ['Treatment tried', ['tablet', 'paracetamol', 'caffeine', 'drink'], 'Paracetamol and coffee have not let me stay upright long enough to eat properly.', true],
      ['Procedure risks', ['blood thinner', 'med', 'allerg', 'bleed'], 'No anticoagulant, bleeding disorder or medicine allergy.'],
      ['Function and support', ['home', 'work', 'support', 'child'], 'My partner is looking after our child. I cannot do the school run or prepare meals like this.'],
    ], problems: ['Recent diagnostic lumbar puncture'], meds: [{ name: 'Paracetamol', dose: '1 g', sig: 'PO up to four times daily as needed; maximum 4 g/day' }],
    record: ['ED investigation three days earlier', 'Neurological examination, CT and CSF evaluation reassuring. Diagnostic lumbar puncture performed without immediate complication; return precautions given.'],
    personality: 'Exhausted and asks whether the procedure caused lasting harm.', behavior: 'Separate the original headache from the new positional one. Do not claim an epidural blood patch has already happened.',
    teaching: ['Consider alternative causes when headache loses its postural character or new neurological or systemic signs appear.', 'Anesthetic assessment for an epidural blood patch is appropriate for disabling persistent symptoms. This intervention is outside the available order catalog.'],
  },
  fatigable_swallow: {
    history: [
      ['Deterioration timeline', ['when', 'start', 'progress'], 'Three days of worsening weakness; since this morning even water makes me cough.', true],
      ['Bulbar symptoms', ['swallow', 'saliva', 'choke', 'voice'], 'Food sticks and my voice becomes nasal. I keep coughing on my own saliva.', true],
      ['Breathing symptoms', ['breath', 'lie', 'cough', 'sleep'], 'I am more comfortable upright and cannot cough strongly enough to clear mucus.', true],
      ['Usual treatment', ['dose', 'pyridostigmine', 'med'], 'Pyridostigmine 60 mg four times daily. I have not changed the dose or taken extra.'],
      ['Precipitant', ['infection', 'fever', 'antibiotic', 'new'], 'A cough and mild fever began last week. No new antibiotic or other medication.'],
      ['Cholinergic symptoms', ['diarr', 'sweat', 'cramp', 'tear'], 'No diarrhea, abdominal cramps, extra sweating or unusual tearing.'],
      ['Prior severity', ['before', 'ventilat', 'intubat', 'history'], 'Diagnosed five years ago; never needed a breathing machine. Usually I eat normally.'],
      ['Other background', ['allerg', 'home', 'support', 'numb'], 'No medicine allergies. My partner is here. My arms feel weak, not numb.'],
    ], problems: ['Generalized myasthenia gravis'], meds: [{ name: 'Pyridostigmine', dose: '60 mg', sig: 'PO four times daily', lastTaken: 'Morning dose' }],
    record: ['Neurology follow-up', 'Generalized myasthenia with intermittent ptosis; no baseline bulbar weakness or previous mechanical ventilation.'],
    personality: 'Knows her usual weakness and is frightened because swallowing is different today.', behavior: 'Use short sentences because speaking is tiring. Do not reassure the clinician solely because the oxygen saturation is normal.',
    teaching: ['Assess bulbar protection and serial respiratory mechanics; early ICU/neurology involvement is more useful than waiting for hypoxemia.', 'The engine lacks FVC/NIF, ventilation, IVIG and plasma exchange. Handoff must request these assessments and therapies rather than claiming they were simulated.'],
  },
  ascending_weakness: {
    history: [
      ['Functional progression', ['walk', 'chair', 'stairs', 'progress'], 'Yesterday I could climb stairs with the rail. Today someone had to lift me from a chair.', true],
      ['Upper limb spread', ['hand', 'arm', 'grip'], 'Now both hands feel weak opening a bottle, not just my legs.'],
      ['Bulbar and respiratory symptoms', ['swallow', 'voice', 'breath', 'cough'], 'My cough is weaker and I have to pause when talking. No choking yet.', true],
      ['Autonomic symptoms', ['palpitation', 'dizzy', 'urine', 'bowel'], 'Sometimes my heart races and I feel lightheaded sitting up. I can still pass urine.'],
      ['Spinal red flags', ['back', 'level', 'saddle', 'injury'], 'No severe back pain, saddle numbness, injury or clear line below which I cannot feel.'],
      ['Background', ['before', 'history', 'diabetes', 'family'], 'No prior weakness, diabetes or family nerve disease. I usually cycle to work.'],
      ['Exposures', ['med', 'drug', 'toxin', 'travel'], 'No regular medicines, new drugs, chemical exposure or recent foreign travel.'],
      ['Support and allergies', ['home', 'support', 'allerg'], 'No medicine allergies. My spouse drove me because I cannot walk safely.'],
    ], problems: [], meds: [], record: ['Routine primary care', 'Previously independent with no neurological deficit or chronic medication. Gastroenteritis two weeks earlier resolved without antibiotics.'],
    personality: 'Alarmed by rapid loss of independence but gives a clear history.', behavior: 'Describe symmetrical progression; do not invent a sensory level or unilateral deficit.',
    teaching: ['Serial bulbar, respiratory and autonomic assessment is essential. Do not wait for CSF or nerve-conduction confirmation to seek specialist care.', 'Respiratory mechanics and IVIG/plasma exchange are not implemented orders. The station evaluates recognition and safe escalation, not definitive immunotherapy delivery.'],
  },
  scalp_tenderness: {
    history: [
      ['New headache', ['when', 'headache', 'temple', 'before'], 'A new left temporal headache for ten days. I do not usually get headaches.'],
      ['Visual episode detail', ['which eye', 'duration', 'vision', 'curtain'], 'Only the left eye, for about three minutes yesterday. It was painless and fully cleared.', true],
      ['Polymyalgia symptoms', ['shoulder', 'hip', 'stiff', 'morning'], 'Both shoulders have been stiff for an hour each morning over the last month.', true],
      ['Constitutional symptoms', ['fever', 'weight', 'appetite'], 'I have lost a little weight and have less appetite, but no shaking chills.'],
      ['Jaw symptom specificity', ['chew', 'jaw', 'tooth', 'rest'], 'It starts after chewing a while and settles when I rest; not a single sore tooth.'],
      ['Stroke symptoms', ['weak', 'speech', 'numb', 'double'], 'No weakness, slurred speech, numbness or double vision.'],
      ['Medication and risk', ['med', 'steroid', 'diabetes', 'allerg'], 'Amlodipine only. No steroids, diabetes or medicine allergies.'],
      ['Function and support', ['home', 'support', 'drive', 'read'], 'Usually I read and drive independently. My daughter drove me today because of the eye episode.'],
    ], problems: ['Hypertension'], meds: [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily' }],
    record: ['Primary care review', 'No prior migraine or visual disturbance. Independent baseline function; no chronic glucocorticoid use.'],
    personality: 'Initially focused on the headache, does not realize the brief visual loss is urgent.', behavior: 'Reveal the visual episode and jaw fatigue when asked; do not say normal vision now makes it safe to wait.',
    teaching: ['Threatened vision calls for immediate treatment and urgent ophthalmology/rheumatology assessment; diagnostic confirmation must not delay treatment.', 'Inflammatory markers support but do not independently establish the diagnosis. Arterial imaging/biopsy and subsequent steroid management require specialist follow-up.'],
  },
  fasting_acidosis: {
    history: [
      ['Intake timeline', ['when', 'last meal', 'days', 'food'], 'Three days without a proper meal after a heavy weekend of drinking.', true],
      ['Vomiting pattern', ['vomit', 'blood', 'coffee', 'frequency'], 'Repeated nonbloody vomiting. Small sips stay down only briefly.'],
      ['Alcohol and withdrawal', ['last drink', 'amount', 'withdraw', 'seizure'], 'Last alcohol two days ago. No previous withdrawal seizures; I feel shaky but have not hallucinated.'],
      ['Toxic ingestion', ['methanol', 'antifreeze', 'aspirin', 'poison'], 'No antifreeze, solvent, aspirin overdose or other ingestion. I was not trying to harm myself.', true],
      ['Pain and infection screen', ['pain', 'back', 'fever', 'stool'], 'Mild generalized stomach soreness from retching, no focal or back-radiating pain, fever or black stool.'],
      ['Drug history', ['sglt', 'diabetes drug', 'insulin', 'tablet'], 'No diabetes medicines, including weight-loss tablets borrowed from anyone else.'],
      ['Pregnancy and background', ['pregnan', 'period', 'kidney', 'allerg'], 'Last period was normal two weeks ago. No kidney disease or medicine allergies.'],
      ['Social support', ['home', 'support', 'alcohol help', 'safe'], 'My sister can help, and I would accept support for drinking once I feel better.'],
    ], problems: ['Harmful alcohol use'], meds: [], record: ['Previous urgent-care visit', 'Alcohol-related gastritis six months ago. No diabetes or chronic kidney disease recorded.'],
    personality: 'Nauseated and worried about being judged for alcohol use.', behavior: 'Give exposure history without blame; do not claim that a low glucose excludes other causes of an anion-gap acidosis.',
    teaching: ['Thiamine, carbohydrate-containing fluids, electrolyte replacement and reassessment are central; exclude competing causes of acidosis.', 'Dextrose-containing IV fluids are absent from the catalog. This case cannot simulate full biochemical correction; do not substitute thiamine alone or automatically make ketones normalize.'],
  },
  warm_race_finish: {
    history: [
      ['Exposure detail', ['duration', 'weather', 'race', 'heat'], 'A half-marathon in unusually humid weather. I had not trained in this heat.'],
      ['Collapse description', ['collapse', 'faint', 'finish', 'when'], 'I sat down because I felt faint after crossing the line; I did not lose consciousness.', true],
      ['Mental state', ['confus', 'behavior', 'memory', 'seizure'], 'I remember the volunteers and answered their questions. No confusion or seizure.', true],
      ['Fluid intake', ['litre', 'liter', 'water', 'drink'], 'Only a small bottle during the run. I did not drink litres of plain water afterwards.'],
      ['Muscle and urine symptoms', ['muscle', 'urine', 'dark', 'pain'], 'Leg cramps but no severe focal muscle pain. Urine is concentrated yellow, not brown.'],
      ['Cardiac symptoms', ['chest', 'palpitation', 'breath'], 'No chest pain or palpitations before slowing down. My breathing settled in the shade.'],
      ['Medication and risks', ['med', 'stimulant', 'drug', 'ill'], 'No stimulants, regular medicines, recent infection or previous heat illness.'],
      ['Support and allergies', ['home', 'support', 'allerg', 'cool'], 'No medicine allergies. A friend can take me to a cool home and stay with me.'],
    ], problems: [], meds: [], record: ['Sports health review', 'Previously healthy recreational runner. No exertional syncope or cardiovascular disease.'],
    personality: 'Disappointed about the race, wants reassurance about when to train again.', behavior: 'Distinguish feeling faint from loss of consciousness. Do not claim no risk merely because sweating is present.',
    teaching: ['Altered mental status raises concern for heat stroke even if a later temperature is lower after cooling.', 'The scripted falling temperature assumes the already documented removal from heat. Confirm recovery, oral intake and safe supervision before discharge; avoid an immediate return to training.'],
  },
};

/** Full case fields for the original acute encounters only; the shared compiler stays unchanged. */
export function completeAcute(c: CaseDef): void {
  completeAcuteOutcomes(c);
  const d = acuteDetails[c.id];
  if (!d) return;
  c.persona.facts.push(...d.history.map(([label, keywords, text, key], i) => ({ id: `detail${i + 1}`, label, keywords, text, key: key ?? false })));
  c.persona.personality = d.personality;
  c.persona.behavior = [d.behavior, 'Answer from the authored history. Say when you do not know; do not invent test results or promise a treatment outcome.'];
  c.presentation.documentedHomeMeds = d.meds;
  c.presentation.problemList = d.problems;
  c.presentation.encounters = [{ id: `${c.id}_prior`, date: 'Before this encounter', type: 'Prior record', department: 'Outpatient / prior care', reason: d.record[0], summary: d.record[1] }];
  c.teaching.push(...d.teaching);
  const additionalReferences: Record<string, string[]> = {
    steroid_thirst: ['JBDS. Management of hyperglycaemia and steroid therapy (2023). https://www.diabetes.org.uk/sites/default/files/2023-03/JBDS%2008%20Steroids%20and%20DM%20Guideline%20with%20qr%20code.pdf'],
    stoma_losses: ['Nightingale. How to manage a high-output stoma. https://fg.bmj.com/content/13/2/140'],
    exercise_dark_urine: ['AAST Critical Care Committee. Rhabdomyolysis consensus. https://tsaco.bmj.com/content/7/1/e000836'],
    dialysis_orthopnea: ['UK Kidney Association. Hemodialysis guideline. https://pmc.ncbi.nlm.nih.gov/articles/PMC6798406/'],
    hemolysis_after_infection: ['ARUP Consult. G6PD test interpretation during hemolysis. https://arupconsult.com/ati/glucose-6-phosphate-dehydrogenase'],
    ascending_weakness: ['EAN/PNS guideline on Guillain–Barré syndrome (2023). https://doi.org/10.1111/ene.16073'],
    fatigable_swallow: ['Myasthenia Gravis Foundation of America. Cautionary drugs. https://myasthenia.org/Living-With-MG/MG-Emergency-Preparedness/Cautionary-Drugs/'],
    scalp_tenderness: ['ACR/Vasculitis Foundation. Giant cell arteritis guideline. https://doi.org/10.1002/acr.24632'],
    fasting_acidosis: ['McGuire et al. Alcoholic ketoacidosis. https://pmc.ncbi.nlm.nih.gov/articles/PMC2564331/'],
    warm_race_finish: ['ACSM expert consensus on exertional heat illness (2023). https://doi.org/10.1249/JSR.0000000000001058'],
  };
  c.references.push(...(additionalReferences[c.id] ?? []));
  const pain = ({ exercise_dark_urine: 6, delayed_headache_fall: 5, scalp_tenderness: 5 } as Record<string, number>)[c.id];
  if (pain !== undefined) {
    c.presentation.triageVitals.pain = c.physiology.baseline.pain = pain;
    c.physiology.effects.push({ tag: 'analgesic_mild', delta: { pain: -2 }, tauMin: 25, durationMin: 180, maxUnits: 1 });
  }
  // Full rules below describe actions the current game can observe, never unavailable procedures.
  const step = (id: string, label: string, rule: Rule, teaching?: string) => c.scoring.critical.push({ id, label, rule, points: 6, teaching });
  const addExam = (label: string, ...maneuvers: string[]) => {
    const first = c.scoring.critical.find(x => x.label === 'Perform the focused examination');
    if (first) { first.label = label; first.rule = { type: 'exam', maneuvers }; }
  };
  const handoff = (guard: Rule, note: string) => {
    for (const consult of c.consults) {
      consult.guard = guard;
      consult.criteria = `Identify the patient and present pertinent findings supporting ${c.title}. ${note}`;
      consult.onAccept.note = { title: 'Receiving team plan', text: note };
      consult.declineHint = 'Assess the relevant findings or request urgent senior assistance, then give a focused handoff.';
    }
  };
  const urgent = ['dialysis_orthopnea', 'fever_after_infusion', 'delayed_headache_fall', 'fatigable_swallow', 'ascending_weakness', 'scalp_tenderness'];
  if (urgent.includes(c.id)) c.scoring.harms.push({ id: 'unsafe_home', label: 'Discharged home despite a time-critical condition', penalty: 20, rule: { type: 'dispo', decisions: ['discharge'] }, teaching: 'This presentation requires monitored hospital or specialist care.' });
  switch (c.id) {
    case 'missed_lunch':
      c.presentation.priorLabs = [{ analyte: 'creat', value: 0.7, daysAgo: 60 }];
      c.labs = { ...c.labs, na: 139, k: 4.0, cl: 103, hco3: 25, bun: 12, creat: 0.7, hcg_u: 'Negative' };
      c.physiology.limits = { glucose: [35, 160], hr: [65, 125] };
      c.exam.skin_inspect = [{ when: { var: 'glucose', op: '>', value: 75 }, text: 'Palms no longer sweaty and the fine tremor has settled.' }, { text: 'Sweaty palms and a fine tremor.' }];
      addExam('Assess alertness and ability to swallow', 'gen_mental');
      step('repeat_glucose', 'Collect at least two bedside glucose measurements during care', { type: 'collected', codes: ['glu_poc'], count: 2 }, 'Repeat after treatment and confirm sustained recovery. The current rule counts collections but cannot enforce a post-treatment result threshold.');
      c.scoring.harms.push({ id: 'home_without_treatment', label: 'Discharged without treating the low glucose', penalty: 15, rule: { type: 'all', rules: [{ type: 'dispo', decisions: ['discharge'] }, { type: 'not', rule: { type: 'given', codes: ['oral_glucose'] } }] }, teaching: 'Treat hypoglycemia and document recovery before discharge.' });
      break;
    case 'steroid_thirst':
      c.physiology.baseline.glucose = 326;
      c.physiology.effects = [{ tag: 'fluids', delta: { hr: -6, glucose: -35 }, tauMin: 45, maxUnits: 1 }];
      c.labs.glu = c.labs.glu_poc = { var: 'glucose' };
      addExam('Assess hydration and mental state', 'heent_mucosa', 'gen_mental');
      step('recheck_glucose', 'Arrange a repeat glucose measurement during reassessment', { type: 'order', codes: ['glu_poc'] });
      break;
    case 'stoma_losses':
      c.presentation.priorLabs = [{ analyte: 'creat', value: 0.8, daysAgo: 7 }];
      c.exam.skin_capref = [{ when: { var: 'sbp', op: '>', value: 105 }, text: 'Hands warmer with capillary refill about two seconds after replacement.' }, { text: 'Cool hands with capillary refill around three seconds.' }];
      c.exam.neuro_gait = 'Gait testing deferred while hypotensive and lightheaded; no focal limb weakness on the stretcher.';
      c.physiology.baseline.creat = 2.4;
      c.physiology.drift = { hr: 2, sbp: -2, creat: 0.03 };
      c.physiology.limits = { hr: [75, 140], sbp: [75, 130], creat: [0.8, 4] };
      c.physiology.effects = [{ tag: 'fluids', delta: { hr: -9, sbp: 9 }, driftMult: { hr: 0, sbp: 0, creat: 0 }, tauMin: 12, maxUnits: 2 }];
      c.labs.creat = { var: 'creat' };
      step('magnesium', 'Check magnesium with high-output intestinal losses', { type: 'order', codes: ['mg'] });
      step('perfusion', 'Reassess vital signs during replacement', { type: 'order', codes: ['vitals_q15', 'vitals_now'] });
      handoff({ type: 'any', rules: [{ type: 'order', codes: ['bmp', 'cmp'] }, { type: 'escalated' }] }, 'Admit for measured replacement of ongoing stoma losses, renal/electrolyte monitoring and stoma-team review.');
      break;
    case 'dialysis_orthopnea':
      c.patient.weightKg = 77;
      c.exam.pulm_effort = 'Sitting upright with increased work of breathing, speaking in short phrases; cannot tolerate lying flat.';
      c.exam.cv_pulses = 'Peripheral pulses present. Left forearm dialysis fistula has a palpable thrill; no overlying erythema.';
      c.physiology.drift = { rr: 1, spo2: -0.5 };
      c.physiology.limits = { rr: [18, 38], spo2: [80, 98] };
      c.physiology.effects.push({ tag: 'fluids', delta: { spo2: -2, rr: 2 }, tauMin: 8, maxUnits: 2, harm: { flag: 'fluid_worsening', page: 'Breathlessness has increased after fluid loading; reassess the volume-overloaded anuric patient.' } });
      c.ecg = { params: { rate: 110, rhythm: 'sinus' }, machineRead: 'Sinus tachycardia without QRS widening or acute ST elevation.', readKeywords: ['sinus', 'tachycardia'] };
      step('rhythm', 'Review ECG for potassium-related changes', { type: 'ecg_signed' });
      step('monitor', 'Start continuous monitoring', { type: 'order', codes: ['monitor'] });
      c.scoring.harms.push({ id: 'fluid_loading', label: 'Gave at least one litre of crystalloid despite anuric pulmonary edema', penalty: 12, rule: { type: 'given', tags: ['fluids'], minTotalMl: 1000 }, teaching: 'Routine fluid loading can worsen pulmonary edema in this markedly overloaded patient.' });
      handoff({ type: 'any', rules: [{ type: 'exam', maneuvers: ['pulm_effort', 'pulm_auscultate'], min: 1 }, { type: 'escalated' }] }, 'Urgent ICU and nephrology coordination for dialysis and respiratory support; oxygen is a bridge, not definitive volume removal.');
      break;
    case 'exercise_dark_urine':
      c.presentation.priorLabs = [{ analyte: 'creat', value: 0.7, daysAgo: 180 }];
      c.physiology.baseline = { ...c.physiology.baseline, hr: 98, creat: 1.8 };
      c.presentation.triageVitals.hr = 98;
      c.physiology.drift = { creat: 0.04 };
      c.physiology.limits = { creat: [0.7, 4], hr: [65, 120] };
      c.physiology.effects.push({ tag: 'fluids', delta: { hr: -8 }, driftMult: { creat: 0 }, tauMin: 20, maxUnits: 2 });
      c.labs = { ...c.labs, creat: { var: 'creat' }, na: 138, cl: 103, hco3: 21, ca: 8.1, phos: 4.8, ua_color: 'Dark brown', ua_appear: 'Clear, dark', ua_sg: 1.025, ck: { kind: 'series', points: [[0, 31900], [120, 35000], [240, 36000]] } };
      step('urinalysis', 'Compare urine dipstick blood with microscopy', { type: 'order', codes: ['ua'] });
      handoff({ type: 'any', rules: [{ type: 'order', codes: ['ck'] }, { type: 'escalated' }] }, 'Continue monitored fluids and serial potassium, creatinine, CK, urine output and compartment assessment. A rising CK early in treatment does not alone mean treatment failure.');
      break;
    case 'cramps_long_qt':
      c.labs = { ...c.labs, na: 137, cl: 99, hco3: 26, bun: 20, alb: 4.0 };
      c.physiology.effects = [{ tag: 'magnesium_replacement', delta: { hr: -12 }, tauMin: 30, maxUnits: 1 }];
      step('electrolytes', 'Check potassium, calcium and renal function', { type: 'order', codes: ['bmp', 'cmp'] });
      step('ecg', 'Review the prolonged QT on ECG', { type: 'ecg_signed' });
      handoff({ type: 'any', rules: [{ type: 'order', codes: ['mg'] }, { type: 'escalated' }] }, 'Telemetry, monitored magnesium and potassium replacement, repeat electrolytes and review of hydrochlorothiazide and PPI. ECG and electrolyte treatment-linked evolution are not modeled.');
      break;
    case 'calcium_constipation':
      c.labs = { ...c.labs, na: 141, k: 3.4, cl: 95, glu: 105, glu_poc: 105 };
      c.physiology.baseline.creat = 2.0;
      c.physiology.effects = [{ tag: 'fluids', delta: { hr: -5 }, tauMin: 30, maxUnits: 2 }];
      step('monitor', 'Monitor rhythm during severe hypercalcemia treatment', { type: 'order', codes: ['monitor'] });
      handoff({ type: 'any', rules: [{ type: 'order', codes: ['bmp', 'cmp'] }, { type: 'escalated' }] }, 'Monitored admission for severe symptomatic hypercalcemia and AKI. Stop calcium/alkali, reassess hydration and arrange etiologic testing and specialist calcium-lowering treatment.');
      break;
    case 'heavy_periods_fatigue':
      c.presentation.priorLabs = [{ analyte: 'hgb', value: 12.4, daysAgo: 365 }];
      c.labs = { ...c.labs, rbc: 4.56, wbc: 6.4, creat: 0.7, bun: 12 };
      addExam('Assess pallor and cardiovascular compensation', 'heent_mucosa', 'cv_auscultate');
      break;
    case 'hemolysis_after_infection':
      c.labs = { ...c.labs, creat: 1.2, bun: 25, k: 4.6, na: 138, cl: 103, hco3: 23, wbc: 8.7, plt: 238, ast: 52, alt: 25, ua_color: 'Tea-colored', ua_appear: 'Clear, dark', ua_sg: 1.025 };
      c.labs.hgb = { kind: 'series', points: [[0, 8.1], [120, 7.8], [240, 7.6]] };
      c.labs.hct = { kind: 'series', points: [[0, 24], [120, 23.4], [240, 22.8]] };
      // Match the falling hematocrit and stable MCV instead of inheriting a normal RBC count.
      c.labs.rbc = { kind: 'series', points: [[0, 2.64], [120, 2.57], [240, 2.51]] };
      c.presentation.priorLabs = [{ analyte: 'hgb', value: 14.2, daysAgo: 180 }];
      c.scoring.critical.find(x => x.label === 'Assess anemia and bilirubin')!.label = 'Assess anemia on the blood count';
      step('bilirubin', 'Measure bilirubin and distinguish hepatic from hemolytic patterns', { type: 'order', codes: ['lfts', 'cmp'] });
      step('repeat_count', 'Arrange continued blood-count monitoring through admission or repeat sampling', { type: 'any', rules: [{ type: 'consult', contactId: 'hosp' }, { type: 'collected', codes: ['cbc'], count: 2 }] }, 'An early accepted handoff includes the documented serial-count plan; do not delay transfer just to collect a second ED sample.');
      handoff({ type: 'any', rules: [{ type: 'order', codes: ['cbc'] }, { type: 'escalated' }] }, 'Admit for ongoing hemolysis assessment, serial hemoglobin and renal function, hematology advice and transfusion assessment if clinically indicated.');
      break;
    case 'fever_after_infusion': {
      c.labs = { ...c.labs, hct: 29.4, rbc: 3.27, mcv: 90, lymph: 72, mono: 8, eos: 2, creat: 0.8, bun: 17, na: 136, k: 3.7, cl: 102, hco3: 23, bcx1: 'Preliminary: no growth to date; incubation continuing.', bcx2: 'Preliminary: no growth to date; incubation continuing.' };
      // The existing engine models antibiotics by class tags, not culture susceptibility.
      c.physiology.effects = ['abx_cefepime', 'abx_piptazo', 'abx_carbapenem'].map(tag => ({ tag, onsetMin: 20, driftMult: { sbp: 0, hr: 0 }, tauMin: 60, maxUnits: 1 }));
      c.physiology.limits = { sbp: [75, 140], hr: [75, 145] };
      c.teaching.push('The engine shares a carbapenem response tag between meropenem and ertapenem. Physiological response is therefore not evidence of appropriate spectrum; the treatment checklist accepts only antipseudomonal agents.');
      const antibiotic = c.scoring.critical.find(x => x.label.includes('antipseudomonal'));
      if (antibiotic) { antibiotic.label = 'Give empiric antipseudomonal IV antibiotic within 60 minutes'; antibiotic.rule = { type: 'given', codes: ['cefepime', 'pip_tazo', 'meropenem'], withinMin: 60 }; }
      step('count', 'Obtain a differential blood count', { type: 'order', codes: ['cbc'] });
      step('organ_function', 'Assess renal function and lactate', { type: 'all', rules: [{ type: 'order', codes: ['bmp', 'cmp'] }, { type: 'order', codes: ['lactate'] }] });
      handoff({ type: 'any', rules: [{ type: 'escalated' }, { type: 'fact', factIds: ['hx1'] }] }, 'Admit for neutropenic sepsis management and oncology input. Ensure prompt antibiotics and cultures; do not delay transfer while awaiting count confirmation.');
      break;
    }
    case 'delayed_headache_fall':
      c.labs = { hgb: 12.8, hct: 38.4, rbc: 4.22, mcv: 91, plt: 210, creat: 0.9, na: 138, k: 4.1, cl: 103, hco3: 24, glu: 108, glu_poc: 108, inr: 1.1, ptt: 29 };
      c.physiology.triggers = [{ id: 'neuro_recheck', when: { afterMin: 30 }, page: { from: 'nurse', text: 'Persistent headache and left-hand weakness. Please repeat neurological observations while neurosurgical transfer is arranged.', priority: 'urgent' } }];
      step('observations', 'Arrange frequent neurological and vital-sign reassessment', { type: 'order', codes: ['vitals_q15', 'monitor'] });
      c.scoring.harms.push({ id: 'anticoagulant', label: 'Gave additional anticoagulant with active intracranial bleeding', penalty: 20, rule: { type: 'given', tags: ['anticoagulant'] }, teaching: 'Withhold anticoagulation and urgently assess reversal; a normal INR does not exclude apixaban activity.' });
      handoff({ type: 'any', rules: [{ type: 'order', codes: ['ct_head'] }, { type: 'escalated' }] }, 'Urgent neurosurgical transfer for symptomatic subdural hematoma with mass effect. Confirm apixaban dose/time, reversal plan and monitored transport.');
      break;
    case 'positional_spinning':
      c.exam.neuro_focal = 'Normal cranial nerves, limb strength, sensation and coordination between attacks. No spontaneous nystagmus at rest.';
      addExam('Check positional nystagmus and gait', 'vestibular_position', 'neuro_gait');
      c.scoring.lowValue = [{ codes: ['ct_head', 'mri_brain'], penalty: 3, why: 'Typical brief positional attacks and a normal neurological examination do not routinely require imaging; atypical findings would change this.' }];
      break;
    case 'cluster_attack':
      c.physiology.effects[0].durationMin = 60;
      c.physiology.triggers = [{ id: 'attack_resolution', when: { afterMin: 60 }, jump: { pain: -9 }, page: { from: 'nurse', text: 'The headache attack has settled. Please reassess and arrange access to rescue treatment and follow-up.', priority: 'info' } }];
      c.exam.heent_vision = 'Visual acuity 6/6 in each eye; no field deficit.';
      c.exam.heent_tonometry = 'Intraocular pressure 15 mmHg right, 16 mmHg left.';
      addExam('Check pupils, vision and neurological findings', 'heent_pupils', 'heent_vision', 'neuro_focal');
      break;
    case 'tremor_after_stopping':
      c.labs = { ...c.labs, na: 137, cl: 100, hco3: 24, creat: 0.8, ast: 84, alt: 49, tbili: 1.0, hgb: 13.3, hct: 40.0, rbc: 4.0, mcv: 100, plt: 154 };
      c.physiology.drift = { hr: 3, sbp: 2 };
      c.physiology.limits = { hr: [70, 145], sbp: [100, 185] };
      c.physiology.effects = [{ tag: 'benzodiazepine', delta: { hr: -18, sbp: -12 }, driftMult: { hr: 0, sbp: 0 }, tauMin: 10, durationMin: 120, maxUnits: 1 }];
      step('electrolytes', 'Assess glucose, renal function and magnesium', { type: 'all', rules: [{ type: 'order', codes: ['bmp', 'cmp'] }, { type: 'order', codes: ['mg'] }] });
      handoff({ type: 'any', rules: [{ type: 'fact', factIds: ['hx2'] }, { type: 'escalated' }] }, 'Monitored withdrawal treatment with repeat clinical assessments, thiamine, nutrition and electrolyte replacement. Prior withdrawal seizure makes unsupported home withdrawal unsafe.');
      break;
    case 'headache_after_lp':
      c.physiology.effects = [{ tag: 'analgesic_mild', delta: { pain: -2 }, tauMin: 25, durationMin: 180, maxUnits: 1 }];
      const relief = c.scoring.critical.find(x => x.label === 'Provide symptom relief while arranging assessment');
      if (relief) relief.rule = { type: 'given', codes: ['apap_po', 'apap_iv'] };
      addExam('Assess focal neurology and meningism', 'neuro_focal', 'neck_stiffness');
      handoff({ type: 'any', rules: [{ type: 'exam', maneuvers: ['neuro_focal'] }, { type: 'escalated' }] }, 'Observe for hydration and anesthetic assessment of disabling post-dural puncture headache; consider epidural blood patch after reviewing contraindications.');
      break;
    case 'fatigable_swallow':
    case 'ascending_weakness':
      c.labs = { na: 139, k: 4.0, cl: 104, hco3: 24, creat: 0.8, glu: 102, glu_poc: 102, mg: 2.0, wbc: 8.4, hgb: 13.2, hct: 39.6, rbc: 4.4, mcv: 90, plt: 245 };
      c.exam.neuro_gait = c.id === 'ascending_weakness'
        ? 'Unable to rise safely without assistance because of symmetrical leg weakness; do not attempt unaided walking.'
        : 'Gait testing deferred because bulbar and respiratory weakness take priority; sensation is preserved.';
      if (c.id === 'ascending_weakness') Object.assign(c.labs, { hgb: 14.5, hct: 43.5, rbc: 4.83 });
      if (c.id === 'fatigable_swallow') {
        c.physiology.effects.push({ tag: 'magnesium_replacement', harm: { flag: 'mg_risk', page: 'IV magnesium can worsen neuromuscular transmission in myasthenia. Reassess urgently with critical care.' } });
        c.scoring.harms.push({ id: 'iv_magnesium', label: 'Gave unnecessary IV magnesium with myasthenic respiratory weakness', penalty: 10, rule: { type: 'given', codes: ['magnesium_iv'] }, teaching: 'Magnesium is normal here. IV magnesium can aggravate myasthenia; exceptional indications require specialist risk assessment and close observation.' });
      }
      addExam('Assess limb/bulbar weakness and respiratory effort', 'neuro_focal', 'pulm_effort');
      c.physiology.triggers = [{ id: 'respiratory_reassessment', when: { afterMin: 20 }, page: { from: 'nurse', text: 'Cough remains weak. Please reassess breathing and airway protection; a normal oxygen saturation does not assess respiratory reserve.', priority: 'urgent' } }];
      c.scoring.harms.push({ id: 'sedation', label: 'Gave a respiratory-depressant sedative with neuromuscular respiratory weakness', penalty: 10, rule: { type: 'given', tags: ['benzodiazepine'] }, teaching: 'Sedation can worsen ventilation in this patient; airway procedures under specialist supervision are a different situation.' });
      handoff({ type: 'any', rules: [{ type: 'exam', maneuvers: ['pulm_effort'] }, { type: 'escalated' }] }, 'Urgent ICU and neurology review for serial respiratory mechanics, airway support and disease-specific treatment. Do not wait for desaturation.');
      break;
    case 'scalp_tenderness':
      Object.assign(c.labs, { hct: 32.7, rbc: 3.72, mcv: 88 });
      c.exam.heent_vision = 'Visual acuity 6/9 in each eye with usual glasses; no persistent deficit at this moment.';
      addExam('Document current vision and pupils after transient visual loss', 'heent_vision', 'heent_pupils');
      handoff({ type: 'any', rules: [{ type: 'fact', factIds: ['hx2'] }, { type: 'escalated' }] }, 'Urgent ophthalmology/rheumatology pathway for suspected giant cell arteritis with threatened vision. Start glucocorticoids promptly and arrange diagnostic confirmation without treatment delay.');
      break;
    case 'fasting_acidosis':
      c.labs = { ...c.labs, creat: 0.9, bun: 24, k: 3.2, phos: 2.0, hcg_u: 'Negative', agap: 25 };
      c.physiology.effects = [{ tag: 'fluids', delta: { hr: -8 }, tauMin: 20, maxUnits: 2 }];
      step('chemistry', 'Check renal function and electrolytes', { type: 'order', codes: ['bmp', 'cmp'] });
      step('magnesium_phosphate', 'Check magnesium and phosphate with poor intake', { type: 'all', rules: [{ type: 'order', codes: ['mg'] }, { type: 'order', codes: ['phos'] }] });
      step('volume', 'Begin monitored isotonic volume replacement', { type: 'given', codes: ['ns_bolus', 'lr_bolus'] });
      handoff({ type: 'any', rules: [{ type: 'order', codes: ['vbg', 'ketones'] }, { type: 'escalated' }] }, 'Admit for thiamine, carbohydrate-containing IV fluid, electrolyte replacement and repeat acid-base assessment; evaluate competing causes and withdrawal risk.');
      break;
    case 'warm_race_finish':
      c.physiology.limits = { ...c.physiology.limits, sbp: [95, 130] };
      c.exam.neuro_focal = 'Normal speech, pupils, limb power and coordination.';
      addExam('Assess mentation and neurological findings', 'gen_mental', 'neuro_focal');
      break;
  }
}

// Outcome text describes the intended care pathway, not a guaranteed physiological cure.
const acuteOutcomes: Record<string, [string, string]> = {
  missed_lunch: ['Glucose correction is checked, food and supplies are arranged, and a safe plan addresses the missed meal.', 'The low glucose or risk of recurrence has not been adequately addressed.'],
  steroid_thirst: ['The acute metabolic assessment supports a monitored outpatient glucose plan with prompt diabetes follow-up.', 'Symptomatic hyperglycemia is left without a clear assessment or follow-up plan.'],
  stoma_losses: ['The receiving team continues measured replacement and renal/electrolyte monitoring with stoma support.', 'Ongoing losses and renal injury remain without an adequate replacement or monitoring plan.'],
  dialysis_orthopnea: ['Critical care and renal services take over urgent respiratory support and volume removal planning.', 'Anuric pulmonary edema remains without timely definitive-care arrangements.'],
  exercise_dark_urine: ['The patient is admitted for monitored hydration and serial assessment of muscle injury, electrolytes and renal function.', 'Muscle injury and renal/electrolyte risk remain inadequately assessed or treated.'],
  cramps_long_qt: ['Telemetry care continues monitored replacement and investigation of medication and gastrointestinal losses.', 'Electrolyte depletion and arrhythmia risk remain without an adequate correction and monitoring plan.'],
  calcium_constipation: ['Monitored inpatient care addresses severe hypercalcemia, volume depletion and the underlying cause.', 'Symptomatic hypercalcemia and renal dysfunction remain without adequate treatment or specialist assessment.'],
  heavy_periods_fatigue: ['A stable patient leaves with an iron-replacement discussion and timely evaluation of heavy menstrual bleeding.', 'The anemia or source of continuing blood loss remains without a clear management plan.'],
  hemolysis_after_infection: ['The receiving team monitors ongoing hemolysis and renal function and arranges hematology assessment.', 'Ongoing hemolysis and the need for serial assessment have not been addressed.'],
  fever_after_infusion: ['Prompt empiric treatment and inpatient oncology-supported monitoring are arranged for neutropenic sepsis.', 'The infection remains without timely effective treatment or monitored care.'],
  delayed_headache_fall: ['Urgent neurosurgical transfer includes a clear anticoagulant-reversal assessment and observation plan.', 'Intracranial bleeding and neurological change remain without timely specialist care.'],
  positional_spinning: ['Typical positional vertigo is treated with a repositioning plan and clear advice for persistent or atypical symptoms.', 'The positional syndrome or important alternatives remain inadequately assessed.'],
  cluster_attack: ['The acute attack is addressed and access to rescue treatment and headache follow-up is arranged.', 'The attack or preparation for further attacks remains inadequately addressed.'],
  tremor_after_stopping: ['Monitored withdrawal care includes symptom treatment, thiamine, nutrition and subsequent addiction support.', 'A patient at risk of complicated withdrawal remains without an adequate supervised treatment plan.'],
  headache_after_lp: ['Observation and anesthetic assessment address the disabling positional headache after red-flag review.', 'The disabling headache remains without adequate assessment or a procedural consultation plan.'],
  fatigable_swallow: ['Critical care and neurology take over respiratory and bulbar assessment with an airway and disease-specific treatment plan.', 'Neuromuscular respiratory risk remains without timely expert assessment and support.'],
  ascending_weakness: ['Critical care and neurology arrange serial respiratory/autonomic assessment and disease-specific care.', 'Progressive weakness remains without adequate respiratory-risk assessment and specialist care.'],
  scalp_tenderness: ['Urgent glucocorticoid treatment and specialist transfer address threatened vision while confirmation is arranged.', 'Vision remains threatened without timely treatment and specialist assessment.'],
  fasting_acidosis: ['The receiving team addresses volume, carbohydrate, thiamine and electrolyte needs with repeat metabolic assessment.', 'The metabolic disturbance remains without a complete nutritional and fluid-treatment plan.'],
  warm_race_finish: ['Recovery is reassessed after removal from heat, with a safe hydration, supervision and return-precaution plan.', 'Recovery or safe supervision has not been adequately established.'],
};

function completeAcuteOutcomes(c: CaseDef): void {
  const outcomes = acuteOutcomes[c.id];
  if (outcomes) [c.truth.outcomeGood, c.truth.outcomeBad] = outcomes;
}
