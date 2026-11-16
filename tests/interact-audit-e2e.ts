/**
 * Interaction audit, played like a person (tests/human.ts): every interactable on the ground floor and
 * Floor 2 is approached the way a player would — from 1.5–2.5 m away on free floor, facing a natural
 * way in — then the mouse turns the head until the crosshair is on it, the HUD prompt is read, and E
 * (or the right key) is pressed only when the prompt names it. If something else wins, natural second
 * tries follow (look a little higher or lower, a side step left or right, a step closer) and what won
 * is recorded. Then the effect is checked (the panel, the item in hand, the curtain, the seat…) and
 * undone (Esc, G, E to stand up, M…).
 *
 * Inputs are real: mouse moves (pointer lock) and drags (tablet open), WASD, E/F/G/M/P/Esc, clicks.
 * Debug teleports set up the start of each segment only (the start pose for each target, logged as
 * "setup"); Floor 2 is reached once by the elevator (call button, car panel) with real input, Stair 1
 * and its fire door are walked down and up again, then the rest of Floor 2 starts from teleports too.
 * P pauses the shift clock first (a player's key), so the shift can't end mid-audit.
 *
 * Where to start: of the free spots 1.5–2.5 m away with a view of it, one from which a simulation of
 * World.pick() (same candidates, biases, occluders; read only) says the crosshair on it would light
 * it up, as a person walks round to the open side. The row records from how many spots it would win
 * ("spots"): 0 of N means something else is in front of it from everywhere a person could stand. The
 * prompt itself is always the real one, after real aiming. A prompt offering "[F] Inspect" is tried
 * with F too. Failing rows get a triage class (an inspect card shadowed by the same object's own
 * action is design, not a bug; shadowed from every spot; an effect that didn't happen; …).
 *
 * Output (--out, default shots/interact-audit): audit.md (the table), audit.json, steps.log (every
 * input and setup, timestamped), targets.json, fail-*.png (a screenshot for every failing row).
 *
 *   npx tsx tests/interact-audit-e2e.ts [--out=DIR] [--map=night|orientation] [--only=npc,computer,…] [--match=KEY_REGEX] [--limit=N] [--port-base=8000]
 *
 * Segments (--only): npc, computer, curtain, fixture, item, seat, wheelchair, hygiene, maskbin,
 * drinks (coffee, vending, then the bins), elevator (up), stairs (fire door, down and up), floor2.
 * Boots a private server (tests/harness.ts, never the player's 5317) and stops it at the end.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page } from 'playwright';
import { startHarness, type Harness } from './harness';
import { Human, StepLog, installReader, sleep, teleportYawDeg, yawTo, type Box, type V3 } from './human';

const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OUT = opt('out') ?? 'shots/interact-audit';
const MAP = (opt('map') ?? 'night') === 'orientation' ? 'Orientation Day' : 'Night Shift';
const ONLY = opt('only')?.split(',');
const LIMIT = Number(opt('limit') ?? 0);
/** only targets whose key matches (e.g. --match=st_pc|wow to re-run a few) */
const MATCH = opt('match') ? new RegExp(opt('match')!) : null;
const PORT_BASE = Number(opt('port-base') ?? 8000);
const want = (seg: string) => !ONLY || ONLY.includes(seg);
mkdirSync(OUT, { recursive: true });
const VIEW = { width: 1280, height: 720 };

// ───────────────────────────── targets (read from the world) ─────────────────────────────

type Cat =
  | 'npc'
  | 'computer'
  | 'phone'
  | 'board'
  | 'monitor'
  | 'curtain'
  | 'elevator-call'
  | 'elevator-car'
  | 'ward'
  | 'fixture'
  | 'item'
  | 'item-inspect'
  | 'belonging'
  | 'coffee'
  | 'vending'
  | 'chair'
  | 'sofa'
  | 'bin'
  | 'wheelchair'
  | 'rub'
  | 'wash'
  | 'mask'
  | 'maskbin'
  | 'gloves';

interface Target {
  key: string;
  label: string;
  cat: Cat;
  level: number;
  box: Box;
  center: V3;
  /** where to put the crosshair first (an NPC's chest; else the box's center) */
  aim: V3;
  name: string;
  id: string;
}

/** every interactable the aim ray can pick, on both storeys (page side; read only) */
function pageTargets(): Target[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const R = (window as any).__acRead;
  const b3 = (b: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }): Box => ({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
  const mid = (b: Box): V3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const out: Target[] = [];
  const push = (t: Omit<Target, 'aim' | 'center'> & { aim?: V3 }) => out.push({ ...t, center: mid(t.box), aim: t.aim ?? mid(t.box) });
  // people (World.npcBox): lying on a bed, sitting, standing
  for (const st of R.npcs.values()) {
    if (!st.v.talkable || !st.v.visible) continue;
    const p = st.ch.posture;
    const x = st.pos.x;
    const z = st.pos.y;
    let box: Box;
    let aim: V3;
    if (p === 'lie' && !st.path) {
      const s = st.surfaceY ?? 0.64;
      const along = Math.abs(Math.cos(st.yaw)) > 0.5;
      box = { min: [x - (along ? 0.5 : 1.0), 0.2, z - (along ? 1.0 : 0.5)], max: [x + (along ? 0.5 : 1.0), s + 0.45, z + (along ? 1.0 : 0.5)] };
      aim = [x, s + 0.25, z];
    } else if (p === 'sit' && !st.path) {
      box = { min: [x - 0.4, 0, z - 0.4], max: [x + 0.4, st.ch.height * 0.78, z + 0.4] };
      aim = [x, st.ch.height * 0.55, z];
    } else {
      box = { min: [x - 0.33, 0, z - 0.33], max: [x + 0.33, st.ch.height, z + 0.33] };
      aim = [x, st.ch.height * 0.62, z];
    }
    const v = st.v;
    const label = v.role === 'patient' ? `Talk to ${v.name} (${v.title})` : `Talk to ${v.name}${v.title ? ` (${v.title})` : ''}`;
    push({ key: `npc:${v.id}`, label, cat: 'npc', level: 0, box, aim, name: `${v.name} (${v.title})`, id: v.id });
  }
  // the world's own: props (computers, phones, the board, monitors), fixtures, curtains, elevator buttons, the ward's patients
  for (const it of R.built.interactables) {
    const t = it.target;
    const key: string = it.key;
    let cat: Cat;
    if (t.kind === 'computer') cat = 'computer';
    else if (t.kind === 'phone') cat = 'phone';
    else if (t.kind === 'board') cat = 'board';
    else if (t.kind === 'monitor') cat = 'monitor';
    else if (key.startsWith('curtain:')) cat = 'curtain';
    else if (key.includes(':call:')) cat = 'elevator-call';
    else if (key.includes(':car:')) cat = 'elevator-car';
    else if (key.startsWith('ward:')) cat = 'ward';
    else cat = 'fixture';
    const id = key.replace(/^(prop|fx|curtain|ward):/, '');
    push({ key, label: t.label, cat, level: it.level ?? 0, box: b3(it.box), name: cat === 'fixture' ? `${t.label.replace(/^Inspect /, '')} [${id}]` : `${t.label} [${id}]`, id });
  }
  // things lying around (ground floor)
  for (const it of R.items.targets()) {
    const cat: Cat = it.caseItemId ? 'belonging' : it.pickable ? 'item' : 'item-inspect';
    push({ key: `item:${it.id}`, label: it.pickable ? `Pick up ${it.label}` : `Inspect ${it.label}`, cat, level: 0, box: b3(it.box), name: `${it.label} [${it.id}]`, id: it.id });
  }
  // amenities: the coffee machines, every café chair, every sofa, the vending machine (bins: only holding trash)
  const A = R.amenities;
  for (const m of A.machines) push({ key: `use:${m.id}`, label: 'Make a coffee', cat: 'coffee', level: 0, box: b3(m.box), name: `coffee machine [${m.id}]`, id: m.id });
  const offered = new Set(A.targets().map((x: { key: string }) => x.key));
  for (const c of A.chairs) push({ key: `use:sit:${c.id}`, label: 'Sit down', cat: 'chair', level: 0, box: b3(c.box), name: `café chair [${c.id}]${offered.has(`use:sit:${c.id}`) ? '' : ' (taken)'}`, id: c.id });
  for (const s of A.sofas) push({ key: `use:sofa:${s.id}`, label: 'Sit on the sofa', cat: 'sofa', level: s.level ?? 0, box: b3(s.box), name: `sofa [${s.id}]`, id: s.id });
  if (A.vending) push({ key: 'use:vend', label: 'Buy a drink (vending machine)', cat: 'vending', level: 0, box: b3(A.vending.box), name: 'vending machine', id: 'vend' });
  for (const b of A.bins) push({ key: `use:bin:${b.id}`, label: 'Throw away the …', cat: 'bin', level: 0, box: b3(b.box), name: `${b.label} [${b.id}]`, id: b.id });
  // hand hygiene: rub dispensers, sinks (soap dispenser and basin), mask boxes, glove boxes; the bins take a mask off
  for (const a of R.hygiene.targets()) {
    const key: string = a.key;
    const cat: Cat = key.startsWith('use:rub:') ? 'rub' : key.startsWith('use:wash:') ? 'wash' : key.startsWith('use:mask:') ? 'mask' : key.startsWith('use:gloves:') ? 'gloves' : 'maskbin';
    push({ key, label: a.target.label, cat, level: a.level ?? 0, box: b3(a.box), name: `${cat} [${key.slice(4).replace(/^(rub|wash|mask|gloves):/, '')}]`, id: a.target.id });
  }
  for (const b of R.hygiene.bins) push({ key: `use:maskbin:${b.id}`, label: 'Take off your mask into the bin', cat: 'maskbin', level: b.level ?? 0, box: b3(b.box), name: `bin (mask off) [${b.id}]`, id: b.id });
  for (const a of R.wheelchair.targets()) push({ key: a.key, label: a.target.label, cat: 'wheelchair', level: 0, box: b3(a.box), name: 'wheelchair', id: 'wc' });
  return out;
}

/** the target as it is now (labels change: a curtain's, a workstation's user, a machine's countdown) */
function pageLive(key: string): { label: string; box: Box } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const R = (window as any).__acRead;
  const b3 = (b: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }): Box => ({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });
  const it = R.built.interactables.find((i: { key: string }) => i.key === key);
  if (it) return { label: it.target.label, box: b3(it.box) };
  for (const src of [R.amenities, R.hygiene, R.wheelchair]) {
    const a = src.targets().find((x: { key: string }) => x.key === key);
    if (a) return { label: a.target.label, box: b3(a.box) };
  }
  if (key.startsWith('item:')) {
    const i = R.items.targets().find((x: { id: string }) => `item:${x.id}` === key);
    if (i) return { label: i.pickable ? `Pick up ${i.label}` : `Inspect ${i.label}`, box: b3(i.box) };
  }
  if (key.startsWith('npc:')) {
    const st = R.npcs.get(key.slice(4));
    if (st) return { label: st.v.role === 'patient' ? `Talk to ${st.v.name} (${st.v.title})` : `Talk to ${st.v.name}${st.v.title ? ` (${st.v.title})` : ''}`, box: { min: [st.pos.x - 0.4, 0, st.pos.y - 0.4], max: [st.pos.x + 0.4, st.ch.height, st.pos.y + 0.4] } };
  }
  return null;
}

