import type { CaseBrief, Step } from '../brief';
import type { CaseDef, Rule } from '../../types';
import { examine, given, order, senior, viralStewardship } from './checkpoints';

const signed: Step = ['Interpret and sign the ECG', { type: 'ecg_signed' }];
const blackout = 'NICE CG109. Transient loss of consciousness. https://www.nice.org.uk/guidance/cg109';
const pleura = 'British Thoracic Society. Pleural disease. https://www.brit-thoracic.org.uk/clinical-resources/guidelines/pleural-disease/';

export const cardiorespiratory: CaseBrief[] = [
  {
    id: 'congestive_heart_failure', specialty: 'cardiology', age: 72, sex: 'F', difficulty: 2, esi: 2,
    complaint: 'Breathlessness at night and swollen ankles', opening: 'I have been sleeping sitting upright. Last night even that was not enough.',
    facts: [['Orthopnea and weight gain', ['flat', 'pillow', 'weight', 'night'], 'I need three pillows now and my weight is up four kilos this week.'],
      ['Medication access', ['medicine', 'tablet', 'refill', 'water pill'], 'My water tablets ran out five days ago. I could not get to the pharmacy.'],
      ["Progression", ["start", "duration", "worse"], "My ankles started swelling a week ago. Over the last two nights I have woken gasping and had to sit on the edge of the bed."],
      ["Baseline activity", ["walk", "exercise", "usual"], "Normally I can walk to the corner shop and sleep with one pillow. Today I stopped twice between the bedroom and front door."],
      ["Ischemia screen", ["pain", "pressure", "jaw", "arm"], "No pressure in my chest, jaw pain or pain down an arm. The main problem is getting enough air."],
      ["Infection screen", ["fever", "sputum", "chills", "infection"], "No fever or shaking chills. I cough when I lie down, but I am not bringing up colored phlegm."],
      ["Embolic risk screen", ["clot", "leg pain", "travel", "operation"], "Both ankles are swollen, neither calf hurts. No recent operation, long journey or previous blood clot."],
      ["Regular medicines", ["medication", "medicines", "dose", "bisoprolol"], "Apart from furosemide 20 milligrams each morning, I take bisoprolol 2.5 milligrams and ramipril 5 milligrams daily. I took the other two today."],
      ["Medication tolerance", ["spironolactone", "potassium", "side effect"], "The clinic stopped spironolactone after my potassium rose. I have not restarted it."],
      ["Allergies and nonprescription drugs", ["allerg", "ibuprofen", "supplement", "painkiller"], "No drug allergies. I have not used ibuprofen, cold remedies or herbal tablets."],
      ["Cardiac history", ["heart", "admission", "ejection", "kidney"], "My heart muscle is weak. I was admitted with fluid on my lungs last year. The clinic also watches my kidney tests."],
      ["Practical discharge barriers", ["support", "transport", "pharmacy", "live"], "I live alone. My niece usually collects prescriptions, but she has been away. The pharmacy said delivery could be arranged if someone asks."],
      ["Fluid and dietary intake", ["salt", "drink", "diet", "urine"], "I have not deliberately drunk extra water. I have had more ready meals while my niece is away. I am passing less urine than usual."]],
    exam: { pulm_auscultate: 'Bilateral basal crackles.', neck_jvp: 'Elevated JVP at 45 degrees.', cv_edema: 'Symmetric pitting edema to both shins.' },
    diagnosis: 'Acute decompensated heart failure', synonyms: ['acute heart failure', 'decompensated heart failure', 'chf exacerbation', 'pulmonary edema'], icd10: 'I50.23',
    disposition: 'admit_floor', acceptable: ['admit_telemetry'], consultant: 'hosp', vitals: { hr: 104, rr: 26, spo2: 89, sbp: 158, dbp: 92 },
    problems: ['Heart failure with reduced ejection fraction'], meds: [{ name: 'Furosemide', dose: '20 mg', sig: 'By mouth each morning' }],
    items: [{ id: 'empty_diuretic', kind: 'pillBottle', label: 'Empty pill bottle', where: 'bedside', facts: ['hx2'], text: 'Furosemide, 20 mg once daily. The bottle is empty. A note on the label says the refill is awaiting collection.' }],
    labs: { ntprobnp: 5460, creat: 1.3, trop: 13 }, imaging: { xr_chest: 'Enlarged cardiac silhouette with bilateral interstitial edema and small pleural effusions.' },
    pocus: { cardiac: { text: 'Reduced global LV systolic function. No pericardial effusion.' },
      lung: { text: 'Diffuse bilateral B-lines with preserved pleural sliding.' },
      ivc: { text: 'IVC 2.4 cm with minimal respiratory variation.' } },
    steps: [order('Give titrated supplemental oxygen for hypoxemia', 'o2_nc'), given('Start IV loop diuresis', 'furosemide_iv')],
    physiology: { effects: [{ tag: 'oxygen', tauMin: 3, maxUnits: 1, delta: { spo2: 5 } }, { tag: 'diuretic', onsetMin: 10, tauMin: 32, maxUnits: 1, delta: { rr: -5, spo2: 2, hr: -7 } }] },
    teaching: 'Treat hypoxemia and congestion, reassess renal function and diuretic response, and address the barrier to obtaining medication.',
    references: ['NICE CG187. Acute heart failure. https://www.nice.org.uk/guidance/cg187'],
  },
  {
    id: 'hypoxemic_lobar_pneumonia', specialty: 'pulmonology', age: 68, sex: 'M', difficulty: 2, esi: 2,
    complaint: 'Fever, cough and breathlessness', opening: 'I usually walk my dog twice a day. Today I had to sit down halfway to the bathroom.',
    facts: [['Acute febrile cough', ['when', 'sputum', 'cough', 'fever'], 'Three days of shaking chills and thick sputum. A deep breath hurts at my right base.'],
      ['Baseline function', ['oxygen', 'baseline', 'home', 'usually'], 'I have never needed oxygen. I am usually active and independent.'],
      ["Symptom sequence", ["onset", "start", "timeline"], "The cough began three days ago, then fever that night. The breathlessness became much worse this morning."],
      ["Pleuritic pain", ["pain", "chest", "deep breath"], "A sharp pain stays low on the right when I breathe deeply or cough. There is no squeezing pressure or pain into my jaw."],
      ["Sputum and bleeding", ["sputum", "phlegm", "hemoptysis", "blood"], "The phlegm is yellow-brown. I have not coughed up frank blood."],
      ["Intake and urine", ["drink", "eat", "urine", "vomit"], "I have barely eaten, but can swallow water and tablets. I passed urine this morning. No vomiting or diarrhea."],
      ["Mental state", ["confus", "drowsy", "orientation"], "I feel exhausted but I know where I am and what day it is. My daughter has not noticed confusion."],
      ["Resistance risk", ["hospital", "antibiotic", "MRSA", "pseudomonas"], "No hospital stay or antibiotics in the last three months. I have never been told I carry a resistant germ."],
      ["Aspiration screen", ["choke", "swallow", "aspirat", "seizure"], "I have not choked, vomited in my sleep, or had a seizure. Swallowing is normally easy."],
      ["Background and medicines", ["illness", "medicine", "diabetes", "immune"], "I take amlodipine 5 milligrams daily for blood pressure. No diabetes, immune treatment or chronic lung disease."],
      ["Allergy history", ["allerg", "penicillin", "reaction"], "I have taken penicillin before without a reaction. No known drug allergies."],
      ["Exposure and smoking", ["smok", "travel", "contact", "sick"], "I stopped smoking fifteen years ago after about twenty pack-years. No recent travel or known tuberculosis contact."],
      ["Home support", ["home", "support", "family"], "My daughter brought me. She can help later, but says I am far too breathless to manage at home today."]],
    exam: { pulm_auscultate: 'Bronchial breath sounds and coarse crackles over the right base.', pulm_percuss: 'Focal dullness at the right base.', pulm_effort: 'Tachypneic with increased effort.' },
    diagnosis: 'Hypoxemic community-acquired right lower lobe pneumonia', synonyms: ['pneumonia', 'community acquired pneumonia', 'lobar pneumonia'], icd10: 'J18.9',
    disposition: 'admit_floor', consultant: 'hosp', vitals: { temp: 38.8, hr: 110, rr: 26, spo2: 88, pain: 4 }, labs: { wbc: 17.2, crp: 130, bun: 22, lactate: 1.8, glu: 122 },
    imaging: { xr_chest: 'Right lower lobe airspace consolidation with air bronchograms. No effusion or pneumothorax.' },
    steps: [order('Obtain a chest film', 'xr_chest', 'xr_chest_port'), order('Treat hypoxemia', 'o2_nc'),
      given('Start an inpatient beta-lactam', 'ceftriaxone', 'amp_sulb'), given('Add atypical coverage', 'azithromycin')],
    physiology: { effects: [{ tag: 'oxygen', maxUnits: 1, tauMin: 3, delta: { spo2: 6, rr: -3 } }, { tag: 'antipyretic', tauMin: 18, maxUnits: 1, delta: { temp: -0.7, hr: -5 } }] },
    teaching: 'Focal consolidation and a new oxygen requirement support inpatient treatment. Add appropriate atypical coverage per the local treatment pathway.',
    references: ['ATS/IDSA. Community-acquired pneumonia in adults. https://www.idsociety.org/practice-guideline/community-acquired-pneumonia-cap-in-adults'],
  },
  {
    id: 'acute_bronchitis', walkToBed: true, specialty: 'pulmonology', age: 39, sex: 'F', difficulty: 1, esi: 5,
    complaint: 'A nagging cough after a cold', opening: 'The mucus turned green. That means I need an antibiotic, right?',
    facts: [['Postviral cough', ['when', 'cold', 'duration', 'fever'], 'My sore throat and runny nose cleared a week ago. The cough stayed. No fever.'],
      ['No respiratory compromise', ['breath', 'chest pain', 'exercise', 'blood'], 'I can climb the stairs as usual. No blood in the mucus or pain when I breathe.'],
      ["Duration and trajectory", ["start", "long", "days", "better"], "It started twelve days ago with a cold. Overall I feel better; the cough wakes me once or twice at night."],
      ["Cough character", ["mucus", "sputum", "dry", "color"], "Some coughs are dry and some bring up a little green mucus. There is no blood."],
      ["Pertussis screen", ["whoop", "vomit", "fits", "paroxysm"], "I do not have long uncontrollable coughing fits, a whoop, or vomiting after coughing."],
      ["Asthma screen", ["wheeze", "asthma", "night", "inhaler"], "I have never had asthma or needed an inhaler. I do not hear myself wheezing."],
      ["Systemic red flags", ["weight", "sweat", "fatigue", "appetite"], "My appetite is normal. No night sweats, weight loss or persistent fatigue."],
      ["Thromboembolic risks", ["clot", "travel", "leg", "operation"], "No swollen leg, recent surgery or long journey. I have never had a blood clot."],
      ["Background health", ["history", "immune", "diabetes", "illness"], "I do not have heart or lung disease, diabetes, or a condition that weakens my immune system."],
      ["Medicines and allergy", ["medicine", "allerg", "tablet", "ACE"], "No regular medicines or drug allergies. I tried honey and a cough lozenge, not antibiotics."],
      ["Exposure", ["contact", "work", "smok", "vape"], "My children had the same cold and are better. I do not smoke or vape."],
      ["Patient concern", ["worry", "expect", "antibiotic", "concern"], "A colleague said green mucus needs antibiotics. I mainly want to know if it is safe to go back to work."]],
    exam: { pulm_auscultate: 'Occasional coarse sounds clear after coughing, no focal crackles or consolidation.', pulm_effort: 'Comfortable at rest and speaking freely.' },
    diagnosis: 'Acute bronchitis', synonyms: ['viral bronchitis', 'acute bronchitis', 'postviral cough'], icd10: 'J20.9', disposition: 'discharge',
    steps: [examine('Assess effort and listen for focal findings', 'pulm_effort', 'pulm_auscultate')],
    counseling: ['Explain the course of a postviral cough', ['weeks', 'antibiotic', 'viral', 'virus'], 'Discuss the expected course, symptom relief and reassessment for fever or dyspnea.'],
    teaching: 'Sputum color alone does not identify bacterial infection. Pneumonia is unlikely in a well adult with normal vitals and no focal lung signs.',
    lowValue: viralStewardship,
    references: ['CDC. Outpatient clinical care for adults. https://www.cdc.gov/antibiotic-use/hcp/clinical-care/adult-outpatient.html'],
  },
  {
    id: 'secondary_spontaneous_pneumothorax', specialty: 'pulmonology', age: 62, sex: 'M', difficulty: 3, esi: 2,
    complaint: 'Sudden chest pain and breathlessness while sitting', opening: 'One moment I was reading. The next I felt a stab and could not fill my lungs.',
    facts: [['Abrupt pleuritic pain', ['when', 'onset', 'pain', 'trauma'], 'It happened all at once on the left. I have not fallen or had a procedure.'],
      ['Underlying lung disease', ['lungs', 'emphysema', 'smok', 'oxygen'], 'I have emphysema. I use inhalers but have never needed oxygen at home.'],
      ["Time and severity", ["time", "start", "minutes", "severity"], "It began forty minutes before the ambulance came. The pain is still on the left and deep breaths make it worse."],
      ["Baseline respiratory reserve", ["baseline", "walk", "stairs", "usual"], "Usually I can walk a block with a short rest. Today I cannot get across the room without stopping."],
      ["Previous episodes", ["previous", "before", "collapsed", "drain"], "I have not had a collapsed lung or chest drain before."],
      ["Infection and sputum", ["fever", "sputum", "infection", "cough"], "No fever or change in my usual morning cough. My phlegm has not increased."],
      ["Trauma and procedures", ["injury", "procedure", "needle", "fall"], "No injury, recent operation, biopsy or needle near my chest."],
      ["Perfusion symptoms", ["faint", "dizzy", "collapse", "palpitation"], "I feel anxious and breathless, but I have not fainted or felt a racing irregular heartbeat."],
      ["COPD treatment", ["medicine", "inhaler", "tiotropium", "salbutamol"], "I use tiotropium once a day and salbutamol when needed. Two puffs today did not help this sudden pain."],
      ["Hypercapnia history", ["ventilator", "carbon dioxide", "NIV", "admission"], "I have been admitted with a flare-up but never needed a breathing machine. I do not know my usual carbon dioxide level."],
      ["Smoking", ["smok", "cigarette", "tobacco"], "I smoked a pack a day for forty years. I stopped two years ago."],
      ["Allergies and anticoagulation", ["allerg", "blood thinner", "anticoag"], "No drug allergies. I do not take blood thinners."],
      ["Home situation", ["home", "live", "help", "support"], "My partner is at home. They called the ambulance because this was different from my usual breathlessness."]],
    exam: { pulm_auscultate: 'Breath sounds very quiet on the left.', pulm_percuss: 'Left hemithorax hyperresonant.', pulm_effort: 'Tachypneic with asymmetric expansion.' },
    diagnosis: 'Secondary spontaneous left pneumothorax', synonyms: ['spontaneous pneumothorax', 'pneumothorax', 'collapsed lung'], icd10: 'J93.12',
    disposition: 'admit_floor', acceptable: ['admit_stepdown'], consultant: 'hosp', problems: ['COPD with emphysema'], vitals: { hr: 111, rr: 26, spo2: 89, pain: 6 },
    labs: { ph_v: 7.36, pco2_v: 48, hco3_v: 26 }, imaging: { xr_chest: 'Left pleural line with absent peripheral markings and partial collapse of the left lung. No mediastinal shift.' },
    pocus: { lung: { text: 'Left anterior lung lacks sliding and B-lines. A lung point is present laterally. Sliding is present on the right.' } },
    steps: [order('Obtain a chest film', 'xr_chest_port', 'xr_chest'), senior],
    teaching: 'Significant breathlessness with secondary pneumothorax warrants urgent assessment for pleural drainage and monitored admission. Reassess for tension if physiology worsens.',
    references: [pleura],
  },
  {
    id: 'isolated_rib_fracture', walkToBed: true, specialty: 'trauma', age: 44, sex: 'F', difficulty: 1, esi: 4,
    complaint: 'Pain on deep breathing after hitting the side of a boat', opening: 'I can point to the rib. Coughing or laughing feels awful.',
    facts: [['Localized direct blow', ['how', 'fall', 'blow', 'injury'], 'I slipped sideways and struck my right ribs on the rail. I did not hit my head.'],
      ['Complication screen', ['breathless', 'blood', 'belly', 'abdomen'], 'I am not breathless at rest. No blood when I cough and no abdominal pain.'],
      ["Timing and mechanism", ["when", "speed", "height", "mechanism"], "It happened yesterday afternoon while we were tied up at the dock. I slipped from standing and hit the rail, not the water."],
      ["Pain distribution", ["where", "spread", "severity", "pain"], "One spot on my right side hurts. It is mild sitting still and sharp when I twist or take a deep breath."],
      ["Cough and lung expansion", ["cough", "deep", "breathe"], "I can take a deep breath if I go slowly, but I have been avoiding coughing because it hurts."],
      ["Associated injury screen", ["head", "neck", "shoulder", "back"], "No loss of consciousness, head strike, neck pain or shoulder-tip pain."],
      ["Bleeding risk", ["blood thinner", "anticoag", "bruise", "bleed"], "No blood thinners or bleeding disorder. There is a small bruise over the sore rib."],
      ["Analgesia already tried", ["medicine", "painkiller", "paracetamol", "ibuprofen"], "I took paracetamol 1 gram last night, which helped. I have not taken anything today."],
      ["Analgesic contraindications", ["ulcer", "kidney", "allerg", "asthma"], "No stomach ulcer, kidney disease, asthma reaction to painkillers or drug allergies."],
      ["Respiratory baseline", ["smok", "COPD", "lung", "usual"], "I do not smoke and have no lung disease. Normally I swim twice a week."],
      ["Pregnancy screen", ["pregnan", "period", "contraception"], "My last period was two weeks ago and normal. I use an intrauterine contraceptive device."],
      ["Home and activity", ["home", "work", "support", "job"], "My partner can help with lifting. My job is at a desk, but I want advice about when to return to swimming."]],
    exam: { pulm_effort: 'Splints when coughing, with focal right lateral rib tenderness. No paradoxical motion.', pulm_auscultate: 'Equal bilateral breath sounds.', abd_palpate: 'Soft and nontender.' },
    diagnosis: 'Isolated right rib fracture', synonyms: ['rib fracture', 'fractured rib', 'broken rib'], icd10: 'S22.31XA', disposition: 'discharge', vitals: { pain: 5 },
    imaging: { xr_chest: 'Nondisplaced right seventh rib fracture. No pleural air, blood or contusion.' },
    steps: [given('Provide oral analgesia to allow breathing and cough', 'apap_po', 'ibuprofen')],
    counseling: ['Encourage regular deep breaths and cough', ['deep breath', 'cough', 'breathe deeply'], 'Explain how analgesia allows regular deep breaths and an effective cough. Seek help for new dyspnea.'],
    teaching: 'Good analgesia and lung expansion reduce pulmonary complications. Evaluate for intrathoracic injury if breathing or perfusion worsens.',
    references: ['NHS. Broken or bruised ribs. https://www.nhs.uk/conditions/broken-or-bruised-ribs/'],
  },
  {
    id: 'low_risk_pericarditis', specialty: 'cardiology', age: 33, sex: 'M', difficulty: 2, esi: 3,
    complaint: 'Sharp central chest pain after a cold', opening: 'It eases when I sit forwards. Lying back makes it catch again.',
    facts: [['Positional pleuritic pain', ['position', 'breath', 'exert', 'pain'], 'Deep breaths and lying flat hurt. Walking does not bring it on.'],
      ['Risk review', ['fever', 'immune', 'trauma', 'blood thinner'], 'I have recovered from a cold. No fever, injury or blood thinners. I have no immune problems.'],
      ["Onset and course", ["when", "start", "duration"], "The pain began yesterday and has been fairly constant. It did not start with a sudden tearing sensation."],
      ["Recent illness", ["cold", "virus", "infection", "throat"], "I had a sore throat and runny nose last week. Those symptoms have gone."],
      ["Pain radiation", ["where", "radiate", "shoulder", "arm"], "It is central and sometimes reaches the top of my left shoulder. It is sharp rather than heavy."],
      ["Perfusion and rhythm screen", ["faint", "palpitation", "dizzy", "collapse"], "No fainting or pounding heartbeat. I can walk without feeling weak."],
      ["Congestion screen", ["breathless", "flat", "ankle", "pillow"], "I sit up because of pain, not because I cannot breathe. No ankle swelling or waking gasping."],
      ["Thromboembolic history", ["clot", "travel", "surgery", "leg"], "No previous clot, recent operation, long journey or one-sided leg swelling."],
      ["Secondary causes", ["kidney", "autoimmune", "cancer", "tuberculosis"], "No kidney disease, cancer, inflammatory arthritis or tuberculosis exposure."],
      ["Medicines and allergies", ["medicine", "allerg", "anticoag", "drug"], "I take no regular medicines or blood thinners and have no known drug allergies."],
      ["NSAID safety", ["ulcer", "bleed", "asthma", "stomach"], "No ulcer or gastrointestinal bleeding. I have taken ibuprofen without asthma or other reactions."],
      ["Exercise and follow-up", ["exercise", "sport", "follow", "home"], "I train for cycling events. I live with my partner and can get an early follow-up appointment."],
      ["Previous episode", ["before", "previous", "recurrent"], "This has never happened before. There is no family history of recurrent inflammation around the heart."]],
    exam: { cv_auscultate: 'Scratchy friction rub along the left sternal border while leaning forward.', pulm_auscultate: 'Lungs clear.' },
    diagnosis: 'Acute uncomplicated pericarditis', synonyms: ['acute pericarditis', 'viral pericarditis', 'pericarditis'], icd10: 'I30.9', disposition: 'discharge',
    vitals: { hr: 88, pain: 5 }, labs: { trop: 4, crp: 33 }, ecg: { params: { rate: 88, rhythm: 'sinus', st: { I: 1, II: 1, aVL: 1, aVF: 1, V3: 1.5, V4: 1.5, V5: 1, V6: 1, aVR: -1 } }, machineRead: 'Diffuse concave ST elevation with reciprocal depression in aVR.', readKeywords: ['pericarditis', 'diffuse st', 'diffuse elevation'] },
    pocus: { cardiac: { text: 'Normal LV function. No effusion or chamber collapse.' } },
    steps: [signed, order('Assess for myocardial involvement', 'trop'), given('Begin anti-inflammatory analgesia', 'ibuprofen')],
    counseling: ['Discuss treatment, exercise restriction and early reassessment', ['colchicine', 'exercise', 'follow-up', 'follow up'], 'Discuss colchicine plus appropriate anti-inflammatory treatment, activity restriction and follow-up within a week.'],
    teaching: 'Typical positional pain, a rub and diffuse ECG changes support pericarditis. Check myocardial injury, effusion and high-risk features before outpatient care.',
    references: ['ESC. Myocarditis and pericarditis guidelines. https://www.escardio.org/news/news-room/congress-news/2025-guidelines-myocarditis-pericarditis/'],
  },
  {
    id: 'vasovagal_syncope', specialty: 'general medicine', age: 23, sex: 'F', difficulty: 1, esi: 3,
    complaint: 'Fainted while watching a blood draw', opening: 'My friend had blood taken. I was standing beside her, then I was on the floor.',
    facts: [['Typical prodrome', ['before', 'warning', 'prodrome', 'feel'], 'I felt hot and nauseated. My ears rang and my vision narrowed.'],
      ['Recovery and cardiac risks', ['after', 'recover', 'family', 'exercise'], 'I woke up as soon as I was flat. No exertional spells, heart trouble or sudden deaths in my family.'],
      ["Trigger and posture", ["trigger", "standing", "blood", "needle"], "I had been standing beside my friend for ten minutes while the nurse struggled with a needle. Blood and needles make me queasy."],
      ["Witnessed event", ["witness", "long", "seconds", "jerk"], "My friend said I went pale, sagged into a chair and was out for about ten seconds. No sustained shaking."],
      ["Recovery detail", ["confusion", "tongue", "wet", "after"], "I knew where I was immediately. No bitten tongue, incontinence, confusion or muscle soreness afterwards."],
      ["Cardiac symptoms", ["chest", "palpitation", "heart", "breath"], "No chest pain, racing heartbeat or breathlessness before or after."],
      ["Injury", ["hurt", "injury", "head", "fall"], "My friend caught my shoulders and helped me down. I did not hit my head."],
      ["Previous faint", ["previous", "before", "similar"], "I fainted once at school during a vaccination. Otherwise this has not happened."],
      ["Intake and bleeding", ["breakfast", "eat", "drink", "bleed"], "I skipped breakfast and had only coffee. No vomiting, diarrhea, black stool or heavy bleeding."],
      ["Family cardiac history", ["family", "sudden", "death", "young"], "No relative died suddenly at a young age or has an inherited heart condition."],
      ["Medicines and substances", ["medicine", "drug", "alcohol", "allerg"], "No regular medicines, recreational drugs or drug allergies. I did not drink alcohol last night."],
      ["Pregnancy possibility", ["pregnan", "period", "contraception"], "My period was normal last week. Pregnancy is unlikely, but I am happy to have a test."],
      ["Home safety", ["home", "drive", "support", "alone"], "My friend can take me home. I feel normal now and do not need to drive myself."]],
    exam: { cv_auscultate: 'Regular rhythm without murmur.', neuro_focal: 'Alert, fluent, no focal findings.' },
    diagnosis: 'Vasovagal syncope', synonyms: ['vasovagal faint', 'vasovagal syncope', 'reflex syncope'], icd10: 'R55', disposition: 'discharge',
    labs: { hcg_u: 'Negative', glu: 94 }, steps: [signed],
    counseling: ['Discuss recognizing the prodrome and lying down', ['lie down', 'lying down', 'sit down', 'counterpressure'], 'Recognize warning symptoms and get safely flat. Reassess for episodes during exertion or without warning.'],
    teaching: 'A clear trigger, prodrome and prompt recovery are characteristic of reflex syncope. Screen for cardiac red flags and examine the ECG.', references: [blackout],
  },
  {
    id: 'symptomatic_aortic_stenosis', specialty: 'cardiology', age: 78, sex: 'M', difficulty: 3, esi: 2,
    complaint: 'Collapsed on a short uphill walk', opening: 'I was carrying groceries up the slope. The next thing I remember is someone helping me up.',
    facts: [['Exertional syncope', ['exert', 'walking', 'before', 'warning'], 'I blacked out while I was still climbing. There was no warning or nausea.'],
      ['Progressive exercise intolerance', ['previous', 'breath', 'chest', 'murmur'], 'I am slower than I was last summer. My doctor once mentioned a murmur.'],
      ["Witness description", ["witness", "seconds", "jerk", "recover"], "A passer-by said I was unconscious for less than a minute. I was clear-headed as soon as I woke, without shaking or tongue injury."],
      ["Previous presyncope", ["previous", "dizzy", "near", "before"], "Twice this month I had to stop on the same hill because I felt light-headed, but this is the first blackout."],
      ["Chest discomfort", ["chest", "pressure", "angina", "pain"], "On hills I sometimes get chest tightness that goes away when I rest. None while lying here."],
      ["Heart failure symptoms", ["orthopnea", "pillow", "ankle", "night"], "No ankle swelling or waking gasping. I sleep on one pillow."],
      ["Prior valve assessment", ["echo", "valve", "letter", "appointment"], "The valve clinic sent a letter eight months ago. I postponed the next appointment because I thought slowing down was just age."],
      ["Medication review", ["medicine", "dose", "tablet", "pressure"], "I take atorvastatin 20 milligrams at night and amlodipine 5 milligrams daily. No water tablets or new dose changes."],
      ["Bleeding and volume losses", ["bleed", "stool", "vomit", "diarrhea"], "No black stool, blood loss, vomiting or diarrhea. I ate and drank normally today."],
      ["Allergies and anticoagulation", ["allerg", "anticoag", "blood thinner"], "No known drug allergies and no blood thinners."],
      ["Neurologic screen", ["weak", "speech", "vision", "numb"], "No new weakness, speech trouble or loss of vision before or after the collapse."],
      ["Injury screen", ["injury", "head", "neck", "hurt"], "I landed on my knee. No head strike, neck pain or severe injury."],
      ["Function and support", ["live", "home", "drive", "independent"], "I live with my spouse and am independent. I still drive, but my spouse can collect the car."]],
    exam: { cv_auscultate: 'Late-peaking harsh systolic ejection murmur radiates to both carotids. Second heart sound soft.', cv_pulses: 'Delayed, low-amplitude carotid upstroke bilaterally.' },
    diagnosis: 'Exertional syncope from severe aortic stenosis', synonyms: ['aortic stenosis', 'aortic valve stenosis'], icd10: 'I35.0',
    disposition: 'admit_telemetry', consultant: 'cards', vitals: { hr: 83, sbp: 112, dbp: 84 }, labs: { glu: 103 },
    items: [{ id: 'valve_letter', kind: 'letter', label: 'Prior echocardiogram letter', where: 'bedside', text: 'Valve clinic summary, eight months ago. Aortic valve area 0.9 cm², mean gradient 42 mmHg. Symptom review and repeat appointment requested.', facts: ['hx2'] }],
    steps: [signed, order('Start cardiac monitoring', 'monitor')],
    teaching: 'Syncope during exertion with a high-grade ejection murmur warrants urgent cardiac assessment and echocardiography.', references: [blackout],
  },
  {
    id: 'atrial_flutter', specialty: 'cardiology', age: 60, sex: 'F', difficulty: 2, esi: 2,
    complaint: 'Fast, steady pounding in the chest', opening: 'My pulse is fast but it ticks along like a clock.',
    facts: [['Uncertain onset', ['when', 'onset', 'duration', 'before'], 'I noticed it this morning, but my watch logged high rates over the past three days.'],
      ['Stability and medications', ['chest pain', 'faint', 'anticoag', 'blood thinner'], 'I feel tired, not faint. No chest pain. I am not on a blood thinner.'],
      ["Symptom duration", ["watch", "three days", "start", "onset"], "The watch showed rates over 140 three evenings ago while I was reading. I dismissed it because I felt all right then."],
      ["Functional impact", ["exercise", "breath", "walk", "fatigue"], "I feel tired and mildly breathless on stairs. At rest I can speak normally."],
      ["Instability screen", ["faint", "chest", "dizzy", "collapse"], "No chest pressure, fainting or near-fainting. I have not felt clammy or confused."],
      ["Previous arrhythmia", ["before", "previous", "rhythm", "heart"], "This is my first diagnosed rhythm problem. No known heart failure or valve disease."],
      ["Vascular risk factors", ["pressure", "diabetes", "stroke", "TIA"], "I have hypertension and type 2 diabetes. I have never had a stroke, mini-stroke or heart attack."],
      ["Medicines", ["medicine", "tablet", "metformin", "amlodipine"], "I take amlodipine 5 milligrams daily and metformin 500 milligrams twice daily. I took both this morning."],
      ["Bleeding screen", ["bleed", "ulcer", "stool", "brain"], "No previous major bleeding, black stool, bleeding ulcer or brain hemorrhage."],
      ["Reversible triggers", ["fever", "thyroid", "infection", "weight"], "No fever, recent infection, weight loss or heat intolerance. I do not take thyroid medicine."],
      ["Alcohol and stimulants", ["alcohol", "coffee", "energy", "drug"], "One coffee a day and a glass of wine on weekends. No energy drinks, decongestants or recreational drugs."],
      ["Anticoagulation and allergy", ["anticoag", "allerg", "blood thinner", "aspirin"], "I do not take anticoagulants or aspirin. No known drug allergies."],
      ["Preferences and support", ["worry", "home", "support", "plan"], "My sister can help with appointments. I want to understand why fixing the pulse might involve a blood thinner."]],
    exam: { cv_auscultate: 'Rapid regular rhythm without murmur.', neck_jvp: 'JVP not raised. No congestion.' },
    diagnosis: 'Atrial flutter with rapid ventricular response', synonyms: ['atrial flutter', 'a flutter', 'flutter with 2:1 conduction'], icd10: 'I48.92',
    disposition: 'admit_telemetry', acceptable: ['observation'], consultant: 'cards', vitals: { hr: 150, sbp: 124, dbp: 81 }, labs: { k: 4.0, mg: 2.0, tsh: 1.62, glu: 142 },
    ecg: { params: { rate: 150, rhythm: 'flutter', qrs: 86 }, machineRead: 'Regular narrow-complex tachycardia with sawtooth atrial activity and 2:1 conduction.', readKeywords: ['flutter', '2:1'] },
    physiology: { effects: [{ tag: 'rate_control', tauMin: 8, maxUnits: 1, delta: { hr: -39, sbp: -5 } }] },
    steps: [signed, order('Monitor the rhythm', 'monitor'), given('Control ventricular rate in this stable patient', 'diltiazem_iv', 'metoprolol_iv', 'metoprolol_po')],
    teaching: 'A regular rate near 150 can reflect flutter with 2:1 conduction. Assess onset and embolic risk before an elective rhythm strategy.',
    references: ['ESC. Supraventricular tachycardia guidelines. https://doi.org/10.1093/eurheartj/ehz467'],
  },
  {
    id: 'symptomatic_pleural_effusion', specialty: 'pulmonology', age: 70, sex: 'F', difficulty: 2, esi: 3,
    complaint: 'Increasing breathlessness over three weeks', opening: 'I used to walk to the shops. Now I get winded just pulling on a sweater.',
    facts: [['Progressive unilateral symptoms', ['when', 'side', 'cough', 'pain'], 'It built up slowly. I feel a heaviness on the right and a dry cough.'],
      ['Systemic clues', ['weight', 'appetite', 'fever', 'smoke'], 'I have lost weight without trying. No fever or chills. I used to smoke.'],
      ["Time course", ["start", "duration", "progress"], "Three weeks ago it was only on the stairs. This week dressing and washing leave me breathless."],
      ["Weight and appetite", ["weight", "appetite", "loss", "eat"], "I have lost about four kilos in two months without trying. Food is less appealing."],
      ["Infection symptoms", ["fever", "chill", "sputum", "night sweat"], "No fever or shaking chills, and the cough is dry. No drenching night sweats."],
      ["Cardiac symptoms", ["flat", "ankle", "heart", "pillow"], "No swollen ankles or waking gasping. Lying flat is uncomfortable because of the heaviness, but I do not need extra pillows."],
      ["Embolic risks", ["clot", "travel", "operation", "leg"], "No prior clot, recent surgery, long journey or one-sided leg swelling."],
      ["Smoking and exposure", ["smok", "asbestos", "occupation", "work"], "I smoked twenty cigarettes daily for thirty years and stopped ten years ago. I worked in an office, with no known asbestos exposure."],
      ["Cancer history", ["cancer", "breast", "screen", "previous"], "I have never been treated for cancer. My last routine breast screen was two years ago."],
      ["Other disease", ["liver", "kidney", "thyroid", "illness"], "No kidney failure, liver disease or known heart failure. I have an underactive thyroid."],
      ["Medicines and bleeding risk", ["medicine", "anticoag", "blood thinner", "levothyroxine"], "I take levothyroxine 75 micrograms each morning. No aspirin or blood thinners."],
      ["Allergies", ["allerg", "reaction", "local anesthetic"], "No known medication or local anesthetic allergy."],
      ["Function and preferences", ["home", "support", "worry", "family"], "My daughter is helping with shopping. I am worried it could be cancer, but I want you to tell me what is actually known."]],
    exam: { pulm_percuss: 'Stony dullness over the lower right hemithorax.', pulm_auscultate: 'Markedly reduced right basal air entry with preserved left-sided breath sounds.', neck_jvp: 'JVP not raised.' },
    diagnosis: 'Large symptomatic right pleural effusion', synonyms: ['pleural effusion', 'unilateral pleural effusion'], icd10: 'J90',
    disposition: 'admit_floor', consultant: 'hosp', vitals: { hr: 103, rr: 23, spo2: 92 },
    imaging: { xr_chest: 'Large right pleural effusion with a meniscus and compressive atelectasis. Left lung clear.' },
    pocus: { ruq: { text: 'Large anechoic space above the right diaphragm with compressed lung moving in the fluid.' } },
    steps: [order('Confirm the effusion with a chest film', 'xr_chest', 'xr_chest_port'), examine('Scan the effusion with bedside ultrasound to plan sampling', 'pocus_ruq')],
    teaching: 'A new symptomatic unilateral effusion warrants investigation and consideration of ultrasound-guided sampling. The cause is unconfirmed until tested.', references: [pleura],
  },
];

