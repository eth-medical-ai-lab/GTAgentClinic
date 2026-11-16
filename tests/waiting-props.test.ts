/**
 * Waiting-room reading and typing (content/ambient.ts, server/sim/ambient.ts; drawn by
 * client/src/world/reading.ts): one or two people read a broadsheet, one works on a laptop on the
 * lap, only ever while seated, and it all comes from the crowd's own seeded plan.
 */
import { describe, expect, it } from 'vitest';
import { AMBIENT, PERSONAS } from '../content/ambient';
import { SCENARIOS } from '../content/scenarios';
import { planAmbient } from '../server/sim/ambient';
import { LAYOUTS } from '../shared/layout';

const plan = (mapId: string, seed: number) => {
  const sc = SCENARIOS[mapId];
  return planAmbient({ seed, mapId, layout: LAYOUTS.ed, durationMin: sc.durationMin, timeScale: sc.defaultTimeScale, shiftStart: sc.shiftStart })!;
};
/** what someone carries in a stretch: the stretch's own props, else the persona's (as AmbientLife.apply shows them) */
const propsOf = (id: string, s: { props?: string[] }) => s.props ?? PERSONAS[id]?.props ?? [];

describe('waiting room: a broadsheet and a laptop', () => {
  const seeds = [1, 2, 3, 42, 99, 2024, 31337];

  it('one or two readers with a newspaper, one person on a laptop', () => {
    for (const map of Object.keys(AMBIENT)) {
      for (const seed of seeds) {
        const p = plan(map, seed);
        const holders = (prop: 'newspaper' | 'laptop') => [...p.people.entries()].filter(([id, tl]) => tl.segs.some((s) => propsOf(id, s).includes(prop)));
        const readers = [...p.people.entries()].filter(([, tl]) => tl.segs.some((s) => s.act === 'read'));
        const typists = [...p.people.entries()].filter(([, tl]) => tl.segs.some((s) => s.act === 'laptop'));
        expect(holders('newspaper').length, `${map} ${seed}`).toBeGreaterThanOrEqual(1);
        expect(holders('newspaper').length, `${map} ${seed}`).toBeLessThanOrEqual(2);
        expect(readers.length, `${map} ${seed}`).toBeGreaterThanOrEqual(1);
        expect(readers.length, `${map} ${seed}`).toBeLessThanOrEqual(2);
        expect(holders('laptop').length, `${map} ${seed}`).toBe(1);
        expect(typists.length, `${map} ${seed}`).toBe(1);
      }
    }
  });

  it('reading and typing only seated, and only with the paper or the laptop at hand', () => {
    for (const map of Object.keys(AMBIENT)) {
      for (const seed of seeds) {
        for (const [id, tl] of plan(map, seed).people) {
          for (const s of tl.segs) {
            if (s.act !== 'read' && s.act !== 'laptop') continue;
            expect(s.posture, `${map} ${seed} ${id}`).toBe('sit');
            expect(propsOf(id, s), `${map} ${seed} ${id}`).toContain(s.act === 'read' ? 'newspaper' : 'laptop');
          }
        }
      }
    }
  });

  it('someone is reading or typing within the first quarter hour of every Night Shift', () => {
    for (const seed of seeds) {
      const p = plan('night_shift', seed);
      const busy = (t: number) => [...p.people.values()].some((tl) => ['read', 'laptop'].includes(tl.at(t)?.act ?? ''));
      let any = false;
      for (let t = 0; t <= 15 * 60 && !any; t += 30) any = busy(t);
      expect(any, `seed ${seed}`).toBe(true);
    }
  });
});