/**
 * Where a person would start: free floor 1.5–2.5 m from the thing (its nearest side), the same
 * room (a walk there no longer than a few steps more than straight), a clear view of it (pick()'s
 * own occluders), nobody standing there; and, as a person picks the open side, a spot from which
 * the crosshair on (some part of) it would light it up and not something in front. That last part
 * is a simulation of World.pick() (the same candidates, biases and occluders, read only); the test
 * then still aims with the mouse and reads the real prompt. Best first. Page side.
 */
function pageStarts(arg: { key: string; box: Box; aim: V3; level: number; floorY: number; rMin?: number; rMax?: number }): {
  starts: { x: number; z: number; r: number; center: number; aim: V3; why: string }[];
  rejected: Record<string, number>;
  /** spots that pass everything but the simulated pick, and how many of them it wins from; what wins elsewhere */
  spots: number;
  wins: number;
  shadow: Record<string, number>;
} {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const R = (window as any).__acRead;
  const THREE = R.THREE;
  const { key, box, aim, level, floorY } = arg;
  const rMin = arg.rMin ?? 1.5;
  const rMax = arg.rMax ?? 2.5;
  const rMid = (rMin + rMax) / 2;
  const nav = level === 0 ? R.nav : R.floors.navFor();
  const rejected: Record<string, number> = {};
  const shadow: Record<string, number> = {};
  const no = (why: string) => (rejected[why] = (rejected[why] ?? 0) + 1);
  if (!nav) return { starts: [], rejected: { 'no nav grid for this storey': 1 }, spots: 0, wins: 0, shadow };
  const cx = (box.min[0] + box.max[0]) / 2;
  const cz = (box.min[2] + box.max[2]) / 2;
  const rectDist = (x: number, z: number) => Math.hypot(Math.max(box.min[0] - x, 0, x - box.max[0]), Math.max(box.min[2] - z, 0, z - box.max[2]));
  const y0 = floorY + 0.05;
  const solidAt = (x: number, z: number, r: number) => {
    for (const b of R.built.colliders) {
      if (b.max.y <= y0 || b.min.y >= y0 + 1.8 || b.isEmpty()) continue;
      if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return true;
    }
    return false;
  };
  const people: { x: number; z: number }[] = [];
  if (level === 0) for (const st of R.npcs.values()) if (st.v.visible) people.push({ x: st.pos.x, z: st.pos.y });
  for (const p of R.floors.wardPeople()) people.push({ x: p.x, z: p.z });
  const tbox = new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max));
  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  const seen = (x: number, z: number, at: V3) => {
    const eye = new THREE.Vector3(x, floorY + 1.65, z);
    ray.set(eye, new THREE.Vector3(at[0] - x, at[1] - eye.y, at[2] - z).normalize());
    const h = ray.intersectBox(tbox, hit);
    if (!h) return false;
    const d = h.distanceTo(eye);
    for (const o of R.built.occluders) {
      const oh = ray.intersectBox(o, new THREE.Vector3());
      if (oh && oh.distanceTo(eye) < d - 0.05) return false;
    }
    return true;
  };
  // ── World.pick(), simulated from a spot (the same candidates and rules; read only) ──
  type C = { key: string; kind: string; box: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }; bias: number };
  const cs: C[] = [];
  const ground = level === 0;
  const tmpBox = () => new THREE.Box3();
  if (ground)
    for (const st of R.npcs.values()) {
      if (!st.v.talkable || !st.v.visible) continue;
      const p = st.ch.posture;
      const x = st.pos.x;
      const z = st.pos.y;
      const b = tmpBox();
      if (p === 'lie' && !st.path) {
        const sy = st.surfaceY ?? 0.64;
        const along = Math.abs(Math.cos(st.yaw)) > 0.5;
        b.min.set(x - (along ? 0.5 : 1.0), 0.2, z - (along ? 1.0 : 0.5));
        b.max.set(x + (along ? 0.5 : 1.0), sy + 0.45, z + (along ? 1.0 : 0.5));
      } else if (p === 'sit' && !st.path) {
        b.min.set(x - 0.4, 0, z - 0.4);
        b.max.set(x + 0.4, st.ch.height * 0.78, z + 0.4);
      } else {
        b.min.set(x - 0.33, 0, z - 0.33);
        b.max.set(x + 0.33, st.ch.height, z + 0.33);
      }
      cs.push({ key: `npc:${st.v.id}`, kind: 'npc', box: b, bias: 0 });
    }
  for (const it of R.built.interactables) if ((it.level ?? 0) === level) cs.push({ key: it.key, kind: it.target.kind, box: it.box, bias: it.target.kind === 'inspect' ? 0.45 : 0 });
  if (ground) for (const it of R.items.targets()) cs.push({ key: `item:${it.id}`, kind: 'item', box: it.box, bias: -0.05 });
  for (const src of [R.amenities, R.hygiene, R.wheelchair]) for (const a of src.targets()) if ((a.level ?? 0) === level) cs.push({ key: a.key, kind: a.target.kind, box: a.box, bias: 0 });
  // a mask-off bin or a bin for trash is only offered in that state: count it in
  if (!cs.some((c) => c.key === key)) cs.push({ key, kind: 'use', box: tbox, bias: 0 });
  const same = (k: string) => k === key || (key.startsWith('use:wash:') && k.replace(/:sink$/, '') === key.replace(/:sink$/, ''));
  const simPick = (x: number, z: number, at: V3): string | null => {
    const eye = new THREE.Vector3(x, floorY + 1.65, z);
    ray.set(eye, new THREE.Vector3(at[0] - x, at[1] - eye.y, at[2] - z).normalize());
    let best: { key: string; kind: string; t: number; d: number } | null = null;
    let npc: { key: string; kind: string; t: number; d: number } | null = null;
    for (const c of cs) {
      const h = ray.intersectBox(c.box, hit);
      if (!h) continue;
      const d = h.distanceTo(eye);
      const e = { key: c.key, kind: c.kind, t: d + c.bias, d };
      if (c.kind === 'npc' && (!npc || d < npc.d)) npc = e;
      if (!best || e.t < best.t) best = e;
    }
    if (npc && best && best.kind === 'inspect' && npc.d - best.d < 1.2) best = npc;
    if (!best) return null;
    for (const o of R.built.occluders) {
      const oh = ray.intersectBox(o, new THREE.Vector3());
      if (oh && oh.distanceTo(eye) < best.d - 0.05) return null;
    }
    return best.key;
  };
  const h = box.max[1] - box.min[1];
  const aims: V3[] = [aim, [aim[0], box.min[1] + h * 0.78, aim[2]], [aim[0], box.min[1] + h * 0.3, aim[2]]];
  const cands: { x: number; z: number; r: number; center: number; score: number; aim: V3 }[] = [];
  let spots = 0;
  let wins = 0;
  for (let a = 0; a < 36; a++) {
    const ang = (a / 36) * Math.PI * 2;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    for (let st = 0.4; st < 6; st += 0.1) {
      const x = cx + dx * st;
      const z = cz + dz * st;
      const r = rectDist(x, z);
      if (r < rMin) continue;
      if (r > rMax) break;
      if (!nav.isFreeAt(x, z)) {
        no('not walkable');
        continue;
      }
      if (solidAt(x, z, 0.32)) {
        no('furniture');
        continue;
      }
      if (people.some((p) => Math.hypot(p.x - x, p.z - z) < 0.75)) {
        no('someone there');
        continue;
      }
      const look = aims.find((at) => seen(x, z, at));
      if (!look) {
        no('no view of it');
        continue;
      }
      spots++;
      const winAt = aims.find((at) => {
        const k = simPick(x, z, at);
        if (k && !same(k)) shadow[k] = (shadow[k] ?? 0) + 1;
        return !!k && same(k);
      });
      if (winAt) wins++;
      // a person stands in the open, near enough that it answers (the world focuses within 2.6 m of the center)
      let clear = 1;
      for (const b of R.built.colliders) {
        if (b.max.y <= y0 || b.min.y >= y0 + 1.8 || b.isEmpty()) continue;
        const d = Math.hypot(Math.max(b.min.x - x, 0, x - b.max.x), Math.max(b.min.z - z, 0, z - b.max.z));
        if (d < clear) clear = d;
      }
      const center = Math.hypot(cx - x, cz - z);
      cands.push({ x, z, r, center, aim: winAt ?? look, score: (winAt ? 0 : 4) + Math.abs(r - rMid) + (center > 2.45 ? 1 + center - 2.45 : 0) + (clear < 0.6 ? (0.6 - clear) * 2 : 0) });
    }
  }
  cands.sort((p, q) => p.score - q.score);
  // the same room: the walk there is barely longer than the straight line (a preference: cramped
  // corners, a bay full of equipment, may have no such spot; then the view check alone has to do)
  const out: { x: number; z: number; r: number; center: number; aim: V3; why: string }[] = [];
  const unwalked: typeof out = [];
  for (const c of cands) {
    if (out.length >= 4) break;
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 0.8)) continue;
    // walk to just in front of it on this side (its nearest side, 0.45 m out): wall-mounted things have the
    // other side of their wall nearer to their center
    const nx = Math.max(box.min[0], Math.min(c.x, box.max[0]));
    const nz = Math.max(box.min[2], Math.min(c.z, box.max[2]));
    const dd = Math.hypot(c.x - nx, c.z - nz) || 1;
    const gx = nx + ((c.x - nx) / dd) * 0.45;
    const gz = nz + ((c.z - nz) / dd) * 0.45;
    const path = nav.findPath(c.x, c.z, gx, gz);
    if (!path) {
      no('no walk to it');
      if (unwalked.length < 2) unwalked.push({ x: +c.x.toFixed(3), z: +c.z.toFixed(3), r: +c.r.toFixed(2), center: +c.center.toFixed(2), aim: c.aim, why: `free floor ${c.r.toFixed(2)} m from it, in view (no walk to its front from there)` });
      continue;
    }
    let len = 0;
    let px = c.x;
    let pz = c.z;
    for (const p of path) {
      len += Math.hypot(p.x - px, p.y - pz);
      px = p.x;
      pz = p.y;
    }
    if (len > Math.hypot(gx - c.x, gz - c.z) + 1.5) {
      no('round a wall');
      continue;
    }
    out.push({ x: +c.x.toFixed(3), z: +c.z.toFixed(3), r: +c.r.toFixed(2), center: +c.center.toFixed(2), aim: c.aim, why: `free floor ${c.r.toFixed(2)} m from it, in view${c.score < 4 ? '' : ' (nothing in front of it from any spot)'}` });
  }
  return { starts: out.length ? out : unwalked, rejected, spots, wins, shadow };
}

