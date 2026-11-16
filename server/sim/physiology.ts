/**
 * Patient physiology: baseline + integrated disease drift (modulated by treatments)
 * + treatment deltas (with onset, ramp, wear-off) + trigger jumps. Stepped per game
 * minute and cached; interventions are only ever added "now", so the cache before
 * the current minute stays valid.
 */
import type { EffectDef, PhysioDef, PhysVar, TriggerDef, VarMap } from '../../content/types';
import { hashSeed, Rng } from './rng';

const ALL_VARS: PhysVar[] = ['hr', 'sbp', 'dbp', 'rr', 'spo2', 'temp', 'pain', 'gcs', 'glucose', 'lactate', 'creat'];

const HARD_LIMITS: Partial<Record<PhysVar, [number, number]>> = {
  hr: [20, 220],
  sbp: [40, 240],
  dbp: [20, 140],
  rr: [4, 50],
  spo2: [50, 100],
  temp: [33, 42.5],
  pain: [0, 10],
  gcs: [3, 15],
  glucose: [20, 900],
  lactate: [0.3, 20],
  creat: [0.3, 12],
};

interface Intervention {
  tag: string;
  minute: number; // minutes since arrival (fractional)
  units: number;
}

interface Jump {
  minute: number;
  vars: VarMap;
}

export class Physiology {
  private interventions: Intervention[] = [];
  private driftAdds: { minute: number; vars: VarMap }[] = [];
  private jumps: Jump[] = [];
  private cache: Record<PhysVar, number>[] = []; // base (drift-integrated) values per whole minute
  private unitsUsed = new Map<string, number>();
  readonly fired = new Map<string, number>(); // trigger id → minute

  constructor(
    readonly def: PhysioDef,
    private readonly seedKey: string,
  ) {}

  /** minutes since arrival → state */
  private base0(): Record<PhysVar, number> {
    const b = {} as Record<PhysVar, number>;
    for (const v of ALL_VARS) b[v] = this.def.baseline[v] ?? DEFAULTS[v];
    return b;
  }

  private limits(v: PhysVar): [number, number] {
    return this.def.limits?.[v] ?? HARD_LIMITS[v] ?? [-1e9, 1e9];
  }

  hasTag(tag: string, beforeMinute = Infinity): boolean {
    return this.interventions.some((i) => i.tag === tag && i.minute <= beforeMinute);
  }

  tagMinutes(tag: string): number[] {
    return this.interventions.filter((i) => i.tag === tag).map((i) => i.minute);
  }

  /** register an intervention at `minute` (≥ last computed minute is assumed) */
  apply(tag: string, minute: number, units = 1) {
    // cap units per tag where an effect defines maxUnits
    const effect = this.def.effects.find((e) => e.tag === tag && e.maxUnits !== undefined);
    if (effect?.maxUnits !== undefined) {
      const used = this.unitsUsed.get(tag) ?? 0;
      units = Math.max(0, Math.min(units, effect.maxUnits - used));
      this.unitsUsed.set(tag, used + units);
    }
    this.interventions.push({ tag, minute, units });
    this.truncate(minute);
  }

  fireTrigger(tr: TriggerDef, minute: number) {
    this.fired.set(tr.id, minute);
    if (tr.driftAdd) this.driftAdds.push({ minute, vars: tr.driftAdd });
    if (tr.jump) this.jumps.push({ minute, vars: tr.jump });
    this.truncate(minute);
  }

  private truncate(minute: number) {
    const keep = Math.max(0, Math.floor(minute));
    if (this.cache.length > keep + 1) this.cache.length = keep + 1;
  }

  private ramp(x: number, tau: number): number {
    if (x <= 0) return 0;
    return 1 - Math.exp(-x / Math.max(0.1, tau));
  }

  /** fraction of an effect active at minute m (onset + ramp + optional wear-off) */
  private activation(e: EffectDef, i: Intervention, m: number): number {
    const x = m - i.minute - (e.onsetMin ?? 0);
    if (x <= 0) return 0;
    let a = this.ramp(x, e.tauMin ?? 10);
    if (e.durationMin !== undefined && x > e.durationMin) {
      const over = x - e.durationMin;
      a *= Math.max(0, 1 - over / 30); // fade out over 30 min
    }
    return a;
  }

  private driftMultiplier(v: PhysVar, m: number): number {
    let mult = 1;
    for (const i of this.interventions) {
      if (i.minute > m) continue;
      for (const e of this.def.effects) {
        if (e.tag !== i.tag || e.driftMult?.[v] === undefined) continue;
        const a = this.activation(e, i, m);
        if (a <= 0) continue;
        mult *= 1 + (e.driftMult[v]! - 1) * a;
      }
    }
    return mult;
  }

  private baseAt(minute: number): Record<PhysVar, number> {
    const target = Math.max(0, Math.floor(minute));
    if (this.cache.length === 0) this.cache.push(this.base0());
    while (this.cache.length <= target) {
      const m = this.cache.length - 1;
      const prev = this.cache[m];
      const next = { ...prev };
      for (const v of ALL_VARS) {
        let drift = this.def.drift?.[v] ?? 0;
        for (const d of this.driftAdds) if (d.minute <= m) drift += d.vars[v] ?? 0;
        if (drift !== 0) next[v] = prev[v] + (drift / 60) * this.driftMultiplier(v, m);
        for (const j of this.jumps) if (j.minute > m && j.minute <= m + 1) next[v] += j.vars[v] ?? 0;
        const [lo, hi] = this.limits(v);
        next[v] = Math.min(hi, Math.max(lo, next[v]));
      }
      this.cache.push(next);
    }
    return this.cache[target];
  }

  /** true (noise-free) value at minutes since arrival */
  value(v: PhysVar, minute: number): number {
    const m = Math.max(0, minute);
    let x = this.baseAt(m)[v];
    for (const i of this.interventions) {
      if (i.minute > m) continue;
      for (const e of this.def.effects) {
        if (e.tag !== i.tag || !e.delta?.[v]) continue;
        x += e.delta[v]! * i.units * this.activation(e, i, m);
      }
    }
    const [lo, hi] = this.limits(v);
    return Math.min(hi, Math.max(lo, x));
  }

  all(minute: number): Record<PhysVar, number> {
    const out = {} as Record<PhysVar, number>;
    for (const v of ALL_VARS) out[v] = this.value(v, minute);
    return out;
  }

  /** measured value with deterministic per-(var, minute) noise */
  measured(v: PhysVar, minute: number): number {
    const sd = this.def.noise?.[v] ?? 0;
    const x = this.value(v, minute);
    if (!sd) return x;
    const r = new Rng(hashSeed(this.seedKey, v, Math.floor(minute)));
    const [lo, hi] = this.limits(v);
    return Math.min(hi, Math.max(lo, x + r.normal(sd)));
  }

  /** harmful effects defined for a tag (if any) */
  harmFor(tag: string): EffectDef['harm'] | undefined {
    return this.def.effects.find((e) => e.tag === tag && e.harm)?.harm;
  }

  hasEffectFor(tag: string): boolean {
    return this.def.effects.some((e) => e.tag === tag);
  }
}

const DEFAULTS: Record<PhysVar, number> = {
  hr: 80,
  sbp: 125,
  dbp: 78,
  rr: 16,
  spo2: 98,
  temp: 36.8,
  pain: 0,
  gcs: 15,
  glucose: 100,
  lactate: 1.1,
  creat: 0.9,
};
