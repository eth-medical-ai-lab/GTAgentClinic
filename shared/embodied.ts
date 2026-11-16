import { z } from 'zod';

export const viewport = { width: 1280, height: 720 };
const key = z.enum(['w', 'a', 's', 'd', 'e', 'f', 'g', 'v', 'h', 'Tab', 'Escape', 'Space', 'Enter', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const coordinate = { x: z.int().min(0).max(viewport.width - 1), y: z.int().min(0).max(viewport.height - 1) };
const text = z.string().trim().min(1).max(1000);
const input = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('key'), key, ms: z.int().min(0).max(8000) }),
  z.object({ kind: z.literal('look'), dx: z.int().min(-1400).max(1400), dy: z.int().min(-700).max(700) }),
  z.object({ kind: z.literal('click'), ...coordinate }),
  z.object({ kind: z.literal('scroll'), ...coordinate, dy: z.int().min(-1000).max(1000) }),
  z.object({ kind: z.literal('type'), text }),
  z.object({ kind: z.literal('speak'), text }),
  z.object({ kind: z.literal('wait'), ms: z.int().min(0).max(8000) }),
]);
export type Input = z.infer<typeof input>;
export const decision = z.object({
  intent: z.string().max(240),
  inputs: z.array(input).max(4),
  observeAfter: z.boolean(),
}).refine(plan => plan.inputs.length > 0 || plan.observeAfter, 'Supply inputs or request an observation.')
  .refine(plan => plan.inputs.reduce((n, a) => n + ('ms' in a ? a.ms : 0), 0) <= 8000, 'At most 8000 ms per sequence.');
export type Decision = z.infer<typeof decision>;

/** Observation numbers count only the images explicitly shown to the doctor. */
type TimedEvent = { observation: number; turn: number; at: number };
export type EmbodiedEvent = TimedEvent & (
  | { kind: 'observation' }
  | ({ kind: 'decision' } & Decision)
  | { kind: 'input'; input: Input; result: string }
  | { kind: 'invalid'; result: string }
);
export interface ObservationLog {
  startedAt: number;
  count: number;
  events: EmbodiedEvent[];
}