// ───────────────────────────── on screen ─────────────────────────────

/** what is open on screen (a person sees it) */
async function screen(page: Page) {
  return page.evaluate(() => {
    const q = (s: string) => document.querySelector(s) as HTMLElement | null;
    const tablet = q('.tablet:not(.min)');
    const inspect = q('.inspect-card');
    return {
      tablet: tablet?.getAttribute('aria-label') ?? null,
      ehr: !!q('.ehr-root'),
      phone: !!q('.side-panel.phone'),
      monitor: q('.monitor-panel')?.textContent?.slice(0, 80) ?? null,
      board: !!q('.tb-screen'),
      inspect: inspect ? (inspect.querySelector('.inspect-title')?.textContent ?? '') : null,
      closeUp: !!q('.inspect-card.close-up'),
      help: !!q('.help-panel'),
      paused: !!q('.paused-banner'),
      debrief: !!q('.debrief'),
    };
  });
}

type W = {
  amenities(): { seated: string | null; action: string | null; held: { id: string; label: string; slot: string }[]; machines: { id: string; state: string }[] };
  hygiene(): { action: string | null; masked: boolean; gloves?: { on: boolean; bundle: boolean } };
  floors(): { level: number; room: string; fireDoor: number | null; elevator: { cars: { id: string; y: number; level: number; door: number; phase: string; moving: boolean }[]; hall: Record<string, string[]> } };
  workstation(): { phase: string; notice: string | null; seated: boolean; id: string | null };
  curtains(): { id: string; state: string; override: string | null }[];
  care(): { phase: string; visit: string | null; patient?: string };
  listItems(): { id: string; kind: string; label: string; x: number; z: number }[];
};
const world = <K extends keyof W>(page: Page, k: K) => page.evaluate((name) => (window as unknown as { __acWorld: Record<string, () => unknown> }).__acWorld[name](), k as string) as Promise<ReturnType<W[K]>>;
const wheelchairState = (page: Page) => page.evaluate(() => (window as unknown as { __acRead: { wheelchair: { state: string } } }).__acRead.wheelchair.state);

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms: number, every = 100): Promise<T> {
  const t0 = Date.now();
  let v = await fn();
  while (!ok(v) && Date.now() - t0 < ms) {
    await sleep(every);
    v = await fn();
  }
  return v;
}

// ───────────────────────────── the audit ─────────────────────────────

interface Row {
  n: number;
  segment: string;
  key: string;
  name: string;
  cat: Cat;
  level: number;
  /** a start 1.5–2.5 m away with a view of it, and the player got the crosshair on it within reach */
  reachable: boolean | null;
  promptOk: boolean | null;
  /** the HUD prompt when it named it (or the last one seen) */
  prompt: string | null;
  /** what the prompt named instead (first try), or 'nothing' */
  won: string | null;
  tries: string[];
  effectOk: boolean | null;
  effect: string;
  undoOk: boolean | null;
  notes: string[];
  shot?: string;
  start?: { x: number; z: number; r: number };
  /** the simulated pick over every free spot 1.5–2.5 m away: how many, how many it would win from, what wins elsewhere */
  spots?: { spots: number; wins: number; shadow: string };
  ms: number;
}

const isFail = (r: Row) => r.reachable === false || r.promptOk === false || r.effectOk === false || r.undoOk === false;

/** the winner's key out of "… {key}" */
const wonKey = (r: Row) => /\{([^}]+)\}$/.exec(r.won ?? '')?.[1] ?? null;
const boxVol = (b: Box) => Math.max(0, b.max[0] - b.min[0]) * Math.max(0, b.max[1] - b.min[1]) * Math.max(0, b.max[2] - b.min[2]);
const boxAnd = (a: Box, b: Box): Box => ({ min: [0, 1, 2].map((i) => Math.max(a.min[i], b.min[i])) as V3, max: [0, 1, 2].map((i) => Math.min(a.max[i], b.max[i])) as V3 });

/**
 * What kind of failure (for triage): an inspect card shadowed by the same object's own action
 * (design), shadowed by something else from every spot (simulated), only from the angles tried,
 * no place to stand, or an effect that didn't happen / couldn't be undone.
 */
function classify(r: Row, boxes: Map<string, Box>): string {
  if (!isFail(r)) return r.promptOk === null ? 'skip' : 'pass';
  if (r.reachable === false) return 'no spot to stand';
  if (r.promptOk === false) {
    const k = wonKey(r);
    const a = boxes.get(r.key);
    const b = k ? boxes.get(k) : undefined;
    if (r.cat === 'fixture' && k && /^use:/.test(k) && a && b) {
      const v = boxVol(boxAnd(a, b));
      if (v > 0.3 * Math.min(boxVol(a), boxVol(b)) || v > 0.5 * boxVol(b)) return 'inspect shadowed by its own action';
    }
    if (r.spots && r.spots.spots && !r.spots.wins) return 'shadowed from every spot';
    if (!k) return 'no prompt from the angles tried';
    return 'shadowed from the angles tried';
  }
  if (r.effectOk === false) return 'effect missing';
  return 'undo failed';
}

class Audit {
  rows: Row[] = [];
  /** rows where the prompt didn't come back after closing what E opened (still aimed at it) */
  stale = 0;
  /** every target's box (the classification compares boxes) */
  boxes = new Map<string, Box>();
  me: Human;
  reloads = 0;
  errors: string[] = [];
  constructor(
    public page: Page,
    public log: StepLog,
  ) {
    this.me = new Human(page, log, VIEW);
  }

  floorY(level: number) {
    return level === 0 ? 0 : 3;
  }

  /** a person standing on the right storey (teleport between storeys is setup, allowed after the first real trip) */
  async toLevel(level: number) {
    const s = await this.me.st();
    if (s.level === level) return;
    await this.me.teleport(53.5, level ? 4.0 : 3.0, this.floorY(level), 180, -5, `onto ${level ? 'Floor 2' : 'the ground floor'} (between targets)`);
    await sleep(500);
  }

  /** back to plain walking: nothing open, nothing in hand, standing, no mask (keep: what to leave as it is) */
  async tidy(notes: string[] = [], keep?: 'held' | 'mask') {
    const me = this.me;
    await me.releaseAll();
    for (let i = 0; i < 3; i++) {
      const sc = await screen(this.page);
      if (!(sc.tablet || sc.ehr || sc.phone || sc.monitor || sc.board || sc.inspect || sc.help)) break;
      await me.press('Escape', 'close what is open');
      await sleep(350);
    }
    const ws = await world(this.page, 'workstation');
    if (ws.phase !== 'idle') await until(() => world(this.page, 'workstation'), (w) => w.phase === 'idle', 6000);
    const am = await world(this.page, 'amenities');
    if (am.seated) {
      notes.push('still seated: S to stand');
      await me.hold('KeyS', 200, 'stand up');
      await sleep(900);
    }
    if ((await wheelchairState(this.page)) === 'riding') {
      await me.face((await me.st()).yaw, -1.2);
      await sleep(150);
      // (no on-screen prompt for the wheelchair's exit any more: E is still the key)
      await me.press('KeyE', 'get out of the wheelchair');
    }
    if ((await wheelchairState(this.page)) !== 'parked') await until(() => wheelchairState(this.page), (s) => s === 'parked', 6000);
    const am2 = await world(this.page, 'amenities');
    if (keep !== 'held')
      for (let i = 0; i < am2.held.length; i++) {
        await me.press('KeyG', 'put down what is in hand');
        await sleep(400);
      }
    const hy = await world(this.page, 'hygiene');
    if (hy.action) await until(() => world(this.page, 'hygiene'), (x) => !x.action, 12000);
    if (keep !== 'mask' && (await world(this.page, 'hygiene')).masked) {
      await me.press('KeyM', 'mask off');
      await until(() => world(this.page, 'hygiene'), (x) => !x.masked && !x.action, 6000);
    }
    // gloves still on: G (hands are empty by now); a used pair still in hand (no bin in reach): binned by a debug op (cleanup)
    if ((await world(this.page, 'hygiene')).gloves?.on) {
      await me.press('KeyG', 'gloves off');
      await until(() => world(this.page, 'hygiene'), (x) => !x.gloves?.on && !x.action, 6000);
    }
    if ((await world(this.page, 'hygiene')).gloves?.bundle) {
      notes.push('the used gloves binned by a debug op (cleanup)');
      await this.page.evaluate(() => (window as unknown as { __acWorld: { hygieneOp(op: string): unknown } }).__acWorld.hygieneOp('binGloves'));
    }
  }

