/**
 * Hand hygiene and masks: the 'hygiene' action and its record (server/sim/hygiene.ts), the WHO
 * moment 1 and 4 computation, isolation precautions on the board, the debrief's unscored section,
 * and the dispensers placed by rule (shared/hygiene.ts).
 */
import { describe, expect, it } from 'vitest';
import { upperLevels } from '../shared/floors';
import { FIXTURE_SIZE, hygienePlan, isPatientSpace } from '../shared/hygiene';
import { LAYOUTS, type PropDef, type RoomDef } from '../shared/layout';
import { NpcBrain } from '../server/npc/brain';
import { boardText } from '../server/sim/agentText';
import { afterGloves, whoMoments, type IcEvent } from '../server/sim/hygiene';
import { debrief } from '../server/sim/scoring';
import { GameSession, M } from '../server/sim/session';
import { buildView } from '../server/sim/views';

const brain = new NpcBrain(null); // offline, deterministic
const night = (seed = 7) => new GameSession({ scenarioId: 'night_shift', seed, playerName: 'Test', mode: 'step', brain });
const CORRIDORS = new Set(['hub', 'street', 'clinic_hall', 'ems', 'waiting']);
const transit = (room: string) => CORRIDORS.has(room);

/** a trace from a compact script: '>room' (enter), '@pid' (examine), 'rub' / 'wash' / 'mask_on' / 'mask_off' */
function trace(script: string): IcEvent[] {
  const out: IcEvent[] = [];
  let room = 'station';
  const where: Record<string, string> = { a: 'bed_2', b: 'bed_3' };
  script
    .split(/\s+/)
    .filter(Boolean)
    .forEach((w, t) => {
      if (w.startsWith('>')) {
        out.push({ t, kind: 'enter', room: w.slice(1), from: room, patients: Object.keys(where).filter((p) => where[p] === w.slice(1)) });
        room = w.slice(1);
      } else if (w.startsWith('@')) out.push({ t, kind: 'contact', room: where[w.slice(1)], pid: w.slice(1) });
      else out.push({ t, kind: w as 'rub', room });
    });
  return out;
}
const moments = (script: string) => {
  const r = whoMoments(trace(script), 'station', transit);
  return { ...r, m: r.moments.map((x) => `${x.moment}${x.pid}:${x.ok ? 'ok' : 'miss'}`) };
};

