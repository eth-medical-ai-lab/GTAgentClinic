/**
 * Waiting-room life (server/sim/ambient.ts, content/ambient.ts): deterministic per seed, and
 * invisible to the clinical simulation — same seed, same clinical outcome and score, with or
 * without the crowd; agents' observations never mention it.
 */
import { describe, expect, it } from 'vitest';
import { AMBIENT, PERSONAS } from '../content/ambient';
import { CASES, SCENARIOS } from '../content/scenarios';
import { CAST, castFor } from '../client/src/world/casting';
import { LAYOUTS } from '../shared/layout';
import { NpcBrain } from '../server/npc/brain';
import { AmbientLife, chairHasClutter, planAmbient, waitingSeats } from '../server/sim/ambient';
import { observationText } from '../server/sim/agentText';
import { debrief } from '../server/sim/scoring';
import { GameSession } from '../server/sim/session';
import { buildView } from '../server/sim/views';
import type { Action, LlmStatus } from '../shared/types';

const brain = new NpcBrain(null);
const LLM: LlmStatus = { provider: 'offline', label: 'offline', ok: true };
const plan = (mapId: string, seed: number) => {
  const sc = SCENARIOS[mapId];
  return planAmbient({ seed, mapId, layout: LAYOUTS.ed, durationMin: sc.durationMin, timeScale: sc.defaultTimeScale, shiftStart: sc.shiftStart })!;
};
const dump = (p: ReturnType<typeof plan>) => JSON.stringify({ people: [...p.people.entries()].map(([id, tl]) => [id, tl.segs]), scenes: p.scenes, lines: p.lines, cues: p.cues, at: p.collapseAt });

/** a short shift that exercises orders, results, dialogue and a staff error */
async function playNight(seed: number, quiet: boolean): Promise<{ s: GameSession; obs: string[] }> {
  if (quiet) {
    // the same session with the ambient layer switched off: no ticks, no views
    AmbientLife.prototype.tick = () => {};
  }
  const s = new GameSession({ scenarioId: 'night_shift', seed, playerName: 'T', mode: 'step', brain });
  const obs: string[] = [];
  const steps: Action[] = [
    { type: 'wait', minutes: 13 },
    { type: 'move', to: 'bed_2' },
    { type: 'talk', npcId: 'pt_p_keller', text: 'Hi, I am the resident. What brings you in?' },
    { type: 'order', patientId: 'p_keller', code: 'ecg12' },
    { type: 'order', patientId: 'p_keller', code: 'trop' },
    { type: 'wait', minutes: 20 },
    { type: 'move', to: 'waiting' },
    { type: 'wait', minutes: 40 },
    { type: 'move', to: 'bed_4' },
    { type: 'order', patientId: 'p_brunner', code: 'lactate' },
    { type: 'wait', minutes: 90 },
  ];
  for (const a of steps) {
    await s.act(a);
    obs.push(observationText(s));
  }
  return { s, obs };
}