  /** read what the crosshair is on, as the HUD shows it */
  async read(): Promise<{ prompt: string | null; key: string | null; label: string | null }> {
    await sleep(110);
    const [prompt, f] = await Promise.all([this.me.prompt(), this.me.focus()]);
    return { prompt, key: f?.key ?? null, label: f?.label ?? null };
  }

  /** is the focus on this target (a sink's basin and its soap dispenser are one target) */
  named(t: Target, key: string | null) {
    if (!key) return false;
    if (key === t.key) return true;
    if (t.cat === 'wash') return key.replace(/:sink$/, '') === t.key.replace(/:sink$/, '');
    return false;
  }

  /**
   * Turn to it and aim; natural second tries when something else wins. Returns the reading that
   * named it, or null (row filled in either way).
   */
  async aimAndRead(t: Target, row: Row): Promise<{ prompt: string | null; key: string | null; label: string | null } | null> {
    const me = this.me;
    const live = await this.page.evaluate(pageLive, t.key);
    const box = live?.box ?? t.box;
    const h = box.max[1] - box.min[1];
    const pt = (fy: number): V3 => [t.aim[0], box.min[1] + h * fy, t.aim[2]];
    const isNpc = t.cat === 'npc';
    const tries: { name: string; move?: () => Promise<void>; aim: V3 }[] = [
      { name: 'aim at it', aim: t.aim },
      { name: 'a little higher', aim: isNpc ? [t.aim[0], t.aim[1] + 0.25, t.aim[2]] : pt(0.78) },
      { name: 'a little lower', aim: isNpc ? [t.aim[0], t.aim[1] - 0.3, t.aim[2]] : pt(0.25) },
      { name: 'step left', move: () => me.hold('KeyA', 280, 'side step left'), aim: t.aim },
      { name: 'step right', move: () => me.hold('KeyD', 560, 'side step right'), aim: t.aim },
      { name: 'step closer', move: () => this.stepCloser(t, 1.3), aim: t.aim },
      { name: 'closer, higher', aim: isNpc ? [t.aim[0], t.aim[1] + 0.25, t.aim[2]] : pt(0.78) },
      { name: 'closer, lower', aim: isNpc ? [t.aim[0], t.aim[1] - 0.3, t.aim[2]] : pt(0.25) },
    ];
    for (let k = 0; k < tries.length; k++) {
      const tr = tries[k];
      if (tr.move) await tr.move();
      const ok = await me.aimAt(tr.aim);
      const r = await this.read();
      const said = r.prompt ?? 'nothing';
      row.tries.push(`${tr.name}: ${this.named(t, r.key) ? 'named it' : said}`);
      if (!ok) row.notes.push(`could not aim (${tr.name})`);
      if (this.named(t, r.key)) return r;
      if (row.won === null) row.won = r.key ? `${r.prompt ?? '(no HUD prompt)'} {${r.key}}` : 'nothing';
      row.prompt = r.prompt;
      // no prompt at all from here: a person walks up closer before trying other angles
      if (k === 0 && !r.key) {
        const s = await me.st();
        if (Math.hypot(t.center[0] - s.x, t.center[2] - s.z) > 2.3) {
          const i = tries.findIndex((x) => x.name === 'step closer');
          tries.splice(1, 0, ...tries.splice(i, 3));
        }
      }
    }
    return null;
  }

  /** walk toward it (W, steering with the mouse) until the box's center is within d m */
  async stepCloser(t: Target, d: number) {
    const me = this.me;
    const s = await me.st();
    const dist = Math.hypot(t.center[0] - s.x, t.center[2] - s.z);
    if (dist <= d || dist > 4.5) return;
    const k = (dist - d) / dist;
    const gx = s.x + (t.center[0] - s.x) * k;
    const gz = s.z + (t.center[2] - s.z) * k;
    await me.walkTo(gx, gz, { arrive: 0.25, timeout: 6000, name: 'a step closer' });
  }

