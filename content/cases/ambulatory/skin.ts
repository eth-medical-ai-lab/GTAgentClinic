import type { CaseBrief } from '../brief';
import { examine, given, order, viralStewardship } from './checkpoints';

const skinInfection = 'IDSA. Skin and soft tissue infections. https://www.idsociety.org/practice-guideline/skin-and-soft-tissue-infections/';
const soreThroat = 'NICE NG84. Acute sore throat. https://www.nice.org.uk/guidance/ng84';

export const skin: CaseBrief[] = [
  {
    id: 'leg_cellulitis', walkToBed: true, specialty: 'infectious diseases', age: 46, sex: 'M', difficulty: 1, esi: 4,
    complaint: 'A spreading warm patch on the shin', opening: 'The red patch was the size of a coin yesterday. Should I draw a line around it?',
    facts: [['Portal of entry', ['wound', 'skin', 'cut', 'injury'], 'I scratched my shin moving boxes a few days ago.'],
      ['Absence of toxicity', ['fever', 'chills', 'well', 'pain'], 'No chills or fever. It is sore to touch, but I can walk normally.']],
    exam: { skin_inspect: 'Unilateral tender warm erythema around a small healing abrasion. No fluctuance, bullae, crepitus or necrosis.', skin_capref: 'Brisk refill distally.' },
    diagnosis: 'Nonpurulent cellulitis of the left lower leg', synonyms: ['cellulitis', 'erysipelas'], icd10: 'L03.116', disposition: 'discharge', vitals: { pain: 3 },
    steps: [examine('Check the skin and distal perfusion', 'skin_inspect', 'skin_capref'), order('Select an oral agent active against streptococci', 'cephalexin')],
    counseling: ['Explain oral treatment and a check for progression', ['antibiotic', 'spread', 'mark', 'return'], 'Plan an appropriate oral antibiotic and reassessment for expansion, disproportionate pain or systemic illness.'],
    teaching: 'An uncomplicated nonpurulent infection in a stable patient can usually be treated with outpatient streptococcal coverage.', references: [skinInfection],
  },
  {
    id: 'contact_dermatitis', walkToBed: true, specialty: 'dermatology', age: 38, sex: 'F', difficulty: 1, esi: 5,
    complaint: 'Itchy rash beneath both work gloves', opening: 'My hands sting by the end of my shift. It is making it hard to work.',
    facts: [['Exposure distribution', ['job', 'work', 'contact', 'glove'], 'We changed cleaning products last week. Liquid runs into both glove cuffs.'],
      ['Time away from exposure', ['weekend', 'off', 'when', 'better'], 'It faded on my days off, then flared when I used the cleaner again.']],
    exam: { skin_inspect: 'Bilateral sharply demarcated scaly erythema and fissures at wrists and dorsal hands. No pus or spreading warmth.' },
    diagnosis: 'Irritant contact dermatitis', synonyms: ['contact dermatitis', 'occupational hand dermatitis', 'hand eczema'], icd10: 'L24.9', disposition: 'discharge',
    steps: [], counseling: ['Identify and limit further exposure', ['avoid', 'barrier', 'gloves', 'emollient'], 'Discuss reducing wet work and chemical contact, restoring the skin barrier and reviewing workplace protection.'],
    teaching: 'Distribution and a clear work-rest pattern can identify an occupational trigger.',
    references: ['AAD. Contact dermatitis. https://www.aad.org/public/diseases/eczema/types/contact-dermatitis/treatment'],
  },
  {
    id: 'thoracic_zoster', walkToBed: true, specialty: 'dermatology', age: 63, sex: 'F', difficulty: 1, esi: 4,
    complaint: 'Burning pain and a stripe of blisters on the chest', opening: 'Even my shirt hurts. I thought I had strained a rib before the spots came.',
    facts: [['Prodromal pain', ['first', 'onset', 'pain', 'when'], 'The skin burned for two days before the blisters appeared this morning.'],
      ['Local distribution', ['face', 'eye', 'where', 'elsewhere'], 'It is only on the left side under my breast and around to my back.']],
    exam: { skin_inspect: 'Grouped vesicles on an erythematous base along a single thoracic dermatome, stopping at the midline. No facial or disseminated lesions.' },
    diagnosis: 'Localized thoracic herpes zoster', synonyms: ['herpes zoster', 'shingles', 'zoster'], icd10: 'B02.9', disposition: 'discharge', vitals: { pain: 6 },
    steps: [order('Start antiviral therapy early in the rash', 'valacyclovir')], counseling: ['Discuss early antiviral therapy and covering lesions', ['antiviral', 'cover', 'crust', 'pregnan'], 'Discuss antiviral treatment and covering lesions until crusted, particularly around susceptible high-risk contacts.'],
    teaching: 'Pain followed by a unilateral vesicular eruption in one dermatome is characteristic. Ask about ocular symptoms and immune status.',
    references: ['CDC. Clinical features of shingles. https://www.cdc.gov/shingles/hcp/clinical-signs/index.html'],
  },
  {
    id: 'localized_impetigo', walkToBed: true, specialty: 'dermatology', age: 20, sex: 'M', difficulty: 1, esi: 5,
    complaint: 'Crusted sores below the nose', opening: 'Someone at practice had a rash. Can I share equipment tomorrow?',
    facts: [['Evolution of lesions', ['when', 'crust', 'itch', 'start'], 'Two tiny blisters opened and left sticky yellow crusts. They itch more than they hurt.'],
      ['Contact exposure', ['sport', 'practice', 'contact', 'household'], 'We share towels at practice. A teammate had similar spots last week.']],
    exam: { skin_inspect: 'Three superficial honey-colored crusted erosions below the nares. No surrounding cellulitis, extensive involvement or fever.' },
    diagnosis: 'Localized nonbullous impetigo', synonyms: ['impetigo', 'nonbullous impetigo'], icd10: 'L01.00', disposition: 'discharge',
    steps: [], counseling: ['Review topical treatment and reducing spread', ['towel', 'wash', 'cover', 'topical'], 'Discuss local topical therapy, hand hygiene, covering lesions and avoiding shared towels.'],
    teaching: 'Limited superficial impetigo can be managed with topical treatment. Extensive lesions and community outbreaks may alter therapy.', references: [skinInfection],
  },
  {
    id: 'minor_scald', walkToBed: true, specialty: 'burns', age: 34, sex: 'M', difficulty: 1, esi: 4,
    complaint: 'Tea scald on the forearm', opening: 'I ran it under cool water. There is a blister about the size of my thumb.',
    facts: [['Thermal exposure', ['how', 'spill', 'heat', 'chemical'], 'A mug tipped onto my left forearm. There was no smoke, electricity or chemical.'],
      ['First aid and tetanus status', ['cool', 'water', 'tetanus', 'vaccine'], 'I cooled it under tap water straight away. I completed my tetanus series and had a booster two years ago.']],
    exam: { skin_inspect: 'Moist pink, painful, blanching patch with one clear blister on the mid-forearm, below 1% body surface area. Noncircumferential and clear of the joints.', skin_capref: 'Hand warm with normal refill.' },
    diagnosis: 'Superficial partial thickness scald of the left forearm', synonyms: ['partial thickness burn', 'partial-thickness burn', 'second degree burn', 'scald'], icd10: 'T22.212A',
    disposition: 'discharge', vitals: { pain: 4 }, steps: [examine('Assess burn depth, extent and circulation', 'skin_inspect', 'skin_capref')],
    counseling: ['Explain dressing care and review', ['dressing', 'cover', 'infection', 'wound review'], 'Explain nonadherent dressing care, follow-up and signs of infection.'],
    teaching: 'A small, blanching blistered scald away from critical areas is usually suitable for outpatient wound care.',
    references: ['American Burn Association. Guidelines for burn patient referral. https://www.ameriburn.org/burn-care-team/resources/guidelines-for-burn-patient-referral'],
  },
  {
    id: 'anterior_epistaxis', walkToBed: true, specialty: 'otolaryngology', age: 50, sex: 'M', difficulty: 1, esi: 4,
    complaint: 'A nosebleed that has stopped and restarted', opening: 'I tilted my head back and pressed the bridge. Then the blood went down my throat.',
    facts: [['Bleeding source and control attempts', ['where', 'side', 'pressure', 'how'], 'Always the left nostril. I kept letting go every minute to check.'],
      ['Bleeding risk', ['blood thinner', 'medication', 'bruise', 'anticoag'], 'I do not take blood thinners and I do not usually bruise or bleed easily.']],
    exam: { heent_mucosa: 'Small clot over a visible vessel on the anterior left nasal septum. No active bleeding into the pharynx.' },
    diagnosis: 'Anterior epistaxis', synonyms: ['epistaxis', 'anterior nosebleed', 'nasal bleeding'], icd10: 'R04.0', disposition: 'discharge',
    steps: [], counseling: ['Demonstrate sustained pressure over the soft nose', ['soft part', 'soft nose', 'pinch', 'compression'], 'Lean forward and hold uninterrupted pressure over the lower soft nose. Seek help for heavy or persistent bleeding.'],
    teaching: 'Firm sustained compression of the lower nose is first-line for active anterior bleeding.',
    references: ['AAO-HNS. Clinical practice guideline on nosebleed. https://www.entnet.org/quality-practice/quality-products/clinical-practice-guidelines/nosebleed-epistaxis/'],
  },
  {
    id: 'peritonsillar_abscess', specialty: 'otolaryngology', age: 25, sex: 'F', difficulty: 2, esi: 2,
    complaint: 'One-sided throat pain and muffled voice', opening: 'I can breathe, but it hurts too much to swallow my medicine.',
    facts: [['Progressive asymmetry', ['when', 'side', 'ear', 'pain'], 'The sore throat started four days ago and became much worse on the right yesterday. It goes up into my ear.'],
      ['Trismus and swallowing', ['mouth', 'swallow', 'drink', 'jaw'], 'I can barely open my mouth. I have not managed a drink since this morning.']],
    exam: { heent_mucosa: 'Trismus, right soft palate bulge and leftward uvular deviation. Muffled voice.', pulm_effort: 'Breathing comfortably without stridor or retractions.' },
    diagnosis: 'Right peritonsillar abscess', synonyms: ['peritonsillar abscess', 'quinsy'], icd10: 'J36', disposition: 'transfer', consultant: 'transfer',
    vitals: { hr: 108, temp: 38.3, pain: 8 }, labs: { wbc: 16.5 },
    steps: [examine('Assess airway and oropharynx', 'pulm_effort', 'heent_mucosa'), order('Place IV access for hydration and treatment', 'iv_access'), given('Give parenteral antimicrobial coverage', 'amp_sulb')],
    counseling: ['Explain transfer for drainage and airway observation', ['drain', 'transfer', 'specialist'], 'Explain transfer for urgent ENT assessment, possible drainage and airway monitoring.'],
    teaching: 'Trismus, unilateral palatal swelling and a muffled voice suggest quinsy. Arrange urgent specialist assessment.',
    references: ['Dorset County Hospital. Quinsy. https://dchft.nhs.uk/leaflets/quinsy/'],
  },
  {
    id: 'viral_pharyngitis', walkToBed: true, specialty: 'otolaryngology', age: 21, sex: 'F', difficulty: 1, esi: 5,
    complaint: 'Sore throat, runny nose and hoarseness', opening: 'I am supposed to sing on Friday. Could an antibiotic speed this up?',
    facts: [['Concurrent coryza', ['cough', 'nose', 'voice', 'symptom'], 'I have a runny nose, dry cough and hoarse voice. My roommate had a cold.'],
      ['Oral intake', ['swallow', 'drink', 'fever', 'breath'], 'I can drink and breathe fine. I have not had a fever.']],
    exam: { heent_mucosa: 'Diffuse mild pharyngeal erythema without exudate, swelling or deviation. No tender anterior cervical nodes.' },
    diagnosis: 'Acute viral pharyngitis', synonyms: ['viral pharyngitis', 'viral upper respiratory infection', 'viral uri'], icd10: 'J02.9', disposition: 'discharge', vitals: { pain: 2 },
    steps: [], counseling: ['Explain the expected course and symptom relief', ['viral', 'virus', 'fluids', 'antibiotics'], 'Discuss symptom control and why antibiotics offer no benefit for this viral syndrome.'],
    teaching: 'Hoarseness, cough and coryza favor a viral cause. An uncomplicated low-risk sore throat needs supportive care.', references: [soreThroat],
    lowValue: viralStewardship,
  },
  {
    id: 'acute_otitis_externa', walkToBed: true, specialty: 'otolaryngology', age: 28, sex: 'M', difficulty: 1, esi: 4,
    complaint: 'Ear pain after swimming', opening: 'It is especially sore when I put in my earbud.',
    facts: [['Water and instrumentation', ['swim', 'water', 'clean', 'cotton'], 'I have been swimming every day and using cotton swabs afterward.'],
      ['Signs of extension', ['fever', 'headache', 'diabetes', 'immune'], 'No fever or headache. I have no diabetes or immune problems.']],
    exam: { heent_otoscopy: 'Right tragus and pinna tender to movement. Canal erythematous with debris; visible tympanic membrane intact. No mastoid tenderness or spreading cellulitis.' },
    diagnosis: 'Acute right otitis externa', synonyms: ['otitis externa', 'swimmer’s ear', 'swimmers ear'], icd10: 'H60.501', disposition: 'discharge', vitals: { pain: 4 },
    steps: [], counseling: ['Review topical treatment and keeping the ear dry', ['drops', 'ear dry', 'swab', 'dry ear'], 'Explain topical ear drops, keeping water out and reassessment if worsening or failing to improve.'],
    teaching: 'Tragal tenderness and canal inflammation localize uncomplicated infection to the external ear. Topical therapy is first-line.',
    references: ['AAO-HNS. Clinical practice guideline on acute otitis externa. https://www.entnet.org/quality-practice/quality-products/clinical-practice-guidelines/aoe/'],
  },
  {
    id: 'subconjunctival_hemorrhage', walkToBed: true, specialty: 'ophthalmology', age: 56, sex: 'F', difficulty: 1, esi: 5,
    complaint: 'Painless red patch on one eye', opening: 'My daughter pointed to my eye. I had no idea anything was wrong.',
    facts: [['Trigger without trauma', ['injury', 'cough', 'when', 'trauma'], 'I had a hard coughing fit this morning. Nothing hit my eye.'],
      ['Vision and pain', ['vision', 'pain', 'light', 'see'], 'I see just as well as usual. No pain, discharge or light sensitivity.']],
    exam: { heent_vision: '20/20 in each eye with correction. Fields full. Bright red sharply demarcated patch over the temporal left sclera.', heent_pupils: 'Pupils equal and reactive. No afferent defect.' },
    diagnosis: 'Spontaneous subconjunctival hemorrhage', synonyms: ['subconjunctival hemorrhage', 'subconjunctival haemorrhage'], icd10: 'H11.32', disposition: 'discharge',
    steps: [examine('Assess vision and pupils', 'heent_vision', 'heent_pupils')],
    counseling: ['Explain resolution and eye warning signs', ['resorb', 'clear', 'resolve', 'vision change'], 'Reassure about gradual resorption and advise review for pain, visual change or recurrence.'],
    teaching: 'A painless focal subconjunctival bleed with preserved acuity after coughing usually clears spontaneously. Assess trauma and blood pressure.',
    references: ['AAO. Subconjunctival hemorrhage. https://www.aao.org/eye-health/diseases/what-is-subconjunctival-hemorrhage'],
  },
  {
    id: 'rhegmatogenous_retinal_detachment', specialty: 'ophthalmology', age: 61, sex: 'M', difficulty: 3, esi: 2,
    complaint: 'Flashes, floaters and a shadow over part of one eye', opening: 'It looks as if a shade is creeping up from the bottom.',
    facts: [['Monocular progression', ['eye', 'cover', 'when', 'curtain'], 'When I cover the left eye it goes away. Yesterday I had flashes, then dark specks and now the shadow.'],
      ['Risk factors', ['short-sight', 'myopia', 'glasses', 'surgery'], 'I was very short-sighted before cataract surgery on that eye.']],
    exam: { heent_vision: 'Left inferior field defect, central acuity 20/30. Right acuity 20/20 with full fields.', heent_fundus: 'Elevated, corrugated superior retina in the left eye. Central macula appears attached.' },
    diagnosis: 'Macula-on rhegmatogenous retinal detachment', synonyms: ['retinal detachment', 'detached retina'], icd10: 'H33.002', disposition: 'transfer', consultant: 'transfer',
    steps: [examine('Examine visual fields, acuity and fundus', 'heent_vision', 'heent_fundus')],
    counseling: ['Explain urgent retinal assessment', ['retina', 'transfer', 'ophthalmolog'], 'Arrange immediate transfer to the regional retinal service to preserve central vision.'],
    teaching: 'New monocular flashes, floaters and a field curtain require urgent retinal evaluation even if central acuity is preserved.',
    references: ['AAO. Retinal detachment. https://www.aao.org/young-ophthalmologists/yo-info/article/yo-need-to-know-retinal-detachment-what-to-know'],
  },
  {
    id: 'traumatic_corneal_abrasion', walkToBed: true, specialty: 'ophthalmology', age: 30, sex: 'F', difficulty: 1, esi: 4,
    complaint: 'Tearing and grittiness after a fingernail scratch', opening: 'My toddler caught my eye as I picked him up. Now every blink hurts.',
    facts: [['Low-energy mechanism', ['scratch', 'how', 'metal', 'happen'], 'It was a fingernail. I was not using tools and there was no flying metal.'],
      ['Contact lens status', ['contacts', 'lenses', 'vision', 'eye surgery'], 'I do not wear contact lenses. My vision clears when I blink away the tears.']],
    exam: { heent_fluorescein: 'Small linear peripheral left corneal epithelial defect. No dendrite, infiltrate, aqueous leak or retained subtarsal foreign body.', heent_vision: '20/20 in both eyes with full fields.' },
    diagnosis: 'Traumatic corneal abrasion', synonyms: ['corneal abrasion', 'scratched cornea', 'corneal epithelial defect'], icd10: 'S05.02XA', disposition: 'discharge', vitals: { pain: 5 },
    steps: [examine('Document visual acuity and fluorescein findings', 'heent_vision', 'heent_fluorescein')],
    counseling: ['Explain eye care and early review if persistent', ['vision', 'worse', 'recheck', 'rub'], 'Discuss protecting the eye and reassessment for worsening pain, decreased vision or failure to improve.'],
    teaching: 'Document baseline acuity and check for a foreign body, infiltrate or penetrating injury before managing a simple abrasion.',
    references: ['AAO. Corneal abrasion and erosion. https://www.aao.org/eye-health/diseases/what-is-corneal-abrasion'],
  },
];

