/**
 * Bedside ultrasound: the read of one window on one patient, for the exam maneuver `pocus_<window>`
 * (shared/pocus.ts; session.ts examine() handles the bedside rule, the time and the finding).
 *
 *  - The case's read (CaseDef.pocus) where it has one. Variants pick on physiology now or a session
 *    flag, like exam findings; `{rate}` in the text is the heart rate now.
 *  - Otherwise a normal study for this patient (rate and rhythm, sex, age, build), or, for a case
 *    adapted from a case report, "No finding recorded", as the physical exam does.
 *
 * Nothing here draws from the session's random stream, so a shift without a scan runs exactly as before.
 */
import type { PocusTruth } from '../../content/types';
import type { PocusWindow } from '../../shared/pocus';
import type { GameSession, PatientState } from './session';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** the case's variant for this window: the first whose condition holds, else the last */
function pick(s: GameSession, p: PatientState, raw: PocusTruth | PocusTruth[] | undefined): PocusTruth | null {
  if (!raw) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const m = s.minutesSinceArrival(p);
  for (const v of list) {
    const w = v.when;
    if (!w) return v;
    if ('flag' in w) {
      if (s.flags.has(`${p.id}:${w.flag}`)) return v;
      continue;
    }
    const x = p.physio.value(w.var, m);
    if (w.op === '<' ? x < w.value : x > w.value) return v;
  }
  return list[list.length - 1] ?? null;
}

/** the read of a normal study of this window on this patient */
function normalRead(s: GameSession, p: PatientState, w: PocusWindow): string {
  const c = p.c;
  const female = c.patient.sex === 'F';
  const hr = Math.round(p.physio.measured('hr', s.minutesSinceArrival(p)));
  const rate = `${c.ecg.params.rhythm === 'afib' ? 'irregularly irregular' : 'regular'}, rate about ${hr}/min`;
  // a bigger body has bigger kidneys (height and BMI)
  const h = c.patient.heightCm / 100;
  const size = clamp(c.patient.heightCm / 172, 0.9, 1.12) * (1 + clamp(c.patient.weightKg / (h * h) - 24, -4, 10) * 0.012);
  const kidney = round1(10.8 * clamp(size, 0.92, 1.08));
  switch (w) {
    case 'ruq':
      return `No free fluid in Morison's pouch or at the inferior tip of the liver. Liver homogeneous. Right kidney ${kidney} cm, normal cortex, no hydronephrosis. Mirror image above the diaphragm, spine not seen above it: no pleural fluid.`;
    case 'luq':
      return 'No free fluid between the spleen and the diaphragm or in the splenorenal recess. Spleen normal in size and texture. Left kidney normal, no hydronephrosis. No pleural fluid above the diaphragm.';
    case 'pelvic':
      return `Bladder partly filled. ${female ? (c.patient.age >= 52 ? 'Small postmenopausal uterus behind it.' : 'Uterus normal in size behind it.') : 'Prostate normal in size under its base.'} No free fluid in the ${female ? 'rectouterine pouch' : 'rectovesical pouch'}.`;
    case 'bladder':
      return 'Bladder about 150 mL (W × L × H × 0.52), wall 3 mm, no debris or stones.';
    case 'cardiac':
      return `Subxiphoid 4-chamber view: no pericardial effusion. Left and right ventricles normal in size; left ventricular function grossly normal. ${cap(rate)}.`;
    case 'aorta': {
      // the upper abdominal aorta (above the renal arteries), outer wall to outer wall
      const cm = c.patient.age < 40 ? (female ? 1.7 : 1.9) : female ? 1.9 : 2.1;
      return `Abdominal aorta normal in caliber, ${cm} cm outer wall to outer wall; no aneurysm, no flap seen. IVC to its right.`;
    }
    case 'ivc':
      return 'IVC 1.8 cm, about 50% inspiratory collapse: normal right atrial pressure.';
    case 'rlq':
      return 'Graded compression of the right lower quadrant: bowel loops compress and move with peristalsis, psoas and iliac vessels seen beneath them. No non-compressible tubular structure, no free fluid. Appendix not visualized (normal in most adults).';
    case 'lung':
      return 'Lung sliding present at the pleural line, A-lines below it, no B-lines (dry lung, no pneumothorax at this point).';
  }
}

/** what this window shows on this patient now, as a doctor would document it */
export function ultrasoundRead(s: GameSession, p: PatientState, w: PocusWindow): string {
  const truth = pick(s, p, p.c.pocus?.[w]);
  if (truth) {
    const hr = String(Math.round(p.physio.measured('hr', s.minutesSinceArrival(p))));
    return s.fill(truth.text, p).replace(/\{rate\}/g, hr);
  }
  return p.c.provenance.kind === 'adapted' ? 'No finding recorded for this maneuver.' : normalRead(s, p, w);
}