describe('ambient life: determinism and isolation', () => {
  it('the same seed gives the same ambient schedule; another seed a different one', () => {
    for (const map of Object.keys(AMBIENT)) {
      expect(dump(plan(map, 1234))).toBe(dump(plan(map, 1234)));
      expect(dump(plan(map, 1234))).not.toBe(dump(plan(map, 1235)));
    }
  });

  it('identical clinical outcome, score, log and observations with and without the crowd', async () => {
    const tick = AmbientLife.prototype.tick;
    try {
      const a = await playNight(2024, false);
      const b = await playNight(2024, true);
      expect(JSON.stringify(a.s.log)).toBe(JSON.stringify(b.s.log));
      expect(JSON.stringify(debrief(a.s))).toBe(JSON.stringify(debrief(b.s)));
      expect(a.obs).toEqual(b.obs);
      // the clinical random stream is in the same place afterwards
      expect(a.s.rng.next()).toBe(b.s.rng.next());
      // and planning the crowd draws nothing from it
      const x = new GameSession({ scenarioId: 'night_shift', seed: 5, playerName: 'T', mode: 'step', brain });
      const y = new GameSession({ scenarioId: 'night_shift', seed: 5, playerName: 'T', mode: 'step', brain });
      for (let i = 0; i < 3; i++) new AmbientLife(x);
      expect(x.rng.next()).toBe(y.rng.next());
    } finally {
      AmbientLife.prototype.tick = tick;
    }
  });

  it("agents' observations never mention the crowd; the 3D view carries it", async () => {
    const { s, obs } = await playNight(77, false);
    const names = Object.values(PERSONAS).flatMap((p) => [p.id, ...(p.callName ? [p.callName] : [])]);
    for (const o of obs) for (const n of names) expect(o).not.toContain(n);
    const fresh = new GameSession({ scenarioId: 'night_shift', seed: 77, playerName: 'T', mode: 'step', brain });
    const crowd = buildView(fresh, LLM).npcs.filter((n) => n.ambient?.crowd);
    expect(crowd.length).toBeGreaterThanOrEqual(8);
    // you can stop any of them for a word, off the record (server/npc/smalltalk.ts, tests/smalltalk.test.ts)
    expect(crowd.every((n) => n.talkable && n.offRecord && n.role === 'visitor')).toBe(true);
    void s;
  });
});

