/**
 * The tour's patients as they are at 22:20, when it opens: the mock charts (dev/mock.ts, which run on to
 * past midnight for UI work) cut back to that moment, so the story told by the people in the tour, the
 * charts and the monitors agree.
 *   - Mr. Keller came in at 22:12 with chest pressure since about 21:45. His 12-lead from 22:17 waits
 *     for a physician read, three minutes old. Triage drew a troponin and chemistry. Nothing else has
 *     been ordered: you have just come on, and the tour does not place orders.
 *   - Mrs. Brunner came in by EMS at 22:04, confused and hypotensive. The attending started her sepsis
 *     workup; her fluid bolus is being pulled; her GP's fax with the old urine culture came at 22:15.
 *   - Mr. Okafor has waited in Fast Track since 21:35 with his ankle.
 */
import type { OrderView, PageView, PatientChart, PlayerView } from '../../../shared/types';
import { mockCharts } from '../dev/mock';

const M = 60;
/** the tour's clock when it opens (s after 22:00) */
export const TOUR_START = 20 * M;

const pick = <T extends { id: string }>(list: T[], id: string): T => {
  const x = list.find((i) => i.id === id);
  if (!x) throw new Error(`mock chart entry ${id} is missing`);
  return x;
};

/** a lab order collected but not resulted yet */
const running = (o: OrderView, placedAt: number, placedBy: string, collectedAt: number, statusText: string): OrderView =>
  ({ ...o, placedAt: placedAt * M, placedBy, collectedAt: collectedAt * M, resultedAt: undefined, completedAt: undefined, status: 'In lab', statusText });

export function tourCharts(): Record<string, PatientChart> {
  const c = mockCharts();
  const k = c.p_keller;
  const triage = 'Protocol (triage)';
  c.p_keller = {
    ...k,
    // the workstation fixture's name alert is for a patient this tour does not have
    alerts: [],
    vitals: [pick(k.vitals, 'v1'), { ...pick(k.vitals, 'v2'), t: 16 * M }, { ...pick(k.vitals, 'v3'), t: 19 * M }],
    orders: [
      pick(k.orders, 'o1'),
      running(pick(k.orders, 'o2'), 13, triage, 15, 'Collected 22:15 · running'),
      running(pick(k.orders, 'o3'), 13, triage, 15, 'Collected 22:15 · running'),
    ],
    labs: k.labs.filter((l) => l.historical),
    imaging: [],
    mar: [],
  };
  const b = c.p_brunner;
  const shaw = 'Dr. E. Shaw';
  c.p_brunner = {
    ...b,
    vitals: [pick(b.vitals, 'b1'), { ...pick(b.vitals, 'b2'), t: 18 * M }],
    orders: [
      running(pick(b.orders, 'b_o1'), 10, shaw, 14, 'Collected 22:14 · running'),
      running(pick(b.orders, 'b_o4'), 10, shaw, 14, 'Collected 22:14 · running'),
      { ...pick(b.orders, 'b_o5'), placedBy: shaw },
      { ...pick(b.orders, 'b_o7'), placedBy: shaw, status: 'Ordered', completedAt: undefined, statusText: 'Being prepared in the med room' },
    ],
    labs: b.labs.filter((l) => l.historical),
    mar: [],
    notes: [pick(b.notes, 'bn1'), { ...pick(b.notes, 'bn2'), t: 15 * M, unread: true }],
  };
  return c;
}

/** Marcus's page about Mr. Keller's ECG, a minute after he took it */
export const TOUR_PAGES: PageView[] = [
  { id: 'pg_ecg', t: 18 * M, from: 'Marcus (ED tech)', text: 'Doc, can you look at the ECG on Bed 2? Chest pain.', priority: 'urgent', patientId: 'p_keller', read: false },
];

/** the bedside monitors at 22:20, as the last vitals in the charts */
export const TOUR_MONITORS: PlayerView['monitors'] = {
  bed_2: { patientId: 'p_keller', hr: 52, sbp: 96, dbp: 60, spo2: 94, rr: 22, rhythm: 'sinus', stII: 2.5 },
  bed_4: { patientId: 'p_brunner', hr: 118, sbp: 88, dbp: 52, spo2: 93, rr: 26, rhythm: 'sinus' },
};
