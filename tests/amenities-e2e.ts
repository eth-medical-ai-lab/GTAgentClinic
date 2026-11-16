/**
 * Things in hands and things to use, on the real GPU: an item in each hand (first and third person),
 * the hands-full hint, putting down with G; coffee from the cafeteria machine (pour, steam), carried,
 * then sipped at a café table (the rim on the lower lip, tipped by how much is left); sitting on the
 * workroom's sofa and Floor 2's (feet on the floor, seated eye height, getting up clear of it, a drink
 * sipped from the hand, a seat someone is about to take); the vending machine; hand rub; and fps on
 * High at 1600×900. Boots a private server (tests/harness.ts) and stops it at the end.
 *
 *   npx tsx tests/amenities-e2e.ts [outDir] [--only=hands,coffee,sit,couch,vend,rub,crowd,read,fps] [--port-base=6700]
 */
import { mkdirSync } from 'node:fs';
import type { Page } from 'playwright';
import { startHarness } from './harness';

const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'shots/amenities';
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (k: string) => !only || only.includes(k);
const portBase = Number(args.find((a) => a.startsWith('--port-base='))?.slice(12) ?? 6700);
mkdirSync(out, { recursive: true });

const h = await startHarness({ portBase, dev: true });
type Item = { id: string; kind: string; label: string; x: number; z: number };
type Amen = { seated: string | null; action: string | null; machines: { id: string; state: string; t: number; fill: number | null }[]; drinks: { id: string; label: string; fill: number; sips: number; of: number; temp: number; steam: boolean; held: string | null }[]; held: { id: string; label: string; slot: string }[] };

