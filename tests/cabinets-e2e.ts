/**
 * Cupboards, drawers and carts that open, on the real GPU (client/src/world/cabinets.ts, models in
 * cabinetModels.ts). First and third person:
 *
 *   supply   Resus 3's supply cabinet: the prompt ("[E] Open … · [F] Inspect"), F's card, E: the hand
 *            to the handle (within 3 cm of it while it holds it), the door's swing (angle), what's on
 *            the shelves (an item to take), E again closes it
 *   drawers  the hub's supply cart and Resus 1's airway trolley: drawer travel, the hand on the pull
 *   cd       the medication room's controlled-drug cupboard: locked (E rattles it, the hint names the
 *            key's keeper), stays shut until Rosa has walked over and turned her key, opens, and
 *            locks again once you have left the room
 *   seal     Resus 1's crash cart: its numbered seal breaks as drawer A opens (the hint about pharmacy)
 *   clear    every door in the building opened wide: none through a wall or a neighbour; standing
 *            in a door's swing you step out of its way first and it never passes through you
 *   f2       Ward 2 East: the linen cupboard, a patient's wardrobe, the staff lockers, and the ward's
 *            controlled-drug cupboard with its nurse in charge (Ana)
 *
 *   npx tsx tests/cabinets-e2e.ts [outDir] [--only=supply,drawers,cd,seal,clear,f2] [--port-base=8600]
 *
 * Boots a private server (tests/harness.ts; never the player's 5317) and stops it at the end.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { startHarness } from './harness';

const args = process.argv.slice(2);
const out = path.resolve(args[0] && !args[0].startsWith('--') ? args[0] : 'shots/cabinets');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (k: string) => !only || only.includes(k);
const portBase = Number(args.find((a) => a.startsWith('--port-base='))?.slice(12) ?? 8600);
mkdirSync(out, { recursive: true });

interface PartDbg {
  key: string;
  kind: 'door' | 'drawer' | 'shutter';
  name: string;
  hinge: 'L' | 'R' | null;
  goal: number;
  open: number;
  max: number;
  angleDeg: number | null;
  travel: number | null;
  label: string;
  handle: [number, number, number];
  stowed: string[];
  out: string[];
}
interface UnitDbg {
  id: string;
  role: string;
  level: number;
  room: string;
  center: [number, number, number];
  front: [number, number, number];
  lock: { state: string; angle: number } | null;
  seal: { intact: boolean; no: string } | null;
  parts: PartDbg[];
}
interface CabDbg {
  units: UnitDbg[];
  errand: { who: string; phase: string; t: number; spot: { x: number; z: number; rot: number }; arm: string } | null;
  pending: boolean;
  grab: { part: string; handle: number[]; fp: number | null; tp: number | null; frames: number } | null;
  log: string[];
  you: { x: number; z: number };
}
interface Audit {
  key: string;
  angleDeg: number;
  walls: number;
  neighbours: number;
  player: number;
  minClear: number;
}

const h = await startHarness({ portBase, dev: true });
try {
  const page: Page = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  // other edits in the tree mid-run must not hot-reload the world under the test
  await page.routeWebSocket((url) => !url.pathname.endsWith('/ws'), () => undefined);
  await page.goto(`${h.url}/?debug=1&quality=high`);
  await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
  await page.click('text=Night Shift');
  await page.click('button.start');
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  await page.waitForSelector('.loading-screen.done', { timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const ev = <T = unknown>(s: string) => page.evaluate(s) as Promise<T>;
  // the shift stands still (no server moves); everything client-side keeps running
  await ev(`__ac.client.settings({ paused: true })`);
  await page.addStyleTag({ content: '.toasts, .paused-banner { visibility: hidden !important; }' });
  /** HUD off for clean frames (the prompt and the hint stay unless `all`) */
  const hud = (hidden: boolean, all = false) => ev(`document.querySelectorAll('.hud > *:not(.hud-prompt), .wl-crosshair, .wl-layer${all ? ', .hud-prompt, .wl-hint' : ''}').forEach((e) => (e.style.visibility = '${hidden ? 'hidden' : ''}'))`);
  const shot = async (name: string) => {
    await page.waitForTimeout(80);
    const f = `${out}/${name}.png`;
    await page.screenshot({ path: f });
    console.log(`📸 ${f}`);
  };
  const cam = (m: 'first' | 'third' | 'top') => ev(`__ac.store.set({ camera: '${m}' })`);
  const fixedCam = (pos: [number, number, number] | null, at?: [number, number, number]) => ev(`__acWorld.cam(${JSON.stringify(pos)}, ${JSON.stringify(at ?? null)})`);
  const cab = () => ev<CabDbg>('__acWorld.cabinets()');
  const unit = async (id: string) => (await cab()).units.find((u) => u.id === id)!;
  const part = async (key: string) => (await cab()).units.flatMap((u) => u.parts).find((p) => p.key === key)!;
  const prompt = () => ev<string | null>('__ac.store.get().prompt');
  const hintText = () => ev<string>(`document.querySelector('.wl-hint')?.textContent ?? ''`);
  const press = (key: string) => page.keyboard.press(key);
  const until = async (fn: () => Promise<boolean>, ms: number, step = 100) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await fn()) return true;
      await page.waitForTimeout(step);
    }
    return false;
  };
  /** stand at (x, z) facing yawDeg (0 = +z), looking pitchDeg; on a storey: y */
  const stand = async (x: number, z: number, yaw: number, pitch: number, y = 0) => {
    await ev(y ? `__acWorld.teleportY(${x}, ${z}, ${y}, ${yaw}, ${pitch})` : `__acWorld.teleport(${x}, ${z}, ${yaw}, ${pitch})`);
    await page.waitForTimeout(700);
  };
  /** the hand on the handle (pressed, fully out): for the screenshot of the grab */
  const handOn = () => until(async () => {
    const g = await ev<{ active: boolean; pressed?: boolean; weight?: number }>('__acWorld.gesture()');
    return !!g.active && !!g.pressed && (g.weight ?? 0) >= 0.97;
  }, 3000, 15);
  /** E on what you aim at, then the grab's record once the hand has held the handle */
  const grabOf = async () => {
    await until(async () => ((await cab()).grab?.frames ?? 0) >= 3, 3000);
    return (await cab()).grab;
  };
  const closeAll = async () => {
    for (const u of (await cab()).units) for (const p of u.parts) if (p.goal) await ev(`__acWorld.cabinetOp('snap', ${JSON.stringify({ key: p.key, open: 0 })})`);
    await page.waitForTimeout(200);
  };

  const st0 = await cab();
  h.check('every cupboard, wardrobe, cart and fridge is found (both floors)', st0.units.length >= 30 && st0.units.some((u) => u.level === 1), `${st0.units.length} units, roles ${[...new Set(st0.units.map((u) => u.role))].join(' ')}`);
  h.check('the medication dispenser is not one of them (it stays a workstation)', !st0.units.some((u) => /disp/.test(u.id)));
  h.check('a controlled-drug cupboard in both medication rooms, locked', ['med_cd', 'f2_med_cd'].every((id) => st0.units.find((u) => u.id === id)?.lock?.state === 'locked'));
  h.check('crash carts are sealed (props and Resus 1/2)', ['resus_crash', 'resus_1_crash', 'resus_2_crash', 'f2_crash'].every((id) => st0.units.find((u) => u.id === id)?.seal?.intact === true));

  // ── a supply cabinet: Resus 3's (front to the west), its middle door ──
  if (want('supply')) {
    const KEY = 'cab:resus_cab:1';
    for (const mode of ['first', 'third'] as const) {
      await cam(mode);
      await closeAll();
      await ev(`__acWorld.cabinetOp('grab')`);
      // (third person: the camera behind you over your right shoulder, looking where you face: you stand
      // half a metre to the left of what the crosshair is on)
      await stand(30.35, mode === 'first' ? 4.8 : 4.32, 90, mode === 'first' ? -8 : -4);
      if (mode === 'third') await ev(`__acWorld.look(-90, -10, 2.2)`);
      await page.waitForTimeout(300);
      const pr = await prompt();
      if (mode === 'first') {
        h.check('supply cabinet: the prompt opens it, F inspects', /^\[E\] Open the cabinet.*· \[F\] Inspect$/.test(pr ?? ''), String(pr));
        // F: its card
        await press('KeyF');
        await page.waitForTimeout(300);
        const card = await ev<{ title: string; desc: string } | null>('__ac.store.get().inspect');
        h.check('supply cabinet: F shows its card', card?.title === 'Supply cabinet' && /expiry/.test(card.desc), card?.title ?? 'none');
        // F again puts it away
        await press('KeyF');
        await page.waitForTimeout(200);
        h.check('supply cabinet: F again closes the card', (await ev('__ac.store.get().inspect')) === null);
      }
      await hud(true);
      await shot(`supply-${mode}-1-closed`);
      await press('KeyE');
      // the hand on the handle (as it takes hold; third person from the side)
      await handOn();
      if (mode === 'third') await fixedCam([30.15, 1.6, 6.3], [31.0, 1.05, 4.6]);
      await shot(`supply-${mode}-2-hand-on-handle`);
      if (mode === 'third') await fixedCam(null);
      const g = await grabOf();
      const dist = mode === 'first' ? g?.fp : g?.tp;
      h.check(`supply cabinet (${mode} person): the hand is on the handle as it takes hold (≤ 3 cm)`, dist !== null && dist !== undefined && dist <= 0.03, `${dist === null || dist === undefined ? 'no measurement' : `${(dist * 100).toFixed(1)} cm`} over ${g?.frames ?? 0} frames, handle ${g?.handle?.join(', ')}`);
      await until(async () => (await part(KEY)).open > 0.999, 3000);
      const p = await part(KEY);
      h.check(`supply cabinet (${mode} person): the door swings fully open`, (p.angleDeg ?? 0) >= 95 && p.goal === 1, `${p.angleDeg}° of ${Math.round((p.max * 180) / Math.PI)}°`);
      await page.waitForTimeout(250);
      await shot(`supply-${mode}-3-open`);
      if (mode === 'first') {
        h.check('supply cabinet: what you can take is out on the shelf (items)', p.out.length >= 2, `${p.out.length} items`);
        // a close look at the shelves (from in front of the opening, clear of the open door)
        await stand(30.62, 4.62, 82, -22);
        await shot('supply-first-4-contents');
        await stand(30.62, 4.62, 82, 12);
        await shot('supply-first-4b-contents-top');
        await stand(30.35, 4.8, 90, -8);
      } else {
        await fixedCam([29.7, 1.7, 5.9], [31.3, 1.1, 4.8]);
        await shot('supply-third-4-open-side');
        await fixedCam(null);
      }
      // E again: closes it
      await press('KeyE');
      await until(async () => (await part(KEY)).open < 0.001, 3000);
      const c = await part(KEY);
      h.check(`supply cabinet (${mode} person): E again closes it`, c.open < 0.001 && c.goal === 0, `open ${c.open}`);
      await shot(`supply-${mode}-5-closed-again`);
      await hud(false);
    }
    await cam('first');
  }

  // ── drawers: the hub's supply cart (front to the east), Resus 1's airway trolley ──
  if (want('drawers')) {
    for (const mode of ['first', 'third'] as const) {
      await cam(mode);
      await closeAll();
      await ev(`__acWorld.cabinetOp('grab')`);
      // aim at the second drawer from the top
      await stand(34.5, mode === 'first' ? 7.6 : 8.1, -90, mode === 'first' ? -50 : -10);
      if (mode === 'third') await ev(`__acWorld.look(90, -34, 1.8)`);
      await page.waitForTimeout(300);
      const f = await ev<{ key: string; label: string } | null>('__acWorld.focus()');
      // (third person the camera looks over the cart's top from behind you: E goes to the drawer directly)
      if (mode === 'first') h.check(`supply cart (${mode} person): a drawer is the target`, /^cab:hub_cart:\d$/.test(f?.key ?? ''), `${f?.key} "${f?.label}"`);
      const key = /^cab:hub_cart:\d$/.test(f?.key ?? '') ? f!.key : 'cab:hub_cart:2';
      if (key !== f?.key) await ev(`__acWorld.useCabinet('${key}')`);
      await hud(true);
      if (key === f?.key) await press('KeyE');
      await handOn();
      if (mode === 'third') await fixedCam([34.35, 1.3, 9.2], [33.7, 0.6, 7.75]);
      await shot(`drawer-${mode}-1-hand-on-pull`);
      if (mode === 'third') await fixedCam(null);
      const g = await grabOf();
      const dist = mode === 'first' ? g?.fp : g?.tp;
      h.check(`supply cart (${mode} person): the hand is on the pull (≤ 3 cm)`, dist !== null && dist !== undefined && dist <= 0.03, `${dist === null || dist === undefined ? 'no measurement' : `${(dist * 100).toFixed(1)} cm`}`);
      await until(async () => (await part(key)).open > 0.999, 3000);
      const p = await part(key);
      h.check(`supply cart (${mode} person): the drawer slides out its full travel`, Math.abs((p.travel ?? 0) - p.max) < 0.005 && p.max >= 0.28, `${p.travel} m of ${p.max} m`);
      await page.waitForTimeout(200);
      await shot(`drawer-${mode}-2-open`);
      if (mode === 'first') {
        await stand(34.32, 7.6, -90, -66);
        await shot('drawer-first-3-contents');
        await stand(34.5, 7.6, -90, -50);
      }
      const f2 = await ev<{ key: string; label: string } | null>('__acWorld.focus()');
      if (mode === 'first') {
        h.check('supply cart: aimed at the open drawer, E closes it', f2?.key === key && /^Close the .* drawer/.test(f2.label), `${f2?.key} "${f2?.label}"`);
        await press('KeyE');
      } else await ev(`__acWorld.useCabinet('${key}')`);
      await until(async () => (await part(key)).open < 0.001, 3000);
      h.check(`supply cart (${mode} person): E again slides it shut`, (await part(key)).open < 0.001);
      await hud(false);
    }
    await cam('first');
    // Resus 1's airway trolley (front to the north): drawer A, plan A
    await closeAll();
    await stand(35.54, 19.6, 0, -56);
    const f = await ev<{ key: string; label: string } | null>('__acWorld.focus()');
    h.check('airway trolley: a drawer is the target, named for its plan', /^cab:resus_1_airway:\d$/.test(f?.key ?? '') && /drawer [A-DP]: /.test(f?.label ?? ''), `${f?.key} "${f?.label}"`);
    await hud(true);
    await press('KeyE');
    await until(async () => (await part(f?.key ?? '')).open > 0.999, 4000);
    await stand(35.54, 19.55, 0, -62);
    await shot('drawer-airway-open');
    await hud(false);
    await closeAll();
  }

  // ── the controlled-drug cupboard: locked, Rosa brings the key, it locks again behind you ──
  if (want('cd')) {
    await cam('first');
    await closeAll();
    const KEY = 'cab:med_cd:0';
    await stand(33.95, 17.4, 90, 6);
    const pr = await prompt();
    h.check('controlled drugs: the prompt (with F) on the cupboard', /Open the controlled-drug cupboard · \[F\] Inspect/.test(pr ?? ''), String(pr));
    await hud(true);
    await shot('cd-1-locked');
    await press('KeyE');
    await until(async () => (await unit('med_cd')).lock?.state === 'tried', 3000, 50);
    await page.waitForTimeout(250);
    const hint1 = await hintText();
    h.check('controlled drugs: E tries it, it is locked, and the key is with the charge nurse (Rosa)', /Locked: controlled drugs\. The key is with the charge nurse \(Rosa\)/.test(hint1), hint1);
    h.check('controlled drugs: it stayed shut', (await part(KEY)).open === 0);
    await page.waitForTimeout(400);
    const pr2 = await prompt();
    h.check('controlled drugs: the prompt now asks Rosa', /\[E\] Ask Rosa for the key/.test(pr2 ?? ''), String(pr2));
    await shot('cd-2-ask-rosa');
    const rosa0 = await ev<{ x: number; z: number; posture: string } | null>(`__acWorld.npc('rn_rosa')`);
    await press('KeyE');
    await page.waitForTimeout(300);
    const e0 = (await cab()).errand;
    h.check('controlled drugs: Rosa is sent for', e0?.who === 'rn_rosa' && (e0.phase === 'walk' || e0.phase === 'wait'), `${JSON.stringify(e0)} hint "${await hintText()}"; she was at ${rosa0?.x.toFixed(1)},${rosa0?.z.toFixed(1)} (${rosa0?.posture})`);
    // until she has unlocked it: the door never moves; screenshots of her coming in and turning the key
    let maxOpen = 0;
    let arriving = false;
    let turning = false;
    let tpTurning = false;
    const ok = await until(async () => {
      const u = await unit('med_cd');
      maxOpen = Math.max(maxOpen, u.parts[0].open);
      const e = (await cab()).errand;
      const r = await ev<{ x: number; z: number } | null>(`__acWorld.npc('rn_rosa')`);
      if (!arriving && r && Math.hypot(r.x - 34.0, r.z - 17.4) < 3.2) {
        arriving = true;
        await cam('third');
        await fixedCam([32.2, 1.75, 20.2], [34.3, 1.2, 17.2]);
        await shot('cd-3-rosa-arriving-third');
        await fixedCam(null);
        await cam('first');
      }
      if (e?.phase === 'unlock' && e.t > 0.45 && !turning) {
        turning = true;
        await shot('cd-4-rosa-turns-key-first');
      }
      if (e?.phase === 'unlock' && e.t > 0.75 && !tpTurning) {
        tpTurning = true;
        await cam('third');
        await fixedCam([33.0, 1.85, 19.0], [34.55, 1.5, 17.35]);
        await shot('cd-5-rosa-turns-key-third');
        await fixedCam(null);
        await cam('first');
      }
      return u.lock?.state === 'open';
    }, 60000, 150);
    h.check('controlled drugs: Rosa walks over and unlocks it', ok, (await cab()).log.filter((l) => /errand|ask/.test(l)).join(' · '));
    h.check('controlled drugs: locked, it stayed shut until she had', maxOpen === 0, `door open ${maxOpen}`);
    await until(async () => (await cab()).errand === null, 6000);
    const rosa1 = await ev<{ x: number; z: number; walking: boolean } | null>(`__acWorld.npc('rn_rosa')`);
    h.check('controlled drugs: then she heads back to the station', !!rosa1 && (rosa1.walking || Math.hypot(rosa1.x - 20.0, rosa1.z - 10.65) < 1.0), `${rosa1?.x.toFixed(2)},${rosa1?.z.toFixed(2)} walking ${rosa1?.walking}`);
    await shot('cd-6-unlocked');
    // open it: the hand to the pull; inside
    await stand(33.95, 17.4, 90, 6);
    await ev(`__acWorld.cabinetOp('grab')`);
    await press('KeyE');
    await until(async () => (await part(KEY)).open > 0.999, 5000);
    const p = await part(KEY);
    h.check('controlled drugs: unlocked, it opens', p.goal === 1 && (p.angleDeg ?? 0) > 90, `${p.angleDeg}°`);
    const g = await grabOf();
    h.check('controlled drugs: the hand is on the pull (≤ 3 cm)', (g?.fp ?? 1) <= 0.03, `${g?.fp}`);
    await page.waitForTimeout(250);
    await stand(34.0, 17.55, 90, 2);
    await shot('cd-7-open-inside');
    await cam('third');
    await fixedCam([32.4, 1.9, 18.9], [34.6, 1.45, 17.4]);
    await shot('cd-8-open-third');
    await fixedCam(null);
    await cam('first');
    // you leave the room: it shuts and locks again
    await stand(33.0, 13.6, 0, 0);
    const relocked = await until(async () => (await unit('med_cd')).lock?.state === 'locked', 6000);
    const u = await unit('med_cd');
    h.check('controlled drugs: once you have left the room it shuts and locks again', relocked && u.parts[0].open === 0, `${u.lock?.state}, door ${u.parts[0].open}; hint "${await hintText()}"`);
    // and it is locked for real: E rattles it again
    await stand(33.95, 17.4, 90, 6);
    await press('KeyE');
    await page.waitForTimeout(900);
    h.check('controlled drugs: locked again, E only rattles it', (await unit('med_cd')).lock?.state === 'tried' && (await part(KEY)).open === 0);
    await hud(false);
  }

  // ── a crash cart's seal: Resus 1's (front to the west) ──
  if (want('seal')) {
    await cam('first');
    await closeAll();
    await stand(38.55, 16.1, 90, -16);
    const f = await ev<{ key: string; label: string } | null>('__acWorld.focus()');
    h.check('crash cart: the prompt breaks the seal (an emergency)', /Break the seal and open drawer [A-E]: .* \(emergency\) · \[F\] Inspect/.test(f?.label ?? ''), `${f?.key} "${f?.label}"`);
    const no = (await unit('resus_1_crash')).seal?.no;
    await hud(true);
    await stand(38.85, 16.1, 90, -28);
    await shot('seal-1-intact');
    await stand(38.55, 16.1, 90, -16);
    await press('KeyE');
    await until(async () => (await unit('resus_1_crash')).seal?.intact === false, 3000, 40);
    await page.waitForTimeout(200);
    const hint = await hintText();
    h.check('crash cart: opening it breaks the numbered seal; pharmacy re-checks and re-seals it', /Seal no\. \d{6} broken/.test(hint) && /pharmacy/i.test(hint) && /new numbered seal/.test(hint), hint);
    h.check('crash cart: the seal number was the one on the tag', !!no && hint.includes(no), `seal ${no}`);
    const key = f?.key ?? '';
    await until(async () => (await part(key)).open > 0.999, 3000);
    h.check('crash cart: and the drawer opens', (await part(key)).open > 0.999);
    await shot('seal-2-broken-drawer-open');
    await stand(38.95, 16.1, 90, -55);
    await shot('seal-3-drawer-contents');
    await cam('third');
    await fixedCam([38.3, 1.6, 17.3], [39.5, 0.95, 16.1]);
    await shot('seal-4-third');
    await fixedCam(null);
    await cam('first');
    const after = await part(key);
    h.check('crash cart: broken, the next drawer opens without the seal prompt', !/Break the seal/.test((await unit('resus_1_crash')).parts.find((p) => p.key !== key)?.label ?? ''), after.label);
    // pharmacy's new seal (a new number)
    await ev(`__acWorld.cabinetOp('reseal', 'resus_1_crash')`);
    const s2 = (await unit('resus_1_crash')).seal;
    h.check('crash cart: re-sealed, with a new number', s2?.intact === true && s2.no !== no, `${no} → ${s2?.no}`);
    await hud(false);
    await closeAll();
  }

  // ── clearances: every door opened wide; standing in a door's swing ──
  if (want('clear')) {
    await cam('first');
    await closeAll();
    // you out of the way, in the hub
    await stand(22, 8.2, 0, 0);
    const all = await cab();
    // (held open: far from you, they would close themselves)
    await ev(`__acWorld.cabinetOp('hold', true)`);
    for (const u of all.units) for (const p of u.parts) if (p.kind === 'door' && !u.lock && !/locker 1[124]/.test(p.name)) await ev(`__acWorld.cabinetOp('snap', ${JSON.stringify({ key: p.key, open: 1 })})`);
    await page.waitForTimeout(300);
    const audit = await ev<Audit[]>(`__acWorld.cabinetOp('audit')`);
    await ev(`__acWorld.cabinetOp('hold', false)`);
    const walls = audit.filter((a) => a.walls > 0);
    const neigh = audit.filter((a) => a.neighbours > 0);
    h.check(`every door opened wide (${audit.length}): none through a wall`, audit.length >= 30 && !walls.length, walls.map((a) => `${a.key} ${a.angleDeg}°`).join(', ') || `smallest clearance ${Math.min(...audit.map((a) => a.minClear)).toFixed(3)} m`);
    h.check('…and none through a neighbouring cupboard, cart or fridge', !neigh.length, neigh.map((a) => `${a.key} ${a.angleDeg}°`).join(', '));
    const narrow = audit.filter((a) => a.angleDeg < 80);
    console.log(`   (doors stopped short by a wall or a neighbour: ${narrow.map((a) => `${a.key} ${a.angleDeg}°`).join(', ') || 'none'})`);
    await closeAll();
    // standing in the swing of the ambulance corridor cabinet's left door: you step out of its way first
    const KEY = 'cab:ems_cab:0';
    await stand(42.35, 18.48, 90, -2);
    const f = await ev<{ key: string } | null>('__acWorld.focus()');
    h.check('in a door\'s swing: aiming at it', f?.key === KEY, String(f?.key));
    const at0 = await ev<{ x: number; z: number }>('__acWorld.state()');
    await press('KeyE');
    let hits = 0;
    let samples = 0;
    await until(async () => {
      const a = (await ev<Audit[]>(`__acWorld.cabinetOp('audit')`)).find((x) => x.key === KEY);
      if (a) {
        samples++;
        if (a.player) hits++;
      }
      return (await part(KEY)).open > 0.999;
    }, 6000, 40);
    const at1 = await ev<{ x: number; z: number }>('__acWorld.state()');
    const moved = Math.hypot(at1.x - at0.x, at1.z - at0.z);
    h.check('in a door\'s swing: you step out of its way, then it opens fully', moved > 0.15 && (await part(KEY)).open > 0.999, `stepped ${moved.toFixed(2)} m`);
    h.check('…and the door never passes through you', hits === 0 && samples > 3, `${hits} of ${samples} samples`);
    await hud(true);
    await shot('clear-stepped-aside');
    await hud(false);
    await closeAll();
  }

  // ── Ward 2 East ──
  if (want('f2')) {
    await cam('first');
    await closeAll();
    // the clean utility's linen cupboard (front to the west)
    await stand(56.15, 15.95, 90, -6, 3);
    const lv = await ev<{ level: number }>('__acWorld.floors()');
    h.check('Floor 2: you are upstairs', lv.level === 1, JSON.stringify(lv).slice(0, 80));
    const fl = await ev<{ key: string; label: string } | null>('__acWorld.focus()');
    h.check('Floor 2: the linen cupboard is a target', /^cab:f2_ut_shelf_1:\d$/.test(fl?.key ?? ''), `${fl?.key} "${fl?.label}"`);
    await hud(true);
    await press('KeyE');
    await until(async () => (await part(fl?.key ?? '')).open > 0.999, 5000);
    await page.waitForTimeout(250);
    await shot('f2-1-linen-cupboard');
    await hud(false);
    // the staff lockers: someone's own (locked); the spare one opens
    await closeAll();
    await stand(49.2, 14.25, 180, 0, 3);
    const lk = await ev<{ key: string; label: string } | null>('__acWorld.focus()');
    await press('KeyE');
    await page.waitForTimeout(900);
    const lockHint = await hintText();
    h.check('Floor 2: a colleague\'s locker is locked', /someone's own|a colleague's own/.test(lk?.label ?? '') && /locked/.test(lockHint) && (await part(lk?.key ?? '')).open === 0, `"${lk?.label}" / "${lockHint}"`);
    // the ward's controlled-drug cupboard: Ana, the nurse in charge, brings the key
    await closeAll();
    await stand(62.45, 18.95, 90, 10, 3);
    await press('KeyE');
    await until(async () => (await unit('f2_med_cd')).lock?.state === 'tried', 3000, 50);
    await page.waitForTimeout(200);
    const h2 = await hintText();
    h.check('Floor 2: the ward\'s cupboard is locked; the key is with the nurse in charge (Ana)', /The key is with the nurse in charge \(Ana\)/.test(h2), h2);
    await press('KeyE');
    let annaShot = false;
    const okAna = await until(async () => {
      const e = (await cab()).errand;
      if (e?.phase === 'unlock' && e.t > 0.5 && !annaShot) {
        annaShot = true;
        await hud(true);
        await cam('third');
        await fixedCam([61.2, 3 + 1.9, 18.0], [63.0, 3 + 1.55, 18.95]);
        await shot('f2-2-ana-turns-key');
        await fixedCam(null);
        await cam('first');
        await hud(false);
      }
      return (await unit('f2_med_cd')).lock?.state === 'open';
    }, 45000, 150);
    h.check('Floor 2: Ana walks over and unlocks it', okAna, (await cab()).log.slice(-6).join(' · '));
    await until(async () => (await cab()).errand === null, 6000);
    await press('KeyE');
    await until(async () => (await part('cab:f2_med_cd:0')).open > 0.999, 5000);
    await hud(true);
    await shot('f2-3-ward-cd-open');
    await hud(false);
    // a patient's wardrobe (room 201: his clothes), its doors to the north
    await closeAll();
    await stand(59.3, 5.2, 0, -4, 3);
    const wf = await ev<{ key: string; label: string } | null>('__acWorld.focus()');
    await press('KeyE');
    await until(async () => (await part(wf?.key ?? '')).open > 0.999, 5000);
    await hud(true);
    await shot('f2-4-wardrobe');
    await hud(false);
    h.check('Floor 2: a patient\'s wardrobe opens', (await part(wf?.key ?? '')).open > 0.999, `${wf?.key}`);
    await closeAll();
  }

  h.check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
} finally {
  await h.close();
}
console.log(h.failed() ? `✗ ${h.failed()} check(s) failed` : '✓ all cabinet checks passed');
process.exit(h.failed() ? 1 : 0);
