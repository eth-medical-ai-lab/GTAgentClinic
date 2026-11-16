/**
 * Who looks like whom (client/src/world/casting.ts), for every character of every map:
 *  - no religious symbols or garments (the excluded avatars are never converted or cast)
 *  - the player (the watcher in observe mode) and the AI resident wear models nobody else wears
 *  - every staff member's face is theirs alone on a map
 *  - anyone else shares a face only with someone who is never in the same room at the same time
 *    (the waiting-room crowd's rooms come from its seeded plans), and then with strongly different
 *    skin, hair and garment colors
 *  - faces fit the character: sex, and grey (or no) hair when old
 * A character's face is its head model (a cast can wear another avatar's head; FACE_OF maps models
 * that upstream gave the same face). The cast is enumerated from the content, and a sweep through
 * each shift's server views makes sure no NPC is left out as content grows.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAST, EXCLUSIVE, HEAD_NEEDS_OWN_BODY, HOODED, castAvatarIds, castFor, faceOf, modelsOf, type AvatarCast } from '../client/src/world/casting';
import { AMBIENT, FLOAT_RN, PERSONAS } from '../content/ambient';
import { CASES, SCENARIOS } from '../content/scenarios';
import { NpcBrain } from '../server/npc/brain';
import { planAmbient } from '../server/sim/ambient';
import { GameSession } from '../server/sim/session';
import { buildView } from '../server/sim/views';
import { LAYOUTS } from '../shared/layout';
import type { Appearance, LlmStatus, NpcRole } from '../shared/types';

const ROOT = path.resolve(__dirname, '..');
const INDEX = JSON.parse(readFileSync(path.join(ROOT, 'client/public/res/chars/index.json'), 'utf8')) as {
  avatars: Record<string, { sex: 'm' | 'f'; skin?: string | null; hair?: string | null }>;
};
/** Rocketbox avatars that wear religious garments (headscarves, kufi/taqiyah, keffiyeh/thobe, chador, burqa) */
const EXCLUDED = ['Female_Adult_06', 'Female_Adult_10', 'Female_Adult_16', 'Male_Adult_15', 'Male_Adult_19', 'Male_Adult_21'];
const RELIGIOUS_ACCESSORY = /headscarf|hijab|niqab|burqa|chador|turban|kippah|yarmulke|crucifix|cross|rosary|kufi|taqiyah/i;

// ───────────────────────────── who is on each map ─────────────────────────────

type Kind = 'player' | 'ai' | 'staff' | 'patient' | 'family' | 'visitor' | 'crowd';
interface Person {
  id: string;
  kind: Kind;
  sex: 'm' | 'f';
  old: boolean;
  /** rooms they can be in all shift (the crowd: from the plans) */
  rooms: string[];
}

/** Kokoro voices name the speaker's sex: af_/bf_ female, am_/bm_ male */
const voiceSex = (v?: string): 'm' | 'f' | undefined => (v && /^[ab]f_/.test(v) ? 'f' : v && /^[ab]m_/.test(v) ? 'm' : undefined);
/** the waiting room's own visitors (content/scenarios.ts): seated there all shift */
const SEEDS = Array.from({ length: 40 }, (_, i) => 101 + i * 37);
const plans = new Map(
  Object.keys(SCENARIOS).map((map) => {
    const sc = SCENARIOS[map];
    return [map, SEEDS.map((seed) => planAmbient({ seed, mapId: map, layout: LAYOUTS[sc.layoutId], durationMin: sc.durationMin, timeScale: sc.defaultTimeScale, shiftStart: sc.shiftStart })).filter((p) => !!p)];
  }),
);

