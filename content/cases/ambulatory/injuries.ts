import type { CaseBrief } from '../brief';
import { examine, given, order, senior, unsafeDischarge } from './checkpoints';

const footTrauma = 'ACR Appropriateness Criteria. Acute trauma to the foot. https://acsearch.acr.org/docs/70546/Narrative/';
const ankleTrauma = 'BOASt. The management of ankle fractures. https://www.boa.ac.uk/resource/boast-12-pdf.html';

export const injuries: CaseBrief[] = [
  {
    id: 'stable_distal_fibula_fracture', specialty: 'orthopedics', age: 47, sex: 'F', difficulty: 1, esi: 4,
    complaint: 'Lateral ankle pain after missing a step', opening: 'I thought I had rolled it again, but I could not even stand up afterward.',
    facts: [['Mechanism', ['roll', 'how', 'fall', 'when'], 'My foot turned inward on the last stair and I landed sitting down.'],
      ['Weight bearing', ['walk', 'step', 'weight', 'stand'], 'I could not take four steps at the time or here.']],
    exam: { msk_lat_malleolus: 'Focal bony tenderness at the posterior distal fibula.', msk_med_malleolus: 'No medial tenderness.', msk_ankle_inspect: 'Lateral swelling without deformity or skin compromise.', msk_weight_bearing: 'Unable to take four steps because of pain.', neuro_gait: 'Unable to stand without support.' },
    diagnosis: 'Stable nondisplaced lateral malleolus fracture', synonyms: ['lateral malleolus fracture', 'distal fibula fracture', 'fibular fracture', 'ankle fracture'], icd10: 'S82.65XA',
    disposition: 'discharge', mobility: 'wheelchair', vitals: { pain: 6 },
    imaging: { xr_ankle: 'Nondisplaced fracture below the syndesmosis at the left lateral malleolus. Mortise congruent with no talar shift.' },
    steps: [order('Obtain ankle radiographs', 'xr_ankle'), order('Provide ankle support', 'ankle_brace', 'splint_posterior')],
    counseling: ['Arrange fracture follow-up', ['fracture clinic', 'orthoped', 'orthopaed', 'follow-up'], 'Discuss fracture support, an individualized weight-bearing plan and review.'],
    teaching: 'Bony tenderness and inability to take four steps warrant ankle films. Check the medial side, skin and distal circulation.', references: [ankleTrauma],
  },
  {
    id: 'jones_fracture', specialty: 'orthopedics', age: 22, sex: 'M', difficulty: 2, esi: 4,
    complaint: 'Outer foot pain after changing direction', opening: 'I turned to run and felt a crack along the outside of my foot.',
    facts: [['Pivot injury', ['turn', 'how', 'sport', 'happen'], 'I pivoted on the ball of my foot during practice. The ankle itself feels all right.'],
      ['Immediate disability', ['walk', 'step', 'weight', 'stand'], 'I was carried off. Trying to stand puts all the pain at the outside edge.']],
    exam: { msk_5th_mt: 'Marked tenderness just distal to the tuberosity on the right fifth metatarsal.', msk_ankle_inspect: 'Swelling and bruising along the lateral midfoot.', msk_weight_bearing: 'Cannot bear weight.' },
    diagnosis: 'Jones fracture of the right fifth metatarsal', synonyms: ['jones fracture', 'fifth metatarsal fracture', '5th metatarsal fracture'], icd10: 'S92.354A',
    disposition: 'discharge', mobility: 'wheelchair', vitals: { pain: 6 },
    imaging: { xr_foot: 'Nondisplaced transverse fracture at the metaphyseal-diaphyseal junction of metatarsal five, extending to the fourth-fifth intermetatarsal articulation.' },
    steps: [order('Image the foot', 'xr_foot'), order('Immobilize the foot', 'splint_posterior'), order('Provide crutches', 'crutches')],
    counseling: ['Protect from weight bearing and arrange early specialist review', ['non-weight', 'nonweight', 'no weight', 'stay off'], 'Explain why loading may compromise healing and arrange orthopedic review.'],
    teaching: 'A zone-two fifth metatarsal fracture has a higher risk of delayed union than a tuberosity avulsion.', references: [footTrauma],
  },
  {
    id: 'lisfranc_injury', specialty: 'orthopedics', age: 36, sex: 'M', difficulty: 3, esi: 3,
    complaint: 'Swollen midfoot after a low-speed fall', opening: 'It did not look like much of a fall. The bruise under my foot looks strange.',
    facts: [['Loaded plantarflexed foot', ['how', 'mechanism', 'fall', 'foot'], 'My toes were pointed down when someone fell onto the back of my heel.'],
      ['Inability to push off', ['walk', 'step', 'weight', 'push'], 'I cannot push off at all. My ankle moves without much pain.']],
    exam: { msk_ankle_inspect: 'Plantar midfoot ecchymosis with dorsal swelling. Skin intact.', msk_weight_bearing: 'Cannot bear weight.', msk_neurovascular: 'Foot perfused with intact toe sensation.' },
    diagnosis: 'Unstable Lisfranc fracture-dislocation', synonyms: ['lisfranc injury', 'lisfranc fracture', 'lisfranc dislocation', 'tarsometatarsal injury'], icd10: 'S93.324A',
    disposition: 'admit_floor', consultant: 'ortho', vitals: { pain: 7 },
    imaging: { xr_foot: 'Right first-second metatarsal bases separated by 5 mm, with a small fleck fragment and dorsal subluxation at the tarsometatarsal joint.' },
    steps: [order('Obtain foot radiographs', 'xr_foot'), order('Immobilize the unstable midfoot', 'splint_posterior')],
    teaching: 'Plantar bruising after axial loading of a plantarflexed foot warrants assessment for a Lisfranc injury. Displacement requires urgent orthopedic review.', references: [footTrauma],
  },
  {
    id: 'achilles_rupture', specialty: 'orthopedics', age: 42, sex: 'F', difficulty: 2, esi: 4,
    complaint: 'A pop behind the ankle during a game', opening: 'I turned around to see who kicked me. There was nobody there.',
    facts: [['Sudden push-off injury', ['how', 'happen', 'sport', 'pop'], 'I pushed off to sprint and felt a snap above my heel.'],
      ['Lost push-off', ['step', 'walk', 'tiptoe', 'weak'], 'I can shuffle flat-footed but cannot rise onto my toes.']],
    exam: { msk_thompson: 'Calf squeeze fails to produce plantarflexion on the symptomatic side.', msk_ankle_inspect: 'Palpable gap three centimeters above the left calcaneal insertion.', neuro_gait: 'Flat-footed gait with absent push-off.' },
    diagnosis: 'Acute Achilles tendon rupture', synonyms: ['achilles rupture', 'achilles tear', 'ruptured achilles', 'achilles tendon tear'], icd10: 'S86.012A',
    disposition: 'discharge', mobility: 'wheelchair', vitals: { pain: 5 },
    imaging: { xr_ankle: 'No fracture or avulsion.' },
    steps: [order('Splint and protect the tendon', 'splint_posterior'), order('Provide walking aids', 'crutches')],
    counseling: ['Explain splint position and prompt specialist review', ['plantarflex', 'toes down', 'orthoped', 'orthopaed'], 'Protect the ankle in plantarflexion until prompt review in the local Achilles pathway.'],
    teaching: 'A sudden pop, loss of push-off and abnormal calf-squeeze test support complete Achilles rupture.',
    references: ['AAOS OrthoInfo. Achilles tendon tears. https://orthoinfo.aaos.org/en/diseases--conditions/achilles-tendon-rupture-tear/'],
  },
  {
    id: 'metatarsal_stress_fracture', specialty: 'orthopedics', age: 29, sex: 'F', difficulty: 2, esi: 4,
    complaint: 'Forefoot pain after increasing running distance', opening: 'At first it only hurt at the end of a run. This week it started hurting on my walk to work.',
    facts: [['Abrupt training change', ['run', 'train', 'activity', 'exercise'], 'I went from ten to thirty kilometers a week in a month. No single injury.'],
      ['Focal load pain', ['where', 'rest', 'pain', 'weight'], 'I can point to one spot on top of my foot. Rest helps.']],
    exam: { msk_ankle_inspect: 'Localized swelling and point tenderness over the left second metatarsal shaft.', msk_weight_bearing: 'Able to walk with a limp. Forefoot loading provokes pain.' },
    diagnosis: 'Second metatarsal stress fracture', synonyms: ['metatarsal stress fracture', 'stress fracture', 'march fracture'], icd10: 'M84.375A',
    disposition: 'discharge', vitals: { pain: 4 }, imaging: { xr_foot: 'Focal periosteal callus with a thin transverse lucency at the second metatarsal shaft.' },
    steps: [order('Obtain foot radiographs', 'xr_foot')],
    counseling: ['Stop impact exercise during healing', ['rest', 'impact', 'running', 'training'], 'Discuss protection from painful loading and a graduated return after review.'],
    teaching: 'Focal bony pain after a jump in training load suggests a stress injury. Early films can be normal.',
    references: ['AAOS OrthoInfo. Stress fractures. https://orthoinfo.aaos.org/en/diseases--conditions/stress-fractures'],
  },
  {
    id: 'plantar_fasciopathy', specialty: 'musculoskeletal', age: 52, sex: 'M', difficulty: 1, esi: 5,
    complaint: 'Heel pain with the first steps of the day', opening: 'Stepping out of bed is the worst bit. Can a heel spur do this?',
    facts: [['First-step pattern', ['morning', 'start', 'rest', 'when'], 'The first few steps after sitting hurt most. It eases as I move.'],
      ['Mechanical load', ['work', 'shoe', 'activity', 'injury'], 'I stand on concrete all shift. I have not changed my shoes in ages. No injury.']],
    exam: { msk_ankle_inspect: 'Focal tenderness at the plantar medial calcaneal tubercle without erythema or swelling.', msk_weight_bearing: 'Walks independently with pain on the initial steps.' },
    diagnosis: 'Plantar fasciopathy', synonyms: ['plantar fasciitis', 'plantar fasciopathy'], icd10: 'M72.2', disposition: 'discharge', vitals: { pain: 3 },
    steps: [examine('Localize the tenderness and assess walking', 'msk_ankle_inspect', 'msk_weight_bearing')],
    counseling: ['Discuss stretching and supportive footwear', ['stretch', 'supportive shoe', 'footwear', 'arch support'], 'Discuss plantar fascia and calf stretches, footwear and temporary activity adjustment.'],
    teaching: 'Characteristic first-step pain with medial plantar heel tenderness is usually a clinical diagnosis.',
    references: ['NHS. Plantar fasciitis. https://www.nhs.uk/conditions/plantar-fasciitis/'],
  },
  {
    id: 'acute_leg_compartment_syndrome', specialty: 'orthopedics', age: 34, sex: 'M', difficulty: 3, esi: 2,
    complaint: 'Escalating calf pain after a crush injury', opening: 'The pain keeps getting worse. Now my toes are tingling.',
    facts: [['Crush injury', ['how', 'crush', 'when', 'work'], 'My lower leg was briefly trapped under a heavy cart four hours ago.'],
      ['Progression despite analgesia', ['worse', 'painkiller', 'medication', 'numb'], 'Pain tablets did nothing and the tingling is new.']],
    exam: { msk_neurovascular: 'Tense lower leg, extreme pain with passive toe stretch and altered first-web-space sensation. Foot pulses remain palpable.', msk_ankle_inspect: 'Tense swelling of the anterior leg compartments, skin intact.', msk_weight_bearing: 'Unable to bear weight due to severe pain.' },
    diagnosis: 'Acute traumatic compartment syndrome of the lower leg', synonyms: ['compartment syndrome', 'anterior compartment syndrome'], icd10: 'T79.A21A',
    disposition: 'or', consultant: 'ortho', vitals: { hr: 109, pain: 9 }, labs: { ck: 870 }, imaging: { xr_ankle: 'No acute ankle fracture.' },
    steps: [order('Keep fasting for emergency decompression', 'npo'), order('Provide IV access', 'iv_access'), senior],
    teaching: 'Palpable pulses do not exclude compartment syndrome. Escalating pain and stretch pain after crush injury warrant urgent orthopedic assessment.',
    harms: [unsafeDischarge('Delaying assessment and decompression can cause permanent muscle and nerve injury.')],
    references: ['BOASt. Diagnosis and management of compartment syndrome of the extremities. https://www.boa.ac.uk/resource/boast-10-pdf.html'],
  },
  {
    id: 'open_ankle_fracture', specialty: 'orthopedics', age: 58, sex: 'F', difficulty: 2, esi: 2,
    complaint: 'Deformed ankle with a wound after falling from steps', opening: 'The paramedics covered it. I do not want to look.',
    facts: [['Mechanism and wound', ['how', 'fall', 'wound', 'bleed'], 'I twisted my ankle under me on the garden steps. It cut straight through my sock.'],
      ['Tetanus history', ['vaccine', 'tetanus', 'immuniz', 'booster'], 'I had my childhood vaccines and a booster sixteen years ago.']],
    exam: { msk_ankle_inspect: 'Left ankle angulated with a 2 cm wound communicating with the fracture. Covered by a sterile dressing.',
      msk_neurovascular: 'Toes warm, capillary refill two seconds. Sensation intact.', msk_weight_bearing: 'Unsafe to test with an open unstable fracture.' },
    diagnosis: 'Open bimalleolar fracture of the left ankle', synonyms: ['open ankle fracture', 'open bimalleolar fracture', 'open fracture dislocation'], icd10: 'S82.842B',
    disposition: 'or', consultant: 'ortho', vitals: { hr: 104, pain: 8 }, imaging: { xr_ankle: 'Displaced bimalleolar fractures with lateral talar shift and soft-tissue gas at the medial wound.' },
    steps: [examine('Document skin and neurovascular status', 'msk_ankle_inspect', 'msk_neurovascular'), given('Give prompt IV fracture prophylaxis', 'cefazolin'), given('Update tetanus protection', 'tdap'), order('Image the ankle', 'xr_ankle')],
    teaching: 'Early IV antibiotic prophylaxis, sterile coverage, tetanus assessment and urgent orthopedic care are priorities in an open fracture.',
    references: ['BOASt. Open fractures. https://www.boa.ac.uk/resource/boast-4-pdf.html', 'CDC. Wound management to prevent tetanus. https://www.cdc.gov/tetanus/hcp/clinical-guidance/'],
  },
  {
    id: 'recurrent_podagra', specialty: 'rheumatology', age: 54, sex: 'M', difficulty: 1, esi: 4,
    complaint: 'Painful red great toe', opening: 'The weight of a bedsheet woke me. Last time it looked exactly like this.',
    facts: [['Previous crystal-proven flare', ['before', 'gout', 'past', 'prior'], 'They drew fluid from this toe last year and found urate crystals.'],
      ['Infection and injury history', ['fever', 'wound', 'injur', 'chills'], 'No fever, chills, skin breaks or recent injury. I otherwise feel well.']],
    exam: { msk_ankle_inspect: 'Right first metatarsophalangeal joint hot, swollen and tender. Skin intact. No cellulitis extending from the joint.' },
    diagnosis: 'Acute gout flare of the right first MTP joint', synonyms: ['gout', 'podagra', 'gouty arthritis'], icd10: 'M10.9',
    disposition: 'discharge', problems: ['Crystal-proven gout'], vitals: { pain: 7 },
    steps: [given('Treat the acute inflammatory pain', 'ibuprofen', 'ketorolac')],
    counseling: ['Discuss reassessment for infection', ['fever', 'worsen', 'spreading', 'return'], 'Explain that fever, spreading redness or failure to improve requires reassessment.'],
    teaching: 'Previous crystal confirmation and a typical attack favor gout. Evaluate for joint infection when the course or examination is atypical.',
    references: ['NICE NG219. Gout. https://www.nice.org.uk/guidance/ng219'],
  },
  {
    id: 'diabetic_foot_osteomyelitis', specialty: 'infectious diseases', age: 66, sex: 'M', difficulty: 2, esi: 3,
    complaint: 'Drainage from a long-standing foot ulcer', opening: 'There is a stain on my sock every day now, but the foot hardly hurts.',
    facts: [['Chronic neuropathic ulcer', ['when', 'ulcer', 'wound', 'numb'], 'There has been a hole under my big toe for six weeks. My feet have been numb for years.'],
      ['New infection signs', ['worse', 'drain', 'swelling', 'fever'], 'It began to smell this week. Yesterday the redness crossed the top of my foot.']],
    exam: { msk_ankle_inspect: 'Draining plantar ulcer at the left first metatarsal head with several centimeters of surrounding erythema. Bone palpable at the ulcer base.', msk_neurovascular: 'Reduced protective sensation bilaterally. Distal pulses present.' },
    diagnosis: 'Diabetic foot osteomyelitis', synonyms: ['foot osteomyelitis', 'osteomyelitis', 'diabetic foot infection'], icd10: 'E11.69',
    disposition: 'admit_floor', consultant: 'hosp', problems: ['Type 2 diabetes', 'Peripheral neuropathy'],
    vitals: { hr: 97, temp: 37.9, pain: 2 }, labs: { esr: 94, crp: 114, wbc: 13.2, glu: 252 },
    imaging: { xr_foot: 'Ulcer over the left first metatarsal head with underlying cortical erosion and periosteal reaction. No soft-tissue gas.' },
    steps: [order('Assess for bone involvement with a plain film', 'xr_foot'), order('Measure inflammatory markers', 'crp', 'esr')],
    teaching: 'A deep ulcer with exposed bone, an abnormal radiograph and inflammatory markers supports osteomyelitis. Assess perfusion and arrange infection and surgical review.',
    references: ['IWGDF/IDSA. Diabetes-related foot infections. https://www.idsociety.org/practice-guideline/diabetic-foot-infections/'],
  },
];

