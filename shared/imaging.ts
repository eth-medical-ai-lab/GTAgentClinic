/**
 * Imaging studies as the CT suite and the X-ray room show them (view only): which ones are taken
 * standing. A chest film PA and lateral is taken erect at the wall stand (full inspiration, the heart
 * against the detector); everything else in the X-ray room, and every CT, on the table. The server's
 * view (views.ts) puts the patient's body there; client/src/world/imagingPlan.ts plays the study.
 */

/** studies taken standing at the chest wall stand */
const ERECT = new Set(['xr_chest']);

export function erectStudy(code: string): boolean {
  return ERECT.has(code);
}