function people(map: string): Person[] {
  const sc = SCENARIOS[map];
  const out: Person[] = [
    { id: 'player', kind: 'player', sex: 'm', old: false, rooms: ['*'] },
    { id: 'ai_doctor', kind: 'ai', sex: 'm', old: false, rooms: ['*'] },
  ];
  for (const st of sc.staff) {
    const sex = voiceSex(st.voice?.id);
    expect(sex, `${st.id}: voice tells the sex`).toBeDefined();
    out.push({ id: st.id, kind: st.role === 'visitor' ? 'visitor' : 'staff', sex: sex!, old: st.appearance.age === 'old', rooms: [st.home.room] });
  }
  for (const p of sc.patients) {
    const c = CASES[p.caseId];
    // server/sim/session.ts names patients p_<last name>; their NPC is pt_<patient id>
    out.push({ id: `pt_p_${c.patient.lastName.toLowerCase()}`, kind: 'patient', sex: c.patient.sex === 'F' ? 'f' : 'm', old: c.patient.appearance.age === 'old', rooms: [p.bed] });
    if (c.family) {
      const sex = voiceSex(c.family.voice?.id);
      expect(sex, `${c.family.npcId}: voice tells the sex`).toBeDefined();
      // at the bedside, or sent out to the waiting room for a while
      out.push({ id: c.family.npcId, kind: 'family', sex: sex!, old: c.family.appearance.age === 'old', rooms: [p.bed, 'waiting'] });
    }
  }
  const crowd = new Map<string, Set<string>>();
  for (const plan of plans.get(map) ?? []) {
    for (const [id, tl] of plan.people) {
      if (!PERSONAS[id]) continue;
      const rooms = crowd.get(id) ?? new Set<string>();
      for (const s of tl.segs) rooms.add(s.room);
      crowd.set(id, rooms);
    }
  }
  for (const [id, rooms] of crowd) out.push({ id, kind: 'crowd', sex: PERSONAS[id].sex, old: PERSONAS[id].appearance.age === 'old', rooms: [...rooms] });
  if (AMBIENT[map]) out.push({ id: FLOAT_RN.id, kind: 'staff', sex: 'f', old: false, rooms: ['hub', 'waiting'] });
  // the building's floor 2 is part of every map
  return [...out, ...WARD];
}

/**
 * People the client spawns itself (never in the server's views): Ward 2 East on floor 2
 * (client/src/world/ward.ts). Its nurses walk the floor; its patients stay in their rooms.
 */
const WARD_TS = path.join(ROOT, 'client/src/world/ward.ts');
const WARD: Person[] = [
  { id: 'ward_ana', kind: 'staff', sex: 'f', old: false, rooms: ['f2'] },
  { id: 'ward_theo', kind: 'staff', sex: 'm', old: false, rooms: ['f2'] },
  { id: 'ward_pt_201', kind: 'patient', sex: 'f', old: true, rooms: ['f2_room_201'] },
  { id: 'ward_pt_202', kind: 'patient', sex: 'm', old: true, rooms: ['f2_room_202'] },
  { id: 'ward_pt_204', kind: 'patient', sex: 'm', old: false, rooms: ['f2_room_204'] },
  { id: 'ward_pt_205', kind: 'patient', sex: 'f', old: true, rooms: ['f2_room_205'] },
];
const MAPS = Object.keys(SCENARIOS);
const CASTS = new Map(MAPS.map((m) => [m, people(m)]));

/** in the same room at the same time, ever? (the crowd: any seeded plan; anyone else: their rooms) */
function together(map: string, a: Person, b: Person): boolean {
  if (a.kind === 'crowd' && b.kind === 'crowd') {
    return (plans.get(map) ?? []).some((plan) => {
      const A = plan.people.get(a.id)?.segs ?? [];
      const B = plan.people.get(b.id)?.segs ?? [];
      return A.some((x) => B.some((y) => x.room === y.room && x.t0 < y.t1 && y.t0 < x.t1));
    });
  }
  return a.rooms.includes('*') || b.rooms.includes('*') || a.rooms.some((r) => b.rooms.includes(r));
}