// Each vignette retains a stable identity but has an authored history beyond its diagnostic clues.
type SurfaceDetail = {
  facts: [label: string, keywords: string[], text: string, key?: boolean][];
  personality: string;
  prior: [reason: string, summary: string];
  teaching: string[];
  safety: [label: string, keywords: string[], description: string];
};
const surfaceDetail: Record<string, SurfaceDetail> = {
  leg_cellulitis: {
    facts: [
      ['Timeline', ['when', 'hours', 'days'], 'The scratch was three days ago. Redness appeared yesterday and is a little wider today.', true],
      ['Site and pain', ['where', 'side', 'pain'], 'The left shin only. It is sore, three out of ten, not a deep pain through the whole leg.'],
      ['Purulence and rapid progression', ['pus', 'drain', 'blister', 'rapid'], 'No pus, blisters or purple patches. It has spread over a day, not minute by minute.', true],
      ['Joint and calf symptoms', ['joint', 'ankle', 'calf', 'walk'], 'My knee and ankle move normally; there is no calf pain or swelling of the whole leg.'],
      ['Special exposures', ['bite', 'water', 'travel', 'injection'], 'No bite, swimming, travel or injection at the site.', true],
      ['Medical risks', ['diabetes', 'immune', 'past', 'mrsa'], 'No diabetes or immune problems. I have never had a resistant skin infection.'],
      ['Medication and allergy', ['medicine', 'medication', 'allerg'], 'No regular medicines and no medication allergy.'],
      ['Oral treatment feasibility', ['swallow', 'vomit', 'pharmacy', 'home'], 'I can eat and drink normally and can get to the pharmacy today.', true],
      ['Follow-up and support', ['follow', 'review', 'help', 'work'], 'My clinic can see me in two days. I can keep my leg up when I am not working.'],
    ],
    personality: 'Calm shop worker who wants to know how to tell normal early redness from dangerous worsening.',
    prior: ['Routine primary care visit', 'No diabetes, immunosuppression, vascular disease or prior recurrent skin infection. No regular prescriptions.'],
    teaching: ['Describe the extent and look for pus, deep infection, joint involvement and systemic illness before choosing an outpatient plan.', 'A stable nonpurulent presentation does not routinely require broad IV or MRSA-directed therapy.', 'Skin appearance resolves over days; do not equate lack of immediate clearing with antibiotic failure.'],
    safety: ['Give a review interval and urgent return precautions', ['two days', '48 hours', 'rapidly', 'fever', 'severe pain'], 'Arrange review if not improving over the next two to three days; return sooner for rapid spread, disproportionate pain, fever or systemic illness.'],
  },
  contact_dermatitis: {
    facts: [
      ['Timeline', ['when', 'week', 'start'], 'It began about ten days ago, just after the new cleaning liquid arrived.', true],
      ['Symptoms', ['itch', 'pain', 'burn', 'sleep'], 'Mostly itching and burning. The cracks sting when I wash my hands.'],
      ['Distribution elsewhere', ['elsewhere', 'face', 'mouth', 'spread'], 'Only my hands and wrists. Nothing on my face, mouth or the rest of my body.', true],
      ['Infection symptoms', ['fever', 'pus', 'warm', 'redness'], 'No fever, pus or red streak up the arm.'],
      ['Exposure detail', ['product', 'wet', 'washing', 'detergent'], 'It is a concentrated degreaser. My hands are wet inside the gloves for much of the shift.', true],
      ['Atopy and prior skin history', ['eczema', 'asthma', 'allerg', 'before'], 'I had mild eczema as a child. No drug allergies or immediate swelling after gloves.'],
      ['Medication and attempted treatment', ['cream', 'medicine', 'tried'], 'I tried a scented hand cream, but it stung. No prescribed tablets or creams.'],
      ['Work options', ['work', 'employer', 'protection', 'job'], 'I could ask for dry tasks temporarily. I worry they will think I cannot do my job.', true],
      ['Household symptoms', ['family', 'household', 'contact'], 'Nobody at home has itching or a rash.'],
    ],
    personality: 'Cleaner worried about lost income; needs a specific workplace plan rather than simply being told to stop working.',
    prior: ['Childhood eczema history', 'Intermittent mild flexural eczema in childhood, no recent treatment or systemic immune disease.'],
    teaching: ['A repeated exposure and work-rest pattern supports contact dermatitis, but persistent disease may need assessment for allergy.', 'Treat the skin barrier and the exposure together; cream alone cannot compensate for continuing wet chemical contact.', 'A localized scaly rash without infection is not an indication for antibiotics.'],
    safety: ['Discuss flare treatment and occupational follow-up', ['topical steroid', 'corticosteroid cream', 'occupational', 'fragrance-free', 'review'], 'Discuss bland emollients and an appropriate short topical corticosteroid course, workplace protection and review if persistent; topical treatments are discussed rather than ordered in this catalog.'],
  },
  thoracic_zoster: {
    facts: [
      ['Rash timing', ['rash', 'blister', 'hours'], 'The first blisters appeared about eight hours ago; more small ones appeared this afternoon.', true],
      ['Pain characteristics', ['pain', 'touch', 'severity'], 'A burning six out of ten, made worse by clothes brushing it. It is not brought on by walking.'],
      ['Eye, ear and neurologic symptoms', ['eye', 'ear', 'hearing', 'weak', 'headache'], 'No red eye, visual change, ear pain, weakness or severe headache.', true],
      ['Immune risk', ['immune', 'steroid', 'cancer', 'transplant'], 'No cancer treatment, transplant, steroid medicine or immune illness.', true],
      ['Previous infection', ['chickenpox', 'before', 'vaccin'], 'I had chickenpox as a child. I have not had the shingles vaccine.'],
      ['Medical and renal history', ['kidney', 'past', 'health'], 'I have treated hypertension but no known kidney disease.'],
      ['Medication and allergy', ['medicine', 'medication', 'allerg'], 'Amlodipine 5 milligrams daily. No drug allergies.'],
      ['High-risk contacts', ['pregnan', 'baby', 'contacts', 'family'], 'I was meant to visit my newborn grandchild tomorrow. My daughter is not sure she ever had chickenpox.', true],
      ['Function and support', ['sleep', 'home', 'help'], 'I slept poorly because of the burning. My spouse can help with dressings.'],
    ],
    personality: 'Uncomfortable and concerned about passing infection to a new baby; asks for practical contact precautions.',
    prior: ['Hypertension review', 'Blood pressure controlled with amlodipine; no immunosuppression or known renal disease.'],
    teaching: ['Assess distribution, immune status and ocular or neurologic symptoms rather than assuming every vesicular rash is uncomplicated.', 'Early oral antiviral treatment is appropriate for this older adult with a fresh localized rash; check renal function and dosing context.', 'Cover lesions and avoid exposing susceptible high-risk contacts until crusted; analgesia may improve sooner than the rash.'],
    safety: ['Explain urgent review for eye symptoms or dissemination', ['eye pain', 'vision', 'face', 'widespread', 'weakness'], 'Return urgently for facial or eye involvement, widespread lesions, neurologic symptoms or severe systemic illness.'],
  },
  localized_impetigo: {
    facts: [
      ['Duration', ['when', 'days', 'start'], 'The first blister appeared two days ago and there are only three spots now.', true],
      ['Distribution', ['elsewhere', 'spread', 'body'], 'All below my nose. No spots on my arms, legs or inside my mouth.', true],
      ['Systemic symptoms', ['fever', 'chills', 'sick'], 'No fever or illness. I feel well apart from the itching.'],
      ['Pain and swelling', ['pain', 'swollen', 'red'], 'They itch but are not deeply painful, and my face is not swollen.'],
      ['Skin trauma', ['scratch', 'shave', 'injury'], 'I had been rubbing my nose during a cold and scratched one spot.'],
      ['Past skin disease', ['eczema', 'before', 'past', 'mrsa'], 'No eczema or previous resistant skin infection.'],
      ['Health, medication and allergies', ['medicine', 'allerg', 'diabetes', 'immune'], 'No regular medicine, diabetes or immune problem. No medication allergies.'],
      ['Treatment tried', ['cream', 'antibiotic', 'tried'], 'I washed with soap but have not used antibiotics or creams.'],
      ['Sport and contacts', ['match', 'tomorrow', 'towel', 'team'], 'There is a match tomorrow. I can tell the coach and stop sharing towels.', true],
    ],
    personality: 'Young athlete primarily concerned about participating in tomorrow’s match and avoiding embarrassment.',
    prior: ['Sports health review', 'No chronic skin disease, immune disorder or regular medication.'],
    teaching: ['The small number of superficial crusted lesions and lack of systemic features support localized disease.', 'Choose local topical treatment according to guidance; extensive disease, outbreaks or treatment failure require reassessment.', 'Hygiene and avoiding shared personal equipment are part of treatment, not optional cosmetic advice.'],
    safety: ['Explain return to sport and reassessment', ['contact sport', 'coach', 'spread', 'fever', 'not improving'], 'Avoid direct-contact sport until cleared under local infection-control rules; seek review if spreading, painful, febrile or failing to improve.'],
  },
  minor_scald: {
    facts: [
      ['Timing', ['when', 'minutes', 'time'], 'The tea spilled about forty-five minutes ago.', true],
      ['Cooling duration', ['how long', 'cool', 'water', 'minutes'], 'I used cool running tap water for twenty minutes, not ice.', true],
      ['Clothing and jewelry', ['sleeve', 'clothes', 'watch', 'jewel'], 'I took off the wet sleeve and my watch before swelling started.'],
      ['Anatomical extent', ['hand', 'joint', 'around', 'elsewhere'], 'Only the middle of the left forearm. The wrist, elbow and hand were not burned.', true],
      ['Sensation and function', ['numb', 'feel', 'move', 'finger'], 'It stings, but I can feel and move the hand and fingers normally.'],
      ['Airway or special mechanism', ['smoke', 'breath', 'electric', 'chemical'], 'No smoke or breathing trouble; it was just a cup of tea.'],
      ['Health and healing risks', ['diabetes', 'immune', 'skin', 'past'], 'No diabetes, skin disease or immune treatment.'],
      ['Medication and allergy', ['medicine', 'allerg', 'painkiller'], 'No regular medicine or drug allergies. I have not taken a painkiller.'],
      ['Home care', ['home', 'work', 'help', 'dressing'], 'I can keep it clean and dry and attend the practice nurse for a dressing check.', true],
    ],
    personality: 'Worried about whether the blister should be opened; follows practical first-aid instructions carefully.',
    prior: ['Immunization review', 'Completed primary tetanus immunization series; booster documented two years ago. No impaired-healing condition.'],
    teaching: ['Record depth, surface area, circulation and whether a joint or critical site is involved.', 'Small superficial partial-thickness burns may be managed locally, with advice or consultation according to local burn pathways.', 'The wound can evolve after the first examination; arrange reassessment rather than promising that a fresh burn cannot deepen.'],
    safety: ['Arrange early wound reassessment', ['24 hours', '48 hours', 'review', 'redness', 'numb'], 'Arrange a wound review within one to two days and earlier assessment for worsening pain, spreading erythema, fever or impaired hand sensation.'],
  },
  anterior_epistaxis: {
    facts: [
      ['Duration and amount', ['when', 'long', 'blood', 'amount'], 'Three short bleeds over two hours, enough to stain tissues but not soak a towel.', true],
      ['Precipitant', ['injury', 'pick', 'blow', 'dry'], 'My nose felt dry and I blew it hard. Nobody hit me.'],
      ['Posterior bleeding symptoms', ['throat', 'swallow', 'both nostrils'], 'Blood ran down my throat only while I tilted my head back. It has stopped now.', true],
      ['Circulatory symptoms', ['dizzy', 'faint', 'chest', 'breath'], 'No dizziness, fainting, chest pain or shortness of breath.', true],
      ['Previous bleeding', ['before', 'recur', 'family', 'gum'], 'One nosebleed years ago. No bleeding gums or family bleeding disorder.'],
      ['Nasal substances', ['spray', 'cocaine', 'nose drops'], 'No nasal sprays, recreational drugs or oxygen tubing.'],
      ['Medical background', ['pressure', 'hypertension', 'kidney', 'liver'], 'I have not been diagnosed with high blood pressure, kidney or liver disease.'],
      ['Medication and allergy', ['medicine', 'aspirin', 'ibuprofen', 'allerg'], 'No regular medicine, aspirin or recent ibuprofen. No known drug allergy.'],
      ['Home and access', ['home', 'help', 'return'], 'My spouse is at home. We can return if firm pressure does not stop another bleed.'],
    ],
    personality: 'Embarrassed about ineffective first aid; appreciates being shown where and how long to pinch.',
    prior: ['Primary care check', 'No diagnosed hypertension, anticoagulant use or bleeding disorder.'],
    teaching: ['Confirm that bleeding is controlled and assess its severity before discharge.', 'Pinching the bony bridge and repeatedly releasing pressure are ineffective techniques.', 'Recurrent unilateral or difficult-to-control bleeding needs further assessment; treatment options depend on the identified source.'],
    safety: ['Explain persistent-bleeding and blood-loss precautions', ['persistent', 'heavy bleeding', 'dizzy', '20 minutes', 'return'], 'Explain return for heavy or persistent bleeding despite sustained soft-nose pressure, dizziness or breathing difficulty. Avoid nose blowing or picking while healing.'],
  },
  peritonsillar_abscess: {
    facts: [
      ['Timeline', ['when', 'start', 'days'], 'It began as a sore throat four days ago; the right side became much worse yesterday.', true],
      ['Airway symptoms', ['breath', 'stridor', 'drool', 'saliva'], 'I can breathe and swallow my saliva slowly, but drinking is very painful. I am not choking.', true],
      ['Dehydration symptoms', ['urine', 'drink', 'dizzy'], 'Only a little dark urine today. I feel lightheaded when I stand.', true],
      ['Neck and chest symptoms', ['neck', 'chest', 'stiff'], 'The right glands hurt, but no swelling down my neck or chest pain.'],
      ['Dental and prior throat history', ['tooth', 'dental', 'before', 'tonsil'], 'No dental pain or recent dental work. I have had sore throats but never this jaw stiffness.'],
      ['Medication and allergy', ['medicine', 'allerg', 'antibiotic'], 'No regular medicine or allergies. I have not started antibiotics.'],
      ['Analgesic attempt', ['painkiller', 'taken', 'paracetamol'], 'I took paracetamol yesterday; I could not swallow tablets this morning.'],
      ['Immune and pregnancy history', ['immune', 'diabetes', 'pregnan', 'period'], 'No diabetes or immune treatment. My period was normal last week and I do not think I am pregnant.'],
      ['Support and consent', ['home', 'family', 'transfer', 'help'], 'My partner can come with me. Please explain what drainage means.'],
    ],
    personality: 'Answers briefly because speaking hurts; fearful of choking but able to describe symptoms clearly.',
    prior: ['Previous sore throat', 'Self-limited pharyngitis without abscess, airway difficulty or recurrent tonsillitis requiring surgery.'],
    teaching: ['Assess the airway first and repeat the assessment if symptoms change.', 'Poor intake may require IV hydration and parenteral therapy; an oral prescription alone does not solve this presentation.', 'Specialist drainage and definitive source control are not replaced by a transient reduction in pain or temperature.'],
    safety: ['Explain airway warning signs while awaiting transfer', ['breathing', 'saliva', 'drooling', 'stridor', 'worse'], 'Ask the patient to alert staff immediately for noisy breathing, inability to swallow saliva or worsening swelling; continue observation during transfer arrangements.'],
  },
  viral_pharyngitis: {
    facts: [
      ['Duration', ['when', 'days', 'start'], 'It started two days ago with a runny nose, then the sore throat and hoarseness.', true],
      ['Pain pattern', ['pain', 'side', 'severity'], 'A mild scratchy feeling on both sides, not a severe one-sided pain.'],
      ['Deep infection symptoms', ['jaw', 'mouth', 'neck', 'drool'], 'I can open my mouth normally. No swollen neck or trouble swallowing saliva.', true],
      ['Systemic symptoms', ['rash', 'fever', 'chill', 'tired'], 'No fever, rash or marked fatigue. I am still getting on with my day.'],
      ['Immune and exposure history', ['immune', 'diabetes', 'travel', 'contact'], 'No immune problem or recent travel. My roommate had the same cold.'],
      ['Medication and allergy', ['medicine', 'allerg', 'antibiotic'], 'No regular medicines or drug allergies. I have not taken antibiotics.'],
      ['Self care', ['tried', 'drink', 'painkiller'], 'Warm drinks help. I have not needed painkillers.'],
      ['Voice demands', ['sing', 'work', 'voice', 'smok'], 'I sing in an amateur choir and do not smoke. I can rest my voice if I need to.'],
      ['Follow-up access', ['home', 'help', 'review'], 'I can call my practice if it gets worse or does not settle.'],
    ],
    personality: 'Student hoping for a quick cure before a performance; receptive to an explanation of why antibiotics are not useful.',
    prior: ['Routine health review', 'No recurrent tonsillitis, immune disease or chronic medication.'],
    teaching: ['Cough, coryza and hoarseness make a viral syndrome more likely; check for airway or deep-neck warning signs.', 'For this mild presentation, symptom care and expectations matter more than investigations.', 'Explain what changes would require reassessment rather than giving an unsupported antibiotic prescription.'],
    safety: ['Provide a clear sore-throat safety net', ['unable to swallow', 'breathing', 'one sided', 'week', 'worsen'], 'Seek review for inability to swallow fluids, breathing difficulty, severe unilateral symptoms, systemic illness or failure to improve over about a week.'],
  },
  acute_otitis_externa: {
    facts: [
      ['Timeline and side', ['when', 'days', 'side'], 'My right ear became itchy three days ago, then painful yesterday.', true],
      ['Pain trigger', ['pain', 'pull', 'tragus', 'earbud'], 'Touching or pulling the ear is worse than chewing. It aches four out of ten.'],
      ['Hearing and discharge', ['hear', 'discharge', 'fluid'], 'It feels slightly blocked with a little damp debris, but I can still hear speech.'],
      ['Extension symptoms', ['face', 'weak', 'vertigo', 'swelling'], 'No facial weakness, spinning or redness spreading around the ear.', true],
      ['Tympanic history', ['perforat', 'tube', 'grommet', 'surgery'], 'No ear surgery, grommets or known hole in the eardrum.', true],
      ['Previous episodes', ['before', 'previous', 'eczema'], 'This happened once after swimming years ago. No eczema in the ears.'],
      ['Medication and allergy', ['medicine', 'allerg', 'drops'], 'No regular medicines or allergies. I have not used any drops yet.'],
      ['Pain treatment', ['taken', 'painkiller', 'ibuprofen'], 'I took ibuprofen 400 milligrams once this morning; it helped a little.'],
      ['Practical treatment', ['help', 'home', 'swimming', 'work'], 'I can pause swimming and my partner can help me put drops in.'],
    ],
    personality: 'Regular swimmer who thinks cotton swabs keep the ear clean; needs an explanation of how they can injure it.',
    prior: ['Remote outer-ear infection', 'Uncomplicated otitis externa resolved with topical treatment. No tympanic membrane perforation or ear surgery.'],
    teaching: ['Check canal findings, tympanic membrane and surrounding tissues; diabetes or immune compromise changes the risk assessment.', 'Uncomplicated localized disease is treated topically; routine systemic antibiotics are not required.', 'Demonstrate drop delivery and reassess a poor response, including whether edema prevents drops reaching the canal.'],
    safety: ['Arrange reassessment if drops fail or symptoms extend', ['48 hours', '72 hours', 'not improving', 'fever', 'facial weakness'], 'Reassess within 48 to 72 hours if not improving; seek earlier review for severe progression, fever, spreading redness or neurologic symptoms.'],
  },
  subconjunctival_hemorrhage: {
    facts: [
      ['Onset and side', ['when', 'side', 'left'], 'My daughter noticed the red patch in my left eye this morning after I coughed.', true],
      ['Visual symptoms', ['floaters', 'flashes', 'double', 'curtain'], 'No new floaters, flashes, double vision or shadow.', true],
      ['Trauma and contact lenses', ['lens', 'contact', 'rub', 'injury'], 'I did not rub or injure the eye and do not wear contact lenses.'],
      ['Recurrence', ['before', 'recur', 'previous'], 'This has never happened before.'],
      ['Other bleeding', ['bruise', 'gum', 'nose', 'bleed'], 'No unusual bruises, bleeding gums or nosebleeds.', true],
      ['Medication', ['medicine', 'aspirin', 'blood thinner', 'anticoag'], 'I take losartan 50 milligrams daily, but no aspirin or blood thinner.'],
      ['Blood pressure history', ['pressure', 'hypertension', 'headache'], 'My blood pressure is usually controlled. No severe headache or chest pain.'],
      ['Allergies and eye history', ['allerg', 'surgery', 'eye disease'], 'No drug allergy or previous eye surgery. I use glasses for reading.'],
      ['Main concern', ['worry', 'concern', 'home'], 'It looks frightening. I mainly want to know if it will damage my sight.'],
    ],
    personality: 'Alarmed by appearance despite no symptoms; seeks a clear explanation and time course.',
    prior: ['Hypertension review', 'Controlled hypertension treated with losartan 50 mg daily. No anticoagulation, bleeding disorder or prior ocular disease.'],
    teaching: ['Reassurance follows a normal visual assessment and exclusion of trauma or other concerning symptoms.', 'Check blood pressure and medication/bleeding history; recurrent bleeding may need further assessment.', 'The red patch resolves gradually rather than during the ED visit. New pain or visual change warrants reassessment.'],
    safety: ['Discuss persistence, recurrence and new symptoms', ['two weeks', 'recur', 'pain', 'vision', 'review'], 'Arrange review if recurrent or not resolving, and urgently for pain, visual change or trauma-related concerns.'],
  },
  rhegmatogenous_retinal_detachment: {
    facts: [
      ['Exact chronology', ['when', 'hours', 'start'], 'Flashes started yesterday evening. Floaters increased overnight; the lower shadow appeared three hours ago.', true],
      ['Central vision', ['read', 'central', 'see', 'vision'], 'I can still read large print looking straight ahead, but the lower part is missing.', true],
      ['Pain and redness', ['pain', 'red', 'headache'], 'There is no pain, redness or headache.'],
      ['Laterality', ['right', 'left', 'both', 'cover'], 'It is definitely the left eye only; covering the right eye does not remove the shadow.', true],
      ['Trauma and exertion', ['trauma', 'injury', 'hit'], 'Nothing hit my eye. I was reading when I first noticed it.'],
      ['Eye history', ['cataract', 'surgery', 'myopia', 'before'], 'Left cataract surgery was eighteen months ago. Before that my glasses were about minus eight.'],
      ['Fellow eye and family history', ['other eye', 'family', 'retina'], 'No detachment in the other eye and none that I know of in the family.'],
      ['Medical and medication history', ['diabetes', 'medicine', 'allerg'], 'No diabetes or regular medication. No medication allergies.'],
      ['Transport', ['drive', 'home', 'help'], 'My partner drove me and can come along. I will not drive myself.'],
    ],
    personality: 'Initially reassured by preserved reading vision, then worried when told the peripheral shadow matters.',
    prior: ['Left cataract surgery follow-up', 'Uncomplicated left cataract extraction in a highly myopic eye. Central acuity satisfactory at last follow-up.'],
    teaching: ['A painless peripheral field defect can threaten sight even before central acuity falls.', 'Document acuity, laterality, fields and retinal findings, and arrange immediate specialist assessment.', 'The simulator has no retinal surgery or evolving visual-field model; transfer is the endpoint, not a claim that the retina has repaired itself.'],
    safety: ['Explain immediate transfer and avoid self-driving', ['urgent', 'today', 'central vision', 'do not drive', 'partner'], 'Explain the need for immediate retinal service assessment while central vision is still present; arrange safe transport rather than routine follow-up.'],
  },
  traumatic_corneal_abrasion: {
    facts: [
      ['Time and side', ['when', 'hours', 'side', 'left'], 'The left eye was scratched about two hours ago.', true],
      ['Symptoms', ['pain', 'light', 'tear', 'gritty'], 'It stings five out of ten and waters. Bright light is uncomfortable but it is not a deep headache.'],
      ['Visual change', ['vision', 'blur', 'see', 'double'], 'It blurs with tears, then clears when I blink. No double vision or missing area.', true],
      ['Contamination', ['soil', 'chemical', 'plant', 'foreign'], 'No chemical, soil or plant matter. I rinsed gently with clean water.'],
      ['Previous eye problems', ['before', 'surgery', 'recur', 'eye disease'], 'No eye surgery, recurrent morning eye pain or previous corneal disease.'],
      ['Associated injury', ['head', 'hit', 'penetrat'], 'There was no other blow to the face or head.'],
      ['Medication and allergy', ['medicine', 'allerg', 'drops'], 'No regular medicine or drug allergies. I have not put any drops in.'],
      ['Medical risk', ['diabetes', 'immune', 'steroid'], 'No diabetes or immune-suppressing treatment.'],
      ['Practical follow-up', ['home', 'help', 'review', 'drive'], 'My partner can look after our child and drive me back if it gets worse.'],
    ],
    personality: 'Busy parent who wants safe pain relief and reassurance that the child has not caused permanent damage.',
    prior: ['Routine health review', 'No contact lens use, ocular surgery, corneal disease, diabetes or immunosuppression.'],
    teaching: ['Document visual acuity before attributing all blurred vision to a superficial scratch.', 'Look for retained foreign material, infection and penetration; these change the management and referral threshold.', 'Uncomplicated abrasions usually heal quickly. Provide pain relief and a locally appropriate eye-treatment plan with clear review instructions.'],
    safety: ['Explain eye treatment and early review', ['antibiotic ointment', 'eye ointment', '24 hours', '48 hours', 'worse vision'], 'Discuss a locally appropriate topical eye-treatment plan and review if pain or vision worsens or improvement is absent over 24 to 48 hours; topical preparations are not orderable in this catalog.'],
  },
};