// Additional authored history and chart context; these are fictional encounters, not source patients.
// Keep background facts available without making every social detail a scored history item.
type InjuryDetail = {
  facts: [label: string, keywords: string[], text: string, key?: boolean][];
  personality: string;
  prior: [reason: string, summary: string];
  teaching: string[];
  safety: [label: string, keywords: string[], description: string];
};
const injuryDetail: Record<string, InjuryDetail> = {
  stable_distal_fibula_fracture: {
    facts: [
      ['Time and side', ['time', 'hours', 'side', 'left'], 'It was my left ankle, about two hours ago. It swelled within half an hour.', true],
      ['Pain location', ['pain', 'where', 'radiat'], 'Six out of ten at the outside ankle bone, not the sole or up by my knee.', true],
      ['No syncope or associated injury', ['faint', 'dizzy', 'head', 'neck'], 'I simply missed the step. No dizziness, blackout, head strike or other injury.'],
      ['Distal symptoms', ['numb', 'tingl', 'cold', 'toes'], 'My toes feel normal and I can move them. There is no cut or bleeding.', true],
      ['Previous ankle injury', ['previous', 'before', 'sprain'], 'I sprained this ankle years ago, but had no pain or instability before today.'],
      ['Health and medication', ['medicine', 'medication', 'diabetes', 'kidney'], 'I have no diabetes, circulation trouble or kidney disease. I take no daily medicine.'],
      ['Analgesia and allergies', ['allerg', 'painkiller', 'taken'], 'I took paracetamol 1 gram an hour ago. It helped a little. No medication allergies.'],
      ['Safe mobility at home', ['home', 'stairs', 'help', 'work'], 'My partner can collect me. Our flat has a lift and I can work from home this week.', true],
      ['Thrombosis history', ['clot', 'thrombo', 'hormone', 'smok'], 'No previous blood clot. I do not smoke or take hormone treatment.'],
    ],
    personality: 'Practical office worker, concerned about stairs and how much weight the injured leg can take.',
    prior: ['Previous ankle sprain', 'Remote left lateral ankle sprain treated with rehabilitation; returned to unrestricted activity. No diabetes, neuropathy or vascular disease.'],
    teaching: ['A congruent mortise and an isolated distal fracture support stability; reassess if medial or proximal findings suggest a different pattern.', 'Give an explicit weight-bearing and support plan. Stable fractures may bear weight as tolerated; uncertain stability needs timely review.', 'Analgesia can improve comfort without making the fracture disappear. Check circulation and sensation after support is applied.'],
    safety: ['Explain support warning signs and safe walking', ['numb', 'blue toes', 'cold toes', 'tight', 'weight bearing'], 'Explain return for increasing pain, numbness, cold or discolored toes, and a support and weight-bearing plan suitable for the stable fracture.'],
  },
  jones_fracture: {
    facts: [
      ['Onset', ['when', 'hours', 'time'], 'The injury was ninety minutes ago during football practice. There was no pain before that.', true],
      ['Site and severity', ['pain', 'where', 'side'], 'Six out of ten on the outer right midfoot, a little forward of the ankle.', true],
      ['Skin and sensation', ['numb', 'tingl', 'wound', 'skin'], 'No wound or numbness. My toes still move normally.', true],
      ['Other injury', ['head', 'knee', 'elsewhere', 'fall'], 'I sat straight down. I did not hit my head, knee or anything else.'],
      ['Prior stress symptoms', ['previous', 'weeks', 'training', 'before'], 'No aching there in the weeks before today, and I have never broken that foot.'],
      ['Medical risks', ['diabetes', 'smok', 'health', 'kidney'], 'No diabetes or circulation problems. I do not smoke.'],
      ['Medication and allergy', ['medicine', 'medication', 'allerg'], 'No regular medicine and no known drug allergy. I have not taken a painkiller yet.'],
      ['Sporting priorities', ['sport', 'competition', 'goal', 'work'], 'I play in a regional league. I want to heal properly, even if it means missing the next match.'],
      ['Home support', ['home', 'stairs', 'help', 'crutches'], 'My roommate can help. I used crutches once before and can stay downstairs.', true],
    ],
    personality: 'Competitive amateur player who initially underestimates the time needed for healing.',
    prior: ['Sports examination', 'Preseason assessment: unrestricted exercise, no previous stress fracture or chronic illness.'],
    teaching: ['Locate the fracture relative to the fifth metatarsal tuberosity; a Jones fracture is not interchangeable with a simple avulsion.', 'Protect the fracture from loading while arranging early orthopedic advice; athlete preferences may influence definitive treatment.', 'Return for new numbness, a tight splint or worsening swelling. Healing is measured in weeks, not an ED shift.'],
    safety: ['Arrange early fracture review and splint precautions', ['fracture clinic', 'orthoped', 'orthopaed', 'numb', 'tight splint'], 'Arrange early orthopedic follow-up and describe neurovascular warning signs while the foot is protected from weight bearing.'],
  },
  lisfranc_injury: {
    facts: [
      ['Timing and side', ['when', 'time', 'side', 'right'], 'It happened to the right foot three hours ago during a casual game.', true],
      ['Pain progression', ['pain', 'worse', 'severity'], 'Seven out of ten through the middle of the foot. The swelling has increased steadily.', true],
      ['Plantar bruising', ['bruise', 'sole', 'under'], 'The bruise on the sole appeared on the way here; that is what worried me.', true],
      ['Distal function', ['numb', 'tingl', 'cold', 'toes'], 'The toes are warm and I can feel them, although moving the foot hurts.'],
      ['Associated injuries', ['head', 'knee', 'ankle', 'other'], 'No head strike or knee pain. The pain is through the arch rather than the ankle.'],
      ['Medical background', ['diabetes', 'neuropathy', 'past', 'health'], 'No diabetes, numb feet or previous injury to this foot.'],
      ['Medications and allergies', ['medicine', 'allerg', 'painkiller'], 'No regular medications or allergies. I took 1 gram of paracetamol two hours ago.'],
      ['Last food', ['eat', 'food', 'last meal'], 'I ate a sandwich shortly before the game, about four hours ago.', true],
      ['Function and support', ['job', 'work', 'home', 'help'], 'I install flooring and spend all day on my feet. My partner is available to help.'],
    ],
    personality: 'Manual worker surprised that a low-energy injury can need surgery; asks about time off work.',
    prior: ['Primary care review', 'Previously independent, physically active; no diabetes, neuropathy or prior foot surgery.'],
    teaching: ['Plantar ecchymosis and midfoot pain after a loaded plantarflexed injury are important clues.', 'Protect an unstable midfoot and obtain urgent orthopedic review; do not insist on painful weight-bearing films when displacement is already demonstrated.', 'Imaging and analgesia do not restore joint stability. Recheck neurovascular status while awaiting definitive treatment.'],
    safety: ['Explain non-weight-bearing protection and urgent specialist care', ['non-weight', 'nonweight', 'stay off', 'unstable', 'surgery'], 'Explain that the displaced midfoot is unstable, requires protection from weight bearing and urgent orthopedic care.'],
  },
  achilles_rupture: {
    facts: [
      ['Timing and side', ['when', 'time', 'left', 'side'], 'It happened to my left leg about two hours ago at badminton.', true],
      ['Pain course', ['pain', 'worse', 'severity'], 'It hurt sharply at first; now it aches, five out of ten. The weakness bothers me more.', true],
      ['Previous tendon symptoms', ['before', 'tendon', 'previous'], 'That heel had felt stiff after games for a month, but I had never torn anything.'],
      ['Medication exposure', ['antibiotic', 'steroid', 'cipro', 'medicine'], 'No recent antibiotic tablets, steroid tablets or steroid injections near the tendon.', true],
      ['Distal sensation', ['numb', 'tingl', 'cold', 'skin'], 'There is no wound and my toes feel normal.'],
      ['Health and allergies', ['diabetes', 'kidney', 'allerg', 'health'], 'No diabetes or kidney disease and no medication allergy. I take no regular medicine.'],
      ['Initial care', ['painkiller', 'ice', 'taken'], 'I put ice in a towel against it. I have not taken painkillers.'],
      ['Activity goals', ['sport', 'job', 'work', 'goal'], 'I play twice a week and teach at a school. I would like to get back to both safely.'],
      ['Mobility and thrombosis risk', ['home', 'stairs', 'clot', 'help'], 'My partner can help with the stairs. I have never had a blood clot or taken estrogen.', true],
    ],
    personality: 'Recreational athlete who can still shuffle and therefore wonders whether the tendon can really be torn.',
    prior: ['Routine health review', 'Active teacher; no chronic disease, daily medication or previous venous thrombosis.'],
    teaching: ['Some plantarflexion and flat-footed walking can remain despite a complete rupture.', 'Use the calf-squeeze test and clinical findings; avoid turning a straightforward diagnosis into a mandatory imaging exercise.', 'Protect the ankle in the position specified by the local tendon pathway and arrange prompt specialist review, with an individualized thrombosis assessment.'],
    safety: ['Discuss mobility, clot risk and urgent reassessment symptoms', ['clot', 'calf swelling', 'breathless', 'numb', 'follow-up'], 'Explain safe mobility and prompt specialist follow-up; assess thrombosis risk and explain new calf swelling, breathlessness or splint-related numbness.'],
  },
  metatarsal_stress_fracture: {
    facts: [
      ['Timeline', ['when', 'weeks', 'start'], 'It started three weeks ago. This week it hurts even on the walk to work.', true],
      ['Location', ['where', 'side', 'point'], 'One small spot over the top of my left second toe bone, not the heel or outer foot.', true],
      ['Rest and night symptoms', ['night', 'rest', 'wake'], 'It eases when I sit down and does not wake me at night.'],
      ['No inflammatory or neurologic symptoms', ['fever', 'red', 'numb', 'tingl'], 'No fever, spreading redness, numbness or tingling.'],
      ['Energy availability', ['diet', 'eat', 'weight', 'nutrition'], 'I have been skipping lunch to lose weight while increasing my running.', true],
      ['Menstrual history', ['period', 'menstrual', 'pregnan'], 'My periods have become irregular over the last six months. I am not taking hormonal contraception.', true],
      ['Bone and medication history', ['fracture', 'steroid', 'medicine', 'allerg'], 'No previous fracture, steroid use or regular medicine. No medication allergies.'],
      ['Footwear and recovery', ['shoe', 'rest day', 'training'], 'I kept my old shoes and rarely took a rest day.'],
      ['Home and work', ['work', 'home', 'help'], 'I work at a desk and can stop running. My partner can help with shopping.'],
    ],
    personality: 'Keen new runner, reluctant to mention dietary restriction until asked without judgment.',
    prior: ['Routine primary care review', 'Previously regular menstrual cycles and no fracture history. No prior bone-health investigation.'],
    teaching: ['Gradual focal pain with a rapid training increase suggests bone stress injury, even without a single traumatic event.', 'Assess energy intake, menstrual changes and bone-health risks as well as protecting the painful foot.', 'The radiograph shows a shaft stress fracture here; a negative early film would not exclude the diagnosis.'],
    safety: ['Arrange review of bone health and nutrition', ['nutrition', 'energy', 'periods', 'bone health', 'diet'], 'Arrange follow-up for low energy availability, menstrual disturbance and bone health, without blaming the patient or advising further weight loss.'],
  },
  plantar_fasciopathy: {
    facts: [
      ['Duration and side', ['when', 'long', 'side', 'left'], 'The left heel has hurt for six weeks. It crept up gradually.', true],
      ['Exact site', ['where', 'point', 'location'], 'Under the inside edge of my heel, rather than behind it.', true],
      ['Daily pattern', ['later', 'evening', 'shift'], 'It loosens after a few minutes, then aches again near the end of a long shift.'],
      ['No trauma or rest pain', ['fall', 'injury', 'night', 'rest pain'], 'No accident, and it does not wake me up once I am asleep.'],
      ['Neurologic symptoms', ['burn', 'tingl', 'numb', 'back'], 'No burning, tingling, numbness or pain coming down from my back.', true],
      ['Inflammatory symptoms', ['joint', 'stiff', 'rash', 'fever'], 'No other swollen joints, fever or prolonged stiffness elsewhere.'],
      ['Medication and health', ['medicine', 'diabetes', 'allerg'], 'I take no regular medicines, have no diabetes and know of no drug allergies.'],
      ['Measures tried', ['tried', 'painkiller', 'stretch'], 'I tried gel heel inserts but have not tried a stretching routine.'],
      ['Work adjustment', ['work', 'break', 'help'], 'My supervisor could give me seated tasks for part of the shift.'],
    ],
    personality: 'Warehouse worker hoping for a quick injection, receptive to a practical exercise and footwear plan.',
    prior: ['Occupational health review', 'Long standing shifts on concrete; no lower-limb neuropathy, inflammatory arthritis or previous foot injury.'],
    teaching: ['Use the site and first-step pattern to distinguish plantar fascial pain from neural, traumatic and inflammatory causes.', 'Improvement takes time; footwear, stretching and load adjustment are more useful than promising an immediate cure.', 'Routine imaging is unnecessary for this characteristic, uncomplicated presentation.'],
    safety: ['Set follow-up and atypical symptom precautions', ['two weeks', 'not improving', 'numb', 'night pain', 'review'], 'Arrange review if the plan is not helping and earlier assessment for swelling, redness, numbness or atypical rest/night pain.'],
  },
  acute_leg_compartment_syndrome: {
    facts: [
      ['Pain progression', ['scale', 'severity', 'constant'], 'Nine out of ten and constant now, much worse than when the cart was lifted.', true],
      ['Sensory evolution', ['tingl', 'numb', 'toes', 'sensation'], 'The space between my first two right toes started tingling about half an hour ago.', true],
      ['Mechanism details', ['minutes', 'trapped', 'duration'], 'The cart pinned my shin for about ten minutes. Nobody tightened a bandage around it.'],
      ['Prior analgesia', ['taken', 'dose', 'painkiller', 'medicine'], 'I took paracetamol 1 gram and ibuprofen 400 milligrams two hours ago; neither helped much.', true],
      ['Other injury and consciousness', ['head', 'blackout', 'chest', 'other'], 'I stayed awake and did not injure my head, chest or abdomen.'],
      ['Medical background', ['bleed', 'blood thinner', 'past', 'health'], 'No bleeding disorder or blood thinners, and no previous leg problems.'],
      ['Allergies', ['allerg'], 'No known medication allergies.'],
      ['Last intake', ['eat', 'drink', 'meal'], 'My last meal was about five hours ago. I had a few sips of water on the way.', true],
      ['Urine and systemic symptoms', ['urine', 'dark', 'weak', 'nausea'], 'I passed normal-looking urine after the accident. I feel sick from the pain.'],
      ['Support', ['family', 'contact', 'home'], 'My partner knows I am here and can come in. Please explain if I need an operation.'],
    ],
    personality: 'Usually stoic worker, increasingly frightened by pain that ordinary tablets have not relieved.',
    prior: ['Occupational health assessment', 'Previously healthy, independent adult without anticoagulant use, neuropathy or peripheral vascular disease.'],
    teaching: ['Normal foot pulses do not establish adequate muscle perfusion inside a tight compartment.', 'Escalation and surgical decompression are time-critical; pain relief must not substitute for serial examination.', 'Pressure measurement can help an uncertain or unreliable examination; an obvious clinical emergency must not wait for routine imaging.'],
    safety: ['Explain the urgent limb-threatening concern', ['pressure', 'muscle', 'nerve', 'urgent surgery', 'fasciotomy'], 'Explain that the swelling may threaten muscle and nerve function and that emergency orthopedic assessment and possible fasciotomy are required.'],
  },
  open_ankle_fracture: {
    facts: [
      ['Timing', ['when', 'time', 'hour'], 'I fell about forty minutes ago. The ambulance came straight here.', true],
      ['Wound contamination', ['soil', 'dirt', 'water', 'contamin'], 'It was a dry stone step, not a pond or farmyard. There was a little soil on my sock.', true],
      ['Distal symptoms', ['numb', 'tingl', 'cold', 'toes'], 'I can feel and wiggle my toes. They have not gone cold.', true],
      ['Associated trauma', ['head', 'neck', 'blackout', 'elsewhere'], 'No head strike, fainting, neck pain or injury elsewhere.'],
      ['Bleeding', ['blood', 'bleed', 'dizzy'], 'It bled through the sock, then slowed under the ambulance dressing. I have not felt faint.'],
      ['Last food', ['eat', 'meal', 'drink'], 'I finished breakfast two hours before the fall.', true],
      ['Medication and allergy', ['medicine', 'medication', 'allerg'], 'Amlodipine 5 milligrams each morning. No blood thinners or medication allergies.'],
      ['Healing risks', ['diabetes', 'smok', 'circulation', 'kidney'], 'No diabetes or circulation problems. I stopped smoking ten years ago.'],
      ['Baseline function', ['walk', 'before', 'home'], 'I normally walk without an aid and live with my spouse.'],
    ],
    personality: 'Anxious about the appearance of the injury; wants an explanation before the dressing is disturbed.',
    prior: ['Hypertension review', 'Blood pressure controlled with amlodipine 5 mg daily. Independent mobility; no diabetes, peripheral vascular disease or drug allergy.'],
    teaching: ['The wound communicates with the fracture even if the skin opening is small.', 'Give prompt IV prophylaxis using the local open-fracture pathway, protect the wound and obtain urgent orthopedic care.', 'Reassess distal circulation and sensation after alignment/support. Tetanus prophylaxis depends on wound type and immunization history.'],
    safety: ['Explain wound protection and operative treatment', ['debridement', 'operation', 'infection', 'sterile dressing', 'surgery'], 'Explain the infection risk, protective dressing and need for urgent operative wound and fracture management.'],
  },
  recurrent_podagra: {
    facts: [
      ['Onset and progression', ['when', 'hours', 'start'], 'It began overnight about ten hours ago and reached its worst by breakfast.', true],
      ['Joint distribution', ['other joint', 'where', 'side'], 'Only my right big-toe joint. The ankle, other toes and other foot feel fine.', true],
      ['Previous treatment', ['helped', 'last time', 'treatment'], 'Ibuprofen settled the last attack over several days.'],
      ['Flare frequency', ['often', 'year', 'frequency'], 'This is my third attack in a year. I have not discussed a preventive medicine yet.', true],
      ['Renal and gastrointestinal risk', ['kidney', 'ulcer', 'bleed', 'stomach'], 'No kidney disease, stomach ulcer or gastrointestinal bleeding.'],
      ['Medications and allergies', ['medicine', 'medication', 'allerg', 'blood thinner'], 'I take amlodipine 5 milligrams daily. No anticoagulants and no known drug allergy.'],
      ['Infection risks', ['injection', 'immune', 'diabetes', 'surgery'], 'No joint injections, immune-suppressing medicines, diabetes or recent surgery.', true],
      ['Possible triggers', ['alcohol', 'beer', 'food', 'dehydrat'], 'I had several beers at a celebration and drank little water yesterday.'],
      ['Functional impact', ['walk', 'work', 'home'], 'I can hobble but cannot fit my work shoe. My partner can help today.'],
    ],
    personality: 'Embarrassed about the celebration and worried he caused the illness; responds to nonjudgmental explanations.',
    prior: ['Crystal-proven monoarthritis', 'Previous aspiration from the right first MTP joint identified monosodium urate crystals; culture negative. Renal function normal at follow-up.'],
    teaching: ['Prior crystal confirmation supports gout but does not exclude a concurrent infection when new features suggest one.', 'Choose anti-inflammatory treatment around comorbidities and preferences; a single named NSAID is not the only valid option.', 'Recurrent attacks warrant follow-up to discuss long-term urate lowering. Do not present dietary blame as the whole management plan.'],
    safety: ['Arrange prevention review for recurrent attacks', ['urate lowering', 'allopurinol', 'prevention', 'recurrent', 'gp review'], 'Arrange follow-up to discuss urate-lowering therapy and monitoring because attacks are recurrent.'],
  },
  diabetic_foot_osteomyelitis: {
    facts: [
      ['Ulcer timeline', ['start', 'when', 'shoe', 'cause'], 'A tight new shoe rubbed the sole six weeks ago. It never closed.', true],
      ['Recent spread', ['redness', 'spread', 'days'], 'Drainage increased three days ago; redness spread beyond the toe yesterday.', true],
      ['Systemic symptoms', ['fever', 'chill', 'sick'], 'I felt shivery last night but have not vomited or felt confused.'],
      ['Diabetes treatment', ['insulin', 'medicine', 'medication'], 'Metformin 1 gram twice daily and insulin glargine 22 units every evening. I took both as usual.', true],
      ['Glucose control', ['sugar', 'glucose', 'meter'], 'My meter has been showing about 220 to 280 this week instead of my usual 150 to 180.', true],
      ['Vascular history', ['walk', 'calf', 'rest pain', 'circulation'], 'No calf pain when walking or pain at rest. Both feet have been numb for years.'],
      ['Previous infection and antibiotics', ['antibiotic', 'mrsa', 'prior', 'culture'], 'No recent antibiotics, previous resistant infection or prior amputation.'],
      ['Home wound care', ['dressing', 'podiatr', 'care', 'help'], 'I cover it myself but kept walking on it. My podiatry visit is next month.'],
      ['Medication allergy and smoking', ['allerg', 'smok'], 'No drug allergy. I stopped smoking five years ago.'],
      ['Support and preferences', ['home', 'family', 'worry'], 'My spouse can bring my medicines. I am afraid admission means losing my foot.'],
    ],
    personality: 'Underestimates the infection because neuropathy blunts pain; fears amputation and needs clear explanations.',
    prior: ['Diabetes and foot review', 'Type 2 diabetes with peripheral sensory neuropathy. Protective sensation reduced; skin intact at the prior visit. Metformin 1 g twice daily and insulin glargine 22 units nightly.'],
    teaching: ['Minimal pain does not imply mild infection in a neuropathic foot.', 'Describe ulcer depth, surrounding infection and perfusion; arrange appropriate tissue or bone sampling and specialist source-control advice.', 'Antibiotics, pressure off-loading, glycemic management and wound follow-up are complementary. Radiographic bone changes do not disappear during the ED shift.'],
    safety: ['Explain off-loading and coordinated foot care', ['offload', 'off-load', 'weight', 'foot team', 'wound care'], 'Explain protection from pressure, infection treatment and coordinated foot/surgical review rather than dressing the wound alone.'],
  },
};