  /** one target: start pose, turn and aim, read, E, effect, undo (keep: leave the thing in hand / the mask on for the next step) */
  async one(t: Target, segment: string, extra?: { press?: string; effect?: (row: Row) => Promise<void>; keep?: 'held' | 'mask' }) {
    const me = this.me;
    const t0 = Date.now();
    const row: Row = { n: this.rows.length + 1, segment, key: t.key, name: t.name, cat: t.cat, level: t.level, reachable: null, promptOk: null, prompt: null, won: null, tries: [], effectOk: null, effect: '', undoOk: null, notes: [], ms: 0 };
    this.rows.push(row);
    try {
      await this.toLevel(t.level);
      // where it is now (people walk off between the listing and their turn)
      if (t.cat === 'npc') {
        const now = (await this.page.evaluate(pageTargets)).find((x) => x.key === t.key);
        if (!now) {
          row.notes.push('gone (walked off or no longer talkable)');
          row.effect = 'not tried';
          return row;
        }
        t = { ...t, box: now.box, center: now.center, aim: now.aim };
      }
      let { starts, rejected, spots, wins, shadow } = await this.page.evaluate(pageStarts, { key: t.key, box: t.box, aim: t.aim, level: t.level, floorY: this.floorY(t.level) });
      if (!starts.length) {
        // nowhere 1.5–2.5 m away: a person would go nearer (0.8–1.5 m), noted
        const near = await this.page.evaluate(pageStarts, { key: t.key, box: t.box, aim: t.aim, level: t.level, floorY: this.floorY(t.level), rMin: 0.8, rMax: 1.5 });
        row.notes.push(`no free floor 1.5–2.5 m from it with a view of it (spots ruled out: ${Object.entries(rejected).map(([k, v]) => `${k} ${v}`).join(', ') || 'none in range'})${near.starts.length ? `; started nearer, ${near.starts[0].r} m away` : ''}`);
        ({ starts, rejected, spots, wins, shadow } = near);
      }
      row.spots = { spots, wins, shadow: Object.entries(shadow).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, v]) => `${k} ×${v}`).join(', ') };
      if (spots && !wins) row.notes.push(`from none of ${spots} free spots would the aim ray pick it (simulated pick: ${row.spots.shadow || 'nothing'} in front)`);
      if (!starts.length) {
        row.reachable = false;
        row.notes.push(`nor 0.8–1.5 m away (spots ruled out: ${Object.entries(rejected).map(([k, v]) => `${k} ${v}`).join(', ') || 'none in range'})`);
        row.effect = 'not tried';
        await this.fail(row, t);
        return row;
      }
      const st = starts[0];
      row.start = { x: st.x, z: st.z, r: st.r };
      t = { ...t, aim: st.aim };
      // facing a natural way in: toward it, 25–45° off to one side, eyes level
      const toward = yawTo(t.center[0] - st.x, t.center[2] - st.z);
      const off = ((row.n % 2 ? 1 : -1) * (25 + (row.n % 3) * 10) * Math.PI) / 180;
      await me.teleport(st.x, st.z, this.floorY(t.level), teleportYawDeg(toward + off), -4, `start for ${t.name}: ${st.why}`);
      await sleep(260);
      const at = await me.st();
      if (Math.hypot(at.x - st.x, at.z - st.z) > 0.3) {
        row.notes.push(`the start teleport did not hold (at ${at.x.toFixed(2)}, ${at.z.toFixed(2)}): again`);
        await this.tidy(row.notes);
        await me.teleport(st.x, st.z, this.floorY(t.level), teleportYawDeg(toward + off), -4, `start for ${t.name} (again)`);
        await sleep(300);
      }
      // a chair or sofa someone sits on (or is on the way to) is not offered: that's right, a skip
      if ((t.cat === 'chair' || t.cat === 'sofa') && !(await this.page.evaluate(pageLive, t.key))) {
        await me.aimAt(t.aim);
        const r = await this.read();
        row.effect = 'n/a: not offered, someone sits there';
        row.prompt = r.prompt;
        row.notes.push(`aimed at it: ${r.prompt ?? 'nothing'}`);
        return row;
      }
      const got = await this.aimAndRead(t, row);
      const s = await me.st();
      const centerDist = Math.hypot(t.center[0] - s.x, t.center[2] - s.z);
      if (!got) {
        row.promptOk = false;
        row.reachable = centerDist <= 2.6 ? true : false;
        if (centerDist > 2.6) row.notes.push(`its center stays ${centerDist.toFixed(2)} m away (the world focuses within 2.6 m of the center)`);
        row.effect = 'not tried (prompt never named it)';
        await this.fail(row, t);
        return row;
      }
      row.reachable = true;
      row.prompt = got.prompt;
      const live = await this.page.evaluate(pageLive, t.key);
      const expect = `[E] ${got.label}`;
      row.promptOk = got.prompt === expect;
      if (!row.promptOk) row.notes.push(`HUD showed ${JSON.stringify(got.prompt)}, focus label ${JSON.stringify(got.label)}`);
      if (live && got.label !== live.label) row.notes.push(`label changed: ${live.label}`);
      if (row.tries.length > 1) row.notes.push(`named it on try ${row.tries.length}`);
      // the action (a workstation's refusal notice from the last one must be gone, or it reads as this one's)
      if (t.cat === 'computer') await until(() => world(this.page, 'workstation'), (w) => !w.notice, 6000);
      const hintsFrom = await this.page.evaluate(() => performance.now());
      await me.press(extra?.press ?? 'KeyE', `on "${got.prompt}"`);
      if (extra?.effect) await extra.effect(row);
      else await this.effect(t, row);
      if (row.effectOk === false) {
        // what the game said meanwhile (the hint line at the bottom), as a person would have read it
        const said = await this.page.evaluate((from) => [...new Set(((window as unknown as { __hints?: { t: number; text: string }[] }).__hints ?? []).filter((x) => x.t >= from && x.text).map((x) => x.text))], hintsFrom);
        if (said.length) row.notes.push(`on screen: ${said.map((x) => `"${x}"`).join(', ')}`);
      }
      // after it's closed again, still looking at it: is the prompt back? (a person would expect it to be)
      if (row.effectOk && row.undoOk) {
        const sc = await screen(this.page);
        const after = await this.read();
        if (!(sc.tablet || sc.ehr || sc.phone || sc.monitor || sc.board || sc.inspect !== null) && after.key === t.key && !after.prompt) {
          row.notes.push('[stale prompt] closed again and still aimed at it: the crosshair is lit but the HUD prompt stays empty until the aim moves to something else');
          this.stale++;
        }
      }
      if (row.effectOk === false || row.undoOk === false) await this.fail(row, t);
      // "[F] Inspect" in the prompt: F should show what it is
      else if (/\[F\] Inspect/.test(got.prompt ?? '')) await this.inspectWithF(t, row);
    } catch (e) {
      row.notes.push(`error: ${(e as Error).message.split('\n')[0]}`);
      row.effectOk = row.effectOk ?? false;
      this.log.add('error', `${t.key}: ${(e as Error).message.split('\n')[0]}`);
      await this.fail(row, t).catch(() => undefined);
    } finally {
      await this.tidy(row.notes, extra?.keep).catch((e) => row.notes.push(`tidy: ${(e as Error).message.split('\n')[0]}`));
      row.ms = Date.now() - t0;
      const flag = isFail(row) ? 'FAIL' : row.promptOk === null ? 'skip' : 'ok';
      this.log.add('check', `${flag} #${row.n} ${t.key} · prompt ${row.prompt ?? '-'} · effect ${row.effect}${row.won && !row.promptOk ? ` · won: ${row.won}` : ''}`);
    }
    return row;
  }

  /** the prompt offers [F] Inspect: aim again, F, the card, Esc */
  async inspectWithF(t: Target, row: Row) {
    const me = this.me;
    await this.tidy(row.notes);
    await me.aimAt(t.aim);
    const r = await this.read();
    if (!this.named(t, r.key)) {
      row.notes.push(`F: back on it the prompt showed ${r.prompt ?? 'nothing'}`);
      return;
    }
    await me.press('KeyF', `on "${r.prompt}"`);
    const sc = await until(() => screen(this.page), (x) => x.inspect !== null, 2500);
    if (sc.inspect === null) {
      row.effectOk = false;
      row.notes.push('F did not open the inspect card');
      await this.fail(row, t);
      return;
    }
    row.notes.push(`F: card "${sc.inspect}"`);
    await me.press('Escape', 'close the card');
    await until(() => screen(this.page), (x) => x.inspect === null, 2000);
  }

  async fail(row: Row, t: Target) {
    const file = `${OUT}/fail-${String(row.n).padStart(3, '0')}-${t.key.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60)}.png`;
    await this.page.screenshot({ path: file });
    row.shot = file;
  }

  /** what pressing E should have done, and putting it back */
  async effect(t: Target, row: Row) {
    const page = this.page;
    const me = this.me;
    const ok = (good: boolean, what: string) => {
      row.effectOk = good;
      row.effect = what;
    };
    const undone = (good: boolean, what?: string) => {
      row.undoOk = good;
      if (what) row.notes.push(what);
    };
    const open = (x: Awaited<ReturnType<typeof screen>>) => !!(x.tablet || x.ehr || x.phone || x.monitor || x.board || x.inspect !== null);
    const closes = async (what: string) => {
      await me.press('Escape', `close ${what}`);
      let sc = await until(() => screen(page), (x) => !open(x), 900);
      if (open(sc)) {
        const focus = await page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? '');
        row.notes.push(`one Esc did not close ${what}${sc.tablet ? ' (it left the chat box, which E had focused)' : ''}; a second Esc`);
        await me.press('Escape', `close ${what} (again${focus ? `; focus was on ${focus}` : ''})`);
        sc = await until(() => screen(page), (x) => !open(x), 2000);
      }
      undone(!open(sc), open(sc) ? 'Esc did not close it' : undefined);
    };
    switch (t.cat) {
      case 'npc': {
        const sc = await until(() => screen(page), (x) => !!x.tablet, 2500);
        const name = t.name.split(' (')[0];
        ok(!!sc.tablet && sc.tablet.startsWith(name), sc.tablet ? `tablet: ${sc.tablet}` : 'no tablet opened');
        if (sc.tablet) await closes('the tablet');
        return;
      }
      case 'computer': {
        const live = (await page.evaluate(pageLive, t.key))?.label ?? t.label;
        const sc = await until(
          async () => ({ s: await screen(page), w: await world(page, 'workstation') }),
          (x) => x.s.ehr || !!x.w.notice,
          12000,
          150,
        );
        if (sc.s.ehr) {
          // the zoom out of the monitor: a person waits till AgentChart is up (an Esc during it only skips the zoom)
          await until(() => world(page, 'workstation'), (w) => w.phase === 'open', 4000);
          await until(() => page.evaluate(() => { const r = document.querySelector('.ehr-root') as HTMLElement | null; return !!r && !r.style.transform; }), (x) => x, 3000);
          await sleep(250);
          ok(true, `AgentChart opened (logged in at ${sc.w.id ?? '?'})`);
          await me.press('Escape', 'log off');
          const w = await until(() => world(page, 'workstation'), (x) => x.phase === 'idle', 8000);
          undone(w.phase === 'idle' && !(await screen(page)).ehr, w.phase !== 'idle' ? `still ${w.phase} after Esc` : undefined);
        } else if (sc.w.notice) {
          const refused = /staff only|in use/.test(live);
          ok(refused, `refused: ${sc.w.notice}`);
          if (!refused) row.notes.push('a free workstation refused the login');
          undone(true);
        } else ok(false, 'nothing opened (no AgentChart, no notice)');
        return;
      }
      case 'phone': {
        const sc = await until(() => screen(page), (x) => x.phone, 2500);
        ok(sc.phone, sc.phone ? 'phone opened' : 'no phone panel');
        if (sc.phone) await closes('the phone');
        return;
      }
      case 'board': {
        const sc = await until(() => screen(page), (x) => x.board, 2500);
        ok(sc.board, sc.board ? 'tracking board opened' : 'no board');
        if (sc.board) await closes('the board');
        return;
      }
      case 'monitor': {
        const sc = await until(() => screen(page), (x) => !!x.monitor, 2500);
        ok(!!sc.monitor, sc.monitor ? `monitor panel: ${sc.monitor.slice(0, 50)}` : 'no monitor panel');
        if (sc.monitor) await closes('the monitor');
        return;
      }
      case 'fixture':
      case 'item-inspect': {
        const sc = await until(() => screen(page), (x) => x.inspect !== null, 2500);
        const title = t.label.replace(/^Inspect /, '').toLowerCase();
        ok(sc.inspect !== null && sc.inspect.toLowerCase().includes(title.slice(0, 12)), sc.inspect !== null ? `card: ${sc.inspect}` : 'no inspect card');
        if (sc.inspect !== null) await closes('the card');
        return;
      }
      case 'belonging': {
        const sc = await until(() => screen(page), (x) => x.inspect !== null, 2500);
        ok(sc.inspect !== null && sc.closeUp, sc.inspect !== null ? `close-up: ${sc.inspect}` : 'no close-up');
        if (sc.inspect !== null) await closes('the close-up');
        return;
      }
      case 'item': {
        const before = (await world(page, 'listItems')).find((i) => `item:${i.id}` === t.key);
        const s0 = await me.st();
        const am = await until(() => world(page, 'amenities'), (a) => a.held.some((x) => `item:${x.id}` === t.key), 6000);
        const inHand = am.held.find((x) => `item:${x.id}` === t.key);
        const s1 = await me.st();
        const walked = Math.hypot(s1.x - s0.x, s1.z - s0.z);
        const far = before ? Math.hypot(before.x - s0.x, before.z - s0.z) : NaN;
        ok(!!inHand, inHand ? `in the ${inHand.slot === 'L' ? 'left' : 'right'} hand${walked > 0.3 ? ` (E walked you ${walked.toFixed(1)} m to it first)` : ''}` : `not picked up (holding ${am.held.map((x) => x.label).join(', ') || 'nothing'}; it was ${far.toFixed(2)} m away, E moved you ${walked.toFixed(2)} m)`);
        if (inHand) {
          // G puts it down where the crosshair is: on the spot where it lay
          const live = t.box;
          await me.aimAt([(live.min[0] + live.max[0]) / 2, live.min[1] + 0.004, (live.min[2] + live.max[2]) / 2]);
          await me.press('KeyG', 'put it back down where it lay');
          const am2 = await until(() => world(page, 'amenities'), (a) => !a.held.some((x) => `item:${x.id}` === t.key), 2000);
          const after = (await world(page, 'listItems')).find((i) => `item:${i.id}` === t.key);
          const moved = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : NaN;
          undone(!am2.held.some((x) => `item:${x.id}` === t.key), Number.isFinite(moved) && moved > 0.35 ? `put down ${moved.toFixed(2)} m from where it was` : undefined);
        }
        return;
      }
      case 'curtain': {
        const id = t.id;
        const c0 = (await world(page, 'curtains')).find((c) => c.id === id);
        const c1 = await until(() => world(page, 'curtains'), (cs) => (cs.find((c) => c.id === id)?.state ?? '') !== c0?.state, 2500);
        const st1 = c1.find((c) => c.id === id)?.state;
        ok(st1 !== c0?.state, `${c0?.state} → ${st1}`);
        if (st1 !== c0?.state) {
          await sleep(1500);
          // look at it again where it is now (reaching for it can turn you; its handle has moved along the rail)
          const lv = await page.evaluate(pageLive, t.key);
          const mid: V3 | null = lv ? [(lv.box.min[0] + lv.box.max[0]) / 2, (lv.box.min[1] + lv.box.max[1]) / 2, (lv.box.min[2] + lv.box.max[2]) / 2] : null;
          if (mid) await me.aimAt(mid);
          let r = await this.read();
          if (r.key !== t.key && mid) {
            const s0 = await me.st();
            row.notes.push(`after it moved, its handle is ${Math.hypot(mid[0] - s0.x, mid[2] - s0.z).toFixed(2)} m away and the prompt showed ${r.prompt ?? 'nothing'}: a step closer`);
            await this.stepCloser({ ...t, center: mid }, 1.3);
            await me.aimAt(mid);
            r = await this.read();
          }
          if (r.key === t.key) {
            await me.press('KeyE', `on "${r.prompt}" (put it back)`);
            const c2 = await until(() => world(page, 'curtains'), (cs) => /open|opening/.test(cs.find((c) => c.id === id)?.state ?? '') === /open|opening/.test(c0?.state ?? ''), 3000);
            const st2 = c2.find((c) => c.id === id)?.state;
            undone(/open/.test(st2 ?? '') === /open/.test(c0?.state ?? ''), `back: ${st2}`);
          } else undone(false, `to put it back the prompt showed ${r.prompt ?? 'nothing'}`);
        }
        return;
      }
      case 'elevator-call': {
        const lvl = t.level;
        const f = await until(() => world(page, 'floors'), (x) => (x.elevator.hall[String(lvl)]?.length ?? 0) > 0 || x.elevator.cars.some((c) => c.level === lvl && /open/.test(c.phase)), 4000);
        const car = f.elevator.cars.find((c) => c.level === lvl && /open/.test(c.phase));
        ok(!!car || (f.elevator.hall[String(lvl)]?.length ?? 0) > 0, car ? `car ${car.id} ${car.phase} here` : `hall call ${JSON.stringify(f.elevator.hall)}`);
        undone(true);
        return;
      }
      case 'ward': {
        const c = await until(() => world(page, 'care'), (x) => x.phase !== 'off', 4000);
        ok(c.phase !== 'off' && (c.visit === t.id || c.patient === t.id), `bedside: ${c.phase}${c.visit ? ` (${c.visit})` : ''}`);
        await sleep(1500);
        await me.hold('KeyS', 450, 'step back from the bed');
        const c2 = await until(() => world(page, 'care'), (x) => x.phase === 'off', 3000);
        undone(c2.phase === 'off', c2.phase !== 'off' ? `bedside still ${c2.phase}` : undefined);
        return;
      }
      case 'chair':
      case 'sofa': {
        const a = await until(() => world(page, 'amenities'), (x) => x.seated === t.id, 6000);
        ok(a.seated === t.id, a.seated ? `seated (${a.seated})` : 'not seated');
        if (a.seated) {
          await sleep(1300);
          // E with nothing in sight stands you up: look ahead, else down at your lap
          const seen: string[] = [];
          let stood = false;
          for (const [pitch, where] of [[0, 'ahead'], [-1.25, 'down']] as [number, string][]) {
            await me.face((await me.st()).yaw, pitch);
            const r = await this.read();
            seen.push(`${where}: ${r.prompt ?? 'nothing'}`);
            if (/Stand up/.test(r.prompt ?? '')) {
              await me.press('KeyE', `on "${r.prompt}"`);
              stood = true;
              break;
            }
          }
          if (!stood) {
            row.notes.push(`seated, no "Stand up" prompt (looking ${seen.join('; ')}): stood up with S`);
            await me.hold('KeyS', 200, 'stand up');
          } else if (seen.length > 1) row.notes.push(`seated: "Stand up" only after looking ${seen[seen.length - 1].split(':')[0]} (${seen[0]})`);
          const a2 = await until(() => world(page, 'amenities'), (x) => !x.seated, 3000);
          undone(!a2.seated);
        }
        return;
      }
      case 'wheelchair': {
        const s = await until(() => wheelchairState(page), (x) => x === 'riding', 5000);
        ok(s === 'riding', `wheelchair: ${s}`);
        if (s === 'riding') {
          await sleep(800);
          await me.face((await me.st()).yaw, -1.2);
          const r = await this.read();
          if (/Get out/.test(r.prompt ?? '')) await me.press('KeyE', `on "${r.prompt}"`);
          else row.notes.push(`riding, looking down the prompt was ${r.prompt ?? 'nothing'}`);
          const s2 = await until(() => wheelchairState(page), (x) => x === 'parked', 6000);
          undone(s2 === 'parked', s2 !== 'parked' ? `could not get out (${s2})` : undefined);
        }
        return;
      }
      case 'rub':
      case 'wash': {
        const kind = t.cat;
        const hy = await until(() => world(page, 'hygiene'), (x) => x.action === kind, 2500);
        ok(hy.action === kind, hy.action ? `${hy.action} started` : `nothing started (hint: ${(await me.hint()) ?? '-'})`);
        if (hy.action === kind) {
          if (this.fullHygiene.has(`${kind}:${t.level}`)) {
            // walking off cancels it (nothing recorded)
            await sleep(700);
            await me.hold('KeyS', 250, 'walk off (cancels it)');
            const h2 = await until(() => world(page, 'hygiene'), (x) => !x.action, 2500);
            undone(!h2.action, h2.action ? 'walking off did not cancel it' : undefined);
          } else {
            this.fullHygiene.add(`${kind}:${t.level}`);
            const h2 = await until(() => world(page, 'hygiene'), (x) => !x.action, 16000, 200);
            undone(!h2.action, h2.action ? `still ${h2.action} after 16 s` : 'let this one run to the end');
          }
        }
        return;
      }
      case 'mask': {
        const hy = await until(() => world(page, 'hygiene'), (x) => x.masked && !x.action, 8000);
        ok(hy.masked, hy.masked ? 'mask on' : 'no mask');
        if (hy.masked) {
          await me.press('KeyM', 'mask off');
          const h2 = await until(() => world(page, 'hygiene'), (x) => !x.masked && !x.action, 6000);
          undone(!h2.masked);
        }
        return;
      }
      case 'gloves': {
        // E: a pair from the box onto both hands (about 3 s); G with nothing in hand takes them off, into a bin in reach (else into the hand)
        const hy = await until(() => world(page, 'hygiene'), (x) => !!x.gloves?.on && !x.action, 6000);
        ok(!!hy.gloves?.on, hy.gloves?.on ? 'gloves on' : `no gloves (hint: ${(await me.hint()) ?? '-'})`);
        if (hy.gloves?.on) {
          await me.press('KeyG', 'gloves off');
          const h2 = await until(() => world(page, 'hygiene'), (x) => !x.gloves?.on && !x.action, 6000);
          undone(!h2.gloves?.on, h2.gloves?.on ? 'G did not take them off' : h2.gloves?.bundle ? 'off; no bin within 2.2 m, so the used pair stays in hand' : undefined);
        }
        return;
      }
      default:
        ok(false, `no check for ${t.cat}`);
    }
  }
  fullHygiene = new Set<string>();

  table(): string {
    const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const yn = (v: boolean | null) => (v === null ? '–' : v ? 'yes' : '**no**');
    const fails = this.rows.filter(isFail);
    const by = new Map<string, { n: number; ok: number }>();
    for (const r of this.rows) {
      const e = by.get(r.cat) ?? { n: 0, ok: 0 };
      e.n++;
      if (!isFail(r)) e.ok++;
      by.set(r.cat, e);
    }
    const cls = new Map<string, number>();
    for (const r of this.rows) cls.set(classify(r, this.boxes), (cls.get(classify(r, this.boxes)) ?? 0) + 1);
    const lines = [
      `# Interaction audit — ${MAP}, played with real input`,
      '',
      `${new Date().toISOString()} · ${this.rows.length} targets · ${this.rows.length - fails.length} pass · ${fails.length} fail · page reloads: ${this.reloads}`,
      '',
      [...cls.entries()].map(([k, v]) => `${k}: ${v}`).join(' · '),
      '',
      `[stale prompt] (closed what E opened, still aimed at it, no prompt until the aim moves): ${this.stale} rows`,
      '',
      '| category | targets | pass |',
      '|---|---:|---:|',
      ...[...by.entries()].map(([c, e]) => `| ${c} | ${e.n} | ${e.ok} |`),
      '',
      '## Failing rows',
      '',
      'spots: free spots 1.5–2.5 m away with a view of it, and from how many the simulated World.pick() would pick it (wins/spots).',
      '',
      '| # | triage | target | key | L | reachable? | prompt correct? | what won instead | effect OK? | undo | spots | notes | shot |',
      '|---:|---|---|---|---:|---|---|---|---|---|---|---|---|',
      ...[...fails].sort((p, q) => classify(p, this.boxes).localeCompare(classify(q, this.boxes)) || p.n - q.n).map((r) => `| ${r.n} | ${classify(r, this.boxes)} | ${esc(r.name)} | \`${r.key}\` | ${r.level} | ${yn(r.reachable)} | ${yn(r.promptOk)} | ${esc(r.won ?? '')} | ${yn(r.effectOk)} ${esc(r.effect)} | ${yn(r.undoOk)} | ${r.spots ? `${r.spots.wins}/${r.spots.spots}` : ''} | ${esc([...r.notes, r.tries.length > 1 ? `tries: ${r.tries.join('; ')}` : ''].filter(Boolean).join(' · '))} | ${r.shot ? `[png](${r.shot.split('/').pop()})` : ''} |`),
      '',
      '## All rows',
      '',
      '| # | segment | target | key | L | reachable? | prompt correct? | what won instead | effect OK? | spots | notes |',
      '|---:|---|---|---|---:|---|---|---|---|---|---|',
      ...this.rows.map((r) => `| ${r.n} | ${r.segment} | ${esc(r.name)} | \`${r.key}\` | ${r.level} | ${yn(r.reachable)} | ${yn(r.promptOk)}${r.prompt ? ` ${esc(r.prompt)}` : ''} | ${esc(r.won && !r.promptOk ? r.won : r.won && r.tries.length > 1 ? `(first: ${r.won})` : '')} | ${yn(r.effectOk)} ${esc(r.effect)}${r.undoOk === false ? ' · undo **no**' : ''} | ${r.spots ? `${r.spots.wins}/${r.spots.spots}` : ''} | ${esc(r.notes.join(' · '))} |`),
    ];
    return lines.join('\n') + '\n';
  }

  save() {
    writeFileSync(`${OUT}/audit.json`, JSON.stringify({ map: MAP, at: new Date().toISOString(), reloads: this.reloads, errors: this.errors, rows: this.rows.map((r) => ({ ...r, triage: classify(r, this.boxes) })) }, null, 1));
    writeFileSync(`${OUT}/audit.md`, this.table());
  }
}