describe('the hygiene action', () => {
  it('records rubs, washes and masks where you are, costs no time, and refuses nonsense', async () => {
    const s = night();
    await s.act({ type: 'move', to: 'hub' });
    const t0 = s.t;
    const rub = await s.act({ type: 'hygiene', kind: 'rub', at: 'rub_bed_2_out' });
    expect(rub).toMatchObject({ ok: true, costMin: 0 });
    expect(s.t).toBe(t0);
    expect((await s.act({ type: 'hygiene', kind: 'gargle' as 'rub' })).ok).toBe(false);
    expect((await s.act({ type: 'hygiene', kind: 'mask_off' })).ok).toBe(false);
    expect((await s.act({ type: 'hygiene', kind: 'mask_on', at: 'mask_station' })).ok).toBe(true);
    expect((await s.act({ type: 'hygiene', kind: 'mask_on' })).ok).toBe(false);
    expect(buildView(s, s.brain.status).player.masked).toBe(true);
    await s.act({ type: 'move', to: 'bed_2' });
    expect((await s.act({ type: 'hygiene', kind: 'wash', at: 'bed_2_sink' })).ok).toBe(true);
    expect((await s.act({ type: 'hygiene', kind: 'mask_off' })).ok).toBe(true);
    expect(buildView(s, s.brain.status).player.masked).toBeUndefined();
    const ic = debrief(s).infectionControl!;
    expect(ic.actions.map((a) => [a.kind, a.room, a.at])).toEqual([
      ['rub', 'hub', 'rub_bed_2_out'],
      ['mask_on', 'hub', 'mask_station'],
      ['wash', 'bed_2', 'bed_2_sink'],
      ['mask_off', 'bed_2', undefined],
    ]);
    expect(ic.actions[0].roomLabel).toBe('Main corridor');
    // nothing of it reaches the scoring log
    expect(s.log.some((e) => (e.kind as string) === 'hygiene')).toBe(false);
  });

  it('leaves the score and the scoring log exactly as they were', async () => {
    const run = async (clean: boolean) => {
      const s = night(11);
      await s.act({ type: 'wait', minutes: 6 });
      if (clean) await s.act({ type: 'hygiene', kind: 'rub' });
      await s.act({ type: 'move', to: 'ft_1' });
      if (clean) await s.act({ type: 'hygiene', kind: 'rub' });
      await s.act({ type: 'examine', patientId: 'p_okafor', maneuver: 'msk_lat_malleolus' });
      if (clean) await s.act({ type: 'hygiene', kind: 'wash' });
      await s.act({ type: 'move', to: 'station' });
      await s.act({ type: 'wait', minutes: 10 });
      const d = debrief(s);
      return { log: JSON.stringify(s.log), score: d.score, cases: JSON.stringify(d.cases), ic: d.infectionControl! };
    };
    const a = await run(false);
    const b = await run(true);
    expect(b.log).toBe(a.log);
    expect(b.score).toBe(a.score);
    expect(b.cases).toBe(a.cases);
    expect([a.ic.moment1, a.ic.moment4]).toEqual([{ met: 0, of: 1 }, { met: 0, of: 1 }]);
    expect([b.ic.moment1, b.ic.moment4]).toEqual([{ met: 1, of: 1 }, { met: 1, of: 1 }]);
    expect(b.ic.opportunities[0]).toMatchObject({ moment: 1, patientId: 'p_okafor', name: 'Daniel Okafor', bedLabel: 'Fast Track 1', ok: true, by: { kind: 'rub', roomLabel: 'Fast Track 1' } });
  });
});

describe('WHO moments 1 and 4', () => {
  it('a rub at the corridor dispenser before going in meets moment 1; leaving without one misses moment 4', () => {
    expect(moments('>hub rub >bed_2 @a >hub >station').m).toEqual(['1a:ok', '4a:miss']);
  });
  it('a rub in the bay before leaving, or right outside it, meets moment 4', () => {
    expect(moments('>hub >bed_2 rub @a @a wash >hub >station').m).toEqual(['1a:ok', '4a:ok']);
    expect(moments('>hub >bed_2 rub @a >hub rub >station').m).toEqual(['1a:ok', '4a:ok']);
  });
  it('a rub at the station before walking over does not count: you left the station after it', () => {
    expect(moments('rub >hub >bed_2 @a').m).toEqual(['1a:miss']);
  });
  it('one rub between two patients meets moment 4 for the first and moment 1 for the second', () => {
    expect(moments('>hub rub >bed_2 @a >hub rub >bed_3 @b rub >hub').m).toEqual(['1a:ok', '4a:ok', '1b:ok', '4b:ok']);
    // in the first bay on the way out, or in the second before touching: nothing else touched in between
    expect(moments('>hub rub >bed_2 @a rub >hub >bed_3 @b').m).toEqual(['1a:ok', '4a:ok', '1b:ok']);
    expect(moments('>bed_2 rub @a >bed_3 rub @b').m).toEqual(['1a:ok', '4a:ok', '1b:ok']);
    // none at all: both missed
    expect(moments('>hub rub >bed_2 @a >hub >bed_3 @b').m).toEqual(['1a:ok', '4a:miss', '1b:miss']);
  });
  it('a stop at the station between two patients needs a rub after it', () => {
    expect(moments('>bed_2 rub @a rub >hub >station >hub >bed_3 @b').m).toEqual(['1a:ok', '4a:ok', '1b:miss']);
    expect(moments('>bed_2 rub @a >hub >station rub >hub >bed_3 @b').m).toEqual(['1a:ok', '4a:miss', '1b:miss']);
  });
  it('stepping out into the corridor and back to the same patient is one episode', () => {
    expect(moments('>hub rub >bed_2 @a >hub >bed_2 @a rub >hub').m).toEqual(['1a:ok', '4a:ok']);
    // …but a trip to the station in between makes it two
    expect(moments('>hub rub >bed_2 @a rub >hub >station >hub >bed_2 @a').m).toEqual(['1a:ok', '4a:ok', '1a:miss']);
  });
  it('still in the patient’s room at the end: moment 4 is not due yet', () => {
    const r = moments('>hub rub >bed_2 @a');
    expect(r.m).toEqual(['1a:ok']);
    expect(r.open).toBe(1);
  });
  it('orders by the trace, not the clock: a rub in the same second as the move still happened before it', () => {
    const ev: IcEvent[] = [
      { t: 100, kind: 'rub', room: 'station' },
      { t: 100, kind: 'enter', room: 'bed_2', from: 'station', patients: ['a'] },
      { t: 130, kind: 'contact', room: 'bed_2', pid: 'a' },
    ];
    expect(whoMoments(ev, 'station', transit).moments.map((m) => m.ok)).toEqual([false]);
  });
});