export function completeInjuries(c: import('../../types').CaseDef): void {
  const d = injuryDetail[c.id];
  if (!d) return;
  c.persona.personality = d.personality;
  c.persona.behavior = ['Describe symptoms and concerns in ordinary language; do not recite a diagnosis or checklist.', 'Give the detail that answers the question, including relevant negatives when asked.'];
  c.persona.facts.push(...d.facts.map(([label, keywords, text, key], i) => ({ id: `detail${i + 1}`, label, keywords, text, key: key ?? false })));
  c.presentation.encounters = [{ id: `${c.id}_prior`, date: '2025-11-18', type: 'Clinic', department: 'Primary care', reason: d.prior[0], summary: d.prior[1] }];
  c.teaching = [c.teaching[0], ...d.teaching];
  c.persona.counseling ??= [];
  c.persona.counseling.push({ id: 'safety_plan', label: d.safety[0], keywords: d.safety[1], description: d.safety[2] });
  c.scoring.critical.push({ id: 'safety_plan', label: d.safety[0], points: 4, rule: { type: 'counseled', ids: ['safety_plan'] } });
  c.physiology.limits = { ...c.physiology.limits, pain: [0, 10] };
  // The short brief has a general exam checkpoint; specify the safety-critical maneuvers instead.
  const examByCase: Record<string, string[]> = {
    stable_distal_fibula_fracture: ['msk_lat_malleolus', 'msk_med_malleolus', 'msk_neurovascular'],
    jones_fracture: ['msk_5th_mt', 'msk_neurovascular'], lisfranc_injury: ['msk_ankle_inspect', 'msk_neurovascular'],
    achilles_rupture: ['msk_thompson', 'msk_neurovascular'], metatarsal_stress_fracture: ['msk_ankle_inspect', 'msk_weight_bearing'],
    plantar_fasciopathy: ['msk_ankle_inspect', 'msk_weight_bearing'], acute_leg_compartment_syndrome: ['msk_neurovascular'],
    open_ankle_fracture: ['msk_ankle_inspect', 'msk_neurovascular'], recurrent_podagra: ['msk_ankle_inspect'],
    diabetic_foot_osteomyelitis: ['msk_ankle_inspect', 'msk_neurovascular'],
  };
  const examStep = c.scoring.critical.find(x => x.rule.type === 'exam');
  if (examStep) { examStep.label = 'Perform the focused examination and relevant safety checks'; examStep.rule = { type: 'exam', maneuvers: examByCase[c.id] }; }
  c.exam.msk_neurovascular ??= 'Dorsalis pedis and posterior tibial pulses palpable, toes warm with refill under two seconds, sensation and toe movement intact.';
  if (['stable_distal_fibula_fracture', 'jones_fracture', 'lisfranc_injury', 'achilles_rupture', 'metatarsal_stress_fracture', 'open_ankle_fracture'].includes(c.id)) {
    c.scoring.critical.push({ id: 'analgesia', label: 'Provide analgesia suitable for this patient', points: 4, rule: { type: 'given', tags: ['analgesic', 'analgesic_mild'] } });
  }
  if (c.id === 'stable_distal_fibula_fracture') {
    c.exam.msk_5th_mt = 'No fifth metatarsal tenderness; navicular, proximal fibula and knee are nontender.';
    c.presentation.documentedHomeMeds = [{ name: 'Paracetamol', dose: '1 g', sig: 'Single dose for this injury', lastTaken: '1 hour before arrival' }];
    c.physiology.effects.push({ tag: 'brace', delta: { pain: -1 }, tauMin: 10, maxUnits: 1 });
    c.truth.outcomeGood = 'Pain is manageable, support and safe walking are arranged, and the patient knows when and where to seek review.';
  }
  if (c.id === 'jones_fracture') {
    c.exam.msk_lat_malleolus = 'No lateral malleolar tenderness.';
    c.exam.msk_med_malleolus = 'No medial malleolar tenderness.';
  }
  if (c.id === 'lisfranc_injury') {
    c.scoring.critical.push({ id: 'fasting', label: 'Keep fasting pending the operative plan', points: 4, rule: { type: 'order', codes: ['npo'] } });
    c.scoring.harms.push(unsafeDischarge('A displaced unstable Lisfranc injury needs an agreed urgent orthopedic plan, not unsupported discharge.'));
    c.consults[0].guard = { type: 'all', rules: [{ type: 'order', codes: ['xr_foot'] }, { type: 'exam', maneuvers: ['msk_neurovascular'] }] };
    c.consults[0].declineHint = 'Describe the midfoot radiographs, skin and distal neurovascular findings.';
  }
  if (c.id === 'achilles_rupture') c.exam.msk_neurovascular = 'Foot warm and perfused, toe movement and sensation intact. Active plantarflexion is weak but not absent.';
  if (c.id === 'metatarsal_stress_fracture') {
    c.scoring.critical.push({ id: 'bone_risk', label: 'Identify low energy availability or menstrual change', points: 4, rule: { type: 'fact', factIds: ['detail5', 'detail6'] } });
    c.exam.msk_neurovascular = 'Normal perfusion and sensation. No warmth or redness. Calcaneal squeeze and navicular palpation are nontender.';
  }
  if (c.id === 'plantar_fasciopathy') {
    c.exam.msk_neurovascular = 'Normal pulses, protective sensation and toe strength. Calcaneal squeeze is painless; passive toe extension reproduces plantar medial heel pain.';
    c.physiology.effects.push({ tag: 'rice', delta: { pain: -0.5 }, tauMin: 15, maxUnits: 1 });
  }
  if (c.id === 'acute_leg_compartment_syndrome') {
    c.presentation.documentedHomeMeds = [{ name: 'Paracetamol', dose: '1 g', sig: 'Single dose after injury', lastTaken: '2 hours before arrival' }, { name: 'Ibuprofen', dose: '400 mg', sig: 'Single dose after injury', lastTaken: '2 hours before arrival' }];
    c.labs = { ...c.labs, ck: { kind: 'series', points: [[0, 870], [120, 1650], [240, 2900]] }, creat: 0.9, k: 4.3, hgb: 14.4 };
    c.physiology.drift = { pain: 0.4, hr: 2 };
    c.physiology.limits = { pain: [0, 10], hr: [85, 125] };
    c.physiology.triggers = [{ id: 'persistent_compartment_signs', when: { afterMin: 25 }, page: { from: 'nurse', priority: 'critical', text: 'Pain and tingling in the crushed leg persist. Foot pulses remain present. Please reassess and expedite orthopedic review.' } }];
    // Definitive fasciotomy is outside the ED action set; accepting a phone call must not cure ischemia.
    c.consults[0].guard = { type: 'exam', maneuvers: ['msk_neurovascular'] };
    c.consults[0].declineHint = 'Report stretch pain, compartment tension and distal neurological findings; do not wait for routine films.';
    c.consults[0].onAccept.departAfterMin = 5;
    c.consults[0].onAccept.note = { title: 'Emergency orthopedic handoff', text: 'Clinical concern for acute compartment syndrome. Immediate operative assessment arranged. Continue serial neurovascular checks and analgesia while awaiting transport.' };
    c.truth.outcomeGood = 'The receiving orthopedic team takes over urgently for operative assessment; decompression and long-term limb outcome are not simulated in the ED.';
  }
  if (c.id === 'open_ankle_fracture') {
    c.presentation.documentedHomeMeds = [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily', lastTaken: 'This morning' }];
    c.presentation.problemList = ['Hypertension'];
    c.labs = { hgb: 12.8, wbc: 10.2, plt: 248, creat: 0.8, k: 4.1, inr: 1.0 };
    c.scoring.critical.push({ id: 'fasting', label: 'Keep fasting for operative treatment', points: 4, rule: { type: 'order', codes: ['npo'] } }, { id: 'iv_access', label: 'Establish IV access', points: 4, rule: { type: 'order', codes: ['iv_access'] } });
    c.scoring.critical.push({ id: 'support', label: 'Arrange protective splinting with the orthopedic team', points: 4, rule: { type: 'order', codes: ['splint_posterior'] } });
    c.scoring.harms.push(unsafeDischarge('An open displaced ankle fracture requires urgent specialist wound and fracture management.'));
    c.consults[0].guard = { type: 'exam', maneuvers: ['msk_ankle_inspect', 'msk_neurovascular'] };
    c.consults[0].declineHint = 'Describe the wound, deformity, skin and distal neurovascular findings; do not delay the call for antibiotics or imaging.';
    c.consults[0].onAccept.note = { title: 'Open-fracture handoff', text: 'Urgent orthopedic care accepted. Keep the wound protected and the patient fasting; continue IV prophylaxis and arrange trained alignment/splinting with repeat neurovascular assessment.' };
  }
  if (c.id === 'recurrent_podagra') {
    c.presentation.documentedHomeMeds = [{ name: 'Amlodipine', dose: '5 mg', sig: 'PO daily', lastTaken: 'This morning' }];
    c.presentation.priorLabs = [{ analyte: 'creat', value: 0.9, daysAgo: 90 }];
    c.labs = { creat: 0.9, wbc: 8.4, crp: 18 };
    c.persona.counseling.push({ id: 'antiinflammatory_plan', label: 'Select an appropriate anti-inflammatory course', keywords: ['colchicine', 'prednisolone', 'prednisone', 'oral steroid', 'naproxen', 'ibuprofen'], description: 'Choose an NSAID, low-dose colchicine or a short oral corticosteroid course after considering renal/GI risks, interactions and infection. Some options are not in the simulator order catalog.' });
    const treatment = c.scoring.critical.find(x => x.rule.type === 'given');
    if (treatment) treatment.rule = { type: 'any', rules: [treatment.rule, { type: 'counseled', ids: ['antiinflammatory_plan'] }] };
    c.truth.outcomeGood = 'An appropriate anti-inflammatory plan and review for recurrent gout are agreed, with instructions to return for features suggesting infection.';
  }
  if (c.id === 'diabetic_foot_osteomyelitis') {
    c.presentation.documentedHomeMeds = [{ name: 'Metformin', dose: '1 g', sig: 'PO twice daily', lastTaken: 'This morning' }, { name: 'Insulin glargine', dose: '22 units', sig: 'SC nightly', lastTaken: 'Last evening' }];
    c.presentation.priorLabs = [{ analyte: 'creat', value: 1.0, daysAgo: 90 }, { analyte: 'glu', value: 168, daysAgo: 90 }];
    c.labs = { ...c.labs, creat: 1.1, na: 136, k: 4.5, hco3: 24, hgb: 12.1, hct: 36.5, rbc: 4.10, mcv: 89, neut: 80, bands: 2, lymph: 12, mono: 5, eos: 1, lactate: 1.5 };
    c.persona.counseling.push({ id: 'infection_plan', label: 'Explain tissue sampling and antimicrobial treatment', keywords: ['tissue culture', 'bone culture', 'antibiotic', 'debridement'], description: 'Arrange appropriate tissue or bone sampling and systemic antimicrobial treatment with the foot/surgical team, guided by infection severity, local policy and subsequent cultures.' });
    c.scoring.critical.push({ id: 'infection_plan', label: 'Address infection treatment and sampling', points: 4, rule: { type: 'counseled', ids: ['infection_plan'] } },
      { id: 'empiric_iv', label: 'Begin IV antimicrobial treatment for severe foot infection', points: 8,
        rule: { type: 'any', rules: [{ type: 'given', codes: ['amp_sulb', 'pip_tazo'] }, { type: 'all', rules: [{ type: 'given', codes: ['ceftriaxone'] }, { type: 'given', codes: ['metronidazole'] }] }] },
        teaching: 'Select empiric IV therapy using local policy and resistance risks, then narrow to reliable cultures. There is no history requiring routine MRSA or Pseudomonas coverage here.' },
      { id: 'urgent_review', label: 'Request urgent senior help coordinating surgical foot review', points: 6, rule: { type: 'escalated' } });
    c.teaching.push('Tachycardia and leukocytosis meet two systemic inflammatory criteria, making this a severe diabetic foot infection in the IWGDF/IDSA classification despite preserved blood pressure. Begin IV antibiotics and arrange urgent surgical assessment.');
    c.consults[0].guard = { type: 'any', rules: [{ type: 'exam', maneuvers: ['msk_ankle_inspect', 'msk_neurovascular'] }, { type: 'escalated' }] };
    c.consults[0].declineHint = 'Describe ulcer depth, systemic infection signs and distal perfusion; do not delay referral for imaging or culture results.';
    c.consults[0].onAccept.note = { title: 'Diabetic foot admission', text: 'Admit for severe diabetic foot infection with suspected osteomyelitis: tachycardia and leukocytosis, currently without shock. Begin IV antibiotics and request urgent surgical/foot-team review, appropriate cultures, off-loading and glucose management.' };
    c.scoring.harms.push(unsafeDischarge('Spreading infection with probable bone involvement needs an agreed multidisciplinary treatment plan.'));
  }
}
