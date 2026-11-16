import type { Step } from '../brief';
import type { HarmDef } from '../../types';
import { ORDERS } from '../../../shared/catalog';

// The order rule accepts any one listed code, e.g. either chest X-ray view.
export const order = (label: string, ...codes: string[]): Step => [label, { type: 'order', codes }];
export const given = (label: string, ...codes: string[]): Step => [label, { type: 'given', codes }];
export const examine = (label: string, ...maneuvers: string[]): Step => [label, { type: 'exam', maneuvers }];
export const senior: Step = ['Request attending help with the urgent care plan', { type: 'escalated' }];
export const viralStewardship = [{
  codes: Object.values(ORDERS).filter(o => o.med?.tags.includes('abx')).map(o => o.code),
  penalty: 4,
  why: 'There is no evidence of a bacterial infection in this otherwise well patient.',
}];
export const unsafeDischarge = (teaching: string): HarmDef => ({
  id: 'unsafe_discharge', label: 'Sent home with a time-critical condition', penalty: 16,
  rule: { type: 'dispo', decisions: ['discharge'] }, teaching,
});