describe('precautions and masks', () => {
  it('Brunner goes on contact precautions once her ESBL culture is known; the agents’ text never shows it', async () => {
    const s = night(5);
    await s.act({ type: 'wait', minutes: 8 });
    const row = () => buildView(s, s.brain.status).board.find((r) => r.id === 'p_brunner')!;
    expect(row().precautions).toBeUndefined();
    const before = boardText(s);
    await s.act({ type: 'move', to: 'bed_4' });
    expect((await s.act({ type: 'inspect', itemId: 'brunner_handbag' })).ok).toBe(true);
    expect(row().precautions).toBe('contact');
    expect(boardText(s)).not.toMatch(/precaution|isolat|contact/i);
    expect(before).not.toMatch(/precaution/i);
    // contact precautions need no mask: nothing to list
    await s.act({ type: 'move', to: 'hub' });
    await s.act({ type: 'move', to: 'bed_4' });
    expect(debrief(s).infectionControl!.masks).toEqual([]);
  });

  it('droplet precautions: each visit says whether a mask was on as you went in', async () => {
    const s = night(9);
    await s.act({ type: 'wait', minutes: 2 });
    const ok = s.patients.get('p_okafor')!;
    ok.c = { ...ok.c, precautions: { kind: 'droplet', reason: 'influenza A (test)' } };
    expect(buildView(s, s.brain.status).board.find((r) => r.id === 'p_okafor')!.precautions).toBe('droplet');
    await s.act({ type: 'move', to: 'ft_1' });
    await s.act({ type: 'move', to: 'hub' });
    await s.act({ type: 'hygiene', kind: 'mask_on' });
    await s.act({ type: 'move', to: 'ft_1' });
    const m = debrief(s).infectionControl!.masks;
    expect(m.map((x) => [x.patientId, x.precaution, x.masked])).toEqual([
      ['p_okafor', 'droplet', false],
      ['p_okafor', 'droplet', true],
    ]);
  });
});