describe('ambient life: a believable waiting room', () => {
  const seeds = [1, 2, 3, 42, 99, 2024, 31337];

  it('8–12 people waiting when Night Shift starts, busier on Orientation Day', () => {
    for (const seed of seeds) {
      const night = new GameSession({ scenarioId: 'night_shift', seed, playerName: 'T', mode: 'step', brain });
      const n = buildView(night, LLM).npcs.filter((v) => v.location === 'waiting' && v.role === 'visitor').length;
      expect(n, `night seed ${seed}`).toBeGreaterThanOrEqual(8);
      expect(n, `night seed ${seed}`).toBeLessThanOrEqual(12);
      const day = new GameSession({ scenarioId: 'orientation', seed, playerName: 'T', mode: 'step', brain });
      expect(buildView(day, LLM).npcs.filter((v) => v.location === 'waiting' && v.role === 'visitor').length).toBeGreaterThan(n);
    }
  });

  it('nobody shares a chair, sits on a cluttered one, or is in two places', () => {
    const seats = waitingSeats(LAYOUTS.ed);
    expect(seats.length).toBeGreaterThanOrEqual(12);
    expect(seats.some((s) => chairHasClutter(s.id))).toBe(false);
    for (const map of Object.keys(AMBIENT)) {
      for (const seed of seeds) {
        const p = plan(map, seed);
        for (let t = 0; t < SCENARIOS[map].durationMin * 60; t += 20) {
          const seated = [...p.people.entries()].map(([id, tl]) => [id, tl.at(t)] as const).filter(([, s]) => s?.posture === 'sit' && s.room === 'waiting');
          const keys = seated.map(([, s]) => `${s!.at.x.toFixed(2)},${s!.at.z.toFixed(2)}`);
          expect(new Set(keys).size, `${map} seed ${seed} t=${t}: ${seated.map(([id]) => id).join(' ')}`).toBe(keys.length);
        }
      }
    }
  });

  it('nobody stands inside a chair: standing places keep 0.25 m plus a body clear of every chair', () => {
    // chair footprint: 0.5 wide × 0.48 deep, centred 2 cm forward of the prop's origin (props.ts waitingChair)
    const chairs = LAYOUTS.ed.props.filter((p) => p.kind === 'chair' && p.room === 'waiting');
    const clearOf = (x: number, z: number) =>
      Math.min(
        ...chairs.map((c) => {
          const r = c.rot ?? 0;
          const dx = x - c.x;
          const dz = z - c.z;
          // into the chair's frame (x across, z forward)
          const lx = dx * Math.cos(r) - dz * Math.sin(r);
          const lz = dx * Math.sin(r) + dz * Math.cos(r) - 0.02;
          return Math.hypot(Math.max(0, Math.abs(lx) - 0.25), Math.max(0, Math.abs(lz) - 0.24));
        }),
      );
    for (const map of Object.keys(AMBIENT)) {
      for (const seed of seeds) {
        const p = plan(map, seed);
        for (const [id, tl] of p.people) {
          for (const sg of tl.segs) {
            if (sg.posture !== 'stand' || sg.room !== 'waiting' || sg.t1 - sg.t0 < 2 * SCENARIOS[map].defaultTimeScale) continue;
            expect(clearOf(sg.at.x, sg.at.z), `${map} seed ${seed}: ${id} stands at ${sg.at.x.toFixed(2)},${sg.at.z.toFixed(2)}`).toBeGreaterThanOrEqual(0.44);
          }
        }
      }
    }
  });

  it('at most one emergency per shift, inside the shift, and it plays out fully', () => {
    let any = 0;
    for (const seed of seeds) {
      const p = plan('night_shift', seed);
      const scenes = p.scenes.filter((s) => s.kind === 'collapse');
      expect(scenes.length).toBeLessThanOrEqual(1);
      if (p.collapseAt === undefined) continue;
      any++;
      const sc = scenes[0];
      expect(sc.t1).toBeLessThan(SCENARIOS.night_shift.durationMin * 60);
      const who = p.lines.filter((l) => l.t >= p.collapseAt! && l.t <= sc.t1).map((l) => l.who);
      for (const role of ['amb_faint', 'amb_faint_friend', 'sec_dave', 'clerk_paul', 'nurse']) expect(who).toContain(role);
      expect(p.cues.some((c) => c.kind === 'overhead' && c.t > p.collapseAt!)).toBe(true);
      // he comes round within about a minute (at the default speed) and leaves in a wheelchair
      const pat = p.people.get('amb_faint')!;
      const down = pat.segs.find((s) => s.act === 'floor')!;
      const up = pat.segs.find((s) => s.act === 'come_round')!;
      expect((up.t0 - down.t0) / SCENARIOS.night_shift.defaultTimeScale).toBeLessThan(65);
      expect(pat.segs.some((s) => s.props?.includes('wheelchair') && s.pushedBy === 'nurse')).toBe(true);
    }
    expect(any).toBeGreaterThan(0);
  });

  it('a nurse calling a name walks to the door: the stand-in from the treatment area, never appearing there', () => {
    for (const seed of [1, 11, 42]) {
      const sc = SCENARIOS.night_shift;
      const plan = planAmbient({ seed, mapId: sc.id, layout: LAYOUTS[sc.layoutId], durationMin: sc.durationMin, timeScale: sc.defaultTimeScale, shiftStart: sc.shiftStart })!;
      for (const call of plan.scenes.filter((x) => x.kind === 'call')) {
        // both start where they are (her desk, the treatment area) when the scene does, and walk from there
        for (const segs of [call.lena, call.float]) {
          expect(segs[0].t0, call.id).toBe(call.t0);
          expect(segs[0].room, call.id).not.toBe('waiting');
          expect(segs[1].act, call.id).toBe('clipboard');
          expect(segs[1].t0, call.id).toBeGreaterThan(call.t0);
        }
      }
    }
  });

  it('the triage nurse is only borrowed when she is free; otherwise a stand-in comes', () => {
    const s = new GameSession({ scenarioId: 'night_shift', seed: 42, playerName: 'T', mode: 'step', brain });
    const call = s.ambient.plan!.scenes.find((x) => x.kind === 'call')!;
    s.playerLocation = 'triage';
    s.advance(call.t0 + 60 - s.t);
    const npcs = buildView(s, LLM).npcs;
    const lena = npcs.find((n) => n.id === 'rn_lena')!;
    expect(lena.location).toBe('triage');
    expect(lena.ambient).toBeUndefined();
    expect(npcs.some((n) => n.id === 'amb_float_rn')).toBe(true);
    // her simulation state never moves
    expect(s.staff.get('rn_lena')!.location).toBe('triage');
  });

  it('speech only when you are within earshot, marked ambient, with a cast voice', () => {
    const s = new GameSession({ scenarioId: 'night_shift', seed: 42, playerName: 'T', mode: 'realtime', brain });
    const heard: { npcId?: string; ambient?: boolean; volume?: number }[] = [];
    s.on((e) => e.kind === 'speech' && heard.push(e));
    s.playerLocation = 'bed_2';
    for (let i = 0; i < 600; i++) s.advance(3);
    expect(heard.filter((e) => e.ambient)).toHaveLength(0);
    s.playerLocation = 'waiting';
    for (let i = 0; i < 1200; i++) s.advance(3);
    const amb = heard.filter((e) => e.ambient);
    expect(amb.length).toBeGreaterThan(5);
    for (const e of amb) {
      expect(e.volume).toBeGreaterThan(0);
      expect(e.volume).toBeLessThanOrEqual(1);
      const crowd = PERSONAS[e.npcId!] || e.npcId === 'amb_float_rn';
      if (crowd) expect(s.ambient.voiceOf(e.npcId!), e.npcId).toBeDefined();
      else expect(s.staff.has(e.npcId!), e.npcId).toBe(true);
    }
  });
});