export function completeSkin(c: import('../../types').CaseDef): void {
  const d = surfaceDetail[c.id];
  if (!d) return;
  c.persona.personality = d.personality;
  c.persona.behavior = ['Answer the question in the patient’s own words; do not announce a diagnosis or recite the whole history.', 'Explain relevant symptoms and negatives when asked, without inventing additional medical history.'];
  c.persona.facts.push(...d.facts.map(([label, keywords, text, key], i) => ({ id: `detail${i + 1}`, label, keywords, text, key: key ?? false })));
  c.presentation.encounters = [{ id: `${c.id}_prior`, date: '2025-10-14', type: 'Clinic', department: 'Primary care', reason: d.prior[0], summary: d.prior[1] }];
  c.teaching = [c.teaching[0], ...d.teaching];
  c.persona.counseling ??= [];
  c.persona.counseling.push({ id: 'safety_plan', label: d.safety[0], keywords: d.safety[1], description: d.safety[2] });
  c.scoring.critical.push({ id: 'safety_plan', label: d.safety[0], points: 4, rule: { type: 'counseled', ids: ['safety_plan'] } });
  c.physiology.limits = { ...c.physiology.limits, pain: [0, 10] };
  if (c.id === 'leg_cellulitis') {
    c.exam.gen_appearance = 'Comfortable, alert and well hydrated. Walks normally without toxicity.';
    c.exam.msk_neurovascular = 'Normal distal pulses and sensation. Ankle and knee move freely without joint pain; no diffuse calf swelling.';
    c.labs = { wbc: 9.6, crp: 22, creat: 0.9, glu: 96, glu_poc: 96 };
    c.physiology.baseline.glucose = 96;
    c.truth.outcomeGood = 'The patient leaves with an oral treatment plan, marked or documented extent, and clear reassessment instructions.';
  }
  if (c.id === 'contact_dermatitis') {
    c.scoring.lowValue = [...viralStewardship.map(x => ({ ...x, why: 'This exposure-related eczematous rash has no evidence of bacterial infection.' }))];
    c.truth.outcomeGood = 'A skin-treatment and workplace-exposure plan is agreed, with review if the hands do not improve.';
    c.persona.behavior.push('Discuss concern about lost wages if asked about barriers to avoiding the cleaner.');
  }
  if (c.id === 'thoracic_zoster') {
    c.presentation.documentedHomeMeds = [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily', lastTaken: 'This morning' }];
    c.presentation.problemList = ['Hypertension'];
    c.presentation.priorLabs = [{ analyte: 'creat', value: 0.8, daysAgo: 60 }];
    c.labs = { creat: 0.8 };
    c.exam.heent_vision = 'Vision at baseline in each eye. No conjunctival injection, periorbital rash or nasal lesions.';
    c.exam.neuro_focal = 'No focal neurological deficit.';
    c.scoring.critical.push({ id: 'risk_screen', label: 'Check immune status and eye/neurologic symptoms', points: 4, rule: { type: 'fact', factIds: ['detail3', 'detail4'], all: true } });
    c.references.push('CDC. Clinical overview of shingles. https://www.cdc.gov/shingles/hcp/clinical-overview/index.html');
  }
  if (c.id === 'localized_impetigo') {
    c.persona.counseling.push({ id: 'topical_plan', label: 'Explain local topical antimicrobial treatment', keywords: ['mupirocin', 'retapamulin', 'fusidic acid', 'topical antibiotic', 'antibiotic cream', 'hydrogen peroxide'], description: 'Explain a locally recommended short topical antibiotic course or hydrogen peroxide 1% cream for these few localized non-bullous lesions. These preparations are not in the order catalog.' });
    c.scoring.critical.push({ id: 'topical_plan', label: 'Discuss appropriate topical treatment', points: 6, rule: { type: 'counseled', ids: ['topical_plan'] } });
    c.truth.outcomeGood = 'The patient understands local treatment, hygiene and restrictions on contact sport, with review if lesions spread.';
    c.references.push('NICE NG153. Impetigo: antimicrobial prescribing. https://www.nice.org.uk/guidance/ng153/chapter/recommendations');
  }
  if (c.id === 'minor_scald') {
    c.scoring.critical.push({ id: 'cooling_tetanus', label: 'Establish first aid and immunization status', points: 4, rule: { type: 'fact', factIds: ['hx2'] } });
    c.scoring.lowValue = [...viralStewardship.map(x => ({ ...x, why: 'A small uncomplicated fresh scald without infection does not need routine systemic antibiotic prophylaxis.' }))];
    c.truth.outcomeGood = 'Comfort is improved and a dressing and early wound-review plan are agreed; the burn remains visible and has not instantly healed.';
  }
  if (c.id === 'anterior_epistaxis') {
    c.presentation.triageVitals = { ...c.presentation.triageVitals, hr: 78, sbp: 136, dbp: 82 };
    c.physiology.baseline = { ...c.physiology.baseline, hr: 78, sbp: 136, dbp: 82 };
    c.exam.gen_appearance = 'Comfortable, no pallor, diaphoresis or ongoing bleeding.';
    c.labs = { hgb: 14.5, plt: 238, inr: 1.0 };
    c.truth.outcomeGood = 'Bleeding is controlled; the patient can demonstrate sustained pressure and knows when recurrent bleeding requires help.';
  }
  if (c.id === 'peritonsillar_abscess') {
    c.exam.heent_mucosa = 'Trismus, dry mucosa, right soft palate bulge and leftward uvular deviation. Muffled voice. Handles saliva; no floor-of-mouth swelling.';
    c.labs = { wbc: 16.5, neut: 82, bands: 2, lymph: 10, mono: 5, eos: 1, crp: 86, na: 138, k: 3.8, bun: 23, creat: 1.0, hcg_u: 'Negative' };
    c.physiology.drift = { hr: 1.5 };
    c.physiology.limits = { ...c.physiology.limits, hr: [80, 120], temp: [36.5, 39.5] };
    c.physiology.effects.push({ tag: 'fluids', delta: { hr: -10 }, tauMin: 15, maxUnits: 1 });
    c.physiology.triggers = [{ id: 'throat_reassessment', when: { afterMin: 30 }, page: { from: 'nurse', priority: 'urgent', text: 'The patient with the painful swollen throat still cannot drink. Breathing remains quiet. Please reassess the airway and transfer plan.' } }];
    c.scoring.critical.push({ id: 'hydrate', label: 'Treat dehydration with IV fluid', points: 4, rule: { type: 'given', tags: ['fluids'] } }, { id: 'analgesia', label: 'Provide parenteral analgesia while swallowing is difficult', points: 4, rule: { type: 'given', codes: ['morphine', 'fentanyl', 'ketorolac'] } });
    const abx = c.scoring.critical.find(x => x.rule.type === 'given');
    if (abx) abx.rule = { type: 'any', rules: [{ type: 'given', codes: ['amp_sulb'] }, { type: 'all', rules: [{ type: 'given', codes: ['ceftriaxone'] }, { type: 'given', codes: ['metronidazole'] }] }] };
    c.consults[0].guard = { type: 'exam', maneuvers: ['pulm_effort', 'heent_mucosa'] };
    c.consults[0].declineHint = 'Describe the airway, ability to handle saliva, hydration and asymmetric throat findings.';
    c.consults[0].onAccept.note = { title: 'ENT transfer accepted', text: 'Urgent ENT assessment and drainage capability requested. Continue airway observation, parenteral antibiotics, hydration and analgesia during transfer arrangements.' };
    c.scoring.harms.push({ id: 'unsafe_home', label: 'Discharge despite inability to drink and unresolved abscess', penalty: 16, rule: { type: 'dispo', decisions: ['discharge'] }, teaching: 'This patient needs urgent specialist source-control assessment and monitored treatment; reduced pain alone does not establish safe discharge.' });
  }
  if (c.id === 'viral_pharyngitis') {
    c.exam.pulm_effort = 'Speaks full sentences without stridor or respiratory distress.';
    c.exam.gen_appearance = 'Well appearing and hydrated; tolerates water.';
    c.scoring.critical.push({ id: 'red_flags', label: 'Check swallowing and deep-neck warning symptoms', points: 4, rule: { type: 'fact', factIds: ['hx2', 'detail3'], all: true } });
  }
  if (c.id === 'acute_otitis_externa') {
    c.presentation.documentedHomeMeds = [{ name: 'Ibuprofen', dose: '400 mg', sig: 'Single dose for ear pain', lastTaken: 'This morning' }];
    c.persona.counseling.push({ id: 'topical_delivery', label: 'Explain appropriate topical ear treatment and delivery', keywords: ['ear drops', 'topical', 'drops', 'wick'], description: 'Select appropriate topical therapy after checking the tympanic membrane, show drop delivery, and arrange a wick or specialist help if swelling blocks delivery. Otic preparations are not in this catalog.' });
    c.scoring.critical.push({ id: 'topical_delivery', label: 'Discuss topical therapy and delivery', points: 6, rule: { type: 'counseled', ids: ['topical_delivery'] } });
    c.scoring.lowValue = [...viralStewardship.map(x => ({ ...x, why: 'This uncomplicated canal infection has no extension or host risk warranting routine systemic antibiotics.' }))];
  }
  if (c.id === 'subconjunctival_hemorrhage') {
    c.presentation.documentedHomeMeds = [{ name: 'Losartan', dose: '50 mg', sig: 'PO daily', lastTaken: 'This morning' }];
    c.presentation.problemList = ['Hypertension'];
    c.presentation.triageVitals = { ...c.presentation.triageVitals, sbp: 138, dbp: 84 };
    c.physiology.baseline = { ...c.physiology.baseline, sbp: 138, dbp: 84 };
    c.exam.heent_fluorescein = 'No corneal epithelial defect or aqueous leakage.';
    c.exam.heent_fundus = 'No retinal hemorrhage or detachment seen.';
    c.scoring.critical.push({ id: 'bleeding_risks', label: 'Check bleeding history and antithrombotic use', points: 4, rule: { type: 'fact', factIds: ['detail5', 'detail6'], all: true } });
    c.references.push('Guy’s and St Thomas’. Sub-conjunctival haemorrhage. https://www.guysandstthomas.nhs.uk/health-information/sub-conjunctival-haemorrhage');
  }
  if (c.id === 'rhegmatogenous_retinal_detachment') {
    c.exam.heent_pupils = 'Pupils reactive; no definite afferent defect on this examination. A normal pupil response does not exclude the retinal finding.';
    c.exam.neuro_focal = 'No weakness, speech disturbance or homonymous field defect; the visual deficit is monocular.';
    c.consults[0].guard = { type: 'exam', maneuvers: ['heent_vision'] };
    c.consults[0].declineHint = 'Report the affected eye, acuity and field defect; do not delay urgent referral if a complete retinal examination is unavailable.';
    c.consults[0].onAccept.note = { title: 'Retinal service transfer', text: 'New left monocular field shadow with flashes and floaters, preserved central acuity and suspected macula-on detachment. Immediate retinal specialist assessment arranged.' };
    c.scoring.harms.push({ id: 'unsafe_home', label: 'Discharge without urgent retinal assessment', penalty: 20, rule: { type: 'dispo', decisions: ['discharge'] }, teaching: 'Preserved central acuity does not make a new retinal field defect safe for routine outpatient follow-up.' });
    c.truth.outcomeGood = 'The patient is transferred urgently for definitive retinal assessment while central acuity remains preserved; surgery and subsequent vision are outside this encounter.';
    c.references.push('NHS. Detached retina. https://www.nhs.uk/conditions/detached-retina-retinal-detachment/');
  }
  if (c.id === 'traumatic_corneal_abrasion') {
    c.exam.heent_pupils = 'Equal, round, reactive pupils with no afferent defect.';
    c.scoring.critical.push({ id: 'mechanism_lenses', label: 'Check injury mechanism and contact lens use', points: 4, rule: { type: 'fact', factIds: ['hx1', 'hx2'], all: true } });
    c.references.push('College of Optometrists. Corneal abrasion clinical management guideline, 2025. https://www.college-optometrists.org/clinical-guidance/clinical-management-guidelines/cornealabrasion');
    c.truth.outcomeGood = 'Visual acuity is preserved, a simple abrasion is identified, and pain relief, eye care and reassessment instructions are agreed.';
  }
}