describe('gloves', () => {
  it('gloves on and off are recorded (0 min), a pair at a time; hand hygiene waits until they are off', async () => {
    const s = night();
    await s.act({ type: 'move', to: 'bed_4' });
    const t0 = s.t;
    expect((await s.act({ type: 'hygiene', kind: 'gloves_off' })).ok).toBe(false);
    expect(await s.act({ type: 'hygiene', kind: 'gloves_on', at: 'bed_4_sink_gloves' })).toMatchObject({ ok: true, costMin: 0 });
    expect(s.t).toBe(t0);
    expect((await s.act({ type: 'hygiene', kind: 'gloves_on' })).ok).toBe(false);
    expect(buildView(s, s.brain.status).player.gloved).toBe(true);
    // rubbing gloved hands is not hand hygiene
    expect((await s.act({ type: 'hygiene', kind: 'rub' })).ok).toBe(false);
    expect((await s.act({ type: 'hygiene', kind: 'gloves_off', at: 'bed_4_sink_bin' })).ok).toBe(true);
    expect(buildView(s, s.brain.status).player.gloved).toBeUndefined();
    expect((await s.act({ type: 'hygiene', kind: 'rub' })).ok).toBe(true);
    const ic = debrief(s).infectionControl!;
    expect(ic.actions.map((a) => a.kind)).toEqual(['gloves_on', 'gloves_off', 'rub']);
    expect(ic.afterGloves).toEqual([expect.objectContaining({ ok: true, by: expect.objectContaining({ kind: 'rub' }) })]);
  });

  it('contact precautions: each examination of Brunner says whether gloves were on', async () => {
    const s = night(5);
    await s.act({ type: 'wait', minutes: 8 });
    await s.act({ type: 'move', to: 'bed_4' });
    // before her ESBL is known nothing is listed
    await s.act({ type: 'examine', patientId: 'p_brunner', maneuver: 'back_cva' });
    expect((await s.act({ type: 'inspect', itemId: 'brunner_handbag' })).ok).toBe(true);
    await s.act({ type: 'examine', patientId: 'p_brunner', maneuver: 'back_cva' });
    await s.act({ type: 'hygiene', kind: 'gloves_on' });
    await s.act({ type: 'examine', patientId: 'p_brunner', maneuver: 'back_cva' });
    const g = debrief(s).infectionControl!.gloves!;
    expect(g.map((x) => [x.patientId, x.gloved])).toEqual([
      ['p_brunner', false],
      ['p_brunner', true],
    ]);
  });

  it('after gloves come off: a rub or a wash before the next patient, pair or room where you touch things', () => {
    const run = (script: string) => afterGloves(trace(script), transit).map((g) => (g.open ? 'open' : g.ok ? 'ok' : 'miss'));
    expect(run('>bed_2 gloves_on @a gloves_off rub')).toEqual(['ok']);
    expect(run('>bed_2 gloves_on @a gloves_off >hub rub >bed_3 @b')).toEqual(['ok']);
    expect(run('>bed_2 gloves_on @a gloves_off >bed_3 @b')).toEqual(['miss']);
    expect(run('>bed_2 gloves_on @a gloves_off >station rub')).toEqual(['miss']);
    expect(run('>bed_2 gloves_on @a gloves_off gloves_on @a')).toEqual(['miss']);
    expect(run('>bed_2 gloves_on @a gloves_off')).toEqual(['open']);
  });
});

describe('the AI doctor', () => {
  it('a scripted step-mode run gets the same section twice (deterministic), with every opportunity missed', async () => {
    const run = async () => {
      const s = night(21);
      await s.act({ type: 'wait', minutes: 14 });
      await s.act({ type: 'move', to: 'bed_2' });
      await s.act({ type: 'examine', patientId: 'p_keller', maneuver: 'cv_auscultate' });
      await s.act({ type: 'move', to: 'station' });
      await s.act({ type: 'wait', minutes: 3 });
      return debrief(s).infectionControl!;
    };
    const a = await run();
    expect(await run()).toEqual(a);
    expect(a.actions).toEqual([]);
    expect([a.moment1, a.moment4]).toEqual([{ met: 0, of: 1 }, { met: 0, of: 1 }]);
    void M;
  });
});

// ───────────────────────────── the dispensers, placed by rule (shared/hygiene.ts) ─────────────────────────────