try {
  // Night Shift on High. The dev server's hot reload is cut off for this page: other edits to the
  // tree mid-run would otherwise rebuild the world under the test.
  const page = await h.browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  await page.routeWebSocket((url) => !url.pathname.endsWith('/ws'), () => undefined);
  await page.goto(`${h.url}/?debug=1&quality=high`);
  await page.waitForSelector('.menu-maps .map-card', { timeout: 60000 });
  await page.click('text=Night Shift');
  await page.click('button.start');
  await page.waitForSelector('.hud-clock', { timeout: 60000 });
  // the world is up once its first clean frames are on screen (shaders compiled)
  await page.waitForSelector('.loading-screen.done', { timeout: 120000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const ev = <T = unknown>(s: string) => page.evaluate(s) as Promise<T>;
  const shot = async (name: string, hideHud = false) => {
    if (hideHud) await page.addStyleTag({ content: '.hud, .toasts { visibility: hidden !important; }' });
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`📸 ${out}/${name}.png`);
  };
  const amen = () => ev<Amen>('__acWorld.amenities()');
  const cam = (m: 'first' | 'third' | 'top') => ev(`__ac.store.set({ camera: '${m}' })`);
  const hintText = () => ev<string>(`document.querySelector('.wl-hint')?.textContent ?? ''`);
  const fps = (ms = 2500) =>
    ev<number>(`new Promise((resolve) => { let n = 0; const t0 = performance.now(); const tick = () => { n++; if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick); else resolve(Math.round((n * 1000) / (performance.now() - t0))); }; requestAnimationFrame(tick); })`);
  type Seated = Amen & { seat: { kind: string; id: string } | null; sofas: { id: string; solid: boolean }[] };
  const seated = () => ev<Seated>('__acWorld.amenities()');
  const where = () => ev<{ x: number; z: number; y: number; camY: number }>('__acWorld.state()');
  /** a sip held still t s in, and then where the cup's rim is on the lip (m) and how far it is tipped (°) */
  const sipHeld = async (t: number) => {
    await ev(`__acWorld.amenity('hold', ${t})`);
    await ev('__acWorld.sipNow()');
    for (let i = 0; i < 300; i++) {
      const s = await ev<{ action: string | null; t: number | null }>('__acWorld.amenities()');
      if (s.action === 'sip' && (s.t ?? 0) >= t - 0.001) break;
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(250);
    return ev<{ gap: number | null; tilt: number | null }>(`__acWorld.amenity('pose')`);
  };
  const release = async () => {
    await ev(`__acWorld.amenity('hold', null)`);
    for (let i = 0; i < 100 && (await amen()).action === 'sip'; i++) await page.waitForTimeout(50);
  };
  await ev(`__ac.client.act({ type: 'wait', minutes: 2 })`);

  if (want('hands')) {
    const items = await ev<Item[]>('__acWorld.listItems()');
    const glove = items.find((i) => i.kind === 'gloveBox')!;
    const second = items.find((i) => i.kind === 'clipboard' && Math.hypot(i.x - glove.x, i.z - glove.z) < 4) ?? items.find((i) => i.kind === 'clipboard')!;
    const third = items.find((i) => i.kind === 'pen' && Math.hypot(i.x - glove.x, i.z - glove.z) < 4) ?? items.find((i) => i.kind === 'coffeeMug')!;
    console.log('glove box', glove, 'second', second.kind, 'third', third.kind);
    // stand a step away from the counter, then pick things up
    await ev(`__acWorld.teleport(${glove.x}, ${glove.z + 1.0}, 180, -20)`);
    await ev(`__acWorld.pickUp('${glove.id}')`);
    await cam('third');
    await ev(`__acWorld.teleport(${glove.x - 2}, ${glove.z + 2.2}, 90, -8)`);
    await ev(`__acWorld.look(90, -6, 2.4)`);
    await page.waitForTimeout(1200);
    await shot('hands-glovebox-third-standing');
    // walking toward the camera (S), so the front shows
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(700);
    await shot('hands-glovebox-third-walking');
    await page.keyboard.up('KeyS');
    // a second thing goes to the left hand
    await ev(`__acWorld.pickUp('${second.id}')`);
    await ev(`__acWorld.teleport(${glove.x - 2}, ${glove.z + 2.2}, 90, -8)`);
    await ev(`__acWorld.look(90, -6, 2.4)`);
    await page.waitForTimeout(1000);
    const a1 = await amen();
    h.check('one thing in each hand', a1.held.length === 2 && a1.held.some((x) => x.slot === 'R') && a1.held.some((x) => x.slot === 'L'), JSON.stringify(a1.held));
    await shot('hands-two-third');
    await cam('first');
    await ev(`__acWorld.teleport(${glove.x - 2}, ${glove.z + 2.2}, 90, -10)`);
    await page.waitForTimeout(800);
    await shot('hands-two-first');
    // a third: hands full
    await ev(`__acWorld.pickUp('${third.id}')`);
    await page.waitForTimeout(150);
    const ht = await hintText();
    const a2 = await amen();
    h.check('hands full: no third pick-up, a hint instead', a2.held.length === 2 && /Hands full/.test(ht), ht);
    await shot('hands-full-hint');
    // G (only G: E is for using things) puts down the last thing (the clipboard) where you aim
    await ev(`__acWorld.teleport(${glove.x}, ${glove.z + 0.9}, 180, -35)`);
    await page.waitForTimeout(300);
    const f = await ev<{ label: string } | null>('__acWorld.focus()');
    h.check('E offers no "put down" with nothing in sight', !f || !/^Put down/.test(f.label), JSON.stringify(f));
    await page.keyboard.press('KeyG');
    await page.waitForTimeout(400);
    const a3 = await amen();
    h.check('G puts down the last thing picked up', a3.held.length === 1 && a3.held[0].slot === 'R', JSON.stringify(a3.held));
    await shot('hands-put-down-with-G');
    await page.keyboard.press('KeyG');
    await page.waitForTimeout(300);
    h.check('G puts down the other', (await amen()).held.length === 0);
  }

  if (want('coffee') || want('sit')) {
    await cam('first');
    // the cafeteria's self-serve machine (stand in front of it: 65.38, 1.15); let the new view's shaders compile first
    await ev(`__acWorld.teleport(65.38, 1.15, 180, -24)`);
    await page.waitForTimeout(4000);
    // the hand takes the top cup off the stack beside it (~0.7 s), sets it under the spout (~2 s) and
    // presses the button (~2.6 s): tests/cafe-e2e.ts checks each of those
    await ev(`__acWorld.use('coffee:caf_coffee')`);
    await page.waitForTimeout(2300);
    await shot('coffee-placed-first');
    await page.waitForTimeout(7200);
    let a = await amen();
    const m = a.machines.find((x) => x.id === 'coffee:caf_coffee')!;
    h.check('brewing: the cup fills while it pours', m.state === 'brewing' && (m.fill ?? 0) > 0.2 && (m.fill ?? 0) < 0.95, JSON.stringify(m));
    await ev(`__acWorld.teleport(65.38, 1.2, 180, -38)`);
    await page.waitForTimeout(400);
    await shot('coffee-pouring-first');
    await cam('third');
    // from the player's right, looking west along the counter (close: the cafeteria's east wall is 1.7 m away)
    await ev(`__acWorld.look(90, -20, 1.3)`);
    await page.waitForTimeout(600);
    await shot('coffee-pouring-third');
    await page.waitForTimeout(8500);
    a = await amen();
    h.check('ready after ~15 s', a.machines.find((x) => x.id === 'coffee:caf_coffee')!.state === 'ready', JSON.stringify(a.machines));
    // taken: a lid off the lid stack pressed on first, then the cup to hand (~3 s)
    await ev(`__acWorld.use('coffee:caf_coffee')`);
    await page.waitForTimeout(3600);
    a = await amen();
    const cup = a.drinks.find((d) => d.held);
    h.check('coffee in hand, full and steaming, lid on', !!cup && cup.fill > 0.95 && cup.steam && (cup as { lid?: boolean }).lid === true, JSON.stringify(a.drinks));
    await ev(`__acWorld.teleport(62.8, 2.6, 180, -8)`);
    await ev(`__acWorld.look(180, -8, 2.2)`);
    await page.waitForTimeout(900);
    await shot('coffee-carry-third');
    await page.keyboard.down('KeyS');
    await page.waitForTimeout(650);
    await shot('coffee-carry-third-walking');
    await page.keyboard.up('KeyS');
    await cam('first');
    await page.waitForTimeout(500);
    await ev(`__acWorld.teleport(62.8, 2.6, 180, -25)`);
    await page.waitForTimeout(500);
    await shot('coffee-carry-first');
  }

  if (want('sit')) {
    // table 2 (63.1, 4.4): chair 5 is north of it, facing the table
    await ev(`__acWorld.teleport(63.1, 3.2, 0, -10)`);
    await ev(`__acWorld.use('sit:caf_chair_5')`);
    await page.waitForTimeout(800);
    let a = await amen();
    h.check('seated at the café table, coffee on the table', a.seated === 'caf_chair_5' && a.held.length === 0, JSON.stringify(a));
    await shot('sit-first');
    await cam('third');
    await ev(`__acWorld.look(0, -16, 1.8)`);
    await page.waitForTimeout(1200);
    await shot('sit-third');
    const before = a.drinks.find((d) => d.label !== 'empty paper cup')!;
    await ev('__acWorld.sipNow()');
    await page.waitForTimeout(1750);
    await shot('sip-third-mid');
    await page.waitForTimeout(2200);
    a = await amen();
    const after = a.drinks.find((d) => d.id === before.id)!;
    h.check('a sip lowers the level', after.fill < before.fill && after.sips === before.sips + 1, `${before.fill} → ${after.fill}`);
    await cam('first');
    await ev(`__acWorld.look(180, -25)`);
    await ev('__acWorld.sipNow()');
    await page.waitForTimeout(800);
    await shot('sip-first-mid');
    await page.waitForTimeout(2000);
    // drink it down (test speed-up: sips back to back)
    for (let i = 0; i < 14; i++) {
      await ev('__acWorld.sipNow()');
      await page.waitForTimeout(2500);
      a = await amen();
      if (a.drinks.find((d) => d.id === before.id)!.fill <= 0.001) break;
    }
    a = await amen();
    const empty = a.drinks.find((d) => d.id === before.id)!;
    h.check(`empty after ${empty.sips} sips (8–12)`, empty.fill <= 0.001 && empty.sips >= 8 && empty.sips <= 12, JSON.stringify(empty));
    await ev(`__acWorld.use('stand')`);
    await page.waitForTimeout(400);
    a = await amen();
    h.check('standing up takes the empty cup along', !a.seated && a.held.length === 1, JSON.stringify(a.held));
    // to the waste station by the cafeteria door
    await ev(`__acWorld.teleport(60.3, 7.6, 180, -20)`);
    await page.waitForTimeout(300);
    await ev(`__acWorld.use('bin:caf_waste')`);
    await page.waitForTimeout(800);
    a = await amen();
    h.check('the empty cup went into the bin', a.held.length === 0 && !a.drinks.some((d) => d.id === before.id), JSON.stringify(a));
  }

  if (want('sit')) {
    // a sip, held still at the lip: the rim on the lower lip, tipped ~20° when full, ~60° near the end
    // (a coffee from the machine again, sitting at the same table)
    await cam('first');
    await ev(`__acWorld.teleport(65.38, 1.15, 180, -24)`);
    await page.waitForTimeout(1500);
    await ev(`__acWorld.use('coffee:caf_coffee')`);
    await page.waitForTimeout(18500);
    await ev(`__acWorld.use('coffee:caf_coffee')`);
    // (the lid on, the cup to hand)
    await page.waitForTimeout(3600);
    await ev(`__acWorld.teleport(63.1, 3.2, 0, -10)`);
    await ev(`__acWorld.use('sit:caf_chair_5')`);
    await cam('third');
    await ev(`__acWorld.look(-20, -8, 1.3)`);
    await page.waitForTimeout(1500);
    for (const [fill, lo, hi] of [[1, 15, 25], [0.12, 55, 72]] as const) {
      await ev(`__acWorld.amenity('fill', ${fill})`);
      const p = await sipHeld(1.8);
      h.check(`a sip (${fill === 1 ? 'full' : 'nearly empty'}): the rim on the lower lip, tipped ${lo}–${hi}°`, p.gap !== null && p.gap < 0.006 && p.tilt !== null && p.tilt >= lo && p.tilt <= hi, `gap ${p.gap} m, ${p.tilt}°`);
      await shot(`sip-${fill === 1 ? 'full' : 'empty'}-third-held`);
      await release();
    }
    await ev(`__acWorld.use('stand')`);
    await page.keyboard.press('KeyG');
    await page.waitForTimeout(300);
  }

  if (want('couch')) {
    type Pose = { pelvis: number[] | null; toes: (number[] | null)[]; posture: string | null };
    const pose = () => ev<Pose>(`__acWorld.amenity('pose')`);
    const solid = async (id: string) => (await seated()).sofas.find((x) => x.id === id)?.solid;
    // the workroom sofa (x 25.55, z 20.6, facing east): stand in front of its north cushion, look down at it
    await cam('first');
    await ev(`__acWorld.teleport(26.6, 20.2, -90, -48)`);
    await page.waitForTimeout(2500);
    const f = await ev<{ key: string; label: string } | null>('__acWorld.focus()');
    h.check('aiming at the sofa offers a seat', f?.key === 'use:sofa:wr_sofa' && /^Sit/.test(f.label), JSON.stringify(f));
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(2600);
    let a = await seated();
    let s = await where();
    h.check('E sits you on the nearest cushion', a.seated === 'wr_sofa' && a.seat?.kind === 'sofa' && /@0\.4$/.test(a.seat.id), JSON.stringify(a.seat));
    h.check('first person: eyes at sitting height (~1.29 m)', Math.abs(s.camY - 1.29) < 0.04, `camera ${s.camY.toFixed(3)} m`);
    h.check('the sofa stops being solid for you while you sit in it', (await solid('wr_sofa')) === false);
    await shot('couch-first');
    await cam('third');
    await ev(`__acWorld.look(-60, -14, 2.2)`);
    await page.waitForTimeout(1200);
    // seated: the hips 10 cm over the cushion (0.46 m), the back to the back cushions, the feet on the floor
    const p = await pose();
    const pel = p.pelvis ?? [0, 0, 0];
    const toesY = Math.max(...p.toes.map((t) => t?.[1] ?? 1));
    h.check('sitting: hips on the cushion, back to the back cushions, feet on the floor', p.posture === 'sit' && Math.abs(pel[1] - 0.56) < 0.03 && Math.abs(pel[0] - (25.55 + 0.065)) < 0.04 && toesY < 0.06, `pelvis ${pel.map((x) => x.toFixed(3))}, toes ≤ ${toesY.toFixed(3)} m`);
    await shot('couch-third');
    // up with W: you rise over your feet and step clear (in front of it, never through it)
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(60);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(120);
    await shot('couch-standup-mid');
    await page.waitForTimeout(1200);
    a = await seated();
    s = await where();
    h.check('W stands you up in front of the sofa, clear of it', !a.seated && s.x >= 25.96 + 0.29 && Math.abs(s.z - 20.2) < 0.4 && (await solid('wr_sofa')) === true, `at ${s.x.toFixed(2)}, ${s.z.toFixed(2)}`);
    // with a mug from the workroom's machine: it stays in your hand, and is sipped from the hand
    await cam('first');
    // (in front of it: a mug off the rack beside it, under the spout, the button; then taken)
    await ev(`__acWorld.teleport(30.01, 15.58, 90, -24)`);
    await page.waitForTimeout(1200);
    await ev(`__acWorld.use('coffee:wr_coffee')`);
    await page.waitForTimeout(18500);
    await ev(`__acWorld.use('coffee:wr_coffee')`);
    await page.waitForTimeout(2000);
    await cam('third');
    await ev(`__acWorld.teleport(26.6, 21.0, -90, -12)`);
    await page.waitForTimeout(800);
    await ev(`__acWorld.use('sofa:wr_sofa')`);
    await page.waitForTimeout(2400);
    a = await seated();
    const mug = a.drinks.find((d) => /mug/.test(d.label));
    h.check('sitting down with a drink: it stays in your hand', a.seated === 'wr_sofa' && !!mug && a.held.some((x) => x.id === mug.id), JSON.stringify(a.held));
    await ev(`__acWorld.look(-55, -12, 2.0)`);
    await page.waitForTimeout(900);
    await shot('couch-mug-third');
    const sip = await sipHeld(1.2);
    h.check('a sip from the hand: the rim on the lip', sip.gap !== null && sip.gap < 0.006, `gap ${sip.gap} m, ${sip.tilt}°`);
    await shot('couch-mug-sip-third');
    await release();
    a = await seated();
    const after = a.drinks.find((d) => d.id === mug?.id);
    h.check('…and the level drops, the mug still in hand', !!mug && !!after && after.fill < mug.fill && after.held === 'R', `${mug?.fill} → ${after?.fill}, held ${after?.held}`);
    await cam('first');
    await page.waitForTimeout(600);
    await shot('couch-mug-first');
    await ev(`__acWorld.use('stand')`);
    await page.waitForTimeout(900);
    // someone about to sit on it, then sitting on it: no room for you (an NPC sits in the middle of a
    // sofa: World.ts seatNear). The attending goes to the workroom's 'couch' spot.
    await ev(`__acWorld.teleport(27.6, 20.6, -90, -20)`);
    const npcs = await ev<{ id: string; location: string; posture: string; visible: boolean }[]>(`__ac.store.get().view.npcs.map((n) => ({ id: n.id, location: n.location, posture: n.posture, visible: n.visible }))`);
    const sitter = npcs.find((n) => n.location === 'workroom' && n.posture === 'sit' && n.visible);
    if (sitter) {
      await ev(`__acWorld.sitNpc('${sitter.id}', 25.9, 21.0, 90)`);
      await page.waitForTimeout(300);
      let t = await ev<string[]>(`__acWorld.amenity('targets')`);
      await ev(`__acWorld.use('sofa:wr_sofa')`);
      await page.waitForTimeout(300);
      a = await seated();
      h.check(`no seat where someone is about to sit (${sitter.id} on the way)`, !a.seated && !a.seat && !t.includes('use:sofa:wr_sofa'), JSON.stringify({ seated: a.seated, targets: t.filter((k) => /sofa/.test(k)) }));
      let n: { x: number; z: number; posture: string } | null = null;
      for (let i = 0; i < 50; i++) {
        n = await ev<{ x: number; z: number; posture: string }>(`__acWorld.npc('${sitter.id}')`);
        if (n.posture === 'sit' && Math.hypot(n.x - 25.6, n.z - 20.6) < 0.3) break;
        await page.waitForTimeout(300);
      }
      t = await ev<string[]>(`__acWorld.amenity('targets')`);
      await ev(`__acWorld.use('sofa:wr_sofa')`);
      await page.waitForTimeout(300);
      a = await seated();
      h.check(`nor where someone sits (${sitter.id} on the sofa)`, !!n && n.posture === 'sit' && !a.seated && !a.seat && !t.includes('use:sofa:wr_sofa'), JSON.stringify({ npc: n, seated: a.seated }));
      // (it backs into the seat over ~0.65 s)
      await cam('first');
      await ev(`__acWorld.teleport(27.3, 20.75, -90, -12)`);
      await page.waitForTimeout(1500);
      await shot('couch-npc-sitting');
    } else h.check('a seated NPC in the workroom to test with', false, JSON.stringify(npcs.filter((x) => x.location === 'workroom')));
    // Floor 2's staff lounge: the sofa at x 48.6, z 16.4 facing east
    await cam('first');
    await ev(`__acWorld.teleportY(49.6, 16.0, 3.0, -90, -48)`);
    await page.waitForTimeout(2500);
    const f2 = await ev<{ key: string; label: string } | null>('__acWorld.focus()');
    h.check('Floor 2: aiming at the lounge sofa offers a seat', f2?.key === 'use:sofa:f2_lng_sofa', JSON.stringify(f2));
    await page.keyboard.press('KeyE');
    await page.waitForTimeout(2600);
    a = await seated();
    s = await where();
    h.check('Floor 2: seated, eyes at sitting height', a.seated === 'f2_lng_sofa' && Math.abs(s.camY - (3 + 1.29)) < 0.04, `${a.seated}, camera ${s.camY.toFixed(3)} m`);
    await shot('couch-f2-first');
    await cam('third');
    await page.waitForTimeout(1000);
    await shot('couch-f2-third');
    await ev(`__acWorld.use('stand')`);
    await page.waitForTimeout(1000);
    s = await where();
    h.check('Floor 2: up again in front of it', s.x >= 49.01 + 0.29 && Math.abs(s.y - 3) < 0.05, `at ${s.x.toFixed(2)}, ${s.z.toFixed(2)}, y ${s.y.toFixed(2)}`);
    await page.keyboard.press('KeyG');
  }

  if (want('vend')) {
    await cam('third');
    await ev(`__acWorld.teleport(1.55, 22.85, -90, -8)`);
    await page.waitForTimeout(2500);
    await ev(`__acWorld.use('vend')`);
    // from the north-east, looking south-west at the player and the machine's face
    await ev(`__acWorld.look(135, -14, 1.8)`);
    // (the drink picked, then the phone tapped on its reader: payment.ts; then it drops, ~4.5 s in)
    await page.waitForTimeout(4400);
    await shot('vend-drop-third');
    await page.waitForTimeout(3000);
    const a = await amen();
    h.check('a can from the vending machine, in hand', a.held.some((x) => /can of/.test(x.label)), JSON.stringify(a.held));
    await page.waitForTimeout(400);
    await shot('vend-can-third');
    await page.keyboard.press('KeyG');
  }

  if (want('rub')) {
    await cam('third');
    // Bed 4's dispenser: west wall of the bay, 1.2 m from the curtain
    await ev(`__acWorld.teleport(12.75, 5.8, -90, -8)`);
    await page.waitForTimeout(2500);
    await ev(`__acWorld.use('rub:rub_bed_4')`);
    // from inside the bay (north-east of the player), looking toward the dispenser by the curtain
    await ev(`__acWorld.look(133, -12, 1.6)`);
    await page.waitForTimeout(2200);
    await shot('rub-third');
    await page.waitForTimeout(3000);
  }

  if (want('crowd')) {
    // anyone in the waiting room can be talked to now (off the record)
    await cam('first');
    await ev(`__acWorld.teleport(5.0, 16.4, 0, -10)`);
    await page.waitForTimeout(2500);
    type V = { id: string; name: string; talkable: boolean; offRecord?: boolean; ambient?: { crowd: boolean; at?: { x: number; z: number; rot: number } } };
    const crowd = await ev<V[]>(`__ac.store.get().view.npcs.filter((n) => n.ambient?.crowd && n.location === 'waiting' && n.posture === 'sit')`);
    h.check('the waiting-room crowd is talkable, off the record', crowd.length > 3 && crowd.every((n) => n.talkable && n.offRecord), `${crowd.length} seated`);
    const who = crowd[0];
    const n = await ev<{ x: number; z: number; yaw: number }>(`__acWorld.npc('${who.id}')`);
    const x = n.x + Math.sin(n.yaw) * 1.1;
    const z = n.z + Math.cos(n.yaw) * 1.1;
    await ev(`__acWorld.teleport(${x}, ${z}, ${((Math.atan2(n.x - x, n.z - z) * 180) / Math.PI).toFixed(1)}, -22)`);
    await page.waitForTimeout(800);
    await page.keyboard.press('KeyE');
    await page.waitForSelector('.tablet', { timeout: 5000 }).catch(() => undefined);
    await page.keyboard.type('Hi, how long have you been waiting?');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    const lines = await ev<{ speaker: string; text: string }[]>(`__ac.store.get().view.conversations.find((c) => c.key === '${who.id}')?.lines ?? []`);
    h.check('a crowd member answers on the tablet', lines.some((l) => l.speaker === 'npc'), lines.map((l) => `${l.speaker}: ${l.text}`).join(' | '));
    await shot('crowd-chat');
    await ev(`__ac.store.set({ panel: null })`);
  }

  if (want('read')) {
    // the broadsheet readers and the laptop: wait for the act, pause the clock, frame them up close
    await cam('first');
    for (const [id, act] of [
      ['vis_3', 'read'],
      ['vis_1', 'laptop'],
    ] as const) {
      const now = () => ev<string | undefined>(`__ac.store.get().view.npcs.find((x) => x.id === '${id}')?.ambient?.act`);
      for (let i = 0; i < 60 && (await now()) !== act; i++) {
        await ev(`__ac.client.act({ type: 'wait', minutes: 1 })`);
        await page.waitForTimeout(400);
      }
      h.check(`${id} gets to ${act}`, (await now()) === act);
      await ev(`__ac.client.settings({ paused: true })`);
      const n = await ev<{ x: number; z: number; yaw: number }>(`__acWorld.npc('${id}')`);
      const x = n.x + Math.sin(n.yaw) * 1.45 + Math.cos(n.yaw) * 0.3;
      const z = n.z + Math.cos(n.yaw) * 1.45 - Math.sin(n.yaw) * 0.3;
      await ev(`__acWorld.teleport(${x}, ${z}, ${((Math.atan2(n.x - x, n.z - z) * 180) / Math.PI).toFixed(1)}, -14)`);
      await page.waitForTimeout(2500);
      await shot(`waiting-${act}`, true);
      await ev(`__ac.client.settings({ paused: false })`);
    }
  }

  if (want('fps')) {
    await cam('first');
    for (const [name, x, z, yaw, pitch] of [
      ['cafeteria', 57.9, 8.35, 138, -9],
      ['waiting', 5.0, 15.9, 0, -6],
      ['hub', 3.0, 11.2, 90, -3],
    ] as [string, number, number, number, number][]) {
      await ev(`__acWorld.teleport(${x}, ${z}, ${yaw}, ${pitch})`);
      await page.waitForTimeout(2500);
      const n = await fps();
      h.check(`${name}: ≥ 50 fps on High at 1600×900`, n >= 50, `${n} fps`);
      await shot(`fps-${name}`);
    }
  }

  const real = errors.filter((e) => !/PropertyBinding|404|WebSocket/.test(e));
  h.check('no page errors', real.length === 0, real.slice(0, 4).join(' | '));
} finally {
  await h.close();
}
console.log(h.failed() ? `\n${h.failed()} check(s) failed` : '\nall checks passed');
process.exit(h.failed() ? 1 : 0);
void (null as unknown as Page);
