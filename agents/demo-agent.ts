/**
 * Scripted reference agent (no LLM) that plays a shift through the HTTP API. It shows the
 * action space end-to-end, gives a deterministic baseline score, and — when someone watches —
 * narrates its clinical reasoning, so it doubles as a free reference walkthrough in observe
 * mode (menu → "Watch an AI doctor" → Scripted demo).
 *
 *   npm start                                    # in one terminal (or: npx tsx server/index.ts --llm offline)
 *   npm run agent:demo                           # Night Shift, seed 2024, full speed (~87%)
 *   npm run agent:demo -- --pace 1.5             # watchable: 1.5 s between actions, think-aloud feed on
 *   npm run agent:demo -- --map orientation      # Orientation Day walkthrough
 *   npm run agent:demo -- --session <id>         # play a session created elsewhere (POST /api/observe does this)
 *
 * Flags: --map night_shift|orientation, --seed N (env SEED), --pace SECONDS, --session ID,
 * --narrate (think aloud even at full speed). NPCs are offline (deterministic) unless NPC_LLM is set.
 */
import { EXAM_BY_ID, ORDERS } from '../shared/catalog';
import type { Action, ActionResult, Debrief, OrderParams } from '../shared/types';
import { AgentClinicClient, type AgentObservation } from './client';
import { Narrator } from './narration';