const L = LAYOUTS.ed;
const WALL_T = 0.12;
const storeys = [{ name: 'Floor 1', rooms: L.rooms, props: L.props }, ...upperLevels(L).map((lv) => ({ name: lv.name, rooms: lv.rooms, props: lv.props }))];
const WALL_KINDS = new Set(['handRub', 'soapDispenser', 'towelDispenser', 'gloveHolder', 'maskBox']);
/** a wall fixture's face (axis, plane, facing) and the stretch it covers along the wall */
function span(p: PropDef) {
  const s = FIXTURE_SIZE[p.kind]!;
  const nx = Math.round(Math.sin(p.rot ?? 0));
  const nz = Math.round(Math.cos(p.rot ?? 0));
  const along = nx !== 0 ? p.z : p.x;
  return { axis: nx !== 0 ? 'x' : 'z', c: nx !== 0 ? p.x : p.z, n: nx || nz, a0: along - s.w / 2, a1: along + s.w / 2, y0: p.y ?? s.y0, y1: (p.y ?? s.y0) + s.h };
}
/** inside some room's walled side (where nothing can hang) */
function inWall(rooms: RoomDef[], x: number, z: number) {
  const walled = (r: RoomDef, s: 'n' | 's' | 'e' | 'w') => !r.openSides?.includes(s) && !r.curtainSides?.includes(s);
  return rooms.some((r) => {
    const { x: rx, z: rz, w, d } = r.rect;
    if (r.kind === 'exterior' || x < rx || x > rx + w || z < rz || z > rz + d) return false;
    return (walled(r, 'n') && z < rz + WALL_T - 1e-3) || (walled(r, 's') && z > rz + d - WALL_T + 1e-3) || (walled(r, 'w') && x < rx + WALL_T - 1e-3) || (walled(r, 'e') && x > rx + w - WALL_T + 1e-3);
  });
}