// ───────────────────────────── run ─────────────────────────────

/** every hint line the game shows (the text at the bottom of the 3D view), timestamped, to quote on a failure */
async function watchHints(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('.wl-hint');
    const w = window as unknown as { __hints?: { t: number; text: string }[] };
    if (!el || w.__hints) return;
    w.__hints = [];
    new MutationObserver(() => w.__hints!.push({ t: performance.now(), text: el.textContent ?? '' })).observe(el, { childList: true, characterData: true, subtree: true });
  });
}

async function startShift(h: Harness, log: StepLog): Promise<{ page: Page; errors: string[] }> {
  const page = await h.browser.newPage({ viewport: VIEW });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  // (tsx keeps function names with a helper the page doesn't have)
  await page.addInitScript('window.__name = (f) => f;');
  // no hot reload: other edits to the tree mid-run would rebuild the world under the audit
  await page.routeWebSocket((url) => !url.pathname.endsWith('/ws'), () => undefined);
  log.add('setup', `open ${h.url}/?debug=1 (${VIEW.width}×${VIEW.height})`);
  await page.goto(`${h.url}/?debug=1`);
  await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
  log.add('input', `click "${MAP}"`);
  await page.click(`.map-card:has-text("${MAP}")`);
  log.add('input', 'click "Start shift →"');
  await page.click('button.start');
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  await page.waitForSelector('.loading-screen.done', { timeout: 120000 }).catch(() => log.add('note', 'loading screen never finished'));
  await sleep(1500);
  await installReader(page);
  await watchHints(page);
  return { page, errors };
}