const argv = process.argv.slice(2);
const opt = (k: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
const api = new AgentClinicClient();
const seed = Number(opt('seed') ?? process.env.SEED ?? 2024);
const pace = opt('pace') !== undefined ? Number(opt('pace')) : undefined;
const attachTo = opt('session');

// launched by the game server (observe mode): leave when the server goes away or asks us to
if (process.send) {
  process.channel?.unref();
  process.on('disconnect', () => process.exit(0));
}
process.on('SIGTERM', () => process.exit(0));

type Obs = AgentObservation & { result: ActionResult; view?: { mapId: string } };
let sid: string;
let map = opt('map') ?? process.env.MAP ?? 'night_shift';
let last: Obs;
if (attachTo) {
  const o = (await api.observe(attachTo)) as Obs;
  sid = attachTo;
  map = o.view?.mapId ?? map;
  last = { ...o, result: { ok: true } };
  console.log(`playing session ${sid} (${map})\n`);
} else {
  const start = await api.start(map, { seed, playerName: 'Scripted baseline', llm: process.env.NPC_LLM ?? 'offline', pace });
  sid = start.sessionId;
  last = { ...start, result: { ok: true } };
  console.log(`session ${sid} — watch in 3D: ${start.spectateUrl}\n`);
}

// think aloud only when someone can watch (observe mode, --pace) — at full speed it would just flood the feed
const narrating = !!attachTo || (pace ?? 0) > 0 || argv.includes('--narrate');
const narrator = new Narrator(api.baseUrl);
if (narrating) narrator.setSession(sid);

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const pidOf = (a: Action) => ('patientId' in a ? a.patientId : a.type === 'talk' && a.npcId.startsWith('pt_') ? a.npcId.slice(3) : undefined);

function think(text: string, patientId?: string) {
  console.log(`💭 ${text}`);
  if (narrating) narrator.say('thought', text, patientId);
}

async function act(label: string, action: Action) {
  if (narrating) narrator.say('action', `→ ${label}`, pidOf(action));
  last = (await api.act(sid, action)) as Obs;
  const r = last.result;
  const text = (r.text ?? r.message ?? '').replace(/\s+/g, ' ').trim();
  console.log(`[${last.clock}] ${label}: ${r.ok ? '✓' : '✗'} ${text.slice(0, 160)}`);
  // the key part of the result: what people said, what the exam/disposition showed, and every failure
  if (narrating && text && (!r.ok || ['talk', 'call', 'examine', 'inspect', 'disposition'].includes(action.type))) {
    narrator.say('result', !r.ok ? `✗ ${clip(text, 240)}` : action.type === 'talk' || action.type === 'call' ? `↳ “${clip(text, 280)}”` : `↳ ${clip(text, 280)}`, pidOf(action));
  }
  return last;
}

const order = (pid: string, code: string, params?: OrderParams) => act(`order ${ORDERS[code]?.name ?? code}${params?.dose ? ` ${params.dose}` : ''}`, { type: 'order', patientId: pid, code, params });
const exam = (pid: string, m: string) => act(`examine: ${EXAM_BY_ID[m]?.label ?? m}`, { type: 'examine', patientId: pid, maneuver: m });

/** current (non-historical) values of an analyte in read_chart labs text: "… (lactate) […]: 4.1 H @22:31 → 2.3 H @23:40" → ["4.1 H", "2.3 H"] */
function labSeries(text: string | undefined, code: string): string[] {
  const m = new RegExp(`\\(${code}\\) \\[[^\\]]*\\]: (.+)$`, 'm').exec(text ?? '');
  return m ? m[1].split(' → ').filter((v) => !v.includes('(historical)')).map((v) => v.replace(/\s*@.*$/, '').trim()) : [];
}
const labValue = (text: string | undefined, code: string) => labSeries(text, code).pop();

// ───────────────────────────── shared: the Fast Track ankle ─────────────────────────────

async function ankle(opts: { analgesiaGiven?: boolean } = {}) {
  think('Fast Track 1: 31M, inversion injury playing basketball, walked in. The Ottawa ankle rules decide on X-rays: bony tenderness at the posterior edge or tip of either malleolus, the navicular or the 5th metatarsal base, or inability to bear weight for four steps.', 'p_okafor');
  await act('walk to Fast Track 1', { type: 'move', to: 'ft_1' });
  await act('ask about the mechanism and weight bearing', { type: 'talk', npcId: 'pt_p_okafor', text: 'Hi, I am one of the doctors. How did you hurt it and could you walk on it afterwards?' });
  await act('ask where it hurts, numbness', { type: 'talk', npcId: 'pt_p_okafor', text: 'Can you point to where it hurts most? Any numbness or tingling in your foot or toes?' });
  for (const m of ['msk_lat_malleolus', 'msk_med_malleolus', 'msk_5th_mt', 'msk_navicular', 'msk_weight_bearing', 'msk_neurovascular']) await exam('p_okafor', m);
  think('Ottawa negative: no bony tenderness, he bears weight, and he is neurovascularly intact. No X-ray, no MRI — a lateral ankle (ATFL) sprain. Explain why, plus the rehab plan and return precautions.', 'p_okafor');
  await act('counsel: no imaging, rehab, return precautions', { type: 'talk', npcId: 'pt_p_okafor', text: "Good news: by the Ottawa ankle rules you don't need an X-ray or MRI. Brace, ibuprofen, early exercises — expect a few weeks before you return to play; come back if pain worsens or you can't walk." });
  await act('walk to the station', { type: 'move', to: 'station' });
  think('NSAID for pain, a functional brace rather than immobilization, ice and elevation; then home.', 'p_okafor');
  for (const code of opts.analgesiaGiven ? ['ankle_brace', 'ice_elevate'] : ['ibuprofen', 'ankle_brace', 'ice_elevate']) await order('p_okafor', code);
  await act('disposition: discharge home', { type: 'disposition', patientId: 'p_okafor', decision: 'discharge', diagnoses: ['Right lateral ankle sprain'] });
}

// ───────────────────────────── Night Shift ─────────────────────────────

async function nightShift() {
  think('Night Shift, 22:00. An ankle sprain is waiting in Fast Track 1 and EMS is minutes out with an altered elderly woman for Bed 4. Sickest first: wait for her.');
  await act('wait 6 min for the EMS arrival', { type: 'wait', minutes: 6 });
  console.log('\n' + last.observation.split('\n\n').slice(0, 2).join('\n\n') + '\n');

  // 1. Mrs. Brunner (Bed 4) — sepsis bundle, collateral, the missing temperature
  think('Bed 4: 81F, acutely confused, HR 112, BP 94/56, RR 24 — qSOFA 3/3, and triage never recorded a temperature. Treat as sepsis: lactate and blood cultures before antibiotics, a full set of vitals, monitor.', 'p_brunner');
  await act('walk to the station', { type: 'move', to: 'station' });
  for (const code of ['lactate', 'bcx', 'cbc', 'cmp', 'ua', 'ucx', 'vitals_now', 'monitor']) await order('p_brunner', code);
  think('Soft BP (MAP ≈ 69) with suspected sepsis: 30 mL/kg crystalloid, about 1.7 L for her 58 kg, reassessing as it runs in.', 'p_brunner');
  await order('p_brunner', 'lr_bolus', { dose: '30 mL/kg' });
  think('She cannot give a history, and prior cultures decide the antibiotic. Call her GP’s after-hours line with two identifiers: name and date of birth.', 'p_brunner');
  const gp = await act('call the GP after-hours line', { type: 'call', contactId: 'gp_whitfield', text: 'ED resident calling about Margarethe Brunner, DOB 02/11/1945. Any prior urine cultures or resistant organisms? Please fax the records.' });
  if (/esbl/i.test(gp.result.text ?? '')) think('Prior ESBL E. coli, resistant to ceftriaxone → a carbapenem: meropenem. Her penicillin “allergy” is childhood hives; carbapenem cross-reactivity is under 1%.', 'p_brunner');
  else think('Old records mention a “resistant” UTI last spring: cover ESBL with a carbapenem — meropenem. Childhood penicillin hives: carbapenem cross-reactivity is under 1%.', 'p_brunner');
  await order('p_brunner', 'meropenem');

  // 2. Mr. Keller (Bed 2) — STEMI
  think('Bed 2 is a 64-year-old with crushing chest pressure since 21:45. His triage ECG needs a physician read within 10 minutes.', 'p_keller');
  await act('wait 12 min for Bed 2 and his ECG', { type: 'wait', minutes: 12 });
  const chart = await act('read the Bed 2 ECGs', { type: 'ehr_view', patientId: 'p_keller', section: 'ecg' });
  const ecgId = /\b(ecg\d+)\b/.exec(chart.result.text ?? '')?.[1];
  if (ecgId) {
    think('ST elevation in II, III and aVF (III > II) with reciprocal depression in I and aVL: inferior STEMI, likely the right coronary. Rate 56, BP 104/66 — record right-sided leads for RV infarction; no nitrates, no IV beta-blocker.', 'p_keller');
    await act('sign the ECG: inferior STEMI', { type: 'sign_ecg', ecgId, interpretation: 'Sinus bradycardia 56, inferior STEMI (ST elevation II, III, aVF) with reciprocal depression I/aVL.' });
  }
  think('Aspirin 324 mg chewed and unfractionated heparin for primary PCI; monitor, IV access, V4R. Troponin and baseline labs go with him — they must not delay activation.', 'p_keller');
  for (const code of ['aspirin', 'monitor', 'iv_access', 'ecg_right', 'heparin', 'trop', 'bmp', 'cbc', 'coags']) await order('p_keller', code);
  think('Activate the cath lab on the ECG alone, with a crisp one-liner: who, onset, ECG, BP, treatment so far.', 'p_keller');
  await act('call cardiology: activate the cath lab', { type: 'call', contactId: 'cards', text: 'Bed 2, Robert Keller, 64M, chest pressure since 21:45, ECG shows inferior STEMI with ST elevation II, III, aVF, BP 104/66. Aspirin given. Please activate the cath lab.' });
  await act('disposition: cath lab', { type: 'disposition', patientId: 'p_keller', decision: 'cath_lab', service: 'Interventional cardiology', diagnoses: ['Inferior STEMI', 'RV involvement'] });
  think('While the cath team comes: tell him what is happening, and ask about PDE5 inhibitors before anyone reaches for nitroglycerin.', 'p_keller');
  await act('walk to Bed 2', { type: 'move', to: 'bed_2' });
  await act('explain the plan, ask about sildenafil', { type: 'talk', npcId: 'pt_p_keller', text: "Mr. Keller, you're having a heart attack — one of your heart arteries is blocked. The cardiology team is coming to open it with a catheter and a stent. One important question: have you taken sildenafil, Viagra or any similar pill in the last two days?" });
  await act('look through the medication bag EMS brought', { type: 'inspect', itemId: 'keller_medbag' });
  if (/sildenafil/i.test(last.result.text ?? '')) think('Sildenafil dispensed 9 days ago, two tablets used: if taken in the last 24 h, nitrates could crash his pressure — one more reason, besides the likely RV infarct, for no nitroglycerin.', 'p_keller');
  await act('walk back to the station', { type: 'move', to: 'station' });
  const ecgs = await act('read the Bed 2 ECGs again', { type: 'ehr_view', patientId: 'p_keller', section: 'ecg' });
  const v4r = /- (ecg\d+) [^\n]*\n\s+Machine read: ([^\n]*)\n\s+UNSIGNED/.exec(ecgs.result.text ?? '');
  if (v4r) {
    think(/V4R/.test(v4r[2]) ? 'Right-sided leads: 1.5 mm ST elevation in V4R — RV infarction. He is preload-dependent: no nitrates or diuretics, careful with opioids, small fluid boluses if his pressure drops.' : `Second ECG: ${v4r[2]}`, 'p_keller');
    await act('sign the right-sided ECG', { type: 'sign_ecg', ecgId: v4r[1], interpretation: 'Right-sided ECG: ST elevation 1.5 mm in V4R, consistent with right-ventricular infarction, with the known inferior STEMI.' });
  }

  // 3. Mr. Kellner (Bed 3) — AF with RVR; the look-alike-name trap
  await act('wait 15 min', { type: 'wait', minutes: 15 });
  think('Bed 3: 71M, palpitations since 15:00, irregular pulse in the 130s, BP 142/88, takes levothyroxine — probable new AF with RVR. Look for the trigger: TSH, electrolytes with magnesium, CBC, troponin.', 'p_kellner');
  for (const code of ['bmp', 'mg', 'tsh', 'cbc', 'trop']) await order('p_kellner', code);
  think('BP tolerates it: IV metoprolol for rate control — a beta-blocker is first choice when thyroid excess may be driving the AF (amiodarone’s iodine load would not help).', 'p_kellner');
  await order('p_kellner', 'metoprolol_iv');
  if (/Heading into Bed 2 with metoprolol/i.test(last.observation)) {
    think('Tom’s page: he is taking IV metoprolol into Bed 2 for “Mr. Kel—… Keller”. That order is Kellner’s (Bed 3) — look-alike names. Stop him before it reaches the STEMI patient.', 'p_keller');
    await act('walk to Bed 2', { type: 'move', to: 'bed_2' });
    const stop = await act('challenge the nurse: check the wristband', { type: 'talk', npcId: 'rn_tom', text: 'Tom, stop — check the wristband. That metoprolol is for Kellner in Bed 3, not Keller.' });
    if (stop.result.ok) think('Near miss: IV beta-blockade in a bradycardic, borderline-hypotensive inferior STEMI can precipitate cardiogenic shock (COMMIT). Two identifiers before every administration.', 'p_keller');
  } else if (/\[Bed 2\] Keller[^\n]*Departed/.test(last.observation) || !/\[Bed 2\] Keller/.test(last.observation)) {
    think('Keller is already in the cath lab, so the Keller/Kellner look-alike names cannot hurt him tonight — still, two identifiers before every administration.', 'p_kellner');
  }
  think('Bedside: his own pill bottle and history — onset, red flags, stroke and bleeding risk.', 'p_kellner');
  await act('walk to Bed 3', { type: 'move', to: 'bed_3' });
  await act('look at the pill bottle from his jacket', { type: 'inspect', itemId: 'kellner_bottle' });
  if (/150 mcg/.test(last.result.text ?? '')) think('Levothyroxine went from 100 to 150 mcg six weeks ago, and his chart still says 100: over-replacement is a prime AF trigger. Medication reconciliation matters.', 'p_kellner');
  await act('history: onset, chest pain, syncope', { type: 'talk', npcId: 'pt_p_kellner', text: 'Mr. Kellner, I am one of the doctors. When exactly did the palpitations start, and have you had any chest pain or fainting? Since the thyroid dose went up, have you felt jittery, sweaty or lost weight?' });
  await act('history: stroke and bleeding risk', { type: 'talk', npcId: 'pt_p_kellner', text: 'Do you have diabetes, heart failure, or a past stroke or mini-stroke? And any bleeding problems, ulcers, or blood thinners?' });
  await act('explain AF, stroke risk and the thyroid link', { type: 'talk', npcId: 'pt_p_kellner', text: 'Your heart is in atrial fibrillation, probably triggered by the higher thyroid dose — we will slow it down and get the dose adjusted. Atrial fibrillation raises the risk of stroke, so I want to start a blood thinner, apixaban, once your kidney tests are back.' });
  await act('walk to the station', { type: 'move', to: 'station' });
  const kEcg = await act('read the Bed 3 ECG', { type: 'ehr_view', patientId: 'p_kellner', section: 'ecg' });
  const kEcgId = /\b(ecg\d+)\b/.exec(kEcg.result.text ?? '')?.[1];
  if (kEcgId) {
    think('Irregularly irregular, no P waves, rate 134: atrial fibrillation with rapid ventricular response; the ST depression in V5–V6 is rate-related, not a STEMI.', 'p_kellner');
    await act('sign the ECG: AF with RVR', { type: 'sign_ecg', ecgId: kEcgId, interpretation: 'Atrial fibrillation with rapid ventricular response, rate ~134. Nonspecific, likely rate-related ST depression V5–V6.' });
  }

  // 4. Mr. Okafor — Ottawa rules, no imaging
  await ankle();

  // 5. reassess: Brunner's lactate clearance, Kellner's labs; then admissions
  think('Her first lactate was above 2: repeat it now, about an hour after the first, to see whether it clears.', 'p_brunner');
  await order('p_brunner', 'lactate');
  await act('wait 50 min', { type: 'wait', minutes: 50 });
  const labs = await act('read the Bed 4 lactate trend', { type: 'ehr_view', patientId: 'p_brunner', section: 'labs', query: 'lact' });
  const lact = labSeries(labs.result.text, 'lactate').map((v) => parseFloat(v)).filter(Number.isFinite);
  const cleared = lact.length > 1 ? (lact[0] - lact[lact.length - 1]) / lact[0] : null;
  const lactTrend = lact.length ? `lactate ${lact.join(' → ')} mmol/L${cleared === null ? ' (repeat pending)' : cleared >= 0.1 ? ' (clearing)' : ' (barely clearing)'}` : 'lactate pending';
  const summary = await act('read the Bed 4 summary', { type: 'ehr_view', patientId: 'p_brunner', section: 'summary' });
  const mapNow = Number(/\(MAP (\d+)\)/.exec(summary.result.text ?? '')?.[1] ?? NaN);
  if (mapNow < 65) {
    think(`Bed 4: MAP ${mapNow} after 30 mL/kg, ${lactTrend}: septic shock. Norepinephrine now, and she belongs in the ICU — within her wish to avoid prolonged ventilation.`, 'p_brunner');
    await order('p_brunner', 'norepinephrine');
    await act('call the ICU', { type: 'call', contactId: 'icu', text: `Bed 4, Margarethe Brunner, 81F, septic shock from pyelonephritis with prior ESBL E. coli: MAP ${mapNow} despite 30 mL/kg, ${lactTrend}, norepinephrine started, meropenem after blood cultures. Full code but no prolonged ventilation per her advance directive. ICU please.` });
    await act('disposition: ICU', { type: 'disposition', patientId: 'p_brunner', decision: 'admit_icu', service: 'Medical ICU', diagnoses: ['Septic shock from acute pyelonephritis (ESBL E. coli)', 'AKI', 'Delirium'] });
  } else {
    think(`Bed 4: ${lactTrend}${Number.isFinite(mapNow) ? `, MAP ${mapNow} without pressors` : ''}. Sepsis without shock: step-down with close monitoring and another lactate in 2 h; ICU if MAP falls below 65. Goals of care from the GP: full treatment, no prolonged ventilation.`, 'p_brunner');
    await act('call the hospitalist: admit Bed 4', { type: 'call', contactId: 'hosp', text: `Admission: Bed 4, Margarethe Brunner, 81F, sepsis from pyelonephritis with prior ESBL E. coli, on meropenem after blood cultures, 30 mL/kg given, ${lactTrend}${Number.isFinite(mapNow) ? `, MAP ${mapNow} off pressors` : ''}, AKI and delirium; full code with no prolonged ventilation per GP. Step-down please.` });
    await act('disposition: step-down', { type: 'disposition', patientId: 'p_brunner', decision: 'admit_stepdown', service: 'Hospital medicine', diagnoses: ['Urosepsis / acute pyelonephritis (ESBL risk)', 'AKI', 'Delirium'] });
  }
  const kLabs = await act('read the Bed 3 labs', { type: 'ehr_view', patientId: 'p_kellner', section: 'labs' });
  const tsh = labValue(kLabs.result.text, 'tsh');
  const creat = labValue(kLabs.result.text, 'creat');
  think(tsh ? `TSH ${tsh} (6.8 in August, before the dose increase): suppressed — iatrogenic hyperthyroidism from levothyroxine over-replacement is the AF trigger.` : 'TSH still pending — with the dose jump to 150 mcg, thyroid excess remains the leading trigger; the admitting team will follow it up.', 'p_kellner');
  think(`CHA₂DS₂-VASc 2 (age 65–74, hypertension) → anticoagulate: apixaban 5 mg BID${creat ? ` (71 y, 82 kg, creatinine ${creat} — no dose reduction)` : ' (71 y, 82 kg — no dose reduction)'}.`, 'p_kellner');
  await order('p_kellner', 'apixaban');
  await act('call the hospitalist: admit Bed 3', { type: 'call', contactId: 'hosp', text: `Second one: Bed 3, Robert Kellner, 71M, new atrial fibrillation with RVR since 15:00, rate control with IV metoprolol, CHA2DS2-VASc 2, apixaban started. ${tsh ? `TSH ${tsh}` : 'TSH pending'} — levothyroxine went from 100 to 150 mcg six weeks ago, likely over-replacement. Telemetry please.` });
  await act('disposition: telemetry', { type: 'disposition', patientId: 'p_kellner', decision: 'admit_telemetry', service: 'Hospital medicine', diagnoses: ['New-onset atrial fibrillation with RVR', 'Iatrogenic hyperthyroidism'] });
}

// ───────────────────────────── Orientation Day ─────────────────────────────

async function orientation() {
  think('Orientation Day, 13:00. Fast Track 1 has a stable ankle injury; a 23-year-old woman with abdominal pain arrives to Bed 5 in two minutes. Abdominal pain in a young woman goes first: appendicitis and ectopic pregnancy cannot wait.');
  await act('wait 3 min for Bed 5', { type: 'wait', minutes: 3 });
  await act('walk to Bed 5', { type: 'move', to: 'bed_5' });
  await act('ask about the pain', { type: 'talk', npcId: 'pt_p_thompson', text: "Hi Mia, I'm one of the doctors. Where did the pain start, and where is it now?" });
  await act('ask about appetite and last intake', { type: 'talk', npcId: 'pt_p_thompson', text: 'Have you lost your appetite? When was the last time you ate, and your last drink?' });
  think('A sexual history needs privacy: ask her boyfriend to step out first.', 'p_thompson');
  await act('ask Jake for privacy', { type: 'talk', npcId: 'fam_jake', text: 'Jake, could you give us a few minutes of privacy? I will come and find you.' });
  await act('menstrual history', { type: 'talk', npcId: 'pt_p_thompson', text: 'A few private questions, Mia. What was the first day of your last menstrual period, and was it normal?' });
  await act('sexual history', { type: 'talk', npcId: 'pt_p_thompson', text: 'Are you sexually active, and do you use any contraception?' });
  think('Periumbilical pain migrating to the RLQ, anorexia, 38.1 °C: examine for localized peritonism.', 'p_thompson');
  for (const m of ['abd_palpate', 'abd_rebound', 'abd_mcburney', 'abd_rovsing', 'abd_psoas']) await exam('p_thompson', m);
  think('RLQ guarding, rebound, positive Rovsing and psoas signs after migratory pain, anorexia and fever: acute appendicitis until proven otherwise. Pregnancy test before any CT; NPO, analgesia, fluids.', 'p_thompson');
  await act('tell her the plan', { type: 'talk', npcId: 'pt_p_thompson', text: "This could well be appendicitis. Please don't drink or eat anything for now — nothing by mouth. I'm getting you pain medicine, fluids and a scan, and we check a pregnancy test first, as we do for every woman before a CT." });
  await act('walk to the station', { type: 'move', to: 'station' });
  for (const code of ['hcg_u', 'cbc', 'bmp', 'ua', 'iv_access', 'npo']) await order('p_thompson', code);
  think('Opioids do not mask peritoneal signs: morphine 4 mg IV, ondansetron, and a litre of crystalloid for the tachycardia.', 'p_thompson');
  await order('p_thompson', 'morphine', { dose: '4 mg' });
  await order('p_thompson', 'ondansetron');
  await order('p_thompson', 'lr_bolus', { dose: '1000 mL' });
  think('CT abdomen/pelvis with IV contrast — radiology holds it until the pregnancy test is back.', 'p_thompson');
  await order('p_thompson', 'ct_abd_iv');
  think('Fast Track 1 has been waiting in pain: ibuprofen now, so it works by the time I examine him.', 'p_okafor');
  await order('p_okafor', 'ibuprofen');

  think('While the hCG and CT run, see the ankle.');
  await ankle({ analgesiaGiven: true });

  // results, then surgery
  let imaging = '';
  for (let i = 0; i < 6; i++) {
    await act(i ? 'wait 15 min more for the CT' : 'wait 20 min for results', { type: 'wait', minutes: i ? 15 : 20 });
    imaging = (await act('read Bed 5 imaging', { type: 'ehr_view', patientId: 'p_thompson', section: 'imaging' })).result.text ?? '';
    if (/IMPRESSION:/.test(imaging)) break;
  }
  const impression = /IMPRESSION: (.+?) \(/.exec(imaging)?.[1] ?? 'still pending';
  const labs = (await act('read Bed 5 labs', { type: 'ehr_view', patientId: 'p_thompson', section: 'labs' })).result.text ?? '';
  const wbc = labValue(labs, 'wbc');
  const hcg = labValue(labs, 'hcg_u');
  const uaWbc = labValue(labs, 'ua_wbc');
  think(`CT: ${impression} WBC ${wbc ?? 'pending'}, urine hCG ${hcg ?? 'pending'}.${uaWbc ? ` Urine WBC ${uaWbc} without nitrites is sterile pyuria from the inflamed appendix next to the ureter — not a UTI.` : ''}`, 'p_thompson');
  think('Pre-operative antibiotics now: cefoxitin 2 g IV (no allergies). Then call general surgery with a tight presentation.', 'p_thompson');
  await order('p_thompson', 'cefoxitin', { dose: '2 g', frequency: 'once' });
  await act('call general surgery', {
    type: 'call',
    contactId: 'surg',
    text: `ED resident, Bed 5: Mia Thompson, 23F, healthy. Periumbilical pain since last night migrating to the RLQ, anorexia, temp 38.1. RLQ guarding with rebound, Rovsing and psoas positive. WBC ${wbc ?? 'pending'}, urine hCG ${hcg ?? 'pending'}. CT: ${impression} Cefoxitin given, NPO; last ate pasta around 19:00 yesterday, a sip of water at 06:00. No allergies. Could you see her for appendectomy?`,
  });
  await act('disposition: operating room', { type: 'disposition', patientId: 'p_thompson', decision: 'or', service: 'General surgery', diagnoses: ['Acute appendicitis with appendicolith'] });
  await act('walk to Bed 5', { type: 'move', to: 'bed_5' });
  await act('explain the surgery', { type: 'talk', npcId: 'pt_p_thompson', text: 'Mia, the scan confirms appendicitis. The surgeons will remove your appendix with keyhole surgery tonight — small scars, and most people are back in classes within one to two weeks. Still nothing to eat or drink until then.' });
  think('Stay until the surgeons take over: antibiotics running, pain controlled, NPO.', 'p_thompson');
  await act('wait 20 min for surgery', { type: 'wait', minutes: 20 });
}

// ───────────────────────────── run ─────────────────────────────

if (map === 'orientation') await orientation();
else if (map === 'night_shift') await nightShift();
else throw new Error(`The scripted demo knows night_shift and orientation, not "${map}".`);

await act('end the shift', { type: 'end_shift' });
const d = await api.debrief(sid);
console.log(`\n══ ${d.mapTitle}: ${d.score}/${d.maxScore} (${d.percent}%, grade ${d.grade}) · resources $${d.costUSD}`);
for (const c of d.cases) console.log(`  ${c.bedLabel.padEnd(13)} ${c.name.padEnd(20)} ${String(c.score).padStart(4)}/${c.maxScore}  dx:${c.dxVerdict}  dispo:${c.dispoCorrect}`);
for (const e of d.safetyEvents) console.log(`  safety: ${e.caught ? 'caught' : 'MISSED'} — ${e.label}`);
if (narrating) {
  narrator.say('reflection', reflection(d));
  await Promise.race([narrator.flush(), new Promise((r) => setTimeout(r, 5000))]);
}
process.exit(0); // don't linger on HTTP keep-alive sockets (observe mode shows "finished" right away)

/** a short, honest self-review built from the debrief (the scripted agent cannot reflect — it reports) */
function reflection(d: Debrief): string {
  const misses = d.cases
    .flatMap((c) => c.items.filter((it) => !it.ok && it.max > 0 && it.kind !== 'history').map((it) => ({ ...it, bed: c.bedLabel })))
    .sort((a, b) => b.max - a.max)
    .slice(0, 3);
  const facts = d.cases.flatMap((c) => c.keyFacts);
  const safety = d.safetyEvents;
  const caught = safety.filter((e) => e.caught).length;
  return [
    `Reflection (scripted baseline): ${d.percent}% (${d.grade}) on ${d.mapTitle}; resource use $${d.costUSD}.`,
    misses.length ? `Missed: ${misses.map((m) => `${m.label} (${m.bed})`).join('; ')}.` : 'No critical action missed.',
    safety.length ? `Safety: caught ${caught} of ${safety.length}${caught < safety.length ? ` — missed: ${safety.filter((e) => !e.caught).map((e) => e.label).join('; ')}` : ''}.` : '',
    facts.length ? `History: ${facts.filter((f) => f.elicited).length} of ${facts.length} key facts. A script asks few questions; family, GPs and the patients' belongings hold the rest.` : '',
    'Compare: watch Claude play the same seed and see where open-ended reasoning beats a checklist.',
  ]
    .filter(Boolean)
    .join('\n');
}