describe('hand-hygiene fixtures, placed by rule', () => {
  it('every patient space has a hand-rub dispenser outside its entrance and one inside near it', () => {
    const { entrances } = hygienePlan(L.rooms, L.props);
    const spaces = L.rooms.filter(isPatientSpace).map((r) => r.id);
    expect(spaces).toEqual(expect.arrayContaining(['bed_1', 'bed_6', 'resus', 'resus_1', 'resus_2', 'ft_1', 'ft_2', 'triage', 'ct', 'xray', 'exam_1', 'exam_3']));
    for (const id of spaces) {
      const e = entrances.filter((x) => x.room === id);
      expect(e.length, id).toBeGreaterThan(0);
      for (const x of e) {
        expect(x.out, `${id} outside`).toBeTruthy();
        expect(x.in, `${id} inside`).toBeTruthy();
        const room = L.rooms.find((r) => r.id === id)!;
        const inside = (p: { x: number; z: number }) => p.x > room.rect.x && p.x < room.rect.x + room.rect.w && p.z > room.rect.z && p.z < room.rect.z + room.rect.d;
        expect(inside(x.in!), `${id} inside one is in the room`).toBe(true);
        // the outside one faces away from the room: a little way out along its normal is not in the room
        const o = { x: x.out!.x + Math.sin(x.out!.rot) * 0.3, z: x.out!.z + Math.cos(x.out!.rot) * 0.3 };
        expect(inside(o), `${id} outside one faces the corridor`).toBe(false);
      }
    }
    // a bay's are at its doorway end (the start of the curtain run, where curtains.ts leaves the gap)
    for (let i = 1; i <= 6; i++) {
      const e = entrances.find((x) => x.room === `bed_${i}`)!;
      expect(Math.abs(e.out!.x - (i - 1) * 4), `bed_${i}`).toBeLessThan(0.2);
      expect(e.out!.z, `bed_${i} outside the curtain line`).toBeGreaterThanOrEqual(7.0);
      expect(e.in!.id).toBe(`rub_bed_${i}`);
    }
    // hand-placed ones are kept, not doubled
    expect(entrances.find((x) => x.room === 'exam_1')!.out!.id).toBe('ex1_rub');
    expect(entrances.find((x) => x.room === 'resus_1')!.out!.id).toBe('ems_rub_1');
  });

  it('every sink has soap and hand rub side by side, a towel dispenser and a bin', () => {
    for (const st of storeys) {
      for (const sink of st.props.filter((p) => p.kind === 'sink')) {
        const by = (suffix: string) => st.props.find((p) => p.id === `${sink.id}_${suffix}`);
        const soap = by('soap')!;
        const rub = by('rub')!;
        const towel = by('towel')!;
        expect(soap && rub && towel, `${st.name} ${sink.id}`).toBeTruthy();
        expect(soap.kind).toBe('soapDispenser');
        expect(rub.kind).toBe('handRub');
        const a = span(soap);
        const b = span(rub);
        expect([a.axis, a.c, a.n, a.y0]).toEqual([b.axis, b.c, b.n, b.y0]);
        expect(Math.abs((a.a0 + a.a1) / 2 - (b.a0 + b.a1) / 2), `${sink.id} side by side`).toBeLessThan(0.16);
        const bin = st.props.find((p) => (p.kind === 'pedalBin' || p.kind === 'trash') && Math.hypot(p.x - towel.x, p.z - towel.z) < 1.0);
        expect(bin, `${st.name} ${sink.id} bin`).toBeTruthy();
      }
    }
  });

  it('nothing hangs in a doorway, behind a parked sliding leaf, inside a wall or on top of something else', () => {
    for (const st of storeys) {
      const mine = st.props.filter((p) => WALL_KINDS.has(p.kind) && p.label !== 'counter');
      const fixtures = mine.map((p) => ({ p, s: span(p) }));
      for (const { p, s } of fixtures) {
        // open air in front of both ends
        for (const a of [s.a0 + 0.01, s.a1 - 0.01]) {
          const x = s.axis === 'x' ? s.c + s.n * 0.03 : a;
          const z = s.axis === 'x' ? a : s.c + s.n * 0.03;
          expect(inWall(st.rooms, x, z), `${st.name} ${p.id} in a wall`).toBe(false);
        }
        // doors: the opening plus its frame, both faces; sliding leaves parked inside
        for (const r of st.rooms)
          for (const d of r.doors) {
            const alongX = d.side === 'n' || d.side === 's';
            if ((s.axis === 'z') !== alongX) continue;
            const line = d.side === 'n' ? r.rect.z : d.side === 's' ? r.rect.z + r.rect.d : d.side === 'w' ? r.rect.x : r.rect.x + r.rect.w;
            if (Math.abs(s.c - line) > WALL_T + 0.01) continue;
            const a = (alongX ? r.rect.x : r.rect.z) + d.offset;
            const b = a + d.width;
            const lo = d.kind === 'sliding' && !d.pocket && Math.abs(s.c - line) > 0.06 ? a - d.width / 2 : a;
            const hi = d.kind === 'sliding' && !d.pocket && Math.abs(s.c - line) > 0.06 ? b + d.width / 2 : b;
            expect(s.a1 <= lo - 0.04 || s.a0 >= hi + 0.04, `${st.name} ${p.id} at ${r.id}'s door`).toBe(true);
          }
        // no two on one face overlapping
        for (const o of fixtures) {
          if (o.p === p || o.s.axis !== s.axis || o.s.n !== s.n || Math.abs(o.s.c - s.c) > 0.03) continue;
          const overlap = o.s.a0 < s.a1 && o.s.a1 > s.a0 && o.s.y0 < s.y1 && o.s.y1 > s.y0;
          expect(overlap, `${st.name} ${p.id} × ${o.p.id}`).toBe(false);
        }
      }
    }
  });

  it('masks at the walk-in entrance, the ambulance entrance and the nurses\' station', () => {
    const at = (id: string) => L.props.find((p) => p.id === id)!;
    expect(at('mask_walkin')).toMatchObject({ kind: 'maskStation', room: 'waiting' });
    // by the walk-in door (waiting room, south wall, x 3.8–6.2), inside
    expect(at('mask_walkin').z).toBeGreaterThan(22.5);
    expect(at('mask_walkin').x).toBeLessThan(3.8);
    expect(at('mask_ems')).toMatchObject({ kind: 'maskBox', room: 'ems' });
    expect(at('mask_station')).toMatchObject({ kind: 'maskBox', room: 'station', label: 'counter' });
    // the server times the waiting room's walks round solid floor props: the stand isn't one
    expect(at('mask_walkin').solid).toBeFalsy();
  });

  it('is idempotent: the plan run on a storey that has it adds nothing', () => {
    expect(hygienePlan(L.rooms, L.props, { masks: true }).props).toEqual([]);
    for (const lv of upperLevels(L)) expect(hygienePlan(lv.rooms, lv.props, { partitions: lv.partitions }).props).toEqual([]);
  });
});