const h = await startHarness({ portBase: PORT_BASE, dev: true });
const log = new StepLog(`${OUT}/steps.log`, true);
let audit: Audit | null = null;
try {
  const { page, errors } = await startShift(h, log);
  audit = new Audit(page, log);
  const A = audit;
  const me = A.me;
  page.on('load', () => {
    A.reloads++;
    log.add('error', 'the page reloaded (a file changed?): the rows after this may need a re-run');
  });
  // the shift clock stops (a player's key): the audit takes longer than a shift
  await me.press('KeyP', 'pause the shift clock');
  await sleep(500);
  log.add('see', `paused banner: ${(await screen(page)).paused}`);

  const all = await page.evaluate(pageTargets);
  for (const t of all) A.boxes.set(t.key, t.box);
  log.add('note', `${all.length} interactables: ${[...new Set(all.map((t) => t.cat))].map((c) => `${c} ${all.filter((t) => t.cat === c).length}`).join(', ')}`);
  writeFileSync(`${OUT}/targets.json`, JSON.stringify(all, null, 1));
  const pick = (cats: Cat[], level: number) => {
    const xs = all.filter((t) => cats.includes(t.cat) && t.level === level && (!MATCH || MATCH.test(t.key)));
    return LIMIT ? xs.slice(0, LIMIT) : xs;
  };
  const run = async (seg: string, ts: Target[]) => {
    log.add('note', `── segment ${seg}: ${ts.length} targets`);
    for (const t of ts) await A.one(t, seg);
    A.save();
  };

  // ── ground floor ──
  if (want('npc')) await run('npc', pick(['npc'], 0));
  if (want('computer')) await run('computer', pick(['computer', 'phone', 'board', 'monitor'], 0));
  if (want('curtain')) await run('curtain', pick(['curtain'], 0));
  if (want('seat')) await run('seat', pick(['chair', 'sofa'], 0));
  if (want('wheelchair')) await run('wheelchair', pick(['wheelchair'], 0));
  if (want('hygiene')) await run('hygiene', pick(['rub', 'wash', 'mask', 'gloves'], 0));
  if (want('item')) await run('item', pick(['item', 'item-inspect', 'belonging'], 0));
  if (want('fixture')) await run('fixture', pick(['fixture'], 0));
  const matches = (k: string) => !MATCH || MATCH.test(k);
  if (want('drinks')) await drinks(A, all.filter((t) => ['coffee', 'vending', 'bin'].includes(t.cat) && matches(t.key)));
  if (want('maskbin')) await maskBins(A, all, 0);

  // ── up to Floor 2 by the elevator (real input), Stair 1 down and up through the fire door ──
  if (want('elevator') && matches('elev:east:call:0')) await elevatorTrip(A, all, 0);
  if (want('stairs')) await stairs(A);
  if (want('floor2')) {
    await run('floor2', pick(['ward', 'sofa', 'rub', 'wash', 'mask', 'gloves', 'fixture'], 1));
    await maskBins(A, all, 1);
    if (matches('elev:east:call:1')) await elevatorTrip(A, all, 1);
  }
  A.errors.push(...errors);
  A.save();
  const fails = A.rows.filter(isFail);
  console.log(`\n${A.rows.length} targets audited · ${fails.length} failing rows · ${errors.length} page errors · ${A.reloads} reloads`);
  console.log(`table: ${OUT}/audit.md · json: ${OUT}/audit.json · steps: ${OUT}/steps.log`);
} catch (e) {
  log.add('error', `audit stopped: ${(e as Error).stack ?? e}`);
  audit?.save();
  process.exitCode = 1;
} finally {
  await h.close();
}

// ───────────────────────────── special segments ─────────────────────────────

/**
 * Coffee (brew, take the cup), the vending machine (a can), and every bin, each with something to
 * throw away in hand: the coffees and the can from here, then paper and water cups lying around,
 * picked up for real on the way.
 */
async function drinks(A: Audit, ts: Target[]) {
  const page = A.page;
  const me = A.me;
  log.add('note', '── segment drinks: coffee machines, vending, bins');
  const bins = ts.filter((x) => x.cat === 'bin');
  const queue = LIMIT ? bins.slice(0, LIMIT) : [...bins];
  const throwAway = async (b: Target) => {
    const held0 = (await world(page, 'amenities')).held.length;
    await A.one({ ...b, label: 'Throw away' }, 'drinks', {
      effect: async (row) => {
        const a = await until(() => world(page, 'amenities'), (x) => x.held.length < held0, 3000);
        row.effectOk = a.held.length < held0;
        row.effect = row.effectOk ? 'thrown away' : `still holding ${a.held.map((x) => x.label).join(', ')}`;
        row.undoOk = true;
      },
    });
  };
  for (const t of ts.filter((x) => x.cat === 'coffee')) {
    await A.one(t, 'drinks', {
      keep: 'held',
      effect: async (row) => {
        const m = await until(() => world(page, 'amenities'), (a) => a.machines.find((x) => `use:${x.id}` === t.key)?.state === 'brewing', 3000);
        const st = m.machines.find((x) => `use:${x.id}` === t.key)?.state;
        row.effectOk = st === 'brewing';
        row.effect = `machine ${st}`;
        if (st !== 'brewing') return;
        const m2 = await until(() => world(page, 'amenities'), (a) => a.machines.find((x) => `use:${x.id}` === t.key)?.state === 'ready', 25000, 250);
        await me.aimAt(t.aim);
        const r = await A.read();
        row.notes.push(`after brewing: ${m2.machines.find((x) => `use:${x.id}` === t.key)?.state}, prompt ${r.prompt}`);
        if (A.named(t, r.key) && /Take your/.test(r.prompt ?? '')) {
          await me.press('KeyE', `on "${r.prompt}"`);
          const a = await until(() => world(page, 'amenities'), (x) => x.held.length > 0, 2500);
          row.undoOk = a.held.length > 0;
          row.effect += a.held.length ? ` → took the ${a.held.map((x) => x.label).join(', ')}` : ' → the cup did not come to hand';
        } else row.undoOk = false;
      },
    });
    if ((await world(page, 'amenities')).held.length && queue.length) await throwAway(queue.shift()!);
  }
  const vend = ts.find((x) => x.cat === 'vending');
  if (vend) {
    await A.one(vend, 'drinks', {
      keep: 'held',
      effect: async (row) => {
        const a = await until(() => world(page, 'amenities'), (x) => x.held.some((i) => /can of/.test(i.label)), 10000);
        const can = a.held.find((i) => /can of/.test(i.label));
        row.effectOk = !!can;
        row.effect = can ? `bought a ${can.label}` : 'no can';
        row.undoOk = true;
      },
    });
    if ((await world(page, 'amenities')).held.length && queue.length) await throwAway(queue.shift()!);
  }
  // the rest: a cup lying around first, picked up with real input
  for (const b of queue) {
    if (!(await getTrash(A, b))) {
      A.rows.push({ n: A.rows.length + 1, segment: 'drinks', key: b.key, name: b.name, cat: 'bin', level: 0, reachable: null, promptOk: null, prompt: null, won: null, tries: [], effectOk: null, effect: 'not tried: nothing disposable left to throw away', undoOk: null, notes: [], ms: 0 });
      continue;
    }
    await throwAway(b);
  }
  await A.tidy();
  A.save();
}

/** something to throw away in hand: a paper or water cup lying around, picked up for real (aim, E) */
async function getTrash(A: Audit, near: Target): Promise<boolean> {
  const page = A.page;
  if ((await world(page, 'amenities')).held.length) return true;
  const items = await world(page, 'listItems');
  const disposable = items.filter((i) => ['paperCup', 'waterCup', 'coffeeCup', 'sodaCan'].includes(i.kind)).sort((p, q) => Math.hypot(p.x - near.center[0], p.z - near.center[2]) - Math.hypot(q.x - near.center[0], q.z - near.center[2]));
  for (const it of disposable.slice(0, 3)) {
    const t = (await page.evaluate(pageTargets)).find((x) => x.key === `item:${it.id}`);
    if (!t) continue;
    await A.one(t, 'drinks (trash)', {
      keep: 'held',
      effect: async (r) => {
        const a = await until(() => world(page, 'amenities'), (x) => x.held.some((i) => i.id === it.id), 2000);
        r.effectOk = a.held.some((i) => i.id === it.id);
        r.effect = r.effectOk ? 'in hand (to throw away)' : 'not picked up';
        r.undoOk = true;
      },
    });
    if ((await world(page, 'amenities')).held.length) return true;
  }
  return false;
}