describe('ambient content', () => {
  const lev = (a: string, b: string) => {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  };

  it('no crowd name looks like a patient on the board (look-alike names are a gameplay error to catch)', () => {
    const last = Object.values(CASES).map((c) => c.patient.lastName.toLowerCase());
    const first = Object.values(CASES).map((c) => c.patient.firstName.toLowerCase());
    for (const p of Object.values(PERSONAS)) {
      if (!p.callName) continue;
      const parts = p.callName.toLowerCase().split(/\s+/);
      const sur = parts[parts.length - 1];
      for (const n of last) expect(sur === n || sur.slice(0, 5) === n.slice(0, 5) || lev(sur, n) <= 2, `${p.callName} ~ ${n}`).toBe(false);
      expect(first, p.callName).not.toContain(parts[0]);
    }
  });

  it('voices: distinct within the crowd, never a waiting-room regular or the soundscape TV/PA', () => {
    for (const [map, def] of Object.entries(AMBIENT)) {
      const ids = Object.values(def.voices).map((v) => v.id);
      expect(new Set(ids).size, map).toBe(ids.length);
      const near = SCENARIOS[map].staff.filter((st) => ['waiting', 'triage'].includes(st.home.room)).map((st) => st.voice!.id);
      for (const id of ids) {
        expect(near, `${map}: ${id}`).not.toContain(id);
        expect(['bm_george', 'bf_lily', 'af_sky'], `${map}: ${id}`).not.toContain(id);
      }
      // patients and families of the shift never share a voice with the crowd (they sit in the same building)
      for (const { caseId } of SCENARIOS[map].patients) {
        const c = CASES[caseId];
        const close = c.patient.voice!.id;
        if (['ft_1', 'ft_2'].includes(SCENARIOS[map].patients.find((x) => x.caseId === caseId)!.bed)) expect(ids, `${map}: ${caseId}`).not.toContain(close);
        if (c.family) expect(ids, `${map}: ${c.family.npcId} may wait in the waiting room`).not.toContain(c.family.voice!.id);
      }
    }
  });

  it('every crowd member is cast with a clean avatar', () => {
    const EXCLUDED = ['Female_Adult_06', 'Female_Adult_10', 'Female_Adult_16', 'Male_Adult_15', 'Male_Adult_19', 'Male_Adult_21'];
    for (const p of [...Object.values(PERSONAS), { id: 'amb_float_rn' } as const]) {
      expect(CAST[p.id], `${p.id} has an authored avatar`).toBeDefined();
      expect(EXCLUDED).not.toContain(CAST[p.id].id);
    }
    for (const p of Object.values(PERSONAS)) expect(castFor(p.id, 'visitor', p.appearance).id).toMatch(p.sex === 'f' ? /Female/ : /Male/);
  });
});