// ───────────────────────────── how different two looks are ─────────────────────────────

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** sRGB per-channel RMS distance, 0..255 */
const dist = (a: string, b: string) => {
  const [x, y] = [rgb(a), rgb(b)];
  return Math.sqrt(((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2) / 3);
};
const mix = (a: string, b: string, t: number) => '#' + rgb(a).map((x, i) => Math.round(x + (rgb(b)[i] - x) * t).toString(16).padStart(2, '0')).join('');
/** avatars.ts greys hair toward this silver */
const SILVER = '#bdbdbd';
const STRONG = 30;
const head = (c: AvatarCast) => c.head ?? c.id;
const skinOf = (c: AvatarCast) => c.skin ?? INDEX.avatars[head(c)].skin!;
/** what hair shows: a color, null (bald or shaved: nothing to recolor), or hidden under a hood */
function hairOf(c: AvatarCast): string | null | 'hidden' {
  if (HOODED.has(c.id)) return 'hidden';
  const own = INDEX.avatars[head(c)].hair;
  if (!own) return null;
  return c.hair ?? (c.grey ? mix(own, SILVER, c.grey) : own);
}
function hairDiffers(a: AvatarCast, b: AvatarCast): boolean {
  const [x, y] = [hairOf(a), hairOf(b)];
  if (x === 'hidden' || y === 'hidden') return true;
  if (x === null || y === null) return x !== y;
  return dist(x, y) >= STRONG;
}
function garmentDiffers(a: AvatarCast, b: AvatarCast): boolean {
  if (a.id !== b.id) return true;
  const [x, y] = [a.scrubs ?? a.hue?.to, b.scrubs ?? b.hue?.to];
  return !x || !y ? x !== y : dist(x, y) >= STRONG;
}
const greyish = (h: string) => {
  const c = rgb(h);
  return Math.max(...c) - Math.min(...c) <= 40 && (c[0] + c[1] + c[2]) / 3 >= 110;
};

// ───────────────────────────── the rules ─────────────────────────────

describe('no religious symbols on characters', () => {
  it('authored casting never uses an excluded avatar, as body or head', () => {
    for (const [npc, cast] of Object.entries(CAST)) for (const m of modelsOf(cast)) expect(EXCLUDED, `${npc} → ${m}`).not.toContain(m);
  });

  it('the converted avatar set and the conversion list exclude them', () => {
    const list = readFileSync(path.join(ROOT, 'scripts/assets/rocketbox.mjs'), 'utf8');
    const listed = list.slice(list.indexOf('export const AVATARS'));
    for (const id of EXCLUDED) {
      expect(Object.keys(INDEX.avatars)).not.toContain(id);
      expect(listed.includes(`${id}:`), `${id} listed in rocketbox.mjs`).toBe(false);
    }
  });

  it('no NPC in any scenario wears a religious accessory, and fallback casting stays clean', () => {
    for (const sc of Object.values(SCENARIOS)) {
      for (const st of sc.staff) {
        for (const acc of st.appearance.accessories ?? []) expect(acc).not.toMatch(RELIGIOUS_ACCESSORY);
        for (const m of modelsOf(castFor(st.id, st.role, st.appearance))) expect(EXCLUDED).not.toContain(m);
      }
    }
    for (const c of poolPicks()) for (const m of modelsOf(c)) expect(EXCLUDED).not.toContain(m);
  });
});

/** fallback picks for unknown NPCs of every kind */
function poolPicks(): AvatarCast[] {
  const out: AvatarCast[] = [];
  const roles: [NpcRole, Appearance['outfit']][] = [['patient', 'gown'], ['visitor', 'casual'], ['nurse', 'scrubs'], ['tech', 'scrubs'], ['attending', 'coat'], ['resident', 'coat'], ['consultant', 'suit'], ['ems', 'ems'], ['clerk', 'uniform'], ['family', 'casual']];
  for (let i = 0; i < 60; i++) {
    for (const [role, outfit] of roles) {
      const a: Appearance = { skin: '#c99', hair: '#333', hairStyle: i % 2 ? 'long' : 'short', outfit, outfitColor: '#888', height: 1.7, build: 'average', age: i % 3 ? 'adult' : 'old' };
      out.push(castFor(`npc_${i}`, role, a), castFor(`npc_${i}`, role, a, i % 2 ? 'f' : 'm'));
    }
  }
  return out;
}

describe('everyone looks like themselves', () => {
  it('every model a cast uses ships, and every character of every map has an authored cast', () => {
    for (const c of [...Object.values(CAST), ...poolPicks()]) for (const m of modelsOf(c)) expect(INDEX.avatars[m], `${m} in index.json`).toBeDefined();
    expect(castAvatarIds().length).toBeGreaterThan(30);
    for (const [map, list] of CASTS) for (const p of list) expect(CAST[p.id], `${map}: ${p.id} (${p.kind}) has an authored cast`).toBeDefined();
  });

  it("floor 2's ward spawns nobody this test does not know", () => {
    // ward.ts names its people: staff `id: 'ward_…'`, patients by room (ward_pt_ + the room number)
    const src = readFileSync(WARD_TS, 'utf8');
    const ids = [...src.matchAll(/id: '(ward_[a-z0-9_]+)'/g)].map((m) => m[1]);
    const rooms = [...src.matchAll(/\['(f2_room_\d+)', look\(/g)].map((m) => `ward_pt_${m[1].slice(-3)}`);
    expect(ids.length + rooms.length, 'ward.ts still names its people the way this test reads them').toBeGreaterThan(0);
    for (const id of [...ids, ...rooms]) expect(WARD.map((p) => p.id), `${id} (ward.ts)`).toContain(id);
  });

  it('the shifts show nobody the casting does not know (a sweep through each shift)', async () => {
    const LLM: LlmStatus = { provider: 'offline', label: 'offline', ok: true };
    for (const map of MAPS) {
      const known = new Set(CASTS.get(map)!.map((p) => p.id));
      const s = new GameSession({ scenarioId: map, seed: 77, playerName: 'T', mode: 'step', brain: new NpcBrain(null) });
      const seen = new Set<string>();
      for (let t = 0; t < SCENARIOS[map].durationMin; t += 15) {
        for (const n of buildView(s, LLM).npcs) seen.add(n.id);
        await s.act({ type: 'wait', minutes: 15 });
      }
      for (const id of seen) expect(known.has(id), `${map}: ${id} appears in the view but not in this test's cast list`).toBe(true);
    }
  }, 60000);

  it('the player and the AI resident wear models nobody else wears', () => {
    const mine = new Set(Object.values(EXCLUSIVE));
    expect(modelsOf(CAST.player)).toEqual([EXCLUSIVE.player]);
    expect(modelsOf(CAST.ai_doctor)).toEqual([EXCLUSIVE.ai_doctor]);
    expect(faceOf(CAST.player)).not.toBe(faceOf(CAST.ai_doctor));
    for (const [npc, c] of Object.entries(CAST)) {
      if (npc in EXCLUSIVE) continue;
      for (const m of modelsOf(c)) expect(mine.has(m), `${npc} wears ${m}`).toBe(false);
      expect(mine.has(faceOf(c)), `${npc} has the face of ${faceOf(c)}`).toBe(false);
    }
    for (const c of poolPicks()) {
      for (const m of modelsOf(c)) expect(mine.has(m), `fallback ${c.id}/${c.head}`).toBe(false);
      expect(mine.has(faceOf(c))).toBe(false);
    }
  });

  it("every staff member's face is theirs alone on the map", () => {
    for (const [map, list] of CASTS) {
      for (const st of list.filter((p) => p.kind === 'staff')) {
        const face = faceOf(CAST[st.id]);
        const twins = list.filter((p) => p.id !== st.id && faceOf(CAST[p.id]) === face).map((p) => p.id);
        expect(twins, `${map}: ${st.id} (${face})`).toEqual([]);
      }
    }
  });

  it('anyone else shares a face only with someone never in the same room, and then looks strongly different', () => {
    for (const [map, list] of CASTS) {
      const others = list.filter((p) => !['player', 'ai', 'staff'].includes(p.kind));
      for (let i = 0; i < others.length; i++) {
        for (let j = i + 1; j < others.length; j++) {
          const [a, b] = [others[i], others[j]];
          const [ca, cb] = [CAST[a.id], CAST[b.id]];
          if (faceOf(ca) !== faceOf(cb)) continue;
          const pair = `${map}: ${a.id} and ${b.id} (${faceOf(ca)})`;
          expect(together(map, a, b), `${pair} can meet`).toBe(false);
          expect(dist(skinOf(ca), skinOf(cb)), `${pair}: skin`).toBeGreaterThanOrEqual(STRONG);
          expect(hairDiffers(ca, cb), `${pair}: hair`).toBe(true);
          expect(garmentDiffers(ca, cb), `${pair}: garments`).toBe(true);
        }
      }
    }
  });

  it('heads modeled for their own headgear are never worn on another body (a see-through back of the head)', () => {
    for (const [npc, c] of [...Object.entries(CAST), ...poolPicks().map((c, i) => [`fallback ${i}`, c] as const)]) {
      if (c.head && c.head !== c.id) expect(HEAD_NEEDS_OWN_BODY.has(c.head), `${npc}: ${c.head} on ${c.id}`).toBe(false);
    }
  });

  it('skin recolors never lighten a face much (that leaves blotchy, grey-green faces; darker is fine)', () => {
    const lum = (h: string) => {
      const [r, g, b] = rgb(h);
      return 0.3 * r + 0.59 * g + 0.11 * b;
    };
    for (const [npc, c] of Object.entries(CAST)) {
      if (!c.skin) continue;
      expect(lum(c.skin) - lum(INDEX.avatars[head(c)].skin!), `${npc}: ${head(c)} ${INDEX.avatars[head(c)].skin} → ${c.skin}`).toBeLessThanOrEqual(25);
    }
  });

  it('faces fit the character: sex, and grey or no hair when old', () => {
    for (const [map, list] of CASTS) {
      for (const p of list) {
        const c = CAST[p.id];
        for (const m of modelsOf(c)) expect(INDEX.avatars[m].sex, `${map}: ${p.id} wears ${m}`).toBe(p.sex);
        if (!p.old) continue;
        const hair = hairOf(c);
        expect(hair === null || hair === 'hidden' || greyish(hair), `${map}: ${p.id} is old: hair ${hair}`).toBe(true);
      }
    }
  });
});