/** each bin takes a mask off: a mask on at the nearest box (real input; downstairs if none up here), then E on the bin */
async function maskBins(A: Audit, all: Target[], level: number) {
  const page = A.page;
  const bins = all.filter((t) => t.cat === 'maskbin' && t.level === level && (!MATCH || MATCH.test(t.key)));
  const boxes = all.filter((t) => t.cat === 'mask');
  log.add('note', `── segment maskbin (Floor ${level + 1}): ${bins.length} bins, ${boxes.filter((b) => b.level === level).length} mask boxes on this floor`);
  for (const b of LIMIT ? bins.slice(0, LIMIT) : bins) {
    if (!(await world(page, 'hygiene')).masked) {
      const box = [...boxes].sort((p, q) => (p.level !== q.level ? (p.level === level ? -1 : 1) : Math.hypot(p.center[0] - b.center[0], p.center[2] - b.center[2]) - Math.hypot(q.center[0] - b.center[0], q.center[2] - b.center[2])))[0];
      if (!box) continue;
      await A.one(box, 'maskbin (mask on)', {
        keep: 'mask',
        effect: async (row) => {
          const hy = await until(() => world(page, 'hygiene'), (x) => x.masked && !x.action, 8000);
          row.effectOk = hy.masked;
          row.effect = hy.masked ? 'mask on (to take off at a bin)' : 'no mask';
          row.undoOk = true;
        },
      });
      if (!(await world(page, 'hygiene')).masked) continue;
    }
    await A.one({ ...b, label: 'Take off your mask into the bin' }, 'maskbin', {
      effect: async (row) => {
        const hy = await until(() => world(page, 'hygiene'), (x) => !x.masked && !x.action, 6000);
        row.effectOk = !hy.masked;
        row.effect = hy.masked ? 'mask still on' : 'mask off into the bin';
        row.undoOk = true;
      },
    });
  }
  A.save();
}

/** call the elevator, walk into the car, press the panel, ride, walk out: all real input */
async function elevatorTrip(A: Audit, all: Target[], from: 0 | 1) {
  const page = A.page;
  const me = A.me;
  const to = 1 - from;
  log.add('note', `── segment elevator: Floor ${from + 1} → Floor ${to + 1}, real input`);
  const call = all.find((t) => t.cat === 'elevator-call' && t.level === from);
  if (!call) return;
  await A.toLevel(from);
  await A.one(call, 'elevator');
  const f = await until(() => world(page, 'floors'), (x) => x.elevator.cars.some((c) => c.level === from && c.phase === 'open' && !c.moving), 20000, 200);
  const car = f.elevator.cars.find((c) => c.level === from && c.phase === 'open' && !c.moving);
  if (!car) {
    log.add('finding', `elevator: no car opened on Floor ${from + 1} after the call`);
    return;
  }
  const CAR_X: Record<string, number> = { A: 52.35, B: 54.65 };
  const cx = CAR_X[car.id] ?? 53.5;
  log.add('see', `car ${car.id} open on Floor ${from + 1}`);
  // all the way in: the doors' light curtain covers z −0.48…0.36 (elevator.ts), standing there holds them open
  const inCar = await me.walkTo(cx, -1.3, { via: [{ x: cx, z: 1.3 }], arrive: 0.25, timeout: 12000, name: `into car ${car.id}` });
  const panel = all.find((t) => t.cat === 'elevator-car' && t.key.endsWith(`:car:${car.id}`));
  const st = await me.st();
  log.add('see', `in the car: ${inCar} (${st.x.toFixed(2)}, ${st.z.toFixed(2)}) · prompt ${await me.prompt()}`);
  const t0 = Date.now();
  const row: Row = { n: A.rows.length + 1, segment: 'elevator', key: panel?.key ?? `elev:east:car:${car.id}`, name: `car ${car.id} panel (ride to Floor ${to + 1})`, cat: 'elevator-car', level: from, reachable: inCar, promptOk: null, prompt: null, won: null, tries: [], effectOk: null, effect: '', undoOk: null, notes: [], ms: 0 };
  A.rows.push(row);
  // turn to the panel (its box moves with the car: aim at the live one)
  const live = await page.evaluate(pageLive, row.key);
  if (live) {
    const c: V3 = [(live.box.min[0] + live.box.max[0]) / 2, (live.box.min[1] + live.box.max[1]) / 2, (live.box.min[2] + live.box.max[2]) / 2];
    await me.aimAt(c);
  }
  const r = await A.read();
  row.prompt = r.prompt;
  row.promptOk = !!r.key && r.key.includes(':car:') && new RegExp(`Floor ${to + 1}`).test(r.prompt ?? '');
  if (!row.promptOk) row.won = r.prompt ?? 'nothing';
  if (r.key && r.key.includes(':car:')) {
    await me.press('KeyE', `on "${r.prompt}"`);
    const moving = await until(() => world(page, 'floors'), (x) => x.elevator.cars.find((c) => c.id === car.id)?.moving === true, 8000);
    const arrived = await until(() => world(page, 'floors'), (x) => x.elevator.cars.find((c) => c.id === car.id)?.level === to && x.elevator.cars.find((c) => c.id === car.id)?.phase === 'open', 25000, 200);
    const s2 = await me.st();
    row.effectOk = !!moving.elevator.cars.find((c) => c.id === car.id)?.moving && Math.abs(s2.y - A.floorY(to)) < 0.2;
    row.effect = `car moving ${!!moving.elevator.cars.find((c) => c.id === car.id)?.moving}, arrived open ${arrived.elevator.cars.find((c) => c.id === car.id)?.phase}, feet at y ${s2.y.toFixed(2)}`;
    const out = await me.walkTo(cx, 2.2, { via: [{ x: cx, z: 0.6 }], arrive: 0.35, timeout: 12000, name: 'out of the car' });
    const fl = await world(page, 'floors');
    row.undoOk = out && fl.level === to;
    row.notes.push(`walked out: ${fl.room} (level ${fl.level})`);
  } else row.effect = 'not pressed';
  row.ms = Date.now() - t0;
  if (!row.promptOk || !row.effectOk) await A.fail(row, panel ?? call);
  log.add('check', `${row.promptOk && row.effectOk ? 'ok' : 'FAIL'} #${row.n} ${row.key} · ${row.effect}`);
  A.save();
}

/** Floor 2 lobby → the fire door → Stair 1 down to the ground floor → and back up: all walked */
async function stairs(A: Audit) {
  const page = A.page;
  const me = A.me;
  log.add('note', '── segment stairs: the fire door and Stair 1, walked down and up');
  const s = await me.st();
  if (s.level !== 1) await me.teleport(53.0, 4.57, 3, teleportYawDeg(yawTo(-1, 0)), -4, 'Floor 2 lobby (the elevator segment was skipped)');
  await sleep(400);
  const t0 = Date.now();
  const row: Row = { n: A.rows.length + 1, segment: 'stairs', key: 'fireDoor:stair1-L2', name: 'Stair 1 fire door (Floor 2), down the stairs and back up', cat: 'fixture', level: 1, reachable: null, promptOk: true, prompt: '(no prompt: it opens as you walk at it)', won: null, tries: [], effectOk: null, effect: '', undoOk: null, notes: [], ms: 0 };
  A.rows.push(row);
  // walk at the door: it should swing open in front of you
  let swung = 0;
  const watch = setInterval(() => {
    void world(page, 'floors')
      .then((f) => (swung = Math.max(swung, f.fireDoor ?? 0)))
      .catch(() => undefined);
  }, 120);
  const down = await me.walkTo(48.76, 9.6, {
    via: [
      { x: 52.3, z: 4.57 },
      { x: 50.24, z: 4.57 },
      { x: 50.24, z: 1.0 },
      { x: 48.76, z: 0.8 },
      { x: 48.76, z: 4.4 },
      { x: 48.76, z: 8.3 },
    ],
    arrive: 0.4,
    timeout: 40000,
    name: 'through the fire door and down Stair 1',
  });
  const f1 = await world(page, 'floors');
  const s1 = await me.st();
  row.reachable = down;
  row.effectOk = swung > 0.5 && f1.level === 0;
  row.effect = `fire door swung ${swung.toFixed(2)} rad · down: level ${f1.level}, ${f1.room}, feet y ${s1.y.toFixed(2)}`;
  const up = await me.walkTo(53.2, 4.57, {
    via: [
      { x: 48.76, z: 8.3 },
      { x: 48.76, z: 4.4 },
      { x: 48.76, z: 0.8 },
      { x: 50.24, z: 1.0 },
      { x: 50.24, z: 4.57 },
      { x: 52.3, z: 4.57 },
    ],
    arrive: 0.4,
    timeout: 40000,
    name: 'back up Stair 1 and out through the fire door',
  });
  clearInterval(watch);
  const f2 = await world(page, 'floors');
  row.undoOk = up && f2.level === 1;
  row.notes.push(`back up: level ${f2.level}, ${f2.room}`);
  const shut = await until(() => world(page, 'floors'), (x) => (x.fireDoor ?? 1) < 0.05, 6000);
  row.notes.push(`door closed behind: ${(shut.fireDoor ?? 1) < 0.05}`);
  row.ms = Date.now() - t0;
  if (!row.effectOk || !row.undoOk) await me.shot(`${OUT}/fail-stairs.png`);
  log.add('check', `${row.effectOk && row.undoOk ? 'ok' : 'FAIL'} #${row.n} stairs · ${row.effect} · ${row.notes.join(' · ')}`);
  A.save();
}