// Full encounter details remain case data. These additions use the existing CaseDef schema;
// none changes how other cases are compiled or how the simulation evaluates an action.
export function completeCardiorespiratory(c: CaseDef): void {
  if (!cardiorespiratory.some(b => b.id === c.id)) return;
  const key = (...labels: string[]) => {
    for (const f of c.persona.facts) f.key = labels.includes(f.label ?? '');
  };
  const critical = (id: string, label: string, rule: Rule, teaching?: string) =>
    c.scoring.critical.push({ id, label, rule, points: 6, teaching });
  const focused = (maneuvers: string[]) => {
    c.scoring.critical = c.scoring.critical.filter(x => x.label !== 'Perform the focused examination');
    critical('focused_exam', 'Perform the focused cardiopulmonary assessment', { type: 'exam', maneuvers });
  };
  const counsel = (items: [string, string, string[], string][]) => {
    c.scoring.critical = c.scoring.critical.filter(x => !(x.rule.type === 'counseled' && x.rule.ids.includes('counsel')));
    c.persona.counseling = items.map(([id, label, keywords, description]) => ({ id, label, keywords, description }));
    for (const [id, label] of items) critical(id, label, { type: 'counseled', ids: [id] });
  };
  const prior = (reason: string, summary: string, department = 'Primary care') => {
    c.presentation.encounters = [{ id: `${c.id}_prior`, date: '2026-03-12', type: 'Clinic', department, reason, summary }];
  };
  const unsafeHome = (why: string) => c.scoring.harms.push({ id: 'unsafe_home', label: 'Discharge home without the required inpatient assessment',
    penalty: 16, rule: { type: 'dispo', decisions: ['discharge'] }, teaching: why });
  const handoff = (guard: Rule, criteria: string, note: string) => {
    for (const consult of c.consults) {
      consult.guard = { type: 'any', rules: [{ type: 'escalated' }, guard] };
      consult.criteria = criteria;
      consult.declineHint = 'Describe the urgent concern, examination findings and care already started; ask the attending for help if needed.';
      consult.onAccept.departAfterMin = 25;
      consult.onAccept.note = { title: 'Receiving service handoff', text: note };
    }
  };

  switch (c.id) {
    case 'congestive_heart_failure': {
      key('Orthopnea and weight gain', 'Medication access', 'Ischemia screen', 'Infection screen', 'Regular medicines', 'Practical discharge barriers');
      c.persona.personality = 'Independent retired shopkeeper, embarrassed about the uncollected prescription and worried about losing independence.';
      c.persona.voice = 'Short phrases while breathless; clear, practical answers when allowed time.';
      c.persona.behavior = ['Describe symptoms before arrival when asked about the history. Do not invent urine volumes or claim the lungs are clear after a single tablet.', 'Explain the refill barrier without implying deliberate nonadherence.'];
      c.presentation.documentedHomeMeds = [
        { name: 'Furosemide', dose: '20 mg', sig: 'PO each morning', lastTaken: 'Five days ago; refill not collected' },
        { name: 'Bisoprolol', dose: '2.5 mg', sig: 'PO daily', lastTaken: 'This morning' },
        { name: 'Ramipril', dose: '5 mg', sig: 'PO daily', lastTaken: 'This morning' },
      ];
      c.presentation.problemList = ['Heart failure with reduced ejection fraction', 'Hypertension', 'Chronic kidney disease G3a'];
      prior('Heart failure follow-up', 'LVEF 35% on prior echocardiogram. Euvolemic at last review. Spironolactone stopped after hyperkalemia. Medication optimization and renal monitoring planned.', 'Heart failure clinic');
      c.presentation.priorLabs = [{ analyte: 'creat', value: 1.1, daysAgo: 30 }, { analyte: 'k', value: 4.5, daysAgo: 30 }];
      Object.assign(c.labs, { na: 136, k: 4.4, cl: 100, hco3: 24, bun: 29, mg: 2.0, wbc: 8.2, hgb: 12.4, lactate: 1.4,
        trop: { kind: 'series', points: [[0, 13], [60, 14], [180, 13]] } });
      Object.assign(c.exam, { gen_mental: 'Alert and oriented; anxious about breathing.', skin_capref: 'Warm extremities, capillary refill 2 seconds.',
        cv_auscultate: 'Regular tachycardia with an S3. No new loud murmur.',
        pulm_effort: [{ when: { var: 'rr', op: '<', value: 23 }, text: 'Less work of breathing; can finish a sentence, but remains mildly tachypneic.' }, { text: 'Upright posture with tachypnea; pauses during longer sentences.' }] });
      c.physiology.drift = { rr: 0.6, spo2: -0.4 };
      c.physiology.limits = { rr: [16, 32], spo2: [84, 97], hr: [70, 125], sbp: [100, 190] };
      c.physiology.effects = [
        { tag: 'oxygen', tauMin: 3, maxUnits: 1, delta: { spo2: 5 } },
        { tag: 'high_flow_oxygen', tauMin: 2, maxUnits: 1, delta: { spo2: 7 } },
        { tag: 'diuretic', onsetMin: 10, tauMin: 40, maxUnits: 1, delta: { rr: -5, spo2: 2, hr: -7 }, driftMult: { rr: 0, spo2: 0 } },
        { tag: 'fluids', tauMin: 12, maxUnits: 2, delta: { rr: 2, spo2: -2 } },
      ];
      c.scoring.critical = c.scoring.critical.map(x => x.rule.type === 'order' && x.rule.codes.includes('o2_nc') ? { ...x, rule: { type: 'order', codes: ['o2_nc', 'oxygen_nrb'] } } : x);
      focused(['pulm_auscultate', 'neck_jvp']);
      critical('electrolytes', 'Check renal function and electrolytes before ongoing diuresis', { type: 'order', codes: ['bmp', 'cmp'] });
      critical('monitor', 'Monitor oxygenation and heart rhythm', { type: 'order', codes: ['monitor'] });
      counsel([['access_plan', 'Address access to regular medication', ['delivery', 'pharmacy', 'refill', 'niece'], 'Agree how the refill will be obtained and who will help; avoid blaming the patient.']]);
      c.scoring.harms.push({ id: 'unnecessary_bolus', label: 'Give a large crystalloid bolus despite congestion and adequate pressure', penalty: 10,
        rule: { type: 'given', tags: ['fluids'], minTotalMl: 1000 }, teaching: 'This patient is congested and hypertensive. Routine large fluid boluses can worsen respiratory distress.' });
      unsafeHome('A new oxygen requirement and decompensated congestion require monitored treatment and reassessment.');
      handoff({ type: 'exam', maneuvers: ['pulm_auscultate', 'neck_jvp'] }, 'Accept suspected decompensated heart failure with hypoxemia and clinical congestion. Early consultation is appropriate while investigations and treatment proceed.',
        'Admit for diuresis, renal and electrolyte monitoring, and reassessment of oxygen needs. Reconcile chronic heart failure therapy and arrange reliable prescription access.');
      c.teaching = ['Recognize congestion from the history and examination; check for ischemia, infection and medication interruption.', 'Treat hypoxemia and give an IV loop diuretic, then reassess symptoms, perfusion, renal function and electrolytes.', 'Medication access is part of the care plan. Do not interpret a missed refill as a diagnosis of nonadherence.'];
      break;
    }
    case 'hypoxemic_lobar_pneumonia': {
      key('Acute febrile cough', 'Baseline function', 'Intake and urine', 'Mental state', 'Resistance risk', 'Allergy history');
      c.persona.personality = 'Usually active dog owner who is surprised by how quickly his stamina has fallen.';
      c.persona.voice = 'Breathless but coherent; answers a question before returning to the cough.';
      c.persona.behavior = ['Describe sputum and timing when asked, without naming an organism or assuming the X-ray diagnosis.'];
      c.presentation.documentedHomeMeds = [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily', lastTaken: 'This morning' }];
      c.presentation.problemList = ['Hypertension', 'Former smoker'];
      prior('Blood pressure review', 'Independent and active, normal resting oxygen saturation. No chronic respiratory disease or recent hospital admission.');
      Object.assign(c.labs, { hgb: 13.6, plt: 248, neut: 83, bands: 3, lymph: 9, mono: 4, eos: 1, na: 134, k: 4.1, cl: 99, hco3: 23, creat: 1.0, mg: 1.9 });
      Object.assign(c.exam, { gen_mental: 'Oriented and attentive; no new confusion.', skin_capref: 'Warm hands, capillary refill 2 seconds.', cv_auscultate: 'Regular tachycardia without murmur.', cv_edema: 'No peripheral edema.' });
      c.physiology.drift = { rr: 0.5, spo2: -0.4 };
      c.physiology.limits = { spo2: [84, 97], rr: [16, 32], hr: [78, 125], temp: [37, 39.4] };
      c.physiology.effects = [
        { tag: 'oxygen', maxUnits: 1, tauMin: 3, delta: { spo2: 6, rr: -3 } },
        { tag: 'high_flow_oxygen', maxUnits: 1, tauMin: 2, delta: { spo2: 8, rr: -3 } },
        { tag: 'antipyretic', tauMin: 20, durationMin: 240, maxUnits: 1, delta: { temp: -0.7, hr: -5 } },
        { tag: 'analgesic_mild', tauMin: 20, durationMin: 180, maxUnits: 1, delta: { pain: -2 } },
        { tag: 'analgesic', tauMin: 6, durationMin: 100, maxUnits: 1, delta: { pain: -3 } },
        // Early antibiotics curb progression; they do not clear consolidation during a short ED stay.
        { tag: 'abx_ceftriaxone', onsetMin: 90, tauMin: 120, maxUnits: 1, driftMult: { rr: 0, spo2: 0 } },
        { tag: 'abx_ampsulb', onsetMin: 90, tauMin: 120, maxUnits: 1, driftMult: { rr: 0, spo2: 0 } },
      ];
      c.scoring.critical = c.scoring.critical.map(x => {
        if (x.rule.type === 'order' && x.rule.codes.includes('o2_nc')) return { ...x, rule: { type: 'order', codes: ['o2_nc', 'oxygen_nrb'] } };
        if (x.rule.type === 'given' && x.rule.codes?.includes('azithromycin')) return { ...x, label: 'Add appropriate atypical coverage', rule: { type: 'given', codes: ['azithromycin', 'doxycycline'] } };
        return x;
      });
      focused(['pulm_auscultate', 'gen_mental']);
      critical('renal', 'Check blood count and renal function for severity and treatment planning', { type: 'all', rules: [{ type: 'order', codes: ['cbc'] }, { type: 'order', codes: ['bmp', 'cmp'] }] });
      critical('oxygen_monitor', 'Monitor the new oxygen requirement', { type: 'order', codes: ['monitor', 'vitals_q15'] });
      unsafeHome('The new oxygen requirement and marked loss of function make immediate home treatment unsuitable.');
      handoff({ type: 'exam', maneuvers: ['pulm_auscultate'] }, 'Accept suspected pneumonia with hypoxemia. Treatment should start promptly; do not insist that every result is back before accepting.',
        'Admit for oxygen, empiric inpatient antibiotics and clinical reassessment. Review response, microbiology if indicated and suitability for oral step-down.');
      c.teaching = ['Assess oxygenation, mentation, perfusion, renal function and baseline independence together.', 'Use an appropriate inpatient antibiotic regimen, adjusted for allergies, resistance risks and local policy.', 'Persistent consolidation and oxygen need do not disappear immediately after the first antibiotic dose.'];
      c.references.push('NICE NG250. Pneumonia: diagnosis and management. https://www.nice.org.uk/guidance/ng250/chapter/Recommendations');
      break;
    }
    case 'acute_bronchitis': {
      key('Postviral cough', 'No respiratory compromise', 'Pertussis screen', 'Asthma screen', 'Background health', 'Patient concern');
      c.persona.personality = 'Parent keen to return to work, worried that declining antibiotics means the cough has been dismissed.';
      c.persona.voice = 'Conversational, interrupted by occasional cough.';
      c.persona.behavior = ['Ask why green sputum does not automatically need an antibiotic, then accept a clear explanation and safety net.', 'Do not invent fever, hypoxia or immunosuppression to justify a treatment.'];
      prior('Routine preventive visit', 'No chronic cardiopulmonary disease, immunosuppression or regular medication.');
      Object.assign(c.exam, { gen_appearance: 'Well, hydrated and not distressed.', heent_mucosa: 'Moist mucosa; mild residual pharyngeal erythema without exudate.', cv_auscultate: 'Regular rhythm, no murmur.' });
      c.labs = { wbc: 7.1, hgb: 12.9, crp: 3, creat: 0.8 };
      c.imaging.xr_chest = { findings: 'Clear lungs without focal airspace opacity, pleural fluid or pneumothorax.', impression: 'No acute cardiopulmonary abnormality.' };
      c.physiology.drift = {};
      counsel([
        ['course', 'Explain the expected cough duration and antibiotic decision', ['weeks', 'viral', 'antibiotic', 'virus'], 'Explain that an uncomplicated cough can persist for weeks and antibiotics are not routinely helpful.'],
        ['return', 'Give specific respiratory return precautions', ['breathless', 'blood', 'fever', 'worse'], 'Seek reassessment for worsening breathlessness, hemoptysis, new persistent fever or failure to improve.'],
      ]);
      c.teaching = ['Reassuring vitals and absence of focal lung findings reduce concern for pneumonia in this otherwise healthy adult.', 'Sputum color alone is not a bacterial diagnosis.', 'Provide symptom advice and a clear safety net without unnecessary antibiotics or routine imaging.'];
      break;
    }
    case 'secondary_spontaneous_pneumothorax': {
      key('Abrupt pleuritic pain', 'Underlying lung disease', 'Baseline respiratory reserve', 'Trauma and procedures', 'Perfusion symptoms', 'COPD treatment');
      c.persona.personality = 'Experienced with COPD breathlessness but frightened because this episode is abrupt and painful.';
      c.persona.voice = 'Brief sentences, cooperative and visibly anxious.';
      c.persona.behavior = ['Distinguish the sudden episode from usual exertional breathlessness. Do not claim a chest drain has been inserted unless the game reports it.'];
      c.presentation.documentedHomeMeds = [{ name: 'Tiotropium', dose: '18 micrograms', sig: 'Inhaled once daily' }, { name: 'Salbutamol', dose: '100 micrograms per puff', sig: '1–2 puffs as needed', lastTaken: 'Two puffs before calling ambulance, without benefit' }];
      prior('COPD follow-up', 'Emphysema; FEV1 46% predicted. Resting SpO2 94% on room air, no home oxygen. Smoking cessation maintained.', 'Respiratory clinic');
      Object.assign(c.labs, { wbc: 8.4, hgb: 14.2, plt: 232, na: 138, k: 4.1, hco3: 27, creat: 0.9, lactate: 1.6 });
      Object.assign(c.exam, { gen_mental: 'Alert, no confusion.', skin_capref: 'Warm hands, capillary refill 2 seconds.', neck_jvp: 'Not elevated; trachea central.', cv_auscultate: 'Regular tachycardia. No muffling of heart sounds.' });
      c.physiology.drift = { rr: 0.5 };
      c.physiology.limits = { rr: [18, 32], spo2: [86, 92], hr: [85, 125] };
      c.physiology.effects = [...c.physiology.effects,
        { tag: 'oxygen', maxUnits: 1, tauMin: 3, delta: { spo2: 3 } },
        { tag: 'high_flow_oxygen', maxUnits: 1, tauMin: 2, delta: { spo2: 3 } },
      ];
      focused(['pulm_auscultate', 'pulm_effort']);
      critical('monitor', 'Monitor oxygenation and repeat vital signs', { type: 'order', codes: ['monitor', 'vitals_q15'] });
      counsel([['drain_plan', 'Explain the need for urgent pleural assessment', ['drain', 'chest tube', 'collapsed lung', 'pleural'], 'Explain that oxygen does not remove pleural air and an experienced team must assess pleural drainage.']]);
      unsafeHome('Symptomatic secondary pneumothorax with poor respiratory reserve requires hospital assessment and monitoring.');
      handoff({ type: 'exam', maneuvers: ['pulm_auscultate', 'pulm_effort'] }, 'Accept a symptomatic secondary pneumothorax for urgent respiratory assessment and consideration of pleural drainage. Escalate immediately if tension physiology develops.',
        'Accept for monitored respiratory care and urgent pleural procedure assessment. A drain has not yet been inserted in the ED.');
      c.teaching = ['Reduced reserve makes secondary pneumothorax different from a minimally symptomatic primary pneumothorax.', 'Monitor for worsening respiratory or circulatory compromise; do not wait for imaging if tension is suspected.', 'Discuss an individualized oxygen target; this COPD patient needs controlled oxygen and blood-gas reassessment if oxygen is required.', 'Pleural drainage is a receiving-team plan in this simulation; handing over does not mean the lung has already re-expanded.'];
      break;
    }
    case 'isolated_rib_fracture': {
      key('Localized direct blow', 'Complication screen', 'Bleeding risk', 'Analgesia already tried', 'Analgesic contraindications', 'Cough and lung expansion');
      c.persona.personality = 'Practical recreational swimmer who wants enough pain relief to sleep and breathe normally.';
      c.persona.voice = 'Comfortable at rest; pauses before a cough.';
      c.persona.behavior = ['Describe the low-energy mechanism accurately. Do not add an unwitnessed blackout or new abdominal pain.'];
      prior('Routine health review', 'No chronic lung disease, anticoagulation, renal impairment or peptic ulcer history.');
      Object.assign(c.exam, { skin_inspect: 'Small right lateral chest bruise; no wound or extensive bruising.', skin_capref: 'Warm, capillary refill under 2 seconds.',
        pulm_effort: [{ when: { var: 'pain', op: '<', value: 4 }, text: 'Comfortable deep inspiration and effective cough after analgesia; no paradoxical movement.' }, { text: 'Focal right lateral tenderness and pain on deep inspiration; no flail segment or respiratory distress.' }] });
      focused(['pulm_effort', 'pulm_auscultate', 'abd_palpate']);
      counsel([
        ['breathing', 'Explain breathing exercises and effective cough', ['deep breath', 'cough', 'breathe deeply'], 'Use adequate analgesia to allow regular deep breaths and cough; avoid tight chest binding.'],
        ['return', 'Explain signs of a chest or abdominal complication', ['breathless', 'blood', 'fever', 'abdominal pain'], 'Seek reassessment for new dyspnea, hemoptysis, fever or abdominal pain.'],
      ]);
      c.teaching = ['Check for associated chest and abdominal injury, not just the painful rib.', 'Analgesia should restore useful breathing and coughing.', 'A stable isolated fracture can be managed at home with support and specific return precautions.'];
      break;
    }
    case 'low_risk_pericarditis': {
      key('Positional pleuritic pain', 'Risk review', 'Perfusion and rhythm screen', 'Secondary causes', 'NSAID safety', 'Exercise and follow-up');
      c.persona.personality = 'Amateur cyclist worried about missing an event and concerned that any chest pain means a heart attack.';
      c.persona.voice = 'Clear, thoughtful, more comfortable leaning forward.';
      c.persona.behavior = ['Ask about returning to training. Do not assume normal troponin or imaging before the clinician explains the results.'];
      prior('Sports health review', 'No cardiovascular disease, regular medication, renal disease or gastrointestinal bleeding.');
      Object.assign(c.labs, { wbc: 9.3, hgb: 14.4, plt: 251, na: 139, k: 4.2, cl: 103, hco3: 25, bun: 13, creat: 0.9, mg: 2.0,
        trop: { kind: 'series', points: [[0, 4], [60, 4], [180, 4]] } });
      Object.assign(c.exam, { gen_appearance: 'Comfortable sitting forward, no respiratory distress.', neck_jvp: 'Normal JVP.', skin_capref: 'Warm peripheries with brisk refill.', cv_edema: 'No edema.' });
      c.imaging.xr_chest = { findings: 'Normal heart size and clear lungs. No pleural fluid.', impression: 'No acute chest abnormality.' };
      focused(['cv_auscultate', 'neck_jvp']);
      critical('effusion', 'Assess for effusion and ventricular function with bedside ultrasound', { type: 'exam', maneuvers: ['pocus_cardiac'] }, 'The cardiac ultrasound view records the bedside assessment; the checklist does not verify interpretation.');
      counsel([
        ['therapy', 'Explain the planned anti-inflammatory and colchicine course', ['colchicine', 'anti-inflammatory', 'ibuprofen', 'aspirin'], 'Discuss anti-inflammatory treatment, gastroprotection as appropriate, and adjunctive colchicine after checking contraindications.'],
        ['activity', 'Restrict strenuous exercise during active inflammation', ['exercise', 'training', 'cycling', 'sport'], 'Explain temporary exercise restriction and clinician-guided return after recovery.'],
        ['followup', 'Arrange early review and urgent return precautions', ['follow-up', 'follow up', 'review', 'faint', 'breathless'], 'Arrange review within a week and urgent reassessment for syncope, increasing dyspnea or worsening symptoms.'],
      ]);
      c.teaching = ['Use the history, rub, ECG and investigations together; exclude myocardial involvement and high-risk features.', 'Uncomplicated pericarditis is generally treated with an NSAID or aspirin plus colchicine after safety checks.', 'Colchicine and a full outpatient prescription course are discussed here; the medication catalog cannot currently administer colchicine.', 'Exercise restriction and early follow-up are part of treatment, not optional reassurance.'];
      c.references = ['ACC. 2025 expert consensus on diagnosis and management of pericarditis. https://www.jacc.org/doi/10.1016/j.jacc.2025.05.023'];
      break;
    }
    case 'vasovagal_syncope': {
      key('Typical prodrome', 'Recovery and cardiac risks', 'Trigger and posture', 'Witnessed event', 'Recovery detail', 'Cardiac symptoms', 'Family cardiac history');
      c.persona.personality = 'Embarrassed about fainting beside a friend and keen to avoid unnecessary admission.';
      c.persona.voice = 'Normal conversational speech, now fully recovered.';
      c.persona.behavior = ['Distinguish the witnessed brief faint from a seizure. Report what the friend said as collateral, not as a personal memory of unconsciousness.'];
      prior('Preventive review', 'Remote history of a brief vaccination-associated faint in adolescence with prompt recovery. No exertional events or known cardiac disease.');
      Object.assign(c.exam, { gen_mental: 'Fully alert and attentive; recalls events before and after the brief loss of consciousness.', skin_capref: 'Warm, capillary refill under 2 seconds.', neuro_gait: 'Steady unaided gait without dizziness.' });
      c.ecg = { params: { rate: 76, rhythm: 'sinus', pr: 156, qrs: 84, qt: 366 }, machineRead: 'Sinus rhythm. Normal intervals. No pre-excitation, ischemic change or conduction block.', readKeywords: ['sinus', 'normal'] };
      c.physiology.baseline.hr = 76;
      c.presentation.triageVitals.hr = 76;
      c.physiology.drift = {};
      focused(['cv_auscultate', 'neuro_focal']);
      counsel([
        ['prodrome', 'Explain the faint and how to respond to warning symptoms', ['lie down', 'lying down', 'counterpressure', 'sit down'], 'Explain the trigger and advise getting safely flat at the prodrome; discuss counterpressure maneuvers if there is time.'],
        ['safety', 'Explain when another episode needs reassessment', ['exercise', 'palpitation', 'without warning', 'chest pain'], 'Seek prompt reassessment for exertional or unheralded collapse, chest pain or palpitations.'],
      ]);
      c.scoring.lowValue.push({ codes: ['ct_head'], penalty: 4, why: 'There was no head injury, persistent altered state or focal neurologic finding to justify routine head CT.' });
      c.teaching = ['A witnessed trigger, autonomic prodrome and rapid complete recovery support reflex syncope.', 'History, examination and ECG must still screen for a cardiac cause.', 'Avoid routine brain imaging in a clear uncomplicated faint without neurologic or trauma indications.'];
      break;
    }
    case 'symptomatic_aortic_stenosis': {
      key('Exertional syncope', 'Progressive exercise intolerance', 'Previous presyncope', 'Chest discomfort', 'Prior valve assessment', 'Medication review');
      c.persona.personality = 'Independent older adult who has normalized declining stamina and postponed follow-up.';
      c.persona.voice = 'Measured, initially minimizing symptoms, more candid when asked about the hill.';
      c.persona.behavior = ['Do not volunteer exact valve gradients from memory; the letter contains the figures.', 'Acknowledge exertional symptoms when asked directly rather than claiming the collapse was merely dehydration.'];
      c.presentation.documentedHomeMeds = [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily' }, { name: 'Atorvastatin', dose: '20 mg', sig: 'PO nightly' }];
      c.presentation.problemList = ['Aortic stenosis under valve-clinic follow-up', 'Hypertension', 'Hyperlipidemia'];
      c.presentation.encounters = [{ id: 'prior_valve_echo', date: '2026-03-12', type: 'Clinic', department: 'Valve clinic', reason: 'Aortic stenosis surveillance', summary: 'Aortic valve area 0.9 cm² and mean gradient 42 mmHg. LV systolic function preserved. Follow-up requested; patient later postponed appointment.' }];
      Object.assign(c.labs, { hgb: 13.3, hct: 40, rbc: 4.44, mcv: 90, wbc: 7.4, plt: 220, na: 138, k: 4.2, cl: 103, hco3: 25, bun: 20, creat: 1.0, trop: 12 });
      Object.assign(c.exam, { gen_mental: 'Alert and oriented with complete recovery.', pulm_auscultate: 'Clear lungs.', neuro_focal: 'No focal deficit.', skin_capref: 'Warm peripheries with capillary refill 2 seconds.' });
      c.ecg = { params: { rate: 83, rhythm: 'sinus', pr: 188, qrs: 96 }, machineRead: 'Sinus rhythm. No acute ST elevation or high-grade AV block.', readKeywords: ['sinus', 'normal'] };
      c.pocus = { cardiac: { text: 'Preserved global LV systolic function with a visibly thickened aortic valve. This limited scan cannot quantify valve stenosis; formal echocardiography is required.' } };
      c.physiology.drift = {};
      focused(['cv_auscultate', 'cv_pulses']);
      critical('fall', 'Protect against another collapse while awaiting assessment', { type: 'order', codes: ['fall_precautions'] });
      counsel([['valve_plan', 'Explain the need for urgent valve assessment and activity precautions', ['valve', 'echo', 'exertion', 'driving', 'cardiology'], 'Explain the association between exertional collapse and valve disease; avoid exertion and driving until specialist advice.']]);
      unsafeHome('Exertional syncope with documented severe valve disease needs urgent monitored cardiac assessment in this encounter.');
      handoff({ type: 'all', rules: [{ type: 'exam', maneuvers: ['cv_auscultate'] }, { type: 'ecg_signed' }] }, 'Accept exertional syncope with a high-grade murmur or the prior severe valve measurements. Arrange formal echocardiography and valve-team assessment.',
        'Admit to telemetry for syncope assessment, formal echocardiography and valve-team review. Avoid unassisted exertion. No valve intervention has yet occurred.');
      c.teaching = ['Syncope during exertion is a cardiac warning sign, especially with a characteristic murmur.', 'A reassuring resting blood pressure does not remove the risk from symptomatic severe valve disease.', 'Bedside ultrasound supports assessment but does not replace a formal Doppler valve study.'];
      c.references.push('NICE NG208. Heart valve disease. https://www.nice.org.uk/guidance/ng208/chapter/recommendations');
      break;
    }
    case 'atrial_flutter': {
      key('Uncertain onset', 'Stability and medications', 'Symptom duration', 'Vascular risk factors', 'Bleeding screen', 'Anticoagulation and allergy');
      c.persona.personality = 'Attentive office manager who trusts the watch timestamps and wants a clear explanation of stroke prevention.';
      c.persona.voice = 'Clear sentences despite a rapid pulse; mildly worried.';
      c.persona.behavior = ['Do not equate noticing symptoms this morning with a proven short arrhythmia duration.', 'Ask about the reason for anticoagulation and bleeding precautions.'];
      c.presentation.documentedHomeMeds = [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily' }, { name: 'Metformin', dose: '500 mg', sig: 'PO twice daily with food' }];
      c.presentation.problemList = ['Hypertension', 'Type 2 diabetes'];
      prior('Diabetes and blood pressure review', 'No prior stroke, heart failure, significant valve disease or major bleeding. Renal function normal.');
      Object.assign(c.labs, { na: 138, cl: 102, hco3: 24, bun: 16, creat: 0.9, hgb: 13.1, plt: 246, wbc: 7.8, trop: 8 });
      c.pocus = { cardiac: { text: 'Preserved gross LV function, no large effusion or marked RV dilation.' } };
      Object.assign(c.exam, { gen_mental: 'Alert, attentive and fully oriented.', skin_capref: 'Warm hands and capillary refill 2 seconds.', pulm_auscultate: 'Clear lungs.', cv_edema: 'No peripheral edema.' });
      c.physiology.limits = { hr: [70, 160], sbp: [95, 145] };
      focused(['cv_auscultate', 'pulm_auscultate']);
      critical('electrolytes', 'Check electrolytes and renal function', { type: 'order', codes: ['bmp', 'cmp'] });
      critical('anticoagulation', 'Start anticoagulation after the bleeding and renal assessment', { type: 'given', codes: ['apixaban', 'heparin'] }, 'Hypertension and diabetes increase thromboembolic risk. Anticoagulation choices require individual safety checks.');
      counsel([
        ['stroke_prevention', 'Explain stroke prevention and bleeding precautions', ['stroke', 'anticoag', 'blood thinner', 'bleeding'], 'Discuss why anticoagulation is offered and what bleeding symptoms require help.'],
        ['rhythm_plan', 'Explain why elective cardioversion needs a thromboembolic plan', ['cardioversion', 'thrombus', 'clot', 'three weeks', 'duration'], 'The onset is uncertain and likely beyond 48 hours. Discuss anticoagulation or imaging before elective rhythm restoration; instability would change urgency.'],
      ]);
      handoff({ type: 'ecg_signed' }, 'Accept confirmed atrial flutter with persistent rapid response for monitored rate control and a stroke-prevention/rhythm plan. Early consultation is appropriate.',
        'Accept to monitored care. Continue rate control with blood-pressure checks, assess anticoagulation and plan rhythm management after addressing uncertain duration and thromboembolic risk.');
      c.teaching = ['A regular ventricular rate near 150 should prompt a search for flutter waves.', 'Separate stability, rate control, stroke prevention and elective rhythm restoration into distinct decisions.', 'This patient has hypertension and diabetes, no reported major bleeding and normal renal function; anticoagulation is appropriate after assessment.', 'The case models slowing the ventricular response, not conversion to sinus rhythm.'];
      c.references.push('ACC/AHA/ACCP/HRS. 2023 atrial fibrillation guideline, including typical flutter. https://www.jacc.org/doi/10.1016/j.jacc.2023.08.017');
      break;
    }
    case 'symptomatic_pleural_effusion': {
      key('Progressive unilateral symptoms', 'Systemic clues', 'Weight and appetite', 'Infection symptoms', 'Cardiac symptoms', 'Medicines and bleeding risk');
      c.persona.personality = 'Retired administrator who fears malignancy but wants uncertainty explained honestly.';
      c.persona.voice = 'Soft, coherent speech; pauses after longer answers.';
      c.persona.behavior = ['Ask what fluid around the lung means without declaring a cancer diagnosis.', 'Describe progressive limitation and weight loss accurately; do not invent a prior biopsy result.'];
      c.presentation.documentedHomeMeds = [{ name: 'Levothyroxine', dose: '75 micrograms', sig: 'PO each morning' }];
      c.presentation.problemList = ['Primary hypothyroidism', 'Former smoker'];
      prior('Thyroid review', 'Clinically euthyroid, no prior pleural disease. Weight stable at that visit; no history of heart failure, cirrhosis or renal failure.');
      Object.assign(c.labs, { wbc: 7.9, hgb: 11.8, hct: 35.4, rbc: 4.0, mcv: 89, plt: 330, crp: 18, na: 137, k: 4.1, cl: 102, hco3: 25, bun: 17, creat: 0.9, alb: 3.6, tsh: 2.1, inr: 1.0 });
      Object.assign(c.exam, { gen_mental: 'Alert and oriented.', pulm_effort: 'Reduced right basal expansion; mildly tachypneic but not exhausted.', cv_edema: 'No edema.', skin_capref: 'Warm, capillary refill 2 seconds.' });
      c.physiology.drift = {};
      c.physiology.limits = { spo2: [90, 97], rr: [16, 28] };
      c.physiology.effects = [{ tag: 'oxygen', maxUnits: 1, tauMin: 3, delta: { spo2: 3 } }];
      focused(['pulm_auscultate', 'pulm_percuss']);
      critical('bloods', 'Check blood count and renal function before procedural planning', { type: 'all', rules: [{ type: 'order', codes: ['cbc'] }, { type: 'order', codes: ['bmp', 'cmp'] }] });
      counsel([['uncertainty', 'Explain sampling, procedural planning and diagnostic uncertainty', ['sample', 'drain', 'fluid', 'cytology', 'cause'], 'Explain ultrasound-guided fluid sampling and likely further investigation. Cancer is one possibility, not an established diagnosis.']]);
      handoff({ type: 'exam', maneuvers: ['pulm_auscultate', 'pulm_percuss'] }, 'Accept a new large unilateral effusion with substantial functional limitation for respiratory assessment and ultrasound-guided diagnostic/therapeutic procedure planning.',
        'Accept for pleural service assessment, ultrasound-guided sampling and further investigation of the cause. No pleural sample or drainage has yet been performed.');
      c.teaching = ['A unilateral effusion with weight loss needs investigation; do not label it malignant before evidence is available.', 'Ultrasound guides procedural planning, while fluid analysis and further imaging help establish the cause.', 'Sampling and drainage are receiving-team plans here; neither is represented as an already completed ED procedure.'];
      break;
    }
  }
  const outcomes: Record<string, [good: string, bad: string]> = {
    congestive_heart_failure: [
      'The receiving team continues monitored decongestion, renal and electrolyte checks, and a practical plan to obtain regular medication. Oxygen requirements and congestion still need reassessment.',
      'Congestion, oxygen needs or the prescription-access problem remain insufficiently addressed, leaving a risk of deterioration or another avoidable admission.',
    ],
    hypoxemic_lobar_pneumonia: [
      'The patient is handed over for oxygen, appropriate antibiotics and reassessment of respiratory function, intake and treatment response. Recovery from pneumonia will require ongoing care.',
      'Hypoxemia or antimicrobial treatment remains inadequately addressed, or the patient is sent home despite a new oxygen requirement and major functional decline.',
    ],
    acute_bronchitis: [
      'The patient leaves with an explanation of the likely cough course, symptom advice and clear reasons to return. Antibiotics are avoided in this uncomplicated presentation.',
      'The patient leaves without a clear explanation or safety net, or receives unnecessary treatment while concerns about persistent cough remain unresolved.',
    ],
    secondary_spontaneous_pneumothorax: [
      'The patient remains under monitored care with urgent pleural-service assessment arranged. The handoff identifies the need to assess drainage; it does not imply that the lung has already re-expanded.',
      'A symptomatic secondary pneumothorax is left without adequate monitoring or a timely pleural-management plan, leaving limited respiratory reserve unprotected.',
    ],
    isolated_rib_fracture: [
      'Home care is planned after assessment for associated injury, with analgesia to support deep breathing and cough, practical help and specific return precautions.',
      'Pain limits breathing or the plan omits associated-injury assessment and warning signs, leaving preventable pulmonary complications or missed injury insufficiently addressed.',
    ],
    low_risk_pericarditis: [
      'Outpatient care is planned after assessment for higher-risk features, with anti-inflammatory treatment, a colchicine plan, activity advice and early review. Recurrent or worsening symptoms require reassessment.',
      'The patient leaves without adequate risk assessment or a complete treatment and follow-up plan; persistent inflammation, recurrence or an overlooked complication remains a concern.',
    ],
    vasovagal_syncope: [
      'The recovered patient has a witness-supported explanation of the faint, a reviewed ECG and advice about triggers, warning symptoms and future episodes that need assessment.',
      'The episode is dismissed without adequate cardiac-risk assessment or safety advice, or an uncomplicated faint leads to unnecessary investigation without a useful explanation.',
    ],
    symptomatic_aortic_stenosis: [
      'The patient is handed over for monitored syncope assessment, formal echocardiography and valve-team review, with precautions against another exertional collapse. Definitive valve treatment is still pending.',
      'Exertional collapse and severe valve disease are not connected to an urgent cardiac plan, leaving the patient at risk during further exertion or unsupported discharge.',
    ],
    atrial_flutter: [
      'Monitored care continues with a rate-control strategy, assessment of anticoagulation safety and a rhythm plan that accounts for uncertain duration. Slower pulse alone is not conversion to sinus rhythm.',
      'Rate control, stroke prevention or the thromboembolic precautions for elective rhythm restoration remain incomplete despite identification of flutter.',
    ],
    symptomatic_pleural_effusion: [
      'The receiving team plans ultrasound-guided pleural assessment, sampling and symptom management. The cause remains unconfirmed and requires follow-through after the ED handoff.',
      'The new unilateral effusion and functional decline lack a timely investigation plan, or an unproven cause is presented as certain before sampling and further assessment.',
    ],
  };
  [c.truth.outcomeGood, c.truth.outcomeBad] = outcomes[c.id];
}
